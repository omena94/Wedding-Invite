// 撲克牌（暗）：一張深色毛氈的牌桌，一盞燈從上面打下來；牌堆在畫面左邊外面（只看得到一角、糊的）。
//  - 第一拍：紅心 K 從牌堆滑出來、在半空翻面、落在桌上；下一拍紅心 Q 落在另一頭；接著一拍一張（窗格短就半拍）
//    把留言的牌發到兩張之間，每一張都是翻開的——主打留言手寫在這幾張白牌上（一張一段），署名寫在最後一張的右下角。
//    牌都是自己設計的（不畫人）：K、Q 是大大的字母、一顆愛心、一頂線畫的皇冠／后冠。
//  - 發完的下一拍 K、Q 往中間靠一點（輕輕碰到留言的牌），像兩個人把大家的祝福夾在中間。
//  - 歌詞印在毛氈上：牌的上方一道弧線（像牌桌上印的字），唱到的字亮成訊號色（逐字跟唱），比留言小一級。
//  - 鏡頭：切進來時貼近牌堆、低一點；發牌的時候一路往右搖、升高，發完停在斜上方，之後很慢地推近。
//  - 沒有留言：K、Q 中間發一張寫「宣文 ♥ 孟庭」的牌，弧線上的歌詞放大，底下一行邀請。純音樂：弧線上印歌名。
// 手法：牌是 three.js 的四邊形（InstancedMesh，正面、背面各自取圖集，圓角在 shader 裡挖），翻面是真的 3D 轉動；
// 影子是同一張牌沿光線投到桌面、依高度模糊；弧線上的字先畫成一條直的 Canvas，再在毛氈的 shader 裡用極座標彎成弧。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { GLSL_COMMON, THEME_UNIFORMS } from '../engine/glsl/common';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, pulse, hash, frameIdx } from '../engine/util';
import { fitText, phrases, type FitResult } from '../engine/text';
import { lyricAt, layoutLyric, drawLyric, lyricSizeFor, beatAfter, drawHeart, fillWithHearts, COUPLE_ZH } from './_motifs';
import { darkInk, fitMsg } from './_t4';
import { sigOf, applyOrbit, lerpOrbit, toScreen, T17_INVITE, T17_TEXT, type OrbitCam, type V3 } from './_t17';

export const spec: PlateSpecDecl = { group: 'type', family: 'game', paper: false, energy: [0.25, 0.9], bars: [4, 8], weight: 1 };

/** 牌的大小（世界單位）與圖集。 */
const CW = 300, CH = 420, RES = 1.5;
const NCELL = 8; // 0 = 背面、1 = K、2 = Q、3.. = 留言的牌
const DECK_N = 10;
const MAXI = DECK_N + 8;
const FAM_MSG = F.hand(700);
const FAM_LYR = F.archivo(100, 800);
const LIGHT: V3 = [-0.35, 0.55, 1];
/** 弧線文字的畫布大小（世界單位 ≈ 螢幕像素）。 */
const LW = 1700, LH = 150;

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

/** 一張發出去的牌：正面的格子、落點、落下的時間、飛行時間、終點的轉角。 */
interface Deal { cell: number; x: number; y: number; rot: number; tl: number; fd: number; nudge: number }

