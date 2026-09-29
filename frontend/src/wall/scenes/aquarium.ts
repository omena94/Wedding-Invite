// 水族箱（暗）：夜裡水族館的展廳，整面大水族箱在背景發光，左前方立著一塊解說牌。
//  - 畫面的焦點＝主打留言：印在解說牌上（思源宋體）。解說牌是一個燈箱，第一個拍點「啪、啪」閃兩下亮起來（日光燈管的樣子），
//    字就在亮起來的燈箱上；署名在最後一行下面。上下各一行很小的字：「展示物種：祝福」「＊請勿拍打玻璃，魚會害羞。」
//  - 歌詞＝一大群銀色的小魚游過來排成字：一句歌詞在要唱之前約一秒開始聚集、排好（還沒唱的字是暗暗的魚），
//    唱到的那一刻那個字的魚亮成訊號色（像會發光的魚），唱完變成銀白；唱完一句魚群散開、游去排下一句。
//    每一拍有一道「轉身」從左到右掃過排好的魚（一起擺一下尾巴）。沒有歌詞時魚群在水裡繞圈，每個小節線整群突然轉向。
//  - 氣泡：每一拍從右下角的打氣石冒出一串氣泡。水面在上面搖，光從水面斜斜照下來，沙底有水波的光紋，水草在搖。
//  - 沒有主打留言：解說牌寫「展示物種：祝福」與邀請（小），魚群排的歌詞是主角。純音樂又沒留言：魚群排出新人的名字。
// 手法：水、光、沙、水草、缸框、展廳、解說牌（燈箱）都在一個 shader；魚與氣泡是 LineBatch（每條魚兩段：身體與尾巴）；
// 魚排字的點用 textPoints 在 init() 取一次；解說牌上的字是一張 init 畫好的 Canvas2D（燈箱亮度用疊上去的透明度）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText, layout } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, prog, hash, pulse, TAU } from '../engine/util';
import { Lyrics, type Line } from '../engine/lyrics';
import { layoutLyric, drawMessage, beatAfter, COUPLE_ZH, type LyricStyle } from './_motifs';
import { fitText, type FitResult } from '../engine/text';
import { T16_TEXT, sigOf, winBeats, winBars, no3 } from './_t16';

export const spec: PlateSpecDecl = { group: 'type', family: 'nature', paper: false, energy: [0.15, 0.9], bars: [4, 8] };

/** 解說牌（燈箱）與上面的字的範圍。 */
const PANEL = { x0: 130, x1: 690, y0: 168, y1: 902 };
const PTXT = { x: 184, y: 262, w: 452, h: 560 };
/**
 * 有留言時（2026-09-29 主導者：留言要明顯大於魚排的字）：解說牌放大成左半邊的大燈箱、留言 ≥ 72 px；
 * 魚排的歌詞縮到約 64 px、排在右上方遠一點的水裡（魚小、顏色暗一點，像比較遠），焦點留給解說牌。
 */
