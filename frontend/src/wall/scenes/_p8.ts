// 照片版面 P8「印刷品」（series: press）共用的小工具：covershot、presspage、gigposter、calendar、bookpage、
// invitecard、tradingcard、lpcover、citysign、halftone。檔名 _ 開頭，不會被當成版面。
//
// 十個版面都是「照片印在某個平面的東西上」（封面、報紙、海報、掛曆、書頁、喜帖、卡片、封套、看板、網點印刷），
// 而且照風格聖經的 MV 融合原則，紙本不能是正面、靜止的截圖：要擺在空間裡，有透視、有光、有景深、鏡頭會動。
// 所以這裡統一用「平面物件＋單應矩陣（homography）」：版面在 JS 裡算出物件四個角投影到畫面上的位置，
// 把「畫面 px → 物件 uv」的 3×3 矩陣交給 shader；shader 用它取照片、取物件上的字（Canvas 畫在物件自己的座標裡），
// 字就跟著物件一起有透視、皺紋、打光。整個版面只有一個全螢幕 shader，比 three.js 的場景省很多（內顯也跑得動）。
// 取樣照片的 mip 層用解析的 Jacobian 算（`homoScale`），不用螢幕導數，同一格畫兩次一模一樣。
import * as THREE from 'three';
import { Scene, type PostOverrides, type SceneCtx } from '../engine/scene';
import { W, H, SCALE, Layer2D } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp } from '../engine/util';
import { layoutLyric, type LyricStyle } from './_motifs';
import { focusCrop, focusIn, loadWords, photoTexture, photoWords, PhotoText, settleK, type PhotoTextStyle, type PhotoWords } from './_photo';
import type { PhotoRef, PhotoImage } from '../photos';

/** 右下角 HUD（QR）：字不要進到 x ≥ 1360 且 y ≥ 830。亮版面的照片也盡量不要壓在這裡（HUD 在紙上是深色字）。 */
export const HUD = { x: 1360, y: 830 };
/** 字離四邊至少這麼多（投影機會裁邊）。 */
export const EDGE = 96;

export type Quad = [[number, number], [number, number], [number, number], [number, number]];

// ---------------------------------------------------------------- 平面物件的投影
/**
 * 空間裡的一張平面（封面、海報、書頁…）。x、y 是中心在畫面上的位置（z = 0 時 1 單位 = 1 px），
 * w、h 是大小，rz 在平面內轉、rx 往後倒（上緣離鏡頭比較遠）、ry 左右轉，單位都是弧度；z > 0 是比較遠。
 */
export interface Plane { x: number; y: number; z?: number; w: number; h: number; rx?: number; ry?: number; rz?: number }
/** 鏡頭：焦距（px，越小透視越強）、推近倍數與推近的中心（畫面 px）。 */
export interface Cam { f?: number; zoom?: number; cx?: number; cy?: number; dx?: number; dy?: number }

/** 平面上一點（物件 uv，0..1，左上原點）投影到畫面。lift：離開平面往鏡頭那一側多遠（設計 px，翻頁用）。 */
export function planePoint(pl: Plane, u: number, v: number, cam: Cam = {}, lift = 0): [number, number] {
  const f = cam.f ?? 1800;
  let x = (u - 0.5) * pl.w, y = (v - 0.5) * pl.h, z = -lift;
  const rz = pl.rz ?? 0, rx = pl.rx ?? 0, ry = pl.ry ?? 0;
  if (rz) { const c = Math.cos(rz), s = Math.sin(rz); [x, y] = [x * c - y * s, x * s + y * c]; }
  // 往後倒：上緣（y < 0）往遠處（z > 0）
  if (rx) { const c = Math.cos(rx), s = Math.sin(rx); [y, z] = [y * c + z * s, z * c - y * s]; }
  if (ry) { const c = Math.cos(ry), s = Math.sin(ry); [x, z] = [x * c - z * s, z * c + x * s]; }
  const X = pl.x - W / 2 + x, Y = pl.y - H / 2 + y, D = f + (pl.z ?? 0) + z;
  let sx = W / 2 + (f * X) / D, sy = H / 2 + (f * Y) / D;
  const zoom = cam.zoom ?? 1, zx = cam.cx ?? W / 2, zy = cam.cy ?? H / 2;
  sx = zx + (sx - zx) * zoom + (cam.dx ?? 0);
  sy = zy + (sy - zy) * zoom + (cam.dy ?? 0);
  return [sx, sy];
}

