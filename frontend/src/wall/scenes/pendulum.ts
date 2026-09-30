// 雙擺（亮）：攤開的實驗筆記本。左頁是方格紙，上面一支筆被兩個擺推著畫「諧振圖」（harmonograph）——
// 甲擺（宣文）推 x、乙擺（孟庭）推 y，頻率比 2:3、3:2、2:1 或 1:2（乙擺稍微走音一點，圖形才會一圈圈轉出花樣），振幅慢慢衰減，
// 一圈一圈往內收。頻率以小節為單位：甲擺的兩端都落在拍點上，筆在拍點「甩」到最遠再回頭。
//  - 剛畫的線是訊號色的暗部（濕墨），一秒內乾成咖啡色；每個小節線在軌跡上打一個小點與小節號。
// MV 版：焦點是右頁的主打留言（大大的手寫字，一個字一個字寫上去，濕墨一秒內乾），鏡頭整個窗格慢慢往前推。
//  - 右頁上方畫著兩個擺的側視圖（跟著同一條式子擺），留言寫完後署名，最後一行小小的手寫結論「兩擺頻率一致，建議永久耦合。」
//  - 歌詞是左頁下方的圖說（比留言小一級），照跟唱規則（亮版面：唱到的字訊號色的暗部＋螢光筆）。
//  - 小字只有三群：右頁抬頭一行、兩個擺的名字、結論。
//  - 沒有留言：歌詞放大寫在右頁當焦點，下面一行小字邀請。純音樂：圖說寫本實驗的配樂（歌名）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, pulse, hash, TAU } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { msgMaxFor, lyricV2, sigV2, fitClauses, V2 } from './_v2';
import { Lyrics } from '../engine/lyrics';
import { lyricAt, layoutLyric, beatAfter, signature, fillWithHearts, DATE_DOTS, lyricSubOf, drawLyricSub } from './_motifs';
import { Paper, stagger, mono, tag } from './_t11';

export const spec: PlateSpecDecl = { group: 'type', family: 'science', paper: true, energy: [0, 0.65], bars: [6, 16], weight: 1 };

