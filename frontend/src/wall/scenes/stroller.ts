// 狗推車散步（亮、dog、雙語）：公園步道上，孟庭推著狗狗推車（元元坐在裡面探頭），宣文牽著芃芃和 QQ 走在前面。
// 角色是 Codex 畫的紙偶（_puppet.ts）。鏡頭跟著大家往右走：人和狗在畫面上原地走（一拍一步），步道、樹、路燈往左捲（遠的慢、近的快）。
//  - 一拍一步：走路兩張圖一拍換一張、拍點上落地一彈；推車跟著每一步輕輕顛一下、元元在裡面跟著晃，每個小節線抬頭一下。
//    每兩小節芃芃停下來聞一聞草（兩拍），被落在後面，再小跑步追回來（牽繩拉長再收回）。
//  - **兩行歌詞寫在草地上的公園指示牌**（右上，遠處）：木頭牌子上下兩塊板，上面中文大字、下面原文小一號（drawLyric 自動畫）；
//    沒有翻譯的歌下面那塊板收起來（牌子變成一塊）。牌子在遠處，跟著遠景慢慢往左移一點。
//  - **焦點是主打留言**：寫在推車上插的一面布旗（旗桿從推車把手往上伸，走路帶起的風把旗子往後吹，布面一波一波地飄），
//    照「留言尺寸與版面比例標準 v2」：字 40～60、旗子最大 600 × 320，高度跟著留言。字先畫在暫存畫布上，布面飄的時候切成直條貼上去。
//  - 地面：步道的磚縫、草叢跟著捲；拍點上草被風吹一下。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, lyricSubOf, barAfter, sparkHead, sparkParticles } from './_motifs';
import { paperBG, leash, inkFor, type Pt, type Note } from './_couple';
import { loadPuppets, drawPuppet, puppetShadow, puppetIn, puppetPoint, breathe, beatKick, hop, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { NoteSheet, writeTiming, parkTree, mainOnly, subLine, layoutSub, drawSub, INVITE } from './_d4';
import type { Lyrics } from '../engine/lyrics';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'dog', paper: true, energy: [0.2, 0.85], bars: [4, 8] };

const SZ = 420, DOG_S = 1.3;
const GROUND = 876, HZ = 600;
/** 每一步（一拍）往前走多遠（畫面往左捲多少 px）。 */
const STRIDE = 70;
/** 人與狗在畫面上的位置（原地走）。三隻狗用同一個場景尺度。 */
const XW_X = 300, QQ_X = 520, PP_X = 660, MT_X = 930;
/** 旗子（留言）：旗子最大的寬高（標準 v2）、寫字內距；旗桿頂端在推車把手上方多高。 */
const FLAG = { w: 600, h: 320 };
const FPAD = { x: 40, top: 34, bottom: 30 };
const POLE_TOP = 150;
/** 遠處的指示牌（歌詞）：位置與大小（兩塊板；沒有原文時只有上面一塊）。 */
const SIGN = { x: 1160, y: 96, w: 650, h: 300 };
const SPRITES = ['xw_dogwalk_1', 'xw_dogwalk_2', 'mt_d4_stroll_1', 'mt_d4_stroll_2', 'pp_dogwalk_1', 'pp_dogwalk_2', 'pp_sniff', 'pp_run_1', 'pp_run_2', 'qq_dogwalk_1', 'qq_dogwalk_2'];

