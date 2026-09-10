"""婚宴也是一筆花費（2026-09-10）：自動建立、合約金額跟著預估或簽約金額、不能刪、可加分期。隔離 SQLite。"""
import os

os.environ.update(DATABASE_URL="sqlite://", SECRET_KEY="local-test-secret-key-not-for-deployment-2026",
                  TELEGRAM_BOT_TOKEN="", TELEGRAM_CHAT_ID="", SMTP_USER="", SMTP_PASSWORD="")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import Rsvp
from app.security import create_token


@pytest.fixture
def setup():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = Session(engine, expire_on_commit=False)
    app.dependency_overrides[get_db] = lambda: db
    c = TestClient(app)
    c.headers["Authorization"] = "Bearer " + create_token()
    db.add(Rsvp(name="出席的人", side="groom", phone="0912000001", email="a@example.test", attending=True, adult_count=10, child_count=0))
    db.commit()
    yield c, db
    app.dependency_overrides.clear()
    c.close()
    db.close()
    engine.dispose()


def test_banquet_expense_follows_estimate_then_contract(setup):
    client, db = setup
    b = client.get("/api/planner/banquet").json()
    est = b["estimate"]["total"]
    assert est > 0 and b["expense"]["banquet"] and b["expense"]["contract_amount"] == est
    eid = b["expense"]["id"]
    rows = client.get("/api/planner/expenses").json()
    row = next(r for r in rows if r["id"] == eid)
    assert row["banquet"] and row["category"] == "婚宴" and row["contract_amount"] == est
    # 人數變了，列表前會重新同步
    db.add(Rsvp(name="又來一位", side="bride", phone="0912000002", email="b@example.test", attending=True, adult_count=2, child_count=0))
    db.commit()
    row = next(r for r in client.get("/api/planner/expenses").json() if r["id"] == eid)
    assert row["contract_amount"] > est
    # 簽約金額填了就改用它；填 0 回到預估
    assert client.patch("/api/planner/banquet", json={"contract_amount": 500000}).json()["expense"]["contract_amount"] == 500000
    assert client.patch("/api/planner/banquet", json={"contract_amount": 0}).json()["expense"]["contract_amount"] > est
    # 不能改金額、不能刪；可以加分期
    assert client.patch(f"/api/planner/expenses/{eid}", json={"contract_amount": 1}).status_code == 400
    assert client.patch(f"/api/planner/expenses/{eid}", json={"title": "婚宴（美福）"}).status_code == 200
    assert client.delete(f"/api/planner/expenses/{eid}").status_code == 400
    p = client.post(f"/api/planner/expenses/{eid}/payments", json={"title": "定金", "amount": 50000, "paid_date": "2026-09-01"})
    assert p.status_code == 201, p.text
    assert client.get("/api/planner/banquet").json()["expense"]["paid_total"] == 50000
