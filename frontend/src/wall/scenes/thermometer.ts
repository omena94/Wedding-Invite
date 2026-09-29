// 溫度計（批次 T18・儀器，亮）：一塊淺色木板上釘著一支老式的酒精溫度計（紅柱＝紙上的訊號色），
// 木板右邊刻著主打留言——字是刻進木頭的凹槽，一開始是空的（看得到淡淡的刻痕）。
//  - 紅柱跟著音樂的能量升降，窗格一開始一拍往上跳一格（彈簧，稍微衝過頭再回來）。
//  - 揭曉（小節線）：爆表——頂端的玻璃塞「啵」地彈飛、紅色的液體噴出一點點，沿著木板上刻好的溝槽流過去，
//    一個字一個字灌滿留言的凹槽（照閱讀順序、字裡由左到右），最後灌滿署名。灌好的字有液面的反光。
//  - 刻度旁的標註：刻度寫著冷面的註記（冷靜、心動、熱戀、爆表）；歌詞是一行鉛筆字寫在木板下方，
//    一條鉛筆拉的引線指著現在的液面（逐字跟唱，比留言小一級）。
//  - 沒有留言：凹槽刻的是「把你的祝福倒進來」＋一行邀請，爆表之後一樣灌滿。
// 畫法：整塊木板（木紋、刻字的凹槽與液體、玻璃管、刻度條）先在一個 shader 裡畫成一張正面的圖，
// 再交給 _t8 的舞台當成空間裡的平面來拍（斜斜的、推近、景深：揭曉前對焦在液面，揭曉後拉到留言上）。
// 刻字的遮罩用 _t14 的 orderMask（第幾個字、字裡的掃描順序），液體灌到哪裡只要一個數字。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog, pulse, springStep } from '../engine/util';
import { lyricAt, lyricSizeFor, type LyricStyle } from './_motifs';
import { grid, layoutRows, drawRows, paperInk, type Grid } from './_t4';
import { orderMask, lineItems, msgBlock, type MsgBlock, type OrderMask, type MaskItem } from './_t14';
import { Stage, camMove } from './_t8';
import { loadWindow, revealAt, beatsBetween } from './_t18';

