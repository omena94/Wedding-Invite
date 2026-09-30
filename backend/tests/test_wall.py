"""現場留言與大螢幕（2026-09-28）：開關、整理文字與字數、同一個 IP 限流、審核、隱藏、新人自己加、權限、歌單。隔離 SQLite 與暫存資料夾。"""
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
from app.stage import set_setting

COUPLE = {"Authorization": "Bearer " + create_token()}
HELPER = {"Authorization": "Bearer " + create_token("helper")}


@pytest.fixture
def setup(monkeypatch, tmp_path):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = Session(engine, expire_on_commit=False)
    app.dependency_overrides[get_db] = lambda: db
    from app import config
    monkeypatch.setattr(config.settings, "upload_dir", str(tmp_path))
    c = TestClient(app)
    yield c, db, tmp_path
    app.dependency_overrides.clear()
    c.close()
    db.close()
    engine.dispose()


def _on(db, key, value="1"):
    set_setting(db, key, value)
    db.commit()


def _post(c, text, name="", ip="203.0.113.1", device=None, headers=None):
    body = {"name": name, "text": text, **({"device": device} if device is not None else {})}
    return c.post("/api/wall/messages", json=body, headers={"CF-Connecting-IP": ip, **(headers or {})})


def _feed(c):
    r = c.get("/api/planner/wall/feed", headers=COUPLE)
    assert r.status_code == 200, r.text
    return r.json()


def test_gate_normalize_and_limits(setup):
    c, db, _ = setup
    # 關著：賓客不能寫，登入者可以試
    r = _post(c, "恭喜！")
    assert r.status_code == 403 and "尚未開放" in r.json()["detail"]
    assert _post(c, "新人試寫", headers=COUPLE).status_code == 201
    assert c.get("/api/stage").json()["wall_open"] is False
    _on(db, "wall_open")
    assert c.get("/api/stage").json()["wall_open"] is True
    # 換行、多個空白、全形空白、控制字元、雙向控制字元都整理掉
    r = _post(c, "  百年\n\n好合\t\u3000永浴\x00愛河\u202e ", name=" 小\n明 ")
    assert r.status_code == 201, r.text
    assert r.json() == {"id": r.json()["id"], "status": "show"}
    items = c.get("/api/planner/wall/messages", headers=COUPLE).json()["items"]
    assert items[0]["text"] == "百年 好合 永浴愛河" and items[0]["name"] == "小 明" and items[0]["source"] == "guest"
    # emoji 的連接字元留著
    assert _post(c, "\U0001F468\u200d\U0001F469\u200d\U0001F467 恭喜", ip="203.0.113.9").status_code == 201
    assert c.get("/api/planner/wall/messages", headers=COUPLE).json()["items"][0]["text"] == "\U0001F468\u200d\U0001F469\u200d\U0001F467 恭喜"
    # 字數：剛好 60 可以、61 不行；名字 20 可以、21 不行；空白不行
    assert _post(c, "喜" * 60, ip="203.0.113.2").status_code == 201
    r = _post(c, "喜" * 61, ip="203.0.113.2")
    assert r.status_code == 400 and "60" in r.json()["detail"]
    assert _post(c, "好", name="名" * 20, ip="203.0.113.2").status_code == 201
    assert _post(c, "好", name="名" * 21, ip="203.0.113.2").status_code == 400
    assert _post(c, " \n\t ", ip="203.0.113.2").status_code == 400
    assert c.post("/api/wall/messages", json={}).status_code == 400
    assert c.post("/api/wall/messages", json={"text": 123}).status_code == 422


