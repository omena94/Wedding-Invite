// 水晶吊燈的「線稿模型」（chandelier.ts 用）：整盞燈是一堆 3D 線段，不是 mesh——
// 像工程圖／版畫一樣只有細線，LineBatch 在 3D 裡畫（加法混合，線疊到的地方自然比較亮）。
// 這裡只放「不會動」的骨架（吊鍊、中軸、燈臂、燭杯、燈泡外形、水晶環、垂飾花綵）與「會動」的東西的定義
// （每串水晶掛在哪、多長；燈泡在哪），每一格怎麼擺、怎麼閃由 chandelier.ts 算。
// 座標：世界單位，y 向上，吊燈中軸在 x = z = 0，天花板在 y = CEIL。角度 a 從 +z（朝鏡頭）起算，往 +x 為正。
import { TAU, hash } from '../engine/util';

export const CEIL = 3.2;
/** 最下層的水晶環（前半圈掛歌詞的墜子）。 */
export const HOOP = { r: 2.25, y: 0.4 };
/** 歌詞墜子可以用的前半圈角度範圍（再外面就轉到側面，墜子在螢幕上會擠在一起）。 */
export const LYRIC_ARC = 1.3;

/** 靜態線段：每段 8 個數 ax ay az bx by bz 寬度(px) 亮度。 */
export class SegList {
  data: number[] = [];
  get count() { return this.data.length / 8; }
  seg(a: V3, b: V3, w: number, k: number) { this.data.push(a[0], a[1], a[2], b[0], b[1], b[2], w, k); }
  poly(pts: V3[], w: number, k: number, closed = false) {
    for (let i = 1; i < pts.length; i++) this.seg(pts[i - 1]!, pts[i]!, w, k);
    if (closed && pts.length > 2) this.seg(pts[pts.length - 1]!, pts[0]!, w, k);
  }
  /** 小圓點（長度幾乎為零的線段 = 圓頭的點）：珠子、鉚釘。 */
  dot(p: V3, w: number, k: number) { this.seg(p, [p[0] + 1e-4, p[1], p[2]], w, k); }
}

export type V3 = [number, number, number];

/** 角度 a、半徑 r、高度 y 的點。 */
export const polar = (a: number, r: number, y: number): V3 => [Math.sin(a) * r, y, Math.cos(a) * r];

export function ring(L: SegList, r: number, y: number, n: number, w: number, k: number) {
  const pts: V3[] = [];
  for (let i = 0; i < n; i++) pts.push(polar((i / n) * TAU, r, y));
  L.poly(pts, w, k, true);
}

/** 三次貝茲（在燈臂的徑向平面上：u = 半徑、v = 高度）。 */
function bez(p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number], s: number): [number, number] {
  const u = 1 - s;
  return [u * u * u * p0[0] + 3 * u * u * s * p1[0] + 3 * u * s * s * p2[0] + s * s * s * p3[0], u * u * u * p0[1] + 3 * u * u * s * p1[1] + 3 * u * s * s * p2[1] + s * s * s * p3[1]];
}

export interface StrandDef {
  id: number;
  /** 掛點。 */
  a: number; r: number; y: number;
  /** 珠串長度（不含墜子）、珠子數、墜子（雙錐）的半高與半徑。 */
  len: number; beads: number; ph: number; pr: number;
  /** 墜子的轉角（每串不一樣，反光才不會整齊劃一）。 */
  spin: number;
  /** 0 上層、1 中層、2 水晶環。 */
  tier: number;
}

export interface BulbDef { a: number; r: number; y: number; tier: number }

export interface Model { segs: Float32Array; n: number; strands: StrandDef[]; bulbs: BulbDef[]; prisms: number; crystals: number }

/** 中軸的輪廓（高度、半徑）：像車床車出來的花瓶形，從天花板吊盤下的吊鍊一路到最底下的水晶球。 */
const STEM: [number, number][] = [
  [2.5, 0.05], [2.42, 0.15], [2.34, 0.19], [2.26, 0.07], [2.08, 0.05], [1.96, 0.11], [1.86, 0.15], [1.78, 0.08],
  [1.55, 0.055], [1.4, 0.09], [1.26, 0.2], [1.16, 0.25], [1.06, 0.13], [0.9, 0.06], [0.74, 0.09], [0.64, 0.055], [0.55, 0.085], [0.45, 0.0],
];

