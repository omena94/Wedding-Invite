// 安裝進度（批次 T6・螢幕 B，暗）：「正在安裝：婚姻 v1.0」。
// MV 檢修後：一台螢幕擺在暗房裡，鏡頭從側面慢慢橫移過去；螢幕上只剩最少的東西——
//  - 主打留言就是這一版的「更新內容」：手寫字、螢幕上最大最亮（焦點）；署名在下面。
//  - 一條細細的進度條，尖端是仙女棒的火花：一拍往前衝一下；衝到 99% 就卡住（冷面笑話：剩餘時間「一輩子」），
//    大鼓一打螢幕跟著抖；最後一個小節線才跳到 100%：整條亮起來、閃一下、鏡頭往前一推，標籤改成「安裝完成」。
//  - 歌詞在進度條下面（逐字跟唱，小一級）；純音樂時寫正在安裝的元件（早餐輪流做.dll、兩人份的鑰匙……）。
//  - 小字只有兩群：左上的「正在安裝　婚姻 v1.0」、進度條旁的百分比與剩餘時間。
// 手法：螢幕內容畫在一張 Canvas 層（mipmap），用 _t6 的 ScreenRig 擺進三維空間（邊框、玻璃反光、景深）；
// 房間是一個 GLSL pass（螢幕的光灑在桌面與牆上、遠處一團很淡的暖光），火花用 LineBatch。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog, frameIdx } from '../engine/util';
import type { FitResult } from '../engine/text';
import type { Lyrics } from '../engine/lyrics';
import { lyricAt, drawLyric, layoutLyric, sparkHead, sparkParticles, beatAfter, signature, drawMessage } from './_motifs';
import { beatsIn, lastBeatBefore, fitMessage, inOut, ScreenRig, mipRT, blitToRT, loadPlateText } from './_t6';

