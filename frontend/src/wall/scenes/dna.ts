// 雙螺旋（暗）：一到三條橫躺的 DNA 雙股螺旋，兩股是兩個人（紙白的一股是宣文、訊號色的一股是孟庭），
// 每一格鹼基對上坐著主打留言的一個字。
//  - 開場時整條都是扭著的、在轉（每一拍「喀」地轉 36°，停住，再轉）；還沒讀到的鹼基對上是小小的 A–T、G–C。
//  - 第一拍起，解旋酶（仙女棒的火花）從左邊衝進來，一拍（或半拍、四分之一拍）往右推一格：火花經過的地方螺旋被解開、
//    攤平成一條正對鏡頭的梯子，那一格的鹼基對換成留言的字（燒紅、冷卻成紙白）。字永遠坐在攤平的梯子上，所以讀得清楚。
//    一行推完換下一行；推完的右邊繼續扭著轉。
//  - 上面是「mRNA 轉錄中」：歌詞照跟唱規則逐字亮，底下一條波浪的 RNA 跟著唱到的地方長出去。
//  - 左下角的讀數：樣本編號、解旋進度、鹼基對數，註腳「鹼基配對：A–T、G–C、宣–孟」。
//  - 沒有留言：螺旋上是「宣文♥孟庭」，下面邀請大家把祝福編進基因。純音樂：轉錄欄寫樣本歌曲。
// 畫法：CPU 算 3D 點、自己投影（輕微透視），前後兩批 LineBatch（後面的先畫、字在中間、前面的最後畫），字用 Canvas2D。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, layout, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, prog, hash, smoothstep, TAU } from '../engine/util';
import { fitText } from '../engine/text';
import { Lyrics } from '../engine/lyrics';
import { sparkHead, sparkParticles, lyricAt, drawLyric, layoutLyric, beatAfter, signature, COUPLE_ZH } from './_motifs';
import { stagger, bbox, pad3, mono, type Rect } from './_t11';

export const spec: PlateSpecDecl = { group: 'type', family: 'science', paper: false, energy: [0.3, 0.9], bars: [4, 12], weight: 1 };

/** 字排在這個範圍（右下角 QR 的上面、左邊留給 5′ 標籤；下緣留給左下角的即時小卡）。 */
const BOX = { x: 164, y: 300, w: 1170, h: 420 };
/** 螺旋從畫面外延伸到畫面外。 */
const X_MIN = -80, X_MAX = W + 80;
/** 透視：鏡頭到螺旋軸的距離（px）。 */
const CAM_D = 1500;
const LYR = { x: 124, y: 236, w: 1220, size: 70 };
const FAM_MSG = F.hand(700);
const INVITE = '掃描右下角 QR code，把你的祝福編進我們的基因。';
const FOOT = '鹼基配對：A–T、G–C、宣–孟';
const PAIRS = [['A', 'T'], ['T', 'A'], ['G', 'C'], ['C', 'G']] as const;

const BG = () => new FSPass(/* glsl */ `
  uniform float k;
  void main() {
    vec2 p = FRAG_PX;
    // 很暗的底，中間（螺旋那一帶）稍微浮起來一點，像顯微鏡下的視野
    float band = exp(-pow((${H}.0 - p.y - 580.0) / 360.0, 2.0));
    vec3 col = C_INK + (C_INK2 - C_INK) * (0.35 + 0.65 * band) * (0.8 + 0.4 * fbm(p / 460.0, 3));
    // 很淡的刻度線（每 100 px 一條直線，像載玻片上的格子）
    float gx = abs(mod(p.x - 64.0, 100.0) - 50.0);
    col += C_GRAPHITE * pxLine(50.0 - gx, 0.3, 1.0) * 0.035 * k;
    fragColor = vec4(col, 1.0);
  }`, { k: { value: 1 } });

interface Rung { cx: number; ch: string | null; t: number; pair: readonly [string, string] }
interface Row { y: number; rungs: Rung[]; x0: number; x1: number; knots: [number, number][]; tStart: number; tEnd: number }

