// 紅包（批次 T4・紙本 D，暗）：一個紅包袋躺在深色的漆器桌上，上面吊著一盞燈籠（畫面外），燈籠隨著節拍輕輕擺，
// 暖光與它在亮漆面上拉長的倒影一起左右晃。紅包袋是訊號色的暗部（blood）的紙，字與花飾燙金。
//  - 開場：鏡頭貼著紅包，仙女棒的火花沿著吉祥話外面那一圈燙金框「畫」出來（畫過的地方燙金才出現，剛畫的還是燒紅的）。
//  - 吉祥話的位置就是歌詞：中文直排（由右到左、一個字一個字燙上去），正在唱的字燒紅發光、唱完是金、還沒唱的只是淡淡的壓印；
//    英文句子橫排。
//  - 下一個小節線：封口的舌蓋掀開（3D，翻到後面），緊接著一張紙從袋口抽出來、飛到紅包旁邊，在拍點上落下——
//    主打留言寫在這張紙上（手寫、最大、是焦點）。鏡頭拉開、焦點從紅包拉到紙上。
//  - 沒有留言：紙上寫「這個紅包留給你」＋一句邀請。純音樂：吉祥話的位置寫歌名。
// 畫法：紅包（舌蓋＋袋身攤成一張）與紙條各畫進一張 render target；燙金的形狀（框、囍、歌詞）畫在一張遮罩 Canvas（每格重畫，
// 紅色通道標記「正在唱」），燙金 shader 讀遮罩算凸版的明暗、火花附近的熱、每個小節線掃過的反光。
// 紅包袋、舌蓋（正面＋背面的內襯）、紙條是 three.js 的網格，交給 _t4 的舞台拍（深色漆器、燈籠的光與倒影、影子、景深）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, lerp, pulse, noise1, TAU } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { Lyrics, type Line, type Word } from '../engine/lyrics';
import { lyricAt, lyricSubOf, subGap, subSizeFor, signature, sparkHead, sparkParticles, COUPLE_EN, DATE_DOTS } from './_motifs';
import { grid, drawFit, layoutRows, drawRows, Stage, docRT, camDist, FOIL_GLSL, type Grid, type RowsStyle, type V3, type P2 } from './_t4';
import { msgMaxFor, lyricV2, sigV2, V2, fitClauses } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'doc', paper: false, energy: [0.25, 0.9], bars: [4, 8] };

// ---------------------------------------------------------------- 尺寸（像素）
const EW = 600, EH = 980, FH = 230; // 袋身、舌蓋的高
const AH = FH + EH; // 紅包的展開圖：上面是舌蓋、下面是袋身
const NW = 760, NH = 470; // 紙條（橫的；在袋子裡是直的）。v2：畫面上約 700×430
const NTOP = 92; // 紙條上面的小標
const SIG_K = 1.5; // 署名佔的高度 = 署名字級 × SIG_K
const ZONE = { x: 80, y: FH + 390, w: EW - 160, h: 470 }; // 吉祥話（歌詞）的位置（展開圖座標）
const FRAME = { x: 54, y: FH + 360, w: EW - 108, h: 530, r: 26 }; // 火花畫出來的燙金框
const EMBLEM = { x: EW / 2, y: FH + 262, r: 64 };
const ENV: V3 = [-330, 0, 2]; // 紅包在桌上的位置（中心）
const LAND: V3 = [380, 70, 9]; // 紙條落下的位置
// 符號（♪ ∞ ☑ → 之類）不在打包時掃的中文範圍裡，要跟中文一起預載，不然第一次畫會用備援字型（確定性也會不過）
const TEXT = '♪∞☑☐→·—♥%＄$囍紅包裡的一句話這個紅包留給你掃描右下角把祝福包進紅包純音樂賀新人';

// ---------------------------------------------------------------- 紅包的紙（袋身與舌蓋）
const ENV_BG = () => new FSPass(/* glsl */ `
  uniform float slit;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${AH}.0 - FRAG_PX.y);
    float f = fbm(p / 90.0, 3), fine = snoise(p / 5.0);
    // 壓紋：很淡的波浪紋（像祥雲的簡化），只在袋身
    float wave = sin(p.x / 18.0 + 3.0 * sin(p.y / 46.0)) * sin(p.y / 23.0);
    vec3 col = C_BLOOD * (0.78 + 0.06 * f + 0.02 * fine + 0.035 * wave * step(${FH}.0, p.y));
    // 袋口：舌蓋掀開後看得到的一條暗縫
    col *= 1.0 - slit * 0.6 * (1.0 - smoothstep(0.0, 10.0, abs(p.y - ${FH + 14}.0))) * step(${FH}.0, p.y);
    fragColor = vec4(col, 1.0);
  }`, { slit: { value: 0 } });

