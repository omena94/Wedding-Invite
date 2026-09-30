// 彈吉他（亮、music）：客廳的午後，宣文坐在高腳椅上彈木吉他，孟庭站在旁邊唱歌，芃芃和 QQ 坐在地毯上跟著搖頭，元元在孟庭腳邊接音符。
// 角色是 Codex 畫的紙偶（_puppet.ts），客廳、譜架、音符、五線譜用程式畫。
//  - 刷弦在拍點：拍點上往下刷（down）、半拍往上刷（up；快歌改成一拍下、一拍上），往下刷的那一下弦震一下、從音孔飄出一顆音符。
//  - **音符飄出去組成歌詞**：歌詞沿著右上一條彎彎的五線譜排（lyricOnPath，跟唱，比留言小一級）；每一拍飄出去的音符
//    沿著弧線飛到正在唱的字那裡、碰到就散成一點點光。間奏時音符落在五線譜上。
//  - 孟庭唱歌：平常雙手交握（sing），每兩小節張開手擺一下（sway）；狗狗每拍左右搖頭，副歌（能量高）仰頭一起「唱」。
//  - **焦點是主打留言**：寫在左邊譜架上的樂譜紙（上面一小段五線譜當裝飾），深墨手寫字、署名；
//    標準 v2：字 40～60、樂譜紙最大 540 × 420，高度跟著留言。沒有留言時寫邀請。
//  - 元元（白柴，三隻裡最大、跳得最高）：平常坐在孟庭右邊歪頭聽；每個小節線上宣文刷出一顆特別的音符，越過孟庭的頭飛向右邊，
//    元元在下一拍（慢歌）或下兩拍（快歌）跳起來、最高點剛好一口咬住（叮一下、冒一點光）。副歌（能量高）三隻一起仰頭唱，元元照樣接。
//  - 右邊牆上一扇窗，午後的光斜斜地照進來（很淡）。右下角 HUD 那一塊地板空著。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { lyricAt, lyricSubOf } from './_motifs';
import { inkFor, inkLine, inkPath, inkPoly, inkRect, inkEllipse, paperBG, lyricOnPath, arcAt, type Pt, type Note, type Ink } from './_couple';
import { loadPuppets, drawPuppet, drawPick, puppetPoint, puppetShadow, jumpArc, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { INVITE, enterPuppet, writeNote } from './_c5';

export const spec: PlateSpecDecl = { group: 'couple', family: 'music', paper: true, energy: [0.2, 0.9], bars: [4, 8] };

const FLOOR = 930;
const SZ = 560;
const AL_X = 850, OM_X = 1140;
/** 兩隻博美坐在宣文的高腳椅左邊；元元坐在孟庭右邊（右下角 HUD 那一塊要空著：坐著的元元右緣在 x 1360 之前）。 */
const PP_X = 545, QQ_X = 690, YY_X = 1244, DOG_Y = 1000, DOG_S = 1.15;
/** 元元跳多高（px）。 */
const YJUMP = 96;
/** 譜架上的樂譜紙：最大範圍（標準 v2）、內距；譜架的桿子落在地上。 */
const SHEET = { x: 120, y: 250, w: 540, h: 420 };
const PAD = { x: 40, top: 86, bottom: 34 };
/** 右上的五線譜（歌詞排在中間那一條上）。 */
const STAFF = { x0: 760, x1: 1790, y: 206, gap: 13 };
/** 右邊牆上的窗。 */
const WIN = { x: 1440, y: 318, w: 360, h: 380 };
const POSES = ['xw_guitar_down', 'xw_guitar_up', 'mt_guitar_sing', 'mt_guitar_sway', 'pp_sit', 'qq_sit', 'pp_howl', 'qq_howl', 'yy_tilt', 'yy_howl', 'yy_jump'];

interface Flight { t: number; land: number; seed: number }
/** 給元元接的音符：小節線上從音孔出發，catch 那一刻（拍點）被元元跳到最高點咬住。 */
interface Toss { t: number; catch: number }

export default class Guitar extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(512, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  /**
   * 有韓文原文的窗格：原文沿著五線譜排在中文下面，中文折兩排時會碰到窗簾桿——整條五線譜（連歌詞）往上提一點
   * （建構時就看：引擎只在建立這一格之前設好開關）。
   */
  staffY = STAFF.y - (this.ctx.lyrics.linesIn(this.ctx.start - 1, this.ctx.end + 1).some((l) => !!lyricSubOf(l)) ? 36 : 0);
  alanKeys: [number, string][] = [];
  omKeys: [number, string][] = [];
  flights: Flight[] = [];
  tosses: Toss[] = [];
  /** 元元跳到最高點時嘴前的位置（接音符的地方）。 */
  yyCatch: Pt = { x: 0, y: 0 };
  hole: Pt = { x: 0, y: 0 };
  note: Note | null = null;
  sheet = { ...SHEET };
  noteT0 = 0;
  lyricSize = 52;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客' + INVITE + (this.msg ? `No.${String(this.msg.n).padStart(3, '0')}` : ''));
    this.track(await loadPuppets(POSES));
    // 刷弦：慢歌拍點往下、半拍往上；快歌半拍換一次頭會一直閃，改成一拍往下、一拍往上。
    // 每一次往下刷飄出一顆音符，飛 1.2 拍。
    const fast = au.beatPeriod(s + 1) < 0.5;
    this.alanKeys = [[-1e9, 'xw_guitar_down']];
    let b = Math.ceil(au.beatAt(s + 0.35) - 1e-6);
    for (let k = 0; k < 400; k++, b++) {
      const t = au.timeOfBeat(b);
      if (t > e + 0.5) break;
      if (fast) this.alanKeys.push([t, b % 2 ? 'xw_guitar_up' : 'xw_guitar_down']);
      else this.alanKeys.push([t, 'xw_guitar_down'], [au.timeOfBeat(b + 0.5), 'xw_guitar_up']);
      if (!fast || b % 2 === 0) this.flights.push({ t, land: au.timeOfBeat(b + 1.2), seed: b });
    }
    // 孟庭：每兩小節張開手擺一下（兩拍）
    this.omKeys = [[-1e9, 'mt_guitar_sing']];
    for (let bar = Math.ceil(au.barAt(s + 0.3) - 1e-6), k = 0; k < 40; k++, bar++) {
      const t = au.timeOfBar(bar);
      if (t > e) break;
      if (k % 2 === 1) this.omKeys.push([t, 'mt_guitar_sway'], [au.timeOfBeat(Math.round(au.beatAt(t)) + 2), 'mt_guitar_sing']);
    }
    this.hole = puppetPoint('xw_guitar_down', 'hole', AL_X, FLOOR, { h: SZ }) ?? { x: AL_X + 30, y: FLOOR - 250 };
    // 元元接音符：每個小節線丟一顆（開場進場之後），慢歌下一拍接住、快歌下兩拍
    this.yyCatch = puppetPoint('yy_jump', 'mouth', YY_X, DOG_Y - YJUMP, { h: SZ, scale: DOG_S }) ?? { x: YY_X + 150, y: DOG_Y - 420 };
    for (let bar = Math.ceil(au.barAt(s + 0.9) - 1e-6), k = 0; k < 40; k++, bar++) {
      const t = au.timeOfBar(bar);
      const ct = au.timeOfBeat(Math.round(au.beatAt(t)) + (fast ? 2 : 1));
      if (ct > e - 0.15) break;
      this.tosses.push({ t, catch: ct });
    }
    // 樂譜紙上的留言：標準 v2 的字級；紙的寬高跟著留言（上緣夾在譜架上）
    const c = this.fg.ctx;
    const w = SHEET.w - PAD.x * 2, hmax = SHEET.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const sw = Math.min(SHEET.w, tightenNote(c, this.note, 360) + PAD.x * 2);
    const sh = Math.min(SHEET.h, Math.max(250, PAD.top + this.note.height + PAD.bottom + 10));
    this.sheet = { x: SHEET.x + (SHEET.w - sw) / 2, y: SHEET.y + (SHEET.h - sh), w: sw, h: sh };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.noteT0 = Math.min(this.flights[0]?.t ?? s + 0.8, s + 0.9);
    this.drawBackground();
  }

  /** 五線譜第 i 條線（0..4，2 是中間那條）：一條慢慢起伏的曲線。 */
  private staffLine(i: number, t: number): Pt[] {
    const pts: Pt[] = [];
    for (let k = 0; k <= 40; k++) {
      const u = k / 40, x = lerp(STAFF.x0, STAFF.x1, u);
      pts.push({ x, y: this.staffY + (i - 2) * STAFF.gap + 26 * Math.sin(u * 5.2 + 0.6) + 5 * Math.sin(u * 9 + t * 0.8) });
    }
    return pts;
  }

  /** 客廳：地板與地毯、右邊的窗（窗框、窗簾、斜斜的光）、譜架（桿子、腳、托板）。都不會動，畫一次。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx, ink = inkFor(true);
    L.clear();
    // 牆腳線與木地板
    inkLine(c, [{ x: 0, y: 820 }, { x: W, y: 818 }], { ink, w: 0.8, seed: 1 });
    c.save();
    c.strokeStyle = rgba('sepia', 0.08);
    c.lineWidth = 1.2;
    c.beginPath();
    for (let y = 850; y < H; y += 34 + (y - 850) * 0.15) { c.moveTo(0, y); c.lineTo(W, y); }
    c.stroke();
    c.restore();
    // 地毯（兩人與狗腳下，一塊淡淡的橢圓，右下 HUD 那邊不鋪）
    inkEllipse(c, 920, 975, 420, 66, 0, { ink, fill: mixRgba('paper', 'gingham', 0.18), w: 0.6, seed: 2 });
    inkEllipse(c, 920, 975, 376, 52, 0, { ink, w: 0.4, seed: 3, color: rgba('sepia', 0.25) });
    // 窗：窗框、十字窗格、兩邊的窗簾；午後的光從窗斜斜地落到地上（很淡）
    c.save();
    c.fillStyle = rgba('bone', 0.55);
    c.beginPath(); c.moveTo(WIN.x, WIN.y + WIN.h); c.lineTo(WIN.x + WIN.w, WIN.y + WIN.h); c.lineTo(WIN.x + WIN.w - 420, 1000); c.lineTo(WIN.x - 520, 1000); c.closePath();
    const g = c.createLinearGradient(0, WIN.y + WIN.h, 0, 1000);
    g.addColorStop(0, rgba('bone', 0.35)); g.addColorStop(1, rgba('bone', 0));
    c.fillStyle = g; c.fill();
    c.restore();
    inkRect(c, WIN.x, WIN.y, WIN.w, WIN.h, { ink, fill: mixRgba('bone', 'paper', 0.3), w: 1, seed: 4 });
    inkLine(c, [{ x: WIN.x + WIN.w / 2, y: WIN.y }, { x: WIN.x + WIN.w / 2, y: WIN.y + WIN.h }], { ink, w: 0.8, seed: 5 });
    inkLine(c, [{ x: WIN.x, y: WIN.y + WIN.h * 0.45 }, { x: WIN.x + WIN.w, y: WIN.y + WIN.h * 0.45 }], { ink, w: 0.8, seed: 6 });
    // 窗簾：兩片收在窗的兩邊（蓋住窗框一點點），下襬往外擺
    for (const [x0, dir] of [[WIN.x - 56, 1], [WIN.x + WIN.w + 56, -1]] as const) {
      const pts: Pt[] = [{ x: x0, y: WIN.y - 34 }, { x: x0 + dir * 96, y: WIN.y - 34 }, { x: x0 + dir * 70, y: WIN.y + WIN.h * 0.5 }, { x: x0 + dir * 84, y: WIN.y + WIN.h + 60 }, { x: x0 - dir * 10, y: WIN.y + WIN.h + 64 }];
      inkPoly(c, pts, { ink, fill: mixRgba('paper', 'fur', 0.22), w: 0.7, seed: 7 + dir });
      for (const k of [0.35, 0.65]) inkPath(c, [{ x: x0 + dir * 96 * k, y: WIN.y - 30 }, { x: x0 + dir * 70 * k + dir * 6, y: WIN.y + WIN.h * 0.5 }, { x: x0 + dir * 80 * k, y: WIN.y + WIN.h + 58 }], { ink, w: 0.4, seed: 9 + dir + k * 10, color: rgba('sepia', 0.35) });
    }
    inkLine(c, [{ x: WIN.x - 70, y: WIN.y - 34 }, { x: WIN.x + WIN.w + 70, y: WIN.y - 34 }], { ink, w: 1, seed: 11 });
    // 譜架：托板在樂譜紙下緣、一根桿子、三隻腳
    const S = this.sheet, cx = S.x + S.w / 2;
    inkLine(c, [{ x: cx, y: S.y + S.h + 10 }, { x: cx, y: FLOOR - 40 }], { ink, w: 1.3, seed: 12 });
    for (const dx of [-70, 0, 70]) inkLine(c, [{ x: cx, y: FLOOR - 40 }, { x: cx + dx, y: FLOOR + (dx ? 6 : 16) }], { ink, w: 1, seed: 13 + dx });
    inkRect(c, S.x - 16, S.y + S.h - 4, S.w + 32, 16, { ink, fill: mixRgba('paper', 'sepia', 0.3), w: 0.8, seed: 14, r: 3 });
    this.drawSheet(c, ink);
    L.upload();
  }

  /** 樂譜紙：往後靠一點點的紙、上面一小段五線譜（幾顆音符當裝飾）、右上角小小的編號。字另外每格寫。 */
  private drawSheet(c: CanvasRenderingContext2D, ink: Ink) {
    const S = this.sheet;
    c.fillStyle = rgba('sepia', 0.1);
    c.fillRect(S.x + 10, S.y + 12, S.w, S.h);
    inkPoly(c, [{ x: S.x, y: S.y }, { x: S.x + S.w, y: S.y + 2 }, { x: S.x + S.w - 2, y: S.y + S.h }, { x: S.x + 2, y: S.y + S.h - 2 }], { ink, fill: rgba('bone'), w: 0.8, seed: 20 });
    c.strokeStyle = rgba('sepia', 0.3);
    c.lineWidth = 1;
    c.beginPath();
    for (let i = 0; i < 5; i++) { const y = S.y + 30 + i * 7; c.moveTo(S.x + PAD.x, y); c.lineTo(S.x + S.w - PAD.x, y); }
    c.stroke();
    c.fillStyle = rgba('sepia', 0.4);
    for (let k = 0; k < 6; k++) {
      const x = S.x + PAD.x + 60 + k * ((S.w - PAD.x * 2 - 90) / 6), y = S.y + 30 + ((k * 3) % 5) * 7;
      c.beginPath(); c.ellipse(x, y, 5, 3.6, -0.4, 0, Math.PI * 2); c.fill();
      c.fillRect(x + 3.6, y - 20, 1.2, 20);
    }
    if (this.msg) {
      c.font = font(F.mono(500), 15);
      c.textAlign = 'right';
      c.fillStyle = rgba('sepia', 0.45);
      c.fillText(`No.${String(this.msg.n).padStart(3, '0')}`, S.x + S.w - PAD.x, S.y + 78);
      c.textAlign = 'left';
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.paper.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();

    // ---- 五線譜＋歌詞
    const rv = prog(t, s + 0.1, s + 0.6);
    const staff = [0, 1, 2, 3, 4].map((i) => this.staffLine(i, t));
    c.save();
    c.globalAlpha = rv;
    c.strokeStyle = rgba('sepia', 0.22);
    c.lineWidth = 1.3;
    for (const pts of staff) { c.beginPath(); pts.forEach((q, j) => (j ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y))); c.stroke(); }
    c.restore();
    const ly = lyricAt(lyrics, t);
    let head: Pt | null = null;
    if (ly) head = lyricOnPath(c, ly.line, t, staff[2]!, { family: F.archivo(100, this.msg ? 600 : 700), size: this.lyricSize, minSize: 40, offset: -STAFF.gap * 0.2, alpha: ly.k * rv, unsung: rgba('sepia', 0.26), sung: rgba('sepia', this.msg ? 0.82 : 0.94), active: rgba('signal') }).head;

    // ---- 人 → 狗（狗坐在地毯前面，離鏡頭近一點）
    this.drawPeople(c, t);
    this.drawDogs(c, t);
    // ---- 音符：從音孔飄出去，飛到正在唱的字（間奏時落在五線譜上）
    for (const fl of this.flights) this.drawFlight(c, t, fl, head, staff[2]!);
    for (const ts of this.tosses) this.drawToss(c, t, ts);

    this.drawMessage(c, t);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：慢慢推近、往譜架那邊一點
    const push = ease.inOutCubic(f.p), S = this.sheet;
    const fx = lerp(W / 2, S.x + S.w / 2, 0.45), fy = lerp(H / 2, S.y + S.h / 2, 0.4);
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.24, grain: 0.045, ca: 0.5, zoom: 1 + 0.03 * push, shake: [-(fx - W / 2) * 0.03 * push, -(fy - H / 2) * 0.03 * push] };
  }

  /** 宣文（刷弦：拍點往下、半拍往上，往下刷時身體跟著壓一下）與孟庭（唱歌、每兩小節擺一下）。 */
  private drawPeople(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const kick = beatKick(au, t, 0.22);
    const enA = enterPuppet(this.glow, t, this.ctx.start + 0.05, AL_X, FLOOR - 6, 1);
    if (enA) {
      puppetShadow(c, 'xw', AL_X, FLOOR, { h: SZ, alpha: 0.3 * enA.alpha, color: '70,45,25', wide: 1.3 });
      drawPick(c, this.alanKeys, t, AL_X, FLOOR, { h: SZ, rot: 0.012 * kick, pivot: 0.2, squash: 0.014 * kick + breathe(t, 0.006, 3.3), spin: enA.spin, alpha: enA.alpha });
      // 刷下去那一下：音孔旁邊幾條弦的震動線
      if (kick > 0.2) {
        c.save();
        c.strokeStyle = rgba('sepia', 0.35 * kick);
        c.lineWidth = 1.2;
        c.beginPath();
        for (let i = -1; i <= 1; i++) { const x = this.hole.x + 44 + i * 4, y = this.hole.y + i * 10; c.moveTo(x, y); c.quadraticCurveTo(x + 16 * kick, y + 5, x + 30, y + 2); }
        c.stroke();
        c.restore();
      }
    }
    const enO = enterPuppet(this.glow, t, this.ctx.start + 0.15, OM_X, FLOOR - 6, 2);
    if (enO) {
      const nod = beatKick(au, t, 0.3);
      puppetShadow(c, 'mt', OM_X, FLOOR, { h: SZ, alpha: 0.3 * enO.alpha, color: '70,45,25' });
      drawPick(c, this.omKeys, t, OM_X, FLOOR, { h: SZ, rot: 0.03 * Math.sin(au.beatAt(t) * Math.PI * 0.5), pivot: 0.05, squash: 0.012 * nod + breathe(t, 0.008, 3.0, 0.4), spin: enO.spin, alpha: enO.alpha });
    }
  }

  /** 芃芃與 QQ 坐在地毯上：每拍左右搖頭（兩隻相反方向）；副歌（能量高）仰頭一起唱。 */
  private drawDogs(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const loud = au.energyAt(t) > 0.72;
    for (const [who, x, d, ph] of [['pp', PP_X, 0.28, 0], ['qq', QQ_X, 0.34, 1]] as const) {
      const en = enterPuppet(this.glow, t, this.ctx.start + d, x, DOG_Y - 6, who === 'pp' ? 3 : 4);
      if (!en) continue;
      const o: PuppetOpts = { h: SZ, scale: DOG_S, rot: loud ? -0.04 : 0.07 * Math.sin((au.beatAt(t) + ph) * Math.PI), pivot: 0.35, squash: 0.03 * beatKick(au, t, 0.3), spin: en.spin, alpha: en.alpha };
      puppetShadow(c, who, x, DOG_Y, { h: SZ * DOG_S, alpha: 0.3 * en.alpha, color: '70,45,25' });
      drawPuppet(c, loud ? `${who}_howl` : `${who}_sit`, x, DOG_Y, o);
    }
    this.drawYuanyuan(c, t, loud);
  }

  /** 元元：平常歪頭聽（每拍輕輕晃）、副歌仰頭唱；有音符飛過來時跳起來，最高點（拍點）剛好咬住。 */
  private drawYuanyuan(c: CanvasRenderingContext2D, t: number, loud: boolean) {
    const au = this.ctx.audio;
    const en = enterPuppet(this.glow, t, this.ctx.start + 0.4, YY_X, DOG_Y - 6, 5);
    if (!en) return;
    const base: PuppetOpts = { h: SZ, scale: DOG_S, spin: en.spin, alpha: en.alpha };
    const bp = au.beatPeriod(t);
    for (const ts of this.tosses) {
      const air = Math.min(0.5, bp * 1.1);
      if (t > ts.catch - air / 2 - 0.12 && t < ts.catch + air / 2 + 0.25) {
        const j = jumpArc(t, ts.catch - air / 2, ts.catch + air / 2, YJUMP, { crouch: 0.1, land: 0.18 });
        puppetShadow(c, 'yy', YY_X, DOG_Y, { h: SZ * DOG_S, lift: -j.y, alpha: 0.3 * en.alpha, color: '70,45,25' });
        // 跳起來那張圖嘴前畫了網球：這裡咬的是音符，一律蓋掉
        if (j.air) drawPuppet(c, 'yy_jump', YY_X, DOG_Y + j.y, { ...base, hide: ['ball'], rot: -0.12 + 0.24 * j.u, pivot: 0.5, squash: j.squash });
        else drawPuppet(c, loud ? 'yy_howl' : 'yy_tilt', YY_X, DOG_Y, { ...base, squash: j.squash });
        return;
      }
    }
    puppetShadow(c, 'yy', YY_X, DOG_Y, { h: SZ * DOG_S, alpha: 0.3 * en.alpha, color: '70,45,25' });
    drawPuppet(c, loud ? 'yy_howl' : 'yy_tilt', YY_X, DOG_Y, { ...base, rot: loud ? -0.03 : 0.04 * Math.sin(au.beatAt(t) * Math.PI * 0.5), pivot: 0.3, squash: 0.03 * beatKick(au, t, 0.3) });
  }

  /** 給元元的音符：從音孔出發，越過孟庭的頭，落到元元跳起來的嘴前（拍點）；咬到的那一刻冒一圈訊號色的小點。 */
  private drawToss(c: CanvasRenderingContext2D, t: number, ts: Toss) {
    if (t < ts.t || t > ts.catch + 0.35) return;
    const E = this.yyCatch;
    if (t > ts.catch) {
      const k = (t - ts.catch) / 0.35;
      c.save();
      c.globalAlpha = 1 - k;
      c.fillStyle = rgba('signal');
      for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2 + ts.t; c.beginPath(); c.arc(E.x + Math.cos(a) * (14 + 26 * k), E.y + Math.sin(a) * (14 + 26 * k), 3, 0, Math.PI * 2); c.fill(); }
      c.restore();
      return;
    }
    const u = (t - ts.t) / (ts.catch - ts.t);
    const q = arcAt({ x: this.hole.x + 10, y: this.hole.y - 10 }, E, 300, u);
    c.save();
    c.translate(q.x, q.y);
    c.rotate(0.4 * Math.sin(u * 8));
    c.scale(1.35, 1.35);
    c.fillStyle = rgba('signal', 0.95);
    c.strokeStyle = rgba('signal', 0.95);
    c.lineWidth = 2.4;
    // 八分音符（兩顆連在一起）：比一般飄出去的音符大一點、訊號色，看得出是「特別丟給元元的」
    c.beginPath(); c.ellipse(-10, 4, 8, 6, -0.4, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(12, 0, 8, 6, -0.4, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(-3, 2); c.lineTo(-3, -28); c.lineTo(19, -32); c.lineTo(19, -2); c.stroke();
    c.lineWidth = 5; c.beginPath(); c.moveTo(-3, -26); c.lineTo(19, -30); c.stroke();
    c.restore();
  }

  /** 一顆音符：從音孔出發，沿著往上拱的弧線飛到正在唱的字（沒有在唱就落在五線譜上），到了散成一點光。 */
  private drawFlight(c: CanvasRenderingContext2D, t: number, fl: Flight, head: Pt | null, staff: readonly Pt[]) {
    // 沒有在唱（間奏、純音樂）：音符落在五線譜上停一會兒（一個一個排成一小段旋律）再淡掉
    const stay = head ? 0.25 : 2.4;
    if (t < fl.t || t > fl.land + stay) return;
    const u = clamp((t - fl.t) / (fl.land - fl.t));
    // 落點：正在唱的字的正上方（不要蓋到字）；沒有在唱就落在五線譜上
    const end = head ? { x: head.x, y: head.y - this.lyricSize * 0.95 } : staff[8 + Math.floor(hash(fl.seed, 2) * 28)]!;
    const a = { x: this.hole.x + 10, y: this.hole.y - 10 };
    const mid = { x: lerp(a.x, end.x, 0.4), y: Math.min(a.y, end.y) - 120 - 60 * hash(fl.seed, 3) };
    const e = ease.inOutCubic(u);
    const x = (1 - e) * (1 - e) * a.x + 2 * e * (1 - e) * mid.x + e * e * end.x;
    const y = (1 - e) * (1 - e) * a.y + 2 * e * (1 - e) * mid.y + e * e * end.y;
    if (t > fl.land && !head) {
      const k = (t - fl.land) / stay;
      c.save();
      c.globalAlpha = 1 - k * k;
      c.fillStyle = rgba('sepia', 0.7);
      c.strokeStyle = rgba('sepia', 0.7);
      c.lineWidth = 2;
      c.beginPath(); c.ellipse(end.x, end.y, 8, 6, -0.4, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.moveTo(end.x + 7, end.y - 2); c.lineTo(end.x + 7, end.y - 30); c.stroke();
      c.restore();
      return;
    }
    if (t > fl.land) {
      // 到了：散成一點點光（訊號色）
      const k = (t - fl.land) / 0.25;
      c.save();
      c.globalAlpha = 1 - k;
      c.fillStyle = rgba('signal');
      for (let i = 0; i < 5; i++) { const ang = (i / 5) * Math.PI * 2 + fl.seed; c.beginPath(); c.arc(end.x + Math.cos(ang) * 16 * k, end.y - 10 + Math.sin(ang) * 16 * k, 2.5, 0, Math.PI * 2); c.fill(); }
      c.restore();
      return;
    }
    const sc = 0.7 + 0.5 * Math.sin(Math.PI * u);
    c.save();
    c.translate(x, y);
    c.rotate(0.3 * Math.sin(u * 6 + fl.seed));
    c.scale(sc, sc);
    const col = hash(fl.seed, 5) > 0.7 ? rgba('signal', 0.95) : rgba('sepia', 0.8);
    c.fillStyle = col;
    c.strokeStyle = col;
    c.lineWidth = 2.4;
    c.beginPath(); c.ellipse(0, 0, 9, 6.5, -0.4, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(8, -2); c.lineTo(8, -34); c.quadraticCurveTo(18, -26, 20, -14); c.stroke();
    c.restore();
  }

  /** 樂譜紙上的留言：第一拍起逐字寫上去，寫完署名淡入。 */
  private drawMessage(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const S = this.sheet;
    const top = S.y + PAD.top, h = S.h - PAD.top - PAD.bottom;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.15, this.ctx.start + 0.55);
    writeNote(c, n, S.x + PAD.x, top + Math.max(0, (h - n.height) * 0.45), t, this.noteT0, { msg: !!this.msg, color: rgba('sepia', 0.95), faint: rgba('sepia', 0.62), sig: rgba('sepia', 0.74) });
    c.restore();
  }
}
