// 新聞快報（批次 T6・螢幕 B，暗）：自己設計的「喜訊台」新聞（不像任何一家真的電視台），在暗暗的客廳裡的一台電視上播。
// MV 檢修後：整個新聞畫面先畫進一張「電視訊號」貼圖，再用 _t6 的 ScreenRig 擺成客廳裡的一台電視（邊框、玻璃反光、
// 電視的光灑在牆上與矮櫃上），鏡頭整個窗格很慢地往電視推近、轉正。電視上的新聞只留三樣：
//  - 頭條＝主打留言（思源宋體；留言標準 v2：螢幕上 40～60 px），放在半透明的暗色字幕條上（只比字多一點邊距），
//    署名「—— 阿哲　現場報導」在最後一行下面；字幕條從下往上長，長留言比較高。
//    「快訊」標籤在第一拍切進來，每個小節線頭條上緣掃過一道光。沒有留言時頭條是「現正播放：歌名」＋一句邀請。
//  - 跑馬燈是歌詞：速度跟著歌聲走——正在唱的字永遠停在「讀頭」的位置（逐字跟唱）。純音樂時跑固定的快訊。
//  - 背景的線框地球：開場轉到台灣、推進到婚禮現場，賓客從世界各地沿大圓弧線飛過來（一拍一條），現場在大鼓上泛漣漪。
//  小字只剩左上角「喜訊台 ● LIVE」（LIVE 一拍閃一次）和地圖上的「婚禮現場」。
// 手法：地球（球體 mesh 的菲涅耳邊光＋LineBatch 3D 線）、字與圖卡（Canvas 層）都畫進電視訊號；客廳是一個 GLSL pass。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, makeRT } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, lerp, prog, mulberry32 } from '../engine/util';
import { Lyrics, type Line } from '../engine/lyrics';
import type { FitResult } from '../engine/text';
import { sparkHead, sparkParticles, beatAfter, barAfter, signature, drawMessage, NAME_A, NAME_B, lyricSubOf, subSizeFor, subGap } from './_motifs';
import { TAIWAN, VENUE, beatsIn, inOut, ScreenRig, loadPlateText } from './_t6';
import { fitText } from '../engine/text';
import { msgMaxFor, lyricV2, sigV2, fitClauses, V2 } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'screen', paper: false, energy: [0.35, 1], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 版面
// 這些是「電視訊號」的座標（1920×1080）：整個畫面會放在電視上、縮小約八成，所以字都比直接上螢幕大一號
const X0 = 110, XR = 1330;
const LABEL_H = 62; // 快訊標籤（貼在頭條面板上緣）
const HEAD_B = 826; // 頭條面板的下緣（固定）；面板往上長，長留言的面板比較高
const HEAD_MIN_Y = 330; // 面板最高到這裡
const TK = { y: 846, h: 108, labelW: 108 }; // 跑馬燈
/** 電視在畫面上的縮放（最小、最大）：v2 的字級是螢幕上的 px，電視訊號裡的字級要除以它。 */
const TV_MIN = 0.66, TV_MAX = 0.7;
const HEAD_X = 600; // 跑馬燈的讀頭（正在唱的字停在這裡）
const SEP = '　◆　';
const TICKER_IDLE = ['現場天氣：降愛機率百分之百', '交通：往幸福的路上一路順暢', '掃描右下角 QR code，你的祝福就是下一則頭條', '伴郎伴娘已就位', '喜宴菜色：一道比一道更甜'];
const TEXT = `喜訊台快訊現場直播報導婚禮新人發言現正播放中掃描右下角你的祝福就是下一則頭條歌詞緯度經度台灣${TICKER_IDLE.join('')}${NAME_A}${NAME_B}`;
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

