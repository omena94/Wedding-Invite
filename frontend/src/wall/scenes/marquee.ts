// LED 跑馬燈（暗）：夜裡店面騎樓上的 LED 點陣招牌，貼著台灣老公寓那種小口磁磚牆，下面是拉下一半的鐵捲門。
// 招牌是兩塊點陣（一格一顆燈，燈珠看得到、沒亮的也看得到）：
//  - 下面大的那塊＝主打留言（畫面的焦點）：第一拍整段從右邊衝進來（燒成訊號色）、停住冷卻成白燈；外框一圈跑燈，一個八分音符走一步。
//    字級照留言長短挑（短的一行大字、長的三行小一點），署名永遠在最下面一列靠右；還是放不下就一行一行上移（LED 招牌的換頁特效）。
//    沒有留言：兩行邀請，第二行跟著拍子閃。
//  - 上面細一點、燈珠密一點的那塊＝歌詞（比留言小一級）：句子從下面「上移」進來，唱到哪一欄燈就從暗變亮；
//    句子太長放不下，整條字跟著歌聲往左「跑」（唱到的字停在六成的位置）。句子之間的空檔／純音樂：歌名從右邊跑進來。
// 手法：每一格把招牌內容畫在「一顆燈一個像素」的小畫布上（R = 白燈、G = 訊號色燈、B = 愛心的燈），
// 全螢幕 shader 把它放大成一顆一顆圓燈（旁邊的燈會互相照亮一點點），順便算燈光打在磁磚與鐵捲門上的光；鏡頭整個窗格慢慢推近。
// 2026-09-29 依「MV 融合原則」：留言那塊放大成主角、歌詞那塊縮小變密；拿掉最上面那條英文跑馬（第三組字）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, pulse } from '../engine/util';
import { wrap } from '../engine/text';
import { Lyrics, type Line } from '../engine/lyrics';
import { layoutLyric, beatAfter, signature } from './_motifs';
import { DotCanvas, windowLines, fillGlyph, type Rect } from './_t9';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: false, energy: [0.35, 1], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 兩塊點陣（pitch：一格幾 px）
interface Strip { pitch: number; cols: number; rows: number; y: number; off: number; gain: number }
/** 歌詞：燈珠密、字小（16 點 × 3.4 px ≈ 54 px）。 */
const LS: Strip = { pitch: 3.4, cols: 400, rows: 20, y: 214, off: 0, gain: 0.85 };
/** 留言：燈珠大、字大（16～32 點 × 6 px）。 */
const MS: Strip = { pitch: 6, cols: 280, rows: 72, y: 330, off: 20, gain: 1 };
const STRIPS = [LS, MS];
const ROWS_ALL = MS.off + MS.rows;
const COLS_ALL = Math.max(LS.cols, MS.cols);
const x0Of = (st: Strip) => Math.round((W - st.cols * st.pitch) / 2);
/** 外殼比點陣大一圈。 */
const PAD = 16;
const housing = (st: Strip): Rect => [x0Of(st) - PAD, st.y - PAD, st.cols * st.pitch + 2 * PAD, st.rows * st.pitch + 2 * PAD];

const FAM = F.hei(500);
const LY_SIZE = 16, LY_BASE = 16;
/** 歌詞可以用的寬度（左右各留 3 格）。 */
const LY_W = LS.cols - 6;
/** 留言：外框一圈跑燈＋一格留白；第 2～52 列給留言，53～69 列給署名（16 點、靠右）。 */
const MSG_TOP = 2, MSG_ROWS = 51, SIG_BASE = 67, MS_W = MS.cols - 8;
const SIZES = [32, 26, 22, 18, 16];
const SHIFT = 0.2; // 上移換頁要幾秒
const HOLD = 1.4; // 唱完的句子留多久
const IDLE_SPEED = 60; // 空檔跑歌名：每秒幾格

const INVITE = ['掃描右下角 QR code', '把你的祝福送上跑馬燈'];

