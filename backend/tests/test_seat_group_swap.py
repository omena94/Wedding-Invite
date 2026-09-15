"""排位操作（2026-09-15 改成以桌為單位）：整組入座放不下要擋下、可只放得下的先放、整組搬桌、同桌換座號。隔離 SQLite。"""
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
    # 一家 4 口（2 大 2 小）
    fam = Rsvp(name="王家", side="groom", phone="0912000001", email="a@example.test", attending=True, adult_count=2, child_count=2)
    db.add(fam)
    db.commit()
    yield c, db, fam
    app.dependency_overrides.clear()
    c.close()
    db.close()
    engine.dispose()


def _seats(layout, oid):
    o = next(x for x in layout["objects"] if x["id"] == oid)
    return sorted((a["seat_index"], a["person_no"]) for a in o["assignments"])


def test_group_blocked_when_not_enough_then_partial_then_move_all(setup):
    c, db, fam = setup
    small = c.post(f"{P}/objects", json={"kind": "round", "label": "小桌", "seats": 3}).json()
    big = c.post(f"{P}/objects", json={"kind": "round", "label": "大桌", "seats": 10}).json()
    # 4 個人放 3 位的桌：擋下，什麼都沒動
    r = c.post(f"{P}/assign-group", json={"object_id": small["id"], "rsvp_id": fam.id})
    assert r.status_code == 409 and "只剩 3 位" in r.json()["detail"]
    assert c.get(P).json()["summary"]["assigned"] == 0
    # 說好先放得下的：放 3 位、剩 1 位
    l = c.post(f"{P}/assign-group", json={"object_id": small["id"], "rsvp_id": fam.id, "partial": True}).json()
    assert l["placed"] == 3 and l["left_over"] == 1
    assert _seats(l, small["id"]) == [(0, 1), (1, 2), (2, 3)]
    # 剩下那一位放到大桌（預設只放還沒位子的人）
    l = c.post(f"{P}/assign-group", json={"object_id": big["id"], "rsvp_id": fam.id}).json()
    assert l["placed"] == 1 and _seats(l, big["id"]) == [(0, 4)]
    # 全都有位子了：再放會說都坐好了
    assert c.post(f"{P}/assign-group", json={"object_id": big["id"], "rsvp_id": fam.id}).status_code == 400
    # 整組搬到大桌：原本在小桌的 3 位一起搬過來，大桌自己那位的座位也重排
    l = c.post(f"{P}/assign-group", json={"object_id": big["id"], "rsvp_id": fam.id, "move_all": True}).json()
    assert l["placed"] == 4 and _seats(l, big["id"]) == [(0, 1), (1, 2), (2, 3), (3, 4)]
    assert _seats(l, small["id"]) == []
    # 整組搬回小桌放不下：擋下且大桌的安排不變
    r = c.post(f"{P}/assign-group", json={"object_id": small["id"], "rsvp_id": fam.id, "move_all": True})
    assert r.status_code == 409
    assert _seats(c.get(P).json(), big["id"]) == [(0, 1), (1, 2), (2, 3), (3, 4)]


def test_swap_seats_same_table(setup):
    c, db, fam = setup
    t = c.post(f"{P}/objects", json={"kind": "round", "label": "A1", "seats": 6}).json()
    c.post(f"{P}/assign-group", json={"object_id": t["id"], "rsvp_id": fam.id})
    # 兩邊都有人：1 號與 3 號互換
    l = c.post(f"{P}/swap", json={"object_id": t["id"], "a": 0, "b": 2}).json()
    assert _seats(l, t["id"]) == [(0, 3), (1, 2), (2, 1), (3, 4)]
    # 一邊是空位：4 號搬到 6 號
    l = c.post(f"{P}/swap", json={"object_id": t["id"], "a": 3, "b": 5}).json()
    assert _seats(l, t["id"]) == [(0, 3), (1, 2), (2, 1), (5, 4)]
    # 空位對空位、超出範圍
    assert c.post(f"{P}/swap", json={"object_id": t["id"], "a": 3, "b": 4}).status_code == 400
    assert c.post(f"{P}/swap", json={"object_id": t["id"], "a": 0, "b": 9}).status_code == 400
    # 幫手不能動
    helper = {"Authorization": "Bearer " + create_token("helper")}
    assert c.post(f"{P}/swap", json={"object_id": t["id"], "a": 0, "b": 1}, headers=helper).status_code == 403
