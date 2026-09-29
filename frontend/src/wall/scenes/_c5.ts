// 批次 C5（居家＋音樂：coffee、movie、laundry、paperplane、duet、guitar）共用的小工具。
// 每個版面都有的兩件事抽出來，六個版面的進場與寫字節奏才一致：
//  - 紙偶進場：從側面翻正（puppetIn），腳邊一點仙女棒的火花（全片的母題）。
//  - 主打留言寫在場景物件上：第一個拍點起一個字一個字寫上去，寫完署名淡入（標準 v2 的字級由 noteV2 排好）。
import type { LineBatch } from '../engine/lines';
import { clamp, prog } from '../engine/util';
import { sparkHead, sparkParticles, msgChars } from './_motifs';
import { puppetIn } from './_puppet';
import { drawNote, type Note, type Pt } from './_couple';

export const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';

/** 紙偶進場（t0 起 dur 秒）：回傳給 drawPuppet 的 spin／alpha；還沒輪到回傳 null。火花噴在 (x, y)（通常是腳邊）。 */
export function enterPuppet(glow: LineBatch, t: number, t0: number, x: number, y: number, seed: number, dur = 0.42): { spin: number; alpha: number } | null {
  const e = puppetIn(t, t0, dur);
  if (e.alpha <= 0) return null;
  if (e.k < 1) {
    sparkHead(glow, x, y, t, 0.7);
    sparkParticles(glow, t, () => ({ x, y }), { rate: 50, life: 0.25, speed: 140, seed });
  }
  return { spin: e.spin, alpha: e.alpha };
}

/**
 * 主打留言逐字寫上去：t0 開始、整段約 dur 秒寫完（每字 0.03～0.1 秒），寫完 0.1 秒後署名淡入。
 * 沒有留言時（邀請文字）一次全部出現、用淡色。回傳筆尖（給粉筆灰、火花接）。
 */
export function writeNote(c: CanvasRenderingContext2D, n: Note, x: number, y: number, t: number, t0: number,
  o: { msg: boolean; color: string; faint: string; sig: string; dur?: number; align?: 'left' | 'center' }): Pt | null {
  const total = msgChars(n.fit);
  const per = clamp((o.dur ?? 1.6) / Math.max(1, total), 0.03, 0.1);
  const done = t0 + total * per;
  return drawNote(c, n, x, y, {
    chars: o.msg ? (t - t0) / per : Infinity, color: o.msg ? o.color : o.faint, sigColor: o.sig, sigK: o.msg ? prog(t, done + 0.1, done + 0.5) : 1, align: o.align,
  });
}

/** 留言寫完的時間（版面用來排「寫完之後」的小事件）。 */
export function noteDone(n: Note, t0: number, dur = 1.6): number {
  const total = msgChars(n.fit);
  return t0 + total * clamp(dur / Math.max(1, total), 0.03, 0.1);
}
