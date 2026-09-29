// 愛情樹（亮）：紙上的一棵鋼筆版畫樹，在拍點上長出來——第一拍樹幹冒出地面、第二拍一根長長的橫枝伸過畫面、
// 接著樹冠一層一層分枝、葉子一拍一批長出來（新葉先是訊號色的暗部，再退成墨色），小節線上一陣風。
// 許願樹：主打留言寫在一張掛在橫枝上的許願牌（整個畫面唯一有顏色的一塊紙），在第二拍掉下來、晃幾下停住，
// 之後每個小節線被風推一下。樹冠裡還掛著幾張很小的空白許願牌（別人的祝福，不搶戲）。
// 歌詞刻在橫枝上：唱到的字被刀刻出來（訊號色的暗部），刻好變成深墨色，字跟著樹枝的弧度上下起伏。
// 樹幹上刻著一顆小小的「A ♥ O」。
// 手法：樹、葉、牌子的繩子都是 LineBatch（GPU 細線，版畫的外框＋樹皮線＋暗面的交叉排線）；
// 地面與遠山是一張只畫一次的 Canvas；許願牌是 init 畫好的圖，每格只是旋轉貼上。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp, mulberry32, TAU } from '../engine/util';
import { Lyrics, type Line } from '../engine/lyrics';
import { fillWithHearts } from '../engine/motifs';
import { lyricAt, lyricSizeFor, beatAfter, COUPLE_ZH, DATE_DOTS, drawHeart } from './_motifs';
import { winBeats, winBars } from './_t8';
import { Paper } from './_t11';
import { msgBlock, loadAll, INVITE, type MsgBlock, type P2, type Rect } from './_t15';

export const spec: PlateSpecDecl = { group: 'type', family: 'nature', paper: true, energy: [0.15, 0.85], bars: [4, 8], weight: 1 };

const GROUND = 986;
/** 樹幹與橫枝的中心線（手擺的骨架，之後用 Catmull-Rom 取樣）與寬度。 */
const TRUNK: [number, number, number][] = [[414, 992, 200], [424, 950, 150], [430, 880, 124], [458, 740, 104], [490, 600, 94], [522, 500, 88], [552, 452, 86]];
const LIMB: [number, number, number][] = [[560, 432, 92], [680, 382, 80], [820, 356, 72], [1000, 347, 66], [1200, 349, 60], [1400, 362, 50], [1560, 388, 38], [1700, 428, 14]];
/** 歌詞刻在橫枝上的範圍（x）。 */
const CARVE = { x0: 640, x1: 1640 };
/** 許願牌掛的位置（橫枝下緣）與牌子的寬。 */
const ANCHOR = { x: 960, y: 378 };
const TAG_W = 800;
const INK_W = 2.1;

type Br = { pts: P2[]; w: number[]; cum: number[]; len: number; t0: number; t1: number; depth: number; bark: boolean };
type Leaf = { x: number; y: number; a: number; s: number; t: number; accent: boolean; br: number; at: number };

/** Catmull-Rom 取樣：控制點（x, y, 寬）→ 密一點的中心線與寬度。 */
function spline(ctrl: [number, number, number][], per = 10): { pts: P2[]; w: number[] } {
  const pts: P2[] = [], w: number[] = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)]!, p1 = ctrl[i]!, p2 = ctrl[i + 1]!, p3 = ctrl[Math.min(ctrl.length - 1, i + 2)]!;
    for (let k = 0; k < per; k++) {
      const u = k / per, u2 = u * u, u3 = u2 * u;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
      pts.push({ x: f(p0[0], p1[0], p2[0], p3[0]), y: f(p0[1], p1[1], p2[1], p3[1]) });
      w.push(lerp(p1[2], p2[2], u));
    }
  }
  const l = ctrl[ctrl.length - 1]!;
  pts.push({ x: l[0], y: l[1] }); w.push(l[2]);
  return { pts, w };
}

function mkBranch(pts: P2[], w: number[], t0: number, t1: number, depth: number, bark: boolean): Br {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
  return { pts, w, cum, len: cum[cum.length - 1]!, t0, t1, depth, bark };
}