export const spec: PlateSpecDecl = { group: 'type', family: 'screen', paper: false, energy: [0.35, 1], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 螢幕（貼圖座標，y 向下）
const SW = 1600, SH = 900;
const MX = 110; // 左右邊界
const LABEL_Y = 104;
const MSG_BOX = { x: MX, y: 150, w: SW - 2 * MX, h: 400 }; // 留言（含署名）
const BAR = { x: MX, y: 640, w: SW - 2 * MX, h: 10 };
const LYR_Y = 790; // 歌詞基線
/** 純音樂時「正在寫入」輪流寫這些（一小節換一個）。 */
const LOG = ['解壓縮　默契.pkg', '安裝　早餐輪流做.dll', '設定　兩人份的鑰匙', '更新　芃芃與 QQ 驅動程式', '套用　吵架後先道歉.patch', '最佳化　一起散步的路線', '清除　單身暫存檔', '註冊　永久授權'];
const TEXT = `正在安裝婚姻完成剩餘時間一輩子約拍還沒有留言掃描右下角把你的祝福加進下一版${LOG.join('')}`;

// 房間：很暗；螢幕的光灑在它前面的桌面（下方一片）與後面的牆（一圈），遠處左上一團很淡的暖光（失焦的燈）
const BG = () => new FSPass(/* glsl */ `
  uniform vec2 c; uniform vec2 r; uniform float glow; uniform float k;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 d = (p - c) / r;
    float wall = exp(-dot(d, d) * 0.9);
    float desk = smoothstep(c.y + r.y * 0.62, c.y + r.y * 0.9, p.y) * exp(-pow((p.x - c.x) / (r.x * 1.1), 2.0));
    vec2 lamp = (p - vec2(220.0, 150.0)) / 260.0;
    vec3 col = C_INK * 0.75 + (C_INK2 - C_INK * 0.75) * (0.3 + 1.2 * wall * glow) + C_BONE * 0.03 * desk * glow;
    col += C_BLOOD * 0.12 * exp(-dot(lamp, lamp) * 1.4);
    col += (C_INK2 - C_INK) * 0.2 * fbm(p / 480.0, 3);
    fragColor = vec4(col * mix(0.5, 1.0, k), 1.0);
  }`, { c: { value: new THREE.Vector2(900, 520) }, r: { value: new THREE.Vector2(900, 560) }, glow: { value: 1 }, k: { value: 1 } });

interface Prog { v: number; shown: number; prev: number; u: number; tj: number }

export default class Loading extends Scene {
  bg = shared('loading.bg', BG);
  scr = this.track(new Layer2D(SW, SH, undefined, { fast: true }));
  scrRT = this.track(mipRT(SW, SH));
  rig = new ScreenRig(this.scrRT.texture, SW, SH, { decode: false, bezel: 26, radius: 16 });
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  beats: number[] = []; // b0 … t99 的拍點
  vals: number[] = []; // 每一拍跳到的百分比
  b0 = 0; t99 = 0; t100 = 0; tMsg = 0;
  fit: FitResult | null = null;
  seed = 0;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadPlateText(this.ctx, TEXT);
    this.seed = (this.ctx.params.seed ?? 1) % 1000;
    const b0 = this.b0 = beatAfter(au, s + 0.05);
    const beat = au.beatPeriod(b0);
    // 100%：最後一個「後面還有一拍多」的小節線；窗格太短就用最後一拍。99% 先卡住一小節（短窗格兩拍）
    let t100 = au.timeOfBar(Math.floor(au.barAt(e - Math.max(0.9, beat * 1.1)) + 1e-6));
    if (t100 < b0 + 5 * beat) t100 = lastBeatBefore(au, e, Math.max(0.55, beat * 0.9));
    this.t100 = Math.max(t100, b0 + beat);
    this.t99 = Math.max(b0 + beat * 0.5, this.t100 - (this.t100 - b0 >= 10 * beat ? 4 : 2) * beat);
    this.beats = beatsIn(au, b0, this.t99 + 0.01);
    if (!this.beats.length) this.beats = [b0];
    // 每一拍的增量：亂數權重、前面快後面慢（真的安裝程式都這樣），最後一拍剛好 99
    const n = this.beats.length;
    const w = this.beats.map((_, i) => 0.55 + hash(this.seed, i) * 1.1);
    const tot = w.reduce((a, b) => a + b, 0);
    let acc = 0;
    this.vals = w.map((x, i) => {
      acc += x;
      if (i === n - 1) return 99;
      return Math.min(98, Math.round(2 + 96 * Math.pow(acc / tot, 0.8)));
    });
    this.tMsg = b0 + Math.min(beat * 0.5, 0.3);
    const c = this.scr.ctx;
    const text = this.msg ? this.msg.text : '這一版還沒有新的祝福。掃描右下角 QR code，把你的祝福加進下一版';
    // 留言：署名另外佔一行；沒有留言時的邀請小一號（焦點讓給歌詞）
    this.fit = fitMessage(c, text, F.hand(400), MSG_BOX.w, MSG_BOX.h - (this.msg ? 70 : 0), { min: 52, max: this.msg ? 132 : 58, lineHeight: 1.26 });
  }

  override dispose() { this.rig.dispose(); super.dispose(); }

  /** t 時的進度（0..100，連續的，給進度條）與顯示的整數、上一個整數、跳動的係數。 */
  private progress(t: number): Prog {
    if (t < this.b0) return { v: 0, shown: 0, prev: 0, u: 1, tj: this.ctx.start };
    if (t >= this.t100) {
      const u = prog(t, this.t100, this.t100 + 0.22, ease.outExpo);
      return { v: lerp(99, 100, u), shown: 100, prev: 99, u, tj: this.t100 };
    }
    let i = 0;
    while (i + 1 < this.beats.length && this.beats[i + 1]! <= t) i++;
    const tj = this.beats[i]!, prev = i > 0 ? this.vals[i - 1]! : 0, cur = this.vals[i]!;
    const u = prog(t, tj, tj + 0.2, ease.outExpo);
    return { v: lerp(prev, cur, u), shown: cur, prev, u, tj };
  }

  /** 鏡頭：從右往左慢慢橫移、螢幕左邊往後退；100% 時往前一推；卡住時跟著大鼓抖。 */
  private pose(t: number, kick: number, stalled: boolean) {
    const s = this.ctx.start, e = this.ctx.end;
    const u = ease.inOutCubic(clamp((t - s) / Math.max(1, e - s)));
    const done = t >= this.t100 ? ease.outExpo(clamp((t - this.t100) / 0.5)) : 0;
    const fi = frameIdx(t);
    const jit = stalled ? kick * 3 : 0;
    const scale = lerp(0.86, 0.92, u) * (1 + 0.04 * done);
    this.rig.pose({
      fx: SW * 0.46, fy: SH * 0.5, cx: lerp(930, 870, u) + jit * (hash(fi, 1) - 0.5), cy: 520 + jit * (hash(fi, 2) - 0.5),
      scale, rx: -0.06, ry: lerp(-0.3, -0.2, u), rz: 0.01,
    });
    // 對焦：留言與進度條那一段清楚，四邊（尤其往後退的左邊）慢慢糊
    this.rig.focus(MX * 0.5, 60, SW - MX * 0.5, SH - 50, 120);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const k = inOut(t, s, e, 0.3, 0.3);
    const pr = this.progress(t);
    const stalled = t >= this.t99 && t < this.t100;
    const fin = t >= this.t100;
    this.pose(t, f.a.kick, stalled);
    const c0 = this.rig.toScreen(SW / 2, SH / 2), c1 = this.rig.toScreen(SW, SH);
    (this.bg.u.c!.value as THREE.Vector2).set(c0.x, c0.y);
    (this.bg.u.r!.value as THREE.Vector2).set(Math.abs(c1.x - c0.x) * 1.5, Math.abs(c1.y - c0.y) * 1.6);
    this.bg.u.glow!.value = 1 + (fin ? 0.6 * Math.exp(-(t - this.t100) * 4) : 0);
    this.bg.u.k!.value = k;
    this.bg.render(renderer, out);
    const tip = this.drawScreen(t, pr, stalled, fin);
    blitToRT(renderer, this.ctx.comp, this.scr.texture, this.scrRT);
    const U = this.rig.u;
    (U.backCol!.value as THREE.Vector3).set(LIN.ink2[0] * 1.1, LIN.ink2[1] * 1.1, LIN.ink2[2] * 1.1);
    (U.bezelCol!.value as THREE.Vector3).set(LIN.ink[0] * 0.55, LIN.ink[1] * 0.55, LIN.ink[2] * 0.55);
    (U.rimCol!.value as THREE.Vector3).set(...LIN.bone);
    U.glare!.value = -0.1 + 0.35 * f.p;
    U.k!.value = k;
    this.rig.render(renderer, out);
    // 火花：進度條的尖端（每一拍往前衝的時候噴得最多；卡住時只剩零星幾點）
    this.glow.clear();
    if (tip && k > 0.5) {
      const at = (tt: number) => this.rig.toScreen(BAR.x + BAR.w * this.progress(tt).v / 100, BAR.y + BAR.h / 2);
      const p = this.rig.toScreen(tip.x, tip.y);
      sparkParticles(this.glow, t, at, { rate: (tb) => (tb >= this.t99 ? 22 : 50 + 120 * (1 - this.progress(tb).u)), rateMax: 170, life: 0.35, speed: 200, seed: 3 });
      sparkHead(this.glow, p.x, p.y, t, stalled ? 0.7 + 0.35 * f.a.kick : 0.95);
    }
    if (this.glow.count) this.glow.render(renderer, out);
    return { bloom: 0.65, vignette: 0.55, flash: fin ? 0.1 * Math.exp(-(t - this.t100) * 7) : 0 };
  }

  /** 畫螢幕內容；回傳進度條尖端（貼圖座標），完成後是 null。 */
  private drawScreen(t: number, pr: Prog, stalled: boolean, fin: boolean): { x: number; y: number } | null {
    const L = this.scr; L.clear();
    const c = L.ctx;
    const au = this.ctx.audio;
    c.textBaseline = 'alphabetic';
    // 左上的標籤（小、低對比）：正在安裝 → 安裝完成（打勾）
    c.font = font(F.hei(500), 26); c.letterSpacing = '4px';
    c.fillStyle = fin ? rgba('signal', 0.85) : rgba('ash', 0.6);
    c.fillText(fin ? '安裝完成　婚姻 v1.0' : '正在安裝　婚姻 v1.0', MX, LABEL_Y);
    c.letterSpacing = '0px';
    // 主打留言：第一拍後一行一行浮上來；署名在下面
    const fit = this.fit!;
    const nl = fit.lines.length;
    // 留言＋署名整塊在標籤與進度條之間垂直置中（短留言不會只擠在上面）
    const blockH = fit.height + (this.msg ? 84 : 0);
    const top = MSG_BOX.y + Math.max(0, (MSG_BOX.h + 40 - blockH) / 2) + fit.size * 0.95;
    fit.lines.forEach((ln, i) => {
      const ku = prog(t, this.tMsg + i * 0.12, this.tMsg + 0.5 + i * 0.12, ease.outCubic);
      if (ku <= 0) return;
      c.save(); c.globalAlpha *= ku;
      drawMessage(c, { ...fit, lines: [ln] }, F.hand(400), MX, top + i * fit.lineHeight + (1 - ku) * 24, { color: this.msg ? rgba('bone', 0.97) : rgba('bone', 0.5) });
      c.restore();
    });
    if (this.msg) {
      const ka = prog(t, this.tMsg + 0.3 + nl * 0.12, this.tMsg + 0.8 + nl * 0.12);
      c.save(); c.globalAlpha *= ka;
      c.font = font(F.hand(400), 46); c.fillStyle = rgba('ash', 0.95);
      c.fillText(signature(this.msg.name), MX + 6, top + (nl - 1) * fit.lineHeight + 84);
      c.restore();
    }
    // 進度條：細細一條；卡住時尖端跟著大鼓亮；完成時整條亮起來
    const p = pr.v / 100;
    c.fillStyle = rgba('bone', 0.12); c.fillRect(BAR.x, BAR.y, BAR.w, BAR.h);
    c.fillStyle = fin ? rgba('signal', 0.95) : rgba('signal', 0.8);
    c.fillRect(BAR.x, BAR.y, BAR.w * p, BAR.h);
    // 百分比與剩餘時間（小字，一群）
    const beatsLeft = Math.max(0, Math.round(au.beatAt(this.t99) - au.beatAt(t)));
    c.font = font(F.archivo(75, 700), 40); c.textAlign = 'right';
    c.fillStyle = rgba(fin ? 'signal' : 'bone', fin ? 0.9 : 0.55);
    c.fillText(`${pr.shown}%`, BAR.x + BAR.w, BAR.y - 26);
    c.font = font(F.hei(500), 24); c.fillStyle = rgba(stalled ? 'signal' : 'ash', stalled ? 0.8 : 0.5); c.letterSpacing = '2px';
    c.fillText(fin ? '重新開機後生效：永遠' : stalled ? '剩餘時間：一輩子' : `剩餘時間：約 ${beatsLeft} 拍`, BAR.x + BAR.w, BAR.y + BAR.h + 42);
    c.textAlign = 'left'; c.letterSpacing = '0px';
    this.drawLyric(c, t);
    L.upload();
    return fin || t < this.b0 ? null : { x: BAR.x + BAR.w * p, y: BAR.y + BAR.h / 2 };
  }

  /** 歌詞（逐字跟唱，比留言小一級）；純音樂或兩句之間寫正在安裝的元件。 */
  private drawLyric(c: CanvasRenderingContext2D, t: number) {
    const lyrics: Lyrics = this.ctx.lyrics;
    const ly = lyricAt(lyrics, t);
    const size = this.msg ? 60 : 72;
    if (ly) {
      const st = { family: F.archivo(100, 800), size, minSize: 54, maxWidth: SW - 2 * MX, lineHeight: 1.12 };
      const lay = layoutLyric(c, ly.line, st);
      c.save(); c.translate(MX, LYR_Y - (lay.height - lay.size));
      drawLyric(c, ly.line, t, st, lay, ly.k);
      c.restore();
    } else {
      const au = this.ctx.audio;
      const i = Math.floor(au.barAt(t));
      const item = LOG[((i % LOG.length) + LOG.length) % LOG.length]!;
      const u = prog(au.barAt(t) - i, 0, 0.12, ease.outExpo);
      c.save(); c.globalAlpha *= u;
      c.font = font(F.hei(700), 50); c.fillStyle = rgba('bone', lyrics.has ? 0.3 : 0.6);
      c.fillText(item, MX, LYR_Y);
      c.restore();
    }
  }
}
