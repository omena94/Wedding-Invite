// 三面翻看板（暗）：路邊的三面翻廣告看板，晚上被上緣的四盞投射燈打亮。
//  - 看板是 32 根直立的三角柱，三面各印著一張海報的直條。三角柱在拍點「喀啦」一起翻：由左到右一波、每根晚一點點，
//    最後回彈一下停住，翻出下一張。翻到一半的面轉離燈，會暗下來（光是真的算的）。
//  - 有留言：一開始是看板本來的「廣告」（新人的名字、日期、一句冷面的「今晚，本看板只刊登祝福。」），
//    第一個小節線翻成留言（大大的手寫字＋署名，畫面上最大的字），一直停到窗格結束。
//    歌詞在看板下面、兩根柱子之間的燈箱橫條（逐字跟唱，比留言小一級）。
//  - 沒有留言：每換一句歌詞看板就翻一次，歌詞印在看板上（焦點，逐字跟唱），燈箱橫條放邀請。
//  - 純音樂又沒有留言：廣告 → 邀請。
// 手法：three.js 真的 3D（三角柱是 instanced 網格，頂點 shader 轉角度；三張海報是三張 Canvas 圖層，
// 片段 shader 依「第幾根、第幾面」取樣對的直條），4x MSAA（直條的邊才不會閃）。背景是夜空與遠方城市的剪影（全螢幕 shader），
// 燈光裡的飛塵與燈頭的亮點用 LineBatch。鏡頭：從街上稍微仰拍，整個窗格很慢地往右平移、推近；翻完的那一下輕輕一震。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, sharedMSAA } from '../engine/gl';
import { GLSL_COMMON, THEME_UNIFORMS } from '../engine/glsl/common';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, prog, hash, pulse } from '../engine/util';
import { fitText } from '../engine/text';
import type { Line } from '../engine/lyrics';
import { lyricSizeFor, drawHeart, fillWithHearts, COUPLE_ZH, COUPLE_EN, DATE_DOTS } from './_motifs';
import { grid, layoutRows, drawRows, paperInk, darkInk } from './_t4';
import { msgBlock, INVITE, type MsgBlock } from './_t14';
import { shownLyric, sigOf, type Rect } from './_t24';

export const spec: PlateSpecDecl = { group: 'type', family: 'local', paper: false, energy: [0.3, 1], bars: [4, 8], weight: 1 };

/** 三角柱的根數、看板（＝海報）的大小（世界單位＝海報 px，鏡頭在正前方時約等於螢幕 px）。 */
const N = 32;
const BW = 1504, BH = 640;
const SW = BW / N;
const BX0 = -BW / 2, BY0 = -206;
const APO = SW / (2 * Math.sqrt(3));
/** 燈箱橫條（看板下面，掛在兩根柱子之間；右端不進右下角 QR 區）。 */
const STRIP = { x0: -752, x1: 300, y0: -372, y1: -270 };
const SPW = STRIP.x1 - STRIP.x0, SPH = STRIP.y1 - STRIP.y0;
/** 四盞投射燈：掛在看板上緣往前伸的支架上，往下往後照。 */
const LAMPS = [-560, -188, 188, 560];
const LAMP_Y = BY0 + BH + 120, LAMP_Z = 210;
const FOV = 30;
const DIST = (H / 2) / Math.tan((FOV / 2) * Math.PI / 180);
/** 一根翻一次的時間、由左到右一波的總延遲。 */
const FLIP = 0.4, WAVE = 0.28;

const FAM_MSG = F.hand(700), FAM_SIG = F.hand(400);
const FAM_LYR = F.archivo(100, 800);
const AD_LINE = '今晚，本看板只刊登祝福。';
const FOOT = '＊本版面由親友熱情贊助刊登';
const PRE = 'precision highp float;\nprecision highp int;\n';

