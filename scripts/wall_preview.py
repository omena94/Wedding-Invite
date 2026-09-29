"""大螢幕與現場留言的本機預覽（2026-09-28）：獨立的 SQLite 與上傳資料夾，不碰正式資料、不寄信、不發通知。

先在 frontend 執行 npm run build，然後在專案根目錄：
  backend/.venv/Scripts/python.exe scripts/wall_preview.py          只有這台電腦能開：http://localhost:8010
  backend/.venv/Scripts/python.exe scripts/wall_preview.py --lan    同一個 Wi-Fi 的手機也能連（掃大螢幕角落的 QR 留言）

後台密碼 preview-wedding-only（跟 preview_local.py 一樣，只在預覽有效）。
資料（歌、留言）留在本機資料目錄的 wall-preview\，下次開還在；要全部重來就把那個資料夾刪掉。
本機資料目錄跟 scripts/paths.ps1 同一套規則：WEDDING_RSVP_HOME → C:\\WeddingRSVP → %LOCALAPPDATA%\\WeddingRSVP。
"""
import os
import socket
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))


def data_home() -> Path:
    env = os.environ.get("WEDDING_RSVP_HOME")
    if env:
        return Path(env)
    legacy = Path("C:/WeddingRSVP")
    if legacy.exists():
        return legacy
    return Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "WeddingRSVP"


def lan_ip() -> str:
    # 連一個外部位址（不會真的送出封包）來問系統「對外用哪張網卡」
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def main():
    lan = "--lan" in sys.argv
    folder = data_home() / "wall-preview"
    (folder / "uploads").mkdir(parents=True, exist_ok=True)
    db_file = folder / "preview.sqlite3"
    fresh = not db_file.exists()
    os.environ.update(
        DATABASE_URL="sqlite:///" + db_file.as_posix(), REDIS_URL="redis://127.0.0.1:1/0",
        SECRET_KEY="local-wall-preview-isolated-secret-key-2026-only", ADMIN_PASSWORD="preview-wedding-only",
        HELPER_PASSWORD="preview-helper-only", TELEGRAM_BOT_TOKEN="", TELEGRAM_CHAT_ID="", SMTP_USER="", SMTP_PASSWORD="",
        UPLOAD_DIR=str(folder / "uploads"), S3_BUCKET="",
    )
    if not (ROOT / "frontend" / "dist" / "wall.html").exists():
        print("請先在 frontend 執行 npm run build（找不到 frontend/dist/wall.html）")
        sys.exit(1)
    from app.database import SessionLocal, engine, init_db
    from app.models import WallMessage
    from app.stage import set_setting

    init_db()
    if fresh:
        with SessionLocal() as db:
            set_setting(db, "wall_open", "1")
            # 第一次開：放一則新人的話，大螢幕一打開就有東西看
            db.add(WallMessage(name="宣文 & 孟庭", text="謝謝大家今天來，吃飽喝足、玩得開心！", status="show", source="couple"))
            db.commit()
    host = "0.0.0.0" if lan else "127.0.0.1"
    base = f"http://{lan_ip() if lan else 'localhost'}:8010"
    print(f"\n  後台（現場留言、歌單）：{base}/planner/wall   密碼 preview-wedding-only")
    print(f"  大螢幕：               {base}/wall")
    print(f"  賓客留言：             {base}/wish" + ("（手機要連同一個 Wi-Fi）" if lan else ""))
    print(f"  資料放在：             {folder}\n")
    import uvicorn

    try:
        uvicorn.run("app.main:app", host=host, port=8010)
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
