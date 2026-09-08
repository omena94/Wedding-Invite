"""喜餅：送禮需求、實際交付與訂購各自記錄，財務沿用原本的花費／付款。"""
import csv
import hashlib
import io
import json
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from ..database import get_db
from ..gift_schemas import DeliveryIn, DeliveryUpdate, OrderIn, ProductIn, RecipientIn
from ..models import (Expense, GiftDelivery, GiftOrder, GiftPlan, GiftProduct,
                      GiftRecipient, GiftRsvpLink, Payment, Rsvp, Vendor)
from ..security import AdminRequired, CoupleRequired, require_staff

# 2026-09-08 起幫手也能進來：看名單、在婚禮現場勾「已領取」；管理款式／安排／訂購／匯出仍限新人（各端點另加 CoupleRequired）
router = APIRouter(prefix="/api/planner/gifts", tags=["gifts"], dependencies=[AdminRequired])
METHODS = {"tbd": "尚未決定", "venue": "婚禮領取", "mail": "寄送", "personal": "親送（已停用）"}  # 2026-09-08 起只用前兩種；personal 只為舊資料顯示


def row_dict(row):
    return {c.name: getattr(row, c.name) for c in row.__table__.columns}


def get_row(db, model, row_id, version=None):
    # 正式 PostgreSQL 鎖住主紀錄，讓檢查盒數與交付寫入在同一交易完成。
    row = db.scalar(select(model).where(model.id == row_id).with_for_update()
                    .execution_options(populate_existing=True))
    if row is None:
        raise HTTPException(404, "找不到這筆資料")
    if version is not None and row.version != version:
        raise HTTPException(409, "資料已被更新，請關閉視窗並重新整理後再操作")
    return row


def commit(db):
    try:
        db.commit()
    except (IntegrityError, StaleDataError):
        db.rollback()
        raise HTTPException(409, "資料已更新或重複加入，請重新整理後再試")


def products_for(db, items):
    ids = [i.product_id for i in items]
    if len(ids) != len(set(ids)):
        raise HTTPException(400, "同一款式請合併盒數，不要重複新增")
    products = {p.id: p for p in db.scalars(select(GiftProduct).where(GiftProduct.id.in_(ids)))}
    if len(products) != len(ids):
        raise HTTPException(400, "選取的喜餅款式不存在")
    return products


def delivered_quantities(deliveries):
    counts = defaultdict(int)
    for d in deliveries:
        if not d.void_reason:
            for item in json.loads(d.items_json):
                counts[item["product_id"]] += item["quantity"]
    return counts


def delivery_out(row):
    data = row_dict(row)
    data["items"] = json.loads(data.pop("items_json"))
    data.pop("payload_hash")
    return data


def order_out(db, row):
    data = row_dict(row)
    data["items"] = json.loads(data.pop("items_json"))
    data["history"] = json.loads(data.pop("history_json"))
    expense = db.get(Expense, row.expense_id)
    payments = list(db.scalars(select(Payment).where(Payment.expense_id == row.expense_id).order_by(Payment.id)))
    paid = sum(p.amount for p in payments if p.paid_date)
    scheduled = sum(p.amount for p in payments if not p.paid_date)
    balance = expense.contract_amount - paid
    data.update(total=expense.contract_amount, budget_amount=expense.budget_amount, paid=paid,
                balance=balance, scheduled=scheduled, unscheduled=max(0, balance - scheduled),
                payments=[row_dict(p) for p in payments])
    return data


