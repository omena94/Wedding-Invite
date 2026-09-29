// 緞帶（暗）：黑色的空間裡，一條很長的雙面緞帶（正面象牙白、背面是這首歌的訊號色）被丟進畫面，一路飄、一路翻面。
//  - 開場：緞帶從左邊甩進來，下緣那一段平平地躺著、正面朝上——歌詞就印在這一段緞帶上（逐字跟唱，正在唱的字是深一點的訊號色）；
//    其他段落跟著一道慢慢走的波起伏，轉彎的地方翻到背面（訊號色）。
//  - 第一個小節線（窗格短就第一拍）：緞帶的另一頭「咻」地往右上捲起、打成一個蝴蝶結；結上掛著一張牛皮紙的吊牌
//    從上面掉下來、彈兩下、輕輕晃——吊牌上手寫的就是主打留言（最大、最清楚），署名在下面。
//  - 之後每個小節線，一道翻轉從緞帶上升的那一段往結的方向滾過去（正反面一閃）；吊牌被帶得晃一下。
//  - 沒有留言：吊牌上寫歌詞（大字、跟唱）與一行邀請；緞帶上印一整排「ALAN & OMENA · 日期」。純音樂時緞帶也印這一排。
// 畫法：three.js 真 3D（shared 的 MSAA 目標，像 candles）：緞帶是每格重算的扁帶子（_t22 的 stripGeometry，
// 中心線是 Catmull-Rom、每一點有自己的翻轉角），正反面用 gl_FrontFacing 分開上色（緞面的高光）；
// 印在緞帶上的字是一張照弧長對應的圖層；蝴蝶結、吊牌也是網格。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, makeRT, sharedMSAA } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { GLSL_COMMON, THEME_UNIFORMS } from '../engine/glsl/common';
import { F, font } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, prog, pulse, lerp, springStep, noise1, smoothstep } from '../engine/util';
import { fitText } from '../engine/text';
import { lyricAt, drawLyric, layoutLyric, beatAfter, COUPLE_EN, COUPLE_ZH, DATE_DOTS, type LyricStyle } from './_motifs';
import { preloadText, INVITE_SMALL, paperSignal } from './_t19';
import { barsIn } from './_t1';
import { camDist } from './_t4';
import { placeBlock, drawBlock, sigOf, stripGeometry, setStrip, fitV2, T22_TEXT, type Rect } from './_t22';
import { lyricV2, V2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'keepsake', paper: false, energy: [0.15, 0.8], bars: [4, 12], weight: 1 };

const FOV = 30;
const D0 = camDist(FOV);
/** 緞帶：取樣點數、半寬（px）、印字圖層的長（最長的緞帶弧長）與高、解析度。 */
const N = 220;
const HALF = 66;
const TEXW = 3400, TEXH = 132, TEXRES = 1.4;
/** 歌詞印在緞帶的哪一段（弧長，px）：下緣平躺的那一段。 */
const TXT = { s0: 360, s1: 1180 };
/** 蝴蝶結的結（螢幕座標）。 */
const KNOT = { x: 1320, y: 196 };
/**
 * 吊牌：大小、繩孔在吊牌上的位置、繩長。留言標準 v2：吊牌（留言的容器）在畫面上 ≤ 860×430，
 * 吊牌離鏡頭比緞帶近一點，畫面上約放大 1.04 倍（TAG_S），740×400 → 約 770×416。
 */
const TAG = { w: 740, h: 400, hx: 370, hy: 40, str: 96 };
const TAG_S = 1.04;
/** 吊牌上寫留言的範圍（吊牌座標）。 */
const TAGM = { x: 52, y: 92, w: 636, h: 282 };
/** 背景裡慢慢飄落的捲曲緞帶（像拆禮物時剪下來、用剪刀刮捲的那種）：螺旋的圈數、每段的點數。 */
const CURL_N = 120;
const CURLS = [
  { x: 260, y: 300, z: -700, s: 1.0, spin: 0.9, fall: 26, ph: 0.0 },
  { x: 610, y: 150, z: -1300, s: 0.8, spin: -0.7, fall: 18, ph: 2.1 },
  { x: 120, y: 620, z: -1000, s: 0.7, spin: 1.1, fall: 22, ph: 4.2 },
];

