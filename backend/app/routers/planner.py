"""籌備後台 API（僅限新人）：設定、總覽、廠商、報價、花費、付款、待辦、備忘、活動環節、檔案。"""
import mimetypes
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import case, func, or_, select, update
from sqlalchemy.orm import Session, selectinload

from .. import live
from ..config import settings
from ..database import get_db
from ..models import (
    Expense, FileAsset, GiftOrder, Memo, MenuItem, PackingItem, Payment, ProgramGame, ProgramIdea, ProgramSegment, Quote, Rsvp, Task, Vendor,
    VendorCategory,
)
from ..schemas import (
    BanquetPatch,
    CategoryIn,
    CategoryPatch,
    CategoryReorder,
    ExpenseIn,
    ExpensePatch,
    FilePatch,
    GameIn,
    GamePatch,
    IdeaIn,
    IdeaPatch,
    MemoIn,
    MemoPatch,
    MenuImport,
    MenuItemIn,
    MenuItemPatch,
    MenuReorder,
    PackingBulk,
    PackingItemIn,
    PackingItemPatch,
    PackingPresetIn,
    PaymentIn,
    PaymentPatch,
    QuoteIn,
    QuotePatch,
    SegmentIn,
    SegmentPatch,
    SegmentReorder,
    TaskIn,
    TaskPatch,
    VendorIn,
    VendorPatch,
)
from ..security import CoupleRequired
from ..thumbs import is_image, make_thumb
from ..stage import (
    ALL_KEYS,
    BANQUET_EXPENSE_KEY,
    PHASE2_KEY,
    banquet_estimate,
    banquet_params,
    clean_plates_off,
    get_all,
    get_setting,
    parse_dt,
    public_stage,
    set_setting,
)

from ..permissions import PlannerPerm  # noqa: E402  2026-09-27 依路徑對應的功能鑰匙檢查（設定頁可調）

router = APIRouter(prefix="/api/planner", tags=["planner"], dependencies=[PlannerPerm])


# ---------------------------------------------------------------------
# 輸出格式（手動組 dict，方便加上加總欄位）
# ---------------------------------------------------------------------
def _payment_out(p: Payment, e: Expense | None = None) -> dict:
    e = e or p.expense
    v = e.vendor if e else None
    return {
        "id": p.id,
        "expense_id": p.expense_id,
        "title": p.title,
        "amount": p.amount,
        "due_date": p.due_date.isoformat() if p.due_date else None,
        "paid_date": p.paid_date.isoformat() if p.paid_date else None,
        "method": p.method,
        "payer": p.payer,
        "note": p.note,
        "sort_order": p.sort_order,
        "expense_title": e.title if e else "",
        "category": e.category if e else "",
        "vendor_id": v.id if v else None,
        "vendor_name": v.name if v else "",
    }


def _expense_out(e: Expense, banquet_id: int | None = None) -> dict:
    payments = sorted(e.payments, key=lambda p: (p.sort_order, p.id))
    paid = sum(p.amount for p in payments if p.paid_date)
    scheduled = sum(p.amount for p in payments if not p.paid_date)
    # 合約金額 0 = 還沒簽約（例如先付試吃盒）：付多少算多少，不算尚欠也不算溢付（2026-09-11）
    unsigned = e.contract_amount <= 0
    effective = paid + scheduled if unsigned else e.contract_amount
    unpaid = scheduled if unsigned else max(0, e.contract_amount - paid)
    return {
        "id": e.id,
        "vendor_id": e.vendor_id,
        "vendor_name": e.vendor.name if e.vendor else "",
        "category": e.category,
        "title": e.title,
        "budget_amount": e.budget_amount,
        "contract_amount": e.contract_amount,
        "unsigned": unsigned,               # 還沒簽約：合約金額 0
        "effective_contract": effective,    # 拿來加總的金額：簽約金額，或未簽約時的已付＋已排
        "paid_by": e.paid_by,
        "note": e.note,
        "due_date": e.due_date.isoformat() if e.due_date else None,
        "pay_method": e.pay_method or "",
        "banquet": banquet_id is not None and e.id == banquet_id,  # 婚宴那筆：金額由預估／簽約金額決定，不能刪
        "paid_total": paid,
        "unpaid_total": unpaid,
        "scheduled_unpaid": scheduled,
        "unscheduled_unpaid": 0 if unsigned else max(0, unpaid - scheduled),
        "overpaid_total": 0 if unsigned else max(0, paid - e.contract_amount),
        "gift_order_id": e.gift_order.id if e.gift_order else None,
        "payments": [_payment_out(p, e) for p in payments],
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }


def _quote_out(q: Quote) -> dict:
    return {
        "id": q.id,
        "vendor_id": q.vendor_id,
        "item": q.item,
        "price": q.price,
        "note": q.note,
        "sort_order": q.sort_order,
    }


def _file_out(f: FileAsset) -> dict:
    return {
        "id": f.id,
        "filename": f.filename,
        "mime": f.mime,
        "size": f.size,
        "kind": f.kind,
        "is_public": f.is_public,
        "vendor_id": f.vendor_id,
        "vendor_name": f.vendor.name if f.vendor else "",
        "expense_id": f.expense_id,
        "payment_id": f.payment_id,
        "note": f.note,
        "caption": f.caption or "",
        "album": f.album or "",
        "sort_order": f.sort_order or 0,
        "has_thumb": bool(f.thumb_name),
        "created_at": f.created_at.isoformat() if f.created_at else None,
    }


def _task_out(t: Task) -> dict:
    return {
        "id": t.id,
        "title": t.title,
        "kind": t.kind,
        "topic": t.topic or "",
        "due_time": t.due_time or "",
        "due_date": t.due_date.isoformat() if t.due_date else None,
        "done": t.done,
        "assignee": t.assignee,
        "vendor_id": t.vendor_id,
        "vendor_name": t.vendor.name if t.vendor else "",
        "note": t.note,
        "sort_order": t.sort_order,
    }


def _vendor_out(v: Vendor) -> dict:
    contract = sum(e.contract_amount for e in v.expenses)
    paid = sum(p.amount for e in v.expenses for p in e.payments if p.paid_date)
    return {
        "id": v.id,
        "name": v.name,
        "category": v.category,
        "contact_name": v.contact_name,
        "phone": v.phone,
        "line_id": v.line_id,
        "email": v.email,
        "address": v.address,
        "website": v.website,
        "status": v.status,
        "rating": v.rating,
        "note": v.note,
        "quotes": [_quote_out(q) for q in sorted(v.quotes, key=lambda q: (q.sort_order, q.id))],
        "contract_total": contract,
        "paid_total": paid,
        "expense_count": len(v.expenses),
        "file_count": len(v.files),
        "open_task_count": sum(1 for t in v.tasks if not t.done),
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }


_VENDOR_LOAD = (
    selectinload(Vendor.quotes),
    selectinload(Vendor.expenses).selectinload(Expense.payments),
    selectinload(Vendor.files),
    selectinload(Vendor.tasks),
)
_EXPENSE_LOAD = (selectinload(Expense.payments), selectinload(Expense.vendor))


def _get_or_404(db: Session, model, obj_id: int, label: str):
    obj = db.get(model, obj_id)
    if not obj:
        raise HTTPException(404, f"找不到{label}")
    return obj