// ---------------------------------------------------------------- 版面
/** 左頁（方格紙）與畫圖的中心、最大振幅。 */
const PAGE_L = { x0: 112, y0: 104, x1: 918, y1: 800 };
const CEN = { x: 520, y: 452 };
const AMP = { x: 330, y: 300 };
/** 右頁的文字欄。 */
const NB = { x: 1004, w: 800 };
/** v2：留言在右頁下半（寬 800、高 ≤ 300），上半給兩個擺；署名一定在 y < 800（右下角 QR 區的上面）。 */
const MSG_BOX = { y: 468, h: 292 };
/** 歌詞：有留言時是左頁下方的圖說；沒有留言時放大寫在右頁。 */
const LYR = { x: 124, base: 956, w: 790 };
const LYR_N = { x: 1004, base: 600, w: 800, size: lyricV2(null) };
/** 鏡頭推近的最大倍率（字離邊與 QR 的距離是照這個算的）。 */
const PUSH = 0.025;
const FAM_MSG = F.hand(700);
const CONCL = '結論：兩擺頻率一致，建議永久耦合。';
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
  sigSize = 30;
  lyrSize = 60;
  lyricsInWindow = false;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const sig = m ? (m.couple ? '—— 新郎新娘' : signature(m.name)) : '';
    await loadText(`${m?.text ?? ''}${sig}${CONCL}${INVITE}${song.title}${song.artist}實驗紀錄兩擺耦合甲擺乙擺宣文孟庭本實驗配樂`);
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
      // 字級依「可用高度扣掉署名」算：署名永遠在最後一行下面、不重疊
      ? (fitClauses(c, text, fam, NB.w, MSG_BOX.h - 60, { min: V2.msgMin, max: msgMaxFor(text), lineHeight: 1.3, maxLines: 5 }) ?? fitText(c, text, fam, NB.w, MSG_BOX.h - 60, { min: V2.msgMin, max: msgMaxFor(text), lineHeight: 1.3, maxLines: 5 }))
      : fitText(c, text, fam, NB.w, 90, { min: 32, max: 34, lineHeight: 1.3, maxLines: 2 });
    const top = m ? MSG_BOX.y + fit.size * 0.9 : 700;
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
    // 署名在最後一行（連下伸部）下面
    this.sigSize = sigV2(fit.size);
    this.sigY = top + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.3 + this.sigSize + 10;
    this.conclT = Math.min(e - 0.8, tLast + beat * 1.5);
    this.lyricsInWindow = lyrics.linesIn(s, e).length > 0;
    // 歌詞比留言小一級
    this.lyrSize = lyricV2(m ? fit.size : null);
    this.drawBase();
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
    c.strokeStyle = rgba('sepia', 0.2); c.lineWidth = 1;
    c.beginPath(); c.moveTo(CEN.x - AMP.x - 30, CEN.y); c.lineTo(CEN.x + AMP.x + 30, CEN.y); c.moveTo(CEN.x, CEN.y - AMP.y - 30); c.lineTo(CEN.x, CEN.y + AMP.y + 30); c.stroke();
    // 右頁抬頭：一行小字（小字第一群）
    mono(c, `LAB NOTEBOOK  ·  兩擺耦合實驗${m?.couple ? '  ·  新人親筆' : ''}  ·  ${DATE_DOTS}`, NB.x, 118, { size: 15, tracking: 3, color: rgba('sepia', 0.5) });
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
    // 每個小節線：軌跡上一個小點
    for (let b = Math.ceil(this.bar0 + 1e-6); au.timeOfBar(b) <= t; b++) {
      const p = this.pen(au.timeOfBar(b));
      const k = pulse(t, au.timeOfBar(b), 0.25);
      c.fillStyle = rgba('sepia', 0.7); c.beginPath(); c.arc(p.x, p.y, 3 + 3 * k, 0, TAU); c.fill();
      // 小節線上筆甩到最遠，濺出幾滴墨（位置用種子，留在紙上）
      for (let d = 0; d < 3; d++) {
        const ang = hash(this.seed, b, d) * TAU, r = 12 + 26 * hash(this.seed, b, d + 7);
        c.fillStyle = rgba('blood', 0.35 + 0.3 * k); c.beginPath(); c.arc(p.x + Math.cos(ang) * r, p.y + Math.sin(ang) * r, 1.4 + 1.6 * hash(this.seed, b, d + 3), 0, TAU); c.fill();
      }
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
    // 鏡頭：整個窗格慢慢往前推（inOutSine）
    const cam = (1 - Math.cos(Math.PI * clamp((t - s) / Math.max(1, e - s)))) / 2;
    return { paper: 1, bloom: 0.3, vignette: 0.3, grain: 0.04, halation: 0.05, zoom: 1 + PUSH * cam };
  }

  /** 右頁上方：兩個擺的側視圖，照同一條式子擺（甲擺的兩端落在拍點上）。 */
  private pendulums(c: CanvasRenderingContext2D, t: number) {
    const p = this.pen(t);
    // v2：留言變小之後，右頁上半讓給兩個大大的擺（場景是主角）；擺錘拖一點殘影，看得出在甩
    const items: [number, number, string, number][] = [[NB.x + 150, p.ax, '甲擺　宣文', 0], [NB.x + 530, p.ay, '乙擺　孟庭', 1]];
    for (const [px, a, name, i] of items) {
      const py = 168, len = 190, th = a * 0.38;
      const bx = px + Math.sin(th) * len, by = py + Math.cos(th) * len;
      for (let g = 3; g >= 1; g--) {
        const q = this.pen(t - g * 0.045), ga = (i === 0 ? q.ax : q.ay) * 0.38;
        c.fillStyle = i === 0 ? rgba('sepia', 0.1 / g) : rgba('blood', 0.12 / g);
        c.beginPath(); c.arc(px + Math.sin(ga) * len, py + Math.cos(ga) * len, 15, 0, TAU); c.fill();
      }
      c.strokeStyle = rgba('sepia', 0.8); c.lineWidth = 2;
      c.beginPath(); c.moveTo(px - 26, py); c.lineTo(px + 26, py); c.stroke();
      for (let k = -2; k <= 2; k++) { c.beginPath(); c.moveTo(px + k * 11, py); c.lineTo(px + k * 11 - 7, py - 7); c.stroke(); }
      // 擺動範圍（虛線弧）
      c.setLineDash([3, 4]); c.strokeStyle = rgba('sepia', 0.35); c.lineWidth = 1;
      c.beginPath(); c.arc(px, py, len, Math.PI / 2 - 0.38, Math.PI / 2 + 0.38); c.stroke(); c.setLineDash([]);
      c.strokeStyle = rgba('sepia'); c.lineWidth = 1.8;
      c.beginPath(); c.moveTo(px, py); c.lineTo(bx, by); c.stroke();
      c.fillStyle = i === 0 ? rgba('sepia') : rgba('blood');
      c.beginPath(); c.arc(bx, by, 15, 0, TAU); c.fill();
      tag(c, name, px + 36, py + 26, { size: 17, color: rgba('sepia', 0.6), tracking: 2 });
    }
  }

  /** 右頁：留言逐字寫上去（沒有留言：一行小字邀請）、署名、結論（小字）。 */
  private notes(c: CanvasRenderingContext2D, t: number) {
    const m = this.msg, fit = this.fit!;
    c.font = font(FAM_MSG, fit.size);
    for (const g of this.glyphs) {
      if (t < g.t) break;
      // 寫字：0.09 秒內由左往右寫出來，墨一秒內由濕（訊號色暗部）乾成咖啡色
      const r = clamp((t - g.t) / 0.09);
      const dry = clamp((t - g.t) / 1.0);
      c.save();
      if (r < 1) { c.beginPath(); c.rect(g.x - 4, g.y - fit.size, (g.w + 8) * r, fit.size * 1.4); c.clip(); }
      if (g.ch === '♥') c.fillStyle = rgba('rose');
      else c.fillStyle = dry < 1 ? mixRgba('blood', 'sepia', dry) : m ? rgba('sepia') : rgba('sepia', 0.7);
      c.fillText(g.ch, g.x, g.y);
      c.restore();
    }
    if (m && t >= this.sigT) {
      c.save(); c.globalAlpha *= prog(t, this.sigT, this.sigT + 0.3);
      c.font = font(F.hand(400), this.sigSize); c.fillStyle = rgba('sepia', 0.75); c.textAlign = 'right';
      fillWithHearts(c, m.couple ? '—— 新郎新娘' : signature(m.name), NB.x + NB.w, this.sigY);
      c.restore();
    }
    // 結論：一行小小的手寫（小字第三群）
    if (m && t >= this.conclT) {
      c.save(); c.globalAlpha *= prog(t, this.conclT, this.conclT + 0.35) * 0.62;
      c.font = font(F.hand(400), 26); c.fillStyle = rgba('sepia');
      c.fillText(CONCL, NB.x, 806);
      c.restore();
    }
  }

  /** 歌詞：有留言時是左頁下方的圖說（小一級）；沒有留言時放大寫在右頁。純音樂寫配樂。 */
  private caption(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    const box = this.msg ? { ...LYR, size: this.lyrSize } : LYR_N;
    const ly = lyricAt(lyrics, t, 2);
    if (!ly) {
      if (!this.lyricsInWindow) {
        c.font = font(F.ming(700), Math.round(box.size * 0.8)); c.fillStyle = rgba('sepia', 0.85);
        c.fillText(`本實驗配樂：${song.title}`, box.x, box.base - 6);
      }
      return;
    }
    const st = { family: F.archivo(100, 800), size: box.size, minSize: V2.lyrMin, maxWidth: box.w, lineHeight: 1.12 };
    const lay = layoutLyric(c, ly.line, st);
    const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.12));
    const oy = box.base - (lay.height - lay.size) + (1 - inK) * 12;
    c.save();
    c.globalAlpha *= ly.k;
    c.font = font(st.family, lay.size);
    for (const pw of lay.words) {
      const p = Lyrics.wordProgress(pw.word, t);
      const x = box.x + pw.x, y = oy + pw.y;
      if (p > 0 && p < 1) { c.fillStyle = rgba('signal', 0.4); c.fillRect(x - 4, y - lay.size * 0.4, (pw.w + 8) * p, lay.size * 0.46); }
      c.fillStyle = rgba('sepia', 0.26);
      if (p < 1) c.fillText(pw.word.w, x, y);
      if (p <= 0) continue;
      c.save(); c.beginPath(); c.rect(x - 6, y - lay.size * 1.1, (pw.w + 12) * p, lay.size * 1.5); c.clip();
      c.fillStyle = p < 1 ? rgba('blood') : rgba('sepia');
      c.fillText(pw.word.w, x, y);
      c.restore();
    }
    // 原文副行（韓文歌）：layoutLyric 的 height 已經算到原文，所以中文往上讓了位置；原文寫在中文正下方，
    // 比中文安靜——不畫螢光筆、唱到唱完都是咖啡墨再淡兩成，還沒唱的跟中文一樣淡
    const sub = lyricSubOf(ly.line);
    if (sub && lay.sub) {
      c.translate(box.x, oy + lay.sub.dy); c.textAlign = 'left';
      drawLyricSub(c, sub, t, { ...st, sung: rgba('sepia'), unsung: rgba('sepia', 0.26) }, lay.size, c.globalAlpha);
    }
    c.restore();
  }
}
