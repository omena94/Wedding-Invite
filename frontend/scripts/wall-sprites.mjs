#!/usr/bin/env node
// 紙偶動畫的素材管線：把 Codex 畫的角色姿勢圖（透明背景 PNG）裁掉透明邊、縮到大螢幕用得到的大小、轉成 webp，
// 輸出到 public/wall-sprites/<名字>.webp，並更新 src/wall/spriteManifest.ts（每張的尺寸、腳底錨點、參考身高、道具點）。
// 版面用 scenes/_puppet.ts 載入與播放（說明見 docs/wall/ENGINE.md「紙偶角色」）。
//
//   node scripts/wall-sprites.mjs <資料夾或 PNG>... [--clean] [--dry]
//     例：node scripts/wall-sprites.mjs ../某處/poses-a ../某處/poses-b
//   --clean：刪掉 public/wall-sprites 裡這份清單以外的舊檔（清單會跟既有的 manifest 合併，所以分批跑也可以）
//   --dry  ：只印出會做什麼，不寫檔
//
// 比例：Codex 的規格（見 PROMPT.md）是人 1024×1536、狗 1024×1024、兩人一起 1536×1536，但實際交的圖人畫得比規格大、
// 雙人交了 1254×1254。所以不照規格換算，改成**每個角色用自己的基準姿勢校正**（SERIES）：
//   - 基準姿勢（宣文 xw_idle_front、狗 pp_stand…）的身高縮到 target px，同一個角色的每一張都用同一個縮放比例
//     （畫布大小不一樣時照「佔畫布的比例」換算），換姿勢時大小才不會跳。基準姿勢要跟這一組一起跑，
//     或已經在 manifest 裡（校正值存在 manifest 的 SPRITE_SERIES，之後只補幾張也對得上）。
//   - 腳底（錨點 y）：站在地上的姿勢用「最低的不透明像素」（每張畫的腳底差一點點，不校正的話換圖時腳會上下抖；
//     跑步也放在地上，彈跳由程式加）；名字有 jump／smash／leap／air 的是騰空姿勢，用基準姿勢的腳底線（圖本來就畫在半空中）。
//   - 錨點 x：身體的水平中心（不透明像素的中位數；伸出去的手、球拍很細，不太影響），換圖時身體才不會左右跳。
//     自動找得不好的在 ANCHOR 手動給（原圖的 px）。
//   - 道具點（POINTS）：球拍面、手上或嘴邊的球、鍋心、盤子…，原圖的 px 手動量好寫在這裡，轉成紙偶上的座標存進 manifest，
//     版面用 puppetPoint() 拿到畫面座標（球的軌跡端點、要蓋掉的圖上的球）。
// **背景一定要是透明的**：四個角不透明的圖直接跳過並列出來，請 Codex 重畫（不要用程式去白底：白衣服、白狗會被吃掉）。
// 影像處理用本機的 Chrome（playwright-core，跟 wall-render.mjs 一樣），專案不用另外裝影像套件。
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'wall-sprites');
const MANIFEST = path.join(ROOT, 'src', 'wall', 'spriteManifest.ts');
const CONTACT = path.join(ROOT, '..', 'wall-out', 'sprites-contact.png');

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const inputs = argv.filter((a) => !a.startsWith('--'));
if (!inputs.length) {
  console.log('用法：node scripts/wall-sprites.mjs <資料夾或 PNG>... [--clean] [--dry]');
  process.exit(1);
}

/**
 * 一組一組的角色（照順序比對檔名，第一個對上的算數）：ref = 基準姿勢（站直的那張，量身高與腳底線）、
 * target = 基準姿勢縮好之後的身高（px）。人 600：版面的場景尺度多半 380～440，推鏡頭也不會放大糊掉；
 * 狗在畫面上約人的 1/4～1/3，給 260～280 就夠（特寫再重跑放大）。
 */
