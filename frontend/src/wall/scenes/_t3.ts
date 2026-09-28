// 批次 T3（紙本 C：blueprint、crossword、sheetmusic、almanac、reportcard、warranty）共用的小工具。
// 六個版面的手法各不相同（藍圖的繪圖筆、報紙的鉛筆、樂譜的刻版、3D 撕頁日曆、印泥、打孔卡），
// 共用的只有「時間骨架」（第一拍、小節線、n 個東西在時限內依拍點出完）、窄框裡的逐字跟唱排版、
// 烤一次就好的紙纖維貼圖、小圖層貼回全螢幕的參數，以及 mono／中文小標籤。
import * as THREE from 'three';
import { FSPass, makeRT, W, H, SCALE } from '../engine/gl';
import type { AudioData } from '../engine/audio';
import type { Line, Lyrics } from '../engine/lyrics';
import { F, font } from '../engine/type';
import { rgba } from '../engine/palette';
import { fitText, type FitResult } from '../engine/text';
import { clamp, mulberry32 } from '../engine/util';
import { beatAfter, barAfter, layoutMessage, type LyricLayout, type LyricStyle } from './_motifs';

export type Rect = [number, number, number, number];
export type P2 = { x: number; y: number };

/** 右下角 HUD（QR）：版面的字不要進到 x ≥ 1360 且 y ≥ 830。 */
export const HUD = { x: 1360, y: 830 };
/** 投影機會裁邊：字離四邊至少 96 px。 */
export const EDGE = 96;

export const pad3 = (n: number) => String(Math.max(0, Math.floor(n))).padStart(3, '0');

/** 一張只蓋住畫面一部分的圖層（左上 x,y、寬高 w,h，邏輯像素、y 向下）貼回全螢幕時，Compositor 要的 UV 縮放與位移。 */
export function subRect(x: number, y: number, w: number, h: number) {
  return {
    scale: [W / w, H / h] as [number, number],
    offset: [(0.5 * W - x) / w - 0.5, (y + 0.5 * h - 0.5 * H) / h] as [number, number],
  };
}

/** 進出場：窗格開始 a 秒淡入、結束前 b 秒淡出。 */
export const inOut = (t: number, s: number, e: number, a = 0.25, b = 0.25) => Math.min(clamp((t - s) / a), clamp((e - t) / b));

// ---------------------------------------------------------------- 時間骨架
/** 窗格的節拍骨架。b0：第一拍；bar0：第一個小節線（等太久就用第二拍）；beat、bar：拍長與小節長；bars、beats：窗格裡的小節線與拍點。 */
export interface Grid { b0: number; bar0: number; beat: number; bar: number; bars: number[]; beats: number[] }

export function grid(au: AudioData, start: number, end: number): Grid {
  const b0 = beatAfter(au, start + 0.05);
  const beat = Math.max(0.25, au.beatPeriod(b0));
  let bar0 = barAfter(au, start + 0.05);
  // 切在小節中間時第一個小節線可能要等快一小節：事情不能拖到那麼晚，改用第二拍
  if (bar0 - b0 > beat * 2.5) bar0 = b0 + beat;
  const bars: number[] = [], beats: number[] = [];
  for (let i = Math.ceil(au.barAt(start) - 1e-6), k = 0; k < 64; i++, k++) { const x = au.timeOfBar(i); if (x >= end) break; if (x >= start) bars.push(x); }
  for (let i = Math.ceil(au.beatAt(start) - 1e-6), k = 0; k < 256; i++, k++) { const x = au.timeOfBeat(i); if (x >= end) break; if (x >= start) beats.push(x); }
  const bar = bars.length > 1 ? bars[1]! - bars[0]! : beat * 4;
  return { b0, bar0, beat, bar, bars, beats };
}

/**
 * n 個東西依序出現的時間：從 t0 開始，一拍 1、2、4 或 8 個，挑最慢、但能在 maxDur 秒內出完的那一種
 * （再不夠就平均塞進去）。短留言一拍一個字很有節奏；六十字的長留言在兩小節的窗格裡也一定出得完。
 */
export function stagger(au: AudioData, t0: number, n: number, maxDur: number): number[] {
  if (n <= 0) return [];
  const b0 = au.beatAt(t0);
  const budget = Math.max(0.25, au.beatAt(t0 + Math.max(0.2, maxDur)) - b0);
  const per = n <= 1 ? 1 : [1, 2, 4, 8].find((k) => (n - 1) / k <= budget) ?? (n - 1) / budget;
  return Array.from({ length: n }, (_, i) => au.timeOfBeat(b0 + i / per));
}

