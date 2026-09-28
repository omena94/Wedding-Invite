// 李薩如圖形（機器 B，暗）：暗房間裡一台老示波器的映像管特寫，切在 X-Y 模式。CH1 接宣文、CH2 接孟庭。
//  - 鏡頭：映像管在空間裡、稍微側一點（留言那一側比較近），進場從更斜、更遠的地方在第一拍前後落定，之後慢慢推近，
//    每兩小節輕輕搖一下；對焦在留言上，離得遠的地方（圖形那側）有一點點景深。
//  - 玻璃上左邊是李薩如曲線：整條一直亮著（電子束走得慢的轉角比較亮），一顆「寫字」的亮點一拍繞一圈、拖著剛打到的磷光；
//    每一拍相位「喀」地轉一格（outExpo），每個小節線換一組頻率比、越來越像愛心，最後一個小節線鎖定成一顆愛心（點綴色）。
//    心形線本來就是幾個諧波的和，所以真的是示波器畫得出來的圖。圖形刻意比留言暗：它是場景，不是焦點。
//  - 焦點是主打留言：用磷光寫在玻璃右邊（手寫字，最大、最亮），一段一段打出來（剛出現是燙的訊號色、冷成紙白），署名在後面。
//  - 歌詞也是玻璃上的磷光字，在下緣、小一級（逐字跟唱）。角落只有一小行讀數（X-Y 頻率比、兩個頻道是誰）。
//  - 沒有留言：玻璃右邊寫歌詞（大）＋一行小小的邀請。純音樂：下緣寫歌名。
// 手法：玻璃（GLSL）＋曲線（LineBatch）＋字（Canvas 小圖層）先畫進離屏圖，再用 _t8 的舞台當成空間裡的平面拍（透視、景深、外框、房間）。
import type * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, clearRT } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, prog, TAU, hash, frameIdx } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { sparkHead, sparkParticles, lyricAt, layoutLyric, drawLyric, signature, beatAfter, COUPLE_ZH } from './_motifs';
import { blit, winBars, label, INVITE, T8_TEXT, Stage, camMove } from './_t8';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: false, energy: [0.2, 0.9], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 玻璃上的版面（內容座標，px）
/** 圖形的中心與振幅（刻度格是以中心為準的 6×6 大格，一格 90 px）。 */
const FC = { x: 470, y: 470 };
const AMP = 250;
/** 主打留言的框。 */
const MS = { x: 880, y: 190, w: 860, h: 600 };
/** 歌詞（玻璃下緣；右邊不超過 1300，才不會被鏡頭帶進右下角 QR 那一區）。 */
const LY = { x: 170, y: 820, w: 1140, h: 180 };
/** 曲線取樣點數。 */
const NS = 640;
const [GROOM, BRIDE] = COUPLE_ZH.split(/\s*&\s*/) as [string, string];
const TEXT = `${T8_TEXT}${COUPLE_ZH}相位鎖定＊，。·—♪`;

/** 每個小節線換的頻率比（CH1 : CH2）。 */
const RATIOS: [number, number][] = [[1, 2], [2, 3], [3, 4], [1, 3], [3, 2], [2, 1], [3, 5], [4, 3]];

// 心形線（x 是一、三倍頻的 sin，y 是一到四倍頻的 cos）：先量好範圍，縮到跟李薩如同樣大小（±1）
const HEART_N = (() => {
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < 400; i++) {
    const s = (i / 400) * TAU;
    const y = -(13 * Math.cos(s) - 5 * Math.cos(2 * s) - 2 * Math.cos(3 * s) - Math.cos(4 * s));
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { c: (y0 + y1) / 2, h: (y1 - y0) / 2 };
})();

