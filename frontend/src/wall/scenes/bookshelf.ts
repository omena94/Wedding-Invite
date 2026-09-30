// 書架（暗）：夜裡的書房，一盞檯燈斜斜地照著一排書背。兩個鏡頭：
//  1. 書架：鏡頭貼著書架慢慢橫移（有一點仰角），書脊是皮面、燙金的細線；每個拍點有一本書被抽出來一點點、再慢慢推回去
//     （小節線上兩本）。主打留言的那本書（書背燙金「祝福 No.042」）在小節線被整本抽出來、書頂往鏡頭傾。
//     歌詞印在書架前緣的一條標籤上（逐字跟唱）。
//  2. 在下一拍切到書桌：那本書攤開在燈下，右頁先蓋著扉頁（「第 42 則祝福」），拍點上一頁翻過去（翻頁有弧度、落在拍點），
//     露出右頁的主打留言（思源宋體，最大、最深的墨）與署名；翻過來的左頁是「現場歌詞」（逐字跟唱）。鏡頭慢慢推近右頁。
//  - 沒有留言：只有書架的鏡頭。每一句歌詞各是一本厚書：那一句開始前被抽出來一半，歌詞直直地燙在書背上（中文直書、英文橫躺），
//    逐字跟唱（正在唱的字是燙金發亮），鏡頭橫移到那本書；上一本推回去。純音樂又沒有留言：抽出來的書背是新人的名字，
//    書架標籤是邀請。
//  - 很短的窗格（不到三個半小節）有留言時直接從書桌開始，第一拍就翻頁。
// v2（留言尺寸標準 v2）：書桌的鏡頭拉遠、壓低一點，看得到桌子後面的書架（在焦外、暗暗的，書照樣在拍點上被抽出來、推回去，
// 燙金一閃一閃；主打那本書的位置空了一格）。攤開的書在畫面中間偏左（書是道具，可以大），右頁的留言 40～60 px（留言區約 400 × 330），
// 左頁的歌詞比留言小一點；一條緞帶書籤從書溝垂到桌上，跟著拍子晃、翻頁時被甩一下。右下角（HUD）是暗的桌面。
// 書架鏡頭的標籤、書背上的歌詞也照 v2 的字級（40～52 px）。
// 手法：three.js（自己寫的 shader：皮面、燙金的反光、紙頁、木頭，都吃同一盞檯燈的聚光）。書背的圖案在 init() 畫成一張圖集
//（遮罩：燙金線、書名、皮標），顏色由色票決定；會變的字（書背的歌詞、標籤、左頁）是小的 Canvas 圖層。翻頁的那一張紙每格算一次頂點。
// 書桌後面的書架：同一個書架場景用另一個鏡頭畫進四分之一解析度的 render target，再模糊貼滿畫面，書桌畫在上面。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, clearRT, makeRT, W, H } from '../engine/gl';
import { GLSL_COMMON, THEME_UNIFORMS } from '../engine/glsl/common';
import { F, font } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, prog, hash, mulberry32, lerp, pulse } from '../engine/util';
import { Lyrics, type Line } from '../engine/lyrics';
import { lyricAt, lyricSubOf, subSizeFor, COUPLE_ZH } from './_motifs';
import { grid, layoutRows, drawRows, paperInk, type Grid, type RowsLayout } from './_t4';
import { loadAll, block, glyphPath, T21_INVITE, type Block, type Rect } from './_t21';
import { V2, lyricV2 } from './_v2';

/** 桌子後面的書架（低解析度畫好的）：圓盤取樣模糊（焦外），整體壓暗一點（燈只照得到桌上）。 */
const BG_BLUR = () => new FSPass(/* glsl */ `
  uniform sampler2D tex; uniform vec2 px; uniform float dim;
  void main() {
    vec3 s = vec3(0.0);
    for (int i = 0; i < 16; i++) {
      float a = float(i) * 2.39996, r = sqrt((float(i) + 0.5) / 16.0);
      s += texture(tex, vUv + vec2(cos(a), sin(a)) * r * px * 3.2).rgb;
    }
    fragColor = vec4(s / 16.0 * dim, 1.0);
  }`, { tex: { value: null }, px: { value: new THREE.Vector2(4 / W, 4 / H) }, dim: { value: 0.8 } });

/** 幾個世界座標點（兩個對角）在畫面上的外框（給 popupAvoid）。 */
function projRect(cam: THREE.Camera, [a, b]: [number, number, number][]): Rect {
  const ps = [[a[0], a[1]], [b[0], a[1]], [a[0], b[1]], [b[0], b[1]]].map(([x, y]) => new THREE.Vector3(x!, y!, a[2]!).project(cam));
  const xs = ps.map((v) => (v.x * 0.5 + 0.5) * W), ys = ps.map((v) => (0.5 - v.y * 0.5) * H);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return [Math.round(x0), Math.round(y0), Math.round(Math.max(...xs) - x0), Math.round(Math.max(...ys) - y0)];
}

