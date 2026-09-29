#!/usr/bin/env node
// 紙偶動畫的素材管線：把 Codex 畫的角色姿勢圖（透明背景 PNG）裁掉透明邊、縮到大螢幕用得到的大小、轉成 webp。
// 版面用 scenes/_puppet.ts 載入與播放；完整的做法（請 Codex 畫圖、檢查、寫版面）見 docs/wall/PUPPETS.md。
//
//   node scripts/wall-sprites.mjs <組名>... [--dry] [--check]
//     例：node scripts/wall-sprites.mjs base waltz
//   --dry  ：只印出會做什麼，不寫檔
//   --check：只做檢查圖、不轉檔：每張原圖疊在深色底（有 100 px 的格線與座標，量道具點用）和洋紅底（看白邊、破洞）上，
//            存成 wall-out/sprites-<組名>-check-<n>.jpg。請 Codex 畫完、轉檔之前先看這個。
//
// **一組一個資料夾、一組一個輸出**，好幾個人可以同時跑不同的組，不會互相蓋掉：
//   原圖＋設定  wall-out/codex-chars/poses/<組名>/*.png、sprites.json（wall-out 不進 git，但留在這台電腦上）
//   輸出的圖    frontend/public/wall-sprites/<組名>/<圖名>.webp（這一組的資料夾裡，這次沒產生的舊檔會刪掉）
//   清單        frontend/src/wall/sprites/<組名>.json（整份重寫；src/wall/spriteManifest.ts 把每一組的清單合起來）
//   總覽圖      wall-out/sprites-<組名>.png
// 同一組同時只能有一個人在跑（資料夾裡放一個 .lock）；圖名跨組不能重複（寫檔前會檢查其他組的清單）。
//
// sprites.json（每一組自帶，腳本本身不用改）：
//   series：這一組有哪幾種角色，照檔名前綴分（最長的前綴優先）：
//     { "prefix": "xw_work_", "kind": "person"|"couple"|"dog", "ref": "xw_work_idle_front", "target": 600, "height"?: 1 }
//     - ref = 基準姿勢（站直的那張）：量身高與腳底線。同一種角色的每一張都用同一個縮放比例（畫布大小不一樣時照
//       「佔畫布的比例」換算），換姿勢時大小才不會跳。換一套衣服就是新的一組、要有自己的基準姿勢，
//       target 給一樣的值（人 600、芃芃 260、QQ 280），換衣服之後在畫面上一樣大。
//     - 基準姿勢一定要在這一組裡；真的沒有時可以寫 "refFrom": "base:xw_" 借別組的校正值（畫布比例要跟那一組一樣才準）。
//     - height：這種角色的身高是宣文的幾倍（不寫就照檔名前兩個字：xw 1、mt 0.95、cp 1、pp 0.26、qq 0.29）。
//   points：道具點，原圖的 px：{ "圖名": { "racket": [x, y, 半徑], "mouth": [x, y] } }，版面用 puppetPoint() 拿到畫面座標。
//   anchor：自動找的身體中心不好時，手動給錨點 x（原圖 px）：{ "圖名": 512 }。
//   airborne／grounded：名字有 jump／smash／leap／air／dunk／fly 的算騰空姿勢（腳底用基準姿勢的腳底線，圖本來就畫在半空中），
//     其他的用最低的不透明像素當腳底；對不上時在這兩個清單裡列圖名強制指定。
// **背景一定要是透明的**：四個角不透明的圖直接跳過並列出來，請 Codex 重畫（不要用程式去白底：白衣服、白狗會被吃掉）；
// 被擋下來的圖如果以前轉過，會先沿用舊的，版面不會壞掉。
// 影像處理用本機的 Chrome（playwright-core，跟 wall-render.mjs 一樣），專案不用另外裝影像套件。
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, renameSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POSES = path.join(ROOT, '..', 'wall-out', 'codex-chars', 'poses');
const OUT_ROOT = path.join(ROOT, 'public', 'wall-sprites');
const LIST_DIR = path.join(ROOT, 'src', 'wall', 'sprites');
const AIR = /jump|smash|leap|air|dunk|fly/;

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const groups = argv.filter((a) => !a.startsWith('--'));
if (!groups.length) {
  console.log('用法：node scripts/wall-sprites.mjs <組名>... [--dry] [--check]（組名 = wall-out/codex-chars/poses/ 底下的資料夾）');
  process.exit(1);
}

