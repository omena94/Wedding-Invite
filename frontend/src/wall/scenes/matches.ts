// 火柴（暗）：一個暗房間的牆角。桌上躺著一盒婚禮小物的火柴（盒面印著 ALAN & OMENA 與日期），牆上有人用白漆寫了一句話——
// 可是房間太暗，只有火柴點著的時候讀得到。
//  - 開場一片黑，只看得到火柴盒的輪廓。第一個拍點：一根火柴自己沿著盒側的磷面「刷」地擦過去（定格動畫的手法，不畫手），
//    火星噴出來、火焰先爆亮一下再穩住，火柴一甩立起來；火光照亮的那一大片牆上就是主打留言（手寫、最大、最亮）。
//  - 火光是真的光源：牆是有凹凸的灰泥（烤一次的高度圖），火光從左下斜斜地打過去，凹凸跟字一起浮出來；
//    離火越遠越暗。火焰在 hi-hat 上晃、大鼓時亮一點。火柴一路燒下去（木頭變黑、燒紅的那一圈往下走）。
//  - 窗格長的話，火柴燒完（在拍點上熄掉、冒一縷煙、掉在桌上），黑一拍，下一個小節線再擦亮下一根。
//    桌上的火柴屍體越來越多（冷面幽默：一根火柴的時間，剛好讀完一句祝福）。
//  - 歌詞在留言下面，也是被火光照亮的（離火近、永遠讀得到）；正在唱的字是訊號色。
//  - 沒有留言：歌詞放大寫在牆上當主角，牆下方淡淡的一行邀請。
// 畫法：牆（灰泥高度圖、火光）與寫在牆上的字在一個 shader 裡算（字是 init 畫一次的圖層，照光）；
// 火柴盒是 init 畫好的離屏畫布，火柴、桌上的火柴屍體、歌詞每格畫在一張 fast 圖層上；火焰與煙是疊加的 shader；
// 火星用 LineBatch。鏡頭整個窗格很慢地推近。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, makeRT } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, noise1, lerp, pulse, frameIdx } from '../engine/util';
import { sparkParticles, sparkHead, lyricAt, drawLyric, layoutLyric, beatAfter, COUPLE_EN, DATE_DOTS, type LyricStyle } from './_motifs';
import { preloadText, INVITE_SMALL, type MsgBlock } from './_t19';
import { makeCanvas, freeCanvas, barsIn, beatsIn } from './_t1';
import { lyricV2, V2 } from './_v2';
import { placeBlock, drawBlock, sigOf, fitV2, T22_TEXT, type DrawnBlock, type Rect, type P2 } from './_t22';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'keepsake', paper: false, energy: [0, 0.7], bars: [4, 12], weight: 1 };

/** 牆與桌面的交界（螢幕 y）。 */
const LEDGE = 925;
/** 留言寫在牆上的範圍（右上三分之二；火在左下）。 */
const MSG = { x: 860, y: 190, w: 820, h: 390 };
/** 歌詞：留言下面，左對齊留言；最寬到 x = 1340（右下角 QR 區的左邊）。 */
const LYR = { x: 860, y: 712, maxW: 820 };
/** 火柴拿起來之後，火柴頭的位置。 */
const HOLD = { x: 413, y: 540 };
/** 火柴：長度、粗細。 */
const STICK = 214, THICK = 11;
/** 擦火柴的磷面（盒側）：起點、終點的 y、x。 */
const STRIKE = { y: 927, x0: 178, x1: 520 };
/** 火柴盒離屏畫布的左上角（道具座標）。 */
const BOXO = { x: 120, y: 770 };
/**
 * 留言標準 v2：留言寫小一點（40～60 px、右側 ≤ 820×390），道具放大當主角——火柴盒、火柴、桌上的火柴屍體
 * 都畫在「道具座標」（原本的螢幕座標），以畫面左下 PIV 為支點放大 PS 倍到螢幕上。
 */
const PS = 1.5, PIV = { x: 120, y: 1000 };
const SX = (x: number) => PIV.x + (x - PIV.x) * PS;
const SY = (y: number) => PIV.y + (y - PIV.y) * PS;
const FOOT = '＊一根火柴的時間，剛好讀完一句祝福。';

// ---------------------------------------------------------------- 灰泥牆的高度圖（整晚共用、只烤一次）
const PLASTER = () => ({ rt: makeRT(960, 540, { pxScale: 1, type: THREE.UnsignedByteType, depthBuffer: false }), done: false });
const BAKE = /* glsl */ `
void main() {
  vec2 p = vUv * vec2(${W}.0, ${H}.0);
  float h = 0.5 + 0.3 * fbm(p / 240.0, 4) + 0.1 * snoise(p / 38.0) + 0.05 * snoise(p / 11.0);
  // 抹刀的痕跡：斜斜的長條
  h += 0.06 * snoise(vec2(p.x * 0.004 + p.y * 0.002, p.y * 0.018 - p.x * 0.006));
  float g = 0.5 + 0.5 * fbm(p / 700.0 + 7.0, 3);
  fragColor = vec4(sat(h), sat(g), 0.5 + 0.5 * snoise(p / 3.0), 1.0);
}`;
function plaster(renderer: THREE.WebGLRenderer): THREE.Texture {
  const p = shared('matches.plaster', PLASTER);
  if (!p.done) {
    const fs = new FSPass(BAKE);
    fs.render(renderer, p.rt);
    renderer.setRenderTarget(null);
    fs.dispose();
    p.done = true;
  }
  return p.rt.texture;
}

