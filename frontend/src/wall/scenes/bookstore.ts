// 書店約會（亮、date、雙語）：書店的外文書區，木頭書架、暖黃的吊燈，宣文和孟庭並肩站著各看一本書、肩膀靠在一起。
// 角色是 Codex 畫的雙人紙偶（cp_d3_book_*，_puppet.ts）；書架、平台上的書、紙條由程式畫。
//  - 四小節一輪：兩人一起看書（每拍輕輕點頭、翻頁的聲音在拍點）→ **小節線上宣文偷偷把一張紙條塞進孟庭的書裡** →
//    下一個小節線孟庭發現紙條、驚喜地看他（宣文害羞抓頭，冒一顆小愛心）→ 再下一個小節線回去看書。
//  - **兩行歌詞是右邊牆上展示架的兩本書的書背**：兩本平放、書背朝外疊在一起，上面那本的書背是中文（40～52）、
//    下面那本是原文（小一號），照各自的逐字時間亮；換一句歌詞時一疊新的書從右邊推進來、舊的往左滑出去。
//    沒翻譯的歌只疊一本；純音樂時書背寫書名「（無字的歌）」。
//  - **焦點是主打留言**：左前景一張攤開的紙條（摺痕、撕下來的毛邊），就是宣文塞給她的那張（照「留言尺寸與版面比例標準 v2」：
//    字 40～60、紙條最大 520 × 400）。沒有留言時紙條寫邀請、字淡，歌詞變主角。
//  - 次要動作：吊燈跟著大鼓亮一點、光裡飄著灰塵、書架上偶爾一本書在拍點往外凸一下又推回去。鏡頭：整個窗格慢慢推近兩個人。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, mulberry32 } from '../engine/util';
import type { Lyrics, Line } from '../engine/lyrics';
import { lyricAt, layoutLyric, drawLyric, drawLyricSub, barAfter, beatAfter, msgChars } from './_motifs';
import { inkFor, inkLine, inkPoly, drawNote, heartPop, paperBG, type Note, type Ink } from './_couple';
import { loadPuppets, hasPuppet, drawPick, puppetBox, puppetShadow, puppetIn, breathe, beatKick, noteV2, tightenNote } from './_puppet';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'date', paper: true, energy: [0.15, 0.85], bars: [4, 8] };

