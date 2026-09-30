// 溜冰（暗、sport）：冬夜的戶外溜冰場，上面拉著一串串小燈泡、飄著細雪，對面是賣熱可可的小攤。宣文牽著孟庭在冰上來回滑。
// 角色是 Codex 畫的雙人紙偶（cp_skate_1／2／twirl，_puppet.ts）。
//  - 兩小節滑一趟（從左滑到右、或從右滑回左），起步慢、中間快、到頭慢下來；**每一拍蹬一下**（skate_1、skate_2 換腳，拍點上身體往前一送、壓一下）。
//  - 到頭的那個小節線：孟庭在宣文舉起的手下轉一圈（skate_twirl），整張紙偶翻面（spin 半圈）換方向，冰刀在腳邊刮起一小片冰屑。
//  - 冰刀在冰上畫出兩條會發光的細線（訊號色，越舊越淡），跟著兩個人的路；**歌詞刻在這條路下面的冰上**（lyricOnPath），
//    照跟唱規則逐字亮，比留言小一級（標準 v2：40～52）。
//  - 冰面是暗的鏡子：兩個人的倒影（上下翻、很淡、往下淡掉），燈泡與小攤的暖光在冰上拉出幾條光。
//  - **焦點是主打留言**：寫在右上熱可可小攤的黑板上（粉筆字、木框、攤子的燈照著它）；照「留言尺寸與版面比例標準 v2」：
//    字 40～60、黑板最大 620 × 400，高度跟著留言長短。黑板上只有一行小小的「熱可可 · HOT COCOA」。沒有留言時寫邀請。
//  - 小燈泡在 hi-hat 上一顆一顆閃；雪慢慢飄。鏡頭整個窗格慢慢推近、跟著兩個人往旁邊飄一點點。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { lyricAt, sparkHead, sparkParticles, msgChars, lyricSubOf } from './_motifs';
import { inkFor, inkLine, inkPoly, lyricOnPath, drawNote, type Pt, type Note, type Ink } from './_couple';
import { loadPuppets, drawPick, puppetShadow, puppetIn, puppetLight, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'sport', paper: false, energy: [0.2, 0.9], bars: [4, 8] };