// ---------------------------------------------------------------- shader
const PRISM_VERT = /* glsl */ `${PRE}
in vec3 position; in vec3 normal; in vec2 uv; in float face;
in float iIdx; in float iRot;
uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
out vec3 vW; out vec3 vN; out vec2 vUv; out float vFace; out float vIdx;
void main() {
  float c = cos(iRot), s = sin(iRot);
  vec3 p = vec3(position.x * c + position.z * s, position.y, -position.x * s + position.z * c);
  vec3 n = vec3(normal.x * c + normal.z * s, normal.y, -normal.x * s + normal.z * c);
  p.x += ${BX0.toFixed(1)} + (iIdx + 0.5) * ${SW.toFixed(3)};
  vW = p; vN = n; vUv = uv; vFace = face; vIdx = iIdx;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

/** 投射燈打在看板上的光：每盞燈一個往下拉長的光圈（上緣最亮），乘上面朝燈的程度。 */
const LIGHT_GLSL = /* glsl */ `
uniform vec3 lamps[4]; uniform float lampI;
float lampLight(vec3 P, vec3 N) {
  float L = 0.2;
  for (int i = 0; i < 4; i++) {
    vec3 d = lamps[i] - P;
    float lam = max(dot(N, normalize(d)), 0.0);
    float dx = (P.x - lamps[i].x) / 360.0, dy = (${(BY0 + BH).toFixed(1)} - P.y) / 620.0;
    float pool = exp(-dx * dx) * (0.42 + 0.58 * exp(-dy * dy * 1.4));
    L += 1.02 * lampI * lam * pool;
  }
  return L;
}`;

const PRISM_FRAG = /* glsl */ `${PRE}
in vec3 vW; in vec3 vN; in vec2 vUv; in float vFace; in float vIdx;
out vec4 fragColor;
${GLSL_COMMON}
${LIGHT_GLSL}
uniform sampler2D tA; uniform sampler2D tB; uniform sampler2D tC;
void main() {
  vec3 N = normalize(vN);
  vec2 uv = vec2((vIdx + vUv.x) / ${N}.0, vUv.y);
  vec4 a = fastLayer(texture(tA, uv)), b = fastLayer(texture(tB, uv)), c = fastLayer(texture(tC, uv));
  vec3 col = vFace < 0.5 ? a.rgb : vFace < 1.5 ? b.rgb : c.rgb;
  float L = lampLight(vW, N);
  // 直條之間的縫：兩邊各一兩 px 暗下來（翻的時候看得出一根一根）
  float e = min(vUv.x, 1.0 - vUv.x) * ${SW.toFixed(2)};
  col *= mix(0.7, 1.0, smoothstep(0.2, 1.6, e));
  // 海報是亮面的塑膠布：燈的方向有一點點光澤
  float sheen = pow(max(N.z, 0.0), 12.0) * 0.04 * lampI;
  fragColor = vec4(col * L + C_EMBER * sheen, 1.0);
}`;

const SOLID_VERT = /* glsl */ `${PRE}
in vec3 position; in vec3 normal; in vec2 uv;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
out vec3 vW; out vec3 vN; out vec2 vUv;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** 鋼架、柱子、燈罩：深色金屬，朝上的面接一點天光，靠近燈的地方被照到。kind：0 = 金屬、1 = 燈箱（貼圖發光）、2 = 光束。 */
const SOLID_FRAG = /* glsl */ `${PRE}
in vec3 vW; in vec3 vN; in vec2 vUv;
out vec4 fragColor;
${GLSL_COMMON}
${LIGHT_GLSL}
uniform float kind; uniform sampler2D tex; uniform float beamA;
void main() {
  vec3 N = normalize(vN);
  if (kind > 1.5) {
    // 光束：燈頭（v = 1）亮、往看板（v = 0）散開變淡；兩側軟邊
    float edge = 1.0 - smoothstep(0.25, 0.5, abs(vUv.x - 0.5));
    float a = beamA * edge * pow(sat(vUv.y), 1.6) * (0.6 + 0.4 * snoise(vec2(vUv.x * 5.0, vUv.y * 3.0)));
    fragColor = vec4(mix(C_EMBER, C_BONE, 0.5) * a, 0.0);
    return;
  }
  if (kind > 0.5) {
    vec4 L = fastLayer(texture(tex, vUv));
    fragColor = vec4(L.rgb * 1.05, 1.0);
    return;
  }
  vec3 base = mix(C_INK, C_GRAPHITE, 0.2);
  float sky = 0.35 + 0.35 * max(N.y, 0.0) + 0.15 * max(-N.x, 0.0);
  float lit = lampLight(vW, N) - 0.2;
  vec3 col = base * sky + mix(C_GRAPHITE, C_ASH, 0.3) * 0.22 * lit;
  fragColor = vec4(col, 1.0);
}`;

