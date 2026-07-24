import hashlib
import json

from openai import OpenAI

from .config import Settings
from .models import (
    AIAssetRecognition,
    AssetInput,
    AssetRecognition,
    CandidateMatches,
    MarketCandidate,
)


class OpenAIService:
    def __init__(self, settings: Settings):
        if not settings.ai_gateway_api_key:
            raise RuntimeError("Vercel AI Gateway is not configured")
        self.client = OpenAI(
            api_key=settings.ai_gateway_api_key,
            base_url="https://ai-gateway.vercel.sh/v1",
        )
        self.model = settings.openai_model

    def analyze(
        self, image_urls: list[str], user_id: str
    ) -> AssetRecognition:
        images = [
            {
                "type": "input_image",
                "image_url": image_url,
                "detail": "auto",
            }
            for image_url in image_urls
        ]
        response = self.client.responses.parse(
            model=self.model,
            reasoning={"effort": "low"},
            safety_identifier=hashlib.sha256(user_id.encode()).hexdigest(),
            input=[
                {
                    "role": "system",
                    "content": (
                        "识别照片中的单件实体资产，返回简洁、可编辑的中文信息。"
                        "不要猜测照片中看不出的规格；不确定时留空。"
                        "分类只能使用给定枚举。search_query 只保留品牌、型号和关键规格。"
                        "成色只能使用给定枚举，只根据照片可见外观判断；"
                        "仅凭外观不得判断为全新未使用，证据不足时选择无法判断。"
                    ),
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": "这些照片是同一件资产，请合并识别。",
                        },
                        *images,
                    ],
                },
            ],
            text_format=AIAssetRecognition,
        )
        if not response.output_parsed:
            raise RuntimeError("Image recognition returned no result")
        parsed = response.output_parsed
        return AssetRecognition(
            **parsed.model_dump(exclude={"specs"}),
            specs={spec.name: spec.value for spec in parsed.specs},
        )

    def matching_ids(
        self,
        asset: AssetInput,
        candidates: list[MarketCandidate],
        user_id: str,
    ) -> set[str]:
        response = self.client.responses.parse(
            model=self.model,
            reasoning={"effort": "low"},
            safety_identifier=hashlib.sha256(user_id.encode()).hexdigest(),
            input=[
                {
                    "role": "system",
                    "content": (
                        "判断每个在售候选是否与目标资产是同一产品和关键规格。"
                        "配件、广告、其他型号或关键规格不同必须标记为 false。"
                        "为每个候选返回一次决定。"
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "asset": asset.model_dump(),
                            "candidates": [
                                item.model_dump() for item in candidates
                            ],
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
            text_format=CandidateMatches,
        )
        if not response.output_parsed:
            raise RuntimeError("Candidate filtering returned no result")
        return {
            item.item_id
            for item in response.output_parsed.decisions
            if item.same_product
        }
