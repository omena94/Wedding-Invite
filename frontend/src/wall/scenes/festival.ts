// 廟會燈籠（暗）：廟口的夜，一串串燈籠橫過畫面，遠處是廟的燕尾脊剪影，下面是夜市攤位的招牌。
//  - 主打留言寫在燈籠上：一個燈籠一個字（英文一個字一個燈籠，燈籠跟著字變寬），像廟會「國泰民安」那樣一串一串掛著，
//    斷行照子句（逗號、句號變成燈籠之間的空隙）。燈籠一開始是暗的，從第一拍起照拍子一個一個點亮
//    （亮起來那一下閃一下，之後像燭火微微跳）；署名寫在最後一串下面。燈籠被風吹得微微擺，大鼓一打整串晃一下。
//  - 歌詞在下面攤位的燈箱招牌上（逐字跟唱，比燈籠上的字小一級）。
//  - 沒有留言：燈籠上是正在唱的歌詞（唱到哪個字、那個燈籠就亮），招牌放邀請；純音樂又沒有留言：燈籠寫「新婚快樂　百年好合」。
// 手法：Canvas2D 的「燈籠精靈圖」——每個燈籠（含字、暗的與亮的兩張）在 init() 畫進一張圖集，每格只 drawImage（轉一點角度）；
// 光暈畫在半解析度的加亮層。夜空、廟的剪影、遠處失焦的燈（散景）是全螢幕 shader。
// 鏡頭：切進來時稍微往下看（攤位），第一個小節線前慢慢仰起來看燈籠，之後很慢地推近；前景一顆失焦的大燈籠，遠近有視差。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, noise1, pulse } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { Lyrics, type Line, type Word } from '../engine/lyrics';
import { drawHeart } from './_motifs';
import { grid, stagger, layoutRows, drawRows, paperInk } from './_t4';
import { INVITE } from './_t14';
import { shownLyric, sigOf, type Rect } from './_t24';

export const spec: PlateSpecDecl = { group: 'type', family: 'local', paper: false, energy: [0.3, 1], bars: [4, 8], weight: 1 };

const FAM = F.hand(700), FAM_SIG = F.hand(400);
const FAM_LYR = F.archivo(100, 800);
/** 燈籠區（留言或歌詞）與攤位招牌（歌詞）的範圍。 */
const AREA = { x: 170, y: 104, w: 1580, h: 686 };
const SIGN = { x: 150, y: 812, w: 1010, h: 96 };
const FALLBACK = '新婚快樂，百年好合';
/** 燈籠的比例（相對字級 s）：寬、高、間距、一串的高度。 */
const LW = 1.22, LH = 1.42, PITCH = 1.34, ROWH = 2.2;
const PUNCT = /^[，。、,.．；;：:]+$/;

