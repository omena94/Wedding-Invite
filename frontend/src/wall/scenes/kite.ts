// 放風箏（亮、date）：草坡上，宣文拉著風箏線、孟庭指著天上；一只長方形的和紙風箏在上面飄，**留言就寫在風箏上**，
// 風往右吹，風箏的長尾巴往右下飄，**歌詞沿著尾巴排**（逐字亮）。芃芃和 QQ 在坡下跑來跑去。角色是 Codex 畫的紙偶（_puppet.ts）。
//  - 每個小節線宣文用力扯一下線（pull_2，半拍後回 pull_1）：風箏往上一竄、歪一下再擺回來，線從手到風箏抖一道波；
//    其他拍點線也輕輕抖一下。孟庭指著風箏，隔一個小節線跳起來歡呼一次。
//  - 狗：兩小節跑一趟（一拍兩步），在小節線上跳起來轉身往回跑。
//  - **焦點是主打留言**：風箏面（米白和紙、竹骨是四邊與中間一條很淡的線、四角加一點點深色）照「留言尺寸與版面比例標準 v2」：
//    字 40～60、風箏面最大 640 × 360；字先畫在暫存畫布上，風箏晃的時候整張貼圖轉（不用每格重新光柵化斜的字）。
//    沒有留言時風箏上寫邀請、字淡，歌詞變主角。
//  - 背景：很淡的遠山、慢慢飄的雲、兩三隻小鳥；草跟著拍子被風吹彎。鏡頭慢慢往上抬向風箏。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { lyricAt, barAfter, sparkHead, sparkParticles, msgChars } from './_motifs';
import { inkFor, paperBG, inkPath, lyricOnPath, drawNote, type Pt, type Note } from './_couple';
import { loadPuppets, drawPuppet, drawPick, drawCycle, puppetShadow, puppetIn, puppetPoint, breathe, beatKick, jumpArc, hop, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { INVITE } from './_c3';

export const spec: PlateSpecDecl = { group: 'couple', family: 'date', paper: true, energy: [0.2, 0.85], bars: [4, 8] };

const SZ = 400, DOG_S = 1.2;
/** 兩人站在左邊的坡頂，風箏在右上方高高的地方：線要夠長、斜斜往上，看起來才是在「放」風箏。 */
const AL_X = 400, OM_X = 215;
/** 風箏面：中心、最大寬高（標準 v2）與寫字內距。 */
const KITE = { cx: 1010, cy: 236, w: 620, h: 350 };
const PAD = { x: 46, top: 40, bottom: 34 };
/** 狗跑的範圍。 */
const RUN = { a: 660, b: 1080 };
const SPRITES = ['xw_kite_pull_1', 'xw_kite_pull_2', 'mt_kite_point', 'mt_cheer', 'pp_run_1', 'pp_run_2', 'pp_jump', 'qq_run_1', 'qq_run_2', 'qq_jump'];

/** 草坡：左邊一個緩緩的坡頂（兩人站在上面），往右慢慢低下去。 */
const ground = (x: number) => 925 - 70 * Math.exp(-(((x - 380) / 520) ** 2));

export default class Kite extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  face = { w: KITE.w, h: KITE.h };
  faceCv = new OffscreenCanvas(KITE.w + 40, KITE.h + 40);
  faceKey = -1;
  /** 每個小節線（扯線、狗轉身）。 */
  bars: number[] = [];
  alKeys: [number, string][] = [];
  omKeys: [number, string][] = [];
  lyricSize = 52;

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('一位賓客' + INVITE);
    this.track(await loadPuppets(SPRITES));
    let b = barAfter(au, this.ctx.start + 0.3);
    for (let k = 0; k < 40 && b < this.ctx.end + 0.1; k++) {
      this.bars.push(b);
      b = au.timeOfBar(Math.round(au.barAt(b)) + 1);
    }
    // 宣文：小節線上扯一下（pull_2），快一拍後放回（pull_1）
    const al: [number, string][] = [[-1e9, 'xw_kite_pull_1']];
    for (const t of this.bars) al.push([t - 0.02, 'xw_kite_pull_2'], [t + au.beatPeriod(t) * 0.9, 'xw_kite_pull_1']);
    this.alKeys = al;
    // 孟庭：指著風箏；每隔一個小節線跳起來歡呼一拍半
    const om: [number, string][] = [[-1e9, 'mt_kite_point']];
    this.bars.forEach((t, i) => { if (i % 2 === 1) om.push([t, 'mt_cheer'], [t + au.beatPeriod(t) * 1.5, 'mt_kite_point']); });
    this.omKeys = om;
    // 風箏面上的留言
    const c = this.fg.ctx;
    const w = KITE.w - PAD.x * 2, hmax = KITE.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.55, { max: 44 });
    this.face.w = Math.min(KITE.w, Math.max(tightenNote(c, this.note, 380) + PAD.x * 2, 460));
    this.face.h = Math.min(KITE.h, Math.max(220, PAD.top + this.note.height + PAD.bottom + 8));
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.drawBackground();
  }

  /** 不會動的：遠山、草坡的輪廓與顏色。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    // 遠山：一層很淡、緩緩起伏的稜線（只是空氣）
    const ridge = (x: number) => 730 - 60 * (0.5 + 0.5 * Math.sin(x / 330 + 1.2)) - 26 * Math.sin(x / 140 + 0.4) * Math.sin(x / 520);
    c.fillStyle = mixRgba('paper', 'sepia', 0.045);
    c.beginPath();
    c.moveTo(0, H);
    for (let x = 0; x <= W; x += 16) c.lineTo(x, ridge(x));
    c.lineTo(W, H);
    c.closePath();
    c.fill();
    c.strokeStyle = rgba('sepia', 0.16);
    c.lineWidth = 1.4;
    c.beginPath();
    for (let x = 0; x <= W; x += 16) { if (x) c.lineTo(x, ridge(x)); else c.moveTo(x, ridge(x)); }
    c.stroke();
    // 草坡
    const g = c.createLinearGradient(0, 820, 0, H);
    g.addColorStop(0, mixRgba('paper', 'gingham', 0.18));
    g.addColorStop(1, mixRgba('paper', 'gingham', 0.32));
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(0, H);
    for (let x = 0; x <= W; x += 16) c.lineTo(x, ground(x));
    c.lineTo(W, H);
    c.closePath();
    c.fill();
    c.strokeStyle = rgba('sepia', 0.7);
    c.lineWidth = 1.6;
    c.beginPath();
    for (let x = 0; x <= W; x += 16) { if (x) c.lineTo(x, ground(x)); else c.moveTo(x, ground(x)); }
    c.stroke();
    L.upload();
  }

  /** 風箏這一格的位置與角度：平常隨風左右晃、上下飄；小節線被扯一下往上竄、歪一下再擺回來。 */
  private kiteAt(t: number) {
    const s = this.ctx.start;
    let y = KITE.cy + Math.sin((t - s) * 1.3) * 12, x = KITE.cx + Math.sin((t - s) * 0.7 + 1) * 16, rot = -0.03 + Math.sin((t - s) * 1.1) * 0.045;
    for (const b of this.bars) {
      const d = t - b;
      if (d < 0 || d > 1.2) continue;
      y -= 26 * Math.sin(Math.PI * clamp(d / 0.5)) * Math.exp(-d * 1.5);
      rot += 0.07 * Math.sin(d * 9) * Math.exp(-d * 3.5);
    }
    // 開場：風箏從右下被風帶上來
    const k = ease.outCubic(prog(t, s, s + 1.1));
    return { x: lerp(x + 260, x, k), y: lerp(y + 240, y, k), rot: rot + (1 - k) * 0.4 };
  }

  /** 提線點：風箏下緣往下一點、偏左（線從左下方的宣文拉過來）。 */
  private bridle(k: { x: number; y: number; rot: number }): Pt {
    return this.onKite(k, -this.face.w * 0.16, this.face.h / 2 + 44);
  }

  /** 風箏上的點（相對風箏中心 dx, dy，風箏的座標）→ 畫面。 */
  private onKite(k: { x: number; y: number; rot: number }, dx: number, dy: number): Pt {
    const c = Math.cos(k.rot), s = Math.sin(k.rot);
    return { x: k.x + dx * c - dy * s, y: k.y + dx * s + dy * c };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.paper.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const rv = prog(t, s, s + 0.6, ease.inOutCubic);

    // 雲與小鳥
    const faint = inkFor(true, { line: rgba('sepia', 0.28) });
    for (let i = 0; i < 4; i++) {
      const x = ((150 + i * 520 + (t - s) * 18) % 2300) - 200, y = 110 + (i % 2) * 70 + i * 18;
      inkPath(c, [{ x, y }, { x: x + 50, y: y - 26 }, { x: x + 110, y: y - 30 }, { x: x + 170, y: y - 8 }, { x: x + 210, y }], { ink: faint, w: 0.6, seed: i, t });
    }
    c.save();
    c.strokeStyle = rgba('sepia', 0.5);
    c.lineWidth = 1.6;
    for (let i = 0; i < 3; i++) {
      const bx = ((1500 + i * 90 - (t - s) * 40) % 2200 + 2200) % 2200 - 100, by = 180 + i * 34 + Math.sin(t * 2 + i) * 6;
      const flap = Math.sin(t * 9 + i * 2) * 6;
      c.beginPath(); c.moveTo(bx - 12, by - flap); c.quadraticCurveTo(bx - 5, by - 4, bx, by); c.quadraticCurveTo(bx + 5, by - 4, bx + 12, by - flap); c.stroke();
    }
    c.restore();

    this.drawGrass(c, t);

    // ---- 風箏：尾巴（歌詞）→ 線 → 風箏面
    const k = this.kiteAt(t);
    const tail = this.tailPath(k, t);
    // 尾巴是一條細飄帶（訊號色，往尾端越來越細、越淡）
    c.save();
    c.lineCap = 'round';
    for (let i = 1; i < tail.length; i++) {
      const u = i / tail.length;
      c.strokeStyle = rgba('signal', 0.7 - 0.45 * u);
      c.lineWidth = 4 - 2.6 * u;
      c.beginPath(); c.moveTo(tail[i - 1]!.x, tail[i - 1]!.y); c.lineTo(tail[i]!.x, tail[i]!.y); c.stroke();
    }
    c.restore();
    const ly = lyricAt(lyrics, t);
    if (ly) {
      lyricOnPath(c, ly.line, t, tail.slice(4), { family: F.archivo(100, this.msg ? 600 : 700), size: this.lyricSize, minSize: 40, offset: 10, align: 'start', at: 0.1, alpha: ly.k * rv, unsung: rgba('sepia', 0.26), sung: rgba('sepia', this.msg ? 0.82 : 0.94), active: rgba('signal') });
    }

    // 人（線要從宣文手上出去，所以先畫人）
    this.drawOmena(c, t);
    const hand = this.drawAlan(c, t);
    this.drawLine(c, t, hand, this.bridle(k));
    this.drawKite(c, t, k);
    this.drawDogs(c, t);

    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p);
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.24, grain: 0.045, zoom: 1 + 0.03 * push, shake: [-(KITE.cx - W / 2) * 0.03 * push, -(KITE.cy + 120 - H / 2) * 0.03 * push] };
  }

  /** 尾巴：從風箏下緣往右下飄（順風），一道往尾端傳的波浪；越往尾端擺越大。 */
  private tailPath(k: { x: number; y: number; rot: number }, t: number): Pt[] {
    const a = this.onKite(k, this.face.w * 0.12, this.face.h / 2);
    const pts: Pt[] = [];
    const n = 60, len = 1000;
    for (let i = 0; i <= n; i++) {
      const u = i / n, d = u * len;
      const wave = Math.sin(u * 7 - t * 4.2) * (8 + 34 * u);
      pts.push({ x: a.x + d * 0.93 - wave * 0.3, y: a.y + d * 0.32 + wave * 0.93 + u * u * 60 });
    }
    return pts;
  }

  /** 風箏線：從宣文手上拉到風箏的提線點，中間往下垂一點；拍點上抖一道往上傳的波（小節線那一下最大）。 */
  private drawLine(c: CanvasRenderingContext2D, t: number, a: Pt, b: Pt) {
    const au = this.ctx.audio;
    let amp = 5 * beatKick(au, t, 0.3);
    for (const bt of this.bars) { const d = t - bt; if (d >= 0 && d < 0.8) amp += 16 * Math.exp(-d * 5); }
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
    c.save();
    c.strokeStyle = rgba('sepia', 0.7);
    c.lineWidth = 1.5;
    c.beginPath();
    for (let i = 0; i <= 50; i++) {
      const u = i / 50;
      const sag = 26 * u * (1 - u);
      const w = amp * Math.sin(u * 14 - t * 20) * Math.sin(Math.PI * u);
      const x = a.x + dx * u + nx * w, y = a.y + dy * u + sag + ny * w;
      if (i) c.lineTo(x, y); else c.moveTo(x, y);
    }
    c.stroke();
    c.restore();
  }

  /** 把風箏面（紙、竹骨、出現了的字）畫到暫存畫布；字數沒變就不重畫。 */
  private paintFace(chars: number, sigK: number) {
    const key = chars + Math.round(sigK * 10) * 10000;
    if (key === this.faceKey) return;
    this.faceKey = key;
    const n = this.note!;
    const cv = this.faceCv, c = cv.getContext('2d')! as unknown as CanvasRenderingContext2D;
    const w = this.face.w, h = this.face.h, o = 20;
    c.clearRect(0, 0, cv.width, cv.height);
    const g = c.createLinearGradient(o, o, o, o + h);
    g.addColorStop(0, mixRgba('bone', 'paper', 0.1));
    g.addColorStop(1, mixRgba('bone', 'fur', 0.12));
    c.fillStyle = g;
    c.fillRect(o, o, w, h);
    // 竹骨：四邊一圈、正中間一條直的（很淡，透過和紙看得到）
    c.strokeStyle = mixRgba('fur', 'sepia', 0.5, 0.45);
    c.lineWidth = 3;
    c.strokeRect(o + 4, o + 4, w - 8, h - 8);
    c.strokeStyle = mixRgba('fur', 'sepia', 0.5, 0.12);
    c.beginPath(); c.moveTo(o + w / 2, o + 6); c.lineTo(o + w / 2, o + h - 6); c.stroke();
    // 四角補強的小三角（和紙黏在竹骨上的地方，深一點的紙）
    c.fillStyle = rgba('sepia', 0.16);
    for (const [x, y, sx, sy] of [[o, o, 1, 1], [o + w, o, -1, 1], [o, o + h, 1, -1], [o + w, o + h, -1, -1]] as const) {
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + sx * 34, y); c.lineTo(x, y + sy * 34); c.closePath(); c.fill();
    }
    // 風箏面內側一圈訊號色的描邊（手繪風箏的邊飾）
    c.strokeStyle = rgba('signal', 0.55);
    c.lineWidth = 2;
    c.strokeRect(o + 14, o + 14, w - 28, h - 28);
    const top = o + PAD.top, room = h - PAD.top - PAD.bottom;
    drawNote(c, n, o + PAD.x, top + Math.max(0, (room - n.height) * 0.45), { chars, color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.62), sigColor: rgba('sepia', 0.74), sigK });
  }

  private drawKite(c: CanvasRenderingContext2D, t: number, k: { x: number; y: number; rot: number }) {
    const n = this.note;
    if (!n) return;
    const t0 = this.ctx.start + 0.9;
    const total = msgChars(n.fit);
    const per = clamp(1.5 / Math.max(1, total), 0.03, 0.1);
    const done = t0 + total * per;
    const chars = this.msg ? Math.max(0, Math.floor((t - t0) / per)) : 9999;
    this.paintFace(Math.min(chars, total + 1), this.msg ? Math.round(prog(t, done + 0.1, done + 0.5) * 10) / 10 : 1);
    // 提線：從風箏下緣的兩個角拉到下面的提線點（不從上面兩角拉：線會劃過留言）
    const br = this.bridle(k);
    c.save();
    c.strokeStyle = rgba('sepia', 0.4);
    c.lineWidth = 1.2;
    c.beginPath();
    for (const dx of [-0.5, 0.5]) {
      const p = this.onKite(k, dx * this.face.w, 0.5 * this.face.h);
      c.moveTo(p.x, p.y); c.lineTo(br.x, br.y);
    }
    c.stroke();
    c.translate(k.x, k.y);
    c.rotate(k.rot);
    c.fillStyle = rgba('sepia', 0.08);
    c.fillRect(-this.face.w / 2 + 14, -this.face.h / 2 + 18, this.face.w, this.face.h);
    c.drawImage(this.faceCv as unknown as CanvasImageSource, -this.face.w / 2 - 20, -this.face.h / 2 - 20);
    c.restore();
    void t;
  }

  private drawGrass(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    c.save();
    c.strokeStyle = rgba('sepia', 0.4);
    c.lineWidth = 1.3;
    c.beginPath();
    for (let i = 0; i < 64; i++) {
      const x = 16 + i * 30 + hash(i, 1) * 16, y = ground(x) + 14 + Math.pow(hash(i, 2), 0.8) * (H - ground(x) - 40);
      if (x > 1340 && y > 820) continue;
      const len = 12 + 10 * hash(i, 3);
      const push = 0.3 + beatKick(au, t - x / 4000, 0.4) * 0.35;
      for (const d of [-0.35, 0.1, 0.45]) {
        const ang = -Math.PI / 2 + d + push;
        c.moveTo(x + d * 6, y);
        c.quadraticCurveTo(x + d * 6 + Math.cos(ang) * len * 0.3, y - len * 0.6, x + d * 6 + Math.cos(ang) * len, y + Math.sin(ang) * len);
      }
    }
    c.stroke();
    c.restore();
  }

  /** 宣文：拉線；小節線扯一下（身體往後帶）。回傳手的位置（風箏線的起點）。 */
  private drawAlan(c: CanvasRenderingContext2D, t: number): Pt {
    const au = this.ctx.audio;
    const en = puppetIn(t, this.ctx.start + 0.05, 0.45);
    const y = ground(AL_X);
    let rot = 0;
    for (const b of this.bars) { const d = t - b; if (d >= -0.05 && d < 0.8) rot -= 0.05 * Math.sin(Math.PI * clamp((d + 0.05) / 0.85)); }
    const o: PuppetOpts = { h: SZ, rot, pivot: 0.05, squash: breathe(t, 0.008, 3) + 0.012 * beatKick(au, t, 0.3), spin: en.spin, alpha: en.alpha };
    puppetShadow(c, 'xw', AL_X, y, { h: SZ, alpha: 0.28 * en.alpha, color: '60,50,30' });
    const name = drawPick(c, this.alKeys, t, AL_X, y, o);
    return puppetPoint(name, 'hand', AL_X, y, o) ?? { x: AL_X + SZ * 0.2, y: y - SZ * 0.6 };
  }

  private drawOmena(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const en = puppetIn(t, this.ctx.start + 0.14, 0.45);
    if (en.alpha <= 0) return;
    const y = ground(OM_X);
    let lift = 0, squash = breathe(t, 0.01, 2.8, 0.3) + 0.02 * beatKick(au, t, 0.25);
    this.bars.forEach((b, i) => {
      if (i % 2 !== 1) return;
      const j = jumpArc(t, b, b + au.beatPeriod(b) * 0.8, 40, { crouch: 0.07, land: 0.12 });
      if (j.air) lift = -j.y;
      squash += j.squash;
    });
    puppetShadow(c, 'mt', OM_X, y, { h: SZ, lift, alpha: 0.28 * en.alpha, color: '60,50,30' });
    drawPick(c, this.omKeys, t, OM_X, y - lift, { h: SZ, squash, spin: en.spin, alpha: en.alpha, rot: 0.02 * Math.sin(au.beatAt(t) * Math.PI) });
  }

  /** 狗：兩小節跑一趟，在小節線上跳起來轉身（頂點在小節線）；芃芃跟在 QQ 後面。 */
  private drawDogs(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    for (const who of ['pp', 'qq'] as const) {
      const lag = who === 'pp' ? 0.5 : 0;
      const en = puppetIn(t, this.ctx.start + (who === 'qq' ? 0.25 : 0.35), 0.4);
      if (en.alpha <= 0) continue;
      const bar = au.barAt(t) - lag / 4;
      const leg = Math.floor(bar / 2), u = bar / 2 - leg;
      const dir = leg % 2 === 0 ? 1 : -1;
      const along = 0.5 - 0.5 * Math.cos(Math.PI * u);
      let x = dir > 0 ? lerp(RUN.a, RUN.b, along) : lerp(RUN.b, RUN.a, along);
      if (who === 'pp') x -= dir * 110;
      const y = Math.min(ground(x) + 50, 985);
      // 轉身跳：每一趟的終點（小節線）跳起來
      const tTurn = au.timeOfBar((leg + 1) * 2 + lag / 4);
      const bp = au.beatPeriod(t);
      const j = jumpArc(t, tTurn - bp * 0.4, tTurn + bp * 0.4, 50, { crouch: 0.05, land: 0.14 });
      const jPrev = jumpArc(t, au.timeOfBar(leg * 2 + lag / 4) - bp * 0.4, au.timeOfBar(leg * 2 + lag / 4) + bp * 0.4, 50, { crouch: 0.05, land: 0.14 });
      const J = j.air ? j : jPrev;
      const o: PuppetOpts = { h: SZ, scale: DOG_S, flip: dir < 0, squash: J.squash, spin: en.spin, alpha: en.alpha };
      const b = J.air ? 0 : hop(au.beatAt(t), 2) * 7;
      puppetShadow(c, who, x, y, { h: SZ * DOG_S, lift: J.air ? -J.y : b, alpha: 0.26 * en.alpha, color: '60,50,30' });
      if (J.air) drawPuppet(c, `${who}_jump`, x, y + J.y, { ...o, rot: (-0.2 + 0.4 * J.u) * (dir < 0 ? -1 : 1), pivot: 0.5 });
      else drawCycle(c, au, t, [`${who}_run_1`, `${who}_run_2`], 2, x, y - b, o);
      if (en.k < 1) {
        sparkHead(this.glow, x, y - 4, t, 0.5);
        sparkParticles(this.glow, t, () => ({ x, y: y - 4 }), { rate: 30, life: 0.2, speed: 110, seed: who === 'pp' ? 7 : 8 });
      }
    }
  }
}