/** 火光的顏色（主題的訊號色一家子，混一點紙白的暖：鼠尾草、薰衣草主題的火光才不會綠、紫得像鬼火）。 */
const LIGHT_GLSL = /* glsl */ `
vec3 fireCol() { return mix(mix(C_SIGNAL, C_EMBER, 0.5), C_BONE, 0.38); }
// 火光落在距離 r（螢幕 px）的地方有多亮：近的一團＋遠的一大片（好看比平方反比重要）
float fall(float r) { return 0.62 / (1.0 + r * r / (240.0 * 240.0)) + 0.38 / (1.0 + r * r / (640.0 * 640.0)); }
// 寫在牆上的字：白漆反光比灰泥強很多，離火遠一點也還讀得到（整句都要讀得完）
float fallPaint(float r) { return 0.35 + 0.65 / (1.0 + r * r / (1100.0 * 1100.0)); }`;

// ---------------------------------------------------------------- 牆＋牆上的字＋桌面
const WALL = () => new FSPass(/* glsl */ `
  uniform sampler2D bake; uniform sampler2D msg; uniform vec3 L; uniform float amb;
  ${LIGHT_GLSL}
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 fc = fireCol();
    vec4 bk = textureLod(bake, vUv, 0.0);
    vec3 col;
    float r = length(L.xy - p);
    if (p.y < ${LEDGE}.0) {
      // 灰泥：高度圖的斜率當法向量，火光是牆前面 D px 的點光源（斜斜地打過去，凹凸才看得出來）
      vec2 e = vec2(1.0 / 960.0, 1.0 / 540.0);
      float hx = textureLod(bake, vUv + vec2(e.x, 0.0), 0.0).r - textureLod(bake, vUv - vec2(e.x, 0.0), 0.0).r;
      float hy = textureLod(bake, vUv + vec2(0.0, e.y), 0.0).r - textureLod(bake, vUv - vec2(0.0, e.y), 0.0).r;
      vec3 n = normalize(vec3(-hx * 3.2, hy * 3.2, 1.0));
      vec3 toL = normalize(vec3(L.xy - p, 240.0));
      float dif = max(dot(n, toL), 0.0);
      vec3 alb = mix(C_INK2, mix(C_GRAPHITE, C_ASH, 0.4), 0.2 + 0.06 * bk.g) * (0.9 + 0.2 * bk.r);
      float lit = L.z * fall(r);
      col = alb * (amb * (0.8 + 0.4 * bk.g) + fc * lit * (0.2 + 1.1 * dif) * 1.1);
      // 牆腳：靠近桌面暗一點（角落的遮蔽）
      col *= 0.72 + 0.28 * smoothstep(${LEDGE}.0, ${LEDGE - 140}.0, p.y);
      // 寫在牆上的字：白漆吃進灰泥（凹的地方淡一點），照同一盞火光；完全暗的時候還留一點點（像夜光漆），不會整句消失
      vec4 m = fastLayer(textureLod(msg, vUv, 0.0));
      if (m.a > 0.0) {
        float ml = 0.022 + 0.98 * min(L.z * fallPaint(r) * (0.9 + 0.2 * dif), 1.1);
        vec3 paint = m.rgb * ml * mix(vec3(1.0), fc * 1.15, 0.22) * (0.9 + 0.16 * bk.r);
        col = col * (1.0 - m.a) + paint;
      }
    } else {
      // 桌面：往鏡頭這邊是近的，木紋橫向、越近越疏；火光在桌上拉長
      float z = (p.y - ${LEDGE}.0) / ${H - LEDGE}.0;
      float v = 1.0 / (0.12 + z);
      float g = fbm(vec2(p.x / 520.0, v * 1.6), 3);
      float grain = 0.5 + 0.5 * sin(v * 26.0 + g * 7.0 + p.x * 0.004);
      vec3 alb = mix(C_INK2, mix(C_GRAPHITE, C_SEPIA, 0.35), 0.3 + 0.12 * grain + 0.1 * g);
      float rr = length((L.xy - p) * vec2(0.85, 1.9));
      float lit = L.z * fall(rr);
      col = alb * (amb * 0.9 + fc * lit * 0.95);
      // 桌子遠端的邊：一條很細的亮線（木頭邊緣接到光）
      col += fc * L.z * fall(r) * 0.12 * exp(-(p.y - ${LEDGE}.0) / 2.0);
    }
    fragColor = vec4(col, 1.0);
  }`, { bake: { value: null }, msg: { value: null }, L: { value: new THREE.Vector3(-9999, -9999, 0) }, amb: { value: 0.03 } });

