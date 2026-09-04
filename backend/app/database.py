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
            # 既有資料表的小幅欄位調整（create_all 不會改已存在的表）。每一句都可重複執行。
            for sql in (
                "ALTER TABLE settings ALTER COLUMN value TYPE TEXT",
                "ALTER TABLE files ADD COLUMN IF NOT EXISTS caption VARCHAR(200) NOT NULL DEFAULT ''",
                "ALTER TABLE files ADD COLUMN IF NOT EXISTS album VARCHAR(50) NOT NULL DEFAULT ''",
                "ALTER TABLE files ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE files ADD COLUMN IF NOT EXISTS thumb_name VARCHAR(80) NOT NULL DEFAULT ''",
                "ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS children_json TEXT NOT NULL DEFAULT '[]'",
            ):
                try:
                    conn.execute(text(sql))
                    conn.commit()
                except Exception as e:  # pragma: no cover
                    conn.rollback()
                    log.warning("欄位調整略過（%s）：%s", sql, e)
        finally:
            conn.execute(text(f"SELECT pg_advisory_unlock({_INIT_LOCK_ID})"))
            conn.commit()
