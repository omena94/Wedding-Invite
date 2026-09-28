// 氣象報告（批次 T6・螢幕 B，亮）：一張印在紙上的「地面天氣圖」。
//  - 整張紙是等壓線（GLSL 算氣壓場、畫等值線）：台灣東邊是一團「愛情高氣壓」，最裡面幾圈等壓線是愛心形的，
//    越往外越圓；大鼓一打，高氣壓就像心跳一樣往外鼓一下。東南邊一個小小的低氣壓。
//  - 台灣本島用細線畫、斜線網點填（地圖的畫法），台北上空一顆太陽，光芒一拍轉一格；
//    「愛情暖鋒」（半圓記號的鋒面線）每個小節線往台灣推進一段；各地的風標一拍轉一點，慢慢順著高氣壓繞。
//  - 左邊的數字：降愛機率在拍點上一格一格跳到 100%，其他幾項（體感溫度：甜……）一拍翻出一項。
//  - 上面的「今日預報」是歌詞（逐字跟唱），下面的「今日天氣小語」卡片是主打留言。
// 手法：等壓線、紙張全在一個 shader；台灣、標籤、卡片框畫在一張不會變的 Canvas 層；會動的字與記號在第二張。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog, TAU } from '../engine/util';
import type { FitResult } from '../engine/text';
import type { Lyrics } from '../engine/lyrics';
import { lyricAt, drawLyric, layoutLyric, beatAfter, signature, drawMessage, WEDDING_DATE, DATE_DOTS } from './_motifs';
import { taiwanIn, VENUE, fitMessage, inOut, type Rect } from './_t6';

