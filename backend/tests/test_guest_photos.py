"""當天照片上傳（2026-09-27）：開關關著賓客不能傳、開了能傳原檔；只有有鑰匙的人能看／刪／打包；幫手預設看不到。隔離 SQLite 與暫存資料夾。"""
import io
import os
import zipfile

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
from app.stage import set_setting


def _png():
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), (200, 150, 100)).save(buf, "PNG")
    return buf.getvalue()


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


def test_upload_gate_original_kept_and_admin_views(setup):
    c, db, tmp = setup
    couple = {"Authorization": "Bearer " + create_token()}
    helper = {"Authorization": "Bearer " + create_token("helper")}
    png = _png()
    # 開關關著：賓客不能傳；登入者可以試傳
    assert c.post("/api/guest-photos", files={"file": ("a.png", png, "image/png")}, data={"uploader": "小明"}).status_code == 403
    assert c.post("/api/guest-photos", files={"file": ("a.png", png, "image/png")}, data={"uploader": "新人試傳"}, headers=couple).status_code == 201
    set_setting(db, "guest_upload_open", "1"); db.commit()
    assert c.get("/api/stage").json()["guest_upload_open"] is True
    r = c.post("/api/guest-photos", files={"file": ("IMG_0001.png", png, "image/png")}, data={"uploader": "  小明 "})
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["uploader"] == "小明" and out["size"] == len(png) and out["has_thumb"] is True
    # 原檔一模一樣存著
    stored = [p for p in (tmp / "guest").iterdir() if not p.name.startswith("thumb_")]
    assert any(p.read_bytes() == png for p in stored)
    # 不是照片、空檔案
    assert c.post("/api/guest-photos", files={"file": ("x.txt", b"hi", "text/plain")}).status_code == 400
    assert c.post("/api/guest-photos", files={"file": ("e.png", b"", "image/png")}).status_code == 400
    # 後台：新人看得到、幫手看不到
    lst = c.get("/api/planner/guest-photos", headers=couple).json()
    assert lst["count"] == 2 and lst["total_bytes"] == 2 * len(png)
    assert c.get("/api/planner/guest-photos", headers=helper).status_code == 403
    assert c.get("/api/planner/guest-photos", ).status_code == 401
    pid = out["id"]
    assert c.get(f"/api/planner/guest-photos/{pid}/thumb", headers=couple).status_code == 200
    f = c.get(f"/api/planner/guest-photos/{pid}/file", headers=couple)
    assert f.status_code == 200 and f.content == png
    # 整包下載是可讀的 zip，檔名帶上傳者
    z = c.get("/api/planner/guest-photos/archive.zip", headers=couple)
    assert z.status_code == 200
    names = zipfile.ZipFile(io.BytesIO(z.content)).namelist()
    assert len(names) == 2 and any("小明" in n for n in names)
    # 刪除：檔案與縮圖一起清掉
    assert c.delete(f"/api/planner/guest-photos/{pid}", headers=couple).status_code == 204
    assert c.get("/api/planner/guest-photos", headers=couple).json()["count"] == 1
    assert not any(p.read_bytes() == png and "IMG" in p.name for p in (tmp / "guest").iterdir())
