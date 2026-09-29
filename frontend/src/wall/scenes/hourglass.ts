// 沙漏（暗）：慢歌用。左邊一個版畫線條的玻璃沙漏（上下兩塊木板、三根柱子，慢慢繞著自己轉，看得出是立體的），
// 沙從上半部流到下半部；每隔一兩個小節線（慢歌一小節、快一點的歌兩小節）整個沙漏「翻過來」（outBack：轉過頭一點再停住），
// 沙又開始往下流。
//  - 右邊是一塊黑色的沙盤：主打留言是沙堆出來的。每個字上方一道細細的沙柱，沙落到目前的沙面再往兩旁滑開，
//    由下往上把字形填滿（像把沙倒進模子），剛落下的沙粒是熱的訊號色，一下子冷卻成沙色。
//    字落在拍點上開始倒；兩小節內倒完，留給大家讀。
//  - 歌詞在沙盤上方（逐字跟唱）；沙漏下面是一本正經的讀數與註腳。
//  - 沒有留言：沙堆成「宣文♥孟庭」，下面一行邀請。純音樂：上方寫歌名。
// 畫法：底（全螢幕 shader：墨色、淡淡的聚光）→ 沙漏裡的沙（Canvas2D，旋轉）→ 玻璃與木架（LineBatch 細線，自己投影的 3D 點）
// → 沙盤的沙粒（LineBatch，一粒一段）→ 字（Canvas2D）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash, mulberry32, TAU } from '../engine/util';
import type { FitResult } from '../engine/text';
import { lyricAt, beatAfter, signature, fillWithHearts, COUPLE_ZH } from './_motifs';
import { stagger, pad3, mono, tag, type Rect } from './_t11';
import { lyricLine, lyricRows, glyphPoints, type GlyphPts } from './_t12';
import { V2, msgMaxFor, lyricV2, sigV2, fitClauses } from './_v2';
import { fitText } from '../engine/text';

export const spec: PlateSpecDecl = { group: 'type', family: 'science', paper: false, energy: [0, 0.6], bars: [6, 16], weight: 1 };

// ---------------------------------------------------------------- 版面
/** 沙漏：中心、半高、最寬的半徑、瓶頸、俯視的傾角。 */
// 標準 v2：沙漏是主視覺，放大一點
const HG = { x: 390, y: 530, h: 330, rb: 142, neck: 8, tilt: 0.3 };
/** 沙盤（留言）與歌詞。 */
/** 即時小卡停用之後右邊空出來了：沙盤一路到右邊（QR 在 y ≥ 830，沙盤在它上面）。 */
// 沙盤上寫字的範圍（標準 v2：寬 ≤ 860、高 ≤ 430），在沙漏右邊、QR 上面
const TB = { x: 780, y: 400, w: 860, h: 400 };
const LYR = { x: 780, base: 214, w: 960, size: 52 };
// 沙粒排的字用粗黑體：字級照標準變小之後，細的字用沙粒排出來讀不清楚
const FAM_MSG = F.hei(900);
const INVITE = '掃描右下角 QR code，你的祝福也會一粒一粒堆起來。';
const FOOT = '＊本沙漏可以無限次翻轉。';
/** 沙粒下落的重力（px/s²）、漏斗口在那一行字頂上多高。 */
const G = 5200, POUR = 46;

/** 沙漏的輪廓：u = 0 瓶頸、1 蓋子，回傳半徑。 */
const prof = (u: number) => HG.neck + (HG.rb - HG.neck) * Math.pow(Math.sin(Math.PI * Math.min(1, Math.abs(u)) * 0.78), 1.15);

const BG = () => new FSPass(/* glsl */ `
  uniform float k; uniform vec2 spot; uniform float kick;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 col = C_INK + (C_INK2 - C_INK) * (0.35 + 0.35 * fbm(p / 600.0, 3));
    // 沙漏上的聚光（很淡）與沙盤的木框
    float sp = exp(-pow(length((p - spot) / vec2(300.0, 420.0)), 2.0));
    col += C_BONE * 0.035 * sp * (1.0 + 0.4 * kick);
    col += C_SIGNAL * 0.012 * sp;
    fragColor = vec4(col * mix(1.0, 1.0, k), 1.0);
  }`, { k: { value: 1 }, spot: { value: new THREE.Vector2(HG.x, HG.y) }, kick: { value: 0 } });

