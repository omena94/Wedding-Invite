// 藤蔓版面的輔助：把一個字光柵化、細化成一條條中心線（Zhang-Suen 細化＋沿著骨架走），
// 藤蔓就沿著這些「看不見的字的筆畫」長出來。中文沒有單線字型，這是讓藤蔓長成字的方法。
// 只在 init() 跑（每個字幾毫秒），結果是純資料，之後每格只照時間畫到哪裡。
import { font } from '../engine/type';

export type Pt = { x: number; y: number };

const cache = new Map<string, Pt[][]>();

/**
 * 一個字（或一個英文單字）的骨架路徑：座標相對「左緣、基線」，單位是 px（跟 fillText 同一個字級）。
 * 路徑已經平滑、每 step px 取一點，太短的毛邊丟掉。同樣的字、字族、字級會快取。
 */
export function skeleton(text: string, family: string, size: number, step = 4): Pt[][] {
  const key = `${family}|${size}|${step}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  // 放大兩倍光柵化（細化的結果比較乾淨），最後再縮回來
  const K = 2;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.font = font(family, size * K);
  const w = Math.ceil(ctx.measureText(text).width + size * K * 0.4), h = Math.ceil(size * K * 1.5);
  cv.width = w; cv.height = h;
  ctx.font = font(family, size * K);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';
  const ox = size * K * 0.2, base = Math.round(size * K * 1.12);
  ctx.fillText(text, ox, base);
  const data = ctx.getImageData(0, 0, w, h).data;
  const img = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) img[i] = data[i * 4 + 3]! > 110 ? 1 : 0;
  thin(img, w, h);
  const paths = trace(img, w, h).map((p) => smooth(p).map((q) => ({ x: (q.x - ox) / K, y: (q.y - base) / K })));
  const out = paths.map((p) => resample(p, step)).filter((p) => p.length >= 2 && len(p) > size * 0.06);
  cache.set(key, out);
  return out;
}

/** Zhang-Suen 細化（就地改，1 = 前景）。 */
function thin(img: Uint8Array, w: number, h: number) {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : img[y * w + x]!);
  let changed = true;
  const del: number[] = [];
  for (let iter = 0; changed && iter < 60; iter++) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0;
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        if (!img[y * w + x]) continue;
        const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y), p5 = at(x + 1, y + 1);
        const p6 = at(x, y + 1), p7 = at(x - 1, y + 1), p8 = at(x - 1, y), p9 = at(x - 1, y - 1);
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
        let A = 0;
        for (let k = 0; k < 8; k++) if (seq[k] === 0 && seq[k + 1] === 1) A++;
        if (A !== 1) continue;
        if (pass === 0 ? (p2 * p4 * p6 === 0 && p4 * p6 * p8 === 0) : (p2 * p4 * p8 === 0 && p2 * p6 * p8 === 0)) del.push(y * w + x);
      }
      for (const i of del) img[i] = 0;
      if (del.length) changed = true;
    }
  }
}

const NB = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;

/** 沿著骨架走成折線：從端點出發走到端點或分岔；剩下的環從任何一點開始。 */
function trace(img: Uint8Array, w: number, h: number): Pt[][] {
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && img[y * w + x] === 1;
  const deg = (x: number, y: number) => NB.reduce((s, [dx, dy]) => s + (on(x + dx, y + dy) ? 1 : 0), 0);
  const seen = new Uint8Array(w * h);
  const paths: Pt[][] = [];
  const walk = (sx: number, sy: number) => {
    const p: Pt[] = [{ x: sx, y: sy }];
    seen[sy * w + sx] = 1;
    let x = sx, y = sy;
    for (let guard = 0; guard < 20000; guard++) {
      let nx = -1, ny = -1;
      // 先走上下左右，再走斜的（比較不會抄近路跳過轉角）
      for (const k of [0, 2, 4, 6, 1, 3, 5, 7]) {
        const [dx, dy] = NB[k]!;
        const qx = x + dx, qy = y + dy;
        if (on(qx, qy) && !seen[qy * w + qx]) { nx = qx; ny = qy; break; }
      }
      if (nx < 0) break;
      seen[ny * w + nx] = 1;
      p.push({ x: nx, y: ny });
      x = nx; y = ny;
      if (deg(x, y) >= 3) break;
    }
    return p;
  };
  // 端點先（由上而下、由左而右，大致像筆順）
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on(x, y) && !seen[y * w + x] && deg(x, y) === 1) paths.push(walk(x, y));
  // 分岔點出發的其他分支
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!on(x, y) || !seen[y * w + x]) continue;
      for (const [dx, dy] of NB) {
        const qx = x + dx, qy = y + dy;
        if (on(qx, qy) && !seen[qy * w + qx]) { const p = walk(qx, qy); p.unshift({ x, y }); paths.push(p); }
      }
    }
  }
  // 環（口、日這種封閉的筆畫）
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on(x, y) && !seen[y * w + x]) paths.push(walk(x, y));
  return paths;
}

function smooth(p: Pt[]): Pt[] {
  if (p.length < 5) return p;
  return p.map((q, i) => {
    if (i < 2 || i > p.length - 3) return q;
    let sx = 0, sy = 0;
    for (let k = -2; k <= 2; k++) { sx += p[i + k]!.x; sy += p[i + k]!.y; }
    return { x: sx / 5, y: sy / 5 };
  });
}

function len(p: Pt[]) {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += Math.hypot(p[i]!.x - p[i - 1]!.x, p[i]!.y - p[i - 1]!.y);
  return s;
}

function resample(p: Pt[], step: number): Pt[] {
  const out: Pt[] = [p[0]!];
  let acc = 0;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1]!, b = p[i]!, d = Math.hypot(b.x - a.x, b.y - a.y);
    acc += d;
    if (acc >= step) { out.push(b); acc = 0; }
  }
  const last = p[p.length - 1]!;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}
