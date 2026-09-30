// 批次 D1（雙語・一起去旅行：seoultrip、hanriver、subwayride、firstsnow、lovelocks）共用的小工具。
import { layoutLyric, drawLyric, lyricSubOf, type LyricStyle, type LyricLayout } from './_motifs';
import type { Line } from '../engine/lyrics';

/**
 * 在一個固定的框裡畫雙語歌詞（中文主行＋原文副行），垂直置中：有原文時兩行一起置中，沒有原文時中文一行置中（不留空位）。
 * (x, top, w, h)：框（對齊點在 st.align：left = x、center = x + w/2）。回傳排版（高度、字級）與正在唱的字的筆尖。
 */
export function drawBilingualIn(
  c: CanvasRenderingContext2D, line: Line, t: number, st: LyricStyle,
  box: { x: number; top: number; w: number; h: number }, alpha = 1, dx = 0,
): { lay: LyricLayout; head: { x: number; y: number } | null; base: number } {
  const lay = layoutLyric(c, line, { ...st, maxWidth: Math.min(st.maxWidth, box.w) });
  const ax = st.align === 'center' ? box.x + box.w / 2 : st.align === 'right' ? box.x + box.w : box.x;
  // 第一排基線：整塊（含原文）在框裡垂直置中；字的上緣約在基線上 0.8 個字高
  const base = box.top + (box.h - lay.height) / 2 + lay.size * 0.82;
  c.save();
  c.translate(ax + dx, base);
  const h = drawLyric(c, line, t, st, lay, alpha);
  c.restore();
  return { lay, head: h ? { x: h.x + ax + dx, y: h.y + base } : null, base };
}

/** 這一行有沒有原文副行。 */
export const hasSub = (line: Line) => !!lyricSubOf(line);
