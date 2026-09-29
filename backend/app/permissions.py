"""角色權限（2026-09-27）：登入方式不變（新人密碼／幫手密碼），但每個角色能用哪些功能改由後台設定頁編輯。

設定存在 settings 表的 role_permissions（JSON：{"couple": [...], "helper": [...]}），沒設定就用預設值：
新人全部、幫手只有名單／座位圖看／喜餅簽收。新人一定保留「設定」，不然把自己鎖在外面就回不來了。
每個 API 依功能對應一把鑰匙（PERMISSIONS 的 key），幫手要用某功能，就在設定頁勾給他。
"""
import json

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from .database import get_db
from .security import ROLE_COUPLE, _decode
from .stage import get_setting

PERMISSION_KEY = "role_permissions"

# (key, 說明)；順序就是設定頁的順序
PERMISSIONS = [
    ("guests_view", "婚宴：看賓客名單、統計、匯出 Excel"),
    ("guests_edit", "婚宴：編輯與刪除賓客"),
    ("guests_create", "婚宴：手動新增賓客"),
    ("broadcast", "婚宴：群發 Email"),
    ("menu", "婚宴：菜單（跟飯店討論中的菜色）"),
    ("seating_view", "座位圖：看正式廳的座位、預覽賓客畫面（帶位用）"),
    ("seating_edit", "座位圖：擺桌椅、安排座位、廳設定"),
    ("gifts_view", "喜餅：看送餅名單"),
    ("gifts_pickup", "喜餅：勾簽收確認（分批、代領）"),
    ("gifts_manage", "喜餅：帶入賓客、編輯送餅對象、廠商、款式、訂購與費用、匯出"),
    ("budget", "花費（含婚宴預估）"),
    ("calendar", "行事曆"),
    ("notes", "筆記"),
    ("program", "活動環節"),
    ("files", "文件庫"),
    ("photos", "婚紗照"),
    ("guest_photos", "當天照片（賓客上傳的原檔：看、下載、刪除、開關）"),
    ("wall", "現場留言：大螢幕播放、留言管理、歌單"),
    ("settings", "設定（含這張權限表）"),
]
ALL = [k for k, _ in PERMISSIONS]
LABEL = dict(PERMISSIONS)
DEFAULT_HELPER = ["guests_view", "guests_edit", "seating_view", "gifts_view", "gifts_pickup"]
COUPLE_LOCKED = {"settings"}  # 新人拿不掉的


def default_permissions() -> dict[str, list[str]]:
    return {"couple": list(ALL), "helper": list(DEFAULT_HELPER)}


def load_permissions(db: Session) -> dict[str, list[str]]:
    """讀設定；壞掉或沒設就用預設。回傳的 couple 一定含鎖定的鑰匙。"""
    data = default_permissions()
    raw = get_setting(db, PERMISSION_KEY)
    if raw:
        try:
            saved = json.loads(raw)
            for role in ("couple", "helper"):
                if isinstance(saved.get(role), list):
                    data[role] = [k for k in saved[role] if k in ALL]
            # 存檔之後才新增的功能鑰匙，預設給新人（不然新功能上線新人自己會看不到）
            known = set(saved.get("known") or (list(saved.get("couple") or []) + list(saved.get("helper") or [])))
            for k in ALL:
                if k not in known and k not in data["couple"]:
                    data["couple"].append(k)
        except (ValueError, AttributeError, TypeError):
            pass
    for k in COUPLE_LOCKED:
        if k not in data["couple"]:
            data["couple"].append(k)
    return data


def role_permissions(db: Session, role: str) -> set[str]:
    return set(load_permissions(db).get(role, []))


def has_perm(db: Session, role: str, key: str) -> bool:
    return key in role_permissions(db, role)


def require_perm(*keys: str):
    """FastAPI 依賴：有其中任何一把鑰匙就放行，回傳角色。"""
    def dep(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> str:
        role = _decode(authorization)["role"]
        allowed = role_permissions(db, role)
        if not any(k in allowed for k in keys):
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"沒有「{LABEL.get(keys[0], keys[0])}」的權限，請新人到設定頁開放")
        return role
    return dep


# /api/planner 底下的路徑對應到哪把鑰匙（沒列到的一律只給新人）
PLANNER_PATH_KEYS = [
    ("settings", ("settings",)),
    ("menu", ("menu",)),
    ("expenses", ("budget",)),
    ("payments", ("budget",)),
    ("banquet", ("budget",)),
    ("categories", ("budget",)),
    ("tasks", ("calendar",)),
    ("topics", ("calendar", "notes")),
    ("memos", ("notes",)),
    ("program", ("program",)),
    ("files", ("files", "budget")),  # 花費頁也會附報價／收據
    ("vendors", ("gifts_manage", "budget")),
    ("quotes", ("gifts_manage", "budget")),
    ("compare", ("gifts_manage", "budget")),
]


def planner_path_perm(request: Request, authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> str:
    """/api/planner/* 共用：依路徑的第一段決定要哪把鑰匙。"""
    role = _decode(authorization)["role"]
    rest = request.url.path.split("/api/planner/", 1)[-1]
    first = rest.split("/", 1)[0]
    keys = next((ks for prefix, ks in PLANNER_PATH_KEYS if first == prefix), None)
    if keys is None:
        if role != ROLE_COUPLE:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "此功能僅限新人使用")
        return role
    allowed = role_permissions(db, role)
    if not any(k in allowed for k in keys):
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"沒有「{LABEL[keys[0]]}」的權限，請新人到設定頁開放")
    return role


PlannerPerm = Depends(planner_path_perm)
