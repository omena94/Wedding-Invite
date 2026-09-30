// 倒數（批次 T18・遊戲，暗）：巨大的立體數字，一拍一個，從黑暗的深處「砰」地停在鏡頭前。
//  - 數字是 Archivo 900 的字形擠出來的 3D（有厚度、斜角），表面是版畫的刻線（線的粗細 = 受光多少：
//    正面亮、側面暗），遠的數字沉在霧裡。一條淡淡的地板格線往遠處延伸，鏡頭往前衝的時候看得出速度。
//  - 鏡頭一拍往前衝一格：在拍點前半拍起跑、剛好在拍點停住；數字轉進來（側面 → 正面）時稍微過頭再回正，
//    停住的那一下正面燒成訊號色、慢慢冷卻。下一個數字已經在後面的霧裡等著。
//  - 有留言：倒數到揭曉（小節線）。「0」砰地停住、火花從 0 爆開，鏡頭往右平移，0 留在畫面左邊當主角，
//    留言就懸在 0 的右邊（剛爆出來是燒紅的，冷卻成紙白）。之後 0 每個小節線被點亮一次、輕輕轉，
//    遠處霧裡一個淡淡的小數字倒數「這一段還剩幾小節」（每小節翻一次），地板格線跟著鏡頭慢慢滑。
//  - v2（2026-09-29）：留言照「留言尺寸與版面比例標準 v2」（40～60 px、留言區 ≤ 860×430、在畫面右側），
//    不再穿過 0、不再用整個畫面寫留言：0 與數字的空間是主視覺。
//  - 沒有留言：一小節一個數字（窗格短就一拍一個），倒數到這個窗格結束（下一段），歌詞是主角。
//  - 歌詞在數字下面（畫面左下，逐字跟唱；有留言時小一級）。左上一行很小的冷面標籤。
// 畫法：three.js（MSAA 目標）畫擠出的數字與留言的那一片；背景（霧、地板格線）是全螢幕 shader；火花、灰塵是 LineBatch。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, makeRT, sharedMSAA } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, ot } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { GLSL_COMMON, THEME_UNIFORMS } from '../engine/glsl/common';
import { clamp, ease, hash, lerp, prog, pulse, TAU } from '../engine/util';
import { lyricAt, drawLyric, layoutLyric, fillWithHearts, type LyricStyle } from './_motifs';
import { grid, type Grid } from './_t4';
import { type MsgBlock } from './_t14';
import { loadWindow, revealAt, beatsBetween, v2Block } from './_t18';
import { lyricV2, V2 } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'game', paper: false, energy: [0.4, 1], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 世界（單位 ≈ 字形的 px：數字高約 720）
const FOV = 35;
/** 1 單位 = 1 螢幕 px 的距離。 */
const FPX = (H / 2) / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
/** 數字停住時離鏡頭多遠、數字之間的距離、數字的中心高度、地板。 */
const D_HERO = 2080, Z_SP = 3000, DIGIT_Y = 40, FLOOR_Y = -620;
const GLYPH = 1000, DEPTH = 150;
const FAM_MSG = F.ming(700);
const FAM_SIG = F.hand(400);
const FAM_LYR = F.archivo(100, 800);
/** 留言那一片（跟螢幕一樣大，鏡頭停好時 1 單位 = 1 px）上寫留言的範圍：畫面右側 ≤ 860×430。 */
const MBOX = { x: 900, y: 250, w: 840, h: 420 };
/** 揭曉後 0 停在畫面上的位置（螢幕 px）與留言那一片在 0 前面多少（避免跟 0 搶深度）。 */
const ZERO_SX = 500, ZERO_SY = 520, PLANE_DZ = 140;
/** 揭曉後鏡頭最後會推近約 3%：留言的字級先除回來。 */
const CAM_S = 1.03;
const LYR = { x: 200, y: 930, w: 1130 };
const TAG_COUNT = 'COUNTDOWN  ·  倒數計時中，請勿眨眼';
const TAG_EMPTY = 'COUNTDOWN  ·  下一段還有';

