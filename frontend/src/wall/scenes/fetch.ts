// 丟網球（亮、dog）：紅磚公園步道，宣文把黃綠色網球丟出去，芃芃與 QQ 追、QQ 在拍點上跳起來接住、叼回來。
//  - 一輪兩小節：小節線上出手（丟的動作有預備與跟隨）→ 球飛兩拍 → 第三拍 QQ 跳到最高點剛好咬住（落在拍點）→
//    兩隻狗跑回來 → 第八拍宣文蹲下接球 → 下一個小節線再丟。孟庭在旁邊跟著拍子拍手，接到球的那一刻歡呼。
//  - 歌詞沿著球的拋物線排（lyricOnPath），照跟唱規則逐字亮；球飛過的路留下一條訊號色的細線。
//  - **焦點是主打留言**：寫在公園的木牌上（木頭的顏色、木紋、兩根柱子、牌子的陰影），字最大；牌子上只留一個小小的「公園公告」。
//    木牌大小跟著留言長短。沒有留言時木牌寫邀請、歌詞放大變主角。
//  - 鏡頭：整個窗格慢慢推近木牌；背景的樹很淡，只是空氣。
//  - 開場：火花把人和狗的線稿描出來；紙底（亮版面）、線是墨色（sepia）。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp } from '../engine/util';
import { lyricAt, barAfter, beatAfter, sparkHead, sparkParticles, msgChars } from './_motifs';
import {
  drawPerson, drawDog, inkFor, paperBG, inkLine, inkPath, inkPoly, inkEllipse, hatch, tennisBall, POSE, DOG, DOG_STRIDE, beatSwing, arcAt, arcPts, lyricOnPath, lerpPose, fitNote, drawNote,
  type Pt, type Pose, type DogPose, type Note,
} from './_couple';

export const spec: PlateSpecDecl = { group: 'couple', family: 'dog', paper: true, energy: [0.3, 1], bars: [4, 8] };

