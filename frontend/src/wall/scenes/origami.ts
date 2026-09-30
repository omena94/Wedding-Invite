// 摺紙鶴（亮）：裁切墊上一隻訊號色的紙鶴（three.js 的 3D），第一拍「啵」地拆回一個小三角，接著在拍點上一摺一摺攤開——
// 攤開的紙是白的那一面朝上，上面寫著主打留言（每一隻紙鶴裡都摺著一句祝福）。
//  - 摺紙是真的 3D：一張方紙切成四個三角形，每一塊的位置 = 繞摺線（兩條對角線）轉的角度，攤開就是轉回 0。
//    正面（朝上）是白色、印著留言與摺痕，背面是有顏色的紙；每個面依法向量打光，所以翻起來的那一刻會亮暗變化。
//  - 鏡頭：一開始很低（側面看紙鶴），攤開的同時升到正上方（讀留言），窗格夠長的話最後三拍再摺回去、紙鶴飛走。
//  - 紙在裁切墊上的影子：把每個面壓扁到桌面畫一次（用深度測試讓重疊的地方不會越疊越黑）。
//  - 從紙鶴到小三角這一步（真正的鶴要摺二十步）直接「省略」——左欄一本正經地寫著「步驟 04～20：略」。
//  - 攤開的紙（留言）是唯一的焦點；歌詞在上緣逐字跟唱，比留言小一級。小字只有兩群：左上的步驟、左下的註腳。
//    沒有留言：紙裡寫的是邀請。
//  - 標準 v2：紙縮成 420 px 見方、放在右邊；左邊大半個桌面散著一群摺好的紙鶴（千紙鶴），是場景的主角：
//    每一拍輪到一隻「跳」一下、轉個方向落下（outBack），全部隨著風輕輕晃；鏡頭停在斜上方，看得出紙鶴是立體的。
//    留言字級 40～60（貼圖字級要換算成螢幕上的 px）、署名 26～32、歌詞 40～52。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { GLSL_COMMON, THEME_UNIFORMS } from '../engine/glsl/common';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, lerp, pulse } from '../engine/util';
import { type FitResult } from '../engine/text';
import { fillWithHearts } from '../engine/motifs';
import { lyricAt, drawLyric, layoutLyric, beatAfter, signature, lyricSubOf, type LyricStyle } from './_motifs';
import { subRect, paperLyric } from './_t13';
import { msgMaxFor, lyricV2, sigV2, V2, fitClauses } from './_v2';
import { fitText } from '../engine/text';
import { LIN } from '../engine/palette';
import { hash } from '../engine/util';

export const spec: PlateSpecDecl = { group: 'type', family: 'craft', paper: true, energy: [0.1, 0.75], bars: [4, 8] };

// ---------------------------------------------------------------- 版面
/** 紙的中心在畫面上的位置、紙的半邊長（世界座標 1 單位 = 桌面上 1 px）。 */
const P0 = { x: 1128, y: 548 };
const S = 210;
/** 紙裡面那張貼圖的解析度（紙寬 420 px，貼圖 1024：推近也是銳利的）。 */
const TEX = 1024;
/** 貼圖 px／螢幕 px（字級換算用）。 */
const KT = TEX / (2 * S);
/** 上緣的歌詞與左欄。 */
const LYR = { x: 128, base: 204, w: 1210 };
/**
 * 桌上散著的紙鶴（螢幕座標，攤平時的位置）：大小、朝向、顏色（0 訊號色、1 淺的訊號色、2 白）。
 * 都在紙的左邊、避開上緣的歌詞與左下的註腳。
 */
const FLOCK = [
  { x: 290, y: 400, s: 0.56, r: 0.6, c: 0 }, { x: 520, y: 320, s: 0.44, r: -0.9, c: 2 }, { x: 720, y: 450, s: 0.5, r: 2.3, c: 1 },
  { x: 420, y: 600, s: 0.6, r: -0.35, c: 0 }, { x: 660, y: 730, s: 0.46, r: 1.35, c: 2 }, { x: 210, y: 640, s: 0.42, r: 2.9, c: 1 },
  { x: 780, y: 290, s: 0.38, r: -2.1, c: 0 }, { x: 330, y: 800, s: 0.4, r: -1.2, c: 1 },
];
const LYR_R = { x: 96, y: 92, w: 1270, h: 170 };
/**
 * 有韓文原文的窗格：原文在中文下面，整組往下多用一點（紙鶴在更下面），圖層上下各放寬一點；
 * 原文最後一排的基線在 LYR.base + SUB_DROP，中文折兩行時第一行也還在圖層裡。
 */
