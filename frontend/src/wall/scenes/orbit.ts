// 雙星軌道（暗）：夜空裡兩顆星（α 宣文、β 孟庭）繞著共同質心轉，一小節一圈，
// 軌道是真的克卜勒軌道（偏心率 0.55）：遠心點慢、近心點快——近心點（兩星最靠近的那一刻）永遠落在小節的第一拍，
// 所以每個重拍兩顆星「擦身而過」、質心發出一圈波紋，強烈的緩動是物理本身給的。軌道每小節進動一點，拖出來的軌跡是一朵花。
// MV 版：鏡頭整個窗格慢慢從斜上方往下看、再往前推一點（軌道面的傾角跟著變）；小字只剩三群（星名、「觀測紀錄」、一行結論）。
//  - 背景是兩星的洛希位能等位線（shader 即時算，跟著兩顆星變形）：很淡的版畫線、離系統越遠越淡，
//    最亮的那一條是通過 L₁ 的 8 字形「洛希瓣」；一串小光點從 β 的瓣流向 α——物質（與感情）交流中。
//  - 主打留言是焦點：下方大大的手寫字，一兩個字一組、一拍一組地「收到」（訊號色 → 紙白），署名，最後一行小小的結論。
//    留言後面的等位線壓暗，字很乾淨。
//  - 歌詞是左上的圖註（比留言小一級），一條很淡的引線從句尾拉到其中一顆星，星在動、線跟著甩；照跟唱規則逐字亮。
//  - 沒有留言：歌詞放大到下方當焦點（引線照樣拉到星上），下面一行小字邀請。純音樂：圖註寫這首歌的歌名。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, prog, pulse, TAU } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { lyricAt, drawLyric, layoutLyric, beatAfter, signature, fillWithHearts } from './_motifs';
import { stagger, mono, tag } from './_t11';

export const spec: PlateSpecDecl = { group: 'type', family: 'science', paper: false, energy: [0.2, 0.85], bars: [4, 12], weight: 1 };

// ---------------------------------------------------------------- 軌道參數
/** 質心在螢幕上的位置；軌道面傾角（鏡頭）從 INC0 慢慢變到 INC1。 */
const CEN = { x: 1250, y: 372 };
const INC0 = (66 * Math.PI) / 180, INC1 = (50 * Math.PI) / 180;
/** 兩星的質量（α 宣文、β 孟庭）、相對軌道的半長軸（px）、偏心率、每小節進動。 */
const M1 = 1, M2 = 0.8, MT = M1 + M2;
const A = 300, ECC = 0.55, PREC = (11 * Math.PI) / 180, OMEGA0 = (200 * Math.PI) / 180;

/** 解克卜勒方程：平近點角 M → 相對位置（軌道面座標）與距離。 */
function kepler(Mean: number, w: number) {
  let E = Mean;
  for (let i = 0; i < 8; i++) E -= (E - ECC * Math.sin(E) - Mean) / (1 - ECC * Math.cos(E));
  const nu = 2 * Math.atan2(Math.sqrt(1 + ECC) * Math.sin(E / 2), Math.sqrt(1 - ECC) * Math.cos(E / 2));
  const r = A * (1 - ECC * Math.cos(E));
  return { x: r * Math.cos(nu + w), y: r * Math.sin(nu + w), r };
}

// ---------------------------------------------------------------- 版面
/** 有留言：歌詞在左上；留言在下方一整條（後面的等位線壓暗）。 */
const LYR_M = { x: 124, y: 252, w: 780 };
const MSG = { x: 124, y: 640, w: 1320, h: 250 };
/** 沒有留言：歌詞放大到下方。 */
const LYR_N = { x: 124, y: 790, w: 1320, size: 100 };
/** 留言後面等位線要壓暗的範圍（x0, y0, x1, y1）。 */
const CALM: [number, number, number, number] = [96, 600, 1480, 930];
const FAM_MSG = F.hand(700);
const CONCL = '結論：兩星軌道穩定，預計永遠互繞。';
const INVITE = '掃描右下角 QR code，發送你的祝福訊號。';
/** 鏡頭推近的最大倍率（最下面一行小字的位置照這個算）。 */
const PUSH = 0.02;

