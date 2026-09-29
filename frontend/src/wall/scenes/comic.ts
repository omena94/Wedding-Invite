// 四格漫畫（亮、cartoon）：一頁報紙的彩色四格，兩人的小劇情「求婚練習」。角色是 Codex 畫的漫畫線稿紙偶（*_comic_*）。
//  - 起：宣文單膝跪地、對著芃芃和 QQ 練習求婚（兩隻狗歪頭）。
//    承：孟庭從門邊出現，摀住嘴、臉紅（頭上冒驚嘆號）。
//    轉：宣文嚇得跳起來，戒指盒飛上天，芃芃飛撲去咬（速度線、「嚇！」）。
//    合：婚禮那天，孟庭秀戒指、宣文抓頭傻笑，兩隻狗坐在前面，愛心一拍冒一顆。
//  - 一格一格出現：前兩格在第一小節裡（第一拍、第三拍，留言和歌詞才來得及），後兩格各在小節線上「啪」一下貼上去（放大一點點再落定）。
//    每一格裡的角色都跟著拍子動（點頭、歪頭、在空中晃、愛心冒出來），像動態漫畫。
//  - **焦點是主打留言**：第一格左上的旁白框（漫畫的方框旁白，細的雙線框），手寫字、署名；照「留言尺寸與版面比例標準 v2」：
//    字 40～60、框最大 520 × 330。沒有留言時旁白寫邀請、字淡，歌詞變主角。
//  - 歌詞是第二格孟庭的對話框（跟唱，40～52）；沒有歌詞時對話框裡只有「！？」。
//  - 紙頁右下角（QR 的上面）只留一行小小的刊頭；QR 那一區是空白的紙。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H, SCALE } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, barAfter, beatAfter, msgChars } from './_motifs';
import { inkFor, inkLine, inkPath, inkPoly, heartPop, drawNote, paperBG, type Pt, type Ink, type Note } from './_couple';
import { loadPuppets, drawPuppet, puppetBox, puppetShadow, puppetIn, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'couple', family: 'cartoon', paper: true, energy: [0.3, 1], bars: [4, 8] };

