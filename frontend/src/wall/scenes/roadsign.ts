// 高速公路路牌（暗）：夜裡的高速公路，鏡頭像空拍機一樣貼著車道往前飛，迎面一座跨越車道的門架。
//  - 切進來時鏡頭很快（路燈、車道線往後刷），途中一兩面小路牌在拍點上從頭頂掠過（「幸福 2 km」「永遠 出口」）；
//    在第一個小節左右減速、落定在門架前面（落在拍點上）——門架上那面大路牌就是主打留言（畫面的焦點）：
//    路牌的反光膜在車燈下亮起來，大大的黑體字、署名在右下。整個窗格鏡頭很慢地往前推，最後一拍加速從門架底下穿過去。
//  - 歌詞（比留言小一級）在同一座門架上方的「資訊可變標誌」（LED 點陣看板，琥珀色＝訊號色）：還沒唱的字是暗的 LED，
//    唱到的那一刻亮成訊號色，唱完變成白燈。純音樂：看板顯示歌名。
//  - 每個小節線，一台車從鏡頭下方超過去、開往門架（紅色尾燈越來越小）；對向車道一直有車燈迎面過來；中央分隔島上的路燈一盞盞經過。
//  - 沒有主打留言：門架上的大看板換成 LED 看板放大顯示歌詞（焦點是歌詞），上面的小路牌是「往 幸福」與一行小字邀請。
//  - 路牌的顏色跟著主題（訊號色的暗部），不用真實的公路綠；字與邊框是反光的紙白。
// 手法：路、分隔島、護欄、路燈、車燈、門架鋼構在一個 shader（照相機投影算）；路牌是 init() 畫一次的 Canvas2D，
// 依距離縮放貼上去（門架上的東西都是繞著消失點縮放）；LED 看板每格把歌詞畫進「一顆燈一個像素」的小畫布，由另一個 shader 畫成燈。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, pulse } from '../engine/util';
import { fitText } from '../engine/text';
import { lyricAt, layoutLyric, drawLyric, drawHeart, COUPLE_ZH, DATE_MMDD, fitPx, lyricSubOf, type LyricStyle } from './_motifs';
import { T16_INVITE, T16_TEXT, sigOf, winBars, winBeats } from './_t16';
import { msgMaxFor, lyricV2, sigV2, fitClauses, V2 } from './_v2';
import { LineBatch } from '../engine/lines';
import { LIN } from '../engine/palette';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'city', paper: false, energy: [0.3, 1], bars: [4, 8] };

/** 鏡頭：焦距（px）、地平線、消失點的 x、鏡頭離路面高度（m）、落定時離門架的距離（m）。 */
const FL = 1400, H0 = 620, CX = 960, CAMH = 6.5, D0 = 13.6;
/** 落定時門架上的東西在畫面上的位置（離開這個距離就繞消失點縮放）。 */
/**
 * 留言標準 v2：門架（道具）照樣橫跨整條路，但上面的路牌（寫留言的那一塊）只有 860 寬、高度照字決定（≤ 430），
 * 掛在門架左半邊；右半邊是 LED 看板（歌詞 40～52 px，燈距 3 px）。下半個畫面是路，是主視覺。
 */
const SIGN = { x: 150, y: 184, w: 860, h: 430 };
const LEDR = { x: 1070, y: 184, w: 690, h: 132 };
/** 韓文歌（有原文副行）的 LED 看板：往下加高，中文與原文兩組都放得下（下面是天空，不會碰到路牌或路）。 */
const LEDR_SUB = { ...LEDR, h: 204 };
/** LED 看板的燈距。 */
const PITCH = 3;
/** 門架鋼構（落定時的畫面 y）與兩根柱子（世界 x，m）。 */
const TRUSS = { y0: 124, y1: 166 };
const POSTS = [-9.6, 9.2];
/** 路牌畫布的解析度倍數（推近時會放大一點，留餘裕）。 */
const RES = 1.25;
const FAM_SIGN = F.hei(700);
const FAM_LYR = F.hei(700);
/** 途中掠過的小路牌（落定距離時的畫面大小，與世界 x 偏移）。 */
/** 路邊的小路牌：牌面 5.6 × 2.1 m、底下兩根 3.2 m 的柱子，立在右邊路肩外（世界 x = 9 m）；落定距離時的畫面大小。 */
const KPM = FL / D0;
const SMALL = { w: Math.round(5.6 * KPM), h: Math.round(2.1 * KPM), post: Math.round(3.2 * KPM), x: 9 };
/** 門架大路牌右上角的出口編號。 */
const EXIT_NO = `EXIT ${DATE_MMDD || '99'}`;
const SMALL_TEXT: [string, string][] = [['幸福', '2 km'], ['永遠', '出口 ↗'], ['喜宴', '1 km'], ['白頭偕老', '直走']];