export default class Cards extends Scene {
  rig = shared('cards.rig', () => new Rig());
  lyrL = this.track(new Layer2D(LW, LH, 1.4, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = Number(this.ctx.params.seed ?? 1) * 7 + (this.msg?.id ?? 0);
  atlasCv: HTMLCanvasElement | null = null;
  atlasTex: THREE.CanvasTexture | null = null;
  deals: Deal[] = [];
  sig = '';
  t1 = 0; tDone = 0; tNudge = 0; B = 0.5;
  deck = { x: -1500, y: 60 };
  arc: [number, number, number] = [0, 0, 0];
  lyrSize = 56;
  camA!: OrbitCam; camB!: OrbitCam;
  m4 = new THREE.Matrix4(); q = new THREE.Quaternion(); e = new THREE.Euler(); v = new THREE.Vector3(); s3 = new THREE.Vector3();

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.sig = sigOf(m);
    const text = m ? m.text : `${COUPLE_ZH}`;
    await loadText(`${text}${this.sig}${T17_TEXT}${T17_INVITE}${song.title}${song.artist}KQ♪${lyrics.linesIn(s - 2, e + 1).map((l) => l.text).join('')}`);
    const B = (this.B = au.beatPeriod(s + 0.1));

    // ---- 留言分成幾張牌：照詞組切（不拆詞），每張字數差不多
    // 字數：英文字母比中文字窄，算半個字
    const nChars = Array.from(text.replace(/\s/g, '')).reduce((a, ch) => a + (/[!-~]/.test(ch) ? 0.55 : 1), 0);
    const nCards = m ? clamp(Math.ceil(nChars / 14), 1, 4) : 1;
    const parts = this.split(text, nCards);
    // ---- 圖集：背面、K、Q、留言的牌
    const cv = (this.atlasCv = document.createElement('canvas'));
    cv.width = Math.round(NCELL * CW * RES); cv.height = Math.round(CH * RES);
    const c = cv.getContext('2d')!;
    c.scale(RES, RES);
    this.drawBack(c, 0);
    this.drawCourt(c, CW, 'K');
    this.drawCourt(c, CW * 2, 'Q');
    // 每張牌的字：大家用同一個字級（取最小的），署名寫在最後一張的右下角。
    // 只有一張的時候牌橫著放（直的牌太窄，「新婚快樂！！！」會被切成「新婚快／樂！！！」）：字在圖集裡轉 90° 畫，牌轉回來就是正的
    const land = parts.length === 1;
    const inner = land ? { w: CH - 70, h: CW - 76 } : { w: CW - 56, h: CH - 110 };
    const sigSize = 30;
    const sigH = (i: number) => (i === parts.length - 1 && this.sig ? sigSize * 1.6 : 0);
    // 一行放得下（字級不小於最大的六成）就一行：「新婚快樂！！！」不要折成兩行
    const fits: FitResult[] = parts.map((p, i) => fitMsg(c, p, FAM_MSG, inner.w, inner.h - sigH(i), { min: 40, max: m ? 80 : 58, lineHeight: 1.26, maxLines: 6 }));
    const size = Math.min(...fits.map((f) => f.size));
    parts.forEach((p, i) => {
      const x0 = CW * (3 + i);
      this.drawBlank(c, x0);
      const fit = land ? fits[0]! : fitText(c, p, FAM_MSG, inner.w, inner.h - sigH(i), { min: size, max: size, lineHeight: 1.26, maxLines: 8 });
      c.save();
      // 牌面座標：原點在左上角、寬 inner.w + 邊（橫放時整個轉 90°）
      if (land) { c.translate(x0 + CW, 0); c.rotate(Math.PI / 2); } else c.translate(x0, 0);
      const fw = land ? CH : CW, top = land ? 38 : 60;
      c.font = font(FAM_MSG, fit.size);
      c.fillStyle = rgba('sepia', 0.95);
      const y0 = top + (inner.h - fit.height - sigH(i)) / 2 + fit.size * 0.86;
      fit.lines.forEach((ln, k) => { const w = c.measureText(ln).width; fillWithHearts(c, ln, fw / 2 - w / 2, y0 + k * fit.lineHeight); });
      if (sigH(i)) {
        c.font = font(FAM_MSG, sigSize);
        c.fillStyle = mixRgba('blood', 'sepia', 0.3);
        c.textAlign = 'right';
        c.fillText(this.sig, fw - 30, y0 + (fit.lines.length - 1) * fit.lineHeight + sigSize * 1.7, fw - 60);
        c.textAlign = 'left';
      }
      c.restore();
    });
    const tx = (this.atlasTex = new THREE.CanvasTexture(cv));
    tx.colorSpace = THREE.SRGBColorSpace;
    tx.generateMipmaps = true;
    tx.minFilter = THREE.LinearMipmapLinearFilter;
    tx.anisotropy = 4;
    tx.needsUpdate = true;
    // 留言的字在畫面上大約多大（閱讀鏡頭 1 世界單位 ≈ 1.25 px，下面算完鏡頭再修正）
    this.lyrSize = m ? lyricSizeFor(size * 1.25) : 76;

    // ---- 牌的位置：留言的牌並排、K 在最左（被第一張壓住一點）、Q 在最右
    const gap = 18;
    const cw = land ? CH : CW;
    const rowW = nCards * cw + (nCards - 1) * gap;
    const xs = parts.map((_, i) => -rowW / 2 + cw / 2 + i * (cw + gap));
    const kx = xs[0]! - cw / 2 - CW * 0.28, qx = xs[xs.length - 1]! + cw / 2 + CW * 0.28;
    this.t1 = beatAfter(au, s + Math.min(0.3, B * 0.6));
    const step = e - this.t1 > (nCards + 3) * B * 1.6 ? B : B / 2;
    const fd = clamp(step * 0.9, 0.3, 0.5);
    const rnd = (k: number) => (hash(this.seed, k) - 0.5);
    this.deals.push({ cell: 1, x: kx, y: 20, rot: 0.1 + rnd(1) * 0.04, tl: this.t1, fd, nudge: 1 });
    this.deals.push({ cell: 2, x: qx, y: 20, rot: -0.1 + rnd(2) * 0.04, tl: this.t1 + step, fd, nudge: -1 });
    xs.forEach((x, i) => this.deals.push({ cell: 3 + i, x, y: -4, rot: (land ? Math.PI / 2 : 0) + rnd(3 + i) * 0.05, tl: this.t1 + step * (2 + i), fd, nudge: 0 }));
    this.tDone = this.t1 + step * (1 + nCards) + 0.05;
    this.tNudge = au.timeOfBeat(Math.ceil(au.beatAt(this.tDone + 0.1) - 1e-6));
    this.deck = { x: kx - CW * 3.2, y: 80 };

    // ---- 鏡頭：落定時斜上方看著整排牌，上面留給弧線上的歌詞
    const cam = this.rig.cam;
    const rowPts: V3[] = [[kx - CW * 0.6, -CH / 2 - 10, 0], [qx + CW * 0.6, -CH / 2 - 10, 0], [kx - CW * 0.6, CH / 2 + 30, 0], [qx + CW * 0.6, CH / 2 + 30, 0]];
    const fit = (o: OrbitCam, yTop: number) => {
      let lo = 600, hi = 8000;
      const ok = (d: number) => {
        applyOrbit(cam, { ...o, dist: d });
        // 牌的下緣不進右下角 QR 區（Q 的角標在那裡）
        return rowPts.map((p) => toScreen(cam, p)).every((p) => p.x > 110 && p.x < W - 110 && p.y > yTop && p.y < 820);
      };
      for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (ok(mid)) hi = mid; else lo = mid; }
      return { ...o, dist: hi };
    };
    const yTop = 280;
    let best: OrbitCam | null = null;
    for (const ty of [60, 100, 140, 180, 220]) {
      const o = fit({ tx: 0, ty, tz: 0, dist: 2000, az: 0, el: 1.12, fov: 30 }, yTop);
      if (!best || o.dist < best.dist) best = o;
    }
    this.camB = best!;
    // 弧線：圓心在牌的上方（莊家那一側），弧的最低點在牌的上緣再上面一點；歌詞的字級照鏡頭換算
    applyOrbit(cam, this.camB);
    const a = toScreen(cam, [0, CH / 2 + 150, 0]), b = toScreen(cam, [100, CH / 2 + 150, 0]);
    const pxPer = Math.hypot(b.x - a.x, b.y - a.y) / 100;
    this.lyrSize = Math.round((m ? lyricSizeFor(size * pxPer) : 76) / pxPer);
    const R = 2600;
    this.arc = [0, CH / 2 + 110 + R, R];
    // 進場：貼近牌堆（左邊）、低一點；發牌時一路往右搖、升高
    this.camA = { ...this.camB, tx: this.deck.x + 900, ty: 0, dist: this.camB.dist * 0.72, el: 0.72, az: -0.12, roll: -0.02 };
  }

