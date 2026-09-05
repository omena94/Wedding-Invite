"""FastAPI 進入點：同一個 port 同時提供 API 與 React 前端。

網址分兩區：
  賓客（公開）  /  /rsvp  /details  /info  /seat  /photos
  新人（登入）  /planner/...（單一 React 應用，前端自己處理子路由）
"""
import logging

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from .config import FRONTEND_DIST, settings
from .database import init_db
from .routers import admin, photos, planner, public, rsvp, seating

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Wedding RSVP", version="2.0")


@app.on_event("startup")
def _startup():
    if len(settings.secret_key) < 32 or settings.secret_key.startswith('change-me'):
        raise RuntimeError('請在 backend/.env 設定至少 32 字元的隨機 SECRET_KEY，供後台登入與賓客回覆連結簽章使用')
    init_db()  # 自動建立資料表
    settings.upload_path  # 確保上傳目錄存在


# ---- API 路由 ----
app.include_router(rsvp.router)
app.include_router(public.router)
app.include_router(admin.router)
app.include_router(planner.router)
app.include_router(seating.router)
app.include_router(photos.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


# 舊網址：/admin → 籌備後台的賓客頁
@app.get("/admin")
@app.get("/admin/")
def _admin_redirect():
    return RedirectResponse("/planner/guests", status_code=301)


# ---- 前端（React 打包後的靜態檔）----
# 單一 port 的關鍵：API 走 /api，其餘網址一律交給 React 前端。
if FRONTEND_DIST.exists():
    # /assets 等打包資源
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    # 網頁本身不要讓瀏覽器快取：改版後賓客一開就是新版（assets 檔名有 hash，可以久放）
    _NO_CACHE = {"Cache-Control": "no-cache, must-revalidate"}

    def _html(path):
        return FileResponse(path, headers=_NO_CACHE)

    @app.get("/{full_path:path}")
    def pages(full_path: str):
        # API 路徑不在這裡處理（已被上面的路由攔截；此為保險）
        if full_path.startswith("api/"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        # 0) 籌備後台是單頁應用：/planner 與 /planner/* 一律回 planner.html
        if full_path == "planner" or full_path.startswith("planner/"):
            return _html(FRONTEND_DIST / "planner.html")
        # 1) 實體檔案（圖片、.html、favicon 等）直接回傳
        candidate = FRONTEND_DIST / full_path
        # resolve 也會處理符號連結；只允許前端目錄內的檔案。
        if not candidate.resolve().is_relative_to(FRONTEND_DIST.resolve()):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        if full_path and candidate.is_file():
            return _html(candidate) if candidate.suffix == ".html" else FileResponse(candidate)
        # 2) 乾淨網址：/rsvp → rsvp.html、/details → details.html…
        html = FRONTEND_DIST / f"{full_path}.html"
        if full_path and html.resolve().is_relative_to(FRONTEND_DIST.resolve()) and html.is_file():
            return _html(html)
        # 3) 其餘一律回首頁
        return _html(FRONTEND_DIST / "index.html")
else:
    @app.get("/")
    def _no_frontend():
        return JSONResponse(
            {
                "detail": "前端尚未打包。請先在 frontend/ 執行 `npm install && npm run build`。",
            },
            status_code=200,
        )
