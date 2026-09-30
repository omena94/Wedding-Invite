// 批次 B3（雙語・街景與招牌：streetsign、neonalley、busstop、trainlcd、menuwall、billboard）共用的小工具。
// 六個版面各有自己的場景與畫法，共用的只有：
//  - 要先載好的字（留言、署名、窗格裡的歌詞「連同原文副行」、歌名、版面自己的字）；韓文原文一定要先載，不然第一格是方框；
//  - 雙語歌詞的排版：中文主行＋原文副行（照這批的規則：原文約中文的 0.68 倍、≥ 30 px，寫在同一塊招牌／螢幕上），
//    兩行各自照自己的逐字時間亮；沒有翻譯時只排一行（原文那一格收起來）；
//  - 留言照 v2（_v2.ts）：字級上限依字數、先照子句斷行，署名在最後一行下面。
import type { Msg, SceneCtx } from '../engine/scene';
import { font, loadText } from '../engine/type';
import { fitText, type FitResult } from '../engine/text';
import { rgba } from '../engine/palette';
import { clamp } from '../engine/util';
import { Lyrics, type Line } from '../engine/lyrics';
import { layoutLyric, lyricSubOf, signature, fillWithHearts, COUPLE_ZH, DATE_DOTS, type LyricLayout, type LyricStyle } from './_motifs';
import { V2, msgMaxFor, sigV2, fitClauses } from './_v2';

export type Rect = [number, number, number, number];

/** 右下角 HUD：x ≥ 1360 且 y ≥ 830 不放東西。 */
export const HUD = { x: 1360, y: 830 };
/** 沒有留言時的邀請（整批一致的說法）。 */
export const B3_INVITE = '掃描右下角 QR code，把你的祝福寫上大螢幕';
const B3_TEXT = `${B3_INVITE}${COUPLE_ZH}${DATE_DOTS}一位賓客新郎新娘新人No.0123456789·—…♥♪（）()&:/.-+×%$∞→←↑↓▶◀ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz`;

/** 署名：新人自己的留言寫「新郎新娘」。 */
export const sigOf = (m: Msg) => (m.couple ? '—— 新郎新娘' : signature(m.name));

/** 把這個窗格會畫到的字都載好：留言、署名、歌詞（中文與原文副行）、歌名、版面自己的字。 */
export async function loadB3(ctx: SceneCtx, extra = ''): Promise<void> {
  const m = ctx.params.message as Msg | null | undefined;
  const lines = ctx.lyrics.linesIn(ctx.start - 2, ctx.end + 2);
  const lyr = lines.map((l) => l.text + (lyricSubOf(l)?.text ?? '')).join('');
  await loadText(`${B3_TEXT}${m ? m.text + sigOf(m) : ''}${lyr}${ctx.song.title}${ctx.song.artist ?? ''}${extra}`);
}

// ---------------------------------------------------------------- 雙語歌詞
/** 這批的原文副行比例：約中文的 0.68 倍（規格 0.65～0.75），至少 30 px。 */
export const SUB_RATIO = 0.68, SUB_MIN = 30;

const stripped = new WeakMap<Line, Line>();
/** 同一行、拿掉原文副行的版本（自己排兩行時用；快取起來，layoutLyric 的快取才有效）。 */
export function mainOnly(line: Line): Line {
  if (!line.sub) return line;
  let s = stripped.get(line);
  if (!s) { s = { ...line, sub: undefined }; stripped.set(line, s); }
  return s;
}

export interface BiStyle {
  family: string; size: number; minSize: number; maxWidth: number;
  align?: 'left' | 'center' | 'right'; lineHeight?: number; tracking?: number;
  /** 原文的字族（預設跟中文一樣）、比例、最小字級、主行最後一排基線到副行第一排基線的距離（預設依字級算）。 */
  subFamily?: string; subRatio?: number; subMin?: number; subMaxWidth?: number; gap?: number;
}
export interface BiLayout {
  main: LyricLayout;
  sub: LyricLayout | null;
  /** 主行第一排基線到副行第一排基線的距離。 */
  subDy: number;
  /** 主行第一排的頂（約 -size×0.9）到最後一排（有副行就是副行）基線的高度。 */
  height: number;
  /** 中文與原文各自的樣式（畫的時候要傳一樣的字族、字距）。 */
  mainSt: LyricStyle; subSt: LyricStyle | null;
}

