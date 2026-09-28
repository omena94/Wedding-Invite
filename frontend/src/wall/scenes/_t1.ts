// 批次 T1（紙本 A：登機證、護照、發票、電報、號外、信封）共用的小工具。
// 六個都是亮版面（紙放在桌上），所以共用的是「紙」這件事：
//  - 紙上的訊號色：色票的訊號色（香檳、鼠尾草）在奶茶色的紙上常常淡到看不見，照 certificate 的印泥做法
//    把穿透率拉到次方，顏色變飽和、讀得到，但仍然是這首歌的訊號色（換主題跟著變）。
//  - 紙上的跟唱：正在唱 = 紙上的訊號色、唱完 = 墨色（sepia）、還沒唱 = 三成的墨。
//  - 桌面 + 圖層合成 + 紙纖維的 shader：Canvas2D 畫好的一整層（fast 上傳）疊在桌面上，再一起吃紙的纖維，
//    字才像「印在紙上」而不是貼在螢幕上。紙纖維只烤一次（整晚共用，只存明暗，換主題不用重烤）。
//  - 預先畫好的畫布（不變的底圖畫一次）、陰影貼圖、條碼、手寫遮罩、節拍工具。
import * as THREE from 'three';
import { FSPass, makeRT, W, H, scaleContext2D } from '../engine/gl';
import { HEX, LIN, rgba } from '../engine/palette';
import { clamp, hash, mulberry32 } from '../engine/util';
import { font } from '../engine/type';
import { drawHeart } from '../engine/motifs';
import type { AudioData } from '../engine/audio';
import type { LyricStyle } from './_motifs';
import { fitText, type FitResult } from '../engine/text';

type Ctx2 = CanvasRenderingContext2D;
export type Rect = [number, number, number, number];

// ---------------------------------------------------------------- 顏色
const toSrgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
/** 紙上的訊號色（Canvas2D）：紙色 ×（訊號色 / 紙色）^k。k 越大越濃。 */
export function sigInk(a = 1, k = 2.6): string {
  const s = LIN.signal, p = LIN.paper;
  const ch = [0, 1, 2].map((i) => Math.round(255 * clamp(toSrgb(p[i]! * Math.pow(clamp(s[i]! / Math.max(p[i]!, 1e-4), 0.004, 1), k)))));
  return `rgba(${ch.join(',')},${a})`;
}
/** 紙上的墨（深咖啡）。 */
export const ink = (a = 1) => rgba('sepia', a);
/** 紙色本身。 */
export const paper = (a = 1) => rgba('paper', a);
/** 熱的墨冷卻：k=1 是紙上的訊號色、k=0 是墨色（感熱紙、剛蓋的章）。 */
export function heatInk(k: number, a = 1): string {
  const h = sigInk(1).match(/\d+/g)!.map(Number), s = rgba('sepia').match(/\d+/g)!.map(Number);
  const kk = clamp(k);
  return `rgba(${[0, 1, 2].map((i) => Math.round(s[i]! + (h[i]! - s[i]!) * kk)).join(',')},${a})`;
}
/** 主題的指紋：預先畫好的畫布如果是用另一組主題畫的，就要重畫（窗格理論上不會跨歌，這是保險）。 */
export const themeKey = () => `${HEX.paper}|${HEX.sepia}|${HEX.signal}|${HEX.rose}`;

// ---------------------------------------------------------------- 跟唱
/** 紙上的跟唱樣式（顏色照跟唱規則換成紙上的版本）。 */
export function paperLyric(family: string, size: number, maxWidth: number, o: Partial<LyricStyle> = {}): LyricStyle {
  return { family, size, minSize: 48, maxWidth, active: sigInk(), sung: ink(0.95), unsung: ink(0.28), ...o };
}

/**
 * 排留言：跟 fitText 一樣找最大字級，但短短一句（「新婚快樂！！！」）寧可小一點排成一行，
 * 也不要大大地折成「新婚快／樂！！！」。一行的字級不小於 oneLine（預設 max 的六成）就用一行。
 */