const SKY = () => new FSPass(/* glsl */ `
  uniform float par;
  void main() {
    vec2 p = FRAG_PX;
    float y = p.y / 1080.0;
    // 夜空：上面最暗，接近地平線帶一點城市的暖光
    vec3 col = mix(C_INK2 * 1.25 + C_BLOOD * 0.05, C_INK, smoothstep(0.02, 0.85, y));
    col += C_SIGNAL * 0.05 * exp(-p.y / 160.0) + C_BLOOD * 0.04 * exp(-p.y / 380.0);
    // 很淡的雲
    col += C_INK2 * 0.35 * smoothstep(0.1, 0.7, fbm(vec2(p.x / 900.0 + par * 0.0002, p.y / 300.0), 3)) * smoothstep(0.2, 0.7, y);
    // 遠方城市的剪影（跟著鏡頭慢一點地移：視差）與幾扇亮著的窗
    float x = p.x + par * 0.18;
    float bx = floor(x / 58.0);
    float hgt = 40.0 + 170.0 * hash11(bx * 1.37 + 3.0) * (0.55 + 0.45 * sin(bx * 0.23 + 1.0));
    // 遠景是失焦的：輪廓軟軟的，窗戶是一團團小光
    float bld = 1.0 - smoothstep(hgt - 3.0, hgt + 3.0, p.y);
    vec2 wc = vec2(fract(x / 16.0), fract(p.y / 22.0)) - 0.5;
    float win = exp(-dot(wc, wc) * 30.0) * step(0.9, hash12(floor(vec2(x / 16.0, p.y / 22.0))));
    col = mix(col, C_INK * 0.85, bld * 0.9);
    col += mix(C_SIGNAL, C_EMBER, 0.3) * 0.1 * win * bld * step(10.0, hgt - p.y);
    fragColor = vec4(col, 1.0);
  }`, { par: { value: 0 } });

