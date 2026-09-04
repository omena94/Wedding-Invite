"""系統設定的讀寫，以及「目前階段」的判斷。

設定全部存在 settings 表（key-value）：
  phase2_open_at   第二階段開放時間（ISO 8601，例如 2026-10-01T09:00:00+08:00）。空 = 尚未開放
  seat_open        婚禮當天桌次查詢是否開放（"1" / ""）
  photos_open      婚紗照分享頁是否開放（"1" / ""）
  info_*           婚禮資訊頁的文案（見 INFO_KEYS）
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from .models import Setting

TAIPEI = timezone(timedelta(hours=8))

PHASE2_KEY = "phase2_open_at"
SEAT_KEY = "seat_open"
PHOTOS_KEY = "photos_open"
INFO_KEYS = (
    "info_schedule",     # 當天流程（多行）
    "info_transport",    # 交通方式（多行）
    "info_dress_code",   # 服裝建議
    "info_notes",        # 其他提醒（多行）
    "info_contact",      # 當天聯絡窗口
)
ALL_KEYS = (PHASE2_KEY, SEAT_KEY, PHOTOS_KEY, *INFO_KEYS)


def get_setting(db: Session, key: str) -> str:
    row = db.get(Setting, key)
    return row.value if row else ""


def set_setting(db: Session, key: str, value: str) -> None:
    row = db.get(Setting, key)
    if row:
        row.value = value
    else:
        db.add(Setting(key=key, value=value))


def get_all(db: Session) -> dict[str, str]:
    data = {k: "" for k in ALL_KEYS}
    for row in db.query(Setting).all():
        if row.key in data:
            data[row.key] = row.value or ""
    return data


def parse_dt(value: str) -> datetime | None:
    """解析 ISO 時間字串；沒有時區的視為台灣時間。格式錯誤回傳 None。"""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.strip())
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TAIPEI)
    return dt


def phase2_open_at(db: Session) -> datetime | None:
    return parse_dt(get_setting(db, PHASE2_KEY))


def is_phase2_open(db: Session) -> bool:
    dt = phase2_open_at(db)
    return dt is not None and datetime.now(timezone.utc) >= dt


def is_on(db: Session, key: str) -> bool:
    return get_setting(db, key).strip() in ("1", "true", "on", "yes")


def public_stage(db: Session) -> dict:
    """給賓客端首頁 / 各頁面判斷要顯示什麼。"""
    dt = phase2_open_at(db)
    return {
        "phase2_open": is_phase2_open(db),
        "phase2_open_at": dt.astimezone(TAIPEI).isoformat() if dt else "",
        "seat_open": is_on(db, SEAT_KEY),
        "photos_open": is_on(db, PHOTOS_KEY),
    }
