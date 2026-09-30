// 藤蔓（亮）：午後的陽光從窗戶斜斜地照在一面灰泥牆上（窗外的樹影在牆上晃，小節線上一陣風把光影吹動）。
// 藤蔓沿著「看不見的字」長出來——每一個字先被細化成筆畫的中心線（vines-skel.ts），藤蔓就順著筆畫爬，
// 爬完的筆畫尾端捲一個小鬚，葉子在拍點上一批一批展開。藤蔓在牆上有一道淡淡的影子（陽光是真的光）。
// 有留言：藤蔓在第一拍之後一個字一個字長成留言，署名（手寫）最後淡入；歌詞是牆下緣陰影裡的一行字。
// 沒有留言：藤蔓長成歌詞——還沒唱的字是牆上淡淡的鉛筆線，唱到的字藤蔓正好從頭爬到尾（那個字唱完、藤蔓也長完）。
// 2026-09-29 照「留言尺寸與版面比例標準 v2」：字縮到 40～60 px（寫在畫面右側 ≤ 840×420 的範圍），
// 牆上多了一株真的藤蔓當主角——從左邊牆腳爬上來、沿著牆頂橫過去，垂下幾條鬚（小節線上被風吹得晃），
// 葉子在拍點展開、每個小節線開一朵小花；寫字的藤從主藤垂下來接到每一行的開頭。
// 手法：牆與光影是 shader；藤蔓、影子、葉子、小鬚是 LineBatch；署名與字幕是 Canvas。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp } from '../engine/util';
import type { Line, Word } from '../engine/lyrics';
import { heartPoints, drawHeart } from '../engine/motifs';
import { lyricAt, beatAfter, COUPLE_ZH, lyricSubOf, layoutLyric, subStyleFor, subGap, drawLyricSub, type LyricStyle } from './_motifs';
import { lyricV2, V2 } from './_v2';
import { layoutRows, drawRows, paperInk } from './_t4';
import { winBeats, winBars } from './_t8';
import { stagger } from './_t11';
import { msgBlockV2, loadAll, type MsgBlock, type Rect } from './_t15';
import { skeleton, type Pt } from './vines-skel';
import { tokens } from '../engine/text';

export const spec: PlateSpecDecl = { group: 'type', family: 'nature', paper: true, energy: [0.15, 0.8], bars: [4, 8], weight: 1 };

const FAM_V = F.hei(700);
/** 留言長在這一塊；歌詞字幕在下緣的陰影裡。 */
const MSG = { x: 900, y: 300, w: 840, h: 420 };
/** 沒有留言時歌詞／名字長在這一帶（中心 x、第一行基線附近的 y、最寬）。 */
const LYR = { cx: 1310, y: 470, maxW: 860 };
/** 主藤：從左邊牆腳爬上來、沿著牆頂往右（Catmull-Rom 控制點）。 */
const MAIN: [number, number][] = [[-40, 760], [70, 600], [150, 420], [300, 260], [560, 160], [860, 118], [1160, 138], [1450, 108], [1740, 150], [1980, 110]];
/** 從主藤垂下來的鬚：在主藤上的位置（0..1）、長度。 */
const HANG: [number, number][] = [[0.2, 300], [0.3, 420], [0.4, 250], [0.52, 180], [0.93, 260]];
const SUB = { x: 170, base: 976, maxW: 1140 };

interface Path { pts: Pt[]; cum: number[]; len: number }
interface Leaf { s: number; side: number; t: number; sz: number }
interface Unit { text: string; x: number; y: number; size: number; paths: Path[]; t0: number; t1: number; heart: boolean; guide: boolean; tIn: number; tOff: number; conn?: Path; leaves: { pi: number; s: number; side: number; t: number; sz: number }[] }

