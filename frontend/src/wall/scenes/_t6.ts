// 批次 T6（螢幕 B：試算表、程式碼、安裝進度、新聞快報、氣象報告、片尾名單）共用的小工具。
// 這六個版面都是「螢幕上的畫面」，所以有幾件事一樣：小圖層貼回全螢幕、列出窗格裡的拍點、
// 台灣的海岸線（新聞的地球儀與氣象圖都要）、逐字「打出來」的歌詞（打字＝唱到，照跟唱規則）。
// MV 檢修（2026-09-28）：新人說介面版面「太亂、像網頁」，所以加了 ScreenRig——把畫好的介面當成一塊真的螢幕／紙，
// 擺在 three.js 的空間裡用透視相機拍（有邊框、玻璃反光、背光往邊緣變暗、景深），鏡頭可以慢推、搖、對焦。
import * as THREE from 'three';
import type { AudioData } from '../engine/audio';
import { Lyrics, type Line } from '../engine/lyrics';
import { W, H, makeRT, clearRT, type Compositor } from '../engine/gl';
import { font, loadText } from '../engine/type';
import type { SceneCtx } from '../engine/scene';
import { fitText, type FitResult } from '../engine/text';

export type Rect = [number, number, number, number];

/** 一張只蓋住畫面一部分的圖層（左上 x,y、寬高 w,h，邏輯像素）貼回全螢幕時，Compositor 要的 UV 縮放與位移。 */
export function subRect(x: number, y: number, w: number, h: number) {
  return {
    scale: [W / w, H / h] as [number, number],
    offset: [(0.5 * W - x) / w - 0.5, (y + 0.5 * h - 0.5 * H) / h] as [number, number],
  };
}

/** [t0, t1) 之間的拍點時間。 */
export function beatsIn(au: AudioData, t0: number, t1: number): number[] {
  const out: number[] = [];
  for (let i = Math.ceil(au.beatAt(t0) - 1e-6); ; i++) {
    const bt = au.timeOfBeat(i);
    if (bt >= t1) break;
    out.push(bt);
    if (out.length > 400) break;
  }
  return out;
}

/** 最後一個「後面至少還有 gap 秒」的拍點（收尾動作落在這裡，才看得到）。 */
export function lastBeatBefore(au: AudioData, end: number, gap: number): number {
  return au.timeOfBeat(Math.floor(au.beatAt(end - gap) + 1e-6));
}

// ---------------------------------------------------------------- 台灣
/**
 * 台灣本島海岸線（經度、緯度），從富貴角順時針繞一圈。只取大約 60 個點：
 * 圖版上是一條細線，要的是一眼認得出的輪廓，不是測量精度。
 */
export const TAIWAN: [number, number][] = [
  [121.537, 25.298], [121.47, 25.25], [121.41, 25.18], [121.33, 25.15], [121.24, 25.12], [121.09, 25.05], [121.02, 24.98],
  [120.97, 24.91], [120.92, 24.85], [120.9, 24.77], [120.84, 24.7], [120.76, 24.62], [120.67, 24.49], [120.63, 24.43],
  [120.57, 24.36], [120.5, 24.27], [120.45, 24.17], [120.39, 24.07], [120.3, 23.93], [120.27, 23.84], [120.18, 23.77],
  [120.17, 23.7], [120.14, 23.58], [120.14, 23.46], [120.14, 23.37], [120.1, 23.27], [120.07, 23.13], [120.15, 23.0],
  [120.18, 22.9], [120.24, 22.72], [120.28, 22.6], [120.37, 22.5], [120.45, 22.45], [120.58, 22.36], [120.68, 22.19],
  [120.7, 22.07], [120.73, 21.93], [120.8, 21.94], [120.85, 21.9], [120.88, 21.99], [120.9, 22.2], [120.9, 22.34],
  [121.0, 22.6], [121.15, 22.75], [121.23, 22.88], [121.38, 23.1], [121.44, 23.28], [121.5, 23.45], [121.52, 23.6],
  [121.6, 23.85], [121.62, 23.98], [121.68, 24.15], [121.75, 24.3], [121.8, 24.46], [121.87, 24.59], [121.84, 24.72],
  [121.83, 24.85], [121.9, 24.95], [122.0, 25.01], [121.92, 25.13], [121.8, 25.14], [121.74, 25.15], [121.69, 25.21],
  [121.64, 25.23], [121.58, 25.28],
];
/** 婚禮現場的大概位置（台北附近；只當地圖上的一個點，不是真的地址）。 */
export const VENUE: [number, number] = [121.52, 25.05];

