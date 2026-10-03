// 心電圖版面（heartbeat.ts）的「訊號」：心跳排在哪裡、波形長什麼樣子、掃描線在哪一格畫到哪裡。
// 全部都是時間的純函數（沒有狀態），所以任何一格截圖都一樣，也不怕跳秒。
import type { AudioData } from '../engine/audio';
import { clamp, noise1, lerp, type V2 } from '../engine/util';
import { heartPoints } from './_motifs';

/** 一下心跳：R 波的時間與強度（0..1）。 */
export interface Pulse { t: number; a: number }

/**
 * 從大鼓挑出心跳。分析出來的大鼓 onset 很密（連弱拍、鼓邊都算），直接用會變成顫動：
 * 只留夠強的、彼此至少隔 ~0.7 拍（不然 T 波會疊到下一下）；兩下之間空太久（間奏、沒有鼓的抒情歌）就用拍點補，
 * 心電圖才不會突然停掉——平線在婚禮上的意思不好。
 */
export function pickPulses(au: AudioData, t0: number, t1: number): Pulse[] {
  const beat = au.beatPeriod((t0 + t1) / 2);
  const minGap = Math.max(0.34, 0.72 * beat);
  const out: Pulse[] = [];
  for (const [t, s] of au.events('kick', t0 - 1.5, t1)) {
    if (s < 0.42) continue;
    const last = out[out.length - 1];
    if (last && t - last.t < minGap) {
      // 太近的兩下留比較強的那下（但不要一路往後拖：只在前一下還沒被換過時換）
      if (s > last.a + 0.15 && t - last.t < minGap * 0.5) { last.t = t; last.a = s; }
      continue;
    }
    out.push({ t, a: s });
  }
  // 補拍：相鄰兩下隔超過 1.75 拍，就在中間的拍點補上弱一點的心跳
  const filled: Pulse[] = [];
  const b0 = Math.ceil(au.beatAt(t0 - 1.5)), b1 = Math.floor(au.beatAt(t1));
  const beats: number[] = [];
  for (let b = b0; b <= b1; b++) beats.push(au.timeOfBeat(b));
  const all = [{ t: t0 - 1.5 - beat, a: 0 }, ...out, { t: t1 + beat, a: 0 }];
  for (let i = 0; i + 1 < all.length; i++) {
    const a = all[i]!, b = all[i + 1]!;
    if (a.a > 0) filled.push(a);
    if (b.t - a.t <= 1.75 * beat) continue;
    let last = a.t;
    for (const bt of beats) {
      if (bt <= a.t + minGap || bt >= b.t - minGap || bt - last < Math.max(minGap, 0.9 * beat)) continue;
      filled.push({ t: bt, a: 0.55 });
      last = bt;
    }
  }
  return filled.filter((p) => p.t < t1);
}

const G = (x: number, s: number) => Math.exp(-0.5 * (x / s) * (x / s));

/**
 * 一個 PQRST 波（R 波高 = 1），dt 是距離 R 波的秒數。q 依速度縮放 P、T 波的位置
 * （心跳快時 QT 間期本來就會變短，也避免 T 波撞上下一下的 P 波）。ch 讓兩個人的波形有一點點不一樣。
 */
export function complexAt(dt: number, q: number, ch: number): number {
  if (dt < -0.3 || dt > 0.48) return 0;
  const p = (0.11 + 0.02 * ch) * G(dt + 0.165 * q, 0.026 * q);
  const qw = -0.12 * G(dt + 0.03, 0.0085); // Q 波
  const r = G(dt, 0.0105);
  const s = -(0.24 - 0.05 * ch) * G(dt - 0.026, 0.0095);
  const tc = 0.235 * q;
  const tw = (0.26 + 0.05 * ch) * G(dt - tc, (dt < tc ? 0.06 : 0.042) * q);
  return p + qw + r + s + tw;
}

/** 心電圖的電壓（R 波 = 1 的單位）：附近的心跳加總，再加一點基線飄移與肌電雜訊（跟著歌的高頻走）。 */
export function ecgAt(pulses: Pulse[], tau: number, q: number, ch: number, au: AudioData): number {
  let lo = 0, hi = pulses.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (pulses[m]!.t < tau - 0.5) lo = m + 1; else hi = m; }
  let v = 0;
  for (let i = lo; i < pulses.length; i++) {
    const p = pulses[i]!;
    if (p.t > tau + 0.3) break;
    v += (0.72 + 0.28 * p.a) * complexAt(tau - p.t, q, ch);
  }
  v += 0.016 * Math.sin(tau * 1.7 + ch * 2.1) + 0.011 * Math.sin(tau * 0.63 + ch);
  v += (0.007 + 0.014 * au.env('high', tau)) * noise1(tau * 95, 7 + ch * 13);
  return v;
}

