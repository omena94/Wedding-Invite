// 保齡球道（bowling.ts）的 3D 道具：球道（木板、箭頭、光澤）、洗溝、兩側的擋板、球坑、後面的布幕（留言或歌詞）、
// 十支球瓶、一顆球，以及球道上的倒影（球瓶與球的鏡像，畫在半透明的球道底下）。
// 幾何與材質在模組層共用（shared()）：一晚會建很多次這個版面，shader 不要重編；每一格由正在畫的窗格設好位置與 uniform 再畫。
// 座標（公尺）：地面 y = 0，球道中心 x = 0，1 號瓶在 z = 0，球往 -z 滾；布幕在 z = -1.8。
import * as THREE from 'three';
import { GLSL_COMMON, THEME_UNIFORMS } from '../engine/glsl/common';
import { MASK_GLSL } from './_t25';

/** 布幕：寬、高、底邊（在球坑裡）、z；字模用的畫布大小（每公尺 500 px）。 */
export const BACK = { w: 3.2, h: 1.45, y0: -0.25, z: -1.8, px: 500 };
export const BACK_PX = { w: Math.round(BACK.w * BACK.px), h: Math.round(BACK.h * BACK.px) };
/** 球道邊（1 號瓶在 z = 0）、球道盡頭（接球坑）、球坑底。 */
export const LANE = { hw: 0.53, z0: 3.4, z1: -1.0, pit: -0.24 };
export const BALL_R = 0.108;
/** 瓶台兩側擋板的高度。 */
export const KICK_H = 0.1;
/** 布幕上一句歌詞最多幾個字（韓文歌中文＋原文一起算，所以留寬一點）。 */
export const MAXG = 96;
/** 十支球瓶的位置（x, z）。 */
export const PINS: [number, number][] = [
  [0, 0], [-0.152, -0.264], [0.152, -0.264], [-0.305, -0.528], [0, -0.528], [0.305, -0.528],
  [-0.457, -0.792], [-0.152, -0.792], [0.152, -0.792], [0.457, -0.792],
];

const PRE = /* glsl */ `precision highp float;\nprecision highp int;\n`;
const VERT = /* glsl */ `${PRE}
in vec3 position; in vec3 normal; in vec2 uv;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
out vec3 vW; out vec3 vN; out vec3 vO; out vec2 vUv;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vO = position; vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** 共用的打光：球瓶上方一盞燈（暖白），加一點環境光；uFlash = 全倒那一下的閃光。 */
const LIGHT = /* glsl */ `
uniform vec3 cameraPosition; uniform float uLight; uniform float uFlash; uniform float uDim;
vec3 lit(vec3 P, vec3 N, vec3 base, float spec, float shin) {
  vec3 Lp = vec3(0.0, 1.45, 0.45);
  vec3 Ld = Lp - P; float d2 = dot(Ld, Ld); vec3 L = Ld * inversesqrt(d2);
  float att = 1.7 / (1.0 + 0.8 * d2);
  float dif = max(dot(N, L), 0.0);
  vec3 V = normalize(cameraPosition - P);
  vec3 Hh = normalize(L + V);
  float sp = pow(max(dot(N, Hh), 0.0), shin) * spec;
  vec3 c = base * (0.07 + dif * att * uLight) + mix(C_BONE, C_EMBER, 0.2) * sp * att * uLight;
  c += base * uFlash * 0.35;
  // 邊緣光（輪廓亮一點，暗處也看得出形狀）
  c += base * pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.12 * uLight;
  return c * uDim;
}`;

const frag = (body: string, extra = '') => /* glsl */ `${PRE}
in vec3 vW; in vec3 vN; in vec3 vO; in vec2 vUv;
out vec4 fragColor;
${GLSL_COMMON}
${LIGHT}
${extra}
void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
${body}
}`;

// 球瓶：白色塑膠，瓶頸兩道紅線（訊號色的暗部）
const PIN_FRAG = frag(`
  float y = vO.y;
  float stripe = step(0.245, y) * step(y, 0.262) + step(0.272, y) * step(y, 0.289);
  vec3 base = mix(C_BONE * 0.86, C_BLOOD * 0.9, stripe);
  fragColor = vec4(lit(vW, N, base, 0.9, 60.0), 1.0);