export default class Hourglass extends Scene {
  bg = shared('hourglass.bg', BG);
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 字（歌詞、署名、讀數）另一層：要疊在沙盤的沙粒上面。 */
  textLayer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glass = this.track(new LineBatch(3000, { screen2D: true, blend: 'add' }));
  sand = this.track(new LineBatch(20000, { screen2D: true, blend: 'normal' }));
  hotSand = this.track(new LineBatch(9000, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 577 + (this.msg?.id ?? 0) * 61) >>> 0;
  fit: FitResult | null = null;
  pts: GlyphPts | null = null;
  /** 每粒沙：落地時間、落地位置的抖動、顏色深淺。 */
  tl = new Float32Array(0); jx = new Float32Array(0); tone = new Float32Array(0);
  /** 每個字開始倒、倒完的時間。 */
  g0: number[] = []; g1: number[] = [];
  flips: number[] = [];
  period = 2;
  tFirst = 0;
  sig = ''; sigT = Infinity; sigX = 0; sigY = 0;
  lyricsInWindow = false;
  avoid: Rect[] = [];
  grain: CanvasPattern | null = null;
  /** 歌詞字級：有留言時比沙堆的字小一截（一格只有一個焦點）。 */
  lyrSize: number = LYR.size;
  sigSize = 30;
  /** 沙粒的直徑（跟取樣間距成比例：字大沙粒也大一點）。 */
  dot = 2.5;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const text = m ? m.text : COUPLE_ZH.replace(/\s*&\s*/, '♥');
    this.sig = m ? (m.couple ? '—— 新郎新娘' : signature(m.name)) : '';
    await loadText(`${text}${this.sig}${INVITE}${FOOT}${song.title}${song.artist}次翻轉每小節沙漏♪ NOW POURING　本曲 No. · 第`);
    const beat = au.beatPeriod(s);
    this.tFirst = beatAfter(au, s + Math.min(0.2, beat * 0.4));
    // ---- 翻轉：慢歌每小節、快一點的歌每兩小節（都在小節線上）
    const barLen = au.timeOfBar(au.barAt(this.tFirst) + 1) - this.tFirst;
    const every = barLen >= 2.4 ? 1 : 2;
    this.flips = [];
    for (let i = Math.ceil(au.barAt(this.tFirst) + 0.2); au.timeOfBar(i) < e - 0.6; i += every) this.flips.push(au.timeOfBar(i));
    this.period = barLen * every;

    // ---- 沙盤：字排好、光柵化成沙粒
    const c = this.layer.ctx;
    // 標準 v2：字級依字數的上限往下找；可用高度先扣掉署名那一行
    const boxH = m ? TB.h - 60 : TB.h - 110;
    const fo = { min: V2.msgMin, max: msgMaxFor(text), lineHeight: 1.3, maxLines: 5 };
    const fit = this.fit = fitClauses(c, text, FAM_MSG, TB.w, boxH, fo) ?? fitText(c, text, FAM_MSG, TB.w, boxH, fo);
    this.lyrSize = lyricV2(m ? fit.size : null);
    this.sigSize = sigV2(fit.size);
    const top = TB.y + (boxH - fit.height) / 2 + fit.size * 0.86;
    // 沙粒間距跟字級成比例（字大沙粒也大）；字照標準變小之後沙粒也要細，筆畫才排得出來
    const step = clamp(fit.size / 24, 2.1, 3);
    this.dot = step * 1.05;
    const pts = this.pts = glyphPoints(fit.lines, FAM_MSG, fit.size, TB.x, top, fit.lineHeight, step, 'left', this.seed);
    const n = pts.n, ng = pts.glyphs.length;
    // ---- 時間：第二拍起一個字一個字倒（兩小節或窗格的四成內倒完），每個字倒一小段時間
    const starts = stagger(au, this.tFirst + beat, ng, Math.min(2 * barLen, 0.42 * (e - s)));
    const gap = ng > 1 ? (starts[ng - 1]! - starts[0]!) / (ng - 1) : beat;
    // 一次只倒一個字（一道沙柱），長留言就倒得快一點
    const dur = clamp(gap * 0.95, 0.1, 0.8);
    this.g0 = starts; this.g1 = starts.map((x) => x + dur);
    // 每個字裡的沙粒：由下往上一層一層（6 px 一層），每層左右來回（倒沙口在字裡蛇行）
    const byG: number[][] = Array.from({ length: ng }, () => []);
    for (let i = 0; i < n; i++) byG[pts.g[i]!]!.push(i);
    this.tl = new Float32Array(n); this.jx = new Float32Array(n); this.tone = new Float32Array(n);
    const rnd = mulberry32(this.seed);
    byG.forEach((ids, g) => {
      const band = (i: number) => Math.floor(-pts.y[i]! / 6);
      ids.sort((a, b) => band(a) - band(b) || ((band(a) & 1 ? -1 : 1) * (pts.x[a]! - pts.x[b]!)));
      ids.forEach((i, r) => {
        this.tl[i] = this.g0[g]! + (dur * r) / Math.max(1, ids.length);
        this.jx[i] = (rnd() - 0.5) * 3;
        this.tone[i] = rnd();
      });
    });
    const tLast = Math.max(this.tFirst, ...this.g1);
    this.sigT = tLast + beat * 0.5;
    c.font = font(FAM_MSG, fit.size);
    const wMax = Math.max(...fit.lines.map((l) => c.measureText(l).width));
    this.sigY = top + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.3 + this.sigSize + 14;
    // 署名太低的話不能進右下角 QR 的範圍（x ≥ 1360、y ≥ 830）
    this.sigX = this.sigY > 800 ? Math.min(TB.x + wMax, 1340) : TB.x + wMax;
    this.lyricsInWindow = lyrics.linesIn(s, e).length > 0;
    // 沙的顆粒貼圖（畫一次）
    const gc = document.createElement('canvas'); gc.width = gc.height = 64;
    const g2 = gc.getContext('2d')!;
    for (let i = 0; i < 520; i++) {
      g2.fillStyle = `rgba(0,0,0,${0.1 + 0.3 * hash(i, 3)})`;
      g2.fillRect(hash(i, 1) * 64, hash(i, 2) * 64, 1.4, 1.4);
    }
    this.grain = c.createPattern(gc, 'repeat');

    // ---- 即時小卡避開：沙盤（留言）與上方的歌詞
    const msgR: Rect = [TB.x - 20, Math.round(top - fit.size - 20), TB.w + 40, Math.round(this.sigY + (m ? 20 : 70) - (top - fit.size) + 20)];
    const rows = Math.max(1, lyricRows(c, lyrics.linesIn(s, e), { family: F.archivo(100, 800), size: this.lyrSize, minSize: V2.lyrMin, maxWidth: LYR.w }));
    const lyr: Rect = [LYR.x - 12, LYR.base - this.lyrSize - 40, LYR.w + 24, this.lyrSize * (rows > 1 ? 2.35 : 1.25) + 52];
    this.avoid = [msgR, msgR, lyr, lyr];
  }

