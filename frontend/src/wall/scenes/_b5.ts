// 批次 B5（雙語・光與物件：stringlights、povfan、skywriting、fireflies、riverlanterns、lasershow）共用的小工具。
// 六個版面都是「一個字一個東西」：一顆燈泡、LED 扇上的一格、一團煙、一群螢火蟲、一盞河燈、一筆雷射。
// 所以共用的是把一行雙語歌詞拆成「一個字一個位置、一個時間」：
//  - 中文主行與原文副行各自排版（字級照 v2：主行 40～52、副行 ≥ 30、約主行的 0.65～0.75），
//    每個字記下它在畫面上的位置、寬、所屬的 Word，逐字時間用那個 Word 的時間在字之間內插
//    （翻譯 LRC 常常一段好幾個字才一個時間，照段落的進度一個字一個字亮）。
//  - 沒有翻譯的歌只有主行，副行是空的（版面把原文那一格收起來）。
import type { Line, Word } from '../engine/lyrics';
import { Lyrics, lyricSubOf } from '../engine/lyrics';
import { font } from '../engine/type';
import { clamp } from '../engine/util';
import { COUPLE_ZH, DATE_DOTS } from './_motifs';
import { V2 } from './_v2';

/** 沒有留言時的邀請（整批一致，小字）。 */
export const B5_INVITE = '掃描右下角 QR code，把你的祝福傳上大螢幕';
/** 這批固定會出現的字（init 時一次載好：數字、符號也要，沒載好第一格會用系統字頂替）。 */
export const B5_TEXT = `${B5_INVITE}一位賓客${COUPLE_ZH}${DATE_DOTS}新人0123456789·—…：:%♪=()（）＊♥`;

/** 右下角 HUD（QR 與小字）：字不要進到 x ≥ 1360 且 y ≥ 830。 */
export const HUD = { x: 1360, y: 830 };

/** 原文副行的字級（螢幕 px）：主行的 0.68 倍，至少 30（會場後排也要認得出來），不超過主行的 0.75。 */
export const subPx = (mainPx: number) => Math.round(clamp(mainPx * 0.68, 30, mainPx * 0.75 + 0.5));

/** 一個字：畫面上的位置（基線左端）、寬、字級、屬於哪個 Word、在那個 Word 裡是第幾個字（逐字時間內插用）。 */
export interface BGlyph { ch: string; x: number; y: number; w: number; size: number; word: Word; k: number; n: number; row: number; sub: boolean }

/** 字唱到哪裡（0..1）：Word 的進度在 Word 裡的字之間平均分（空白不算）。 */
export function glyphProgress(g: BGlyph, t: number): number {
  const p = Lyrics.wordProgress(g.word, t);
  return clamp(p * g.n - g.k);
}

/** 字開始唱、唱完的時間（跟 glyphProgress 一致）。 */
export function glyphTimes(g: BGlyph): [number, number] {
  const d = (g.word.end - g.word.start) / g.n;
  return [g.word.start + d * g.k, g.word.start + d * (g.k + 1)];
}

export interface BRow { text: string; x: number; y: number; w: number; size: number; sub: boolean }
export interface BLayout {
  main: BGlyph[];
  sub: BGlyph[];
  rows: BRow[];
  mainSize: number;
  subSize: number;
  /** 整塊（主行第一排的字頂到副行最後一排的字底）的外框。 */
  box: [number, number, number, number];
}

/**
 * 把一行（與它的原文）拆成字：主行在 (x, y) 對齊（y = 主行第一排基線），寬 maxW 以內；放不下先縮到 minSize，再折兩排。
 * 副行在主行最後一排下面 gap（預設主行字級的 0.4 倍 + 副行字級）。
 * c：量字寬的畫布（字族、字級會被改掉）。letter：字距（螢幕 px）。
 */
export function layBilingual(c: CanvasRenderingContext2D, line: Line, o: {
  family: string; subFamily?: string; size: number; minSize?: number; maxW: number; x: number; y: number;
  align?: 'left' | 'center'; lineHeight?: number; subSize?: number; gap?: number; letter?: number; subLetter?: number; maxRows?: number;
}): BLayout {
  const align = o.align ?? 'center';
  const main = splitRows(c, line, o.family, o.size, o.minSize ?? V2.lyrMin, o.maxW, o.letter ?? 0, o.maxRows ?? 2);
  const lh = main.size * (o.lineHeight ?? 1.22);
  const out: BLayout = { main: [], sub: [], rows: [], mainSize: main.size, subSize: 0, box: [0, 0, 0, 0] };
  const place = (rows: RowPlan[], size: number, y0: number, sub: boolean, rowH: number) => {
    rows.forEach((r, ri) => {
      const x0 = align === 'center' ? o.x - r.w / 2 : o.x;
      const y = y0 + ri * rowH;
      out.rows.push({ text: r.text, x: x0, y, w: r.w, size, sub });
      for (const g of r.glyphs) (sub ? out.sub : out.main).push({ ...g, x: x0 + g.x, y, size, row: ri, sub });
    });
  };
  place(main.rows, main.size, o.y, false, lh);
  let bottom = o.y + (main.rows.length - 1) * lh + main.size * 0.2;
  const subLine = lyricSubOf(line);
  if (subLine) {
    const want = o.subSize ?? subPx(main.size);
    const sub = splitRows(c, subLine, o.subFamily ?? o.family, want, Math.min(want, 30), o.maxW, o.subLetter ?? 0, 2);
    out.subSize = sub.size;
    const y1 = o.y + (main.rows.length - 1) * lh + (o.gap ?? main.size * 0.4 + sub.size);
    place(sub.rows, sub.size, y1, true, sub.size * 1.25);
    bottom = y1 + (sub.rows.length - 1) * sub.size * 1.25 + sub.size * 0.2;
  }
  const xs = out.rows.map((r) => r.x), xe = out.rows.map((r) => r.x + r.w);
  const x0 = Math.min(...xs), x1 = Math.max(...xe), top = o.y - main.size * 0.88;
  out.box = [x0, top, x1 - x0, bottom - top];
  return out;
}

