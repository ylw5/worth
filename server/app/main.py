import json
from functools import lru_cache
from typing import Iterator

import requests
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from openai import OpenAIError
from supabase import Client as SupabaseClient, create_client

from .auth import require_user
from .background_removal import try_remove_background
from .config import get_settings
from .evaluation import build_purchase_evaluation
from .evaluation_tools import create_production_executor
from .market import MarketClient
from .models import (
    AnalyzeRequest,
    AssetInput,
    AssetRecognition,
    CutoutRequest,
    CutoutResponse,
    EvaluationChatMessage,
    EvaluationChatRequest,
    EvaluationChatResponse,
    ParsedProduct,
    ProductImagesRequest,
    ProductParseRequest,
    ProductTextRequest,
    ProductTextResponse,
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


@lru_cache
def get_supabase() -> SupabaseClient:
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_anon_key)


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
        return OpenAIService(get_settings()).analyze(
            request.image_urls,
            user_id,
            request.current_asset,
        )
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except OpenAIError as error:
        raise HTTPException(
            status_code=503,
            detail="图片识别服务暂时不可用，请稍后重试",
        ) from error


@app.post("/cutout", response_model=CutoutResponse)
def cutout(
    request: CutoutRequest,
    _: str = Depends(require_user),
) -> CutoutResponse:
    image = try_remove_background(
        request.image_url,
        get_settings().supabase_url,
    )
    return CutoutResponse(image_base64=image)


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


@app.post("/products/normalize-text", response_model=ProductTextResponse)
def normalize_product_text(
    request: ProductTextRequest,
    user_id: str = Depends(require_user),
) -> ProductTextResponse:
    try:
        interpretation = build_text_ai(get_settings()).interpret_product_text(
            request.text,
            user_id,
        )
        if interpretation.intent == "chat":
            return ProductTextResponse(
                intent="chat",
                reply=interpretation.reply.strip()
                or "你好！想评估某件商品时，可以描述它、粘贴链接或发一张图片。",
            )
        return ProductTextResponse(
            intent="product",
            product=ParsedProduct(
                title=interpretation.normalized_title,
                price=request.price,
                category=interpretation.category,
                subcategory=interpretation.subcategory.strip(),
                source_type="text",
                source_text=request.text.strip(),
            ),
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
    result = build_purchase_evaluation(request.product, request.assets)
    user_message = request.product.source_text.strip() or (
        f"我想买{request.product.title}"
    )
    try:
        settings = get_settings()
        tool_executor = create_production_executor(
            user_id=user_id,
            supabase_client=get_supabase(),
            market_client=MarketClient(settings.xianyu_cookie)
            if settings.xianyu_cookie
            else None,
        )
        opening = build_text_ai(settings).continue_evaluation_with_tools(
            result.product,
            result.matched_assets,
            result.facts,
            [EvaluationChatMessage(role="user", content=user_message)],
            user_id,
            tool_executor,
        )
        if opening.strip():
            result.narrative = opening.strip()
    except (RuntimeError, OpenAIError):
        pass  # AI 不可用时回退到模板化事实叙述
    return result


@app.post(
    "/purchase-evaluations/chat",
    response_model=EvaluationChatResponse,
)
def chat_about_purchase(
    request: EvaluationChatRequest,
    user_id: str = Depends(require_user),
) -> EvaluationChatResponse:
    try:
        settings = get_settings()
        tool_executor = create_production_executor(
            user_id=user_id,
            supabase_client=get_supabase(),
            market_client=MarketClient(settings.xianyu_cookie) if settings.xianyu_cookie else None,
        )
        message = build_text_ai(settings).continue_evaluation_with_tools(
            request.product,
            request.matched_assets,
            request.facts,
            request.messages,
            user_id,
            tool_executor,
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
    settings = get_settings()
    service = build_text_ai(settings)
    tool_executor = create_production_executor(
        user_id=user_id,
        supabase_client=get_supabase(),
        market_client=MarketClient(settings.xianyu_cookie) if settings.xianyu_cookie else None,
    )

    def event_stream() -> Iterator[str]:
        try:
            for delta in service.continue_evaluation_with_tools_stream(
                request.product,
                request.matched_assets,
                request.facts,
                request.messages,
                user_id,
                tool_executor,
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
