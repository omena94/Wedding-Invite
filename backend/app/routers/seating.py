"""座位圖 API（僅限新人）：廳、畫布、桌椅物件、誰坐哪。

2026-09-10 起座位圖分「廳」：每一廳有自己的畫布、桌椅、座位指定與底圖。
大部分端點用 ?hall= 指定廳，沒帶就是「正式使用」的那一廳（賓客查桌看的那一廳）。
"""
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..config import settings
from ..database import get_db
from ..models import Rsvp, SeatAssignment, SeatHall, SeatObject
from ..schemas import (
    SeatAssignGroupIn,
    SeatAssignIn,
    SeatAutoAssignIn,
    SeatCanvasIn,
    SeatHallIn,
    SeatHallPatch,
    SeatObjectIn,
    SeatObjectMove,
    SeatObjectPatch,
    SeatPresetIn,
    SeatRenameIn,
    SeatSwapIn,
)
from ..seat_presets import PRESETS, install_fixtures, install_preset, preset_list
from ..seating import (
    assignment_out,
    build_layout,
    dump_meta,
    hall_or_active,
    hall_out,
    list_halls,
    load_objects,
    object_out,
    persons_for,
    seat_count,
)
from ..security import CoupleRequired

from ..permissions import require_perm  # noqa: E402

router = APIRouter(prefix="/api/planner/seating", tags=["seating"], dependencies=[Depends(require_perm("seating_edit"))])

HallQuery = Query(default=None, description="哪一廳；不填 = 正式使用的那一廳")
BG_EXT = {".jpg", ".jpeg", ".png", ".webp"}
BG_MAX_PX = 2400  # 底圖長邊縮到這個大小就夠看了，畫布縮放才不會卡


def _obj(db: Session, object_id: int) -> SeatObject:
    db.expire_all()  # 同一 request 內寫入後再讀，確保座位集合是最新的
    o = db.scalars(
        select(SeatObject)
        .options(selectinload(SeatObject.assignments).selectinload(SeatAssignment.rsvp))
        .where(SeatObject.id == object_id)
    ).first()
    if not o:
        raise HTTPException(404, "找不到這個物件")
    return o


def _rsvp(db: Session, rsvp_id: int) -> Rsvp:
    r = db.get(Rsvp, rsvp_id)
    if not r or not r.attending or r.is_test:
        raise HTTPException(404, "找不到這組賓客（或已改為不出席）")
    return r


def _hall(db: Session, hall_id: int) -> SeatHall:
    h = db.get(SeatHall, hall_id)
    if not h:
        raise HTTPException(404, "找不到這個廳")
    return h


def _hall_of(db: Session, o: SeatObject) -> SeatHall:
    return hall_or_active(db, o.hall_id)


# ---------------- 廳 ----------------
@router.get("/halls")
def get_halls(db: Session = Depends(get_db)):
    return [hall_out(h) for h in list_halls(db)]


@router.post("/halls", status_code=201)
def create_hall(payload: SeatHallIn, db: Session = Depends(get_db)):
    """新增一廳；copy_from 有填就把那一廳的桌椅（不含誰坐哪）複製過來。"""
    halls = list_halls(db)
    hall = SeatHall(name=payload.name.strip(), canvas_w=payload.w, canvas_h=payload.h, clearance=payload.clearance,
                    is_active=False, sort_order=len(halls))
    db.add(hall)
    db.flush()
    if payload.copy_from is not None:
        src = _hall(db, payload.copy_from)
        hall.canvas_w, hall.canvas_h, hall.clearance = src.canvas_w, src.canvas_h, src.clearance
        hall.bg_opacity = src.bg_opacity
        if src.bg_image and (settings.upload_path / src.bg_image).is_file():
            stored = f"hallbg_{uuid.uuid4().hex}{Path(src.bg_image).suffix}"
            (settings.upload_path / stored).write_bytes((settings.upload_path / src.bg_image).read_bytes())
            hall.bg_image = stored
        for o in load_objects(db, src.id):
            db.add(SeatObject(hall_id=hall.id, kind=o.kind, label=o.label, x=o.x, y=o.y, w=o.w, h=o.h, rotation=o.rotation,
                              seats=o.seats, meta_json=o.meta_json, z_order=o.z_order, note=o.note))
    db.commit()
    return build_layout(db, hall)


