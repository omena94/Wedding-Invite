// 新聞快報（批次 T6・螢幕 B，暗）：自己設計的「喜訊台」新聞畫面（不像任何一家真的電視台）。
//  - 背景是一顆 three.js 的線框地球：開場轉得飛快，第一個小節線剛好停在台灣，下一個小節線鏡頭一路推進到婚禮現場；
//    世界各地的賓客沿著大圓弧線「飛」過來（一拍發一條，弧線的頭是仙女棒的火花），現場的標記在大鼓上泛起一圈圈漣漪。
//  - 下三分之一：「快訊」標籤在第一拍切進來，頭條就是主打留言（思源宋體），署名是「現場報導」的記者；
//    每個小節線頭條上緣掃過一道光。沒有留言時頭條是「現正播放」＋邀請。
//  - 最下面的跑馬燈是歌詞：跑馬燈的速度跟著歌聲走——正在唱的字永遠停在同一個「讀頭」的位置，唱完的往左流走，
//    還沒唱的從右邊等著（逐字跟唱：唱完紙白、正在唱訊號色、還沒唱三成透明）。純音樂時跑固定的快訊。
//  - 左上角台標、LIVE 在拍點閃、現場時間的冒號一拍閃一次。
// 手法：地球（球體 mesh 的菲涅耳邊光＋LineBatch 3D 經緯線、台灣海岸線、飛行弧線）用同一台透視相機；字與圖卡在一張 Canvas 層。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, lerp, prog, mulberry32 } from '../engine/util';
import { Lyrics, type Line } from '../engine/lyrics';
import type { FitResult } from '../engine/text';
import { sparkHead, sparkParticles, beatAfter, barAfter, signature, drawMessage, COUPLE_ZH } from './_motifs';
import { TAIWAN, VENUE, beatsIn, fitMessage, inOut, type Rect } from './_t6';

