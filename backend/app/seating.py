"""座位圖的共用邏輯：每組賓客展開成一個一個人、組合整張平面圖、清掉已失效的座位指定。"""
import json

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .models import Rsvp, SeatAssignment, SeatObject
from .stage import get_setting

CANVAS_DEFAULT = {"w": 1600, "h": 1000}
KINDS_WITH_SEATS = ("round", "rect", "chair")


def canvas_size(db: Session) -> dict:
    try:
        clearance = max(4, min(100, int(get_setting(db, 'seating_clearance') or 20)))
    except (ValueError, TypeError):
        clearance = 20
    def _int(v, d):
        try:
            return max(400, min(6000, int(float(v))))
        except (TypeError, ValueError):
            return d
    return {
        "w": _int(get_setting(db, "seating_canvas_w"), CANVAS_DEFAULT["w"]),
        "h": _int(get_setting(db, "seating_canvas_h"), CANVAS_DEFAULT["h"]),
        "clearance": clearance,
    }


_CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"


def _tag(n: int) -> str:
    """第 n 個人的小圓圈數字；超過 20 個人就退回 (21) 這種寫法。"""
    return _CIRCLED[n - 1] if 1 <= n <= len(_CIRCLED) else f"({n})"


def persons_for(r: Rsvp) -> list[dict]:
    """一組賓客 → 每個人。1 = 填表人，之後是同行大人，最後是小孩。
    只有一個人就只寫名字；兩人以上每個人都掛小圓圈數字（丁宣文①、丁宣文②…），
    小孩後面再加「小孩」當副標（地圖會畫成小字第二行）。"""
    out = []
    adults = max(1, int(r.adult_count or 0))
    kids = max(0, int(r.child_count or 0))
    total = adults + kids
    for i in range(1, adults + 1):
        name = r.name if total == 1 else f"{r.name}{_tag(i)}"
        out.append({"person_no": i, "name": name, "is_child": False})
    for k in range(1, kids + 1):
        out.append({"person_no": adults + k, "name": f"{r.name}{_tag(adults + k)} 小孩", "is_child": True})
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
    else:
        data.pop("note")
        data["meta"] = {k: v for k, v in obj.meta.items() if k in {"sides", "color", "blocked"}}
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


def guest_seat_view(db: Session, rsvp: Rsvp) -> dict:
    """賓客在 /seat 看到的完整內容：自己的位子、每張桌的同桌名單、左右鄰座、整張平面圖（含每個座位是誰）。"""
    seats = seats_of_rsvp(db, rsvp)
    if not seats:
        return {"seats": [], "tables": [], "map": None, "map_names": {}}
    my_ids = {s["object_id"] for s in seats}
    mine = {(s["object_id"], s["seat_no"] - 1) for s in seats}
    objects = {o.id: o for o in load_objects(db)}
    tables = []
    map_names: dict[str, dict[str, dict]] = {}
    for oid in my_ids:
        o = objects.get(oid)
        if not o:
            continue
        n = seat_count(o)
        by_idx = {a.seat_index: assignment_out(a) for a in o.assignments}
        mates = []
        for i in range(n):
            a = by_idx.get(i)
            mates.append({
                "seat_no": i + 1,
                "name": a["display_name"] if a else "",
                "is_child": a["is_child"] if a else False,
                "side": a["side"] if a else "",
                "mine": (oid, i) in mine,
            })
        tables.append({"object_id": oid, "label": o.label, "kind": o.kind, "seats_total": n, "mates": mates})
    # 平面圖上每張桌、每張椅子是誰：整張圖都給（就像入口的座位表），賓客點一點就知道旁邊坐誰；
    # 自己的位子標 mine 讓前端亮起來
    for o in objects.values():
        if seat_count(o) <= 0:
            continue
        names = {}
        for a in o.assignments:
            ao = assignment_out(a)
            if ao["display_name"]:
                names[str(a.seat_index)] = {
                    "name": ao["display_name"], "is_child": ao["is_child"], "side": ao["side"],
                    "mine": (o.id, a.seat_index) in mine,
                }
        if names:
            map_names[str(o.id)] = names
    # 左右鄰座：座位順序是繞桌一圈，所以頭尾相鄰
    for s in seats:
        o = objects.get(s["object_id"])
        n = seat_count(o) if o else 0
        by_idx = {a.seat_index: assignment_out(a)["display_name"] for a in o.assignments} if o else {}
        i = s["seat_no"] - 1
        neighbors = []
        if n >= 2:
            for j in ((i - 1) % n, (i + 1) % n):
                if j == i:
                    continue
                neighbors.append({"seat_no": j + 1, "name": by_idx.get(j, "")})
        s["neighbors"] = neighbors
    return {"seats": seats, "tables": tables, "map": public_map(db), "map_names": map_names}


def dump_meta(meta: dict | None) -> str:
    return json.dumps(meta or {}, ensure_ascii=False)