export default class Dna extends Scene {
  bg = shared('dna.bg', BG);
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  back = this.track(new LineBatch(4096, { screen2D: true, blend: 'normal' }));
  front = this.track(new LineBatch(4096, { screen2D: true, blend: 'normal' }));
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 733 + (this.msg?.id ?? 0) * 17) >>> 0;
  rows: Row[] = [];
  S = 60; R = 57; omega = 0.01;
  sig = ''; sigT = Infinity; sigX = 0; sigY = 0;
  total = 0;
  lyricsInWindow = false;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const text = m ? m.text : COUPLE_ZH.replace(/\s*&\s*/, '♥');
    this.sig = m ? (m.couple ? '—— 新郎新娘' : signature(m.name)) : '';
    await loadText(`${text}${this.sig}${INVITE}${FOOT}${song.title}${song.artist}mRNA轉錄中樣本歌曲宣文孟庭解旋進度鹼基對`);
    const c = this.layer.ctx;

    // ---- 排字：一到三行，行距要放得下螺旋的直徑（字級 × 2.5）
    const fit = fitText(c, text, FAM_MSG, BOX.w, BOX.h, { min: 44, max: 96, lineHeight: 2.45, maxLines: 3 });
    const S = this.S = fit.size;
    this.R = S * 0.98;
    this.omega = TAU / (10 * S * 1.02);
    const beat = au.beatPeriod(s);
    const tFirst = beatAfter(au, s + Math.min(0.2, beat * 0.4));
    const bar = au.timeOfBar(au.barAt(tFirst) + 1) - tFirst;
    const n = fit.lines.reduce((k, l) => k + Array.from(l).length, 0);
    this.total = n;
    const times = stagger(au, tFirst + beat * 0.5, n, Math.min(2.25 * bar, 0.45 * (e - s)));
    const y0 = BOX.y + BOX.h / 2 - ((fit.lines.length - 1) * fit.lineHeight) / 2;
    let k = 0;
    fit.lines.forEach((ln, li) => {
      const lay = layout(ln, FAM_MSG, S);
      const y = y0 + li * fit.lineHeight;
      const rungs: Rung[] = [];
      const pair = (i: number) => PAIRS[Math.floor(hash(this.seed, li, i) * 4)]!;
      // 左邊的空梯子（字前面）、字、右邊的空梯子，間距都是一個字寬
      const x0 = BOX.x, step = S * 1.02;
      for (let x = x0 - step / 2, i = 0; x > X_MIN; x -= step, i++) rungs.unshift({ cx: x, ch: null, t: 0, pair: pair(-1 - i) });
      const knots: [number, number][] = [];
      for (const g of lay.glyphs) {
        const cx = x0 + g.x + g.w / 2, t = times[k++]!;
        rungs.push({ cx, ch: g.ch === ' ' ? null : g.ch, t, pair: pair(g.i) });
        knots.push([t, x0 + g.x + g.w + S * 0.12]);
      }
      const x1 = x0 + lay.width;
      for (let x = x1 + step / 2, i = 0; x < X_MAX; x += step, i++) rungs.push({ cx: x, ch: null, t: 0, pair: pair(1000 + i) });
      const tStart = knots[0]?.[0] ?? tFirst;
      this.rows.push({ y, rungs, x0, x1, knots, tStart, tEnd: knots[knots.length - 1]?.[0] ?? tStart });
    });
    const last = this.rows[this.rows.length - 1]!;
    this.sigT = last.tEnd + beat * 0.75;
    this.sigX = Math.min(BOX.x + BOX.w, Math.max(...this.rows.map((r) => r.x1)));
    this.sigY = last.y + this.R + 62;
    this.lyricsInWindow = lyrics.linesIn(s, e).length > 0;

    // ---- 即時小卡避開：字的每一行（連螺旋的上下）、署名、歌詞
    const rowsR = bbox(this.rows.map((r): Rect => [r.x0 - 20, r.y - this.R - 14, r.x1 - r.x0 + 40, 2 * this.R + 28]));
    const sigR: Rect = [this.sigX - 420, this.sigY - 48, 440, 70];
    this.avoid = [rowsR, rowsR, m ? sigR : [BOX.x, this.sigY - 50, 1200, 80]];
    if (this.lyricsInWindow) {
      let rows = 1;
      for (const line of lyrics.linesIn(s, e)) rows = Math.max(rows, layoutLyric(c, line, { family: F.archivo(100, 800), size: LYR.size, minSize: 48, maxWidth: LYR.w }).rows.length);
      const r: Rect = [LYR.x - 10, LYR.y - LYR.size - 10, LYR.w + 20, LYR.size * (rows > 1 ? 2.3 : 1.2) + 40];
      this.avoid.push(r, r);
    }
  }

  /** 解旋酶（分叉點）在這一行的位置：每到一個字的時間就「推」到那個字後面（0.16 秒 outExpo），之間停住。 */
  private fork(row: Row, t: number): number {
    const K = row.knots;
    if (!K.length) return X_MIN - 400;
    const z = this.S * 2.2;
    // 第一個字之前：從畫面左邊外面衝進來
    const t0 = K[0]![0];
    if (t < t0 - 0.35) return X_MIN - z - 40;
    if (t < t0) return lerp(X_MIN - z - 40, K[0]![1] - this.S, ease.outExpo(prog(t, t0 - 0.35, t0 - 0.02)));
    let i = 0;
    while (i + 1 < K.length && K[i + 1]![0] <= t) i++;
    const [ti, xi] = K[i]!;
    const prev = i > 0 ? K[i - 1]![1] : K[0]![1] - this.S;
    return lerp(prev, xi, ease.outExpo(clamp((t - ti) / 0.16)));
  }

  /** 螺旋在 x 處的扭轉角：分叉點左邊是 0（攤平），右邊慢慢扭起來，再加上整條一拍一拍的轉動。 */
  private phi(x: number, xf: number, spin: number): number {
    const w = smoothstep(0, this.S * 2.2, x - xf);
    return w * (this.omega * (x - xf) + spin);
  }

  /** 3D → 螢幕（輕微透視，消失點在畫面中央）。 */
  private proj(x: number, y: number, z: number) {
    const k = CAM_D / (CAM_D - z);
    return { x: W / 2 + (x - W / 2) * k, y: H / 2 + (y - H / 2) * k, k };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const fadeIn = prog(t, s, s + 0.35), exit = prog(t, e - 0.35, e, ease.inCubic);
    const vis = fadeIn * (1 - exit);
    this.bg.u.k!.value = vis;
    this.bg.render(renderer, out);
    const L = this.layer, c = L.ctx;
    L.clear();
    this.back.clear(); this.front.clear(); this.glow.clear();
    c.globalAlpha = vis;

    // 扭著的部分每一拍「喀」地擰一下再彈回來（0.03 秒擰緊、0.25 秒鬆開），小節線擰得比較大。
    // 不讓它一直累積轉下去：解開的地方是固定的，累積的扭轉會全擠在分叉點旁邊變成鋸齒。
    const bi = Math.floor(au.beatAt(t)), age = t - au.timeOfBeat(bi);
    const down = Math.abs(au.barAt(au.timeOfBeat(bi)) - Math.round(au.barAt(au.timeOfBeat(bi)))) < 0.05;
    const spin = -(down ? 0.75 : 0.42) * (1 - Math.exp(-age / 0.03)) * Math.exp(-age / 0.25) - 0.08 * f.a.snare;
    const S = this.S, R = this.R;
    const A = LIN.bone, B = LIN.signal;
    let pen: { x: number; y: number } | null = null;
    let revealed = 0;

    for (const row of this.rows) {
      const xf = this.fork(row, t);
      if (t >= row.tStart - 0.35 && t < row.tEnd + 0.45 && xf > X_MIN) pen = this.proj(xf, row.y, 0);
      // ---- 兩股（每 S/4 取一點）
      const stepX = S / 4;
      let pa = null as null | { x: number; y: number; z: number }, pb = null as null | { x: number; y: number; z: number };
      for (let x = X_MIN; x <= X_MAX; x += stepX) {
        const ph = this.phi(x, xf, spin), cs = Math.cos(ph), sn = Math.sin(ph);
        const qa = { x, y: row.y - R * cs, z: R * sn }, qb = { x, y: row.y + R * cs, z: -R * sn };
        if (pa && pb) {
          this.strand(pa, qa, A, 1, vis);
          this.strand(pb, qb, B, 1.9, vis);
        }
        pa = qa; pb = qb;
      }
      // ---- 鹼基對
      for (const r of row.rungs) {
        const ph = this.phi(r.cx, xf, spin), cs = Math.cos(ph), sn = Math.sin(ph);
        const shown = r.ch !== null && t >= r.t && ph === 0;
        if (r.ch && t >= r.t) revealed++;
        const gap = shown ? S * 0.64 : 5;
        for (const side of [-1, 1] as const) {
          // 從軸心往這一股的方向：留一段空隙給字（或氫鍵的小縫）
          const dy = side * cs, dz = -side * sn;
          const a = this.proj(r.cx, row.y + dy * gap, dz * gap), b = this.proj(r.cx, row.y + dy * R, dz * R);
          const zc = dz * R;
          const dk = (zc / R + 1) / 2;
          const col = side < 0 ? A : B, gain = (side < 0 ? 0.55 : 0.8) * (0.3 + 0.7 * dk) * vis;
          const lb = zc > 0.5 ? this.front : this.back;
          lb.seg2(a.x, a.y, b.x, b.y, 1.6 + 1.4 * dk, [col[0] * gain, col[1] * gain, col[2] * gain], 1);
          // 還沒讀到的鹼基對：小小的 A–T、G–C（深度越遠越淡）
          if (!shown && Math.abs(cs) > 0.25 && r.cx > 60 && r.cx < W - 60) {
            const m = this.proj(r.cx, row.y + dy * R * 0.5, dz * R * 0.5);
            c.save();
            c.globalAlpha = vis * (0.18 + 0.5 * dk) * clamp((Math.abs(cs) - 0.25) * 3);
            c.font = font(F.mono(500), Math.max(11, S * 0.24) * m.k);
            c.fillStyle = side < 0 ? rgba('bone') : rgba('signal');
            c.textAlign = 'center';
            c.fillText(r.pair[side < 0 ? 0 : 1], m.x, m.y + S * 0.08);
            c.restore();
          }
        }
        // 字：攤平的那一刻燒紅出現（彈一下），0.4 秒冷卻成紙白
        if (shown) {
          const age = t - r.t;
          const heat = 1 - clamp(age / 0.4);
          const sc = 0.7 + 0.3 * ease.outBack(clamp(age / 0.22));
          c.save();
          c.translate(r.cx, row.y);
          c.scale(sc, sc);
          c.font = font(FAM_MSG, S);
          c.textAlign = 'center';
          const base = r.ch === '♥' ? 'rose' : 'bone';
          c.fillStyle = heat > 0 ? mixRgba(base, 'signal', heat) : rgba(base);
          c.fillText(r.ch!, 0, S * 0.36);
          c.restore();
        }
      }
      // 5′ / 3′ 標籤（左邊）
      mono(c, "5′", 100, row.y - R - 8, { size: 14, color: rgba('ash', 0.7 * vis), tracking: 1 });
      mono(c, "3′", 100, row.y + R + 20, { size: 14, color: rgba('signal', 0.8 * vis), tracking: 1 });
    }

    this.lyric(c, t);
    this.readout(c, t, revealed);
    if (this.msg && t >= this.sigT) {
      c.save(); c.globalAlpha = vis * prog(t, this.sigT, this.sigT + 0.3);
      c.font = font(F.hand(400), 42); c.fillStyle = rgba('ash'); c.textAlign = 'right';
      c.fillText(this.sig, this.sigX, this.sigY);
      c.restore();
    }
    if (!this.msg) {
      const t0 = this.rows[this.rows.length - 1]!.tEnd;
      c.save(); c.globalAlpha = vis * prog(t, t0, t0 + 0.4);
      c.font = font(F.hand(700), 46); c.fillStyle = rgba('bone', 0.9);
      c.fillText(INVITE, BOX.x, this.sigY + 10);
      c.restore();
    }

    this.back.render(renderer, out);
    comp.draw(renderer, L.upload(), out);
    this.front.render(renderer, out);
    if (pen && exit < 0.5) {
      const p = pen;
      sparkParticles(this.glow, t, () => p, { rate: 90, life: 0.35, speed: 200, seed: this.seed });
      sparkHead(this.glow, p.x, p.y, t, 1.1);
    }
    if (this.glow.count) this.glow.render(renderer, out);
    return { bloom: 0.7, vignette: 0.45, halation: 0.25, zoom: 1 + 0.006 * f.a.kick, popupAvoid: this.avoid };
  }

  /** 一段股（3D 兩點），依深度決定寬度、亮度，前面的放 front、後面的放 back。訊號色那股加一層淡淡的光。 */
  private strand(p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number }, col: [number, number, number], gain: number, vis: number) {
    const a = this.proj(p.x, p.y, p.z), b = this.proj(q.x, q.y, q.z);
    const zc = (p.z + q.z) / 2, dk = (zc / this.R + 1) / 2;
    const g = gain * (0.28 + 0.72 * dk) * vis;
    const lb = zc > 0.5 ? this.front : this.back;
    lb.seg2(a.x, a.y, b.x, b.y, (2.4 + 2.6 * dk) * a.k, [col[0] * g, col[1] * g, col[2] * g], 1);
    if (gain > 1.2 && dk > 0.55) this.glow.seg2(a.x, a.y, b.x, b.y, 10 * a.k, [col[0] * 0.18 * vis, col[1] * 0.18 * vis, col[2] * 0.18 * vis], 0.6);
  }

  /** mRNA 轉錄中：歌詞逐字亮，下面一條波浪的 RNA 跟著唱到的地方長出去。 */
  private lyric(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    mono(c, this.lyricsInWindow ? 'mRNA ▸ 轉錄中' : 'mRNA ▸ 樣本歌曲', LYR.x, 136, { size: 15, tracking: 4, color: rgba('signal', 0.85) });
    const ly = lyricAt(lyrics, t);
    if (!ly) {
      if (!this.lyricsInWindow) {
        c.font = font(F.archivo(100, 700), 56); c.fillStyle = rgba('bone', 0.85);
        c.fillText(song.title, LYR.x, LYR.y - 8);
      }
      return;
    }
    const st = { family: F.archivo(100, 800), size: LYR.size, minSize: 48, maxWidth: LYR.w };
    const lay = layoutLyric(c, ly.line, st);
    const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.1));
    const top = LYR.y - (lay.height - lay.size) + (1 - inK) * 16;
    c.save(); c.translate(LYR.x, top);
    const head = drawLyric(c, ly.line, t, st, lay, ly.k * c.globalAlpha);
    c.restore();
    // RNA：從行首長到唱到的地方（唱完的行整條），一個字一個波
    const done = Lyrics.lineCharProgress(ly.line, t) >= ly.line.text.length;
    const hr = head ? Math.round((head.y - lay.size * 0.12) / (lay.size * 1.18)) : done ? lay.rows.length : -1;
    c.save();
    c.globalAlpha *= ly.k;
    c.strokeStyle = rgba('signal', 0.75); c.lineWidth = 2.2;
    lay.rows.forEach((row, ri) => {
      const xe = ri < hr ? row.x + row.width : ri === hr && head ? head.x : -Infinity;
      if (xe <= row.x + 4) return;
      const yb = top + row.y + 26;
      c.beginPath();
      for (let x = row.x; x <= xe; x += 4) {
        const y = yb + Math.sin(x / 11 - t * 6) * 5;
        if (x === row.x) c.moveTo(LYR.x + x, y); else c.lineTo(LYR.x + x, y);
      }
      c.stroke();
    });
    c.restore();
  }

  /** 左下角的讀數。 */
  private readout(c: CanvasRenderingContext2D, t: number, revealed: number) {
    const m = this.msg;
    const pct = this.total ? Math.round((100 * revealed) / this.total) : 0;
    const line1 = `SEQ No.${m ? pad3(m.n) : '000'}${m?.couple ? '  ·  FROM THE COUPLE' : ''}  ·  樣本：宣文 × 孟庭  ·  解旋 ${String(pct).padStart(3, ' ')}%  ·  鹼基對 ${revealed}/${this.total}`;
    mono(c, line1, 124, 952, { size: 15, tracking: 2, color: rgba('ash', 0.75) });
    mono(c, `${FOOT}　·　相容性 100.0%`, 124, 980, { size: 15, tracking: 2, color: rgba('ash', 0.55) });
    void t;
  }
}