export function fitMsg(c: Ctx2, text: string, family: string, w: number, h: number, o: { min: number; max: number; lineHeight: number; maxLines: number; oneLine?: number }): FitResult {
  const one = fitText(c, text, family, w, h, { ...o, maxLines: 1 });
  c.font = font(family, one.size);
  if (one.lines.length === 1 && c.measureText(text).width <= w * 1.001 && one.size >= (o.oneLine ?? o.max * 0.6)) return one;
  return fitText(c, text, family, w, h, o);
}

/**
 * 在一個 ♥ 字的位置畫我們自己的愛心（風格聖經：不用字型裡的 ♥）：用目前的 font 量那個字的框，愛心放在框中間。
 * 逐字畫字的版面（打字、列印、寫字）遇到 ♥ 就呼叫這個，跟 fillWithHearts 的大小一致。
 */
export function heartGlyph(c: Ctx2, x: number, y: number, fill = rgba('rose')) {
  const m = c.measureText('♥');
  const h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  const cy = y - (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  drawHeart(c, x + m.width / 2, cy, Math.min(m.width, h * 1.15) * 0.92, fill);
}

// ---------------------------------------------------------------- 畫布
/** 一張離屏畫布，繪圖座標用邏輯像素（res 倍的實際解析度：旋轉縮放時字還是銳利）。 */
export function makeCanvas(w: number, h: number, res = 1.5): { cv: HTMLCanvasElement; c: Ctx2; w: number; h: number } {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w * res));
  cv.height = Math.max(1, Math.round(h * res));
  const c = scaleContext2D(cv.getContext('2d')!, res);
  c.textBaseline = 'alphabetic';
  return { cv, c, w, h };
}
/** 釋放離屏畫布（一張好幾 MB，窗格結束馬上還）。 */
export function freeCanvas(x: { cv: HTMLCanvasElement } | null | undefined) { if (x) x.cv.width = x.cv.height = 0; }

/**
 * 紙片的陰影：一張預先模糊好的圓角矩形（邊緣留 pad），畫的時候跟紙片用同一個變換，往下偏一點。
 * Canvas2D 的 shadowBlur 每格算很貴，這樣只要一次 drawImage。
 */
export function shadowSprite(w: number, h: number, blur = 18, r = 8) {
  const pad = blur * 2.5;
  const s = makeCanvas(w + pad * 2, h + pad * 2, 0.5);
  s.c.filter = `blur(${blur}px)`;
  s.c.fillStyle = 'rgba(0,0,0,1)';
  s.c.beginPath(); s.c.roundRect(pad, pad, w, h, r); s.c.fill();
  s.c.filter = 'none';
  return { ...s, pad };
}
/** 畫陰影（已經在紙片的座標系裡）：dx/dy 偏移、a 濃度（用墨色染）。 */
export function drawShadow(c: Ctx2, sp: ReturnType<typeof shadowSprite>, dx: number, dy: number, a: number) {
  c.save();
  c.globalAlpha *= a;
  c.drawImage(sp.cv, -sp.pad + dx, -sp.pad + dy, sp.w, sp.h);
  c.restore();
}

/** 一維條碼（窄寬交錯，看起來像 Code 128；不是真的編碼，也掃不出東西，不會跟右下角的 QR 搶）。 */
export function drawBarcode(c: Ctx2, x: number, y: number, w: number, h: number, seed: number, color = ink(0.92)) {
  c.save();
  c.fillStyle = color;
  let cx = x;
  let i = 0;
  const unit = w / 110;
  // 起始、中間、結束的護線（高一點）
  const guard = (gx: number) => { c.fillRect(gx, y, unit, h + 6); c.fillRect(gx + unit * 2, y, unit, h + 6); };
  guard(cx); cx += unit * 4;
  while (cx < x + w - unit * 5) {
    const bw = unit * (1 + Math.floor(hash(seed, i, 1) * 3));
    const gap = unit * (1 + Math.floor(hash(seed, i, 2) * 2.5));
    if (cx + bw > x + w - unit * 5) break;
    c.fillRect(cx, y, bw, h);
    cx += bw + gap;
    i++;
  }
  guard(x + w - unit * 3);
  c.restore();
}

