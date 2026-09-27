"""照片相簿 API（僅限新人）：列表、排序、批次公開／隱藏。上傳與單張修改沿用 /api/planner/files。"""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import FileAsset
from ..schemas import PhotoPublishIn, PhotoReorderIn
from ..security import CoupleRequired
from ..stage import PHOTOS_KEY, is_on

from ..permissions import require_perm  # noqa: E402

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


def albums_of(rows: list[FileAsset]) -> list[dict]:
    seen: dict[str, dict] = {}
    for f in rows:
        a = f.album or ""
        if a not in seen:
            seen[a] = {"album": a, "count": 0, "public": 0, "cover_id": f.id}
        seen[a]["count"] += 1
        if f.is_public:
            seen[a]["public"] += 1
    return list(seen.values())


@router.get("")
def list_photos(db: Session = Depends(get_db)):
    rows = _photos(db)
    return {"photos": [photo_out(f) for f in rows], "albums": albums_of(rows), "photos_open": is_on(db, PHOTOS_KEY)}


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
    rows2 = _photos(db)
    return {"photos": [photo_out(f) for f in rows2], "albums": albums_of(rows2), "photos_open": is_on(db, PHOTOS_KEY)}


@router.post("/publish")
def publish(payload: PhotoPublishIn, db: Session = Depends(get_db)):
    """批次公開／隱藏。"""
    rows = {f.id: f for f in _photos(db)}
    for pid in payload.ids:
        if pid in rows:
            rows[pid].is_public = payload.is_public
    db.commit()
    rows2 = _photos(db)
    return {"photos": [photo_out(f) for f in rows2], "albums": albums_of(rows2), "photos_open": is_on(db, PHOTOS_KEY)}