// ---------------------------------------------------------------- 共用的 3D 道具
class Rig {
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(FOV, W / H, 50, 20000);
  geo: THREE.InstancedBufferGeometry;
  rot: THREE.InstancedBufferAttribute;
  prismMat: THREE.RawShaderMaterial;
  metal: THREE.RawShaderMaterial;
  stripMat: THREE.RawShaderMaterial;
  beamMat: THREE.RawShaderMaterial;
  lampsU = { value: LAMPS.map((x) => new THREE.Vector3(x, LAMP_Y - 30, LAMP_Z - 20)) };
  lampI = { value: 1 };
  constructor() {
    // 一根三角柱：三個面（面 k 的法向量在 k·120°），uv 的 u 由面的左緣到右緣（從外面看）
    const pos: number[] = [], nrm: number[] = [], uv: number[] = [], face: number[] = [], idx: number[] = [];
    for (let k = 0; k < 3; k++) {
      const a = (k * 2 * Math.PI) / 3;
      const n = [Math.sin(a), Math.cos(a)], tg = [Math.cos(a), -Math.sin(a)];
      const cx = n[0]! * APO, cz = n[1]! * APO;
      const v0 = pos.length / 3;
      for (const [s, vv] of [[-1, 0], [1, 0], [1, 1], [-1, 1]] as const) {
        pos.push(cx + tg[0]! * s * SW / 2, BY0 + vv * BH, cz + tg[1]! * s * SW / 2);
        nrm.push(n[0]!, 0, n[1]!); uv.push((s + 1) / 2, vv); face.push(k);
      }
      idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('face', new THREE.Float32BufferAttribute(face, 1));
    g.setIndex(idx);
    g.setAttribute('iIdx', new THREE.InstancedBufferAttribute(new Float32Array(Array.from({ length: N }, (_, i) => i)), 1));
    this.rot = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
    this.rot.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iRot', this.rot);
    g.instanceCount = N;
    this.geo = g;
    const common = { ...THEME_UNIFORMS, lamps: this.lampsU, lampI: this.lampI };
    this.prismMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: PRISM_VERT, fragmentShader: PRISM_FRAG,
      uniforms: { ...common, tA: { value: null }, tB: { value: null }, tC: { value: null } },
    });
    const prisms = new THREE.Mesh(g, this.prismMat);
    prisms.frustumCulled = false;
    this.scene.add(prisms);
    const solid = (kind: number, extra: Record<string, THREE.IUniform> = {}) => new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: SOLID_VERT, fragmentShader: SOLID_FRAG,
      uniforms: { ...common, kind: { value: kind }, tex: { value: null }, beamA: { value: 0.05 }, ...extra },
    });
    this.metal = solid(0);
    this.stripMat = solid(1);
    this.beamMat = solid(2);
    this.beamMat.transparent = true; this.beamMat.depthWrite = false;
    this.beamMat.blending = THREE.CustomBlending;
    this.beamMat.blendSrc = THREE.OneFactor; this.beamMat.blendDst = THREE.OneFactor;
    this.beamMat.side = THREE.DoubleSide;
    const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat = this.metal) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      m.frustumCulled = false;
      this.scene.add(m);
      return m;
    };
    // 外框（上下左右四條）、後面的箱體
    const F0 = 26;
    box(BX0 - F0, -BX0 + F0, BY0 + BH, BY0 + BH + F0, -50, 34);
    box(BX0 - F0, -BX0 + F0, BY0 - F0, BY0, -50, 34);
    box(BX0 - F0, BX0, BY0, BY0 + BH, -50, 34);
    box(-BX0, -BX0 + F0, BY0, BY0 + BH, -50, 34);
    box(BX0, -BX0, BY0, BY0 + BH, -60, -40);
    // 兩根柱子（往下伸出畫面）、燈箱橫條掛在柱子前面
    for (const x of [-430, 430]) box(x - 30, x + 30, -1500, BY0 - F0, -40, 20);
    box(STRIP.x0 - 12, STRIP.x1 + 12, STRIP.y0 - 12, STRIP.y1 + 12, 20, 34);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(SPW, SPH), this.stripMat);
    strip.position.set((STRIP.x0 + STRIP.x1) / 2, (STRIP.y0 + STRIP.y1) / 2, 34.5);
    strip.frustumCulled = false;
    this.scene.add(strip);
    // 投射燈：從上緣往前伸的支架、燈罩；燈罩往看板照的光束（加亮）
    for (const x of LAMPS) {
      box(x - 5, x + 5, BY0 + BH + F0 - 4, BY0 + BH + F0 + 6, 0, LAMP_Z);
      box(x - 5, x + 5, BY0 + BH + F0, LAMP_Y, LAMP_Z - 8, LAMP_Z + 2);
      const head = box(x - 34, x + 34, LAMP_Y - 20, LAMP_Y + 22, LAMP_Z - 26, LAMP_Z + 18);
      head.rotation.x = -0.5;
      // 光束：燈頭到看板上半部的一片梯形（v = 1 在燈頭）
      const bg = new THREE.BufferGeometry();
      const top = [x, LAMP_Y - 34, LAMP_Z - 26], bot = BY0 + BH - 420;
      bg.setAttribute('position', new THREE.Float32BufferAttribute([
        top[0]! - 26, top[1]!, top[2]!, top[0]! + 26, top[1]!, top[2]!, x + 300, bot, 4, x - 300, bot, 4,
      ], 3));
      bg.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
      bg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
      bg.setIndex([0, 1, 2, 0, 2, 3]);
      const beam = new THREE.Mesh(bg, this.beamMat);
      beam.frustumCulled = false;
      beam.renderOrder = 10;
      this.scene.add(beam);
    }
  }
}

