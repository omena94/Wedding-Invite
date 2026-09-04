"""賓客端公開 API：目前階段、婚禮資訊、桌次查詢、婚紗照。"""
import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import FileAsset, Rsvp
from ..schemas import SeatLookupIn, SeatLookupOut
from ..seating import public_map, seats_of_rsvp
from ..stage import INFO_KEYS, PHOTOS_KEY, SEAT_KEY, get_all, is_on, public_stage

router = APIRouter(prefix="/api", tags=["public"])


@router.get("/stage")
def get_stage(db: Session = Depends(get_db)):
    """首頁 / 各頁面載入時查詢：第二階段開了沒、桌次查詢開了沒…"""
    return public_stage(db)


@router.get("/info")
def get_info(db: Session = Depends(get_db)):
    """婚禮資訊頁的文案（由籌備後台編輯）。"""
    data = get_all(db)
    return {**{k: data.get(k, "") for k in INFO_KEYS}, **public_stage(db)}


@router.post("/seat/lookup", response_model=SeatLookupOut)
def seat_lookup(payload: SeatLookupIn, db: Session = Depends(get_db)):
    """婚禮當天：輸入姓名或電話查桌號。"""
    if not is_on(db, SEAT_KEY):
        raise HTTPException(403, "桌次查詢尚未開放，婚禮當天再來查詢喔")
    q = payload.query.strip()
    digits = re.sub(r"\D", "", q)
    conds = [func.lower(Rsvp.name) == q.lower()]
    if len(digits) >= 8:
        conds.append(Rsvp.phone == digits)
        conds.append(Rsvp.phone == q)
    stmt = (
        select(Rsvp)
        .where(Rsvp.is_test.is_(False), Rsvp.attending.is_(True), or_(*conds))
        .order_by(Rsvp.created_at.desc())
    )
    row = db.scalars(stmt).first()
    if not row:
        return SeatLookupOut(found=False)
    seats = seats_of_rsvp(db, row)
    return SeatLookupOut(
        found=True,
        name=row.name,
        table_no=row.table_no,
        seats=seats,
        map=public_map(db) if seats else None,
    )


@router.get("/photos")
def list_photos(db: Session = Depends(get_db)):
    """婚紗照分享頁：只回傳標記為公開的照片。"""
    if not is_on(db, PHOTOS_KEY):
        return []
    from .photos import sort_photos  # 與後台相簿同樣的順序

    rows = sort_photos(
        db.scalars(select(FileAsset).where(FileAsset.is_public.is_(True), FileAsset.kind == "photo")).all()
    )
    return [
        {"id": f.id, "caption": f.caption or "", "album": f.album or "", "has_thumb": bool(f.thumb_name)}
        for f in rows
    ]


def _public_photo(db: Session, file_id: int) -> FileAsset:
    if not is_on(db, PHOTOS_KEY):
        raise HTTPException(404, "Not Found")
    f = db.get(FileAsset, file_id)
    if not f or not f.is_public or f.kind != "photo":
        raise HTTPException(404, "Not Found")
    return f


@router.get("/photos/{file_id}")
def get_photo(file_id: int, db: Session = Depends(get_db)):
    f = _public_photo(db, file_id)
    path = settings.upload_path / f.stored_name
    if not path.is_file():
        raise HTTPException(404, "Not Found")
    return FileResponse(path, media_type=f.mime, headers={"Cache-Control": "public, max-age=86400"})


@router.get("/photos/{file_id}/thumb")
def get_photo_thumb(file_id: int, db: Session = Depends(get_db)):
    f = _public_photo(db, file_id)
    if f.thumb_name and (settings.upload_path / f.thumb_name).is_file():
        return FileResponse(settings.upload_path / f.thumb_name, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})
    path = settings.upload_path / f.stored_name
    if not path.is_file():
        raise HTTPException(404, "Not Found")
    return FileResponse(path, media_type=f.mime, headers={"Cache-Control": "public, max-age=86400"})
