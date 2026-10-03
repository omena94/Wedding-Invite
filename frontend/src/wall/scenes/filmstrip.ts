// 底片（暗）：一條 35mm 的正片舉在燈前，光從後面透過來——齒孔是亮的、片基是暗琥珀色、格子裡的字是亮的。
// 膠卷用 three.js 做成立體的一長條（微微彎向遠處，兩端比較遠、比較糊），鏡頭有景深。
//
// 動作：放映機的間歇拉片（intermittent pulldown）——拍點上「喀」一下拉一格（outExpo），格與格之間停住。
//  - 有留言：開頭是片頭倒數（3、2、1，一拍一格，格子裡的扇形掃一圈），小節線上主打格到位，
//    鏡頭同時推進，留言那一格填滿畫面：像默片的字幕卡（雙線框、宋體），歌詞是燒在片子下緣的字幕（逐字跟唱）。
//    停住的時候片子有一點點「片門晃動」與燈的閃爍（每秒 24 格）；窗格最後一拍再拉一格走。
//  - 沒有留言：每一格是一小段歌詞，唱到那一段的時候拉到那一格（跟著歌聲拉片），唱過的在左邊、還沒唱的在右邊。
//  - 純音樂又沒有留言：倒數之後是新人的名字（還沒定日期就不印日期那一行）、邀請，一小節一格；名字很長時縮字，不會超出格子。
// 格子的內容畫在各自的 Canvas（一次最多六格，照格號輪流用）：不變的格子只畫一次，正在唱、正在倒數的那一格每格重畫。
// 照「留言尺寸與版面比例標準 v2」：不再推成滿版特寫——鏡頭停在中景，膠卷斜斜地橫過畫面、往右後方退進暗處，
// 主打格停在畫面左三分之一（燈在它後面），字在螢幕上 40～60 px；右上方多了一個失焦的收片捲盤，拉片時跟著轉、
// 每個小節線被片子扯一下；右下角 HUD 那一段膠卷燈照不到。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE } from '../engine/gl';
import { GLSL_COMMON, THEME_UNIFORMS } from '../engine/glsl/common';
import { F, font } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp, frameIdx, TAU } from '../engine/util';
import type { Line, Word } from '../engine/lyrics';
import { fillWithHearts } from '../engine/motifs';
import { lyricAt, beatAfter, barAfter, COUPLE_ZH, DATE_DOTS, INITIALS, joinBits, fitPx, lyricSubOf, subSizeFor, subGap } from './_motifs';
import { lyricV2, V2 } from './_v2';
import { layoutRows, drawRows, darkInk, type RowsLayout } from './_t4';
import { winBeats, winBars, no3 } from './_t8';
import { msgBlockV2, loadAll, INVITE, type MsgBlock, type Rect } from './_t15';

export const spec: PlateSpecDecl = { group: 'type', family: 'craft', paper: false, energy: [0.3, 1], bars: [4, 8], weight: 1 };

/** 35mm 的比例（1 mm ≈ 33.3 單位）：一格 1267 長、片寬 1167、影像 1200×800、齒孔一格八個。 */
const PITCH = 1267, FW = 1167, IW = 1200, IH = 800;
const IX = (PITCH - IW) / 2, IY = (FW - IH) / 2;
const HOLE = { v: 492, w: 58, h: 82, n: 8 };
const POOL = 6;
/** 格子 Canvas 的解析度（相對邏輯像素）：特寫時一格約 1150 px 寬，0.95 倍就夠。 */
const CELL_SCALE = 0.95 * SCALE;
/** 膠卷彎曲的半徑（兩端往遠處彎）。 */
const BEND_R = 5200;
/** 留言格裡的排版（影像區座標）。 */
const MSG_BOX = { x: 110, y: 96, w: IW - 220, h: 500 };
const SUB = { y: 712, maxW: 980 };
const FAM_MSG = F.ming(700);
const FAM_LYR = F.archivo(100, 800);

type Kind = 'blank' | 'leader' | 'msg' | 'lyric' | 'title' | 'tail';
/**
 * subLine：這一格歌詞對應的原文（韓文歌；照時間切，跟這一格同一段唱的原文字）。
 * big：標題格是大字（新人的名字）還是小字（邀請）；不能用「有沒有 sub」判斷，還沒定日期的新人名字格沒有 sub。
 */
interface FrameDef { kind: Kind; n?: number; line?: Line; text?: string; sub?: string; sub2?: string; big?: boolean; t0?: number; t1?: number; subLine?: Line }
/** 片邊印字：新人的縮寫＋日期（沒定日期就只有縮寫）。 */
const EDGE = joinBits(' · ', INITIALS, DATE_DOTS.replace(/ /g, ''));
interface Move { t: number; to: number; dur: number }

