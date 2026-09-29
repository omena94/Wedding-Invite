"""婚宴菜單（2026-09-29）：新增／改狀態／排序／匯入；幫手預設看不到。隔離 SQLite。"""
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

P = "/api/planner/menu"


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


def test_menu_crud_import_reorder(setup):
    c, couple, helper = setup
    r = c.post(P + "/import", json={"items": [
        {"category": "精選冷盤", "name": "煙燻挪威鮭魚盤", "name_en": "Norwegian Smoked Salmon"},
        {"category": "精選冷盤", "name": "滷水拼盤"},
        {"category": "湯品", "name": "松露野菇湯"},
    ]}, headers=couple)
    assert r.status_code == 201 and r.json()["count"] == 3
    lst = c.get(P, headers=couple).json()
    assert [x["name"] for x in lst] == ["煙燻挪威鮭魚盤", "滷水拼盤", "松露野菇湯"] and all(x["status"] == "discussing" for x in lst)
    # 新的一道放在同類別最後
    new = c.post(P, json={"category": "精選冷盤", "name": "和風鴨胸"}, headers=couple).json()
    assert [x["name"] for x in c.get(P, headers=couple).json()] == ["煙燻挪威鮭魚盤", "滷水拼盤", "和風鴨胸", "松露野菇湯"]
    # 改狀態與備註
    assert c.patch(P + f"/{new['id']}", json={"status": "change", "note": "想換成烤鴨"}, headers=couple).json()["status"] == "change"
    # 排序
    ids = [x["id"] for x in c.get(P, headers=couple).json()]
    ids[0], ids[1] = ids[1], ids[0]
    assert [x["id"] for x in c.post(P + "/reorder", json={"ids": ids}, headers=couple).json()] == ids
    # 刪除
    assert c.delete(P + f"/{new['id']}", headers=couple).status_code == 204
    assert len(c.get(P, headers=couple).json()) == 3
    # 匯入新版本可以整份取代
    assert c.post(P + "/import", json={"items": [{"category": "甜點類", "name": "馬卡龍"}], "replace": True}, headers=couple).json()["count"] == 1
    assert [x["name"] for x in c.get(P, headers=couple).json()] == ["馬卡龍"]
    # 幫手預設沒有鑰匙；設定鍵可存
    assert c.get(P, headers=helper).status_code == 403
    assert c.patch("/api/planner/settings", json={"menu_version": "0926 版", "menu_note": "龍蝦每人半隻"}, headers=couple).json()["values"]["menu_version"] == "0926 版"
