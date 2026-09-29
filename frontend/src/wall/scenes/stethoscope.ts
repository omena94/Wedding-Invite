// 聽心跳（亮、work）：白天乾淨明亮的診間一角。宣文站著（連帽外套敞開），孟庭（護理服）用聽診器聽他的胸口，牆上的心電圖跟著歌的速度跳。
// 角色是 Codex 畫的紙偶（_puppet.ts，work 組）；診間、心電圖、病歷夾、愛心用程式畫。**不畫醫院名稱、血、針、病人。**
//  - 心跳就是節拍：每一拍心電圖跳一下（波形的尖峰落在拍點上）、聽頭那裡一圈淡淡的「咚」、宣文的胸口一起一伏。
//  - 小節線上的三件事（窗格短時往前擠）：孟庭抬頭看他、驚喜地笑 → 心跳變成兩倍（半拍一下）、讀數翻倍；
//    下一個小節線宣文害羞地摸後腦勺，胸口每拍冒一顆小愛心；最後一個小節線心電圖畫出一顆愛心。
//  - **焦點是主打留言**：寫在左邊牆上掛著的病歷夾上（木頭夾板、金屬夾子、紙），深墨手寫字、署名；照「留言尺寸與版面比例標準 v2」：
//    字 40～60、夾板最大 560 × 430，放在畫面左側，高度跟著留言長短。夾板上只有一行小小的表頭與一行冷面的診斷。
//    沒有留言時病歷寫邀請、字淡，歌詞變主角。
//  - 歌詞寫在心電圖下面的牆上，比留言小一級（標準 v2：40～52）。
//  - 鏡頭：整個窗格慢慢推近兩個人與心電圖。進場：紙偶從側面翻正（仙女棒的火花在腳邊）。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { ease, prog } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, heartPoints } from './_motifs';
import { inkFor, inkLine, inkPoly, inkRect, inkEllipse, hatch, paperBG, heartPop, type Pt, type Note } from './_couple';
import { loadPuppets, drawPick, puppetPoint, puppetShadow, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { INVITE, enter, writeNote, barsIn, at } from './_c7';

export const spec: PlateSpecDecl = { group: 'couple', family: 'work', paper: true, energy: [0.2, 0.85], bars: [4, 8] };

const FLOOR = 900;
const SZ = 600;
/** 宣文站的位置。孟庭的位置在 init 算：她的聽頭剛好按在宣文的胸口。 */
const AL_X = 820;
/** 左邊牆上的病歷夾：最大的範圍（上緣掛在釘子上、高度跟著留言）與寫字的內距。 */
const CLIP = { x: 104, y: 128, w: 640, h: 430 };
const PAD = { x: 42, top: 92, bottom: 58 };
/** 右上牆上的心電圖（螢幕）與下面的歌詞。 */
const ECG = { x: 1290, y: 150, w: 520, h: 250 };
const LYR = { x: 1300, y: 470, w: 500 };
/** 窗戶（兩個人頭上）。 */
const WIN = { x: 800, y: 110, w: 360, h: 190 };
const POSES = ['xw_work_stand', 'xw_work_stand_blush', 'mt_work_listen', 'mt_work_listen_smile'];
const DX = '診斷：心搏過速（良性，預計持續一輩子）';

export default class Stethoscope extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  clip = { ...CLIP };
  lyricSize = 52;
  omX = 1060;
  chest: Pt = { x: 0, y: 0 };
  /** 事件：抬頭（心跳變兩倍）、害羞（冒愛心）、心電圖畫愛心（-1 = 沒有）。 */
  tLook = 0;
  tBlush = 0;
  tHeart = -1;
  msgT0 = 0;

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('病歷 · 聽診紀錄一位賓客HR BPM♥×2（深呼吸）' + DX + INVITE);
    this.track(await loadPuppets(POSES));
    const bars = barsIn(au, this.ctx.start, this.ctx.end, 0.5);
    const n = bars.length;
    this.tLook = at(bars, n >= 4 ? 1 : 0);
    this.tBlush = at(bars, n >= 4 ? 2 : Math.min(1, n - 1));
    if (this.tBlush <= this.tLook) this.tBlush = this.tLook + au.beatPeriod(this.tLook) * 2;
    // 愛心畫在倒數第二個小節線（窗格夠長時），最後一小節留給它停在畫面上
    this.tHeart = n >= 5 ? at(bars, n - 2) : n >= 3 ? at(bars, n - 1) : -1;
    // 孟庭的聽頭按在宣文的胸口：先量宣文胸口在畫面上的位置，再把孟庭（翻過來面向左）移過去
    this.chest = puppetPoint('xw_work_stand', 'chest', AL_X, FLOOR, { h: SZ }) ?? { x: AL_X + SZ * 0.12, y: FLOOR - SZ * 0.5 };
    const bell = puppetPoint('mt_work_listen', 'bell', 0, FLOOR, { h: SZ, flip: true });
    this.omX = bell ? this.chest.x - bell.x + 4 : AL_X + SZ * 0.55;
    // 病歷夾上的留言：標準 v2 的字級；夾板的寬高跟著留言
    const c = this.fg.ctx;
    const w = CLIP.w - PAD.x * 2, hmax = CLIP.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const cw = Math.min(CLIP.w, Math.max(480, tightenNote(c, this.note, 300) + PAD.x * 2));
    const ch = Math.min(CLIP.h, Math.max(300, PAD.top + this.note.height + PAD.bottom + 12));
    this.clip = { x: CLIP.x, y: CLIP.y, w: cw, h: ch };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.msgT0 = Math.min(this.ctx.start + 0.9, bars[0]!);
    this.drawBackground();
  }

  /** 不會動的：地板、窗戶、心電圖的外框與支架、病歷夾（畫一次）。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx, ink = inkFor(true);
    L.clear();
    // 地板與牆腳（很淡）
    inkLine(c, [{ x: 60, y: FLOOR }, { x: 1860, y: FLOOR - 1 }], { ink, w: 0.8, seed: 2 });
    c.strokeStyle = rgba('sepia', 0.12); c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(60, FLOOR - 26); c.lineTo(1860, FLOOR - 27); c.stroke();
    // 窗戶：白天的光（比紙亮一點）、十字窗框、右邊一片收起來的布簾
    const Wn = WIN;
    c.fillStyle = mixRgba('bone', 'shirtblue', 0.18);
    c.fillRect(Wn.x, Wn.y, Wn.w, Wn.h);
    inkRect(c, Wn.x, Wn.y, Wn.w, Wn.h, { ink, w: 1, seed: 4 });
    inkLine(c, [{ x: Wn.x + Wn.w / 2, y: Wn.y }, { x: Wn.x + Wn.w / 2, y: Wn.y + Wn.h }], { ink, w: 0.7, seed: 5 });
    inkLine(c, [{ x: Wn.x, y: Wn.y + Wn.h * 0.45 }, { x: Wn.x + Wn.w, y: Wn.y + Wn.h * 0.45 }], { ink, w: 0.7, seed: 6 });
    inkLine(c, [{ x: Wn.x - 20, y: Wn.y + Wn.h + 6 }, { x: Wn.x + Wn.w + 20, y: Wn.y + Wn.h + 6 }], { ink, w: 1.1, seed: 7 });
    const cur = [{ x: Wn.x + Wn.w - 30, y: Wn.y - 14 }, { x: Wn.x + Wn.w + 46, y: Wn.y - 14 }, { x: Wn.x + Wn.w + 60, y: Wn.y + Wn.h + 40 }, { x: Wn.x + Wn.w - 10, y: Wn.y + Wn.h + 40 }];
    inkPoly(c, cur, { ink, w: 0.6, seed: 8, fill: mixRgba('paper', 'shirtblue', 0.25) });
    hatch(c, cur, { ink, angle: 1.45, gap: 14, w: 0.3, color: rgba('sepia', 0.18) });
    inkLine(c, [{ x: Wn.x - 40, y: Wn.y - 16 }, { x: Wn.x + Wn.w + 80, y: Wn.y - 16 }], { ink, w: 0.8, seed: 9 });
    // 窗外很淡的雲
    c.strokeStyle = rgba('sepia', 0.14); c.lineWidth = 1.2;
    c.beginPath(); c.arc(Wn.x + 90, Wn.y + 60, 18, Math.PI, 0); c.arc(Wn.x + 120, Wn.y + 56, 24, Math.PI, 0); c.arc(Wn.x + 150, Wn.y + 62, 16, Math.PI, 0); c.stroke();
    // 心電圖：牆上的支架、深色的螢幕、外框
    const E = ECG;
    inkLine(c, [{ x: E.x + E.w * 0.5, y: E.y + E.h }, { x: E.x + E.w * 0.5, y: E.y + E.h + 30 }, { x: E.x + E.w * 0.5 + 90, y: E.y + E.h + 30 }], { ink, w: 1.2, seed: 11 });
    inkRect(c, E.x + E.w * 0.5 + 84, E.y + E.h + 18, 14, 26, { ink, w: 0.8, seed: 13, fill: mixRgba('paper', 'graphite', 0.3) });
    c.fillStyle = rgba('sepia', 0.12);
    c.fillRect(E.x + 10, E.y + 12, E.w, E.h);
    inkRect(c, E.x - 14, E.y - 14, E.w + 28, E.h + 28, { ink, w: 1, seed: 12, r: 14, fill: mixRgba('paper', 'bone', 0.5) });
    c.fillStyle = mixRgba('ink', 'ink2', 0.5);
    c.fillRect(E.x, E.y, E.w, E.h);
    // 螢幕上很淡的格線
    c.strokeStyle = rgba('bone', 0.05); c.lineWidth = 1;
    c.beginPath();
    for (let x = E.x + 20; x < E.x + E.w; x += 40) { c.moveTo(x, E.y + 6); c.lineTo(x, E.y + E.h - 6); }
    for (let y = E.y + 20; y < E.y + E.h; y += 40) { c.moveTo(E.x + 6, y); c.lineTo(E.x + E.w - 6, y); }
    c.stroke();
    this.drawClipboard(c, ink);
    L.upload();
  }

  /** 病歷夾：牆上一根釘子吊著，木頭夾板、上面一個金屬夾子、夾著一張紙；紙上一行表頭、最下面一行冷面的診斷。 */
  private drawClipboard(c: CanvasRenderingContext2D, ink: ReturnType<typeof inkFor>) {
    const K = this.clip;
    // 釘子與掛繩
    inkLine(c, [{ x: K.x + K.w / 2 - 60, y: K.y + 8 }, { x: K.x + K.w / 2, y: K.y - 40 }, { x: K.x + K.w / 2 + 60, y: K.y + 8 }], { ink, w: 0.6, seed: 20 });
    c.fillStyle = rgba('sepia', 0.8);
    c.beginPath(); c.arc(K.x + K.w / 2, K.y - 42, 5, 0, Math.PI * 2); c.fill();
    // 影子、夾板
    c.fillStyle = rgba('sepia', 0.1);
    c.fillRect(K.x + 10, K.y + 12, K.w, K.h);
    inkRect(c, K.x, K.y, K.w, K.h, { ink, w: 1.1, seed: 21, r: 10, fill: mixRgba('paper', 'fur', 0.3) });
    // 紙
    const P = { x: K.x + 18, y: K.y + 30, w: K.w - 36, h: K.h - 44 };
    inkPoly(c, [{ x: P.x, y: P.y }, { x: P.x + P.w, y: P.y + 1 }, { x: P.x + P.w - 1, y: P.y + P.h }, { x: P.x + 1, y: P.y + P.h - 1 }], { ink, w: 0.6, seed: 22, fill: rgba('bone') });
    // 夾子
    inkRect(c, K.x + K.w / 2 - 70, K.y + 6, 140, 40, { ink, w: 0.9, seed: 23, r: 8, fill: mixRgba('paper', 'graphite', 0.35) });
    inkEllipse(c, K.x + K.w / 2, K.y + 26, 16, 7, 0, { ink, w: 0.6, seed: 24 });
    // 表頭（小、淡）與表頭下的一條線
    c.font = font(F.hei(500), 18);
    c.letterSpacing = '6px';
    c.fillStyle = rgba('sepia', 0.5);
    c.fillText('病歷 · 聽診紀錄', P.x + 24, K.y + 80);
    c.letterSpacing = '0px';
    c.strokeStyle = rgba('sepia', 0.18); c.lineWidth = 1;
    c.beginPath(); c.moveTo(P.x + 24, K.y + 90); c.lineTo(P.x + P.w - 24, K.y + 90); c.stroke();
    // 最下面：冷面的診斷
    c.font = font(F.hei(400), 17);
    c.fillStyle = rgba('sepia', 0.45);
    c.fillText(DX, P.x + 24, K.y + K.h - 26);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t;
    const bp = au.beatPeriod(t);
    this.paper.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();

    this.drawECG(c, t, bp);
    this.drawPeople(c, t);
    this.drawLyric(c, t);
    this.drawMessage(c, t);

    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：慢慢推近兩個人與心電圖（最多 1.03 倍）
    const push = ease.inOutCubic(f.p);
    const cx = (AL_X + ECG.x + ECG.w) / 2, cy = 480;
    return { paper: 1, bloom: 0.25, bloomThreshold: 1.4, halation: 0.03, vignette: 0.24, grain: 0.045, ca: 0.5, zoom: 1 + 0.03 * push, shake: [-(cx - W / 2) * 0.03 * push, -(cy - H / 2) * 0.03 * push] };
  }

  /** 兩個人：宣文站著（胸口每拍一起一伏，之後害羞摸頭）；孟庭聽（每拍往前靠一點），之後抬頭笑。 */
  private drawPeople(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, s = this.ctx.start;
    const kick = beatKick(au, t, 0.25);
    const shade = '70,45,25';
    const ea = enter(this.glow, t, s + 0.05, AL_X, FLOOR - 6, 1);
    if (ea) {
      puppetShadow(c, 'xw', AL_X, FLOOR, { h: SZ, alpha: 0.3 * ea.alpha, color: shade });
      const o: PuppetOpts = { h: SZ, spin: ea.spin, alpha: ea.alpha, pivot: 0.3, squash: -0.012 * kick + breathe(t, 0.008, 3) };
      drawPick(c, [[-1e9, 'xw_work_stand'], [this.tBlush, 'xw_work_stand_blush']], t, AL_X, FLOOR, o);
    }
    const eo = enter(this.glow, t, s + 0.16, this.omX, FLOOR - 6, 2);
    if (eo) {
      puppetShadow(c, 'mt', this.omX, FLOOR, { h: SZ, alpha: 0.3 * eo.alpha, color: shade });
      // 抬頭的那一下：整個人往上一送（驚喜）
      const up = 0.04 * Math.exp(-Math.max(0, t - this.tLook) / 0.15) * (t >= this.tLook ? 1 : 0);
      const o: PuppetOpts = { h: SZ, flip: true, spin: eo.spin, alpha: eo.alpha, pivot: 0.1, rot: -0.012 * kick, squash: -up + breathe(t, 0.008, 3.3, 0.4) };
      drawPick(c, [[-1e9, 'mt_work_listen'], [this.tLook, 'mt_work_listen_smile']], t, this.omX, FLOOR, o);
    }
    // 聽頭那裡：每一拍一圈淡淡的「咚」（心跳變快之後半拍也有）
    if (t > s + 0.5) {
      const k = this.pulse(t);
      if (k > 0.02) {
        c.save();
        c.strokeStyle = rgba('sepia', 0.35 * k);
        c.lineWidth = 1.6;
        for (const r of [22, 38]) { c.beginPath(); c.arc(this.chest.x, this.chest.y, r + (1 - k) * 18, -0.9, 0.9); c.stroke(); c.beginPath(); c.arc(this.chest.x, this.chest.y, r + (1 - k) * 18, Math.PI - 0.9, Math.PI + 0.9); c.stroke(); }
        c.restore();
      }
    }
    // 害羞之後：胸口每拍冒一顆小愛心；心電圖畫出愛心的那一刻多冒三顆
    if (t >= this.tBlush) {
      const b0 = Math.ceil(au.beatAt(this.tBlush) - 1e-6), b1 = Math.floor(au.beatAt(t));
      for (let b = Math.max(b0, b1 - 2); b <= b1; b++) {
        const k = (t - au.timeOfBeat(b)) / 1.2;
        // 冒在胸口與孟庭之間（往右上飄），不要蓋到兩個人的臉
        heartPop(c, this.chest.x + 34 + (b % 3) * 22, this.chest.y + 10 - (b % 2) * 18, 22, k);
      }
    }
    if (this.tHeart > 0) for (let i = 0; i < 3; i++) heartPop(c, (AL_X + this.omX) / 2 - 60 + i * 60, FLOOR - SZ * 1.1 - (i % 2) * 16, 32 + i * 5, (t - this.tHeart - i * 0.12) / 1.4);
  }

  /** 心跳的強度（0..1）：拍點上 1、很快退掉；抬頭之後半拍也跳一下。 */
  private pulse(t: number) {
    const au = this.ctx.audio;
    const k = beatKick(au, t, 0.16);
    if (t < this.tLook) return k;
    const b = au.beatAt(t), half = au.timeOfBeat(Math.floor(b) + 0.5);
    const u = t - half;
    return Math.max(k, u >= 0 ? Math.exp((-3 * u) / 0.16) : 0);
  }

  /**
   * 心電圖：一條訊號色的線從左掃到右（一小節掃一次，前面一小段擦掉），尖峰就是拍點（抬頭之後半拍也有）；
   * 最後一個小節線：線畫出一顆愛心。右上角小小的讀數（這首歌的 BPM，心跳變快之後翻倍）。
   */
  private drawECG(c: CanvasRenderingContext2D, t: number, bp: number) {
    const au = this.ctx.audio, E = ECG;
    const x0 = E.x + 18, x1 = E.x + E.w - 18, mid = E.y + E.h * 0.58, amp = E.h * 0.36;
    const sweep = bp * 4;
    const phase = ((t - this.ctx.start) / sweep) % 1;
    const headX = x0 + (x1 - x0) * phase;
    // 某個時間點的波形高度：每拍一個 QRS（小小往下、大大往上、再往下），抬頭之後半拍也一個
    const qrs = (d: number) => (d < -0.05 || d > 0.08 ? 0 : d < -0.02 ? -0.12 * Math.sin(((d + 0.05) / 0.03) * Math.PI) : d < 0.02 ? Math.sin(((d + 0.02) / 0.04) * Math.PI) : -0.25 * Math.sin(((d - 0.02) / 0.06) * Math.PI));
    const wave = (tau: number) => {
      const b = au.beatAt(tau), i = Math.round(b);
      let v = qrs(tau - au.timeOfBeat(i));
      if (tau >= this.tLook) { const j = Math.round(b - 0.5) + 0.5; v += 0.8 * qrs(tau - au.timeOfBeat(j)); }
      return v;
    };
    const heartK = this.tHeart > 0 ? prog(t, this.tHeart, this.tHeart + bp * 1.5, ease.inOutCubic) : 0;
    c.save();
    c.beginPath(); c.rect(E.x, E.y, E.w, E.h); c.clip();
    c.lineCap = 'round'; c.lineJoin = 'round';
    if (heartK < 1) {
      // 掃描線：頭後面的一段是這一次掃的、前面（擦掉的空隙之後）是上一次掃的
      c.strokeStyle = rgba('signal', 0.95 * (1 - heartK));
      c.lineWidth = 3;
      c.beginPath();
      let pen = false;
      for (let x = x0; x <= x1; x += 3) {
        const u = (x - x0) / (x1 - x0);
        const gap = u > phase && u < phase + 0.06;
        if (gap) { pen = false; continue; }
        const tau = t - ((phase - u + (u > phase ? 1 : 0)) * sweep);
        const y = mid - wave(tau) * amp;
        if (!pen) { c.moveTo(x, y); pen = true; } else c.lineTo(x, y);
      }
      c.stroke();
      // 掃描頭：發光的小點
      const hy = mid - wave(t) * amp, sg = LIN.signal;
      this.glow.seg2(headX, hy, headX + 0.01, hy, 10, [sg[0] * 3, sg[1] * 3, sg[2] * 3], 0.9 * (1 - heartK));
    }
    if (heartK > 0) {
      // 最後：線畫出一顆愛心（從凹口開始描一圈）
      const pts = heartPoints(80), n = Math.floor(pts.length * heartK);
      const hx = E.x + E.w / 2, hy = E.y + E.h * 0.46, sz = E.h * 0.36;
      c.strokeStyle = rgba('rose', 0.95);
      c.lineWidth = 4;
      c.beginPath();
      for (let i = 0; i <= n && i < pts.length; i++) { const p = pts[i]!; const X = hx + p.x * sz, Y = hy + p.y * sz; i ? c.lineTo(X, Y) : c.moveTo(X, Y); }
      c.stroke();
    }
    c.restore();
    // 讀數：小、淡（這首歌的速度；心跳變快之後翻倍）
    const bpm = Math.round(60 / bp) * (t >= this.tLook ? 2 : 1);
    c.save();
    c.font = font(F.mono(500), 20);
    c.fillStyle = rgba('bone', 0.55);
    c.fillText(`HR ${bpm}`, E.x + 18, E.y + 32);
    c.fillStyle = rgba('rose', 0.5 + 0.5 * this.pulse(t));
    c.fillText('♥', E.x + 18 + c.measureText(`HR ${bpm} `).width, E.y + 32);
    c.restore();
  }

  /** 心電圖下面的牆上：歌詞照跟唱規則逐字亮。間奏與純音樂時留一行淡淡的「（深呼吸）」。 */
  private drawLyric(c: CanvasRenderingContext2D, t: number) {
    const ly = lyricAt(this.ctx.lyrics, t);
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.7);
    if (ly) {
      const big = !this.msg;
      const st = { family: F.archivo(100, big ? 800 : 700), size: this.lyricSize, minSize: 40, maxWidth: LYR.w, unsung: rgba('sepia', 0.24), sung: rgba('sepia', big ? 0.94 : 0.82), active: rgba('signal') };
      const lay = layoutLyric(c, ly.line, st);
      c.translate(LYR.x, LYR.y + lay.size * 0.84);
      drawLyric(c, ly.line, t, st, lay, ly.k);
    } else {
      c.font = font(F.hand(400), 40);
      c.fillStyle = rgba('sepia', 0.4);
      c.fillText('（深呼吸）', LYR.x, LYR.y + 40);
    }
    c.restore();
  }

  /** 病歷紙上的留言：一個字一個字寫上去，寫完署名淡入；在表頭與診斷之間垂直置中。 */
  private drawMessage(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const K = this.clip;
    const top = K.y + PAD.top, h = K.h - PAD.top - PAD.bottom;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.6);
    writeNote(c, n, K.x + PAD.x, top + Math.max(0, (h - n.height) * 0.45), t, this.msgT0, { msg: !!this.msg, color: rgba('sepia', 0.95), faint: rgba('sepia', 0.6), sig: rgba('sepia', 0.72) });
    c.restore();
  }
}