const VERT = /* glsl */ `
precision highp float;
in vec3 position; in vec2 uv;
uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix;
uniform float x0; uniform float bendR;
out vec2 vUv; out float vDepth;
void main() {
  vUv = uv;
  float wx = x0 + position.x;
  vec4 mv = modelViewMatrix * vec4(wx, position.y, -wx * wx / (2.0 * bendR), 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
precision highp float;
precision highp int;
in vec2 vUv; in float vDepth;
out vec4 fragColor;
${GLSL_COMMON}
uniform sampler2D tex; uniform vec2 texPx; uniform float fk; uniform float t;
uniform vec3 lamp;      // 燈在畫面上的位置（px，y 向上）與半徑
uniform float lampK;    // 燈的亮度（閃爍、拍點）
uniform float focus; uniform float aperture;
uniform float ext;      // 網格左右多出來的一點（避免格與格之間有縫）
const float PITCH = ${PITCH}.0, FW = ${FW}.0;
float sdRR(vec2 p, vec2 c, vec2 hs, float r) { vec2 d = abs(p - c) - hs + r; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }
void main() {
  float u = vUv.x * (PITCH + 2.0 * ext) - ext;   // 沿著膠卷
  float v = (vUv.y - 0.5) * FW;                  // 橫過膠卷（向上）
  float av = abs(v);
  // 燈：畫面中間最亮，往外暗下去
  vec2 lp = FRAG_PX - lamp.xy;
  float L = lampK * (0.07 + 1.12 * exp(-dot(lp, lp) / (lamp.z * lamp.z)));
  // 右下角（QR 與留言數）那一塊燈照不太到：亮亮的齒孔不要跟 HUD 的字搶
  vec2 hq = max(vec2(1340.0, 0.0) - FRAG_PX, vec2(0.0)) * vec2(1.0, 0.0) + max(FRAG_PX - vec2(9999.0, 260.0), vec2(0.0));
  L *= 1.0 - 0.6 * (1.0 - smoothstep(0.0, 220.0, length(hq)));
  vec3 lc = mix(C_BONE, C_SIGNAL, 0.32);
  // 片基（暗琥珀）、影像區（幾乎不透光）、格線（全黑）
  float inImg = step(abs(u - PITCH * 0.5), ${IW / 2}.0) * step(av, ${IH / 2}.0);
  vec3 T = mix(C_BLOOD * 0.07 + C_INK2 * 0.3, C_INK2 * 0.2, inImg);
  // 齒孔：透光（最亮），邊緣圓角
  float hu = mod(u, PITCH / ${HOLE.n}.0) - PITCH / ${HOLE.n * 2}.0;
  float dh = sdRR(vec2(hu, av), vec2(0.0, ${HOLE.v}.0), vec2(${HOLE.w / 2}.0, ${HOLE.h / 2}.0), 11.0);
  float coc = aperture * abs(vDepth - focus) / max(vDepth, 1.0);
  float hole = 1.0 - smoothstep(-1.0 - coc * 0.6, 1.0 + coc * 0.6, dh);
  T = mix(T, vec3(0.62), hole); // 透光的齒孔：亮但不要亮到整片起霧（bloom 會把畫面洗灰）
  // 格子的內容（字、倒數的圈）：亮的，景深用四點平均
  vec2 st = vec2(clamp(u, 0.0, PITCH) / PITCH, vUv.y);
  vec2 o = vec2(max(coc, 0.0) * 0.45) / texPx * ${CELL_SCALE.toFixed(3)};
  vec4 c = 0.25 * (fastLayer(textureLod(tex, st + vec2(o.x, o.y * 0.4), 0.0)) + fastLayer(textureLod(tex, st + vec2(-o.x * 0.4, o.y), 0.0))
    + fastLayer(textureLod(tex, st + vec2(-o.x, -o.y * 0.4), 0.0)) + fastLayer(textureLod(tex, st + vec2(o.x * 0.4, -o.y), 0.0)));
  T = T * (1.0 - c.a) + c.rgb * 0.82;
  // 片子的刮痕與灰塵（每秒 12 次換一個樣子，很淡）：直的細刮痕、小亮點
  float fr = floor(t * 12.0);
  for (int i = 0; i < 2; i++) {
    float sx = hash12(vec2(fk * 7.0 + float(i), fr)) * PITCH;
    float on = step(0.7, hash12(vec2(fk + float(i) * 3.0, fr + 5.0)));
    T += C_BONE * 0.025 * on * inImg * (1.0 - smoothstep(0.3, 1.3, abs(u - sx)));
  }
  vec2 cell = floor(vec2(u, v) / 9.0);
  T += C_BONE * 0.25 * inImg * step(0.9993, hash12(cell + fr * 13.1));
  // 膠卷的邊（抗鋸齒）
  float edge = 1.0 - smoothstep(FW * 0.5 - 2.0 - coc * 0.3, FW * 0.5 + coc * 0.3, av);
  vec3 col = T * lc * L;
  fragColor = vec4(col * edge, edge);
}`;

