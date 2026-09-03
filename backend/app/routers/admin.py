"""後台 API：登入、名單、統計、更新、匯出（需登入）。"""
import csv
import io
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from datetime import date

from .. import cache
from ..database import get_db
from ..models import Rsvp
from ..phase_config import PHASE1_KEY, PHASE2_KEY, build_config, set_setting
from ..schemas import (
    DatePref,
    DeadlinesIn,
    LoginIn,
    LoginOut,
    RsvpAdminUpdate,
    RsvpOut,
    SideBreakdown,
    Stats,
)
from ..security import AdminRequired, create_token, verify_password

router = APIRouter(prefix="/api/admin", tags=["admin"])


# ===== 登入 =====
@router.post("/login", response_model=LoginOut)
def login(payload: LoginIn):
    if not verify_password(payload.password):
        raise HTTPException(401, "密碼錯誤")
    return LoginOut(token=create_token())


# ===== 截止日期設定 =====
@router.put("/deadlines", dependencies=[AdminRequired])
def save_deadlines(payload: DeadlinesIn, db: Session = Depends(get_db)):
    for value in (payload.phase1_deadline, payload.phase2_deadline):
        if value:
            try:
                date.fromisoformat(value)
            except ValueError:
                raise HTTPException(400, f"日期格式錯誤：{value}（請用 YYYY-MM-DD）")
    set_setting(db, PHASE1_KEY, payload.phase1_deadline)
    set_setting(db, PHASE2_KEY, payload.phase2_deadline)
    db.commit()
    return build_config(db)


# ===== 名單（可搜尋/篩選）=====
@router.get("/rsvps", response_model=list[RsvpOut], dependencies=[AdminRequired])
def list_rsvps(
    db: Session = Depends(get_db),
    search: str = Query(default=""),
    side: str = Query(default=""),
    attending: str = Query(default=""),  # "" / "yes" / "no"
    details: str = Query(default=""),    # "" / "done" / "pending"
):
    stmt = select(Rsvp).order_by(Rsvp.created_at.desc())
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(Rsvp.name.ilike(like), Rsvp.phone.ilike(like), Rsvp.email.ilike(like))
        )
    if side in ("groom", "bride"):
        stmt = stmt.where(Rsvp.side == side)
    if attending == "yes":
        stmt = stmt.where(Rsvp.attending.is_(True))
    elif attending == "no":
        stmt = stmt.where(Rsvp.attending.is_(False))
    if details == "done":
        stmt = stmt.where(Rsvp.details_completed.is_(True))
    elif details == "pending":
        stmt = stmt.where(Rsvp.attending.is_(True), Rsvp.details_completed.is_(False))
    return list(db.scalars(stmt).all())


# ===== 統計（Redis 快取）=====
@router.get("/stats", response_model=Stats, dependencies=[AdminRequired])
def get_stats(db: Session = Depends(get_db)):
    cached = cache.get_cached_stats()
    if cached:
        return Stats(**cached)

    # 測試資料不計入統計
    rows = list(db.scalars(select(Rsvp).where(Rsvp.is_test.is_(False))).all())
    attending = [r for r in rows if r.attending]

    def s(items, attr):
        return sum(getattr(i, attr) or 0 for i in items)

    def people(r):
        return (r.adult_count or 0) + (r.child_count or 0)

    # 日期偏好分佈（組數 + 人數）
    dp_resp = {"both": 0, "0306": 0, "0313": 0}
    dp_ppl = {"both": 0, "0306": 0, "0313": 0}
    for r in attending:
        key = r.date_preference if r.date_preference in dp_resp else "both"
        dp_resp[key] += 1
        dp_ppl[key] += people(r)

    # 素食類型 + 主餐份數（只算已填詳細的）
    done = [r for r in attending if r.details_completed]
    veg_types: dict[str, int] = {}
    main_totals: dict[str, int] = {}
    for r in done:
        if (r.veg_count or 0) > 0 and r.veg_type and r.veg_type != "無":
            veg_types[r.veg_type] = veg_types.get(r.veg_type, 0) + 1
        for dish, cnt in r.main_course.items():
            main_totals[dish] = main_totals.get(dish, 0) + int(cnt)

    groom = [r for r in attending if r.side == "groom"]
    bride = [r for r in attending if r.side == "bride"]

    stats = Stats(
        total_responses=len(rows),
        attending_responses=len(attending),
        declined_responses=len(rows) - len(attending),
        total_adults=s(attending, "adult_count"),
        total_children=s(attending, "child_count"),
        total_guests=s(attending, "adult_count") + s(attending, "child_count"),
        people_by_side=SideBreakdown(
            groom=sum(people(r) for r in groom),
            bride=sum(people(r) for r in bride),
        ),
        date_pref_responses=DatePref(both=dp_resp["both"], d0306=dp_resp["0306"], d0313=dp_resp["0313"]),
        date_pref_people=DatePref(both=dp_ppl["both"], d0306=dp_ppl["0306"], d0313=dp_ppl["0313"]),
        details_done=len(done),
        details_pending=len(attending) - len(done),
        total_baby_chairs=s(done, "baby_chair_count"),
        total_veg=s(done, "veg_count"),
        veg_types=veg_types,
        main_course_totals=main_totals,
        total_kids_meals=s(done, "kids_meal_count"),
    )
    cache.set_cached_stats(stats.model_dump())
    return stats


