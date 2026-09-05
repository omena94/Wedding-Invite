"""賓客端 API（公開）：Phase 1 意願調查、Phase 2 詳細調查。"""
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import cache
from ..database import get_db
from ..models import Rsvp
from ..notify import phase1_message, phase2_message, send_telegram
from ..schemas import LookupIn, LookupOut, Phase1Create, Phase2Details, GuestReceipt, VerificationIn, VerifyCodeIn
from ..contacts import normalize_phone, phone_column
from ..guest_access import access_token, token_guest, new_challenge, verify_challenge
from ..mailer import smtp_ready, send_one
from ..security import optional_staff
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
    """用 Email 或電話找到唯一紀錄；同聯絡方式有多筆時不猜測身分。"""
    c = contact.strip()
    if not c:
        return None
    stmt = (
        select(Rsvp)
        .where(or_(func.lower(func.trim(Rsvp.email)) == c.lower(), phone_column(Rsvp.phone) == normalize_phone(c)))
        .order_by(Rsvp.created_at.desc())
    )
    rows = db.scalars(stmt.limit(2)).all()
    return rows[0] if len(rows) == 1 else None


def _authorized_record(db, payload, role):
    if payload.access_token:
        return db.scalar(select(Rsvp).where(Rsvp.public_id == token_guest(payload.access_token)))
    if role is not None:
        return _find_by_contact(db, payload.contact)
    raise HTTPException(401, "請先完成 Email 驗證，再讀取或修改回覆")


def _receipt(record):
    return GuestReceipt(name=record.name, attending=record.attending, adult_count=record.adult_count,
                        child_count=record.child_count, details_completed=record.details_completed,
                        main_course=record.main_course, access_token=access_token(record, receipt=True))


@router.post("/rsvp/verification")
def request_verification(payload: VerificationIn, request: Request, db: Session = Depends(get_db), role: str | None = Depends(optional_staff)):
    if not is_phase2_open(db) and role is None:
        raise HTTPException(403, "餐點回覆尚未開放")
    if not smtp_ready():
        raise HTTPException(503, "暫時無法寄送驗證碼，請稍後重試或聯絡新人協助")
    record = _find_by_contact(db, payload.contact)
    if not record or not record.email:
        raise HTTPException(400, "無法寄送驗證信，請確認原先填寫的 Email 或手機，或聯絡新人協助")
    challenge, code = new_challenge(db, record, request.client.host if request.client else "unknown")
    try:
        send_one(record.email, "Alan & Omena 婚禮回覆驗證碼", f"<p>您的驗證碼是 <strong>{code}</strong>，10 分鐘內有效。</p><p>若您沒有申請，請忽略這封信。</p>")
    except Exception:
        challenge.used = True
        db.commit()
        raise HTTPException(503, "驗證信暫時無法寄出，請稍後重試")
    return {"challenge_id": challenge.id, "message": "驗證碼已寄至原先填寫的 Email"}


@router.post("/rsvp/verify")
def verify_code(payload: VerifyCodeIn, db: Session = Depends(get_db)):
    record = db.get(Rsvp, verify_challenge(db, payload.challenge_id, payload.code))
    if not record:
        raise HTTPException(400, "回覆資料已變更，請重新驗證")
    return {"access_token": access_token(record)}


# ===== Phase 1：送出意願調查 =====
@router.post("/rsvp", response_model=GuestReceipt, status_code=201)
def create_phase1(payload: Phase1Create, db: Session = Depends(get_db)):
    data = payload.model_dump()

    # 防重複填寫：同一 Email 或電話只能填一次
    email = (data.get("email") or "").strip()
    phone = (data.get("phone") or "").strip()
    conds = []
    if email:
        conds.append(func.lower(Rsvp.email) == email.lower())
    if phone:
        conds.append(phone_column(Rsvp.phone) == phone)
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
    return _receipt(record)


# ===== Phase 2：先用 Email/電話找到自己 =====
@router.post("/rsvp/lookup", response_model=LookupOut)
def lookup(payload: LookupIn, db: Session = Depends(get_db), role: str | None = Depends(optional_staff)):
    # 後台登入者不受開放時間限制（預覽／測試用）
    if not is_phase2_open(db) and role is None:
        raise HTTPException(403, "第二階段尚未開放，收到我們的通知後再回來填喔")
    record = _authorized_record(db, payload, role)
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
        children=[{"height": c.get("height")} for c in record.children],
        access_token=access_token(record),
    )


# ===== Phase 2：送出詳細調查（補到同一筆）=====
@router.post("/rsvp/details", response_model=GuestReceipt)
def submit_phase2(payload: Phase2Details, db: Session = Depends(get_db), role: str | None = Depends(optional_staff)):
    if not is_phase2_open(db) and role is None:
        raise HTTPException(403, "第二階段尚未開放，收到我們的通知後再回來填喔")
    record = _authorized_record(db, payload, role)
    if not record:
        raise HTTPException(
            404, "找不到您的意願調查紀錄，請確認 Email／電話與第一階段填寫的相同。"
        )
    if not record.attending:
        raise HTTPException(400, "您先前回覆無法出席，若有變動請直接聯繫我們 🙏")

    # 每位大人恰好一份主餐，驗證完成前不修改紀錄。
    if any(k not in {"牛排", "雞腿排", "鮭魚排", "素食"} or v < 0 for k, v in payload.main_course.items()):
        raise HTTPException(400, "請從提供的主餐中選擇，份數不可為負數")
    mains = {k: v for k, v in payload.main_course.items() if v > 0}
    if sum(mains.values()) != payload.adult_count:
        raise HTTPException(400, "請為每位大人選一份主餐，主餐總份數須等於大人人數")
    if payload.baby_chair_count > payload.child_count:
        raise HTTPException(400, "兒童椅數量不可超過小孩人數")
    if payload.kids_meal_count > payload.child_count:
        raise HTTPException(400, "兒童餐點份數不可超過小孩人數，請調整後再送出")
    record.adult_count = payload.adult_count
    record.child_count = payload.child_count
    record.main_course_json = json.dumps(mains, ensure_ascii=False)
    record.kids_meal_count = payload.kids_meal_count
    # 每個小孩的身高（依人數對齊；賓客不能改計價方式，保留後台原本指定的）
    old_children = record.children
    new_children = []
    for i in range(payload.child_count):
        given = payload.children[i] if i < len(payload.children) else None
        prev = old_children[i] if i < len(old_children) else {}
        new_children.append({
            "height": given.height if given is not None else prev.get("height"),
            "pricing": prev.get("pricing", "auto"),
        })
    record.children_json = json.dumps(new_children, ensure_ascii=False)
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
    return _receipt(record)
