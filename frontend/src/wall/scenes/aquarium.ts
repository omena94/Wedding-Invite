// 水族箱（暗）：夜裡水族館的展廳，整面大水族箱在背景發光，左下角立著一塊小小的解說牌。
//  - 畫面的焦點＝主打留言：印在解說牌上（思源宋體）。解說牌是一片薄薄的壓克力燈箱，第一個拍點「啪、啪」閃兩下亮起來，
//    字就在亮起來的燈箱上；署名在最後一行下面；上面一行很小的「展示物種：祝福　No.042」。
//  - 2026-09-29 留言標準 v2：留言 40～60 px，燈箱只比字多一點邊（≤ 760 × 380），放在左下角；整面水族箱是主視覺。
//    本來歌詞是魚群排成的大字（100 px 以上），v2 的歌詞只能 40～52 px，魚排不出來，改成：
//  - 歌詞＝貼在玻璃左上角的一行白色字（像水族館玻璃上的貼字），照跟唱規則逐字亮。
//  - 魚群是主角：一大群銀色的小魚，每個小節線換一個隊形（球、環、波浪、螺旋、長流），整群在小節線上轉向、
//    從前一個隊形「流」到下一個（每條魚晚一點點出發，像一陣波）；每一拍一道銀光從左到右掃過魚群（一起翻身反光）。
//  - 氣泡：每一拍從右下角的打氣石冒出一串氣泡。水面在上面搖，光從水面斜斜照下來，沙底有水波的光紋，水草在搖。
//  - 沒有主打留言：解說牌寫「祝福魚群」與邀請（小），歌詞是焦點（52 px）。
// 手法：水、光、沙、水草、缸框、展廳、解說牌（燈箱）都在一個 shader；魚與氣泡是 LineBatch（每條魚兩段：身體與尾巴）；
// 解說牌上的字是一張 init 畫好的 Canvas2D（燈箱亮度用疊上去的透明度）；歌詞每格畫在另一張。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, prog, hash, pulse, TAU } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { lyricAt, layoutLyric, drawLyric, drawMessage, beatAfter, type LyricStyle } from './_motifs';
import { T16_TEXT, sigOf, winBeats, winBars, no3 } from './_t16';
import { msgMaxFor, lyricV2, sigV2, fitClauses, V2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'nature', paper: false, energy: [0.15, 0.9], bars: [4, 8] };

/** 解說牌（燈箱）的左下角錨點、邊距與字的最大範圍（v2：燈箱 ≤ 760 × 380，只比字多一點邊）。 */
const PANEL_AT = { x0: 120, y1: 936 };
const PAD = { x: 40, top: 58, bottom: 30 };
const PTXT_MAX = { w: 680, h: 300 };
/** 貼在玻璃左上角的歌詞。 */
const LYR = { x: 150, y: 196, w: 1100 };
/** 缸：上緣的框、水面、沙底、底櫃、地板。 */
const TANK = { top: 40, surf: 84, sand: 720, base: 830, floor: 930 };
const FAM_MSG = F.ming(700);
const FAM_LYR = F.hei(700);
/** 魚的條數。 */
const NFISH = 620;
const STONE = { x: 1690, y: 800 };
/** 解說牌上面的小字（冷面的館方口吻）、沒有留言時的邀請。 */
const HEAD = '展示物種：祝福';
const INVITE = ['掃描右下角 QR code，', '把你的祝福傳上大螢幕，', '魚群會替你游一圈。'];
/** 魚群的隊形。 */
type Shape = 'ball' | 'ring' | 'wave' | 'spiral' | 'stream';
const SHAPES: Shape[] = ['ball', 'ring', 'wave', 'spiral', 'stream'];

