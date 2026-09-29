"""後台 API：登入、名單、統計、更新、匯出（需登入）。"""
import csv
import io
import json
import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import cache
from ..database import get_db
from ..contacts import phone_column
from ..mailer import broadcast, send_one, smtp_ready
from ..models import Rsvp
from ..schemas import (
    DatePref,
    LoginIn,
    LoginOut,
    SwitchRoleIn,
    RsvpAdminCreate,
    RsvpAdminUpdate,
    RsvpOut,
    SideBreakdown,
    Stats,
)
from ..permissions import load_permissions, require_perm, role_permissions
from ..security import AdminRequired, CoupleRequired, create_token, login_role, require_staff
from ..seating import build_layout, guest_seat_view, hall_or_active

router = APIRouter(prefix="/api/admin", tags=["admin"])


# ===== 座位圖（唯讀；幫手當天帶位用）=====
@router.get("/seating", dependencies=[Depends(require_perm("seating_view", "seating_edit"))])
def seating_readonly(hall: int | None = Query(default=None), db: Session = Depends(get_db)):
    """幫手看的座位圖；?hall= 可切換廳，不帶就是正式使用的那一廳。"""
    return build_layout(db, hall_or_active(db, hall))


@router.get("/seating/preview/{rsvp_id}", dependencies=[Depends(require_perm("seating_view", "seating_edit"))])
def seating_preview(rsvp_id: int, hall: int | None = Query(default=None), db: Session = Depends(get_db)):
    """某組賓客在 /seat 查到的畫面內容（不受「桌次查詢」開關影響，給後台預覽用；可指定正在編輯的廳）。"""
    row = db.get(Rsvp, rsvp_id)
    if not row:
        raise HTTPException(404, "找不到這組賓客")
    view = guest_seat_view(db, row, hall_or_active(db, hall))
    return {"found": True, "name": row.name, "table_no": row.table_no, "attending": row.attending, **view,
            "message": (row.personal_note or "").strip()}


# ===== 我是誰、能做什麼（2026-09-27）=====
@router.get("/me")
def me(role: str = Depends(require_staff), db: Session = Depends(get_db)):
    return {"role": role, "permissions": sorted(role_permissions(db, role))}


# ===== 登入 =====
@router.post("/login", response_model=LoginOut)
def login(payload: LoginIn):
    role = login_role(payload.password)
    if not role:
        raise HTTPException(401, "密碼錯誤")
    return LoginOut(token=create_token(role), role=role)


@router.post("/switch-role", response_model=LoginOut, dependencies=[CoupleRequired])
def switch_role(payload: SwitchRoleIn):
    """2026-09-29 新人想看幫手會看到什麼：直接換一把幫手 token，不用知道幫手密碼。
    幫手不能反過來換成新人（要新人密碼），所以只收 helper。"""
    return LoginOut(token=create_token(payload.role), role=payload.role)


# ===== 群發通知（Email，multipart 以支援附件）=====
ALLOWED_ATTACH_EXT = {".pdf", ".jpg", ".jpeg", ".png"}
MAX_ATTACH_TOTAL = 10 * 1024 * 1024  # 10MB
MAX_ATTACH_COUNT = 3


@router.post("/broadcast", dependencies=[Depends(require_perm("broadcast"))])
async def send_broadcast(
    subject: str = Form(..., max_length=200),
    body: str = Form(..., max_length=30000),  # HTML 內容，放寬長度
    target: str = Form("pending"),
    test_to: str = Form(""),
    files: list[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
):
    if not smtp_ready():
        raise HTTPException(400, "尚未設定寄信帳號（Gmail 應用程式密碼），請先完成設定")

    # 讀取並驗證附件
    attachments = []
    total_size = 0
    for f in files:
        if not f.filename:
            continue
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in ALLOWED_ATTACH_EXT:
            raise HTTPException(400, f"不支援的附件類型：{f.filename}（限 PDF / JPG / PNG）")
        data = await f.read()
        total_size += len(data)
        if total_size > MAX_ATTACH_TOTAL:
            raise HTTPException(400, "附件總大小超過 10MB，請縮小檔案")
        attachments.append((f.filename, data))
    if len(attachments) > MAX_ATTACH_COUNT:
        raise HTTPException(400, f"附件最多 {MAX_ATTACH_COUNT} 個")

    # 測試信：只寄一封到指定信箱
    if test_to.strip():
        try:
            send_one(
                test_to.strip(),
                subject.replace("{name}", "測試"),
                body.replace("{name}", "測試"),
                attachments or None,
            )
        except Exception as e:
            raise HTTPException(502, f"測試信寄送失敗：{e}")
        return {"ok": True, "sent": 1, "test": True}

    # 正式群發對象：出席、有 Email、非測試資料
    stmt = select(Rsvp).where(
        Rsvp.attending.is_(True), Rsvp.is_test.is_(False), Rsvp.email != ""
    )
    if target == "pending":
        stmt = stmt.where(Rsvp.details_completed.is_(False))
    recipients = [(r.name, r.email) for r in db.scalars(stmt).all()]
    if not recipients:
        raise HTTPException(400, "沒有符合條件的收件人")

    broadcast(recipients, subject, body, attachments or None)
    return {"ok": True, "sent": len(recipients), "test": False}


# ===== 名單（可搜尋/篩選）=====
@router.get("/rsvps", response_model=list[RsvpOut], dependencies=[Depends(require_perm("guests_view"))])
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
@router.get("/stats", response_model=Stats, dependencies=[Depends(require_perm("guests_view"))])
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

    # 素食類型（只算已填詳細的；2026-09-29 起自助餐不再有主餐與兒童餐）
    done = [r for r in attending if r.details_completed]
    veg_types: dict[str, int] = {}
    for r in done:
        if (r.veg_count or 0) > 0 and r.veg_type and r.veg_type != "無":
            veg_types[r.veg_type] = veg_types.get(r.veg_type, 0) + 1

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
    )
    cache.set_cached_stats(stats.model_dump())
    return stats