def test_rate_limit_per_device(setup):
    c, db, _ = setup
    _on(db, "wall_open")
    venue = "198.51.100.7"  # 會場 Wi-Fi：大家同一個對外 IP
    # 同一支手機一分鐘 6 則，第 7 則擋；換了 IP（Wi-Fi 換 4G）也一樣算這支手機
    for i in range(6):
        assert _post(c, f"第 {i} 則", ip=venue if i % 2 else "198.51.100.99", device="phone-a").status_code == 201
    r = _post(c, "第七則", ip=venue, device="phone-a")
    assert r.status_code == 429 and "太快" in r.json()["detail"]
    # 同一個 IP 的其他手機不受影響
    for n in range(10):
        assert _post(c, f"賓客 {n}", ip=venue, device=f"guest-{n}").status_code == 201
    # IP 只是防濫用的底線：同一個 IP 一分鐘 60 則（上面已經 3 + 10 則）
    for n in range(47):
        assert _post(c, f"大家 {n}", ip=venue, device=f"many-{n}").status_code == 201, n
    assert _post(c, "第 61 則", ip=venue, device="fresh").status_code == 429
    assert _post(c, "別的 IP", ip="198.51.100.8", device="fresh").status_code == 201
    # 沒帶手機代號：退回用 IP 算，6 則；只跟同 IP 其他沒帶代號的算在一起
    xff = {"X-Forwarded-For": "192.0.2.5, 10.0.0.1"}  # 沒有 CF 標頭時看 X-Forwarded-For 的第一個
    assert _post(c, "有代號的先寫", ip="", device="x-1", headers=xff).status_code == 201
    for i in range(6):
        assert c.post("/api/wall/messages", json={"text": f"x{i}", "device": "  "}, headers=xff).status_code == 201
    assert c.post("/api/wall/messages", json={"text": "x7"}, headers=xff).status_code == 429
    assert c.post("/api/wall/messages", json={"text": "x7"}, headers={"X-Forwarded-For": "192.0.2.6"}).status_code == 201
    assert c.post("/api/wall/messages", json={"text": "x", "device": 123}, headers=xff).status_code == 422
    # 登入者不限流（現場測試用）
    for i in range(8):
        assert _post(c, f"新人測 {i}", ip=venue, device="phone-a", headers=COUPLE).status_code == 201


def test_moderation_hide_and_couple_add(setup):
    c, db, _ = setup
    _on(db, "wall_open")
    _on(db, "wall_moderation")
    r = _post(c, "要先審核")
    assert r.status_code == 201 and r.json()["status"] == "pending"
    mid = r.json()["id"]
    f = _feed(c)
    assert f["messages"] == [] and f["count"] == 0 and f["open"] is True and f["moderation"] is True
    lst = c.get("/api/planner/wall/messages", headers=COUPLE).json()
    assert lst["counts"] == {"show": 0, "hide": 0, "pending": 1}
    # 通過 → 上螢幕
    r = c.patch(f"/api/planner/wall/messages/{mid}", json={"status": "show"}, headers=COUPLE)
    assert r.status_code == 200 and r.json()["status"] == "show"
    f = _feed(c)
    assert [m["text"] for m in f["messages"]] == ["要先審核"] and set(f["messages"][0]) == {"id", "name", "text", "created_at"}
    # 隱藏 → 從螢幕消失
    assert c.patch(f"/api/planner/wall/messages/{mid}", json={"status": "hide"}, headers=COUPLE).json()["status"] == "hide"
    assert _feed(c)["messages"] == []
    assert c.patch(f"/api/planner/wall/messages/{mid}", json={"status": "gone"}, headers=COUPLE).status_code == 400
    # 改字也走同樣的整理與字數
    r = c.patch(f"/api/planner/wall/messages/{mid}", json={"text": "改過\n的字", "name": "阿姨", "status": "show"}, headers=COUPLE)
    assert r.json()["text"] == "改過 的字" and r.json()["name"] == "阿姨"
    assert c.patch(f"/api/planner/wall/messages/{mid}", json={"text": "字" * 61}, headers=COUPLE).status_code == 400
    # 新人自己加：開關關著、審核開著都直接上螢幕，舊到新排
    _on(db, "wall_open", "0")
    r = c.post("/api/planner/wall/messages", json={"name": "宣文 & 孟庭", "text": "謝謝大家來！"}, headers=COUPLE)
    assert r.status_code == 201 and r.json()["status"] == "show" and r.json()["source"] == "couple"
    f = _feed(c)
    assert [m["text"] for m in f["messages"]] == ["改過 的字", "謝謝大家來！"] and f["open"] is False
    assert c.post("/api/planner/wall/messages", json={"text": ""}, headers=COUPLE).status_code == 400
    # 刪除
    assert c.delete(f"/api/planner/wall/messages/{mid}", headers=COUPLE).status_code == 204
    assert c.delete(f"/api/planner/wall/messages/{mid}", headers=COUPLE).status_code == 404
    lst = c.get("/api/planner/wall/messages", headers=COUPLE).json()
    assert len(lst["items"]) == 1 and lst["counts"]["show"] == 1


