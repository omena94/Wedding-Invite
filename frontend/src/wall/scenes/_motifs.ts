// 版面共用的母題與「兩種聲音」，讓每個版面畫出來的規則一致（照 pdoom 的 _motifs.ts 的精神）：
//  - 火花（仙女棒）、愛心：engine/motifs.ts
//  - 歌詞的聲音：跟唱（karaoke）。規則照 pdoom：字在唱到的那一刻亮起、唱完才算完成；可以提早淡淡出現，
//    但反白不能跑在歌聲前面。正在唱的字用訊號色，唱完的變紙白，還沒唱的 30% 紙白。
//  - 留言的聲音：手寫（霞鶩文楷）或典雅（思源宋體），署名用「—— 名字」。
// 版面檔可以自由決定怎麼把這兩種聲音「放進畫面裡」（寫在證書上、沿著心電圖、變成星座…），
// 但字的時間與顏色規則用這裡的函式，整晚才一致。
import { Lyrics, lyricSubOf, type Line, type Word } from '../engine/lyrics';
export { lyricSubOf };
import type { AudioData } from '../engine/audio';
import { font } from '../engine/type';
import { rgba } from '../engine/palette';
import { fitText, type FitResult } from '../engine/text';
import { clamp } from '../engine/util';

export { sparkParticles, sparkHead, sparkHead2D, drawHeart, heartPoints, fillWithHearts } from '../engine/motifs';
import { fillWithHearts } from '../engine/motifs';
export { drawQR } from '../engine/qr';
// 新人名字、日期（每一場婚禮不一樣：可能很長、可能沒有英文名、可能還沒定日期），規則見 ../wedding.ts
export {
  COUPLE_EN, COUPLE_ZH, NAME_A, NAME_B, NAME_A_EN, NAME_B_EN, HAS_LATIN_NAMES, isLatin,
  INITIAL_A, INITIAL_B, INITIALS, DATE, WEDDING_DATE, DATE_DOTS, DATE_DOT, DATE_MMDD, DATE_ZH, joinBits, fitPx,
} from '../wedding';

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
export interface LyricLayout {
  size: number; rows: { text: string; x: number; y: number; width: number }[]; words: PlacedWord[];
  /** 第一排頂到最後一排基線的高度；有原文副行時算到副行最後一排的基線（版面照舊用它置中或貼底，副行就在框裡）。 */
  height: number;
  /** 原文副行（韓文歌）：自己的排版，dy = 副行第一排基線離主行第一排基線多遠。drawLyric 會畫，版面不用管。 */
  sub?: { lay: LyricLayout; dy: number };
}

// ---- 原文副行（韓文歌的原文：中文是主角、大字，原文小一號放在正下方，賓客兩種都看得到）
/** 副行字級：主行的 0.6 倍，32～56 px（會場後排也要認得出來，也不能大到搶中文）。 */
export const subSizeFor = (size: number) => Math.round(clamp(size * 0.6, 32, 56));
/** 主行最後一排基線到副行第一排基線的距離：主行下緣留約四分之一字高的空，再加副行的字高。 */
export const subGap = (size: number, subSize = subSizeFor(size)) => size * 0.37 + subSize * 0.88;
/** 副行的排版樣式：跟主行同字族、同對齊、同寬，字小一號。 */
export function subStyleFor(st: LyricStyle, size = st.size): LyricStyle {
  const s = subSizeFor(size);
  return { ...st, size: s, minSize: Math.min(s, 26), tracking: (st.tracking ?? 0) * 0.5 };
}

const layoutCache = new WeakMap<Line, Map<string, LyricLayout>>();

/**
 * 排一行歌詞：先縮字級到放得下 maxWidth；縮到 minSize 還放不下就在中間附近的字之間折成兩行。
 * 回傳每個字的位置（相對 (0,0) = 第一行基線的「對齊點」）。同一行同樣式的結果會快取。
 */
export function layoutLyric(c: CanvasRenderingContext2D, line: Line, st: LyricStyle): LyricLayout {
  const sub = lyricSubOf(line);
  const key = `${st.family}|${st.size}|${st.minSize}|${st.maxWidth}|${st.align}|${st.tracking}|${st.lineHeight}`;
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
  if (sub) {
    // 副行跟著主行縮：主行縮到多小，副行就照那個字級的比例
    const lay = layoutLyric(c, sub, subStyleFor(st, size));
    const dy = (rows.length - 1) * lh + subGap(size, lay.size);
    out.sub = { lay, dy };
    out.height = dy + (lay.height - lay.size) + size;
  }
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
  const head = paintWords(c, lay, t, st, alpha, st.active ?? rgba('signal'), st.sung ?? rgba('bone', 0.96));
  if (lay.sub) {
    c.save();
    c.translate(0, lay.sub.dy);
    drawSubWords(c, lay.sub.lay, t, subStyleFor(st, lay.size), alpha);
    c.restore();
  }
  return head;
}

/**
 * 副行（原文）的畫法（st 是 subStyleFor 的副行樣式：字距要跟排版時一樣，不然字會疊在一起、唱完的字被 clip 切掉尾巴）：比主行安靜——正在唱與唱完都用「唱完」的顏色（不用訊號色，不跟中文搶），整體再淡一點；
 * 還沒唱的跟主行一樣三成。逐字時間是原文自己的，所以原文跟著真正的歌聲亮。
 */
function drawSubWords(c: CanvasRenderingContext2D, lay: LyricLayout, t: number, st: LyricStyle, alpha: number) {
  const sung = st.sung ?? rgba('bone', 0.96);
  paintWords(c, lay, t, st, alpha, sung, sung, 0.8);
}

/** 逐字反白：還沒唱的淡字，唱到的部分用 clip 蓋上亮字。回傳正在唱的字的筆尖位置。 */
function paintWords(c: CanvasRenderingContext2D, lay: LyricLayout, t: number, st: LyricStyle, alpha: number, active: string, sung: string, litAlpha = 1): { x: number; y: number } | null {
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
    c.globalAlpha = alpha * litAlpha;
    c.fillStyle = p < 1 ? active : sung;
    c.fillText(pw.word.w, pw.x, pw.y);
    c.restore();
    if (p < 1) head = { x: pw.x + pw.w * p, y: pw.y + lay.size * 0.12 };
  }
  c.restore();
  return head;
}

/**
 * 自己畫歌詞的版面用：在目前的原點（已經 translate 到副行第一排基線的對齊點）畫原文副行。
 * `st` 傳主行的樣式（字族、對齊、寬、顏色），`mainSize` 傳主行實際排出來的字級；回傳副行的排版（height 給版面算位置）。
 * 典型用法：`const sub = lyricSubOf(line); if (sub) { c.translate(x, 主行最後一排基線 + subGap(主行字級)); drawLyricSub(c, sub, t, st, 主行字級); }`
 */
export function drawLyricSub(c: CanvasRenderingContext2D, sub: Line, t: number, st: LyricStyle, mainSize = st.size, alpha = 1): LyricLayout {
  const sst = subStyleFor(st, mainSize);
  const lay = layoutLyric(c, sub, sst);
  drawSubWords(c, lay, t, sst, alpha);
  return lay;
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