const GROUND = 850;
const SZ = 440;
/** 滑的範圍（兩人紙偶的腳底 x）：到頭轉圈的地方。 */
const XL = 300, XR = 930;
/** 冰面從這裡開始（遠處的圍板下緣）。 */
const ICE = 610;
/** 熱可可小攤的黑板：最大範圍（標準 v2；靠右、上緣固定、高度跟著留言）與寫字的內距。 */
const BOARD = { x: 1180, y: 118, w: 620, h: 400 };
const PAD = { x: 40, top: 66, bottom: 30 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const LABEL = '熱可可 · HOT COCOA';
const POSES = ['cp_skate_1', 'cp_skate_2', 'cp_skate_twirl'];

/** 一趟：t0 從 x0 出發，t1 到 x1（到頭的小節線，在那裡轉圈）。 */
interface Leg { t0: number; t1: number; x0: number; x1: number }

/**
 * 夜空與冰面（shader：浮點＋抖色，淡漸層才不會一圈一圈）：天空往地平線稍微亮一點；冰面是暗的鏡子，
 * 小攤的暖光在冰上拉出一條直的倒影、燈串在冰上一條淡淡的橫光。
 */
const RINK = () => new FSPass(/* glsl */ `
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 col = C_INK;
    float sky = 1.0 - smoothstep(0.0, ${ICE}.0, p.y);
    col += C_BONE * 0.012 * smoothstep(${ICE - 360}.0, ${ICE}.0, p.y) * sky;
    // 小攤的燈（右上）
    vec2 q = (p - vec2(${BOARD.x + BOARD.w / 2}.0, ${BOARD.y + BOARD.h / 2}.0)) / vec2(520.0, 460.0);
    col += C_SIGNAL * 0.02 * exp(-dot(q, q) * 1.4) + C_BONE * 0.01 * exp(-dot(q, q) * 1.4);
    // 冰面：比夜空亮一點點的冷色、往近處變暗；暖光的直條倒影、燈串的橫光
    float ice = smoothstep(${ICE - 4}.0, ${ICE + 6}.0, p.y);
    float near = (p.y - ${ICE}.0) / ${H - ICE}.0;
    vec3 icec = mix(C_INK2, C_BONE, 0.022) * (1.0 - 0.4 * near);
    float streak = exp(-pow((p.x - ${BOARD.x + BOARD.w / 2}.0) / 120.0, 2.0)) * exp(-(p.y - ${ICE}.0) / 260.0);
    float band = exp(-pow((p.y - ${ICE + 40}.0) / 36.0, 2.0)) * (1.0 - smoothstep(1100.0, 1300.0, p.x));
    icec += C_SIGNAL * (0.05 * streak + 0.012 * band);
    col = mix(col, icec, ice);
    col += (hash12(p + 0.5) - 0.5) * 0.003;
    fragColor = vec4(col, 1.0);
  }`);

export default class Skating extends Scene {
  rink = shared('skating.rink', RINK);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(4096, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  /**
   * 有韓文原文的窗格（建構時就看：引擎只在建立這一格之前設好開關）：原文排在中文下面的冰面上，會太貼畫面下緣，
   * 整條歌詞往上抬一點（還在溜冰的刀痕下面）。平移整條弧（不用 offset：offset 會改到弧長，剛好放得下的句子會被折成兩排）。
   */
  lyrLift = this.ctx.lyrics.linesIn(this.ctx.start - 1, this.ctx.end + 1).some((l) => !!lyricSubOf(l)) ? 30 : 0;
  legs: Leg[] = [];
  keys: [number, string][] = [];
  lyricPath: Pt[] = [];
  note: Note | null = null;
  board = { ...BOARD };
  lyricSize = 52;

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('一位賓客' + INVITE + LABEL);
    this.track(await loadPuppets(POSES));
    // 一趟兩小節，到頭在小節線上；第一趟從畫面左邊滑進來，到第二個小節線（窗格太短就第一個）
    const b0 = Math.ceil(au.barAt(this.ctx.start + 0.3) - 1e-6);
    let t1 = au.timeOfBar(b0 + 1);
    if (t1 > this.ctx.end - 0.3) t1 = au.timeOfBar(b0);
    this.legs.push({ t0: this.ctx.start, t1, x0: XL - 180, x1: XR });
    for (let k = 1; k < 12; k++) {
      const prev = this.legs[k - 1]!;
      if (prev.t1 > this.ctx.end) break;
      const next = au.timeOfBar(Math.round(au.barAt(prev.t1)) + 2);
      this.legs.push({ t0: prev.t1, t1: next, x0: prev.x1, x1: k % 2 ? XL : XR });
    }
    // 姿勢：一拍換一次腳（skate_1、skate_2，換在拍點上），到頭的小節線前半拍到後一拍半是轉圈
    const ks: [number, string][] = [];
    const bStart = Math.floor(au.beatAt(this.ctx.start));
    const bEnd = Math.ceil(au.beatAt(this.ctx.end)) + 1;
    const turns = this.legs.map((l) => l.t1);
    for (let b = bStart; b <= bEnd; b++) {
      const t = au.timeOfBeat(b);
      ks.push([t, b % 2 ? 'cp_skate_2' : 'cp_skate_1']);
    }
    for (const T of turns) {
      const bp = au.beatPeriod(T);
      for (let i = ks.length - 1; i >= 0; i--) if (ks[i]![0] > T - bp * 0.5 && ks[i]![0] < T + bp * 1.5) ks.splice(i, 1);
      ks.push([T - bp * 0.5, 'cp_skate_twirl']);
    }
    ks.sort((a, b) => a[0] - b[0]);
    ks.unshift([-1e9, 'cp_skate_1']);
    this.keys = ks;
    // 歌詞刻在冰上：兩人滑的路下面一條淺淺的弧
    for (let i = 0; i <= 60; i++) {
      const u = i / 60;
      this.lyricPath.push({ x: lerp(170, 1290, u), y: 962 - this.lyrLift - 22 * Math.sin(Math.PI * u) });
    }
    // 黑板上的留言：標準 v2 的字級；黑板的寬高跟著留言（靠右、上緣固定）
    const c = this.fg.ctx;
    const w = BOARD.w - PAD.x * 2, hmax = BOARD.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    this.board.h = Math.min(BOARD.h, Math.max(230, PAD.top + this.note.height + PAD.bottom + 14));
    this.board.w = Math.min(BOARD.w, tightenNote(c, this.note, 340) + PAD.x * 2);
    this.board.x = BOARD.x + BOARD.w - this.board.w;
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.drawBackground();
  }

  /** 不會動的：遠處的樹影、溜冰場的圍板、熱可可小攤（屋簷、窗口、黑板）。畫一次。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    const ink = inkFor(false, { fill: rgba('ink2') });
    // 遠處的樹影（幾座三角形的松樹，比夜空暗）
    c.save();
    c.fillStyle = rgba('ink', 0.9);
    for (let k = 0; k < 14; k++) {
      const x = 40 + k * 88 + hash(k, 1) * 40, h = 120 + hash(k, 2) * 110;
      if (x > this.board.x - 40) break;
      c.beginPath(); c.moveTo(x - 44, ICE - 50); c.lineTo(x - 30, ICE - 50 - h * 0.35); c.lineTo(x - 38, ICE - 50 - h * 0.35); c.lineTo(x - 20, ICE - 50 - h * 0.68); c.lineTo(x - 27, ICE - 50 - h * 0.68); c.lineTo(x, ICE - 50 - h); c.lineTo(x + 27, ICE - 50 - h * 0.68); c.lineTo(x + 20, ICE - 50 - h * 0.68); c.lineTo(x + 38, ICE - 50 - h * 0.35); c.lineTo(x + 30, ICE - 50 - h * 0.35); c.lineTo(x + 44, ICE - 50); c.closePath(); c.fill();
      c.strokeStyle = rgba('bone', 0.05); c.lineWidth = 1; c.stroke();
    }
    c.restore();
    // 圍板：一條矮牆（上緣一條亮線），冰面從它下面開始
    c.fillStyle = mixRgba('ink2', 'bone', 0.04);
    c.fillRect(0, ICE - 54, W, 54);
    inkLine(c, [{ x: 0, y: ICE - 54 }, { x: W, y: ICE - 54 }], { ink, w: 0.9, seed: 3, color: rgba('bone', 0.4) });
    inkLine(c, [{ x: 0, y: ICE }, { x: W, y: ICE }], { ink, w: 0.5, seed: 4, color: rgba('bone', 0.18) });
    for (let x = 60; x < W; x += 180) inkLine(c, [{ x, y: ICE - 52 }, { x, y: ICE - 4 }], { ink, w: 0.4, seed: x, color: rgba('bone', 0.12) });
    // 冰面上幾道刮痕（很淡）
    c.save();
    c.strokeStyle = rgba('bone', 0.04);
    c.lineWidth = 1;
    for (let k = 0; k < 18; k++) {
      const x = hash(k, 3) * 1300, y = ICE + 40 + hash(k, 4) * 380, l = 80 + hash(k, 5) * 220;
      c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + l / 2, y - 10 + hash(k, 6) * 20, x + l, y + 4); c.stroke();
    }
    c.restore();
    this.drawStall(c, ink);
    L.upload();
  }

  /** 熱可可小攤：屋簷（一排扇形的布）、黑板（木框、粉筆灰）、下面的櫃台與亮著的窗口。 */
  private drawStall(c: CanvasRenderingContext2D, ink: Ink) {
    const B = this.board;
    const sx0 = B.x - 60, sx1 = Math.min(W - 20, B.x + B.w + 60);
    // 櫃台（黑板下面，到圍板）
    c.fillStyle = mixRgba('ink2', 'fur', 0.1);
    c.fillRect(sx0 + 20, B.y + B.h + 30, sx1 - sx0 - 40, ICE - 54 - (B.y + B.h + 30));
    inkLine(c, [{ x: sx0 + 10, y: B.y + B.h + 30 }, { x: sx1 - 10, y: B.y + B.h + 30 }], { ink, w: 0.9, seed: 21, color: rgba('bone', 0.35) });
    // 窗口裡的暖光（一條）
    const wg = c.createLinearGradient(0, B.y + B.h + 36, 0, ICE - 60);
    wg.addColorStop(0, rgba('signal', 0.18)); wg.addColorStop(1, rgba('signal', 0.04));
    c.fillStyle = wg;
    c.fillRect(sx0 + 50, B.y + B.h + 40, sx1 - sx0 - 100, Math.max(0, ICE - 64 - (B.y + B.h + 40)));
    // 屋簷：一排扇形的布（黑板上面）
    const ey = B.y - 34;
    c.fillStyle = mixRgba('ink2', 'bone', 0.1);
    c.beginPath(); c.moveTo(sx0, ey - 24);
    c.lineTo(sx1, ey - 24);
    const n = Math.max(4, Math.round((sx1 - sx0) / 70));
    for (let i = n; i >= 0; i--) { const x = lerp(sx0, sx1, i / n); c.lineTo(x, ey); if (i > 0) c.quadraticCurveTo(x - (sx1 - sx0) / n / 2, ey + 22, lerp(sx0, sx1, (i - 1) / n), ey); }
    c.closePath(); c.fill();
    inkLine(c, [{ x: sx0, y: ey - 24 }, { x: sx1, y: ey - 24 }], { ink, w: 0.7, seed: 22, color: rgba('bone', 0.3) });
    // 黑板：木框、板面（深、帶一點粉筆灰）
    c.fillStyle = mixRgba('ink2', 'fur', 0.25);
    c.fillRect(B.x - 12, B.y - 12, B.w + 24, B.h + 24);
    const g = c.createLinearGradient(0, B.y, 0, B.y + B.h);
    g.addColorStop(0, mixRgba('ink2', 'bone', 0.07)); g.addColorStop(1, mixRgba('ink', 'bone', 0.03));
    c.fillStyle = g;
    c.fillRect(B.x, B.y, B.w, B.h);
    c.save();
    c.fillStyle = rgba('bone', 0.025);
    for (let k = 0; k < 260; k++) c.fillRect(B.x + hash(k, 7) * B.w, B.y + hash(k, 8) * B.h, 3 + hash(k, 9) * 30, 1.5);
    c.restore();
    inkPoly(c, [{ x: B.x - 12, y: B.y - 12 }, { x: B.x + B.w + 12, y: B.y - 12 }, { x: B.x + B.w + 12, y: B.y + B.h + 12 }, { x: B.x - 12, y: B.y + B.h + 12 }], { ink, w: 0.7, seed: 23, color: rgba('bone', 0.3) });
    c.font = font(F.mono(500), 16);
    c.letterSpacing = '4px';
    c.fillStyle = rgba('bone', 0.4);
    c.fillText(LABEL, B.x + PAD.x, B.y + 40);
    c.letterSpacing = '0px';
  }

  /** 兩個人這一格的位置（腳底 x）、滑的速度、朝向（spin，圈數：每到頭加半圈）。 */
  private stateAt(t: number) {
    const au = this.ctx.audio;
    let x = this.legs[0]!.x0, spin = 0, vel = 0;
    for (let i = 0; i < this.legs.length; i++) {
      const l = this.legs[i]!;
      if (t >= l.t0) {
        const u = clamp((t - l.t0) / (l.t1 - l.t0));
        // 第一趟從畫面外滑進來（不減速起步），之後起步慢、中間快、到頭慢
        const e = i === 0 ? ease.outCubic(u) : 0.5 - 0.5 * Math.cos(Math.PI * u);
        x = lerp(l.x0, l.x1, e);
        vel = (l.x1 - l.x0) / (l.t1 - l.t0);
      }
      // 到頭的小節線：前 0.3 拍到後 0.6 拍翻半圈（小節線上剛好側面、變成一條線）
      const bp = au.beatPeriod(l.t1);
      spin += 0.5 * prog(t, l.t1 - bp * 0.3, l.t1 + bp * 0.6, ease.inOutCubic);
    }
    return { x, spin, vel };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.rink.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const rv = prog(t, s, s + 0.6, ease.inOutCubic);
    const st = this.stateAt(t);

    // 拍點上蹬一下：身體往前一送、壓一下
    const kick = beatKick(au, t, 0.3);
    const dir = Math.cos(st.spin * Math.PI * 2) >= 0 ? 1 : -1;
    const o: PuppetOpts = { h: SZ, spin: st.spin, rot: dir * (0.03 + 0.02 * kick), pivot: 0.1, squash: 0.03 * kick + breathe(t, 0.006, 3.2) };
    const ent = puppetIn(t, s + 0.02, 0.4);
    // 倒影（這一層最先畫：上下翻、很淡，往下淡掉）
    c.save();
    c.globalAlpha = 0.09 * ent.alpha;
    c.translate(0, GROUND * 2);
    c.scale(1, -1);
    drawPick(c, this.keys, t, st.x, GROUND, o);
    c.restore();
    c.save();
    c.globalCompositeOperation = 'destination-out';
    const fade = c.createLinearGradient(0, GROUND, 0, GROUND + SZ * 0.32);
    fade.addColorStop(0, 'rgba(0,0,0,0.1)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
    c.fillStyle = fade;
    c.fillRect(0, GROUND, W, H - GROUND);
    c.restore();
    // 兩個人（打光：上面被燈串照到、往腳底暗）
    puppetShadow(c, 'cp', st.x, GROUND + 2, { h: SZ, alpha: 0.55, wide: 0.9, color: '0,0,0' });
    drawPick(c, this.keys, t, st.x, GROUND, { ...o, alpha: ent.alpha });
    puppetLight(c, [st.x - SZ, GROUND - SZ * 1.35, SZ * 2, SZ * 1.35 + 4], rgba('ink', 0.06), rgba('ink', 0.48));
    if (ent.k < 1) {
      sparkHead(this.glow, st.x, GROUND - 6, t, 0.8);
      sparkParticles(this.glow, t, () => ({ x: st.x, y: GROUND - 6 }), { rate: 60, life: 0.3, speed: 150, seed: 2 });
    }

    this.trails(t);
    this.spray(c, t);
    // 歌詞刻在冰上
    const ly = lyricAt(lyrics, t);
    if (ly) lyricOnPath(c, ly.line, t, this.lyricPath, { family: F.archivo(100, 700), size: this.lyricSize, minSize: 40, offset: 0, alpha: ly.k * rv, unsung: rgba('bone', 0.22), sung: rgba('bone', 0.9) });
    this.lights(c, t);
    this.snow(c, t);
    this.drawBoardText(c, t);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：慢慢推近，跟著兩個人往旁邊飄一點點
    const push = ease.inOutCubic(f.p);
    return { bloom: 0.8, vignette: 0.55, zoom: 1 + 0.03 * push, shake: [-(st.x - W / 2) * 0.02 - 14 * push, -6 * push] };
  }

  /** 冰刀的兩條光：往回取 2.4 秒的路（越舊越淡），兩個人的腳各一條，蹬冰時線稍微往外擺。 */
  private trails(t: number) {
    const sg = LIN.signal;
    for (const [dx, dy] of [[-0.16, 5], [0.12, -5]] as const) {
      const pts: Pt[] = [];
      for (let k = 0; k <= 64; k++) {
        const tt = t - k * 0.055;
        if (tt < this.ctx.start) break;
        const q = this.stateAt(tt);
        const d = Math.cos(q.spin * Math.PI * 2) >= 0 ? 1 : -1;
        const wig = Math.sin(this.ctx.audio.beatAt(tt) * Math.PI) * 3;
        pts.push({ x: q.x + dx * SZ * d, y: GROUND + dy + wig });
      }
      for (let k = 1; k < pts.length; k++) {
        const a = 1 - k / pts.length;
        this.glow.seg2(pts[k - 1]!.x, pts[k - 1]!.y, pts[k]!.x, pts[k]!.y, 1.4, [sg[0] * 1.8, sg[1] * 1.8, sg[2] * 1.8], 0.75 * a);
      }
    }
  }

  /** 到頭轉圈時冰刀刮起的冰屑（小白點往外噴、落下）。 */
  private spray(c: CanvasRenderingContext2D, t: number) {
    for (const l of this.legs) {
      const u = (t - (l.t1 - 0.05)) / 0.6;
      if (u < 0 || u > 1) continue;
      c.save();
      c.fillStyle = rgba('bone', 0.7 * (1 - u));
      for (let i = 0; i < 26; i++) {
        const a = -Math.PI * (0.1 + 0.8 * hash(i, 11)), v = 120 + 200 * hash(i, 12);
        const x = l.x1 + Math.cos(a) * v * u * 0.6 + (hash(i, 13) - 0.5) * 60, y = GROUND + Math.sin(a) * v * u * 0.6 + 260 * u * u;
        if (y > GROUND + 10) continue;
        c.fillRect(x, y, 2.5, 2.5);
      }
      c.restore();
    }
  }

  /** 燈串：兩條垂下來的電線、一顆顆小燈泡（在 hi-hat 上一顆一顆閃）。不碰右邊的黑板。 */
  private lights(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const e = LIN.ember;
    const hat = au.hit('hat', t, 0.12);
    const x1 = this.board.x - 70;
    for (const [y0, y1, sag, sd] of [[70, 150, 90, 1], [180, 120, 70, 2]] as const) {
      const at = (u: number) => ({ x: lerp(-20, x1, u), y: lerp(y0, y1, u) + sag * 4 * u * (1 - u) });
      c.save();
      c.strokeStyle = rgba('bone', 0.14);
      c.lineWidth = 1.2;
      c.beginPath();
      for (let k = 0; k <= 30; k++) { const p = at(k / 30); if (k) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y); }
      c.stroke();
      c.restore();
      const n = Math.round((x1 + 20) / 52);
      for (let k = 1; k < n; k++) {
        const p = at(k / n);
        const tw = hash(k, sd * 7 + Math.floor(au.beatAt(t) * 2)) > 0.72 ? hat : 0;
        const I = 0.55 + 0.25 * Math.sin(t * 1.7 + k * 1.3) + 1.2 * tw;
        this.glow.seg2(p.x, p.y + 6, p.x + 0.01, p.y + 6, 9, [e[0] * I * 0.35, e[1] * I * 0.35, e[2] * I * 0.35], 0.6);
        this.glow.seg2(p.x, p.y + 6, p.x + 0.01, p.y + 6, 3.5, [e[0] * I * 2, e[1] * I * 2, e[2] * I * 2], 1);
      }
    }
  }

  /** 細雪：幾十片慢慢往下飄、左右晃（位置只看 t 與編號）。 */
  private snow(c: CanvasRenderingContext2D, t: number) {
    c.save();
    c.fillStyle = rgba('bone', 1);
    for (let k = 0; k < 70; k++) {
      const sp = 26 + 30 * hash(k, 2);
      const y = ((hash(k, 1) * 1100 + t * sp) % 1100) - 20;
      const x = hash(k, 3) * W + Math.sin(t * 0.6 + k) * 18;
      const B = this.board;
      if (x > B.x - 10 && x < B.x + B.w + 10 && y > B.y - 10 && y < B.y + B.h + 10) continue;
      c.globalAlpha = 0.18 + 0.3 * hash(k, 4);
      const r = 1 + 1.8 * hash(k, 5);
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }

  /** 黑板上的主打留言：開場起一個字一個字寫上去（粉筆字），寫完署名淡入；在板面上垂直置中。 */
  private drawBoardText(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const B = this.board;
    const t0 = this.ctx.start + 0.7;
    const total = msgChars(n.fit);
    const per = clamp(1.5 / Math.max(1, total), 0.025, 0.09);
    const done = t0 + total * per;
    const top = B.y + PAD.top, h = B.h - PAD.top - PAD.bottom;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.6);
    drawNote(c, n, B.x + PAD.x, top + Math.max(0, (h - n.height) * 0.42), {
      chars: this.msg ? (t - t0) / per : Infinity, color: this.msg ? rgba('bone', 0.95) : rgba('bone', 0.62), sigColor: rgba('ash', 0.95), sigK: prog(t, done + 0.1, done + 0.5),
    });
    c.restore();
  }
}

