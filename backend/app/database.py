"""資料庫連線（SQLAlchemy 2.0，同步版，簡單穩定）。"""
import logging
from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings

log = logging.getLogger("database")

_connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,   # 連線失效自動重連
    future=True,
    connect_args=_connect_args,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

# 多個 uvicorn worker 同時啟動時，用這把 advisory lock 排隊建表，避免兩個 worker 同時 CREATE 撞在一起
_INIT_LOCK_ID = 727001


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
    """啟動時自動建立資料表（若不存在），並套用少量不會破壞資料的欄位調整。"""
    from . import models  # noqa: F401  確保 model 被載入

    if engine.dialect.name != "postgresql":
        Base.metadata.create_all(bind=engine)
        return

    with engine.connect() as conn:
        conn.execute(text(f"SELECT pg_advisory_lock({_INIT_LOCK_ID})"))
        conn.commit()
        try:
            Base.metadata.create_all(bind=conn)
            conn.commit()
            # 舊版 settings.value 是 VARCHAR(200)，婚禮資訊文案會超過，放寬成 TEXT
            try:
                conn.execute(text("ALTER TABLE settings ALTER COLUMN value TYPE TEXT"))
                conn.commit()
            except Exception as e:  # pragma: no cover
                conn.rollback()
                log.warning("settings.value 型別調整略過：%s", e)
        finally:
            conn.execute(text(f"SELECT pg_advisory_unlock({_INIT_LOCK_ID})"))
            conn.commit()