const BG = () => new FSPass(/* glsl */ `
  uniform vec2 p1; uniform vec2 p2; uniform float sep; uniform float phiL1; uniform float k; uniform float kick; uniform float peri;
  uniform float ci; uniform vec4 calm;
  float pot(vec2 q) {
    float d1 = length(q - p1), d2 = length(q - p2);
    return -(${M1.toFixed(2)} / sqrt(d1 * d1 + 100.0) + ${M2.toFixed(2)} / sqrt(d2 * d2 + 100.0)) - 0.5 * ${MT.toFixed(2)} / (sep * sep * sep) * dot(q, q);
  }
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 q = vec2(sp.x - ${CEN.x}.0, (sp.y - ${CEN.y}.0) / ci);
    float ph = pot(q);
    // 夜空：很暗，幾顆很淡的背景星
    vec3 col = C_INK + (C_INK2 - C_INK) * 0.45 * (0.6 + 0.4 * fbm(sp / 640.0, 3));
    vec2 cell = floor(sp / 3.0);
    float st = step(0.9986, hash12(cell)) * (0.3 + 0.7 * hash12(cell + 7.0));
    // 留言那一塊壓暗（等位線、星都淡掉），字才乾淨
    vec2 cq = max(calm.xy - sp, sp - calm.zw);
    float quiet = 1.0 - 0.8 * (1.0 - smoothstep(0.0, 120.0, max(cq.x, cq.y)));
    col += C_BONE * st * 0.28 * quiet;
    // 等位線：log(-Φ) 等距；太密的地方（星的旁邊）淡掉，離系統越遠越淡
    float v = log(-ph * 1000.0) * 7.0;
    float fw = max(fwidth(v), 1e-4);
    float d = abs(fract(v + 0.5) - 0.5) / fw;
    float dens = 1.0 - smoothstep(0.18, 0.45, fw);
    float fall = exp(-length(q) / 520.0);
    float lineA = (1.0 - smoothstep(0.35, 1.25, d)) * dens * fall * quiet;
    col += mix(C_GRAPHITE, C_ASH, 0.3) * lineA * (0.17 + 0.2 * kick + 0.3 * peri) * k;
    // 洛希瓣：通過 L1 的那一條等位線（訊號色），瓣裡面淡淡地染上各自的顏色
    // 同一個位能值在很外面（離心項）還有一圈：只要兩星附近的那個 8 字
    float near = 1.0 - smoothstep(1.2 * sep, 1.45 * sep, length(q));
    float dl = abs(ph - phiL1) / max(fwidth(ph), 1e-7);
    float lobe = (1.0 - smoothstep(0.4, 1.4, dl)) * near;
    col += C_SIGNAL * lobe * (0.5 + 0.6 * peri) * k;
    if (ph < phiL1 && near > 0.5) {
      float closer = step(length(q - p2), length(q - p1));
      col += mix(C_BONE * 0.015, C_SIGNAL * 0.03, closer) * k;
    }
    fragColor = vec4(col, 1.0);
  }`, {
  p1: { value: new THREE.Vector2() }, p2: { value: new THREE.Vector2() }, sep: { value: 300 }, phiL1: { value: 0 },
  k: { value: 1 }, kick: { value: 0 }, peri: { value: 0 }, ci: { value: Math.cos(INC0) },
  calm: { value: new THREE.Vector4(...CALM) },
});

interface Glyph { ch: string; x: number; y: number; t: number }