interface Rect { x: number; y: number; w: number; h: number }
/** 四格（起承轉合）：上面兩格大、下面兩格小；右下角留給 QR（HUD_SAFE）。 */
const PANELS: Rect[] = [
  { x: 96, y: 96, w: 904, h: 494 },
  { x: 1024, y: 96, w: 800, h: 494 },
  { x: 96, y: 614, w: 594, h: 370 },
  { x: 714, y: 614, w: 622, h: 370 },
];
/** 第一格的旁白框（留言）：最大的範圍與內距。 */
const NARR = { x: 124, y: 122, w: 520, h: 330 };
const NPAD = { x: 26, top: 24, bottom: 20 };
/** 第二格孟庭的對話框（歌詞）：左上角、最大寬。 */
const BUB = { x: 1052, y: 124, w: 520 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const P = {
  kneel: 'xw_comic_kneel', jump: 'xw_comic_jump', surprise: 'mt_comic_surprise',
  ppSit: 'pp_comic_sit', qqSit: 'qq_comic_sit', ppJump: 'pp_comic_jump', wedding: 'cp_comic_wedding',
} as const;

export default class Comic extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 每一格不會動的內容（網點、線、框、效果字），init 畫一次；每格照出現的進度貼到 fg。只當圖源，不上傳。 */
  panelsL = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  narr = { ...NARR };
  /** 每一格出現的時間。 */
  tp: number[] = [];
  msgT0 = 0;
  lyricSize = 52;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客' + INVITE + '！？嚇（完）宣文與孟庭第話求婚練習中');
    this.track(await loadPuppets(Object.values(P)));
    // ---- 每一格出現的時間：第一拍、第三拍，之後各在小節線上（窗格長就隔兩小節）
    const bp = au.beatPeriod(s);
    const b0 = Math.round(au.barAt(s));
    const nb = (e - s) / Math.max(0.3, au.timeOfBar(b0 + 1) - au.timeOfBar(b0));
    const t0 = beatAfter(au, s + 0.05);
    // beatAfter 的 t 剛好在拍點上時算「這一拍」，所以 +2 就是兩拍之後
    const t1 = beatAfter(au, t0, 2);
    let t2 = barAfter(au, t1 + bp * 1.2, nb >= 8 ? 1 : 0);
    let t3 = barAfter(au, t2 + 0.1, nb >= 8 ? 1 : 0);
    // 窗格很短（不到四小節）：後兩格改成兩拍一格，四格都來得及出現
    if (nb < 3.5) { t2 = beatAfter(au, t1, 2); t3 = beatAfter(au, t2, 2); }
    this.tp = [t0, t1, t2, t3];
    this.msgT0 = t0 + 0.25;
    // ---- 旁白框（留言）：標準 v2 的字級，框的寬高跟著留言
    const c = this.fg.ctx;
    const w = NARR.w - NPAD.x * 2, hmax = NARR.h - NPAD.top - NPAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    this.narr.w = Math.min(NARR.w, tightenNote(c, this.note, 300) + NPAD.x * 2);
    this.narr.h = Math.min(NARR.h, NPAD.top + this.note.height + NPAD.bottom + 8);
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.drawPage();
    this.drawPanels();
  }

  /** 紙頁（畫一次）：一張比桌面白一點的紙、淡淡的影子，右下角一行小小的刊頭。 */
  private drawPage() {
    const L = this.bg, c = L.ctx;
    L.clear();
    c.fillStyle = rgba('sepia', 0.08);
    c.fillRect(70, 78, 1790, 944);
    c.fillStyle = mixRgba('bone', 'paper', 0.25);
    c.fillRect(62, 68, 1790, 944);
    c.font = font(F.ming(700), 22);
    c.fillStyle = rgba('sepia', 0.62);
    c.fillText('宣文與孟庭', 1384, 660);
    c.font = font(F.mono(500), 15);
    c.letterSpacing = '3px';
    c.fillStyle = rgba('sepia', 0.45);
    c.fillText(`第 ${String(this.msg?.n ?? 1).padStart(3, '0')} 話 · 求婚練習中`, 1384, 690);
    c.letterSpacing = '0px';
    L.upload();
  }

  /** 四格裡不會動的東西：網點、地板、門框、速度線、「嚇！」、閃亮的網點花、旁白框、框線（畫一次）。 */
  private drawPanels() {
    const L = this.panelsL, c = L.ctx, ink = inkFor(true);
    L.clear();
    const [P1, P2, P3, P4] = PANELS as [Rect, Rect, Rect, Rect];
    for (const p of PANELS) { c.fillStyle = rgba('bone'); c.fillRect(p.x, p.y, p.w, p.h); }
    // 起：上緣一條漸層網點、窗戶、地板
    this.tone(c, P1, P1.y, P1.y + 150, 0.5, 0);
    inkLine(c, [{ x: P1.x, y: P1.y + 440 }, { x: P1.x + P1.w, y: P1.y + 440 }], { ink, w: 0.6, seed: 3 });
    inkPoly(c, [{ x: P1.x + 700, y: P1.y + 70 }, { x: P1.x + 860, y: P1.y + 70 }, { x: P1.x + 860, y: P1.y + 250 }, { x: P1.x + 700, y: P1.y + 250 }], { ink, w: 0.5, seed: 4, closed: true });
    inkLine(c, [{ x: P1.x + 780, y: P1.y + 70 }, { x: P1.x + 780, y: P1.y + 250 }], { ink, w: 0.4, seed: 5 });
    // 旁白框：細的雙線框
    const N = this.narr;
    c.fillStyle = rgba('bone');
    c.fillRect(N.x, N.y, N.w, N.h);
    c.strokeStyle = rgba('sepia', 0.85); c.lineWidth = 2; c.strokeRect(N.x, N.y, N.w, N.h);
    c.lineWidth = 0.8; c.strokeRect(N.x + 5, N.y + 5, N.w - 10, N.h - 10);
    // 承：門框、右邊一片斜的網點
    this.tone(c, P2, P2.y, P2.y + P2.h, 0.35, 1);
    inkLine(c, [{ x: P2.x + 560, y: P2.y + P2.h }, { x: P2.x + 560, y: P2.y + 40 }, { x: P2.x + 780, y: P2.y + 40 }], { ink, w: 0.8, seed: 6 });
    inkLine(c, [{ x: P2.x, y: P2.y + 440 }, { x: P2.x + P2.w, y: P2.y + 440 }], { ink, w: 0.6, seed: 7 });
    // 轉：放射狀的速度線、「嚇！」
    c.save();
    c.beginPath(); c.rect(P3.x, P3.y, P3.w, P3.h); c.clip();
    const cx = P3.x + 250, cy = P3.y + 170;
    c.strokeStyle = rgba('sepia', 0.5);
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2 + hash(i, 1) * 0.05, r0 = 150 + 60 * hash(i, 2);
      c.lineWidth = 0.6 + 1.6 * hash(i, 3);
      c.beginPath(); c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); c.lineTo(cx + Math.cos(a) * 700, cy + Math.sin(a) * 700); c.stroke();
    }
    c.restore();
    c.save();
    c.translate(P3.x + 60, P3.y + 90);
    c.rotate(-0.18);
    c.font = font(F.hei(900), 46);
    c.fillStyle = rgba('sepia', 0.85);
    c.fillText('嚇！', 0, 0);
    c.restore();
    // 合：少女漫畫的閃亮網點花（幾個圓圈與十字光）、「（完）」
    c.save();
    c.beginPath(); c.rect(P4.x, P4.y, P4.w, P4.h); c.clip();
    this.tone(c, P4, P4.y, P4.y + P4.h, 0.25, 2);
    for (let i = 0; i < 14; i++) {
      const x = P4.x + 30 + hash(i, 5) * (P4.w - 60), y = P4.y + 30 + hash(i, 6) * 200, r = 6 + 16 * hash(i, 7);
      c.strokeStyle = rgba('sepia', 0.35); c.lineWidth = 1;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
      if (i % 3 === 0) { c.beginPath(); c.moveTo(x - r * 1.6, y); c.lineTo(x + r * 1.6, y); c.moveTo(x, y - r * 1.6); c.lineTo(x, y + r * 1.6); c.stroke(); }
    }
    c.restore();
    c.font = font(F.hei(500), 20);
    c.fillStyle = rgba('sepia', 0.6);
    c.textAlign = 'right';
    c.fillText('（完）', P4.x + P4.w - 16, P4.y + P4.h - 16);
    c.textAlign = 'left';
    // 框線（粗一點的墨線）
    c.strokeStyle = rgba('sepia', 0.92);
    c.lineWidth = 3;
    for (const p of PANELS) c.strokeRect(p.x, p.y, p.w, p.h);
  }

  /** 網點：一格裡從 y0 到 y1 越來越淡（或越來越濃）的圓點，漫畫的灰階。 */
  private tone(c: CanvasRenderingContext2D, p: Rect, y0: number, y1: number, max: number, kind: number) {
    c.save();
    c.beginPath(); c.rect(p.x, p.y, p.w, p.h); c.clip();
    c.fillStyle = rgba('sepia', 0.42);
    const step = 9;
    for (let y = y0; y < y1; y += step) for (let x = p.x + ((y / step) % 2) * step * 0.5; x < p.x + p.w; x += step) {
      const k = kind === 0 ? 1 - (y - y0) / (y1 - y0) : kind === 1 ? clamp((x - p.x - p.w * 0.55) / (p.w * 0.45)) : 1 - (y - y0) / (y1 - y0) * 0.8;
      const r = step * 0.45 * Math.sqrt(k * max);
      if (r < 0.5) continue;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
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
    const ink = inkFor(true);
    const src = this.panelsL.canvas, S = SCALE;
    PANELS.forEach((p, i) => {
      const u = (t - this.tp[i]!) / 0.2;
      if (u <= 0) return;
      // 「啪」一下貼上去：放大一點點、落定
      const k = clamp(u), sc = 1 + 0.05 * (1 - ease.outCubic(k));
      c.save();
      c.globalAlpha = clamp(k * 2.5);
      c.translate(p.x + p.w / 2, p.y + p.h / 2);
      c.scale(sc, sc);
      c.translate(-p.x - p.w / 2, -p.y - p.h / 2);
      c.drawImage(src, (p.x - 3) * S, (p.y - 3) * S, (p.w + 6) * S, (p.h + 6) * S, p.x - 3, p.y - 3, p.w + 6, p.h + 6);
      c.beginPath(); c.rect(p.x + 1.5, p.y + 1.5, p.w - 3, p.h - 3); c.clip();
      if (i === 0) this.panel1(c, t, p);
      else if (i === 1) this.panel2(c, t, p, bp);
      else if (i === 2) this.panel3(c, ink, t, p, bp);
      else this.panel4(c, t, p, bp);
      c.restore();
    });
    comp.draw(renderer, L.upload(), out);
    // 鏡頭：整個窗格慢慢推近一點點（往留言那一格偏一點）
    const push = ease.inOutCubic(f.p), z = 0.025 * push;
    return { paper: 1, bloom: 0.15, bloomThreshold: 1.6, halation: 0.02, vignette: 0.2, grain: 0.04, ca: 0.4, zoom: 1 + z, shake: [-(700 - W / 2) * z, -(400 - H / 2) * z] };
  }

  /** 起：旁白框的留言一個字一個字寫上去；宣文跪著練習（每拍緊張地點一下），兩隻狗輪流歪頭。 */
  private panel1(c: CanvasRenderingContext2D, t: number, p: Rect) {
    const au = this.ctx.audio;
    const floor = p.y + 452, SZ = 360;
    const en = puppetIn(t, this.tp[0]! + 0.05, 0.35);
    const kick = beatKick(au, t, 0.25), beat = Math.floor(au.beatAt(t) + 1e-6);
    // 宣文站在旁白框的右邊（不要蓋到署名），兩隻狗在他面前、不要被格子右緣切到
    const xa = p.x + 620;
    puppetShadow(c, 'xw', xa, floor, { h: SZ, alpha: 0.22 * en.alpha, color: '70,45,25' });
    drawPuppet(c, P.kneel, xa, floor, { h: SZ, spin: en.spin, alpha: en.alpha, squash: 0.02 * kick + breathe(t, 0.01, 1.6), rot: -0.02 * kick, pivot: 0.1 });
    const dogs: [string, number][] = [[P.ppSit, p.x + 770], [P.qqSit, p.x + 845]];
    dogs.forEach(([n, x], k) => {
      const tilt = (beat + k) % 2 === 0 ? 0.08 : -0.02;
      puppetShadow(c, n, x, floor, { h: SZ * 1.2, alpha: 0.2 * en.alpha, color: '70,45,25' });
      drawPuppet(c, n, x, floor, { h: SZ, scale: 1.2, flip: true, spin: en.spin, alpha: en.alpha, rot: tilt * ease.outCubic(clamp((t - au.timeOfBeat(beat)) / 0.12)), pivot: 0.5 });
    });
    // 旁白：留言
    const n = this.note!;
    const N = this.narr;
    const total = msgChars(n.fit);
    const per = clamp(1.4 / Math.max(1, total), 0.03, 0.09);
    const done = this.msgT0 + total * per;
    const h = N.h - NPAD.top - NPAD.bottom;
    drawNote(c, n, N.x + NPAD.x, N.y + NPAD.top + Math.max(0, (h - n.height) * 0.45), {
      chars: this.msg ? (t - this.msgT0) / per : Infinity, color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.6), sigColor: rgba('sepia', 0.75), sigK: prog(t, done + 0.1, done + 0.5),
    });
  }

  /** 承：孟庭從門邊出來、摀嘴（出現時小跳一下，頭上的驚嘆號每拍抖一下）；對話框裡是歌詞。 */
  private panel2(c: CanvasRenderingContext2D, t: number, p: Rect, bp: number) {
    const au = this.ctx.audio;
    const floor = p.y + 452, SZ = 360;
    const t0 = this.tp[1]!;
    const en = puppetIn(t, t0 + 0.05, 0.35);
    const hopY = t > t0 && t < t0 + bp ? -18 * Math.sin(Math.PI * (t - t0) / bp) : 0;
    const x = p.x + 640;
    puppetShadow(c, 'mt', x, floor, { h: SZ, lift: -hopY, alpha: 0.22 * en.alpha, color: '70,45,25' });
    drawPuppet(c, P.surprise, x, floor + hopY, { h: SZ, flip: true, spin: en.spin, alpha: en.alpha, squash: 0.02 * beatKick(au, t, 0.25) + breathe(t, 0.01, 2.2) });
    // 驚嘆號：三條短線，每拍抖一下
    const [bx, by, bw] = puppetBox(P.surprise, x, floor + hopY, { h: SZ, flip: true });
    const k = beatKick(au, t, 0.3);
    c.strokeStyle = rgba('sepia', 0.8); c.lineWidth = 3; c.lineCap = 'round';
    c.beginPath();
    for (const [dx, a] of [[-26, -0.5], [0, 0], [26, 0.5]] as const) {
      const hx = bx + bw * 0.5 + dx, hy = by - 16;
      c.moveTo(hx + Math.sin(a) * 8, hy - Math.cos(a) * 8); c.lineTo(hx + Math.sin(a) * (30 + 8 * k), hy - Math.cos(a) * (30 + 8 * k));
    }
    c.stroke();
    // 對話框：歌詞（沒有歌詞時「！？」）
    const ly = lyricAt(this.ctx.lyrics, t);
    const ink = inkFor(true);
    /** 孟庭的嘴邊（圖翻過來面向左，臉在外框左邊三成的地方）。 */
    const face = { x: bx + bw * 0.3, y: by + 70 };
    c.save();
    if (ly) {
      const st = { family: F.archivo(100, this.msg ? 700 : 800), size: this.lyricSize, minSize: 40, maxWidth: BUB.w - 60, align: 'center' as const, unsung: rgba('sepia', 0.26), sung: rgba('sepia', 0.9), active: rgba('signal') };
      const lay = layoutLyric(c, ly.line, st);
      const bw2 = Math.max(...lay.rows.map((r) => r.width)) + 64, bh = lay.height + 50;
      // 框的右緣靠近孟庭的臉，尾巴短短地指到她嘴邊
      const x0 = clamp(face.x - 40 - bw2, BUB.x, BUB.x + BUB.w - bw2), y0 = BUB.y + 30;
      this.bubble(c, ink, x0, y0, bw2, bh, face, t);
      c.translate(x0 + bw2 / 2, y0 + 25 + lay.size * 0.86);
      drawLyric(c, ly.line, t, st, lay, ly.k);
    } else {
      const x0 = face.x - 40 - 140, y0 = BUB.y + 50;
      this.bubble(c, ink, x0, y0, 140, 90, face, t);
      c.font = font(F.hei(900), 44);
      c.fillStyle = rgba('sepia', 0.85);
      c.textAlign = 'center';
      c.fillText('！？', x0 + 70, y0 + 62);
    }
    c.restore();
  }

  /** 漫畫的對話框：圓角框、一條尾巴指向說話的人（手繪線，白底）。 */
  private bubble(c: CanvasRenderingContext2D, ink: Ink, x: number, y: number, w: number, h: number, tail: Pt, t: number) {
    const pts: Pt[] = [];
    const n = 40;
    for (let i = 0; i < n; i++) {
      const u = i / n, a = u * Math.PI * 2;
      pts.push({ x: x + w / 2 + Math.cos(a) * (w / 2), y: y + h / 2 + Math.sin(a) * (h / 2) });
    }
    const tb = { x: clamp(tail.x, x + w * 0.35, x + w * 0.8), y: y + h - 6 };
    inkPoly(c, [{ x: tb.x - 18, y: tb.y }, tail, { x: tb.x + 16, y: tb.y }], { ink, t, fill: rgba('bone'), w: 0.7, seed: 21 });
    inkPoly(c, pts, { ink, t, fill: rgba('bone'), w: 0.8, seed: 22 });
    c.fillStyle = rgba('bone');
    c.beginPath(); c.moveTo(tb.x - 16, tb.y - 4); c.lineTo(tb.x + 14, tb.y - 4); c.lineTo(tb.x, tb.y + 6); c.fill();
  }

  /** 轉：宣文嚇得跳起來（在空中每拍晃一下），戒指盒飛上天，芃芃飛撲過去；QQ 在地上嚇一跳。 */
  private panel3(c: CanvasRenderingContext2D, ink: Ink, t: number, p: Rect, bp: number) {
    const au = this.ctx.audio;
    const floor = p.y + 350, SZ = 280;
    const t0 = this.tp[2]!;
    const en = puppetIn(t, t0 + 0.02, 0.3);
    const up = ease.outCubic(clamp((t - t0) / (bp * 0.6)));
    const bob = Math.sin(au.beatAt(t) * Math.PI) * 6;
    const xa = p.x + 250;
    puppetShadow(c, 'xw', xa, floor, { h: SZ, lift: 60 * up, alpha: 0.22 * en.alpha, color: '70,45,25' });
    drawPuppet(c, P.jump, xa, floor - 60 * up - bob, { h: SZ, spin: en.spin, alpha: en.alpha, rot: -0.06 * up, pivot: 0.5 });
    // 戒指盒：從他手上飛出去，轉著往右上
    const k = clamp((t - t0) / (bp * 2));
    const bxx = xa + 60 + 170 * k, byy = floor - 180 - 110 * Math.sin(Math.PI * 0.5 * k) + 4 * Math.sin(t * 7);
    c.save();
    c.translate(bxx, byy); c.rotate(t * 5);
    c.fillStyle = mixRgba('leash', 'sepia', 0.5);
    c.fillRect(-11, -9, 22, 18);
    c.strokeStyle = rgba('sepia', 0.9); c.lineWidth = 1.5; c.strokeRect(-11, -9, 22, 18);
    c.restore();
    c.strokeStyle = rgba('sepia', 0.6); c.lineWidth = 1.5;
    c.beginPath();
    for (let i = 0; i < 4; i++) { const a = i * 1.57 + t * 3; c.moveTo(bxx + Math.cos(a) * 18, byy + Math.sin(a) * 18); c.lineTo(bxx + Math.cos(a) * 26, byy + Math.sin(a) * 26); }
    c.stroke();
    // 芃芃飛撲過去（在空中晃）、QQ 在地上
    const ep = puppetIn(t, t0 + bp, 0.3);
    if (ep.alpha > 0) drawPuppet(c, P.ppJump, p.x + 470 - 40 * (1 - ep.k), floor - 150 + bob * 0.8, { h: SZ, scale: 1.3, flip: true, spin: ep.spin, alpha: ep.alpha, rot: 0.1, pivot: 0.5 });
    puppetShadow(c, 'qq', p.x + 440, floor, { h: SZ * 1.3, alpha: 0.2 * en.alpha, color: '70,45,25' });
    drawPuppet(c, P.qqSit, p.x + 440, floor - 10 * beatKick(au, t, 0.2), { h: SZ, scale: 1.3, flip: true, spin: en.spin, alpha: en.alpha });
  }

  /** 合：婚禮那天，兩個人（每拍點一下）、兩隻狗坐在前面、愛心一拍冒一顆。 */
  private panel4(c: CanvasRenderingContext2D, t: number, p: Rect, bp: number) {
    const au = this.ctx.audio;
    const floor = p.y + 356, SZ = 300;
    const t0 = this.tp[3]!;
    const en = puppetIn(t, t0 + 0.05, 0.35);
    const kick = beatKick(au, t, 0.25);
    const x = p.x + p.w * 0.5;
    puppetShadow(c, 'cp', x, floor, { h: SZ, alpha: 0.22 * en.alpha, color: '70,45,25' });
    drawPuppet(c, P.wedding, x, floor, { h: SZ, spin: en.spin, alpha: en.alpha, squash: 0.02 * kick + breathe(t, 0.01, 2.4), rot: 0.015 * Math.sin(au.beatAt(t) * Math.PI) });
    const o: PuppetOpts = { h: SZ, scale: 1.2, spin: en.spin, alpha: en.alpha };
    drawPuppet(c, P.ppSit, x - 150, floor, { ...o, rot: 0.04 * Math.sin(au.beatAt(t) * Math.PI), pivot: 0.2 });
    drawPuppet(c, P.qqSit, x + 150, floor, { ...o, flip: true, rot: -0.04 * Math.sin(au.beatAt(t) * Math.PI), pivot: 0.2 });
    const b = Math.floor(au.beatAt(t) + 1e-6);
    for (let k = 0; k < 3; k++) {
      const bb = b - k, tb = au.timeOfBeat(bb);
      if (tb < t0) continue;
      // 愛心冒在兩個人的左右兩側（不要蓋到臉）
      const side = bb % 2 ? 1 : -1;
      heartPop(c, x + side * (160 + 90 * hash(bb, 1)), p.y + 70 + 110 * hash(bb, 2), 26, (t - tb) / (bp * 2.4));
    }
  }
}
