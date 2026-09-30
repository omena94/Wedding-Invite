// 午睡（亮、dog、慢歌）：午後的客廳，宣文與孟庭靠在沙發上睡著了，QQ 翻著肚子睡在沙發上；地毯上元元（白色柴犬）側躺著睡，
// 芃芃縮成一顆甜甜圈窩在元元的肚子邊，把牠當枕頭。
// 角色是 Codex 畫的紙偶（_puppet.ts）。
//  - **呼吸起伏跟著節拍**：每小節一次深呼吸（吸兩拍、吐兩拍），大家一起起伏；元元是大狗，呼吸起伏最大，
//    靠在牠肚子上的芃芃跟著牠一起一上一下；狗睡到一半腳抖一下（拍點上），元元每兩小節耳朵抖一下（夢到什麼）。
//    每兩小節宣文醒來偷看孟庭一眼（cp_nap_peek，一小節），又睡回去。
//  - **夢泡泡裡是留言**：從孟庭頭上冒出三顆小泡泡、一朵雲（在拍點上一顆一顆冒出來），雲裡寫著主打留言（深墨手寫字、署名）；
//    照「留言尺寸與版面比例標準 v2」：字 40～60、雲最大 740 × 400、在畫面右上，寬高跟著留言。沒有留言時雲裡寫邀請。
//  - 歌詞是從宣文頭上飄出來的一行字（旁邊幾個小小的 z），照跟唱規則逐字亮；比留言小一級（標準 v2：40～52）。
//  - 窗簾縫裡的陽光：牆上幾道斜斜的光慢慢移、窗簾跟著風輕輕晃；鏡頭慢慢推近夢泡泡。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, barAfter, beatAfter, sparkHead, sparkParticles, msgChars } from './_motifs';
import { inkFor, paperBG, inkLine, inkPoly, inkShape, inkEllipse, drawNote, type Pt, type Note, type Ink } from './_couple';
import { loadPuppets, drawPuppet, drawPick, puppetPoint, puppetShadow, puppetIn, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'couple', family: 'dog', paper: true, energy: [0, 0.6], bars: [4, 8] };

const FLOOR = 930;
const SZ = 600;
/** 兩人坐在沙發上的中心（腳底踩在地上）；座墊的高度是腳底往上 HIP 倍的坐姿高度（量 cp_nap 的圖：大腿在這個高度）。 */
const CX = 900, HIP = 0.4;
/** 坐姿的高度（cp_nap 的 height 0.8 × 場景尺度）。 */
const SIT = SZ * 0.8;
/** 沙發：左右、椅背頂。 */
const SOFA = { x0: 470, x1: 1260, back: 500 };
const QQ_X = 640;
/** 地毯上：元元側躺（頭朝右），芃芃窩在牠的肚子邊（前面一點、低一點）。 */
const YY_X = 1160, PP_X = 1090;
/** 夢泡泡的雲：最大範圍（標準 v2）與寫字的內距。 */
const CLOUD = { right: 1830, top: 96, w: 860, h: 430 };
/**
 * 雲是橢圓：字的方框要整個在橢圓裡面，四個角才不會超出雲的邊（方框的半寬、半高 × √2 ≈ 橢圓的半軸）。
 * 所以字的範圍最大 590 × 290，雲再照實際的字放大 SQ 倍（多留一點給雲邊的起伏）。
 */