// ---------------------------------------------------------------- 火焰與煙（疊加）
const FLAME = () => new FSPass(/* glsl */ `
  uniform vec2 fp; uniform vec4 fs; uniform vec4 sm; uniform vec4 sm2; uniform float t;
  ${LIGHT_GLSL}
  // 一縷煙：從 s.xy 往上升，左右飄、越高越寬越淡；s.z = 升了多久（決定多高）、s.w = 濃度
  float smokeAt(vec2 p, vec4 s) {
    if (s.w <= 0.002) return 0.0;
    float v = s.y - p.y;
    if (v < -6.0 || v > 720.0) return 0.0;
    float cx = s.x + 26.0 * sin(v * 0.012 - t * 1.7) * sat(v / 180.0) + 42.0 * snoise(vec2(v * 0.003, t * 0.25 + s.x * 0.01)) * sat(v / 320.0);
    float wd = 3.0 + v * 0.055;
    float d = exp(-pow((p.x - cx) / wd, 2.0));
    d *= sat((s.z * 170.0 - v) / 140.0) * (1.0 - sat(v / 700.0));
    d *= 0.55 + 0.45 * snoise(vec2(p.x * 0.018, v * 0.012 - t * 0.9));
    return max(d, 0.0) * s.w;
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 col = vec3(0.0);
    // 火焰：淚滴形，底部圓、往上尖，被噪聲扭動；外焰是訊號色、內焰白熱（會發光）
    vec2 q0 = p - fp;
    if (fs.z > 0.002 && dot(q0, q0) < fs.x * fs.x * 9.0) {
      vec2 q = rot2(fs.w) * q0;
      float u = -q.y / fs.x;                     // 0 = 火焰底、1 = 尖
      float wig = snoise(vec2(u * 2.2 - t * 6.5, t * 1.3)) * 0.16 * u * u + 0.05 * u * snoise(vec2(t * 11.0, 3.0));
      float x = q.x / fs.x - wig;
      float prof = sqrt(sat((u + 0.16) / 0.34)) * pow(sat(1.0 - u), 0.72) * fs.y;
      float body = prof > 0.0 ? 1.0 - smoothstep(0.55, 1.0, abs(x) / max(prof, 1e-4)) : 0.0;
      float core = prof > 0.0 ? (1.0 - smoothstep(0.0, 0.55, abs(x) / max(prof * 0.55, 1e-4))) * (1.0 - smoothstep(0.25, 0.65, u)) : 0.0;
      float base = smoothstep(-0.14, 0.18, u);   // 火焰根部比較透明
      // 火焰混一點紙白的暖（跟 fireCol 一樣）：鼠尾草、薰衣草主題的火才不會綠得、紫得像鬼火
      vec3 outer = mix(mix(C_BLOOD, C_SIGNAL, 0.35 + 0.65 * sat(1.0 - u)), C_BONE * 0.8, 0.3) * 2.2;
      vec3 hot = mix(C_EMBER, vec3(1.0), 0.55) * 4.2;
      col += (outer * body * (0.55 + 0.45 * base) + hot * core * base) * fs.z;
    }
    // 光暈（bloom 之外再一點，讓火焰周圍的空氣是暖的）：放在上面的範圍判斷外面，才不會切出一個圓圈的邊
    if (fs.z > 0.002) {
      float r = length(q0 + vec2(0.0, fs.x * 0.4));
      col += fireCol() * 0.22 * exp(-r / (fs.x * 0.9)) * fs.z;
    }
    // 煙：熄掉的地方升起一縷；燒著的時候火焰上方也有一縷很淡的
    col += C_BONE * 0.07 * (smokeAt(p, sm) + smokeAt(p, sm2));
    fragColor = vec4(col, 1.0);
  }`, { fp: { value: new THREE.Vector2() }, fs: { value: new THREE.Vector4() }, sm: { value: new THREE.Vector4() }, sm2: { value: new THREE.Vector4() }, t: { value: 0 } },
{ blending: THREE.AdditiveBlending, transparent: true });

/** 一根火柴的時間表。 */
interface Match { ts: number; te: number; life: number }
/** 火柴的姿勢：頭的位置、火柴棒的方向（頭 → 尾的角度）、看得到多少。 */
interface Pose { x: number; y: number; a: number; alpha: number }

type Ctx2 = CanvasRenderingContext2D;

