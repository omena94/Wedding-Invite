// 撲克牌（暗）：一張深色毛氈的牌桌，一盞燈從上面打下來。
//  - 第一拍：一疊牌被手從左往右一抹，展開成畫面上方的一道弧（ribbon spread，一張壓一張、兩端往遠處彎）。
//  - 接著一拍一張（窗格短就半拍）：紅心 K、紅心 Q 從弧裡滑出來、在半空翻面，落到左下角；最後抽出一張魔術師的大白卡，
//    橫著落在兩張中間——主打留言手寫在這張大白卡上（v2：留言 40～60 px、卡在畫面上 ≤ 860×430），署名在最後一行下面。
//    牌都是自己設計的（不畫人）：K、Q 是大大的字母、一顆愛心、一頂線畫的皇冠／后冠；弧裡的牌是紅心 A～4。
//  - 抽完的下一拍 K、Q 往中間靠一點（輕輕碰到大白卡），像兩個人把大家的祝福夾在中間。
//  - 之後每個小節線，整道弧像骨牌一樣一張接一張翻過去（翻牌的花式），下一個小節再翻回來——窗格長的時候中段一直有事。
//  - 歌詞印在毛氈上：大白卡上方一道弧線（像牌桌上印的字），唱到的字亮成訊號色（逐字跟唱），比留言小。
//  - 鏡頭：切進來時從弧展開的那一端低低地看過來；抽牌的時候升起來、轉正，之後很慢地推近。右下角 QR 那一塊只有毛氈。
//  - 沒有留言：大白卡寫「宣文 & 孟庭」（配角），弧線上的歌詞是主角，底下一行邀請。純音樂：弧線上印歌名。
// 手法：牌是 three.js 的四邊形（InstancedMesh，正面、背面各自取圖集，圓角在 shader 裡挖），翻面是真的 3D 轉動；
// 影子是同一張牌沿光線投到桌面、依高度模糊；弧線上的字先畫成一條直的 Canvas，再在毛氈的 shader 裡用極座標彎成弧。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { GLSL_COMMON, THEME_UNIFORMS } from '../engine/glsl/common';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, pulse, hash, frameIdx } from '../engine/util';
import { fitText } from '../engine/text';
import { lyricAt, layoutLyric, drawLyric, beatAfter, drawHeart, fillWithHearts, COUPLE_ZH, lyricSubOf } from './_motifs';
import { msgMaxFor, lyricV2, sigV2, fitClauses } from './_v2';
import { darkInk } from './_t4';
import { sigOf, applyOrbit, lerpOrbit, toScreen, T17_INVITE, T17_TEXT, type OrbitCam, type V3 } from './_t17';

export const spec: PlateSpecDecl = { group: 'type', family: 'game', paper: false, energy: [0.25, 0.9], bars: [4, 8], weight: 1 };

/** 牌的大小（世界單位）與圖集。 */
const CW = 300, CH = 420, RES = 1.5;
const NCELL = 8; // 0 = 背面、1 = K、2 = Q、3 = 大白卡、4..7 = 紅心 A～4
const MAXI = 32;
const FAM_MSG = F.hand(700);
const FAM_LYR = F.archivo(100, 800);
const LIGHT: V3 = [-0.35, 0.55, 1];
/** 弧線文字的畫布大小（世界單位 ≈ 螢幕像素）。 */
const LW = 1700, LH = 150;
/** 有韓文原文時，中文＋原文擠在展開的牌與 K、Q 之間：中文最上緣、原文最下緣在字帶上的範圍（再下去是 K、Q 的上緣）。 */
const SUB_TOP = 4, SUB_BOT = 110;

