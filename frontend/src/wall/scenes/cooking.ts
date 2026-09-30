// 一起做菜（亮、home）：廚房的側面。孟庭在爐子前甩鍋，宣文在中島另一邊端著盤子等，三隻狗（QQ、元元、芃芃）在孟庭身後排排坐討吃的。
// 角色是 Codex 畫的紙偶（_puppet.ts）。2026-09-30 新人加了第三隻狗元元（白色柴犬）：「有狗的畫，三隻狗都要一起」。
//  - 甩鍋落在拍點：每兩拍一次（大鼓通常在 1、3 拍）。拍點前壓低往後帶（wok_1）→ 拍點上換成鍋子往上甩、菜飛在空中的那張（wok_2），
//    整個人往上一送 → 下一次甩之前收回（wok_1）。每兩小節有一塊菜「飛出去」越過孟庭的頭，輪到的那隻狗在拍點上咬住（嘴邊冒一顆小愛心）：
//    QQ、芃芃要整隻跳起來；元元個子高，坐著往上一蹬、身體拉長就咬到（穩重的大狗，頭也不會碰到冰箱上的便條）。三隻坐著時跟著拍子點頭，相位錯開。
//  - 中島與爐口的位置照 wok_1 圖上鍋子的位置擺（鍋子剛好坐在爐火上）；爐火大鼓時竄高、鍋子冒蒸氣。
//  - 歌詞像食譜的步驟：直接寫在爐子上方的牆上，旁邊一個小小的「STEP 0N」（每換一行加一），比留言小一級（標準 v2：40～52）。
//  - **焦點是主打留言**：寫在冰箱門上的便條（膠帶貼著、稍微歪、有影子），深墨手寫字；照「留言尺寸與版面比例標準 v2」：
//    字 40～60、便條最大 480 × 400，放在畫面左側，高度跟著留言長短。沒有留言時便條寫邀請、字淡，歌詞變主角。
//  - 宣文每拍輕輕點頭，甩鍋時盤子往前遞一點。鏡頭：整個窗格慢慢推近冰箱上的便條。
//  - 開場：紙偶從側面翻正進場（仙女棒的火花在腳邊）；紙底、墨色線。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, hash } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, beatAfter, sparkHead, sparkParticles, msgChars } from './_motifs';
import { inkFor, inkLine, inkPath, inkShape, inkPoly, inkRect, inkEllipse, hatch, paperBG, arcAt, drawNote, type Pt, type Ink, type Note } from './_couple';
import { loadPuppets, drawPuppet, drawPick, puppetPoint, puppetShadow, puppetIn, jumpArc, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'couple', family: 'home', paper: true, energy: [0.3, 1], bars: [4, 8] };