/** 窗格裡會出現的歌詞行（start 前 lead 秒到 end 後 hold 秒有重疊的），依時間排。 */
export function windowLines(ly: Lyrics, start: number, end: number, lead = 0.35, hold = 1.2): Line[] {
  return ly.lines.filter((l) => l.start - lead < end && l.end + hold > start);
}

/** t 之前（含）最近的一個時間點；都還沒到回傳 -1（索引）。ts 要由小到大。 */
export function lastIdx(ts: number[], t: number): number {
  let r = -1;
  for (let i = 0; i < ts.length; i++) { if (ts[i]! <= t) r = i; else break; }
  return r;
}

// ---------------------------------------------------------------- 窄框裡的跟唱
const boxCache = new WeakMap<Line, Map<string, LyricLayout>>();

/**
 * 在 w × h 的框裡排一行歌詞（可以折成好幾行，字級在 min～max 之間找最大的），回傳 drawLyric 用的排版。
 * _motifs 的 layoutLyric 最多折兩行、放不下會縮到比 48 px 還小；房間、格子、日曆這種窄框要能折三四行、字不縮。
 * 座標：align = left 時 (0,0) 是框的左緣、第一行基線；center 時 x = 0 是框的中線。
 */
export function boxLyric(c: CanvasRenderingContext2D, line: Line, family: string, w: number, h: number, o: { min?: number; max?: number; lineHeight?: number; align?: 'left' | 'center'; maxLines?: number } = {}): LyricLayout {
  const lh = o.lineHeight ?? 1.16;
  const key = `${family}|${w}|${h}|${o.min}|${o.max}|${lh}|${o.align}|${o.maxLines}`;
  let m = boxCache.get(line);
  if (!m) { m = new Map(); boxCache.set(line, m); }
  const hit = m.get(key);
  if (hit) return hit;
  const min = o.min ?? 48, max = o.max ?? 96;
  let fit: FitResult = fitText(c, line.text, family, w, h, { min, max, lineHeight: lh, maxLines: o.maxLines ?? 99 });
  // 中文歌詞常用空白分詞組（「一首一首歌 一句一句話」）：照詞組分行比較好讀，
  // 只要字級不會比「塞最大」小太多，就寧可在空白處分行（英文字之間的空白不算）
  const parts = line.text.trim().split(/(?<=[㐀-鿿＀-￯、。])\s+|\s+(?=[㐀-鿿])/).filter(Boolean);
  if (parts.length > 1 && parts.length <= (o.maxLines ?? 99)) {
    c.font = font(family, 100);
    const wide = Math.max(...parts.map((p) => c.measureText(p).width)) / 100;
    const size = Math.floor(Math.min(max, w / Math.max(1e-3, wide), h / (1 + (parts.length - 1) * lh)));
    if (size >= min && size >= fit.size * 0.72) {
      c.font = font(family, size);
      fit = { size, lines: parts, lineHeight: size * lh, width: Math.max(...parts.map((p) => c.measureText(p).width)), height: size * (1 + (parts.length - 1) * lh) };
    }
  }
  c.font = font(family, fit.size);
  c.letterSpacing = '0px';
  // 每一行在原句裡從哪個字元開始（wrap 會吃掉行首行尾的空白，所以用 indexOf 往後找）
  const starts: number[] = [];
  let cur = 0;
  for (const r of fit.lines) {
    const i = line.text.indexOf(r, cur);
    const at = i >= 0 ? i : cur;
    starts.push(at);
    cur = at + r.length;
  }
  const out: LyricLayout = { size: fit.size, rows: [], words: [], height: fit.height };
  fit.lines.forEach((r, ri) => {
    const width = c.measureText(r).width;
    const x0 = o.align === 'center' ? -width / 2 : 0;
    out.rows.push({ text: r, x: x0, y: ri * fit.lineHeight, width });
  });
  for (const wd of line.words) {
    let ri = 0;
    for (let k = 0; k < starts.length; k++) if (starts[k]! <= wd.o) ri = k;
    const row = out.rows[ri]!;
    const pre = line.text.slice(starts[ri]!, wd.o);
    out.words.push({ word: wd, x: row.x + (pre ? c.measureText(pre).width : 0), y: row.y, w: c.measureText(wd.w).width });
  }
  m.set(key, out);
  return out;
}

