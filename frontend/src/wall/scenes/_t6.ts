// 批次 T6（螢幕 B：試算表、程式碼、安裝進度、新聞快報、氣象報告、片尾名單）共用的小工具。
// 這六個版面都是「螢幕上的畫面」，所以有幾件事一樣：小圖層貼回全螢幕、列出窗格裡的拍點、
// 台灣的海岸線（新聞的地球儀與氣象圖都要）、逐字「打出來」的歌詞（打字＝唱到，照跟唱規則）。
import type { AudioData } from '../engine/audio';
import { Lyrics, type Line } from '../engine/lyrics';
import { W, H } from '../engine/gl';
import { font } from '../engine/type';
import { fitText, type FitResult } from '../engine/text';

export type Rect = [number, number, number, number];

/** 一張只蓋住畫面一部分的圖層（左上 x,y、寬高 w,h，邏輯像素）貼回全螢幕時，Compositor 要的 UV 縮放與位移。 */
export function subRect(x: number, y: number, w: number, h: number) {
  return {
    scale: [W / w, H / h] as [number, number],
    offset: [(0.5 * W - x) / w - 0.5, (y + 0.5 * h - 0.5 * H) / h] as [number, number],
  };
}

/** [t0, t1) 之間的拍點時間。 */
export function beatsIn(au: AudioData, t0: number, t1: number): number[] {
  const out: number[] = [];
  for (let i = Math.ceil(au.beatAt(t0) - 1e-6); ; i++) {
    const bt = au.timeOfBeat(i);
    if (bt >= t1) break;
    out.push(bt);
    if (out.length > 400) break;
  }
  return out;
}

/** 最後一個「後面至少還有 gap 秒」的拍點（收尾動作落在這裡，才看得到）。 */
export function lastBeatBefore(au: AudioData, end: number, gap: number): number {
  return au.timeOfBeat(Math.floor(au.beatAt(end - gap) + 1e-6));
}

// ---------------------------------------------------------------- 台灣
/**
 * 台灣本島海岸線（經度、緯度），從富貴角順時針繞一圈。只取大約 60 個點：
 * 圖版上是一條細線，要的是一眼認得出的輪廓，不是測量精度。
 */
export const TAIWAN: [number, number][] = [
  [121.537, 25.298], [121.47, 25.25], [121.41, 25.18], [121.33, 25.15], [121.24, 25.12], [121.09, 25.05], [121.02, 24.98],
  [120.97, 24.91], [120.92, 24.85], [120.9, 24.77], [120.84, 24.7], [120.76, 24.62], [120.67, 24.49], [120.63, 24.43],
  [120.57, 24.36], [120.5, 24.27], [120.45, 24.17], [120.39, 24.07], [120.3, 23.93], [120.27, 23.84], [120.18, 23.77],
  [120.17, 23.7], [120.14, 23.58], [120.14, 23.46], [120.14, 23.37], [120.1, 23.27], [120.07, 23.13], [120.15, 23.0],
  [120.18, 22.9], [120.24, 22.72], [120.28, 22.6], [120.37, 22.5], [120.45, 22.45], [120.58, 22.36], [120.68, 22.19],
  [120.7, 22.07], [120.73, 21.93], [120.8, 21.94], [120.85, 21.9], [120.88, 21.99], [120.9, 22.2], [120.9, 22.34],
  [121.0, 22.6], [121.15, 22.75], [121.23, 22.88], [121.38, 23.1], [121.44, 23.28], [121.5, 23.45], [121.52, 23.6],
  [121.6, 23.85], [121.62, 23.98], [121.68, 24.15], [121.75, 24.3], [121.8, 24.46], [121.87, 24.59], [121.84, 24.72],
  [121.83, 24.85], [121.9, 24.95], [122.0, 25.01], [121.92, 25.13], [121.8, 25.14], [121.74, 25.15], [121.69, 25.21],
  [121.64, 25.23], [121.58, 25.28],
];
/** 婚禮現場的大概位置（台北附近；只當地圖上的一個點，不是真的地址）。 */
export const VENUE: [number, number] = [121.52, 25.05];

/** 把台灣畫進一個方框（等距圓柱投影、經度乘 cos(緯度)），回傳畫面座標的點與投影函式。 */
export function taiwanIn(x: number, y: number, h: number) {
  const lat0 = 23.6, k = h / (25.35 - 21.85), cx = 120.97, cl = Math.cos((lat0 * Math.PI) / 180);
  const proj = (lon: number, lat: number) => ({ x: x + (lon - cx) * cl * k, y: y + (25.35 - lat) * k });
  return { pts: TAIWAN.map(([lo, la]) => proj(lo, la)), proj, k };
}

// ---------------------------------------------------------------- 打出來的歌詞
export interface TypedWord { w: string; x: number; row: number; width: number; start: number; end: number; word: Line['words'][number] }
export interface TypedLayout { rows: number; words: TypedWord[]; size: number; widths: number[] }

const typedCache = new WeakMap<Line, Map<string, TypedLayout>>();

