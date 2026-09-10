"""花費項目的應付款日期（2026-09-10）：可填、可清、帶 null 不動。隔離 SQLite。"""
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
from app.security import create_token

P = "/api/planner/expenses"


@pytest.fixture
def client():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = Session(engine, expire_on_commit=False)
    app.dependency_overrides[get_db] = lambda: db
    c = TestClient(app)
    c.headers["Authorization"] = "Bearer " + create_token()
    yield c
    app.dependency_overrides.clear()
    c.close()
    db.close()
    engine.dispose()


def test_expense_due_date(client):
    r = client.post(P, json={"title": "婚禮攝影", "category": "婚禮攝影", "contract_amount": 16000, "note": "大偉哥", "due_date": "2027-03-13"})
    assert r.status_code == 201, r.text
    e = r.json()
    assert e["due_date"] == "2027-03-13" and e["note"] == "大偉哥"
    # 帶 null 不變
    assert client.patch(f"{P}/{e['id']}", json={"note": "改備註", "due_date": None}).json()["due_date"] == "2027-03-13"
    assert client.patch(f"{P}/{e['id']}", json={"due_date": "2027-03-01"}).json()["due_date"] == "2027-03-01"
    assert client.patch(f"{P}/{e['id']}", json={"clear_due_date": True}).json()["due_date"] is None
    assert client.get(P).json()[0]["due_date"] is None