// ---------------------------------------------------------------- shader
const f1 = (x: number) => x.toFixed(1);
const BG = () => new FSPass(/* glsl */ `
  uniform sampler2D content;
  uniform float power; uniform float flick; uniform float kick; uniform float spill; uniform float t;
  vec3 lit(vec3 v) { return C_BONE * v.r + C_SIGNAL * 1.75 * v.g + C_ROSE * 1.25 * v.b; }
  vec3 cellAt(int x, int y, int off, int cols, int rows) {
    if (x < 0 || x >= cols || y < 0 || y >= rows) return vec3(0.0);
    return texelFetch(content, ivec2(x, y + off), 0).rgb;
  }
  // 一塊點陣（x0, y0：左上 px；pitch：燈距；off：內容畫布的起始列）
  void strip(vec2 p, float x0, float y0, float pitch, int cols, int rows, int off, float gain, inout vec3 col) {
    vec2 hs = vec2(float(cols), float(rows)) * pitch + ${2 * PAD}.0;
    vec2 hq = p - vec2(x0 - ${PAD}.0, y0 - ${PAD}.0);
    // 外殼：圓角的鋁框（上緣一條亮邊、下緣暗）、四角的螺絲
    float d = sdBox(hq - hs * 0.5, hs * 0.5 - 7.0) - 7.0;
    if (d > 3.0) return;
    float edge = aaFill(d);
    vec3 shell = mix(C_INK2 * 1.5, C_GRAPHITE * 0.3, smoothstep(0.0, hs.y, hs.y - hq.y) * 0.5);
    shell += C_BONE * 0.05 * pxLine(abs(hq.y - 1.5), 0.4, 1.4);
    shell *= 1.0 - 0.45 * pxLine(abs(d + 5.0), 0.5, 1.6);
    vec2 sc = vec2(min(hq.x, hs.x - hq.x), min(hq.y, hs.y - hq.y));
    shell += C_ASH * 0.2 * (1.0 - smoothstep(2.2, 3.4, length(sc - 8.0)));
    col = mix(col, shell, edge);
    vec2 q = (p - vec2(x0, y0)) / pitch;
    float fc = float(cols), fr = float(rows);
    if (q.x < -0.5 || q.y < -0.5 || q.x > fc + 0.5 || q.y > fr + 0.5) return;
    col = mix(col, C_INK * 0.45, edge);
    if (q.x < 0.0 || q.y < 0.0 || q.x >= fc || q.y >= fr) return;
    ivec2 cell = ivec2(floor(q));
    vec2 f = fract(q) - 0.5;
    float r = length(f);
    float aa = max(fwidth(r), 1e-3);
    float lens = 1.0 - smoothstep(0.36 - aa, 0.36 + aa, r);
    float on = step(float(cell.x), power * fc) * flick * gain;
    vec3 L = lit(cellAt(cell.x, cell.y, off, cols, rows) * on) * (1.0 + 0.1 * kick);
    // 沒亮的燈珠：暗暗的一顆，上面一點反光
    vec3 dark = (C_INK2 * 1.9 + C_GRAPHITE * 0.07) * (0.8 + 0.4 * smoothstep(0.3, -0.3, f.y));
    col = mix(col, dark, lens * 0.9);
    col += L * lens * (0.85 + 0.35 * smoothstep(0.36, 0.0, r));
    // 自己的光暈＋上下左右四顆的光溢出來一點（招牌看起來是「一片亮」，不是一堆孤立的點）
    col += L * exp(-r * r * 9.0) * 0.18;
    vec3 n = lit(cellAt(cell.x + 1, cell.y, off, cols, rows) * on) * exp(-pow(length(f - vec2(1.0, 0.0)), 2.0) * 7.0)
           + lit(cellAt(cell.x - 1, cell.y, off, cols, rows) * on) * exp(-pow(length(f + vec2(1.0, 0.0)), 2.0) * 7.0)
           + lit(cellAt(cell.x, cell.y + 1, off, cols, rows) * on) * exp(-pow(length(f - vec2(0.0, 1.0)), 2.0) * 7.0)
           + lit(cellAt(cell.x, cell.y - 1, off, cols, rows) * on) * exp(-pow(length(f + vec2(0.0, 1.0)), 2.0) * 7.0);
    col += n * 0.09;
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 招牌的光打在牆上：離兩塊點陣越遠越暗（留言那塊比較亮）
    float light = 0.0;
    ${STRIPS.map((st, i) => {
      const [x, y, w, h] = housing(st);
      return `{ vec2 c = vec2(${f1(x + w / 2)}, ${f1(y + h / 2)}); float d = max(sdBox(p - c, vec2(${f1(w / 2)}, ${f1(h / 2)})), 0.0); light += ${[0.5, 1][i]!.toFixed(2)} * exp(-d / 200.0); }`;
    }).join('\n    ')}
    light *= spill * power * flick;
    vec3 lamp = mix(C_SIGNAL, C_BONE, 0.45);
    vec3 col;
    if (p.y < 846.0) {
      // 小口磁磚：22 px 一片、2 px 的溝，每片的顏色有一點不一樣
      vec2 g = p / 22.0, id = floor(g), fq = fract(g);
      float h = hash12(id);
      float grout = max(pxLine(min(fq.x, 1.0 - fq.x) * 22.0, 0.7, 1.9), pxLine(min(fq.y, 1.0 - fq.y) * 22.0, 0.7, 1.9));
      vec3 alb = mix(C_GRAPHITE * 0.55, C_ASH * 0.62, h * h) * (0.9 + 0.1 * snoise(p / 90.0));
      alb = mix(alb, C_INK2, grout * 0.85);
      alb *= 0.92 + 0.12 * smoothstep(0.6, 0.0, fq.y) * (1.0 - grout);
      col = alb * (0.014 + lamp * (1.0 - exp(-light * light)) * 0.065);
    } else {
      // 鐵捲門：上面一個捲門箱，下面一條一條的橫肋
      vec3 alb;
      if (p.y < 874.0) {
        alb = C_GRAPHITE * 0.5 * (0.75 + 0.5 * smoothstep(874.0, 846.0, p.y));
        alb += C_BONE * 0.04 * pxLine(abs(p.y - 847.5), 0.4, 1.3);
      } else {
        float r = fract((p.y - 874.0) / 17.0);
        float prof = sin(r * PI);
        alb = C_GRAPHITE * (0.28 + 0.32 * prof * prof) + C_ASH * 0.05 * pxLine(abs(r - 0.25) * 17.0, 0.3, 1.2);
        alb *= 1.0 - 0.6 * pxLine(min(r, 1.0 - r) * 17.0, 0.4, 1.4);
      }
      col = alb * (0.018 + lamp * (1.0 - exp(-light)) * 0.1 * exp(-(p.y - 846.0) / 200.0));
    }
    ${STRIPS.map((st) => `strip(p, ${f1(x0Of(st))}, ${f1(st.y)}, ${f1(st.pitch)}, ${st.cols}, ${st.rows}, ${st.off}, ${f1(st.gain)}, col);`).join('\n    ')}
    fragColor = vec4(col, 1.0);
  }`, { content: { value: null }, power: { value: 1 }, flick: { value: 1 }, kick: { value: 0 }, spill: { value: 1 }, t: { value: 0 } });

