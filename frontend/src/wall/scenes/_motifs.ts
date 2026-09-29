// 版面共用的母題與「兩種聲音」，讓每個版面畫出來的規則一致（照 pdoom 的 _motifs.ts 的精神）：
//  - 火花（仙女棒）、愛心：engine/motifs.ts
//  - 歌詞的聲音：跟唱（karaoke）。規則照 pdoom：字在唱到的那一刻亮起、唱完才算完成；可以提早淡淡出現，
//    但反白不能跑在歌聲前面。正在唱的字用訊號色，唱完的變紙白，還沒唱的 30% 紙白。
//  - 留言的聲音：手寫（霞鶩文楷）或典雅（思源宋體），署名用「—— 名字」。
// 版面檔可以自由決定怎麼把這兩種聲音「放進畫面裡」（寫在證書上、沿著心電圖、變成星座…），
// 但字的時間與顏色規則用這裡的函式，整晚才一致。
import { Lyrics, type Line, type Word } from '../engine/lyrics';
import type { AudioData } from '../engine/audio';
import { font } from '../engine/type';
import { rgba } from '../engine/palette';
import { fitText, type FitResult } from '../engine/text';
import { clamp } from '../engine/util';
import { COUPLE_EN, COUPLE_ZH, WEDDING_DATE } from '../../constants.js';

export { sparkParticles, sparkHead, sparkHead2D, drawHeart, heartPoints, fillWithHearts } from '../engine/motifs';
import { fillWithHearts } from '../engine/motifs';
export { drawQR } from '../engine/qr';
export { COUPLE_EN, COUPLE_ZH, WEDDING_DATE };
/** 2027 · 03 · 13 */
export const DATE_DOTS = String(WEDDING_DATE).split('-').join(' · ');

// ---------------------------------------------------------------- 節拍
/**
 * t 之後（含）的第 k 拍（k=0 就是下一個拍點）。**t 剛好在拍點上時算「這一拍」**：beatAfter(au, 拍點, 2) 是兩拍之後。
 * 要「這一拍的下一拍」用 k=1，不要寫 t + 0.01（那會先跳到下一拍再加 k，多算一拍）。
 * 前奏、結尾在節拍網格外的地方也一樣準（audio.ts 的 beatAt／timeOfBeat 用同一個週期外插）。
 */
export const beatAfter = (au: AudioData, t: number, k = 0) => au.timeOfBeat(Math.ceil(au.beatAt(t) - 1e-6) + k);
/** t 之後（含）的第 k 個小節線。 */
export const barAfter = (au: AudioData, t: number, k = 0) => au.timeOfBar(Math.ceil(au.barAt(t) - 1e-6) + k);

// ---------------------------------------------------------------- 歌詞的聲音
export interface LyricStyle {
  family: string;
  size: number;
  /** 最小字級：縮到這裡還放不下就折成兩行。 */
  minSize?: number;
  maxWidth: number;
  align?: 'left' | 'center' | 'right';
  tracking?: number;
  /** 正在唱的字、唱完的字、還沒唱的字的顏色。 */
  active?: string;
  sung?: string;
  unsung?: string;
  lineHeight?: number;
}

export interface PlacedWord { word: Word; x: number; y: number; w: number }
export interface LyricLayout { size: number; rows: { text: string; x: number; y: number; width: number }[]; words: PlacedWord[]; height: number }

const layoutCache = new WeakMap<Line, Map<string, LyricLayout>>();

/**
 * 排一行歌詞：先縮字級到放得下 maxWidth；縮到 minSize 還放不下就在中間附近的字之間折成兩行。
 * 回傳每個字的位置（相對 (0,0) = 第一行基線的「對齊點」）。同一行同樣式的結果會快取。
 */
export function layoutLyric(c: CanvasRenderingContext2D, line: Line, st: LyricStyle): LyricLayout {
  const key = `${st.family}|${st.size}|${st.minSize}|${st.maxWidth}|${st.align}|${st.tracking}`;
  let m = layoutCache.get(line);
  if (!m) { m = new Map(); layoutCache.set(line, m); }
  const hit = m.get(key);
  if (hit) return hit;
  const tr = st.tracking ?? 0;
  const widthAt = (s: string, size: number) => { c.font = font(st.family, size); c.letterSpacing = `${tr}px`; const w = c.measureText(s).width; c.letterSpacing = '0px'; return w; };
  let size = st.size;
  const full = widthAt(line.text, size);
  if (full > st.maxWidth) size = Math.max(st.minSize ?? st.size * 0.6, (size * st.maxWidth) / full);
  // 還是放不下：在最接近中間的字之間折兩行
  let rows: { from: number; to: number }[] = [{ from: 0, to: line.words.length }];
  if (widthAt(line.text, size) > st.maxWidth && line.words.length > 1) {
    let best = 1, bestD = Infinity;
    for (let k = 1; k < line.words.length; k++) {
      const a = line.text.slice(0, line.words[k]!.o).trim(), b = line.text.slice(line.words[k]!.o).trim();
      const d = Math.max(widthAt(a, size), widthAt(b, size));
      if (d < bestD) { bestD = d; best = k; }
    }
    rows = [{ from: 0, to: best }, { from: best, to: line.words.length }];
    const worst = Math.max(...rows.map((r) => widthAt(rowText(line, r.from, r.to), size)));
    if (worst > st.maxWidth) size = (size * st.maxWidth) / worst;
  }
  const lh = size * (st.lineHeight ?? 1.18);
  const out: LyricLayout = { size, rows: [], words: [], height: size + (rows.length - 1) * lh };
  rows.forEach((r, ri) => {
    const text = rowText(line, r.from, r.to);
    const width = widthAt(text, size);
    const x0 = st.align === 'center' ? -width / 2 : st.align === 'right' ? -width : 0;
    const y = ri * lh;
    out.rows.push({ text, x: x0, y, width });
    const base = line.words[r.from]!.o;
    for (let k = r.from; k < r.to; k++) {
      const w = line.words[k]!;
      // 字的 x：量整行從頭到這個字前面的寬度（中英混排、字距都算進去）
      const pre = line.text.slice(base, w.o);
      out.words.push({ word: w, x: x0 + (pre ? widthAt(pre, size) + (pre.length ? tr : 0) : 0), y, w: widthAt(w.w, size) });
    }
  });
  m.set(key, out);
  return out;
}