export const spec: PlateSpecDecl = { group: 'type', family: 'screen', paper: true, energy: [0.15, 0.75], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 版面
const X0 = 100, XR = 1340;
const LYR = { y: 118, h: 96, labelW: 190 }; // 今日預報（歌詞）
const HEAD_Y = 262; // 圖名的 mono 小字
const STAT = { x: X0, y: 306 }; // 左邊的數字欄
const CARD = { x: X0, y: 712, w: XR - X0, h: 262 }; // 今日天氣小語
const TW_BOX = { x: 650, y: 262, h: 430 }; // 台灣（中心經度的 x、北端 y、南北高度）
const HIGH = { x: 1130, y: 450, s: 165 }; // 愛情高氣壓的中心與大小（px）
const LOW = { x: 1330, y: 215, s: 110 };
const STATS: [string, string[]][] = [
  ['體感溫度', ['微溫', '剛好', '甜']],
  ['風向', ['東風', '南風', '吹向彼此']],
  ['紫外線', ['中等', '偏高', '閃閃發光']],
  ['能見度', ['良好', '極佳', '眼裡只有你']],
];
const WEEK = '日一二三四五六';
const TEXT = `今日預報地面天氣圖婚禮氣象站發布降愛機率愛情高氣壓暖鋒低今日天氣小語還沒有收到掃描右下角寫一句給新人晴${STATS.flat(2).join('')}${WEEK}`;

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
/** 畫面座標（y 向下）的氣壓（hPa）。 */
function pressure(px: number, py: number, pulse = 0) {
  const hs = HIGH.s * (1 + 0.035 * pulse);
  const hx = (px - HIGH.x) / hs, hy = (HIGH.y - py) / hs + 0.55;
  const d = sdHeart(hx, hy);
  const hi = 30 * Math.exp(-Math.max(d, 0) * 0.55) + 4 * Math.min(-d, 0.4) * (d < 0 ? 1 : 0);
  const lo = 14 * Math.exp(-(((px - LOW.x) ** 2 + (py - LOW.y) ** 2) / (LOW.s * LOW.s * 2.2)));
  return 1004 + hi - lo + 0.004 * (px - 900) - 0.003 * (py - 500);
}

const BG = () => new FSPass(/* glsl */ `
  ${HEART_GLSL}
  uniform float t; uniform float pulse; uniform float k;
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
    // 紙：奶茶色、雲紋、纖維
    float n = fbm(p / 380.0, 4), fib = snoise(p * vec2(0.9, 0.08));
    vec3 col = C_PAPER * (0.965 + 0.03 * n + 0.008 * fib);
    // 等壓線：每 4 hPa 一條細線、每 20 hPa 一條粗線（fwidth 讓線寬固定幾個像素）
    float P = pressure(p);
    float fw = max(fwidth(P), 1e-4);
    float d4 = abs(fract(P / 4.0 + 0.5) - 0.5) * 4.0 / fw;
    float d20 = abs(fract(P / 20.0 + 0.5) - 0.5) * 20.0 / fw;
    float line = pxLine(d4, 0.45, 1.4) * 0.42 + pxLine(d20, 0.9, 2.0) * 0.35;
    // 高氣壓的中心淡淡地染一點訊號色（跟著心跳）
    float hs = ${HIGH.s}.0 * (1.0 + 0.035 * pulse);
    float dh = sdHeart(vec2((p.x - ${HIGH.x}.0) / hs, (${HIGH.y}.0 - p.y) / hs + 0.55));
    col = mix(col, mix(col, C_SIGNAL, 0.32), smoothstep(0.35, -0.05, dh) * k);
    col = mix(col, C_SEPIA, line * k);
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 }, pulse: { value: 0 }, k: { value: 1 } });

interface Barb { x: number; y: number; ph: number }

export default class Weather extends Scene {
  bg = shared('weather.bg', BG);
  base = this.track(new Layer2D(W, H, undefined, { fast: true }));
  live = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  fit: FitResult | null = null;
  b0 = 0; tCard = 0;
  labels: { x: number; y: number; v: number }[] = [];
  barbs: Barb[] = [];
  private baseDrawn = false;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start;
    await loadText(TEXT);
    this.b0 = beatAfter(au, s + 0.05);
    this.tCard = this.b0 + Math.min(au.beatPeriod(this.b0) * 0.5, 0.35);
    // 等壓線的數字：從高氣壓中心往右上、往左下各拉一條射線，每跨過一條 8 hPa 的線標一個
    for (const [ang, len] of [[-0.35, 420], [2.5, 330], [1.25, 300]] as const) {
      let prevP = pressure(HIGH.x, HIGH.y);
      for (let r = 40; r < len; r += 3) {
        const x = HIGH.x + Math.cos(ang) * r, y = HIGH.y + Math.sin(ang) * r;
        const P = pressure(x, y);
        const lv = Math.floor(prevP / 8) * 8;
        // 太靠近中心的（會被「高」的標籤蓋到）不標
        if (P < lv && lv > 1000 && r > 150) this.labels.push({ x, y, v: lv });
        prevP = P;
      }
    }
    // 風標：種子亂數散在地圖上（避開字與卡片）
    const seed = (this.ctx.params.seed ?? 1) * 13;
    for (let i = 0; this.barbs.length < 16 && i < 200; i++) {
      const x = 480 + hash(seed, i) * 880, y = 250 + hash(seed, i + 99) * 440;
      if (Math.hypot(x - HIGH.x, y - HIGH.y) < 130 || (x > TW_BOX.x - 150 && x < TW_BOX.x + 150 && y > TW_BOX.y && y < TW_BOX.y + TW_BOX.h)) continue;
      if (this.barbs.some((b) => Math.hypot(b.x - x, b.y - y) < 110)) continue;
      this.barbs.push({ x, y, ph: hash(seed, i + 7) });
    }
    if (this.msg) {
      const c = this.live.ctx;
      this.fit = fitMessage(c, this.msg.text, F.hand(400), CARD.w - 330, CARD.h - 70, { min: 44, max: 86, lineHeight: 1.26 });
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const k = inOut(t, s, e, 0.3, 0.25);
    const pulse = au.hit('kick', t, 0.16);
    this.bg.u.t!.value = t;
    this.bg.u.pulse!.value = pulse;
    this.bg.u.k!.value = k;
    this.bg.render(renderer, out);
    if (!this.baseDrawn) { this.drawBase(); this.baseDrawn = true; }
    comp.draw(renderer, this.base.texture, out, { opacity: k });
    const L = this.live; L.clear();
    const c = L.ctx;
    c.globalAlpha = k;
    c.textBaseline = 'alphabetic';
    this.drawMap(c, t, pulse);
    this.drawStats(c, t);
    this.drawLyricBand(c, t, lyrics);
    this.drawCard(c, t);
    comp.draw(renderer, L.upload(), out);
    const avoid: Rect[] = [[X0 - 10, LYR.y - 10, XR - X0 + 20, LYR.h + 20], [CARD.x - 10, CARD.y - 10, CARD.w + 20, CARD.h + 20], [X0 - 10, STAT.y - 10, 360, 240]];
    return { paper: 1, bloom: 0.3, vignette: 0.25, grain: 0.04, popupAvoid: avoid };
  }

  // ------------------------------------------------------------ 不會變的：台灣、框、標籤
  private drawBase() {
    const c = this.base.ctx;
    this.base.clear();
    c.textBaseline = 'alphabetic';
    // 台灣：紙色墊底（蓋掉底下的等壓線一點點）、斜線網點、細輪廓
    const tw = taiwanIn(TW_BOX.x, TW_BOX.y, TW_BOX.h);
    const path = new Path2D();
    tw.pts.forEach((p, i) => (i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)));
    path.closePath();
    c.fillStyle = rgba('paper', 0.82); c.fill(path);
    c.save(); c.clip(path);
    c.strokeStyle = rgba('sepia', 0.22); c.lineWidth = 1.1;
    for (let d = -600; d < 900; d += 7) { c.beginPath(); c.moveTo(TW_BOX.x - 300 + d, TW_BOX.y - 20); c.lineTo(TW_BOX.x - 300 + d - 500, TW_BOX.y + 480); c.stroke(); }
    c.restore();
    c.strokeStyle = rgba('sepia', 0.9); c.lineWidth = 2.2; c.lineJoin = 'round'; c.stroke(path);
    // 圖名（mono 小字）
    const [y, mo, d] = String(WEDDING_DATE).split('-').map(Number) as [number, number, number];
    const wd = WEEK[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
    c.font = font(F.mono(500), 17); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.65);
    c.fillText(`地面天氣圖　${DATE_DOTS}（${wd}）`, X0, HEAD_Y - 8);
    c.fillText('12:00　婚禮氣象站 發布', X0, HEAD_Y + 18);
    c.letterSpacing = '0px';
    // 今日預報的標籤
    c.fillStyle = rgba('sepia', 0.92); c.fillRect(X0, LYR.y, LYR.labelW, LYR.h);
    c.font = font(F.hei(900), 38); c.fillStyle = rgba('paper');
    c.fillText('今日預報', X0 + 20, LYR.y + LYR.h / 2 + 14);
    c.fillStyle = rgba('sepia', 0.5); c.fillRect(X0, LYR.y + LYR.h, XR - X0, 1.4);
    // 數字欄的標籤
    c.font = font(F.hei(700), 28); c.fillStyle = rgba('sepia', 0.9);
    c.fillText('降愛機率', STAT.x, STAT.y + 30);
    c.font = font(F.hei(500), 24);
    STATS.forEach(([lab], i) => { c.fillStyle = rgba('sepia', 0.7); c.fillText(lab, STAT.x, STAT.y + 238 + i * 46); });
    // 天氣小語的卡片框
    c.fillStyle = rgba('sepia', 0.07); c.fillRect(CARD.x + 7, CARD.y + 8, CARD.w, CARD.h);
    c.fillStyle = rgba('paper', 0.97); c.fillRect(CARD.x, CARD.y, CARD.w, CARD.h);
    c.strokeStyle = rgba('sepia', 0.55); c.lineWidth = 1.4; c.strokeRect(CARD.x + 0.5, CARD.y + 0.5, CARD.w - 1, CARD.h - 1);
    c.strokeRect(CARD.x + 6.5, CARD.y + 6.5, CARD.w - 13, CARD.h - 13);
    c.font = font(F.hei(900), 30); c.fillStyle = rgba('sepia', 0.95);
    c.fillText('今日', CARD.x + 40, CARD.y + 76);
    c.fillText('天氣', CARD.x + 40, CARD.y + 116);
    c.fillText('小語', CARD.x + 40, CARD.y + 156);
    c.fillStyle = rgba('sepia', 0.35); c.fillRect(CARD.x + 128, CARD.y + 34, 1.2, CARD.h - 68);
    this.base.upload();
  }

  // ------------------------------------------------------------ 地圖上會動的記號
  private drawMap(c: CanvasRenderingContext2D, t: number, pulse: number) {
    const au = this.ctx.audio;
    const bt = au.beatAt(t);
    // 等壓線的數字（紙色墊底、小小的 mono）
    c.font = font(F.mono(500), 15);
    for (const lb of this.labels) {
      const s = String(lb.v), w = c.measureText(s).width;
      c.fillStyle = rgba('paper', 0.95); c.fillRect(lb.x - w / 2 - 4, lb.y - 11, w + 8, 20);
      c.fillStyle = rgba('sepia', 0.75); c.fillText(s, lb.x - w / 2, lb.y + 5);
    }
    // 高、低
    c.textAlign = 'center';
    c.font = font(F.ming(900), 92 * (1 + 0.05 * pulse)); c.fillStyle = rgba('blood', 0.95);
    c.fillText('高', HIGH.x, HIGH.y + 22);
    c.fillStyle = rgba('paper', 0.9); c.fillRect(HIGH.x - 70, HIGH.y + 36, 140, 64);
    c.font = font(F.mono(600), 18); c.fillStyle = rgba('sepia', 0.85);
    c.fillText(`${Math.round(pressure(HIGH.x, HIGH.y))}`, HIGH.x, HIGH.y + 58);
    c.font = font(F.hei(700), 22); c.fillStyle = rgba('blood', 0.9);
    c.fillText('愛情高氣壓', HIGH.x, HIGH.y + 88);
    c.font = font(F.ming(900), 60); c.fillStyle = rgba('sepia', 0.7);
    c.fillText('低', LOW.x, LOW.y + 20);
    c.textAlign = 'left';
    // 風標：繞著高氣壓順時針吹（北半球），一拍轉一點
    for (const b of this.barbs) {
      const dx = b.x - HIGH.x, dy = b.y - HIGH.y;
      const tang = Math.atan2(dy, dx) + Math.PI / 2; // 順時針（y 向下的畫面上）
      const wob = 0.35 * Math.sin((Math.floor(bt) + b.ph * 7) * 1.7) * (1 - prog(bt - Math.floor(bt), 0, 0.25, ease.outBack));
      const a = tang + wob;
      const L = 46;
      c.strokeStyle = rgba('sepia', 0.7); c.lineWidth = 1.6;
      c.beginPath(); c.arc(b.x, b.y, 5, 0, TAU); c.stroke();
      c.beginPath(); c.moveTo(b.x - Math.cos(a) * 5, b.y - Math.sin(a) * 5); c.lineTo(b.x - Math.cos(a) * L, b.y - Math.sin(a) * L); c.stroke();
      // 羽毛（風速記號）在尾端
      for (let j = 0; j < 2; j++) {
        const px = b.x - Math.cos(a) * (L - j * 9), py = b.y - Math.sin(a) * (L - j * 9);
        c.beginPath(); c.moveTo(px, py); c.lineTo(px + Math.cos(a - 1.2) * 14, py + Math.sin(a - 1.2) * 14); c.stroke();
      }
    }
    // 愛情暖鋒：在高氣壓與台灣之間，每個小節線往台灣推進一段（半圓記號朝前進方向＝朝左）
    const barsIn = au.barAt(t) - au.barAt(this.b0);
    const adv = clamp((Math.floor(Math.max(0, barsIn)) + prog(barsIn - Math.floor(barsIn), 0, 0.3, ease.outExpo)) / 6);
    const ox = lerp(0, -80, adv);
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= 40; i++) {
      const u = i / 40;
      pts.push({ x: 960 + ox + Math.sin(u * Math.PI) * 30 - u * 40 + Math.sin(u * 7) * 6, y: 372 + u * 290 });
    }
    c.strokeStyle = rgba('blood', 0.9); c.lineWidth = 3.2;
    c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.stroke();
    c.fillStyle = rgba('blood', 0.9);
    for (let i = 3; i < 40; i += 6) {
      const p = pts[i]!, q = pts[i + 1]!;
      const a = Math.atan2(q.y - p.y, q.x - p.x);
      c.beginPath(); c.arc(p.x, p.y, 11, a + Math.PI, a + TAU); c.closePath(); c.fill();
    }
    const lp = pts[0]!;
    c.font = font(F.hei(700), 22); c.fillStyle = rgba('blood', 0.95);
    c.fillText('愛情暖鋒', lp.x - 30, lp.y - 18);
    // 台北上空的太陽：光芒一拍轉一格（outBack，停住）
    const tw = taiwanIn(TW_BOX.x, TW_BOX.y, TW_BOX.h);
    const v = tw.proj(VENUE[0], VENUE[1]);
    const sx = v.x + 82, sy = v.y - 18;
    const rot = (Math.floor(bt) + prog(bt - Math.floor(bt), 0, 0.3, ease.outBack)) * (TAU / 16);
    c.strokeStyle = rgba('blood', 0.95); c.lineWidth = 3; c.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const a = rot + i * (TAU / 8), r0 = 25, r1 = 38 + 6 * (i % 2) + 5 * pulse;
      c.beginPath(); c.moveTo(sx + Math.cos(a) * r0, sy + Math.sin(a) * r0); c.lineTo(sx + Math.cos(a) * r1, sy + Math.sin(a) * r1); c.stroke();
    }
    c.lineCap = 'butt';
    c.fillStyle = rgba('signal', 0.95); c.beginPath(); c.arc(sx, sy, 18, 0, TAU); c.fill();
    c.strokeStyle = rgba('blood', 0.95); c.lineWidth = 2.5; c.stroke();
    c.fillStyle = rgba('sepia'); c.beginPath(); c.arc(v.x, v.y, 5, 0, TAU); c.fill();
    c.font = font(F.hei(700), 22); c.fillStyle = rgba('sepia', 0.95);
    c.fillText('現場　晴', sx + 50, sy + 8);
  }

  // ------------------------------------------------------------ 左邊的數字
  private drawStats(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    // 降愛機率：第一拍開始一拍跳一格（亂數但越來越高），第四拍到 100
    const steps = [0, 37, 64, 88, 100];
    const i = t < this.b0 ? -1 : Math.min(steps.length - 1, Math.floor(au.beatAt(t) - au.beatAt(this.b0) + 1e-4));
    const cur = i < 0 ? 0 : steps[i]!, prev = i <= 0 ? 0 : steps[i - 1]!;
    const tj = i < 0 ? this.b0 : au.timeOfBeat(Math.round(au.beatAt(this.b0)) + i);
    const u = prog(t, tj, tj + 0.22, ease.outExpo);
    const fam = F.archivo(75, 900), size = 150, base = STAT.y + 176;
    c.save();
    c.beginPath(); c.rect(STAT.x - 10, STAT.y + 44, 420, 150); c.clip();
    const draw = (v: number, dy: number, a: number) => {
      c.globalAlpha = a * inOut(t, this.ctx.start, this.ctx.end, 0.3, 0.25);
      c.font = font(fam, size); c.fillStyle = rgba(v === 100 ? 'blood' : 'sepia', 0.96);
      c.fillText(String(v), STAT.x, base + dy);
      const w = c.measureText(String(v)).width;
      c.font = font(fam, 64); c.fillText('%', STAT.x + w + 8, base + dy);
    };
    if (u < 1 && cur !== prev) { draw(prev, -130 * u, 1 - u); draw(cur, 130 * (1 - u), 1); } else draw(cur, 0, 1);
    c.restore();
    // 其他幾項：第一拍後一拍翻出一項，翻的時候先閃過兩個普通的預報值，停在冷面笑話那一個
    STATS.forEach(([, vals], j) => {
      const tj2 = this.b0 + (j + 1) * au.beatPeriod(this.b0) * 0.5;
      if (t < tj2) return;
      const ph = (t - tj2) / 0.09;
      const idx = Math.min(vals.length - 1, Math.floor(ph));
      const settle = prog(t, tj2 + 0.09 * (vals.length - 1), tj2 + 0.09 * (vals.length - 1) + 0.25, ease.outBack);
      c.font = font(F.hei(900), 30);
      c.fillStyle = rgba(idx === vals.length - 1 ? 'blood' : 'sepia', idx === vals.length - 1 ? 0.95 : 0.5);
      c.fillText(vals[idx]!, STAT.x + 130, STAT.y + 240 + j * 46 + (1 - settle) * 6 * (idx === vals.length - 1 ? 1 : 0));
    });
  }

  // ------------------------------------------------------------ 今日預報（歌詞）
  private drawLyricBand(c: CanvasRenderingContext2D, t: number, lyrics: Lyrics) {
    const x = X0 + LYR.labelW + 30, maxW = XR - x;
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const st = { family: F.archivo(100, 800), size: 62, minSize: 48, maxWidth: maxW, active: rgba('blood'), sung: rgba('sepia', 0.95), unsung: rgba('sepia', 0.27), lineHeight: 1.1 };
      const lay = layoutLyric(c, ly.line, st);
      c.save(); c.translate(x, LYR.y + (LYR.h - lay.height) / 2 + lay.size * 0.82);
      drawLyric(c, ly.line, t, st, lay, ly.k);
      c.restore();
    } else {
      // 間奏或純音樂：預報寫「晴時多雲偶陣愛」
      c.font = font(F.hei(700), 52); c.fillStyle = rgba('sepia', lyrics.has ? 0.4 : 0.85);
      c.fillText('晴時多雲　偶陣愛', x, LYR.y + LYR.h / 2 + 18);
    }
  }

  // ------------------------------------------------------------ 今日天氣小語（留言）
  private drawCard(c: CanvasRenderingContext2D, t: number) {
    const u = prog(t, this.tCard, this.tCard + 0.4, ease.outExpo);
    if (u <= 0) return;
    const x = CARD.x + 170, cx0 = x;
    c.save();
    c.globalAlpha *= u;
    if (this.msg && this.fit) {
      const fit = this.fit;
      const total = fit.lines.reduce((a, l) => a + Array.from(l).length, 0);
      const chars = total * prog(t, this.tCard + 0.1, this.tCard + 0.1 + clamp(0.035 * total + 0.3, 0.5, 2));
      const top = CARD.y + (CARD.h - fit.height - 58) / 2 + fit.size * 0.9;
      drawMessage(c, fit, F.hand(400), cx0, top, { chars, color: rgba('sepia', 0.95) });
      const ka = prog(t, this.tCard + 0.6, this.tCard + 1.0);
      c.globalAlpha *= ka;
      c.font = font(F.hand(400), 44); c.fillStyle = rgba('sepia', 0.7); c.textAlign = 'right';
      c.fillText(signature(this.msg.name) + (this.msg.couple ? '（新人）' : ''), CARD.x + CARD.w - 44, top + fit.height - fit.size * 0.9 + 60);
      c.textAlign = 'left';
      c.font = font(F.mono(500), 15); c.fillStyle = rgba('sepia', 0.5); c.letterSpacing = '2px';
      c.fillText(`NO.${String(this.msg.n).padStart(3, '0')}`, CARD.x + 44, CARD.y + CARD.h - 34);
      c.letterSpacing = '0px';
    } else {
      c.font = font(F.hand(400), 60); c.fillStyle = rgba('sepia', 0.9);
      c.fillText('今天的天氣小語，還沒有收到。', cx0, CARD.y + 118);
      c.font = font(F.hei(500), 28); c.fillStyle = rgba('sepia', 0.65);
      c.fillText('掃描右下角 QR code，寫一句給新人。', cx0, CARD.y + 182);
    }
    c.restore();
  }
}
