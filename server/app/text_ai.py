from __future__ import annotations

from typing import Iterator, Protocol

from .config import Settings
from .deepseek_service import DeepSeekService
from .models import (
    AIProductClassification,
    AssetInput,
    EvaluationAsset,
    EvaluationChatMessage,
    EvaluationFacts,
    MarketCandidate,
    ParsedProduct,
)
from .openai_service import OpenAIService


class TextAIService(Protocol):
    def classify_product(
        self,
        title: str,
        user_id: str,
    ) -> AIProductClassification: ...

    def matching_ids(
        self,
        asset: AssetInput,
        candidates: list[MarketCandidate],
        user_id: str,
    ) -> set[str]: ...

    def continue_evaluation(
        self,
        product: ParsedProduct,
        matched_assets: list[EvaluationAsset],
        facts: EvaluationFacts,
        messages: list[EvaluationChatMessage],
        user_id: str,
    ) -> str: ...

    def continue_evaluation_stream(
        self,
        product: ParsedProduct,
        matched_assets: list[EvaluationAsset],
        facts: EvaluationFacts,
        messages: list[EvaluationChatMessage],
        user_id: str,
    ) -> Iterator[str]: ...


def build_text_ai(settings: Settings) -> TextAIService:
    if settings.deepseek_api_key:
        return DeepSeekService(settings)
    return OpenAIService(settings)
