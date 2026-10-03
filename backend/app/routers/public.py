"""賓客端公開 API：目前階段、婚禮資訊、桌次查詢、婚紗照。"""
import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..config import settings
from ..contacts import normalize_phone, phone_column


def phone_column_matches(stored: str, wanted: str) -> bool:
    return bool(wanted) and normalize_phone(stored or "") == wanted
from ..database import get_db
from ..models import FileAsset, Rsvp
from ..schemas import SeatLookupIn, SeatLookupOut
from ..seating import guest_seat_view
from ..security import optional_staff
from ..stage import INFO_KEYS, PHOTOS_KEY, SEAT_KEY, get_all, guest_hidden_albums, is_on, public_stage

router = APIRouter(prefix="/api", tags=["public"])


@router.get("/stage")
def get_stage(db: Session = Depends(get_db), role: str | None = Depends(optional_staff)):
    """首頁 / 各頁面載入時查詢：第二階段開了沒、桌次查詢開了沒…（有登入後台會多一個 preview=True）"""
    return public_stage(db, preview=role is not None)


@router.get("/info")
def get_info(db: Session = Depends(get_db), role: str | None = Depends(optional_staff)):
    """婚禮資訊頁的文案（由籌備後台編輯）。"""
    data = get_all(db)
    return {**{k: data.get(k, "") for k in INFO_KEYS}, **public_stage(db, preview=role is not None)}


@router.post("/seat/lookup", response_model=SeatLookupOut)
def seat_lookup(payload: SeatLookupIn, db: Session = Depends(get_db), role: str | None = Depends(optional_staff)):
    """婚禮當天：輸入姓名或電話查桌號。後台登入者不受開關限制（預覽）。"""
    if not is_on(db, SEAT_KEY) and role is None:
        raise HTTPException(403, "桌次查詢尚未開放，婚禮當天再來查詢喔")
    q = payload.query.strip()
    conds = [func.lower(Rsvp.name) == q.lower()]
    phone = normalize_phone(q)
    by_phone = bool(re.fullmatch(r"09\d{8}", phone))
    by_email = "@" in q
    if by_phone:
        conds.append(phone_column(Rsvp.phone) == phone)
    if by_email:
        conds.append(func.lower(Rsvp.email) == q.lower())  # 2026-09-23 起 Email 也能查（留言要用電話或 Email 才看得到）
    stmt = (
        select(Rsvp)
        .where(Rsvp.is_test.is_(False), Rsvp.attending.is_(True), or_(*conds))
        .order_by(Rsvp.created_at.desc())
    )
    if payload.phone.strip():
        stmt = stmt.where(phone_column(Rsvp.phone) == normalize_phone(payload.phone))
    rows = db.scalars(stmt.limit(2)).all()
    if len(rows) > 1:
        return SeatLookupOut(found=False, needs_phone=True)
    row = rows[0] if rows else None
    if not row:
        return SeatLookupOut(found=False)
    view = guest_seat_view(db, row)
    # 新人留給這一戶的話：姓名誰都猜得到，所以要用電話（查詢欄或同名時補的電話）或 Email 對上才給
    verified = (by_phone and phone_column_matches(row.phone, phone)) or (by_email and (row.email or "").lower() == q.lower()) \
        or (payload.phone.strip() != "" and phone_column_matches(row.phone, normalize_phone(payload.phone)))
    note = (row.personal_note or "").strip()
    return SeatLookupOut(found=True, name=row.name, table_no=row.table_no, **view,
                         message=note if verified else "", message_locked=bool(note) and not verified)


@router.get("/photos")
def list_photos(db: Session = Depends(get_db), role: str | None = Depends(optional_staff)):
    """婚紗照分享頁：只回傳標記為公開的照片。後台登入者在未開放時也拿得到（預覽）。"""
    if not is_on(db, PHOTOS_KEY) and role is None:
        return []
    from .photos import sort_photos  # 與後台相簿同樣的順序

    # 只放大螢幕的相簿（生活照之類）賓客看不到，就算裡面某張標了公開
    hidden = guest_hidden_albums(db)
    rows = sort_photos([
        f for f in db.scalars(select(FileAsset).where(FileAsset.is_public.is_(True), FileAsset.kind == "photo")).all()
        if (f.album or "") not in hidden
    ])
    return [
        {"id": f.id, "caption": f.caption or "", "album": f.album or "", "has_thumb": bool(f.thumb_name)}
        for f in rows
    ]


def _public_photo(db: Session, file_id: int, role: str | None = None) -> FileAsset:
    if not is_on(db, PHOTOS_KEY) and role is None:
        raise HTTPException(404, "Not Found")
    f = db.get(FileAsset, file_id)
    if not f or not f.is_public or f.kind != "photo" or (f.album or "") in guest_hidden_albums(db):
        raise HTTPException(404, "Not Found")
    return f


@router.get("/photos/{file_id}")
def get_photo(file_id: int, db: Session = Depends(get_db), role: str | None = Depends(optional_staff)):
    f = _public_photo(db, file_id, role)
    path = settings.upload_path / f.stored_name
    if not path.is_file():
        raise HTTPException(404, "Not Found")
    return FileResponse(path, media_type=f.mime, headers={"Cache-Control": "public, max-age=86400"})


@router.get("/photos/{file_id}/thumb")
def get_photo_thumb(file_id: int, db: Session = Depends(get_db), role: str | None = Depends(optional_staff)):
    f = _public_photo(db, file_id, role)
    if f.thumb_name and (settings.upload_path / f.thumb_name).is_file():
        return FileResponse(settings.upload_path / f.thumb_name, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})
    path = settings.upload_path / f.stored_name
    if not path.is_file():
        raise HTTPException(404, "Not Found")
    return FileResponse(path, media_type=f.mime, headers={"Cache-Control": "public, max-age=86400"})
