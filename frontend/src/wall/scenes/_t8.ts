// 批次 T8（機器 B：lissajous、seismograph、radar、terminal、arcade、pinball）共用的小工具。
// 這批版面都是「一台機器」：大部分東西不會變（面板、刻度、標籤），只有少數地方每格在動，
// 所以常用的做法是「小圖層只畫會變的那一塊、貼到畫面上的那個位置」，而不是每格清一整張全螢幕的 Canvas。
//
// MV 融合原則之後多了「舞台」Stage：機器的畫面（螢幕、記錄紙）先畫進一張離屏圖，
// 再當成空間裡的一塊平面，用一台慢慢移動的鏡頭拍：有透視、景深（離對焦點越遠越糊）、玻璃反光、周圍的房間。
// 這樣螢幕類的版面才像「電影裡拍到的一台機器」，而不是一張正面的介面截圖。
import * as THREE from 'three';
import { W, H, FSPass, makeRT } from '../engine/gl';
import { shared, type SceneCtx } from '../engine/scene';
import type { AudioData } from '../engine/audio';
import { font } from '../engine/type';
import { clamp, ease, lerp, prog } from '../engine/util';

/**
 * 把一張小圖層（畫面上的範圍 x, y, w, h，邏輯像素）貼到 out 的那個位置。
 * Compositor 只會整張縮放平移，所以用 scale／offset 把貼圖對到那一塊。
 */
export function blit(ctx: SceneCtx, tex: THREE.Texture, x: number, y: number, w: number, h: number, out: THREE.WebGLRenderTarget, o: { mode?: 'normal' | 'add'; opacity?: number; tint?: [number, number, number] } = {}) {
  ctx.comp.draw(ctx.renderer, tex, out, { ...o, scale: [W / w, H / h], offset: [0.5 * W / w - 0.5 - x / w, 0.5 + y / h - 0.5 * H / h] });
}

/** GLSL：取樣 fast 的 Layer2D（預乘、sRGB 編碼）→ 線性、預乘的顏色。自己的 shader 要讀 Canvas 層時用。 */
export const DEC_GLSL = /* glsl */ `
vec4 decLayer(vec4 c) { return c.a > 0.0 ? vec4(toLinear(c.rgb / c.a) * c.a, c.a) : vec4(0.0); }`;

/** 窗格裡的小節線（含開頭那一條，如果窗格剛好切在小節線上）。 */
export function winBars(au: AudioData, s: number, e: number): number[] {
  const out: number[] = [];
  for (let b = Math.ceil(au.barAt(s) - 1e-3); ; b++) {
    const tb = au.timeOfBar(b);
    if (tb >= e - 1e-3) break;
    if (tb >= s - 1e-3) out.push(tb);
    if (out.length > 64) break;
  }
  return out;
}

/** 窗格裡的拍點。 */
export function winBeats(au: AudioData, s: number, e: number): number[] {
  const out: number[] = [];
  for (let b = Math.ceil(au.beatAt(s) - 1e-3); ; b++) {
    const tb = au.timeOfBeat(b);
    if (tb >= e - 1e-3) break;
    if (tb >= s - 1e-3) out.push(tb);
    if (out.length > 256) break;
  }
  return out;
}

/** No.042 */
export const no3 = (n: number) => `No.${String(Math.max(0, n)).padStart(3, '0')}`;

/** mono／小字標籤：設好字、字距、顏色、對齊畫一行（畫完把字距還原）。 */
export function label(c: CanvasRenderingContext2D, text: string, x: number, y: number, family: string, size: number, color: string, o: { tracking?: number; align?: CanvasTextAlign } = {}) {
  c.font = font(family, size);
  c.letterSpacing = `${o.tracking ?? 0}px`;
  c.fillStyle = color;
  c.textAlign = o.align ?? 'left';
  c.textBaseline = 'alphabetic';
  c.fillText(text, x, y);
  c.letterSpacing = '0px';
  c.textAlign = 'left';
}

/** 沒有留言時的邀請（整批一致的說法）。 */
export const INVITE = '掃描右下角 QR code，把你的祝福傳上大螢幕';

/** 這批版面固定會出現的中文（init 時一次載好）。 */
// 版面用思源黑體／文楷畫的數字、符號、拉丁字（讀數、署名、銘牌）也要先載：沒載好的字第一格會用系統字頂替，畫面就不確定了
export const T8_TEXT = `${INVITE}一位賓客新人留言第則首歌純音樂間奏0123456789°·—…（）()kmCHXYLOVESEISMOGRAPHNEWRCD:/.`;

