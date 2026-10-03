// 天際線（暗）：夜裡隔著河看對岸的城市。一整排大樓的窗戶排成同一張格子，窗戶就是像素——
//  - 畫面的焦點＝主打留言：大樓的窗戶一格一格亮燈拼出留言的字（像城市為新人做的燈光秀）。第一個拍點起，
//    亮燈的「前緣」一拍往右推進一段，推到的那一欄窗戶在一拍裡陸續打開（每扇窗晚一點點，像有人去開燈），剛開的燈是訊號色、
//    很快變成暖白。字的範圍裡其他的窗都關著（字才清楚），範圍外的窗照常零零落落地亮，偶爾在拍點上開關一兩扇。
//    署名也用窗戶拼在最後一行下面靠右。愛心的窗是玫瑰色。每個小節線，拼字的窗一起亮一下。
//  - 歌詞（比留言小一級）寫在大樓上方的夜空，照跟唱規則逐字亮。
//  - 河面倒映整排大樓與亮著的字（波紋把倒影拉長、搖晃）。遠處還有一排更暗的樓（視差）。
//  - 冷面註記（一小行）：「＊本訊息由 1,024 扇窗戶聯合播出」（窗戶數是真的算出來的）。
//  - 沒有主打留言：窗戶拼新人的名字（「承恩 ♥ 以晴」；名字長就照窗格的大小縮字、折成兩排），歌詞放大；純音樂：夜空是小小的歌名。
//  - 鏡頭：很慢地往右橫移（遠樓比近樓慢，有視差），整個窗格慢慢推近。
// 手法：天空、兩排大樓、窗格、河面倒影全在一個 shader；留言先畫進一張「一扇窗一個像素」的小畫布（反鋸齒的灰階＝那扇窗亮幾分），
// 每扇窗什麼時候亮由 shader 用前緣與雜湊算（確定性）；歌詞與小字是一張 Canvas2D。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, hash, pulse } from '../engine/util';
import { fitText } from '../engine/text';
import { lyricAt, layoutLyric, drawLyric, beatAfter, drawHeart, NAME_A, NAME_B, type LyricStyle } from './_motifs';
import { msgMaxFor, lyricV2, sigV2, fitClauses, V2 } from './_v2';
import { T16_INVITE, T16_TEXT, sigOf, winBars } from './_t16';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'city', paper: false, energy: [0.2, 1], bars: [4, 8] };

/** 窗格的間距（px）：一扇窗一格。 */
const P = 3;
/** 拼字的範圍（畫面座標，對齊窗格）。 */
/**
 * 留言標準 v2：字 40～60 px（一扇窗 3 px，字約 13～20 扇窗高，中文筆畫才拼得出來），拼字的樓群在畫面左邊（≤ 860 × 420）；
 * 右邊的樓群是場景：每個小節線有一棟樓從一樓往上一層層亮燈、每兩小節一班高架電車沿著河岸開過去。
 */
const TB = { x: 150, y: 330, w: 860, h: 420 };
const COLS = Math.floor(TB.w / P), ROWS = Math.floor(TB.h / P);
/** 河岸（水面）。 */
const WATER = 800;
/** 夜空裡的歌詞。 */
const LYR = { x: 150, y: 206, w: 1160 };
const LYR_BIG = { x: 150, y: 206, w: 1160 };
const FAM_MSG = F.hei(500);
const FAM_LYR = F.archivo(100, 700);
const NB = 16;

