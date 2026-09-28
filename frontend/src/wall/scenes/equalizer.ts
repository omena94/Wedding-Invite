// 等化器（機器 A）：音響上的大型圖形等化器，24 根 LED 光柱（shader）跟著這首歌的頻譜跳，底下亮面地板有倒影。
//  - 光柱的高度來自這首歌的音訊包絡（低音、大鼓、人聲、高音…分到 24 個頻段），大鼓打低頻、小鼓打中頻、鈸打高頻；
//    每根柱子頂上有一格「峰值」慢慢掉下來。
//  - 歌詞一個字（英文一個字）一個字「站」在光柱上：字的高度跟著它底下那幾根柱子起伏，唱到的字跳起來、亮成訊號色，
//    底下的柱子也整根變熱。字永遠在柱子的上面，不會壓在燈上（讀得清楚）。
//  - 上面的顯示幕是主打留言：一行一行從右邊滑進來（跑馬燈），落在拍點上；右下署名。沒有留言：顯示邀請。
// 跟別的機器版面不同：這裡是整面會發光的燈，看的是跟著音樂跳的節奏。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, noise1 } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { Lyrics, type Line } from '../engine/lyrics';
import { beatAfter, signature, lyricAt } from './_motifs';
import { fillWithHearts } from '../engine/motifs';
import { layoutWordRows, windowLines } from './_t7';
import { FRAG_EQ, NCOL, NSEG } from './equalizer-glsl';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: false, energy: [0.5, 1], bars: [4, 8] };

// ---------------------------------------------------------------- 版面
const DISP = { x: 120, y: 104, w: 1220, h: 236 };
const EQ = { x: 134, bottom: 880, pitch: 50, w: 42 };
const SEG = { pitch: 26, h: 20 };
const EQH = NSEG * SEG.pitch;
/** 歌詞圖層（光柱上方的範圍）。 */
const WL = { x: 110, y: 350, w: 1240, h: 600 };
/** 歌詞這一列的基線：每個字再跟著底下的柱子上下浮動一點點（±ROW_RIDE）。 */
const ROW_Y = 600, ROW_RIDE = 34;
const MAXW = 1180;

const F_LYR = F.archivo(100, 800);
const F_MSG = F.hand(700);
const INVITE = '掃描右下角 QR code，你的祝福就會在這裡跑過去。';
const FREQS = ['31', '63', '125', '250', '500', '1K', '2K', '4K', '8K', '16K'];

const BG = () => new FSPass(FRAG_EQ, {
  uLvl: { value: new Array(NCOL).fill(0) }, uPeak: { value: new Array(NCOL).fill(0) }, uHot: { value: new Array(NCOL).fill(0) }, uCap: { value: new Array(NCOL).fill(1) },
  uEq: { value: new THREE.Vector4(EQ.x, EQ.bottom, EQ.pitch, EQ.w) }, uSeg: { value: new THREE.Vector2(SEG.pitch, SEG.h) },
  uDisp: { value: new THREE.Vector4(DISP.x, DISP.y, DISP.w, DISP.h) }, uIn: { value: 1 }, uKick: { value: 0 },
});

/** 每個頻段的中心（0..1，低到高）與它用哪一條包絡。 */
const BANDS: [number, string][] = [[0.04, 'bass'], [0.12, 'low'], [0.26, 'drums'], [0.42, 'mid'], [0.55, 'vocal'], [0.7, 'other'], [0.9, 'high']];

