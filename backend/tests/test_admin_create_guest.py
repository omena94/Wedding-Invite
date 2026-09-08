"""後台手動新增賓客：隔離 SQLite，不碰正式資料。"""
import os

os.environ.update(DATABASE_URL="sqlite://", SECRET_KEY="local-test-secret-key-not-for-deployment-2026",
                  TELEGRAM_BOT_TOKEN="", TELEGRAM_CHAT_ID="", SMTP_USER="", SMTP_PASSWORD="")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import cache
from app.database import Base, get_db
from app.main import app
from app.security import create_token


@pytest.fixture
def client(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = Session(engine, expire_on_commit=False)
    app.dependency_overrides[get_db] = lambda: db
    monkeypatch.setattr(cache, "invalidate_stats", lambda: None)
    monkeypatch.setattr(cache, "get_cached_stats", lambda: None)
    monkeypatch.setattr(cache, "set_cached_stats", lambda *_: None)
    c = TestClient(app)
    c.headers["Authorization"] = "Bearer " + create_token()
    yield c
    app.dependency_overrides.clear()
    c.close(); db.close(); engine.dispose()


def test_manual_guest_without_contact_counts_toward_banquet(client):
    r = client.post("/api/admin/rsvps", json={"name": "沒手機的阿公", "side": "groom", "adult_count": 2})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["email"] == "" and body["phone"] == "" and body["attending"] and body["adult_count"] == 2 and not body["is_test"]
    stats = client.get("/api/admin/stats").json()
    assert stats["total_guests"] >= 2
    # 名單與喜餅帶入都看得到
    assert any(x["name"] == "沒手機的阿公" for x in client.get("/api/admin/rsvps").json())
    # 不出席者人數歸零；有電話才擋重複
    r2 = client.post("/api/admin/rsvps", json={"name": "不來的表姊", "side": "bride", "attending": False, "adult_count": 3, "phone": "0912-345-678"})
    assert r2.status_code == 201 and r2.json()["adult_count"] == 0 and r2.json()["phone"] == "0912345678"
    assert client.post("/api/admin/rsvps", json={"name": "又一筆", "side": "bride", "phone": "0912345678"}).status_code == 409
    assert client.post("/api/admin/rsvps", json={"name": "   ", "side": "bride"}).status_code == 422
    helper = TestClient(app)
    helper.headers["Authorization"] = "Bearer " + create_token("helper")
    assert helper.post("/api/admin/rsvps", json={"name": "幫手不能新增", "side": "groom"}).status_code == 403
    helper.close()
