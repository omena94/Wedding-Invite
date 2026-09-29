// 倒數（批次 T18・遊戲，暗）：巨大的立體數字，一拍一個，從黑暗的深處「砰」地停在鏡頭前。
//  - 數字是 Archivo 900 的字形擠出來的 3D（有厚度、斜角），表面是版畫的刻線（線的粗細 = 受光多少：
//    正面亮、側面暗），遠的數字沉在霧裡。一條淡淡的地板格線往遠處延伸，鏡頭往前衝的時候看得出速度。
//  - 鏡頭一拍往前衝一格：在拍點前半拍起跑、剛好在拍點停住；數字轉進來（側面 → 正面）時稍微過頭再回正，
//    停住的那一下正面燒成訊號色、慢慢冷卻。下一個數字已經在後面的霧裡等著。
//  - 有留言：倒數到揭曉（小節線）。「0」停住之後，鏡頭從 0 的洞裡穿過去——穿過的那一刻火花爆開，
//    洞的另一邊就是留言（懸在黑暗裡的一片字，剛出現是燒紅的，冷卻成紙白），之後慢慢推近。
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
import { lyricAt, drawLyric, layoutLyric, lyricSizeFor, fillWithHearts, type LyricStyle } from './_motifs';
import { grid, type Grid } from './_t4';
import { msgBlock, type MsgBlock } from './_t14';
import { loadWindow, revealAt, beatsBetween } from './_t18';