/** 先寫暫存檔再改名：別人（vite、同時在跑的截圖）讀到的永遠是完整的檔。 */
const writeAtomic = (file, data) => { const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, data); renameSync(tmp, file); };
// 記事本存的 UTF-8 會帶 BOM，先去掉
const readJSON = (file) => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

/** 同一組同時只能有一個人在跑：資料夾裡建 .lock（建不起來 = 別人在跑；超過 15 分鐘的當成當掉留下的）。 */
function lock(dir, group) {
  const f = path.join(dir, '.lock');
  for (let k = 0; k < 2; k++) {
    try { const fd = openSync(f, 'wx'); writeFileSync(fd, `${process.pid} ${new Date().toISOString()}`); closeSync(fd); return () => { try { unlinkSync(f); } catch { /* 已經不在了 */ } }; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (Date.now() - statSync(f).mtimeMs > 15 * 60 * 1000) { unlinkSync(f); continue; }
      throw new Error(`「${group}」這一組正在被別人處理（${readFileSync(f, 'utf8')}）。等他跑完再跑；確定沒有人在跑的話刪掉 ${f}`);
    }
  }
  throw new Error(`「${group}」拿不到鎖`);
}

/** 讀這一組的設定並檢查格式。 */
function loadConfig(dir, group) {
  const f = path.join(dir, 'sprites.json');
  if (!existsSync(f)) throw new Error(`「${group}」沒有 sprites.json（格式見 docs/wall/PUPPETS.md）`);
  const cfg = readJSON(f);
  if (!Array.isArray(cfg.series) || !cfg.series.length) throw new Error(`${f}：series 要是非空的陣列`);
  for (const s of cfg.series) {
    if (typeof s.prefix !== 'string' || !s.prefix) throw new Error(`${f}：series 每一項都要有 prefix`);
    if (!['person', 'couple', 'dog'].includes(s.kind)) throw new Error(`${f}：${s.prefix} 的 kind 要是 person、couple 或 dog`);
    if (!(s.target > 0)) throw new Error(`${f}：${s.prefix} 的 target 要是正數（人 600、芃芃 260、QQ 280）`);
    if (!s.ref && !s.refFrom) throw new Error(`${f}：${s.prefix} 要有 ref（基準姿勢的圖名）`);
  }
  return { series: cfg.series, points: cfg.points ?? {}, anchor: cfg.anchor ?? {}, airborne: new Set(cfg.airborne ?? []), grounded: new Set(cfg.grounded ?? []) };
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto('about:blank');

/** 在頁面裡解碼一張 PNG，量：大小、四個角的透明度、外框、最低的腳底、身體中心（不透明像素 x 的中位數）。 */
const analyze = (b64) => page.evaluate(async (b64) => {
  const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob(), { premultiplyAlpha: 'none' });
  const W = bmp.width, H = bmp.height;
  const cv = new OffscreenCanvas(W, H), c = cv.getContext('2d', { willReadFrequently: true });
  c.drawImage(bmp, 0, 0);
  const d = c.getImageData(0, 0, W, H).data;
  const A = (x, y) => d[(y * W + x) * 4 + 3];
  const corners = [A(0, 0), A(W - 1, 0), A(0, H - 1), A(W - 1, H - 1)];
  let x0 = W, y0 = H, x1 = -1, y1 = -1, low = -1;
  const hist = new Uint32Array(W);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = A(x, y);
    if (a > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (a > 96 && y > low) low = y;
    if (a > 128) hist[x]++;
  }
  let tot = 0; for (let x = 0; x < W; x++) tot += hist[x];
  let acc = 0, mx = W / 2;
  for (let x = 0; x < W; x++) { acc += hist[x]; if (acc >= tot / 2) { mx = x; break; } }
  return { W, H, corners, box: [x0, y0, x1, y1], low, mx };
}, b64);

