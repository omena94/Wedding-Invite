#!/usr/bin/env node
// 大螢幕的截圖／效能工具（照 pdoom-video 的 scripts/render.ts）：用無頭 Chrome 開 /wall?dev=1&export=1，
// 指定版面、時間點、測試歌，存成 PNG，讓人（或 Claude）直接看畫面檢查。不連後端、不碰正式資料。
//
//   node scripts/wall-render.mjs stills --scene sparkler --t 2,4.5,7 [--song "歌手 - 歌名.mp3"] [--message 3]
//        [--params '{"kind":"invite"}'] [--theme rose] [--popup 5@3.2] [--no-lyrics] [--win-from 0 --win-to 12] [--out ../wall-out/sparkler]
//   node scripts/wall-render.mjs sheet  --scene slam --from 20 --to 32 --n 12 --cols 4 --out ../wall-out/slam.png
//   node scripts/wall-render.mjs perf   --scene stars --from 20 [--n 180]
//   node scripts/wall-render.mjs timeline [--song x.mp3]      （印出導演排出來的時間軸）
//   node scripts/wall-render.mjs ko --scene a,b,c              （韓文歌原文副行驗收，每個版面一張 wall-out/ko/<版面>.jpg）
//   node scripts/wall-render.mjs bi --scene a,b,c              （雙語普查：有翻譯＋有主打留言時三樣是不是都清楚，wall-out/bi/<版面>.jpg＋.json；加 --full 另存全尺寸 <版面>-1.jpg、-2.jpg）
//   stills／sheet 加 --ko：用韓文佔位歌詞＋中文翻譯（中文大字、韓文原文小字在下面）。
//   stills／sheet／ko 加 --keep-sub：有主打留言的窗格也畫原文（params.keepSub，只給檢查用：看還沒標 bilingual 的版面三樣擠不擠）。
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
// --keep-sub：有主打留言也畫原文（engine.ts 的 params.keepSub，只有檢查工具會帶）
const keepSub = argv.includes('--keep-sub');
mkdirSync(CACHE, { recursive: true });

