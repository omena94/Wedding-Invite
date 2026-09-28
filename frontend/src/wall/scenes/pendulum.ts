// 雙擺（亮）：攤開的實驗筆記本。左頁是方格紙，上面一支筆被兩個擺推著畫「諧振圖」（harmonograph）——
// 甲擺（宣文）推 x、乙擺（孟庭）推 y，頻率比 2:3、3:2、2:1 或 1:2（乙擺稍微走音一點，圖形才會一圈圈轉出花樣），振幅慢慢衰減，
// 一圈一圈往內收。頻率以小節為單位：甲擺的兩端都落在拍點上，筆在拍點「甩」到最遠再回頭。
//  - 剛畫的線是訊號色的暗部（濕墨），一秒內乾成咖啡色；每個小節線在軌跡上打一個小點與小節號。
//  - 右頁上方畫著兩個擺的側視圖（跟著同一條式子擺），下面是「觀察」：主打留言用手寫字一個字一個字寫上去，署名，
//    最後一行結論「兩擺頻率一致，建議永久耦合。」、註腳「本實驗不可重複」。
//  - 歌詞是左頁下方的圖說「圖 1　合成軌跡」，照跟唱規則（亮版面：唱到的字訊號色的暗部＋螢光筆）。
//  - 沒有留言：觀察欄寫「（尚無紀錄）」與邀請。純音樂：圖說寫本實驗的配樂（歌名）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, pulse, hash, TAU } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { Lyrics } from '../engine/lyrics';
import { lyricAt, layoutLyric, beatAfter, signature, fillWithHearts, DATE_DOTS } from './_motifs';
import { Paper, stagger, pad3, mono, tag, type Rect } from './_t11';

export const spec: PlateSpecDecl = { group: 'type', family: 'science', paper: true, energy: [0, 0.65], bars: [6, 16], weight: 1 };

// ---------------------------------------------------------------- 版面
/** 左頁（方格紙）與畫圖的中心、最大振幅。 */
const PAGE_L = { x0: 112, y0: 104, x1: 918, y1: 800 };
const CEN = { x: 520, y: 452 };
const AMP = { x: 330, y: 300 };
/** 右頁的文字欄。 */
const NB = { x: 1004, w: 800 };
const MSG_BOX = { y: 400, h: 300 };
const LYR = { x: 124, base: 956, w: 790, size: 64 };
const FAM_MSG = F.hand(700);
const CONCL = '結論：兩擺頻率一致，建議永久耦合。';
const FOOT = '＊本實驗不可重複：每一次畫出來的圖形都是唯一的。';
const EMPTY = '（尚無紀錄）';
const INVITE = '掃描右下角 QR code，把你的觀察寫進這本實驗紀錄。';

/** 軌跡每秒取幾點。 */
const RATE = 200;
/** 頻率比（甲：乙）：一個週期是一小節。 */
const RATIOS: [number, number][] = [[2, 3], [3, 2], [2, 1], [1, 2]];

