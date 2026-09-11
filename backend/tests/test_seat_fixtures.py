"""座位圖固定物件（2026-09-11）：範本的牆、柱、洗手間鎖定後不能動、不能刪；可放回既有的廳而不影響桌椅與座位。隔離 SQLite。"""
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

P = "/api/planner/seating"


@pytest.fixture
def setup(monkeypatch, tmp_path):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = Session(engine, expire_on_commit=False)
    app.dependency_overrides[get_db] = lambda: db
    from app import config
    monkeypatch.setattr(config.settings, "upload_dir", str(tmp_path))
    c = TestClient(app)
    c.headers["Authorization"] = "Bearer " + create_token()
    db.add(Rsvp(name="賓客", side="groom", phone="0912000001", email="a@example.test", attending=True, adult_count=1, child_count=0))
    db.commit()
    yield c, db
    app.dependency_overrides.clear()
    c.close()
    db.close()
    engine.dispose()


def test_fixtures_locked_and_reinstall_keeps_tables(setup):
    client, db = setup
    layout = client.post(f"{P}/halls/preset", json={"key": "wanfu"}).json()
    hall = layout["hall"]["id"]
    walls = [o for o in layout["objects"] if o["kind"] == "wall"]
    assert walls and all(o["meta"].get("locked") and o["meta"].get("fixture") for o in walls)
    assert all(o["meta"].get("locked") for o in layout["objects"] if o["kind"] == "column")
    assert not any(o["meta"].get("locked") for o in layout["objects"] if o["kind"] in ("rect", "stage"))
    w = walls[0]
    # 鎖定：不能移、不能改大小、不能刪；改備註可以
    assert client.patch(f"{P}/objects/{w['id']}", json={"x": w["x"] + 50}).status_code == 400
    assert client.patch(f"{P}/objects/{w['id']}", json={"note": "外牆"}).status_code == 200
    assert client.delete(f"{P}/objects/{w['id']}").status_code == 400
    moved = client.post(f"{P}/objects/move", json=[{"id": w["id"], "x": w["x"] + 50, "y": w["y"]}]).json()
    assert moved["updated"] == 1
    assert next(o for o in client.get(P, params={"hall": hall}).json()["objects"] if o["id"] == w["id"])["x"] == w["x"]
    # 解鎖後就能動
    assert client.patch(f"{P}/objects/{w['id']}", json={"meta": {"locked": False}}).status_code == 200
    assert client.patch(f"{P}/objects/{w['id']}", json={"x": w["x"] + 50}).status_code == 200
    # 排一個人，把幾個固定物件刪掉（模擬新人之前刪掉柱子），再放回：桌子與座位不動、固定物件回來且鎖定
    table = next(o for o in layout["objects"] if o["kind"] == "rect")
    r = db.query(Rsvp).first()
    client.put(f"{P}/assign", json={"object_id": table["id"], "seat_index": 0, "rsvp_id": r.id, "person_no": 1})
    col = next(o for o in layout["objects"] if o["kind"] == "column")
    client.patch(f"{P}/objects/{col['id']}", json={"meta": {"locked": False}})
    assert client.delete(f"{P}/objects/{col['id']}").status_code == 204
    before_tables = sorted(o["id"] for o in layout["objects"] if o["kind"] == "rect")
    after = client.post(f"{P}/halls/{hall}/fixtures", json={"key": "wanfu"}).json()
    assert after["placed"] > 0
    assert sorted(o["id"] for o in after["objects"] if o["kind"] == "rect") == before_tables
    assert after["summary"]["assigned"] == 1
    cols = [o for o in after["objects"] if o["kind"] == "column"]
    assert len(cols) == 12 and all(o["meta"].get("locked") for o in cols)
    assert all(o["meta"].get("locked") for o in after["objects"] if o["kind"] == "wall")
