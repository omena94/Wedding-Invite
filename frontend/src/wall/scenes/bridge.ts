// 鵲橋（暗）：七夕的意象。夜空裡一條斜斜的銀河，兩岸各一顆亮星（左：織女、右：牛郎）。
//  - 第一個拍點起，喜鵲從畫面外一對一對飛進來（半拍一對，左岸一隻、右岸一隻，飛的時候拖著一道訊號色的光），
//    翅膀張開、翅尖搭著翅尖，從兩岸往中間搭成一座拱橋；最後一對在小節線上於正中間會合，兩顆星同時亮一下。
//  - 主打留言寫在橋下（沿著橋拱的弧線，兩三行）：哪一段橋搭好了，那一段的字才出現。
//  - 橋搭好之後，每個小節線有一點火花（仙女棒）從織女沿著橋跑到牛郎，經過的字亮一下。
//  - 歌詞在下方一行（逐字跟唱）；左上角冷面註記「鵲橋施工進度：12／14 隻喜鵲到位　通行對象：限兩人」。
//  - 沒有主打留言：橋下寫「一年只見一次太少了，你們要天天見。」＋邀請；純音樂：下方寫歌名。
// 畫法：夜空、銀河、星點、兩顆亮星是一個 shader；喜鵲與字畫在 Canvas2D（每格重畫）；飛行的光與火花是 LineBatch（加亮、會發光）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, layout, loadText, measure } from '../engine/type';
import { rgba, mixRgba, LIN } from '../engine/palette';
import { clamp, ease, prog, lerp, hash, TAU } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, beatAfter, barAfter, signature, sparkHead, sparkParticles, COUPLE_ZH, type LyricStyle } from './_motifs';
import { no3, fitV2, slowPush, INVITE_SMALL, type Rect, SYMBOLS } from './_t20';
import { lyricV2, sigV2, msgMaxFor, V2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'water', paper: false, energy: [0.2, 0.85], bars: [4, 8] };

/** 橋拱：一段大圓弧（圓心在畫面下方很遠），兩端落在兩顆星上。 */
const ARC = { cx: 760, apex: 452, R: 2100, half: 560 };
const ARC_CY = ARC.apex + ARC.R;
const TH_END = Math.asin(ARC.half / ARC.R);
/** 兩顆星（織女在左、牛郎在右），在橋的兩端下面一點。 */
const STAR_L = { x: ARC.cx - ARC.half - 40, y: 0 }, STAR_R = { x: ARC.cx + ARC.half + 40, y: 0 };
STAR_L.y = STAR_R.y = ARC_CY - Math.sqrt(ARC.R * ARC.R - (ARC.half + 40) ** 2) + 26;
/** 喜鵲的數量（左右各半）。 */
const N_BIRD = 14;
/**
 * 橋下的字：第一行基線離橋頂多遠、最寬多寬（標準 v2 的留言區 ≤ 860 寬）。算過：寬 940 以內，最外側的字頂都在喜鵲尾巴之下
 * （橋在兩端比中間低 d²/2R，字的弧比橋緩，所以兩端的間隙最小）。
 */
const TXT = { gap: 130, maxW: 820 };
/** 字那幾行的弧的半徑：比橋大，字只微微跟著橋拱彎（兩端轉 6° 左右）。 */
const TXT_R = 4000;
const LYR = { x: 150, y: 918, maxW: 1150 };
const LYR_STYLE: LyricStyle = { family: F.archivo(100, 700), size: 60, minSize: 48, maxWidth: LYR.maxW, align: 'left' };
const MSG_FAM = F.ming(700);
const NO_MSG = '一年只見一次太少了，你們要天天見。';
const NO_MSG_ROWS = ['一年只見一次太少了，', '你們要天天見。'];
const NOTE2 = '通行對象：限兩人';

