// 拍貼機（亮、cartoon）：一張剛印出來的四格拍貼，一小節拍一格——空的格子裡跳出 3、2、1（每拍一個），小節線上「喀嚓」閃光，
// 閃光退掉就是兩人的一個姿勢（Codex 畫的漫畫線稿紙偶 cp_booth_1～4：比愛心、比 YA 吐舌、親臉頰、抱狗）。
//  - 拍好的格子像會動的拍貼：人跟著拍子輕輕點；之後每拍在上面「畫」一筆塗鴉（愛心、星星、閃光），像用筆在拍貼上亂畫。
//  - 窗格短（< 5 小節）時兩拍拍一格，四格都拍得完。
//  - **焦點是主打留言**：寫在拍貼下面的白邊上（像用筆寫在拍貼上），第一拍起一個字一個字寫上去、署名在最後一行下面；
//    照「留言尺寸與版面比例標準 v2」：字 40～60、範圍 860 × 300。沒有留言時寫邀請、字淡，歌詞變主角。
//  - 白邊右邊只有一個小小的日期章。歌詞在拍貼下面的桌面上（40～52），照跟唱規則逐字亮。
//  - 閃光：格子一下子亮白、訊號色的光暈，整個畫面也亮一下（post 的 flash，很小）。鏡頭慢慢推近、跟著正在拍的那一格往旁邊帶一點。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba, type PaletteKey } from '../engine/palette';
import { clamp, ease, prog, hash } from '../engine/util';
import { drawHeart } from '../engine/motifs';
import { lyricAt, layoutLyric, drawLyric, barAfter, beatAfter, msgChars, DATE_DOTS } from './_motifs';
import { inkFor, inkPath, drawNote, paperBG, type Pt, type Ink, type Note } from './_couple';
import { loadPuppets, drawPuppet, puppetInfo, breathe, beatKick, noteV2, tightenNote } from './_puppet';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'couple', family: 'cartoon', paper: true, energy: [0.3, 1], bars: [4, 8] };

/** 拍貼：整張的範圍、四格照片、下面的白邊（寫留言）。 */
const SHEET = { x: 150, y: 110, w: 1620, h: 690 };
/** 四格照片：正方形（Codex 畫的拍貼是正方形的半身照，整張剛好填滿一格）。 */
const FR = { y: 140, w: 300, h: 300, gap: 26 };
const MSG = { x: 196, y: 468, w: 860, h: 300 };
const LYR = { x: 160, base: 956, w: 1150 };
/** 每一格的背景色（紙色混一點點不同的顏色）。 */
const TINTS: PaletteKey[] = ['signal', 'gingham', 'ember', 'leash'];
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const P = ['cp_booth_1', 'cp_booth_2', 'cp_booth_3', 'cp_booth_4'] as const;

interface Rect { x: number; y: number; w: number; h: number }

