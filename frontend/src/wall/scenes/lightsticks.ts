// 手燈海（暗、live）：體育館的看台，一整片應援手燈照拍子變色、左右擺成波浪；宣文和孟庭站在看台中間一起揮手燈。
// 角色是 Codex 畫的紙偶（_puppet.ts、素材組 live）；看台、手燈海、其他觀眾、手燈、應援板是程式畫的（_c9.ts）。不畫任何真實歌手、團名。
//  - 手燈海（shader）：上層看台一排一排的手燈（遠的小、排得密，排成往兩邊翹起來的弧），**每一拍全場一起往左、往右擺**，
//    每個小節線一道新的顏色從左邊掃到右邊（中控手燈），還有一道亮的波浪一直往右跑。近的幾排是剪影觀眾，手燈跟著同一個顏色。
//  - 兩個人：兩人都揮手燈（程式畫的，燈色跟著全場），每一拍換一次手（兩張姿勢輪流），兩拍一次小跳；每兩個小節線一起跳起來（跳的那張圖），
//    最高點剛好在小節線上。孟庭另一隻手舉著應援板。
//  - **主打留言寫在孟庭舉的應援板上**：黑色的板子、一圈 LED 燈珠（八分音符一格一格跑）、手寫字；第一拍板子從下面舉起來，留言接著一個字一個字出現。
//    照「留言尺寸與版面比例標準 v2」：字 40～60、板子最大 580 × 350，寬高跟著留言。沒有留言時寫邀請。
//  - 歌詞跑在看台中間那條環場 LED 帶上（逐字跟唱），在畫面左上，跟應援板分開。
//  - 鏡頭：整個窗格慢慢往上搖（看台越來越多）、推近一點點；大鼓時輕輕一頓。右下角 HUD 只有暗暗的座位。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog } from '../engine/util';
import { lyricAt, barAfter, beatAfter, msgChars, layoutLyric, drawLyric, type LyricStyle } from './_motifs';
import { drawNote, type Note } from './_couple';
import { loadPuppets, hasPuppet, drawCycle, drawPuppet, puppetPoint, puppetShadow, puppetLight, jumpArc, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { glow, lightStick, roundRect, type Pt } from './_c9';

export const spec: PlateSpecDecl = { group: 'couple', family: 'live', paper: false, energy: [0.5, 1], bars: [4, 8] };

const GROUND = 1050;
const SZ = 620;
/** 兩個人站的位置。 */
const AX = 470, OX = 760;
/** 應援板：最大寬高（標準 v2）、寫字的內距、左緣離拳頭多遠、握把多長。 */
const BOARD = { wMax: 640, hMax: 320, wMin: 360, left: 50, stick: 40, top: 118 };
const PAD = { x: 36, top: 34, bottom: 26 };
/** 環場 LED 帶（歌詞）：畫面左上。 */
/** 手燈海（上層看台）：從哪裡到哪裡（y）。 */
const SEA_Y0 = 190, SEA_H = 660;
const RIBBON = { y0: 96, y1: 176, x0: -10, x1: W + 10, lx: 110, lw: 640, base: 152 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const XW = ['xw_live_wave_1', 'xw_live_wave_2'];
const MT = ['mt_live_wave_1', 'mt_live_wave_2'];
const XJ = 'xw_live_wave_jump', MJ = 'mt_live_wave_jump';
/** 手燈的顏色：色票（0 = 訊號色、1 = 更熱的訊號色、2 = 紙白），每小節換一個。 */
const LITS = ['signal', 'ember', 'bone'] as const;

/**
 * 看台的手燈海：上層看台一排一排的光點（遠的小、密），排成往兩邊翹起的弧；每一拍全場往左或往右擺，
 * 每小節一道新顏色從左掃到右（uSweep 0..1），一道亮的波浪一直往右跑。右下角 HUD 的地方淡掉。
 */
const SEA = () => new FSPass(/* glsl */ `
  uniform float uT, uSwing, uSweep, uKick, uOn, uColA, uColB;
  vec3 litCol(float k) { return k < 0.5 ? C_SIGNAL : k < 1.5 ? C_EMBER : C_BONE * 0.8; }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 col = C_INK;
    // 看台的弧：兩邊翹起來（遠的那一側翹得多）
    float cx = (p.x - 960.0) / 960.0;
    float yy = p.y + 40.0 * cx * cx;
    // 一排一排（上面遠、排距小）：第 row 排的上緣 y0、排距 pitch、在這一排裡的位置 fr（0..1）
    float u = clamp((yy - ${SEA_Y0}.0) / ${SEA_H}.0, 0.0, 1.0);
    float row = floor(30.0 * sqrt(u));
    float y0 = ${SEA_Y0}.0 + pow(row / 30.0, 2.0) * ${SEA_H}.0;
    float y1 = ${SEA_Y0}.0 + pow((row + 1.0) / 30.0, 2.0) * ${SEA_H}.0;
    float pitch = max(3.0, y1 - y0);
    float fr = (yy - y0) / pitch;
    float inSea = step(${SEA_Y0}.0, yy) * (1.0 - smoothstep(${SEA_Y0 + SEA_H - 40}.0, ${SEA_Y0 + SEA_H + 30}.0, yy));
    // 手燈：一格一顆，只在自己那一格裡畫（光暈交給 bloom），每一拍全場一起往左、往右擺
    float sx = pitch * 1.3;
    float sw = uSwing * pitch * 0.35;
    float xr = p.x - sw + hash11(row * 7.13) * sx;
    float cell = floor(xr / sx);
    float h = hash12(vec2(cell, row));
    float cxl = fract(xr / sx) - 0.5 - (h - 0.5) * 0.3;
    // 顏色：這一小節的顏色從左往右掃過來；亮度：一道往右跑的亮波浪＋拍點上一起亮一下；空位不亮
    float front = -200.0 + uSweep * 2400.0 + (h - 0.5) * 160.0;
    vec3 amb = litCol(p.x < front ? uColB : uColA);
    vec3 lc = h > 0.94 ? C_BONE * 0.75 : amb;   // 幾支手機
    float wave = 0.5 + 0.5 * sin(p.x / 170.0 - uT * 3.2 + row * 0.35);
    float b = (0.35 + 0.45 * wave * wave + 0.3 * uKick) * step(0.1, h);
    // 看台：很暗，只有每一排下緣椅背一條很淡的亮邊、手燈照亮的一點點環境光（平滑的，不要一格一格）
    col += (C_INK2 * 0.25 + amb * 0.012 * (0.5 + 0.5 * sin(p.x / 170.0 - uT * 3.2 + u * 10.0))) * inSea;
    col += C_INK2 * 0.35 * smoothstep(0.85, 0.98, fr) * inSea * smoothstep(5.0, 12.0, pitch);
    col += C_BLOOD * 0.02 * exp(-pow((p.x - 900.0) / 900.0, 2.0)) * inSea;
    // 燈：每一格一顆，位置上下左右錯開一點（不要排成方格）
    // （光暈在格子邊緣之前一定要降到 0，不然暗處看得到一格一格的方塊）
    vec2 d = vec2(cxl * sx, (fr - 0.5 - (hash12(vec2(row, cell + 5.0)) - 0.5) * 0.3) * pitch);
    float r = pitch * 0.15 + 0.5;
    float dist = length(d);
    float dotv = (1.0 - smoothstep(r * 0.35, r, dist)) + 0.35 * pow(max(0.0, 1.0 - dist / (pitch * 0.32)), 3.0);
    float far = (0.6 + 0.4 * u) * (1.0 - 0.55 * smoothstep(0.6, 1.0, u));
    float hud = smoothstep(1300.0, 1420.0, p.x) * smoothstep(780.0, 880.0, p.y);
    col += lc * dotv * b * 1.3 * uOn * far * inSea * (1.0 - hud);
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`, { uT: { value: 0 }, uSwing: { value: 0 }, uSweep: { value: 0 }, uKick: { value: 0 }, uOn: { value: 0 }, uColA: { value: 0 }, uColB: { value: 0 } });

interface Who { p: 'xw' | 'mt'; frames: string[]; jump: string | null; x: number }

export default class Lightsticks extends Scene {
  sea = shared('lightsticks.sea', SEA);
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  gl = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  board = { dx: 0, dy: 0, w: 0, h: 0 };
  who: Who[] = [];
  jumps: number[] = [];
  tOn = 0;
  tBoard = 0;
  msgT0 = 0;
  lyricSize = 52;
  led: CanvasPattern | null = null;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客' + INVITE + ' ·♥');
    const xw = XW.filter(hasPuppet), mt = MT.filter(hasPuppet);
    const xj = hasPuppet(XJ) ? XJ : null, mj = hasPuppet(MJ) ? MJ : null;
    this.track(await loadPuppets([...xw, ...mt, ...(xj ? [xj] : []), ...(mj ? [mj] : [])]));
    this.who = [{ p: 'xw', frames: xw, jump: xj, x: AX }, { p: 'mt', frames: mt, jump: mj, x: OX }];
    // 全場的燈在第一拍亮起來；板子在下一拍舉起來
    this.tOn = beatAfter(au, s + 0.1);
    this.tBoard = beatAfter(au, this.tOn + 0.05, 1);
    if (this.tBoard > s + 1.4) this.tBoard = this.tOn + 0.25;
    this.msgT0 = this.tBoard + 0.35;
    // 每兩個小節線一起跳（最高點在小節線上）
    for (let T = barAfter(au, s + 1.2), k = 0; T < e - 0.4 && k < 20; k++) {
      this.jumps.push(T);
      T = au.timeOfBar(Math.round(au.barAt(T)) + 2);
    }
    // 應援板：標準 v2 的字級；寬高跟著留言
    const c = this.fg.ctx;
    const tw = BOARD.wMax - PAD.x * 2, th = BOARD.hMax - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, tw, th) : noteV2(c, INVITE, null, tw, th * 0.5, { max: 44 });
    const bw = Math.min(BOARD.wMax, Math.max(BOARD.wMin, tightenNote(c, this.note, 280) + PAD.x * 2));
    const bh = Math.min(BOARD.hMax, Math.max(170, PAD.top + this.note.height + PAD.bottom + 6));
    // 板子相對拳頭的位置：握把往上、板子的左下角在拳頭左邊一點
    this.board = { dx: -BOARD.left, dy: -BOARD.stick - bh, w: bw, h: bh };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    // LED 帶的燈珠格
    const pc = document.createElement('canvas');
    pc.width = pc.height = 5;
    const px = pc.getContext('2d')!;
    px.fillStyle = 'rgba(0,0,0,0.42)';
    px.fillRect(4, 0, 1, 5); px.fillRect(0, 4, 4, 1);
    this.led = c.createPattern(pc, 'repeat');
  }

  /** 這一格的手燈顏色：每小節換一個（跟 shader 的掃色一樣，這一小節的顏色掃到這個 x 了沒）。 */
  private litAt(t: number, x: number) {
    const au = this.ctx.audio;
    const bar = Math.floor(au.barAt(t) + 1e-6);
    const t0 = au.timeOfBar(bar), bp = au.beatPeriod(t);
    const sweep = clamp((t - t0) / (bp * 1.5));
    const front = -200 + sweep * 2400;
    const cur = LITS[((bar % 3) + 3) % 3]!, prev = LITS[(((bar - 1) % 3) + 3) % 3]!;
    return x < front ? cur : prev;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t;
    const bp = au.beatPeriod(t);
    const bar = Math.floor(au.barAt(t) + 1e-6);
    const on = prog(t, this.tOn - 0.05, this.tOn + 0.2);
    const kick = beatKick(au, t, 0.25);
    const beat = au.beatAt(t);
    // 全場每一拍往左、往右擺（拍點上擺到底）
    const swing = Math.sin((beat - 0.5) * Math.PI) * -1;
    const u = this.sea.u;
    u.uT!.value = t; u.uSwing!.value = swing; u.uKick!.value = kick; u.uOn!.value = on;
    u.uSweep!.value = clamp((t - au.timeOfBar(bar)) / (bp * 1.5));
    u.uColA!.value = (((bar - 1) % 3) + 3) % 3;
    u.uColB!.value = ((bar % 3) + 3) % 3;
    this.sea.render(renderer, out);

    const L = this.fg; L.clear();
    const c = L.ctx;
    const G = this.gl; G.clear();
    const g = G.ctx;

    // ---- 兩個人（這一層最先畫：打光只染紙偶）
    const pts: { stick?: Pt; arm?: Pt; band?: Pt; board?: Pt; lift: number }[] = [];
    this.who.forEach((w, i) => {
      if (!w.frames.length) return;
      let lift = 0, squash = breathe(t, 0.008, 3.3, i * 0.4) + 0.02 * kick, air = false;
      for (const T of this.jumps) {
        const a = clamp(bp * 1.2, 0.4, 0.62);
        if (t > T - a / 2 - 0.2 && t < T + a / 2 + 0.35) {
          const j = jumpArc(t, T - a / 2, T + a / 2, 46, { crouch: 0.08, land: 0.13 });
          lift = -j.y; squash = j.squash; air = j.air;
        }
      }
      // 沒在大跳的時候：兩拍一次小跳（兩個人錯開一拍）
      if (!air && lift === 0) { const ph = (beat + i) % 2; if (ph < 0.5) lift = 10 * Math.sin(ph * 2 * Math.PI); }
      const o: PuppetOpts = { h: SZ, squash, rot: Math.sin((beat + i * 0.5) * Math.PI) * 0.012, pivot: 0.12 };
      puppetShadow(c, w.p, w.x, GROUND, { h: SZ, lift, alpha: 0.75, wide: 1.2, color: '0,0,0' });
      const y = GROUND - lift;
      let frame: string;
      if (air && w.jump) { frame = w.jump; drawPuppet(c, frame, w.x, y, o); }
      else frame = drawCycle(c, au, t, w.frames, 1, w.x, y, o);
      const pt = (k: string) => puppetPoint(frame, k, w.x, y, o) ?? undefined;
      pts[i] = { stick: pt('stick'), arm: pt('arm'), band: pt('band'), board: pt('board'), lift };
    });
    // 場燈在前面（舞台那一側）：頭頂亮、往腳底暗；燈亮之前兩個人暗暗的
    puppetLight(c, [AX - 400, GROUND - SZ * 1.3, OX - AX + 800, SZ * 1.3 + 40], rgba('ink', 0.08 + 0.6 * (1 - on)), rgba('ink', 0.55 + 0.3 * (1 - on)));

    // ---- 手燈（兩個人都有，燈色跟著全場）、手環的光
    pts.forEach((p, i) => {
      if (!p?.stick) return;
      const from = i === 0 ? p.band : p.arm;
      const base = from ? Math.atan2(p.stick.x - from.x, from.y - p.stick.y) : 0;
      // 每一拍甩過去（跟全場一起），拍點上甩到底
      const a = base * 0.7 + swing * 0.28;
      const lit = this.litAt(t, p.stick.x);
      const orb = lightStick(c, p.stick, a, SZ, { lit, on });
      glow(g, rgba(lit), orb.x, orb.y, SZ * (0.07 + 0.015 * kick), 0.85 * on);
      glow(g, rgba('bone'), orb.x, orb.y, SZ * 0.02, 0.55 * on);
    });
    for (const p of pts) if (p?.band) glow(g, mixRgba('bone', 'signal', 0.35), p.band.x, p.band.y, SZ * 0.045, (0.3 + 0.5 * kick) * on);

    // ---- 環場 LED 帶（歌詞），應援板（孟庭舉著）蓋在它前面
    this.drawRibbon(c, t, on);
    const B = pts[1];
    if (B?.board) this.drawBoard(c, g, t, B.board, kick, on);

    // ---- 兩個人腳邊：他們那一排的欄杆（很暗，只有上緣一條亮邊），腳下的看台暗一點
    c.save();
    c.globalCompositeOperation = 'destination-over';
    const fade = c.createLinearGradient(0, GROUND - 90, 0, H);
    fade.addColorStop(0, rgba('ink', 0));
    fade.addColorStop(1, rgba('ink', 0.9));
    c.fillStyle = fade;
    c.fillRect(0, GROUND - 90, W, H - GROUND + 90);
    c.restore();

    comp.draw(renderer, L.upload(), out);
    comp.draw(renderer, G.upload(), out, { mode: 'add', tint: [1.6, 1.6, 1.6] });
    // 鏡頭：慢慢往上搖一點、推近；大鼓時輕輕一頓
    const push = ease.inOutCubic(f.p);
    return { bloom: 0.8, vignette: 0.55, zoom: 1 + 0.028 * push + 0.004 * f.a.kick, shake: [-(OX + 200 - W / 2) * 0.028 * push, 14 * push] };
  }

  /**
   * 應援板：握把從孟庭的拳頭往上，黑色的板子、一圈 LED 燈珠（八分音符一格一格往前跑、拍點上全亮一下）、手寫的留言。
   * 第一拍從下面舉起來（先藏在人群後面）；之後跟著拳頭走（跳的時候一起跳）。
   */
  private drawBoard(c: CanvasRenderingContext2D, g: CanvasRenderingContext2D, t: number, fist: Pt, kick: number, on: number) {
    const n = this.note, D = this.board;
    const rise = ease.outBack(prog(t, this.tBoard, this.tBoard + 0.4));
    if (rise <= 0) return;
    const drop = (1 - rise) * 260;
    // 板子的上緣不要超過 BOARD.top（跳起來的時候也一樣：握把縮短一點），字才不會碰到上面的 LED 帶與畫面邊緣
    const x = fist.x + D.dx, y = Math.max(BOARD.top, fist.y + D.dy) + drop;
    c.save();
    c.globalAlpha = clamp(rise * 2);
    // 握把
    c.strokeStyle = mixRgba('ink2', 'graphite', 0.4);
    c.lineWidth = 8;
    c.lineCap = 'round';
    c.beginPath(); c.moveTo(fist.x, fist.y - 6 + drop); c.lineTo(fist.x, y + D.h - 4); c.stroke();
    // 板子：深色、細亮邊、往下一點點的影子
    c.fillStyle = rgba('ink', 0.5);
    roundRect(c, x + 8, y + 10, D.w, D.h, 12); c.fill();
    const bgc = c.createLinearGradient(0, y, 0, y + D.h);
    bgc.addColorStop(0, mixRgba('ink2', 'graphite', 0.3));
    bgc.addColorStop(1, rgba('ink2'));
    c.fillStyle = bgc;
    roundRect(c, x, y, D.w, D.h, 12); c.fill();
    c.strokeStyle = rgba('bone', 0.2);
    c.lineWidth = 1.5;
    c.stroke();
    c.restore();
    // LED 燈珠：沿著板子的邊一圈，八分音符一格一格跑
    const au = this.ctx.audio;
    const step = Math.floor(au.beatAt(t) * 2);
    const lit = rgba(this.litAt(t, x + D.w / 2));
    const per = 2 * (D.w + D.h), gap = 26, N = Math.floor(per / gap);
    for (let k = 0; k < N; k++) {
      let s = (k / N) * per;
      let px: number, py: number;
      if (s < D.w) { px = x + s; py = y + 9; }
      else if ((s -= D.w) < D.h) { px = x + D.w - 9; py = y + s; }
      else if ((s -= D.h) < D.w) { px = x + D.w - s; py = y + D.h - 9; }
      else { s -= D.w; px = x + 9; py = y + D.h - s; }
      const a = ((k + step) % 4 === 0 ? 0.95 : 0.35) * on * rise + 0.3 * kick * on;
      c.fillStyle = mixRgba(this.litAt(t, px), 'bone', 0.3, clamp(a));
      c.beginPath(); c.arc(px, py, 3.2, 0, Math.PI * 2); c.fill();
      if ((k + step) % 4 === 0) glow(g, lit, px, py, 12, 0.5 * on * rise);
    }
    if (!n || rise < 0.9) return;
    const total = msgChars(n.fit);
    const perc = clamp(1.4 / Math.max(1, total), 0.025, 0.09);
    const done = this.msgT0 + total * perc;
    const top = y + PAD.top, hh = D.h - PAD.top - PAD.bottom;
    drawNote(c, n, x + (D.w - n.width) / 2, top + Math.max(0, (hh - n.height) * 0.45), {
      chars: this.msg ? (t - this.msgT0) / perc : Infinity, color: this.msg ? rgba('bone', 0.96) : rgba('ash', 0.85), sigColor: rgba('ash', 0.95), sigK: prog(t, done + 0.1, done + 0.5),
    });
  }

  /** 環場 LED 帶：一條暗色的帶子橫過看台，左邊跑歌詞（逐字跟唱）；燈珠格蓋在上面。 */
  private drawRibbon(c: CanvasRenderingContext2D, t: number, on: number) {
    const R = RIBBON;
    c.save();
    c.fillStyle = rgba('ink', 0.92);
    c.fillRect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0);
    c.fillStyle = rgba('bone', 0.12);
    c.fillRect(R.x0, R.y0, R.x1 - R.x0, 1.5);
    c.fillRect(R.x0, R.y1 - 1.5, R.x1 - R.x0, 1.5);
    const ly = lyricAt(this.ctx.lyrics, t);
    if (ly) {
      const st: LyricStyle = { family: F.archivo(100, 700), size: this.lyricSize, minSize: 40, maxWidth: R.lw, align: 'left', active: rgba('signal'), sung: rgba('bone', 0.95), unsung: rgba('bone', 0.28) };
      const lay = layoutLyric(c, ly.line, st);
      // 兩行時整塊往上移，第二行還在帶子裡
      c.save();
      c.translate(R.lx, R.base - (lay.height - lay.size) * 0.5);
      drawLyric(c, ly.line, t, st, lay, ly.k * on);
      c.restore();
    }
    if (this.led) { c.fillStyle = this.led; c.fillRect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0); }
    c.restore();
  }
}