const ROAD = () => new FSPass(/* glsl */ `
  uniform float t, camZ, D, kin, fx;
  uniform vec4 cars[6]; uniform vec4 onc[6];
  const float FL = ${FL}.0, H0 = ${H0}.0, CX = ${CX}.0, CAMH = ${CAMH.toFixed(2)};
  float lineAA(float d, float w) { float aa = fwidth(d) * 1.2 + 1e-4; return 1.0 - smoothstep(w - aa, w + aa, abs(d)); }
  // 一顆燈（畫面上 c、世界距離 z、亮度與顏色）：核心＋光暈
  vec3 lamp(vec2 p, vec2 c, float z, vec3 col) {
    float r = clamp(0.22 * FL / z, 1.4, 16.0);
    float d = length(p - c);
    float g = min(r * 4.0, 60.0);
    return col * ((1.0 - smoothstep(r * 0.6, r, d)) * 2.2 + exp(-d * d / (2.0 * g * g)) * 0.3);
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y); // y 向下
    // ---- 天空：地平線上一層城市的暖光、一排很遠的樓的剪影
    vec3 col = mix(C_INK * 0.5, C_INK2 * 0.8 + C_SIGNAL * 0.016, smoothstep(0.0, H0, p.y) * smoothstep(0.0, H0, p.y));
    float sk = H0 - 18.0 - 30.0 * floor(hash12(vec2(floor((p.x + fx) / 46.0), 3.0)) * 3.0) * 0.5 - 12.0 * step(0.8, hash12(vec2(floor((p.x + fx) / 17.0), 5.0)));
    if (p.y > sk && p.y < H0) {
      col = C_INK2 * 0.6;
      vec2 wg = floor((p + vec2(fx, 0.0)) / vec2(5.0, 6.0));
      col += C_EMBER * 0.1 * step(0.93, hash12(wg)) * step(0.4, fract((p.x + fx) / 5.0)) * step(0.4, fract(p.y / 6.0));
    }
    if (p.y > H0) {
      // ---- 路面：投影回世界座標
      float z = CAMH * FL / (p.y - H0);
      float x = (p.x - CX) * z / FL;
      float zw = z + camZ;
      vec3 asphalt = C_INK2 * 0.42 * (0.85 + 0.15 * snoise(vec2(x * 0.7, zw * 0.35)));
      vec3 c2 = vec3(0.0);
      if (x > -6.1 && x < 7.2) {
        c2 = asphalt;
        // 車道線：兩條虛線（4 m 一段、12 m 一個循環）、兩邊的實線
        float dash = step(mod(zw, 12.0), 4.0);
        float lm = max(lineAA(x - 1.75, 0.08) * dash, lineAA(x + 1.75, 0.08) * dash);
        lm = max(lm, max(lineAA(x - 5.25, 0.1), lineAA(x + 5.4, 0.1)));
        c2 = mix(c2, C_BONE * 0.3, lm * 0.85);
      } else if (x <= -6.1) {
        // 對向車道（分隔島另一邊）
        c2 = asphalt * 0.8;
        float dash = step(mod(zw, 12.0), 4.0);
        c2 = mix(c2, C_BONE * 0.22, lineAA(x + 11.0, 0.08) * dash * 0.8);
      } else {
        c2 = C_INK * 0.6 + C_GRAPHITE * 0.02 * snoise(vec2(x, zw) * 0.4); // 路肩外的草坡
      }
      // 路燈照在路上的一團團光（分隔島上每 36 m 一盞）
      float zl = (floor(zw / 36.0) + 0.5) * 36.0;
      for (int k = -1; k <= 1; k++) {
        float lz = zl + float(k) * 36.0;
        vec2 dd = vec2(x + 5.0, zw - lz) / vec2(7.0, 14.0);
        c2 += (C_SIGNAL * 0.045 + C_BONE * 0.01) * exp(-dot(dd, dd));
      }
      // 遠處糊成一片
      c2 = mix(c2, C_INK2 * 0.8 + C_SIGNAL * 0.012, smoothstep(120.0, 600.0, z));
      col = c2;
    }
    // ---- 中央分隔島（x = -6.1 的矮牆，高 1.1 m）
    if (p.x < CX) {
      float zb = -6.1 * FL / (p.x - CX);
      float yb = CAMH - (p.y - H0) * zb / FL;
      if (zb > 1.0 && yb > 0.0 && yb < 1.1) {
        vec3 bw = C_GRAPHITE * 0.09 * (0.7 + 0.3 * yb);
        float zl = (floor((zb + camZ) / 36.0) + 0.5) * 36.0;
        for (int k = -1; k <= 1; k++) bw += C_SIGNAL * 0.05 * exp(-pow((zb + camZ - zl - float(k) * 36.0) / 10.0, 2.0));
        col = mix(bw, C_INK2 * 0.9, smoothstep(120.0, 600.0, zb));
      }
    }
    // ---- 右邊護欄（x = 7.4、高 0.6～0.9 m），反光片每 4 m 一個
    if (p.x > CX) {
      float zg = 7.4 * FL / (p.x - CX);
      float yg = CAMH - (p.y - H0) * zg / FL;
      if (zg > 1.0 && yg > 0.55 && yg < 0.9) {
        vec3 gc = C_ASH * 0.1 * (0.6 + 0.4 * smoothstep(0.55, 0.9, yg));
        float refl = step(mod(zg + camZ, 4.0), 0.25) * step(0.66, yg) * step(yg, 0.78);
        gc += C_EMBER * 0.8 * refl;
        col = mix(gc, C_INK2 * 0.9, smoothstep(150.0, 600.0, zg));
      }
    }
    // ---- 分隔島上的路燈：燈桿與燈頭（鈉燈，訊號色）
    float z0 = floor(camZ / 36.0) * 36.0;
    for (int k = 0; k < 12; k++) {
      // 太近的燈（已經在頭頂上）推到很遠、亮度 0（不用 continue）
      float lz0 = z0 + (float(k) + 0.5) * 36.0 - camZ;
      float vis = step(2.0, lz0);
      float lz = max(lz0, 2.0);
      float s = FL / lz;
      float px = CX - 6.1 * s, top = H0 - (10.0 - CAMH) * s, bot = H0 + CAMH * s;
      float pw = max(0.6, 0.12 * s);
      if (vis > 0.5 && abs(p.x - px) < pw && p.y > top && p.y < bot) col = mix(C_GRAPHITE * 0.12, col, smoothstep(80.0, 400.0, lz));
      // 燈臂伸向車道
      float ax = px + 2.2 * s;
      if (vis > 0.5 && p.x > px && p.x < ax && abs(p.y - top) < max(0.6, 0.08 * s)) col = C_GRAPHITE * 0.12;
      col += vis * lamp(p, vec2(ax, top + 0.15 * s), lz, C_SIGNAL * 0.9 + C_EMBER * 0.3) * (1.0 - smoothstep(200.0, 500.0, lz));
    }
    // ---- 我們車道上的車（尾燈）與對向來車（頭燈）
    for (int i = 0; i < 6; i++) {
      vec4 c = cars[i];
      if (c.w > 0.0 && c.y > 3.0) {
        float s = FL / c.y;
        vec2 a = vec2(CX + (c.x - 0.8) * s, H0 + (CAMH - 0.8) * s), b = vec2(CX + (c.x + 0.8) * s, a.y);
        vec3 tl = (C_BLOOD * 1.6 + C_SIGNAL * 0.4) * c.w;
        col += lamp(p, a, c.y, tl) + lamp(p, b, c.y, tl);
        // 方向燈（c.z：-1 左、1 右）
        if (abs(c.z) > 0.5) col += lamp(p, vec2(CX + (c.x + sign(c.z) * 1.05) * s, a.y - 0.1 * s), c.y, (C_SIGNAL * 1.6 + C_EMBER * 0.5) * c.w);
      }
      vec4 o = onc[i];
      if (o.w > 0.0 && o.y > 3.0) {
        float s = FL / o.y;
        vec2 a = vec2(CX + (o.x - 0.8) * s, H0 + (CAMH - 0.7) * s), b = vec2(CX + (o.x + 0.8) * s, a.y);
        vec3 hl = (C_BONE * 1.1 + C_EMBER * 0.3) * o.w;
        col += lamp(p, a, o.y, hl) + lamp(p, b, o.y, hl);
        // 頭燈照在路上的一片
        if (p.y > H0) {
          float z = CAMH * FL / (p.y - H0), x = (p.x - CX) * z / FL;
          vec2 dd = vec2(x - o.x, z - o.y + 9.0) / vec2(2.2, 8.0);
          col += C_BONE * 0.03 * o.w * exp(-dot(dd, dd)) * step(z, o.y);
        }
      }
    }
    // ---- 門架鋼構（離鏡頭 D m）：兩根柱子、上下弦與斜撐
    if (D > 1.0) {
      float s = ${D0.toFixed(2)} / D;
      float y0 = H0 - (H0 - ${TRUSS.y0}.0) * s, y1 = H0 - (H0 - ${TRUSS.y1}.0) * s;
      float xL = CX + ${POSTS[0]} * FL / D, xR = CX + ${POSTS[1]} * FL / D;
      float th = max(1.0, 7.0 * s);
      vec3 steel = C_GRAPHITE * 0.16 + C_SIGNAL * 0.01;
      if (p.x > xL && p.x < xR) {
        float bars = max(1.0 - smoothstep(th * 0.5, th * 0.5 + 1.0, abs(p.y - y0)), 1.0 - smoothstep(th * 0.5, th * 0.5 + 1.0, abs(p.y - y1)));
        float cell = (y1 - y0);
        float u = mod(p.x - xL, cell * 2.0) / cell;
        float diag = u < 1.0 ? (p.y - y0) - u * cell : (p.y - y0) - (2.0 - u) * cell;
        float lat = (p.y > y0 && p.y < y1) ? 1.0 - smoothstep(th * 0.2, th * 0.2 + 1.0, abs(diag) * 0.7) : 0.0;
        col = mix(col, steel * (1.0 + 0.4 * step(p.y, (y0 + y1) * 0.5)), max(bars, lat));
      }
      float pw = max(1.0, 0.3 * FL / D);
      float bot = H0 + CAMH * FL / D;
      for (int i = 0; i < 2; i++) {
        float xp = i == 0 ? xL : xR;
        if (abs(p.x - xp) < pw && p.y > y0 - th && p.y < bot) col = steel * (0.8 + 0.4 * smoothstep(-pw, pw, p.x - xp));
      }
    }
    col *= kin;
    fragColor = vec4(col, 1.0);
  }`, {
  t: { value: 0 }, camZ: { value: 0 }, D: { value: D0 }, kin: { value: 1 }, fx: { value: 0 },
  cars: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) }, onc: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) },
});