/** 平面四個角（左上、右上、右下、左下）在畫面上的位置。 */
export function planeQuad(pl: Plane, cam: Cam = {}): Quad {
  return [planePoint(pl, 0, 0, cam), planePoint(pl, 1, 0, cam), planePoint(pl, 1, 1, cam), planePoint(pl, 0, 1, cam)];
}

/**
 * 「畫面 px → 物件 uv」的單應矩陣（給 shader 的 mat3，`homo(m, p)`）。quad 是四個角在畫面上的位置（左上、右上、右下、左下）。
 * 先算 uv → 畫面（Heckbert 的正方形對四邊形），再求反矩陣。寫進 `into`（uniform 的 Matrix3，不用每格 new）。
 */
export function homography(q: Quad, into = new THREE.Matrix3()): THREE.Matrix3 {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    a = x1 - x0; b = x3 - x0; c = x0; d = y1 - y0; e = y3 - y0; f = y0; g = 0; h = 0;
  } else {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; c = x0;
    d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0;
  }
  // 反矩陣（伴隨矩陣；整體的比例不影響齊次座標）
  const A = e - f * h, B = c * h - b, C = b * f - c * e;
  const D = f * g - d, E = a - c * g, Fm = c * d - a * f;
  const G = d * h - e * g, Hh = b * g - a * h, I = a * e - b * d;
  return into.set(A, B, C, D, E, Fm, G, Hh, I);
}

/**
 * 同 homography，但輸出是物件的「設計 px」（0..w、0..h）而不是 uv：shader 裡 `homoScale` 就直接是「設計 px／畫面 px」，
 * 邊緣抗鋸齒、影子的軟度、照片的 mip 層都用同一個單位算。
 */
export function homographyPx(q: Quad, w: number, h: number, into = new THREE.Matrix3()): THREE.Matrix3 {
  homography(q, into);
  const e = into.elements; // column-major：e[0], e[3], e[6] 是第一列
  for (const i of [0, 3, 6]) e[i]! *= w;
  for (const i of [1, 4, 7]) e[i]! *= h;
  return into;
}

