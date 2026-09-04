"""座位圖 API（僅限新人）：畫布、桌椅物件、誰坐哪。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import Rsvp, SeatAssignment, SeatObject
import re

from ..schemas import (
    SeatAssignGroupIn,
    SeatAssignIn,
    SeatAutoAssignIn,
    SeatCanvasIn,
    SeatObjectIn,
    SeatObjectMove,
    SeatObjectPatch,
    SeatRenameIn,
)
from ..seating import assignment_out, build_layout, dump_meta, load_objects, object_out, persons_for, seat_count
from ..security import CoupleRequired
from ..stage import set_setting

router = APIRouter(prefix="/api/planner/seating", tags=["seating"], dependencies=[CoupleRequired])


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


# ---------------- 整張圖 ----------------
@router.get("")
def get_layout(db: Session = Depends(get_db)):
    return build_layout(db)


@router.patch("/canvas")
def set_canvas(payload: SeatCanvasIn, db: Session = Depends(get_db)):
    set_setting(db, "seating_canvas_w", str(payload.w))
    set_setting(db, "seating_canvas_h", str(payload.h))
    db.commit()
    return {"w": payload.w, "h": payload.h}


# ---------------- 桌椅物件 ----------------
@router.post("/objects", status_code=201)
def create_object(payload: SeatObjectIn, db: Session = Depends(get_db)):
    data = payload.model_dump()
    meta = data.pop("meta")
    if data["kind"] == "chair":
        data["seats"] = 1
    elif data["kind"] in ("zone", "label"):
        data["seats"] = 0
    o = SeatObject(**data, meta_json=dump_meta(meta))
    db.add(o)
    db.commit()
    return object_out(_obj(db, o.id))


@router.patch("/objects/{object_id}")
def update_object(object_id: int, payload: SeatObjectPatch, db: Session = Depends(get_db)):
    o = _obj(db, object_id)
    data = payload.model_dump(exclude_unset=True)
    if "meta" in data:
        o.meta_json = dump_meta(data.pop("meta"))
    for k, v in data.items():
        if v is not None:
            setattr(o, k, v)
    if o.kind == "chair":
        o.seats = 1
    elif o.kind in ("zone", "label"):
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
        if m.id in rows:
            rows[m.id].x = m.x
            rows[m.id].y = m.y
    db.commit()
    return {"updated": len(rows)}


@router.delete("/objects/{object_id}", status_code=204)
def delete_object(object_id: int, db: Session = Depends(get_db)):
    o = _obj(db, object_id)
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

    # 這個人原本坐別處？搬過來
    existing = db.scalars(
        select(SeatAssignment).where(
            SeatAssignment.rsvp_id == payload.rsvp_id, SeatAssignment.person_no == payload.person_no
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
                object_id=payload.object_id,
                seat_index=payload.seat_index,
                rsvp_id=payload.rsvp_id,
                person_no=payload.person_no,
                display_name=(payload.display_name or "").strip(),
            )
        )
    db.commit()
    return build_layout(db)


@router.post("/assign-group")
def assign_group(payload: SeatAssignGroupIn, db: Session = Depends(get_db)):
    """把這組還沒有位子的人，依序放進這張桌子的空位。"""
    o = _obj(db, payload.object_id)
    r = _rsvp(db, payload.rsvp_id)
    taken = {a.seat_index for a in o.assignments}
    free = [i for i in range(seat_count(o)) if i not in taken]
    seated = {
        (a.rsvp_id, a.person_no)
        for a in db.scalars(select(SeatAssignment).where(SeatAssignment.rsvp_id == r.id)).all()
    }
    pending = [p for p in persons_for(r) if (r.id, p["person_no"]) not in seated]
    if not pending:
        raise HTTPException(400, "這組每個人都已經有位子了")
    if not free:
        raise HTTPException(400, "這張桌子沒有空位了")
    placed = 0
    for p, idx in zip(pending, free):
        db.add(SeatAssignment(object_id=o.id, seat_index=idx, rsvp_id=r.id, person_no=p["person_no"]))
        placed += 1
    db.commit()
    layout = build_layout(db)
    layout["placed"] = placed
    layout["left_over"] = len(pending) - placed
    return layout


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
def auto_assign(payload: SeatAutoAssignIn, db: Session = Depends(get_db)):
    """一鍵安排：把還沒有位子的人依序填進空位。
    - 桌子依名稱（自然排序）再依位置排；單張椅子排最後
    - keep_groups：整組先找放得下的桌，放不下才拆
    - by_side：男方從第一桌往後填，女方從最後一桌往前填，兩邊自然分開
    """
    if payload.clear_first:
        for o in load_objects(db):
            for a in list(o.assignments):
                db.delete(a)
        db.commit()

    objects = [o for o in load_objects(db) if seat_count(o) > 0]
    tables = sorted(
        [o for o in objects if o.kind in ("round", "rect")],
        key=lambda o: (_natural_key(o.label), o.y, o.x),
    ) + sorted([o for o in objects if o.kind == "chair"], key=lambda o: (o.y, o.x))
    free = {o.id: sorted(set(range(seat_count(o))) - {a.seat_index for a in o.assignments}) for o in tables}
    size = {o.id: seat_count(o) for o in tables}

    seated = {
        (a.rsvp_id, a.person_no)
        for a in db.scalars(select(SeatAssignment)).all()
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
                    db.add(SeatAssignment(object_id=fit.id, seat_index=idx, rsvp_id=r.id, person_no=p["person_no"]))
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
                db.add(SeatAssignment(object_id=o.id, seat_index=idx, rsvp_id=r.id, person_no=p["person_no"]))
                free[o.id].remove(idx)
            remaining = remaining[take:]
            placed += take
        left_over += len(remaining)
    db.commit()
    layout = build_layout(db)
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
    return build_layout(db)


@router.delete("/assign/{assignment_id}")
def unassign(assignment_id: int, db: Session = Depends(get_db)):
    a = db.get(SeatAssignment, assignment_id)
    if a:
        db.delete(a)
        db.commit()
    return build_layout(db)


@router.delete("/assignments")
def clear_all(db: Session = Depends(get_db)):
    """清空所有座位指定（桌椅保留）。"""
    for o in load_objects(db):
        for a in list(o.assignments):
            db.delete(a)
    db.commit()
    return build_layout(db)