# ===== 手動新增（新人用；沒有 Email／電話的賓客也能算進喜宴）=====
@router.post("/rsvps", response_model=RsvpOut, status_code=201, dependencies=[Depends(require_perm("guests_create"))])
def create_rsvp_manual(payload: RsvpAdminCreate, db: Session = Depends(get_db)):
    data = payload.model_dump()
    conds = []
    if data["email"]:
        conds.append(func.lower(Rsvp.email) == data["email"])
    if data["phone"]:
        conds.append(phone_column(Rsvp.phone) == data["phone"])
    if conds and db.scalars(select(Rsvp).where(or_(*conds))).first():
        raise HTTPException(409, "已有相同 Email 或電話的賓客，請直接編輯那一筆")
    if not data["attending"]:
        data.update(adult_count=0, child_count=0)
    record = Rsvp(**data, date_preference="both", message="")
    db.add(record)
    db.commit()
    db.refresh(record)
    cache.invalidate_stats()
    return record


# ===== 更新（可修正賓客資料 / 排桌 / 狀態 / 備註）=====
@router.patch("/rsvps/{rsvp_id}", response_model=RsvpOut, dependencies=[Depends(require_perm("guests_edit"))])
def update_rsvp(rsvp_id: int, payload: RsvpAdminUpdate, db: Session = Depends(get_db)):
    record = db.get(Rsvp, rsvp_id)
    if not record:
        raise HTTPException(404, "找不到這筆資料")

    data = payload.model_dump(exclude_unset=True)
    # 2026-09-29 自助餐：素食人數直接存（veg_count），主餐與兒童餐已取消

    children = data.pop("children", None)
    if children is not None:
        record.children_json = json.dumps(
            [{"height": c.get("height"), "pricing": c.get("pricing", "auto")} for c in children],
            ensure_ascii=False,
        )

    for field, value in data.items():
        setattr(record, field, value)

    db.commit()
    db.refresh(record)
    cache.invalidate_stats()  # 人數/素食可能被改，統計快取重算
    return record


# ===== 刪除 =====
@router.delete("/rsvps/{rsvp_id}", status_code=204, dependencies=[Depends(require_perm("guests_edit"))])
def delete_rsvp(rsvp_id: int, db: Session = Depends(get_db)):
    record = db.get(Rsvp, rsvp_id)
    if not record:
        raise HTTPException(404, "找不到這筆資料")
    db.delete(record)
    db.commit()
    cache.invalidate_stats()


# ===== 匯出 CSV（Excel 可直接開）=====
@router.get("/export.csv", dependencies=[Depends(require_perm("guests_view"))])
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
        "姓名", "親友方", "出席", "日期偏好", "大人", "幼童", "小孩身高",
        "詳細已填", "兒童座椅", "素食人數", "素食類型",
        "飲食備註", "賓客備註", "電話", "Email", "想說的話",
        "桌次（座位圖）", "內部備註", "填表時間",
    ])
    side_map = {"groom": "男方", "bride": "女方"}
    date_map = {"both": "兩天都可以", "0306": "2027.03.06（週六）", "0313": "2027.03.13（週六）"}
    # 2026-09-23 舊的手填桌號拿掉，匯出改列座位圖（正式使用的廳）上實際排的桌子
    from ..seating import active_hall, seats_of_rsvp
    hall = active_hall(db)
    seat_labels = {}
    for r in rows:
        labels = []
        for st in seats_of_rsvp(db, r, hall):
            lab = f"{st['table_label']} {st['seat_no']} 號"
            if lab not in labels:
                labels.append(lab)
        seat_labels[r.id] = "、".join(labels)
    for r in rows:
        writer.writerow([
            r.name, side_map.get(r.side, r.side),
            "出席" if r.attending else "不克出席",
            date_map.get(r.date_preference, "") if r.attending else "",
            r.adult_count, r.child_count,
            "/".join(str(c["height"]) if c["height"] is not None else "?" for c in r.children),
            "是" if r.details_completed else "否",
            r.baby_chair_count, r.veg_count, r.veg_type, r.dietary_note,
            r.remark, r.phone, r.email, r.message,
            seat_labels.get(r.id, ""),
            r.admin_note,
            r.created_at.strftime("%Y-%m-%d %H:%M") if r.created_at else "",
        ])

    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="wedding_rsvp.csv"'},
    )
