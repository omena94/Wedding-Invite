// 丟網球（亮、dog）：紅磚公園步道，宣文站左邊、孟庭站右邊，兩人輪流把黃綠色網球丟給芃芃和 QQ，狗在中間來回跑。角色是 Codex 畫的紙偶（_puppet.ts）。
// 2026-09-29 新人：「丟網球的一人站一邊，不然一個人很像阿呆站在那裡」→ 兩人分站兩側、輪流丟，兩個人都一直有事做。
//  - 一趟兩小節，兩人輪流：小節線上出手（往後拉 → 丟出去）→ 球在第一拍落地彈一下 → 第二拍接球的那隻狗跳到最高點剛好咬住（落在拍點）→
//    兩隻狗跑到對面那個人前面 → 對面的人蹲下接球（第五拍，球從狗嘴裡到手上）、摸摸狗 → 站起來往後拉 → 下一個小節線換他丟回去，狗往回跑。
//    接球的狗每趟輪流（QQ、芃芃），另一隻晚一點起跑、在後面撲空。
//  - 沒在丟的人也有事：對方丟的時候拍手叫狗、狗接到的時候歡呼跳一下；自己丟完之後看、歡呼，快輪到對方丟回來時拍手叫狗回來。
//  - 球的接力：出手前球是圖上手裡的球；出手後由程式沿著拋物線飛（留下訊號色的細線），xw_throw_2 手邊畫好的球蓋掉；
//    狗跳起來那張圖本來就畫了嘴前的球：飛行中蓋掉、咬到的那一刻打開，終點就是那顆球的位置，所以接得剛剛好。
//    跑回去時球畫在嘴上；交球的那一刻換成人蹲著摸狗、手上拿著球的那張。
//  - 歌詞沿著場地上方一道固定的拋物線排（lyricOnPath），照跟唱規則逐字亮；比留言小一級（標準 v2：40～52）。球從字旁邊飛過去。
//  - **焦點是主打留言**：寫在上方中間吊著的公園木牌上（兩條繩子往上吊、木頭的顏色、影子），不擋到兩個人與狗跑的路線；
//    照「留言尺寸與版面比例標準 v2」：字 40～60、牌子最大 860 × 330，寬高都跟著留言。牌子上只留一個小小的「公園公告」。
//    沒有留言時木牌寫邀請、歌詞變主角。
//  - 鏡頭：整個窗格慢慢推近木牌；背景的樹很淡，樹梢跟著拍子輕輕晃；球落地時揚起一點灰。
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
import { loadPuppets, drawPuppet, drawCycle, drawPick, pick, puppetPoint, puppetShadow, puppetIn, jumpArc, landSquash, breathe, beatKick, hop, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'couple', family: 'dog', paper: true, energy: [0.3, 1], bars: [4, 8] };

/** 地面：比一般高一點，右邊孟庭的腳才不會碰到右下角的 HUD。 */
const GROUND = 820;
const SZ = 390;
/** 兩個人站的位置：宣文左、孟庭右（孟庭的圖翻過來面向左）。 */
const XS = [250, 1650] as const;
/** 木牌：上方中間吊著；最大寬高（標準 v2：寬 ≤ 860、高 ≤ 430；這裡壓在 330 以內，底下留給歌詞與球）與寫字的內距。 */
const SIGN = { cx: 960, top: 60, w: 860, h: 330 };
const PAD = { x: 38, top: 50, bottom: 24 };
/** 接球的地方（跳到最高的 x）：往右丟在右邊接、往左丟在左邊接；另一隻狗在後面 190 px 撲空。 */
const CATCH = [1160, 760] as const;
const JUMP = { qq: 92, pp: 80 };
/** 狗在這個版面放大一點（牠們是主角，遠處的桌子也要認得出是芃芃和 QQ）。 */
const DOG_S = 1.2;
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const PEOPLE = ['xw', 'mt'] as const;
const SPRITES = [
  'xw_throw_1', 'xw_throw_2', 'xw_cheer', 'xw_idle_front', 'xw_fetch_clap', 'xw_fetch_take', 'xw_fetch_pet',
  'mt_fetch_throw_1', 'mt_fetch_throw_2', 'mt_cheer', 'mt_idle_front', 'mt_fetch_clap', 'mt_fetch_take', 'mt_fetch_pet',
  'qq_stand', 'qq_run_1', 'qq_run_2', 'qq_jump', 'qq_ball', 'pp_stand', 'pp_sit', 'pp_run_1', 'pp_run_2', 'pp_jump', 'pp_ball',
];

