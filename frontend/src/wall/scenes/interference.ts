// 波的干涉（暗）：兩個點波源（S₁ 宣文、S₂ 孟庭）同頻同相，在左邊一圈圈發出波；兩家的波疊起來，
// 往右張開一條條亮紋（像光從兩道縫照出來的扇形光束）——亮紋就是兩個人的波「同步」的地方。
// MV 版：波峰的細圈只在波源附近清楚，越遠越淡，右邊只剩柔和的亮紋光帶；留言後面的波峰壓暗。鏡頭整個窗格慢慢往前推。
//  - 波一拍往外推一個波長：拍點上「推」出去（outExpo），拍子之間停住。
//  - 主打留言是焦點：每一行剛好坐在一條亮紋上（波源的間距照留言的行距算：Δ = mλ），
//    第一拍兩個波源同時發出一道強的脈衝，脈衝掃過哪裡、那裡的字就亮起來（燒紅、冷卻成紙白），之後每個小節線再掃一道淡的。
//  - 歌詞在上方（比留言小一級），逐字跟唱。小字只有三群：波源的名字、歌詞上面的「疊加中」、左下一行冷面註腳。
//  - 沒有留言：歌詞放大、坐在中間那條亮紋上當焦點，下面一行邀請。純音樂：上方寫歌名。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { lyricAt, drawLyric, layoutLyric, beatAfter, signature, fillWithHearts } from './_motifs';
import { mono, tag, type Rect } from './_t11';

export const spec: PlateSpecDecl = { group: 'type', family: 'science', paper: false, energy: [0.25, 0.85], bars: [4, 10], weight: 1 };

/** 波源的 x、留言排的範圍（右下角 QR 上面）。 */
const SRC_X = 214;
const BOX = { x: 560, y: 330, w: 1140, h: 460 };
/** 歌詞：有留言時在上方；沒有留言時放大到中間（坐在中央的亮紋上）。 */
const LYR_M = { x: 124, y: 214, w: 1560 };
const LYR_N = { x: 560, w: 1140, size: 104 };
const FAM_MSG = F.ming(700);
/** 想要的波長（px）：太密會閃、太疏不像干涉圖。 */
const LAMBDA = 36;
const INVITE = '掃描右下角 QR code，讓你的祝福也發亮。';
const FOOT = '＊兩個波源同頻同相：步調一致的兩個人，會在很多地方一起發亮。';
/** 鏡頭推近的最大倍率（最下面一行小字的位置照這個算）。 */
const PUSH = 0.025;

const BG = () => new FSPass(/* glsl */ `
  uniform vec2 s1; uniform vec2 s2; uniform float lam; uniform float ph; uniform float k;
  uniform float pr; uniform float pk; uniform float rr; uniform float rk; uniform float kick; uniform vec4 calm;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float r1 = length(p - s1), r2 = length(p - s2);
    vec3 col = C_INK + (C_INK2 - C_INK) * (0.2 + 0.3 * fbm(p / 560.0, 3));
    // 留言那一塊：波峰細圈幾乎拿掉、亮紋光帶也淡一點，字才乾淨
    vec2 cq = max(calm.xy - p, p - calm.zw);
    float inMsg = 1.0 - smoothstep(0.0, 110.0, max(cq.x, cq.y));
    // 時間平均的亮度：cos²(πΔ/λ) → 亮紋（柔和的光帶，往右張開）
    float I = pow(cos(PI * (r2 - r1) / lam), 2.0);
    float band = 1.0 / (1.0 + r1 / 500.0) + 1.0 / (1.0 + r2 / 500.0);
    col += C_SIGNAL * 0.017 * I * band * (1.0 - 0.4 * inMsg) * k;
    // 波峰：兩家同心圓（細線），只在波源附近清楚，越遠越淡
    float q1 = abs(fract(r1 / lam - ph + 0.5) - 0.5) * lam;
    float q2 = abs(fract(r2 / lam - ph + 0.5) - 0.5) * lam;
    float a1 = exp(-r1 / 300.0), a2 = exp(-r2 / 300.0);
    float c1 = pxLine(q1, 0.45, 1.35) * a1, c2 = pxLine(q2, 0.45, 1.35) * a2;
    float quiet = 1.0 - 0.85 * inMsg;
    col += (C_BONE * c1 * 0.1 + C_SIGNAL * c2 * 0.14) * quiet * k;
    // 交點（兩家波峰疊在一起）＝ 建設性干涉：亮一下，大鼓時更亮
    col += C_EMBER * c1 * c2 * (0.5 + 1.0 * kick) * quiet * k;
    // 脈衝：第一拍的強脈衝、每小節線的淡脈衝（兩個波源各一道）
    float w1 = exp(-pow((r1 - pr) / 5.0, 2.0)) + exp(-pow((r2 - pr) / 5.0, 2.0));
    float w2 = exp(-pow((r1 - rr) / 5.0, 2.0)) + exp(-pow((r2 - rr) / 5.0, 2.0));
    col += C_SIGNAL * (w1 * pk * 0.9 + w2 * rk * 0.35) * k;
    // 波源
    float d1 = min(r1, r2);
    col += C_EMBER * (1.0 - smoothstep(4.0, 6.0, d1)) * 2.5 * k;
    col += C_BONE * pxLine(abs(d1 - 13.0), 0.4, 1.3) * 0.6 * k;
    fragColor = vec4(col, 1.0);
  }`, {
  s1: { value: new THREE.Vector2() }, s2: { value: new THREE.Vector2() }, lam: { value: LAMBDA }, ph: { value: 0 }, k: { value: 1 },
  pr: { value: -100 }, pk: { value: 0 }, rr: { value: -100 }, rk: { value: 0 }, kick: { value: 0 }, calm: { value: new THREE.Vector4(0, 0, 0, 0) },
});

