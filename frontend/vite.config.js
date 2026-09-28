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
//   upload.html  → 婚禮當天賓客上傳照片
//   wish.html    → 婚禮當天現場留言（賓客寫，出現在大螢幕）
//   wall.html    → 會場大螢幕（要登入後台）
//   planner.html → 籌備後台（/planner、/planner/guests、/planner/vendors…）
// upload：婚禮當天賓客上傳照片（2026-09-27）；wish、wall：現場留言與大螢幕（2026-09-28）
const PAGES = ["rsvp", "details", "info", "seat", "photos", "upload", "wish", "wall"];

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

// 大螢幕的開發模式（/wall?dev=1）：不連後端，測試音檔從本機資料夾讀。
// 資料夾由環境變數 WALL_DEV_AUDIO_DIR 指定（放 mp3/m4a，同名的 .lrc 會當歌詞；檔名「歌名 - 歌手.mp3」）。
// 只在 npm run dev 有作用，打包出去的網站沒有這些網址。
function wallDevAudio() {
  const AUDIO = /\.(mp3|m4a|aac|wav|ogg|flac|mp4)$/i;
  return {
    name: "wall-dev-audio",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || "").split("?")[0];
        if (!url.startsWith("/wall-dev/")) return next();
        const { readdirSync, readFileSync, existsSync, createReadStream, statSync } = await import("node:fs");
        const path = await import("node:path");
        const dir = process.env.WALL_DEV_AUDIO_DIR || "";
        if (url === "/wall-dev/songs.json") {
          const files = dir && existsSync(dir) ? readdirSync(dir).filter((f) => AUDIO.test(f)).sort() : [];
          const songs = files.map((file, i) => {
            const stem = file.replace(AUDIO, "");
            const [title, artist] = stem.includes(" - ") ? stem.split(" - ", 2) : [stem, ""];
            const lrcPath = path.join(dir, `${stem}.lrc`);
            // 檔名不能有「/」，常被換成「_」（24_7 → 24/7），跟後台上傳時一樣換回來
            return { id: i + 1, file, title: title.replace(/(\d)_(\d)/g, "$1/$2"), artist, lrc: existsSync(lrcPath) ? readFileSync(lrcPath, "utf8") : "" };
          });
          res.setHeader("Content-Type", "application/json");
          return res.end(JSON.stringify(songs));
        }
        const m = /^\/wall-dev\/audio\/(.+)$/.exec(url);
        const file = m && dir ? path.join(dir, decodeURIComponent(m[1])) : "";
        if (!file || !path.resolve(file).startsWith(path.resolve(dir)) || !existsSync(file)) { res.statusCode = 404; return res.end(); }
        res.setHeader("Content-Length", String(statSync(file).size));
        createReadStream(file).pipe(res);
      });
    },
  };
}

// 大螢幕版面裡寫死的中文字（標題、標籤、冷面註腳）：打包時掃一遍 scenes/*.ts，給引擎開機時先把這些字的字型載好。
// 中文字型是 Google Fonts 依字分片下載的，版面第一次出現時才載，網路慢就會先用備援字畫、那個窗格就一直是錯的字型。
// 註解不算（註解也是中文，掃進來會多載一堆用不到的字）。
function wallGlyphs() {
  const ID = "virtual:wall-glyphs";
  const RID = "\0" + ID;
  const dir = resolve(__dirname, "src/wall/scenes");
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"`\\])\/\/.*$/gm, "$1");
  const cjk = (s) => [...new Set(s.match(/[⺀-〿㐀-鿿豈-﫿＀-￯]/g) || [])].join("");
  return {
    name: "wall-glyphs",
    resolveId(id) { return id === ID ? RID : undefined; },
    async load(id) {
      if (id !== RID) return;
      const { readdirSync, readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
      const src = (f) => { this.addWatchFile(join(dir, f)); return strip(readFileSync(join(dir, f), "utf8")); };
      const shared = cjk(files.filter((f) => f.startsWith("_")).map(src).join(""));
      const scenes = {};
      for (const f of files.filter((f) => !f.startsWith("_") && !f.includes("-"))) {
        const name = f.slice(0, -3);
        scenes[name] = cjk(files.filter((g) => g === f || g.startsWith(`${name}-`)).map(src).join(""));
      }
      return `export const SHARED = ${JSON.stringify(shared)};\nexport const SCENES = ${JSON.stringify(scenes)};\n`;
    },
  };
}

export default defineConfig({
  plugins: [react(), cleanUrls(), wallDevAudio(), wallGlyphs()],
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
