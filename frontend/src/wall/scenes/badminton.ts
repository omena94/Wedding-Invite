// 羽球對打（暗、sport）：夜裡的體育館，側面看宣文與孟庭隔網對打。
//  - 擊球一定落在拍點上：每一拍（快歌兩拍）一球，宣文、孟庭輪流打；揮拍用 _couple 的 swing（預備 → 擊球 = 拍點 → 隨揮）。
//    小節線上的那一球是跳殺（跳起來、球壓低直直往下），其他是高遠球。對手在對方擊球那一刻原地小跳（split step）。
//  - 羽球飛過的拋物線留下訊號色的細線（加亮、會發光），擊球的瞬間拍面炸一圈短線。
//  - 歌詞沿著高遠球的弧線排（lyricOnPath），比留言小一級，球就從字上面飛過去。
//  - **焦點是主打留言**：寫在右邊吊著的記分板上（有厚度、頂上打光、兩條吊鍊，是體育館裡的東西，不是介面卡片），
//    字最大；板子上只留一個小小的「LOVE · ALL」（羽球開賽的報分：零比零）。沒有留言時板子寫邀請。
//  - 鏡頭：整個窗格慢慢推近、往記分板那邊飄一點；大鼓時輕輕一頓。
//  - 開場：仙女棒的火花把兩個人的線稿描出來（約半秒），之後才發球。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, prog } from '../engine/util';
import { lyricAt, beatAfter, sparkHead, sparkParticles, msgChars } from './_motifs';
import { drawPerson, inkFor, inkLine, POSE, beatSwing, racket, racketHead, shuttle, arcAt, arcPts, lyricOnPath, fitNote, drawNote, type Pt, type Pose, type Note } from './_couple';

export const spec: PlateSpecDecl = { group: 'couple', family: 'sport', paper: false, energy: [0.4, 1], bars: [4, 8] };

