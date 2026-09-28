// 混音台（批次 T10・機器 D，暗）：從正上方拍一張大型類比混音台的特寫，十六軌推桿一字排開，右邊是主控區的兩個指針錶。
//  - 歌詞在推桿的推頭上：一行歌詞載入時，每個字（英文一個字，佔好幾軌連動）印在一軌的推頭上、推桿全部在底下（還沒唱，三成亮）；
//    唱到哪個字，那一軌的電動推桿就「刷」地推到頂（0 dB）、推頭亮成訊號色；唱完停在頂上變紙白。唱完的字在上排排成一行、
//    沒唱的在下排等著。一行唱完，推桿一起落回底下（電動推桿的場景記憶），換下一行。
//  - 沒有用到的軌、兩句之間、純音樂：推桿與電平表跟著這首歌的頻段自己動（大鼓、小鼓、貝斯、人聲…各一軌，心跳那一軌打在大鼓上）。
//  - 最底下是一條貼滿整排的紙膠帶，用麥克筆寫著每一軌的名字（大鼓、小鼓…宣文、孟庭、芃芃、QQ、掌聲、心跳）。
//  - 主打留言也寫在紙膠帶上：窗格一開始，一段膠帶從左拉到右貼在混音台上面的空白處，一個詞組一拍用麥克筆寫上去，最後署名。
//    沒有留言：膠帶上寫邀請。
//  - 右邊主控區：兩個打著背光的指針錶（跟著音量甩）、主推桿。
// 手法：金屬面板一個 shader；不會變的刻度、推桿槽、名字膠帶、錶面畫一次；推頭、字、旋鈕指針、膠帶上的字每格重畫；
// 電平表的燈用 LineBatch（加亮）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba, LIN } from '../engine/palette';
import { clamp, ease, prog, pulse, hash, lerp, mulberry32 } from '../engine/util';
import { Lyrics, type Line, type Word } from '../engine/lyrics';
import type { FitResult } from '../engine/text';
import { layoutMessage, signature, beatAfter } from './_motifs';
import { drawReveal, phraseSchedule, revealAt, fitCharsF, windowLines, type Rect } from './_t10';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: false, energy: [0.35, 1], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 版面（邏輯像素，y 向下）
const N = 16; // 軌數
const X0 = 112, PITCH = 77; // 第一軌左緣、軌距（十六軌到 x = 1344）
const chX = (i: number) => X0 + i * PITCH; // 第 i 軌左緣
const TAPE = { x: 118, y: 108, maxW: 1220, maxH: 236 }; // 留言膠帶（上面的空白處）
const KNOB_Y = 386, KNOB_R = 18;
const METER = { y0: 422, y1: 566, n: 12 }; // 電平表（上到下）
const SLOT = { y0: 596, y1: 902 }; // 推桿槽
const CAP = { h: 84, top: 638, bot: 860 }; // 推頭（中心 y：頂 = 0 dB、底 = -∞）
const NAMES_Y = 940; // 名字膠帶的中線
const MASTER = { x0: 1392, x1: 1832 }; // 主控區
const VU = [{ x: 1404, y: 112, w: 202, h: 168 }, { x: 1622, y: 112, w: 202, h: 168 }];
const MF = [{ x: 1470, label: 'MAIN' }, { x: 1570, label: 'LOVE' }]; // 主控推桿（槽的中心 x）
const MF_Y = { y0: 400, y1: 800 };
const LYR_SIZE = 54;
const F_LYR = F.archivo(100, 800);

/** 每一軌的名字（麥克筆寫在膠帶上）與閒置時跟著哪個頻段。 */
const CHANNELS: { name: string; band: string; hit?: string }[] = [
  { name: '大鼓', band: 'low', hit: 'kick' }, { name: '小鼓', band: 'drums', hit: 'snare' }, { name: '腳踏鈸', band: 'high', hit: 'hat' },
  { name: '貝斯', band: 'bass' }, { name: '吉他', band: 'other' }, { name: '鋼琴', band: 'mid' }, { name: '弦樂', band: 'other' },
  { name: '人聲', band: 'vocal' }, { name: '和聲', band: 'vocal' }, { name: '宣文', band: 'vocal' }, { name: '孟庭', band: 'vocal' },
  { name: '芃芃', band: 'high', hit: 'hat' }, { name: 'QQ', band: 'drums', hit: 'snare' }, { name: '掌聲', band: 'high' },
  { name: '乾杯', band: 'mid', hit: 'snare' }, { name: '心跳', band: 'low', hit: 'kick' },
];
const INVITE = '掃描右下角 QR code，你的祝福也貼上混音台。';
const TEXT = `${CHANNELS.map((c) => c.name).join('')}${INVITE}主控今晚的混音`;

