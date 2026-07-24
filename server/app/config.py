from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("../.env.local", ".env"),
        extra="ignore",
    )

    ai_gateway_api_key: str = ""
    openai_model: str = "openai/gpt-5.4"
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-v4-flash"
    supabase_url: str = ""
    supabase_anon_key: str = ""
    xianyu_cookie: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