# ---------------------------------------------------------------------
# 設定
# ---------------------------------------------------------------------
@router.get("/settings")
def get_settings(db: Session = Depends(get_db)):
    return {"values": get_all(db), "stage": public_stage(db)}


@router.patch("/settings")
def patch_settings(values: dict[str, str], db: Session = Depends(get_db)):
    for key, value in values.items():
        if key not in ALL_KEYS:
            raise HTTPException(400, f"未知的設定：{key}")
        value = (value or "").strip()
        if key == "wall_pace" and value not in ("", "fast", "normal", "slow"):
            raise HTTPException(400, "節奏只能是快、中、慢")
        if key == "wall_plates_off":
            value = clean_plates_off(value)
        if key == PHASE2_KEY and value and parse_dt(value) is None:
            raise HTTPException(400, "第二階段開放時間格式不正確")
        set_setting(db, key, value)
    db.commit()
    if any(k.startswith("wall_") for k in values):  # 留言開關、版面、節奏：大螢幕的 feed 會變，推播叫它馬上抓
        live.publish({"t": "feed"})
    return {"values": get_all(db), "stage": public_stage(db)}


# ---------------------------------------------------------------------
# 婚宴費用預估（依賓客回覆的出席人數）
# ---------------------------------------------------------------------
def _banquet_counts(db: Session) -> tuple[dict, list[dict]]:
    """回傳（摘要, 每個小孩的清單）。小孩清單來自每組賓客的身高資料，沒填的補空白。"""
    rows = db.scalars(select(Rsvp).where(Rsvp.attending.is_(True), Rsvp.is_test.is_(False))).all()
    children: list[dict] = []
    adults = kids_meals = veg_adults = 0
    for r in rows:
        a = int(r.adult_count or 0)
        adults += a
        kids_meals += int(r.kids_meal_count or 0)
        # 素食份數來自主餐選「素食」，每組不會超過大人數（第二階段沒填就是 0）
        veg_adults += max(0, min(int(r.veg_count or 0), a))
        children.extend(r.children)
    heights_filled = sum(1 for c in children if c.get("height") is not None or c.get("pricing") != "auto")
    return (
        {
            "adults": adults,
            "children": len(children),
            "children_with_height": heights_filled,
            "kids_meals": kids_meals,
            "veg_adults": veg_adults,
            "groups": len(rows),
        },
        children,
    )


def _banquet_id(db: Session) -> int | None:
    """跟婚宴預估綁在一起的那筆花費 id（還沒建就 None）。"""
    try:
        return int(get_setting(db, BANQUET_EXPENSE_KEY) or 0) or None
    except ValueError:
        return None


def sync_banquet_expense(db: Session) -> Expense:
    """婚宴也是一筆花費（2026-09-10 新人要求跟喜餅、婚紗一樣有分期付款）。
    這筆花費由系統建立並綁定；合約金額 = 簽約金額（婚宴面板填的），還沒簽約就 = 依出席人數的預估，
    人數或價格一變就跟著更新。付款（定金、尾款）跟其他花費一樣掛在底下。"""
    params = banquet_params(db)
    counts, children = _banquet_counts(db)
    total = params["contract_amount"] or banquet_estimate(params, counts["adults"], children, veg_adults=counts["veg_adults"])["total"]
    e = db.get(Expense, _banquet_id(db) or 0)
    if e is None:
        e = Expense(category="婚宴", title="婚宴酒席（依出席人數預估）", paid_by="shared", contract_amount=total,
                    note="金額由「婚宴費用預估」自動帶入；簽約後到預估面板填「簽約金額」就改用實際數字。定金、尾款請在這筆底下新增分期。")
        db.add(e)
        db.flush()
        set_setting(db, BANQUET_EXPENSE_KEY, str(e.id))
        db.commit()
    elif e.contract_amount != total or e.category != "婚宴":
        e.contract_amount = total
        e.category = "婚宴"
        db.commit()
    return e


def _banquet_out(db: Session) -> dict:
    params = banquet_params(db)
    counts, children = _banquet_counts(db)
    a = counts["adults"]
    v = counts["veg_adults"]
    e = sync_banquet_expense(db)
    db.expire(e)  # 同一個 session 內剛加過付款時，付款集合要重新讀才會是最新的
    e = db.scalars(select(Expense).options(*_EXPENSE_LOAD).where(Expense.id == e.id)).one()
    return {
        "params": params,
        "counts": counts,
        "estimate": banquet_estimate(params, a, children, veg_adults=v),
        # 沒填身高的小孩改用不同計價時的合計（有填的照身高算，不受影響）
        "scenarios": {m: banquet_estimate(params, a, children, m, veg_adults=v)["total"] for m in ("free", "half", "full")},
        # 綁定的花費：合約金額、已付、尚欠，讓面板可以顯示付款進度
        "expense": _expense_out(e, banquet_id=e.id),
    }


@router.get("/banquet")
def get_banquet(db: Session = Depends(get_db)):
    return _banquet_out(db)


@router.patch("/banquet")
def patch_banquet(payload: BanquetPatch, db: Session = Depends(get_db)):
    data = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    current = banquet_params(db)
    free = data.get("child_free_below", current["child_free_below"])
    half = data.get("child_half_below", current["child_half_below"])
    if free > half:
        raise HTTPException(400, "免費身高門檻不能高於半價身高門檻")
    for k, v in data.items():
        set_setting(db, f"banquet_{k}", str(v))
    db.commit()
    return _banquet_out(db)


# ---------------------------------------------------------------------
# 總覽
# ---------------------------------------------------------------------
@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db)):
    sync_banquet_expense(db)
    budget_total = db.scalar(select(func.coalesce(func.sum(Expense.budget_amount), 0))) or 0
    # 跟花費頁同一套算法：未簽約（合約 0）的項目以已付＋已排計；某筆溢付不可沖掉另一筆欠款
    rows = [_expense_out(e) for e in db.scalars(select(Expense).options(*_EXPENSE_LOAD)).all()]
    contract_total = sum(r["effective_contract"] for r in rows)
    paid_total = sum(r["paid_total"] for r in rows)
    unpaid_total = sum(r["unpaid_total"] for r in rows)

    upcoming = db.scalars(
        select(Payment)
        .options(selectinload(Payment.expense).selectinload(Expense.vendor))
        .where(Payment.paid_date.is_(None))
        .order_by(Payment.due_date.asc().nulls_last(), Payment.id.asc())
        .limit(8)
    ).all()
    tasks = db.scalars(
        select(Task)
        .options(selectinload(Task.vendor))
        .where(Task.done.is_(False))
        .order_by(Task.due_date.asc().nulls_last(), Task.sort_order.asc(), Task.id.asc())
        .limit(8)
    ).all()
    status_rows = db.execute(select(Vendor.status, func.count()).group_by(Vendor.status)).all()
    vendor_counts = {s: c for s, c in status_rows}
    open_tasks_total = db.scalar(select(func.count()).select_from(Task).where(Task.done.is_(False))) or 0

    return {
        "budget": {
            "budget_total": budget_total,
            "contract_total": contract_total,
            "paid_total": paid_total,
            "unpaid_total": unpaid_total,
        },
        "upcoming_payments": [_payment_out(p) for p in upcoming],
        "open_tasks": [_task_out(t) for t in tasks],
        "open_tasks_total": open_tasks_total,
        "vendor_counts": {"total": sum(vendor_counts.values()), **vendor_counts},
        "stage": public_stage(db),
        "banquet": _banquet_out(db),
    }


