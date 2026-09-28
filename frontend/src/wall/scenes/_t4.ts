// 批次 T4（紙本 D：invitation、guestbook、manual、nutrition、redenvelope、scratchcard）共用的小工具。
// 六個版面的手法各不相同（three.js 立體、翻頁 shader、等角線稿、字體表格、燙金 shader、刮除遮罩），
// 共用的只有：
//  - 節拍骨架（第一拍、第一個小節線、窗格裡的拍點），讓六個版面的「落點」一致；
//  - n 個東西依序出現的時間表（一拍幾個，n 個在時限內一定出完：兩小節的窗格也讀得完）；
//  - 多行的跟唱歌詞：_motifs 的 layoutLyric 最多折兩行，紙本版面的欄位窄（喜帖內頁、說明書的步驟說明），
//    長的英文句子要折三行才不會縮到 48 px 以下。顏色與時間規則照 drawLyric；
//  - 亮版面的跟唱配色：訊號色在香檳、鼠尾草的紙上太淡，正在唱的字改用 blood（訊號色的暗部），讀得到也還是同一家子；
//  - 燙金的 GLSL（喜帖、紅包共用）：底色偏暗才壓得住亮紙，高光往 ember 走、被箔的皺紋打碎。
//  - 「桌上的紙」舞台（Stage）：照風格聖經的 MV 融合原則，紙本不要是正面、靜止的平面截圖，而是擺在桌上、
//    有透視、有光、有景深的東西。每個版面先把自己的紙（印刷、字、動畫）畫進一張 render target，
//    再交給舞台用透視鏡頭拍：桌面（程序紋理＋紙的影子）、紙面（依深度或指定的焦點區域做景深模糊、打光）。
//    景深用 mipmap：焦外的地方用 textureLod 取比較粗的一層（自己算層數，確定性），再做四點平均讓它不方塊化。
import * as THREE from 'three';
import type { AudioData } from '../engine/audio';
import { Lyrics, type Line, type Word } from '../engine/lyrics';
import { font } from '../engine/type';
import { rgba } from '../engine/palette';
import { fitText, type FitResult } from '../engine/text';
import { clamp, ease } from '../engine/util';
import { makeRT, W, H } from '../engine/gl';
import { GLSL_COMMON, THEME_UNIFORMS } from '../engine/glsl/common';
import { beatAfter, barAfter, fillWithHearts } from './_motifs';

export type Rect = [number, number, number, number];
export type P2 = { x: number; y: number };

/** 右下角 HUD（QR）：版面的字不要進到 x ≥ 1360 且 y ≥ 830。 */
export const HUD = { x: 1360, y: 830 };

// ---------------------------------------------------------------- 節拍骨架
export interface Grid { b0: number; bar0: number; beat: number; bar: number; beats: number[]; bars: number[]; nBars: number }

/** 窗格的節拍骨架。bar0 = 第一個小節線（要等超過兩拍半就改用第二拍，事情才不會拖到第二小節）。 */
export function grid(au: AudioData, start: number, end: number): Grid {
  const b0 = beatAfter(au, start + 0.05);
  const beat = Math.max(0.25, au.beatPeriod(b0));
  let bar0 = barAfter(au, start + 0.05);
  if (bar0 - b0 > beat * 2.5) bar0 = b0 + beat;
  const beats: number[] = [], bars: number[] = [];
  for (let i = Math.ceil(au.beatAt(start) - 1e-6), k = 0; k < 400; i++, k++) { const x = au.timeOfBeat(i); if (x >= end) break; if (x >= start) beats.push(x); }
  for (let i = Math.ceil(au.barAt(start) - 1e-6), k = 0; k < 80; i++, k++) { const x = au.timeOfBar(i); if (x >= end) break; if (x >= start) bars.push(x); }
  const bar = bars.length > 1 ? bars[1]! - bars[0]! : beat * 4;
  return { b0, bar0, beat, bar, beats, bars, nBars: (end - start) / bar };
}

