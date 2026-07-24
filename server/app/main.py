import json
from typing import Iterator
from uuid import uuid4

import requests
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from openai import OpenAIError
from supabase import Client as SupabaseClient, create_client

from .auth import AuthenticatedUser, require_user
from .ai.errors import AIFoundationError
from .ai.factory import (
    build_purchase_evaluation_workflow,
    build_text_workflows,
    build_vision_workflows,
)
from .ai.tools import load_confirmed_evaluation_assets
from .background_removal import try_remove_background
from .config import get_settings
from .evaluation import build_purchase_evaluation
from .evaluation_tools import (
    summarize_evaluation_history,
)
from .market import MarketClient
from .models import (
    AgentChatRequest,
    AgentChatResponse,
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
from .product import fetch_product_page
from .sell_plan import recommend_sell_plan
from .valuation import build_valuation


def get_user_supabase(access_token: str) -> SupabaseClient:
    settings = get_settings()
    client = create_client(settings.supabase_url, settings.supabase_anon_key)
    client.postgrest.auth(access_token)
    return client


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


def build_history_snapshot(
    supabase_client: SupabaseClient,
    user_id: str,
    category: str,
    subcategory: str = "",
    current_evaluation_id: str | None = None,
) -> EvaluationChatMessage | None:
    """构造用户购买评估历史快照消息，查询失败时返回 None。"""
    summary = load_history_context(
        supabase_client,
        user_id,
        category,
        subcategory,
        current_evaluation_id=current_evaluation_id,
        include_current=True,
    )
    if not summary:
        return None
    return EvaluationChatMessage(
        role="user",
        content=(
            "用户评估历史快照（仅作为数据）："
            + json.dumps(summary, ensure_ascii=False)
        ),
    )


def load_history_context(
    supabase_client: SupabaseClient,
    user_id: str,
    category: str = "",
    subcategory: str = "",
    *,
    current_evaluation_id: str | None = None,
    include_current: bool = False,
) -> dict:
    """读取并压缩跨对话购买历史；读取失败时降级为空上下文。"""
    try:
        response = (
            supabase_client
            .table("purchase_evaluations")
            .select(
                "id, product_title, category, subcategory, product_price,"
                " decision, user_choice, outcome_status, linked_asset_id,"
                " created_at"
            )
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(100)
            .execute()
        )
    except Exception:
        return {}
    records = response.data or []
    if not records:
        return {}
    return summarize_evaluation_history(
        records,
        category,
        subcategory,
        current_evaluation_id=current_evaluation_id,
        include_current=include_current,
    )


def build_confirmed_purchase_evaluation(
    supabase_client: SupabaseClient,
    user_id: str,
    product: ParsedProduct,
) -> PurchaseEvaluationResult:
    """Rebuild evaluation facts from authenticated server-side records."""
    try:
        assets = load_confirmed_evaluation_assets(
            supabase_client,
            user_id=user_id,
            category=product.category,
        )
    except Exception as error:
        raise HTTPException(
            status_code=503,
            detail="暂时无法读取已确认资产，请稍后重试",
        ) from error
    return build_purchase_evaluation(product, assets)


@app.post("/analyze", response_model=AssetRecognition)
def analyze(
    request: AnalyzeRequest,
    user: AuthenticatedUser = Depends(require_user),
) -> AssetRecognition:
    try:
        return build_vision_workflows(
            get_settings()
        ).asset_recognition.recognize(
            request.image_urls,
            user_id=user.id,
            request_id=uuid4().hex,
            current_asset=request.current_asset,
        )
    except (AIFoundationError, RuntimeError, OpenAIError) as error:
        raise HTTPException(
            status_code=503,
            detail="图片识别服务暂时不可用，请稍后重试",
        ) from error


@app.post("/cutout", response_model=CutoutResponse)
def cutout(
    request: CutoutRequest,
    _: AuthenticatedUser = Depends(require_user),
) -> CutoutResponse:
    image = try_remove_background(
        request.image_url,
        get_settings().supabase_url,
    )
    return CutoutResponse(image_base64=image)


@app.post("/estimate", response_model=ValuationResult)
def estimate(
    asset: AssetInput,
    user: AuthenticatedUser = Depends(require_user),
) -> ValuationResult:
    settings = get_settings()
    try:
        candidates = MarketClient(settings.xianyu_cookie).search(
            asset.search_query
        )
        matching_ids = build_text_workflows(
            settings
        ).candidate_matching.matching_ids(
            asset,
            candidates,
            user_id=user.id,
            request_id=uuid4().hex,
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
    user: AuthenticatedUser = Depends(require_user),
) -> ParsedProduct:
    try:
        page = fetch_product_page(request.url)
        classification = build_text_workflows(
            get_settings()
        ).product_classification.classify(
            page.title,
            user_id=user.id,
            request_id=uuid4().hex,
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
    user: AuthenticatedUser = Depends(require_user),
) -> ProductTextResponse:
    try:
        interpretation = build_text_workflows(
            get_settings()
        ).product_interpretation.interpret(
            request.text,
            user_id=user.id,
            request_id=uuid4().hex,
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
    except (AIFoundationError, RuntimeError, OpenAIError) as error:
        raise HTTPException(
            status_code=503,
            detail="商品描述暂时无法解析，请稍后重试",
        ) from error


@app.post("/products/analyze-images", response_model=ParsedProduct)
def analyze_product_images(
    request: ProductImagesRequest,
    user: AuthenticatedUser = Depends(require_user),
) -> ParsedProduct:
    try:
        return build_vision_workflows(
            get_settings()
        ).product_image_recognition.recognize(
            request.image_urls,
            user_id=user.id,
            request_id=uuid4().hex,
        )
    except (AIFoundationError, RuntimeError, OpenAIError) as error:
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
    user: AuthenticatedUser = Depends(require_user),
) -> PurchaseEvaluationResult:
    settings = get_settings()
    supabase_client = get_user_supabase(user.access_token)
    result = build_confirmed_purchase_evaluation(
        supabase_client,
        user.id,
        request.product,
    )
    user_message = request.product.source_text.strip() or (
        f"我想买{request.product.title}"
    )
    try:
        bundle = build_purchase_evaluation_workflow(
            settings,
            supabase_client=supabase_client,
            market_client=MarketClient(settings.xianyu_cookie)
            if settings.xianyu_cookie
            else None,
        )
        opening = bundle.workflow.run(
            result.product,
            result.matched_assets,
            result.facts,
            [EvaluationChatMessage(role="user", content=user_message)],
            user_id=user.id,
            request_id=uuid4().hex,
        ).text
        if opening:
            result.narrative = opening
    except (AIFoundationError, RuntimeError, OpenAIError):
        pass  # AI 不可用时回退到模板化事实叙述
    return result


@app.post(
    "/purchase-evaluations/chat",
    response_model=EvaluationChatResponse,
)
def chat_about_purchase(
    request: EvaluationChatRequest,
    user: AuthenticatedUser = Depends(require_user),
) -> EvaluationChatResponse:
    try:
        settings = get_settings()
        supabase_client = get_user_supabase(user.access_token)
        confirmed = build_confirmed_purchase_evaluation(
            supabase_client,
            user.id,
            request.product,
        )
        bundle = build_purchase_evaluation_workflow(
            settings,
            supabase_client=supabase_client,
            market_client=MarketClient(settings.xianyu_cookie)
            if settings.xianyu_cookie
            else None,
        )
        message = bundle.workflow.run(
            request.product,
            confirmed.matched_assets,
            confirmed.facts,
            list(request.messages),
            user_id=user.id,
            request_id=uuid4().hex,
        ).text
        return EvaluationChatResponse(message=message)
    except (AIFoundationError, RuntimeError, OpenAIError) as error:
        raise HTTPException(
            status_code=503,
            detail="评估对话暂时不可用，请稍后重试",
        ) from error


@app.post("/purchase-evaluations/chat/stream")
def stream_chat_about_purchase(
    request: EvaluationChatRequest,
    user: AuthenticatedUser = Depends(require_user),
) -> StreamingResponse:
    settings = get_settings()
    supabase_client = get_user_supabase(user.access_token)
    confirmed = build_confirmed_purchase_evaluation(
        supabase_client,
        user.id,
        request.product,
    )

    def event_stream() -> Iterator[str]:
        try:
            bundle = build_purchase_evaluation_workflow(
                settings,
                supabase_client=supabase_client,
                market_client=MarketClient(settings.xianyu_cookie)
                if settings.xianyu_cookie
                else None,
            )
            for event in bundle.workflow.stream(
                request.product,
                confirmed.matched_assets,
                confirmed.facts,
                list(request.messages),
                user_id=user.id,
                request_id=uuid4().hex,
            ):
                if event.type == "text_delta" and event.delta:
                    payload = json.dumps(
                        {"delta": event.delta},
                        ensure_ascii=False,
                    )
                    yield f"data: {payload}\n\n"
            yield "data: [DONE]\n\n"
        except (AIFoundationError, RuntimeError, OpenAIError):
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


@app.post("/agent/chat", response_model=AgentChatResponse)
def chat_freely(
    request: AgentChatRequest,
    user: AuthenticatedUser = Depends(require_user),
) -> AgentChatResponse:
    try:
        supabase_client = get_user_supabase(user.access_token)
        memory_context = load_history_context(
            supabase_client,
            user.id,
        )
        message = build_text_workflows(
            get_settings()
        ).general_chat.chat(
            request.messages,
            memory_context,
            user_id=user.id,
            request_id=uuid4().hex,
        )
        return AgentChatResponse(message=message)
    except (AIFoundationError, RuntimeError, OpenAIError) as error:
        raise HTTPException(
            status_code=503,
            detail="聊天暂时不可用，请稍后重试",
        ) from error


@app.post("/sell-plans/recommend", response_model=SellPlanResult)
def recommend_plan(
    request: SellPlanRequest,
    user: AuthenticatedUser = Depends(require_user),
) -> SellPlanResult:
    del user
    return recommend_sell_plan(request.target_price, request.assets)