/** 亮版面（紙）上的歌詞顏色：正在唱用訊號色的暗部（淡的訊號色在紙上讀不到）。 */
export const paperLyric = (): Pick<LyricStyle, 'active' | 'sung' | 'unsung'> => ({ active: rgba('blood'), sung: rgba('sepia', 0.95), unsung: rgba('sepia', 0.26) });

/** 留言：短的（八個字以內）不要折行，字大一點；其他照 layoutMessage。 */
export function fitMsg(c: CanvasRenderingContext2D, text: string, family: string, w: number, h: number, o: { min?: number; max?: number; lineHeight?: number } = {}): FitResult {
  const short = Array.from(text).length <= 8;
  const r = layoutMessage(c, text, family, w, h, { min: o.min ?? 44, max: o.max ?? 120, lineHeight: o.lineHeight ?? 1.3, maxLines: short ? 1 : 12 });
  // 一行放不下（八個英文字母以內不太可能）就退回可以折行
  if (short && r.width > w * 1.001) return layoutMessage(c, text, family, w, h, { min: o.min ?? 44, max: o.max ?? 120, lineHeight: o.lineHeight ?? 1.3 });
  return r;
}

// ---------------------------------------------------------------- 標籤
/** 機器的聲音：IBM Plex Mono 小字＋字距。回傳寬度。 */
export function mono(c: CanvasRenderingContext2D, text: string, x: number, y: number, o: { size?: number; color?: string; tracking?: number; align?: 'left' | 'right' | 'center'; weight?: number } = {}): number {
  const size = o.size ?? 15, tr = o.tracking ?? 3;
  c.font = font(F.mono(o.weight ?? 500), size);
  c.letterSpacing = `${tr}px`;
  c.fillStyle = o.color ?? rgba('ash', 0.8);
  const w = c.measureText(text).width;
  const x0 = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
  c.fillText(text, x0, y);
  c.letterSpacing = '0px';
  return w;
}

/** 中文小標籤（思源黑體＋字距），欄位名稱用。回傳寬度。 */
export function tag(c: CanvasRenderingContext2D, text: string, x: number, y: number, o: { size?: number; color?: string; tracking?: number; align?: 'left' | 'right' | 'center'; weight?: number } = {}): number {
  const size = o.size ?? 18, tr = o.tracking ?? 3;
  c.font = font(F.hei(o.weight ?? 500), size);
  c.letterSpacing = `${tr}px`;
  c.fillStyle = o.color ?? rgba('ash', 0.9);
  const w = c.measureText(text).width;
  const x0 = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
  c.fillText(text, x0, y);
  c.letterSpacing = '0px';
  return w;
}

// ---------------------------------------------------------------- 紙纖維（烤一次）
/**
 * 紙的纖維與雲紋，跟顏色無關（換主題不用重烤），整晚只烤一次：r = 明暗（0.5 為中間）、g = 纖維、b = 細點雜訊。
 * 各版面自己的紙 shader 讀這張貼圖再上色，每格只多一次取樣。
 */
const FIBER_BAKE = /* glsl */ `
float fib(vec2 p, float cs) {
  float acc = 0.0;
  vec2 cell = floor(p / cs);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = cell + vec2(float(i), float(j));
    vec2 o = (c + hash22(c)) * cs;
    float a = hash12(c + 7.1) * TAU;
    float L = cs * (0.3 + 1.1 * hash12(c + 3.3));
    vec2 d = vec2(cos(a), sin(a));
    acc += (hash12(c + 9.9) - 0.5) * (1.0 - smoothstep(0.25, 1.3, sdSegment(p, o - d * L * 0.5, o + d * L * 0.5)));
  }
  return acc;
}
void main() {
  vec2 p = vec2(vUv.x * ${W}.0, (1.0 - vUv.y) * ${H}.0);
  float cloud = fbm(p * 0.0021, 4);
  float f = fib(p, 20.0) + 0.6 * fib(p * 1.7 + 31.0, 20.0);
  float speck = hash12(floor(p * 0.5));
  fragColor = vec4(0.5 + 0.5 * cloud, clamp(0.5 + f * 2.0, 0.0, 1.0), speck, 1.0);
}`;

class FiberBake {
  rt = makeRT(W, H, { depthBuffer: false });
  pass = new FSPass(FIBER_BAKE);
  private done = false;
  tex(renderer: THREE.WebGLRenderer) {
    if (!this.done) { this.pass.render(renderer, this.rt); this.done = true; }
    return this.rt.texture;
  }
}
let fiber: FiberBake | null = null;
/** 紙纖維貼圖（第一次呼叫時烤）。 */
export function fiberTex(renderer: THREE.WebGLRenderer): THREE.Texture {
  if (!fiber) fiber = new FiberBake();
  return fiber.tex(renderer);
}

