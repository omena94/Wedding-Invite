"""大螢幕推播（live.py）：遙控指令只推給接收遙控的那台、留言／歌單／開關變了叫大螢幕抓 feed、大螢幕回報推給手機。
推播只是提早通知，原本的輪詢 API 照舊（test_wall.py）。隔離 SQLite，不連 Redis。"""
import os

os.environ.update(DATABASE_URL="sqlite://", SECRET_KEY="local-test-secret-key-not-for-deployment-2026",
                  TELEGRAM_BOT_TOKEN="", TELEGRAM_CHAT_ID="", SMTP_USER="", SMTP_PASSWORD="")

import asyncio
import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import live
from app.database import Base, get_db
from app.main import app
from app.security import create_token

COUPLE = {"Authorization": "Bearer " + create_token()}
HELPER = {"Authorization": "Bearer " + create_token("helper")}


@pytest.fixture
def client(monkeypatch, tmp_path):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = Session(engine, expire_on_commit=False)
    app.dependency_overrides[get_db] = lambda: db
    from app import config
    monkeypatch.setattr(config.settings, "upload_dir", str(tmp_path))
    monkeypatch.setattr(live, "_redis", lambda: None)  # 預設當作沒有 Redis（本機可能剛好有在跑）
    monkeypatch.setattr(live, "hub", live.Hub())
    c = TestClient(app)
    yield c
    app.dependency_overrides.clear()
    c.close()
    db.close()
    engine.dispose()


@pytest.fixture
def pushed(client, monkeypatch):
    """推播改成記下來，看 API 推了什麼。"""
    got: list[dict] = []
    monkeypatch.setattr(live, "enabled", lambda: True)
    monkeypatch.setattr(live, "publish", got.append)
    return got


def _kinds(got, t):
    return [e for e in got if e["t"] == t]


def _sync(c, client, after=-1, claim=False):
    body = {"client": client, "after": after, "state": {"started": True, "song": {"title": client}}, "claim": claim}
    r = c.post("/api/planner/wall/remote/sync", json=body, headers=COUPLE)
    assert r.status_code == 200, r.text
    return r.json()


def _cmd(c, action, args=None):
    r = c.post("/api/planner/wall/remote/command", json={"action": action, "args": args or {}}, headers=COUPLE)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_command_pushed_to_receiving_screen(client, pushed):
    c = client
    # 還沒有大螢幕：不推（等大螢幕連上後 sync 自己拿）
    _cmd(c, "next")
    assert _kinds(pushed, "cmd") == []
    # 大螢幕回報：手機收到它的狀態，含「多久沒回報算斷線」
    _sync(c, "hall")
    snap = _kinds(pushed, "state")[-1]["snap"]
    assert snap["online"] is True and snap["state"]["song"]["title"] == "hall" and snap["online_s"] == 15
    # 手機按了：推給接收遙控的那台，參數只留該有的
    cid = _cmd(c, "seek", {"t": 12.5, "x": 1})
    assert _kinds(pushed, "cmd")[-1] == {"t": "cmd", "to": "hall", "cmd": {"id": cid, "action": "seek", "args": {"t": 12.5}}}
    # 鎖在會場那台：筆電搶遙控也一樣推給會場；鎖定變了要叫大螢幕馬上 sync、手機更新
    assert c.post("/api/planner/wall/remote/lock", json={"client": "hall"}, headers=COUPLE).status_code == 200
    assert _kinds(pushed, "remote") and _kinds(pushed, "state")[-1]["snap"]["locked"] is True
    _sync(c, "laptop", claim=True)
    _cmd(c, "pause")
    assert _kinds(pushed, "cmd")[-1]["to"] == "hall"


def test_feed_pushed_when_wall_content_changes(client, pushed):
    c = client
    feeds = lambda: len(_kinds(pushed, "feed"))  # noqa: E731
    n = feeds()
    assert c.post("/api/wall/messages", json={"name": "阿姨", "text": "百年好合"}, headers=COUPLE).status_code == 201
    assert feeds() == n + 1
    # 先審核：待審核的留言不上螢幕，不用叫大螢幕抓；按通過才推
    assert c.put("/api/planner/wall/options", json={"moderation": True}, headers=COUPLE).status_code == 200
    n = feeds()
    r = c.post("/api/wall/messages", json={"name": "表哥", "text": "早生貴子"}, headers=COUPLE)
    assert r.status_code == 201 and r.json()["status"] == "pending" and feeds() == n
    assert c.patch(f"/api/planner/wall/messages/{r.json()['id']}", json={"status": "show"}, headers=COUPLE).status_code == 200
    assert feeds() == n + 1
    # 版面節奏（一般設定頁）、講話音量也在 feed 裡
    assert c.patch("/api/planner/settings", json={"wall_pace": "slow"}, headers=COUPLE).status_code == 200
    assert feeds() == n + 2
    assert c.put("/api/planner/wall/duck", json={"level": 30}, headers=COUPLE).status_code == 200
    assert feeds() == n + 3 and _kinds(pushed, "state")[-1]["snap"]["duck_level"] == 30