def snapshot(db):
    products = {p.id: row_dict(p) for p in db.scalars(select(GiftProduct).order_by(GiftProduct.id))}
    plans = defaultdict(list)
    deliveries = defaultdict(list)
    links = defaultdict(list)
    for p in db.scalars(select(GiftPlan).order_by(GiftPlan.id)):
        plans[p.recipient_id].append(p)
    for d in db.scalars(select(GiftDelivery).order_by(GiftDelivery.id.desc())):
        deliveries[d.recipient_id].append(d)
    for link, rsvp in db.execute(select(GiftRsvpLink, Rsvp).join(Rsvp, Rsvp.id == GiftRsvpLink.rsvp_id)):
        links[link.recipient_id].append({"id": rsvp.id, "name": rsvp.name, "attending": rsvp.attending})
    recipients = []
    demand, tentative, sent = defaultdict(int), defaultdict(int), defaultdict(int)
    for r in db.scalars(select(GiftRecipient).order_by(GiftRecipient.id.desc())):
        data = row_dict(r)
        counts = delivered_quantities(deliveries[r.id])
        data["items"] = [{"product_id": p.product_id, "name": products[p.product_id]["name"],
                          "quantity": p.quantity, "delivered": counts[p.product_id],
                          "remaining": max(0, p.quantity - counts[p.product_id])} for p in plans[r.id]]
        data["rsvps"] = links[r.id]
        data["deliveries"] = [delivery_out(d) for d in deliveries[r.id]]
        data["remaining"] = sum(i["remaining"] for i in data["items"]) if r.state == "confirmed" else 0
        data["missing_address"] = r.state == "confirmed" and r.method == "mail" and not r.address.strip() and data["remaining"] > 0
        data["change_method"] = (r.state == "confirmed" and r.method == "venue" and bool(links[r.id])
                                 and not any(x["attending"] for x in links[r.id]) and data["remaining"] > 0)
        for p in plans[r.id]:
            if r.state == "confirmed":
                demand[p.product_id] += p.quantity
                sent[p.product_id] += counts[p.product_id]
            elif r.state == "draft":
                tentative[p.product_id] += p.quantity
        recipients.append(data)
    orders = [order_out(db, o) for o in db.scalars(select(GiftOrder).order_by(GiftOrder.id.desc()))]
    supply = defaultdict(int)
    for o in orders:
        for i in o["items"]:
            supply[i["product_id"]] += i["paid_qty"] + i["gift_qty"]
    for p in products.values():
        pid = p["id"]
        p.update(demand=demand[pid], tentative=tentative[pid], delivered=sent[pid], supply=supply[pid],
                 shortage=max(0, demand[pid] + p["reserve_qty"] - supply[pid]))
    return {"products": list(products.values()), "recipients": recipients, "orders": orders,
            "summary": {"demand": sum(demand.values()), "tentative": sum(tentative.values()),
                        "remaining": sum(r["remaining"] for r in recipients),
                        "missing_address": sum(r["missing_address"] for r in recipients),
                        "total": sum(o["total"] for o in orders), "paid": sum(o["paid"] for o in orders),
                        "balance": sum(max(0, o["balance"]) for o in orders),
                        "estimate": sum((p["demand"] + p["reserve_qty"]) * (p["reference_price"] or 0) for p in products.values()),
                        "estimate_incomplete": any(p["reference_price"] is None and p["demand"] + p["reserve_qty"] > 0 for p in products.values())}}


@router.get("")
def overview(role: str = Depends(require_staff), db: Session = Depends(get_db)):
    data = snapshot(db)
    if role != "couple":
        # 幫手只需要名單與領取進度，不給訂購、金額與參考價
        data["orders"] = []
        for product in data["products"]:
            product["reference_price"] = None
        data["summary"].update(total=0, paid=0, balance=0, estimate=0, estimate_incomplete=False)
    return data


@router.post("/products", status_code=201, dependencies=[CoupleRequired])
def create_product(payload: ProductIn, db: Session = Depends(get_db)):
    if payload.vendor_id:
        get_row(db, Vendor, payload.vendor_id)
    p = GiftProduct(**payload.model_dump(exclude={"version"}))
    db.add(p)
    commit(db)
    return row_dict(p)


@router.put("/products/{product_id}", dependencies=[CoupleRequired])
def update_product(product_id: int, payload: ProductIn, db: Session = Depends(get_db)):
    p = get_row(db, GiftProduct, product_id, payload.version)
    if payload.vendor_id:
        get_row(db, Vendor, payload.vendor_id)
    for k, v in payload.model_dump(exclude={"version"}).items():
        setattr(p, k, v)
    commit(db)
    return row_dict(p)