export const spec: PlateSpecDecl = { group: 'type', family: 'game', paper: false, energy: [0.4, 1], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 世界（單位 ≈ 字形的 px：數字高約 720）
const FOV = 35;
/** 1 單位 = 1 螢幕 px 的距離。 */
const FPX = (H / 2) / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
/** 數字停住時離鏡頭多遠、數字之間的距離、數字的中心高度、地板。 */
const D_HERO = 2080, Z_SP = 3000, DIGIT_Y = 40, FLOOR_Y = -620;
const GLYPH = 1000, DEPTH = 150;
/** 留言那一片離「0」多遠。 */
const MSG_GAP = 3200;
const FAM_MSG = F.ming(700);
const FAM_SIG = F.hand(400);
const FAM_LYR = F.archivo(100, 800);
/** 留言在那一片上的範圍（那一片跟螢幕一樣大：鏡頭停好時 1 單位 = 1 px）。 */
const MBOX = { x: 250, y: 170, w: 1420, h: 640 };
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
    col += mix(C_BLOOD, C_SIGNAL, 0.35) * 0.05 * msgGlow * exp(-pow(length((sp - vec2(960.0, 470.0)) / vec2(820.0, 360.0)), 2.0));
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
  lyrSize = 64;
  g!: Grid;
  nums: Num[] = [];
  planeMesh: THREE.Mesh | null = null;
  planeMat: THREE.RawShaderMaterial | null = null;
  /** 揭曉（0 停住）、開始穿洞、穿過 0 的那一刻、停在留言前。 */
  tr = Infinity; flyA = Infinity; flyB = Infinity; tCross = Infinity;
  zMsg = 0;
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
    // ---- 留言那一片：鏡頭停好時 1 單位 = 1 px，所以直接照螢幕排版
    const last = this.nums[this.nums.length - 1]!;
    if (this.msg) {
      this.flyA = this.tr + 0.3 * B;
      this.flyB = this.flyA + Math.max(0.55, 1.25 * B);
      this.zMsg = this.zOf(this.nums.length - 1) - MSG_GAP;
      const c = this.sheet.ctx;
      this.sheet.clear();
      const b = (this.block = msgBlock(c, this.msg, FAM_MSG, MBOX, { align: 'center', sigFamily: FAM_SIG, min: 48, max: 150, lineHeight: 1.3, maxLines: 5, sigMin: 40, sigMax: 56 }));
      c.textBaseline = 'alphabetic';
      c.font = font(FAM_MSG, b.fit.size);
      c.fillStyle = rgba('bone', 0.97);
      for (const ln of b.lines) fillWithHearts(c, ln.text, ln.x, ln.y);
      c.font = font(FAM_SIG, b.sig.size);
      c.fillStyle = rgba('ash', 0.95);
      c.fillText(b.sig.text, b.sig.x, b.sig.y);
      this.sheet.upload();
      this.lyrSize = lyricSizeFor(b.fit.size);
      this.planeMat = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3, vertexShader: PLANE_VERT, fragmentShader: PLANE_FRAG,
        uniforms: { ...THEME_UNIFORMS, tex: { value: this.sheet.texture }, alpha: { value: 0 }, hot: { value: 0 } },
        transparent: true, depthWrite: false, depthTest: true,
      });
      this.planeMat.blending = THREE.CustomBlending;
      this.planeMat.blendSrc = THREE.OneFactor; this.planeMat.blendDst = THREE.OneMinusSrcAlphaFactor;
      this.planeMesh = new THREE.Mesh(R.plane, this.planeMat);
      this.planeMesh.position.set(last.x, DIGIT_Y, this.zMsg);
      this.planeMesh.frustumCulled = false;
      // 穿過 0 的時間：鏡頭的 z 經過 0 那一刻（照同一條緩動反算）
      const z0 = this.zOf(this.nums.length - 1) + D_HERO, z1 = this.zMsg + FPX * 1.06, zc = this.zOf(this.nums.length - 1);
      for (let k = 0; k <= 200; k++) {
        const tt = this.flyA + ((this.flyB - this.flyA) * k) / 200;
        if (lerp(z0, z1, ease.inOutCubic(prog(tt, this.flyA, this.flyB))) <= zc) { this.tCross = tt; break; }
      }
    }
    // 灰塵：沿著整條路散在空中（有景深的小光點，鏡頭衝的時候拉成線）
    const zEnd = this.msg ? this.zMsg : this.zOf(this.nums.length - 1);
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
    const z0 = this.zOf(i) + D_HERO - 60 * Math.max(0, Math.min(t, this.flyA) - a.t);
    const k = ease.inOutCubic(prog(t, this.flyA, this.flyB));
    const kc = ease.inOutCubic(prog(t, this.flyA, lerp(this.flyA, this.flyB, 0.45)));
    const push = ease.inOutQuad(prog(t, this.flyB, Math.max(this.flyB + 2, this.ctx.end)));
    const zStop = this.zMsg + FPX * lerp(1.06, 0.985, push);
    return { x: lerp(a.x * 0.6, a.x, kc), y: lerp(0, DIGIT_Y, kc), z: t < this.flyB ? lerp(z0, this.zMsg + FPX * 1.06, k) : zStop };
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
      const ry = nm.rest + swing * 1.1 * Math.sign(nm.rest);
      nm.mat.uniforms.uHeat!.value = t >= nm.t ? Math.exp(-(t - nm.t) / (0.55 * B)) : 0;
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
      alpha = ease.outCubic(prog(t, this.tCross - 0.06, this.tCross + 0.25));
      hot = 1 - prog(t, this.tCross, this.tCross + 0.9, ease.outQuad);
      this.planeMat.uniforms.alpha!.value = alpha;
      this.planeMat.uniforms.hot!.value = alpha > 0 ? hot * 0.85 : 0;
      if (alpha > 0) R.scene.add(this.planeMesh);
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
    if (this.tCross < Infinity) {
      const a = t - this.tCross;
      if (a >= 0 && a < 0.7) {
        const q = a / 0.7;
        for (let i = 0; i < 70; i++) {
          const an = hash(i, 41, this.seed) * TAU, sp = 0.4 + 0.6 * hash(i, 42);
          const r1 = 60 + 1500 * ease.outQuart(q) * sp, r0 = r1 * (0.55 + 0.3 * hash(i, 43));
          const I = (1 - q) * (1 - q) * 2.4;
          const c = hash(i, 44) < 0.3 ? LIN.ember : LIN.signal;
          G.seg2(960 + Math.cos(an) * r0, 540 + Math.sin(an) * r0 * 0.8, 960 + Math.cos(an) * r1, 540 + Math.sin(an) * r1 * 0.8, 1.4 + 1.6 * (1 - q), [c[0] * I, c[1] * I, c[2] * I], 1);
        }
      }
      // 餘燼：爆開之後在留言四周慢慢往外、往上飄，幾秒內熄掉
      if (a >= 0 && a < 6) {
        for (let i = 0; i < 46; i++) {
          const an = hash(i, 51, this.seed) * TAU, v = 120 + 260 * hash(i, 52), life = 2.5 + 3 * hash(i, 53);
          if (a > life) continue;
          const d = v * 0.6 * (1 - Math.exp(-a / 0.6)) + 18 * a;
          const x = 960 + Math.cos(an) * (380 + d) * 1.6, y = 470 + Math.sin(an) * (220 + d * 0.6) - 26 * a + 10 * Math.sin(a * 2 + i);
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
      const st: LyricStyle = { family: FAM_LYR, size: this.lyrSize, minSize: 48, maxWidth: LYR.w };
      const lay = layoutLyric(c, ly.line, st);
      const y = LYR.y - (lay.rows.length > 1 ? lay.size * 1.18 : 0);
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

    const flash = this.tCross < Infinity ? 0.12 * pulse(t, this.tCross, 0.07) : 0;
    const avoid: [number, number, number, number] = this.block ? [this.block.box[0], this.block.box[1], this.block.box[2], this.block.box[3]] : [600, 200, 900, 640];
    return {
      bloom: 0.85, vignette: 0.5,
      zoom: 1 + 0.018 * hitK + 0.03 * pulse(t, this.tCross, 0.12),
      flash,
      popupAvoid: [avoid],
    };
  }

  override dispose() {
    for (const nm of this.nums) nm.mat.dispose();
    this.planeMat?.dispose();
    this.rig.scene.clear();
    super.dispose();
  }
}
