"""一鍵切換視角（2026-09-29）：新人可換幫手 token；幫手不能換新人。隔離 SQLite。"""
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


@pytest.fixture
def setup():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = Session(engine, expire_on_commit=False)
    app.dependency_overrides[get_db] = lambda: db
    c = TestClient(app)
    yield c, {"Authorization": "Bearer " + create_token()}, {"Authorization": "Bearer " + create_token("helper")}
    app.dependency_overrides.clear()
    c.close()
    db.close()
    engine.dispose()


def test_couple_can_switch_to_helper(setup):
    c, couple, helper = setup
    r = c.post("/api/admin/switch-role", json={"role": "helper"}, headers=couple)
    assert r.status_code == 200 and r.json()["role"] == "helper"
    me = c.get("/api/admin/me", headers={"Authorization": "Bearer " + r.json()["token"]}).json()
    assert me["role"] == "helper" and "settings" not in me["permissions"]


def test_helper_cannot_switch(setup):
    c, couple, helper = setup
    assert c.post("/api/admin/switch-role", json={"role": "helper"}, headers=helper).status_code == 403
    assert c.post("/api/admin/switch-role", json={"role": "couple"}, headers=couple).status_code == 422
    assert c.post("/api/admin/switch-role", json={"role": "helper"}).status_code == 401
