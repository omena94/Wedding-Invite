"""座位圖的共用邏輯：每組賓客展開成一個一個人、組合整張平面圖、清掉已失效的座位指定。"""
import json

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .models import Rsvp, SeatAssignment, SeatObject
from .stage import get_setting

CANVAS_DEFAULT = {"w": 1600, "h": 1000}
KINDS_WITH_SEATS = ("round", "rect", "chair")


def canvas_size(db: Session) -> dict:
    def _int(v, d):
        try:
            return max(400, min(6000, int(float(v))))
        except (TypeError, ValueError):
            return d
    return {
        "w": _int(get_setting(db, "seating_canvas_w"), CANVAS_DEFAULT["w"]),
        "h": _int(get_setting(db, "seating_canvas_h"), CANVAS_DEFAULT["h"]),
    }


def persons_for(r: Rsvp) -> list[dict]:
    """一組賓客 → 每個人。1 = 填表人，之後是同行大人，最後是小孩。"""
    out = []
    adults = max(1, int(r.adult_count or 0))
    for i in range(1, adults + 1):
        out.append({"person_no": i, "name": r.name if i == 1 else f"{r.name} +{i - 1}", "is_child": False})
    for k in range(1, int(r.child_count or 0) + 1):
        out.append({"person_no": adults + k, "name": f"{r.name} 小孩{k}", "is_child": True})
    return out


def seat_count(obj: SeatObject) -> int:
    if obj.kind == "chair":
        return 1
    if obj.kind in ("round", "rect"):
        return max(0, int(obj.seats or 0))
    return 0


def object_out(obj: SeatObject, with_names: bool = True) -> dict:
    data = {
        "id": obj.id,
        "kind": obj.kind,
        "label": obj.label,
        "x": obj.x,
        "y": obj.y,
        "w": obj.w,
        "h": obj.h,
        "rotation": obj.rotation,
        "seats": seat_count(obj),
        "meta": obj.meta,
        "z_order": obj.z_order,
        "note": obj.note,
    }
    if with_names:
        data["assignments"] = [assignment_out(a) for a in sorted(obj.assignments, key=lambda a: a.seat_index)]
    return data


def assignment_out(a: SeatAssignment) -> dict:
    r = a.rsvp
    auto = ""
    is_child = False
    if r:
        for p in persons_for(r):
            if p["person_no"] == a.person_no:
                auto = p["name"]
                is_child = p["is_child"]
                break
    return {
        "id": a.id,
        "object_id": a.object_id,
        "seat_index": a.seat_index,
        "rsvp_id": a.rsvp_id,
        "person_no": a.person_no,
        "display_name": a.display_name or auto,
        "auto_name": auto,
        "is_child": is_child,
        "side": r.side if r else "",
    }


def prune(db: Session) -> None:
    """清掉已失效的指定：賓客改成不出席／人數變少／被標成測試、或座位數變少。"""
    rows = db.scalars(select(SeatAssignment).options(selectinload(SeatAssignment.rsvp), selectinload(SeatAssignment.obj))).all()
    dirty = False
    for a in rows:
        r = a.rsvp
        ok = r is not None and r.attending and not r.is_test
        if ok:
            total = max(1, int(r.adult_count or 0)) + int(r.child_count or 0)
            ok = 1 <= a.person_no <= total
        if ok and a.obj is not None:
            ok = 0 <= a.seat_index < seat_count(a.obj)
        if not ok:
            db.delete(a)
            dirty = True
    if dirty:
        db.commit()


def load_objects(db: Session) -> list[SeatObject]:
    # session 設定 expire_on_commit=False，寫入後同一個 request 再讀，集合會是舊快照；先全部失效再查
    db.expire_all()
    return db.scalars(
        select(SeatObject)
        .options(selectinload(SeatObject.assignments).selectinload(SeatAssignment.rsvp))
        .order_by(SeatObject.z_order.asc(), SeatObject.id.asc())
    ).all()


def build_layout(db: Session) -> dict:
    """給籌備後台：物件（含誰坐哪）+ 賓客清單（每個人有沒有位子）+ 摘要。"""
    prune(db)
    objects = load_objects(db)
    seated = {}  # (rsvp_id, person_no) -> {object_id, seat_index, label}
    for o in objects:
        for a in o.assignments:
            seated[(a.rsvp_id, a.person_no)] = {"object_id": o.id, "seat_index": a.seat_index, "label": o.label}
    guests = []
    people_total = 0
    for r in db.scalars(
        select(Rsvp).where(Rsvp.attending.is_(True), Rsvp.is_test.is_(False)).order_by(Rsvp.side.asc(), Rsvp.created_at.asc())
    ).all():
        persons = []
        for p in persons_for(r):
            key = (r.id, p["person_no"])
            persons.append({**p, "seat": seated.get(key)})
        people_total += len(persons)
        guests.append(
            {
                "rsvp_id": r.id,
                "name": r.name,
                "side": r.side,
                "adult_count": r.adult_count,
                "child_count": r.child_count,
                "table_no": r.table_no,
                "persons": persons,
                "unassigned": sum(1 for p in persons if not p["seat"]),
            }
        )
    seats_total = sum(seat_count(o) for o in objects)
    return {
        "canvas": canvas_size(db),
        "objects": [object_out(o) for o in objects],
        "guests": guests,
        "summary": {
            "seats_total": seats_total,
            "assigned": len(seated),
            "people_total": people_total,
            "unassigned": people_total - len(seated),
            "tables": sum(1 for o in objects if o.kind in ("round", "rect")),
        },
    }


def public_map(db: Session) -> dict:
    """給賓客端：只有形狀與桌名，沒有任何人名。"""
    objects = load_objects(db)
    return {
        "canvas": canvas_size(db),
        "objects": [object_out(o, with_names=False) for o in objects],
    }


def seats_of_rsvp(db: Session, rsvp: Rsvp) -> list[dict]:
    """某組賓客每個人的位子（給 /seat 查詢用）。"""
    rows = db.scalars(
        select(SeatAssignment)
        .options(selectinload(SeatAssignment.obj), selectinload(SeatAssignment.rsvp))
        .where(SeatAssignment.rsvp_id == rsvp.id)
        .order_by(SeatAssignment.person_no.asc())
    ).all()
    return [
        {
            "object_id": a.object_id,
            "table_label": a.obj.label if a.obj else "",
            "seat_no": a.seat_index + 1,
            "display_name": assignment_out(a)["display_name"],
        }
        for a in rows
        if a.obj is not None
    ]


def dump_meta(meta: dict | None) -> str:
    return json.dumps(meta or {}, ensure_ascii=False)
