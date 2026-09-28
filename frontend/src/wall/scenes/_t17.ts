// 批次 T17（遊戲 A：domino、maze、puzzle、chess、mahjong、cards）共用的小工具。
// 六個版面的手法各不相同（three.js 立體骨牌、版畫地圖 shader、飛進來的拼圖片、低角度的棋盤、俯拍的麻將桌、牌桌上的發牌），
// 共用的只有：
//  - 「一格一個字」的斷行：骨牌、麻將牌、拼圖這種一個物件放一個字的版面，要把留言排成「每行最多 n 格」，
//    英文單字不能拆、標點不能在行首、每行平衡（不要最後一行只剩一格）。
//  - 節拍：窗格裡的拍點、n 個東西排在 1/k 拍的格子上（挑最慢、但來得及在時限內排完的 k）。
//  - three.js 透視鏡頭的「保證字在安全範圍內」（離四邊 96 px、不進右下角 QR 區）。
//  - 署名與這批會用到的固定字串。
import * as THREE from 'three';
import type { AudioData } from '../engine/audio';
import { tokens } from '../engine/text';
import { W, H } from '../engine/gl';
import { clamp } from '../engine/util';
import { signature, COUPLE_ZH } from './_motifs';
import type { Msg } from '../engine/scene';

export type Rect = [number, number, number, number];
export type V3 = [number, number, number];

/** 這批沒有留言時的邀請（整批一致的說法）。 */
export const T17_INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
/** 這批固定會出現、但不是寫死在各版面檔裡的字（數字、符號、署名用字），init 時一起載。 */
export const T17_TEXT = `${T17_INVITE}${COUPLE_ZH}一位賓客新人—♥·0123456789`;

/** 署名：新人的留言寫「—— 宣文 & 孟庭」，其他照 signature()。 */
export const sigOf = (m: Msg | null) => (m ? (m.couple ? `—— ${COUPLE_ZH}` : signature(m.name)) : '');

// ---------------------------------------------------------------- 一格一個字
let seg: Intl.Segmenter | null = null;

/** 一段文字的「格」：中文一個字一格、英文一個字母一格、空白也是一格（行首行尾的空白去掉）。 */
export const cellsOf = (s: string) => Array.from(s);

/**
 * 把留言排成每行最多 maxCols 格：用引擎的斷詞單位（英文單字連在一起、標點黏在前一個字），
 * 行數跟貪婪斷行一樣，但每行的格數拉平（留白平方和最小），而且盡量斷在標點、空白後面。
 * 單一單位比 maxCols 還長（很長的英文字）就硬拆。回傳每行的格子（字串陣列）。
 */
export function cellRows(text: string, maxCols: number): string[][] {
  let toks = tokens(text).flatMap((tk) => {
    const cs = cellsOf(tk);
    if (cs.length <= maxCols) return [tk];
    const out: string[] = [];
    for (let i = 0; i < cs.length; i += maxCols) out.push(cs.slice(i, i + maxCols).join(''));
    return out;
  });
  if (!toks.length) toks = [text];
  const n = toks.length;
  const len = toks.map((tk) => cellsOf(tk).length);
  const lenTrim = toks.map((tk) => cellsOf(tk.trimEnd()).length);
  const pre = [0];
  for (const x of len) pre.push(pre[pre.length - 1]! + x);
  const lineLen = (i: number, j: number) => pre[j]! - pre[i]! - (len[j - 1]! - lenTrim[j - 1]!);
  // 貪婪的行數
  let greedy = 0;
  for (let i = 0; i < n;) { let j = i + 1; while (j < n && lineLen(i, j + 1) <= maxCols) j++; greedy++; i = j; }
  // 斷點的代價：標點、空白後面免費；中文詞與詞之間一點點；把一個詞拆開很多（「宣／文」「今天／來」讀起來很怪）
  if (!seg) seg = new Intl.Segmenter('zh-Hant', { granularity: 'word' });
  const joined = toks.join('');
  const bounds = new Set<number>();
  for (const s of seg.segment(joined)) bounds.add(s.index);
  const at: number[] = [0];
  for (const tk of toks) at.push(at[at.length - 1]! + tk.length);
  const brk = (j: number) => (/[、。，．,.!?！？：；:;）)」』】〕〉》…～~♥\s]$/.test(toks[j - 1]!) ? 0 : bounds.has(at[j]!) ? 0.08 * maxCols * maxCols : 0.3 * maxCols * maxCols);
  const INF = Infinity;
  const best = Array.from({ length: greedy + 1 }, () => new Array<number>(n + 1).fill(INF));
  const from = Array.from({ length: greedy + 1 }, () => new Array<number>(n + 1).fill(-1));
  best[0]![0] = 0;
  for (let k = 1; k <= greedy; k++) for (let j = 1; j <= n; j++) for (let i = j - 1; i >= 0; i--) {
    const L = lineLen(i, j);
    if (L > maxCols) break;
    const prev = best[k - 1]![i]!;
    if (prev === INF) continue;
    const c = prev + (maxCols - L) ** 2 + (j < n ? brk(j) : 0);
    if (c < best[k]![j]!) { best[k]![j] = c; from[k]![j] = i; }
  }
  const rows: string[][] = [];
  if (best[greedy]![n] === INF) {
    // 理論上不會發生（上面已經把太長的單位拆開）；保險起見照格數硬切
    const all = cellsOf(text.trim());
    for (let i = 0; i < all.length; i += maxCols) rows.push(all.slice(i, i + maxCols));
    return rows;
  }
  for (let k = greedy, j = n; k > 0; k--) {
    const i = from[k]![j]!;
    rows.unshift(cellsOf(toks.slice(i, j).join('').trim()));
    j = i;
  }
  return rows;
}

