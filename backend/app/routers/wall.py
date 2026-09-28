"""婚禮當天現場留言與大螢幕（2026-09-28）。

賓客端 /wish：不用登入寫一句祝福，後台開關 wall_open 開著才收（登入者不受開關限制，可先試）。
wall_moderation 開著時新留言先是 pending，新人在後台按「通過」才上螢幕；關著就直接上螢幕，不妥的再隱藏。
大螢幕 /wall 要登入（有 wall 鑰匙），每兩秒輪詢 /api/planner/wall/feed，所以 feed 要夠便宜。
大螢幕的背景歌單也在這裡：音檔存主機的 uploads/wall/，節拍分析在瀏覽器算好後整包存回來。
"""
import json
import math
import re
import unicodedata
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, StrictBool, StrictFloat, StrictInt, StrictStr
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import guest_access
from ..config import settings
from ..database import get_db
from ..models import WallMessage, WallSong
from ..permissions import require_perm
from ..security import optional_staff
from ..stage import WALL_MODERATION_KEY, WALL_OPEN_KEY, is_on
from ..storage import LocalStore

router = APIRouter(tags=["wall"])

TEXT_MAX = 60   # 大螢幕一則留言要一眼讀完
NAME_MAX = 20
RATE_WINDOW = 60  # 秒
RATE_LIMIT = 6    # 同一支手機在 RATE_WINDOW 內最多幾則（沒帶手機代號就算同一個 IP 的）
# 會場 Wi-Fi、電信 NAT 會讓很多賓客共用一個對外 IP，所以 IP 只當防濫用的底線，放寬很多
IP_RATE_LIMIT = 60
DEVICE_MAX = 100  # 手機代號（前端是 UUID）太長就截斷再算雜湊
STATUSES = ("show", "hide", "pending")

SONG_EXT = {
    ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".wav": "audio/wav",
    ".ogg": "audio/ogg", ".oga": "audio/ogg", ".flac": "audio/flac", ".opus": "audio/ogg", ".webm": "audio/webm",
    # 新人可能直接傳 MV：瀏覽器只拿影片裡的音軌來播放、分析
    ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime",
}
SONG_MAX_MB = 90  # MV 比較大；nginx 上限是 100 MB
THEMES = ("gold", "rose", "champagne", "coral", "lilac", "sage")  # 大螢幕配色；空字串 = 自動挑
LYRICS_MAX = 200_000
ANALYSIS_MAX = 3 * 1024 * 1024

# 會讓大螢幕上的字反向或亂跳的雙向控制字元（U+202A～202E、U+2066～2069），跟一般控制字元一起拿掉
_BIDI = {chr(c) for c in (*range(0x202A, 0x202F), *range(0x2066, 0x206A))}


def _now() -> datetime:
    # 時間一律由程式給（精確到微秒）：限流要跟「一分鐘前」比，歌單版本號也靠 updated_at 分辨先後
    return datetime.now(timezone.utc)


def _clean(value: str) -> str:
    """換行、全形空白等都變成一個空格，再拿掉控制字元（emoji 的連接字元 ZWJ 留著，不然表情會拆開）。"""
    s = "".join(ch for ch in (value or "") if ch.isspace() or (ch not in _BIDI and unicodedata.category(ch) not in ("Cc", "Cs")))
    return re.sub(r"\s+", " ", s).strip()


def _clean_name(value: str) -> str:
    name = _clean(value)
    if len(name) > NAME_MAX:
        raise HTTPException(400, f"名字最多 {NAME_MAX} 個字")
    return name


def _clean_text(value: str) -> str:
    text = _clean(value)
    if not text:
        raise HTTPException(400, "請寫下想對新人說的話")
    if len(text) > TEXT_MAX:
        raise HTTPException(400, f"留言最多 {TEXT_MAX} 個字，再精簡一點點")
    return text


def _client_ip(request: Request) -> str:
    """網站在 Cloudflare 與 nginx 後面：先看 Cloudflare 給的真實 IP，再看轉送鏈的第一個，最後才是直接連線的位址。"""
    ip = (request.headers.get("cf-connecting-ip") or "").strip()
    if not ip:
        ip = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if not ip and request.client:
        ip = request.client.host or ""
    return ip or "unknown"


