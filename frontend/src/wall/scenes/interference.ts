// 波的干涉（暗）：課本上那張「兩個波源的干涉圖」做成會動的版畫。左邊兩個點波源（S₁ 宣文、S₂ 孟庭）同頻同相，
// 各自畫出一圈圈同心圓（實線是波峰）：紙白的一家、訊號色的一家，兩家交疊的地方就是亮紋——一條條往右張開的雙曲線。
//  - 波一拍往外推一個波長：拍點上「推」出去（outExpo），拍子之間停住。交點會亮一下（加亮超過門檻就發光）。
//  - 主打留言的每一行剛好坐在一條亮紋上：波源的間距是照留言的行距算的（Δ = mλ），所以字真的浮在干涉條紋亮的地方。
//  - 第一拍兩個波源同時發出一道強的脈衝，脈衝掃過哪裡、那裡的字就亮起來（燒紅、冷卻成紙白），之後每個小節線再掃一道淡的。
//  - 歌詞在上方（逐字跟唱）；左下是一本正經的讀數與註腳。
//  - 沒有留言：亮紋上是「宣文♥孟庭」與邀請。純音樂：上方寫歌名。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { lyricAt, drawLyric, layoutLyric, beatAfter, signature, fillWithHearts, COUPLE_ZH } from './_motifs';
import { pad3, mono, tag, type Rect } from './_t11';

export const spec: PlateSpecDecl = { group: 'type', family: 'science', paper: false, energy: [0.25, 0.85], bars: [4, 10], weight: 1 };

/** 波源的 x、留言排的範圍（右下角 QR 上面）。 */
const SRC_X = 214;
const BOX = { x: 540, y: 336, w: 800, h: 440 };
const LYR = { x: 124, y: 222, w: 1220, size: 68 };
const FAM_MSG = F.ming(700);
/** 想要的波長（px）：太密會閃、太疏不像干涉圖。 */
const LAMBDA = 36;
const INVITE = '掃描右下角 QR code，讓你的祝福也發亮。';
const FOOT = '＊兩個波源同頻同相：步調一致的兩個人，會在很多地方一起發亮。';

