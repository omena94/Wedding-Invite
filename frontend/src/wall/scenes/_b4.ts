// 雙語批次 B4（語言工具：口譯廂、翻譯機、雙語鍵盤、雙文石碑、字母積木、拼字盤）共用的小工具。
// 六個版面的手法各不相同，共用的只有「兩行歌詞怎麼排」與「init 要先載哪些字」：
//  - 語言工具的畫面常常是「上面原文、下面中文」（口譯的來源／譯文、翻譯機的上下兩半），drawLyric 只會把原文畫在中文下面，
//    所以這裡另外給一組 layoutPair／drawPair：兩種順序都能排，兩行都照自己的逐字時間亮（原文的樣式照 _motifs 的副行規則）。
//  - 原文常是韓文：init 要把這個窗格會唱到的原文也預載（preloadText 只載中文主行），不然第一格會用備援字型、確定性不過。
import type { Line } from '../engine/lyrics';
import type { SceneCtx } from '../engine/scene';
import { loadText } from '../engine/type';
import { layoutLyric, drawLyric, drawLyricSub, subStyleFor, subGap, lyricSubOf, type LyricLayout, type LyricStyle } from './_motifs';
import { preloadText } from './_t19';

export type Rect = [number, number, number, number];

/** 右下角 HUD（QR）：字與道具不要進到 x ≥ 1360 且 y ≥ 830。 */
export const HUD = { x: 1360, y: 830 };

const mainCache = new WeakMap<Line, Line>();
/** 同一行拿掉原文（只畫中文用；同一行回傳同一個物件，layoutLyric 的快取才有效）。 */
export function mainOnly(line: Line): Line {
  if (!line.sub) return line;
  let m = mainCache.get(line);
  if (!m) { m = { ...line, sub: undefined }; mainCache.set(line, m); }
  return m;
}

/** 兩行歌詞的排版：主行（中文）與原文各自的排版，以及從整組頂端量的兩條基線、整組高度。沒有原文時 sub = null。 */
export interface PairLayout {
  main: LyricLayout;
  sub: LyricLayout | null;
  subLine: Line | null;
  /** 從整組頂端（第一排的字頂）到主行第一排基線、原文第一排基線的距離。 */
  mainY: number;
  subY: number;
  height: number;
}

/**
 * 排一行歌詞與它的原文：subFirst = 原文在上（語言工具的「來源 → 譯文」），否則原文在下（一般的副行位置，距離照 subGap）。
 * 原文的字級、樣式照 _motifs 的副行規則（subStyleFor：主行 0.6 倍、32～56 px；會場後排也要認得出來）。
 * sizeScale：畫在有縮放的平面上時，1 平面 px 在畫面上是幾 px（副行的 32 px 下限是畫面 px，要先換算）。
 */
export function layoutPair(c: CanvasRenderingContext2D, line: Line, st: LyricStyle, subFirst = false, sizeScale = 1): PairLayout {
  const main = layoutLyric(c, mainOnly(line), st);
  const subLine = lyricSubOf(line);
  const mlh = main.size * (st.lineHeight ?? 1.18);
  const mainBottom = (main.rows.length - 1) * mlh;
  if (!subLine) return { main, sub: null, subLine: null, mainY: main.size * 0.88, subY: 0, height: main.size + mainBottom };
  const sst = subScaled(st, main.size, sizeScale);
  const sub = layoutLyric(c, subLine, sst);
  const slh = sub.size * (sst.lineHeight ?? 1.18);
  const subBottom = (sub.rows.length - 1) * slh;
  if (subFirst) {
    const subY = sub.size * 0.88;
    const mainY = subY + subBottom + sub.size * 0.42 + main.size * 0.92;
    return { main, sub, subLine, mainY, subY, height: mainY + mainBottom + main.size * 0.12 };
  }
  const mainY = main.size * 0.88;
  const subY = mainY + mainBottom + subGap(main.size * sizeScale, sub.size * sizeScale) / sizeScale;
  return { main, sub, subLine, mainY, subY, height: subY + subBottom + sub.size * 0.12 };
}

/** 副行樣式（平面上的字級）：照畫面 px 算 subStyleFor，再換回平面。 */
function subScaled(st: LyricStyle, mainSize: number, sizeScale: number): LyricStyle {
  if (sizeScale === 1) return subStyleFor(st, mainSize);
  const s = subStyleFor(st, mainSize * sizeScale);
  return { ...s, size: s.size / sizeScale, minSize: (s.minSize ?? s.size) / sizeScale };
}

/**
 * 畫 layoutPair 排好的兩行（原點 = 整組頂端的對齊點）。原文用 _motifs 的副行畫法（唱到、唱完都用「唱完」的顏色、淡一點）。
 * sizeScale 要跟 layoutPair 一樣。回傳主行筆尖（正在唱的字）的位置。
 */
export function drawPair(c: CanvasRenderingContext2D, pl: PairLayout, line: Line, t: number, st: LyricStyle, alpha = 1, sizeScale = 1): { x: number; y: number } | null {
  if (pl.subLine) {
    c.save();
    c.translate(0, pl.subY);
    if (sizeScale === 1) drawLyricSub(c, pl.subLine, t, st, pl.main.size, alpha);
    else drawLyric(c, pl.subLine, t, { ...subScaled(st, pl.main.size, sizeScale), active: st.sung, sung: st.sung }, pl.sub!, alpha * 0.8);
    c.restore();
  }
  c.save();
  c.translate(0, pl.mainY);
  const head = drawLyric(c, mainOnly(line), t, st, pl.main, alpha);
  c.restore();
  return head ? { x: head.x, y: head.y + pl.mainY } : null;
}

/** init 用：這個窗格會唱到的中文與原文、版面自己的字一起預載。 */
export function preloadPair(ctx: SceneCtx, extra = ''): Promise<void> {
  const subs = ctx.lyrics.linesIn(ctx.start - 2, ctx.end + 2).map((l) => l.sub?.text ?? '').join('');
  return Promise.all([preloadText(ctx, extra), subs ? loadText(subs) : Promise.resolve()]).then(() => undefined);
}

/** 這個窗格裡有沒有原文（有翻譯的歌）：版面用來決定要不要替原文留位置、標籤寫什麼。 */
export const hasSubIn = (ctx: SceneCtx) => ctx.lyrics.linesIn(ctx.start - 1, ctx.end + 1).some((l) => !!l.sub);