def _iso(dt: datetime | None) -> str:
    # 存的都是 UTC；SQLite（測試機）讀回來會掉時區，補上才不會被瀏覽器當成台灣時間
    if dt and dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat() if dt else ""


def _msg_out(m: WallMessage) -> dict:
    return {"id": m.id, "name": m.name, "text": m.text, "status": m.status, "source": m.source, "created_at": _iso(m.created_at)}


# ---------------- 賓客（/wish） ----------------
class GuestMessageIn(BaseModel):
    name: StrictStr = ""
    text: StrictStr = ""
    device: StrictStr = ""  # /wish 產生後記在瀏覽器的隨機代號，限流用


def _recent(db: Session, since: datetime, *conds) -> int:
    return db.scalar(select(func.count()).select_from(WallMessage).where(WallMessage.created_at > since, *conds)) or 0


@router.post("/api/wall/messages", status_code=201)
def post_wall_message(payload: GuestMessageIn, request: Request, db: Session = Depends(get_db), role: str | None = Depends(optional_staff)):
    """賓客寫一則留言。開關關著時只有登入者能寫（試用）；登入者也不受限流，方便現場測試。"""
    if not is_on(db, WALL_OPEN_KEY) and role is None:
        raise HTTPException(403, "現場留言尚未開放，婚禮當天再來喔")
    name, text = _clean_name(payload.name), _clean_text(payload.text)
    ip_hash = guest_access.digest(_client_ip(request))
    device = payload.device.strip()[:DEVICE_MAX]
    device_hash = guest_access.digest(f"wall-device:{device}") if device else ""
    now = _now()
    if role is None:
        # 用資料庫算，不用記憶體：正式站有好幾個 uvicorn worker，各記各的會被繞過
        since = now - timedelta(seconds=RATE_WINDOW)
        if device_hash:
            too_fast = (_recent(db, since, WallMessage.device_hash == device_hash) >= RATE_LIMIT
                        or _recent(db, since, WallMessage.ip_hash == ip_hash) >= IP_RATE_LIMIT)
        else:
            # 沒帶代號的只跟同一個 IP 其他沒帶代號的算在一起，不會被同場有帶代號的賓客連累
            too_fast = _recent(db, since, WallMessage.ip_hash == ip_hash, WallMessage.device_hash == "") >= RATE_LIMIT
        if too_fast:
            raise HTTPException(429, "留言太快了，休息一下再寫")
    status = "pending" if is_on(db, WALL_MODERATION_KEY) else "show"
    row = WallMessage(name=name, text=text, status=status, source="guest", ip_hash=ip_hash, device_hash=device_hash, created_at=now, updated_at=now)
    db.add(row)
    db.commit()
    return {"id": row.id, "status": row.status}


# ---------------- 後台與大螢幕（要 wall 鑰匙） ----------------
Perm = Depends(require_perm("wall"))


def _get_msg(db: Session, msg_id: int) -> WallMessage:
    m = db.get(WallMessage, msg_id)
    if not m:
        raise HTTPException(404, "找不到這則留言")
    return m


@router.get("/api/planner/wall/messages", dependencies=[Perm])
def list_wall_messages(db: Session = Depends(get_db)):
    rows = db.scalars(select(WallMessage).order_by(WallMessage.created_at.desc(), WallMessage.id.desc())).all()
    counts = {s: 0 for s in STATUSES}
    for m in rows:
        counts[m.status] = counts.get(m.status, 0) + 1
    return {"items": [_msg_out(m) for m in rows], "counts": counts}


class CoupleMessageIn(BaseModel):
    name: StrictStr = ""
    text: StrictStr = ""


@router.post("/api/planner/wall/messages", status_code=201, dependencies=[Perm])
def create_wall_message(payload: CoupleMessageIn, db: Session = Depends(get_db)):
    """新人自己加一則（例如開場的歡迎詞）：不看開關、不限流，直接上螢幕。"""
    now = _now()
    row = WallMessage(name=_clean_name(payload.name), text=_clean_text(payload.text), status="show", source="couple", created_at=now, updated_at=now)
    db.add(row)
    db.commit()
    return _msg_out(row)


