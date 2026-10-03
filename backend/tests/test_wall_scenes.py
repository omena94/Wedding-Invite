"""大螢幕的場合（2026-10-03）：新人自己新增、改名、排順序、挑歌；當天切場合時大螢幕換成那個場合的歌與畫面。
切換（馬上換、這首播完換、大螢幕歌播完來換）、內容合併、賓客留言開不開、鑰匙、刪除時的善後。隔離 SQLite 與暫存資料夾。"""
import os

os.environ.update(DATABASE_URL="sqlite://", SECRET_KEY="local-test-secret-key-not-for-deployment-2026",
                  TELEGRAM_BOT_TOKEN="", TELEGRAM_CHAT_ID="", SMTP_USER="", SMTP_PASSWORD="")

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.security import create_token
from app.stage import WALL_OPEN_KEY, set_setting

COUPLE = {"Authorization": "Bearer " + create_token()}
HELPER = {"Authorization": "Bearer " + create_token("helper")}
SCENES = "/api/planner/wall/scenes"
SWITCH = f"{SCENES}/switch"
FEED = "/api/planner/wall/feed"
CONTENT = "/api/planner/wall/content"


class World:
    """跟 Xiri 的測試同一個樣子：client、新人、幫手、資料庫。"""
    def __init__(self, client, db):
        self.client, self.db, self.couple, self.helper = client, db, COUPLE, HELPER


@pytest.fixture
def world(monkeypatch, tmp_path):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = Session(engine, expire_on_commit=False)
    app.dependency_overrides[get_db] = lambda: db
    from app import config, live
    monkeypatch.setattr(config.settings, "upload_dir", str(tmp_path))
    monkeypatch.setattr(live, "_redis", lambda: None)
    monkeypatch.setattr(live, "hub", live.Hub())
    c = TestClient(app)
    yield World(c, db)
    app.dependency_overrides.clear()
    c.close()
    db.close()
    engine.dispose()