const FLOOR = 880;
const SZ = 420;
const OM_X = 800, AL_X = 1290;
/** 狗在這個版面放大一點（遠處的桌子也要認得出是哪一隻）；三隻用同一個倍數，比例照 dogs3-lineup.png。 */
const DOG_S = 1.2;
/** 三隻狗排在孟庭身後、冰箱前面（便條下面）：x、咬菜時跳多高、點頭的相位、進場的先後。接菜的順序照這個陣列輪流。 */
const DOGS = [
  { d: 'qq', x: 700, jump: 70, phase: 0, delay: 0.26 },
  { d: 'yy', x: 560, jump: 24, phase: 0.33, delay: 0.3 },
  { d: 'pp', x: 420, jump: 64, phase: 0.66, delay: 0.34 },
] as const;
type Dog = (typeof DOGS)[number]['d'];
/** 元元咬菜時身體拉長多少（squash < 0 = 拉長）：個子高，不用跳，伸長脖子就咬到。 */
const YY_STRETCH = -0.1;
const FRIDGE = { x: 96, y: 170, w: 548, h: FLOOR - 170 };
/** 冰箱門上的便條：最大的範圍（標準 v2；上緣貼膠帶的位置固定、高度跟著留言）與寫字的內距。 */
const NOTE = { x: 130, y: 236, w: 480, h: 400, rot: -0.018 };
const PAD = { x: 30, top: 36, bottom: 24 };
/** 牆上寫歌詞（食譜步驟）的範圍：爐子上方，沒有框。 */
const WALL = { x: 790, y: 160, w: 560 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const SPRITES = ['mt_wok_1', 'mt_wok_2', 'xw_plate', 'qq_beg', 'qq_jump', 'yy_beg', 'yy_jump', 'pp_beg', 'pp_jump'];

/** 一次甩鍋；escape = 這一次有一塊菜飛出去，catcher = 哪一隻狗咬。 */
interface Toss { t: number; back: number; escape: boolean; catcher: number }

export default class Cooking extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  tosses: Toss[] = [];
  keys: [number, string][] = [];
  note: Note | null = null;
  sheet = { ...NOTE };
  /** 鍋子（wok_1 靜止時、wok_2 甩起來時）與每隻狗跳到最高時嘴的位置。 */
  wokLow: Pt = { x: 0, y: 0 };
  wokHigh: Pt = { x: 0, y: 0 };
  mouths: Pt[] = [];
  island = { x: 930, w: 230, top: 700 };
  lyricSize = 52;

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('一位賓客（間奏：小火慢炒）' + INVITE);
    this.track(await loadPuppets(SPRITES));
    // 甩鍋：開場進場後的第一拍起，每兩拍一次；每四次（兩小節）有一塊菜飛出去，三隻狗輪流咬
    let b = Math.ceil(au.beatAt(beatAfter(au, this.ctx.start + 0.7)) - 1e-6);
    for (let k = 0; k < 80; k++) {
      const t = au.timeOfBeat(b);
      if (t > this.ctx.end + 1) break;
      const escape = k % 4 === 3;
      this.tosses.push({ t, back: au.timeOfBeat(b + 1.1), escape, catcher: escape ? Math.floor(k / 4) % DOGS.length : -1 });
      b += 2;
    }
    // 孟庭的姿勢時間軸：拍點上甩（wok_2）、一拍多一點之後收回（wok_1）
    this.keys = [[-1e9, 'mt_wok_1']];
    for (const ts of this.tosses) this.keys.push([ts.t, 'mt_wok_2'], [ts.back, 'mt_wok_1']);
    // 鍋子在哪：中島（爐口）照靜止時的鍋子擺，鍋底坐在爐火上
    this.wokLow = puppetPoint('mt_wok_1', 'wok', OM_X, FLOOR, { h: SZ })!;
    this.wokHigh = puppetPoint('mt_wok_2', 'wok', OM_X, FLOOR - 10, { h: SZ })!;
    this.island = { x: this.wokLow.x - 80, w: 270, top: this.wokLow.y + 22 };
    // 元元不跳：坐著往上一蹬、伸長身體（拉長）咬住，嘴的位置照坐姿算；兩隻博美照跳起來的圖算
    this.mouths = DOGS.map((g) => (g.d === 'yy'
      ? puppetPoint('yy_beg', 'mouth', g.x, FLOOR - g.jump, { h: SZ, scale: DOG_S, squash: YY_STRETCH })!
      : puppetPoint(`${g.d}_jump`, 'mouth', g.x, FLOOR - g.jump, { h: SZ, scale: DOG_S })!));
    // 冰箱上的便條：標準 v2 的字級；便條的寬高跟著留言（在冰箱門上置中）
    const c = this.fg.ctx;
    const w = NOTE.w - PAD.x * 2, hmax = NOTE.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const nw = Math.min(NOTE.w, tightenNote(c, this.note, 280) + PAD.x * 2);
    this.sheet = { ...NOTE, x: FRIDGE.x + FRIDGE.w / 2 - nw / 2, w: nw, h: Math.min(NOTE.h, Math.max(220, PAD.top + this.note.height + PAD.bottom + 16)) };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.drawBackground();
  }

  /** 不會動的：冰箱、中島、爐子、地板、冰箱上的便條（畫一次）。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx, ink = inkFor(true);
    L.clear();
    // 地板與牆腳
    inkLine(c, [{ x: 40, y: FLOOR }, { x: 1880, y: FLOOR }], { ink, w: 0.9, seed: 1 });
    c.strokeStyle = rgba('sepia', 0.18); c.lineWidth = 1.2; c.beginPath();
    for (let x = 60; x < 1880; x += 120) { c.moveTo(x, FLOOR + 2); c.lineTo(x - 40, FLOOR + 90); }
    c.moveTo(20, FLOOR + 44); c.lineTo(1900, FLOOR + 44); c.stroke();
    // 冰箱：雙門、把手、上面一條冷凍庫的線
    const F0 = FRIDGE;
    inkRect(c, F0.x, F0.y, F0.w, F0.h, { ink, fill: rgba('paper'), w: 1.1, seed: 3, r: 24 });
    inkLine(c, [{ x: F0.x + F0.w / 2, y: F0.y + 10 }, { x: F0.x + F0.w / 2 + 1, y: F0.y + F0.h - 6 }], { ink, w: 0.8, seed: 4 });
    for (const x of [F0.x + F0.w / 2 - 20, F0.x + F0.w / 2 + 20]) inkLine(c, [{ x, y: F0.y + 480 }, { x, y: F0.y + 600 }], { ink, w: 1.6, seed: x });
    hatch(c, [{ x: F0.x + F0.w - 60, y: F0.y + 20 }, { x: F0.x + F0.w - 10, y: F0.y + 20 }, { x: F0.x + F0.w - 10, y: F0.y + F0.h - 10 }, { x: F0.x + F0.w - 60, y: F0.y + F0.h - 10 }], { ink, gap: 10, angle: 1.2, color: rgba('sepia', 0.18), w: 0.35 });
    // 中島：檯面（厚一點）＋櫃門＋把手；爐口在孟庭那一側
    const I = this.island;
    inkRect(c, I.x, I.top + 14, I.w, FLOOR - I.top - 14, { ink, fill: rgba('paper'), w: 1, seed: 7, r: 3 });
    inkRect(c, I.x - 16, I.top, I.w + 32, 18, { ink, fill: rgba('paper'), w: 1.1, seed: 8, r: 4 });
    inkLine(c, [{ x: I.x + 24, y: I.top + 50 }, { x: I.x + I.w - 24, y: I.top + 50 }, { x: I.x + I.w - 24, y: FLOOR - 24 }, { x: I.x + 24, y: FLOOR - 24 }, { x: I.x + 24, y: I.top + 50 }], { ink, w: 0.6, seed: 9, taper: 0.1 });
    inkLine(c, [{ x: I.x + I.w / 2 - 22, y: I.top + 72 }, { x: I.x + I.w / 2 + 22, y: I.top + 72 }], { ink, w: 1.4, seed: 10 });
    // 爐子的旋鈕（櫃子側面）
    for (const dx of [40, 80]) inkEllipse(c, I.x + dx, I.top + 32, 7, 7, 0, { ink, w: 0.6, seed: dx });
    // 冰箱門上的便條（稍微歪、上緣一條膠帶、下緣翹起來一點點的影子）
    const N = this.sheet;
    c.save();
    c.translate(N.x + N.w / 2, N.y + N.h / 2);
    c.rotate(N.rot);
    c.translate(-N.w / 2, -N.h / 2);
    c.fillStyle = rgba('sepia', 0.1);
    c.beginPath(); c.moveTo(8, 10); c.lineTo(N.w + 8, 12); c.lineTo(N.w + 4, N.h + 12); c.lineTo(10, N.h + 8); c.closePath(); c.fill();
    inkPoly(c, [{ x: 0, y: 0 }, { x: N.w, y: 2 }, { x: N.w - 2, y: N.h }, { x: 3, y: N.h - 3 }], { ink, fill: rgba('bone'), w: 0.8, seed: 14 });
    const tape = [{ x: N.w / 2 - 70, y: -16 }, { x: N.w / 2 + 70, y: -12 }, { x: N.w / 2 + 66, y: 20 }, { x: N.w / 2 - 74, y: 16 }];
    inkPoly(c, tape, { ink, fill: rgba('paper', 0.85), w: 0.5, seed: 15 });
    hatch(c, tape, { ink, gap: 6, angle: 0.9, color: rgba('sepia', 0.2), w: 0.3 });
    c.restore();
    L.upload();
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
    const ink = inkFor(true);

    this.drawRecipe(c, t);

    // ---- 爐火：鍋子下面幾條小小的訊號色火苗（大鼓與甩鍋時竄高）
    const I = this.island;
    let flare = 0;
    for (const ts of this.tosses) { const d = t - ts.t; if (d >= 0 && d < 0.4) flare = Math.max(flare, 1 - d / 0.4); }
    const fl = 0.5 + 0.6 * f.a.kick + 0.6 * flare;
    c.save();
    c.strokeStyle = rgba('signal', 0.9);
    c.lineWidth = 2.4;
    c.lineCap = 'round';
    c.beginPath();
    for (let k = 0; k < 5; k++) {
      const x = this.wokLow.x - 34 + k * 17, hh = (10 + 8 * hash(k, Math.floor(t * 12))) * fl;
      c.moveTo(x, I.top - 2); c.quadraticCurveTo(x + 4, I.top - hh * 0.6, x + (k % 2 ? 3 : -3), I.top - hh);
    }
    c.stroke();
    c.restore();

    // ---- 孟庭甩鍋
    const pc = this.drawOmena(c, t, bp);
    // 鍋子冒的蒸氣（兩三條淡淡的曲線往上飄）
    for (let k = 0; k < 3; k++) {
      const u = ((t * 0.6 + k / 3) % 1);
      const x0 = pc.x - 30 + k * 30, y0 = pc.y - 30 - u * 150;
      inkPath(c, [{ x: x0, y: y0 + 40 }, { x: x0 + 10 * Math.sin(t * 2 + k), y: y0 + 20 }, { x: x0 - 8, y: y0 }], { ink, t, w: 0.5, color: rgba('sepia', 0.35 * Math.sin(Math.PI * u)), seed: 40 + k });
    }

    // ---- 宣文端盤子（每拍輕輕點頭；甩鍋時盤子往前遞一點）
    this.drawAlan(c, t);
    // ---- 三隻狗：排排坐討吃的，菜飛出來的時候輪到的那隻在拍點跳起來咬住（元元最大，先畫在後面）
    for (const i of [1, 2, 0]) this.drawDog(c, t, bp, i);
    // ---- 飛出去的那塊菜
    for (const ts of this.tosses) if (ts.escape) this.escape(c, ink, t, ts);

    this.drawNote(c, t);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：整個窗格慢慢推近冰箱上的便條（最多 1.03 倍，字離邊界的距離已經算進去）
    const push = ease.inOutCubic(f.p), N = this.sheet;
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.24, grain: 0.045, ca: 0.5, zoom: 1 + 0.03 * push, shake: [-(N.x + N.w / 2 - W / 2) * 0.03 * push, -(N.y + N.h / 2 - H / 2) * 0.03 * push] };
  }

  /** 進場：從側面翻正（火花在腳邊）。還沒輪到回傳 null。 */
  private enter(t: number, delay: number, x: number, seed: number) {
    const e = puppetIn(t, this.ctx.start + delay, 0.42);
    if (e.alpha <= 0) return null;
    if (e.k < 1) {
      sparkHead(this.glow, x, FLOOR - 6, t, 0.7);
      sparkParticles(this.glow, t, () => ({ x, y: FLOOR - 6 }), { rate: 50, life: 0.25, speed: 140, seed });
    }
    return e;
  }

  /** 孟庭：拍點前壓低往後帶、拍點上甩起來（整個人往上一送）、收回。回傳這一格鍋子的位置（蒸氣用）。 */
  private drawOmena(c: CanvasRenderingContext2D, t: number, bp: number): Pt {
    const en = this.enter(t, 0.05, OM_X, 1);
    let rot = 0, squash = breathe(t, 0.008, 3), lift = 0;
    let high = false;
    for (const ts of this.tosses) {
      const d = t - ts.t;
      if (d > -bp * 0.5 && d < 0) { const k = prog(t, ts.t - bp * 0.5, ts.t, ease.inOutCubic); rot -= 0.05 * k; squash += 0.05 * k; }
      if (d >= 0 && t < ts.back) {
        high = true;
        // 甩：一下子往上送、慢慢落回來
        lift = 10 * Math.sin(Math.PI * clamp(d / (ts.back - ts.t)));
        rot += 0.04 * Math.exp(-d / 0.15);
        squash -= 0.04 * Math.exp(-d / 0.12);
      }
    }
    if (!en) return high ? this.wokHigh : this.wokLow;
    puppetShadow(c, 'mt', OM_X, FLOOR, { h: SZ, lift, alpha: 0.3 * en.alpha, color: '70,45,25' });
    drawPick(c, this.keys, t, OM_X, FLOOR - lift, { h: SZ, rot, pivot: 0.2, squash, spin: en.spin, alpha: en.alpha });
    return high ? { x: this.wokHigh.x, y: this.wokHigh.y - lift } : this.wokLow;
  }

  /** 宣文：端著盤子面向孟庭（圖朝右，翻過來），每拍點一下頭；甩鍋那一下盤子往前遞一點。 */
  private drawAlan(c: CanvasRenderingContext2D, t: number) {
    const en = this.enter(t, 0.16, AL_X, 2);
    if (!en) return;
    const au = this.ctx.audio;
    let reach = 0;
    for (const ts of this.tosses) reach = Math.max(reach, 1 - Math.abs(t - ts.t) / 0.4);
    const nod = beatKick(au, t, 0.24);
    puppetShadow(c, 'xw', AL_X, FLOOR, { h: SZ, alpha: 0.3 * en.alpha, color: '70,45,25' });
    drawPuppet(c, 'xw_plate', AL_X - 8 * reach, FLOOR, { h: SZ, flip: true, rot: -0.03 * nod - 0.02 * reach, pivot: 0.1, squash: 0.012 * nod + breathe(t, 0.008, 3.3, 0.5), spin: en.spin, alpha: en.alpha });
  }

  /** 一隻狗：在孟庭身後坐著討吃的（每拍點一下頭，三隻的相位錯開）；輪到牠的那塊菜飛過來時跳起來、最高點在拍點上咬住。 */
  private drawDog(c: CanvasRenderingContext2D, t: number, bp: number, i: number) {
    const g = DOGS[i]!, d: Dog = g.d;
    const en = this.enter(t, g.delay, g.x, 3 + i);
    if (!en) return;
    const au = this.ctx.audio;
    const base: PuppetOpts = { h: SZ, scale: DOG_S, spin: en.spin, alpha: en.alpha };
    const shadow = (lift: number) => puppetShadow(c, d, g.x, FLOOR, { h: SZ * DOG_S, lift, alpha: 0.32 * en.alpha, color: '70,45,25' });
    for (const ts of this.tosses) {
      if (ts.catcher !== i) continue;
      const ct = this.catchT(ts), air = Math.min(0.5, bp * 1.1);
      if (t > ct - air / 2 - 0.12 && t < ct + air / 2 + 0.3) {
        const j = jumpArc(t, ct - air / 2, ct + air / 2, g.jump, { crouch: d === 'yy' ? 0.05 : 0.1, land: d === 'yy' ? 0.1 : 0.2 });
        shadow(-j.y);
        if (d === 'yy') {
          // 元元：坐著往上一蹬、身體拉長，最高點（拍點）剛好咬住；落回來壓一下
          const up = j.air ? Math.sin(Math.PI * j.u) : 0;
          drawPuppet(c, 'yy_beg', g.x, FLOOR + j.y, { ...base, squash: j.air ? YY_STRETCH * up : j.squash });
          return;
        }
        // 跳起來那張圖嘴前畫了網球：這裡咬的是菜，一律蓋掉
        if (j.air) drawPuppet(c, `${d}_jump`, g.x, FLOOR + j.y, { ...base, hide: ['ball'], rot: -0.12 + 0.24 * j.u, pivot: 0.5, squash: j.squash });
        else drawPuppet(c, `${d}_beg`, g.x, FLOOR, { ...base, squash: j.squash });
        return;
      }
    }
    shadow(0);
    // 元元比較穩：點頭的幅度小一點
    const amp = d === 'yy' ? 0.5 : 1;
    const beat = au.beatAt(t) + g.phase;
    drawPuppet(c, `${d}_beg`, g.x, FLOOR, { ...base, rot: 0.04 * amp * Math.sin(beat * Math.PI), pivot: 0.1, squash: 0.04 * amp * beatKick(au, t - g.phase * bp, 0.25) });
  }

  /** 飛出去的那塊菜在哪一刻被咬到：甩鍋後兩拍（落在拍點上）。 */
  private catchT(ts: Toss) { return this.ctx.audio.timeOfBeat(Math.round(this.ctx.audio.beatAt(ts.t)) + 2); }

  /** 每兩小節那一次多一塊菜：從甩起來的鍋子越過孟庭的頭，飛到輪到的那隻狗跳起來的嘴邊（在拍點被咬住），咬到時冒一顆小愛心。 */
  private escape(c: CanvasRenderingContext2D, ink: Ink, t: number, ts: Toss) {
    const ct = this.catchT(ts);
    if (t < ts.t || t > ct + 0.6) return;
    const mouth = this.mouths[ts.catcher]!;
    if (t <= ct) {
      const v = clamp((t - ts.t) / (ct - ts.t));
      // 拋物線：飛給後面的狗壓低一點，不要越過冰箱上便條的字與署名
      const q = arcAt(this.wokHigh, mouth, [150, 90, 70][ts.catcher]!, v);
      this.bit(c, ink, q.x, q.y, t * 8, 3, t);
      return;
    }
    // 咬到的瞬間：嘴邊冒一顆小愛心（點綴色）
    const k = (t - ct) / 0.6;
    c.save();
    c.globalAlpha = 1 - k;
    c.fillStyle = rgba('rose');
    const hx = mouth.x + 10, hy = mouth.y - 30 - k * 30, sz = 16;
    c.beginPath(); c.moveTo(hx, hy + sz * 0.35);
    c.bezierCurveTo(hx - sz, hy - sz * 0.4, hx - sz * 0.4, hy - sz, hx, hy - sz * 0.35);
    c.bezierCurveTo(hx + sz * 0.4, hy - sz, hx + sz, hy - sz * 0.4, hx, hy + sz * 0.35);
    c.fill();
    c.restore();
  }

  /** 一塊菜（炒飯裡的蛋、蔥、蝦）：淺色的小塊＋墨線，一邊飛一邊轉。 */
  private bit(c: CanvasRenderingContext2D, ink: Ink, x: number, y: number, rot: number, k: number, t: number) {
    const r = [9, 7, 11, 11][k % 4]!;
    const pts: Pt[] = [];
    for (let i = 0; i < 6; i++) {
      const a = rot + (i / 6) * Math.PI * 2;
      const rr = r * (0.7 + 0.3 * hash(k, i));
      pts.push({ x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr * 0.8 });
    }
    inkShape(c, pts, { ink, t, fill: rgba('ember', 0.9), w: 0.6, seed: 60 + k });
  }

  /** 牆上的食譜步驟：小小的 STEP 0N（歌詞第幾行）＋ 正在唱的歌詞（跟唱）。間奏與純音樂時寫一行「小火慢炒」。 */
  private drawRecipe(c: CanvasRenderingContext2D, t: number) {
    const { lyrics } = this.ctx;
    const ly = lyricAt(lyrics, t);
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.6);
    c.font = font(F.mono(500), 17);
    c.letterSpacing = '5px';
    c.fillStyle = rgba('sepia', 0.45);
    c.fillText(ly ? `STEP ${String(ly.line.i + 1).padStart(2, '0')}` : 'STEP —', WALL.x, WALL.y);
    c.letterSpacing = '0px';
    if (ly) {
      const big = !this.msg;
      const st = { family: F.archivo(100, big ? 800 : 700), size: this.lyricSize, minSize: 40, maxWidth: WALL.w, unsung: rgba('sepia', 0.24), sung: rgba('sepia', big ? 0.94 : 0.82), active: rgba('signal') };
      const lay = layoutLyric(c, ly.line, st);
      c.translate(WALL.x, WALL.y + 30 + lay.size * 0.84);
      drawLyric(c, ly.line, t, st, lay, ly.k);
    } else {
      c.font = font(F.hand(400), 44);
      c.fillStyle = rgba('sepia', 0.45);
      c.fillText('（間奏：小火慢炒）', WALL.x, WALL.y + 76);
    }
    c.restore();
  }

  /** 冰箱便條上的留言：第一拍起一個字一個字寫上去，寫完署名淡入；在便條上垂直置中。 */
  private drawNote(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const N = this.sheet;
    const t0 = Math.min(this.tosses[0]?.t ?? this.ctx.start + 0.8, this.ctx.start + 1.1);
    const total = msgChars(n.fit);
    const per = clamp(1.6 / Math.max(1, total), 0.03, 0.1);
    const done = t0 + total * per;
    const top = N.y + PAD.top, h = N.h - PAD.top - PAD.bottom;
    // 字不跟著便條轉：斜的字瀏覽器每格都要重新光柵化（很貴），便條只歪 1°，看不出來
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.6);
    drawNote(c, n, N.x + PAD.x, top + Math.max(0, (h - n.height) * 0.45), {
      chars: this.msg ? (t - t0) / per : Infinity, color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.62), sigColor: rgba('sepia', 0.75), sigK: prog(t, done + 0.1, done + 0.5),
    });
    c.restore();
  }
}
