// 便利商店宵夜（亮、kculture、雙語）：深夜下著雨，鏡頭在店外隔著落地窗往裡看：店裡白亮亮的，宣文和孟庭坐在窗邊的吧檯吃泡麵。
// 角色是 Codex 畫的紙偶（_puppet.ts、素材組 d2），店、貨架、泡麵杯、雨、玻璃、貼紙、收據是程式畫的。不畫任何店名、品牌、商品標誌。
//  - 吃泡麵照拍子：孟庭每兩拍把麵夾起來吹一吹（拍點上吹）、第三拍吃；宣文每個小節線夾起一大口「呼嚕」吸進去（麵往上一甩）。
//    泡麵杯一直冒熱氣。
//  - 窗外在下雨：斜斜的雨絲（hi-hat 時亮一點）、玻璃上的水珠，每一拍有一兩顆往下滑、拖出一條水痕；遠處的街燈在玻璃上反光。
//  - **兩行歌詞是玻璃窗上的貼紙**（店家的雙語宣傳貼紙）：白底圓角、訊號色細框，中文大字、原文小一號在下面；每換一句，
//    新的一張貼紙從角落「貼上去」（翻平、彈一下）。沒翻譯的歌只有一行，貼紙跟著變矮，不留空白。
//  - **焦點是主打留言**：寫在一張長長的收據背面，用膠帶貼在左邊的玻璃上（手寫字、署名），標準 v2：字 40～60、收據最大 420 × 430。
//  - 鏡頭：慢慢推近兩個人，雨一直下。右下角 HUD 是亮亮的吧檯前板，乾淨。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, fract } from '../engine/util';
import { lyricAt, layoutLyric, beatAfter, barAfter, type LyricStyle } from './_motifs';
import { paperBG, type Note } from './_couple';
import { loadPuppets, drawPick, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { INVITE, enterPuppet, writeNote } from './_c5';
import { pose, loadLyricGlyphs, drawLyricIn } from './_d2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'kculture', paper: true, energy: [0.15, 0.85], bars: [4, 8] };

/** 場景尺度（宣文站直的身高 px）；坐著的腳底（被吧檯擋住）。 */
const SZ = 900;
/** 坐著的腳底（被吧檯擋住）；胸前泡麵杯杯口的高度（熱氣從這裡冒）。 */
const SEAT = 1060, CUP_Y = 600;
const AL_X = 800, OM_X = 1230;
/** 窗邊吧檯的檯面（y）與前板。 */
const BAR_Y = 790;
/** 店外的遮雨棚（上緣一條）、窗框的直柱。 */
const AWNING = 86;
const MULLIONS = [34, 1886];
/** 玻璃上的貼紙（歌詞）：中心 x、上緣、最大寬。 */
const STICKER = { cx: 1250, y: 150, w: 900 };
/** 貼在玻璃上的收據（留言）：最大範圍（標準 v2）與寫字的內距。 */
const RECEIPT = { x: 118, y: 150, w: 420, h: 430 };
const PAD = { x: 34, top: 96, bottom: 40 };

interface Drop { x: number; y0: number; r: number; slide: number }

export default class Nightsnack extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(256, { screen2D: true, blend: 'add' }));
  /** 玻璃的淡膜與靜止的水珠：畫一次（每格貼上去），會動的只有正在滑的那幾顆。只當圖片來源，不上傳。 */
  glass = this.track(new Layer2D(W, BAR_Y));
  msg: Msg | null = this.ctx.params.message ?? null;
  alanKeys: [number, string][] = [];
  omKeys: [number, string][] = [];
  /** 宣文吸麵（小節線）、孟庭吹（拍點）的時間。 */
  slurps: number[] = [];
  blows: number[] = [];
  /** 換句的時間（新貼紙貼上去）。 */
  lineStarts: number[] = [];
  drops: Drop[] = [];
  /** 每一拍滑下來的水珠（第幾顆、開始滑的時間）。 */
  slides: { i: number; t: number }[] = [];
  note: Note | null = null;
  rc = { ...RECEIPT };
  noteT0 = 0;
  lyricSize = 50;

  override async init() {
    const { audio: au, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客RECEIPT 23:58 No. 泡麵 × 2 熱水 小計 ♥' + INVITE + (this.msg ? String(this.msg.n).padStart(3, '0') : ''));
    await loadLyricGlyphs(lyrics, s, e);
    const P = {
      slurp: pose('xw_snack_slurp', 'xw_idle_front'), look: pose('xw_snack_look', 'xw_idle_front'),
      blow: pose('mt_snack_blow', 'mt_idle_front'), eat: pose('mt_snack_eat', 'mt_idle_front'),
    };
    this.track(await loadPuppets([...new Set(Object.values(P))]));
    // 孟庭：每兩拍吹一次（拍點上），第三拍吃；宣文：每個小節線吸一大口，一拍後回來看孟庭
    const A: [number, string][] = [[-1e9, P.look]], O: [number, string][] = [[-1e9, P.eat]];
    const bar0 = barAfter(au, s + 0.3);
    for (let bar = Math.round(au.barAt(bar0)), k = 0; k < 40; k++, bar++) {
      const t = au.timeOfBar(bar);
      if (t > e) break;
      const bp = au.beatPeriod(t);
      this.slurps.push(t);
      A.push([t - bp * 0.3, P.slurp], [t + bp * 1.2, P.look]);
      this.blows.push(t + bp, t + bp * 2);
      O.push([t + bp * 0.6, P.blow], [t + bp * 2.6, P.eat]);
    }
    this.alanKeys = A; this.omKeys = O;
    for (const l of lyrics.linesIn(s - 1, e + 1)) this.lineStarts.push(l.start - 0.35);
    // 玻璃上的水珠：固定的一批（種子），每一拍挑一顆往下滑
    for (let i = 0; i < 70; i++) {
      const x = 60 + hash(i, 1) * (W - 120), y0 = AWNING + 30 + hash(i, 2) * (BAR_Y - AWNING - 60);
      this.drops.push({ x, y0, r: 3 + 5 * hash(i, 3), slide: 120 + 180 * hash(i, 4) });
    }
    for (let b = Math.ceil(au.beatAt(s) - 1e-6), k = 0; k < 300; k++, b++) { const t = au.timeOfBeat(b); if (t > e) break; this.slides.push({ i: (b * 7) % this.drops.length, t }); }
    // 收據上的留言：標準 v2 的字級；收據的長度跟著留言（上緣的膠帶固定）
    const c = this.fg.ctx;
    const w = RECEIPT.w - PAD.x * 2, hmax = RECEIPT.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const rw = Math.min(RECEIPT.w, tightenNote(c, this.note, 320) + PAD.x * 2);
    this.rc = { x: RECEIPT.x, y: RECEIPT.y, w: rw, h: Math.min(RECEIPT.h, Math.max(280, PAD.top + this.note.height + PAD.bottom + 10)) };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.noteT0 = Math.min(beatAfter(au, s + 0.4), s + 0.9);
    this.drawBackground();
    this.drawGlassStatic();
  }

  /** 玻璃上不會動的：淡淡的藍灰膜、水珠（深一點的邊、亮的高光）。滑下來的水珠另外畫（它的原位在滑的時候空著）。 */
  private drawGlassStatic() {
    const c = this.glass.ctx;
    this.glass.clear();
    c.fillStyle = mixRgba('shirtblue', 'paper', 0.4, 0.14);
    c.fillRect(0, AWNING, W, BAR_Y - AWNING);
    for (const dr of this.drops) this.drop(c, dr.x, dr.y0, dr.r);
  }

  private drop(c: CanvasRenderingContext2D, x: number, y: number, r: number) {
    c.fillStyle = mixRgba('shirtblue', 'sepia', 0.3, 0.22);
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    c.fillStyle = rgba('bone', 0.75);
    c.beginPath(); c.arc(x - r * 0.35, y - r * 0.35, r * 0.3, 0, Math.PI * 2); c.fill();
  }

  /** 店裡（白亮的天花板燈、後面的貨架）、吧檯、窗框、遮雨棚、收據（畫一次；雨和水珠每格畫）。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    // 天花板的日光燈：幾條長長的白光
    c.fillStyle = rgba('bone', 0.9);
    for (const x of [300, 900, 1500]) { c.beginPath(); c.roundRect(x, AWNING + 26, 380, 16, 8); c.fill(); }
    // 後面的貨架：三層，一格一格的商品（色塊，沒有字）
    const shelfTop = 300, shelfH = 110;
    for (let r = 0; r < 3; r++) {
      const y = shelfTop + r * shelfH;
      c.fillStyle = mixRgba('paper', 'sepia', 0.1);
      c.fillRect(40, y + shelfH - 10, W - 80, 8);
      for (let x = 60, k = 0; x < W - 80; k++) {
        const w = 34 + 26 * hash(r, k, 1), h = 40 + 50 * hash(r, k, 2);
        const col = ['signal', 'gingham', 'shirtblue', 'fur', 'denim', 'rose'][Math.floor(hash(r, k, 3) * 6)]!;
        c.fillStyle = mixRgba('paper', col, 0.28 + 0.2 * hash(r, k, 4));
        c.fillRect(x, y + shelfH - 10 - h, w, h);
        x += w + 6;
      }
    }
    // 店裡的光往下越來越亮（吧檯那裡最亮）
    const gl = c.createLinearGradient(0, AWNING, 0, BAR_Y);
    gl.addColorStop(0, rgba('paper', 0)); gl.addColorStop(1, rgba('bone', 0.35));
    c.fillStyle = gl;
    c.fillRect(0, AWNING, W, BAR_Y - AWNING);
    // 吧檯：前板（淺木色）＋檯面的邊
    c.fillStyle = mixRgba('paper', 'fur', 0.18);
    c.fillRect(0, BAR_Y, W, H - BAR_Y);
    c.fillStyle = mixRgba('paper', 'fur', 0.32);
    c.fillRect(0, BAR_Y - 14, W, 22);
    c.strokeStyle = rgba('sepia', 0.3);
    c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, BAR_Y - 14); c.lineTo(W, BAR_Y - 14); c.moveTo(0, BAR_Y + 8); c.lineTo(W, BAR_Y + 8); c.stroke();
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const t = f.t;
    this.paper.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();

    // ---- 兩個人（吧檯後面）→ 吧檯檯面蓋住下半身 → 泡麵杯與熱氣
    this.drawPeople(c, t);
    this.counterTop(c);
    this.drawRipples(c, t);
    this.drawCups(c, t);
    // ---- 玻璃：淡淡的藍灰、街燈的反光、水珠、雨絲（都在玻璃外面，蓋在店裡上面）
    this.drawGlass(c, t);
    // ---- 玻璃上的東西：收據（留言）、貼紙（歌詞）
    this.drawReceipt(c, t);
    this.drawSticker(c, t, lyrics);
    // ---- 窗框與遮雨棚（最前面）
    this.drawFrame(c, t);

    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p);
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.28, grain: 0.05, ca: 0.5, zoom: 1 + 0.03 * push, shake: [-((AL_X + OM_X) / 2 - W / 2) * 0.03 * push, -(620 - H / 2) * 0.03 * push] };
  }

  /** 兩人：姿勢照時間軸；每拍輕輕點頭；吸麵那一下頭往後一仰、吹的時候往前一點。 */
  private drawPeople(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const nod = beatKick(au, t, 0.28);
    const enA = enterPuppet(this.glow, t, this.ctx.start + 0.05, AL_X, BAR_Y - 20, 1);
    if (enA) {
      let slurp = 0;
      for (const ts of this.slurps) { const d = t - ts; if (d >= 0 && d < 0.5) slurp = Math.max(slurp, Math.sin(Math.PI * d / 0.5)); }
      const o: PuppetOpts = { h: SZ, pivot: 0.3, rot: -0.03 * slurp, squash: 0.012 * nod - 0.02 * slurp + breathe(t, 0.008, 3.1), spin: enA.spin, alpha: enA.alpha };
      drawPick(c, this.alanKeys, t, AL_X, SEAT, o);
    }
    const enO = enterPuppet(this.glow, t, this.ctx.start + 0.15, OM_X, BAR_Y - 20, 2);
    if (enO) {
      let blow = 0;
      for (const tb of this.blows) { const d = t - tb; if (d >= -0.05 && d < 0.3) blow = Math.max(blow, 1 - Math.abs(d - 0.05) / 0.25); }
      const o: PuppetOpts = { h: SZ, pivot: 0.3, rot: 0.02 * blow, squash: 0.012 * nod + breathe(t, 0.008, 2.9, 0.4), spin: enO.spin, alpha: enO.alpha };
      drawPick(c, this.omKeys, t, OM_X, SEAT, o);
    }
  }

  /** 吧檯檯面與前板：人畫完之後蓋回去（坐著的人下半身在吧檯後面）。 */
  private counterTop(c: CanvasRenderingContext2D) {
    c.save();
    // 吧檯的檯面（玻璃裡面）與窗框的下緣
    c.fillStyle = mixRgba('paper', 'fur', 0.32);
    c.fillRect(0, BAR_Y - 14, W, 22);
    c.fillStyle = mixRgba('sepia', 'ink', 0.3);
    c.fillRect(0, BAR_Y + 8, W, 22);
    // 店外的人行道（濕的）：比紙色暗一點、店裡的光在地上拉成幾條長長的倒影
    const sg = c.createLinearGradient(0, BAR_Y + 30, 0, H);
    sg.addColorStop(0, mixRgba('paper', 'sepia', 0.16)); sg.addColorStop(1, mixRgba('paper', 'sepia', 0.1));
    c.fillStyle = sg;
    c.fillRect(0, BAR_Y + 30, W, H - BAR_Y - 30);
    for (const [x, w] of [[300, 380], [900, 380], [1500, 380]] as const) {
      const rg = c.createLinearGradient(0, BAR_Y + 30, 0, H);
      rg.addColorStop(0, rgba('bone', 0.5)); rg.addColorStop(1, rgba('bone', 0));
      c.fillStyle = rg;
      c.fillRect(x + 20, BAR_Y + 30, w - 40, H - BAR_Y - 30);
    }
    // 人行道的磚縫（很淡），右下角 HUD 那一塊不畫
    c.strokeStyle = rgba('sepia', 0.07);
    c.lineWidth = 1.5;
    c.beginPath();
    for (let y = BAR_Y + 80, k = 0; y < H; k++, y += 60 + k * 14) { c.moveTo(0, y); c.lineTo(1320, y); }
    c.stroke();
    c.restore();
  }

  /** 人行道上的水窪漣漪：每一拍在幾個地方冒一圈（拍點上），慢慢擴大淡掉。右下角 HUD 不放。 */
  private drawRipples(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const b0 = Math.floor(au.beatAt(t) + 1e-6);
    c.save();
    c.lineWidth = 1.5;
    for (let b = b0 - 2; b <= b0; b++) {
      const tb = au.timeOfBeat(b), d = t - tb;
      if (d < 0 || d > 1.2) continue;
      for (let k = 0; k < 3; k++) {
        const x = 80 + hash(b, k, 1) * 1180, y = BAR_Y + 70 + hash(b, k, 2) * (H - BAR_Y - 110);
        const r = 8 + d * 60;
        c.strokeStyle = rgba('sepia', 0.22 * (1 - d / 1.2));
        c.beginPath(); c.ellipse(x, y, r, r * 0.3, 0, 0, Math.PI * 2); c.stroke();
      }
    }
    c.restore();
  }

  /** 泡麵杯的熱氣。 */
  private drawCups(c: CanvasRenderingContext2D, t: number) {
    // 泡麵杯在兩人手上（姿勢圖裡畫好了），這裡只畫杯子冒出來的熱氣：在胸前的杯口往上飄
    for (const [x, k] of [[AL_X + 8, 0], [OM_X + 4, 1]] as const) {
      const y = CUP_Y;
      c.save();
      for (let j = 0; j < 3; j++) {
        const u = fract(t * 0.5 + j / 3 + k * 0.2);
        const xx = x - 20 + j * 20 + 10 * Math.sin(t * 2 + j), yy = y - 18 - u * 110;
        c.strokeStyle = rgba('sepia', 0.22 * Math.sin(Math.PI * u));
        c.lineWidth = 2;
        c.beginPath(); c.moveTo(xx, yy + 30); c.quadraticCurveTo(xx + 12, yy + 15, xx - 4, yy); c.stroke();
      }
      c.restore();
    }
  }

  /** 玻璃：藍灰的淡膜、街燈的反光（幾團暖色、冷色的光暈）、水珠（每一拍有一顆往下滑）、雨絲（斜的細線，hi-hat 時亮一點）。 */
  private drawGlass(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    c.save();
    c.drawImage(this.glass.canvas, 0, 0, W, BAR_Y);
    // 街燈的反光：很淡的暈，慢慢飄
    for (const [x, y, r, col] of [[380, 420, 160, 'fur'], [1620, 360, 200, 'shirtblue'], [1050, 700, 140, 'fur']] as const) {
      const rg = c.createRadialGradient(x + 12 * Math.sin(t * 0.3), y, 0, x, y, r);
      rg.addColorStop(0, mixRgba(col, 'bone', 0.4, 0.14)); rg.addColorStop(1, mixRgba(col, 'bone', 0.4, 0));
      c.fillStyle = rg;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // 滑下來的水珠：每一拍一顆，從玻璃上一顆靜止的水珠旁邊開始往下滑，拖一條水痕（滑到吧台檯面就停）
    for (const sl of this.slides) {
      const d = t - sl.t;
      if (d < 0 || d >= 1.2) continue;
      const dr = this.drops[sl.i]!;
      const x = dr.x + dr.r * 1.6, y0 = dr.y0 + dr.r;
      const y = Math.min(BAR_Y - 20, y0 + ease.inQuad(clamp(d / 1.2)) * dr.slide);
      c.strokeStyle = mixRgba('shirtblue', 'sepia', 0.3, 0.18 * (1 - d / 1.2));
      c.lineWidth = dr.r * 0.8;
      c.beginPath(); c.moveTo(x, y0); c.lineTo(x + 2, y); c.stroke();
      this.drop(c, x + 2, y, dr.r * 0.9);
    }
    // 雨絲：斜斜的細線，往下落（確定性：每條的位置只看 t）
    const hat = clamp(au.env('high', t) * 1.4);
    c.strokeStyle = mixRgba('shirtblue', 'sepia', 0.35, 0.22 + 0.2 * hat);
    c.lineWidth = 1.4;
    c.beginPath();
    for (let i = 0; i < 90; i++) {
      const sp = 900 + 400 * hash(i, 5);
      const x0 = hash(i, 6) * (W + 300), y = fract(hash(i, 7) + t * sp / H) * (H + 200) - 100;
      const x = x0 - (y / H) * 260;
      if (y < AWNING || (x > 1340 && y > 820)) continue;
      c.moveTo(x, y); c.lineTo(x - 10, y + 36);
    }
    c.stroke();
    c.restore();
  }

  /** 窗框（左右兩根直柱）、遮雨棚（上緣：條紋布、在拍點被風吹得抖一下）。 */
  private drawFrame(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    c.save();
    for (const x of MULLIONS) {
      c.fillStyle = mixRgba('sepia', 'ink', 0.3);
      c.fillRect(x - 12, AWNING, 24, BAR_Y - AWNING + 20);
    }
    // 遮雨棚：一條條紋布（訊號色與紙白），下緣波浪、拍點抖一下
    const k = beatKick(au, t, 0.3);
    c.fillStyle = mixRgba('sepia', 'ink', 0.4);
    c.fillRect(0, 0, W, AWNING - 20);
    for (let x = 0, i = 0; x < W; x += 80, i++) {
      c.fillStyle = i % 2 ? rgba('bone', 0.92) : mixRgba('signal', 'blood', 0.35);
      c.beginPath();
      c.moveTo(x, AWNING - 26); c.lineTo(x + 80, AWNING - 26);
      c.lineTo(x + 80, AWNING - 4 + 3 * k * Math.sin(i));
      c.quadraticCurveTo(x + 40, AWNING + 16 + 4 * k, x, AWNING - 4 + 3 * k * Math.sin(i + 1));
      c.closePath(); c.fill();
    }
    c.restore();
  }

  /** 收據：白色的熱感紙，上下緣是撕過的鋸齒，上面一條膠帶貼在玻璃上；印好的表頭（淡）＋ 背面手寫的留言。 */
  private drawReceipt(c: CanvasRenderingContext2D, t: number) {
    const R = this.rc;
    const a = prog(t, this.ctx.start + 0.1, this.ctx.start + 0.5);
    c.save();
    c.globalAlpha = a;
    c.fillStyle = rgba('sepia', 0.1);
    c.fillRect(R.x + 8, R.y + 10, R.w, R.h);
    c.fillStyle = mixRgba('bone', 'paper', 0.15);
    c.beginPath();
    c.moveTo(R.x, R.y);
    for (let x = R.x; x <= R.x + R.w; x += 14) c.lineTo(x + 7, R.y + (Math.floor((x - R.x) / 14) % 2 ? 0 : 6));
    c.lineTo(R.x + R.w, R.y + R.h);
    for (let x = R.x + R.w; x >= R.x; x -= 14) c.lineTo(x - 7, R.y + R.h - (Math.floor((x - R.x) / 14) % 2 ? 0 : 6));
    c.closePath(); c.fill();
    // 膠帶
    c.fillStyle = mixRgba('bone', 'shirtblue', 0.2, 0.7);
    c.save(); c.translate(R.x + R.w / 2, R.y - 4); c.rotate(-0.04); c.fillRect(-70, -14, 140, 30); c.restore();
    // 印好的表頭（熱感紙的淡灰字）
    c.font = font(F.mono(500), 16);
    c.fillStyle = rgba('sepia', 0.45);
    c.fillText('RECEIPT  23:58', R.x + PAD.x, R.y + 40);
    c.textAlign = 'right';
    c.fillText(this.msg ? `No.${String(this.msg.n).padStart(3, '0')}` : 'No.', R.x + R.w - PAD.x, R.y + 40);
    c.textAlign = 'left';
    c.font = font(F.hei(500), 15);
    c.fillStyle = rgba('sepia', 0.35);
    c.fillText('泡麵 × 2　熱水　小計 ♥', R.x + PAD.x, R.y + 66);
    c.setLineDash([4, 5]);
    c.strokeStyle = rgba('sepia', 0.25);
    c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(R.x + PAD.x, R.y + 80); c.lineTo(R.x + R.w - PAD.x, R.y + 80); c.stroke();
    c.setLineDash([]);
    c.restore();
    const n = this.note;
    if (!n) return;
    const top = R.y + PAD.top, h = R.h - PAD.top - PAD.bottom;
    c.save();
    c.globalAlpha = a;
    writeNote(c, n, R.x + PAD.x, top + Math.max(0, (h - n.height) * 0.4), t, this.noteT0, { msg: !!this.msg, color: rgba('sepia', 0.94), faint: rgba('sepia', 0.6), sig: rgba('sepia', 0.72) });
    c.restore();
  }

  /**
   * 玻璃上的雙語貼紙：白底圓角、訊號色細框、左邊一個小小的熱氣碗圖案；中文大字、原文小一號在下面（drawLyric 自動畫原文）。
   * 大小跟著這一句（寬照字寬、高照 layoutLyric 的 height），沒翻譯的歌只有一行就矮一點。每換一句，新貼紙從右上角翻下來貼平、彈一下。
   * 間奏時貼一張小小的「（間奏：麵還沒泡好）」。
   */
  private drawSticker(c: CanvasRenderingContext2D, t: number, lyrics: typeof this.ctx.lyrics) {
    const ly = lyricAt(lyrics, t);
    let since = 9;
    for (const ls of this.lineStarts) if (t >= ls) since = t - ls;
    const peel = 1 - ease.outBack(clamp(since / 0.32));
    const a = prog(t, this.ctx.start + 0.15, this.ctx.start + 0.5);
    const st: LyricStyle = { family: F.hei(900), size: this.lyricSize, minSize: 40, maxWidth: STICKER.w - 170, align: 'center', unsung: rgba('sepia', 0.28), sung: rgba('sepia', 0.92), active: rgba('signal') };
    let w = 520, h = 110, lay = null as ReturnType<typeof layoutLyric> | null;
    if (ly) {
      lay = layoutLyric(c, ly.line, st);
      const sub = lay.sub ? lay.sub.lay.rows.reduce((m, r) => Math.max(m, r.width), 0) : 0;
      w = Math.min(STICKER.w, Math.max(...lay.rows.map((r) => r.width), sub) + 170);
      h = lay.height + lay.size * 0.2 + 56;
    }
    const x = STICKER.cx - w / 2, y = STICKER.y;
    c.save();
    c.globalAlpha = a;
    // 貼上去：從右上角往下翻平（x 方向壓扁 + 一點點轉）
    c.translate(x + w, y);
    if (peel > 0.001) { c.rotate(-0.25 * peel); c.scale(1 - 0.5 * peel, 1); }
    c.translate(-w, 0);
    c.fillStyle = rgba('sepia', 0.12);
    c.beginPath(); c.roundRect(6, 8, w, h, 22); c.fill();
    c.fillStyle = rgba('bone', 0.97);
    c.beginPath(); c.roundRect(0, 0, w, h, 22); c.fill();
    c.strokeStyle = rgba('signal', 0.9);
    c.lineWidth = 3;
    c.beginPath(); c.roundRect(8, 8, w - 16, h - 16, 16); c.stroke();
    // 左邊的小碗：一個半圓、兩條熱氣
    c.strokeStyle = rgba('signal', 0.9);
    c.lineWidth = 3;
    c.beginPath(); c.arc(56, h / 2 + 4, 22, 0, Math.PI); c.closePath(); c.stroke();
    c.beginPath(); c.moveTo(48, h / 2 - 8); c.quadraticCurveTo(54, h / 2 - 20, 48, h / 2 - 30); c.moveTo(62, h / 2 - 8); c.quadraticCurveTo(68, h / 2 - 20, 62, h / 2 - 30); c.stroke();
    if (ly && lay) drawLyricIn(c, ly.line, t, st, { x: 90, y: 22, w: w - 110, h: h - 44 }, ly.k);
    else {
      c.font = font(F.hei(700), 40);
      c.textAlign = 'center';
      c.fillStyle = rgba('sepia', 0.5);
      c.fillText('（間奏：麵還沒泡好）', w / 2 + 40, h / 2 + 14);
    }
    c.restore();
  }
}