const PANEL_M = { x0: 110, x1: 1010, y0: 130, y1: 940 };
const PTXT_M = { x: 172, y: 236, w: 776, h: 624 };
const FISH_M = { x: 1070, y: 180, w: 730, h: 380 };
/** 魚排字的範圍（水族箱右邊的開闊水域）。 */
const FISH = { x: 770, y: 150, w: 1030, h: 470 };
/** 缸：上緣的框、水面、沙底、底櫃、地板。 */
const TANK = { top: 40, surf: 84, sand: 720, base: 830, floor: 930 };
const FAM_MSG = F.ming(700);
const FAM_FISH = F.hei(700);
/** 魚最多幾條（排字的點數上限另外算）。 */
const MAXFISH = 2600;
const STONE = { x: 1690, y: 800 };
/** 解說牌上下兩行小字（冷面的館方口吻）。 */
const HEAD = '展示物種：祝福';
const FOOT = '＊請勿拍打玻璃，魚會害羞。';

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
      float frame = step(-12.0, dp);
      vec2 u = (p - pnl.xy) / (pnl.zw - pnl.xy);
      // 面板：燈箱亮起來是暖暖的深灰（字是亮的，面板本身不刺眼），中間亮、邊緣暗
      vec3 face = C_INK2 * 0.9 + (C_GRAPHITE * 0.12 + C_SIGNAL * 0.012) * lamp * (1.0 - 0.35 * length(u - 0.5));
      vec3 fr = C_INK * 0.9 + C_GRAPHITE * 0.05;
      fr += (C_BONE * 0.08 + C_SIGNAL * 0.05) * smoothstep(pnl.z - 12.0, pnl.z - 2.0, p.x);  // 右邊框的邊光
      fr += C_BONE * 0.03 * (1.0 - smoothstep(0.0, 3.0, p.y - pnl.y));
      col = mix(face, fr, frame);
    }
    col *= kin;
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 }, kin: { value: 1 }, lamp: { value: 1 }, kick: { value: 0 }, pnl: { value: new THREE.Vector4(PANEL.x0, PANEL.y0, PANEL.x1, PANEL.y1) } });

/** 排字的一個點：魚要去的位置、屬於哪個字（詞）、在詞裡的左右位置（0..1，跟唱擦過去用）。 */
interface FPt { x: number; y: number; w: number; u: number }
/** 一句歌詞的魚陣：什麼時候開始聚、什麼時候散。 */
interface School { line: Line | null; pts: FPt[]; a: number; b: number }

