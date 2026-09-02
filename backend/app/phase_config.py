"""各階段截止日期：以台灣時區判斷，截止日當天仍可填，隔天起關閉。"""
from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from .models import Setting

TAIPEI = ZoneInfo("Asia/Taipei")
PHASE1_KEY = "phase1_deadline"
PHASE2_KEY = "phase2_deadline"


def get_setting(db: Session, key: str) -> str:
    row = db.get(Setting, key)
    return row.value if row else ""


def set_setting(db: Session, key: str, value: str) -> None:
    row = db.get(Setting, key)
    if row:
        row.value = value
    else:
        db.add(Setting(key=key, value=value))


def is_open(deadline_str: str) -> bool:
    """空值 = 不設限。日期格式錯誤視為不設限（避免鎖死表單）。"""
    if not deadline_str:
        return True
    try:
        deadline = date.fromisoformat(deadline_str)
    except ValueError:
        return True
    return datetime.now(TAIPEI).date() <= deadline


def build_config(db: Session) -> dict:
    p1 = get_setting(db, PHASE1_KEY)
    p2 = get_setting(db, PHASE2_KEY)
    return {
        "phase1_deadline": p1,
        "phase2_deadline": p2,
        "phase1_open": is_open(p1),
        "phase2_open": is_open(p2),
    }