# ---------------------------------------------------------------------
# 類別（廠商與花費共用；可增刪改、排序）
# ---------------------------------------------------------------------
DEFAULT_CATEGORIES = [
    "婚宴場地", "婚紗攝影", "婚禮禮服租借", "新秘造型", "婚戒", "喜餅", "喜帖",
    "婚禮攝影", "主持", "樂團表演", "婚車", "佈置花藝", "蜜月", "其他",
]
OTHER_CATEGORY = "其他"


def _category_rows(db: Session) -> list[VendorCategory]:
    return db.scalars(
        select(VendorCategory).order_by(VendorCategory.sort_order.asc(), VendorCategory.id.asc())
    ).all()


def _ensure_categories(db: Session) -> list[VendorCategory]:
    """第一次使用時塞預設清單；廠商或花費用到但清單裡沒有的類別也補進來。"""
    rows = _category_rows(db)
    if not rows:
        for i, name in enumerate(DEFAULT_CATEGORIES):
            db.add(VendorCategory(name=name, sort_order=i))
        db.commit()
        rows = _category_rows(db)
    known = {r.name for r in rows}
    used = set(db.scalars(select(Vendor.category).distinct()).all()) | set(
        db.scalars(select(Expense.category).distinct()).all()
    )
    missing = [u for u in used if u and u not in known]
    if missing:
        base = max((r.sort_order for r in rows), default=-1) + 1
        for i, name in enumerate(sorted(missing)):
            db.add(VendorCategory(name=name, sort_order=base + i))
        db.commit()
        rows = _category_rows(db)
    return rows


def _category_out(db: Session, rows: list[VendorCategory]) -> list[dict]:
    vcount = dict(db.execute(select(Vendor.category, func.count()).group_by(Vendor.category)).all())
    ecount = dict(db.execute(select(Expense.category, func.count()).group_by(Expense.category)).all())
    return [
        {
            "id": r.id,
            "name": r.name,
            "sort_order": r.sort_order,
            "vendor_count": vcount.get(r.name, 0),
            "expense_count": ecount.get(r.name, 0),
        }
        for r in rows
    ]


@router.get("/categories")
def list_categories(db: Session = Depends(get_db)):
    return _category_out(db, _ensure_categories(db))


@router.post("/categories", status_code=201)
def create_category(payload: CategoryIn, db: Session = Depends(get_db)):
    name = payload.name.strip()
    rows = _ensure_categories(db)
    if any(r.name == name for r in rows):
        raise HTTPException(400, f"已經有「{name}」這個類別")
    db.add(VendorCategory(name=name, sort_order=max((r.sort_order for r in rows), default=-1) + 1))
    db.commit()
    return _category_out(db, _category_rows(db))


@router.post("/categories/reorder")
def reorder_categories(payload: CategoryReorder, db: Session = Depends(get_db)):
    rows = {r.id: r for r in _category_rows(db)}
    order = [i for i in payload.ids if i in rows] + [i for i in rows if i not in payload.ids]
    for pos, cid in enumerate(order):
        rows[cid].sort_order = pos
    db.commit()
    return _category_out(db, _category_rows(db))


@router.patch("/categories/{category_id}")
def update_category(category_id: int, payload: CategoryPatch, db: Session = Depends(get_db)):
    row = _get_or_404(db, VendorCategory, category_id, "類別")
    data = payload.model_dump(exclude_unset=True)
    new_name = (data.get("name") or "").strip()
    if new_name and new_name != row.name:
        if db.scalar(select(func.count()).select_from(VendorCategory).where(VendorCategory.name == new_name)):
            raise HTTPException(400, f"已經有「{new_name}」這個類別")
        # 改名：用到這個類別的廠商與花費一併更新
        db.execute(update(Vendor).where(Vendor.category == row.name).values(category=new_name))
        db.execute(update(Expense).where(Expense.category == row.name).values(category=new_name))
        row.name = new_name
    if data.get("sort_order") is not None:
        row.sort_order = data["sort_order"]
    db.commit()
    return _category_out(db, _category_rows(db))


@router.delete("/categories/{category_id}")
def delete_category(category_id: int, db: Session = Depends(get_db)):
    """刪除類別；原本用這個類別的廠商與花費移到「其他」。"""
    row = _get_or_404(db, VendorCategory, category_id, "類別")
    if row.name == OTHER_CATEGORY:
        raise HTTPException(400, "「其他」是預設類別，不能刪除")
    rows = _category_rows(db)
    if not any(r.name == OTHER_CATEGORY for r in rows):
        db.add(VendorCategory(name=OTHER_CATEGORY, sort_order=max((r.sort_order for r in rows), default=-1) + 1))
        db.flush()
    db.execute(update(Vendor).where(Vendor.category == row.name).values(category=OTHER_CATEGORY))
    db.execute(update(Expense).where(Expense.category == row.name).values(category=OTHER_CATEGORY))
    db.delete(row)
    db.commit()
    return _category_out(db, _category_rows(db))


# ---------------------------------------------------------------------
# 廠商
# ---------------------------------------------------------------------
@router.get("/vendors")
def list_vendors(
    category: str = Query(""),
    status: str = Query(""),
    q: str = Query(""),
    db: Session = Depends(get_db),
):
    stmt = select(Vendor).options(*_VENDOR_LOAD)
    if category:
        stmt = stmt.where(Vendor.category == category)
    if status:
        stmt = stmt.where(Vendor.status == status)
    if q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            Vendor.name.ilike(like) | Vendor.contact_name.ilike(like) | Vendor.note.ilike(like)
        )
    stmt = stmt.order_by(Vendor.category.asc(), Vendor.name.asc())
    return [_vendor_out(v) for v in db.scalars(stmt).all()]


@router.get("/vendors/categories")
def vendor_categories(db: Session = Depends(get_db)):
    """比價頁用：依類別清單的順序列出每個類別有幾家廠商。"""
    return [{"category": c["name"], "count": c["vendor_count"]} for c in _category_out(db, _ensure_categories(db))]


@router.post("/vendors", status_code=201)
def create_vendor(payload: VendorIn, db: Session = Depends(get_db)):
    v = Vendor(**payload.model_dump())
    db.add(v)
    db.commit()
    v = db.scalars(select(Vendor).options(*_VENDOR_LOAD).where(Vendor.id == v.id)).one()
    return _vendor_out(v)


@router.get("/vendors/{vendor_id}")
def get_vendor(vendor_id: int, db: Session = Depends(get_db)):
    v = db.scalars(select(Vendor).options(*_VENDOR_LOAD).where(Vendor.id == vendor_id)).first()
    if not v:
        raise HTTPException(404, "找不到廠商")
    expenses = db.scalars(
        select(Expense).options(*_EXPENSE_LOAD).where(Expense.vendor_id == vendor_id).order_by(Expense.id)
    ).all()
    files = db.scalars(
        select(FileAsset)
        .options(selectinload(FileAsset.vendor))
        .where(FileAsset.vendor_id == vendor_id)
        .order_by(FileAsset.created_at.desc(), FileAsset.id.desc())
    ).all()
    tasks = db.scalars(
        select(Task)
        .options(selectinload(Task.vendor))
        .where(Task.vendor_id == vendor_id)
        .order_by(Task.done.asc(), Task.due_date.asc().nulls_last(), Task.id.asc())
    ).all()
    return {
        **_vendor_out(v),
        "expenses": [_expense_out(e) for e in expenses],
        "files": [_file_out(f) for f in files],
        "tasks": [_task_out(t) for t in tasks],
    }