export default class Stroller extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  sheet = new NoteSheet(FLAG.w, FLAG.h, 8);
  lyricSize = 50;
  /** 中景（樹、路燈、長椅）先畫成一條 2 倍寬的長條，捲動時貼兩次。 */
  mid = new OffscreenCanvas(W * 2, HZ + 320);
  /** 芃芃停下來聞的時間（每兩小節一次）。 */
  sniffs: number[] = [];

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('一位賓客' + INVITE + '公園步道 PARK TRAIL');
    this.track(await loadPuppets(SPRITES));
    let b = barAfter(au, this.ctx.start + 0.5);
    for (let k = 0; k < 20 && b < this.ctx.end - au.beatPeriod(b) * 4; k++) { this.sniffs.push(b); b = au.timeOfBar(Math.round(au.barAt(b)) + 2); }
    const c = this.fg.ctx;
    const w = FLAG.w - FPAD.x * 2, hmax = FLAG.h - FPAD.top - FPAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.6, { max: 44 });
    const fw = Math.min(FLAG.w, Math.max(tightenNote(c, this.note, 340) + FPAD.x * 2, 420));
    const fh = Math.min(FLAG.h, Math.max(190, FPAD.top + this.note.height + FPAD.bottom + 6));
    this.sheet = new NoteSheet(fw, fh, 8);
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.drawBackground();
    this.drawMid();
  }

  /** 不會動的：天空（很淡）、遠山、草地的顏色、步道的底色。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    c.strokeStyle = rgba('sepia', 0.16);
    c.lineWidth = 1.4;
    c.beginPath();
    for (let x = 0; x <= W; x += 16) { const y = HZ - 40 - 40 * (0.5 + 0.5 * Math.sin(x / 300 + 0.7)); if (x) c.lineTo(x, y); else c.moveTo(x, y); }
    c.stroke();
    const g = c.createLinearGradient(0, HZ, 0, H);
    g.addColorStop(0, mixRgba('paper', 'gingham', 0.12));
    g.addColorStop(1, mixRgba('paper', 'gingham', 0.28));
    c.fillStyle = g;
    c.fillRect(0, HZ, W, H - HZ);
    // 步道：比草地亮的一條帶子（紅磚色淡淡的）
    c.fillStyle = mixRgba('paper', 'fur', 0.2);
    c.fillRect(0, GROUND - 40, W, 110);
    c.strokeStyle = rgba('sepia', 0.25);
    c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(0, GROUND - 40); c.lineTo(W, GROUND - 40); c.moveTo(0, GROUND + 70); c.lineTo(W, GROUND + 70); c.stroke();
    L.upload();
  }

  /** 中景的長條（畫一次）：幾棵樹、路燈、長椅，左右接得起來（捲動時貼兩次）。 */
  private drawMid() {
    const c = this.mid.getContext('2d')! as unknown as CanvasRenderingContext2D;
    const MW = this.mid.width, gy = HZ + 70;
    c.clearRect(0, 0, MW, this.mid.height);
    for (let i = 0; i < 7; i++) {
      const x = 160 + i * (MW / 7) + (hash(i, 1) - 0.5) * 120;
      parkTree(c, x, gy, 0.85 + 0.3 * hash(i, 2), i + 3, 0.85);
    }
    for (let i = 0; i < 4; i++) {
      const x = 420 + i * (MW / 4);
      // 路燈：細桿、燈頭
      c.strokeStyle = rgba('sepia', 0.45); c.lineWidth = 5;
      c.beginPath(); c.moveTo(x, gy + 10); c.lineTo(x, gy - 300); c.quadraticCurveTo(x, gy - 330, x + 30, gy - 330); c.stroke();
      c.fillStyle = mixRgba('bone', 'sepia', 0.2);
      c.beginPath(); c.ellipse(x + 34, gy - 322, 18, 10, 0, 0, Math.PI * 2); c.fill();
      // 長椅
      const bx = x + 180;
      c.fillStyle = mixRgba('fur', 'sepia', 0.35);
      c.fillRect(bx, gy - 40, 150, 10); c.fillRect(bx, gy - 70, 150, 8);
      c.fillRect(bx + 10, gy - 30, 8, 36); c.fillRect(bx + 132, gy - 30, 8, 36);
    }
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
    // 往前走了多遠：一拍一步，拍點上步子落下（ease），所以捲動也照拍子一頓一頓
    const bt = au.beatAt(t) - au.beatAt(s), bi = Math.floor(bt), bu = bt - bi;
    const walked = (bi + ease.inOutQuad(bu)) * STRIDE;

    // 遠處的指示牌（兩行歌詞），跟著遠景慢慢往左移一點
    this.drawSign(c, t, lyrics, rv, -f.p * 120);
    // 中景：樹、路燈、長椅（速度 0.55）
    const mx = -((walked * 0.55) % this.mid.width);
    c.drawImage(this.mid as unknown as CanvasImageSource, mx, 0);
    c.drawImage(this.mid as unknown as CanvasImageSource, mx + this.mid.width, 0);
    // 近景：步道的磚縫（速度 1）、草叢（1.2）
    this.drawPath(c, t, walked);

    const phase = au.beatAt(t);
    const step = (x: number) => hop(phase, 1) * x;
    // ---- 宣文與兩隻博美（牽繩）
    const xwName = Math.floor(phase) % 2 === 0 ? 'xw_dogwalk_1' : 'xw_dogwalk_2';
    const en1 = puppetIn(t, s + 0.05, 0.45);
    const xwO: PuppetOpts = { h: SZ, spin: en1.spin, alpha: en1.alpha, squash: 0.02 * Math.exp(-bu / 0.12), rot: 0.012 * Math.sin(phase * Math.PI) };
    const hand = puppetPoint(xwName, 'hand', XW_X, GROUND - step(6), xwO) ?? { x: XW_X + 90, y: GROUND - 250 };
    puppetShadow(c, 'xw', XW_X, GROUND, { h: SZ, alpha: 0.24 * en1.alpha, color: '60,50,30' });
    drawPuppet(c, xwName, XW_X, GROUND - step(6), xwO);
    const qq = this.drawPom(c, t, 'qq', QQ_X, 0.2);
    const pp = this.drawPom(c, t, 'pp', PP_X, 0.28);
    if (en1.alpha > 0.5) {
      const ink = inkFor(true);
      if (qq) leash(c, hand, qq, { ink, h: SZ, slack: 18 });
      if (pp) leash(c, hand, pp, { ink, h: SZ, slack: 10 + Math.max(0, 40 - Math.abs(pp.x - hand.x) * 0.05) });
    }
    // ---- 孟庭推推車（元元坐在裡面）＋ 旗子
    this.drawStroller(c, t, phase, bu);

    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p);
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.22, grain: 0.04, zoom: 1 + 0.025 * push, shake: [-(760 - W / 2) * 0.025 * push, -(520 - H / 2) * 0.025 * push] };
  }

  /** 步道的磚縫與草叢，照走了多遠往左捲；拍點上草被風吹一下。 */
  private drawPath(c: CanvasRenderingContext2D, t: number, walked: number) {
    const au = this.ctx.audio;
    c.save();
    c.strokeStyle = rgba('sepia', 0.16);
    c.lineWidth = 1.4;
    c.beginPath();
    const off = walked % 90;
    for (let x = -off; x < W + 90; x += 90) { c.moveTo(x, GROUND - 38); c.lineTo(x - 30, GROUND + 68); }
    c.moveTo(0, GROUND + 14); c.lineTo(W, GROUND + 14);
    c.stroke();
    // 草叢：前景的一撮一撮（速度 1.2）
    c.strokeStyle = rgba('sepia', 0.38);
    c.lineWidth = 1.3;
    c.beginPath();
    const P = 1900;
    for (let i = 0; i < 40; i++) {
      const x = ((i * 97.3 + hash(i, 1) * 60 - walked * 1.2) % P + P) % P - 20;
      const y = i % 2 ? GROUND + 90 + 60 * hash(i, 2) : HZ + 20 + 150 * hash(i, 3);
      if (x > 1340 && y > 820) continue;
      const len = 10 + 12 * hash(i, 4), push = 0.25 + 0.3 * beatKick(au, t - x / 4000, 0.4);
      for (const d of [-0.3, 0.15, 0.5]) {
        const a = -Math.PI / 2 + d + push;
        c.moveTo(x + d * 6, y);
        c.quadraticCurveTo(x + d * 6 + Math.cos(a) * len * 0.3, y - len * 0.6, x + d * 6 + Math.cos(a) * len, y + Math.sin(a) * len);
      }
    }
    c.stroke();
    c.restore();
  }

  /**
   * 一隻牽著的博美：一拍一步（兩張走路圖）；芃芃每兩小節停下來聞兩拍（被步道往左帶，落在後面），再小跑步追回來。
   * 回傳脖子的位置（牽繩接這裡）。
   */
  private drawPom(c: CanvasRenderingContext2D, t: number, w: 'pp' | 'qq', x0: number, delay: number): Pt | null {
    const au = this.ctx.audio;
    const en = puppetIn(t, this.ctx.start + delay, 0.42);
    if (en.alpha <= 0) return null;
    const bp = au.beatPeriod(t);
    let x = x0, name = cyc(au.beatAt(t) + (w === 'pp' ? 0.5 : 0), [`${w}_dogwalk_1`, `${w}_dogwalk_2`]), lift = hop(au.beatAt(t) + (w === 'pp' ? 0.5 : 0), 1) * 5;
    if (w === 'pp') {
      for (const s0 of this.sniffs) {
        const d = t - s0;
        if (d < 0 || d > bp * 5) continue;
        if (d < bp * 2) { x = x0 - (d / bp) * STRIDE * 0.9; name = 'pp_sniff'; lift = 0; }
        else { const k = ease.inOutCubic(clamp((d - bp * 2) / (bp * 3))); x = lerp(x0 - STRIDE * 1.8, x0, k); name = cyc(au.beatAt(t) * 2, ['pp_run_1', 'pp_run_2']); lift = hop(au.beatAt(t), 2) * 8; }
      }
    }
    const o: PuppetOpts = { h: SZ, scale: DOG_S, spin: en.spin, alpha: en.alpha, squash: breathe(t, 0.01, 1.3, w === 'pp' ? 0.4 : 0) };
    puppetShadow(c, w, x, GROUND + 6, { h: SZ * DOG_S, lift, alpha: 0.25 * en.alpha, color: '60,50,30' });
    drawPuppet(c, name, x, GROUND + 6 - lift, o);
    if (en.k < 1) {
      sparkHead(this.glow, x, GROUND, t, 0.5);
      sparkParticles(this.glow, t, () => ({ x, y: GROUND }), { rate: 30, life: 0.2, speed: 110, seed: w === 'pp' ? 5 : 6 });
    }
    return puppetPoint(name, 'neck', x, GROUND + 6 - lift, o) ?? { x: x + 40, y: GROUND - 60 };
  }

  /** 孟庭推推車：兩張走路圖一拍換一張；推車（連元元，同一張圖）每一步顛一下；推車把手上插著旗子（留言）。 */
  private drawStroller(c: CanvasRenderingContext2D, t: number, phase: number, bu: number) {
    const au = this.ctx.audio;
    const en = puppetIn(t, this.ctx.start + 0.12, 0.45);
    if (en.alpha <= 0) return;
    const name = Math.floor(phase) % 2 === 0 ? 'mt_d4_stroll_1' : 'mt_d4_stroll_2';
    // 每個小節線元元抬頭：整台車往上彈一點（圖是一張，程式讓它跟著節奏動）
    const barU = au.barAt(t) - Math.floor(au.barAt(t));
    const pop = barU < 0.12 ? Math.sin(Math.PI * barU / 0.12) * 5 : 0;
    const o: PuppetOpts = { h: SZ, spin: en.spin, alpha: en.alpha, squash: 0.018 * Math.exp(-bu / 0.12), rot: 0.008 * Math.sin(phase * Math.PI) };
    puppetShadow(c, 'mt', MT_X, GROUND, { h: SZ, wide: 2.2, alpha: 0.24 * en.alpha, color: '60,50,30' });
    drawPuppet(c, name, MT_X, GROUND - hop(phase, 1) * 5 - pop, o);
    // 旗桿：從推車把手往上（把手沒有量到就用孟庭前面估）
    const base = puppetPoint(name, 'handle', MT_X, GROUND - hop(phase, 1) * 5, o) ?? { x: MT_X + 110, y: GROUND - 250 };
    this.drawFlag(c, t, base, en.alpha);
  }

  /**
   * 旗子：旗桿從把手往上到 POLE_TOP，旗面往左後方飄（往右走，風從前面來）。旗面切成 24 條直條，每條照
   * 「離旗桿越遠擺越大」的正弦波上下錯開、明暗一點點，像布在飄；拍點上風大一點。
   */
  private drawFlag(c: CanvasRenderingContext2D, t: number, base: Pt, alpha: number) {
    const n = this.note;
    if (!n) return;
    const au = this.ctx.audio, S = this.sheet;
    const tm = writeTiming(n, this.ctx.start + 0.7, t, !!this.msg);
    S.paint(n, { chars: tm.chars, sigK: tm.sigK, padX: FPAD.x, padTop: FPAD.top, padBottom: FPAD.bottom, color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.62), sigColor: rgba('sepia', 0.74) }, (cc, x, y, w, h) => {
      cc.fillStyle = mixRgba('bone', 'cream', 0.3);
      cc.fillRect(x, y, w, h);
      // 旗子靠旗桿那一邊的布套、下緣一排小三角的花邊
      cc.fillStyle = mixRgba('shirtblue', 'paper', 0.2);
      cc.fillRect(x + w - 16, y, 16, h);
      cc.fillStyle = mixRgba('rose', 'paper', 0.35);
      for (let xx = x; xx < x + w - 16; xx += 24) { cc.beginPath(); cc.moveTo(xx, y + h); cc.lineTo(xx + 24, y + h); cc.lineTo(xx + 12, y + h - 10); cc.closePath(); cc.fill(); }
    });
    const top = { x: base.x + 6, y: POLE_TOP };
    // 旗桿
    c.save();
    c.globalAlpha *= alpha;
    c.strokeStyle = rgba('sepia', 0.6);
    c.lineWidth = 5;
    c.lineCap = 'round';
    c.beginPath(); c.moveTo(base.x, base.y); c.lineTo(top.x, top.y - 12); c.stroke();
    c.fillStyle = mixRgba('fur', 'sepia', 0.3);
    c.beginPath(); c.arc(top.x, top.y - 16, 7, 0, Math.PI * 2); c.fill();
    // 旗面：右緣貼著旗桿、往左飄
    const cv = S.cv as unknown as CanvasImageSource, M = S.m;
    const strips = 24, sw = S.w / strips;
    const gust = 1 + 0.5 * beatKick(au, t, 0.5);
    const tt = t - this.ctx.start;
    for (let i = 0; i < strips; i++) {
      const u = 1 - (i + 0.5) / strips; // 離旗桿多遠（0 = 旗桿邊）
      const dy = Math.sin(tt * 4.2 - u * 5.5) * 14 * u * gust;
      const shade = 0.05 * Math.cos(tt * 4.2 - u * 5.5) * u;
      const sx = M + i * sw;
      const dx = top.x - S.w + i * sw - u * 10;
      c.drawImage(cv, sx, M, sw + 0.6, S.h, dx, top.y + dy, sw + 0.6, S.h);
      if (shade) { c.fillStyle = shade > 0 ? rgba('bone', shade) : rgba('sepia', -shade); c.fillRect(dx, top.y + dy, sw + 0.6, S.h); }
    }
    c.restore();
  }

  /** 遠處草地上的指示牌：兩根柱子、上下兩塊木板（上面中文、下面原文；沒有原文只有一塊），上面一行小字。 */
  private drawWay(c: CanvasRenderingContext2D, x: number, cy: number, a: number) {
    wayIcons(c, x, cy, SIGN.w, a);
  }

  private drawSign(c: CanvasRenderingContext2D, t: number, lyrics: Lyrics, rv: number, drift: number) {
    const ly = lyricAt(lyrics, t);
    const S = SIGN, x = S.x + drift;
    const st = { family: F.archivo(100, 700), size: this.lyricSize, minSize: 40, maxWidth: S.w - 80, align: 'center' as const, unsung: rgba('sepia', 0.28), sung: rgba('sepia', 0.92), active: rgba('signal') };
    // 中文、原文分開排：各寫在自己的那塊板子上（兩塊板中間有縫，原文要多空一點，不然字頂會碰到縫）
    const main = ly ? mainOnly(ly.line) : null, sub = ly ? lyricSubOf(ly.line) : null;
    const lay = main ? layoutLyric(c, main, st) : null;
    const sst = subLine(st, lay?.size ?? 50, S.w - 50);
    const sl = sub && lay ? layoutSub(c, sub, sst) : null;
    const base1 = S.y + 34 + (lay?.size ?? 50) * 0.9;
    const last1 = base1 + (lay ? (lay.rows.length - 1) * lay.size * 1.18 : 0);
    const end1 = last1 + (lay?.size ?? 50) * 0.42;
    const base2 = end1 + 14 + (sl ? sl.size * 1.0 : 0);
    const end2 = sl ? base2 + (sl.rows.length - 1) * sl.size * 1.18 + sl.size * 0.5 : end1;
    const wood = mixRgba('fur', 'paper', 0.55);
    c.save();
    // 柱子（到遠處的草地）
    c.fillStyle = mixRgba('fur', 'sepia', 0.4);
    c.fillRect(x + 60, S.y + 20, 14, HZ + 40 - S.y);
    c.fillRect(x + S.w - 74, S.y + 20, 14, HZ + 40 - S.y);
    const board = (y0: number, y1: number) => {
      c.fillStyle = rgba('sepia', 0.1); c.fillRect(x + 6, y0 + 8, S.w, y1 - y0);
      c.fillStyle = wood; c.fillRect(x, y0, S.w, y1 - y0);
      c.strokeStyle = rgba('sepia', 0.35); c.lineWidth = 1.5; c.strokeRect(x + 0.5, y0 + 0.5, S.w - 1, y1 - y0 - 1);
    };
    board(S.y, end1);
    if (sl) board(end1 + 8, end2);
    c.font = font(F.mono(500), 15);
    c.letterSpacing = '4px';
    c.fillStyle = rgba('sepia', 0.5);
    c.fillText('公園步道 PARK TRAIL', x + 22, S.y + 24);
    c.letterSpacing = '0px';
    c.restore();
    // 沒有歌詞的時候板子上是指路的圖示（往前的箭頭、樹、腳印），不留一塊空木板
    const ic = 1 - (ly ? ly.k : 0);
    if (ic > 0.01) this.drawWay(c, x, (S.y + end1) / 2 + 8, ic);
    if (!ly || !lay || !main) return;
    const a = ly.k * rv;
    c.save();
    c.translate(x + S.w / 2, base1);
    drawLyric(c, main, t, st, lay, a);
    c.restore();
    if (sub && sl) {
      c.save();
      c.translate(x + S.w / 2, base2);
      drawSub(c, sub, t, sst, sl, a);
      c.restore();
    }
  }
}