/**
 * 在幾種每行格數裡挑「字最大」的排法：score(cols, rows) 回傳這種排法在畫面上一格有多大（越大越好），
 * 差不多大時行數少的優先（短句寧可一行）。
 */
export function bestCellRows(text: string, colsList: number[], score: (cols: number, rows: string[][]) => number): { cols: number; rows: string[][]; s: number } {
  let best: { cols: number; rows: string[][]; s: number } | null = null;
  for (const cols of colsList) {
    const rows = cellRows(text, cols);
    const s = score(Math.max(...rows.map((r) => r.length)), rows);
    if (!best || s > best.s * 1.04 || (s > best.s * 0.97 && rows.length < best.rows.length)) best = { cols, rows, s };
  }
  return best!;
}

// ---------------------------------------------------------------- 節拍
/** [t0, t1) 之間的拍點。 */
export function beatsBetween(au: AudioData, t0: number, t1: number): number[] {
  const out: number[] = [];
  for (let k = Math.ceil(au.beatAt(t0) - 1e-6); out.length < 600; k++) {
    const tt = au.timeOfBeat(k);
    if (tt >= t1 - 1e-6) break;
    out.push(tt);
  }
  return out;
}

/**
 * n 個動作排在 1/k 拍的格子上（k = 1、2、4、8，挑最慢但來得及在 maxDur 秒內排完的），
 * 從 t0（拍點）開始。回傳每個動作的時間（照真的拍點內插，不是等距）。
 */
export function onGrid(au: AudioData, t0: number, n: number, maxDur: number, ks = [1, 2, 4, 8]): { times: number[]; k: number } {
  if (n <= 0) return { times: [], k: 1 };
  const b0 = au.beatAt(t0);
  const budget = Math.max(0.25, au.beatAt(t0 + Math.max(0.1, maxDur)) - b0);
  const k = ks.find((kk) => (n - 1) / kk <= budget) ?? ks[ks.length - 1]!;
  const per = (n - 1) / k <= budget ? k : Math.max(k, (n - 1) / budget);
  return { times: Array.from({ length: n }, (_, i) => au.timeOfBeat(b0 + i / per)), k: per };
}

// ---------------------------------------------------------------- three.js 透視鏡頭
/** 右下角 QR 區與四邊的安全範圍。 */
export const SAFE = { x0: 96, y0: 96, x1: W - 96, y1: H - 96, qx: 1360, qy: 830 };

/** 螢幕座標的點是否都在安全範圍內（qr = 這組字需不需要避開右下角 QR 區）。 */
export function ptsSafe(pts: { x: number; y: number }[], qr = true, pad = 0): boolean {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  if (x0 < SAFE.x0 + pad || y0 < SAFE.y0 + pad || x1 > SAFE.x1 - pad || y1 > SAFE.y1 - pad) return false;
  return !(qr && x1 > SAFE.qx && y1 > SAFE.qy);
}

/** 世界座標 → 螢幕像素（y 向下）與深度。 */
export function toScreen(cam: THREE.PerspectiveCamera, p: V3, v = new THREE.Vector3()) {
  v.set(p[0], p[1], p[2]).project(cam);
  return { x: (v.x * 0.5 + 0.5) * W, y: (0.5 - v.y * 0.5) * H, behind: v.z > 1 };
}

/**
 * 繞著目標點的鏡頭：az = 方位角（0 = 在目標正前方 −y 那一側、正的往右邊繞）、el = 仰角（0 = 平視、π/2 = 正上方往下）。
 * 世界座標：x 向右、y 往桌子裡面、z 向上（桌面 z = 0）。
 */
