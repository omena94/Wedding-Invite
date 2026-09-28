// 批次 T19（光：營火、燭光、水晶吊燈、燈塔、月相、日出）共用的小工具。
// 這批版面的歌詞都不是一整行平平地畫（刻在木頭上、掛在水晶下、沿著軌道弧線、騎在光芒上），
// 所以要「一個字一個字」知道它該是什麼顏色、放在哪裡；時間與顏色規則跟 _motifs.ts 的 drawLyric 一樣：
// 字在 word.start 亮起、正在唱是訊號色、唱完是紙白（亮版面是墨色）、還沒唱三成透明。
import { Lyrics, type Line } from '../engine/lyrics';
import { HEX, rgba, mixRgba } from '../engine/palette';
import { clamp, polylineLengths, pointAtLength, type V2 } from '../engine/util';
import { font, loadText } from '../engine/type';
import { fitText, type FitResult } from '../engine/text';
import type { SceneCtx } from '../engine/scene';

export interface GlyphState {
  /** 這個字（一個 code point）。 */
  ch: string;
  /** 在整行的第幾個字（code point 索引）。 */
  i: number;
  /** 跟唱進度：0 還沒唱、(0,1) 正在唱、1 唱完。 */
  p: number;
  /** 屬於第幾個 Word（空白是 -1）。 */
  word: number;
}

/**
 * 一行歌詞每個字的跟唱進度。英文一個單字是一個 Word：單字裡的字母依序亮（跟 drawLyric 的擦亮一樣的速度），
 * 中文一個字就是一個 Word。字與字之間的空白跟著前一個字。
 */
export function glyphStates(line: Line, t: number): GlyphState[] {
  const out: GlyphState[] = [];
  let u = 0, i = 0, wi = 0, prev = 0;
  for (const ch of line.text) {
    while (wi < line.words.length && line.words[wi]!.o + line.words[wi]!.w.length <= u) wi++;
    const w = line.words[wi];
    let p = prev, word = -1;
    if (w && u >= w.o && u < w.o + w.w.length) {
      const n = w.w.length, k = u - w.o;
      p = clamp(Lyrics.wordProgress(w, t) * n - k);
      word = wi;
    }
    out.push({ ch, i, p, word });
    prev = p;
    u += ch.length;
    i++;
  }
  return out;
}

/** 跟唱的顏色：暗版面紙白／訊號色，亮版面墨色／偏深的訊號色（淺訊號色在紙上讀不清楚）。 */
export function glyphColor(p: number, paper = false, alpha = 1): string {
  if (p <= 0) return rgba(paper ? 'sepia' : 'bone', 0.3 * alpha);
  if (p < 1) return paper ? paperSignal(alpha) : rgba('signal', alpha);
  return rgba(paper ? 'sepia' : 'bone', (paper ? 0.94 : 0.96) * alpha);
}

/** 亮版面「正在唱」的字要跟紙有多少對比（WCAG 的對比值；大字 3 就讀得到，留一點餘裕）。 */
const PAPER_CONTRAST = 3.4;
let mixKey = '', mixK = 0.38;
const toLin = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
const lumHex = (rgb: number[]) => 0.2126 * toLin(rgb[0]!) + 0.7152 * toLin(rgb[1]!) + 0.0722 * toLin(rgb[2]!);
const hexRgb = (h: string) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
/**
 * 訊號色要混多少暗部（blood）才在紙上讀得清楚：每個主題不一樣——珊瑚、玫瑰本來就夠深，混一點就好；
 * 香檳、燭光金、鼠尾草的訊號色很淺，固定比例會淡到快看不見，所以依主題算到對比夠為止（最多混到 85%，還要看得出是訊號色）。
 * 主題換了才重算（每首歌一次）。
 */
function paperMix(): number {
  const key = HEX.signal + HEX.blood + HEX.paper;
  if (key === mixKey) return mixK;
  const s = hexRgb(HEX.signal), b = hexRgb(HEX.blood), lp = lumHex(hexRgb(HEX.paper));
  let k = 0.38;
  for (; k < 0.85; k += 0.01) {
    // 跟 mixRgba 一樣在 sRGB 上混色，量亮度再轉線性
    const lc = lumHex([0, 1, 2].map((i) => Math.round(s[i]! + (b[i]! - s[i]!) * k)));
    if ((Math.max(lp, lc) + 0.05) / (Math.min(lp, lc) + 0.05) >= PAPER_CONTRAST) break;
  }
  mixKey = key; mixK = Math.min(k, 0.85);
  return mixK;
}

/** 亮版面上「正在唱」的訊號色（字、重點）：比 signal 深、深到在這個主題的紙上讀得清楚。 */
export const paperSignal = (a = 1) => mixRgba('signal', 'blood', paperMix(), a);

/**
 * init 用：把這個窗格會唱到的歌詞、歌名，和版面自己的字（標籤、讀數、註腳）先載好。
 * 字型分片是「用到才下載」的：第一格才開始下載的話，同一個時間點畫兩次會不一樣（確定性不過），現場也會閃一下系統字。
 * 已經載好的字很快就回來，不怕重複呼叫。
 */