  /**
   * 沙漏的狀態：翻了幾次（k）、旋轉角（R）、物理上的「上方」在本地 y 的哪一邊（dirUp：-1 = 本地的上半部）、
   * 上面那半還剩多少沙（0..1）。翻轉中整個沙漏（連同沙）剛體轉過去，畫的是翻之前的樣子：上面快流完、下面滿的。
   */
  private state(t: number) {
    let k = 0;
    while (k < this.flips.length && t >= this.flips[k]!) k++;
    const start = (i: number) => (i > 0 ? this.flips[i - 1]! : this.ctx.start - this.period * 0.4);
    const left = (i: number, at: number) => 1 - clamp((at - start(i) - (i > 0 ? 0.45 : 0)) / (this.period * 1.02));
    const u = k > 0 ? clamp((t - this.flips[k - 1]!) / 0.7) : 1;
    const R = k > 0 ? Math.PI * (k - 1 + ease.outBack(u, 1.4)) : 0;
    const flipping = u < 1;
    const turns = flipping ? k - 1 : k;
    const dirUp = turns % 2 === 0 ? -1 : 1;
    const top = flipping ? left(k - 1, this.flips[k - 1]!) : left(k, t);
    return { k, R, top, dirUp, flipping };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const vis = prog(t, s, s + 0.35) * (1 - prog(t, e - 0.35, e, ease.inCubic));
    this.bg.u.k!.value = vis; this.bg.u.kick!.value = f.a.kick;
    this.bg.render(renderer, out);

    const st = this.state(t);
    const L = this.layer, c = L.ctx;
    L.clear();
    c.globalAlpha = vis;
    // ---- 沙漏裡的沙（本地座標：y 向下、中心在瓶頸；翻轉時整個轉過去）
    const spin = t * 0.35;
    const R = st.R;
    c.save();
    c.translate(HG.x, HG.y); c.rotate(R);
    const sandCol = mixRgba('ash', 'bone', 0.55, 0.92);
    const fillSand = (poly: [number, number][]) => {
      c.beginPath(); poly.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath();
      c.fillStyle = sandCol; c.fill();
      if (this.grain) { c.fillStyle = this.grain; c.fill(); }
    };
    const topAmt = st.top, botAmt = 1 - topAmt, dirUp = st.dirUp;
    // 上面那半：從瓶頸往上堆到 level
    const lvTop = 0.02 + 0.9 * Math.sqrt(topAmt);
    if (topAmt > 0.01) {
      const poly: [number, number][] = [];
      for (let i = 0; i <= 12; i++) { const u = (lvTop * i) / 12; poly.push([prof(u), dirUp * u * HG.h]); }
      for (let i = 12; i >= 0; i--) { const u = (lvTop * i) / 12; poly.push([-prof(u), dirUp * u * HG.h]); }
      fillSand(poly);
    }
    // 下面那半：從蓋子往上堆，頂上一個小沙丘
    if (botAmt > 0.01) {
      const lv = 1 - 0.88 * Math.sqrt(botAmt);
      const poly: [number, number][] = [];
      for (let i = 0; i <= 12; i++) { const u = lerp(0.985, lv, i / 12); poly.push([prof(u), -dirUp * u * HG.h]); }
      poly.push([0, -dirUp * (lv - 0.12 * Math.min(1, botAmt * 3)) * HG.h]);
      for (let i = 12; i >= 0; i--) { const u = lerp(0.985, lv, i / 12); poly.push([-prof(u), -dirUp * u * HG.h]); }
      fillSand(poly);
    }
    // 流下來的細沙（瓶頸 → 沙丘頂），翻轉中不流
    if (!st.flipping && topAmt > 0.01 && topAmt < 0.995) {
      const lv = 1 - 0.88 * Math.sqrt(botAmt);
      c.fillStyle = rgba('bone', 0.8);
      for (let i = 0; i < 40; i++) {
        const y = ((i / 40 + t * 2.2) % 1) * (lv - 0.1) * HG.h;
        c.fillRect(-1.5 + (hash(i, Math.floor(t * 20)) - 0.5) * 2.5, -dirUp * y - 1, 2.4, 2.4);
      }
    }
    c.restore();

    // ---- 玻璃與木架（版畫細線）：自己投影的 3D 點（繞直軸慢慢轉，再整個翻過來）
    const gl = this.glass;
    gl.clear();
    const ct = Math.cos(R), sn = Math.sin(R);
    const P = (x: number, y: number, z: number) => {
      const yy = y + z * Math.sin(HG.tilt);
      return { x: HG.x + x * ct - yy * sn, y: HG.y + x * sn + yy * ct, z };
    };
    const bone = LIN.bone, ash = LIN.ash;
    const line = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, w: number, front: number) => {
      const col = front > 0 ? bone : ash;
      const al = (front > 0 ? 0.62 : 0.2) * vis;
      gl.seg2(a.x, a.y, b.x, b.y, w, [col[0] * 0.9, col[1] * 0.9, col[2] * 0.9], al);
    };
    // 輪廓（左右兩條）
    for (const sgn of [-1, 1]) {
      for (let i = 0; i < 40; i++) {
        const v0 = -1 + (2 * i) / 40, v1 = -1 + (2 * (i + 1)) / 40;
        line(P(sgn * prof(v0), v0 * HG.h, 0), P(sgn * prof(v1), v1 * HG.h, 0), 1.8, 1);
      }
    }
    // 環（橢圓）與經線（前面亮、後面暗）
    for (const v of [-0.88, -0.66, -0.44, -0.22, 0.22, 0.44, 0.66, 0.88]) {
      const r = prof(v);
      for (let i = 0; i < 28; i++) {
        const a0 = (i / 28) * TAU, a1 = ((i + 1) / 28) * TAU;
        line(P(r * Math.cos(a0), v * HG.h, r * Math.sin(a0)), P(r * Math.cos(a1), v * HG.h, r * Math.sin(a1)), 0.9, Math.sin((a0 + a1) / 2));
      }
    }
    for (let k = 0; k < 8; k++) {
      const a = spin + (k / 8) * TAU;
      for (let i = 0; i < 24; i++) {
        const v0 = -0.97 + (1.94 * i) / 24, v1 = -0.97 + (1.94 * (i + 1)) / 24;
        line(P(prof(v0) * Math.cos(a), v0 * HG.h, prof(v0) * Math.sin(a)), P(prof(v1) * Math.cos(a), v1 * HG.h, prof(v1) * Math.sin(a)), 0.8, Math.sin(a) > 0 ? 0.5 : -1);
      }
    }
    // 上下兩塊木板（兩圈橢圓）與三根柱子
    for (const cap of [-1, 1]) {
      for (const dy of [0, 16]) {
        const y = cap * (HG.h + 8 + dy);
        for (let i = 0; i < 36; i++) {
          const a0 = (i / 36) * TAU, a1 = ((i + 1) / 36) * TAU, rr = HG.rb * 1.22;
          line(P(rr * Math.cos(a0), y, rr * Math.sin(a0)), P(rr * Math.cos(a1), y, rr * Math.sin(a1)), 1.3, Math.sin((a0 + a1) / 2) + 0.3);
        }
      }
    }
    for (let k = 0; k < 3; k++) {
      const a = spin * 1 + (k / 3) * TAU, rr = HG.rb * 1.1;
      line(P(rr * Math.cos(a), -HG.h - 8, rr * Math.sin(a)), P(rr * Math.cos(a), HG.h + 8, rr * Math.sin(a)), 2.4, Math.sin(a));
    }
    // 玻璃的反光：左邊一條固定的淡反光；每個小節線一道亮光沿著玻璃的弧面從左掃到右（像燈光掃過轉動的沙漏）
    const au = this.ctx.audio, gb = Math.floor(au.barAt(t) + 1e-6), gtb = au.timeOfBar(gb);
    const gq = prog(t, gtb + 0.1, gtb + 0.9, ease.inOutCubic);
    const em = LIN.ember;
    for (const [side, amt, al] of [[-0.62, 1, 0.22], [gq * 1.7 - 0.85, gq > 0 && gq < 1 ? Math.sin(Math.PI * gq) : 0, 0.9]] as const) {
      if (amt <= 0.01) continue;
      for (let i = 0; i < 30; i++) {
        const v0 = -0.9 + (1.8 * i) / 30, v1 = -0.9 + (1.8 * (i + 1)) / 30;
        if (Math.abs(v0) < 0.1 || Math.abs(v1) < 0.1) continue;
        const a = P(side * prof(v0), v0 * HG.h, -prof(v0) * 0.8), b = P(side * prof(v1), v1 * HG.h, -prof(v1) * 0.8);
        gl.seg2(a.x, a.y, b.x, b.y, side === -0.62 ? 1.6 : 2.4, [em[0] * 1.4, em[1] * 1.4, em[2] * 1.4], al * amt * vis);
      }
    }
    gl.render(renderer, out);
    comp.draw(renderer, L.upload(), out);