// ---------------------------------------------------------------- 文件攝影機（透視＋景深）
// MV 融合原則：紙本版面不要像「正面、完全靜止的介面截圖」，要像鏡頭拍桌上的一張紙——有透視、會慢慢推、焦點外的地方是虛的。
// 做法：整張文件（字、線、章）畫在一張 Canvas 圖層（文件座標），這個 shader 用單應矩陣把螢幕像素對回文件座標取樣，
// 紙色與纖維、桌面、紙的影子在 shader 裡算；離焦點越遠取樣半徑越大（mipmap＋八點圓盤），就是淺景深。

/** 鏡頭姿勢：文件上的 (x, y) 放在螢幕 (sx, sy)，那一點的縮放 z；roll 是畫面內的旋轉，tilt 是紙的上緣往後倒（弧度），pan 是左右轉。 */
export interface Pose { x: number; y: number; z: number; roll?: number; tilt?: number; pan?: number; sx?: number; sy?: number }

/** 3×3 單應矩陣（列優先）：四邊形 src 的四個角對到 dst 的四個角（DLT，高斯消去）。 */
export function homography(src: P2[], dst: P2[]): number[] {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]!, { x: u, y: v } = dst[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r;
    [A[c], A[p]] = [A[p]!, A[c]!];
    const d = A[c]![c]! || 1e-12;
    for (let k = c; k < 9; k++) A[c]![k]! /= d;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r]![c]!;
      if (f) for (let k = c; k < 9; k++) A[r]![k]! -= f * A[c]![k]!;
    }
  }
  return [A[0]![8]!, A[1]![8]!, A[2]![8]!, A[3]![8]!, A[4]![8]!, A[5]![8]!, A[6]![8]!, A[7]![8]!, 1];
}
export function applyH(m: number[], x: number, y: number): P2 {
  const w = m[6]! * x + m[7]! * y + m[8]!;
  return { x: (m[0]! * x + m[1]! * y + m[2]!) / w, y: (m[3]! * x + m[4]! * y + m[5]!) / w };
}

const DOC_FRAG = (paper: string) => /* glsl */ `
uniform sampler2D tex; uniform sampler2D fiber;
uniform vec2 docSize; uniform mat3 toDoc; uniform vec4 rect; uniform vec2 shOff;
uniform vec2 focus; uniform vec2 focusR; uniform float blurMax; uniform float lodK; uniform float t;
vec4 fib(vec2 d) { return texture(fiber, fract(d / vec2(${W}.0, ${H}.0))); }
${paper}
${/float\s+cut\s*\(/.test(paper) ? '' : 'float cut(vec2 d, float soft) { return 1.0; }'}
const vec2 DISC[8] = vec2[8](vec2(1.0, 0.0), vec2(0.707, 0.707), vec2(0.0, 1.0), vec2(-0.707, 0.707), vec2(-1.0, 0.0), vec2(-0.707, -0.707), vec2(0.0, -1.0), vec2(0.707, -0.707));
float boxMask(vec2 d, vec4 r, float soft) {
  vec2 c = (r.xy + r.zw) * 0.5, h = (r.zw - r.xy) * 0.5;
  return 1.0 - smoothstep(-soft, soft, sdBox(d - c, h));
}
vec4 ink(vec2 d, float lod) {
  vec2 uv = vec2(d.x / docSize.x, 1.0 - d.y / docSize.y);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  vec4 c = textureLod(tex, uv, lod);
  // fast 的 Layer2D：預乘、sRGB 編碼 → 線性預乘
  c.rgb = c.a > 0.0 ? toLinear(c.rgb / c.a) * c.a : vec3(0.0);
  return c;
}
void main() {
  vec2 s = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  vec3 q = toDoc * vec3(s, 1.0);
  vec2 d = q.xy / q.z;
  // 景深：焦點橢圓以內清楚，外面越遠越糊
  float r = blurMax * smoothstep(1.0, 2.6, length((d - focus) / focusR));
  float fp = length(fwidth(d));
  vec4 c;
  if (r < 0.6) c = ink(d, 0.0);
  else {
    float lod = max(0.0, log2(r * lodK));
    c = vec4(0.0);
    for (int i = 0; i < 8; i++) c += ink(d + DISC[i] * r * (i % 2 == 0 ? 1.0 : 0.6), lod);
    c /= 8.0;
  }
  float soft = max(fp, r);
  // cut()：版面自己挖的洞、圓角（打孔、齒孔）；洞裡看得到桌面與紙的影子
  float m = boxMask(d, rect, soft) * cut(d, soft);
  // 紙的影子：往右下、很軟
  float sh = boxMask(d - shOff, rect, 26.0 + soft);
  vec3 desk = deskCol(s, fib(s * 0.7)) * (1.0 - 0.34 * sh * (1.0 - m));
  vec3 col = mix(desk, paperCol(d, fib(d)), m);
  col = col * (1.0 - c.a) + c.rgb;
  fragColor = vec4(col, 1.0);
}`;