const BG = () => new FSPass(/* glsl */ `
  uniform float t, kin, lamp, kick;
  uniform vec4 pnl; // 解說牌（x0, y0, x1, y1）：有沒有留言大小不一樣
  const float TOP = ${TANK.top}.0, SURF = ${TANK.surf}.0, SAND = ${TANK.sand}.0, BASE = ${TANK.base}.0, FLOOR = ${TANK.floor}.0;
  float rbox(vec2 p, vec2 a, vec2 b, float r) { vec2 c = (a + b) * 0.5, h = (b - a) * 0.5 - r; return sdBox(p - c, h) - r; }
  // 水波光紋（沙底）：兩層扭過的格子取細線
  float caustic(vec2 p, float t) {
    vec2 q = p / 70.0;
    float v = 0.0;
    for (int i = 0; i < 2; i++) {
      q += vec2(sin(q.y * 1.3 + t * 0.9), cos(q.x * 1.1 - t * 0.7)) * 0.45;
      vec2 f = abs(fract(q) - 0.5);
      v += smoothstep(0.08, 0.0, min(f.x, f.y) - 0.02);
      q = q * 1.7 + 3.1;
    }
    return v * 0.5;
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y); // y 向下
    vec3 col;
    if (p.y < BASE) {
      // ---- 水：上面亮、往下暗；水面在上面搖
      float depth = clamp((p.y - SURF) / (SAND - SURF), 0.0, 1.0);
      vec3 water = mix(C_GRAPHITE * 0.12 + C_ASH * 0.015 + C_SIGNAL * 0.01, C_INK2 * 0.55 + C_GRAPHITE * 0.02, pow(depth, 0.6));
      // 從水面斜斜照下來的光柱，慢慢飄
      float sx = p.x + (p.y - SURF) * 0.32;
      float rays = 0.0;
      for (int i = 0; i < 3; i++) {
        float fi = float(i);
        rays += pow(0.5 + 0.5 * sin(sx * (0.006 + fi * 0.0041) + t * (0.25 + fi * 0.11) + fi * 2.1), 6.0);
      }
      water += (C_SIGNAL * 0.018 + C_BONE * 0.006) * rays * (1.0 - depth) * (1.0 - depth);
      // 水裡的浮游小點
      vec2 mp = (p + vec2(t * 6.0, -t * 9.0)) / 14.0, mc = floor(mp);
      float mo = step(0.993, hash12(mc)) * (1.0 - smoothstep(0.05, 0.16, length(fract(mp) - 0.3 - 0.4 * hash22(mc))));
      water += C_BONE * 0.05 * mo * (1.0 - depth * 0.6);
      // 水面（從水下往上看：一條亮亮的搖晃的線，上面是缸的框）
      float wy = SURF + 5.0 * sin(p.x * 0.012 + t * 1.6) + 3.0 * sin(p.x * 0.031 - t * 2.3);
      water += (C_BONE * 0.08 + C_SIGNAL * 0.05) * exp(-abs(p.y - wy) / 3.0);
      if (p.y < wy) water = mix(C_GRAPHITE * 0.12, C_BONE * 0.05, 0.3) + C_SIGNAL * 0.03;
      col = water;
      // ---- 沙底與石頭
      float sandY = SAND + 18.0 * sin(p.x * 0.004 + 1.0) + 8.0 * sin(p.x * 0.013);
      if (p.y > sandY) {
        vec3 sand = mix(C_ASH * 0.12, C_GRAPHITE * 0.1, clamp((p.y - sandY) / 90.0, 0.0, 1.0));
        sand *= 0.85 + 0.15 * snoise(p / 6.0);
        sand += (C_SIGNAL * 0.02 + C_BONE * 0.012) * caustic(p * vec2(1.0, 2.2), t) * (1.0 - clamp((p.y - sandY) / 110.0, 0.0, 1.0));
        col = sand;
      }
      // 石頭（幾顆暗暗的圓石）
      for (int i = 0; i < 5; i++) {
        float fi = float(i);
        vec2 rc = vec2(250.0 + fi * 380.0 + 90.0 * sin(fi * 3.7), SAND + 50.0 + 20.0 * sin(fi * 1.9));
        float rd = length((p - rc) / vec2(80.0 + 30.0 * sin(fi * 2.3), 42.0)) - 1.0;
        // 石頭上面被水面的光照到一點，下面埋在沙裡的地方暗
        float top = 1.0 - clamp((p.y - rc.y + 42.0) / 70.0, 0.0, 1.0);
        vec3 rock = C_INK2 * 0.7 + (C_GRAPHITE * 0.14 + C_SIGNAL * 0.01) * top * top * (0.8 + 0.2 * snoise(p / 9.0));
        if (rd < 0.0) col = mix(col, rock, smoothstep(0.0, -0.05, rd));
      }
      // 水草：一條條細長的暗影，底部固定、上面跟著水搖
      float cw = 58.0;
      float cid = floor(p.x / cw);
      for (int k = -1; k <= 1; k++) {
        float id = cid + float(k);
        float hh = hash12(vec2(id, 4.0));
        // 沒有水草的格子高度是 0（不用 continue：ANGLE 在迴圈裡的 continue 偶爾會算錯）
        float h = (70.0 + 170.0 * hash12(vec2(id, 7.0))) * step(0.62, hh);
        float base = SAND + 40.0;
        float u = clamp((base - p.y) / h, 0.0, 1.0);
        float x0 = (id + 0.5) * cw + 22.0 * sin(t * 0.8 + id) * u * u + 9.0 * sin(p.y * 0.035 + t * 1.3 + id) * u;
        float wdt = 5.0 * (1.0 - u * 0.85) + 2.0 * sin(p.y * 0.08 + id);
        if (h > 0.0 && p.y < base && p.y > base - h) col = mix(col, C_INK * 0.7 + C_GRAPHITE * 0.03, (1.0 - smoothstep(wdt - 1.0, wdt + 1.0, abs(p.x - x0))) * 0.75);
      }
      // 缸的上框
      if (p.y < TOP) col = C_INK * 0.6;
      // 玻璃：一道很淡的斜反光
      col += C_BONE * 0.012 * smoothstep(0.0, 1.0, 1.0 - abs(fract((p.x - p.y * 0.6) / 1400.0) - 0.5) * 8.0);
    } else if (p.y < FLOOR) {
      // 底櫃：黑色，上緣一道被水照到的亮邊
      col = C_INK * 0.7 + (C_SIGNAL * 0.05 + C_BONE * 0.02) * exp(-(p.y - BASE) / 5.0);
    } else {
      // 展廳地板：暗、有一點點水族箱的倒影
      float r = exp(-(p.y - FLOOR) / 70.0);
      col = C_INK * 0.6 + (C_GRAPHITE * 0.05 + C_SIGNAL * 0.015) * r * (0.7 + 0.3 * sin(p.x * 0.01 + t));
    }

    // ---- 解說牌（燈箱）：深色的鋁框、亮起來的面板；後面水族箱的光在右邊框上一道邊光；地上一根柱子與影子
    float dp = rbox(p, pnl.xy, pnl.zw, 6.0);
    float pcx = (pnl.x + pnl.z) * 0.5;
    // 柱子
    if (abs(p.x - pcx) < 14.0 && p.y > pnl.w && p.y < FLOOR + 70.0) col = C_INK * 0.5 + C_GRAPHITE * 0.04 * (1.0 - abs(p.x - pcx) / 14.0);
    // 地上的影子與燈箱的光
    if (p.y > FLOOR) col += C_BONE * 0.018 * lamp * exp(-pow(length((p - vec2(pcx, FLOOR + 60.0)) / vec2(320.0, 50.0)), 2.0));
    // 燈箱四周的空氣被照亮一點（很淡）
    col += (C_BONE * 0.01 + C_SIGNAL * 0.004) * lamp * exp(-max(dp, 0.0) / 60.0) * step(0.0, dp);
    if (dp < 0.0) {
      float frame = step(-6.0, dp);
      vec2 u = (p - pnl.xy) / (pnl.zw - pnl.xy);
      // 面板：燈箱亮起來是暖暖的深灰（字是亮的，面板本身不刺眼），中間亮、邊緣暗
      vec3 face = C_INK2 * 0.9 + (C_GRAPHITE * 0.12 + C_SIGNAL * 0.012) * lamp * (1.0 - 0.35 * length(u - 0.5));
      vec3 fr = C_INK * 0.9 + C_GRAPHITE * 0.05;
      fr += (C_BONE * 0.08 + C_SIGNAL * 0.05) * smoothstep(pnl.z - 12.0, pnl.z - 2.0, p.x);  // 右邊框的邊光
      fr += C_BONE * 0.03 * (1.0 - smoothstep(0.0, 3.0, p.y - pnl.y));
      // 燈箱是一片薄薄的壓克力：後面的水族箱透過來一點點（容器要輕）
      col = mix(mix(col, face, 0.86), fr, frame);
    }
    col *= kin;
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 }, kin: { value: 1 }, lamp: { value: 1 }, kick: { value: 0 }, pnl: { value: new THREE.Vector4(120, 560, 860, 936) } });

interface Fish { u: number; v: number; d: number; s: number; w: number }
interface Form { t: number; shape: Shape; x: number; y: number; r: number; dir: number }

export default class Aquarium extends Scene {
  bg = shared('aquarium.bg', BG);
  /** 解說牌上的字（init 畫一次）。 */
  panel = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 玻璃上的歌詞（每格重畫）。 */
  text = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fish = this.track(new LineBatch(NFISH * 2 + 1200, { screen2D: true, blend: 'normal' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 173 + (this.msg?.id ?? 0) * 7919) >>> 0;
  /** 燈箱（x0, y0, x1, y1）：照字的多少決定大小。 */
  pnl = { x0: PANEL_AT.x0, y0: 560, x1: 860, y1: PANEL_AT.y1 };
  fp: Fish[] = [];
  /** 每個小節線的隊形。 */
  forms: Form[] = [];
  beats: number[] = [];
  tFirst = 0;
  hasLyrics = false;
  msgSize: number | null = null;
  lyrStyle: LyricStyle = { family: FAM_LYR, size: 48, minSize: V2.lyrMin, maxWidth: LYR.w };

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
    const sig = m ? sigOf(m) : '';
    await loadText(`${T16_TEXT}${m?.text ?? ''}${sig}${lyrics.linesIn(s - 1, e + 1).map((l) => l.text).join('')}${song.title}${song.artist}${HEAD}${no3(m?.n ?? 0)}${INVITE.join('')}祝福魚群Benedictio aeterna`);
    const beat = au.beatPeriod(s);
    this.tFirst = beatAfter(au, s + Math.min(0.2, beat * 0.4));
    this.beats = winBeats(au, s - 2, e);

    // ---- 魚：每條魚在隊形裡的位置參數（u 沿著隊形、v 橫向）、出發晚多少、大小
    const rnd = (i: number, k: number) => hash(this.seed, i, k);
    for (let i = 0; i < NFISH; i++) this.fp.push({ u: rnd(i, 1), v: rnd(i, 2), d: 0.35 * rnd(i, 3), s: 0.75 + 0.5 * rnd(i, 4), w: 0.6 + 0.8 * rnd(i, 5) });
    // ---- 隊形：窗格開始前一個（開場時魚已經在游）＋每個小節線換一個，中心在開闊的水裡（避開左上的歌詞、左下的解說牌）
    const bars = winBars(au, s - 4, e + 1);
    let prevShape = -1;
    bars.forEach((tb, k) => {
      let si = Math.floor(rnd(k, 31) * SHAPES.length);
      if (si === prevShape) si = (si + 1) % SHAPES.length;
      prevShape = si;
      this.forms.push({ t: tb, shape: SHAPES[si]!, x: 1000 + 560 * rnd(k, 32), y: 380 + 200 * rnd(k, 33), r: 150 + 70 * rnd(k, 34), dir: rnd(k, 35) < 0.5 ? 1 : -1 });
    });
    if (!this.forms.length) this.forms.push({ t: s - 1, shape: 'ball', x: 1280, y: 460, r: 180, dir: 1 });

    // ---- 解說牌上的字（畫一次）
    this.drawPanel(sig);
    this.lyrStyle = { family: FAM_LYR, size: lyricV2(this.msgSize), minSize: V2.lyrMin, maxWidth: LYR.w, lineHeight: 1.18 };
  }

  /** 解說牌：上面一行小字、留言、署名；沒有留言：「祝福魚群」與邀請。燈箱的大小照字決定（左下角固定）。 */
  private drawPanel(sig: string) {
    const c = this.panel.ctx, m = this.msg;
    c.clearRect(0, 0, W, H);
    c.textBaseline = 'alphabetic';
    let bw: number, bh: number;
    let paint: (x: number, y: number) => void;
    if (m) {
      const o = { min: V2.msgMin, max: msgMaxFor(m.text), lineHeight: 1.3, maxLines: 6 };
      const fit: FitResult = fitClauses(c, m.text, FAM_MSG, PTXT_MAX.w, PTXT_MAX.h - 46, o) ?? fitText(c, m.text, FAM_MSG, PTXT_MAX.w, PTXT_MAX.h - 46, o);
      this.msgSize = fit.size;
      const ss = sigV2(fit.size);
      c.font = font(F.ming(400), ss);
      const sw = c.measureText(sig).width;
      bw = Math.max(fit.width, sw + 40, 300);
      bh = fit.size + (fit.lines.length - 1) * fit.lineHeight + ss * 1.7;
      paint = (x, y) => {
        drawMessage(c, fit, FAM_MSG, x, y + fit.size * 0.9, { color: rgba('bone', 0.97) });
        c.font = font(F.ming(400), ss); c.fillStyle = rgba('bone', 0.72); c.textAlign = 'right';
        c.fillText(sig, x + bw, y + fit.size * 0.9 + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.3 + ss * 1.3);
        c.textAlign = 'left';
      };
    } else {
      bw = 380; bh = 44 + 34 + INVITE.length * 34;
      paint = (x, y) => {
        c.font = font(F.ming(700), 40); c.fillStyle = rgba('bone', 0.92);
        c.fillText('祝福魚群', x, y + 38);
        c.font = font(F.serif(400, true), 24); c.fillStyle = rgba('bone', 0.6);
        c.fillText('Benedictio aeterna', x + 180, y + 36);
        c.font = font(F.hei(500), 22); c.fillStyle = rgba('bone', 0.72);
        INVITE.forEach((ln, i) => c.fillText(ln, x, y + 44 + 34 + i * 34));
      };
    }
    // 燈箱：左下角固定，寬高 = 字 + 邊距
    const W0 = bw + PAD.x * 2, H0 = bh + PAD.top + PAD.bottom;
    this.pnl = { x0: PANEL_AT.x0, y0: PANEL_AT.y1 - H0, x1: PANEL_AT.x0 + W0, y1: PANEL_AT.y1 };
    const x = this.pnl.x0 + PAD.x, y = this.pnl.y0 + PAD.top;
    c.font = font(F.hei(500), 17); c.letterSpacing = '4px'; c.fillStyle = rgba('ash', 0.75);
    c.fillText(m ? `${HEAD}　${no3(m.n)}` : HEAD, x, this.pnl.y0 + 34);
    c.letterSpacing = '0px';
    c.fillStyle = rgba('ash', 0.3); c.fillRect(x, this.pnl.y0 + 46, W0 - PAD.x * 2, 1);
    paint(x, y);
    this.panel.upload();
  }

  /** 隊形 f 裡第 i 條魚在 t 的位置（隊形本身也在慢慢轉、流動）。 */
  private shapeAt(f: Form, fi: Fish, t: number) {
    const w = t * 0.5 * f.dir * fi.w, R = f.r;
    let x = 0, y = 0;
    switch (f.shape) {
      case 'ball': { const r = R * Math.sqrt(fi.u), a = fi.v * TAU + w; x = Math.cos(a) * r * 1.35; y = Math.sin(a) * r * 0.75; break; }
      case 'ring': { const r = R * (0.82 + 0.18 * fi.v), a = fi.u * TAU + w * 0.8; x = Math.cos(a) * r * 1.4; y = Math.sin(a) * r * 0.62; break; }
      case 'wave': { const L = R * 3.2; x = (fi.u - 0.5) * L; y = Math.sin(fi.u * TAU * 1.3 + t * 2.2 * f.dir) * R * 0.45 + (fi.v - 0.5) * 46; break; }
      case 'spiral': { const r = R * (0.15 + 0.85 * fi.u), a = fi.u * TAU * 2.2 + w * 1.4; x = Math.cos(a) * r * 1.35 + (fi.v - 0.5) * 20; y = Math.sin(a) * r * 0.7 + (fi.v - 0.5) * 20; break; }
      case 'stream': { const L = R * 3.6, k = fract(fi.u + t * 0.12 * f.dir); x = (k - 0.5) * L; y = (k - 0.5) * L * -0.22 + Math.sin(k * 9 + t) * 18 + (fi.v - 0.5) * 60; break; }
    }
    return { x: f.x + x, y: f.y + y };
  }

  /** 第 i 條魚在 t 的位置：從上一個隊形流到這一個（小節線上出發，每條魚晚一點點，路上往外拱一點）。 */
  private pos(i: number, t: number) {
    const fi = this.fp[i]!, F2 = this.forms;
    let k = 0;
    while (k < F2.length - 1 && F2[k + 1]!.t <= t) k++;
    const cur = F2[k]!, prev = F2[Math.max(0, k - 1)]!;
    const b = this.shapeAt(cur, fi, t);
    if (k === 0) return b;
    const u = ease.inOutCubic(clamp((t - cur.t - fi.d) / 0.9));
    if (u >= 1) return b;
    const a = this.shapeAt(prev, fi, t);
    const arc = Math.sin(Math.PI * u) * (fi.v - 0.5) * 120;
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u + arc };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, song } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const u = this.bg.u;
    const kin = prog(t, s, s + 0.2);
    // 燈箱：第一拍「啪、啪」閃兩下亮起來
    const dt = t - this.tFirst;
    const lamp = dt < 0 ? 0.06 : dt < 0.05 ? 1 : dt < 0.11 ? 0.15 : dt < 0.16 ? 0.9 : dt < 0.2 ? 0.35 : Math.min(1, 0.8 + (dt - 0.2) * 2);
    u.t!.value = t; u.kin!.value = kin; u.lamp!.value = lamp; u.kick!.value = f.a.kick;
    (u.pnl!.value as THREE.Vector4).set(this.pnl.x0, this.pnl.y0, this.pnl.x1, this.pnl.y1);
    this.bg.render(renderer, out);

    // ---- 魚（燈箱在缸前面：燈箱後面的魚不畫）
    const lb = this.fish; lb.clear();
    const B = LIN.bone, S = LIN.signal;
    let lastBeat = -Infinity;
    for (const b of this.beats) if (b <= t) lastBeat = b;
    const pn = this.pnl;
    for (let i = 0; i < NFISH; i++) {
      const p = this.pos(i, t), q = this.pos(i, t - 0.04);
      if (p.x > pn.x0 - 4 && p.x < pn.x1 + 4 && p.y > pn.y0 - 4 && p.y < pn.y1 + 4) continue;
      if (p.y < TANK.surf + 10 || p.y > TANK.sand + 20) continue;
      const ang = Math.atan2(p.y - q.y, p.x - q.x);
      // 每一拍：一道銀光從左到右掃過魚群（一起翻身反光）
      const glint = lastBeat > -Infinity ? pulse(t, lastBeat + (p.x - 700) / 3000, 0.1) : 0;
      const fi = this.fp[i]!;
      const k = 0.5 + 0.12 * fi.w + 0.45 * glint;
      const col: [number, number, number] = [B[0] * k + S[0] * 0.25 * glint, B[1] * k + S[1] * 0.25 * glint, B[2] * k + S[2] * 0.25 * glint];
      const a = 0.8 * kin;
      const L = 7 * fi.s, cx = Math.cos(ang), cy = Math.sin(ang);
      lb.seg2(p.x - cx * L * 0.3, p.y - cy * L * 0.3, p.x + cx * L * 0.5, p.y + cy * L * 0.5, 3.0 * fi.s, col, a);
      const wag = Math.sin(t * 18 + i) * 0.5 + glint * 0.9;
      const tx = -cx * L * 0.3, ty = -cy * L * 0.3;
      lb.seg2(p.x + tx, p.y + ty, p.x + tx - Math.cos(ang + wag) * L * 0.5, p.y + ty - Math.sin(ang + wag) * L * 0.5, 1.5 * fi.s, col, a * 0.8);
    }

    // ---- 氣泡：每一拍從打氣石冒一串（4～6 顆），一邊晃一邊往上，到水面就沒了
    this.beats.forEach((tb, k) => {
      const n = 4 + Math.floor(hash(this.seed, k, 41) * 3);
      for (let j = 0; j < n; j++) {
        const t0 = tb + j * 0.07;
        const age = t - t0;
        if (age < 0) continue;
        const r = 3 + 6 * hash(this.seed, k, j, 42);
        const v = 170 + 90 * hash(this.seed, k, j, 43) - r * 4;
        const y = STONE.y - v * age - 20 * age * age;
        if (y < TANK.surf + 4) continue;
        const x = STONE.x + (hash(this.seed, k, j, 44) - 0.5) * 20 + Math.sin(age * 7 + j) * (4 + r * 0.8);
        const a = 0.55 * kin * clamp(age / 0.08);
        const seg = 12;
        for (let q = 0; q < seg; q++) {
          const a0 = (q / seg) * TAU, a1 = ((q + 1) / seg) * TAU;
          lb.seg2(x + Math.cos(a0) * r, y + Math.sin(a0) * r, x + Math.cos(a1) * r, y + Math.sin(a1) * r, 1.1, [B[0] * 0.8, B[1] * 0.8, B[2] * 0.8], a);
        }
        lb.seg2(x - r * 0.35, y - r * 0.35, x - r * 0.34, y - r * 0.34, Math.max(1.2, r * 0.35), [B[0], B[1], B[2]], a);
      }
    });
    lb.render(renderer, out);

    // ---- 解說牌上的字（燈箱亮度）、玻璃上的歌詞
    comp.draw(renderer, this.panel.texture, out, { opacity: kin * (0.12 + 0.88 * lamp) });
    const L = this.text; L.clear();
    const c = L.ctx;
    c.globalAlpha = kin;
    if (this.hasLyrics) {
      const ly = lyricAt(lyrics, t);
      if (ly) {
        c.save(); c.translate(LYR.x, LYR.y);
        drawLyric(c, ly.line, t, this.lyrStyle, layoutLyric(c, ly.line, this.lyrStyle), ly.k);
        c.restore();
      }
    } else {
      c.font = font(F.mono(500), 18); c.letterSpacing = '4px'; c.fillStyle = rgba('ash', 0.6);
      c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`, LYR.x, LYR.y);
      c.letterSpacing = '0px';
    }
    comp.draw(renderer, L.upload(), out);
    return { bloom: 0.7, vignette: 0.55, halation: 0.22, zoom: 1 + 0.035 * ease.inOutQuad(f.p) };
  }
}

const fract = (x: number) => x - Math.floor(x);