/** 把台灣畫進一個方框（等距圓柱投影、經度乘 cos(緯度)），回傳畫面座標的點與投影函式。 */
export function taiwanIn(x: number, y: number, h: number) {
  const lat0 = 23.6, k = h / (25.35 - 21.85), cx = 120.97, cl = Math.cos((lat0 * Math.PI) / 180);
  const proj = (lon: number, lat: number) => ({ x: x + (lon - cx) * cl * k, y: y + (25.35 - lat) * k });
  return { pts: TAIWAN.map(([lo, la]) => proj(lo, la)), proj, k };
}

// ---------------------------------------------------------------- 打出來的歌詞
export interface TypedWord { w: string; x: number; row: number; width: number; start: number; end: number; word: Line['words'][number] }
export interface TypedLayout { rows: number; words: TypedWord[]; size: number; widths: number[] }

const typedCache = new WeakMap<Line, Map<string, TypedLayout>>();

/**
 * 把一行歌詞排成可以「打字」的樣子：照字（Word）斷行（英文不拆字、中文一字一格），最多 maxRows 行，
 * 放不下就縮字級（不小於 minSize）。回傳每個字在第幾行、x 多少。同一行同樣式快取。
 */
export function typedLayout(c: CanvasRenderingContext2D, line: Line, family: string, size: number, maxW: number, o: { minSize?: number; maxRows?: number; tracking?: number } = {}): TypedLayout {
  const key = `${family}|${size}|${maxW}|${o.minSize}|${o.maxRows}|${o.tracking}`;
  let m = typedCache.get(line);
  if (!m) { m = new Map(); typedCache.set(line, m); }
  const hit = m.get(key);
  if (hit) return hit;
  const maxRows = o.maxRows ?? 2, tr = o.tracking ?? 0;
  const run = (sz: number) => {
    c.font = font(family, sz);
    c.letterSpacing = `${tr}px`;
    const words: TypedWord[] = [];
    const widths: number[] = [0];
    let row = 0, x = 0;
    line.words.forEach((w, i) => {
      // 字前面的空白（英文）跟著字一起量；行首不要空白
      const prev = i > 0 ? line.words[i - 1]! : null;
      const gap = prev ? line.text.slice(prev.o + prev.w.length, w.o) : '';
      const ww = c.measureText(w.w).width;
      const gw = gap ? c.measureText(gap).width : 0;
      if (x > 0 && x + gw + ww > maxW) { row++; x = 0; widths.push(0); }
      else x += gw;
      words.push({ w: w.w, x, row, width: ww, start: w.start, end: w.end, word: w });
      x += ww;
      widths[row] = x;
    });
    c.letterSpacing = '0px';
    return { rows: row + 1, words, size: sz, widths };
  };
  let sz = size, res = run(sz);
  const min = o.minSize ?? size * 0.75;
  while ((res.rows > maxRows || Math.max(...res.widths) > maxW) && sz > min) { sz = Math.max(min, sz * 0.94); res = run(sz); }
  m.set(key, res);
  return res;
}

/**
 * 畫打出來的歌詞：唱到的字才「打上去」（逐字，跟著 wordProgress），正在唱的是 active 色、唱完的是 sung 色；
 * 還沒唱的字用 ghost 色先淡淡地排好（像編輯器的自動完成建議），ghost 可以是 null（不先顯示）。
 * 回傳游標位置（正在打的地方），沒在唱時回傳這行最後一個已打的字後面。
 */