export default class Aquarium extends Scene {
  bg = shared('aquarium.bg', BG);
  /** 解說牌上的字（init 畫一次）。 */
  panel = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fish = this.track(new LineBatch(MAXFISH * 2 + 1200, { screen2D: true, blend: 'normal' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 173 + (this.msg?.id ?? 0) * 7919) >>> 0;
  /** 這個窗格的配置：解說牌、牌上的字、魚排字的範圍（有留言時解說牌大、魚字小）。 */
  pnl = this.msg ? PANEL_M : PANEL;
  ptxt = this.msg ? PTXT_M : PTXT;
  fa = this.msg ? FISH_M : FISH;
  schools: School[] = [];
  /** 魚的狀態（null = 自由游）與狀態之間的轉換時間。 */
  seq: (School | null)[] = [null];
  tr: { t0: number; dur: number }[] = [];
  nfish = 400;
  /** 魚群中心的路徑：每個小節線換一個點（整群突然轉向）。 */
  way: { t: number; x: number; y: number }[] = [];
  beats: number[] = [];
  tFirst = 0;
  /** 每條魚的個性：繞群心的半徑、速度、相位、落後幾秒。 */
  fp: { r: number; ry: number; w: number; ph: number; lag: number; d: number; s: number }[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const lines = lyrics.linesIn(s - 0.5, e + 1.2);
    const sig = m ? sigOf(m) : '';
    await loadText(`${T16_TEXT}${m?.text ?? ''}${sig}${lines.map((l) => l.text).join('')}${song.title}${song.artist}${COUPLE_ZH}${HEAD}${FOOT}${no3(m?.n ?? 0)}展示物種祝福魚群`);
    const beat = au.beatPeriod(s);
    this.tFirst = beatAfter(au, s + Math.min(0.2, beat * 0.4));
    this.beats = winBeats(au, s - 2, e);

    // ---- 魚陣：每句歌詞一陣（窗格裡的）；純音樂又沒有留言時排新人的名字。
    // 魚的「狀態」依時間排成一串：自由游 → 第一句 → 第二句 → … → 自由游；兩句之間魚直接從上一句的字游到下一句的字
    // （上一句唱完才開始散、下一句要唱之前排好），兩句隔很久才先散開自由游一陣。
    let maxPts = 0;
    const seq: (School | null)[] = [null];
    const tr: { t0: number; dur: number }[] = [];
    if (lines.length) {
      lines.forEach((ln) => {
        const pts = this.linePoints(ln.text, ln);
        maxPts = Math.max(maxPts, pts.length);
        const sc: School = { line: ln, pts, a: 0, b: 0 };
        this.schools.push(sc);
        const prev = seq[seq.length - 1];
        const pl = prev?.line;
        if (!pl) { tr.push({ t0: ln.start - 1.1, dur: 0.9 }); seq.push(sc); return; }
        if (ln.start - pl.end > 3.2) {
          tr.push({ t0: pl.end + 0.8, dur: 0.9 }); seq.push(null);
          tr.push({ t0: ln.start - 1.1, dur: 0.9 }); seq.push(sc);
          return;
        }
        const T = Math.max(pl.end + 0.1, ln.start - 1.0);
        tr.push({ t0: T, dur: clamp(ln.start - 0.1 - T, 0.35, 0.9) }); seq.push(sc);
      });
      const last = seq[seq.length - 1]!;
      tr.push({ t0: last.line!.end + 0.8, dur: 0.9 }); seq.push(null);
    } else if (!m) {
      const pts = this.linePoints(COUPLE_ZH.replace(/\s*&\s*/, ' ♥ '), null);
      maxPts = pts.length;
      const sc: School = { line: null, pts, a: 0, b: 0 };
      this.schools.push(sc);
      tr.push({ t0: this.tFirst - 0.6, dur: 0.9 }); seq.push(sc);
    }
    this.seq = seq; this.tr = tr;
    this.nfish = Math.min(MAXFISH, Math.max(420, maxPts + 90));
    const rnd = (i: number, k: number) => hash(this.seed, i, k);
    for (let i = 0; i < this.nfish; i++) {
      this.fp.push({ r: 30 + 220 * Math.sqrt(rnd(i, 1)), ry: 0.35 + 0.35 * rnd(i, 2), w: (0.5 + 0.6 * rnd(i, 3)) * (rnd(i, 4) < 0.8 ? 1 : -1), ph: rnd(i, 5) * TAU, lag: Math.round((0.05 + 0.6 * rnd(i, 6) ** 1.5) * 30) / 30, d: 0.35 * rnd(i, 7), s: 0.8 + 0.5 * rnd(i, 8) });
    }
    // 魚群中心：每個小節線換一個點（在開闊水域裡），整群在小節線上轉向
    const bars = winBars(au, s - 4, e + 2);
    let px = 1200, py = 380;
    for (let k = 0; k < bars.length; k++) {
      // 有魚陣的時候，沒排字的魚在字的下面游（不要穿過字）
      const nx = m ? 1180 + 480 * rnd(k, 21) : 900 + 760 * rnd(k, 21), ny = this.schools.length ? (m ? 640 : 610) + 60 * rnd(k, 22) : 220 + 330 * rnd(k, 22);
      this.way.push({ t: bars[k]!, x: px, y: py });
      px = nx; py = ny;
    }
    this.way.push({ t: e + 10, x: px, y: py });

    // ---- 解說牌上的字（畫一次）
    this.drawPanel(sig);
  }

  /** 一段字排成魚陣的點（每個字分開取點，才知道每個點屬於哪個詞、在詞裡的哪裡）。 */
  private linePoints(text: string, line: Line | null): FPt[] {
    const c = this.panel.ctx;
    // 魚排的字要夠大才認得出來：中文筆畫多，寧可折成兩行也不要縮到 132 px 以下；英文 104 px 就讀得到
    const cjk = /[　-鿿가-힯]/.test(text);
    // 有留言時魚字小一級（約 64 px，魚也小、密一點才排得出筆畫），明顯比解說牌上的留言小
    const st: LyricStyle = this.msg
      ? { family: FAM_FISH, size: 66, minSize: 60, maxWidth: this.fa.w, align: 'center', lineHeight: 1.14 }
      : cjk
        ? { family: FAM_FISH, size: 150, minSize: 132, maxWidth: this.fa.w, align: 'center', lineHeight: 1.1 }
        : { family: FAM_FISH, size: 128, minSize: 104, maxWidth: this.fa.w, align: 'center', lineHeight: 1.12 };
    // 沒有歌詞物件（新人的名字）時自己排一行
    const fake: Line = line ?? { i: -1, text, start: 0, end: 0, words: Array.from(text).map((w, k) => ({ w, start: 0, end: 0, line: -1, index: k, gi: -1, o: k })) };
    const lay = layoutLyric(c, fake, st);
    const top = this.fa.y + (this.fa.h - lay.height) / 2 + lay.size * 0.9;
    const cx = this.fa.x + this.fa.w / 2;
    // 點排在整齊的格子上（像點陣字，筆畫比亂撒的點清楚），格子對齊整個畫面，字跟字之間也對得齊；點太多就放疏一點
    let step = Math.max(this.msg ? 2.6 : 5, lay.size / 26);
    const sample = (stp: number) => {
      const out: FPt[] = [];
      lay.words.forEach((pw, wi) => {
        if (!pw.word.w.trim()) return;
        for (const g of layout(pw.word.w, FAM_FISH, lay.size).glyphs) {
          if (!g.ch.trim()) continue;
          const ox = cx + pw.x + g.x, oy = top + pw.y;
          for (const q of gridPoints(g.ch, FAM_FISH, lay.size, stp, ox, oy)) out.push({ x: q.x, y: q.y, w: wi, u: clamp((q.x - cx - pw.x) / Math.max(1, pw.w)) });
        }
      });
      return out;
    };
    let pts = sample(step);
    if (pts.length > MAXFISH - 120) { step *= Math.sqrt(pts.length / (MAXFISH - 120)) * 1.02; pts = sample(step); }
    // 打散順序：魚從四面八方游進來，不是一排一排
    const r = (i: number) => hash(this.seed, i, 91);
    return pts.map((p, i) => ({ p, k: r(i) })).sort((a, b) => a.k - b.k).map((x) => x.p);
  }

  /** 解說牌：上面一行小字、留言（大）、署名、下面一行小字。沒有留言：展示物種與邀請。 */
  private drawPanel(sig: string) {
    const c = this.panel.ctx, m = this.msg, P = this.ptxt, Q = this.pnl;
    c.clearRect(0, 0, W, H);
    c.textBaseline = 'alphabetic';
    c.font = font(F.hei(500), 18); c.letterSpacing = '4px'; c.fillStyle = rgba('ash', 0.75);
    c.fillText(m ? `${HEAD}　${no3(m.n)}` : HEAD, P.x, Q.y0 + 58);
    c.letterSpacing = '0px';
    c.fillStyle = rgba('ash', 0.3); c.fillRect(P.x, Q.y0 + 76, P.w, 1);
    if (m) {
      const n = Array.from(m.text.replace(/\s/g, '')).length;
      const fit: FitResult = fitText(c, m.text, FAM_MSG, P.w, P.h - 70, { min: 72, max: n <= 4 ? 170 : n <= 10 ? 140 : 116, lineHeight: 1.28, maxLines: 7 });
      const blockH = fit.size + (fit.lines.length - 1) * fit.lineHeight + 70;
      const top = P.y + Math.max(0, (P.h - blockH) / 2 - 20) + fit.size * 0.9;
      drawMessage(c, fit, FAM_MSG, P.x, top, { color: rgba('bone', 0.97) });
      c.font = font(F.ming(400), 42); c.fillStyle = rgba('bone', 0.72); c.textAlign = 'right';
      c.fillText(sig, P.x + P.w, top + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.45 + 50);
      c.textAlign = 'left';
    } else {
      c.font = font(F.ming(700), 50); c.fillStyle = rgba('bone', 0.9);
      c.fillText('祝福魚群', P.x, P.y + 110);
      c.font = font(F.serif(400, true), 30); c.fillStyle = rgba('bone', 0.6);
      c.fillText('Benedictio aeterna', P.x, P.y + 172);
      c.font = font(F.hei(500), 26); c.fillStyle = rgba('bone', 0.72);
      const lines = ['掃描右下角 QR code，', '把你的祝福傳上大螢幕，', '魚群會把它游出來。'];
      lines.forEach((ln, i) => c.fillText(ln, P.x, P.y + 300 + i * 44));
    }
    c.font = font(F.hei(500), 17); c.letterSpacing = '2px'; c.fillStyle = rgba('ash', 0.6);
    c.fillText(FOOT, P.x, Q.y1 - 44);
    c.letterSpacing = '0px';
    this.panel.upload();
  }

  /** 魚群中心在 t 的位置：小節線之間用強烈緩動從一點衝到下一點（整群在小節線轉向）。 */
  private cc = new Map<number, { x: number; y: number }>();
  private center(t: number) {
    // 每條魚落後的秒數只有幾十種（init 量化過），同一格裡很多魚問同一個時間：記起來
    const hit = this.cc.get(t);
    if (hit) return hit;
    const r = this.center0(t);
    this.cc.set(t, r);
    return r;
  }
  private center0(t: number) {
    const w = this.way;
    let k = 0;
    while (k < w.length - 1 && w[k + 1]!.t <= t) k++;
    const a = w[k]!, b = w[Math.min(k + 1, w.length - 1)]!;
    const nxt = w[k + 2] ?? b;
    const dur = Math.max(0.3, nxt.t - b.t);
    const u = ease.inOutCubic(clamp((t - b.t) / (dur * 0.8)));
    // 還沒到第一個小節線：停在 a
    if (t < b.t) return { x: a.x, y: a.y };
    return { x: b.x + (nxt.x - b.x) * u, y: b.y + (nxt.y - b.y) * u };
  }

  /** 第 i 條魚「自由游」的位置：繞著（落後一點的）群心轉圈。 */
  private free(i: number, t: number) {
    const f = this.fp[i]!;
    const c = this.center(t - f.lag);
    const a = f.ph + t * f.w;
    // 群不是一顆正橢圓：半徑跟著時間鼓縮、上下有波，落後越多的魚在越外圍（群有一條尾巴）
    const rr = f.r * (0.85 + 0.25 * Math.sin(t * 0.9 + f.ph * 2));
    return { x: c.x + Math.cos(a) * rr * 1.6 + 26 * Math.sin(t * 0.7 + i * 0.37), y: c.y + Math.sin(a) * rr * f.ry + 22 * Math.sin(a * 2 + t * 1.1) };
  }

  /** 一個狀態裡第 i 條魚的位置（自由游，或排在字上的那一點再輕輕浮動）與它是不是排在字上。 */
  private at(st: School | null, i: number, t: number) {
    if (st && i < st.pts.length) {
      const q = st.pts[i]!;
      return { x: q.x + 0.8 * Math.sin(t * 3.1 + i), y: q.y + 0.6 * Math.cos(t * 2.4 + i * 1.7), pt: q as FPt | null, sch: st as School | null };
    }
    const f = this.free(i, t);
    return { x: f.x, y: f.y, pt: null, sch: null };
  }

  /** 第 i 條魚在 t 的位置與它在魚陣裡的程度（0 = 自由游、1 = 排好）。兩個狀態之間游過去時路線往外拱一點（像游，不是平移）。 */
  private pos(i: number, t: number): { x: number; y: number; k: number; sch: School | null; pt: FPt | null } {
    const d = this.fp[i]!.d;
    for (let j = 0; j < this.tr.length; j++) {
      const tj = this.tr[j]!;
      const a = tj.t0 + d * tj.dur * 0.4, b = a + tj.dur * 0.75;
      if (t < a) { const p = this.at(this.seq[j]!, i, t); return { x: p.x, y: p.y, k: p.pt ? 1 : 0, sch: p.sch, pt: p.pt }; }
      if (t < b) {
        const A = this.at(this.seq[j]!, i, t), B = this.at(this.seq[j + 1]!, i, t);
        const u = ease.inOutCubic((t - a) / (b - a));
        const x = A.x + (B.x - A.x) * u, y = A.y + (B.y - A.y) * u;
        const f = this.free(i, t), arc = 0.3 * Math.sin(Math.PI * u);
        const kA = A.pt ? 1 : 0, kB = B.pt ? 1 : 0;
        const near = u < 0.5 ? (A.pt ? A : B) : (B.pt ? B : A);
        return { x: x + (f.x - x) * arc, y: y + (f.y - y) * arc, k: kA + (kB - kA) * u, sch: near.sch, pt: near.pt };
      }
    }
    const p = this.at(this.seq[this.seq.length - 1] ?? null, i, t);
    return { x: p.x, y: p.y, k: p.pt ? 1 : 0, sch: p.sch, pt: p.pt };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const u = this.bg.u;
    const kin = prog(t, s, s + 0.2);
    // 燈箱：第一拍「啪、啪」閃兩下亮起來
    const dt = t - this.tFirst;
    const lamp = dt < 0 ? 0.06 : dt < 0.05 ? 1 : dt < 0.11 ? 0.15 : dt < 0.16 ? 0.9 : dt < 0.2 ? 0.35 : Math.min(1, 0.8 + (dt - 0.2) * 2);
    u.t!.value = t; u.kin!.value = kin; u.lamp!.value = lamp; u.kick!.value = f.a.kick;
    (u.pnl!.value as THREE.Vector4).set(this.pnl.x0, this.pnl.y0, this.pnl.x1, this.pnl.y1);
    this.bg.render(renderer, out);
    comp.draw(renderer, this.panel.texture, out, { opacity: kin * (0.12 + 0.88 * lamp) });

    // ---- 魚
    this.cc.clear();
    const lb = this.fish; lb.clear();
    const B = LIN.bone, S = LIN.signal, E = LIN.ember;
    // 每一拍：一道「擺尾」從左到右掃過排好的魚
    let lastBeat = -Infinity;
    for (const b of this.beats) if (b <= t) lastBeat = b;
    for (let i = 0; i < this.nfish; i++) {
      const p = this.pos(i, t);
      const q = this.pos(i, t - 0.04);
      let ang = Math.atan2(p.y - q.y, p.x - q.x);
      const sp = Math.hypot(p.x - q.x, p.y - q.y);
      // 排好的魚一起朝右；擺尾的那一下轉一點
      const sweep = lastBeat > -Infinity ? pulse(t, lastBeat + (p.x - this.fa.x) / 2600, 0.09) : 0;
      if (p.k > 0.01) {
        const target = 0.45 * sweep * (i % 2 ? 1 : -1);
        const a2 = sp < 0.4 ? target : ang;
        ang = a2 + (target - a2) * p.k;
      }
      // 顏色：自由游的是銀色；排字的魚照跟唱規則（還沒唱暗、正在唱訊號色、唱完銀白）
      let col: [number, number, number] = [B[0] * 0.55, B[1] * 0.55, B[2] * 0.55];
      let a = 0.75 * this.fp[i]!.s;
      if (p.k > 0.02 && p.sch && p.pt) {
        let st = 1; // 0 = 還沒唱、1 = 正在唱、2 = 唱完
        if (p.sch.line) {
          const wd = p.sch.line.words[p.pt.w];
          const pr = wd ? Lyrics.wordProgress(wd, t) : 0;
          st = pr <= 0 || p.pt.u > pr ? 0 : pr < 1 ? 1 : 2;
          if (st === 2 && wd && t - wd.end < 0.35) st = 1;
        } else st = t > this.tFirst + 0.8 ? 2 : 1;
        const k = p.k;
        // 有留言時魚排的歌詞退一步（唱完的銀白暗一點），焦點留給解說牌上的留言
        const far = this.msg ? 1 : 0;
        const sung = far ? 0.66 : 0.95, hot = far ? 1.5 : 2.2, un = far ? 0.24 : 0.3;
        const base: [number, number, number] = st === 0 ? [B[0] * un, B[1] * un, B[2] * un] : st === 1 ? [S[0] * hot + E[0] * 0.3, S[1] * hot + E[1] * 0.3, S[2] * hot + E[2] * 0.3] : [B[0] * sung, B[1] * sung, B[2] * sung];
        col = [col[0] + (base[0] - col[0]) * k, col[1] + (base[1] - col[1]) * k, col[2] + (base[2] - col[2]) * k];
        a = a + ((st === 0 ? 0.6 : 1) - a) * k;
      }
      a *= kin;
      // 解說牌在水族箱前面：牌後面的魚看不到
      const pn = this.pnl;
      if (p.x > pn.x0 - 4 && p.x < pn.x1 + 4 && p.y > pn.y0 - 4 && p.y < pn.y1 + 4) continue;
      // 排字的魚小一點、細一點（字的筆畫才不會糊在一起）；有留言時魚字小，排字的魚更小（像在比較遠的水裡）
      const fk = this.msg ? 0.62 : 0.35;
      const L = 6.5 * this.fp[i]!.s * (1 - fk * p.k), cx = Math.cos(ang), cy = Math.sin(ang);
      // 身體（前粗後細用兩段）＋尾巴
      lb.seg2(p.x - cx * L * 0.3, p.y - cy * L * 0.3, p.x + cx * L * 0.5, p.y + cy * L * 0.5, (3.0 - (this.msg ? 1.5 : 0.6) * p.k) * this.fp[i]!.s, col, a);
      const wag = Math.sin(t * 18 + i) * 0.5 + sweep * 0.9;
      const tx = -cx * L * 0.3, ty = -cy * L * 0.3;
      lb.seg2(p.x + tx, p.y + ty, p.x + tx - Math.cos(ang + wag) * L * 0.5, p.y + ty - Math.sin(ang + wag) * L * 0.5, 1.5 * this.fp[i]!.s, col, a * 0.8);
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
    return { bloom: 0.7, vignette: 0.55, halation: 0.22, zoom: 1 + 0.035 * ease.inOutQuad(f.p) };
  }
}

let gridCv: CanvasRenderingContext2D | null = null;
/**
 * 一個字的格點：把字畫在一張小畫布上，在整齊的格子（對齊整個畫面座標，格距 step）上取「在字裡面」的點。
 * （engine 的 textPoints 是亂撒的點，魚排出來筆畫會糊；格點排出來像點陣字，中文也認得出來。）
 */
function gridPoints(ch: string, family: string, size: number, step: number, ox: number, oy: number): { x: number; y: number }[] {
  const pad = Math.ceil(size * 0.25), w = Math.ceil(size * 1.3 + pad * 2), h = Math.ceil(size * 1.5);
  if (!gridCv) gridCv = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  const c = gridCv;
  if (c.canvas.width < w || c.canvas.height < h) { c.canvas.width = Math.max(c.canvas.width, w); c.canvas.height = Math.max(c.canvas.height, h); }
  c.clearRect(0, 0, c.canvas.width, c.canvas.height);
  c.font = font(family, size);
  c.fillStyle = 'rgb(255,255,255)'; // 取樣用的遮罩（不是畫面上的顏色）
  c.textBaseline = 'alphabetic';
  const base = Math.round(size * 1.12);
  c.fillText(ch, pad, base);
  const data = c.getImageData(0, 0, w, h).data;
  const out: { x: number; y: number }[] = [];
  // 畫布左上角在畫面上的位置
  const x0 = ox - pad, y0 = oy - base;
  for (let gy = Math.ceil(y0 / step) * step; gy < y0 + h; gy += step) {
    for (let gx = Math.ceil(x0 / step) * step; gx < x0 + w; gx += step) {
      const ix = Math.round(gx - x0), iy = Math.round(gy - y0);
      if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
      if (data[(iy * w + ix) * 4 + 3]! > 110) out.push({ x: gx, y: gy });
    }
  }
  return out;
}
