// 街頭鬥牛（亮、hoops）：午後的公園籃球場，宣文和孟庭穿著 A&O 情侶球衣（寶藍配金黃，背號 420／87）一對一；芃芃和 QQ 在場邊當裁判，元元當撿球的。
// 角色是 Codex 畫的紙偶（_puppet.ts、素材組 hoops；狗坐著的樣子借 base 的 pp_sit／qq_sit，元元用 yuanyuan 組的現成姿勢）。
//  - 宣文運球：一拍拍一下（球在拍點落地、半拍回到手上），左右晃（每兩拍換一邊）；孟庭壓低身體跟著他左右移動防守。
//  - 每兩小節一次（快歌三小節），小節線上宣文跳投（最高點出手）：
//    · 單數次：孟庭同時跳起來蓋火鍋（她的手在出手後一瞬間碰到球），球往左下方被拍掉；
//      芃芃吹哨、QQ 舉手判決；孟庭落地搖手指「不行喔～」，宣文抱頭大笑。
//    · 雙數次：孟庭慢了半拍，球從她手上飛過去空心進（鐵鍊網往下甩），宣文轉過來握拳大叫。
//  - 元元（白色柴犬，2026-09-30 新人加的第三隻狗）是撿球的：平常坐在場邊（一小節坐、一小節歪頭），宣文出手前站起來盯著球。
//    · 被蓋的球：牠從場邊跳起來，最高點（下一拍）在空中一口接住——兩隻小博美跳不到、也叼不動那顆大籃球；
//    · 進的球：牠跑到籃框底下，在球彈起來之後的拍點一口叼起來。
//    叼著球跑到宣文左邊，在拍點上把球交到他手上，再小跑步回場邊坐好。宣文拿到球繼續運球。
//  - **焦點是主打留言**：噴漆寫在球場後面那道牆上（先刷一塊米白的底漆、邊緣有流下來的漆），一個字一個字噴上去（噴嘴有一點漆霧），寫完署名；
//    照「留言尺寸與版面比例標準 v2」：字 40～60、底漆那一塊最大 820 × 420，放在左上，寬高跟著留言。沒有留言時寫邀請。
//  - 歌詞像漆在前景的球場地上（lyricOnPath，逐字跟唱），比留言小一級。
//  - 光線：午後的太陽在左上，牆頭後面探出來的樹梢在拍點上被風推一下。鏡頭整個窗格慢慢推近兩個人。
//  - 右下角 HUD：籃框的柱子站在它上面一點，場線到那裡就淡掉。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { lyricAt, lyricSubOf, subSizeFor, subGap, barAfter, beatAfter, msgChars } from './_motifs';
import { inkFor, paperBG, inkLine, hatch, lyricOnPath, drawNote, arcAt, type Note } from './_couple';
import { loadPuppets, drawPuppet, drawPick, drawCycle, puppetPoint, puppetShadow, puppetIn, jumpArc, breathe, beatKick, landSquash, hop, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { basketball, drawHoop, lyricRows, teamRgba, TEAM_TAG, type Hoop, type Pt } from './_c8';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'hoops', paper: true, energy: [0.4, 1], bars: [4, 8] };

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
/**
 * 元元（撿球的）：場邊的位置（x、腳底）、交球給宣文時站的位置（宣文左邊、面向他）、放大倍數。
 * 牠站在球場這一條（比前景的芃芃、QQ 遠一點），倍數小一點；三隻狗傳同一個場景尺度 SZ，身高比例照 dogs3-lineup。
 * 跑到籃框底下時腳底抬回球場那條線（818），不會踩進右下角 HUD（y ≥ 830）。
 */