const PRE = /* glsl */ `precision highp float;\nprecision highp int;\n`;

// ---------------------------------------------------------------- 數字的擠出幾何（整晚共用）
function digitGeometry(ch: string): { geo: THREE.BufferGeometry; adv: number } {
  const fam = F.archivo(100, 900);
  const g = ot(fam).charToGlyph(ch);
  const path = g.getPath(0, 0, GLYPH);
  const sp = new THREE.ShapePath();
  for (const c of path.commands) {
    // opentype 的路徑 y 向下；three.js 的形狀 y 向上
    if (c.type === 'M') sp.moveTo(c.x, -c.y);
    else if (c.type === 'L') sp.lineTo(c.x, -c.y);
    else if (c.type === 'Q') sp.quadraticCurveTo(c.x1, -c.y1, c.x, -c.y);
    else if (c.type === 'C') sp.bezierCurveTo(c.x1, -c.y1, c.x2, -c.y2, c.x, -c.y);
  }
  const shapes = sp.toShapes();
  const geo = new THREE.ExtrudeGeometry(shapes, { depth: DEPTH, bevelEnabled: true, bevelThickness: 10, bevelSize: 7, bevelSegments: 2, curveSegments: 10 });
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  // 中心放在原點，正面在 z = 0（朝鏡頭 +z）
  geo.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -DEPTH - 10);
  return { geo, adv: (g.advanceWidth ?? 600) * (GLYPH / ot(fam).unitsPerEm) };
}
const DIGITS = () => Array.from({ length: 10 }, (_, i) => digitGeometry(String(i)));

const DIGIT_VERT = /* glsl */ `${PRE}
in vec3 position; in vec3 normal;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
out vec3 vL; out vec3 vN; out float vDepth;
void main() {
  vL = position;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 mv = viewMatrix * modelMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const DIGIT_FRAG = /* glsl */ `${PRE}
