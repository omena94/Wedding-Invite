// 丟捧花（亮、wedding、婚禮服）：午後的草地婚禮。孟庭背對大家（面向左邊），預備一小節，在小節線上把捧花往後甩過頭頂，
// 捧花沿著一道高高的弧線飛過畫面，三隻狗搶：QQ 早一拍跳、撲空；元元（白色柴犬，最高）下一拍跳起來用鼻子一頂，捧花彈高一點；
// 再下一拍芃芃跳起來一口咬住，叼著捧花得意地坐好，孟庭回頭大笑。
// 角色是 Codex 畫的紙偶（mt_bouquet_*、pp_bouquet，跳起來借 pp_jump／qq_jump／yy_jump）。三隻狗同一個場景尺度（大小照 dogs3-lineup.png）。
//  - 預備：孟庭抱著捧花跟著拍子「一、二、三」往下盪（每拍壓一下），小節線前一拍往下蹲最低 → **小節線上甩出去**（throw，
//    捧花從圖上她頭後面的位置接手給程式飛）→ 第 1 拍 QQ 跳、撲空 → 第 2 拍元元跳到最高、鼻子頂到捧花（一小圈火花），捧花往右彈一道小弧線
//    → 第 3 拍芃芃起跳、最高點剛好咬到。下一個小節線孟庭回頭（turn）、芃芃換成叼著捧花坐好（pp_bouquet），每拍搖一下；
//    QQ 在旁邊繞著跳，元元正面坐好張嘴笑（穩重，只跟著拍子搖尾巴一樣地晃）。
//  - **焦點是主打留言**：寫在左邊草地上的木框迎賓板（白底、左上角一束手繪的花），深墨手寫字、署名；
//    照「留言尺寸與版面比例標準 v2」：字 40～60、板子最大 500 × 420，高度跟著留言。沒有留言時板子寫邀請、字淡，歌詞變主角。
//  - 歌詞在草地前面（下三分之一，比留言小一級 40～52），照跟唱規則逐字亮。孟庭身後一座花拱門。
//  - 次要動作：花瓣慢慢飄、草在風裡晃（每小節一陣風）、遠處的樹叢、捧花飛過留一道很淡的訊號色細線。鏡頭：整個窗格慢慢往右帶一點、推近。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, barAfter, msgChars } from './_motifs';
import { inkFor, inkLine, inkPath, inkShape, inkPoly, inkEllipse, heartPop, arcAt, drawNote, paperBG, type Pt, type Ink, type Note } from './_couple';
import { loadPuppets, drawPick, drawPuppet, puppetPoint, puppetBox, puppetShadow, puppetIn, jumpArc, breathe, beatKick, hop, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'couple', family: 'wedding', paper: true, energy: [0.35, 1], bars: [4, 8] };