/** 燙金（暗底版）：mask 的 alpha = 覆蓋、紅色通道 = 正在唱（燒紅發光）；hot = 火花的位置與熱度。 */
const FOIL = () => new FSPass(/* glsl */ `
  ${FOIL_GLSL}
  uniform sampler2D mask; uniform vec2 size; uniform float sweep; uniform float t; uniform vec3 hot;
  vec4 M(vec2 uv) { return texture(mask, uv); }
  void main() {
    vec4 m = M(vUv);
    if (m.a <= 0.003) discard;
    vec2 px = 1.6 / size;
    float ax = M(vUv + vec2(px.x, 0.0)).a - M(vUv - vec2(px.x, 0.0)).a, ay = M(vUv + vec2(0.0, px.y)).a - M(vUv - vec2(0.0, px.y)).a;
    float emb = clamp(dot(vec2(ax, ay), vec2(-0.7, 0.7)) * 1.4, -1.0, 1.0);
    float sing = clamp((m.r - m.g) / max(m.a, 1e-3), 0.0, 1.0);
    vec2 p = vec2(vUv.x, 1.0 - vUv.y) * size;
    float grain = 0.5 + 0.5 * snoise(p * 0.35 + vec2(t * 0.6, 0.0));
    float band = exp(-pow((p.x + p.y * 0.5 - sweep) / 100.0, 2.0));
    vec3 col = foilColor(0.2 + 1.2 * band + 0.3 * max(emb, 0.0), grain, emb) * 1.15;
    // 正在唱、剛被火花畫過：燒紅發光
    float h = hot.z * exp(-dot(p - hot.xy, p - hot.xy) / 3600.0);
    col = mix(col, C_EMBER * 1.7 + C_SIGNAL * 0.5, clamp(sing * 0.85 + h, 0.0, 1.0));
    fragColor = vec4(col, m.a);
  }`, {
  mask: { value: null }, size: { value: new THREE.Vector2(EW, AH) }, sweep: { value: 0 }, t: { value: 0 }, hot: { value: new THREE.Vector3() },
}, { blending: THREE.NormalBlending, transparent: true });

/** 紙條：米白的紙、摺成三折的摺痕。 */
const NOTE_BG = () => new FSPass(/* glsl */ `
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${NH}.0 - FRAG_PX.y);
    // 暗場裡的紙：比紙白暗一點，才不會在燈下發光（焦點靠對比，不靠亮度）
    vec3 col = C_PAPER * (0.84 + 0.012 * fbm(p / 140.0, 3) + 0.008 * snoise(p / 5.0));
    for (int i = 1; i < 3; i++) {
      float x = ${NW}.0 * float(i) / 3.0, d = p.x - x;
      col *= 1.0 - 0.05 * exp(-abs(d) / 3.0) + 0.02 * sign(d) * exp(-abs(d) / 14.0);
    }
    fragColor = vec4(col, 1.0);
  }`);