const FRAG = /* glsl */ `
uniform float uT, uTw, uIn, uPulseL, uPulseR;
uniform vec4 uClear;   // 字的範圍：銀河在這裡暗一點
uniform vec2 uStarL, uStarR;
float starLayer(vec2 p, float cell, float dens, float seed) {
  vec2 id = floor(p / cell), f = fract(p / cell) - 0.5;
  float h = hash12(id + seed);
  vec2 o = (hash22(id + seed * 1.7) - 0.5) * 0.7;
  float r = length(f - o) * cell;
  float on = step(1.0 - dens, h);
  float tw = 0.75 + 0.25 * sin(uT * (2.0 + 5.0 * hash12(id + 3.1)) + h * 40.0) + uTw * 0.6 * step(0.8, hash12(id + 9.0));
  return on * smoothstep(1.6, 0.0, r) * (0.35 + 0.65 * h) * tw;
}
void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  vec3 col = C_INK * (0.9 + 0.1 * smoothstep(1080.0, 0.0, p.y));
  // 銀河：一條斜的帶子（右上往左下），裡面是雲氣與暗的塵埃帶
  vec2 a = vec2(1180.0, -80.0), b = vec2(430.0, 1160.0);
  vec2 ab = b - a; float h = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
  float d = length(p - a - ab * h);
  float band = exp(-d * d / (2.0 * 190.0 * 190.0));
  // 銀河是一條河：雲氣與塵埃沿著河道慢慢往下游流（右上 → 左下）
  vec2 pf = p - normalize(ab) * uT * 13.0;
  float cloud = 0.55 + 0.45 * fbm(pf / 210.0, 5);
  float dust = smoothstep(0.1, 0.5, fbm(pf / 130.0 + 7.3, 4)) * exp(-d * d / (2.0 * 70.0 * 70.0));
  float mw = band * cloud * (1.0 - 0.75 * dust);
  vec2 q = abs(p - (uClear.xy + uClear.zw * 0.5)) - uClear.zw * 0.5;
  float clearK = 1.0 - 0.55 * (1.0 - smoothstep(-20.0, 90.0, max(q.x, q.y)));
  col += (C_GRAPHITE * 0.15 + C_SIGNAL * 0.012 + C_BONE * 0.035 * band) * mw * clearK * uIn;
  // 星點：銀河裡密、外面疏
  float st = starLayer(p, 26.0, 0.10 + 0.4 * band, 1.0) + starLayer(p + 13.0, 61.0, 0.3, 7.0) * 1.4;
  col += C_BONE * st * 0.55 * mix(1.0, clearK, 0.7) * uIn;
  // 兩顆亮星：核心、光暈、四道細光芒；火花到的時候亮一下
  for (int i = 0; i < 2; i++) {
    vec2 c = i == 0 ? uStarL : uStarR;
    float pu = i == 0 ? uPulseL : uPulseR;
    vec2 v = p - c; float r = length(v);
    float core = exp(-r * r / 18.0) * 3.2;
    float halo = exp(-r / (26.0 + 18.0 * pu)) * (0.28 + 0.5 * pu);
    float L = 34.0 + 40.0 * pu;
    float spikes = (exp(-v.x * v.x / 2.0) * exp(-v.y * v.y / (2.0 * L * L)) + exp(-v.y * v.y / 2.0) * exp(-v.x * v.x / (2.0 * L * L))) * (0.45 + 0.8 * pu);
    col += (C_EMBER * core + C_SIGNAL * (halo + spikes)) * uIn;
  }
  fragColor = vec4(col, 1.0);
}`;

const BG = () => new FSPass(FRAG, {
  uT: { value: 0 }, uTw: { value: 0 }, uIn: { value: 1 }, uPulseL: { value: 0 }, uPulseR: { value: 0 },
  uClear: { value: new THREE.Vector4() }, uStarL: { value: new THREE.Vector2(STAR_L.x, STAR_L.y) }, uStarR: { value: new THREE.Vector2(STAR_R.x, STAR_R.y) },
});

/** 弧上角度 θ、半徑 r 的點（θ = 0 在正中間，往右為正）。 */
const onArc = (th: number, r = ARC.R) => ({ x: ARC.cx + Math.sin(th) * r, y: ARC_CY - Math.cos(th) * r });