class MessagePatch(BaseModel):
    status: StrictStr | None = None
    name: StrictStr | None = None
    text: StrictStr | None = None


@router.patch("/api/planner/wall/messages/{msg_id}", dependencies=[Perm])
def update_wall_message(msg_id: int, payload: MessagePatch, db: Session = Depends(get_db)):
    m = _get_msg(db, msg_id)
    if payload.status is not None:
        if payload.status not in STATUSES:
            raise HTTPException(400, "狀態只能是顯示、隱藏或待審核")
        m.status = payload.status
    if payload.name is not None:
        m.name = _clean_name(payload.name)
    if payload.text is not None:
        m.text = _clean_text(payload.text)
    m.updated_at = _now()
    db.commit()
    return _msg_out(m)


@router.delete("/api/planner/wall/messages/{msg_id}", status_code=204, dependencies=[Perm])
def delete_wall_message(msg_id: int, db: Session = Depends(get_db)):
    db.delete(_get_msg(db, msg_id))
    db.commit()
    return Response(status_code=204)


def _songs_rev(db: Session) -> str:
    """歌單版本號：新增、修改、刪除任何一首都會變（數量、最大 id、最後修改時間），大螢幕看到變了才重抓歌單。"""
    count, max_id, last = db.execute(select(func.count(WallSong.id), func.max(WallSong.id), func.max(WallSong.updated_at))).one()
    return f"{count or 0}-{max_id or 0}-{_iso(last) if isinstance(last, datetime) else (last or '')}"


@router.get("/api/planner/wall/feed", dependencies=[Perm])
def wall_feed(db: Session = Depends(get_db)):
    """大螢幕每兩秒問一次：只回上螢幕的留言（舊到新）與幾個開關；歌單只給版本號，變了再去抓。"""
    rows = db.execute(
        select(WallMessage.id, WallMessage.name, WallMessage.text, WallMessage.created_at)
        .where(WallMessage.status == "show").order_by(WallMessage.created_at.asc(), WallMessage.id.asc())
    ).all()
    return {
        "messages": [{"id": r.id, "name": r.name, "text": r.text, "created_at": _iso(r.created_at)} for r in rows],
        "count": len(rows),
        "open": is_on(db, WALL_OPEN_KEY),
        "moderation": is_on(db, WALL_MODERATION_KEY),
        "songs_rev": _songs_rev(db),
    }


# ---------------- 歌單 ----------------
def _song_store() -> LocalStore:
    # 每次用到才建：測試會換 upload_dir；音檔不大也不多，就放主機（不走 S3）
    return LocalStore(settings.upload_path / "wall")


def _song_out(s: WallSong) -> dict:
    return {
        "id": s.id, "title": s.title, "artist": s.artist, "original_name": s.original_name,
        "size": s.size, "content_type": s.content_type, "sort_order": s.sort_order, "enabled": s.enabled,
        "duration": s.duration, "bpm": s.bpm, "has_analysis": bool(s.analysis_json), "analysis_version": s.analysis_version,
        "lyrics_lrc": s.lyrics_lrc, "lyrics_source": s.lyrics_source, "lyrics_offset": s.lyrics_offset,
        "instrumental": s.instrumental, "theme": s.theme, "start_at": s.start_at, "end_at": s.end_at,
        "created_at": _iso(s.created_at), "updated_at": _iso(s.updated_at),
    }


def _songs(db: Session) -> list[WallSong]:
    return db.scalars(select(WallSong).order_by(WallSong.sort_order.asc(), WallSong.id.asc())).all()


def _get_song(db: Session, song_id: int) -> WallSong:
    s = db.get(WallSong, song_id)
    if not s:
        raise HTTPException(404, "找不到這首歌")
    return s


def _parse_filename(name: str) -> tuple[str, str]:
    """「歌手 - 歌名.mp3」拆成 (歌手, 歌名)；沒有分隔就整個當歌名。"""
    stem = Path(name).stem.strip()
    parts = re.split(r"\s+[-–—]\s+", stem, maxsplit=1)
    if len(parts) == 2 and parts[0].strip() and parts[1].strip():
        return parts[0].strip(), parts[1].strip()
    return "", stem