export function buildModel(seed: number): Model {
  const L = new SegList();
  const strands: StrandDef[] = [];
  const bulbs: BulbDef[] = [];
  let sid = 0;
  const addStrand = (a: number, r: number, y: number, len: number, beads: number, ph: number, pr: number, tier: number) => {
    strands.push({ id: sid++, a, r, y, len, beads, ph, pr, spin: hash(sid, seed, 5) * TAU, tier });
  };

  // ---- 吊鍊：天花板到頂蓋，一環橫一環直
  const top = STEM[0]![0];
  const links = 9;
  for (let i = 0; i < links; i++) {
    const y0 = CEIL - ((CEIL - top) * i) / links, y1 = CEIL - ((CEIL - top) * (i + 1)) / links;
    const cy = (y0 + y1) / 2, h = (y0 - y1) * 0.62, w = 0.032;
    const pts: V3[] = [];
    for (let k = 0; k <= 12; k++) {
      const u = (k / 12) * TAU;
      const px = Math.sin(u) * w, py = cy + Math.cos(u) * h;
      pts.push(i % 2 ? [px, py, 0] : [0, py, px]);
    }
    L.poly(pts, 1.0, 0.55);
  }

  // ---- 中軸：輪廓上每一點一圈，加 8 條經線（像線稿的車床件）
  for (const [y, r] of STEM) if (r > 0.01) ring(L, r, y, r > 0.15 ? 36 : 24, 1.0, r > 0.15 ? 0.55 : 0.45);
  for (let m = 0; m < 8; m++) {
    const a = (m / 8) * TAU + 0.2;
    L.poly(STEM.map(([y, r]) => polar(a, r, y)), 0.9, 0.35);
  }
  L.dot([0, 0.47, 0], 7, 0.9); // 最底下的水晶球

  // ---- 燈臂與燭杯、燈泡
  const tiers = [
    { hubY: 1.84, hubR: 0.14, n: 6, r: 0.66, cupY: 1.98, sag: 0.2, a0: 0.26 },
    { hubY: 1.14, hubR: 0.24, n: 8, r: 1.2, cupY: 1.3, sag: 0.3, a0: 0.0 },
  ];
  tiers.forEach((T, ti) => {
    for (let i = 0; i < T.n; i++) {
      const a = T.a0 + (i / T.n) * TAU;
      // 燈臂：從軸心往下彎出去、再往上捲到燭杯（兩條平行線，像鑄件的邊）
      for (const off of [0, 0.022]) {
        const pts: V3[] = [];
        for (let k = 0; k <= 16; k++) {
          const [u, v] = bez([T.hubR, T.hubY - off], [T.r * 0.45, T.hubY - T.sag - off], [T.r * 1.02, T.hubY - T.sag * 0.9 - off], [T.r, T.cupY - 0.02 - off], k / 16);
          pts.push(polar(a, u, v));
        }
        L.poly(pts, off ? 0.8 : 1.1, off ? 0.3 : 0.6);
      }
      // 燭杯（淺盤）＋燭台套管
      const c = polar(a, T.r, 0);
      const disc = (rr: number, y: number, k: number) => {
        const pts: V3[] = [];
        for (let q = 0; q < 14; q++) { const u = (q / 14) * TAU; pts.push([c[0] + Math.sin(u) * rr, y, c[2] + Math.cos(u) * rr]); }
        L.poly(pts, 0.9, k, true);
      };
      disc(0.085, T.cupY, 0.6); disc(0.05, T.cupY - 0.035, 0.4); disc(0.028, T.cupY + 0.02, 0.45); disc(0.028, T.cupY + 0.15, 0.45);
      for (let q = 0; q < 4; q++) {
        const u = (q / 4) * TAU + 0.4;
        L.seg([c[0] + Math.sin(u) * 0.028, T.cupY + 0.02, c[2] + Math.cos(u) * 0.028], [c[0] + Math.sin(u) * 0.028, T.cupY + 0.15, c[2] + Math.cos(u) * 0.028], 0.8, 0.4);
      }
      // 燈泡外形：兩片正交的淚滴（燈絲的亮點由 chandelier.ts 另外畫）
      const by = T.cupY + 0.155;
      for (const rot of [0, Math.PI / 2]) {
        const pts: V3[] = [];
        for (let q = 0; q <= 18; q++) {
          // 淚滴曲線：φ = 0 是尖頂、φ = π 是圓底
          const u = (q / 18) * TAU;
          const ox = 0.04 * Math.sin(u) * Math.sin(u / 2), yy = by + 0.055 * (1 + Math.cos(u));
          pts.push([c[0] + Math.cos(rot + a) * ox, yy, c[2] - Math.sin(rot + a) * ox]);
        }
        L.poly(pts, 0.8, 0.5);
      }
      bulbs.push({ a, r: T.r, y: by + 0.06, tier: ti });
      // 燭杯下垂一串小水晶
      addStrand(a, T.r, T.cupY - 0.04, ti ? 0.2 : 0.14, ti ? 3 : 2, 0.05, 0.022, ti);
    }
    // 燈臂之間的裝飾環與垂飾
    const hy = T.hubY - T.sag * 0.72, hr = T.r * 0.78;
    ring(L, hr, hy, 64, 1.0, 0.5);
    ring(L, hr, hy - 0.025, 64, 0.7, 0.25);
    const ns = T.n * 2;
    for (let i = 0; i < ns; i++) {
      const a = T.a0 + ((i + 0.5) / ns) * TAU;
      addStrand(a, hr, hy - 0.03, (ti ? 0.3 : 0.2) + 0.05 * (i % 2), ti ? 4 : 3, ti ? 0.07 : 0.055, ti ? 0.032 : 0.026, ti);
    }
  });

  // ---- 最下層的大水晶環：從中層燭杯拉下 8 條珠鍊吊著（兩道金屬圈）
  ring(L, HOOP.r, HOOP.y, 128, 1.2, 0.6);
  ring(L, HOOP.r - 0.035, HOOP.y - 0.03, 128, 0.8, 0.3);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const p0 = polar(a, 1.2, 1.24), p1 = polar(a, HOOP.r, HOOP.y);
    const n = 14;
    let prev: V3 | null = null;
    for (let k = 0; k <= n; k++) {
      const s = k / n;
      // 珠鍊有一點垂度
      const p: V3 = [p0[0] + (p1[0] - p0[0]) * s, p0[1] + (p1[1] - p0[1]) * s - Math.sin(Math.PI * s) * 0.09, p0[2] + (p1[2] - p0[2]) * s];
      L.dot(p, 2.6, 0.5);
      if (prev) L.seg(prev, p, 0.6, 0.18);
      prev = p;
    }
  }
  // 水晶環的後半圈與兩側：一般的水晶串（前半圈留給歌詞的墜子）
  // 正後方（畫面上剛好在歌詞墜子的字後面）的串短一點，字的後面才不會一團線
  const back = 22;
  for (let i = 0; i < back; i++) {
    const a = LYRIC_ARC + 0.08 + ((TAU - 2 * LYRIC_ARC - 0.16) * i) / (back - 1);
    const behind = Math.abs(Math.PI - a) < 1.0;
    addStrand(a, HOOP.r, HOOP.y - 0.02, behind ? 0.1 : 0.24 + 0.1 * hash(i, seed, 9), behind ? 1 : 3, behind ? 0.05 : 0.065, behind ? 0.024 : 0.03, 2);
  }
  // 前半圈的花綵：珠子垂成一段一段的弧（沒有歌詞的時候前面也不空）
  const sw = 12;
  for (let i = 0; i < sw; i++) {
    const a0 = -LYRIC_ARC + (2 * LYRIC_ARC * i) / sw, a1 = -LYRIC_ARC + (2 * LYRIC_ARC * (i + 1)) / sw;
    const n = 9;
    let prev: V3 | null = null;
    for (let k = 0; k <= n; k++) {
      const s = k / n;
      const p = polar(a0 + (a1 - a0) * s, HOOP.r, HOOP.y - 0.02 - Math.sin(Math.PI * s) * 0.1);
      L.dot(p, 2.4, 0.45);
      if (prev) L.seg(prev, p, 0.55, 0.15);
      prev = p;
    }
  }

  const segs = new Float32Array(L.data);
  // 水晶的顆數（墜子＋珠子，標籤用）：前半圈的歌詞墜子隨歌詞增減，不算
  const crystals = strands.length + strands.reduce((a, s) => a + s.beads, 0) + 8 * 15 + sw * 10;
  return { segs, n: L.count, strands, bulbs, prisms: strands.length, crystals };
}
