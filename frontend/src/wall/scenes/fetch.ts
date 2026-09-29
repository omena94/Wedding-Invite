// 丟網球（亮、dog）：紅磚公園步道，宣文把黃綠色網球丟出去，芃芃與 QQ 追、QQ 在拍點上跳起來接住、叼回來。角色是 Codex 畫的紙偶（_puppet.ts）。
//  - 一輪兩小節：小節線上出手（throw_1 往後拉 → throw_2 丟出去）→ 球飛兩拍 → 第三拍 QQ 跳到最高點剛好咬住（落在拍點）→
//    兩隻狗跑回來（QQ 叼著球）→ 第八拍 QQ 把球交給宣文 → 下一個小節線再丟。孟庭在旁邊跟著拍子點頭，接到球的那一刻跳起來歡呼。
//  - 球的接力：出手前球畫在 throw_1 的手上（圖裡的球）；出手後圖上的球蓋掉，改由程式沿拋物線飛（留下訊號色的細線）；
//    QQ 跳起來那張圖本來就畫了嘴前的球：飛行中蓋掉、咬到的那一刻打開，終點就是那顆球的位置，所以接得剛剛好。
//  - 歌詞沿著球的拋物線排（lyricOnPath），照跟唱規則逐字亮；比留言小一級（標準 v2：40～52）。
//  - **焦點是主打留言**：寫在公園的木牌上（木頭的顏色、兩根柱子、牌子的陰影）；照「留言尺寸與版面比例標準 v2」：
//    字 40～60、牌子最大 700 × 400，高度跟著留言長短，牌子架高，狗跑過去不會擋到字。牌子上只留一個小小的「公園公告」。
//    沒有留言時木牌寫邀請、歌詞變主角。
//  - 鏡頭：整個窗格慢慢推近木牌；背景的樹很淡，只是空氣，樹梢跟著拍子輕輕晃。
//  - 開場：四個紙偶從側面翻正進場（仙女棒的火花在腳邊）；紙底（亮版面）、線是墨色（sepia）。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp } from '../engine/util';
import { lyricAt, barAfter, beatAfter, sparkHead, sparkParticles, msgChars } from './_motifs';
import { inkFor, paperBG, inkLine, inkPath, inkPoly, inkEllipse, hatch, tennisBall, arcAt, arcPts, lyricOnPath, drawNote, type Pt, type Note } from './_couple';
import { loadPuppets, drawPuppet, drawCycle, drawPick, puppetPoint, puppetShadow, puppetIn, jumpArc, landSquash, breathe, beatKick, hop, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'couple', family: 'dog', paper: true, energy: [0.3, 1], bars: [4, 8] };

const GROUND = 880;
const SZ = 390;
const ALAN_X = 330, OM_X = 150;
/** 木牌：寬、底邊（架高，狗跑過去擋不到字）、最大高度（標準 v2：寬 ≤ 860、高 ≤ 430）與寫字的內距。 */
const SIGN = { x: 660, w: 700, bottom: 724, h: 400 };
const PAD = { x: 38, top: 62, bottom: 30 };
/** QQ 跳起來咬球的地方（最高點）與跳多高。 */
const CATCH_X = 1390, QJUMP = 92, PJUMP = 48;
const REST_Q = 530, REST_P = 680;
/** 狗在這個版面放大一點（牠們是主角，遠處的桌子也要認得出是芃芃和 QQ）。 */
const DOG_S = 1.2;
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const SPRITES = [
  'xw_throw_1', 'xw_throw_2', 'xw_cheer', 'xw_idle_front', 'mt_idle_front', 'mt_cheer',
  'qq_stand', 'qq_run_1', 'qq_run_2', 'qq_jump', 'qq_ball', 'pp_sit', 'pp_run_1', 'pp_run_2', 'pp_jump',
];

interface Cycle { rel: number; ctc: number; back: number; next: number }
/** 慢慢起跑、慢慢停下（狗追球與跑回來）。 */
const sine = (u: number) => 0.5 - 0.5 * Math.cos(Math.PI * u);