/** t0 起第 k 拍（照真的拍點，不是等距）。 */
export const beatN = (au: AudioData, t0: number, k: number) => au.timeOfBeat(au.beatAt(t0) + k);

/**
 * n 個東西依序出現的時間：從 t0 開始，一拍 1、2、4 或 8 個，挑最慢、但能在 maxDur 秒內出完的那一種
 * （再不夠就平均塞進去）。短的一拍一個很有節奏，長的在短窗格裡也一定出得完。
 */
export function stagger(au: AudioData, t0: number, n: number, maxDur: number): number[] {
  if (n <= 0) return [];
  const b0 = au.beatAt(t0);
  const budget = Math.max(0.25, au.beatAt(t0 + Math.max(0.2, maxDur)) - b0);
  const per = n <= 1 ? 1 : [1, 2, 4, 8].find((k) => (n - 1) / k <= budget) ?? (n - 1) / budget;
  return Array.from({ length: n }, (_, i) => au.timeOfBeat(b0 + i / per));
}

/** t 之前（含）最後一個時間點的索引（都還沒到是 -1）。 */
export function lastIdx(ts: number[], t: number): number {
  let r = -1;
  for (let i = 0; i < ts.length; i++) { if (ts[i]! <= t) r = i; else break; }
  return r;
}

/** 進出場：開頭 fin 秒淡入、結尾 fout 秒淡出。 */
export const inOut = (t: number, s: number, e: number, fin = 0.3, fout = 0.3) => clamp((t - s) / fin) * clamp((e - t) / fout);

/** 彈出：t0 開始、dur 秒內 outBack 0 → 1（中間稍微超過 1）。 */
export const pop = (t: number, t0: number, dur = 0.3, s = 1.8) => (t <= t0 ? 0 : t >= t0 + dur ? 1 : ease.outBack((t - t0) / dur, s));

/** 幾個矩形的外框（給 popupAvoid）。 */
export function bbox(rs: Rect[], pad = 0): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y, w, h] of rs) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h); }
  return [Math.round(x0 - pad), Math.round(y0 - pad), Math.round(x1 - x0 + 2 * pad), Math.round(y1 - y0 + 2 * pad)];
}

/**
 * 留言：在框裡找字級（最小 44 px，遠處的桌子也看得到）。
 * 行數少的優先：只要少一行時字級還有最大字級的六成以上就用少的那個（「新婚快樂！！！」寧可一行 80 px，
 * 也不要為了塞到 118 px 拆成「新婚快／樂！！！」）。
 */
export function fitMsg(c: CanvasRenderingContext2D, text: string, family: string, w: number, h: number, o: { min?: number; max?: number; lineHeight?: number; maxLines?: number } = {}): FitResult {
  const opt = { min: 44, max: 120, lineHeight: 1.3, ...o };
  const full = fitText(c, text, family, w, h, opt);
  for (let n = 1; n < full.lines.length; n++) {
    const f = fitText(c, text, family, w, h, { ...opt, maxLines: n });
    if (f.lines.length <= n && f.size >= opt.max * 0.6) return f;
  }
  return full;
}

/** 畫排好的留言（逐字出現用 chars）；♥ 用點綴色。回傳最後一個出現的字的右緣（給筆尖用）。 */
export function drawFit(c: CanvasRenderingContext2D, fit: FitResult, family: string, x: number, y: number, o: { align?: 'left' | 'center' | 'right'; color?: string; chars?: number } = {}): P2 | null {
  c.save();
  c.font = font(family, fit.size);
  c.textBaseline = 'alphabetic';
  c.fillStyle = o.color ?? rgba('sepia');
  let left = o.chars ?? Infinity, head: P2 | null = null;
  fit.lines.forEach((ln, i) => {
    if (left <= 0) return;
    const chars = Array.from(ln);
    const shown = left >= chars.length ? ln : chars.slice(0, Math.floor(left)).join('');
    left -= chars.length;
    const wFull = c.measureText(ln).width;
    const lx = o.align === 'center' ? x - wFull / 2 : o.align === 'right' ? x - wFull : x;
    const ly = y + i * fit.lineHeight;
    fillWithHearts(c, shown, lx, ly);
    head = { x: lx + c.measureText(shown).width, y: ly - fit.size * 0.35 };
  });
  c.restore();
  return head;
}