const SERIES = [
  { key: 'cp_waltz', re: /^cp_waltz_/, kind: 'couple', ref: 'cp_waltz_1', target: 600 },
  { key: 'cp', re: /^cp_/, kind: 'couple', ref: 'cp_hug', target: 600 },
  { key: 'xw', re: /^xw_/, kind: 'person', ref: 'xw_idle_front', target: 600 },
  { key: 'mt', re: /^mt_/, kind: 'person', ref: 'mt_idle_front', target: 600 },
  { key: 'pp', re: /^pp_/, kind: 'dog', ref: 'pp_stand', target: 260 },
  { key: 'qq', re: /^qq_/, kind: 'dog', ref: 'qq_stand', target: 280 },
];
const seriesOf = (name) => SERIES.find((s) => s.re.test(name));

/** 道具點（原圖 px：[x, y, 半徑]）。側面的圖都朝右；版面 flip 時 _puppet 會自己翻。 */
const POINTS = {
  xw_bad_ready: { racket: [900, 375, 95] },
  xw_bad_swing: { racket: [941, 830, 80] },
  xw_bad_smash: { racket: [564, 95, 90] },
  mt_bad_ready: { racket: [905, 220, 95] },
  mt_bad_swing: { racket: [921, 950, 80] },
  mt_bad_smash: { racket: [622, 75, 90] },
  xw_throw_1: { ball: [149, 214, 34] },
  xw_throw_2: { ball: [988, 284, 30] },
  xw_plate: { plate: [770, 470, 110] },
  mt_wok_1: { wok: [860, 770, 150] },
  mt_wok_2: { wok: [871, 385, 150] },
  pp_ball: { ball: [957, 408, 62], mouth: [957, 408] },
  pp_jump: { ball: [942, 201, 60], mouth: [915, 250] },
  pp_run_1: { mouth: [940, 448] },
  pp_run_2: { mouth: [951, 490] },
  pp_stand: { mouth: [947, 400] },
  qq_ball: { ball: [932, 360, 50], mouth: [932, 360] },
  qq_jump: { ball: [931, 145, 58], mouth: [905, 200] },
  qq_run_1: { mouth: [925, 500] },
  qq_run_2: { mouth: [931, 462] },
  qq_stand: { mouth: [905, 330] },
  qq_beg: { mouth: [753, 225] },
};
/** 自動找的身體中心不好時，手動給錨點 x（原圖 px）。 */
const ANCHOR = {};

// ---- 收集檔案（底線開頭的是 Codex 的總覽圖，跳過）
const files = [];
for (const inp of inputs) {
  const p = path.resolve(inp);
  if (!existsSync(p)) { console.warn(`找不到：${inp}`); continue; }
  const list = statSync(p).isDirectory() ? readdirSync(p).map((f) => path.join(p, f)) : [p];
  for (const f of list) if (/\.png$/i.test(f) && !path.basename(f).startsWith('_')) files.push(f);
}
files.sort();
if (!files.length) { console.log('沒有要處理的 PNG'); process.exit(0); }

// ---- 既有的 manifest（分批跑時合併）：每張圖的資料、每組的校正值
const block = (src, tag) => { const m = src.match(new RegExp(`/\\* ${tag} \\*/([\\s\\S]*?)/\\* END \\*/`)); return m ? JSON.parse(m[1]) : {}; };
const oldSrc = existsSync(MANIFEST) ? readFileSync(MANIFEST, 'utf8') : '';
const manifest = block(oldSrc, 'DATA');
const cal = block(oldSrc, 'SERIES');

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

