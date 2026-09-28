// 批次 T13（手作 A：萬花筒、萬花尺、摺紙鶴、剪紙囍、書法、篆刻）共用的小工具。
//  - subRect：只蓋住畫面一部分的 Layer2D 貼回全螢幕時的 UV 參數（小圖層上傳比較快）。
//  - rasterPieces：把畫好的形狀（通常是一個大字）切成「連在一起的一塊一塊」，每塊有外框與輪廓。
//    剪紙（剪刀一塊一塊剪下來、紙片掉下去）與篆刻（刻刀一塊一塊刻掉）都要知道字由哪幾塊組成；
//    中文字型沒有向量外框可用（textPath2D 只支援拉丁字），所以用光柵化再做連通區域標記。
//  - 亮版面的歌詞配色：正在唱用訊號色的暗部（淡的訊號色在奶茶色紙上讀不到，跟 banknote 一樣）。
import { W, H } from '../engine/gl';
import { rgba } from '../engine/palette';
import type { LyricStyle } from './_motifs';
import { fitText, type FitResult } from '../engine/text';

/** 一張只蓋住畫面一部分的圖層（r，邏輯像素、y 向下）貼回全螢幕時，Compositor 要的 UV 縮放與位移。 */
export function subRect(r: { x: number; y: number; w: number; h: number }) {
  return {
    scale: [W / r.w, H / r.h] as [number, number],
    offset: [(0.5 * W - r.x) / r.w - 0.5, (0.5 * H - (H - r.y - r.h)) / r.h - 0.5] as [number, number],
  };
}

/** 亮版面（紙）上的歌詞顏色。 */
export const paperLyric = (): Pick<LyricStyle, 'active' | 'sung' | 'unsung'> => ({ active: rgba('blood'), sung: rgba('sepia', 0.95), unsung: rgba('sepia', 0.28) });

export interface Piece {
  /** 1 起算（labels 裡的值）。 */
  id: number;
  x0: number; y0: number; x1: number; y1: number;
  cx: number; cy: number;
  area: number;
  /** 外輪廓（像素座標，順時針，已經抽稀）。 */
  contour: { x: number; y: number }[];
}
export interface Pieces {
  w: number;
  h: number;
  /** 每個像素屬於第幾塊（0 = 空白）。 */
  labels: Uint16Array;
  pieces: Piece[];
}

/**
 * 在 w×h 的畫布上用 draw() 畫白色的形狀，切成 4 連通的區塊（小於 minArea 的碎點丟掉），
 * 每塊記外框、重心、面積與外輪廓（Moore 鄰域追蹤）。只在 init() 跑一次。
 */
export function rasterPieces(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, minArea = 20, step = 3): Pieces {
  w = Math.ceil(w); h = Math.ceil(h);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.fillStyle = '#fff';
  draw(c);
  const data = c.getImageData(0, 0, w, h).data;
  const on = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) on[i] = data[i * 4 + 3]! > 127 ? 1 : 0;
  cv.width = cv.height = 0;
  const labels = new Uint16Array(w * h);
  const pieces: Piece[] = [];
  const stack: number[] = [];
  let next = 1;
  for (let s = 0; s < w * h; s++) {
    if (!on[s] || labels[s]) continue;
    const id = next;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, sx = 0, sy = 0, area = 0;
    const members: number[] = [];
    labels[s] = id; stack.push(s);
    while (stack.length) {
      const p = stack.pop()!;
      members.push(p);
      const x = p % w, y = (p / w) | 0;
      area++; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && on[p - 1] && !labels[p - 1]) { labels[p - 1] = id; stack.push(p - 1); }
      if (x < w - 1 && on[p + 1] && !labels[p + 1]) { labels[p + 1] = id; stack.push(p + 1); }
      if (y > 0 && on[p - w] && !labels[p - w]) { labels[p - w] = id; stack.push(p - w); }
      if (y < h - 1 && on[p + w] && !labels[p + w]) { labels[p + w] = id; stack.push(p + w); }
    }
    if (area < minArea) { for (const p of members) labels[p] = 0; continue; }
    next++;
    pieces.push({ id, x0, y0, x1, y1, cx: sx / area, cy: sy / area, area, contour: trace(labels, w, h, s, id, step) });
    if (next >= 65535) break;
  }
  return { w, h, labels, pieces };
}

