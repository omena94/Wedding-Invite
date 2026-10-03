"""大螢幕要放哪些內容（2026-10-03）：歌詞、賓客留言、照片＋註解可各自開關；關掉留言時 /wish 跟著關、版面改放新人自己的話；
照片的清單、長寬亮度與焦點、大螢幕用的尺寸；每本相簿給誰看（賓客／大螢幕）。隔離 SQLite 與暫存資料夾。"""
import os

os.environ.update(DATABASE_URL="sqlite://", SECRET_KEY="local-test-secret-key-not-for-deployment-2026",
                  TELEGRAM_BOT_TOKEN="", TELEGRAM_CHAT_ID="", SMTP_USER="", SMTP_PASSWORD="")

import io
import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.security import create_token
from app.stage import WALL_OPEN_KEY, set_setting

COUPLE = {"Authorization": "Bearer " + create_token()}
HELPER = {"Authorization": "Bearer " + create_token("helper")}
CONTENT = "/api/planner/wall/content"
FEED = "/api/planner/wall/feed"
PHOTOS = "/api/planner/wall/photos"


@pytest.fixture
def setup(monkeypatch, tmp_path):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = Session(engine, expire_on_commit=False)
    app.dependency_overrides[get_db] = lambda: db
    from app import config, live
    monkeypatch.setattr(config.settings, "upload_dir", str(tmp_path))
    monkeypatch.setattr(live, "_redis", lambda: None)
    monkeypatch.setattr(live, "hub", live.Hub())
    c = TestClient(app)
    yield c, db
    app.dependency_overrides.clear()
    c.close()
    db.close()
    engine.dispose()


def _jpeg(w: int, h: int, color=(200, 120, 90)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, "JPEG")
    return buf.getvalue()


def _jpeg_exif(w: int, h: int, orientation: int, color=(30, 30, 40)) -> bytes:
    buf = io.BytesIO()
    exif = Image.Exif()
    exif[0x0112] = orientation
    Image.new("RGB", (w, h), color).save(buf, "JPEG", exif=exif)
    return buf.getvalue()


def _upload(c, name, album="", caption="", data=None):
    r = c.post("/api/planner/files", files={"file": (name, data if data is not None else _jpeg(64, 48), "image/jpeg")},
               data={"kind": "photo", "album": album, "caption": caption}, headers=COUPLE)
    assert r.status_code == 201, r.text
    return r.json()


def _open_wall(db):
    set_setting(db, WALL_OPEN_KEY, "1")
    db.commit()


def test_defaults_update_and_validation(setup):
    c, _ = setup
    # 沒設定過：原本的樣子（歌詞＋留言，不放照片）
    assert c.get(CONTENT, headers=COUPLE).json() == {"lyrics": True, "messages": True, "photos": False, "captions": True, "albums": [], "mix": "even"}
    r = c.put(CONTENT, json={"lyrics": False, "albums": ["婚紗", "婚紗", " 成長 "], "mix": "photos"}, headers=COUPLE)
    assert r.status_code == 200, r.text
    assert r.json() == {"lyrics": False, "messages": True, "photos": False, "captions": True, "albums": ["婚紗", "成長"], "mix": "photos"}
    # 只改一樣，其他的不變
    assert c.put(CONTENT, json={"photos": True}, headers=COUPLE).json()["lyrics"] is False
    assert c.get(FEED, headers=COUPLE).json()["content"]["photos"] is True
    assert c.put(CONTENT, json={"mix": "random"}, headers=COUPLE).status_code == 400
    assert c.put(CONTENT, json={"mix": "all"}, headers=COUPLE).json()["mix"] == "all"
    assert c.put(CONTENT, json={"lyrics": "no"}, headers=COUPLE).status_code == 422
    # 當天幫手（只有「大螢幕：當天操作」）也能切：進場只放照片、用餐時打開留言
    c.patch("/api/planner/settings", json={"role_permissions": json.dumps({"couple": ["settings", "wall", "wall_setup"], "helper": ["wall"]})}, headers=COUPLE)
    assert c.put(CONTENT, json={"messages": False}, headers=HELPER).status_code == 200
    assert c.get(CONTENT, headers=HELPER).json()["messages"] is False