interface Glyph { ch: string; x: number; y: number; d: number; t: number }

export default class Interference extends Scene {
  bg = shared('interference.bg', BG);
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  hot = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  fit: FitResult | null = null;
  glyphs: Glyph[] = [];
  s1 = { x: SRC_X, y: 400 }; s2 = { x: SRC_X, y: 700 };
  lam = LAMBDA;
  tFirst = 0; dur = 1; dMin = 0; dMax = 1;
  sig = ''; sigT = Infinity; sigX = 0; sigY = 0;
  /** 沒有留言時歌詞那一行的中心高度。 */
  yc = 560;
  lyrSize = 60;
  lyricsInWindow = false;
  /** 留言的範圍（波峰線在這裡淡掉）。 */
  calm: Rect = [0, 0, 0, 0];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.sig = m ? (m.couple ? '—— 新郎新娘' : signature(m.name)) : '';
    await loadText(`${m?.text ?? ''}${this.sig}${INVITE}${FOOT}${song.title}${song.artist}宣文孟庭疊加中`);
    const c = this.layer.ctx;
    const beat = au.beatPeriod(s);
    this.tFirst = beatAfter(au, s + Math.min(0.2, beat * 0.4));
    const bar = au.timeOfBar(au.barAt(this.tFirst) + 1) - this.tFirst;
    this.dur = clamp(Math.min(1.5 * bar, 0.4 * (e - s)), 0.6, 4);
    this.lyricsInWindow = lyrics.linesIn(s, e).length > 0;
    const L = BOX.x + BOX.w / 2 - SRC_X;
    // 波源間距：讓離中線最近的那一行落在第 1 條（偶數行）或第 0 條（奇數行）亮紋上，其他行大致落在第 2、3… 條
    const setSources = (yc: number, h1: number) => {
      const d = clamp((LAMBDA * Math.hypot(L, h1)) / h1, 180, 520);
      this.lam = (d * h1) / Math.hypot(L, h1);
      this.s1 = { x: SRC_X, y: yc - d / 2 }; this.s2 = { x: SRC_X, y: yc + d / 2 };
    };
    const dist = (x: number, y: number) => Math.min(Math.hypot(x - this.s1.x, y - this.s1.y), Math.hypot(x - this.s2.x, y - this.s2.y));
    if (!m) {
      // 沒有留言：歌詞坐在中央那條亮紋上
      this.yc = BOX.y + BOX.h / 2;
      setSources(this.yc, 120);
      this.dMin = dist(BOX.x, this.yc) - 30; this.dMax = dist(BOX.x + BOX.w, this.yc) + 20;
      this.calm = [BOX.x - 10, this.yc - 130, BOX.w + 20, 200];
      return;
    }
    // 字級依「可用高度扣掉署名」算：署名永遠在最後一行（連 y、g 的下伸部）下面、不重疊
    const fit = this.fit = fitText(c, m.text, FAM_MSG, BOX.w, BOX.h - 70, { min: 48, max: 140, lineHeight: 1.5, maxLines: 4 });
    const n = fit.lines.length;
    // 行的位置：垂直置中；波源的中線對準中間那一行（奇數行）或兩行中間（偶數行）
    const y0 = BOX.y + (BOX.h - fit.height) / 2 + fit.size * 0.5; // 第一行字的中心
    const rowsY = fit.lines.map((_, i) => y0 + i * fit.lineHeight);
    setSources((rowsY[0]! + rowsY[n - 1]!) / 2, n % 2 === 1 ? (n > 1 ? fit.lineHeight : 110) : fit.lineHeight / 2);