export function preloadText(ctx: SceneCtx, extra = ''): Promise<void> {
  const lines = ctx.lyrics.linesIn(ctx.start - 2, ctx.end + 2).map((l) => l.text).join('');
  return loadText(`${lines}${ctx.song.title}${ctx.song.artist}${extra}${COMMON_CHARS}`);
}
/** 標籤、讀數常用的符號與數字（全形、半形都放）。 */
const COMMON_CHARS = '0123456789０１２３４５６７８９%％：／·・．，。！？、「」『』（）—–…＊♪♥';

export interface PathGlyph { ch: string; i: number; x: number; y: number; a: number; w: number }

/**
 * 把一段字沿著折線排好（每個字的中心落在路徑上、依切線轉），從弧長 s0 開始，字距 tracking。
 * 回傳每個字的基線中心點與角度；超出路徑的字照最後一段的方向延伸。
 */
export function alongPath(c: CanvasRenderingContext2D, text: string, family: string, size: number, pts: V2[], s0: number, tracking = 0): PathGlyph[] {
  const L = polylineLengths(pts);
  c.font = font(family, size);
  const out: PathGlyph[] = [];
  let s = s0, i = 0;
  for (const ch of text) {
    const w = c.measureText(ch).width;
    const q = pointAtLength(pts, L, s + w / 2);
    out.push({ ch, i, x: q.x, y: q.y, a: q.angle, w });
    s += w + tracking;
    i++;
  }
  return out;
}

/** 折線總長。 */
export const pathLength = (pts: V2[]) => { const L = polylineLengths(pts); return L[L.length - 1] ?? 0; };

/**
 * 排留言：跟 fitText 一樣找最大字級，但行數能少就少——「新婚快樂！！！」寧可小一點排成一行，也不要大大地斷成「新婚／快樂！！！」。
 * 從一行開始試，字級不小於最大可能字級的 `keep` 倍就用它。
 */
export function fitFew(c: CanvasRenderingContext2D, text: string, family: string, w: number, h: number, o: { min?: number; max?: number; lineHeight?: number; maxLines?: number } = {}, keep = 0.8): FitResult {
  const best = fitText(c, text, family, w, h, o);
  for (let k = 1; k < best.lines.length; k++) {
    const r = fitText(c, text, family, w, h, { ...o, maxLines: k });
    if (r.lines.length <= k && r.size >= best.size * keep) return r;
  }
  return best;
}

/** 排好的留言＋署名：署名的字級、最後一行基線到署名基線的距離、整塊（第一行頂到署名底）的高度。 */
export interface MsgBlock { fit: FitResult; sigSize: number; sigDy: number; height: number }

/**
 * 留言與署名一起排（正式站看過署名被留言最後一行蓋住）：字級依「可用高度扣掉署名那一列」找，
 * 署名一定在最後一行的下面——中間留最後一行的下伸部（愛心、ㄩ字底）加一點空，再放署名的字身。
 * 署名字級 = 留言字級 × ratio，夾在 min～max。回傳的 height 不會超過 h（除非連最小字級都放不下）。
 */
export function fitWithSig(c: CanvasRenderingContext2D, text: string, family: string, w: number, h: number, o: { min?: number; max?: number; lineHeight?: number; maxLines?: number } = {}, sig: { ratio?: number; min?: number; max?: number } = {}): MsgBlock {
  const ratio = sig.ratio ?? 0.5, smin = sig.min ?? 40, smax = sig.max ?? 60;
  let hh = h, best: MsgBlock | null = null;
  for (let k = 0; k < 8; k++) {
    const fit = fitFew(c, text, family, w, Math.max(hh, (o.min ?? 20) * 1.2), o);
    const ss = clamp(Math.round(fit.size * ratio), smin, smax);
    const sigDy = fit.size * 0.34 + ss * 1.02;
    const height = fit.height + sigDy + ss * 0.26;
    best = { fit, sigSize: ss, sigDy, height };
    if (height <= h + 0.5) break;
    hh -= height - h + 2;
  }
  return best!;
}

/** 留言編號：No.042。 */
export const no3 = (n: number) => `No.${String(n).padStart(3, '0')}`;

/** 沒有主打留言時的邀請（小字）。 */
export const INVITE_SMALL = '掃描右下角 QR code，把祝福寫上大螢幕';

/** [x, y, w, h] 的聯集外框（popupAvoid 用）。 */
export function unionRect(rs: [number, number, number, number][]): [number, number, number, number] {
  const x0 = Math.min(...rs.map((r) => r[0])), y0 = Math.min(...rs.map((r) => r[1]));
  const x1 = Math.max(...rs.map((r) => r[0] + r[2])), y1 = Math.max(...rs.map((r) => r[1] + r[3]));
  return [x0, y0, x1 - x0, y1 - y0];
}