/** 排一行雙語歌詞（原點 = 主行第一排基線的對齊點）。沒有原文就只有主行。 */
export function layoutBi(c: CanvasRenderingContext2D, line: Line, st: BiStyle): BiLayout {
  const mainSt: LyricStyle = { family: st.family, size: st.size, minSize: st.minSize, maxWidth: st.maxWidth, align: st.align ?? 'left', lineHeight: st.lineHeight ?? 1.16, tracking: st.tracking ?? 0 };
  const main = layoutLyric(c, mainOnly(line), mainSt);
  const subLine = lyricSubOf(line);
  const lastMain = main.rows.length ? main.rows[main.rows.length - 1]!.y : 0;
  if (!subLine) return { main, sub: null, subDy: 0, height: lastMain + main.size, mainSt, subSt: null };
  const sMin = st.subMin ?? SUB_MIN;
  const sSize = Math.max(sMin, Math.round(main.size * (st.subRatio ?? SUB_RATIO)));
  const subSt: LyricStyle = { family: st.subFamily ?? st.family, size: sSize, minSize: sMin, maxWidth: st.subMaxWidth ?? st.maxWidth, align: st.align ?? 'left', lineHeight: 1.14, tracking: (st.tracking ?? 0) * 0.5 };
  const sub = layoutLyric(c, subLine, subSt);
  const subDy = lastMain + (st.gap ?? main.size * 0.34 + sub.size * 0.9);
  const lastSub = sub.rows.length ? sub.rows[sub.rows.length - 1]!.y : 0;
  return { main, sub, subDy, height: subDy + lastSub + main.size, mainSt, subSt };
}

export interface Ink { unsung: string; active: string; sung: string }

/**
 * 逐字反白（跟 _motifs 的畫法一樣）：還沒唱的淡字，唱到的部分用 clip 蓋上亮字。回傳正在唱的字的筆尖位置。
 * 原文副行照 TREATMENT：正在唱與唱完都用「唱完」的顏色，再淡兩成（呼叫的人傳 ink 與 litAlpha 決定）。
 */
export function paintLay(c: CanvasRenderingContext2D, lay: LyricLayout, st: LyricStyle, t: number, ink: Ink, alpha = 1, litAlpha = 1): { x: number; y: number } | null {
  c.save();
  c.font = font(st.family, lay.size);
  c.letterSpacing = `${st.tracking ?? 0}px`;
  c.textBaseline = 'alphabetic';
  let head: { x: number; y: number } | null = null;
  for (const pw of lay.words) {
    const p = Lyrics.wordProgress(pw.word, t);
    c.globalAlpha = alpha;
    c.fillStyle = ink.unsung;
    if (p < 1) c.fillText(pw.word.w, pw.x, pw.y);
    if (p <= 0) continue;
    c.save();
    c.beginPath();
    c.rect(pw.x - lay.size * 0.1, pw.y - lay.size * 1.1, (pw.w + lay.size * 0.2) * p, lay.size * 1.5);
    c.clip();
    c.globalAlpha = alpha * litAlpha;
    c.fillStyle = p < 1 ? ink.active : ink.sung;
    c.fillText(pw.word.w, pw.x, pw.y);
    c.restore();
    if (p < 1) head = { x: pw.x + pw.w * p, y: pw.y };
  }
  c.restore();
  return head;
}

/** 畫一行雙語歌詞（已經 translate 到主行第一排基線的對齊點）：中文照 ink，原文用 subInk（預設：唱到唱完都是 sung、淡兩成）。 */
export function paintBi(c: CanvasRenderingContext2D, bl: BiLayout, t: number, ink: Ink, alpha = 1, subInk?: Ink) {
  const head = paintLay(c, bl.main, bl.mainSt, t, ink, alpha);
  if (bl.sub && bl.subSt) {
    c.save();
    c.translate(0, bl.subDy);
    paintLay(c, bl.sub, bl.subSt, t, subInk ?? { unsung: ink.unsung, active: ink.sung, sung: ink.sung }, alpha, subInk ? 1 : 0.8);
    c.restore();
  }
  return head;
}

