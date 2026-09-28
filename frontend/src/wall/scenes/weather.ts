// 氣象報告（批次 T6・螢幕 B，亮）：一張印出來的「地面天氣圖」擺在桌上，鏡頭斜斜地從上面看、很慢地滑過去。
// MV 檢修後：整張圖先畫進一張「紙」的貼圖，再用 _t6 的 ScreenRig 擺在桌面上（透視、遠端景深、紙下的影子）。紙上只留：
//  - 主打留言：用手寫字直接寫在紙上左半邊的海面（「今日天氣小語」），整個畫面最大最清楚；署名在下面。
//  - 歌詞：紙的上緣印著「今日預報」那一行（逐字跟唱，小一級）；純音樂時是「晴時多雲　偶陣愛」。
//  - 右半邊的天氣圖：等壓線（GLSL 算氣壓場、畫等值線），台灣東邊一團「愛情高氣壓」，最裡面幾圈是愛心形的，
//    大鼓一打就像心跳一樣往外鼓一下；「愛情暖鋒」每個小節線往台灣推進一段；台北上空的太陽光芒一拍轉一格；幾支風標。
//  - 小字只有三小群：「今日預報」「今日天氣小語」兩個標籤，與右上角的「降愛機率 100%」（拍點上一格一格跳到 100）。
// 手法：紙＝一個 GLSL pass（紙紋＋等壓線）＋一張不會變的 Canvas 層（台灣）＋一張每格重畫的 Canvas 層，全部畫進一張 render target；
// 桌面是另一個 GLSL pass。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, makeRT } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog, TAU } from '../engine/util';
import type { FitResult } from '../engine/text';
import type { Lyrics } from '../engine/lyrics';
import { lyricAt, drawLyric, layoutLyric, beatAfter, signature, drawMessage, sparkHead, sparkParticles } from './_motifs';
import { taiwanIn, VENUE, fitMessage, inOut, ScreenRig, loadPlateText } from './_t6';

