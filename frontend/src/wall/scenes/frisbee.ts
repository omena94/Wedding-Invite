// 飛盤（亮、sport）：午後的大草地，宣文與孟庭輪流丟飛盤，芃芃、QQ、元元三隻狗追，一隻飛身在拍點上咬住（慢動作一拍），叼回來交給下一個要丟的人。
// 角色是 Codex 畫的紙偶（_puppet.ts）。2026-09-29 新人：「宣文不要像阿呆一樣站著」——兩個人都一直有事做，而且輪流丟：
//  - 一輪兩小節：小節線上出手（throw_1 往後捲 → throw_2 丟出去）→ 飛盤飛三拍 → 第三拍狗跳到最高點咬住（拍點）→ 兩人一起跳起來歡呼 →
//    狗叼回來、第六拍半把飛盤交到沒丟的那個人手上（他／她單膝跪下來接，fetch_take）→ 第七拍站起來往後捲 → 下一個小節線換這個人丟。
//    孟庭先丟、兩人輪流；三隻狗輪流接（芃芃、元元、QQ，第二輪就輪到元元）；沒接到的兩隻跑到一半、一前一後停下來看。
//  - 元元（2026-09-30 新人加的第三隻：白色柴犬，最大隻、穩重愛笑）：等的時候正面坐著笑、每個小節線歪一次頭；
//    輪到牠接時跳得比兩隻博美低（牠本來就高，一伸脖子就咬到），別隻接到的那一刻牠仰頭叫一聲慶祝。三隻的大小照 dogs3 的比例。
//  - 沒丟的人在出手前後一直拍手叫狗（一拍拍一下、跟著彈一下）；狗跑回來、交飛盤的時候換丟的人拍手。
//  - 慢動作：咬到前後半拍，狗的跳躍用「頂點停久一點」的時間曲線（空中像停住），飛盤轉慢、四周拉出幾條速度線，鏡頭輕輕往前推一下。
//  - 飛盤是程式畫的（紙白的盤面、訊號色的邊，轉的時候盤面上一道反光跟著轉）：出手後沿拋物線飛（出手點是 throw_2 圖上的 hand 點），
//    咬到之後畫在狗嘴上（leap 圖上的 mouth 點），交到接的人手上（fetch_take 圖上的 hand 點）；往後捲的 throw_1 圖手上本來就畫著飛盤。
//  - 歌詞沿著飛盤飛的那條弧線上方，照跟唱規則逐字亮，比留言小一級（標準 v2：40～52）。
//  - **焦點是主打留言**：寫在右上「飛盤狗練習場」的牌子上——牌子本身就是一個巨大的飛盤（從底下看：一圈邊、盤底），立在一根柱子上，
//    深墨手寫字；照「留言尺寸與版面比例標準 v2」：字 40～60、牌子最大 720 × 430，高度跟著留言長短。沒有留言時寫邀請。
//  - 環境：遠處一棵樹在拍點被風推一下、雲慢慢飄、前景的草一撮一撮跟著風擺。鏡頭整個窗格慢慢推近牌子。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { lyricAt, barAfter, beatAfter, sparkHead, sparkParticles, msgChars } from './_motifs';
import { inkFor, paperBG, inkLine, inkPath, inkPoly, inkEllipse, lyricOnPath, drawNote, type Pt, type Note, type Ink } from './_couple';
import { loadPuppets, drawPuppet, drawCycle, drawPick, puppetPoint, puppetShadow, puppetIn, jumpArc, landSquash, breathe, beatKick, hop, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'sport', paper: true, energy: [0.3, 1], bars: [4, 8] };

const GROUND = 900;
const SZ = 400;
/**
 * 孟庭在左、宣文在右，三隻狗坐在兩人中間等（芃芃、QQ、元元一排）。孟庭丟的飛盤從宣文頭頂上飛過去。
 * 孟庭右手邊要空得出一隻狗的位置：狗叼給孟庭時停在那裡（她跪下伸手接），不能踩到坐著等的那一排。
 * 孟庭往後捲的時候飛盤在身體左後方，離畫面左緣要留一點。
 */