def test_permissions(setup):
    c, _, _ = setup
    for method, path in [("get", "/api/planner/wall/messages"), ("get", "/api/planner/wall/feed"), ("get", "/api/planner/wall/songs")]:
        assert getattr(c, method)(path, headers=HELPER).status_code == 403
        assert getattr(c, method)(path).status_code == 401
        assert getattr(c, method)(path, headers=COUPLE).status_code == 200
    assert c.post("/api/planner/wall/messages", json={"text": "x"}, headers=HELPER).status_code == 403
    assert "wall" in c.get("/api/admin/me", headers=COUPLE).json()["permissions"]
    assert "wall" not in c.get("/api/admin/me", headers=HELPER).json()["permissions"]
    # 新人把 wall 勾給幫手之後就能用（例如請幫手顧大螢幕）
    perms = {"couple": ["settings", "wall"], "helper": ["guests_view", "wall"]}
    assert c.patch("/api/planner/settings", json={"role_permissions": json.dumps(perms)}, headers=COUPLE).status_code == 200
    assert c.get("/api/planner/wall/feed", headers=HELPER).status_code == 200


def test_songs(setup, monkeypatch):
    c, _, tmp = setup
    rev0 = _feed(c)["songs_rev"]
    audio = b"ID3fake-mp3-bytes" * 10
    r = c.post("/api/planner/wall/songs", files={"file": ("x.mp3", audio, "audio/mpeg")}, headers=COUPLE)
    assert r.status_code == 201, r.text
    a = r.json()
    assert a["title"] == "x" and a["artist"] == "" and a["size"] == len(audio) and a["content_type"] == "audio/mpeg"
    assert a["has_analysis"] is False and a["enabled"] is True and a["sort_order"] == 0 and "stored_name" not in a and "analysis_json" not in a
    assert a["theme"] == "" and a["start_at"] == 0 and a["end_at"] == 0
    rev1 = _feed(c)["songs_rev"]
    assert rev1 != rev0
    # 「歌手 - 歌名」拆開；表單有填就用表單
    b = c.post("/api/planner/wall/songs", files={"file": ("周杰倫 - 告白氣球.m4a", b"m4a", "audio/x-m4a")}, headers=COUPLE).json()
    assert b["artist"] == "周杰倫" and b["title"] == "告白氣球" and b["sort_order"] == 1 and b["content_type"] == "audio/mp4"
    d = c.post("/api/planner/wall/songs", files={"file": ("a - b.ogg", b"ogg", "audio/ogg")}, data={"title": "自訂歌名", "artist": "自訂歌手"}, headers=COUPLE).json()
    assert d["title"] == "自訂歌名" and d["artist"] == "自訂歌手" and d["sort_order"] == 2
    assert c.post("/api/planner/wall/songs", files={"file": ("x.txt", b"hi", "text/plain")}, headers=COUPLE).status_code == 400
    # MV 也收（瀏覽器只用音軌）；上限 90 MB，用調小上限的方式測超過
    for fname, ctype in (("歌手 - 主題曲 MV.mp4", "video/mp4"), ("clip.m4v", "video/mp4"), ("clip.mov", "video/quicktime")):
        r = c.post("/api/planner/wall/songs", files={"file": (fname, b"video", "application/octet-stream")}, headers=COUPLE)
        assert r.status_code == 201 and r.json()["content_type"] == ctype, r.text
        assert c.delete(f"/api/planner/wall/songs/{r.json()['id']}", headers=COUPLE).status_code == 204
    from app.routers import wall as wall_router
    assert wall_router.SONG_MAX_MB == 90
    with monkeypatch.context() as m:  # 只還原這一項，不動 fixture 換掉的上傳資料夾
        m.setattr(wall_router, "SONG_MAX_MB", 1)
        assert c.post("/api/planner/wall/songs", files={"file": ("big.mp4", b"0" * (1024 * 1024 + 1), "video/mp4")}, headers=COUPLE).status_code == 413
        assert c.post("/api/planner/wall/songs", files={"file": ("ok.mp4", b"0" * (1024 * 1024), "video/mp4")}, headers=COUPLE).status_code == 201
    ok = next(x for x in c.get("/api/planner/wall/songs", headers=COUPLE).json()["items"] if x["original_name"] == "ok.mp4")
    assert c.delete(f"/api/planner/wall/songs/{ok['id']}", headers=COUPLE).status_code == 204
    assert c.post("/api/planner/wall/songs", files={"file": ("e.mp3", b"", "audio/mpeg")}, headers=COUPLE).status_code == 400
    assert c.post("/api/planner/wall/songs", files={"file": ("x.mp3", audio, "audio/mpeg")}, headers=HELPER).status_code == 403
    rev2 = _feed(c)["songs_rev"]
    # 修改：歌名、停用、歌詞與位移、純音樂
    lrc = "[00:01.00]<00:01.00>我 <00:01.50>愛 <00:02.00>你\n[00:03.00]永遠"
    r = c.patch(f"/api/planner/wall/songs/{a['id']}", json={"title": "新歌名", "enabled": False, "lyrics_lrc": lrc, "lyrics_source": "manual", "lyrics_offset": -0.5, "instrumental": True}, headers=COUPLE)
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["title"] == "新歌名" and p["enabled"] is False and p["lyrics_lrc"] == lrc and p["lyrics_source"] == "manual" and p["lyrics_offset"] == -0.5 and p["instrumental"] is True
    assert p["artist"] == ""  # 沒送的欄位不動
    # 中文翻譯（韓文歌）：預設空的，存了拿得回來
    assert p["lyrics_trans"] == ""
    trans = "[00:01.00]<00:01.00>我 <00:01.50>愛 <00:02.00>你\n[00:03.00]永遠"
    assert c.patch(f"/api/planner/wall/songs/{a['id']}", json={"lyrics_trans": trans}, headers=COUPLE).json()["lyrics_trans"] == trans
    # 「歌詞對好了」標記：預設沒標，可以標、可以取消，改其他欄位不會動到它
    assert p["lyrics_done"] is False
    assert c.patch(f"/api/planner/wall/songs/{a['id']}", json={"lyrics_done": True}, headers=COUPLE).json()["lyrics_done"] is True
    assert c.patch(f"/api/planner/wall/songs/{a['id']}", json={"lyrics_lrc": lrc}, headers=COUPLE).json()["lyrics_done"] is True
    assert c.patch(f"/api/planner/wall/songs/{a['id']}", json={"lyrics_done": "yes"}, headers=COUPLE).status_code == 422
    # 對好了就鎖起來：歌詞、偏移、純音樂、來源都不能改（送一樣的值可以），歌名等其他欄位照常能改
    for change in ({"lyrics_lrc": "[00:01.00]改掉"}, {"lyrics_trans": "[00:01.00]改掉"}, {"lyrics_offset": 0.3}, {"instrumental": False}, {"lyrics_source": "lrclib"}):
        r = c.patch(f"/api/planner/wall/songs/{a['id']}", json=change, headers=COUPLE)
        assert r.status_code == 409 and "對好了" in r.json()["detail"], change
    assert c.patch(f"/api/planner/wall/songs/{a['id']}", json={"lyrics_done": True, "lyrics_lrc": "[00:01.00]改掉"}, headers=COUPLE).status_code == 409
    same = {"lyrics_lrc": lrc, "lyrics_trans": trans, "lyrics_offset": -0.5, "instrumental": True, "lyrics_source": "manual", "title": "還是新歌名"}
    r = c.patch(f"/api/planner/wall/songs/{a['id']}", json=same, headers=COUPLE)
    assert r.status_code == 200 and r.json()["title"] == "還是新歌名" and r.json()["lyrics_lrc"] == lrc
    # 同一個請求裡取消「對好了」就能改；之後就不再鎖
    r = c.patch(f"/api/planner/wall/songs/{a['id']}", json={"lyrics_done": False, "lyrics_offset": 0.25}, headers=COUPLE)
    assert r.status_code == 200 and r.json()["lyrics_done"] is False and r.json()["lyrics_offset"] == 0.25
    assert c.patch(f"/api/planner/wall/songs/{a['id']}", json={"lyrics_offset": -0.5, "title": "新歌名"}, headers=COUPLE).status_code == 200
    # 配色、只播中間一段
    r = c.patch(f"/api/planner/wall/songs/{a['id']}", json={"theme": "rose", "start_at": 12.5, "end_at": 200}, headers=COUPLE)
    assert r.status_code == 200 and (r.json()["theme"], r.json()["start_at"], r.json()["end_at"]) == ("rose", 12.5, 200)
    assert c.patch(f"/api/planner/wall/songs/{a['id']}", json={"theme": "neon"}, headers=COUPLE).status_code == 400
    assert c.patch(f"/api/planner/wall/songs/{a['id']}", json={"start_at": -1}, headers=COUPLE).status_code == 400
    assert c.patch(f"/api/planner/wall/songs/{a['id']}", json={"end_at": "5"}, headers=COUPLE).status_code == 422
    r = c.patch(f"/api/planner/wall/songs/{a['id']}", json={"theme": "", "end_at": 0}, headers=COUPLE)
    assert (r.json()["theme"], r.json()["start_at"], r.json()["end_at"]) == ("", 12.5, 0)
    rev3 = _feed(c)["songs_rev"]
    assert rev3 != rev2
    assert c.patch(f"/api/planner/wall/songs/{a['id']}", json={"enabled": "yes"}, headers=COUPLE).status_code == 422
    assert c.patch(f"/api/planner/wall/songs/{a['id']}", json={"lyrics_offset": "1"}, headers=COUPLE).status_code == 422
    assert c.patch(f"/api/planner/wall/songs/{a['id']}", json={"lyrics_lrc": "x" * 200_001}, headers=COUPLE).status_code == 400
    assert c.patch(f"/api/planner/wall/songs/{a['id']}", json={"lyrics_trans": "x" * 200_001}, headers=COUPLE).status_code == 400
    assert c.patch("/api/planner/wall/songs/9999", json={"title": "x"}, headers=COUPLE).status_code == 404
    # 分析：存了拿得回來，列表標 has_analysis，版本號變
    assert c.get(f"/api/planner/wall/songs/{a['id']}/analysis", headers=COUPLE).status_code == 404
    data = {"beats": [0.5, 1.0, 1.5], "energy": [[0.1, 0.2], [0.3, 0.4]], "sections": [{"start": 0, "label": "intro"}]}
    r = c.put(f"/api/planner/wall/songs/{a['id']}/analysis", json={"version": 2, "duration": 183.4, "bpm": 120, "data": data}, headers=COUPLE)
    assert r.status_code == 200, r.text
    assert r.json()["has_analysis"] is True and r.json()["analysis_version"] == 2 and r.json()["bpm"] == 120 and r.json()["duration"] == 183.4
    g = c.get(f"/api/planner/wall/songs/{a['id']}/analysis", headers=COUPLE)
    assert g.status_code == 200 and g.json() == {"version": 2, "duration": 183.4, "bpm": 120.0, "data": data}
    assert _feed(c)["songs_rev"] != rev3
    assert c.put(f"/api/planner/wall/songs/{a['id']}/analysis", json={"version": 1, "duration": 1, "bpm": 1, "data": [1, 2]}, headers=COUPLE).status_code == 422
    big = {"x": "0" * (3 * 1024 * 1024)}
    assert c.put(f"/api/planner/wall/songs/{a['id']}/analysis", json={"version": 1, "duration": 1, "bpm": 1, "data": big}, headers=COUPLE).status_code == 413
    nan = '{"version": 1, "duration": 1, "bpm": 1, "data": {"x": NaN}}'
    assert c.put(f"/api/planner/wall/songs/{a['id']}/analysis", content=nan, headers={**COUPLE, "Content-Type": "application/json"}).status_code == 400
    # 音檔串流：原檔一模一樣
    s = c.get(f"/api/planner/wall/songs/{a['id']}/audio", headers=COUPLE)
    assert s.status_code == 200 and s.content == audio and s.headers["content-type"].startswith("audio/mpeg")
    assert c.get(f"/api/planner/wall/songs/{a['id']}/audio", headers=HELPER).status_code == 403
    # 排序：照給的順序，沒列到的接在後面
    r = c.post("/api/planner/wall/songs/reorder", json={"ids": [d["id"], a["id"]]}, headers=COUPLE)
    assert r.status_code == 200
    assert [x["id"] for x in r.json()["items"]] == [d["id"], a["id"], b["id"]]
    assert [x["id"] for x in c.get("/api/planner/wall/songs", headers=COUPLE).json()["items"]] == [d["id"], a["id"], b["id"]]
    items = c.get("/api/planner/wall/songs", headers=COUPLE).json()["items"]
    assert items[1]["lyrics_lrc"] == lrc and items[1]["has_analysis"] is True
    # 刪除：檔案和紀錄都清掉，版本號也變
    rev4 = _feed(c)["songs_rev"]
    assert len(list((tmp / "wall").iterdir())) == 3
    assert c.delete(f"/api/planner/wall/songs/{a['id']}", headers=COUPLE).status_code == 204
    assert len(list((tmp / "wall").iterdir())) == 2
    assert _feed(c)["songs_rev"] != rev4
    assert c.get(f"/api/planner/wall/songs/{a['id']}/audio", headers=COUPLE).status_code == 404
    assert [x["id"] for x in c.get("/api/planner/wall/songs", headers=COUPLE).json()["items"]] == [d["id"], b["id"]]
    # 檔案不見了：串流回 404，不會 500
    (tmp / "wall" / next(p.name for p in (tmp / "wall").iterdir())).unlink()
    codes = sorted(c.get(f"/api/planner/wall/songs/{x}/audio", headers=COUPLE).status_code for x in (b["id"], d["id"]))
    assert codes == [200, 404]