// ---------------------------------------------------------------- 金屬面板
const BG = () => new FSPass(/* glsl */ `
  uniform float t; uniform float sweep; uniform float k;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 髮絲紋：沿 x 拉長的雜訊
    float br = 0.55 * snoise(vec2(p.x * 0.003, p.y * 0.8)) + 0.3 * snoise(vec2(p.x * 0.012, p.y * 2.7)) + 0.15 * snoise(vec2(p.x * 0.05, p.y * 5.1));
    vec3 col = mix(C_INK, C_INK2 * 1.35, 0.6 + 0.12 * br);
    // 左上一盞燈
    col *= 0.78 + 0.34 * (1.0 - smoothstep(0.0, 1.0, length((p - vec2(420.0, 160.0)) / vec2(2100.0, 1300.0))));
    // 主控區是另一塊板子，顏色深一點
    col *= mix(1.0, 0.82, step(${MASTER.x0 - 12}.0, p.x));
    // 小節線上一道斜斜的反光掃過面板
    float d = (p.x + p.y * 0.55) - sweep;
    col += C_BONE * 0.035 * exp(-d * d / 9000.0) * (0.6 + 0.4 * br);
    fragColor = vec4(col * k, 1.0);
  }`, { t: { value: 0 }, sweep: { value: -9999 }, k: { value: 1 } });

interface Slot { word: Word; text: string; c0: number; c1: number }
interface Page { slots: Slot[]; tLoad: number; tEnd: number; line: Line }