def save_recipient(db, payload, row=None):
    products_for(db, payload.items)
    if payload.state == "confirmed" and not payload.items:
        raise HTTPException(400, "已確認送餅至少需要一款喜餅；尚未決定可先存為待決定")
    if len(payload.rsvp_ids) != len(set(payload.rsvp_ids)):
        raise HTTPException(400, "請勿重複選取同一筆回覆")
    for rid in sorted(payload.rsvp_ids):
        guest = get_row(db, Rsvp, rid)
        if guest.is_test:
            raise HTTPException(400, "測試賓客不可加入送餅名單")
        link = db.get(GiftRsvpLink, rid)
        if link and (row is None or link.recipient_id != row.id):
            other = db.get(GiftRecipient, link.recipient_id)
            raise HTTPException(409, f"此回覆已加入「{other.name}」，請編輯原有送禮對象")
    fields = payload.model_dump(exclude={"version", "items", "rsvp_ids", "request_key"})
    if row is None:
        row = GiftRecipient(request_key=payload.request_key, **fields)
        db.add(row)
        db.flush()
    else:
        for k, v in fields.items():
            setattr(row, k, v)
        row.version += 1
    prior = list(db.scalars(select(GiftPlan).where(GiftPlan.recipient_id == row.id)))
    counts = delivered_quantities(db.scalars(select(GiftDelivery).where(GiftDelivery.recipient_id == row.id)))
    desired = {i.product_id: i.quantity for i in payload.items}
    if (payload.state != "confirmed" and any(counts.values())) or any(desired.get(pid, 0) < n for pid, n in counts.items()):
        raise HTTPException(400, "已有交付紀錄，不能取消或減少至已交付盒數以下；誤登請先作廢該紀錄")
    for p in prior:
        if p.product_id not in desired:
            db.delete(p)
        else:
            p.quantity = desired.pop(p.product_id)
    for pid, quantity in desired.items():
        db.add(GiftPlan(recipient_id=row.id, product_id=pid, quantity=quantity))
    old_links = list(db.scalars(select(GiftRsvpLink).where(GiftRsvpLink.recipient_id == row.id)))
    for link in old_links:
        if link.rsvp_id not in payload.rsvp_ids:
            db.delete(link)
    existing = {l.rsvp_id for l in old_links}
    for rid in payload.rsvp_ids:
        if rid not in existing:
            db.add(GiftRsvpLink(rsvp_id=rid, recipient_id=row.id))
    commit(db)
    return {"id": row.id, "version": row.version}


@router.post("/recipients", status_code=201, dependencies=[CoupleRequired])
def create_recipient(payload: RecipientIn, db: Session = Depends(get_db)):
    old = db.scalar(select(GiftRecipient).where(GiftRecipient.request_key == payload.request_key))
    if old:
        return {"id": old.id, "version": old.version}
    try:
        return save_recipient(db, payload)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "此對象已加入，請重新整理名單")


@router.put("/recipients/{recipient_id}", dependencies=[CoupleRequired])
def update_recipient(recipient_id: int, payload: RecipientIn, db: Session = Depends(get_db)):
    return save_recipient(db, payload, get_row(db, GiftRecipient, recipient_id, payload.version))


@router.post("/recipients/import-guests", dependencies=[CoupleRequired])
def import_guests(db: Session = Depends(get_db)):
    """把所有還沒加入送餅名單的賓客回覆各建一筆送餅安排（每戶 1 盒）。

    新人只有一家喜餅，不想一筆一筆「從賓客加入」。重跑只會補新回覆，已加入的不動；
    測試賓客略過。只有一款啟用中的款式時直接確認並帶入 1 盒，否則先存為待決定。
    領取方式不預設（尚未決定），由新人逐筆選擇；不出席者加註提醒。
    """
    active = list(db.scalars(select(GiftProduct).where(GiftProduct.active.is_(True)).order_by(GiftProduct.id)))
    product = active[0] if len(active) == 1 else None
    linked = {link.rsvp_id for link in db.scalars(select(GiftRsvpLink))}
    existing_keys = {k for k in db.scalars(select(GiftRecipient.request_key))}
    created = skipped = 0
    names = []
    for guest in db.scalars(select(Rsvp).where(Rsvp.is_test.is_(False)).order_by(Rsvp.id)):
        key = f"rsvp-import-{guest.id}"
        if guest.id in linked or key in existing_keys:
            skipped += 1
            continue
        attending = bool(guest.attending)
        row = GiftRecipient(
            request_key=key, name=guest.name, kind="household",
            side=guest.side if guest.side in ("groom", "bride") else "other",
            contact_name=guest.name, phone=guest.phone or "", address="", owner="",
            method="tbd",
            state="confirmed" if product else "draft",
            note="" if attending else "回覆不出席，請選擇寄送或當天由家人代領",
        )
        db.add(row)
        db.flush()
        if product:
            db.add(GiftPlan(recipient_id=row.id, product_id=product.id, quantity=1))
        db.add(GiftRsvpLink(rsvp_id=guest.id, recipient_id=row.id))
        created += 1
        names.append(guest.name)
    commit(db)
    return {"created": created, "skipped": skipped, "product": product.name if product else None, "names": names}