// ---------------------------------------------------------------- 多行跟唱歌詞
export interface RowsStyle {
  family: string;
  size: number;
  /** 縮到這裡還放不下才多折一行；折到 maxRows 還放不下才繼續縮。 */
  minSize: number;
  maxW: number;
  maxRows?: number;
  align?: 'left' | 'center' | 'right';
  lineHeight?: number;
  tracking?: number;
}
export interface RowsLayout {
  size: number;
  lineHeight: number;
  rows: { text: string; x: number; y: number; width: number }[];
  words: { word: Word; x: number; y: number; w: number }[];
  /** 第一行基線到最後一行基線 + 一個字高。 */
  height: number;
  width: number;
}

const rowsCache = new WeakMap<Line, Map<string, RowsLayout>>();
let seg: Intl.Segmenter | null = null;
const PUNCT_END = /[\s、。，．,.!?！？：；:;）)」』】〕〉》…～~]$/;

/**
 * 把一行歌詞排成最多 maxRows 行（只在字與字之間斷；優先斷在空白與標點後、其次中文的詞界，不拆詞），
 * 行數用最少的、字級用最大的；回傳每個字的位置（原點 = 第一行基線的對齊點）。同一行同樣式會快取。
 */
export function layoutRows(c: CanvasRenderingContext2D, line: Line, st: RowsStyle): RowsLayout {
  const key = `${st.family}|${st.size}|${st.minSize}|${st.maxW}|${st.maxRows}|${st.align}|${st.lineHeight}|${st.tracking}`;
  let m = rowsCache.get(line);
  if (!m) { m = new Map(); rowsCache.set(line, m); }
  const hit = m.get(key);
  if (hit) return hit;
  const tr = st.tracking ?? 0, maxRows = st.maxRows ?? 3, words = line.words, n = words.length;
  const rowText = (a: number, b: number) => line.text.slice(words[a]!.o, words[b - 1]!.o + words[b - 1]!.w.length);
  const widthAt = (s: string, size: number) => { c.font = font(st.family, size); c.letterSpacing = `${tr}px`; const w = c.measureText(s).width; c.letterSpacing = '0px'; return w; };
  // 斷點的代價：空白、標點後免費；詞界一點點；拆詞很多
  if (!seg) seg = new Intl.Segmenter('zh-Hant', { granularity: 'word' });
  const bounds = new Set<number>();
  for (const s of seg.segment(line.text)) bounds.add(s.index);
  const brk = (k: number) => {
    const before = line.text.slice(0, words[k]!.o);
    if (PUNCT_END.test(before)) return 0;
    return bounds.has(words[k]!.o) ? 0.15 : 0.6;
  };
  /** 固定行數 rows 的最佳斷法（每行留白平方和 + 斷點代價），放不下回 null。 */
  const bestBreaks = (rows: number, size: number): number[] | null => {
    if (rows === 1) return widthAt(line.text, size) <= st.maxW ? [0, n] : null;
    const INF = Infinity;
    const cost: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(n + 1).fill(INF));
    const from: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(n + 1).fill(-1));
    cost[0]![0] = 0;
    // 每個字的起點、終點在整行裡的寬度（量 n 次就好）；一行的寬 = 最後一個字的終點 − 第一個字的起點
    const pS = words.map((w) => widthAt(line.text.slice(0, w.o), size));
    const pE = words.map((w) => widthAt(line.text.slice(0, w.o + w.w.length), size));
    const rw = (a: number, b: number) => pE[b - 1]! - pS[a]!;
    for (let r = 1; r <= rows; r++) for (let j = 1; j <= n; j++) for (let i = j - 1; i >= 0; i--) {
      const w = rw(i, j);
      if (w > st.maxW) break;
      const prev = cost[r - 1]![i]!;
      if (prev === INF) continue;
      const slack = (st.maxW - w) / st.maxW;
      const cc = prev + slack * slack + (j < n ? brk(j) : 0);
      if (cc < cost[r]![j]!) { cost[r]![j] = cc; from[r]![j] = i; }
    }
    if (cost[rows]![n] === INF) return null;
    const out = [n];
    for (let r = rows, j = n; r > 0; r--) { j = from[r]![j]!; out.unshift(j); }
    return out;
  };
  let size = st.size, breaks: number[] | null = null;
  // 先試一行、字級從 size 縮到 minSize；不行就兩行、三行…；都不行就用最多行數再往下縮
  outer: for (let rows = 1; rows <= Math.min(maxRows, n); rows++) {
    for (let s = st.size; s >= st.minSize - 0.01; s *= 0.95) {
      const b = bestBreaks(rows, Math.max(s, st.minSize));
      if (b) { size = Math.max(s, st.minSize); breaks = b; break outer; }
    }
  }
  if (!breaks) {
    const rows = Math.min(maxRows, n);
    for (let s = st.minSize; s > 12; s *= 0.94) { const b = bestBreaks(rows, s); if (b) { size = s; breaks = b; break; } }
    if (!breaks) { size = st.minSize; breaks = [0, n]; }
  }
  const lh = size * (st.lineHeight ?? 1.16);
  const out: RowsLayout = { size, lineHeight: lh, rows: [], words: [], height: size + (breaks.length - 2) * lh, width: 0 };
  for (let r = 0; r + 1 < breaks.length; r++) {
    const a = breaks[r]!, b = breaks[r + 1]!;
    if (a >= b) continue;
    // 行首的空白不算（英文字前面的空白）
    const text = rowText(a, b);
    const width = widthAt(text, size);
    const x0 = st.align === 'center' ? -width / 2 : st.align === 'right' ? -width : 0;
    const y = out.rows.length * lh;
    out.rows.push({ text, x: x0, y, width });
    out.width = Math.max(out.width, width);
    const base = words[a]!.o;
    for (let k = a; k < b; k++) {
      const w = words[k]!;
      const pre = line.text.slice(base, w.o);
      out.words.push({ word: w, x: x0 + (pre ? widthAt(pre, size) + tr : 0), y, w: widthAt(w.w, size) });
    }
  }
  out.height = size + (out.rows.length - 1) * lh;
  m.set(key, out);
  return out;
}