/** 背景：暗房間，燈在膠卷後面暈開（膠卷上下看得到一點光）、幾顆失焦的灰塵。 */
const BG = () => new FSPass(/* glsl */ `
  uniform vec3 lamp; uniform float lampK; uniform float t; uniform float reel;
  void main() {
    vec2 p = FRAG_PX;
    vec2 d = p - lamp.xy;
    float r = length(d);
    vec3 col = C_INK * 0.5 + mix(C_SIGNAL, C_BLOOD, 0.45) * lampK * (0.06 * exp(-r / (lamp.z * 0.8)) + 0.01 * exp(-r / 1400.0));
    // 收片的捲盤（右上方、在膠卷後面、失焦）：放映機漏出來的一片光裡的剪影——暗色的盤面、五個鏤空透光、
    // 盤緣朝燈的那一邊一道細光；角度跟著拉片轉（捲盤在收片）
    vec2 rc = vec2(${W}.0 - 300.0, ${H}.0 - 150.0), q = p - rc;
    float rr = length(q), R = 360.0, bl = 14.0;
    vec3 spill = mix(C_SIGNAL, C_BLOOD, 0.5) * 0.055 * lampK * exp(-length(q - vec2(-40.0, 60.0)) / 520.0);
    col += spill;
    float disk = 1.0 - smoothstep(R - bl, R + bl, rr);
    float hole = 0.0;
    for (int i = 0; i < 5; i++) {
      float ha = float(i) * 1.2566;
      vec2 hc = vec2(cos(ha - reel), sin(ha - reel)) * R * 0.55;
      hole = max(hole, 1.0 - smoothstep(R * 0.22 - bl, R * 0.22 + bl, length(q - hc)));
    }
    float hub = 1.0 - smoothstep(R * 0.09 - bl, R * 0.09 + bl, rr);
    // 盤面上一圈一圈的片子（纏好的膠卷）：比盤面亮一點點的同心細紋
    float wound = (1.0 - smoothstep(R * 0.3, R * 0.32, rr)) * smoothstep(R * 0.1, R * 0.12, rr);
    vec3 reelC = C_INK * 0.28 + mix(C_SIGNAL, C_BLOOD, 0.5) * 0.02 * wound * (0.6 + 0.4 * sin(rr * 0.9));
    reelC += mix(C_SIGNAL, C_BLOOD, 0.3) * 0.09 * lampK * exp(-abs(rr - R + 8.0) / 9.0) * max(0.0, dot(normalize(q), normalize(lamp.xy - rc)));
    col = mix(col, reelC, disk * (1.0 - hole * (1.0 - wound)) * (1.0 - hub * 0.5));
    // 光裡的灰塵（大大的、失焦、慢慢飄）
    for (int i = 0; i < 7; i++) {
      float fi = float(i);
      vec2 c = vec2(hash11(fi * 3.1) * ${W}.0, mod(hash11(fi * 7.7) * ${H}.0 + t * (8.0 + 10.0 * hash11(fi)), ${H + 200}.0) - 100.0);
      float rr = 26.0 + 40.0 * hash11(fi * 5.3);
      col += C_SIGNAL * 0.035 * lampK * (1.0 - smoothstep(rr * 0.8, rr, length(p - c))) * exp(-length(c - lamp.xy) / 900.0);
    }
    fragColor = vec4(col, 1.0);
  }`, { lamp: { value: new THREE.Vector3(W / 2, H / 2, 700) }, lampK: { value: 1 }, t: { value: 0 }, reel: { value: 0 } });

/** 片頭倒數的一格：圓、十字線、大數字；sweep 0..1 是掃過的扇形。 */
function drawLeader(c: CanvasRenderingContext2D, n: number, sweep: number) {
  const cx = IX + IW / 2, cy = IY + IH / 2;
  c.save();
  c.strokeStyle = rgba('bone', 0.55); c.lineWidth = 4;
  c.beginPath(); c.moveTo(IX + 30, cy); c.lineTo(IX + IW - 30, cy); c.moveTo(cx, IY + 24); c.lineTo(cx, IY + IH - 24); c.stroke();
  c.lineWidth = 7; c.strokeStyle = rgba('bone', 0.8);
  c.beginPath(); c.arc(cx, cy, 300, 0, TAU); c.stroke();
  c.lineWidth = 3; c.beginPath(); c.arc(cx, cy, 262, 0, TAU); c.stroke();
  if (sweep > 0) {
    c.fillStyle = rgba('bone', 0.16);
    c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, 262, -Math.PI / 2, -Math.PI / 2 + TAU * sweep); c.closePath(); c.fill();
  }
  c.font = font(F.archivo(100, 900), 360); c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = rgba('bone', 0.92);
  c.fillText(String(n), cx, cy + 10);
  c.restore();
}