/** LED 看板：rect（畫面上的範圍）裡一顆顆燈；資料貼圖一顆燈一個像素（r = 還沒唱、g = 正在唱、b = 唱完，a = 亮幾分）。 */
const LED = () => new FSPass(/* glsl */ `
  uniform sampler2D dat; uniform vec4 rect; uniform vec2 grid; uniform float kin, lit, pad;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 u = (p - rect.xy) / rect.zw;
    vec2 q = p - rect.xy;
    if (q.x < -pad || q.y < -pad || q.x > rect.z + pad || q.y > rect.w + pad) discard;
    // 外殼：比燈面大一圈（pad px）的黑框
    if (u.x < 0.0 || u.y < 0.0 || u.x > 1.0 || u.y > 1.0) { fragColor = vec4(C_INK * 0.7 + C_GRAPHITE * 0.03, 1.0) * kin; return; }
    vec2 g = u * grid, cell = floor(g), f = fract(g) - 0.5;
    float pitch = rect.z / grid.x;
    float r = length(f) * pitch;
    float dot_ = 1.0 - smoothstep(pitch * 0.3, pitch * 0.3 + 0.9, r);
    vec4 v = texture(dat, (cell + 0.5) / grid);
    float on = smoothstep(0.3, 0.6, v.a);
    vec3 w = v.rgb / max(1e-3, v.r + v.g + v.b);
    vec3 c = C_SIGNAL * 0.28 * w.r + (C_SIGNAL * 2.4 + C_EMBER * 0.5) * w.g + mix(C_BONE, C_EMBER, 0.35) * 1.05 * w.b;
    vec3 off = C_GRAPHITE * 0.07;
    vec3 col = C_INK * 0.55 + mix(off, c * lit, on) * dot_;
    // 燈旁邊一點點光暈
    col += c * lit * on * 0.12 * (1.0 - dot_);
    fragColor = vec4(col * kin, 1.0);
  }`, { dat: { value: null }, rect: { value: new THREE.Vector4() }, grid: { value: new THREE.Vector2() }, kin: { value: 1 }, lit: { value: 1 }, pad: { value: 10 } });

