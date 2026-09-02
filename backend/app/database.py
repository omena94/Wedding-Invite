"""資料庫連線（SQLAlchemy 2.0，同步版，簡單穩定）。"""
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,   # 連線失效自動重連
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    """FastAPI 依賴注入：每個請求一個 session。"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """啟動時自動建立資料表（若不存在）。"""
    from . import models  # noqa: F401  確保 model 被載入
    Base.metadata.create_all(bind=engine)
