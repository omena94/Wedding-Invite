// 批次 T24（台灣味與小物：tea 奉茶、bubbletea 珍珠奶茶、baking 烤蛋糕、festival 廟會燈籠、trivision 三面翻看板、vending 販賣機）
// 共用的小工具。六個版面的手法各不相同（俯拍茶席的 shader、側拍杯子的 shader＋珍珠變字、烤箱＋擠花字模、Canvas 燈籠串、
// three.js 三角柱、three.js 滾動的罐子），共用的只有：
//  - 這一格要顯示哪一句歌詞：正在唱的；兩句之間先放下一句（淡淡的），窗格裡沒有下一句就留著剛唱完的——
//    畫面上放歌詞的物件（杯套、招牌、價格標籤）才不會突然空掉；
//  - 署名字串（新人的留言寫「新人」）。
// （三面翻與販賣機的抗鋸齒目標用引擎的 sharedMSAA()：全引擎共用一張，不要各批各留一張。）
import type { Lyrics, Line } from '../engine/lyrics';
import type { Msg } from '../engine/scene';
import { clamp } from '../engine/util';
import { lyricAt, signature } from './_motifs';

export type Rect = [number, number, number, number];
export type P2 = { x: number; y: number };

/** 右下角 HUD（QR）：字不要進到 x ≥ 1360 且 y ≥ 830。 */
export const HUD = { x: 1360, y: 830 };

/** 署名：新人自己的留言寫「—— 新人」，其他照 signature()。 */
export const sigOf = (m: Msg) => (m.couple ? '—— 新人' : signature(m.name));

/**
 * 這一格要放的歌詞行：
 *  - live = true：正在唱（或剛唱完、還在 hold 裡），k 是進出場係數；
 *  - live = false：兩句之間，先放窗格裡的下一句（還沒唱，全部是淡的），沒有下一句就留著剛唱完的（全部唱完的顏色）。
 * 窗格裡根本沒有歌詞（純音樂）回傳 null。
 */
export function shownLyric(lyrics: Lyrics, t: number, s: number, e: number): { line: Line; k: number; live: boolean } | null {
  const ly = lyricAt(lyrics, t);
  if (ly) return { line: ly.line, k: ly.k, live: true };
  const nx = lyrics.nextLine(t);
  if (nx && nx.start < e) return { line: nx, k: clamp((t - s) / 0.3), live: false };
  const ls = lyrics.lastLine(t);
  if (ls && ls.end > s - 6) return { line: ls, k: 1, live: false };
  return null;
}