/**
 * 手寫的遮罩：一個字從左上往右下斜斜地「寫出來」（跟 sparkler 的仙女棒寫字同一個手法）。
 * r = 0..1 這個字寫到哪。回傳筆尖位置。
 */
export function writeGlyph(c: Ctx2, ch: string, x: number, y: number, size: number, w: number, r: number, skew = 0.55): { x: number; y: number } | null {
  if (r <= 0) return null;
  if (r >= 1) { c.fillText(ch, x, y); return null; }
  const top = y - size * 0.95, h = size * 1.2, S = r * (w + skew * h);
  c.save();
  c.beginPath();
  c.moveTo(x - 8, top - 8); c.lineTo(x + S + 8 * skew, top - 8); c.lineTo(x + S - skew * (h + 8), top + h + 8); c.lineTo(x - 8, top + h + 8);
  c.closePath(); c.clip();
  c.fillText(ch, x, y);
  c.restore();
  return { x: x + clamp(S - skew * h * 0.5, 0, w), y: top + h * 0.5 };
}

// ---------------------------------------------------------------- 橡皮章
let grungeCv: HTMLCanvasElement | null = null;
/**
 * 橡皮章的「缺墨」遮罩（alpha：1 = 有墨、0 = 沒吃到墨）：大塊的壓力不均＋細小的白點＋邊緣毛躁。
 * 用 hash 的值雜訊算一次（確定性），整晚共用；每個章取不同的位置與角度，看起來就不一樣。
 */
export function grunge(): HTMLCanvasElement {
  if (grungeCv) return grungeCv;
  const N = 640;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const c = cv.getContext('2d')!;
  const img = c.createImageData(N, N);
  // 值雜訊：每個尺度先把格點的亂數算好（一張表），每個像素只做雙線性內插——逐像素算 hash 要好幾百毫秒
  const layer = (scale: number, seed: number) => {
    const n = Math.ceil(N / scale) + 2;
    const g = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) g[j * n + i] = hash(i, j, seed);
    return (x: number, y: number) => {
      const fx = x / scale, fy = y / scale, ix = Math.floor(fx), iy = Math.floor(fy);
      const u = fx - ix, v = fy - iy, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
      const a = g[iy * n + ix]!, b = g[iy * n + ix + 1]!, cc = g[(iy + 1) * n + ix]!, d = g[(iy + 1) * n + ix + 1]!;
      return (a + (b - a) * su) * (1 - sv) + (cc + (d - cc) * su) * sv;
    };
  };
  const p1 = layer(90, 1), p2 = layer(31, 2), f1 = layer(5, 3), m1 = layer(14, 5);
  const rnd = mulberry32(4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const press = p1(x, y) * 0.6 + p2(x, y) * 0.4;
    let a = clamp((press - 0.22) / 0.2) * clamp((f1(x, y) - 0.08) / 0.18);
    if (rnd() > 0.985) a *= 0.15;
    a *= 0.78 + 0.22 * m1(x, y);
    const i = (y * N + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = Math.round(255 * clamp(a));
  }
  c.putImageData(img, 0, 0);
  grungeCv = cv;
  return cv;
}

/**
 * 畫一個「蓋上去」的章：draw 在以 (0,0) 為中心、w×h 的範圍裡畫章面（用章的墨色），再用缺墨遮罩挖掉一些。
 * 回傳一張離屏畫布，之後用 multiply 疊到紙上（章壓在別的章或字上時，墨會疊色，像真的）。wear = 缺墨的程度（0..1）。
 */