    // ---- 沙盤：沙粒一粒一粒落下、由下往上堆成字
    const sb = this.sand, hb = this.hotSand;
    sb.clear(); hb.clear();
    const pts = this.pts!;
    const sc = LIN.bone, sd = LIN.ash, sig = LIN.signal, rose = LIN.rose;
    const fit = this.fit!;
    // 漏斗口：在正在倒的那一行的字頂上方，一行一行往下換
    const lineTop = (g: number) => pts.glyphs[g]!.y - fit.size * 0.95 - POUR;
    // 一個字一道沙柱：沙從倒沙口（字的中線上方）直直落到目前的沙面，再往旁邊滑到自己的位置
    const SLIDE = 0.09;
    for (let i = 0; i < pts.n; i++) {
      const tl = this.tl[i]!, tx = pts.x[i]! + this.jx[i]!, ty = pts.y[i]!;
      const gi = pts.g[i]!, gl = pts.glyphs[gi]!;
      const cx = gl.x + gl.w * 0.5 + this.jx[i]! * 0.5;
      const pourY = lineTop(gi);
      const tf = tl - SLIDE, fall = Math.sqrt((2 * Math.max(1, ty - pourY)) / G);
      if (t < tf - fall) continue;
      const heart = gl.ch === '♥';
      if (t < tl) {
        let x0: number, y0: number, x1: number, y1: number;
        if (t < tf) {
          // 還在空中：從倒沙口直直落下（拖一小段動態模糊）
          const a = t - (tf - fall), a0 = Math.max(0, a - 0.02);
          x0 = x1 = cx; y0 = pourY + 0.5 * G * a0 * a0; y1 = pourY + 0.5 * G * a * a;
        } else {
          // 落到沙面，往旁邊滑開
          const q = ease.outCubic((t - tf) / SLIDE), q0 = ease.outCubic(Math.max(0, t - tf - 0.02) / SLIDE);
          x0 = lerp(cx, tx, q0); x1 = lerp(cx, tx, q); y0 = y1 = ty;
        }
        hb.seg2(x0, y0, x1 + 0.01, y1, this.dot * 0.7, [sig[0] * 1.5, sig[1] * 1.5, sig[2] * 1.5], 0.55 * vis);
        continue;
      }
      const heat = 1 - clamp((t - tl) / 0.6);
      const tn = this.tone[i]!;
      const base: [number, number, number] = heart ? [rose[0], rose[1], rose[2]] : [lerp(sd[0], sc[0], 0.45 + 0.55 * tn), lerp(sd[1], sc[1], 0.45 + 0.55 * tn), lerp(sd[2], sc[2], 0.45 + 0.55 * tn)];
      sb.seg2(tx, ty, tx + 0.01, ty, this.dot, base, 0.95 * vis);
      if (heat > 0.02) hb.seg2(tx, ty, tx + 0.01, ty, this.dot * 1.1, [sig[0] * 2 * heat, sig[1] * 2 * heat, sig[2] * 2 * heat], vis);
    }
    sb.render(renderer, out);
    hb.render(renderer, out);