export default class Fetch extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  cycles: Cycle[] = [];
  /** 宣文的姿勢時間軸。 */
  alanKeys: [number, string][] = [];
  release: Pt = { x: 0, y: 0 };
  catchPt: Pt = { x: 0, y: 0 };
  hgt = 300;
  lyricPath: Pt[] = [];
  note: Note | null = null;
  sign = { x: SIGN.x, y: SIGN.bottom - SIGN.h, w: SIGN.w, h: SIGN.h };
  lyricSize = 52;

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('公園公告一位賓客' + INVITE);
    this.track(await loadPuppets(SPRITES));
    // 出手點 = throw_2 圖上的球；接球點 = QQ 跳到最高時圖上嘴前的球
    this.release = puppetPoint('xw_throw_2', 'ball', ALAN_X, GROUND, { h: SZ })!;
    this.catchPt = puppetPoint('qq_jump', 'ball', CATCH_X, GROUND - QJUMP, { h: SZ, scale: DOG_S })!;
    // 頂點在 y 170：歌詞的字頂離上緣還有 96 px 以上
    this.hgt = Math.min(this.release.y, this.catchPt.y) - 170;
    // 歌詞只排在拋物線中間八成（兩端太靠近人和狗）
    this.lyricPath = arcPts(this.release, this.catchPt, this.hgt, 64).slice(7, 55);
    // 每一輪：小節線出手、兩拍後接到、第七拍回來、兩小節後下一輪；窗格太短就在下一拍出手
    let rel = barAfter(au, this.ctx.start + 0.8);
    if (this.ctx.end - rel < au.beatPeriod(rel) * 3) rel = beatAfter(au, this.ctx.start + 0.8);
    for (let k = 0; k < 20 && rel < this.ctx.end + 1; k++) {
      const b = Math.round(au.beatAt(rel));
      const next = au.timeOfBeat(b + 8);
      this.cycles.push({ rel, ctc: au.timeOfBeat(b + 2), back: au.timeOfBeat(b + 7), next });
      rel = next;
    }
    // 宣文：等 → 出手前一拍拿出球往後拉 → 出手 → 看 → 接到時歡呼 → 站著等 → QQ 交球（半拍後）→ 往後拉
    const ks: [number, string][] = [[-1e9, 'xw_idle_front']];
    for (const cy of this.cycles) {
      const bp = au.beatPeriod(cy.rel);
      if (ks[ks.length - 1]![1] !== 'xw_throw_1') ks.push([cy.rel - bp, 'xw_throw_1']);
      ks.push([cy.rel, 'xw_throw_2'], [cy.rel + bp * 1.1, 'xw_idle_front'], [cy.ctc, 'xw_cheer'], [cy.ctc + bp * 1.4, 'xw_idle_front'], [cy.back + bp * 0.5, 'xw_throw_1']);
    }
    this.alanKeys = ks;
    // 木牌上的留言：標準 v2 的字級；牌子的寬高跟著留言（底邊固定、往上長，左右置中）
    const c = this.fg.ctx;
    const w = SIGN.w - PAD.x * 2, hmax = SIGN.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const h = Math.min(SIGN.h, Math.max(230, PAD.top + this.note.height + PAD.bottom + 16));
    const sw = Math.min(SIGN.w, tightenNote(c, this.note, 360) + PAD.x * 2);
    this.sign = { x: SIGN.x + (SIGN.w - sw) / 2, y: SIGN.bottom - h, w: sw, h };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.drawBackground();
  }

  /** 不會動的：紅磚步道、草、木牌（畫一次；背景的線不抖，角色才跳得出來）。樹每格畫（樹梢跟著拍子晃）。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx, ink = inkFor(true);
    L.clear();
    // 紅磚步道：兩條邊線＋一排排錯開的磚縫
    inkLine(c, [{ x: 60, y: GROUND }, { x: 1860, y: GROUND - 2 }], { ink, w: 0.9, seed: 2 });
    inkLine(c, [{ x: 20, y: GROUND + 78 }, { x: 1900, y: GROUND + 76 }], { ink, w: 0.7, seed: 3 });
    c.save();
    c.strokeStyle = rgba('sepia', 0.26);
    c.lineWidth = 1.4;
    c.beginPath();
    const rows = [GROUND + 18, GROUND + 38, GROUND + 58];
    rows.forEach((y) => { c.moveTo(40, y); c.lineTo(1880, y); });
    for (let r = 0; r < 4; r++) {
      const y0 = r === 0 ? GROUND : rows[r - 1]!, y1 = rows[r] ?? GROUND + 77;
      for (let x = 60 + (r % 2) * 32; x < 1860; x += 64) { c.moveTo(x, y0 + 2); c.lineTo(x - 2, y1 - 2); }
    }
    c.stroke();
    c.restore();
    // 草：步道後緣一撮一撮
    for (let x = 40; x < 1880; x += 38 + ((x * 7) % 23)) {
      inkPath(c, [{ x, y: GROUND - 1 }, { x: x + 4, y: GROUND - 12 - (x % 9) }, { x: x + 9, y: GROUND - 1 }], { ink, w: 0.5, color: rgba('sepia', 0.5), seed: x });
    }
    this.drawSign(c, ink);
    L.upload();
  }

  /** 木牌：兩根柱子、牌面有木頭的顏色與幾條木紋、下緣一道陰影；牌子上只有一個小小的「公園公告」。 */
  private drawSign(c: CanvasRenderingContext2D, ink: ReturnType<typeof inkFor>) {
    const S = this.sign;
    // 柱子
    for (const px of [S.x + S.w * 0.16, S.x + S.w * 0.84]) {
      inkPoly(c, [{ x: px - 9, y: S.y + S.h - 6 }, { x: px + 9, y: S.y + S.h - 6 }, { x: px + 9, y: GROUND + 2 }, { x: px - 9, y: GROUND + 2 }], { ink, fill: mixRgba('paper', 'fur', 0.3), w: 0.8, seed: px });
    }
    // 牌子的陰影（往右下一點，讓它離開背景）
    c.fillStyle = rgba('sepia', 0.1);
    c.fillRect(S.x + 10, S.y + 12, S.w, S.h);
    // 牌面：淡淡的木頭色，上亮下暗
    const g = c.createLinearGradient(0, S.y, 0, S.y + S.h);
    g.addColorStop(0, mixRgba('paper', 'fur', 0.16));
    g.addColorStop(1, mixRgba('paper', 'fur', 0.26));
    inkPoly(c, [{ x: S.x, y: S.y }, { x: S.x + S.w, y: S.y + 2 }, { x: S.x + S.w - 2, y: S.y + S.h }, { x: S.x + 2, y: S.y + S.h - 1 }], { ink, fill: rgba('paper'), w: 1.1, seed: 5 });
    c.fillStyle = g;
    c.fillRect(S.x + 3, S.y + 3, S.w - 6, S.h - 6);
    // 木紋：只在牌子的上下緣各兩條很淡的彎線（字後面保持乾淨，不要像橫線紙）
    c.strokeStyle = rgba('sepia', 0.07);
    c.lineWidth = 1.5;
    c.beginPath();
    for (const y of [S.y + 16, S.y + 26, S.y + S.h - 24, S.y + S.h - 14]) {
      c.moveTo(S.x + 14, y);
      c.bezierCurveTo(S.x + S.w * 0.3, y - 4, S.x + S.w * 0.6, y + 5, S.x + S.w - 14, y - 1);
    }
    c.stroke();
    inkPoly(c, [{ x: S.x, y: S.y }, { x: S.x + S.w, y: S.y + 2 }, { x: S.x + S.w - 2, y: S.y + S.h }, { x: S.x + 2, y: S.y + S.h - 1 }], { ink, w: 1.1, seed: 5 });
    c.font = font(F.hei(500), 18);
    c.letterSpacing = '8px';
    c.fillStyle = rgba('sepia', 0.5);
    c.fillText('公園公告', S.x + PAD.x, S.y + 42);
    c.letterSpacing = '0px';
  }

  /** 樹：樹幹不動，樹冠的幾團跟著拍子輕輕晃（sway 0..1 在拍點上推一下再回來）；很淡，只是空氣。 */
  private tree(c: CanvasRenderingContext2D, x: number, y: number, k: number, ink: ReturnType<typeof inkFor>, seed: number, sway: number) {
    const top = y - 420 * k;
    inkLine(c, [{ x: x - 14 * k, y }, { x: x - 8 * k, y: top + 120 * k }], { ink, w: 1, seed });
    inkLine(c, [{ x: x + 14 * k, y }, { x: x + 9 * k, y: top + 120 * k }], { ink, w: 1, seed: seed + 1 });
    inkLine(c, [{ x: x + 2 * k, y: top + 190 * k }, { x: x + 60 * k, y: top + 120 * k }], { ink, w: 0.7, seed: seed + 2 });
    const blobs: [number, number, number][] = [[0, 60, 130], [-85, 120, 95], [90, 110, 100], [-10, 170, 110]];
    for (const [dx, dy, r] of blobs) {
      const s = sway * (1 - dy / 220) * 7;
      inkEllipse(c, x + (dx + s) * k, top + dy * k, r * k, r * 0.8 * k, 0, { ink, fill: rgba('paper'), w: 0.9, seed: seed + dx });
    }
    const crown = [{ x: x - 150 * k, y: top + 200 * k }, { x: x - 150 * k, y: top - 40 * k }, { x: x + 170 * k, y: top - 40 * k }, { x: x + 170 * k, y: top + 200 * k }];
    hatch(c, crown, { ink, angle: -0.9, gap: 12, w: 0.25, color: rgba('sepia', 0.08), seed });
  }

  /** 這一格屬於哪一輪：上一輪 QQ 把球交給宣文（下一次出手前半拍）之後才換下一輪。 */
  private cycleAt(t: number): Cycle | null {
    const au = this.ctx.audio;
    let cur: Cycle | null = null;
    for (const cy of this.cycles) if (cy.rel - au.beatPeriod(cy.rel) * 0.5 <= t) cur = cy;
    return cur;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const bp = au.beatPeriod(t);
    this.paper.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const ink = inkFor(true);
    const rv = prog(t, s, s + 0.6, ease.inOutCubic);
    const cy = this.cycleAt(t);

    // 樹（很淡）：拍點上樹梢被風推一下
    const gust = beatKick(au, t, 0.5);
    const faint = inkFor(true, { line: rgba('sepia', 0.4) });
    this.tree(c, 70, GROUND, 1.25, faint, 11, gust);
    this.tree(c, 1720, GROUND - 6, 0.95, faint, 12, gust * 0.8);

    // 歌詞：沿著球的拋物線
    const ly = lyricAt(lyrics, t);
    if (ly) {
      lyricOnPath(c, ly.line, t, this.lyricPath, { family: F.archivo(100, this.msg ? 600 : 700), size: this.lyricSize, minSize: 40, offset: 14, alpha: ly.k * rv, unsung: rgba('sepia', 0.24), sung: rgba('sepia', this.msg ? 0.8 : 0.94), active: rgba('signal') });
    }

    // ---- 人（後面）→ 狗（前面）
    this.drawOmena(c, t, cy, bp);
    this.drawAlan(c, t, cy, bp);
    this.drawDog(c, t, cy, 'pp');
    this.drawDog(c, t, cy, 'qq');

    // ---- 飛行中的球：沿著拋物線（留下訊號色的線）
    const r = 8;
    if (cy && t >= cy.rel && t < cy.ctc) {
      const u = (t - cy.rel) / (cy.ctc - cy.rel);
      const bpnt = arcAt(this.release, this.catchPt, this.hgt, u);
      c.save();
      c.lineCap = 'round';
      const n = 30;
      for (let k = 1; k <= n; k++) {
        const p0 = arcAt(this.release, this.catchPt, this.hgt, ((k - 1) / n) * u), p1 = arcAt(this.release, this.catchPt, this.hgt, (k / n) * u);
        c.strokeStyle = rgba('signal', 0.15 + 0.8 * (k / n) ** 2);
        c.lineWidth = 1.5 + 2.5 * (k / n);
        c.beginPath(); c.moveTo(p0.x, p0.y); c.lineTo(p1.x, p1.y); c.stroke();
      }
      c.restore();
      tennisBall(c, bpnt.x, bpnt.y, r, { ink, t });
    }
    // 接到的那一刻：嘴邊一圈短線（訊號色）
    if (cy) {
      const k = 1 - clamp((t - cy.ctc) / 0.22);
      if (k > 0 && t >= cy.ctc) {
        c.save();
        c.strokeStyle = rgba('signal', k);
        c.lineWidth = 3;
        c.lineCap = 'round';
        c.beginPath();
        for (let i = 0; i < 7; i++) {
          const ang = (i / 7) * Math.PI * 2 - 0.4;
          const r0 = 24 + (1 - k) * 26, r1 = r0 + 14 * k;
          c.moveTo(this.catchPt.x + Math.cos(ang) * r0, this.catchPt.y + Math.sin(ang) * r0);
          c.lineTo(this.catchPt.x + Math.cos(ang) * r1, this.catchPt.y + Math.sin(ang) * r1);
        }
        c.stroke();
        c.restore();
      }
    }

    this.drawNotice(c, t);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：整個窗格慢慢推近木牌（最多 1.03 倍，字離邊界的距離已經算進去）
    const push = ease.inOutCubic(f.p);
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.24, grain: 0.045, ca: 0.5, zoom: 1 + 0.03 * push, shake: [-(this.sign.x + this.sign.w / 2 - W / 2) * 0.03 * push, -(this.sign.y + this.sign.h / 2 - H / 2) * 0.03 * push] };
  }

  /** 進場：從側面翻正（火花在腳邊）。回傳要加到 opts 的 spin／alpha；還沒輪到回傳 null。 */
  private enter(t: number, delay: number, x: number, seed: number) {
    const e = puppetIn(t, this.ctx.start + delay, 0.42);
    if (e.alpha <= 0) return null;
    if (e.k < 1) {
      const px = x, py = GROUND - 6;
      sparkHead(this.glow, px, py, t, 0.7);
      sparkParticles(this.glow, t, () => ({ x: px, y: py }), { rate: 50, life: 0.25, speed: 140, seed });
    }
    return { spin: e.spin, alpha: e.alpha };
  }

  /** 宣文：姿勢照時間軸；出手前往後拉、出手往前送；歡呼時跳一下；等的時候跟著拍子。 */
  private drawAlan(c: CanvasRenderingContext2D, t: number, cy: Cycle | null, bp: number) {
    const en = this.enter(t, 0.05, ALAN_X, 1);
    if (!en) return;
    const au = this.ctx.audio;
    let rot = 0, lift = 0, squash = breathe(t, 0.008, 3.2) + 0.01 * beatKick(au, t, 0.3);
    // 出手前一拍往後拉、出手往前送（每一輪都算：往後拉的時候上一輪還沒結束）
    for (const k of this.cycles) {
      if (t < k.rel) rot -= 0.07 * prog(t, k.rel - bp, k.rel, ease.inOutCubic);
      else if (t < k.rel + bp * 2) rot += 0.08 * Math.exp(-(t - k.rel) / (bp * 0.4));
    }
    if (cy) {
      const j = jumpArc(t, cy.ctc - 0.02, cy.ctc + bp * 0.7, 30, { crouch: 0.06, land: 0.1 });
      if (j.air || t > cy.ctc) { lift = -j.y; squash += j.squash; }
    }
    // throw_2 圖上的球一律蓋掉（出手後球由程式在飛）；throw_1 的球是手上拿著的，不蓋
    const o: PuppetOpts = { h: SZ, rot, pivot: 0.4, squash, spin: en.spin, alpha: en.alpha, hide: ['xw_throw_2:ball'] };
    puppetShadow(c, 'xw', ALAN_X, GROUND, { h: SZ, lift, alpha: 0.3 * en.alpha, color: '70,45,25' });
    drawPick(c, this.alanKeys, t, ALAN_X, GROUND - lift, o);
  }

  /** 孟庭：站在旁邊跟著拍子點頭；接到球的那一刻跳起來歡呼。 */
  private drawOmena(c: CanvasRenderingContext2D, t: number, cy: Cycle | null, bp: number) {
    const en = this.enter(t, 0.14, OM_X, 2);
    if (!en) return;
    const au = this.ctx.audio;
    const cheer = !!cy && t >= cy.ctc - 0.03 && t < cy.ctc + bp * 1.5;
    let lift = 0, squash = breathe(t, 0.01, 2.9, 0.3) + 0.03 * beatKick(au, t, 0.25);
    const rot = cheer ? 0 : 0.025 * Math.sin(au.beatAt(t) * Math.PI);
    if (cy) {
      const j = jumpArc(t, cy.ctc - 0.03, cy.ctc + bp * 0.8, 44, { crouch: 0.08, land: 0.12 });
      if (j.air || t > cy.ctc) { lift = -j.y; squash = j.squash || squash; }
    }
    puppetShadow(c, 'mt', OM_X, GROUND, { h: SZ, lift, alpha: 0.3 * en.alpha, color: '70,45,25' });
    drawPuppet(c, cheer ? 'mt_cheer' : 'mt_idle_front', OM_X, GROUND - lift, { h: SZ, rot, pivot: 0.1, squash, spin: en.spin, alpha: en.alpha });
  }

  /**
   * 一隻狗：等（QQ 站著、芃芃坐著，拍點上興奮地壓一下）→ 出手後追（跑步兩張、半拍一張、一步一彈）→
   * 在拍點跳起來（QQ 咬到球、芃芃撲空）→ 轉身跑回來（QQ 叼著球）→ 回到宣文腳邊（QQ 面向宣文叼著球，交球後轉回來）。
   */
  private drawDog(c: CanvasRenderingContext2D, t: number, cy: Cycle | null, who: 'qq' | 'pp') {
    const qq = who === 'qq';
    const rest = qq ? REST_Q : REST_P;
    const en = this.enter(t, qq ? 0.24 : 0.32, rest, qq ? 3 : 4);
    if (!en) return;
    const au = this.ctx.audio, bp = au.beatPeriod(t);
    const idle = qq ? 'qq_stand' : 'pp_sit';
    const base: PuppetOpts = { h: SZ, scale: DOG_S, spin: en.spin, alpha: en.alpha };
    const shadow = (x: number, lift: number) => puppetShadow(c, who, x, GROUND, { h: SZ * DOG_S, lift, alpha: 0.32 * en.alpha, color: '70,45,25' });
    const wait = (flip: boolean, name: string) => {
      shadow(rest, 0);
      drawPuppet(c, name, rest, GROUND, { ...base, flip, squash: 0.05 * beatKick(au, t, 0.25) + breathe(t, 0.015, 1.3, qq ? 0 : 0.5) });
    };
    if (!cy || t < cy.rel) { wait(false, idle); return; }
    const air = Math.min(0.5, bp * 1.1);
    const jx = qq ? CATCH_X : CATCH_X - 190;
    const takeoff = cy.ctc - air / 2, land = cy.ctc + air / 2;
    const go = cy.rel + (qq ? 0.05 : 0.18);
    const runs = [`${who}_run_1`, `${who}_run_2`];
    // 追：出手後才起跑（芃芃晚一點點），越跑越快、快到的時候放慢，剛好在起跳點
    if (t < takeoff) {
      const x = lerp(rest, jx - 65, sine(clamp((t - go) / (takeoff - go))));
      if (t < go) { wait(false, idle); return; }
      const b = hop(au.beatAt(t), 2) * 9;
      shadow(x, b);
      drawCycle(c, au, t, runs, 2, x, GROUND - b, { ...base, rot: 0.04 });
      return;
    }
    // 跳：最高點在拍點上（QQ 咬到球：飛行中蓋掉圖上的球，咬到的那一刻打開）
    const back0 = land + 0.12, back1 = Math.max(back0 + 0.3, cy.back - bp * 0.3);
    if (t < land + 0.12) {
      // 最高點（拍點）剛好在 jx、身體水平：接球點（init 裡的 catchPt）就是照這個位置算的
      const j = jumpArc(t, takeoff, land, qq ? QJUMP : PJUMP, { crouch: 0, land: 0.2 });
      const x = lerp(jx - 65, jx + 65, clamp((t - takeoff) / (land - takeoff)));
      shadow(x, -j.y);
      const hide = !qq || t < cy.ctc ? ['ball'] : undefined;
      if (j.air) drawPuppet(c, `${who}_jump`, x, GROUND + j.y, { ...base, hide, rot: -0.2 + 0.4 * j.u, pivot: 0.5, squash: j.squash });
      else drawPuppet(c, `${who}_run_1`, jx + 65, GROUND, { ...base, squash: landSquash(t, land, 0.2) });
      return;
    }
    // 跑回來（叼著球），到了就停在宣文腳邊
    if (t < back1) {
      const x = lerp(jx + 65, rest, sine(clamp((t - back0) / (back1 - back0))));
      const b = hop(au.beatAt(t), 2) * 9;
      shadow(x, b);
      const o: PuppetOpts = { ...base, flip: true, rot: -0.04 };
      const name = drawCycle(c, au, t, runs, 2, x, GROUND - b, o);
      if (qq) { const m = puppetPoint(name, 'mouth', x, GROUND - b, o); if (m) tennisBall(c, m.x, m.y + 2, 8, { ink: inkFor(true), t }); }
      return;
    }
    // 回到腳邊：QQ 面向宣文叼著球，半拍後交球（球回到宣文手上），轉回來等下一球；芃芃坐下
    const squash = landSquash(t, back1, 0.12);
    if (qq && t < cy.back + bp * 0.5) { shadow(rest, 0); drawPuppet(c, 'qq_ball', rest, GROUND, { ...base, flip: true, squash }); return; }
    if (!qq) { shadow(rest, 0); drawPuppet(c, 'pp_sit', rest, GROUND, { ...base, squash: squash + 0.04 * beatKick(au, t, 0.25) }); return; }
    wait(false, idle);
  }

  /** 木牌上的留言：第一拍起一個字一個字寫上去（手寫字、墨色），寫完署名淡入；在牌面上垂直置中。 */
  private drawNotice(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const S = this.sign;
    const t0 = Math.min(this.cycles[0]?.rel ?? this.ctx.start + 0.8, this.ctx.start + 0.9);
    const total = msgChars(n.fit);
    const per = clamp(1.5 / Math.max(1, total), 0.03, 0.1);
    const top = S.y + PAD.top, h = S.h - PAD.top - PAD.bottom;
    const done = t0 + total * per;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.6);
    drawNote(c, n, S.x + PAD.x, top + Math.max(0, (h - n.height) * 0.45), {
      chars: this.msg ? (t - t0) / per : Infinity, color: this.msg ? rgba('sepia', 0.96) : rgba('sepia', 0.66), sigColor: rgba('sepia', 0.78), sigK: prog(t, done + 0.1, done + 0.5),
    });
    c.restore();
  }
}