@router.post("/recipients/{recipient_id}/deliveries", status_code=201)
def create_delivery(recipient_id: int, payload: DeliveryIn, db: Session = Depends(get_db)):
    row = get_row(db, GiftRecipient, recipient_id)
    digest = hashlib.sha256(payload.model_dump_json(exclude={"version"}).encode()).hexdigest()
    old = db.scalar(select(GiftDelivery).where(GiftDelivery.request_key == payload.request_key))
    if old:
        if old.recipient_id != recipient_id or old.payload_hash != digest:
            raise HTTPException(409, "這次操作已登記，請重新整理交付紀錄")
        return delivery_out(old)
    if row.version != payload.version:
        raise HTTPException(409, "交付或安排已更新，請重新整理後再操作")
    if row.state != "confirmed":
        raise HTTPException(400, "請先確認送餅安排")
    if payload.method == "mail" and not payload.address:
        raise HTTPException(400, "寄送寄出前請填收件地址")
    products = products_for(db, payload.items)
    plans = {p.product_id: p.quantity for p in db.scalars(select(GiftPlan).where(GiftPlan.recipient_id == row.id))}
    counts = delivered_quantities(db.scalars(select(GiftDelivery).where(GiftDelivery.recipient_id == row.id)))
    if any(i.quantity + counts[i.product_id] > plans.get(i.product_id, 0) for i in payload.items):
        raise HTTPException(400, "本次盒數超過尚未交付的數量，請確認是否已由其他人領取")
    data = payload.model_dump(exclude={"version", "items"})
    items = [{**i.model_dump(), "name": products[i.product_id].name} for i in payload.items]
    d = GiftDelivery(recipient_id=row.id, payload_hash=digest, items_json=json.dumps(items, ensure_ascii=False),
                     received_on=payload.delivered_on if payload.method != "mail" else None, **data)
    db.add(d)
    row.version += 1
    commit(db)
    return delivery_out(d)


@router.patch("/deliveries/{delivery_id}", dependencies=[CoupleRequired])
def update_delivery(delivery_id: int, payload: DeliveryUpdate, db: Session = Depends(get_db)):
    initial = db.get(GiftDelivery, delivery_id)
    if initial is None:
        raise HTTPException(404, "找不到交付紀錄")
    recipient = get_row(db, GiftRecipient, initial.recipient_id)
    d = get_row(db, GiftDelivery, delivery_id, payload.version)
    if d.void_reason:
        raise HTTPException(400, "這筆紀錄已作廢，歷史保留供核對")
    if payload.void_reason:
        d.void_reason = payload.void_reason
    elif payload.received_on:
        if payload.received_on < d.delivered_on:
            raise HTTPException(400, "收到日期不能早於寄出日期")
        d.received_on = payload.received_on
    else:
        raise HTTPException(400, "請填收到日期或作廢原因")
    recipient.version += 1
    commit(db)
    return delivery_out(d)


