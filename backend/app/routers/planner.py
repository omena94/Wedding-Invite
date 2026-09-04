"""籌備後台 API（僅限新人）：設定、總覽、廠商、報價、花費、付款、待辦、檔案。"""
import mimetypes
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..config import settings
from ..database import get_db
from ..models import Expense, FileAsset, Payment, Quote, Task, Vendor
from ..schemas import (
    ExpenseIn,
    ExpensePatch,
    FilePatch,
    PaymentIn,
    PaymentPatch,
    QuoteIn,
    QuotePatch,
    TaskIn,
    TaskPatch,
    VendorIn,
    VendorPatch,
)
from ..security import CoupleRequired
from ..stage import ALL_KEYS, PHASE2_KEY, get_all, parse_dt, public_stage, set_setting

router = APIRouter(prefix="/api/planner", tags=["planner"], dependencies=[CoupleRequired])


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


def _expense_out(e: Expense) -> dict:
    payments = sorted(e.payments, key=lambda p: (p.sort_order, p.id))
    paid = sum(p.amount for p in payments if p.paid_date)
    unpaid = sum(p.amount for p in payments if not p.paid_date)
    return {
        "id": e.id,
        "vendor_id": e.vendor_id,
        "vendor_name": e.vendor.name if e.vendor else "",
        "category": e.category,
        "title": e.title,
        "budget_amount": e.budget_amount,
        "contract_amount": e.contract_amount,
        "paid_by": e.paid_by,
        "note": e.note,
        "paid_total": paid,
        "unpaid_total": unpaid,
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
        "created_at": f.created_at.isoformat() if f.created_at else None,
    }


def _task_out(t: Task) -> dict:
    return {
        "id": t.id,
        "title": t.title,
        "kind": t.kind,
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
        if key == PHASE2_KEY and value and parse_dt(value) is None:
            raise HTTPException(400, "第二階段開放時間格式不正確")
        set_setting(db, key, value)
    db.commit()
    return {"values": get_all(db), "stage": public_stage(db)}


# ---------------------------------------------------------------------
# 總覽
# ---------------------------------------------------------------------
@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db)):
    budget_total = db.scalar(select(func.coalesce(func.sum(Expense.budget_amount), 0))) or 0
    contract_total = db.scalar(select(func.coalesce(func.sum(Expense.contract_amount), 0))) or 0
    paid_total = db.scalar(
        select(func.coalesce(func.sum(Payment.amount), 0)).where(Payment.paid_date.is_not(None))
    ) or 0
    unpaid_total = db.scalar(
        select(func.coalesce(func.sum(Payment.amount), 0)).where(Payment.paid_date.is_(None))
    ) or 0

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
    }


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
    rows = db.execute(
        select(Vendor.category, func.count()).group_by(Vendor.category).order_by(Vendor.category)
    ).all()
    return [{"category": c, "count": n} for c, n in rows]


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
    rows = db.scalars(
        select(Expense).options(*_EXPENSE_LOAD).order_by(Expense.category.asc(), Expense.id.asc())
    ).all()
    return [_expense_out(e) for e in rows]


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
    e = _get_or_404(db, Expense, expense_id, "花費項目")
    data = payload.model_dump(exclude_unset=True)
    if data.pop("clear_vendor", False):
        e.vendor_id = None
        data.pop("vendor_id", None)
    if data.get("vendor_id") is not None:
        _get_or_404(db, Vendor, data["vendor_id"], "廠商")
    elif "vendor_id" in data:
        data.pop("vendor_id")  # None 代表不變
    for k, val in data.items():
        setattr(e, k, val)
    db.commit()
    e = db.scalars(select(Expense).options(*_EXPENSE_LOAD).where(Expense.id == expense_id)).one()
    return _expense_out(e)


@router.delete("/expenses/{expense_id}", status_code=204)
def delete_expense(expense_id: int, db: Session = Depends(get_db)):
    e = _get_or_404(db, Expense, expense_id, "花費項目")
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
    stmt = stmt.order_by(Task.due_date.asc().nulls_last(), Task.sort_order.asc(), Task.id.asc())
    return [_task_out(t) for t in db.scalars(stmt).all()]


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
    path = settings.upload_path / f.stored_name
    db.delete(f)
    db.commit()
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass
    return None
