// 花瓣雨（暗）：從上往下看一片深色的木地板，一盞燈在地上打出一圈暖光，花瓣從鏡頭上方飄下來（近的大而糊、落地的清楚）。
//  - 花瓣在拍點一陣一陣灑下來，落地的位置排成主打留言的字：一個字一個字（一拍幾個字）在拍點上「落定」，
//    剛落地的一瞬間亮一下；愛心的花瓣是點綴色（玫瑰），其他是暖白。之外一直有零星的花瓣慢慢飄、散落在地上。
//    窗格夠長的話，最後半拍一陣風從左邊把字吹散（退場）。
//  - 歌詞（比留言小一級）是燈打在地板近處的一行光字，逐字跟唱。
//  - 沒有留言：花瓣排的是正在唱的那一句歌詞（每一句提早一點飄下來、唱到的字的花瓣變成訊號色），
//    唱完一陣風從左邊把它吹散，下一句的花瓣接著落下來；地板近處是新人的名字與一行小小的邀請。
//  - 鏡頭：幾乎是正上方往下看、稍微斜一點（有景深）；切進來時高一點、第一拍落定；之後很慢地往下推近。
// 手法：three.js。花瓣是一個 InstancedBufferGeometry（每片花瓣只有幾個固定的參數：落點、落地時間、飄多久、被風吹走的時間、
// 屬於哪個字），位置、翻轉、景深全在 vertex shader 裡用時間算（CPU 每格不用算幾千個矩陣，也是確定性的）；
// 地板是一個 shader（木紋、光圈、地上的光字取樣一張 Canvas 圖層）；整個場景畫進引擎共用的 MSAA 目標（花瓣用 alpha to coverage，不用排序）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H, clearRT, sharedMSAA } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, hash, TAU } from '../engine/util';
import { lyricAt, beatAfter, drawHeart, COUPLE_ZH } from './_motifs';
import { layoutRows, drawRows, darkInk } from './_t4';
import { T23_INVITE, T23_TEXT, sigOf, layMsg, stagger, rawMat, type Rect } from './_t23';

export const spec: PlateSpecDecl = { group: 'type', family: 'instrument', paper: false, energy: [0.3, 1], bars: [4, 8] };

// ---------------------------------------------------------------- 版面（頁面 px = 地板上的座標，鏡頭在定位時大約就是畫面座標）
/** 頁面 1 px = 地板 0.1 單位。 */
const S = 0.1;
const MSG_BOX = { x: 230, y: 250, w: 1460, h: 520 };
const SOLO_BOX = { x: 200, y: 300, w: 1520, h: 420 };
const LYR = { x: 250, y: 920, w: 1060 };
/** 花瓣排字用最粗的黑體（宋體的橫筆太細，花瓣排不出來）。 */
const FAM_MSG = F.hei(900);
const FAM_LYR = F.archivo(100, 600);
const CAP = 7000;
const NAMB = 360;
const FLOOR_PG = { w: 1920, h: 1080 };