interface Bird { th: number; land: number; fly: number; from: { x: number; y: number }; side: number; s: number }
interface Glyph { ch: string; x: number; y: number; ang: number; thB: number; w: number; t: number }

export default class Bridge extends Scene {
  bg = shared('bridge.bg', BG);
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(3000, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 83 + (this.msg?.id ?? 0) * 31) >>> 0;
  b0 = 0;
  birds: Bird[] = [];
  glyphs: Glyph[] = [];
  size = 52;
  sig: { text: string; x: number; y: number; size: number; t: number } | null = null;
  tag = '';
  invite: { x: number; y: number; t: number } | null = null;
  done = 0;
  title = '';
  avoid: Rect[] = [];
  clear: Rect = [0, 0, 0, 0];
  /** 歌詞的樣式：有留言時比留言小一號，沒有留言時歌詞是焦點。 */
  lyr: LyricStyle = LYR_STYLE;

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.b0 = beatAfter(au, s + 0.05);
    const beat = au.beatPeriod(this.b0);
    this.title = `♪  ${song.title}${song.artist ? '  —  ' + song.artist : ''}`;
    const text = m ? m.text : NO_MSG;
    const sigText = m ? (m.couple ? `—— ${COUPLE_ZH}` : signature(m.name)) : '';
    const lines = lyrics.linesIn(s - 2, e + 1);
    await loadText(text + sigText + NO_MSG + INVITE_SMALL + NOTE2 + this.title + lines.map((l) => l.text).join('') + '鵲橋施工進度：／隻喜鵲到位織女牛郎FROM THE COUPLE · 新人No.0123456789' + SYMBOLS);

    // ---- 喜鵲：一對一對（左一隻、右一隻）半拍一對，從兩岸往中間；最後一對落在第一個拍點後的小節線（窗格太短就早一點）
    const pairs = N_BIRD / 2;
    const meet = Math.min(barAfter(au, this.b0 + beat * 2.5), this.b0 + Math.max(beat * 2, (e - this.b0) * 0.45));
    const step = (meet - this.b0) / (pairs - 1);
    const slot = (2 * TH_END) / N_BIRD;
    for (let k = 0; k < pairs; k++) {
      const land = this.b0 + k * step;
      for (const side of [-1, 1]) {
        const th = side * (TH_END - slot * (k + 0.5));
        const p = onArc(th);
        const h1 = hash(this.seed, k, side);
        // 從畫面外（同一側的上方或側邊）飛進來
        const from = { x: p.x + side * (520 + 300 * h1), y: p.y - 380 - 260 * hash(this.seed, k, side, 2) };
        this.birds.push({ th, land, fly: 0.75 + 0.2 * h1, from, side, s: 1.08 + 0.1 * hash(this.seed, k, 7) });
      }
    }
    this.done = meet;

