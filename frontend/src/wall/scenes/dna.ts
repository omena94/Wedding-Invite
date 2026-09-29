// 雙螺旋（暗）：一到三條橫躺的 DNA 雙股螺旋，兩股是兩個人（紙白的一股是宣文、訊號色的一股是孟庭），
// 每一格鹼基對上坐著主打留言的一個字。
// MV 版：鏡頭從左前方斜斜看過去（右邊比較遠），整個窗格慢慢繞到比較正面；小字只剩上面的「mRNA」與下面一行註腳。
//  - 開場時整條都是扭著的（每一拍「喀」地擰一下再彈回來）。
//  - 第一拍起，解旋酶（仙女棒的火花）從左邊衝進來，一拍（或半拍、四分之一拍）往右推一格：火花經過的地方螺旋被解開、
//    攤平成一條正對鏡頭的梯子，那一格的鹼基對換成留言的字（燒紅、冷卻成紙白）。字永遠坐在攤平的梯子上，所以讀得清楚。
//    一行推完換下一行；推完的右邊繼續扭著轉。
//  - 上面是「mRNA 轉錄中」：歌詞照跟唱規則逐字亮，底下一條波浪的 RNA 跟著唱到的地方長出去。
//  - 歌詞比留言小一級；左下一行註腳「鹼基配對：A–T、G–C、宣–孟」。
//  - 沒有留言：歌詞放大成焦點，螺旋小小地寫著「宣文♥孟庭」，下面一行邀請。純音樂：轉錄欄寫樣本歌曲。
// 畫法：CPU 算 3D 點、自己投影（輕微透視），前後兩批 LineBatch（後面的先畫、字在中間、前面的最後畫），字用 Canvas2D。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, layout, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, prog, smoothstep, TAU } from '../engine/util';
import { fitText } from '../engine/text';
import { Lyrics } from '../engine/lyrics';
import { sparkHead, sparkParticles, lyricAt, drawLyric, layoutLyric, beatAfter, signature, COUPLE_ZH } from './_motifs';
import { stagger, mono, tag } from './_t11';

export const spec: PlateSpecDecl = { group: 'type', family: 'science', paper: false, energy: [0.3, 0.9], bars: [4, 12], weight: 1 };

/** 字排在這個範圍（有留言／沒有留言）。左緣 184：鏡頭斜看時左邊比較近、會放大，投影後仍離邊 96 px 以上。 */
const BOX_M = { x: 184, y: 330, w: 1380, h: 450 };
const BOX_N = { x: 184, y: 590, w: 1000, h: 170 };
/** 螺旋從畫面外延伸到畫面外。 */
const X_MIN = -80, X_MAX = W + 80;
/** 透視：鏡頭到螺旋軸的距離（px）。 */
const CAM_D = 1500;
/** 歌詞：有留言時在上方（比留言小一級），沒有留言時放大。 */
const LYR_M = { x: 124, y: 226, w: 1560 };
const LYR_N = { x: 124, y: 420, w: 1560, size: 104 };
/** 鏡頭的左右轉角（窗格開始 → 結束）。 */
const YAW = [0.14, 0.05] as const;
const FAM_MSG = F.hand(700);
const INVITE = '掃描右下角 QR code，把你的祝福編進我們的基因。';
const FOOT = '鹼基配對：A–T、G–C、宣–孟　·　相容性 100.0%';

const BG = () => new FSPass(/* glsl */ `
  uniform float k;
  void main() {
    vec2 p = FRAG_PX;
    // 很暗的底，中間（螺旋那一帶）稍微浮起來一點，像顯微鏡下的視野
    float band = exp(-pow((${H}.0 - p.y - 580.0) / 360.0, 2.0));
    vec3 col = C_INK + (C_INK2 - C_INK) * (0.3 + 0.6 * band) * (0.85 + 0.3 * fbm(p / 520.0, 3)) * (0.6 + 0.4 * k);
    fragColor = vec4(col, 1.0);
  }`, { k: { value: 1 } });

