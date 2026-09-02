"""FastAPI 進入點：同一個 port 同時提供 API 與 React 前端。"""
import logging

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import FRONTEND_DIST
from .database import init_db
from .routers import admin, rsvp

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Wedding RSVP", version="1.0")


@app.on_event("startup")
def _startup():
    init_db()  # 自動建立資料表


# ---- API 路由 ----
app.include_router(rsvp.router)
app.include_router(admin.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


# ---- 前端（React 打包後的靜態檔）----
# 單一 port 的關鍵：API 走 /api，其餘網址一律交給 React 前端。
if FRONTEND_DIST.exists():
    # /assets 等打包資源
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def pages(full_path: str):
        # API 路徑不在這裡處理（已被上面的路由攔截；此為保險）
        if full_path.startswith("api/"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        # 1) 實體檔案（圖片、.html、favicon 等）直接回傳
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        # 2) 乾淨網址：/details → details.html、/admin → admin.html
        html = FRONTEND_DIST / f"{full_path}.html"
        if full_path and html.is_file():
            return FileResponse(html)
        # 3) 其餘一律回 Phase 1 首頁
        return FileResponse(FRONTEND_DIST / "index.html")
else:
    @app.get("/")
    def _no_frontend():
        return JSONResponse(
            {
                "detail": "前端尚未打包。請先在 frontend/ 執行 `npm install && npm run build`。",
            },
            status_code=200,
        )