/** 片邊的小字（格號、片名），像真的片邊印字，很淡。 */
function drawEdge(c: CanvasRenderingContext2D, k: number) {
  c.save();
  c.font = font(F.mono(500), 22); c.letterSpacing = '5px'; c.fillStyle = rgba('signal', 0.3);
  c.textBaseline = 'middle';
  const num = 10 + k;
  c.fillText(`▸ ${num}`, 40, IY - 26);
  c.fillText(`${num}A`, PITCH * 0.55, IY - 26);
  c.fillText(EDGE, 60, IY + IH + 28);
  c.restore();
}

export default class Filmstrip extends Scene {
  bg = shared('filmstrip.bg', BG);
  scene3 = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(30, W / H, 50, 40000);
  cells: { L: Layer2D; mesh: THREE.Mesh; mat: THREE.RawShaderMaterial; k: number; key: string }[] = [];
  geo = new THREE.PlaneGeometry(PITCH + 4, FW, 28, 1);
  msg: Msg | null = this.ctx.params.message ?? null;
  frames: FrameDef[] = [];
  moves: Move[] = [];
  pos0 = 0;
  /** 主打格（或第一段歌詞）的格號與到位時間。 */
  hero = -1; tHero = 0;
  block: MsgBlock | null = null;
  msgCanvas: HTMLCanvasElement | null = null;
  beat = 0.5;
  mode: 'msg' | 'lyric' | 'title' = 'msg';
  lyrSize = 54;
  /** 膠卷上 1 單位在螢幕上是幾 px（落定的機位、主打格那裡）：v2 的字級是螢幕 px，畫到格子上要除以它。 */
  k = 0.55;
  bars: number[] = [];

  override async init() {
    const { audio: au, lyrics, start: s, end: e } = this.ctx;
    this.beat = au.beatPeriod(s);
    const lines = lyrics.linesIn(s - 0.5, e);
    await loadAll(this.msg, lines.map((l) => l.text + (lyricSubOf(l)?.text ?? '')).join(''), `${COUPLE_ZH}${DATE_DOTS}${INVITE}${EDGE}▸新人留言`);
    this.mode = this.msg ? 'msg' : lines.length ? 'lyric' : 'title';
    this.bars = winBars(au, s, e).filter((b) => b > s + 0.05);
    // 落定的機位下，主打格（原點）附近 100 單位在螢幕上多長
    this.pose(Infinity);
    const pa = new THREE.Vector3(-50, 0, 0).project(this.cam), pb = new THREE.Vector3(50, 0, 0).project(this.cam);
    this.k = Math.hypot((pb.x - pa.x) * W / 2, (pb.y - pa.y) * H / 2) / 100;
    const beats = winBeats(au, s, e).filter((b) => b > s + 0.05);
    const pull = Math.min(0.2, this.beat * 0.45);

    if (this.mode === 'msg') {
      // 倒數：主打格在「第一拍後的第一個小節線」到位（太晚就改在第二拍），之前每一拍拉一格
      let arrive = barAfter(au, s + this.beat * 1.2);
      if (arrive - s > this.beat * 4.6) arrive = beats[1] ?? beatAfter(au, s + 0.05);
      const pre = beats.filter((b) => b < arrive - 0.05).slice(-3);
      this.frames.push({ kind: 'blank' });
      pre.forEach((_, i) => this.frames.push({ kind: 'leader', n: pre.length - i }));
      this.hero = this.frames.length;
      this.frames.push({ kind: 'msg' }, { kind: 'tail' }, { kind: 'blank' });
      pre.forEach((b, i) => this.moves.push({ t: b, to: i + 1, dur: pull }));
      this.moves.push({ t: arrive, to: this.hero, dur: pull * 1.2 });
      this.tHero = arrive;
      // 窗格最後再拉一格走（留言已經停夠久才走）
      const out = e - Math.min(0.32, this.beat * 0.7);
      if (out - arrive > 2.2) this.moves.push({ t: out, to: this.hero + 1, dur: pull });
      this.buildMsg();
    } else if (this.mode === 'lyric') {
      // 每一段歌詞一格；唱到那一段就拉到那一格。第一段還早的話，先倒數
      const chunks = lines.flatMap((l) => this.chunk(l));
      const first = chunks[0]!;
      const pre = beats.filter((b) => b < first.t0! - 0.15).slice(-2);
      if (first.t0! - 0.12 > s + 0.05) {
        this.frames.push({ kind: 'blank' });
        pre.forEach((_, i) => this.frames.push({ kind: 'leader', n: pre.length - i }));
        pre.forEach((b, i) => this.moves.push({ t: b, to: i + 1, dur: pull }));
      }
      this.hero = this.frames.length;
      chunks.forEach((ch, i) => {
        this.frames.push(ch);
        const tt = ch.t0! - 0.12;
        if (tt > s + 0.05) this.moves.push({ t: tt, to: this.hero + i, dur: pull });
        else this.pos0 = this.hero + i;
      });
      this.frames.push({ kind: 'tail' }, { kind: 'blank' });
    } else {
      // 純音樂、沒有留言：倒數兩格，接著名字、日期、邀請，一小節一格
      this.frames.push({ kind: 'blank' }, { kind: 'leader', n: 2 }, { kind: 'leader', n: 1 });
      const bars = winBars(au, s, e).filter((b) => b > s + 0.05);
      const t1 = beats[0] ?? s + 0.3, t2 = beats[1] ?? s + 0.8;
      this.moves.push({ t: t1, to: 1, dur: pull }, { t: t2, to: 2, dur: pull });
      this.hero = 3;
      this.frames.push({ kind: 'title', text: COUPLE_ZH, sub: DATE_DOTS, big: true }, { kind: 'title', text: INVITE.split('，')[0] + '，', sub2: INVITE.split('，')[1] }, { kind: 'tail' }, { kind: 'blank' });
      const tb = bars.find((b) => b > t2 + this.beat * 0.9) ?? t2 + this.beat;
      this.moves.push({ t: tb, to: 3, dur: pull });
      const tb2 = bars.find((b) => b > tb + 0.1 && b < e - 1.5);
      if (tb2 !== undefined) this.moves.push({ t: tb2, to: 4, dur: pull });
      this.tHero = tb;
    }

    // 六個格子（輪流用）：各自一張 Canvas、一個材質
    for (let j = 0; j < POOL; j++) {
      const L = this.track(new Layer2D(PITCH, FW, CELL_SCALE, { fast: true }));
      const mat = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG,
        uniforms: {
          ...THEME_UNIFORMS, tex: { value: L.texture }, texPx: { value: new THREE.Vector2(L.canvas.width, L.canvas.height) },
          fk: { value: 0 }, t: { value: 0 }, x0: { value: 0 }, bendR: { value: BEND_R }, ext: { value: 2 },
          lamp: { value: new THREE.Vector3() }, lampK: { value: 1 }, focus: { value: 2000 }, aperture: { value: 0 },
        },
        transparent: true, depthTest: false, depthWrite: false,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.frustumCulled = false;
      this.scene3.add(mesh);
      this.cells.push({ L, mesh, mat, k: -999, key: '' });
    }
  }