@router.get("/api/planner/wall/songs", dependencies=[Perm])
def list_wall_songs(db: Session = Depends(get_db)):
    return {"items": [_song_out(s) for s in _songs(db)]}


@router.post("/api/planner/wall/songs", status_code=201, dependencies=[Perm])
async def upload_wall_song(
    file: UploadFile = File(...),
    title: str = Form(default=""),
    artist: str = Form(default=""),
    db: Session = Depends(get_db),
):
    name = file.filename or "song"
    ext = Path(name).suffix.lower()
    if ext not in SONG_EXT:
        raise HTTPException(400, f"不支援的檔案格式：{ext or '（無副檔名）'}，請傳 mp3、m4a、wav 等音樂檔或 mp4 影片")
    limit = SONG_MAX_MB * 1024 * 1024
    data = await file.read(limit + 1)  # 多讀 1 byte 就知道有沒有超過，不必整個讀進來
    if not data:
        raise HTTPException(400, "檔案是空的")
    if len(data) > limit:
        raise HTTPException(413, f"這首超過 {SONG_MAX_MB}MB，請改傳小一點的檔案")
    parsed_artist, parsed_title = _parse_filename(name)
    title = _clean(title)[:200] or parsed_title[:200]
    artist = _clean(artist)[:200] or parsed_artist[:200]
    stored = f"{uuid.uuid4().hex}{ext}"
    _song_store().put(stored, data)
    last = db.scalar(select(func.max(WallSong.sort_order)))
    now = _now()
    row = WallSong(
        title=title, artist=artist, stored_name=stored, original_name=name[:255], size=len(data),
        # 依副檔名給固定的類型：瀏覽器送來的五花八門（audio/x-m4a、video/webm…）
        content_type=SONG_EXT[ext], sort_order=(last if last is not None else -1) + 1,
        created_at=now, updated_at=now,
    )
    db.add(row)
    db.commit()
    return _song_out(row)


class ReorderIn(BaseModel):
    ids: list[StrictInt]


@router.post("/api/planner/wall/songs/reorder", dependencies=[Perm])
def reorder_wall_songs(payload: ReorderIn, db: Session = Depends(get_db)):
    """照給的順序排；沒列到的接在後面、維持原本先後（兩個分頁同時操作時不會把歌弄丟）。"""
    songs = _songs(db)
    by_id = {s.id: s for s in songs}
    order = [by_id[i] for i in dict.fromkeys(payload.ids) if i in by_id]
    order += [s for s in songs if s.id not in set(payload.ids)]
    now = _now()
    for pos, s in enumerate(order):
        if s.sort_order != pos:
            s.sort_order = pos
            s.updated_at = now
    db.commit()
    return {"items": [_song_out(s) for s in order]}


class SongPatch(BaseModel):
    title: StrictStr | None = None
    artist: StrictStr | None = None
    enabled: StrictBool | None = None
    lyrics_lrc: StrictStr | None = None
    lyrics_source: StrictStr | None = None
    lyrics_offset: StrictFloat | StrictInt | None = None
    instrumental: StrictBool | None = None
    theme: StrictStr | None = None
    start_at: StrictFloat | StrictInt | None = None
    end_at: StrictFloat | StrictInt | None = None


def _finite(value: Any, label: str, lo: float, hi: float) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        raise HTTPException(400, f"{label}格式不正確")
    if not math.isfinite(v) or v < lo or v > hi:
        raise HTTPException(400, f"{label}超出範圍")
    return v