def _song(c, h, name):
    r = c.post("/api/planner/wall/songs", files={"file": (f"歌手 - {name}.mp3", b"mp3", "audio/mpeg")}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _scene(c, h, **data):
    r = c.post(SCENES, json=data, headers=h)
    assert r.status_code == 201, r.text
    return r.json()["items"][-1]


def _helper_wall_only(world):
    world.client.patch("/api/planner/settings", headers=world.couple,
                       json={"role_permissions": json.dumps({"couple": ["settings", "wall", "wall_setup"], "helper": ["wall"]})})


def test_create_edit_reorder_and_validation(world):
    c, h = world.client, world.couple
    a, b = _song(c, h, "進場曲"), _song(c, h, "用餐一")
    assert c.get(SCENES, headers=h).json()["items"] == []
    dinner = _scene(c, h, name=" 用餐 ", song_ids=[b, a, b], shuffle=True)
    assert dinner["name"] == "用餐" and dinner["song_ids"] == [b, a] and dinner["shuffle"] is True
    # 沒設的照原本的：畫面照「內容」分頁、版面照「版面」分頁、配色照每首歌、播完重複播
    assert dinner["content"] is None and dinner["plates"] == [] and dinner["pace"] == "" and dinner["theme"] == "" and dinner["after_id"] is None
    entry = _scene(c, h, name="新人進場", song_ids=[a], after_id=dinner["id"], theme="gold", plates=["sparkler", "karaoke"],
                   content={"lyrics": True, "messages": False, "photos": True, "mix": "all"}, pace="slow")
    assert entry["after_id"] == dinner["id"] and entry["plates"] == ["sparkler", "karaoke"]
    assert entry["content"] == {"lyrics": True, "messages": False, "photos": True, "mix": "all"}

    # 只改有給的；明確給 null 才清掉
    r = c.patch(f"{SCENES}/{entry['id']}", json={"name": "第一次進場"}, headers=h)
    got = next(x for x in r.json()["items"] if x["id"] == entry["id"])
    assert got["name"] == "第一次進場" and got["after_id"] == dinner["id"] and got["theme"] == "gold"
    r = c.patch(f"{SCENES}/{entry['id']}", json={"content": None, "after_id": None}, headers=h)
    got = next(x for x in r.json()["items"] if x["id"] == entry["id"])
    assert got["content"] is None and got["after_id"] is None

    bad = [{"name": ""}, {"name": "很" * 21}, {"song_ids": [999]}, {"song_ids": "1"}, {"theme": "neon"}, {"pace": "turbo"},
           {"plates": ["Bad Name"]}, {"content": {"lyrics": True}}, {"content": {"lyrics": True, "messages": True, "photos": False, "mix": "x"}},
           {"after_id": entry["id"]}, {"after_id": 999}]
    for body in bad:
        assert c.patch(f"{SCENES}/{entry['id']}", json=body, headers=h).status_code == 400, body
    assert c.post(SCENES, json={}, headers=h).status_code == 400

    # 排順序：要給完整的清單
    r = c.post(f"{SCENES}/reorder", json={"ids": [entry["id"], dinner["id"]]}, headers=h)
    assert [x["id"] for x in r.json()["items"]] == [entry["id"], dinner["id"]]
    assert c.post(f"{SCENES}/reorder", json={"ids": [entry["id"]]}, headers=h).status_code == 400


def test_template_links_after(world):
    c, h = world.client, world.couple
    items = c.post(f"{SCENES}/template", headers=h).json()["items"]
    names = [x["name"] for x in items]
    assert names == ["迎賓入席", "新人進場", "證婚致詞", "用餐", "二次進場", "敬酒", "送客"]
    by = {x["name"]: x for x in items}
    # 進場曲播完自動回到用餐；致詞自動開講話模式、不換歌
    assert by["新人進場"]["after_id"] == by["用餐"]["id"] and by["二次進場"]["after_id"] == by["用餐"]["id"]
    assert by["證婚致詞"]["duck"] is True and by["證婚致詞"]["song_ids"] == []


def test_switch_changes_feed(world):
    c, h = world.client, world.couple
    a, b, x = _song(c, h, "進場曲"), _song(c, h, "用餐一"), _song(c, h, "不播的歌")
    c.patch(f"/api/planner/wall/songs/{x}", json={"enabled": False}, headers=h)
    c.put("/api/planner/wall/plates", json={"pace": "fast"}, headers=h)
    dinner = _scene(c, h, name="用餐", song_ids=[b, x])
    entry = _scene(c, h, name="新人進場", song_ids=[a], after_id=dinner["id"], content={"lyrics": False, "messages": False, "photos": True},
                   plates=["sparkler"], theme="rose", duck=False)
    speech = _scene(c, h, name="證婚致詞", duck=True)

    feed = c.get(FEED, headers=h).json()
    assert feed["scene"] is None and feed["scene_seq"] == 0 and feed["pace"] == "fast"
    assert [s["name"] for s in feed["scenes"]] == ["用餐", "新人進場", "證婚致詞"]

    r = c.post(SWITCH, json={"id": entry["id"]}, headers=h)
    assert r.json() == {"applied": True, "active": {"id": entry["id"], "seq": 1, "next": None}}
    feed = c.get(FEED, headers=h).json()
    assert feed["scene"] == {"id": entry["id"], "name": "新人進場", "songs": [a], "shuffle": False, "plates": ["sparkler"],
                             "theme": "rose", "duck": False, "after": dinner["id"]}
    assert feed["scene_seq"] == 1
    # 畫面照這個場合（註解、相簿照「內容」分頁）；節奏沒設的照「版面」分頁
    assert feed["content"]["photos"] is True and feed["content"]["lyrics"] is False and feed["content"]["captions"] is True
    assert feed["pace"] == "fast"

    # 「這首播完換」：先排著，現在的不變
    r = c.post(SWITCH, json={"id": speech["id"], "when": "end"}, headers=h).json()
    assert r["active"] == {"id": entry["id"], "seq": 1, "next": {"id": speech["id"]}}
    assert c.get(FEED, headers=h).json()["scene_next"] == {"id": speech["id"]}
    r = c.post(SWITCH, json={"id": None, "when": "cancel"}, headers=h).json()
    assert r["active"]["next"] is None

    # 用餐：歌單關掉「要播」的歌，場合挑了照樣播（例如只在這個場合播的歌）
    c.post(SWITCH, json={"id": dinner["id"]}, headers=h)
    feed = c.get(FEED, headers=h).json()
    assert feed["scene"]["songs"] == [b, x] and feed["content"] == c.get(CONTENT, headers=h).json()
    # 切回「不指定場合」：照整份歌單、「內容」分頁
    r = c.post(SWITCH, json={"id": None}, headers=h).json()
    assert r["active"] == {"id": None, "seq": 3, "next": None}
    assert c.get(FEED, headers=h).json()["scene"] is None
    assert c.post(SWITCH, json={"id": 999}, headers=h).status_code == 404
    assert c.post(SWITCH, json={"id": None, "when": "later"}, headers=h).status_code == 400


def test_wall_handoff_only_when_state_unchanged(world):
    """大螢幕在歌播完時來換：狀態跟它看到的一樣、換的是排好的（或播完之後設的）才換，好幾台一起來只換一次。"""
    c, h = world.client, world.couple
    a = _song(c, h, "進場曲")
    dinner = _scene(c, h, name="用餐", song_ids=[a])
    entry = _scene(c, h, name="新人進場", song_ids=[a], after_id=dinner["id"])
    toast = _scene(c, h, name="敬酒", song_ids=[a])
    c.post(SWITCH, json={"id": entry["id"]}, headers=h)  # seq 1

    # 播完之後設的是用餐：要換敬酒不行；編號不對不行
    assert c.post(SWITCH, json={"id": toast["id"], "expect_from": entry["id"], "expect_seq": 1}, headers=h).json()["applied"] is False
    assert c.post(SWITCH, json={"id": dinner["id"], "expect_from": entry["id"], "expect_seq": 0}, headers=h).json()["applied"] is False
    r = c.post(SWITCH, json={"id": dinner["id"], "expect_from": entry["id"], "expect_seq": 1}, headers=h).json()
    assert r == {"applied": True, "active": {"id": dinner["id"], "seq": 2, "next": None}}
    # 第二台慢了一步：已經換過了
    assert c.post(SWITCH, json={"id": dinner["id"], "expect_from": entry["id"], "expect_seq": 1}, headers=h).json()["applied"] is False

    # 用餐重複播（沒設播完之後），也沒排：大螢幕不能自己換
    assert c.post(SWITCH, json={"id": toast["id"], "expect_from": dinner["id"], "expect_seq": 2}, headers=h).json()["applied"] is False
    # 排了「這首播完換到敬酒」，中間有人取消：不換
    c.post(SWITCH, json={"id": toast["id"], "when": "end"}, headers=h)
    c.post(SWITCH, json={"when": "cancel"}, headers=h)
    assert c.post(SWITCH, json={"id": toast["id"], "expect_from": dinner["id"], "expect_seq": 2}, headers=h).json()["applied"] is False
    # 沒取消就換，排的清掉
    c.post(SWITCH, json={"id": toast["id"], "when": "end"}, headers=h)
    r = c.post(SWITCH, json={"id": toast["id"], "expect_from": dinner["id"], "expect_seq": 2}, headers=h).json()
    assert r == {"applied": True, "active": {"id": toast["id"], "seq": 3, "next": None}}
    # 排「播完回到不指定場合」也可以
    c.post(SWITCH, json={"id": None, "when": "end"}, headers=h)
    r = c.post(SWITCH, json={"id": None, "expect_from": toast["id"], "expect_seq": 3}, headers=h).json()
    assert r == {"applied": True, "active": {"id": None, "seq": 4, "next": None}}


def test_scene_messages_and_wish(world):
    """「內容」分頁不放留言、這個場合放：切到這個場合時賓客才能留言；反過來場合不放留言時照樣收（換場合就上螢幕）。"""
    c, h = world.client, world.couple
    set_setting(world.db, WALL_OPEN_KEY, "1")
    world.db.commit()
    c.put(CONTENT, json={"messages": False}, headers=h)
    party = _scene(c, h, name="用餐", content={"lyrics": True, "messages": True, "photos": False})
    quiet = _scene(c, h, name="進場", content={"lyrics": False, "messages": False, "photos": True})
    assert c.get("/api/stage").json()["wall_open"] is False
    assert c.post("/api/wall/messages", json={"text": "新婚快樂"}).status_code == 403

    c.post(SWITCH, json={"id": party["id"]}, headers=h)
    assert c.get("/api/stage").json()["wall_open"] is True
    assert c.post("/api/wall/messages", json={"text": "新婚快樂"}).status_code == 201
    assert [m["text"] for m in c.get(FEED, headers=h).json()["messages"]] == ["新婚快樂"]

    c.put(CONTENT, json={"messages": True}, headers=h)
    c.post(SWITCH, json={"id": quiet["id"]}, headers=h)
    feed = c.get(FEED, headers=h).json()
    assert feed["content"]["messages"] is False and all(m["source"] == "couple" for m in feed["messages"])
    assert c.get("/api/stage").json()["wall_open"] is True
    assert c.post("/api/wall/messages", json={"text": "再一則"}).status_code == 201


def test_delete_cleans_up(world):
    c, h = world.client, world.couple
    a, b = _song(c, h, "一"), _song(c, h, "二")
    dinner = _scene(c, h, name="用餐", song_ids=[a, b])
    entry = _scene(c, h, name="新人進場", song_ids=[a], after_id=dinner["id"])
    # 歌從歌單刪掉：場合裡不再列
    c.delete(f"/api/planner/wall/songs/{a}", headers=h)
    items = {x["id"]: x for x in c.get(SCENES, headers=h).json()["items"]}
    assert items[dinner["id"]]["song_ids"] == [b] and items[entry["id"]]["song_ids"] == []

    c.post(SWITCH, json={"id": dinner["id"]}, headers=h)
    c.post(SWITCH, json={"id": entry["id"], "when": "end"}, headers=h)
    # 刪掉現在的場合：回到不指定，但編號不變（大螢幕不重新開始，正在播的照樣播）
    r = c.delete(f"{SCENES}/{dinner['id']}", headers=h).json()
    assert r["active"] == {"id": None, "seq": 1, "next": {"id": entry["id"]}}
    assert r["items"][0]["after_id"] is None
    r = c.delete(f"{SCENES}/{entry['id']}", headers=h).json()
    assert r["items"] == [] and r["active"]["next"] is None
    assert c.delete(f"{SCENES}/{entry['id']}", headers=h).status_code == 404


def test_keys(world):
    """設定場合要「歌單與版面」鑰匙；切換、改畫面放什麼，當天操作的鑰匙就可以。"""
    c, h = world.client, world.couple
    s = _scene(c, h, name="用餐")
    _helper_wall_only(world)
    hp = world.helper
    assert c.get(SCENES, headers=hp).status_code == 200
    assert c.post(SCENES, json={"name": "敬酒"}, headers=hp).status_code == 403
    assert c.patch(f"{SCENES}/{s['id']}", json={"name": "x"}, headers=hp).status_code == 403
    assert c.delete(f"{SCENES}/{s['id']}", headers=hp).status_code == 403
    assert c.post(SWITCH, json={"id": s["id"]}, headers=hp).json()["applied"] is True
    r = c.put(f"{SCENES}/{s['id']}/content", json={"content": {"lyrics": False, "messages": True, "photos": False}}, headers=hp)
    assert r.status_code == 200 and r.json()["items"][0]["content"] == {"lyrics": False, "messages": True, "photos": False}
    assert c.put(f"{SCENES}/{s['id']}/content", json={"content": None}, headers=hp).json()["items"][0]["content"] is None
    # 遙控頁的狀態帶著現在的場合
    assert c.get("/api/planner/wall/remote/state", headers=hp).json()["scene"]["id"] == s["id"]