@router.get("/halls/presets")
def get_presets():
    """可載入的飯店平面圖範本清單（廳設定的按鈕用）。"""
    return preset_list()


@router.post("/halls/preset", status_code=201)
def create_hall_from_preset(payload: SeatPresetIn, db: Session = Depends(get_db)):
    """載入內建範本（飯店提供的平面圖）成一個新的廳。原本的廳不會動。"""
    if payload.key not in PRESETS:
        raise HTTPException(404, "沒有這個範本")
    hall = install_preset(db, payload.key)
    return build_layout(db, hall)


@router.post("/halls/{hall_id}/fixtures")
def reset_fixtures(hall_id: int, payload: SeatPresetIn, db: Session = Depends(get_db)):
    """把範本的固定物件（牆、柱、洗手間、禮盒區、陽台門）放回這一廳並鎖定；桌椅與座位安排不動（2026-09-11）。"""
    hall = _hall(db, hall_id)
    if payload.key not in PRESETS:
        raise HTTPException(404, "沒有這個範本")
    n = install_fixtures(db, hall, payload.key)
    layout = build_layout(db, hall)
    layout["placed"] = n
    return layout


@router.patch("/halls/{hall_id}")
def update_hall(hall_id: int, payload: SeatHallPatch, db: Session = Depends(get_db)):
    hall = _hall(db, hall_id)
    data = payload.model_dump(exclude_unset=True)
    if data.get("name") is not None:
        hall.name = data["name"].strip()
    if data.get("w") is not None:
        hall.canvas_w = data["w"]
    if data.get("h") is not None:
        hall.canvas_h = data["h"]
    if data.get("clearance") is not None:
        hall.clearance = data["clearance"]
    if data.get("bg_opacity") is not None:
        hall.bg_opacity = data["bg_opacity"]
    if data.get("is_active"):
        # 只能有一廳是正式使用；不能把最後一個正式廳關掉（賓客頁一定要有一廳可看）
        for h in list_halls(db):
            h.is_active = h.id == hall.id
    db.commit()
    return build_layout(db, hall)


@router.delete("/halls/{hall_id}")
def delete_hall(hall_id: int, db: Session = Depends(get_db)):
    """刪掉整個廳（桌椅與座位指定一起刪）。至少要留一廳；刪掉正式使用的廳會自動改成第一廳。"""
    hall = _hall(db, hall_id)
    halls = list_halls(db)
    if len(halls) <= 1:
        raise HTTPException(400, "至少要留一個廳")
    if hall.bg_image:
        (settings.upload_path / hall.bg_image).unlink(missing_ok=True)
    was_active = hall.is_active
    db.delete(hall)
    db.flush()
    rest = [h for h in halls if h.id != hall.id]
    if was_active:
        rest[0].is_active = True
    db.commit()
    return build_layout(db, hall_or_active(db, rest[0].id))