export interface OrbitCam { tx: number; ty: number; tz: number; dist: number; az: number; el: number; roll?: number; fov: number }

export function applyOrbit(cam: THREE.PerspectiveCamera, o: OrbitCam) {
  if (cam.fov !== o.fov) { cam.fov = o.fov; cam.updateProjectionMatrix(); }
  const ce = Math.cos(o.el);
  cam.up.set(0, 0, 1);
  cam.position.set(o.tx + o.dist * ce * Math.sin(o.az), o.ty - o.dist * ce * Math.cos(o.az), o.tz + o.dist * Math.sin(o.el));
  cam.lookAt(o.tx, o.ty, o.tz);
  if (o.roll) cam.rotateZ(o.roll);
  cam.updateMatrixWorld();
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
}

export const lerpOrbit = (a: OrbitCam, b: OrbitCam, k: number): OrbitCam => ({
  tx: a.tx + (b.tx - a.tx) * k, ty: a.ty + (b.ty - a.ty) * k, tz: a.tz + (b.tz - a.tz) * k,
  dist: Math.exp(Math.log(a.dist) + (Math.log(b.dist) - Math.log(a.dist)) * k),
  az: a.az + (b.az - a.az) * k, el: a.el + (b.el - a.el) * k, roll: (a.roll ?? 0) + ((b.roll ?? 0) - (a.roll ?? 0)) * k, fov: a.fov + (b.fov - a.fov) * k,
});

/**
 * 把鏡頭往後拉（dist 變大）到每一組重要的點（世界座標）投影後都在安全範圍內。
 * groups：[點, 要不要避開 QR 區]。回傳調整後的鏡頭。
 */
export function fitOrbit(cam: THREE.PerspectiveCamera, o: OrbitCam, groups: [V3[], boolean][], maxDist = o.dist * 4, pad = 0): OrbitCam {
  const ok = (d: number) => {
    applyOrbit(cam, { ...o, dist: d });
    return groups.every(([pts, qr]) => ptsSafe(pts.map((p) => toScreen(cam, p)), qr, pad));
  };
  if (ok(o.dist)) return o;
  let lo = o.dist, hi = maxDist;
  if (!ok(hi)) return { ...o, dist: hi };
  for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (ok(m)) hi = m; else lo = m; }
  return { ...o, dist: hi };
}

/**
 * 跟 fitOrbit 一樣，但也試著把對準點往右、往前（畫面下方）挪一點：右下角有 QR 區，字塊置中時右下角常常卡到，
 * 挪開之後鏡頭可以推得更近、字更大。回傳鏡頭最近的那一個。
 */
export function fitOrbitBest(cam: THREE.PerspectiveCamera, o: OrbitCam, groups: [V3[], boolean][], span: [number, number], maxDist = o.dist * 4, pad = 0): OrbitCam {
  let best: OrbitCam | null = null;
  for (const fx of [0, 0.04, 0.08, 0.12, 0.16]) for (const fy of [0, 0.05, 0.1, 0.15]) {
    const r = fitOrbit(cam, { ...o, tx: o.tx + fx * span[0], ty: o.ty - fy * span[1] }, groups, maxDist, pad);
    if (!best || r.dist < best.dist - 1) best = r;
  }
  return best!;
}

/** 世界座標的矩形（桌面上，z 固定）四個角。 */
export const rectPts = (x: number, y: number, w: number, h: number, z = 0): V3[] => [[x, y, z], [x + w, y, z], [x, y + h, z], [x + w, y + h, z]];

/** 鏡頭的基底（給全螢幕 shader 做「光線打到桌面」用）：位置、右、畫面往下、前，與焦距（像素）。 */
export function camBasis(cam: THREE.PerspectiveCamera) {
  const e = cam.matrixWorld.elements;
  const R = new THREE.Vector3(e[0], e[1], e[2]).normalize();
  const U = new THREE.Vector3(e[4], e[5], e[6]).normalize();
  const Fw = new THREE.Vector3(-e[8]!, -e[9]!, -e[10]!).normalize();
  const f = (H / 2) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
  return { C: cam.position.clone(), R, D: U.clone().multiplyScalar(-1), F: Fw, f };
}

/** 桌面上一點在鏡頭的深度（沿視線）。 */
export function depthOf(cam: THREE.PerspectiveCamera, p: V3) {
  const v = new THREE.Vector3(...p).applyMatrix4(cam.matrixWorldInverse);
  return -v.z;
}

/** 0..1 夾住的線性進度（窗格很短時 a == b 也不會 NaN）。 */
export const k01 = (t: number, a: number, b: number) => (b <= a ? (t >= a ? 1 : 0) : clamp((t - a) / (b - a)));