// ---------------------------------------------------------------- 舞台（把一張畫面當成空間裡的平面來拍）
export interface StageCam {
  /** 平面的轉角（弧度）：yaw 左右轉、pitch 上下倒、roll 歪。 */
  yaw: number; pitch: number; roll?: number;
  /** 1 = 平面剛好填滿畫面；小於 1 看得到周圍的房間。 */
  zoom: number;
  /** 平面在畫面上的平移（px）。 */
  x?: number; y?: number;
  /** 景深：離對焦點每 100 單位的深度差，糊幾 px。 */
  dof?: number;
  /** 對焦點（內容座標 px）。 */
  focus?: [number, number];
  /** 外框（螢幕的塑膠框）寬度（內容 px），0 = 沒有；角的圓角。 */
  bezel?: number; radius?: number;
  /** 玻璃反光的強度（螢幕用）。 */
  glass?: number;
  /** 周圍的房間（線性色）與內容溢出來的光。 */
  room: [number, number, number];
  glow?: number;
  /** 亮版面：平面在桌上，四周是影子而不是光。 */
  paper?: boolean;
}

const STAGE = () => new FSPass(/* glsl */ `
  uniform sampler2D tex; uniform mat3 Hinv; uniform vec3 zc; uniform float zf; uniform float dof;
  uniform float bezel; uniform float radius; uniform float glass; uniform vec3 room; uniform float glow; uniform float paper;
  uniform vec2 csize;
  vec3 samp(vec2 st0, float r) {
    // 離屏圖的第一列在下面（v 向上）：內容座標 y 向下，所以要翻過來
    vec2 st = vec2(st0.x, 1.0 - st0.y);
    vec3 c = textureLod(tex, st, 0.0).rgb;
    if (r < 0.35) return c;
    // 景深：一圈八點＋中心（圓盤模糊的近似）
    vec2 k = r / csize;
    vec3 acc = c;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398 + 0.39;
      acc += textureLod(tex, st + vec2(cos(a), sin(a)) * k, 0.0).rgb;
    }
    return acc / 9.0;
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y); // y 向下
    vec3 q = Hinv * vec3(p, 1.0);
    vec2 st = q.xy / q.z;                           // 內容座標（0..1，y 向下）
    vec2 c = st * csize;                            // 內容 px
    // 圓角矩形的內容範圍、外框
    vec2 hs = csize * 0.5;
    vec2 dd = abs(c - hs) - (hs - radius);
    float d = length(max(dd, 0.0)) + min(max(dd.x, dd.y), 0.0) - radius; // < 0 在內容裡
    float z = dot(zc, vec3(st, 1.0));
    float blur = dof * abs(z - zf) / 100.0;
    vec3 col;
    if (d < 0.0) {
      vec2 sst = clamp(st, vec2(0.0), vec2(1.0));
      col = samp(sst, blur);
      // 玻璃：左上一道很寬很淡的反光、邊緣暗一點（弧面）
      float sheen = exp(-pow((st.x * 0.7 + st.y - 0.42) / 0.16, 2.0));
      col += C_BONE * glass * 0.018 * sheen;
      col *= 1.0 - glass * 0.35 * smoothstep(-90.0, 0.0, d);
    } else if (d < bezel) {
      // 外框：暗色塑膠，內緣一條細高光
      float k = d / bezel;
      col = mix(C_INK2 * 1.25, C_INK * 0.9, k) ;
      col += C_BONE * 0.08 * (1.0 - smoothstep(0.0, 3.0, d));
      col *= 0.85 + 0.3 * (1.0 - st.y);
    } else {
      // 房間：內容溢出來的光（暗版面）或桌上的影子（亮版面）
      float e = d - bezel;
      col = room;
      if (paper > 0.5) col *= 1.0 - 0.3 * exp(-e / 22.0);
      else col += C_SIGNAL * glow * exp(-e / 220.0);
    }
    fragColor = vec4(col, 1.0);
  }`, {
  tex: { value: null }, Hinv: { value: new THREE.Matrix3() }, zc: { value: new THREE.Vector3() }, zf: { value: 0 }, dof: { value: 0 },
  bezel: { value: 0 }, radius: { value: 0 }, glass: { value: 0 }, room: { value: new THREE.Vector3() }, glow: { value: 0 }, paper: { value: 0 },
  csize: { value: new THREE.Vector2(W, H) },
});

/** 單位正方形 (s,t) → 四邊形（畫面 px）的單應矩陣（Heckbert 的公式），回傳 row-major 的 9 個數。 */
function squareToQuad(p: [number, number][]): number[] {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = p as [[number, number], [number, number], [number, number], [number, number]];
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) return [x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0, 1];
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
}