const FLOOR = 960;
const SZ = 660;
const CP_X = 900;
/** 右牆的展示架（書疊在上面）：架子的上緣、左右。書背的寬。 */
const SHELF = { x0: 1220, x1: 1840, y: 700 };
/** 後面的書架牆（兩個人背後）。 */
const CASE = { x0: 250, x1: 1160 };
const SPINE = { x: 1236, w: 580 };
/** 左前景的紙條：底邊固定、最大的範圍與內距。 */
const NOTE = { x: 96, bottom: 1010, w: 520, h: 400 };
const NPAD = { x: 38, top: 40, bottom: 30 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const P = { read: 'cp_d3_book_read', slip: 'cp_d3_book_slip', found: 'cp_d3_book_found' } as const;
const FALLBACK: Record<string, string> = { cp_d3_book_read: 'cp_walk_1', cp_d3_book_slip: 'cp_walk_1', cp_d3_book_found: 'cp_hug' };

export default class Bookstore extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(512, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  paperNote = { x: NOTE.x, y: NOTE.bottom - NOTE.h, w: NOTE.w, h: NOTE.h };
  keys: [number, string][] = [];
  founds: number[] = [];
  pokes: { x: number; y: number; w: number; h: number }[] = [];
  pose = (n: string) => (hasPuppet(n) ? n : FALLBACK[n] ?? n);
  msgT0 = 0;
  lyricSize = 50;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客' + INVITE + '（無字的歌）外文書 FOREIGN BOOKS 新書推薦');
    this.track(await loadPuppets(Object.values(P).map(this.pose)));
    // ---- 四小節一輪（窗格短就兩小節）：看書 → 小節線塞紙條 → 小節線發現 → 小節線回去看書
    const b0 = Math.round(au.barAt(barAfter(au, s + 0.4)));
    const nb = (e - s) / Math.max(0.3, au.timeOfBar(b0 + 1) - au.timeOfBar(b0));
    const step = nb >= 6 ? 1 : 0.5;
    this.keys = [[-1e9, this.pose(P.read)]];
    for (let r = 0; r < 6; r++) {
      const base = b0 + r * 4 * step;
      const slip = au.timeOfBar(base + step), found = au.timeOfBar(base + 2 * step), back = au.timeOfBar(base + 3 * step);
      if (slip > e - 0.2) break;
      this.keys.push([slip, this.pose(P.slip)]);
      if (found < e) { this.keys.push([found, this.pose(P.found)]); this.founds.push(found); }
      if (back < e) this.keys.push([back, this.pose(P.read)]);
    }
    // ---- 紙條：標準 v2 的字級，紙的寬高跟著留言
    const c = this.fg.ctx;
    const w = NOTE.w - NPAD.x * 2, hmax = NOTE.h - NPAD.top - NPAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const nw = Math.min(NOTE.w, tightenNote(c, this.note, 300) + NPAD.x * 2);
    const nh = Math.min(NOTE.h, Math.max(220, NPAD.top + this.note.height + NPAD.bottom + 8));
    this.paperNote = { x: NOTE.x, y: NOTE.bottom - nh, w: nw, h: nh };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.msgT0 = beatAfter(au, s + 0.3);
    this.drawBackground();
  }

  /** 不會動的：書架牆（一格一格的書）、區域的小招牌、吊燈、地板、右牆的展示架、左前景的一張小邊桌與紙條的紙。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx, ink = inkFor(true);
    L.clear();
    const rnd = mulberry32(8);
    const wood = mixRgba('fur', 'sepia', 0.35);
    // 後面的書架牆（中間一大片），層板、書背
    c.fillStyle = mixRgba('paper', 'fur', 0.18);
    c.fillRect(CASE.x0, 120, CASE.x1 - CASE.x0, FLOOR - 120 - 40);
    for (let sy = 150; sy < FLOOR - 120; sy += 150) {
      c.fillStyle = wood;
      c.fillRect(CASE.x0, sy + 128, CASE.x1 - CASE.x0, 12);
      for (let x = CASE.x0 + 16; x < CASE.x1 - 20;) {
        const bw = 20 + rnd() * 28, bh = 86 + rnd() * 38;
        const col = ['leash', 'blood', 'gingham', 'fur', 'sepia', 'rose'][Math.floor(rnd() * 6)]!;
        c.fillStyle = mixRgba('paper', col, 0.22 + rnd() * 0.2);
        c.fillRect(x, sy + 128 - bh, bw - 3, bh);
        if (rnd() < 0.5) { c.fillStyle = rgba('bone', 0.5); c.fillRect(x + 3, sy + 128 - bh + 12, bw - 9, 4); }
        if (rnd() < 0.06) this.pokes.push({ x, y: sy + 128 - bh, w: bw - 3, h: bh });
        x += bw + (rnd() < 0.05 ? 36 : 0);
      }
    }
    for (const x of [CASE.x0, CASE.x1]) { c.fillStyle = wood; c.fillRect(x - 10, 110, 20, FLOOR - 150); }
    c.fillStyle = wood;
    c.fillRect(CASE.x0 - 10, 106, CASE.x1 - CASE.x0 + 20, 18);
    // 區域的小招牌（吊在書架上方）
    const sx = (CASE.x0 + CASE.x1) / 2;
    inkPoly(c, [{ x: sx - 210, y: 40 }, { x: sx + 210, y: 40 }, { x: sx + 210, y: 92 }, { x: sx - 210, y: 92 }], { ink, fill: mixRgba('bone', 'paper', 0.5), w: 0.8, seed: 3 });
    c.font = font(F.hei(700), 20);
    c.letterSpacing = '5px';
    c.fillStyle = rgba('sepia', 0.7);
    c.textAlign = 'center';
    c.fillText('外文書 · FOREIGN BOOKS', sx, 74);
    c.textAlign = 'left';
    c.letterSpacing = '0px';
    // 地板：木地板
    c.fillStyle = mixRgba('paper', 'fur', 0.28);
    c.fillRect(0, FLOOR - 40, W, H - FLOOR + 40);
    c.strokeStyle = rgba('sepia', 0.1); c.lineWidth = 1;
    c.beginPath();
    for (let x = -600; x < W + 600; x += 120) { c.moveTo(960 + (x - 960) * 0.4, FLOOR - 40); c.lineTo(x, H); }
    c.stroke();
    // 右牆的展示架：一塊木板＋兩個三角架，上面的招牌「新書推薦」
    c.fillStyle = wood;
    c.fillRect(SHELF.x0, SHELF.y, SHELF.x1 - SHELF.x0, 16);
    for (const x of [SHELF.x0 + 60, SHELF.x1 - 60]) inkPoly(c, [{ x, y: SHELF.y + 16 }, { x: x + 8, y: SHELF.y + 16 }, { x: x + 8, y: SHELF.y + 70 }], { ink, fill: wood, w: 0.6, seed: x });
    c.font = font(F.hei(500), 18);
    c.letterSpacing = '5px';
    c.fillStyle = rgba('sepia', 0.5);
    c.fillText('新書推薦', SHELF.x0 + 90, SHELF.y + 48);
    c.letterSpacing = '0px';
    // 右牆：一扇高窗（窗外淡淡的天空與樹梢），光從窗戶照在展示架上
    const WN = { x: 1390, y: 150, w: 330, h: 420 };
    c.fillStyle = mixRgba('bone', 'leash', 0.14);
    c.fillRect(WN.x, WN.y, WN.w, WN.h);
    for (let k = 0; k < 4; k++) {
      c.fillStyle = mixRgba('paper', 'gingham', 0.2 + 0.05 * k);
      c.beginPath(); c.arc(WN.x + 60 + k * 80, WN.y + WN.h - 40 - (k % 2) * 30, 70, 0, Math.PI * 2); c.fill();
    }
    c.fillStyle = mixRgba('paper', 'bone', 0.4);
    c.fillRect(WN.x - 20, WN.y, 20, WN.h); c.fillRect(WN.x + WN.w, WN.y, 20, WN.h);
    c.fillRect(WN.x - 20, WN.y + WN.h, WN.w + 40, 16);
    inkPoly(c, [{ x: WN.x, y: WN.y }, { x: WN.x + WN.w, y: WN.y }, { x: WN.x + WN.w, y: WN.y + WN.h }, { x: WN.x, y: WN.y + WN.h }], { ink, w: 0.8, seed: 2, closed: true });
    inkLine(c, [{ x: WN.x + WN.w / 2, y: WN.y }, { x: WN.x + WN.w / 2, y: WN.y + WN.h }], { ink, w: 0.6, seed: 4 });
    // 左前景的小邊桌（紙條放在上面）
    const N = this.paperNote;
    inkPoly(c, [{ x: 40, y: N.y + 50 }, { x: N.x + N.w + 60, y: N.y + 50 }, { x: N.x + N.w + 90, y: H }, { x: 10, y: H }], { ink, fill: mixRgba('fur', 'paper', 0.5), w: 0.9, seed: 5 });
    // 紙條：米白、左上一條撕下來的毛邊、中間一條摺痕
    c.fillStyle = rgba('sepia', 0.12);
    c.fillRect(N.x + 10, N.y + 12, N.w, N.h);
    const edge = [];
    for (let x = 0; x <= N.w; x += 12) edge.push({ x: N.x + x, y: N.y + (hash(x, 3) - 0.5) * 6 });
    inkPoly(c, [...edge, { x: N.x + N.w, y: N.y + N.h }, { x: N.x, y: N.y + N.h }], { ink, fill: mixRgba('bone', 'cream', 0.3), w: 0.6, seed: 6 });
    c.strokeStyle = rgba('sepia', 0.12); c.lineWidth = 2;
    c.beginPath(); c.moveTo(N.x + 4, N.y + N.h / 2); c.lineTo(N.x + N.w - 4, N.y + N.h / 2 + 3); c.stroke();
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t;
    const bp = au.beatPeriod(t);
    this.paper.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const ink = inkFor(true);
    this.ambience(c, t, f);
    // ---- 兩個人（並肩看書）
    const en = puppetIn(t, this.ctx.start + 0.05, 0.5);
    const kick = beatKick(au, t, 0.25);
    if (en.alpha > 0) {
      puppetShadow(c, 'cp', CP_X, FLOOR, { h: SZ, alpha: 0.3 * en.alpha, color: '70,50,35', wide: 0.9 });
      drawPick(c, this.keys, t, CP_X, FLOOR, { h: SZ, spin: en.spin, alpha: en.alpha, squash: 0.008 * kick + breathe(t, 0.008, 3.4), rot: 0.008 * Math.sin(au.barAt(t) * Math.PI), pivot: 0.3 });
      // 發現紙條：兩人頭上冒一顆小愛心
      const [bx, by, bw] = puppetBox(this.pose(P.found), CP_X, FLOOR, { h: SZ });
      for (const tf of this.founds) heartPop(c, bx + bw * 0.5, by + 20, 46, (t - tf - 0.1) / (bp * 2));
    }
    this.drawSpines(c, ink, t, lyrics);
    this.drawPaperNote(c, t);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p), z = 0.03 * push;
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.22, grain: 0.045, ca: 0.4, zoom: 1 + z, shake: [-(CP_X - W / 2) * z, -(560 - H / 2) * z] };
  }

  /** 吊燈（大鼓亮一點）、光裡的灰塵、書架上偶爾一本書在拍點往外凸一下。 */
  private ambience(c: CanvasRenderingContext2D, t: number, f: Frame) {
    const au = this.ctx.audio;
    for (const x of [460, 1000]) {
      c.strokeStyle = rgba('sepia', 0.5); c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 150); c.stroke();
      c.fillStyle = mixRgba('fur', 'sepia', 0.3);
      c.beginPath(); c.moveTo(x - 46, 190); c.lineTo(x + 46, 190); c.lineTo(x + 20, 150); c.lineTo(x - 20, 150); c.fill();
      const g = c.createRadialGradient(x, 200, 4, x, 260, 340);
      g.addColorStop(0, mixRgba('ember', 'bone', 0.4, 0.3 + 0.12 * f.a.kick)); g.addColorStop(1, rgba('ember', 0));
      c.fillStyle = g; c.fillRect(x - 340, 150, 680, 520);
      const em = LIN.ember;
      this.glow.seg2(x - 30, 190, x + 30, 190, 4, [em[0] * 1.6, em[1] * 1.6, em[2] * 1.6], 0.6 + 0.4 * f.a.kick);
    }
    // 灰塵：幾顆慢慢飄的小點（位置只看 t 與編號）
    c.fillStyle = rgba('bone', 0.8);
    for (let i = 0; i < 24; i++) {
      const u = ((t * (0.02 + 0.02 * hash(i, 1)) + hash(i, 2)) % 1);
      const x = 300 + 900 * hash(i, 3) + 30 * Math.sin(t * 0.5 + i), y = 160 + 520 * u;
      c.globalAlpha = 0.5 * Math.sin(Math.PI * u);
      c.fillRect(x, y, 2.5, 2.5);
    }
    c.globalAlpha = 1;
    // 拍點上一本書往外凸一下（輪流）
    if (this.pokes.length) {
      const bi = Math.floor(au.beatAt(t) + 1e-6);
      const bk = this.pokes[((bi % this.pokes.length) + this.pokes.length) % this.pokes.length]!;
      const k = Math.sin(Math.PI * clamp((t - au.timeOfBeat(bi)) / 0.4));
      if (k > 0) { c.fillStyle = rgba('sepia', 0.15 * k); c.fillRect(bk.x - 3 * k, bk.y - 6 * k, bk.w + 6 * k, bk.h + 6 * k); }
    }
  }

  /** 展示架上疊著的兩本書：上面那本的書背寫中文、下面那本寫原文，書背的高度跟著字；換句子時新的一疊從右邊推進來。 */
  private drawSpines(c: CanvasRenderingContext2D, ink: Ink, t: number, lyrics: Lyrics) {
    const ly = lyricAt(lyrics, t);
    const big = !this.msg;
    const book = (x: number, y: number, h: number, col: string, seed: number) => {
      inkPoly(c, [{ x, y }, { x: x + SPINE.w, y }, { x: x + SPINE.w, y: y + h }, { x, y: y + h }], { ink, fill: mixRgba('paper', col, 0.5), w: 0.8, seed });
      c.fillStyle = rgba('bone', 0.5);
      c.fillRect(x + 14, y + 6, 6, h - 12);
      c.fillRect(x + SPINE.w - 20, y + 6, 6, h - 12);
    };
    if (!ly) {
      // 兩句之間：展示架上一疊沒寫字的書（不要空著）
      if (lyrics.has) { book(SPINE.x + 20, SHELF.y - 58, 58, 'sepia', 14); book(SPINE.x, SHELF.y - 58 - 64, 64, 'blood', 15); }
      if (!lyrics.has) {
        book(SPINE.x, SHELF.y - 76, 76, 'leash', 11);
        c.font = font(F.hand(400), 40);
        c.fillStyle = rgba('sepia', 0.7);
        c.fillText('（無字的歌）', SPINE.x + 40, SHELF.y - 24);
      }
      return;
    }
    const st = { family: F.archivo(100, big ? 800 : 700), size: this.lyricSize, minSize: 38, maxWidth: SPINE.w - 80, unsung: rgba('bone', 0.4), sung: rgba('bone', 0.98), active: rgba('ember') };
    const lay = layoutLyric(c, ly.line, st);
    const sub = lay.sub;
    // 上面那本（中文）的書背高度：只算中文的排（可能折成兩排），下面那本（原文）照原文自己的排
    const hMain = lay.size + (lay.rows.length - 1) * lay.size * 1.18 + 34;
    const hSub = sub ? sub.lay.height + 30 : 0;
    // 換句子：新的一疊從右邊推進來（0.35 秒）
    const u = ease.outCubic(clamp((t - (ly.line.start - 0.35)) / 0.35));
    const x = SPINE.x + (1 - u) * 700;
    c.save();
    c.beginPath(); c.rect(SHELF.x0 - 20, 0, W - SHELF.x0 + 20, SHELF.y + 2); c.clip();
    let y = SHELF.y;
    if (sub) {
      y -= hSub;
      book(x, y, hSub, 'sepia', 12);
      c.save();
      c.translate(x + 40, y + 15 + sub.lay.size * 0.86);
      // 原文：自己那一排（下面那本書的書背），字級照規則（主行的 0.6 倍、至少 32）
      drawLyricSub(c, ly.line.sub!, t, st, lay.size, ly.k);
      c.restore();
    }
    y -= hMain;
    book(x - 10, y, hMain, 'blood', 13);
    c.save();
    c.translate(x + 30, y + 17 + lay.size * 0.86);
    // 中文：只畫主行（原文已經畫在下面那本書上了）
    drawLyric(c, ly.line, t, st, { ...lay, sub: undefined }, ly.k);
    c.restore();
    c.restore();
  }

  /** 紙條上的留言：一個字一個字寫上去，署名在最後一行下面（紙在背景層畫好了）。 */
  private drawPaperNote(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const N = this.paperNote;
    const total = msgChars(n.fit);
    const per = clamp(1.5 / Math.max(1, total), 0.03, 0.09);
    const done = this.msgT0 + total * per;
    drawNote(c, n, N.x + NPAD.x, N.y + NPAD.top + Math.max(0, (N.h - NPAD.top - NPAD.bottom - n.height) * 0.45), {
      chars: this.msg ? (t - this.msgT0) / per : Infinity, color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.6), sigColor: rgba('sepia', 0.75), sigK: prog(t, done + 0.1, done + 0.5),
    });
  }
}