interface Rect { x: number; y: number; w: number; h: number }
/** 落定時的畫面範圍 r，在離鏡頭 D 公尺時的畫面範圍（繞消失點縮放）。 */
const at = (r: Rect, D: number): Rect => { const s = D0 / D; return { x: CX + (r.x - CX) * s, y: H0 - (H0 - r.y) * s, w: r.w * s, h: r.h * s }; };

export default class RoadSign extends Scene {
  road = shared('roadsign.road', ROAD);
  led = shared('roadsign.led', LED);
  /** 靜態的路牌（大路牌＝留言，或沒有留言時上面的小路牌）。 */
  sign: Layer2D;
  smalls: Layer2D[] = [];
  /** LED 看板的資料（一顆燈一個像素）。 */
  ledCv = document.createElement('canvas');
  ledTex = this.track(dataTexture(this.ledCv));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 229 + (this.msg?.id ?? 0) * 7919) >>> 0;
  signRect: Rect;
  ledRect: Rect;
  pitch = 4;
  cols = 1; rows = 1;
  lyrStyle: LyricStyle = { family: FAM_LYR, size: 15, minSize: 11, maxWidth: 300, align: 'center', lineHeight: 1.12 };
  hasLyrics = false;
  tArr = 0; tExit = 0; D1 = 150;
  passes: { t: number; x: number; k: number }[] = [];
  bars: number[] = [];
  beats: number[] = [];
  msgSize: number | null = null;
  bp = 0.5;
  /** 看板角上的警示燈、超車的方向燈（加亮、會發光）。 */
  glow = this.track(new LineBatch(64, { screen2D: true, blend: 'add' }));

  constructor(ctx: ConstructorParameters<typeof Scene>[0]) {
    super(ctx);
    const m = ctx.params.message ?? null;
    // 路牌在門架左半邊、LED 看板在右半邊（有沒有留言都一樣；沒有留言時路牌只寫「往 幸福」，小小的）
    void m;
    this.signRect = SIGN;
    this.ledRect = LEDR;
    this.sign = this.track(new Layer2D(this.signRect.w, this.signRect.h, RES, { fast: true }));
  }

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
    // 這個窗格有原文副行（韓文歌；有主打留言的窗格，引擎給的歌詞本來就沒有原文）：LED 看板加高
    if (lyrics.linesIn(s - 1, e).some((l) => lyricSubOf(l))) this.ledRect = LEDR_SUB;
    const sig = m ? sigOf(m) : '';
    await loadText(`${T16_TEXT}${m?.text ?? ''}${sig}${song.title}${song.artist}${lyrics.linesIn(s - 1, e).map((l) => l.text + (l.sub?.text ?? '')).join('')}${SMALL_TEXT.flat().join('')}往幸福出口${EXIT_NO}↗→`);
    const beat = au.beatPeriod(s);
    this.bp = beat;
    this.bars = winBars(au, s, e);
    this.beats = winBeats(au, s, e);

    // ---- 鏡頭：落定在拍點上（窗格的三成、0.9～2.2 秒內），最後一拍前後加速穿過門架
    const A = clamp(0.3 * (e - s), 0.9, 2.2);
    this.tArr = au.timeOfBeat(Math.max(Math.ceil(au.beatAt(s + 0.5)), Math.round(au.beatAt(s + A))));
    if (this.tArr > e - 1.2) this.tArr = Math.max(s + 0.5, e - 1.2);
    this.tExit = e - clamp(beat * 1.2, 0.45, 0.8);
    this.D1 = clamp(55 * (this.tArr - s), 60, 150);
    // 途中掠過的小路牌：落定前的拍點（最多兩面），鏡頭正好在拍點經過它
    const cand = this.beats.filter((tb) => tb > s + 0.3 && tb < this.tArr - 0.25).slice(-2);
    cand.forEach((tb, i) => this.passes.push({ t: tb, x: SMALL.x, k: (this.seed + i) % SMALL_TEXT.length }));
    for (const p of this.passes) {
      const L = this.track(new Layer2D(SMALL.w, SMALL.h + SMALL.post, 0.6, { fast: true }));
      this.drawSmall(L.ctx, SMALL_TEXT[p.k]!);
      L.upload();
      this.smalls.push(L);
    }

    // ---- 路牌
    this.drawSign(sig);
    this.sign.upload();

    // ---- LED 看板：燈距（有留言時小看板 4 px、沒留言的大看板 6 px）
    this.pitch = PITCH;
    this.cols = Math.floor(this.ledRect.w / this.pitch);
    this.rows = Math.floor(this.ledRect.h / this.pitch);
    this.ledCv.width = this.cols; this.ledCv.height = this.rows;
    // 歌詞的字級（單位是燈）：v2 的螢幕字級 ÷ 燈距
    const ls = lyricV2(m ? this.msgSize : null) / PITCH;
    this.lyrStyle = { family: FAM_LYR, size: ls, minSize: V2.lyrMin / PITCH, maxWidth: this.cols - 8, align: 'center', lineHeight: 1.1 };
  }

  /** 路牌的底：主題的深色、反光的紙白圓角邊框。 */
  private plate(c: CanvasRenderingContext2D, w: number, h: number, border: number) {
    c.fillStyle = mixRgba('blood', 'ink', 0.5);
    roundRect(c, 0, 0, w, h, 18); c.fill();
    // 反光膜的細紋（很淡，斜的）
    c.save(); roundRect(c, 0, 0, w, h, 18); c.clip();
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, rgba('bone', 0.06)); g.addColorStop(0.5, rgba('bone', 0)); g.addColorStop(1, rgba('ink', 0.18));
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.restore();
    c.strokeStyle = rgba('bone', 0.92); c.lineWidth = border;
    roundRect(c, border * 1.6, border * 1.6, w - border * 3.2, h - border * 3.2, 12); c.stroke();
  }

  private drawSign(sig: string) {
    const c = this.sign.ctx, r = this.signRect, m = this.msg;
    c.clearRect(0, 0, r.w, r.h);
    c.textBaseline = 'alphabetic';
    if (m) {
      // 留言：字級上限依字數（v2），照標點斷行，扣掉署名那一排再找字級；牌子的高度照字決定（只比字多一點邊）
      const box = { x: 48, y: 64, w: r.w - 96 };
      const o = { min: V2.msgMin, max: msgMaxFor(m.text), lineHeight: 1.26, maxLines: 5 };
      const hMax = r.h - box.y - 30 - 44;
      const fit = fitClauses(c, m.text, FAM_SIGN, box.w, hMax, o) ?? fitText(c, m.text, FAM_SIGN, box.w, hMax, o);
      this.msgSize = fit.size;
      const ss = sigV2(fit.size);
      const top = box.y + fit.size * 0.9;
      const sy = top + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.3 + ss * 1.3;
      const ph = Math.min(r.h, sy + 30);
      this.plate(c, r.w, ph, 5);
      // 右上角的出口編號小牌（婚禮日期的月日；還沒定日期是「久久」的 99）
      c.fillStyle = rgba('bone', 0.9);
      roundRect(c, r.w - 168, 20, 128, 30, 5); c.fill();
      c.font = font(F.hei(700), 18); c.fillStyle = mixRgba('blood', 'ink', 0.5); c.textAlign = 'center'; c.letterSpacing = '2px';
      c.fillText(EXIT_NO, r.w - 104, 41);
      c.letterSpacing = '0px'; c.textAlign = 'left';
      c.font = font(FAM_SIGN, fit.size); c.fillStyle = rgba('bone', 0.97);
      fit.lines.forEach((ln, i) => fillHearts(c, ln, box.x, top + i * fit.lineHeight, fit.size));
      c.font = font(F.hei(500), ss); c.fillStyle = rgba('bone', 0.82); c.textAlign = 'right';
      c.fillText(sig, box.x + box.w, sy);
      c.textAlign = 'left';
    } else {
      // 沒有留言：小路牌「往 幸福 ↗」、新人的名字當出口名、一行小字邀請
      this.plate(c, r.w, 150, 4);
      c.font = font(FAM_SIGN, 52); c.fillStyle = rgba('bone', 0.96);
      c.fillText('往 幸福', 44, 74);
      c.font = font(F.hei(700), 54); c.textAlign = 'right';
      c.fillText('↗', r.w - 40, 78);
      // 出口名是新人的名字：名字很長就縮字，不會碰到左邊的「往 幸福」
      c.font = font(F.hei(500), fitPx(`${COUPLE_ZH} 出口`, F.hei(500), 22, 420)); c.fillStyle = rgba('bone', 0.7);
      c.fillText(`${COUPLE_ZH} 出口`, r.w - 110, 64);
      c.textAlign = 'left';
      c.font = font(F.hei(500), 20); c.fillStyle = rgba('bone', 0.66); c.letterSpacing = '2px';
      c.fillText(T16_INVITE, 46, 118);
      c.letterSpacing = '0px';
    }
  }

  private drawSmall(c: CanvasRenderingContext2D, [a, b]: [string, string]) {
    // 兩根柱子（牌面底下到地面）
    c.fillStyle = mixRgba('graphite', 'ink', 0.55);
    for (const px of [SMALL.w * 0.22, SMALL.w * 0.78]) c.fillRect(px - 9, SMALL.h - 10, 18, SMALL.post + 10);
    this.plate(c, SMALL.w, SMALL.h, 4);
    c.textBaseline = 'alphabetic';
    c.font = font(FAM_SIGN, 88); c.fillStyle = rgba('bone', 0.95);
    c.fillText(a, 40, 136);
    c.font = font(F.hei(700), 52); c.textAlign = 'right';
    c.fillText(b, SMALL.w - 40, 136);
    c.textAlign = 'left';
  }

  /** 離門架的距離（m）：先很快地衝過來、在拍點上落定；之後很慢地推近；最後加速穿過去。 */
  private dist(t: number) {
    const s = this.ctx.start, e = this.ctx.end;
    if (t < this.tArr) { const u = clamp((t - s) / (this.tArr - s)); return D0 + (this.D1 - D0) * (1 - u) ** 3; }
    const hold = D0 * (1 - 0.06 * ease.inOutQuad(clamp((t - this.tArr) / Math.max(0.1, this.tExit - this.tArr))));
    if (t < this.tExit) return hold;
    return hold - (hold + 3) * ease.inCubic(clamp((t - this.tExit) / (e - this.tExit)));
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, lyrics, song } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const kin = prog(t, s, s + 0.15);
    const D = this.dist(t);
    const u = this.road.u;
    u.t!.value = t; u.camZ!.value = -D + 200; u.D!.value = D; u.kin!.value = kin; u.fx!.value = (D0 - D) * 0.4;
    // 每個小節線一台車從鏡頭下方超過去、開往門架
    const cars = u.cars!.value as THREE.Vector4[];
    cars.forEach((c) => c.set(0, 0, 0, 0));
    this.bars.slice(-6).forEach((tb, i) => {
      if (t < tb) return;
      const lane = [3.5, 0, -3.5][Math.floor(hash(this.seed, tb * 10, 1) * 3)]!;
      // 車的相對距離：超車那一下在鏡頭前 2 m，之後每秒比鏡頭多跑 26 m（鏡頭自己在動也要算進去）
      const zc = D - this.dist(tb) + 2 + 26 * (t - tb);
      // 超車後切回中間車道前打方向燈：前兩拍每拍亮半拍（落在拍點）
      const bt = (t - tb) / this.bp;
      const blink = bt < 2 && bt - Math.floor(bt) < 0.5 ? (lane > 0 ? -1 : 1) : 0;
      cars[i]!.set(lane, zc, blink, clamp((t - tb) / 0.2) * (1 - clamp((zc - 180) / 60)));
    });
    // 對向來車：每 1.1 秒左右一台
    const onc = u.onc!.value as THREE.Vector4[];
    for (let i = 0; i < 6; i++) {
      const per = 1.1, k = Math.floor(t / per) - i;
      const t0 = k * per + hash(k, 3) * 0.5;
      const zc = 240 - 60 * (t - t0);
      onc[i]!.set(hash(k, 4) < 0.5 ? -8.8 : -12.2, zc, 0, zc > 3 && t >= t0 ? clamp((240 - zc) / 40) : 0);
    }
    this.road.render(renderer, out);

    // ---- 門架上的路牌與 LED 看板
    if (D > 1) {
      const lit = 0.55 + 0.45 * clamp(1 - (D - D0) / 60) + 0.25 * pulse(t, this.tArr, 0.25);
      this.place(this.sign.texture, at(this.signRect, D), kin * Math.min(1.15, lit), out);
      this.drawLed(t, lyrics, song);
      const lr = at(this.ledRect, D);
      const lu = this.led.u;
      (lu.rect!.value as THREE.Vector4).set(lr.x, lr.y, lr.w, lr.h);
      (lu.grid!.value as THREE.Vector2).set(this.cols, this.rows);
      lu.dat!.value = this.ledTex; lu.kin!.value = kin; lu.lit!.value = 1; lu.pad!.value = 9 * lr.w / this.ledRect.w;
      this.led.render(renderer, out);
      // LED 看板上方兩顆琥珀色警示燈，每一拍左右輪流閃
      const gl = this.glow; gl.clear();
      const bi = Math.floor(this.ctx.audio.beatAt(t) + 1e-4), bk = pulse(t, this.ctx.audio.timeOfBeat(bi), 0.22);
      const S = LIN.signal, E = LIN.ember;
      [0, 1].forEach((j) => {
        const on = (bi + j) % 2 === 0 ? 0.25 + bk : 0.12;
        const q = at({ x: LEDR.x + (j ? LEDR.w - 22 : 22), y: LEDR.y - 16, w: 0, h: 0 }, D);
        const sc = D0 / D;
        gl.seg2(q.x, q.y, q.x + 0.01, q.y, 26 * sc, [S[0] * 0.8 * on, S[1] * 0.8 * on, S[2] * 0.8 * on], 0.5);
        gl.seg2(q.x, q.y, q.x + 0.01, q.y, 9 * sc, [E[0] * 3 * on + 0.2, E[1] * 3 * on + 0.1, E[2] * 3 * on], 1);
      });
      gl.render(renderer, out);
    }

    // ---- 途中掠過的路邊小路牌（比門架近，後畫；遠的先畫）：鏡頭正好在拍點經過它，從畫面右邊刷出去
    const vis: { r: Rect; i: number }[] = [];
    this.passes.forEach((p, i) => {
      const Dk = D - this.dist(p.t);
      if (Dk < 1.5 || Dk > 140) return;
      // 牌面底部離路面 3.2 m：落定距離時的畫面 y = H0 + (CAMH − 3.2 − 2.1) × KPM
      const base: Rect = { x: CX + p.x * KPM - SMALL.w / 2, y: H0 + (CAMH - 3.2 - 2.1) * KPM, w: SMALL.w, h: SMALL.h + SMALL.post };
      vis.push({ r: at(base, Dk), i });
    });
    vis.sort((a, b) => a.r.w - b.r.w).forEach(({ r, i }) => this.place(this.smalls[i]!.texture, r, kin * 0.95, out));
    // 落定那一下鏡頭輕輕頓一下（zoom 小小的回彈）
    const land = pulse(t, this.tArr, 0.12);
    // 每個小節線車子壓過伸縮縫：畫面輕輕顛一下
    let bump = 0;
    for (const tb of this.bars) if (tb > this.tArr && tb <= t) bump = Math.sin(Math.min(1, (t - tb) / 0.25) * Math.PI) * Math.exp(-(t - tb) / 0.15);
    return { bloom: 0.7, vignette: 0.55, halation: 0.3, zoom: 1 + 0.012 * land, shake: [0, 2.2 * bump] };
  }

  /** 把一張路牌貼到畫面上的範圍 r（亮度 k：車燈照到反光膜的程度）。Compositor 只會整張縮放平移，用 scale／offset 對到那一塊。 */
  private place(tex: THREE.Texture, r: Rect, k: number, out: THREE.WebGLRenderTarget) {
    this.ctx.comp.draw(this.ctx.renderer, tex, out, { tint: [k, k, k], scale: [W / r.w, H / r.h], offset: [0.5 * W / r.w - 0.5 - r.x / r.w, 0.5 + r.y / r.h - 0.5 * H / r.h] });
  }

  /** 把這一格 LED 看板要亮的燈畫進資料畫布。 */
  private drawLed(t: number, lyrics: typeof this.ctx.lyrics, song: typeof this.ctx.song) {
    const c = this.ledCv.getContext('2d', { willReadFrequently: true })!;
    c.clearRect(0, 0, this.cols, this.rows);
    const ly = this.hasLyrics ? lyricAt(lyrics, t) : null;
    if (ly && lyricSubOf(ly.line)) {
      // 原文副行：資料畫布一顆燈一個像素，副行的字級規則（subSizeFor 的 32～56）是螢幕 px，
      // 所以這裡縮 1/燈距、用螢幕 px 排（直接用燈當單位，原文會變成三倍大）。
      // 中文先照原本的字級，兩組加起來放不下看板就縮中文（副行跟著縮），最小到 v2 的 40 px
      const P = this.pitch, hMax = this.rows * P - 10;
      const base: LyricStyle = { family: FAM_LYR, size: this.lyrStyle.size * P, minSize: V2.lyrMin, maxWidth: this.lyrStyle.maxWidth * P, align: 'center', lineHeight: 1.1, active: LED_ON, sung: LED_DONE, unsung: LED_OFF };
      let lay = layoutLyric(c, ly.line, base), st = base;
      for (let sz = base.size - 2; lay.height + lay.size * 0.2 > hMax && sz >= V2.lyrMin; sz -= 2) { st = { ...base, size: sz }; lay = layoutLyric(c, ly.line, st); }
      c.save();
      c.scale(1 / P, 1 / P);
      c.translate((this.cols * P) / 2, Math.round(((this.rows * P - lay.height - lay.size * 0.12) / 2 + lay.size * 0.88) / P) * P);
      drawLyric(c, ly.line, t, st, lay, 1);
      c.restore();
    } else if (ly) {
      const st: LyricStyle = { ...this.lyrStyle, active: LED_ON, sung: LED_DONE, unsung: LED_OFF };
      const lay = layoutLyric(c, ly.line, st);
      c.save();
      c.translate(this.cols / 2, Math.round((this.rows - lay.height) / 2 + lay.size * 0.88));
      drawLyric(c, ly.line, t, st, lay, 1);
      c.restore();
    } else {
      // 純音樂：看板顯示歌名（沒有留言的大看板：兩行邀請）；兩句歌詞之間：歌名用暗的燈
      c.fillStyle = this.hasLyrics ? LED_OFF : LED_DONE; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
      if (this.msg || this.hasLyrics) {
        const txt = `♪ ${song.title}`;
        c.font = font(FAM_LYR, this.lyrStyle.size);
        const sz = Math.min(this.lyrStyle.size, (this.lyrStyle.size * (this.cols - 8)) / Math.max(1, c.measureText(txt).width));
        c.font = font(FAM_LYR, sz);
        c.fillText(txt, this.cols / 2, Math.round(this.rows / 2 + sz * 0.38));
      } else {
        const ls = ['掃描右下角 QR code', '把祝福傳上大螢幕'];
        c.font = font(FAM_LYR, 17);
        ls.forEach((ln, i) => c.fillText(ln, this.cols / 2, Math.round(this.rows / 2 - 4 + i * 21)));
      }
      c.textAlign = 'left';
    }
    this.ledTex.needsUpdate = true;
  }

  override dispose() { super.dispose(); this.ledCv.width = this.ledCv.height = 0; }
}