@router.patch("/vendors/{vendor_id}")
def update_vendor(vendor_id: int, payload: VendorPatch, db: Session = Depends(get_db)):
    v = _get_or_404(db, Vendor, vendor_id, "廠商")
    for k, val in payload.model_dump(exclude_unset=True).items():
        setattr(v, k, val)
    db.commit()
    v = db.scalars(select(Vendor).options(*_VENDOR_LOAD).where(Vendor.id == vendor_id)).one()
    return _vendor_out(v)


@router.delete("/vendors/{vendor_id}", status_code=204)
def delete_vendor(vendor_id: int, db: Session = Depends(get_db)):
    v = _get_or_404(db, Vendor, vendor_id, "廠商")
    if db.scalar(select(GiftOrder.id).where(GiftOrder.vendor_id == vendor_id).limit(1)):
        raise HTTPException(400, "此廠商已有喜餅訂購紀錄，請保留以供對帳")
    # 花費、檔案、待辦保留但解除連結（DB 設定 ON DELETE SET NULL；這裡再保險一次）
    for e in v.expenses:
        e.vendor_id = None
    for f in v.files:
        f.vendor_id = None
    for t in v.tasks:
        t.vendor_id = None
    db.delete(v)
    db.commit()
    return None


# ---------------------------------------------------------------------
# 報價（掛在廠商底下）與比價
# ---------------------------------------------------------------------
@router.post("/vendors/{vendor_id}/quotes", status_code=201)
def create_quote(vendor_id: int, payload: QuoteIn, db: Session = Depends(get_db)):
    _get_or_404(db, Vendor, vendor_id, "廠商")
    q = Quote(vendor_id=vendor_id, **payload.model_dump())
    db.add(q)
    db.commit()
    db.refresh(q)
    return _quote_out(q)


@router.patch("/quotes/{quote_id}")
def update_quote(quote_id: int, payload: QuotePatch, db: Session = Depends(get_db)):
    q = _get_or_404(db, Quote, quote_id, "報價")
    for k, val in payload.model_dump(exclude_unset=True).items():
        setattr(q, k, val)
    db.commit()
    db.refresh(q)
    return _quote_out(q)


@router.delete("/quotes/{quote_id}", status_code=204)
def delete_quote(quote_id: int, db: Session = Depends(get_db)):
    q = _get_or_404(db, Quote, quote_id, "報價")
    db.delete(q)
    db.commit()
    return None


@router.get("/compare")
def compare(category: str = Query(...), db: Session = Depends(get_db)):
    """同類別廠商的報價並排：items 是所有出現過的報價項目，rows 每家一列。"""
    vendors = db.scalars(
        select(Vendor)
        .options(selectinload(Vendor.quotes))
        .where(Vendor.category == category)
        .order_by(Vendor.name.asc())
    ).all()
    items: list[str] = []
    for v in vendors:
        for q in sorted(v.quotes, key=lambda x: (x.sort_order, x.id)):
            if q.item not in items:
                items.append(q.item)
    rows = []
    for v in vendors:
        prices = {}
        notes = {}
        for q in v.quotes:
            prices[q.item] = q.price
            if q.note:
                notes[q.item] = q.note
        rows.append(
            {
                "id": v.id,
                "name": v.name,
                "status": v.status,
                "rating": v.rating,
                "phone": v.phone,
                "line_id": v.line_id,
                "note": v.note,
                "prices": prices,
                "quote_notes": notes,
            }
        )
    return {"category": category, "items": items, "rows": rows}


# ---------------------------------------------------------------------
# 花費 & 付款期程
# ---------------------------------------------------------------------
@router.get("/expenses")
def list_expenses(db: Session = Depends(get_db)):
    banquet = sync_banquet_expense(db).id  # 人數變了合約金額要跟著變，列表前先同步
    rows = db.scalars(
        select(Expense).options(*_EXPENSE_LOAD).order_by(Expense.category.asc(), Expense.id.asc())
    ).all()
    return [_expense_out(e, banquet_id=banquet) for e in rows]


@router.post("/expenses", status_code=201)
def create_expense(payload: ExpenseIn, db: Session = Depends(get_db)):
    if payload.vendor_id is not None:
        _get_or_404(db, Vendor, payload.vendor_id, "廠商")
    e = Expense(**payload.model_dump())
    db.add(e)
    db.commit()
    e = db.scalars(select(Expense).options(*_EXPENSE_LOAD).where(Expense.id == e.id)).one()
    return _expense_out(e)


@router.patch("/expenses/{expense_id}")
def update_expense(expense_id: int, payload: ExpensePatch, db: Session = Depends(get_db)):
    e = db.scalar(select(Expense).where(Expense.id == expense_id).with_for_update())
    if e is None:
        raise HTTPException(404, "找不到花費項目")
    data = payload.model_dump(exclude_unset=True)
    if expense_id == _banquet_id(db):
        if data.get("contract_amount", e.contract_amount) != e.contract_amount or data.get("category", e.category) != e.category:
            raise HTTPException(400, "婚宴這筆的金額由「婚宴費用預估」決定；簽約後請到預估面板填「簽約金額」")
    if db.scalar(select(GiftOrder.id).where(GiftOrder.expense_id == expense_id)):
        if (data.get("contract_amount", e.contract_amount) != e.contract_amount
                or data.get("title", e.title) != e.title
                or data.get("vendor_id") not in (None, e.vendor_id) or data.get("clear_vendor")):
            raise HTTPException(400, "此花費連結喜餅訂購，名稱、合約金額與廠商請至「喜餅 → 訂購與費用」編輯")
    if data.pop("clear_vendor", False):
        e.vendor_id = None
        data.pop("vendor_id", None)
    if data.get("vendor_id") is not None:
        _get_or_404(db, Vendor, data["vendor_id"], "廠商")
    elif "vendor_id" in data:
        data.pop("vendor_id")  # None 代表不變
    if data.pop("clear_due_date", False):
        e.due_date = None
        data.pop("due_date", None)
    elif "due_date" in data and data["due_date"] is None:
        data.pop("due_date")  # None 代表不變
    for k, val in data.items():
        setattr(e, k, val)
    db.commit()
    e = db.scalars(select(Expense).options(*_EXPENSE_LOAD).where(Expense.id == expense_id)).one()
    return _expense_out(e)


@router.delete("/expenses/{expense_id}", status_code=204)
def delete_expense(expense_id: int, db: Session = Depends(get_db)):
    e = db.scalar(select(Expense).where(Expense.id == expense_id).with_for_update())
    if e is None:
        raise HTTPException(404, "找不到花費項目")
    if db.scalar(select(GiftOrder.id).where(GiftOrder.expense_id == expense_id)):
        raise HTTPException(400, "此花費已有喜餅訂購，請保留訂購與付款紀錄供對帳")
    if expense_id == _banquet_id(db):
        raise HTTPException(400, "婚宴這筆是跟「婚宴費用預估」綁在一起的，不能刪除")
    db.delete(e)
    db.commit()
    return None


