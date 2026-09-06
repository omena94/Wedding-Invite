"""喜餅與帳務整合：使用隔離 SQLite、虛構親友，不會發送通知或修改正式資料。"""
import os
from datetime import date
from uuid import uuid4

os.environ.update(DATABASE_URL="sqlite://", SECRET_KEY="local-test-secret-key-not-for-deployment-2026",
                  TELEGRAM_BOT_TOKEN="", TELEGRAM_CHAT_ID="", SMTP_USER="", SMTP_PASSWORD="")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import Expense, GiftDelivery, GiftOrder, GiftPlan, GiftRecipient, Payment, Rsvp, Vendor
from app.security import create_token

P = "/api/planner/gifts"


@pytest.fixture
def setup():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    event.listen(engine, "connect", lambda conn, _: conn.execute("PRAGMA foreign_keys=ON"))
    Base.metadata.create_all(engine)
    db = Session(engine, expire_on_commit=False)
    def dependency():
        try:
            yield db
        finally:
            db.rollback()
            db.expire_all()
    app.dependency_overrides[get_db] = dependency
    client = TestClient(app)
    client.headers["Authorization"] = "Bearer " + create_token()
    vendor = Vendor(name="測試喜餅廠商", category="喜餅")
    db.add(vendor)
    db.commit()
    product = client.post(P + "/products", json={"name": "綜合禮盒", "reference_price": 600, "reserve_qty": 5, "vendor_id": vendor.id})
    assert product.status_code == 201, product.text
    yield client, db, vendor.id, product.json()["id"]
    app.dependency_overrides.clear()
    client.close()
    db.close()
    engine.dispose()


def recipient_body(pid, **kw):
    return {"request_key": uuid4().hex, "name": "不參加的阿姨", "items": [{"product_id": pid, "quantity": 2}], **kw}


def order_body(vid, pid, **kw):
    return {"request_key": uuid4().hex, "vendor_id": vid, "title": "喜餅訂購", "items": [{"product_id": pid, "paid_qty": 90, "gift_qty": 5, "unit_price": 600}],
            "shipping": 1500, "discount": 1000, "budget_amount": 60000, **kw}


def current(client):
    response = client.get(P)
    assert response.status_code == 200, response.text
    return response.json()


def delivery_body(pid, version=1, quantity=1, **kw):
    return {"request_key": uuid4().hex, "version": version, "items": [{"product_id": pid, "quantity": quantity}],
            "method": "venue", "receiver": "媽媽代領", "delivered_on": "2026-09-06", **kw}


def test_non_attendee_does_not_create_rsvp_and_create_retry_is_safe(setup):
    client, db, _, pid = setup
    body = recipient_body(pid, method="mail")
    first = client.post(P + "/recipients", json=body)
    assert first.status_code == 201, first.text
    assert client.post(P + "/recipients", json=body).json()["id"] == first.json()["id"]
    assert db.scalar(select(func.count()).select_from(Rsvp)) == 0
    assert db.scalar(select(func.count()).select_from(GiftRecipient)) == 1
    data = current(client)
    assert data["summary"]["demand"] == 2 and data["summary"]["missing_address"] == 1
    assert data["recipients"][0]["rsvps"] == []


def test_household_multiple_replies_and_declining_keeps_gift(setup):
    client, db, _, pid = setup
    guests = [Rsvp(name=n, side="bride", attending=True, adult_count=2) for n in ("王先生", "王太太")]
    db.add_all(guests); db.commit()
    body = recipient_body(pid, rsvp_ids=[g.id for g in guests], items=[{"product_id": pid, "quantity": 1}])
    assert client.post(P + "/recipients", json=body).status_code == 201
    assert client.post(P + "/recipients", json={**body, "request_key": uuid4().hex}).status_code == 409
    for g in guests:
        g.attending = False
    db.commit()
    data = current(client)
    assert data["summary"]["demand"] == 1
    assert data["recipients"][0]["change_method"]
    # RSVP 刪除只移除關聯，送餅安排保留。
    db.delete(guests[0]); db.commit()
    assert len(current(client)["recipients"][0]["rsvps"]) == 1