    // ---- 字：歌詞、署名、讀數（另一層：沙漏的沙那一層已經先疊上去了，沙盤的沙粒要在它上面、字又要在沙粒上面）
    this.funnel(t, vis, lineTop);
    this.drawText(t, st.k, vis, out);
    // 鏡頭：整個窗格慢慢推近（像電影）
    return { bloom: 0.75, vignette: 0.5, halation: 0.3, zoom: 1 + 0.025 * ease.inOutCubic(f.p) + 0.003 * f.a.kick, popupAvoid: this.avoid };
  }

  /**
   * 倒沙的漏斗：在正在倒的那個字的上方（換字時 outExpo 滑過去），漏斗口到目前沙面一道連續的細沙柱。
   * 這裡只算位置，畫在字的那一層（drawText）：漏斗要疊在沙粒上面。
   */
  private funnel(t: number, vis: number, lineTop: (g: number) => number) {
    const n = this.g0.length;
    this.fun = null;
    if (!n) return;
    let g = 0;
    while (g + 1 < n && t >= this.g0[g + 1]! - 0.12) g++;
    const on = prog(t, this.g0[0]! - 0.6, this.g0[0]! - 0.3) * (1 - prog(t, this.g1[n - 1]! + 0.2, this.g1[n - 1]! + 0.6));
    if (on <= 0) return;
    const pts = this.pts!;
    const at = (i: number) => ({ x: pts.glyphs[i]!.x + pts.glyphs[i]!.w * 0.5, y: lineTop(i) });
    const a = at(Math.max(0, g - 1)), b = at(g);
    const k = ease.outExpo(clamp((t - (this.g0[g]! - 0.12)) / 0.12));
    const x = g === 0 ? b.x : lerp(a.x, b.x, k), y = g === 0 ? b.y : lerp(a.y, b.y, k);
    // 沙面：這個字已經倒到哪一層（最高的已落地沙粒）
    let surf = y + 200;
    const ing = t >= this.g0[g]! && t <= this.g1[g]!;
    if (ing) {
      for (let i = 0; i < pts.n; i++) if (pts.g[i] === g && this.tl[i]! <= t) surf = Math.min(surf, pts.y[i]!);
      if (surf > y + 199) surf = pts.glyphs[g]!.y;
    }
    this.fun = { x, y, on: on * vis, surf: ing ? surf : null };
  }
  fun: { x: number; y: number; on: number; surf: number | null } | null = null;

  private drawText(t: number, flips: number, vis: number, out: THREE.WebGLRenderTarget) {
    const { renderer, comp, lyrics, song } = this.ctx;
    const L = this.textLayer, c = L.ctx;
    L.clear();
    c.globalAlpha = vis;
    // 漏斗（細線的倒三角）與沙柱
    // 沙堆好的字：沙面上淡淡壓出字的形狀（字級照標準變小之後，光靠沙粒讀不清楚）
    const pts = this.pts!, fit = this.fit!;
    c.font = font(FAM_MSG, fit.size);
    for (let gi = 0; gi < pts.glyphs.length; gi++) {
      const k = ease.outCubic(clamp((t - this.g1[gi]!) / 0.5));
      if (k <= 0) continue;
      const gl = pts.glyphs[gi]!;
      c.fillStyle = gl.ch === '♥' ? rgba('rose', 0.35 * k) : rgba('bone', 0.3 * k);
      c.fillText(gl.ch, gl.x, gl.y);
    }
    const fu = this.fun;
    if (fu) {
      c.save(); c.globalAlpha = fu.on;
      if (fu.surf !== null) {
        c.fillStyle = rgba('ember', 0.85);
        c.fillRect(fu.x - 1, fu.y + 2, 2, Math.max(0, fu.surf - fu.y - 2));
      }
      c.strokeStyle = rgba('bone', 0.85); c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(fu.x - 15, fu.y - 22); c.lineTo(fu.x + 15, fu.y - 22); c.lineTo(fu.x + 3, fu.y - 2); c.lineTo(fu.x + 3, fu.y + 2);
      c.lineTo(fu.x - 3, fu.y + 2); c.lineTo(fu.x - 3, fu.y - 2); c.closePath(); c.stroke();
      c.fillStyle = rgba('ash', 0.5); c.fill();
      c.restore();
    }
    const m = this.msg;
    if (m && t >= this.sigT) {
      c.save(); c.globalAlpha *= prog(t, this.sigT, this.sigT + 0.4);
      c.font = font(F.ming(400), this.sigSize); c.fillStyle = rgba('ash'); c.textAlign = 'right';
      fillWithHearts(c, this.sig, this.sigX, this.sigY);
      c.restore();
    }
    if (!m) {
      c.save(); c.globalAlpha *= prog(t, this.sigT, this.sigT + 0.4);
      c.font = font(F.hand(700), 32); c.fillStyle = rgba('bone', 0.85);
      c.fillText(INVITE.split('，')[0] + '，', TB.x, this.sigY - 6);
      c.fillText(INVITE.split('，')[1]!, TB.x, this.sigY + 38);
      c.restore();
    }
    // 歌詞
    const ly = lyricAt(lyrics, t, 1.6);
    if (ly) {
      const st = { family: F.archivo(100, 800), size: this.lyrSize, minSize: V2.lyrMin, maxWidth: LYR.w };
      const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.1));
      c.save(); c.translate(LYR.x, LYR.base + (1 - inK) * 14);
      lyricLine(c, ly.line, t, st, ly.k * c.globalAlpha);
      c.restore();
    } else if (!this.lyricsInWindow) {
      c.font = font(F.archivo(100, 700), 56); c.fillStyle = rgba('bone', 0.88); c.fillText(song.title, LYR.x, LYR.base);
    }
    // 讀數與註腳（沙漏下面）
    // 配角的字只留一行：翻了幾次＋冷面註腳
    tag(c, `第 ${flips} 次翻轉　${FOOT}`, 124, 984, { size: 17, color: rgba('ash', 0.58), tracking: 1 });
    comp.draw(renderer, L.upload(), out);
  }

}