const TEXT = { w: 590, h: 290 };
const SQ = 1.5;
/** 歌詞的中心與基線（窗戶和夢泡泡之間、宣文頭上）。 */
const LYR = { x: 730, y: 300 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const SPRITES = ['cp_nap', 'cp_nap_peek', 'pp_nap', 'qq_nap', 'yy_sleep'];

export default class DogNap extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(512, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  keys: [number, string][] = [];
  note: Note | null = null;
  cloud = { x: 0, y: 0, w: CLOUD.w, h: CLOUD.h };
  /** 雲裡寫字的方框（置中）。 */
  textBox = { x: 0, y: 0, w: TEXT.w, h: TEXT.h };
  /** 三顆小泡泡冒出來的時間（拍點）與雲長出來的時間。 */
  puffs: number[] = [];
  seat = FLOOR - SIT * HIP;
  omHead: Pt = { x: 0, y: 0 };
  alHead: Pt = { x: 0, y: 0 };
  lyricSize = 48;
  msgT0 = 0;

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('一位賓客' + INVITE + 'zZ');
    this.track(await loadPuppets(SPRITES));
    const s = this.ctx.start, e = this.ctx.end;
    // 每兩小節宣文偷看一次（一小節）
    this.keys = [[-1e9, 'cp_nap']];
    for (let t = barAfter(au, s + 0.5, 1); t < e - 0.5; t = au.timeOfBar(Math.round(au.barAt(t)) + 2)) {
      this.keys.push([t, 'cp_nap_peek'], [au.timeOfBar(Math.round(au.barAt(t)) + 1) - au.beatPeriod(t) * 0.3, 'cp_nap']);
    }
    // 兩個人的頭（夢泡泡、歌詞從這裡冒出來）：照圖上的道具點，沒有就照比例估
    const o: PuppetOpts = { h: SZ };
    this.omHead = puppetPoint('cp_nap', 'omena', CX, FLOOR, o) ?? { x: CX + SIT * 0.12, y: FLOOR - SIT * 0.8 };
    this.alHead = puppetPoint('cp_nap', 'alan', CX, FLOOR, o) ?? { x: CX - SIT * 0.14, y: FLOOR - SIT * 0.9 };
    // 夢泡泡：三顆小泡泡一拍一顆冒出來，第四拍雲長出來、開始寫字
    const b0 = beatAfter(au, s + 0.4);
    const bi = Math.round(au.beatAt(b0));
    this.puffs = [0, 1, 2, 3].map((k) => au.timeOfBeat(bi + k));
    this.msgT0 = this.puffs[3]! + 0.15;
    // 雲裡的留言：標準 v2 的字級；雲的寬高跟著留言（右緣、上緣固定）
    const c = this.fg.ctx;
    const w = TEXT.w, hmax = TEXT.h;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const tw = tightenNote(c, this.note, 260), th = this.note.height;
    const cw = Math.min(CLOUD.w, Math.max(420, tw * SQ)), ch = Math.min(CLOUD.h, Math.max(230, th * SQ));
    this.cloud = { x: CLOUD.right - cw, y: CLOUD.top, w: cw, h: ch };
    this.textBox = { x: CLOUD.right - cw / 2 - tw / 2, y: CLOUD.top + ch / 2 - th / 2, w: tw, h: th };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.drawBackground();
  }

  /** 不會動的：牆、窗與窗簾框、地板、地毯、沙發（畫一次）。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx, ink = inkFor(true);
    L.clear();
    // 右下角 HUD（x ≥ 1360、y ≥ 830）留乾淨：背景的線都不畫進去
    c.save();
    c.beginPath(); c.rect(0, 0, W, H); c.rect(1344, 816, W - 1344, H - 816); c.clip('evenodd');
    // 地板與牆腳
    inkLine(c, [{ x: 0, y: FLOOR - 70 }, { x: W, y: FLOOR - 70 }], { ink, w: 0.8, seed: 1 });
    c.strokeStyle = rgba('sepia', 0.1); c.lineWidth = 1.2;
    c.beginPath();
    for (let k = -8; k <= 14; k++) { const x0 = 900 + k * 120, x1 = 900 + k * 200; c.moveTo(x0, FLOOR - 70); c.lineTo(x1, H); }
    c.stroke();
    // 地毯（芃芃睡在上面）：一塊扁扁的橢圓
    inkEllipse(c, 1000, FLOOR + 36, 330, 54, 0, { ink, fill: mixRgba('paper', 'rose', 0.07), w: 0.6, seed: 3, color: rgba('sepia', 0.5) });
    c.restore();
    // 窗（左上）：窗框、兩片窗簾（窗簾的晃動每格畫）
    inkPoly(c, [{ x: 90, y: 120 }, { x: 330, y: 120 }, { x: 330, y: 520 }, { x: 90, y: 520 }], { ink, fill: mixRgba('paper', 'bone', 0.6), w: 0.9, seed: 4 });
    inkLine(c, [{ x: 210, y: 120 }, { x: 210, y: 520 }], { ink, w: 0.6, seed: 5 });
    inkLine(c, [{ x: 90, y: 320 }, { x: 330, y: 320 }], { ink, w: 0.6, seed: 6 });
    // 沙發：椅背、兩邊扶手、座墊（兩人坐在上面）
    const seat = this.seat, S = SOFA;
    const fabric = mixRgba('paper', 'gingham', 0.4), shade = mixRgba('paper', 'gingham', 0.55);
    inkShape(c, [{ x: S.x0 + 40, y: seat + 10 }, { x: S.x0 + 30, y: S.back + 30 }, { x: S.x0 + 80, y: S.back }, { x: S.x1 - 80, y: S.back }, { x: S.x1 - 30, y: S.back + 30 }, { x: S.x1 - 40, y: seat + 10 }], { ink, fill: fabric, w: 1, seed: 7 });
    // 靠墊的分隔
    inkLine(c, [{ x: (S.x0 + S.x1) / 2, y: S.back + 20 }, { x: (S.x0 + S.x1) / 2, y: seat }], { ink, w: 0.5, seed: 8, color: rgba('sepia', 0.4) });
    // 座墊的正面
    inkPoly(c, [{ x: S.x0 + 10, y: seat }, { x: S.x1 - 10, y: seat }, { x: S.x1 - 14, y: FLOOR - 70 }, { x: S.x0 + 14, y: FLOOR - 70 }], { ink, fill: shade, w: 0.9, seed: 9 });
    // 沙發腳
    for (const x of [S.x0 + 40, S.x1 - 40]) inkLine(c, [{ x, y: FLOOR - 70 }, { x: x + (x < CX ? -6 : 6), y: FLOOR - 42 }], { ink, w: 1.4, seed: x });
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.paper.render(renderer, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const ink = inkFor(true);
    const rv = prog(t, s, s + 0.8, ease.inOutCubic);
    this.drawLight(c, t);
    comp.draw(renderer, this.bg.texture, out);
    // 呼吸：每小節一次（吸兩拍、吐兩拍）
    const breath = Math.sin(f.barPhase * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5;

    // ---- 扶手（蓋在兩人的旁邊）、兩個人、QQ（沙發上）、芃芃（地毯上）
    const en = puppetIn(t, s + 0.05, 0.6);
    if (en.alpha > 0) {
      drawPick(c, this.keys, t, CX, FLOOR, { h: SZ, spin: en.spin, alpha: en.alpha, squash: -0.012 * breath, pivot: 0.4 });
      if (en.k < 1) { sparkHead(this.glow, CX, FLOOR - 6, t, 0.8); sparkParticles(this.glow, t, () => ({ x: CX, y: FLOOR - 6 }), { rate: 60, life: 0.3, speed: 150 }); }
    }
    this.drawArms(c, ink);
    const enD = puppetIn(t, s + 0.25, 0.5);
    if (enD.alpha > 0) {
      // 狗睡到一半腳抖一下：每小節的第三拍
      const bb = Math.floor(au.beatAt(t) + 1e-6), tb = au.timeOfBeat(bb);
      const twitch = ((bb % 4) + 4) % 4 === 2 ? Math.exp(-(t - tb) / 0.12) * Math.sin((t - tb) * 60) : 0;
      drawPuppet(c, 'qq_nap', QQ_X, this.seat + 6, { h: SZ, scale: 1.05, spin: enD.spin, alpha: enD.alpha, squash: -0.03 * breath, rot: 0.03 * twitch, pivot: 0.3 });
      // 元元：側躺在地毯上，呼吸起伏最大；每兩小節的第一拍耳朵（頭）抖一下
      const bar = Math.floor(au.barAt(t) + 1e-6), tbar = au.timeOfBar(bar);
      const flick = bar % 2 === 0 ? Math.exp(-(t - tbar) / 0.1) * Math.sin((t - tbar) * 70) : 0;
      puppetShadow(c, 'yy', YY_X, FLOOR + 22, { h: SZ * 1.05, alpha: 0.22 * enD.alpha, wide: 0.9, color: '70,45,25' });
      drawPuppet(c, 'yy_sleep', YY_X, FLOOR + 22, { h: SZ, scale: 1.05, spin: enD.spin, alpha: enD.alpha, squash: -0.06 * breath, rot: 0.012 * flick, pivot: 0.5 });
      // 芃芃窩在元元的肚子邊：跟著元元的呼吸一起一上一下
      puppetShadow(c, 'pp', PP_X, FLOOR + 40, { h: SZ * 1.05, alpha: 0.2 * enD.alpha, color: '70,45,25' });
      drawPuppet(c, 'pp_nap', PP_X, FLOOR + 40 - 5 * breath, { h: SZ, scale: 1.05, spin: enD.spin, alpha: enD.alpha, squash: -0.03 * (1 - breath) + 0.02 * Math.abs(twitch) });
    }

    // ---- 歌詞：從宣文頭上飄出來的一行字（旁邊幾個小小的 z）
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const st = { family: F.hand(700), size: this.lyricSize, minSize: 40, maxWidth: 700, align: 'center' as const, unsung: rgba('sepia', 0.26), sung: rgba('sepia', this.msg ? 0.78 : 0.92), active: rgba('signal') };
      const lay = layoutLyric(c, ly.line, st);
      const float = Math.sin(t * 0.9) * 6;
      c.save();
      c.translate(LYR.x, LYR.y + float);
      drawLyric(c, ly.line, t, st, lay, ly.k * rv);
      c.restore();
    }
    this.drawZ(c, t);
    this.drawDream(c, ink, t);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：慢慢推近夢泡泡（最多 1.03 倍）
    const push = ease.inOutCubic(f.p), C = this.cloud;
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.26, grain: 0.045, ca: 0.5, zoom: 1 + 0.03 * push, shake: [-(C.x + C.w / 2 - W / 2) * 0.03 * push, -(C.y + C.h / 2 - H / 2) * 0.03 * push] };
  }

  /** 沙發的兩邊扶手（蓋在兩人與 QQ 的外側）。 */
  private drawArms(c: CanvasRenderingContext2D, ink: Ink) {
    const S = SOFA, seat = this.seat;
    const fabric = mixRgba('paper', 'gingham', 0.45);
    for (const [x0, x1, sd] of [[S.x0 - 30, S.x0 + 70, 11], [S.x1 - 70, S.x1 + 30, 12]] as const) {
      inkShape(c, [{ x: x0, y: seat - 60 }, { x: x0 + 10, y: seat - 95 }, { x: x1 - 10, y: seat - 95 }, { x: x1, y: seat - 60 }, { x: x1 - 4, y: FLOOR - 70 }, { x: x0 + 4, y: FLOOR - 70 }], { ink, fill: fabric, w: 1, seed: sd });
    }
  }

  /** 窗簾縫的陽光：牆上幾道斜斜的暖光慢慢往旁邊移；窗簾輕輕晃。 */
  private drawLight(c: CanvasRenderingContext2D, t: number) {
    const drift = t * 4;
    c.save();
    for (let k = 0; k < 4; k++) {
      const x = 380 + k * 120 + (drift % 120);
      c.fillStyle = rgba('ember', 0.05 + 0.02 * Math.sin(t * 0.7 + k));
      c.beginPath(); c.moveTo(x, 140); c.lineTo(x + 50, 140); c.lineTo(x + 330, 860); c.lineTo(x + 280, 860); c.closePath(); c.fill();
    }
    c.restore();
    // 窗簾：兩片從窗框上緣垂下，下緣跟著風擺
    const ink = inkFor(true);
    for (const [x0, dir] of [[70, 1], [350, -1]] as const) {
      const sw = Math.sin(t * 0.8 + x0) * 12;
      inkPoly(c, [{ x: x0 - 22 * dir, y: 100 }, { x: x0 + 30 * dir, y: 100 }, { x: x0 + (26 + sw) * dir, y: 560 }, { x: x0 - (24 - sw * 0.5) * dir, y: 568 }], { ink, fill: mixRgba('paper', 'rose', 0.1), w: 0.6, seed: x0, color: rgba('sepia', 0.4) });
      // 布的摺痕：兩三條往下的淡線
      c.strokeStyle = rgba('sepia', 0.12); c.lineWidth = 1.2;
      c.beginPath();
      for (const f of [-0.3, 0.2, 0.6]) { c.moveTo(x0 + f * 40 * dir, 104); c.lineTo(x0 + (f * 40 + sw * 0.8) * dir, 560); }
      c.stroke();
    }
  }

  /** 宣文頭上飄起來的小小的 z（一拍一個、越飄越大越淡）。 */
  private drawZ(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const b = au.beatAt(t);
    c.save();
    c.font = font(F.serif(500, true), 28);
    c.fillStyle = rgba('sepia', 0.5);
    for (let k = 0; k < 3; k++) {
      const u = ((b + k) / 3) % 1;
      c.globalAlpha = Math.sin(Math.PI * u) * 0.6;
      c.font = font(F.serif(500, true), 22 + 18 * u);
      c.fillText('z', this.alHead.x - 30 - 40 * u, this.alHead.y - 30 - 130 * u);
    }
    c.restore();
  }

  /** 夢泡泡：三顆小泡泡從孟庭頭上一拍一顆冒出來，第四拍雲長出來（有一點彈性），雲裡一個字一個字寫出留言。 */
  private drawDream(c: CanvasRenderingContext2D, ink: Ink, t: number) {
    const C = this.cloud, h = this.omHead;
    const target = { x: C.x + C.w * 0.22, y: C.y + C.h - 6 };
    this.puffs.slice(0, 3).forEach((tp, k) => {
      if (t < tp) return;
      const u = (k + 1) / 4;
      const x = lerp(h.x + 20, target.x, u), y = lerp(h.y - 40, target.y, u) + Math.sin(t * 1.5 + k) * 4;
      const r = (10 + k * 8) * ease.outBack(clamp((t - tp) / 0.3));
      inkEllipse(c, x, y, r, r * 0.9, 0, { ink, fill: rgba('bone'), w: 0.6, seed: 70 + k, color: rgba('sepia', 0.6) });
    });
    const tc = this.puffs[3]!;
    if (t < tc) return;
    const g = ease.outBack(clamp((t - tc) / 0.45));
    const cx = C.x + C.w / 2, cy = C.y + C.h / 2 + Math.sin(t * 0.9) * 4;
    const pts: Pt[] = [];
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const bump = 1 + 0.07 * Math.sin(i * 2.7 + 1) * (i % 2 ? 1 : -0.4);
      pts.push({ x: cx + Math.cos(a) * (C.w / 2) * bump * g, y: cy + Math.sin(a) * (C.h / 2) * bump * g });
    }
    // 雲的邊：一圈小弧（像棉花糖），裡面淡淡的紙白
    inkShape(c, pts, { ink, fill: rgba('bone', 0.95), w: 0.9, seed: 80, color: rgba('sepia', 0.7) });
    const note = this.note;
    if (!note || g < 0.98) return;
    const total = msgChars(note.fit);
    const per = clamp(1.8 / Math.max(1, total), 0.03, 0.11);
    const done = this.msgT0 + total * per;
    const T = this.textBox;
    drawNote(c, note, T.x, T.y + Math.sin(t * 0.9) * 4, {
      chars: this.msg ? (t - this.msgT0) / per : Infinity, color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.62), sigColor: rgba('sepia', 0.74), sigK: prog(t, done + 0.1, done + 0.5),
    });
  }
}