def test_partial_delivery_retry_stale_client_and_void_history(setup):
    client, db, _, pid = setup
    body = recipient_body(pid)
    rid = client.post(P + "/recipients", json=body).json()["id"]
    delivery = delivery_body(pid)
    response = client.post(f"{P}/recipients/{rid}/deliveries", json=delivery)
    assert response.status_code == 201, response.text
    did = response.json()["id"]
    assert client.post(f"{P}/recipients/{rid}/deliveries", json=delivery).json()["id"] == did
    assert db.scalar(select(func.count()).select_from(GiftDelivery)) == 1
    assert current(client)["summary"]["remaining"] == 1
    assert client.post(f"{P}/recipients/{rid}/deliveries", json=delivery_body(pid)).status_code == 409
    assert client.post(f"{P}/recipients/{rid}/deliveries", json=delivery_body(pid, version=2, quantity=2)).status_code == 400
    assert client.put(f"{P}/recipients/{rid}", json={**body, "version": 2, "state": "cancelled"}).status_code == 400
    assert client.patch(f"{P}/deliveries/{did}", json={"version": 1, "void_reason": "重複核對時發現誤登"}).status_code == 200
    data = current(client)
    assert data["summary"]["remaining"] == 2
    assert data["recipients"][0]["deliveries"][0]["void_reason"]
    assert client.patch(f"{P}/deliveries/{did}", json={"version": 2, "received_on": "2026-09-07"}).status_code == 400


def test_mail_requires_address_and_keeps_original_snapshot(setup):
    client, _, _, pid = setup
    body = recipient_body(pid, address="舊地址", method="mail")
    rid = client.post(P + "/recipients", json=body).json()["id"]
    delivery = delivery_body(pid, method="mail", address="")
    assert client.post(f"{P}/recipients/{rid}/deliveries", json=delivery).status_code == 400
    delivery["address"] = "本次實際地址"
    response = client.post(f"{P}/recipients/{rid}/deliveries", json=delivery)
    assert response.status_code == 201, response.text
    d = response.json()
    assert d["received_on"] is None
    assert client.put(f"{P}/recipients/{rid}", json={**body, "version": 2, "address": "新地址"}).status_code == 200
    r = current(client)["recipients"][0]
    assert r["deliveries"][0]["address"] == "本次實際地址"
    assert r["remaining"] == 1
    assert client.patch(f"{P}/deliveries/{d['id']}", json={"version": 1, "received_on": "2026-09-05"}).status_code == 400
    assert client.patch(f"{P}/deliveries/{d['id']}", json={"version": 1, "received_on": "2026-09-07"}).status_code == 200


def test_gift_boxes_and_money_connect_to_one_expense_and_unscheduled_balance(setup):
    client, db, vid, pid = setup
    body = order_body(vid, pid)
    response = client.post(P + "/orders", json=body)
    assert response.status_code == 201, response.text
    order = response.json()
    assert order["total"] == 54500
    assert client.post(P + "/orders", json=body).json()["id"] == order["id"]
    assert db.scalar(select(func.count()).select_from(Expense)) == 1
    assert client.post(f"/api/planner/expenses/{order['expense_id']}/payments", json={"title": "訂金", "amount": 20000, "paid_date": "2026-09-06"}).status_code == 201
    data = current(client)
    assert data["products"][0]["supply"] == 95
    assert data["orders"][0]["balance"] == data["orders"][0]["unscheduled"] == 34500
    expense = client.get("/api/planner/expenses").json()[0]
    assert expense["unpaid_total"] == 34500
    assert expense["gift_order_id"] == order["id"]
    assert client.get("/api/planner/dashboard").json()["budget"]["unpaid_total"] == 34500


def test_link_existing_expense_preserves_payments_and_rejects_mismatch(setup):
    client, db, vid, pid = setup
    expense = Expense(title="已記帳喜餅", category="喜餅", vendor_id=vid, contract_amount=54500, budget_amount=70000)
    db.add(expense); db.flush()
    db.add(Payment(expense_id=expense.id, title="原訂金", amount=10000, paid_date=date(2026, 9, 1)))
    db.commit()
    body = order_body(vid, pid, expense_id=expense.id)
    assert client.post(P + "/orders", json={**body, "shipping": 999}).status_code == 409
    assert db.scalar(select(func.count()).select_from(GiftOrder)) == 0
    response = client.post(P + "/orders", json=body)
    assert response.status_code == 201, response.text
    assert response.json()["paid"] == 10000 and response.json()["budget_amount"] == 70000
    assert db.scalar(select(func.count()).select_from(Expense)) == 1
    assert client.post(P + "/orders", json={**body, "request_key": uuid4().hex}).status_code == 409