/** 縮放 k、裁到 [x0, y0, x1, y1]（原圖 px，含留白）、轉 webp。 */
const render = (b64, k, box) => page.evaluate(async ([b64, k, box]) => {
  const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob(), { premultiplyAlpha: 'none' });
  const [x0, y0, x1, y1] = box;
  const sw = x1 - x0 + 1, sh = y1 - y0 + 1;
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  // 縮很多時先對半縮一次，細線比較不會斷
  let src = bmp, sx = x0, sy = y0, ssw = sw, ssh = sh;
  if (k < 0.45) {
    const half = new OffscreenCanvas(Math.round(sw / 2), Math.round(sh / 2));
    const hc = half.getContext('2d'); hc.imageSmoothingEnabled = true; hc.imageSmoothingQuality = 'high';
    hc.drawImage(bmp, x0, y0, sw, sh, 0, 0, half.width, half.height);
    src = half; sx = 0; sy = 0; ssw = half.width; ssh = half.height;
  }
  const out = new OffscreenCanvas(w, h), c = out.getContext('2d');
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(src, sx, sy, ssw, ssh, 0, 0, w, h);
  const b = new Uint8Array(await (await out.convertToBlob({ type: 'image/webp', quality: 0.88 })).arrayBuffer());
  let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return { w, h, webp: btoa(s) };
}, [b64, k, box]);

/**
 * 檢查圖（--check）：每張原圖縮到 660 px 高，左邊疊在深色底上、畫 100 px 格線與座標（原圖的 px，量道具點用），
 * 右邊疊在洋紅底上（白邊、沒去乾淨的底、衣服上的破洞一眼就看得到）。一張檢查圖放兩列。回傳 JPEG（base64）的陣列。
 */
const checkSheets = (items) => page.evaluate(async (items) => {
  const TH = 660, GAP = 12, SW = 1900, LH = 26;
  const tiles = [];
  for (const { name, b64 } of items) {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const k = TH / bmp.height, w = Math.round(bmp.width * k);
    const cv = new OffscreenCanvas(w * 2 + GAP, TH + LH), c = cv.getContext('2d');
    c.fillStyle = '#16192a'; c.fillRect(0, 0, w, TH);
    c.fillStyle = '#e600c8'; c.fillRect(w + GAP, 0, w, TH);
    c.drawImage(bmp, 0, 0, w, TH);
    c.drawImage(bmp, w + GAP, 0, w, TH);
    // 格線畫在圖上面（半透明），座標是原圖的 px
    c.lineWidth = 1;
    for (let x = 0; x <= bmp.width; x += 100) { c.strokeStyle = x % 200 ? 'rgba(255,255,255,0.18)' : 'rgba(255,90,90,0.45)'; c.beginPath(); c.moveTo(x * k + 0.5, 0); c.lineTo(x * k + 0.5, TH); c.stroke(); }
    for (let y = 0; y <= bmp.height; y += 100) { c.strokeStyle = y % 200 ? 'rgba(255,255,255,0.18)' : 'rgba(255,90,90,0.45)'; c.beginPath(); c.moveTo(0, y * k + 0.5); c.lineTo(w, y * k + 0.5); c.stroke(); }
    // 座標標籤墊一塊深色底：疊在白衣服、白紗上也讀得到
    c.font = '11px monospace';
    for (let x = 0; x <= bmp.width; x += 200) for (let y = 0; y <= bmp.height; y += 200) {
      const lbl = `${x},${y}`, lw = c.measureText(lbl).width;
      c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(x * k + 1, y * k + 1, lw + 3, 13);
      c.fillStyle = 'rgba(255,230,120,0.95)'; c.fillText(lbl, x * k + 2, y * k + 11);
    }
    c.fillStyle = '#222'; c.fillRect(0, TH, cv.width, LH);
    c.fillStyle = '#fff'; c.font = '15px monospace'; c.fillText(`${name}  ${bmp.width}×${bmp.height}`, 6, TH + 18);
    tiles.push(cv);
  }
  // 排版：一列放得下幾張放幾張，兩列一張檢查圖
  const rows = [];
  let row = [], rw = 0;
  for (const t of tiles) { if (row.length && rw + t.width > SW) { rows.push(row); row = []; rw = 0; } row.push(t); rw += t.width + GAP * 2; }
  if (row.length) rows.push(row);
  const out = [];
  for (let i = 0; i < rows.length; i += 2) {
    const rs = rows.slice(i, i + 2);
    const cv = new OffscreenCanvas(SW, rs.length * (TH + LH + GAP)), c = cv.getContext('2d');
    c.fillStyle = '#3a3a3a'; c.fillRect(0, 0, cv.width, cv.height);
    rs.forEach((r, ri) => { let x = 0; for (const t of r) { c.drawImage(t, x, ri * (TH + LH + GAP)); x += t.width + GAP * 2; } });
    const b = new Uint8Array(await (await cv.convertToBlob({ type: 'image/jpeg', quality: 0.88 })).arrayBuffer());
    let s = ''; for (let j = 0; j < b.length; j += 0x8000) s += String.fromCharCode(...b.subarray(j, j + 0x8000));
    out.push(btoa(s));
  }
  return out;
}, items);

