# Wedding-Invite 開發須知

Alan & Omena 的婚禮網站：賓客填表（兩階段）、婚禮資訊、桌次查詢、婚紗照；新人的籌備後台（賓客、喜餅、預算付款、時程、備忘、活動環節、文件、設定）。FastAPI + PostgreSQL 後端，React + Vite 前端，同一個 port。網址、角色與操作方式見 `使用說明.md`，**先讀它再動手**。

> **2026-10-06 起正式站已關閉。** 婚禮網站已搬到新的平台，這個 repo 保留作為作品與開發紀錄。

## 硬性規則

- **不用瀏覽器原生控制項。** 下拉用 `components/Select.jsx`、日期用 `DatePicker.jsx`、日期時間用 `DateTimePicker.jsx`、開關與勾選用 `Toggle.jsx`、數字用 `planner/ui.jsx` 的 `NumberInput`、選檔案用藏在樣式按鈕裡的 hidden input、確認與提示用 sweetalert2（`confirmDelete` / `toastOk` / `toastErr`）。不要出現 `<select>`、`type="date|datetime-local|time|checkbox|number"` 裸露在畫面上、`alert()`、`confirm()`。完整對照表在 `使用說明.md` 的「前端開發規範」。
- **不用絕對路徑。** 腳本與文件一律相對於專案根目錄；本機資料目錄由 `scripts/paths.ps1` 決定。
- **賓客能看到的網址不要隨便改。** `/`、`/rsvp`、`/details` 已經發給賓客；要加頁面就加新的。
- **賓客頁的「尚未開放」要放行後台登入者（預覽模式）。** 賓客頁的 API 用 `security.optional_staff`，有有效 token 就略過開放檢查；前端用 `fetchStage()` 回的 `preview` 判斷，並放 `PreviewBanner` 提醒。新增有開關的賓客功能時照做。
- 密碼、`.env`、金鑰（`*.pem`、`*.key`）、`backend/uploads/`、`frontend/dist/` 不進 Git。

## 怎麼改、怎麼測

- 後端需要 Python 3.10+（舊主機已終止，不能再到伺服器上開測試實例）。
- 新增資料表只要加 model，後端啟動會自動建表（多 worker 有 advisory lock 排隊）；改既有欄位要另外寫 SQL。
- 前端改完 `npm run build`。正式站已關閉，**不要部署到任何伺服器**；只在使用者要求時 `git push`。
- 文案、日期、地點集中在 `frontend/src/constants.js` 與 `components/EventDetails.jsx`。
- **會場大螢幕（`/wall`、`frontend/src/wall/`）** 照 pdoom-video 的引擎用 TypeScript + three.js 寫，規則與截圖檢查方法在 `docs/wall/ENGINE.md`，風格在 `docs/wall/TREATMENT.md`。改完跑 `npx tsc --noEmit -p src/wall`，並用 `node scripts/wall-render.mjs` 截圖**打開圖片看過**再交件。
- 大螢幕／現場留言 2026-09-28 已依新人要求上線（賓客留言開關預設關著）；本機完整預覽用 `scripts/wall_preview.py`（用法在檔頭）。
- 在 bash 裡用 `node -e "..."` 改 Markdown 時，字串裡不能有反引號（bash 會當成指令執行）；改文件用編輯工具。

## 風格

- 介面文字用繁體中文，語氣跟現有頁面一致（給非工程師看得懂）。
- 沿用 `theme.css` 的變數與既有 class（`panel`、`btn`、`pill`、`form-group`、`grid-2`…），不要另開一套樣式。
- 程式註解用中文，說明「為什麼」，不只是「做什麼」。
