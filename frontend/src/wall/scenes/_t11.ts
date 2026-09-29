// 批次 T11（儀器＋科學 A：scoreboard、elements、dna、orbit、pendulum、interference）共用的小工具：
//  - mono 標籤（機器的聲音）、編號
//  - 逐字／逐個出現的時間表（落在拍點上，n 個在時限內一定出完：窗格只有兩小節也讀得到）
//  - 亮版面的紙（纖維、雲紋先烤成一張貼圖，每格只讀一次；可以加方格紙的格線與左邊的紅線）
//  - 單應矩陣（四邊形 ↔ 四邊形），給有透視的版面算「螢幕 → 版面」座標
//  - 即時小卡要避開的範圍（矩形聯集成外框）
import * as THREE from 'three';
import { FSPass, makeRT, W, H } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba } from '../engine/palette';
import type { AudioData } from '../engine/audio';

/** 右下角 HUD（QR）的範圍：版面的字不要進到 x ≥ 1360 且 y ≥ 830。 */
export const HUD = { x: 1360, y: 830 };
/** 投影機會裁邊：字離四邊至少 96 px。 */
export const EDGE = 96;

export type Rect = [number, number, number, number];
export type P2 = { x: number; y: number };

export const pad3 = (n: number) => String(Math.max(0, n)).padStart(3, '0');

/** 機器的聲音：IBM Plex Mono 小字＋字距。回傳寬度。 */
export function mono(c: CanvasRenderingContext2D, text: string, x: number, y: number, o: { size?: number; color?: string; tracking?: number; align?: 'left' | 'right' | 'center'; weight?: number } = {}): number {
  const size = o.size ?? 15, tr = o.tracking ?? 3;
  c.font = font(F.mono(o.weight ?? 500), size);
  c.letterSpacing = `${tr}px`;
  c.fillStyle = o.color ?? rgba('ash', 0.8);
  const w = c.measureText(text).width;
  const x0 = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
  c.fillText(text, x0, y);
  c.letterSpacing = '0px';
  return w;
}

/** 中文小標籤（思源黑體 500＋字距），給欄位名稱用。回傳寬度。 */
export function tag(c: CanvasRenderingContext2D, text: string, x: number, y: number, o: { size?: number; color?: string; tracking?: number; align?: 'left' | 'right' | 'center'; weight?: number } = {}): number {
  const size = o.size ?? 18, tr = o.tracking ?? 3;
  c.font = font(F.hei(o.weight ?? 500), size);
  c.letterSpacing = `${tr}px`;
  c.fillStyle = o.color ?? rgba('ash', 0.9);
  const w = c.measureText(text).width;
  const x0 = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
  c.fillText(text, x0, y);
  c.letterSpacing = '0px';
  return w;
}

/**
 * n 個東西依序出現的時間：從 t0（通常是第一個拍點）開始，一拍 1、2、4 或 8 個，
 * 挑最慢、但能在 maxDur 秒內出完的那一種（再不夠就平均塞進去）。這樣短留言一拍一個字很有節奏，
 * 六十個字的長留言在短窗格裡也一定出得完、留得到時間讀。
 */
export function stagger(au: AudioData, t0: number, n: number, maxDur: number): number[] {
  if (n <= 0) return [];
  const b0 = au.beatAt(t0);
  const budget = Math.max(0.25, au.beatAt(t0 + Math.max(0.2, maxDur)) - b0);
  const per = n <= 1 ? 1 : [1, 2, 4, 8].find((k) => (n - 1) / k <= budget) ?? (n - 1) / budget;
  return Array.from({ length: n }, (_, i) => au.timeOfBeat(b0 + i / per));
}

/** 幾個矩形的外框（給 popupAvoid：同一塊東西的範圍）。 */
export function bbox(rs: Rect[], pad = 0): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y, w, h] of rs) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h); }
  return [Math.round(x0 - pad), Math.round(y0 - pad), Math.round(x1 - x0 + 2 * pad), Math.round(y1 - y0 + 2 * pad)];
}

// ---------------------------------------------------------------- 單應矩陣
/** 3×3 矩陣（列優先），把四邊形 src 的四個角對到 dst 的四個角（DLT，高斯消去）。 */
export function homography(src: P2[], dst: P2[]): number[] {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]!, { x: u, y: v } = dst[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r;
    [A[c], A[p]] = [A[p]!, A[c]!];
    const d = A[c]![c]! || 1e-12;
    for (let k = c; k < 9; k++) A[c]![k]! /= d;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r]![c]!;
      if (f) for (let k = c; k < 9; k++) A[r]![k]! -= f * A[c]![k]!;
    }
  }
  return [A[0]![8]!, A[1]![8]!, A[2]![8]!, A[3]![8]!, A[4]![8]!, A[5]![8]!, A[6]![8]!, A[7]![8]!, 1];
}
export function applyH(m: number[], x: number, y: number): P2 {
  const w = m[6]! * x + m[7]! * y + m[8]!;
  return { x: (m[0]! * x + m[1]! * y + m[2]!) / w, y: (m[3]! * x + m[4]! * y + m[5]!) / w };
}
/** 版面上的矩形經過投影後在螢幕上的外框。 */
export function mapRect(m: number[], [x, y, w, h]: Rect, pad = 0): Rect {
  const ps = [applyH(m, x, y), applyH(m, x + w, y), applyH(m, x, y + h), applyH(m, x + w, y + h)];
  const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return [Math.round(x0 - pad), Math.round(y0 - pad), Math.round(Math.max(...xs) - x0 + 2 * pad), Math.round(Math.max(...ys) - y0 + 2 * pad)];
}