/**
 * 舞台：content（一張 W×H 的離屏圖，線性 HDR）當成空間裡的平面，用鏡頭參數拍到 out。
 * 同一時間只有一個版面在畫，所以離屏圖整批共用一張（shared）。
 */
export class Stage {
  pass = shared('t8.stage', STAGE);
  rt = shared('t8.stage.rt', () => makeRT(W, H));
  private R = new THREE.Matrix4();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();

  /** 內容座標 (u, v)（px）在鏡頭下的畫面座標。 */
  project(cam: StageCam, u: number, v: number) {
    const f = 1500, D = f / cam.zoom;
    this.e.set(cam.pitch, cam.yaw, cam.roll ?? 0, 'YXZ');
    this.R.makeRotationFromEuler(this.e);
    this.v.set(u - W / 2, H / 2 - v, 0).applyMatrix4(this.R);
    const s = f / (D - this.v.z);
    return { x: W / 2 + this.v.x * s + (cam.x ?? 0), y: H / 2 - this.v.y * s + (cam.y ?? 0), z: this.v.z };
  }

  /**
   * 內容座標 (u, v) 附近，內容 1 px 在畫面上是幾 px（v2 標準的字級是「螢幕上的 px」，畫在內容上的字要除以這個倍數）。
   * 用沒有加鏡頭運動的基本機位算；窗格裡的慢推只會多幾個百分比。
   */
  scaleAt(cam: StageCam, u: number, v: number) {
    const a = this.project(cam, u - 50, v), b = this.project(cam, u + 50, v);
    const c = this.project(cam, u, v - 50), d = this.project(cam, u, v + 50);
    return Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(d.x - c.x, d.y - c.y)) / 100;
  }

  draw(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, cam: StageCam) {
    const P = [this.project(cam, 0, 0), this.project(cam, W, 0), this.project(cam, W, H), this.project(cam, 0, H)];
    const m = squareToQuad(P.map((p) => [p.x, p.y]));
    const M = new THREE.Matrix3().set(m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!, m[6]!, m[7]!, m[8]!);
    const u = this.pass.u;
    (u.Hinv!.value as THREE.Matrix3).copy(M.invert());
    // 平面上 (s,t) 的深度是線性的：z = a·s + b·t + c
    const z0 = P[0]!.z, z1 = P[1]!.z, z3 = P[3]!.z;
    (u.zc!.value as THREE.Vector3).set(z1 - z0, z3 - z0, z0);
    const fc = cam.focus ?? [W / 2, H / 2];
    u.zf!.value = this.project(cam, fc[0], fc[1]).z;
    u.dof!.value = cam.dof ?? 0;
    u.bezel!.value = cam.bezel ?? 0;
    u.radius!.value = cam.radius ?? 0;
    u.glass!.value = cam.glass ?? 0;
    (u.room!.value as THREE.Vector3).set(...cam.room);
    u.glow!.value = cam.glow ?? 0;
    u.paper!.value = cam.paper ? 1 : 0;
    u.tex!.value = this.rt.texture;
    this.pass.render(renderer, out);
  }
}

/**
 * 常用的鏡頭運動：進場從比較斜、比較遠的位置在第一拍前後「落定」（outExpo），之後整段慢慢推近，
 * 每兩小節往另一邊輕輕搖一點（緩進小節線）。回傳要疊加在基本機位上的 yaw、pitch、zoom 位移。
 */
export function camMove(au: AudioData, s: number, e: number, t: number, o: { inYaw?: number; inZoom?: number; push?: number; sway?: number } = {}) {
  const land = ease.outExpo(prog(t, s, s + Math.min(0.9, au.beatPeriod(s) * 2)));
  const push = prog(t, s, e, ease.inOutCubic);
  // 搖：以兩小節為一段，段內 inOutCubic，方向交替
  const b = au.barAt(t), b0 = Math.floor(au.barAt(s));
  const seg = Math.floor((b - b0) / 2), k = ease.inOutCubic(clamp((b - b0) / 2 - seg));
  const side = (i: number) => (i % 2 === 0 ? 1 : -1);
  const sway = lerp(seg === 0 ? 0 : side(seg - 1), side(seg), k) * (o.sway ?? 0.012);
  return {
    yaw: (1 - land) * (o.inYaw ?? 0.12) + sway,
    zoom: -(1 - land) * (o.inZoom ?? 0.06) + push * (o.push ?? 0.035),
    pitch: 0,
  };
}
