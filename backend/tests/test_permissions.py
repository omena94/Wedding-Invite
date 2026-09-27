"""角色權限（2026-09-27）：預設幫手只能看名單、座位、簽收；新人在設定頁勾給幫手後就能用；新人拿不掉「設定」。隔離 SQLite。"""
import json
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


def test_defaults_and_editing(setup):
    c, couple, helper = setup
    me = c.get("/api/admin/me", headers=helper).json()
    assert me["role"] == "helper" and "guests_view" in me["permissions"] and "budget" not in me["permissions"]
    # 幫手預設：看名單可以、花費不行、設定不行、座位圖唯讀可以、擺桌不行
    assert c.get("/api/admin/rsvps", headers=helper).status_code == 200
    assert c.get("/api/planner/expenses", headers=helper).status_code == 403
    assert c.get("/api/planner/settings", headers=helper).status_code == 403
    assert c.get("/api/admin/seating", headers=helper).status_code == 200
    assert c.get("/api/planner/seating", headers=helper).status_code == 403
    assert c.get("/api/planner/gifts", headers=helper).status_code == 200
    assert c.post("/api/planner/gifts/vendors", json={"name": "x"}, headers=helper).status_code == 403
    # 新人到設定頁把「花費」勾給幫手
    r = c.patch("/api/planner/settings", json={"role_permissions": json.dumps({"couple": ["settings"], "helper": ["guests_view", "budget"]})}, headers=couple)
    assert r.status_code == 200, r.text
    assert c.get("/api/planner/expenses", headers=helper).status_code == 200
    assert c.get("/api/admin/rsvps", headers=helper).status_code == 200
    assert c.patch("/api/admin/rsvps/1", json={"remark": "x"}, headers=helper).status_code == 403  # 沒勾編輯
    # 新人即使只存了 settings，讀回來還是有 settings（鎖定），而且被拿掉的功能真的擋
    assert "settings" in c.get("/api/admin/me", headers=couple).json()["permissions"]
    assert c.get("/api/planner/expenses", headers=couple).status_code == 403
    assert c.get("/api/planner/settings", headers=couple).status_code == 200
    # 壞掉的 JSON 退回預設
    c.patch("/api/planner/settings", json={"role_permissions": "not json"}, headers=couple)
    assert c.get("/api/planner/expenses", headers=couple).status_code == 200
    assert c.get("/api/planner/expenses", headers=helper).status_code == 403


def test_new_keys_default_to_couple(setup):
    """存過權限表之後才新增的功能，新人預設拿得到（known 清單裡沒有的鑰匙）。"""
    c, couple, helper = setup
    c.patch("/api/planner/settings", json={"role_permissions": json.dumps({"couple": ["settings", "budget"], "helper": [], "known": ["settings", "budget"]})}, headers=couple)
    perms = c.get("/api/admin/me", headers=couple).json()["permissions"]
    assert "guest_photos" in perms and "calendar" in perms and "budget" in perms
    assert "guest_photos" not in c.get("/api/admin/me", headers=helper).json()["permissions"]
    # 舊格式（沒有 known）：只把沒出現在任何一欄的鑰匙給新人
    c.patch("/api/planner/settings", json={"role_permissions": json.dumps({"couple": ["settings"], "helper": ["calendar"]})}, headers=couple)
    perms = c.get("/api/admin/me", headers=couple).json()["permissions"]
    assert "calendar" not in perms and "guest_photos" in perms