function planeGeo(w: number, h: number, v0: number, v1: number) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) > 0.5 ? v1 : v0);
  return g;
}
/** 舌蓋：從鉸鏈（y = 0）往下，兩邊直直下來再收成一個尖。uv 對到展開圖最上面那一段。 */
function flapGeo() {
  const s = new THREE.Shape();
  s.moveTo(-EW / 2, 0); s.lineTo(EW / 2, 0); s.lineTo(EW / 2, -FH * 0.42); s.quadraticCurveTo(EW * 0.18, -FH * 0.8, 0, -FH); s.quadraticCurveTo(-EW * 0.18, -FH * 0.8, -EW / 2, -FH * 0.42); s.closePath();
  const g = new THREE.ShapeGeometry(s, 16);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv: number[] = [];
  for (let i = 0; i < pos.count; i++) uv.push((pos.getX(i) + EW / 2) / EW, 1 + pos.getY(i) / AH);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

function makeRig() {
  const env = docRT(EW, AH), note = docRT(NW, NH);
  const st = new Stage(3, 30);
  st.U.ambient.value = 0.55;
  const mBody = st.docMaterial(env.texture, [env.width, env.height], [EW, AH], { edge: 0, depthTest: true });
  const mFlap = st.docMaterial(env.texture, [env.width, env.height], [EW, AH], { edge: 0, depthTest: true, depthWrite: false, side: THREE.FrontSide });
  const mLining = st.solidMaterial('C_BLOOD * 0.5 * (0.9 + 0.1 * sin((p.x + p.y) * 0.25) * detail)', { side: THREE.BackSide, depthWrite: false });
  mLining.transparent = true;
  const mNote = st.docMaterial(note.texture, [note.width, note.height], [NW, NH], { radius: 4, depthTest: true });
  const body = new THREE.Mesh(planeGeo(EW, EH, 0, EH / AH), mBody);
  body.position.set(...ENV);
  const hinge = new THREE.Group();
  hinge.position.set(ENV[0], ENV[1] + EH / 2, ENV[2] + 0.8);
  const fg = flapGeo();
  const flapF = new THREE.Mesh(fg, mFlap), flapB = new THREE.Mesh(fg, mLining);
  hinge.add(flapF, flapB);
  const noteM = new THREE.Mesh(planeGeo(NW, NH, 0, 1), mNote);
  body.renderOrder = 1; flapF.renderOrder = 2; flapB.renderOrder = 2; noteM.renderOrder = 3;
  for (const m of [body, flapF, flapB, noteM]) m.frustumCulled = false;
  st.scene.add(body, hinge, noteM);
  return { env, note, st, hinge, noteM, mNote };
}

/** 直排的一個字。 */
interface VChar { ch: string; x: number; y: number; word: Word }
interface VLayout { size: number; chars: VChar[] }
const vCache = new WeakMap<Line, Map<string, VLayout>>();
/** 中文歌詞直排：詞組（空白分開的）盡量一欄，太長就折；欄從右到左；放不下就縮字級（maxS → minS）。 */
function layoutVertical(line: Line, maxS: number, minS: number, zh = ZONE.h): VLayout {
  const key = `${maxS.toFixed(1)}|${minS.toFixed(1)}|${zh.toFixed(1)}`;
  let m = vCache.get(line);
  if (!m) { m = new Map(); vCache.set(line, m); }
  const hit = m.get(key);
  if (hit) return hit;
  const units: { ch: string; word: Word; brk: boolean }[] = [];
  line.words.forEach((w, i) => {
    const prevEnd = i ? line.words[i - 1]!.o + line.words[i - 1]!.w.length : 0;
    const gap = i > 0 && /\s/.test(line.text.slice(prevEnd, w.o));
    Array.from(w.w).forEach((ch, k) => { if (!/\s/.test(ch)) units.push({ ch, word: w, brk: gap && k === 0 }); });
  });
  let out: VLayout = { size: minS, chars: [] };
  for (let size = maxS; size >= minS - 0.01; size -= 2) {
    const pitch = size * 1.08, colW = size * 1.3;
    const per = Math.max(1, Math.floor(zh / pitch));
    const cols: (typeof units)[] = [[]];
    for (const u of units) {
      const cur = cols[cols.length - 1]!;
      if (cur.length && (cur.length >= per || (u.brk && cur.length + 2 > per * 0.5))) cols.push([u]);
      else cur.push(u);
    }
    if (cols.length * colW > ZONE.w + 1 && size > minS + 1.99) continue;
    const longest = Math.max(...cols.map((c) => c.length));
    const x0 = ZONE.x + ZONE.w / 2 + ((cols.length - 1) * colW) / 2;
    const y0 = ZONE.y + zh / 2 - (longest * pitch) / 2 + size * 0.88;
    out = { size, chars: [] };
    cols.forEach((c, ci) => c.forEach((u, j) => out.chars.push({ ch: u.ch, word: u.word, x: x0 - ci * colW, y: y0 + j * pitch })));
    break;
  }
  m.set(key, out);
  return out;
}
const isLatin = (s: string) => (s.match(/[A-Za-z]/g)?.length ?? 0) > s.replace(/\s/g, '').length * 0.4;

export default class RedEnvelope extends Scene {
  envBg = shared('redenvelope.bg', ENV_BG);
  foil = shared('redenvelope.foil', FOIL);
  noteBg = shared('redenvelope.note', NOTE_BG);
  rig = shared('redenvelope.rig', makeRig);
  /** 燙金遮罩（框、囍、歌詞），每格重畫。 */
  mask = this.track(new Layer2D(EW, AH, undefined, { fast: true }));
  /** 紙條上的字（畫一次）。 */
  noteInk = this.track(new Layer2D(NW, NH, undefined, { fast: true }));
  spark = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  g!: Grid;
  tTrace = 0; traceDur = 1; tOpen = 0; tOut = 0; tLand = 0;
  fit: FitResult | null = null;
  framePts: P2[] = [];
  /** 紙條、紅包在畫面上是紙面的幾倍（鏡頭停好時量的），v2 的字級要換算。 */
  sNote = 0.9; sEnv = 0.9;
  msgScreen: number | null = null;
  sigSize = 36;
  /** 囍字外圈的火花（每兩個小節一次的小事件）。 */
  runs: number[] = [];
  private noteDrawn = false;

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText(TEXT + song.title + COUPLE_EN + (this.msg ? signature(this.msg.name) + this.msg.text : '') + lyrics.linesIn(s, e).map((l) => l.text).join(''));
    const g = (this.g = grid(au, s, e));
    // 火花畫框：第一拍起，長窗格畫一小節、短的一拍；畫完的下一個小節線（太晚就下一拍）掀舌蓋，
    // 再下一拍抽出紙條、下一拍落地
    this.tTrace = g.b0;
    this.traceDur = g.nBars >= 5 ? g.bar * 0.9 : g.beat * 0.9;
    const after = this.tTrace + this.traceDur;
    let to = g.bars.find((b) => b >= after - 0.05) ?? Infinity;
    if (to - after > g.beat * 1.5 || to > e - 3) to = au.timeOfBeat(Math.ceil(au.beatAt(after) - 1e-6));
    this.tOpen = to;
    this.tOut = au.timeOfBeat(au.beatAt(this.tOpen) + 1);
    this.tLand = au.timeOfBeat(au.beatAt(this.tOut) + (g.beat < 0.42 ? 2 : 1));
    // 框的路徑：從下緣中間開始順時針一圈
    const f = FRAME, r = f.r, pts: P2[] = [{ x: f.x + f.w / 2, y: f.y + f.h }];
    const arc = (cx: number, cy: number, a0: number) => { for (let i = 0; i <= 6; i++) { const a = a0 + (i / 6) * (Math.PI / 2); pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }); } };
    arc(f.x + r, f.y + f.h - r, Math.PI / 2); arc(f.x + r, f.y + r, Math.PI); arc(f.x + f.w - r, f.y + r, -Math.PI / 2); arc(f.x + f.w - r, f.y + f.h - r, 0);
    pts.push({ x: f.x + f.w / 2, y: f.y + f.h });
    this.framePts = pts;
    this.runs = g.bars.filter((b, i) => i % 2 === 1 && b > this.tLand + g.bar * 0.7 && b < e - 0.6);
    // 鏡頭停好（紙條落地後）的位置先擺一次，量紙條與紅包在畫面上的縮放
    this.look(1, 0, 1);
    const st = this.rig.st;
    const px = (a: V3, b: V3) => { const p = st.toScreen(a), q = st.toScreen(b); return Math.hypot(q.x - p.x, q.y - p.y) / 100; };
    this.sNote = px([LAND[0] - 50, LAND[1], LAND[2]], [LAND[0] + 50, LAND[1], LAND[2]]);
    this.sEnv = px([ENV[0] - 50, ENV[1] - 100, 2], [ENV[0] + 50, ENV[1] - 100, 2]);
    // v2：留言字級照螢幕標準（依字數 40～60）換成紙條上的字級；可用高度先扣掉署名，照子句斷行
    const text = this.msg ? this.msg.text : '這個紅包留給你';
    const c = this.noteInk.ctx, fam = F.hand(700), S = this.sNote, maxS = msgMaxFor(text);
    const boxH = NH - NTOP - 34 - (sigV2(maxS) / S) * SIG_K;
    const opt = { min: V2.msgMin / S, max: maxS / S, lineHeight: 1.26, maxLines: 6 };
    const byW = fitText(c, text, fam, NW - 130, boxH, opt);
    const byC = fitClauses(c, text, fam, NW - 130, boxH, opt);
    this.fit = byC && byC.size >= byW.size * 0.9 && byC.lines.length <= byW.lines.length + 1 ? byC : byW;
    this.msgScreen = this.msg ? this.fit.size * S : null;
    this.sigSize = Math.round(sigV2(this.fit.size * S) / S);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, R = this.rig;
    if (!this.noteDrawn) { this.drawNote(); this.noteDrawn = true; }
    const flap = ease.inOutCubic(clamp((t - this.tOpen) / 0.45));
    // ---- 紅包：紙＋燙金（遮罩每格重畫）
    this.envBg.u.slit!.value = flap;
    this.envBg.render(renderer, R.env);
    const tr = clamp((t - this.tTrace) / this.traceDur);
    const head = this.drawMask(t, tr);
    const bar = au.barAt(t), bp = bar - Math.floor(bar);
    const fu = this.foil.u;
    fu.mask!.value = this.mask.upload();
    fu.sweep!.value = lerp(-500, EW + AH * 0.5 + 400, ease.outCubic(clamp(bp * 1.3)));
    fu.t!.value = t;
    (fu.hot!.value as THREE.Vector3).set(head?.x ?? 0, head?.y ?? 0, head ? 1 : 0);
    this.foil.render(renderer, R.env);
    this.spark.clear();
    if (head) {
      const trail = (tb: number) => { const u = clamp((tb - this.tTrace) / this.traceDur); return u > 0 && u < 1 ? this.along(u) : null; };
      sparkParticles(this.spark, t, trail, { rate: 110, life: 0.4, speed: 220, seed: 9 });
      sparkHead(this.spark, head.x, head.y, t, 1.05);
    }
    // 小事件：落地後每兩個小節，火花繞囍字外圈跑一圈
    const k = this.runs.findIndex((b) => t >= b && t < b + 1);
    if (k >= 0) {
      const b = this.runs[k]!, rd = 0.6;
      const ring = (tb: number) => (tb >= b && tb <= b + rd ? { x: EMBLEM.x + Math.cos(-Math.PI / 2 + ((tb - b) / rd) * TAU) * EMBLEM.r, y: EMBLEM.y + Math.sin(-Math.PI / 2 + ((tb - b) / rd) * TAU) * EMBLEM.r } : null);
      sparkParticles(this.spark, t, ring, { rate: 110, life: 0.35, speed: 180, seed: 20 + k, intensity: 0.8 });
      const h = ring(t);
      if (h) sparkHead(this.spark, h.x, h.y, t, 0.8, 0.9);
    }
    if (this.spark.count) this.spark.render(renderer, R.env);
    // ---- 紙條
    this.noteBg.render(renderer, R.note);
    comp.draw(renderer, this.noteInk.texture, R.note);
    // ---- 舞台
    R.hinge.rotation.x = -flap * (Math.PI - 0.22);
    const pose = this.notePose(t);
    R.noteM.position.set(pose.x, pose.y, pose.z);
    R.noteM.rotation.set(pose.rx, 0, pose.rz);
    R.mNote.uniforms.opacity!.value = t >= this.tOut - 0.01 ? 1 : 0;
    this.shoot(t, pose, head);
    R.st.render(renderer, out);
    const hit = pulse(t, this.tLand, 0.07);
    // 門檻拉高：只有燒紅的燙金與火花發光，紙條不發光
    return { bloom: 0.8, bloomThreshold: 1.05, vignette: 0.45, grain: 0.05, shake: [0, -hit * 3] };
  }

  /** 框上 u（0..1）的位置。 */
  private along(u: number): P2 {
    const pts = this.framePts;
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    let left = u * total;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!, l = Math.hypot(b.x - a.x, b.y - a.y);
      if (left <= l) return { x: lerp(a.x, b.x, left / l), y: lerp(a.y, b.y, left / l) };
      left -= l;
    }
    return pts[pts.length - 1]!;
  }

  /** 紙條：先在袋子裡（直的、藏在袋身下面）→ 往上抽出一大半 → 抬起來飛到旁邊、轉成橫的，在 tLand 的拍點落下。 */
  private notePose(t: number) {
    const top = ENV[1] + EH / 2;
    const inside = { x: ENV[0], y: top - NW / 2 + 30, z: 1.2 };
    const out = { x: ENV[0], y: top + 160, z: 1.2 };
    const slide = ease.outCubic(clamp((t - this.tOut) / 0.32));
    const t1 = this.tOut + 0.32, fly = clamp((t - t1) / Math.max(0.2, this.tLand - t1));
    const k = ease.inOutCubic(fly);
    const bounce = t > this.tLand ? Math.exp(-(t - this.tLand) * 9) * Math.sin((t - this.tLand) * 30) : 0;
    const x = lerp(lerp(inside.x, out.x, slide), LAND[0], k);
    const y = lerp(lerp(inside.y, out.y, slide), LAND[1], k);
    const z = fly > 0 ? lerp(out.z, LAND[2], k) + Math.sin(fly * Math.PI) * 280 + 8 * Math.max(0, bounce) : inside.z;
    return { x, y, z, rx: -0.35 * Math.sin(fly * Math.PI) + 0.02 * bounce, rz: lerp(Math.PI / 2, -0.04, k), fly };
  }

  /** 鏡頭位置：ko = 拉開的進度（0 貼著紅包、1 兩個都框進來），push = 慢慢推近，intro = 開場的微推。 */
  private look(ko: number, push: number, intro: number) {
    const D = camDist(30);
    // 停好時紅包在左、紙條在右上（畫面右下的 QR 區留空）
    const T: V3 = [lerp(ENV[0] + 20, 90, ko) + 30 * push, lerp(ENV[1] - 120, -40, ko), 0];
    const dist = D * lerp(0.86 - 0.04 * intro, 1.36, ko) * (1 - 0.05 * push);
    const tilt = THREE.MathUtils.degToRad(lerp(34, 24, ko));
    const yaw = lerp(-0.18, 0.05, ko);
    this.rig.st.look([T[0] + Math.sin(yaw) * dist, T[1] - Math.sin(tilt) * dist, Math.cos(tilt) * dist], T);
  }

  private shoot(t: number, pose: { x: number; y: number; z: number; fly: number }, head: P2 | null) {
    const st = this.rig.st, s = this.ctx.start, e = this.ctx.end;
    // 開場：貼著紅包的吉祥話；舌蓋掀開時拉開，把紅包和旁邊落紙條的地方一起框進來；落地後慢慢推近
    const ko = ease.inOutCubic(clamp((t - this.tOpen + 0.2) / Math.max(0.6, this.tLand - this.tOpen + 0.3)));
    const push = ease.inOutCubic(clamp((t - this.tLand) / Math.max(1, e - this.tLand)));
    const intro = ease.outCubic(clamp((t - s) / 2));
    this.look(ko, push, intro);
    const fEnv = st.depthOf([ENV[0], ENV[1] - 150, 2]), fNote = st.depthOf([LAND[0], LAND[1], LAND[2]]);
    const kn = ease.inOutCubic(clamp((t - this.tLand + 0.3) / 0.6));
    st.U.focus.value = lerp(fEnv, lerp(fNote, fEnv, 0.3), kn);
    st.U.aperture.value = 26;
    // 一盞暖燈：開場打在紅包上，後來移到兩個中間
    // 燈會呼吸：很慢的明暗＋大鼓時亮一點點（像燭光）
    // 燈籠：每一拍被推一下似地左右擺（擺動的相位對齊拍子，擺到最遠正好在拍點），光圈與漆面上的倒影一起動；
    // 燈籠本身在畫面外，看得到的是它的光和倒影
    const au = this.ctx.audio, bp = au.beatAt(t);
    const swing = Math.sin(bp * Math.PI) * (0.7 + 0.3 * noise1(t * 0.4, 5));
    const breathe = 0.74 + 0.04 * noise1(t * 0.9, 3) + 0.05 * au.hit('kick', t, 0.12);
    const cx = lerp(ENV[0], 60, ko) + 140 * swing, cy = lerp(ENV[1] - 100, 0, ko);
    st.U.pool.value.set(cx, cy, 1150, breathe);
    // 倒影落在光圈的後方（鏡頭看過去燈籠在紅包的後上方），沿著視線拉長
    (st.tableMat.uniforms.hl!.value as THREE.Vector4).set(cx + 60 * swing, cy + 620, 150, 0.55 + 0.15 * au.hit('kick', t, 0.12));
    st.shadows([
      { x: ENV[0] + 12, y: ENV[1] - 16, w: EW, h: EH, blur: 22, k: 0.5, r: 6 },
      { x: pose.x + 14 + pose.z * 0.3, y: pose.y - 18 - pose.z * 0.4, w: pose.fly > 0 ? NW : 1, h: NH, rot: -0.04, blur: 16 + pose.z * 0.2, k: pose.fly > 0 ? 0.5 * (1 - clamp(pose.z / 500)) : 0, r: 6 },
    ]);
    void head;
  }

  // ------------------------------------------------------------ 燙金遮罩（每格）
  /** 畫框（火花畫到的地方）、囍、小字、歌詞；回傳火花的位置（還在畫框時）。 */
  private drawMask(t: number, tr: number): P2 | null {
    const c = this.mask.ctx;
    this.mask.clear();
    c.fillStyle = '#fff'; c.strokeStyle = '#fff';
    // 外框（袋身與舌蓋）：細細一圈
    c.lineWidth = 2;
    c.strokeRect(22, FH + 22, EW - 44, EH - 44);
    c.beginPath(); c.moveTo(26, 4); c.lineTo(EW - 26, 4); c.stroke();
    c.save(); c.translate(EW / 2, FH - 24); c.rotate(Math.PI / 4); c.fillRect(-9, -9, 18, 18); c.restore();
    // 囍（小圓裡）
    c.lineWidth = 2.5; c.beginPath(); c.arc(EMBLEM.x, EMBLEM.y, EMBLEM.r, 0, TAU); c.stroke();
    c.lineWidth = 1; c.beginPath(); c.arc(EMBLEM.x, EMBLEM.y, EMBLEM.r - 8, 0, TAU); c.stroke();
    c.font = font(F.ming(900), 70); c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.fillText('囍', EMBLEM.x, EMBLEM.y + 25);
    c.font = font(F.mono(500), 15); c.letterSpacing = '5px';
    c.fillText(`${COUPLE_EN.toUpperCase()}  ·  ${DATE_DOTS}`, EW / 2, FH + EH - 50);
    c.letterSpacing = '0px'; c.textAlign = 'left';
    // 火花畫的框：畫到哪裡燙金就到哪裡
    let head: P2 | null = null;
    if (tr > 0) {
      c.lineWidth = 3; c.lineJoin = 'round';
      c.beginPath();
      const n = 90;
      for (let i = 0; i <= n; i++) { const p = this.along((i / n) * tr); if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y); }
      c.stroke();
      if (tr < 1) head = this.along(tr);
    }
    // 歌詞：中文直排；英文橫排（置中）
    const { lyrics, song } = this.ctx;
    const ly = lyricAt(lyrics, t);
    if (ly) {
      c.save(); c.globalAlpha = ly.k;
      const sub = lyricSubOf(ly.line);
      if (sub) this.lyricWithSub(c, ly.line, sub, t);
      else if (isLatin(ly.line.text)) {
        const LY_EN: RowsStyle = { family: F.archivo(100, 800), size: lyricV2(this.msgScreen) / this.sEnv, minSize: V2.lyrMin / this.sEnv, maxW: ZONE.w, maxRows: 4, align: 'center', lineHeight: 1.08 };
        const lay = layoutRows(c, ly.line, LY_EN);
        const top = ZONE.y + ZONE.h / 2 - lay.height / 2 + lay.size * 0.84;
        c.translate(ZONE.x + ZONE.w / 2, top);
        drawRows(c, lay, LY_EN.family, t, { active: 'rgb(255,0,0)', sung: '#fff', unsung: 'rgba(255,255,255,0.3)' });
      } else {
        const lay = layoutVertical(ly.line, lyricV2(this.msgScreen) / this.sEnv, V2.lyrMin / this.sEnv);
        c.font = font(F.ming(900), lay.size); c.textAlign = 'center';
        for (const ch of lay.chars) {
          const p = Lyrics.wordProgress(ch.word, t);
          c.fillStyle = p <= 0 ? 'rgba(255,255,255,0.3)' : p < 1 ? 'rgb(255,0,0)' : '#fff';
          c.fillText(ch.ch, ch.x, ch.y);
        }
        c.textAlign = 'left';
      }
      c.restore();
    } else {
      // 間奏、純音樂：吉祥話的位置寫歌名（淡）
      c.save();
      c.globalAlpha = lyrics.has ? 0.35 : 0.9;
      c.font = font(F.archivo(100, 800), 50); c.textAlign = 'center';
      c.fillText(song.title || '紅包', ZONE.x + ZONE.w / 2, ZONE.y + ZONE.h / 2 + 16);
      if (!lyrics.has) { c.font = font(F.hei(500), 20); c.globalAlpha = 0.6; c.fillText('（純音樂）', ZONE.x + ZONE.w / 2, ZONE.y + ZONE.h / 2 + 70); }
      c.restore();
    }
    return head;
  }

  /**
   * 韓文歌：原文小一號燙在中文正下方（同一個框裡，同樣置中），整塊在框裡垂直置中。
   * 中文直排時原文還是橫排（韓文直排不好讀），放在直排那一塊的下面；放不下就把中文縮一點、少排幾個字一欄。
   * 原文比中文安靜：唱到、唱完都是八成的燙金（不燒紅），還沒唱的照中文三成的壓印。
   */
  private lyricWithSub(c: CanvasRenderingContext2D, line: Line, sub: Line, t: number) {
    const S = this.sEnv, maxS = lyricV2(this.msgScreen) / S, minS = V2.lyrMin / S;
    const latin = isLatin(line.text);
    const fam = latin ? F.archivo(100, 800) : F.ming(900);
    const subLay = (mainSize: number) => {
      const ss = subSizeFor(mainSize * S) / S;
      return layoutRows(c, sub, { family: fam, size: ss, minSize: Math.min(ss, 26 / S), maxW: ZONE.w, maxRows: 2, align: 'center', lineHeight: 1.12 });
    };
    const subH = (sl: ReturnType<typeof subLay>) => (sl.rows.length - 1) * sl.lineHeight + sl.size * 0.2;
    const quiet = { active: 'rgba(255,255,255,0.8)', sung: 'rgba(255,255,255,0.8)', unsung: 'rgba(255,255,255,0.3)' };
    if (latin) {
      // 橫排：中文幾排＋原文幾排，太高就把中文縮一點
      let size = maxS, lay = layoutRows(c, line, { family: fam, size, minSize: minS, maxW: ZONE.w, maxRows: 4, align: 'center', lineHeight: 1.08 });
      let sl = subLay(lay.size), gap = subGap(lay.size, sl.size), total = lay.height + gap + subH(sl);
      for (let k = 0; k < 8 && total > ZONE.h; k++) {
        size = lay.size * 0.92;
        lay = layoutRows(c, line, { family: fam, size, minSize: Math.min(minS, size), maxW: ZONE.w, maxRows: 4, align: 'center', lineHeight: 1.08 });
        sl = subLay(lay.size); gap = subGap(lay.size, sl.size); total = lay.height + gap + subH(sl);
      }
      c.save();
      c.translate(ZONE.x + ZONE.w / 2, ZONE.y + (ZONE.h - total) / 2 + lay.size * 0.84);
      drawRows(c, lay, fam, t, { active: 'rgb(255,0,0)', sung: '#fff', unsung: 'rgba(255,255,255,0.3)' });
      c.translate(0, (lay.rows.length - 1) * lay.lineHeight + gap);
      drawRows(c, sl, fam, t, quiet);
      c.restore();
      return;
    }
    // 直排：先估原文要多高，框的上面一段給中文直排、下面給原文
    let sl = subLay(maxS), zh = ZONE.h - subGap(maxS, sl.size) - subH(sl);
    let lay = layoutVertical(line, maxS, minS, zh);
    sl = subLay(lay.size);
    const gap = lay.size * 0.37 + sl.size * 0.88;
    zh = Math.min(zh, ZONE.h - gap - subH(sl));
    lay = layoutVertical(line, lay.size, Math.min(minS, lay.size), zh);
    const top = Math.min(...lay.chars.map((ch) => ch.y)) - lay.size * 0.88;
    const bottom = Math.max(...lay.chars.map((ch) => ch.y)) + lay.size * 0.2;
    const total = bottom - top + gap - lay.size * 0.2 + subH(sl);
    const dy = ZONE.y + (ZONE.h - total) / 2 - top;
    c.font = font(fam, lay.size); c.textAlign = 'center';
    for (const ch of lay.chars) {
      const p = Lyrics.wordProgress(ch.word, t);
      c.fillStyle = p <= 0 ? 'rgba(255,255,255,0.3)' : p < 1 ? 'rgb(255,0,0)' : '#fff';
      c.fillText(ch.ch, ch.x, ch.y + dy);
    }
    c.textAlign = 'left';
    c.save();
    c.translate(ZONE.x + ZONE.w / 2, bottom + dy - lay.size * 0.2 + gap);
    drawRows(c, sl, fam, t, quiet);
    c.restore();
  }

  // ------------------------------------------------------------ 紙條（畫一次）
  private drawNote() {
    const c = this.noteInk.ctx, m = this.msg, fit = this.fit!;
    this.noteInk.clear();
    c.textBaseline = 'alphabetic';
    c.font = font(F.hei(500), 18); c.fillStyle = rgba('sepia', 0.55); c.letterSpacing = '5px';
    c.fillText(m?.couple ? '紅包裡的一句話　·　新人' : '紅包裡的一句話', 62, 66);
    c.letterSpacing = '0px';
    // 留言＋署名：署名永遠在最後一行下面（字級是扣掉署名的高度算的），讓出下伸部再放
    const sigH = this.sigSize * SIG_K;
    const top = NTOP + fit.size * 0.9 + Math.max(0, (NH - NTOP - 34 - sigH - fit.height) * 0.45);
    drawFit(c, fit, F.hand(700), 62, top, { color: rgba('sepia') });
    const yS = top + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.3 + this.sigSize * 1.05;
    c.font = font(F.hand(700), this.sigSize); c.fillStyle = rgba('sepia', 0.8);
    if (m) { c.textAlign = 'right'; c.fillText(signature(m.name), NW - 62, yS); }
    else {
      // 沒有留言：邀請分兩行、靠左，接在「這個紅包留給你」下面
      c.fillText('掃描右下角 QR code，', 62, yS);
      c.fillText('把祝福包進紅包', 62, yS + this.sigSize * 1.4);
    }
    c.textAlign = 'left';
    // 右上角一顆小小的印（訊號色的暗部）
    c.save();
    c.translate(NW - 70, 56); c.rotate(-0.08); // 右上角（不會碰到留言與署名）
    c.fillStyle = rgba('blood', 0.85);
    c.beginPath(); c.roundRect(-20, -20, 40, 40, 5); c.fill();
    c.fillStyle = rgba('paper'); c.font = font(F.ming(900), 26); c.textAlign = 'center';
    c.fillText("賀", 0, 9);
    c.restore();
  }
}