`);
// 球：訊號色的漩渦紋（在球自己的座標，才看得出在滾），三個指孔，很亮的高光
const BALL_FRAG = frag(`
  vec3 q = normalize(vO);
  // 大理石紋：扭過的條紋（低頻），深淺兩色
  float vein = sin((q.x + q.y * 0.6 + q.z * 0.3) * 7.0 + fbm(q * 1.4 + vec3(0.0, 3.0, 1.0), 3) * 5.0);
  vec3 base = mix(C_BLOOD * 0.5, C_SIGNAL * 0.8, smoothstep(-0.6, 0.9, vein)) * 0.9;
  // 指孔
  float holes = 0.0;
  holes = max(holes, 1.0 - smoothstep(0.1, 0.13, length(q - normalize(vec3(0.0, 0.85, 0.5)))));
  holes = max(holes, 1.0 - smoothstep(0.08, 0.1, length(q - normalize(vec3(0.22, 0.95, 0.1)))));
  holes = max(holes, 1.0 - smoothstep(0.08, 0.1, length(q - normalize(vec3(-0.22, 0.95, 0.1)))));
  base = mix(base, C_INK * 0.1, holes);
  fragColor = vec4(lit(vW, N, base, 2.4, 120.0), 1.0);
`);
// 球道：一條一條的楓木板（theme 的暖色帶一點灰），前面的箭頭與點、很亮的光澤；半透明，看得到底下的倒影
const LANE_FRAG = frag(`
  float bw = ${(LANE.hw * 2 / 39).toFixed(4)};
  float b = floor((vW.x + ${LANE.hw}) / bw);
  float fx = fract((vW.x + ${LANE.hw}) / bw);
  float grain = fbm(vec2(b * 3.1, vW.z * 1.4), 3);
  vec3 wood = mix(C_ASH * 0.34, C_SIGNAL * 0.3, 0.28) * (0.82 + 0.18 * hash11(b + 3.0) + 0.1 * grain);
  wood *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.08, min(fx, 1.0 - fx)));
  // 球瓶那一塊（瓶台）亮一點
  if (vW.z < 0.45) wood *= 1.15;
  // 箭頭（7 個，排成 V 字，尖端朝球瓶）
  float ai = clamp(floor(((vW.x + ${LANE.hw}) / bw - 4.5) / 5.0 + 0.5), 0.0, 6.0);
  float axc = (4.5 + 5.0 * ai) * bw - ${LANE.hw};
  float zt = 1.5 + 0.07 * abs(ai - 3.0);
  float ta = step(abs(vW.x - axc), (vW.z - zt) * 0.16) * step(zt, vW.z) * step(vW.z, zt + 0.2);
  wood = mix(wood, C_BLOOD * 0.3, ta * 0.85);
  vec3 c = lit(vW, vec3(0.0, 1.0, 0.0), wood, 1.2, 40.0);
  // 球道上的油光：燈在球道上拉出一條長長的反光
  float streak = exp(-vW.x * vW.x / 0.02) * smoothstep(3.2, 0.5, vW.z) * smoothstep(-1.0, 0.4, vW.z);
  c += mix(C_BONE, C_EMBER, 0.3) * 0.08 * streak * uLight;
  // 往鏡頭這邊越來越暗（燈在球瓶那邊）
  c *= 0.55 + 0.45 * smoothstep(3.2, 0.8, vW.z);
  fragColor = vec4(c, 0.8);
`);
// 洗溝、擋板、球坑、四周：深色；擋板的上緣一道細細的亮邊
const DARK_FRAG = frag(`
  vec3 base = C_INK2 * 0.8 + C_GRAPHITE * 0.04;
  if (vW.y < -0.1) base = C_INK * 0.5; // 球坑
  vec3 c = lit(vW, N, base, 0.4, 20.0);
  c += C_BONE * 0.04 * (1.0 - smoothstep(0.0, 0.012, abs(vW.y - ${KICK_H.toFixed(3)}))) * uLight;
  fragColor = vec4(c, 1.0);