const PRE = /* glsl */ `precision highp float;\nprecision highp int;\n`;
const VERT = /* glsl */ `${PRE}
in vec3 position; in vec2 uv; in mat4 instanceMatrix; in vec4 iA;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix; uniform vec3 uLight; uniform float shadowPass;
out vec2 vUv; out vec4 vA; out vec3 vN; out vec3 vW;
void main() {
  vUv = uv; vA = iA;
  mat4 m = modelMatrix * instanceMatrix;
  vec4 w = m * vec4(position, 1.0);
  vN = normalize(mat3(m) * vec3(0.0, 0.0, 1.0));
  if (shadowPass > 0.5) { w.xy -= uLight.xy * (w.z / uLight.z); w.z = 0.3; }
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const CARD_SD = /* glsl */ `
float cardSD(vec2 uv) {
  vec2 p = (uv - 0.5) * vec2(${CW}.0, ${CH}.0);
  vec2 q = abs(p) - vec2(${CW / 2}.0, ${CH / 2}.0) + 18.0;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 18.0;
}`;

// iA = (正面的格子, 高度, 可見, -)
const FRAG = /* glsl */ `${PRE}
in vec2 vUv; in vec4 vA; in vec3 vN; in vec3 vW;
out vec4 fragColor;
${GLSL_COMMON}
${CARD_SD}
uniform sampler2D atlas; uniform vec3 cameraPosition; uniform vec3 uLight;
void main() {
  float d = cardSD(vUv);
  float aa = fwidth(d);
  float a = (1.0 - smoothstep(-aa, aa, d)) * vA.z;
  if (a <= 0.001) discard;
  // 正面朝上（法向量朝鏡頭）用正面的格子，背面用第 0 格；背面的 u 反過來（從背後看是鏡像）
  bool front = gl_FrontFacing;
  float cell = front ? vA.x : 0.0;
  vec2 uv = vec2(front ? vUv.x : 1.0 - vUv.x, vUv.y);
  vec2 auv = vec2((cell + uv.x) / ${NCELL}.0, uv.y);
  // 在一致的控制流程裡算 mip 層，再用 textureLod（有 mipmap）
  vec2 tp = auv * vec2(${NCELL * CW * RES}.0, ${CH * RES}.0);
  float lod = log2(max(max(length(dFdx(tp)), length(dFdy(tp))), 1e-4));
  vec3 col = textureLod(atlas, auv, max(lod, 0.0)).rgb;
  // 紙的光澤：燈在上面，斜的時候一道很淡的反光；牌的邊緣一條細細的暗線
  vec3 N = normalize(vN) * (front ? 1.0 : -1.0);
  vec3 V = normalize(cameraPosition - vW);
  vec3 Hh = normalize(normalize(uLight) + V);
  col *= 0.72 + 0.32 * max(dot(N, normalize(uLight)), 0.0);
  col += C_BONE * 0.05 * pow(max(dot(N, Hh), 0.0), 30.0);
  col *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 2.2, -d));
  fragColor = vec4(col * a, a);
}`;

const SH_FRAG = /* glsl */ `${PRE}
in vec2 vUv; in vec4 vA; in vec3 vN; in vec3 vW;
out vec4 fragColor;
${GLSL_COMMON}
${CARD_SD}
void main() {
  float h = vA.y;
  float b = 3.0 + h / 12.0;
  float d = cardSD(vUv);
  float a = (1.0 - smoothstep(-b, b, d)) * mix(0.55, 0.15, clamp(h / 400.0, 0.0, 1.0)) * vA.z;
  fragColor = vec4(0.0, 0.0, 0.0, a);
}`;

const FELT_FRAG = /* glsl */ `${PRE}
in vec3 vW;
out vec4 fragColor;
${GLSL_COMMON}
uniform sampler2D lyr; uniform vec4 arc; uniform vec4 lamp;
vec4 lyrAt(vec2 p) {
  // 極座標：弧的圓心 arc.xy、基線半徑 arc.z；θ = 0 在弧的最低點（靠近鏡頭），往右變大
  vec2 v = p - arc.xy;
  float r = length(v);
  float th = atan(v.x, -v.y);
  float x = ${LW / 2}.0 + th * arc.z;
  float y = ${LH * 0.7}.0 + (r - arc.z);
  vec2 uv = vec2(x / ${LW}.0, 1.0 - y / ${LH}.0);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  vec4 c = textureLod(lyr, uv, 0.0);
  c.rgb = c.a > 0.0 ? toLinear(c.rgb / c.a) * c.a : vec3(0.0);
  return c;
}
void main() {
  vec2 p = vW.xy;
  // 毛氈：深色、帶一點主題的暗部色，細細的纖維
  float fib = hash12(floor(p * 1.1)) - 0.5;
  vec3 col = mix(C_INK2, C_BLOOD, 0.14) * (0.62 + 0.16 * fbm(p / 380.0, 3) + 0.04 * fib);
  // 印在毛氈上的兩道細弧線（歌詞在中間）
  float r = length(p - arc.xy);
  float lines = (1.0 - smoothstep(0.6, 1.6, abs(r - (arc.z + 58.0)))) + (1.0 - smoothstep(0.6, 1.6, abs(r - (arc.z - ${LH * 0.7 + 10}.0))));
  float span = step(abs(atan(p.x - arc.x, -(p.y - arc.y))) * arc.z, ${LW / 2 - 20}.0);
  col += mix(C_BLOOD, C_SIGNAL, 0.4) * 0.22 * lines * span;
  vec4 L = lyrAt(p);
  col = col * (1.0 - L.a) + L.rgb;
  // 燈
  float lr = length(p - lamp.xy) / lamp.z;
  col *= 0.3 + 0.8 * exp(-lr * lr);
  fragColor = vec4(col, 1.0);
}`;

class Rig {
  geo = new THREE.PlaneGeometry(1, 1);
  iA = new THREE.InstancedBufferAttribute(new Float32Array(MAXI * 4), 4);
  cardMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { ...THEME_UNIFORMS, atlas: { value: null }, uLight: { value: new THREE.Vector3(...LIGHT) }, shadowPass: { value: 0 } },
    transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  shMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: SH_FRAG,
    uniforms: { ...THEME_UNIFORMS, uLight: { value: new THREE.Vector3(...LIGHT) }, shadowPass: { value: 1 } },
    transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  feltMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: `${PRE}in vec3 position; uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix; out vec3 vW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: FELT_FRAG,
    uniforms: { ...THEME_UNIFORMS, lyr: { value: null }, arc: { value: new THREE.Vector4() }, lamp: { value: new THREE.Vector4(0, 0, 1500, 0) } },
    depthTest: false, depthWrite: false,
  });
  cards: THREE.InstancedMesh;
  shadows: THREE.InstancedMesh;
  felt = new THREE.Mesh(new THREE.PlaneGeometry(16000, 12000), this.feltMat);
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(30, W / H, 10, 40000);
  constructor() {
    this.geo.setAttribute('iA', this.iA);
    this.cards = new THREE.InstancedMesh(this.geo, this.cardMat, MAXI);
    this.shadows = new THREE.InstancedMesh(this.geo, this.shMat, MAXI);
    this.shadows.instanceMatrix = this.cards.instanceMatrix;
    for (const m of [this.cards, this.shadows, this.felt]) { m.frustumCulled = false; this.scene.add(m); }
    this.felt.renderOrder = 0; this.shadows.renderOrder = 1; this.cards.renderOrder = 2;
    this.cards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
}

