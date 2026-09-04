"""賓客端 API（公開）：Phase 1 意願調查、Phase 2 詳細調查。"""
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import cache
from ..database import get_db
from ..models import Rsvp
from ..notify import phase1_message, phase2_message, send_telegram
from ..schemas import LookupIn, LookupOut, Phase1Create, Phase2Details, RsvpOut
from ..stage import is_phase2_open


def _attending_totals(db: Session) -> tuple[int, int]:
    """回傳（出席組數, 出席總人數）給通知訊息用。測試資料不計入。"""
    groups = db.scalar(
        select(func.count()).select_from(Rsvp).where(
            Rsvp.attending.is_(True), Rsvp.is_test.is_(False)
        )
    ) or 0
    guests = db.scalar(
        select(func.coalesce(func.sum(Rsvp.adult_count + Rsvp.child_count), 0)).where(
            Rsvp.attending.is_(True), Rsvp.is_test.is_(False)
        )
    ) or 0
    return groups, guests

router = APIRouter(prefix="/api", tags=["rsvp"])


def _find_by_contact(db: Session, contact: str) -> Rsvp | None:
    """用 Email 或 電話找到 Phase 1 的紀錄（不分大小寫；取最新一筆）。"""
    c = contact.strip()
    if not c:
        return None
    stmt = (
        select(Rsvp)
        .where(or_(func.lower(Rsvp.email) == c.lower(), Rsvp.phone == c))
        .order_by(Rsvp.created_at.desc())
    )
    return db.scalars(stmt).first()


# ===== Phase 1：送出意願調查 =====
@router.post("/rsvp", response_model=RsvpOut, status_code=201)
def create_phase1(payload: Phase1Create, db: Session = Depends(get_db)):
    data = payload.model_dump()

    # 防重複填寫：同一 Email 或電話只能填一次
    email = (data.get("email") or "").strip()
    phone = (data.get("phone") or "").strip()
    conds = []
    if email:
        conds.append(func.lower(Rsvp.email) == email.lower())
    if phone:
        conds.append(Rsvp.phone == phone)
    if conds and db.scalars(select(Rsvp).where(or_(*conds))).first():
        raise HTTPException(
            409, "您已經填過囉！如果需要修改內容，請直接聯繫宣文或孟庭"
        )
    if not data["attending"]:
        # 不出席：人數歸零、日期偏好無意義
        data.update(adult_count=0, child_count=0, date_preference="both")

    record = Rsvp(**data)
    db.add(record)
    db.commit()
    db.refresh(record)

    cache.invalidate_stats()

    groups, guests = _attending_totals(db)
    send_telegram(phase1_message(record, groups, guests))
    return record


# ===== Phase 2：先用 Email/電話找到自己 =====
@router.post("/rsvp/lookup", response_model=LookupOut)
def lookup(payload: LookupIn, db: Session = Depends(get_db)):
    if not is_phase2_open(db):
        raise HTTPException(403, "第二階段尚未開放，收到我們的通知後再回來填喔")
    record = _find_by_contact(db, payload.contact)
    if not record:
        return LookupOut(found=False)
    return LookupOut(
        found=True,
        name=record.name,
        attending=record.attending,
        details_completed=record.details_completed,
        public_id=record.public_id,
        adult_count=record.adult_count,
        child_count=record.child_count,
        baby_chair_count=record.baby_chair_count,
        veg_type=record.veg_type,
        dietary_note=record.dietary_note,
        main_course=record.main_course,
        kids_meal_count=record.kids_meal_count,
        remark=record.remark,
    )


# ===== Phase 2：送出詳細調查（補到同一筆）=====
@router.post("/rsvp/details", response_model=RsvpOut)
def submit_phase2(payload: Phase2Details, db: Session = Depends(get_db)):
    if not is_phase2_open(db):
        raise HTTPException(403, "第二階段尚未開放，收到我們的通知後再回來填喔")
    record = _find_by_contact(db, payload.contact)
    if not record:
        raise HTTPException(
            404, "找不到您的意願調查紀錄，請確認 Email／電話與第一階段填寫的相同。"
        )
    if not record.attending:
        raise HTTPException(400, "您先前回覆無法出席，若有變動請直接聯繫我們 🙏")

    # 再次確認人數
    record.adult_count = payload.adult_count
    record.child_count = payload.child_count
    # 主餐份數（只保留有填的；總數不可超過大人人數）
    mains = {k: int(v) for k, v in payload.main_course.items() if v and int(v) > 0}
    if sum(mains.values()) > payload.adult_count:
        raise HTTPException(400, "主餐總份數不可超過大人人數，請調整後再送出")
    if payload.kids_meal_count > payload.child_count:
        raise HTTPException(400, "兒童餐點份數不可超過小孩人數，請調整後再送出")
    record.main_course_json = json.dumps(mains, ensure_ascii=False)
    record.kids_meal_count = payload.kids_meal_count
    record.baby_chair_count = payload.baby_chair_count
    record.veg_type = payload.veg_type
    record.dietary_note = payload.dietary_note
    record.remark = payload.remark
    # 素食人數 = 主餐「素食」份數（給統計用）
    record.veg_count = mains.get("素食", 0)
    record.details_completed = True
    record.details_updated_at = func.now()
    db.commit()
    db.refresh(record)

    cache.invalidate_stats()

    groups, _ = _attending_totals(db)
    done = db.scalar(
        select(func.count()).select_from(Rsvp).where(
            Rsvp.attending.is_(True), Rsvp.details_completed.is_(True), Rsvp.is_test.is_(False)
        )
    ) or 0
    send_telegram(phase2_message(record, done, groups))
    return record