interface RowPlan { text: string; w: number; glyphs: Omit<BGlyph, 'y' | 'size' | 'row' | 'sub'>[] }

/** 一行拆成一排或兩排（在最接近中間的 Word 之間折），回傳每排的字與相對位置。 */
function splitRows(c: CanvasRenderingContext2D, line: Line, family: string, size0: number, minSize: number, maxW: number, letter: number, maxRows: number): { size: number; rows: RowPlan[] } {
  const widthAt = (s: string, size: number) => { c.font = font(family, size); c.letterSpacing = `${letter}px`; const w = c.measureText(s).width; c.letterSpacing = '0px'; return w; };
  let size = size0;
  const full = widthAt(line.text.trim(), size);
  if (full > maxW) size = Math.max(minSize, (size * maxW) / full);
  let cuts = [0, line.words.length];
  if (widthAt(line.text.trim(), size) > maxW && line.words.length > 1 && maxRows > 1) {
    let best = 1, bestD = Infinity;
    for (let k = 1; k < line.words.length; k++) {
      const a = line.text.slice(0, line.words[k]!.o).trim(), b = line.text.slice(line.words[k]!.o).trim();
      const d = Math.max(widthAt(a, size), widthAt(b, size));
      if (d < bestD) { bestD = d; best = k; }
    }
    cuts = [0, best, line.words.length];
    const worst = Math.max(...[0, 1].map((i) => widthAt(rowText(line, cuts[i]!, cuts[i + 1]!), size)));
    if (worst > maxW) size = (size * maxW) / worst;
  } else if (widthAt(line.text.trim(), size) > maxW) size = (size * maxW) / widthAt(line.text.trim(), size);
  const rows: RowPlan[] = [];
  for (let r = 0; r + 1 < cuts.length; r++) {
    const a = cuts[r]!, b = cuts[r + 1]!;
    const text = rowText(line, a, b);
    const base = line.words[a]!.o;
    const lead = line.text.slice(base).length - line.text.slice(base).trimStart().length;
    const glyphs: RowPlan['glyphs'] = [];
    for (let wi = a; wi < b; wi++) {
      const w = line.words[wi]!;
      const chars = Array.from(w.w);
      const n = chars.filter((ch) => ch.trim()).length || 1;
      let pre = line.text.slice(base + lead, w.o), k = 0;
      for (const ch of chars) {
        if (ch.trim()) {
          glyphs.push({ ch, x: pre ? widthAt(pre, size) : 0, w: widthAt(ch, size), word: w, k, n });
          k++;
        }
        pre += ch;
      }
    }
    rows.push({ text, w: widthAt(text, size), glyphs });
  }
  return { size, rows };
}

function rowText(line: Line, from: number, to: number) {
  const a = line.words[from]!.o, lw = line.words[to - 1]!;
  return line.text.slice(a, lw.o + lw.w.length).trim();
}

/** 一行拆成一格一格（一個字一格；空白也佔一格、ch 是空字串）：燈泡、河燈、LED 格這種「一個字一個東西」的版面用。 */
export interface BSlot { ch: string; word: Word; k: number; n: number }
export function lineSlots(line: Line): BSlot[] {
  const out: BSlot[] = [];
  let prevEnd = -1;
  for (const w of line.words) {
    // Word 之間原文有空白（英文、韓文的詞）：空一格
    if (prevEnd >= 0 && w.o > prevEnd && /\s/.test(line.text.slice(prevEnd, w.o))) out.push({ ch: '', word: w, k: 0, n: 1 });
    const chars = Array.from(w.w);
    const n = chars.filter((ch) => ch.trim()).length || 1;
    let k = 0, sp = false;
    for (const ch of chars) {
      if (!ch.trim()) { if (!sp && k > 0) out.push({ ch: '', word: w, k, n }); sp = true; continue; }
      sp = false;
      out.push({ ch, word: w, k, n });
      k++;
    }
    prevEnd = w.o + w.w.length;
  }
  while (out.length && !out[out.length - 1]!.ch) out.pop();
  return out;
}

/** 格子唱到哪裡（0..1），空白格是 0。 */
export function slotProgress(s: BSlot, t: number): number {
  if (!s.ch) return 0;
  return clamp(Lyrics.wordProgress(s.word, t) * s.n - s.k);
}

/**
 * 一串格子折成最多 rows 排，每排最多 cap 格：在最接近中間的空白格（沒有空白就在 Word 之間）折；
 * 折完還放不下就回傳 null（版面縮字級、加寬再試）。
 */
export function wrapSlots(slots: BSlot[], cap: number, rows: number): BSlot[][] | null {
  if (slots.length <= cap) return [slots];
  if (rows < 2) return null;
  let best = -1, bestD = Infinity;
  for (let i = 1; i < slots.length; i++) {
    const brk = !slots[i]!.ch || !slots[i - 1]!.ch || slots[i]!.word !== slots[i - 1]!.word;
    if (!brk) continue;
    const a = slots.slice(0, i), b = slots.slice(i).filter((x, j) => j > 0 || x.ch);
    const d = Math.max(a.length, b.length) + (slots[i]!.ch ? 0.5 : 0);
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best < 0) return null;
  const a = slots.slice(0, best).filter((x, j, arr) => j < arr.length - 1 || x.ch);
  const b = slots.slice(best).filter((x, j) => j > 0 || x.ch);
  if (a.length > cap || b.length > cap) return null;
  return [a, b];
}
