// 批次 D2（韓流日常：kdrama、kpopdance、kbbq、nightsnack、hanbok）共用的小工具。
// 這一批都是雙語版面（spec.bilingual）：有翻譯的歌，歌詞是「中文主行＋原文副行」，兩行寫在場景的同一個物件上（木牌、電視字幕、貼紙…）。
//  - 歌詞排在一個框裡：drawLyric 會自動畫原文（layoutLyric 的 height 算到原文最後一排），照 height 垂直置中，
//    所以沒翻譯的歌只有一行時字就在框的正中間，不會留一個空格子。
//  - 紙偶的姿勢圖還沒畫好時（Codex 在畫）先用現成的頂著，版面照樣能跑、能排版。
import type { Lyrics, Line } from '../engine/lyrics';
import { loadText } from '../engine/type';
import { layoutLyric, drawLyric, lyricSubOf, type LyricStyle, type LyricLayout } from './_motifs';
import { hasPuppet } from './_puppet';

/** 這張姿勢圖有就用，還沒有（Codex 還沒畫）就用現成的那張。 */
export const pose = (name: string, fallback: string) => (hasPuppet(name) ? name : fallback);

/** 窗格裡會唱到的歌詞（中文與原文）先把字型載好：韓文的字型要另外下載，第一格才不會用備援字型。 */
export async function loadLyricGlyphs(lyrics: Lyrics, t0: number, t1: number): Promise<void> {
  const ls = lyrics.linesIn(t0 - 2, t1 + 2);
  const text = ls.map((l) => l.text + (lyricSubOf(l)?.text ?? '')).join('');
  if (text) await loadText(text);
}

/**
 * 在框 (x, y, w, h) 裡畫一行歌詞（含原文副行），水平照 st.align、垂直置中（照 layoutLyric 的 height，含原文）。
 * 回傳排版（算光、算位置用）。st.maxWidth 由呼叫的人給（通常是框寬）。
 */
export function drawLyricIn(c: CanvasRenderingContext2D, line: Line, t: number, st: LyricStyle, box: { x: number; y: number; w: number; h: number }, alpha = 1): LyricLayout {
  const lay = layoutLyric(c, line, st);
  const ax = st.align === 'center' ? box.x + box.w / 2 : st.align === 'right' ? box.x + box.w : box.x;
  // (0,0) 是第一排的基線；height 從第一排字頂（基線上方一個字高）算到最後一排基線，下面再留一點給字的下緣
  const top = box.y + Math.max(0, (box.h - lay.height - lay.size * 0.2) / 2) + lay.size;
  c.save();
  c.translate(ax, top);
  drawLyric(c, line, t, st, lay, alpha);
  c.restore();
  return lay;
}
