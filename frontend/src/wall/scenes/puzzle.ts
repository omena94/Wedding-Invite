// 拼圖（暗）：暗色的木頭桌上一塊拼圖墊，拼圖片在拍點一片片從鏡頭前飛進來（翻滾、前景虛化、影子），
// 由左上到右下照閱讀的順序拼好——拼好的圖是一張深色的小海報：手繪的藤蔓花紋框、正中間手寫的主打留言、署名。
//  - 節拍：拼圖片排在 1/2、1/4 或 1/8 拍的格子上（挑最慢、但一兩小節內拼得完的那種），一片落下「喀」一聲（很小的一震）。
//    最後一片落下的那一拍，接縫從中間往外亮一圈訊號色的光（拼好了）。
//  - 鏡頭：切進來時從斜上方、遠一點、歪一點的地方看著空的拼圖墊；拼圖片飛進來的時候鏡頭一路推近、轉正，
//    拼好之後很慢地推近。還在空中的拼圖片離鏡頭近，是糊的（每一片依高度用比較粗的 mip 層取樣、邊緣放軟）。
//  - 歌詞：拼圖墊下面、桌上的一行字（逐字跟唱），比留言小一級。
//  - 沒有留言：海報是新人的名字（小）與一圈花紋，歌詞放大當主角，底下一行邀請。純音樂：歌詞那行寫歌名。
// v2（留言尺寸標準）：海報改成「左邊一段手寫的留言（40～60 px，留言區 ≤ 860×430）、右邊一圈藤蔓花環＋縮寫」，
// 拼圖本身是主視覺。拼好之後：每個小節有一片沒壓緊的拼圖被按一下（翹起來再落下，落在拍點），
// 每兩小節一道光從左上掃過亮面的拼圖（燈在上面移動），鏡頭慢慢推近。
// 手法：每一片是一個四邊形（InstancedMesh，一個 draw call），形狀在 shader 裡用 SDF 算（方塊 ± 圓形的凸耳，
// 用 smin／smax 做出圓滑的脖子，相鄰兩片剛好互補），接縫的刻痕與受光面也從 SDF 來；影子是同一個形狀投到桌面、依高度模糊。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { GLSL_COMMON, THEME_UNIFORMS } from '../engine/glsl/common';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, pulse, hash, frameIdx, TAU } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { lyricAt, layoutLyric, drawLyric, beatAfter, drawHeart, fillWithHearts, COUPLE_ZH, COUPLE_EN, DATE_DOTS } from './_motifs';
import { msgMaxFor, lyricV2, sigV2, fitClauses } from './_v2';
import { darkInk } from './_t4';
import { onGrid, sigOf, applyOrbit, lerpOrbit, toScreen, T17_INVITE, T17_TEXT, type OrbitCam, type V3 } from './_t17';

export const spec: PlateSpecDecl = { group: 'type', family: 'game', paper: false, energy: [0.3, 1], bars: [4, 8], weight: 1 };

const COLS = 10, ROWS = 5;
/** 拼圖（海報）的大小（世界單位 ≈ 落定時的螢幕像素）。 */
const BW = 1480, BH = 660;
const CW = BW / COLS, CH = BH / ROWS;
/** 四邊形比格子大一圈（凸耳伸出去）。 */
const PAD = Math.min(CW, CH) * 0.36;
const QW = CW + 2 * PAD, QH = CH + 2 * PAD;
const N = COLS * ROWS;
const RES = 1.5;
const FAM_MSG = F.hand(700);
const FAM_LYR = F.archivo(100, 800);
const LIGHT: V3 = [-0.45, 0.5, 1];
/** 歌詞那一行（螢幕座標）。 */
const LYR = { x: 150, y: 930, w: 1180 };