const BG = () => new FSPass(/* glsl */ `
  uniform vec2 s1; uniform vec2 s2; uniform float lam; uniform float ph; uniform float k;
  uniform float pr; uniform float pk; uniform float rr; uniform float rk; uniform float kick; uniform vec4 calm;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float r1 = length(p - s1), r2 = length(p - s2);
    vec3 col = C_INK + (C_INK2 - C_INK) * (0.25 + 0.35 * fbm(p / 520.0, 3));
    // 振幅隨距離衰減（圓面波 ~ 1/√r），波源旁邊不要太亮
    float a1 = 1.0 / (1.0 + r1 / 330.0), a2 = 1.0 / (1.0 + r2 / 330.0);
    // 留言那一塊的波峰線淡一點（亮紋的光帶照樣在），字才讀得清楚
    vec2 cq = max(calm.xy - p, p - calm.zw);
    float quiet = 1.0 - 0.62 * (1.0 - smoothstep(0.0, 90.0, max(cq.x, cq.y)));
    // 時間平均的亮度：cos²(πΔ/λ) → 亮紋（很淡的一層光帶）
    float I = pow(cos(PI * (r2 - r1) / lam), 2.0);
    col += C_SIGNAL * 0.024 * I * (a1 + a2) * k;
    // 波峰：兩家同心圓（細線）
    float q1 = abs(fract(r1 / lam - ph + 0.5) - 0.5) * lam;
    float q2 = abs(fract(r2 / lam - ph + 0.5) - 0.5) * lam;
    float c1 = pxLine(q1, 0.45, 1.35) * a1, c2 = pxLine(q2, 0.45, 1.35) * a2;
    float fade = smoothstep(${W}.0 + 80.0, 600.0, p.x) * 0.55 + 0.45;
    col += (C_BONE * c1 * 0.13 + C_SIGNAL * c2 * 0.2) * k * fade * quiet;
    // 交點（兩家波峰疊在一起）＝ 建設性干涉：亮一下，大鼓時更亮
    col += C_EMBER * c1 * c2 * (0.8 + 1.4 * kick) * k * fade * quiet;
    // 脈衝：第一拍的強脈衝、每小節線的淡脈衝（兩個波源各一道）
    float w1 = exp(-pow((r1 - pr) / 5.0, 2.0)) + exp(-pow((r2 - pr) / 5.0, 2.0));
    float w2 = exp(-pow((r1 - rr) / 5.0, 2.0)) + exp(-pow((r2 - rr) / 5.0, 2.0));
    col += C_SIGNAL * (w1 * pk * 1.0 + w2 * rk * 0.45) * k;
    // 波源
    float d1 = min(r1, r2);
    col += C_EMBER * (1.0 - smoothstep(4.0, 6.0, d1)) * 2.5 * k;
    col += C_BONE * pxLine(abs(d1 - 13.0), 0.4, 1.3) * 0.7 * k;
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
  lyricsInWindow = false;
  avoid: Rect[] = [];
  /** 留言的範圍（波峰線在這裡淡一點）。 */
  calm: Rect = [0, 0, 0, 0];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const text = m ? m.text : COUPLE_ZH.replace(/\s*&\s*/, '♥');
    this.sig = m ? (m.couple ? '—— 新郎新娘' : signature(m.name)) : '';
    await loadText(`${text}${this.sig}${INVITE}${FOOT}${song.title}${song.artist}宣文孟庭疊加中現場歌詞亮紋建設性干涉`);
    const c = this.layer.ctx;
    const fit = this.fit = fitText(c, text, FAM_MSG, BOX.w, BOX.h, { min: 44, max: m ? 104 : 96, lineHeight: 1.5, maxLines: 4 });
    const n = fit.lines.length;
    // ---- 行的位置：垂直置中；波源的中線對準中間那一行（奇數行）或兩行中間（偶數行）
    const y0 = BOX.y + (BOX.h - fit.height) / 2 + fit.size * 0.5; // 第一行字的中心
    const rowsY = fit.lines.map((_, i) => y0 + i * fit.lineHeight);
    const yc = (rowsY[0]! + rowsY[n - 1]!) / 2;
    // ---- 波源間距：讓離中線最近的那一行落在第 1 條（偶數行）亮紋上，其他行大致落在第 2、3… 條
    const L = BOX.x + BOX.w / 2 - SRC_X;
    const h1 = n % 2 === 1 ? (n > 1 ? fit.lineHeight : 110) : fit.lineHeight / 2;
    let d = (LAMBDA * Math.hypot(L, h1)) / h1;
    d = clamp(d, 180, 520);
    this.lam = (d * h1) / Math.hypot(L, h1);
    this.s1 = { x: SRC_X, y: yc - d / 2 }; this.s2 = { x: SRC_X, y: yc + d / 2 };

    // ---- 字：第一拍的脈衝掃到哪裡、那裡的字就亮
    const beat = au.beatPeriod(s);
    this.tFirst = beatAfter(au, s + Math.min(0.2, beat * 0.4));
    const bar = au.timeOfBar(au.barAt(this.tFirst) + 1) - this.tFirst;
    this.dur = clamp(Math.min(1.5 * bar, 0.4 * (e - s)), 0.6, 4);
    c.font = font(FAM_MSG, fit.size);
    const dist = (x: number, y: number) => Math.min(Math.hypot(x - this.s1.x, y - this.s1.y), Math.hypot(x - this.s2.x, y - this.s2.y));
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
    this.sigX = BOX.x + Math.max(...fit.lines.map((l) => c.measureText(l).width));
    this.sigY = rowsY[n - 1]! + fit.size * 0.36 + (m ? 70 : 0);
    this.lyricsInWindow = lyrics.linesIn(s, e).length > 0;

    // ---- 即時小卡避開：留言（含署名）與歌詞
    const msgR: Rect = [BOX.x - 20, rowsY[0]! - fit.size * 0.7, BOX.w + 40, this.sigY + 30 - (rowsY[0]! - fit.size * 0.7) + (m ? 0 : 70)];
    this.avoid = [msgR, msgR];
    this.calm = [BOX.x - 10, rowsY[0]! - fit.size * 0.6, Math.max(...fit.lines.map((l) => c.measureText(l).width)) + 20, rowsY[n - 1]! - rowsY[0]! + fit.size * 1.2];
    let rows = 1;
    for (const line of lyrics.linesIn(s, e)) rows = Math.max(rows, layoutLyric(c, line, { family: F.archivo(100, 800), size: LYR.size, minSize: 48, maxWidth: LYR.w }).rows.length);
    const lyr: Rect = [LYR.x - 12, LYR.y - LYR.size - 12, LYR.w + 24, LYR.size * (rows > 1 ? 2.3 : 1.2) + 24];
    this.avoid.push(lyr, lyr);
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

    const L = this.layer, c = L.ctx, HL = this.hot, hc = HL.ctx;
    L.clear(); HL.clear();
    c.globalAlpha = hc.globalAlpha = vis;
    // ---- 波源的標籤
    mono(c, 'S₁  宣文', this.s1.x + 26, this.s1.y + 5, { size: 16, tracking: 2, color: rgba('bone', 0.85) });
    mono(c, 'S₂  孟庭', this.s2.x + 26, this.s2.y + 5, { size: 16, tracking: 2, color: rgba('signal', 0.9) });
    // ---- 留言：脈衝掃到就亮（燒紅、0.5 秒冷卻），每小節的淡脈衝經過時閃一下
    const fit = this.fit!;
    c.font = hc.font = font(FAM_MSG, fit.size);
    const ringR = late && ra < 1.1 ? 20 + sweep * ra : -1e4;
    for (const g of this.glyphs) {
      if (t < g.t) continue;
      const heat = Math.max(1 - clamp((t - g.t) / 0.5), 0.55 * Math.exp(-(((g.d - ringR) / 40) ** 2)));
      const base = g.ch === '♥' ? 'rose' : 'bone';
      c.fillStyle = heat > 0.02 ? mixRgba(base, 'signal', heat) : rgba(base);
      c.fillText(g.ch, g.x, g.y);
      if (heat > 0.05) { hc.fillStyle = rgba('signal', heat * 0.8); hc.fillText(g.ch, g.x, g.y); }
    }
    if (this.msg && t >= this.sigT) {
      c.save(); c.globalAlpha *= prog(t, this.sigT, this.sigT + 0.3);
      c.font = font(F.ming(400), 38); c.fillStyle = rgba('ash'); c.textAlign = 'right';
      fillWithHearts(c, this.sig, this.sigX, this.sigY);
      c.restore();
    }
    if (!this.msg) {
      const tl = Math.max(...this.glyphs.map((g) => g.t));
      c.save(); c.globalAlpha *= prog(t, tl, tl + 0.4);
      c.font = font(F.hand(700), 44); c.fillStyle = rgba('bone', 0.9);
      c.fillText(INVITE, BOX.x, this.sigY + 92);
      c.restore();
    }
    this.lyric(c, t);
    // ---- 讀數與註腳
    const m = this.msg;
    mono(c, `No.${m ? pad3(m.n) : '000'}${m?.couple ? '  ·  FROM THE COUPLE' : ''}  ·  λ = ${this.lam.toFixed(1)} px  ·  d = ${Math.round(this.s2.y - this.s1.y)} px  ·  亮紋：Δ = mλ`, 124, 950, { size: 15, tracking: 2, color: rgba('ash', 0.7) });
    tag(c, FOOT, 124, 980, { size: 16, color: rgba('ash', 0.6), tracking: 1 });
    comp.draw(renderer, L.upload(), out);
    comp.draw(renderer, HL.upload(), out, { mode: 'add', tint: [1.8, 1.8, 1.8] });
    return { bloom: 0.75, vignette: 0.45, halation: 0.25, zoom: 1 + 0.005 * f.a.kick, popupAvoid: this.avoid };
  }

  /** 上方的歌詞：逐字跟唱；純音樂寫歌名。 */
  private lyric(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    mono(c, this.lyricsInWindow ? '♪  疊加中　SUPERPOSITION' : '♪  波源頻率取自', LYR.x, 120, { size: 15, tracking: 3, color: rgba('signal', 0.8) });
    const ly = lyricAt(lyrics, t);
    if (!ly) {
      if (!this.lyricsInWindow) { c.font = font(F.archivo(100, 700), 56); c.fillStyle = rgba('bone', 0.85); c.fillText(song.title, LYR.x, LYR.y - 8); }
      return;
    }
    const st = { family: F.archivo(100, 800), size: LYR.size, minSize: 48, maxWidth: LYR.w };
    const lay = layoutLyric(c, ly.line, st);
    const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.1));
    c.save(); c.translate(LYR.x, LYR.y - (lay.height - lay.size) * 0.5 + (1 - inK) * 16);
    drawLyric(c, ly.line, t, st, lay, ly.k * c.globalAlpha);
    c.restore();
  }
}

/** outCubic 的反函數：脈衝半徑用 outCubic 長大，字要在脈衝「剛好掃到」的那一刻亮。 */
function invOutCubic(y: number) { return 1 - Math.cbrt(1 - clamp(y)); }