interface Rung { cx: number; ch: string | null; t: number }
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
  lyricsInWindow = false;
  lyrSize = 64;
  /** 這一格的鏡頭左右轉角（render 一開始算好，proj 用）。 */
  yaw: number = YAW[0];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const text = m ? m.text : COUPLE_ZH.replace(/\s*&\s*/, '♥');
    this.sig = m ? (m.couple ? '—— 新郎新娘' : signature(m.name)) : '';
    await loadText(`${text}${this.sig}${INVITE}${FOOT}${song.title}${song.artist}mRNA轉錄中樣本歌曲`);
    const c = this.layer.ctx;

    // ---- 排字：一到三行，行距要放得下螺旋的直徑（字級 × 2.5）
    const BOX = m ? BOX_M : BOX_N;
    // 右邊比較遠（透視縮小約一成），字級下限放高一點
    // 有留言時字級依「可用高度扣掉署名」算：署名永遠在最後一行螺旋的下面、不重疊
    const fit = fitText(c, text, FAM_MSG, BOX.w, BOX.h - (m ? 70 : 0), { min: 50, max: m ? 104 : 60, lineHeight: 2.45, maxLines: 3 });
    const S = this.S = fit.size;
    this.R = S * 0.98;
    this.omega = TAU / (10 * S * 1.02);
    const beat = au.beatPeriod(s);
    const tFirst = beatAfter(au, s + Math.min(0.2, beat * 0.4));
    const bar = au.timeOfBar(au.barAt(tFirst) + 1) - tFirst;
    const n = fit.lines.reduce((k, l) => k + Array.from(l).length, 0);
    const times = stagger(au, tFirst + beat * 0.5, n, Math.min(2.25 * bar, 0.45 * (e - s)));
    const y0 = BOX.y + BOX.h / 2 - ((fit.lines.length - 1) * fit.lineHeight) / 2;
    let k = 0;
    fit.lines.forEach((ln, li) => {
      const lay = layout(ln, FAM_MSG, S);
      const y = y0 + li * fit.lineHeight;
      const rungs: Rung[] = [];
      // 左邊的空梯子（字前面）、字、右邊的空梯子，間距都是一個字寬
      const x0 = BOX.x, step = S * 1.02;
      for (let x = x0 - step / 2; x > X_MIN; x -= step) rungs.unshift({ cx: x, ch: null, t: 0 });
      const knots: [number, number][] = [];
      for (const g of lay.glyphs) {
        const cx = x0 + g.x + g.w / 2, t = times[k++]!;
        rungs.push({ cx, ch: g.ch === ' ' ? null : g.ch, t });
        knots.push([t, x0 + g.x + g.w + S * 0.12]);
      }
      const x1 = x0 + lay.width;
      for (let x = x1 + step / 2; x < X_MAX; x += step) rungs.push({ cx: x, ch: null, t: 0 });
      const tStart = knots[0]?.[0] ?? tFirst;
      this.rows.push({ y, rungs, x0, x1, knots, tStart, tEnd: knots[knots.length - 1]?.[0] ?? tStart });
    });
    const last = this.rows[this.rows.length - 1]!;
    this.sigT = last.tEnd + beat * 0.75;
    this.sigX = Math.min(BOX.x + BOX.w, Math.max(...this.rows.map((r) => r.x1)));
    this.sigY = last.y + this.R + 62;
    this.lyricsInWindow = lyrics.linesIn(s, e).length > 0;
    this.lyrSize = Math.round(clamp(S * 0.72, 48, 64));
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

  /** 3D → 螢幕：鏡頭左右轉 yaw（右邊比較遠），再加輕微透視（消失點在畫面中央）。 */
  private proj(x: number, y: number, z: number) {
    const dx = x - W / 2, cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const k = CAM_D / (CAM_D - (z - dx * sy));
    return { x: W / 2 + dx * cy * k, y: H / 2 + (y - H / 2) * k, k };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const fadeIn = prog(t, s, s + 0.35), exit = prog(t, e - 0.35, e, ease.inCubic);
    const vis = fadeIn * (1 - exit);
    // 鏡頭：整個窗格從左前方慢慢繞到比較正面（inOutSine）
    const u = (1 - Math.cos(Math.PI * clamp((t - s) / Math.max(1, e - s)))) / 2;
    this.yaw = lerp(YAW[0], YAW[1], u);
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

    for (const row of this.rows) {
      const xf = this.fork(row, t);
      if (t >= row.tStart - 0.35 && t < row.tEnd + 0.45 && xf > X_MIN) pen = this.proj(xf, row.y, 0);
      // ---- 兩股（每 S/4 取一點）；畫面右邊遠處淡一點（景深），字附近攤平的梯子也不搶字
      const stepX = S / 4;
      let pa = null as null | { x: number; y: number; z: number }, pb = null as null | { x: number; y: number; z: number };
      for (let x = X_MIN; x <= X_MAX; x += stepX) {
        const ph = this.phi(x, xf, spin), cs = Math.cos(ph), sn = Math.sin(ph);
        const qa = { x, y: row.y - R * cs, z: R * sn }, qb = { x, y: row.y + R * cs, z: -R * sn };
        if (pa && pb) {
          const far = 1 - 0.5 * smoothstep(1350, 1950, x);
          this.strand(pa, qa, A, 0.62 * far, vis);
          this.strand(pb, qb, B, 1.25 * far, vis);
        }
        pa = qa; pb = qb;
      }
      // ---- 鹼基對
      for (const r of row.rungs) {
        const ph = this.phi(r.cx, xf, spin), cs = Math.cos(ph), sn = Math.sin(ph);
        const shown = r.ch !== null && t >= r.t && ph === 0;
        const gap = shown ? S * 0.64 : 5;
        const far = 1 - 0.5 * smoothstep(1350, 1950, r.cx);
        for (const side of [-1, 1] as const) {
          // 從軸心往這一股的方向：留一段空隙給字（或氫鍵的小縫）
          const dy = side * cs, dz = -side * sn;
          const a = this.proj(r.cx, row.y + dy * gap, dz * gap), b = this.proj(r.cx, row.y + dy * R, dz * R);
          const zc = dz * R;
          const dk = (zc / R + 1) / 2;
          const col = side < 0 ? A : B, gain = (side < 0 ? 0.36 : 0.5) * (0.3 + 0.7 * dk) * vis * far;
          const lb = zc > 0.5 ? this.front : this.back;
          lb.seg2(a.x, a.y, b.x, b.y, (1.4 + 1.2 * dk) * a.k, [col[0] * gain, col[1] * gain, col[2] * gain], 1);
        }
        // 字：攤平的那一刻燒紅出現（彈一下），0.4 秒冷卻成紙白；跟著鏡頭的透視放大縮小
        if (shown) {
          const age = t - r.t;
          const heat = 1 - clamp(age / 0.4);
          const p = this.proj(r.cx, row.y, 0);
          const sc = (0.7 + 0.3 * ease.outBack(clamp(age / 0.22))) * p.k;
          c.save();
          c.translate(p.x, p.y);
          c.scale(sc, sc);
          c.font = font(FAM_MSG, S);
          c.textAlign = 'center';
          const base = r.ch === '♥' ? 'rose' : 'bone';
          c.fillStyle = heat > 0 ? mixRgba(base, 'signal', heat) : rgba(base);
          c.fillText(r.ch!, 0, S * 0.36);
          c.restore();
        }
      }
    }

    this.lyric(c, t);
    // 註腳：整個畫面只有上面的「mRNA」與這一行小字
    tag(c, FOOT, 124, 980, { size: 17, color: rgba('ash', 0.5), tracking: 2 });
    if (this.msg && t >= this.sigT) {
      const p = this.proj(this.sigX, this.sigY, 0);
      c.save(); c.globalAlpha = vis * prog(t, this.sigT, this.sigT + 0.3);
      c.font = font(F.hand(400), Math.round(44 * p.k)); c.fillStyle = rgba('ash'); c.textAlign = 'right';
      // 署名低到右下角 QR 那一帶時，右緣收到 x = 1330
      c.fillText(this.sig, p.y > 800 ? Math.min(p.x, 1330) : p.x, p.y);
      c.restore();
    }
    if (!this.msg) {
      const t0 = this.rows[this.rows.length - 1]!.tEnd;
      const p = this.proj(BOX_N.x, this.sigY + 6, 0);
      c.save(); c.globalAlpha = vis * prog(t, t0, t0 + 0.4);
      c.font = font(F.hand(700), 34); c.fillStyle = rgba('ash', 0.9);
      c.fillText(INVITE, p.x, p.y);
      c.restore();
    }

    this.back.render(renderer, out);
    comp.draw(renderer, L.upload(), out);
    this.front.render(renderer, out);
    if (pen && exit < 0.5) {
      const p = pen;
      sparkParticles(this.glow, t, () => p, { rate: 80, life: 0.32, speed: 190, seed: this.seed });
      sparkHead(this.glow, p.x, p.y, t, 1.0);
    }
    if (this.glow.count) this.glow.render(renderer, out);
    return { bloom: 0.65, vignette: 0.5, halation: 0.22, zoom: 1 + 0.004 * f.a.kick };
  }

  /** 一段股（3D 兩點），依深度決定寬度、亮度，前面的放 front、後面的放 back。訊號色那股加一層很淡的光。 */
  private strand(p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number }, col: [number, number, number], gain: number, vis: number) {
    const a = this.proj(p.x, p.y, p.z), b = this.proj(q.x, q.y, q.z);
    const zc = (p.z + q.z) / 2, dk = (zc / this.R + 1) / 2;
    const g = gain * (0.25 + 0.75 * dk) * vis;
    const lb = zc > 0.5 ? this.front : this.back;
    lb.seg2(a.x, a.y, b.x, b.y, (2 + 2.2 * dk) * a.k, [col[0] * g, col[1] * g, col[2] * g], 1);
    if (gain > 1 && dk > 0.6) this.glow.seg2(a.x, a.y, b.x, b.y, 9 * a.k, [col[0] * 0.08 * vis, col[1] * 0.08 * vis, col[2] * 0.08 * vis], 0.6);
  }

  /** mRNA 轉錄中：歌詞逐字亮（有留言時比留言小一級，沒有留言時放大成焦點），下面一條波浪的 RNA 跟著唱到的地方長出去。 */
  private lyric(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    const box = this.msg ? { ...LYR_M, size: this.lyrSize } : LYR_N;
    mono(c, this.lyricsInWindow ? 'mRNA ▸ 轉錄中' : 'mRNA ▸ 樣本歌曲', box.x, 134, { size: 15, tracking: 4, color: rgba('signal', 0.6) });
    const ly = lyricAt(lyrics, t, 1.6);
    if (!ly) {
      if (!this.lyricsInWindow) {
        c.font = font(F.archivo(100, 700), Math.round(box.size * 0.85)); c.fillStyle = rgba('bone', 0.85);
        c.fillText(song.title, box.x, box.y - 8);
      }
      return;
    }
    const st = { family: F.archivo(100, 800), size: box.size, minSize: 48, maxWidth: box.w };
    const lay = layoutLyric(c, ly.line, st);
    const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.1));
    const top = box.y - (lay.height - lay.size) + (1 - inK) * 16;
    c.save(); c.translate(box.x, top);
    const head = drawLyric(c, ly.line, t, st, lay, ly.k * c.globalAlpha);
    c.restore();
    // RNA：從行首長到唱到的地方（唱完的行整條），一個字一個波
    const done = Lyrics.lineCharProgress(ly.line, t) >= ly.line.text.length;
    const hr = head ? Math.round((head.y - lay.size * 0.12) / (lay.size * 1.18)) : done ? lay.rows.length : -1;
    c.save();
    c.globalAlpha *= ly.k * 0.8;
    c.strokeStyle = rgba('signal', 0.6); c.lineWidth = 2;
    lay.rows.forEach((row, ri) => {
      const xe = ri < hr ? row.x + row.width : ri === hr && head ? head.x : -Infinity;
      if (xe <= row.x + 4) return;
      const yb = top + row.y + 24;
      c.beginPath();
      for (let x = row.x; x <= xe; x += 4) {
        const y = yb + Math.sin(x / 11 - t * 6) * 4;
        if (x === row.x) c.moveTo(box.x + x, y); else c.lineTo(box.x + x, y);
      }
      c.stroke();
    });
    c.restore();
  }
}
