// 一起做菜（亮、home）：廚房的側面。孟庭在爐子前甩鍋，宣文在中島另一邊端著盤子等，QQ 在孟庭腳邊站起來討吃的。
//  - 甩鍋落在拍點：每兩拍一次（大鼓通常在 1、3 拍），鍋子往上一甩（預備 → 甩 = 拍點 → 收回），鍋裡的菜飛起來、
//    在下一次甩之前落回鍋裡。每兩小節有一塊「飛出去」，QQ 在拍點上跳起來咬住。
//  - 歌詞像食譜的步驟：直接寫在爐子上方的牆上，旁邊一個小小的「STEP 0N」（每換一行加一），比留言小一級。
//  - **焦點是主打留言**：寫在冰箱門上的便條（膠帶貼著、稍微歪、有影子），深墨手寫字；便條大小跟著留言長短。
//    沒有留言時便條寫邀請、字淡，歌詞放大變主角。
//  - 鏡頭：整個窗格慢慢推近冰箱上的便條。
//  - 開場：火花把人和狗描出來；紙底、墨色線。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, beatAfter, sparkHead, sparkParticles, msgChars } from './_motifs';
import {
  drawPerson, drawDog, inkFor, inkLine, inkPath, inkShape, inkPoly, inkRect, inkEllipse, hatch, pan, plate, paperBG, POSE, DOG, beatSwing, arcAt, lerpDog, fitNote, drawNote,
  type Pt, type Ink, type Note,
} from './_couple';

export const spec: PlateSpecDecl = { group: 'couple', family: 'home', paper: true, energy: [0.3, 1], bars: [4, 8] };