// ---------------------------------------------------------------- shader
const PETAL_V = /* glsl */ `
in vec3 position; in vec2 uv;
in vec4 aTgt;   // 落點 x、z、平放時的角度、大小
in vec4 aTime;  // 落地時間、飄多久、被風吹走的時間、種類（0 = 字、1 = 零星、2 = 愛心）
in vec4 aSeed;  // 亂數
in vec2 aWord;  // 屬於的那個字的開始、結束（跟唱；不是歌詞是 -1）
uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
uniform float uT; uniform float uFocus;
out vec2 vUv; out float vLand; out float vCoc; out vec3 vN; out float vKind; out vec2 vWord; out float vHot; out float vSeed; out float vFade;
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
void main() {
  float land = aTime.x, fall = aTime.y, gust = aTime.z;
  float tau = uT - land;
  vUv = uv; vKind = aTime.w; vWord = aWord; vSeed = aSeed.x;
  float u = clamp((tau + fall) / fall, 0.0, 1.0);   // 0 = 剛從上面出現、1 = 落地
  float air = 1.0 - u;
  // 還沒出現：丟到鏡頭後面
  if (tau < -fall) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  // 飄落：高度照 (1-u)^1.7 往下（快落地時慢下來）、橫著飄、左右擺；翻轉在落地前收成平的
  vec3 pos = vec3(aTgt.x, 0.0, aTgt.y);
  float h = 130.0 * pow(air, 1.7) * (0.75 + 0.5 * aSeed.y);
  pos.y += h + 0.02 + aSeed.w * 0.03;
  pos.x += (aSeed.z - 0.5) * 60.0 * pow(air, 1.3) + sin(tau * (2.0 + 2.0 * aSeed.y) + aSeed.x * 20.0) * 3.0 * air;
  pos.z += -(22.0 + 20.0 * aSeed.w) * pow(air, 1.4) + cos(tau * (1.7 + aSeed.z) + aSeed.y * 9.0) * 2.0 * air;
  mat3 R = rotY(aTgt.z) * rotX((aSeed.x - 0.5) * 12.0 * air + sin(tau * 5.0 + aSeed.w * 10.0) * 1.2 * air) * rotZ((aSeed.y - 0.5) * 9.0 * air);
  // 風：從左邊吹過來，花瓣被掀起來往右飛、翻、淡掉
  vFade = 1.0;
  if (uT > gust) {
    float g = uT - gust;
    pos += vec3(40.0 * g + 70.0 * g * g, 18.0 * g * (0.5 + aSeed.y) - 4.0 * g * g, -6.0 * g * (aSeed.z - 0.5));
    R = R * rotX(g * (6.0 + 6.0 * aSeed.x)) * rotZ(g * 4.0 * (aSeed.w - 0.5));
    vFade = 1.0 - smoothstep(0.5, 1.4, g);
  }
  // 花瓣：躺在 XZ 平面上的一片（local 的 xy → 世界的 xz），大小 aTgt.w
  vec3 lp = vec3(position.x, 0.0, position.y) * aTgt.w;
  vec3 wp = pos + R * lp;
  vN = R * vec3(0.0, 1.0, 0.0);
  vLand = step(0.0, tau) * step(uT, gust);
  vHot = tau >= 0.0 ? exp(-tau / 0.25) : 0.0;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  // 景深：離焦點越遠越糊（近的花瓣大而糊）
  vCoc = clamp(abs(-mv.z - uFocus) / uFocus * 3.2, 0.0, 1.0);
  gl_Position = projectionMatrix * mv;
}`;
const PETAL_F = /* glsl */ `
in vec2 vUv; in float vLand; in float vCoc; in vec3 vN; in float vKind; in vec2 vWord; in float vHot; in float vSeed; in float vFade;
uniform float uT; uniform float uKick;
void main() {
  // 花瓣的形狀：一頭圓、一頭尖一點，圓的那頭有一個小凹口（像玫瑰花瓣）
  vec2 q = vUv - 0.5;
  q.y += 0.06;
  float r = length(vec2(q.x * (1.25 + 0.9 * max(q.y, 0.0)), q.y));
  float notch = smoothstep(0.02, 0.0, abs(q.x)) * smoothstep(0.3, 0.42, q.y) * 0.1;
  float d = r + notch - 0.42;
  float soft = 0.01 + 0.2 * vCoc;
  float a = 1.0 - smoothstep(-soft, soft, d);
  a *= 1.0 - 0.55 * vCoc;
  a *= vFade;
  if (a < 0.02) discard;
  // 顏色：字的花瓣暖白、愛心玫瑰、零星的花瓣帶一點訊號色；尖端稍微深一點
  vec3 base = vKind > 1.5 ? C_ROSE : vKind > 0.5 ? mix(mix(C_BONE, C_SIGNAL, 0.45), C_ROSE, step(0.8, vSeed) * 0.6) : mix(C_BONE, C_PAPER, 0.3);
  float karaoke = 0.0;
  if (vWord.x >= 0.0) {
    // 歌詞的花瓣：還沒唱是暗的、正在唱是訊號色、唱完是暖白
    float p = clamp((uT - vWord.x) / max(0.05, vWord.y - vWord.x), 0.0, 1.0);
    bool on = uT >= vWord.x && uT < vWord.y + 0.05;
    base = on ? mix(C_SIGNAL, C_EMBER, 0.3) * 1.6 : uT >= vWord.x ? base : base * 0.42;
    karaoke = on ? 1.0 : 0.0;
  }
  vec3 col = base * (0.55 + 0.45 * smoothstep(0.45, -0.2, q.y));
  col *= 1.0 - 0.25 * smoothstep(0.1, 0.0, abs(q.x)) * smoothstep(-0.3, 0.2, q.y) * 0.4;
  // 燈從上面來：平躺的最亮，翻起來的暗；背面（翻過去）再暗一點
  float lit = 0.55 + 0.45 * abs(vN.y);
  col *= lit * (vN.y < 0.0 ? 0.8 : 1.0);
  // 零星的花瓣落地後暗一點（地上的，不搶字）
  if (vKind > 0.5 && vKind < 1.5) col *= mix(1.0, 0.55, vLand);
  // 剛落地的一瞬間亮一下（大鼓時也亮一點）
  col += mix(C_SIGNAL, C_EMBER, 0.5) * vHot * 1.4 * (vKind < 0.5 || vKind > 1.5 ? 1.0 : 0.3);
  col *= 1.0 + 0.1 * uKick * vLand;
  // alpha to coverage：顏色不要預乘（覆蓋率由 MSAA 的取樣點決定）
  fragColor = vec4(col, a);
}`;
const FLOOR_V = /* glsl */ `
in vec3 position; in vec2 uv;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
out vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FLOOR_F = /* glsl */ `
in vec3 vW;
uniform sampler2D uTxt; uniform sampler2D uGlow; uniform float uGlowA; uniform float uOn; uniform float uKick;
void main() {
  vec2 pg = vec2(vW.x / ${S} + 960.0, vW.z / ${S} + 540.0);   // 地板 → 頁面座標
  // 深色木地板：一條條的木板（接縫、每條深淺不一、細細的木紋）
  float plank = floor(pg.y / 64.0);
  float h = hash11(plank * 7.3);
  float seam = 1.0 - smoothstep(0.0, 2.5, min(mod(pg.y, 64.0), 64.0 - mod(pg.y, 64.0)));
  float endSeam = 1.0 - smoothstep(0.0, 2.0, abs(mod(pg.x + h * 900.0, 700.0) - 350.0) - 348.0);
  float grain = 0.8 + 0.2 * snoise(vec2(pg.x * 0.004 + h * 10.0, pg.y * 0.12));
  vec3 col = mix(C_INK2, C_BLOOD * 0.35, 0.3) * (0.55 + 0.35 * h) * grain;
  col *= 1.0 - 0.6 * max(seam, endSeam);
  // 燈打在地上的一圈暖光（中間偏上），外面暗
  float pool = exp(-pow(length((pg - vec2(960.0, 520.0)) / vec2(980.0, 640.0)), 2.0));
  col *= 0.25 + 1.3 * pool * uOn;
  col += C_SIGNAL * 0.012 * pool * uOn;
  // 字的花瓣底下一層很淡的暖光（花瓣反射的光）：字全部落定後浮出來，花瓣排的字才讀得清楚
  vec4 G = fastLayer(texture(uGlow, vec2(pg.x / 1920.0, 1.0 - pg.y / 1080.0)));
  col += G.rgb * uGlowA;
  // 地上的光字（歌詞、名字）：燈打出來的光
  vec4 L = fastLayer(texture(uTxt, vec2(pg.x / 1920.0, 1.0 - pg.y / 1080.0)));
  col = col * (1.0 - 0.5 * L.a) + L.rgb * 0.95;
  fragColor = vec4(col, 1.0);
}`;

/** 共用的舞台：地板、花瓣的材質（shader 整晚只編一次）；花瓣的幾何每個窗格自己建。 */
class Stage {
  scene = new THREE.Scene();
  U = { uT: { value: 0 }, uFocus: { value: 160 }, uKick: { value: 0 }, uTxt: { value: null as THREE.Texture | null }, uGlow: { value: null as THREE.Texture | null }, uGlowA: { value: 0 }, uOn: { value: 1 } };
  petalMat: THREE.RawShaderMaterial;
  petals: THREE.Mesh;
  constructor() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(420, 260), rawMat(FLOOR_V, FLOOR_F, this.U));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 0);
    this.scene.add(floor);
    this.petalMat = rawMat(PETAL_V, PETAL_F, this.U, { transparent: false, alphaToCoverage: true, side: THREE.DoubleSide, depthWrite: true });
    this.petals = new THREE.Mesh(new THREE.InstancedBufferGeometry(), this.petalMat);
    this.petals.frustumCulled = false;
    this.scene.add(this.petals);
  }
}

/** 窗格結束後共用的花瓣網格換成這個空的（不留著已經釋放的幾何）。 */
const EMPTY = new THREE.InstancedBufferGeometry();

interface Petal { x: number; z: number; rot: number; size: number; land: number; fall: number; gust: number; kind: number; seed: [number, number, number, number]; word: [number, number] }

export default class Confetti extends Scene {
  stage = shared('confetti.stage', () => new Stage());
  cam = new THREE.PerspectiveCamera(36, W / H, 1, 1000);
  txt = this.track(new Layer2D(FLOOR_PG.w, FLOOR_PG.h, undefined, { fast: true }));
  /** 字底下的暖光（init 畫一次、半解析度、模糊）。 */
  glow = this.track(new Layer2D(FLOOR_PG.w, FLOOR_PG.h, 0.5, { fast: true }));
  sig: { text: string; x: number; y: number; size: number; family: string } | null = null;
  geo = new THREE.InstancedBufferGeometry();
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 157 + (this.msg?.id ?? 0) * 41) >>> 0;
  tOn = 0;
  hasLyr = false;
  lyrSize = 54;
  sigT = Infinity;
  gustAt = Infinity;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const lines = lyrics.linesIn(s - 1, e + 1);
    this.hasLyr = lines.length > 0;
    const sig = m ? sigOf(m) : '';
    await loadText(`${T23_TEXT}${m?.text ?? ''}${sig}${song.title}${lines.map((l) => l.text).join('')}`);
    const beat = au.beatPeriod(s);
    this.tOn = beatAfter(au, s + Math.min(0.15, beat * 0.3));
    const bar = au.timeOfBar(au.barAt(this.tOn) + 1) - this.tOn;
    const rnd = (i: number, k: number) => hash(this.seed, i, k);
    const P: Petal[] = [];
    const sd = (i: number): [number, number, number, number] => [rnd(i, 11), rnd(i, 12), rnd(i, 13), rnd(i, 14)];
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d', { willReadFrequently: true })!;
    /** 一個字（或一組字）的光柵 → 花瓣的落點。 */
    const sample = (draw: () => void, box: [number, number, number, number], st: number, add: (x: number, y: number) => void) => {
      c.clearRect(0, 0, W, H);
      c.fillStyle = '#fff'; c.textBaseline = 'alphabetic';
      draw();
      const [bx, by, bw, bh] = box.map(Math.round) as [number, number, number, number];
      if (bw <= 0 || bh <= 0) return;
      const img = c.getImageData(bx, by, bw, bh).data;
      for (let y = st / 2; y < bh; y += st) for (let x = st / 2; x < bw; x += st) {
        const jx = (hash(bx + x, by + y, 3) - 0.5) * st * 0.3, jy = (hash(bx + x, by + y, 4) - 0.5) * st * 0.3;
        const ix = Math.floor(clamp(x + jx, 0, bw - 1)), iy = Math.floor(clamp(y + jy, 0, bh - 1));
        if (img[(iy * bw + ix) * 4 + 3]! < 100) continue;
        add(bx + x + jx, by + y + jy);
      }
    };
    const toFloor = (x: number, y: number) => ({ x: (x - 960) * S, z: (y - 540) * S });
    const e2 = e;
    if (m) {
      const lay = layMsg(this.txt.ctx, m.text, sig, FAM_MSG, MSG_BOX, { min: 72, max: 190, lineHeight: 1.16, maxLines: 5, sigFamily: F.ming(700), sigSize: [44, 54], align: 'center', fewer: 0.95 });
      this.sig = { text: lay.sig.text, x: lay.sig.x, y: lay.sig.y, size: lay.sig.size, family: lay.sig.family };
      this.lyrSize = Math.max(48, Math.min(56, Math.round(lay.fit.size * 0.7)));
      const body = lay.glyphs.filter((g) => g.row >= 0);
      const gT = stagger(au, this.tOn, body.length, Math.min(1.5 * bar, Math.max(0.6, 0.4 * (e - this.tOn))));
      this.sigT = (gT[gT.length - 1] ?? this.tOn) + beat * 0.5;
      // 退場：窗格夠長，最後半拍一陣風從左邊把字吹散
      const gustAt = e2 - this.sigT > 3 ? e2 - Math.min(0.45, beat) : Infinity;
      this.gustAt = gustAt;
      const st = clamp(lay.fit.size / 13, 5.5, 13);
      // 字底下的暖光：整段字模糊一次畫在半解析度的圖層上
      const gc = this.glow.ctx;
      gc.filter = 'blur(10px)'; gc.fillStyle = rgba('signal', 0.5); gc.textBaseline = 'alphabetic'; gc.font = font(FAM_MSG, lay.fit.size);
      for (const ln of lay.lines) gc.fillText(ln.text, ln.x, ln.y);
      gc.filter = 'none';
      this.glow.upload();
      // 署名不排花瓣（字太小排不清楚）：地上一行清楚的光字
      body.forEach((g, gi) => {
        const fam = FAM_MSG;
        const stp = st;
        sample(() => {
          if (g.ch === '♥') drawHeart(c, g.x + g.w / 2, g.y - g.size * 0.36, Math.min(g.w, g.size * 0.8) * 0.92, '#fff');
          else { c.font = font(fam, g.size); c.fillText(g.ch, g.x, g.y); }
        }, [g.x - 4, g.y - g.size * 1.0, g.w + 8, g.size * 1.3], stp, (x, y) => {
          if (P.length >= CAP - NAMB) return;
          const i = P.length, f = toFloor(x, y);
          const land = gT[gi]! + (rnd(i, 1) - 0.5) * 0.08;
          P.push({ x: f.x, z: f.z, rot: rnd(i, 2) * TAU, size: stp * S * (1.6 + 0.3 * rnd(i, 3)), land, fall: 1.1 + 0.5 * rnd(i, 4), gust: gustAt + ((x - 200) / 1600) * 0.3, kind: g.ch === '♥' ? 2 : 0, seed: sd(i), word: [-1, -1] });
        });
      });
    } else if (this.hasLyr) {
      // 沒有留言：每一句歌詞各自排成花瓣（提早 1 秒開始飄、在句子開始時落定），唱完一陣風吹走
      lines.forEach((ln, li) => {
        const lay = layoutRows(this.txt.ctx, ln, { family: F.archivo(100, 800), size: 160, minSize: 96, maxW: SOLO_BOX.w, maxRows: 2, align: 'center', lineHeight: 1.06 });
        const x0 = SOLO_BOX.x + SOLO_BOX.w / 2, y0 = SOLO_BOX.y + SOLO_BOX.h / 2 - lay.height / 2 + lay.size * 0.78;
        const next = lines[li + 1];
        const gust = next ? Math.max(ln.end + 0.3, next.start - 1.2) : ln.end + 1.2;
        const st = clamp(lay.size / 11, 7, 14);
        for (const pw of lay.words) {
          sample(() => { c.font = font(F.archivo(100, 800), lay.size); c.fillText(pw.word.w, x0 + pw.x, y0 + pw.y); },
            [x0 + pw.x - 6, y0 + pw.y - lay.size, pw.w + 12, lay.size * 1.3], st, (x, y) => {
              if (P.length >= CAP - NAMB) return;
              const i = P.length, f = toFloor(x, y);
              const land = ln.start - 0.35 + ((x - SOLO_BOX.x) / SOLO_BOX.w) * 0.3 + (rnd(i, 1) - 0.5) * 0.1;
              P.push({ x: f.x, z: f.z, rot: rnd(i, 2) * TAU, size: st * S * (1.4 + 0.3 * rnd(i, 3)), land, fall: 1.0 + 0.4 * rnd(i, 4), gust: gust + ((x - 200) / 1600) * 0.35, kind: 0, seed: sd(i), word: [pw.word.start, pw.word.end] });
            });
        }
      });
    }
    // 零星的花瓣：窗格開始前就有一些落在地上，之後一直慢慢飄（大多落在字的外面）
    for (let k = 0; k < NAMB; k++) {
      const i = P.length;
      let x = rnd(i, 21) * 1920, y = rnd(i, 22) * 1080;
      if (x > MSG_BOX.x && x < MSG_BOX.x + MSG_BOX.w && y > MSG_BOX.y && y < MSG_BOX.y + MSG_BOX.h && rnd(i, 23) < 0.8) y = rnd(i, 24) < 0.5 ? rnd(i, 25) * 220 : 820 + rnd(i, 25) * 260;
      const f = toFloor(x, y);
      const land = s - 6 + rnd(i, 26) * (e - s + 8);
      P.push({ x: f.x, z: f.z, rot: rnd(i, 27) * TAU, size: 0.9 + 0.7 * rnd(i, 28), land, fall: 2.2 + 1.5 * rnd(i, 29), gust: Infinity, kind: 1, seed: sd(i), word: [-1, -1] });
    }
    this.buildGeo(P);
    this.avoid = [[MSG_BOX.x, MSG_BOX.y, MSG_BOX.w, MSG_BOX.h], [LYR.x, LYR.y - 60, LYR.w, 80]];
  }

  private buildGeo(P: Petal[]) {
    const g = this.geo;
    const base = new THREE.PlaneGeometry(1, 1);
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    g.setIndex(base.getIndex());
    const n = P.length;
    const tgt = new Float32Array(n * 4), tim = new Float32Array(n * 4), sd = new Float32Array(n * 4), wd = new Float32Array(n * 2);
    P.forEach((p, i) => {
      tgt.set([p.x, p.z, p.rot, p.size], i * 4);
      // Infinity 在 GPU 上不好用：吹走的時間沒有就放很大
      tim.set([p.land, p.fall, Number.isFinite(p.gust) ? p.gust : 1e6, p.kind], i * 4);
      sd.set(p.seed, i * 4);
      wd.set(p.word, i * 2);
    });
    g.setAttribute('aTgt', new THREE.InstancedBufferAttribute(tgt, 4));
    g.setAttribute('aTime', new THREE.InstancedBufferAttribute(tim, 4));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(sd, 4));
    g.setAttribute('aWord', new THREE.InstancedBufferAttribute(wd, 2));
    g.instanceCount = n;
    base.dispose();
  }

  /** 地上的光字：有留言時是歌詞（或純音樂的歌名）；沒有留言時是新人的名字與邀請。 */
  private drawFloorText(t: number) {
    const L = this.txt, c = L.ctx, { lyrics, song } = this.ctx;
    L.clear();
    if (this.msg) {
      if (this.sig && t >= this.sigT) {
        c.globalAlpha = prog(t, this.sigT, this.sigT + 0.4);
        c.font = font(this.sig.family, this.sig.size); c.fillStyle = rgba('bone', 0.85);
        c.fillText(this.sig.text, this.sig.x, this.sig.y);
        c.globalAlpha = 1;
      }
      const ly = this.hasLyr ? lyricAt(lyrics, t) : null;
      if (ly) {
        const lay = layoutRows(c, ly.line, { family: FAM_LYR, size: this.lyrSize, minSize: 48, maxW: LYR.w, maxRows: 1, align: 'left' });
        c.save(); c.translate(LYR.x, LYR.y); drawRows(c, lay, FAM_LYR, t, darkInk(), ly.k); c.restore();
      } else if (!this.hasLyr) {
        c.font = font(F.mono(500), 20); c.fillStyle = rgba('ash', 0.75); c.letterSpacing = '4px';
        c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`, LYR.x, LYR.y - 10);
        c.letterSpacing = '0px';
      }
    } else {
      c.font = font(F.ming(700), 34); c.fillStyle = rgba('bone', 0.8); c.letterSpacing = '4px';
      c.fillText(COUPLE_ZH, LYR.x, LYR.y - 24);
      c.font = font(F.hei(500), 20); c.fillStyle = rgba('ash', 0.75); c.letterSpacing = '3px';
      c.fillText(T23_INVITE, LYR.x, LYR.y + 16);
      c.letterSpacing = '0px';
      if (!this.hasLyr) {
        c.font = font(F.ming(900), 130); c.fillStyle = rgba('bone', 0.85); c.textAlign = 'center';
        c.fillText(COUPLE_ZH, 960, 580); c.textAlign = 'left';
      }
    }
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const st = this.stage, U = st.U;
    st.petals.geometry = this.geo;
    U.uT.value = t;
    U.uKick.value = f.a.kick;
    U.uOn.value = 0.6 + 0.4 * ease.outCubic(prog(t, s, this.tOn + 0.1));
    this.drawFloorText(t);
    U.uTxt.value = this.txt.texture;
    U.uGlow.value = this.glow.texture;
    // 風吹散字的時候，字底下的光也一起退掉
    U.uGlowA.value = this.msg ? 0.4 * prog(t, this.sigT - 0.3, this.sigT + 0.8) * (1 - prog(t, this.gustAt, this.gustAt + 0.3)) : 0;
    // 鏡頭：幾乎正上方往下看（稍微斜），切進來時高一點、第一拍落定，之後很慢地往下推
    const land = ease.outExpo(prog(t, s, Math.max(s + 0.3, this.tOn + 0.1)));
    const drift = ease.inOutQuad(clamp((t - s) / Math.max(1, e - s)));
    const cam = this.cam;
    const hgt = 158 + 22 * (1 - land) - 8 * drift;
    cam.position.set(0, hgt, hgt * 0.3);
    cam.lookAt(0, 0, -0.5);
    cam.updateMatrixWorld();
    U.uFocus.value = cam.position.length();
    // 全引擎共用的一張 MSAA：畫進去之後在這個 render() 裡就解析到 out
    const rt = sharedMSAA();
    clearRT(renderer, rt, [0, 0, 0]);
    renderer.setRenderTarget(rt);
    renderer.render(st.scene, cam);
    comp.draw(renderer, rt.texture, out, { mode: 'replace', premult: false });
    return { bloom: 0.8, bloomThreshold: 0.92, vignette: 0.6, halation: 0.3, popupAvoid: this.avoid };
  }

  override dispose() {
    if (this.stage.petals.geometry === this.geo) this.stage.petals.geometry = EMPTY;
    this.geo.dispose();
    super.dispose();
  }
}
