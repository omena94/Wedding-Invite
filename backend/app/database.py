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
        _after_create()
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
                # 2026-09-23 當天給賓客的一段話
                "ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS personal_note TEXT NOT NULL DEFAULT ''",
                # 2026-09-10 座位圖分「廳」：桌椅與座位指定都掛在某一廳底下，同一個人在不同廳可以各有位子
                # 2026-09-11 廳記住是哪個範本載入的
                "ALTER TABLE seat_halls ADD COLUMN IF NOT EXISTS preset_key VARCHAR(30) NOT NULL DEFAULT ''",
                # 2026-09-10 花費項目加整筆的應付款日期
                "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS due_date DATE",
                "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS pay_method VARCHAR(30) NOT NULL DEFAULT ''",
                # 2026-09-10 籌備進度改為行事曆、備忘改為筆記
                "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS topic VARCHAR(50) NOT NULL DEFAULT ''",
                "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_time VARCHAR(5) NOT NULL DEFAULT ''",
                "ALTER TABLE memos ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE",
                # 2026-09-10 後台移除廠商：喜餅訂購不再必填廠商
                "ALTER TABLE gift_orders ALTER COLUMN vendor_id DROP NOT NULL",
                "ALTER TABLE seat_objects ADD COLUMN IF NOT EXISTS hall_id INTEGER REFERENCES seat_halls(id) ON DELETE CASCADE",
                "CREATE INDEX IF NOT EXISTS ix_seat_objects_hall_id ON seat_objects (hall_id)",
                "ALTER TABLE seat_assignments ADD COLUMN IF NOT EXISTS hall_id INTEGER REFERENCES seat_halls(id) ON DELETE CASCADE",
                "CREATE INDEX IF NOT EXISTS ix_seat_assignments_hall_id ON seat_assignments (hall_id)",
                "ALTER TABLE seat_assignments DROP CONSTRAINT IF EXISTS uq_seat_person",
                """DO $$ BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_seat_person_hall') THEN
                        ALTER TABLE seat_assignments ADD CONSTRAINT uq_seat_person_hall UNIQUE (hall_id, rsvp_id, person_no);
                    END IF;
                END $$""",
            ):
                try:
                    conn.execute(text(sql))
                    conn.commit()
                except Exception as e:  # pragma: no cover
                    conn.rollback()
                    log.warning("欄位調整略過（%s）：%s", sql, e)
            _after_create()
        finally:
            conn.execute(text(f"SELECT pg_advisory_unlock({_INIT_LOCK_ID})"))
            conn.commit()


def _after_create() -> None:
    """建表／改欄位之後要補的資料：舊的桌椅還沒分廳的話，全部歸到第一廳。"""
    from .seating import ensure_halls

    db = SessionLocal()
    try:
        ensure_halls(db)
    except Exception as e:  # pragma: no cover
        db.rollback()
        log.warning("座位圖分廳補資料失敗：%s", e)
    finally:
        db.close()