const BG = () => new FSPass(/* glsl */ `
  uniform sampler2D msk; uniform vec2 grid; uniform vec2 org;
  uniform vec4 bld[${NB}]; uniform float nb;
  uniform float t, kin, pan, farPan, t0, bp, cpb, c0, bar, heatK, beatIdx, blink;
  uniform vec4 chase; // 一棟樓一層層亮燈：樓的種子、亮到的高度（畫面 y）、亮度、-
  uniform vec2 train; // 高架電車：車頭的 x、亮度
  const float P = ${P}.0, WATER = ${WATER}.0;
  // 正在畫河面倒影時設成 1：倒影只映出樓的窗光，不映拼字的窗（上下顛倒、糊掉的字看起來像亂碼）
  float gRefl = 0.0;

  // 近排大樓：這個 x 在哪一棟（回傳頂端的 y 與這棟的種子；沒有樓回傳 -1）
  vec3 building(float x) {
    vec3 r = vec3(2000.0, -1.0, 0.0);
    for (int i = 0; i < ${NB}; i++) {
      vec4 b = bld[i];
      if (float(i) < nb && x >= b.x && x < b.y) r = vec3(b.z, b.w, b.x);
    }
    return r;
  }
  // 一扇窗的亮度與顏色（近排）：拼字的窗（留言）＋平常零星亮著的窗
  vec3 facade(vec2 p, out float isB) {
    vec3 b = building(p.x);
    isB = 0.0;
    if (b.y < 0.0) return vec3(0.0);
    if (p.y < b.x) {
      // 樓頂的天線：一半的樓有，頂上一顆航空警示燈，一拍閃一次（隔壁棟輪流）
      float has = step(0.5, hash12(vec2(b.y, 8.0)));
      float ax = b.z + P * (3.0 + floor(hash12(vec2(b.y, 9.0)) * 6.0));
      float ah = 30.0 + 60.0 * hash12(vec2(b.y, 10.0));
      if (has > 0.5 && abs(p.x - ax) < 1.2 && p.y > b.x - ah) { isB = 1.0; return C_INK2 * 0.8; }
      float on = mod(beatIdx + b.y, 2.0) < 0.5 ? blink : 0.0;
      float ld = length(p - vec2(ax, b.x - ah - 2.0));
      if (has > 0.5 && ld < 14.0) { isB = 1.0 - smoothstep(2.0, 14.0, ld); return (C_SIGNAL * 2.5 + C_BLOOD) * (0.15 + on) * (1.0 - smoothstep(1.5, 3.0, ld)) + C_SIGNAL * 0.25 * on * exp(-ld / 5.0); }
      return vec3(0.0);
    }
    isB = 1.0;
    // 立面：暗色，每棟深淺不一，樓層線很淡
    float bt = hash12(vec2(b.y, 3.0));
    vec3 wall = C_INK2 * (0.45 + 0.6 * bt) + C_GRAPHITE * (0.01 + 0.03 * bt);
    vec2 g = (p - org) / P;
    vec2 cell = floor(g), f = fract(g);
    // 窗：格子裡一個小方塊（上下左右留牆）
    float win = smoothstep(0.14, 0.24, f.x) * (1.0 - smoothstep(0.7, 0.8, f.x)) * smoothstep(0.18, 0.28, f.y) * (1.0 - smoothstep(0.68, 0.78, f.y));
    // 兩棟樓的接縫：窗照開（字不能斷），只在牆上留一條很細的暗線
    float seam = 1.0 - 0.5 * (1.0 - smoothstep(0.0, 1.0, p.x - b.z));
    // 屋頂下兩格不開窗（女兒牆）
    win *= step(b.x + P * 2.0, p.y);
    vec3 glass = C_INK * 0.9 + C_GRAPHITE * 0.02 * (1.0 - f.y);
    // 拼字的窗
    float m = 0.0, hrt = 0.0, inBlock = 0.0;
    if (cell.x >= 0.0 && cell.y >= 0.0 && cell.x < grid.x && cell.y < grid.y) {
      inBlock = 1.0;
      // 貼圖沒有預乘：a = 那扇窗亮幾分，r − g = 愛心（紅）的比例
      vec4 s = texture(msk, (cell + 0.5) / grid);
      // 窗戶只有開、關：灰階切成清楚的點陣字（邊緣的窗亮一半，不會糊成一團）
      m = smoothstep(0.28, 0.62, s.a); hrt = clamp(s.r - s.g, 0.0, 1.0);
      // 這扇窗什麼時候亮：前緣一拍推進 cpb 欄，推到了再晚一點點（每扇窗不一樣）
      float ton = t0 + floor(max(0.0, cell.x - c0) / cpb) * bp + hash12(cell + 7.0) * bp * 0.85;
      float on = step(ton, t);
      float heat = exp(-max(0.0, t - ton) / 0.35) * on;
      m *= on * (1.0 - gRefl);
      vec3 warm = mix(C_BONE, C_EMBER, 0.25 + 0.2 * hash12(cell + 2.0));
      vec3 lit = mix(warm, C_ROSE * 1.1, hrt) * (0.95 + 0.25 * bar) + C_SIGNAL * 2.2 * heat * heatK;
      glass = mix(glass, lit, clamp(m * 1.25, 0.0, 1.0));
      // 拼字的窗整扇亮（窗框留很細），字的筆畫才連得起來、夠亮
      float winM = smoothstep(0.02, 0.1, f.x) * (1.0 - smoothstep(0.86, 0.94, f.x)) * smoothstep(0.04, 0.12, f.y) * (1.0 - smoothstep(0.84, 0.92, f.y));
      win = mix(win, winM * step(b.x + P * 2.0, p.y), clamp(m * 1.25, 0.0, 1.0));
    }
    // 平常的窗：字的範圍裡幾乎都關著；範圍外三成亮著，每四拍有幾扇換狀態
    float amb = 0.0;
    float slot = floor((t - t0) / (bp * 4.0) + hash12(cell + 11.0) * 3.0);
    float h = hash12(cell + vec2(slot * 0.37, b.y));
    // 平常亮著的窗：越靠畫面兩邊越多（中間讓給字），而且都是很暗的暖光
    float edge = smoothstep(300.0, 60.0, min(p.x - pan, ${W}.0 - (p.x - pan)));
    float pr = mix(0.05 + 0.08 * edge, 0.0, inBlock);
    if (h < pr) amb = 0.1 + 0.16 * hash12(cell + 5.0);
    vec3 ambc = mix(C_EMBER * 0.8, C_BONE * 0.7, hash12(cell + 9.0)) * amb;
    glass = max(glass, ambc);
    // 這一小節輪到的那棟樓：從一樓往上一層層亮燈（八成的窗）
    if (abs(b.y - chase.x) < 0.5 && p.y > chase.y && inBlock < 0.5) {
      // 亮的是一半的窗、暖暖的暗光（前緣那幾層比較亮）：是場景的事件，不能比留言的字搶眼
      float lit2 = step(hash12(cell + 17.0), 0.45) * chase.z;
      glass = max(glass, mix(C_BONE * 0.5, C_EMBER, 0.45 + 0.3 * hash12(cell + 4.0)) * lit2 * (0.3 + 0.35 * smoothstep(chase.y + 30.0, chase.y, p.y)));
    }
    vec3 col = mix(wall, glass, win) * seam;
    return col;
  }
  // 遠排的樓：只有剪影與很少的暗窗
  vec3 far(vec2 p, out float isF) {
    float cw = 86.0;
    float id = floor((p.x + farPan) / cw);
    float top = 330.0 + 170.0 * hash12(vec2(id, 1.0)) + 40.0 * step(0.8, hash12(vec2(id, 2.0))) * -2.0;
    isF = step(top, p.y);
    if (isF < 0.5) return vec3(0.0);
    vec2 g = (p + vec2(farPan, 0.0)) / vec2(9.0, 8.0);
    float w = step(0.35, fract(g.x)) * step(0.4, fract(g.y));
    float lit = step(0.9, hash12(floor(g) + id));
    return C_INK2 * 0.5 + C_GRAPHITE * 0.02 + (C_EMBER * 0.12) * w * lit;
  }
  vec3 scene(vec2 p) {
    // 天空：上面很暗，接近樓的地方有一層城市的暖光
    vec3 sky = mix(C_INK * 0.6, C_INK2 * 0.8 + C_SIGNAL * 0.03, smoothstep(80.0, 760.0, p.y));
    sky += C_BONE * 0.2 * step(0.9994, hash12(floor(p / 2.0))) * (1.0 - smoothstep(60.0, 320.0, p.y));
    float isF;
    vec3 fc = far(p, isF);
    vec3 col = mix(sky, fc, isF);
    float isB;
    vec3 nc = facade(p + vec2(pan, 0.0), isB);
    col = mix(col, nc, isB);
    // 河岸的高架橋（一條暗的橋面）與電車：車廂一節一節、窗戶亮著，車頭一盞燈
    if (p.y > WATER - 34.0 && p.y < WATER - 22.0) col = C_INK2 * 0.7 + C_GRAPHITE * 0.03;
    if (train.y > 0.0 && p.y > WATER - 52.0 && p.y < WATER - 34.0) {
      float dx = train.x - (p.x + pan);
      if (dx > 0.0 && dx < 720.0) {
        float car = mod(dx, 144.0);
        float body = step(4.0, car);
        vec3 tc = C_INK2 * 1.2 * body;
        float wy = step(WATER - 48.0, p.y) * step(p.y, WATER - 40.0);
        float wx = step(12.0, mod(car, 24.0)) * step(10.0, car) * step(car, 138.0);
        tc += mix(C_BONE, C_EMBER, 0.4) * 0.7 * wy * wx * body;
        col = mix(col, tc, train.y);
      }
    }
    if (train.y > 0.0) {
      float hd = length(vec2(p.x + pan - train.x, p.y - (WATER - 44.0)));
      col += (C_BONE * 1.5 + C_EMBER) * train.y * (exp(-hd / 3.0) + 0.15 * exp(-hd / 30.0));
    }
    return col;
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y); // y 向下
    vec3 col;
    if (p.y < WATER) {
      col = scene(p);
    } else {
      // 河面：倒影（上下顛倒、被波紋拉長、左右搖），越遠越糊越暗
      float d = p.y - WATER;
      // 波紋：一條條橫的水帶左右錯開（帶子比窗格粗很多，倒影才不會出現鋸齒紋）
      float band = floor(d / (6.0 + d * 0.05));
      float wob = (hash12(vec2(band, floor(t * 3.0))) - 0.5) * (4.0 + d * 0.08) + sin(band * 1.7 + t * 2.0) * (3.0 + d * 0.04);
      vec2 q = vec2(p.x + wob, WATER - d * 1.15 - 2.0);
      gRefl = 1.0;
      // 倒影被拉長、糊掉：上下幾個點平均
      vec3 r = vec3(0.0);
      for (int k = 0; k < 5; k++) r += scene(q + vec2(float(k - 2) * 1.7, float(k - 2) * (2.5 + d * 0.03))) * 0.2;
      col = r * (0.26 - 0.16 * smoothstep(0.0, 280.0, d)) + C_INK * 0.4;
      // 水面一條條細細的反光
      col += C_BONE * 0.01 * step(0.97, hash12(vec2(floor(p.y / 3.0), floor((p.x + t * 20.0) / 40.0))));
      // 岸邊一道暗線；右下角 HUD 底下的水面再暗一點（QR 與小字要清楚）
      col *= smoothstep(0.0, 3.0, d);
      col *= 1.0 - 0.55 * smoothstep(1300.0, 1400.0, p.x) * smoothstep(800.0, 850.0, p.y);
    }
    col *= kin;
    fragColor = vec4(col, 1.0);
  }`, {
  msk: { value: null }, grid: { value: new THREE.Vector2(COLS, ROWS) }, org: { value: new THREE.Vector2(TB.x, TB.y) },
  bld: { value: Array.from({ length: NB }, () => new THREE.Vector4()) }, nb: { value: 0 },
  t: { value: 0 }, kin: { value: 1 }, beatIdx: { value: 0 }, blink: { value: 0 }, chase: { value: new THREE.Vector4(-1, 2000, 0, 0) }, train: { value: new THREE.Vector2(-9999, 0) }, pan: { value: 0 }, farPan: { value: 0 }, t0: { value: 0 }, bp: { value: 0.5 }, cpb: { value: 8 }, c0: { value: 0 }, bar: { value: 0 }, heatK: { value: 1 },
});

