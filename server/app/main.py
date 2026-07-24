import json
from typing import Iterator

import requests
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from openai import OpenAIError

from .auth import require_user
from .config import get_settings
from .evaluation import build_purchase_evaluation
from .market import MarketClient
from .models import (
    AnalyzeRequest,
    AssetInput,
    AssetRecognition,
    EvaluationChatRequest,
    EvaluationChatResponse,
    ParsedProduct,
    ProductImagesRequest,
    ProductParseRequest,
    ProductTextRequest,
    PurchaseEvaluationRequest,
    PurchaseEvaluationResult,
    SellPlanRequest,
    SellPlanResult,
    ValuationResult,
)
from .openai_service import OpenAIService
from .product import fetch_product_page
from .sell_plan import recommend_sell_plan
from .text_ai import build_text_ai
from .valuation import build_valuation


app = FastAPI(title="Worth API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/analyze", response_model=AssetRecognition)
def analyze(
    request: AnalyzeRequest,
    user_id: str = Depends(require_user),
) -> AssetRecognition:
    try:
        return OpenAIService(get_settings()).analyze(request.image_urls, user_id)
    except (RuntimeError, OpenAIError) as error:
        raise HTTPException(
            status_code=503,
            detail="图片识别服务暂时不可用，请稍后重试",
        ) from error


@app.post("/estimate", response_model=ValuationResult)
def estimate(
    asset: AssetInput,
    user_id: str = Depends(require_user),
) -> ValuationResult:
    settings = get_settings()
    try:
        candidates = MarketClient(settings.xianyu_cookie).search(
            asset.search_query
        )
        matching_ids = build_text_ai(settings).matching_ids(
            asset, candidates, user_id
        )
        return build_valuation(asset.search_query, candidates, matching_ids)
    except (RuntimeError, requests.RequestException, OpenAIError) as error:
        raise HTTPException(
            status_code=503,
            detail="市场估价服务暂时不可用，请稍后重试",
        ) from error


@app.post("/products/parse", response_model=ParsedProduct)
def parse_product(
    request: ProductParseRequest,
    user_id: str = Depends(require_user),
) -> ParsedProduct:
    try:
        page = fetch_product_page(request.url)
        classification = build_text_ai(get_settings()).classify_product(
            page.title,
            user_id,
        )
        return ParsedProduct(
            url=page.url,
            title=classification.normalized_title,
            price=page.price,
            category=classification.category,
            subcategory=classification.subcategory.strip(),
            source_type="url",
            source_text="",
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(
            status_code=503,
            detail="商品页面暂时无法解析，请稍后重试",
        ) from error


@app.post("/products/normalize-text", response_model=ParsedProduct)
def normalize_product_text(
    request: ProductTextRequest,
    user_id: str = Depends(require_user),
) -> ParsedProduct:
    try:
        classification = build_text_ai(get_settings()).classify_product(
            request.text,
            user_id,
        )
        return ParsedProduct(
            title=classification.normalized_title,
            price=request.price,
            category=classification.category,
            subcategory=classification.subcategory.strip(),
            source_type="text",
            source_text=request.text.strip(),
        )
    except (RuntimeError, OpenAIError) as error:
        raise HTTPException(
            status_code=503,
            detail="商品描述暂时无法解析，请稍后重试",
        ) from error


@app.post("/products/analyze-images", response_model=ParsedProduct)
def analyze_product_images(
    request: ProductImagesRequest,
    user_id: str = Depends(require_user),
) -> ParsedProduct:
    try:
        return OpenAIService(get_settings()).analyze_product(
            request.image_urls,
            user_id,
        )
    except (RuntimeError, OpenAIError) as error:
        raise HTTPException(
            status_code=503,
            detail="商品图片暂时无法识别，请稍后重试",
        ) from error


@app.post(
    "/purchase-evaluations/evaluate",
    response_model=PurchaseEvaluationResult,
)
def evaluate_purchase(
    request: PurchaseEvaluationRequest,
    user_id: str = Depends(require_user),
) -> PurchaseEvaluationResult:
    del user_id
    return build_purchase_evaluation(request.product, request.assets)


@app.post(
    "/purchase-evaluations/chat",
    response_model=EvaluationChatResponse,
)
def chat_about_purchase(
    request: EvaluationChatRequest,
    user_id: str = Depends(require_user),
) -> EvaluationChatResponse:
    try:
        message = build_text_ai(get_settings()).continue_evaluation(
            request.product,
            request.matched_assets,
            request.facts,
            request.messages,
            user_id,
        )
        return EvaluationChatResponse(message=message)
    except (RuntimeError, OpenAIError) as error:
        raise HTTPException(
            status_code=503,
            detail="评估对话暂时不可用，请稍后重试",
        ) from error


@app.post("/purchase-evaluations/chat/stream")
def stream_chat_about_purchase(
    request: EvaluationChatRequest,
    user_id: str = Depends(require_user),
) -> StreamingResponse:
    service = build_text_ai(get_settings())

    def event_stream() -> Iterator[str]:
        try:
            for delta in service.continue_evaluation_stream(
                request.product,
                request.matched_assets,
                request.facts,
                request.messages,
                user_id,
            ):
                payload = json.dumps({"delta": delta}, ensure_ascii=False)
                yield f"data: {payload}\n\n"
            yield "data: [DONE]\n\n"
        except (RuntimeError, OpenAIError):
            payload = json.dumps(
                {"error": "评估对话暂时不可用，请稍后重试"},
                ensure_ascii=False,
            )
            yield f"data: {payload}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/sell-plans/recommend", response_model=SellPlanResult)
def recommend_plan(
    request: SellPlanRequest,
    user_id: str = Depends(require_user),
) -> SellPlanResult:
    del user_id
    return recommend_sell_plan(request.target_price, request.assets)