  /** 把一段文字照詞組切成 n 張牌（每張字數差不多、不拆詞）。 */
  private split(text: string, n: number): string[] {
    if (n <= 1) return [text];
    const ph = phrases(text, 4);
    const len = (s: string) => Array.from(s.replace(/\s/g, '')).length;
    const total = ph.reduce((a, p) => a + len(p), 0);
    const out: string[] = [];
    let cur = '', acc = 0;
    for (const p of ph) {
      const target = (total * (out.length + 1)) / n;
      if (cur && out.length < n - 1 && acc + len(p) / 2 > target) { out.push(cur.trim()); cur = ''; }
      // 英文的詞組之間要補回空白（phrases 會把空白吃掉）
      cur += (cur && /[!-~]$/.test(cur) && /^[!-~]/.test(p) ? ' ' : '') + p;
      acc += len(p);
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
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
    c.strokeStyle = rgba('signal', 0.5); c.lineWidth = 1.5; c.strokeRect(x0 + 16, 16, CW - 32, CH - 32);
    c.strokeStyle = rgba('signal', 0.25); c.lineWidth = 1; c.strokeRect(x0 + 22, 22, CW - 44, CH - 44);
    for (const [hx, hy] of [[34, 38], [CW - 34, 38], [34, CH - 34], [CW - 34, CH - 34]] as const) drawHeart(c, x0 + hx, hy, 14, rgba('rose', 0.85));
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

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const rig = this.rig;
    const A = rig.iA.array as Float32Array;
    type St = { x: number; y: number; z: number; rz: number; ry: number; cell: number; vis: number };
    const st: St[] = [];
    // ---- 牌堆：一疊背面朝上的牌（發一張少一張）
    const dealt = this.deals.filter((d) => t >= d.tl - d.fd).length;
    for (let k = 0; k < DECK_N; k++) {
      const left = DECK_N - k > dealt ? 1 : 0;
      st.push({ x: this.deck.x + k * 0.6, y: this.deck.y - k * 0.8, z: k * 1.2, rz: 0.06, ry: Math.PI, cell: 0, vis: left });
    }
    // ---- 發出去的牌：從牌堆滑出、在半空翻面、落在位置上（落下時壓一下）；發完的下一拍 K、Q 往中間靠一點
    const nudge = ease.outBack(clamp((t - this.tNudge) / 0.3), 2);
    for (const d of this.deals) {
      const u = clamp((t - (d.tl - d.fd)) / d.fd);
      if (u <= 0) continue;
      const k = ease.outCubic(u);
      const x = this.deck.x + (d.x + d.nudge * 26 * nudge - this.deck.x) * k;
      const y = this.deck.y + (d.y - this.deck.y) * k;
      const z = Math.sin(Math.PI * u) * 140 + 14;
      const ry = Math.PI * (1 - ease.inOutCubic(clamp(u * 1.15)));
      const rz = 0.06 + (d.rot - 0.06) * k + Math.sin(Math.PI * u) * 0.25;
      st.push({ x, y, z, rz, ry, cell: d.cell, vis: 1 });
    }
    // 高的畫在後面
    st.sort((a, b) => a.z - b.z);
    st.forEach((p, i) => {
      this.e.set(0, p.ry, p.rz, 'ZYX');
      this.q.setFromEuler(this.e);
      this.m4.compose(this.v.set(p.x, p.y, p.z + 0.5), this.q, this.s3.set(CW, CH, 1));
      rig.cards.setMatrixAt(i, this.m4);
      A[i * 4] = p.cell; A[i * 4 + 1] = p.z; A[i * 4 + 2] = p.vis; A[i * 4 + 3] = 0;
    });
    rig.cards.count = rig.shadows.count = st.length;
    rig.cards.instanceMatrix.needsUpdate = true;
    rig.iA.needsUpdate = true;

    // ---- 鏡頭：貼近牌堆 → 發牌時往右搖、升高 → 斜上方很慢地推近
    const kc = ease.inOutCubic(prog(t, s, Math.max(this.t1 + 2 * this.B, this.tDone)));
    const cam = lerpOrbit(this.camA, this.camB, kc);
    cam.dist *= 1 - 0.035 * ease.inOutQuad(prog(t, this.tDone, e));
    applyOrbit(rig.cam, cam);

    // ---- 弧線上的歌詞（直的畫布，shader 彎成弧）
    this.drawArc(t);
    const fu = rig.feltMat.uniforms;
    fu.lyr!.value = this.lyrL.upload();
    (fu.arc!.value as THREE.Vector4).set(this.arc[0], this.arc[1], this.arc[2], 0);
    (fu.lamp!.value as THREE.Vector4).set(0, 60, 1500, 0);
    rig.cardMat.uniforms.atlas!.value = this.atlasTex;
    renderer.setRenderTarget(out);
    renderer.render(rig.scene, rig.cam);

    let amp = 0;
    for (const d of this.deals) amp += 2 * pulse(t, d.tl, 0.05);
    amp += 3 * pulse(t, this.tNudge + 0.08, 0.06);
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
        const st = { family: FAM_LYR, size: this.lyrSize, minSize: Math.min(this.lyrSize, 48), maxWidth: LW - 200, align: 'center' as const, active: ink.active, sung: ink.sung, unsung: ink.unsung, lineHeight: 1.05 };
        const lay = layoutLyric(c, ly.line, st);
        c.save();
        // 折成兩行時往上長（基線固定在弧上）
        c.translate(LW / 2, base - (lay.rows.length - 1) * lay.size * 1.05);
        drawLyric(c, ly.line, t, st, lay, ly.k);
        c.restore();
      }
    }
    if (!this.msg) {
      c.fillStyle = rgba('ash', 0.6);
      c.font = font(F.hei(500), 20);
      c.letterSpacing = '3px';
      c.textAlign = 'center';
      c.fillText(T17_INVITE, LW / 2, base + 34);
      c.textAlign = 'left';
      c.letterSpacing = '0px';
    }
  }
}