const MT_X = 200, XW_X = 900;
const X: Record<'mt' | 'xw', number> = { mt: MT_X, xw: XW_X };
/** 狗：三隻用同一個倍數（大小比例照 dogs3）、等的位置、咬到的位置（最高點的 x）、跳多高（元元比較高，跳低一點就咬得到）。 */
const DOG_S = 1.4;
const REST = { pp: 455, qq: 578, yy: 718 };
const CATCH_X = 1250;
const JUMP: Record<'pp' | 'qq' | 'yy', number> = { pp: 190, qq: 190, yy: 140 };
/** 飛身接飛盤的圖：兩隻博美有專門的一張；元元用跳起來接東西的那張（圖上畫的球蓋掉）。 */
const LEAP: Record<'pp' | 'qq' | 'yy', string> = { pp: 'pp_frisbee_leap', qq: 'qq_frisbee_leap', yy: 'yy_jump' };
/** 接的順序：第二輪就輪到元元（大部分窗格只有兩三輪）。 */
const FETCH = ['pp', 'yy', 'qq'] as const;
/** 飛盤狗練習場的牌子（巨大的飛盤、從底下看）：最大範圍（標準 v2）、寫字的內距（橢圓裡的矩形）。 */
const SIGN = { cx: 1450, top: 104, w: 720, h: 430 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const LABEL = '飛盤狗練習場';
const DISC_R = 34;
const SPRITES = [
  'mt_frisbee_throw_1', 'mt_frisbee_throw_2', 'mt_fetch_clap', 'mt_fetch_take', 'mt_idle_front', 'mt_cheer',
  'xw_frisbee_throw_1', 'xw_frisbee_throw_2', 'xw_fetch_clap', 'xw_fetch_take', 'xw_idle_front', 'xw_cheer',
  'pp_sit', 'pp_stand', 'pp_run_1', 'pp_run_2', 'pp_frisbee_leap',
  'qq_sit', 'qq_stand', 'qq_run_1', 'qq_run_2', 'qq_frisbee_leap',
  'yy_sit', 'yy_tilt', 'yy_stand', 'yy_run_1', 'yy_run_2', 'yy_jump', 'yy_howl',
];

type Dog = 'pp' | 'qq' | 'yy';
type Who = 'mt' | 'xw';
/**
 * 一輪（拍數從出手的小節線算）：rel 出手、ctc 咬到（+3）、back 狗回到接的人前面（+6）、drop 飛盤交到接的人手上（+6.5）、
 * up 接的人站起來往後捲（+7）、next 下一輪換他／她出手（+8）。thrower 丟、catcher 接（= 下一輪丟的人）、who 哪隻狗咬到。
 */
interface Round { rel: number; ctc: number; back: number; drop: number; up: number; next: number; who: Dog; thrower: Who; catcher: Who; peak: number }

/** 慢慢起跑、慢慢停下。 */
const sine = (u: number) => 0.5 - 0.5 * Math.cos(Math.PI * u);
/** 慢動作的時間曲線：中間（頂點）走得很慢，兩頭快；u、回傳都是 0..1。 */
const slowmo = (u: number, k = 0.75) => { const d = u - 0.5; return 0.5 + (1 - k) * d + k * 4 * d * d * d; };

export default class Frisbee extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(512, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  rounds: Round[] = [];
  keys: Record<Who, [number, string][]> = { mt: [], xw: [] };
  /** 拍手的時段（這段時間換成拍手的圖，一拍拍一下）。 */
  claps: Record<Who, [number, number][]> = { mt: [], xw: [] };
  /** 出手點（throw_2 圖上的手）、跪下來接飛盤的手（fetch_take 圖上的手）。 */
  release: Record<Who, Pt> = { mt: { x: 0, y: 0 }, xw: { x: 0, y: 0 } };
  hand: Record<Who, Pt> = { mt: { x: 0, y: 0 }, xw: { x: 0, y: 0 } };
  /** 叼回來的狗停在哪裡（嘴裡的飛盤剛好在接的人伸出來的手上）：[接的人][狗]。 */
  dropX: Record<Who, Record<Dog, number>> = { mt: { pp: 0, qq: 0, yy: 0 }, xw: { pp: 0, qq: 0, yy: 0 } };
  /** 咬到的地方：兩隻狗在最高點時嘴的位置。 */
  catchAt: Record<Dog, Pt> = { pp: { x: 0, y: 0 }, qq: { x: 0, y: 0 }, yy: { x: 0, y: 0 } };
  lyricPath: Pt[] = [];
  note: Note | null = null;
  sign = { x: SIGN.cx - SIGN.w / 2, y: SIGN.top, w: SIGN.w, h: SIGN.h };
  lyricSize = 52;

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('一位賓客' + INVITE + LABEL + 'DISC DOG FIELD');
    this.track(await loadPuppets(SPRITES));
    const bp0 = au.beatPeriod(this.ctx.start);
    for (const p of ['mt', 'xw'] as const) {
      this.release[p] = puppetPoint(`${p}_frisbee_throw_2`, 'hand', X[p], GROUND, { h: SZ }) ?? { x: X[p] + SZ * 0.34, y: GROUND - SZ * 0.72 };
      this.hand[p] = puppetPoint(`${p}_fetch_take`, 'hand', X[p], GROUND, { h: SZ }) ?? { x: X[p] + SZ * 0.22, y: GROUND - SZ * 0.27 };
    }
    for (const d of ['pp', 'qq', 'yy'] as const) {
      this.catchAt[d] = puppetPoint(LEAP[d], 'mouth', CATCH_X, GROUND - JUMP[d], { h: SZ, scale: DOG_S }) ?? { x: CATCH_X + 70, y: GROUND - JUMP[d] - 90 };
      // 叼回來的狗朝左站：嘴裡的飛盤（畫在嘴的左邊半個飛盤）剛好落在接的人伸出來的手上
      const m = puppetPoint(`${d}_stand`, 'mouth', 0, GROUND, { h: SZ, scale: DOG_S, flip: true });
      for (const p of ['mt', 'xw'] as const) this.dropX[p][d] = this.hand[p].x + DISC_R * 0.55 - (m ? m.x : -60);
    }
    // 一輪兩小節（見 Round）；窗格太短就下一拍出手。孟庭先丟、兩人輪流；狗一隻接兩輪（芃芃、QQ、QQ、芃芃…），每隻都接得到兩個人丟的
    let rel = barAfter(au, this.ctx.start + 0.8);
    if (this.ctx.end - rel < bp0 * 3.5) rel = beatAfter(au, this.ctx.start + 0.8);
    for (let k = 0; k < 16 && rel < this.ctx.end + 1; k++) {
      const b = Math.round(au.beatAt(rel));
      const T = (i: number) => au.timeOfBeat(b + i);
      const thrower: Who = k % 2 ? 'xw' : 'mt', catcher: Who = k % 2 ? 'mt' : 'xw';
      const who: Dog = FETCH[k % 3]!;
      const dx = Math.abs(this.catchAt[who].x - this.release[thrower].x);
      this.rounds.push({ rel, ctc: T(3), back: T(6), drop: T(6.5), up: T(7), next: T(8), who, thrower, catcher, peak: clamp(dx * 0.3, 110, 230) });
      rel = T(8);
    }
    // 丟的人：拿著飛盤往後捲 → 小節線丟出去 → 看 → 咬到的時候跳起來歡呼 → 狗跑回來時拍手叫牠
    // 接的人：出手前後拍手叫狗 → 咬到的時候跳起來歡呼 → 狗跑回來前單膝跪下、伸手接飛盤 → 站起來往後捲（下一輪換他／她丟）
    const K: Record<Who, [number, string][]> = { mt: [[-1e9, 'mt_frisbee_throw_1']], xw: [[-1e9, 'xw_idle_front']] };
    const C: Record<Who, [number, number][]> = { mt: [], xw: [] };
    this.rounds.forEach((r, i) => {
      const bp = au.beatPeriod(r.rel);
      const T = r.thrower, N = r.catcher;
      K[T].push([r.rel, `${T}_frisbee_throw_2`], [r.rel + bp * 1.2, `${T}_idle_front`]);
      for (const p of ['mt', 'xw'] as const) K[p].push([r.ctc, `${p}_cheer`], [r.ctc + bp * 1.4, `${p}_idle_front`]);
      K[N].push([r.back - bp * 0.6, `${N}_fetch_take`], [r.up, `${N}_frisbee_throw_1`]);
      C[N].push([i === 0 ? this.ctx.start + 0.5 : r.rel - bp * 0.6, r.ctc - 0.02]);
      C[T].push([r.ctc + bp * 1.5, r.drop]);
    });
    for (const p of ['mt', 'xw'] as const) this.keys[p] = K[p].sort((a, b) => a[0] - b[0]);
    this.claps = C;
    // 歌詞的弧線：從出手點往上、經過飛盤的最高點，延伸到牌子左邊（字頂離上緣 96 px 以上）
    const p0 = { x: 430, y: 360 }, p1 = { x: 1070, y: 300 };
    for (let i = 0; i <= 64; i++) {
      const u = i / 64;
      this.lyricPath.push({ x: lerp(p0.x, p1.x, u), y: lerp(p0.y, p1.y, u) - 4 * 70 * u * (1 - u) });
    }
    // 牌子上的留言：標準 v2 的字級；橢圓裡能寫字的是內圈（0.9 × 0.86）裡內接的矩形（寬 64%、高 58%，四個角剛好在內圈裡），
    // 牌子的大小跟著留言
    const c = this.fg.ctx;
    const w = SIGN.w * 0.64, hmax = SIGN.h * 0.58 - 20;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.6, { max: 44 });
    const tw = tightenNote(c, this.note, 300);
    const sw = Math.min(SIGN.w, Math.max(480, tw / 0.64));
    const sh = Math.min(SIGN.h, Math.max(290, (this.note.height + 20) / 0.58));
    this.sign = { x: SIGN.cx - sw / 2, y: SIGN.top, w: sw, h: sh };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.drawBackground();
  }

  /** 不會動的：遠處的地平線與樹林、草地的幾條線、牌子（巨大的飛盤、柱子）。畫一次。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx, ink = inkFor(true);
    L.clear();
    // 地平線（遠處的草地邊）與一排很淡的樹林
    inkLine(c, [{ x: 30, y: 560 }, { x: 1890, y: 556 }], { ink, w: 0.5, seed: 2, color: rgba('sepia', 0.35) });
    const crest: Pt[] = [];
    for (let x = 20; x <= 1900; x += 40) crest.push({ x, y: 556 - 34 - 26 * Math.abs(Math.sin(x * 0.011)) - 18 * Math.abs(Math.sin(x * 0.029 + 1)) });
    inkPath(c, crest, { ink, w: 0.45, seed: 3, color: rgba('sepia', 0.24) });
    c.save();
    c.beginPath(); c.moveTo(20, 556); for (const p of crest) c.lineTo(p.x, p.y); c.lineTo(1900, 556); c.closePath();
    c.fillStyle = rgba('sepia', 0.045); c.fill();
    c.restore();
    // 草地：往近處越來越明顯的幾條很淡的水平線（割草的痕跡）
    c.save();
    for (let k = 0; k < 7; k++) {
      const y = 580 + k * k * 9;
      c.strokeStyle = rgba('sepia', 0.03 + k * 0.008);
      c.lineWidth = 1 + k * 0.2;
      c.beginPath(); c.moveTo(40, y); c.bezierCurveTo(600, y + 6, 1300, y - 5, 1880, y + 3); c.stroke();
    }
    c.restore();
    inkLine(c, [{ x: 40, y: GROUND + 6 }, { x: 1880, y: GROUND + 2 }], { ink, w: 0.4, seed: 5, color: rgba('sepia', 0.18) });
    this.drawSign(c, ink);
    // 右下角（HUD）：地面的線在那裡淡掉
    c.save();
    c.globalCompositeOperation = 'destination-out';
    const g = c.createRadialGradient(1760, 1040, 50, 1760, 1040, 480);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(1200, 700, 720, 380);
    c.restore();
    L.upload();
  }

  /** 牌子：一根木柱子立在草地上，頂上是一個從底下看的巨大飛盤（外圈的邊、往內一圈的溝、盤底），往右下的影子；上緣一行小小的「飛盤狗練習場」。 */
  private drawSign(c: CanvasRenderingContext2D, ink: Ink) {
    const S = this.sign, cx = S.x + S.w / 2, cy = S.y + S.h / 2, rx = S.w / 2, ry = S.h / 2;
    const post = mixRgba('paper', 'fur', 0.32);
    inkPoly(c, [{ x: cx - 12, y: cy + ry - 10 }, { x: cx + 12, y: cy + ry - 10 }, { x: cx + 13, y: GROUND - 100 }, { x: cx - 13, y: GROUND - 100 }], { ink, fill: post, w: 0.7, seed: 11 });
    c.fillStyle = rgba('sepia', 0.1);
    c.beginPath(); c.ellipse(cx + 14, cy + 16, rx, ry, 0, 0, Math.PI * 2); c.fill();
    // 邊（訊號色的一圈）＋盤底（紙白、上亮下暗）
    inkEllipse(c, cx, cy, rx, ry, 0, { ink, fill: mixRgba('paper', 'signal', 0.3), w: 0.9, seed: 12 });
    const g = c.createLinearGradient(0, cy - ry, 0, cy + ry);
    g.addColorStop(0, mixRgba('bone', 'paper', 0.2)); g.addColorStop(1, mixRgba('paper', 'sepia', 0.06));
    c.fillStyle = g;
    c.beginPath(); c.ellipse(cx, cy, rx * 0.95, ry * 0.92, 0, 0, Math.PI * 2); c.fill();
    inkEllipse(c, cx, cy, rx * 0.95, ry * 0.92, 0, { ink, w: 0.5, seed: 13, color: rgba('sepia', 0.35) });
    inkEllipse(c, cx, cy, rx * 0.9, ry * 0.86, 0, { ink, w: 0.3, seed: 14, color: rgba('sepia', 0.14) });
    c.font = font(F.hei(500), 17);
    c.letterSpacing = '8px';
    c.fillStyle = rgba('sepia', 0.5);
    c.textAlign = 'center';
    c.fillText(LABEL, cx + 4, cy - ry * 0.92 + 36);
    c.letterSpacing = '0px';
    c.textAlign = 'left';
  }

  /** 遠處的樹冠（拍點上被風推一下）、雲、前景的草（一撮一撮跟著風擺）。 */
  private scenery(c: CanvasRenderingContext2D, t: number, ink: Ink) {
    const gust = beatKick(this.ctx.audio, t, 0.5);
    for (let k = 0; k < 3; k++) {
      const x = ((140 + k * 560 + t * (8 + k * 3)) % 1400) - 120, y = 150 + k * 52;
      if (x > this.sign.x - 280) continue;
      inkPath(c, [{ x, y }, { x: x + 70, y: y - 18 }, { x: x + 150, y: y - 8 }, { x: x + 210, y: y - 22 }, { x: x + 280, y }], { ink, w: 0.45, seed: 30 + k, color: rgba('sepia', 0.2), t });
    }
    const blobs: [number, number, number, number, number][] = [];
    for (const [x, k, sd] of [[110, 0.95, 1]] as const) {
      const base = 556, top = base - 230 * k;
      inkLine(c, [{ x, y: base }, { x: x + 2, y: top + 100 * k }], { ink, w: 0.6, seed: sd, color: rgba('sepia', 0.3) });
      for (const [dx, dy, r] of [[0, 40, 90], [-70, 90, 64], [70, 84, 70]] as const) {
        const s = gust * (1 - dy / 140) * 6 + Math.sin(t * 0.8 + sd + dx) * 1.5;
        blobs.push([x + (dx + s) * k, top + dy * k, r * k, r * 0.75 * k, sd * 10 + dx]);
      }
    }
    for (const [x, y, rx, ry, sd] of blobs) inkEllipse(c, x, y, rx, ry, 0, { ink, w: 0.5, seed: sd, color: rgba('sepia', 0.22), t });
    const union = (d: number) => { c.beginPath(); for (const [x, y, rx, ry] of blobs) { c.moveTo(x + rx - d, y); c.ellipse(x, y, rx - d, ry - d, 0, 0, Math.PI * 2); } };
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.fillStyle = '#000';
    union(2.5); c.fill();
    c.restore();
    union(0); c.fillStyle = rgba('sepia', 0.045); c.fill();
    // 前景的草：畫面最下面稀稀落落的幾撮（每撮三根、彎的；風：拍點上推一下＋慢慢擺）
    c.save();
    c.strokeStyle = rgba('sepia', 0.26);
    c.lineWidth = 1.5;
    c.lineCap = 'round';
    c.beginPath();
    for (let i = 0; i < 16; i++) {
      const x0 = 40 + i * 84 + hash(i, 1) * 50;
      if (x0 > 1300) break;
      if (hash(i, 9) < 0.35) continue;
      const y = 1082 - 6 * hash(i, 2);
      for (let j = 0; j < 3; j++) {
        const x = x0 + (j - 1) * 7, h = (18 + 26 * hash(i, 3 + j)) * (j === 1 ? 1.3 : 1);
        const bend = ((Math.sin(t * 1.3 + i * 0.4) * 0.5 + gust) * 8 + (j - 1) * 6) * (0.6 + 0.4 * hash(i, 7));
        c.moveTo(x, y); c.quadraticCurveTo(x + bend * 0.2, y - h * 0.6, x + bend, y - h);
      }
    }
    c.stroke();
    c.restore();
  }

  /** 這一格屬於哪一輪（出手那一刻換下一輪：上一輪交飛盤、拋飛盤都在下一次出手之前）。 */
  private roundAt(t: number): Round | null {
    let cur: Round | null = null;
    for (const r of this.rounds) if (r.rel <= t) cur = r;
    return cur;
  }

  /** 狗跳躍的時間（起跳、落地）：頂點在咬到的拍點上。 */
  private leapOf(r: Round) {
    const bp = this.ctx.audio.beatPeriod(r.ctc);
    const air = Math.min(0.9, bp * 1.15);
    return { t0: r.ctc - air / 2, t1: r.ctc + air / 2 };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.paper.render(renderer, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const ink = inkFor(true);
    const rv = prog(t, s, s + 0.6, ease.inOutCubic);
    const r = this.roundAt(t);

    comp.draw(renderer, this.bg.texture, out);
    this.scenery(c, t, ink);

    // 歌詞沿著飛盤的弧線
    const ly = lyricAt(lyrics, t);
    if (ly) lyricOnPath(c, ly.line, t, this.lyricPath, { family: F.archivo(100, this.msg ? 600 : 700), size: this.lyricSize, minSize: 40, offset: 16, alpha: ly.k * rv, unsung: rgba('sepia', 0.24), sung: rgba('sepia', this.msg ? 0.8 : 0.94), active: rgba('signal') });

    this.drawPeople(c, t, r);
    const held = this.drawDogs(c, t, r);
    this.drawDisc(c, t, r, held);
    this.drawSignText(c, t);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：慢慢推近牌子；咬到的那一拍往前推一下（慢動作）
    const push = ease.inOutCubic(f.p);
    let slow = 0;
    if (r) { const lp = this.leapOf(r); slow = Math.sin(Math.PI * clamp((t - lp.t0) / (lp.t1 - lp.t0))); }
    const S = this.sign;
    return {
      paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.22 + 0.08 * slow, grain: 0.045, ca: 0.4,
      zoom: 1 + 0.026 * push + 0.012 * slow, shake: [-(S.x + S.w / 2 - W / 2) * 0.026 * push, -(S.y + S.h / 2 - H / 2) * 0.026 * push],
    };
  }

  /** 進場：從側面翻正（火花在腳邊）。 */
  private enter(t: number, delay: number, x: number, seed: number) {
    const e = puppetIn(t, this.ctx.start + delay, 0.42);
    if (e.alpha <= 0) return null;
    if (e.k < 1) {
      sparkHead(this.glow, x, GROUND - 6, t, 0.7);
      sparkParticles(this.glow, t, () => ({ x, y: GROUND - 6 }), { rate: 50, life: 0.25, speed: 140, seed });
    }
    return e;
  }

  /**
   * 兩個人：丟的人出手前一拍往後捲、出手往前送；拍手的時段一拍拍一下（拍點上壓一下、彈一下）；咬到的那一刻兩人一起跳起來歡呼；
   * 接的人跪下接飛盤、第七拍站起來往後捲。
   */
  private drawPeople(c: CanvasRenderingContext2D, t: number, r: Round | null) {
    const au = this.ctx.audio, bp = au.beatPeriod(t);
    for (const p of ['mt', 'xw'] as const) {
      const x = X[p];
      const e = this.enter(t, p === 'xw' ? 0.05 : 0.14, x, p === 'xw' ? 1 : 2);
      if (!e) continue;
      let rot = 0, lift = 0, squash = breathe(t, 0.009, p === 'xw' ? 3.1 : 2.9, p === 'xw' ? 0 : 0.3) + 0.012 * beatKick(au, t, 0.3);
      for (const k of this.rounds) {
        if (k.thrower !== p) continue;
        if (t < k.rel) rot -= 0.06 * prog(t, k.rel - bp, k.rel, ease.inOutCubic);
        else if (t < k.rel + bp * 2) rot += 0.08 * Math.exp(-(t - k.rel) / (bp * 0.4));
      }
      if (r) {
        const j = jumpArc(t, r.ctc - 0.03, r.ctc + bp * 0.8, p === 'xw' ? 40 : 44, { crouch: 0.08, land: 0.12 });
        if (j.air || (t > r.ctc && t < r.ctc + bp * 1.4)) { lift = -j.y; squash = j.squash || squash; }
      }
      const clapping = this.claps[p].some(([a, b]) => t >= a && t < b);
      if (clapping) {
        // 拍手：只有一張圖（兩手合起來），拍點上身體往前一壓、腳跟一彈，半拍之間手臂張開（用傾斜與拉長帶過）
        const k = beatKick(au, t, 0.16);
        lift += 7 * k; squash += 0.035 * k - 0.015 * (1 - k); rot += 0.035 * k;
      }
      puppetShadow(c, p, x + 20, GROUND + 3, { h: SZ, lift, alpha: 0.28 * e.alpha, wide: 1.3, color: '70,45,25' });
      const o: PuppetOpts = { h: SZ, rot, pivot: 0.4, squash, spin: e.spin, alpha: e.alpha };
      if (clapping) drawPuppet(c, `${p}_fetch_clap`, x, GROUND - lift, o);
      else drawPick(c, this.keys[p], t, x, GROUND - lift, o);
    }
  }

  /**
   * 三隻狗：等（坐著、拍點上興奮地壓一下；元元每個小節線歪一次頭）→ 出手後追 → 接的那隻在拍點飛身咬住（慢動作），
   * 另外兩隻跑到一半、一前一後停下來看（元元在別隻咬到的那一刻仰頭叫一聲）→
   * 轉身跑回來（叼著飛盤）→ 交到接的人手上 → 跑回等的位置坐好。回傳叼著的飛盤要畫在哪（嘴的位置、朝向），沒叼著回傳 null。
   */
  private drawDogs(c: CanvasRenderingContext2D, t: number, r: Round | null): { x: number; y: number; flip: boolean } | null {
    const au = this.ctx.audio, bp = au.beatPeriod(t);
    let held: { x: number; y: number; flip: boolean } | null = null;
    // 先畫後面（元元最大隻，放在最後面、最先畫），前面的博美疊在上面
    for (const d of ['yy', 'qq', 'pp'] as const) {
      const delay = { pp: 0.24, qq: 0.32, yy: 0.4 }[d];
      const en = this.enter(t, delay, REST[d], { pp: 3, qq: 4, yy: 5 }[d]);
      if (!en) continue;
      const base: PuppetOpts = { h: SZ, scale: DOG_S, spin: en.spin, alpha: en.alpha };
      const shadow = (x: number, lift: number) => puppetShadow(c, d, x + 10, GROUND + 3, { h: SZ * DOG_S, lift, alpha: 0.3 * en.alpha, color: '70,45,25' });
      const sitName = d === 'yy' && Math.floor(au.beatAt(t) / 4) % 2 === 1 ? 'yy_tilt' : `${d}_sit`;
      const sit = () => { shadow(REST[d], 0); drawPuppet(c, sitName, REST[d], GROUND, { ...base, squash: 0.05 * beatKick(au, t, 0.25) + breathe(t, 0.014, 1.3, { pp: 0, qq: 0.5, yy: 0.25 }[d]) }); };
      const go = r ? r.rel + delay - 0.2 : 0;
      if (!r || t < go) { sit(); continue; }
      const runs = [`${d}_run_1`, `${d}_run_2`];
      const catcher = r.who === d;
      const lp = this.leapOf(r);
      // 沒接的兩隻：一前一後停下來看（在後面出發的停得比較前面，不會疊在一起）
      const others = (['pp', 'qq', 'yy'] as const).filter((q) => q !== r.who);
      const jx = catcher ? CATCH_X : CATCH_X - 200 - 170 * others.indexOf(d as never);
      const dropX = this.dropX[r.catcher][d];
      const back0 = lp.t1 + 0.1, back1 = r.back;
      if (t < lp.t0) {
        // 追：起跑、越跑越快、快到起跳點放慢
        const x = lerp(REST[d], jx - 80, sine(clamp((t - go) / (lp.t0 - go))));
        const b = hop(au.beatAt(t), 2) * 9;
        shadow(x, b);
        drawCycle(c, au, t, runs, 2, x, GROUND - b, { ...base, rot: 0.04 });
        continue;
      }
      if (t < back0) {
        if (catcher) {
          // 飛身：時間曲線在頂點走得很慢（慢動作一拍），頂點剛好在咬到的拍點、身體在 CATCH_X
          const u = clamp((t - lp.t0) / (lp.t1 - lp.t0));
          const te = lp.t0 + slowmo(u) * (lp.t1 - lp.t0);
          const j = jumpArc(te, lp.t0, lp.t1, JUMP[d], { crouch: 0, land: 0.2 });
          const x = lerp(jx - 80, jx + 80, slowmo(u));
          shadow(x, -j.y);
          if (j.air) {
            const o: PuppetOpts = { ...base, rot: -0.22 + 0.44 * slowmo(u), pivot: 0.5, squash: j.squash, hide: d === 'yy' ? ['ball'] : undefined };
            drawPuppet(c, LEAP[d], x, GROUND + j.y, o);
            if (t >= r.ctc) { const m = puppetPoint(LEAP[d], 'mouth', x, GROUND + j.y, o); if (m) held = { x: m.x, y: m.y, flip: false }; }
            // 慢動作的速度線（身體後面幾條細線）
            const k = Math.sin(Math.PI * u);
            c.save();
            c.strokeStyle = rgba('sepia', 0.35 * k);
            c.lineWidth = 1.5;
            c.beginPath();
            for (let i = 0; i < 5; i++) { const yy = GROUND + j.y - 30 - i * 22; c.moveTo(x - 90 - i * 14, yy); c.lineTo(x - 190 - i * 20, yy + 8); }
            c.stroke();
            c.restore();
          } else {
            drawPuppet(c, `${d}_stand`, jx + 80, GROUND, { ...base, squash: landSquash(t, lp.t1, 0.2) });
            const m = puppetPoint(`${d}_stand`, 'mouth', jx + 80, GROUND, base);
            if (m) held = { x: m.x, y: m.y, flip: false };
          }
        } else {
          // 沒接到的：停下來、抬頭看；元元在別隻咬到的那一刻仰頭叫一聲（慶祝），叫完再站好
          shadow(jx - 80, 0);
          const howl = d === 'yy' && t >= r.ctc && t < r.ctc + bp * 0.9;
          drawPuppet(c, howl ? 'yy_howl' : `${d}_stand`, jx - 80, GROUND, { ...base, squash: landSquash(t, lp.t0, 0.1) + 0.03 * beatKick(au, t, 0.25) + (howl ? -0.04 * Math.sin(Math.PI * clamp((t - r.ctc) / (bp * 0.9))) : 0) });
        }
        continue;
      }
      if (t < back1) {
        // 跑回來（朝左）；接到的那隻叼著飛盤
        const from = catcher ? jx + 80 : jx - 80;
        const to = catcher ? dropX : REST[d];
        const x = lerp(from, to, sine(clamp((t - back0) / (back1 - back0))));
        const b = hop(au.beatAt(t), 2) * 9;
        shadow(x, b);
        const o: PuppetOpts = { ...base, flip: true, rot: -0.04 };
        const name = drawCycle(c, au, t, runs, 2, x, GROUND - b, o);
        if (catcher) { const m = puppetPoint(name, 'mouth', x, GROUND - b, o); if (m) held = { x: m.x, y: m.y, flip: true }; }
        continue;
      }
      // 到了：接到的那隻站在接的人前面，第六拍半把飛盤交到他／她手上，再跑回去坐好（在下一次出手之前）
      if (catcher && t < r.drop + bp * 0.4) {
        shadow(dropX, 0);
        const o: PuppetOpts = { ...base, flip: true, squash: landSquash(t, back1, 0.12) + 0.03 * beatKick(au, t, 0.25) };
        drawPuppet(c, `${d}_stand`, dropX, GROUND, o);
        if (t < r.drop) { const m = puppetPoint(`${d}_stand`, 'mouth', dropX, GROUND, o); if (m) held = { x: m.x, y: m.y, flip: true }; }
        continue;
      }
      if (catcher && t < r.next - bp * 0.2) {
        const t0 = r.drop + bp * 0.4, t1 = r.next - bp * 0.2;
        const x = lerp(dropX, REST[d], sine(clamp((t - t0) / (t1 - t0))));
        const b = hop(au.beatAt(t), 2) * 9;
        shadow(x, b);
        // 交給孟庭的那隻要往右跑回去（坐的位置在她右邊）
        drawCycle(c, au, t, runs, 2, x, GROUND - b, { ...base, flip: REST[d] < dropX, rot: REST[d] < dropX ? -0.04 : 0.04 });
        continue;
      }
      sit();
    }
    return held;
  }

  /**
   * 飛盤：飛行中（出手 → 咬到）沿著拋物線、邊轉邊傾斜；叼著時畫在嘴上；交到接的人手上。
   * 往後捲的 throw_1 圖手上本來就畫著飛盤，那時候不畫。
   */
  private drawDisc(c: CanvasRenderingContext2D, t: number, r: Round | null, held: { x: number; y: number; flip: boolean } | null) {
    const draw = (x: number, y: number, ang: number, tilt: number, spin: number) => {
      c.save();
      c.translate(x, y);
      c.rotate(ang);
      c.scale(1, Math.max(0.12, tilt));
      c.fillStyle = rgba('sepia', 0.9);
      c.beginPath(); c.arc(0, 0, DISC_R, 0, Math.PI * 2); c.fill();
      c.fillStyle = mixRgba('paper', 'signal', 0.6);
      c.beginPath(); c.arc(0, 0, DISC_R - 1.5, 0, Math.PI * 2); c.fill();
      c.fillStyle = rgba('bone');
      c.beginPath(); c.arc(0, 0, DISC_R * 0.8, 0, Math.PI * 2); c.fill();
      // 轉的時候盤面上一道反光
      c.strokeStyle = rgba('signal', 0.8);
      c.lineWidth = 3 / Math.max(0.2, tilt);
      c.beginPath(); c.arc(0, 0, DISC_R * 0.6, spin, spin + 1.1); c.stroke();
      c.restore();
    };
    if (!r) return;
    const arc = (a: Pt, b: Pt, peak: number, u: number) => ({ x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) - 4 * peak * u * (1 - u) });
    if (t >= r.rel && t < r.ctc) {
      // 飛：出去快、到頂慢慢飄（ease）；終點就是狗在最高點時嘴的位置
      const u = ease.outCubic(clamp((t - r.rel) / (r.ctc - r.rel)) ** 0.9);
      const lp = this.leapOf(r);
      const slow = t > lp.t0 ? Math.sin(Math.PI * clamp((t - lp.t0) / (lp.t1 - lp.t0))) : 0;
      const end = this.catchAt[r.who], from = this.release[r.thrower];
      const p = arc(from, end, r.peak, u);
      // 飛過的路（訊號色的細線，越靠近飛盤越濃）
      c.save();
      c.lineCap = 'round';
      const n = 24;
      for (let k = 1; k <= n; k++) {
        const pa = arc(from, end, r.peak, ((k - 1) / n) * u), pb = arc(from, end, r.peak, (k / n) * u);
        c.strokeStyle = rgba('signal', 0.1 + 0.6 * (k / n) ** 2);
        c.lineWidth = 1 + 2 * (k / n);
        c.beginPath(); c.moveTo(pa.x, pa.y); c.lineTo(pb.x, pb.y); c.stroke();
      }
      c.restore();
      draw(p.x, p.y, -0.18 + 0.3 * u, 0.28 + 0.1 * Math.sin(u * 3), t * (18 - 12 * slow));
      // 地上的影子
      c.fillStyle = rgba('sepia', 0.12);
      c.beginPath(); c.ellipse(p.x + 20, GROUND + 4, DISC_R * 0.9, DISC_R * 0.18, 0, 0, Math.PI * 2); c.fill();
      return;
    }
    if (held) {
      draw(held.x + (held.flip ? -DISC_R * 0.55 : DISC_R * 0.55), held.y + 4, held.flip ? 0.25 : -0.25, 0.3, 0);
      // 咬到的那一刻：嘴邊一圈短線
      const k = 1 - clamp((t - r.ctc) / 0.25);
      if (k > 0 && t >= r.ctc) {
        c.save();
        c.strokeStyle = rgba('signal', k);
        c.lineWidth = 3; c.lineCap = 'round';
        c.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2, r0 = 40 + (1 - k) * 30, r1 = r0 + 16 * k;
          c.moveTo(held.x + Math.cos(a) * r0, held.y + Math.sin(a) * r0); c.lineTo(held.x + Math.cos(a) * r1, held.y + Math.sin(a) * r1);
        }
        c.stroke();
        c.restore();
      }
      return;
    }
    // 在接的人手上：交到手上之後、站起來往後捲之前
    if (t >= r.drop && t < r.up) { const h = this.hand[r.catcher]; draw(h.x, h.y - 2, 0.2, 0.3, 0); }
  }

  /** 牌子上的主打留言：第一次出手起一個字一個字寫上去（深墨手寫字），寫完署名淡入；在橢圓的中間垂直置中。 */
  private drawSignText(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const S = this.sign;
    const t0 = this.ctx.start + 0.45;
    const total = msgChars(n.fit);
    const per = clamp(1.5 / Math.max(1, total), 0.025, 0.09);
    const done = t0 + total * per;
    const x = S.x + (S.w - n.width) / 2, y = S.y + S.h / 2 - n.height / 2 + 10;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.6);
    drawNote(c, n, x, y, { chars: this.msg ? (t - t0) / per : Infinity, color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.62), sigColor: rgba('sepia', 0.74), sigK: prog(t, done + 0.1, done + 0.5) });
    c.restore();
  }
}