export interface KaraokeInk { active: string; sung: string; unsung: string }
/** 亮版面的跟唱配色：正在唱 blood（訊號色在亮紙上太淡）、唱完墨色、還沒唱三成墨色。 */
export const paperInk = (): KaraokeInk => ({ active: rgba('blood'), sung: rgba('sepia', 0.95), unsung: rgba('sepia', 0.26) });
/** 暗版面的跟唱配色（照 drawLyric）。 */
export const darkInk = (): KaraokeInk => ({ active: rgba('signal'), sung: rgba('bone', 0.96), unsung: rgba('bone', 0.3) });

/**
 * 畫排好的多行歌詞（已經 translate 到對齊點）：字在 word.start 開始由左到右擦亮、正在唱是 active、唱完 sung。
 * 回傳正在唱的字的「筆尖」位置（相對對齊點），沒在唱是 null。
 */
export function drawRows(c: CanvasRenderingContext2D, lay: RowsLayout, family: string, t: number, ink: KaraokeInk, alpha = 1, tracking = 0): P2 | null {
  c.save();
  c.font = font(family, lay.size);
  c.letterSpacing = `${tracking}px`;
  c.textBaseline = 'alphabetic';
  c.textAlign = 'left'; // 字的位置是排好的左緣（置中對齊已經算進 x 裡）
  c.globalAlpha *= alpha;
  let head: P2 | null = null;
  for (const pw of lay.words) {
    const p = Lyrics.wordProgress(pw.word, t);
    if (p < 1) { c.fillStyle = ink.unsung; c.fillText(pw.word.w, pw.x, pw.y); }
    if (p <= 0) continue;
    c.save();
    c.beginPath();
    c.rect(pw.x - lay.size * 0.1, pw.y - lay.size * 1.1, (pw.w + lay.size * 0.2) * p, lay.size * 1.5);
    c.clip();
    c.fillStyle = p < 1 ? ink.active : ink.sung;
    c.fillText(pw.word.w, pw.x, pw.y);
    c.restore();
    if (p < 1) head = { x: pw.x + pw.w * p, y: pw.y - lay.size * 0.35 };
  }
  c.restore();
  return head;
}