def test_plates_off(setup):
    """後台關掉的大螢幕版面：設定存成逗號分隔，feed 回傳清單；奇怪的名稱擋掉。"""
    c, _db, _ = setup
    assert _feed(c)["plates_off"] == []
    r = c.patch("/api/planner/settings", json={"wall_plates_off": "aurora, disco,aurora"}, headers=COUPLE)
    assert r.status_code == 200, r.text
    assert _feed(c)["plates_off"] == ["aurora", "disco"]
    r = c.patch("/api/planner/settings", json={"wall_plates_off": "<script>"}, headers=COUPLE)
    assert r.status_code == 400
    r = c.patch("/api/planner/settings", json={"wall_plates_off": ""}, headers=COUPLE)
    assert r.status_code == 200 and _feed(c)["plates_off"] == []


def test_pace(setup):
    """換版面的節奏：預設 normal；只接受 fast／normal／slow。"""
    c, _db, _ = setup
    assert _feed(c)["pace"] == "normal"
    assert c.patch("/api/planner/settings", json={"wall_pace": "fast"}, headers=COUPLE).status_code == 200
    assert _feed(c)["pace"] == "fast"
    assert c.patch("/api/planner/settings", json={"wall_pace": "turbo"}, headers=COUPLE).status_code == 400


def test_remote_control(setup):
    """手機遙控（2026-09-30）：手機送指令、大螢幕每秒同步拿走並回報狀態；剛打開的大螢幕不補做以前的指令。"""
    c, db, _ = setup
    sync = lambda after, state=None, h=COUPLE: c.post("/api/planner/wall/remote/sync", json={"client": "wall-a", "after": after, "state": state or {}}, headers=h)
    cmd = lambda action, args=None, h=COUPLE: c.post("/api/planner/wall/remote/command", json={"action": action, "args": args or {}}, headers=h)
    # 還沒有大螢幕回報：手機看到沒有連線
    r = c.get("/api/planner/wall/remote/state", headers=COUPLE).json()
    assert r["state"] is None and r["online"] is False
    # 大螢幕打開前按的指令：剛打開（after=-1）只拿編號、不補做
    assert cmd("next").status_code == 201
    r = sync(-1, {"playing": True, "song": {"id": 3, "title": "告白氣球"}}).json()
    assert r["commands"] == [] and r["seq"] >= 1
    seq = r["seq"]
    st = c.get("/api/planner/wall/remote/state", headers=COUPLE).json()
    assert st["online"] is True and st["state"]["song"]["title"] == "告白氣球" and st["client"] == "wall-a" and st["age"] < 5
    # 手機按了：大螢幕下一次同步照順序拿到，參數只留該有的
    assert cmd("duck", {"on": True, "extra": "x"}).status_code == 201
    assert cmd("seek", {"t": 83.5}).status_code == 201
    assert cmd("insert", {"id": 7, "j": 3}).status_code == 201
    assert cmd("volume", {"v": 1}).status_code == 201
    r = sync(seq).json()
    assert [(x["action"], x["args"]) for x in r["commands"]] == [("duck", {"on": True}), ("seek", {"t": 83.5}), ("insert", {"id": 7, "j": 3}), ("volume", {"v": 1.0})]
    seq = r["seq"]
    assert sync(seq).json()["commands"] == []  # 做過的不會再拿到
    # 不合法的指令、參數
    for action, args in (("explode", {}), ("seek", {"t": "10"}), ("seek", {"t": -1}), ("duck", {"on": 1}), ("now", {"id": 1.5, "j": 2}), ("volume", {"v": 3}), ("shuffle", {"on": True, "x": 1})):
        res = cmd(action, args)
        assert (res.status_code == 400) == (action != "shuffle"), (action, args, res.text)
    # 超過 30 秒沒被拿走的指令就不做了（大螢幕斷線很久才回來，不要一次補做一堆）
    from datetime import datetime, timedelta, timezone
    from app.models import WallCommand
    old = WallCommand(action="next", args_json="{}", created_at=datetime.now(timezone.utc) - timedelta(seconds=60))
    db.add(old)
    db.commit()
    assert [x["action"] for x in sync(seq).json()["commands"]] == ["shuffle"]
    # 狀態太大擋掉；沒有 wall 鑰匙的幫手不能用
    assert sync(seq, {"x": "a" * 70000}).status_code == 413
    assert cmd("next", h=HELPER).status_code == 403
    assert sync(seq, h=HELPER).status_code == 403
    assert c.get("/api/planner/wall/remote/state", headers=HELPER).status_code == 403


