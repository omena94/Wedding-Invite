// 狗狗咖啡廳（亮、dog、雙語）：午後的狗狗咖啡廳，芃芃、元元、QQ 三隻趴在桌邊探頭，盯著桌上剛端來的狗狗蛋糕；
// 宣文（左）和孟庭（右，蹲下來跟狗一樣高）拿手機幫牠們拍照。角色是 Codex 畫的紙偶（_puppet.ts）。
//  - 三隻狗每拍輕輕點頭（口水快流下來），每個小節線「喀嚓」一聲：兩支手機閃光（畫面白一下、快門的四個角），
//    三隻狗同時歪頭擺姿勢；元元是大狗，探出來最高，拍照那一下把頭伸得更前面。桌上的咖啡冒著熱氣。
//  - **兩行歌詞寫在牆上的店內小黑板**（右上）：中文大字、原文小一號在正下方（粉筆字，drawLyric 自動畫原文），
//    黑板角落畫著粉筆的小腳印；沒有翻譯的歌只有中文、在黑板裡置中。
//  - **焦點是主打留言**：寫在蛋糕上的插牌（兩根竹籤撐著的一張卡，開場時從蛋糕裡升起來），照「留言尺寸與版面比例標準 v2」：
//    字 40～60、插牌最大 620 × 320，高度跟著留言。沒有留言時寫邀請。
//  - 背景：窗、窗台的小盆栽、木頭牆裙；鏡頭慢慢推近狗與蛋糕。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, lyricSubOf, barAfter, sparkHead, sparkParticles } from './_motifs';
import { paperBG, type Note } from './_couple';
import { loadPuppets, drawPuppet, puppetPoint, puppetShadow, puppetIn, breathe, beatKick, landSquash, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { NoteSheet, writeTiming, mainOnly, subLine, layoutSub, drawSub, INVITE } from './_d4';
import type { Lyrics } from '../engine/lyrics';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'dog', paper: true, energy: [0.25, 0.9], bars: [4, 8] };

const SZ = 420, DOG_S = 1.3;
/** 桌子：左右、桌面遠邊（狗的前腳搭在這裡）、桌面近邊、桌子前板的下緣。 */
const TABLE = { x0: 560, x1: 1340, far: 700, near: 752, bottom: 890 };
/** 蛋糕在桌子左邊；插牌（留言）從蛋糕裡升起來。 */
const CAKE = { x: 720, y: 728 };
const CARD = { cx: 680, bottom: 560, w: 620, h: 320 };
const KPAD = { x: 40, top: 38, bottom: 30 };
/** 三隻狗探頭的位置（前腳搭在桌面遠邊）。三隻用同一個場景尺度。 */
const DOG: Record<Who, { x: number; name: string }> = { pp: { x: 965, name: 'pp_coffee_peek' }, yy: { x: 1110, name: 'yy_c5_peek' }, qq: { x: 1255, name: 'qq_coffee_peek' } };
/** 人：宣文站在左邊、孟庭蹲在右邊（腳在右下角 HUD 上面）。 */
const XW = { x: 230, y: 900 }, MT = { x: 1500, y: 812 };
/** 小黑板（歌詞）。 */
const BOARD = { x: 1150, y: 80, w: 660, h: 300 };
/** 桌子上方的吊燈（燈罩下緣）。 */
const LAMP = { x: 1080, y: 250 };
const BPAD = { top: 46, bottom: 46 };
const SPRITES = ['xw_d4_phone', 'mt_d4_phone', ...Object.values(DOG).map((d) => d.name)];

type Who = 'pp' | 'yy' | 'qq';