def test_messages_off(setup):
    c, db = setup
    _open_wall(db)
    assert c.post("/api/wall/messages", json={"name": "佳穎", "text": "新婚快樂"}).status_code == 201
    assert c.post("/api/planner/wall/messages", json={"text": "謝謝大家來"}, headers=COUPLE).status_code == 201
    assert {m["text"] for m in c.get(FEED, headers=COUPLE).json()["messages"]} == {"新婚快樂", "謝謝大家來"}
    assert c.get("/api/stage").json()["wall_open"] is True

    c.put(CONTENT, json={"messages": False}, headers=COUPLE)
    feed = c.get(FEED, headers=COUPLE).json()
    # 賓客的留言不上螢幕（資料留著），新人自己寫的話照樣輪流放
    assert [m["text"] for m in feed["messages"]] == ["謝謝大家來"] and feed["messages"][0]["source"] == "couple"
    # 賓客端：/wish 當作沒開放，送出也擋
    assert c.get("/api/stage").json()["wall_open"] is False
    assert c.post("/api/wall/messages", json={"text": "再一則"}).status_code == 403
    assert len(c.get("/api/planner/wall/messages", headers=COUPLE).json()["items"]) == 2

    # 新人一句都沒寫：用預設的感謝詞頂在留言的位置（版面不能畫「掃描 QR code」）
    mine = [m for m in c.get("/api/planner/wall/messages", headers=COUPLE).json()["items"] if m["source"] == "couple"]
    c.delete(f"/api/planner/wall/messages/{mine[0]['id']}", headers=COUPLE)
    feed = c.get(FEED, headers=COUPLE).json()
    assert feed["messages"] and all(m["id"] < 0 and m["source"] == "couple" for m in feed["messages"])

    # 打開：賓客的留言回來
    c.put(CONTENT, json={"messages": True}, headers=COUPLE)
    assert [m["text"] for m in c.get(FEED, headers=COUPLE).json()["messages"]] == ["新婚快樂"]
    assert c.post("/api/wall/messages", json={"text": "再一則"}).status_code == 201


def test_photos(setup):
    c, db = setup
    a1 = _upload(c, "a1.jpg", album="成長", caption="小時候")
    a2 = _upload(c, "a2.jpg", album="成長")
    b1 = _upload(c, "b1.jpg", album="婚紗", caption="風好大", data=_jpeg(3000, 1000))
    # 不是圖片的檔（婚紗照頁也收得到 PDF）不上大螢幕
    r = c.post("/api/planner/files", files={"file": ("menu.pdf", b"%PDF-1.4", "application/pdf")}, data={"kind": "photo"}, headers=COUPLE)
    assert r.status_code == 201, r.text

    data = c.get(PHOTOS, headers=COUPLE).json()
    assert [p["id"] for p in data["items"]] == [a1["id"], a2["id"], b1["id"]]
    assert {a["album"]: (a["count"], a["captioned"]) for a in data["albums"]} == {"成長": (2, 1), "婚紗": (1, 1)}
    # 照片沒打開時 feed 不帶照片版本號（大螢幕不用抓）
    assert c.get(FEED, headers=COUPLE).json()["photos_rev"] == ""

    c.put(CONTENT, json={"photos": True, "albums": ["婚紗"]}, headers=COUPLE)
    assert [p["id"] for p in c.get(PHOTOS, headers=COUPLE).json()["items"]] == [b1["id"]]
    rev = c.get(FEED, headers=COUPLE).json()["photos_rev"]
    assert rev
    # 改註解：版本號跟著變，大螢幕才會重抓
    assert c.patch(f"/api/planner/files/{b1['id']}", json={"caption": "風真的好大"}, headers=COUPLE).status_code == 200
    assert c.get(FEED, headers=COUPLE).json()["photos_rev"] != rev

    # 大螢幕用的尺寸：長邊 2048 的 JPEG，存在原檔旁邊；刪照片時一起刪
    r = c.get(f"{PHOTOS}/{b1['id']}/image", headers=COUPLE)
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    with Image.open(io.BytesIO(r.content)) as im:
        assert max(im.size) == 2048
    from app.config import settings
    from app.models import FileAsset
    from app.thumbs import wall_image_name

    path = settings.upload_path / wall_image_name(db.get(FileAsset, b1["id"]).stored_name)
    assert path.is_file()
    assert c.delete(f"/api/planner/files/{b1['id']}", headers=COUPLE).status_code == 204
    assert not path.is_file()
    assert c.get(f"{PHOTOS}/{b1['id']}/image", headers=COUPLE).status_code == 404
    # 不是照片的檔不能從這裡拿
    doc = c.post("/api/planner/files", files={"file": ("q.pdf", b"%PDF-1.4", "application/pdf")}, data={"kind": "doc"}, headers=COUPLE).json()
    assert c.get(f"{PHOTOS}/{doc['id']}/image", headers=COUPLE).status_code == 404