// ---------------------------------------------------------------- 燙金（GLSL）
/**
 * 燙金的顏色：spec = 高光強度（0..）、grain = 箔的皺紋（0..1）、emb = 凸版的明暗（-1..1，邊緣受光面亮、背光面暗）。
 * 底色是訊號色往暗部拉（香檳、鼠尾草的訊號色很淡，壓在亮紙上會不見），高光往 ember 走，最亮的點會發一點光。
 */
export const FOIL_GLSL = /* glsl */ `
vec3 foilColor(float spec, float grain, float emb) {
  vec3 base = mix(C_BLOOD, C_SIGNAL, 0.52);
  vec3 col = base * (0.72 + 0.3 * emb) * (0.9 + 0.2 * grain);
  col += mix(C_SIGNAL, C_EMBER, 0.6) * spec * (0.55 + 0.9 * grain);
  return col;
}`;

// ---------------------------------------------------------------- 桌上的紙（Stage）
// 世界座標：x 向右、y 往桌子裡面（畫面上方）、z 離開桌面（朝鏡頭）。單位 = 邏輯像素：
// 鏡頭正上方、距離 camDist(fov) 時，桌面上 1 單位 = 螢幕 1 px。
export type V3 = [number, number, number];

/** 鏡頭在正上方時，桌面 1 單位 = 螢幕 1 px 的距離。 */
export const camDist = (fovDeg: number) => (H / 2) / Math.tan(THREE.MathUtils.degToRad(fovDeg / 2));

/** 紙的 render target（有 mipmap，景深用）。w、h 是紙面的邏輯像素。 */
export const docRT = (w: number, h: number) => makeRT(w, h, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });

