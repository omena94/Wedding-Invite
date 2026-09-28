// 批次 T5（紙本 E ＋ 螢幕 A：notebook、stickynotes、chat、desktop、search、phone）共用的小工具。
// 這六個版面的手法各不相同，共用的只有「時間骨架」（第一拍、小節線、窗格裡有哪幾句歌詞）與幾個畫圖的小零件，
// 放在一起是為了讓六個版面的節拍感一致：東西都在拍點上彈出、在小節線上換狀態。
import type { AudioData } from '../engine/audio';
import { Lyrics, type Line } from '../engine/lyrics';
import { clamp, ease } from '../engine/util';
import { beatAfter, barAfter } from './_motifs';

/** 窗格的節拍骨架。b0：第一拍；bar0：第一個小節線（太晚就用第二拍）；beat：拍長；bars：窗格裡的小節線。 */
export interface Grid { b0: number; bar0: number; beat: number; bar: number; bars: number[]; beats: number[] }

export function grid(au: AudioData, start: number, end: number): Grid {
  const b0 = beatAfter(au, start + 0.05);
  const beat = Math.max(0.25, au.beatPeriod(b0));
  let bar0 = barAfter(au, start + 0.05);
  // 第一個小節線要等太久（剛好切在小節中間）就用第二拍，事情才不會拖到第二小節
  if (bar0 - b0 > beat * 2.5) bar0 = b0 + beat;
  const bars: number[] = [], beats: number[] = [];
  for (let i = Math.ceil(au.barAt(start) - 1e-6), k = 0; k < 64; i++, k++) { const x = au.timeOfBar(i); if (x >= end) break; if (x >= start) bars.push(x); }
  for (let i = Math.ceil(au.beatAt(start) - 1e-6), k = 0; k < 256; i++, k++) { const x = au.timeOfBeat(i); if (x >= end) break; if (x >= start) beats.push(x); }
  const bar = bars.length > 1 ? bars[1]! - bars[0]! : beat * 4;
  return { b0, bar0, beat, bar, bars, beats };
}

/** t 之前（含）最近的一個時間點（例如最近的拍點），都還沒到就回傳 -Infinity。 */
export function lastOf(ts: number[], t: number): number {
  let r = -Infinity;
  for (const x of ts) { if (x <= t) r = x; else break; }
  return r;
}

/** 彈出：t0 開始、dur 秒內用 outBack 從 0 到 1（中間會稍微超過 1）。 */
export const pop = (t: number, t0: number, dur = 0.32, s = 1.9) => (t <= t0 ? 0 : t >= t0 + dur ? 1 : ease.outBack((t - t0) / dur, s));

/** 窗格裡會出現的歌詞行（start 前 lead 秒到 end 後 hold 秒有重疊的），依時間排。 */
export function windowLines(ly: Lyrics, start: number, end: number, lead = 0.35, hold = 1.2): Line[] {
  return ly.lines.filter((l) => l.start - lead < end && l.end + hold > start);
}

/** 一行歌詞在 t 時唱到第幾個字元（UTF-16，給打字機／逐字出現用）與正在唱的字。 */
export function lineState(line: Line, t: number): { chars: number; active: { o: number; len: number } | null } {
  let active: { o: number; len: number } | null = null;
  for (const w of line.words) {
    const p = Lyrics.wordProgress(w, t);
    if (p > 0 && p < 1) { active = { o: w.o, len: w.w.length }; break; }
  }
  return { chars: Lyrics.lineCharProgress(line, t), active };
}

/** 圓角矩形的路徑（不填不描，呼叫的人決定）。 */
export function rrect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
}

/** 圓角矩形的外框點（從左上角圓弧結束處順時針一圈），給火花沿框跑用。 */
export function rrectPts(x: number, y: number, w: number, h: number, r: number, seg = 6): { x: number; y: number }[] {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const out: { x: number; y: number }[] = [];
  const corners: [number, number, number][] = [[x + w - r, y + r, -Math.PI / 2], [x + w - r, y + h - r, 0], [x + r, y + h - r, Math.PI / 2], [x + r, y + r, Math.PI]];
  out.push({ x: x + r, y });
  for (const [cx, cy, a0] of corners) for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * (Math.PI / 2); out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }); }
  out.push({ x: x + r, y });
  return out;
}

/** 沿著折線畫到 u（0..1），回傳筆尖的位置；u 在 0 或 1 回傳 null（不用畫火花）。用目前的 strokeStyle。 */
export function tracePolyline(c: CanvasRenderingContext2D, pts: { x: number; y: number }[], u: number): { x: number; y: number } | null {
  if (u <= 0) return null;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  const len = total * Math.min(1, u);
  let acc = 0, head = pts[0]!;
  c.beginPath(); c.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!, sl = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + sl <= len) { c.lineTo(b.x, b.y); acc += sl; head = b; continue; }
    const k = sl > 0 ? (len - acc) / sl : 0;
    head = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    c.lineTo(head.x, head.y);
    break;
  }
  c.stroke();
  return u >= 1 ? null : head;
}

export const pad = (n: number, k = 3) => String(Math.max(0, Math.floor(n))).padStart(k, '0');
/** 秒 → 「m:ss」。 */
export const mss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${pad(Math.max(0, s) % 60, 2)}`;

/** 名字的第一個字（大頭貼用）；沒填名字用愛心。英文名取第一個字母大寫。 */
export function initial(name: string): string {
  const s = name.trim();
  if (!s) return '♥';
  const ch = Array.from(s)[0]!;
  return /[a-z]/i.test(ch) ? ch.toUpperCase() : ch;
}

/** 彈簧到位的量（0 → 1，略為超過再回來），給捲動、推擠用；t0 之前是 0。 */
export function settle(t: number, t0: number, freq = 2.6, damping = 0.62) {
  if (t <= t0) return 0;
  const w = Math.PI * 2 * freq, x = t - t0;
  return clamp(1 - Math.exp(-damping * w * x) * Math.cos(w * Math.sqrt(1 - damping * damping) * x), -0.2, 1.2);
}
