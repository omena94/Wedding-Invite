// 批次 T18（遊戲 B ＋ 儀器：fortune、firecracker、countdown、compass、thermometer）共用的小工具。
// 五個版面的手法各不相同（three.js 的桌上 3D、粒子＋閃光打光、擠出的 3D 數字、整張程序化的金屬 shader、
// 先畫成一張再用鏡頭拍的景深），共用的只有：
//  - 這個窗格要用到的字一次載好（留言、署名、歌詞、歌名、版面自己的字）：沒載到的字第一格會用備援字型，確定性就不過；
//  - 「揭曉」的時間：每個版面都有一個「那一下」（籤掉出來、鞭炮炸完、倒數歸零、蓋子打開、溫度計爆表），
//    要在第一個拍點之後一兩小節內發生（留言才來得及讀完），而且最好落在小節線上；
//  - 一些小常數（HUD 區、邀請的說法）。
import type { AudioData } from '../engine/audio';
import type { Msg, SceneCtx } from '../engine/scene';
import { loadText } from '../engine/type';
import { clamp } from '../engine/util';
import { signature } from './_motifs';

/** 右下角 HUD（QR）：字不要進到 x ≥ 1360 且 y ≥ 830。 */
export const HUD = { x: 1360, y: 830 };

/** 這批版面固定會出現的字（符號、數字、拉丁字也要先載，不然第一格會用系統字）。 */
export const T18_TEXT = '掃描右下角把你的祝福寫上大螢幕一位賓客新郎新娘新人留言第籤上上解曰虛位以待幸福東南西北度純音樂間奏中'
  + '0123456789０１２３４５６７８９°·—…（）()：:，。！？♥NSEW℃ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** 窗格會用到的字一次載好（留言、署名、窗格裡的歌詞、歌名，加上版面自己的字）。 */
export async function loadWindow(ctx: SceneCtx, extra = ''): Promise<void> {
  const m = ctx.params.message as Msg | null | undefined;
  const ly = ctx.lyrics.linesIn(ctx.start - 2, ctx.end + 1).map((l) => l.text).join('');
  await loadText(T18_TEXT + extra + (m ? m.text + signature(m.name) : '') + ly + (ctx.song?.title ?? '') + (ctx.song?.artist ?? ''));
}

/**
 * 「揭曉」的時間：從第一拍 b0 起算，窗格拍數的三成左右（至少 minB 拍、最多 maxB 拍），
 * 範圍內有小節線就對齊最後一條小節線（重的那一下落在小節線上最有力）。
 */
export function revealAt(au: AudioData, b0: number, end: number, o: { minB?: number; maxB?: number; frac?: number } = {}): number {
  const beat = Math.max(0.25, au.beatPeriod(b0));
  const nb = (end - b0) / beat;
  const minB = o.minB ?? 2, maxB = o.maxB ?? 6;
  const want = clamp(Math.round(nb * (o.frac ?? 0.3)), minB, maxB);
  const ib0 = au.beatAt(b0);
  let tr = au.timeOfBeat(ib0 + want);
  // 範圍內最後一條小節線
  for (let k = want; k >= minB; k--) {
    const tk = au.timeOfBeat(ib0 + k);
    const bar = au.barAt(tk);
    if (Math.abs(bar - Math.round(bar)) < 0.02) { tr = tk; break; }
  }
  return tr;
}

/** 窗格裡 [t0, t1) 的拍點時間。 */
export function beatsBetween(au: AudioData, t0: number, t1: number): number[] {
  const out: number[] = [];
  for (let b = Math.ceil(au.beatAt(t0) - 1e-3), k = 0; k < 512; b++, k++) {
    const tb = au.timeOfBeat(b);
    if (tb >= t1 - 1e-3) break;
    if (tb >= t0 - 1e-3) out.push(tb);
  }
  return out;
}