const results = [], rejected = [];
try {
  // ---- 第一輪：量每一張（校正要先知道基準姿勢）
  const info = new Map();
  for (const f of files) {
    const name = path.basename(f, path.extname(f)).toLowerCase().replace(/[^a-z0-9_]+/g, '_');
    const S = seriesOf(name);
    if (!S) { console.warn(`${name}：不認得的檔名前綴（xw／mt／cp／pp／qq），跳過`); continue; }
    const b64 = readFileSync(f).toString('base64');
    const a = await analyze(b64);
    if (a.box[2] < 0) { rejected.push(`${name}：整張都是透明的`); continue; }
    // 背景要是真的透明：四個角不透明（白底、米白底）就不收，請 Codex 重畫
    if (a.corners.some((v) => v > 24)) { rejected.push(`${name}：背景不是透明的（四個角 alpha ${a.corners.join('/')}）`); continue; }
    info.set(name, { f, b64, S, a });
  }
  // ---- 每一組的校正：基準姿勢的身高（佔畫布的比例）與腳底線
  for (const S of SERIES) {
    const r = info.get(S.ref);
    if (r) cal[S.key] = { refFrac: (r.a.low - r.a.box[1] + 1) / r.a.H, groundFrac: r.a.low / r.a.H, target: S.target };
  }
  // ---- 第二輪：縮放、裁切、算錨點與道具點
  for (const [name, { b64, S, a }] of info) {
    const C = cal[S.key];
    if (!C) { rejected.push(`${name}：這一組的基準姿勢 ${S.ref} 沒有一起跑（也不在 manifest 裡），比例對不上`); continue; }
    const k = S.target / (C.refFrac * a.H);
    const pad = Math.ceil(3 / k);
    const box = [Math.max(0, a.box[0] - pad), Math.max(0, a.box[1] - pad), Math.min(a.W - 1, a.box[2] + pad), Math.min(a.H - 1, a.box[3] + pad)];
    const airborne = /jump|smash|leap|air/.test(name);
    const ground = airborne ? C.groundFrac * a.H : a.low + 0.5;
    const axSrc = ANCHOR[name] ?? a.mx + 0.5;
    const r = await render(b64, k, box);
    const toSprite = (x, y) => [Math.round((x - box[0]) * k * 10) / 10, Math.round((y - box[1]) * k * 10) / 10];
    const pts = {};
    for (const [key, [x, y, rad]] of Object.entries(POINTS[name] ?? {})) {
      const [sx, sy] = toSprite(x, y);
      pts[key] = rad ? [sx, sy, Math.round(rad * k * 10) / 10] : [sx, sy];
    }
    const [ax, ay] = toSprite(axSrc, ground);
    const edge = [a.box[0] <= 2 && '左', a.box[2] >= a.W - 3 && '右', a.box[1] <= 2 && '上', a.box[3] >= a.H - 3 && '下'].filter(Boolean);
    results.push({ name, kind: S.kind, series: S.key, w: r.w, h: r.h, ax, ay, ref: S.target, pts, webp: r.webp, src: [a.W, a.H], airborne, edge });
    const kb = Math.round((r.webp.length * 0.75) / 1024);
    const note = [airborne ? '騰空：用基準姿勢的腳底線' : '', edge.length ? `⚠ 碰到畫布${edge.join('、')}緣（四肢或道具可能被切掉）` : '', Object.keys(pts).length ? `道具點 ${Object.keys(pts).join('、')}` : ''].filter(Boolean).join('；');
    console.log(`${name.padEnd(16)} ${S.kind.padEnd(6)} ${String(a.W).padStart(4)}×${String(a.H).padEnd(4)} → ${r.w}×${r.h}  錨點 (${ax}, ${ay})  ${kb} KB  ${note}`);
  }
  if (rejected.length) console.log(`\n不收的圖（請 Codex 重畫）：\n  ${rejected.join('\n  ')}\n`);

  if (!flags.has('--dry')) {
    mkdirSync(OUT_DIR, { recursive: true });
    for (const r of results) {
      writeFileSync(path.join(OUT_DIR, `${r.name}.webp`), Buffer.from(r.webp, 'base64'));
      manifest[r.name] = { kind: r.kind, w: r.w, h: r.h, ax: r.ax, ay: r.ay, ref: r.ref, ...(Object.keys(r.pts).length ? { pts: r.pts } : {}) };
    }
    if (flags.has('--clean')) {
      for (const f of readdirSync(OUT_DIR)) {
        const n = f.replace(/\.webp$/, '');
        if (f.endsWith('.webp') && !manifest[n]) { unlinkSync(path.join(OUT_DIR, f)); console.log(`刪掉舊檔 ${f}`); }
      }
      for (const n of Object.keys(manifest)) if (!existsSync(path.join(OUT_DIR, `${n}.webp`))) delete manifest[n];
    }
    const sorted = Object.fromEntries(Object.keys(manifest).sort().map((k) => [k, manifest[k]]));
    // 一張一行（JSON，方便下次合併時讀回來）
    const body = `{\n${Object.keys(sorted).map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(sorted[k])}`).join(',\n')}\n}`;
    const calBody = `{\n${Object.keys(cal).sort().map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(cal[k])}`).join(',\n')}\n}`;
    writeFileSync(MANIFEST, `// 自動產生（node scripts/wall-sprites.mjs），不要手改。紙偶動畫的角色姿勢圖：public/wall-sprites/<名字>.webp。
// kind：person（單人）、couple（兩人一起）、dog；w × h：圖的大小（px）；ax, ay：腳底錨點（圖上的 px，ay 可以超出圖外——騰空的姿勢）；
// ref：參考身高（圖上的 px；人是站直的身高、狗是站著到耳尖）；pts：道具點 [x, y, 半徑?]（圖上的 px，側面朝右）。
// 版面用 scenes/_puppet.ts 播放。
export type SpriteKind = 'person' | 'couple' | 'dog';
export interface SpriteInfo { kind: SpriteKind; w: number; h: number; ax: number; ay: number; ref: number; pts?: Record<string, number[]> }
export const SPRITES: Record<string, SpriteInfo> = /* DATA */${body}/* END */;
/** 素材管線用的校正值（每組基準姿勢的身高與腳底線佔畫布的比例），版面用不到。 */
export const SPRITE_SERIES = /* SERIES */${calBody}/* END */;
`);
    const bytes = readdirSync(OUT_DIR).filter((f) => f.endsWith('.webp')).reduce((s, f) => s + statSync(path.join(OUT_DIR, f)).size, 0);
    console.log(`寫好 ${results.length} 張 → ${path.relative(path.join(ROOT, '..'), OUT_DIR)}，manifest 共 ${Object.keys(sorted).length} 張，全部 ${(bytes / 1048576).toFixed(2)} MB`);

    // 總覽圖：上面每張放在棋盤格上（同一種角色同一個比例），畫出錨點（紅十字）、參考身高（藍線）、道具點（綠圈）；
    // 下面是「疊圖」：同一個動作的幾張（xw_walk_1／2、xw_bad_*…）疊在同一個錨點上，檢查換圖時身體與腳會不會跳。
    const names = Object.keys(sorted);
    const groups = {};
    for (const n of names) { const g = n.replace(/_[^_]+$/, ''); (groups[g] ??= []).push(n); }
    const onions = Object.entries(groups).filter(([, v]) => v.length > 1);
    const b64 = await page.evaluate(async ([names, man, datas, onions]) => {
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
        list.forEach((n, j) => {
          const m = man[n], s = scaleOf(m);
          c.globalAlpha = 0.5;
          c.drawImage(bmps[n], gx - m.ax * s, gy - m.ay * s, m.w * s, m.h * s);
        });
        c.restore();
        c.strokeStyle = '#e33'; c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(gx - 60, gy); c.lineTo(gx + 60, gy); c.moveTo(gx, gy - 240); c.lineTo(gx, gy + 6); c.stroke();
        c.fillStyle = '#222'; c.font = '13px monospace'; c.textAlign = 'center'; c.fillText(`${g}_* 疊圖`, gx, gy + 24);
      });
      const b = new Uint8Array(await (await cv.convertToBlob({ type: 'image/png' })).arrayBuffer());
      let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
      return btoa(s);
    }, [names, sorted, Object.fromEntries(names.map((n) => [n, readFileSync(path.join(OUT_DIR, `${n}.webp`)).toString('base64')])), onions]);
    mkdirSync(path.dirname(CONTACT), { recursive: true });
    writeFileSync(CONTACT, Buffer.from(b64, 'base64'));
    console.log(`總覽圖 ${path.relative(path.join(ROOT, '..'), CONTACT)}（紅十字 = 腳底錨點、藍線 = 參考身高、綠圈 = 道具點；下面是同一個動作的疊圖）`);
  }
} finally {
  await browser.close();
}