export const spec: PlateSpecDecl = { group: 'type', family: 'print', paper: false, energy: [0.1, 0.75], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 共用的 shader 片段
const VERT = /* glsl */ `
precision highp float;
in vec3 position; in vec3 normal; in vec2 uv;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
out vec3 vW; out vec3 vN; out vec2 vUv; out vec3 vL;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vUv = uv; vL = position;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
/** 檯燈：位置、照向的點、顏色；聚光的圈；環境光很暗。 */
const LAMP = /* glsl */ `
uniform vec3 cameraPosition;
uniform vec3 lampPos; uniform vec3 lampAim; uniform vec3 lampCol; uniform float amb; uniform vec2 cone;
vec3 lit(vec3 P, vec3 N, vec3 base, float gloss, float shin) {
  vec3 L = lampPos - P; float d = length(L); L /= d;
  float fall = 1.0 / (1.0 + pow(d / 1700.0, 2.0));
  float spot = smoothstep(cone.x, cone.y, dot(-L, normalize(lampAim - lampPos)));
  float dif = max(dot(N, L), 0.0);
  vec3 V = normalize(cameraPosition - P), Hh = normalize(L + V);
  float sp = pow(max(dot(N, Hh), 0.0), shin);
  return base * (amb + dif * fall * spot * lampCol * 2.4) + lampCol * sp * fall * spot * gloss;
}`;
const HEAD = (extra = '') => `precision highp float;\nprecision highp int;\nin vec3 vW; in vec3 vN; in vec2 vUv; in vec3 vL;\nout vec4 fragColor;\n${GLSL_COMMON}\n${LAMP}\n${extra}`;

/** 書：書背（+z）取圖集＋會變的字；上下是書頁（奶油色細紋），左右是封面板。 */
const BOOK_FRAG = HEAD() + /* glsl */ `
uniform vec3 cover; uniform vec4 cell; uniform sampler2D atlas; uniform sampler2D dyn; uniform float useDyn; uniform vec3 size;
void main() {
  vec3 N = normalize(vN);
  vec3 base = cover; float gloss = 0.12, shin = 24.0, glow = 0.0;
  // 書與書之間、靠近書架板、上一層板子底下都比較暗（假的環境光遮蔽）
  float ao = (0.55 + 0.45 * smoothstep(0.0, 150.0, vW.y)) * (1.0 - 0.35 * smoothstep(560.0, 820.0, vW.y));
  vec3 foilC = mix(C_SIGNAL, C_EMBER, 0.25);
  if (vN.z > 0.5) {
    vec4 m = texture(atlas, cell.xy + vec2(vUv.x, 1.0 - vUv.y) * cell.zw);
    // 書背是圓的：兩側暗一點；皮面的細紋
    float round = 0.72 + 0.28 * sin(3.14159 * vUv.x);
    base = cover * round * (0.92 + 0.08 * snoise(vW.xy / 7.0));
    base = mix(base, cover * 1.6 + C_BONE * 0.03, m.b);           // 皮標（淺一點的一塊）
    float foil = max(m.r, m.g);
    base = mix(base, foilC * 0.28, foil);
    gloss = mix(0.12, 1.5, foil); shin = mix(24.0, 70.0, foil);
    // 圓的書背：法向量往兩側彎（反光才會是一條直的高光）
    N = normalize(vec3((vUv.x - 0.5) * 1.2, 0.0, 1.0));
    if (useDyn > 0.5) {
      vec4 d = fastLayer(texture(dyn, vUv));
      base = base * (1.0 - d.a) + d.rgb * 0.5;
      glow = 1.0;
      fragColor = vec4(lit(vW, N, base * ao, gloss, shin) + d.rgb * 0.55, 1.0);
      return;
    }
  } else if (abs(vN.y) > 0.5) {
    float edge = step(size.x * 0.5 - 5.0, abs(vL.x)) + step(size.z * 0.5 - 6.0, -vL.z);
    vec3 pages = mix(C_PAPER, C_BONE, 0.4) * 0.5 * (0.85 + 0.15 * sin(vL.x * 2.7));
    base = mix(pages, cover, clamp(edge, 0.0, 1.0));
    gloss = 0.05;
  } else {
    base = cover * 0.85;
  }
  fragColor = vec4(lit(vW, N, base * ao, gloss, shin), 1.0);
}`;

/** 木頭（書架板、背板、書桌）：沿 x 的木紋。k = 深淺。 */
const WOOD_FRAG = HEAD() + /* glsl */ `
uniform float k; uniform sampler2D lbl; uniform vec4 lblRect; uniform float lblOn;
void main() {
  vec3 N = normalize(vN);
  vec2 q = abs(N.z) > 0.5 ? vW.xy : abs(N.y) > 0.5 ? vW.xz : vW.zy;
  float g = fbm(vec2(q.x / 900.0, q.y / 60.0), 3);
  float ring = sin((q.y + 90.0 * g) / 9.0);
  vec3 base = mix(C_INK2, mix(C_SEPIA, C_BLOOD, 0.25), 0.55 + 0.1 * g) * k * (0.85 + 0.06 * ring + 0.1 * snoise(vec2(q.x / 40.0, q.y / 2.0)));
  vec3 col = lit(vW, N, base, 0.15, 30.0);
  // 書架前緣的標籤（一條奶油色的紙，字是會變的圖層）
  if (lblOn > 0.5 && N.z > 0.5) {
    vec2 u = (vW.xy - lblRect.xy) / lblRect.zw;
    if (u.x > 0.0 && u.x < 1.0 && u.y > 0.0 && u.y < 1.0) {
      vec3 pap = mix(C_PAPER, C_BONE, 0.3) * 0.7;
      vec4 d = fastLayer(texture(lbl, u));
      vec3 lc = pap * (1.0 - d.a) + d.rgb;
      col = lit(vW, N, lc, 0.1, 20.0);
    }
  }
  fragColor = vec4(col, 1.0);
}`;

/** 書頁：紙面貼圖（render target 或畫布）、書溝的陰影、紙的弧度；flipU：背面的圖左右對調。 */
const PAGE_FRAG = HEAD() + /* glsl */ `
uniform sampler2D tex; uniform float flipU; uniform float gutterX; uniform float nSign;
void main() {
  vec3 N = normalize(vN) * nSign * (gl_FrontFacing ? 1.0 : -1.0);
  vec2 u = vec2(flipU > 0.5 ? 1.0 - vUv.x : vUv.x, vUv.y);
  vec3 base = texture(tex, u).rgb;
  float g = abs(vW.x - gutterX);
  base *= 1.0 - 0.45 * exp(-g / 38.0);
  fragColor = vec4(lit(vW, N, base, 0.04, 12.0), 1.0);
}`;

/** 單色的東西（書殼、書頁的側面）：lines = 1 時畫頁緣的細紋。 */
const SOLID_FRAG = HEAD() + /* glsl */ `
uniform vec3 col; uniform float lines;
void main() {
  vec3 N = normalize(vN);
  vec3 base = col * (lines > 0.5 && abs(N.z) < 0.5 ? 0.85 + 0.15 * sin(vW.z * 3.1) : 1.0);
  fragColor = vec4(lit(vW, N, base, 0.05, 16.0), 1.0);
}`;

// ---------------------------------------------------------------- 尺寸
const SHELF_Y = 0;
const BOARD_H = 96;
/** 書頁（書桌鏡頭）：一頁的寬、高。 */
const PGW = 600, PGH = 820, PRES = 1.4;
const FAM_MSG = F.ming(700);
const FAM_LYR = F.hand(700);
const DYN_W = 150, DYN_H = 760;
/** 書架鏡頭：書架 1 單位在螢幕上約幾 px（鏡頭離書背約 1500；v2 的字級換算）。 */
const SHELF_K = 1.15;
/** 書桌的後緣（世界 y）：再過去就是焦外的書架。 */
const DESK_BACK = PGH / 2 + 15 + 260;
/** 書不是對齊桌邊放的：桌子轉一個角度，桌子後緣在畫面上斜斜的，右上方露出比較多焦外的書架。 */
const DESK_ROT = -0.3;

interface Book { x: number; w: number; h: number; d: number; cover: THREE.Vector3; cell: [number, number, number, number]; mesh: THREE.Mesh; mat: THREE.RawShaderMaterial; role: 'plain' | 'main' | 'lyric' | 'names'; line: Line | null; tOut: number; tIn: number }

export default class Bookshelf extends Scene {
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 61 + (this.msg?.id ?? 0) * 19) >>> 0;
  g!: Grid;
  // ---- 書架
  shelf = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(34, W / H, 10, 20000);
  books: Book[] = [];
  atlas: THREE.DataTexture | null = null;
  /** 書背上的歌詞（現在與上一句各一張）、書架標籤。 */
  dynA = this.track(new Layer2D(DYN_W, DYN_H, undefined, { fast: true }));
  dynB = this.track(new Layer2D(DYN_W, DYN_H, undefined, { fast: true }));
  label = this.track(new Layer2D(820, 72, undefined, { fast: true }));
  boardMat!: THREE.RawShaderMaterial;
  labelRect = new THREE.Vector4(0, 0, 820, 72);
  // ---- 書桌
  desk = new THREE.Scene();
  cam2 = new THREE.PerspectiveCamera(30, W / H, 10, 20000);
  leftRT = this.track(makeRT(PGW * PRES, PGH * PRES, { depthBuffer: false }));
  leftDyn = this.track(new Layer2D(PGW, PGH, undefined, { fast: true }));
  pageTex: THREE.CanvasTexture[] = [];
  flipGeo: THREE.PlaneGeometry | null = null;
  flipBase: Float32Array | null = null;
  block: Block | null = null;
  /** 書桌後面焦外的書架：低解析度的 render target 與模糊。 */
  bgRT = this.track(makeRT(W / 4, H / 4));
  blur = shared('bookshelf.bgblur', BG_BLUR);
  /** 緞帶書籤（從書溝垂到桌上，每格算頂點）。 */
  ribbonGeo: THREE.PlaneGeometry | null = null;
  /** 右頁在螢幕上的倍數（頁面 px × K = 螢幕 px）。 */
  K = 0.8;
  // ---- 時間
  bookShot = false;
  tPull = Infinity; tCut = Infinity; tFlip = Infinity; flipDur = 0.55;
  hasLyrics = false;
  lyrSize = 52;
  /** 書架標籤上歌詞的字級（世界單位）。 */
  labelSize = 40;
  /** 翻過去的那一頁彈一下的時間（小節線）。 */
  springs: number[] = [];
  private owned3: { dispose(): void }[] = [];
  private U = {
    lampPos: { value: new THREE.Vector3() }, lampAim: { value: new THREE.Vector3() }, lampCol: { value: new THREE.Vector3() },
    amb: { value: 0.12 }, cone: { value: new THREE.Vector2(0.72, 0.93) },
  };

  private mat(frag: string, u: Record<string, THREE.IUniform>, o: Partial<THREE.ShaderMaterialParameters> = {}) {
    const m = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: frag, uniforms: { ...THEME_UNIFORMS, ...this.U, ...u }, ...o });
    this.owned3.push(m);
    return m;
  }
  private mesh(geo: THREE.BufferGeometry, m: THREE.Material, scene: THREE.Scene) {
    this.owned3.push(geo);
    const x = new THREE.Mesh(geo, m);
    x.frustumCulled = false;
    scene.add(x);
    return x;
  }

  override async init() {
    const { audio: au, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    await loadAll(this.ctx, `祝福第則扉頁現場歌詞賓客留言集今天我們結婚了愛的練習曲早餐研究遛狗日誌羽球入門兩人份食譜晚安故事集我們的旅行${COUPLE_ZH}`);
    const g = (this.g = grid(au, s, e));
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
    this.buildShelf();
    if (m) {
      this.flipDur = clamp(g.beat * 1.1, 0.4, 0.7);
      if (g.nBars < 3.5) {
        // 短窗格：直接從書桌開始，一開始就翻頁（落在第一個來得及的拍點）
        this.bookShot = true;
        this.tCut = s; this.tFlip = au.timeOfBeat(Math.ceil(au.beatAt(s + this.flipDur + 0.1) - 1e-6));
      } else {
        this.tPull = g.bars.find((b) => b >= s + g.beat * 1.4) ?? au.timeOfBeat(au.beatAt(s) + 2);
        if (this.tPull > s + 0.3 * (e - s)) this.tPull = au.timeOfBeat(au.beatAt(s) + 2);
        this.tCut = au.timeOfBeat(Math.ceil(au.beatAt(this.tPull + 0.45) - 1e-6));
        this.tFlip = au.timeOfBeat(au.beatAt(this.tCut) + 1);
      }
      // 右頁在螢幕上的倍數：量翻頁之後、窗格中段的鏡頭下，右頁的字框在畫面上多寬
      this.deskPose(lerp(Math.min(this.tFlip, e), e, 0.5));
      const yM = PGH / 2 - PGH * 0.45;
      const a = new THREE.Vector3(50, yM, this.pageZ(50)).project(this.cam2), b = new THREE.Vector3(PGW - 50, yM, this.pageZ(PGW - 50)).project(this.cam2);
      this.K = clamp(((b.x - a.x) * W) / 2 / (PGW - 100), 0.4, 1.5);
      this.buildDesk();
      for (const b of g.bars) if (b > this.tFlip + g.bar * 0.9 && b < e - g.beat && Math.round((b - this.tFlip) / g.bar) % 2 === 1) this.springs.push(b);
      this.lyrSize = lyricV2(this.block ? this.block.fit.size * this.K : null) / this.K;
    }
    // 書架標籤上的歌詞：有留言時比留言小一點（留言在書桌那一段才出現，先照一般長度估）
    this.labelSize = lyricV2(m ? Math.min(52, this.block ? this.block.fit.size * this.K : 50) : null) / SHELF_K;
  }

  // ------------------------------------------------------------ 書架
  private buildShelf() {
    const rnd = mulberry32(this.seed);
    const { lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    // 書：從 x = -2400 排到 2400；特別的書（主打、歌詞、名字）放在鏡頭會經過的地方
    const lines = this.msg ? [] : lyrics.linesIn(s - 0.3, e).slice(0, 6);
    const special = new Map<number, { role: Book['role']; line: Line | null }>();
    const N = 44;
    const mid = 20;
    if (this.msg) special.set(mid, { role: 'main', line: null });
    else if (lines.length) lines.forEach((ln, i) => special.set(mid - 4 + i * 4, { role: 'lyric', line: ln }));
    else special.set(mid, { role: 'names', line: null });
    const covers = [
      () => LIN.ink2.map((v) => v * 2.6), () => LIN.blood.map((v) => v * 0.55), () => LIN.sepia.map((v) => v * 1.5),
      () => LIN.graphite.map((v) => v * 0.35), () => LIN.blood.map((v, i) => v * 0.3 + LIN.sepia[i]! * 0.5), () => LIN.signal.map((v) => v * 0.16),
    ];
    // 圖集：一格一本書背（遮罩 R = 燙金線、G = 書名、B = 皮標）
    const AW = 2048, AH = 2400;
    const cv = [0, 1, 2].map(() => { const c = document.createElement('canvas'); c.width = AW; c.height = AH; const x = c.getContext('2d', { willReadFrequently: true })!; x.fillStyle = '#fff'; x.strokeStyle = '#fff'; x.textBaseline = 'alphabetic'; return x; });
    const TITLES = ['愛的練習曲', '早餐研究', '遛狗日誌', '羽球入門', '兩人份食譜', '晚安故事集', '我們的旅行'];
    let ti = Math.floor(rnd() * TITLES.length);
    let ax = 0, ay = 0, x = -2450;
    for (let i = 0; i < N; i++) {
      const sp = special.get(i);
      const w = sp ? DYN_W : 56 + Math.round(rnd() * 70), h = sp ? DYN_H : 560 + Math.round(rnd() * 180), d = 440 + Math.round(rnd() * 60);
      if (ax + w > AW) { ax = 0; ay += 800; }
      const cell: [number, number, number, number] = [ax / AW, ay / AH, w / AW, h / AH];
      // 書背的圖案
      const [cf, ct, cl] = cv as [CanvasRenderingContext2D, CanvasRenderingContext2D, CanvasRenderingContext2D];
      const bands = 1 + Math.floor(rnd() * 3);
      for (let b = 0; b < bands; b++) {
        const y0 = ay + 40 + b * 12, y1 = ay + h - 52 - b * 12;
        cf.fillRect(ax + 6, y0, w - 12, 2.5); cf.fillRect(ax + 6, y1, w - 12, 2.5);
      }
      if (sp?.role === 'main') {
        cl.fillRect(ax + 16, ay + 150, w - 32, 300);
        ct.font = font(F.ming(900), 64); ct.textAlign = 'center';
        ct.fillText('祝', ax + w / 2, ay + 260); ct.fillText('福', ax + w / 2, ay + 340);
        ct.font = font(F.mono(500), 22); ct.fillText(`No.${String(this.msg!.n).padStart(3, '0')}`, ax + w / 2, ay + 420);
        ct.textAlign = 'left';
      } else if (!sp && rnd() < 0.2) {
        // 少數幾本有書名（小、燙金、直的）：背景要能呼吸，不要每本都有字；書名輪流用，不重複
        const tt = TITLES[ti++ % TITLES.length]!;
        const size = Math.min(26, w * 0.42);
        ct.font = font(F.ming(700), size); ct.textAlign = 'center';
        Array.from(tt).forEach((ch, k) => ct.fillText(ch, ax + w / 2, ay + 120 + k * size * 1.15));
        ct.textAlign = 'left';
      } else if (!sp && rnd() < 0.4) {
        cl.fillRect(ax + 10, ay + 110, w - 20, 90 + rnd() * 60);
      }
      const cover = new THREE.Vector3(...(covers[Math.floor(rnd() * covers.length)]!()) as [number, number, number]);
      const mat = this.mat(BOOK_FRAG, {
        cover: { value: cover }, cell: { value: new THREE.Vector4(...cell) }, atlas: { value: null }, dyn: { value: null },
        useDyn: { value: 0 }, size: { value: new THREE.Vector3(w, h, d) },
      });
      const mesh = this.mesh(new THREE.BoxGeometry(w, h, d), mat, this.shelf);
      const lean = !sp && rnd() < 0.06 ? (rnd() - 0.5) * 0.12 : 0;
      mesh.position.set(x + w / 2, SHELF_Y + h / 2, -d / 2 + (rnd() - 0.5) * 10);
      mesh.rotation.z = lean;
      this.books.push({ x: x + w / 2, w, h, d, cover, cell, mesh, mat, role: sp?.role ?? 'plain', line: sp?.line ?? null, tOut: Infinity, tIn: Infinity });
      x += w + 2 + Math.round(rnd() * 5);
      ax += w + 4;
    }
    const data = cv.map((c) => c.getImageData(0, 0, AW, AH).data);
    const out = new Uint8Array(AW * AH * 4);
    for (let i = 0; i < out.length; i += 4) { out[i] = data[0]![i + 3]!; out[i + 1] = data[1]![i + 3]!; out[i + 2] = data[2]![i + 3]!; out[i + 3] = 255; }
    for (const c of cv) c.canvas.width = c.canvas.height = 0;
    const tex = new THREE.DataTexture(out, AW, AH, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = true; tex.needsUpdate = true;
    this.atlas = this.track(tex);
    for (const b of this.books) b.mat.uniforms.atlas!.value = tex;
    // 歌詞的書：那一句開始前 0.45 秒抽出來，下一本抽出來時推回去
    const lb = this.books.filter((b) => b.role === 'lyric');
    lb.forEach((b, i) => { b.tOut = b.line!.start - 0.45; b.tIn = lb[i + 1] ? lb[i + 1]!.tOut + 0.1 : Infinity; });
    const nb = this.books.find((b) => b.role === 'names');
    if (nb) nb.tOut = this.g.b0 - 0.2;
    // 書架板（前緣有標籤）、背板、上一層的板子
    this.boardMat = this.mat(WOOD_FRAG, { k: { value: 1 }, lbl: { value: null }, lblRect: { value: this.labelRect }, lblOn: { value: 1 } });
    const board = this.mesh(new THREE.BoxGeometry(5400, BOARD_H, 620), this.boardMat, this.shelf);
    board.position.set(0, SHELF_Y - BOARD_H / 2, -290);
    const back = this.mesh(new THREE.PlaneGeometry(5400, 2000), this.mat(WOOD_FRAG, { k: { value: 0.45 }, lbl: { value: null }, lblRect: { value: new THREE.Vector4() }, lblOn: { value: 0 } }), this.shelf);
    back.position.set(0, 500, -560);
    const top = this.mesh(new THREE.BoxGeometry(5400, BOARD_H, 620), this.mat(WOOD_FRAG, { k: { value: 0.7 }, lbl: { value: null }, lblRect: { value: new THREE.Vector4() }, lblOn: { value: 0 } }), this.shelf);
    top.position.set(0, SHELF_Y + 880, -290);
  }

  // ------------------------------------------------------------ 書桌
  private buildDesk() {
    const m = this.msg!;
    const mk = () => {
      const cv = document.createElement('canvas');
      cv.width = Math.round(PGW * PRES); cv.height = Math.round(PGH * PRES);
      const c = cv.getContext('2d')!;
      c.scale(PRES, PRES); c.textBaseline = 'alphabetic';
      c.fillStyle = rgba('paper'); c.fillRect(0, 0, PGW, PGH);
      // 紙的邊緣暗一點（舊書）
      const gr = c.createRadialGradient(PGW / 2, PGH / 2, PGH * 0.3, PGW / 2, PGH / 2, PGH * 0.75);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, rgba('sepia', 0.1));
      c.fillStyle = gr; c.fillRect(0, 0, PGW, PGH);
      return { cv, c };
    };
    const head = (c: CanvasRenderingContext2D, text: string, y = 70) => {
      c.font = font(F.hei(500), 16); c.letterSpacing = '6px'; c.textAlign = 'center'; c.fillStyle = rgba('sepia', 0.55);
      c.fillText(text, PGW / 2, y); c.letterSpacing = '0px'; c.textAlign = 'left';
    };
    const tex = (cv: HTMLCanvasElement) => {
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.anisotropy = 4;
      this.pageTex.push(t); this.track(t);
      return t;
    };
    const no = `No.${String(m.n).padStart(3, '0')}`;
    // 右頁：主打留言
    const R = mk();
    // 頁碼放在書眉（頁腳的位置在畫面右下角，會跟 QR 區重疊）
    head(R.c, `祝 福 · 賓 客 留 言 集 · ${no}`);
    // 留言照 v2 的字級（頁面 px × K = 螢幕 px）
    const b = (this.block = block(R.c, m, FAM_MSG, { x: 50, y: 130, w: PGW - 100, h: PGH - 250 }, { align: 'left', sigFamily: FAM_MSG, lineHeight: 1.36, maxLines: 8, valign: 0.4, v2: this.K }));
    R.c.fillStyle = rgba('sepia');
    for (const ln of b.lines) {
      R.c.font = font(FAM_MSG, b.fit.size);
      let xx = ln.x;
      for (const ch of Array.from(ln.text)) {
        const w = R.c.measureText(ch).width;
        R.c.fillStyle = ch === '♥' ? rgba('rose') : rgba('sepia');
        glyphPath(R.c, { ch, x: xx, y: ln.y, w, size: b.fit.size, family: FAM_MSG });
        xx += w;
      }
    }
    R.c.font = font(FAM_MSG, b.sig.size); R.c.fillStyle = rgba('sepia', 0.75); R.c.fillText(b.sig.text, b.sig.x, b.sig.y);
    if (m.couple) head(R.c, 'FROM THE COUPLE · 新人', 108);
    // 左頁（翻過來的那一頁的背面）：現場歌詞（字是每格畫的圖層）
    const Lp = mk();
    head(Lp.c, '現 場 歌 詞');
    Lp.c.strokeStyle = rgba('sepia', 0.4); Lp.c.lineWidth = 1.2;
    Lp.c.beginPath(); Lp.c.moveTo(PGW / 2 - 60, 110); Lp.c.lineTo(PGW / 2 + 60, 110); Lp.c.stroke();
    Lp.c.font = font(F.mono(400), 16); Lp.c.textAlign = 'center'; Lp.c.fillStyle = rgba('sepia', 0.5); Lp.c.fillText('— ♪ —', PGW / 2, PGH - 50); Lp.c.textAlign = 'left';
    // 扉頁（翻頁的正面）與翻開之前的左頁
    const T = mk();
    T.c.font = font(F.ming(700), 46); T.c.textAlign = 'center'; T.c.fillStyle = rgba('sepia', 0.9);
    T.c.fillText(`第 ${m.n} 則祝福`, PGW / 2, PGH * 0.42);
    T.c.strokeStyle = rgba('sepia', 0.5); T.c.lineWidth = 1.2;
    T.c.beginPath(); T.c.moveTo(PGW / 2 - 40, PGH * 0.42 + 40); T.c.lineTo(PGW / 2 + 40, PGH * 0.42 + 40); T.c.stroke();
    T.c.font = font(F.hei(500), 18); T.c.fillStyle = rgba('sepia', 0.55); T.c.fillText(COUPLE_ZH, PGW / 2, PGH * 0.42 + 90); T.c.textAlign = 'left';
    const P0 = mk();
    head(P0.c, '祝 福 · 賓 客 留 言 集');
    const tR = tex(R.cv), tL = tex(Lp.cv), tT = tex(T.cv), tP = tex(P0.cv);
    this.leftBase = tL;
    // ---- 桌面、書殼、書頁
    const deskM = this.mat(WOOD_FRAG, { k: { value: 0.75 }, lbl: { value: null }, lblRect: { value: new THREE.Vector4() }, lblOn: { value: 0 } });
    // 桌面到 DESK_BACK 為止（再過去是焦外的書架）；後緣一條厚度（燈照到的木頭邊）
    const onDesk = (m: THREE.Mesh, y: number, z: number) => {
      m.position.set(-y * Math.sin(DESK_ROT), y * Math.cos(DESK_ROT), z);
      m.rotation.z = DESK_ROT;
    };
    onDesk(this.mesh(new THREE.PlaneGeometry(9000, 4000), deskM, this.desk), DESK_BACK - 2000, -2);
    onDesk(this.mesh(new THREE.BoxGeometry(9000, 16, 40), deskM, this.desk), DESK_BACK - 8, -22);
    // 緞帶書籤：一條細長的布，從書溝上緣夾進去、從下緣垂出來落在桌上（頂點每格算）
    const rg = (this.ribbonGeo = new THREE.PlaneGeometry(1, 1, 1, 24));
    const ribbonM = this.mat(SOLID_FRAG, { col: { value: new THREE.Vector3(...LIN.blood.map((v, i) => v * 0.7 + LIN.signal[i]! * 0.25) as [number, number, number]) }, lines: { value: 0 } }, { side: THREE.DoubleSide });
    this.mesh(rg, ribbonM, this.desk).renderOrder = 3;
    // 書殼（布面的封面板）與兩疊書頁（看得到厚度與頁緣的細紋）
    const shell = this.mesh(new THREE.BoxGeometry(2 * PGW + 36, PGH + 30, 10), this.mat(SOLID_FRAG, { col: { value: new THREE.Vector3(...LIN.blood.map((v, i) => v * 0.45 + LIN.ink2[i]! * 0.8) as [number, number, number]) }, lines: { value: 0 } }), this.desk);
    shell.position.set(0, 0, 3);
    for (const sd of [-1, 1]) {
      const pb = this.mesh(new THREE.BoxGeometry(PGW - 14, PGH - 6, 22), this.mat(SOLID_FRAG, { col: { value: new THREE.Vector3(...LIN.paper.map((v) => v * 0.8) as [number, number, number]) }, lines: { value: 1 } }), this.desk);
      pb.position.set(sd * (PGW / 2 + 6), 0, 8 + 11);
    }
    const page = (tx: THREE.Texture, side: -1 | 1, flipU: number) => {
      const geo = new THREE.PlaneGeometry(PGW, PGH, 40, 1);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i) / PGW + 0.5; // 0 = 書溝那邊（side 決定往左還是往右）
        const X = side * u * PGW;
        pos.setXYZ(i, X, pos.getY(i), this.pageZ(u * PGW));
      }
      geo.computeVertexNormals();
      const mt = this.mat(PAGE_FRAG, { tex: { value: tx }, flipU: { value: flipU }, gutterX: { value: 0 }, nSign: { value: 1 } }, { side: THREE.DoubleSide });
      return this.mesh(geo, mt, this.desk);
    };
    // 左頁：u = 0 在書溝（x = 0）、往左到 -PGW；貼圖的右緣是書溝，所以左右對調
    page(tP, -1, 1).renderOrder = 1;
    page(tR, 1, 0).renderOrder = 1;
    // 翻的那一頁：正面扉頁、背面現場歌詞（每格更新頂點）
    const fg = (this.flipGeo = new THREE.PlaneGeometry(PGW, PGH, 40, 1));
    this.owned3.push(fg);
    const fp = fg.attributes.position as THREE.BufferAttribute;
    this.flipBase = new Float32Array(fp.count * 2);
    for (let i = 0; i < fp.count; i++) { this.flipBase[i * 2] = fp.getX(i) + PGW / 2; this.flipBase[i * 2 + 1] = fp.getY(i); }
    const front = new THREE.Mesh(fg, this.mat(PAGE_FRAG, { tex: { value: tT }, flipU: { value: 0 }, gutterX: { value: 0 }, nSign: { value: 1 } }, { side: THREE.FrontSide }));
    const backM = this.mat(PAGE_FRAG, { tex: { value: this.leftRT.texture }, flipU: { value: 1 }, gutterX: { value: 0 }, nSign: { value: -1 } }, { side: THREE.BackSide });
    const back = new THREE.Mesh(fg, backM);
    for (const q of [front, back]) { q.frustumCulled = false; q.renderOrder = 2; this.desk.add(q); }
  }
  leftBase: THREE.Texture | null = null;

  /** 書頁離桌面的高度：書溝那邊往下凹、中間鼓起來、外緣微微往下。 */
  private pageZ(x: number) {
    const u = x / PGW;
    return 16 + 30 * Math.sin(Math.min(1, x / 150) * Math.PI / 2) - 10 * u * u;
  }

  /** 翻頁的頂點：φ 從 0（躺在右邊）到 π（躺在左邊），外側比較慢（紙的弧度）。 */
  private flipPage(phi: number) {
    const geo = this.flipGeo!, base = this.flipBase!;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 2]!, y = base[i * 2 + 1]!;
      const u = x / PGW;
      // 外側落後一點（翻到一半時紙是彎的）；躺平時貼著書頁的弧度
      const a = phi - 0.5 * Math.sin(phi) * u * u;
      // 躺平時貼著書頁的弧度；立起來時從書溝的高度長出去
      const z0 = lerp(this.pageZ(0), this.pageZ(x), Math.abs(Math.cos(a))) + 1.2;
      pos.setXYZ(i, x * Math.cos(a), y, z0 + x * Math.sin(a));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }

  // ------------------------------------------------------------ 每格
  /** 書架上書的位置：拍點上隨機一本抽出來一點點（小節線上兩本）；主打的在小節線整本抽出來；歌詞的書抽出來一半。 */
  private moveBooks(t: number, amp = 1) {
    const au = this.ctx.audio;
    const beatNow = Math.floor(au.beatAt(t));
    for (const [i, b] of this.books.entries()) {
      let z = 0, tilt = 0;
      if (b.role === 'plain') {
        for (let k = 0; k < 3; k++) {
          const bi = beatNow - k;
          const pick = Math.floor(hash(this.seed, bi) * this.books.length);
          const pick2 = au.timeOfBeat(bi) - au.timeOfBar(Math.floor(au.barAt(au.timeOfBeat(bi)) + 1e-6)) < 0.02 ? Math.floor(hash(this.seed, bi, 5) * this.books.length) : -1;
          if (pick === i || pick2 === i) {
            const dt = t - au.timeOfBeat(bi);
            if (dt >= 0) z = Math.max(z, 46 * amp * (dt < 0.12 ? ease.outExpo(dt / 0.12) : 1 - ease.inOutCubic(clamp((dt - 0.12) / 0.8))));
          }
        }
      } else if (b.role === 'main') {
        const k = ease.outExpo(clamp((t - (this.tPull - 0.05)) / 0.5));
        z = 280 * k; tilt = -0.14 * k;
      } else {
        const ko = ease.outExpo(clamp((t - b.tOut) / 0.45)), ki = ease.inOutCubic(clamp((t - b.tIn) / 0.6));
        z = 230 * ko * (1 - ki);
      }
      b.mesh.position.z = -b.d / 2 + z;
      b.mesh.rotation.x = tilt;
      if (tilt) b.mesh.position.y = SHELF_Y + b.h / 2 + Math.sin(-tilt) * b.d * 0.1;
    }
  }

  /** 書架鏡頭的檯燈。k = 亮度（書桌後面焦外的書架暗一點）。 */
  private shelfLamp(tx: number, k = 1) {
    this.U.lampPos.value.set(tx - 700, 1250, 900);
    this.U.lampAim.value.set(tx, 330, 0);
    this.U.lampCol.value.set(...LIN.bone.map((v, i) => (v * 0.55 + LIN.signal[i]! * 0.45) * k) as [number, number, number]);
    this.U.cone.value.set(0.86, 0.975);
    this.U.amb.value = 0.07;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const inDesk = !!this.msg && t >= this.tCut;
    clearRT(renderer, out, [0, 0, 0]);
    // 書桌那一段：書架在焦外，書抽出來多一點才看得出來
    this.moveBooks(t, inDesk ? 2.4 : 1);
    if (inDesk) return this.renderDesk(t, out);

    // ---- 書背的歌詞／名字（現在的在 A、上一本在 B）
    const lb = this.books.filter((b) => b.role === 'lyric');
    let curI = -1;
    lb.forEach((b, i) => { if (t >= b.tOut) curI = i; });
    for (const b of this.books) { b.mat.uniforms.useDyn!.value = 0; }
    const paint = (L: Layer2D, text: Line | null, names: boolean) => {
      L.clear();
      const c = L.ctx;
      if (names) this.spineText(c, COUPLE_ZH, t, null, 190);
      else if (text) this.spineText(c, text.text, t, text);
      L.upload();
    };
    if (lb.length) {
      const cur = lb[Math.max(0, curI)]!;
      paint(this.dynA, cur.line, false);
      cur.mat.uniforms.useDyn!.value = 1; cur.mat.uniforms.dyn!.value = this.dynA.texture;
      const prev = curI > 0 ? lb[curI - 1]! : null;
      if (prev) { paint(this.dynB, prev.line, false); prev.mat.uniforms.useDyn!.value = 1; prev.mat.uniforms.dyn!.value = this.dynB.texture; }
    }
    const nb = this.books.find((b) => b.role === 'names');
    if (nb) { paint(this.dynA, null, true); nb.mat.uniforms.useDyn!.value = 1; nb.mat.uniforms.dyn!.value = this.dynA.texture; }

    // ---- 鏡頭：沿著書架橫移到那本書；有一點仰角、手持的微晃
    const target = lb.length ? lb[Math.max(0, curI)]! : this.books.find((b) => b.role !== 'plain')!;
    let tx = target.x;
    if (lb.length && curI > 0) {
      const prev = lb[curI - 1]!;
      tx = lerp(prev.x, target.x, ease.inOutCubic(clamp((t - target.tOut + 0.15) / 0.75)));
    }
    const side = hash(this.seed, 3) < 0.5 ? -1 : 1;
    const drift = prog(t, s, this.msg ? this.tCut : e, ease.inOutQuad);
    const intro = ease.outExpo(prog(t, s, s + Math.min(1.2, this.g.beat * 2.5)));
    const camX = tx + side * (120 * (1 - drift) + 40 * (1 - intro));
    const pullK = this.msg ? ease.inOutCubic(clamp((t - this.tPull) / 0.6)) : 0;
    const dist = 1500 - 90 * drift - 110 * pullK;
    // 有留言：看低一點（書架前緣的歌詞標籤要在畫面裡，離下緣留 96 px 以上）；沒有留言：整本書背（歌詞）都要在畫面裡
    const low = lb.length ? 1 : 0;
    const hy = 235 + 150 * low + 6 * Math.sin(t * 0.9) + 15 * pullK;
    this.cam.position.set(camX, 150 + 150 * low + 40 * (1 - intro) + 3 * Math.sin(t * 1.3), dist + 120 * low);
    this.cam.lookAt(tx + side * 40 * (1 - drift), hy, 0);
    this.cam.updateMatrixWorld();
    this.shelfLamp(tx);

    // ---- 書架標籤：歌詞（有留言時）、邀請（純音樂沒有留言）
    const L = this.label; L.clear();
    const c = L.ctx;
    // 標籤釘在書架上（主打那本書的左邊一段），字靠左：鏡頭橫移時不會跑進右下角
    this.labelRect.set(target.x - 600, SHELF_Y - BOARD_H + 18, 820, 60);
    if (this.msg) {
      const ly = lyricAt(lyrics, t);
      if (ly) {
        // v2：歌詞 40～52 px（比留言小），標籤只有一行，放不下就縮到 40
        const lay = layoutRows(c, ly.line, { family: F.hei(700), size: this.labelSize, minSize: V2.lyrMin / SHELF_K, maxW: 790, maxRows: 1, align: 'left' });
        c.save(); c.translate(16, 36 + lay.size * 0.36);
        drawRows(c, lay, F.hei(700), t, paperInk(), ly.k);
        c.restore();
      }
    } else if (!lb.length) {
      c.font = font(F.hei(500), 24); c.letterSpacing = '2px'; c.textAlign = 'center'; c.fillStyle = rgba('sepia', 0.9);
      c.fillText(T21_INVITE, 410, 44); c.letterSpacing = '0px'; c.textAlign = 'left';
    }
    this.boardMat.uniforms.lbl!.value = L.upload();
    // 歌詞寫在書背上的時候不用標籤（鏡頭看得比較高，標籤在畫面外）
    this.boardMat.uniforms.lblOn!.value = lb.length ? 0 : 1;
    renderer.setRenderTarget(out);
    renderer.render(this.shelf, this.cam);
    const hit = this.msg ? pulse(t, this.tPull, 0.1) : 0;
    // 重要的字：那本書的書背（歌詞／名字／祝福）與書架標籤
    const avoid: Rect[] = [projRect(this.cam, [[target.x - target.w / 2, 0, 0], [target.x + target.w / 2, target.h, 0]])];
    if (!lb.length) avoid.push(projRect(this.cam, [[this.labelRect.x, this.labelRect.y, 0], [this.labelRect.x + this.labelRect.z, this.labelRect.y + this.labelRect.w, 0]]));
    return { bloom: 0.55, vignette: 0.6, grain: 0.05, shake: [0, hit * 4], popupAvoid: avoid };
  }

  /**
   * 書背上的字：中文為主直書（一個字一格、由上往下；超過一欄就兩欄，右欄先）、英文橫躺（字頂朝右，由上往下讀）。
   * 照跟唱規則：還沒唱三成、正在唱燙金（訊號色，會發光）、唱完紙白。
   */
  private spineText(c: CanvasRenderingContext2D, text: string, t: number, line: Line | null, top = 70) {
    const cjk = (text.match(/[㐀-鿿]/g)?.length ?? 0) >= Array.from(text.replace(/\s/g, '')).length * 0.5;
    const chars = Array.from(text);
    // 韓文歌：原文小一號橫躺在同一本書背上、中文的「下一行」（直書的下一行在左邊；橫躺的字頂朝右，下一行也在左邊）。
    // 兩行一起在書背上置中：cx = 主行的中線，sx = 原文的中線；沒有原文時 cx 就是書背正中間，跟原本一樣
    const sub = line ? lyricSubOf(line) : null;
    const ss = subSizeFor(V2.lyrMax) / SHELF_K;
    let cx = DYN_W / 2, sx = 0;
    const place = (mainW: number) => {
      if (!sub) return;
      const gap = ss * 0.35, subW = ss * 0.95;
      cx = DYN_W / 2 + (subW + gap) / 2;
      sx = cx - mainW / 2 - gap - subW / 2;
    };
    const prog = line ? Lyrics.lineCharProgress(line, t) : Infinity;
    const colOf = (i: number, len: number) => {
      if (!line) return rgba('bone', 0.95);
      const k = clamp((prog - i) / len);
      return k >= 1 ? rgba('bone', 0.95) : k > 0 ? rgba('signal') : rgba('bone', 0.3);
    };
    c.textBaseline = 'alphabetic';
    if (cjk) {
      const vis = chars.filter((ch) => ch.trim());
      // v2：書背上的歌詞 40～52 px（書架 1 單位 ≈ SHELF_K 螢幕 px）；新人的名字（純音樂沒有留言）是焦點，可以到 60
      // （名字那一本的鏡頭近一點，約 1.25 倍）
      const hi = line ? V2.lyrMax / SHELF_K : V2.msgMax / 1.25, lo = V2.lyrMin / SHELF_K;
      const size = clamp(Math.floor((DYN_H - 50 - top) / Math.max(1, vis.length) / 1.08), lo, hi);
      const perCol = Math.floor((DYN_H - 40 - top) / (size * 1.08));
      const cols = Math.ceil(vis.length / perCol);
      // 有原文時書背要多容一欄橫躺的原文：直書的欄寬從剩下的寬度分
      const cw = Math.min(size * 1.05, (DYN_W - 16 - (sub ? ss * 1.3 : 0)) / cols);
      const sz = Math.min(size, cw * 0.95);
      place(cols * cw);
      c.font = font(F.ming(900), sz); c.textAlign = 'center';
      let k = 0, off = 0;
      for (const ch of chars) {
        const at = off; off += ch.length;
        if (!ch.trim()) continue;
        const col = Math.floor(k / perCol), row = k % perCol;
        const x = cx + ((cols - 1) / 2 - col) * cw, y = top + (row + 1) * sz * 1.08;
        c.fillStyle = colOf(at, ch.length);
        if (ch === '♥') glyphPath(c, { ch, x: x - sz / 2, y, w: sz, size: sz, family: F.ming(900) });
        else c.fillText(ch, x, y);
        k++;
      }
      c.textAlign = 'left';
    } else {
      // 橫躺：整行轉 90°，字頂朝書背右側
      // 窄一點的字寬：長的英文句子也躺得進書背（字級一樣照 v2）
      const fam = F.archivo(66, 700);
      let size = V2.lyrMax / SHELF_K;
      c.font = font(fam, size);
      const full = c.measureText(text).width;
      if (full > DYN_H - 120) size = Math.max(V2.lyrMin / SHELF_K, (size * (DYN_H - 120)) / full);
      c.font = font(fam, size);
      // 橫躺的字：基線在 0.35 字高，字身從中線往右約 0.37、往左約 0.55 字高
      place(size * 0.92);
      c.save(); c.translate(cx + (sub ? size * 0.09 : 0), 60); c.rotate(Math.PI / 2);
      let x = 0, off = 0;
      for (const w of text.split(/(\s+)/)) {
        const at = off; off += w.length;
        if (!w) continue;
        c.fillStyle = colOf(at, Math.max(1, w.length));
        c.fillText(w, x, size * 0.35);
        x += c.measureText(w).width;
      }
      c.restore();
    }
    if (sub) this.spineSub(c, sub, t, sx, cjk ? top : 60, ss);
  }

  /**
   * 書背上的原文副行：橫躺（字頂朝右、由上往下讀），比中文安靜——唱到、唱完都是淡兩成的紙白（不用燙金），還沒唱三成。
   * 太長躺不進書背就沿著閱讀方向壓窄（字高不變，會場後排還認得出來）。
   */
  private spineSub(c: CanvasRenderingContext2D, sub: Line, t: number, x0: number, top: number, size: number) {
    const fam = F.archivo(66, 700);
    const text = sub.text;
    const prog = Lyrics.lineCharProgress(sub, t);
    c.save();
    c.font = font(fam, size);
    c.textBaseline = 'alphabetic';
    const avail = DYN_H - 60 - top;
    const full = c.measureText(text).width;
    c.translate(x0, top); c.rotate(Math.PI / 2);
    if (full > avail) c.scale(avail / full, 1);
    const lit = rgba('bone', 0.95 * 0.8);
    let x = 0, off = 0;
    for (const w of text.split(/(\s+)/)) {
      const at = off; off += w.length;
      if (!w) continue;
      const k = clamp((prog - at) / Math.max(1, w.length));
      c.fillStyle = k > 0 ? lit : rgba('bone', 0.3);
      c.fillText(w, x, size * 0.35);
      x += c.measureText(w).width;
    }
    c.restore();
  }

  // ------------------------------------------------------------ 書桌
  /**
   * 書桌的鏡頭：斜俯看攤開的書（畫面中間偏左，書的上方看得到桌子後緣與焦外的書架），翻頁之後慢慢推近、稍微往右頁移。
   */
  private deskPose(t: number) {
    const e = this.ctx.end;
    const push = ease.inOutQuad(prog(t, this.tFlip, e));
    const land = ease.outExpo(prog(t, this.tCut, this.tCut + 0.8));
    const D = (H / 2) / Math.tan(THREE.MathUtils.degToRad(15));
    const tx = lerp(250, 290, push) + 60 * (1 - land), ty = lerp(40, 20, push);
    const dist = D * (1.2 - 0.05 * push + 0.1 * (1 - land));
    const tilt = THREE.MathUtils.degToRad(36 + 4 * (1 - land));
    this.cam2.position.set(tx - 140 * (1 - push) - 60, ty - Math.sin(tilt) * dist, Math.cos(tilt) * dist);
    this.cam2.lookAt(tx, ty, 20);
    this.cam2.updateMatrixWorld();
  }

  /** 緞帶書籤：從書溝下緣垂出來、落到桌上，跟著拍子輕輕擺；翻頁的那一下被甩開、再慢慢晃回來。 */
  private ribbon(t: number) {
    const geo = this.ribbonGeo;
    if (!geo) return;
    const au = this.ctx.audio;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const bt = au.beatAt(t);
    const flick = Math.exp(-Math.max(0, t - this.tFlip) * 2.2) * Math.sin(Math.max(0, t - this.tFlip) * 7) * (t > this.tFlip - 0.1 ? 1 : 0);
    const sway = 14 * Math.sin(bt * Math.PI) * (0.6 + 0.4 * Math.sin(t * 0.7)) + 70 * flick;
    const y0 = -PGH / 2 + 70, edge = -PGH / 2 - 16;
    const n = pos.count / 2;
    for (let j = 0; j < n; j++) {
      const u = j / (n - 1);
      const y = y0 - u * 330;
      // 書頁上貼著書溝的高度，過了書的下緣落到桌上
      const z = lerp(this.pageZ(0) + 3, 1.5, clamp((edge - y) / 50)) + 6 * Math.max(0, 1 - Math.abs(y - edge) / 30);
      const x = sway * Math.pow(Math.max(0, (y0 - 60 - y) / 270), 1.4) + 6 * u;
      for (const sd of [0, 1]) pos.setXYZ(j * 2 + sd, x + (sd ? 8 : -8), y, z);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }

  private renderDesk(t: number, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const e = this.ctx.end;
    // ---- 桌子後面焦外的書架：同一個書架場景（書照樣在拍點上被抽出來），主打那本書的位置空了一格
    const main = this.books.find((b) => b.role === 'main');
    const bx = main?.x ?? 0;
    const side = hash(this.seed, 3) < 0.5 ? -1 : 1;
    const drift = prog(t, this.tCut, e);
    // 書架在畫面上半部（桌子後緣斜斜地切過去，右上露得最多）；空出來的那一格在右上，鏡頭慢慢橫移
    const cx = bx - 640 + side * (140 - 100 * drift);
    this.cam.position.set(cx + 60, 60, 2650);
    this.cam.lookAt(cx, 100, 0);
    this.cam.updateMatrixWorld();
    this.shelfLamp(bx - 200, 1.15);
    for (const b of this.books) b.mat.uniforms.useDyn!.value = 0;
    this.boardMat.uniforms.lblOn!.value = 0;
    if (main) main.mesh.visible = false;
    clearRT(renderer, this.bgRT, [0, 0, 0]);
    renderer.setRenderTarget(this.bgRT);
    renderer.render(this.shelf, this.cam);
    if (main) main.mesh.visible = true;
    this.blur.u.tex!.value = this.bgRT.texture;
    this.blur.render(renderer, out);
    // ---- 左頁（翻頁的背面）：底圖＋歌詞（比留言小一點）
    const L = this.leftDyn; L.clear();
    const c = L.ctx;
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const lay: RowsLayout = layoutRows(c, ly.line, { family: FAM_LYR, size: this.lyrSize, minSize: V2.lyrMin / this.K, maxW: PGW - 120, maxRows: 4, align: 'center', lineHeight: 1.3 });
      c.save(); c.translate(PGW / 2, PGH * 0.5 - lay.height / 2 + lay.size * 0.8);
      drawRows(c, lay, FAM_LYR, t, paperInk(), ly.k);
      c.restore();
    } else if (!this.hasLyrics) {
      c.font = font(F.mono(500), 18); c.letterSpacing = '3px'; c.textAlign = 'center'; c.fillStyle = rgba('sepia', 0.6);
      c.fillText(`♪  ${this.ctx.song.title}`, PGW / 2, PGH * 0.5); c.letterSpacing = '0px'; c.textAlign = 'left';
    }
    L.upload();
    comp.draw(renderer, this.leftBase!, this.leftRT, { mode: 'replace' });
    comp.draw(renderer, L.texture, this.leftRT);
    // 翻頁：tFlip - flipDur 開始、落在 tFlip（拍點）
    const k = clamp((t - (this.tFlip - this.flipDur)) / this.flipDur);
    // 翻過去之後，每兩個小節線那一頁的紙彈起來一點再落回去（紙有彈性；窗格長時中段也有小事件）
    let spring = 0;
    for (const tb of this.springs) { const x = t - (tb - 0.25); if (x > 0 && x < 1.2) spring = Math.max(spring, Math.sin(Math.PI * Math.min(1, x / 0.5)) * Math.exp(-x * 1.5) * (x < 0.5 ? 1 : Math.cos((x - 0.5) * 9) * 0.35 + 0.65)); }
    const phi = Math.PI * ease.inOutCubic(k) - 0.2 * spring;
    this.flipPage(phi);
    this.ribbon(t);
    this.deskPose(t);
    this.U.lampPos.value.set(-1100, 900, 1500);
    this.U.lampAim.value.set(150, -60, 0);
    this.U.lampCol.value.set(...LIN.bone.map((v, i) => v * 0.7 + LIN.signal[i]! * 0.3) as [number, number, number]);
    this.U.cone.value.set(0.62, 0.93);
    this.U.amb.value = 0.12;
    renderer.setRenderTarget(out);
    renderer.clearDepth();
    renderer.render(this.desk, this.cam2);
    const hit = pulse(t, this.tFlip, 0.08);
    const avoid: Rect[] = [projRect(this.cam2, [[-PGW + 40, -PGH / 2 + 60, 40], [PGW - 40, PGH / 2 - 60, 40]])];
    return { bloom: 0.45, vignette: 0.55, grain: 0.05, shake: [0, hit * 3], popupAvoid: avoid };
  }

  override dispose() {
    for (const x of this.owned3.splice(0)) x.dispose();
    super.dispose();
  }
}