type Dog = 'qq' | 'pp';
/** 一趟：誰丟（0 宣文往右、1 孟庭往左）、出手、球落地、咬到、對面的人接到球，哪隻狗接。 */
interface Leg { rel: number; bounce: number; ctc: number; hand: number; next: number; from: 0 | 1; catcher: Dog; release: Pt; bounceAt: Pt; catchPt: Pt }
/** 慢慢起跑、慢慢停下（狗追球與跑過去）。 */
const sine = (u: number) => 0.5 - 0.5 * Math.cos(Math.PI * u);
const other = (d: Dog): Dog => (d === 'qq' ? 'pp' : 'qq');
const throw1 = (p: 0 | 1) => (p ? 'mt_fetch_throw_1' : 'xw_throw_1');
const throw2 = (p: 0 | 1) => (p ? 'mt_fetch_throw_2' : 'xw_throw_2');

export default class Fetch extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  legs: Leg[] = [];
  /** 兩個人的姿勢時間軸。 */
  keys: [number, string][][] = [[], []];
  /** 狗停在人前面的位置：[哪一邊][哪隻狗] → near（交球的那隻，嘴剛好在人蹲下伸出的手上）、far（旁邊那隻）。 */
  spots = [{ qq: { near: 0, far: 0 }, pp: { near: 0, far: 0 } }, { qq: { near: 0, far: 0 }, pp: { near: 0, far: 0 } }];
  lyricPath: Pt[] = [];
  note: Note | null = null;
  sign = { x: SIGN.cx - SIGN.w / 2, y: SIGN.top, w: SIGN.w, h: SIGN.h };
  lyricSize = 52;

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('公園公告一位賓客' + INVITE);
    this.track(await loadPuppets(SPRITES));
    // 狗停的位置：交球的那隻面向人、嘴對準人蹲下伸出來的手（右邊的孟庭翻過來，手在她左邊）
    for (const side of [0, 1] as const) {
      const hand = puppetPoint(`${PEOPLE[side]}_fetch_take`, 'hand', XS[side], GROUND, { h: SZ, flip: side === 1 })!;
      for (const d of ['qq', 'pp'] as const) {
        const m = puppetPoint(`${d}_ball`, 'ball', 0, GROUND, { h: SZ, scale: DOG_S, flip: side === 0 })!;
        const near = hand.x - m.x;
        this.spots[side]![d] = { near, far: near + (side === 0 ? 150 : -150) };
      }
    }
    // 一趟兩小節：小節線出手、第一拍落地、第二拍咬到、第五拍交球、兩小節後對面丟回來；窗格太短就在下一拍出手
    let rel = barAfter(au, this.ctx.start + 0.8);
    if (this.ctx.end - rel < au.beatPeriod(rel) * 3) rel = beatAfter(au, this.ctx.start + 0.8);
    for (let k = 0; k < 20 && rel < this.ctx.end + 1; k++) {
      const b = Math.round(au.beatAt(rel));
      const from = (k % 2) as 0 | 1, catcher: Dog = k % 2 ? 'pp' : 'qq', dir = from === 0 ? 1 : -1;
      const release = from === 0 ? puppetPoint('xw_throw_2', 'ball', XS[0], GROUND, { h: SZ })! : puppetPoint('mt_fetch_throw_2', 'hand', XS[1], GROUND, { h: SZ, flip: true })!;
      const catchPt = puppetPoint(`${catcher}_jump`, 'ball', CATCH[from], GROUND - JUMP[catcher], { h: SZ, scale: DOG_S, flip: dir < 0 })!;
      const bounceAt = { x: lerp(release.x, catchPt.x, 0.52), y: GROUND - 6 };
      this.legs.push({ rel, bounce: au.timeOfBeat(b + 1), ctc: au.timeOfBeat(b + 2), hand: au.timeOfBeat(b + 5), next: au.timeOfBeat(b + 8), from, catcher, release, bounceAt, catchPt });
      rel = au.timeOfBeat(b + 8);
    }
    this.buildKeys();
    // 歌詞：場地上方一道固定的拋物線（字在線的上面，頂點在木牌底下）
    this.lyricPath = arcPts({ x: 540, y: 630 }, { x: 1380, y: 630 }, 150, 64);
    // 木牌上的留言：標準 v2 的字級；牌子的寬高都跟著留言，上緣固定、左右置中
    const c = this.fg.ctx;
    const w = SIGN.w - PAD.x * 2, hmax = SIGN.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const h = Math.min(SIGN.h, Math.max(200, PAD.top + this.note.height + PAD.bottom + 12));
    const sw = Math.min(SIGN.w, tightenNote(c, this.note, 360) + PAD.x * 2);
    this.sign = { x: SIGN.cx - sw / 2, y: SIGN.top, w: sw, h };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.drawBackground();
  }

  /**
   * 兩個人的姿勢時間軸。丟的人：往後拉（前一拍）→ 丟出去 → 看 → 狗咬到時歡呼 → 看一拍 → 對方接球、摸狗時就拍手叫狗回來；
   * 接的人：拍手叫狗 → 咬到時歡呼 → 狗跑過來前蹲下伸手 → 交球的那一刻換成摸狗、手上拿著球 → 站起來往後拉 → 下一趟換他丟。
   */
  private buildKeys() {
    const au = this.ctx.audio;
    const ks: [number, string][][] = [[[-1e9, 'xw_idle_front']], [[-1e9, 'mt_idle_front']]];
    const push = (p: 0 | 1, t: number, n: string) => { const k = ks[p]!; if (k[k.length - 1]![1] !== n) k.push([t, n]); };
    const first = this.legs[0];
    if (first) {
      const bp = au.beatPeriod(first.rel);
      push(first.from, first.rel - bp, throw1(first.from));
      push((1 - first.from) as 0 | 1, first.rel - bp * 2, `${PEOPLE[1 - first.from]}_fetch_clap`);
    }
    for (const L of this.legs) {
      const bp = au.beatPeriod(L.rel), s = L.from, r = (1 - s) as 0 | 1;
      // 丟的人
      push(s, L.rel, throw2(s));
      push(s, L.rel + bp * 1.1, `${PEOPLE[s]}_idle_front`);
      push(s, L.ctc, `${PEOPLE[s]}_cheer`);
      push(s, L.ctc + bp * 1.4, `${PEOPLE[s]}_idle_front`);
      // 對方蹲下接球、摸狗的時候就開始拍手叫狗回來（只站著看一拍，不要像阿呆站在那裡）
      push(s, L.rel + bp * 4.5, `${PEOPLE[s]}_fetch_clap`);
      // 接的人
      push(r, L.rel - bp * 2, `${PEOPLE[r]}_fetch_clap`);
      push(r, L.ctc, `${PEOPLE[r]}_cheer`);
      push(r, L.rel + bp * 3.5, `${PEOPLE[r]}_fetch_take`);
      push(r, L.hand, `${PEOPLE[r]}_fetch_pet`);
      push(r, L.rel + bp * 7, throw1(r));
    }
    // 兩個人的事件是分開排的：照時間排好
    this.keys = ks.map((k) => k.sort((a, b) => a[0] - b[0]));
  }

  /** 不會動的：紅磚步道、草、吊著的木牌（畫一次；背景的線不抖，角色才跳得出來）。樹每格畫（樹梢跟著拍子晃）。 */
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

  /** 木牌：兩條繩子往上吊（吊在畫面外的樹枝上），牌面有木頭的顏色與幾條木紋、影子；牌子上只有一個小小的「公園公告」。 */
  private drawSign(c: CanvasRenderingContext2D, ink: ReturnType<typeof inkFor>) {
    const S = this.sign;
    for (const [px, ox] of [[S.x + 60, -40], [S.x + S.w - 60, 40]] as const) inkLine(c, [{ x: px, y: S.y + 4 }, { x: px + ox, y: -10 }], { ink, w: 0.7, seed: px });
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
    for (const y of [S.y + 14, S.y + 22, S.y + S.h - 20, S.y + S.h - 12]) {
      c.moveTo(S.x + 14, y);
      c.bezierCurveTo(S.x + S.w * 0.3, y - 4, S.x + S.w * 0.6, y + 5, S.x + S.w - 14, y - 1);
    }
    c.stroke();
    inkPoly(c, [{ x: S.x, y: S.y }, { x: S.x + S.w, y: S.y + 2 }, { x: S.x + S.w - 2, y: S.y + S.h }, { x: S.x + 2, y: S.y + S.h - 1 }], { ink, w: 1.1, seed: 5 });
    c.font = font(F.hei(500), 18);
    c.letterSpacing = '8px';
    c.fillStyle = rgba('sepia', 0.5);
    c.fillText('公園公告', S.x + PAD.x, S.y + 36);
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

  /** 這一格是第幾趟：下一趟出手前半拍（狗轉身準備追）才換過去；還沒開始是 -1。 */
  private legAt(t: number) {
    const au = this.ctx.audio;
    let i = -1;
    for (let k = 0; k < this.legs.length; k++) if (this.legs[k]!.rel - au.beatPeriod(this.legs[k]!.rel) * 0.5 <= t) i = k;
    return i;
  }

  /** 球在 t 的位置：出手 → 第一拍落地（彈一下）→ 第二拍到接球點；不在飛就是 null。 */
  private ballAt(L: Leg, t: number): (Pt & { seg: number; u: number }) | null {
    if (t < L.rel || t >= L.ctc) return null;
    if (t < L.bounce) { const u = (t - L.rel) / (L.bounce - L.rel); return { ...arcAt(L.release, L.bounceAt, Math.max(30, L.release.y - 440), u), seg: 0, u }; }
    const u = (t - L.bounce) / (L.ctc - L.bounce);
    return { ...arcAt(L.bounceAt, L.catchPt, Math.max(40, L.catchPt.y - 560), u), seg: 1, u };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.paper.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const ink = inkFor(true);
    const rv = prog(t, s, s + 0.6, ease.inOutCubic);
    const li = this.legAt(t), leg = this.legs[li] ?? null;

    // 樹（很淡）：拍點上樹梢被風推一下
    const gust = beatKick(au, t, 0.5);
    const faint = inkFor(true, { line: rgba('sepia', 0.4) });
    this.tree(c, 70, GROUND, 1.15, faint, 11, gust);
    this.tree(c, 1790, GROUND - 6, 0.95, faint, 12, gust * 0.8);

    // 歌詞：場地上方的拋物線
    const ly = lyricAt(lyrics, t);
    if (ly) lyricOnPath(c, ly.line, t, this.lyricPath, { family: F.archivo(100, this.msg ? 600 : 700), size: this.lyricSize, minSize: 40, offset: 14, alpha: ly.k * rv, unsung: rgba('sepia', 0.24), sung: rgba('sepia', this.msg ? 0.8 : 0.94), active: rgba('signal') });

    // ---- 人（後面）→ 狗（前面）
    this.drawPerson(c, t, 0);
    this.drawPerson(c, t, 1);
    this.drawDog(c, t, li, 'pp');
    this.drawDog(c, t, li, 'qq');

    // ---- 飛行中的球：沿著拋物線（留下訊號色的線），第一拍落地彈起來
    for (const Lg of this.legs) {
      const b = this.ballAt(Lg, t);
      if (!b) continue;
      const seg = (from: Pt, to: Pt, hgt: number, u: number, a0: number) => {
        const n = 20;
        for (let k = 1; k <= n; k++) {
          const p0 = arcAt(from, to, hgt, ((k - 1) / n) * u), p1 = arcAt(from, to, hgt, (k / n) * u);
          c.strokeStyle = rgba('signal', a0 * (0.15 + 0.8 * (k / n) ** 2));
          c.lineWidth = 1.5 + 2.5 * (k / n);
          c.beginPath(); c.moveTo(p0.x, p0.y); c.lineTo(p1.x, p1.y); c.stroke();
        }
      };
      c.save();
      c.lineCap = 'round';
      const h1 = Math.max(30, Lg.release.y - 440), h2 = Math.max(40, Lg.catchPt.y - 560);
      if (b.seg === 0) seg(Lg.release, Lg.bounceAt, h1, b.u, 1);
      else { seg(Lg.release, Lg.bounceAt, h1, 1, 0.45); seg(Lg.bounceAt, Lg.catchPt, h2, b.u, 1); }
      c.restore();
      tennisBall(c, b.x, b.y, 8, { ink, t });
    }
    // 球落地的那一拍：揚起一點灰（幾條短短的墨線往兩邊散開）
    for (const Lg of this.legs) {
      const k = 1 - clamp((t - Lg.bounce) / 0.3);
      if (k <= 0 || t < Lg.bounce) continue;
      c.save();
      c.strokeStyle = rgba('sepia', 0.5 * k);
      c.lineWidth = 1.6;
      c.lineCap = 'round';
      c.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI + (i / 5) * Math.PI, r0 = 10 + (1 - k) * 22, r1 = r0 + 10 * k;
        c.moveTo(Lg.bounceAt.x + Math.cos(a) * r0, Lg.bounceAt.y + Math.sin(a) * r0 * 0.6);
        c.lineTo(Lg.bounceAt.x + Math.cos(a) * r1, Lg.bounceAt.y + Math.sin(a) * r1 * 0.6);
      }
      c.stroke();
      c.restore();
    }
    // 咬到的那一刻：嘴邊一圈短線（訊號色）
    if (leg) {
      const k = 1 - clamp((t - leg.ctc) / 0.22);
      if (k > 0 && t >= leg.ctc) {
        c.save();
        c.strokeStyle = rgba('signal', k);
        c.lineWidth = 3;
        c.lineCap = 'round';
        c.beginPath();
        for (let i = 0; i < 7; i++) {
          const ang = (i / 7) * Math.PI * 2 - 0.4;
          const r0 = 24 + (1 - k) * 26, r1 = r0 + 14 * k;
          c.moveTo(leg.catchPt.x + Math.cos(ang) * r0, leg.catchPt.y + Math.sin(ang) * r0);
          c.lineTo(leg.catchPt.x + Math.cos(ang) * r1, leg.catchPt.y + Math.sin(ang) * r1);
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

  /**
   * 一個人：姿勢照時間軸；丟之前往後拉、出手往前送；拍手時每拍壓一下；狗咬到時歡呼跳一下；蹲著摸狗時跟著拍子點一下。
   * 宣文在左面向右，孟庭在右、圖翻過來面向左。
   */
  private drawPerson(c: CanvasRenderingContext2D, t: number, p: 0 | 1) {
    const x = XS[p], dir = p === 0 ? 1 : -1;
    const en = this.enter(t, p ? 0.14 : 0.05, x, p + 1);
    if (!en) return;
    const au = this.ctx.audio, bp = au.beatPeriod(t);
    let rot = 0, lift = 0, squash = breathe(t, 0.008, 3.2, p * 0.4);
    const name = pick(this.keys[p]!, t);
    if (name.endsWith('_clap')) squash += 0.035 * beatKick(au, t, 0.25);
    if (name.endsWith('_pet')) rot += dir * 0.02 * beatKick(au, t, 0.3);
    for (const L of this.legs) {
      if (L.from === p) {
        // 丟：出手前一拍往後拉、出手往前送
        if (t < L.rel) rot -= dir * 0.07 * prog(t, L.rel - bp, L.rel, ease.inOutCubic);
        else if (t < L.rel + bp * 2) rot += dir * 0.08 * Math.exp(-(t - L.rel) / (bp * 0.4));
      }
      // 狗咬到的那一拍：兩個人都歡呼跳一下（接的人跳高一點）
      if (t > L.ctc - 0.05 && t < L.ctc + bp * 1.4) {
        const j = jumpArc(t, L.ctc - 0.02, L.ctc + bp * 0.7, L.from === p ? 26 : 40, { crouch: 0.06, land: 0.1 });
        if (j.air || t > L.ctc) { lift = -j.y; squash += j.squash; }
      }
    }
    // throw_2 圖上的球一律蓋掉（出手後球由程式在飛）；throw_1 的球是手上拿著的，不蓋
    const o: PuppetOpts = { h: SZ, flip: p === 1, rot, pivot: 0.4, squash, spin: en.spin, alpha: en.alpha, hide: ['xw_throw_2:ball'] };
    puppetShadow(c, PEOPLE[p], x, GROUND, { h: SZ, lift, alpha: 0.3 * en.alpha, color: '70,45,25', wide: name.endsWith('_take') || name.endsWith('_pet') ? 1.5 : 1 });
    drawPick(c, this.keys[p]!, t, x, GROUND - lift, o);
  }

  /**
   * 一隻狗，一趟裡：在丟的人那邊等（拍點上興奮地壓一下）→ 出手後追（跑步兩張、半拍一張、一步一彈）→ 在拍點跳起來（接的那隻咬到、另一隻撲空）→
   * 跑到接的人前面（接的那隻叼著球）→ 面向人交球、被摸 → 快換對面丟時轉身準備追。
   */
  private drawDog(c: CanvasRenderingContext2D, t: number, li: number, d: Dog) {
    const legs = this.legs, L = legs[li];
    const first = legs[0];
    // 還沒開始：在第一個丟的人那邊等，面向要丟的方向
    const prevCatcher = (i: number) => (i <= 0 ? other(first?.catcher ?? 'qq') : legs[i - 1]!.catcher);
    const startSide = L ? L.from : (first?.from ?? 0);
    const dir = startSide === 0 ? 1 : -1;
    const startX = this.spots[startSide]![d][prevCatcher(Math.max(0, li)) === d ? 'near' : 'far'];
    const en = this.enter(t, d === 'qq' ? 0.24 : 0.32, startX, d === 'qq' ? 3 : 4);
    if (!en) return;
    const au = this.ctx.audio, bp = au.beatPeriod(t);
    const base: PuppetOpts = { h: SZ, scale: DOG_S, spin: en.spin, alpha: en.alpha };
    const shadow = (x: number, lift: number) => puppetShadow(c, d, x, GROUND, { h: SZ * DOG_S, lift, alpha: 0.32 * en.alpha, color: '70,45,25' });
    const idle = `${d}_stand`;
    const wait = (x: number, face: number, name: string, extra = 0) => {
      shadow(x, 0);
      drawPuppet(c, name, x, GROUND, { ...base, flip: face < 0, squash: 0.05 * beatKick(au, t, 0.25) + breathe(t, 0.015, 1.3, d === 'qq' ? 0 : 0.5) + extra });
    };
    if (!L || t < L.rel) { wait(startX, dir, d === 'pp' && !L ? 'pp_sit' : idle); return; }
    const isC = d === L.catcher;
    const endX = this.spots[1 - L.from]![d][isC ? 'near' : 'far'];
    const air = Math.min(0.5, bp * 1.1);
    const jx = CATCH[L.from] - (isC ? 0 : dir * 190);
    const takeoff = L.ctc - air / 2, land = L.ctc + air / 2;
    const go = L.rel + (isC ? 0.05 : 0.18);
    const arrive = L.rel + bp * 3.8;
    const runs = [`${d}_run_1`, `${d}_run_2`];
    // 追：出手後才起跑（沒接球的那隻晚一點點），越跑越快、快到的時候放慢，剛好在起跳點
    if (t < takeoff) {
      if (t < go) { wait(startX, dir, idle); return; }
      const x = lerp(startX, jx - dir * 65, sine(clamp((t - go) / (takeoff - go))));
      const b = hop(au.beatAt(t), 2) * 9;
      shadow(x, b);
      drawCycle(c, au, t, runs, 2, x, GROUND - b, { ...base, flip: dir < 0, rot: dir * 0.04 });
      return;
    }
    // 跳：最高點在拍點上、剛好在 jx、身體水平（接球點是照這個位置算的）；接的那隻咬到的那一刻打開圖上的球
    if (t < land + 0.12) {
      const j = jumpArc(t, takeoff, land, isC ? JUMP[d] : 48, { crouch: 0, land: 0.2 });
      const x = lerp(jx - dir * 65, jx + dir * 65, clamp((t - takeoff) / (land - takeoff)));
      shadow(x, -j.y);
      const hide = !isC || t < L.ctc ? ['ball'] : undefined;
      if (j.air) drawPuppet(c, `${d}_jump`, x, GROUND + j.y, { ...base, flip: dir < 0, hide, rot: dir * (-0.2 + 0.4 * j.u), pivot: 0.5, squash: j.squash });
      else drawPuppet(c, `${d}_run_1`, jx + dir * 65, GROUND, { ...base, flip: dir < 0, squash: landSquash(t, land, 0.2) });
      return;
    }
    // 跑到接的人前面（接的那隻叼著球）
    const back0 = land + 0.12;
    if (t < arrive) {
      const x0 = jx + dir * 65;
      const x = lerp(x0, endX, sine(clamp((t - back0) / Math.max(0.2, arrive - back0))));
      const face = endX >= x0 ? 1 : -1;
      const b = hop(au.beatAt(t), 2) * 7;
      shadow(x, b);
      const o: PuppetOpts = { ...base, flip: face < 0, rot: face * 0.03 };
      const name = drawCycle(c, au, t, runs, 2, x, GROUND - b, o);
      if (isC) { const m = puppetPoint(name, 'mouth', x, GROUND - b, o); if (m) tennisBall(c, m.x, m.y + 2, 8, { ink: inkFor(true), t }); }
      return;
    }
    // 到了：面向接的人。接的那隻叼著球等交球；交球後被摸（跟著拍子壓一下）；對面快丟時轉身
    const settle = landSquash(t, arrive, 0.12);
    if (isC && t < L.hand) { wait(endX, dir, `${d}_ball`, settle); return; }
    if (t < L.rel + bp * 6.5) { wait(endX, dir, idle, settle); return; }
    wait(endX, -dir, idle);
  }

  /** 木牌上的留言：第一拍起一個字一個字寫上去（手寫字、墨色），寫完署名淡入；在牌面上垂直置中。 */
  private drawNotice(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const S = this.sign;
    const t0 = Math.min(this.legs[0]?.rel ?? this.ctx.start + 0.8, this.ctx.start + 0.9);
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