const STAGE_VERT = /* glsl */ `
precision highp float;
in vec3 position; in vec2 uv; in vec3 normal;
uniform mat4 modelMatrix; uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix;
out vec2 vUv; out vec3 vW; out vec3 vN; out float vDepth;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

/** 舞台共用的光與焦點（桌面與每張紙用同一組 uniform 物件）。 */
const STAGE_LIGHT = /* glsl */ `
uniform vec4 pool;      // 一盞燈打在桌上的光圈：世界 x、y、半徑、強度（0..1）
uniform vec3 lightDir;  // 主光方向（指向光源）
uniform float focus;    // 焦點的深度（鏡頭空間，單位 = 世界單位）
uniform float aperture; // 光圈：離焦點一倍距離時的模糊直徑（螢幕 px）
uniform float ambient;
float poolLight(vec2 p) { float r = length(p - pool.xy) / pool.z; return mix(1.0, 0.72 + 0.36 * exp(-r * r), pool.w); }
float coc(float depth) { return aperture * abs(depth - focus) / max(depth, 1.0); }
`;

const DOC_FRAG = /* glsl */ `
precision highp float;
precision highp int;
in vec2 vUv; in vec3 vW; in vec3 vN; in float vDepth;
out vec4 fragColor;
${GLSL_COMMON}
${STAGE_LIGHT}
uniform sampler2D tex;
uniform vec2 texPx;     // 貼圖的實際像素
uniform vec2 docPx;     // 紙面的邏輯像素（圓角、邊緣用）
uniform float radius;   // 圓角
uniform vec4 region;    // 焦點區域（紙面 uv 的中心、半徑 px、區外最大模糊 px；w = 0 不用）
uniform float edge;     // 紙緣的暗線（0..1）
uniform float opacity;
uniform vec3 gutter;    // 書溝的陰影：世界 x、寬度、濃度（書本用；其他 0）
uniform float nSign;    // BackSide 的材質：three.js 會把正反面的定義對調（gl_FrontFacing 永遠是 true），法向量要自己反過來
void main() {
  vec2 dp = vUv * docPx;
  // 在螢幕上一個像素跨過幾個貼圖像素 → 基本的 mip 層（放大時是負的）
  vec2 tp = vUv * texPx;
  float lod0 = log2(max(max(length(dFdx(tp)), length(dFdy(tp))), 1e-4));
  float c = coc(vDepth);
  if (region.w > 0.0) {
    float rd = length((vUv - region.xy) * docPx) / region.z;
    c = max(c, region.w * smoothstep(1.0, 2.2, rd));
  }
  float lod = max(0.0, lod0 + log2(max(c * 0.5, 1.0)));
  // 四點平均（半徑跟模糊一起長），讓粗的 mip 層不方塊化
  vec2 o = (c * 0.3) * exp2(max(lod0, 0.0)) / texPx;
  vec4 col = 0.25 * (textureLod(tex, vUv + vec2(o.x, o.y * 0.4), lod) + textureLod(tex, vUv + vec2(-o.x * 0.4, o.y), lod)
    + textureLod(tex, vUv + vec2(-o.x, -o.y * 0.4), lod) + textureLod(tex, vUv + vec2(o.x * 0.4, -o.y), lod));
  // 打光：主光的漫射＋桌上的光圈；紙緣一條很淡的暗線（紙的厚度）
  // 背面（翻頁的紙）法向量要反過來才照得到光
  float dif = max(dot(normalize(vN) * nSign * (gl_FrontFacing ? 1.0 : -1.0), normalize(lightDir)), 0.0);
  float sh = (ambient + (1.0 - ambient) * dif) * poolLight(vW.xy);
  vec2 q = abs(dp - docPx * 0.5) - docPx * 0.5 + radius;
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  sh *= 1.0 - edge * 0.2 * (1.0 - smoothstep(0.0, 3.0, -sd));
  sh *= 1.0 - gutter.z * exp(-abs(vW.x - gutter.x) / gutter.y);
  float a = (1.0 - smoothstep(-0.8, 0.8, sd)) * opacity;
  if (a <= 0.0) discard;
  fragColor = vec4(col.rgb * sh, a);
}`;

/** 桌面：style 0 = 牛皮紙、1 = 淺色木頭、2 = 亞麻布、3 = 深色漆器（暗版面）。紙的影子最多 6 個（圓角矩形）。 */
const TABLE_FRAG = /* glsl */ `
precision highp float;
precision highp int;
in vec2 vUv; in vec3 vW; in vec3 vN; in float vDepth;
out vec4 fragColor;
${GLSL_COMMON}
${STAGE_LIGHT}
uniform int style;
uniform vec4 shA[6];   // 影子：中心 x、y、半寬、半高
uniform vec4 shB[6];   // 角度、模糊、濃度、圓角
void main() {
  vec2 p = vW.xy;
  float c = coc(vDepth);
  float detail = 1.0 / (1.0 + c * 0.25); // 焦外的地方紋理變淡（程序紋理沒辦法取 mipmap）
  vec3 col;
  if (style == 0) {
    col = mix(C_PAPER, C_SEPIA, 0.17) * (0.93 + detail * (0.03 * fbm(p / 300.0, 3) + 0.015 * snoise(p / 9.0)));
  } else if (style == 1) {
    // 木紋：沿 x 拉長的年輪（很淡），加一點細纖維
    float g = fbm(vec2(p.x / 1400.0, p.y / 110.0), 3);
    float ring = sin((p.y + 120.0 * g) / 7.0);
    col = mix(C_PAPER, C_SEPIA, 0.25 + detail * (0.008 * ring + 0.04 * g + 0.01 * snoise(vec2(p.x / 60.0, p.y / 2.5))));
  } else if (style == 2) {
    float wv = sin(p.x * 1.3) * sin(p.y * 1.3);
    col = mix(C_PAPER, C_SEPIA, 0.1) * (0.95 + detail * (0.02 * wv + 0.025 * fbm(p / 200.0, 3)));
  } else {
    float g = fbm(vec2(p.x / 700.0, p.y / 260.0), 3);
    col = C_INK2 * (0.75 + 0.35 * g * detail) + C_BLOOD * 0.025;
  }
  float s = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 A = shA[i], B = shB[i];
    if (B.z <= 0.0) continue;
    vec2 q = rot2(-B.x) * (p - A.xy);
    vec2 d = abs(q) - A.zw + B.w;
    float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - B.w;
    s = max(s, B.z * (1.0 - smoothstep(-B.y, B.y, sd)));
  }
  col *= (1.0 - s) * poolLight(p);
  fragColor = vec4(col, 1.0);
}`;

export interface Shadow { x: number; y: number; w: number; h: number; rot?: number; blur?: number; k?: number; r?: number }

/**
 * 桌上的紙：一個透視鏡頭、一張很大的桌面、幾張紙（或其他網格）。版面自己建網格（docMesh）加進 scene，
 * 每格設好鏡頭（look）、焦點（focus）、影子（shadows），再 render。整個舞台用 shared() 共用（每個版面一個）。
 */
export class Stage {
  scene = new THREE.Scene();
  cam: THREE.PerspectiveCamera;
  /** 桌面與紙共用的光、焦點 uniform（同一組物件）。 */
  U = {
    pool: { value: new THREE.Vector4(0, 0, 1400, 0.6) },
    lightDir: { value: new THREE.Vector3(-0.35, 0.45, 1).normalize() },
    focus: { value: 1000 },
    aperture: { value: 0 },
    ambient: { value: 0.86 },
  };
  tableMat: THREE.RawShaderMaterial;
  table: THREE.Mesh;
  constructor(style: number, fov = 30) {
    this.cam = new THREE.PerspectiveCamera(fov, W / H, 20, 40000);
    this.cam.up.set(0, 1, 0);
    this.tableMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: STAGE_VERT, fragmentShader: TABLE_FRAG,
      uniforms: {
        ...THEME_UNIFORMS, ...this.U, style: { value: style },
        shA: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) },
        shB: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) },
      },
      depthTest: false, depthWrite: false,
    });
    this.table = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000), this.tableMat);
    this.table.frustumCulled = false;
    this.table.renderOrder = -10;
    this.scene.add(this.table);
  }
  /** 紙的材質：tex = 紙的 render target 貼圖（linear），texPx = 它的實際像素，docPx = 紙面的邏輯像素。 */
  docMaterial(tex: THREE.Texture, texPx: [number, number], docPx: [number, number], o: { radius?: number; edge?: number; depthTest?: boolean; depthWrite?: boolean; side?: THREE.Side } = {}) {
    return new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: STAGE_VERT, fragmentShader: DOC_FRAG,
      uniforms: {
        ...THEME_UNIFORMS, ...this.U, tex: { value: tex },
        texPx: { value: new THREE.Vector2(...texPx) }, docPx: { value: new THREE.Vector2(...docPx) },
        radius: { value: o.radius ?? 0 }, region: { value: new THREE.Vector4(0.5, 0.5, 1, 0) }, edge: { value: o.edge ?? 1 }, opacity: { value: 1 },
        gutter: { value: new THREE.Vector3(0, 1, 0) }, nSign: { value: o.side === THREE.BackSide ? -1 : 1 },
      },
      transparent: true, depthTest: o.depthTest ?? false, depthWrite: o.depthWrite ?? o.depthTest ?? false,
      side: o.side ?? THREE.DoubleSide,
    });
  }
  /**
   * 程序上色的網格材質（書皮、盒子的邊之類不需要貼圖的東西）：color 是一段 GLSL 運算式，
   * 可以用 p（世界 xy）、n（世界法向量）與色票 C_*；一樣吃舞台的光與景深（焦外只是把紋理放淡）。
   */
  solidMaterial(color: string, o: { depthTest?: boolean; side?: THREE.Side; depthWrite?: boolean } = {}) {
    return new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: STAGE_VERT,
      fragmentShader: /* glsl */ `
