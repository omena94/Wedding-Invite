# Wedding-Invite 開發須知

Alan & Omena 的婚禮網站：賓客填表（兩階段）、婚禮資訊、桌次查詢、婚紗照；新人的籌備後台（賓客、廠商、報價比價、預算付款、時程、文件、設定）。FastAPI + PostgreSQL 後端，React + Vite 前端，同一個 port。網址、角色、部署與備份步驟見 `使用說明.md` 與 `部署說明.md`，**先讀它們再動手**。

## 硬性規則

- **不用瀏覽器原生控制項。** 下拉用 `components/Select.jsx`、日期用 `DatePicker.jsx`、日期時間用 `DateTimePicker.jsx`、開關與勾選用 `Toggle.jsx`、數字用 `planner/ui.jsx` 的 `NumberInput`、選檔案用藏在樣式按鈕裡的 hidden input、確認與提示用 sweetalert2（`confirmDelete` / `toastOk` / `toastErr`）。不要出現 `<select>`、`type="date|datetime-local|time|checkbox|number"` 裸露在畫面上、`alert()`、`confirm()`。完整對照表在 `使用說明.md` 的「前端開發規範」。
- **不用絕對路徑。** 腳本與文件一律相對於專案根目錄；本機資料目錄由 `scripts/paths.ps1` 決定。
- **賓客能看到的網址不要隨便改。** `/`、`/rsvp`、`/details` 已經發給賓客；要加頁面就加新的。
- **賓客頁的「尚未開放」要放行後台登入者（預覽模式）。** 賓客頁的 API 用 `security.optional_staff`，有有效 token 就略過開放檢查；前端用 `fetchStage()` 回的 `preview` 判斷，並放 `PreviewBanner` 提醒。新增有開關的賓客功能時照做。
- 密碼、`.env`、`backend/uploads/`、`frontend/dist/` 不進 Git。伺服器金鑰 `server-key.pem` 是刻意放在 repo 的，別再貼到別處。

## 怎麼改、怎麼測

- 後端需要 Python 3.10+。本機沒有的話，在伺服器上另開測試實例（SQLite、port 8001、Redis 指到不存在的 port），再用 `ssh -L 8001:127.0.0.1:8001` 接回本機，前端 `VITE_API_PROXY=http://127.0.0.1:8001 npx vite`。**不要把測試資料寫進正式資料庫。**
- 新增資料表只要加 model，後端啟動會自動建表（多 worker 有 advisory lock 排隊）；改既有欄位要另外寫 SQL。
- 前端改完 `npm run build`；部署照 `部署說明.md` 的三步（先刪舊 `backend/app` 與 `dist` 再解壓）。
- 使用者已要求修改完成後自動部署正式環境並 `git push`：先完成相關測試與打包，備份後部署，再檢查正式站；不需要再次詢問部署許可。正式資料不可用作測試資料。
- 文案、日期、地點集中在 `frontend/src/constants.js` 與 `components/EventDetails.jsx`。

## 風格

- 介面文字用繁體中文，語氣跟現有頁面一致（給非工程師看得懂）。
- 沿用 `theme.css` 的變數與既有 class（`panel`、`btn`、`pill`、`form-group`、`grid-2`…），不要另開一套樣式。
- 程式註解用中文，說明「為什麼」，不只是「做什麼」。
