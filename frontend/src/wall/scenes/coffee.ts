// 咖啡拉花（亮、home）：咖啡店的吧台，從客人這一側、稍微往下看。宣文與孟庭站在吧台後面，各拿一支拉花奶泡壺，
// 往吧台前緣的兩杯咖啡裡倒奶；角色是 Codex 畫的紙偶（_puppet.ts），吧台、杯子、拉花、奶柱用程式畫。
//  - 拉花落在拍點：宣文先倒一顆愛心（拍點上奶泡一鼓一鼓地長大，**小節線上拉過去**，圓變成愛心）；
//    接著孟庭倒一片葉子（每半拍擺一下、多一層葉片，下一個小節線拉出葉脈）。拉花那一下壺往上一提（整個人往上一送）。
//  - 杯子在前景、夠大（俯角看得到杯面），愛心與葉子是這個畫面最亮的白；拉好之後杯子冒熱氣，之後每個小節線浮起一顆小愛心。
//  - 兩隻博美從吧台後面偷看（平常只露出耳朵和眼睛）：每小節輪流（芃芃、QQ）在第二拍整個冒出來、第四拍縮回去，前腳搭在檯面上。
//    元元（白柴，三隻裡最高）不用跳：一直站起來、兩隻前腳穩穩搭在檯面上，面前一小杯給狗喝的奶泡（puppuccino）；
//    每個小節線低頭舔一口（奶泡一口一口變少、冒兩個小泡泡），平常跟著拍子點頭。兩隻博美在牠左右兩邊輪流冒出來。
//  - **焦點是主打留言**：寫在左邊牆上的黑板菜單（粉筆字、木框、上面一盞小燈打著），標準 v2：字 40～60、黑板最大 600 × 430，
//    高度跟著留言長短。沒有留言時黑板寫邀請、字淡，歌詞變主角。
//  - 歌詞直接寫在右上的牆上（像咖啡店手寫的牆字），旁邊一個小小的「NOW BREWING」；比留言小一級（標準 v2：40～52）。
//  - 鏡頭：整個窗格慢慢推近、往黑板那邊飄一點。開場：紙偶從側面翻正進場（仙女棒的火花在檯面上）。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, beatAfter, barAfter, drawHeart } from './_motifs';
import { inkFor, inkLine, inkPath, inkPoly, inkRect, inkEllipse, paperBG, type Pt, type Note } from './_couple';
import { loadPuppets, drawPuppet, drawPick, puppetPoint, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { INVITE, enterPuppet, writeNote } from './_c5';

export const spec: PlateSpecDecl = { group: 'couple', family: 'home', paper: true, energy: [0.2, 0.9], bars: [4, 8] };

/** 場景尺度（宣文的身高 px）：人站在吧台後面，只看得到腰以上。 */
const SZ = 700;
/** 吧台後面的地板（被吧台擋住，看不到）。 */
const FLOOR = 1076;
/** 吧台檯面：後緣、前緣的 y（稍微往下看，看得到檯面與杯面）。 */
const TOP = { back: 640, front: 846 };
const AL_X = 846, OM_X = 1184;
/** 右下角 HUD（時間、QR）的左緣：吧台前緣的粗邊與線在這之前淡掉，時間的字後面才乾淨。 */
const HUD_X = 1360;
/** 杯口橢圓中心的 y、杯口半徑與俯角的壓扁比例（杯子的 x 對齊圖上奶柱落下的地方，在 init 算）。 */
const CUP_Y = 768, CUP_R = 106, CUP_K = 0.5;
/** 黑板菜單：最大的範圍（標準 v2；上緣固定、高度跟著留言）與寫字的內距。 */
const BOARD = { x: 116, y: 150, w: 604, h: 430 };
const PAD = { x: 48, top: 78, bottom: 36 };
/** 牆上的歌詞（沒有框）。 */
const WALL = { x: 842, y: 150, w: 700 };
/** 右邊的吊燈（跟著拍子輕輕晃）。 */
const LAMP = { x: 1650, y: 236 };
/** 狗狗探頭的位置、放大倍數。 */
const PP_X = 1340, QQ_X = 1690, YY_X = 1515, DOG_S = 1.15;
/** 吧台圖層從哪一個 y 開始（檯面後緣再往上一點，留給杯子的熱氣以外的東西不用）。 */
const BAR_Y = TOP.back - 4;
const SPRITES = ['xw_coffee_pour', 'xw_coffee_smile', 'mt_coffee_pour', 'mt_coffee_smile', 'pp_coffee_peek', 'qq_coffee_peek', 'yy_c5_peek'];
/** 元元面前那杯狗狗奶泡（杯底中心，放在檯面上）。 */
const PUP = { x: YY_X + 2, y: 652 };

interface Pour { who: 0 | 1; kind: 'heart' | 'leaf'; t0: number; pull: number }
interface Peek { who: 'pp' | 'qq'; up: number; down: number }

export default class Coffee extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 吧台（檯面、前板、杯子與杯盤）：畫一次，每格疊在人和狗的前面（他們站在吧台後面）。只當圖片來源，不上傳。 */
  bar = this.track(new Layer2D(W, H - BAR_Y));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  pours: Pour[] = [];
  peeks: Peek[] = [];
  /** 每個人的姿勢時間軸。 */
  keys: [number, string][][] = [[], []];
  /** 兩杯咖啡（杯口橢圓的中心）：宣文的、孟庭的。 */
  cups: Pt[] = [{ x: AL_X, y: CUP_Y }, { x: OM_X, y: CUP_Y }];
  /** 之後每個小節線浮起一顆小愛心的時間。 */
  hearts: number[] = [];
  /** 元元低頭舔奶泡的時間（每個小節線）。 */
  licks: number[] = [];
  note: Note | null = null;
  board = { ...BOARD };
  noteT0 = 0;
  lyricSize = 52;

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('一位賓客NOW BREWING TODAY\'S SPECIAL（間奏：慢慢拉花）' + INVITE);
    this.track(await loadPuppets(SPRITES));
    const s = this.ctx.start;
    // 杯子擺在圖上的奶柱正下方：奶柱被吧台擋住的地方，接著程式畫的奶柱落進杯子
    this.cups = (['xw', 'mt'] as const).map((p, i) => ({ x: this.streamAt(`${p}_coffee_pour`, i ? OM_X : AL_X, FLOOR, { h: SZ })?.x ?? (i ? OM_X : AL_X), y: CUP_Y }));
    // 宣文先倒愛心：開場後的第一拍開始，至少兩拍之後的小節線拉過去；孟庭接著倒葉子，下一個小節線拉葉脈
    const t0 = beatAfter(au, s + 0.45);
    const pull0 = barAfter(au, t0 + au.beatPeriod(t0) * 1.9);
    const pull1 = barAfter(au, pull0 + au.beatPeriod(pull0) * 2.9);
    this.pours = [
      { who: 0, kind: 'heart', t0, pull: pull0 },
      { who: 1, kind: 'leaf', t0: pull0 + au.beatPeriod(pull0) * 0.5, pull: pull1 },
    ];
    for (const p of this.pours) {
      const bp = au.beatPeriod(p.t0), pre = p.who ? 'mt' : 'xw';
      this.keys[p.who] = [[-1e9, `${pre}_coffee_smile`], [p.t0 - bp * 0.45, `${pre}_coffee_pour`], [p.pull + bp * 0.55, `${pre}_coffee_smile`]];
    }
    // 狗狗探頭：每小節輪流，第二拍冒出來、第四拍縮回去
    let bar = Math.ceil(au.barAt(s + 0.3) - 1e-6);
    for (let k = 0; k < 40; k++, bar++) {
      const b0 = au.timeOfBar(bar);
      if (b0 > this.ctx.end) break;
      const bp = au.beatPeriod(b0);
      this.peeks.push({ who: k % 2 ? 'qq' : 'pp', up: b0 + bp, down: b0 + bp * 3 });
      if (b0 > s + 0.6) this.licks.push(b0);
      if (b0 > pull1 + 0.1) this.hearts.push(b0);
    }
    // 黑板上的留言：標準 v2 的字級；黑板的寬高跟著留言（上緣固定）
    const c = this.fg.ctx;
    const w = BOARD.w - PAD.x * 2, hmax = BOARD.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const bw = Math.min(BOARD.w, tightenNote(c, this.note, 360) + PAD.x * 2);
    this.board = { x: BOARD.x, y: BOARD.y, w: bw, h: Math.min(BOARD.h, Math.max(250, PAD.top + this.note.height + PAD.bottom + 12)) };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.noteT0 = Math.min(t0, s + 0.9);
    this.drawBackground();
    this.drawBar();
  }

  /** 牆（下半部淡淡的磁磚縫）、右上的小層架、黑板菜單與上面的小燈、右邊的咖啡機（都不會動，畫一次）。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx, ink = inkFor(true);
    L.clear();
    // 腰線與磁磚縫：很淡，只是空氣
    inkLine(c, [{ x: 40, y: 392 }, { x: 1880, y: 390 }], { ink, w: 0.5, color: rgba('sepia', 0.35), seed: 1 });
    c.save();
    c.strokeStyle = rgba('sepia', 0.06);
    c.lineWidth = 1.2;
    c.beginPath();
    for (let y = 430; y < TOP.back; y += 44) { c.moveTo(40, y); c.lineTo(1880, y); }
    for (let r = 0, y = 392; y < TOP.back; r++, y += 44) for (let x = 60 + (r % 2) * 44; x < 1880; x += 88) { c.moveTo(x, y + 2); c.lineTo(x, Math.min(TOP.back, y + 42)); }
    c.stroke();
    c.restore();
    // 右上的小層架：幾個杯子、一罐豆子（淡）
    const sy = 430;
    inkLine(c, [{ x: 1470, y: sy }, { x: 1860, y: sy + 1 }], { ink, w: 0.9, seed: 3 });
    for (const [x, hh, sd] of [[1500, 44, 4], [1560, 44, 5], [1650, 70, 6], [1760, 40, 7]] as const) {
      if (sd === 6) {
        inkRect(c, x, sy - hh, 60, hh, { ink, fill: rgba('paper'), w: 0.7, seed: sd, r: 6 });
        inkLine(c, [{ x: x + 4, y: sy - hh + 12 }, { x: x + 56, y: sy - hh + 12 }], { ink, w: 0.5, seed: sd + 20, color: rgba('sepia', 0.5) });
      } else {
        inkPoly(c, [{ x, y: sy - hh }, { x: x + 44, y: sy - hh }, { x: x + 40, y: sy - 1 }, { x: x + 4, y: sy - 1 }], { ink, fill: rgba('paper'), w: 0.7, seed: sd });
        inkPath(c, [{ x: x + 43, y: sy - hh + 10 }, { x: x + 58, y: sy - hh + 18 }, { x: x + 42, y: sy - hh + 30 }], { ink, w: 0.6, seed: sd + 10 });
      }
    }
    // 咖啡機（右邊，一半在畫面外）：機身、沖煮頭、壓力錶、蒸氣管
    const M = { x: 1690, y: 470, w: 400, h: TOP.back - 470 };
    inkRect(c, M.x, M.y, M.w, M.h, { ink, fill: mixRgba('paper', 'sepia', 0.06), w: 1, seed: 8, r: 10 });
    inkLine(c, [{ x: M.x + 10, y: M.y + 40 }, { x: M.x + M.w, y: M.y + 40 }], { ink, w: 0.6, seed: 9 });
    inkEllipse(c, M.x + 90, M.y + 22, 13, 13, 0, { ink, fill: rgba('paper'), w: 0.6, seed: 10 });
    inkLine(c, [{ x: M.x + 90, y: M.y + 22 }, { x: M.x + 97, y: M.y + 15 }], { ink, w: 0.5, seed: 11 });
    inkRect(c, M.x + 150, M.y + 58, 90, 28, { ink, fill: rgba('paper'), w: 0.8, seed: 12, r: 4 });
    inkLine(c, [{ x: M.x + 172, y: M.y + 86 }, { x: M.x + 176, y: M.y + 118 }], { ink, w: 1.2, seed: 13 });
    inkPath(c, [{ x: M.x + 36, y: M.y + 60 }, { x: M.x + 28, y: M.y + 110 }, { x: M.x + 36, y: M.y + 150 }], { ink, w: 1, seed: 14 });
    this.drawBoard(c, ink);
    L.upload();
  }

  /** 黑板菜單：木框、石板灰綠的板面（上面一盞小燈，越往下越暗）、擦過的粉筆痕、小小的「TODAY'S SPECIAL」。 */
  private drawBoard(c: CanvasRenderingContext2D, ink: ReturnType<typeof inkFor>) {
    const B = this.board;
    // 畫燈：從木框上緣伸出來的細臂＋一支橫的燈罩，往黑板打一點暖光（光在板面的漸層裡）
    const lx = B.x + B.w / 2;
    for (const dx of [-60, 60]) inkPath(c, [{ x: lx + dx, y: B.y + 4 }, { x: lx + dx * 0.9, y: B.y - 22 }, { x: lx + dx * 0.7, y: B.y - 34 }], { ink, w: 0.7, seed: 21 + dx });
    inkPoly(c, [{ x: lx - 92, y: B.y - 46 }, { x: lx + 92, y: B.y - 46 }, { x: lx + 98, y: B.y - 28 }, { x: lx - 98, y: B.y - 28 }], { ink, fill: mixRgba('paper', 'fur', 0.3), w: 0.8, seed: 22 });
    // 影子（往右下一點）
    c.fillStyle = rgba('sepia', 0.12);
    c.fillRect(B.x + 10, B.y + 12, B.w, B.h);
    // 木框與板面
    inkRect(c, B.x, B.y, B.w, B.h, { ink, fill: mixRgba('paper', 'fur', 0.34), w: 1.1, seed: 23, r: 4 });
    const fr = 14;
    const g = c.createLinearGradient(0, B.y, 0, B.y + B.h);
    g.addColorStop(0, mixRgba('ink2', 'gingham', 0.3));
    g.addColorStop(0.35, mixRgba('ink2', 'gingham', 0.2));
    g.addColorStop(1, mixRgba('ink', 'gingham', 0.12));
    c.fillStyle = g;
    c.fillRect(B.x + fr, B.y + fr, B.w - fr * 2, B.h - fr * 2);
    // 擦過的粉筆痕（很淡的幾團）
    const rnd = (i: number, k: number) => hash(i, k, 77);
    c.save();
    c.beginPath(); c.rect(B.x + fr, B.y + fr, B.w - fr * 2, B.h - fr * 2); c.clip();
    for (let i = 0; i < 7; i++) {
      const x = B.x + fr + rnd(i, 1) * (B.w - fr * 2), y = B.y + fr + rnd(i, 2) * (B.h - fr * 2);
      const rg = c.createRadialGradient(x, y, 0, x, y, 60 + 80 * rnd(i, 3));
      rg.addColorStop(0, rgba('bone', 0.045)); rg.addColorStop(1, rgba('bone', 0));
      c.fillStyle = rg;
      c.fillRect(x - 140, y - 140, 280, 280);
    }
    c.restore();
    inkRect(c, B.x + fr, B.y + fr, B.w - fr * 2, B.h - fr * 2, { ink, w: 0.5, seed: 24, color: rgba('sepia', 0.6) });
    // 標題（小、低對比）＋右上角一個粉筆畫的小咖啡杯
    c.font = font(F.mono(500), 15);
    c.letterSpacing = '5px';
    c.fillStyle = rgba('bone', 0.5);
    c.fillText('TODAY\'S SPECIAL', B.x + PAD.x, B.y + 50);
    c.letterSpacing = '0px';
    const chalk = inkFor(false, { line: rgba('bone', 0.4) });
    const cx = B.x + B.w - PAD.x - 22, cy = B.y + 44;
    inkPoly(c, [{ x: cx - 14, y: cy - 8 }, { x: cx + 14, y: cy - 8 }, { x: cx + 11, y: cy + 10 }, { x: cx - 11, y: cy + 10 }], { ink: chalk, w: 0.45, seed: 25 });
    inkPath(c, [{ x: cx - 4, y: cy - 14 }, { x: cx - 1, y: cy - 20 }, { x: cx - 4, y: cy - 27 }], { ink: chalk, w: 0.35, seed: 26 });
    inkPath(c, [{ x: cx + 5, y: cy - 14 }, { x: cx + 8, y: cy - 21 }, { x: cx + 5, y: cy - 27 }], { ink: chalk, w: 0.35, seed: 27 });
  }

  /** 吧台：檯面（稍微俯視，木紋）、前板（直條木片）、兩個杯子與杯盤（杯面的咖啡與拉花每格畫）。 */
  private drawBar() {
    const L = this.bar, c = L.ctx, ink = inkFor(true);
    L.clear();
    c.save();
    c.translate(0, -BAR_Y);
    // 檯面：上亮下暗一點點，後緣一條細的高光
    const g = c.createLinearGradient(0, TOP.back, 0, TOP.front);
    g.addColorStop(0, mixRgba('paper', 'fur', 0.22));
    g.addColorStop(1, mixRgba('paper', 'fur', 0.3));
    c.fillStyle = g;
    c.fillRect(0, TOP.back, W, TOP.front - TOP.back);
    c.strokeStyle = rgba('sepia', 0.07);
    c.lineWidth = 1.4;
    c.beginPath();
    for (let k = 0; k < 6; k++) {
      const y = TOP.back + 18 + k * 27;
      c.moveTo(0, y);
      c.bezierCurveTo(W * 0.3, y - 5 + k, W * 0.62, y + 6, W, y - 2);
    }
    c.stroke();
    inkLine(c, [{ x: 0, y: TOP.back }, { x: W, y: TOP.back - 1 }], { ink, w: 0.9, seed: 31 });
    // 前板：檯面前緣（厚一點）＋直條木片；右下角（HUD）只留很淡的底色：前緣的粗邊在 HUD 左緣之前漸漸淡成底色，線也在那之前收筆
    c.fillStyle = mixRgba('paper', 'fur', 0.16);
    c.fillRect(0, TOP.front, W, H - TOP.front);
    const edge = c.createLinearGradient(HUD_X - 160, 0, HUD_X - 20, 0);
    edge.addColorStop(0, mixRgba('paper', 'fur', 0.4));
    edge.addColorStop(1, mixRgba('paper', 'fur', 0.16));
    c.fillStyle = edge;
    c.fillRect(0, TOP.front, HUD_X - 20, 18);
    inkLine(c, [{ x: 0, y: TOP.front }, { x: HUD_X - 40, y: TOP.front + 1 }], { ink, w: 1.1, seed: 32 });
    inkLine(c, [{ x: 0, y: TOP.front + 18 }, { x: HUD_X - 70, y: TOP.front + 18 }], { ink, w: 0.8, seed: 33 });
    c.strokeStyle = rgba('sepia', 0.1);
    c.lineWidth = 1.5;
    c.beginPath();
    for (let x = 40; x < HUD_X - 40; x += 58) { c.moveTo(x, TOP.front + 26); c.lineTo(x, H); }
    c.stroke();
    // 兩個杯子：杯盤（影子、盤子）、杯身（白瓷，右邊一個耳）、杯口的厚度
    for (const p of this.cups) {
      const r = CUP_R, k = CUP_K;
      c.fillStyle = rgba('sepia', 0.14);
      c.beginPath(); c.ellipse(p.x + 16, p.y + r * k + 30, r * 1.55, r * k * 1.25, 0, 0, Math.PI * 2); c.fill();
      inkEllipse(c, p.x, p.y + r * k + 20, r * 1.5, r * k * 1.2, 0, { ink, fill: rgba('bone'), w: 0.9, seed: p.x });
      inkEllipse(c, p.x, p.y + r * k + 17, r * 0.9, r * k * 0.66, 0, { ink, w: 0.4, seed: p.x + 1, color: rgba('sepia', 0.3) });
      // 杯耳（右邊）
      inkPath(c, [{ x: p.x + r * 0.92, y: p.y + 6 }, { x: p.x + r * 1.32, y: p.y + 12 }, { x: p.x + r * 1.3, y: p.y + 40 }, { x: p.x + r * 0.84, y: p.y + 44 }], { ink, w: 1.4, seed: p.x + 2 });
      // 杯身：從杯口往下收成圓圓的碗形（卡布奇諾杯）
      const bowl: Pt[] = [];
      for (let i = 0; i <= 28; i++) {
        const a = Math.PI - (i / 28) * Math.PI;
        bowl.push({ x: p.x + Math.cos(a) * r * 1.04 * lerp(1, 0.66, Math.sin(a) ** 2), y: p.y + Math.sin(a) * (r * k * 1.04 + 28) });
      }
      inkPoly(c, bowl, { ink, fill: rgba('bone'), w: 1, seed: p.x + 3 });
      // 杯身右邊一點陰影（光從左上來）
      c.save();
      c.beginPath(); bowl.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y))); c.clip();
      const sg = c.createLinearGradient(p.x - r, 0, p.x + r, 0);
      sg.addColorStop(0.45, rgba('sepia', 0)); sg.addColorStop(1, rgba('sepia', 0.16));
      c.fillStyle = sg;
      c.fillRect(p.x - r * 1.1, p.y, r * 2.2, r * k + 40);
      c.restore();
      // 杯口：白瓷的厚度（外圈）
      inkEllipse(c, p.x, p.y, r * 1.04, r * k * 1.06, 0, { ink, fill: rgba('bone'), w: 1, seed: p.x + 4 });
    }
    c.restore();
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

    this.drawLyrics(c, t);
    this.drawMessage(c, t);
    this.drawLamp(c, t);

    // ---- 人（吧台後面）→ 探頭的狗 → 吧台蓋在前面 → 杯面的咖啡與拉花 → 奶柱
    const spouts: (Pt | null)[] = [this.drawPerson(c, t, 0, bp), this.drawPerson(c, t, 1, bp)];
    this.drawYuanyuan(c, t);
    this.drawPeeks(c, t);
    c.drawImage(this.bar.canvas, 0, BAR_Y, W, H - BAR_Y);
    this.drawPuppuccino(c, t);
    for (let i = 0; i < 2; i++) this.drawCup(c, t, i as 0 | 1, bp, spouts[i]!);

    // 拉好之後：每個小節線從杯子浮起一顆小愛心（點綴色，輪流）
    this.hearts.forEach((h0, i) => {
      const k = (t - h0) / 1.6;
      if (k < 0 || k > 1) return;
      const cup = this.cups[i % 2]!;
      c.save();
      c.globalAlpha = Math.sin(Math.PI * k) * 0.9;
      drawHeart(c, cup.x + 18 * Math.sin(k * 5 + i), cup.y - 60 - k * 150, 22 + 8 * k);
      c.restore();
    });

    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：慢慢推近、往黑板那邊飄一點（最多 1.03 倍，黑板與歌詞離邊界的距離已經算進去）
    const push = ease.inOutCubic(f.p), B = this.board;
    const fx = lerp(W / 2, B.x + B.w / 2, 0.55), fy = lerp(H / 2, B.y + B.h / 2, 0.4);
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.26, grain: 0.045, ca: 0.5, zoom: 1 + 0.03 * push, shake: [-(fx - W / 2) * 0.03 * push, -(fy - H / 2) * 0.03 * push] };
  }

  /** 一個人：姿勢照時間軸；每拍輕輕點一下；倒奶時身體往前傾一點，拉花那一下往上一提。回傳這一格壺嘴的位置（倒奶時）。 */
  private drawPerson(c: CanvasRenderingContext2D, t: number, who: 0 | 1, bp: number): Pt | null {
    const x = who ? OM_X : AL_X;
    const en = enterPuppet(this.glow, t, this.ctx.start + 0.05 + who * 0.12, x, TOP.back - 6, who + 1);
    if (!en) return null;
    const au = this.ctx.audio;
    const p = this.pours[who]!;
    const nod = beatKick(au, t, 0.26);
    const lean = prog(t, p.t0 - bp * 0.45, p.t0, ease.inOutCubic) * (1 - prog(t, p.pull + bp * 0.4, p.pull + bp, ease.inOutCubic));
    const flick = t >= p.pull ? Math.exp(-(t - p.pull) / 0.14) : 0;
    const o: PuppetOpts = {
      h: SZ, rot: (who ? -1 : 1) * (0.012 * lean - 0.02 * flick) + 0.008 * Math.sin(au.beatAt(t) * Math.PI) * (1 - lean),
      pivot: 0.35, squash: 0.012 * nod * (1 - lean) + breathe(t, 0.008, 3.3, who * 0.4), spin: en.spin, alpha: en.alpha,
    };
    const y = FLOOR - 7 * flick;
    const name = drawPick(c, this.keys[who]!, t, x, y, o);
    if (!name.endsWith('_pour')) return null;
    return this.streamAt(name, x, y, o) ?? { x: x - 20, y: TOP.back };
  }

  /** 圖上畫好的奶柱（壺嘴 → 奶柱下段）在吧台後緣被擋住的那一點：程式畫的奶柱從這裡接下去。 */
  private streamAt(name: string, x: number, y: number, o: PuppetOpts): Pt | null {
    const a = puppetPoint(name, 'spout', x, y, o), b = puppetPoint(name, 'stream', x, y, o);
    if (!a || !b) return null;
    const u = (TOP.back - a.y) / (b.y - a.y);
    return { x: lerp(a.x, b.x, u), y: TOP.back };
  }

  /** 右邊的吊燈：從畫面上緣垂下來，拍點上輕輕一晃（像被音響震到）。 */
  private drawLamp(c: CanvasRenderingContext2D, t: number) {
    const ink = inkFor(true);
    const a = 0.018 * Math.sin(t * 2.1) + 0.02 * beatKick(this.ctx.audio, t, 0.5);
    const tip = { x: LAMP.x + Math.sin(a) * LAMP.y, y: Math.cos(a) * LAMP.y };
    inkLine(c, [{ x: LAMP.x, y: -10 }, tip], { ink, w: 0.5, seed: 50 });
    c.save();
    c.translate(tip.x, tip.y);
    c.rotate(-a);
    inkPoly(c, [{ x: -10, y: 0 }, { x: 10, y: 0 }, { x: 58, y: 64 }, { x: -58, y: 64 }], { ink, fill: mixRgba('paper', 'fur', 0.35), w: 0.9, seed: 51 });
    inkEllipse(c, 0, 66, 20, 7, 0, { ink, fill: mixRgba('bone', 'ember', 0.5), w: 0.5, seed: 52 });
    c.restore();
  }

  /**
   * 兩隻博美從吧台後面探頭：平常只露出耳朵和眼睛（前腳搆不到檯面，在後面踮腳偷看）；輪到的那一隻在第二拍整個冒出來、
   * 前腳搭上檯面、歪頭，第四拍縮回去。三隻狗一直都看得到。
   */
  private drawPeeks(c: CanvasRenderingContext2D, t: number) {
    for (const [who, x, d] of [['pp', PP_X, 0.36], ['qq', QQ_X, 0.46]] as const) {
      const en = enterPuppet(this.glow, t, this.ctx.start + d, x, TOP.back - 6, who === 'pp' ? 3 : 4);
      if (!en) continue;
      let upK = 0, rot = 0;
      for (const pk of this.peeks) {
        if (pk.who !== who || t < pk.up - 0.2 || t > pk.down + 0.3) continue;
        const bp = this.ctx.audio.beatPeriod(pk.up);
        upK = prog(t, pk.up - 0.16, pk.up, ease.outBack) * (1 - prog(t, pk.down, pk.down + 0.2, ease.inCubic));
        rot = 0.06 * Math.sin((t - pk.up) / bp * Math.PI) * clamp(upK);
      }
      const name = `${who}_coffee_peek`;
      const o: PuppetOpts = { h: SZ, scale: DOG_S, rot, pivot: 0.6, spin: en.spin, alpha: en.alpha, squash: breathe(t, 0.012, 1.4, who === 'pp' ? 0 : 0.5) };
      // 前腳搭在檯面後緣：用圖上的前腳點對齊；縮下去的時候只露出耳朵和眼睛
      const paw = puppetPoint(name, 'paws', x, 0, o);
      const rest = paw ? TOP.back + 4 - paw.y : TOP.back + SZ * 0.26 * DOG_S * 0.45;
      const sink = SZ * DOG_S * 0.05;
      drawPuppet(c, name, x, rest + (1 - upK) * sink, o);
    }
  }

  /** 元元低頭舔一口的進度（0..1）：小節線前一點點開始低、小節線上最低、之後慢慢抬起來。 */
  private lickAt(t: number) {
    let k = 0;
    for (const l of this.licks) k = Math.max(k, prog(t, l - 0.12, l, ease.outCubic) * (1 - prog(t, l + 0.08, l + 0.42, ease.inOutCubic)));
    return k;
  }

  /** 元元：站起來、前腳搭在檯面後緣（圖上的前腳點對齊），每拍點一下頭；小節線上低頭舔奶泡。 */
  private drawYuanyuan(c: CanvasRenderingContext2D, t: number) {
    const en = enterPuppet(this.glow, t, this.ctx.start + 0.3, YY_X, TOP.back - 6, 5);
    if (!en) return;
    const lick = this.lickAt(t);
    const o: PuppetOpts = { h: SZ, scale: DOG_S, pivot: 0.3, squash: 0.02 * beatKick(this.ctx.audio, t, 0.28) + 0.05 * lick + breathe(t, 0.01, 2.6), spin: en.spin, alpha: en.alpha };
    const paw = puppetPoint('yy_c5_peek', 'paws', YY_X, 0, o);
    // 舔：整隻往前下方低下去（前腳滑到檯面後面），下巴碰到杯口的奶泡
    const rest = (paw ? TOP.back + 6 - paw.y : TOP.back + 240) + 62 * lick;
    drawPuppet(c, 'yy_c5_peek', YY_X, rest, o);
  }

  /** 元元面前的狗狗奶泡：小紙杯＋一球奶泡；每舔一口奶泡少一點，舔的那一下冒兩個小泡泡。 */
  private drawPuppuccino(c: CanvasRenderingContext2D, t: number) {
    const a = prog(t, this.ctx.start + 0.3, this.ctx.start + 0.7);
    if (a <= 0) return;
    const ink = inkFor(true);
    const done = this.licks.filter((l) => t >= l).length;
    const level = Math.max(0.25, 1 - done * 0.18);
    const { x, y } = PUP;
    c.save();
    c.globalAlpha = a;
    c.fillStyle = rgba('sepia', 0.14);
    c.beginPath(); c.ellipse(x + 6, y + 2, 34, 8, 0, 0, Math.PI * 2); c.fill();
    // 紙杯（上寬下窄）與杯口
    inkPoly(c, [{ x: x - 27, y: y - 44 }, { x: x + 27, y: y - 44 }, { x: x + 20, y }, { x: x - 20, y }], { ink, fill: rgba('bone'), w: 0.8, seed: 61 });
    inkLine(c, [{ x: x - 25, y: y - 34 }, { x: x + 25, y: y - 34 }], { ink, w: 0.5, seed: 62, color: rgba('sepia', 0.35) });
    // 奶泡：一球圓頂，越舔越低
    const fh = 6 + 20 * level;
    inkEllipse(c, x, y - 44, 29, fh * 0.55, 0, { ink, fill: mixRgba('bone', 'cream', 0.4), w: 0.5, seed: 63 });
    c.fillStyle = mixRgba('bone', 'cream', 0.4);
    c.beginPath(); c.ellipse(x, y - 44 - fh * 0.3, 22 * (0.6 + 0.4 * level), fh * 0.55, 0, Math.PI, 0); c.fill();
    // 舔的那一下：兩個小泡泡往上飄
    for (const l of this.licks) {
      const d = t - l;
      if (d < 0 || d > 0.6) continue;
      const k = d / 0.6;
      c.globalAlpha = a * (1 - k);
      for (const [dx, sp] of [[-12, 1], [14, 0.8]] as const) inkEllipse(c, x + dx + 6 * Math.sin(k * 6), y - 60 - fh - 50 * k * sp, 4 + 2 * sp, 4 + 2 * sp, 0, { ink, w: 0.4, seed: 64, color: rgba('sepia', 0.5) });
    }
    c.restore();
  }

  /** 一杯咖啡的杯面：克立瑪（中間淺、邊緣深）＋拉花；倒奶時從壺嘴畫一道奶柱到杯面上正在倒的點。 */
  private drawCup(c: CanvasRenderingContext2D, t: number, who: 0 | 1, bp: number, spout: Pt) {
    const cup = this.cups[who]!, p = this.pours[who]!;
    const r = CUP_R, k = CUP_K;
    const at = (u: number, v: number): Pt => ({ x: cup.x + u * r, y: cup.y + v * r * k });
    const g = c.createRadialGradient(cup.x, cup.y, 0, cup.x, cup.y, r);
    g.addColorStop(0, mixRgba('fur', 'sepia', 0.35));
    g.addColorStop(0.75, mixRgba('fur', 'sepia', 0.55));
    g.addColorStop(1, mixRgba('fur', 'sepia', 0.78));
    c.save();
    c.fillStyle = g;
    c.beginPath(); c.ellipse(cup.x, cup.y, r, r * k, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(cup.x, cup.y, r, r * k, 0, 0, Math.PI * 2); c.clip();
    const foam = mixRgba('bone', 'cream', 0.35);
    let target: Pt | null = null;
    if (t >= p.t0) {
      const pull = prog(t, p.pull - bp * 0.04, p.pull + bp * 0.32, ease.outCubic);
      c.fillStyle = foam;
      c.strokeStyle = foam;
      c.lineCap = 'round';
      if (p.kind === 'heart') {
        // 愛心：奶泡圓一拍一鼓地長大，小節線上拉過去（圓的上緣凹下去、下緣拉出尖）
        const fill = prog(t, p.t0, p.pull, ease.outCubic);
        const R = 0.14 + 0.46 * fill + 0.035 * beatKick(this.ctx.audio, t, 0.3) * (1 - pull);
        const pts: Pt[] = [];
        for (let i = 0; i <= 72; i++) {
          const a = (i / 72) * Math.PI * 2;
          const cu = R * Math.sin(a), cv = -R * Math.cos(a) + 0.04;
          const hx = 16 * Math.sin(a) ** 3, hy = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
          const hu = (hx / 16) * 0.64, hv = (-hy / 16) * 0.64 - 0.06;
          pts.push(at(lerp(cu, hu, pull), lerp(cv, hv, pull)));
        }
        c.beginPath();
        pts.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)));
        c.closePath();
        c.fill();
        // 拉過去留下的一條細線（愛心的尖往前延伸）
        if (pull > 0) {
          c.lineWidth = 3;
          const a = at(0, -0.3), b = at(0, lerp(-0.3, 0.8, pull));
          c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
        }
        target = pull > 0 && pull < 1 ? at(0, lerp(-0.3, 0.8, pull)) : at(0.03 * Math.sin(this.ctx.audio.beatAt(t) * Math.PI * 2), 0.02);
      } else {
        // 葉子：每半拍擺一下、多一層葉片（從近的大片往遠處越來越小），小節線上拉出葉脈（每層中間被拉成 V）
        const n = Math.min(8, Math.floor((Math.min(t, p.pull) - p.t0) / (bp * 0.5)) + 1);
        for (let i = 0; i < n; i++) {
          const born = p.t0 + i * bp * 0.5;
          const grow = prog(t, born, born + 0.14, ease.outCubic);
          const vc = 0.44 - i * 0.12, hw = (0.62 - i * 0.058) * (0.55 + 0.45 * grow);
          c.lineWidth = r * (0.085 - i * 0.004);
          c.beginPath();
          for (let j = 0; j <= 16; j++) {
            const u = -hw + (j / 16) * hw * 2;
            const e = Math.abs(u) / Math.max(1e-3, hw);
            const q = at(u, vc - 0.16 * e * e + pull * 0.1 * (1 - e));
            if (j) c.lineTo(q.x, q.y); else c.moveTo(q.x, q.y);
          }
          c.stroke();
        }
        if (pull > 0) {
          c.lineWidth = 3;
          const a = at(0, -0.62), b = at(0, lerp(-0.62, 0.72, pull));
          c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
        }
        const wig = 0.1 * Math.sin((t - p.t0) / bp * Math.PI * 2);
        target = pull > 0 && pull < 1 ? at(0, lerp(-0.62, 0.72, pull)) : at(wig, 0.44 - (n - 1) * 0.12);
      }
    }
    c.restore();
    // 奶柱：從壺嘴到杯面（稍微往外拋一點的弧），拉花那一下之後收掉
    const pouring = t >= p.t0 - 0.03 && t < p.pull + bp * 0.34;
    if (pouring && target && spout) {
      const mid = { x: lerp(spout.x, target.x, 0.35) + (target.x - spout.x) * 0.15, y: lerp(spout.y, target.y, 0.3) };
      c.save();
      c.lineCap = 'round';
      c.strokeStyle = rgba('sepia', 0.18);
      c.lineWidth = 7;
      c.beginPath(); c.moveTo(spout.x + 1.5, spout.y); c.quadraticCurveTo(mid.x + 1.5, mid.y, target.x + 1.5, target.y); c.stroke();
      c.strokeStyle = mixRgba('bone', 'cream', 0.3);
      c.lineWidth = 5;
      c.beginPath(); c.moveTo(spout.x, spout.y); c.quadraticCurveTo(mid.x, mid.y, target.x, target.y); c.stroke();
      c.restore();
    }
    // 拉好的那一刻：杯面一圈訊號色的短線（很快淡掉）
    const d = t - p.pull - bp * 0.3;
    if (d > 0 && d < 0.3) {
      const q = 1 - d / 0.3, sg = LIN.signal;
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + 0.3;
        const r0 = r * (1.12 + 0.35 * (1 - q)), r1 = r0 + 16 * q;
        this.glow.seg2(cup.x + Math.cos(a) * r0, cup.y + Math.sin(a) * r0 * k, cup.x + Math.cos(a) * r1, cup.y + Math.sin(a) * r1 * k, 2.5, [sg[0] * 2.2, sg[1] * 2.2, sg[2] * 2.2], q);
      }
    }
    // 熱氣：拉好之後兩三條淡淡的曲線往上飄
    if (t > p.pull) {
      const ink = inkFor(true);
      const a0 = prog(t, p.pull, p.pull + 0.8);
      for (let j = 0; j < 3; j++) {
        const u = ((t * 0.45 + j / 3 + who * 0.17) % 1);
        const x0 = cup.x - 34 + j * 34, y0 = cup.y - 24 - u * 130;
        inkPath(c, [{ x: x0, y: y0 + 40 }, { x: x0 + 10 * Math.sin(t * 2 + j), y: y0 + 20 }, { x: x0 - 8, y: y0 }], { ink, t, w: 0.5, color: rgba('sepia', 0.3 * a0 * Math.sin(Math.PI * u)), seed: 40 + j + who * 5 });
      }
    }
  }

  /** 牆上的歌詞：小小的 NOW BREWING ＋ 正在唱的一行（跟唱）。間奏與純音樂時寫一行淡淡的「（間奏：慢慢拉花）」。 */
  private drawLyrics(c: CanvasRenderingContext2D, t: number) {
    const ly = lyricAt(this.ctx.lyrics, t);
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.6);
    c.font = font(F.mono(500), 16);
    c.letterSpacing = '6px';
    c.fillStyle = rgba('sepia', 0.45);
    c.fillText('NOW BREWING', WALL.x, WALL.y);
    c.letterSpacing = '0px';
    if (ly) {
      const big = !this.msg;
      const st = { family: F.archivo(100, big ? 800 : 700), size: this.lyricSize, minSize: 40, maxWidth: WALL.w, unsung: rgba('sepia', 0.24), sung: rgba('sepia', big ? 0.94 : 0.82), active: rgba('signal') };
      const lay = layoutLyric(c, ly.line, st);
      c.translate(WALL.x, WALL.y + 28 + lay.size * 0.84);
      drawLyric(c, ly.line, t, st, lay, ly.k);
    } else {
      c.font = font(F.hand(400), 42);
      c.fillStyle = rgba('sepia', 0.42);
      c.fillText('（間奏：慢慢拉花）', WALL.x, WALL.y + 72);
    }
    c.restore();
  }

  /** 黑板上的粉筆字留言：第一拍起逐字寫上去，寫完署名淡入；在板面上垂直置中。 */
  private drawMessage(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const B = this.board;
    const top = B.y + PAD.top, h = B.h - PAD.top - PAD.bottom;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.15, this.ctx.start + 0.55);
    writeNote(c, n, B.x + PAD.x, top + Math.max(0, (h - n.height) * 0.45), t, this.noteT0, {
      msg: !!this.msg, color: rgba('bone', 0.95), faint: rgba('bone', 0.62), sig: rgba('bone', 0.72),
    });
    c.restore();
  }
}
