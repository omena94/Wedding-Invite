// 批次 T7（機器 A：翻頁鐘、航班看板、里程表、收音機、錄音帶、等化器）共用的小工具。
//  - 跟唱的逐字時間（lineCues）：翻牌、滾輪是「一格一個字」，要知道這一格的字什麼時候唱到、它所屬的詞什麼時候唱完。
//    英文一個 Word 是一個單字：字母依序在這個字的時間裡亮起（跟 drawLyric 的擦亮一樣的速度）。
//  - 斷成格子列（wrapCells）：英文字不拆、中文任何字之間都能斷、空白處優先斷、標點不放行首。
//  - 字模圖集（GlyphAtlas）：翻牌、滾輪在 shader／3D 裡畫字，先把這個窗格會用到的字畫成一張白字貼圖（只用 alpha）。
//  - 翻牌序列（flipAt）：一格在 t 時翻到哪裡（中間先翻過幾張亂數字牌，最後落定在指定的時間），是 t 的純函數。
import * as THREE from 'three';
import type { Line, Lyrics, Word } from '../engine/lyrics';
import { font } from '../engine/type';
import { hash } from '../engine/util';
import { drawHeart } from './_motifs';

// ---------------------------------------------------------------- 跟唱：每個字的時間
/** 一行歌詞裡每個字（code point）的時間：t0 開始亮（唱到這個字）、w1 所屬的詞唱完、wi 第幾個詞（-1 = 空白或詞外的標點）。 */
export interface Cue { ch: string; t0: number; w1: number; wi: number }

const cueCache = new WeakMap<Line, Cue[]>();
export function lineCues(line: Line): Cue[] {
  const hit = cueCache.get(line);
  if (hit) return hit;
  const chars = Array.from(line.text);
  // Word.o 是 UTF-16 位置：換成第幾個 code point
  const at = new Map<number, number>();
  let o = 0;
  chars.forEach((ch, i) => { at.set(o, i); o += ch.length; });
  const cues: Cue[] = chars.map((ch) => ({ ch, t0: NaN, w1: NaN, wi: -1 }));
  for (const w of line.words) {
    const k0 = at.get(w.o);
    if (k0 === undefined) continue;
    const n = Array.from(w.w).length;
    for (let k = 0; k < n && k0 + k < chars.length; k++) {
      cues[k0 + k] = { ch: chars[k0 + k]!, t0: w.start + ((w.end - w.start) * k) / n, w1: w.end, wi: w.index };
    }
  }
  // 詞外的字（空白、沒對到的標點）：跟著前一個詞
  let last = line.start;
  for (const c of cues) { if (Number.isNaN(c.t0)) { c.t0 = c.w1 = last; } else last = c.w1; }
  cueCache.set(line, cues);
  return cues;
}

/** 一格字在 t 時的跟唱狀態：0 還沒唱、1 正在唱（所屬的詞還沒唱完）、2 唱完。 */
export const cueState = (c: Cue, t: number) => (t < c.t0 ? 0 : t < c.w1 ? 1 : 2);

/** 這個窗格（前後多抓一點）會出現的歌詞行。 */
export const windowLines = (lyrics: Lyrics, s: number, e: number, pad = 1.5) => lyrics.lines.filter((l) => l.end > s - pad && l.start < e + pad);

// ---------------------------------------------------------------- 斷成格子列
const isWordCh = (ch: string) => /[\p{Script=Latin}\p{N}'’\-&@#+]/u.test(ch);
const NO_START = new Set(Array.from('、。，．,.!?！？：；:;）)」』】〕〉》…～~%％”’"'));

/**
 * 把字（code point 陣列）斷成每列最多 cols 格：回傳每列的字位置。英文字不拆（除非一個字就比一列長）、
 * 標點黏在前一個字後面、列首列尾的空白拿掉。
 */
export function wrapCells(chars: string[], cols: number, balanced = false): number[][] {
  const rows = wrapGreedyCells(chars, cols);
  if (!balanced || rows.length <= 1) return rows;
  // 平衡：列數不變，每列盡量一樣長（不要最後一列只剩一兩個字）
  let lo = 1, hi = cols, best = rows;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = wrapGreedyCells(chars, mid);
    if (r.length <= rows.length && r.every((x) => x.length <= mid)) { best = r; hi = mid - 1; } else lo = mid + 1;
  }
  return best;
}