# ===== 更新（可修正賓客資料 / 排桌 / 狀態 / 備註）=====
@router.patch("/rsvps/{rsvp_id}", response_model=RsvpOut, dependencies=[AdminRequired])
def update_rsvp(rsvp_id: int, payload: RsvpAdminUpdate, db: Session = Depends(get_db)):
    record = db.get(Rsvp, rsvp_id)
    if not record:
        raise HTTPException(404, "找不到這筆資料")

    data = payload.model_dump(exclude_unset=True)
    # 主餐要序列化存入，並同步素食人數
    mains = data.pop("main_course", None)
    if mains is not None:
        clean = {k: int(v) for k, v in mains.items() if v and int(v) > 0}
        record.main_course_json = json.dumps(clean, ensure_ascii=False)
        record.veg_count = clean.get("素食", 0)

    for field, value in data.items():
        setattr(record, field, value)

    db.commit()
    db.refresh(record)
    cache.invalidate_stats()  # 人數/主餐可能被改，統計快取重算
    return record


# ===== 刪除 =====
@router.delete("/rsvps/{rsvp_id}", status_code=204, dependencies=[AdminRequired])
def delete_rsvp(rsvp_id: int, db: Session = Depends(get_db)):
    record = db.get(Rsvp, rsvp_id)
    if not record:
        raise HTTPException(404, "找不到這筆資料")
    db.delete(record)
    db.commit()
    cache.invalidate_stats()


# ===== 匯出 CSV（Excel 可直接開）=====
@router.get("/export.csv", dependencies=[AdminRequired])
def export_csv(db: Session = Depends(get_db)):
    # 匯出不含測試資料
    rows = list(
        db.scalars(
            select(Rsvp).where(Rsvp.is_test.is_(False)).order_by(Rsvp.created_at.desc())
        ).all()
    )

    buf = io.StringIO()
    buf.write("﻿")  # BOM，讓 Excel 正確辨識 UTF-8 中文
    writer = csv.writer(buf)
    writer.writerow([
        "姓名", "親友方", "出席", "日期偏好", "大人", "幼童",
        "詳細已填", "主餐", "兒童餐點", "兒童座椅", "素食人數", "素食類型",
        "飲食備註", "賓客備註", "電話", "Email", "想說的話",
        "桌號", "內部備註", "填表時間",
    ])
    side_map = {"groom": "男方", "bride": "女方"}
    date_map = {"both": "兩天都可以", "0306": "2027.03.06（週六）", "0313": "2027.03.13（週六）"}
    for r in rows:
        main_str = "、".join(f"{k}x{v}" for k, v in r.main_course.items()) if r.details_completed else ""
        writer.writerow([
            r.name, side_map.get(r.side, r.side),
            "出席" if r.attending else "不克出席",
            date_map.get(r.date_preference, "") if r.attending else "",
            r.adult_count, r.child_count,
            "是" if r.details_completed else "否",
            main_str, r.kids_meal_count,
            r.baby_chair_count, r.veg_count, r.veg_type, r.dietary_note,
            r.remark, r.phone, r.email, r.message,
            r.table_no if r.table_no is not None else "",
            r.admin_note,
            r.created_at.strftime("%Y-%m-%d %H:%M") if r.created_at else "",
        ])

    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="wedding_rsvp.csv"'},
    )
