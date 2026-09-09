"""備忘：獨立存在或掛在待辦／花費底下；隔離 SQLite，不碰正式資料。"""
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
from app.models import Expense
from app.security import create_token

P = "/api/planner/memos"


@pytest.fixture
def setup():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    # 開 FK 才能驗證「刪待辦只解除連結」的 SET NULL 行為（正式站 PostgreSQL 本來就會）
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
    expense = Expense(title="婚宴", category="婚宴", contract_amount=300000)
    db.add(expense)
    db.commit()
    yield client, db, expense.id
    app.dependency_overrides.clear()
    client.close()
    db.close()
    engine.dispose()


def test_memo_crud_and_filters(setup):
    client, _, _ = setup
    r = client.post(P, json={"topic": " 飯店 ", "question": "素食主餐是什麼？ "})
    assert r.status_code == 201, r.text
    m = r.json()
    assert m["topic"] == "飯店" and m["question"] == "素食主餐是什麼？" and not m["confirmed"] and m["answer"] == ""
    client.post(P, json={"topic": "喜餅", "question": "幾號前要下訂？"})

    # 勾已確認並記答案
    r = client.patch(f"{P}/{m['id']}", json={"confirmed": True, "answer": "香菇素排"})
    assert r.status_code == 200 and r.json()["confirmed"] and r.json()["answer"] == "香菇素排"

    assert [x["topic"] for x in client.get(P, params={"status": "open"}).json()] == ["喜餅"]
    assert [x["topic"] for x in client.get(P, params={"status": "done"}).json()] == ["飯店"]
    assert len(client.get(P, params={"topic": "飯店"}).json()) == 1
    # 未確認的排前面
    assert [x["confirmed"] for x in client.get(P).json()] == [False, True]

    assert client.delete(f"{P}/{m['id']}").status_code == 204
    assert client.get(f"{P}/{m['id']}").status_code in (404, 405)
    assert client.post(P, json={"topic": "飯店", "question": "   "}).status_code == 422


def test_memo_linked_to_task_and_expense(setup):
    client, _, expense_id = setup
    task = client.post("/api/planner/tasks", json={"title": "向飯店確認餐點細節"}).json()

    r = client.post(P, json={"topic": "飯店", "question": "兒童餐內容？", "task_id": task["id"]})
    assert r.status_code == 201 and r.json()["task_title"] == "向飯店確認餐點細節"
    linked_task = r.json()["id"]
    r = client.post(P, json={"topic": "飯店", "question": "服務費是否含酒水？", "expense_id": expense_id})
    assert r.status_code == 201 and r.json()["expense_title"] == "婚宴"
    linked_expense = r.json()["id"]
    assert client.post(P, json={"question": "壞連結", "task_id": 9999}).status_code == 404

    assert [x["id"] for x in client.get(P, params={"task_id": task["id"]}).json()] == [linked_task]
    assert [x["id"] for x in client.get(P, params={"expense_id": expense_id}).json()] == [linked_expense]

    # 帶 null 不會解除連結，clear_task 才會
    r = client.patch(f"{P}/{linked_task}", json={"task_id": None, "answer": "有兒童餐"})
    assert r.json()["task_id"] == task["id"]
    r = client.patch(f"{P}/{linked_task}", json={"clear_task": True})
    assert r.json()["task_id"] is None and r.json()["task_title"] == ""

    # 刪掉待辦，掛在底下的備忘留著、只是不再連結
    r = client.patch(f"{P}/{linked_task}", json={"task_id": task["id"]})
    assert r.json()["task_id"] == task["id"]
    assert client.delete(f"/api/planner/tasks/{task['id']}").status_code == 204
    remaining = {x["id"]: x for x in client.get(P).json()}
    assert linked_task in remaining and remaining[linked_task]["task_id"] is None


def test_helper_cannot_see_memos(setup):
    client, _, _ = setup
    r = client.get(P, headers={"Authorization": "Bearer " + create_token(role="helper")})
    assert r.status_code == 403
