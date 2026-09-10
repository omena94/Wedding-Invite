"""筆記（原備忘）：標題／內容／已處理／釘選，可排進行事曆；主題跟行事曆共用。隔離 SQLite，不碰正式資料。"""
import os

os.environ.update(DATABASE_URL="sqlite://", SECRET_KEY="local-test-secret-key-not-for-deployment-2026",
                  TELEGRAM_BOT_TOKEN="", TELEGRAM_CHAT_ID="", SMTP_USER="", SMTP_PASSWORD="")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.security import create_token

P = "/api/planner/memos"


@pytest.fixture
def setup():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    # 開 FK 才能驗證「刪行事曆只解除連結」的 SET NULL 行為（正式站 PostgreSQL 本來就會）
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
    yield client, db
    app.dependency_overrides.clear()
    client.close()
    db.close()
    engine.dispose()


def test_memo_crud_filters_and_pin(setup):
    client, _ = setup
    r = client.post(P, json={"topic": " 婚宴 ", "title": "素食主餐是什麼？ ", "content": ""})
    assert r.status_code == 201, r.text
    m = r.json()
    assert m["topic"] == "婚宴" and m["title"] == "素食主餐是什麼？" and not m["done"] and m["content"] == "" and not m["pinned"]
    second = client.post(P, json={"topic": "喜餅", "title": "幾號前要下訂？"}).json()

    r = client.patch(f"{P}/{m['id']}", json={"done": True, "content": "香菇素排"})
    assert r.status_code == 200 and r.json()["done"] and r.json()["content"] == "香菇素排"

    assert [x["topic"] for x in client.get(P, params={"status": "open"}).json()] == ["喜餅"]
    assert [x["topic"] for x in client.get(P, params={"status": "done"}).json()] == ["婚宴"]
    assert len(client.get(P, params={"topic": "婚宴"}).json()) == 1
    # 釘選的排最前面，其次未處理
    client.patch(f"{P}/{m['id']}", json={"pinned": True})
    assert [x["id"] for x in client.get(P).json()] == [m["id"], second["id"]]

    assert client.delete(f"{P}/{m['id']}").status_code == 204
    assert client.post(P, json={"topic": "婚宴", "title": "   "}).status_code == 422
    # 舊欄位名已不接受
    assert client.post(P, json={"topic": "婚宴", "question": "舊格式"}).status_code == 422


def test_memo_scheduled_into_calendar(setup):
    client, _ = setup
    task = client.post("/api/planner/tasks", json={"title": "向飯店確認餐點細節", "due_date": "2026-10-01", "due_time": "14:30", "topic": "婚宴"}).json()
    assert task["due_time"] == "14:30" and task["topic"] == "婚宴"
    assert client.post("/api/planner/tasks", json={"title": "壞時間", "due_time": "25:00"}).status_code == 422

    r = client.post(P, json={"topic": "婚宴", "title": "兒童餐內容？", "task_id": task["id"]})
    assert r.status_code == 201 and r.json()["task_title"] == "向飯店確認餐點細節" and r.json()["task_due_date"] == "2026-10-01"
    memo_id = r.json()["id"]
    assert client.post(P, json={"title": "壞連結", "task_id": 9999}).status_code == 404
    assert [x["id"] for x in client.get(P, params={"task_id": task["id"]}).json()] == [memo_id]

    # 帶 null 不會解除連結，clear_task 才會
    assert client.patch(f"{P}/{memo_id}", json={"task_id": None, "content": "有兒童餐"}).json()["task_id"] == task["id"]
    assert client.patch(f"{P}/{memo_id}", json={"clear_task": True}).json()["task_id"] is None

    # 刪掉行事曆那一筆，筆記留著、只是不再連結
    client.patch(f"{P}/{memo_id}", json={"task_id": task["id"]})
    assert client.delete(f"/api/planner/tasks/{task['id']}").status_code == 204
    remaining = {x["id"]: x for x in client.get(P).json()}
    assert memo_id in remaining and remaining[memo_id]["task_id"] is None


def test_topics_shared_between_calendar_and_memos(setup):
    client, _ = setup
    base = client.get("/api/planner/topics").json()
    assert base[:3] == ["婚紗攝影", "禮服", "喜餅"] and "其他" in base
    client.post(P, json={"topic": "花藝", "title": "捧花要什麼顏色"})
    client.post("/api/planner/tasks", json={"title": "試妝", "topic": "新秘"})
    topics = client.get("/api/planner/topics").json()
    assert topics[: len(base)] == base and "花藝" in topics and "新秘" in topics


def test_helper_cannot_see_memos(setup):
    client, _ = setup
    r = client.get(P, headers={"Authorization": "Bearer " + create_token(role="helper")})
    assert r.status_code == 403