// ---------------------------------------------------------------- 版面
type Item = { kind: 'ad' } | { kind: 'msg' } | { kind: 'invite' } | { kind: 'line'; line: Line };

export default class Trivision extends Scene {
  rig = shared('trivision.rig', () => new Rig());
  sky = shared('trivision.sky', SKY);
  /** 全引擎共用的 4x MSAA（畫完同一個 render() 裡就解析到 out，不 track／dispose）。 */
  msaa = sharedMSAA();
  faces = [0, 1, 2].map(() => this.track(new Layer2D(BW, BH, undefined, { fast: true })));
  strip = this.track(new Layer2D(SPW, SPH, undefined, { fast: true }));
  dust = this.track(new LineBatch(256, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 131 + (this.msg?.id ?? 0) * 17) >>> 0;
  block: MsgBlock | null = null;
  items: Item[] = [];
  /** 每一次翻的開始時間（第 k 次翻完，看板顯示 items[k]）。 */
  flips: number[] = [];
  faceSig = ['', '', ''];
  stripSig = '';
  lyrSize = 56;
  inviteFit: ReturnType<typeof fitText> | null = null;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const gr = grid(au, s, e);
    await loadText(`${m?.text ?? ''}${m ? sigOf(m) : ''}${COUPLE_ZH}${COUPLE_EN}${DATE_DOTS}${AD_LINE}${FOOT}${INVITE}${song.title}${song.artist}FROM THE COUPLE · 新人♪`);
    const c = this.faces[1]!.ctx;
    // 翻牌：中間那根落定的時間 = 目標時間（整波由左到右）
    const flipAt = (land: number) => land - WAVE / 2 - FLIP;
    // 第一次翻（廣告 → 留言／邀請）：窗格短就第一拍、長一點就第一個小節線；
    // 但先讓廣告停一下（至少大半秒）再翻，切進來馬上翻看不出「翻」
    let firstLand = gr.nBars < 3 ? gr.b0 : gr.bar0;
    if (firstLand - s < 0.9) firstLand += gr.nBars < 3 ? gr.beat : gr.bar;
    if (m) {
      this.block = msgBlock(c, m, FAM_MSG, { x: 120, y: 64, w: BW - 240, h: BH - 150 }, { align: 'left', sigFamily: FAM_SIG, sigMin: 44, sigMax: 60, min: 56, max: 170, lineHeight: 1.26, maxLines: 4, sigText: sigOf(m) });
      this.lyrSize = Math.min(58, lyricSizeFor(this.block.fit.size));
      // 窗格短：第一拍就翻；長一點：第一個小節線
      this.items = [{ kind: 'ad' }, { kind: 'msg' }];
      this.flips = [flipAt(firstLand)];
    } else {
      const ls = lyrics.linesIn(s - 4, e).filter((l) => l.end > s - 1.5);
      if (!ls.length) {
        c.font = font(FAM_MSG, 100);
        this.inviteFit = fitText(c, INVITE, FAM_MSG, BW - 280, BH - 200, { min: 70, max: 120, lineHeight: 1.3, maxLines: 2 });
        this.items = [{ kind: 'ad' }, { kind: 'invite' }];
        this.flips = [flipAt(firstLand)];
      } else {
        // 第一句在切進來的時候已經在看板上（或還來得及翻）：沒有就先放廣告
        const first = ls[0]!;
        const firstFlip = flipAt(first.start - 0.15);
        const items: Item[] = [];
        const flips: number[] = [];
        if (firstFlip < s + 0.1) items.push({ kind: 'line', line: first });
        else { items.push({ kind: 'ad' }); items.push({ kind: 'line', line: first }); flips.push(firstFlip); }
        for (const l of ls.slice(1)) {
          const fa = flipAt(l.start - 0.15);
          if (fa >= e - 0.3) break;
          // 兩次翻要隔得開（不然上一句還沒翻完就又翻）
          const prev = flips[flips.length - 1] ?? -Infinity;
          items.push({ kind: 'line', line: l });
          flips.push(Math.max(fa, prev + FLIP + WAVE + 0.1));
        }
        this.items = items;
        this.flips = flips;
      }
    }
    this.avoid = [[180, 90, 1560, 690], [200, 790, 1070, 120]];
  }