/** 指示牌上的圖示：往右的大箭頭、一棵樹、一個腳印（淡淡的墨色）。 */
function wayIcons(c: CanvasRenderingContext2D, x: number, cy: number, w: number, a: number) {
  c.save();
  c.globalAlpha *= a;
  c.strokeStyle = rgba('sepia', 0.45);
  c.fillStyle = rgba('sepia', 0.45);
  c.lineWidth = 6;
  c.lineCap = 'round';
  const mx = x + w / 2;
  c.beginPath(); c.moveTo(mx - 60, cy); c.lineTo(mx + 70, cy); c.moveTo(mx + 40, cy - 28); c.lineTo(mx + 72, cy); c.lineTo(mx + 40, cy + 28); c.stroke();
  const tx = mx - 190;
  c.beginPath(); c.arc(tx, cy - 12, 24, 0, Math.PI * 2); c.fill(); c.fillRect(tx - 4, cy + 8, 8, 24);
  const px = mx + 190;
  c.beginPath(); c.ellipse(px, cy + 8, 14, 11, 0, 0, Math.PI * 2); c.fill();
  for (const [dx, dy] of [[-15, -8], [-5, -18], [5, -18], [15, -8]]) { c.beginPath(); c.arc(px + dx!, cy + dy!, 5, 0, Math.PI * 2); c.fill(); }
  c.restore();
}

/** 照節拍挑一張（每拍一張）。 */
function cyc(beat: number, frames: readonly string[]): string {
  const i = Math.floor(beat);
  return frames[((i % frames.length) + frames.length) % frames.length]!;
}