// 好幾個人（或助手）可能同時在截圖：port 隨機起跳，被占用就往後找
// Windows 會保留一段一段的 port（Hyper-V），碰到就 EACCES，不是「被占用」：換一個隨機 port 再試
let server;
for (let k = 0; ; k++) {
  server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 5400 + Math.floor(Math.random() * 3000), strictPort: false, hmr: false } });
  try { await server.listen(); break; } catch (e) { await server.close(); if (k >= 8 || !/EACCES|EADDRINUSE/.test(String(e?.code ?? e))) throw e; }
}
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
  // thumbs 模式：一次載全部要拍的版面（名單從 plateCatalog 來，或 --names a,b）
  const thumbNames = mode === 'thumbs'
    ? (opt('names') ? opt('names').split(',') : [...readFileSync(path.join(ROOT, 'src', 'wall', 'plateCatalog.ts'), 'utf8').matchAll(/"name": "([a-z0-9]+)"/g)].map((m) => m[1]))
    : [];
  const onlyList = mode === 'thumbs' ? thumbNames.join(',') : opt('scene');
  const only = onlyList && !argv.includes('--all-scenes') ? `&only=${encodeURIComponent(onlyList)}` : '';
  await page.goto(`${url}/wall.html?dev=1&export=1${scale ? `&scale=${scale}` : ''}${only}`);
  await page.waitForFunction(() => window.__wall?.ready || window.__wall?.error, null, { timeout: 180000 });
  const err = await page.evaluate(() => window.__wall.error);
  if (err) throw new Error(`大螢幕開不起來：\n${err}\n${logs.join('\n')}`);
  const songs = await page.evaluate(() => window.__wall.songs());
  const song = opt('song', songs[0]);
  const cacheFile = song ? path.join(CACHE, `${song.replace(/[^\w.-]+/g, '_')}.json`) : '';
  const analysis = cacheFile && existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : null;
  const setup = {
    song, scene: mode === 'ko' || mode === 'bi' ? opt('scene')?.split(',')[0] : opt('scene'), message: opt('message') ? Number(opt('message')) : undefined,
    params: opt('params') || keepSub ? { ...(opt('params') ? JSON.parse(opt('params')) : {}), ...(keepSub ? { keepSub: true } : {}) } : undefined, theme: opt('theme'), analysis,
    from: opt('win-from') ? Number(opt('win-from')) : undefined, to: opt('win-to') ? Number(opt('win-to')) : undefined,
    // --no-lyrics：當成純音樂（沒有歌詞）測試
    ...(argv.includes('--no-lyrics') ? { lrc: '' } : {}),
    // --ko：韓文佔位歌詞＋中文翻譯（測原文副行）
    ...(argv.includes('--ko') ? { ko: true } : {}),
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
    // 標準驗收：同一個版面跑十一種情境（長短留言、英文、只有愛心、沒留言、純音樂、慢歌、2 小節、新人留言、四行多愛心），
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
      // 正式站踩過：四行、愛心穿插的留言，署名被字蓋住（2026-09-28）
      { label: 'K 四行＋很多愛心・香檳', song: FAST, message: 19, theme: 'champagne', from: 60, to: 74, t: [63, 67, 73.5] },
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
        // 直接比畫布的像素（不比頁面截圖：Chrome 截圖／合成的時機本身有 ±1 色階的雜訊，會誤判）
        const grab = () => page.evaluate(() => document.getElementById('c').toDataURL('image/png'));
        const a = await grab();
        await page.evaluate((tt) => window.__wall.still(tt), cs.t[4]);
        await page.evaluate((tt) => window.__wall.still(tt), t0);
        const b = await grab();
        report.deterministic = a === b;
        // 不一樣時記下差在哪裡（範圍、像素數、最大差），查原因用
        if (!report.deterministic) {
          report.detDiff = await page.evaluate(async ([da, db]) => {
            const load = async (u) => { const im = new Image(); im.src = u; await im.decode(); const cv = new OffscreenCanvas(im.width, im.height); const c = cv.getContext('2d'); c.drawImage(im, 0, 0); return c.getImageData(0, 0, im.width, im.height); };
            const A = await load(da), B = await load(db);
            let n = 0, max = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
            for (let i = 0; i < A.data.length; i += 4) {
              const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
              if (d) { n++; max = Math.max(max, d); const p = i / 4, x = p % A.width, y = Math.floor(p / A.width); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
            }
            return { pixels: n, maxDiff: max, box: [x0, y0, x1, y1] };
          }, [a, b]);
          console.log('確定性差異：', JSON.stringify(report.detDiff));
          // GPU 的捨入雜訊：零星幾十個像素、只差 1～2 階（255 階裡），肉眼看不出來，連最簡單的 karaoke 都偶爾會有。
          // 這種當成通過（記在 json 的 detNoise）；超過就是版面真的不確定（字型換了、狀態沒重設…），差異會大很多
          if (report.detDiff.pixels <= 60 && report.detDiff.maxDiff <= 2) { report.deterministic = true; report.detNoise = true; }
        }
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
    console.log(`QA ${outName}：效能 ${report.perf} ms／格、確定性 ${report.deterministic ? (report.detNoise ? '通過（只有 GPU 捨入雜訊）' : '通過') : '不通過（同一時間點畫兩次不一樣）'}、錯誤 ${report.errors.length} 個`);
    console.log(path.join(outDir, `${outName}.jpg`));
  } else if (mode === 'thumbs') {
    // 後台「大螢幕版面」頁的縮圖：每個版面用長留言、燭光金主題，在窗格後段拍一張 480×270，存到 public/wall-thumbs/<名字>.jpg
    const FAST = 'Test Band - Fast Pop.mp3';
    const outDir = path.join(ROOT, 'public', 'wall-thumbs');
    mkdirSync(outDir, { recursive: true });
    const cf = path.join(CACHE, `${FAST.replace(/[^\w.-]+/g, '_')}.json`);
    let an = existsSync(cf) ? JSON.parse(readFileSync(cf, 'utf8')) : null;
    let ok = 0;
    for (const name of thumbNames) {
      try {
        const inf = await page.evaluate((o) => window.__wall.setup(o), { song: FAST, scene: name, message: 3, theme: 'gold', analysis: an, from: 20, to: 36.4, params: name === 'title' ? { kind: 'song' } : undefined });
        an ??= inf.analysis;
        await page.evaluate((tt) => window.__wall.still(tt), name === 'title' ? 22 : 31);
        const b64 = await page.evaluate(async () => {
          const cv = new OffscreenCanvas(480, 270);
          cv.getContext('2d').drawImage(document.getElementById('c'), 0, 0, 480, 270);
          const bl = new Uint8Array(await (await cv.convertToBlob({ type: 'image/jpeg', quality: 0.82 })).arrayBuffer());
          let s = ''; for (let i = 0; i < bl.length; i += 0x8000) s += String.fromCharCode(...bl.subarray(i, i + 0x8000));
          return btoa(s);
        });
        writeFileSync(path.join(outDir, `${name}.jpg`), Buffer.from(b64, 'base64'));
        ok++;
      } catch (e) { console.log(`✘ ${name}：${String(e).slice(0, 200)}`); }
    }
    console.log(`縮圖 ${ok}/${thumbNames.length} 張 → ${outDir}`);
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
  } else if (mode === 'ko') {
    // 韓文歌驗收（2026-09-30）：中文主行＋韓文原文副行。每個版面 6 格（一格 960×540，副行的字才看得清楚）拼成
    // wall-out/ko/<版面>.jpg：快歌沒留言 3 格、慢歌沒留言 2 格、有主打留言 1 格（有留言時副行要收起來、只剩中文）。
    // 時間點挑「有副行的句子唱到一半」。--scene 可以給好幾個（逗號分隔），同一個瀏覽器一次跑完。
    // --plain：同樣的時間點改用一般（沒有翻譯）的佔位歌詞，拿來跟改版前逐像素比，確認一般的歌畫面沒變。
    const plain = argv.includes('--plain');
    const FAST = 'Test Band - Fast Pop.mp3', SLOW = 'Test Band - Slow Ballad.mp3';
    if (!songs.includes(FAST) || !songs.includes(SLOW)) throw new Error(`ko 需要標準測試音檔（${FAST}、${SLOW}）`);
    const outDir = path.resolve(opt('out', path.join(ROOT, '..', 'wall-out', 'ko')));
    mkdirSync(outDir, { recursive: true });
    const analyses = {};
    for (const scene of (opt('scene') ?? '').split(',').filter(Boolean)) {
      const cases = [
        { label: '快歌・沒留言', song: FAST, params: { message: null }, theme: 'gold', from: 20, to: 36.4, pick: 3 },
        { label: '慢歌・沒留言', song: SLOW, params: { message: null }, theme: 'rose', from: 20, to: 40, pick: 2 },
        keepSub
          ? { label: '有留言＋原文（--keep-sub）', song: FAST, message: 3, params: { keepSub: true }, theme: 'champagne', from: 20, to: 36.4, pick: 1 }
          : { label: '有留言（副行收起來）', song: FAST, message: 3, theme: 'champagne', from: 20, to: 36.4, pick: 1 },
      ];
      const TW = 960, TH = 540, LH = 30;
      await page.evaluate(([TW, TH, LH]) => {
        const cv = new OffscreenCanvas(TW * 2, 3 * (TH + LH));
        const c = cv.getContext('2d');
        c.fillStyle = '#111'; c.fillRect(0, 0, cv.width, cv.height);
        window.__ko = { cv, c };
      }, [TW, TH, LH]);
      let cell = 0;
      const shots = [];
      for (const cs of cases) {
        const cf = path.join(CACHE, `${cs.song.replace(/[^\w.-]+/g, '_')}.json`);
        analyses[cs.song] ??= existsSync(cf) ? JSON.parse(readFileSync(cf, 'utf8')) : null;
        const inf = await page.evaluate((o) => window.__wall.setup(o), { song: cs.song, scene, message: cs.message, params: cs.params, theme: cs.theme, analysis: analyses[cs.song], from: cs.from, to: cs.to, ko: !plain });
        analyses[cs.song] ??= inf.analysis;
        // 窗格裡有副行的句子，平均挑 pick 句，取唱到 55% 的時間點
        const cand = inf.spans.filter(([a, b, s]) => (s || plain) && a > cs.from + 1 && b < cs.to - 0.3);
        const picks = cs.pick === 1 ? [cand[Math.floor(cand.length / 2)]] : Array.from({ length: cs.pick }, (_, i) => cand[Math.round((i * (cand.length - 1)) / Math.max(1, cs.pick - 1))]);
        for (const sp of picks.filter(Boolean)) {
          const t = sp[0] + (sp[1] - sp[0]) * 0.55;
          await page.evaluate((tt) => window.__wall.still(tt), t);
          await page.evaluate(([i, label, TW, TH, LH]) => {
            const k = window.__ko, x = (i % 2) * TW, y = Math.floor(i / 2) * (TH + LH);
            k.c.fillStyle = '#e8e0d0'; k.c.font = '600 18px sans-serif'; k.c.fillText(label, x + 8, y + 21);
            k.c.drawImage(document.getElementById('c'), x, y + LH, TW, TH);
          }, [cell++, `${cs.label}  ${t.toFixed(2)}s`, TW, TH, LH]);
          shots.push(t);
        }
      }
      const b64 = await page.evaluate(async () => {
        const bl = new Uint8Array(await (await window.__ko.cv.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer());
        let s = ''; for (let i = 0; i < bl.length; i += 0x8000) s += String.fromCharCode(...bl.subarray(i, i + 0x8000));
        return btoa(s);
      });
      const f = path.join(outDir, `${scene}.jpg`);
      writeFileSync(f, Buffer.from(b64, 'base64'));
      const errs = await page.evaluate(() => window.__wall.errors);
      console.log(`${f}  （${shots.length} 格${errs.length ? `，錯誤 ${errs.length} 個` : ''}）`);
    }
  } else if (mode === 'bi') {
    // 雙語普查（2026-09-30）：有翻譯的歌只排雙語版面（spec.bilingual），現有的版面要一個一個看「主打留言＋中文＋原文」三樣同時出現時
    // 是不是都清楚、不擠、不壓 HUD。每個版面兩格：長留言（3，燭光金）、四行多愛心（K，19，香檳），時間點挑「有原文的句子唱到一半、
    // 留言已經寫完」。用 params.keepSub 讓有留言的窗格也畫原文，再把同一格「不畫原文」（現在正式播放的樣子）畫一次比對，
    // 差異的範圍 = 原文（加上因為原文而移動的東西）：框在圖上（青色虛線），寫進 json（box、面積、有沒有進右下角 HUD）。
    // 輸出 wall-out/bi/<版面>.jpg（兩格 960×540）與 <版面>.json。
    const FAST = 'Test Band - Fast Pop.mp3';
    if (!songs.includes(FAST)) throw new Error(`bi 需要標準測試音檔（${FAST}）`);
    const outDir = path.resolve(opt('out', path.join(ROOT, '..', 'wall-out', 'bi')));
    mkdirSync(outDir, { recursive: true });
    const cf = path.join(CACHE, `${FAST.replace(/[^\w.-]+/g, '_')}.json`);
    let an = existsSync(cf) ? JSON.parse(readFileSync(cf, 'utf8')) : null;
    const cases = [
      { label: '長留言＋原文', message: 3, theme: 'gold', from: 20, to: 36.4, at: 0.62 },
      { label: 'K 四行多愛心＋原文', message: 19, theme: 'champagne', from: 60, to: 74, at: 0.62 },
    ];
    const HUD = { x: 1360, y: 830 };
    for (const scene of (opt('scene') ?? '').split(',').filter(Boolean)) {
      const errs0 = (await page.evaluate(() => window.__wall.errors)).length;
      const rep = { scene, cases: [] };
      await page.evaluate(() => { const cv = new OffscreenCanvas(1920, 570); window.__bi = { cv, c: cv.getContext('2d') }; });
      for (const [ci, cs] of cases.entries()) {
        const base = { song: FAST, scene, message: cs.message, theme: cs.theme, analysis: an, from: cs.from, to: cs.to, ko: true };
        const inf = await page.evaluate((o) => window.__wall.setup(o), { ...base, params: { keepSub: true } });
        an ??= inf.analysis;
        // 有原文的句子、留言已經寫完（窗格開始 3 秒後），挑最接近窗格 at 的那一句，取唱到 55%
        const cand = inf.spans.filter(([a, b, s]) => s && a > cs.from + 3 && b < cs.to - 0.4);
        const want = cs.from + (cs.to - cs.from) * cs.at;
        const sp = cand.sort((p, q) => Math.abs((p[0] + p[1]) / 2 - want) - Math.abs((q[0] + q[1]) / 2 - want))[0];
        if (!sp) { rep.cases.push({ label: cs.label, error: '窗格裡沒有有原文的句子' }); continue; }
        const t = sp[0] + (sp[1] - sp[0]) * 0.55;
        // 先畫「不畫原文」的那一格，記下像素；再畫有原文的，比出差異
        await page.evaluate((o) => window.__wall.setup(o), { ...base, params: {} });
        await page.evaluate((tt) => window.__wall.still(tt), t);
        await page.evaluate(() => { const cv = new OffscreenCanvas(1920, 1080), c = cv.getContext('2d', { willReadFrequently: true }); c.drawImage(document.getElementById('c'), 0, 0, 1920, 1080); window.__bi.ref = c.getImageData(0, 0, 1920, 1080).data; });
        await page.evaluate((o) => window.__wall.setup(o), { ...base, params: { keepSub: true } });
        await page.evaluate((tt) => window.__wall.still(tt), t);
        const d = await page.evaluate(([ci, label, t, HUD]) => {
          // 全解析度比對：差異的每一列有幾個像素 → 分成一段一段的「帶」（中間空 4 列以上就斷開）。
          // 原文畫在中文下面，最下面那一帶通常就是原文那一排：它的高度 ≈ 原文字的高度（韓文字身約 0.9 個字級）。
          const W = 1920, Hh = 1080;
          const cv = new OffscreenCanvas(W, Hh), c = cv.getContext('2d', { willReadFrequently: true });
          c.drawImage(document.getElementById('c'), 0, 0, W, Hh);
          const px = c.getImageData(0, 0, W, Hh).data, ref = window.__bi.ref;
          let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, hud = 0;
          const rows = new Uint32Array(Hh), rx0 = new Int32Array(Hh).fill(1e9), rx1 = new Int32Array(Hh).fill(-1);
          for (let i = 0; i < px.length; i += 4) {
            const dd = Math.max(Math.abs(px[i] - ref[i]), Math.abs(px[i + 1] - ref[i + 1]), Math.abs(px[i + 2] - ref[i + 2]));
            if (dd < 28) continue;
            const p = i / 4, x = p % W, y = (p / W) | 0;
            n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
            rows[y]++; if (x < rx0[y]) rx0[y] = x; if (x > rx1[y]) rx1[y] = x;
            if (x >= HUD.x && y >= HUD.y) hud++;
          }
          const bands = [];
          let cur = null, gap = 0;
          for (let y = 0; y < Hh; y++) {
            if (rows[y] >= 3) {
              if (cur && gap <= 4) { cur.y1 = y; cur.x0 = Math.min(cur.x0, rx0[y]); cur.x1 = Math.max(cur.x1, rx1[y]); cur.px += rows[y]; }
              else { cur = { y0: y, y1: y, x0: rx0[y], x1: rx1[y], px: rows[y] }; bands.push(cur); }
              gap = 0;
            } else gap++;
          }
          // 太小的帶（零星的雜點）不算
          const real = bands.filter((b) => b.px >= 60);
          const k = window.__bi, x = ci * 960;
          k.c.fillStyle = '#111'; k.c.fillRect(x, 0, 960, 570);
          k.c.drawImage(cv, x, 30, 960, 540);
          k.c.fillStyle = '#e8e0d0'; k.c.font = '600 18px sans-serif';
          const last = real[real.length - 1];
          k.c.fillText(`${label}  ${t.toFixed(2)}s`, x + 8, 21);
          if (n) { k.c.strokeStyle = 'rgba(0,230,255,0.9)'; k.c.lineWidth = 1.5; k.c.setLineDash([6, 4]); k.c.strokeRect(x + x0 / 2 - 2, 30 + y0 / 2 - 2, (x1 - x0) / 2 + 4, (y1 - y0) / 2 + 4); k.c.setLineDash([]); }
          return n ? { n, box: [x0, y0, x1, y1], hud, bands: real.map((b) => [b.y0, b.y1, b.x0, b.x1, b.px]) } : { n: 0 };
        }, [ci, cs.label, t, HUD]);
        // --full：總表上看不清楚的，另存一張全尺寸（有原文的那一格）<版面>-<格>.jpg 仔細看
        if (argv.includes('--full')) {
          const fb = await page.evaluate(async () => {
            const cv = new OffscreenCanvas(1920, 1080); cv.getContext('2d').drawImage(document.getElementById('c'), 0, 0, 1920, 1080);
            const bl = new Uint8Array(await (await cv.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer());
            let s = ''; for (let i = 0; i < bl.length; i += 0x8000) s += String.fromCharCode(...bl.subarray(i, i + 0x8000));
            return btoa(s);
          });
          writeFileSync(path.join(outDir, `${scene}-${ci + 1}.jpg`), Buffer.from(fb, 'base64'));
        }
        // 量原文的字：同一格再畫一次（韓文字換成別的字），兩張一比只剩韓文字形的差異；
        // 差異稍微膨脹（2 px）連成一個一個字／詞，取最高的那個 ≈ 韓文字身（約 0.78 個字級：karaoke 的 32 px 原文量起來 24～26 px）→ 原文在畫面上的字級（subFont）
        await page.evaluate(() => { const cv = new OffscreenCanvas(1920, 1080), c = cv.getContext('2d', { willReadFrequently: true }); c.drawImage(document.getElementById('c'), 0, 0, 1920, 1080); window.__bi.withSub = c.getImageData(0, 0, 1920, 1080).data; });
        await page.evaluate((o) => window.__wall.setup(o), { ...base, koAlt: true, params: { keepSub: true } });
        await page.evaluate((tt) => window.__wall.still(tt), t);
        const g = await page.evaluate(() => {
          const W = 1920, Hh = 1080;
          const cv = new OffscreenCanvas(W, Hh), c = cv.getContext('2d', { willReadFrequently: true });
          c.drawImage(document.getElementById('c'), 0, 0, W, Hh);
          const px = c.getImageData(0, 0, W, Hh).data, ref = window.__bi.withSub;
          // m = 差異量（0～255）；淡的字（還沒唱的三成透明）差異小，所以找字用低門檻（6），
          // 量高度時每個字只算差異 ≥ 那個字最大差異 35% 的像素（暗版面的發光光暈差異小，不會把字量大）
          const m = new Uint8Array(W * Hh);
          let any = 0;
          for (let i = 0, p = 0; i < px.length; i += 4, p++) {
            const dd = Math.max(Math.abs(px[i] - ref[i]), Math.abs(px[i + 1] - ref[i + 1]), Math.abs(px[i + 2] - ref[i + 2]));
            if (dd >= 6) { m[p] = dd; any++; }
          }
          if (!any) return { glyphs: 0 };
          // 膨脹 2 px（分開的筆畫連成一個字，相鄰的字連成一個詞）
          const R = 2, d = new Uint8Array(W * Hh);
          for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
            if (!m[y * W + x]) continue;
            for (let yy = Math.max(0, y - R); yy <= Math.min(Hh - 1, y + R); yy++) for (let xx = Math.max(0, x - R); xx <= Math.min(W - 1, x + R); xx++) d[yy * W + xx] = 1;
          }
          const seen = new Uint8Array(W * Hh), hs = [], boxes = [];
          const st = [];
          for (let p0 = 0; p0 < W * Hh; p0++) {
            if (!d[p0] || seen[p0]) continue;
            let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, area = 0, mx = 0;
            const pix = [];
            st.push(p0); seen[p0] = 1;
            while (st.length) {
              const p = st.pop(), x = p % W, y = (p / W) | 0;
              area++;
              if (m[p]) { pix.push(p); if (m[p] > mx) mx = m[p]; }
              for (const q of [p - 1, p + 1, p - W, p + W]) {
                if (q < 0 || q >= W * Hh || seen[q] || !d[q]) continue;
                if ((q === p - 1 && x === 0) || (q === p + 1 && x === W - 1)) continue;
                seen[q] = 1; st.push(q);
              }
            }
            if (area < 60) continue;
            for (const p of pix) {
              if (m[p] < mx * 0.35) continue;
              const x = p % W, y = (p / W) | 0;
              if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
            if (x1 < 0) continue;
            hs.push(y1 - y0 + 1);
            boxes.push([x0, y0, x1, y1]);
          }
          if (!hs.length) return { glyphs: 0 };
          // 韓文字身的高度隨組成變（「우」「히」高、「만」矮）：取最高的那個（寬 ≥ 6 px，排掉細細一條的游標、筆畫碎片）
          const tall = boxes.filter((b) => b[2] - b[0] >= 5).map((b) => b[3] - b[1] + 1).sort((a, b) => a - b);
          return { glyphs: hs.length, glyphHmax: tall[tall.length - 1] ?? 0, glyphBoxes: boxes.slice(0, 40) };
        });
        rep.cases.push({ label: cs.label, t: +t.toFixed(2), ...d, ...g, subFont: g.glyphHmax ? Math.round(g.glyphHmax / 0.78) : 0 });
      }
      const b64 = await page.evaluate(async () => {
        const bl = new Uint8Array(await (await window.__bi.cv.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer());
        let s = ''; for (let i = 0; i < bl.length; i += 0x8000) s += String.fromCharCode(...bl.subarray(i, i + 0x8000));
        return btoa(s);
      });
      writeFileSync(path.join(outDir, `${scene}.jpg`), Buffer.from(b64, 'base64'));
      const errs = await page.evaluate(() => window.__wall.errors);
      rep.errors = errs.slice(errs0);
      writeFileSync(path.join(outDir, `${scene}.json`), JSON.stringify(rep));
      console.log(`${scene}: ${rep.cases.map((c) => (c.error ? c.error : c.n ? `原文約 ${c.subFont || '?'} px ${c.box.join(',')}${c.hud ? ` ⚠ 進 HUD ${c.hud}` : ''}` : '⚠ 沒畫出原文')).join(' ｜ ')}${rep.errors.length ? `  錯誤 ${rep.errors.length}` : ''}`);
    }
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