/** 展開成一道弧（ribbon spread）的牌：位置、轉角、正面的格子。 */
interface Slot { x: number; y: number; rz: number; face: number }
/** 從展開的牌裡抽出來的牌：哪一個位置、正面的格子、落點、轉角、大小、落下的時間、飛行時間、往中間靠的方向。 */
interface Deal { slot: number; cell: number; x: number; y: number; rot: number; sc: number; tl: number; fd: number; nudge: number }

/** 展開的牌數、大白卡的放大倍數（魔術師的大張牌）、左下角那一組（K、大白卡、Q）的中心、歌詞弧線最低點、展開的弧線。 */
const NS = 28;
const MSC = 1.4;
const GROUP = { x: -300, y: -330 };
const LYR_Y = -40;
const SP_Y = 330;
/** 翻牌浪潮裡一張牌翻過去要多久。 */
const FL = 0.26;

export default class Cards extends Scene {
  rig = shared('cards.rig', () => new Rig());
  lyrL = this.track(new Layer2D(LW, LH, 1.4, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  /** 這一格有沒有韓文原文副行（建構時就看：引擎只在建立這一格之前設好開關）。 */
  hasSub = this.ctx.lyrics.linesIn(this.ctx.start - 1, this.ctx.end + 1).some((l) => !!lyricSubOf(l));
  seed = Number(this.ctx.params.seed ?? 1) * 7 + (this.msg?.id ?? 0);
  atlasCv: HTMLCanvasElement | null = null;
  atlasTex: THREE.CanvasTexture | null = null;
  slots: Slot[] = [];
  deals: Deal[] = [];
  /** 翻牌浪潮開始的時間（小節線）、浪潮裡相鄰兩張牌的時間差。 */
  waves: number[] = [];
  waveDt = 0.03;
  sig = '';
  t1 = 0; tDone = 0; tNudge = 0; B = 0.5; sweep = 0.4;
  arc: [number, number, number] = [0, 0, 0];
  lyrSize = 52;
  camA!: OrbitCam; camB!: OrbitCam;
  m4 = new THREE.Matrix4(); q = new THREE.Quaternion(); e = new THREE.Euler(); v = new THREE.Vector3(); s3 = new THREE.Vector3();

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.sig = sigOf(m);
    const text = m ? m.text : COUPLE_ZH;
    await loadText(`${text}${this.sig}${T17_TEXT}${T17_INVITE}${song.title}${song.artist}KQA234♪${lyrics.linesIn(s - 2, e + 1).map((l) => l.text).join('')}`);
    const B = (this.B = au.beatPeriod(s + 0.1));

    // ---- 展開的牌：畫面上方一道弧（兩端往遠處彎），一張壓一張
    for (let i = 0; i < NS; i++) {
      const x = -880 + (i * 1760) / (NS - 1);
      this.slots.push({ x, y: SP_Y + 0.00011 * x * x, rz: Math.atan(0.00022 * x), face: 4 + (i % 4) });
    }
    // ---- 時間：第一拍把牌展開（手從左往右一抹，0.7 拍）；接著一拍一張：K、Q 從牌裡抽出來，最後抽出大白卡
    this.t1 = beatAfter(au, s + Math.min(0.3, B * 0.6));
    const step = e - this.t1 > 8 * B * 1.3 ? B : B / 2;
    this.sweep = 0.7 * step;
    const fd = clamp(step * 0.9, 0.3, 0.5);
    const iK = Math.round(NS * 0.28), iQ = Math.round(NS * 0.72), iM = Math.floor(NS / 2);
    const rnd = (k: number) => hash(this.seed, k) - 0.5;
    const gw = CH * MSC / 2;
    this.deals.push({ slot: iK, cell: 1, x: GROUP.x - gw - 105, y: GROUP.y + 30, rot: 0.16 + rnd(1) * 0.04, sc: 1, tl: this.t1 + 2 * step, fd, nudge: 1 });
    this.deals.push({ slot: iQ, cell: 2, x: GROUP.x + gw + 105, y: GROUP.y + 30, rot: -0.16 + rnd(2) * 0.04, sc: 1, tl: this.t1 + 3 * step, fd, nudge: -1 });
    this.deals.push({ slot: iM, cell: 3, x: GROUP.x, y: GROUP.y, rot: Math.PI / 2 + rnd(3) * 0.03, sc: MSC, tl: this.t1 + 4 * step, fd, nudge: 0 });
    this.tDone = this.t1 + 4 * step;
    this.tNudge = au.timeOfBeat(Math.ceil(au.beatAt(this.tDone + 0.1) - 1e-6));
    // 翻牌浪潮：之後每個小節線一次（整排牌像骨牌一樣翻過去，下一次再翻回來）
    this.waveDt = Math.min(0.035, (0.55 * B) / NS);
    for (let k = Math.ceil(au.barAt(this.tNudge + B * 0.5) - 1e-6); this.waves.length < 16; k++) {
      const tb = au.timeOfBar(k);
      if (tb + NS * this.waveDt + FL > e - 0.1) break;
      this.waves.push(tb);
    }

    // ---- 鏡頭：斜上方；左下角那一組（K、大白卡、Q）要在安全範圍裡、不進右下角 QR 區，
    // 大白卡在畫面上不超過 860×430（v2 的留言區），展開的牌在上方、看得到
    const cam = this.rig.cam;
    const groupPts: V3[] = [];
    for (const [x, y] of [[GROUP.x - gw - 105 - CW * 0.62, GROUP.y - CH * 0.55], [GROUP.x + gw + 105 + CW * 0.62, GROUP.y - CH * 0.55], [GROUP.x - gw - 105 - CW * 0.62, GROUP.y + CH * 0.62], [GROUP.x + gw + 105 + CW * 0.62, GROUP.y + CH * 0.62]]) groupPts.push([x!, y!, 0]);
    const pxAt = (x: number, y: number) => { const a = toScreen(cam, [x - 100, y, 0]), b = toScreen(cam, [x + 100, y, 0]); return Math.hypot(b.x - a.x, b.y - a.y) / 200; };
    const ok = (o: OrbitCam) => {
      applyOrbit(cam, o);
      const g = groupPts.map((p) => toScreen(cam, p));
      if (!g.every((p) => p.x > 110 && p.x < W - 110 && p.y > 96 && p.y < 990)) return false;
      if (g.some((p) => p.x > 1330 && p.y > 800)) return false;
      const lyr = [toScreen(cam, [-520, LYR_Y, 0]), toScreen(cam, [520, LYR_Y + 70, 0])];
      if (!lyr.every((p) => p.x > 100 && p.x < W - 100 && p.y > 96 && p.y < 800)) return false;
      const sp = toScreen(cam, [0, SP_Y + 210, 0]);
      return sp.y > 70 && pxAt(GROUP.x, GROUP.y) <= 1.0;
    };
    let best: OrbitCam | null = null, bestPx = 0;
    for (const tx of [-200, -120, -40, 40]) for (const ty of [-160, -100, -40, 20]) {
      const o0: OrbitCam = { tx, ty, tz: 0, dist: 1800, az: 0, el: 0.9, fov: 30 };
      let lo = 800, hi = 7000;
      if (!ok({ ...o0, dist: hi })) continue;
      for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (ok({ ...o0, dist: mid })) hi = mid; else lo = mid; }
      const o = { ...o0, dist: hi };
      applyOrbit(cam, o);
      const px = pxAt(GROUP.x, GROUP.y);
      if (px > bestPx) { bestPx = px; best = o; }
    }
    this.camB = best ?? { tx: -80, ty: -60, tz: 0, dist: 2600, az: 0, el: 0.9, fov: 30 };
    applyOrbit(cam, this.camB);
    const pxMsg = pxAt(GROUP.x, GROUP.y), pxLyr = pxAt(0, LYR_Y);
    // 進場：從牌展開的那一端（左上）看過來，低一點；牌抽出來的時候鏡頭升起來、轉正
    this.camA = { ...this.camB, tx: this.camB.tx - 260, ty: this.camB.ty + 260, dist: this.camB.dist * 0.72, el: 0.62, az: -0.18, roll: -0.02 };

    // ---- 圖集：背面、K、Q、大白卡（橫放，字在圖集裡轉 90° 畫）、紅心 A～4
    const cv = (this.atlasCv = document.createElement('canvas'));
    cv.width = Math.round(NCELL * CW * RES); cv.height = Math.round(CH * RES);
    const c = cv.getContext('2d')!;
    c.scale(RES, RES);
    this.drawBack(c, 0);
    this.drawCourt(c, CW, 'K');
    this.drawCourt(c, CW * 2, 'Q');
    ['A', '2', '3', '4'].forEach((r, i) => this.drawPip(c, CW * (4 + i), r, i + 1));
    // 大白卡：圖集一格的單位 × MSC × pxMsg = 螢幕 px，字級（v2 的螢幕 px）要除回去
    const k = MSC * pxMsg;
    const x0 = CW * 3;
    this.drawBlank(c, x0);
    // 字區只比字多一點邊距（上下 20、左右 28，四個角的小愛心在字區外面）：
    // 44 字左右的長留言照子句排要六行，框再小一點就只能照寬度硬切，會斷出「這麼美／好的一天」
    const inner = { w: CH - 56, h: CW - 40 };
    let msgPx = 0;
    c.save();
    c.translate(x0 + CW, 0); c.rotate(Math.PI / 2);
    if (m) {
      const o = { min: Math.ceil(40 / k), max: Math.floor(msgMaxFor(m.text) / k), lineHeight: 1.22, maxLines: 7 };
      const sg0 = sigV2(o.max * k) / k;
      const fit = fitClauses(c, m.text, FAM_MSG, inner.w, inner.h - sg0 * 1.8, o) ?? fitText(c, m.text, FAM_MSG, inner.w, inner.h - sg0 * 1.8, o);
      msgPx = fit.size * k;
      const sg = sigV2(msgPx) / k;
      const total = fit.height + sg * 1.8;
      const y0 = 20 + (inner.h - total) / 2 + fit.size * 0.86;
      c.font = font(FAM_MSG, fit.size);
      c.fillStyle = rgba('sepia', 0.95);
      fit.lines.forEach((ln, i) => { const w = c.measureText(ln).width; fillWithHearts(c, ln, CH / 2 - w / 2, y0 + i * fit.lineHeight); });
      c.font = font(FAM_MSG, sg);
      c.fillStyle = mixRgba('blood', 'sepia', 0.3);
      c.textAlign = 'right';
      c.fillText(this.sig, CH / 2 + Math.max(fit.width, 200) / 2, y0 + (fit.lines.length - 1) * fit.lineHeight + sg * 1.75, CH - 60);
      c.textAlign = 'left';
    } else {
      // 沒有留言：大白卡寫新人的名字（配角，不大），歌詞是主角
      c.font = font(FAM_MSG, 44 / k);
      c.fillStyle = rgba('sepia', 0.9);
      c.textAlign = 'center';
      c.fillText(COUPLE_ZH, CH / 2, CW / 2 + 6);
      drawHeart(c, CH / 2, CW / 2 + 44, 24, rgba('rose'));
      c.textAlign = 'left';
    }
    c.restore();
    const tx = (this.atlasTex = new THREE.CanvasTexture(cv));
    tx.colorSpace = THREE.SRGBColorSpace;
    tx.generateMipmaps = true;
    tx.minFilter = THREE.LinearMipmapLinearFilter;
    tx.anisotropy = 4;
    tx.needsUpdate = true;
    // 歌詞（印在毛氈的弧線上）：v2 的字級換成毛氈上的單位
    this.lyrSize = Math.round(lyricV2(m ? msgPx : null) / pxLyr);
    const R = 2600;
    this.arc = [0, LYR_Y + R, R];
  }

