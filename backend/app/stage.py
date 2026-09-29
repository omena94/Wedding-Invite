"""系統設定的讀寫，以及「目前階段」的判斷。

設定全部存在 settings 表（key-value）：
  phase2_open_at   第二階段開放時間（ISO 8601，例如 2026-10-01T09:00:00+08:00）。空 = 尚未開放
  seat_open        婚禮當天桌次查詢是否開放（"1" / ""）
  photos_open      婚紗照分享頁是否開放（"1" / ""）
  guest_upload_open 婚禮當天賓客上傳照片（/upload）是否開放
  wall_open        婚禮當天現場留言（/wish）是否開放；大螢幕（/wall）要登入，不看這個開關
  wall_moderation  現場留言先審核：開著時新留言是 pending，新人按「通過」才會上大螢幕
  info_*         婚禮資訊頁的文案（見 INFO_KEYS）
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
# 婚宴費用預估的參數（後台可改）
BANQUET_KEYS = (
    "banquet_adult_price",       # 大人每位（未含服務費）
    "banquet_service_pct",       # 服務費 %
    "banquet_child_mode",        # 沒填身高的小孩：free 免費 / half 半價 / full 全價 / custom 自訂
    "banquet_child_price",       # child_mode=custom 時每位小孩的價格（未含服務費）
    "banquet_child_free_below",  # 身高低於此（公分）免費
    "banquet_child_half_below",  # 身高低於此半價，以上全價
    "banquet_child_free_count",  # child_mode=manual：新人手動填「110 以下」免費人數
    "banquet_child_half_count",  # child_mode=manual：手動填「130 以下」半價人數；其餘小孩全價
    "banquet_veg_price",         # 素食每位（未含服務費）；0 = 跟大人一樣
    "banquet_contract_amount",   # 簽約金額；0 = 還沒簽約，婚宴花費的合約金額照人數預估
)
BANQUET_EXPENSE_KEY = "banquet_expense_id"  # 跟婚宴預估綁在一起的那筆花費（2026-09-10）
BANQUET_DEFAULTS = {
    "banquet_adult_price": "3980",
    "banquet_service_pct": "10",
    "banquet_child_mode": "half",
    "banquet_child_price": "0",
    "banquet_child_free_below": "90",
    "banquet_child_half_below": "120",
    "banquet_child_free_count": "0",
    "banquet_child_half_count": "0",
    "banquet_veg_price": "0",
    "banquet_contract_amount": "0",
}
SEATING_KEYS = ("seating_canvas_w", "seating_canvas_h", "seating_clearance")
# 群發 Email 的草稿（2026-09-11 新人要求改過的內容要留著）：主旨、內文 HTML、寄送對象、測試信箱
BROADCAST_KEYS = ("broadcast_subject", "broadcast_body", "broadcast_target", "broadcast_test_to")
GUEST_UPLOAD_KEY = "guest_upload_open"  # 2026-09-27 婚禮當天賓客上傳照片（/upload）
WALL_OPEN_KEY = "wall_open"  # 婚禮當天現場留言（/wish），留言會上會場大螢幕
WALL_MODERATION_KEY = "wall_moderation"  # 現場留言要不要先審核
# 2026-09-28 新人可以在後台把不喜歡的大螢幕版面關掉（逗號分隔的版面名稱，例如 "aurora,disco"）
WALL_PLATES_OFF_KEY = "wall_plates_off"
# 2026-09-28 大螢幕換版面的節奏：fast／normal（預設，空字串也是）／slow
WALL_PACE_KEY = "wall_pace"
PERMISSION_KEY = "role_permissions"  # 2026-09-27 各角色能用的功能（JSON），見 permissions.py
ALL_KEYS = (PHASE2_KEY, SEAT_KEY, PHOTOS_KEY, GUEST_UPLOAD_KEY, WALL_OPEN_KEY, WALL_MODERATION_KEY, WALL_PLATES_OFF_KEY, WALL_PACE_KEY, *INFO_KEYS, *BANQUET_KEYS, *SEATING_KEYS, *BROADCAST_KEYS, PERMISSION_KEY)


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


def _to_int(value: str, default: int) -> int:
    try:
        return max(0, int(float(str(value).strip())))
    except (TypeError, ValueError):
        return default


def banquet_params(db: Session) -> dict:
    """婚宴費用參數（含預設值）。"""
    raw = get_all(db)
    mode = (raw.get("banquet_child_mode") or BANQUET_DEFAULTS["banquet_child_mode"]).strip()
    if mode not in ("free", "half", "full", "custom", "manual"):
        mode = "half"
    free_below = _to_int(raw.get("banquet_child_free_below"), 90)
    half_below = max(free_below, _to_int(raw.get("banquet_child_half_below"), 120))
    return {
        "adult_price": _to_int(raw.get("banquet_adult_price"), 3980),
        "service_pct": _to_int(raw.get("banquet_service_pct"), 10),
        "child_mode": mode,
        "child_price": _to_int(raw.get("banquet_child_price"), 0),
        "child_free_below": free_below,
        "child_half_below": half_below,
        "child_free_count": _to_int(raw.get("banquet_child_free_count"), 0),
        "child_half_count": _to_int(raw.get("banquet_child_half_count"), 0),
        # 素食主餐通常另有價位；0 表示跟大人一樣（不另計）
        "veg_price": _to_int(raw.get("banquet_veg_price"), 0),
        # 簽約後填的實際金額；0 = 還沒簽約，用預估
        "contract_amount": _to_int(raw.get("banquet_contract_amount"), 0),
    }


def child_unit_price(params: dict, mode: str | None = None) -> int:
    """某種計價方式下一個小孩多少錢（未含服務費）。"""
    mode = mode or params["child_mode"]
    if mode == "free":
        return 0
    if mode == "half":
        return round(params["adult_price"] / 2)
    if mode == "full":
        return params["adult_price"]
    return params["child_price"]


def child_bracket(params: dict, child: dict) -> str | None:
    """一個小孩該算哪一級：後台手動指定優先，其次依身高；沒填身高回傳 None。"""
    pricing = child.get("pricing", "auto")
    if pricing in ("free", "half", "full"):
        return pricing
    # 2026-09-08 新人要求：選「自訂金額」時所有小孩都用同一價（個別指定的除外），不再看身高
    if params.get("child_mode") == "custom":
        return "custom"
    h = child.get("height")
    if h is None:
        return None
    if h < params["child_free_below"]:
        return "free"
    if h < params["child_half_below"]:
        return "half"
    return "full"


def veg_unit_price(params: dict) -> int:
    """素食每位多少錢（未含服務費）：沒設定就跟大人一樣。"""
    return params.get("veg_price") or params["adult_price"]


def banquet_estimate(params: dict, adults: int, children: list[dict], unknown_mode: str | None = None, veg_adults: int = 0) -> dict:
    """大人 × 單價 + 素食大人 × 素食單價 + 每個小孩依身高分級 + 服務費。
    沒填身高的小孩用 unknown_mode（預設是設定裡的 child_mode）。
    veg_adults 是大人裡選素食主餐的人數（小孩吃兒童餐，不算素食價）。"""
    unknown_mode = unknown_mode or params["child_mode"]
    veg_adults = max(0, min(int(veg_adults or 0), adults))
    regular_adults = adults - veg_adults
    counts = {"free": 0, "half": 0, "full": 0, "custom": 0, "unknown": 0}
    child_subtotal = 0
    for c in children:
        b = child_bracket(params, c)
        if b is None:
            counts["unknown"] += 1
            child_subtotal += child_unit_price(params, unknown_mode)
        else:
            counts[b] += 1
            child_subtotal += child_unit_price(params, b)
    # 2026-09-08 新人要求：手動填人數模式。110 以下免費、130 以下半價，其餘全價；人數不看賓客填的身高
    if params.get("child_mode") == "manual":
        n = len(children)
        free = min(max(0, int(params.get("child_free_count", 0))), n)
        half = min(max(0, int(params.get("child_half_count", 0))), n - free)
        counts = {"free": free, "half": half, "full": n - free - half, "custom": 0, "unknown": 0}
        child_subtotal = half * child_unit_price(params, "half") + counts["full"] * child_unit_price(params, "full")
    veg_unit = veg_unit_price(params)
    regular_subtotal = regular_adults * params["adult_price"]
    veg_subtotal = veg_adults * veg_unit
    adult_subtotal = regular_subtotal + veg_subtotal
    food = adult_subtotal + child_subtotal
    service = round(food * params["service_pct"] / 100)
    return {
        "adult_subtotal": adult_subtotal,
        "regular_adults": regular_adults,
        "regular_subtotal": regular_subtotal,
        "veg_adults": veg_adults,
        "veg_unit_price": veg_unit,
        "veg_subtotal": veg_subtotal,
        "child_subtotal": child_subtotal,
        "child_counts": counts,
        "child_prices": {m: child_unit_price(params, m) for m in ("free", "half", "full", "custom")},
        "unknown_unit_price": child_unit_price(params, unknown_mode),
        "food_subtotal": food,
        "service": service,
        "total": food + service,
    }


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


def public_stage(db: Session, preview: bool = False) -> dict:
    """給賓客端首頁 / 各頁面判斷要顯示什麼。
    preview=True 表示這個請求帶著後台登入：頁面照樣拿到真實的開放狀態，
    但前端會讓登入者在未開放時也能進去看（畫面上標示預覽模式）。"""
    dt = phase2_open_at(db)
    bp = banquet_params(db)
    return {
        "preview": preview,
        "phase2_open": is_phase2_open(db),
        "phase2_open_at": dt.astimezone(TAIPEI).isoformat() if dt else "",
        "seat_open": is_on(db, SEAT_KEY),
        "photos_open": is_on(db, PHOTOS_KEY),
        "guest_upload_open": is_on(db, GUEST_UPLOAD_KEY),
        "wall_open": is_on(db, WALL_OPEN_KEY),
        # 第二階段表單提示用：飯店依身高計費的門檻
        "child_free_below": bp["child_free_below"],
        "child_half_below": bp["child_half_below"],
    }
