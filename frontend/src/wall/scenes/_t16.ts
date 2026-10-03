// 批次 T16（自然 B ＋ 城市：fogwindow、snowglobe、aquarium、skyline、roadsign、metro）共用的小工具。
// 這批都是「一個真實空間裡的物件」：起霧的窗、雪花球、水族箱、天際線、路牌、捷運路線圖，
// 留言寫在物件上（霧、銘牌、解說牌、窗戶燈、路牌、路線圖），所以共用的多半是「排字、算時間」的部分。
import type { AudioData } from '../engine/audio';
import type { Msg } from '../engine/scene';
import { font, layout } from '../engine/type';
import { fitText, type FitResult } from '../engine/text';
import { clamp } from '../engine/util';
import { signature, COUPLE_ZH } from './_motifs';

/** 沒有留言時的邀請（整批一致的說法，小字）。 */
export const T16_INVITE = '掃描右下角 QR code，把你的祝福傳上大螢幕';

/** 這批版面固定會出現的字（init 時一次載好：數字、符號、拉丁字也要，沒載好第一格會用系統字頂替）。 */
export const T16_TEXT = `${T16_INVITE}一位賓客新人留言第則純音樂間奏0123456789·—…：:%kmKM♪()（）`;

/** 署名：新人自己的留言署新人的名字（COUPLE_ZH）（不再另外放一個 FROM THE COUPLE 標籤，少一群小字）。 */
export const sigOf = (m: Msg) => (m.couple ? `—— ${COUPLE_ZH}` : signature(m.name));

/** No.042 */
export const no3 = (n: number) => `No.${String(Math.max(0, n)).padStart(3, '0')}`;

/** 窗格裡的拍點。 */
export function winBeats(au: AudioData, s: number, e: number): number[] {
  const out: number[] = [];
  for (let b = Math.ceil(au.beatAt(s) - 1e-3); ; b++) {
    const tb = au.timeOfBeat(b);
    if (tb >= e - 1e-3 || out.length > 256) break;
    if (tb >= s - 1e-3) out.push(tb);
  }
  return out;
}

/** 窗格裡的小節線（含開頭那一條，如果窗格剛好切在小節線上）。 */
export function winBars(au: AudioData, s: number, e: number): number[] {
  const out: number[] = [];
  for (let b = Math.ceil(au.barAt(s) - 1e-3); ; b++) {
    const tb = au.timeOfBar(b);
    if (tb >= e - 1e-3 || out.length > 64) break;
    if (tb >= s - 1e-3) out.push(tb);
  }
  return out;
}

/** 排好的一排字：每個字的 x（相對這排的左端）與它在原文的位置。 */
export interface RowGlyph { ch: string; x: number; w: number; i: number }
export interface Row { text: string; x: number; y: number; width: number; glyphs: RowGlyph[] }

/**
 * 把 fitText 的結果展開成一排一排、每個字的位置（給「一個字一個字出現」用）。
 * x, top：整塊的左上（top 是第一排字的頂端），align 對齊。i 是這個字在全部字裡的序號。
 */
export function rowsOf(fit: FitResult, family: string, x: number, top: number, align: 'left' | 'center' = 'left'): Row[] {
  let i = 0;
  return fit.lines.map((ln, r) => {
    const lay = layout(ln, family, fit.size);
    const rx = align === 'center' ? x - lay.width / 2 : x;
    const glyphs = lay.glyphs.map((g) => ({ ch: g.ch, x: g.x, w: g.w, i: i++ }));
    return { text: ln, x: rx, y: top + fit.size * 0.88 + r * fit.lineHeight, width: lay.width, glyphs };
  });
}

/**
 * 留言排版：扣掉署名那一排的高度再找字級（署名永遠在最後一行下面，QA 的 K 情境），
 * 很短的留言字可以更大（它是畫面唯一的焦點，不要小小一行）。
 */
export function fitWithSig(c: CanvasRenderingContext2D, text: string, family: string, w: number, h: number, o: { min: number; max: number; lineHeight: number; maxLines: number; sig: number }): FitResult {
  const n = Array.from(text.replace(/\s/g, '')).length;
  const max = n <= 4 ? o.max : n <= 10 ? o.max * 0.86 : o.max * 0.74;
  return fitText(c, text, family, w, h - o.sig, { min: o.min, max: Math.max(o.min, max), lineHeight: o.lineHeight, maxLines: o.maxLines });
}

/** 一段字的總字數（逐字出現用）。 */
export const glyphCount = (rows: Row[]) => rows.reduce((s, r) => s + r.glyphs.length, 0);

/**
 * 逐字出現的時間：從 t0 開始，一個字 per 秒，整段最長 maxDur（字多就加快）。回傳第 i 個字開始出現的時間。
 */
export function charClock(n: number, t0: number, per: number, maxDur: number) {
  const step = n <= 1 ? per : Math.min(per, maxDur / n);
  return (i: number) => t0 + i * step;
}

/** 一排字在時間 t 寫到哪（x，相對這排左端；整排寫完是 width + 一點）。clock(i) = 第 i 個字開始的時間，每個字寫 step 秒。 */
export function rowFront(row: Row, t: number, clock: (i: number) => number, step: number): number {
  let x = 0;
  for (const g of row.glyphs) {
    const a = clock(g.i);
    if (t < a) return x;
    const k = clamp((t - a) / step);
    x = g.x + g.w * k;
    if (k < 1) return x;
  }
  return row.width + 40;
}

/** 量一段字的寬度（有字距）。 */
export function textW(c: CanvasRenderingContext2D, s: string, family: string, size: number, tracking = 0) {
  c.font = font(family, size);
  c.letterSpacing = `${tracking}px`;
  const w = c.measureText(s).width;
  c.letterSpacing = '0px';
  return w;
}