// 房間：很暗的客廳，電視的光打在後面的牆上（跟著電視的位置），電視下面一條矮櫃的邊
const ROOM = () => new FSPass(/* glsl */ `
  uniform vec2 c; uniform vec2 r; uniform float glow; uniform float k;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 d = (p - c) / (r * 1.5);
    float spill = exp(-dot(d, d) * 1.1);
    vec3 col = C_INK * 0.7 + (C_INK2 - C_INK * 0.7) * (0.25 + 1.3 * spill * glow) + C_SIGNAL * 0.018 * spill * glow;
    float shelf = c.y + r.y + 46.0;
    float top = 1.0 - smoothstep(0.0, 2.5, abs(p.y - shelf));
    float body = step(shelf, p.y) * (1.0 - smoothstep(shelf, shelf + 120.0, p.y));
    float span = 1.0 - smoothstep(r.x * 1.15, r.x * 1.3, abs(p.x - c.x));
    col = mix(col, C_INK * 0.55, body * span);
    col += C_BONE * 0.05 * top * span * glow;
    col += (C_INK2 - C_INK) * 0.2 * fbm(p / 500.0, 3);
    fragColor = vec4(col * mix(0.5, 1.0, k), 1.0);
  }`, { c: { value: new THREE.Vector2(960, 480) }, r: { value: new THREE.Vector2(700, 400) }, glow: { value: 1 }, k: { value: 1 } });

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
/** 跑馬燈的帶子；有韓文原文時多一條原文軌：sx 是這一句的原文在原文軌上的位置（原文軌有自己的讀頭，字小、跑得慢一點）。 */
interface Crawl { lines: { line: Line; x: number; w: number; words: { x: number; w: number }[]; sx: number; sub?: { line: Line; w: number; words: { x: number; w: number }[] } }[]; total: number }