/** 綁好之後緞帶中心線的控制點（螢幕座標、z 往鏡頭）。 */
const TIED: [number, number, number][] = [
  [-260, 990, 0], [60, 900, 30], [520, 862, 0], [1010, 880, -20], [1190, 820, -60], [1235, 580, -100], [1265, 370, -70], [KNOT.x - 20, KNOT.y + 30, 10],
];
/** 還沒綁：右邊那一頭拖出畫面。 */
const FREE: [number, number, number][] = [
  [-260, 990, 0], [60, 900, 30], [520, 862, 0], [1010, 880, -20], [1360, 910, 40], [1720, 830, 80], [2060, 720, 40], [2420, 640, 0],
];

const VERT = /* glsl */ `
precision highp float;
in vec3 position; in vec3 normal; in vec2 uv;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
out vec3 vN; out vec2 vUv; out vec3 vPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// 緞面：正面象牙白（可以印字）、背面訊號色；柔的漫射＋窄的高光＋斜看時的一層光澤；兩側的織邊暗一點
const SATIN = /* glsl */ `
precision highp float;
precision highp int;
in vec3 vN; in vec2 vUv; in vec3 vPos;
out vec4 fragColor;
${GLSL_COMMON}
uniform sampler2D txt; uniform float txtOn; uniform vec3 camPos; uniform float frontSign; uniform float dim;
void main() {
  bool front = (gl_FrontFacing ? 1.0 : -1.0) * frontSign > 0.0;
  vec3 V = normalize(camPos - vPos);
  vec3 n = normalize(vN);
  if (dot(n, V) < 0.0) n = -n;
  vec3 L = normalize(vec3(-0.45, 0.62, 0.75));
  float dif = max(dot(n, L), 0.0);
  float spec = pow(max(dot(n, normalize(L + V)), 0.0), 28.0);
  float sheen = pow(1.0 - max(dot(n, V), 0.0), 2.5);
  float edge = smoothstep(0.0, 0.045, vUv.y) * smoothstep(1.0, 0.955, vUv.y);
  vec3 col;
  if (front) {
    vec3 alb = mix(C_BONE, C_PAPER, 0.3);
    if (txtOn > 0.5) {
      vec4 tx = fastLayer(textureLod(txt, vUv, 0.0));
      alb = alb * (1.0 - tx.a) + tx.rgb;
    }
    col = alb * (0.13 + 0.8 * dif) + C_BONE * (spec * 0.3 + sheen * 0.08);
  } else {
    vec3 alb = mix(C_SIGNAL, C_BLOOD, 0.42);
    col = alb * (0.12 + 0.85 * dif) + mix(C_EMBER, C_BONE, 0.4) * (spec * 0.45 + sheen * 0.16);
  }
  col *= (0.72 + 0.28 * edge) * dim;
  fragColor = vec4(col, 1.0);
}`;

// 吊牌：牛皮紙（圖層自己畫形狀與顏色，alpha 是吊牌的形狀），照同一盞燈
const TAGF = /* glsl */ `
precision highp float;
precision highp int;
in vec3 vN; in vec2 vUv; in vec3 vPos;
out vec4 fragColor;
${GLSL_COMMON}
uniform sampler2D tex; uniform vec3 camPos;
void main() {
  vec4 c = fastLayer(textureLod(tex, vUv, 0.0));
  if (c.a <= 0.002) discard;
  vec3 V = normalize(camPos - vPos);
  vec3 n = normalize(vN);
  if (dot(n, V) < 0.0) n = -n;
  float dif = max(dot(n, normalize(vec3(-0.45, 0.62, 0.75))), 0.0);
  float grain = 0.96 + 0.04 * snoise(vUv * vec2(90.0, 55.0));
  fragColor = vec4(c.rgb * (0.3 + 0.78 * dif) * grain, c.a);
}`;

// 背景：黑絲絨，吊牌後面一團很淡的光，吊牌的影子（很柔）
const BG = () => new FSPass(/* glsl */ `
  uniform vec4 tagR; uniform float tagK;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 col = C_INK * (0.9 + 0.15 * fbm(p / 520.0, 2));
    vec2 q = (p - vec2(1250.0, 480.0)) / vec2(900.0, 650.0);
    col += C_INK2 * 1.1 * exp(-dot(q, q) * 1.5);
    vec2 d = abs(p - tagR.xy) - tagR.zw;
    float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
    col *= 1.0 - 0.55 * tagK * (1.0 - smoothstep(-20.0, 60.0, sd));
    fragColor = vec4(col, 1.0);
  }`, { tagR: { value: new THREE.Vector4(0, 0, 1, 1) }, tagK: { value: 0 } });

type V3 = [number, number, number];
const toW = (p: V3) => new THREE.Vector3(p[0], H - p[1], p[2]);

function satinMat(frontSign: number) {
  const m = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: SATIN,
    uniforms: { ...THEME_UNIFORMS, txt: { value: null }, txtOn: { value: 0 }, camPos: { value: new THREE.Vector3() }, frontSign: { value: frontSign }, dim: { value: 1 } },
    side: THREE.DoubleSide, depthTest: true, depthWrite: true,
  });
  return m;
}

/** 蝴蝶結的一個圈（結的座標，px，y 往上）：往 d 那一側拱出去的淚滴形，圈的平面往後倒，看得到緞帶的面。 */
function loopPts(d: number, n = 44) {
  const pts: THREE.Vector3[] = [], side: THREE.Vector3[] = [];
  const tau = 0.62, ca = Math.cos(tau), sa = Math.sin(tau);
  for (let i = 0; i < n; i++) {
    const a = (i / (n - 1)) * Math.PI * 2;
    const x = d * 215 * (1 - Math.cos(a)) * 0.5 * (1 + 0.1 * Math.sin(a));
    const y = 62 * Math.sin(a) + 34 * (1 - Math.cos(a)) * 0.5;
    pts.push(new THREE.Vector3(x, y * ca, -y * sa + 10));
    // 靠結的地方被束起來（窄），圈的外端最寬
    const pinch = 0.42 + 0.58 * Math.sin(a * 0.5);
    side.push(new THREE.Vector3(0.12 * d * Math.sin(a), sa, ca).normalize().multiplyScalar(HALF * 0.8 * pinch));
  }
  return { pts, side };
}
/**
 * 捲曲緞帶（螺旋，軸是 y）：寬度方向沿著軸，像刮捲過的包裝緞帶一圈一圈彈簧似地垂著。
 * 半徑往下慢慢變小、圈距慢慢變大（被自己的重量拉開）。
 */
function curlPts() {
  const pts: THREE.Vector3[] = [], side: THREE.Vector3[] = [];
  const turns = 4.5;
  for (let i = 0; i < CURL_N; i++) {
    const u = i / (CURL_N - 1), a = u * turns * Math.PI * 2;
    const r = 58 * (1 - 0.3 * u), y = -u * 380 - 70 * u * u;
    pts.push(new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a)));
    side.push(new THREE.Vector3(0.25 * Math.sin(a), 1, -0.25 * Math.cos(a)).normalize().multiplyScalar(17));
  }
  return { pts, side };
}
/** 蝴蝶結的尾巴：從結往下垂，一邊垂一邊翻。 */
function tailPts(d: number, n = 30) {
  const pts: THREE.Vector3[] = [], side: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    pts.push(new THREE.Vector3(d * (22 + 150 * u + 14 * Math.sin(u * 4)), -210 * u, -30 - 40 * u));
    const a = 0.25 + 1.3 * u * u;
    side.push(new THREE.Vector3(Math.cos(a), 0.25 * d, Math.sin(a)).normalize().multiplyScalar(HALF * 0.78 * (1 - 0.12 * u)));
  }
  return { pts, side };
}

function makeRig() {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(FOV, W / H, 20, 20000);
  cam.position.set(W / 2, H / 2, D0);
  cam.lookAt(W / 2, H / 2, 0);
  // stripGeometry 的三角形繞法：正對鏡頭（面朝 +z）的是「背面」，所以 frontSign = -1 表示 gl_FrontFacing 為假時是正面
  const mat = satinMat(-1);
  const ribbon = new THREE.Mesh(stripGeometry(N), mat);
  ribbon.frustumCulled = false;
  scene.add(ribbon);
  const bow = new THREE.Group();
  const bowMat = satinMat(-1);
  const parts: THREE.Mesh[] = [];
  for (const d of [1, -1]) {
    const g = stripGeometry(44); const { pts, side } = loopPts(d); setStrip(g, pts, side);
    const m = new THREE.Mesh(g, bowMat); m.frustumCulled = false; bow.add(m); parts.push(m);
  }
  for (const d of [1, -1]) {
    const g = stripGeometry(30); const { pts, side } = tailPts(d); setStrip(g, pts, side);
    const m = new THREE.Mesh(g, bowMat); m.frustumCulled = false; bow.add(m); parts.push(m);
  }
  // 結：一小段緞帶繞一圈（圓柱的側面），正面朝外
  const knotMat = satinMat(1);
  const knot = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, 64, 24, 1, true), knotMat);
  knot.position.z = 22;
  bow.add(knot);
  scene.add(bow);
  const tagMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: TAGF,
    uniforms: { ...THEME_UNIFORMS, tex: { value: null }, camPos: { value: new THREE.Vector3() } },
    side: THREE.DoubleSide, depthTest: true, depthWrite: false, transparent: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const tagPivot = new THREE.Group();
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(TAG.w, TAG.h), tagMat);
  // 吊牌以繩孔為支點：網格往下、往左移（繩孔在 (hx, hy)）
  tag.position.set(TAG.w / 2 - TAG.hx, -(TAG.h / 2 - TAG.hy), 0);
  tagPivot.add(tag);
  scene.add(tagPivot);
  const curve = new THREE.CatmullRomCurve3(TIED.map(toW), false, 'centripetal');
  // 背景的捲曲緞帶：遠、暗（沒有景深，用暗一點代替失焦），慢慢轉著往下飄
  const curlMat = satinMat(-1);
  curlMat.uniforms.dim!.value = 0.24;
  const curlG = stripGeometry(CURL_N);
  const cp = curlPts();
  setStrip(curlG, cp.pts, cp.side);
  const curls = CURLS.map(() => { const m = new THREE.Mesh(curlG, curlMat); m.frustumCulled = false; m.renderOrder = -1; scene.add(m); return m; });
  return { scene, cam, ribbon, mat, bow, bowMat, knotMat, knot, tagPivot, tag, tagMat, curve, curls, curlMat };
}

export default class Ribbon extends Scene {
  rig = shared('ribbon.rig', makeRig);
  bg = shared('ribbon.bg', BG);
  /** 緞帶與吊牌是細長、邊很多的網格：畫進共用的 4× MSAA 目標（像 candles）。 */
  rt = sharedMSAA();
  txt = this.track(new Layer2D(TEXW, TEXH, TEXRES, { fast: true }));
  tagL = this.track(new Layer2D(TAG.w, TAG.h, 1.75, { fast: true }));
  glow = this.track(new LineBatch(64, { screen2D: true, blend: 'normal' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  tTie = 0;
  bars: number[] = [];
  ribSt: LyricStyle = { family: F.archivo(100, 700), size: 48, minSize: V2.lyrMin, maxWidth: TXT.s1 - TXT.s0 - 40, align: 'center', lineHeight: 1.08 };
  tagSt: LyricStyle = { family: F.archivo(100, 800), size: V2.lyrMax / TAG_S, minSize: V2.lyrMin / TAG_S, maxWidth: TAG.w - 110, align: 'center', lineHeight: 1.14 };
  /** 留言在畫面上的字級（歌詞照它小一級）。 */
  msgScreen: number | null = null;
  motif = false;
  avoid: Rect[] = [];
  private pts: THREE.Vector3[] = Array.from({ length: N }, () => new THREE.Vector3());
  private side: THREE.Vector3[] = Array.from({ length: N }, () => new THREE.Vector3());
  private tmp = new THREE.Vector3();

  override async init() {
    const { audio: au, start: s, end: e, lyrics } = this.ctx;
    const m = this.msg;
    await preloadText(this.ctx, `${m ? m.text + sigOf(m) : ''}${T22_TEXT}${INVITE_SMALL}To ${COUPLE_ZH}${COUPLE_EN.toUpperCase()}${DATE_DOTS}FROM THE COUPLE`);
    const B = au.beatPeriod(s + 0.1);
    const first = beatAfter(au, s + Math.min(0.35, B * 0.7));
    const bars = barsIn(au, first, e);
    const barLen = bars.length > 1 ? bars[1]! - bars[0]! : B * 4;
    this.tTie = bars[0] !== undefined && bars[0] - first <= barLen * 0.55 && e - bars[0] > barLen * 1.5 ? bars[0] : first;
    this.bars = barsIn(au, this.tTie + 1.2, e);
    const ink = { active: paperSignal(), sung: rgba('sepia', 0.95), unsung: rgba('sepia', 0.3) };
    this.ribSt = { ...this.ribSt, ...ink };
    this.tagSt = { ...this.tagSt, ...ink };
    // 沒有留言、或純音樂：緞帶上印一整排名字與日期（婚禮緞帶常見的印法），歌詞搬到吊牌（沒有留言時）
    this.motif = !m || !lyrics.has;
    this.drawTag(0);
    // 歌詞比留言小一級（v2：40～52）；緞帶就在鏡頭的焦平面上，印在上面的字級 ≈ 畫面字級
    this.ribSt = { ...this.ribSt, size: lyricV2(this.msgScreen) };
    if (this.motif) this.drawMotif();
    this.avoid = [[880, 280, 850, 520], [TXT.s0 - 300, 790, TXT.s1 - TXT.s0 + 60, 150]];
  }

  /** 緞帶上一整排「ALAN & OMENA · 日期」（畫一次）。 */
  private drawMotif() {
    const L = this.txt, c = L.ctx;
    L.clear();
    c.textBaseline = 'middle'; c.fillStyle = rgba('sepia', 0.55);
    c.font = font(F.serif(600), 34); c.letterSpacing = '6px';
    const unit = `${COUPLE_EN.toUpperCase()}   ·   ${DATE_DOTS}   ·   `;
    const w = c.measureText(unit).width;
    for (let x = 40; x < TEXW; x += w) c.fillText(unit, x, TEXH / 2 + 2);
    c.letterSpacing = '0px';
    L.upload();
  }

  /** 吊牌：牛皮紙、上緣兩個斜角、繩孔的補強圈；留言（手寫）與署名；沒有留言時寫歌詞（每格重畫）。 */
  private drawTag(t: number) {
    const L = this.tagL, c = L.ctx, m = this.msg;
    L.clear();
    const cut = 70;
    c.beginPath();
    c.moveTo(cut, 0); c.lineTo(TAG.w - cut, 0); c.lineTo(TAG.w, cut); c.lineTo(TAG.w, TAG.h); c.lineTo(0, TAG.h); c.lineTo(0, cut); c.closePath();
    c.fillStyle = rgba('paper'); c.fill();
    c.save(); c.clip();
    c.fillStyle = rgba('sepia', 0.08); c.fillRect(0, 0, TAG.w, TAG.h);
    c.strokeStyle = rgba('sepia', 0.22); c.lineWidth = 2;
    c.beginPath(); c.moveTo(cut + 18, 16); c.lineTo(TAG.w - cut - 18, 16); c.lineTo(TAG.w - 16, cut + 18); c.lineTo(TAG.w - 16, TAG.h - 16); c.lineTo(16, TAG.h - 16); c.lineTo(16, cut + 18); c.closePath(); c.stroke();
    c.restore();
    // 繩孔（補強圈＋洞）
    c.fillStyle = rgba('signal', 0.9); c.beginPath(); c.arc(TAG.hx, TAG.hy, 22, 0, Math.PI * 2); c.fill();
    c.save(); c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.arc(TAG.hx, TAG.hy, 11, 0, Math.PI * 2); c.fill(); c.restore();
    c.textBaseline = 'alphabetic';
    c.font = font(F.hand(400), 22); c.fillStyle = rgba('sepia', 0.6);
    c.fillText(m?.couple ? 'To 大家' : `To ${COUPLE_ZH}`, TAGM.x, 74);
    if (m) {
      if (m.couple) {
        c.textAlign = 'right'; c.font = font(F.mono(500), 14); c.letterSpacing = '4px'; c.fillStyle = rgba('blood', 0.9);
        c.fillText('FROM THE COUPLE · 新人', TAG.w - TAGM.x, 72); c.letterSpacing = '0px'; c.textAlign = 'left';
      }
      const fam = F.hand(700), sig = sigOf(m);
      const blk = fitV2(c, m.text, fam, TAGM.w, TAGM.h, TAG_S, { lineHeight: 1.28 });
      this.msgScreen = blk.fit.size * TAG_S;
      const top = TAGM.y + Math.max(0, (TAGM.h - blk.height) * 0.42);
      const pl = placeBlock(c, blk, fam, sig, TAGM.x, top);
      drawBlock(c, blk, pl, fam, sig, { color: rgba('sepia', 0.95), sigColor: rgba('sepia', 0.72) });
    } else {
      const ly = lyricAt(this.ctx.lyrics, t);
      if (ly) {
        const lay = layoutLyric(c, ly.line, this.tagSt);
        c.save(); c.translate(TAG.w / 2, 230 - (lay.rows.length - 1) * lay.size * 0.57);
        drawLyric(c, ly.line, t, this.tagSt, lay, ly.k);
        c.restore();
      } else {
        c.textAlign = 'center'; c.font = font(F.hand(700), 40); c.fillStyle = rgba('sepia', 0.35);
        c.fillText(this.ctx.lyrics.has ? '♪（間奏中）' : '♪ 本曲為純音樂', TAG.w / 2, 230);
        c.textAlign = 'left';
      }
      c.textAlign = 'center'; c.fillStyle = rgba('sepia', 0.62);
      const fit = fitText(c, INVITE_SMALL, F.hand(700), TAG.w - 140, 40, { min: 22, max: 28 });
      c.font = font(F.hand(700), fit.size);
      c.fillText(INVITE_SMALL, TAG.w / 2, TAG.h - 52);
      c.textAlign = 'left';
    }
    L.upload();
  }

  /** 印在緞帶上的歌詞（弧長 TXT 那一段；每格重畫）。 */
  private drawRibbonLyric(t: number) {
    const L = this.txt, c = L.ctx;
    L.clear();
    const ly = lyricAt(this.ctx.lyrics, t);
    if (ly) {
      const lay = layoutLyric(c, ly.line, this.ribSt);
      c.save(); c.translate((TXT.s0 + TXT.s1) / 2, TEXH / 2 + lay.size * 0.36 - (lay.rows.length - 1) * lay.size * 0.54);
      drawLyric(c, ly.line, t, this.ribSt, lay, ly.k);
      c.restore();
    }
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const R = this.rig;

    // ---- 緞帶的中心線：開場從左邊甩進來；小節線時右邊那一頭捲上去打結
    const tieK = ease.outBack(clamp((t - this.tTie) / 0.55), 1.3);
    const inK = ease.outExpo(prog(t, s, s + 0.75));
    const ctrl = R.curve.points;
    for (let i = 0; i < TIED.length; i++) {
      const a = FREE[i]!, b = TIED[i]!;
      // 還沒打結的那一頭隨著時間慢慢飄
      const drift = (1 - tieK) * 40 * Math.sin(t * 1.1 + i * 1.3);
      ctrl[i]!.set(lerp(a[0], b[0], tieK) - (1 - inK) * 1500, H - (lerp(a[1], b[1], tieK) + drift), lerp(a[2], b[2], tieK));
    }
    R.curve.updateArcLengths();
    const base = R.curve.getSpacedPoints(N - 1);
    const Ltot = R.curve.getLength();
    // 沿著緞帶走的波（印字的那一段幾乎不動、讀得到）與翻面
    const flips = this.bars.map((b) => clamp((t - b) / 0.9));
    const Z = new THREE.Vector3(0, 0, 1), T = new THREE.Vector3(), B0 = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const sArc = (i / (N - 1)) * Ltot;
      const p = base[i]!, q = base[Math.min(N - 1, i + 1)]!, o = base[Math.max(0, i - 1)]!;
      T.subVectors(q, o).normalize();
      B0.crossVectors(Z, T).normalize();
      const calm = 1 - smoothBand(sArc, TXT.s0 - 120, TXT.s1 + 120, 140);
      const tail = clamp((Ltot - sArc) / 200) * (1 - 0.8 * tieK) + 0.2 * tieK * clamp((Ltot - sArc) / 400);
      const amp = lerp(6, 34, calm) * tail;
      const wv = Math.sin(sArc * 0.0075 - t * 2.3);
      this.pts[i]!.copy(p).addScaledVector(B0, amp * wv);
      this.pts[i]!.z += 60 * calm * Math.sin(sArc * 0.0045 - t * 1.6) * tail;
      // 翻轉角：進場的那一段從背面翻到正面；印字那一段正面朝上；往上升的那一段翻到背面；小節線一道 360° 翻轉往結滾過去
      let phi = Math.PI * (1 - smoothstep(TXT.s0 - 330, TXT.s0 - 120, sArc)) + Math.PI * smoothstep(TXT.s1 + 140, TXT.s1 + 420, sArc) * (0.35 + 0.65 * tieK);
      phi += 0.18 * calm * Math.sin(sArc * 0.006 + t * 1.3);
      for (const fk of flips) {
        if (fk <= 0 || fk >= 1) continue;
        // 一道 360° 的翻轉從上升段的起點往結滾過去（翻過去之後跟原來一樣；印字的那一段不受影響）
        const c0 = lerp(TXT.s1 + 400, Ltot + 300, ease.inOutQuad(fk));
        phi += Math.PI * 2 * smoothstep(c0 - 260, c0, sArc);
      }
      this.side[i]!.copy(B0).multiplyScalar(Math.cos(phi)).addScaledVector(Z, Math.sin(phi)).multiplyScalar(HALF);
    }
    setStrip(R.ribbon.geometry, this.pts, this.side, 1 / TEXW);

    // ---- 蝴蝶結（結在緞帶的末端）
    const bowK = ease.outBack(clamp((t - this.tTie - 0.12) / 0.45), 1.8);
    R.bow.visible = bowK > 0.01;
    R.bow.position.set(KNOT.x, H - KNOT.y, 20);
    // 大鼓時蝴蝶結跟著「噗」一下（次要動作落在拍點）
    R.bow.scale.setScalar(Math.max(0.01, bowK) * (1 + 0.03 * f.a.kick));
    let jolt = 0;
    for (const b of this.bars) jolt += pulse(t, b, 0.12);
    R.bow.rotation.z = 0.08 * Math.sin((t - this.tTie) * 1.2) * clamp(t - this.tTie) + 0.04 * jolt;

    // ---- 背景的捲曲緞帶：慢慢轉著往下飄（遠的轉得慢、落得慢：視差），每個小節線被風帶一下
    let gustAll = 0;
    for (const b of this.bars) if (t >= b) gustAll += Math.exp(-(t - b) * 1.6) * Math.sin(Math.min(Math.PI, (t - b) * 3.2));
    R.curls.forEach((m, i) => {
      const cf = CURLS[i]!;
      const lt = t - s;
      // 在畫面外（整條都在上緣之上或下緣之下）才繞回去，不會在畫面裡突然冒出來
      const y = ((cf.y + 560 + lt * cf.fall) % 1660) - 560;
      m.position.set(cf.x + 30 * Math.sin(lt * 0.5 + cf.ph) + 40 * gustAll * cf.s, H - y, cf.z);
      m.rotation.set(0.18 * Math.sin(lt * 0.4 + cf.ph), cf.spin * lt + cf.ph + 0.5 * gustAll, 0.1 * Math.sin(lt * 0.3 + cf.ph));
      m.scale.setScalar(cf.s * (1 + 0.04 * f.a.kick));
    });
    R.curlMat.uniforms.dim!.value = 0.24 * prog(t, s, s + 0.6);

    // ---- 吊牌：打結之後從上面掉下來、彈兩下，之後輕輕晃（小節線被帶一下）
    // 吊牌：打結之後從結的右上方甩下來（以繩孔為支點像鐘擺一樣盪兩下），之後輕輕晃
    const tDrop = this.tTie + 0.25;
    const drop = t < tDrop ? 0 : springStep(t - tDrop, 1.1, 0.34);
    const hang = new THREE.Vector3(KNOT.x, H - (KNOT.y + 34 + TAG.str), 60);
    R.tagPivot.position.set(hang.x, hang.y, hang.z);
    R.tagPivot.scale.setScalar(lerp(0.55, 1, clamp(drop)));
    R.tagPivot.visible = t >= tDrop;
    let swing = 1.9 * (1 - drop) + 0.02 * Math.sin((t - tDrop) * 1.7);
    for (const b of this.bars) if (t > b) swing += 0.03 * Math.exp(-(t - b) * 2.5) * Math.sin((t - b) * 7);
    R.tagPivot.rotation.set(0.05 * noise1(t * 0.5, 3), 0.14 * Math.sin((t - tDrop) * 0.8) * Math.exp(-(t - tDrop) * 0.4) + 0.05 * noise1(t * 0.4, 5), swing);

    // ---- 鏡頭：整個窗格很慢地推近、往吊牌那邊偏（先設好：緞面的高光要用這一格的鏡頭位置）
    const hold = ease.inOutQuad(f.p);
    R.cam.position.set(W / 2 + 40 * hold, H / 2 - 10 * hold, D0 * (1.02 - 0.05 * hold));
    R.cam.lookAt(W / 2 + 40 * hold, H / 2 - 10 * hold, 0);
    R.cam.updateMatrixWorld();

    // ---- 圖層
    if (!this.motif) this.drawRibbonLyric(t);
    if (!this.msg) this.drawTag(t);
    R.mat.uniforms.txt!.value = this.txt.texture;
    R.mat.uniforms.txtOn!.value = 1;
    R.bowMat.uniforms.txtOn!.value = 0;
    R.knotMat.uniforms.txtOn!.value = 0;
    R.tagMat.uniforms.tex!.value = this.tagL.texture;
    for (const mt of [R.mat, R.bowMat, R.knotMat, R.tagMat, R.curlMat]) (mt.uniforms.camPos!.value as THREE.Vector3).copy(R.cam.position);

    // ---- 背景（吊牌的影子）→ 3D（MSAA）→ 疊到 out
    const tp = this.project(hang.x, hang.y, hang.z);
    (this.bg.u.tagR!.value as THREE.Vector4).set(tp.x + 40, tp.y + TAG.h / 2 - TAG.hy + 50, TAG.w / 2 - 20, TAG.h / 2 - 20);
    this.bg.u.tagK!.value = R.tagPivot.visible ? clamp(1 - Math.abs(1 - drop) * 3) : 0;
    this.bg.render(renderer, this.rt);
    renderer.setRenderTarget(this.rt);
    renderer.clearDepth();
    renderer.render(R.scene, R.cam);
    comp.draw(renderer, this.rt.texture, out, { mode: 'replace', premult: false });

    // 吊牌的繩子（結 → 繩孔）：細細的紙白線
    this.glow.clear();
    if (R.tagPivot.visible) {
      const k0 = this.project(KNOT.x, H - KNOT.y - 20, 40);
      const hole = new THREE.Vector3(TAG.hx - TAG.w / 2, TAG.h / 2 - TAG.hy, 1).applyMatrix4(R.tag.matrixWorld);
      const k1 = this.project(hole.x, hole.y, hole.z);
      const bone = LIN.bone;
      this.glow.seg2(k0.x, k0.y, k1.x, k1.y, 2.4, [bone[0] * 0.7, bone[1] * 0.66, bone[2] * 0.6], 0.95);
      this.glow.render(renderer, out);
    }
    return { bloom: 0.6, bloomRadius: 0.7, halation: 0.2, vignette: 0.5, grain: 0.05, popupAvoid: this.avoid };
  }

  /** 世界座標 → 螢幕 px（y 向下）。 */
  private project(x: number, y: number, z: number) {
    const v = this.tmp.set(x, y, z).project(this.rig.cam);
    return { x: (v.x * 0.5 + 0.5) * W, y: (0.5 - v.y * 0.5) * H };
  }
}

/** 0..1：x 在 [a, b] 裡面是 1，往外 w 的距離內淡出。 */
function smoothBand(x: number, a: number, b: number, w: number) {
  return smoothstep(a - w, a, x) * (1 - smoothstep(b, b + w, x));
}
