// 街頭鬥牛（亮、hoops）：午後的公園籃球場，宣文和孟庭穿著 A&O 情侶球衣一對一；芃芃和 QQ 在場邊當裁判。
// 角色是 Codex 畫的紙偶（_puppet.ts、素材組 hoops；狗坐著的樣子借 base 的 pp_sit／qq_sit）。
//  - 宣文運球：一拍拍一下（球在拍點落地、半拍回到手上），左右晃（每兩拍換一邊）；孟庭壓低身體跟著他左右移動防守。
//  - 每兩小節一次，小節線上宣文跳投（最高點出手）：
//    · 單數次：孟庭同時跳起來蓋火鍋（她的手在出手後一瞬間碰到球），球往左下方被拍掉、落地彈兩下滾到狗旁邊；
//      芃芃吹哨、QQ 舉手判決；孟庭落地搖手指「不行喔～」，宣文抱頭大笑。
//    · 雙數次：孟庭慢了半拍，球從她手上飛過去空心進（鐵鍊網往下甩），宣文轉過來握拳大叫。
//    一小節後球彈回宣文手上，繼續運球。
//  - **焦點是主打留言**：噴漆寫在球場後面那道牆上（先刷一塊米白的底漆、邊緣有流下來的漆），一個字一個字噴上去（噴嘴有一點漆霧），寫完署名；
//    照「留言尺寸與版面比例標準 v2」：字 40～60、底漆那一塊最大 780 × 420，放在左上，寬高跟著留言。沒有留言時寫邀請。
//  - 歌詞像漆在前景的球場地上（lyricOnPath，逐字跟唱），比留言小一級。
//  - 光線：午後的太陽在左上，牆頭後面探出來的樹梢在拍點上被風推一下。鏡頭整個窗格慢慢推近兩個人。
//  - 右下角 HUD：籃框的柱子站在它上面一點，場線到那裡就淡掉。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { lyricAt, barAfter, beatAfter, msgChars } from './_motifs';
import { inkFor, paperBG, inkLine, hatch, lyricOnPath, drawNote, arcAt, type Note } from './_couple';
import { loadPuppets, drawPuppet, drawPick, drawCycle, puppetPoint, puppetShadow, puppetIn, jumpArc, breathe, beatKick, landSquash, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { basketball, drawHoop, lyricRows, type Hoop, type Pt } from './_c8';

export const spec: PlateSpecDecl = { group: 'couple', family: 'hoops', paper: true, energy: [0.4, 1], bars: [4, 8] };

/** 球場：人的腳底（比一般高一點：籃框的柱子不能進右下角 HUD）。 */
const GROUND = 818;
/** 場景尺度（宣文的身高）：籃框要照比例放得進畫面，人就不能太大。 */
const SZ = 300;
const XW_X = 990, MT_X = 1270;
const HOOP: Hoop = { x: 1585, y: 300, d: 76, side: 1, floor: GROUND };
/** 牆：上緣、下緣（跟球場遠的那條邊接在一起）。 */
const WALL = { top: 150, bottom: 690 };
/** 牆上刷底漆寫留言的那一塊：最大範圍（標準 v2）與寫字的內距。 */
const PANEL = { x: 120, y: 196, w: 820, h: 420 };
const PAD = { x: 44, top: 60, bottom: 34 };
/** 狗（裁判）：前景左邊，放大一點（遠處的桌子也要認得出是芃芃和 QQ）。 */
const DOGS = { pp: 330, qq: 520, g: 928, s: 1.5 };
/** 地上粉筆寫的歌詞：沿著這條線。 */
const CHALK: Pt[] = [{ x: 640, y: 972 }, { x: 980, y: 962 }, { x: 1320, y: 970 }];
const BALL_R = 11;
/** 跳多高（px）：宣文跳投、孟庭蓋火鍋。 */
const JUMP = { xw: 64, mt: 96 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const POSES = [
  'xw_hoops_dribble_1', 'xw_hoops_dribble_2', 'xw_hoops_shoot_1', 'xw_hoops_shoot_2', 'xw_hoops_laugh', 'xw_hoops_cheer',
  'mt_hoops_guard_left', 'mt_hoops_block_left', 'mt_hoops_cheer', 'pp_sit', 'pp_hoops_whistle', 'qq_sit', 'qq_hoops_call',
];

/** 一次進攻：C = 出手的小節線；block = 被蓋；contact = 球碰到孟庭的手（被蓋時）或到籃框（進球時）；reset = 球回到宣文手上。 */
interface Play { C: number; block: boolean; air: number; contact: number; land: number; reset: number; rest: Pt }

export default class Basketball extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  plays: Play[] = [];
  note: Note | null = null;
  panel = { ...PANEL };
  lyricSize = 52;
  msgT0 = 0;
  /** 出手點（跳到最高時 shoot_2 的手）與蓋火鍋的點（孟庭跳到最高時的手）。 */
  release: Pt = { x: 0, y: 0 };
  blockAt: Pt = { x: 0, y: 0 };

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客新人留言A&O ♥' + INVITE);
    this.track(await loadPuppets(POSES));
    // 進攻：開場一小段之後的小節線，每兩小節一次（窗格太短就在下一拍）
    let C = barAfter(au, s + 1.5);
    if (C > e - 1.4) C = beatAfter(au, s + 1.1);
    for (let k = 0; k < 10 && C < e - 1.2; k++) {
      const bp = au.beatPeriod(C), air = clamp(bp * 1.1, 0.45, 0.7);
      const block = k % 2 === 0;
      const contact = block ? C + 0.09 : C + clamp(bp * 0.9, 0.4, 0.7);
      // 被蓋的球往左下方飛、落地彈兩下，停在狗旁邊；進球的球從網子掉下來、往左滾一點
      const rest = block ? { x: 760 - 40 * (k % 3), y: GROUND - BALL_R } : { x: HOOP.x - 170, y: GROUND - BALL_R };
      this.plays.push({ C, block, air, contact, land: C + air / 2, reset: au.timeOfBeat(Math.round(au.beatAt(C)) + 5), rest });
      C = au.timeOfBar(Math.round(au.barAt(C)) + 2);
    }
    this.release = puppetPoint('xw_hoops_shoot_2', 'hand', XW_X, GROUND - JUMP.xw, { h: SZ }) ?? { x: XW_X + 70, y: GROUND - JUMP.xw - SZ * 1.15 };
    this.blockAt = puppetPoint('mt_hoops_block_left', 'hand', MT_X - 40, GROUND - JUMP.mt, { h: SZ }) ?? { x: MT_X - 110, y: GROUND - JUMP.mt - SZ * 1.1 };
    // 牆上的留言：標準 v2；底漆那一塊的寬高跟著留言
    const c = this.fg.ctx;
    const w = PANEL.w - PAD.x * 2, hmax = PANEL.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const ph = Math.min(PANEL.h, Math.max(200, PAD.top + this.note.height + PAD.bottom + 10));
    const pw = Math.min(PANEL.w, tightenNote(c, this.note, 420) + PAD.x * 2);
    this.panel = { x: PANEL.x, y: PANEL.y, w: pw, h: ph };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.msgT0 = beatAfter(au, s + 0.3);
    this.drawBackground();
  }

  /** 不會動的：牆（磚縫、牆頭）、刷了底漆的那一塊、柏油球場與場線、籃框的柱子與籃板。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx, ink = inkFor(true);
    L.clear();
    // 牆：比紙深一點的灰米色，一排排磚縫（很淡），牆頭一條壓頂
    c.fillStyle = mixRgba('paper', 'sepia', 0.07);
    c.fillRect(0, WALL.top, W, WALL.bottom - WALL.top);
    c.strokeStyle = rgba('sepia', 0.06);
    c.lineWidth = 1.2;
    c.beginPath();
    for (let y = WALL.top + 30, r = 0; y < WALL.bottom; y += 34, r++) {
      c.moveTo(0, y); c.lineTo(W, y);
      for (let x = (r % 2) * 40; x < W; x += 80) { c.moveTo(x, y); c.lineTo(x, y + 34); }
    }
    c.stroke();
    inkLine(c, [{ x: -10, y: WALL.top }, { x: W + 10, y: WALL.top - 2 }], { ink, w: 1, seed: 3 });
    c.fillStyle = mixRgba('paper', 'sepia', 0.12);
    c.fillRect(0, WALL.top - 14, W, 14);
    inkLine(c, [{ x: -10, y: WALL.top - 14 }, { x: W + 10, y: WALL.top - 15 }], { ink, w: 0.8, seed: 4 });
    // 底漆：米白、邊緣不整齊、下緣幾道流下來的漆
    const P = this.panel;
    const edge: Pt[] = [];
    for (let i = 0; i <= 12; i++) edge.push({ x: P.x + (P.w * i) / 12, y: P.y + (hash(i, 1) - 0.5) * 8 });
    for (let i = 0; i <= 8; i++) edge.push({ x: P.x + P.w + (hash(i, 2) - 0.5) * 8, y: P.y + (P.h * i) / 8 });
    for (let i = 12; i >= 0; i--) edge.push({ x: P.x + (P.w * i) / 12, y: P.y + P.h + (hash(i, 3) - 0.5) * 8 });
    for (let i = 8; i >= 0; i--) edge.push({ x: P.x + (hash(i, 4) - 0.5) * 8, y: P.y + (P.h * i) / 8 });
    c.fillStyle = mixRgba('paper', 'bone', 0.65);
    c.beginPath(); edge.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath(); c.fill();
    for (let i = 0; i < 6; i++) {
      const x = P.x + 40 + hash(i, 5) * (P.w - 80), len = 14 + 40 * hash(i, 6);
      c.fillRect(x, P.y + P.h - 2, 4, len);
      c.beginPath(); c.arc(x + 2, P.y + P.h + len, 3, 0, Math.PI * 2); c.fill();
    }
    // 底漆角落的小塗鴉簽名（訊號色，小）
    c.font = font(F.archivo(110, 800), 18);
    c.fillStyle = rgba('signal', 0.8);
    c.fillText('A&O ♥', P.x + PAD.x, P.y + 38);
    // 柏油球場：遠的邊（接牆）到畫面下緣，比紙深一點
    c.fillStyle = mixRgba('paper', 'sepia', 0.13);
    c.fillRect(0, WALL.bottom, W, H - WALL.bottom);
    inkLine(c, [{ x: -10, y: WALL.bottom }, { x: W + 10, y: WALL.bottom + 2 }], { ink, w: 0.9, seed: 5 });
    // 場線：罰球區（透視的梯形，只畫到 HUD 上緣）、三分線的一段弧
    c.strokeStyle = rgba('bone', 0.75);
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(1370, 722); c.lineTo(1780, 722);
    c.moveTo(1370, 722); c.lineTo(1352, 826);
    c.moveTo(1120, 722); c.bezierCurveTo(1050, 760, 1020, 800, 1010, 826);
    c.stroke();
    // 球場上幾道很淡的刮痕
    hatch(c, [{ x: 200, y: 730 }, { x: 600, y: 730 }, { x: 560, y: 820 }, { x: 160, y: 820 }], { ink, angle: 0.2, gap: 26, w: 0.2, color: rgba('sepia', 0.05), seed: 8 });
    // 籃框的柱子、籃板、籃框後半圈
    drawHoop(c, HOOP, 'back', { line: rgba('sepia', 0.85), glass: mixRgba('paper', 'bone', 0.6), pole: mixRgba('paper', 'sepia', 0.45) });
    L.upload();
  }

  /**
   * 牆頭後面探出來的一排樹梢：很多團重疊的圓連成一條起伏的樹冠線（比紙深一點點、不描邊，只有上緣一條很淡的墨線），
   * 像遠景的剪影，不會像一顆顆氣球。拍點上被風推一下（越高的團晃越多）。
   */
  private trees(c: CanvasRenderingContext2D, t: number) {
    const gust = beatKick(this.ctx.audio, t, 0.5);
    const top = WALL.top - 14;
    c.save();
    c.beginPath(); c.rect(0, 0, W, top); c.clip();
    const blobs: [number, number, number][] = [];
    for (let x = -40, i = 0; x < W + 60; x += 46 + 30 * hash(i, 1), i++) {
      const r = 38 + 34 * hash(i, 2), y = top + 10 - r * (0.55 + 0.6 * hash(i, 3));
      blobs.push([x + gust * 5 * (1 - y / top), y, r]);
    }
    const shape = () => { c.beginPath(); for (const [x, y, r] of blobs) { c.moveTo(x + r, y); c.arc(x, y, r, 0, Math.PI * 2); } };
    // 上緣的淡墨線：整片往上挪一點點畫深色，再蓋上填色
    c.save(); c.translate(0, -1.5); c.fillStyle = rgba('sepia', 0.22); shape(); c.fill(); c.restore();
    c.fillStyle = mixRgba('paper', 'sepia', 0.1);
    shape(); c.fill();
    c.restore();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t;
    this.paper.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.trees(c, t);
    this.drawSpray(c, t);
    this.drawLyric(c, t);
    this.drawDogs(c, t);
    const ball = this.ballAt(t);
    this.drawMengting(c, t);
    this.drawXuanwen(c, t);
    if (ball) basketball(c, ball.x, ball.y, BALL_R, ball.rot);
    let sw = 0;
    for (const p of this.plays) if (!p.block && t >= p.contact) sw = Math.max(sw, Math.exp(-(t - p.contact) / 0.4));
    drawHoop(c, HOOP, 'front', { line: rgba('sepia', 0.8), glass: '', pole: '', swish: sw, t, chain: true });
    // 被蓋的那一下：孟庭的手邊炸一圈短線
    for (const p of this.plays) {
      const k = 1 - clamp((t - p.contact) / 0.22);
      if (!p.block || t < p.contact || k <= 0) continue;
      c.save();
      c.strokeStyle = rgba('signal', k);
      c.lineWidth = 3;
      c.lineCap = 'round';
      c.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2, r0 = 18 + (1 - k) * 30, r1 = r0 + 14 * k;
        c.moveTo(this.blockAt.x + Math.cos(a) * r0, this.blockAt.y + Math.sin(a) * r0);
        c.lineTo(this.blockAt.x + Math.cos(a) * r1, this.blockAt.y + Math.sin(a) * r1);
      }
      c.stroke();
      c.restore();
    }
    comp.draw(renderer, L.upload(), out);
    const push = ease.inOutCubic(f.p);
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.24, grain: 0.045, ca: 0.5, zoom: 1 + 0.03 * push, shake: [-(1130 - W / 2) * 0.03 * push, -(620 - H / 2) * 0.03 * push] };
  }

  /** 這一格是哪一次進攻（還沒開始 = null）：從上一次的 reset 到這一次的 reset。 */
  private playAt(t: number): Play | null {
    let cur: Play | null = null;
    for (const p of this.plays) if (t >= p.C - this.ctx.audio.beatPeriod(p.C) * 0.5) cur = p;
    return cur && t < cur.reset ? cur : null;
  }

  /** 運球的左右晃：每兩拍換一邊（交叉運球）。 */
  private sway(t: number, lag = 0) {
    const b = this.ctx.audio.beatAt(t - lag);
    return Math.sin((b / 2) * Math.PI);
  }

  /** 宣文：運球（一拍一張）、跳投（出手前拿球往下沉 → 最高點出手）、被蓋抱頭笑／進球握拳叫。 */
  private drawXuanwen(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, bp = au.beatPeriod(t);
    const ent = puppetIn(t, this.ctx.start + 0.05, 0.45);
    if (ent.alpha <= 0) return;
    const p = this.playAt(t);
    const base: PuppetOpts = { h: SZ, spin: ent.spin, alpha: ent.alpha, pivot: 0.4 };
    const shadow = (x: number, lift: number) => puppetShadow(c, 'xw', x, GROUND, { h: SZ, lift, alpha: 0.3 * ent.alpha, color: '70,45,25', wide: 1.3 });
    if (!p) {
      const x = XW_X + 30 * this.sway(t);
      shadow(x, 0);
      drawCycle(c, au, t, ['xw_hoops_dribble_1', 'xw_hoops_dribble_2'], 1, x, GROUND, { ...base, squash: 0.03 * beatKick(au, t, 0.2) + breathe(t, 0.01), rot: 0.03 * this.sway(t) });
      return;
    }
    const j = jumpArc(t, p.C - p.air / 2, p.C + p.air / 2, JUMP.xw, { crouch: 0.12, land: 0.14 });
    const react = p.block ? 'xw_hoops_laugh' : 'xw_hoops_cheer';
    const keys: [number, string][] = [[-1e9, 'xw_hoops_shoot_1'], [p.C, 'xw_hoops_shoot_2'], [p.land + 0.12, react]];
    const lift = t < p.land + 0.12 ? -j.y : 0;
    let squash = t < p.land + 0.12 ? j.squash : landSquash(t, p.land + 0.12, 0.08) + breathe(t, 0.012);
    if (t < p.C - p.air / 2) squash += 0.06 * prog(t, p.C - bp * 0.5, p.C - p.air / 2);
    shadow(XW_X, lift);
    drawPick(c, keys, t, XW_X, GROUND - lift, { ...base, squash, rot: t >= p.land + 0.12 ? 0.02 * Math.sin(t * 9) : 0 });
  }

  /** 孟庭：跟著宣文左右移動防守；他出手時跳起來蓋（被蓋那次剛好碰到球、進球那次慢半拍），落地後搖手指／回到防守。 */
  private drawMengting(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const ent = puppetIn(t, this.ctx.start + 0.15, 0.45);
    if (ent.alpha <= 0) return;
    const p = this.playAt(t);
    // 孟庭面向左（防守宣文）：用 Codex 另外畫的朝左版本（_left），不左右翻轉——翻過去球衣上的 A&O、03 會變成反的字
    const base: PuppetOpts = { h: SZ, spin: ent.spin, alpha: ent.alpha, pivot: 0.4 };
    const shadow = (x: number, lift: number) => puppetShadow(c, 'mt', x, GROUND, { h: SZ, lift, alpha: 0.3 * ent.alpha, color: '70,45,25', wide: 1.3 });
    if (!p) {
      const x = MT_X + 26 * this.sway(t, 0.12);
      shadow(x, 0);
      drawPuppet(c, 'mt_hoops_guard_left', x, GROUND, { ...base, squash: 0.025 * beatKick(au, t, 0.25) + breathe(t, 0.01, 2.8, 0.3) });
      return;
    }
    const late = p.block ? 0 : 0.26;
    const apex = p.block ? p.contact : p.C + late;
    const j = jumpArc(t, apex - p.air / 2, apex + p.air / 2, JUMP.mt, { crouch: 0.12, land: 0.14 });
    const x = lerp(MT_X, MT_X - 40, clamp((t - (apex - p.air / 2)) / p.air));
    const done = apex + p.air / 2 + 0.1;
    const keys: [number, string][] = [[-1e9, 'mt_hoops_guard_left'], [apex - p.air / 2, 'mt_hoops_block_left'], [done, p.block ? 'mt_hoops_cheer' : 'mt_hoops_guard_left']];
    const lift = t < done ? -j.y : 0;
    const squash = t < done ? j.squash : landSquash(t, done, 0.08) + breathe(t, 0.012);
    shadow(x, lift);
    // 被蓋那次：落地後轉正面搖手指；進球那次回到防守、搖頭
    drawPick(c, keys, t, x, GROUND - lift, { ...base, squash, rot: !p.block && t >= done ? 0.03 * Math.sin(t * 10) : 0 });
  }

  /** 球：運球（拍點落地）→ 出手 → 被蓋（往左下飛、彈兩下、停住）或空心進（網子掉下來、往左滾）→ 一小節後彈回宣文手上。 */
  private ballAt(t: number): (Pt & { rot: number }) | null {
    const au = this.ctx.audio;
    const p = this.playAt(t);
    let prev: Play | null = null;
    for (const q of this.plays) if (q.reset <= t) prev = q;
    // 運球中：手的高度（dribble 的道具點）與地板之間，拍點落地
    const dribble = (x0: number) => {
      const name = Math.floor(au.beatAt(t)) % 2 ? 'xw_hoops_dribble_2' : 'xw_hoops_dribble_1';
      const hand = puppetPoint(name, 'hand', x0, GROUND, { h: SZ }) ?? { x: x0 + SZ * 0.22, y: GROUND - SZ * 0.45 };
      const ph = au.beatAt(t) - Math.floor(au.beatAt(t));
      return { x: hand.x + 4, y: lerp(GROUND - BALL_R, hand.y + BALL_R, Math.pow(Math.sin(Math.PI * ph), 0.7)), rot: t * 2 };
    };
    if (!p) {
      const x0 = XW_X + 30 * this.sway(t);
      const d = dribble(x0);
      // 剛 reset：球從停的地方彈回手上（0.45 秒）
      if (prev && t < prev.reset + 0.45) {
        const u = (t - prev.reset) / 0.45;
        const q = arcAt(prev.rest, d, 120, ease.inOutCubic(u));
        return { ...q, rot: t * 3 };
      }
      return t < this.ctx.start + 0.3 ? null : d;
    }
    if (t < p.C) return null; // 拿在 shoot_1 的手上（圖上畫的球）
    if (p.block) {
      if (t < p.contact) { const u = (t - p.C) / (p.contact - p.C); return { x: lerp(this.release.x, this.blockAt.x, u), y: lerp(this.release.y, this.blockAt.y, u), rot: 0 }; }
      // 被拍掉：往左下飛（重力）、彈兩下、滾到 rest
      return { ...bounceTo(this.blockAt, p.rest, t - p.contact, -520), rot: -(t - p.contact) * 6 };
    }
    // 進球：飛到籃框、從網子掉下來、往左滾到 rest
    if (t < p.contact) { const u = (t - p.C) / (p.contact - p.C); const q = arcAt(this.release, HOOP, 170, u); return { ...q, rot: u * 3 }; }
    const d = t - p.contact, g = 1800, fall = Math.sqrt((2 * (GROUND - BALL_R - HOOP.y)) / g);
    if (d < fall) return { x: HOOP.x, y: HOOP.y + 0.5 * g * d * d, rot: 3 };
    return { ...bounceTo({ x: HOOP.x, y: GROUND - BALL_R }, p.rest, d - fall, 0, g * fall * 0.45), rot: 3 + (d - fall) * 5 };
  }

  /** 狗（裁判）：平常坐著、拍點上興奮地壓一下；被蓋／進球的那一下芃芃吹哨（旁邊畫幾道聲音的弧）、QQ 站起來舉手。 */
  private drawDogs(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, bp = au.beatPeriod(t);
    let call: Play | null = null;
    for (const p of this.plays) if (t >= p.contact && t < p.contact + bp * 3) call = p;
    for (const d of ['pp', 'qq'] as const) {
      const x = DOGS[d];
      const ent = puppetIn(t, this.ctx.start + (d === 'pp' ? 0.25 : 0.32), 0.42);
      if (ent.alpha <= 0) continue;
      const on = call && t >= call.contact + (d === 'qq' ? bp * 0.5 : 0);
      const name = on ? (d === 'pp' ? 'pp_hoops_whistle' : 'qq_hoops_call') : `${d}_sit`;
      const o: PuppetOpts = { h: SZ, scale: DOGS.s, spin: ent.spin, alpha: ent.alpha, squash: 0.05 * beatKick(au, t, 0.25) + breathe(t, 0.015, 1.3, d === 'qq' ? 0 : 0.5) + (on ? landSquash(t, call!.contact + (d === 'qq' ? bp * 0.5 : 0), 0.12) : 0) };
      puppetShadow(c, d, x, DOGS.g, { h: SZ * DOGS.s, alpha: 0.3 * ent.alpha, color: '70,45,25' });
      drawPuppet(c, name, x, DOGS.g, o);
      // 吹哨：嘴邊三道聲音的弧（一拍一拍閃）
      if (on && d === 'pp') {
        const m = puppetPoint(name, 'mouth', x, DOGS.g, o) ?? { x: x + 60, y: DOGS.g - 90 };
        const k = beatKick(au, t, 0.3);
        c.save();
        c.strokeStyle = rgba('signal', 0.5 + 0.5 * k);
        c.lineWidth = 3;
        c.lineCap = 'round';
        for (let i = 0; i < 3; i++) { const r = 18 + i * 12 + k * 6; c.beginPath(); c.arc(m.x + 6, m.y, r, -0.6, 0.6); c.stroke(); }
        c.restore();
      }
    }
  }

  /** 牆上的噴漆留言：一個字一個字噴上去（噴嘴旁邊一小團漆霧），寫完署名淡入；在底漆上垂直置中。 */
  private drawSpray(c: CanvasRenderingContext2D, t: number) {
    const n = this.note, P = this.panel;
    if (!n) return;
    const total = msgChars(n.fit);
    const per = clamp(1.6 / Math.max(1, total), 0.03, 0.1);
    const done = this.msgT0 + total * per;
    const top = P.y + PAD.top, hh = P.h - PAD.top - PAD.bottom;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.15, this.ctx.start + 0.5);
    const head = drawNote(c, n, P.x + PAD.x, top + Math.max(0, (hh - n.height) * 0.45), {
      chars: this.msg ? (t - this.msgT0) / per : Infinity, color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.66), sigColor: rgba('sepia', 0.8), sigK: prog(t, done + 0.1, done + 0.5),
    });
    // 漆霧：噴嘴（寫到的地方）旁邊一小團點點
    if (head && this.msg && t < done + 0.1) {
      c.fillStyle = rgba('sepia', 0.35);
      const f = Math.floor(t * 30);
      for (let i = 0; i < 26; i++) {
        const a = hash(i, f) * Math.PI * 2, r = 4 + 22 * hash(i, f, 2) ** 1.5;
        c.fillRect(head.x + 6 + Math.cos(a) * r, head.y + Math.sin(a) * r, 2, 2);
      }
    }
    c.restore();
  }

  /** 前景球場地上漆的歌詞（逐字跟唱）：墨色的漆（亮版面裡淺色的粉筆看不清楚），唱到的字訊號色。 */
  private drawLyric(c: CanvasRenderingContext2D, t: number) {
    const ly = lyricAt(this.ctx.lyrics, t);
    if (!ly) return;
    const rv = prog(t, this.ctx.start + 0.1, this.ctx.start + 0.6, ease.inOutCubic);
    // 太長、最小字級也放不下一排的句子會折成兩排（第二排往下）：這時整段往上挪，兩排都離下緣 96 px 以上
    const family = F.archivo(100, 700);
    const len = Math.hypot(CHALK[1]!.x - CHALK[0]!.x, CHALK[1]!.y - CHALK[0]!.y) + Math.hypot(CHALK[2]!.x - CHALK[1]!.x, CHALK[2]!.y - CHALK[1]!.y);
    const path = lyricRows(c, ly.line.text, family, this.lyricSize, 40, len) === 2 ? CHALK.map((q) => ({ x: q.x, y: q.y - 50 })) : CHALK;
    lyricOnPath(c, ly.line, t, path, {
      family, size: this.lyricSize, minSize: 40, alpha: ly.k * rv, unsung: rgba('sepia', 0.22), sung: rgba('sepia', 0.85), active: rgba('signal'), rowGap: 1.1,
    });
  }
}