@router.post("/halls/{hall_id}/background")
async def upload_background(hall_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    """上傳飯店平面圖當底圖（jpg / png / webp）。會縮到長邊 2400px。"""
    hall = _hall(db, hall_id)
    ext = Path(file.filename or "").suffix.lower()
    if ext not in BG_EXT:
        raise HTTPException(400, "底圖請用 jpg、png 或 webp 圖片")
    data = await file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"檔案超過 {settings.max_upload_mb}MB")
    stored = f"hallbg_{uuid.uuid4().hex}.jpg"
    dst = settings.upload_path / stored
    tmp = settings.upload_path / f"tmp_{stored}{ext}"
    tmp.write_bytes(data)
    try:
        from PIL import Image, ImageOps

        with Image.open(tmp) as im:
            im = ImageOps.exif_transpose(im)
            im.thumbnail((BG_MAX_PX, BG_MAX_PX))
            if im.mode not in ("RGB", "L"):
                im = im.convert("RGB")
            im.save(dst, "JPEG", quality=88, optimize=True)
    except Exception:
        raise HTTPException(400, "這個檔案讀不出來，請換一張圖片")
    finally:
        tmp.unlink(missing_ok=True)
    if hall.bg_image:
        (settings.upload_path / hall.bg_image).unlink(missing_ok=True)
    hall.bg_image = stored
    db.commit()
    return hall_out(hall)


@router.delete("/halls/{hall_id}/background")
def remove_background(hall_id: int, db: Session = Depends(get_db)):
    hall = _hall(db, hall_id)
    if hall.bg_image:
        (settings.upload_path / hall.bg_image).unlink(missing_ok=True)
        hall.bg_image = ""
        db.commit()
    return hall_out(hall)


@router.get("/halls/{hall_id}/background")
def get_background(hall_id: int, db: Session = Depends(get_db)):
    hall = _hall(db, hall_id)
    if not hall.bg_image:
        raise HTTPException(404, "這個廳沒有底圖")
    path = settings.upload_path / hall.bg_image
    if not path.is_file():
        raise HTTPException(404, "底圖檔案不存在")
    return FileResponse(path, media_type="image/jpeg")


# ---------------- 整張圖 ----------------
@router.get("")
def get_layout(hall: int | None = HallQuery, db: Session = Depends(get_db)):
    return build_layout(db, hall_or_active(db, hall))


@router.patch("/canvas")
def set_canvas(payload: SeatCanvasIn, hall: int | None = HallQuery, db: Session = Depends(get_db)):
    h = hall_or_active(db, hall)
    h.canvas_w, h.canvas_h, h.clearance = payload.w, payload.h, payload.clearance
    db.commit()
    return payload.model_dump()


# ---------------- 桌椅物件 ----------------
@router.post("/objects", status_code=201)
def create_object(payload: SeatObjectIn, db: Session = Depends(get_db)):
    data = payload.model_dump()
    meta = data.pop("meta")
    hall = hall_or_active(db, data.pop("hall_id", None))
    if data["kind"] == "chair":
        data["seats"] = 1
    elif data["kind"] in ("zone", "label", "stage", "entrance", "wall", "column"):
        data["seats"] = 0
    o = SeatObject(**data, hall_id=hall.id, meta_json=dump_meta(meta))
    db.add(o)
    db.commit()
    return object_out(_obj(db, o.id))


@router.patch("/objects/{object_id}")
def update_object(object_id: int, payload: SeatObjectPatch, db: Session = Depends(get_db)):
    o = _obj(db, object_id)
    data = payload.model_dump(exclude_unset=True)
    # 鎖定的固定物件：位置、大小、角度不能改（只允許先把 meta.locked 改成 false 解鎖）
    staying_locked = o.meta.get("locked") and not ("meta" in data and data["meta"] is not None and not data["meta"].get("locked"))
    if staying_locked and any(k in data and data[k] is not None and data[k] != getattr(o, k) for k in ("x", "y", "w", "h", "rotation")):
        raise HTTPException(400, "這是固定物件（牆、柱、洗手間…），不能移動或改大小；要調整請先在物件面板解除鎖定")
    if "meta" in data:
        o.meta_json = dump_meta(data.pop("meta"))
    for k, v in data.items():
        if v is not None:
            setattr(o, k, v)
    if o.kind == "chair":
        o.seats = 1
    elif o.kind in ("zone", "label", "stage", "entrance", "wall", "column"):
        o.seats = 0
    # 座位變少：超出的指定清掉
    limit = seat_count(o)
    for a in list(o.assignments):
        if a.seat_index >= limit:
            db.delete(a)
    db.commit()
    return object_out(_obj(db, object_id))


