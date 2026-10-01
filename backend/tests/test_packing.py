"""婚禮當天要帶的東西（2026-10-01）：新增／勾已備妥／帶入常用清單不重複／全部重來；幫手預設看不到。隔離 SQLite。"""
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

P = "/api/planner/packing"


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


def test_packing_crud_import_bulk(setup):
    c, couple, helper = setup
    a = c.post(P, json={"category": "證件與禮金", "name": " 結婚書約 ", "owner": "伴娘", "qty": 2}, headers=couple)
    assert a.status_code == 201 and a.json()["name"] == "結婚書約" and a.json()["packed"] is False
    # 名稱空白、數量 0 都擋
    assert c.post(P, json={"name": "   "}, headers=couple).status_code == 422
    assert c.post(P, json={"name": "印章", "qty": 0}, headers=couple).status_code == 422
    # 勾已備妥、改內容；帶 null 不會清掉名稱
    r = c.patch(P + f"/{a.json()['id']}", json={"packed": True, "note": "放在藍色資料夾", "name": None}, headers=couple).json()
    assert r["packed"] is True and r["note"] == "放在藍色資料夾" and r["name"] == "結婚書約"
    # 帶入常用清單：已有的略過，按兩次不會重複
    preset = {"items": [{"category": "證件與禮金", "name": "結婚書約"}, {"category": "新娘", "name": "高跟鞋"}, {"category": "新郎", "name": "袖扣"}]}
    assert c.post(P + "/import", json=preset, headers=couple).json()["added"] == 2
    assert c.post(P + "/import", json=preset, headers=couple).json()["added"] == 0
    lst = c.get(P, headers=couple).json()
    assert [x["name"] for x in lst] == ["結婚書約", "高跟鞋", "袖扣"]
    # 全部勾掉、全部重來
    assert all(x["packed"] for x in c.post(P + "/bulk", json={"packed": True}, headers=couple).json())
    assert not any(x["packed"] for x in c.post(P + "/bulk", json={"packed": False}, headers=couple).json())
    # 刪除
    assert c.delete(P + f"/{lst[1]['id']}", headers=couple).status_code == 204
    assert c.delete(P + f"/{lst[1]['id']}", headers=couple).status_code == 404
    assert len(c.get(P, headers=couple).json()) == 2


def test_packing_helper_needs_key(setup):
    c, couple, helper = setup
    assert c.get(P, headers=helper).status_code == 403
    c.patch("/api/planner/settings", json={"role_permissions": json.dumps({"couple": ["settings", "packing"], "helper": ["packing"]})}, headers=couple)
    assert c.get(P, headers=helper).status_code == 200
    assert c.post(P, json={"name": "捧花"}, headers=helper).status_code == 201