in vec3 vL; in vec3 vN; in float vDepth;
out vec4 fragColor;
${GLSL_COMMON}
uniform float uHeat; uniform float dHero; uniform float dim;
void main() {
  vec3 n = normalize(vN);
  vec3 L = normalize(vec3(-0.45, 0.6, 0.75));
  float dif = max(dot(n, L), 0.0);
  float front = smoothstep(0.7, 0.95, n.z);
  float lit = clamp(0.1 + 0.85 * dif + 0.12 * front, 0.0, 1.0);
  // 版畫刻線：線畫在數字自己身上（跟著數字動），線寬 = 受光（暗版面：亮的地方線粗、看起來亮）
  float u = dot(vL, vec3(0.8, 0.6, 0.55)) / 9.0;
  float cov = hatch(u, lit * 0.95);
  vec3 col = mix(C_INK2 * 0.7, C_BONE * 0.92, cov);
  // 側面、邊緣再壓暗一點，輪廓更清楚；邊緣一條很淡的訊號色反光
  col *= mix(0.55, 1.0, front);
  float rim = pow(1.0 - abs(n.z), 3.0) * step(0.0, n.y + 0.3);
  col += C_SIGNAL * 0.18 * rim;
  // 停住的那一下：正面燒成訊號色，慢慢冷卻
  col = mix(col, mix(C_BLOOD, C_SIGNAL, 0.35 + 0.65 * cov) * (0.45 + 0.75 * cov), uHeat * front * 0.9);
  // 霧：比停住的位置遠的沉進黑暗
  float fog = 1.0 - exp(-max(vDepth - dHero, 0.0) / 3600.0);
  col = mix(col, C_INK * 0.9, clamp(fog, 0.0, 0.94)) * dim;
  fragColor = vec4(col, 1.0);
}`;

const PLANE_VERT = /* glsl */ `${PRE}
in vec3 position; in vec2 uv;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
out vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`;
const PLANE_FRAG = /* glsl */ `${PRE}
in vec2 vUv;
out vec4 fragColor;
${GLSL_COMMON}
uniform sampler2D tex; uniform float alpha; uniform float hot;
void main() {
  vec4 c = fastLayer(texture(tex, vUv));
  // 剛爆出來是燒紅的（訊號色、會發光），冷卻成畫上去的顏色
  vec3 rgb = mix(c.rgb, C_SIGNAL * 2.2 * c.a, hot);
  fragColor = vec4(rgb, c.a) * alpha;
}`;

const BG = () => new FSPass(/* glsl */ `
  uniform vec3 camP; uniform float glow; uniform float lineK; uniform float msgGlow;
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 dir = normalize(vec3((sp.x - 960.0) / ${FPX.toFixed(2)}, -(sp.y - 540.0) / ${FPX.toFixed(2)}, -1.0));
    vec3 col = C_INK * (0.8 + 0.35 * smoothstep(1080.0, 300.0, sp.y));
    // 遠方地平線上一團很淡的暖光
    col += mix(C_BLOOD, C_SIGNAL, 0.5) * 0.035 * exp(-pow(length((sp - vec2(1000.0, 560.0)) / vec2(900.0, 260.0)), 2.0)) * glow;
    // 留言後面一團很淡的暖光（爆開的餘溫）
    col += mix(C_BLOOD, C_SIGNAL, 0.35) * 0.05 * msgGlow * exp(-pow(length((sp - vec2(1320.0, 460.0)) / vec2(620.0, 320.0)), 2.0));
    // 地板的格線：往遠處延伸，越遠越淡
    if (dir.y < -0.0005) {
      float tt = (${FLOOR_Y.toFixed(1)} - camP.y) / dir.y;
      vec3 P = camP + dir * tt;
      vec2 g = P.xz / 480.0;
      vec2 fw = max(fwidth(g), vec2(1e-4));
      vec2 gl = abs(fract(g - 0.5) - 0.5) / fw;
      float line = 1.0 - min(min(gl.x, gl.y), 1.0);
      float fade = exp(-tt / 7000.0) * smoothstep(0.0, 0.05, -dir.y) / (1.0 + max(fw.x, fw.y) * 6.0);
      col += mix(C_BONE, C_SIGNAL, 0.3) * 0.045 * line * fade * lineK;
      // 地板上數字的倒影光（很淡的一團）
      col += C_SIGNAL * 0.012 * glow * exp(-pow((sp.x - 1000.0) / 500.0, 2.0)) * smoothstep(540.0, 900.0, sp.y) * (1.0 - smoothstep(900.0, 1080.0, sp.y));
    }
    fragColor = vec4(col, 1.0);
  }`, { camP: { value: new THREE.Vector3() }, glow: { value: 1 }, lineK: { value: 1 }, msgGlow: { value: 0 } });

/** 整晚共用：數字幾何、MSAA 目標、背景。 */
class Rig {
  digits = DIGITS();
  msaa = sharedMSAA();
  bg = BG();
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(FOV, W / H, 20, 60000);
  plane = new THREE.PlaneGeometry(W, H);
}

interface Num { v: number; t: number; x: number; rest: number; meshes: THREE.Mesh[]; mat: THREE.RawShaderMaterial }

export default class Countdown extends Scene {
  rig = shared('countdown.rig', () => new Rig());
  /** 留言那一片（畫一次）。 */
  sheet = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 歌詞、標籤（每格重畫）。 */
  hud = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(1600, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = Number(this.ctx.params.seed ?? 1);
  block: MsgBlock | null = null;
  lyrSize = 52;
  g!: Grid;
  nums: Num[] = [];
  planeMesh: THREE.Mesh | null = null;
  planeMat: THREE.RawShaderMaterial | null = null;
  /** 揭曉（0 停住、爆開）與鏡頭平移結束的時間。 */
  tr = Infinity; panB = Infinity;
  /** 揭曉後鏡頭停的位置（0 在畫面左邊、留言在右邊）。 */
  camEnd = { x: 0, y: 0, z: 0 };
  /** 遠處的小數字：揭曉後每個小節線「還剩幾小節」；兩位數用兩個網格。 */
  farMat: THREE.RawShaderMaterial | null = null;
  farBars: number[] = [];
  farMeshes: THREE.Mesh[][] = [];
  dust: { x: number; y: number; z: number; s: number }[] = [];

  override async init() {
    const { audio: au, start: s, end: e } = this.ctx;
    await loadWindow(this.ctx, TAG_COUNT + TAG_EMPTY);
    const g = (this.g = grid(au, s, e));
    const B = g.beat;
    // ---- 數字的時間表
    let times: number[];
    if (this.msg) {
      this.tr = revealAt(au, g.b0, e, { minB: 2, maxB: 8 });
      const n = Math.max(1, Math.round(au.beatAt(this.tr) - au.beatAt(g.b0)));
      times = Array.from({ length: n + 1 }, (_, i) => au.timeOfBeat(au.beatAt(g.b0) + i));
    } else {
      // 沒有留言：倒數到窗格結束（長的一小節一個、短的一拍一個）；最後一個「0」要留一點時間停住
      const byBar = (e - g.b0) > 12 * B;
      times = byBar ? g.bars.filter((x) => x >= g.b0 - 0.01 && x <= e - B * 1.5) : beatsBetween(au, g.b0, e - B * 0.9);
      if (!times.length) times = [g.b0];
    }
    const n = times.length;
    const R = this.rig;
    this.nums = times.map((t, i) => {
      const v = n - 1 - i;
      const x = 150 + (i % 2 === 0 ? -1 : 1) * 190;
      const mat = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3, vertexShader: DIGIT_VERT, fragmentShader: DIGIT_FRAG,
        uniforms: { ...THEME_UNIFORMS, uHeat: { value: 0 }, dHero: { value: D_HERO }, dim: { value: 1 } },
      });
      const chars = String(v).split('');
      const advs = chars.map((c) => R.digits[+c]!.adv * 0.92);
      const total = advs.reduce((a, b) => a + b, 0);
      let off = -total / 2;
      const meshes = chars.map((c, k) => {
        const m = new THREE.Mesh(R.digits[+c]!.geo, mat);
        m.frustumCulled = false;
        m.userData.dx = off + advs[k]! / 2;
        off += advs[k]!;
        return m;
      });
      return { v, t, x, rest: (i % 2 === 0 ? 1 : -1) * 0.2, meshes, mat };
    });
    // ---- 留言那一片：揭曉後鏡頭停好時 1 單位 = 1 px（照螢幕排版），放在 0 的前面一點
    const last = this.nums[this.nums.length - 1]!;
    if (this.msg) {
      const zN = this.zOf(this.nums.length - 1);
      this.panB = this.tr + Math.max(0.6, 1.6 * B);
      // 鏡頭：0 落在螢幕 (ZERO_SX, ZERO_SY)
      const k = D_HERO / FPX;
      this.camEnd = { x: last.x - (ZERO_SX - 960) * k, y: DIGIT_Y + (ZERO_SY - 540) * k, z: zN + D_HERO };
      const c = this.sheet.ctx;
      this.sheet.clear();
      const b = (this.block = v2Block(c, this.msg, FAM_MSG, MBOX, { align: 'left', sigFamily: FAM_SIG, k: 1 / CAM_S, lineHeight: 1.32, maxLines: 6 }));
      c.textBaseline = 'alphabetic';
      c.font = font(FAM_MSG, b.fit.size);
      c.fillStyle = rgba('bone', 0.97);
      for (const ln of b.lines) fillWithHearts(c, ln.text, ln.x, ln.y);
      c.font = font(FAM_SIG, b.sig.size);
      c.fillStyle = rgba('ash', 0.95);
      c.fillText(b.sig.text, b.sig.x, b.sig.y);
      this.sheet.upload();
      this.lyrSize = lyricV2(b.screen);
      this.planeMat = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3, vertexShader: PLANE_VERT, fragmentShader: PLANE_FRAG,
        uniforms: { ...THEME_UNIFORMS, tex: { value: this.sheet.texture }, alpha: { value: 0 }, hot: { value: 0 } },
        transparent: true, depthWrite: false, depthTest: true,
      });
      this.planeMat.blending = THREE.CustomBlending;
      this.planeMat.blendSrc = THREE.OneFactor; this.planeMat.blendDst = THREE.OneMinusSrcAlphaFactor;
      this.planeMesh = new THREE.Mesh(R.plane, this.planeMat);
      // 一片跟螢幕一樣大的平面，放在 0 前面 PLANE_DZ：縮放到「鏡頭停好時 1 單位 = 1 px」
      const ps = (D_HERO - PLANE_DZ) / FPX;
      this.planeMesh.position.set(this.camEnd.x, this.camEnd.y, zN + PLANE_DZ);
      this.planeMesh.scale.set(ps, ps, 1);
      this.planeMesh.frustumCulled = false;
      // 遠處霧裡的小數字：揭曉後每個小節線換一個「還剩幾小節」
      const bars = g.bars.filter((x) => x > this.tr + 0.2 && x < e - 0.3);
      this.farBars = bars;
      if (bars.length) {
        this.farMat = new THREE.RawShaderMaterial({
          glslVersion: THREE.GLSL3, vertexShader: DIGIT_VERT, fragmentShader: DIGIT_FRAG,
          uniforms: { ...THEME_UNIFORMS, uHeat: { value: 0 }, dHero: { value: D_HERO }, dim: { value: 0.55 } },
        });
        const total = bars.length + 1;
        this.farMeshes = Array.from({ length: total }, (_, i) => {
          const v = total - 1 - i;
          return String(v).split('').map((ch, j, arr) => {
            const m = new THREE.Mesh(R.digits[+ch]!.geo, this.farMat!);
            m.frustumCulled = false;
            m.userData.dx = (j - (arr.length - 1) / 2) * R.digits[+ch]!.adv * 0.92;
            return m;
          });
        });
      }
    }
    // 灰塵：沿著整條路散在空中（有景深的小光點，鏡頭衝的時候拉成線）
    const zEnd = this.zOf(this.nums.length - 1) - 6000;
    for (let i = 0; i < 90; i++) {
      this.dust.push({ x: (hash(i, 1, this.seed) - 0.5) * 3600, y: (hash(i, 2) - 0.5) * 2000, z: lerp(D_HERO + 1500, zEnd - 2500, hash(i, 3)), s: hash(i, 4) });
    }
  }

  private zOf(i: number) { return -i * Z_SP; }

  /** 鏡頭位置（世界座標）。 */
  private camAt(t: number): { x: number; y: number; z: number } {
    const N = this.nums, B = this.g.beat, s = this.ctx.start;
    const first = N[0]!;
    if (t < first.t) {
      const k = ease.outExpo(prog(t, s, first.t));
      return { x: first.x * 0.6, y: 0, z: lerp(D_HERO + 1400, D_HERO, k) };
    }
    let i = 0;
    while (i + 1 < N.length && N[i + 1]!.t - Math.min(0.55 * B, N[i + 1]!.t - N[i]!.t) <= t) i++;
    const a = N[i]!, b = N[i + 1];
    if (b && t < b.t) {
      const m = Math.min(0.55 * B, b.t - a.t);
      const k = ease.inOutCubic(prog(t, b.t - m, b.t));
      // 等下一拍的時候，鏡頭一點一點往前滑（不會完全停住）
      const drift = 60 * Math.max(0, Math.min(t, b.t - m) - a.t);
      return { x: lerp(a.x, b.x, k) * 0.6, y: 0, z: lerp(this.zOf(i) + D_HERO - drift, this.zOf(i + 1) + D_HERO, k) };
    }
    // 最後一個數字之後
    const drift = 60 * Math.max(0, t - a.t);
    if (!this.msg) return { x: a.x * 0.6, y: 0, z: this.zOf(i) + D_HERO - Math.min(drift, 500) };
    // 揭曉：0 停住那一下之後，鏡頭往右平移（0 留在畫面左邊），之後整段慢慢推近、左右很慢地晃
    const E = this.camEnd;
    const k = ease.inOutCubic(prog(t, this.tr + 0.12, this.panB));
    const push = ease.inOutQuad(prog(t, this.panB, Math.max(this.panB + 2, this.ctx.end)));
    const sway = Math.sin((t - this.tr) * 0.5) * 18 * prog(t, this.panB, this.panB + 1);
    return { x: lerp(a.x * 0.6, E.x, k) + sway, y: lerp(0, E.y, k), z: lerp(this.zOf(i) + D_HERO, E.z - D_HERO * (1 - 1 / CAM_S), push) };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, B = this.g.beat;
    const R = this.rig;
    const cp = this.camAt(t);
    const cam = R.cam;
    cam.position.set(cp.x, cp.y, cp.z);
    // 停住的那一下鏡頭稍微歪一點點再回正（手持的感覺）
    let hitK = 0;
    for (const nm of this.nums) hitK += pulse(t, nm.t, 0.08);
    cam.rotation.set(0, 0, 0.004 * Math.sin(t * 1.3) + 0.006 * hitK * (hash(Math.round(t * 2), 7) - 0.5));
    cam.updateMatrixWorld();

    // ---- 數字
    R.scene.clear();
    for (const [i, nm] of this.nums.entries()) {
      const z = this.zOf(i);
      const depth = cp.z - z;
      if (depth < -300 || depth > D_HERO + Z_SP * 2.2) continue;
      // 轉進來：側面 → 正面，稍微過頭再回正（在拍點停住）
      const swing = 1 - ease.outBack(prog(t, nm.t - 0.3 * B, nm.t + 0.3 * B), 1.4);
      let ry = nm.rest + swing * 1.1 * Math.sign(nm.rest);
      let heat = t >= nm.t ? Math.exp(-(t - nm.t) / (0.55 * B)) : 0;
      if (this.msg && i === this.nums.length - 1) {
        // 揭曉後的 0：轉向留言那一邊一點、每個小節線被點亮一次、跟著節拍輕輕擺
        ry = lerp(ry, 0.32 + 0.08 * Math.sin((t - this.tr) * 1.1), ease.inOutCubic(prog(t, this.tr + 0.1, this.panB)));
        for (const tb of this.farBars) if (t >= tb) heat = Math.max(heat, 0.55 * Math.exp(-(t - tb) / (0.6 * B)));
      }
      nm.mat.uniforms.uHeat!.value = heat;
      // 穿過 0 以後，0 已經在鏡頭後面；留言出現時前面的數字退暗
      nm.mat.uniforms.dim!.value = 1;
      for (const m of nm.meshes) {
        const dx = m.userData.dx as number;
        m.position.set(nm.x + Math.cos(ry) * dx, DIGIT_Y, z - Math.sin(ry) * dx);
        m.rotation.set(0, ry, 0);
        R.scene.add(m);
      }
    }
    let alpha = 0, hot = 0;
    if (this.planeMesh && this.planeMat) {
      // 鏡頭平移到一大半才出現（不然會被畫面右緣切掉）
      const a0 = lerp(this.tr, this.panB, 0.55);
      alpha = ease.outCubic(prog(t, a0, a0 + 0.35));
      hot = 1 - prog(t, a0 + 0.05, a0 + 1.05, ease.outQuad);
      this.planeMat.uniforms.alpha!.value = alpha;
      this.planeMat.uniforms.hot!.value = alpha > 0 ? hot * 0.85 : 0;
      if (alpha > 0) R.scene.add(this.planeMesh);
    }
    // 遠處霧裡的小數字：每個小節線翻一次（舊的轉走、新的轉進來）
    if (this.farMat && t > this.tr) {
      const E = this.camEnd;
      let cur = 0;
      for (let j = 0; j < this.farBars.length; j++) if (t >= this.farBars[j]!) cur = j + 1;
      const tb = cur > 0 ? this.farBars[cur - 1]! : this.tr;
      const flip = ease.outBack(prog(t, tb, tb + 0.35), 1.2);
      // 放在右上角很遠的霧裡（小、暗），不跟 0 和留言搶
      const FD = D_HERO + 8200;
      const fz = E.z - FD, fx = E.x + (1560 - 960) * FD / FPX, fy = E.y + (540 - 175) * FD / FPX;
      const show = (idx: number, ry: number) => {
        const ms = this.farMeshes[idx];
        if (!ms) return;
        for (const m of ms) {
          const dx = m.userData.dx as number;
          m.position.set(fx + Math.cos(ry) * dx, fy, fz - Math.sin(ry) * dx);
          m.rotation.set(0, ry, 0);
          R.scene.add(m);
        }
      };
      show(cur, (1 - flip) * -1.4);
      if (cur > 0 && t < tb + 0.2) show(cur - 1, prog(t, tb, tb + 0.2) * 1.4);
      this.farMat.uniforms.uHeat!.value = 0.5 * Math.exp(-(t - tb) / 0.35);
    }

    // ---- 背景 → MSAA → 3D
    const bg = R.bg;
    (bg.u.camP!.value as THREE.Vector3).set(cp.x, cp.y, cp.z);
    bg.u.glow!.value = 1 + 0.6 * hitK;
    bg.u.lineK!.value = 1 - 0.6 * alpha;
    bg.u.msgGlow!.value = alpha * (0.7 + 0.3 * Math.sin(t * 0.8));
    bg.render(renderer, R.msaa);
    renderer.setRenderTarget(R.msaa);
    renderer.clearDepth();
    renderer.render(R.scene, cam);
    comp.draw(renderer, R.msaa.texture, out, { mode: 'replace' });

    // ---- 灰塵與穿洞的火花
    const G = this.glow;
    G.clear();
    const proj = (x: number, y: number, z: number) => {
      const dz = cp.z - z;
      if (dz < 60) return null;
      return { x: 960 + ((x - cp.x) * FPX) / dz, y: 540 - ((y - cp.y) * FPX) / dz, sc: FPX / dz, dz };
    };
    const cpPrev = this.camAt(t - 0.035);
    for (const d of this.dust) {
      const a = proj(d.x, d.y, d.z);
      if (!a || a.x < -50 || a.x > W + 50 || a.y < -50 || a.y > H + 50) continue;
      const dzP = cpPrev.z - d.z;
      if (dzP < 60) continue;
      const bx = 960 + ((d.x - cpPrev.x) * FPX) / dzP, by = 540 - ((d.y - cpPrev.y) * FPX) / dzP;
      // 離停住的距離越遠越糊（大、淡）
      const blur = Math.abs(a.dz - D_HERO) / D_HERO;
      const wd = 1.5 + 9 * clamp(blur * 0.6) * (0.5 + d.s);
      const I = (0.05 + 0.1 * d.s) / (1 + blur * 1.5) * (1 - clamp((a.dz - 9000) / 6000));
      const c = LIN.signal;
      G.seg2(bx, by, a.x, a.y, wd, [c[0] * I + 0.02, c[1] * I + 0.02, c[2] * I + 0.02], 0.9);
    }
    if (this.msg && this.tr < Infinity) {
      const a = t - this.tr;
      // 0 在畫面上的位置（跟著鏡頭平移）
      const zc = proj(this.nums[this.nums.length - 1]!.x, DIGIT_Y, this.zOf(this.nums.length - 1));
      const ox = zc ? zc.x : 960, oy = zc ? zc.y : 540;
      if (a >= 0 && a < 0.7) {
        const q = a / 0.7;
        for (let i = 0; i < 70; i++) {
          const an = hash(i, 41, this.seed) * TAU, sp = 0.4 + 0.6 * hash(i, 42);
          const r1 = 60 + 1100 * ease.outQuart(q) * sp, r0 = r1 * (0.55 + 0.3 * hash(i, 43));
          const I = (1 - q) * (1 - q) * 2.4;
          const c = hash(i, 44) < 0.3 ? LIN.ember : LIN.signal;
          G.seg2(ox + Math.cos(an) * r0, oy + Math.sin(an) * r0 * 0.8, ox + Math.cos(an) * r1, oy + Math.sin(an) * r1 * 0.8, 1.4 + 1.6 * (1 - q), [c[0] * I, c[1] * I, c[2] * I], 1);
        }
      }
      // 餘燼：爆開之後在留言四周慢慢往外、往上飄，幾秒內熄掉
      if (a >= 0 && a < 6) {
        for (let i = 0; i < 46; i++) {
          const an = hash(i, 51, this.seed) * TAU, v = 120 + 260 * hash(i, 52), life = 2.5 + 3 * hash(i, 53);
          if (a > life) continue;
          const d = v * 0.6 * (1 - Math.exp(-a / 0.6)) + 18 * a;
          const x = ox + Math.cos(an) * (260 + d) * 1.3, y = oy + Math.sin(an) * (220 + d * 0.6) - 26 * a + 10 * Math.sin(a * 2 + i);
          const k = (1 - a / life) * clamp(a / 0.2);
          const I = k * k * (0.5 + 0.9 * hash(i, 54)) * (0.6 + 0.4 * Math.sin(t * 9 + i * 1.7));
          const c = LIN.signal;
          G.seg2(x, y, x + 0.5, y - 1.5, 2.2 + 2 * hash(i, 55), [c[0] * I * 1.6, c[1] * I * 1.6, c[2] * I * 1.6], 1);
        }
      }
    }
    if (G.count) G.render(renderer, out);

    // ---- 歌詞與標籤（畫面左下、左上）
    const L = this.hud, c = L.ctx;
    L.clear();
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const st: LyricStyle = { family: FAM_LYR, size: this.lyrSize, minSize: V2.lyrMin, maxWidth: LYR.w };
      const lay = layoutLyric(c, ly.line, st);
      // 貼底：最後一排（有韓文原文時是原文最後一排）的基線在 LYR.y；沒有原文時 height - size 就是中文折出來的那一排
      const y = LYR.y - (lay.height - lay.size);
      c.save(); c.translate(LYR.x, y);
      drawLyric(c, ly.line, t, st, lay, ly.k * prog(t, s, s + 0.4));
      c.restore();
    }
    const tagK = (this.msg ? 1 - prog(t, this.tr, this.tr + 0.4) : 1) * prog(t, s, s + 0.5);
    if (tagK > 0) {
      c.font = font(F.mono(500), 18); c.letterSpacing = '4px';
      c.fillStyle = rgba('ash', 0.6 * tagK);
      c.fillText(this.msg ? TAG_COUNT : TAG_EMPTY, 200, 132);
      c.letterSpacing = '0px';
    }
    comp.draw(renderer, L.upload(), out);

    const flash = this.msg ? 0.1 * pulse(t, this.tr, 0.07) : 0;
    const avoid: [number, number, number, number] = this.block ? [this.block.box[0], this.block.box[1], this.block.box[2], this.block.box[3]] : [600, 200, 900, 640];
    return {
      bloom: 0.85, vignette: 0.5,
      zoom: 1 + 0.018 * hitK,
      flash,
      popupAvoid: [avoid],
    };
  }

  override dispose() {
    for (const nm of this.nums) nm.mat.dispose();
    this.planeMat?.dispose();
    this.farMat?.dispose();
    this.rig.scene.clear();
    super.dispose();
  }
}