export default class Orbit extends Scene {
  bg = shared('orbit.bg', BG);
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  lines = this.track(new LineBatch(4096, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  fit: FitResult | null = null;
  glyphs: Glyph[] = [];
  sig = ''; sigT = Infinity; conclT = Infinity; sigY = 0; sigX = 0;
  tFirst = 0;
  lyrSize = 64;
  lyricsInWindow = false;
  /** 這一格軌道面的 cos／sin 傾角（鏡頭）。 */
  ci = Math.cos(INC0); si = Math.sin(INC0);

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.sig = m ? (m.couple ? '—— 新郎新娘' : signature(m.name)) : '';
    await loadText(`${m?.text ?? ''}${this.sig}${CONCL}${INVITE}${song.title}${song.artist}觀測紀錄宣文孟庭`);
    const c = this.layer.ctx;
    const beat = au.beatPeriod(s);
    this.tFirst = beatAfter(au, s + Math.min(0.2, beat * 0.4));
    const bar = au.timeOfBar(au.barAt(this.tFirst) + 1) - this.tFirst;
    this.lyricsInWindow = lyrics.linesIn(s, e).length > 0;
    if (!m) { this.conclT = beatAfter(au, s + 0.4); return; }
    const fit = this.fit = fitText(c, m.text, FAM_MSG, MSG.w, MSG.h - 60, { min: 48, max: 140, lineHeight: 1.28, maxLines: 3 });
    // 一組兩三個字（標點斷開），一拍一組「收到」
    const chars: { ch: string; x: number; y: number }[] = [];
    const top = MSG.y + fit.size * 0.9 + Math.max(0, (MSG.h - 60 - fit.height) * 0.4);
    c.font = font(FAM_MSG, fit.size);
    fit.lines.forEach((ln, li) => {
      let x = MSG.x;
      for (const ch of Array.from(ln)) { chars.push({ ch, x, y: top + li * fit.lineHeight }); x += c.measureText(ch).width; }
    });
    const groups: number[] = [];
    let g = 0, cnt = 0;
    for (const ch of chars) {
      groups.push(g);
      cnt++;
      if (cnt >= 3 || /[，。！？、,.!?~～…\s]/.test(ch.ch)) { g++; cnt = 0; }
    }
    const nG = (groups[groups.length - 1] ?? 0) + 1;
    const times = stagger(au, this.tFirst + beat * 0.5, nG, Math.min(2 * bar, 0.42 * (e - s)));
    this.glyphs = chars.map((ch, i) => ({ ...ch, t: times[groups[i]!]! }));
    const tLast = times[nG - 1] ?? this.tFirst;
    this.sigT = tLast + beat * 0.5;
    this.conclT = Math.min(e - 0.8, tLast + beat * 1.5);
    this.sigY = top + (fit.lines.length - 1) * fit.lineHeight + 62;
    // 署名靠右對齊留言，但最多到 x = 1340（署名的高度會進到右下角 QR 那一帶）
    this.sigX = Math.min(MSG.x + Math.min(MSG.w, fit.width), 1340);
    // 歌詞比留言小一級
    this.lyrSize = Math.round(clamp(fit.size * 0.6, 48, 58));
  }

  /** 軌道面 → 螢幕（y 向下；z > 0 在前面）。 */
  private toScreen(qx: number, qy: number) { return { x: CEN.x + qx, y: CEN.y + qy * this.ci, z: qy * this.si }; }

  /** 這一格兩顆星在軌道面上的位置（相對質心）與距離；近心點在每小節的第一拍。 */
  private bodies(t: number) {
    const bar = this.ctx.audio.barAt(t);
    const w = OMEGA0 + PREC * bar;
    const rel = kepler(TAU * (bar - Math.floor(bar)), w);
    return { p1: { x: (-M2 / MT) * rel.x, y: (-M2 / MT) * rel.y }, p2: { x: (M1 / MT) * rel.x, y: (M1 / MT) * rel.y }, r: rel.r, w, rel };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const fadeIn = prog(t, s, s + 0.35), exit = prog(t, e - 0.35, e, ease.inCubic);
    const vis = fadeIn * (1 - exit);
    // 鏡頭：整個窗格慢慢從斜上方往下看（傾角變小＝軌道面立起來一點），同時往前推（inOutSine）
    const cam = (1 - Math.cos(Math.PI * clamp((t - s) / Math.max(1, e - s)))) / 2;
    const inc = lerp(INC0, INC1, cam);
    this.ci = Math.cos(inc); this.si = Math.sin(inc);
    const B = this.bodies(t);
    const bar = au.barAt(t);
    const peri = pulse(t, au.timeOfBar(Math.floor(bar + 1e-4)), 0.16);

    // ---- L1：兩星連線上位能最高的點
    const pot = (qx: number, qy: number) => -(M1 / Math.sqrt((qx - B.p1.x) ** 2 + (qy - B.p1.y) ** 2 + 100) + M2 / Math.sqrt((qx - B.p2.x) ** 2 + (qy - B.p2.y) ** 2 + 100)) - (0.5 * MT / B.r ** 3) * (qx * qx + qy * qy);
    let best = -Infinity, L1 = { x: 0, y: 0 };
    for (let i = 4; i <= 96; i++) {
      const u = i / 100, qx = B.p1.x + (B.p2.x - B.p1.x) * u, qy = B.p1.y + (B.p2.y - B.p1.y) * u;
      const v = pot(qx, qy);
      if (v > best) { best = v; L1 = { x: qx, y: qy }; }
    }
    const u = this.bg.u;
    (u.p1!.value as THREE.Vector2).set(B.p1.x, B.p1.y);
    (u.p2!.value as THREE.Vector2).set(B.p2.x, B.p2.y);
    u.sep!.value = B.r; u.phiL1!.value = best; u.k!.value = vis; u.kick!.value = f.a.kick; u.peri!.value = peri; u.ci!.value = this.ci;
    this.bg.render(renderer, out);

    const lb = this.lines; lb.clear();
    const L = this.layer, c = L.ctx;
    L.clear();
    c.globalAlpha = vis;
    const S1 = this.toScreen(B.p1.x, B.p1.y), S2 = this.toScreen(B.p2.x, B.p2.y);

    // ---- 軌道（很淡的虛線橢圓）、第一拍的刻度、拖出來的軌跡
    const ash = LIN.ash, sig = LIN.signal, bone = LIN.bone;
    for (const [share, col] of [[-M2 / MT, bone], [M1 / MT, sig]] as const) {
      let prev: { x: number; y: number } | null = null;
      for (let i = 0; i <= 120; i++) {
        const k = kepler((TAU * i) / 120, B.w);
        const p = this.toScreen(share * k.x, share * k.y);
        if (prev && i % 2 === 0) lb.seg2(prev.x, prev.y, p.x, p.y, 1, [ash[0] * 0.18 * vis, ash[1] * 0.18 * vis, ash[2] * 0.18 * vis], 1);
        prev = p;
      }
      const k0 = kepler(0, B.w), p0 = this.toScreen(share * k0.x, share * k0.y), g0 = 0.6 * vis;
      lb.seg2(p0.x - 4, p0.y, p0.x + 4, p0.y, 1.3, [col[0] * g0, col[1] * g0, col[2] * g0], 1);
      lb.seg2(p0.x, p0.y - 4, p0.x, p0.y + 4, 1.3, [col[0] * g0, col[1] * g0, col[2] * g0], 1);
      // 軌跡：過去一又四分之一圈，越舊越淡（進動讓它畫成一朵花）
      let q: { x: number; y: number } | null = null;
      const n = 90;
      for (let i = 0; i <= n; i++) {
        const bb = bar - 1.25 * (1 - i / n);
        const w = OMEGA0 + PREC * bb;
        const k = kepler(TAU * (bb - Math.floor(bb)), w);
        const p = this.toScreen(share * k.x, share * k.y);
        if (q) { const a = (i / n) ** 1.6 * vis * (col === sig ? 1.2 : 0.7); lb.seg2(q.x, q.y, p.x, p.y, 1.8, [col[0] * a, col[1] * a, col[2] * a], 1); }
        q = p;
      }
    }
    // 近心點：質心發出一圈波紋（軌道面上的圓，投影成橢圓）
    const tp = au.timeOfBar(Math.floor(bar + 1e-4)), age = t - tp;
    if (age >= 0 && age < 0.9) {
      const rr = 30 + 420 * ease.outCubic(age / 0.9), a = (1 - age / 0.9) ** 2 * 0.8 * vis;
      let prev: { x: number; y: number } | null = null;
      for (let i = 0; i <= 72; i++) {
        const p = this.toScreen(Math.cos((TAU * i) / 72) * rr, Math.sin((TAU * i) / 72) * rr);
        if (prev) lb.seg2(prev.x, prev.y, p.x, p.y, 1.4, [sig[0] * a * 1.5, sig[1] * a * 1.5, sig[2] * a * 1.5], 1);
        prev = p;
      }
    }
    // 物質交流：一串小光點從 β 的瓣經過 L1 流向 α（稍微彎一點）
    const dx = B.p1.x - L1.x, dy = B.p1.y - L1.y, len = Math.hypot(dx, dy) || 1;
    for (let i = 0; i < 14; i++) {
      const uu = (t * 0.9 + i / 14) % 1;
      const bend = Math.sin(Math.PI * uu) * 0.35 * len;
      const qx = L1.x + dx * uu - (dy / len) * bend, qy = L1.y + dy * uu + (dx / len) * bend;
      const p = this.toScreen(qx, qy);
      const a = Math.sin(Math.PI * uu) * 1.3 * vis;
      lb.seg2(p.x, p.y, p.x + 0.01, p.y, 3, [sig[0] * a, sig[1] * a, sig[2] * a], 1);
    }

    // ---- 兩顆星：β 會發光，α 是紙白的實心點加一圈細環；名字小小地跟著星走（小字第一群）
    c.fillStyle = rgba('bone'); c.beginPath(); c.arc(S1.x, S1.y, 10, 0, TAU); c.fill();
    c.strokeStyle = rgba('bone', 0.5); c.lineWidth = 1.3; c.beginPath(); c.arc(S1.x, S1.y, 18 + 5 * peri, 0, TAU); c.stroke();
    const glowB = 1 + 1.3 * peri;
    lb.seg2(S2.x, S2.y, S2.x + 0.01, S2.y, 32, [sig[0] * 0.3 * glowB * vis, sig[1] * 0.3 * glowB * vis, sig[2] * 0.3 * glowB * vis], 0.5);
    lb.seg2(S2.x, S2.y, S2.x + 0.01, S2.y, 14, [LIN.ember[0] * 2.2 * vis, LIN.ember[1] * 2.2 * vis, LIN.ember[2] * 2.2 * vis], 0.9);
    lb.seg2(S2.x, S2.y, S2.x + 0.01, S2.y, 6, [5 * vis, 4.4 * vis, 3.6 * vis], 1);
    mono(c, 'α  宣文', S1.x + 22, S1.y - 14, { size: 15, tracking: 2, color: rgba('bone', 0.6) });
    mono(c, 'β  孟庭', S2.x + 22, S2.y - 14, { size: 15, tracking: 2, color: rgba('signal', 0.7) });

    this.caption(c, t, S1, S2);
    this.log(c, t);
    comp.draw(renderer, L.upload(), out);
    if (lb.count) lb.render(renderer, out);
    return { bloom: 0.75, vignette: 0.55, halation: 0.28, zoom: 1 + PUSH * cam + 0.005 * peri };
  }

  /** 歌詞：有留言時是左上的圖註（小一級），沒有留言時放大到下方；句尾一條很淡的引線拉到其中一顆星（一句換一顆）。 */
  private caption(c: CanvasRenderingContext2D, t: number, S1: { x: number; y: number }, S2: { x: number; y: number }) {
    const { lyrics, song } = this.ctx;
    const box = this.msg ? { ...LYR_M, size: this.lyrSize } : LYR_N;
    const ly = lyricAt(lyrics, t, 1.6);
    let end: { x: number; y: number } | null = null;
    let target = S2;
    c.save();
    if (ly) {
      const st = { family: F.archivo(100, 800), size: box.size, minSize: 48, maxWidth: box.w };
      const lay = layoutLyric(c, ly.line, st);
      const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.12));
      const oy = box.y - (lay.height - lay.size) + (1 - inK) * 16;
      c.save(); c.translate(box.x, oy);
      drawLyric(c, ly.line, t, st, lay, ly.k * c.globalAlpha);
      c.restore();
      const row = lay.rows[0]!;
      end = { x: box.x + row.x + row.width + 18, y: oy - lay.size * 0.34 };
      target = ly.line.i % 2 === 0 ? S2 : S1;
      c.globalAlpha *= ly.k;
    } else if (!this.lyricsInWindow) {
      const size = Math.round(box.size * 0.8);
      c.font = font(F.archivo(100, 700), size); c.fillStyle = rgba('bone', 0.85);
      c.fillText(song.title, box.x, box.y - 6);
      end = { x: box.x + Math.min(box.w, c.measureText(song.title).width) + 18, y: box.y - 6 - size * 0.34 };
    }
    if (end) {
      // 引線：先水平一小段，再直直拉到星的旁邊（停在星外面一點）
      const ex = end.x + 36, ang = Math.atan2(target.y - end.y, target.x - ex);
      const tx = target.x - Math.cos(ang) * 24, ty = target.y - Math.sin(ang) * 24;
      c.strokeStyle = rgba('ash', 0.32); c.lineWidth = 1;
      c.beginPath(); c.moveTo(end.x, end.y); c.lineTo(ex, end.y); c.lineTo(tx, ty); c.stroke();
      c.fillStyle = rgba('ash', 0.5); c.beginPath(); c.arc(end.x, end.y, 2.2, 0, TAU); c.fill();
    }
    c.restore();
  }

  /** 觀測紀錄：留言一組一組「收到」、署名、結論（小字）。沒有留言：一行邀請。 */
  private log(c: CanvasRenderingContext2D, t: number) {
    const m = this.msg;
    const s = this.ctx.start, e = this.ctx.end;
    c.globalAlpha = prog(t, s, s + 0.35) * (1 - prog(t, e - 0.35, e, ease.inCubic));
    if (m) {
      // 小字第二群：「觀測紀錄」
      mono(c, m.couple ? '觀測紀錄　·　新人' : '觀測紀錄　OBSERVATION', MSG.x, MSG.y - 18, { size: 15, tracking: 4, color: rgba('signal', 0.55) });
      const fit = this.fit!;
      c.font = font(FAM_MSG, fit.size);
      for (const g of this.glyphs) {
        if (t < g.t) continue;
        const heat = 1 - clamp((t - g.t) / 0.45);
        const base = g.ch === '♥' ? 'rose' : 'bone';
        const dy = (1 - ease.outExpo(clamp((t - g.t) / 0.25))) * 14;
        c.fillStyle = heat > 0 ? mixRgba(base, 'signal', heat) : rgba(base);
        c.fillText(g.ch, g.x, g.y + dy);
      }
      if (t >= this.sigT) {
        c.save(); c.globalAlpha *= prog(t, this.sigT, this.sigT + 0.3);
        c.font = font(F.hand(400), 42); c.fillStyle = rgba('ash'); c.textAlign = 'right';
        fillWithHearts(c, this.sig, this.sigX, this.sigY);
        c.restore();
      }
    } else if (t >= this.conclT) {
      c.save(); c.globalAlpha *= prog(t, this.conclT, this.conclT + 0.4);
      c.font = font(F.hand(700), 32); c.fillStyle = rgba('ash', 0.9);
      c.fillText(INVITE, LYR_N.x, LYR_N.y + 74);
      c.restore();
    }
    // 小字第三群：結論
    if (m && t >= this.conclT) {
      c.save(); c.globalAlpha *= prog(t, this.conclT, this.conclT + 0.3);
      tag(c, CONCL, MSG.x, 962, { size: 18, color: rgba('ash', 0.6), tracking: 3 });
      c.restore();
    }
  }
}