/** 映像管的玻璃：很深的黑帶一點磷光的顏色、淡淡的刻度格、電子束照亮玻璃的光暈（整張內容就是玻璃，外框由舞台畫）。 */
const GLASS = () => new FSPass(/* glsl */ `
  uniform float on; uniform float beamI; uniform float heart;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 uv = p / vec2(${W}.0, ${H}.0) - 0.5;
    vec3 g = C_INK * 0.5 + C_SIGNAL * 0.004;
    g *= 0.6 + 0.4 * (1.0 - smoothstep(0.25, 0.75, length(uv * vec2(1.3, 1.0))));
    vec2 q = p - vec2(${FC.x}.0, ${FC.y}.0);
    float r = length(q);
    vec3 beamC = mix(C_SIGNAL, C_ROSE, heart);
    g += beamC * beamI * (0.022 * exp(-r / 260.0) + 0.006 * exp(-r / 800.0));
    g += C_SIGNAL * 0.05 * (1.0 - on) * exp(-r / 500.0);
    // 刻度格：6×6 大格＋兩條軸上的小刻度，很淡
    vec2 aq = abs(q);
    float inside = step(aq.x, 270.6) * step(aq.y, 270.6);
    vec2 m = abs(fract(q / 90.0 + 0.5) - 0.5) * 90.0;
    float major = max(pxLine(m.x, 0.3, 1.1), pxLine(m.y, 0.3, 1.1)) * inside;
    vec2 mm = abs(fract(q / 18.0 + 0.5) - 0.5) * 18.0;
    float ticks = (pxLine(mm.x, 0.3, 1.1) * step(aq.y, 5.0) + pxLine(mm.y, 0.3, 1.1) * step(aq.x, 5.0)) * inside;
    g += mix(C_BONE, C_SIGNAL, 0.35) * (major * 0.03 + ticks * 0.05) * (0.6 + beamI * exp(-r / 420.0)) * on;
    fragColor = vec4(g, 1.0);
  }`, { on: { value: 1 }, beamI: { value: 1 }, heart: { value: 0 } });

interface Fig { a: number; b: number; heart: boolean; w: number; t0: number }
type RGB = [number, number, number];
type P2 = { x: number; y: number };