    // ---- 橋下的字：每一行是一段很緩的弧（半徑比橋大很多，字最多轉 5° 左右，讀起來還是平的），行內置中
    const c = this.layer.ctx;
    const lh = 1.34;
    // 標準 v2：寫字的那一塊 ≤ 820×約 300（連署名）；署名的高度先照字級上限扣掉，永遠在最後一行下面。
    // 沒有主打留言時歌詞是焦點：橋下的句子小一點
    const reserve = m ? sigV2(msgMaxFor(text)) + 20 : 50;
    const fit = fitV2(c, text, MSG_FAM, TXT.maxW, 300 - reserve, { lineHeight: lh, maxLines: 4, max: m ? undefined : 44, lines: m ? undefined : NO_MSG_ROWS });
    const size = fit.size, rows = fit.lines;
    this.size = size;
    this.lyr = { ...LYR_STYLE, size: lyricV2(m ? size : null), minSize: V2.lyrMin };
    const y0 = ARC.apex + TXT.gap;
    let maxRow = 0;
    rows.forEach((row, i) => {
      const yi = y0 + i * size * lh;
      const lay = layout(row, MSG_FAM, size);
      maxRow = Math.max(maxRow, lay.width);
      for (const g of lay.glyphs) {
        const th = (g.x + g.w / 2 - lay.width / 2) / TXT_R;
        const x = ARC.cx + Math.sin(th) * TXT_R, y = yi + TXT_R * (1 - Math.cos(th));
        // 這個字上面那一段橋搭好（最近的那隻喜鵲落下）之後出現
        const thB = Math.asin(clamp((x - ARC.cx) / ARC.R, -1, 1));
        const b = this.birds.reduce((best, bd) => (Math.abs(bd.th - thB) < Math.abs(best.th - thB) ? bd : best), this.birds[0]!);
        this.glyphs.push({ ch: g.ch, x, y, ang: th, thB, w: g.w, t: b.land + 0.08 });
      }
    });
    const lastY = y0 + (rows.length - 1) * size * lh;
    let bottom = lastY + size * 0.3;
    if (m) {
      const ss = sigV2(size);
      const sw = measure(sigText, F.hand(700), ss);
      this.sig = { text: sigText, x: ARC.cx + maxRow / 2 - sw, y: lastY + size * 0.36 + ss * 1.15, size: ss, t: this.done + 0.2 };
      bottom = this.sig.y + 12;
      if (m.couple) this.tag = 'FROM THE COUPLE · 新人';
    } else {
      this.invite = { x: ARC.cx, y: lastY + size * 0.4 + 40, t: this.done + 0.25 };
      bottom = this.invite.y + 12;
    }

    // ---- 範圍：字、歌詞
    const top = y0 - size * 0.95;
    const halfW = Math.max(maxRow, m ? 0 : measure(INVITE_SMALL, F.hei(500), 26)) / 2 + 30;
    this.clear = [ARC.cx - halfW, top - 10, halfW * 2, bottom - top + 20];
    this.avoid = [[ARC.cx - ARC.half - 90, ARC.apex - 90, ARC.half * 2 + 180, bottom - ARC.apex + 110], [LYR.x - 20, LYR.y - 90, LYR.maxW + 40, 120]];
    for (const line of lines) layoutLyric(c, line, this.lyr);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const u = this.bg.u;
    u.uT!.value = t;
    u.uTw!.value = f.a.hat;
    u.uIn!.value = prog(t, s, s + 0.4);
    (u.uClear!.value as THREE.Vector4).set(...this.clear);
    // 會合那一下兩顆星一起亮；之後每個小節線有一點火花從織女跑到牛郎
    const spark = this.sparkAt(t);
    const meetP = Math.pow(0.5, Math.max(0, t - this.done) / 0.35) * (t >= this.done ? 1 : 0);
    u.uPulseL!.value = Math.max(meetP, spark ? Math.pow(0.5, spark.age / 0.2) * (spark.age >= 0 ? 1 : 0) : 0);
    u.uPulseR!.value = Math.max(meetP, spark && spark.q >= 1 ? Math.pow(0.5, (spark.age - spark.dur) / 0.25) : 0);
    this.bg.render(renderer, out);