/**
 * 掃描線：示波器從左掃到右、到底再從左邊重來。掃描位置跟拍點綁在一起（u = 第幾趟 + 這趟走了多少），
 * 一趟的長度（N 拍）依這個窗格調整，讓掃描線在「最後一小節的強拍」剛好走到愛心的位置 phiH。
 * 畫愛心的那段時間掃描線停住（愛心自己畫），畫完再繼續往右走平線。
 */
export class Sweep {
  b0: number; N: number; uH: number; bH1: number;
  constructor(private au: AudioData, public s: number, public tH0: number, public tH1: number, phiH: number, targetSec: number) {
    const beat = au.beatPeriod(tH0);
    this.b0 = au.beatAt(s);
    const Q = Math.max(0.5, au.beatAt(tH0) - this.b0);
    const N0 = clamp(targetSec / beat, 3, 10);
    const k = Math.max(0, Math.round(Q / N0 - phiH));
    this.N = Q / (k + phiH);
    this.uH = k + phiH;
    this.bH1 = au.beatAt(tH1);
  }
  /** t 時掃描線走到哪（連續的「趟數」）。 */
  u(t: number) {
    if (t <= this.tH0) return (this.au.beatAt(t) - this.b0) / this.N;
    if (t <= this.tH1) return this.uH;
    return this.uH + (this.au.beatAt(t) - this.bH1) / this.N;
  }
  /** u 的反函數：掃描線哪一刻畫到這個位置（u 剛好等於 uH 的那一段是愛心，回傳開始畫愛心的時間）。 */
  tOf(u: number) {
    if (u < this.uH) return this.au.timeOfBeat(this.b0 + u * this.N);
    if (u > this.uH) return this.au.timeOfBeat(this.bH1 + (u - this.uH) * this.N);
    return this.tH0;
  }
}

/** 愛心的兩條路：新郎的線（上）從凹口往左繞到尖端、新娘的線（下）從尖端往右繞回凹口——兩條線互相追著，把愛心合起來。 */
export interface HeartPaths {
  /** 上面那條線：從基線下到凹口，再沿左半邊到尖端。 */
  a: V2[];
  /** 下面那條線：從基線上到尖端，再沿右半邊到凹口。 */
  b: V2[];
  aLen: Float32Array;
  bLen: Float32Array;
  /** 整顆愛心的輪廓（填網線用）。 */
  outline: V2[];
  notch: V2;
  tip: V2;
  cx: number;
  cy: number;
  s: number;
  top: number;
}

/** 把愛心放在兩條基線 y1、y2 之間（上下各留 margin），中心 x = hx。 */
export function heartPaths(hx: number, y1: number, y2: number, margin: number): HeartPaths {
  const n = 120;
  const P = heartPoints(n);
  let minY = Infinity, maxY = -Infinity;
  for (const p of P) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const s = (y2 - y1 - 2 * margin) / (maxY - minY);
  const cy = y1 + margin - minY * s;
  const at = (p: V2): V2 => ({ x: hx + p.x * s, y: cy + p.y * s });
  const pts = P.map(at);
  const half = n / 2; // heartPoints：0 = 尖端，n/2 = 凹口，n = 回到尖端
  const notch = pts[half]!, tip = pts[0]!;
  const a: V2[] = [{ x: hx, y: y1 }];
  for (let i = half; i >= 0; i--) a.push(pts[i]!);
  const b: V2[] = [{ x: hx, y: y2 }];
  for (let i = n; i >= half; i--) b.push(pts[i]!);
  return { a, b, aLen: lengths(a), bLen: lengths(b), outline: pts, notch, tip, cx: hx, cy, s, top: y1 + margin };
}

function lengths(p: V2[]) {
  const L = new Float32Array(p.length);
  for (let i = 1; i < p.length; i++) L[i] = L[i - 1]! + Math.hypot(p[i]!.x - p[i - 1]!.x, p[i]!.y - p[i - 1]!.y);
  return L;
}

/** 路徑走到 frac（0..1，依弧長）時的點列（最後一點是筆尖）。 */
export function partial(p: V2[], L: Float32Array, frac: number): V2[] {
  const total = L[L.length - 1]!, len = clamp(frac) * total;
  const out: V2[] = [p[0]!];
  for (let i = 1; i < p.length; i++) {
    if (L[i]! <= len) { out.push(p[i]!); continue; }
    const k = (len - L[i - 1]!) / Math.max(1e-6, L[i]! - L[i - 1]!);
    out.push({ x: lerp(p[i - 1]!.x, p[i]!.x, k), y: lerp(p[i - 1]!.y, p[i]!.y, k) });
    break;
  }
  return out;
}

/** 掃描線填色用：多邊形在每一列的水平區間（一列一條 LineBatch 線段就能填滿，不用每格上傳 Canvas）。 */
export interface Row { y: number; x0: number; x1: number }
export function scanRows(poly: V2[], y0: number, y1: number, step: number): Row[] {
  const out: Row[] = [];
  for (let y = y0 + step / 2; y < y1; y += step) {
    const xs: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) out.push({ y, x0: xs[k]!, x1: xs[k + 1]! });
  }
  return out;
}