export const spec: PlateSpecDecl = { group: 'type', family: 'science', paper: true, energy: [0.3, 1], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 木板上的位置（正面的圖 = 1920×1080）
/** 玻璃管的中心 x、管子的上下端、0 度與 100 度的高度、球的中心與半徑。 */
const TX = 300, T_TOP = 176, Y0 = 860, Y100 = 200, BY = 922, BR = 44;
const DEG = (Y0 - Y100) / 100;
/** 刻度條。 */
const STRIP = { x: 336, y: 168, w: 156, h: 716 };
/** 刻字的範圍（留言＋署名）。 */
const MBOX = { x: 600, y: 190, w: 1030, h: 580 };
/** 鉛筆寫的歌詞：右端停在 HUD 左邊。 */
const LYR = { x: 590, y: 900, w: 700 };
const FAM_MSG = F.hei(900);
const FAM_SIG = F.hand(700);
const FAM_LYR = F.hand(700);
const EMPTY = '把你的祝福倒進來';
const INVITE = '掃描右下角 QR code';
const MARKS: [number, string][] = [[0, '冷靜'], [37, '心動'], [70, '熱戀'], [100, '爆表']];

const BOARD = () => new FSPass(/* glsl */ `
  uniform sampler2D mask; uniform vec4 mR; uniform float hasMask;
  uniform float fillPos; uniform float chan; uniform float headY; uniform vec2 capP; uniform float capOn; uniform float t;
  uniform vec2 c0; uniform vec2 c1; uniform vec2 c2; uniform vec2 c3;
  const float TX = ${TX}.0, T_TOP = ${T_TOP}.0, BY = ${BY}.0, BR = ${BR}.0;
  vec3 liqColor() { return C_PAPER * pow(clamp(C_SIGNAL / max(C_PAPER, vec3(1e-3)), 0.004, 1.0), vec3(2.6)); }
  float seg(vec2 p, vec2 a, vec2 b, out float u) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); u = h * length(ba); return length(pa - ba * h); }
  void main() {
    vec2 P = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // ---- 淺色木板：橫向的木紋、幾條年輪
    float g = fbm(vec2(P.x / 900.0, P.y / 16.0), 3);
    float ring = sin((P.y + 90.0 * fbm(vec2(P.x / 700.0, P.y / 300.0), 2)) / 11.0);
    vec3 wood = mix(C_PAPER, C_SEPIA, 0.11 + 0.035 * g + 0.012 * ring) * (0.985 + 0.02 * snoise(vec2(P.x / 50.0, P.y / 2.0)));
    vec3 col = wood;
    vec3 liq = liqColor();
    // ---- 溝槽（從管子頂端流到第一個字）
    float u0, u1, u2;
    float d0 = seg(P, c0, c1, u0), d1 = seg(P, c1, c2, u1), d2 = seg(P, c2, c3, u2);
    float l0 = length(c1 - c0), l1 = length(c2 - c1);
    float dc = min(d0, min(d1, d2));
    float along = d0 <= d1 && d0 <= d2 ? u0 : (d1 <= d2 ? l0 + u1 : l0 + l1 + u2);
    float gA = 1.0 - smoothstep(5.0, 6.5, dc);
    if (gA > 0.0) {
      float f = step(along, chan);
      vec3 empty = wood * (0.74 + 0.18 * smoothstep(0.0, 5.0, dc));
      vec3 full = liq * (0.9 + 0.25 * (1.0 - smoothstep(0.0, 3.0, abs(dc - 2.0))));
      col = mix(col, mix(empty, full, f), gA);
    }
    // ---- 刻字：凹槽（空的看得到淡淡的刻痕），液體灌到哪裡由 fillPos 決定
    vec2 mu = (P - mR.xy) / mR.zw;
    if (hasMask > 0.5 && mu.x > 0.0 && mu.y > 0.0 && mu.x < 1.0 && mu.y < 1.0) {
      vec4 m = texture(mask, mu);
      float a = smoothstep(0.2, 0.8, m.a);
      if (a > 0.0) {
        vec2 o = vec2(2.0, 2.0) / mR.zw;
        float aUL = smoothstep(0.2, 0.8, texture(mask, mu - o).a);
        float aDR = smoothstep(0.2, 0.8, texture(mask, mu + o).a);
        float idx = floor(m.g * 255.0 + 0.5);
        float f = clamp((fillPos - idx - m.b) * 5.0, 0.0, 1.0);
        vec3 groove = wood * (0.87 - 0.22 * clamp(a - aUL, 0.0, 1.0) + 0.06 * clamp(a - aDR, 0.0, 1.0));
        vec3 lc = m.r > 0.9 ? C_ROSE * 0.95 : liq;
        // 液面：左上內緣一道反光、剛灌到的前緣亮一點
        vec3 full = lc * (0.88 + 0.1 * clamp(a - aDR, 0.0, 1.0)) + vec3(0.9) * 0.28 * clamp(a - aUL, 0.0, 1.0);
        full += lc * 0.35 * exp(-max(fillPos - idx - m.b, 0.0) * 12.0) * f;
        col = mix(col, mix(groove, full, f), a);
      }
    }
    // ---- 刻度條（琺瑯）與它的影子
    vec2 sc = vec2(${STRIP.x + STRIP.w / 2}.0, ${STRIP.y + STRIP.h / 2}.0), sh = vec2(${STRIP.w / 2}.0, ${STRIP.h / 2}.0);
    float ds = sdBox(P - sc - vec2(6.0, 8.0), sh - 6.0) - 6.0;
    col *= 1.0 - 0.18 * (1.0 - smoothstep(-6.0, 12.0, ds));
    ds = sdBox(P - sc, sh - 6.0) - 6.0;
    if (ds < 1.0) {
      vec3 en = mix(C_PAPER, C_BONE, 0.65) * (0.985 + 0.015 * snoise(P / 40.0));
      float v = (${Y0}.0 - P.y) / ${DEG.toFixed(4)};
      float minor = abs(mod(v + 1.0, 2.0) - 1.0) * ${DEG.toFixed(4)};
      float major = abs(mod(v + 5.0, 10.0) - 5.0) * ${DEG.toFixed(4)};
      float inR = step(-0.5, v) * step(v, 100.5);
      float tk = pxLine(minor, 0.35, 1.1) * step(P.x, ${STRIP.x + 16}.0) + pxLine(major, 0.6, 1.4) * step(P.x, ${STRIP.x + 34}.0);
      en = mix(en, C_SEPIA, clamp(tk * inR, 0.0, 1.0) * 0.8);
      en = mix(en, C_SEPIA, 0.5 * pxLine(abs(ds + 6.0), 0.4, 1.2));
      col = mix(en, col, smoothstep(-1.0, 1.0, ds));
    }
    // ---- 玻璃管與球的影子
    float dT = min(sdBox(P - vec2(TX + 12.0, (T_TOP + BY) * 0.5 + 12.0), vec2(18.0, (BY - T_TOP) * 0.5)), length(P - vec2(TX + 12.0, BY + 14.0)) - BR);
    col *= 1.0 - 0.22 * (1.0 - smoothstep(-8.0, 18.0, dT));
    // ---- 玻璃管：透明的管壁（左邊一道亮光、兩邊的暗邊），中間的細管裡是紅色的液柱
    float dx = P.x - TX;
    if (abs(dx) < 18.5 && P.y > T_TOP - 18.0 && P.y < BY) {
      float edge = smoothstep(18.5, 17.0, abs(dx)) * step(T_TOP, P.y) + (1.0 - smoothstep(17.0, 18.5, length(vec2(dx, P.y - T_TOP)))) * step(P.y, T_TOP);
      vec3 gc = col * 1.05 + vec3(0.025);
      gc = mix(gc, C_SEPIA * 0.6, 0.35 * pxLine(abs(abs(dx) - 17.0), 0.6, 1.6));
      gc += vec3(1.0) * 0.32 * exp(-pow((dx + 9.0) / 2.6, 2.0)) + vec3(1.0) * 0.08 * exp(-pow((dx - 11.0) / 3.0, 2.0));
      // 液柱（透過管子看起來比較粗）
      float bore = 1.0 - smoothstep(6.0, 7.2, abs(dx));
      float filled = step(headY, P.y);
      // 液面是圓的（凸起的頂）
      float men = 1.0 - smoothstep(6.0, 7.2, length(vec2(dx, (P.y - headY) * 1.6)));
      float lq = max(bore * filled, men * step(P.y, headY + 8.0) * step(headY - 8.0, P.y));
      vec3 lcol = liq * (0.85 + 0.3 * exp(-pow((dx + 2.5) / 1.6, 2.0)));
      gc = mix(gc, lcol, lq);
      gc = mix(gc, col * 0.93, bore * (1.0 - lq) * 0.4);
      col = mix(col, gc, edge);
    }
    // ---- 球：玻璃裡面裝滿液體
    float rb = length(P - vec2(TX, BY));
    if (rb < BR + 1.0) {
      vec3 bc = liq * (0.78 + 0.25 * (1.0 - rb / BR));
      bc += vec3(1.0) * 0.55 * exp(-pow(length(P - vec2(TX - 15.0, BY - 16.0)) / 8.0, 2.0));
      bc = mix(bc, col * 1.05 + 0.03, smoothstep(BR - 7.0, BR - 3.0, rb));
      bc = mix(bc, C_SEPIA * 0.6, 0.35 * pxLine(abs(rb - BR + 1.0), 0.6, 1.6));
      col = mix(bc, col, smoothstep(BR - 0.5, BR + 1.0, rb));
    }
    // ---- 頂端的玻璃塞（爆表時彈飛）
    if (capOn > 0.0) {
      float rc = length(P - capP);
      vec3 cc = col * 1.06 + 0.03 + vec3(1.0) * 0.4 * exp(-pow(length(P - capP - vec2(-5.0, -5.0)) / 4.0, 2.0));
      cc = mix(cc, C_SEPIA * 0.6, 0.4 * pxLine(abs(rc - 13.0), 0.6, 1.6));
      col = mix(cc, col, smoothstep(13.0, 14.5, rc));
    }
    fragColor = vec4(col, 1.0);
  }`, {
  mask: { value: null }, mR: { value: new THREE.Vector4(0, 0, 1, 1) }, hasMask: { value: 0 },
  fillPos: { value: -1 }, chan: { value: 0 }, headY: { value: Y0 }, capP: { value: new THREE.Vector2(TX, T_TOP - 16) }, capOn: { value: 1 }, t: { value: 0 },
  c0: { value: new THREE.Vector2() }, c1: { value: new THREE.Vector2() }, c2: { value: new THREE.Vector2() }, c3: { value: new THREE.Vector2() },
});

export default class Thermometer extends Scene {
  board = shared('thermometer.board', BOARD);
  stage = new Stage();
  /** 刻度的數字與註記（畫一次）。 */
  stat = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 鉛筆的歌詞與引線（每格重畫）。 */
  lyr = this.track(new Layer2D(W, H, undefined, { fast: true }));
  drops = this.track(new LineBatch(256, { screen2D: true, blend: 'normal' }));
  mask: OrderMask | null = null;
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = Number(this.ctx.params.seed ?? 1);
  block: MsgBlock | null = null;
  lyrSize = 58;
  g!: Grid;
  tp = 0;
  /** 液體灌字：開始、每個字多久、總共幾個字。 */
  f0 = 0; per = 0.08; nChars = 0;
  chanLen = 0; chanDur = 0.3;
  ch: [number, number][] = [];
  /** 紅柱的階梯（彈簧響應疊起來）。 */
  steps: { t: number; d: number }[] = [];
  h0 = 0.2;

  override async init() {
    const { audio: au, start: s, end: e } = this.ctx;
    await loadWindow(this.ctx, EMPTY + INVITE + MARKS.map((m) => m[1]).join(''));
    const g = (this.g = grid(au, s, e));
    this.tp = revealAt(au, g.b0, e, { minB: 2, maxB: 6 });
    // ---- 刻字（留言＋署名，靠左排；沒有留言就刻邀請）
    const c = this.stat.ctx;
    let items: MaskItem[] = [];
    let first = { x: MBOX.x, y: MBOX.y + 60, size: 80 };
    if (this.msg) {
      const b = (this.block = msgBlock(c, this.msg, FAM_MSG, MBOX, { align: 'left', sigFamily: FAM_SIG, min: 48, max: 140, lineHeight: 1.26, maxLines: 5, sigMin: 42, sigMax: 58 }));
      items = lineItems(b.lines, FAM_MSG, b.fit.size, 0);
      const sig = lineItems([{ text: b.sig.text, x: b.sig.x, y: b.sig.y }], FAM_SIG, b.sig.size, items.length).map((q) => ({ ...q, tag: 128, thick: 0 }));
      items = [...items, ...sig];
      first = { x: b.lines[0]!.x, y: b.lines[0]!.y, size: b.fit.size };
      this.lyrSize = lyricSizeFor(b.fit.size);
    } else {
      const size = 130;
      const x = MBOX.x, y1 = MBOX.y + 250;
      items = lineItems([{ text: EMPTY.slice(0, 5), x, y: y1 }, { text: EMPTY.slice(5), x, y: y1 + size * 1.25 }], FAM_MSG, size, 0);
      const inv = lineItems([{ text: INVITE, x: x + 6, y: y1 + size * 1.25 + 110 }], F.hei(700), 40, items.length).map((q) => ({ ...q, tag: 128 }));
      items = [...items, ...inv];
      first = { x, y: y1, size };
      this.lyrSize = 64;
    }
    this.nChars = items.length;
    const xs = items.map((q) => q.x), ys = items.map((q) => q.y);
    const x0 = Math.min(...xs) - 20, y0 = Math.min(...items.map((q) => q.y - q.size)) - 20;
    const x1 = Math.max(...items.map((q) => q.x + q.w)) + 20, y1b = Math.max(...ys.map((y, i) => y + items[i]!.size * 0.3)) + 20;
    this.mask = this.track(orderMask(items, [x0, y0, x1 - x0, y1b - y0], 1, 'x', 3, 0));
    // ---- 溝槽：管子頂端往上、往右，彎進第一個字的左上角
    const cy = Math.min(128, first.y - first.size * 1.05 - 24);
    this.ch = [[TX, T_TOP - 4], [TX, cy], [first.x - 30, cy], [first.x + first.size * 0.12, first.y - first.size * 0.62]];
    this.chanLen = this.ch.slice(1).reduce((acc, p, i) => acc + Math.hypot(p[0] - this.ch[i]![0], p[1] - this.ch[i]![1]), 0);
    // ---- 時間：爆表 → 流過溝槽 → 一個字一個字灌滿（兩小節的窗格也來得及）
    this.chanDur = clamp(this.chanLen / 1600, 0.2, 0.45);
    this.f0 = this.tp + 0.08 + this.chanDur;
    const room = Math.max(0.8, Math.min(e - this.f0 - 1.0, 3.2));
    this.per = clamp(0.055 * this.nChars + 0.5, 0.8, room) / Math.max(1, this.nChars);
    // ---- 紅柱：第一拍起一拍跳一格，爆表那一下衝到頂
    const bts = beatsBetween(au, g.b0, this.tp - 0.05);
    this.h0 = 0.18;
    let prev = this.h0;
    bts.forEach((tb, k) => { const target = lerp(0.3, 0.92, (k + 1) / (bts.length + 1)); this.steps.push({ t: tb, d: target - prev }); prev = target; });
    this.steps.push({ t: this.tp - 0.12, d: 1.06 - prev }); prev = 1.06;
    this.steps.push({ t: this.tp + 0.5, d: 0.84 - prev });

    // ---- 刻度的數字與註記
    this.stat.clear();
    c.textBaseline = 'middle';
    c.font = font(F.mono(500), 18); c.fillStyle = rgba('sepia', 0.78);
    for (let v = 0; v <= 100; v += 10) c.fillText(String(v), STRIP.x + 42, Y0 - v * DEG + 1);
    c.font = font(F.hei(700), 20); c.fillStyle = rgba('sepia', 0.72); c.letterSpacing = '3px';
    for (const [v, s] of MARKS) {
      const y = Y0 - v * DEG;
      c.fillText(s, STRIP.x + 90, y + (v === 100 ? 0 : 0));
    }
    c.letterSpacing = '0px';
    c.font = font(F.mono(500), 16); c.fillStyle = rgba('sepia', 0.55);
    c.fillText('°C', STRIP.x + 42, STRIP.y + 14);
    c.textBaseline = 'alphabetic';
    this.stat.upload();
  }

  /** 紅柱的高度（0 = 0 度、1 = 100 度）。 */
  private level(t: number): number {
    let h = this.h0;
    for (const st of this.steps) { if (t <= st.t) break; h += st.d * springStep(t - st.t, 2.4, 0.32); }
    const au = this.ctx.audio;
    // 跟著能量微微呼吸；揭曉後跟著響度升降
    const k = prog(t, this.tp + 0.5, this.tp + 1.2);
    return h + 0.025 * au.env('rms', t) + k * (0.1 * (au.env('rms', t) - 0.5) + 0.025 * au.hit('kick', t, 0.12));
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, tp = this.tp;
    const u = this.board.u;
    const h = this.level(t);
    const headY = Y0 - clamp(h, 0, 1.05) * (Y0 - Y100);
    u.headY!.value = headY;
    u.t!.value = t;
    // 玻璃塞：爆表時往右上彈飛、轉著掉出畫面
    const ct = t - tp;
    u.capOn!.value = ct < 1.2 ? 1 : 0;
    (u.capP!.value as THREE.Vector2).set(TX + (ct > 0 ? 520 * ct : 0), T_TOP - 16 + (ct > 0 ? -900 * ct + 1400 * ct * ct : 0));
    u.chan!.value = this.chanLen * prog(t, tp + 0.08, tp + 0.08 + this.chanDur);
    u.fillPos!.value = t < this.f0 ? -1 : (t - this.f0) / this.per;
    (['c0', 'c1', 'c2', 'c3'] as const).forEach((k, i) => (u[k]!.value as THREE.Vector2).set(this.ch[i]![0], this.ch[i]![1]));
    if (this.mask) {
      u.mask!.value = this.mask.tex;
      (u.mR!.value as THREE.Vector4).set(...this.mask.rect);
      u.hasMask!.value = 1;
    } else u.hasMask!.value = 0;
    const rt = this.stage.rt;
    this.board.render(renderer, rt);
    comp.draw(renderer, this.stat.texture, rt);

    // ---- 鉛筆的歌詞與指著液面的引線
    const L = this.lyr, c = L.ctx;
    L.clear();
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const st = { family: FAM_LYR, size: this.lyrSize, minSize: 48, maxW: LYR.w, maxRows: 2 };
      const lay = layoutRows(c, ly.line, st);
      const y = LYR.y - (lay.rows.length - 1) * lay.lineHeight * 0.5;
      const k = ly.k * prog(t, s, s + 0.4);
      c.save(); c.translate(LYR.x, y);
      drawRows(c, lay, FAM_LYR, t, paperInk(), k);
      c.restore();
      // 引線：從歌詞左邊拉到刻度條外、再橫著指到液面
      c.strokeStyle = rgba('sepia', 0.5 * k); c.lineWidth = 1.6; c.lineCap = 'round';
      const ax = LYR.x - 22, ay = y - lay.size * 0.35;
      const bx = STRIP.x + STRIP.w + 26;
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, ay); c.lineTo(bx, headY); c.lineTo(TX + 26, headY); c.stroke();
      c.beginPath(); c.moveTo(TX + 36, headY - 7); c.lineTo(TX + 26, headY); c.lineTo(TX + 36, headY + 7); c.stroke();
    }
    comp.draw(renderer, L.upload(), rt);

    // ---- 鏡頭：斜斜地看著木板，揭曉前對焦在液面、揭曉後拉到留言
    const mv = camMove(au, s, e, t, { inYaw: 0.07, inZoom: 0.05, push: 0.05, sway: 0.01 });
    const rack = ease.inOutCubic(prog(t, tp, tp + 0.7));
    const fx = lerp(TX + 60, this.block ? this.block.box[0] + this.block.box[2] * 0.4 : 1000, rack);
    const fy = lerp(headY, this.block ? this.block.box[1] + this.block.box[3] * 0.5 : 460, rack);
    const desk: [number, number, number] = [LIN.paper[0] * 0.8, LIN.paper[1] * 0.78, LIN.paper[2] * 0.74];
    const bump = pulse(t, tp, 0.12);
    this.stage.draw(renderer, out, {
      yaw: -0.07 + mv.yaw, pitch: 0.08, roll: 0.012, zoom: 1.08 + mv.zoom + 0.015 * bump, x: 10, y: 0,
      dof: 1.6, focus: [fx, fy], room: desk, paper: true,
    });

    // ---- 爆表時噴出來的液滴（在畫面上畫，跟著鏡頭的投影）
    const D = this.drops;
    D.clear();
    if (ct > 0 && ct < 1.1) {
      const cam = { yaw: -0.07 + mv.yaw, pitch: 0.08, roll: 0.012, zoom: 1.08 + mv.zoom + 0.015 * bump, x: 10, y: 0, room: desk };
      const lq = LIN.paper.map((p, i) => p * Math.pow(clamp(LIN.signal[i]! / Math.max(p, 1e-3), 0.004, 1), 2.6)) as [number, number, number];
      for (let i = 0; i < 22; i++) {
        const an = -Math.PI / 2 + (hash(i, 61, this.seed) - 0.5) * 1.6, v = 260 + 520 * hash(i, 62);
        const x = TX + Math.cos(an) * v * ct, y = T_TOP - 10 + Math.sin(an) * v * ct + 1500 * ct * ct;
        const p = this.stage.project(cam, x, y), q = this.stage.project(cam, x - Math.cos(an) * 4, y - Math.sin(an) * 4 + 10 * ct);
        const r = 3 + 5 * hash(i, 63);
        D.seg2(q.x, q.y, p.x, p.y, r * 2, lq, 1);
      }
    }
    if (D.count) D.render(renderer, out);

    const avoid: [number, number, number, number] = this.block ? [this.block.box[0], this.block.box[1], this.block.box[2], this.block.box[3]] : [MBOX.x, MBOX.y, MBOX.w, MBOX.h];
    return {
      paper: 1, bloom: 0.25, vignette: 0.3, grain: 0.045,
      shake: [6 * bump * Math.sin(t * 83), 6 * bump * Math.cos(t * 71)],
      popupAvoid: [avoid],
    };
  }
}