def test_remote_two_screens(setup):
    """同時開兩台大螢幕（2026-09-30）：只有最後按「開始播放」的那台拿到指令、手機看到那台的狀態與台數；
    只是打開沒按開始的不會搶走遙控；備用那台可以按「改由這台接收遙控」搶回來；關掉的那台 8 秒後不算。"""
    c, db, _ = setup
    def sync(client, after, started=True, claim=False):
        body = {"client": client, "after": after, "state": {"started": started, "song": {"title": client}}, "claim": claim}
        return c.post("/api/planner/wall/remote/sync", json=body, headers=COUPLE).json()
    cmd = lambda action: c.post("/api/planner/wall/remote/command", json={"action": action}, headers=COUPLE)
    state = lambda: c.get("/api/planner/wall/remote/state", headers=COUPLE).json()

    # 會場那台先開、按了開始
    ra = sync("hall", -1)
    assert ra["leader"] is True and ra["screens"] == 1
    a = ra["seq"]
    # 幫手用筆電打開看一下（還沒按開始）：遙控還是會場那台
    rb = sync("laptop", -1, started=False)
    assert rb["leader"] is False and rb["screens"] == 2
    b = rb["seq"]
    assert state()["screens"] == 2 and state()["state"]["song"]["title"] == "hall"
    assert cmd("next").status_code == 201
    rb = sync("laptop", b, started=False)
    assert rb["commands"] == [] and rb["seq"] > b  # 備用的不做，但編號跟上
    b = rb["seq"]
    ra = sync("hall", a)
    assert [x["action"] for x in ra["commands"]] == ["next"]
    a = ra["seq"]
    # 筆電也按了開始：改由筆電接收，會場那台變備用
    assert sync("laptop", b)["leader"] is True
    ra = sync("hall", a)
    assert ra["leader"] is False and state()["state"]["song"]["title"] == "laptop"
    a = ra["seq"]
    assert cmd("pause").status_code == 201
    ra = sync("hall", a)
    assert ra["commands"] == [] and ra["seq"] > a
    a = ra["seq"]
    rb = sync("laptop", b)
    assert [x["action"] for x in rb["commands"]] == ["pause"]
    b = rb["seq"]
    # 會場那台按「改由這台接收遙控」：搶回來；之前給筆電的指令不會補做
    ra = sync("hall", a, claim=True)
    assert ra["leader"] is True and ra["commands"] == []
    a = ra["seq"]
    assert sync("laptop", b)["leader"] is False
    # 筆電關掉：超過 8 秒沒回報就不算，手機只看到一台
    from datetime import datetime, timedelta, timezone
    from app.models import WallScreen
    db.get(WallScreen, "laptop").seen_at = datetime.now(timezone.utc) - timedelta(seconds=20)
    db.commit()
    s = state()
    assert s["screens"] == 1 and s["online"] is True and s["client"] == "hall"
    # 會場那台也斷線：手機顯示最後回報的那台、沒有連線
    db.get(WallScreen, "hall").seen_at = datetime.now(timezone.utc) - timedelta(seconds=12)
    db.commit()
    s = state()
    assert s["screens"] == 0 and s["online"] is False and s["client"] == "hall" and s["age"] >= 11


