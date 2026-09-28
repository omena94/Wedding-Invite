#!/usr/bin/env node
// 大螢幕的截圖／效能工具（照 pdoom-video 的 scripts/render.ts）：用無頭 Chrome 開 /wall?dev=1&export=1，
// 指定版面、時間點、測試歌，存成 PNG，讓人（或 Claude）直接看畫面檢查。不連後端、不碰正式資料。
//
//   node scripts/wall-render.mjs stills --scene sparkler --t 2,4.5,7 [--song "歌手 - 歌名.mp3"] [--message 3]
//        [--params '{"kind":"invite"}'] [--theme rose] [--popup 5@3.2] [--no-lyrics] [--win-from 0 --win-to 12] [--out ../wall-out/sparkler]
//   node scripts/wall-render.mjs sheet  --scene slam --from 20 --to 32 --n 12 --cols 4 --out ../wall-out/slam.png
//   node scripts/wall-render.mjs perf   --scene stars --from 20 [--n 180]
//   node scripts/wall-render.mjs timeline [--song x.mp3]      （印出導演排出來的時間軸）
//   不給 --scene：讓導演排整首歌（跟現場一樣）。
//
// 測試音檔：環境變數 WALL_DEV_AUDIO_DIR 指到一個放 mp3（可附同名 .lrc）的資料夾；沒有的話用無聲的假節拍。
// Chrome 用本機安裝的（playwright-core 的 channel: 'chrome'）。
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const mode = argv[0] ?? 'stills';
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const CACHE = path.join(tmpdir(), 'wedding-wall-cache');
mkdirSync(CACHE, { recursive: true });

// 好幾個人（或助手）可能同時在截圖：port 隨機起跳，被占用就往後找
const server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 5400 + Math.floor(Math.random() * 400), strictPort: false, hmr: false } });
await server.listen();
const url = (server.resolvedUrls?.local?.[0] ?? `http://localhost:${server.config.server.port}/`).replace(/\/$/, '');