const LYR_R_SUB = { x: 96, y: 84, w: 1270, h: 196 };
const SUB_DROP = 40;
const COL = { x: 128, w: 330 };
const COL_R = { x: 96, y: 80, w: 420, h: 910 };
const FAM_MSG = F.hand(400);
const INVITE = ['掃描右下角 QR code，', '把你的祝福摺進', '下一隻紙鶴。'];
const NOTES = ['＊步驟 04～20：略。', '＊每一隻紙鶴裡，都摺著一句祝福。'];

/** 裁切墊：比紙暗一點的桌面、1 cm 的細格、5 cm 一條粗線。 */
const MAT = () => new FSPass(/* glsl */ `
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 col = mix(C_PAPER, C_SEPIA, 0.1) * (0.9 + 0.035 * fbm(p * 0.002, 3) + 0.012 * snoise(p * 0.6));
    col *= 0.95 + 0.07 * (1.0 - vUv.x * 0.6) * vUv.y;
    vec2 g = abs(fract((p - vec2(8.0, 12.0)) / 40.0 + 0.5) - 0.5) * 40.0;
    vec2 G = abs(fract((p - vec2(8.0, 12.0)) / 200.0 + 0.5) - 0.5) * 200.0;
    float ln = max(pxLine(g.x, 0.3, 1.1), pxLine(g.y, 0.3, 1.1)) * 0.04 + max(pxLine(G.x, 0.4, 1.3), pxLine(G.y, 0.4, 1.3)) * 0.06;
    fragColor = vec4(mix(col, C_SEPIA, ln), 1.0);
  }`);

const VERT = /* glsl */ `
precision highp float;
in vec3 position; in vec2 uv;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
uniform float uMode;
out vec3 vWP; out vec2 vUv;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  // 影子：壓扁到桌面，光從左上方來，離桌面越高影子挪得越遠
  if (uMode > 1.5) wp.xyz = vec3(wp.x + wp.z * 0.3 + 6.0, wp.y - wp.z * 0.42 - 9.0, 0.0);
  vWP = wp.xyz; vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FRAG = /* glsl */ `