def test_remote_lock(setup):
    """鎖定遙控（2026-10-01）：鎖在一台之後，別台按開始、搶遙控、鎖定都沒用；鎖定的那台斷線，別台也不接手；
    只有它自己解除，或後台強制解除。"""
    c, db, _ = setup
    def sync(client, after, claim=False):
        body = {"client": client, "after": after, "state": {"started": True, "song": {"title": client}}, "claim": claim}
        return c.post("/api/planner/wall/remote/sync", json=body, headers=COUPLE).json()
    lock = lambda client, h=COUPLE: c.post("/api/planner/wall/remote/lock", json={"client": client}, headers=h)
    unlock = lambda client: c.post("/api/planner/wall/remote/unlock", json={"client": client}, headers=COUPLE)
    cmd = lambda action: c.post("/api/planner/wall/remote/command", json={"action": action}, headers=COUPLE)
    state = lambda: c.get("/api/planner/wall/remote/state", headers=COUPLE).json()

    assert lock("ghost").status_code == 400  # 還沒同步過的代號不能鎖
    a = sync("hall", -1)["seq"]
    assert state()["locked"] is False
    assert lock("hall").status_code == 200 and lock("hall").status_code == 200  # 重按沒關係
    r = sync("hall", a)
    assert r["leader"] is True and r["locked"] == "mine"
    # 後來打開、按開始、按搶遙控的筆電：都還是備用，也鎖不走、解不開
    b = sync("laptop", -1)["seq"]
    r = sync("laptop", b, claim=True)
    assert r["leader"] is False and r["locked"] == "other"
    assert lock("laptop").status_code == 409 and unlock("laptop").status_code == 409
    s = state()
    assert s["locked"] is True and s["screens"] == 2 and s["state"]["song"]["title"] == "hall"
    assert cmd("next").status_code == 201
    assert sync("laptop", b)["commands"] == []
    r = sync("hall", a)
    assert [x["action"] for x in r["commands"]] == ["next"]
    a = r["seq"]
    # 鎖定的那台斷線：筆電照樣不接手，手機看到「鎖定的那台沒有連線」
    from datetime import datetime, timedelta, timezone
    from app.models import WallScreen
    db.get(WallScreen, "hall").seen_at = datetime.now(timezone.utc) - timedelta(seconds=30)
    db.commit()
    assert sync("laptop", b)["leader"] is False
    s = state()
    assert s["locked"] is True and s["online"] is False and s["client"] == "hall" and s["screens"] == 1
    # 同一個代號回來（重新整理）：還是它；重新按開始播放（claim）也記下來，解除鎖定後它是「最後按開始的」
    assert sync("hall", a, claim=True)["leader"] is True
    assert sync("laptop", b)["locked"] == "other"
    # 沒有 wall 鑰匙的幫手不能鎖、不能強制解除
    assert lock("hall", HELPER).status_code == 403
    assert c.delete("/api/planner/wall/remote/lock", headers=HELPER).status_code == 403
    # 後台強制解除：回到「最後按開始／搶遙控」的規則，筆電搶得到
    assert c.delete("/api/planner/wall/remote/lock", headers=COUPLE).status_code == 200
    assert state()["locked"] is False
    assert sync("laptop", b)["leader"] is False  # 會場那台比筆電晚按開始
    assert sync("laptop", b, claim=True)["leader"] is True
    # 鎖定的那台自己解除
    assert lock("laptop").status_code == 200
    assert unlock("laptop").status_code == 200 and state()["locked"] is False