/**
 * 文件攝影機。paper：GLSL，定義 vec3 paperCol(vec2 d, vec4 fb)（文件座標的紙色）與 vec3 deskCol(vec2 s, vec4 fb)（螢幕座標的桌面）；
 * 可以再定義 float cut(vec2 d, float soft)（0 = 挖掉，圓角、打孔用），也可以自己宣告 uniform（用 pass.u 設值）。
 * 可以用 uniform float t、focus 與色票。每個版面用自己的 key 共用一個 pass（shared）。
 */
export class DocCam {
  pass: FSPass;
  toScreen: number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  toDoc: number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  constructor(paper: string) {
    this.pass = new FSPass(DOC_FRAG(paper), {
      tex: { value: null }, fiber: { value: null }, docSize: { value: new THREE.Vector2(W, H) }, toDoc: { value: new THREE.Matrix3() },
      rect: { value: new THREE.Vector4(0, 0, W, H) }, shOff: { value: new THREE.Vector2(10, 16) },
      focus: { value: new THREE.Vector2(W / 2, H / 2) }, focusR: { value: new THREE.Vector2(600, 300) }, blurMax: { value: 0 }, lodK: { value: 1 }, t: { value: 0 },
    });
  }

  /** 由鏡頭姿勢算單應矩陣（文件平面 → 螢幕）。f 是焦距（px）：越小透視越強。 */
  pose(p: Pose, docW: number, docH: number, f = 2600) {
    const roll = p.roll ?? 0, tilt = p.tilt ?? 0, pan = p.pan ?? 0, sx = p.sx ?? W / 2, sy = p.sy ?? H / 2;
    const cr = Math.cos(roll), sr = Math.sin(roll), ct = Math.cos(tilt), st = Math.sin(tilt), cp = Math.cos(pan), sp = Math.sin(pan);
    const proj = (u: number, v: number): P2 => {
      const a = u - p.x, b = v - p.y;
      let x = a * cr - b * sr, y = a * sr + b * cr, z = 0;
      // tilt：上緣（y < 0）往後倒 → 離鏡頭遠
      z = -y * st; y = y * ct;
      const x2 = x * cp + z * sp; z = -x * sp + z * cp; x = x2;
      const k = f / (f + z);
      return { x: sx + p.z * x * k, y: sy + p.z * y * k };
    };
    const src = [{ x: 0, y: 0 }, { x: docW, y: 0 }, { x: docW, y: docH }, { x: 0, y: docH }];
    const dst = src.map((q) => proj(q.x, q.y));
    this.toScreen = homography(src, dst);
    this.toDoc = homography(dst, src);
  }

  /** 文件座標 → 螢幕座標。 */
  project(x: number, y: number): P2 { return applyH(this.toScreen, x, y); }

  /** 文件上一個矩形投影到螢幕後的外框。 */
  projRect([x, y, w, h]: Rect): Rect {
    const ps = [this.project(x, y), this.project(x + w, y), this.project(x, y + h), this.project(x + w, y + h)];
    const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    return [Math.round(x0), Math.round(y0), Math.round(Math.max(...xs) - x0), Math.round(Math.max(...ys) - y0)];
  }