`);
// 布幕：深色的絨布，上面是燈泡排的字（留言：全倒之後依序亮起來；沒有留言：歌詞，照跟唱規則）；
// 字的四周一圈跑馬燈（留言標準 v2：燈框只比字大一點，uFrame = 框的畫布座標 x0, y0, x1, y1），全倒那一下整圈一起亮（uBurst）
const BACK_FRAG = frag(`
  vec2 p = vec2(vUv.x * ${BACK_PX.w}.0, (1.0 - vUv.y) * ${BACK_PX.h}.0);
  // 絨布：直的布紋、上面打下來的一片光
  float fold = 0.8 + 0.2 * sin(p.x * 0.035 + sin(p.x * 0.011) * 2.0);
  vec3 cloth = C_INK2 * 0.75 * fold;
  float pool = exp(-pow((p.x - ${BACK_PX.w / 2}.0) / 700.0, 2.0)) * smoothstep(${BACK_PX.h}.0, 80.0, p.y);
  vec3 c = cloth * (0.4 + 0.9 * pool * uLight);
  // 字
  vec4 m = maskAt(uMask, uRect, p);
  if (m.a > 0.0) {
    float gi = floor(m.g * 255.0 + 0.5);
    vec3 tc;
    if (uMode < 0.5) {
      float rv = clamp((uShown - gi - m.b) * 4.0, 0.0, 1.0);
      float glint = exp(-pow((uShown - gi - m.b) * 2.0, 2.0)) * step(1e-3, uShown - gi);
      tc = mix(C_BONE * 0.1, mix(C_BONE, C_EMBER, 0.15) * 0.93, rv) + C_SIGNAL * 1.8 * glint;
      if (m.r > 0.9) tc = mix(C_ROSE * 0.12, C_ROSE, rv);
    } else {
      int ii = min(int(gi), ${MAXG - 1});
      vec2 g = uGs[ii];
      float on = smoothstep(m.b - 0.05, m.b + 0.05, g.x);
      tc = mix(C_BONE * 0.26, g.y > 0.5 ? C_BONE * 0.9 : C_SIGNAL * 1.5, on);
      // 原文副行（韓文歌，字模標記 128）：比中文安靜——唱到、唱完都是紙白再淡兩成（不閃訊號色）
      if (m.r > 0.4 && m.r < 0.6) tc = mix(C_BONE * 0.26, C_BONE * 0.72, on);
      if (m.r > 0.9) tc = mix(C_ROSE * 0.3, C_ROSE, on);
      tc *= uLyrA;
    }
    c = mix(c, tc, m.a);
  }
  // 跑馬燈：字外面一圈小燈泡（離框邊 15 px，四個角各一顆，間距約 40 px），沿著框一圈編號，全倒之後跟著拍子跑；
  // 燈框內緣一條很細的線
  vec2 fw = uFrame.zw - uFrame.xy;
  vec2 e = vec2(min(p.x - uFrame.x, uFrame.z - p.x), min(p.y - uFrame.y, uFrame.w - p.y));
  float em = min(e.x, e.y);
  if (em > -20.0 && em < 50.0) {
    float ix = fw.x - 30.0, iy = fw.y - 30.0;
    float nx = max(1.0, floor(ix / 40.0 + 0.5)), ny = max(1.0, floor(iy / 40.0 + 0.5));
    float stx = ix / nx, sty = iy / ny;
    vec2 q = p - uFrame.xy - 15.0;
    float bxi = clamp(floor(q.x / stx + 0.5), 0.0, nx), byi = clamp(floor(q.y / sty + 0.5), 0.0, ny);
    // 最近的一顆：上、右、下、左四邊各找一個候選（順時針編號）
    float d = length(q - vec2(bxi * stx, 0.0)), idx = bxi;
    float dR = length(q - vec2(ix, byi * sty)); if (dR < d) { d = dR; idx = nx + byi; }
    float dB = length(q - vec2(bxi * stx, iy)); if (dB < d) { d = dB; idx = nx + ny + (nx - bxi); }
    float dL = length(q - vec2(0.0, byi * sty)); if (dL < d) { d = dL; idx = 2.0 * nx + ny + (ny - byi); }
    float bulb = 1.0 - smoothstep(5.5, 7.5, d);
    float on = max(step(0.5, fract((idx + uChase) / 3.0)) * uMarq, uBurst);
    c = mix(c, mix(C_BLOOD * 0.25, C_EMBER * 1.3 + C_SIGNAL * 0.6, on), bulb);
    // 燈泡照在布上的一點光
    c += (C_SIGNAL * 0.05 + C_EMBER * 0.02) * on * exp(-d / 14.0) * (1.0 - bulb);
  }
  c = mix(c, C_ASH * 0.12 * (0.5 + 0.5 * uMarq), (1.0 - smoothstep(0.6, 1.6, abs(em - 36.0))) * step(0.0, em) * 0.8);
  fragColor = vec4(c * uDim, 1.0);