  /** 牌背：深紅（訊號色的暗部）的底、細細的菱格紋、白邊。自己設計的，不像任何牌子。 */
  private drawBack(c: CanvasRenderingContext2D, x0: number) {
    c.save();
    c.fillStyle = mixRgba('bone', 'paper', 0.3); c.fillRect(x0, 0, CW, CH);
    c.fillStyle = mixRgba('blood', 'ink', 0.25); c.fillRect(x0 + 18, 18, CW - 36, CH - 36);
    c.beginPath(); c.rect(x0 + 18, 18, CW - 36, CH - 36); c.clip();
    c.strokeStyle = mixRgba('signal', 'blood', 0.35, 0.5); c.lineWidth = 1.2;
    for (let k = -CH; k < CW + CH; k += 14) {
      c.beginPath(); c.moveTo(x0 + k, 0); c.lineTo(x0 + k + CH, CH); c.stroke();
      c.beginPath(); c.moveTo(x0 + k + CH, 0); c.lineTo(x0 + k, CH); c.stroke();
    }
    c.strokeStyle = mixRgba('signal', 'bone', 0.3, 0.7); c.lineWidth = 2;
    c.strokeRect(x0 + 30, 30, CW - 60, CH - 60);
    drawHeart(c, x0 + CW / 2, CH / 2, 60, mixRgba('rose', 'blood', 0.2));
    c.restore();
  }