/** 中心線上長度 s 的點、切線角、寬度。 */
function at(b: Br, s: number): { x: number; y: number; a: number; w: number } {
  let i = 1;
  while (i < b.pts.length - 1 && b.cum[i]! < s) i++;
  const a = b.pts[i - 1]!, c = b.pts[i]!, seg = b.cum[i]! - b.cum[i - 1]!;
  const u = seg > 0 ? clamp((s - b.cum[i - 1]!) / seg) : 0;
  return { x: lerp(a.x, c.x, u), y: lerp(a.y, c.y, u), a: Math.atan2(c.y - a.y, c.x - a.x), w: lerp(b.w[i - 1]!, b.w[i]!, u) };
}

/** 橫枝中心線在 x 的高度（刻字跟著樹枝起伏用）。 */
function limbY(b: Br, x: number): number {
  for (let i = 1; i < b.pts.length; i++) {
    const p = b.pts[i - 1]!, q = b.pts[i]!;
    if (x <= q.x) return lerp(p.y, q.y, clamp((x - p.x) / Math.max(1e-3, q.x - p.x)));
  }
  return b.pts[b.pts.length - 1]!.y;
}

export default class Tree extends Scene {
  paper = shared('t15.paper', () => new Paper());
  /** 不變的：地面、草、遠山（只畫一次）。 */
  ground = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 會動的：許願牌、刻字、樹幹上的刻痕。 */
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  ink = this.track(new LineBatch(20000, { screen2D: true, blend: 'normal' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 977 + (this.msg?.id ?? 0) * 131) >>> 0;
  brs: Br[] = [];
  leaves: Leaf[] = [];
  trunk!: Br; limb!: Br;
  B: number[] = [];
  bars: number[] = [];
  beat = 0.5;
  /** 許願牌：init 畫好的圖（含字）、大小、掉下來的時間、晃動的衝量。 */
  tag: HTMLCanvasElement | null = null;
  tagH = 300; tagW = TAG_W; tDrop = 0;
  pushes: { t: number; a: number }[] = [];
  small: { x: number; y: number; s: number; t: number; ph: number }[] = [];
  block: MsgBlock | null = null;
  lyrSize = 54;
  falls: { t: number; x: number; y: number; seed: number }[] = [];

  override async init() {
    const { audio: au, lyrics, start: s, end: e } = this.ctx;
    const lines = lyrics.linesIn(s - 1, e + 1);
    await loadAll(this.msg, lines.map((l) => l.text).join(''), `${COUPLE_ZH}${DATE_DOTS}A♥O+`);
    this.beat = au.beatPeriod(s);
    // ---- 節拍骨架：B[0] = 第一拍（至少開場後 0.25 秒），之後每拍
    const b0 = beatAfter(au, s + 0.25);
    const beats = winBeats(au, s, e + this.beat * 8).filter((b) => b >= b0 - 1e-3);
    this.B = beats.length >= 8 ? beats : Array.from({ length: 8 }, (_, i) => b0 + i * this.beat);
    this.bars = winBars(au, s, e).filter((b) => b > this.B[1]! + 0.05);
    const B = this.B;
    // ---- 樹幹、橫枝：第一拍冒出來、第二拍伸過去
    const tr = spline(TRUNK), lm = spline(LIMB, 12);
    this.trunk = mkBranch(tr.pts, tr.w, s + 0.02, B[0]! + this.beat * 0.2, 0, true);
    this.limb = mkBranch(lm.pts, lm.w, B[0]!, B[1]! + this.beat * 0.3, 0, true);
    this.brs.push(this.trunk, this.limb);
    // ---- 樹冠：從樹幹頂端、橫枝上長出去，一層一拍
    const rnd = mulberry32(this.seed);
    const grow = (x: number, y: number, ang: number, len: number, w: number, depth: number, t0: number) => {
      if (depth > 4) return;
      // 太靠上緣就縮短（樹冠不要長出畫面），太短就不長
      const tipY = y + Math.sin(ang) * len;
      if (tipY < 46) len *= clamp((y - 46) / Math.max(1, y - tipY), 0, 1);
      if (len < 26) return;
      const n = 8, pts: P2[] = [], ws: number[] = [];
      let a = ang, px = x, py = y;
      const bend = (rnd() - 0.5) * 0.6;
      for (let i = 0; i <= n; i++) {
        pts.push({ x: px, y: py }); ws.push(lerp(w, w * 0.45, i / n));
        a += bend / n;
        px += Math.cos(a) * len / n; py += Math.sin(a) * len / n;
      }
      if (px < 60 || px > W - 60) return;
      const dur = this.beat * (0.8 + 0.3 * rnd());
      const br = mkBranch(pts, ws, t0, t0 + dur, depth, w > 13);
      this.brs.push(br);
      const bi = this.brs.length - 1;
      // 葉子：沿著細枝兩側，一拍一批長出來；枝尖多幾片
      if (depth >= 2) {
        const nl = Math.max(2, Math.floor(len / 30));
        for (let k = 0; k < nl; k++) {
          const sPos = br.len * (0.3 + 0.7 * (k / Math.max(1, nl - 1)));
          const p = at(br, sPos);
          const side = k % 2 ? 1 : -1;
          const beatK = 1 + depth + Math.floor(rnd() * 3);
          this.leaves.push({ x: p.x, y: p.y, a: p.a + side * (0.6 + 0.5 * rnd()), s: 20 + 14 * rnd(), t: (B[Math.min(B.length - 1, beatK)] ?? t0) + (k % 3) * 0.05, accent: rnd() < 0.16, br: bi, at: sPos });
        }
      }
      const kids = depth <= 1 ? 3 : 2;
      for (let c = 0; c < kids; c++) {
        const u = 0.45 + 0.5 * rnd();
        const p = at(br, br.len * u);
        const spread = (c - (kids - 1) / 2) * (0.5 + 0.35 * rnd()) + (rnd() - 0.5) * 0.2;
        grow(p.x, p.y, a + spread, len * (0.6 + 0.14 * rnd()), Math.max(2.5, p.w * 0.7), depth + 1, t0 + dur * u * 0.8);
      }
    };
    // 起點：樹幹頂往左上、樹幹中段往左、橫枝上一路往上扇開
    grow(560, 450, -2.0, 210, 30, 1, B[1]!);
    grow(515, 520, -2.75, 170, 24, 1, B[1]! + this.beat * 0.3);
    for (const [x, ang, len] of [[760, -2.1, 200], [1000, -1.72, 205], [1240, -1.35, 200], [1470, -1.0, 175], [1640, -0.68, 125]] as const) {
      const y = limbY(this.limb, x) - 20;
      grow(x, y, ang + (rnd() - 0.5) * 0.16, len, 22, 1, B[1]! + this.beat * 0.4 + (x - 700) / 1000 * this.beat);
    }
    // 樹根：貼著地面往兩邊
    const root = (pts: [number, number, number][]) => { const r = spline(pts, 6); this.brs.push(mkBranch(r.pts, r.w, s + 0.05, B[0]!, 0, true)); };
    root([[372, 978, 22], [332, 990, 9], [296, 995, 3]]);
    root([[466, 978, 22], [506, 989, 9], [548, 994, 3]]);
    // ---- 樹冠裡幾張很小的空白許願牌（別人的祝福）
    const smallAt = this.brs.filter((b) => b.depth === 2);
    for (let i = 0; i < smallAt.length && this.small.length < 5; i += 3) {
      const b = smallAt[i]!, p = at(b, b.len * 0.7);
      if (Math.abs(p.x - ANCHOR.x) < TAG_W * 0.6 && p.y > 200) continue;
      this.small.push({ x: p.x, y: p.y, s: 0.8 + 0.4 * hash(this.seed, i), t: B[5]! + i * 0.05, ph: hash(this.seed, i, 2) * TAU });
    }

    // ---- 許願牌
    this.tDrop = B[1]! + this.beat * 0.25;
    this.pushes.push({ t: this.tDrop, a: 0.1 });
    this.bars.forEach((b, i) => { if (b > this.tDrop + 0.5) this.pushes.push({ t: b, a: (i % 2 ? 1 : -1) * 0.035 }); });
    this.buildTag();
    // ---- 小節線上一片葉子飄下來
    this.bars.forEach((b, i) => {
      const lf = this.leaves[Math.floor(hash(this.seed, i, 7) * this.leaves.length)];
      if (lf && b > B[4]!) this.falls.push({ t: b, x: lf.x, y: lf.y, seed: i });
    });
    this.drawGround();
  }

  /** 許願牌（上面尖、有穿繩的孔）：有留言是留言＋署名；沒有留言是新人的名字（小一點的牌子）。 */
  private buildTag() {
    const cv = document.createElement('canvas');
    const pad = 48;
    const m = this.msg;
    const c0 = this.layer.ctx;
    let b: MsgBlock | null = null;
    if (m) {
      b = msgBlock(c0, m, F.hand(700), TAG_W - 110, 330, { min: 46, max: 104, lineHeight: 1.3, sigK: 0.46 });
      this.block = b;
      this.tagW = TAG_W;
      this.tagH = Math.round(b.height + 150);
      this.lyrSize = lyricSizeFor(b.fit.size);
    } else {
      this.tagW = 420; this.tagH = 200;
      this.lyrSize = 66;
    }
    const w = this.tagW, h = this.tagH;
    cv.width = Math.round((w + pad * 2) * 1.5); cv.height = Math.round((h + pad * 2) * 1.5);
    const c = cv.getContext('2d')!;
    c.scale(1.5, 1.5);
    c.translate(pad, pad);
    // 牌子：上緣兩角斜切、紙色偏訊號色（整個畫面唯一的顏色塊），邊緣一圈細線
    const shape = () => {
      c.beginPath();
      c.moveTo(70, 0); c.lineTo(w - 70, 0); c.lineTo(w, 60); c.lineTo(w, h); c.lineTo(0, h); c.lineTo(0, 60); c.closePath();
    };
    // 牌子自己的影子（軟的、往右下，跟著牌子一起晃）
    c.save();
    c.shadowColor = rgba('sepia', 0.3); c.shadowBlur = 22; c.shadowOffsetX = 10; c.shadowOffsetY = 16;
    shape(); c.fillStyle = rgba('paper', 1); c.fill();
    c.restore();
    c.save(); shape(); c.clip();
    c.fillStyle = rgba('signal', 0.3); c.fillRect(0, 0, w, h);
    c.fillStyle = rgba('blood', 0.08); c.fillRect(0, 0, w, h);
    // 一點點紙纖維
    for (let i = 0; i < 90; i++) {
      c.strokeStyle = rgba('sepia', 0.04); c.lineWidth = 1;
      const x = hash(this.seed, i) * w, y = hash(this.seed, i, 3) * h, a = hash(this.seed, i, 5) * TAU;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14); c.stroke();
    }
    c.restore();
    shape(); c.strokeStyle = rgba('blood', 0.55); c.lineWidth = 2; c.stroke();
    // 穿繩的孔（加強圈）
    c.beginPath(); c.arc(w / 2, 34, 13, 0, TAU); c.fillStyle = rgba('blood', 0.35); c.fill();
    c.beginPath(); c.arc(w / 2, 34, 7, 0, TAU); c.fillStyle = rgba('paper', 1); c.fill();
    c.textBaseline = 'alphabetic';
    if (m && b) {
      c.font = font(b.family, b.fit.size); c.fillStyle = rgba('sepia', 0.96);
      const top = 78;
      b.fit.lines.forEach((ln, i) => {
        const lw = c.measureText(ln).width;
        fillWithHearts(c, ln, (w - lw) / 2, top + b!.top + i * b!.fit.lineHeight);
      });
      c.font = font(b.family, b.sigSize); c.fillStyle = rgba('sepia', 0.72); c.textAlign = 'right';
      c.fillText(b.sig, w - 56, top + b.sigY);
      if (m.couple) {
        c.font = font(F.hei(500), 20); c.letterSpacing = '6px'; c.fillStyle = rgba('blood', 0.8); c.textAlign = 'left';
        c.fillText('新人', 40, h - 26); c.letterSpacing = '0px';
      }
    } else {
      c.textAlign = 'center';
      c.font = font(F.ming(900), 52); c.fillStyle = rgba('sepia', 0.9);
      c.fillText(COUPLE_ZH, w / 2, 124);
      c.font = font(F.mono(500), 20); c.letterSpacing = '5px'; c.fillStyle = rgba('blood', 0.8);
      c.fillText(DATE_DOTS, w / 2, 164); c.letterSpacing = '0px';
    }
    this.tag = cv;
  }

  /** 地面：一條斷斷續續的地平線、草、很淡的遠山（只畫一次）。 */
  private drawGround() {
    const L = this.ground, c = L.ctx;
    L.clear();
    c.lineCap = 'round';
    // 遠山：兩條很淡的起伏線
    for (const [y0, amp, a] of [[930, 40, 0.14], [955, 26, 0.2]] as const) {
      c.strokeStyle = rgba('sepia', a); c.lineWidth = 1.4;
      c.beginPath();
      for (let x = 60; x <= W - 60; x += 12) {
        const y = y0 - amp * (0.5 + 0.5 * Math.sin(x / 260 + y0)) * (0.6 + 0.4 * Math.sin(x / 97));
        if (x === 60) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    }
    // 地平線與草
    c.strokeStyle = rgba('sepia', 0.7); c.lineWidth = 2;
    c.beginPath(); c.moveTo(90, GROUND); c.lineTo(290, GROUND); c.moveTo(566, GROUND); c.lineTo(1330, GROUND); c.stroke();
    c.strokeStyle = rgba('sepia', 0.35); c.lineWidth = 1.2;
    for (let i = 0; i < 90; i++) {
      const x = 110 + hash(this.seed, i, 11) * 1200, h = 6 + 16 * hash(this.seed, i, 12);
      c.beginPath(); c.moveTo(x, GROUND); c.quadraticCurveTo(x + 3, GROUND - h * 0.6, x + (hash(i, 3) - 0.5) * 10, GROUND - h); c.stroke();
    }
    // 地面的排線（很淡，往右淡出）
    for (let i = 0; i < 30; i++) {
      const y = GROUND + 12 + i * 3.2, x1 = 200 + 1000 * (1 - i / 30);
      c.strokeStyle = rgba('sepia', 0.12 * (1 - i / 30)); c.lineWidth = 1;
      c.beginPath(); c.moveTo(150 + i * 8, y); c.lineTo(x1, y); c.stroke();
    }
    L.upload();
  }

  /** 一根樹枝（長到 g）：粗的畫版畫（外框＋樹皮線＋暗面排線，先墊紙色擋住後面的線），細的畫一條墨線。 */
  private drawBranch(b: Br, g: number, t: number, wind: number) {
    const lb = this.ink, L = b.len * g;
    if (L <= 1) return;
    const sep = LIN.sepia, pap = LIN.paper;
    const n = b.pts.length;
    // 風：樹冠的細枝在小節線上晃一下（越細、越末端晃越多）
    const sway = (s: number) => (b.depth >= 2 ? wind * (s / b.len) * 9 * (b.depth - 1) : 0);
    const P = (s: number) => { const p = at(b, s); return { ...p, x: p.x + sway(s) }; };
    const step = b.bark ? 7 : 12;
    const pts: { x: number; y: number; a: number; w: number; s: number }[] = [];
    for (let s = 0; s < L; s += step) pts.push({ ...P(s), s });
    pts.push({ ...P(L), s: L });
    if (pts.length < 2) return;
    // 生長的尖端比較細（像剛冒出來）
    const wAt = (q: { w: number; s: number }) => q.w * (b.bark ? 1 : 1) * clamp((L - q.s) / 30 + 0.35, 0.35, 1);
    if (!b.bark) {
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1]!, q = pts[i]!;
        lb.seg2(p.x, p.y, q.x, q.y, Math.max(1.4, wAt(p) * 0.55), sep, 0.92);
      }
      return;
    }
    // 墊紙色（擋住後面交錯的樹枝）
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1]!, q = pts[i]!;
      if (p.y > GROUND - 8 && b.depth === 0 && b !== this.limb) continue; // 地面以下不墊（不然地面的排線會被擋掉一塊）
      lb.seg2(p.x, p.y, q.x, q.y, wAt(p) * 0.96, [pap[0] * 0.975, pap[1] * 0.975, pap[2] * 0.975], 1);
    }
    const inCarve = (x: number) => (b === this.limb && x > CARVE.x0 - 20 && x < CARVE.x1 + 20 ? 1 : 0);
    const off = (p: { x: number; y: number; a: number }, k: number, w: number) => ({ x: p.x - Math.sin(p.a) * k * w * 0.5, y: p.y + Math.cos(p.a) * k * w * 0.5 });
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1]!, q = pts[i]!;
      const wp = wAt(p), wq = wAt(q);
      // 外框（受光的上面細、背光的下面粗）
      const a0 = off(p, -1, wp), a1 = off(q, -1, wq), c0 = off(p, 1, wp), c1 = off(q, 1, wq);
      lb.seg2(a0.x, a0.y, a1.x, a1.y, INK_W * 0.9, sep, 0.95);
      lb.seg2(c0.x, c0.y, c1.x, c1.y, INK_W * 1.5, sep, 0.95);
      // 樹皮線：沿著樹枝的幾條波浪細線（刻字那一段只留靠邊的，字才讀得清楚）
      const ks = inCarve(p.x) ? [-0.82, 0.8] : [-0.55, -0.15, 0.3, 0.62];
      for (const k of ks) {
        const wob = 0.07 * Math.sin(p.s / 23 + k * 9 + this.seed);
        const u0 = off(p, k + wob, wp), u1 = off(q, k + 0.07 * Math.sin(q.s / 23 + k * 9 + this.seed), wq);
        if (hash(Math.floor(p.s / 40), k * 10, this.seed) < 0.82) lb.seg2(u0.x, u0.y, u1.x, u1.y, 1.05, sep, 0.5);
      }
      // 暗面的斜排線
      if (!inCarve(p.x) && (i % 2 === 0 || wp > 60)) {
        const k0 = 0.3 + 0.25 * hash(i, 5, this.seed);
        const h0 = off(p, k0, wp), h1 = off(p, 0.97, wp);
        lb.seg2(h0.x - Math.cos(p.a) * 6, h0.y - Math.sin(p.a) * 6, h1.x + Math.cos(p.a) * 9, h1.y + Math.sin(p.a) * 9, 1, sep, 0.45);
      }
    }
  }

  /** 一片葉子（杏仁形外框＋葉脈；有些是訊號色的暗部當新葉）。k = 長出來的進度。 */
  private drawLeaf(x: number, y: number, a: number, s: number, k: number, accent: boolean, fresh: number) {
    const lb = this.ink, sep = LIN.sepia;
    const L = s * k, hw = s * 0.28 * k;
    if (L < 1) return;
    const ca = Math.cos(a), sa = Math.sin(a);
    const P = (u: number, v: number) => ({ x: x + ca * u - sa * v, y: y + sa * u + ca * v });
    // 填色：訊號色的暗部（新葉、或少數一直是金色的葉子），用一條粗的膠囊
    const fillK = accent ? 0.55 : 0.5 * fresh;
    if (fillK > 0.02) {
      const m0 = P(L * 0.28, 0), m1 = P(L * 0.72, 0);
      const col: [number, number, number] = accent ? [LIN.signal[0] * 0.6 + LIN.blood[0] * 0.4, LIN.signal[1] * 0.6 + LIN.blood[1] * 0.4, LIN.signal[2] * 0.6 + LIN.blood[2] * 0.4] : LIN.blood;
      lb.seg2(m0.x, m0.y, m1.x, m1.y, hw * 1.7, col, fillK);
    }
    // 外框：兩條弧
    let prevA = P(0, 0), prevB = prevA;
    for (let i = 1; i <= 6; i++) {
      const u = i / 6, v = Math.sin(u * Math.PI) * hw * (1 - 0.25 * u);
      const pa = P(L * u, v), pb = P(L * u, -v);
      lb.seg2(prevA.x, prevA.y, pa.x, pa.y, 1.5, sep, 0.9);
      lb.seg2(prevB.x, prevB.y, pb.x, pb.y, 1.5, sep, 0.9);
      prevA = pa; prevB = pb;
    }
    const r0 = P(-3, 0), r1 = P(L * 0.9, 0);
    lb.seg2(r0.x, r0.y, r1.x, r1.y, 1, sep, 0.7);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const B = this.B;
    // 風：每個小節線一陣（衰減的擺動）
    let wind = 0;
    for (const b of this.bars) if (t >= b) { const a = t - b; wind += Math.sin(a * 7) * Math.exp(-a * 2.2) * 0.5; }
    this.paper.render(renderer, out, {});

    // ---- 樹（LineBatch）
    const lb = this.ink;
    lb.clear();
    for (const b of this.brs) {
      const g = ease.outCubic(prog(t, b.t0, b.t1));
      if (g > 0) this.drawBranch(b, g, t, wind);
    }
    for (const lf of this.leaves) {
      if (t < lf.t) continue;
      const k = ease.outBack(clamp((t - lf.t) / 0.28), 2.2);
      const fresh = 1 - clamp((t - lf.t - 0.3) / 1.2);
      const br = this.brs[lf.br]!;
      const sw = br.depth >= 2 ? wind * (lf.at / br.len) * 9 * (br.depth - 1) : 0;
      this.drawLeaf(lf.x + sw, lf.y, lf.a + wind * 0.25 * Math.sin(lf.x), lf.s, k, lf.accent, fresh);
    }
    // 飄落的葉子：小節線上一片，左右擺著往下飄，落到地面淡掉
    for (const fl of this.falls) {
      const a = t - fl.t;
      if (a < 0 || a > 4) continue;
      const y = fl.y + a * 120 + 10 * Math.sin(a * 3), x = fl.x + 60 * Math.sin(a * 1.8 + fl.seed) + a * 30;
      if (y > GROUND - 5) continue;
      this.drawLeaf(x, y, a * 2.2 + fl.seed, 26, 1, false, 0);
    }

    // ---- 許願牌：第二拍掉下來、晃幾下，之後每個小節線被風推一下
    const L = this.layer, c = L.ctx;
    L.clear();
    let theta = 0;
    for (const p of this.pushes) if (t >= p.t) { const a = t - p.t; theta += p.a * Math.sin(a * 4.2) * Math.exp(-a * 1.6); }
    const drop = ease.outBack(clamp((t - this.tDrop) / 0.4), 1.4);
    const strLen = 64;
    let tagRect: Rect | null = null;
    if (t >= this.tDrop && this.tag) {
      const ax = ANCHOR.x, ay = limbY(this.limb, ANCHOR.x) + 30;
      const len = strLen * drop;
      const hx = ax + Math.sin(theta) * len, hy = ay + Math.cos(theta) * len;
      // 繩子（訊號色的暗部）
      this.ink.seg2(ax, ay - 2, hx, hy + 18, 2.2, LIN.blood, 0.9);
      this.ink.seg2(ax - 12, ay - 8, ax + 10, ay + 2, 2.2, LIN.blood, 0.9);
      c.save();
      c.translate(hx, hy - (1 - drop) * 30);
      c.rotate(theta * 0.8);
      c.globalAlpha = drop > 0 ? clamp(drop * 3) : 0;
      const pad = 48;
      c.drawImage(this.tag, -this.tagW / 2 - pad, -16 - pad, this.tagW + pad * 2, this.tagH + pad * 2);
      c.restore();
      tagRect = [Math.round(hx - this.tagW / 2 - 20), Math.round(hy - 20), this.tagW + 40, this.tagH + 40];
    }
    // 樹冠裡的小許願牌（空白、很小，跟著風晃）
    for (const sm of this.small) {
      if (t < sm.t) continue;
      const k = ease.outBack(clamp((t - sm.t) / 0.35), 1.6);
      const th = 0.12 * Math.sin(t * 1.7 + sm.ph) + wind * 0.2;
      const ln = 26 * sm.s;
      const hx = sm.x + Math.sin(th) * ln, hy = sm.y + Math.cos(th) * ln;
      this.ink.seg2(sm.x, sm.y, hx, hy, 1.2, LIN.blood, 0.7 * k);
      c.save(); c.translate(hx, hy); c.rotate(th); c.scale(k * sm.s, k * sm.s);
      c.fillStyle = rgba('paper', 1); c.strokeStyle = rgba('blood', 0.5); c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(-10, 0); c.lineTo(10, 0); c.lineTo(15, 8); c.lineTo(15, 44); c.lineTo(-15, 44); c.lineTo(-15, 8); c.closePath();
      c.fill(); c.fillStyle = rgba('signal', 0.28); c.fill(); c.stroke();
      c.strokeStyle = rgba('sepia', 0.35); c.lineWidth = 1.2;
      for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(-9, 16 + i * 8); c.lineTo(-9 + 18 * (0.5 + 0.5 * hash(sm.ph, i)), 16 + i * 8); c.stroke(); }
      c.restore();
    }
    // 樹幹上的刻痕「A ♥ O」（樹幹長好之後）
    const tk = prog(t, this.trunk.t1, this.trunk.t1 + 0.4);
    if (tk > 0) {
      c.save(); c.globalAlpha = tk;
      const hx = 452, hy = 800;
      drawHeart(c, hx, hy, 64, rgba('blood', 0.3));
      c.font = font(F.hei(700), 17); c.fillStyle = rgba('sepia', 0.8); c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('A+O', hx, hy - 3);
      c.restore();
    }

    // ---- 歌詞刻在橫枝上（跟著樹枝起伏；還沒長到的地方不刻）
    const lyr = this.carve(c, t);
    lb.render(renderer, out);
    // 地面畫在樹後面一層：地平線在樹幹那裡留空、草長在樹根上
    comp.draw(renderer, this.ground.texture, out, { opacity: clamp((t - s) / 0.25) });
    comp.draw(renderer, L.upload(), out);
    const avoid: Rect[] = [];
    if (tagRect) avoid.push(tagRect);
    if (lyr) avoid.push(lyr);
    return { paper: 1, bloom: 0.3, vignette: 0.35, zoom: 1 + 0.035 * ease.inOutCubic(f.p), popupAvoid: avoid };
  }

  private carveCache = new Map<Line, { family: string; size: number; xs: number[]; ws: number[]; width: number }>();
  /** 一行歌詞在橫枝上的排法：字級 60→48，放不下就換窄體；每個字的 x。 */
  private carveLay(c: CanvasRenderingContext2D, line: Line) {
    let r = this.carveCache.get(line);
    if (r) return r;
    const maxW = CARVE.x1 - CARVE.x0;
    let family = F.archivo(100, 700), size = this.lyrSize;
    const meas = (fam: string, sz: number) => { c.font = font(fam, sz); return c.measureText(line.text).width; };
    while (size > 48 && meas(family, size) > maxW) size -= 2;
    if (meas(family, size) > maxW) { family = F.archivo(62, 700); size = this.lyrSize; while (size > 48 && meas(family, size) > maxW) size -= 2; }
    if (meas(family, size) > maxW) size = Math.max(40, Math.floor(size * maxW / meas(family, size)));
    c.font = font(family, size);
    const xs = line.words.map((w) => c.measureText(line.text.slice(0, w.o)).width);
    const ws = line.words.map((w) => c.measureText(w.w).width);
    r = { family, size, xs, ws, width: c.measureText(line.text).width };
    this.carveCache.set(line, r);
    return r;
  }

  /** 刻字：還沒唱的是很淡的刀痕、正在唱的是訊號色的暗部、唱完是深墨色（字的下緣一道亮邊＝刻進去的斜面）。 */
  private carve(c: CanvasRenderingContext2D, t: number): Rect | null {
    const ly = lyricAt(this.ctx.lyrics, t);
    if (!ly) return null;
    const lay = this.carveLay(c, ly.line);
    // 橫枝長到哪裡就刻到哪裡
    const reach = this.limb.pts[0]!.x + (this.limb.pts[this.limb.pts.length - 1]!.x - this.limb.pts[0]!.x) * ease.outCubic(prog(t, this.limb.t0, this.limb.t1));
    const x0 = (CARVE.x0 + CARVE.x1) / 2 - lay.width / 2;
    c.save();
    c.font = font(lay.family, lay.size);
    c.textBaseline = 'middle';
    let yMin = 1e9, yMax = -1e9;
    ly.line.words.forEach((w, i) => {
      const x = x0 + lay.xs[i]!, cx = x + lay.ws[i]! / 2;
      if (cx > reach) return;
      const y = limbY(this.limb, cx) + 2;
      yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
      const p = Lyrics.wordProgress(w, t);
      c.globalAlpha = ly.k;
      // 刀痕的亮邊（往下偏一點）
      c.fillStyle = rgba('paper', 0.9);
      if (p > 0) c.fillText(w.w, x + 1, y + 2);
      c.fillStyle = rgba('sepia', 0.2);
      if (p < 1) c.fillText(w.w, x, y);
      if (p > 0) {
        c.save();
        c.beginPath(); c.rect(x - 4, y - lay.size, (lay.ws[i]! + 8) * p, lay.size * 2); c.clip();
        c.fillStyle = p < 1 ? rgba('blood') : rgba('sepia', 0.95);
        c.fillText(w.w, x, y);
        c.restore();
      }
    });
    c.restore();
    return yMin < 1e8 ? [Math.round(x0 - 10), Math.round(yMin - lay.size * 0.7), Math.round(lay.width + 20), Math.round(yMax - yMin + lay.size * 1.4)] : null;
  }
}
