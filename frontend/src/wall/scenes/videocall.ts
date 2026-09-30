// 遠距視訊（暗、date、雙語）：電影的分割畫面——左邊宣文在家（暖黃的立燈、書架、窗外夜景），右邊孟庭在值班休息室（護理服、日光燈、置物櫃、牆上的鐘）。
// 角色是 Codex 畫的紙偶（work 組的上班服；d3 組用較高的解析度轉檔，半身大特寫才不糊）。
//  - 開場：通話接通——兩格從中間的分隔線往外打開（第一拍）。
//  - 每兩小節的小節線：兩人一起比「半顆大愛心」（宣文彎左半邊、孟庭彎右半邊），一顆訊號色的愛心從分隔線兩邊描出來、在中間接起來；
//    其他拍點各自有小反應（宣文比讚、害羞抓頭，孟庭喝一口咖啡、比讚、開心縮肩），每拍輕輕點頭，像真的在講電話。
//  - **兩行歌詞是雙語即時字幕**：畫面下方正中間（跨兩格），中文 40～52、原文（韓文）小一號在正下方，照各自的逐字時間亮；
//    字幕底下一條很淡的暗帶（不加框、不描邊）。沒翻譯的歌只有一行；純音樂時字幕位置只有一個小小的 ♪。
//  - **焦點是主打留言**：像電影裡浮在畫面上的訊息泡泡（左格左上），先跳出「…」輸入中，再一個字一個字打出來，署名在最後一行下面。
//    照「留言尺寸與版面比例標準 v2」：字 40～60、泡泡最大 560 × 380。沒有留言時泡泡寫邀請、字淡，歌詞變主角。
//  - 次要動作：立燈跟著大鼓微微亮一下、窗外的城市燈零星開關；休息室的日光燈在小鼓閃一下、鐘的秒針每拍跳一格。
//  - 暗版面：紙偶用 puppetLight 打光（左邊暖、右邊冷），不會比字幕和泡泡亮。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, mulberry32 } from '../engine/util';
import { heartPoints } from '../engine/motifs';
import { lyricAt, layoutLyric, drawLyric, barAfter, beatAfter, msgChars } from './_motifs';
import { drawNote, heartPop, type Note, type Pt } from './_couple';
import { loadPuppets, hasPuppet, puppetLight, breathe, beatKick, noteV2, tightenNote } from './_puppet';
import { faceLocks, drawLocked, type Lock } from './_d3';
import type { Lyrics } from '../engine/lyrics';
import { lyricV2 } from './_v2';
import { lyricBlock } from './_b2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'date', paper: false, energy: [0.2, 0.9], bars: [4, 8] };

