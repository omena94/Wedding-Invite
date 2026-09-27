"""婚禮當天賓客上傳的照片（2026-09-27）。

賓客端 /upload：不用登入，後台開關 guest_upload_open 開著才收（登入者不受開關限制，可先試）。
一律存原檔（新人要洗大圖），放在 upload_dir/guest/，另做一張縮圖給後台看。
只有新人（有 guest_photos 鑰匙）在後台「當天照片」看得到、能刪、能整包下載；賓客看不到任何人的照片，包括自己傳的。
"""
import io
import re
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import GuestPhoto
from ..permissions import require_perm
from ..security import optional_staff
from ..stage import GUEST_UPLOAD_KEY, is_on
from ..thumbs import make_thumb

router = APIRouter(tags=["guest-photos"])

GUEST_DIR = "guest"
ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".gif", ".dng"}
MAX_MB = 80          # 每張上限（手機原檔通常 3～12 MB；nginx 也要放到 100m）
MAX_PER_REQUEST = 1  # 前端一張一張傳，才有進度與重試


def _dir() -> Path:
    d = settings.upload_path / GUEST_DIR
    d.mkdir(parents=True, exist_ok=True)
    return d


def _out(p: GuestPhoto) -> dict:
    return {
        "id": p.id, "original_name": p.original_name, "size": p.size, "content_type": p.content_type,
        "uploader": p.uploader, "has_thumb": bool(p.thumb_name),
        "created_at": p.created_at.isoformat() if p.created_at else "",
    }


@router.post("/api/guest-photos", status_code=201)
async def upload_guest_photo(
    file: UploadFile = File(...),
    uploader: str = Form(default=""),
    db: Session = Depends(get_db),
    role: str | None = Depends(optional_staff),
):
    """賓客上傳一張照片（原檔）。開關關著時只有登入者能傳（試用）。"""
    if not is_on(db, GUEST_UPLOAD_KEY) and role is None:
        raise HTTPException(403, "照片上傳尚未開放，婚禮當天再來喔")
    name = file.filename or "photo"
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"不支援的檔案格式：{ext or '（無副檔名）'}，請傳照片檔")
    data = await file.read()
    if not data:
        raise HTTPException(400, "檔案是空的")
    if len(data) > MAX_MB * 1024 * 1024:
        raise HTTPException(413, f"這張超過 {MAX_MB}MB，請改傳小一點的")
    stored = f"{uuid.uuid4().hex}{ext}"
    path = _dir() / stored
    path.write_bytes(data)
    thumb = f"thumb_{stored.rsplit('.', 1)[0]}.jpg"
    if not make_thumb(path, _dir() / thumb):
        thumb = ""  # HEIC 等讀不了的格式沒縮圖，後台顯示檔名
    row = GuestPhoto(
        stored_name=stored, original_name=name[:255], size=len(data),
        content_type=(file.content_type or "")[:80], uploader=re.sub(r"\s+", " ", uploader).strip()[:60],
        thumb_name=thumb,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _out(row)


# ---------------- 後台（要 guest_photos 鑰匙） ----------------
Perm = Depends(require_perm("guest_photos"))


@router.get("/api/planner/guest-photos", dependencies=[Perm])
def list_guest_photos(db: Session = Depends(get_db)):
    rows = db.scalars(select(GuestPhoto).order_by(GuestPhoto.created_at.desc(), GuestPhoto.id.desc())).all()
    total = db.scalar(select(func.coalesce(func.sum(GuestPhoto.size), 0))) or 0
    return {"items": [_out(p) for p in rows], "count": len(rows), "total_bytes": int(total)}


def _get(db: Session, photo_id: int) -> GuestPhoto:
    p = db.get(GuestPhoto, photo_id)
    if not p:
        raise HTTPException(404, "找不到這張照片")
    return p


@router.get("/api/planner/guest-photos/{photo_id}/thumb", dependencies=[Perm])
def guest_photo_thumb(photo_id: int, db: Session = Depends(get_db)):
    p = _get(db, photo_id)
    path = _dir() / (p.thumb_name or p.stored_name)
    if not path.is_file():
        raise HTTPException(404, "檔案不在了")
    return FileResponse(path)


@router.get("/api/planner/guest-photos/{photo_id}/file", dependencies=[Perm])
def guest_photo_file(photo_id: int, db: Session = Depends(get_db)):
    p = _get(db, photo_id)
    path = _dir() / p.stored_name
    if not path.is_file():
        raise HTTPException(404, "檔案不在了")
    return FileResponse(path, filename=p.original_name, media_type=p.content_type or "application/octet-stream")


@router.delete("/api/planner/guest-photos/{photo_id}", status_code=204, dependencies=[Perm])
def delete_guest_photo(photo_id: int, db: Session = Depends(get_db)):
    p = _get(db, photo_id)
    for name in (p.stored_name, p.thumb_name):
        if name:
            (_dir() / name).unlink(missing_ok=True)
    db.delete(p)
    db.commit()
    return Response(status_code=204)


class _Collect(io.RawIOBase):
    """給 zipfile 用的「只能寫」檔案物件：寫進來的內容先收著，外面一批一批吐出去，不用先把整包 zip 放進記憶體或硬碟。"""

    def __init__(self):
        self.buf = bytearray()

    def writable(self):
        return True

    def write(self, b):
        self.buf += b
        return len(b)

    def take(self) -> bytes:
        out = bytes(self.buf)
        self.buf.clear()
        return out


@router.get("/api/planner/guest-photos/archive.zip", dependencies=[Perm])
def archive_guest_photos(db: Session = Depends(get_db)):
    """整包下載：邊壓邊送，檔名用「上傳時間_上傳者_原檔名」。"""
    rows = db.scalars(select(GuestPhoto).order_by(GuestPhoto.created_at.asc(), GuestPhoto.id.asc())).all()
    if not rows:
        raise HTTPException(404, "還沒有照片")
    base = _dir()

    def gen():
        sink = _Collect()
        with zipfile.ZipFile(sink, "w", zipfile.ZIP_STORED, allowZip64=True) as zf:
            used = set()
            for p in rows:
                src = base / p.stored_name
                if not src.is_file():
                    continue
                stamp = (p.created_at or datetime.now(timezone.utc)).strftime("%Y%m%d_%H%M%S")
                who = re.sub(r'[\\/:*?"<>|]', "_", p.uploader or "未具名")
                arc = f"{stamp}_{who}_{p.id}{Path(p.original_name).suffix.lower() or '.jpg'}"
                if arc in used:
                    arc = f"{p.id}_{arc}"
                used.add(arc)
                zf.write(src, arcname=arc)
                yield sink.take()
        yield sink.take()

    return StreamingResponse(gen(), media_type="application/zip", headers={"Content-Disposition": 'attachment; filename="wedding-day-photos.zip"'})
