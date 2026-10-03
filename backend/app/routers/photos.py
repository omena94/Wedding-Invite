"""照片相簿 API（僅限新人）：列表、排序、批次公開／隱藏、每本相簿給誰看。上傳與單張修改沿用 /api/planner/files。

照片頁同時放兩種照片：給賓客看的婚紗照，和只想放在會場大螢幕的生活照。所以每本相簿有兩個開關：
guests（婚禮網站的照片頁看得到）、wall（放大螢幕），存在設定 photo_albums（stage.album_flags）。
"""
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, StrictBool, StrictStr
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import live
from ..database import get_db
from ..models import FileAsset
from ..schemas import PhotoPublishIn, PhotoReorderIn
from ..security import CoupleRequired, _decode
from ..stage import PHOTOS_KEY, album_flags, is_on, set_album_flags

from ..permissions import has_perm, require_perm  # noqa: E402

router = APIRouter(prefix="/api/planner/photos", tags=["photos"], dependencies=[Depends(require_perm("photos"))])


def photo_out(f: FileAsset) -> dict:
    return {
        "id": f.id,
        "filename": f.filename,
        "caption": f.caption or "",
        "album": f.album or "",
        "sort_order": f.sort_order or 0,
        "is_public": f.is_public,
        "has_thumb": bool(f.thumb_name),
        "img_w": f.img_w or 0,
        "img_h": f.img_h or 0,
        "focus_x": f.focus_x,
        "focus_y": f.focus_y,
        "size": f.size,
        "created_at": f.created_at.isoformat() if f.created_at else None,
    }


def sort_photos(rows: list[FileAsset]) -> list[FileAsset]:
    """相簿依「第一張上傳的先後」排，相簿內依 sort_order。"""
    first: dict[str, int] = {}
    for f in rows:
        a = f.album or ""
        first[a] = min(first.get(a, f.id), f.id)
    return sorted(rows, key=lambda f: (first[f.album or ""], f.sort_order or 0, f.id))


def _photos(db: Session) -> list[FileAsset]:
    rows = db.scalars(select(FileAsset).where(FileAsset.kind == "photo")).all()
    return sort_photos(rows)


def albums_of(rows: list[FileAsset], db: Session) -> list[dict]:
    seen: dict[str, dict] = {}
    for f in rows:
        a = f.album or ""
        if a not in seen:
            seen[a] = {"album": a, "count": 0, "public": 0, "cover_id": f.id}
        seen[a]["count"] += 1
        if f.is_public:
            seen[a]["public"] += 1
    flags = album_flags(db, list(seen))
    for a, v in seen.items():
        v.update(flags[a])
    return list(seen.values())


def _payload(db: Session) -> dict:
    rows = _photos(db)
    return {"photos": [photo_out(f) for f in rows], "albums": albums_of(rows, db), "photos_open": is_on(db, PHOTOS_KEY)}


@router.get("")
def list_photos(db: Session = Depends(get_db)):
    return _payload(db)


class AlbumIn(BaseModel):
    album: StrictStr
    guests: StrictBool | None = None
    wall: StrictBool | None = None


@router.put("/albums")
def set_album(payload: AlbumIn, db: Session = Depends(get_db), authorization: str | None = Header(default=None)):
    """一本相簿給誰看。相簿還沒有照片也可以先設（上傳新相簿時先選好用途，照片一上來就不會公開給賓客）。
    「放大螢幕」改的是大螢幕的內容，要有大螢幕的鑰匙。"""
    album = payload.album.strip()[:50]
    if payload.wall is not None:
        tok = _decode(authorization)
        if not any(has_perm(db, tok["role"], k) for k in ("wall", "wall_setup")):
            raise HTTPException(403, "沒有「大螢幕」的權限，請新人到設定頁開放")
    names = sorted({f.album or "" for f in _photos(db)})
    set_album_flags(db, album, names, guests=payload.guests, wall=payload.wall)
    db.commit()
    if payload.wall is not None:
        live.publish({"t": "feed"})  # 大螢幕馬上重抓照片清單（不用等下一輪輪詢）
    return _payload(db)


@router.post("/reorder")
def reorder(payload: PhotoReorderIn, db: Session = Depends(get_db)):
    """依傳來的 id 順序重排（通常是同一本相簿內的全部照片）。"""
    rows = {f.id: f for f in _photos(db)}
    pos = 0
    for pid in payload.ids:
        if pid in rows:
            rows[pid].sort_order = pos
            pos += 1
    db.commit()
    return _payload(db)


@router.post("/publish")
def publish(payload: PhotoPublishIn, db: Session = Depends(get_db)):
    """批次公開／隱藏。"""
    rows = {f.id: f for f in _photos(db)}
    for pid in payload.ids:
        if pid in rows:
            rows[pid].is_public = payload.is_public
    db.commit()
    return _payload(db)