def test_duck_level(setup):
    """講話模式的音量（2026-09-30）：預設 20%，有 wall 鑰匙就能調（0～90），大螢幕從 feed 拿、手機遙控頁從 remote/state 拿。"""
    c, db, _ = setup
    assert _feed(c)["duck"] == 20
    assert c.get("/api/planner/wall/remote/state", headers=COUPLE).json()["duck_level"] == 20
    r = c.put("/api/planner/wall/duck", json={"level": 35}, headers=COUPLE)
    assert r.status_code == 200 and r.json()["level"] == 35
    assert _feed(c)["duck"] == 35
    assert c.get("/api/planner/wall/remote/state", headers=COUPLE).json()["duck_level"] == 35
    assert c.put("/api/planner/wall/duck", json={"level": 0}, headers=COUPLE).status_code == 200  # 0 = 講話時完全靜音
    assert _feed(c)["duck"] == 0
    for bad in (-5, 91, "30", 12.5):
        assert c.put("/api/planner/wall/duck", json={"level": bad}, headers=COUPLE).status_code in (400, 422), bad
    assert c.put("/api/planner/wall/duck", json={"level": 30}, headers=HELPER).status_code == 403
    # 設定表裡被手動改成怪值：照範圍夾住，不會讓大螢幕壞掉
    _on(db, "wall_duck", "abc")
    assert _feed(c)["duck"] == 20
    _on(db, "wall_duck", "500")
    assert _feed(c)["duck"] == 90