/** LED 資料畫布的三種狀態（不是畫面上的顏色：shader 用 r、g、b 分辨還沒唱、正在唱、唱完）。 */
const LED_OFF = 'rgb(255,0,0)', LED_ON = 'rgb(0,255,0)', LED_DONE = 'rgb(0,0,255)';

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** 路牌上的字：♥ 換成我們自己畫的愛心（點綴色）。 */
function fillHearts(c: CanvasRenderingContext2D, ln: string, x: number, y: number, size: number) {
  let cx = x;
  const base = c.fillStyle;
  for (const part of ln.split(/(♥)/)) {
    if (!part) continue;
    const w = c.measureText(part).width;
    if (part === '♥') drawHeart(c, cx + w / 2, y - size * 0.36, Math.min(w, size) * 0.86, rgba('rose'));
    else { c.fillStyle = base; c.fillText(part, cx, y); }
    cx += w;
  }
}

/** 一顆燈一個像素的資料貼圖：最近點取樣、不預乘、不翻轉。 */
function dataTexture(cv: HTMLCanvasElement) {
  const tx = new THREE.CanvasTexture(cv);
  tx.colorSpace = THREE.NoColorSpace;
  tx.flipY = false;
  tx.premultiplyAlpha = false;
  tx.minFilter = THREE.NearestFilter;
  tx.magFilter = THREE.NearestFilter;
  tx.generateMipmaps = false;
  return tx;
}

