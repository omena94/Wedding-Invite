"""婚禮當天賓客上傳的照片（2026-09-27）。

賓客端 /upload：不用登入，後台開關 guest_upload_open 開著才收（登入者不受開關限制，可先試）。
一律存原檔（新人要洗大圖）；存放位置由 storage.py 決定（S3 或主機），另做一張縮圖給後台看。
只有新人（有 guest_photos 鑰匙）在後台「當天照片」看得到、能刪、能整包下載；賓客看不到任何人的照片，包括自己傳的。
"""
import io
import re
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import GuestPhoto
from ..permissions import require_perm
from ..security import optional_staff
from ..stage import GUEST_UPLOAD_KEY, is_on
from ..storage import guest_store
from ..thumbs import make_thumb_bytes

router = APIRouter(tags=["guest-photos"])

ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".gif", ".dng"}
MAX_MB = 80  # 每張上限（手機原檔通常 3～12 MB；nginx 也放到 100m）


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
    store = guest_store()
    stored = f"{uuid.uuid4().hex}{ext}"
    content_type = (file.content_type or "")[:80]
    try:
        store.put(stored, data, content_type)
    except Exception as e:  # S3 金鑰或網路出問題時給明確訊息，不要 500
        raise HTTPException(503, f"照片暫時存不進去，請稍後再試（{type(e).__name__}）") from e
    thumb = f"thumb_{stored.rsplit('.', 1)[0]}.jpg"
    tb = make_thumb_bytes(data)
    if tb:
        store.put(thumb, tb, "image/jpeg")
    else:
        thumb = ""  # HEIC 等讀不了的格式沒縮圖，後台顯示檔名
    row = GuestPhoto(
        stored_name=stored, original_name=name[:255], size=len(data),
        content_type=content_type, uploader=re.sub(r"\s+", " ", uploader).strip()[:60],
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
    return {"items": [_out(p) for p in rows], "count": len(rows), "total_bytes": int(total), "storage": guest_store().kind}


def _get(db: Session, photo_id: int) -> GuestPhoto:
    p = db.get(GuestPhoto, photo_id)
    if not p:
        raise HTTPException(404, "找不到這張照片")
    return p


def _stream(key: str, media_type: str, filename: str | None = None) -> StreamingResponse:
    store = guest_store()
    if not store.exists(key):
        raise HTTPException(404, "檔案不在了")
    headers = {}
    if filename:
        headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{__import__('urllib.parse').parse.quote(filename)}"
    return StreamingResponse(store.stream(key), media_type=media_type or "application/octet-stream", headers=headers)


@router.get("/api/planner/guest-photos/{photo_id}/thumb", dependencies=[Perm])
def guest_photo_thumb(photo_id: int, db: Session = Depends(get_db)):
    p = _get(db, photo_id)
    return _stream(p.thumb_name or p.stored_name, "image/jpeg" if p.thumb_name else p.content_type)


@router.get("/api/planner/guest-photos/{photo_id}/file", dependencies=[Perm])
def guest_photo_file(photo_id: int, db: Session = Depends(get_db)):
    p = _get(db, photo_id)
    return _stream(p.stored_name, p.content_type, p.original_name)


@router.delete("/api/planner/guest-photos/{photo_id}", status_code=204, dependencies=[Perm])
def delete_guest_photo(photo_id: int, db: Session = Depends(get_db)):
    p = _get(db, photo_id)
    store = guest_store()
    for key in (p.stored_name, p.thumb_name):
        if key:
            try:
                store.delete(key)
            except Exception:
                pass  # 檔案已經不在也沒關係，紀錄照樣刪
    db.delete(p)
    db.commit()
    return Response(status_code=204)


class _Collect(io.RawIOBase):
    """給 zipfile 用的「只能寫」檔案物件：寫進來的內容先收著，外面一批一批吐出去，整包 zip 不用先放進記憶體或硬碟。"""

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
    """整包下載：從存放處一張一張讀、邊壓（不壓縮，照片壓不小）邊送，檔名用「上傳時間_上傳者_編號」。"""
    rows = db.scalars(select(GuestPhoto).order_by(GuestPhoto.created_at.asc(), GuestPhoto.id.asc())).all()
    if not rows:
        raise HTTPException(404, "還沒有照片")
    store = guest_store()

    def gen():
        sink = _Collect()
        with zipfile.ZipFile(sink, "w", zipfile.ZIP_STORED, allowZip64=True) as zf:
            used = set()
            for p in rows:
                if not store.exists(p.stored_name):
                    continue
                stamp = (p.created_at or datetime.now(timezone.utc)).strftime("%Y%m%d_%H%M%S")
                who = re.sub(r'[\\/:*?"<>|]', "_", p.uploader or "未具名")
                arc = f"{stamp}_{who}_{p.id}{Path(p.original_name).suffix.lower() or '.jpg'}"
                if arc in used:
                    arc = f"{p.id}_{arc}"
                used.add(arc)
                with zf.open(arc, "w", force_zip64=True) as dst:
                    for chunk in store.stream(p.stored_name):
                        dst.write(chunk)
                        if len(sink.buf) >= 4 * 1024 * 1024:
                            yield sink.take()
                yield sink.take()
        yield sink.take()

    return StreamingResponse(gen(), media_type="application/zip", headers={"Content-Disposition": 'attachment; filename="wedding-day-photos.zip"'})