const SKY = () => new FSPass(/* glsl */ `
  uniform float t; uniform vec2 cam; uniform float zoom;
  // 遠處失焦的燈（散景）：一顆顆軟軟的圓，暖色
  float bokeh(vec2 p, float cell, float seed, float r) {
    vec2 g = floor(p / cell), f = p - g * cell;
    float acc = 0.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 id = g + vec2(float(i), float(j));
      float h = hash12(id + seed);
      if (h < 0.55) continue;
      vec2 c = (vec2(float(i), float(j)) + 0.2 + 0.6 * hash22(id + seed * 3.1)) * cell;
      float d = length(f - c);
      acc += (0.5 + 0.5 * hash12(id + 7.0)) * (1.0 - smoothstep(r * 0.82, r, d)) * (0.75 + 0.25 * smoothstep(r * 0.4, r * 0.95, d));
    }
    return acc;
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y); // y 向下
    // 視差：天空與廟最遠（移得最少）
    vec2 q = (p - vec2(960.0, 540.0)) / (1.0 + (zoom - 1.0) * 0.2) + vec2(960.0, 540.0) - vec2(0.0, cam.y * 0.2);
    float y = q.y / 1080.0;
    vec3 col = mix(C_INK * 0.9, C_INK2 * 1.4 + C_BLOOD * 0.06, smoothstep(0.1, 1.0, y));
    // 廟口的暖光從下面上來
    col += mix(C_BLOOD, C_SIGNAL, 0.35) * 0.09 * smoothstep(0.45, 1.05, y);
    // 廟：燕尾脊的剪影（右邊遠處）。上層屋頂的屋脊兩端往上翹、分叉（燕尾），中間一個葫蘆形的脊飾；
    // 下層屋簷比較寬，簷角微微翹起；再下面是廟身（被攤位擋住）
    float cx = 1500.0, dx = abs(q.x - cx);
    float hw1 = 300.0, u1 = dx / hw1;
    float top1 = 520.0 + 22.0 * u1 * u1 - 78.0 * pow(sat((u1 - 0.8) / 0.2), 1.7) - 26.0 * exp(-pow((q.x - cx) / 13.0, 2.0)) - 14.0 * exp(-pow((q.x - cx) / 30.0, 2.0));
    float roof1 = step(u1, 1.0) * step(top1, q.y) * step(q.y, 520.0 + 110.0);
    // 燕尾分叉：尾端上緣切一道細縫
    roof1 *= 1.0 - step(0.9, u1) * step(abs(q.y - (top1 + 14.0)), 3.0);
    float hw2 = 430.0, u2 = dx / hw2;
    float top2 = 612.0 + 16.0 * u2 * u2 - 34.0 * pow(sat((u2 - 0.86) / 0.14), 2.0);
    float roof2 = step(u2, 1.0) * step(top2, q.y) * step(q.y, 700.0);
    float body = step(dx, 360.0) * step(620.0, q.y);
    float temple = max(max(roof1, roof2), body);
    col = mix(col, C_INK * 0.72, temple * 0.93);
    // 屋脊上一條很淡的暖色輪廓光（廟口的燈從下面照上去）
    float rim = (1.0 - smoothstep(0.0, 5.0, q.y - top1)) * roof1 + (1.0 - smoothstep(0.0, 4.0, q.y - top2)) * roof2 * 0.7;
    col += mix(C_BLOOD, C_SIGNAL, 0.5) * 0.1 * rim;
    // 散景：兩層，遠的小、近的大（視差比較多）
    vec2 b1 = (p - vec2(960.0, 540.0)) / (1.0 + (zoom - 1.0) * 0.5) + vec2(960.0, 540.0) - vec2(t * 4.0, cam.y * 0.5);
    vec2 b2 = (p - vec2(960.0, 540.0)) / (1.0 + (zoom - 1.0) * 0.8) + vec2(960.0, 540.0) - vec2(t * 9.0, cam.y * 0.8);
    float bk = bokeh(b1 + vec2(0.0, 0.0), 120.0, 3.0, 16.0) * smoothstep(250.0, 700.0, p.y) * (1.0 - temple * 0.8);
    float bk2 = bokeh(b2, 240.0, 11.0, 34.0) * smoothstep(300.0, 800.0, p.y);
    col += mix(C_BLOOD, C_SIGNAL, 0.6) * (0.06 * bk + 0.035 * bk2);
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 }, cam: { value: new THREE.Vector2() }, zoom: { value: 1 } });

/** 一個燈籠：字（或 null）、在圖集裡的兩張（暗、亮）、掛的位置、大小、亮起來的時間。 */
interface Lantern {
  text: string;
  small: boolean;
  /** 掛點（燈籠頂的繩子接在電線上的地方）。 */
  x: number; y: number;
  w: number; h: number;
  /** 圖集裡的位置（暗的一張，亮的在右邊 sw 處）。 */
  sx: number; sy: number; sw: number; sh: number;
  /** 亮起來的時間（歌詞：那個字開始唱）；word：歌詞的字（跟唱用）。 */
  t0: number;
  word?: Word;
  seed: number;
}

interface LSet {
  lanterns: Lantern[];
  wires: { y: number; x0: number; x1: number }[];
  size: number;
  sig?: { text: string; x: number; y: number; size: number };
}

export default class Festival extends Scene {
  sky = shared('festival.sky', SKY);
  main = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 71 + (this.msg?.id ?? 0) * 29) >>> 0;
  atlas: HTMLCanvasElement = document.createElement('canvas');
  fg: HTMLCanvasElement = document.createElement('canvas');
  /** 有留言（或純音樂的固定字）：一組燈籠；沒有留言：每句歌詞一組。 */
  msgSet: LSet | null = null;
  lineSets = new Map<Line, LSet>();
  avoid: Rect[] = [];
  camK0 = 0;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const gr = grid(au, s, e);
    this.camK0 = gr.bar0;
    const lines = m ? [] : lyrics.linesIn(s - 4, e).filter((l) => l.end > s - 1.5);
    await loadText(`${m?.text ?? ''}${m ? sigOf(m) : ''}${FALLBACK}${INVITE}${lines.map((l) => l.text).join('')}${song.title}古早味彈珠台`);
    // 圖集：先排版、算需要多大，再一次畫好
    const jobs: { set: LSet; items: { text: string; small: boolean; w: number; h: number }[] }[] = [];
    const c = this.main.ctx;
    if (m || !lines.length) {
      const text = m ? m.text : FALLBACK;
      const set = this.layoutText(c, text, m ? 5 : 2, 150, undefined, !!m);
      if (m) {
        const last = set.lanterns[set.lanterns.length - 1]!;
        const sz = clamp(Math.round(set.size * 0.5), 40, 56);
        c.font = font(FAM_SIG, sz);
        const sw = c.measureText(sigOf(m)).width;
        const rowEnd = Math.max(...set.lanterns.filter((l) => l.y === last.y).map((l) => l.x + l.w / 2));
        set.sig = { text: sigOf(m), size: sz, x: Math.min(AREA.x + AREA.w - sw, rowEnd - sw), y: last.y + set.size * LH * 1.62 + sz * 1.1 };
      }
      // 亮起來的時間：從第一拍起照拍子一個一個
      const n = set.lanterns.length;
      const ts = stagger(au, gr.b0, n, Math.min(gr.bar * 1.75, Math.max(gr.beat * 2, (e - gr.b0) * 0.5)));
      set.lanterns.forEach((l, i) => { l.t0 = ts[i]!; });
      this.msgSet = set;
      jobs.push({ set, items: set.lanterns });
    } else {
      for (const l of lines) {
        const set = this.layoutText(c, l.text, 2, 150, l);
        this.lineSets.set(l, set);
        jobs.push({ set, items: set.lanterns });
      }
    }
    this.buildAtlas(jobs.flatMap((j) => j.set.lanterns));
    this.buildForeground();
    this.avoid = [[AREA.x, AREA.y, AREA.w, AREA.h + 60], [SIGN.x, SIGN.y, SIGN.w, SIGN.h]];
  }

  /**
   * 把一段字排成一串串燈籠：用 fitText 找字級與斷行（子句斷行），每個字（英文一個字）一個燈籠，
   * 逗號句號變成燈籠之間的空隙，驚嘆號、問號是小燈籠。歌詞的話記下每個燈籠是哪個 Word（跟唱用）。
   */
  private layoutText(c: CanvasRenderingContext2D, text: string, maxLines: number, max: number, line?: Line, sig = false): LSet {
    // 整塊要多高：每串一個燈籠（含流蘇）＋串與串的間距＋署名；fitText 只算字的行高，超出就把框縮小再排一次
    const need = (sz: number, n: number) => sz * (LH * 1.62 + (n - 1) * ROWH) + (sig ? Math.max(40, sz * 0.5) * 1.5 : 0);
    let hFit = AREA.h, fit: FitResult = fitText(c, text, FAM, AREA.w / PITCH, hFit, { min: 50, max, lineHeight: ROWH, maxLines });
    for (let k = 0; k < 4; k++) {
      const over = need(fit.size, fit.lines.length) - AREA.h;
      if (over <= 0) break;
      hFit -= over + 4;
      fit = fitText(c, text, FAM, AREA.w / PITCH, hFit, { min: 50, max, lineHeight: ROWH, maxLines });
    }
    const s = fit.size;
    const lanterns: Lantern[] = [];
    const wires: LSet['wires'] = [];
    const top = AREA.y + Math.max(0, (AREA.h - need(s, fit.lines.length)) / 2);
    let cursor = 0;
    const rowEnds: number[] = [];
    fit.lines.forEach((ln, ri) => {
      const y = top + ri * fit.lineHeight;
      // 這一行的單位：中文一字、英文一個字（連著的拉丁字母、數字）、標點
      const units = ln.match(/[A-Za-z0-9'’&@#+\-]+[!?！？]*|♥|[^\sA-Za-z0-9]/g) ?? [];
      let x = AREA.x;
      for (const u of units) {
        const at = text.indexOf(u, cursor);
        if (at >= 0) cursor = at + u.length;
        if (PUNCT.test(u)) { x += s * 0.5; continue; }
        const small = /^[!?！？~～…]+$/.test(u);
        c.font = font(FAM, s);
        const tw = c.measureText(u).width;
        // 一個中文字的燈籠寬 LW·s；英文字的燈籠跟著字變寬
        const w = small ? s * 0.78 : Math.max(s * LW, tw + s * 0.42);
        const h = small ? s * 0.95 : s * LH * (w > s * LW * 1.4 ? 0.92 : 1);
        const word = line?.words.find((wd) => at >= wd.o && at < wd.o + wd.w.length);
        lanterns.push({ text: u, small, x: x + w / 2, y, w, h, sx: 0, sy: 0, sw: 0, sh: 0, t0: word ? word.start : 0, word, seed: lanterns.length });
        x += w + s * (PITCH - LW);
      }
      rowEnds.push(x - s * (PITCH - LW));
    });
    // 整塊水平置中（每一串還是靠左對齊，讀起來才順）；太寬就整塊縮一點
    const blockW = Math.max(...rowEnds) - AREA.x;
    const k = Math.min(1, AREA.w / Math.max(1, blockW));
    const dx = AREA.x + (AREA.w - blockW * k) / 2;
    for (const l of lanterns) { l.x = dx + (l.x - AREA.x) * k; l.w *= k; l.h *= k; }
    fit.lines.forEach((_, ri) => {
      const y = top + ri * fit.lineHeight;
      wires.push({ y, x0: -200, x1: W + 200 });
    });
    return { lanterns, wires, size: s };
  }

  /** 燈籠精靈圖：每個燈籠畫暗的、亮的兩張進同一張圖集（書架式排列）。 */
  private buildAtlas(ls: Lantern[]) {
    const PAD = 8;
    let x = 0, y = 0, rowH = 0, maxW = 0;
    const MAXW = 2400;
    for (const l of ls) {
      const sw = Math.ceil(l.w * 1.08 + PAD * 2), sh = Math.ceil(l.h * 1.75 + PAD * 2);
      if (x + sw * 2 > MAXW) { x = 0; y += rowH; rowH = 0; }
      l.sx = x; l.sy = y; l.sw = sw; l.sh = sh;
      x += sw * 2; rowH = Math.max(rowH, sh); maxW = Math.max(maxW, x);
    }
    const cv = this.atlas;
    cv.width = Math.max(1, maxW); cv.height = Math.max(1, y + rowH);
    const c = cv.getContext('2d')!;
    for (const l of ls) {
      for (const lit of [false, true]) {
        c.save();
        c.translate(l.sx + (lit ? l.sw : 0) + l.sw / 2, l.sy + PAD);
        this.drawLantern(c, l, lit);
        c.restore();
      }
    }
  }

  /** 畫一個燈籠（原點 = 頂端掛點）：頂蓋、竹骨、紙面（亮的時候裡面有火）、字、底蓋、流蘇。 */
  private drawLantern(c: CanvasRenderingContext2D, l: Lantern, lit: boolean) {
    const w = l.w, h = l.h, cy = h * 0.12 + h / 2, rx = w / 2, ry = h / 2;
    // 流蘇
    c.strokeStyle = lit ? rgba('blood', 0.95) : mixRgba('blood', 'ink', 0.55);
    c.lineWidth = Math.max(1.2, w * 0.018);
    const ty = cy + ry + h * 0.08;
    for (let k = -2; k <= 2; k++) { c.beginPath(); c.moveTo(k * w * 0.03, ty); c.lineTo(k * w * 0.05, ty + h * 0.42); c.stroke(); }
    // 紙面：亮的時候中間最亮（火），邊緣暗紅；暗的時候整顆暗暗的
    const g = c.createRadialGradient(0, cy + ry * 0.1, rx * 0.1, 0, cy, Math.max(rx, ry) * 1.02);
    if (lit) {
      g.addColorStop(0, rgba('ember')); g.addColorStop(0.42, rgba('signal')); g.addColorStop(0.82, mixRgba('signal', 'blood', 0.55)); g.addColorStop(1, rgba('blood'));
    } else {
      g.addColorStop(0, mixRgba('blood', 'ink', 0.35)); g.addColorStop(1, mixRgba('blood', 'ink', 0.72));
    }
    c.fillStyle = g;
    c.beginPath(); c.ellipse(0, cy, rx, ry, 0, 0, Math.PI * 2); c.fill();
    // 竹骨：幾條經線（橢圓，越外面越扁）
    c.strokeStyle = lit ? mixRgba('blood', 'signal', 0.2, 0.55) : mixRgba('blood', 'ink', 0.8, 0.8);
    c.lineWidth = Math.max(1, w * 0.012);
    for (const k of [0.35, 0.7]) { c.beginPath(); c.ellipse(0, cy, rx * k, ry, 0, 0, Math.PI * 2); c.stroke(); }
    // 字：黑墨（亮的時候很清楚；暗的時候淡淡看得到）；愛心用點綴色
    // 燈籠上的字：一個中文字約 0.93 倍字級（字級最小 50，燈籠上的字才有 ≥ 44 px）
    const s = l.small ? h * 0.72 : Math.min(h * 0.66, (w - h * 0.2) / Math.max(1, Array.from(l.text).length) * 1.05, w * 0.76);
    if (l.text === '♥') drawHeart(c, 0, cy, s * 0.95, lit ? rgba('rose') : mixRgba('rose', 'ink', 0.6));
    else {
      c.font = font(FAM, s);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      const tw = c.measureText(l.text).width;
      c.save(); c.translate(0, cy + s * 0.04);
      if (tw > w * 0.84) c.scale((w * 0.84) / tw, 1);
      c.fillStyle = lit ? rgba('ink', 0.94) : rgba('ink', 0.55);
      c.fillText(l.text, 0, 0);
      c.restore();
    }
    // 頂蓋、底蓋：黑漆，一圈金邊
    const capW = w * 0.52, capH = h * 0.1;
    for (const [yy, hh] of [[cy - ry - capH * 0.55, capH], [cy + ry - capH * 0.45, capH]] as const) {
      c.fillStyle = rgba('ink');
      c.beginPath(); c.roundRect(-capW / 2, yy, capW, hh, capH * 0.3); c.fill();
      c.fillStyle = lit ? rgba('signal', 0.8) : mixRgba('signal', 'ink', 0.7);
      c.fillRect(-capW / 2, yy + hh * 0.42, capW, Math.max(1, hh * 0.16));
    }
    // 掛繩
    c.strokeStyle = rgba('graphite'); c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(0, cy - ry - capH * 0.5); c.stroke();
  }

  /** 前景：一顆很近、失焦的大燈籠（init 模糊一次，每格只貼）。 */
  private buildForeground() {
    const cv = this.fg;
    cv.width = 520; cv.height = 700;
    const c = cv.getContext('2d')!;
    c.filter = 'blur(26px)';
    c.translate(260, 60);
    this.drawLantern(c, { text: '', small: false, x: 0, y: 0, w: 340, h: 400, sx: 0, sy: 0, sw: 0, sh: 0, t0: 0, seed: 0 }, true);
    c.filter = 'none';
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    // 鏡頭：切進來時往下看一點（攤位），第一個小節線前仰起來看燈籠；之後慢慢推近
    const tilt = 1 - ease.inOutCubic(prog(t, s, Math.max(s + 0.6, this.camK0)));
    const pe = ease.inOutQuad(clamp((t - s) / Math.max(1, e - s)));
    const zoom = 1 + 0.045 * pe;
    const camY = -70 * tilt;
    const exit = prog(t, e - 0.3, e, ease.inCubic);
    const L = this.main, G = this.glow;
    L.clear(); G.clear();
    const c = L.ctx, gc = G.ctx;
    /** 深度 d 的一層：推近與仰角的視差（d = 1 是燈籠那一層）。 */
    const layer = (ctx: CanvasRenderingContext2D, d: number) => {
      const z = 1 + (zoom - 1) * d;
      ctx.setTransform(z, 0, 0, z, 960 * (1 - z), 540 * (1 - z) + camY * d);
    };
    const kick = f.a.kick;
    // ---- 後面兩串裝飾燈籠（小、沒有字、比較暗）
    for (const [d, yy, n, sc] of [[0.55, 18, 17, 0.36]] as const) {
      layer(c, d); layer(gc, d);
      c.strokeStyle = rgba('graphite', 0.35); c.lineWidth = 1.2;
      c.beginPath();
      for (let x = -100; x <= 2020; x += 40) { const sag = 60 * (1 - Math.pow((x - 960) / 1060, 2)); x === -100 ? c.moveTo(x, yy + sag) : c.lineTo(x, yy + sag); }
      c.stroke();
      const pitch = 2120 / n;
      for (let i = 0; i < n; i++) {
        const x = -60 + pitch * (i + 0.5), sag = 60 * (1 - Math.pow((x - 960) / 1060, 2));
        const w = 100 * sc, h = 120 * sc, cy = yy + sag + h * 0.62;
        const flick = 0.75 + 0.25 * noise1(t * 3 + i * 1.7, 5 + d * 10);
        const g = c.createRadialGradient(x, cy, 0, x, cy, w * 0.55);
        g.addColorStop(0, mixRgba('signal', 'ember', 0.3, 0.35 * flick)); g.addColorStop(0.7, rgba('blood', 0.3 * flick)); g.addColorStop(1, rgba('blood', 0));
        c.fillStyle = g; c.beginPath(); c.ellipse(x, cy, w / 2, h / 2, 0, 0, Math.PI * 2); c.fill();
        gc.fillStyle = rgba('signal', 0.06 * flick); gc.beginPath(); gc.arc(x, cy, w * 0.8, 0, Math.PI * 2); gc.fill();
      }
    }
    // ---- 主角的燈籠串
    layer(c, 1); layer(gc, 1);
    let set: LSet | null = this.msgSet, alpha = 1;
    let line: Line | null = null;
    if (!set) {
      const sl = shownLyric(lyrics, t, s, e);
      line = sl?.line ?? null;
      set = line ? this.lineSets.get(line) ?? null : null;
      alpha = sl ? (sl.live ? sl.k : 1) : 0;
    }
    // 退場：最後一下燈籠一起熄掉
    if (set) this.drawSet(c, gc, set, t, kick, alpha, line, 1 - exit);
    // ---- 攤位：遮雨棚的剪影、燈箱招牌（歌詞）
    layer(c, 1.05);
    this.drawStalls(c, gc, t);
    // ---- 前景失焦的大燈籠（左上，很近）
    layer(c, 1.5);
    c.globalAlpha = 0.55;
    const sw = 0.03 * Math.sin(t * 1.1);
    c.save(); c.translate(-60, -130); c.rotate(sw); c.drawImage(this.fg, -260, -60); c.restore();
    c.globalAlpha = 1;
    c.setTransform(1, 0, 0, 1, 0, 0); gc.setTransform(1, 0, 0, 1, 0, 0);

    this.sky.u.t!.value = t;
    (this.sky.u.cam!.value as THREE.Vector2).set(0, camY);
    this.sky.u.zoom!.value = zoom;
    this.sky.render(renderer, out);
    comp.draw(renderer, L.upload(), out);
    comp.draw(renderer, G.upload(), out, { mode: 'add', tint: [1.6, 1.6, 1.6] });
    return { bloom: 0.6, vignette: 0.62, halation: 0.3, zoom: 1 + 0.004 * kick, popupAvoid: this.avoid };
  }

  /** 畫一組燈籠：電線（懸鏈線）、燈籠（暗的或亮的精靈圖，照亮度疊）、光暈、署名。 */
  private drawSet(c: CanvasRenderingContext2D, gc: CanvasRenderingContext2D, set: LSet, t: number, kick: number, alpha: number, line: Line | null, power = 1) {
    const sag = (x: number, w: { x0: number; x1: number }) => 34 * (1 - Math.pow((2 * (x - w.x0)) / (w.x1 - w.x0) - 1, 2));
    c.save(); gc.save();
    c.globalAlpha = alpha; gc.globalAlpha = alpha;
    c.strokeStyle = rgba('graphite', 0.7); c.lineWidth = 1.6;
    for (const w of set.wires) {
      c.beginPath();
      for (let x = w.x0; x <= w.x1; x += 30) (x === w.x0 ? c.moveTo(x, w.y + sag(x, w)) : c.lineTo(x, w.y + sag(x, w)));
      c.stroke();
    }
    for (const l of set.lanterns) {
      const wire = set.wires.find((w) => Math.abs(w.y - l.y) < 1)!;
      const hy = l.y + sag(l.x, wire);
      // 亮度：還沒到是暗的；點亮那一下閃一下，之後像燭火微微跳
      let lit = 0;
      if (line && l.word) {
        const p = Lyrics.wordProgress(l.word, t);
        lit = p > 0 ? 1 : 0;
      } else lit = t >= l.t0 ? 1 : 0;
      const since = t - (l.word ? l.word.start : l.t0);
      const flash = lit ? 0.5 * pulse(t, l.word ? l.word.start : l.t0, 0.09) : 0;
      const flick = lit ? 0.9 + 0.1 * noise1(t * 5 + l.seed * 3.3, 11) : 0;
      const on = (lit ? Math.min(1, clamp(since / 0.08)) : 0) * power;
      // 擺動：風（慢）＋大鼓一打整串晃一下
      const ang = 0.035 * Math.sin(t * 1.2 + l.seed * 0.7) + 0.05 * kick * Math.sin(l.seed * 2.1 + 1);
      c.save(); c.translate(l.x, hy); c.rotate(ang);
      c.drawImage(this.atlas, l.sx, l.sy, l.sw, l.sh, -l.sw / 2, -8, l.sw, l.sh);
      if (on > 0) {
        c.globalAlpha = alpha * on * Math.min(1, flick + flash);
        c.drawImage(this.atlas, l.sx + l.sw, l.sy, l.sw, l.sh, -l.sw / 2, -8, l.sw, l.sh);
        c.globalAlpha = alpha;
      }
      c.restore();
      if (on > 0) {
        const cy = hy + l.h * 0.62;
        // 光暈照燈籠的高算（英文字的燈籠很寬，照寬算會變成一大片霧）
        const r = l.h * (0.95 + 0.35 * flash);
        const g = gc.createRadialGradient(l.x, cy, 0, l.x, cy, r);
        g.addColorStop(0, rgba('signal', 0.2 * on * (flick + flash))); g.addColorStop(0.6, rgba('signal', 0.05 * on)); g.addColorStop(1, rgba('signal', 0));
        gc.fillStyle = g; gc.beginPath(); gc.arc(l.x, cy, r, 0, Math.PI * 2); gc.fill();
      }
    }
    if (set.sig) {
      const sg = set.sig, last = set.lanterns[set.lanterns.length - 1]!;
      c.globalAlpha = alpha * clamp((t - last.t0 - 0.2) / 0.4);
      c.font = font(FAM_SIG, sg.size); c.fillStyle = rgba('bone', 0.9);
      c.textBaseline = 'alphabetic';
      c.fillText(sg.text, sg.x, sg.y);
      if (this.msg?.couple) {
        c.font = font(F.mono(500), 18); c.letterSpacing = '4px'; c.fillStyle = rgba('signal', 0.8);
        c.fillText('FROM THE COUPLE · 新人', AREA.x, AREA.y - 40);
        c.letterSpacing = '0px';
      }
    }
    c.restore(); gc.restore();
  }

  /** 下面的夜市攤位：一排遮雨棚的剪影（下面透出暖光），燈箱招牌：有留言放歌詞，沒有留言放邀請。 */
  private drawStalls(c: CanvasRenderingContext2D, gc: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    // 攤位下面的暖光
    const g = c.createLinearGradient(0, 900, 0, 1080);
    g.addColorStop(0, rgba('signal', 0)); g.addColorStop(1, rgba('blood', 0.35));
    c.fillStyle = g; c.fillRect(-100, 900, 2120, 280);
    // 遮雨棚：一排，邊緣是波浪
    for (let k = 0; k < 6; k++) {
      const x0 = -80 + k * 360, w = 340, y0 = 930 + 18 * hash(k, 3);
      c.fillStyle = rgba('ink2', 0.96);
      c.beginPath(); c.moveTo(x0, y0 - 40); c.lineTo(x0 + w, y0 - 40); c.lineTo(x0 + w, y0);
      for (let i = 8; i >= 0; i--) c.quadraticCurveTo(x0 + (i + 0.5) * w / 8, y0 + 16, x0 + i * w / 8, y0);
      c.closePath(); c.fill();
      c.fillStyle = rgba('ink', 0.98); c.fillRect(x0, y0 + 8, w, 200);
    }
    // 燈箱招牌（主）：暖白的燈箱、深色的字
    const B = SIGN;
    // 燈箱：外框是紅色烤漆的鐵皮，上下一條細細的金邊；燈箱面中間亮、兩端暗（裡面的燈管）
    c.fillStyle = mixRgba('blood', 'ink', 0.35); c.beginPath(); c.roundRect(B.x - 12, B.y - 12, B.w + 24, B.h + 24, 6); c.fill();
    c.fillStyle = rgba('signal', 0.5); c.fillRect(B.x - 12, B.y - 12, B.w + 24, 2); c.fillRect(B.x - 12, B.y + B.h + 10, B.w + 24, 2);
    const lg = c.createLinearGradient(B.x, 0, B.x + B.w, 0);
    lg.addColorStop(0, mixRgba('paper', 'signal', 0.3, 0.78)); lg.addColorStop(0.5, rgba('paper', 0.9)); lg.addColorStop(1, mixRgba('paper', 'signal', 0.3, 0.78));
    c.fillStyle = lg; c.fillRect(B.x, B.y, B.w, B.h);
    // 招牌的支架
    c.fillStyle = rgba('ink', 0.95);
    c.fillRect(B.x + 60, B.y + B.h + 10, 10, 60); c.fillRect(B.x + B.w - 70, B.y + B.h + 10, 10, 60);
    c.textBaseline = 'alphabetic';
    if (this.msg) {
      const ly = shownLyric(lyrics, t, s, e);
      if (ly) {
        const st = { family: FAM_LYR, size: Math.min(56, Math.round((this.msgSet?.size ?? 80) * 0.72)), minSize: 48, maxW: B.w - 60, maxRows: 1, align: 'left' as const };
        const lay = layoutRows(c, ly.line, { ...st, size: Math.max(48, st.size) });
        c.save(); c.translate(B.x + 30, B.y + B.h / 2 + lay.size * 0.36);
        drawRows(c, lay, FAM_LYR, t, paperInk(), ly.k);
        c.restore();
      } else {
        c.font = font(F.mono(500), 22); c.letterSpacing = '5px'; c.fillStyle = rgba('sepia', 0.7);
        c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`.toUpperCase(), B.x + 30, B.y + B.h / 2 + 8);
        c.letterSpacing = '0px';
      }
    } else {
      c.font = font(F.hei(700), 32); c.fillStyle = rgba('sepia', 0.9);
      c.fillText(INVITE, B.x + 30, B.y + B.h / 2 + 11);
    }
    // 右邊一塊小招牌（配角：小字、暗）
    c.fillStyle = mixRgba('blood', 'ink', 0.3, 0.9); c.fillRect(1210, 842, 118, 64);
    c.font = font(F.hei(700), 22); c.fillStyle = rgba('paper', 0.6);
    c.fillText('古早味', 1236, 882);
  }
}