export function inkStamp(w: number, h: number, seed: number, draw: (c: Ctx2) => void, res = 1.25, wear = 1) {
  const s = makeCanvas(w, h, res);
  s.c.save();
  s.c.translate(w / 2, h / 2);
  draw(s.c);
  s.c.restore();
  if (wear > 0) {
    const g = grunge();
    s.c.save();
    s.c.globalCompositeOperation = 'destination-in';
    s.c.globalAlpha = 1;
    const k = Math.max(w, h) * 1.05;
    s.c.translate(w / 2, h / 2);
    s.c.rotate(hash(seed, 1) * Math.PI * 2);
    s.c.drawImage(g, -k / 2 - hash(seed, 2) * 40, -k / 2 - hash(seed, 3) * 40, k + 40, k + 40);
    s.c.restore();
    // wear < 1：缺墨的地方補回一點墨（大章要讀得到，不能缺太多）
    if (wear < 1) {
      s.c.save();
      s.c.globalCompositeOperation = 'destination-over';
      s.c.globalAlpha = 1 - wear;
      s.c.translate(w / 2, h / 2);
      draw(s.c);
      s.c.restore();
    }
  }
  return s;
}

/** 沿著圓弧排字（章的外圈字）：center = 字串中點的角度（0 = 正右、-π/2 = 正上），top = 字頭朝外（上半圈）。 */
export function arcText(c: Ctx2, text: string, r: number, center: number, fam: string, size: number, track = 2, top = true) {
  const chars = Array.from(text);
  c.save();
  c.font = font(fam, size);
  c.textAlign = 'center';
  c.textBaseline = top ? 'alphabetic' : 'top';
  const ws = chars.map((ch) => c.measureText(ch).width + track);
  const total = ws.reduce((a, b) => a + b, 0) - track;
  let a = center - ((top ? 1 : -1) * total) / 2 / r;
  for (let i = 0; i < chars.length; i++) {
    const half = ws[i]! / 2 / r;
    a += (top ? 1 : -1) * half;
    c.save();
    c.rotate(a);
    c.translate(r, 0);
    c.rotate(top ? Math.PI / 2 : -Math.PI / 2);
    c.fillText(chars[i]!, 0, 0);
    c.restore();
    a += (top ? 1 : -1) * half;
  }
  c.restore();
}

/**
 * 讓出主執行緒一下：窗格是在前一個窗格播放時預先建的，init 裡比較重的步驟（畫大張的離屏畫布、上傳貼圖）之間讓一下，
 * 正在播的畫面才不會掉格（不影響畫面內容，只影響什麼時候做）。
 */
export const yieldFrame = () => new Promise<void>((r) => setTimeout(r, 0));

// ---------------------------------------------------------------- 節拍
/** [t0, t1) 之間的拍點時間。 */
export function beatsIn(au: AudioData, t0: number, t1: number): number[] {
  const out: number[] = [];
  for (let k = Math.ceil(au.beatAt(t0) - 1e-6); ; k++) {
    const tt = au.timeOfBeat(k);
    if (tt >= t1 - 1e-6) break;
    out.push(tt);
    if (out.length > 4000) break;
  }
  return out;
}
/** [t0, t1) 之間的小節線。 */
export function barsIn(au: AudioData, t0: number, t1: number): number[] {
  const out: number[] = [];
  for (let k = Math.ceil(au.barAt(t0) - 1e-6); ; k++) {
    const tt = au.timeOfBar(k);
    if (tt >= t1 - 1e-6) break;
    out.push(tt);
    if (out.length > 1000) break;
  }
  return out;
}
/** 最接近 t 的「半拍格」時間（動作對齊八分音符用）。 */
export const snapHalf = (au: AudioData, t: number) => au.timeOfBeat(Math.ceil(au.beatAt(t) * 2 - 1e-6) / 2);

// ---------------------------------------------------------------- 即時小卡要避開的範圍
/** 把紙面座標的矩形經過（平移、旋轉、縮放）變成螢幕上的外接矩形。 */
export function xfRect(r: Rect, tx: number, ty: number, rot: number, s = 1, pad = 10): Rect {
  const cs = Math.cos(rot) * s, sn = Math.sin(rot) * s;
  const pts = [[r[0], r[1]], [r[0] + r[2], r[1]], [r[0], r[1] + r[3]], [r[0] + r[2], r[1] + r[3]]].map(([x, y]) => [tx + cs * x! - sn * y!, ty + sn * x! + cs * y!]);
  const xs = pts.map((p) => p[0]!), ys = pts.map((p) => p[1]!);
  const x0 = clamp(Math.min(...xs) - pad, 0, W), y0 = clamp(Math.min(...ys) - pad, 0, H);
  return [x0, y0, clamp(Math.max(...xs) + pad, 0, W) - x0, clamp(Math.max(...ys) + pad, 0, H) - y0];
}

