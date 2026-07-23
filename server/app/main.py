from fastapi import Depends, FastAPI, HTTPException

from .auth import require_user
from .config import get_settings
from .market import MarketClient
from .models import AnalyzeRequest, AssetInput, AssetRecognition, ValuationResult
from .openai_service import OpenAIService
from .valuation import build_valuation


app = FastAPI(title="Worth API")


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
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


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
        matching_ids = OpenAIService(settings).matching_ids(
            asset, candidates, user_id
        )
        return build_valuation(asset.search_query, candidates, matching_ids)
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
