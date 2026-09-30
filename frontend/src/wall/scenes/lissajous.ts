// 李薩如圖形（機器 B，暗）：暗房間裡一台老示波器的映像管特寫，切在 X-Y 模式。CH1 接宣文、CH2 接孟庭。
//  - 鏡頭：映像管在空間裡、稍微側一點，進場從更斜、更遠的地方在第一拍前後落定，之後慢慢推近，每兩小節輕輕搖一下；
//    焦點轉移：開場對焦在圖形上，留言開始出現時焦點慢慢移到留言（v2 標準的「開場先看場景」）。
//  - 主視覺是玻璃上的李薩如曲線（很大、在畫面左中）：整條一直亮著（電子束走得慢的轉角比較亮），一顆「寫字」的亮點一拍繞一圈、
//    拖著剛打到的磷光；每一拍相位「喀」地轉一格（outExpo），每個小節線換一組頻率比（上一個圖形留下一道慢慢褪掉的殘影）、
//    越來越像愛心，最後一個小節線鎖定成一顆愛心（點綴色）。心形線本來就是幾個諧波的和，所以真的是示波器畫得出來的圖。
//  - 主打留言：用磷光寫在玻璃右邊一小塊（手寫字，v2 字級），一段一段打出來（剛出現是燙的訊號色、冷成紙白），署名在最後一行下面。
//  - 歌詞也是玻璃上的磷光字，在左下（逐字跟唱、比留言小）。角落只有一小行讀數（X-Y 頻率比、兩個頻道是誰）。
//  - 沒有留言：右邊只有一行小小的邀請，歌詞一樣在左下。純音樂：左下寫歌名。
// 字級照「留言尺寸與版面比例標準 v2」（_v2.ts），標準是螢幕 px：畫在玻璃上的字要除以舞台在那裡的縮放倍數。
// 手法：玻璃（GLSL）＋曲線（LineBatch）＋字（Canvas 小圖層）先畫進離屏圖，再用 _t8 的舞台當成空間裡的平面拍（透視、景深、外框、房間）。
import type * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, clearRT } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, prog, TAU, hash, frameIdx } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { sparkHead, sparkParticles, lyricAt, layoutLyric, drawLyric, signature, beatAfter, COUPLE_ZH, lyricSubOf } from './_motifs';
import { blit, winBars, label, INVITE, T8_TEXT, Stage, camMove, type StageCam } from './_t8';
import { V2, msgMaxFor, lyricV2, sigV2, fitClauses } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: false, energy: [0.2, 0.9], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 玻璃上的版面（內容座標，px）
/** 圖形的中心與振幅（主視覺：刻度格是以中心為準的 6×6 大格，一格 110 px）。 */
const FC = { x: 700, y: 486 };
const AMP = 318;
const GRID = 110;
/** 主打留言的框（玻璃右邊一小塊；v2：螢幕上 ≤ 860×430，這裡換算後約 560×400）。 */
const MS = { x: 1190, y: 300, w: 660, h: 470 };
/** 歌詞（玻璃左下；右邊不超過 1240，才不會被鏡頭帶進右下角 QR 那一區）。 */
const LY = { x: 190, y: 862, w: 1050, h: 150 };
/** 基本機位（沒有加鏡頭運動）：init 用它換算字級。 */
const CAM: StageCam = {
  yaw: -0.085, pitch: 0.035, roll: 0.004, zoom: 0.84, x: -40, y: -10,
  dof: 1.1, bezel: 64, radius: 70, glass: 1, room: [0, 0, 0], glow: 0.018,
};
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
    g += beamC * beamI * (0.026 * exp(-r / 320.0) + 0.006 * exp(-r / 900.0));
    g += C_SIGNAL * 0.05 * (1.0 - on) * exp(-r / 500.0);
    // 刻度格：6×6 大格＋兩條軸上的小刻度，很淡
    vec2 aq = abs(q);
    float inside = step(aq.x, ${3 * GRID}.6) * step(aq.y, ${3 * GRID}.6);
    vec2 m = abs(fract(q / ${GRID}.0 + 0.5) - 0.5) * ${GRID}.0;
    float major = max(pxLine(m.x, 0.3, 1.1), pxLine(m.y, 0.3, 1.1)) * inside;
    vec2 mm = abs(fract(q / ${GRID / 5}.0 + 0.5) - 0.5) * ${GRID / 5}.0;
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
  /**
   * 歌詞那一塊貼到螢幕上的位置。有韓文原文的窗格（建構時就看：引擎只在建立這一格之前設好開關）中文＋原文會塞滿這一塊，
   * 最下面那排比原本低，整塊往上提一點（上面是空的螢幕），原文才不會貼著螢幕下緣。
   */
  lyBox = this.ctx.lyrics.linesIn(this.ctx.start - 1, this.ctx.end + 1).some((l) => !!lyricSubOf(l)) ? { ...LY, y: LY.y - 32 } : LY;
  figs: Fig[] = [];
  beat = 0.5;
  fit: FitResult | null = null;
  /** 內容上的字級（已經換算過舞台縮放）：署名、歌詞。 */
  sigPx = 30; lyrPx = 52;
  /** 留言開始出現的時間（焦點轉移用）。 */
  tMsg = 0;
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
    // v2 字級：標準是螢幕 px，除以舞台在留言／歌詞那裡的縮放倍數，才是畫在玻璃上的字級
    const zM = this.stage.scaleAt(CAM, MS.x + MS.w / 2, MS.y + MS.h / 2);
    const zL = this.stage.scaleAt(CAM, LY.x + LY.w / 2, LY.y + LY.h / 2);
    // 主打留言：第二拍開始一段一段打出來（八分音符一組，最多 3 秒）——開場先看一拍圖形
    if (m) {
      const c = this.msgL.ctx;
      const o = { min: V2.msgMin / zM, max: msgMaxFor(m.text) / zM, lineHeight: 1.28, maxLines: 6 };
      // 字級依「框的高度扣掉署名那一行」算，署名永遠在最後一行下面
      const bw = MS.w, bh = MS.h - 70;
      this.fit = fitClauses(c, m.text, F.hand(400), bw, bh, o) ?? fitText(c, m.text, F.hand(400), bw, bh, o);
      const scr = this.fit.size * zM;
      this.sigPx = sigV2(scr) / zM;
      this.lyrPx = lyricV2(scr) / zL;
      const n = this.fit.lines.reduce((a, l) => a + Array.from(l).length, 0);
      const t0 = beatAfter(au, s + 0.12, 1);
      this.tMsg = t0;
      const dur = clamp(0.05 * n + 0.3, 0.6, 3), step = beat / 2;
      const per = Math.ceil(n / Math.max(1, Math.round(dur / step)));
      this.charT = Array.from({ length: n }, (_, i) => t0 + Math.floor(i / per) * step);
      this.typedEnd = this.charT[n - 1] ?? t0;
    } else this.lyrPx = lyricV2(null) / zL;
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
    // 圖形是主視覺，但留言要讀得清楚：有留言時稍微壓低一點，鎖定成愛心時亮回來
    const dim = this.msg ? 0.75 + 0.25 * heartK : 0.9;
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
    // 殘影：換了頻率比之後，上一個圖形在玻璃上留一道一拍半慢慢褪掉的磷光（每個小節線的小事件）
    if (fi.i > 0) {
      const ghost = 0.35 * (1 - prog(t, cur.t0, cur.t0 + 1.5 * this.beat));
      if (ghost > 0.01) {
        const prev = this.figs[fi.i - 1]!, o = this.tmpA;
        let px = 0, py = 0;
        for (let i = 0; i <= NS / 2; i++) {
          this.shape(prev, (i / (NS / 2)) * TAU, dl, o);
          const x = FC.x + o.x * amp, y = FC.y + o.y * amp;
          if (i) L.seg2(px, py, x, y, 1.6, [LIN.signal[0] * ghost, LIN.signal[1] * ghost, LIN.signal[2] * ghost], 1);
          px = x; py = y;
        }
      }
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
      // 沒有留言：右邊只有一行小小的邀請（歌詞在左下），畫一次就好
      if (this.msgKey !== 'invite') {
        this.msgKey = 'invite';
        L.clear();
        label(c, INVITE, 0, MS.h / 2, F.hei(500), 24, rgba('ash', 0.6), { tracking: 2 });
        L.upload();
      }
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
      // 留言在框裡垂直置中（連署名一起算）；署名在最後一行下面、跟最後一行隔半個留言字高
      const sigGap = fit.size * 0.55 + this.sigPx;
      const top = (MS.h - sigGap - fit.height) / 2 + fit.size * 0.92;
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
        const sy = top + (fit.lines.length - 1) * fit.lineHeight + sigGap;
        label(c, signature(m.name) + (m.couple ? '（新人）' : ''), 0, sy, F.hand(400), this.sigPx, rgba('ash', sigK));
      }
      L.upload();
    }
    blit(this.ctx, L.texture, MS.x, MS.y, MS.w, MS.h, out);
  }

  /** 左下的歌詞（v2：比留言小；沒有留言時也不超過 52）。 */
  private drawLyrics(t: number, out: THREE.WebGLRenderTarget) {
    const { lyrics, song } = this.ctx;
    const ly = lyricAt(lyrics, t);
    const key = ly ? '' : lyrics.has ? 'gap' : 'title';
    if (!key || key !== this.lyrKey) {
      this.lyrKey = key;
      const L = this.lyrL, c = L.ctx;
      L.clear();
      if (ly) {
        const st = { family: F.archivo(100, 700), size: this.lyrPx, minSize: this.lyrPx * 0.8, maxWidth: LY.w, lineHeight: 1.08, sung: rgba('bone', this.msg ? 0.75 : 0.92), unsung: rgba('bone', 0.24) };
        const lay = layoutLyric(c, ly.line, st);
        c.save(); c.translate(0, (LY.h - lay.height) / 2 + lay.size * 0.8);
        drawLyric(c, ly.line, t, st, lay, ly.k);
        c.restore();
      } else if (key === 'title') {
        label(c, `♪  ${song.title || '今晚的歌'}${song.artist ? '  ·  ' + song.artist : ''}`, 0, LY.h / 2 + this.lyrPx * 0.35, F.archivo(100, 700), this.lyrPx, rgba('bone', 0.6));
      }
      L.upload();
    }
    blit(this.ctx, this.lyrL.texture, this.lyBox.x, this.lyBox.y, LY.w, LY.h, out);
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
    // 鏡頭：映像管在房間裡。焦點轉移：開場對焦在圖形上，留言開始出現時花一拍半移到留言
    const mv = camMove(this.ctx.audio, s, e, t, { inYaw: -0.1, inZoom: 0.07, push: 0.04, sway: 0.012 });
    const fk = this.msg ? ease.inOutCubic(prog(t, this.tMsg, this.tMsg + 1.5 * this.beat)) : 0;
    const focus: [number, number] = [lerp(FC.x, MS.x + MS.w / 2, fk), lerp(FC.y, MS.y + MS.h / 2, fk)];
    this.stage.draw(renderer, out, {
      ...CAM, yaw: CAM.yaw + mv.yaw, zoom: CAM.zoom + mv.zoom, focus,
      room: [LIN.ink[0] * 0.55, LIN.ink[1] * 0.55, LIN.ink[2] * 0.55],
    });
    void clearRT;
    return { bloom: 0.75, halation: 0.3, vignette: 0.5 };
  }
}