// ---------------------------------------------------------------- 紙的 shader
/** fast 的 Layer2D 在自己的 shader 裡取樣：解預乘、轉線性、再預乘。 */
export const FAST_TEX_GLSL = /* glsl */ `
vec4 fastTex(sampler2D t, vec2 uv) {
  vec4 c = texture(t, uv);
  c.rgb = c.a > 0.0 ? toLinear(c.rgb / c.a) * c.a : vec3(0.0);
  return c;
}`;

/** 紙纖維（整晚共用、只算一次）：r = 紙的明暗倍率、g = 雲紋、b = 細雜訊、a = 纖維。 */
const BAKE_FRAG = /* glsl */ `
float fibres(vec2 p, float cs) {
  float acc = 0.0;
  vec2 cell = floor(p / cs);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = cell + vec2(float(i), float(j));
    vec2 h = hash22(c);
    vec2 o = (c + h) * cs;
    float a = hash12(c + 7.1) * TAU;
    float L = cs * (0.3 + 1.1 * hash12(c + 3.3));
    vec2 d = vec2(cos(a), sin(a));
    float dist = sdSegment(p, o - d * L * 0.5, o + d * L * 0.5);
    acc += (hash12(c + 9.9) - 0.5) * (1.0 - smoothstep(0.25, 1.3, dist));
  }
  return acc;
}
void main() {
  vec2 pp = vec2(vUv.x * ${W}.0, (1.0 - vUv.y) * ${H}.0);
  float cloud = fbm(pp * 0.0024, 4);
  float mid = snoise(pp * 0.02);
  float fib = fibres(pp, 22.0) + 0.6 * fibres(pp * 1.7 + 31.0, 22.0);
  float speck = step(0.99965, hash12(floor(pp * 0.5)));
  float paper = (0.975 + 0.03 * cloud + 0.008 * mid + 0.05 * fib) * (1.0 - speck * 0.35);
  fragColor = vec4(sat((paper - 0.8) / 0.4), 0.5 + 0.5 * cloud, 0.5 + 0.5 * snoise(pp * 0.31), sat(fib * 4.0));
}`;

/** 紙纖維貼圖（邏輯 1920×1080、1 倍，整晚共用；第一次用到時烤）。 */
export const paperBake = () => shared_bake;
const shared_bake: { rt: THREE.WebGLRenderTarget | null; done: boolean } = { rt: null, done: false };
export function ensureBake(renderer: THREE.WebGLRenderer): THREE.Texture {
  if (!shared_bake.rt) shared_bake.rt = makeRT(W, H, { pxScale: 1, type: THREE.UnsignedByteType, depthBuffer: false });
  if (!shared_bake.done) {
    const p = new FSPass(BAKE_FRAG);
    p.render(renderer, shared_bake.rt);
    renderer.setRenderTarget(null);
    p.dispose();
    shared_bake.done = true;
  }
  return shared_bake.rt.texture;
}

/**
 * 桌面 + 一層 Canvas2D（fast）+ 紙纖維的合成。桌面是紙色往墨色靠 tone（牛皮紙的調子），
 * 雲紋讓它不是一片平的；fib 是纖維對整張畫面（連字一起）的影響，字才像印在紙上。
 * extra：各版面自己加在桌面上的 GLSL（桌面的圖樣，寫成 `vec3 deskArt(vec2 p, vec3 desk)`，p 是 y 向下的邏輯像素）。
 */