export default class Mixer extends Scene {
  bg = shared('mixer.bg', BG);
  /** 不會變的：分軌線、刻度、推桿槽、名字膠帶、錶面、主控區（畫一次）。 */
  base = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 每格重畫：推頭與字、旋鈕指針、錶的指針、留言膠帶。 */
  dyn = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 正在唱的字的光暈（半解析度，加亮）。 */
  hot = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  leds = this.track(new LineBatch(1200, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  fit!: FitResult;
  body = '';
  sched: { t: number; chars: number }[] = [];
  tapeW = 600; tapeH = 150;
  pages: Page[] = [];
  tFirst = 0; tTape = 0; beat = 0.5;
  seed = 1;
  avoid: Rect[] = [];
  private baseUp = false;

  override async init() {
    const { audio: au, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.seed = ((this.ctx.params.seed ?? 1) * 977 + (m?.id ?? 0) * 31) >>> 0;
    this.body = m ? m.text : INVITE;
    const lines = windowLines(lyrics, s, e);
    await loadText(`${TEXT}${this.body}${m ? signature(m.name) : ''}${lines.map((l) => l.text).join('')}`);
    const c = this.dyn.ctx;
    this.beat = au.beatPeriod(s + 0.1);
    // ---- 留言膠帶：字排好，膠帶照字的大小裁
    this.fit = layoutMessage(c, this.body, F.hand(700), TAPE.maxW - 110, TAPE.maxH - (m ? 84 : 50), { min: 44, max: 84, lineHeight: 1.22, maxLines: 3 });
    c.font = font(F.hand(700), 32);
    const sigW = m ? c.measureText(signature(m.name)).width : 0;
    this.tapeW = Math.min(TAPE.maxW, Math.max(this.fit.width, sigW + 40) + 110);
    this.tapeH = this.fit.height + (m ? 84 : 50);
    this.tFirst = beatAfter(au, s + 0.3);
    this.tTape = this.tFirst;
    this.sched = phraseSchedule(au, this.body, this.tFirst, Math.min(8 * this.beat, 0.45 * (e - s)), 4);
    // ---- 歌詞分頁
    this.pages = this.buildPages(lines, s, e);
    this.drawBase();
    // 即時小卡避開：膠帶、推桿區（歌詞）
    this.avoid = [
      [TAPE.x - 16, TAPE.y - 16, this.tapeW + 40, this.tapeH + 36],
      [X0 - 12, CAP.top - CAP.h / 2 - 16, N * PITCH + 24, CAP.bot - CAP.top + CAP.h + 32],
    ];
  }

  // ---------------------------------------------------------------- 歌詞 → 推頭
  /** 每一行歌詞排到推頭上：一個字（英文一個字）佔幾軌，放不下十六軌就分頁；一頁置中。 */
  private buildPages(lines: Line[], s: number, e: number): Page[] {
    const c = this.dyn.ctx;
    c.font = font(F_LYR, LYR_SIZE);
    const out: Page[] = [];
    for (const line of lines) {
      const items = line.words.map((w) => {
        // 推頭上不印句讀（佔一整軌太浪費）；只有標點的字就不上推頭
        const text = w.w.replace(/[，。、！？；：,.!?;:…~～「」『』（）()"'“”‘’]+/gu, '').trim();
        const k = text ? Math.max(1, Math.ceil((c.measureText(text).width + 20) / PITCH)) : 0;
        return { w, text, k };
      }).filter((x) => x.k > 0 && x.k <= N);
      if (!items.length) continue;
      // 分頁：總軌數超過 16 就平均切成幾頁
      const total = items.reduce((a, x) => a + x.k, 0);
      const np = Math.ceil(total / N);
      const target = total / np;
      const groups: (typeof items)[] = [[]];
      let acc = 0;
      for (const it of items) {
        const g = groups[groups.length - 1]!;
        if (g.length && (acc + it.k > N || (acc + it.k / 2 > target && groups.length < np))) { groups.push([it]); acc = it.k; }
        else { g.push(it); acc += it.k; }
      }
      for (const g of groups) {
        const used = g.reduce((a, x) => a + x.k, 0);
        let ch = Math.floor((N - used) / 2);
        const slots: Slot[] = g.map((x) => { const sl = { word: x.w, text: x.text, c0: ch, c1: ch + x.k - 1 }; ch += x.k; return sl; });
        const first = g[0]!.w.start, last = g[g.length - 1]!.w.end;
        out.push({ slots, line, tLoad: first - 0.45, tEnd: last + 1.1 });
      }
    }
    // 頁與頁不重疊：前一頁最晚在下一頁載入前結束（落下來要 0.22 秒）；窗格邊界
    for (let i = 0; i < out.length; i++) {
      const p = out[i]!, nx = out[i + 1];
      if (nx) p.tEnd = Math.min(p.tEnd, nx.tLoad);
      if (i > 0) p.tLoad = Math.max(p.tLoad, out[i - 1]!.tEnd);
      p.tLoad = Math.max(p.tLoad, s - 0.5);
      p.tEnd = Math.min(p.tEnd, e + 1);
    }
    return out.filter((p) => p.tEnd - p.tLoad > 0.3);
  }

  private pageAt(t: number): Page | null {
    for (const p of this.pages) if (t >= p.tLoad && t < p.tEnd) return p;
    return null;
  }

  /** 閒置的推桿：跟著自己的頻段（取最近 0.16 秒的平均，推桿有慣性，不會抖）。 */
  private idleLevel(ch: number, t: number): number {
    const au = this.ctx.audio, cd = CHANNELS[ch]!;
    let v = 0;
    for (let k = 0; k < 6; k++) v += au.env(cd.band, t - k * 0.032);
    v /= 6;
    const h = cd.hit ? au.hit(cd.hit, t, 0.18) : 0;
    return clamp(0.1 + 0.55 * v + 0.25 * h + 0.04 * Math.sin(t * 1.3 + ch * 1.7));
  }

  /** 這一頁裡某一軌的「字的位置」：還沒唱在底（0），唱到的那一刻推上去（0.2 秒），唱完停在頂（1）。 */
  private sungLevel(sl: Slot, t: number): number {
    const r = prog(t, sl.word.start, sl.word.start + Math.min(0.2, Math.max(0.08, sl.word.end - sl.word.start)), ease.outExpo);
    // 推到頂會稍微衝過頭再回來（電動推桿的彈簧）
    const over = 0.035 * Math.sin(Math.PI * prog(t, sl.word.start + 0.12, sl.word.start + 0.42));
    return r + (r >= 0.999 ? over : 0);
  }

  /**
   * 第 ch 軌的推桿位置（0 = 底、1 = 頂）與推頭上的字（沒有字是 null）。純函數：從時間算，不靠上一格。
   */
  private level(ch: number, t: number): { v: number; slot: Slot | null; a: number } {
    const p = this.pageAt(t);
    if (!p) return { v: this.idleLevel(ch, t), slot: null, a: 0 };
    const sl = p.slots.find((x) => ch >= x.c0 && ch <= x.c1) ?? null;
    const base = (tt: number) => (sl ? this.sungLevel(sl, tt) : this.idleLevel(ch, tt));
    // 載入：從閒置的位置落到底（0.22 秒）
    const kin = prog(t, p.tLoad, p.tLoad + 0.22, ease.outExpo);
    // 結束：全部落回底下（0.22 秒）
    const kout = prog(t, p.tEnd - 0.22, p.tEnd, ease.outExpo);
    let v = base(t);
    if (sl && kin < 1) v = lerp(this.idleLevel(ch, p.tLoad), v, kin);
    if (sl && kout > 0) v = base(p.tEnd - 0.22) * (1 - kout);
    const a = sl ? prog(t, p.tLoad + 0.05, p.tLoad + 0.2) * (1 - prog(t, p.tEnd - 0.2, p.tEnd - 0.05)) : 0;
    return { v, slot: sl, a };
  }

  /** 電平（0..1）：正在唱的軌跟著人聲，其他照自己的頻段。 */
  private meter(ch: number, t: number, slot: Slot | null): number {
    const au = this.ctx.audio;
    if (slot) {
      const p = Lyrics.wordProgress(slot.word, t);
      if (p > 0 && p < 1) return clamp(0.55 + 0.45 * au.env('vocal', t) + 0.2 * au.hit('vocal', t, 0.15));
      if (p >= 1) return clamp(0.25 + 0.4 * au.env('vocal', t));
    }
    const cd = CHANNELS[ch]!;
    // 閒置的軌燈暗一點、少一點（MV 原則：背景要能呼吸，亮的只有正在唱的那一軌）
    return clamp(0.05 + 0.55 * au.env(cd.band, t) + 0.25 * (cd.hit ? au.hit(cd.hit, t, 0.12) : 0));
  }

  // ---------------------------------------------------------------- 不會變的東西
  private drawBase() {
    const L = this.base, c = L.ctx;
    L.clear();
    // 分軌的溝
    for (let i = 0; i <= N; i++) {
      const x = chX(i) - 0.5;
      c.fillStyle = rgba('ink', 0.7); c.fillRect(x - 1, 360, 2, 620);
      c.fillStyle = rgba('bone', 0.05); c.fillRect(x + 1, 360, 1, 620);
    }
    for (let i = 0; i < N; i++) {
      const cx = chX(i) + PITCH / 2;
      // 旋鈕的底座（指針每格畫）
      c.fillStyle = rgba('ink', 0.8); c.beginPath(); c.arc(cx + 2, KNOB_Y + 3, KNOB_R + 1, 0, Math.PI * 2); c.fill();
      const g = c.createRadialGradient(cx - 6, KNOB_Y - 6, 2, cx, KNOB_Y, KNOB_R);
      g.addColorStop(0, mixRgba('graphite', 'ash', 0.35)); g.addColorStop(1, mixRgba('ink2', 'graphite', 0.35));
      c.fillStyle = g; c.beginPath(); c.arc(cx, KNOB_Y, KNOB_R, 0, Math.PI * 2); c.fill();
      // 電平表：還沒亮的格子
      const segH = (METER.y1 - METER.y0) / METER.n;
      for (let k = 0; k < METER.n; k++) {
        c.fillStyle = rgba('bone', 0.06);
        c.fillRect(cx - 9, METER.y1 - (k + 1) * segH + 2, 18, segH - 4);
      }
      // 推桿槽＋刻度
      c.fillStyle = rgba('ink', 0.95); c.fillRect(cx - 3, SLOT.y0, 6, SLOT.y1 - SLOT.y0);
      c.fillStyle = rgba('bone', 0.08); c.fillRect(cx + 3, SLOT.y0, 1, SLOT.y1 - SLOT.y0);
      for (let k = 0; k <= 10; k++) {
        const y = lerp(CAP.top, CAP.bot, k / 10);
        c.fillStyle = rgba('bone', k === 0 ? 0.55 : 0.22);
        c.fillRect(cx - 30, y, k % 5 ? 7 : 12, 1);
        c.fillRect(cx + 30 - (k % 5 ? 7 : 12), y, k % 5 ? 7 : 12, 1);
      }
    }
    c.textAlign = 'left';
    // 名字膠帶（整排一條）
    const tapeY = NAMES_Y - 22;
    this.tapeStrip(c, X0 - 6, tapeY, N * PITCH + 12, 44, 7);
    c.font = font(F.hand(700), 22); c.fillStyle = rgba('ink', 0.62); c.textAlign = 'center';
    CHANNELS.forEach((cd, i) => {
      const r = mulberry32(this.seed + i * 13);
      c.save(); c.translate(chX(i) + PITCH / 2, NAMES_Y + 8); c.rotate((r() - 0.5) * 0.08);
      c.fillText(cd.name, 0, 0);
      c.restore();
    });
    c.textAlign = 'left';

    // ---- 主控區
    c.fillStyle = rgba('ink', 0.7); c.fillRect(MASTER.x0 - 13, 96, 2, 890);
    for (const v of VU) {
      // 打背光的錶面
      c.fillStyle = rgba('ink', 0.9); c.fillRect(v.x - 6, v.y - 6, v.w + 12, v.h + 12);
      const g = c.createRadialGradient(v.x + v.w / 2, v.y + v.h, 20, v.x + v.w / 2, v.y + v.h * 0.6, v.w * 0.8);
      g.addColorStop(0, mixRgba('paper', 'signal', 0.35)); g.addColorStop(1, mixRgba('paper', 'blood', 0.35));
      c.fillStyle = g; c.fillRect(v.x, v.y, v.w, v.h);
      // 刻度弧
      const px = v.x + v.w / 2, py = v.y + v.h + 40, R = v.h * 0.82;
      c.strokeStyle = rgba('sepia', 0.85); c.lineWidth = 1.5;
      c.beginPath(); c.arc(px, py, R, -Math.PI / 2 - 0.8, -Math.PI / 2 + 0.8); c.stroke();
      c.strokeStyle = rgba('blood', 0.9); c.lineWidth = 5;
      c.beginPath(); c.arc(px, py, R - 3, -Math.PI / 2 + 0.36, -Math.PI / 2 + 0.8); c.stroke();
      for (let k = 0; k <= 10; k++) {
        const a = -Math.PI / 2 - 0.8 + (k / 10) * 1.6, l = k % 5 ? 8 : 14;
        c.strokeStyle = rgba('sepia', 0.85); c.lineWidth = k % 5 ? 1 : 1.6;
        c.beginPath(); c.moveTo(px + Math.cos(a) * R, py + Math.sin(a) * R); c.lineTo(px + Math.cos(a) * (R + l), py + Math.sin(a) * (R + l)); c.stroke();
      }
      c.font = font(F.serif(600), 26); c.fillStyle = rgba('sepia', 0.85); c.textAlign = 'center';
      c.fillText('VU', px, v.y + v.h - 30);
      c.font = font(F.mono(500), 11); c.fillStyle = rgba('sepia', 0.7);
      c.fillText('-20', px + Math.cos(-Math.PI / 2 - 0.8) * (R + 26), py + Math.sin(-Math.PI / 2 - 0.8) * (R + 26));
      c.fillText('0', px + Math.cos(-Math.PI / 2 + 0.36) * (R + 24), py + Math.sin(-Math.PI / 2 + 0.36) * (R + 24));
      c.fillText('+3', px + Math.cos(-Math.PI / 2 + 0.8) * (R + 26), py + Math.sin(-Math.PI / 2 + 0.8) * (R + 26));
      c.textAlign = 'left';
    }
    for (const mf of MF) {
      c.fillStyle = rgba('ink', 0.95); c.fillRect(mf.x - 3, MF_Y.y0, 6, MF_Y.y1 - MF_Y.y0);
      for (let k = 0; k <= 10; k++) { c.fillStyle = rgba('bone', 0.22); c.fillRect(mf.x - 28, lerp(MF_Y.y0 + 30, MF_Y.y1 - 30, k / 10), 10, 1); }
    }
  }

  /** 一段紙膠帶（麥克筆寫字的那種）：紙色、縐紋、撕開的兩端。 */
  private tapeStrip(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number) {
    const r = mulberry32(seed);
    c.save();
    c.beginPath();
    // 撕開的兩端：鋸齒
    c.moveTo(x, y);
    c.lineTo(x + w, y);
    for (let yy = y; yy < y + h; yy += 5) c.lineTo(x + w + (r() - 0.5) * 7, yy + 2.5);
    c.lineTo(x + w, y + h);
    c.lineTo(x, y + h);
    for (let yy = y + h; yy > y; yy -= 5) c.lineTo(x + (r() - 0.5) * 7, yy - 2.5);
    c.closePath();
    c.fillStyle = rgba('ink', 0.5);
    c.save(); c.translate(2, 3); c.fill(); c.restore();
    c.fillStyle = mixRgba('paper', 'ash', 0.22); c.fill();
    c.clip();
    // 縐紋：細細的橫線
    for (let yy = y + 1; yy < y + h; yy += 2.5) { c.fillStyle = rgba('sepia', 0.02 + 0.05 * r()); c.fillRect(x - 6, yy, w + 12, 1); }
    for (let k = 0; k < w / 6; k++) { c.fillStyle = rgba('sepia', 0.03 * r()); c.fillRect(x + r() * w, y, 1, h); }
    // 上下緣暗一點（膠帶的厚度）
    c.fillStyle = rgba('sepia', 0.14); c.fillRect(x - 6, y, w + 12, 2); c.fillRect(x - 6, y + h - 2, w + 12, 2);
    c.restore();
  }

  // ---------------------------------------------------------------- 每一格
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const fadeIn = prog(t, s, s + 0.25), exit = prog(t, e - 0.3, e, ease.inCubic);
    // 反光：每個小節線從左上掃到右下
    const bt = au.timeOfBar(Math.floor(au.barAt(t) + 1e-6));
    this.bg.u.sweep!.value = lerp(-400, 2800, prog(t, bt, bt + 0.9, ease.outCubic));
    this.bg.u.k!.value = 0.6 + 0.4 * fadeIn;
    this.bg.render(renderer, out);
    if (!this.baseUp) { this.base.upload(); this.baseUp = true; }
    comp.draw(renderer, this.base.texture, out, { opacity: fadeIn * (1 - exit) });

    const L = this.dyn, c = L.ctx, HL = this.hot, hc = HL.ctx;
    L.clear(); HL.clear();
    c.globalAlpha = hc.globalAlpha = 1 - exit;
    this.leds.clear();
    let hotAny = false;

    // ---- 十六軌
    const segH = (METER.y1 - METER.y0) / METER.n;
    const drawn = new Set<Slot>();
    for (let i = 0; i < N; i++) {
      const cx = chX(i) + PITCH / 2;
      const { v, slot, a } = this.level(i, t);
      // 旋鈕指針：跟著電平慢慢轉
      const kv = clamp(0.3 + 0.5 * au.env(CHANNELS[i]!.band, t - 0.2));
      const ka = Math.PI * 0.75 + kv * Math.PI * 1.5;
      c.strokeStyle = rgba('bone', 0.85); c.lineWidth = 2.5; c.lineCap = 'round';
      c.beginPath(); c.moveTo(cx + Math.cos(ka) * 5, KNOB_Y + Math.sin(ka) * 5); c.lineTo(cx + Math.cos(ka) * (KNOB_R - 3), KNOB_Y + Math.sin(ka) * (KNOB_R - 3)); c.stroke();
      // 電平表（燈用 LineBatch 加亮）
      const lv = this.meter(i, t, slot);
      const nOn = Math.round(lv * METER.n * fadeIn * (1 - exit));
      for (let k = 0; k < nOn; k++) {
        const y = METER.y1 - (k + 0.5) * segH;
        const hot = k >= METER.n - 2 ? LIN.ember : k >= METER.n - 5 ? LIN.signal : LIN.blood;
        const I = (k >= METER.n - 5 ? 1.5 : 1.1) * (slot ? 1 : 0.6);
        this.leds.seg2(cx - 7, y, cx + 7, y, segH - 5, [hot[0] * I, hot[1] * I, hot[2] * I], 1);
      }
      // 推頭：有字的軌由那個字畫（連動的幾軌畫成一顆寬推頭），沒字的每軌畫自己的
      if (slot) {
        if (drawn.has(slot)) continue;
        drawn.add(slot);
        hotAny = this.drawCap(c, hc, slot, v, a, t) || hotAny;
      } else {
        this.capBody(c, cx - 32, this.capY(v), 64, false, 0);
      }
    }

    // ---- 主控區：錶的指針、主推桿
    for (const [j, vu] of VU.entries()) {
      let lv = 0;
      for (let k = 0; k < 10; k++) lv += au.env(j ? 'high' : 'low', t - k * 0.03) * 0.5 + au.env('rms', t - k * 0.03) * 0.5;
      lv = clamp(lv / 10 * 1.25 + 0.05 * Math.sin(t * 2 + j));
      const px = vu.x + vu.w / 2, py = vu.y + vu.h + 40, a = -Math.PI / 2 - 0.8 + lv * 1.6;
      c.save();
      c.beginPath(); c.rect(vu.x, vu.y, vu.w, vu.h); c.clip();
      c.strokeStyle = rgba('ink', 0.9); c.lineWidth = 2;
      c.beginPath(); c.moveTo(px, py); c.lineTo(px + Math.cos(a) * vu.h * 0.95, py + Math.sin(a) * vu.h * 0.95); c.stroke();
      c.restore();
    }
    for (const [j, mf] of MF.entries()) {
      const mv = clamp(0.72 + 0.1 * au.energyAt(t) + (j ? 0.06 * Math.sin(t * 0.7) : 0));
      const y = lerp(MF_Y.y1 - 30, MF_Y.y0 + 30, mv);
      this.capBody(c, mf.x - 30, y, 60, false, 0);
    }

    // ---- 留言膠帶
    this.drawTape(c, t);

    comp.draw(renderer, L.upload(), out);
    if (hotAny) comp.draw(renderer, HL.upload(), out, { mode: 'add', tint: [1.6, 1.6, 1.6] });
    if (this.leds.count) this.leds.render(renderer, out);
    const beatHit = pulse(t, au.timeOfBeat(Math.floor(au.beatAt(t) + 1e-6)), 0.15);
    // 鏡頭：整段慢慢推近（緩進緩出），拍點上輕輕一震
    return { bloom: 0.7, vignette: 0.5, halation: 0.2, zoom: 1.0 + 0.04 * ease.inOutCubic(f.p) + 0.004 * beatHit, popupAvoid: this.avoid };
  }

  private capY(v: number) { return lerp(CAP.bot, CAP.top, clamp(v, 0, 1.08)); }

  /** 推頭本體：深色塑膠、中間一條白線；lit = 正在唱（頂上一條訊號色的燈）。 */
  private capBody(c: CanvasRenderingContext2D, x: number, cy: number, w: number, lit: boolean, glow: number) {
    const h = CAP.h, y = cy - h / 2;
    c.fillStyle = rgba('ink', 0.6); c.fillRect(x + 4, y + 8, w, h);
    const g = c.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, mixRgba('graphite', 'ash', 0.25)); g.addColorStop(0.45, mixRgba('ink2', 'graphite', 0.55)); g.addColorStop(1, rgba('ink2'));
    c.fillStyle = g; c.fillRect(x, y, w, h);
    c.fillStyle = rgba('bone', 0.12); c.fillRect(x, y, w, 2);
    // 中線：沒字的推頭才畫（有字的推頭，字就是中線）
    if (!lit && glow <= 0) { c.fillStyle = rgba('bone', 0.8); c.fillRect(x + 6, cy - 1.5, w - 12, 3); }
    if (lit) { c.fillStyle = rgba('signal', 0.95); c.fillRect(x, y, w, 4); }
  }

  /** 有字的推頭（可能連動好幾軌）：畫推頭、印字（逐字跟唱的顏色），正在唱的另外畫到光暈層。 */
  private drawCap(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, sl: Slot, v: number, a: number, t: number): boolean {
    const x = chX(sl.c0) + 6, w = (sl.c1 - sl.c0 + 1) * PITCH - 12;
    const cy = this.capY(v);
    const p = Lyrics.wordProgress(sl.word, t);
    const singing = p > 0 && p < 1;
    this.capBody(c, x, cy, w, singing, a);
    if (a <= 0.01) return false;
    c.save();
    c.globalAlpha *= a;
    c.font = font(F_LYR, LYR_SIZE); c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    const tx = x + w / 2, ty = cy + LYR_SIZE * 0.36;
    // 逐字跟唱：還沒唱三成、正在唱訊號色（從左掃過去）、唱完紙白
    c.fillStyle = rgba('bone', 0.3);
    if (p < 1) c.fillText(sl.text, tx, ty);
    if (p > 0) {
      const tw = c.measureText(sl.text).width;
      c.save();
      c.beginPath(); c.rect(tx - tw / 2 - 6, ty - LYR_SIZE, (tw + 12) * p, LYR_SIZE * 1.4); c.clip();
      c.fillStyle = p < 1 ? rgba('signal') : rgba('bone', 0.97);
      c.fillText(sl.text, tx, ty);
      c.restore();
    }
    c.restore();
    if (!singing) return false;
    hc.save();
    hc.globalAlpha *= a;
    hc.font = font(F_LYR, LYR_SIZE); hc.textAlign = 'center';
    hc.fillStyle = rgba('signal', 0.6);
    hc.fillText(sl.text, tx, ty);
    hc.fillStyle = rgba('signal', 0.5); hc.fillRect(x, cy - CAP.h / 2, w, 4);
    hc.restore();
    void hash;
    return true;
  }

  /** 留言膠帶：第一拍之前從左邊拉出來貼上，然後一個詞組一拍用麥克筆寫上去，最後署名。 */
  private drawTape(c: CanvasRenderingContext2D, t: number) {
    const s = this.ctx.start;
    const pull = prog(t, s + 0.05, Math.max(s + 0.3, this.tTape), ease.outCubic);
    if (pull <= 0) return;
    const m = this.msg, fit = this.fit;
    const S = this.dyn.canvas.width / W;
    c.save();
    c.translate(TAPE.x, TAPE.y);
    c.rotate(-0.008);
    // 拉出來的長度（撕開的那一端跟著走）
    const wNow = (this.tapeW + 24) * pull;
    // 膠帶每格直接畫（裁出拉出來的長度），不用 drawImage 一張離屏畫布：瀏覽器有時會把來源畫布換成 GPU 版本、
    // 縮放取樣跟著變，同一時間點畫兩次會差一點點（確定性檢查會偶發不過）
    c.save();
    c.beginPath(); c.rect(-12, -12, wNow + 4, this.tapeH + 30); c.clip();
    this.tapeStrip(c, 0, 0, this.tapeW, this.tapeH, this.seed);
    c.restore();
    void S;
    // 字
    const shown = fitCharsF(fit.lines, revealAt(this.sched, t, Math.min(0.2, this.beat * 0.4)));
    const fam = F.hand(700);
    const top = 26 + fit.size * 0.9;
    drawReveal(c, fit, fam, 40, top, shown, { color: rgba('ink', 0.9) });
    const done = this.sched.length ? this.sched[this.sched.length - 1]!.t + 0.2 : this.tFirst;
    if (m && t >= done) {
      const k = prog(t, done, done + 0.3);
      c.font = font(fam, 32); c.fillStyle = rgba('ink', 0.75 * k); c.textAlign = 'right';
      c.fillText(signature(m.name), this.tapeW - 40, this.tapeH - 22);
      c.textAlign = 'left';
    }
    c.restore();
  }
}