/** 牆：灰泥的起伏、窗戶透進來的一塊斜斜的陽光（窗框的影子很淡）、窗外樹葉的光斑（風一吹就晃）。 */
const WALL = () => new FSPass(/* glsl */ `
  uniform float t; uniform float gust; uniform float k;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float n = fbm(p / 110.0, 4), n2 = snoise(p / 9.0);
    vec3 base = C_PAPER * (0.9 + 0.05 * n + 0.012 * n2);
    // 窗戶的光：斜的平行四邊形、軟邊
    vec2 q = p - vec2(980.0, 430.0);
    q.x -= q.y * 0.32;
    float sun = (1.0 - smoothstep(800.0, 850.0, abs(q.x))) * (1.0 - smoothstep(360.0, 400.0, abs(q.y)));
    // 窗框（十字）很淡的影子
    float mull = 1.0 - 0.1 * (1.0 - smoothstep(10.0, 34.0, abs(q.x - 120.0))) - 0.08 * (1.0 - smoothstep(8.0, 30.0, abs(q.y + 40.0)));
    // 樹葉的光斑：慢慢漂，小節線上的風把它推一下
    vec2 dq = p / 240.0 + vec2(t * 0.025 + gust * 0.12, t * 0.012 - gust * 0.05);
    float lv = smoothstep(-0.25, 0.35, fbm(dq * 0.8, 3) + 0.15 * snoise(p / 200.0 + vec2(t * 0.05, gust * 0.3)));
    float light = sun * mull * (0.62 + 0.38 * lv);
    // 陰影裡偏冷偏暗，陽光裡暖一點亮一點（只有 signal 一家子的暖色）
    vec3 col = base * (0.7 + 0.4 * light) + mix(C_SIGNAL, C_BONE, 0.5) * 0.06 * light;
    // 牆腳一點陰影
    col *= 1.0 - 0.12 * smoothstep(760.0, 1080.0, p.y);
    fragColor = vec4(col * mix(0.85, 1.0, k), 1.0);
  }`, { t: { value: 0 }, gust: { value: 0 }, k: { value: 1 } });

/** Catmull-Rom 取樣：控制點 → 密一點的折線。 */
function spline(ctrl: [number, number][], per = 10): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)]!, p1 = ctrl[i]!, p2 = ctrl[i + 1]!, p3 = ctrl[Math.min(ctrl.length - 1, i + 2)]!;
    for (let k = 0; k < per; k++) {
      const u = k / per, u2 = u * u, u3 = u2 * u;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
      out.push({ x: f(p0[0], p1[0], p2[0], p3[0]), y: f(p0[1], p1[1], p2[1], p3[1]) });
    }
  }
  const l = ctrl[ctrl.length - 1]!;
  out.push({ x: l[0], y: l[1] });
  return out;
}

function mkPath(pts: Pt[], ox: number, oy: number): Path {
  const q = pts.map((p) => ({ x: p.x + ox, y: p.y + oy }));
  const cum = [0];
  for (let i = 1; i < q.length; i++) cum.push(cum[i - 1]! + Math.hypot(q[i]!.x - q[i - 1]!.x, q[i]!.y - q[i - 1]!.y));
  return { pts: q, cum, len: cum[cum.length - 1]! };
}