export function paperPass(extra = 'vec3 deskArt(vec2 p, vec3 desk) { return desk; }', extraUniforms: Record<string, THREE.IUniform> = {}) {
  return new FSPass(/* glsl */ `
    uniform sampler2D layer; uniform sampler2D bake; uniform float tone; uniform float fib; uniform float t;
    ${FAST_TEX_GLSL}
    ${extra}
    void main() {
      vec2 p = vec2(vUv.x * ${W}.0, (1.0 - vUv.y) * ${H}.0);
      vec4 bk = texture(bake, vUv);
      vec3 desk = mix(C_PAPER, C_SEPIA, tone) * (0.93 + 0.14 * bk.g);
      desk = deskArt(p, desk);
      vec4 L = fastTex(layer, vUv);
      vec3 col = desk * (1.0 - L.a) + L.rgb;
      col *= mix(1.0, 0.8 + 0.4 * bk.r, fib);
      // 斜斜打過來的光：左上亮一點
      col *= 0.97 + 0.05 * (vUv.y * 0.6 + (1.0 - vUv.x) * 0.4);
      fragColor = vec4(col, 1.0);
    }`, { layer: { value: null }, bake: { value: null }, tone: { value: 0.1 }, fib: { value: 1 }, t: { value: 0 }, ...extraUniforms });
}

// ---------------------------------------------------------------- 桌面上的鏡頭（MV 化）
// 紙本版面不要是「一張正對鏡頭的平面截圖」：紙擺在桌上，鏡頭從斜上方看（透視）、慢慢推近，
// 焦點在留言上，太遠、太近的地方失焦（景深），一盞燈照在焦點附近（光池），四周自然暗下去。
// 版面照舊把紙與字畫在「桌面座標」（跟以前的螢幕座標一樣，1920×1080）的一張 Canvas2D 上，
// 鏡頭在 tablePass 的 shader 裡做：每個螢幕像素打一條光線到桌面（z = 0）、算出桌面座標與深度，
// 深度離焦點越遠就用越大的圓盤取樣模糊。tilt = 0、dist = TABLE_F、對準中心時跟以前的畫面一模一樣。

/** 鏡頭的焦距（像素）：約 35° 的垂直視角，透視不誇張。 */
export const TABLE_F = (H / 2) / Math.tan((35 * Math.PI) / 180 / 2);

export interface TableCam {
  /** 對準桌面上的哪一點（桌面座標）。 */
  tu: number; tv: number;
  /** 鏡頭到那一點的距離（TABLE_F = 一比一）。 */
  dist: number;
  /** 俯角：0 = 正上方往下看；越大越像坐在桌前看（上方往遠處退）。弧度。 */
  tilt: number;
  /** 繞桌面法線轉（紙在畫面裡看起來反方向轉）。弧度。 */
  yaw: number;
  /** 鏡頭自己歪一點。弧度。 */
  roll?: number;
}
type V3 = [number, number, number];
const rotZ = (v: V3, a: number): V3 => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]];

/** 鏡頭的位置與三個方向（右、畫面往下、前）。 */
export function camBasis(c: TableCam): { C: V3; R: V3; D: V3; F: V3 } {
  let R: V3 = [1, 0, 0];
  let D: V3 = [0, Math.cos(c.tilt), -Math.sin(c.tilt)];
  let F: V3 = [0, -Math.sin(c.tilt), -Math.cos(c.tilt)];
  R = rotZ(R, c.yaw); D = rotZ(D, c.yaw); F = rotZ(F, c.yaw);
  const r = c.roll ?? 0;
  if (r) {
    const cr = Math.cos(r), sr = Math.sin(r);
    const R2: V3 = [R[0] * cr + D[0] * sr, R[1] * cr + D[1] * sr, R[2] * cr + D[2] * sr];
    const D2: V3 = [D[0] * cr - R[0] * sr, D[1] * cr - R[1] * sr, D[2] * cr - R[2] * sr];
    R = R2; D = D2;
  }
  const C: V3 = [c.tu - F[0] * c.dist, c.tv - F[1] * c.dist, -F[2] * c.dist];
  return { C, R, D, F };
}