precision highp float;
precision highp int;
in vec2 vUv; in vec3 vW; in vec3 vN; in float vDepth;
out vec4 fragColor;
${GLSL_COMMON}
${STAGE_LIGHT}
uniform float nSign;
void main() {
  vec2 p = vW.xy; vec3 n = normalize(vN) * nSign * (gl_FrontFacing ? 1.0 : -1.0);
  float detail = 1.0 / (1.0 + coc(vDepth) * 0.25);
  vec3 col = ${color};
  float dif = max(dot(n, normalize(lightDir)), 0.0);
  fragColor = vec4(col * (ambient + (1.0 - ambient) * dif) * poolLight(p), 1.0);
}`,
      uniforms: { ...THEME_UNIFORMS, ...this.U, nSign: { value: o.side === THREE.BackSide ? -1 : 1 } },
      depthTest: o.depthTest ?? true, depthWrite: o.depthWrite ?? o.depthTest ?? true, side: o.side ?? THREE.DoubleSide,
    });
  }
  /** 一張平放的紙（w × h，中心在 (x, y)，離桌面 z）。 */
  docMesh(mat: THREE.Material, w: number, h: number, x = 0, y = 0, z = 1, segX = 1, segY = 1) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h, segX, segY), mat);
    m.position.set(x, y, z);
    m.frustumCulled = false;
    this.scene.add(m);
    return m;
  }
  shadows(list: Shadow[]) {
    const A = this.tableMat.uniforms.shA!.value as THREE.Vector4[], B = this.tableMat.uniforms.shB!.value as THREE.Vector4[];
    for (let i = 0; i < 6; i++) {
      const s = list[i];
      if (!s) { B[i]!.set(0, 1, 0, 0); continue; }
      A[i]!.set(s.x, s.y, s.w / 2, s.h / 2);
      B[i]!.set(s.rot ?? 0, s.blur ?? 18, s.k ?? 0.3, s.r ?? 6);
    }
  }
  /**
   * 鏡頭：從 pos 看 target。level = 1 時把鏡頭沿視線轉正，讓桌面上的橫線（世界 x 軸）在畫面上是水平的
   * （斜上方偏一邊往下看時，lookAt 會讓紙上的字一路斜上去，很難讀）；0..1 之間可以留一點點斜。
   */
  look(pos: V3, target: V3, fov?: number, level = 1) {
    if (fov && fov !== this.cam.fov) { this.cam.fov = fov; this.cam.updateProjectionMatrix(); }
    this.cam.position.set(...pos);
    this.cam.lookAt(...target);
    this.cam.updateMatrixWorld();
    if (level > 0) {
      const a = new THREE.Vector3(...target).project(this.cam), b = new THREE.Vector3(target[0] + 50, target[1], target[2]).project(this.cam);
      const ang = Math.atan2((b.y - a.y) * H, (b.x - a.x) * W);
      this.cam.rotateZ(ang * level);
      this.cam.updateMatrixWorld();
    }
    this.table.position.set(target[0], target[1], 0);
  }
  /** 世界座標的一點在鏡頭空間的深度（對焦用）。 */
  depthOf(p: V3) {
    const v = new THREE.Vector3(...p).applyMatrix4(this.cam.matrixWorldInverse);
    return -v.z;
  }
  /** 世界座標 → 螢幕像素（y 向下）。 */
  toScreen(p: V3) {
    const v = new THREE.Vector3(...p).project(this.cam);
    return { x: (v.x * 0.5 + 0.5) * W, y: (0.5 - v.y * 0.5) * H };
  }
  render(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget) {
    renderer.setRenderTarget(out);
    renderer.clearDepth();
    renderer.render(this.scene, this.cam);
  }
}

/** 紙面（左上原點、y 向下的像素）→ 平放在桌上、中心在 (cx, cy) 的世界座標。 */
export const docToWorld = (u: number, v: number, dw: number, dh: number, cx = 0, cy = 0, z = 0): V3 => [cx + u - dw / 2, cy + dh / 2 - v, z];