export function drawTyped(c: CanvasRenderingContext2D, lay: TypedLayout, family: string, x: number, y: number, lineH: number, t: number,
  col: { active: string; sung: string; ghost: string | null }, alpha = 1): { x: number; y: number; typing: boolean } {
  c.save();
  c.font = font(family, lay.size);
  c.textBaseline = 'alphabetic';
  c.globalAlpha *= alpha;
  let cx = x, cy = y, typing = false;
  for (const tw of lay.words) {
    const p = Lyrics.wordProgress(tw.word, t);
    const wx = x + tw.x, wy = y + tw.row * lineH;
    if (p <= 0) { if (col.ghost) { c.fillStyle = col.ghost; c.fillText(tw.w, wx, wy); } continue; }
    // 逐字打：中文一個 Word 通常就是一個字；英文單字照字母數切
    const chars = Array.from(tw.w);
    const n = p >= 1 ? chars.length : Math.max(1, Math.ceil(chars.length * p));
    const shown = chars.slice(0, n).join('');
    const sw = c.measureText(shown).width;
    // 還沒打到的尾巴照樣是 ghost（打上去的部分不能疊在 ghost 上，淡色會透出來）
    if (p < 1 && col.ghost && n < chars.length) { c.fillStyle = col.ghost; c.fillText(chars.slice(n).join(''), wx + sw, wy); }
    c.fillStyle = p < 1 ? col.active : col.sung;
    c.fillText(shown, wx, wy);
    cx = wx + sw; cy = wy;
    if (p < 1) typing = true;
  }
  c.restore();
  return { x: cx, y: cy, typing };
}

/** 窗格的進出場：第一格淡入、最後 k 秒淡出。 */
export function inOut(t: number, s: number, e: number, fin = 0.35, fout = 0.3) {
  return Math.max(0, Math.min(1, (t - s) / fin, (e - t) / fout));
}

/**
 * 留言排版，但偏好「少一點行數」：fitText 找的是最大字級，短留言常常被拆成兩行（「新婚快／樂！！！」）。
 * 行數少一行、字級還有原本的三分之二以上（而且夠大）就用少的那個，讀起來是一整句。
 */
export function fitMessage(c: CanvasRenderingContext2D, text: string, family: string, w: number, h: number, o: { min?: number; max?: number; lineHeight?: number; maxLines?: number } = {}): FitResult {
  const best = fitText(c, text, family, w, h, { min: 44, lineHeight: 1.3, ...o });
  for (let n = 1; n < best.lines.length; n++) {
    const f = fitText(c, text, family, w, h, { min: 44, lineHeight: 1.3, ...o, maxLines: n });
    if (f.lines.length <= n && f.size >= Math.max(60, best.size * 0.66)) return f;
  }
  return best;
}