// ---------------------------------------------------------------- 留言（v2）
export interface MsgBlock {
  fit: FitResult; family: string;
  sig: { text: string; size: number; family: string };
  /** 第一行基線（相對框頂）、署名基線、整塊的高、最寬一行的寬。 */
  base0: number; sigY: number; h: number; w: number;
}

/**
 * 在 w×h 的框裡排一則留言＋署名（框的單位是「畫布 px」；k = 畫布 1 px 在螢幕上是幾 px，有縮放的物件要換算）。
 * 字級照 v2：上限依字數（msgMaxFor），下限 40；署名 26～32、在最後一行下面；先照子句斷行，放不下才交給 fitText。
 */
export function msgBlock(c: CanvasRenderingContext2D, m: Msg, family: string, w: number, h: number, o: { k?: number; sigFamily?: string; lineHeight?: number; maxLines?: number; sigText?: string } = {}): MsgBlock {
  const k = o.k ?? 1;
  const lh = o.lineHeight ?? 1.3;
  const sigFamily = o.sigFamily ?? family;
  const max = msgMaxFor(m.text) / k, min = V2.msgMin / k;
  const sig0 = V2.sigMax / k;
  const fitAt = (hh: number) => {
    const opt = { min, max, lineHeight: lh, maxLines: o.maxLines ?? 5 };
    return fitClauses(c, m.text, family, w, hh, opt) ?? fitText(c, m.text, family, w, hh, opt);
  };
  let fit = fitAt(h - sig0 * 1.8);
  const sigSize = sigV2(fit.size * k) / k;
  fit = fitAt(h - sigSize * 1.8);
  c.font = font(family, fit.size);
  const wMax = Math.max(...fit.lines.map((l) => c.measureText(l).width));
  const base0 = fit.size * 0.92;
  const sigY = base0 + (fit.lines.length - 1) * fit.lineHeight + Math.max(fit.lineHeight * 0.72, sigSize * 1.6);
  return { fit, family, sig: { text: o.sigText ?? sigOf(m), size: sigSize, family: sigFamily }, base0, sigY, h: sigY + sigSize * 0.3, w: wMax };
}

/**
 * 畫排好的留言（原點 = 框的左上角）：chars 是已經出現幾個字（逐字出現用），署名在全部出現之後才畫（sigK 0..1 淡入）。
 * align：整塊靠左或置中（框寬 bw）。
 */
export function drawMsgBlock(c: CanvasRenderingContext2D, mb: MsgBlock, o: { color: string; sigColor: string; heart?: string; align?: 'left' | 'center'; bw?: number; chars?: number; sigK?: number; sigRight?: boolean }) {
  const { fit } = mb;
  c.save();
  c.textBaseline = 'alphabetic';
  c.font = font(mb.family, fit.size);
  c.fillStyle = o.color;
  let left = o.chars ?? Infinity;
  fit.lines.forEach((ln, i) => {
    if (left <= 0) return;
    const chars = Array.from(ln);
    const shown = left >= chars.length ? ln : chars.slice(0, Math.floor(left)).join('');
    left -= chars.length;
    const lw = c.measureText(ln).width;
    const x = o.align === 'center' ? ((o.bw ?? mb.w) - lw) / 2 : 0;
    fillWithHearts(c, shown, x, mb.base0 + i * fit.lineHeight, o.heart ?? rgba('rose'));
  });
  const sk = clamp(o.sigK ?? 1);
  if (sk > 0 && left > -1e-6) {
    c.globalAlpha *= sk;
    c.font = font(mb.sig.family, mb.sig.size);
    c.fillStyle = o.sigColor;
    const sw = c.measureText(mb.sig.text).width;
    const right = o.align === 'center' ? ((o.bw ?? mb.w) + mb.w) / 2 : mb.w;
    const x = o.sigRight === false ? 0 : Math.max(0, right - sw);
    c.fillText(mb.sig.text, x, mb.sigY);
  }
  c.restore();
}

/** 留言的字數（逐字出現用）。 */
export const msgLenOf = (mb: MsgBlock) => mb.fit.lines.reduce((s, l) => s + Array.from(l).length, 0);
