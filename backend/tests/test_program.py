"""活動環節與點子：隔離 SQLite，不碰正式資料。"""
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

S = "/api/planner/program/segments"
I = "/api/planner/program/ideas"


@pytest.fixture
def client():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = Session(engine, expire_on_commit=False)

    def dependency():
        try:
            yield db
        finally:
            db.rollback()
            db.expire_all()

    app.dependency_overrides[get_db] = dependency
    c = TestClient(app)
    c.headers["Authorization"] = "Bearer " + create_token()
    yield c
    app.dependency_overrides.clear()
    c.close(); db.close(); engine.dispose()


def test_segments_order_and_reorder(client):
    a = client.post(S, json={"title": "新人進場", "start_time": "12:30", "duration_min": 10}).json()
    b = client.post(S, json={"title": "證婚儀式 ", "host": "主持人"}).json()
    c = client.post(S, json={"title": "第一次敬酒"}).json()
    assert b["title"] == "證婚儀式" and [s["sort_order"] for s in (a, b, c)] == [1, 2, 3]
    assert client.post(S, json={"title": "壞時間", "start_time": "25:00"}).status_code == 422
    assert client.post(S, json={"title": "  "}).status_code == 422

    r = client.post(S + "/reorder", json={"ids": [c["id"], a["id"]]})
    assert [s["title"] for s in r.json()] == ["第一次敬酒", "新人進場", "證婚儀式"]

    r = client.patch(f"{S}/{b['id']}", json={"status": "confirmed", "note": "牧師先上台\n戒指交給花童"})
    assert r.json()["status"] == "confirmed" and "花童" in r.json()["note"]


def test_ideas_link_and_unlink(client):
    seg = client.post(S, json={"title": "遊戲時間"}).json()
    i1 = client.post(I, json={"content": "抽捧花改成搶捧花", "segment_id": seg["id"]}).json()
    i2 = client.post(I, json={"content": "播成長影片"}).json()
    assert i1["segment_title"] == "遊戲時間" and i2["segment_id"] is None
    assert client.post(I, json={"content": "壞連結", "segment_id": 999}).status_code == 404

    assert client.get(S).json()[0]["idea_count"] == 1
    assert [x["id"] for x in client.get(I, params={"segment_id": seg["id"]}).json()] == [i1["id"]]
    # 新的在上面
    assert [x["id"] for x in client.get(I).json()] == [i2["id"], i1["id"]]

    r = client.patch(f"{I}/{i2['id']}", json={"status": "adopted", "segment_id": seg["id"]})
    assert r.json()["status"] == "adopted" and r.json()["segment_title"] == "遊戲時間"
    assert client.patch(f"{I}/{i2['id']}", json={"segment_id": None}).json()["segment_id"] == seg["id"]
    assert client.patch(f"{I}/{i2['id']}", json={"clear_segment": True}).json()["segment_id"] is None
    assert [x["id"] for x in client.get(I, params={"status": "adopted"}).json()] == [i2["id"]]

    # 刪環節，點子留著、只解除連結
    assert client.delete(f"{S}/{seg['id']}").status_code == 204
    ideas = {x["id"]: x for x in client.get(I).json()}
    assert i1["id"] in ideas and ideas[i1["id"]]["segment_id"] is None and ideas[i1["id"]]["segment_title"] == ""
    assert client.delete(f"{I}/{i1['id']}").status_code == 204


def test_games_fields_and_link(client):
    G = "/api/planner/program/games"
    seg = client.post(S, json={"title": "遊戲時間"}).json()
    body = {"name": " 搶捧花 ", "rules": "音樂停就搶", "content": "未婚女性上台", "prize": "捧花一束＋禮券",
            "host": "主持人", "judge": "伴娘", "duration_min": 10, "props": "捧花、音樂", "segment_id": seg["id"]}
    r = client.post(G, json=body)
    assert r.status_code == 201, r.text
    g = r.json()
    assert g["name"] == "搶捧花" and g["judge"] == "伴娘" and g["props"] == "捧花、音樂" and g["segment_title"] == "遊戲時間"
    assert client.post(G, json={"name": " "}).status_code == 422
    assert client.post(G, json={"name": "x", "segment_id": 999}).status_code == 404
    assert client.get(S).json()[0]["game_count"] == 1
    assert [x["id"] for x in client.get(G, params={"segment_id": seg["id"]}).json()] == [g["id"]]

    r = client.patch(f"{G}/{g['id']}", json={"prize": "改成紅包", "segment_id": None})
    assert r.json()["prize"] == "改成紅包" and r.json()["segment_id"] == seg["id"]
    assert client.patch(f"{G}/{g['id']}", json={"clear_segment": True}).json()["segment_id"] is None
    client.patch(f"{G}/{g['id']}", json={"segment_id": seg["id"]})
    # 刪環節，遊戲留著只解除連結
    assert client.delete(f"{S}/{seg['id']}").status_code == 204
    games = client.get(G).json()
    assert len(games) == 1 and games[0]["segment_id"] is None
    assert client.delete(f"{G}/{g['id']}").status_code == 204
    assert client.get(G, headers={"Authorization": "Bearer " + create_token(role="helper")}).status_code == 403


def test_helper_forbidden(client):
    h = {"Authorization": "Bearer " + create_token(role="helper")}
    assert client.get(S, headers=h).status_code == 403
    assert client.get(I, headers=h).status_code == 403