@router.get("/payments")
def list_payments(status: str = Query("all"), db: Session = Depends(get_db)):
    stmt = select(Payment).options(selectinload(Payment.expense).selectinload(Expense.vendor))
    if status == "unpaid":
        stmt = stmt.where(Payment.paid_date.is_(None))
    elif status == "paid":
        stmt = stmt.where(Payment.paid_date.is_not(None))
    stmt = stmt.order_by(Payment.due_date.asc().nulls_last(), Payment.id.asc())
    return [_payment_out(p) for p in db.scalars(stmt).all()]


@router.post("/expenses/{expense_id}/payments", status_code=201)
def create_payment(expense_id: int, payload: PaymentIn, db: Session = Depends(get_db)):
    _get_or_404(db, Expense, expense_id, "花費項目")
    p = Payment(expense_id=expense_id, **payload.model_dump())
    db.add(p)
    db.commit()
    p = db.scalars(
        select(Payment)
        .options(selectinload(Payment.expense).selectinload(Expense.vendor))
        .where(Payment.id == p.id)
    ).one()
    return _payment_out(p)


@router.patch("/payments/{payment_id}")
def update_payment(payment_id: int, payload: PaymentPatch, db: Session = Depends(get_db)):
    p = _get_or_404(db, Payment, payment_id, "付款")
    data = payload.model_dump(exclude_unset=True)
    if data.pop("clear_due_date", False):
        p.due_date = None
        data.pop("due_date", None)
    if data.pop("clear_paid_date", False):
        p.paid_date = None
        data.pop("paid_date", None)
    for k in ("due_date", "paid_date"):
        if k in data and data[k] is None:
            data.pop(k)  # None 代表不變
    for k, val in data.items():
        setattr(p, k, val)
    db.commit()
    p = db.scalars(
        select(Payment)
        .options(selectinload(Payment.expense).selectinload(Expense.vendor))
        .where(Payment.id == payment_id)
    ).one()
    return _payment_out(p)


@router.delete("/payments/{payment_id}", status_code=204)
def delete_payment(payment_id: int, db: Session = Depends(get_db)):
    p = _get_or_404(db, Payment, payment_id, "付款")
    db.delete(p)
    db.commit()
    return None


# ---------------------------------------------------------------------
# 待辦 / 時程
# ---------------------------------------------------------------------
@router.get("/tasks")
def list_tasks(status: str = Query("all"), db: Session = Depends(get_db)):
    stmt = select(Task).options(selectinload(Task.vendor))
    if status == "open":
        stmt = stmt.where(Task.done.is_(False))
    elif status == "done":
        stmt = stmt.where(Task.done.is_(True))
    stmt = stmt.order_by(Task.due_date.asc().nulls_last(), Task.due_time.asc(), Task.sort_order.asc(), Task.id.asc())
    return [_task_out(t) for t in db.scalars(stmt).all()]


# 行事曆與筆記共用的主題（2026-09-10）。內建六個，新人自訂的會跟著出現，沒人用了就自動消失
DEFAULT_TOPICS = ["婚紗攝影", "禮服", "喜餅", "婚宴", "喜帖與小物", "其他"]


@router.get("/topics")
def list_topics(db: Session = Depends(get_db)):
    used = [t for (t,) in db.execute(select(Memo.topic).distinct()).all()] + [t for (t,) in db.execute(select(Task.topic).distinct()).all()]
    out = list(DEFAULT_TOPICS)
    for t in used:
        if t and t not in out:
            out.append(t)
    return out


@router.post("/tasks", status_code=201)
def create_task(payload: TaskIn, db: Session = Depends(get_db)):
    if payload.vendor_id is not None:
        _get_or_404(db, Vendor, payload.vendor_id, "廠商")
    t = Task(**payload.model_dump())
    db.add(t)
    db.commit()
    t = db.scalars(select(Task).options(selectinload(Task.vendor)).where(Task.id == t.id)).one()
    return _task_out(t)


@router.patch("/tasks/{task_id}")
def update_task(task_id: int, payload: TaskPatch, db: Session = Depends(get_db)):
    t = _get_or_404(db, Task, task_id, "待辦")
    data = payload.model_dump(exclude_unset=True)
    if data.pop("clear_due_date", False):
        t.due_date = None
        data.pop("due_date", None)
    if data.pop("clear_vendor", False):
        t.vendor_id = None
        data.pop("vendor_id", None)
    if "due_date" in data and data["due_date"] is None:
        data.pop("due_date")
    if data.get("vendor_id") is not None:
        _get_or_404(db, Vendor, data["vendor_id"], "廠商")
    elif "vendor_id" in data:
        data.pop("vendor_id")
    for k, val in data.items():
        setattr(t, k, val)
    db.commit()
    t = db.scalars(select(Task).options(selectinload(Task.vendor)).where(Task.id == task_id)).one()
    return _task_out(t)


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: int, db: Session = Depends(get_db)):
    t = _get_or_404(db, Task, task_id, "待辦")
    db.delete(t)
    db.commit()
    return None


# ---------------------------------------------------------------------
# 筆記（2026-09-10 起；原「備忘」）。資料表欄位 question / answer / confirmed 對外叫 title / content / done
# ---------------------------------------------------------------------
MEMO_FIELD = {"title": "question", "content": "answer", "done": "confirmed"}


def _memo_out(m: Memo) -> dict:
    return {
        "id": m.id,
        "topic": m.topic,
        "title": m.question,
        "content": m.answer,
        "done": m.confirmed,
        "pinned": bool(m.pinned),
        "task_id": m.task_id,
        "task_title": m.task.title if m.task else "",
        "task_due_date": m.task.due_date.isoformat() if m.task and m.task.due_date else None,
        "task_done": bool(m.task.done) if m.task else False,
        "sort_order": m.sort_order,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "updated_at": m.updated_at.isoformat() if m.updated_at else None,
    }


def _memo_load(db: Session, memo_id: int) -> Memo:
    return db.scalars(select(Memo).options(selectinload(Memo.task)).where(Memo.id == memo_id)).one()


def _memo_check_links(db: Session, data: dict) -> None:
    if data.get("task_id") is not None:
        _get_or_404(db, Task, data["task_id"], "行事曆")


def _memo_columns(data: dict) -> dict:
    """API 的 title / content / done 換成資料表欄位名。"""
    return {MEMO_FIELD.get(k, k): v for k, v in data.items()}