  /** 一行歌詞切成幾格：一格最多兩行、字不小於 112（空白、標點處優先斷），每格是一個小的 Line（字的時間照原本的）。 */
  private chunk(line: Line): FrameDef[] {
    const c = this.cells[0]?.L.ctx ?? document.createElement('canvas').getContext('2d')!;
    c.font = font(FAM_LYR, lyricV2(null) / this.k);
    const ws = line.words, out: FrameDef[] = [];
    const cap = 1000 * 2 * 0.86;
    let a = 0;
    while (a < ws.length) {
      let b = a + 1, good = -1;
      while (b < ws.length) {
        const txt = line.text.slice(ws[a]!.o, ws[b]!.o + ws[b]!.w.length);
        if (c.measureText(txt).width > cap) break;
        b++;
        // 斷在空白或標點後面比較好讀
        if (/[\s，。！？、,.!?]$/.test(line.text.slice(ws[a]!.o, ws[b - 1]!.o + ws[b - 1]!.w.length + 1))) good = b;
      }
      if (b < ws.length && good > a + (b - a) / 2) b = good;
      const base = ws[a]!.o, last = ws[b - 1]!;
      const words: Word[] = ws.slice(a, b).map((w) => ({ ...w, o: w.o - base }));
      const sub: Line = { i: line.i * 100 + a, text: line.text.slice(base, last.o + last.w.length), start: ws[a]!.start, end: last.end, words };
      out.push({ kind: 'lyric', line: sub, t0: sub.start, t1: sub.end });
      a = b;
    }
    // 原文副行：照時間分給每一格（這一格開始唱到下一格開始唱之間的原文字），印在同一格的中文下面
    const orig = lyricSubOf(line);
    if (orig) {
      out.forEach((fd, i) => {
        const nx = out[i + 1]?.t0 ?? Infinity;
        const ws = orig.words.filter((w) => (i === 0 || w.start >= fd.t0!) && w.start < nx);
        if (!ws.length) return;
        const base = ws[0]!.o, last = ws[ws.length - 1]!;
        fd.subLine = { i: -(line.i * 100 + i + 1), text: orig.text.slice(base, last.o + last.w.length), start: ws[0]!.start, end: last.end, words: ws.map((w) => ({ ...w, o: w.o - base })) };
      });
    }
    return out;
  }

