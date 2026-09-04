import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// 多頁面（MPA）：四個獨立網頁，各自打包、各自的網址，但共用同一個後端 / port。
//   index.html   → 首頁（邀請、婚禮資訊、表單入口）
//   rsvp.html    → Phase 1 意願調查
//   details.html → Phase 2 詳細資料
//   admin.html   → 後台
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        rsvp: resolve(__dirname, "rsvp.html"),
        details: resolve(__dirname, "details.html"),
        admin: resolve(__dirname, "admin.html"),
      },
    },
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8000" },
  },
});