@router.post("/objects/move")
def move_objects(items: list[SeatObjectMove], db: Session = Depends(get_db)):
    """拖曳結束後一次更新多個物件的位置。"""
    ids = [m.id for m in items]
    rows = {o.id: o for o in db.scalars(select(SeatObject).where(SeatObject.id.in_(ids))).all()} if ids else {}
    for m in items:
        if m.id in rows and not rows[m.id].meta.get("locked"):  # 鎖定的固定物件不動
            rows[m.id].x = m.x
            rows[m.id].y = m.y
    db.commit()
    return {"updated": len(rows)}


@router.delete("/objects/{object_id}", status_code=204)
def delete_object(object_id: int, db: Session = Depends(get_db)):
    o = _obj(db, object_id)
    if o.meta.get("locked"):
        raise HTTPException(400, "這是固定物件（牆、柱、洗手間…），不能刪除；要刪請先在物件面板解除鎖定")
    db.delete(o)
    db.commit()
    return None


@router.delete("/objects/{object_id}/assignments")
def clear_object(object_id: int, db: Session = Depends(get_db)):
    o = _obj(db, object_id)
    for a in list(o.assignments):
        db.delete(a)
    db.commit()
    return object_out(_obj(db, object_id))


# ---------------- 誰坐哪 ----------------
@router.put("/assign")
def assign(payload: SeatAssignIn, db: Session = Depends(get_db)):
    o = _obj(db, payload.object_id)
    hall = _hall_of(db, o)
    if not (0 <= payload.seat_index < seat_count(o)):
        raise HTTPException(400, "這個物件沒有這個座位")
    r = _rsvp(db, payload.rsvp_id)
    persons = persons_for(r)
    if not any(p["person_no"] == payload.person_no for p in persons):
        raise HTTPException(400, "這組賓客沒有這個人（人數可能改過）")

    # 位子上已有人？
    occupant = db.scalars(
        select(SeatAssignment).where(
            SeatAssignment.object_id == payload.object_id, SeatAssignment.seat_index == payload.seat_index
        )
    ).first()
    if occupant and not (occupant.rsvp_id == payload.rsvp_id and occupant.person_no == payload.person_no):
        if not payload.force:
            raise HTTPException(409, f"這個位子已經是 {assignment_out(occupant)['display_name']}，要換人請按「覆蓋」")
        db.delete(occupant)
        db.flush()

    # 這個人在這一廳原本坐別處？搬過來（其他廳的位子不受影響）
    existing = db.scalars(
        select(SeatAssignment).where(
            SeatAssignment.hall_id == hall.id,
            SeatAssignment.rsvp_id == payload.rsvp_id,
            SeatAssignment.person_no == payload.person_no,
        )
    ).first()
    if existing:
        existing.object_id = payload.object_id
        existing.seat_index = payload.seat_index
        if payload.display_name is not None:
            existing.display_name = payload.display_name.strip()
    else:
        db.add(
            SeatAssignment(
                hall_id=hall.id,
                object_id=payload.object_id,
                seat_index=payload.seat_index,
                rsvp_id=payload.rsvp_id,
                person_no=payload.person_no,
                display_name=(payload.display_name or "").strip(),
            )
        )
    db.commit()
    return build_layout(db, hall)