precision highp float;
precision highp int;
in vec3 vWP; in vec2 vUv;
out vec4 fragColor;
uniform vec3 cameraPosition;
uniform sampler2D uTex; uniform float uMode; uniform float uAlpha; uniform vec3 uTint;
${GLSL_COMMON}
void main() {
  if (uMode > 1.5) { fragColor = vec4(0.0, 0.0, 0.0, (uMode > 2.5 ? 0.1 : 0.2) * uAlpha); return; }
  // 平面打光：法向量從螢幕導數算（每個面一個亮度，像真的摺紙）
  vec3 n = normalize(cross(dFdx(vWP), dFdy(vWP)));
  if (dot(n, cameraPosition - vWP) < 0.0) n = -n;
  vec3 L = normalize(vec3(-0.45, 0.55, 0.75));
  float lam = 0.72 + 0.4 * max(dot(n, L), 0.0);
  vec3 col;
  if (gl_FrontFacing && uMode < 0.5) {
    // 白的那一面（紙裡面）：貼圖是 fast 的 Canvas2D（預乘、sRGB 編碼），自己解
    vec4 c = texture(uTex, vUv);
    col = c.a > 0.0 ? toLinear(c.rgb / c.a) : C_BONE;
  } else {
    // 有顏色的那一面：訊號色的和紙（不發光），細細的纖維
    col = uTint * 0.78 * (0.95 + 0.05 * snoise(vWP.xy * vec2(0.9, 0.08)));
  }
  fragColor = vec4(col * lam * uAlpha, uAlpha);
}`;

type V3 = [number, number, number];
/**
 * 紙鶴的面（單位：紙的半邊長；x 是頭到尾、y 是翅膀、z 往上）。經典的摺紙鶴：菱形的身體、從身體下緣斜斜伸出的細長脖子與尾巴、
 * 頭往下折一小段、兩片大翅膀從背脊往兩邊張開、中間一道摺痕。每一面兩片（有厚度），平面打光讓每一面亮暗不同。
 */
function craneTris(): V3[] {
  const R0: V3 = [-0.17, 0, 0.1], R1: V3 = [0.17, 0, 0.1];
  const Fb: V3 = [-0.3, 0, -0.02], Bb: V3 = [0.3, 0, -0.02], K: V3 = [0, 0, -0.2];
  const Nk: V3 = [-0.12, 0, 0.0], N1: V3 = [-0.7, 0, 0.66], Hd: V3 = [-0.86, 0, 0.55], Hb: V3 = [-0.72, 0, 0.57];
  const Tk: V3 = [0.12, 0, 0.0], T1: V3 = [0.78, 0, 0.62];
  const off = (v: V3, dy: number): V3 => [v[0], v[1] + dy, v[2]];
  const out: V3[] = [];
  // 身體：兩側各三面（菱形）
  for (const dy of [0.05, -0.05]) out.push(off(R0, dy), off(Fb, dy), K, off(R0, dy), K, off(R1, dy), off(R1, dy), K, off(Bb, dy));
  // 脖子、頭、尾巴（兩片夾起來，中間一道稜）
  for (const dy of [0.018, -0.018]) out.push(off(Fb, dy), off(Nk, dy), N1, off(Bb, dy), T1, off(Tk, dy));
  out.push(N1, Hd, Hb);
  // 翅膀：背脊 → 翅尖，一道從後端到翅膀中間的摺痕
  for (const sy of [1, -1]) {
    const M: V3 = [-0.04, 0.52 * sy, 0.3], Wt: V3 = [0.12, 1.05 * sy, 0.36];
    out.push(R0, R1, M, M, R1, Wt);
  }
  return out;
}

/** 一張方紙的四個三角形（紙的座標 -1..1，y 往上）：上、右、下、左。 */
const FACES: [number, number][][] = [
  [[0, 0], [1, 1], [-1, 1]],
  [[0, 0], [1, -1], [1, 1]],
  [[0, 0], [-1, -1], [1, -1]],
  [[0, 0], [-1, 1], [-1, -1]],
];
/** 摺線：A 沿著 y = x 把左上半摺到右下；B 沿著 y = −x 把右上那一疊摺到左下。哪幾塊跟著哪一摺動。 */
const AX_A = new THREE.Vector3(1, 1, 0).normalize(), AX_B = new THREE.Vector3(1, -1, 0).normalize();
const IN_A = [true, false, false, true], IN_B = [true, true, false, false];

export default class Origami extends Scene {
  mat = shared('origami.mat', MAT);
  scene3 = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(22, W / H, 10, 12000);
  inside = this.track(new Layer2D(TEX, TEX, 1, { fast: true }));
  /** 這一格有沒有韓文原文副行（建構時就看：引擎只在建立這一格之前設好開關）。 */
  lyrBox = this.ctx.lyrics.linesIn(this.ctx.start - 1, this.ctx.end + 1).some((l) => !!lyricSubOf(l)) ? LYR_R_SUB : LYR_R;
  lyr = this.track(new Layer2D(this.lyrBox.w, this.lyrBox.h, undefined, { fast: true }));
  col = this.track(new Layer2D(COL_R.w, COL_R.h, undefined, { fast: true }));
  paperMat: THREE.RawShaderMaterial;
  shadowMat: THREE.RawShaderMaterial;
  craneShadowMat: THREE.RawShaderMaterial;
  craneMat: THREE.RawShaderMaterial;
  faces: THREE.Mesh[] = [];
  faceShadows: THREE.Mesh[] = [];
  crane: THREE.Mesh;
  craneShadow: THREE.Mesh;
  /** 桌上的紙鶴群（三種顏色各一個材質）。 */
  flock: THREE.Mesh[] = [];
  flockShadows: THREE.Mesh[] = [];
  tintMats: THREE.RawShaderMaterial[] = [];
  /** 每一拍輪到哪一隻跳（打散的順序）。 */
  order: number[] = [];
  beat0 = 0;
  geoms: THREE.BufferGeometry[] = [];
  msg: Msg | null = this.ctx.params.message ?? null;
  fit: FitResult | null = null;
  /** 時間點：拆成小三角、打開 B、打開 A；（長窗格）摺回 A、B、變回紙鶴。 */
  tPop = 0; tB = 0; tA = 0; tReA = Infinity; tReB = Infinity; tRePop = Infinity;
  beat = 0.5;
  colKey = '';

  constructor(ctx: ConstructorParameters<typeof Scene>[0]) {
    super(ctx);
    const mk = (mode: number, o: Partial<THREE.ShaderMaterialParameters> = {}) => new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { ...THEME_UNIFORMS, uTex: { value: null }, uMode: { value: mode }, uAlpha: { value: 1 }, uTint: { value: new THREE.Vector3() } },
      side: THREE.DoubleSide, ...o,
    });
    this.paperMat = mk(0, { depthTest: false, depthWrite: false });
    this.craneMat = mk(1, { depthTest: true, depthWrite: true, transparent: true });
    // 影子：半透明黑，深度測試「小於」：同一個桌面位置只畫一次，重疊的紙不會把影子疊得更黑
    this.shadowMat = mk(2, { transparent: true, depthTest: true, depthWrite: true, depthFunc: THREE.LessDepth });
    // 紙鶴離桌面比較遠，影子淡一點
    this.craneShadowMat = mk(3, { transparent: true, depthTest: true, depthWrite: true, depthFunc: THREE.LessDepth });
    this.paperMat.uniforms.uTex!.value = this.inside.texture;
    // 紙裡的字：貼圖 1024 貼在 600 px 的紙上、鏡頭還是斜的，沒有 mipmap 會有鋸齒（只上傳一次，mipmap 也只算一次）
    this.inside.texture.generateMipmaps = true;
    this.inside.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.inside.texture.anisotropy = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy());
    for (const f of FACES) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(f.flatMap(([x, y]) => [x * S, y * S, 0]), 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(f.flatMap(([x, y]) => [(x + 1) / 2, (y + 1) / 2]), 2));
      this.geoms.push(g);
      const m = new THREE.Mesh(g, this.paperMat), sh = new THREE.Mesh(g, this.shadowMat);
      for (const o of [m, sh]) { o.matrixAutoUpdate = false; o.frustumCulled = false; this.scene3.add(o); }
      sh.renderOrder = 0;
      this.faces.push(m); this.faceShadows.push(sh);
    }
    const cg = new THREE.BufferGeometry();
    const tris = craneTris();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(tris.flatMap((v) => [v[0] * S, v[1] * S, v[2] * S]), 3));
    cg.setAttribute('uv', new THREE.Float32BufferAttribute(tris.flatMap(() => [0, 0]), 2));
    this.geoms.push(cg);
    this.crane = new THREE.Mesh(cg, this.craneMat);
    this.craneShadow = new THREE.Mesh(cg, this.craneShadowMat);
    for (const o of [this.crane, this.craneShadow]) { o.matrixAutoUpdate = false; o.frustumCulled = false; this.scene3.add(o); }
    this.craneShadow.renderOrder = 0;
    this.crane.renderOrder = 50;
    // 紙鶴群：共用幾何，三種顏色
    this.tintMats = [0, 1, 2].map(() => mk(1, { depthTest: true, depthWrite: true }));
    for (const b of FLOCK) {
      const m = new THREE.Mesh(cg, this.tintMats[b.c]!), sh = new THREE.Mesh(cg, this.craneShadowMat);
      for (const o of [m, sh]) { o.matrixAutoUpdate = false; o.frustumCulled = false; this.scene3.add(o); }
      m.renderOrder = 40; sh.renderOrder = 0;
      this.flock.push(m); this.flockShadows.push(sh);
    }
    // 輪流的順序：固定的洗牌（每個窗格都一樣，確定性）
    this.order = FLOCK.map((_, i) => i).sort((a, b) => hash(a, 71) - hash(b, 71));
  }

  override async init() {
    const { audio: au, start, end, song } = this.ctx;
    const m = this.msg;
    await loadText(`${INVITE.join('')}${NOTES.join('')}摺紙鶴步驟攤開拆解略${song.title}${m ? m.text + signature(m.name) : ''}`);
    this.beat = au.beatPeriod(start);
    this.tPop = beatAfter(au, start + 0.05);
    const b0 = au.beatAt(this.tPop);
    this.beat0 = Math.round(b0);
    this.tB = au.timeOfBeat(b0 + 1);
    this.tA = au.timeOfBeat(b0 + 2);
    // 窗格夠長（24 拍以上）才摺回去：最後三拍 A、B、變回紙鶴飛走
    const bEnd = au.beatAt(end - 0.05);
    if (bEnd - b0 >= 24) {
      this.tReA = au.timeOfBeat(Math.floor(bEnd) - 3);
      this.tReB = au.timeOfBeat(Math.floor(bEnd) - 2);
      this.tRePop = au.timeOfBeat(Math.floor(bEnd) - 1);
    }
    this.drawInside();
  }

  /** 紙的裡面：白紙、紙鶴的摺痕、留言（或邀請）。只畫一次。 */
  private drawInside() {
    const L = this.inside, c = L.ctx;
    const k = KT; // 貼圖 px／桌面（螢幕）px
    c.fillStyle = rgba('bone');
    c.fillRect(0, 0, TEX, TEX);
    // 紙鶴的摺痕：對角線、中線、鳥形基本型的菱形（淡淡的）
    c.strokeStyle = rgba('sepia', 0.12);
    c.lineWidth = 2;
    const T = TEX, h = TEX / 2;
    const seg = (x0: number, y0: number, x1: number, y1: number) => { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); };
    seg(0, 0, T, T); seg(T, 0, 0, T); seg(h, 0, h, T); seg(0, h, T, h);
    c.strokeStyle = rgba('sepia', 0.08);
    const q = T * 0.2929; // 22.5° 的點
    for (const [x0, y0, x1, y1] of [[0, 0, h, q], [0, 0, q, h], [T, 0, h, q], [T, 0, T - q, h], [0, T, q, h], [0, T, h, T - q], [T, T, h, T - q], [T, T, T - q, h]]) seg(x0!, y0!, x1!, y1!);
    seg(h, q, T - q, h); seg(T - q, h, h, T - q); seg(h, T - q, q, h); seg(q, h, h, q);
    // 留言
    const m = this.msg;
    c.textBaseline = 'alphabetic';
    if (m) {
      // 標準 v2：螢幕上 40～60（依字數）、署名 26～32；紙上的框 380 × 360（署名的高度先扣掉）
      const bw = 380 * k, bh = (360 - sigV2(msgMaxFor(m.text)) * 2) * k;
      const o = { min: V2.msgMin * k, max: msgMaxFor(m.text) * k, lineHeight: 1.3, maxLines: 7 };
      this.fit = fitClauses(c, m.text, FAM_MSG, bw, bh, o) ?? fitText(c, m.text, FAM_MSG, bw, bh, o);
      const fit = this.fit, sig = sigV2(fit.size / k) * k;
      const blockH = fit.height + sig * 2;
      const top = h - blockH / 2 + fit.size * 0.88;
      c.font = font(FAM_MSG, fit.size);
      c.fillStyle = rgba('sepia', 0.95);
      fit.lines.forEach((ln, i) => { const w = c.measureText(ln).width; fillWithHearts(c, ln, h - w / 2, top + i * fit.lineHeight); });
      c.font = font(FAM_MSG, sig);
      c.fillStyle = rgba('sepia', 0.7);
      const s = signature(m.name), sw = c.measureText(s).width;
      c.fillText(s, h + Math.min(Math.max(fit.width / 2, sw / 2), bw / 2) - sw, top + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.3 + sig * 1.5);
    } else {
      // 沒有留言時焦點是歌詞：紙裡的邀請小一點、淡一點
      c.font = font(FAM_MSG, 36 * k);
      c.fillStyle = rgba('sepia', 0.7);
      INVITE.forEach((ln, i) => { const w = c.measureText(ln).width; c.fillText(ln, h - w / 2, h - 40 * k + i * 52 * k); });
    }
    L.upload();
  }

  /** 兩摺的角度（0 = 攤平、π = 摺好）與紙鶴出現的程度（1 = 紙鶴）。 */
  private state(t: number) {
    const fold = (t0: number, open: boolean) => { const k = ease.inOutQuart(clamp((t - t0) / (this.beat * 0.62))); return Math.PI * (open ? 1 - k : k); };
    let a = Math.PI, b = Math.PI;
    if (t >= this.tB) b = fold(this.tB, true);
    if (t >= this.tA) a = fold(this.tA, true);
    if (t >= this.tReA) a = fold(this.tReA, false);
    if (t >= this.tReB) b = fold(this.tReB, false);
    // 紙鶴 ↔ 小三角：「啵」——先縮走（inBack：先微微脹一下）、另一個再彈出來（outBack），不做半透明的交疊
    const out1 = clamp((t - this.tPop) / 0.16), in1 = clamp((t - this.tPop - 0.12) / 0.24);
    const out2 = clamp((t - this.tRePop) / 0.16), in2 = clamp((t - this.tRePop - 0.12) / 0.24);
    const packet = Math.max(0, ease.outBack(in1) * (1 - ease.inBack(out2)));
    const crane = t < this.tRePop ? Math.max(0, 1 - ease.inBack(out1)) : ease.outBack(in2);
    return { a, b, crane, packet, in1, out1, in2 };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const vis = prog(t, s, s + 0.3) * (1 - prog(t, e - 0.25, e));
    this.mat.render(renderer, out);
    const st = this.state(t);

    // ---- 鏡頭：一開始低低的看紙鶴（側面），攤開時升到正上方；摺回去時再降下來
    const up = ease.inOutCubic(prog(t, this.tPop, this.tA + this.beat * 0.7));
    // 沒有摺回去的窗格 tReA 是 Infinity：prog(t, ∞, ∞) 會是 NaN，鏡頭整個壞掉，要先擋掉
    const down = t >= this.tReA ? ease.inOutCubic(prog(t, this.tReA, this.tRePop + 0.2)) : 0;
    const tilt = lerp(lerp(0.8, 0.52, up), 0.72, down) + 0.012 * Math.sin(f.bar * Math.PI) * up * (1 - down);
    const D = (H / 2) / Math.tan((22 * Math.PI) / 360);
    const tgt = new THREE.Vector3(P0.x, H - P0.y, 0);
    // 窗格慢慢推近一點
    const dist = D * (1 - 0.05 * ease.inOutCubic(f.p));
    this.cam.position.set(tgt.x, tgt.y - dist * Math.sin(tilt), dist * Math.cos(tilt));
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(tgt);
    this.cam.setViewOffset(W, H, (W / 2 - P0.x), (H / 2 - P0.y), W, H);
    this.cam.updateProjectionMatrix();
    this.cam.updateMatrixWorld();

    // ---- 紙：每一塊 = 位置 · 整體（啵的旋轉、抬起）· 摺 B · 摺 A
    const Ra = new THREE.Matrix4().makeRotationAxis(AX_A, st.a), Rb = new THREE.Matrix4().makeRotationAxis(AX_B, st.b);
    // 小三角拆出來時是轉著落下的；攤平後每個小節線被手輕輕擺正一下
    const spin = (1 - st.in1) * 2.4;
    const lift = (1 - ease.outCubic(st.in1)) * 140;
    const sc = st.packet;
    const nudge = st.a < 0.01 ? (Math.floor(f.bar) % 2 ? 1 : -1) * 0.02 * (1 - ease.outBack(clamp(f.barPhase / 0.25))) : 0;
    const G = new THREE.Matrix4().makeTranslation(tgt.x, tgt.y, lift + 0.5)
      .multiply(new THREE.Matrix4().makeRotationZ(spin + nudge - 0.06))
      .multiply(new THREE.Matrix4().makeScale(Math.max(sc, 1e-3), Math.max(sc, 1e-3), Math.max(sc, 1e-3)));
    const paperOn = sc > 0.002;
    // 畫的順序：沒在動的在下面，在動的那一疊在上面；翻過一半以後那一疊的上下顛倒
    const bias = st.b > Math.PI / 2 ? [2, 3, 0, 1] : [1, 0, 0, 1];
    this.faces.forEach((m, i) => {
      const M = G.clone();
      if (IN_B[i]) M.multiply(Rb);
      if (IN_A[i]) M.multiply(Ra);
      m.matrix.copy(M); m.matrixWorldNeedsUpdate = true;
      this.faceShadows[i]!.matrix.copy(M); this.faceShadows[i]!.matrixWorldNeedsUpdate = true;
      const moving = (IN_A[i] && st.a > 0.01 && st.a < Math.PI - 0.01) || (IN_B[i] && st.b > 0.01 && st.b < Math.PI - 0.01);
      m.renderOrder = 10 + (moving ? 10 : 0) + bias[i]!;
      m.visible = this.faceShadows[i]!.visible = paperOn;
    });
    this.paperMat.uniforms.uAlpha!.value = 1;
    // ---- 紙鶴：拆開前站在紙的位置（啵的時候轉著縮小），摺回去後變回來、飛走
    const cOn = st.crane > 0.002;
    const fly = t >= this.tRePop + 0.36 ? prog(t, this.tRePop + 0.36, e, ease.inCubic) : 0;
    const cs = 0.9 * st.crane;
    const bob = pulse(t, this.ctx.audio.timeOfBeat(Math.floor(f.beat)), 0.12) * 14 * (t < this.tPop ? 1 : 0);
    const rz = t < this.tRePop ? -0.5 + ease.inCubic(st.out1) * 1.6 : -0.5 - (1 - st.in2) * 1.6;
    const C = new THREE.Matrix4().makeTranslation(tgt.x + fly * 380, tgt.y + fly * 260, 0.2 * S * cs + bob + fly * 520)
      .multiply(new THREE.Matrix4().makeRotationZ(rz + fly * 0.4))
      .multiply(new THREE.Matrix4().makeScale(Math.max(cs, 1e-3), Math.max(cs, 1e-3), Math.max(cs, 1e-3)));
    this.crane.matrix.copy(C); this.crane.matrixWorldNeedsUpdate = true;
    this.craneShadow.matrix.copy(C); this.craneShadow.matrixWorldNeedsUpdate = true;
    this.crane.visible = this.craneShadow.visible = cOn;
    this.craneMat.uniforms.uAlpha!.value = 1;
    this.craneShadowMat.uniforms.uAlpha!.value = 1 - fly;

    this.updateFlock(f);

    renderer.setRenderTarget(out);
    renderer.clearDepth();
    renderer.render(this.scene3, this.cam);

    // ---- 上緣的歌詞、左欄
    this.drawLyr(t, vis, lyricAt(lyrics, t));
    comp.draw(renderer, this.lyr.upload(), out, subRect(this.lyrBox));
    this.drawCol(t, st, vis);
    comp.draw(renderer, this.col.texture, out, subRect(COL_R));

    const whoosh = pulse(t, this.tPop + 0.12, 0.08) + (t >= this.tRePop ? pulse(t, this.tRePop + 0.12, 0.08) : 0);
    return {
      paper: 1, bloom: 0.3, bloomThreshold: 0.98, bloomKnee: 0.12, halation: 0.08, vignette: 0.22, grain: 0.05,
      zoom: 1 + 0.01 * whoosh,
      popupAvoid: [[P0.x - S - 30, P0.y - S - 30, 2 * S + 60, 2 * S + 60], [LYR.x - 20, 110, LYR.w + 40, 130]],
    };
  }

  /**
   * 桌上的紙鶴群：每一拍輪到一隻跳起來、轉 70°～110° 落下（outBack，落地時壓一下）；
   * 全部跟著「風」輕輕晃（慢慢的正弦，不同相位）。跳過幾次、轉了多少由拍號直接算（確定性）。
   */
  private updateFlock(f: Frame) {
    const au = this.ctx.audio, t = f.t, N = FLOCK.length;
    const tint = [
      [LIN.signal[0] * 0.7 + LIN.blood[0] * 0.3, LIN.signal[1] * 0.7 + LIN.blood[1] * 0.3, LIN.signal[2] * 0.7 + LIN.blood[2] * 0.3],
      [LIN.signal[0] * 0.5 + LIN.paper[0] * 0.5, LIN.signal[1] * 0.5 + LIN.paper[1] * 0.5, LIN.signal[2] * 0.5 + LIN.paper[2] * 0.5],
      [LIN.bone[0] * 1.05, LIN.bone[1] * 1.05, LIN.bone[2] * 1.05],
    ];
    this.tintMats.forEach((m, i) => (m.uniforms.uTint!.value as THREE.Vector3).set(tint[i]![0]!, tint[i]![1]!, tint[i]![2]!));
    (this.craneMat.uniforms.uTint!.value as THREE.Vector3).set(tint[0]![0]!, tint[0]![1]!, tint[0]![2]!);
    (this.paperMat.uniforms.uTint!.value as THREE.Vector3).set(tint[0]![0]!, tint[0]![1]!, tint[0]![2]!);
    const bNow = Math.floor(au.beatAt(t)), bp = au.beatAt(t) - bNow;
    const rel = bNow - this.beat0;
    FLOCK.forEach((b, i) => {
      const pos = this.order.indexOf(i);
      // 到這一拍為止跳過幾次（每 N 拍輪一次）；每次轉的角度用雜湊決定方向
      const hops = rel >= pos ? Math.floor((rel - pos) / N) + 1 : 0;
      let turn = 0;
      for (let h = 0; h < hops; h++) turn += (hash(i, h, 5) < 0.5 ? -1 : 1) * (1.2 + 0.7 * hash(i, h, 6));
      const mine = rel >= 0 && ((rel - pos) % N + N) % N === 0 && hops > 0;
      let lift = 0, squash = 1;
      if (mine) {
        // 這一拍是牠：前 35% 跳起來、落下；轉的量用 outBack 走完
        const u = clamp(bp / 0.38);
        lift = Math.sin(Math.PI * u) * 46;
        const last = (hash(i, hops - 1, 5) < 0.5 ? -1 : 1) * (1.2 + 0.7 * hash(i, hops - 1, 6));
        turn -= last * (1 - ease.outBack(u));
        squash = 1 - 0.08 * Math.sin(Math.PI * clamp((bp - 0.3) / 0.2));
      }
      const wob = 0.035 * Math.sin(t * 1.3 + i * 1.7) + 0.02 * Math.sin(t * 2.1 + i);
      const sc = b.s;
      const M = new THREE.Matrix4().makeTranslation(b.x, H - b.y, 0.2 * S * sc + lift)
        .multiply(new THREE.Matrix4().makeRotationZ(b.r + turn + wob))
        .multiply(new THREE.Matrix4().makeRotationX(0.04 * Math.sin(t * 1.7 + i * 2.3)))
        .multiply(new THREE.Matrix4().makeScale(sc, sc, sc * squash));
      this.flock[i]!.matrix.copy(M); this.flock[i]!.matrixWorldNeedsUpdate = true;
      this.flockShadows[i]!.matrix.copy(M); this.flockShadows[i]!.matrixWorldNeedsUpdate = true;
    });
  }

  private drawLyr(t: number, vis: number, ly: ReturnType<typeof lyricAt>) {
    const L = this.lyr, c = L.ctx;
    L.clear();
    c.save();
    c.translate(-this.lyrBox.x, -this.lyrBox.y);
    c.globalAlpha = vis;
    if (ly) {
      const st: LyricStyle = { family: F.archivo(87.5, 800), size: lyricV2(this.fit ? this.fit.size / KT : null), minSize: V2.lyrMin, maxWidth: LYR.w, ...paperLyric() };
      const lay = layoutLyric(c, ly.line, st);
      const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.2));
      c.translate(LYR.x, LYR.base + (lay.sub ? SUB_DROP : 0) - (lay.height - lay.size) + (1 - inK) * 16);
      drawLyric(c, ly.line, t, st, lay, ly.k * vis);
    } else {
      const { song } = this.ctx;
      c.font = font(F.mono(500), 18);
      c.letterSpacing = '4px';
      c.fillStyle = rgba('sepia', 0.55);
      c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`.toUpperCase(), LYR.x, LYR.base - 30);
      c.letterSpacing = '0px';
    }
    c.restore();
  }

  /** 左欄：步驟編號（倒著數：拆開紙鶴）、註腳。步驟變了才重畫。 */
  private drawCol(t: number, st: ReturnType<Origami['state']>, vis: number) {
    const step = st.crane >= 1 ? 21 : st.b > 0.01 && t < this.tReA ? 3 : st.a > 0.01 ? 2 : 1;
    const label = t >= this.tRePop ? '完成' : t >= this.tReA ? '摺回去' : step === 21 ? '完成品' : step === 1 ? '攤開' : '拆解中';
    const key = `${step}|${label}|${Math.round(vis * 10)}`;
    if (key === this.colKey) return;
    this.colKey = key;
    const L = this.col, c = L.ctx;
    L.clear();
    c.save();
    c.translate(-COL_R.x, -COL_R.y);
    c.globalAlpha = vis;
    // 左上：一行步驟（像說明書角落的小字）；左下：兩行冷面註腳
    c.font = font(F.mono(500), 15);
    c.letterSpacing = '4px';
    c.fillStyle = rgba('sepia', 0.5);
    c.fillText(`摺紙鶴 · 步驟 ${String(t >= this.tRePop ? 21 : step).padStart(2, '0')}／21 · ${label}`, COL.x, 128);
    c.letterSpacing = '0px';
    c.font = font(F.hei(500), 20);
    c.fillStyle = rgba('sepia', 0.42);
    NOTES.forEach((ln, i) => c.fillText(ln, COL.x, 912 + i * 32));
    c.restore();
    L.upload();
  }

  override dispose() {
    for (const g of this.geoms) g.dispose();
    this.paperMat.dispose(); this.shadowMat.dispose(); this.craneShadowMat.dispose(); this.craneMat.dispose();
    for (const m of this.tintMats) m.dispose();
    super.dispose();
  }
}