  /**
   * 畫到 out（整張覆蓋）。tex：文件圖層的貼圖（fast、要開 mipmap）、docW/docH 文件大小（邏輯 px）、texScale 圖層每個文件 px 幾個貼圖 px；
   * rect：紙的範圍（文件座標）；focus／focusR：焦點（文件座標）與清楚的橢圓半徑；blur：焦外最大模糊半徑（文件 px）。
   */
  render(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, o: { tex: THREE.Texture; docW: number; docH: number; texScale: number; rect?: Rect; focus: P2; focusR: [number, number]; blur: number; t?: number; shadow?: [number, number] }) {
    const u = this.pass.u;
    u.tex!.value = o.tex;
    u.fiber!.value = fiberTex(renderer);
    (u.docSize!.value as THREE.Vector2).set(o.docW, o.docH);
    const m = this.toDoc;
    (u.toDoc!.value as THREE.Matrix3).set(m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!, m[6]!, m[7]!, m[8]!);
    const r = o.rect ?? [0, 0, o.docW, o.docH];
    (u.rect!.value as THREE.Vector4).set(r[0], r[1], r[0] + r[2], r[1] + r[3]);
    (u.shOff!.value as THREE.Vector2).set(...(o.shadow ?? [12, 20]));
    (u.focus!.value as THREE.Vector2).set(o.focus.x, o.focus.y);
    (u.focusR!.value as THREE.Vector2).set(o.focusR[0], o.focusR[1]);
    u.blurMax!.value = o.blur;
    u.lodK!.value = o.texScale * 0.7;
    u.t!.value = o.t ?? 0;
    this.pass.render(renderer, out);
  }
}

/** 文件圖層開 mipmap（焦外取樣用粗一點的 mip，景深才便宜又滑）。圖層要是 fast 的。 */
export function withMips<T extends { texture: THREE.Texture }>(L: T): T {
  L.texture.generateMipmaps = true;
  L.texture.minFilter = THREE.LinearMipmapLinearFilter;
  return L;
}

// ---------------------------------------------------------------- 印章
/**
 * 一個印章圖案（訊號色的暗部當印泥）：圓框或方框、字（四個字照印章的排法：右起直行）、圓章外圈的小字、缺墨的小洞與一邊比較淡。
 * 畫在自己的小畫布上（size：外框直徑／邊長，邏輯 px），版面每格只 drawImage。seed 決定缺墨的樣子（確定性）。
 */
export function inkStamp(text: string, size: number, round: boolean, seed: number, ring?: string): HTMLCanvasElement {
  const s = SCALE * 1.4, pad = 8;
  const cv = document.createElement('canvas');
  cv.width = cv.height = Math.ceil((size + pad * 2) * s);
  const c = cv.getContext('2d')!;
  c.scale(s, s);
  const cx = size / 2 + pad, cy = size / 2 + pad;
  c.strokeStyle = c.fillStyle = rgba('blood', 0.92);
  c.lineWidth = size * 0.055;
  c.beginPath();
  if (round) c.arc(cx, cy, size / 2 - c.lineWidth, 0, Math.PI * 2);
  else c.rect(pad + c.lineWidth, pad + c.lineWidth, size - c.lineWidth * 2, size - c.lineWidth * 2);
  c.stroke();
  if (ring) {
    c.font = font(F.hei(700), size * 0.1);
    const chars = Array.from(ring), r = size / 2 - c.lineWidth * 2.6;
    chars.forEach((ch, i) => {
      const a = -Math.PI / 2 + (i - (chars.length - 1) / 2) * 0.32;
      c.save(); c.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r); c.rotate(a + Math.PI / 2);
      c.textAlign = 'center'; c.fillText(ch, 0, size * 0.035); c.restore();
    });
  }
  const chars = Array.from(text);
  c.textAlign = 'center'; c.textBaseline = 'middle';
  if (chars.length === 4) {
    const fs = size * 0.26, o = fs * 0.56, dy = ring ? fs * 0.25 : 0;
    c.font = font(F.ming(900), fs);
    c.fillText(chars[0]!, cx + o, cy - o + dy); c.fillText(chars[1]!, cx + o, cy + o + dy);
    c.fillText(chars[2]!, cx - o, cy - o + dy); c.fillText(chars[3]!, cx - o, cy + o + dy);
  } else {
    const fs = size * (chars.length === 1 ? 0.58 : 0.4);
    c.font = font(F.ming(900), fs);
    c.fillText(text, cx, cy + fs * 0.04);
  }
  const rnd = mulberry32(seed);
  c.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 90; i++) {
    c.fillStyle = `rgba(0,0,0,${0.25 + 0.6 * rnd()})`;
    c.beginPath(); c.arc(pad + rnd() * size, pad + rnd() * size, 0.6 + rnd() * size * 0.018, 0, Math.PI * 2); c.fill();
  }
  const g = c.createLinearGradient(pad, pad, pad + size, pad + size);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5 + 0.4 * (rnd() - 0.5), 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${0.3 + 0.3 * rnd()})`);
  c.fillStyle = g; c.fillRect(0, 0, size + pad * 2, size + pad * 2);
  return cv;
}