@router.post("/assign-group")
def assign_group(payload: SeatAssignGroupIn, db: Session = Depends(get_db)):
    """把這組人放進這張桌子的空位（依座號順序）。

    預設只放這一廳還沒有位子的人；move_all 則連坐在別桌的也一起搬過來。
    空位不夠時預設擋下（409），前端會問要不要「先放得下的幾位」再帶 partial 重送。
    """
    o = _obj(db, payload.object_id)
    hall = _hall_of(db, o)
    r = _rsvp(db, payload.rsvp_id)
    label = o.label or "這桌"
    mine = db.scalars(
        select(SeatAssignment).where(SeatAssignment.rsvp_id == r.id, SeatAssignment.hall_id == hall.id)
    ).all()
    seated = {(a.rsvp_id, a.person_no): a for a in mine}
    if payload.move_all:
        # 這組全部重排到這桌：自己原本在這桌佔的位子也先讓出來，才算得出真正的空位
        pending = list(persons_for(r))
        to_remove = list(mine)
    else:
        pending = [p for p in persons_for(r) if (r.id, p["person_no"]) not in seated]
        to_remove = []
    if not pending:
        raise HTTPException(400, "這組每個人都已經有位子了")
    freed = {a.seat_index for a in to_remove if a.object_id == o.id}
    taken = {a.seat_index for a in o.assignments} - freed
    free = [i for i in range(seat_count(o)) if i not in taken]
    if not free:
        raise HTTPException(400, f"「{label}」沒有空位了")
    if len(pending) > len(free) and not payload.partial:
        raise HTTPException(409, f"「{label}」只剩 {len(free)} 位，這組要放 {len(pending)} 位，放不下")
    for a in to_remove:
        db.delete(a)
    db.flush()
    placed = 0
    for p, idx in zip(pending, free):
        db.add(SeatAssignment(hall_id=hall.id, object_id=o.id, seat_index=idx, rsvp_id=r.id, person_no=p["person_no"]))
        placed += 1
    db.commit()
    layout = build_layout(db, hall)
    layout["placed"] = placed
    layout["left_over"] = len(pending) - placed
    return layout


@router.post("/swap")
def swap_seats(payload: SeatSwapIn, db: Session = Depends(get_db)):
    """同一桌兩個座位互換。清單裡把人往上或往下拖，就是換座號；拖到空位就只是搬過去。"""
    o = _obj(db, payload.object_id)
    hall = _hall_of(db, o)
    n = seat_count(o)
    if not (0 <= payload.a < n and 0 <= payload.b < n):
        raise HTTPException(400, "這張桌子沒有這個座位")
    if payload.a == payload.b:
        return build_layout(db, hall)
    by_idx = {a.seat_index: a for a in o.assignments}
    x, y = by_idx.get(payload.a), by_idx.get(payload.b)
    if not x and not y:
        raise HTTPException(400, "兩個都是空位，不用換")
    # 兩邊都有人時先把其中一個挪到暫時的座號，避開「同桌同座號」的唯一限制
    if x and y:
        x.seat_index = -1
        db.flush()
        y.seat_index = payload.a
        db.flush()
        x.seat_index = payload.b
    elif x:
        x.seat_index = payload.b
    else:
        y.seat_index = payload.a
    db.commit()
    return build_layout(db, hall)


def _natural_key(label: str):
    """A2 排在 A10 前面：把數字段轉成整數比較。"""
    return [int(p) if p.isdigit() else p.lower() for p in re.split(r"(\d+)", label or "")]


def _pick_run(free: list[int], k: int, n: int) -> list[int]:
    """從空位裡挑 k 個盡量相連的位子（座位是繞桌一圈，所以頭尾算相連）。"""
    if k >= len(free):
        return list(free)
    fs = set(free)
    for start in free:
        run = [(start + j) % n for j in range(k)]
        if all(x in fs for x in run):
            return run
    return list(free[:k])