@router.get("/memos")
def list_memos(
    status: str = Query("all"),
    topic: str | None = Query(None),
    task_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    stmt = select(Memo).options(selectinload(Memo.task))
    if status == "open":
        stmt = stmt.where(Memo.confirmed.is_(False))
    elif status == "done":
        stmt = stmt.where(Memo.confirmed.is_(True))
    if topic:
        stmt = stmt.where(Memo.topic == topic)
    if task_id is not None:
        stmt = stmt.where(Memo.task_id == task_id)
    # 釘選的最前面，再來未處理的，其餘照建立順序；主題分組交給前端
    stmt = stmt.order_by(Memo.pinned.desc(), Memo.confirmed.asc(), Memo.sort_order.asc(), Memo.id.asc())
    return [_memo_out(m) for m in db.scalars(stmt).all()]


@router.post("/memos", status_code=201)
def create_memo(payload: MemoIn, db: Session = Depends(get_db)):
    data = payload.model_dump()
    _memo_check_links(db, data)
    m = Memo(**_memo_columns(data))
    db.add(m)
    db.commit()
    return _memo_out(_memo_load(db, m.id))


@router.patch("/memos/{memo_id}")
def update_memo(memo_id: int, payload: MemoPatch, db: Session = Depends(get_db)):
    m = _get_or_404(db, Memo, memo_id, "筆記")
    data = payload.model_dump(exclude_unset=True)
    if data.pop("clear_task", False):
        m.task_id = None
        data.pop("task_id", None)
    # 沒帶或帶 null 的連結欄位一律不動，要解除請用 clear_task
    if "task_id" in data and data["task_id"] is None:
        data.pop("task_id")
    _memo_check_links(db, data)
    for k, val in _memo_columns(data).items():
        setattr(m, k, val)
    db.commit()
    return _memo_out(_memo_load(db, memo_id))


@router.delete("/memos/{memo_id}", status_code=204)
def delete_memo(memo_id: int, db: Session = Depends(get_db)):
    m = _get_or_404(db, Memo, memo_id, "筆記")
    db.delete(m)
    db.commit()
    return None


# ---------------------------------------------------------------------
# 活動環節（婚禮當天流程）與點子
# ---------------------------------------------------------------------
def _segment_out(s: ProgramSegment, idea_count: int = 0, game_count: int = 0) -> dict:
    return {
        "id": s.id,
        "title": s.title,
        "start_time": s.start_time,
        "duration_min": s.duration_min,
        "host": s.host,
        "note": s.note,
        "status": s.status,
        "sort_order": s.sort_order,
        "idea_count": idea_count,
        "game_count": game_count,
    }


def _idea_out(i: ProgramIdea) -> dict:
    return {
        "id": i.id,
        "content": i.content,
        "status": i.status,
        "segment_id": i.segment_id,
        "segment_title": i.segment.title if i.segment else "",
        "sort_order": i.sort_order,
        "created_at": i.created_at.isoformat() if i.created_at else None,
    }


def _segments_ordered(db: Session) -> list[ProgramSegment]:
    # 2026-10-01 新人要求：系統自動照開始時間排，不用再手動調順序。
    # 未定時間的排最後（彼此之間照原本的順序、再照建立順序）；"HH:MM" 字串直接比大小就是時間先後
    untimed = case((or_(ProgramSegment.start_time.is_(None), ProgramSegment.start_time == ""), 1), else_=0)
    return db.scalars(
        select(ProgramSegment).order_by(untimed, ProgramSegment.start_time.asc(), ProgramSegment.sort_order.asc(), ProgramSegment.id.asc())
    ).all()


@router.get("/program/segments")
def list_segments(db: Session = Depends(get_db)):
    counts = dict(
        db.execute(
            select(ProgramIdea.segment_id, func.count()).where(ProgramIdea.segment_id.is_not(None)).group_by(ProgramIdea.segment_id)
        ).all()
    )
    games = dict(
        db.execute(
            select(ProgramGame.segment_id, func.count()).where(ProgramGame.segment_id.is_not(None)).group_by(ProgramGame.segment_id)
        ).all()
    )
    return [_segment_out(s, counts.get(s.id, 0), games.get(s.id, 0)) for s in _segments_ordered(db)]


@router.post("/program/segments", status_code=201)
def create_segment(payload: SegmentIn, db: Session = Depends(get_db)):
    data = payload.model_dump()
    if not data.get("sort_order"):
        # 新環節排在最後
        data["sort_order"] = (db.scalar(select(func.max(ProgramSegment.sort_order))) or 0) + 1
    s = ProgramSegment(**data)
    db.add(s)
    db.commit()
    return _segment_out(s)


@router.patch("/program/segments/{segment_id}")
def update_segment(segment_id: int, payload: SegmentPatch, db: Session = Depends(get_db)):
    s = _get_or_404(db, ProgramSegment, segment_id, "活動環節")
    for k, val in payload.model_dump(exclude_unset=True).items():
        setattr(s, k, val)
    db.commit()
    count = db.scalar(select(func.count()).select_from(ProgramIdea).where(ProgramIdea.segment_id == segment_id)) or 0
    return _segment_out(s, count)


@router.post("/program/segments/reorder")
def reorder_segments(payload: SegmentReorder, db: Session = Depends(get_db)):
    """前端送由上到下的 id 清單；沒列到的環節維持在後面。"""
    order = {sid: i + 1 for i, sid in enumerate(payload.ids)}
    rest = len(order) + 1
    for s in _segments_ordered(db):
        if s.id in order:
            s.sort_order = order[s.id]
        else:
            s.sort_order = rest
            rest += 1
    db.commit()
    return list_segments(db)


@router.delete("/program/segments/{segment_id}", status_code=204)
def delete_segment(segment_id: int, db: Session = Depends(get_db)):
    s = _get_or_404(db, ProgramSegment, segment_id, "活動環節")
    # 點子留著，只解除連結（SQLite 測試環境沒開 FK 時也要一致）
    db.execute(update(ProgramIdea).where(ProgramIdea.segment_id == segment_id).values(segment_id=None))
    db.execute(update(ProgramGame).where(ProgramGame.segment_id == segment_id).values(segment_id=None))
    db.delete(s)
    db.commit()
    return None


@router.get("/program/ideas")
def list_ideas(status: str | None = Query(None), segment_id: int | None = Query(None), db: Session = Depends(get_db)):
    stmt = select(ProgramIdea).options(selectinload(ProgramIdea.segment))
    if status:
        stmt = stmt.where(ProgramIdea.status == status)
    if segment_id is not None:
        stmt = stmt.where(ProgramIdea.segment_id == segment_id)
    stmt = stmt.order_by(ProgramIdea.sort_order.asc(), ProgramIdea.id.desc())  # 新的想法在上面
    return [_idea_out(i) for i in db.scalars(stmt).all()]


@router.post("/program/ideas", status_code=201)
def create_idea(payload: IdeaIn, db: Session = Depends(get_db)):
    data = payload.model_dump()
    if data.get("segment_id") is not None:
        _get_or_404(db, ProgramSegment, data["segment_id"], "活動環節")
    i = ProgramIdea(**data)
    db.add(i)
    db.commit()
    i = db.scalars(select(ProgramIdea).options(selectinload(ProgramIdea.segment)).where(ProgramIdea.id == i.id)).one()
    return _idea_out(i)


@router.patch("/program/ideas/{idea_id}")
def update_idea(idea_id: int, payload: IdeaPatch, db: Session = Depends(get_db)):
    i = _get_or_404(db, ProgramIdea, idea_id, "點子")
    data = payload.model_dump(exclude_unset=True)
    if data.pop("clear_segment", False):
        i.segment_id = None
        data.pop("segment_id", None)
    if "segment_id" in data and data["segment_id"] is None:
        data.pop("segment_id")  # 帶 null 不動連結，要解除用 clear_segment
    if data.get("segment_id") is not None:
        _get_or_404(db, ProgramSegment, data["segment_id"], "活動環節")
    for k, val in data.items():
        setattr(i, k, val)
    db.commit()
    i = db.scalars(select(ProgramIdea).options(selectinload(ProgramIdea.segment)).where(ProgramIdea.id == idea_id)).one()
    return _idea_out(i)


@router.delete("/program/ideas/{idea_id}", status_code=204)
def delete_idea(idea_id: int, db: Session = Depends(get_db)):
    i = _get_or_404(db, ProgramIdea, idea_id, "點子")
    db.delete(i)
    db.commit()
    return None


# ---- 遊戲 ----
def _game_out(g: ProgramGame) -> dict:
    return {
        "id": g.id,
        "name": g.name,
        "rules": g.rules,
        "content": g.content,
        "prize": g.prize,
        "host": g.host,
        "judge": g.judge,
        "duration_min": g.duration_min,
        "props": g.props,
        "segment_id": g.segment_id,
        "segment_title": g.segment.title if g.segment else "",
        "sort_order": g.sort_order,
    }


def _game_load(db: Session, game_id: int) -> ProgramGame:
    return db.scalars(select(ProgramGame).options(selectinload(ProgramGame.segment)).where(ProgramGame.id == game_id)).one()


@router.get("/program/games")
def list_games(segment_id: int | None = Query(None), db: Session = Depends(get_db)):
    stmt = select(ProgramGame).options(selectinload(ProgramGame.segment))
    if segment_id is not None:
        stmt = stmt.where(ProgramGame.segment_id == segment_id)
    stmt = stmt.order_by(ProgramGame.sort_order.asc(), ProgramGame.id.asc())
    return [_game_out(g) for g in db.scalars(stmt).all()]


@router.get("/program/games/{game_id}")
def get_game(game_id: int, db: Session = Depends(get_db)):
    _get_or_404(db, ProgramGame, game_id, "遊戲")
    return _game_out(_game_load(db, game_id))


@router.post("/program/games", status_code=201)
def create_game(payload: GameIn, db: Session = Depends(get_db)):
    data = payload.model_dump()
    if data.get("segment_id") is not None:
        _get_or_404(db, ProgramSegment, data["segment_id"], "活動環節")
    g = ProgramGame(**data)
    db.add(g)
    db.commit()
    return _game_out(_game_load(db, g.id))


@router.patch("/program/games/{game_id}")
def update_game(game_id: int, payload: GamePatch, db: Session = Depends(get_db)):
    g = _get_or_404(db, ProgramGame, game_id, "遊戲")
    data = payload.model_dump(exclude_unset=True)
    if data.pop("clear_segment", False):
        g.segment_id = None
        data.pop("segment_id", None)
    if "segment_id" in data and data["segment_id"] is None:
        data.pop("segment_id")
    if data.get("segment_id") is not None:
        _get_or_404(db, ProgramSegment, data["segment_id"], "活動環節")
    for k, val in data.items():
        setattr(g, k, val)
    db.commit()
    return _game_out(_game_load(db, game_id))


@router.delete("/program/games/{game_id}", status_code=204)
def delete_game(game_id: int, db: Session = Depends(get_db)):
    g = _get_or_404(db, ProgramGame, game_id, "遊戲")
    db.delete(g)
    db.commit()
    return None


# ---------------------------------------------------------------------
# 檔案（合約、報價單、收據、婚紗照）
# ---------------------------------------------------------------------
ALLOWED_EXT = {
    ".pdf", ".jpg", ".jpeg", ".png", ".webp", ".heic", ".gif",
    ".xlsx", ".xls", ".csv", ".docx", ".doc", ".txt",
}


@router.get("/files")
def list_files(
    vendor_id: int | None = Query(None),
    expense_id: int | None = Query(None),
    kind: str = Query(""),
    db: Session = Depends(get_db),
):
    stmt = select(FileAsset).options(selectinload(FileAsset.vendor))
    if vendor_id is not None:
        stmt = stmt.where(FileAsset.vendor_id == vendor_id)
    if expense_id is not None:
        stmt = stmt.where(FileAsset.expense_id == expense_id)
    if kind:
        stmt = stmt.where(FileAsset.kind == kind)
    stmt = stmt.order_by(FileAsset.created_at.desc(), FileAsset.id.desc())
    return [_file_out(f) for f in db.scalars(stmt).all()]


@router.post("/files", status_code=201)
async def upload_file(
    file: UploadFile = File(...),
    kind: str = Form("doc"),
    is_public: bool = Form(False),
    vendor_id: int | None = Form(None),
    expense_id: int | None = Form(None),
    payment_id: int | None = Form(None),
    note: str = Form(""),
    caption: str = Form(""),
    album: str = Form(""),
    db: Session = Depends(get_db),
):
    if kind not in ("doc", "receipt", "photo"):
        raise HTTPException(400, "檔案類型不正確")
    original = (file.filename or "file").strip()
    ext = Path(original).suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"不支援的檔案格式：{ext or '（無副檔名）'}")
    data = await file.read()
    limit = settings.max_upload_mb * 1024 * 1024
    if len(data) > limit:
        raise HTTPException(413, f"檔案超過 {settings.max_upload_mb}MB")
    if vendor_id is not None:
        _get_or_404(db, Vendor, vendor_id, "廠商")
    if expense_id is not None:
        _get_or_404(db, Expense, expense_id, "花費項目")
    if payment_id is not None:
        _get_or_404(db, Payment, payment_id, "付款")

    stored = f"{uuid.uuid4().hex}{ext}"
    (settings.upload_path / stored).write_bytes(data)
    mime = file.content_type or mimetypes.guess_type(original)[0] or "application/octet-stream"
    # 照片：產生縮圖，並排在同一本相簿的最後
    thumb_name = ""
    sort_order = 0
    if kind == "photo":
        if is_image(original):
            thumb_name = f"thumb_{stored.rsplit('.', 1)[0]}.jpg"
            if not make_thumb(settings.upload_path / stored, settings.upload_path / thumb_name):
                thumb_name = ""
        last = db.scalar(
            select(func.max(FileAsset.sort_order)).where(FileAsset.kind == "photo", FileAsset.album == album.strip()[:50])
        )
        sort_order = (last if last is not None else -1) + 1
    row = FileAsset(
        filename=original[:255],
        stored_name=stored,
        mime=mime[:100],
        size=len(data),
        kind=kind,
        is_public=bool(is_public) and kind == "photo",
        vendor_id=vendor_id,
        expense_id=expense_id,
        payment_id=payment_id,
        note=note[:300],
        caption=caption.strip()[:200],
        album=album.strip()[:50] if kind == "photo" else "",
        sort_order=sort_order,
        thumb_name=thumb_name,
    )
    db.add(row)
    db.commit()
    row = db.scalars(
        select(FileAsset).options(selectinload(FileAsset.vendor)).where(FileAsset.id == row.id)
    ).one()
    return _file_out(row)