// ---------------------------------------------------------------- 亮版面的紙
/** 烤紙：r = 明暗倍率（0.86 + r × 0.2）、g = 纖維（給墨吃得少一點的地方）。跟顏色無關，換主題不用重烤。 */
const PAPER_BAKE = /* glsl */ `
float fib(vec2 p, float cs) {
  float acc = 0.0;
  vec2 cell = floor(p / cs);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = cell + vec2(float(i), float(j));
    vec2 o = (c + hash22(c)) * cs;
    float a = hash12(c + 7.1) * TAU;
    float L = cs * (0.3 + 1.1 * hash12(c + 3.3));
    vec2 d = vec2(cos(a), sin(a));
    acc += (hash12(c + 9.9) - 0.5) * (1.0 - smoothstep(0.25, 1.3, sdSegment(p, o - d * L * 0.5, o + d * L * 0.5)));
  }
  return acc;
}
void main() {
  vec2 p = vec2(vUv.x * ${W}.0, (1.0 - vUv.y) * ${H}.0);
  float cloud = fbm(p * 0.0019, 4), mid = snoise(p * 0.016);
  float f = fib(p, 22.0) + 0.6 * fib(p * 1.7 + 31.0, 22.0);
  float speck = step(0.99968, hash12(floor(p * 0.5)));
  float v = 0.975 + 0.03 * cloud + 0.008 * mid + 0.045 * f - speck * 0.3;
  fragColor = vec4((v - 0.86) / 0.2, clamp(f * 4.0, 0.0, 1.0), 0.0, 1.0);
}`;

const PAPER_FRAG = /* glsl */ `
uniform sampler2D bake;
uniform float grid;      // 方格紙的格距（px），0 = 沒有格線
uniform vec2 gridO;      // 格線原點（px，y 向下）
uniform vec4 gridBox;    // 格線只畫在這個範圍（x0, y0, x1, y1）
uniform float margin;    // 左邊的紅線（x，px），< 0 = 沒有
uniform float k;         // 進出場（格線、紅線的濃淡）
void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  vec4 b = texture(bake, vUv);
  vec3 col = C_PAPER * (0.86 + 0.2 * b.r);
  // 斜斜打過來的光：左上亮一點、右下暗一點
  col *= 0.965 + 0.05 * (vUv.y * 0.55 + (1.0 - vUv.x) * 0.45);
  if (grid > 0.0) {
    vec2 g = (p - gridO) / grid;
    vec2 d = abs(fract(g + 0.5) - 0.5) * grid;
    vec2 d5 = abs(fract(g / 5.0 + 0.5) - 0.5) * grid * 5.0;
    float inb = step(gridBox.x, p.x) * step(p.x, gridBox.z) * step(gridBox.y, p.y) * step(p.y, gridBox.w);
    float fine = max(pxLine(d.x, 0.2, 1.1), pxLine(d.y, 0.2, 1.1));
    float bold = max(pxLine(d5.x, 0.45, 1.4), pxLine(d5.y, 0.45, 1.4));
    // 格線用訊號色的暗部（像印刷的方格紙），很淡；紙纖維多的地方吃墨少
    float a = (0.085 * fine + 0.12 * bold) * inb * k * (1.0 - 0.35 * b.g);
    col = mix(col, C_BLOOD, a);
  }
  if (margin >= 0.0) col = mix(col, C_SIGNAL * 0.8 + C_BLOOD * 0.2, pxLine(abs(p.x - margin), 0.5, 1.5) * 0.45 * k);
  fragColor = vec4(col, 1.0);
}`;

/** 模組層共用的紙：第一次用的時候烤一次（整晚只烤一次）。 */
export class Paper {
  rt = makeRT(W, H, { depthBuffer: false });
  bakePass = new FSPass(PAPER_BAKE);
  pass = new FSPass(PAPER_FRAG, {
    bake: { value: null }, grid: { value: 0 }, gridO: { value: new THREE.Vector2() }, gridBox: { value: new THREE.Vector4(0, 0, W, H) },
    margin: { value: -1 }, k: { value: 1 },
  });
  private baked = false;
  render(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, o: { grid?: number; gridO?: [number, number]; gridBox?: [number, number, number, number]; margin?: number; k?: number } = {}) {
    if (!this.baked) { this.bakePass.render(renderer, this.rt); this.baked = true; }
    const u = this.pass.u;
    u.bake!.value = this.rt.texture;
    u.grid!.value = o.grid ?? 0;
    (u.gridO!.value as THREE.Vector2).set(...(o.gridO ?? [0, 0]));
    (u.gridBox!.value as THREE.Vector4).set(...(o.gridBox ?? [0, 0, W, H]));
    u.margin!.value = o.margin ?? -1;
    u.k!.value = o.k ?? 1;
    this.pass.render(renderer, out);
  }
}