const FLOOR = 880;
const SZ = 380; // 場景尺度：宣文的身高（px）
const AX = 330, OX = 1080, NET = 705;
/** 記分板（右邊吊著）：最大的尺寸；實際高度跟著留言長短（短的留言不要掛一大塊空板子）。寫字的範圍是板面往內縮一圈。 */
const BOARD = { x: 1236, y: 118, w: 560, h: 640 };
const PAD = { x: 42, top: 78, bottom: 44 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
/** 高遠球比擊球點高多少（px）：頂點上的歌詞字頂要離上緣 96 px 以上。 */
const CLEAR = 172;

interface Hit { t: number; who: 0 | 1; smash: boolean }

/**
 * 體育館的底：天花板的燈讓球場上方一團很淡的光。用 shader 算（浮點＋一點點抖色）：
 * Canvas2D 的淡漸層只有幾個 8 位元的階，大螢幕上會看到一圈一圈的。
 */
const HALL = () => new FSPass(/* glsl */ `
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 q = (p - vec2(760.0, 300.0)) / vec2(950.0, 720.0);
    float lamp = exp(-dot(q, q) * 2.4);
    vec3 col = C_INK + C_BONE * 0.0075 * lamp;
    col += (hash12(p + 0.5) - 0.5) * 0.0025;
    fragColor = vec4(col, 1.0);
  }`);

export default class Badminton extends Scene {
  hall = shared('badminton.hall', HALL);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(4096, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  hits: Hit[] = [];
  /** 兩個人的擊球點（高遠球）。 */
  contact: [Pt, Pt] = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  arc: Pt[] = [];
  note: Note | null = null;
  board = { ...BOARD };
  msgT0 = 0;
  tStart = 0;

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('一位賓客' + INVITE);
    // 擊球點：用擊球那一格的姿勢算（reveal 0 = 只算不畫）
    const c = this.fg.ctx;
    const a = drawPerson(c, 'alan', POSE.swing(0), { x: AX, y: FLOOR, h: SZ, reveal: 0 });
    const o = drawPerson(c, 'omena', POSE.swing(0), { x: OX, y: FLOOR, h: SZ, dir: -1, reveal: 0 });
    this.contact = [racketHead(a.handA, a.handAngA, { h: SZ }), racketHead(o.handA, o.handAngA, { h: SZ })];
    this.arc = arcPts(this.contact[0], this.contact[1], CLEAR, 64);
    // 擊球表：開場描線之後第一個拍點發球，一拍一球（太快的歌兩拍一球）；小節線上的是跳殺
    this.tStart = this.ctx.start + 0.55;
    const step = au.beatPeriod(this.ctx.start) < 0.38 ? 2 : 1;
    let b = Math.ceil(au.beatAt(beatAfter(au, this.tStart + 0.2)) - 1e-6);
    let who: 0 | 1 = 0;
    for (let k = 0; k < 200; k++) {
      const t = au.timeOfBeat(b);
      if (t > this.ctx.end + 1) break;
      const bar = au.barAt(t);
      this.hits.push({ t, who, smash: k > 0 && Math.abs(bar - Math.round(bar)) < 0.05 });
      who = who ? 0 : 1;
      b += step;
    }
    // 留言：字級依「板面扣掉署名那一列」來算，署名永遠在最後一行下面
    const w = BOARD.w - PAD.x * 2, h = BOARD.h - PAD.top - PAD.bottom;
    this.note = this.msg ? fitNote(c, this.msg.text, this.msg.name, w, h, { min: 46, max: 88 }) : fitNote(c, INVITE, null, w, h * 0.5, { min: 44, max: 56 });
    this.board.h = Math.min(BOARD.h, Math.max(340, PAD.top + this.note.height + PAD.bottom + 40));
    this.msgT0 = this.hits[0]?.t ?? this.ctx.start + 0.6;
    this.drawBackground();
  }

  /** 不會動的：球場地板、場線、網子、記分板（畫一次）。 */
  private drawBackground() {
    const c = this.bg.ctx, ink = inkFor(false);
    this.bg.clear();
    // 地板：比底色亮一點點的一條，往遠處淡掉
    const g = c.createLinearGradient(0, FLOOR - 40, 0, H);
    g.addColorStop(0, rgba('ink2', 0));
    g.addColorStop(0.2, rgba('ink2', 1));
    g.addColorStop(1, rgba('ink2', 0.6));
    c.fillStyle = g;
    c.fillRect(0, FLOOR - 40, W, H - FLOOR + 40);
    inkLine(c, [{ x: 90, y: FLOOR }, { x: 1830, y: FLOOR }], { ink, w: 0.8, t: 0, seed: 3 });
    // 場線（透視的地板線，很淡）
    c.strokeStyle = rgba('bone', 0.08);
    c.lineWidth = 1.5;
    for (const x of [150, 560, NET, 850, 1260]) { c.beginPath(); c.moveTo(x, FLOOR + 4); c.lineTo(x + (x - NET) * 0.35, FLOOR + 70); c.stroke(); }
    c.beginPath(); c.moveTo(60, FLOOR + 36); c.lineTo(1860, FLOOR + 36); c.stroke();
    // 網子：側面看幾乎是「側著」的，所以畫成稍微斜一點的平行四邊形（近的柱子低一點、遠的高一點），網面細格、上緣白帶
    const nh = SZ * 0.86, band = SZ * 0.2;
    const n0 = { x: NET - 20, y: FLOOR + 24 }, n1 = { x: NET + 22, y: FLOOR - 14 };
    const top0 = { x: n0.x, y: n0.y - nh }, top1 = { x: n1.x, y: n1.y - nh };
    c.save();
    c.strokeStyle = rgba('bone', 0.16);
    c.lineWidth = 1;
    c.beginPath();
    for (let k = 1; k < 7; k++) { const x = n0.x + ((n1.x - n0.x) * k) / 7, y = top0.y + ((top1.y - top0.y) * k) / 7; c.moveTo(x, y); c.lineTo(x, y + band); }
    for (let y = 0; y <= band; y += 8) { c.moveTo(top0.x, top0.y + y); c.lineTo(top1.x, top1.y + y); }
    c.stroke();
    c.restore();
    inkLine(c, [n1, top1], { ink, w: 0.8, t: 0, seed: 4 });
    inkLine(c, [n0, top0], { ink, w: 1.1, t: 0, seed: 5 });
    inkLine(c, [top0, top1], { ink, w: 1.8, t: 0, seed: 7 });
    inkLine(c, [{ x: top0.x, y: top0.y + band }, { x: top1.x, y: top1.y + band }], { ink, w: 0.6, t: 0, seed: 9 });
    // 記分板：兩條吊鍊、下緣看得到板子的厚度、板面上亮下暗（體育館頂上的燈打下來）
    const B = this.board;
    for (const x of [B.x + 70, B.x + B.w - 70]) {
      c.strokeStyle = rgba('bone', 0.3); c.lineWidth = 2; c.setLineDash([7, 5]);
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, B.y - 6); c.stroke();
      c.setLineDash([]);
    }
    c.fillStyle = rgba('ink');
    c.beginPath(); c.moveTo(B.x + 4, B.y + B.h); c.lineTo(B.x + B.w - 4, B.y + B.h); c.lineTo(B.x + B.w - 16, B.y + B.h + 16); c.lineTo(B.x + 16, B.y + B.h + 16); c.closePath(); c.fill();
    inkLine(c, [{ x: B.x + 4, y: B.y + B.h }, { x: B.x + 16, y: B.y + B.h + 16 }, { x: B.x + B.w - 16, y: B.y + B.h + 16 }, { x: B.x + B.w - 4, y: B.y + B.h }], { ink, w: 0.7, t: 0, seed: 23, taper: 0.1 });
    const face = c.createLinearGradient(0, B.y, 0, B.y + B.h);
    face.addColorStop(0, mix('ink2', 0.07));
    face.addColorStop(0.35, rgba('ink2'));
    face.addColorStop(1, rgba('ink'));
    c.fillStyle = face;
    c.fillRect(B.x, B.y, B.w, B.h);
    inkLine(c, [{ x: B.x, y: B.y }, { x: B.x + B.w, y: B.y }, { x: B.x + B.w, y: B.y + B.h }, { x: B.x, y: B.y + B.h }, { x: B.x, y: B.y }], { ink, w: 1, t: 0, seed: 21, taper: 0.05 });
    c.strokeStyle = rgba('bone', 0.1); c.lineWidth = 1;
    c.strokeRect(B.x + 12, B.y + 12, B.w - 24, B.h - 24);
    // 板子上唯一的小字：報分
    c.font = font(F.mono(500), 17);
    c.letterSpacing = '5px';
    c.fillStyle = rgba('ash', 0.55);
    c.fillText('LOVE · ALL', B.x + PAD.x, B.y + 50);
    c.letterSpacing = '0px';
    this.bg.upload();
  }

  /** 這一格：最近一次擊球是第幾球。 */
  private lastHit(t: number) {
    let i = -1;
    for (let k = 0; k < this.hits.length; k++) if (this.hits[k]!.t <= t) i = k;
    return i;
  }

  /** 某個人這一格的姿勢：離他最近的一球決定揮拍進度；對手擊球時小跳一下。 */
  private poseOf(who: 0 | 1, t: number, bp: number): Pose {
    let best: Hit | null = null;
    for (const h of this.hits) if (h.who === who && (!best || Math.abs(h.t - t) < Math.abs(best.t - t))) best = h;
    if (!best) return POSE.swing(-1);
    const p = beatSwing(t, best.t, Math.min(0.42, bp * 0.9), Math.min(0.5, bp));
    const ps = POSE.swing(p);
    if (best.smash) {
      // 跳殺：腳用跳的姿勢，最高點對齊擊球
      const j = POSE.jump(clamp(p * 1.2, -1, 1), 0.12);
      ps.legA = j.legA; ps.legB = j.legB; ps.lift = j.lift;
    }
    // 對手擊球的那一刻：原地小跳（split step）
    let hop = 0;
    for (const h of this.hits) {
      const u = (t - h.t + 0.05) / 0.26;
      if (h.who !== who && u > 0 && u < 1) hop = Math.max(hop, Math.sin(Math.PI * u));
    }
    ps.lift += 0.022 * hop;
    return ps;
  }

  /** 第 k 球的軌跡在 u（0..1）的位置。 */
  private arcOf(k: number, u: number) {
    const h = this.hits[k]!;
    return arcAt(this.contact[h.who], this.contact[h.who ? 0 : 1], h.smash ? 40 : CLEAR, u);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const bp = au.beatPeriod(t);
    this.hall.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const ink = inkFor(false);
    const rv = prog(t, s, s + 0.55, ease.inOutCubic);

    // 歌詞：沿著高遠球的弧線，比留言小一級
    const ly = lyricAt(lyrics, t);
    if (ly) lyricOnPath(c, ly.line, t, this.arc, { family: F.archivo(100, 700), size: this.msg ? 52 : 62, minSize: 48, offset: 18, alpha: ly.k * rv, unsung: rgba('bone', 0.26) });

    // 兩個人
    const a = drawPerson(c, 'alan', this.poseOf(0, t, bp), { x: AX, y: FLOOR, h: SZ, ink, t, reveal: rv });
    const o = drawPerson(c, 'omena', this.poseOf(1, t, bp), { x: OX, y: FLOOR, h: SZ, dir: -1, ink, t, reveal: rv });
    if (rv >= 1) {
      racket(c, a.handA, a.handAngA, { h: SZ, ink, t });
      racket(c, o.handA, o.handAngA, { h: SZ, ink, t, seed: 2 });
    }
    // 描線進場的火花
    for (const j of [a, o]) if (j.pen) { const pn = j.pen; sparkHead(this.glow, pn.x, pn.y, t, 0.8); sparkParticles(this.glow, t, () => pn, { rate: 60, life: 0.3, speed: 160 }); }

    // 羽球與軌跡
    const i = this.lastHit(t);
    if (i >= 0) {
      const h = this.hits[i]!, n = this.hits[i + 1];
      const t1 = n ? n.t : h.t + bp;
      const tau = clamp((t - h.t) / Math.max(0.05, t1 - h.t));
      const u = tau * (1.35 - 0.35 * tau); // 羽球：出去很快、到對面變慢
      // 這一球飛過的路：越靠近球越亮（加亮 → 發光）
      let prev: Pt | null = null;
      const sg = LIN.signal;
      for (let k = 0; k <= 28; k++) {
        const q = this.arcOf(i, (k / 28) * u);
        if (prev) { const w = k / 28; this.glow.seg2(prev.x, prev.y, q.x, q.y, 1.2 + 1.6 * w, [sg[0] * 2.2, sg[1] * 2.2, sg[2] * 2.2], 0.15 + 0.7 * w * w); }
        prev = q;
      }
      // 上一球的弧線慢慢淡掉
      if (i > 0) {
        const fade = 1 - prog(t, h.t, h.t + bp * 1.2);
        if (fade > 0) { const pts: Pt[] = []; for (let k = 0; k <= 24; k++) pts.push(this.arcOf(i - 1, k / 24)); this.glow.polyline(pts, 1, [sg[0] * 1.2, sg[1] * 1.2, sg[2] * 1.2], 0.3 * fade); }
      }
      const q = this.arcOf(i, u);
      shuttle(c, q.x, q.y, q.ang, { ink, t, h: SZ });
      // 擊球的瞬間：拍面炸一圈短線
      const k = 1 - clamp((t - h.t) / 0.16);
      if (k > 0) {
        const cp = this.contact[h.who], e = LIN.ember;
        for (let r = 0; r < 7; r++) {
          const ang = (r / 7) * Math.PI * 2 + 0.3, r0 = 16 + (1 - k) * 30, r1 = r0 + 14 * k;
          this.glow.seg2(cp.x + Math.cos(ang) * r0, cp.y + Math.sin(ang) * r0, cp.x + Math.cos(ang) * r1, cp.y + Math.sin(ang) * r1, 2, [e[0] * 3, e[1] * 3, e[2] * 3], k);
        }
      }
    } else if (t > s + 0.3 && this.hits.length) {
      // 發球前：球在宣文手上方
      const cp = this.contact[0];
      shuttle(c, cp.x + 6, cp.y + 30, Math.PI / 2, { ink, t, h: SZ });
    }

    this.drawMessage(c, t);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：整個窗格慢慢推近、往記分板那邊飄；大鼓時輕輕一頓（最多推 1.035 倍，字離邊界的距離已經算進去）
    const push = ease.inOutCubic(f.p);
    return { bloom: 0.7, vignette: 0.5, zoom: 1 + 0.03 * push + 0.004 * f.a.kick, shake: [-26 * push, 4 * push] };
  }

  /** 記分板上的主打留言：第一球起一個字一個字翻出來，寫完署名淡入；在板面上垂直置中。 */
  private drawMessage(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const B = this.board;
    const x = B.x + PAD.x, top = B.y + PAD.top, h = B.h - PAD.top - PAD.bottom;
    const y = top + Math.max(0, (h - n.height) * 0.42);
    const total = msgChars(n.fit);
    const per = clamp(1.4 / Math.max(1, total), 0.025, 0.09);
    const chars = this.msg ? Math.max(0, (t - this.msgT0) / per) : Infinity;
    const done = this.msgT0 + total * per;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.7);
    drawNote(c, n, x, y, { chars, color: this.msg ? rgba('bone', 0.97) : rgba('ash', 0.85), sigColor: rgba('ash', 0.95), sigK: prog(t, done + 0.1, done + 0.5) });
    c.restore();
  }
}

/** 底色往紙白混一點（板面頂上被燈照到）。 */
const mix = (k: string, a: number) => {
  const p = rgba(k).match(/\d+/g)!.map(Number), q = rgba('bone').match(/\d+/g)!.map(Number);
  return `rgba(${[0, 1, 2].map((i) => Math.round(p[i]! + (q[i]! - p[i]!) * a)).join(',')},1)`;
};