/** 桌面座標 → 螢幕座標（z = 深度）。 */
export function project(c: TableCam, u: number, v: number) {
  const b = camBasis(c);
  const q: V3 = [u - b.C[0], v - b.C[1], -b.C[2]];
  const z = q[0] * b.F[0] + q[1] * b.F[1] + q[2] * b.F[2];
  return { x: W / 2 + (TABLE_F * (q[0] * b.R[0] + q[1] * b.R[1] + q[2] * b.R[2])) / z, y: H / 2 + (TABLE_F * (q[0] * b.D[0] + q[1] * b.D[1] + q[2] * b.D[2])) / z, z };
}
export const lerpCam = (a: TableCam, b: TableCam, k: number): TableCam => ({
  tu: a.tu + (b.tu - a.tu) * k, tv: a.tv + (b.tv - a.tv) * k, dist: Math.exp(Math.log(a.dist) + (Math.log(b.dist) - Math.log(a.dist)) * k),
  tilt: a.tilt + (b.tilt - a.tilt) * k, yaw: a.yaw + (b.yaw - a.yaw) * k, roll: (a.roll ?? 0) + ((b.roll ?? 0) - (a.roll ?? 0)) * k,
});

/** 螢幕上可以放字的範圍：離四邊 96 px，而且不能進右下角 QR 區。 */
const SAFE = { x0: 96, y0: 96, x1: W - 96, y1: H - 96, qx: 1360, qy: 830 };
/** 一個桌面座標的矩形投影到螢幕後，是否完全在安全範圍內。 */
export function rectSafe(c: TableCam, r: Rect) {
  const pts = [[r[0], r[1]], [r[0] + r[2], r[1]], [r[0], r[1] + r[3]], [r[0] + r[2], r[1] + r[3]]].map(([u, v]) => project(c, u!, v!));
  const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
  const y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y));
  if (x0 < SAFE.x0 || y0 < SAFE.y0 || x1 > SAFE.x1 || y1 > SAFE.y1) return false;
  return !(x1 > SAFE.qx && y1 > SAFE.qy);
}
/**
 * 把鏡頭往後拉（dist 變大）到所有重要的字（桌面座標的矩形）都在安全範圍內為止。
 * 推近的鏡頭在留言很長、換行很多時會把字推出畫面；用這個保證任何長度都讀得到。
 */
export function fitCam(c: TableCam, rects: Rect[], maxDist = TABLE_F * 1.6): TableCam {
  const ok = (d: number) => rects.every((r) => rectSafe({ ...c, dist: d }, r));
  if (ok(c.dist)) return c;
  let lo = c.dist, hi = maxDist;
  if (!ok(hi)) return { ...c, dist: hi };
  for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (ok(m)) hi = m; else lo = m; }
  return { ...c, dist: hi };
}

/**
 * 桌面鏡頭的合成 pass：光線打到桌面 → 桌面座標 → 取 Canvas2D 層（景深模糊）＋ 桌面（紙纖維）＋ 燈光。
 * 層是 fast 的 Layer2D，範圍是桌面座標 0..W × 0..H（可以是比較高的解析度）。
 * extra：版面自己的桌面圖樣 `vec3 deskArt(vec2 p, vec3 desk)`（p 是桌面座標）。
 */
