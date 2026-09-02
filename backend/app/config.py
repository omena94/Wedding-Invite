"""應用程式設定：從 .env 讀取，全部有預設值，方便非工程師快速上手。"""
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/ 目錄
BASE_DIR = Path(__file__).resolve().parent.parent
# 前端打包輸出目錄（npm run build 後產生）
FRONTEND_DIST = BASE_DIR.parent / "frontend" / "dist"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "postgresql+pg8000://postgres:postgres@localhost:5432/wedding"
    redis_url: str = "redis://localhost:6379/0"
    admin_password: str = "change-me"
    secret_key: str = "change-me-to-a-long-random-string"
    port: int = 8000
    # Telegram 通知（留空 = 不啟用）
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""


settings = Settings()