function wrapGreedyCells(chars: string[], cols: number): number[][] {
  const n = chars.length;
  const units: number[][] = [];
  let i = 0;
  while (i < n) {
    const u = [i];
    if (chars[i] === ' ') { units.push(u); i++; continue; }
    if (isWordCh(chars[i]!)) while (i + 1 < n && isWordCh(chars[i + 1]!)) u.push(++i);
    i++;
    while (i < n && NO_START.has(chars[i]!)) u.push(i++);
    units.push(u);
  }
  const rows: number[][] = [];
  let row: number[] = [];
  const flush = () => { while (row.length && chars[row[row.length - 1]!] === ' ') row.pop(); if (row.length) rows.push(row); row = []; };
  for (const u of units) {
    if (chars[u[0]!] === ' ') { if (row.length) row.push(u[0]!); continue; }
    if (row.length + u.length > cols) flush();
    if (u.length > cols) { for (let k = 0; k < u.length; k += cols) { row = u.slice(k, k + cols); if (row.length === cols) flush(); } continue; }
    row.push(...u);
  }
  flush();
  return rows;
}

/** 一行歌詞排成翻牌的「頁」：每頁最多 maxRows 列；一行太長就分好幾頁，下一頁在它的第一個字要唱之前翻上來。 */
export interface CuePage { line: Line; cues: Cue[]; rows: number[][]; t0: number; t1: number }
export function cuePages(lines: Line[], cols: number, maxRows: number, balanced = false): CuePage[] {
  const out: CuePage[] = [];
  for (const line of lines) {
    const cues = lineCues(line);
    const rows = wrapCells(cues.map((c) => c.ch), cols, balanced);
    for (let r = 0; r < rows.length; r += maxRows) {
      const rr = rows.slice(r, r + maxRows);
      const idx = rr.flat();
      if (!idx.length) continue;
      out.push({ line, cues, rows: rr, t0: Math.min(...idx.map((k) => cues[k]!.t0)), t1: Math.max(...idx.map((k) => cues[k]!.w1)) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- 字模圖集
export interface GlyphReq { ch: string; family: string }

/**
 * 把一批字畫成一張白字的圖集（每格 cw × ch 貼圖像素，字置中）。shader 取 alpha 就是字的形狀。
 * ♥ 用我們自己畫的那顆（drawHeart），不用字型裡的。flipY = false：v 往下，跟 Canvas 一樣。
 * 太寬的字（英文 W、M、全形標點）水平壓進格子裡。
 */
export class GlyphAtlas {
  canvas = document.createElement('canvas');
  tex: THREE.CanvasTexture;
  cols = 1;
  rows = 1;
  private map = new Map<string, number>();

  /**
   * size：字級（貼圖像素，預設格高的 0.66）；fill：字最寬佔格寬幾成；shrink：太寬的字（英文單字）先縮字級、縮到一半還放不下才壓扁。
   */
  constructor(reqs: GlyphReq[], readonly cw = 96, readonly ch = 128, o: { size?: number; fill?: number; mip?: boolean; shrink?: boolean } = {}) {
    const uniq: GlyphReq[] = [];
    for (const r of reqs) {
      if (!r.ch.trim()) continue;
      const k = GlyphAtlas.key(r.family, r.ch);
      if (this.map.has(k)) continue;
      this.map.set(k, uniq.length);
      uniq.push(r);
    }
    const n = Math.max(1, uniq.length);
    this.cols = Math.max(1, Math.min(n, Math.floor(4096 / cw)));
    this.rows = Math.ceil(n / this.cols);
    this.canvas.width = this.cols * cw;
    this.canvas.height = this.rows * ch;
    const c = this.canvas.getContext('2d')!;
    const size = o.size ?? ch * 0.66;
    const maxW = cw * (o.fill ?? 0.9);
    c.fillStyle = '#fff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    uniq.forEach((r, i) => {
      const x = (i % this.cols) * cw + cw / 2, y = Math.floor(i / this.cols) * ch + ch / 2;
      if (r.ch === '♥') { drawHeart(c, x, y, size * 0.78, '#fff'); return; }
      let sz = size;
      c.font = font(r.family, sz);
      let w = c.measureText(r.ch).width;
      if (o.shrink && w > maxW) { sz = Math.max(size * 0.5, (size * maxW) / w); c.font = font(r.family, sz); w = c.measureText(r.ch).width; }
      c.save();
      c.translate(x, y + sz * 0.02);
      if (w > maxW) c.scale(maxW / w, 1);
      c.fillText(r.ch, 0, 0);
      c.restore();
    });
    const tex = new THREE.CanvasTexture(this.canvas);
    tex.colorSpace = THREE.NoColorSpace;
    tex.flipY = false;
    tex.generateMipmaps = !!o.mip;
    tex.minFilter = o.mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 4;
    this.tex = tex;
  }

  static key(family: string, ch: string) { return `${family}\u0001${ch}`; }
  /** 字在圖集裡的編號；空白或沒畫的字是 -1。 */
  get(family: string, ch: string): number { return this.map.get(GlyphAtlas.key(family, ch)) ?? -1; }
  /** 某字族在圖集裡的所有字（翻牌中途亂翻用）。 */
  ofFamily(family: string): number[] { const out: number[] = []; for (const [k, v] of this.map) if (k.startsWith(family + '\u0001')) out.push(v); return out; }
  dispose() { this.tex.dispose(); this.canvas.width = this.canvas.height = 0; }
}

/** GLSL：從圖集取字（gi < 0 是空白）。uv 在格子裡 0..1、v 往下。需要 uniform sampler2D uAtlas、vec2 uAG（欄數、列數）。 */
export const GLYPH_GLSL = /* glsl */ `
float glyphAt(float gi, vec2 uv) {
  if (gi < -0.5 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  vec2 cell = vec2(mod(gi, uAG.x), floor(gi / uAG.x + 1e-4));
  return texture(uAtlas, (cell + uv) / uAG).a;
}
float glyphAtBias(float gi, vec2 uv, float bias) {
  if (gi < -0.5 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  vec2 cell = vec2(mod(gi, uAG.x), floor(gi / uAG.x + 1e-4));
  return texture(uAtlas, (cell + uv) / uAG, bias).a;
}`;

// ---------------------------------------------------------------- 字的顏色（翻牌、滾輪共用的色碼）
/** 色碼：state 貼圖裡只放一個數字，shader 再換成色票（換主題時跟著變）。 */
export const COL = { NONE: 0, DIM: 1, BONE: 2, SIGNAL: 3, ASH: 4, ROSE: 5, EMBER: 6, GRAPHITE: 7 } as const;
/** 跟唱狀態 → 色碼（還沒唱三成、正在唱訊號色、唱完紙白）。愛心一律玫瑰色。 */
export const cueCol = (c: Cue, t: number) => (c.ch === '♥' ? COL.ROSE : [COL.DIM, COL.SIGNAL, COL.BONE][cueState(c, t)]!);

/** GLSL：色碼 → 線性色。DIM 約等於三成透明的紙白疊在深色牌上；SIGNAL 乘上去會發光。 */
export const CODE_GLSL = /* glsl */ `
vec3 codeCol(float k) {
  if (k < 0.5) return vec3(0.0);
  if (k < 1.5) return C_BONE * 0.13;
  if (k < 2.5) return C_BONE * 0.92;
  if (k < 3.5) return C_SIGNAL * 1.55;
  if (k < 4.5) return C_ASH * 0.62;
  if (k < 5.5) return C_ROSE;
  if (k < 6.5) return C_EMBER * 1.5;
  return C_GRAPHITE * 0.7;
}`;

// ---------------------------------------------------------------- 翻牌
/**
 * 一次翻牌：在 tl 時落定到字 g（色碼 c）。落定前先連翻 k 張亂數字牌（每翻 d 秒），所以整串從 tl - (k+1)·d 開始。
 * d = 0：不翻，時間到就直接換（只換顏色時用）。
 */
export interface Flip { tl: number; g: number; c: number; k?: number; d?: number; seg?: number }

/**
 * 整理一格的事件：一頁歌詞的「變色」事件（唱到、唱完）可能排在下一頁翻上來之後（兩句接得很緊時），
 * 那時候這格已經換成別的字了，不能再把舊字翻回來。事件標上 seg（第幾頁），一旦更新的一頁開始翻，舊頁的事件就丟掉。
 * 回傳依落定時間排好的事件。
 */
export function settle(evs: Flip[]): Flip[] {
  const start = (e: Flip) => ((e.d ?? 0.08) > 0 ? e.tl - ((e.k ?? 0) + 1) * (e.d ?? 0.08) : e.tl);
  const byStart = [...evs].sort((a, b) => start(a) - start(b) || a.tl - b.tl);
  let top = -Infinity;
  const out: Flip[] = [];
  for (const e of byStart) {
    if (e.seg !== undefined) { if (e.seg < top) continue; top = Math.max(top, e.seg); }
    out.push(e);
  }
  return out.sort((a, b) => a.tl - b.tl);
}
/**
 * 一格在 t 時：正在從 a 翻到 b（進度 ph 0..1），a、b 的色碼；since = 上次落定後過了幾秒（翻牌中是 -1，彈跳用），
 * pa、pc = 上次落定之前的字與色碼（落定後那一片還在彈的時候要畫它）。
 */
export interface FlipState { a: number; b: number; ph: number; ca: number; cb: number; since: number; pa: number; pc: number }

/**
 * 一格的翻牌序列在 t 時的狀態（純函數）。evs 依 tl 排好；前一次還沒落定，下一次就等它落定再開始翻。
 * 中途亂翻的字從 filler 裡用 hash 挑（每格、每次、每一翻都不一樣，但每次重畫都一樣）。
 */
export function flipAt(evs: Flip[], t: number, g0: number, c0: number, seed: number, filler: number[], fillerCol: number = COL.DIM): FlipState {
  let g = g0, c = c0, tPrev = -1e9, pa = g0, pc = c0;
  for (let e = 0; e < evs.length; e++) {
    const ev = evs[e]!;
    const k = ev.k ?? 0, d = ev.d ?? 0.08;
    if (d <= 0) {
      if (t < ev.tl) break;
      g = ev.g; c = ev.c;
      continue;
    }
    const ts = Math.max(ev.tl - (k + 1) * d, tPrev);
    if (t < ts) break;
    if (t >= ev.tl) { pa = g; pc = c; g = ev.g; c = ev.c; tPrev = ev.tl; continue; }
    const n = k + 1, dd = (ev.tl - ts) / n;
    const j = Math.min(n - 1, Math.floor((t - ts) / dd));
    const ph = Math.min(1, (t - ts) / dd - j);
    const pick = (m: number) => (m === 0 ? g : m === n ? ev.g : filler.length ? filler[Math.floor(hash(seed, e, m) * filler.length)]! : -1);
    const col = (m: number) => (m === 0 ? c : m === n ? ev.c : fillerCol);
    return { a: pick(j), b: pick(j + 1), ph, ca: col(j), cb: col(j + 1), since: -1, pa: g, pc: c };
  }
  return { a: g, b: g, ph: 0, ca: c, cb: c, since: t - tPrev, pa, pc };
}

// ---------------------------------------------------------------- 一行歌詞排成好幾列（以字／英文字為單位）
export interface WordBox { word: Word; x: number; y: number; w: number; row: number }
export interface WordRows { size: number; lineH: number; words: WordBox[]; rows: { y: number; w: number }[]; height: number }

const rowsCache = new WeakMap<Line, Map<string, WordRows>>();

/**
 * 在 maxW × maxH 的框裡找最大字級（min～max），把一行歌詞以詞為單位斷成最多 maxRows 列（列寬盡量平均），置中對齊。
 * 座標：框的左上角為 (0, 0)，y 是每列的基線。英文字之間的空白照原文量。同一行同參數會快取。
 */
export function layoutWordRows(c: CanvasRenderingContext2D, line: Line, family: string, maxW: number, maxH: number, o: { min?: number; max?: number; lh?: number; maxRows?: number } = {}): WordRows {
  const min = o.min ?? 48, max = o.max ?? 140, lh = o.lh ?? 1.16, maxRows = o.maxRows ?? 3;
  const key = `${family}|${maxW}|${maxH}|${min}|${max}|${lh}|${maxRows}`;
  let m = rowsCache.get(line);
  if (!m) { m = new Map(); rowsCache.set(line, m); }
  const hit = m.get(key);
  if (hit) return hit;
  const ws = line.words;
  const gapAfter = ws.map((w, i) => (ws[i + 1] ? line.text.slice(w.o + w.w.length, ws[i + 1]!.o) : ''));
  const measureAt = (size: number) => {
    c.font = font(family, size);
    return { wW: ws.map((w) => c.measureText(w.w).width), gW: gapAfter.map((g) => (g ? c.measureText(g).width : 0)) };
  };
  // 中文句子裡的空白是分句：盡量在空白處換列（不要把「這個」拆成兩列）
  const spaced = gapAfter.some((g) => /\s/.test(g)) && ws.some((w) => !/[A-Za-z]/.test(w.w));
  /**
   * 把字切成 k 列：每列不超過 limit，列寬越平均越好，不在空白處斷要扣分（中文句）。字數很少，直接動態規劃。
   * 回傳切法、最寬那一列、有幾處不是在空白斷的。
   */
  const partition = (wW: number[], gW: number[], k: number, limit: number, strict = false) => {
    const n = wW.length;
    const span = (a: number, b: number) => { let x = 0; for (let i = a; i < b; i++) x += wW[i]! + (i > a ? gW[i - 1]! : 0); return x; };
    const bad = (b: number) => (spaced && b < n && !/\s/.test(gapAfter[b - 1] ?? '') ? 1 : 0);
    const best: number[][] = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(Infinity));
    const cut: number[][] = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(0));
    best[0]![0] = 0;
    for (let r = 1; r <= k; r++) for (let b = 1; b <= n; b++) for (let a = r - 1; a < b; a++) {
      const w = span(a, b);
      if (w > limit + 0.5 || best[r - 1]![a] === Infinity || (strict && bad(b))) continue;
      const v = best[r - 1]![a]! + (limit - w) * (limit - w) + bad(b) * limit * limit * 0.5;
      if (v < best[r]![b]!) { best[r]![b] = v; cut[r]![b] = a; }
    }
    if (best[k]![n] === Infinity) return null;
    const rows: number[][] = [];
    let b = n, nBad = 0;
    for (let r = k; r >= 1; r--) { const a = cut[r]![b]!; rows.unshift(Array.from({ length: b - a }, (_, i) => a + i)); if (r < k) nBad += bad(b); b = a; }
    return { rows: rows.filter((x) => x.length), width: Math.max(...rows.map((x) => (x.length ? span(x[0]!, x[x.length - 1]! + 1) : 0))), nBad };
  };
  /** 固定 k 列時放得下的最大字級。 */
  const bestFor = (k: number, strict: boolean) => {
    const fits = (size: number) => {
      if (size * (1 + (k - 1) * lh) > maxH) return null;
      const { wW, gW } = measureAt(size);
      const p = partition(wW, gW, k, maxW, strict);
      return p ? { p, wW, gW } : null;
    };
    let lo = min, hi = max, got = fits(max), size = max;
    if (!got) {
      got = fits(min); size = min;
      if (!got) return null;
      for (let it = 0; it < 12; it++) { const mid = (lo + hi) / 2; const g = fits(mid); if (g) { got = g; size = mid; lo = mid; } else hi = mid; }
    }
    size = Math.floor(size);
    return { size, ...(fits(size) ?? got) };
  };
  // 每種列數各算一個最大字級，再挑：字越大越好、列數越少越好、在空白處斷的越好
  let pick: { size: number; p: { rows: number[][]; nBad: number }; wW: number[]; gW: number[] } | null = null, pickScore = -Infinity;
  // （每種列數各試兩次：只在空白處斷的最大字級、隨便斷的最大字級）
  for (let k = 1; k <= Math.min(maxRows, ws.length); k++) {
    for (const strict of spaced ? [true, false] : [false]) {
      const b = bestFor(k, strict);
      if (!b) continue;
      const score = b.size * (1 - 0.08 * (k - 1)) * (1 - 0.3 * b.p.nBad);
      if (score > pickScore) { pickScore = score; pick = b; }
    }
  }
  let size: number;
  if (!pick) {
    size = min;
    const { wW, gW } = measureAt(min);
    const k = Math.min(maxRows, ws.length);
    pick = { size, p: partition(wW, gW, k, 1e9)!, wW, gW };
  }
  size = pick.size;
  const got = pick;
  const r = { rows: got.p.rows, wW: got.wW, gW: got.gW };
  const lineH = size * lh, height = size * (1 + (r.rows.length - 1) * lh);
  const words: WordBox[] = [];
  const rows = r.rows.map((row, ri) => {
    const w = row.reduce((s, i, k) => s + r.wW[i]! + (k ? r.gW[i - 1]! : 0), 0);
    let x = (maxW - w) / 2;
    const y = (maxH - height) / 2 + size * 0.86 + ri * lineH;
    row.forEach((i, k) => { if (k) x += r.gW[i - 1]!; words.push({ word: ws[i]!, x, y, w: r.wW[i]!, row: ri }); x += r.wW[i]!; });
    return { y, w };
  });
  const out = { size, lineH, words, rows, height };
  m.set(key, out);
  return out;
}