export default class Lissajous extends Scene {
  glass = shared('lissajous.glass', GLASS);
  stage = new Stage();
  /** 主打留言（或沒有留言時的大歌詞）。 */
  msgL = this.track(new Layer2D(MS.w, MS.h, undefined, { fast: true }));
  /** 下緣的歌詞與角落的讀數。 */
  lyrL = this.track(new Layer2D(LY.w, LY.h, undefined, { fast: true }));
  readL = this.track(new Layer2D(520, 90, undefined, { fast: true }));
  L = this.track(new LineBatch(4000, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  figs: Fig[] = [];
  beat = 0.5;
  fit: FitResult | null = null;
  charT: number[] = [];
  typedEnd = 0;
  private msgKey = '';
  private lyrKey = '';
  private readKey = '';
  private pts: P2[] = Array.from({ length: NS + 1 }, () => ({ x: 0, y: 0 }));

  override async init() {
    const { audio: au, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const m = this.msg;
    await loadText(TEXT + (song.title ?? '') + (song.artist ?? '') + (m ? m.text + m.name : ''));
    const beat = this.beat = au.beatPeriod(s + 0.1);
    // 圖形的時間表：開頭是 1:1 的圓（兩個人同步），每個小節線換一組頻率比、越來越像愛心，
    // 最後一個離結尾還有 1.6 拍以上的小節線鎖定成愛心（太短的窗格就在最後兩拍前）
    const bars = winBars(au, s, e);
    let tH = bars.filter((b) => b > s + 0.5 * beat && e - b >= 1.6 * beat).pop();
    if (tH === undefined) tH = Math.max(s + 0.35, au.timeOfBeat(Math.floor(au.beatAt(e - 1.7 * beat))));
    const mid = bars.filter((b) => b > s + 0.5 * beat && b < tH! - 0.1);
    let k = Math.floor(hash(this.ctx.params.seed ?? 1, 3) * RATIOS.length);
    this.figs = [{ a: 1, b: 1, heart: false, w: 0, t0: s }];
    mid.forEach((b, i) => {
      const r = RATIOS[k++ % RATIOS.length]!;
      this.figs.push({ a: r[0], b: r[1], heart: false, w: 0.7 * ((i + 1) / (mid.length + 1)) ** 1.3, t0: b });
    });
    this.figs.push({ a: 1, b: 1, heart: true, w: 1, t0: tH });
    // 主打留言：第一拍開始一段一段打出來（八分音符一組，最多 3 秒）
    if (m) {
      const c = this.msgL.ctx;
      this.fit = fitText(c, m.text, F.hand(400), MS.w, MS.h - 110, { min: 52, max: 132, lineHeight: 1.26, maxLines: 6 });
      const n = this.fit.lines.reduce((a, l) => a + Array.from(l).length, 0);
      const t0 = beatAfter(au, s + 0.12);
      const dur = clamp(0.05 * n + 0.3, 0.6, 3), step = beat / 2;
      const per = Math.ceil(n / Math.max(1, Math.round(dur / step)));
      this.charT = Array.from({ length: n }, (_, i) => t0 + Math.floor(i / per) * step);
      this.typedEnd = this.charT[n - 1] ?? t0;
    }
  }

  // ---------------------------------------------------------------- 曲線
  private figAt(t: number): { i: number; m: number } {
    let i = 0;
    for (let k = 0; k < this.figs.length; k++) if (this.figs[k]!.t0 <= t) i = k;
    const m = i === 0 ? 1 : prog(t, this.figs[i]!.t0, this.figs[i]!.t0 + 0.55 * this.beat, ease.outExpo);
    return { i, m };
  }
  /** 相位：每一拍「喀」地轉 30°。 */
  private phase(t: number) {
    const b = this.ctx.audio.beatAt(t), nb = Math.floor(b);
    return Math.PI / 2 + (Math.PI / 6) * (nb + ease.outExpo(clamp((b - nb) / 0.6)));
  }
  private shape(f: Fig, s: number, dl: number, o: P2) {
    const lx = Math.sin(f.a * s + dl), ly = -Math.sin(f.b * s);
    const hx = (3 * Math.sin(s) - Math.sin(3 * s)) / 4;
    const hy = (-(13 * Math.cos(s) - 5 * Math.cos(2 * s) - 2 * Math.cos(3 * s) - Math.cos(4 * s)) - HEART_N.c) / HEART_N.h;
    o.x = lerp(lx, hx * 1.02, f.w);
    o.y = lerp(ly, hy * 0.95, f.w);
  }
  private tmpA: P2 = { x: 0, y: 0 };
  private tmpB: P2 = { x: 0, y: 0 };
  private point(s: number, fi: { i: number; m: number }, dl: number, amp: number, o: P2) {
    this.shape(this.figs[fi.i]!, s, dl, this.tmpB);
    let x = this.tmpB.x, y = this.tmpB.y;
    if (fi.m < 1 && fi.i > 0) {
      this.shape(this.figs[fi.i - 1]!, s, dl, this.tmpA);
      x = lerp(this.tmpA.x, x, fi.m); y = lerp(this.tmpA.y, y, fi.m);
    }
    o.x = FC.x + x * amp; o.y = FC.y + y * amp;
  }
  private amp(t: number) {
    const s = this.ctx.start;
    return AMP * ease.outExpo(prog(t, s, s + 0.4)) * (1 + 0.025 * this.ctx.audio.hit('kick', t, 0.12));
  }
  private headS(t: number) {
    const b = this.ctx.audio.beatAt(t), nb = Math.floor(b);
    return TAU * (nb + ease.outCubic(b - nb));
  }
  private headAt(t: number): P2 | null {
    if (t < this.ctx.start + 0.05) return null;
    const o = { x: 0, y: 0 };
    this.point(this.headS(t), this.figAt(t), this.phase(t), this.amp(t), o);
    return o;
  }

  private drawTrace(t: number) {
    const L = this.L, s = this.ctx.start;
    const fi = this.figAt(t), dl = this.phase(t), amp = this.amp(t);
    const cur = this.figs[fi.i]!;
    const heartK = cur.heart ? fi.m : 0;
    const base: RGB = [lerp(LIN.signal[0], LIN.rose[0], heartK), lerp(LIN.signal[1], LIN.rose[1], heartK), lerp(LIN.signal[2], LIN.rose[2], heartK)];
    const em = LIN.ember;
    const on = prog(t, s, s + 0.4);
    const kick = this.ctx.audio.hit('kick', t, 0.13);
    // 圖形是場景不是焦點：比留言暗（有留言時再壓低一點），鎖定成愛心時亮回來
    const dim = this.msg ? 0.62 + 0.3 * heartK : 0.8;
    const gain = dim * (0.8 + 0.5 * kick) * (1 + 2.5 * (1 - on));
    const pts = this.pts;
    for (let i = 0; i <= NS; i++) this.point((i / NS) * TAU, fi, dl, amp, pts[i]!);
    const fj = frameIdx(t);
    let mean = 0;
    for (let i = 0; i < NS; i++) mean += Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y);
    mean /= NS;
    const sh = this.headS(t) % TAU;
    for (let i = 0; i < NS; i++) {
      const a = pts[i]!, b = pts[i + 1]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y) + 1e-3;
      const bf = Math.pow(clamp(mean / len, 0.35, 2.6), 0.6);
      let behind = sh - (i / NS) * TAU;
      if (behind < 0) behind += TAU;
      const hot = behind < TAU * 0.4 ? Math.exp(-behind / (TAU * 0.07)) : 0;
      const j = (hash(fj, i) - 0.5) * 0.6;
      const k = (0.62 * bf + 0.9 * hot) * gain;
      L.seg2(a.x + j, a.y, b.x + j, b.y, 1.9 + 1.2 * hot, [lerp(base[0] * k, em[0] * 2.6, hot * 0.6), lerp(base[1] * k, em[1] * 2.6, hot * 0.6), lerp(base[2] * k, em[2] * 2.6, hot * 0.6)], 1);
      L.seg2(a.x, a.y, b.x, b.y, 10, [base[0] * 0.04 * bf * gain, base[1] * 0.04 * bf * gain, base[2] * 0.04 * bf * gain], 1);
    }
    const h = this.headAt(t);
    if (h) {
      sparkParticles(L, t, (tb) => this.headAt(tb), { rate: 45, life: 0.26, speed: 110, gravity: 260, seed: (this.ctx.params.seed ?? 1) + 5, intensity: 0.7 });
      sparkHead(L, h.x, h.y, t, 0.62, on * dim);
    }
  }

  // ---------------------------------------------------------------- 玻璃上的字
  /** 主打留言（焦點）。沒有留言時這一格放大的歌詞＋一行小小的邀請。 */
  private drawMessage(t: number, out: THREE.WebGLRenderTarget) {
    const m = this.msg;
    const L = this.msgL, c = L.ctx;
    if (!m) {
      L.clear();
      const ly = lyricAt(this.ctx.lyrics, t);
      if (ly) {
        const st = { family: F.archivo(100, 800), size: 104, minSize: 64, maxWidth: MS.w, lineHeight: 1.08 };
        const lay = layoutLyric(c, ly.line, st);
        c.save(); c.translate(0, (MS.h - 120 - lay.height) / 2 + lay.size * 0.8);
        drawLyric(c, ly.line, t, st, lay, ly.k);
        c.restore();
      } else if (!this.ctx.lyrics.has) {
        label(c, `♪ ${this.ctx.song.title || '今晚的歌'}`, 0, 300, F.archivo(100, 800), 96, rgba('bone', 0.9));
      }
      label(c, INVITE, 0, MS.h - 30, F.hei(500), 22, rgba('ash', 0.6), { tracking: 2 });
      L.upload();
      blit(this.ctx, L.texture, MS.x, MS.y, MS.w, MS.h, out);
      return;
    }
    const typed = this.charT.filter((x) => x <= t).length;
    const sigK = typed >= this.charT.length ? clamp((t - this.typedEnd - this.beat * 0.5) / 0.3) : 0;
    const busy = t < this.typedEnd + 0.8 || (sigK > 0 && sigK < 1);
    const key = `${typed}|${sigK.toFixed(2)}`;
    if (key !== this.msgKey || busy) {
      this.msgKey = key;
      L.clear();
      const fit = this.fit!;
      c.font = font(F.hand(400), fit.size);
      c.textBaseline = 'alphabetic';
      // 留言在框裡垂直置中（加上署名的高度）
      const top = (MS.h - 70 - fit.height) / 2 + fit.size * 0.95;
      let idx = 0;
      fit.lines.forEach((ln, li) => {
        let x = 0;
        const y = top + li * fit.lineHeight;
        for (const ch of Array.from(ln)) {
          const ta = this.charT[idx++] ?? 0;
          const cw = c.measureText(ch).width;
          if (t >= ta) {
            const heat = Math.exp(-(t - ta) / 0.22);
            const to = ch === '♥' ? 'rose' : 'bone';
            c.fillStyle = heat > 0.02 ? mixRgba(to, 'signal', heat, 1) : rgba(to, 1);
            c.fillText(ch, x, y);
          }
          x += cw;
        }
      });
      if (sigK > 0) {
        const sy = top + (fit.lines.length - 1) * fit.lineHeight + 76;
        label(c, signature(m.name) + (m.couple ? '（新人）' : ''), Math.min(MS.w, fit.width + 20), sy, F.hand(400), 40, rgba('ash', sigK), { align: 'right' });
      }
      L.upload();
    }
    blit(this.ctx, L.texture, MS.x, MS.y, MS.w, MS.h, out);
  }

  /** 下緣的歌詞（有留言時；比留言小一級、比較暗）。 */
  private drawLyrics(t: number, out: THREE.WebGLRenderTarget) {
    if (!this.msg) return;
    const { lyrics, song } = this.ctx;
    const ly = lyricAt(lyrics, t);
    const key = ly ? '' : lyrics.has ? 'gap' : 'title';
    if (!key || key !== this.lyrKey) {
      this.lyrKey = key;
      const L = this.lyrL, c = L.ctx;
      L.clear();
      if (ly) {
        const st = { family: F.archivo(100, 700), size: 62, minSize: 52, maxWidth: LY.w, lineHeight: 1.08, sung: rgba('bone', 0.72), unsung: rgba('bone', 0.22) };
        const lay = layoutLyric(c, ly.line, st);
        c.save(); c.translate(0, (LY.h - lay.height) / 2 + lay.size * 0.8);
        drawLyric(c, ly.line, t, st, lay, ly.k);
        c.restore();
      } else if (key === 'title') {
        label(c, `♪  ${song.title || '今晚的歌'}${song.artist ? '  ·  ' + song.artist : ''}`, 0, 110, F.archivo(100, 700), 52, rgba('bone', 0.6));
      }
      L.upload();
    }
    blit(this.ctx, this.lyrL.texture, LY.x, LY.y, LY.w, LY.h, out);
  }

  /** 角落唯一的一小行讀數（低對比）。 */
  private drawReadout(t: number, out: THREE.WebGLRenderTarget) {
    const fi = this.figAt(t), cur = this.figs[fi.i]!;
    const key = `${fi.i}`;
    if (key !== this.readKey) {
      this.readKey = key;
      const L = this.readL, c = L.ctx;
      L.clear();
      label(c, cur.heart ? 'X-Y  ·  相位鎖定' : `X-Y  ·  ${cur.a} : ${cur.b}`, 0, 34, F.mono(500), 22, rgba('signal', 0.55), { tracking: 3 });
      label(c, `CH1 ${GROOM}  ·  CH2 ${BRIDE}`, 0, 70, F.hei(500), 18, rgba('ash', 0.55), { tracking: 3 });
      L.upload();
    }
    blit(this.ctx, this.readL.texture, 110, 80, 520, 90, out);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const fi = this.figAt(t), cur = this.figs[fi.i]!;
    const rt = this.stage.rt;
    // 內容：玻璃、曲線、字 → 離屏圖
    this.glass.u.on!.value = prog(t, s, s + 0.4);
    this.glass.u.beamI!.value = (this.msg ? 0.6 : 0.8) + 0.5 * f.a.kick;
    this.glass.u.heart!.value = cur.heart ? fi.m : 0;
    this.glass.render(renderer, rt);
    this.L.clear();
    this.drawTrace(t);
    this.L.render(renderer, rt);
    this.drawReadout(t, rt);
    this.drawMessage(t, rt);
    this.drawLyrics(t, rt);
    // 鏡頭：映像管在房間裡，留言那側比較近；對焦在留言上
    const mv = camMove(this.ctx.audio, s, e, t, { inYaw: -0.1, inZoom: 0.07, push: 0.04, sway: 0.012 });
    this.stage.draw(renderer, out, {
      yaw: -0.085 + mv.yaw, pitch: 0.035, roll: 0.004, zoom: 0.84 + mv.zoom, x: -40, y: -10,
      dof: 1.1, focus: [MS.x + MS.w / 2, MS.y + MS.h / 2], bezel: 64, radius: 70, glass: 1,
      room: [LIN.ink[0] * 0.55, LIN.ink[1] * 0.55, LIN.ink[2] * 0.55], glow: 0.018,
    });
    void clearRT;
    return { bloom: 0.75, halation: 0.3, vignette: 0.5 };
  }
}