/**
 * 把一行歌詞排成可以「打字」的樣子：照字（Word）斷行（英文不拆字、中文一字一格），最多 maxRows 行，
 * 放不下就縮字級（不小於 minSize）。回傳每個字在第幾行、x 多少。同一行同樣式快取。
 */
export function typedLayout(c: CanvasRenderingContext2D, line: Line, family: string, size: number, maxW: number, o: { minSize?: number; maxRows?: number; tracking?: number } = {}): TypedLayout {
  const key = `${family}|${size}|${maxW}|${o.minSize}|${o.maxRows}|${o.tracking}`;
  let m = typedCache.get(line);
  if (!m) { m = new Map(); typedCache.set(line, m); }
  const hit = m.get(key);
  if (hit) return hit;
  const maxRows = o.maxRows ?? 2, tr = o.tracking ?? 0;
  const run = (sz: number) => {
    c.font = font(family, sz);
    c.letterSpacing = `${tr}px`;
    const words: TypedWord[] = [];
    const widths: number[] = [0];
    let row = 0, x = 0;
    line.words.forEach((w, i) => {
      // 字前面的空白（英文）跟著字一起量；行首不要空白
      const prev = i > 0 ? line.words[i - 1]! : null;
      const gap = prev ? line.text.slice(prev.o + prev.w.length, w.o) : '';
      const ww = c.measureText(w.w).width;
      const gw = gap ? c.measureText(gap).width : 0;
      if (x > 0 && x + gw + ww > maxW) { row++; x = 0; widths.push(0); }
      else x += gw;
      words.push({ w: w.w, x, row, width: ww, start: w.start, end: w.end, word: w });
      x += ww;
      widths[row] = x;
    });
    c.letterSpacing = '0px';
    return { rows: row + 1, words, size: sz, widths };
  };
  let sz = size, res = run(sz);
  const min = o.minSize ?? size * 0.75;
  while ((res.rows > maxRows || Math.max(...res.widths) > maxW) && sz > min) { sz = Math.max(min, sz * 0.94); res = run(sz); }
  m.set(key, res);
  return res;
}

/**
 * 畫打出來的歌詞：唱到的字才「打上去」（逐字，跟著 wordProgress），正在唱的是 active 色、唱完的是 sung 色；
 * 還沒唱的字用 ghost 色先淡淡地排好（像編輯器的自動完成建議），ghost 可以是 null（不先顯示）。
 * 回傳游標位置（正在打的地方），沒在唱時回傳這行最後一個已打的字後面。
 */
export function drawTyped(c: CanvasRenderingContext2D, lay: TypedLayout, family: string, x: number, y: number, lineH: number, t: number,
  col: { active: string; sung: string; ghost: string | null }, alpha = 1): { x: number; y: number; typing: boolean } {
  c.save();
  c.font = font(family, lay.size);
  c.textBaseline = 'alphabetic';
  c.globalAlpha *= alpha;
  let cx = x, cy = y, typing = false;
  for (const tw of lay.words) {
    const p = Lyrics.wordProgress(tw.word, t);
    const wx = x + tw.x, wy = y + tw.row * lineH;
    if (p <= 0) { if (col.ghost) { c.fillStyle = col.ghost; c.fillText(tw.w, wx, wy); } continue; }
    // 逐字打：中文一個 Word 通常就是一個字；英文單字照字母數切
    const chars = Array.from(tw.w);
    const n = p >= 1 ? chars.length : Math.max(1, Math.ceil(chars.length * p));
    const shown = chars.slice(0, n).join('');
    const sw = c.measureText(shown).width;
    // 還沒打到的尾巴照樣是 ghost（打上去的部分不能疊在 ghost 上，淡色會透出來）
    if (p < 1 && col.ghost && n < chars.length) { c.fillStyle = col.ghost; c.fillText(chars.slice(n).join(''), wx + sw, wy); }
    c.fillStyle = p < 1 ? col.active : col.sung;
    c.fillText(shown, wx, wy);
    cx = wx + sw; cy = wy;
    if (p < 1) typing = true;
  }
  c.restore();
  return { x: cx, y: cy, typing };
}

/** 窗格的進出場：第一格淡入、最後 k 秒淡出。 */
export function inOut(t: number, s: number, e: number, fin = 0.35, fout = 0.3) {
  return Math.max(0, Math.min(1, (t - s) / fin, (e - t) / fout));
}

/**
 * 留言排版，但偏好「少一點行數」：fitText 找的是最大字級，短留言常常被拆成兩行（「新婚快／樂！！！」）。
 * 行數少一行、字級還有原本的三分之二以上（而且夠大）就用少的那個，讀起來是一整句。
 */
export function fitMessage(c: CanvasRenderingContext2D, text: string, family: string, w: number, h: number, o: { min?: number; max?: number; lineHeight?: number; maxLines?: number } = {}): FitResult {
  const best = fitText(c, text, family, w, h, { min: 44, lineHeight: 1.3, ...o });
  for (let n = 1; n < best.lines.length; n++) {
    const f = fitText(c, text, family, w, h, { min: 44, lineHeight: 1.3, ...o, maxLines: n });
    if (f.lines.length <= n && f.size >= Math.max(60, best.size * 0.66)) return f;
  }
  return best;
}