    // 字：第一拍的脈衝掃到哪裡、那裡的字就亮
    c.font = font(FAM_MSG, fit.size);
    const raw: { ch: string; x: number; y: number; d: number }[] = [];
    fit.lines.forEach((ln, li) => {
      let x = BOX.x;
      for (const ch of Array.from(ln)) {
        const w = c.measureText(ch).width;
        raw.push({ ch, x, y: rowsY[li]! + fit.size * 0.36, d: dist(x + w / 2, rowsY[li]!) });
        x += w;
      }
    });
    this.dMin = Math.min(...raw.map((g) => g.d)) - 30;
    this.dMax = Math.max(...raw.map((g) => g.d)) + 20;
    this.glyphs = raw.map((g) => ({ ...g, t: this.tFirst + this.dur * invOutCubic((g.d - this.dMin) / (this.dMax - this.dMin)) }));
    const tLast = Math.max(...this.glyphs.map((g) => g.t));
    this.sigT = tLast + beat * 0.5;
    const wMax = Math.max(...fit.lines.map((l) => c.measureText(l).width));
    this.sigX = BOX.x + wMax;
    this.sigY = rowsY[n - 1]! + fit.size * 0.36 + Math.max(70, fit.size * 0.3 + 44);
    this.calm = [BOX.x - 10, rowsY[0]! - fit.size * 0.6, wMax + 20, rowsY[n - 1]! - rowsY[0]! + fit.size * 1.2];
    // 歌詞比留言小一級
    this.lyrSize = Math.round(clamp(fit.size * 0.62, 48, 60));
  }

  /** 脈衝在 t 時的半徑（第一拍出發、outCubic，dur 秒掃過全部的字）。 */
  private pulseR(t: number) {
    return this.dMin + (this.dMax - this.dMin) * ease.outCubic(clamp((t - this.tFirst) / this.dur));
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const vis = prog(t, s, s + 0.35) * (1 - prog(t, e - 0.35, e, ease.inCubic));
    // 波一拍往外推一個波長：拍點上 outExpo 推出去、之間停住
    const b = au.beatAt(t), bi = Math.floor(b);
    const ph = bi + ease.outExpo(clamp((b - bi) / 0.45));
    const u = this.bg.u;
    (u.s1!.value as THREE.Vector2).set(this.s1.x, this.s1.y); // 著色器也用 y 向下的座標
    (u.s2!.value as THREE.Vector2).set(this.s2.x, this.s2.y);
    (u.calm!.value as THREE.Vector4).set(this.calm[0], this.calm[1], this.calm[0] + this.calm[2], this.calm[1] + this.calm[3]);
    u.lam!.value = this.lam; u.ph!.value = ph; u.k!.value = vis; u.kick!.value = f.a.kick;
    // 第一拍的強脈衝
    const pr = this.pulseR(t);
    u.pr!.value = t >= this.tFirst ? pr : -100;
    u.pk!.value = t >= this.tFirst ? 1 - prog(t, this.tFirst + this.dur * 0.7, this.tFirst + this.dur + 0.3) : 0;
    // 之後每個小節線一道淡的
    const tb = au.timeOfBar(Math.floor(au.barAt(t) + 1e-4));
    const ra = t - tb, sweep = Math.max(this.dMax + 200, 1500) / 1.1;
    const late = tb > this.tFirst + this.dur;
    u.rr!.value = late && ra < 1.1 ? 20 + sweep * ra : -100;
    u.rk!.value = late ? 1 - clamp(ra / 1.1) : 0;
    this.bg.render(renderer, out);

    const Lc = this.layer, c = Lc.ctx, HL = this.hot, hc = HL.ctx;
    Lc.clear(); HL.clear();
    c.globalAlpha = hc.globalAlpha = vis;
    // ---- 波源的名字（小字第一群）
    mono(c, 'S₁  宣文', this.s1.x + 26, this.s1.y + 5, { size: 15, tracking: 2, color: rgba('bone', 0.6) });
    mono(c, 'S₂  孟庭', this.s2.x + 26, this.s2.y + 5, { size: 15, tracking: 2, color: rgba('signal', 0.65) });
    const m = this.msg;
    if (m) {
      // ---- 留言：脈衝掃到就亮（燒紅、0.5 秒冷卻），每小節的淡脈衝經過時閃一下
      const fit = this.fit!;
      c.font = hc.font = font(FAM_MSG, fit.size);
      const ringR = late && ra < 1.1 ? 20 + sweep * ra : -1e4;
      for (const g of this.glyphs) {
        if (t < g.t) continue;
        const heat = Math.max(1 - clamp((t - g.t) / 0.5), 0.45 * Math.exp(-(((g.d - ringR) / 40) ** 2)));
        const base = g.ch === '♥' ? 'rose' : 'bone';
        c.fillStyle = heat > 0.02 ? mixRgba(base, 'signal', heat) : rgba(base);
        c.fillText(g.ch, g.x, g.y);
        if (heat > 0.05) { hc.fillStyle = rgba('signal', heat * 0.8); hc.fillText(g.ch, g.x, g.y); }
      }
      if (t >= this.sigT) {
        c.save(); c.globalAlpha *= prog(t, this.sigT, this.sigT + 0.3);
        c.font = font(F.ming(400), 42); c.fillStyle = rgba('ash'); c.textAlign = 'right';
        // 署名的高度可能進到右下角 QR 那一帶：最多到 x = 1340
        fillWithHearts(c, this.sig, this.sigY > 800 ? Math.min(this.sigX, 1340) : this.sigX, this.sigY);
        c.restore();
      }
    }
    this.lyric(c, t);
    // ---- 註腳（小字第三群）
    tag(c, FOOT, 124, 962, { size: 17, color: rgba('ash', 0.5), tracking: 1 });
    comp.draw(renderer, Lc.upload(), out);
    comp.draw(renderer, HL.upload(), out, { mode: 'add', tint: [1.8, 1.8, 1.8] });
    // 鏡頭：整個窗格慢慢往前推（inOutSine）
    const cam = (1 - Math.cos(Math.PI * clamp((t - s) / Math.max(1, e - s)))) / 2;
    return { bloom: 0.7, vignette: 0.5, halation: 0.22, zoom: 1 + PUSH * cam + 0.003 * f.a.kick };
  }

  /** 歌詞：有留言時在上方（小一級）；沒有留言時放大、坐在中央的亮紋上，唱到的字發光。純音樂寫歌名。 */
  private lyric(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    const m = this.msg;
    // 小字第二群：歌詞上面的「疊加中」
    mono(c, this.lyricsInWindow ? '♪  疊加中　SUPERPOSITION' : '♪  波源頻率取自', 124, 114, { size: 15, tracking: 3, color: rgba('signal', 0.55) });
    const ly = lyricAt(lyrics, t, m ? 1.2 : 1.8);
    if (!ly) {
      if (!this.lyricsInWindow) {
        c.font = font(F.archivo(100, 700), m ? 52 : 88); c.fillStyle = rgba('bone', 0.85);
        c.fillText(song.title, m ? LYR_M.x : LYR_N.x, m ? LYR_M.y - 8 : this.yc + 30);
      }
      if (!m && t >= this.tFirst + this.dur) {
        c.save(); c.globalAlpha *= prog(t, this.tFirst + this.dur, this.tFirst + this.dur + 0.4);
        c.font = font(F.hand(700), 32); c.fillStyle = rgba('ash', 0.9);
        c.fillText(INVITE, LYR_N.x, this.yc + 150);
        c.restore();
      }
      return;
    }
    const st = m ? { family: F.archivo(100, 800), size: this.lyrSize, minSize: 48, maxWidth: LYR_M.w } : { family: F.archivo(100, 800), size: LYR_N.size, minSize: 64, maxWidth: LYR_N.w };
    const lay = layoutLyric(c, ly.line, st);
    const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.1));
    const ox = m ? LYR_M.x : LYR_N.x;
    const oy = m ? LYR_M.y - (lay.height - lay.size) * 0.5 : this.yc - lay.height / 2 + lay.size * 0.8;
    c.save(); c.translate(ox, oy + (1 - inK) * 16);
    drawLyric(c, ly.line, t, st, lay, ly.k * c.globalAlpha);
    c.restore();
    if (!m && t >= this.tFirst + this.dur) {
      c.save(); c.globalAlpha *= prog(t, this.tFirst + this.dur, this.tFirst + this.dur + 0.4);
      c.font = font(F.hand(700), 32); c.fillStyle = rgba('ash', 0.9);
      c.fillText(INVITE, LYR_N.x, this.yc + 150);
      c.restore();
    }
  }
}

/** outCubic 的反函數：脈衝半徑用 outCubic 長大，字要在脈衝「剛好掃到」的那一刻亮。 */
function invOutCubic(y: number) { return 1 - Math.cbrt(1 - clamp(y)); }