/** Moore 鄰域輪廓追蹤：從這塊在光柵順序裡的第一個像素（一定在外輪廓上）出發，繞一圈回來。 */
function trace(labels: Uint16Array, w: number, h: number, start: number, id: number, step: number) {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === id;
  // 八個方向（順時針，從西邊開始）
  const DX = [-1, -1, 0, 1, 1, 1, 0, -1], DY = [0, -1, -1, -1, 0, 1, 1, 1];
  const sx0 = start % w, sy0 = (start / w) | 0;
  const pts: { x: number; y: number }[] = [];
  let x = sx0, y = sy0, dir = 0; // 從西邊（一定是空的）開始找
  const maxIt = 4 * (w + h) * 8 + 10000;
  for (let it = 0; it < maxIt; it++) {
    pts.push({ x: x + 0.5, y: y + 0.5 });
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + k) % 8;
      const nx = x + DX[d]!, ny = y + DY[d]!;
      if (inside(nx, ny)) {
        x = nx; y = ny;
        // 下一次從「來的方向往回轉兩格」開始找（Moore 追蹤的標準做法）
        dir = (d + 6) % 8;
        found = true;
        break;
      }
    }
    if (!found) break; // 只有一個像素
    if (x === sx0 && y === sy0 && pts.length > 2) break;
  }
  // 抽稀：每 step 個點取一個
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < pts.length; i += step) out.push(pts[i]!);
  if (out.length > 1) out.push(out[0]!);
  return out;
}

/** 一塊的遮罩（只有這塊的像素是白的），剪紙的紙片、篆刻的逐塊刻掉用。回傳的畫布座標跟 Pieces 一樣。 */
export function pieceCanvas(P: Pieces, piece: Piece, pad = 2): { cv: HTMLCanvasElement; x: number; y: number } {
  const x = Math.max(0, piece.x0 - pad), y = Math.max(0, piece.y0 - pad);
  const w = Math.min(P.w, piece.x1 + pad + 1) - x, h = Math.min(P.h, piece.y1 + pad + 1) - y;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d')!;
  const img = c.createImageData(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (P.labels[(y + j) * P.w + (x + i)] !== piece.id) continue;
    const o = (j * w + i) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = img.data[o + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  return { cv, x, y };
}

/** 輪廓的總長與依弧長取點（剪刀沿著輪廓走）。 */
export function contourAt(pts: { x: number; y: number }[], u: number): { x: number; y: number; a: number } {
  if (pts.length < 2) return { x: pts[0]?.x ?? 0, y: pts[0]?.y ?? 0, a: 0 };
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  let s = Math.max(0, Math.min(1, u)) * total;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!, L = Math.hypot(b.x - a.x, b.y - a.y);
    if (s <= L || i === pts.length - 1) {
      const k = L > 0 ? Math.min(1, s / L) : 0;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, a: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    s -= L;
  }
  const l = pts[pts.length - 1]!;
  return { x: l.x, y: l.y, a: 0 };
}

/** 文字裡中日韓字的比例（決定要不要直排）。 */
export function cjkRatio(s: string) {
  const cs = Array.from(s.replace(/\s/g, ''));
  if (!cs.length) return 0;
  return cs.filter((ch) => /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯]/u.test(ch)).length / cs.length;
}


/**
 * 跟 fitText 一樣找最大字級，但最後一行只剩一兩個字（「……更愛對／方。」）時把字級縮一點重排：
 * 孤零零的一個字在大螢幕上很顯眼。最多試六次，縮到最小字級就算了。
 */
export function fitMsg(c: CanvasRenderingContext2D, text: string, family: string, w: number, h: number, o: { min?: number; max?: number; lineHeight?: number; maxLines?: number } = {}): FitResult {
  const first = fitText(c, text, family, w, h, o);
  const orphan = (f: FitResult) => f.lines.length > 1 && Array.from(f.lines[f.lines.length - 1]!.replace(/[\s，。！？、,.!?~～…]/g, '')).length <= 2;
  // 整則很短（兩行以內）就不管：縮小也改不了（「新婚／快樂！！！」），只會白白變小
  if (!orphan(first) || first.lines.length <= 2) return first;
  let fit = first;
  for (let k = 0; k < 6 && fit.size > (o.min ?? 20) + 2; k++) {
    const next = fitText(c, text, family, w, h, { ...o, max: fit.size - 3 });
    if (next.size < (o.min ?? 20)) break;
    fit = next;
    if (!orphan(fit)) return fit;
  }
  // 縮到最後還是孤字：用原本最大的字級
  return first;
}