export default class Equalizer extends Scene {
  bg = shared('equalizer.bg', BG);
  /** 站在光柱上的歌詞（每格都在動，每格重畫；只有光柱上方那一塊）。 */
  words = this.track(new Layer2D(WL.w, WL.h, undefined, { fast: true }));
  /** 顯示幕的留言（滑進來的時候才重畫）。 */
  disp = this.track(new Layer2D(DISP.w, DISP.h, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  fit: FitResult | null = null;
  lineT: number[] = [];
  sigT = Infinity;
  beat = 0.5;
  tBoot = 0;
  /** 太長、一列放不下的歌詞拆成兩頁（每頁是一個只含部分字的 Line，排版結果會快取）。 */
  pages = new Map<Line, Line[]>();
  avoid: [number, number, number, number][] = [];
  private dispKey = '';

  override async init() {
    const { audio: au, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    this.beat = au.beatPeriod(s + 0.1);
    this.tBoot = beatAfter(au, s + 0.15);
    const m = this.msg;
    const body = m ? m.text : INVITE;
    const lines = windowLines(lyrics, s, e);
    await loadText(INVITE + body + (m ? signature(m.name) : '') + lines.map((l) => l.text).join(''));
    const c = this.words.ctx;
    for (const l of lines) {
      const lay = layoutWordRows(c, l, F_LYR, MAXW, 200, { min: 52, max: 104, maxRows: 1 });
      if ((lay.rows[0]?.w ?? 0) <= MAXW + 1 || l.words.length < 2) continue;
      // 拆兩頁：在中間附近的空白處斷
      const half = Math.ceil(l.words.length / 2);
      this.pages.set(l, [{ ...l, words: l.words.slice(0, half) }, { ...l, words: l.words.slice(half) }]);
    }
    // 留言：最多三行，一行一拍從右邊滑進來
    // 下面留一列給署名
    this.fit = fitText(this.disp.ctx, body, F_MSG, DISP.w - 90, DISP.h - 40 - 40, { min: 44, max: 78, lineHeight: 1.2, maxLines: 3 });
    const t0 = beatAfter(au, this.tBoot + 0.2);
    this.lineT = this.fit.lines.map((_, i) => t0 + i * this.beat);
    if (m) this.sigT = t0 + this.fit.lines.length * this.beat;
    this.avoid = [
      [DISP.x, DISP.y, DISP.w, DISP.h],
      [EQ.x - 20, WL.y, NCOL * EQ.pitch + 40, EQ.bottom - WL.y - 60],
    ];
  }

  // ---------------------------------------------------------------- 頻譜
  /** 第 i 根柱子在 t 時的原始高度（0..1）。 */
  private raw(i: number, t: number) {
    const au = this.ctx.audio;
    const f = i / (NCOL - 1);
    let sum = 0, wsum = 0;
    for (const [cx, name] of BANDS) {
      const w = Math.exp(-((f - cx) * (f - cx)) / 0.012);
      sum += w * au.env(name, t); wsum += w;
    }
    let v = sum / Math.max(1e-4, wsum);
    v = 0.05 + 0.78 * Math.pow(clamp(v), 1.05);
    v += 0.09 * noise1(t * 6.5 + i * 1.7, i);
    v += 0.32 * au.hit('kick', t, 0.1) * clamp(1 - f * 3.2);
    v += 0.26 * au.hit('snare', t, 0.12) * Math.exp(-((f - 0.45) ** 2) / 0.02);
    v += 0.22 * au.hit('hat', t, 0.06) * clamp((f - 0.7) * 4);
    return clamp(v * (0.85 + 0.25 * au.env('rms', t)));
  }
  /** 平滑過的高度（往回取幾個樣本加權，不要逐格亂跳；是 t 的純函數）。 */
  private level(i: number, t: number) {
    let s = 0, w = 0;
    for (let k = 0; k < 6; k++) { const wk = Math.pow(0.6, k); s += this.raw(i, t - k * 0.022) * wk; w += wk; }
    return s / w;
  }
  /** 峰值：過去 0.8 秒裡最高的一格，像有重力一樣慢慢掉下來。 */
  private peak(i: number, t: number, now: number) {
    let pk = now;
    for (let k = 1; k <= 16; k++) { const tau = k * 0.05; pk = Math.max(pk, this.raw(i, t - tau) - 1.8 * tau * tau); }
    return pk;
  }

  // ---------------------------------------------------------------- 顯示幕
  private drawDisplay(t: number) {
    const fit = this.fit!, m = this.msg;
    const slides = this.lineT.map((t0) => prog(t, t0 - 0.42, t0, ease.outExpo));
    const sig = prog(t, this.sigT - 0.3, this.sigT + 0.2, ease.outCubic);
    const key = `${slides.map((x) => Math.round(x * 60)).join(',')}|${Math.round(sig * 20)}`;
    if (key === this.dispKey) return;
    this.dispKey = key;
    const L = this.disp, c = L.ctx;
    L.clear();
    c.save();
    c.beginPath(); c.roundRect(10, 10, DISP.w - 20, DISP.h - 20, 10); c.clip();
    c.textBaseline = 'alphabetic';
    c.font = font(F_MSG, fit.size);
    const top = 20 + (DISP.h - 60 - fit.height) / 2 + fit.size * 0.92;
    fit.lines.forEach((ln, i) => {
      const k = slides[i]!;
      if (k <= 0) return;
      // 從右邊滑進來、停在左邊
      const x = 44 + (1 - k) * (DISP.w + 40);
      c.fillStyle = m ? rgba('bone', 0.95) : rgba('ash', 0.9);
      fillWithHearts(c, ln, x, top + i * fit.lineHeight, rgba('rose'));
    });
    if (m && sig > 0) {
      c.globalAlpha = sig;
      c.font = font(F.hand(700), 36);
      c.textAlign = 'right';
      c.fillStyle = rgba('ash');
      const sg = signature(m.name);
      c.fillText(sg, DISP.w - 40 + (1 - sig) * 60, DISP.h - 22);
      const sw = c.measureText(sg).width;
      c.font = font(F.mono(500), 13); c.letterSpacing = '3px';
      c.fillText(m.couple ? 'FROM THE COUPLE' : `No.${String(m.n).padStart(3, '0')}`, DISP.w - 40 - sw - 24 + (1 - sig) * 60, DISP.h - 26);
      c.letterSpacing = '0px';
      c.textAlign = 'left';
      c.globalAlpha = 1;
    }
    c.restore();
    L.upload();
  }

  // ---------------------------------------------------------------- 站在光柱上的字
  private drawWords(t: number, lv: number[], hot: number[], cap: number[]) {
    const { lyrics } = this.ctx;
    const L = this.words, c = L.ctx;
    L.clear();
    c.textBaseline = 'alphabetic';
    // 頻率標示（地板上）
    c.font = font(F.mono(500), 13); c.letterSpacing = '2px'; c.fillStyle = rgba('ash', 0.55); c.textAlign = 'center';
    FREQS.forEach((fq, k) => { const i = Math.round((k / (FREQS.length - 1)) * (NCOL - 1)); c.fillText(fq, EQ.x + i * EQ.pitch + EQ.w / 2 - WL.x, EQ.bottom + 34 - WL.y); });
    c.textAlign = 'left'; c.letterSpacing = '0px';
    const ly = lyricAt(lyrics, t);
    if (!ly) { L.upload(); return; }
    let line = ly.line;
    const pg = this.pages.get(line);
    if (pg) line = pg[1]!.words[0]!.start - 0.3 <= t ? pg[1]! : pg[0]!;
    const lay = layoutWordRows(c, line, F_LYR, MAXW, 200, { min: 52, max: 104, maxRows: 1 });
    c.font = font(F_LYR, lay.size);
    const x0 = EQ.x - 20 + (NCOL * EQ.pitch + 40 - MAXW) / 2;
    for (const b of lay.words) {
      const wx0 = x0 + b.x, wx1 = wx0 + b.w;
      const i0 = clamp(Math.floor((wx0 - EQ.x) / EQ.pitch), 0, NCOL - 1), i1 = clamp(Math.floor((wx1 - EQ.x) / EQ.pitch), 0, NCOL - 1);
      let top = 0;
      for (let i = i0; i <= i1; i++) top = Math.max(top, lv[i]!);
      const p = Lyrics.wordProgress(b.word, t);
      const jump = t >= b.word.start ? 40 * Math.exp(-(t - b.word.start) / 0.16) * Math.min(1, (t - b.word.start) / 0.04) : 0;
      if (p > 0 && p < 1) for (let i = i0; i <= i1; i++) hot[i] = 1;
      // 字的基線：整列在同一個高度附近，跟著底下的柱子浮動一點點；唱到的時候跳起來
      const y = ROW_Y - ROW_RIDE * (top - 0.45) * 2 - jump;
      // 字底下的柱子被字壓住：最高只到字的下緣
      const c2 = (EQ.bottom - (y + lay.size * 0.2 + 12)) / EQH;
      for (let i = i0; i <= i1; i++) cap[i] = Math.min(cap[i]!, c2);
      c.globalAlpha = ly.k;
      c.fillStyle = b.word.w === '♥' ? rgba('rose') : p <= 0 ? rgba('bone', 0.3) : p < 1 ? rgba('signal') : rgba('bone', 0.95);
      c.fillText(b.word.w, wx0 - WL.x, y - WL.y);
    }
    c.globalAlpha = 1;
    L.upload();
  }

  private blit(tex: THREE.Texture, x: number, y: number, w: number, h: number, out: THREE.WebGLRenderTarget) {
    this.ctx.comp.draw(this.ctx.renderer, tex, out, { scale: [W / w, H / h], offset: [0.5 * W / w - 0.5 - x / w, 0.5 + y / h - 0.5 * H / h] });
  }

  // ---------------------------------------------------------------- 每一格
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start;
    // 開場：光柱從左到右一根一根升上來
    const u = this.bg.u;
    const lv = u.uLvl!.value as number[], pk = u.uPeak!.value as number[], hot = u.uHot!.value as number[], cap = u.uCap!.value as number[];
    for (let i = 0; i < NCOL; i++) {
      const rise = ease.outCubic(prog(t, s + i * 0.012, s + 0.35 + i * 0.012));
      const l = this.level(i, t) * rise;
      lv[i] = l;
      pk[i] = Math.max(l, this.peak(i, t, l) * rise);
      hot[i] = 0;
      cap[i] = 1;
    }
    this.drawWords(t, lv, hot, cap);
    u.uIn!.value = prog(t, s, s + 0.3, ease.outCubic);
    u.uKick!.value = f.a.kick;
    this.bg.render(renderer, out);
    this.blit(this.words.texture, WL.x, WL.y, WL.w, WL.h, out);
    this.drawDisplay(t);
    this.blit(this.disp.texture, DISP.x, DISP.y, DISP.w, DISP.h, out);
    return { bloom: 0.62, vignette: 0.45, halation: 0.25, zoom: 1 + 0.005 * f.a.kick, popupAvoid: this.avoid };
  }
}