/** 分隔線的位置與寬；左右兩格。 */
const MID = 960, GAP = 8;
const LEFT = { x0: 0, x1: MID - GAP / 2 }, RIGHT = { x0: MID + GAP / 2, x1: W };
/** 半身大特寫：場景尺度（宣文的身高 px），腳底在畫面外。 */
const SZ = 1450, FEET = 1620;
const XW_X = 745, MT_X = 1225;
/** 字幕：中心 x、最後一排（有原文就是原文那排）的基線、最大寬。 */
const CAP = { x: 960, base: 1000, w: 760 };
/** 訊息泡泡：左上角與最大的範圍、內距。 */
const BUB = { x: 64, y: 80, w: 560, h: 380 };
const BPAD = { x: 30, top: 26, bottom: 22 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const P = {
  xwIdle: 'xw_work_d3_idle', xwThumb: 'xw_work_d3_thumb', xwBlush: 'xw_work_d3_blush', xwHeart: 'xw_work_d3_halfheart',
  mtIdle: 'mt_work_d3_idle', mtHappy: 'mt_work_d3_happy', mtSip: 'mt_work_d3_sip', mtThumb: 'mt_work_d3_thumb', mtHeart: 'mt_work_d3_halfheart',
} as const;

export default class Videocall extends Scene {
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  bubble = { ...BUB };
  /** 比愛心的時間（小節線）、通話接通的時間。 */
  hearts: number[] = [];
  tOpen = 0;
  xwKeys: [number, string][] = [];
  mtKeys: [number, string][] = [];
  /** 愛心的中心與大小（兩人的手在分隔線附近接起來的地方）。 */
  /** 兩人比半顆愛心時，分隔線上方描出來的那顆愛心（兩人的手臂各是一半，這顆在中間把它們接起來）。 */
  heart = { x: MID, y: 210, s: 250 };
  xwLock = new Map<string, Lock>();
  mtLock = new Map<string, Lock>();
  heartPath: Pt[] = [];
  /** 窗外會開關的燈。 */
  cityLights: { x: number; y: number }[] = [];
  msgT0 = 0;
  lyricSize = 52;
  poses: string[] = [];

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客' + INVITE + '♪…家值班休息室');
    // 還沒畫好的圖（半顆愛心）先用比讚代替：只載 manifest 裡有的
    this.poses = Object.values(P).filter((n) => hasPuppet(n));
    this.track(await loadPuppets(this.poses));
    const has = (n: string, alt: string) => (this.poses.includes(n) ? n : alt);
    const xwHeart = has(P.xwHeart, P.xwThumb), mtHeart = has(P.mtHeart, P.mtThumb);
    // ---- 時間軸：第一拍接通；之後每兩小節的小節線比愛心、中間的拍點各自有小反應
    this.tOpen = beatAfter(au, s + 0.05);
    const b0 = Math.round(au.barAt(barAfter(au, this.tOpen + 0.3)));
    this.xwKeys = [[-1e9, P.xwIdle]];
    this.mtKeys = [[-1e9, P.mtIdle]];
    for (let k = 0; k < 24; k++) {
      const tb = au.timeOfBar(b0 + k);
      if (tb > e + 0.1) break;
      const bp = au.beatPeriod(tb);
      if (k % 2 === 0) {
        this.hearts.push(tb);
        this.xwKeys.push([tb, xwHeart], [tb + bp * 2.5, P.xwIdle]);
        this.mtKeys.push([tb, mtHeart], [tb + bp * 2.5, P.mtIdle]);
      } else if (k % 4 === 1) {
        this.xwKeys.push([tb, P.xwThumb], [tb + bp * 1.5, P.xwIdle]);
        this.mtKeys.push([tb + bp, P.mtSip], [tb + bp * 3, P.mtIdle]);
      } else {
        this.xwKeys.push([tb + bp, P.xwBlush], [tb + bp * 2.5, P.xwIdle]);
        this.mtKeys.push([tb, P.mtHappy], [tb + bp * 1.5, P.mtThumb], [tb + bp * 2.6, P.mtIdle]);
      }
    }
    // ---- 換姿勢時臉對齊到 idle（Codex 每張畫的人大小、位置不一樣，半顆愛心那張人小一號、低很多，見 _d3.ts）
    this.xwLock = faceLocks(this.xwKeys.map((k) => k[1]), P.xwIdle, XW_X, FEET, { h: SZ, pivot: 0.6 });
    this.mtLock = faceLocks(this.mtKeys.map((k) => k[1]), P.mtIdle, MT_X, FEET, { h: SZ, pivot: 0.6 });
    const hp = heartPoints(96);
    this.heartPath = hp.map((p) => ({ x: this.heart.x + p.x * this.heart.s * 0.5, y: this.heart.y + p.y * this.heart.s * 0.5 }));
    // ---- 訊息泡泡：標準 v2 的字級，泡泡的寬高跟著留言
    const c = this.fg.ctx;
    const w = BUB.w - BPAD.x * 2, hmax = BUB.h - BPAD.top - BPAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    this.bubble.w = Math.min(BUB.w, tightenNote(c, this.note, 260) + BPAD.x * 2);
    this.bubble.h = Math.min(BUB.h, BPAD.top + this.note.height + BPAD.bottom + 6);
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.msgT0 = beatAfter(au, this.tOpen + 0.2, 1);
    this.drawBackground();
  }

  /** 不會動的：兩格的房間（家：牆、書架、立燈、窗；休息室：置物櫃、布告欄、鐘框）、分隔線。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    const rnd = mulberry32(12);
    // ---- 左：家（暖）
    c.save();
    c.beginPath(); c.rect(LEFT.x0, 0, LEFT.x1 - LEFT.x0, H); c.clip();
    c.fillStyle = mixRgba('ink2', 'blood', 0.12);
    c.fillRect(0, 0, LEFT.x1, H);
    // 窗（右上，窗外夜景）
    const win = { x: 560, y: 110, w: 330, h: 420 };
    c.fillStyle = mixRgba('ink', 'ink2', 0.3);
    c.fillRect(win.x, win.y, win.w, win.h);
    for (let x = win.x + 10; x < win.x + win.w - 20;) {
      const bw = 30 + rnd() * 50, top = win.y + 160 + rnd() * 160;
      c.fillStyle = rgba('ink', 0.9);
      c.fillRect(x, top, bw - 4, win.y + win.h - top);
      for (let yy = top + 10; yy < win.y + win.h - 10; yy += 14) for (let xx = x + 5; xx < x + bw - 10; xx += 10) {
        const r = rnd();
        if (r < 0.12) { c.fillStyle = mixRgba('bone', 'ember', 0.5, 0.18 + 0.2 * rnd()); c.fillRect(xx, yy, 4, 6); }
        else if (r < 0.15 && this.cityLights.length < 30) this.cityLights.push({ x: xx, y: yy });
      }
      x += bw;
    }
    c.strokeStyle = mixRgba('ink2', 'bone', 0.18); c.lineWidth = 6;
    c.strokeRect(win.x, win.y, win.w, win.h);
    c.lineWidth = 3; c.beginPath(); c.moveTo(win.x + win.w / 2, win.y); c.lineTo(win.x + win.w / 2, win.y + win.h); c.stroke();
    // 書架（左下，暗暗的書背）
    c.fillStyle = mixRgba('ink', 'blood', 0.2);
    c.fillRect(40, 560, 330, 520);
    for (let sy = 590; sy < 1060; sy += 120) {
      c.fillStyle = mixRgba('ink2', 'blood', 0.3);
      c.fillRect(40, sy + 96, 330, 8);
      for (let x = 56; x < 350;) {
        const bw = 16 + rnd() * 22, bh = 60 + rnd() * 34;
        c.fillStyle = mixRgba('ink2', ['blood', 'graphite', 'ash'][Math.floor(rnd() * 3)]!, 0.25 + rnd() * 0.25);
        c.fillRect(x, sy + 96 - bh, bw - 2, bh);
        x += bw;
      }
    }
    // 立燈的暖光（左邊，一大團很淡的光暈）
    const lg = c.createRadialGradient(250, 470, 10, 250, 470, 520);
    lg.addColorStop(0, mixRgba('ember', 'bone', 0.3, 0.2)); lg.addColorStop(1, rgba('ember', 0));
    c.fillStyle = lg; c.fillRect(0, 0, LEFT.x1, H);
    c.restore();
    // ---- 右：值班休息室（冷）
    c.save();
    c.beginPath(); c.rect(RIGHT.x0, 0, RIGHT.x1 - RIGHT.x0, H); c.clip();
    c.fillStyle = mixRgba('ink2', 'leash', 0.14);
    c.fillRect(RIGHT.x0, 0, W - RIGHT.x0, H);
    // 置物櫃（右邊一排）
    for (let i = 0; i < 4; i++) {
      const x = 1470 + i * 112;
      c.fillStyle = mixRgba('ink2', 'leash', 0.26 + (i % 2) * 0.04);
      c.fillRect(x, 150, 106, 930);
      c.fillStyle = rgba('ink', 0.35);
      for (let k = 0; k < 5; k++) c.fillRect(x + 22, 190 + k * 12, 62, 4);
      c.fillStyle = rgba('bone', 0.14);
      c.fillRect(x + 88, 480, 5, 60);
    }
    // 布告欄（中間偏左，幾張空白的紙）
    c.fillStyle = mixRgba('ink2', 'fur', 0.18);
    c.fillRect(1020, 140, 300, 210);
    for (let k = 0; k < 5; k++) {
      c.save();
      c.translate(1040 + (k % 3) * 92 + rnd() * 10, 160 + Math.floor(k / 3) * 98 + rnd() * 8);
      c.rotate((rnd() - 0.5) * 0.12);
      c.fillStyle = rgba('bone', 0.22);
      c.fillRect(0, 0, 76, 80);
      c.fillStyle = rgba('ink', 0.18);
      for (let l = 0; l < 4; l++) c.fillRect(8, 14 + l * 14, 50 - l * 6, 3);
      c.restore();
    }
    // 鐘框（上方）
    c.strokeStyle = rgba('bone', 0.3); c.lineWidth = 5;
    c.beginPath(); c.arc(1400, 110, 48, 0, Math.PI * 2); c.stroke();
    c.fillStyle = rgba('bone', 0.08); c.fill();
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; c.fillStyle = rgba('bone', 0.35); c.fillRect(1400 + Math.cos(a) * 38 - 1.5, 110 + Math.sin(a) * 38 - 1.5, 3, 3); }
    // 日光燈的冷光（上面）
    const fl = c.createLinearGradient(0, 0, 0, 700);
    fl.addColorStop(0, mixRgba('bone', 'leash', 0.3, 0.14)); fl.addColorStop(1, rgba('leash', 0));
    c.fillStyle = fl; c.fillRect(RIGHT.x0, 0, W - RIGHT.x0, 700);
    c.restore();
    // ---- 分隔線
    c.fillStyle = rgba('ink');
    c.fillRect(LEFT.x1, 0, GAP, H);
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const bp = au.beatPeriod(t);
    // 通話接通：兩格從分隔線往外打開（0 = 只有一條線）
    const open = ease.outCubic(prog(t, this.tOpen - 0.12, this.tOpen + 0.35));
    const halfW = (W / 2) * open;
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const kick = beatKick(au, t, 0.25);

    // ---- 兩個人（這一層最先畫：打光只染紙偶），各自裁在自己那一格
    this.person(c, t, this.xwKeys, this.xwLock, XW_X, LEFT, 0, kick);
    puppetLight(c, [LEFT.x0, 0, LEFT.x1 - LEFT.x0, H], mixRgba('ember', 'ink', 0.8, 0.06), rgba('ink', 0.5));
    this.person(c, t, this.mtKeys, this.mtLock, MT_X, RIGHT, 0.4, kick);
    c.save();
    c.beginPath(); c.rect(RIGHT.x0, 0, RIGHT.x1 - RIGHT.x0, H); c.clip();
    puppetLight(c, [RIGHT.x0, 0, RIGHT.x1 - RIGHT.x0, H], mixRgba('leash', 'ink', 0.7, 0.08), rgba('ink', 0.5));
    c.restore();

    // ---- 字幕底下的暗帶：蓋在人的下半身上面（像電影字幕），字才清楚；不加框
    const band = c.createLinearGradient(0, 780, 0, H);
    band.addColorStop(0, rgba('ink', 0)); band.addColorStop(0.5, rgba('ink', 0.62)); band.addColorStop(1, rgba('ink', 0.8));
    c.fillStyle = band; c.fillRect(0, 780, W, H - 780);
    // ---- 會動的小東西：窗外的燈、立燈、日光燈、秒針
    this.ambience(c, t, f);
    // ---- 比愛心：訊號色的愛心從分隔線兩邊描出來、在中間接起來
    for (const th of this.hearts) this.drawHeart(c, t, th, bp);
    // ---- 訊息泡泡、字幕、兩格的小標
    this.drawBubble(c, t);
    this.drawCaption(c, t, lyrics);
    // 兩格的小標（通話中的小紅點在字的前面）
    c.font = font(F.hei(500), 18);
    c.letterSpacing = '3px';
    const labels = [['家 · 23:41', LEFT.x1 - 28, true], ['值班休息室 · 23:41', RIGHT.x0 + 48, false]] as const;
    for (const [text, x, right] of labels) {
      const w = c.measureText(text).width;
      const x0 = right ? x - w : x;
      c.fillStyle = rgba('bone', 0.4);
      c.fillText(text, x0, 50);
      c.fillStyle = rgba('signal', 0.5 + 0.5 * Math.abs(Math.sin(t * Math.PI)));
      c.beginPath(); c.arc(x0 - 16, 44, 5, 0, Math.PI * 2); c.fill();
    }
    c.letterSpacing = '0px';

    // 通話接通前：兩格從中間打開（用暗色蓋住還沒打開的地方）
    if (open < 1) {
      c.fillStyle = rgba('ink');
      c.fillRect(0, 0, MID - halfW, H);
      c.fillRect(MID + halfW, 0, W - MID - halfW, H);
      c.fillStyle = rgba('signal', 0.8 * (1 - open));
      c.fillRect(MID - 1.5, 0, 3, H);
    }
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p), z = 0.02 * push;
    return { bloom: 0.7, vignette: 0.5, halation: 0.05, zoom: 1 + z, shake: [0, -(420 - H / 2) * z * 0.5] };
  }

  /** 一個人：照時間軸換姿勢，每拍輕輕點一下、呼吸；手持鏡頭的微微晃動（兩格各自晃）；裁在自己那一格。 */
  private person(c: CanvasRenderingContext2D, t: number, keys: [number, string][], locks: Map<string, Lock>, x: number, pane: { x0: number; x1: number }, ph: number, kick: number) {
    if (t < this.tOpen - 0.1) return;
    const dx = 5 * Math.sin(t * 0.9 + ph * 7), dy = 4 * Math.sin(t * 1.3 + ph * 3);
    c.save();
    c.beginPath(); c.rect(pane.x0, 0, pane.x1 - pane.x0, H); c.clip();
    drawLocked(c, keys, t, x + dx, FEET + dy, { h: SZ, squash: 0.008 * kick + breathe(t, 0.006, 3.1, ph), rot: 0.006 * Math.sin(t * 0.7 + ph * 5), pivot: 0.6 }, locks);
    c.restore();
  }

  /** 窗外的城市燈在拍點零星開關、立燈跟著大鼓亮一下、休息室的日光燈在小鼓閃一下、鐘的秒針每拍跳一格。 */
  private ambience(c: CanvasRenderingContext2D, t: number, f: Frame) {
    const au = this.ctx.audio;
    const bi = Math.floor(au.beatAt(t) + 1e-6);
    c.fillStyle = mixRgba('bone', 'ember', 0.5, 0.45);
    this.cityLights.forEach((p, i) => { if (hash(i, bi) > 0.6) c.fillRect(p.x, p.y, 4, 6); });
    const em = LIN.ember, lamp = 0.5 + 0.5 * f.a.kick;
    this.glow.seg2(250, 470, 250.1, 470, 22, [em[0] * 0.6 * lamp, em[1] * 0.45 * lamp, em[2] * 0.3 * lamp], 0.5);
    // 日光燈：一條細長的燈管，小鼓時閃一下
    const fl = 0.75 + 0.25 * (1 - f.a.snare);
    const bn = LIN.bone;
    this.glow.seg2(1080, 28, 1620, 28, 5, [bn[0] * 1.1 * fl, bn[1] * 1.15 * fl, bn[2] * 1.25 * fl], 0.9);
    // 鐘：時針、分針不動（23:41），秒針每拍跳一格
    const sec = (bi % 60) / 60 * Math.PI * 2 - Math.PI / 2;
    c.strokeStyle = rgba('bone', 0.6); c.lineCap = 'round';
    c.lineWidth = 4; c.beginPath(); c.moveTo(1400, 110); c.lineTo(1400 + Math.cos(-Math.PI / 2 + (11.68 / 12) * Math.PI * 2) * 22, 110 + Math.sin(-Math.PI / 2 + (11.68 / 12) * Math.PI * 2) * 22); c.stroke();
    c.lineWidth = 3; c.beginPath(); c.moveTo(1400, 110); c.lineTo(1400 + Math.cos(-Math.PI / 2 + (41 / 60) * Math.PI * 2) * 32, 110 + Math.sin(-Math.PI / 2 + (41 / 60) * Math.PI * 2) * 32); c.stroke();
    c.strokeStyle = rgba('signal', 0.8); c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(1400, 110); c.lineTo(1400 + Math.cos(sec) * 36, 110 + Math.sin(sec) * 36); c.stroke();
    c.lineCap = 'butt';
  }

  /** 比愛心：小節線上從愛心的下尖往上、左右兩半同時描（左半在左格、右半在右格），在上面的凹口接起來；停一拍半後淡掉，凹口冒小愛心。 */
  private drawHeart(c: CanvasRenderingContext2D, t: number, th: number, bp: number) {
    const d = t - th;
    if (d < 0 || d > bp * 3) return;
    const draw = ease.outCubic(clamp(d / (bp * 0.8)));
    const fade = 1 - clamp((d - bp * 2) / bp);
    const n = this.heartPath.length, half = Math.floor((n - 1) / 2);
    // heartPoints 從下尖開始：前半是左半邊（下尖 → 上面的凹口）、後半是右半邊（凹口 → 下尖）；兩邊都從下尖往上描
    const left = this.heartPath.slice(0, half + 1), right = this.heartPath.slice(half).reverse();
    const sg = LIN.signal;
    for (const side of [right, left]) {
      const m = Math.max(2, Math.round(side.length * draw));
      this.glow.polyline(side.slice(0, m), 3, [sg[0] * 2.4, sg[1] * 2.4, sg[2] * 2.4], 0.9 * fade);
    }
    heartPop(c, this.heart.x, this.heart.y + this.heart.s * 0.1, 34, (d - bp * 0.8) / (bp * 2));
  }

  /** 訊息泡泡：第二拍先跳出「…」輸入中（點點照拍子跳），下一拍泡泡彈出來、一個字一個字打出來，署名最後淡入。 */
  private drawBubble(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n || t < this.tOpen) return;
    const au = this.ctx.audio;
    const B = this.bubble;
    const typing = this.msgT0 - au.beatPeriod(t);
    if (t < this.msgT0) {
      if (t < typing) return;
      // 輸入中：一個小泡泡、三個點
      c.fillStyle = rgba('bone', 0.82);
      c.beginPath(); c.roundRect(B.x, B.y, 110, 56, 28); c.fill();
      for (let k = 0; k < 3; k++) {
        const up = Math.max(0, Math.sin((t * 6 - k * 0.8)));
        c.fillStyle = rgba('ink', 0.55);
        c.beginPath(); c.arc(B.x + 32 + k * 23, B.y + 30 - up * 5, 6, 0, Math.PI * 2); c.fill();
      }
      return;
    }
    const pop = ease.outBack(clamp((t - this.msgT0) / 0.25));
    c.save();
    c.translate(B.x, B.y + B.h);
    c.scale(0.85 + 0.15 * pop, 0.85 + 0.15 * pop);
    c.translate(-B.x, -B.y - B.h);
    c.globalAlpha = clamp(pop * 1.5);
    // 泡泡：半透明紙白、圓角、左下一個小尾巴
    c.fillStyle = rgba('bone', this.msg ? 0.9 : 0.72);
    c.beginPath(); c.roundRect(B.x, B.y, B.w, B.h, 30); c.fill();
    c.beginPath(); c.moveTo(B.x + 26, B.y + B.h - 4); c.lineTo(B.x + 8, B.y + B.h + 22); c.lineTo(B.x + 64, B.y + B.h - 4); c.fill();
    const total = msgChars(n.fit);
    const per = clamp(1.4 / Math.max(1, total), 0.03, 0.09);
    const done = this.msgT0 + 0.2 + total * per;
    drawNote(c, n, B.x + BPAD.x, B.y + BPAD.top + Math.max(0, (B.h - BPAD.top - BPAD.bottom - n.height) * 0.5), {
      chars: this.msg ? (t - this.msgT0 - 0.2) / per : Infinity, color: this.msg ? rgba('ink', 0.92) : rgba('ink', 0.6), sigColor: rgba('ink', 0.62), sigK: prog(t, done + 0.1, done + 0.5),
    });
    c.restore();
  }

  /** 雙語即時字幕：畫面下方正中間，中文在上、原文（有翻譯時）在正下方，各照各的逐字時間亮；純音樂時只有一個小小的 ♪。 */
  private drawCaption(c: CanvasRenderingContext2D, t: number, lyrics: Lyrics) {
    const k0 = prog(t, this.tOpen, this.tOpen + 0.4);
    const ly = lyricAt(lyrics, t);
    if (!ly) {
      if (!lyrics.has) {
        c.font = font(F.hei(500), 34);
        c.fillStyle = rgba('bone', 0.4 * k0);
        c.textAlign = 'center';
        c.fillText('♪', CAP.x, CAP.base - 10);
        c.textAlign = 'left';
      }
      return;
    }
    const big = !this.msg;
    const st = { family: F.archivo(100, big ? 800 : 700), size: this.lyricSize, minSize: 40, maxWidth: CAP.w, align: 'center' as const, unsung: rgba('bone', 0.4), sung: rgba('bone', big ? 0.96 : 0.9), active: rgba('signal') };
    const lay = layoutLyric(c, ly.line, st);
    const y0 = CAP.base - (lay.height - lay.size);
    // 字幕底：視訊通話的字幕都墊一塊半透明深色圓角底，字壓在衣服上（卡其褲、白 T）才讀得到；寬度跟著這一句
    const [bx, by, bw, bh] = lyricBlock(CAP.x, y0, lay, lay.sub);
    if (bw > 0) {
      c.fillStyle = rgba('ink', 0.6 * ly.k * k0);
      c.beginPath(); c.roundRect(bx - 22, by - 12, bw + 44, bh + 22, 14); c.fill();
    }
    c.save();
    c.translate(CAP.x, y0);
    drawLyric(c, ly.line, t, st, lay, ly.k * k0);
    c.restore();
  }
}