function rowText(line: Line, from: number, to: number) {
  const a = line.words[from]!.o, lw = line.words[to - 1]!;
  return line.text.slice(a, lw.o + lw.w.length);
}

/**
 * 畫一行跟唱的歌詞（已經 translate 到對齊點）。回傳正在唱的字的「筆尖」位置（給火花用），沒在唱是 null。
 * `alpha` 讓版面做進出場。
 */
export function drawLyric(c: CanvasRenderingContext2D, line: Line, t: number, st: LyricStyle, lay = layoutLyric(c, line, st), alpha = 1): { x: number; y: number } | null {
  c.save();
  c.font = font(st.family, lay.size);
  c.letterSpacing = `${st.tracking ?? 0}px`;
  c.textBaseline = 'alphabetic';
  let head: { x: number; y: number } | null = null;
  for (const pw of lay.words) {
    const p = Lyrics.wordProgress(pw.word, t);
    c.globalAlpha = alpha;
    c.fillStyle = st.unsung ?? rgba('bone', 0.3);
    if (p < 1) c.fillText(pw.word.w, pw.x, pw.y);
    if (p <= 0) continue;
    c.save();
    c.beginPath();
    c.rect(pw.x - lay.size * 0.1, pw.y - lay.size * 1.1, (pw.w + lay.size * 0.2) * p, lay.size * 1.5);
    c.clip();
    c.fillStyle = p < 1 ? (st.active ?? rgba('signal')) : (st.sung ?? rgba('bone', 0.96));
    c.fillText(pw.word.w, pw.x, pw.y);
    c.restore();
    if (p < 1) head = { x: pw.x + pw.w * p, y: pw.y + lay.size * 0.12 };
  }
  c.restore();
  return head;
}

/** 這一格要顯示的歌詞行與它的進出場係數（0..1）：提早 0.35 秒淡入、唱完停 1.2 秒再淡出。 */
export function lyricAt(lyrics: Lyrics, t: number, hold = 1.2, lead = 0.35): { line: Line; k: number } | null {
  const line = lyrics.shownLine(t, hold, lead);
  if (!line) return null;
  const kin = clamp((t - (line.start - lead)) / lead);
  const kout = 1 - clamp((t - line.end - hold * 0.5) / (hold * 0.5));
  return { line, k: Math.min(kin, kout) };
}

// ---------------------------------------------------------------- 留言的聲音
/** 在 w×h 的框裡排好一則留言（找最大字級、平衡斷行）。 */
export function layoutMessage(c: CanvasRenderingContext2D, text: string, family: string, w: number, h: number, o: { min?: number; max?: number; lineHeight?: number; maxLines?: number } = {}): FitResult {
  return fitText(c, text, family, w, h, { min: 28, max: 150, lineHeight: 1.32, ...o });
}

/**
 * 畫排好的留言。`chars`：已經出現幾個字（逐字出現用；Infinity = 全部），`align` 對齊。
 * 回傳最後一個出現的字的位置（給筆尖／火花用）。
 */
export function drawMessage(c: CanvasRenderingContext2D, fit: FitResult, family: string, x: number, y: number, o: { align?: 'left' | 'center' | 'right'; color?: string; chars?: number } = {}): { x: number; y: number } | null {
  c.save();
  c.font = font(family, fit.size);
  c.textBaseline = 'alphabetic';
  c.fillStyle = o.color ?? rgba('bone');
  let left = o.chars ?? Infinity, head: { x: number; y: number } | null = null;
  fit.lines.forEach((ln, i) => {
    if (left <= 0) return;
    const chars = Array.from(ln);
    const shown = left >= chars.length ? ln : chars.slice(0, Math.floor(left)).join('');
    left -= chars.length;
    const wFull = c.measureText(ln).width;
    const lx = o.align === 'center' ? x - wFull / 2 : o.align === 'right' ? x - wFull : x;
    const ly = y + i * fit.lineHeight;
    fillWithHearts(c, shown, lx, ly);
    head = { x: lx + c.measureText(shown).width, y: ly - fit.size * 0.35 };
  });
  c.restore();
  return head;
}

/** 署名：「—— 小明」；沒填名字就「—— 一位賓客」。 */
export const signature = (name: string) => `—— ${name || '一位賓客'}`;

/** 一段留言共有幾個字（逐字出現的總數）。 */
export const msgChars = (fit: FitResult) => fit.lines.reduce((s, l) => s + Array.from(l).length, 0);

/**
 * 有主打留言時歌詞的字級（MV 融合原則：留言是焦點，歌詞小一級但仍 ≥ 48 px）。
 * msgSize：留言排出來的字級；沒有留言傳 null，歌詞當主角用 solo。
 */
export function lyricSizeFor(msgSize: number | null, solo = 64): number {
  return msgSize === null ? solo : Math.max(48, Math.min(56, Math.round(msgSize * 0.7)));
}