export const spec: PlateSpecDecl = { group: 'type', family: 'screen', paper: false, energy: [0.35, 1], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 版面
const X0 = 100, XR = 1340;
const LABEL = { y: 516, h: 60 }; // 快訊標籤那一列
const HEAD_Y = LABEL.y + LABEL.h; // 頭條面板上緣
const HEAD_MAX_B = 848; // 頭條面板下緣最多到這裡
const TK = { y: 872, h: 78, labelW: 150 }; // 跑馬燈
const TK_SIZE = 50;
const HEAD_X = 640; // 跑馬燈的讀頭（正在唱的字停在這裡）
const SEP = '　◆　';
const TICKER_IDLE = ['現場天氣：降愛機率百分之百', '交通：往幸福的路上一路順暢', '掃描右下角 QR code，你的祝福就是下一則頭條', '芃芃與 QQ 已就位', '喜宴菜色：一道比一道更甜'];
const [GROOM, BRIDE] = COUPLE_ZH.split(/\s*&\s*/) as [string, string];
const TEXT = `喜訊台快訊現場直播報導婚禮新人發言現正播放中掃描右下角你的祝福就是下一則頭條歌詞緯度經度台灣${TICKER_IDLE.join('')}${GROOM}${BRIDE}`;
const D2R = Math.PI / 180;
const TW_C: [number, number] = [120.97, 23.65]; // 台灣本島的中心

const BG = () => new FSPass(/* glsl */ `
  uniform float t; uniform vec2 g; uniform float gr; uniform float k;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 攝影棚的背板：由上往下變暗、很淡的 LED 點陣、地球後面一團光
    vec3 col = mix(C_INK2 * 1.15, C_INK, smoothstep(0.0, 1080.0, p.y));
    vec2 cell = fract(p / 6.0) - 0.5;
    col += C_BONE * 0.012 * (1.0 - smoothstep(0.18, 0.32, length(cell)));
    float d = length(p - g) / max(gr, 1.0);
    col += C_BLOOD * 0.16 * exp(-d * d * 1.6) * k;
    col += (C_INK2 - C_INK) * 0.3 * fbm(p / 500.0 + t * 0.01, 3);
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 }, g: { value: new THREE.Vector2(1140, 330) }, gr: { value: 300 }, k: { value: 1 } });

// 地球本體：暗色的球＋菲涅耳邊光（顏色每格從色票更新）
const SPHERE_VERT = /* glsl */ `precision highp float;
in vec3 position; in vec3 normal;
uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix; uniform mat3 normalMatrix;
out vec3 vN; out vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const SPHERE_FRAG = /* glsl */ `precision highp float;
in vec3 vN; in vec3 vV; out vec4 fragColor;
uniform vec3 cBody; uniform vec3 cRim; uniform float k;
void main() {
  float f = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 3.0);
  vec3 col = cBody * (0.7 + 0.3 * dot(normalize(vN), normalize(vec3(-0.4, 0.5, 1.0)))) + cRim * f * 0.55;
  fragColor = vec4(col * k, k);
}`;

type V3 = [number, number, number];
const llToV = (lon: number, lat: number): V3 => [Math.cos(lat * D2R) * Math.sin(lon * D2R), Math.sin(lat * D2R), Math.cos(lat * D2R) * Math.cos(lon * D2R)];
const norm = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

interface Arc { from: V3; t0: number; ang: number }
interface Globe { lonC: number; latC: number; r: number; cx: number; cy: number; push: number }
interface Crawl { lines: { line: Line; x: number; w: number; words: { x: number; w: number }[] }[]; total: number }

export default class News extends Scene {
  bg = shared('news.bg', BG);
  ui = this.track(new Layer2D(W, H, undefined, { fast: true }));
  g3 = this.track(new LineBatch(9000, { screen2D: false, blend: 'add' }));
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  private scene3 = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(30, W / H, 0.005, 100);
  private sphere!: THREE.Mesh;
  private sMat!: THREE.RawShaderMaterial;
  fit: FitResult | null = null;
  headH = 200;
  tLand = 0; tPush = 0; b0 = 0;
  arcs: Arc[] = [];
  crawl: Crawl = { lines: [], total: 0 };
  idleW = 0;
  /** 經緯線（經緯度點列，每格旋轉投影）。 */
  private grid: V3[][] = [];
  private fine: V3[][] = [];
  private coast: V3[] = [];
  private venue = norm(llToV(VENUE[0], VENUE[1]));

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText(TEXT + song.title + song.artist);
    const b0 = this.b0 = beatAfter(au, s + 0.05);
    const beat = au.beatPeriod(b0);
    // 地球：第一個小節線停在台灣（太晚就第一拍後兩拍），下一個小節線開始推鏡（窗格太短就不推那麼多）
    this.tLand = Math.min(barAfter(au, b0 + 0.3 * beat), b0 + 2 * beat, e - beat);
    this.tPush = Math.min(barAfter(au, this.tLand + 0.3 * beat), this.tLand + 4 * beat);
    // 經緯線：每 10 度一條；台灣附近另外一層每 2 度的細格（推鏡推近了才淡入，不然近看只剩幾條線）
    for (let lon = -180; lon < 180; lon += 10) { const pl: V3[] = []; for (let la = -80; la <= 80; la += 3.4) pl.push(llToV(lon, la)); this.grid.push(pl); }
    for (let la = -80; la <= 80; la += 10) { const pl: V3[] = []; for (let lo = -180; lo <= 180; lo += 3.75) pl.push(llToV(lo, la)); this.grid.push(pl); }
    for (let lon = 100; lon <= 144; lon += 2) { if (lon % 10) { const pl: V3[] = []; for (let la = 4; la <= 46; la += 1.5) pl.push(llToV(lon, la)); this.fine.push(pl); } }
    for (let la = 4; la <= 46; la += 2) { if (la % 10) { const pl: V3[] = []; for (let lo = 100; lo <= 144; lo += 1.5) pl.push(llToV(lo, la)); this.fine.push(pl); } }
    this.coast = TAIWAN.map(([lo, la]) => llToV(lo, la)).map((v) => [v[0] * 1.001, v[1] * 1.001, v[2] * 1.001] as V3);
    // 飛行弧線：從世界各地（種子亂數）飛向現場，推鏡之後一拍一條
    const rnd = mulberry32((this.ctx.params.seed ?? 1) * 7 + 3);
    const launches = beatsIn(au, this.tLand, e - beat * 0.5);
    launches.forEach((bt, i) => {
      if (i >= 14) return;
      const lon = VENUE[0] + (rnd() - 0.5) * 300, lat = (rnd() - 0.35) * 110;
      const from = norm(llToV(lon, lat));
      this.arcs.push({ from, t0: bt, ang: Math.acos(clamp(dot(from, this.venue), -1, 1)) });
    });
    // 球體
    this.sMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: SPHERE_VERT, fragmentShader: SPHERE_FRAG,
      uniforms: { cBody: { value: new THREE.Vector3() }, cRim: { value: new THREE.Vector3() }, k: { value: 1 } },
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), this.sMat);
    this.scene3.add(this.sphere);
    // 頭條
    const c = this.ui.ctx;
    const headText = this.msg ? this.msg.text : `現正播放：${song.title || '今晚的歌'}`;
    this.fit = fitMessage(c, headText, F.ming(700), XR - X0 - 80, HEAD_MAX_B - HEAD_Y - 60, { min: 44, max: 84, lineHeight: 1.24 });
    this.headH = this.fit.height + 64;
    // 跑馬燈：把這個窗格附近的歌詞排成一條長帶子
    c.font = font(F.archivo(100, 700), TK_SIZE);
    const sepW = c.measureText(SEP).width;
    let x = 0;
    for (const ln of lyrics.linesIn(s - 30, e + 30)) {
      const words = ln.words.map((w) => ({ x: c.measureText(ln.text.slice(0, w.o)).width, w: c.measureText(w.w).width }));
      const w = c.measureText(ln.text).width;
      this.crawl.lines.push({ line: ln, x, w, words });
      x += w + sepW;
    }
    this.crawl.total = x;
    c.font = font(F.hei(700), TK_SIZE * 0.9);
    this.idleW = c.measureText(TICKER_IDLE.join(SEP) + SEP).width;
  }

  override dispose() {
    this.sphere?.geometry.dispose();
    this.sMat?.dispose();
    super.dispose();
  }

  // ------------------------------------------------------------ 地球的姿態
  /** 中央經線、緯度、畫面上的半徑（px）與地球中心（台灣）在畫面上的位置。 */
  private globe(t: number): Globe {
    const s = this.ctx.start;
    const land = prog(t, s, this.tLand, ease.outCubic);
    const beat = this.ctx.audio.beatPeriod(t);
    const push = prog(t, this.tPush, this.tPush + 4 * beat, ease.inOutCubic);
    // 正面對著台灣本島的中心（不是現場：推近之後整個島都要在畫面裡）
    const lonC = TW_C[0] + 160 * (1 - land);
    const latC = lerp(8, TW_C[1], land);
    const r = lerp(300, 2000, push * push) * (1 + 0.012 * this.ctx.audio.hit('kick', t, 0.12));
    const cx = lerp(1140, 1070, push), cy = lerp(330, 290, push);
    return { lonC, latC, r, cx, cy, push };
  }

  /** 把地球上的點（單位向量，經緯度座標）轉到相機座標：中央經線轉到正面、再往下傾。 */
  private rot(v: V3, lonC: number, latC: number): V3 {
    const a = -lonC * D2R, ca = Math.cos(a), sa = Math.sin(a);
    const x = v[0] * ca + v[2] * sa, z = -v[0] * sa + v[2] * ca, y = v[1];
    const b = latC * D2R, cb = Math.cos(b), sb = Math.sin(b);
    return [x, y * cb - z * sb, y * sb + z * cb];
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const k = inOut(t, s, e, 0.2, 0.3);
    const G = this.globe(t);
    // 相機：看著地球中心，距離讓球在畫面上是 G.r 那麼大；用 view offset 把中心搬到 (cx, cy)
    const fpx = (H / 2) / Math.tan((this.cam.fov * D2R) / 2);
    const D = Math.sqrt((fpx / G.r) ** 2 + 1);
    this.cam.position.set(0, 0, D);
    this.cam.lookAt(0, 0, 0);
    this.cam.setViewOffset(W, H, W / 2 - G.cx, H / 2 - G.cy, W, H);
    this.cam.updateMatrixWorld();
    this.cam.updateProjectionMatrix();

    this.bg.u.t!.value = t;
    (this.bg.u.g!.value as THREE.Vector2).set(G.cx, G.cy);
    this.bg.u.gr!.value = Math.min(G.r, 900);
    this.bg.u.k!.value = k;
    this.bg.render(renderer, out);
    (this.sMat.uniforms.cBody!.value as THREE.Vector3).set(...LIN.ink2);
    (this.sMat.uniforms.cRim!.value as THREE.Vector3).set(...LIN.signal);
    this.sMat.uniforms.k!.value = k;
    renderer.setRenderTarget(out);
    renderer.render(this.scene3, this.cam);

    const heads = this.drawGlobe(t, G, k);
    this.g3.render(renderer, out, this.cam);

    const pin = this.project(this.rot(this.venue, G.lonC, G.latC));
    this.drawUI(t, pin, G.push);
    comp.draw(renderer, this.ui.upload(), out);
    this.glow.clear();
    if (k > 0.5) for (const h of heads) sparkHead(this.glow, h.x, h.y, t, 0.7, 0.9);
    const hl = this.headlineSpark(t);
    if (hl && k > 0.5) {
      sparkParticles(this.glow, t, (tt) => this.headlineSpark(tt), { rate: 90, life: 0.35, speed: 220, seed: 9 });
      sparkHead(this.glow, hl.x, hl.y, t, 1);
    }
    if (this.glow.count) this.glow.render(renderer, out);
    const avoid: Rect[] = [[X0 - 10, LABEL.y - 10, XR - X0 + 20, this.headH + LABEL.h + 20], [X0 - 10, TK.y - 10, XR - X0 + 20, TK.h + 20]];
    return { bloom: 0.7, vignette: 0.4, popupAvoid: avoid };
  }

  private project(v: V3) {
    const p = new THREE.Vector3(v[0], v[1], v[2]).project(this.cam);
    return { x: (p.x + 1) / 2 * W, y: (1 - p.y) / 2 * H };
  }

  /** 經緯線、台灣、漣漪、飛行弧線（3D，加亮）。回傳弧線的頭在畫面上的位置（給火花）。 */
  private drawGlobe(t: number, G: Globe, k: number) {
    const L = this.g3; L.clear();
    const au = this.ctx.audio;
    const D = this.cam.position.z;
    const hz = 1 / D; // 地平線：z 大於這個才看得到
    const face = (z: number) => clamp((z - hz) / 0.06);
    const gc = LIN.bone, sg = LIN.signal;
    const ga = 0.16 * k;
    const lines = (set: V3[][], alpha: number, w: number) => {
      if (alpha <= 0.005) return;
      for (const pl of set) {
        let prev: V3 | null = null;
        for (const v of pl) {
          const q = this.rot(v, G.lonC, G.latC);
          if (prev) {
            const a = Math.min(face(prev[2]), face(q[2]));
            if (a > 0.01) L.seg(prev[0], prev[1], prev[2], q[0], q[1], q[2], w, gc[0], gc[1], gc[2], alpha * a);
          }
          prev = q;
        }
      }
    };
    lines(this.grid, ga, 1.1);
    lines(this.fine, ga * 0.55 * prog(G.push, 0.2, 0.8), 1);
    // 台灣：訊號色，亮一點會發光
    const cst = this.coast.map((v) => this.rot(v, G.lonC, G.latC));
    for (let i = 0; i < cst.length; i++) {
      const a = cst[i]!, b = cst[(i + 1) % cst.length]!;
      L.seg(a[0], a[1], a[2], b[0], b[1], b[2], 2.2, sg[0] * 1.6, sg[1] * 1.6, sg[2] * 1.6, k * face(a[2]));
    }
    // 現場的漣漪：每一拍從標記泛出一圈（大鼓越重越亮）
    const vq = this.venue;
    const ax = norm(cross(vq, [0, 1, 0])), bx = cross(vq, ax);
    const beatNow = au.beatAt(t);
    const fpx = (H / 2) / Math.tan((this.cam.fov * D2R) / 2);
    const pxPerRad = fpx / Math.max(0.05, D - 1); // 球面正中央附近，一個弧度在畫面上幾 px
    for (let j = 0; j < 3; j++) {
      const bi = Math.floor(beatNow) - j;
      const age = beatNow - bi;
      if (au.timeOfBeat(bi) < this.tLand) continue;
      const ang = (6 + age * 42) / pxPerRad; // 畫面上 6 → 48 px
      const al = (1 - age / 3) * 0.9 * k;
      let prev: V3 | null = null;
      for (let i = 0; i <= 40; i++) {
        const th = (i / 40) * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang);
        const w: V3 = [vq[0] * ca + sa * (Math.cos(th) * ax[0] + Math.sin(th) * bx[0]), vq[1] * ca + sa * (Math.cos(th) * ax[1] + Math.sin(th) * bx[1]), vq[2] * ca + sa * (Math.cos(th) * ax[2] + Math.sin(th) * bx[2])];
        const q = this.rot(w, G.lonC, G.latC);
        if (prev) L.seg(prev[0], prev[1], prev[2], q[0], q[1], q[2], 1.6, sg[0] * 2, sg[1] * 2, sg[2] * 2, al);
        prev = q;
      }
    }
    // 飛行弧線：大圓路徑往外抬高，1.5 拍飛到；頭是火花，尾巴慢慢淡掉
    const heads: { x: number; y: number }[] = [];
    const beat = au.beatPeriod(t);
    for (const arc of this.arcs) {
      const u1 = prog(t, arc.t0, arc.t0 + 1.5 * beat, ease.inOutCubic);
      if (u1 <= 0) continue;
      const fade = 1 - prog(t, arc.t0 + 2 * beat, arc.t0 + 6 * beat);
      if (fade <= 0) continue;
      const n = 40, lift = 0.08 + 0.25 * arc.ang / Math.PI;
      let prev: V3 | null = null;
      for (let i = 0; i <= n; i++) {
        const u = (i / n) * u1;
        const p = this.slerp(arc.from, vq, u, arc.ang);
        const hgt = 1 + lift * Math.sin(Math.PI * u);
        const q = this.rot([p[0] * hgt, p[1] * hgt, p[2] * hgt], G.lonC, G.latC);
        if (prev) {
          const tail = 0.25 + 0.75 * (i / n);
          const vis = Math.min(face(prev[2] + 0.3 * (hgt - 1)), 1);
          L.seg(prev[0], prev[1], prev[2], q[0], q[1], q[2], 1.5, sg[0] * 1.8, sg[1] * 1.8, sg[2] * 1.8, k * fade * tail * vis);
        }
        prev = q;
      }
      if (u1 < 1 && prev && prev[2] > hz * 0.6) heads.push(this.project(prev));
    }
    return heads;
  }

  private slerp(a: V3, b: V3, u: number, ang: number): V3 {
    if (ang < 1e-4) return a;
    const s0 = Math.sin((1 - u) * ang) / Math.sin(ang), s1 = Math.sin(u * ang) / Math.sin(ang);
    return [a[0] * s0 + b[0] * s1, a[1] * s0 + b[1] * s1, a[2] * s0 + b[2] * s1];
  }

  // ------------------------------------------------------------ 圖卡
  /** 頭條面板打開時，仙女棒沿著上緣跑過去。 */
  private headlineSpark(t: number): { x: number; y: number } | null {
    const u = prog(t, this.b0 + 0.05, this.b0 + 0.5, ease.inOutCubic);
    if (u <= 0 || u >= 1) return null;
    return { x: lerp(X0, XR, u), y: HEAD_Y };
  }

  private drawUI(t: number, pin: { x: number; y: number }, push: number) {
    const L = this.ui; L.clear();
    const c = L.ctx;
    const { audio: au, live } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    c.globalAlpha = inOut(t, s, e, 0.2, 0.3);
    c.textBaseline = 'alphabetic';
    // ---- 台標與 LIVE（左上）
    c.fillStyle = rgba('signal', 0.95); c.fillRect(X0, 104, 156, 56);
    c.font = font(F.hei(900), 34); c.fillStyle = rgba('ink');
    c.fillText('喜訊台', X0 + 20, 144);
    c.font = font(F.mono(600), 15); c.fillStyle = rgba('bone', 0.8); c.letterSpacing = '3px';
    c.fillText('AO NEWS · 24H', X0, 184);
    c.letterSpacing = '0px';
    const bp = au.beatAt(t), blink = 1 - clamp((bp - Math.floor(bp)) * 2.5);
    c.strokeStyle = rgba('bone', 0.5); c.lineWidth = 1.5; c.strokeRect(X0 + 176, 112, 170, 40);
    c.fillStyle = rgba('signal', 0.35 + 0.65 * blink);
    c.beginPath(); c.arc(X0 + 198, 132, 8, 0, Math.PI * 2); c.fill();
    c.font = font(F.mono(600), 22); c.fillStyle = rgba('bone', 0.95);
    c.fillText('LIVE', X0 + 216, 140);
    c.font = font(F.hei(500), 20); c.fillText('現場', X0 + 284, 140);
    // 現場時間：午宴 12:30 開播，照歌曲時間走；冒號一拍閃一次
    const mins = 12 * 60 + 30 + Math.floor(t / 60);
    const hh = String(Math.floor(mins / 60)).padStart(2, '0'), mm = String(mins % 60).padStart(2, '0');
    c.font = font(F.mono(500), 26); c.fillStyle = rgba('bone', 0.85);
    c.fillText(hh, X0 + 368, 141);
    c.fillStyle = rgba('bone', 0.3 + 0.55 * blink); c.fillText(':', X0 + 402, 141);
    c.fillStyle = rgba('bone', 0.85); c.fillText(mm, X0 + 418, 141);

    // ---- 現場標記的標籤（推鏡之後才出現，跟著標記走）
    const la = prog(push, 0.55, 0.9);
    if (la > 0 && pin.x > 0 && pin.x < W) {
      const lx = pin.x + 34, ly = pin.y - 40;
      c.save(); c.globalAlpha *= la;
      c.strokeStyle = rgba('bone', 0.6); c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(pin.x + 6, pin.y - 6); c.lineTo(lx - 6, ly + 8); c.lineTo(lx + 180, ly + 8); c.stroke();
      c.font = font(F.hei(700), 26); c.fillStyle = rgba('bone', 0.95);
      c.fillText('婚禮現場', lx, ly);
      c.font = font(F.mono(500), 15); c.fillStyle = rgba('ash', 0.9); c.letterSpacing = '2px';
      c.fillText(`${VENUE[1].toFixed(2)}°N  ${VENUE[0].toFixed(2)}°E`, lx, ly + 32);
      c.letterSpacing = '0px';
      c.restore();
    }
    c.fillStyle = rgba('ember'); c.beginPath(); c.arc(pin.x, pin.y, 4.5, 0, Math.PI * 2); c.fill();

    // ---- 下三分之一：快訊標籤、頭條、署名
    const m = this.msg;
    const b0 = this.b0;
    const lu = prog(t, b0 - 0.05, b0 + 0.25, ease.outExpo);
    if (lu > 0) {
      const lw = 170 * lu;
      c.fillStyle = rgba('signal', 0.96); c.fillRect(X0, LABEL.y, lw, LABEL.h);
      c.save(); c.beginPath(); c.rect(X0, LABEL.y, lw, LABEL.h); c.clip();
      c.font = font(F.hei(900), 36); c.fillStyle = rgba('ink');
      c.fillText(m?.couple ? '新人發言' : m ? '快訊' : '現場', X0 + 22, LABEL.y + 43);
      c.restore();
      // 署名＝記者：「—— 阿哲　現場報導」
      const bu = prog(t, b0 + 0.3, b0 + 0.7, ease.outExpo);
      if (bu > 0) {
        c.save(); c.globalAlpha *= bu;
        c.fillStyle = rgba('ink2', 0.9); c.fillRect(X0 + 170, LABEL.y, (XR - X0 - 170) * bu, LABEL.h);
        c.font = font(F.hand(400), 36); c.fillStyle = rgba('bone', 0.92);
        const byline = m ? `${signature(m.name)}　現場報導` : '本台記者　現場報導';
        c.fillText(byline, X0 + 200, LABEL.y + 42);
        c.font = font(F.mono(500), 16); c.fillStyle = rgba('ash', 0.8); c.letterSpacing = '2px'; c.textAlign = 'right';
        c.fillText(m ? `NO.${String(m.n).padStart(3, '0')}` : `${live.count} 則祝福`, XR - 24, LABEL.y + 38);
        c.textAlign = 'left'; c.letterSpacing = '0px';
        c.restore();
      }
    }
    const hu = prog(t, b0 + 0.12, b0 + 0.5, ease.outExpo);
    if (hu > 0 && this.fit) {
      const fit = this.fit;
      const hh2 = this.headH;
      c.fillStyle = rgba('bone', 0.95); c.fillRect(X0, HEAD_Y, (XR - X0) * hu, hh2);
      // 每個小節線，上緣掃過一道訊號色的光
      const bar = au.barAt(t), ph = bar - Math.floor(bar);
      const sweep = prog(ph, 0, 0.35, ease.inOutCubic);
      if (t > b0 + 0.6 && sweep < 1) {
        const sx = X0 + (XR - X0) * sweep;
        c.fillStyle = rgba('signal', 0.9 * (1 - sweep)); c.fillRect(Math.max(X0, sx - 160), HEAD_Y, sx - Math.max(X0, sx - 160), 5);
      }
      c.fillStyle = rgba('signal', 0.95); c.fillRect(X0, HEAD_Y, 8, hh2);
      c.save(); c.beginPath(); c.rect(X0, HEAD_Y, (XR - X0) * hu, hh2); c.clip();
      // 頭條一行一行從下面冒上來（每行錯開 0.08 秒）
      fit.lines.forEach((ln, i) => {
        const ku = prog(t, b0 + 0.25 + i * 0.08, b0 + 0.6 + i * 0.08, ease.outExpo);
        if (ku <= 0) return;
        const one: FitResult = { ...fit, lines: [ln] };
        const y = HEAD_Y + 30 + fit.size * 0.92 + i * fit.lineHeight + (1 - ku) * 40;
        c.save(); c.globalAlpha *= ku;
        drawMessage(c, one, F.ming(700), X0 + 40, y, { color: rgba('ink', 0.96) });
        c.restore();
      });
      c.restore();
    }
    if (!m && hu > 0) {
      // 沒有留言：頭條下面一句邀請（跑馬燈上面）
      c.font = font(F.hei(500), 26); c.fillStyle = rgba('bone', 0.8 * hu);
      c.fillText('掃描右下角 QR code，你的祝福就是下一則頭條', X0 + 4, HEAD_Y + this.headH + 34);
    }

    // ---- 跑馬燈（歌詞）
    this.drawTicker(c, t);
  }

  /** 讀頭位置（帶子座標）：正在唱的字的位置；兩句之間在最後 1.2 秒滑到下一句的開頭。 */
  private headAt(t: number): number {
    const Ls = this.crawl.lines;
    if (!Ls.length) return 0;
    for (let i = 0; i < Ls.length; i++) {
      const c = Ls[i]!, ln = c.line;
      if (t < ln.start) {
        const prev = Ls[i - 1];
        const from = prev ? prev.x + prev.w : c.x - 300;
        const t0 = Math.max(prev ? prev.line.end : ln.start - 1.2, ln.start - 1.2);
        return lerp(from, c.x, prog(t, t0, ln.start - 0.05, ease.inOutCubic));
      }
      if (t < ln.end || i === Ls.length - 1) {
        let x = c.x;
        ln.words.forEach((w, j) => {
          const p = Lyrics.wordProgress(w, t);
          if (p > 0) x = c.x + c.words[j]!.x + c.words[j]!.w * p;
        });
        return x;
      }
    }
    return 0;
  }

  private drawTicker(c: CanvasRenderingContext2D, t: number) {
    const { lyrics } = this.ctx;
    c.fillStyle = rgba('ink', 0.94); c.fillRect(X0, TK.y, XR - X0, TK.h);
    c.fillStyle = rgba('bone', 0.12); c.fillRect(X0, TK.y, XR - X0, 1.5);
    c.fillStyle = rgba('bone', 0.92); c.fillRect(X0, TK.y, TK.labelW, TK.h);
    c.font = font(F.hei(900), 30); c.fillStyle = rgba('ink');
    c.fillText(lyrics.has ? '♪ 現場' : '即時', X0 + 24, TK.y + 50);
    const x0 = X0 + TK.labelW + 12, base = TK.y + TK.h / 2 + TK_SIZE * 0.36;
    c.save();
    c.beginPath(); c.rect(x0, TK.y, XR - x0, TK.h); c.clip();
    if (this.crawl.lines.length) {
      // 讀頭位置取最近 0.2 秒的平均：字一個一個唱出來時帶子是順的，不會一頓一頓
      let hsum = 0;
      for (let i = 0; i < 5; i++) hsum += this.headAt(t - i * 0.05);
      const head = hsum / 5;
      c.font = font(F.archivo(100, 700), TK_SIZE);
      for (const cl of this.crawl.lines) {
        const lx = HEAD_X + cl.x - head;
        if (lx > XR || lx + cl.w < x0) continue;
        cl.line.words.forEach((w, j) => {
          const p = Lyrics.wordProgress(w, t);
          const wx = lx + cl.words[j]!.x;
          c.fillStyle = p >= 1 ? rgba('bone', 0.95) : rgba('bone', 0.3);
          c.fillText(w.w, wx, base);
          if (p > 0 && p < 1) {
            c.save(); c.beginPath(); c.rect(wx - 4, TK.y, cl.words[j]!.w * p + 4, TK.h); c.clip();
            c.fillStyle = rgba('signal'); c.fillText(w.w, wx, base);
            c.restore();
          }
        });
        c.fillStyle = rgba('signal', 0.7);
        c.fillText('◆', lx + cl.w + TK_SIZE * 0.55, base - 2);
      }
    } else {
      // 純音樂：固定的快訊，等速往左跑
      c.font = font(F.hei(700), TK_SIZE * 0.9); c.fillStyle = rgba('bone', 0.9);
      const txt = TICKER_IDLE.join(SEP) + SEP;
      const off = ((t * 120) % this.idleW + this.idleW) % this.idleW;
      for (let x = x0 - off; x < XR; x += this.idleW) c.fillText(txt, x, base);
    }
    c.restore();
    // 讀頭的小三角（正在唱的位置）
    if (this.crawl.lines.length) { c.fillStyle = rgba('signal', 0.8); c.beginPath(); c.moveTo(HEAD_X - 7, TK.y); c.lineTo(HEAD_X + 7, TK.y); c.lineTo(HEAD_X, TK.y + 9); c.closePath(); c.fill(); }
  }
}
