// 留言與歌詞的文字處理：清理、斷行（中文禁則、英文不拆字）、在框裡找最大字級、切成詞組。
// pdoom 只有英文歌詞，斷行交給排版者；大螢幕的留言是賓客隨手打的，長短、中英混雜都有，版面要能自動排好。
import { font } from './type';

// ---------------------------------------------------------------- 清理
// 愛心 emoji 統一換成 ♥（用符號字型畫，顏色跟著版面走）；其他 emoji 拿掉：
// 彩色 emoji 在這種版畫風格裡會很突兀（pdoom 的規則：不用 emoji），但愛心是婚禮的主角，留下來。
const HEART_EMOJI = /(?:❤️|❤|♥️|♥|♡|💕|💖|💗|💓|💞|💘|💝|💟|❣️|❣|💌|😍|🥰|😘|😻|💑|💏|🫶|🤍|🧡|💛|💚|💙|💜|🤎|🖤|🩷|🩵|🩶|💒|👩‍❤️‍👨|👨‍❤️‍👨|👩‍❤️‍👩)(?:\u{1F3FB}|\u{1F3FC}|\u{1F3FD}|\u{1F3FE}|\u{1F3FF})?/gu;
const OTHER_EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}‍︎️⃣]/gu;

/** 螢幕用的留言文字。清完什麼都不剩（整則都是 emoji）就回傳一顆愛心。 */
export function cleanMessage(raw: string): string {
  let s = (raw ?? '').normalize('NFC');
  // ♥ 本身也算 emoji（Extended_Pictographic），先換成私用字元保護起來，清完其他 emoji 再換回來
  s = s.replace(HEART_EMOJI, '').replace(OTHER_EMOJI, '').replace(//g, '♥');
  s = s.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  // 連續好多顆愛心收成三顆就好
  s = s.replace(/♥(?:\s*♥){3,}/g, '♥♥♥');
  return s || '♥';
}

/** 名字：清掉 emoji 與多餘空白（沒填就是空字串）。 */
export function cleanName(raw: string): string {
  return (raw ?? '').normalize('NFC').replace(HEART_EMOJI, '').replace(OTHER_EMOJI, '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------- 斷行
/** 不能放在行首的字（標點、右括號、長音…）。 */
const NO_START = new Set(Array.from('、。，．,.!?！？：；:;）)」』】〕〉》…～~ー・%％”’"\'♥ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ'));
/** 不能放在行尾的字（左括號、左引號）。 */
const NO_END = new Set(Array.from('（(「『【〔〈《“‘'));

const isWordChar = (ch: string) => /[\p{Script=Latin}\p{N}'’\-&@#+]/u.test(ch);
const isHangul = (ch: string) => /\p{Script=Hangul}/u.test(ch);

/**
 * 把文字切成「不能再拆」的單位：英文字（連同後面的空白）、韓文一個詞、中文一個字；
 * 標點黏在前一個單位後面（才不會跑到行首）。
 */
export function tokens(text: string): string[] {
  const chars = Array.from(text), n = chars.length;
  const out: string[] = [];
  let i = 0;
  while (i < n) {
    const ch = chars[i]!;
    let tok = ch;
    i++;
    if (isWordChar(ch)) while (i < n && isWordChar(chars[i]!)) tok += chars[i++];
    else if (isHangul(ch)) while (i < n && isHangul(chars[i]!)) tok += chars[i++];
    // 後面的空白與不能放行首的標點都黏上來
    while (i < n && (chars[i] === ' ' || NO_START.has(chars[i]!))) tok += chars[i++];
    out.push(tok);
  }
  // 以左括號、左引號結尾的單位黏到下一個單位（它們不能留在行尾）
  for (let k = 0; k < out.length - 1; k++) {
    const last = Array.from(out[k]!.trimEnd()).pop();
    if (last && NO_END.has(last)) { out[k] += out[k + 1]!; out.splice(k + 1, 1); k--; }
  }
  return out;
}

/** 貪婪斷行：每行不超過 maxWidth（用 c 目前的 font 量）。單一單位比 maxWidth 還寬就自己一行。 */
export function wrapGreedy(c: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const toks = tokens(text);
  const lines: string[] = [];
  let cur = '';
  for (const tk of toks) {
    const next = cur + tk;
    if (cur && c.measureText(next.trimEnd()).width > maxWidth) { lines.push(cur.trimEnd()); cur = tk.trimStart(); }
    else cur = next;
  }
  if (cur.trim()) lines.push(cur.trimEnd());
  return lines.length ? lines : [''];
}

/**
 * 斷行並「平衡」：行數跟貪婪斷行一樣，但把每行的寬度拉平（避免最後一行只剩一個字）。
 */
export function wrap(c: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const greedy = wrapGreedy(c, text, maxWidth);
  if (greedy.length <= 1) return greedy;
  let lo = c.measureText(text).width / greedy.length, hi = maxWidth;
  let best = greedy;
  for (let k = 0; k < 14; k++) {
    const mid = (lo + hi) / 2;
    const w = wrapGreedy(c, text, mid);
    if (w.length <= greedy.length) { best = w; hi = mid; } else lo = mid;
  }
  return best;
}

export interface FitResult { size: number; lines: string[]; lineHeight: number; width: number; height: number }

/**
 * 在 w × h 的框裡找最大字級（min～max 之間），回傳斷好的行。
 * `lineHeight` 是字級的倍數；`maxLines` 限制行數（字級會縮到放得下為止）。
 */
export function fitText(c: CanvasRenderingContext2D, text: string, family: string, w: number, h: number, o: { min?: number; max?: number; lineHeight?: number; maxLines?: number } = {}): FitResult {
  const min = o.min ?? 20, max = o.max ?? 200, lh = o.lineHeight ?? 1.3, maxLines = o.maxLines ?? 99;
  const tryAt = (size: number) => {
    c.font = font(family, size);
    const lines = wrap(c, text, w);
    const width = Math.max(...lines.map((l) => c.measureText(l).width));
    const height = size * (1 + (lines.length - 1) * lh);
    return { size, lines, lineHeight: size * lh, width, height, ok: lines.length <= maxLines && height <= h && width <= w * 1.001 };
  };
  let lo = min, hi = max, best = tryAt(min);
  for (let k = 0; k < 12; k++) {
    const mid = (lo + hi) / 2;
    const r = tryAt(mid);
    if (r.ok) { best = r; lo = mid; } else hi = mid;
  }
  const r = tryAt(Math.floor(best.ok ? best.size : min));
  return { size: r.size, lines: r.lines, lineHeight: r.lineHeight, width: r.width, height: r.height };
}

// ---------------------------------------------------------------- 詞組
let segmenter: Intl.Segmenter | null = null;

/**
 * 把一句話切成幾個短詞組（大字重擊一拍一組用）。用瀏覽器內建的中文斷詞（Intl.Segmenter），
 * 再把詞黏成不超過 maxLen 個字的組；標點處一定斷開，標點本身黏在前一組。
 */
export function phrases(text: string, maxLen = 5): string[] {
  if (!segmenter) segmenter = new Intl.Segmenter('zh-Hant', { granularity: 'word' });
  const words = Array.from(segmenter.segment(text), (s) => s.segment);
  const out: string[] = [];
  let cur = '';
  const len = (s: string) => Array.from(s.replace(/\s/g, '')).length;
  const flush = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
  for (const w of words) {
    // 標點與空白：黏在目前這組後面；句讀處一定斷開
    if (!/[\p{L}\p{N}♥]/u.test(w)) {
      cur += w.trim() ? w : ' ';
      if (/[，。！？!?,.、~～…]/.test(w)) flush();
      continue;
    }
    if (cur.trim() && len(cur) + len(w) > maxLen) flush();
    // 一個中文詞就超過 maxLen：照字數硬切（英文字不拆）
    if (len(w) > maxLen && !/\p{Script=Latin}/u.test(w)) {
      const cs = Array.from(w);
      for (let i = 0; i < cs.length; i += maxLen) {
        cur += cs.slice(i, i + maxLen).join('');
        if (i + maxLen < cs.length) flush();
      }
      continue;
    }
    cur += w;
  }
  flush();
  // 標點開頭的組併回前一組
  for (let i = 1; i < out.length; i++) if (NO_START.has(Array.from(out[i]!)[0]!)) { out[i - 1] += out[i]; out.splice(i, 1); i--; }
  return out.length ? out : [text];
}

/** 一段文字的「字」數（中文一字、英文一個字母都算一；愛心也算）。用來估閱讀時間。 */
export function charCount(text: string): number {
  return Array.from(text.replace(/\s/g, '')).length;
}

/** 讀完這段文字大概要幾秒（中文約每秒 6 字，最少 2.5 秒）。 */
export function readSeconds(text: string): number {
  return Math.max(2.5, 1.2 + charCount(text) / 6);
}