export default class DogCafe extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  sheet = new NoteSheet(CARD.w, CARD.h, 20);
  lyricSize = 50;
  /** 拍照的時間（每個小節線）。 */
  shots: number[] = [];
  /** 前景（糊的桌緣與杯子），畫一次。 */
  fore = new OffscreenCanvas(600, 280);

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('一位賓客' + INVITE + 'TODAY 今日推薦');
    this.track(await loadPuppets(SPRITES));
    let b = barAfter(au, this.ctx.start + 0.5);
    for (let k = 0; k < 40 && b < this.ctx.end - 0.1; k++) { this.shots.push(b); b = au.timeOfBar(Math.round(au.barAt(b)) + 1); }
    // 插牌上的留言：標準 v2 的字級；卡的寬高跟著留言
    const c = this.fg.ctx;
    const w = CARD.w - KPAD.x * 2, hmax = CARD.h - KPAD.top - KPAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.6, { max: 44 });
    const cw = Math.min(CARD.w, Math.max(tightenNote(c, this.note, 340) + KPAD.x * 2, 420));
    const ch = Math.min(CARD.h, Math.max(200, KPAD.top + this.note.height + KPAD.bottom + 6));
    this.sheet = new NoteSheet(cw, ch, 20);
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.drawBackground();
    this.paintForeground();
  }

  /** 不會動的：牆（上面淡色、下面木頭牆裙）、窗與窗台的盆栽、地板、桌子、小黑板（框、粉筆小腳印）。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    // 牆
    c.fillStyle = mixRgba('paper', 'cream', 0.3);
    c.fillRect(0, 0, W, 640);
    // 木頭牆裙（一條條直的木板）
    c.fillStyle = mixRgba('paper', 'fur', 0.3);
    c.fillRect(0, 560, W, 300);
    c.strokeStyle = rgba('sepia', 0.12);
    c.lineWidth = 2;
    c.beginPath();
    for (let x = 0; x < W; x += 70) { c.moveTo(x, 566); c.lineTo(x, 860); }
    c.stroke();
    c.fillStyle = mixRgba('fur', 'sepia', 0.35);
    c.fillRect(0, 552, W, 14);
    // 地板
    c.fillStyle = mixRgba('paper', 'sepia', 0.16);
    c.fillRect(0, 860, W, H - 860);
    // 窗（左上）：窗框、窗外很淡的樹影、窗台上的小盆栽
    const Wn = { x: 150, y: 90, w: 700, h: 360 };
    c.fillStyle = mixRgba('shirtblue', 'paper', 0.55);
    c.fillRect(Wn.x, Wn.y, Wn.w, Wn.h);
    // 窗外的樹叢（只在窗裡面）
    c.save();
    c.beginPath(); c.rect(Wn.x, Wn.y, Wn.w, Wn.h); c.clip();
    c.fillStyle = mixRgba('gingham', 'paper', 0.45);
    for (let i = 0; i < 7; i++) { c.beginPath(); c.arc(Wn.x + 60 + i * 100, Wn.y + Wn.h - 20 - 30 * hash(i, 2), 70 + 30 * hash(i, 1), 0, Math.PI * 2); c.fill(); }
    c.restore();
    c.strokeStyle = rgba('bone');
    c.lineWidth = 14;
    c.strokeRect(Wn.x, Wn.y, Wn.w, Wn.h);
    c.lineWidth = 8;
    c.beginPath(); c.moveTo(Wn.x + Wn.w / 2, Wn.y); c.lineTo(Wn.x + Wn.w / 2, Wn.y + Wn.h); c.moveTo(Wn.x, Wn.y + Wn.h * 0.45); c.lineTo(Wn.x + Wn.w, Wn.y + Wn.h * 0.45); c.stroke();
    c.fillStyle = mixRgba('bone', 'sepia', 0.1);
    c.fillRect(Wn.x - 24, Wn.y + Wn.h, Wn.w + 48, 18);
    for (const [x, s] of [[Wn.x + 60, 1], [Wn.x + 600, 0.8]] as const) {
      c.fillStyle = mixRgba('fur', 'sepia', 0.3);
      c.beginPath(); c.moveTo(x - 26 * s, Wn.y + Wn.h); c.lineTo(x + 26 * s, Wn.y + Wn.h); c.lineTo(x + 20 * s, Wn.y + Wn.h - 44 * s); c.lineTo(x - 20 * s, Wn.y + Wn.h - 44 * s); c.closePath(); c.fill();
      c.fillStyle = mixRgba('gingham', 'sepia', 0.2);
      for (let k = 0; k < 5; k++) { c.beginPath(); c.ellipse(x + (k - 2) * 12 * s, Wn.y + Wn.h - 70 * s - (k % 2) * 16 * s, 12 * s, 26 * s, (k - 2) * 0.35, 0, Math.PI * 2); c.fill(); }
    }
    // 小黑板：木框、深色板面、粉筆的小腳印與一根骨頭
    const B = BOARD;
    c.fillStyle = mixRgba('fur', 'sepia', 0.45);
    c.fillRect(B.x - 14, B.y - 14, B.w + 28, B.h + 28);
    c.fillStyle = mixRgba('ink2', 'gingham', 0.18);
    c.fillRect(B.x, B.y, B.w, B.h);
    // 粉筆小腳印：從左下角往右走（在字的下面，不跟字擠）
    c.fillStyle = rgba('bone', 0.28);
    for (let i = 0; i < 5; i++) {
      const px = B.x + 40 + i * 34, py = B.y + B.h - 22 - (i % 2) * 12;
      c.beginPath(); c.ellipse(px, py, 7, 6, 0, 0, Math.PI * 2); c.fill();
      for (const [dx, dy] of [[-8, -9], [0, -12], [8, -9]]) { c.beginPath(); c.arc(px + dx!, py + dy!, 2.6, 0, Math.PI * 2); c.fill(); }
    }
    c.font = font(F.mono(500), 16);
    c.letterSpacing = '5px';
    c.fillStyle = rgba('bone', 0.45);
    c.fillText('TODAY 今日推薦', B.x + 28, B.y + 30);
    c.letterSpacing = '0px';
    // 桌子：桌面（遠邊到近邊）、前板（木頭），兩杯咖啡
    const T = TABLE;
    c.fillStyle = mixRgba('fur', 'paper', 0.5);
    c.beginPath(); c.moveTo(T.x0 + 20, T.far); c.lineTo(T.x1 - 20, T.far); c.lineTo(T.x1, T.near); c.lineTo(T.x0, T.near); c.closePath(); c.fill();
    // 窗外斜斜照進來的光：兩道淡淡的光斑落在牆裙與地板上
    c.save();
    c.fillStyle = rgba('bone', 0.14);
    for (const [x0, w0] of [[230, 150], [470, 110]] as const) {
      c.beginPath(); c.moveTo(x0, 450); c.lineTo(x0 + w0, 450); c.lineTo(x0 + w0 + 520, 1080); c.lineTo(x0 + 520, 1080); c.closePath(); c.fill();
    }
    c.restore();
    // 吊燈（從天花板垂下來，照著桌子）：燈罩在 initial 畫，燈泡的光在 render 裡跟著拍子
    c.strokeStyle = rgba('sepia', 0.5);
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(LAMP.x, 0); c.lineTo(LAMP.x, LAMP.y - 40); c.stroke();
    c.fillStyle = mixRgba('gingham', 'sepia', 0.35);
    c.beginPath(); c.moveTo(LAMP.x - 16, LAMP.y - 40); c.lineTo(LAMP.x + 16, LAMP.y - 40); c.lineTo(LAMP.x + 56, LAMP.y); c.lineTo(LAMP.x - 56, LAMP.y); c.closePath(); c.fill();
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.paper.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const rv = prog(t, s, s + 0.6, ease.inOutCubic);

    this.drawBoard(c, t, lyrics, rv);
    // 狗在桌子後面探頭（先畫），再畫桌子前板蓋住牠們的下半身
    for (const w of ['pp', 'yy', 'qq'] as Who[]) this.drawDog(c, t, w);
    this.drawTableFront(c);
    this.drawCups(c, t);
    this.drawCake(c, t);
    this.drawPeople(c, t);
    this.drawLampGlow(t);
    c.drawImage(this.fore as unknown as CanvasImageSource, -20, H - 250);
    this.drawFlash(c, t);

    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p);
    // 拍照的那一下畫面白一下（很短）
    let flash = 0;
    for (const sh of this.shots) { const d = t - sh; if (d >= 0 && d < 0.18) flash = Math.max(flash, 0.22 * (1 - d / 0.18)); }
    return { paper: 1, bloom: 0.25, bloomThreshold: 1.6, halation: 0.03, vignette: 0.22, grain: 0.04, flash, zoom: 1 + 0.03 * push, shake: [-(1000 - W / 2) * 0.03 * push, -(600 - H / 2) * 0.03 * push] };
  }

  /** 小黑板上的兩行歌詞（粉筆色）：中文大字、原文小一號在下面，整組在黑板裡垂直置中。 */
  private drawBoard(c: CanvasRenderingContext2D, t: number, lyrics: Lyrics, rv: number) {
    const ly = lyricAt(lyrics, t);
    const B = BOARD;
    // 沒有歌詞的時候黑板上是粉筆畫的蛋糕和骨頭（今日推薦），不留一塊空黑板
    const doodle = 1 - (ly ? ly.k : 0);
    if (doodle > 0.01) this.drawDoodle(c, doodle);
    if (!ly) return;
    const st = { family: F.hand(500), size: this.lyricSize, minSize: 40, maxWidth: B.w - 100, align: 'center' as const, unsung: rgba('bone', 0.26), sung: rgba('bone', 0.93), active: rgba('signal') };
    // 中文與原文分開排：原文至少 32 px，放不下就兩排（_d4 的 subLine）
    const main = mainOnly(ly.line), sub = lyricSubOf(ly.line);
    const lay = layoutLyric(c, main, st);
    const sst = subLine(st, lay.size, B.w - 60);
    const sl = sub ? layoutSub(c, sub, sst) : null;
    const gap = sl ? lay.size * 0.42 + sl.size * 0.9 : 0;
    const total = lay.height + (sl ? gap + sl.height - sl.size : 0);
    const top = B.y + BPAD.top, h = B.h - BPAD.top - BPAD.bottom;
    const y0 = top + Math.max(0, (h - total) / 2) + lay.size * 0.86;
    const a = ly.k * rv;
    c.save();
    c.translate(B.x + B.w / 2, y0);
    drawLyric(c, main, t, st, lay, a);
    if (sub && sl) { c.translate(0, lay.height - lay.size + gap); drawSub(c, sub, t, sst, sl, a); }
    c.restore();
  }

  /** 黑板上的粉筆畫：一個兩層的蛋糕（上面一根蠟燭）、旁邊一根骨頭，線條是淡淡的粉筆色。 */
  private drawDoodle(c: CanvasRenderingContext2D, a: number) {
    const B = BOARD, cx = B.x + B.w / 2 - 70, cy = B.y + B.h / 2 + 30;
    c.save();
    c.globalAlpha *= a;
    c.strokeStyle = rgba('bone', 0.55);
    c.lineWidth = 4;
    c.lineCap = 'round';
    c.strokeRect(cx - 80, cy - 20, 160, 60);
    c.strokeRect(cx - 50, cy - 60, 100, 40);
    c.beginPath(); c.moveTo(cx, cy - 60); c.lineTo(cx, cy - 90); c.stroke();
    c.beginPath(); c.moveTo(cx, cy - 96); c.quadraticCurveTo(cx + 8, cy - 104, cx, cy - 116); c.quadraticCurveTo(cx - 8, cy - 104, cx, cy - 96); c.stroke();
    const bx = cx + 190, by = cy + 10;
    c.beginPath(); c.moveTo(bx - 40, by); c.lineTo(bx + 40, by); c.stroke();
    for (const dx of [-44, 44]) for (const dy of [-9, 9]) { c.beginPath(); c.arc(bx + dx, by + dy, 9, 0, Math.PI * 2); c.stroke(); }
    c.restore();
  }

  /** 一隻狗探頭：前腳搭在桌邊，每拍點一下頭（快流口水了）；拍照的那一下歪頭擺姿勢、元元把頭伸得更前面。 */
  private drawDog(c: CanvasRenderingContext2D, t: number, w: Who) {
    const au = this.ctx.audio;
    const D = DOG[w];
    const en = puppetIn(t, this.ctx.start + (w === 'yy' ? 0.18 : w === 'pp' ? 0.26 : 0.34), 0.42);
    if (en.alpha <= 0) return;
    const kick = beatKick(au, t - (w === 'qq' ? 0.05 : w === 'pp' ? 0.1 : 0), 0.22);
    let rot = 0.015 * Math.sin(au.beatAt(t) * Math.PI), lift = 0, squash = 0.04 * kick + breathe(t, 0.012, 1.7, w === 'pp' ? 0.3 : 0);
    for (const sh of this.shots) {
      const d = t - sh;
      if (d < -0.1 || d > 0.8) continue;
      // 喀嚓：歪頭（每隻方向不一樣）、元元往上伸
      const k = Math.sin(Math.PI * clamp((d + 0.1) / 0.9));
      rot += k * (w === 'pp' ? -0.12 : w === 'qq' ? 0.12 : 0.05);
      if (w === 'yy') lift += 14 * k;
      squash += landSquash(t, sh + 0.8, 0.05, 0.2);
    }
    // 腳底放在桌面遠邊往下：身體藏在桌子後面，前腳剛好搭在桌邊
    const y = TABLE.far + (w === 'yy' ? 150 : 34);
    const o: PuppetOpts = { h: SZ, scale: DOG_S, spin: en.spin, alpha: en.alpha, rot, pivot: 0.3, squash };
    drawPuppet(c, D.name, D.x, y - lift, o);
    if (en.k < 1) {
      sparkHead(this.glow, D.x, TABLE.far - 4, t, 0.5);
      sparkParticles(this.glow, t, () => ({ x: D.x, y: TABLE.far - 4 }), { rate: 30, life: 0.2, speed: 110, seed: w === 'yy' ? 3 : w === 'pp' ? 4 : 5 });
    }
  }

  /** 桌子的前板（蓋住狗的下半身）與桌面的近邊。 */
  private drawTableFront(c: CanvasRenderingContext2D) {
    const T = TABLE;
    c.fillStyle = mixRgba('fur', 'paper', 0.5);
    c.beginPath(); c.moveTo(T.x0 + 20, T.far); c.lineTo(T.x1 - 20, T.far); c.lineTo(T.x1, T.near); c.lineTo(T.x0, T.near); c.closePath(); c.fill();
    const g = c.createLinearGradient(0, T.near, 0, T.bottom);
    g.addColorStop(0, mixRgba('fur', 'sepia', 0.3));
    g.addColorStop(1, mixRgba('fur', 'sepia', 0.5));
    c.fillStyle = g;
    c.fillRect(T.x0, T.near, T.x1 - T.x0, T.bottom - T.near);
    // 桌面中間一條格紋桌巾（從遠邊垂到前板上）
    c.fillStyle = mixRgba('gingham', 'paper', 0.35, 0.9);
    const rx = (T.x0 + T.x1) / 2 + 60;
    c.beginPath(); c.moveTo(rx - 150, T.far); c.lineTo(rx + 150, T.far); c.lineTo(rx + 160, T.near); c.lineTo(rx + 160, T.near + 70); c.lineTo(rx - 160, T.near + 70); c.lineTo(rx - 160, T.near); c.closePath(); c.fill();
    c.strokeStyle = rgba('bone', 0.45);
    c.lineWidth = 3;
    c.beginPath();
    for (let x = rx - 140; x <= rx + 140; x += 40) { c.moveTo(x, T.far); c.lineTo(x * 1.02 - rx * 0.02, T.near + 70); }
    c.stroke();
    // 前板的木紋（直的接縫）與桌緣的線、地上的影子
    c.strokeStyle = rgba('sepia', 0.18);
    c.lineWidth = 1.5;
    c.beginPath();
    for (let x = T.x0 + 130; x < T.x1; x += 130) { c.moveTo(x, T.near + 4); c.lineTo(x, T.bottom); }
    c.moveTo(T.x0, T.near); c.lineTo(T.x1, T.near);
    c.stroke();
    c.fillStyle = rgba('sepia', 0.12);
    c.beginPath(); c.ellipse((T.x0 + T.x1) / 2, T.bottom + 6, (T.x1 - T.x0) * 0.52, 14, 0, 0, Math.PI * 2); c.fill();
  }

  /** 前景：左下角很近的另一張桌子的桌緣與一杯拿鐵（糊糊的，畫一次），畫面才有前後。 */
  private paintForeground() {
    const c = this.fore.getContext('2d')! as unknown as CanvasRenderingContext2D;
    c.clearRect(0, 0, this.fore.width, this.fore.height);
    c.filter = 'blur(7px)';
    c.fillStyle = mixRgba('fur', 'sepia', 0.5);
    c.beginPath(); c.roundRect(-40, 120, 620, 140, 30); c.fill();
    c.fillStyle = mixRgba('fur', 'paper', 0.35);
    c.beginPath(); c.ellipse(260, 124, 330, 26, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = rgba('bone');
    c.beginPath(); c.ellipse(330, 118, 70, 16, 0, 0, Math.PI * 2); c.fill();
    c.fillRect(290, 40, 80, 76);
    c.fillStyle = mixRgba('cream', 'fur', 0.35);
    c.beginPath(); c.ellipse(330, 42, 40, 10, 0, 0, Math.PI * 2); c.fill();
    c.filter = 'none';
  }

  /** 兩杯咖啡（桌子右邊），熱氣慢慢往上飄。 */
  private drawCups(c: CanvasRenderingContext2D, t: number) {
    for (const [x, sd] of [[1150, 1], [1230, 2]] as const) {
      const y = 734;
      c.fillStyle = rgba('bone');
      c.beginPath(); c.ellipse(x, y + 8, 30, 7, 0, 0, Math.PI * 2); c.fill();
      c.fillRect(x - 18, y - 22, 36, 28);
      c.beginPath(); c.ellipse(x, y - 22, 18, 5, 0, 0, Math.PI * 2); c.fillStyle = mixRgba('fur', 'sepia', 0.55); c.fill();
      c.strokeStyle = rgba('sepia', 0.3); c.lineWidth = 1.2; c.strokeRect(x - 18, y - 22, 36, 28);
      c.beginPath(); c.arc(x + 22, y - 10, 7, -Math.PI / 2, Math.PI / 2); c.stroke();
      c.strokeStyle = rgba('bone', 0.6);
      c.lineWidth = 2.2;
      for (let k = 0; k < 2; k++) {
        const ph = (((t - this.ctx.start) * 0.5 + k * 0.5 + sd * 0.3) % 1);
        c.globalAlpha = Math.sin(Math.PI * ph) * 0.8;
        c.beginPath();
        for (let i = 0; i <= 10; i++) { const yy = y - 30 - ph * 60 - i * 5; const xx = x - 6 + k * 10 + Math.sin(i * 0.8 + (t - this.ctx.start) * 3 + sd) * 5; if (i) c.lineTo(xx, yy); else c.moveTo(xx, yy); }
        c.stroke();
      }
      c.globalAlpha = 1;
    }
  }

  /** 狗狗蛋糕（桌子左邊）與插牌：兩根竹籤撐著一張卡，開場時從蛋糕裡升起來；卡上寫留言，拍點上輕輕晃。 */
  private drawCake(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const S = this.sheet, n = this.note;
    const rise = ease.outBack(prog(t, this.ctx.start + 0.25, this.ctx.start + 0.8));
    const sway = 0.012 * Math.sin(au.beatAt(t) * Math.PI);
    const cardCy = CARD.bottom - S.h / 2 + (1 - rise) * (S.h + 60);
    // 竹籤（在蛋糕後面）
    c.strokeStyle = mixRgba('fur', 'cream', 0.4);
    c.lineWidth = 5;
    c.lineCap = 'round';
    for (const dx of [-S.w * 0.3, S.w * 0.3]) { c.beginPath(); c.moveTo(CARD.cx + dx, cardCy + S.h / 2 - 10); c.lineTo(CARD.cx + dx * 0.25, CAKE.y - 60); c.stroke(); }
    if (n) {
      const tm = writeTiming(n, this.ctx.start + 0.8, t, !!this.msg);
      S.paint(n, { chars: tm.chars, sigK: tm.sigK, padX: KPAD.x, padTop: KPAD.top, padBottom: KPAD.bottom, color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.62), sigColor: rgba('sepia', 0.74) }, (cc, x, y, w, h) => {
        cc.fillStyle = rgba('sepia', 0.1);
        cc.fillRect(x + 6, y + 8, w, h);
        cc.fillStyle = rgba('bone');
        cc.fillRect(x, y, w, h);
        // 花邊：上下兩條小波浪（烘焙店的插牌）
        cc.strokeStyle = mixRgba('rose', 'paper', 0.3);
        cc.lineWidth = 3;
        for (const yy of [y + 12, y + h - 12]) { cc.beginPath(); for (let xx = x + 14; xx <= x + w - 14; xx += 4) { const v = yy + Math.sin((xx - x) * 0.25) * 3; if (xx === x + 14) cc.moveTo(xx, v); else cc.lineTo(xx, v); } cc.stroke(); }
      });
      if (rise > 0.01) S.blit(c, CARD.cx, cardCy, { rot: sway, alpha: clamp(rise * 2) });
    }
    // 蛋糕：一個圓的狗狗蛋糕（奶油抹面、上面一圈小骨頭餅乾），坐在木頭小架子上
    const x = CAKE.x, y = CAKE.y;
    c.fillStyle = mixRgba('fur', 'sepia', 0.3);
    c.fillRect(x - 96, y, 192, 10);
    c.beginPath(); c.ellipse(x, y, 104, 16, 0, 0, Math.PI * 2); c.fillStyle = rgba('bone'); c.fill();
    c.fillStyle = mixRgba('cream', 'bone', 0.4);
    c.fillRect(x - 84, y - 70, 168, 70);
    c.beginPath(); c.ellipse(x, y, 84, 14, 0, 0, Math.PI); c.fill();
    c.fillStyle = mixRgba('cream', 'bone', 0.75);
    c.beginPath(); c.ellipse(x, y - 70, 84, 16, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = rgba('sepia', 0.2); c.lineWidth = 1.2; c.stroke();
    c.fillStyle = mixRgba('fur', 'cream', 0.4);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI, bx = x - Math.cos(a) * 62, by = y - 72 + Math.sin(a) * 8;
      c.fillRect(bx - 10, by - 3, 20, 6);
      for (const dx of [-10, 10]) for (const dy of [-3, 3]) { c.beginPath(); c.arc(bx + dx, by + dy, 3.5, 0, Math.PI * 2); c.fill(); }
    }
    c.strokeStyle = rgba('rose', 0.65);
    c.lineWidth = 3;
    c.beginPath(); c.ellipse(x, y - 34, 84, 12, 0, 0, Math.PI); c.stroke();
  }

  /** 人：宣文站在左邊彎腰拍照、孟庭蹲在右邊拍照（面向左）；每拍輕輕跟著點，拍照那一下往前一送。 */
  private drawPeople(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    for (const [who, P, flip, d] of [['xw', XW, false, 0.05], ['mt', MT, true, 0.12]] as const) {
      const en = puppetIn(t, this.ctx.start + d, 0.45);
      if (en.alpha <= 0) continue;
      let rot = 0.012 * Math.sin(au.beatAt(t) * Math.PI);
      for (const sh of this.shots) { const dd = t - sh; if (dd > -0.15 && dd < 0.4) rot += (flip ? -1 : 1) * 0.04 * Math.sin(Math.PI * clamp((dd + 0.15) / 0.55)); }
      const o: PuppetOpts = { h: SZ, flip, spin: en.spin, alpha: en.alpha, rot, pivot: 0.1, squash: breathe(t, 0.009, 3, who === 'mt' ? 0.3 : 0) };
      puppetShadow(c, who, P.x, P.y, { h: SZ, alpha: 0.22 * en.alpha, color: '70,45,25' });
      drawPuppet(c, `${who}_d4_phone`, P.x, P.y, o);
    }
  }

  /** 吊燈的燈泡：暖暖的光，拍點上亮一點。 */
  private drawLampGlow(t: number) {
    const k = beatKick(this.ctx.audio, t, 0.3), e = LIN.ember;
    this.glow.polyline([{ x: LAMP.x - 22, y: LAMP.y + 2 }, { x: LAMP.x + 22, y: LAMP.y + 2 }], 7, [e[0] * 2, e[1] * 2, e[2] * 2], 0.6 + 0.3 * k);
  }

  /** 快門：拍照的那一下，畫面四個角閃出取景框的直角（很淡），手機那裡一團閃光。 */
  private drawFlash(c: CanvasRenderingContext2D, t: number) {
    for (const sh of this.shots) {
      const d = t - sh;
      if (d < 0 || d > 0.35) continue;
      const k = 1 - d / 0.35;
      c.save();
      c.strokeStyle = rgba('bone', 0.8 * k);
      c.lineWidth = 4;
      const m = 120 + 30 * (1 - k), L0 = 70;
      for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1]] as const) {
        c.beginPath(); c.moveTo(x, y + sy * L0); c.lineTo(x, y); c.lineTo(x + sx * L0, y); c.stroke();
      }
      c.restore();
      // 閃光在兩支手機上（圖上量好的 phone 點；孟庭朝左，flip）
      const ph = [puppetPoint('xw_d4_phone', 'phone', XW.x, XW.y, { h: SZ }) ?? { x: XW.x + 110, y: XW.y - 330 }, puppetPoint('mt_d4_phone', 'phone', MT.x, MT.y, { h: SZ, flip: true }) ?? { x: MT.x - 100, y: MT.y - 190 }];
      for (const P of ph) {
        const g = c.createRadialGradient(P.x, P.y, 0, P.x, P.y, 90);
        g.addColorStop(0, rgba('bone', 0.9 * k)); g.addColorStop(1, rgba('bone', 0));
        c.fillStyle = g; c.beginPath(); c.arc(P.x, P.y, 90, 0, Math.PI * 2); c.fill();
      }
    }
  }
}