export default class Photobooth extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  frames: Rect[] = [];
  sheet = { ...SHEET };
  /** 每一格按下快門的時間（小節線，或兩拍一格）與倒數的間隔。 */
  shots: number[] = [];
  step = 1;
  msgT0 = 0;
  lyricSize = 52;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客' + INVITE + '321' + DATE_DOTS + 'LOVE');
    this.track(await loadPuppets(P));
    const m = (SHEET.w - 4 * FR.w - 3 * FR.gap) / 2;
    for (let i = 0; i < 4; i++) this.frames.push({ x: SHEET.x + m + i * (FR.w + FR.gap), y: FR.y, w: FR.w, h: FR.h });
    // ---- 快門：一小節一格（窗格短就兩拍一格），第一格前面留一小節倒數
    const bp = au.beatPeriod(s);
    const b0 = Math.round(au.barAt(s));
    const nb = (e - s) / Math.max(0.3, au.timeOfBar(b0 + 1) - au.timeOfBar(b0));
    const first = barAfter(au, s + Math.max(0.8, bp * 3));
    if (nb >= 5) { for (let i = 0; i < 4; i++) this.shots.push(au.timeOfBar(Math.round(au.barAt(first)) + i)); this.step = 4; }
    else if (nb >= 3.5) { const fb = Math.round(au.beatAt(first)); for (let i = 0; i < 4; i++) this.shots.push(au.timeOfBeat(fb + i * 2)); this.step = 2; }
    else {
      // 只有兩三小節：第一格在第三拍、之後一拍一格（「喀嚓、喀嚓、喀嚓」連拍），四格都拍得完
      const fb = Math.round(au.beatAt(beatAfter(au, s + 0.3))) + 2;
      for (let i = 0; i < 4; i++) this.shots.push(au.timeOfBeat(fb + i));
      this.step = 1;
    }
    // ---- 白邊上的留言
    const c = this.fg.ctx;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, MSG.w, MSG.h) : noteV2(c, INVITE, null, MSG.w, MSG.h * 0.5, { max: 44 });
    tightenNote(c, this.note, 300);
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.msgT0 = beatAfter(au, s + 0.3);
    // 拍貼下面的白邊跟著留言的高度（短留言不要留一大塊空白）
    this.sheet.h = Math.min(SHEET.h, Math.max(560, MSG.y - SHEET.y + this.note.height + 70));
    this.drawBackground();
  }

  /** 不會動的：拍貼的白底、影子、四格的底色與小圖案、日期章（畫一次）。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    const S = this.sheet;
    c.fillStyle = rgba('sepia', 0.1);
    c.beginPath(); c.roundRect(S.x + 10, S.y + 14, S.w, S.h, 18); c.fill();
    c.fillStyle = rgba('bone');
    c.beginPath(); c.roundRect(S.x, S.y, S.w, S.h, 18); c.fill();
    c.strokeStyle = rgba('sepia', 0.18); c.lineWidth = 1; c.stroke();
    this.frames.forEach((f, i) => {
      c.fillStyle = mixRgba('paper', TINTS[i]!, 0.16);
      c.fillRect(f.x, f.y, f.w, f.h);
      // 拍貼機的背景小圖案：點點、星星、格子、斜線（很淡）
      c.save();
      c.beginPath(); c.rect(f.x, f.y, f.w, f.h); c.clip();
      c.fillStyle = rgba('bone', 0.55); c.strokeStyle = rgba('bone', 0.6); c.lineWidth = 2;
      for (let y = f.y + 14; y < f.y + f.h; y += 30) for (let x = f.x + 14 + ((y / 30) % 2) * 15; x < f.x + f.w; x += 30) {
        if (i === 0) { c.beginPath(); c.arc(x, y, 3.5, 0, Math.PI * 2); c.fill(); }
        else if (i === 1) { c.beginPath(); c.moveTo(x - 5, y); c.lineTo(x + 5, y); c.moveTo(x, y - 5); c.lineTo(x, y + 5); c.stroke(); }
        else if (i === 2) { c.beginPath(); c.moveTo(x - 6, y + 6); c.lineTo(x + 6, y - 6); c.stroke(); }
        else { c.fillRect(x - 3, y - 3, 6, 6); }
      }
      c.restore();
    });
    // 日期章：白邊右下角，訊號色的小圓章
    const sx = S.x + S.w - 150, sy = S.y + S.h - 110;
    c.save();
    c.translate(sx, sy); c.rotate(-0.12);
    c.strokeStyle = rgba('signal', 0.75); c.lineWidth = 2.2;
    c.beginPath(); c.arc(0, 0, 66, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 1; c.beginPath(); c.arc(0, 0, 58, 0, Math.PI * 2); c.stroke();
    c.font = font(F.mono(600), 13); c.fillStyle = rgba('signal', 0.8); c.textAlign = 'center';
    c.fillText(DATE_DOTS, 0, 6);
    c.font = font(F.serif(500, true), 18);
    c.fillText('A & O', 0, -18);
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
    let flash = 0;
    this.frames.forEach((fr, i) => {
      const ts = this.shots[i]!;
      c.save();
      c.beginPath(); c.rect(fr.x, fr.y, fr.w, fr.h); c.clip();
      if (t < ts) this.countdown(c, fr, t, ts);
      else {
        this.photo(c, ink, fr, i, t, ts, bp);
        const d = t - ts;
        if (d < 0.45) {
          const k = Math.pow(1 - d / 0.45, 2);
          c.fillStyle = rgba('bone', k);
          c.fillRect(fr.x, fr.y, fr.w, fr.h);
          flash = Math.max(flash, k);
        }
      }
      c.restore();
      // 閃光的光暈（訊號色，快門那一下）
      const d = t - ts;
      if (d >= 0 && d < 0.3) {
        const sg = LIN.signal, k = 1 - d / 0.3;
        const cx = fr.x + fr.w / 2, cy = fr.y + fr.h / 2;
        for (let a = 0; a < 12; a++) {
          const ang = (a / 12) * Math.PI * 2, r0 = 170 + 40 * (1 - k), r1 = r0 + 40 * k;
          this.glow.seg2(cx + Math.cos(ang) * r0 * 1.2, cy + Math.sin(ang) * r0, cx + Math.cos(ang) * r1 * 1.2, cy + Math.sin(ang) * r1, 1.8, [sg[0] * 2, sg[1] * 2, sg[2] * 2], k);
        }
      }
    });
    this.drawMessage(c, t);
    this.drawLyrics(c, t);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：慢慢推近，往正在拍的那一格帶一點
    let cur = 0;
    for (let i = 0; i < 4; i++) if (t >= this.shots[i]! - bp * 3) cur = i;
    const fx = this.frames[cur]!.x + FR.w / 2;
    const push = ease.inOutCubic(f.p), z = 0.03 * push;
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.2, grain: 0.04, ca: 0.4, flash: 0.12 * flash, zoom: 1 + z, shake: [-(fx * 0.3 + 960 * 0.7 - W / 2) * z * 2, -(460 - H / 2) * z] };
  }

  /** 還沒拍的格子：快門前三拍跳出 3、2、1（每拍一個，很淡的大數字），更早是空的。 */
  private countdown(c: CanvasRenderingContext2D, fr: Rect, t: number, ts: number) {
    const au = this.ctx.audio;
    const bp = au.beatPeriod(ts);
    // 倒數 3、2、1：一小節一格時一拍一個數字；拍得越密，倒數越快（三個數字擠進兩格之間）
    const k = (ts - t) / (bp * Math.min(1, this.step / 3));
    if (k > 3) return;
    const n = Math.ceil(k);
    const u = n - k;
    c.save();
    c.font = font(F.archivo(125, 900), 150);
    c.textAlign = 'center';
    c.fillStyle = rgba('sepia', 0.22 * (1 - u * 0.6));
    const sc = 1 + 0.25 * (1 - ease.outCubic(clamp(u * 3)));
    c.translate(fr.x + fr.w / 2, fr.y + fr.h / 2 + 52);
    c.scale(sc, sc);
    c.fillText(String(n), 0, 0);
    c.restore();
  }

  /** 拍好的格子：兩人（腰部以上，跟著拍子輕輕點），之後每拍多一筆塗鴉。 */
  private photo(c: CanvasRenderingContext2D, ink: Ink, fr: Rect, i: number, t: number, ts: number, bp: number) {
    const au = this.ctx.audio;
    const kick = beatKick(au, t, 0.25);
    // 拍貼圖是整張正方形畫布裁掉透明邊（左右都碰到邊，寬 = 原本畫布的寬）：照寬度縮放、左邊對齊格子左邊、腳底（圖的下緣）對齊格子下緣，
    // 就是整張照片剛好填滿一格；放大 4% 讓跟著拍子點頭時邊緣不會露出底色
    const info = puppetInfo(P[i]!);
    if (info) {
      const sc = (fr.w / info.w) * 1.04;
      drawPuppet(c, P[i]!, fr.x - fr.w * 0.02 + info.ax * sc, fr.y + fr.h + 4, { h: info.ref * sc, squash: 0.01 * kick + breathe(t, 0.006, 2.6, i * 0.3), rot: 0.008 * Math.sin(au.beatAt(t) * Math.PI + i), pivot: 0.3 });
    }
    // 塗鴉：拍完之後每拍畫一筆（愛心、星星、閃光、波浪），畫筆的顏色輪流
    const n = Math.floor((t - ts) / bp);
    for (let k = 0; k < Math.min(5, n); k++) {
      const sd = i * 13 + k;
      // 畫在格子的左右兩邊、上半部（兩個人的臉在中間，塗鴉不要蓋到臉）
      const side = (k + i) % 2 ? 1 : 0;
      const x = fr.x + fr.w * (side ? 0.8 + 0.14 * hash(sd, 1) : 0.06 + 0.14 * hash(sd, 1)), y = fr.y + fr.h * (0.08 + 0.34 * hash(sd, 2));
      const draw = clamp((t - ts - (k + 1) * bp) / (bp * 0.5));
      const kind = (i + k) % 4;
      if (kind === 0) { c.save(); c.globalAlpha = draw; drawHeart(c, x, y, 22 + 10 * hash(sd, 3)); c.restore(); }
      else if (kind === 1) this.star(c, x, y, 14, draw, rgba('signal', 0.9));
      else if (kind === 2) inkPath(c, this.wave(x - 30, y, 60), { ink, t, w: 0.7, reveal: draw, color: rgba('signal', 0.85), seed: sd });
      else this.star(c, x, y, 10, draw, rgba('sepia', 0.7));
    }
  }

  /** 筆畫的小星星（四個尖），draw 0..1 畫到哪。 */
  private star(c: CanvasRenderingContext2D, x: number, y: number, r: number, draw: number, col: string) {
    if (draw <= 0) return;
    c.save();
    c.strokeStyle = col; c.lineWidth = 2.2; c.lineCap = 'round';
    c.beginPath();
    const n = Math.ceil(draw * 4);
    for (let k = 0; k < n; k++) { const a = (k / 4) * Math.PI * 2; c.moveTo(x, y); c.lineTo(x + Math.cos(a) * r * (k < n - 1 ? 1 : (draw * 4) % 1 || 1), y + Math.sin(a) * r * (k < n - 1 ? 1 : (draw * 4) % 1 || 1)); }
    c.stroke();
    c.restore();
  }

  private wave(x: number, y: number, w: number): Pt[] {
    const pts: Pt[] = [];
    for (let k = 0; k <= 16; k++) pts.push({ x: x + (w * k) / 16, y: y + 6 * Math.sin((k / 16) * Math.PI * 3) });
    return pts;
  }

  /** 白邊上的留言：第一拍起一個字一個字寫上去，寫完署名淡入。 */
  private drawMessage(c: CanvasRenderingContext2D, t: number) {
    const n = this.note!;
    const total = msgChars(n.fit);
    const per = clamp(1.6 / Math.max(1, total), 0.03, 0.1);
    const done = this.msgT0 + total * per;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.1, this.ctx.start + 0.5);
    drawNote(c, n, MSG.x, MSG.y + Math.max(0, (MSG.h - n.height) * 0.4), {
      chars: this.msg ? (t - this.msgT0) / per : Infinity, color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.6), sigColor: rgba('sepia', 0.75), sigK: prog(t, done + 0.1, done + 0.5),
    });
    c.restore();
  }

  /** 拍貼下面桌面上的歌詞（跟唱）；折成兩排時往上長。 */
  private drawLyrics(c: CanvasRenderingContext2D, t: number) {
    const ly = lyricAt(this.ctx.lyrics, t);
    if (!ly) return;
    const big = !this.msg;
    const st = { family: F.archivo(100, big ? 800 : 700), size: this.lyricSize, minSize: 40, maxWidth: LYR.w, unsung: rgba('sepia', 0.26), sung: rgba('sepia', big ? 0.92 : 0.8), active: rgba('signal') };
    const lay = layoutLyric(c, ly.line, st);
    c.save();
    c.translate(LYR.x, LYR.base - (lay.height - lay.size));
    drawLyric(c, ly.line, t, st, lay, ly.k * prog(t, this.ctx.start + 0.1, this.ctx.start + 0.5));
    c.restore();
  }
}
