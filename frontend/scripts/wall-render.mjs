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
  await page.goto(`${url}/wall.html?dev=1&export=1${scale ? `&scale=${scale}` : ''}`);
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