@router.get("/files/{file_id}/download")
def download_file(file_id: int, db: Session = Depends(get_db)):
    f = _get_or_404(db, FileAsset, file_id, "檔案")
    path = settings.upload_path / f.stored_name
    if not path.is_file():
        raise HTTPException(404, "檔案不存在（可能已被移除）")
    return FileResponse(path, media_type=f.mime, filename=f.filename)


@router.patch("/files/{file_id}")
def update_file(file_id: int, payload: FilePatch, db: Session = Depends(get_db)):
    f = _get_or_404(db, FileAsset, file_id, "檔案")
    data = payload.model_dump(exclude_unset=True)
    if data.pop("clear_links", False):
        f.vendor_id = f.expense_id = f.payment_id = None
        for k in ("vendor_id", "expense_id", "payment_id"):
            data.pop(k, None)
    for k in ("vendor_id", "expense_id", "payment_id"):
        if k in data and data[k] is None:
            data.pop(k)
    if "vendor_id" in data:
        _get_or_404(db, Vendor, data["vendor_id"], "廠商")
    if "expense_id" in data:
        _get_or_404(db, Expense, data["expense_id"], "花費項目")
    if "payment_id" in data:
        _get_or_404(db, Payment, data["payment_id"], "付款")
    for k, val in data.items():
        setattr(f, k, val)
    if f.kind != "photo":
        f.is_public = False
    db.commit()
    f = db.scalars(
        select(FileAsset).options(selectinload(FileAsset.vendor)).where(FileAsset.id == file_id)
    ).one()
    return _file_out(f)