// ---------------------------------------------------------------- 螢幕在空間裡
const RIG_VERT = /* glsl */ `precision highp float;
in vec3 position; in vec2 uv; uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix;
out vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const RIG_FRAG = /* glsl */ `precision highp float;
in vec2 vUv; out vec4 fragColor;
uniform sampler2D tex; uniform bool decode; uniform vec2 size; uniform float bezel;
uniform vec3 backCol; uniform vec3 bezelCol; uniform vec3 rimCol;
uniform vec4 focusR; uniform vec4 focusR2; uniform float dofPx; uniform float lodMax; uniform float gain; uniform float edgeDark;
uniform float glare; uniform float glareK; uniform float k; uniform float radius;
vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
float sdRound(vec2 p, vec2 b, float r) { vec2 d = abs(p) - b + r; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }
void main() {
  vec2 p = vUv * (size + 2.0 * bezel) - bezel; // 螢幕像素（y 向上），外圈是邊框
  vec2 q = p / size - 0.5;
  float inScr = sdRound(p - size * 0.5, size * 0.5, 4.0);
  float outer = sdRound(p - size * 0.5, size * 0.5 + bezel, radius);
  if (outer > 0.0) discard;
  vec3 rgb;
  if (inScr <= 0.0) {
    // 景深：對焦的範圍（focusR，螢幕像素、y 向下）裡是清楚的，離它越遠取越模糊的 mipmap。
    // 不用真的深度算：歌詞與留言都要清楚，但它們在螢幕上的深度不一樣——用範圍控制比較可靠（像移軸鏡頭）。
    vec2 pd = vec2(p.x, size.y - p.y);
    vec2 dd = max(max(focusR.xy - pd, pd - focusR.zw), 0.0);
    vec2 dd2 = max(max(focusR2.xy - pd, pd - focusR2.zw), 0.0);
    float lod = dofPx > 0.0 ? clamp(min(length(dd), length(dd2)) / dofPx, 0.0, lodMax) : 0.0;
    // 模糊的地方多取四個點（半個 mip 格子錯開），高層 mipmap 放大時才不會一格一格的
    vec2 uv0 = p / size;
    vec4 c = textureLod(tex, uv0, lod);
    if (lod > 0.3) {
      vec2 o = exp2(lod) * 0.6 / size;
      c = c * 0.36 + (textureLod(tex, uv0 + vec2(o.x, o.y), lod) + textureLod(tex, uv0 + vec2(-o.x, o.y), lod)
        + textureLod(tex, uv0 + vec2(o.x, -o.y), lod) + textureLod(tex, uv0 + vec2(-o.x, -o.y), lod)) * 0.16;
    }
    if (decode) c.rgb = c.a > 0.0 ? toLin(c.rgb / c.a) * c.a : vec3(0.0);
    rgb = (c.rgb + backCol * (1.0 - c.a)) * gain;
    // 背光往四邊變暗一點
    rgb *= 1.0 - edgeDark * (q.x * q.x * 1.3 + q.y * q.y * 1.8);
    // 玻璃反光：一道很淡的斜光，跟著鏡頭角度移
    float g = exp(-pow((q.x * 0.8 + q.y * 0.6 - glare) * 3.0, 2.0));
    rgb += rimCol * 0.03 * g * glareK;
  } else {
    // 邊框：暗色，外緣一條細細的反光
    float rim = 1.0 - smoothstep(0.0, 2.2, abs(outer + 1.2));
    float inner = 1.0 - smoothstep(0.0, 1.5, abs(inScr - 0.8));
    rgb = bezelCol + rimCol * (rim * 0.35 + inner * 0.08);
  }
  fragColor = vec4(rgb * k, k);
}`;

/**
 * 一塊擺在空間裡的螢幕（或一張紙）：貼圖是畫好的介面（fast 的 Layer2D 或 render target），
 * 用透視相機拍。pose() 決定「螢幕上哪一點落在畫面哪裡、多大、怎麼轉」，focusAt() 對焦（景深要貼圖有 mipmap）。
 */
export class ScreenRig {
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(28, W / H, 5, 200000);
  mesh: THREE.Mesh;
  mat: THREE.RawShaderMaterial;
  private v = new THREE.Vector3();

  constructor(tex: THREE.Texture, public w: number, public h: number, o: { decode: boolean; bezel?: number; radius?: number }) {
    const bz = o.bezel ?? 0;
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: RIG_VERT, fragmentShader: RIG_FRAG,
      uniforms: {
        tex: { value: tex }, decode: { value: o.decode }, size: { value: new THREE.Vector2(w, h) }, bezel: { value: bz }, radius: { value: o.radius ?? 18 },
        backCol: { value: new THREE.Vector3() }, bezelCol: { value: new THREE.Vector3() }, rimCol: { value: new THREE.Vector3(1, 1, 1) },
        focusR: { value: new THREE.Vector4(0, 0, w, h) }, focusR2: { value: new THREE.Vector4(-1e5, -1e5, -1e5, -1e5) }, dofPx: { value: 0 }, lodMax: { value: 3.5 }, gain: { value: 1 }, edgeDark: { value: 0.25 },
        glare: { value: 0.2 }, glareK: { value: 1 }, k: { value: 1 },
      },
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w + 2 * bz, h + 2 * bz), this.mat);
    this.scene.add(this.mesh);
  }

  get u() { return this.mat.uniforms; }

  /**
   * 螢幕上的點 (fx, fy)（螢幕像素，y 向下）落在畫面 (cx, cy)，那一點附近 1 螢幕像素 = scale 畫面像素；
   * rx（正：上緣往前傾，負：往後仰）、ry（正：右邊往後退）、rz 是螢幕的轉角。
   */
  pose(o: { fx: number; fy: number; cx: number; cy: number; scale: number; rx: number; ry: number; rz?: number }) {
    const m = this.mesh;
    m.rotation.set(o.rx, o.ry, o.rz ?? 0);
    m.position.set(0, 0, 0);
    m.updateMatrixWorld();
    // 把對焦點搬到原點（相機看著原點）
    this.v.set(o.fx - this.w / 2, this.h / 2 - o.fy, 0).applyMatrix4(m.matrixWorld);
    m.position.set(-this.v.x, -this.v.y, -this.v.z);
    m.updateMatrixWorld();
    const D = (H / 2) / (o.scale * Math.tan((this.cam.fov * Math.PI) / 360));
    this.cam.position.set(0, 0, D);
    this.cam.lookAt(0, 0, 0);
    this.cam.setViewOffset(W, H, W / 2 - o.cx, H / 2 - o.cy, W, H);
    this.cam.updateMatrixWorld();
    this.cam.updateProjectionMatrix();
  }

  /** 螢幕上一點在相機座標的深度。 */
  depthOf(px: number, py: number) {
    this.v.set(px - this.w / 2, this.h / 2 - py, 0).applyMatrix4(this.mesh.matrixWorld).applyMatrix4(this.cam.matrixWorldInverse);
    return -this.v.z;
  }

  /** 對焦範圍（螢幕像素、y 向下）；離開範圍每 pxPerLod 像素糊一級（0 = 不做景深）。 */
  focus(x0: number, y0: number, x1: number, y1: number, pxPerLod: number, r2?: [number, number, number, number]) {
    (this.u.focusR!.value as THREE.Vector4).set(x0, y0, x1, y1);
    (this.u.focusR2!.value as THREE.Vector4).set(...(r2 ?? [-1e5, -1e5, -1e5, -1e5]));
    this.u.dofPx!.value = pxPerLod;
  }

  /** 螢幕上一點 → 畫面像素。 */
  toScreen(px: number, py: number) {
    this.v.set(px - this.w / 2, this.h / 2 - py, 0).applyMatrix4(this.mesh.matrixWorld).project(this.cam);
    return { x: (this.v.x + 1) / 2 * W, y: (1 - this.v.y) / 2 * H };
  }

  render(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget) {
    renderer.setRenderTarget(out);
    renderer.render(this.scene, this.cam);
  }

  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); }
}

/**
 * 螢幕內容的 render target（有 mipmap，ScreenRig 的景深要用）。Canvas 層每格畫完先 blitToRT 貼進來再給 ScreenRig 取樣：
 * 直接拿 Canvas 貼圖產生 mipmap 的話，驗收截圖偶爾有幾個像素差 1（確定性不過），經過 render target 就穩定。
 */
export function mipRT(w: number, h: number) {
  const rt = makeRT(w, h, { depthBuffer: false });
  rt.texture.generateMipmaps = true;
  rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
  return rt;
}

/** 把 fast 的 Canvas 層（整張）貼進 mipRT（先清成透明）。 */
export function blitToRT(renderer: THREE.WebGLRenderer, comp: Compositor, tex: THREE.Texture, rt: THREE.WebGLRenderTarget) {
  clearRT(renderer, rt, [0, 0, 0], 0);
  comp.draw(renderer, tex, rt);
}

// ---------------------------------------------------------------- 字型
/** 這批版面畫得到的符號（引擎只預載版面檔裡寫死的中文，符號與組出來的字串要自己載，確定性才會過）。 */
const T6_SYMBOLS = '♪♥◆●「」《》（）／：，。、！？—…∞%＋=`{}()";,·&0123456789';
/**
 * init() 裡呼叫：把版面自己的字、這個窗格附近的歌詞、主打留言與署名、歌名一次載好，
 * 第一格就用對的字型（不然第一格是備援字型、之後才換，同一時間點畫兩次會不一樣）。
 */
export function loadPlateText(ctx: SceneCtx, extra: string) {
  const m = ctx.params.message as { text: string; name: string } | null | undefined;
  const lyr = ctx.lyrics.linesIn(ctx.start - 3, ctx.end + 3).map((l) => l.text).join('');
  return loadText(extra + T6_SYMBOLS + lyr + (m ? m.text + m.name : '') + ctx.song.title + ctx.song.artist + '一位賓客');
}