export function tablePass(extra = 'vec3 deskArt(vec2 p, vec3 desk) { return desk; }', extraUniforms: Record<string, THREE.IUniform> = {}) {
  return new FSPass(/* glsl */ `
    uniform sampler2D layer; uniform sampler2D bake; uniform float tone; uniform float fib; uniform float t;
    uniform vec3 camC; uniform vec3 camR; uniform vec3 camD; uniform vec3 camF;
    uniform float focusZ; uniform float aperture; uniform float sharp;
    uniform vec3 lamp; // 燈照在桌面的哪裡（u, v）與光池半徑
    ${extra}
    vec4 L(vec2 p) {
      vec2 uv = vec2(p.x / ${W}.0, 1.0 - p.y / ${H}.0);
      if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
      // 層沒有 mipmap，而且這裡在迴圈裡：一律 textureLod（見 ENGINE.md）
      vec4 c = textureLod(layer, uv, 0.0);
      c.rgb = c.a > 0.0 ? toLinear(c.rgb / c.a) * c.a : vec3(0.0);
      return c;
    }
    void main() {
      vec2 sp = vec2(vUv.x * ${W}.0, (1.0 - vUv.y) * ${H}.0);
      vec3 d = camF * ${TABLE_F.toFixed(3)} + camR * (sp.x - ${W / 2}.0) + camD * (sp.y - ${H / 2}.0);
      float tt = camC.z / max(-d.z, 1e-4);
      vec2 p = camC.xy + tt * d.xy;
      float z = tt * ${TABLE_F.toFixed(3)};
      // 景深：離焦平面越遠圓盤越大（sharp 以內都是清楚的）；半徑換成桌面座標
      float coc = aperture * max(0.0, abs(z - focusZ) / z - sharp);
      float r = min(coc, 14.0) * z / ${TABLE_F.toFixed(3)};
      vec4 acc = L(p);
      if (r > 0.45) {
        float a0 = hash12(sp) * 6.2832;
        for (int i = 0; i < 12; i++) {
          float fi = float(i) + 0.5;
          float ang = fi * 2.39996 + a0;
          acc += L(p + vec2(cos(ang), sin(ang)) * r * sqrt(fi / 12.0));
        }
        acc /= 13.0;
      }
      // 桌面：紙纖維用鏡像鋪滿（沒有接縫）
      vec2 m = abs(mod(p / vec2(${W}.0, ${H}.0) + 1.0, 2.0) - 1.0);
      vec4 bk = texture(bake, vec2(m.x, 1.0 - m.y));
      vec3 desk = mix(C_PAPER, C_SEPIA, tone) * (0.93 + 0.14 * bk.g);
      desk = deskArt(p, desk);
      vec3 col = desk * (1.0 - acc.a) + acc.rgb;
      col *= mix(1.0, 0.8 + 0.4 * bk.r, fib);
      // 燈：焦點附近亮、四周暗下去（紙最亮也不超過紙色本身太多，不刺眼）
      float ld = length(p - lamp.xy) / lamp.z;
      col *= 0.74 + 0.3 * exp(-ld * ld);
      fragColor = vec4(col, 1.0);
    }`, {
    layer: { value: null }, bake: { value: null }, tone: { value: 0.12 }, fib: { value: 1 }, t: { value: 0 },
    camC: { value: new THREE.Vector3() }, camR: { value: new THREE.Vector3() }, camD: { value: new THREE.Vector3() }, camF: { value: new THREE.Vector3() },
    focusZ: { value: 1 }, aperture: { value: 40 }, sharp: { value: 0.03 }, lamp: { value: new THREE.Vector3(960, 540, 900) },
    ...extraUniforms,
  });
}

/**
 * 把鏡頭、焦點、燈設給 tablePass。
 * focus：一定要清楚的點（桌面座標，例如留言中心、歌詞中心）：焦平面放在它們中間，清楚的深度範圍涵蓋全部，
 * 其他更遠、更近的地方才失焦。沒給就對焦在鏡頭對準的那一點。
 */
export function setTableCam(p: FSPass, c: TableCam, o: { aperture?: number; sharp?: number; lamp?: [number, number, number]; focus?: [number, number][] } = {}) {
  const b = camBasis(c);
  (p.u.camC!.value as THREE.Vector3).set(...b.C);
  (p.u.camR!.value as THREE.Vector3).set(...b.R);
  (p.u.camD!.value as THREE.Vector3).set(...b.D);
  (p.u.camF!.value as THREE.Vector3).set(...b.F);
  let fz = c.dist, sharp = o.sharp ?? 0.03;
  if (o.focus?.length) {
    const zs = o.focus.map(([u, v]) => project(c, u, v).z);
    const z0 = Math.min(...zs), z1 = Math.max(...zs);
    fz = (z0 + z1) / 2;
    sharp += (z1 - z0) / 2 / fz;
  }
  p.u.focusZ!.value = fz;
  p.u.aperture!.value = o.aperture ?? 40;
  p.u.sharp!.value = sharp;
  (p.u.lamp!.value as THREE.Vector3).set(...(o.lamp ?? [c.tu, c.tv, 900]));
}