const PRE = /* glsl */ `precision highp float;\nprecision highp int;\n`;
const VERT = /* glsl */ `${PRE}
in vec3 position; in vec2 uv; in mat4 instanceMatrix; in vec4 iA; in vec4 iT; in vec4 iB;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix; uniform vec3 uLight; uniform float shadowPass;
out vec2 vUv; out vec4 vA; out vec4 vT; out vec4 vB;
void main() {
  vUv = uv; vA = iA; vT = iT; vB = iB;
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  if (shadowPass > 0.5) { w.xy -= uLight.xy * (w.z / uLight.z); w.z = 0.5; }
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// 形狀：方塊 ± 四個凸耳。tabs = (右, 上, 左, 下)：1 凸出、-1 凹進、0 平邊
const SHAPE = /* glsl */ `
uniform vec2 cell; uniform vec2 quad;
float pieceSD(vec2 p, vec4 tabs) {
  vec2 hs = cell * 0.5;
  float d = sdBox(p, hs);
  float r = min(cell.x, cell.y) * 0.17;
  float k = r * 0.45;
  for (int i = 0; i < 4; i++) {
    float tb = tabs[i];
    vec2 n = i == 0 ? vec2(1.0, 0.0) : i == 1 ? vec2(0.0, 1.0) : i == 2 ? vec2(-1.0, 0.0) : vec2(0.0, -1.0);
    vec2 c = n * (i == 0 || i == 2 ? hs.x : hs.y);
    if (tb > 0.5) d = smin(d, sdCircle(p - c - n * r * 0.78, r), k);
    else if (tb < -0.5) d = smax(d, -sdCircle(p - c + n * r * 0.78, r), k);
  }
  return d;
}`;

// iA = (列, 行, 模糊 px, 接縫發光)；iB = (高度, 可見, -, -)
const FRAG = /* glsl */ `${PRE}
in vec2 vUv; in vec4 vA; in vec4 vT; in vec4 vB;
out vec4 fragColor;
${GLSL_COMMON}
${SHAPE}
uniform sampler2D poster; uniform vec2 posterPx; uniform vec2 board; uniform vec3 uLight2; uniform vec2 glint;
void main() {
  vec2 p = (vUv - 0.5) * quad;
  // 在海報上的位置（像素，y 向下）
  vec2 pp = vec2((vA.x + 0.5) * cell.x + p.x, (vA.y + 0.5) * cell.y - p.y);
  vec2 uv = vec2(pp.x / board.x, 1.0 - pp.y / board.y);
  // mip 層：螢幕上一個像素跨幾個貼圖像素，再加上離焦的模糊（在一致的控制流程裡算好，textureLod 取樣）
  vec2 tp = uv * posterPx;
  float lod0 = log2(max(max(length(dFdx(tp)), length(dFdy(tp))), 1e-4));
  float blur = vA.z;
  // 離焦：一圈 8 點的圓盤平均（半徑 = 模糊的像素換成貼圖座標），mip 只拿來去掉鋸齒，不拿來當模糊（粗的 mip 放大會一格一格的）
  float lod = max(0.0, lod0 + log2(1.0 + blur * 0.15));
  vec2 duv = vec2(length(vec2(dFdx(uv.x), dFdy(uv.x))), length(vec2(dFdx(uv.y), dFdy(uv.y)))) * blur;
  vec2 cuv = clamp(uv, vec2(0.001), vec2(0.999));
  vec3 img = textureLod(poster, cuv, lod).rgb;
  if (blur > 0.3) {
    for (int k = 0; k < 8; k++) {
      float an = float(k) * 0.785398 + 0.3;
      img += textureLod(poster, clamp(uv + vec2(cos(an), sin(an)) * duv * (k % 2 == 0 ? 1.0 : 0.55), vec2(0.001), vec2(0.999)), lod).rgb;
    }
    img /= 9.0;
  }
  float d = pieceSD(p, vT);
  float aa = fwidth(d) + blur * 0.6;
  float a = 1.0 - smoothstep(-aa, aa, d);
  if (a <= 0.001) discard;
  // 紙板的質感、接縫的刻痕、受光的斜邊（光從左上）
  vec2 g = vec2(dFdx(d), dFdy(d));
  float gl = length(g);
  vec2 gn = gl > 0.0 ? g / gl : vec2(0.0);
  float rim = 1.0 - smoothstep(0.0, 4.5, -d);
  float litEdge = dot(gn, normalize(vec2(0.6, -0.7)));
  vec3 col = img * (0.96 + 0.05 * snoise(p / 2.5));
  col *= 1.0 - 0.55 * (1.0 - smoothstep(0.0, 1.6, -d));
  col += C_BONE * 0.07 * rim * max(-litEdge, 0.0);
  col *= 1.0 - 0.25 * rim * max(litEdge, 0.0);
  // 空中的片：離燈近一點，亮一點點
  col *= 1.0 + 0.1 * clamp(vB.x / 800.0, 0.0, 1.0);
  // 一道光掃過亮面的紙板（斜的一條，只在平放的片上）
  float gd = (pp.x + pp.y * 0.6 - glint.x) / 70.0;
  col += mix(C_BONE, C_EMBER, 0.3) * 0.07 * glint.y * exp(-gd * gd) * (1.0 - clamp(vB.x / 60.0, 0.0, 1.0));
  // 拼好的那一刻：接縫發光
  col += C_SIGNAL * 1.5 * vA.w * (1.0 - smoothstep(0.0, 2.6, abs(d + 0.8)));
  fragColor = vec4(col * a, a) * vB.y;
}`;

const SH_FRAG = /* glsl */ `${PRE}
in vec2 vUv; in vec4 vA; in vec4 vT; in vec4 vB;
out vec4 fragColor;
${GLSL_COMMON}
${SHAPE}
void main() {
  vec2 p = (vUv - 0.5) * quad;
  float d = pieceSD(p, vT);
  float h = vB.x;
  float b = 2.5 + h / 22.0;
  float a = (1.0 - smoothstep(-b, b, d)) * mix(0.6, 0.18, clamp(h / 1200.0, 0.0, 1.0)) * vB.y;
  fragColor = vec4(0.0, 0.0, 0.0, a);
}`;

const TABLE_FRAG = /* glsl */ `${PRE}
in vec3 vW;
out vec4 fragColor;
${GLSL_COMMON}
uniform sampler2D poster; uniform vec2 board; uniform vec4 lamp; uniform float ghost;
void main() {
  vec2 p = vW.xy;
  // 深色的胡桃木：沿 x 的木紋
  float g = fbm(vec2(p.x / 1600.0, p.y / 140.0), 3);
  float ring = sin((p.y + 160.0 * g) / 11.0);
  vec3 col = C_INK2 * (0.95 + 0.35 * g + 0.05 * ring) + C_BLOOD * 0.02;
  // 拼圖墊：比拼圖大一圈的深色毛氈，邊上一條細細的車線
  vec2 q = abs(p) - board * 0.5 - 34.0;
  float dm = max(q.x, q.y);
  if (dm < 0.0) {
    col = C_INK * (0.85 + 0.1 * snoise(p / 3.0)) + C_INK2 * 0.35;
    col += C_ASH * 0.05 * (1.0 - smoothstep(0.5, 1.5, abs(dm + 12.0))) * step(0.5, fract((p.x + p.y) / 14.0));
  }
  col *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 22.0, dm)) * step(0.0, dm);
  float r = length(p - lamp.xy) / lamp.z;
  col *= 0.45 + 0.75 * exp(-r * r);
  fragColor = vec4(col, 1.0);
}`;

class Rig {
  geo = new THREE.PlaneGeometry(1, 1);
  iA = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
  iT = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
  iB = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
  common = { cell: { value: new THREE.Vector2(CW, CH) }, quad: { value: new THREE.Vector2(QW, QH) }, uLight: { value: new THREE.Vector3(...LIGHT) } };
  pieceMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { ...THEME_UNIFORMS, ...this.common, shadowPass: { value: 0 }, poster: { value: null }, posterPx: { value: new THREE.Vector2(BW * RES, BH * RES) }, board: { value: new THREE.Vector2(BW, BH) }, uLight2: { value: new THREE.Vector3() }, glint: { value: new THREE.Vector2(-9999, 0) } },
    transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  shMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: SH_FRAG,
    uniforms: { ...THEME_UNIFORMS, ...this.common, shadowPass: { value: 1 } },
    transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  tableMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: `${PRE}in vec3 position; uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix; out vec3 vW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: TABLE_FRAG,
    uniforms: { ...THEME_UNIFORMS, poster: { value: null }, board: { value: new THREE.Vector2(BW, BH) }, lamp: { value: new THREE.Vector4(0, 0, 1400, 0) }, ghost: { value: 0.06 } },
    depthTest: false, depthWrite: false,
  });
  pieces: THREE.InstancedMesh;
  shadows: THREE.InstancedMesh;
  table = new THREE.Mesh(new THREE.PlaneGeometry(14000, 10000), this.tableMat);
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(30, W / H, 10, 40000);
  constructor() {
    this.geo.setAttribute('iA', this.iA);
    this.geo.setAttribute('iT', this.iT);
    this.geo.setAttribute('iB', this.iB);
    this.pieces = new THREE.InstancedMesh(this.geo, this.pieceMat, N);
    this.shadows = new THREE.InstancedMesh(this.geo, this.shMat, N);
    this.shadows.instanceMatrix = this.pieces.instanceMatrix;
    for (const m of [this.pieces, this.shadows, this.table]) { m.frustumCulled = false; this.scene.add(m); }
    this.table.renderOrder = 0; this.shadows.renderOrder = 1; this.pieces.renderOrder = 2;
    this.pieces.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
}