  /** 白牌：奶油色、細細的雙線框、四個角一顆小愛心。 */
  private drawBlank(c: CanvasRenderingContext2D, x0: number) {
    c.save();
    c.fillStyle = mixRgba('bone', 'paper', 0.25); c.fillRect(x0, 0, CW, CH);
    c.strokeStyle = rgba('signal', 0.5); c.lineWidth = 1.5; c.strokeRect(x0 + 12, 12, CW - 24, CH - 24);
    c.strokeStyle = rgba('signal', 0.25); c.lineWidth = 1; c.strokeRect(x0 + 17, 17, CW - 34, CH - 34);
    for (const [hx, hy] of [[26, 28], [CW - 26, 28], [26, CH - 26], [CW - 26, CH - 26]] as const) drawHeart(c, x0 + hx, hy, 11, rgba('rose', 0.85));
    c.restore();
  }

  /** 紅心 A～4：角落的點數＋小愛心，中間 n 顆愛心（照撲克牌的排法，但是我們自己的愛心）。 */
  private drawPip(c: CanvasRenderingContext2D, x0: number, rank: string, n: number) {
    c.save();
    c.fillStyle = mixRgba('bone', 'paper', 0.25); c.fillRect(x0, 0, CW, CH);
    c.strokeStyle = rgba('rose', 0.4); c.lineWidth = 1.2; c.strokeRect(x0 + 14, 14, CW - 28, CH - 28);
    const red = mixRgba('rose', 'blood', 0.25);
    for (const flip of [false, true]) {
      c.save();
      if (flip) { c.translate(x0 + CW, CH); c.rotate(Math.PI); } else c.translate(x0, 0);
      c.fillStyle = red; c.font = font(F.serif(600), 50); c.textAlign = 'center';
      c.fillText(rank, 40, 62);
      drawHeart(c, 40, 86, 22, red);
      c.restore();
    }
    const pos: [number, number][] = n === 1 ? [[0.5, 0.5]] : n === 2 ? [[0.5, 0.27], [0.5, 0.73]] : n === 3 ? [[0.5, 0.25], [0.5, 0.5], [0.5, 0.75]] : [[0.33, 0.27], [0.67, 0.27], [0.33, 0.73], [0.67, 0.73]];
    for (const [px, py] of pos) drawHeart(c, x0 + CW * px, CH * py, n === 1 ? 130 : 60, rgba('rose'));
    c.restore();
  }