  /** 留言格（默片的字幕卡）：雙線框、宋體置中、署名；排好後先畫在一張離屏 Canvas，之後只貼上去。 */
  private buildMsg() {
    const m = this.msg!;
    const cv = document.createElement('canvas');
    cv.width = Math.round(PITCH * CELL_SCALE); cv.height = Math.round(FW * CELL_SCALE);
    const c = cv.getContext('2d')!;
    c.scale(CELL_SCALE, CELL_SCALE);
    const b = msgBlockV2(c, m, FAM_MSG, MSG_BOX.w, MSG_BOX.h, { k: this.k, lineHeight: 1.36 });
    this.block = b;
    c.translate(IX, IY);
    // 雙線框與四個角的小菱形
    c.strokeStyle = rgba('bone', 0.5); c.lineWidth = 3; c.strokeRect(40, 36, IW - 80, IH - 72);
    c.lineWidth = 1.5; c.strokeRect(54, 50, IW - 108, IH - 100);
    c.fillStyle = rgba('bone', 0.6);
    for (const [x, y] of [[40, 36], [IW - 40, 36], [40, IH - 36], [IW - 40, IH - 36]] as const) {
      c.beginPath(); c.moveTo(x, y - 9); c.lineTo(x + 9, y); c.lineTo(x, y + 9); c.lineTo(x - 9, y); c.closePath(); c.fill();
    }
    if (m.couple) {
      c.font = font(F.hei(500), 20 / this.k); c.letterSpacing = '8px'; c.fillStyle = rgba('signal', 0.8); c.textAlign = 'center';
      c.fillText('新人留言', IW / 2, 60 + 20 / this.k); c.letterSpacing = '0px';
    }
    c.font = font(FAM_MSG, b.fit.size); c.fillStyle = rgba('bone', 0.97); c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    b.fit.lines.forEach((ln, i) => {
      const w = c.measureText(ln).width;
      fillWithHearts(c, ln, MSG_BOX.x + (MSG_BOX.w - w) / 2, MSG_BOX.y + b.top + i * b.fit.lineHeight);
    });
    c.font = font(FAM_MSG, b.sigSize); c.fillStyle = rgba('bone', 0.62); c.textAlign = 'center';
    c.fillText(b.sig, IW / 2, MSG_BOX.y + b.sigY);
    this.msgCanvas = cv;
    // 字幕比留言小一點（v2：螢幕上 40～52）
    this.lyrSize = lyricV2(b.fit.size * this.k) / this.k;
  }

  /**
   * 鏡頭：從右邊比較遠的地方搖進來、落定（有留言時落在主打格到位的那一刻）；落定後在膠卷前方偏左，
   * 看向主打格右邊一點——主打格在畫面左三分之一，膠卷往右後方退進暗處。整段慢慢推近。t = Infinity 是落定的機位（算字級用）。
   */
  private pose(t: number, jitterY = 0) {
    const s = this.ctx.start, e = this.ctx.end, beat = this.beat;
    const land = t === Infinity ? 1 : this.mode === 'msg'
      ? ease.outExpo(prog(t, s, s + 0.35)) * 0.35 + 0.65 * ease.outExpo(prog(t, this.tHero - 0.02, this.tHero + Math.max(0.6, beat * 1.4)))
      : ease.outExpo(prog(t, s, s + Math.max(0.5, beat * 1.5)));
    const push = t === Infinity ? 0 : ease.inOutCubic(prog(t, s, e));
    const sway = t === Infinity ? 0 : 40 * Math.sin((t - s) * 0.5);
    const dist = lerp(4300, 3150, land) * (1 - 0.04 * push);
    const cx = lerp(-1300, -760, land) + sway;
    this.cam.position.set(cx, -80 + jitterY, dist);
    this.cam.up.set(Math.sin(0.075), Math.cos(0.075), 0);
    this.cam.lookAt(lerp(900, 470, land), jitterY + 20, 0);
    this.cam.updateMatrixWorld();
    this.cam.updateProjectionMatrix();
    return dist;
  }

  /** 片子現在的位置（格號，小數 = 正在拉）。 */
  private posAt(t: number) {
    let p = this.pos0;
    for (const m of this.moves) {
      if (t < m.t) break;
      p += (m.to - p) * ease.outExpo(clamp((t - m.t) / m.dur));
    }
    return p;
  }

