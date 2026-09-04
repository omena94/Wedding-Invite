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
    # 新人（完整權限）密碼
    admin_password: str = "change-me"
    # 幫手密碼（招待、伴郎伴娘）：只能看賓客名單與報到，看不到預算與合約。留空 = 不啟用
    helper_password: str = ""
    secret_key: str = "change-me-to-a-long-random-string"
    port: int = 8000
    # Telegram 通知（留空 = 不啟用）
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""
    # Gmail 寄信（後台群發通知用；smtp_password 是 Gmail「應用程式密碼」）
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from_name: str = "宣文 & 孟庭"
    # 上傳檔案（合約、收據、婚紗照）存放目錄。留空 = backend/uploads（不在 Git 裡）
    upload_dir: str = ""
    max_upload_mb: int = 20

    @property
    def upload_path(self) -> Path:
        p = Path(self.upload_dir) if self.upload_dir else BASE_DIR / "uploads"
        p.mkdir(parents=True, exist_ok=True)
        return p


settings = Settings()
