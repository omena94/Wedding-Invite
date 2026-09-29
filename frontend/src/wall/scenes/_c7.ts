// 批次 C7（工程師 × 護理師：debug、nightshift、stethoscope、whiteboard、bandaid、servers）共用的小工具。
// 六個版面都有的幾件事抽出來，進場、寫字節奏、打光才一致：
//  - 紙偶進場：從側面翻正（puppetIn），腳邊一點仙女棒的火花（全片的母題）。
//  - 主打留言寫在場景物件上：從 t0 起一個字一個字寫上去，寫完署名淡入（標準 v2 的字級由 noteV2 排好）。
//  - 側光：螢幕、機櫃燈、門縫的光是從側面打來的，puppetLight 只有上下；這裡補一個左右的漸層，只染已經畫上去的紙偶。
//  - 窗格的節奏：一律用「第幾個小節線」排事件，窗格短時把後面的事件往前擠（每個版面都要在 2～16 小節都成立）。
import type { AudioData } from '../engine/audio';
import type { LineBatch } from '../engine/lines';
import { clamp, prog } from '../engine/util';
import { sparkHead, sparkParticles, msgChars } from './_motifs';
import { puppetIn } from './_puppet';
import { drawNote, type Note, type Pt } from './_couple';

export const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';

/** 紙偶進場（t0 起 dur 秒）：回傳給 drawPuppet 的 spin／alpha；還沒輪到回傳 null。火花噴在 (x, y)（通常是腳邊）。 */
export function enter(glow: LineBatch, t: number, t0: number, x: number, y: number, seed: number, dur = 0.42): { spin: number; alpha: number } | null {
  const e = puppetIn(t, t0, dur);
  if (e.alpha <= 0) return null;
  if (e.k < 1) {
    sparkHead(glow, x, y, t, 0.7);
    sparkParticles(glow, t, () => ({ x, y }), { rate: 50, life: 0.25, speed: 140, seed });
  }
  return { spin: e.spin, alpha: e.alpha };
}

/** 逐字寫留言：每個字幾秒（整段約 dur 秒，每字 0.03～0.1 秒）。 */
const perChar = (n: Note, dur: number) => clamp(dur / Math.max(1, msgChars(n.fit)), 0.03, 0.1);

/**
 * 主打留言逐字寫上去：t0 開始，寫完 0.1 秒後署名淡入。沒有留言時（邀請文字）一次全部出現、用淡色。
 * 回傳筆尖（給游標、火花接）。
 */
export function writeNote(c: CanvasRenderingContext2D, n: Note, x: number, y: number, t: number, t0: number,
  o: { msg: boolean; color: string; faint: string; sig: string; dur?: number; align?: 'left' | 'center' }): Pt | null {
  const per = perChar(n, o.dur ?? 1.6);
  const done = t0 + msgChars(n.fit) * per;
  return drawNote(c, n, x, y, {
    chars: o.msg ? (t - t0) / per : Infinity, color: o.msg ? o.color : o.faint, sigColor: o.sig, sigK: o.msg ? prog(t, done + 0.1, done + 0.5) : 1, align: o.align,
  });
}

/** 留言寫完的時間（版面用來排「寫完之後」的小事件）。 */
export const noteDone = (n: Note, t0: number, dur = 1.6) => t0 + msgChars(n.fit) * perChar(n, dur);

/**
 * 側光：只染已經畫上去的像素（source-atop），從 from 那一側亮（light）往另一側暗（dark）。
 * 紙偶畫完、同一層還沒畫別的東西時呼叫（跟 puppetLight 一樣的規矩）。box = [x, y, w, h]；fromRight = 光從右邊來。
 */
export function sideLight(c: CanvasRenderingContext2D, box: readonly [number, number, number, number], light: string, dark: string, fromRight = true): void {
  const [x, y, w, h] = box;
  c.save();
  c.globalCompositeOperation = 'source-atop';
  const g = c.createLinearGradient(fromRight ? x + w : x, 0, fromRight ? x : x + w, 0);
  g.addColorStop(0, light);
  g.addColorStop(1, dark);
  c.fillStyle = g;
  c.fillRect(x, y, w, h);
  c.restore();
}

/**
 * 這個窗格的小節線：從 start 之後（留 lead 秒進場）的第一個小節線起，列出窗格結束前的每一個小節線。
 * 版面用 bars[i] 排事件；太短的窗格（只有 1～2 個）就把事件擠在一起。至少回傳一個（沒有小節線時用下一拍）。
 */
export function barsIn(au: AudioData, start: number, end: number, lead = 0.45): number[] {
  const out: number[] = [];
  let b = Math.ceil(au.barAt(start + lead) - 1e-6);
  for (let k = 0; k < 64; k++, b++) {
    const t = au.timeOfBar(b);
    if (t > end - 0.15) break;
    out.push(t);
  }
  if (!out.length) out.push(au.timeOfBeat(Math.ceil(au.beatAt(start + lead) - 1e-6)));
  return out;
}

/** 陣列裡第 i 個（超出範圍夾到最後一個）。 */
export const at = <T>(xs: readonly T[], i: number): T => xs[clamp(i, 0, xs.length - 1)]!;