const FLOOR = 880;
const SZ = 420;
const OM_X = 820, AL_X = 1250, QQ_X = 690;
const ISLAND = { x: 930, w: 210, top: FLOOR - SZ * 0.5 };
const FRIDGE = { x: 100, y: 170, w: 520, h: FLOOR - 170 };
/** 冰箱門上的便條：最大的範圍（上緣貼膠帶的位置固定、高度跟著留言）與寫字的內距。 */
const NOTE = { x: 140, y: 238, w: 452, h: 492, rot: -0.018 };
const PAD = { x: 30, top: 44, bottom: 30 };
/** 牆上寫歌詞（食譜步驟）的範圍：爐子上方，沒有框。 */
const WALL = { x: 790, y: 160, w: 540 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';

interface Toss { t: number; land: number; escape: boolean }

export default class Cooking extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  tosses: Toss[] = [];
  note: Note | null = null;
  sheet = { ...NOTE };
  panAt: Pt = { x: 0, y: 0 };
  qqMouth: Pt = { x: 0, y: 0 };

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('一位賓客（間奏：小火慢炒）' + INVITE);
    // 甩鍋：開場描線後的第一拍起，每兩拍一次；每四次（兩小節）有一塊菜飛出去給 QQ
    let b = Math.ceil(au.beatAt(beatAfter(au, this.ctx.start + 0.7)) - 1e-6);
    for (let k = 0; k < 80; k++) {
      const t = au.timeOfBeat(b);
      if (t > this.ctx.end + 1) break;
      this.tosses.push({ t, land: au.timeOfBeat(b + 2) - au.beatPeriod(t) * 0.18, escape: k % 4 === 3 });
      b += 2;
    }
    const c = this.fg.ctx;
    // 鍋子（甩的那一刻）與 QQ 跳起來咬的位置（reveal 0 = 只算不畫）
    const o = drawPerson(c, 'omena', POSE.panToss(0), { x: OM_X, y: FLOOR, h: SZ, reveal: 0 });
    this.panAt = { x: o.handA.x + Math.cos(o.handAngA) * SZ * 0.2, y: o.handA.y + Math.sin(o.handAngA) * SZ * 0.2 - 10 };
    this.qqMouth = drawDog(c, 'qq', DOG.jump(0, 0.9), { x: QQ_X, y: FLOOR, h: SZ, reveal: 0 }).mouth;
    // 冰箱上的便條：字級依「便條扣掉署名那一列」算；便條高度跟著留言長短
    const w = NOTE.w - PAD.x * 2, hmax = NOTE.h - PAD.top - PAD.bottom;
    this.note = this.msg ? fitNote(c, this.msg.text, this.msg.name, w, hmax, { min: 46, max: 80 }) : fitNote(c, INVITE, null, w, hmax * 0.5, { min: 44, max: 52 });
    this.sheet = { ...NOTE, h: Math.min(NOTE.h, Math.max(240, PAD.top + this.note.height + PAD.bottom + 20)) };
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
    for (const x of [F0.x + F0.w / 2 - 20, F0.x + F0.w / 2 + 20]) inkLine(c, [{ x, y: F0.y + 330 }, { x, y: F0.y + 470 }], { ink, w: 1.6, seed: x });
    hatch(c, [{ x: F0.x + F0.w - 60, y: F0.y + 20 }, { x: F0.x + F0.w - 10, y: F0.y + 20 }, { x: F0.x + F0.w - 10, y: F0.y + F0.h - 10 }, { x: F0.x + F0.w - 60, y: F0.y + F0.h - 10 }], { ink, gap: 10, angle: 1.2, color: rgba('sepia', 0.18), w: 0.35 });
    // 中島：檯面（厚一點）＋櫃門＋把手；爐口在孟庭那一側
    const I = ISLAND;
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

  private nearestToss(t: number) {
    let best: Toss | null = null;
    for (const s of this.tosses) if (!best || Math.abs(s.t - t) < Math.abs(best.t - t)) best = s;
    return best;
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

    this.drawRecipe(c, t);

    // ---- 孟庭甩鍋
    const nt = this.nearestToss(t);
    const p = nt ? beatSwing(t, nt.t, Math.min(0.32, bp * 0.7), Math.min(0.45, bp * 0.9)) : -1;
    const o = drawPerson(c, 'omena', POSE.panToss(p), { x: OM_X, y: FLOOR, h: SZ, ink, t, reveal: rv });
    // 鍋裡的菜：飛在空中的時候鍋是空的
    let flying = false;
    for (const ts of this.tosses) if (t >= ts.t && t < ts.land) flying = true;
    const pc = rv > 0.8 ? pan(c, o.handA, o.handAngA, { ink, t, h: SZ, food: flying ? 0.15 : 1 }) : o.handA;
    // 爐火：鍋子下面幾條小小的訊號色火苗（大鼓時竄高）
    const fl = 0.5 + 0.8 * f.a.kick;
    const I = ISLAND;
    c.save();
    c.strokeStyle = rgba('signal', 0.9);
    c.lineWidth = 2.4;
    c.lineCap = 'round';
    c.beginPath();
    for (let k = 0; k < 5; k++) {
      const x = I.x + 36 + k * 16, hh = (10 + 8 * hash(k, Math.floor(t * 12))) * fl;
      c.moveTo(x, I.top - 2); c.quadraticCurveTo(x + 4, I.top - hh * 0.6, x + (k % 2 ? 3 : -3), I.top - hh);
    }
    c.stroke();
    c.restore();
    // 鍋子冒的蒸氣（兩三條淡淡的曲線往上飄）
    for (let k = 0; k < 3; k++) {
      const u = ((t * 0.6 + k / 3) % 1);
      const x0 = pc.x - 30 + k * 30, y0 = pc.y - 20 - u * 150;
      inkPath(c, [{ x: x0, y: y0 + 40 }, { x: x0 + 10 * Math.sin(t * 2 + k), y: y0 + 20 }, { x: x0 - 8, y: y0 }], { ink, t, w: 0.5, color: rgba('sepia', 0.35 * Math.sin(Math.PI * u)), seed: 40 + k });
    }

    // ---- 飛起來的菜
    for (const ts of this.tosses) {
      if (t < ts.t || t > ts.land + (ts.escape ? bp * 2 : 0)) continue;
      this.food(c, ink, t, ts, pc);
    }

    // ---- 宣文端盤子（每拍輕輕點頭；甩鍋時盤子往前伸一點）
    const dn = (t - au.timeOfBeat(Math.round(au.beatAt(t)))) / 0.12;
    const nod = Math.exp(-dn * dn);
    const ap = POSE.offer();
    ap.head += 8 * nod;
    ap.armA[0] += 6 * (nt ? Math.max(0, 1 - Math.abs(t - nt.t) / 0.4) : 0);
    const a = drawPerson(c, 'alan', ap, { x: AL_X, y: FLOOR, h: SZ, ink, t, reveal: rv, dir: -1 });
    if (rv > 0.8) plate(c, a.handA.x - 20, a.handA.y - 4, { ink, t, h: SZ, food: true });

    // ---- QQ：站起來討，菜飛出來的時候在拍點跳起來咬住
    let dp = DOG.beg();
    for (const ts of this.tosses) {
      if (!ts.escape) continue;
      const catchT = ts.land + bp * 0.5;
      if (Math.abs(t - catchT) < 0.6) dp = lerpDog(DOG.beg(), DOG.jump(beatSwing(t, catchT, 0.35, 0.45), 0.8), 1 - clamp((Math.abs(t - catchT) - 0.4) / 0.2));
    }
    const q = drawDog(c, 'qq', dp, { x: QQ_X, y: FLOOR, h: SZ, ink, t, reveal: rv, wag: Math.sin(t * Math.PI * 2 * 3) });
    for (const j of [o, a, q]) if (j.pen) { const pn = j.pen; sparkHead(this.glow, pn.x, pn.y, t, 0.7); sparkParticles(this.glow, t, () => pn, { rate: 50, life: 0.25, speed: 140 }); }

    this.drawNote(c, t);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：整個窗格慢慢推近冰箱上的便條（最多 1.03 倍，字離邊界的距離已經算進去）
    const push = ease.inOutCubic(f.p), N = this.sheet;
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.24, grain: 0.045, ca: 0.5, zoom: 1 + 0.03 * push, shake: [-(N.x + N.w / 2 - W / 2) * 0.03 * push, -(N.y + N.h / 2 - H / 2) * 0.03 * push] };
  }

  /** 一次甩鍋飛起來的菜：三塊落回鍋裡；每兩小節那一次多一塊飛向 QQ 的嘴（在拍點被咬住）。 */
  private food(c: CanvasRenderingContext2D, ink: Ink, t: number, ts: Toss, pc: Pt) {
    const bp = this.ctx.audio.beatPeriod(ts.t);
    const u = clamp((t - ts.t) / (ts.land - ts.t));
    for (let k = 0; k < 3; k++) {
      if (t > ts.land) break;
      const hgt = 120 + 60 * hash(ts.t * 10, k);
      const dx = (k - 1) * 26 + 18 * Math.sin(Math.PI * u) * (k - 1);
      const x = lerp(this.panAt.x, pc.x, u) + dx;
      const y = lerp(this.panAt.y, pc.y, u) - 4 * hgt * u * (1 - u) - 6;
      this.bit(c, ink, x, y, t * 6 + k, k, t);
    }
    if (ts.escape) {
      // 飛出去的那塊：從鍋子飛到 QQ 跳起來的嘴邊
      const catchT = ts.land + bp * 0.5;
      const v = clamp((t - ts.t) / (catchT - ts.t));
      if (t <= catchT) {
        const q = arcAt(this.panAt, this.qqMouth, 150, v);
        this.bit(c, ink, q.x, q.y, t * 8, 3, t);
      } else {
        // 咬到的瞬間：嘴邊冒一顆小愛心（點綴色）
        const k = (t - catchT) / 0.6;
        if (k < 1) {
          c.save();
          c.globalAlpha = 1 - k;
          c.fillStyle = rgba('rose');
          const hx = this.qqMouth.x + 10, hy = this.qqMouth.y - 30 - k * 30, sz = 14;
          c.beginPath(); c.moveTo(hx, hy + sz * 0.35);
          c.bezierCurveTo(hx - sz, hy - sz * 0.4, hx - sz * 0.4, hy - sz, hx, hy - sz * 0.35);
          c.bezierCurveTo(hx + sz * 0.4, hy - sz, hx + sz, hy - sz * 0.4, hx, hy + sz * 0.35);
          c.fill();
          c.restore();
        }
      }
    }
  }

  /** 一塊菜（炒飯裡的蛋、蔥、蝦）：淺色的小塊＋墨線，一邊飛一邊轉。 */
  private bit(c: CanvasRenderingContext2D, ink: Ink, x: number, y: number, rot: number, k: number, t: number) {
    const r = [9, 7, 11, 10][k % 4]!;
    const pts: Pt[] = [];
    for (let i = 0; i < 6; i++) {
      const a = rot + (i / 6) * Math.PI * 2;
      const rr = r * (0.7 + 0.3 * hash(k, i));
      pts.push({ x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr * 0.8 });
    }
    inkShape(c, pts, { ink, t, fill: k === 1 ? rgba('gingham', 0.8) : rgba('bone'), w: 0.6, seed: 60 + k });
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
      const st = { family: F.archivo(100, big ? 800 : 700), size: big ? 64 : 52, minSize: 48, maxWidth: WALL.w, unsung: rgba('sepia', 0.24), sung: rgba('sepia', big ? 0.94 : 0.82), active: rgba('signal') };
      const lay = layoutLyric(c, ly.line, st);
      c.translate(WALL.x, WALL.y + 30 + lay.size * 0.84);
      drawLyric(c, ly.line, t, st, lay, ly.k);
    } else {
      c.font = font(F.hand(400), 46);
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