  /** K、Q：角落的字母＋小愛心，中間一顆大愛心，上面線畫的皇冠／后冠（不畫人）。 */
  private drawCourt(c: CanvasRenderingContext2D, x0: number, L: 'K' | 'Q') {
    c.save();
    c.fillStyle = mixRgba('bone', 'paper', 0.25); c.fillRect(x0, 0, CW, CH);
    c.strokeStyle = rgba('rose', 0.5); c.lineWidth = 1.5; c.strokeRect(x0 + 16, 16, CW - 32, CH - 32);
    const red = mixRgba('rose', 'blood', 0.25);
    const corner = (flip: boolean) => {
      c.save();
      if (flip) { c.translate(x0 + CW, CH); c.rotate(Math.PI); } else c.translate(x0, 0);
      c.fillStyle = red; c.font = font(F.serif(600), 58); c.textAlign = 'center';
      c.fillText(L, 44, 70);
      drawHeart(c, 44, 96, 26, red);
      c.restore();
    };
    corner(false); corner(true);
    drawHeart(c, x0 + CW / 2, CH / 2 + 30, 150, rgba('rose'));
    // 冠：線畫（訊號色）
    c.strokeStyle = mixRgba('signal', 'blood', 0.2); c.lineWidth = 3; c.lineJoin = 'round';
    const cx = x0 + CW / 2, cy = CH / 2 - 76;
    c.beginPath();
    if (L === 'K') {
      c.moveTo(cx - 52, cy + 26); c.lineTo(cx - 58, cy - 18); c.lineTo(cx - 28, cy + 6); c.lineTo(cx, cy - 30); c.lineTo(cx + 28, cy + 6); c.lineTo(cx + 58, cy - 18); c.lineTo(cx + 52, cy + 26); c.closePath();
      c.moveTo(cx, cy - 30); c.lineTo(cx, cy - 48); c.moveTo(cx - 9, cy - 40); c.lineTo(cx + 9, cy - 40);
    } else {
      c.moveTo(cx - 50, cy + 24); c.quadraticCurveTo(cx - 60, cy - 6, cx - 44, cy - 14); c.quadraticCurveTo(cx - 20, cy + 6, cx, cy - 22);
      c.quadraticCurveTo(cx + 20, cy + 6, cx + 44, cy - 14); c.quadraticCurveTo(cx + 60, cy - 6, cx + 50, cy + 24); c.closePath();
    }
    c.stroke();
    c.fillStyle = mixRgba('signal', 'blood', 0.2);
    for (const dx of L === 'K' ? [-58, 58] : [-44, 0, 44]) { c.beginPath(); c.arc(cx + dx, cy - (L === 'K' ? 18 : dx === 0 ? 22 : 14) - 6, 5, 0, Math.PI * 2); c.fill(); }
    c.restore();
  }