export default class News extends Scene {
  bg = shared('news.bg', BG);
  ui = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 電視訊號（整個新聞畫面先畫在這裡，再當成電視螢幕的貼圖）。 */
  tv = this.track(makeRT(W, H));
  rig = new ScreenRig(this.tv.texture, W, H, { decode: false, bezel: 20, radius: 8 });
  room = shared('news.room', ROOM);
  g3 = this.track(new LineBatch(9000, { screen2D: false, blend: 'add' }));
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  private scene3 = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(30, W / H, 0.005, 100);
  private sphere!: THREE.Mesh;
  private sMat!: THREE.RawShaderMaterial;
  fit: FitResult | null = null;
  headH = 200;
  /** 頭條字幕條的寬、署名字級、跑馬燈字級（電視訊號座標）。 */
  headW = 800; sigSize = 40; tkSize = 70;
  /** 頭條面板的上緣（依留言長短）。 */
  headY = 600;
  tLand = 0; tPush = 0; b0 = 0;
  arcs: Arc[] = [];
  crawl: Crawl = { lines: [], total: 0 };
  idleW = 0;
  /** 跑馬燈的高度；有韓文原文時多一條小一號的原文軌（字級、跟中文基線的距離，電視訊號座標）。 */
  tkH = TK.h; subSize = 0; subDy = 0;
  /** 經緯線（經緯度點列，每格旋轉投影）。 */
  private grid: V3[][] = [];
  private fine: V3[][] = [];
  private coast: V3[] = [];
  private venue = norm(llToV(VENUE[0], VENUE[1]));

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    // 原文副行在 await 之前先拿：引擎只在呼叫 init 前設好這一格的開關
    const subOf = new Map(lyrics.linesIn(s - 30, e + 30).map((l) => [l, lyricSubOf(l)] as const));
    await loadPlateText(this.ctx, TEXT + TICKER_IDLE.join(''));
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
      // 整個窗格都有賓客飛過來：兩拍一條（窗格長時中段也一直有小事件）
      if (i % 2 || i >= 40) return;
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
    // 頭條（留言）：v2 的字級是螢幕上的 px，電視訊號裡要除以電視的縮放（下限用最小的縮放、上限用最大的，
    // 螢幕上才會落在 40～60）；字幕條寬不超過螢幕上 860 px。署名在最後一行下面。
    const fam = F.ming(700);
    const o = { min: V2.msgMin / TV_MIN, max: (this.msg ? msgMaxFor(headText) : 48) / TV_MAX, lineHeight: 1.26, maxLines: 5 };
    const mw = Math.min(XR - X0 - 80, 860 / TV_MAX - 80);
    this.sigSize = this.msg ? sigV2(o.max * TV_MAX) / TV_MAX : 0;
    const mh = Math.min(HEAD_B - HEAD_MIN_Y, 430 / TV_MAX) - 60 - this.sigSize * 1.9;
    this.fit = fitClauses(c, headText, fam, mw, mh, o) ?? fitText(c, headText, fam, mw, mh, o);
    const msgScreen = this.msg ? this.fit.size * TV_MAX : null;
    if (this.msg) this.sigSize = sigV2(msgScreen!) / TV_MAX;
    this.headH = this.fit.height + 56 + (this.msg ? this.sigSize * 1.9 : 0);
    this.headY = HEAD_B - this.headH;
    c.font = font(fam, this.fit.size);
    this.headW = Math.max(460, this.fit.width + 90);
    // 跑馬燈（歌詞）：比留言小一級（v2）
    this.tkSize = lyricV2(msgScreen) / TV_MAX;
    // 跑馬燈：把這個窗格附近的歌詞排成一條長帶子
    c.font = font(F.archivo(100, 700), this.tkSize);
    const sepW = c.measureText(SEP).width;
    // 韓文原文：跑馬燈下面多一條小一號的軌（v2 的字級是螢幕 px，換成電視訊號座標）。原文軌有自己的讀頭：
    // 正在唱的原文也停在讀頭下面（跟中文上下對齊），不會因為字小跑在中文後面、被左邊裁掉
    if ([...subOf.values()].some(Boolean)) {
      const scr = this.tkSize * TV_MAX, ss = subSizeFor(scr);
      this.subSize = ss / TV_MAX;
      this.subDy = subGap(scr, ss) / TV_MAX;
      this.tkH = TK.h + this.subSize * 1.35;
    }
    c.font = font(F.archivo(100, 700), this.subSize || 1);
    const subSepW = c.measureText(SEP).width;
    let x = 0, sx = 0;
    for (const ln of lyrics.linesIn(s - 30, e + 30)) {
      c.font = font(F.archivo(100, 700), this.tkSize);
      const words = ln.words.map((w) => ({ x: c.measureText(ln.text.slice(0, w.o)).width, w: c.measureText(w.w).width }));
      const w = c.measureText(ln.text).width;
      const sl = subOf.get(ln);
      let sub: Crawl['lines'][number]['sub'];
      if (sl) {
        c.font = font(F.archivo(100, 700), this.subSize);
        sub = { line: sl, w: c.measureText(sl.text).width, words: sl.words.map((sw) => ({ x: c.measureText(sl.text.slice(0, sw.o)).width, w: c.measureText(sw.w).width })) };
      }
      this.crawl.lines.push({ line: ln, x, w, words, sx, sub });
      x += w + sepW;
      sx += (sub?.w ?? 0) + subSepW;
    }
    this.crawl.total = x;
    c.font = font(F.hei(700), this.tkSize * 0.9);
    this.idleW = c.measureText(TICKER_IDLE.join(SEP) + SEP).width;
  }

  override dispose() {
    this.sphere?.geometry.dispose();
    this.sMat?.dispose();
    this.rig.dispose();
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
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const k = inOut(t, s, e, 0.25, 0.3);
    // 1) 新聞畫面畫進電視訊號；2) 客廳＋電視，鏡頭很慢地往電視推近、轉正
    this.broadcast(f, this.tv);
    const u = ease.inOutQuad(clamp((t - s) / Math.max(1, e - s)));
    const kick = f.a.kick;
    // 電視在畫面左上，右下角 HUD 那一區只看得到矮櫃與暗暗的牆
    this.rig.pose({ fx: W / 2, fy: H / 2, cx: lerp(850, 872, u), cy: lerp(440, 452, u), scale: lerp(TV_MIN, TV_MAX, u) * (1 + 0.004 * kick), rx: 0.025, ry: lerp(0.16, 0.08, u), rz: -0.005 });
    const c0 = this.rig.toScreen(W / 2, H / 2), c1 = this.rig.toScreen(W, H);
    (this.room.u.c!.value as THREE.Vector2).set(c0.x, c0.y);
    (this.room.u.r!.value as THREE.Vector2).set(Math.abs(c1.x - c0.x), Math.abs(c1.y - c0.y));
    this.room.u.glow!.value = 1 + 0.25 * kick;
    this.room.u.k!.value = k;
    this.room.render(renderer, out);
    const U = this.rig.u;
    (U.bezelCol!.value as THREE.Vector3).set(LIN.ink[0] * 0.4, LIN.ink[1] * 0.4, LIN.ink[2] * 0.4);
    (U.rimCol!.value as THREE.Vector3).set(...LIN.bone);
    U.edgeDark!.value = 0.18;
    U.glare!.value = 0.35 - 0.3 * u;
    U.glareK!.value = 1.2;
    U.k!.value = k;
    this.rig.render(renderer, out);
    return { bloom: 0.6, vignette: 0.55 };
  }

  /** 新聞畫面本身（電視訊號）。 */
  private broadcast(f: Frame, out: THREE.WebGLRenderTarget) {
    const { renderer, comp } = this.ctx;
    const t = f.t;
    const k = 1;
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
    const ga = 0.11 * k;
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
          L.seg(prev[0], prev[1], prev[2], q[0], q[1], q[2], 1.5, sg[0] * 1.1, sg[1] * 1.1, sg[2] * 1.1, 0.7 * k * fade * tail * vis);
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
    return { x: lerp(X0, XR, u), y: this.headY };
  }

  private drawUI(t: number, pin: { x: number; y: number }, push: number) {
    const L = this.ui; L.clear();
    const c = L.ctx;
    const { audio: au } = this.ctx;
    c.textBaseline = 'alphabetic';
    // ---- 台標與 LIVE（左上，小小一組）：LIVE 的紅點一拍閃一次
    c.font = font(F.hei(900), 34); c.fillStyle = rgba('bone', 0.8);
    c.fillText('喜訊台', X0, 132);
    const bp = au.beatAt(t), blink = 1 - clamp((bp - Math.floor(bp)) * 2.5);
    c.fillStyle = rgba('signal', 0.35 + 0.65 * blink);
    c.beginPath(); c.arc(X0 + 138, 120, 8, 0, Math.PI * 2); c.fill();
    c.font = font(F.mono(600), 24); c.fillStyle = rgba('bone', 0.7);
    c.fillText('LIVE', X0 + 156, 129);

    // ---- 現場標記的標籤（推鏡之後才出現，跟著標記走）
    const la = prog(push, 0.55, 0.9);
    if (la > 0 && pin.x > 0 && pin.x < W) {
      const lx = pin.x + 34, ly = pin.y - 40;
      c.save(); c.globalAlpha *= la;
      c.strokeStyle = rgba('bone', 0.6); c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(pin.x + 6, pin.y - 6); c.lineTo(lx - 6, ly + 8); c.lineTo(lx + 180, ly + 8); c.stroke();
      c.font = font(F.hei(700), 26); c.fillStyle = rgba('bone', 0.95);
      c.fillText('婚禮現場', lx, ly);
      c.restore();
    }
    c.fillStyle = rgba('ember'); c.beginPath(); c.arc(pin.x, pin.y, 4.5, 0, Math.PI * 2); c.fill();

    // ---- 下三分之一：快訊標籤、頭條、署名
    const m = this.msg;
    const b0 = this.b0;
    const lu = prog(t, b0 - 0.05, b0 + 0.25, ease.outExpo);
    if (lu > 0) {
      const lw = (m?.couple ? 230 : 160) * lu;
      c.fillStyle = rgba('signal', 0.96); c.fillRect(X0, this.headY - LABEL_H, lw, LABEL_H);
      c.save(); c.beginPath(); c.rect(X0, this.headY - LABEL_H, lw, LABEL_H); c.clip();
      c.font = font(F.hei(900), 40); c.fillStyle = rgba('ink');
      c.fillText(m?.couple ? '新人發言' : m ? '快訊' : '現場', X0 + 24, this.headY - LABEL_H + 46);
      c.restore();
    }
    const hu = prog(t, b0 + 0.12, b0 + 0.5, ease.outExpo);
    if (hu > 0 && this.fit) {
      const fit = this.fit;
      const hh2 = this.headH;
      const HW = this.headW;
      // v2：輕的容器——半透明的暗色字幕條，上緣一條細細的紙白線，只比字多一點邊距
      c.fillStyle = rgba('ink', 0.62); c.fillRect(X0, this.headY, HW * hu, hh2);
      c.fillStyle = rgba('bone', 0.35); c.fillRect(X0, this.headY, HW * hu, 1.5);
      // 每個小節線，上緣掃過一道訊號色的光
      const bar = au.barAt(t), ph = bar - Math.floor(bar);
      const sweep = prog(ph, 0, 0.35, ease.inOutCubic);
      if (t > b0 + 0.6 && sweep < 1) {
        const sx = X0 + HW * sweep;
        c.fillStyle = rgba('signal', 0.9 * (1 - sweep)); c.fillRect(Math.max(X0, sx - 160), this.headY, sx - Math.max(X0, sx - 160), 4);
      }
      c.fillStyle = rgba('signal', 0.95); c.fillRect(X0, this.headY, 6, hh2);
      c.save(); c.beginPath(); c.rect(X0, this.headY, HW * hu, hh2); c.clip();
      // 頭條一行一行從下面冒上來（每行錯開 0.08 秒）
      fit.lines.forEach((ln, i) => {
        const ku = prog(t, b0 + 0.25 + i * 0.08, b0 + 0.6 + i * 0.08, ease.outExpo);
        if (ku <= 0) return;
        const one: FitResult = { ...fit, lines: [ln] };
        const y = this.headY + 28 + fit.size * 0.92 + i * fit.lineHeight + (1 - ku) * 40;
        c.save(); c.globalAlpha *= ku;
        drawMessage(c, one, F.ming(700), X0 + 40, y, { color: rgba('bone', 0.97) });
        c.restore();
      });
      // 署名＝記者：「—— 阿哲　現場報導」（面板裡的最後一行，靠右）
      if (m) {
        const bu = prog(t, b0 + 0.5, b0 + 0.9, ease.outCubic);
        c.save(); c.globalAlpha *= bu;
        const sy = this.headY + 28 + fit.size * 0.92 + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.35 + this.sigSize * 1.35;
        c.font = font(F.hand(400), this.sigSize); c.fillStyle = rgba('ash', 0.95); c.textAlign = 'right';
        c.fillText(`${signature(m.name)}　現場報導`, X0 + HW - 30, sy);
        c.textAlign = 'left';
        c.restore();
      }
      c.restore();
    }
    if (!m && hu > 0) {
      // 沒有留言：頭條下面一句邀請（跑馬燈上面）
      c.font = font(F.hei(500), 30); c.fillStyle = rgba('bone', 0.55 * hu);
      c.fillText('掃描右下角 QR code，你的祝福就是下一則頭條', X0 + 260, this.headY - 20);
    }

    // ---- 跑馬燈（歌詞）
    this.drawTicker(c, t);
  }

  /** 讀頭位置（帶子座標）：正在唱的字的位置；兩句之間在最後 1.2 秒滑到下一句的開頭。sub：原文軌的讀頭（用原文自己的逐字時間）。 */
  private headAt(t: number, sub = false): number {
    const Ls = this.crawl.lines;
    if (!Ls.length) return 0;
    const X = (c: Crawl['lines'][number]) => (sub ? c.sx : c.x), Wd = (c: Crawl['lines'][number]) => (sub ? c.sub?.w ?? 0 : c.w);
    for (let i = 0; i < Ls.length; i++) {
      const c = Ls[i]!, ln = c.line;
      if (t < ln.start) {
        const prev = Ls[i - 1];
        const from = prev ? X(prev) + Wd(prev) : X(c) - 300;
        const t0 = Math.max(prev ? prev.line.end : ln.start - 1.2, ln.start - 1.2);
        return lerp(from, X(c), prog(t, t0, ln.start - 0.05, ease.inOutCubic));
      }
      if (t < ln.end || i === Ls.length - 1) {
        let x = X(c);
        const [L, ws] = sub ? [c.sub?.line, c.sub?.words] : [ln, c.words];
        L?.words.forEach((w, j) => {
          const p = Lyrics.wordProgress(w, t);
          if (p > 0) x = X(c) + ws![j]!.x + ws![j]!.w * p;
        });
        return x;
      }
    }
    return 0;
  }

  private drawTicker(c: CanvasRenderingContext2D, t: number) {
    const { lyrics } = this.ctx;
    const tkH = this.tkH;
    c.fillStyle = rgba('ink', 0.94); c.fillRect(X0, TK.y, XR - X0, tkH);
    c.fillStyle = rgba('bone', 0.12); c.fillRect(X0, TK.y, XR - X0, 1.5);
    c.fillStyle = rgba('bone', 0.92); c.fillRect(X0, TK.y, TK.labelW, tkH);
    c.font = font(F.hei(900), lyrics.has ? 44 : 32); c.fillStyle = rgba('ink'); c.textAlign = 'center';
    c.fillText(lyrics.has ? '♪' : '即時', X0 + TK.labelW / 2, TK.y + TK.h / 2 + (lyrics.has ? 16 : 11));
    c.textAlign = 'left';
    const x0 = X0 + TK.labelW + 12, base = TK.y + TK.h / 2 + this.tkSize * 0.36;
    c.save();
    c.beginPath(); c.rect(x0, TK.y, XR - x0, tkH); c.clip();
    if (this.crawl.lines.length) {
      // 讀頭位置取最近 0.2 秒的平均：字一個一個唱出來時帶子是順的，不會一頓一頓
      let hsum = 0, ssum = 0;
      for (let i = 0; i < 5; i++) { hsum += this.headAt(t - i * 0.05); if (this.subSize) ssum += this.headAt(t - i * 0.05, true); }
      const head = hsum / 5, subHead = ssum / 5;
      c.font = font(F.archivo(100, 700), this.tkSize);
      for (const cl of this.crawl.lines) {
        const lx = HEAD_X + cl.x - head;
        if (cl.sub) {
          // 原文軌：跟著自己的讀頭跑，唱到、唱完都是白字淡兩成（不用訊號色），逐字時間是原文自己的
          const sb = cl.sub, slx = HEAD_X + cl.sx - subHead;
          if (slx <= XR && slx + sb.w >= x0) {
            c.font = font(F.archivo(100, 700), this.subSize);
            sb.line.words.forEach((w, j) => {
              const p = Lyrics.wordProgress(w, t);
              const wx = slx + sb.words[j]!.x;
              if (p < 1) { c.fillStyle = rgba('bone', 0.3); c.fillText(w.w, wx, base + this.subDy); }
              if (p > 0) {
                c.save(); c.beginPath(); c.rect(wx - 4, TK.y, sb.words[j]!.w * p + 4, tkH); c.clip();
                c.fillStyle = rgba('bone', 0.95 * 0.8); c.fillText(w.w, wx, base + this.subDy);
                c.restore();
              }
            });
            c.font = font(F.archivo(100, 700), this.tkSize);
          }
        }
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
        c.fillText('◆', lx + cl.w + this.tkSize * 0.55, base - 2);
      }
    } else {
      // 純音樂：固定的快訊，等速往左跑
      c.font = font(F.hei(700), this.tkSize * 0.9); c.fillStyle = rgba('bone', 0.9);
      const txt = TICKER_IDLE.join(SEP) + SEP;
      const off = ((t * 120) % this.idleW + this.idleW) % this.idleW;
      for (let x = x0 - off; x < XR; x += this.idleW) c.fillText(txt, x, base);
    }
    c.restore();
    // 讀頭的小三角（正在唱的位置）
    if (this.crawl.lines.length) { c.fillStyle = rgba('signal', 0.8); c.beginPath(); c.moveTo(HEAD_X - 7, TK.y); c.lineTo(HEAD_X + 7, TK.y); c.lineTo(HEAD_X, TK.y + 9); c.closePath(); c.fill(); }
  }
}