/**
 * 從 a 丟出去、落地彈兩下、最後停在 b（地上）：vx0 = 水平初速（0 = 照 b 算），vy0 = 往上的初速（0 = 往下丟）。
 * 用來算被蓋掉的球、進球後滾走的球（只看經過的時間 d）。
 */
function bounceTo(a: Pt, b: Pt, d: number, vx0 = 0, vy0 = 0): Pt {
  const g = 1800, floor = b.y;
  // 第一段：拋物線到地上
  const vy = -vy0;
  const tHit = (-vy + Math.sqrt(vy * vy + 2 * g * Math.max(0, floor - a.y))) / g;
  const vx = vx0 || (b.x - a.x) / (tHit * 2.2);
  if (d < tHit) return { x: a.x + vx * d, y: a.y + vy * d + 0.5 * g * d * d };
  // 之後：每次彈起來剩四成的速度，水平慢慢停在 b
  let x = a.x + vx * tHit, v = (vy + g * tHit) * 0.42, u = d - tHit;
  for (let k = 0; k < 3; k++) {
    const air = (2 * v) / g;
    if (u < air) return { x: lerp(x, b.x, clamp((d - tHit) / 1.2)), y: floor - (v * u - 0.5 * g * u * u) };
    u -= air; v *= 0.42; x = lerp(x, b.x, 0.5);
  }
  return { x: lerp(x, b.x, clamp((d - tHit) / 1.2)), y: floor };
}