def save_order(db, payload, row=None):
    get_row(db, Vendor, payload.vendor_id)
    products = products_for(db, payload.items)
    if any(i.paid_qty + i.gift_qty == 0 for i in payload.items):
        raise HTTPException(400, "每款訂購至少需要一盒（含廠商贈盒）")
    if any(products[i.product_id].vendor_id not in (None, payload.vendor_id) for i in payload.items):
        raise HTTPException(400, "喜餅款式與本次廠商不同，請分開登記訂購")
    total = sum(i.paid_qty * i.unit_price for i in payload.items) + payload.shipping + payload.other_cost - payload.discount
    if not 0 <= total <= 1000000000:
        raise HTTPException(400, "請確認折扣及總金額，總額須介於 0 與 10 億元之間")
    if row:
        if payload.expense_id != row.expense_id or payload.vendor_id != row.vendor_id:
            raise HTTPException(400, "已確認訂購不能改掛其他花費或廠商")
        expense = get_row(db, Expense, row.expense_id)
        history = json.loads(row.history_json)
        history.append({"at": datetime.now(timezone.utc).isoformat(), "version": row.version,
                        "title": row.title, "items": json.loads(row.items_json), "total": expense.contract_amount,
                        "shipping": row.shipping, "other_cost": row.other_cost, "discount": row.discount, "note": row.note})
        row.history_json = json.dumps(history, ensure_ascii=False)
        row.version += 1
    elif payload.expense_id:
        expense = get_row(db, Expense, payload.expense_id)
        if db.scalar(select(GiftOrder.id).where(GiftOrder.expense_id == expense.id)):
            raise HTTPException(409, "這筆花費已連結其他喜餅訂購")
        if expense.vendor_id not in (None, payload.vendor_id) or expense.contract_amount != total:
            raise HTTPException(409, "既有花費的廠商或合約金額不一致，請核對訂購明細後再連結")
    else:
        expense = Expense(category="喜餅", title=payload.title, vendor_id=payload.vendor_id,
                          budget_amount=payload.budget_amount, contract_amount=total)
        db.add(expense)
        db.flush()
    expense.contract_amount = total
    expense.vendor_id = payload.vendor_id
    expense.title = payload.title
    # 連結既有帳目時保留原預算；往後預算仍可在預算頁獨立調整。
    if row is None:
        row = GiftOrder(request_key=payload.request_key, expense_id=expense.id, vendor_id=payload.vendor_id)
        db.add(row)
    for key in ("title", "shipping", "other_cost", "discount", "due_date", "received_on", "note"):
        setattr(row, key, getattr(payload, key))
    row.items_json = json.dumps([{**i.model_dump(), "name": products[i.product_id].name} for i in payload.items], ensure_ascii=False)
    commit(db)
    return order_out(db, row)


@router.post("/orders", status_code=201, dependencies=[CoupleRequired])
def create_order(payload: OrderIn, db: Session = Depends(get_db)):
    old = db.scalar(select(GiftOrder).where(GiftOrder.request_key == payload.request_key))
    if old:
        return order_out(db, old)
    try:
        return save_order(db, payload)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "訂購已登記或花費已被連結，請重新整理")


@router.put("/orders/{order_id}", dependencies=[CoupleRequired])
def update_order(order_id: int, payload: OrderIn, db: Session = Depends(get_db)):
    return save_order(db, payload, get_row(db, GiftOrder, order_id, payload.version))


def csv_cell(value):
    s = str(value or "")
    # 親友姓名、地址等均為自由文字，下載到試算表時不可被當成公式執行。
    return "'" + s if s.lstrip().startswith(("=", "+", "-", "@")) or s.startswith(("\t", "\r", "\n")) else s


@router.get("/export.csv", dependencies=[CoupleRequired])
def export_gifts(method: str = Query("all", pattern="^(all|mail|venue|products)$"), db: Session = Depends(get_db)):
    data = snapshot(db)
    output = io.StringIO()
    output.write("\ufeff")
    writer = csv.writer(output)
    if method == "products":
        writer.writerow(["款式", "確認需求", "待決定", "備用", "已訂含贈盒", "訂購缺口"])
        for p in data["products"]:
            writer.writerow([csv_cell(p["name"]), p["demand"], p["tentative"], p["reserve_qty"], p["supply"], p["shortage"]])
    else:
        writer.writerow(["送禮對象", "款式", "安排盒數", "已交出", "尚欠", "方式", "收件人", "電話", "地址", "負責人", "預計日期"])
        for r in data["recipients"]:
            if r["state"] != "confirmed" or (method != "all" and method != r["method"]):
                continue
            for i in r["items"]:
                writer.writerow([csv_cell(x) for x in [r["name"], i["name"], i["quantity"], i["delivered"], i["remaining"], METHODS[r["method"]],
                                 r["contact_name"] or r["name"], r["phone"], r["address"] if method in ("mail", "all") else "", r["owner"], r["due_date"]]])
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": 'attachment; filename="wedding-gifts.csv"'})