@router.delete("/files/{file_id}", status_code=204)
def delete_file(file_id: int, db: Session = Depends(get_db)):
    f = _get_or_404(db, FileAsset, file_id, "檔案")
    paths = [settings.upload_path / f.stored_name]
    if f.thumb_name:
        paths.append(settings.upload_path / f.thumb_name)
    db.delete(f)
    db.commit()
    for p in paths:
        try:
            p.unlink(missing_ok=True)
        except OSError:
            pass
    return None


@router.get("/files/{file_id}/thumb")
def file_thumb(file_id: int, db: Session = Depends(get_db)):
    """照片縮圖（沒有縮圖就給原圖）。"""
    f = _get_or_404(db, FileAsset, file_id, "檔案")
    if f.thumb_name and (settings.upload_path / f.thumb_name).is_file():
        return FileResponse(settings.upload_path / f.thumb_name, media_type="image/jpeg")
    path = settings.upload_path / f.stored_name
    if not path.is_file():
        raise HTTPException(404, "檔案不存在")
    return FileResponse(path, media_type=f.mime)


# ---------------------------------------------------------------------
# 婚宴菜單（2026-09-29）：跟飯店討論中的菜色，只給新人看（鑰匙 menu）
# ---------------------------------------------------------------------
def _menu_out(m: MenuItem) -> dict:
    return {"id": m.id, "category": m.category, "sort_order": m.sort_order, "name": m.name, "name_en": m.name_en,
            "status": m.status, "note": m.note}


def _menu_all(db: Session) -> list[MenuItem]:
    return db.scalars(select(MenuItem).order_by(MenuItem.sort_order.asc(), MenuItem.id.asc())).all()


@router.get("/menu")
def list_menu(db: Session = Depends(get_db)):
    return [_menu_out(m) for m in _menu_all(db)]


@router.post("/menu", status_code=201)
def create_menu_item(payload: MenuItemIn, db: Session = Depends(get_db)):
    last = db.scalar(select(func.max(MenuItem.sort_order))) or 0
    # 新的一道放在同類別最後面：同類別最後一道的 sort_order 之後，其餘往後推
    same = [m for m in _menu_all(db) if m.category == payload.category]
    order = (same[-1].sort_order + 1) if same else last + 1
    for m in _menu_all(db):
        if m.sort_order >= order:
            m.sort_order += 1
    m = MenuItem(**payload.model_dump(), sort_order=order)
    db.add(m)
    db.commit()
    return _menu_out(m)


@router.patch("/menu/{item_id}")
def update_menu_item(item_id: int, payload: MenuItemPatch, db: Session = Depends(get_db)):
    m = _get_or_404(db, MenuItem, item_id, "菜色")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(m, k, v)
    db.commit()
    return _menu_out(m)


@router.delete("/menu/{item_id}", status_code=204)
def delete_menu_item(item_id: int, db: Session = Depends(get_db)):
    m = _get_or_404(db, MenuItem, item_id, "菜色")
    db.delete(m)
    db.commit()
    return None


@router.post("/menu/reorder")
def reorder_menu(payload: MenuReorder, db: Session = Depends(get_db)):
    rows = {m.id: m for m in _menu_all(db)}
    order = 1
    for mid in payload.ids:
        if mid in rows:
            rows[mid].sort_order = order
            order += 1
    for m in rows.values():  # 沒列到的排在後面
        if m.id not in payload.ids:
            m.sort_order = order
            order += 1
    db.commit()
    return [_menu_out(m) for m in _menu_all(db)]


@router.post("/menu/import", status_code=201)
def import_menu(payload: MenuImport, db: Session = Depends(get_db)):
    if payload.replace:
        for m in _menu_all(db):
            db.delete(m)
        db.flush()
        start = 0
    else:
        start = db.scalar(select(func.max(MenuItem.sort_order))) or 0
    for i, it in enumerate(payload.items, 1):
        db.add(MenuItem(**it.model_dump(), sort_order=start + i))
    db.commit()
    return {"count": len(payload.items), "items": [_menu_out(m) for m in _menu_all(db)]}


# ---------------------------------------------------------------------
# 婚禮當天要帶的東西（2026-10-01，鑰匙 packing）：分類、數量、誰帶、備註、已備妥
# ---------------------------------------------------------------------
def _packing_out(p: PackingItem) -> dict:
    return {"id": p.id, "category": p.category, "name": p.name, "qty": p.qty, "owner": p.owner,
            "note": p.note, "packed": bool(p.packed), "sort_order": p.sort_order}


def _packing_all(db: Session) -> list[PackingItem]:
    return db.scalars(select(PackingItem).order_by(PackingItem.sort_order.asc(), PackingItem.id.asc())).all()


@router.get("/packing")
def list_packing(db: Session = Depends(get_db)):
    return [_packing_out(p) for p in _packing_all(db)]


@router.post("/packing", status_code=201)
def create_packing_item(payload: PackingItemIn, db: Session = Depends(get_db)):
    # 新的一樣放最後；分類分組交給前端，所以只要整體順序
    last = db.scalar(select(func.max(PackingItem.sort_order))) or 0
    p = PackingItem(**payload.model_dump(), sort_order=last + 1)
    db.add(p)
    db.commit()
    return _packing_out(p)


@router.patch("/packing/{item_id}")
def update_packing_item(item_id: int, payload: PackingItemPatch, db: Session = Depends(get_db)):
    p = _get_or_404(db, PackingItem, item_id, "這樣東西")
    for k, v in payload.model_dump(exclude_unset=True).items():
        if v is not None:  # 帶 null 一律當作不改，避免把必填欄位清掉
            setattr(p, k, v)
    db.commit()
    return _packing_out(p)


@router.delete("/packing/{item_id}", status_code=204)
def delete_packing_item(item_id: int, db: Session = Depends(get_db)):
    p = _get_or_404(db, PackingItem, item_id, "這樣東西")
    db.delete(p)
    db.commit()
    return None


@router.post("/packing/import", status_code=201)
def import_packing(payload: PackingPresetIn, db: Session = Depends(get_db)):
    """帶入常用清單：同分類裡名稱一樣的就略過，按兩次也不會變兩份。"""
    have = {(p.category, p.name) for p in _packing_all(db)}
    start = db.scalar(select(func.max(PackingItem.sort_order))) or 0
    added = 0
    for it in payload.items:
        if (it.category, it.name) in have:
            continue
        have.add((it.category, it.name))
        added += 1
        db.add(PackingItem(**it.model_dump(), sort_order=start + added))
    db.commit()
    return {"added": added, "items": [_packing_out(p) for p in _packing_all(db)]}


@router.post("/packing/bulk")
def bulk_packing(payload: PackingBulk, db: Session = Depends(get_db)):
    db.execute(update(PackingItem).values(packed=payload.packed))
    db.commit()
    return [_packing_out(p) for p in _packing_all(db)]