interface Piece { i: number; j: number; tabs: [number, number, number, number]; tl: number; sx: number; sy: number; sz: number; rz: number; rx: number; ry: number; glowT: number }

export default class Puzzle extends Scene {
  rig = shared('puzzle.rig', () => new Rig());
  lyr = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = Number(this.ctx.params.seed ?? 1) * 13 + (this.msg?.id ?? 0);
  posterCv: HTMLCanvasElement | null = null;
  posterTex: THREE.CanvasTexture | null = null;
  pieces: Piece[] = [];
  fit: FitResult | null = null;
  sig = '';
  t1 = 0; tDone = 0; B = 0.5; FD = 0.5;
  camA!: OrbitCam; camB!: OrbitCam;
  lyrSize = 56;
  m4 = new THREE.Matrix4(); q = new THREE.Quaternion(); e = new THREE.Euler(); v = new THREE.Vector3(); s3 = new THREE.Vector3();
  order: number[] = [];
  /** 拼好之後每個小節被按一下的那一片（片的索引與時間）、光掃過的時間。 */
  pops: { k: number; t: number }[] = [];
  glints: number[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.sig = sigOf(m);
    await loadText(`${m?.text ?? ''}${this.sig}${T17_TEXT}${T17_INVITE}${song.title}${song.artist}${COUPLE_ZH}${DATE_DOTS}♪${lyrics.linesIn(s - 2, e + 1).map((l) => l.text).join('')}`);
    const B = (this.B = au.beatPeriod(s + 0.1));

    // ---- 海報（拼好的圖）：深色的底、藤蔓花紋框、正中間的留言與署名
    const cv = (this.posterCv = document.createElement('canvas'));
    cv.width = Math.round(BW * RES); cv.height = Math.round(BH * RES);
    const c = cv.getContext('2d')!;
    c.scale(RES, RES);
    const g = c.createRadialGradient(BW / 2, BH * 0.45, 40, BW / 2, BH / 2, BW * 0.62);
    g.addColorStop(0, mixRgba('ink2', 'graphite', 0.28));
    g.addColorStop(1, mixRgba('ink', 'ink2', 0.5));
    c.fillStyle = g; c.fillRect(0, 0, BW, BH);
    // 很淡的斜線網（印刷的網點感）
    c.strokeStyle = rgba('bone', 0.025); c.lineWidth = 1;
    for (let k = -BH; k < BW; k += 7) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k + BH, BH); c.stroke(); }
    this.drawFrame(c);
    // 海報在畫面上大約放大 PX 倍（鏡頭落定時整張拼圖約佔畫面寬度的九成），字級要除回去
    const PX = 1.14;
    this.drawWreath(c, m ? 1120 : BW / 2, BH / 2 - (m ? 0 : 20), m ? 190 : 200, !!m);
    if (m) {
      // v2：左邊一段留言（上限依字數，照子句斷行），署名在最後一行下面
      const boxW = 720, boxH = 360;
      const o = { min: Math.ceil(40 / PX), max: Math.floor(msgMaxFor(m.text) / PX), lineHeight: 1.3, maxLines: 6 };
      const sigSize = Math.round(sigV2(o.max * PX) / PX);
      const fit = (this.fit = fitClauses(c, m.text, FAM_MSG, boxW, boxH - sigSize * 1.8, o) ?? fitText(c, m.text, FAM_MSG, boxW, boxH - sigSize * 1.8, o));
      const sg = Math.round(sigV2(fit.size * PX) / PX);
      const total = fit.height + sg * 1.9;
      const x0 = 120;
      const y0 = (BH - total) / 2 + fit.size * 0.86;
      c.font = font(FAM_MSG, fit.size);
      c.fillStyle = rgba('bone', 0.96);
      fit.lines.forEach((ln, i) => fillWithHearts(c, ln, x0, y0 + i * fit.lineHeight));
      c.font = font(FAM_MSG, sg);
      c.fillStyle = rgba('signal', 0.9);
      c.textAlign = 'right';
      c.fillText(this.sig, x0 + Math.max(fit.width, 320), y0 + (fit.lines.length - 1) * fit.lineHeight + sg * 1.8);
      c.textAlign = 'left';
      this.lyrSize = lyricV2(fit.size * PX);
    } else {
      // 沒有留言：花環在正中間，新人的名字與日期在花環下面（配角）；歌詞在下面當主角
      c.textAlign = 'center';
      c.fillStyle = rgba('bone', 0.85);
      c.font = font(F.ming(700), 40);
      c.fillText(COUPLE_ZH, BW / 2, BH - 108);
      c.fillStyle = rgba('ash', 0.8);
      c.font = font(F.mono(500), 18);
      c.letterSpacing = '6px';
      c.fillText(DATE_DOTS, BW / 2, BH - 76);
      c.letterSpacing = '0px';
      c.textAlign = 'left';
      this.lyrSize = lyricV2(null);
    }
    const tx = (this.posterTex = new THREE.CanvasTexture(cv));
    tx.colorSpace = THREE.SRGBColorSpace;
    tx.generateMipmaps = true;
    tx.minFilter = THREE.LinearMipmapLinearFilter;
    tx.anisotropy = 4;
    tx.needsUpdate = true;

    // ---- 拼圖片：每條內部的邊隨機凸或凹（相鄰兩片互補），照閱讀順序排在拍子的格子上
    const vE = Array.from({ length: ROWS }, (_, j) => Array.from({ length: COLS - 1 }, (_, i) => (hash(this.seed, i, j, 1) < 0.5 ? 1 : -1)));
    const hE = Array.from({ length: ROWS - 1 }, (_, j) => Array.from({ length: COLS }, (_, i) => (hash(this.seed, i, j, 2) < 0.5 ? 1 : -1)));
    this.t1 = beatAfter(au, s + Math.min(0.3, B * 0.6));
    const budget = clamp(0.5 * (e - this.t1), 2 * B, 7 * B);
    const grid = onGrid(au, this.t1, N, budget, [2, 4, 8]);
    this.FD = clamp(B * 1.1, 0.35, 0.6);
    const rnd = (k: number, a: number) => hash(this.seed, k, a, 7);
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
      const k = j * COLS + i;
      const tabs: [number, number, number, number] = [
        i < COLS - 1 ? vE[j]![i]! : 0,
        j > 0 ? -hE[j - 1]![i]! : 0,
        i > 0 ? -vE[j]![i - 1]! : 0,
        j < ROWS - 1 ? hE[j]![i]! : 0,
      ];
      // 從哪裡飛進來：畫面外（上下左右）、離桌面很高（靠近鏡頭）
      const a = rnd(k, 1) * TAU;
      const R = 1300 + 700 * rnd(k, 2);
      this.pieces.push({
        i, j, tabs, tl: grid.times[k]!, sx: Math.cos(a) * R, sy: Math.sin(a) * R * 0.7, sz: 700 + 900 * rnd(k, 3),
        rz: (rnd(k, 4) - 0.5) * 4, rx: (rnd(k, 5) - 0.5) * 2.2, ry: (rnd(k, 6) - 0.5) * 2.2, glowT: 0,
      });
    }
    this.tDone = Math.max(...this.pieces.map((p) => p.tl));
    // 拼好之後：每個小節線按一下一片（挑海報右半、花環那一邊的片，不擋留言）；每兩小節一道光掃過
    const bar0 = Math.ceil(au.barAt(this.tDone + B) - 1e-6);
    for (let k = bar0, i = 0; i < 24; k++, i++) {
      const tb = au.timeOfBar(k);
      if (tb > e - B) break;
      const col = COLS / 2 + Math.floor(hash(this.seed, k, 11) * (COLS / 2));
      const row = Math.floor(hash(this.seed, k, 12) * ROWS);
      this.pops.push({ k: row * COLS + col, t: tb });
      if (i % 2 === 0) this.glints.push(tb);
    }
    // 拼好的光：從中間往外一圈一圈
    for (const p of this.pieces) {
      const cx = (p.i + 0.5 - COLS / 2) * CW, cy = (p.j + 0.5 - ROWS / 2) * CH;
      p.glowT = this.tDone + 0.05 + Math.hypot(cx, cy * 1.6) / 1700;
    }

    // ---- 鏡頭：拼圖落定時幾乎正上方往下看，拼圖在畫面上半、下面留給歌詞
    const cam = this.rig.cam;
    const fitB = (o: OrbitCam) => {
      let lo = 800, hi = 6000;
      const ok = (d: number) => {
        applyOrbit(cam, { ...o, dist: d });
        const pts = ([[-BW / 2 - 20, -BH / 2 - 20, 0], [BW / 2 + 20, -BH / 2 - 20, 0], [-BW / 2 - 20, BH / 2 + 20, 0], [BW / 2 + 20, BH / 2 + 20, 0]] as V3[]).map((p) => toScreen(cam, p));
        return pts.every((p) => p.x > 96 && p.x < W - 96 && p.y > 80 && p.y < LYR.y - this.lyrSize - 40);
      };
      for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (ok(mid)) hi = mid; else lo = mid; }
      return { ...o, dist: hi };
    };
    let best: OrbitCam | null = null;
    for (const ty of [-40, -80, -120, -160, -200, -240]) {
      const o = fitB({ tx: 0, ty, tz: 0, dist: 2000, az: 0, el: 1.36, fov: 30 });
      if (!best || o.dist < best.dist) best = o;
    }
    this.camB = best!;
    this.camA = { ...best!, dist: best!.dist * 1.35, az: -0.22, el: 1.05, roll: 0.05, ty: best!.ty + 120 };
  }

  override dispose() {
    this.posterTex?.dispose();
    if (this.posterCv) this.posterCv.width = this.posterCv.height = 0;
    super.dispose();
  }

  /** 花環：一圈手繪的藤（兩條交纏的細線）、交錯的葉子、幾朵五瓣小花，中間是縮寫 A & O 與一顆小愛心（quiet = 有留言，縮寫小而淡）。 */
  private drawWreath(c: CanvasRenderingContext2D, cx: number, cy: number, R: number, quiet = false) {
    c.save();
    c.translate(cx, cy);
    const N = 120;
    for (const [amp, ph, a] of [[9, 0, 0.75], [7, 2.1, 0.5]] as const) {
      c.strokeStyle = rgba('signal', a); c.lineWidth = 1.8;
      c.beginPath();
      for (let i = 0; i <= N; i++) {
        const th = (i / N) * TAU;
        const r = R + amp * Math.sin(th * 7 + ph);
        if (i) c.lineTo(Math.cos(th) * r, Math.sin(th) * r); else c.moveTo(Math.cos(th) * r, Math.sin(th) * r);
      }
      c.stroke();
    }
    // 葉子：沿著圈、內外交錯，方向順著藤
    for (let i = 0; i < 34; i++) {
      const th = (i / 34) * TAU + 0.05;
      const side = i % 2 ? 1 : -1;
      const r = R + side * 16;
      c.save();
      c.translate(Math.cos(th) * r, Math.sin(th) * r);
      c.rotate(th + Math.PI / 2 + side * 0.6);
      c.fillStyle = rgba('signal', 0.42 + 0.2 * hash(this.seed, i, 3));
      c.beginPath(); c.ellipse(0, 0, 15, 5.5, 0, 0, TAU); c.fill();
      c.strokeStyle = rgba('ink', 0.35); c.lineWidth = 0.8;
      c.beginPath(); c.moveTo(-13, 0); c.lineTo(13, 0); c.stroke();
      c.restore();
    }
    // 小花：五瓣、線畫，中心一點
    for (let i = 0; i < 7; i++) {
      const th = (i / 7) * TAU + 0.4 + 0.3 * hash(this.seed, i, 5);
      const x = Math.cos(th) * R, y = Math.sin(th) * R;
      c.strokeStyle = rgba('ember', 0.8); c.lineWidth = 1.4;
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU + th;
        c.beginPath(); c.ellipse(x + Math.cos(a) * 8, y + Math.sin(a) * 8, 7, 4, a, 0, TAU); c.stroke();
      }
      c.fillStyle = rgba('ember', 0.9); c.beginPath(); c.arc(x, y, 2.6, 0, TAU); c.fill();
    }
    // 縮寫：沒有留言時是海報的主圖（大）；有留言時縮小、調淡，不要比留言還搶眼（一格一個焦點）
    const [a1, a2] = COUPLE_EN.split('&').map((x) => x.trim()[0] ?? '');
    c.textAlign = 'center';
    c.fillStyle = rgba('bone', quiet ? 0.6 : 0.92);
    c.font = font(F.serif(600, true), R * (quiet ? 0.3 : 0.62));
    c.fillText(`${a1} & ${a2}`, 0, R * (quiet ? 0.08 : 0.12));
    drawHeart(c, 0, R * (quiet ? 0.28 : 0.42), R * (quiet ? 0.1 : 0.16), rgba('rose', 0.9));
    c.textAlign = 'left';
    c.restore();
  }

  /** 海報的框：細細的雙線、四個角的藤蔓捲、上下中間的小花飾（訊號色的細線）。 */
  private drawFrame(c: CanvasRenderingContext2D) {
    c.save();
    c.strokeStyle = rgba('signal', 0.55); c.lineWidth = 1.6;
    c.strokeRect(34, 34, BW - 68, BH - 68);
    c.strokeStyle = rgba('signal', 0.3); c.lineWidth = 1;
    c.strokeRect(44, 44, BW - 88, BH - 88);
    const curl = (x: number, y: number, sx: number, sy: number) => {
      c.save();
      c.translate(x, y); c.scale(sx, sy);
      c.strokeStyle = rgba('signal', 0.7); c.lineWidth = 2;
      c.beginPath();
      c.moveTo(0, 0); c.bezierCurveTo(60, 0, 110, 20, 130, 60); c.bezierCurveTo(146, 92, 118, 116, 96, 100); c.bezierCurveTo(80, 88, 92, 66, 108, 74);
      c.moveTo(0, 0); c.bezierCurveTo(0, 60, 20, 110, 60, 130); c.bezierCurveTo(92, 146, 116, 118, 100, 96); c.bezierCurveTo(88, 80, 66, 92, 74, 108);
      c.stroke();
      // 葉子
      c.fillStyle = rgba('signal', 0.5);
      for (const [lx, ly, a] of [[70, 12, 0.5], [12, 70, 1.1], [150, 40, -0.4], [40, 150, 2.0]] as const) {
        c.save(); c.translate(lx, ly); c.rotate(a);
        c.beginPath(); c.ellipse(0, 0, 13, 5, 0, 0, TAU); c.fill();
        c.restore();
      }
      c.restore();
    };
    curl(58, 58, 1, 1); curl(BW - 58, 58, -1, 1); curl(58, BH - 58, 1, -1); curl(BW - 58, BH - 58, -1, -1);
    // 上下中間：一條細藤、中間一顆小愛心
    c.strokeStyle = rgba('signal', 0.5); c.lineWidth = 1.5;
    for (const [y, dir] of [[62, 1], [BH - 62, -1]] as const) {
      c.beginPath();
      c.moveTo(BW / 2 - 200, y); c.bezierCurveTo(BW / 2 - 120, y - 16 * dir, BW / 2 - 60, y + 14 * dir, BW / 2 - 22, y);
      c.moveTo(BW / 2 + 200, y); c.bezierCurveTo(BW / 2 + 120, y - 16 * dir, BW / 2 + 60, y + 14 * dir, BW / 2 + 22, y);
      c.stroke();
      drawHeart(c, BW / 2, y, 20, rgba('rose', 0.9));
    }
    c.restore();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const rig = this.rig;
    const A = rig.iA.array as Float32Array, T = rig.iT.array as Float32Array, Bv = rig.iB.array as Float32Array;
    // ---- 每一片的位置：飛行 FD 秒，最後一段減速落下；落下時輕輕壓一下
    const hts: number[] = [];
    const state = this.pieces.map((p) => {
      const u = (t - (p.tl - this.FD)) / this.FD;
      const vis = u <= 0 ? 0 : 1;
      const k = ease.outCubic(clamp(u));
      const kr = ease.outQuart(clamp(u));
      const h = p.sz * (1 - ease.outQuad(clamp(u)));
      const tx = (p.i + 0.5 - COLS / 2) * CW, ty = (ROWS / 2 - p.j - 0.5) * CH;
      let press = pulse(t, p.tl, 0.05);
      // 被按一下的片：小節線翹起來、下一拍落回去（落下那一下壓一壓）
      let hp = 0, tilt = 0;
      for (const po of this.pops) {
        if (this.pieces[po.k] !== p) continue;
        const v = prog(t, po.t, po.t + this.B);
        hp += 55 * Math.sin(Math.PI * v);
        tilt += 0.18 * Math.sin(Math.PI * v) * (hash(po.t) < 0.5 ? 1 : -1);
        press += pulse(t, po.t + this.B, 0.05);
      }
      return { p, vis, x: tx + p.sx * (1 - k), y: ty + p.sy * (1 - k), h: h + hp, rz: p.rz * (1 - kr) + tilt * 0.4, rx: p.rx * (1 - kr) + tilt, ry: p.ry * (1 - kr), sc: 1 - 0.02 * press };
    });
    // 高的（還在空中的）畫在後面，蓋在拼好的上面
    this.order = state.map((_, k) => k).sort((a, b) => state[a]!.h - state[b]!.h || a - b);
    this.order.forEach((k, slot) => {
      const st = state[k]!;
      this.e.set(st.rx, st.ry, st.rz, 'ZXY');
      this.q.setFromEuler(this.e);
      this.m4.compose(this.v.set(st.x, st.y, st.h + 0.5), this.q, this.s3.set(QW * st.sc, QH * st.sc, 1));
      rig.pieces.setMatrixAt(slot, this.m4);
      const blur = clamp(st.h / 70, 0, 12);
      A[slot * 4] = st.p.i; A[slot * 4 + 1] = st.p.j; A[slot * 4 + 2] = blur; A[slot * 4 + 3] = pulse(t, st.p.glowT, 0.22);
      T.set(st.p.tabs, slot * 4);
      Bv[slot * 4] = st.h; Bv[slot * 4 + 1] = st.vis;
      hts.push(st.h);
    });
    rig.pieces.instanceMatrix.needsUpdate = true;
    rig.iA.needsUpdate = true; rig.iT.needsUpdate = true; rig.iB.needsUpdate = true;

    // ---- 鏡頭：斜上方、歪的 → 推近、轉正（拼圖片飛進來的期間）→ 很慢地推近
    const kc = ease.inOutCubic(prog(t, s, Math.max(this.t1 + 2 * this.B, this.tDone - this.B)));
    const cam = lerpOrbit(this.camA, this.camB, kc);
    cam.dist *= 1 - 0.03 * ease.inOutQuad(prog(t, this.tDone, e));
    applyOrbit(rig.cam, cam);

    const pm = rig.pieceMat.uniforms;
    pm.poster!.value = this.posterTex;
    // 光掃過：從左上到右下，一小節走完
    let gx = -9999, ga = 0;
    for (const tg of this.glints) {
      const v = (t - tg) / (this.B * 4);
      if (v >= 0 && v <= 1) { gx = -300 + (BW + BH * 0.6 + 600) * ease.inOutQuad(v); ga = Math.sin(Math.PI * v); }
    }
    (pm.glint!.value as THREE.Vector2).set(gx, ga);
    rig.tableMat.uniforms.poster!.value = this.posterTex;
    (rig.tableMat.uniforms.lamp!.value as THREE.Vector4).set(0, 40, 1500, 0);
    rig.tableMat.uniforms.ghost!.value = 0.07;
    renderer.setRenderTarget(out);
    renderer.render(rig.scene, rig.cam);

    // ---- 歌詞：拼圖墊下面，桌上一行
    const L = this.lyr;
    L.clear();
    this.drawLyricLine(L.ctx, t);
    comp.draw(renderer, L.upload(), out);

    let amp = 0;
    for (const p of this.pieces) amp += 0.9 * pulse(t, p.tl, 0.04);
    for (const po of this.pops) amp += 1.2 * pulse(t, po.t + this.B, 0.04);
    amp = Math.min(amp, 3) + 4 * pulse(t, this.tDone, 0.08);
    const ph = frameIdx(t);
    return { bloom: 0.6, bloomThreshold: 1.1, halation: 0.12, vignette: 0.45, grain: 0.06, shake: [amp * (hash(ph, 1) - 0.5) * 2, amp * (hash(ph, 2) - 0.5) * 2] };
  }

  private drawLyricLine(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    if (!lyrics.has) {
      c.fillStyle = rgba('ash', 0.8);
      c.font = font(F.mono(500), 22);
      c.letterSpacing = '5px';
      c.fillText(`♪ ${song.title}`, LYR.x, LYR.y);
      c.letterSpacing = '0px';
      return;
    }
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const ink = darkInk();
      const st = { family: FAM_LYR, size: this.lyrSize, minSize: 40, maxWidth: LYR.w, active: ink.active, sung: ink.sung, unsung: ink.unsung, lineHeight: 1.1 };
      const lay = layoutLyric(c, ly.line, st);
      c.save();
      // 折成兩行時往上長（基線固定在 LYR.y）
      c.translate(LYR.x, LYR.y - (lay.rows.length - 1) * lay.size * 1.1);
      drawLyric(c, ly.line, t, st, lay, ly.k);
      c.restore();
    }
    if (!this.msg) {
      c.fillStyle = rgba('ash', 0.7);
      c.font = font(F.hei(500), 20);
      c.letterSpacing = '3px';
      c.fillText(T17_INVITE, LYR.x, LYR.y + 44);
      c.letterSpacing = '0px';
    }
  }
}