/** R = 白燈、G = 訊號色燈、B = 愛心燈的亮度（0..1）→ 畫布的填色。 */
const led = (r: number, g = 0, b = 0) => `rgb(${Math.round(255 * clamp(r))},${Math.round(255 * clamp(g))},${Math.round(255 * clamp(b))})`;

/** 歌詞條的內容：一句歌詞，或空檔時跑歌名。t0 = 從這個時間開始（上移進來）。 */
interface Seg { kind: 'line' | 'idle'; line?: Line; t0: number }

export default class Marquee extends Scene {
  bg = shared('marquee.bg', BG);
  dots = this.track(new DotCanvas(COLS_ALL, ROWS_ALL));
  /** 不會動的東西（招牌的支架、電線、銘牌）：畫一次就好。 */
  still = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  segs: Seg[] = [];
  idleText = '';
  idleW = 0;
  /** 留言：字級（點）、行距、排好的行、署名、每一次上移的時間。 */
  size = 16; lh = 17; visible = 3;
  mLines: string[] = [];
  sig = '';
  tFirst = 0; tStop = 0;
  steps: number[] = [];
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.idleText = `♪ ${song.title}${song.artist ? ' — ' + song.artist : ''}　　`;
    this.sig = m ? (m.couple ? '—— 新郎新娘' : signature(m.name)) : '';
    await loadText(`${m?.text ?? ''}${this.sig}${this.idleText}${INVITE.join('')}本店祝福一律免費保固一輩子`);
    const c = this.dots.ctx;
    c.font = font(FAM, LY_SIZE);
    this.idleW = c.measureText(this.idleText).width;