`, `uniform sampler2D uMask; uniform vec4 uRect; uniform float uShown; uniform float uMode; uniform vec2 uGs[${MAXG}]; uniform float uLyrA; uniform float uChase; uniform float uMarq; uniform vec4 uFrame; uniform float uBurst;
${MASK_GLSL}`);

const PIN_PROFILE: [number, number][] = [
  [0, 0], [0.026, 0], [0.036, 0.02], [0.05, 0.06], [0.058, 0.1], [0.06, 0.13], [0.057, 0.16], [0.047, 0.2], [0.034, 0.235],
  [0.024, 0.262], [0.021, 0.28], [0.024, 0.3], [0.03, 0.325], [0.032, 0.345], [0.028, 0.365], [0.018, 0.377], [0, 0.381],
];

export class BowlingRig {
  scene = new THREE.Scene();
  /** 所有材質共用的一組 uniform（改一次全部跟著變）。 */
  u: Record<string, THREE.IUniform> = {
    ...THEME_UNIFORMS, uLight: { value: 1 }, uFlash: { value: 0 }, uDim: { value: 1 },
  };
  pins: THREE.Mesh[] = [];
  pinsR: THREE.Mesh[] = [];
  ball: THREE.Mesh;
  ballR: THREE.Mesh;
  back: THREE.Mesh;
  backMat: THREE.RawShaderMaterial;

  constructor() {
    const S = this.scene;
    const mk = (fragSrc: string, extra: Record<string, THREE.IUniform> = {}, o: Partial<THREE.ShaderMaterialParameters> = {}) =>
      new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: fragSrc, uniforms: { ...this.u, ...extra }, side: THREE.DoubleSide, ...o });
    const dimU = { uDim: { value: 0.3 } };
    const pinMat = mk(PIN_FRAG), pinMatR = mk(PIN_FRAG, dimU);
    const ballMat = mk(BALL_FRAG), ballMatR = mk(BALL_FRAG, dimU);
    const laneMat = mk(LANE_FRAG, {}, { transparent: true });
    const darkMat = mk(DARK_FRAG);
    this.backMat = mk(BACK_FRAG, {
      uMask: { value: null }, uRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uShown: { value: 0 }, uMode: { value: 0 },
      uGs: { value: Array.from({ length: MAXG }, () => new THREE.Vector2()) }, uLyrA: { value: 1 }, uChase: { value: 0 }, uMarq: { value: 0 },
      uFrame: { value: new THREE.Vector4(0, 0, 1, 1) }, uBurst: { value: 0 },
    });
    // ---- 倒影：球瓶與球的鏡像（y 翻過來），先畫，球道半透明蓋在上面
    const mirror = new THREE.Group();
    mirror.scale.set(1, -1, 1);
    S.add(mirror);
    const pinGeo = new THREE.LatheGeometry(PIN_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)), 28);
    for (let i = 0; i < 10; i++) {
      const p = new THREE.Mesh(pinGeo, pinMat); S.add(p); this.pins.push(p);
      const r = new THREE.Mesh(pinGeo, pinMatR); r.renderOrder = -1; mirror.add(r); this.pinsR.push(r);
    }
    const ballGeo = new THREE.SphereGeometry(BALL_R, 48, 32);
    this.ball = new THREE.Mesh(ballGeo, ballMat); S.add(this.ball);
    this.ballR = new THREE.Mesh(ballGeo, ballMatR); this.ballR.renderOrder = -1; mirror.add(this.ballR);
    // ---- 球道（半透明）、洗溝、兩側擋板、球坑、布幕
    const plane = (w: number, h: number, mat: THREE.Material, pos: [number, number, number], rot: [number, number, number]) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.position.set(...pos); m.rotation.set(...rot); S.add(m); return m;
    };
    const L = LANE.z0 - LANE.z1;
    plane(LANE.hw * 2, L, laneMat, [0, 0, (LANE.z0 + LANE.z1) / 2], [-Math.PI / 2, 0, 0]).renderOrder = 1;
    // 洗溝（兩條淺淺的槽，底比球道低）與球道外面的地板
    for (const sx of [-1, 1]) {
      plane(0.24, L, darkMat, [sx * (LANE.hw + 0.12), -0.05, (LANE.z0 + LANE.z1) / 2], [-Math.PI / 2, 0, 0]);
      plane(3, L + 2, darkMat, [sx * (LANE.hw + 0.24 + 1.5), 0.02, (LANE.z0 + LANE.z1) / 2 - 1], [-Math.PI / 2, 0, 0]);
      // 瓶台兩側的擋板（kickback）：從球道盡頭前一段到布幕
      // 很矮（0.1 m）：鏡頭推到最近時，它的上緣投到布幕上也還在字塊下面（不會擋到署名）
      plane(1.6, KICK_H, darkMat, [sx * (LANE.hw + 0.26), KICK_H / 2, -0.9], [0, sx * -Math.PI / 2, 0]);
    }
    // 球坑：球道盡頭往下的一個坑
    plane(LANE.hw * 2 + 0.6, 0.8, darkMat, [0, LANE.pit, (LANE.z1 + BACK.z) / 2], [-Math.PI / 2, 0, 0]);
    plane(LANE.hw * 2 + 0.6, -LANE.pit, darkMat, [0, LANE.pit / 2, LANE.z1 - 0.001], [0, 0, 0]);
    this.back = plane(BACK.w, BACK.h, this.backMat, [0, BACK.y0 + BACK.h / 2, BACK.z], [0, 0, 0]);
  }
}