  /** 一格的內容：不變的格子用 key 判斷要不要重畫；正在倒數、正在唱、字幕在動的格子每格重畫（內容只由 t 決定）。 */
  private drawCell(cell: (typeof this.cells)[number], k: number, t: number) {
    const fd = this.frames[k];
    let key = `${k}`;
    let dyn = false;
    if (fd?.kind === 'leader') {
      const mv = this.moves.find((m) => m.to === k);
      const nx = this.moves.find((m) => m.to === k + 1);
      if (mv && t >= mv.t && (!nx || t < nx.t)) dyn = true;
      else key += mv && t >= mv.t ? ':done' : ':pre';
    } else if (fd?.kind === 'lyric') {
      // 有原文時，原文唱完才算這一格唱完（原文的逐字時間可能比中文晚一點結束）
      const t0 = Math.min(fd.t0!, fd.subLine?.start ?? Infinity), t1 = Math.max(fd.t1!, fd.subLine?.end ?? -Infinity);
      if (t >= t1) key += ':sung'; else if (t < t0) key += ':pre'; else dyn = true;
    } else if (fd?.kind === 'msg') {
      if (lyricAt(this.ctx.lyrics, t)) dyn = true; else key += ':nosub';
    }
    if (!dyn && cell.key === key) return;
    cell.key = dyn ? 'dyn' : key;
    const L = cell.L, c = L.ctx;
    L.clear();
    if (fd) {
      drawEdge(c, k);
      c.save();
      if (fd.kind === 'leader') {
        const mv = this.moves.find((m) => m.to === k);
        drawLeader(c, fd.n ?? 1, dyn && mv ? clamp((t - mv.t) / this.beat) : 0);
      } else if (fd.kind === 'msg' && this.msgCanvas) {
        c.drawImage(this.msgCanvas, 0, 0, PITCH, FW);
        const ly = lyricAt(this.ctx.lyrics, t);
        if (ly) {
          const lay = layoutRows(c, ly.line, { family: FAM_LYR, size: this.lyrSize, minSize: Math.min(this.lyrSize, V2.lyrMin / this.k), maxW: SUB.maxW, maxRows: 2, align: 'center', lineHeight: 1.1 });
          c.translate(IX + IW / 2, IY + SUB.y - (lay.rows.length - 1) * lay.lineHeight);
          drawRows(c, lay, FAM_LYR, t, darkInk(), ly.k);
        }
      } else if (fd.kind === 'lyric' && fd.line) {
        const lay = this.lyrLay(c, fd.line);
        // 原文副行：同一格、中文正下方，小一號（字級照螢幕 px 算再換回格子）；整塊一起在格子裡置中
        const sl = fd.subLine ? this.subLay(c, fd.subLine, lay.size) : null;
        const gap = sl ? subGap(lay.size * this.k, sl.size * this.k) / this.k : 0;
        const extra = sl ? gap + (sl.rows.length - 1) * sl.lineHeight : 0;
        c.translate(IX + IW / 2, IY + (IH - lay.height - extra) / 2 + lay.size * 0.86);
        drawRows(c, lay, FAM_LYR, t, darkInk(), 1);
        if (sl) {
          // 比中文安靜：唱到、唱完都是紙白（不用訊號色）再淡兩成，還沒唱的一樣三成
          c.translate(0, (lay.rows.length - 1) * lay.lineHeight + gap);
          drawRows(c, sl, FAM_LYR, t, { active: rgba('bone', 0.96 * 0.8), sung: rgba('bone', 0.96 * 0.8), unsung: rgba('bone', 0.3) }, 1);
        }
      } else if (fd.kind === 'title' && fd.text) {
        const big = !!fd.big;
        c.textAlign = 'center'; c.fillStyle = rgba('bone', 0.95);
        const kk = this.k;
        // 名字是執行時才知道的，很長的話縮到格子裡（雙線框內緣再留一點邊）；沒有日期時名字往下移到格子正中
        const fam = big ? F.ming(900) : F.hei(500);
        c.font = font(fam, fitPx(fd.text, fam, (big ? 60 : 40) / kk, IW - 200));
        c.fillText(fd.text, IX + IW / 2, IY + IH / 2 + (big ? (fd.sub ? 20 : 20 / kk) : -10 / kk));
        if (fd.sub2) c.fillText(fd.sub2, IX + IW / 2, IY + IH / 2 + 46 / kk);
        if (fd.sub) {
          c.font = font(F.mono(500), 24 / kk); c.letterSpacing = '10px'; c.fillStyle = rgba('signal', 0.8);
          c.fillText(fd.sub, IX + IW / 2, IY + IH / 2 + 20 + 56 / kk);
        }
      } else if (fd.kind === 'tail') {
        // 片尾：一顆小小的愛心，像手刮在片子上的記號
        c.fillStyle = rgba('rose', 0.85);
        const hx = IX + IW / 2, hy = IY + IH / 2;
        c.beginPath(); c.moveTo(hx, hy + 40);
        c.bezierCurveTo(hx - 70, hy - 10, hx - 40, hy - 70, hx, hy - 34);
        c.bezierCurveTo(hx + 40, hy - 70, hx + 70, hy - 10, hx, hy + 40); c.fill();
      }
      c.restore();
    }
    L.upload();
  }