def test_confirmed_price_snapshot_and_financial_guardrails(setup):
    client, _, vid, pid = setup
    body = order_body(vid, pid)
    o = client.post(P + "/orders", json=body).json()
    assert client.put(f"{P}/products/{pid}", json={"name": "改名款式", "reference_price": 900, "version": 1}).status_code == 200
    assert current(client)["orders"][0]["items"][0]["unit_price"] == 600
    assert client.patch(f"/api/planner/expenses/{o['expense_id']}", json={"contract_amount": 100}).status_code == 400
    assert client.delete(f"/api/planner/expenses/{o['expense_id']}").status_code == 400
    assert client.delete(f"/api/planner/vendors/{vid}").status_code == 400
    edit = {**body, "expense_id": o["expense_id"], "version": 1, "shipping": 2000, "note": "確認追加運費"}
    response = client.put(f"{P}/orders/{o['id']}", json=edit)
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 55000 and response.json()["history"][0]["total"] == 54500
    assert client.put(f"{P}/orders/{o['id']}", json=edit).status_code == 409


def test_product_shortage_and_cancel_do_not_reduce_purchase(setup):
    client, _, vid, pid = setup
    p2 = client.post(P + "/products", json={"name": "另一款", "reference_price": None}).json()["id"]
    body = recipient_body(pid, items=[{"product_id": pid, "quantity": 1}, {"product_id": p2, "quantity": 3}])
    r = client.post(P + "/recipients", json=body).json()
    client.post(P + "/orders", json=order_body(vid, pid))
    data = current(client)
    assert data["products"][0]["shortage"] == 0 and data["products"][1]["shortage"] == 3
    assert data["summary"]["estimate_incomplete"]
    assert client.put(f"{P}/recipients/{r['id']}", json={**body, "state": "cancelled"}).status_code == 200
    data = current(client)
    assert data["summary"]["demand"] == 0 and data["summary"]["total"] == 54500


def test_invalid_plan_or_order_is_atomic(setup):
    client, db, vid, pid = setup
    for items in ([{"product_id": 999999, "quantity": 1}], [{"product_id": pid, "quantity": 1}] * 2):
        assert client.post(P + "/recipients", json=recipient_body(pid, items=items)).status_code == 400
    assert db.scalar(select(func.count()).select_from(GiftRecipient)) == 0
    assert db.scalar(select(func.count()).select_from(GiftPlan)) == 0
    assert client.post(P + "/orders", json=order_body(vid, pid, discount=1000000)).status_code == 400
    assert db.scalar(select(func.count()).select_from(Expense)) == 0
    assert client.post(P + "/recipients", json=recipient_body(pid, name="   ")).status_code == 422


def test_csv_private_access_and_formula_protection(setup):
    client, _, _, pid = setup
    client.post(P + "/recipients", json=recipient_body(pid, name="=1+1", address="私人地址", method="mail"))
    response = client.get(P + "/export.csv?method=mail")
    assert response.status_code == 200
    assert "'=1+1" in response.text and "私人地址" in response.text
    assert "私人地址" not in client.get(P + "/export.csv?method=venue").text
    client.headers["Authorization"] = "Bearer " + create_token("helper")
    for path in (P, P + "/export.csv"):
        assert client.get(path).status_code == 403
    assert client.post(P + "/recipients", json=recipient_body(pid)).status_code == 403
    del client.headers["Authorization"]
    assert client.get(P).status_code == 401


def test_overpayment_does_not_hide_other_unpaid_contracts(setup):
    client, db, vid, _ = setup
    a = Expense(title="溢付", vendor_id=vid, contract_amount=100)
    b = Expense(title="未排付款", vendor_id=vid, contract_amount=500)
    db.add_all([a, b]); db.flush()
    db.add(Payment(expense_id=a.id, title="實付", amount=200, paid_date=date(2026, 9, 6))); db.commit()
    assert client.get("/api/planner/dashboard").json()["budget"]["unpaid_total"] == 500
    rows = {e["id"]: e for e in client.get("/api/planner/expenses").json()}
    assert rows[a.id]["overpaid_total"] == 100 and rows[b.id]["unscheduled_unpaid"] == 500