def test_photo_info_and_focus(setup):
    """大螢幕挑版面用的長寬（照 EXIF 轉正）、亮度、色調；新人設的焦點；加欄位之前上傳的照片第一次要清單時補算。"""
    c, db = setup
    # 手機直拍：檔案裡是橫的 1600×1066，EXIF 說要轉 90 度
    tall = _upload(c, "tall.jpg", album="婚紗", data=_jpeg_exif(1600, 1066, 6))
    bright = _upload(c, "bright.jpg", album="婚紗", data=_jpeg(800, 600))
    items = {p["id"]: p for p in c.get(PHOTOS, headers=COUPLE).json()["items"]}
    assert (items[tall["id"]]["w"], items[tall["id"]]["h"]) == (1066, 1600)
    assert items[tall["id"]]["lum"] < 0.2 and items[bright["id"]]["lum"] > 0.4
    assert items[bright["id"]]["tone"].startswith("#") and len(items[bright["id"]]["tone"]) == 7
    assert items[tall["id"]]["fx"] is None and items[tall["id"]]["fy"] is None

    c.put(CONTENT, json={"photos": True}, headers=COUPLE)
    rev = c.get(FEED, headers=COUPLE).json()["photos_rev"]
    r = c.patch(f"/api/planner/files/{tall['id']}", json={"focus_x": 0.3, "focus_y": 0.25}, headers=COUPLE)
    assert r.status_code == 200 and (r.json()["focus_x"], r.json()["focus_y"]) == (0.3, 0.25)
    p = {x["id"]: x for x in c.get(PHOTOS, headers=COUPLE).json()["items"]}[tall["id"]]
    assert (p["fx"], p["fy"]) == (0.3, 0.25)
    assert c.get(FEED, headers=COUPLE).json()["photos_rev"] != rev  # 大螢幕會重抓
    assert c.patch(f"/api/planner/files/{tall['id']}", json={"focus_x": 1.5}, headers=COUPLE).status_code == 422
    # 清掉：回到預設
    c.patch(f"/api/planner/files/{tall['id']}", json={"focus_x": None, "focus_y": None}, headers=COUPLE)
    assert {x["id"]: x for x in c.get(PHOTOS, headers=COUPLE).json()["items"]}[tall["id"]]["fx"] is None

    # 加欄位之前上傳的照片：第一次要清單時補算
    from app.models import FileAsset

    row = db.get(FileAsset, bright["id"])
    row.img_w, row.img_h, row.lum, row.tone = 0, 0, None, ""
    db.commit()
    p = {x["id"]: x for x in c.get(PHOTOS, headers=COUPLE).json()["items"]}[bright["id"]]
    assert (p["w"], p["h"]) == (800, 600) and p["lum"] is not None


