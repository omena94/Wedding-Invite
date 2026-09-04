import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// 多頁面（MPA）：賓客的每個頁面各自打包、各自的網址；籌備後台是單一頁面應用（/planner/*）。
// 全部共用同一個後端 / port。
//   index.html   → 首頁（邀請、婚禮資訊、表單入口；內容依後台設定的階段變化）
//   rsvp.html    → Phase 1 意願調查
//   details.html → Phase 2 詳細資料（第二階段開放後才能填）
//   info.html    → 婚禮當天資訊
//   seat.html    → 婚禮當天查桌次
//   photos.html  → 婚紗照分享
//   planner.html → 籌備後台（/planner、/planner/guests、/planner/vendors…）
const PAGES = ["rsvp", "details", "info", "seat", "photos"];

// 開發模式（npm run dev）也要能用乾淨網址：/rsvp → rsvp.html、/planner/* → planner.html
function cleanUrls() {
  return {
    name: "clean-urls",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const path = (req.url || "").split("?")[0];
        if (path === "/planner" || path.startsWith("/planner/")) req.url = "/planner.html";
        else if (PAGES.includes(path.slice(1))) req.url = `${path}.html`;
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), cleanUrls()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        ...Object.fromEntries(PAGES.map((p) => [p, resolve(__dirname, `${p}.html`)])),
        planner: resolve(__dirname, "planner.html"),
      },
    },
  },
  server: {
    port: 5173,
    // 後端位置；要接別的後端（例如測試機）可設環境變數 VITE_API_PROXY
    proxy: { "/api": process.env.VITE_API_PROXY || "http://localhost:8000" },
  },
});
