// 新人的名字與日期：全站共用 ../constants.js 的寫法（改名字、日期只改那裡）。
//
// 版面印名字、日期一律從這裡拿，不要自己拆字串或寫死：
//  - 名字長短不一：固定大小的框用 fitPx() 縮字，或用 fitText() 折行，不能爆框。
//  - 英文名只認得拉丁字的畫法（opentype 外框、單線筆畫字）要先看 HAS_LATIN_NAMES。
//  - 組字串用 joinBits()：空的那段連同分隔符號一起省掉，畫面上不會出現多餘的「 · 」或空框。
//  - 名字的字型在引擎開機時就先載好（engine.ts 的 init 會 await loadText(WEDDING_GLYPHS)），版面不用再自己載。
import { COUPLE_EN as EN, COUPLE_ZH as ZH, WEDDING_DATE as DAY, WEDDING_TIME_FROM } from '../constants.js';
import { measure } from './engine/type';

const str = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
/** 「A & B」拆成兩個名字。 */
const splitPair = (s: string): [string, string] | null => {
  const p = s.split(/\s*[&＆]\s*/).map((x) => x.trim());
  return p.length === 2 && p[0] && p[1] ? [p[0], p[1]] : null;
};
/** 只有拉丁字母（含重音字母）、空白與常見標點：opentype 外框、單線筆畫字畫得出來。 */
export const isLatin = (s: string) => !!s && /^[\x20-\x7E -ɏ‘’“”–—]+$/.test(s);

const zhPair = splitPair(str(ZH));
const enPair = splitPair(str(EN));

/** 兩位新人的中文名字（新郎在前）。 */
export const NAME_A = zhPair?.[0] || '新郎';
export const NAME_B = zhPair?.[1] || '新娘';
/** 英文名。 */
export const NAME_A_EN = enPair?.[0] || '';
export const NAME_B_EN = enPair?.[1] || '';

/** 「宣文 & 孟庭」 */
export const COUPLE_ZH = str(ZH) || `${NAME_A} & ${NAME_B}`;
/** 「Alan & Omena」：沒有英文名時退回中文。 */
export const COUPLE_EN = str(EN) || COUPLE_ZH;
/** COUPLE_EN 全是拉丁字（opentype 外框、單線筆畫字只能畫這種）。 */
export const HAS_LATIN_NAMES = isLatin(COUPLE_EN);

/** 名字的第一個字：英文名取第一個字母（大寫），沒有英文名就取中文名的第一個字。 */
const initialOf = (en: string, zh: string) => (en ? Array.from(en)[0]!.toUpperCase() : Array.from(zh)[0] ?? '');
/** 縮寫：「A」「O」，組起來「A&O」。 */
export const INITIAL_A = initialOf(NAME_A_EN, NAME_A);
export const INITIAL_B = initialOf(NAME_B_EN, NAME_B);
export const INITIALS = `${INITIAL_A}&${INITIAL_B}`;

const dm = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(str(DAY));
const pad = (n: number) => String(n).padStart(2, '0');
/** 婚禮日期的數字；yyyy／mm／dd 是補零的字串。 */
export const DATE: { y: number; m: number; d: number; yyyy: string; mm: string; dd: string } | null = dm
  ? { y: +dm[1]!, m: +dm[2]!, d: +dm[3]!, yyyy: dm[1]!, mm: pad(+dm[2]!), dd: pad(+dm[3]!) }
  : null;
/** 「2027-03-13」 */
export const WEDDING_DATE = DATE ? `${DATE.yyyy}-${DATE.mm}-${DATE.dd}` : '';
/** 「2027 · 03 · 13」 */
export const DATE_DOTS = DATE ? `${DATE.yyyy} · ${DATE.mm} · ${DATE.dd}` : '';
/** 「2027.03.13」 */
export const DATE_DOT = DATE ? `${DATE.yyyy}.${DATE.mm}.${DATE.dd}` : '';
/** 「0313」（票號、編號裡用） */
export const DATE_MMDD = DATE ? `${DATE.mm}${DATE.dd}` : '';
/** 「2027 年 3 月 13 日」 */
export const DATE_ZH = DATE ? `${DATE.y} 年 ${DATE.m} 月 ${DATE.d} 日` : '';

/** 開始時間「12:00」。 */
export const TIME_FROM = /^\d{1,2}:\d{2}$/.test(str(WEDDING_TIME_FROM)) ? str(WEDDING_TIME_FROM) : '';

/** 把幾段字用分隔符號接起來，空的那段連同分隔符號一起省掉。 */
export const joinBits = (sep: string, ...bits: (string | null | undefined | false)[]) => bits.filter((b): b is string => !!b).join(sep);

/**
 * 名字、日期在 maxW 寬的框裡最大能用多大的字級（不超過 size）。
 * 要在版面的 init() 或 render() 裡呼叫：模組最上層執行時字型還沒載好，量到的是備援字型的寬度，而且會被量字快取記住。
 * tracking 是 size 時的字距（px），縮小時照比例縮。結果取到 0.5 px，同一個名字每次算出來一樣。
 */
export function fitPx(text: string, family: string, size: number, maxW: number, tracking = 0): number {
  if (!text) return size;
  const w = measure(text, family, size, tracking);
  if (w <= maxW) return size;
  return Math.max(1, Math.floor(((size * maxW) / w) * 2) / 2);
}

/** 右下角 QR code 底下的署名（業者開的婚禮才有）：這是新人自己的網站，沒有。 */
export const CREDIT = '';

/** 名字、縮寫、日期用到的所有字：引擎開機時先把字型載好，版面第一格就是對的字型（確定性）。 */
export const WEDDING_GLYPHS = `${COUPLE_ZH}${COUPLE_EN}${NAME_A}${NAME_B}${NAME_A_EN}${NAME_B_EN}${INITIALS}${DATE_ZH}♥＆&·`;
