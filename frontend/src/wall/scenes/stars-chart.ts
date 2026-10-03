// 星圖版面（stars.ts）的星座：留言拆成「一個字一顆星」、在一塊區域裡用種子排出一個像真的星座的形狀。
// 全部在 init() 算一次（窗格的留言已經定了），之後每一格只換算位置。
// （星旁不標字：字跟留言重複又把星座弄得很亂；留言的字會跟著自己的星一起亮，看得出對應。）
import { clamp, mulberry32 } from '../engine/util';
import type { P2 } from './stars-sky';

/** 留言裡的一個「字」＝一顆星：中文一個字、英文一個單字、韓文一個詞、一顆愛心。[a, b) 是在 Array.from(text) 裡的位置。 */
export interface Unit { text: string; a: number; b: number; heart: boolean }

const LATIN = /[\p{Script=Latin}\p{N}]/u;
const LATIN_IN = /[\p{Script=Latin}\p{N}'’\-.]/u;
const HANGUL = /\p{Script=Hangul}/u;
const LETTER = /[\p{L}\p{N}♥]/u;

/** 拆字。標點與空白不算星（留言裡它們跟著前一顆星一起亮）；整則都是標點就整則當一顆星。 */
export function units(text: string): Unit[] {
  const cs = Array.from(text), n = cs.length, out: Unit[] = [];
  let i = 0;
  while (i < n) {
    const ch = cs[i]!;
    let j = i + 1;
    if (LATIN.test(ch)) {
      while (j < n && LATIN_IN.test(cs[j]!)) j++;
      // 單字尾巴的句點、撇號不算（「you.」的星叫 you）
      while (j > i + 1 && /[.'’\-]/.test(cs[j - 1]!)) j--;
    } else if (HANGUL.test(ch)) while (j < n && HANGUL.test(cs[j]!)) j++;
    else if (!LETTER.test(ch)) { i++; continue; }
    out.push({ text: cs.slice(i, j).join(''), a: i, b: j, heart: ch === '♥' });
    i = j;
  }
  if (!out.length) out.push({ text: text.trim() || '♥', a: 0, b: n, heart: false });
  return out;
}

/** 每個字元屬於第幾顆星（標點跟著前一顆，開頭的標點跟著第一顆）。 */
export function unitOfChar(text: string, us: Unit[]): number[] {
  const n = Array.from(text).length, out = new Array<number>(n).fill(0);
  let u = 0;
  for (let c = 0; c < n; c++) {
    while (u + 1 < us.length && us[u + 1]!.a <= c) u++;
    out[c] = u;
  }
  return out;
}

export interface Zone { x0: number; y0: number; x1: number; y1: number }
export interface StarPt extends P2 {
  /** 星等 1（最亮）～ 5。 */
  mag: number;
  /** 連線從哪顆星連過來（-1：第一顆）。 */
  from: number;
}

/** 線段 ab 與 cd 是否相交（端點相接不算）。 */
function crosses(a: P2, b: P2, c: P2, d: P2): boolean {
  const o = (p: P2, q: P2, r: P2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return d1 * d2 < -1e-6 && d3 * d4 < -1e-6;
}
function segDist(p: P2, a: P2, b: P2): number {
  const bx = b.x - a.x, by = b.y - a.y, l2 = bx * bx + by * by || 1;
  const u = clamp(((p.x - a.x) * bx + (p.y - a.y) * by) / l2);
  return Math.hypot(p.x - a.x - bx * u, p.y - a.y - by * u);
}

/**
 * 排一個 n 顆星的星座：從一顆星出發「走」下一顆（方向每次轉一點、步距不一），不能太靠近別的星、連線不能交叉，
 * 走不下去就從最近的一顆星分岔出去。最後整個縮放、置中到區域裡。照真的星座的感覺：有長有短、會轉彎、不是直線也不是格子。
 */
export function buildConstellation(n: number, z: Zone, seed: number): StarPt[] {
  const rnd = mulberry32(seed);
  const w = z.x1 - z.x0, h = z.y1 - z.y0, cx = (z.x0 + z.x1) / 2, cy = (z.y0 + z.y1) / 2;
  // 星少的時候每顆都亮一點（四顆暗星撐不起一個星座），星多的時候才有暗星
  const few = n <= 6;
  const mag = (i: number) => (i === 0 ? 1 : (() => { const r = rnd(); return few ? (r < 0.4 ? 2 : r < 0.85 ? 3 : 4) : r < 0.2 ? 2 : r < 0.55 ? 3 : r < 0.85 ? 4 : 5; })());
  if (n <= 1) return [{ x: cx, y: cy, mag: 1, from: -1 }];
  const step = clamp(Math.sqrt((w * h) / n) * 0.92, 58, 215);
  const pts: StarPt[] = [];
  // 起點：少的從左邊中段出發（形狀橫著展開），多的從一個角落出發（才有空間繞）
  const sx = n <= 6 ? z.x0 + w * (0.08 + 0.1 * rnd()) : z.x0 + w * (0.05 + 0.15 * rnd());
  const sy = n <= 6 ? z.y0 + h * (0.3 + 0.4 * rnd()) : z.y0 + h * (rnd() < 0.5 ? 0.1 + 0.15 * rnd() : 0.75 + 0.15 * rnd());
  pts.push({ x: sx, y: sy, mag: 1, from: -1 });
  let heading = Math.atan2(cy - sy, cx - sx) + (rnd() - 0.5) * 0.9;
  let turnSign = rnd() < 0.5 ? 1 : -1;
  const m = 14;
  for (let i = 1; i < n; i++) {
    const prev = pts[i - 1]!;
    let dmin = step * 0.62;
    let best: { p: P2; a: number; score: number } | null = null;
    for (let attempt = 0; attempt < 4 && !best; attempt++, dmin *= 0.84) {
      for (let c = 0; c < 48; c++) {
        // 偏好轉 20～70 度、左右交替一點，形狀才會「彎」
        const wide = c >= 24 ? 2.4 : 1.1;
        const turn = turnSign * (0.2 + 0.7 * rnd()) * (rnd() < 0.3 ? -1 : 1) * wide;
        const a = heading + turn;
        const L = step * (0.72 + 0.58 * rnd());
        const p = { x: prev.x + Math.cos(a) * L, y: prev.y + Math.sin(a) * L };
        if (p.x < z.x0 + m || p.x > z.x1 - m || p.y < z.y0 + m || p.y > z.y1 - m) continue;
        let near = Infinity, bad = false;
        for (const q of pts) { const dd = Math.hypot(q.x - p.x, q.y - p.y); near = Math.min(near, dd); if (dd < dmin) { bad = true; break; } }
        if (bad) continue;
        for (let k = 1; k < pts.length && !bad; k++) {
          const a0 = pts[pts[k]!.from] ?? null;
          if (!a0) continue;
          if (crosses(prev, p, a0, pts[k]!)) bad = true;
        }
        for (let k = 0; k < pts.length - 1 && !bad; k++) if (segDist(pts[k]!, prev, p) < dmin * 0.45) bad = true;
        if (bad) continue;
        // 分數：離別的星越遠越好（往空的地方長）、別太貼區域邊緣、不要太直
        const edge = Math.min(p.x - z.x0, z.x1 - p.x, p.y - z.y0, z.y1 - p.y);
        const score = Math.min(near, step * 2) + Math.min(edge, step) * 0.35 - Math.abs(Math.abs(turn) - 0.65) * step * 0.25 + rnd() * step * 0.35;
        if (!best || score > best.score) best = { p, a, score };
      }
    }
    if (best) {
      pts.push({ x: best.p.x, y: best.p.y, mag: mag(i), from: i - 1 });
      turnSign = Math.sign(best.a - heading) === turnSign ? -turnSign * (rnd() < 0.6 ? 1 : -1) : turnSign;
      heading = best.a;
      continue;
    }
    // 走不下去：在區域裡找離所有星最遠的點，從最近的那顆星分岔過去
    let bp: P2 = { x: cx, y: cy }, bd = -1;
    for (let c = 0; c < 240; c++) {
      const p = { x: z.x0 + m + (w - 2 * m) * rnd(), y: z.y0 + m + (h - 2 * m) * rnd() };
      const d = Math.min(...pts.map((q) => Math.hypot(q.x - p.x, q.y - p.y)));
      if (d > bd) { bd = d; bp = p; }
    }
    let from = 0, fd = Infinity;
    pts.forEach((q, k) => { const d = Math.hypot(q.x - bp.x, q.y - bp.y); if (d < fd) { fd = d; from = k; } });
    pts.push({ x: bp.x, y: bp.y, mag: mag(i), from });
    heading = Math.atan2(bp.y - pts[from]!.y, bp.x - pts[from]!.x);
  }
  // 縮放、置中：整個星座佔區域大約九成（星少的時候不要放太大，看起來才像星座不像連連看）
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const fill = n <= 5 ? 0.78 : 0.9;
  const s = Math.min((w * fill) / Math.max(1, x1 - x0), (h * fill) / Math.max(1, y1 - y0), n <= 4 ? 1.1 : 1.5);
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  for (const p of pts) { p.x = cx + (p.x - mx) * s; p.y = cy + (p.y - my) * s; }
  return pts;
}