  private lyrLays = new Map<Line, RowsLayout>();
  private subLay(c: CanvasRenderingContext2D, line: Line, mainSize: number) {
    let l = this.lyrLays.get(line);
    if (!l) { const sz = subSizeFor(mainSize * this.k) / this.k; l = layoutRows(c, line, { family: FAM_LYR, size: sz, minSize: Math.min(sz, 26 / this.k), maxW: 1060, maxRows: 2, align: 'center', lineHeight: 1.12 }); this.lyrLays.set(line, l); }
    return l;
  }
  private lyrLay(c: CanvasRenderingContext2D, line: Line) {
    let l = this.lyrLays.get(line);
    if (!l) { l = layoutRows(c, line, { family: FAM_LYR, size: lyricV2(null) / this.k, minSize: V2.lyrMin / this.k, maxW: 1060, maxRows: 2, align: 'center', lineHeight: 1.12 }); this.lyrLays.set(line, l); }
    return l;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    // 停住的時候有一點片門晃動（每秒 24 次）
    const fi = Math.floor(t * 24);
    const moving = this.moves.some((m) => t >= m.t && t < m.t + m.dur);
    const weave = moving ? 0 : (hash(fi, 3) - 0.5) * 0.0016;
    const pos = this.posAt(t) + weave;

    // ---- 鏡頭（pose）：遠景落定成中景，主打格在左三分之一；停住時有一點片門晃動
    const jitterY = moving ? 0 : (hash(fi, 7) - 0.5) * 1.6;
    const dist = this.pose(t, jitterY);
    // 燈在正中那一格後面：用那一格的中心投到畫面
    const cp = new THREE.Vector3(0, 0, 0).project(this.cam);
    const lampX = (cp.x * 0.5 + 0.5) * W, lampY = (cp.y * 0.5 + 0.5) * H;
    const flick = moving ? 1 : 1 + 0.035 * (hash(fi, 11) - 0.5);
    const lampK = clamp(prog(t, s, s + 0.12)) * flick * (1 + 0.08 * f.a.kick) * (1 - 0.6 * ease.inCubic(prog(t, e - 0.12, e)));
    const lampR = this.mode === 'msg' ? lerp(520, 720, ease.outExpo(prog(t, this.tHero, this.tHero + 0.6))) : 640;
    // 捲盤：片子拉多少就轉多少，每個小節線被片子扯一下（往前一小段、outExpo）
    let reel = pos * 0.55;
    for (const b of this.bars) if (t >= b) reel += 0.22 * ease.outExpo(clamp((t - b) / 0.35));
    this.bg.u.reel!.value = reel;

    this.bg.u.t!.value = t;
    (this.bg.u.lamp!.value as THREE.Vector3).set(lampX, lampY, lampR);
    this.bg.u.lampK!.value = lampK;
    this.bg.render(renderer, out);

    // ---- 格子：看得到的格號（正中的前後幾格），照格號輪流用六個格子
    const k0 = Math.floor(pos) - 2;
    const focus = dist;
    for (let k = k0; k < k0 + POOL; k++) {
      const cell = this.cells[((k % POOL) + POOL) % POOL]!;
      if (cell.k !== k) { cell.k = k; cell.key = ''; }
      this.drawCell(cell, k, t);
      const u = cell.mat.uniforms;
      u.x0!.value = (k - pos) * PITCH;
      u.fk!.value = k; u.t!.value = t;
      (u.lamp!.value as THREE.Vector3).set(lampX, lampY, lampR);
      u.lampK!.value = lampK;
      u.focus!.value = focus; u.aperture!.value = 26;
    }
    renderer.setRenderTarget(out);
    renderer.render(this.scene3, this.cam);

    // 主打格在畫面上的範圍
    const avoid: Rect[] = [];
    if (this.hero >= 0) {
      const cx = (this.hero - pos) * PITCH;
      const a = new THREE.Vector3(cx - IW / 2, IH / 2, -cx * cx / (2 * BEND_R)).project(this.cam);
      const b = new THREE.Vector3(cx + IW / 2, -IH / 2, -cx * cx / (2 * BEND_R)).project(this.cam);
      const x0 = (Math.min(a.x, b.x) * 0.5 + 0.5) * W, x1 = (Math.max(a.x, b.x) * 0.5 + 0.5) * W;
      const y0 = (0.5 - Math.max(a.y, b.y) * 0.5) * H, y1 = (0.5 - Math.min(a.y, b.y) * 0.5) * H;
      avoid.push([Math.round(x0), Math.round(y0), Math.round(x1 - x0), Math.round(y1 - y0)]);
    }
    return { bloom: 0.35, halation: 0.12, vignette: 0.75, popupAvoid: avoid };
  }

  override dispose() {
    for (const c of this.cells) c.mat.dispose();
    this.geo.dispose();
    super.dispose();
  }
}