export const spec: PlateSpecDecl = { group: 'type', family: 'screen', paper: true, energy: [0.15, 0.75], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 紙（1920×1080 的貼圖座標，y 向下）
const X0 = 120;
const LYR_Y = 206; // 歌詞基線
const MSG = { x: X0, y: 340, w: 900, h: 560 }; // 留言（含署名）
const TW_BOX = { x: 1150, y: 250, h: 470 }; // 台灣（中心經度的 x、北端 y、南北高度）
const HIGH = { x: 1540, y: 520, s: 150 }; // 愛情高氣壓的中心與大小（px）
const LOW = { x: 1800, y: 170, s: 100 };
const STAT = { x: 1560, y: 116 }; // 降愛機率（右上）
const TEXT = '今日預報今日天氣小語降愛機率愛情高氣壓暖鋒低晴時多雲偶陣愛現場還沒有收到掃描右下角寫一句給新人';

// 氣壓場（shader 與 CPU 共用同一條公式：CPU 算等壓線的數字標在哪裡）
const HEART_GLSL = /* glsl */ `
float dot2(vec2 v) { return dot(v, v); }
// iq 的愛心距離場：底尖在 (0,0)，上緣約 y = 1.1，y 向上
float sdHeart(vec2 p) {
  p.x = abs(p.x);
  if (p.y + p.x > 1.0) return sqrt(dot2(p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
  return sqrt(min(dot2(p - vec2(0.0, 1.0)), dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}`;
function sdHeart(x: number, y: number) {
  x = Math.abs(x);
  if (y + x > 1) return Math.hypot(x - 0.25, y - 0.75) - Math.SQRT2 / 4;
  const m = 0.5 * Math.max(x + y, 0);
  return Math.sqrt(Math.min((x) ** 2 + (y - 1) ** 2, (x - m) ** 2 + (y - m) ** 2)) * Math.sign(x - y);
}
/** 紙面座標（y 向下）的氣壓（hPa）。 */
function pressure(px: number, py: number, pulse = 0) {
  const hs = HIGH.s * (1 + 0.035 * pulse);
  const hx = (px - HIGH.x) / hs, hy = (HIGH.y - py) / hs + 0.55;
  const d = sdHeart(hx, hy);
  const hi = 30 * Math.exp(-Math.max(d, 0) * 0.55) + 4 * Math.min(-d, 0.4) * (d < 0 ? 1 : 0);
  const lo = 14 * Math.exp(-(((px - LOW.x) ** 2 + (py - LOW.y) ** 2) / (LOW.s * LOW.s * 2.2)));
  return 1004 + hi - lo + 0.004 * (px - 900) - 0.003 * (py - 500);
}

// 紙：奶茶色、雲紋、纖維；等壓線只在右半邊的地圖清楚，往左（留言那邊）淡掉，字後面才乾淨
const SHEET = () => new FSPass(/* glsl */ `
  ${HEART_GLSL}
  uniform float pulse;
  float pressure(vec2 p) {
    float hs = ${HIGH.s}.0 * (1.0 + 0.035 * pulse);
    vec2 h = vec2((p.x - ${HIGH.x}.0) / hs, (${HIGH.y}.0 - p.y) / hs + 0.55);
    float d = sdHeart(h);
    float hi = 30.0 * exp(-max(d, 0.0) * 0.55) + 4.0 * min(-d, 0.4) * step(d, 0.0);
    vec2 l = p - vec2(${LOW.x}.0, ${LOW.y}.0);
    float lo = 14.0 * exp(-dot(l, l) / ${(LOW.s * LOW.s * 2.2).toFixed(1)});
    return 1004.0 + hi - lo + 0.004 * (p.x - 900.0) - 0.003 * (p.y - 500.0);
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y); // y 向下
    float n = fbm(p / 380.0, 4), fib = snoise(p * vec2(0.9, 0.08));
    vec3 col = C_PAPER * (0.975 + 0.025 * n + 0.008 * fib);
    float P = pressure(p);
    float fw = max(fwidth(P), 1e-4);
    float d4 = abs(fract(P / 4.0 + 0.5) - 0.5) * 4.0 / fw;
    float d20 = abs(fract(P / 20.0 + 0.5) - 0.5) * 20.0 / fw;
    float line = pxLine(d4, 0.45, 1.4) * 0.3 + pxLine(d20, 0.9, 2.0) * 0.22;
    line *= 0.15 + 0.85 * smoothstep(900.0, 1180.0, p.x);
    float hs = ${HIGH.s}.0 * (1.0 + 0.035 * pulse);
    float dh = sdHeart(vec2((p.x - ${HIGH.x}.0) / hs, (${HIGH.y}.0 - p.y) / hs + 0.55));
    col = mix(col, mix(col, C_SIGNAL, 0.28), smoothstep(0.35, -0.05, dh));
    col = mix(col, C_SEPIA, line);
    fragColor = vec4(col, 1.0);
  }`, { pulse: { value: 0 } });

// 桌面：比紙暗一點的淺色（亮版面，但紙要是最亮的東西），紙下面一圈柔和的影子
const TABLE = () => new FSPass(/* glsl */ `
  uniform vec2 c; uniform vec2 r; uniform float k;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float grain = fbm(p * vec2(0.004, 0.03), 3);
    vec3 col = C_PAPER * (0.74 + 0.03 * grain - 0.06 * smoothstep(0.0, 1080.0, p.y));
    vec2 d = (p - c - vec2(14.0, 26.0)) / (r + 40.0);
    float sh = exp(-pow(max(abs(d.x), abs(d.y)), 8.0) * 1.0);
    col *= 1.0 - 0.16 * sh;
    fragColor = vec4(col * mix(0.85, 1.0, k), 1.0);
  }`, { c: { value: new THREE.Vector2(960, 540) }, r: { value: new THREE.Vector2(800, 450) }, k: { value: 1 } });

interface Barb { x: number; y: number; ph: number }

export default class Weather extends Scene {
  sheetBg = shared('weather.sheet', SHEET);
  table = shared('weather.table', TABLE);
  base = this.track(new Layer2D(W, H, undefined, { fast: true }));
  live = this.track(new Layer2D(W, H, undefined, { fast: true }));
  paperRT = this.track(makeRT(W, H, { depthBuffer: false }));
  rig: ScreenRig;
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  fit: FitResult | null = null;
  b0 = 0; tMsg = 0; msgTop = 0;
  labels: { x: number; y: number; v: number }[] = [];
  barbs: Barb[] = [];
  private baseDrawn = false;

  constructor(ctx: ConstructorParameters<typeof Scene>[0]) {
    super(ctx);
    // 紙的貼圖要 mipmap：遠端的景深
    const tex = this.paperRT.texture;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.rig = new ScreenRig(tex, W, H, { decode: false, bezel: 0, radius: 2 });
  }

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start;
    await loadPlateText(this.ctx, TEXT);
    this.b0 = beatAfter(au, s + 0.05);
    this.tMsg = this.b0 + Math.min(au.beatPeriod(this.b0) * 0.5, 0.35);
    // 等壓線的數字：從高氣壓中心往右下拉一條射線，每跨過一條 8 hPa 的線標一個
    let prevP = pressure(HIGH.x, HIGH.y);
    for (let r = 150; r < 360; r += 3) {
      const x = HIGH.x + Math.cos(0.5) * r, y = HIGH.y + Math.sin(0.5) * r;
      const P = pressure(x, y);
      const lv = Math.floor(prevP / 8) * 8;
      if (P < lv && lv > 1000) this.labels.push({ x, y, v: lv });
      prevP = P;
    }
    // 風標：種子亂數散在地圖上（只在右半邊，避開台灣與高氣壓中心）
    const seed = (this.ctx.params.seed ?? 1) * 13;
    for (let i = 0; this.barbs.length < 6 && i < 300; i++) {
      const x = 1000 + hash(seed, i) * 820, y = 280 + hash(seed, i + 99) * 620;
      if (Math.hypot(x - HIGH.x, y - HIGH.y) < 170 || (x > TW_BOX.x - 170 && x < TW_BOX.x + 130 && y > TW_BOX.y - 40 && y < TW_BOX.y + TW_BOX.h + 20)) continue;
      if (this.barbs.some((b) => Math.hypot(b.x - x, b.y - y) < 170)) continue;
      this.barbs.push({ x, y, ph: hash(seed, i + 7) });
    }
    const c = this.live.ctx;
    const text = this.msg ? this.msg.text : '今天的天氣小語，還沒有收到。';
    this.fit = fitMessage(c, text, F.hand(700), MSG.w, MSG.h - (this.msg ? 90 : 120), { min: 56, max: this.msg ? 124 : 76, lineHeight: 1.24 });
    const block = this.fit.height + (this.msg ? 90 : 90);
    this.msgTop = MSG.y + Math.max(0, (MSG.h - block) / 2) + this.fit.size * 0.9;
  }

  override dispose() { this.rig.dispose(); super.dispose(); }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const k = inOut(t, s, e, 0.3, 0.25);
    const pulse = au.hit('kick', t, 0.16);
    // 1) 紙
    this.sheetBg.u.pulse!.value = pulse;
    this.sheetBg.render(renderer, this.paperRT);
    if (!this.baseDrawn) { this.drawBase(); this.baseDrawn = true; }
    comp.draw(renderer, this.base.texture, this.paperRT);
    const L = this.live; L.clear();
    const c = L.ctx;
    c.textBaseline = 'alphabetic';
    const sun = this.drawMap(c, t, pulse);
    this.drawStat(c, t);
    this.drawLyricBand(c, t, lyrics);
    this.drawMsg(c, t);
    comp.draw(renderer, L.upload(), this.paperRT);
    // 2) 桌面上的紙：從上面斜斜地看，整個窗格很慢地往右滑、往留言推
    const u = ease.inOutQuad(clamp((t - s) / Math.max(1, e - s)));
    const inK = prog(t, s, s + 0.9, ease.outCubic);
    this.rig.pose({ fx: 900, fy: 560, cx: lerp(930, 900, u), cy: lerp(560, 548, u), scale: lerp(0.8, 0.85, u) * lerp(0.96, 1, inK), rx: -0.36, ry: lerp(-0.06, 0.02, u), rz: lerp(0.035, 0.02, u) });
    this.rig.focus(40, 90, 1500, 1000, 150);
    const c0 = this.rig.toScreen(W / 2, H / 2), c1 = this.rig.toScreen(W, H), c2 = this.rig.toScreen(0, 0);
    (this.table.u.c!.value as THREE.Vector2).set(c0.x, c0.y);
    (this.table.u.r!.value as THREE.Vector2).set(Math.abs(c1.x - c2.x) / 2, Math.abs(c1.y - c2.y) / 2);
    this.table.u.k!.value = k;
    this.table.render(renderer, out);
    const U = this.rig.u;
    U.edgeDark!.value = 0.05;
    U.glareK!.value = 0;
    U.k!.value = k;
    this.rig.render(renderer, out);
    // 太陽的核心：一小顆會發光的訊號色（亮版面上也看得出來是「亮」的）
    this.glow.clear();
    if (sun && k > 0.5) {
      const p = this.rig.toScreen(sun.x, sun.y);
      sparkHead(this.glow, p.x, p.y, t, 0.55, 0.5);
      if (t < this.b0 + 0.6) sparkParticles(this.glow, t, () => p, { rate: 40, life: 0.3, speed: 150, seed: 4 });
    }
    if (this.glow.count) this.glow.render(renderer, out);
    return { paper: 1, bloom: 0.3, vignette: 0.3, grain: 0.04 };
  }

  // ------------------------------------------------------------ 不會變的：台灣
  private drawBase() {
    const c = this.base.ctx;
    this.base.clear();
    const tw = taiwanIn(TW_BOX.x, TW_BOX.y, TW_BOX.h);
    const path = new Path2D();
    tw.pts.forEach((p, i) => (i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)));
    path.closePath();
    c.fillStyle = rgba('paper', 0.85); c.fill(path);
    c.save(); c.clip(path);
    c.strokeStyle = rgba('sepia', 0.16); c.lineWidth = 1.1;
    for (let d = -600; d < 900; d += 8) { c.beginPath(); c.moveTo(TW_BOX.x - 300 + d, TW_BOX.y - 20); c.lineTo(TW_BOX.x - 300 + d - 500, TW_BOX.y + 480); c.stroke(); }
    c.restore();
    c.strokeStyle = rgba('sepia', 0.75); c.lineWidth = 2.2; c.lineJoin = 'round'; c.stroke(path);
    this.base.upload();
  }

  // ------------------------------------------------------------ 地圖上會動的記號
  /** 回傳太陽在紙上的位置（給發光的核心）。 */
  private drawMap(c: CanvasRenderingContext2D, t: number, pulse: number) {
    const au = this.ctx.audio;
    const bt = au.beatAt(t);
    c.font = font(F.mono(500), 18);
    for (const lb of this.labels) {
      const s = String(lb.v), w = c.measureText(s).width;
      c.fillStyle = rgba('paper', 0.95); c.fillRect(lb.x - w / 2 - 4, lb.y - 12, w + 8, 22);
      c.fillStyle = rgba('sepia', 0.55); c.fillText(s, lb.x - w / 2, lb.y + 6);
    }
    c.textAlign = 'center';
    c.font = font(F.ming(900), 86 * (1 + 0.05 * pulse)); c.fillStyle = rgba('blood', 0.85);
    c.fillText('高', HIGH.x, HIGH.y + 22);
    c.font = font(F.hei(700), 24); c.fillStyle = rgba('blood', 0.75);
    c.fillText('愛情高氣壓', HIGH.x, HIGH.y + 66);
    c.font = font(F.ming(900), 54); c.fillStyle = rgba('sepia', 0.5);
    c.fillText('低', LOW.x, LOW.y + 18);
    c.textAlign = 'left';
    // 風標：繞著高氣壓順時針吹（北半球），一拍轉一點
    for (const b of this.barbs) {
      const tang = Math.atan2(b.y - HIGH.y, b.x - HIGH.x) + Math.PI / 2;
      const wob = 0.35 * Math.sin((Math.floor(bt) + b.ph * 7) * 1.7) * (1 - prog(bt - Math.floor(bt), 0, 0.25, ease.outBack));
      const a = tang + wob, Lb = 50;
      c.strokeStyle = rgba('sepia', 0.5); c.lineWidth = 1.8;
      c.beginPath(); c.arc(b.x, b.y, 5, 0, TAU); c.stroke();
      c.beginPath(); c.moveTo(b.x - Math.cos(a) * 5, b.y - Math.sin(a) * 5); c.lineTo(b.x - Math.cos(a) * Lb, b.y - Math.sin(a) * Lb); c.stroke();
      for (let j = 0; j < 2; j++) {
        const px = b.x - Math.cos(a) * (Lb - j * 10), py = b.y - Math.sin(a) * (Lb - j * 10);
        c.beginPath(); c.moveTo(px, py); c.lineTo(px + Math.cos(a - 1.2) * 15, py + Math.sin(a - 1.2) * 15); c.stroke();
      }
    }
    // 愛情暖鋒：在高氣壓與台灣之間，每個小節線往台灣推進一段（半圓記號朝前進方向＝朝左）
    const barsIn = au.barAt(t) - au.barAt(this.b0);
    const adv = clamp((Math.floor(Math.max(0, barsIn)) + prog(barsIn - Math.floor(barsIn), 0, 0.3, ease.outExpo)) / 6);
    const ox = lerp(0, -70, adv);
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= 40; i++) {
      const v = i / 40;
      pts.push({ x: 1370 + ox + Math.sin(v * Math.PI) * 30 - v * 40 + Math.sin(v * 7) * 6, y: 330 + v * 380 });
    }
    c.strokeStyle = rgba('blood', 0.8); c.lineWidth = 3.4;
    c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.stroke();
    c.fillStyle = rgba('blood', 0.8);
    for (let i = 3; i < 40; i += 6) {
      const p = pts[i]!, q = pts[i + 1]!;
      const a = Math.atan2(q.y - p.y, q.x - p.x);
      c.beginPath(); c.arc(p.x, p.y, 12, a + Math.PI, a + TAU); c.closePath(); c.fill();
    }
    // 台北上空的太陽：光芒一拍轉一格（outBack，停住）
    const tw = taiwanIn(TW_BOX.x, TW_BOX.y, TW_BOX.h);
    const v = tw.proj(VENUE[0], VENUE[1]);
    const sx = v.x + 90, sy = v.y - 26;
    const rot = (Math.floor(bt) + prog(bt - Math.floor(bt), 0, 0.3, ease.outBack)) * (TAU / 16);
    c.strokeStyle = rgba('blood', 0.85); c.lineWidth = 3.2; c.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const a = rot + i * (TAU / 8), r0 = 28, r1 = 42 + 6 * (i % 2) + 5 * pulse;
      c.beginPath(); c.moveTo(sx + Math.cos(a) * r0, sy + Math.sin(a) * r0); c.lineTo(sx + Math.cos(a) * r1, sy + Math.sin(a) * r1); c.stroke();
    }
    c.lineCap = 'butt';
    c.fillStyle = rgba('signal', 0.95); c.beginPath(); c.arc(sx, sy, 20, 0, TAU); c.fill();
    c.fillStyle = rgba('sepia', 0.85); c.beginPath(); c.arc(v.x, v.y, 5, 0, TAU); c.fill();
    return { x: sx, y: sy };
  }

  /** 右上角的「降愛機率」：第一拍開始一拍跳一格，第四拍到 100%。 */
  private drawStat(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const steps = [0, 37, 64, 88, 100];
    const i = t < this.b0 ? -1 : Math.min(steps.length - 1, Math.floor(au.beatAt(t) - au.beatAt(this.b0) + 1e-4));
    const cur = i < 0 ? 0 : steps[i]!;
    const tj = i < 0 ? this.b0 : au.timeOfBeat(Math.round(au.beatAt(this.b0)) + i);
    const u = prog(t, tj, tj + 0.22, ease.outBack);
    c.font = font(F.hei(500), 22); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.5);
    c.fillText('降愛機率', STAT.x, STAT.y);
    c.letterSpacing = '0px';
    c.font = font(F.archivo(75, 800), 58); c.fillStyle = rgba(cur === 100 ? 'blood' : 'sepia', cur === 100 ? 0.8 : 0.5);
    c.fillText(`${cur}%`, STAT.x, STAT.y + 64 + (1 - u) * 8);
  }

  // ------------------------------------------------------------ 今日預報（歌詞）
  private drawLyricBand(c: CanvasRenderingContext2D, t: number, lyrics: Lyrics) {
    c.font = font(F.hei(500), 22); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.5);
    c.fillText('今日預報', X0, LYR_Y - 78);
    c.letterSpacing = '0px';
    const ly = lyricAt(lyrics, t);
    const size = this.msg ? 66 : 80;
    if (ly) {
      const st = { family: F.archivo(100, 800), size, minSize: 54, maxWidth: 1360 - X0, active: rgba('blood'), sung: rgba('sepia', 0.92), unsung: rgba('sepia', 0.24), lineHeight: 1.1 };
      const lay = layoutLyric(c, ly.line, st);
      c.save(); c.translate(X0, LYR_Y - (lay.height - lay.size) * 0.5);
      drawLyric(c, ly.line, t, st, lay, ly.k);
      c.restore();
    } else {
      c.font = font(F.hei(700), size * 0.85); c.fillStyle = rgba('sepia', lyrics.has ? 0.35 : 0.8);
      c.fillText('晴時多雲　偶陣愛', X0, LYR_Y);
    }
  }

  // ------------------------------------------------------------ 今日天氣小語（留言，寫在紙上）
  private drawMsg(c: CanvasRenderingContext2D, t: number) {
    const fit = this.fit!;
    // 標籤貼在留言的正上方（留言在框裡垂直置中，標籤跟著它）
    c.font = font(F.hei(500), 22); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.5);
    c.fillText('今日天氣小語', X0 + 4, this.msgTop - fit.size * 0.95 - 26);
    c.letterSpacing = '0px';
    const total = fit.lines.reduce((a, l) => a + Array.from(l).length, 0);
    const chars = total * prog(t, this.tMsg, this.tMsg + clamp(0.04 * total + 0.35, 0.6, 2.2));
    if (this.msg) {
      drawMessage(c, fit, F.hand(700), X0, this.msgTop, { chars, color: rgba('sepia', 0.97) });
      const ka = prog(t, this.tMsg + 0.6, this.tMsg + 1.0);
      c.save(); c.globalAlpha *= ka;
      c.font = font(F.hand(400), 52); c.fillStyle = rgba('sepia', 0.72);
      c.fillText(signature(this.msg.name), X0 + 10, this.msgTop + fit.height - fit.size * 0.9 + 84);
      c.restore();
    } else {
      drawMessage(c, fit, F.hand(700), X0, this.msgTop, { chars, color: rgba('sepia', 0.6) });
      c.font = font(F.hei(500), 28); c.fillStyle = rgba('sepia', 0.5 * prog(t, this.tMsg + 0.5, this.tMsg + 0.9));
      c.fillText('掃描右下角 QR code，寫一句給新人。', X0, this.msgTop + fit.height - fit.size * 0.9 + 76);
    }
  }
}