  /** t 時第 i 根三角柱的角度（弧度）：每次翻 −120°，outBack 回彈一下停住。 */
  private angle(i: number, t: number) {
    let a = 0;
    for (const f0 of this.flips) {
      const t0 = f0 + (WAVE * i) / (N - 1);
      if (t < t0) break;
      a += ease.outBack(clamp((t - t0) / FLIP), 1.25);
    }
    return (-a * 2 * Math.PI) / 3;
  }

  /** t 時已經開始的翻牌次數。 */
  private flipsStarted(t: number) { let n = 0; for (const f0 of this.flips) if (t >= f0) n++; return n; }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const rig = this.rig;

    // ---- 三張海報：面 k 放 items 裡「≤ 已開始的翻牌數 + 1、且 ≡ k (mod 3)」的最後一個（背面那一面換內容時看不到）
    const n = this.flipsStarted(t);
    for (let k = 0; k < 3; k++) {
      let j = -1;
      for (let q = 0; q < this.items.length && q <= n + 1; q++) if (q % 3 === k) j = q;
      const it = j >= 0 ? this.items[j]! : ({ kind: 'ad' } as Item);
      this.drawFace(k, it, j, t);
    }
    // ---- 燈箱橫條
    this.drawStrip(t);

    // ---- 3D
    const rot = rig.rot.array as Float32Array;
    for (let i = 0; i < N; i++) rot[i] = this.angle(i, t);
    rig.rot.needsUpdate = true;
    const pu = rig.prismMat.uniforms;
    pu.tA!.value = this.faces[0]!.texture; pu.tB!.value = this.faces[1]!.texture; pu.tC!.value = this.faces[2]!.texture;
    rig.stripMat.uniforms.tex!.value = this.strip.texture;
    // 燈：切進來時已經亮著；每個大鼓稍微閃一下（電壓不穩的老燈）
    rig.lampI.value = 1 + 0.05 * f.a.kick;
    rig.beamMat.uniforms.beamA!.value = 0.045 + 0.02 * f.a.kick;
    // 鏡頭：稍微仰拍，整個窗格很慢地往右平移、推近；翻完那一下輕輕一震
    const p = clamp((t - s) / Math.max(1, e - s)), pe = ease.inOutQuad(p);
    const land = prog(t, s, s + 1.1, ease.outCubic);
    let shake = 0;
    for (const f0 of this.flips) shake += pulse(t, f0 + WAVE + FLIP * 0.55, 0.09) * Math.sin((t - f0) * 60);
    const cam = rig.cam;
    cam.position.set(-250 + 170 * pe, -260 - 60 * (1 - land) + 5 * shake, DIST * (1.0 - 0.03 * pe) + 120 * (1 - land));
    cam.up.set(0, 1, 0);
    cam.lookAt(-10 + 40 * pe, 25, 0);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();

    const rt = this.msaa;
    this.sky.u.par!.value = cam.position.x;
    this.sky.render(renderer, rt);
    renderer.setRenderTarget(rt);
    renderer.clearDepth();
    renderer.render(rig.scene, cam);
    comp.draw(renderer, rt.texture, out, { mode: 'replace', premult: false });