export default class Vines extends Scene {
  wall = shared('vines.wall', WALL);
  vine = this.track(new LineBatch(40000, { screen2D: true, blend: 'normal' }));
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 211 + (this.msg?.id ?? 0) * 37) >>> 0;
  units: Unit[] = [];
  beats: number[] = [];
  bars: number[] = [];
  block: MsgBlock | null = null;
  sig: { x: number; y: number; t: number } | null = null;
  lyrSize = 54;
  mode: 'msg' | 'lyric' | 'title' = 'msg';
  /** 主藤與它的葉子、長好的時間；垂下來的鬚；每個小節線開的小花。 */
  main!: Path;
  mainT0 = 0; mainT1 = 1;
  mainLeaves: Leaf[] = [];
  hangs: { s: number; len: number; t0: number; leaves: Leaf[]; ph: number }[] = [];
  blooms: { on: 'main' | number; s: number; t: number }[] = [];
  /** 沒有留言時每一句的韓文原文副行（第一排基線 y、跟著那一句淡入淡出的時間）。 */
  subs: { line: Line; st: LyricStyle; size: number; y: number; tIn: number; tOff: number }[] = [];

  override async init() {
    const { audio: au, lyrics, start: s, end: e } = this.ctx;
    const lines = lyrics.linesIn(s - 0.5, e);
    // 原文副行在 await 之前先拿：引擎只在呼叫 init 前設好這一格的開關
    const subOf = new Map(lines.map((l) => [l, lyricSubOf(l)] as const));
    await loadAll(this.msg, lines.map((l) => l.text).join(''), COUPLE_ZH);
    this.beats = winBeats(au, s, e + 4);
    this.bars = winBars(au, s, e).filter((b) => b > s + 0.1);
    const c = this.layer.ctx;
    this.mode = this.msg ? 'msg' : lines.length ? 'lyric' : 'title';
    // ---- 主藤：第一拍前後開始爬，約三拍爬滿牆頂；寫字的藤等主藤爬過去才開始
    const beat = au.beatPeriod(s);
    this.main = mkPath(spline(MAIN, 10), 0, 0);
    this.mainT0 = s + 0.05;
    this.mainT1 = this.mainT0 + clamp(beat * 3, 1.0, 2.0);
    const passT = (u: number) => this.mainT0 + (this.mainT1 - this.mainT0) * (1 - Math.cbrt(1 - clamp(u)));
    for (let sPos = 40, k = 0; sPos < this.main.len; sPos += 58, k++) {
      const tb = this.beats.find((b) => b >= passT(sPos / this.main.len)) ?? this.mainT1;
      this.mainLeaves.push({ s: sPos, side: k % 2 ? 1 : -1, t: tb + hash(this.seed, k, 3) * 0.05, sz: 11 + 5 * hash(this.seed, k, 4) });
    }
    HANG.forEach(([u, len], i) => {
      const t0h = passT(u) + 0.1;
      const leaves: Leaf[] = [];
      for (let sPos = 30, k = 0; sPos < len; sPos += 44, k++) {
        const tb = this.beats.find((b) => b >= t0h + (sPos / len) * 0.8) ?? t0h + 1;
        leaves.push({ s: sPos, side: k % 2 ? 1 : -1, t: tb + hash(this.seed, i, k) * 0.05, sz: 9 + 4 * hash(this.seed, i, k + 7) });
      }
      this.hangs.push({ s: u * this.main.len, len, t0: t0h, leaves, ph: hash(this.seed, i, 9) * 6 });
    });
    // 每個小節線開一朵小花：輪流開在主藤與垂下來的鬚上
    this.bars.forEach((b, i) => {
      const on = i % 3 === 2 ? 'main' as const : (i * 2 + 1) % HANG.length;
      const sPos = on === 'main' ? this.main.len * (0.12 + 0.8 * hash(this.seed, i, 11)) : HANG[on]![1] * (0.45 + 0.5 * hash(this.seed, i, 12));
      this.blooms.push({ on, s: sPos, t: b });
    });
    const t0 = beatAfter(au, Math.max(s + 0.1, passT(0.35)));
    if (this.mode === 'msg') {
      const b = msgBlockV2(c, this.msg!, FAM_V, MSG.w, MSG.h, { lineHeight: 1.34 });
      this.block = b;
      this.lyrSize = lyricV2(b.fit.size);
      const n0 = this.units.length;
      // 整塊在留言區裡置中、每行靠左（寫字的藤從左上方垂下來接每一行的開頭，不會穿過字）；署名靠整塊的右緣
      c.font = font(FAM_V, b.fit.size);
      const bw = Math.max(...b.fit.lines.map((ln) => c.measureText(ln).width));
      const bx = MSG.x + (MSG.w - bw) / 2;
      b.fit.lines.forEach((ln, li) => this.addText(c, ln, b.fit.size, bx, MSG.y + b.top + li * b.fit.lineHeight, [], Infinity));
      // 一個字一個字長出來：一拍幾個，最多用掉窗格的四成（至少兩秒內長完）
      const n = this.units.length - n0;
      const ts = stagger(au, t0, n, clamp((e - t0) * 0.4, 1.2, 3.2));
      const grow = clamp(this.ctx.audio.beatPeriod(s) * 1.4, 0.45, 0.8);
      this.units.slice(n0).forEach((u, i) => { u.t0 = ts[i]!; u.t1 = ts[i]! + grow; });
      this.connect(n0);
      const last = this.units[this.units.length - 1];
      this.sig = { x: bx + Math.max(bw, 320), y: MSG.y + b.sigY, t: last ? last.t1 + 0.15 : t0 };
    } else if (this.mode === 'lyric') {
      lines.forEach((l, li) => {
        const next = lines[li + 1];
        const lay = layoutRows(c, l, { family: FAM_V, size: lyricV2(null), minSize: V2.lyrMin, maxW: LYR.maxW, maxRows: 2, align: 'center', lineHeight: 1.3 });
        let y0 = LYR.y - (lay.rows.length - 1) * lay.lineHeight * 0.5;
        const tOff = next ? next.start - 0.45 : Infinity, tIn = li === 0 ? -Infinity : l.start - 0.6;
        // 韓文原文副行：寫在牆上、中文正下方（小一號，藤蔓不爬它），中文＋原文一起置中在這一帶
        const sub = subOf.get(l);
        if (sub) {
          const st: LyricStyle = { family: FAM_V, size: lay.size, maxWidth: LYR.maxW, align: 'center' };
          const sl = layoutLyric(c, sub, subStyleFor(st, lay.size));
          const dy = (lay.rows.length - 1) * lay.lineHeight + subGap(lay.size, sl.size);
          y0 -= (dy + sl.rows[sl.rows.length - 1]!.y - (lay.rows.length - 1) * lay.lineHeight) / 2;
          this.subs.push({ line: sub, st, size: lay.size, y: y0 + dy, tIn, tOff });
        }
        for (const pw of lay.words) {
          const txt = pw.word.w.trim();
          if (!txt) continue;
          this.addText(c, txt, lay.size, LYR.cx + pw.x, y0 + pw.y, [pw.word], tOff, true, tIn);
        }
      });
    } else {
      this.addText(c, COUPLE_ZH.replace(/\s*&\s*/, ' ♥ '), 64, 0, LYR.y, [], Infinity);
      const us = this.units;
      const wsum = us.reduce((m, u) => Math.max(m, u.x + u.size), 0);
      const sh = LYR.cx - wsum / 2;
      us.forEach((u) => { u.x += sh; u.paths = u.paths.map((p) => mkPath(p.pts, sh, 0)); });
      const ts = stagger(au, t0, us.length, 2.4);
      us.forEach((u, i) => { u.t0 = ts[i]!; u.t1 = ts[i]! + 0.7; });
      this.connect(0);
    }
    // 葉子：沿著藤蔓每隔一段兩側交錯，在「藤蔓長過去之後的第一拍」展開
    for (const u of this.units) {
      u.paths.forEach((p, pi) => {
        const every = Math.max(34, u.size * 0.7);
        for (let sPos = every * 0.6, k = 0; sPos < p.len; sPos += every, k++) {
          const tPass = u.t0 + (u.t1 - u.t0) * (sPos / Math.max(1, p.len));
          const tb = this.beats.find((b) => b >= tPass) ?? tPass + 0.3;
          u.leaves.push({ pi, s: sPos, side: k % 2 ? 1 : -1, t: tb + hash(this.seed, pi, k) * 0.05, sz: Math.max(6, u.size * (0.11 + 0.04 * hash(pi, k, this.seed))) });
        }
      });
    }
  }

  /**
   * 寫字的藤：每一行的第一個字，從主藤上（那一行左上方）垂下一枝、彎到字的開頭；
   * 同一行後面的字不用連（字跟字之間的小弧線看起來像一排豆子）。
   */
  private connect(from: number) {
    const c0 = this.layer.ctx;
    const us = this.units.slice(from);
    us.forEach((u, i) => {
      const prev = us[i - 1];
      const y = u.y + u.size * 0.14;
      let a: Pt, sag: number;
      // 同一行後面的字不用連（字跟字之間的小弧線看起來像一排豆子），只有每一行的第一個字從牆邊爬進來
      if (prev && prev.y === u.y) return;
      // 主藤上 x 最接近「字的左上方」的那一點
      // 每一行接的點往左錯開一點，幾枝藤不會疊在一起
      const want = u.x - 90 - (i > 0 ? 45 : 0) * us.slice(0, i).filter((q, j) => j === 0 || us[j - 1]!.y !== q.y).length;
      let best = this.main.pts[0]!;
      for (const q of this.main.pts) if (Math.abs(q.x - want) < Math.abs(best.x - want)) best = q;
      a = { x: best.x, y: best.y + 4 }; sag = 0;
      const b = { x: u.x + u.size * 0.08, y };
      const pts: Pt[] = [];
      for (let k = 0; k <= 24; k++) {
        const q = k / 24, iq = 1 - q;
        const mx = Math.min(a.x, b.x) - 50, my = (a.y + b.y) / 2 + sag;
        // 藤蔓不是電線：沿路一點起伏
        const wob = Math.sin(q * Math.PI * 3 + i) * 10 * Math.sin(q * Math.PI);
        pts.push({ x: iq * iq * a.x + 2 * iq * q * mx + q * q * b.x, y: iq * iq * a.y + 2 * iq * q * my + q * q * b.y + wob });
      }
      u.conn = mkPath(pts, 0, 0);
    });
  }

  /** 一段字拆成單位（中文一字、英文一個單字、♥），各自算骨架；words 有值就是歌詞（時間照字）。 */
  private addText(c: CanvasRenderingContext2D, text: string, size: number, x0: number, y: number, words: Word[], tOff: number, lyric = false, tIn = -Infinity) {
    c.font = font(FAM_V, size);
    let at = 0;
    for (const tk of tokens(text)) {
      const tt = tk.trimEnd();
      const x = x0 + c.measureText(text.slice(0, at)).width;
      at += tk.length;
      if (!tt) continue;
      // ♥ 另外處理（愛心的輪廓當藤蔓，長完填點綴色），標點黏著的愛心拆開
      const parts = tt.split(/(♥)/).filter(Boolean);
      let px = x;
      for (const part of parts) {
        const pw = c.measureText(part).width;
        const heart = part === '♥';
        let paths: Path[];
        if (heart) {
          const hp = heartPoints(60).map((q) => ({ x: px + pw / 2 + q.x * size * 0.38, y: y - size * 0.36 + q.y * size * 0.38 }));
          paths = [mkPath(hp, 0, 0)];
        } else paths = skeleton(part, FAM_V, size).map((p) => mkPath(p, px, y));
        const w0 = words[0];
        this.units.push({ text: part, x: px, y, size, paths, t0: w0 ? w0.start : 0, t1: w0 ? Math.max(w0.end, w0.start + 0.25) : 0, heart, guide: lyric, tIn, tOff, leaves: [] });
        px += pw;
      }
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start;
    let gust = 0;
    for (const b of this.bars) if (t >= b) { const a = t - b; gust += (1 - Math.exp(-a * 3)) * Math.exp(-a * 0.6); }
    this.wall.u.t!.value = t;
    this.wall.u.gust!.value = gust;
    this.wall.u.k!.value = clamp((t - s) / 0.3);
    this.wall.render(renderer, out);

    const lb = this.vine; lb.clear();
    const L = this.layer, c = L.ctx; L.clear();
    const vc: [number, number, number] = [LIN.sepia[0] * 0.8 + LIN.blood[0] * 0.2, LIN.sepia[1] * 0.8 + LIN.blood[1] * 0.2, LIN.sepia[2] * 0.8 + LIN.blood[2] * 0.2];
    const sh: [number, number, number] = LIN.sepia;
    const leafC: [number, number, number] = [LIN.signal[0] * 0.5 + LIN.blood[0] * 0.5, LIN.signal[1] * 0.5 + LIN.blood[1] * 0.5, LIN.signal[2] * 0.5 + LIN.blood[2] * 0.5];
    // 風：小節線上葉子翻一下
    let flut = 0;
    for (const b of this.bars) if (t >= b) { const a = t - b; flut += Math.sin(a * 9) * Math.exp(-a * 3); }
    const avoid: Rect[] = [];
    c.textBaseline = 'alphabetic';
    this.drawMain(t, gust, flut, vc, sh, leafC);
    for (const u of this.units) {
      // 歌詞一句一句換：上一句在下一句開始前淡掉，下一句（淡淡的鉛筆線）接著淡入
      const fade = (1 - clamp((t - u.tOff) / 0.4)) * clamp((t - u.tIn) / 0.3);
      if (fade <= 0) continue;
      const g = ease.outCubic(prog(t, u.t0, u.t1));
      // ---- 字本身：藤蔓爬過去，字就「長滿」（訊號色的暗部）；歌詞還沒唱是牆上淡淡的一層
      if (u.heart) {
        if (g >= 1) { const hp = u.paths[0]!.pts; const cx = hp.reduce((a, q) => a + q.x, 0) / hp.length, cy = hp.reduce((a, q) => a + q.y, 0) / hp.length; c.save(); c.globalAlpha = clamp((t - u.t1) / 0.3) * fade; drawHeart(c, cx, cy + u.size * 0.03, u.size * 0.72); c.restore(); }
      } else {
        const a0 = u.guide ? 0.15 : 0;
        const al = (a0 + (0.92 - a0) * g * g) * fade;
        if (al > 0.005) {
          c.font = font(FAM_V, u.size);
          // 長滿的字：墨色帶一點訊號色的暗部（淺色主題的紙上也夠深、讀得清楚）
          c.fillStyle = g > 0 ? mixRgba('sepia', 'blood', 0.45, al) : rgba('sepia', al);
          c.fillText(u.text, u.x, u.y);
        }
      }
      // ---- 字與字之間的藤蔓（在這個字開始長之前爬過來）
      if (u.conn) {
        const gc = ease.inOutCubic(prog(t, u.t0 - 0.28, u.t0 + 0.04));
        const p = u.conn, Lg = p.len * gc;
        for (let i = 1; i < p.pts.length && gc > 0; i++) {
          if (p.cum[i - 1]! > Lg) break;
          const a = p.pts[i - 1]!, q = p.pts[i]!;
          const uu = clamp((Lg - p.cum[i - 1]!) / Math.max(1e-3, p.cum[i]! - p.cum[i - 1]!));
          lb.seg2(a.x, a.y, lerp(a.x, q.x, uu), lerp(a.y, q.y, uu), 3.2 - 1.2 * (i / p.pts.length), vc, 0.9 * fade);
        }
        // 爬進來的藤蔓上兩片葉子（外框＋填色，跟字上的葉子一樣）
        for (const kf of [0.4, 0.75]) {
          const tl = u.t0 + kf * 0.1;
          if (gc < kf + 0.05 || t < tl) continue;
          let i = 1;
          while (i < p.pts.length - 1 && p.cum[i]! < p.len * kf) i++;
          const a = p.pts[i - 1]!, q = p.pts[i]!;
          const ang = Math.atan2(q.y - a.y, q.x - a.x) + (kf < 0.5 ? -1 : 1) * (1.0 + 0.2 * flut);
          const kk = ease.outBack(clamp((t - tl) / 0.26), 2.2) * fade;
          const Lf = 30 * kk, hw = 9 * kk, ca = Math.cos(ang), sa = Math.sin(ang);
          const P = (uu: number, v: number) => ({ x: a.x + ca * uu - sa * v, y: a.y + sa * uu + ca * v });
          const m0 = P(Lf * 0.32, 0), m1 = P(Lf * 0.7, 0);
          lb.seg2(m0.x, m0.y, m1.x, m1.y, hw * 1.5, leafC, 0.85 * fade);
          let qa = P(0, 0), qb = qa;
          for (let j = 1; j <= 5; j++) {
            const uu = j / 5, v = Math.sin(uu * Math.PI) * hw * (1 - 0.3 * uu);
            const na = P(Lf * uu, v), nb = P(Lf * uu, -v);
            lb.seg2(qa.x, qa.y, na.x, na.y, 1.2, sh, 0.75 * fade); lb.seg2(qb.x, qb.y, nb.x, nb.y, 1.2, sh, 0.75 * fade);
            qa = na; qb = nb;
          }
        }
      }
      if (g <= 0) continue;
      // ---- 藤蔓：沿著筆畫的中心線爬（細細的一條、有一道影子）
      const wv = Math.max(1.8, u.size * 0.042);
      let longest = 0;
      u.paths.forEach((p, i) => { if (p.len > u.paths[longest]!.len) longest = i; });
      u.paths.forEach((p, pi) => {
        const Lg = p.len * g;
        for (let i = 1; i < p.pts.length; i++) {
          if (p.cum[i - 1]! > Lg) break;
          const a = p.pts[i - 1]!, b = p.pts[i]!;
          const uu = clamp((Lg - p.cum[i - 1]!) / Math.max(1e-3, p.cum[i]! - p.cum[i - 1]!));
          const bx = lerp(a.x, b.x, uu), by = lerp(a.y, b.y, uu);
          const tip = clamp((Lg - p.cum[i]!) / 24 + 0.5, 0.5, 1);
          lb.seg2(a.x, a.y, bx, by, wv * tip, vc, 0.95 * fade);
        }
        // 正在長的尖端：訊號色的一點（唱到哪、長到哪）
        if (g < 1 && Lg > 1) {
          let i = 1;
          while (i < p.pts.length - 1 && p.cum[i]! < Lg) i++;
          const q = p.pts[i]!;
          lb.seg2(q.x, q.y, q.x + 0.1, q.y, wv * 2.2, LIN.blood, 0.45 * fade);
        }
        // 每個字最長的那一筆，長完尾端捲一個小鬚
        if (pi === longest && g >= 1 && p.pts.length > 3 && u.size >= 40) {
          const k = ease.outCubic(clamp((t - u.t1) / 0.5));
          const e0 = p.pts[p.pts.length - 1]!, e1 = p.pts[p.pts.length - 3]!;
          let ang = Math.atan2(e0.y - e1.y, e0.x - e1.x);
          const turn = hash(p.len, this.seed) < 0.5 ? 1 : -1;
          let px = e0.x, py = e0.y;
          const n = Math.floor(16 * k);
          for (let j = 0; j < n; j++) {
            const r = u.size * 0.045 * (1 - j / 18);
            ang += turn * 0.4;
            const nx = px + Math.cos(ang) * r, ny = py + Math.sin(ang) * r;
            lb.seg2(px, py, nx, ny, Math.max(1, wv * 0.7 * (1 - j / 18)), vc, 0.9 * fade);
            px = nx; py = ny;
          }
        }
      });
      // ---- 葉子（在拍點展開，往筆畫外側長）
      for (const lf of u.leaves) {
        if (t < lf.t) continue;
        const p = u.paths[lf.pi]!;
        if (lf.s > p.len * g) continue;
        let i = 1;
        while (i < p.pts.length - 1 && p.cum[i]! < lf.s) i++;
        const a = p.pts[i - 1]!, b = p.pts[i]!;
        const ang = Math.atan2(b.y - a.y, b.x - a.x) + lf.side * (0.95 + 0.25 * flut);
        const kk = ease.outBack(clamp((t - lf.t) / 0.26), 2.2) * fade;
        const Lf = lf.sz * 2.1 * kk, hw = lf.sz * 0.6 * kk;
        if (Lf < 1) continue;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const P = (uu: number, v: number) => ({ x: a.x + ca * uu - sa * v, y: a.y + sa * uu + ca * v });
        const m0 = P(Lf * 0.32, 0), m1 = P(Lf * 0.7, 0);
        lb.seg2(m0.x, m0.y, m1.x, m1.y, hw * 1.5, leafC, 0.85 * fade);
        let qa = P(0, 0), qb = qa;
        for (let j = 1; j <= 5; j++) {
          const uu = j / 5, v = Math.sin(uu * Math.PI) * hw * (1 - 0.3 * uu);
          const na = P(Lf * uu, v), nb = P(Lf * uu, -v);
          lb.seg2(qa.x, qa.y, na.x, na.y, 1.2, sh, 0.75 * fade); lb.seg2(qb.x, qb.y, nb.x, nb.y, 1.2, sh, 0.75 * fade);
          qa = na; qb = nb;
        }
      }
    }
    // 韓文原文副行：牆上的字，唱到的跟長滿的中文同一個顏色（淡兩成）、還沒唱是淡淡的鉛筆色；跟著那一句淡入淡出
    for (const sb of this.subs) {
      const fade = (1 - clamp((t - sb.tOff) / 0.4)) * clamp((t - sb.tIn) / 0.3);
      if (fade <= 0) continue;
      c.save(); c.translate(LYR.cx, sb.y);
      drawLyricSub(c, sb.line, t, { ...sb.st, sung: mixRgba('sepia', 'blood', 0.45, 0.92), unsung: rgba('sepia', 0.22) }, sb.size, fade);
      c.restore();
    }
    for (const u of this.units) if (t >= u.t0 && t >= u.tIn && t < u.tOff) avoid.push([Math.round(u.x), Math.round(u.y - u.size), Math.round(u.size), Math.round(u.size * 1.25)]);
    // 署名（手寫，最後淡入）
    if (this.sig && this.block && t > this.sig.t) {
      c.save();
      c.globalAlpha = clamp((t - this.sig.t) / 0.5);
      c.font = font(F.hand(700), this.block.sigSize); c.fillStyle = rgba('sepia', 0.72); c.textAlign = 'right';
      c.fillText(this.block.sig, this.sig.x, this.sig.y);
      c.restore();
    }
    // 有留言：歌詞是牆下緣的一行字
    if (this.mode === 'msg') {
      const ly = lyricAt(lyrics, t);
      if (ly) {
        const lay = layoutRows(c, ly.line, { family: F.archivo(100, 800), size: this.lyrSize, minSize: Math.min(V2.lyrMin, this.lyrSize), maxW: SUB.maxW, maxRows: 2, lineHeight: 1.12 });
        c.save();
        c.translate(SUB.x, SUB.base - (lay.rows.length - 1) * lay.lineHeight);
        drawRows(c, lay, F.archivo(100, 800), t, paperInk(), ly.k);
        c.restore();
      }
    }
    // 字（Canvas）在下、藤蔓與葉子（LineBatch）爬在字上面
    comp.draw(renderer, L.upload(), out);
    lb.render(renderer, out);
    return { paper: 1, bloom: 0.25, vignette: 0.4, zoom: 1 + 0.03 * ease.inOutCubic(f.p), popupAvoid: avoid.length ? [bboxR(avoid)] : [] };
  }

  /** 葉子（在拍點展開）：a 是葉柄，ang 方向，sz 大小，k 展開的程度。 */
  private leaf(a: Pt, ang: number, sz: number, k: number, leafC: [number, number, number], sh: [number, number, number], alpha = 1) {
    const lb = this.vine;
    const Lf = sz * 2.1 * k, hw = sz * 0.6 * k;
    if (Lf < 1) return;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const P = (uu: number, v: number) => ({ x: a.x + ca * uu - sa * v, y: a.y + sa * uu + ca * v });
    const m0 = P(Lf * 0.32, 0), m1 = P(Lf * 0.7, 0);
    lb.seg2(m0.x, m0.y, m1.x, m1.y, hw * 1.5, leafC, 0.85 * alpha);
    let qa = P(0, 0), qb = qa;
    for (let j = 1; j <= 5; j++) {
      const uu = j / 5, v = Math.sin(uu * Math.PI) * hw * (1 - 0.3 * uu);
      const na = P(Lf * uu, v), nb = P(Lf * uu, -v);
      lb.seg2(qa.x, qa.y, na.x, na.y, 1.2, sh, 0.75 * alpha); lb.seg2(qb.x, qb.y, nb.x, nb.y, 1.2, sh, 0.75 * alpha);
      qa = na; qb = nb;
    }
  }

  /** 小花（五瓣，特別色＋墨線）：小節線上開。 */
  private flower(x: number, y: number, k: number, sh: [number, number, number]) {
    const lb = this.vine, r = 11 * k;
    if (r < 0.5) return;
    const spot: [number, number, number] = [LIN.paper[0] * 0.35 + LIN.signal[0] * 0.65, LIN.paper[1] * 0.35 + LIN.signal[1] * 0.65, LIN.paper[2] * 0.35 + LIN.signal[2] * 0.65];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3, ca = Math.cos(a), sa = Math.sin(a);
      lb.seg2(x + ca * r * 0.45, y + sa * r * 0.45, x + ca * r, y + sa * r, r * 0.95, spot, 0.95);
    }
    lb.seg2(x, y, x + 0.1, y, r * 0.55, LIN.blood, 0.9);
    lb.seg2(x, y, x + 0.1, y, r * 0.2, sh, 0.8);
  }

  /** 路徑上長度 sPos 的點與切線角。 */
  private at(p: Path, sPos: number): { q: Pt; ang: number } {
    let i = 1;
    while (i < p.pts.length - 1 && p.cum[i]! < sPos) i++;
    const a = p.pts[i - 1]!, b = p.pts[i]!;
    const u = clamp((sPos - p.cum[i - 1]!) / Math.max(1e-3, p.cum[i]! - p.cum[i - 1]!));
    return { q: { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) }, ang: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  /**
   * 主藤（從左邊牆腳爬上來、沿牆頂橫過去，越往前越細）、垂下來的鬚（小節線上被風吹得晃）、葉子與小花。
   * 主藤是畫面的主視覺：一直在長、在晃、在開花。
   */
  private drawMain(t: number, gust: number, flut: number, vc: [number, number, number], sh: [number, number, number], leafC: [number, number, number]) {
    const lb = this.vine, M = this.main;
    const g = ease.outCubic(prog(t, this.mainT0, this.mainT1));
    if (g <= 0) return;
    const Lg = M.len * g;
    for (let i = 1; i < M.pts.length; i++) {
      if (M.cum[i - 1]! > Lg) break;
      const a = M.pts[i - 1]!, b = M.pts[i]!;
      const uu = clamp((Lg - M.cum[i - 1]!) / Math.max(1e-3, M.cum[i]! - M.cum[i - 1]!));
      const w = lerp(7, 2.6, M.cum[i]! / M.len) * clamp((Lg - M.cum[i]!) / 40 + 0.5, 0.5, 1);
      lb.seg2(a.x + 4, a.y + 7, lerp(a.x, b.x, uu) + 4, lerp(a.y, b.y, uu) + 7, w + 1.5, sh, 0.08);
      lb.seg2(a.x, a.y, lerp(a.x, b.x, uu), lerp(a.y, b.y, uu), w, vc, 0.95);
    }
    for (const lf of this.mainLeaves) {
      if (t < lf.t || lf.s > Lg) continue;
      const { q, ang } = this.at(M, lf.s);
      this.leaf(q, ang + lf.side * (1.0 + 0.2 * flut), lf.sz, ease.outBack(clamp((t - lf.t) / 0.26), 2.2), leafC, sh);
    }
    // 垂下來的鬚：往下長，末端被風吹得往右擺（小節線上的風），平常很慢地晃
    const hangPts: Pt[][] = [];
    this.hangs.forEach((h, hi) => {
      const gh = ease.outCubic(prog(t, h.t0, h.t0 + 1.1));
      if (gh <= 0 || h.s > Lg) { hangPts.push([]); return; }
      const root = this.at(M, h.s).q;
      const pts: Pt[] = [];
      const n = 14, len = h.len * gh;
      for (let k = 0; k <= n; k++) {
        const u = k / n, dy = u * len;
        const sway = (gust * 36 + 10 * Math.sin(t * 0.9 + h.ph)) * Math.pow(u, 1.6) * (len / 300);
        pts.push({ x: root.x + sway + 14 * Math.sin(u * 3 + h.ph), y: root.y + dy });
      }
      hangPts.push(pts);
      for (let k = 1; k <= n; k++) lb.seg2(pts[k - 1]!.x, pts[k - 1]!.y, pts[k]!.x, pts[k]!.y, lerp(2.4, 1.2, k / n), vc, 0.9);
      const hp = mkPath(pts, 0, 0);
      for (const lf of h.leaves) {
        if (t < lf.t || lf.s > hp.len) continue;
        const { q, ang } = this.at(hp, lf.s);
        this.leaf(q, ang + lf.side * (1.1 + 0.25 * flut), lf.sz, ease.outBack(clamp((t - lf.t) / 0.26), 2.2), leafC, sh);
      }
      void hi;
    });
    // 小花：小節線上「啵」一下開（outBack）
    for (const bl of this.blooms) {
      if (t < bl.t) continue;
      const k = ease.outBack(clamp((t - bl.t) / 0.3), 2.4);
      let q: Pt | null = null;
      if (bl.on === 'main') { if (bl.s <= Lg) q = this.at(M, bl.s).q; }
      else { const pts = hangPts[bl.on]; if (pts && pts.length) { const hp = mkPath(pts, 0, 0); if (bl.s <= hp.len) q = this.at(hp, bl.s).q; } }
      if (q) this.flower(q.x + 6, q.y + 4, k, sh);
    }
  }
}

function bboxR(rs: Rect[]): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y, w, h] of rs) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h); }
  return [x0, y0, x1 - x0, y1 - y0];
}
