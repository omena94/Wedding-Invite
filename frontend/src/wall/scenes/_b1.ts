// 批次 B1（雙語・字幕與影像：subtitles、kvariety、webtoon、teleprompter、dubbing、projector）共用的小工具。
// 雙語版面（spec.bilingual）有翻譯的歌兩行歌詞一定都在，有主打留言也一樣（見 ENGINE.md「雙語版面」）：
//  - 中文主行照 LyricStyle 排；原文副行字級是主行的 0.68 倍（夾在 32～40 px：會場後排也要認得出韓文，
//    又不能大到搶中文）。_motifs 的 subSizeFor 是 0.6 倍，一般版面用；雙語版面兩行都是設計重點，原文大一點。
//  - 副行比主行安靜：唱到、唱完都用「唱完」的顏色（不用訊號色），還沒唱的三成；逐字時間是原文自己的。
//  - 留言照 v2（40～60 px、署名 26～32，署名永遠在最後一行下面）。
import { lyricSubOf, type Line } from '../engine/lyrics';
import { clamp } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { layoutLyric, drawLyric, type LyricStyle, type LyricLayout } from './_motifs';
import { V2, msgMaxFor, sigV2, fitClauses } from './_v2';

/** 只有主行的 Line（拿掉 sub）：主行、副行要分開排、分開畫。每行只做一次（layoutLyric 的快取是照 Line 物件）。 */
const mainCache = new WeakMap<Line, Line>();
export function mainOnly(line: Line): Line {
  if (!line.sub) return line;
  let m = mainCache.get(line);
  if (!m) { m = { ...line, sub: undefined }; mainCache.set(line, m); }
  return m;
}

/** 雙語兩行的排版。y 都是相對「主行第一排基線」。 */
export interface BiLay {
  main: LyricLayout;
  /** 原文副行（沒有翻譯是 null：版面把那一格收起來）。 */
  sub: LyricLayout | null;
  subLine: Line | null;
  subSt: LyricStyle | null;
  /** 副行第一排基線離主行第一排基線多遠。 */
  dy: number;
  /** 主行第一排基線到最後一排（有副行就是副行）基線的距離。 */
  span: number;
}

/** 副行字級：主行 × ratio，32～40 px。 */
export const biSubSize = (mainSize: number, ratio = 0.68) => Math.round(clamp(mainSize * ratio, 32, 40));

/**
 * 排一行雙語歌詞。`sub` 覆寫副行的樣式（字族、顏色、寬），`gap` 是主行最後一排基線到副行第一排基線的距離
 * （預設：主行下緣留約四分之一字高，再加副行的字高）。
 */
export function biLayout(c: CanvasRenderingContext2D, line: Line, st: LyricStyle, o: { ratio?: number; sub?: Partial<LyricStyle>; gap?: number } = {}): BiLay {
  const main = layoutLyric(c, mainOnly(line), st);
  const lh = main.size * (st.lineHeight ?? 1.18);
  const lastMain = (main.rows.length - 1) * lh;
  const sl = lyricSubOf(line);
  if (!sl) return { main, sub: null, subLine: null, subSt: null, dy: 0, span: lastMain };
  const size = biSubSize(main.size, o.ratio);
  const subSt: LyricStyle = { ...st, size, minSize: Math.min(size, 28), tracking: (st.tracking ?? 0) * 0.5, ...o.sub };
  const sub = layoutLyric(c, sl, subSt);
  const dy = lastMain + (o.gap ?? main.size * 0.4 + sub.size * 0.92);
  const slh = sub.size * (subSt.lineHeight ?? 1.18);
  return { main, sub, subLine: sl, subSt, dy, span: dy + (sub.rows.length - 1) * slh };
}

/**
 * 畫雙語兩行（已經 translate 到主行第一排基線的對齊點）。副行用它自己的逐字時間，唱到的用「唱完」的顏色（安靜）。
 * 回傳主行正在唱的字的筆尖位置（給火花、游標用）。
 */
export function drawBi(c: CanvasRenderingContext2D, line: Line, t: number, st: LyricStyle, bl: BiLay, alpha = 1, subAlpha = 1): { x: number; y: number } | null {
  const head = drawLyric(c, mainOnly(line), t, st, bl.main, alpha);
  if (bl.sub && bl.subLine && bl.subSt) {
    c.save();
    c.translate(0, bl.dy);
    const q = bl.subSt;
    drawLyric(c, bl.subLine, t, { ...q, active: q.sung ?? q.active }, bl.sub, alpha * subAlpha);
    c.restore();
  }
  return head;
}

/** 排好的留言＋署名：署名字級、最後一行基線到署名基線、整塊（第一行頂到署名底）高。 */
export interface MsgFit { fit: FitResult; sig: number; sigDy: number; height: number }

/**
 * 照 v2 排留言：字級上限照字數（msgMaxFor），框高扣掉署名那一列；照標點斷行的結果字級只小一點點（≥ 九成）就用它。
 */
export function fitMsgV2(c: CanvasRenderingContext2D, text: string, family: string, w: number, h: number, o: { lineHeight?: number; maxLines?: number; max?: number } = {}): MsgFit {
  const max = Math.min(o.max ?? 99, msgMaxFor(text));
  const opt = { min: V2.msgMin, max, lineHeight: o.lineHeight ?? 1.3, maxLines: o.maxLines ?? 5 };
  const sigRow = sigV2(max) * 1.6 + max * 0.34;
  const byW = fitText(c, text, family, w, h - sigRow, opt);
  const byC = fitClauses(c, text, family, w, h - sigRow, opt);
  const fit = byC && byC.size >= byW.size * 0.9 ? byC : byW;
  const sig = sigV2(fit.size);
  const sigDy = fit.size * 0.34 + sig * 1.02;
  return { fit, sig, sigDy, height: fit.height + sigDy + sig * 0.26 };
}