/** 總覽圖：上面每張放在棋盤格上（同一種角色同一個比例），畫出錨點（紅十字）、參考身高（藍線）、道具點（綠圈）；
 *  下面是「疊圖」：同一個動作的幾張（xw_walk_1／2、xw_bad_*…）疊在同一個錨點上，檢查換圖時身體與腳會不會跳。 */
const contactSheet = (sprites, datas) => {
  const names = Object.keys(sprites);
  const bins = {};
  for (const n of names) { const g = n.replace(/_[^_]+$/, ''); (bins[g] ??= []).push(n); }
  const onions = Object.entries(bins).filter(([, v]) => v.length > 1);
  return page.evaluate(async ([names, man, datas, onions]) => {
    const cols = 8, cw = 240, ch = 300, ow = 360;
    const rows = Math.ceil(names.length / cols), orows = Math.ceil(onions.length / 5);
    const cv = new OffscreenCanvas(Math.max(cols * cw, 5 * ow), rows * ch + orows * ch + 20);
    const c = cv.getContext('2d');
    for (let y = 0; y < cv.height; y += 12) for (let x = 0; x < cv.width; x += 12) { c.fillStyle = ((x + y) / 12) % 2 ? '#ddd' : '#f4f4f4'; c.fillRect(x, y, 12, 12); }
    const bmps = {};
    for (const n of names) bmps[n] = await createImageBitmap(await (await fetch(`data:image/webp;base64,${datas[n]}`)).blob());
    const scaleOf = (m) => (m.kind === 'dog' ? 120 : 220) / m.ref;
    for (let i = 0; i < names.length; i++) {
      const n = names[i], m = man[n], s = scaleOf(m);
      const gx = (i % cols) * cw + cw / 2, gy = Math.floor(i / cols) * ch + ch - 34;
      c.drawImage(bmps[n], gx - m.ax * s, gy - m.ay * s, m.w * s, m.h * s);
      c.strokeStyle = '#e33'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(gx - 10, gy); c.lineTo(gx + 10, gy); c.moveTo(gx, gy - 10); c.lineTo(gx, gy + 10); c.stroke();
      c.strokeStyle = '#36c'; c.beginPath(); c.moveTo(gx - cw / 2 + 8, gy - m.ref * s); c.lineTo(gx - cw / 2 + 30, gy - m.ref * s); c.stroke();
      c.strokeStyle = '#0a0';
      for (const [x, y, r] of Object.values(m.pts ?? {})) { c.beginPath(); c.arc(gx + (x - m.ax) * s, gy + (y - m.ay) * s, Math.max(3, (r ?? 4) * s), 0, Math.PI * 2); c.stroke(); }
      c.fillStyle = '#222'; c.font = '13px monospace'; c.textAlign = 'center'; c.fillText(n, gx, gy + 24);
    }
    const oy0 = rows * ch + 20;
    onions.forEach(([g, list], i) => {
      const gx = (i % 5) * ow + ow / 2, gy = oy0 + Math.floor(i / 5) * ch + ch - 34;
      c.save();
      for (const n of list) { const m = man[n], s = scaleOf(m); c.globalAlpha = 0.5; c.drawImage(bmps[n], gx - m.ax * s, gy - m.ay * s, m.w * s, m.h * s); }
      c.restore();
      c.strokeStyle = '#e33'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(gx - 60, gy); c.lineTo(gx + 60, gy); c.moveTo(gx, gy - 240); c.lineTo(gx, gy + 6); c.stroke();
      c.fillStyle = '#222'; c.font = '13px monospace'; c.textAlign = 'center'; c.fillText(`${g}_* 疊圖`, gx, gy + 24);
    });
    const b = new Uint8Array(await (await cv.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s);
  }, [names, sprites, datas, onions]);
};

/** 處理一組：讀設定 → 量 → 校正 → 縮圖 → 寫這一組自己的輸出。 */
async function runGroup(arg) {
  const dir = existsSync(arg) && statSync(arg).isDirectory() ? path.resolve(arg) : path.join(POSES, arg);
  const group = path.basename(dir);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(group)) throw new Error(`組名只能用小寫英文、數字、連字號：${group}`);
  if (!existsSync(dir)) throw new Error(`找不到這一組的資料夾：${dir}`);
  if (flags.has('--check')) {
    // 只做檢查圖：不需要 sprites.json、不上鎖、不轉檔
    const pngs = readdirSync(dir).filter((f) => /\.png$/i.test(f) && !f.startsWith('_')).sort();
    const outs = path.join(ROOT, '..', 'wall-out');
    for (const f of readdirSync(outs)) if (f.startsWith(`sprites-${group}-check-`)) unlinkSync(path.join(outs, f));
    const sheets = [];
    for (let i = 0; i < pngs.length; i += 4) sheets.push(...await checkSheets(pngs.slice(i, i + 4).map((f) => ({ name: f.replace(/\.png$/i, ''), b64: readFileSync(path.join(dir, f)).toString('base64') }))));
    sheets.forEach((b64, i) => writeAtomic(path.join(outs, `sprites-${group}-check-${i + 1}.jpg`), Buffer.from(b64, 'base64')));
    console.log(`檢查圖 ${sheets.length} 張 → wall-out/sprites-${group}-check-1～${sheets.length}.jpg（${pngs.length} 張原圖；左：深色底＋格線（原圖 px）、右：洋紅底）`);
    return;
  }
  const cfg = loadConfig(dir, group);
  const unlock = flags.has('--dry') ? () => {} : lock(dir, group);
  try {
    const listFile = path.join(LIST_DIR, `${group}.json`);
    const old = existsSync(listFile) ? readJSON(listFile) : { series: {}, sprites: {} };
    // 其他組已經用掉的圖名（跨組不能重複：合起來的清單裡後面的會蓋掉前面的）
    const taken = new Map();
    if (existsSync(LIST_DIR)) for (const f of readdirSync(LIST_DIR)) {
      if (!f.endsWith('.json') || f === `${group}.json`) continue;
      for (const n of Object.keys(readJSON(path.join(LIST_DIR, f)).sprites ?? {})) taken.set(n, f.replace(/\.json$/, ''));
    }
    const seriesOf = (name) => cfg.series.filter((s) => name.startsWith(s.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
    const files = readdirSync(dir).filter((f) => /\.png$/i.test(f) && !f.startsWith('_')).sort();
    if (!files.length) throw new Error(`「${group}」的資料夾裡沒有 PNG`);
    console.log(`\n== ${group}（${files.length} 張，${path.relative(path.join(ROOT, '..'), dir)}）`);
    const rejected = [], present = new Set(), info = new Map();
    // ---- 第一輪：量每一張（校正要先知道基準姿勢）
    for (const f of files) {
      const name = path.basename(f, path.extname(f)).toLowerCase().replace(/[^a-z0-9_]+/g, '_');
      present.add(name);
      const S = seriesOf(name);
      if (!S) { rejected.push(`${name}：檔名的前綴不在 sprites.json 的 series 裡`); continue; }
      if (taken.has(name)) { rejected.push(`${name}：「${taken.get(name)}」那一組已經有同名的圖，換一個名字（例如加上組名：${name.replace(/^([a-z]+_)/, `$1${group.replace(/-/g, '_')}_`)}）`); present.delete(name); continue; }
      const b64 = readFileSync(path.join(dir, f)).toString('base64');
      const a = await analyze(b64);
      if (a.box[2] < 0) { rejected.push(`${name}：整張都是透明的`); continue; }
      // 背景要是真的透明：四個角不透明（白底、米白底）就不收，請 Codex 重畫
      if (a.corners.some((v) => v > 24)) { rejected.push(`${name}：背景不是透明的（四個角 alpha ${a.corners.join('/')}），請 Codex 重畫`); continue; }
      info.set(name, { b64, S, a });
    }
    // ---- 每一種角色的校正：基準姿勢的身高（佔畫布的比例）與腳底線；沒有基準姿勢就用 refFrom 或上一次的值
    const cal = {};
    for (const S of cfg.series) {
      const r = S.ref && info.get(S.ref);
      if (r) cal[S.prefix] = { ref: S.ref, refFrac: (r.a.low - r.a.box[1] + 1) / r.a.H, groundFrac: r.a.low / r.a.H, target: S.target };
      else if (S.refFrom) {
        const [g, p] = S.refFrom.split(':');
        const c = existsSync(path.join(LIST_DIR, `${g}.json`)) ? readJSON(path.join(LIST_DIR, `${g}.json`)).series?.[p] : null;
        if (c) cal[S.prefix] = { ...c, target: S.target, from: S.refFrom };
      } else if (old.series?.[S.prefix]) cal[S.prefix] = { ...old.series[S.prefix], target: S.target };
    }
    // ---- 第二輪：縮放、裁切、算錨點與道具點
    const results = [];
    for (const [name, { b64, S, a }] of info) {
      const C = cal[S.prefix];
      if (!C) { rejected.push(`${name}：這一種角色（${S.prefix}）的基準姿勢 ${S.ref ?? S.refFrom} 不在這一組裡，比例對不上`); continue; }
      const k = S.target / (C.refFrac * a.H);
      const pad = Math.ceil(3 / k);
      const box = [Math.max(0, a.box[0] - pad), Math.max(0, a.box[1] - pad), Math.min(a.W - 1, a.box[2] + pad), Math.min(a.H - 1, a.box[3] + pad)];
      const airborne = cfg.airborne.has(name) || (AIR.test(name) && !cfg.grounded.has(name));
      const ground = airborne ? C.groundFrac * a.H : a.low + 0.5;
      const axSrc = cfg.anchor[name] ?? a.mx + 0.5;
      const r = await render(b64, k, box);
      const toSprite = (x, y) => [Math.round((x - box[0]) * k * 10) / 10, Math.round((y - box[1]) * k * 10) / 10];
      const pts = {};
      for (const [key, [x, y, rad]] of Object.entries(cfg.points[name] ?? {})) {
        const [sx, sy] = toSprite(x, y);
        pts[key] = rad ? [sx, sy, Math.round(rad * k * 10) / 10] : [sx, sy];
      }
      const [ax, ay] = toSprite(axSrc, ground);
      const edge = [a.box[0] <= 2 && '左', a.box[2] >= a.W - 3 && '右', a.box[1] <= 2 && '上', a.box[3] >= a.H - 3 && '下'].filter(Boolean);
      const entry = { kind: S.kind, w: r.w, h: r.h, ax, ay, ref: S.target, ...(S.height ? { height: S.height } : {}), ...(Object.keys(pts).length ? { pts } : {}) };
      results.push({ name, entry, webp: r.webp });
      const kb = Math.round((r.webp.length * 0.75) / 1024);
      const note = [airborne ? '騰空：用基準姿勢的腳底線' : '', edge.length ? `⚠ 碰到畫布${edge.join('、')}緣（四肢或道具可能被切掉）` : '', Object.keys(pts).length ? `道具點 ${Object.keys(pts).join('、')}` : ''].filter(Boolean).join('；');
      console.log(`${name.padEnd(18)} ${S.kind.padEnd(6)} ${String(a.W).padStart(4)}×${String(a.H).padEnd(4)} → ${r.w}×${r.h}  錨點 (${ax}, ${ay})  ${kb} KB  ${note}`);
    }
    for (const p of Object.keys(cfg.points)) if (!present.has(p)) console.warn(`⚠ sprites.json 的 points 有 ${p}，但資料夾裡沒有這張圖`);
    if (rejected.length) console.log(`\n不收的圖（請 Codex 重畫或改名）：\n  ${rejected.join('\n  ')}`);
    if (flags.has('--dry')) return;

    // ---- 寫這一組自己的輸出：圖、清單、總覽圖（不碰別組的檔）
    const outDir = path.join(OUT_ROOT, group);
    mkdirSync(outDir, { recursive: true });
    mkdirSync(LIST_DIR, { recursive: true });
    const sprites = {};
    for (const r of results) { writeAtomic(path.join(outDir, `${r.name}.webp`), Buffer.from(r.webp, 'base64')); sprites[r.name] = r.entry; }
    // 這次被擋下來、但以前轉過的圖：先沿用舊的（版面不會因為一張重畫失敗就壞掉）
    for (const n of present) if (!sprites[n] && old.sprites?.[n] && existsSync(path.join(outDir, `${n}.webp`))) { sprites[n] = old.sprites[n]; console.log(`${n}：沿用上一次轉好的圖`); }
    // 資料夾裡已經沒有的圖：刪掉輸出
    for (const f of readdirSync(outDir)) {
      const n = f.replace(/\.webp$/, '');
      if (f.endsWith('.webp') && !sprites[n]) { unlinkSync(path.join(outDir, f)); console.log(`刪掉舊檔 ${group}/${f}`); }
    }
    const sorted = Object.fromEntries(Object.keys(sprites).sort().map((k) => [k, sprites[k]]));
    const lines = (o) => `{\n${Object.keys(o).map((k) => `    ${JSON.stringify(k)}: ${JSON.stringify(o[k])}`).join(',\n')}\n  }`;
    writeAtomic(listFile, `{\n  "group": ${JSON.stringify(group)},\n  "series": ${lines(cal)},\n  "sprites": ${lines(sorted)}\n}\n`);
    const bytes = readdirSync(outDir).reduce((s, f) => s + statSync(path.join(outDir, f)).size, 0);
    console.log(`寫好 ${results.length} 張 → public/wall-sprites/${group}/（這一組共 ${Object.keys(sorted).length} 張、${(bytes / 1048576).toFixed(2)} MB），清單 src/wall/sprites/${group}.json`);
    const datas = Object.fromEntries(Object.keys(sorted).map((n) => [n, readFileSync(path.join(outDir, `${n}.webp`)).toString('base64')]));
    const sheet = path.join(ROOT, '..', 'wall-out', `sprites-${group}.png`);
    writeAtomic(sheet, Buffer.from(await contactSheet(sorted, datas), 'base64'));
    console.log(`總覽圖 wall-out/sprites-${group}.png（紅十字 = 腳底錨點、藍線 = 參考身高、綠圈 = 道具點；下面是同一個動作的疊圖）`);
  } finally {
    unlock();
  }
}

let failed = false;
try {
  for (const g of groups) {
    try { await runGroup(g); }
    catch (e) { failed = true; console.error(`\n✘ ${e.message}`); }
  }
} finally {
  await browser.close();
}
if (!flags.has('--dry') && !flags.has('--check') && existsSync(OUT_ROOT)) {
  let total = 0;
  const walk = (d) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.webp')) total += statSync(p).size; } };
  walk(OUT_ROOT);
  console.log(`\n全部的紙偶圖共 ${(total / 1048576).toFixed(2)} MB（版面只在 init 載自己用到的圖，不會一次全部下載）`);
}
process.exit(failed ? 1 : 0);