export default class Skyline extends Scene {
  bg = shared('skyline.bg', BG);
  /** 一扇窗一個像素的小畫布：R = 那扇窗亮幾分（字），G = 一般的字（R − G = 愛心，玫瑰色）。 */
  cv = Object.assign(document.createElement('canvas'), { width: COLS, height: ROWS });
  tex = this.track(maskTexture(this.cv));
  text = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 197 + (this.msg?.id ?? 0) * 7919) >>> 0;
  tFirst = 0;
  bp = 0.5;
  cpb = 8;
  c0 = 0;
  /** 署名（一般的字，寫在拼出來的字的右下）。 */
  sigText = ''; sigSize = 28; sigX = 0; sigY = 0;
  /** 右邊（不拼字）的樓：每個小節線輪流一層層亮燈。 */
  right: number[] = [];
  /** 字全部亮完的時間（冷面註記在那之後出現）。 */
  tDone = 0;
  bars: number[] = [];
  count = 0;
  hasLyrics = false;
  lyrStyle: LyricStyle = { family: FAM_LYR, size: 56, minSize: 48, maxWidth: LYR.w };
  lyrPos = LYR;
  note = '';

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
    const sig = m ? sigOf(m) : '';
    const text = m ? m.text : `${NAME_A} ♥ ${NAME_B}`;
    await loadText(`${T16_TEXT}${text}${sig}${song.title}${song.artist}${lyrics.linesIn(s - 1, e).map((l) => l.text).join('')}本訊息由扇窗戶聯合播出,`);
    const beat = au.beatPeriod(s);
    this.bp = beat;
    this.tFirst = beatAfter(au, s + Math.min(0.2, beat * 0.4));
    this.bars = winBars(au, s, e);

    // ---- 把字排在窗格上（單位 = 一扇窗）：扣掉署名那一排的高度再找字級
    const c = this.cv.getContext('2d', { willReadFrequently: true })!;
    // 字級（單位是窗）：v2 的螢幕字級 ÷ 窗距；照標點斷行。署名太小、拼不出來，用一般的字寫在字的下面（見 render）
    const nch = Array.from(text.replace(/\s/g, '')).length;
    const o = { min: V2.msgMin / P, max: msgMaxFor(text) / P, lineHeight: 1.22, maxLines: 6 };
    const sigRow = m ? 46 / P : 0;
    const fit = fitClauses(c, text, FAM_MSG, COLS - 4, ROWS - sigRow - 2, o) ?? fitText(c, text, FAM_MSG, COLS - 4, ROWS - sigRow - 2, o);
    const blockH = fit.size * 1.02 + (fit.lines.length - 1) * fit.lineHeight + sigRow;
    const top = Math.max(1, Math.round((ROWS - blockH) / 2));
    c.clearRect(0, 0, COLS, ROWS);
    c.textBaseline = 'alphabetic';
    c.font = font(FAM_MSG, fit.size);
    let minX = COLS, maxX = 0;
    fit.lines.forEach((ln, i) => {
      const w = c.measureText(ln).width;
      const x = Math.round((COLS - w) / 2);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x + w);
      this.fillLine(c, ln, x, Math.round(top + fit.size * 0.9 + i * fit.lineHeight), fit.size);
    });
    if (m) {
      // 署名：畫面上的位置（字的右下），字級 26～32
      this.sigSize = sigV2(fit.size * P);
      this.sigText = sig;
      this.sigX = TB.x + maxX * P;
      this.sigY = TB.y + (top + fit.size * 0.9 + (fit.lines.length - 1) * fit.lineHeight) * P + fit.size * P * 0.3 + this.sigSize * 1.2;
    }
    this.tex.needsUpdate = true;
    // 亮了幾扇窗（冷面註記用）
    const d = c.getImageData(0, 0, COLS, ROWS).data;
    for (let i = 0; i < COLS * ROWS; i++) if (d[i * 4 + 3]! > 110) this.count++;
    this.note = `＊本訊息由 ${this.count.toLocaleString('en-US')} 扇窗戶聯合播出`;
    await loadText(this.note);

    // ---- 亮燈的前緣：從字的左端開始，一拍推進一段，最多兩小節（或窗格的四成）推完
    this.c0 = Math.max(0, Math.floor(minX) - 1);
    const span = Math.max(1, Math.ceil(maxX) - this.c0 + 2);
    const bar = au.timeOfBar(au.barAt(this.tFirst) + 1) - this.tFirst;
    // 短的留言一兩拍就亮完，長的最多八拍（兩小節）
    const nBeats = clamp(Math.min(Math.ceil(nch / 3) + 1, Math.floor(Math.min(2 * bar, 0.45 * (e - this.tFirst)) / beat)), 2, 8);
    this.cpb = Math.ceil(span / nBeats);
    this.tDone = this.tFirst + beat * (nBeats + 1);

    // ---- 近排大樓：一棟接一棟，字的範圍裡的樓頂都比字高（樓頂不會切到字）
    const bv = this.bg.u.bld!.value as THREE.Vector4[];
    let x = -60, k = 0;
    while (x < W + 120 && k < NB) {
      const w = 110 + 150 * hash(this.seed, k, 1);
      const inText = x + w > TB.x - 20 && x < TB.x + TB.w + 20;
      // 拼字的樓群比字高；右邊的樓高高低低（有一兩棟很高的），是場景
      const topY = inText ? 236 + 60 * hash(this.seed, k, 2) : x > TB.x + TB.w ? 190 + 330 * hash(this.seed, k, 2) ** 1.4 : 330 + 160 * hash(this.seed, k, 2);
      // 對齊窗格：每棟樓的左右邊落在格線上
      const x0 = TB.x + Math.round((x - TB.x) / P) * P, x1 = TB.x + Math.round((x + w - TB.x) / P) * P;
      bv[k]!.set(x0, x1, TB.y - Math.round((TB.y - topY) / P) * P, k + 1);
      if (x0 > TB.x + TB.w + 20 && x1 < W - 40) this.right.push(k + 1);
      x = x1; k++;
    }
    this.bg.u.nb!.value = k;

    if (m) this.lyrStyle = { family: FAM_LYR, size: lyricV2(fit.size * P), minSize: V2.lyrMin, maxWidth: LYR.w };
    else { this.lyrStyle = { family: FAM_LYR, size: lyricV2(null), minSize: V2.lyrMin, maxWidth: LYR_BIG.w }; this.lyrPos = LYR_BIG; }
  }

  /** 畫一排字到窗格畫布：一般的字畫白色，愛心畫紅色（shader 用 R − G 認出愛心、畫成玫瑰色的窗）。 */
  private fillLine(c: CanvasRenderingContext2D, ln: string, x: number, y: number, size: number) {
    let cx = x;
    for (const part of ln.split(/(♥)/)) {
      if (!part) continue;
      const w = c.measureText(part).width;
      if (part === '♥') drawHeart(c, cx + w / 2, y - size * 0.36, Math.min(w, size) * 0.9, 'rgb(255,0,0)');
      else { c.fillStyle = 'rgb(255,255,255)'; c.fillText(part, cx, y); }
      cx += w;
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, song } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const u = this.bg.u;
    const kin = prog(t, s, s + 0.25);
    // 鏡頭慢慢往右橫移（近樓移 26 px、遠樓只移三成）：字跟著近樓一起動，很慢，讀得舒服
    const pan = 26 * ease.inOutQuad(f.p) - 13;
    let bar = 0;
    for (const tb of this.bars) if (tb <= t && tb >= this.tFirst + 1) bar = Math.max(bar, pulse(t, tb, 0.18));
    u.msk!.value = this.tex; u.t!.value = t; u.kin!.value = kin;
    u.pan!.value = pan; u.farPan!.value = pan * 0.3 + 40;
    const bi = Math.floor(this.ctx.audio.beatAt(t) + 1e-4);
    u.beatIdx!.value = bi; u.blink!.value = pulse(t, this.ctx.audio.timeOfBeat(bi), 0.18);
    u.t0!.value = this.tFirst; u.bp!.value = this.bp; u.cpb!.value = this.cpb; u.c0!.value = this.c0; u.bar!.value = bar; u.heatK!.value = 1;
    // 每個小節線：右邊輪到的那棟樓從一樓往上一層層亮燈（一拍爬到頂），停一拍，再慢慢暗回去
    const ch = u.chase!.value as THREE.Vector4;
    ch.set(-1, 2000, 0, 0);
    if (this.right.length) {
      for (let i = 0; i < this.bars.length; i++) {
        const b0 = this.bars[i]!;
        if (t < b0 || t >= (this.bars[i + 1] ?? e)) continue;
        const id = this.right[Math.floor(hash(this.seed, i, 51) * this.right.length)]!;
        const bv = (u.bld!.value as THREE.Vector4[])[id - 1]!;
        const climb = ease.outCubic(clamp((t - b0) / this.bp));
        const fade = 1 - clamp((t - b0 - 2 * this.bp) / (2 * this.bp));
        ch.set(id, WATER - (WATER - bv.z) * climb, fade, 0);
      }
    }
    // 每兩小節一班高架電車沿著河岸開過去（一小節半開完）
    const tr = u.train!.value as THREE.Vector2;
    tr.set(-9999, 0);
    for (let i = 1; i < this.bars.length; i += 2) {
      const b0 = this.bars[i]!, dur = this.bp * 6;
      if (t < b0 || t > b0 + dur) continue;
      const k = (t - b0) / dur, dir = (i >> 1) % 2 === 0;
      tr.set(dir ? -200 + (W + 900) * k : W + 700 - (W + 900) * k, Math.min(1, Math.sin(Math.PI * k) * 3));
    }
    this.bg.render(renderer, out);

    // ---- 夜空的歌詞與小字
    const L = this.text; L.clear();
    const c = L.ctx;
    c.globalAlpha = kin;
    if (this.hasLyrics) {
      const ly = lyricAt(lyrics, t);
      if (ly) {
        c.save(); c.translate(this.lyrPos.x, this.lyrPos.y);
        drawLyric(c, ly.line, t, this.lyrStyle, layoutLyric(c, ly.line, this.lyrStyle), ly.k);
        c.restore();
      }
    } else {
      c.font = font(F.mono(500), 18); c.letterSpacing = '4px'; c.fillStyle = rgba('ash', 0.6);
      c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`, LYR.x, LYR.y);
      c.letterSpacing = '0px';
    }
    // 署名：字拼完就寫上（一般的字，跟著樓一起橫移）
    if (this.sigText) {
      const sk = prog(t, this.tDone - this.bp, this.tDone);
      if (sk > 0) {
        c.font = font(F.hei(500), this.sigSize); c.fillStyle = rgba('bone', 0.82 * sk); c.textAlign = 'right';
        c.fillText(this.sigText, this.sigX - pan, this.sigY);
        c.textAlign = 'left';
      }
    }
    // 冷面註記：字拼完之後，右上角一行小字（沒有留言時是邀請）
    const done = this.tDone;
    const nk = prog(t, Math.min(done, e - 1.5), Math.min(done, e - 1.5) + 0.6);
    if (nk > 0) {
      c.font = font(F.hei(500), 20); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.62 * nk); c.textAlign = 'right';
      c.fillText(this.msg ? this.note : T16_INVITE, 1760, 118);
      c.textAlign = 'left'; c.letterSpacing = '0px';
    }
    comp.draw(renderer, L.upload(), out);
    // 色差調低：一格一格的小窗在色差下會出現彩色的疊紋
    return { bloom: 0.75, vignette: 0.55, halation: 0.3, ca: 0.4, zoom: 1 + 0.03 * ease.inOutQuad(f.p) };
  }

  override dispose() { super.dispose(); this.cv.width = this.cv.height = 0; }
}

/** 窗格畫布的貼圖：一格一格取樣（最近點、不要 mipmap），不翻轉（第 0 列 = 最上面）。 */
function maskTexture(cv: HTMLCanvasElement) {
  const tx = new THREE.CanvasTexture(cv);
  tx.colorSpace = THREE.NoColorSpace;
  tx.flipY = false;
  tx.minFilter = THREE.NearestFilter;
  tx.magFilter = THREE.NearestFilter;
  tx.generateMipmaps = false;
  tx.premultiplyAlpha = false;
  return tx;
}