  override dispose() {
    this.atlasTex?.dispose();
    if (this.atlasCv) this.atlasCv.width = this.atlasCv.height = 0;
    super.dispose();
  }

  /** 展開到哪一張了（小數）：第一拍開始，手從左往右抹過去。 */
  private sweepAt(t: number) { return (NS - 1) * ease.inOutQuad(prog(t, this.t1, this.t1 + this.sweep)); }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const rig = this.rig;
    const A = rig.iA.array as Float32Array;
    type St = { x: number; y: number; z: number; rz: number; ry: number; cell: number; sc: number };
    const st: St[] = [];
    const fs = this.sweepAt(t);
    const head = (() => { const i = Math.floor(fs), k = fs - i, a = this.slots[i]!, b = this.slots[Math.min(i + 1, NS - 1)]!; return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, rz: a.rz + (b.rz - a.rz) * k }; })();
    // ---- 展開的牌：抹到的留在位置上，還沒抹到的跟著手（一小疊）；每個小節一道翻牌的浪
    for (let i = 0; i < NS; i++) {
      const d = this.deals.find((x) => x.slot === i);
      if (d && t >= d.tl - d.fd) continue;
      const sl = this.slots[i]!;
      const laid = i <= fs;
      const x = laid ? sl.x : head.x + (i - fs) * 0.6, y = laid ? sl.y : head.y - (i - fs) * 0.5;
      const zb = 1 + (laid ? i * 0.5 : NS * 0.5 + (i - fs) * 1.2);
      let n = 0, u = 0;
      for (const tw of this.waves) {
        const a = tw + i * this.waveDt;
        if (t >= a + FL) n++;
        else if (t > a) u = (t - a) / FL;
      }
      const ph = n + ease.inOutCubic(u);
      st.push({ x, y, z: zb + Math.sin(Math.PI * u) * CW * 0.42, rz: laid ? sl.rz : head.rz, ry: Math.PI * (1 + ph), cell: sl.face, sc: 1 });
    }
    // ---- 抽出來的牌：從它在弧上的位置滑出來、在半空翻面、落到左下角那一組；發完的下一拍 K、Q 往中間靠一點
    const nudge = ease.outBack(clamp((t - this.tNudge) / 0.3), 2);
    for (const d of this.deals) {
      const u = clamp((t - (d.tl - d.fd)) / d.fd);
      if (u <= 0) continue;
      const sl = this.slots[d.slot]!;
      const k = ease.outCubic(u);
      const x = sl.x + (d.x + d.nudge * 24 * nudge - sl.x) * k;
      const y = sl.y + (d.y - sl.y) * k;
      const z = Math.sin(Math.PI * u) * 180 + 20 + (d.cell === 3 ? 4 : 0);
      const ry = Math.PI * (1 - ease.inOutCubic(clamp(u * 1.15)));
      const rz = sl.rz + (d.rot - sl.rz) * k + Math.sin(Math.PI * u) * 0.25;
      st.push({ x, y, z, rz, ry, cell: d.cell, sc: 1 + (d.sc - 1) * ease.inOutCubic(u) });
    }
    // 高的畫在後面（蓋在低的上面）
    st.sort((a, b) => a.z - b.z);
    st.forEach((p, i) => {
      this.e.set(0, p.ry, p.rz, 'ZYX');
      this.q.setFromEuler(this.e);
      this.m4.compose(this.v.set(p.x, p.y, p.z + 0.5), this.q, this.s3.set(CW * p.sc, CH * p.sc, 1));
      rig.cards.setMatrixAt(i, this.m4);
      A[i * 4] = p.cell; A[i * 4 + 1] = p.z; A[i * 4 + 2] = 1; A[i * 4 + 3] = 0;
    });
    rig.cards.count = rig.shadows.count = st.length;
    rig.cards.instanceMatrix.needsUpdate = true;
    rig.iA.needsUpdate = true;

    // ---- 鏡頭：從展開的那一端低低地看過來 → 抽牌的時候升起來、轉正 → 斜上方很慢地推近
    const kc = ease.inOutCubic(prog(t, s, Math.max(this.t1 + 2 * this.B, this.tDone)));
    const cam = lerpOrbit(this.camA, this.camB, kc);
    cam.dist *= 1 - 0.03 * ease.inOutQuad(prog(t, this.tDone, e));
    applyOrbit(rig.cam, cam);

    // ---- 弧線上的歌詞（直的畫布，shader 彎成弧）
    this.drawArc(t);
    const fu = rig.feltMat.uniforms;
    fu.lyr!.value = this.lyrL.upload();
    (fu.arc!.value as THREE.Vector4).set(this.arc[0], this.arc[1], this.arc[2], 0);
    (fu.lamp!.value as THREE.Vector4).set(-120, 0, 1700, 0);
    rig.cardMat.uniforms.atlas!.value = this.atlasTex;
    renderer.setRenderTarget(out);
    renderer.render(rig.scene, rig.cam);

    let amp = 0;
    for (const d of this.deals) amp += 2 * pulse(t, d.tl, 0.05);
    amp += 3 * pulse(t, this.tNudge + 0.08, 0.06);
    for (const tw of this.waves) amp += 1.2 * pulse(t, tw + NS * this.waveDt + FL * 0.5, 0.06);
    const ph = frameIdx(t);
    return { bloom: 0.55, bloomThreshold: 1.1, halation: 0.1, vignette: 0.45, grain: 0.06, shake: [amp * (hash(ph, 1) - 0.5) * 2, amp * (hash(ph, 2) - 0.5) * 2] };
  }

  /** 弧線的畫布：歌詞置中逐字跟唱；沒有留言時底下加一行邀請；純音樂印歌名。 */
  private drawArc(t: number) {
    const L = this.lyrL;
    L.clear();
    const c = L.ctx;
    const { lyrics, song } = this.ctx;
    const base = LH * 0.7;
    if (!lyrics.has) {
      c.fillStyle = rgba('ash', 0.85);
      c.font = font(F.mono(500), 30);
      c.letterSpacing = '8px';
      c.textAlign = 'center';
      c.fillText(`♪ ${song.title}`.toUpperCase(), LW / 2, base);
      c.textAlign = 'left';
      c.letterSpacing = '0px';
    } else {
      const ly = lyricAt(lyrics, t);
      if (ly) {
        const ink = darkInk();
        let st = { family: FAM_LYR, size: this.lyrSize, minSize: Math.min(this.lyrSize, 40), maxWidth: LW - 200, align: 'center' as const, active: ink.active, sung: ink.sung, unsung: ink.unsung, lineHeight: 1.05 };
        let lay = layoutLyric(c, ly.line, st);
        // 折成兩行時往上長（基線固定在弧上）
        let y0 = base - (lay.rows.length - 1) * lay.size * 1.05;
        if (lay.sub) {
          // 韓文原文副行：展開的牌與 K、Q 之間只有一條窄窄的毛氈——原文貼著 K、Q 的上緣、中文往上讓（這一格不放邀請）；
          // 中文折兩行放不下時整組縮小（最小 36）
          for (let s = st.size; ; s -= 2) {
            const s2 = { ...st, size: s, minSize: Math.min(s, st.minSize) };
            const l2 = layoutLyric(c, ly.line, s2);
            const y = SUB_BOT - l2.sub!.lay.size * 0.22 - (l2.height - l2.size);
            st = s2; lay = l2; y0 = y;
            if (y - l2.size * 0.9 >= SUB_TOP || s <= 36) break;
          }
        }
        c.save();
        c.translate(LW / 2, y0);
        drawLyric(c, ly.line, t, st, lay, ly.k);
        c.restore();
      }
    }
    // 有韓文原文的窗格不放邀請：那條毛氈放不下三行字（右下角本來就有 QR）
    if (!this.msg && !this.hasSub) {
      c.fillStyle = rgba('ash', 0.6);
      c.font = font(F.hei(500), 20);
      c.letterSpacing = '3px';
      c.textAlign = 'center';
      // 邀請在歌詞上面（下面會被 Q 的牌角蓋到）
      c.fillText(T17_INVITE, LW / 2, Math.max(22, base - this.lyrSize * 1.15));
      c.textAlign = 'left';
      c.letterSpacing = '0px';
    }
  }
}