def test_hub_routes_by_kind(monkeypatch):
    """大螢幕只收給自己的指令與 feed，手機只收狀態；關機時大家收到 bye、訂閱清乾淨。"""
    async def main():
        hub = live.Hub()
        hub.mode = "memory"
        monkeypatch.setattr(live, "hub", hub)
        wall = live.stream(live.wall_accept("hall"))
        phone = live.stream(live.remote_accept)
        got = lambda b: json.loads(b[6:])  # noqa: E731  去掉 "data: "
        for s in (wall, phone):
            assert got(await s.__anext__()) == {"t": "ready"}
        live.publish({"t": "cmd", "to": "laptop", "cmd": {"id": 1}})  # 給備用那台的，會場不收
        live.publish({"t": "cmd", "to": "hall", "cmd": {"id": 2}})
        live.publish({"t": "state", "snap": {"x": 1}})
        live.publish({"t": "feed"})
        assert got(await wall.__anext__())["cmd"]["id"] == 2
        assert got(await wall.__anext__()) == {"t": "feed"}
        assert got(await phone.__anext__()) == {"t": "state", "snap": {"x": 1}}
        hub.close_all()
        for s in (wall, phone):
            assert got(await s.__anext__()) == {"t": "bye"}
            with pytest.raises(StopAsyncIteration):
                await s.__anext__()
        assert hub.subs == {}

    asyncio.run(main())


def test_quiet_stream_sends_heartbeat(monkeypatch):
    """沒東西推也定時送心跳，nginx、Cloudflare 才不會把連線當閒置切掉。"""
    async def main():
        hub = live.Hub()
        hub.mode = "memory"
        monkeypatch.setattr(live, "hub", hub)
        monkeypatch.setattr(live, "PING_SECONDS", 0.05)
        s = live.stream(live.remote_accept)
        await s.__anext__()
        live.publish({"t": "feed"})  # 手機不收 feed
        assert await s.__anext__() == b": ping\n\n"
        await s.aclose()

    asyncio.run(main())


def test_slow_connection_told_to_reconnect(monkeypatch):
    """手機網路卡住、積太多沒送出去：清掉，請它重連（重連後自己補抓最新的）。"""
    async def main():
        hub = live.Hub()
        hub.mode = "memory"
        monkeypatch.setattr(live, "hub", hub)
        monkeypatch.setattr(live, "QUEUE_MAX", 2)
        s = live.stream(live.wall_accept(""))
        await s.__anext__()
        for _ in range(5):
            live.publish({"t": "feed"})
        await asyncio.sleep(0)  # 讓 call_soon_threadsafe 排的投遞跑完
        assert json.loads((await s.__anext__())[6:]) == {"t": "bye"}
        await s.aclose()

    asyncio.run(main())


def test_one_redis_subscription_per_worker(monkeypatch):
    """好幾條推播同時連上同一個 worker：只開一條 Redis 訂閱（開兩條會重複送、或其中一條被回收）。"""
    started = []

    async def fake_listen(self):
        started.append(1)
        self._up.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(live, "_redis", lambda: object())
    monkeypatch.setattr(live.Hub, "_listen", fake_listen)

    async def main():
        hub = live.Hub()
        assert all(await asyncio.gather(*(hub.ensure() for _ in range(5))))
        assert started == [1] and hub.mode == "redis"
        hub._task.cancel()

    asyncio.run(main())


def test_live_endpoint(client, monkeypatch):
    c = client
    url = "/api/planner/wall/live?kind=wall&client=hall"
    assert c.get(url).status_code == 401
    assert c.get(url, headers=HELPER).status_code == 403  # 幫手沒有大螢幕鑰匙
    # 正式站沒有 Redis：503，前端照舊輪詢
    assert c.get(url, headers=COUPLE).status_code == 503
    # 本機預覽（LIVE_LOCAL，單一程序）沒有 Redis 就在記憶體裡轉：先送 ready，開太久送 bye 請前端重連
    monkeypatch.setattr(live.settings, "live_local", True)
    monkeypatch.setattr(live, "MAX_SECONDS", 0.2)
    assert c.get("/api/planner/wall/live?kind=what", headers=COUPLE).status_code == 400
    r = c.get(url, headers=COUPLE)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    assert r.headers["x-accel-buffering"] == "no" and "no-transform" in r.headers["cache-control"]
    events = [json.loads(line[6:]) for line in r.text.splitlines() if line.startswith("data: ")]
    assert events[0] == {"t": "ready"} and events[-1] == {"t": "bye"}
    assert live.hub.subs == {}