    const L = this.layer;
    L.clear();
    const c = L.ctx;
    this.glow.clear();
    this.drawBirds(c, t);
    this.drawText(c, t, spark);
    this.drawLyrics(c, t);
    this.drawNotes(c, t);
    comp.draw(renderer, L.upload(), out);
    if (spark && spark.q < 1) {
      const sp = spark;
      const pos = (tt: number) => { const q = ease.inOutCubic(clamp((tt - sp.t0) / sp.dur)); return onArc(lerp(-TH_END - 0.02, TH_END + 0.02, q), ARC.R + 4); };
      sparkParticles(this.glow, t, (tt) => (tt >= sp.t0 ? pos(tt) : null), { rate: 90, life: 0.35, speed: 180, seed: this.seed });
      const p = pos(t);
      sparkHead(this.glow, p.x, p.y, t, 0.9);
    }
    if (this.glow.count) this.glow.render(renderer, out);
    void au;
    return { bloom: 0.7, vignette: 0.45, popupAvoid: this.avoid, zoom: slowPush(f.p) };
  }

  /** 這一格有沒有喜鵲在跳：橋搭好之後，每逢雙數小節輪到一隻（0.7 秒）。 */
  private hopAt(t: number): { bird: Bird; q: number } | null {
    const au = this.ctx.audio;
    const b2 = Math.floor(au.barAt(t) / 2) * 2, tb = au.timeOfBar(b2) + au.beatPeriod(au.timeOfBar(b2));
    const q = (t - tb) / 0.7;
    if (tb < this.done + 0.3 || q < 0 || q > 1) return null;
    return { bird: this.birds[Math.floor(hash(b2, this.seed, 11) * this.birds.length)]!, q };
  }

  /** 橋搭好之後，每個小節線一點火花（跑 0.6 小節）。 */
  private sparkAt(t: number) {
    const au = this.ctx.audio;
    if (t < this.done + 0.05) return null;
    const bi = Math.floor(au.barAt(t));
    const t0 = au.timeOfBar(bi);
    if (t0 < this.done - 0.01) return null;
    const dur = Math.max(0.5, (au.timeOfBar(bi + 1) - t0) * 0.6);
    const age = t - t0;
    return { t0, dur, age, q: clamp(age / dur) };
  }

  /**
   * 喜鵲（從下面往上看：翅膀往兩邊張開、頭朝上、長尾巴朝下）。黑色的身體與翅膀、紙白的肚子與翅膀上的白斑、紙白的細輪廓；
   * 飛的時候翅膀上下拍、拖著一道訊號色的光；落下之後翅膀攤平，每一拍輕輕顫一下。
   */
  private drawBirds(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const bph = au.beatAt(t) % 1;
    const sig = LIN.signal;
    for (const b of this.birds) {
      const t0 = b.land - b.fly;
      if (t < t0) continue;
      const q = clamp((t - t0) / b.fly);
      const target = onArc(b.th);
      let x: number, y: number, ang: number, flap: number;
      if (q < 1) {
        const k = ease.outCubic(q);
        const mx = lerp(b.from.x, target.x, 0.5) + b.side * 60, my = Math.min(b.from.y, target.y) - 40;
        x = (1 - k) * (1 - k) * b.from.x + 2 * (1 - k) * k * mx + k * k * target.x;
        y = (1 - k) * (1 - k) * b.from.y + 2 * (1 - k) * k * my + k * k * target.y;
        ang = lerp(-b.side * 0.5, b.th, k);
        flap = Math.sin((t - t0) * 22) * (1 - k * 0.8);
        // 飛行的光：最近 0.18 秒的路徑
        for (let i = 0; i < 6; i++) {
          const a0 = ease.outCubic(clamp((t - 0.03 * (i + 1) - t0) / b.fly)), a1 = ease.outCubic(clamp((t - 0.03 * i - t0) / b.fly));
          const P = (kk: number) => ({ x: (1 - kk) * (1 - kk) * b.from.x + 2 * (1 - kk) * kk * mx + kk * kk * target.x, y: (1 - kk) * (1 - kk) * b.from.y + 2 * (1 - kk) * kk * my + kk * kk * target.y + 10 });
          const pa = P(a0), pb = P(a1);
          const I = 2.4 * (1 - i / 6) * (1 - q);
          this.glow.seg2(pa.x, pa.y, pb.x, pb.y, 2.2 * (1 - i / 7), [sig[0] * I, sig[1] * I, sig[2] * I], 1);
        }
      } else {
        x = target.x; y = target.y; ang = b.th;
        flap = -0.12 * Math.sin(Math.PI * ease.outCubic(bph)) * (1 + 0.5 * hash(b.th * 100, 3));
        // 橋搭好之後，每兩小節輪到一隻喜鵲跳起來拍拍翅膀再落回原位（窗格中段的小事件）
        const hop = this.hopAt(t);
        if (hop && hop.bird === b) {
          const k = Math.sin(Math.PI * hop.q);
          y -= 26 * k; x += Math.sin(b.th) * -26 * k;
          flap = Math.sin(hop.q * Math.PI * 5) * 0.9 * k;
        }
      }
      this.bird(c, x, y, ang, b.s, flap);
    }
  }

  private bird(c: CanvasRenderingContext2D, x: number, y: number, ang: number, s: number, flap: number) {
    const ink = rgba('ink', 1), line = rgba('bone', 0.7), white = rgba('bone', 0.9);
    c.save();
    c.translate(x, y);
    c.rotate(ang);
    c.scale(s, s);
    c.lineJoin = 'round'; c.lineCap = 'round';
    c.lineWidth = 1.1;
    // 長尾巴（往下，尾端圓、中間一條羽軸）
    c.beginPath();
    c.moveTo(-3.5, 8);
    c.bezierCurveTo(-7, 26, -7, 42, 0, 50);
    c.bezierCurveTo(7, 42, 7, 26, 3.5, 8);
    c.closePath();
    c.fillStyle = ink; c.fill();
    c.strokeStyle = line; c.stroke();
    c.beginPath(); c.moveTo(0, 12); c.lineTo(0, 45); c.strokeStyle = rgba('bone', 0.3); c.stroke();
    // 翅膀：內側黑、外側的飛羽是白的（喜鵲從下面看最明顯的特徵），翅尖四根分開的黑邊飛羽
    for (const side of [-1, 1]) {
      const lift = 24 * flap;
      const tip = { x: side * 60, y: -6 - lift };
      const wing = new Path2D();
      wing.moveTo(side * 5, -9);
      wing.bezierCurveTo(side * 22, -16 - lift * 0.5, side * 42, -14 - lift * 0.9, tip.x, tip.y);
      // 翅尖：四根手指
      for (let k = 0; k < 4; k++) {
        const fx = side * (60 - k * 6), fy = tip.y + 2 + k * 3.2;
        wing.lineTo(fx + side * 1.5, fy + 5);
        wing.lineTo(side * (56 - k * 6), fy + 2.5);
      }
      wing.bezierCurveTo(side * 34, 4 - lift * 0.4, side * 18, 7, side * 5, 6);
      wing.closePath();
      c.fillStyle = ink; c.fill(wing);
      // 白色的飛羽區：翅膀外側一半（夾在黑色的前緣與翅尖之間）
      c.save();
      c.clip(wing);
      c.beginPath();
      // 飛羽往外往後斜，白斑的邊也跟著斜（不然像一條橫紋）
      c.moveTo(side * 24, -26 - lift); c.lineTo(side * 44, -26 - lift); c.lineTo(side * 56, 14); c.lineTo(side * 38, 14);
      c.closePath();
      c.fillStyle = white; c.fill();
      c.restore();
      c.strokeStyle = line; c.stroke(wing);
    }
    // 身體：黑背、白肚子、黑頭
    c.beginPath(); c.ellipse(0, 0, 6.5, 12, 0, 0, TAU);
    c.fillStyle = ink; c.fill(); c.strokeStyle = line; c.stroke();
    c.beginPath(); c.ellipse(0, 3, 3.6, 6.5, 0, 0, TAU);
    c.fillStyle = white; c.fill();
    c.beginPath(); c.arc(0, -14, 5, 0, TAU);
    c.fillStyle = ink; c.fill(); c.stroke();
    c.beginPath(); c.moveTo(-1.4, -18.5); c.lineTo(0, -23); c.lineTo(1.4, -18.5);
    c.strokeStyle = line; c.stroke();
    c.restore();
  }

  /** 橋下的留言（沿著很緩的弧）；喜鵲落下時字從牠腳下落下來，火花經過的字亮一下。 */
  private drawText(c: CanvasRenderingContext2D, t: number, spark: { t0: number; dur: number; q: number } | null) {
    const size = this.size;
    c.save();
    c.textBaseline = 'alphabetic';
    c.font = font(MSG_FAM, size);
    const sparkTh = spark ? lerp(-TH_END - 0.02, TH_END + 0.02, ease.inOutCubic(spark.q)) : -9;
    for (const g of this.glyphs) {
      const a = prog(t, g.t, g.t + 0.3);
      if (a <= 0) continue;
      const drop = (1 - ease.outCubic(prog(t, g.t, g.t + 0.35))) * 26;
      // 火花剛經過：暖一下（訊號色），退回紙白
      const passed = spark && spark.q > 0 && sparkTh >= g.thB ? Math.max(0, 1 - (sparkTh - g.thB) / 0.12) : 0;
      c.save();
      c.translate(g.x, g.y - drop);
      c.rotate(g.ang);
      c.globalAlpha = a;
      c.fillStyle = g.ch === '♥' ? rgba('rose') : passed > 0 ? mixRgba('bone', 'signal', passed) : rgba('bone', 0.96);
      c.fillText(g.ch, -g.w / 2, 0);
      c.restore();
    }
    if (this.sig && t >= this.sig.t) {
      const sg = this.sig;
      c.font = font(F.hand(700), sg.size);
      c.globalAlpha = prog(t, sg.t, sg.t + 0.4);
      c.fillStyle = rgba('signal', 0.9);
      c.fillText(sg.text, sg.x, sg.y);
    }
    if (this.invite && t >= this.invite.t) {
      c.globalAlpha = prog(t, this.invite.t, this.invite.t + 0.4);
      c.font = font(F.hei(500), 26);
      c.letterSpacing = '2px';
      c.fillStyle = rgba('ash', 0.95);
      c.textAlign = 'center';
      c.fillText(INVITE_SMALL, this.invite.x, this.invite.y);
      c.textAlign = 'left';
      c.letterSpacing = '0px';
    }
    c.restore();
  }

  /** 下方的歌詞（逐字跟唱）。 */
  private drawLyrics(c: CanvasRenderingContext2D, t: number) {
    const { lyrics } = this.ctx;
    if (!lyrics.has) {
      c.save();
      c.globalAlpha = prog(t, this.b0, this.b0 + 0.5) * 0.85;
      c.font = font(F.mono(500), 22); c.letterSpacing = '4px'; c.fillStyle = rgba('ash');
      c.fillText(this.title.toUpperCase(), LYR.x, LYR.y);
      c.restore();
      return;
    }
    const ly = lyricAt(lyrics, t);
    if (!ly) return;
    const lay = layoutLyric(c, ly.line, this.lyr);
    c.save();
    // 貼底：最後一排（有韓文原文時是原文最後一排）的基線在 LYR.y；沒有原文時 height - size 就是中文多出來的幾排
    c.translate(LYR.x, LYR.y - (lay.height - lay.size));
    drawLyric(c, ly.line, t, this.lyr, lay, ly.k);
    c.restore();
  }

  /** 左上角的施工進度、兩顆星的名字。 */
  private drawNotes(c: CanvasRenderingContext2D, t: number) {
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.1, this.ctx.start + 0.5);
    const landed = this.birds.filter((b) => t >= b.land).length;
    c.font = font(F.mono(500), 16);
    c.letterSpacing = '3px';
    c.fillStyle = rgba('ash', 0.75);
    c.fillText(`鵲橋施工進度：${landed}／${N_BIRD} 隻喜鵲到位${landed >= N_BIRD ? '　完工' : ''}`, 150, 150);
    c.fillStyle = rgba('ash', 0.6);
    c.fillText(`${NOTE2}${this.msg ? '　' + no3(this.msg.n) : ''}`, 150, 180);
    if (this.tag) { c.fillStyle = rgba('signal', 0.9); c.fillText(this.tag, 150, 210); }
    // 星名：星的下面
    for (const [st, zh, en] of [[STAR_L, '織女', 'VEGA · α LYR'], [STAR_R, '牛郎', 'ALTAIR · α AQL']] as const) {
      c.textAlign = 'center';
      c.font = font(F.serif(400, true), 22);
      c.letterSpacing = '2px';
      c.fillStyle = rgba('bone', 0.7);
      c.fillText(zh, st.x, st.y + 58);
      c.font = font(F.mono(500), 13);
      c.letterSpacing = '2px';
      c.fillStyle = rgba('ash', 0.7);
      c.fillText(en, st.x, st.y + 86);
    }
    c.restore();
  }
}
