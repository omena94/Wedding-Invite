// 曬衣服（亮、home）：頂樓陽台的晴天，一條拉繩式的曬衣繩橫過畫面上方。角色是 Codex 畫的紙偶（_puppet.ts），衣服、繩子、床單用程式畫。
//  - 一件一件接力、落在拍點：宣文從洗衣籃（芃芃坐在裡面）拿起一件（拍點前半）→ 拍點上舉起來遞給孟庭 → 孟庭接過、舉高，
//    **下一個拍點夾上繩子**（夾上去那一下衣服彈一下）→ 整條繩子往左送一格，空出下一個位子。快歌兩拍一件、慢歌一拍一件。
//    衣服有宣文的白 T、牛仔褲、孟庭的淺藍襯衫、條紋襪、毛巾、狗狗的小毛衣……窗格一開始繩子上已經掛了幾件。
//  - 風：每個小節線吹一陣，繩上的衣服一起擺、床單鼓起來、雲往左飄；平常輕輕晃。
//  - 歌詞沿著曬衣繩排在繩子上方（lyricOnPath），照跟唱規則逐字亮；比留言小一級（標準 v2：40～52）。
//  - **焦點是主打留言**：寫在左邊另一條繩子上曬的白床單上（深墨手寫字、署名），標準 v2：字 40～60、床單最大 680 × 370，
//    高度跟著留言長短；床單只有下緣隨風擺，字的地方保持平整。沒有留言時床單寫邀請、字淡。
//  - QQ 在前景咬著一隻條紋襪甩（拍點上甩一下、每小節跳一下）。鏡頭：整個窗格慢慢推近床單。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { loadText, F } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { lyricAt, beatAfter } from './_motifs';
import { inkFor, inkLine, inkPath, inkPoly, inkRect, inkEllipse, paperBG, lyricOnPath, type Pt, type Note, type Ink } from './_couple';
import { loadPuppets, drawPuppet, drawPick, puppetPoint, puppetShadow, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { INVITE, enterPuppet, writeNote } from './_c5';

export const spec: PlateSpecDecl = { group: 'couple', family: 'home', paper: true, energy: [0.25, 1], bars: [4, 8] };

const GROUND = 940;
const SZ = 700;
/** 宣文（面向右）與孟庭（面向左）面對面，洗衣籃（芃芃）在兩人中間；QQ 在左前景。 */
const AL_X = 470, OM_X = 900;
const QQ_X = 190, QQ_Y = 1030, DOG_S = 1.1;
/** 籃子比兩人的腳往前（往鏡頭）一點。 */
const BASKET_DY = 34;
/** 拉繩的滑輪柱（左）；繩子從柱頂往右拉出畫面，中間微微下垂。衣服一格的間距。 */
const POLE_X = 120, SLOT = 176;
/** 床單：右邊另一條繩子（兩根柱子）上曬著；最大範圍（標準 v2）與寫字的內距。下緣離右下角 HUD 遠遠的。 */
const SHEET = { x: 1150, y: 440, w: 660, h: 360 };
const PAD = { x: 44, top: 54, bottom: 50 };
const POSES = ['xw_laundry_pick', 'xw_laundry_hand', 'mt_laundry_reach', 'mt_laundry_ready', 'qq_laundry_sock', 'pp_laundry_basket'];

/** 衣服的種類（程式畫）：宣文的白 T、牛仔褲、淺藍襯衫、條紋襪、毛巾、狗狗的小毛衣、格紋洋裝。
 *  （拿掉了枕頭套：一塊白色的方塊拿在手上看不出是衣服。每一件都要一眼看得出是什麼：有袖子、褲管、條紋、顏色。） */
const KINDS = ['tee', 'jeans', 'shirt', 'socks', 'towel', 'sweater', 'dress'] as const;
type Kind = (typeof KINDS)[number];

interface Item { kind: Kind; t: number; pin: number; seed: number }

export default class Laundry extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(512, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  /** 一件一拍（或兩拍）：t = 宣文舉起來遞出去（拍點）、pin = 孟庭夾上繩子（下一個拍點）。 */
  items: Item[] = [];
  /** 開場前就掛好的幾件（夾的時間當成很久以前）。 */
  pre: Item[] = [];
  alanKeys: [number, string][] = [];
  omKeys: [number, string][] = [];
  /** 衣服在手上的四個點：宣文彎腰拿（籃子裡）、宣文舉起來、孟庭接住、孟庭舉高（= 繩子上夾的地方）。 */
  hand = { pick: { x: 0, y: 0 }, up: { x: 0, y: 0 }, recv: { x: 0, y: 0 }, pin: { x: 0, y: 0 } };
  ropeY = 250;
  /** 洗衣籃（芃芃）的位置：籃子裡那疊衣服對齊宣文彎腰拿的手。 */
  basketX = 1040;
  per = 1;
  gusts: number[] = [];
  note: Note | null = null;
  sheet = { ...SHEET };
  noteT0 = 0;
  lyricSize = 52;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start;
    await loadText('一位賓客' + INVITE);
    this.track(await loadPuppets(POSES));
    // 手上的點（沒有量到的話用身體比例估）
    const om: PuppetOpts = { h: SZ, flip: true }, al: PuppetOpts = { h: SZ };
    this.hand.pick = puppetPoint('xw_laundry_pick', 'hands', AL_X, GROUND, al) ?? { x: AL_X + 130, y: GROUND - 150 };
    this.hand.up = puppetPoint('xw_laundry_hand', 'hands', AL_X, GROUND, al) ?? { x: AL_X + 150, y: GROUND - 420 };
    this.hand.recv = puppetPoint('mt_laundry_ready', 'hands', OM_X, GROUND, om) ?? { x: OM_X - 130, y: GROUND - 380 };
    this.hand.pin = puppetPoint('mt_laundry_reach', 'pin', OM_X, GROUND, om) ?? { x: OM_X - 70, y: GROUND - 640 };
    this.ropeY = this.hand.pin.y - this.sag(this.hand.pin.x);
    const cl = puppetPoint('pp_laundry_basket', 'clothes', 0, GROUND + BASKET_DY, { h: SZ });
    this.basketX = this.hand.pick.x - (cl?.x ?? 60);
    // 快歌兩拍一件、慢歌一拍一件
    const bpm = 60 / au.beatPeriod(s + 1);
    this.per = bpm > 108 ? 2 : 1;
    let b = Math.ceil(au.beatAt(beatAfter(au, s + 0.55)) - 1e-6);
    for (let k = 0; k < 120; k++, b += this.per) {
      const t = au.timeOfBeat(b);
      if (t > this.ctx.end + 0.5) break;
      this.items.push({ kind: KINDS[(k + 1) % KINDS.length]!, t, pin: au.timeOfBeat(b + this.per), seed: k });
    }
    for (let k = 1; k <= 7; k++) this.pre.push({ kind: KINDS[(8 - k + 3) % KINDS.length]!, t: -1e9, pin: -1e9, seed: 100 + k });
    // 姿勢時間軸：宣文拍點前半彎腰拿、拍點上舉起來；孟庭接住、半拍（或一拍）後舉高、下一個拍點夾上去
    this.alanKeys = [[-1e9, 'xw_laundry_hand']];
    this.omKeys = [[-1e9, 'mt_laundry_ready']];
    for (const it of this.items) {
      const half = (it.pin - it.t) / 2;
      this.alanKeys.push([it.t - half, 'xw_laundry_pick'], [it.t, 'xw_laundry_hand']);
      this.omKeys.push([it.t + half, 'mt_laundry_reach'], [it.pin, 'mt_laundry_ready']);
    }
    // 每個小節線一陣風
    for (let bar = Math.ceil(au.barAt(s) - 1e-6), k = 0; k < 40; k++, bar++) { const t = au.timeOfBar(bar); if (t > this.ctx.end) break; this.gusts.push(t); }
    // 床單上的留言：標準 v2 的字級；床單的寬高跟著留言（上緣夾在繩子上）
    const c = this.fg.ctx;
    const w = SHEET.w - PAD.x * 2, hmax = SHEET.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const sw = Math.min(SHEET.w, tightenNote(c, this.note, 380) + PAD.x * 2);
    this.sheet = { x: SHEET.x + (SHEET.w - sw) / 2, y: SHEET.y, w: sw, h: Math.min(SHEET.h, Math.max(250, PAD.top + this.note.height + PAD.bottom + 10)) };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.noteT0 = Math.min(this.items[0]?.t ?? s + 0.8, s + 0.9);
    this.drawBackground();
  }

  /** 曬衣繩的下垂量（x 越往中間越低）。 */
  private sag(x: number) { return 26 * Math.sin(Math.PI * clamp((x - POLE_X) / (W + 120 - POLE_X))); }
  private ropeAt(x: number) { return this.ropeY + this.sag(x); }

  /** 不會動的：遠處的屋頂與水塔（很淡）、女兒牆、地磚、床單的兩根柱子與繩子、滑輪柱。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx, ink = inkFor(true);
    L.clear();
    const faint = inkFor(true, { line: rgba('sepia', 0.3) });
    // 遠處的屋頂線：一排高高低低的頂樓加蓋與水塔
    const wall = 706;
    let x = 30;
    const sky: Pt[] = [{ x: 0, y: wall }];
    for (let k = 0; x < W; k++) {
      const w = 90 + hash(k, 1) * 140, h = 40 + hash(k, 2) * 110;
      sky.push({ x, y: wall - h }, { x: x + w, y: wall - h });
      // 頂樓的水塔：圓柱＋四隻腳
      if (hash(k, 3) > 0.62) {
        const tx = x + w * 0.5, ty = wall - h - 18;
        inkRect(c, tx - 20, ty - 30, 40, 30, { ink: faint, w: 0.6, seed: k, r: 6 });
        inkLine(c, [{ x: tx - 16, y: ty }, { x: tx - 18, y: wall - h }], { ink: faint, w: 0.5, seed: k + 1 });
        inkLine(c, [{ x: tx + 16, y: ty }, { x: tx + 18, y: wall - h }], { ink: faint, w: 0.5, seed: k + 2 });
      }
      x += w;
    }
    sky.push({ x: W, y: wall });
    inkLine(c, sky, { ink: faint, w: 0.6, seed: 2, taper: 0.02 });
    // 女兒牆（前面一道矮牆）與地磚
    c.fillStyle = mixRgba('paper', 'sepia', 0.05);
    c.fillRect(0, wall, W, 64);
    inkLine(c, [{ x: 0, y: wall }, { x: W, y: wall + 2 }], { ink, w: 0.9, seed: 3 });
    inkLine(c, [{ x: 0, y: wall + 64 }, { x: W, y: wall + 64 }], { ink, w: 0.7, seed: 4 });
    c.save();
    c.strokeStyle = rgba('sepia', 0.1);
    c.lineWidth = 1.2;
    c.beginPath();
    for (let y = wall + 64 + 36, k = 0; y < H; k++, y += 36 + k * 8) { c.moveTo(0, y); c.lineTo(W, y); }
    for (let i = -12; i <= 12; i++) { const x0 = W / 2 + i * 60, x1 = W / 2 + i * 190; c.moveTo(x0, wall + 64); c.lineTo(x1, H); }
    c.stroke();
    c.restore();
    // 床單的兩根柱子與繩子
    const S = this.sheet, top = SHEET.y - 4;
    for (const px of [S.x - 22, S.x + S.w + 22]) inkPoly(c, [{ x: px - 6, y: top - 20 }, { x: px + 6, y: top - 20 }, { x: px + 7, y: 812 }, { x: px - 7, y: 812 }], { ink, fill: mixRgba('paper', 'fur', 0.3), w: 0.8, seed: px });
    inkPath(c, [{ x: S.x - 22, y: top - 12 }, { x: S.x + S.w / 2, y: top }, { x: S.x + S.w + 22, y: top - 12 }], { ink, w: 0.6, seed: 5 });
    // 滑輪柱：從地上到繩子，頂上一個小滑輪
    const py = this.ropeAt(POLE_X);
    inkPoly(c, [{ x: POLE_X - 6, y: py - 18 }, { x: POLE_X + 6, y: py - 18 }, { x: POLE_X + 8, y: GROUND - 60 }, { x: POLE_X - 8, y: GROUND - 60 }], { ink, fill: mixRgba('paper', 'sepia', 0.12), w: 0.8, seed: 6 });
    inkEllipse(c, POLE_X, py, 14, 14, 0, { ink, fill: rgba('paper'), w: 0.8, seed: 7 });
    L.upload();
  }

  /** 風：平常輕輕晃，小節線上一陣（0..1）。 */
  private wind(t: number) {
    let g = 0;
    for (const t0 of this.gusts) { const d = t - t0; if (d >= 0 && d < 1.6) g = Math.max(g, Math.sin(Math.PI * Math.min(1, d / 0.35)) * Math.exp(-d / 0.7)); }
    return g;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.paper.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const ink = inkFor(true);
    const gust = this.wind(t);

    this.drawClouds(c, t);
    // ---- 曬衣繩＋歌詞（在繩子上方）
    const rope: Pt[] = [];
    for (let i = 0; i <= 40; i++) { const x = lerp(POLE_X, W + 40, i / 40); rope.push({ x, y: this.ropeAt(x) + gust * 5 * Math.sin(Math.PI * i / 40) }); }
    inkPath(c, rope, { ink, w: 0.7, seed: 9 });
    const ly = lyricAt(lyrics, t);
    if (ly) lyricOnPath(c, ly.line, t, rope.slice(4, 37), { family: F.archivo(100, this.msg ? 600 : 700), size: this.lyricSize, minSize: 40, offset: 30, alpha: ly.k * prog(t, s, s + 0.5), unsung: rgba('sepia', 0.24), sung: rgba('sepia', this.msg ? 0.8 : 0.94), active: rgba('signal') });
    // ---- 繩上的衣服（往右送）
    const shift = this.shiftAt(t);
    for (const it of [...this.pre, ...this.items]) {
      if (t < it.pin) continue;
      const n = shift - this.shiftAt(it.pin) + (it.t < -1e8 ? this.pre.indexOf(it) + 1 : 0);
      const x = this.hand.pin.x + SLOT * n;
      if (x > W + 160) continue;
      const bounce = Math.exp(-Math.max(0, t - it.pin) / 0.12) * (t >= it.pin ? 1 : 0);
      const sw = 0.05 * Math.sin(t * 1.9 + it.seed) + gust * (0.16 + 0.06 * hash(it.seed, 1)) + 0.1 * bounce;
      this.garment(c, ink, it.kind, x, this.ropeAt(x) + gust * 4, sw, 1 - 0.12 * bounce, t, true);
    }
    this.drawSheet(c, t, gust, ink);

    // ---- 人（影子先畫）、籃子裡的芃芃、手上的衣服、前景的 QQ
    this.drawPeople(c, t);
    this.inHands(c, ink, t);
    this.drawBasket(c, t);
    this.drawQQ(c, t);

    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：慢慢推近床單（最多 1.03 倍）
    const push = ease.inOutCubic(f.p), S = this.sheet;
    const fx = lerp(W / 2, S.x + S.w / 2, 0.5), fy = lerp(H / 2, S.y + S.h / 2, 0.5);
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.22, grain: 0.045, ca: 0.5, zoom: 1 + 0.03 * push, shake: [-(fx - W / 2) * 0.03 * push, -(fy - H / 2) * 0.03 * push] };
  }

  /** 繩子往右送了幾格（每次夾好之後一格，0.3 拍內送完）。 */
  private shiftAt(t: number) {
    let n = 0;
    const bp = this.ctx.audio.beatPeriod(t);
    for (const it of this.items) { if (t < it.pin) break; n += ease.inOutCubic(clamp((t - it.pin - 0.04) / (bp * 0.32 * this.per))); }
    return n;
  }

  /** 淡淡的幾朵雲，往左飄；風一吹快一點。 */
  private drawClouds(c: CanvasRenderingContext2D, t: number) {
    const faint = inkFor(true, { line: rgba('sepia', 0.22) });
    for (let k = 0; k < 3; k++) {
      const x = ((1500 + k * 700 - (t - this.ctx.start) * 18 - k * 90) % 2300 + 2300) % 2300 - 200, y = 120 + k * 52 + (k === 1 ? 40 : 0);
      inkPath(c, [{ x, y: y + 30 }, { x: x + 30, y: y + 4 }, { x: x + 80, y: y + 6 }, { x: x + 110, y: y - 18 }, { x: x + 170, y: y + 2 }, { x: x + 210, y: y + 30 }], { ink: faint, w: 0.6, seed: 20 + k });
    }
  }

  /**
   * 一件衣服：(x, y) 是上緣中間（夾子的位置），rot 隨風擺（繞上緣轉），sy 夾上去那一下往上縮再彈回來。
   * pinned：繩子上的有兩個木夾子；手上拿著的沒有。
   */
  private garment(c: CanvasRenderingContext2D, ink: Ink, kind: Kind, x: number, y: number, rot: number, sy: number, t: number, pinned: boolean) {
    c.save();
    c.translate(x, y);
    c.rotate(rot);
    c.scale(1, sy);
    const o = { ink, t, w: 0.8, seed: KINDS.indexOf(kind) * 7 + 1 };
    let half = 50;
    switch (kind) {
      case 'tee': {
        // 宣文的白 T：黑領口、袖口黑邊、左胸小蝴蝶結（小小一點）
        half = 58;
        const p: Pt[] = [{ x: -26, y: 0 }, { x: -58, y: 10 }, { x: -76, y: 40 }, { x: -56, y: 54 }, { x: -44, y: 38 }, { x: -44, y: 122 }, { x: 44, y: 122 }, { x: 44, y: 38 }, { x: 56, y: 54 }, { x: 76, y: 40 }, { x: 58, y: 10 }, { x: 26, y: 0 }, { x: 0, y: 12 }];
        inkPoly(c, p, { ...o, fill: rgba('bone') });
        inkPath(c, [{ x: -26, y: 0 }, { x: 0, y: 13 }, { x: 26, y: 0 }], { ...o, w: 1.6, color: rgba('ink', 0.85) });
        inkLine(c, [{ x: -74, y: 42 }, { x: -57, y: 53 }], { ...o, w: 1.4, color: rgba('ink', 0.85) });
        inkLine(c, [{ x: 74, y: 42 }, { x: 57, y: 53 }], { ...o, w: 1.4, color: rgba('ink', 0.85) });
        break;
      }
      case 'jeans': {
        half = 46;
        inkPoly(c, [{ x: -46, y: 0 }, { x: 46, y: 0 }, { x: 52, y: 150 }, { x: 10, y: 150 }, { x: 2, y: 44 }, { x: -8, y: 150 }, { x: -50, y: 150 }], { ...o, fill: rgba('denim') });
        inkLine(c, [{ x: -44, y: 14 }, { x: 44, y: 14 }], { ...o, w: 0.5, color: rgba('ink', 0.35) });
        break;
      }
      case 'shirt': {
        // 孟庭綁在腰上的那件淺藍襯衫（長袖、前襟一排扣子）
        half = 56;
        inkPoly(c, [{ x: -22, y: 0 }, { x: -56, y: 8 }, { x: -70, y: 110 }, { x: -54, y: 112 }, { x: -44, y: 40 }, { x: -44, y: 130 }, { x: 44, y: 130 }, { x: 44, y: 40 }, { x: 54, y: 112 }, { x: 70, y: 110 }, { x: 56, y: 8 }, { x: 22, y: 0 }, { x: 0, y: 18 }], { ...o, fill: rgba('shirtblue') });
        inkLine(c, [{ x: 0, y: 18 }, { x: 0, y: 128 }], { ...o, w: 0.5 });
        for (let k = 0; k < 4; k++) inkEllipse(c, 6, 36 + k * 24, 2.4, 2.4, 0, { ...o, w: 0.4, fill: rgba('bone') });
        break;
      }
      case 'socks': {
        half = 40;
        for (const dx of [-24, 24]) {
          inkPoly(c, [{ x: dx - 12, y: 0 }, { x: dx + 12, y: 0 }, { x: dx + 12, y: 70 }, { x: dx + 26, y: 86 }, { x: dx + 16, y: 98 }, { x: dx - 12, y: 82 }], { ...o, fill: rgba('bone'), seed: o.seed + dx });
          for (const yy of [12, 22]) inkLine(c, [{ x: dx - 11, y: yy }, { x: dx + 11, y: yy }], { ...o, w: 1.3, color: rgba('leash') });
        }
        break;
      }
      case 'towel': {
        half = 48;
        inkPoly(c, [{ x: -48, y: 0 }, { x: 48, y: 0 }, { x: 46, y: 118 }, { x: -46, y: 120 }], { ...o, fill: mixRgba('paper', 'gingham', 0.45) });
        for (const yy of [92, 102]) inkLine(c, [{ x: -44, y: yy }, { x: 44, y: yy }], { ...o, w: 1.2, color: rgba('bone', 0.9) });
        break;
      }
      case 'sweater': {
        // 狗狗的小毛衣：短短的、四個袖口
        half = 34;
        inkPoly(c, [{ x: -34, y: 0 }, { x: 34, y: 0 }, { x: 30, y: 58 }, { x: 18, y: 58 }, { x: 14, y: 44 }, { x: -14, y: 44 }, { x: -18, y: 58 }, { x: -30, y: 58 }], { ...o, fill: mixRgba('fur', 'paper', 0.35) });
        for (const yy of [16, 28]) inkLine(c, [{ x: -32, y: yy }, { x: 32, y: yy }], { ...o, w: 0.6, color: rgba('sepia', 0.4) });
        break;
      }
      case 'dress': {
        half = 30;
        inkPoly(c, [{ x: -18, y: 0 }, { x: -14, y: 0 }, { x: -24, y: 40 }, { x: -60, y: 140 }, { x: 60, y: 140 }, { x: 24, y: 40 }, { x: 14, y: 0 }, { x: 18, y: 0 }, { x: 22, y: 30 }, { x: -22, y: 30 }], { ...o, fill: rgba('gingham') });
        c.strokeStyle = rgba('bone', 0.35);
        c.lineWidth = 2;
        c.beginPath();
        for (let yy = 50; yy < 140; yy += 16) { c.moveTo(-60, yy); c.lineTo(60, yy); }
        c.stroke();
        break;
      }
    }
    // 木頭夾子
    if (pinned) for (const dx of [-half + 8, half - 8]) inkRect(c, dx - 4, -12, 8, 22, { ink, w: 0.6, fill: mixRgba('paper', 'fur', 0.5), seed: dx, r: 2 });
    c.restore();
  }

  /** 床單：上緣四個夾子夾在繩子上，布面平整（字在這裡）、只有下緣隨風擺；幾條淡淡的直皺褶跟著風移動。 */
  private drawSheet(c: CanvasRenderingContext2D, t: number, gust: number, ink: Ink) {
    const S = this.sheet;
    const edge: Pt[] = [];
    for (let i = 0; i <= 24; i++) {
      const u = i / 24;
      edge.push({ x: S.x + S.w * u + gust * 10 * u, y: S.y + S.h + 8 * Math.sin(u * 7 + t * 2.2) * (0.4 + gust) });
    }
    const outline: Pt[] = [{ x: S.x, y: S.y }, { x: S.x + S.w, y: S.y }, ...edge.slice().reverse()];
    c.save();
    c.fillStyle = rgba('sepia', 0.08);
    c.beginPath(); outline.forEach((q, i) => (i ? c.lineTo(q.x + 10, q.y + 14) : c.moveTo(q.x + 10, q.y + 14))); c.closePath(); c.fill();
    inkPoly(c, outline, { ink, fill: mixRgba('bone', 'paper', 0.25), w: 0.8, seed: 31 });
    // 直皺褶：從上緣的夾子之間垂下來，下半部比較明顯
    c.beginPath(); outline.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y))); c.closePath(); c.clip();
    for (let k = 1; k < 4; k++) {
      const x0 = S.x + (S.w * k) / 4 + gust * 14 * Math.sin(t + k);
      const g = c.createLinearGradient(0, S.y, 0, S.y + S.h);
      g.addColorStop(0, rgba('sepia', 0)); g.addColorStop(0.55, rgba('sepia', 0.04)); g.addColorStop(1, rgba('sepia', 0.1 + 0.06 * gust));
      c.fillStyle = g;
      c.fillRect(x0 - 10, S.y, 20, S.h + 20);
    }
    c.restore();
    for (let k = 0; k < 4; k++) { const px = S.x + 20 + (k * (S.w - 40)) / 3; inkRect(c, px - 4, S.y - 14, 8, 24, { ink, w: 0.6, fill: mixRgba('paper', 'fur', 0.5), seed: 40 + k, r: 2 }); }
    // 留言：第一拍起逐字寫上去，寫完署名淡入
    const n = this.note;
    if (!n) return;
    const top = S.y + PAD.top, h = S.h - PAD.top - PAD.bottom;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.15, this.ctx.start + 0.55);
    writeNote(c, n, S.x + PAD.x, top + Math.max(0, (h - n.height) * 0.45), t, this.noteT0, { msg: !!this.msg, color: rgba('sepia', 0.95), faint: rgba('sepia', 0.62), sig: rgba('sepia', 0.74) });
    c.restore();
  }

  /** 兩個人與籃子裡的芃芃：影子、姿勢時間軸、每拍輕輕點頭；孟庭夾上去那一下踮腳往上一送。 */
  private drawPeople(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const nod = beatKick(au, t, 0.26);
    const enO = enterPuppet(this.glow, t, this.ctx.start + 0.05, OM_X, GROUND - 6, 1);
    if (enO) {
      let lift = 0;
      for (const it of this.items) { const d = t - it.pin; if (d > -0.12 && d < 0.3) lift = Math.max(lift, 8 * Math.sin(Math.PI * clamp((d + 0.12) / 0.42))); }
      puppetShadow(c, 'mt', OM_X, GROUND, { h: SZ, lift, alpha: 0.3 * enO.alpha, color: '70,45,25' });
      drawPick(c, this.omKeys, t, OM_X, GROUND - lift, { h: SZ, flip: true, pivot: 0.2, squash: 0.012 * nod + breathe(t, 0.008, 3.1, 0.3), spin: enO.spin, alpha: enO.alpha });
    }
    const enA = enterPuppet(this.glow, t, this.ctx.start + 0.15, AL_X, GROUND - 6, 2);
    if (enA) {
      puppetShadow(c, 'xw', AL_X, GROUND, { h: SZ, alpha: 0.3 * enA.alpha, color: '70,45,25' });
      drawPick(c, this.alanKeys, t, AL_X, GROUND, { h: SZ, pivot: 0.2, squash: 0.012 * nod + breathe(t, 0.008, 3.4), spin: enA.spin, alpha: enA.alpha });
    }
  }

  /**
   * 籃子（芃芃坐在裡面）：在宣文腳前面一點（離鏡頭近一點），籃子裡那疊衣服就在他彎腰拿的手下面。
   * 畫在手上那件衣服的後面：衣服從芃芃背後的籃子裡被拎出來，不會蓋住芃芃的臉。
   */
  private drawBasket(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const nod = beatKick(au, t, 0.26);
    const bx = this.basketX, by = GROUND + BASKET_DY;
    const enP = enterPuppet(this.glow, t, this.ctx.start + 0.26, bx, by - 6, 3);
    if (enP) {
      puppetShadow(c, 'pp', bx, by, { h: SZ, alpha: 0.3 * enP.alpha, color: '70,45,25', wide: 1.2 });
      drawPuppet(c, 'pp_laundry_basket', bx, by, { h: SZ, rot: 0.04 * Math.sin(au.beatAt(t) * Math.PI), pivot: 0.2, squash: 0.03 * nod, spin: enP.spin, alpha: enP.alpha });
    }
  }

  /** 手上的那一件：拍點前半在籃子上（宣文彎腰拿）→ 拍點上舉起來 → 丟給孟庭（小弧線）→ 孟庭舉高 → 下一個拍點夾上繩子。 */
  private inHands(c: CanvasRenderingContext2D, ink: Ink, t: number) {
    const H0 = this.hand;
    for (const it of this.items) {
      const half = (it.pin - it.t) / 2;
      if (t < it.t - half + 0.04 || t >= it.pin) continue;
      let p: Pt, sc = 1;
      if (t < it.t) { p = H0.pick; sc = prog(t, it.t - half + 0.04, it.t - half + 0.2, ease.outBack); }
      else if (t < it.t + half) {
        // 舉起來 → 小小拋給孟庭
        const u = prog(t, it.t + half * 0.15, it.t + half * 0.75, ease.inOutCubic);
        p = { x: lerp(H0.up.x, H0.recv.x, u), y: lerp(H0.up.y, H0.recv.y, u) - 60 * Math.sin(Math.PI * u) };
      } else p = H0.pin;
      this.garment(c, ink, it.kind, p.x, p.y, 0.04 * Math.sin(t * 6 + it.seed), sc, t, false);
    }
  }

  /** QQ（前景）：咬著條紋襪甩——拍點上甩一下（轉一下），每小節跳一下。 */
  private drawQQ(c: CanvasRenderingContext2D, t: number) {
    const en = enterPuppet(this.glow, t, this.ctx.start + 0.32, QQ_X, QQ_Y - 6, 4);
    if (!en) return;
    const au = this.ctx.audio;
    const k = beatKick(au, t, 0.3);
    const bar = au.barAt(t), ph = bar - Math.floor(bar);
    const lift = ph < 0.2 ? 26 * Math.sin(Math.PI * ph / 0.2) : 0;
    puppetShadow(c, 'qq', QQ_X, QQ_Y, { h: SZ * DOG_S, lift, alpha: 0.32 * en.alpha, color: '70,45,25' });
    drawPuppet(c, 'qq_laundry_sock', QQ_X, QQ_Y - lift, { h: SZ, scale: DOG_S, rot: 0.09 * k * (Math.floor(au.beatAt(t)) % 2 ? 1 : -1), pivot: 0.4, squash: 0.04 * k, spin: en.spin, alpha: en.alpha });
  }
}