export default class Pendulum extends Scene {
  paper = shared('t11.paper', () => new Paper());
  base = this.track(new Layer2D(W, H, undefined, { fast: true }));
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  trace = this.track(new LineBatch(8192, { screen2D: true, blend: 'normal' }));
  /** 軌跡上已經算過的點（x, y 交錯）。 */
  pts: number[] = [];
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 389 + (this.msg?.id ?? 0) * 53) >>> 0;
  fx = 1; fy = 2; py = 0; det = 0.006; decay = 0.05;
  bar0 = 0;
  tPen = 0;
  fit: FitResult | null = null;
  glyphs: { ch: string; x: number; y: number; t: number; w: number }[] = [];
  sigT = Infinity; sigY = 0; conclT = Infinity;
  lyricsInWindow = false;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const sig = m ? (m.couple ? '—— 新郎新娘' : signature(m.name)) : '';
    await loadText(`${m?.text ?? ''}${sig}${CONCL}${FOOT}${EMPTY}${INVITE}${song.title}${song.artist}實驗紀錄兩擺耦合甲擺乙擺宣文孟庭觀察圖合成軌跡配樂頻率比`);
    const c = this.layer.ctx;
    // ---- 擺的參數：頻率比、乙擺的相位、一點點走音（圖形才會慢慢轉）
    const [fx, fy] = RATIOS[Math.floor(hash(this.seed, 1) * RATIOS.length)]!;
    this.fx = fx; this.fy = fy;
    this.py = hash(this.seed, 2) * TAU;
    this.det = (hash(this.seed, 3) < 0.5 ? -1 : 1) * (0.018 + 0.014 * hash(this.seed, 4));
    const beat = au.beatPeriod(s);
    this.tPen = beatAfter(au, s + Math.min(0.2, beat * 0.4));
    this.bar0 = au.barAt(this.tPen);
    // 振幅在窗格結束時剩四成
    const bars = Math.max(1, au.barAt(e) - this.bar0);
    this.decay = Math.log(1 / 0.4) / bars;

    // ---- 觀察：留言一個字一個字寫上去
    const bar = au.timeOfBar(this.bar0 + 1) - this.tPen;
    const text = m ? m.text : INVITE;
    const fam = FAM_MSG;
    const fit = this.fit = m
      ? fitText(c, text, fam, NB.w, MSG_BOX.h, { min: 44, max: 88, lineHeight: 1.36, maxLines: 5 })
      : fitText(c, text, fam, NB.w, 150, { min: 44, max: 52, lineHeight: 1.36, maxLines: 2 });
    const top = m ? MSG_BOX.y + fit.size * 0.9 : MSG_BOX.y + 80 + fit.size * 0.9;
    c.font = font(fam, fit.size);
    const chars: { ch: string; x: number; y: number; w: number }[] = [];
    fit.lines.forEach((ln, li) => {
      let x = NB.x;
      for (const ch of Array.from(ln)) { const w = c.measureText(ch).width; chars.push({ ch, x, y: top + li * fit.lineHeight, w }); x += w; }
    });
    const times = stagger(au, this.tPen + beat, chars.length, Math.min(2 * bar, 0.42 * (e - s)));
    this.glyphs = chars.map((g, i) => ({ ...g, t: times[i]! }));
    const tLast = times[times.length - 1] ?? this.tPen;
    this.sigT = tLast + beat * 0.5;
    this.sigY = top + (fit.lines.length - 1) * fit.lineHeight + 64;
    this.conclT = Math.min(e - 0.8, tLast + beat * 1.5);
    this.lyricsInWindow = lyrics.linesIn(s, e).length > 0;
    this.drawBase();

    // ---- 即時小卡避開：觀察欄（留言、署名、結論）與圖說（歌詞）
    const nb: Rect = [NB.x - 16, MSG_BOX.y - 50, W - 96 - NB.x + 32, 830 - (MSG_BOX.y - 50)];
    const lyr: Rect = [LYR.x - 12, 846, LYR.w + 24, 984 - 846];
    this.avoid = [nb, nb, lyr, lyr];
  }

  /** 筆的位置（t 可以是任何時間；筆落下之前停在起點）。 */
  private pen(t: number) {
    const b = Math.max(0, this.ctx.audio.barAt(t) - this.bar0);
    const tau = TAU * b, k = Math.exp(-this.decay * b);
    // 甲擺：sin(fx τ + π/2)——兩端落在拍點上；乙擺慢慢走音
    const ax = Math.sin(this.fx * tau + Math.PI / 2), ay = Math.sin(this.fy * (1 + this.det) * tau + this.py);
    return { x: CEN.x + AMP.x * ax * k, y: CEN.y + AMP.y * ay * k, ax: ax * k, ay: ay * k, b };
  }

  /** 不會變的：方格紙上的座標軸、右頁的抬頭、兩個擺的框、中縫的陰影。 */
  private drawBase() {
    const c = this.base.ctx, m = this.msg;
    this.base.clear();
    // 中縫：左頁右緣往右一道淡淡的陰影
    const g = c.createLinearGradient(930, 0, 990, 0);
    g.addColorStop(0, rgba('sepia', 0)); g.addColorStop(0.55, rgba('sepia', 0.1)); g.addColorStop(1, rgba('sepia', 0));
    c.fillStyle = g; c.fillRect(930, 0, 60, H);
    // 左頁：座標軸（十字）與刻度
    c.strokeStyle = rgba('sepia', 0.35); c.lineWidth = 1;
    c.beginPath(); c.moveTo(CEN.x - AMP.x - 30, CEN.y); c.lineTo(CEN.x + AMP.x + 30, CEN.y); c.moveTo(CEN.x, CEN.y - AMP.y - 30); c.lineTo(CEN.x, CEN.y + AMP.y + 30); c.stroke();
    mono(c, 'x ← 甲擺', CEN.x + AMP.x - 40, CEN.y - 10, { size: 12, tracking: 1, color: rgba('sepia', 0.5) });
    mono(c, 'y ← 乙擺', CEN.x + 10, CEN.y - AMP.y - 14, { size: 12, tracking: 1, color: rgba('sepia', 0.5) });
    // 右頁抬頭
    mono(c, `LAB NOTEBOOK  ·  實驗紀錄 No.${m ? pad3(m.n) : '000'}  ·  ${DATE_DOTS}`, NB.x, 150, { size: 15, tracking: 3, color: rgba('sepia', 0.65) });
    c.font = font(F.ming(900), 48); c.fillStyle = rgba('sepia');
    c.fillText('兩擺耦合實驗', NB.x, 214);
    c.fillStyle = rgba('sepia', 0.6); c.fillRect(NB.x, 236, NB.w, 1.5);
    tag(c, m?.couple ? '觀察（新人親筆）：' : '觀察：', NB.x, MSG_BOX.y - 24, { size: 20, color: rgba('sepia', 0.7), tracking: 3 });
    // 圖說的標籤
    mono(c, `圖 1　合成軌跡　·　頻率比 ${this.fx} : ${this.fy}　·　一週期＝一小節`, LYR.x, 846, { size: 14, tracking: 2, color: rgba('sepia', 0.6) });
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const fadeIn = prog(t, s, s + 0.3), exit = prog(t, e - 0.35, e, ease.inCubic);
    const vis = fadeIn * (1 - exit);
    this.paper.render(renderer, out, { grid: 24, gridO: [PAGE_L.x0, PAGE_L.y0], gridBox: [PAGE_L.x0, PAGE_L.y0, PAGE_L.x1, PAGE_L.y1], margin: NB.x - 30, k: vis });
    comp.draw(renderer, this.base.texture, out, { opacity: vis });

    // ---- 軌跡：從筆落下到現在，每 1/200 秒一段；剛畫的是濕墨（訊號色的暗部），一秒內乾成咖啡色
    const lb = this.trace; lb.clear();
    const sep = LIN.sepia, wet = LIN.blood;
    const t0 = this.tPen;
    let pen = this.pen(Math.min(t, t0));
    if (t > t0) {
      // 固定的時間格（每 1/200 秒一點），算過的點留著給下一格用：每格只要多算新的幾點
      const n = Math.min(7800, Math.floor((t - t0) * RATE));
      while (this.pts.length <= n) { const q = this.pen(t0 + this.pts.length / RATE); this.pts.push(q.x, q.y); }
      let px = this.pts[0]!, py = this.pts[1]!;
      for (let i = 1; i <= n + 1; i++) {
        const ti = i <= n ? t0 + i / RATE : t;
        const q = i <= n ? { x: this.pts[2 * i]!, y: this.pts[2 * i + 1]! } : this.pen(t);
        const dry = clamp((t - ti) / 1.0);
        const r = wet[0] + (sep[0] - wet[0]) * dry, g = wet[1] + (sep[1] - wet[1]) * dry, b = wet[2] + (sep[2] - wet[2]) * dry;
        lb.seg2(px, py, q.x, q.y, 1.7 + 1.1 * (1 - dry), [r, g, b], (0.5 + 0.45 * (1 - dry)) * vis);
        px = q.x; py = q.y;
      }
      pen = { ...pen, x: px, y: py };
    }
    lb.render(renderer, out);

    const L = this.layer, c = L.ctx;
    L.clear();
    c.globalAlpha = vis;
    // 每個小節線：軌跡上一個小點＋小節號
    for (let b = Math.ceil(this.bar0 + 1e-6); au.timeOfBar(b) <= t; b++) {
      const p = this.pen(au.timeOfBar(b));
      const k = pulse(t, au.timeOfBar(b), 0.25);
      c.fillStyle = rgba('sepia', 0.85); c.beginPath(); c.arc(p.x, p.y, 3.2 + 3 * k, 0, TAU); c.fill();
      mono(c, String(b - Math.ceil(this.bar0 - 1e-6) + 1), p.x + 7, p.y - 7, { size: 11, tracking: 0, color: rgba('sepia', 0.6) });
    }
    // 筆尖：落下前懸在起點（影子比較遠），落下後貼著紙
    const down = prog(t, t0 - 0.25, t0, ease.inCubic);
    const lift = (1 - down) * 14;
    c.fillStyle = rgba('sepia', 0.18); c.beginPath(); c.ellipse(pen.x + 4 + lift, pen.y + 6 + lift, 9, 6, 0, 0, TAU); c.fill();
    c.fillStyle = rgba('blood'); c.beginPath(); c.arc(pen.x, pen.y - lift, 5.5, 0, TAU); c.fill();
    c.strokeStyle = rgba('sepia'); c.lineWidth = 1.5; c.beginPath(); c.arc(pen.x, pen.y - lift, 10, 0, TAU); c.stroke();
    if (t >= t0) { const kb = pulse(t, t0, 0.18); if (kb > 0.02) { c.strokeStyle = rgba('blood', kb); c.beginPath(); c.arc(pen.x, pen.y, 10 + 26 * (1 - kb), 0, TAU); c.stroke(); } }

    this.pendulums(c, t);
    this.notes(c, t);
    this.caption(c, t);
    comp.draw(renderer, L.upload(), out);
    return { paper: 1, bloom: 0.3, vignette: 0.22, grain: 0.04, halation: 0.05, popupAvoid: this.avoid };
  }

  /** 右頁上方：兩個擺的側視圖，照同一條式子擺（甲擺的兩端落在拍點上）。 */
  private pendulums(c: CanvasRenderingContext2D, t: number) {
    const p = this.pen(t);
    const items: [number, number, string, string, number][] = [[NB.x + 90, p.ax, '甲擺　宣文', `f = ${this.fx}`, 0], [NB.x + 330, p.ay, '乙擺　孟庭', `f = ${this.fy}`, 1]];
    for (const [px, a, name, fr, i] of items) {
      const py = 250, len = 80, th = a * 0.42;
      const bx = px + Math.sin(th) * len, by = py + Math.cos(th) * len;
      c.strokeStyle = rgba('sepia', 0.8); c.lineWidth = 2;
      c.beginPath(); c.moveTo(px - 26, py); c.lineTo(px + 26, py); c.stroke();
      for (let k = -2; k <= 2; k++) { c.beginPath(); c.moveTo(px + k * 11, py); c.lineTo(px + k * 11 - 7, py - 7); c.stroke(); }
      // 擺動範圍（虛線弧）
      c.setLineDash([3, 4]); c.strokeStyle = rgba('sepia', 0.35); c.lineWidth = 1;
      c.beginPath(); c.arc(px, py, len, Math.PI / 2 - 0.42, Math.PI / 2 + 0.42); c.stroke(); c.setLineDash([]);
      c.strokeStyle = rgba('sepia'); c.lineWidth = 1.8;
      c.beginPath(); c.moveTo(px, py); c.lineTo(bx, by); c.stroke();
      c.fillStyle = i === 0 ? rgba('sepia') : rgba('blood');
      c.beginPath(); c.arc(bx, by, 11, 0, TAU); c.fill();
      tag(c, name, px + 44, py + 38, { size: 18, color: rgba('sepia', 0.85), tracking: 2 });
      mono(c, fr, px + 44, py + 62, { size: 13, tracking: 1, color: rgba('sepia', 0.55) });
    }
  }

  /** 右頁：觀察（留言逐字寫上去）、署名、結論、註腳。 */
  private notes(c: CanvasRenderingContext2D, t: number) {
    const m = this.msg, fit = this.fit!;
    if (!m) {
      c.font = font(F.hand(700), 60); c.fillStyle = rgba('sepia', 0.5);
      c.fillText(EMPTY, NB.x, MSG_BOX.y + 56);
    }
    c.font = font(FAM_MSG, fit.size);
    for (const g of this.glyphs) {
      if (t < g.t) break;
      // 寫字：0.09 秒內由左往右寫出來，墨一秒內由濕（訊號色暗部）乾成咖啡色
      const r = clamp((t - g.t) / 0.09);
      const dry = clamp((t - g.t) / 1.0);
      c.save();
      if (r < 1) { c.beginPath(); c.rect(g.x - 4, g.y - fit.size, (g.w + 8) * r, fit.size * 1.4); c.clip(); }
      if (g.ch === '♥') c.fillStyle = rgba('rose');
      else c.fillStyle = dry < 1 ? mixRgba('blood', 'sepia', dry) : rgba('sepia');
      c.fillText(g.ch, g.x, g.y);
      c.restore();
    }
    if (m && t >= this.sigT) {
      c.save(); c.globalAlpha *= prog(t, this.sigT, this.sigT + 0.3);
      c.font = font(F.hand(400), 40); c.fillStyle = rgba('sepia', 0.75); c.textAlign = 'right';
      fillWithHearts(c, m.couple ? '—— 新郎新娘' : signature(m.name), NB.x + NB.w, Math.min(this.sigY, 748));
      c.restore();
    }
    if (t >= this.conclT) {
      const k = prog(t, this.conclT, this.conclT + 0.35);
      c.save(); c.globalAlpha *= k;
      c.font = font(F.hand(700), 34); c.fillStyle = rgba('sepia');
      c.fillText(CONCL, NB.x, 790);
      // 重點用螢光筆畫一下
      c.fillStyle = rgba('signal', 0.35);
      c.fillRect(NB.x + 88, 780 - 4, (c.measureText(CONCL).width - 88) * ease.outCubic(prog(t, this.conclT + 0.2, this.conclT + 0.6)), 14);
      c.restore();
      c.save(); c.globalAlpha *= prog(t, this.conclT + 0.3, this.conclT + 0.6);
      tag(c, FOOT, NB.x, 822, { size: 15, color: rgba('sepia', 0.55), tracking: 1 });
      c.restore();
    }
  }

  /** 左頁下方的圖說：歌詞逐字跟唱（兩行時往上長）；純音樂寫配樂。 */
  private caption(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    const ly = lyricAt(lyrics, t, 2);
    if (!ly) {
      if (!this.lyricsInWindow) {
        c.font = font(F.ming(700), 48); c.fillStyle = rgba('sepia', 0.85);
        c.fillText(`本實驗配樂：${song.title}`, LYR.x, LYR.base - 6);
      }
      return;
    }
    const st = { family: F.archivo(100, 800), size: LYR.size, minSize: 48, maxWidth: LYR.w, lineHeight: 1.12 };
    const lay = layoutLyric(c, ly.line, st);
    const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.12));
    const oy = LYR.base - (lay.height - lay.size) + (1 - inK) * 12;
    c.save();
    c.globalAlpha *= ly.k;
    c.font = font(st.family, lay.size);
    for (const pw of lay.words) {
      const p = Lyrics.wordProgress(pw.word, t);
      const x = LYR.x + pw.x, y = oy + pw.y;
      if (p > 0 && p < 1) { c.fillStyle = rgba('signal', 0.4); c.fillRect(x - 4, y - lay.size * 0.4, (pw.w + 8) * p, lay.size * 0.46); }
      c.fillStyle = rgba('sepia', 0.26);
      if (p < 1) c.fillText(pw.word.w, x, y);
      if (p <= 0) continue;
      c.save(); c.beginPath(); c.rect(x - 6, y - lay.size * 1.1, (pw.w + 12) * p, lay.size * 1.5); c.clip();
      c.fillStyle = p < 1 ? rgba('blood') : rgba('sepia');
      c.fillText(pw.word.w, x, y);
      c.restore();
    }
    c.restore();
  }
}