@router.patch("/api/planner/wall/songs/{song_id}", dependencies=[Perm])
def update_wall_song(song_id: int, payload: SongPatch, db: Session = Depends(get_db)):
    s = _get_song(db, song_id)
    fields = payload.model_fields_set
    if "title" in fields and payload.title is not None:
        s.title = _clean(payload.title)[:200]
    if "artist" in fields and payload.artist is not None:
        s.artist = _clean(payload.artist)[:200]
    if "enabled" in fields and payload.enabled is not None:
        s.enabled = payload.enabled
    if "lyrics_lrc" in fields and payload.lyrics_lrc is not None:
        if len(payload.lyrics_lrc) > LYRICS_MAX:
            raise HTTPException(400, "歌詞太長了")
        s.lyrics_lrc = payload.lyrics_lrc
    if "lyrics_source" in fields and payload.lyrics_source is not None:
        s.lyrics_source = payload.lyrics_source.strip()[:20]
    if "lyrics_offset" in fields and payload.lyrics_offset is not None:
        s.lyrics_offset = _finite(payload.lyrics_offset, "歌詞位移", -600, 600)
    if "instrumental" in fields and payload.instrumental is not None:
        s.instrumental = payload.instrumental
    if "theme" in fields and payload.theme is not None:
        if payload.theme not in ("", *THEMES):
            raise HTTPException(400, "沒有這個配色")
        s.theme = payload.theme
    # 起點、終點可以分開送，所以這裡只擋負數、不比大小；終點不晚於起點的情況交給播放端判斷
    if "start_at" in fields and payload.start_at is not None:
        s.start_at = _finite(payload.start_at, "開始時間", 0, 24 * 3600)
    if "end_at" in fields and payload.end_at is not None:
        s.end_at = _finite(payload.end_at, "結束時間", 0, 24 * 3600)
    s.updated_at = _now()
    db.commit()
    return _song_out(s)


class AnalysisIn(BaseModel):
    version: StrictInt
    duration: StrictFloat | StrictInt
    bpm: StrictFloat | StrictInt
    data: dict[str, Any]


@router.put("/api/planner/wall/songs/{song_id}/analysis", dependencies=[Perm])
def save_wall_song_analysis(song_id: int, payload: AnalysisIn, db: Session = Depends(get_db)):
    """節拍分析在瀏覽器算（伺服器不用裝音訊套件），算完整包存回來，下次開大螢幕就不用重算。"""
    s = _get_song(db, song_id)
    try:
        # Starlette 解析 JSON 時會接受 NaN／Infinity，存進去之後瀏覽器反而讀不回來，所以擋掉
        raw = json.dumps(payload.data, separators=(",", ":"), allow_nan=False)
    except ValueError:
        raise HTTPException(400, "分析資料裡有不合法的數字")
    if len(raw.encode()) > ANALYSIS_MAX:
        raise HTTPException(413, "分析資料太大了")
    s.analysis_json = raw
    s.analysis_version = max(0, payload.version)
    s.duration = _finite(payload.duration, "歌曲長度", 0, 24 * 3600)
    s.bpm = _finite(payload.bpm, "BPM", 0, 1000)
    s.updated_at = _now()
    db.commit()
    return _song_out(s)


@router.get("/api/planner/wall/songs/{song_id}/analysis", dependencies=[Perm])
def get_wall_song_analysis(song_id: int, db: Session = Depends(get_db)):
    s = _get_song(db, song_id)
    if not s.analysis_json:
        raise HTTPException(404, "還沒有分析")
    # 存的已經是 JSON 字串，直接拼回去，不用再解析一次（可能好幾百 KB）
    head = json.dumps({"version": s.analysis_version, "duration": s.duration, "bpm": s.bpm})
    return Response(content=f'{head[:-1]},"data":{s.analysis_json}}}', media_type="application/json")


@router.get("/api/planner/wall/songs/{song_id}/audio", dependencies=[Perm])
def wall_song_audio(song_id: int, db: Session = Depends(get_db)):
    s = _get_song(db, song_id)
    store = _song_store()
    if not store.exists(s.stored_name):
        raise HTTPException(404, "音檔不在了，請重新上傳")
    headers = {"Content-Length": str(store._path(s.stored_name).stat().st_size)}  # 讓前端看得到下載進度
    return StreamingResponse(store.stream(s.stored_name), media_type=s.content_type or "application/octet-stream", headers=headers)


@router.delete("/api/planner/wall/songs/{song_id}", status_code=204, dependencies=[Perm])
def delete_wall_song(song_id: int, db: Session = Depends(get_db)):
    s = _get_song(db, song_id)
    try:
        _song_store().delete(s.stored_name)
    except Exception:
        pass  # 檔案已經不在也沒關係，紀錄照樣刪
    db.delete(s)
    db.commit()
    return Response(status_code=204)