const FLOOR = 890;
const SZ = 440;
/** 孟庭（翻過來面向左、背對右邊的「賓客」）、芃芃與 QQ（翻過來面向左，看著飛過來的捧花）。 */
const OM_X = 870, PP_X = 1272, QQ_X = 1025, YY_X = 1140;
/** 元元站在另外兩隻後面一點（地面往上 18 px），三隻擠在一起搶但看得出是三隻。 */
const YY_BACK = 18;
const DOG_S = 1.1;
/** 芃芃、QQ 跳多高。 */
const PJUMP = 150, QJUMP = 90, YJUMP = 118;
/** 元元頂完之後，捧花彈到芃芃嘴邊的小弧線有多高（px）。 */
const BOUNCE_UP = 110;
/** 迎賓板：最大的範圍（標準 v2）、寫字的內距；底邊固定在畫架上。 */
const BOARD = { x: 120, bottom: 660, w: 500, h: 420 };
const PAD = { x: 36, top: 56, bottom: 30 };
/** 捧花飛的弧線：頂點比出手點高多少。 */
const ARC_UP = 300;
/** 歌詞：草地前面，最後一排的基線。 */
const LYR = { x: 150, base: 990, w: 1120 };
/** 出手那一格孟庭的樣子（往後仰、整張往上一送之前）：捧花的起點照這個姿勢算，跟 drawOmena 在出手那一刻的參數一樣。 */
const THROW_O: PuppetOpts = { h: SZ, flip: true, rot: -0.08, pivot: 0.3, squash: -0.06 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const P = {
  ready: 'mt_bouquet_ready', throw: 'mt_bouquet_throw', turn: 'mt_bouquet_turn', ppHold: 'pp_bouquet', ppJump: 'pp_jump', ppStand: 'pp_stand',
  qqJump: 'qq_jump', qqStand: 'qq_stand', yyStand: 'yy_stand', yyJump: 'yy_jump', yySit: 'yy_sit',
} as const;

export default class Bouquet extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(512, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  board = { x: BOARD.x, y: BOARD.bottom - BOARD.h, w: BOARD.w, h: BOARD.h };
  /** 出手、咬到、回頭的時間；QQ 撲空的時間。 */
  tThrow = 0; tCatch = 0; tTurn = 0; tMiss = 0; tHead = 0;
  keys: [number, string][] = [];
  /** throw 那張圖上捧花與緞帶的位置（出手那一格的姿勢）：飛出去的就是這一束。 */
  from: Pt & { r?: number } = { x: 0, y: 0 };
  ribbon: Pt & { r: number } = { x: 0, y: 0, r: 0 };
  /** 元元跳到最高時鼻子的位置（頂到捧花的那一點）、芃芃跳到最高時嘴的位置（咬到的那一點）。 */
  head: Pt = { x: 0, y: 0 };
  to: Pt = { x: 0, y: 0 };
  lyricSize = 52;
  msgT0 = 0;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start;
    await loadText('一位賓客' + INVITE + 'Bouquet Toss');
    this.track(await loadPuppets(Object.values(P)));
    // ---- 時間點：預備一小節 → 小節線出手 → 兩拍後咬到（QQ 早一拍撲空）→ 下一個小節線回頭
    const bp = au.beatPeriod(s);
    // 窗格長（≥ 8 小節）時多預備一小節：留言先寫完、大家看清楚板子，捧花才飛
    const b0 = Math.round(au.barAt(s));
    const nb = (this.ctx.end - s) / Math.max(0.3, au.timeOfBar(b0 + 1) - au.timeOfBar(b0));
    this.tThrow = barAfter(au, s + Math.max(1.2, bp * 3), nb >= 8 ? 1 : 0);
    const tb = Math.round(au.beatAt(this.tThrow));
    this.tMiss = au.timeOfBeat(tb + 1);
    this.tHead = au.timeOfBeat(tb + 2);
    this.tCatch = au.timeOfBeat(tb + 3);
    this.tTurn = au.timeOfBar(Math.round(au.barAt(this.tThrow)) + 1);
    this.keys = [[-1e9, P.ready], [this.tThrow, P.throw], [this.tTurn, P.turn]];
    // ---- 捧花飛的路線：throw 那張圖上捧花的位置 → 元元跳到最高時的鼻子 → 芃芃跳到最高時的嘴
    this.from = this.pointOr(P.throw, 'bouquet', OM_X, FLOOR, THROW_O, 0.75, 0.05);
    this.ribbon = puppetPoint(P.throw, 'ribbon', OM_X, FLOOR, THROW_O) ?? { ...this.from, r: 0 };
    const m = puppetPoint(P.ppJump, 'mouth', PP_X, FLOOR - PJUMP, { h: SZ, scale: DOG_S, flip: true });
    this.to = m ?? { x: PP_X - 90, y: FLOOR - PJUMP - 60 };
    const nose = puppetPoint(P.yyJump, 'mouth', YY_X, FLOOR - YY_BACK - YJUMP, { h: SZ, scale: DOG_S, flip: true });
    this.head = nose ? { x: nose.x - 6, y: nose.y - 14 } : { x: YY_X - 90, y: FLOOR - 300 };
    // ---- 迎賓板：標準 v2 的字級，板子的寬高跟著留言
    const c = this.fg.ctx;
    const w = BOARD.w - PAD.x * 2, hmax = BOARD.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const bw = Math.min(BOARD.w, tightenNote(c, this.note, 300) + PAD.x * 2);
    const bh = Math.min(BOARD.h, Math.max(240, PAD.top + this.note.height + PAD.bottom + 16));
    this.board = { x: BOARD.x + (BOARD.w - bw) / 2, y: BOARD.bottom - bh, w: bw, h: bh };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.msgT0 = Math.min(au.timeOfBeat(Math.ceil(au.beatAt(s + 0.3))), s + 0.9);
    this.drawBackground();
  }

  /** 圖上的道具點（sprites.json 量的）；沒有就用外框的比例估一個。 */
  private pointOr(name: string, key: string, x: number, y: number, o: PuppetOpts, fx: number, fy: number): Pt {
    const p = puppetPoint(name, key, x, y, o);
    if (p) return p;
    const [bx, by, bw, bh] = puppetBox(name, x, y, o);
    return { x: bx + bw * fx, y: by + bh * fy };
  }

  /** 不會動的：遠處的樹叢、草地的線、迎賓板與畫架、弧線的虛線（畫一次）。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx, ink = inkFor(true);
    L.clear();
    // 遠處的樹叢：一條起伏的輪廓線，底下淡淡的排線
    const hedge: Pt[] = [];
    for (let x = 0; x <= W; x += 24) hedge.push({ x, y: 560 - 40 * Math.sin(x / 210) - 26 * Math.sin(x / 67 + 1) - 18 * hash(Math.floor(x / 24), 3) });
    inkPath(c, hedge, { ink, w: 0.6, seed: 2, color: rgba('sepia', 0.45) });
    c.fillStyle = mixRgba('paper', 'gingham', 0.14);
    c.beginPath(); c.moveTo(0, FLOOR - 120); for (const p of hedge) c.lineTo(p.x, p.y + 3); c.lineTo(W, FLOOR - 120); c.closePath(); c.fill();
    // 草地：地平線、幾道往前越來越寬的草叢線
    c.fillStyle = mixRgba('paper', 'gingham', 0.1);
    c.fillRect(0, FLOOR - 120, W, H - FLOOR + 120);
    inkLine(c, [{ x: 0, y: FLOOR - 120 }, { x: W, y: FLOOR - 118 }], { ink, w: 0.5, seed: 4, color: rgba('sepia', 0.4) });
    // 迎賓板：畫架的三隻腳、木框、白底、左上角一束花、上面一行小小的 Bouquet Toss
    const B = this.board, wood = mixRgba('fur', 'sepia', 0.45);
    for (const [x0, x1, sd] of [[B.x + 60, B.x + 20, 5], [B.x + B.w - 60, B.x + B.w - 20, 6]] as const) {
      inkPoly(c, [{ x: x0 - 6, y: B.y - 24 }, { x: x0 + 6, y: B.y - 24 }, { x: x1 + 7, y: FLOOR - 70 }, { x: x1 - 7, y: FLOOR - 70 }], { ink, fill: wood, w: 0.7, seed: sd });
    }
    inkLine(c, [{ x: B.x + B.w / 2, y: B.y + 30 }, { x: B.x + B.w / 2 + 90, y: FLOOR - 90 }], { ink, w: 0.7, seed: 7 });
    inkPoly(c, [{ x: B.x - 22, y: B.y + B.h + 2 }, { x: B.x + B.w + 22, y: B.y + B.h + 2 }, { x: B.x + B.w + 18, y: B.y + B.h + 18 }, { x: B.x - 18, y: B.y + B.h + 18 }], { ink, fill: wood, w: 0.8, seed: 8 });
    c.fillStyle = rgba('sepia', 0.1);
    c.fillRect(B.x + 10, B.y + 12, B.w, B.h);
    inkPoly(c, [{ x: B.x - 12, y: B.y - 12 }, { x: B.x + B.w + 12, y: B.y - 11 }, { x: B.x + B.w + 11, y: B.y + B.h + 12 }, { x: B.x - 11, y: B.y + B.h + 11 }], { ink, fill: wood, w: 0.9, seed: 9 });
    inkPoly(c, [{ x: B.x, y: B.y }, { x: B.x + B.w, y: B.y + 1 }, { x: B.x + B.w - 1, y: B.y + B.h }, { x: B.x + 1, y: B.y + B.h - 1 }], { ink, fill: rgba('bone'), w: 0.6, seed: 10 });
    this.spray(c, ink, B.x - 6, B.y - 4);
    c.font = font(F.serif(500, true), 22);
    c.fillStyle = rgba('sepia', 0.5);
    c.textAlign = 'right';
    c.fillText('Bouquet Toss', B.x + B.w - PAD.x + 6, B.y + 36);
    c.textAlign = 'left';
    // 花拱門：孟庭身後，兩根細柱、上面一道圓拱，拱上一叢一叢的圓玫瑰與葉子
    const AR = 195, ax0 = OM_X - AR, ax1 = OM_X + AR, atop = 330, ay = FLOOR - 50;
    for (const x of [ax0, ax1]) inkLine(c, [{ x, y: ay + 4 }, { x, y: atop + AR }], { ink, w: 0.8, seed: x });
    const archPts: Pt[] = [];
    for (let i = 0; i <= 40; i++) { const a2 = Math.PI + (i / 40) * Math.PI; archPts.push({ x: OM_X + Math.cos(a2) * AR, y: atop + AR + Math.sin(a2) * AR }); }
    inkPath(c, archPts, { ink, w: 0.8, seed: 17 });
    for (let i = 0; i <= 40; i += 2) {
      const p2 = archPts[i]!, big = i % 8 === 0;
      if (i % 4 === 0) {
        const lx = p2.x + (hash(i, 1) - 0.5) * 30, ly = p2.y + (hash(i, 2) - 0.5) * 24;
        inkShape(c, [{ x: lx - 16, y: ly }, { x: lx, y: ly - 7 }, { x: lx + 16, y: ly }, { x: lx, y: ly + 7 }], { ink, fill: mixRgba('paper', 'gingham', 0.55), w: 0.35, seed: 40 + i });
      }
      if (big || i % 6 === 2) this.rose(c, ink, p2.x + (hash(i, 3) - 0.5) * 14, p2.y + (hash(i, 4) - 0.5) * 14, big ? 17 : 12, 50 + i);
    }
    for (const x of [ax0, ax1]) for (let k = 0; k < 4; k++) this.rose(c, ink, x + ((k % 2) * 2 - 1) * 8, atop + AR + 30 + k * 60, 11, x + k);
    // 拱門的腳：兩塊小小的底座
    for (const x of [ax0, ax1]) inkEllipse(c, x, ay + 4, 22, 6, 0, { ink, fill: mixRgba('paper', 'sepia', 0.08), w: 0.5, seed: x + 3 });
    // 草地上散落的花瓣
    for (let i = 0; i < 26; i++) {
      const px = 700 + 620 * hash(i, 7), py = FLOOR - 100 + 110 * hash(i, 8);
      if (px > 1330 && py > 820) continue;
      c.fillStyle = mixRgba('bone', 'rose', 0.25, 0.7);
      c.beginPath(); c.ellipse(px, py, 5, 2.5, hash(i, 9) * 3, 0, Math.PI * 2); c.fill();
    }
    L.upload();
  }

  /** 迎賓板左上角的一小束花（幾朵圓圓的花、幾片葉子）。 */
  private spray(c: CanvasRenderingContext2D, ink: Ink, x: number, y: number) {
    for (let i = 0; i < 6; i++) {
      const a = -0.3 + i * 0.35, L = 40 + 30 * hash(i, 1);
      const tip = { x: x + Math.cos(a) * L, y: y + Math.sin(a) * L * 0.8 };
      inkShape(c, [{ x, y }, { x: (x + tip.x) / 2 - 6, y: (y + tip.y) / 2 - 8 }, tip, { x: (x + tip.x) / 2 + 6, y: (y + tip.y) / 2 + 6 }], { ink, fill: mixRgba('paper', 'gingham', 0.6), w: 0.4, seed: 20 + i });
    }
    for (const [dx, dy, r] of [[0, 0, 22], [30, 14, 17], [-12, 28, 15], [18, -20, 14]] as const) this.rose(c, ink, x + dx, y + dy, r, 30 + dx);
  }

  /** 一朵手繪的圓玫瑰：淺色的圓、裡面一圈螺旋。 */
  private rose(c: CanvasRenderingContext2D, ink: Ink, x: number, y: number, r: number, seed: number, t = 0) {
    // 五瓣的小花：五個圓圓的花瓣（淡淡的奶油粉）、中間一點；比螺旋線更一眼看得出是花
    const rot = hash(seed, 1) * Math.PI;
    for (let k = 0; k < 5; k++) {
      const a = rot + (k / 5) * Math.PI * 2;
      inkEllipse(c, x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5, r * 0.52, r * 0.46, a, { ink, t, fill: mixRgba('bone', 'rose', 0.14), w: 0.4, seed: seed + k, color: rgba('sepia', 0.5) });
    }
    c.fillStyle = mixRgba('ember', 'sepia', 0.35);
    c.beginPath(); c.arc(x, y, r * 0.2, 0, Math.PI * 2); c.fill();
  }

  /**
   * 飛在空中的捧花：就是 throw 那張圖上 Codex 畫的那一束（只取捧花與緞帶兩個圓的範圍），移到 (x, y)、繞著捧花中心轉 ang。
   * 出手那一刻圖上的捧花蓋掉（hide），這一束從同一個位置、同樣大小接著飛，看不出換手；咬到之後一樣是這一束，落地才換成 pp_bouquet。
   */
  private flyingBouquet(c: CanvasRenderingContext2D, x: number, y: number, ang: number, sc = 1) {
    const F0 = this.from, R = this.ribbon, r0 = (F0.r ?? 40) * 1.15;
    c.save();
    c.translate(x, y);
    c.rotate(ang);
    c.scale(sc, sc);
    c.translate(-F0.x, -F0.y);
    c.beginPath();
    c.arc(F0.x, F0.y, r0, 0, Math.PI * 2);
    if (R.r) { c.moveTo(R.x + R.r * 1.15, R.y); c.arc(R.x, R.y, R.r * 1.15, 0, Math.PI * 2); }
    c.clip();
    drawPuppet(c, P.throw, OM_X, FLOOR, THROW_O);
    c.restore();
  }

  /** 捧花在空中轉了多少（u = 0..1 飛行進度）：一圈多一點，咬到的時候緞帶朝下。 */
  private spinAt(u: number) { return -u * Math.PI * 2.25; }

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

    this.grass(c, ink, t);
    // ---- 歌詞：草地前面（下三分之一，跟唱）；折成兩排時往上長
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const big = !this.msg;
      const st = { family: F.archivo(100, big ? 800 : 700), size: this.lyricSize, minSize: 40, maxWidth: LYR.w, unsung: rgba('sepia', 0.26), sung: rgba('sepia', big ? 0.92 : 0.8), active: rgba('signal') };
      const lay = layoutLyric(c, ly.line, st);
      c.save();
      c.translate(LYR.x, LYR.base - (lay.height - lay.size));
      drawLyric(c, ly.line, t, st, lay, ly.k * prog(t, s + 0.1, s + 0.5));
      c.restore();
    }
    // ---- 迎賓板上的留言
    this.drawBoard(c, t);
    // ---- 狗、孟庭、飛在空中的捧花
    // 孟庭在拱門下、狗在她前面搶捧花（狗後畫：QQ 靠近她的裙擺，不要被蓋住）
    this.drawOmena(c, t, bp);
    this.drawDogs(c, ink, t, bp);
    this.flight(c, ink, t);
    this.petals(c, ink, t);

    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p);
    const z = 0.03 * push;
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.22, grain: 0.045, ca: 0.5, zoom: 1 + z, shake: [-(900 - W / 2) * z, -(520 - H / 2) * z] };
  }

  /** 孟庭：預備時跟著拍子往下盪（每拍壓一下、小節線前一拍蹲最低）→ 出手（往後仰、整張往上一送）→ 回頭大笑、跟著拍子跳。 */
  private drawOmena(c: CanvasRenderingContext2D, t: number, bp: number) {
    const au = this.ctx.audio;
    const en = puppetIn(t, this.ctx.start + 0.05, 0.45);
    if (en.alpha <= 0) return;
    let squash = breathe(t, 0.01, 2.8), rot = 0, lift = 0;
    if (t < this.tThrow) {
      // 一、二、三：每拍壓一下，越來越低；出手前一拍蹲到最低
      const k = beatKick(au, t, 0.3);
      const deep = prog(t, this.tThrow - bp * 1.2, this.tThrow - 0.03, ease.inOutCubic);
      squash += 0.03 * k + 0.08 * deep;
      rot += 0.03 * k + 0.06 * deep;
    } else if (t < this.tTurn) {
      const d = t - this.tThrow;
      lift = 22 * Math.sin(Math.PI * clamp(d / (bp * 0.9)));
      squash -= 0.06 * Math.exp(-d / 0.12);
      rot -= 0.08 * Math.exp(-d / 0.35);
    } else {
      const j = jumpArc(t, this.tTurn + 0.02, this.tTurn + Math.min(0.4, bp * 0.85), 18, { crouch: 0.05 });
      lift = -j.y; squash += j.squash + 0.02 * beatKick(au, t, 0.25);
      rot = 0.02 * Math.sin(au.beatAt(t) * Math.PI);
    }
    puppetShadow(c, 'mt', OM_X, FLOOR, { h: SZ, lift, alpha: 0.3 * en.alpha, color: '60,70,40' });
    // 甩出去之後，圖上她頭後面那一束捧花由程式接手飛
    drawPick(c, this.keys, t, OM_X, FLOOR - lift, { h: SZ, flip: true, spin: en.spin, alpha: en.alpha, squash, rot, pivot: 0.3, hide: [`${P.throw}:bouquet`, `${P.throw}:ribbon`] });
  }

  /** 捧花在空中的位置與飛行進度（0..1，給轉圈用）：第一段高高的弧線到元元的鼻子，第二段被頂起來的小弧線到芃芃嘴邊。 */
  private bouquetAt(t: number): (Pt & { u: number }) | null {
    if (t < this.tThrow || t >= this.tCatch) return null;
    if (t < this.tHead) {
      const u = (t - this.tThrow) / (this.tHead - this.tThrow);
      return { ...arcAt(this.from, this.head, Math.min(this.from.y, this.head.y) - ARC_UP, u), u: u * 0.8 };
    }
    const u = (t - this.tHead) / (this.tCatch - this.tHead);
    return { ...arcAt(this.head, this.to, Math.min(this.head.y, this.to.y) - BOUNCE_UP, u), u: 0.8 + 0.2 * u };
  }

  /** 捧花在空中：沿著兩段弧線飛（一邊轉），元元頂到的那一下鼻子前冒一小圈火花；咬到之後由 pp_bouquet 那張圖接手。 */
  private flight(c: CanvasRenderingContext2D, ink: Ink, t: number) {
    const q = this.bouquetAt(t);
    if (!q) return;
    // 第一段飛到最高的時候放大一點（像往鏡頭飛過來），遠處的桌子也看得到是一束捧花
    const big = t < this.tHead ? 0.5 * Math.sin(Math.PI * (q.u / 0.8)) : 0;
    this.flyingBouquet(c, q.x, q.y, this.spinAt(q.u), 1 + big);
    // 飛過的地方留一道很淡的訊號色細線
    const pts: Pt[] = [];
    for (let k = 0; k <= 14; k++) { const p = this.bouquetAt(Math.max(this.tThrow, t - k * 0.02)); if (p) pts.push(p); }
    const sg = LIN.signal;
    if (pts.length > 1) this.glow.polyline(pts, 2, [sg[0] * 1.6, sg[1] * 1.6, sg[2] * 1.6], 0.5);
    // 元元頂到：鼻子前一小圈往外的短線（訊號色，發光）
    const d = t - this.tHead;
    if (d >= 0 && d < 0.25) {
      const k = d / 0.25, H0 = this.head;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2, r0 = 10 + 30 * k, r1 = r0 + 14 * (1 - k);
        this.glow.seg2(H0.x + Math.cos(a) * r0, H0.y + Math.sin(a) * r0, H0.x + Math.cos(a) * r1, H0.y + Math.sin(a) * r1, 1.6, [sg[0] * 2.5, sg[1] * 2.5, sg[2] * 2.5], 1 - k);
      }
    }
  }

  /**
   * 三隻狗（元元站在後面一點，先畫）：
   * 元元：站著看（每拍輕輕點頭）→ 第 2 拍跳到最高、鼻子頂到捧花 → 落地之後正面坐好、張嘴笑，跟著拍子左右晃。
   * QQ：早一拍跳、撲空，之後繞著跳。芃芃：站著等 → 第 3 拍起跳、最高點咬到 → 叼著捧花坐好、每拍搖一下（嘴邊冒愛心）。
   */
  private drawDogs(c: CanvasRenderingContext2D, ink: Ink, t: number, bp: number) {
    const au = this.ctx.audio;
    const air = Math.min(0.62, bp * 1.3);
    const shadowC = '60,70,40';
    // 元元
    const ey = puppetIn(t, this.ctx.start + 0.35, 0.45);
    if (ey.alpha > 0) {
      const oy: PuppetOpts = { h: SZ, scale: DOG_S, flip: true, spin: ey.spin, alpha: ey.alpha };
      const airY = Math.min(0.6, bp * 1.25);
      const j = jumpArc(t, this.tHead - airY / 2, this.tHead + airY / 2, YJUMP, { crouch: 0.1, land: 0.18 });
      const gy = FLOOR - YY_BACK;
      puppetShadow(c, 'yy', YY_X, gy, { h: SZ * DOG_S, lift: -j.y, alpha: 0.28 * ey.alpha, color: shadowC });
      // 跳起來那張嘴前畫了球：這裡頂的是捧花，一律蓋掉
      if (j.air) drawPuppet(c, P.yyJump, YY_X, gy + j.y, { ...oy, hide: ['ball'], squash: j.squash, rot: 0.1 - 0.2 * j.u, pivot: 0.5 });
      else if (t >= this.tHead) drawPuppet(c, P.yySit, YY_X, gy, { ...oy, flip: false, squash: j.squash + 0.02 * beatKick(au, t, 0.3), rot: 0.035 * Math.sin(au.beatAt(t) * Math.PI), pivot: 0.1 });
      else drawPuppet(c, P.yyStand, YY_X, gy, { ...oy, squash: j.squash + 0.02 * beatKick(au, t, 0.3) + breathe(t, 0.01, 2.6), rot: -0.02 * beatKick(au, t, 0.3), pivot: 0.3 });
    }
    // QQ
    const eq = puppetIn(t, this.ctx.start + 0.3, 0.45);
    if (eq.alpha > 0) {
      const oq: PuppetOpts = { h: SZ, scale: DOG_S, flip: true, spin: eq.spin, alpha: eq.alpha };
      const j = jumpArc(t, this.tMiss - air / 2, this.tMiss + air / 2, QJUMP, { crouch: 0.1, land: 0.2 });
      let lift = -j.y, name: string = P.qqStand, sq = j.squash;
      if (j.air) name = P.qqJump;
      else if (t > this.tCatch + bp) { lift = 26 * hop(au.beatAt(t)); sq += 0.03 * beatKick(au, t, 0.2); }
      else sq += 0.03 * beatKick(au, t, 0.25);
      puppetShadow(c, 'qq', QQ_X, FLOOR, { h: SZ * DOG_S, lift, alpha: 0.3 * eq.alpha, color: shadowC });
      drawPuppet(c, name, QQ_X, FLOOR - lift, { ...oq, hide: ['ball'], squash: sq, rot: j.air ? -0.1 + 0.2 * j.u : 0, pivot: 0.5 });
    }
    // 芃芃
    const ep = puppetIn(t, this.ctx.start + 0.4, 0.45);
    if (ep.alpha <= 0) return;
    const op: PuppetOpts = { h: SZ, scale: DOG_S, flip: true, spin: ep.spin, alpha: ep.alpha };
    const j = jumpArc(t, this.tCatch - air / 2, this.tCatch + air / 2, PJUMP, { crouch: 0.12, land: 0.2 });
    puppetShadow(c, 'pp', PP_X, FLOOR, { h: SZ * DOG_S, lift: -j.y, alpha: 0.3 * ep.alpha, color: shadowC });
    if (j.air) {
      drawPuppet(c, P.ppJump, PP_X, FLOOR + j.y, { ...op, hide: ['ball'], squash: j.squash, rot: 0.12 - 0.24 * j.u, pivot: 0.5 });
      // 咬到之後到落地：捧花在嘴邊
      if (t >= this.tCatch) {
        const m = puppetPoint(P.ppJump, 'mouth', PP_X, FLOOR + j.y, { ...op, rot: 0.12 - 0.24 * j.u, pivot: 0.5 }) ?? this.to;
        this.flyingBouquet(c, m.x - (this.from.r ?? 30) * 0.7, m.y - 4, this.spinAt(1));
      }
    } else if (t >= this.tCatch) {
      drawPuppet(c, P.ppHold, PP_X, FLOOR, { ...op, squash: j.squash + 0.03 * beatKick(au, t, 0.25), rot: 0.05 * Math.sin(au.beatAt(t) * Math.PI), pivot: 0.1 });
      const [bx, by, bw] = puppetBox(P.ppHold, PP_X, FLOOR, op);
      for (let k = 0; k < 3; k++) heartPop(c, bx + bw * (0.3 + 0.2 * k), by + 10, 22, (t - this.tCatch - 0.2 - k * bp) / 1.2);
    } else {
      drawPuppet(c, P.ppStand, PP_X, FLOOR, { ...op, squash: j.squash + 0.03 * beatKick(au, t, 0.25), rot: -0.04 * Math.sin(au.beatAt(t) * Math.PI), pivot: 0.3 });
    }
  }

  /** 迎賓板上的留言：第一拍起一個字一個字寫上去，寫完署名淡入；在板面上垂直置中。 */
  private drawBoard(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const B = this.board;
    const total = msgChars(n.fit);
    const per = clamp(1.6 / Math.max(1, total), 0.03, 0.1);
    const done = this.msgT0 + total * per;
    const top = B.y + PAD.top, h = B.h - PAD.top - PAD.bottom;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.15, this.ctx.start + 0.55);
    drawNote(c, n, B.x + PAD.x, top + Math.max(0, (h - n.height) * 0.45), {
      chars: this.msg ? (t - this.msgT0) / per : Infinity, color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.6), sigColor: rgba('sepia', 0.75), sigK: prog(t, done + 0.1, done + 0.5),
    });
    c.restore();
  }

  /** 前景的草：一叢一叢短短的線，每小節一陣風從左吹到右。 */
  private grass(c: CanvasRenderingContext2D, ink: Ink, t: number) {
    const au = this.ctx.audio;
    const bar = au.barAt(t);
    c.save();
    c.strokeStyle = rgba('sepia', 0.35);
    c.lineWidth = 1;
    c.beginPath();
    for (let i = 0; i < 46; i++) {
      const x = 20 + i * 41 + 14 * hash(i, 1);
      const y = FLOOR + 6 + 34 * hash(i, 3);
      if (y > 1000 || (x > 1330 && y > 820)) continue;
      const wave = Math.exp(-Math.pow(((bar % 1) * 2400 - x) / 260, 2));
      const bend = 6 + 18 * wave + 3 * Math.sin(t * 1.5 + i);
      const hgt = 14 + 12 * hash(i, 4);
      for (const dx of [-5, 0, 5]) { c.moveTo(x + dx, y); c.quadraticCurveTo(x + dx + bend * 0.3, y - hgt * 0.6, x + dx + bend, y - hgt); }
    }
    c.stroke();
    c.restore();
  }

  /** 花瓣慢慢飄（決定性：位置只看 t 與編號），迎賓板上的字那一塊不飄。 */
  private petals(c: CanvasRenderingContext2D, ink: Ink, t: number) {
    const B = this.board;
    for (let i = 0; i < 10; i++) {
      const sp = 40 + 22 * hash(i, 1), u = ((t * sp) / 1100 + hash(i, 2)) % 1;
      const y = -40 + u * 1100, x = 150 + 1650 * hash(i, 3) + 60 * Math.sin(t * 0.8 + i);
      if (x > B.x - 30 && x < B.x + B.w + 30 && y > B.y - 20 && y < B.y + B.h + 20) continue;
      if (x > 1340 && y > 800) continue;
      const a = t * (0.8 + hash(i, 4)) + i;
      c.globalAlpha = 0.8 * Math.sin(Math.PI * u);
      inkShape(c, [{ x: x - 8, y }, { x, y: y - 4 - 2 * Math.sin(a) }, { x: x + 8, y }, { x, y: y + 4 + 2 * Math.cos(a) }], { ink, fill: rgba('bone'), w: 0.35, seed: 90 + i });
    }
    c.globalAlpha = 1;
  }
}