const browser = await chromium.launch({
  channel: 'chrome', headless: !argv.includes('--headed'),
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

try {
  const scale = opt('scale');
  // 指定了版面就只載那一個（加上片頭卡、karaoke）：版面很多，全部載入要等很久
  const only = opt('scene') && !argv.includes('--all-scenes') ? `&only=${encodeURIComponent(opt('scene'))}` : '';
  await page.goto(`${url}/wall.html?dev=1&export=1${scale ? `&scale=${scale}` : ''}${only}`);
  await page.waitForFunction(() => window.__wall?.ready || window.__wall?.error, null, { timeout: 180000 });
  const err = await page.evaluate(() => window.__wall.error);
  if (err) throw new Error(`大螢幕開不起來：\n${err}\n${logs.join('\n')}`);
  const songs = await page.evaluate(() => window.__wall.songs());
  const song = opt('song', songs[0]);
  const cacheFile = song ? path.join(CACHE, `${song.replace(/[^\w.-]+/g, '_')}.json`) : '';
  const analysis = cacheFile && existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : null;
  const setup = {
    song, scene: opt('scene'), message: opt('message') ? Number(opt('message')) : undefined,
    params: opt('params') ? JSON.parse(opt('params')) : undefined, theme: opt('theme'), analysis,
    from: opt('win-from') ? Number(opt('win-from')) : undefined, to: opt('win-to') ? Number(opt('win-to')) : undefined,
    // --no-lyrics：當成純音樂（沒有歌詞）測試
    ...(argv.includes('--no-lyrics') ? { lrc: '' } : {}),
  };
  const info = await page.evaluate((o) => window.__wall.setup(o), setup);
  // 先寫暫存檔再改名：同時有別人在讀也不會讀到寫一半的檔
  if (cacheFile && !analysis && info.analysis) { const tmp = `${cacheFile}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(info.analysis)); renameSync(tmp, cacheFile); }
  console.log(`歌：${song ?? '（無聲）'}  ${info.duration.toFixed(1)} 秒  ${info.bpm.toFixed(1)} BPM  歌詞 ${info.lines} 行`);
  for (const p of (opt('popup') ?? '').split(',').filter(Boolean)) {
    const [id, at] = p.split('@').map(Number);
    await page.evaluate(([i, a]) => window.__wall.popup(i, a, true), [id, at]);
  }
  const sceneErrors = await page.evaluate(() => window.__wall.errors);

  if (mode === 'timeline') {
    for (const e of info.timeline) console.log(`${e.start.toFixed(2).padStart(7)} – ${e.end.toFixed(2).padStart(7)}  ${e.scene}  (${e.id})`);
  } else if (mode === 'stills') {
    const out = path.resolve(opt('out', path.join(ROOT, '..', 'wall-out', opt('scene') ?? 'director')));
    mkdirSync(out, { recursive: true });
    for (const t of opt('t', '1').split(',').map(Number)) {
      const id = await page.evaluate((tt) => window.__wall.still(tt), t);
      const f = path.join(out, `f_${t.toFixed(2).padStart(7, '0')}.png`);
      await page.screenshot({ path: f, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
      console.log(`${f}  [${id}]`);
    }
  } else if (mode === 'sheet') {
    const from = Number(opt('from', '0')), to = Number(opt('to', '10')), n = Number(opt('n', '12')), cols = Number(opt('cols', '4'));
    const times = Array.from({ length: n }, (_, i) => from + ((to - from) * i) / Math.max(1, n - 1));
    const tw = Math.floor(3840 / cols / 2), th = Math.round((tw * 9) / 16);
    const shots = [];
    for (const t of times) {
      await page.evaluate((tt) => window.__wall.still(tt), t);
      shots.push((await page.screenshot({ clip: { x: 0, y: 0, width: 1920, height: 1080 } })).toString('base64'));
    }
    // 在頁面裡用 canvas 拼成一張
    const b64 = await page.evaluate(async ([imgs, cols, tw, th, times]) => {
      const rows = Math.ceil(imgs.length / cols);
      const cv = new OffscreenCanvas(cols * tw, rows * (th + 22));
      const c = cv.getContext('2d');
      c.fillStyle = '#111'; c.fillRect(0, 0, cv.width, cv.height);
      for (let i = 0; i < imgs.length; i++) {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${imgs[i]}`)).blob());
        const x = (i % cols) * tw, y = Math.floor(i / cols) * (th + 22);
        c.drawImage(bmp, x, y + 22, tw, th);
        c.fillStyle = '#ccc'; c.font = '14px monospace'; c.fillText(`${times[i].toFixed(2)}s`, x + 6, y + 16);
      }
      const b = new Uint8Array(await (await cv.convertToBlob({ type: 'image/png' })).arrayBuffer());
      let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
      return btoa(s);
    }, [shots, cols, tw, th, times]);
    const out = path.resolve(opt('out', path.join(ROOT, '..', 'wall-out', `${opt('scene') ?? 'director'}-sheet.png`)));
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(b64, 'base64'));
    console.log(out);
  } else if (mode === 'qa') {
    // 標準驗收：同一個版面跑十種情境（長短留言、英文、只有愛心、沒留言、純音樂、慢歌、2 小節、新人留言＋三張小卡），
    // 加確定性檢查（同一個時間點畫兩次要一模一樣）與效能，拼成一張總表 wall-out/qa/<版面>.jpg，數字寫在 <版面>.json。
    // 需要標準測試音檔資料夾（Test Band - Fast Pop.mp3、Test Band - Slow Ballad.mp3）。
    const scene = opt('scene');
    if (!scene) throw new Error('qa 要指定 --scene');
    const FAST = 'Test Band - Fast Pop.mp3', SLOW = 'Test Band - Slow Ballad.mp3';
    if (!songs.includes(FAST) || !songs.includes(SLOW)) throw new Error(`qa 需要標準測試音檔（${FAST}、${SLOW}）`);
    const cases = [
      { label: 'A 長留言・燭光金・9 小節', song: FAST, message: 3, theme: 'gold', from: 20, to: 36.4, t: [20.3, 21.5, 23.5, 27, 31, 36.1] },
      { label: 'B 短留言・珊瑚・4 小節', song: FAST, message: 2, theme: 'coral', from: 40, to: 47.3, t: [40.3, 42, 44.5, 47] },
      { label: 'C 英文留言・玫瑰', song: FAST, message: 5, theme: 'rose', from: 60, to: 71, t: [60.5, 63, 66, 70.7] },
      { label: 'D 只有愛心・薰衣草', song: FAST, message: 9, theme: 'lilac', from: 76, to: 83.3, t: [76.5, 79, 83] },
      { label: 'E 最長 60 字・鼠尾草', song: FAST, message: 15, theme: 'sage', from: 90, to: 104.5, t: [90.5, 93, 97, 101, 104.2] },
      { label: 'F 沒有留言・香檳', song: FAST, params: { message: null }, theme: 'champagne', from: 106, to: 117, t: [106.5, 109, 113, 116.7] },
      { label: 'G 純音樂（沒有歌詞）', song: FAST, message: 3, theme: 'gold', from: 20, to: 32, t: [21, 25, 31.7], lrc: '' },
      { label: 'H 慢歌', song: SLOW, message: 3, theme: 'gold', from: 20, to: 40, t: [21, 26, 32, 39.6] },
      { label: 'I 2 小節', song: FAST, message: 3, theme: 'coral', from: 50, to: 53.64, t: [50.2, 51.5, 53.4] },
      { label: 'J 新人留言', song: FAST, message: 1, theme: 'gold', from: 20, to: 36.4, t: [23, 27] },
    ];
    // --params '{"variant":2}'：每個情境都帶這些參數（測變化款）；輸出檔名加上 --tag（預設 v2 這種）
    const extra = opt('params') ? JSON.parse(opt('params')) : {};
    const tag = opt('tag', extra.variant !== undefined ? `v${extra.variant}` : '');
    const outName = tag ? `${scene}.${tag}` : scene;
    const analyses = {};
    const report = { scene, params: extra, cases: [], errors: [], deterministic: null, perf: null };
    // 總表直接在頁面裡拼：每畫一格就把畫布縮小貼上去（把幾十張全尺寸截圖傳進頁面會把頁面撐爆）
    await page.evaluate(([n]) => {
      const TW = 320, TH = 180, LH = 26, COLS = 6;
      const cv = new OffscreenCanvas(TW * COLS, n * (TH + LH));
      const c = cv.getContext('2d');
      c.fillStyle = '#111'; c.fillRect(0, 0, cv.width, cv.height);
      window.__qa = { cv, c, TW, TH, LH };
    }, [cases.length]);
    for (const [ri, cs] of cases.entries()) {
      const cf = path.join(CACHE, `${cs.song.replace(/[^\w.-]+/g, '_')}.json`);
      analyses[cs.song] ??= existsSync(cf) ? JSON.parse(readFileSync(cf, 'utf8')) : null;
      const inf = await page.evaluate((o) => window.__wall.setup(o), { song: cs.song, scene, message: cs.message, params: { ...extra, ...(cs.params ?? {}) }, theme: cs.theme, analysis: analyses[cs.song], from: cs.from, to: cs.to, ...(cs.lrc !== undefined ? { lrc: cs.lrc } : {}) });
      analyses[cs.song] ??= inf.analysis;
      for (const [id, at] of cs.popups ?? []) await page.evaluate(([i, a]) => window.__wall.popup(i, a, true), [id, at]);
      for (const [i, t] of cs.t.entries()) {
        await page.evaluate((tt) => window.__wall.still(tt), t);
        await page.evaluate(([r, i, t, label]) => {
          const q = window.__qa, y = r * (q.TH + q.LH);
          if (i === 0) { q.c.fillStyle = '#e8e0d0'; q.c.font = '600 16px sans-serif'; q.c.fillText(label, 8, y + 18); }
          q.c.drawImage(document.getElementById('c'), i * q.TW, y + q.LH, q.TW, q.TH);
          q.c.fillStyle = 'rgba(0,0,0,.6)'; q.c.fillRect(i * q.TW, y + q.LH, 58, 18);
          q.c.fillStyle = '#fff'; q.c.font = '12px monospace'; q.c.fillText(`${t.toFixed(1)}s`, i * q.TW + 4, y + q.LH + 13);
        }, [ri, i, t, cs.label]);
      }
      report.cases.push({ label: cs.label, times: cs.t });
      // 確定性：A 情境的第三個時間點，隔著別的時間再畫一次，兩張要一模一樣
      if (cs.label.startsWith('A')) {
        const t0 = cs.t[2];
        await page.evaluate((tt) => window.__wall.still(tt), t0);
        const a = await page.screenshot({ clip: { x: 0, y: 0, width: 1920, height: 1080 } });
        await page.evaluate((tt) => window.__wall.still(tt), cs.t[4]);
        await page.evaluate((tt) => window.__wall.still(tt), t0);
        const b = await page.screenshot({ clip: { x: 0, y: 0, width: 1920, height: 1080 } });
        report.deterministic = a.equals(b);
        report.perf = +(await page.evaluate(([f, n]) => window.__wall.perf(f, n), [cs.t[2], 240])).toFixed(2);
      }
    }
    report.errors = await page.evaluate(() => window.__wall.errors);
    const b64 = await page.evaluate(async () => {
      const bl = new Uint8Array(await (await window.__qa.cv.convertToBlob({ type: 'image/jpeg', quality: 0.88 })).arrayBuffer());
      let s = ''; for (let i = 0; i < bl.length; i += 0x8000) s += String.fromCharCode(...bl.subarray(i, i + 0x8000));
      return btoa(s);
    });
    const outDir = path.join(ROOT, '..', 'wall-out', 'qa');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, `${outName}.jpg`), Buffer.from(b64, "base64"));
    writeFileSync(path.join(outDir, `${outName}.json`), JSON.stringify(report, null, 1));
    console.log(`QA ${outName}：效能 ${report.perf} ms／格、確定性 ${report.deterministic ? '通過' : '不通過（同一時間點畫兩次不一樣）'}、錯誤 ${report.errors.length} 個`);
    console.log(path.join(outDir, `${outName}.jpg`));
  } else if (mode === 'profile') {
    // CPU 剖析：畫 n 格，列出最花時間的函式（找效能瓶頸用）
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await page.evaluate(([f]) => window.__wall.perf(f, 10), [Number(opt('from', '5'))]);
    await cdp.send('Profiler.start');
    const ms = await page.evaluate(([f, n]) => window.__wall.perf(f, n), [Number(opt('from', '5')), Number(opt('n', '120'))]);
    const { profile } = await cdp.send('Profiler.stop');
    const self = new Map();
    const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${(n.callFrame.url || '').split('/').pop()}:${n.callFrame.lineNumber + 1}`; self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0)); });
    const total = [...self.values()].reduce((a, b) => a + b, 0);
    console.log(`平均每格 ${ms.toFixed(2)} ms；CPU 取樣前 25 名（self time）：`);
    for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${(100 * v / total).toFixed(1).padStart(5)}%  ${k}`);
  } else if (mode === 'perf') {
    const ms = await page.evaluate(([f, n]) => window.__wall.perf(f, n), [Number(opt('from', '5')), Number(opt('n', '180'))]);
    console.log(`平均每格 ${ms.toFixed(2)} ms（約 ${(1000 / ms).toFixed(0)} fps，含 GPU 同步）`);
  }
  if (sceneErrors.length) console.error('SCENE ERRORS:\n' + sceneErrors.join('\n'));
  if (logs.length) console.error('BROWSER:\n' + [...new Set(logs)].slice(0, 30).join('\n'));
} finally {
  await browser.close();
  await server.close();
}