/** 四邊形在畫面上的外接框 [x0, y0, x1, y1]（檢查有沒有壓到 HUD、字有沒有出界用）。 */
export function quadBox(q: Quad): [number, number, number, number] {
  const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// ---------------------------------------------------------------- GLSL
/**
 * 每個 P8 版面的 shader 前面都接這一段（FSPass 會再自動接 GLSL_COMMON，所以這裡可以用 toLinear、snoise…）。
 *  - `homo(m, p)`：畫面 px → 物件座標（homographyPx 的矩陣是設計 px）；`homoScale(m, p)`：每個畫面 px 對應多少物件座標（解析的導數，確定性）。
 *  - `edgeA(q, size, s)`：物件邊緣的抗鋸齒覆蓋率；`outsideDist(q, size)`：物件外面離邊多遠（影子用）。
 *  - `photoLin(tex, uv, lod)`：照片取樣、轉線性、壓暗（白紗、天空不發光：最亮 0.82）；乘 `phGain`（每個版面的 uniform 都要有，見 PressPlate.gain）。
 *  - `layerAt(tex, uv)`：取「畫在物件座標裡」的 fast Layer2D（預乘、sRGB、flipY）；回傳預乘的線性顏色。
 *  - `paperFiber(p)`：紙的纖維與斑駁（-1..1 左右，乘一個小係數加到紙色上）。
 *  - `dotScreen(p, cell, ang, v, aa)`：網點（p 是 px，v 是要印的濃度 0..1，aa 是一個實體像素多大），回傳油墨覆蓋率。
 */
export const P8_GLSL = /* glsl */ `
vec2 homo(mat3 m, vec2 p) { vec3 h = m * vec3(p, 1.0); return h.xy / h.z; }
float homoScale(mat3 m, vec2 p) {
  vec3 h = m * vec3(p, 1.0);
  vec2 dx = (m[0].xy * h.z - h.xy * m[0].z) / (h.z * h.z);
  vec2 dy = (m[1].xy * h.z - h.xy * m[1].z) / (h.z * h.z);
  return max(length(dx), length(dy));
}
// q 是物件的設計 px（homographyPx），size 是物件大小，s 是 homoScale（設計 px／畫面 px）
float edgeA(vec2 q, vec2 size, float s) {
  vec2 d = min(q, size - q) / max(s, 1e-4);
  return clamp(min(d.x, d.y) + 0.5, 0.0, 1.0);
}
// 物件外面離邊多遠（設計 px；裡面是 0）
float outsideDist(vec2 q, vec2 size) { return length(max(abs(q - size * 0.5) - size * 0.5, 0.0)); }
// phGain：很暗的照片稍微提亮（PressPlate.gain，沒有亮度資料時是 1）
uniform float phGain;
vec3 photoLin(sampler2D s, vec2 uv, float lod) { return toLinear(textureLod(s, clamp(uv, 0.0, 1.0), max(lod, 0.0)).rgb) * 0.82 * phGain; }
// 框裡的 uv（0..1）→ 照片的 uv：c 是 PressPlate.pushCrop() 的結果（往焦點推的那一塊）
vec2 cropUv(vec4 c, vec2 uv) { return c.xy + uv * (c.zw - c.xy); }
vec4 layerAt(sampler2D s, vec2 uv) {
  vec4 c = textureLod(s, vec2(clamp(uv.x, 0.0, 1.0), 1.0 - clamp(uv.y, 0.0, 1.0)), 0.0);
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  return c.a > 0.0 ? vec4(toLinear(c.rgb / c.a) * c.a, c.a) * inside : vec4(0.0);
}
// 焦外的字：五點平均（r 是 uv 的半徑；0 就是一點）
vec4 layerBlur(sampler2D s, vec2 uv, vec2 r) {
  vec4 c = layerAt(s, uv) * 2.0;
  float w = 2.0;
  if (r.x > 0.0) {
    c += layerAt(s, uv + r) + layerAt(s, uv - r) + layerAt(s, uv + vec2(r.x, -r.y)) + layerAt(s, uv + vec2(-r.x, r.y));
    w = 6.0;
  }
  return c / w;
}
float paperFiber(vec2 p) {
  return 0.55 * snoise(p / 240.0) + 0.3 * snoise(vec2(p.x / 2.8, p.y / 60.0)) + 0.15 * snoise(vec2(p.x / 55.0, p.y / 3.2));
}
// aa 是一個「實體像素」換成 p 的單位有多大（homoScale ÷ PX_SCALE）：網點小到快要糊成一片時，直接回傳平均濃度，不會出現疊紋
float dotScreen(vec2 p, float cell, float ang, float v, float aa) {
  vec2 q = rot2(ang) * p / cell;
  vec2 f = fract(q) - 0.5;
  float r = sqrt(clamp(v, 0.0, 1.0)) * 0.7071;
  float w = max(aa, 0.35);
  float d = (length(f) - r) * cell;
  float dots = 1.0 - smoothstep(-w, w, d);
  return mix(dots, clamp(v, 0.0, 1.0), smoothstep(cell * 0.18, cell * 0.4, aa));
}
`;

// ---------------------------------------------------------------- 照片與字
/** 字幕條的圖層四周留的邊（字的暗影不會被切掉）。 */
const BAR_PAD = 28;

/**
 * P8 的版面都繼承這個：init() 先 `await this.loadPhoto(這個版面自己會畫的字)`，排版時 `this.makeText(…)`。
 * 字的規則（ENGINE.md「照片版面」的「字」）都在 `_photo.ts` 的 PhotoText：主字是賓客留言（＋署名）或新人的註解，
 * 歌詞小一號在下面跟唱；沒有主字時歌詞自己當主字；兩個都沒有（hasText = false）就只有照片、照片在正中間。
 * 焦點（ENGINE.md「焦點」）：印在物件上的照片用 `pushCrop()` 往新人點的焦點慢慢推。
 */
export abstract class PressPlate extends Scene {
  photo: PhotoRef = this.ctx.params.photo;
  seed = Number(this.ctx.params.seed ?? 1);
  img!: PhotoImage;
  tex!: THREE.Texture;
  /** 照片的長寬比（寬 ÷ 高）。 */
  aspect = 1;
  /** 這一格有哪些字（排版之前就知道：主字是留言、註解還是沒有，有沒有歌詞）。 */
  words!: PhotoWords;
  /** 有字（主字或歌詞）：沒有的話不留說明欄，照片放正中間。 */
  hasText = false;
  /** 有主字（留言或註解）。 */
  hasMain = false;
  /** 照片窗格的字（排版時 makeText 建）。 */
  text!: PressText;
  /**
   * 照片的亮度增益（shader 的 phGain）：很暗的照片（平均亮度 < 0.3）稍微提亮，最多 1.18 倍，照片才不會悶在暗處；
   * 最亮也只到 0.97，還在 bloom 門檻下。沒有亮度資料（開發用的假照片）就是 1。
   */
  gain = 1;
  /** 歌詞字幕條（lyricsApart 時歌詞放在畫面下方）。 */
  private bar: { L: Layer2D; x: number; y: number } | null = null;

  protected async loadPhoto(extra = '') {
    const ph = this.photo;
    // 照片版面只排在照片窗格（導演一定給 params.photo）；沒有就讓引擎跳過這個窗格，不要畫一半
    if (!ph) throw new Error('照片版面要有 params.photo');
    await loadText(`${ph.caption}${ph.album}${extra}`);
    await loadWords(this.ctx);
    this.img = await ph.load();
    this.tex = this.track(photoTexture(this.img));
    // 先上傳到顯示卡（不要拖到第一格才傳，切版面時會停一下）
    this.ctx.renderer.initTexture(this.tex);
    this.words = photoWords(this.ctx);
    this.hasMain = this.words.kind !== 'none';
    this.hasText = this.hasMain || this.words.lyrics;
    const lum = ph.lum;
    this.gain = typeof lum === 'number' && lum < 0.3 ? 1 + 0.6 * clamp(0.3 - lum, 0, 0.3) : 1;
    this.aspect = this.img.w / this.img.h;
  }

  /**
   * 排字（用量字的畫布，只量不畫；畫的時候畫到版面自己的圖層）。版面可以換不同的寬高多排幾次，挑放得下的。
   * 長的主字（40 字以上）最大 44 px（TREATMENT.md「留言尺寸標準 v2」：60 字長留言約 40～44），紙上的照片才不會被字擠得很小。
   */
  protected makeText(st: PressTextStyle): PressText {
    const long = Array.from(this.words.text).length > 40;
    const max = long ? Math.min(st.max ?? 50, 44) : st.max;
    return (this.text = new PressText(this.ctx, measureCtx(), { ...st, max }));
  }

  /**
   * 字畫到圖層 L 上（內容變了才重畫、上傳）：(x, top) 是對齊點與整塊的頂（L 的座標）。
   * extra：同一層上不會變的小東西（相簿名、編號…），清掉之後要補畫。
   */
  protected paintText(L: Layer2D, t: number, x: number, top: number, extra?: (c: CanvasRenderingContext2D) => void) {
    if (this.text.draw(L.ctx, t, x, top, { clear: () => { L.clear(); extra?.(L.ctx); } })) L.upload();
  }

  /** 照片在框（寬高比 frameAspect）裡往焦點推到 zoom 倍：一開始快、之後越來越慢；很小的照片給框在畫面上的寬 screenW，少推一點不推糊。 */
  protected pushCrop(lt: number, frameAspect: number, zoom: number, screenW?: number, reverse = false): [number, number, number, number] {
    return focusCrop(this.photo, this.img.w, this.img.h, frameAspect, settleK(lt), { zoom, screenW, reverse });
  }

  /** 焦點在框裡的位置（0..1）：crop 是 pushCrop() 的結果。鏡頭要對著臉推的版面用。 */
  protected focusAt(crop: readonly number[]): [number, number] { return focusIn(this.photo, crop); }

  /**
   * 字幕條：lyricsApart 而且有主字、有歌詞時，歌詞放在畫面下方（畫面座標、位置固定）。
   * cx 是中線，base 是最後一排基線的最低位置（HUD 區上面、離下緣 ≥ 96）。字邊很淡的暗影，暗底上一樣清楚。
   * 回傳字幕整塊的頂（版面據此把物件往上讓）；沒有字幕是 null。
   */
  protected lyricBar(cx: number, base: number): number | null {
    const tx = this.text;
    if (!tx.hasMain || !tx.sung || !tx.st.lyricsApart) return null;
    const st = tx.st as PressTextStyle;
    const w = st.lyricW ?? st.w, pad = BAR_PAD;
    const top = Math.round(base - tx.lyricH + tx.lyricSize * 0.1);
    const L = this.track(new Layer2D(Math.round(w + 2 * pad), Math.round(tx.lyricH + tx.lyricSize * 0.5 + 2 * pad), SCALE, { fast: true }));
    this.bar = { L, x: cx - w / 2 - pad, y: top - pad };
    return top;
  }

  /** 每格畫字幕條（版面在 bg.render 之後呼叫）：alpha 是進出場。 */
  protected renderBar(t: number, out: THREE.WebGLRenderTarget, alpha: number) {
    const b = this.bar;
    if (!b || alpha <= 0) return;
    const L = b.L, align = (this.text.st as PressTextStyle).apartAlign ?? this.text.st.align ?? 'left';
    const pad = BAR_PAD, x = align === 'center' ? L.w / 2 : align === 'right' ? L.w - pad : pad;
    // 字幕直接壓在場景上（街道、檯面）：字邊一圈很淡的暗影（L.clear 會把影子歸零，清完再設）
    const clear = () => { L.clear(); L.ctx.shadowColor = rgba('ink', 0.75); L.ctx.shadowBlur = 14; };
    if (this.text.drawLyrics(L.ctx, t, x, pad, { clear })) L.upload();
    const { renderer, comp } = this.ctx;
    comp.draw(renderer, L.texture, out, { opacity: alpha, ...layerOffset(L, b.x, b.y) });
  }
}

/** mip 層：照片上用到的像素 ÷ 畫面上的實體像素。 */
export const lodFor = (photoPx: number, screenPx: number) => Math.max(0, Math.log2(photoPx / Math.max(1, screenPx * SCALE)));

/** 把一張比畫面小的 Layer2D 貼在畫面 (x, y)（左上角，邏輯 px）。 */
export function layerOffset(L: Layer2D, x: number, y: number, s = 1): { scale: [number, number]; offset: [number, number] } {
  const sw = W / (L.w * s), sh = H / (L.h * s);
  return { scale: [sw, sh], offset: [0.5 * sw - 0.5 - x / (L.w * s), 0.5 + y / (L.h * s) - 0.5 * sh] };
}

// ---------------------------------------------------------------- 字
let scratch: CanvasRenderingContext2D | null = null;
/** 排版前先量字用的畫布（版面要先知道字有多高，才決定照片多大）。 */
export function measureCtx(): CanvasRenderingContext2D {
  return (scratch ??= document.createElement('canvas').getContext('2d')!);
}

export interface PressTextStyle extends PhotoTextStyle {
  /**
   * 歌詞真的另外放時（lyricsApart、有主字）才用的對齊與顏色：主字印在卡片淺色的說明框裡靠左，歌詞是畫面下方暗底上置中的字幕。
   * 跟 PhotoTextStyle 的 lyricInk 這些不一樣：沒有主字、歌詞印在主字的位置時不套用（跟主字同色、同對齊）。
   * 寬度用 PhotoTextStyle 的 lyricW。
   */
  apartAlign?: 'left' | 'center' | 'right';
  apartInk?: { sung: string; unsung: string; active: string };
}

/**
 * P8 的字：PhotoText 再多一點——lyricsApart 時歌詞可以跟主字不同寬、不同對齊、不同色（lyricW、apartAlign、apartInk）。
 * 預留給歌詞的高度（lyricH）照歌詞自己的寬重算，換句子時才不會超出預留的範圍。
 */
export class PressText extends PhotoText {
  constructor(ctx: SceneCtx, c: CanvasRenderingContext2D, st: PressTextStyle) {
    super(ctx, c, st);
    // PhotoText 排版時主字還沒排（還不知道歌詞是不是另外放），歌詞的預留高度照另外放的寬重算
    if (this.apart) {
      const ls = this.lyricStyle();
      this.lyricH = 0;
      for (const ln of ctx.lyrics.linesIn(ctx.start, ctx.end)) this.lyricH = Math.max(this.lyricH, layoutLyric(c, ln, ls).height);
    }
  }
  /** 歌詞真的另外放（有主字、有歌詞、lyricsApart）。 */
  get apart() { return this.hasMain && this.sung && !!this.st.lyricsApart; }
  /**
   * lyricW、apartAlign、apartInk 只在歌詞真的另外放時用；沒有主字時歌詞就印在主字的位置（卡片的說明框、看板的字帶），
   * 跟主字同寬、同色。
   */
  override lyricStyle(): LyricStyle {
    const s = super.lyricStyle(), st = this.st as PressTextStyle;
    return this.apart ? { ...s, align: st.apartAlign ?? s.align, ...st.apartInk } : { ...s, maxWidth: st.w };
  }
}

/** 主字整塊放得進高度 h 嗎（fitText 縮到最小字級還放不下時會照樣回傳，要自己檢查）。 */
export const textFits = (tx: PhotoText, h: number) => tx.height <= h + 0.5 && (!tx.fit || tx.fit.lines.length <= (tx.st.maxLines ?? 4));

/** 亮的紙上的字：主字、唱完的歌詞是深墨；正在唱的字用 blood（訊號色在淺色主題的紙上太淡）；署名淡一點。 */
export const PAPER_INK = () => ({ ink: rgba('sepia', 0.92), unsung: rgba('sepia', 0.3), active: rgba('blood'), sigInk: rgba('sepia', 0.7) });
/** 暗底上的字。 */
export const DARK_INK = () => ({ ink: rgba('bone', 0.96), unsung: rgba('bone', 0.36), active: rgba('signal'), sigInk: rgba('bone', 0.74) });
/** 暗底上的字幕（lyricsApart 的歌詞）。 */
export const DARK_LYRIC = () => ({ sung: rgba('bone', 0.96), unsung: rgba('bone', 0.4), active: rgba('signal') });

/** 小標籤（相簿名…）縮到放得下 maxW（太長截斷加「…」）。 */
export function clip(c: CanvasRenderingContext2D, s: string, maxW: number): string {
  if (c.measureText(s).width <= maxW) return s;
  let t = s;
  while (t.length > 1 && c.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

/** 照片版面共同的後製：照片不發光（bloom 門檻拉到 1 以上）。 */
export const PHOTO_POST = (paper: boolean, o: PostOverrides = {}): PostOverrides =>
  paper ? { paper: 1, bloom: 0.15, bloomThreshold: 1.1, halation: 0.05, vignette: 0.28, ...o } : { bloom: 0.22, bloomThreshold: 1.05, halation: 0.12, vignette: 0.45, ...o };

export { F, font };