@router.post("/auto-assign")
def auto_assign(payload: SeatAutoAssignIn, hall: int | None = HallQuery, db: Session = Depends(get_db)):
    """一鍵安排：把這一廳還沒有位子的人依序填進空位。
    - 桌子依名稱（自然排序）再依位置排；單張椅子排最後
    - keep_groups：整組先找放得下的桌，放不下才拆
    - by_side：男方從第一桌往後填，女方從最後一桌往前填，兩邊自然分開
    """
    h = hall_or_active(db, hall)
    if payload.clear_first:
        for o in load_objects(db, h.id):
            for a in list(o.assignments):
                db.delete(a)
        db.commit()

    objects = [o for o in load_objects(db, h.id) if seat_count(o) > 0]
    tables = sorted(
        [o for o in objects if o.kind in ("round", "rect")],
        key=lambda o: (_natural_key(o.label), o.y, o.x),
    ) + sorted([o for o in objects if o.kind == "chair"], key=lambda o: (o.y, o.x))
    free = {o.id: sorted(set(range(seat_count(o))) - {a.seat_index for a in o.assignments}) for o in tables}
    size = {o.id: seat_count(o) for o in tables}

    seated = {
        (a.rsvp_id, a.person_no)
        for a in db.scalars(select(SeatAssignment).where(SeatAssignment.hall_id == h.id)).all()
    }
    groups = []
    for r in db.scalars(
        select(Rsvp).where(Rsvp.attending.is_(True), Rsvp.is_test.is_(False)).order_by(Rsvp.created_at.asc())
    ).all():
        pending = [p for p in persons_for(r) if (r.id, p["person_no"]) not in seated]
        if pending:
            groups.append((r, pending))
    # 大組先放比較容易整組同桌
    groups.sort(key=lambda g: (-len(g[1]), g[0].id))

    placed = 0
    left_over = 0
    for r, pending in groups:
        order = tables if not (payload.by_side and r.side == "bride") else list(reversed(tables))
        remaining = list(pending)
        if payload.keep_groups:
            fit = next((o for o in order if len(free[o.id]) >= len(remaining)), None)
            if fit is not None:
                run = _pick_run(free[fit.id], len(remaining), size[fit.id])
                for p, idx in zip(remaining, run):
                    db.add(SeatAssignment(hall_id=h.id, object_id=fit.id, seat_index=idx, rsvp_id=r.id, person_no=p["person_no"]))
                    free[fit.id].remove(idx)
                placed += len(remaining)
                remaining = []
        for o in order:
            if not remaining:
                break
            if not free[o.id]:
                continue
            take = min(len(free[o.id]), len(remaining))
            run = _pick_run(free[o.id], take, size[o.id])
            for p, idx in zip(remaining[:take], run):
                db.add(SeatAssignment(hall_id=h.id, object_id=o.id, seat_index=idx, rsvp_id=r.id, person_no=p["person_no"]))
                free[o.id].remove(idx)
            remaining = remaining[take:]
            placed += take
        left_over += len(remaining)
    db.commit()
    layout = build_layout(db, h)
    layout["placed"] = placed
    layout["left_over"] = left_over
    return layout


@router.patch("/assign/{assignment_id}")
def rename_assignment(assignment_id: int, payload: SeatRenameIn, db: Session = Depends(get_db)):
    a = db.get(SeatAssignment, assignment_id)
    if not a:
        raise HTTPException(404, "找不到這個座位指定")
    a.display_name = payload.display_name.strip()
    db.commit()
    return build_layout(db, hall_or_active(db, a.hall_id))


@router.delete("/assign/{assignment_id}")
def unassign(assignment_id: int, hall: int | None = HallQuery, db: Session = Depends(get_db)):
    a = db.get(SeatAssignment, assignment_id)
    hall_id = a.hall_id if a else hall
    if a:
        db.delete(a)
        db.commit()
    return build_layout(db, hall_or_active(db, hall_id))


@router.delete("/assignments")
def clear_all(hall: int | None = HallQuery, db: Session = Depends(get_db)):
    """清空這一廳所有座位指定（桌椅保留）。"""
    h = hall_or_active(db, hall)
    for o in load_objects(db, h.id):
        for a in list(o.assignments):
            db.delete(a)
    db.commit()
    return build_layout(db, h)