export default class Matches extends Scene {
  wall = shared('matches.wall', WALL);
  flame = shared('matches.flame', FLAME);
  /** 牆上的字（init 畫一次，給牆的 shader 照光）。 */
  paint = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 火柴、火柴盒、歌詞（每格畫）。 */
  dyn = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = (this.ctx.params.seed ?? 1) >>> 0;
  box: ReturnType<typeof makeCanvas> | null = null;
  matches: Match[] = [];
  B = 0.5;
  blk: MsgBlock | null = null;
  pl: DrawnBlock | null = null;
  lyr: LyricStyle = { family: F.archivo(100, 700), size: 48, minSize: V2.lyrMin, maxWidth: LYR.maxW };
  /** 沒有留言：歌詞寫在牆上當主角（v2：一樣不超過 52）。 */
  soloLyr: LyricStyle = { family: F.archivo(100, 800), size: V2.lyrMax, minSize: V2.lyrMin, maxWidth: MSG.w, lineHeight: 1.16 };
  /** 拍點（火星往上飄）與小節線（火焰竄高一下）。 */
  beats: number[] = [];
  barT: number[] = [];
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, start: s, end: e } = this.ctx;
    const m = this.msg;
    await preloadText(this.ctx, `${m ? m.text + sigOf(m) : ''}${T22_TEXT}${INVITE_SMALL}${FOOT}FROM THE COUPLE · 新人${COUPLE_EN}SAFETY MATCHES`);
    this.B = au.beatPeriod(s + 0.1);

    // ---- 時間：第一拍擦亮第一根；之後大約每四小節（6～11 秒）在小節線擦一根新的，最後一根燒到窗格結束
    const t0 = beatAfter(au, s + Math.min(0.45, this.B * 0.9));
    const bars = barsIn(au, t0 + 0.1, e);
    const barLen = bars.length > 1 ? bars[1]! - bars[0]! : this.B * 4;
    const life = clamp(4 * barLen, 6, 11);
    const ts = [t0];
    for (const b of bars) if (b - ts[ts.length - 1]! >= life * 0.92 && e - b >= Math.max(3.5, life * 0.55) && ts.length < 4) ts.push(b);
    this.matches = ts.map((x, i) => ({ ts: x, te: i < ts.length - 1 ? ts[i + 1]! - Math.max(0.3, this.B * 0.75) : Infinity, life: i < ts.length - 1 ? ts[i + 1]! - x : Math.max(life, e - x + 1) }));
    this.beats = beatsIn(au, t0 + 0.4, e);
    this.barT = barsIn(au, t0 + 0.6, e);

    // ---- 牆上的字
    const c = this.paint.ctx;
    this.paint.clear();
    if (m) {
      const fam = F.hand(700);
      this.blk = fitV2(c, m.text, fam, MSG.w, MSG.h, 1, { lineHeight: 1.3 });
      const top = MSG.y + Math.max(0, (MSG.h - this.blk.height) * 0.45);
      const sig = sigOf(m);
      this.pl = placeBlock(c, this.blk, fam, sig, MSG.x, top);
      drawBlock(c, this.blk, this.pl, fam, sig, { color: rgba('bone', 0.97), sigColor: rgba('bone', 0.78) });
      if (m.couple) {
        c.font = font(F.mono(500), 18); c.letterSpacing = '4px'; c.fillStyle = rgba('signal', 0.9);
        c.fillText('FROM THE COUPLE · 新人', MSG.x, top - 26);
        c.letterSpacing = '0px';
      }
      this.lyr = { ...this.lyr, size: lyricV2(this.blk.fit.size) };
      this.avoid = [this.pl.rect, [LYR.x - 10, LYR.y - 64, LYR.maxW + 20, 130]];
    } else {
      // 沒有留言：牆下方淡淡的一行邀請（歌詞在上面當主角）
      c.font = font(F.hand(700), 32); c.fillStyle = rgba('bone', 0.62);
      c.fillText(INVITE_SMALL, MSG.x, 600);
      this.avoid = [[MSG.x - 10, MSG.y, MSG.w + 20, 660]];
    }
    this.paint.upload();
    this.buildBox();
  }

  override dispose() { freeCanvas(this.box); super.dispose(); }

  /** 火柴盒（離屏畫布，畫一次）：盒面（ALAN & OMENA）、盒側的磷面、拉出來的內盒裡一排火柴頭。 */
  private buildBox() {
    const b = (this.box = makeCanvas(560, 220, 2));
    const c = b.c;
    // 畫布左上角對應螢幕 (BOXO.x, BOXO.y)：底下直接用螢幕座標畫
    c.translate(-BOXO.x, -BOXO.y);
    // 桌上的影子（火在右上，影子往左下拖一點）
    c.save();
    c.filter = 'blur(9px)';
    c.fillStyle = rgba('ink', 0.85);
    c.beginPath(); c.moveTo(140, 952); c.lineTo(640, 952); c.lineTo(626, 972); c.lineTo(128, 975); c.closePath(); c.fill();
    c.restore();
    const poly = (pts: number[][], fill: string) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x!, y!) : c.moveTo(x!, y!))); c.closePath(); c.fillStyle = fill; c.fill(); };
    // 內盒（拉出來的那一段）：先畫，外盒的右端會蓋住它的根部
    poly([[512, 803], [606, 803], [632, 906], [536, 906]], mixRgba('bone', 'sepia', 0.55));
    poly([[520, 810], [600, 810], [622, 898], [542, 898]], mixRgba('sepia', 'ink', 0.35));
    // 一排火柴頭（紅磷的頭：訊號色的暗部）
    for (let i = 0; i < 9; i++) {
      const y = 818 + i * 9.6, x = 574 + (y - 810) * 0.27;
      c.fillStyle = mixRgba('bone', 'sepia', 0.45);
      c.fillRect(x - 70, y - 2.5, 72, 5);
      c.fillStyle = mixRgba('blood', 'ink', 0.2);
      c.beginPath(); c.ellipse(x + 6, y, 9, 5.5, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = mixRgba('blood', 'bone', 0.25);
      c.beginPath(); c.ellipse(x + 4, y - 1.6, 3.5, 1.6, 0, 0, Math.PI * 2); c.fill();
    }
    poly([[536, 906], [632, 906], [632, 946], [536, 946]], mixRgba('bone', 'sepia', 0.62));
    // 外盒：盒面（紙白偏暖）與盒側
    poly([[176, 800], [516, 800], [540, 906], [150, 906]], mixRgba('bone', 'paper', 0.5));
    poly([[150, 906], [540, 906], [540, 950], [150, 950]], mixRgba('paper', 'sepia', 0.35));
    // 盒側的磷面：暗紅褐色、細顆粒、擦過的刮痕
    poly([[160, 913], [530, 913], [530, 942], [160, 942]], mixRgba('blood', 'ink', 0.55));
    for (let i = 0; i < 700; i++) {
      const x = 160 + hash(i, 1) * 370, y = 913 + hash(i, 2) * 29;
      c.fillStyle = hash(i, 3) > 0.5 ? rgba('ink', 0.5) : mixRgba('blood', 'bone', 0.3, 0.35);
      c.fillRect(x, y, 1.4, 1.4);
    }
    c.strokeStyle = mixRgba('blood', 'bone', 0.4, 0.35); c.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) { const y = 919 + hash(i, 9) * 18; c.beginPath(); c.moveTo(175 + hash(i, 7) * 60, y); c.lineTo(420 + hash(i, 8) * 100, y + (hash(i, 6) - 0.5) * 6); c.stroke(); }
    // 盒面的印刷：細框、ALAN & OMENA、日期、一行小字（婚禮小物的火柴盒）
    c.save();
    c.beginPath(); c.moveTo(176, 800); c.lineTo(516, 800); c.lineTo(540, 906); c.lineTo(150, 906); c.closePath(); c.clip();
    c.strokeStyle = rgba('sepia', 0.55); c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(192, 811); c.lineTo(500, 811); c.lineTo(520, 895); c.lineTo(170, 895); c.closePath(); c.stroke();
    c.fillStyle = rgba('sepia', 0.85); c.textAlign = 'center';
    c.save(); c.translate(345, 858); c.scale(1, 0.82);
    c.font = font(F.serif(600), 30); c.fillText(COUPLE_EN.toUpperCase(), 0, 0);
    c.font = font(F.mono(500), 13); c.letterSpacing = '4px'; c.fillText(DATE_DOTS, 0, 28);
    c.font = font(F.mono(500), 10); c.letterSpacing = '3px'; c.fillText('SAFETY MATCHES · 祝福專用', 0, -36);
    c.letterSpacing = '0px';
    c.restore();
    c.restore();
    // 外盒右端蓋住內盒的根部：一條暗縫
    c.strokeStyle = rgba('ink', 0.55); c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(516, 800); c.lineTo(540, 906); c.lineTo(540, 950); c.stroke();
  }

  // ---------------------------------------------------------------- 火柴的動作
  /** 第 i 根火柴在 t 的姿勢（null = 還沒出場）。 */
  private pose(i: number, t: number): Pose | null {
    const mt = this.matches[i]!, ts = mt.ts;
    const tail0 = -1.95; // 擦的時候火柴棒往左上斜（像被人捏著尾巴）
    const up = Math.PI / 2 + 0.1 - Math.PI * 2; // 立起來：頭在上、棒子往下（往左一點）
    if (t < ts - 0.5) return null;
    if (t < ts) {
      // 出場：從盒子右邊浮起來、退到磷面的起點（很暗，只看得到剪影）
      const k = prog(t, ts - 0.5, ts - 0.04, ease.inOutCubic);
      return { x: lerp(560, STRIKE.x0, k), y: lerp(870, STRIKE.y, k) - 30 * Math.sin(Math.PI * k), a: lerp(-2.6, tail0, k), alpha: clamp((t - ts + 0.5) / 0.15) };
    }
    if (t < ts + 0.13) {
      const k = ease.outCubic((t - ts) / 0.13);
      return { x: lerp(STRIKE.x0, STRIKE.x1, k), y: STRIKE.y + 2 * Math.sin(k * 30), a: tail0, alpha: 1 };
    }
    const hold = this.holdPose(i, t);
    if (t < ts + 0.5) {
      // 一甩：從磷面的終點轉成直立（有一點過頭再回來）
      const k = ease.outBack(clamp((t - ts - 0.13) / 0.37), 1.4);
      return { x: lerp(STRIKE.x1, hold.x, k), y: lerp(STRIKE.y, hold.y, k), a: lerp(tail0, hold.a, k), alpha: 1 };
    }
    if (t < mt.te) return hold;
    // 熄了：掉到桌上（拋物線、轉成橫躺），之後躺著
    const lie = this.liePose(i);
    const h0 = this.holdPose(i, mt.te);
    const k = clamp((t - mt.te) / 0.42);
    const kk = ease.inQuad(k);
    return { x: lerp(h0.x, lie.x, k), y: lerp(h0.y, lie.y, kk) - 40 * Math.sin(Math.PI * k) * (1 - k), a: lerp(h0.a, lie.a, ease.outCubic(k)), alpha: 1 };
  }
  private holdPose(i: number, t: number): Pose {
    const mt = this.matches[i]!;
    const u = t - mt.ts;
    // 拿著的手會微微晃；越燒越往右斜一點（讓火往上爬）
    const burn = clamp(u / mt.life);
    return {
      x: HOLD.x + 7 * noise1(u * 0.9, 3 + i) + 10 * burn,
      y: HOLD.y + 5 * noise1(u * 0.7, 7 + i),
      a: Math.PI / 2 + 0.1 - Math.PI * 2 - 0.34 * ease.inOutQuad(burn) + 0.03 * noise1(u * 1.3, 11 + i),
      alpha: 1,
    };
  }
  /** 掉在桌上的位置（盒子右邊，一根一根疊過去）。 */
  private liePose(i: number): Pose {
    // 都往右躺（放大之後往左躺會蓋到火柴盒、往右太遠會進到右下角 QR 的底下）
    return { x: 468 + 40 * i + 10 * hash(this.seed, i), y: 990 - 5 * hash(this.seed, i, 2), a: -0.14 + 0.28 * hash(this.seed, i, 3), alpha: 1 };
  }
  /** 第 i 根燒到哪裡（0..1，燒黑的長度比例）。 */
  private burnOf(i: number, t: number) {
    const mt = this.matches[i]!;
    const tt = Math.min(t, mt.te);
    return 0.72 * clamp((tt - mt.ts - 0.35) / mt.life) + (tt > mt.ts + 0.1 ? 0.04 : 0);
  }
  /** 第 i 根的火：高度倍率與亮度（0 = 沒火）。擦亮時先爆亮一下再穩住，熄之前縮小、閃兩下。 */
  private fire(i: number, t: number): { h: number; I: number } {
    const mt = this.matches[i]!, u = t - mt.ts;
    if (u < 0.07 || t >= mt.te) return { h: 0, I: 0 };
    let I = clamp((u - 0.07) / 0.05) * (1 + 0.75 * Math.exp(-(u - 0.12) / 0.16));
    let h = clamp((u - 0.07) / 0.08) * (1 + 0.5 * Math.exp(-(u - 0.12) / 0.2));
    const d = mt.te - t;
    if (d < 0.8) { const k = d / 0.8; I *= k ** 0.8 * (0.8 + 0.2 * Math.sin(t * 40)); h *= 0.35 + 0.65 * k; }
    return { h, I };
  }

  // ---------------------------------------------------------------- 畫一根火柴
  private drawStick(c: Ctx2, p: Pose, burn: number, lit: boolean, tone: number) {
    c.save();
    c.globalAlpha = p.alpha;
    c.translate(p.x, p.y); c.rotate(p.a);
    const bl = burn * STICK;
    // 木頭（淺色的白楊木：亮面、暗面兩條，看起來是圓的）
    const w0 = Math.max(10, bl);
    c.fillStyle = mixRgba('bone', 'ash', 0.5 + 0.3 * (1 - tone));
    c.fillRect(w0, -THICK / 2, STICK - w0, THICK);
    c.fillStyle = mixRgba('ash', 'sepia', 0.45, 0.55);
    c.fillRect(w0, 1, STICK - w0, THICK / 2 - 1);
    c.fillStyle = rgba('bone', 0.5);
    c.fillRect(w0, -THICK / 2 + 1.5, STICK - w0, 2);
    // 燒黑的一段：比較細、有一點彎，上緣一點灰白的炭光
    if (bl > 8) {
      c.fillStyle = mixRgba('ink', 'graphite', 0.45);
      c.beginPath();
      c.moveTo(8, -THICK * 0.38);
      c.quadraticCurveTo(bl * 0.5, -THICK * 0.3 + 2, bl, -THICK / 2);
      c.lineTo(bl, THICK / 2);
      c.quadraticCurveTo(bl * 0.5, THICK * 0.3 + 2, 8, THICK * 0.38);
      c.closePath(); c.fill();
      c.fillStyle = rgba('graphite', 0.8);
      c.fillRect(10, -THICK * 0.3, bl - 10, 1.6);
    }
    // 火柴頭：沒點過是紅磷（訊號色的暗部），點過是焦黑的一顆
    c.fillStyle = lit ? mixRgba('ink', 'graphite', 0.5) : mixRgba('blood', 'ink', 0.15);
    c.beginPath(); c.ellipse(2, 0, 16, 10, 0, 0, Math.PI * 2); c.fill();
    if (!lit) { c.fillStyle = mixRgba('blood', 'bone', 0.3, 0.8); c.beginPath(); c.ellipse(-1, -3.5, 6, 2.4, 0, 0, Math.PI * 2); c.fill(); }
    c.restore();
  }

  /** 火在 tb 時的位置（螢幕座標）與亮度（沒有火是 null）：火星從這裡出發。 */
  private flameAt(tb: number): { x: number; y: number; I: number } | null {
    let cur = -1;
    for (let i = 0; i < this.matches.length; i++) if (tb >= this.matches[i]!.ts - 0.5) cur = i;
    if (cur < 0) return null;
    const fi = this.fire(cur, tb);
    if (fi.I <= 0.05) return null;
    const p = this.pose(cur, tb)!;
    return { x: SX(p.x - Math.cos(p.a) * 10), y: SY(p.y - Math.sin(p.a) * 10 - 6) - 37 * PS * fi.h, I: fi.I };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, song } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;

    // ---- 現在是哪一根在燒、火在哪裡（道具座標算姿勢，換成螢幕座標給光與火焰）
    let cur = -1;
    for (let i = 0; i < this.matches.length; i++) if (t >= this.matches[i]!.ts - 0.5) cur = i;
    let I = 0, flameH = 0, fx = -9999, fy = -9999, lean = 0;
    let smoke: [number, number, number, number] = [0, 0, 0, 0];
    let wisp: [number, number, number, number] = [0, 0, 0, 0];
    const hats = this.ctx.audio.events('hat', t - 0.8, t + 1e-4);
    // 小節線：像有一陣風從門縫進來，火焰竄高、亮一下（每個小節一個小事件）
    let flare = 0;
    for (const b of this.barT) flare += pulse(t, b, 0.18) * clamp((t - b) / 0.04);
    if (cur >= 0) {
      const fi = this.fire(cur, t);
      const p = this.pose(cur, t)!;
      // 火焰的根在火柴頭上（頭 → 尾的反方向），火焰本身永遠往上（再被 hi-hat 吹歪一點）
      fx = SX(p.x - Math.cos(p.a) * 10); fy = SY(p.y - Math.sin(p.a) * 10 - 6);
      const flick = 1 + 0.07 * noise1(t * 9.3, 5) + 0.05 * noise1(t * 23, 9);
      I = fi.I * flick * (1 + 0.1 * f.a.kick) * (1 + 0.35 * flare);
      flameH = 74 * PS * fi.h * (1 + 0.06 * noise1(t * 7, 2)) * (1 + 0.08 * f.a.kick) * (1 + 0.3 * flare);
      for (const [et, st] of hats) {
        const a = t - et;
        lean += (hash(Math.round(et * 1000), 3) < 0.5 ? -1 : 1) * st * 0.22 * Math.exp(-a * 5) * Math.sin(a * 16);
      }
      lean += 0.06 * noise1(t * 1.7, 4) + 0.12 * flare * Math.sin(t * 9);
      // 燒著的時候火焰上方一直有一縷很淡的煙
      if (fi.I > 0.05) wisp = [fx, fy - flameH * 0.9, 3.2, 0.3 * clamp(fi.I)];
    }
    // 煙：最近熄掉的那一根
    for (let i = 0; i < this.matches.length; i++) {
      const mt = this.matches[i]!;
      if (t >= mt.te && t < mt.te + 3.2) {
        const h0 = this.holdPose(i, mt.te);
        smoke = [SX(h0.x - Math.cos(h0.a) * 12), SY(h0.y - Math.sin(h0.a) * 12 - 8), t - mt.te, 1 - clamp((t - mt.te - 1.6) / 1.6)];
      }
    }
    const lx = fx, ly = fy - flameH * 0.45;
    const amb = 0.026 + 0.01 * prog(t, s, s + 0.6);

    // ---- 牆（照光的字也在裡面）
    const Wp = this.wall;
    Wp.u.bake!.value = plaster(renderer);
    Wp.u.msg!.value = this.paint.texture;
    (Wp.u.L!.value as THREE.Vector3).set(lx, ly, I);
    Wp.u.amb!.value = amb;
    Wp.render(renderer, out);

    // ---- 火柴盒、火柴（道具座標，放大到螢幕上）、歌詞
    const D = this.dyn, c = D.ctx;
    D.clear();
    const lightAt = (x: number, y: number) => {
      const r = Math.hypot(x - lx, y - ly);
      return amb * 4 + I * (0.55 / (1 + (r * r) / 90000) + 0.45 / (1 + (r * r) / 810000));
    };
    c.save();
    c.translate(PIV.x * (1 - PS), PIV.y * (1 - PS));
    c.scale(PS, PS);
    // 桌上的火柴屍體
    for (let i = 0; i < this.matches.length; i++) {
      const mt = this.matches[i]!;
      if (t >= mt.te + 0.42) this.drawStick(c, this.liePose(i), this.burnOf(i, mt.te), true, 0.4);
    }
    const bx = this.box!;
    c.drawImage(bx.cv, BOXO.x, BOXO.y, bx.w, bx.h);
    // 空中的那根（掉下來的過程也在這裡畫）
    for (let i = 0; i < this.matches.length; i++) {
      const mt = this.matches[i]!;
      if (t < mt.ts - 0.5 || t >= mt.te + 0.42) continue;
      const p = this.pose(i, t);
      if (p) this.drawStick(c, p, this.burnOf(i, t), t > mt.ts + 0.1, 0.8);
    }
    c.restore();
    // 照光：離火越遠越暗（只蓋在已經畫的道具上）
    c.save();
    c.globalCompositeOperation = 'source-atop';
    const g = c.createRadialGradient(lx, ly, 0, lx, ly, 1500);
    for (const r of [0, 150, 320, 520, 780, 1100, 1500]) g.addColorStop(r / 1500, rgba('ink', clamp(1 - lightAt(lx + r, ly) * 1.05, 0.08, 0.96)));
    c.fillStyle = g;
    c.fillRect(0, 150, 1400, 930);
    const g2 = c.createRadialGradient(lx, ly, 0, lx, ly, 800);
    g2.addColorStop(0, rgba('signal', 0.18 * clamp(I))); g2.addColorStop(1, rgba('signal', 0));
    c.fillStyle = g2;
    c.fillRect(0, 150, 1400, 930);
    c.restore();

    // 歌詞（火光照得到，但就算火熄了也還讀得到：最暗不低於六成）
    const kL = (x: number, y: number) => clamp(0.6 + 0.5 * lightAt(x, y), 0.6, 1);
    const ly1 = lyricAt(lyrics, t);
    if (ly1) {
      if (this.msg) {
        const k = kL(LYR.x + 200, LYR.y);
        const st: LyricStyle = { ...this.lyr, active: mixRgba('ink', 'signal', k), sung: mixRgba('ink', 'bone', k * 0.96), unsung: mixRgba('ink', 'bone', k * 0.3) };
        const lay = layoutLyric(c, ly1.line, st);
        c.save(); c.translate(LYR.x, LYR.y - (lay.rows.length - 1) * lay.size * 0.5);
        drawLyric(c, ly1.line, t, st, lay, ly1.k);
        c.restore();
      } else {
        const k = kL(MSG.x + 300, 400);
        const st: LyricStyle = { ...this.soloLyr, active: mixRgba('ink', 'signal', k), sung: mixRgba('ink', 'bone', k * 0.96), unsung: mixRgba('ink', 'bone', k * 0.3) };
        const lay = layoutLyric(c, ly1.line, st);
        c.save(); c.translate(MSG.x, 420 - (lay.rows.length - 1) * lay.size * 0.58);
        drawLyric(c, ly1.line, t, st, lay, ly1.k);
        c.restore();
      }
    } else if (!lyrics.has) {
      c.font = font(F.mono(500), 18); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.55 * prog(t, s, s + 0.6));
      c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`, LYR.x, LYR.y - 20);
      c.letterSpacing = '0px';
    }
    // 註腳（第一根點著之後才出現，很淡）
    const m0 = this.matches[0]!;
    c.font = font(F.mono(500), 16); c.letterSpacing = '2px'; c.fillStyle = rgba('ash', 0.42 * prog(t, m0.ts + 0.6, m0.ts + 1.4));
    c.fillText(FOOT, LYR.x, 960);
    c.letterSpacing = '0px';
    comp.draw(renderer, D.upload(), out);

    // ---- 火焰、煙（疊加）
    const Fp = this.flame;
    // shader 裡的座標是 y 向下的螢幕座標（FRAG_PX 轉過來再比）
    (Fp.u.fp!.value as THREE.Vector2).set(fx, fy);
    (Fp.u.fs!.value as THREE.Vector4).set(flameH, 0.34, clamp(I, 0, 1.8), lean);
    (Fp.u.sm!.value as THREE.Vector4).set(smoke[0], smoke[1], smoke[2], smoke[3]);
    (Fp.u.sm2!.value as THREE.Vector4).set(wisp[0], wisp[1], wisp[2], wisp[3]);
    Fp.u.t!.value = t;
    Fp.render(renderer, out);

    // ---- 火星（擦的那一下）、拍點往上飄的火星、燒紅的那一圈
    this.glow.clear();
    const sg = LIN.signal, em = LIN.ember;
    for (let i = 0; i < this.matches.length; i++) {
      const mt = this.matches[i]!;
      const a = t - mt.ts;
      if (a > -0.02 && a < 0.75) {
        sparkParticles(this.glow, t, (tb) => {
          const u = tb - mt.ts;
          if (u < 0.03 || u > 0.2) return null;
          const p = this.pose(i, tb)!;
          return { x: SX(p.x), y: SY(p.y + 4) };
        }, { rate: 260, life: 0.5, speed: 420, gravity: 900, seed: this.seed + i * 7, intensity: 1.2 });
        if (a > 0.02 && a < 0.16) { const p = this.pose(i, t)!; sparkHead(this.glow, SX(p.x), SY(p.y), t, 1.1, 1 - a / 0.16); }
      }
      // 燒紅的一圈：在燒黑與木頭的交界
      if (t > mt.ts + 0.3 && t < mt.te + 0.2) {
        const p = this.pose(i, t)!;
        const bl = this.burnOf(i, t) * STICK;
        const cx = SX(p.x + Math.cos(p.a) * bl), cy = SY(p.y + Math.sin(p.a) * bl);
        const nx = -Math.sin(p.a) * THICK * 0.5 * PS, ny = Math.cos(p.a) * THICK * 0.5 * PS;
        const k = (t < mt.te ? 1 : 1 - (t - mt.te) / 0.2) * (0.7 + 0.3 * noise1(t * 13, i));
        this.glow.seg2(cx - nx, cy - ny, cx + nx, cy + ny, 4.5, [em[0] * 2.4 * k, em[1] * 1.8 * k, em[2] * 1.2 * k], 0.9);
        this.glow.seg2(cx - nx * 1.4, cy - ny * 1.4, cx + nx * 1.4, cy + ny * 1.4, 10, [sg[0] * 0.5 * k, sg[1] * 0.35 * k, sg[2] * 0.2 * k], 0.5);
      }
    }
    // 拍點：火焰吐出兩三顆火星，搖搖晃晃往上飄、慢慢熄（小節線那一下多吐幾顆）
    for (const b of this.beats) {
      const age = t - b;
      if (age < 0 || age > 1.8) continue;
      const src = this.flameAt(b);
      if (!src) continue;
      const bi = Math.round(b * 1000);
      const n = this.barT.some((x) => Math.abs(x - b) < 0.02) ? 6 : 2 + Math.floor(hash(bi, 1) * 2);
      for (let k = 0; k < n; k++) {
        const life = 1.1 + 0.7 * hash(bi, k, 2);
        if (age > life) continue;
        const u = age / life;
        const vx = (hash(bi, k, 3) - 0.5) * 70, vy = -(90 + 90 * hash(bi, k, 4));
        const x = src.x + vx * age + 14 * Math.sin(age * 5 + k * 2.1) * u, y = src.y + vy * age + 30 * age * age;
        const heat = (1 - u) * (1 - u) * src.I;
        this.glow.seg2(x, y, x - vx * 0.02, y - vy * 0.02, 2.2 * (1 - 0.5 * u), [(sg[0] + em[0]) * 1.4 * heat, (sg[1] + em[1]) * 1.1 * heat, (sg[2] + em[2]) * 0.7 * heat], Math.min(1, heat * 1.6));
      }
    }
    if (this.glow.count) this.glow.render(renderer, out);

    // 擦亮的那一下：畫面輕輕一震
    let amp = 0;
    for (const mt of this.matches) amp += 5 * pulse(t, mt.ts + 0.1, 0.06);
    const ph = frameIdx(t);
    return {
      bloom: 0.95, bloomRadius: 0.75, halation: 0.35, vignette: 0.62, grain: 0.07,
      zoom: 1 + 0.035 * ease.inOutQuad(f.p),
      shake: [amp * (hash(ph, 1) - 0.5) * 2, amp * (hash(ph, 2) - 0.5) * 2],
      popupAvoid: this.avoid,
    };
  }
}