    // ---- 燈頭的亮點、燈光裡的飛塵（2D，投影到畫面）
    const db = this.dust; db.clear();
    const v = new THREE.Vector3();
    const proj = (x: number, y: number, z: number) => { v.set(x, y, z).project(cam); return { x: (v.x * 0.5 + 0.5) * W, y: (0.5 - v.y * 0.5) * H }; };
    const em = LIN.ember, bone = LIN.bone;
    for (const x of LAMPS) {
      const q = proj(x, LAMP_Y - 30, LAMP_Z - 10);
      db.seg2(q.x - 22, q.y, q.x + 22, q.y, 9, [em[0] * 3, em[1] * 3, em[2] * 3], 1);
      db.seg2(q.x - 8, q.y, q.x + 8, q.y, 5, [em[0] * 6, em[1] * 6, em[2] * 6], 1);
    }
    for (let k = 0; k < 70; k++) {
      const L = LAMPS[k % 4]!;
      const ph = hash(this.seed, k, 1), sp = 0.04 + 0.06 * hash(this.seed, k, 2);
      const u = (ph + t * sp) % 1;
      // 從燈頭往下飄到看板上半部，在光束裡左右晃
      const y = LAMP_Y - 40 - u * 380, z = LAMP_Z - 30 - u * 180;
      const x = L + (hash(this.seed, k, 3) - 0.5) * (60 + 520 * u) + 18 * Math.sin(t * 1.3 + k);
      const q = proj(x, y, z);
      const a = Math.sin(u * Math.PI) * (0.25 + 0.5 * hash(this.seed, k, 4)) * (0.6 + 0.4 * Math.sin(t * 7 + k * 3));
      db.seg2(q.x, q.y, q.x + 0.6, q.y + 0.6, 1.8, [bone[0] * a, bone[1] * a, bone[2] * a], 1);
    }
    db.render(renderer, out);
    const exit = prog(t, e - 0.35, e, ease.inCubic);
    return { bloom: 0.6, vignette: 0.6, halation: 0.25, zoom: 1 + 0.004 * f.a.kick + 0.02 * exit, popupAvoid: this.avoid };
  }

  // ---------------------------------------------------------------- 海報
  /** 畫一面海報（內容沒變就不重畫；正在唱的歌詞每格重畫）。 */
  private drawFace(k: number, it: Item, j: number, t: number) {
    let sig = `${j}:${it.kind}`;
    if (it.kind === 'line') {
      const l = it.line;
      sig += t < l.start ? ':pre' : t > l.end ? ':post' : `:${t.toFixed(3)}`;
    }
    if (this.faceSig[k] === sig) return;
    this.faceSig[k] = sig;
    const L = this.faces[k]!, c = L.ctx;
    L.clear(rgba('paper'));
    c.textBaseline = 'alphabetic';
    // 印刷的底：邊緣很淡的暗角、一條細細的內框
    const g = c.createRadialGradient(BW / 2, BH / 2, BH * 0.3, BW / 2, BH / 2, BW * 0.62);
    g.addColorStop(0, rgba('sepia', 0)); g.addColorStop(1, rgba('sepia', 0.07));
    c.fillStyle = g; c.fillRect(0, 0, BW, BH);
    if (it.kind === 'ad') this.drawAd(c);
    else if (it.kind === 'msg') this.drawMsg(c);
    else if (it.kind === 'invite') this.drawInvite(c);
    else this.drawLyricFace(c, it.line, t);
    L.upload();
  }

  /** 看板本來的廣告：新人的名字、日期、一句冷面的話、一顆愛心。 */
  private drawAd(c: CanvasRenderingContext2D) {
    c.fillStyle = rgba('sepia');
    c.font = font(F.ming(900), 120);
    c.fillText(COUPLE_ZH, 120, 300);
    c.font = font(F.serif(400, true), 50);
    c.fillStyle = rgba('sepia', 0.75);
    c.fillText(COUPLE_EN, 126, 372);
    c.font = font(F.mono(500), 26); c.letterSpacing = '8px';
    c.fillStyle = rgba('blood');
    c.fillText(DATE_DOTS, 128, 450);
    c.letterSpacing = '0px';
    c.fillStyle = rgba('blood', 0.85);
    c.fillRect(128, 488, 90, 4);
    c.font = font(F.hei(500), 30); c.fillStyle = rgba('sepia', 0.7);
    c.fillText(AD_LINE, 128, 556);
    drawHeart(c, 1170, 318, 300, rgba('rose'));
  }

  /** 留言：大大的手寫字＋署名；新人的留言標一個小標籤；左下一行冷面的註腳。 */
  private drawMsg(c: CanvasRenderingContext2D) {
    const b = this.block!, m = this.msg!;
    c.font = font(FAM_MSG, b.fit.size);
    c.fillStyle = rgba('sepia');
    for (const ln of b.lines) fillWithHearts(c, ln.text, ln.x, ln.y);
    c.font = font(FAM_SIG, b.sig.size);
    c.fillStyle = rgba('sepia', 0.78);
    c.fillText(b.sig.text, b.sig.x, b.sig.y);
    c.fillStyle = rgba('blood', 0.85);
    c.fillRect(120, 40, 70, 4);
    if (m.couple) {
      c.font = font(F.mono(500), 20); c.letterSpacing = '5px'; c.fillStyle = rgba('blood');
      c.fillText('FROM THE COUPLE · 新人', 210, 50);
      c.letterSpacing = '0px';
    }
    c.font = font(F.hei(500), 20); c.fillStyle = rgba('sepia', 0.45);
    c.fillText(FOOT, 120, BH - 34);
  }

  private drawInvite(c: CanvasRenderingContext2D) {
    const ft = this.inviteFit!;
    c.font = font(FAM_MSG, ft.size); c.fillStyle = rgba('sepia');
    const top = (BH - ft.height) / 2 + ft.size * 0.85;
    ft.lines.forEach((ln, i) => c.fillText(ln, 140, top + i * ft.lineHeight));
    c.fillStyle = rgba('blood', 0.85);
    c.fillRect(140, top - ft.size - 40, 90, 4);
  }

  /** 沒有留言：歌詞印在看板上（焦點），逐字跟唱。 */
  private drawLyricFace(c: CanvasRenderingContext2D, line: Line, t: number) {
    const st = { family: FAM_LYR, size: 150, minSize: 84, maxW: BW - 240, maxRows: 2, align: 'left' as const, lineHeight: 1.12 };
    const lay = layoutRows(c, line, st);
    const y = (BH - lay.height) / 2 + lay.size * 0.8;
    c.save(); c.translate(120, y);
    drawRows(c, lay, FAM_LYR, t, paperInk());
    c.restore();
    c.fillStyle = rgba('blood', 0.85);
    c.fillRect(124, y - lay.size - 36, 90, 4);
  }

  /** 燈箱橫條：有留言放歌詞（逐字跟唱）；沒有留言放邀請；純音樂放歌名。 */
  private drawStrip(t: number) {
    const { lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const ly = this.msg ? shownLyric(lyrics, t, s, e) : null;
    let sig = 'static';
    if (ly) sig = `${ly.line.start}:${ly.live ? t.toFixed(3) : 'idle'}:${ly.k.toFixed(2)}`;
    if (sig === this.stripSig) return;
    this.stripSig = sig;
    const L = this.strip, c = L.ctx;
    // 燈箱：深色的壓克力面，字是亮的（後面有燈）；上下一條細細的亮邊
    L.clear(rgba('ink2'));
    const g = c.createLinearGradient(0, 0, 0, SPH);
    g.addColorStop(0, rgba('graphite', 0.22)); g.addColorStop(0.5, rgba('graphite', 0.08)); g.addColorStop(1, rgba('graphite', 0.2));
    c.fillStyle = g; c.fillRect(0, 0, SPW, SPH);
    c.textBaseline = 'alphabetic';
    if (ly) {
      const st = { family: FAM_LYR, size: this.lyrSize, minSize: 48, maxW: SPW - 70, maxRows: 1, align: 'left' as const };
      const lay = layoutRows(c, ly.line, st);
      c.save(); c.translate(36, SPH / 2 + lay.size * 0.36);
      drawRows(c, lay, FAM_LYR, t, darkInk(), ly.k);
      c.restore();
    } else if (this.msg || this.inviteFit) {
      // 有留言但沒有歌詞、或看板上已經是邀請：橫條放歌名
      c.font = font(F.mono(500), 22); c.letterSpacing = '5px'; c.fillStyle = rgba('bone', 0.6);
      c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`.toUpperCase(), 36, SPH / 2 + 8);
      c.letterSpacing = '0px';
    } else {
      c.font = font(F.hei(500), 30); c.fillStyle = rgba('bone', 0.82);
      c.fillText(INVITE, 36, SPH / 2 + 11);
    }
    L.upload();
  }
}