const GROUND = 880;
const SZ = 390;
const ALAN_X = 330, OM_X = 175;
/** 木牌的最大範圍（底邊固定、高度跟著留言）與寫字的內距。 */
const SIGN = { x: 580, y: 394, w: 760, h: 428 };
const PAD = { x: 40, top: 70, bottom: 36 };
const CATCH_X = 1510;
const REST_Q = ALAN_X + 135, REST_P = ALAN_X + 260;
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';

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
  release: Pt = { x: 0, y: 0 };
  catchPt: Pt = { x: 0, y: 0 };
  hgt = 300;
  arc: Pt[] = [];
  lyricPath: Pt[] = [];
  note: Note | null = null;
  sign = { ...SIGN };

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('公園公告一位賓客' + INVITE);
    const c = this.fg.ctx;
    // 出手點與接球點：用那一格的姿勢算（reveal 0 = 只算不畫）
    const a = drawPerson(c, 'alan', POSE.throw(0), { x: ALAN_X, y: GROUND, h: SZ, reveal: 0 });
    const q = drawDog(c, 'qq', DOG.jump(0, 1.1), { x: CATCH_X, y: GROUND, h: SZ, reveal: 0 });
    this.release = a.handA; this.catchPt = q.mouth;
    // 頂點在 y 165：歌詞的字頂離上緣還有 96 px 以上
    this.hgt = Math.min(this.release.y, this.catchPt.y) - 165;
    this.arc = arcPts(this.release, this.catchPt, this.hgt, 64);
    // 每一輪：小節線出手、兩拍後接到、第七拍回來、兩小節後下一輪；窗格太短就在下一拍出手
    let rel = barAfter(au, this.ctx.start + 0.8);
    if (this.ctx.end - rel < au.beatPeriod(rel) * 3) rel = beatAfter(au, this.ctx.start + 0.8);
    for (let k = 0; k < 20 && rel < this.ctx.end + 1; k++) {
      const b = Math.round(au.beatAt(rel));
      const next = au.timeOfBeat(b + 8);
      this.cycles.push({ rel, ctc: au.timeOfBeat(b + 2), back: au.timeOfBeat(b + 7), next });
      rel = next;
    }
    // 木牌上的留言：字級依「牌面扣掉署名那一列」算；牌子高度跟著留言長短（短的留言不要一大塊空牌子）
    const w = SIGN.w - PAD.x * 2, hmax = SIGN.h - PAD.top - PAD.bottom;
    this.note = this.msg ? fitNote(c, this.msg.text, this.msg.name, w, hmax, { min: 46, max: 84 }) : fitNote(c, INVITE, null, w, hmax * 0.5, { min: 44, max: 56 });
    const h = Math.min(SIGN.h, Math.max(300, PAD.top + this.note.height + PAD.bottom + 30));
    this.sign = { x: SIGN.x, y: SIGN.y + SIGN.h - h, w: SIGN.w, h };
    // 歌詞只排在拋物線中間八成（兩端太靠近邊）
    this.lyricPath = this.arc.slice(6, 59);
    this.drawBackground();
  }

  /** 不會動的：紅磚步道、草、兩棵樹、木牌（畫一次；背景的線不抖，角色才跳得出來）。 */
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
    rows.forEach((y, r) => { c.moveTo(40, y); c.lineTo(1880, y); });
    for (let r = 0; r < 4; r++) {
      const y0 = r === 0 ? GROUND : rows[r - 1]!, y1 = rows[r] ?? GROUND + 77;
      for (let x = 60 + (r % 2) * 32; x < 1860; x += 64) { c.moveTo(x, y0 + 2); c.lineTo(x - 2, y1 - 2); }
    }
    c.stroke();
    c.restore();
    // 草：步道後緣一撮一撮
    for (let x = 40; x < 1880; x += 38 + ((x * 7) % 23)) {
      if (x > SIGN.x + 20 && x < SIGN.x + SIGN.w - 20 && x % 3 === 0) continue;
      inkPath(c, [{ x, y: GROUND - 1 }, { x: x + 4, y: GROUND - 12 - (x % 9) }, { x: x + 9, y: GROUND - 1 }], { ink, w: 0.5, color: rgba('sepia', 0.5), seed: x });
    }
    // 樹：左邊一棵（被畫面切掉一半）、右邊遠一點一棵；很淡，只是空氣
    const faint = inkFor(true, { line: rgba('sepia', 0.4) });
    this.tree(c, 70, GROUND, 1.25, faint, 11);
    this.tree(c, 1720, GROUND - 6, 0.95, faint, 12);
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
    c.fillText('公園公告', S.x + PAD.x, S.y + 46);
    c.letterSpacing = '0px';
  }

  private tree(c: CanvasRenderingContext2D, x: number, y: number, k: number, ink: ReturnType<typeof inkFor>, seed: number) {
    const top = y - 420 * k;
    inkLine(c, [{ x: x - 14 * k, y }, { x: x - 8 * k, y: top + 120 * k }], { ink, w: 1, seed });
    inkLine(c, [{ x: x + 14 * k, y }, { x: x + 9 * k, y: top + 120 * k }], { ink, w: 1, seed: seed + 1 });
    inkLine(c, [{ x: x + 2 * k, y: top + 190 * k }, { x: x + 60 * k, y: top + 120 * k }], { ink, w: 0.7, seed: seed + 2 });
    const blobs: [number, number, number][] = [[0, 60, 130], [-85, 120, 95], [90, 110, 100], [-10, 170, 110]];
    for (const [dx, dy, r] of blobs) {
      inkEllipse(c, x + dx * k, top + dy * k, r * k, r * 0.8 * k, 0, { ink, fill: rgba('paper'), w: 0.9, seed: seed + dx });
    }
    const crown = [{ x: x - 150 * k, y: top + 200 * k }, { x: x - 150 * k, y: top - 40 * k }, { x: x + 170 * k, y: top - 40 * k }, { x: x + 170 * k, y: top + 200 * k }];
    hatch(c, crown, { ink, angle: -0.9, gap: 12, w: 0.25, color: rgba('sepia', 0.08), seed });
  }

  private cycleAt(t: number): Cycle | null {
    let cur: Cycle | null = null;
    for (const cy of this.cycles) if (cy.rel - 0.7 <= t) cur = cy;
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

    // 歌詞：沿著球的拋物線
    const ly = lyricAt(lyrics, t);
    if (ly) {
      lyricOnPath(c, ly.line, t, this.lyricPath, { family: F.archivo(100, this.msg ? 600 : 700), size: this.msg ? 50 : 62, minSize: 48, offset: 14, alpha: ly.k * rv, unsung: rgba('sepia', 0.24), sung: rgba('sepia', this.msg ? 0.8 : 0.94), active: rgba('signal') });
    }

    // ---- 狗
    const dq = this.dogState(t, cy, 'qq'), dp = this.dogState(t, cy, 'penpen');
    // ---- 人
    const pa = this.alanPose(t, cy, bp), po = this.omenaPose(t, cy, bp);
    const o = drawPerson(c, 'omena', po, { x: OM_X, y: GROUND, h: SZ, ink, t, reveal: rv });
    const a = drawPerson(c, 'alan', pa, { x: ALAN_X, y: GROUND, h: SZ, ink, t, reveal: rv });
    const p = drawDog(c, 'penpen', dp.pose, { x: dp.x, y: GROUND, h: SZ, dir: dp.dir, ink, t, reveal: rv, wag: dp.wag });
    const q = drawDog(c, 'qq', dq.pose, { x: dq.x, y: GROUND, h: SZ, dir: dq.dir, ink, t, reveal: rv, ball: dq.ball, wag: dq.wag });
    for (const j of [a, o, p, q]) if (j.pen) { const pn = j.pen; sparkHead(this.glow, pn.x, pn.y, t, 0.7); sparkParticles(this.glow, t, () => pn, { rate: 50, life: 0.25, speed: 140 }); }

    // ---- 球：出手前在手上、飛行中沿著拋物線（留下訊號色的線）、接到後在 QQ 嘴裡、撿回來後又在手上
    const r = SZ * 0.03;
    if (rv >= 1 && cy) {
      if (t < cy.rel) tennisBall(c, a.handA.x, a.handA.y, r, { ink, t });
      else if (t < cy.ctc) {
        const u = (t - cy.rel) / (cy.ctc - cy.rel);
        const bpnt = arcAt(this.release, this.catchPt, this.hgt, u);
        c.save();
        c.lineCap = 'round';
        const n = 30;
        for (let k = 1; k <= n; k++) {
          const u0 = ((k - 1) / n) * u, u1 = (k / n) * u;
          const p0 = arcAt(this.release, this.catchPt, this.hgt, u0), p1 = arcAt(this.release, this.catchPt, this.hgt, u1);
          c.strokeStyle = rgba('signal', 0.15 + 0.8 * (k / n) ** 2);
          c.lineWidth = 1.5 + 2.5 * (k / n);
          c.beginPath(); c.moveTo(p0.x, p0.y); c.lineTo(p1.x, p1.y); c.stroke();
        }
        c.restore();
        tennisBall(c, bpnt.x, bpnt.y, r, { ink, t });
      } else if (t >= cy.back + bp * 0.5) tennisBall(c, a.handA.x, a.handA.y, r, { ink, t });
    } else if (rv >= 1) tennisBall(c, a.handA.x, a.handA.y, r, { ink, t });
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
          const r0 = 22 + (1 - k) * 26, r1 = r0 + 14 * k;
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

  /** 宣文：拿著球 → 丟（小節線出手）→ 看 → 接到時歡呼 → 蹲下接球 → 站起來拿著球。 */
  private alanPose(t: number, cy: Cycle | null, bp: number): Pose {
    if (!cy) return POSE.throw(-1);
    if (t < cy.rel + 0.5) return POSE.throw(beatSwing(t, cy.rel, Math.min(0.6, bp * 1.2), 0.5));
    const watch = POSE.lookUp();
    const cheer = POSE.cheer();
    const crouch = POSE.crouch();
    if (t < cy.ctc) return lerpPose(POSE.throw(1), watch, prog(t, cy.rel + 0.5, cy.rel + 0.9, ease.inOutCubic));
    if (t < cy.ctc + bp * 1.2) return lerpPose(watch, cheer, prog(t, cy.ctc - 0.05, cy.ctc + 0.12, ease.outCubic));
    if (t < cy.back - bp) return lerpPose(cheer, POSE.stand(), prog(t, cy.ctc + bp * 1.2, cy.ctc + bp * 1.8, ease.inOutCubic));
    if (t < cy.back + bp * 0.6) return lerpPose(POSE.stand(), crouch, prog(t, cy.back - bp, cy.back - bp * 0.2, ease.inOutCubic));
    return lerpPose(crouch, POSE.throw(-1), prog(t, cy.back + bp * 0.6, cy.back + bp * 1.4, ease.inOutCubic));
  }

  /** 孟庭：狗在追的時候跟著拍子拍手、接到時歡呼，其他時候站著看。 */
  private omenaPose(t: number, cy: Cycle | null, bp: number): Pose {
    const au = this.ctx.audio;
    const nb = au.timeOfBeat(Math.round(au.beatAt(t)));
    const clap = POSE.clap(clamp((t - nb) / (bp * 0.5), -1, 1));
    if (!cy) return lerpPose(POSE.stand(), clap, 0.0);
    if (t < cy.rel) return POSE.stand();
    if (t < cy.ctc) return clap;
    if (t < cy.ctc + bp * 1.2) return lerpPose(clap, POSE.cheer(), prog(t, cy.ctc - 0.05, cy.ctc + 0.12, ease.outCubic));
    return lerpPose(POSE.cheer(), clap, prog(t, cy.ctc + bp * 1.2, cy.ctc + bp * 1.6));
  }

  /** 狗的位置與姿勢：等 → 追（跑）→ QQ 在拍點跳起來接 → 跑回來 → 在宣文腳邊坐好。 */
  private dogState(t: number, cy: Cycle | null, who: 'qq' | 'penpen'): { x: number; dir: 1 | -1; pose: DogPose; ball: boolean; wag?: number } {
    const qq = who === 'qq';
    const rest = qq ? REST_Q : REST_P;
    const target = qq ? CATCH_X : CATCH_X - 120;
    const au = this.ctx.audio, bp = au.beatPeriod(t);
    const runPh = (x: number) => x / (DOG_STRIDE.run * SZ);
    const idle = qq ? DOG.play() : DOG.sit();
    if (!cy || t < cy.rel) return { x: rest, dir: 1, pose: idle, ball: false, wag: Math.sin(t * Math.PI * 2 * 3) };
    // 追：出手後才起跑（芃芃晚一點點），越跑越快、快到的時候放慢
    const go = cy.rel + (qq ? 0.05 : 0.18);
    if (t < cy.ctc + 0.4) {
      const u = clamp((t - go) / (cy.ctc - go));
      const x = lerp(rest, target, sine(u));
      let pose = DOG.run(runPh(x - rest));
      if (qq && t > cy.ctc - 0.35) pose = DOG.jump(beatSwing(t, cy.ctc, 0.35, 0.4), 1.1);
      if (!qq && t > cy.ctc - 0.3) pose = DOG.jump(beatSwing(t, cy.ctc + 0.08, 0.3, 0.35), 0.5);
      return { x, dir: 1, pose, ball: qq && t >= cy.ctc };
    }
    // 跑回來（叼著球），到了就坐好
    const u = clamp((t - (cy.ctc + 0.4)) / Math.max(0.3, cy.back - bp * 0.3 - (cy.ctc + 0.4)));
    const x = lerp(target, rest, sine(u));
    if (u < 1) return { x, dir: -1, pose: DOG.run(runPh(target - x)), ball: qq };
    // 回到腳邊：QQ 把球交給宣文（半拍後球回到手上），兩隻狗坐著搖尾巴等下一球
    const hand = t < cy.back + bp * 0.5;
    return { x: rest, dir: 1, pose: qq ? DOG.sit() : DOG.play(), ball: qq && hand, wag: Math.sin(t * Math.PI * 2 * 3.2) };
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
