// 批次 T10（機器 D：mixer、pianoroll、musicbox、typewriter、morse、crt）共用的小工具：
//  - 小圖層貼回全螢幕（Compositor 只會縮放平移）
//  - 自己的 shader 取樣 fast 的 Layer2D（預乘、sRGB 編碼）時的解碼
//  - 留言一個詞組一拍地出現（落在拍點上，再長的留言也在時限內出完）
//  - 窗格裡有沒有歌詞、歌詞行的清單
import type * as THREE from 'three';
import { W, H } from '../engine/gl';
import type { AudioData } from '../engine/audio';
import type { Lyrics, Line } from '../engine/lyrics';
import { phrases, type FitResult } from '../engine/text';
import { font } from '../engine/type';
import { rgba } from '../engine/palette';
import { fillWithHearts } from '../engine/motifs';
import { stagger } from './_t11';

export type Rect = [number, number, number, number];

/** 把一張只蓋住畫面一部分的圖層（左上 x,y、寬高 w,h，邏輯像素）貼到 out 上。 */
export function blit(comp: { draw: (r: THREE.WebGLRenderer, tex: THREE.Texture, out: THREE.WebGLRenderTarget | null, o?: any) => void }, renderer: THREE.WebGLRenderer,
  tex: THREE.Texture, x: number, y: number, w: number, h: number, out: THREE.WebGLRenderTarget, o: { mode?: 'normal' | 'add' | 'multiply' | 'screen'; opacity?: number; tint?: [number, number, number] } = {}) {
  comp.draw(renderer, tex, out, { ...o, scale: [W / w, H / h], offset: [(0.5 * W - x) / w - 0.5, (y + 0.5 * h - 0.5 * H) / h] });
}

/** GLSL：fast 的 Layer2D 取樣後轉成線性、預乘的顏色（畫布左上 = (0,0)，v 向下）。 */
export const FAST_GLSL = /* glsl */ `
vec4 fastTex(sampler2D tx, vec2 uv) {
  vec4 c = texture(tx, vec2(uv.x, 1.0 - uv.y));
  return c.a > 0.0 ? vec4(toLinear(c.rgb / c.a) * c.a, c.a) : vec4(0.0);
}`;

/**
 * 留言的詞組與出現時間：切成詞組（中文斷詞、標點處斷開），從 t0 起一拍一組（或更密），maxDur 秒內一定出完。
 * 回傳每一組出現的時間與「到這一組為止共幾個字」（給 drawMessage 的 chars 用，空白不算）。
 */
export function phraseSchedule(au: AudioData, text: string, t0: number, maxDur: number, maxLen = 4): { t: number; chars: number }[] {
  const ph = phrases(text, maxLen);
  const ts = stagger(au, t0, ph.length, maxDur);
  let acc = 0;
  return ph.map((p, i) => { acc += Array.from(p.replace(/\s/g, '')).length; return { t: ts[i]!, chars: acc }; });
}

/** 到 t 為止出現了幾個字（phraseSchedule 的結果）。 */
export function charsAt(sched: { t: number; chars: number }[], t: number): number {
  let n = 0;
  for (const s of sched) { if (s.t <= t) n = s.chars; else break; }
  return n;
}

/** 跟 charsAt 一樣，但每一組在 dur 秒內從左到右寫出來（回傳小數，給 drawReveal）。 */
export function revealAt(sched: { t: number; chars: number }[], t: number, dur = 0.12): number {
  let prev = 0;
  for (const s of sched) {
    if (t < s.t) break;
    const k = Math.min(1, (t - s.t) / Math.max(1e-3, dur));
    if (k < 1) return prev + (s.chars - prev) * k;
    prev = s.chars;
  }
  return prev;
}

/** fitChars 的小數版（小數部分照樣留給最後一個字）。 */
export function fitCharsF(lines: string[], nonSpace: number): number {
  if (!Number.isFinite(nonSpace)) return Infinity;
  const w = Math.floor(nonSpace);
  return fitChars(lines, w) + (nonSpace - w);
}

/**
 * drawMessage 的 chars 是照排好的每一行（含行內空白）數的；phraseSchedule 不算空白。
 * 把「不含空白的字數」換成「排好的行裡的字數」。
 */
export function fitChars(lines: string[], nonSpace: number): number {
  if (!Number.isFinite(nonSpace)) return Infinity;
  let left = nonSpace, n = 0;
  for (const ln of lines) {
    for (const ch of Array.from(ln)) {
      if (left <= 0) return n;
      n++;
      if (!/\s/.test(ch)) left--;
    }
  }
  return n;
}

/**
 * 畫排好的留言，只畫到第 shown 個字（可以是小數：最後一個字從左到右「寫」出一部分，像筆或打字的筆觸）。
 * shown 照排好的行數（含行內空白，同 drawMessage）。回傳筆尖位置（寫到哪），全部寫完回傳 null。
 */
export function drawReveal(c: CanvasRenderingContext2D, fit: FitResult, family: string, x: number, y: number, shown: number,
  o: { align?: 'left' | 'center' | 'right'; color?: string } = {}): { x: number; y: number } | null {
  c.save();
  c.font = font(family, fit.size);
  c.textBaseline = 'alphabetic';
  c.fillStyle = o.color ?? rgba('bone');
  let left = shown, pen: { x: number; y: number } | null = null;
  fit.lines.forEach((ln, i) => {
    if (left <= 0) return;
    const chars = Array.from(ln);
    const whole = Math.min(chars.length, Math.floor(left));
    const wFull = c.measureText(ln).width;
    const lx = o.align === 'center' ? x - wFull / 2 : o.align === 'right' ? x - wFull : x;
    const ly = y + i * fit.lineHeight;
    const done = chars.slice(0, whole).join('');
    fillWithHearts(c, done, lx, ly);
    const frac = left - whole;
    if (whole < chars.length && frac > 0) {
      const px = lx + c.measureText(done).width, cw = c.measureText(chars[whole]!).width;
      c.save();
      c.beginPath(); c.rect(px - 2, ly - fit.size * 1.1, (cw + 4) * frac, fit.size * 1.5); c.clip();
      fillWithHearts(c, chars[whole]!, px, ly);
      c.restore();
      pen = { x: px + cw * frac, y: ly - fit.size * 0.35 };
    }
    left -= chars.length;
  });
  c.restore();
  return pen;
}

/** 窗格裡會唱到的歌詞行（前後多抓一點，提早出現、唱完停留的也算）。 */
export function windowLines(lyrics: Lyrics, s: number, e: number): Line[] {
  return lyrics.linesIn(s - 1.2, e + 0.35);
}