    // ---- 歌詞條的時間表：每一句提早 0.25 秒上移進來；唱完留 HOLD 秒，下一句還很久才來就換成跑歌名
    const lines = windowLines(lyrics, s, e);
    this.segs = [{ kind: 'idle', t0: -Infinity }];
    for (const [i, ln] of lines.entries()) {
      const prev = lines[i - 1];
      const tIn = ln.start - 0.25;
      if (prev && tIn - (prev.end + HOLD) > 0.8) this.segs.push({ kind: 'idle', t0: prev.end + HOLD });
      this.segs.push({ kind: 'line', line: ln, t0: tIn });
    }
    const last = lines[lines.length - 1];
    if (last) this.segs.push({ kind: 'idle', t0: last.end + HOLD });

    // ---- 留言：挑放得下的最大字級（署名另外佔最下面一列）；最小的字級還放不下就一行一行上移
    const beat = au.beatPeriod(s);
    this.tFirst = beatAfter(au, s + Math.min(0.25, beat * 0.4));
    this.tStop = this.tFirst + clamp(beat * 1.25, 0.45, 0.9);
    const text = m ? m.text : null;
    if (text) {
      let chosen = false;
      for (const sz of SIZES) {
        const lh = sz >= 22 ? sz + 2 : sz + 1;
        c.font = font(FAM, sz);
        const ls = wrap(c, text, MS_W);
        if (ls.length * lh <= MSG_ROWS) { this.size = sz; this.lh = lh; this.mLines = ls; this.visible = ls.length; chosen = true; break; }
      }
      if (!chosen) {
        this.size = 16; this.lh = 17; this.visible = Math.floor(MSG_ROWS / 17);
        c.font = font(FAM, 16);
        this.mLines = wrap(c, text, MS_W);
      }
    } else { this.size = 18; this.lh = 22; this.mLines = INVITE; this.visible = 2; }
    // 上移：把剩下的時間平均分給每一行，對齊拍點
    const n = Math.max(0, this.mLines.length - this.visible);
    if (n > 0) {
      const t0 = this.tStop, t1 = e - 0.5;
      let prevT = t0;
      for (let k = 0; k < n; k++) {
        const want = t0 + ((t1 - t0) * (k + 1)) / (n + 1);
        const tb = Math.max(prevT + 0.4, au.nearestBeat(want));
        this.steps.push(tb);
        prevT = tb;
      }
    }
    this.drawStill();
    this.avoid = [housing(LS), housing(MS)];
  }

  /** 招牌的支架、電線、銘牌（畫一次）。 */
  private drawStill() {
    const L = this.still, c = L.ctx;
    L.clear();
    for (const st of STRIPS) {
      const [hx, hy, hw] = housing(st);
      for (const bx of [hx + 150, hx + hw - 150]) {
        // L 形支架：從上面的招牌（或牆）拉下來
        c.fillStyle = rgba('graphite', 0.5);
        c.fillRect(bx - 4, hy - 22, 8, 22);
        c.fillStyle = rgba('ash', 0.14);
        c.fillRect(bx - 4, hy - 22, 1.5, 22);
        c.fillStyle = rgba('graphite', 0.65);
        c.fillRect(bx - 12, hy - 26, 24, 6);
      }
    }
    // 電源線：從留言那塊右下垂到鐵捲門箱
    const [lx, ly, lw, lh] = housing(MS);
    c.strokeStyle = rgba('ink', 0.95); c.lineWidth = 5;
    c.beginPath(); c.moveTo(lx + lw - 40, ly + lh); c.bezierCurveTo(lx + lw - 20, ly + lh + 40, lx + lw + 20, 800, lx + lw + 6, 846); c.stroke();
    // 銘牌（冷面的規格，很小很淡）
    c.font = font(F.mono(500), 12); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.4);
    c.fillText(`LED ${MS.cols}×${MS.rows} · DC 12V · 保固：一輩子　·　本店祝福一律免費`, lx + 12, ly + lh + 20);
    c.letterSpacing = '0px';
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const D = this.dots, c = D.ctx;
    D.clear();
    // 每一格從同樣的畫布狀態開始（對齊、字型…不會被上一格留下來的設定影響）
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.textBaseline = 'alphabetic';
    this.lyricStrip(c, t);
    this.msgStrip(c, t, f);
    c.restore();

    const B = this.bg.u;
    B.content!.value = D.upload();
    B.power!.value = prog(t, s, s + 0.32);
    // 關機：最後 0.3 秒閃兩下再熄
    B.flick!.value = t > e - 0.3 ? (Math.floor((t - (e - 0.3)) / 0.075) % 2 === 0 ? 0.3 : 1) * (1 - prog(t, e - 0.06, e)) : 1;
    B.kick!.value = f.a.kick;
    B.spill!.value = 0.8 + 0.25 * f.a.rms;
    B.t!.value = t;
    this.bg.render(renderer, out);
    comp.draw(renderer, this.still.texture, out);
    const bar = au.barAt(t);
    const hit = pulse(t, au.timeOfBar(Math.floor(bar + 1e-4)), 0.18);
    // 鏡頭：整個窗格慢慢推近（強烈緩動的慢推），小節線上輕輕頂一下
    const push = ease.inOutCubic(clamp((t - s) / Math.max(1, e - s)));
    return { bloom: 0.85, bloomRadius: 0.6, vignette: 0.6, halation: 0.35, grain: 0.05, ca: 0.6, zoom: 1 + 0.045 * push + 0.005 * hit, popupAvoid: this.avoid };
  }

  // ------------------------------------------------------------ 歌詞條
  private lyricStrip(c: CanvasRenderingContext2D, t: number) {
    let k = 0;
    for (let i = 0; i < this.segs.length; i++) if (this.segs[i]!.t0 <= t) k = i;
    const cur = this.segs[k]!, prev = this.segs[k - 1];
    const u = prev ? clamp((t - cur.t0) / SHIFT) : 1;
    const dy = Math.round(ease.inOutCubic(u) * LS.rows);
    c.save();
    c.beginPath(); c.rect(0, LS.off, LS.cols, LS.rows); c.clip();
    c.font = font(FAM, LY_SIZE);
    if (prev && dy < LS.rows) this.drawSeg(c, prev, t, LS.off - dy);
    this.drawSeg(c, cur, t, LS.off + LS.rows - dy);
    c.restore();
  }

  private drawSeg(c: CanvasRenderingContext2D, sg: Seg, t: number, top: number) {
    const base = top + LY_BASE;
    if (sg.kind === 'idle') {
      // 跑歌名：從右邊跑進來，一秒 IDLE_SPEED 格
      const t0 = Number.isFinite(sg.t0) ? sg.t0 : this.ctx.start;
      const x = LS.cols - Math.floor((t - t0) * IDLE_SPEED);
      const P = Math.ceil(this.idleW);
      const k0 = Math.max(0, Math.floor(-x / P));
      c.fillStyle = led(0.6);
      for (let kx = k0; x + kx * P < LS.cols; kx++) c.fillText(this.idleText, x + kx * P, base);
      return;
    }
    const line = sg.line!;
    const lay = layoutLyric(c, line, { family: FAM, size: LY_SIZE, maxWidth: 1e5 });
    const width = lay.rows[0]?.width ?? 0;
    // 太長：跟著唱到的地方往左跑，唱到的字停在六成的位置；放得下就置中
    let head = 0;
    for (const pw of lay.words) { const p = Lyrics.wordProgress(pw.word, t); if (p > 0) head = pw.x + pw.w * p; }
    const xo = width > LY_W ? Math.round(clamp(head - LY_W * 0.62, 0, width - LY_W)) : Math.round((width - LY_W) / 2);
    const x0 = 3 - xo;
    for (const pw of lay.words) {
      const x = Math.round(x0 + pw.x);
      if (x > LS.cols || x + pw.w < -2) continue;
      const p = Lyrics.wordProgress(pw.word, t);
      // 逐欄點亮：唱到的欄亮，其他的欄三成亮
      const cut = Math.round(x + (pw.w + 1) * p);
      if (p < 1) {
        c.save(); c.beginPath(); c.rect(cut, top, LS.cols, LS.rows); c.clip();
        c.fillStyle = led(0.3); c.fillText(pw.word.w, x, base);
        c.restore();
      }
      if (p > 0) {
        c.save(); c.beginPath(); c.rect(x - 2, top, cut - x + 2, LS.rows); c.clip();
        c.fillStyle = p < 1 ? led(0, 1) : led(1);
        c.fillText(pw.word.w, x, base);
        c.restore();
      }
    }
  }

  // ------------------------------------------------------------ 留言條
  private msgStrip(c: CanvasRenderingContext2D, t: number, f: Frame) {
    const au = this.ctx.audio;
    const top = MS.off, R = MS.rows, C = MS.cols;
    // 外框跑燈：一圈，三顆亮一顆，一個八分音符走一步（第一拍之前停著）
    const beat = au.beatPeriod(t);
    const step = t < this.tFirst ? 0 : Math.floor((t - this.tFirst) / (beat / 2) + 1e-4);
    const per = 2 * (C + R) - 4;
    for (let i = 0; i < per; i++) {
      const [x, y] = i < C ? [i, 0] : i < C + R - 1 ? [C - 1, i - C + 1] : i < 2 * C + R - 2 ? [C - 1 - (i - (C + R - 2)), R - 1] : [0, R - 1 - (i - (2 * C + R - 3))];
      const onI = (i + step) % 3 === 0;
      c.fillStyle = onI ? led(0, 0.8) : led(0.08);
      c.fillRect(x, top + y, 1, 1);
    }
    // 衝進來：第一拍從右邊整段衝進來（整格整格地移），停住後從訊號色冷卻成白燈
    const run = ease.outCubic(prog(t, this.tFirst, this.tStop));
    const xo = t < this.tFirst ? C : Math.round((1 - run) * (C - 2));
    const heat = t < this.tStop ? 1 : 1 - clamp((t - this.tStop) / 0.6);
    const x0 = 4 + xo;
    // 留言與署名一起在招牌裡垂直置中（署名緊接在最後一行下面、靠右）；要上移的長留言，署名固定在最下面一列
    const sz = this.size;
    const paging = this.mLines.length > this.visible;
    const blockH = this.visible * this.lh + (this.sig ? 19 : 0);
    const baseY = paging ? top + MSG_TOP + Math.round(sz * 0.88) : top + MSG_TOP + Math.floor((MSG_ROWS + 17 - blockH) / 2) + Math.round(sz * 0.88);
    const sigY = paging ? top + SIG_BASE : baseY + (this.visible - 1) * this.lh + 19 + Math.round(sz * 0.12);
    // 署名：比留言暗一點，跟留言一起衝進來
    if (this.sig) {
      c.font = font(FAM, 16); c.textAlign = 'right';
      c.fillStyle = led(0.6 * (1 - heat), 0.6 * heat);
      c.fillText(this.sig, C - 5 + xo, sigY);
      c.textAlign = 'left';
    }
    c.save();
    c.beginPath(); c.rect(1, top + MSG_TOP, C - 2, paging ? MSG_ROWS : R - 4); c.clip();
    // 上移：放不下的長留言一行一行往上換
    let k = 0;
    for (const ts of this.steps) if (t >= ts) k++;
    const lastStep = this.steps[k - 1];
    const u = lastStep !== undefined ? ease.inOutCubic(clamp((t - lastStep) / SHIFT)) : 1;
    const scroll = Math.round((k - 1 + u) * this.lh) * (k > 0 ? 1 : 0);
    c.font = font(FAM, sz);
    // 沒有留言：第二行（邀請）跟著拍子閃
    const blink = !this.msg && t >= this.tStop && f.beatPhase > 0.72 ? 0.25 : 1;
    this.mLines.forEach((ln, i) => {
      const y = baseY + i * this.lh - Math.max(0, scroll);
      if (y < top - sz || y > top + R + sz) return;
      const b = !this.msg && i === 1 ? blink : 1;
      const fill = led(b * (1 - heat), heat * b);
      let cx = x0;
      for (const ch of Array.from(ln)) {
        fillGlyph(c, ch, cx, y, fill, led(0, 0, 1));
        cx += c.measureText(ch).width;
      }
    });
    c.restore();
  }
}