def test_album_guests_and_wall(setup):
    """每本相簿給誰看：生活照設成只放大螢幕，賓客的照片頁看不到（就算單張標了公開、知道網址也打不開），大螢幕照樣放。"""
    c, _ = setup
    wed = _upload(c, "w.jpg", album="婚紗")
    life = _upload(c, "l.jpg", album="生活照")
    c.post("/api/planner/photos/publish", json={"ids": [wed["id"], life["id"]], "is_public": True}, headers=COUPLE)
    c.patch("/api/planner/settings", json={"photos_open": "1"}, headers=COUPLE)
    assert {p["id"] for p in c.get("/api/photos").json()} == {wed["id"], life["id"]}

    # 生活照：只放大螢幕
    r = c.put("/api/planner/photos/albums", json={"album": "生活照", "guests": False}, headers=COUPLE)
    assert r.status_code == 200, r.text
    flags = {a["album"]: (a["guests"], a["wall"]) for a in r.json()["albums"]}
    assert flags == {"婚紗": (True, True), "生活照": (False, True)}
    assert [p["id"] for p in c.get("/api/photos").json()] == [wed["id"]]
    assert c.get(f"/api/photos/{life['id']}").status_code == 404
    assert c.get(f"/api/photos/{life['id']}/thumb").status_code == 404
    assert c.get(f"/api/photos/{wed['id']}/thumb").status_code == 200
    c.put(CONTENT, json={"photos": True}, headers=COUPLE)
    assert {p["id"] for p in c.get(PHOTOS, headers=COUPLE).json()["items"]} == {wed["id"], life["id"]}

    # 婚紗照不放大螢幕（從大螢幕的內容分頁關）：大螢幕只剩生活照，賓客照樣看得到婚紗照
    r = c.put("/api/planner/wall/albums", json={"album": "婚紗", "wall": False}, headers=COUPLE)
    assert r.status_code == 200, r.text
    assert [p["id"] for p in r.json()["items"]] == [life["id"]]
    assert {a["album"]: a["wall"] for a in r.json()["albums"]} == {"婚紗": False, "生活照": True}
    assert [p["id"] for p in c.get("/api/photos").json()] == [wed["id"]]

    # 還沒有照片的新相簿也可以先設好（上傳時先選用途，照片一上來就不會公開給賓客）
    c.put("/api/planner/photos/albums", json={"album": "交往", "guests": False, "wall": True}, headers=COUPLE)
    new = _upload(c, "n.jpg", album="交往")
    c.post("/api/planner/photos/publish", json={"ids": [new["id"]], "is_public": True}, headers=COUPLE)
    assert new["id"] not in {p["id"] for p in c.get("/api/photos").json()}


def test_album_flags_legacy_and_perms(setup):
    """之前用 wall_content.albums 選的相簿：第一次改相簿設定時轉成每本的開關。只有照片鑰匙的幫手不能改大螢幕。"""
    c, _ = setup
    _upload(c, "a.jpg", album="婚紗")
    b = _upload(c, "b.jpg", album="生活照")
    c.put(CONTENT, json={"photos": True, "albums": ["生活照"]}, headers=COUPLE)
    assert [p["id"] for p in c.get(PHOTOS, headers=COUPLE).json()["items"]] == [b["id"]]
    c.put("/api/planner/photos/albums", json={"album": "生活照", "guests": False}, headers=COUPLE)
    # 舊清單轉成每本的開關，之後只看相簿設定
    assert c.get(CONTENT, headers=COUPLE).json()["albums"] == []
    assert [p["id"] for p in c.get(PHOTOS, headers=COUPLE).json()["items"]] == [b["id"]]
    assert {x["album"]: x["wall"] for x in c.get("/api/planner/photos", headers=COUPLE).json()["albums"]} == {"婚紗": False, "生活照": True}

    # 只有照片鑰匙的幫手：能改賓客看不看得到，不能改大螢幕
    c.patch("/api/planner/settings", json={"role_permissions": json.dumps({"couple": ["settings", "photos", "wall", "wall_setup"], "helper": ["photos"]})}, headers=COUPLE)
    assert c.put("/api/planner/photos/albums", json={"album": "婚紗", "guests": False}, headers=HELPER).status_code == 200
    assert c.put("/api/planner/photos/albums", json={"album": "婚紗", "wall": True}, headers=HELPER).status_code == 403
    assert c.put("/api/planner/wall/albums", json={"album": "婚紗", "wall": True}, headers=HELPER).status_code == 403