const YY = { home: 720, hand: 850, g: 838, s: 1.2 };
const yyGround = (x: number) => lerp(YY.g, GROUND, clamp((x - 1100) / 200));
/** 元元跳起來接球跳多高（px）。 */
const YY_JUMP = 70;
/** 地上粉筆寫的歌詞：沿著這條線。 */
const CHALK: Pt[] = [{ x: 640, y: 972 }, { x: 980, y: 962 }, { x: 1320, y: 970 }];
const BALL_R = 11;
/** 跳多高（px）：宣文跳投、孟庭蓋火鍋。 */
const JUMP = { xw: 64, mt: 96 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const POSES = [
  'xw_hoops_dribble_1', 'xw_hoops_dribble_2', 'xw_hoops_shoot_1', 'xw_hoops_shoot_2', 'xw_hoops_laugh', 'xw_hoops_cheer',
  'mt_hoops_guard_left', 'mt_hoops_block_left', 'mt_hoops_cheer', 'pp_sit', 'pp_hoops_whistle', 'qq_sit', 'qq_hoops_call',
  'yy_sit', 'yy_tilt', 'yy_stand', 'yy_run_1', 'yy_run_2', 'yy_ball', 'yy_jump',
];

/**
 * 一次進攻：C = 出手的小節線；block = 被蓋；contact = 球碰到孟庭的手（被蓋時）或到籃框（進球時）；rest = 球最後會滾到哪。
 * 元元：go 起跑、pick 叼到球（拍點）、pickAt 牠叼球時站的位置與朝向、reset 把球交給宣文（拍點）、handMouth 交球那一刻牠嘴上的球、back 回到場邊。
 */
interface Play {
  C: number; block: boolean; air: number; contact: number; land: number; rest: Pt;
  go: number; pick: number; pickAt: { x: number; dir: 1 | -1 }; carry0: number; reset: number; handMouth: Pt; back: number;
  /** 被蓋的那次：元元跳起來在空中接住被拍掉的球（起跳、落地、x、接到的拍點與位置）。 */
  jump: { t0: number; t1: number; x0: number; x1: number; catchPt: Pt } | null;
}

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
    this.release = puppetPoint('xw_hoops_shoot_2', 'hand', XW_X, GROUND - JUMP.xw, { h: SZ }) ?? { x: XW_X + 70, y: GROUND - JUMP.xw - SZ * 1.15 };
    this.blockAt = puppetPoint('mt_hoops_block_left', 'hand', MT_X - 40, GROUND - JUMP.mt, { h: SZ }) ?? { x: MT_X - 110, y: GROUND - JUMP.mt - SZ * 1.1 };
    // 進攻：開場一小段之後的小節線，每兩小節一次（窗格太短就在下一拍）。
    // 快歌兩小節太短（元元來不及把球撿回來），改成三小節一次
    let C = barAfter(au, s + 1.5);
    if (C > e - 1.4) C = beatAfter(au, s + 1.1);
    const gap = au.timeOfBar(Math.round(au.barAt(C)) + 2) - C < 3.3 ? 3 : 2;
    const yyO = (dir: number): PuppetOpts => ({ h: SZ, scale: YY.s, flip: dir < 0 });
    const fall = Math.sqrt((2 * (GROUND - BALL_R - HOOP.y)) / 1800);
    for (let k = 0; k < 10 && C < e - 1.2; k++) {
      const bp = au.beatPeriod(C), air = clamp(bp * 1.1, 0.45, 0.7);
      const block = k % 2 === 0;
      const contact = block ? C + 0.09 : C + clamp(bp * 0.9, 0.4, 0.7);
      // 進球的球從網子掉下來、在籃框底下彈、往左滾一點（被蓋的球由元元在空中接走，用不到 rest）
      const rest = block ? { x: 470 + 30 * (k % 3), y: GROUND - BALL_R } : { x: HOOP.x - 60, y: GROUND - BALL_R };
      const nextC = au.timeOfBar(Math.round(au.barAt(C)) + gap);
      const p: Play = { C, block, air, contact, land: C + air / 2, rest, go: 0, pick: 0, pickAt: { x: 0, dir: 1 }, carry0: 0, reset: 0, handMouth: { x: 0, y: 0 }, back: 0, jump: null };
      if (block) {
        // 被蓋：球被往左下拍掉，元元從場邊跳起來、最高點（下一拍）剛好在空中一口接住——兩隻小博美跳不到的高度
        const catchT = beatAfter(au, contact + 0.2), ya = clamp(bp, 0.4, 0.6);
        const x0 = YY.home, x1 = YY.hand + 10, xm = (x0 + x1) / 2;
        const catchPt = puppetPoint('yy_jump', 'ball', xm, yyGround(xm) - YY_JUMP, yyO(1))!;
        p.jump = { t0: catchT - ya / 2, t1: catchT + ya / 2, x0, x1, catchPt };
        p.pick = catchT;
        p.go = p.jump.t0 - 0.12;
        p.pickAt = { x: x1, dir: 1 };
        p.carry0 = p.jump.t1 + 0.25;
      } else {
        // 進球：球穿過網子掉下來、在籃框底下彈；元元跑過去，在第一次彈起來之後的拍點叼到（牠站在球旁邊、嘴對著球）
        p.pick = beatAfter(au, contact + fall + 0.25);
        const b = this.flight(p, p.pick);
        const dir: 1 | -1 = b.x >= YY.home ? 1 : -1;
        const m = puppetPoint('yy_ball', 'mouth', 0, 0, yyO(dir))!;
        p.pickAt = { x: b.x - m.x, dir };
        p.go = Math.min(contact + 0.25, p.pick - PICK_IN - Math.abs(p.pickAt.x - YY.home) / 900);
        p.carry0 = p.pick + 0.25;
      }
      // 叼著跑回宣文左邊、在拍點上交球；來不及的話在下一次出手前一拍半交到
      const carry = Math.abs(p.pickAt.x - YY.hand) / 750 + 0.2;
      p.reset = Math.min(beatAfter(au, p.carry0 + carry), nextC - au.beatPeriod(nextC) * 1.5);
      p.handMouth = puppetPoint('yy_ball', 'mouth', YY.hand, yyGround(YY.hand), yyO(1))!;
      p.back = p.reset + 0.35 + Math.abs(YY.hand - YY.home) / 450;
      this.plays.push(p);
      C = nextC;
    }
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
    // 底漆角落的小塗鴉簽名（隊色寶藍，小）
    c.font = font(F.archivo(110, 800), 18);
    c.fillStyle = teamRgba('blue', 0.85);
    c.fillText(`${TEAM_TAG.name} ♥`, P.x + PAD.x, P.y + 38);
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
    const ball = this.ballAt(t);
    this.drawMengting(c, t);
    this.drawXuanwen(c, t);
    // 元元在球場這一條（人的前面一點），芃芃、QQ 在更前面的前景
    this.drawYuanyuan(c, t);
    if (ball) basketball(c, ball.x, ball.y, BALL_R, ball.rot);
    this.drawDogs(c, t);
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
    // 孟庭面向左（防守宣文）：用 Codex 另外畫的朝左版本（_left），不左右翻轉——翻過去球衣上的 A&O、87 會變成反的字
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

  /**
   * 球：運球（拍點落地）→ 出手 → 被蓋（往左下飛、彈兩下）或空心進（網子掉下來、彈）→ 元元叼走（這段畫在牠嘴上，drawYuanyuan）
   * → 交球的拍點從元元嘴上拋回宣文手上。
   */
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
      // 剛交球：球從元元嘴上拋回宣文手上（0.45 秒）
      if (prev && t < prev.reset + 0.45) {
        const u = (t - prev.reset) / 0.45;
        const q = arcAt(prev.handMouth, d, 90, ease.inOutCubic(u));
        return { ...q, rot: t * 3 };
      }
      return t < this.ctx.start + 0.3 ? null : d;
    }
    if (t < p.C) return null; // 拿在 shoot_1 的手上（圖上畫的球）
    if (t >= p.pick - (p.block ? 0 : PICK_IN)) return null; // 元元接到／正要叼、或叼著跑（drawYuanyuan 畫）
    return this.flight(p, t);
  }

  /** 出手之後、元元叼走之前的球：被蓋（往左下飛、彈兩下、往場邊滾）或進球（網子掉下來、彈、往左滾一點）。 */
  private flight(p: Play, t: number): Pt & { rot: number } {
    if (p.block) {
      if (t < p.contact) { const u = (t - p.C) / (p.contact - p.C); return { x: lerp(this.release.x, this.blockAt.x, u), y: lerp(this.release.y, this.blockAt.y, u), rot: 0 }; }
      // 被拍掉：往左下飛，落進跳起來的元元嘴裡
      const J = p.jump!;
      const u = clamp((t - p.contact) / Math.max(0.05, p.pick - p.contact));
      return { ...arcAt(this.blockAt, J.catchPt, 36, u), rot: -(t - p.contact) * 6 };
    }
    // 進球：飛到籃框、從網子掉下來、往左滾到 rest
    if (t < p.contact) { const u = (t - p.C) / (p.contact - p.C); const q = arcAt(this.release, HOOP, 170, u); return { ...q, rot: u * 3 }; }
    const d = t - p.contact, g = 1800, fall = Math.sqrt((2 * (GROUND - BALL_R - HOOP.y)) / g);
    if (d < fall) return { x: HOOP.x, y: HOOP.y + 0.5 * g * d * d, rot: 3 };
    return { ...bounceTo({ x: HOOP.x, y: GROUND - BALL_R }, p.rest, d - fall, 0, g * fall * 0.45), rot: 3 + (d - fall) * 5 };
  }

  /**
   * 元元（撿球的）：場邊坐著（一小節坐、一小節歪頭，拍點上身體壓一下）→ 宣文準備出手時站起來盯著球 →
   * 跑過去（跑步兩張、半拍一張、一步一彈）→ 拍點上低頭叼起籃球（身體往前一傾，球從地上吸到嘴裡）→
   * 叼著跑回宣文左邊站好 → 拍點上把球交給宣文（球從嘴上拋到他手上）→ 看一下，小跑步回場邊。
   * yy_ball 圖上嘴裡本來是網球：蓋掉（hide），嘴上改畫程式的籃球。
   */
  private drawYuanyuan(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, bp = au.beatPeriod(t);
    const ent = puppetIn(t, this.ctx.start + 0.2, 0.42);
    if (ent.alpha <= 0) return;
    const base = (dir: number): PuppetOpts => ({ h: SZ, scale: YY.s, flip: dir < 0, spin: ent.spin, alpha: ent.alpha, hide: ['yy_ball:ball', 'yy_jump:ball'] });
    const shadow = (x: number, lift = 0) => puppetShadow(c, 'yy', x, yyGround(x), { h: SZ * YY.s, lift, alpha: 0.3 * ent.alpha, color: '70,45,25' });
    const wag = 0.04 * beatKick(au, t, 0.25) + breathe(t, 0.012, 1.4, 0.2);
    const runs = ['yy_run_1', 'yy_run_2'];
    const bob = () => hop(au.beatAt(t), 2) * 5;
    const withBall = (name: string, x: number, g: number, o: PuppetOpts) => {
      const m = puppetPoint(name, 'mouth', x, g, o);
      if (m) basketball(c, m.x, m.y + 2, BALL_R, 0.1);
    };
    let P: Play | null = null;
    for (const p of this.plays) if (t >= p.C - bp * 0.5 && t < p.back) P = p;
    // 在場邊：坐著（每小節換坐、歪頭）；宣文準備出手時站起來盯著球
    if (!P || t < P.go) {
      const x = YY.home, g = yyGround(x);
      shadow(x);
      if (P) drawPuppet(c, 'yy_stand', x, g, { ...base(1), squash: landSquash(t, P.C - bp * 0.5, 0.08) + wag * 0.5 });
      else drawPuppet(c, Math.floor(au.barAt(t)) % 2 ? 'yy_tilt' : 'yy_sit', x, g, { ...base(1), squash: wag });
      return;
    }
    const pk = P.pickAt;
    // 被蓋：蹲一下 → 跳起來，最高點（拍點）在空中接住被拍掉的球 → 叼著球落地（就落在宣文左邊）
    if (P.jump && t < P.carry0) {
      const J = P.jump;
      const j = jumpArc(t, J.t0, J.t1, YY_JUMP, { crouch: 0.12, land: 0.16 });
      const x = lerp(J.x0, J.x1, clamp((t - J.t0) / (J.t1 - J.t0))), g = yyGround(x);
      shadow(x, -j.y);
      if (j.air) {
        const o: PuppetOpts = { ...base(1), rot: -0.15 + 0.3 * j.u, pivot: 0.5, squash: j.squash };
        drawPuppet(c, 'yy_jump', x, g + j.y, o);
        if (t >= P.pick) { const b = puppetPoint('yy_jump', 'ball', x, g + j.y, o)!; basketball(c, b.x, b.y, BALL_R, 0.3); }
      } else if (t < J.t0) drawPuppet(c, 'yy_stand', x, g, { ...base(1), squash: j.squash });
      else { const o: PuppetOpts = { ...base(1), squash: j.squash }; drawPuppet(c, 'yy_ball', x, g, o); withBall('yy_ball', x, g, o); }
      return;
    }
    // 跑過去：到的時候剛好是叼到的那一拍
    if (t < P.pick - PICK_IN) {
      const u = clamp((t - P.go) / Math.max(0.1, P.pick - PICK_IN - P.go));
      const x = lerp(YY.home, pk.x, sine(u)), dir = pk.x >= YY.home ? 1 : -1;
      shadow(x, bob());
      drawCycle(c, au, t, runs, 2, x, yyGround(x) - bob(), { ...base(dir), rot: dir * 0.04 });
      return;
    }
    // 叼球：身體往前一傾（最低點在叼到的拍點），球從地上吸到嘴裡
    if (t < P.pick + 0.25) {
      const g = yyGround(pk.x);
      const dip = Math.exp(-Math.pow((t - P.pick) / 0.1, 2));
      const o: PuppetOpts = { ...base(pk.dir), rot: pk.dir * 0.42 * dip, squash: 0.06 * dip };
      shadow(pk.x);
      drawPuppet(c, 'yy_ball', pk.x, g, o);
      const m = puppetPoint('yy_ball', 'mouth', pk.x, g, o)!;
      const free = this.flight(P, Math.min(t, P.pick));
      const k = ease.outCubic(clamp((t - (P.pick - PICK_IN)) / PICK_IN));
      basketball(c, lerp(free.x, m.x, k), lerp(free.y, m.y + 2, k), BALL_R, free.rot);
      return;
    }
    // 叼著跑回宣文左邊，最後一小段站好、面向他
    if (t < P.reset) {
      const t0 = P.carry0, t1 = P.reset - 0.15;
      // 離交球的位置很近（被蓋那次，牠本來就落在宣文左邊）：不用跑，叼著球站著等、拍點上點一下頭
      if (t < t1 && Math.abs(pk.x - YY.hand) < 60) {
        const x = lerp(pk.x, YY.hand, sine(clamp((t - t0) / Math.max(0.1, t1 - t0)))), g = yyGround(x);
        const o: PuppetOpts = { ...base(1), squash: wag };
        shadow(x);
        drawPuppet(c, 'yy_ball', x, g, o);
        withBall('yy_ball', x, g, o);
        return;
      }
      if (t < t1) {
        const u = clamp((t - t0) / Math.max(0.1, t1 - t0));
        const x = lerp(pk.x, YY.hand, sine(u)), dir = YY.hand >= pk.x ? 1 : -1, g = yyGround(x) - bob();
        shadow(x, bob());
        const o: PuppetOpts = { ...base(dir), rot: dir * 0.03 };
        withBall(drawCycle(c, au, t, runs, 2, x, g, o), x, g, o);
        return;
      }
      const g = yyGround(YY.hand), o: PuppetOpts = { ...base(1), squash: landSquash(t, t1, 0.08) };
      shadow(YY.hand);
      drawPuppet(c, 'yy_ball', YY.hand, g, o);
      withBall('yy_ball', YY.hand, g, o);
      return;
    }
    // 交完球：看一下宣文，再小跑步回場邊
    const t2 = P.reset + 0.35;
    if (t < t2) {
      shadow(YY.hand);
      drawPuppet(c, 'yy_stand', YY.hand, yyGround(YY.hand), { ...base(1), squash: wag });
      return;
    }
    const u = clamp((t - t2) / Math.max(0.1, P.back - t2));
    const x = lerp(YY.hand, YY.home, sine(u));
    shadow(x, bob());
    drawCycle(c, au, t, runs, 2, x, yyGround(x) - bob(), base(YY.home >= YY.hand ? 1 : -1));
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
    const two = lyricRows(c, ly.line.text, family, this.lyricSize, 40, len) === 2;
    const path = two ? CHALK.map((q) => ({ x: q.x, y: q.y - 50 })) : CHALK;
    // 韓文歌：原文（lyricOnPath 自動畫在中文下面）也要離下緣 96 px 以上——整段再往上抬原文佔的高度
    const sub = lyricSubOf(ly.line);
    let off = 0;
    if (sub) {
      const ms = two ? 40 : this.lyricSize, ss = subSizeFor(ms);
      // 原文照 lyricOnPath 副行的算法（縮字往下取）判斷要不要折：lyricRows 是四捨五入，剛好放得下的原文會被算成兩排、
      // 整段多抬一排，撞到在球員腳邊的元元（2026-09-30 合併元元之後）
      off = subGap(ms, ss) + (subRows(c, sub.text, family, ss, Math.min(ss, 26), len) - 1) * ss * 1.1;
    }
    lyricOnPath(c, ly.line, t, path, {
      family, size: this.lyricSize, minSize: 40, alpha: ly.k * rv, unsung: rgba('sepia', 0.22), sung: rgba('sepia', 0.85), active: rgba('signal'), rowGap: 1.1, offset: off,
    });
  }
}

/** 原文副行在長 len 的地上排幾排：跟 lyricOnPath 的副行一樣先縮到 minSize（往下取到 0.5 px），還放不下才折兩排。 */
function subRows(c: CanvasRenderingContext2D, text: string, family: string, size: number, minSize: number, len: number): 1 | 2 {
  const chars = Array.from(text);
  const sumAt = (s: number) => { c.font = font(family, s); return chars.reduce((a, ch) => a + c.measureText(ch).width, 0); };
  const avail = len * 0.94, sum = sumAt(size);
  if (sum <= avail) return 1;
  const s2 = Math.floor(Math.max(minSize, (size * avail) / sum) * 2) / 2;
  return sumAt(s2) > avail ? 2 : 1;
}

/** 元元叼球：叼到的拍點前多久球開始往嘴裡吸（秒）。 */
const PICK_IN = 0.12;
/** 慢慢起跑、慢慢停下（元元跑過去、跑回來）。 */
const sine = (u: number) => 0.5 - 0.5 * Math.cos(Math.PI * u);

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
