// 心電圖（照 pdoom 的 spacetime 第一樂章：觸發的磷光示波器、掃描線把歌詞寫在波形上；loss 的「字騎在曲線上」）。
// 一台雙頻道的監護儀：上面是新郎、下面是新娘，兩條心電圖用主題的訊號色、掃描線有殘影，心跳打在這首歌真的大鼓上，
// 而且兩個人永遠同步（右邊的讀數一本正經：心率 = 這首歌的 BPM、同步率 100%、心動指數：超出量表）。
//  - 上面那條是倒過來的導程：兩條線的心跳都「朝對方伸過去」，中間留一條空隙。
//  - 歌詞坐在上面那條線上，逐字跟唱；掃描線從哪個字底下經過、剛好心跳，那個字就被彈一下。
//  - 主打留言是心電圖機印出來的「醫囑」紙條，一拍一格從畫面下緣吐出來；沒有留言就印一張邀請。
//  - 最後一小節的強拍：心跳先漏一拍，兩條線往中間彎，一條從凹口往左、一條從尖端往右，互相追著畫出一顆愛心
//    （玫瑰色，唯一的點綴色），合起來後填上細網線，兩條線各自恢復平穩切走。
// 效能：Canvas 上傳貼圖是最貴的（全螢幕一張約 20 ms），所以這個版面沒有全螢幕的 Canvas 層——
// 歌詞一條小帶子每格上傳、數字欄與紙條只在內容變的時候上傳，會閃的小東西（心形燈、量表、網線）都用 LineBatch 在 GPU 畫。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, layout, fitSize, loadText } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, fract, lerp, prog, pulse, springStep, TAU } from '../engine/util';
import { Lyrics } from '../engine/lyrics';
import { sparkHead, sparkParticles, lyricAt, layoutLyric, heartPoints, beatAfter, COUPLE_ZH } from './_motifs';
import { pickPulses, ecgAt, Sweep, heartPaths, partial, scanRows, type Pulse, type HeartPaths, type Row } from './heartbeat-ecg';
import { buildStrip, msgStrip, INVITE_STRIP, STRIP_TEXT, STRIP_FIXED, type Strip } from './heartbeat-strip';

// ---------------------------------------------------------------- 版面（瑞士網格：左邊波形、右邊數字欄，跟真的監護儀一樣）
const X0 = 96, X1 = 1370, WTR = X1 - X0; // 波形區
const SEP = 1404; // 波形區與數字欄之間的細線
const CX0 = 1440, CX1 = 1824; // 數字欄
const Y1 = 316, Y2 = 532; // 兩條基線（上：新郎、下：新娘）
const AMP = 94; // R 波高度（px）
const LX = 128; // 歌詞與紙條的左緣
const GAP = 34; // 掃描線前面清掉的空隙（監護儀的擦除條）
const NS = 800; // 每條波形取樣點數（~1.6 px 一點，R 波夠尖又不會閃）
const PHI_H = 0.5; // 愛心畫在波形區的哪裡（0..1）
const STRIP_TOP = Y2 + 46; // 紙條最高只到這裡（下面那條線的 S 波最低到 Y2 + 24）
const SAFE_B = H - 96; // 最後一行字的基線不能低於這裡（投影機會裁邊）
const SEG_N = 16; // 心動指數量表的格數
const METER_Y = Y2 + 170; // 量表的上緣
const METER_H = 26;
const [GROOM, BRIDE] = COUPLE_ZH.split(/\s*&\s*/) as [string, string];
// 各個小圖層在畫面上的範圍（只上傳這麼大）
const BAND = { x: 88, y: 80, w: 1300, h: 284 }; // 左上的規格列＋坐在上面那條線上的歌詞
const COL = { x: 1396, y: 80, w: 448, h: 750 }; // 右邊的數字欄（不會閃的部分）

// 固定會畫到的中文（init 時一次載好）
const TEXT = `心率同步率心動指數超出量表監護中偵測到特殊波形判讀：良性，終身有效導程今晚的歌${COUPLE_ZH}${STRIP_TEXT}`;

// ---------------------------------------------------------------- 背景：螢幕玻璃＋心電圖格子（格子間距 = 0.2 秒的掃描長度，所以真的能量時間）
const BG = () => new FSPass(/* glsl */ `
  uniform float t; uniform float k; uniform float gridPx; uniform vec4 box; uniform float yRef;
  uniform float beamX; uniform float beamI;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y); // y 向下，跟 Canvas2D 一樣
    vec2 uv = p / vec2(${W}.0, ${H}.0) - 0.5;
    float rc = length(uv * vec2(1.7778, 1.0));
    // 映像管玻璃：中間一點點浮起來的暗色，邊緣收掉
    vec3 col = C_INK + (C_INK2 - C_INK) * (0.9 - 0.8 * smoothstep(0.1, 0.95, rc));
    col += (C_INK2 - C_INK) * 0.35 * fbm(p / 520.0 + vec2(0.0, t * 0.01), 3);
    // 格子只在波形區：大格實線、小格只點交叉點（心電圖紙的 5 mm / 1 mm），開機時從中間往兩邊蝕刻出來
    float cxm = 0.5 * (box.x + box.y);
    float inside = step(box.x, p.x) * step(p.x, box.y) * step(box.z, p.y) * step(p.y, box.w)
                 * step(abs(p.x - cxm), k * 0.5 * (box.y - box.x) + 1.0);
    vec2 q = vec2(p.x - box.x, p.y - yRef) / gridPx;
    vec2 d = abs(fract(q + 0.5) - 0.5) * gridPx;
    float major = max(pxLine(d.x, 0.35, 1.2), pxLine(d.y, 0.35, 1.2));
    vec2 dm = abs(fract(q * 5.0 + 0.5) - 0.5) * gridPx / 5.0;
    float dots = pxLine(length(dm), 0.6, 1.5);
    // 掃描線經過的地方玻璃被照亮一點（pdoom 示波器的做法）
    float bl = beamI * exp(-abs(p.x - beamX) / 180.0);
    vec3 gc = mix(C_BLOOD, C_SIGNAL, 0.35);
    col += gc * (major * 0.075 + dots * 0.06) * (1.0 + 2.2 * bl) * inside;
    // 很淡的掃描線（映像管的橫紋）
    col *= 1.0 - 0.035 * step(0.5, fract(p.y / 3.0));
    fragColor = vec4(col, 1.0);
  }`, {
  t: { value: 0 }, k: { value: 1 }, gridPx: { value: 70 }, box: { value: new THREE.Vector4(X0, X1, 150, Y2 + 90) }, yRef: { value: Y1 },
  beamX: { value: 0 }, beamI: { value: 0 },
});

type P2 = { x: number; y: number };
type RGB = [number, number, number];
const scaled = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

export default class Heartbeat extends Scene {
  bg = shared('heartbeat.bg', BG);
  /** 規格列＋歌詞（每格上傳，但只有一條帶子那麼大）。 */
  band = this.track(new Layer2D(BAND.w, BAND.h));
  /** 正在唱的字的光暈（同一條帶子、半解析度）。 */
  bandGlow = this.track(new Layer2D(BAND.w, BAND.h, 0.5));
  /** 數字欄不會閃的部分（標籤、數字、量表的框）：內容變了才重畫、重新上傳。 */
  col = this.track(new Layer2D(COL.w, COL.h));
  /** 愛心旁邊的判讀（打字時才上傳）。 */
  note: Layer2D | null = null;
  noteBox = { x: 0, y: 0, w: 480, h: 90 };
  /** 波形、愛心、網線、火花（加亮）。 */
  L = this.track(new LineBatch(7000, { screen2D: true, blend: 'add' }));
  /** 會閃的小燈、量表的格子、箭頭、引線（取最大值，疊在一起不會變兩倍亮）。 */
  I = this.track(new LineBatch(1500, { screen2D: true, blend: 'max' }));
  /** 出紙口的陰影（一般混色的橫線疊出漸層）。 */
  shade = this.track(new LineBatch(128, { screen2D: true, blend: 'normal' }));
  msg: Msg | null = this.ctx.params.message ?? null;

  pulses: Pulse[] = [];
  sweep!: Sweep;
  heart!: HeartPaths;
  strip: Strip | null = null;
  /** 愛心開始／畫完的時間、第一拍、心跳時間參數（依速度縮放 P、T 波）。 */
  tH0 = 0; tH1 = 0; tB0 = 0; beat = 0.5; q = 1;
  /** 格子間距（0.2 秒的掃描長度）、掃描速度（px/秒）。 */
  gridPx = 70; speed = 350;
  /** 每下心跳在第幾個 x 畫出來（彈字用）。 */
  pulseX: number[] = [];
  lyricSize = 112;
  hx = 0;
  /** 單位愛心（數字欄的小燈）與大愛心（網線）的掃描列。 */
  iconRows: Row[] = [];
  hatchRows: Row[] = [];
  // 小圖層的「上次畫了什麼」：一樣就不重畫、不重新上傳
  private colKey = '';
  private colDotX = 0;
  private noteKey = '';
  private bandKey = '';
  private glowEmpty = true;
  private stripUp = false;
  /** 即時小卡要避開的範圍（整個窗格都一樣，init 算好）。 */
  private avoid: [number, number, number, number][] = [];

  override async init() {
    const { audio: au, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText(TEXT + (song.title ?? '') + (song.artist ?? ''));
    const beat = this.beat = au.beatPeriod(s + 0.1);
    this.q = clamp(beat / 0.62, 0.62, 1);
    this.tB0 = beatAfter(au, s + 0.05);
    // 愛心：最後一小節的強拍開始（從窗格結尾往回數 4 拍），快歌畫 3 拍、慢歌 2 拍，剩下的拍子是平線
    const bE = Math.round(au.beatAt(e));
    const bS = au.beatAt(s);
    const bH0 = Math.max(Math.ceil(bS + 1.5), bE - 4);
    this.tH0 = au.timeOfBeat(bH0);
    this.tH1 = Math.min(au.timeOfBeat(bH0 + (beat < 0.5 ? 3 : 2)), e - 0.2);
    this.sweep = new Sweep(au, s, this.tH0, this.tH1, PHI_H, 3.4);
    this.speed = WTR / (this.sweep.N * beat);
    this.gridPx = this.speed * 0.2;
    this.hx = X0 + WTR * fract(this.sweep.uH);
    this.heart = heartPaths(this.hx, Y1, Y2, 14);
    // 心跳到愛心前 1.4 拍就停：「漏跳一拍」，也讓愛心四周是乾淨的
    this.pulses = pickPulses(au, s, this.tH0 - 1.4 * beat);
    this.pulseX = this.pulses.map((p) => X0 + WTR * fract(this.sweep.u(p.t)));
    this.iconRows = scanRows(heartPoints(48), -0.7, 1.3, 0.07);
    this.hatchRows = scanRows(this.heart.outline, this.heart.top - 2, this.heart.tip.y, 6);
    // 判讀的小圖層：放在愛心右邊
    const tx = this.heart.cx + this.heart.s * 1.25 + 60, ty = (Y1 + Y2) / 2 - 8;
    this.noteBox = { x: Math.floor(tx - 6), y: Math.floor(ty - 34), w: 470, h: 84 };
    this.note = this.track(new Layer2D(this.noteBox.w, this.noteBox.h));

    const m = this.msg;
    this.lyricSize = m ? 88 : 116;
    // 紙條：主文的框 = 從下面那條線下方到畫面安全邊（離下緣 96 px），寬不超過 QR 區左邊
    const first = this.pulses.find((p) => p.t >= s) ?? { t: this.tB0, a: 1 };
    const trace = (x01: number) => ecgAt(this.pulses, first.t - 0.35 + x01 * 2.4, this.q, 0, au);
    const body = m ? msgStrip(m) : INVITE_STRIP;
    this.strip = buildStrip({
      ...body, bodyFamily: F.hand(400), trace,
      maxW: 1340 - LX - 88, maxH: m ? SAFE_B - STRIP_TOP - STRIP_FIXED : 60, min: m ? 44 : 34, max: m ? 96 : 40,
    });
    this.track(this.strip.layer);
    // 即時小卡避開：歌詞帶、紙條停住後的文字範圍、結尾的愛心與判讀。全部停在 x = 1370 以內——
    // 右邊的數字欄只是讀數，讓小卡落在那裡（右側的格子從 x = 1378 開始），短紙條時下緣中間也空得出來
    const S = this.strip, st = Math.max(STRIP_TOP, SAFE_B - S.sigY);
    const hx0 = this.heart.cx - this.heart.s * 1.15;
    this.avoid = [
      [LX - 16, 96, X1 - LX + 16, Y1 + 30 - 96],
      [LX - 12, st - 8, S.w + 24, SAFE_B + 24 - st],
      [hx0, Y1 - 6, X1 - hx0, Y2 - Y1 + 12],
    ];
  }

  /** 把一張小圖層（邏輯像素的範圍 x,y,w,h）貼到畫面上的那個位置（Compositor 只會縮放平移）。 */
  private blit(tex: THREE.Texture, x: number, y: number, w: number, h: number, out: THREE.WebGLRenderTarget, o: { mode?: 'normal' | 'add'; opacity?: number; tint?: [number, number, number] } = {}) {
    this.ctx.comp.draw(this.ctx.renderer, tex, out, { ...o, scale: [W / w, H / h], offset: [0.5 * W / w - 0.5 - x / w, 0.5 + y / h - 0.5 * H / h] });
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const uNow = this.sweep.u(t);
    const xb = X0 + WTR * fract(uNow);
    const drawing = t >= this.tH0 && t < this.tH1;
    this.L.clear(); this.I.clear();

    this.bg.u.t!.value = t;
    this.bg.u.k!.value = prog(t, s, s + 0.45, ease.outExpo);
    this.bg.u.gridPx!.value = this.gridPx;
    this.bg.u.beamX!.value = drawing ? this.hx : xb;
    this.bg.u.beamI!.value = prog(t, s, s + 0.3);
    this.bg.render(renderer, out);

    // 數字欄（靜態部分）
    this.drawColumn(t);
    this.blit(this.col.texture, COL.x, COL.y, COL.w, COL.h, out, { opacity: prog(t, s + 0.1, s + 0.45) });
    // 紙條＋出紙口的陰影
    this.drawStrip(t, out);
    // 規格列＋歌詞
    this.drawBand(t, out);
    // 判讀
    this.drawNote(t, out);

    this.drawTrace(0, t, uNow, xb);
    this.drawTrace(1, t, uNow, xb);
    this.drawHeartTrace(t);
    this.drawIcons(t);
    this.drawBeams(t);
    this.L.render(renderer, out);
    this.I.render(renderer, out);
    if (!this.glowEmpty) this.blit(this.bandGlow.texture, BAND.x, BAND.y, BAND.w, BAND.h, out, { mode: 'add', tint: [1.7, 1.7, 1.7] });

    return {
      bloom: 0.72, halation: 0.3, vignette: 0.45,
      zoom: 1 + 0.012 * pulse(t, this.tH1, 0.18),
      popupAvoid: this.avoid,
    };
  }

  // ---------------------------------------------------------------- 波形
  /** 掃描線在 tb 時的位置（火花粒子用）：畫愛心那段在愛心路徑上。 */
  private beamAt(ch: 0 | 1, tb: number): P2 | null {
    if (tb < this.ctx.start) return null;
    if (tb >= this.tH0 && tb < this.tH1) {
      const pts = ch ? this.heart.b : this.heart.a, L = ch ? this.heart.bLen : this.heart.aLen;
      const pp = partial(pts, L, this.heartProg(tb));
      return pp[pp.length - 1]!;
    }
    const x = X0 + WTR * fract(this.sweep.u(tb));
    return { x, y: this.yOf(ch, tb >= this.tH1 ? 0 : ecgAt(this.pulses, tb, this.q, ch, this.ctx.audio)) };
  }
  private yOf(ch: 0 | 1, v: number) { return ch ? Y2 - v * AMP : Y1 + v * AMP; }
  /** 愛心的進度：強拍上一下子衝進去，越畫越慢，最後輕輕合上。 */
  private heartProg(t: number) { const x = prog(t, this.tH0, this.tH1); return 0.55 * ease.outCubic(x) + 0.45 * (0.5 - 0.5 * Math.cos(Math.PI * x)); }
  private lastPulse(t: number): Pulse | null {
    let best: Pulse | null = null;
    for (const p of this.pulses) { if (p.t <= t) best = p; else break; }
    return best;
  }

  /**
   * 一條波形：目前這趟（掃描線左邊）＋上一趟的殘影（掃描線右邊，越舊越暗），掃描線前面清出一條空隙。
   * 開機前的部分是一條剛亮起來的平線。畫愛心之後舊的殘影收掉，右邊只剩平線。
   */
  private drawTrace(ch: 0 | 1, t: number, uNow: number, xb: number) {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, L = this.L, sw = this.sweep;
    const sg = LIN.signal, em = LIN.ember;
    const k0 = Math.floor(uNow);
    const oldK = 1 - prog(t, this.tH0, this.tH0 + 0.3);
    const onW = prog(t, s, s + 0.22, ease.outCubic) * WTR * 0.5 + 2, cxm = (X0 + X1) / 2;
    const idleI = 0.3 + 2.4 * Math.exp(-Math.max(0, t - s) / 0.1);
    const afterHeart = t >= this.tH1;
    let px = 0, py = 0, pOld = false, have = false;
    for (let i = 0; i <= NS; i++) {
      const x = X0 + (WTR * i) / NS;
      let u = k0 + (x - X0) / WTR;
      const old = u > uNow;
      if (old) {
        u -= 1;
        if (x - xb < GAP || oldK <= 0.001) { have = false; continue; }
      }
      // 愛心畫完之後：右邊的平線從愛心的接點後面開始（接點另外畫）
      if (!old && afterHeart && x > this.hx && x < this.hx + 18) { have = false; continue; }
      const tau = sw.tOf(u);
      let v: number, I: number, hot = 0;
      if (tau < s) {
        // 開機的平線：從中間往兩邊亮起來，白熱一下再冷下來
        if (Math.abs(x - cxm) > onW) { have = false; continue; }
        v = 0.006 * Math.sin(x * 0.05 + ch);
        I = idleI;
        hot = Math.exp(-Math.max(0, t - s) / 0.12);
      } else {
        v = tau >= this.tH0 ? 0.004 * Math.sin(tau * 40 + ch) : ecgAt(this.pulses, tau, this.q, ch, au);
        const age = Math.max(0, t - tau);
        hot = Math.exp(-age / 0.09);
        // 磷光的餘暉：剛畫的一段白熱，一秒內冷成訊號色，上一趟的殘影只剩三成亮
        I = 0.34 + 1.5 * Math.exp(-age / 0.28) + 0.5 * Math.exp(-age / 1.2);
      }
      if (old) I *= oldK * 0.75;
      const y = this.yOf(ch, v);
      if (have && pOld === old) {
        const h = hot * 0.65, k = I * 1.25;
        L.seg2(px, py, x, y, 1.7 + 1.4 * hot, [lerp(sg[0], em[0], h) * k, lerp(sg[1], em[1], h) * k, lerp(sg[2], em[2], h) * k], 1);
        // 柔光只給還亮著的那段（殘影不需要，也省一半線段）
        if (I > 0.55) L.seg2(px, py, x, y, 9, scaled(sg, 0.045 * I), 1);
      }
      px = x; py = y; pOld = old; have = true;
    }
  }

  /** 愛心：兩條線各畫半邊（玫瑰色，接近筆尖的地方還是燙的），合上之後由下往上填細網線，接點把兩條線接回各自的基線。 */
  private drawHeartTrace(t: number) {
    if (t < this.tH0) return;
    const L = this.L, hp = this.heartProg(t), H0 = this.heart;
    const ro = LIN.rose, em = LIN.ember, sg = LIN.signal;
    const close = pulse(t, this.tH1, 0.22);
    for (const [pts, len] of [[H0.a, H0.aLen], [H0.b, H0.bLen]] as const) {
      const pp = partial(pts, len, hp);
      const total = len[len.length - 1]! * hp;
      let acc = 0;
      for (let i = 1; i < pp.length; i++) {
        const a = pp[i - 1]!, b = pp[i]!;
        acc += Math.hypot(b.x - a.x, b.y - a.y);
        const heat = Math.exp(-(total - acc) / 70) * (t < this.tH1 ? 1 : Math.exp(-(t - this.tH1) / 0.15));
        // 第一段（從基線彎進愛心）還是訊號色，愛心本身是玫瑰色
        const base = i === 1 ? sg : ro;
        const k = i === 1 ? 1.3 : 1.05 + 0.5 * close;
        L.seg2(a.x, a.y, b.x, b.y, 2.4 + 1.2 * heat, [lerp(base[0] * k, em[0] * 3, heat), lerp(base[1] * k, em[1] * 3, heat), lerp(base[2] * k, em[2] * 3, heat)], 1);
        L.seg2(a.x, a.y, b.x, b.y, 11, scaled(base, 0.06), 1);
      }
    }
    if (t < this.tH1) return;
    // 網線：一拍之內由下往上填滿（玫瑰色、不發光）
    const fk = prog(t, this.tH1, this.tH1 + 0.6 * this.beat, ease.outCubic);
    const lim = H0.tip.y - fk * (H0.tip.y - H0.top);
    for (const r of this.hatchRows) if (r.y > lim && r.x1 - r.x0 > 3) L.seg2(r.x0 + 1.5, r.y, r.x1 - 1.5, r.y, 1.3, scaled(ro, 0.42), 1);
    // 接點：凹口接回上面的基線、尖端接回下面的基線，然後平線一路走到掃描線
    const I = 0.5 + 1.6 * Math.exp(-(t - this.tH1) / 0.3);
    for (const [a, b] of [[H0.notch, { x: this.hx + 18, y: Y1 }], [H0.tip, { x: this.hx + 18, y: Y2 }]] as const) {
      L.seg2(a.x, a.y, b.x, b.y, 2.2, scaled(sg, I), 1);
      L.seg2(a.x, a.y, b.x, b.y, 12, scaled(sg, 0.07 * I), 1);
    }
  }

  /** 兩個筆尖（仙女棒的火花）：平常在掃描線上，畫愛心時在愛心的路徑上。 */
  private drawBeams(t: number) {
    const s = this.ctx.start;
    if (t < s + 0.02) return;
    const seed = this.ctx.params.seed ?? 1;
    for (const ch of [0, 1] as const) {
      const p = this.beamAt(ch, t);
      if (!p) continue;
      const drawing = t >= this.tH0 && t < this.tH1;
      sparkParticles(this.L, t, (tb) => this.beamAt(ch, tb), { rate: drawing ? 120 : 45, life: 0.32, speed: drawing ? 200 : 130, seed: seed + ch * 17, gravity: 380 });
      sparkHead(this.L, p.x, p.y, t, drawing ? 0.95 : 0.7, prog(t, s, s + 0.15));
    }
  }

  // ---------------------------------------------------------------- 會閃的小東西（GPU 畫，不動 Canvas）
  /** 用掃描列填一顆愛心（中心 x,y、寬 size）。 */
  private heartIcon(x: number, y: number, size: number, col: RGB) {
    // 列寬是列距的兩倍：相鄰兩列的抗鋸齒邊緣重疊，填起來才是實心（取最大值混色，重疊不會變亮）
    const s = size / 2, w = 0.14 * s + 0.5;
    for (const r of this.iconRows) {
      // 比線寬還窄的列（尖端最後幾列）畫出來會變成一根小尾巴，跳過
      if ((r.x1 - r.x0) * s < w) continue;
      this.I.seg2(x + r.x0 * s + w / 2, y + r.y * s, x + r.x1 * s - w / 2, y + r.y * s, w, col, 1);
    }
  }
  /** 實心長方形（量表的一格）：一列一條線段。 */
  private rect(x: number, y: number, w: number, h: number, col: RGB) {
    if (w < 2) return;
    for (let yy = y + 1.5; yy < y + h - 1; yy += 2) this.I.seg2(x + 1.5, yy, x + w - 1.5, yy, 3, col, 1);
  }

  private drawIcons(t: number) {
    const s = this.ctx.start, beat = this.beat, au = this.ctx.audio;
    const colA = prog(t, s + 0.1, s + 0.45);
    if (colA <= 0) return;
    const last = this.lastPulse(t);
    const blink = t >= this.tH0 ? 1 : last ? pulse(t, last.t, 0.14) : 0;
    // 右上「監護中」前面的點：跟著心跳閃
    const dx = COL.x + this.colDotX, dy = 106;
    this.I.seg2(dx, dy, dx + 0.01, dy, 9, scaled(LIN.signal, colA * (0.4 + 1.6 * blink)), 1);
    // 兩個人的心形小燈：每下心跳亮一次（畫愛心時一直亮著）
    for (const y of [Y1, Y2]) this.heartIcon(CX0 + 20, y + 12, 34 * (1 + 0.14 * blink), scaled(LIN.rose, colA * (0.3 + 0.7 * blink)));
    // 心動指數：一格一格滿上去，滿了還繼續往右長，長出量表、長出畫面
    const pitch = (CX1 - CX0) / SEG_N, sw = pitch - 5;
    const tM = this.tB0, full = tM + 4 * beat;
    const nFill = Math.floor(SEG_N * prog(t, tM, full) + 1e-6);
    for (let i = 0; i < nFill; i++) this.rect(CX0 + i * pitch, METER_Y, sw, METER_H, scaled(LIN.signal, colA * (0.5 + 0.5 * (i / SEG_N))));
    if (t < full) return;
    const over = Math.min(6, 1 + Math.floor((t - full) / beat));
    for (let j = 0; j < over; j++) {
      const g = prog(t, full + j * beat, full + j * beat + 0.18, ease.outExpo);
      this.rect(CX0 + (SEG_N + j) * pitch, METER_Y, sw * g, METER_H, scaled(LIN.ember, 1.3 + 0.2 * j));
    }
    // 「超出量表」旁邊往外指的小箭頭（Plex Mono 沒有 ▶，自己畫），跟著拍子閃
    const bl = fract(au.beatAt(t)) < 0.5 ? 1 : 0.3;
    const ax = CX1 - 18, ay = METER_Y + METER_H + 54;
    for (let k = -7; k <= 7; k += 1.5) this.I.seg2(ax, ay + k, ax + 12 * (1 - Math.abs(k) / 7) + 0.01, ay + k, 1.6, scaled(LIN.signal, bl), 1);
  }

  // ---------------------------------------------------------------- 數字欄（靜態）
  /** 數字欄：同步率、兩個人的心率（跟各自的波形同一列）、心動指數的框與刻度。只在「量到心跳」「超出量表」時重畫。 */
  private drawColumn(t: number) {
    const s = this.ctx.start;
    const nSeen = this.pulses.filter((p) => p.t >= s && p.t <= t).length;
    const got = nSeen >= 2, over = t >= this.tB0 + 4 * this.beat;
    const key = `${got}|${over}`;
    if (key === this.colKey) return;
    this.colKey = key;
    const L = this.col; L.clear();
    const c = L.ctx;
    c.save();
    c.translate(-COL.x, -COL.y);
    c.textBaseline = 'alphabetic';
    // 右上：監護中（前面的點在 drawIcons 閃）
    c.textAlign = 'right';
    c.font = font(F.hei(500), 18); c.letterSpacing = '4px';
    c.fillStyle = rgba('bone', 0.8);
    c.fillText('監護中', CX1, 112);
    this.colDotX = CX1 - c.measureText('監護中').width - 16 - COL.x;
    c.textAlign = 'left';
    // 直的細線：波形區與數字欄的分界；橫的細線分隔每一列
    c.fillStyle = rgba('bone', 0.14);
    c.fillRect(SEP, 142, 1, 660);
    for (const y of [Y1 - 104, Y2 - 104, Y2 + 104]) c.fillRect(CX0, y, CX1 - CX0, 1);

    // 同步率
    c.font = font(F.hei(500), 20); c.letterSpacing = '5px'; c.fillStyle = rgba('bone', 0.82);
    c.fillText('同步率', CX0, 176);
    c.font = font(F.mono(500), 14); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.8);
    c.fillText('SYNC', CX0, 200);
    c.letterSpacing = '0px';
    c.textAlign = 'right';
    c.font = font(F.archivo(100, 700), 54); c.fillStyle = rgba('bone', 0.95);
    c.fillText('100%', CX1, 198);
    c.textAlign = 'left';

    // 兩個人的心率：列跟波形對齊（真的監護儀就是這樣排）；開機先是三條短橫線，量到兩下心跳才顯示
    const bpm = String(Math.round(this.ctx.audio.bpm));
    for (const [name, y, chl] of [[GROOM, Y1, 'CH1'], [BRIDE, Y2, 'CH2']] as const) {
      c.font = font(F.hei(500), 26); c.letterSpacing = '4px'; c.fillStyle = rgba('bone', 0.9);
      c.fillText(name, CX0, y - 62);
      const nw = c.measureText(name).width;
      c.font = font(F.mono(500), 14); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.8);
      c.fillText(`${chl}  HR`, CX0 + nw + 14, y - 64);
      c.textAlign = 'right';
      c.fillText('bpm', CX1, y - 64);
      c.letterSpacing = '0px';
      if (got) {
        c.font = font(F.archivo(100, 900), 132);
        c.fillStyle = rgba('signal');
        c.fillText(bpm, CX1, y + 58);
      } else {
        // 字型的連字號在這個字級會變成方塊，自己畫
        c.fillStyle = rgba('ash', 0.55);
        for (let k = 0; k < 3; k++) c.fillRect(CX1 - 58 - k * 74, y + 12, 50, 7);
      }
      c.textAlign = 'left';
    }

    // 心動指數：框、還沒亮的格子、刻度（亮的格子在 drawIcons 畫）
    const yL = METER_Y - 20;
    c.font = font(F.hei(500), 20); c.letterSpacing = '5px'; c.fillStyle = rgba('bone', 0.82);
    c.fillText('心動指數', CX0, yL);
    c.font = font(F.mono(500), 14); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.8);
    c.textAlign = 'right'; c.fillText('LOVE INDEX', CX1, yL); c.textAlign = 'left';
    c.letterSpacing = '0px';
    const pitch = (CX1 - CX0) / SEG_N, sw = pitch - 5;
    c.strokeStyle = rgba('bone', 0.35); c.lineWidth = 1;
    c.strokeRect(CX0 - 4.5, METER_Y - 4.5, CX1 - CX0 + 5, METER_H + 9);
    c.fillStyle = rgba('bone', 0.07);
    for (let i = 0; i < SEG_N; i++) c.fillRect(CX0 + i * pitch, METER_Y, sw, METER_H);
    c.font = font(F.mono(400), 13); c.fillStyle = rgba('ash', 0.75); c.letterSpacing = '1px';
    const yT = METER_Y + METER_H + 24;
    c.fillText('0', CX0, yT);
    c.textAlign = 'center'; c.fillText('50', (CX0 + CX1) / 2, yT);
    c.textAlign = 'right'; c.fillText('100', CX1, yT);
    c.textAlign = 'left'; c.letterSpacing = '0px';
    if (over) {
      c.font = font(F.hei(700), 24); c.letterSpacing = '6px';
      c.fillStyle = rgba('signal');
      c.fillText('超出量表', CX0, METER_Y + METER_H + 62);
      c.letterSpacing = '0px';
    }
    c.restore();
    L.upload();
  }

  // ---------------------------------------------------------------- 規格列＋歌詞
  private drawBand(t: number, out: THREE.WebGLRenderTarget) {
    const s = this.ctx.start;
    const B = this.band, G = this.bandGlow;
    const { lyrics } = this.ctx;
    const ly = lyricAt(lyrics, t);
    const spec = Array.from('ECG  ·  導程 II  ·  25 mm/s  ·  10 mm/mV');
    const n = Math.floor(spec.length * prog(t, s + 0.05, s + 0.6));
    // 規格列打完、兩句之間沒有歌詞時，帶子的內容不會變：不重畫也不重新上傳
    const idle = !ly && lyrics.has && n >= spec.length;
    const key = idle ? 'idle' : '';
    if (!key || key !== this.bandKey) {
      B.clear(); G.clear();
      const c = B.ctx, gc = G.ctx;
      c.save(); gc.save();
      c.translate(-BAND.x, -BAND.y); gc.translate(-BAND.x, -BAND.y);
      // 規格列：開機時 mono 打字出來
      c.textBaseline = 'alphabetic';
      c.font = font(F.mono(500), 16);
      c.letterSpacing = '3px';
      c.fillStyle = rgba('ash', 0.85);
      c.fillText(spec.slice(0, n).join(''), X0, 112);
      c.letterSpacing = '0px';
      let glow = false;
      if (ly) glow = this.drawLyric(c, gc, t, ly);
      else if (!lyrics.has) this.drawTitle(c, t);
      c.restore(); gc.restore();
      B.upload();
      // 光暈層：沒有正在唱的字就不上傳（上一格也是空的話）
      if (glow || !this.glowEmpty) G.upload();
      this.glowEmpty = !glow;
    }
    this.bandKey = key;
    this.blit(B.texture, BAND.x, BAND.y, BAND.w, BAND.h, out);
  }

  /**
   * 歌詞坐在上面那條線上（逐字跟唱，規則跟 drawLyric 一樣）。新的一行一個字一個字「落」到線上（彈簧），
   * 掃描線從哪個字底下經過又剛好心跳，那個字就被彈起來一下。回傳有沒有畫到正在唱的字（發光層）。
   */
  private drawLyric(c: CanvasRenderingContext2D, gc: CanvasRenderingContext2D, t: number, ly: NonNullable<ReturnType<typeof lyricAt>>): boolean {
    const line = ly.line;
    const st = { family: F.archivo(100, 800), size: this.lyricSize, minSize: 54, maxWidth: X1 - LX - 40, lineHeight: 1.08 };
    const lay = layoutLyric(c, line, st);
    const oy = Y1 - 22 - lay.rows[lay.rows.length - 1]!.y;
    const size = lay.size;
    let glow = false;
    c.save(); gc.save();
    c.font = gc.font = font(st.family, size);
    c.textBaseline = gc.textBaseline = 'alphabetic';
    const kout = 1 - clamp((t - line.end - 0.6) / 0.6);
    lay.words.forEach((pw, i) => {
      const tIn = line.start - 0.35 + i * 0.028;
      const land = springStep(t - tIn, 2.4, 0.4);
      const a = ly.k * clamp((t - tIn) / 0.12);
      if (a <= 0.003) return;
      const cxw = LX + pw.x + pw.w / 2;
      const b = this.bounce(cxw, pw.w, t);
      const x = LX + pw.x, y = oy + pw.y - (1 - land) * 64 - (1 - kout) * 26 + b.dy;
      const p = Lyrics.wordProgress(pw.word, t);
      c.save();
      c.translate(cxw, y); c.rotate(b.rot); c.translate(-cxw, -y);
      c.globalAlpha = a;
      if (p < 1) { c.fillStyle = rgba('bone', 0.3); c.fillText(pw.word.w, x, y); }
      if (p > 0) {
        c.beginPath();
        c.rect(x - size * 0.1, y - size * 1.1, (pw.w + size * 0.2) * p, size * 1.5);
        c.clip();
        c.fillStyle = p < 1 ? rgba('signal') : rgba('bone', 0.96);
        c.fillText(pw.word.w, x, y);
      }
      c.restore();
      if (p > 0 && p < 1) {
        // 正在唱的字另外畫到發光層（每個主題的訊號色都要亮得起來）
        glow = true;
        gc.save();
        gc.translate(cxw, y); gc.rotate(b.rot); gc.translate(-cxw, -y);
        gc.globalAlpha = a;
        gc.beginPath(); gc.rect(x - size * 0.1, y - size * 1.1, (pw.w + size * 0.2) * p, size * 1.5); gc.clip();
        gc.fillStyle = rgba('signal', 0.55);
        gc.fillText(pw.word.w, x, y);
        gc.restore();
      }
    });
    c.restore(); gc.restore();
    return glow;
  }

  /**
   * 純音樂（整首沒有歌詞）：線上坐的是歌名（紙白、不跟唱），歌手用典雅的斜體接在後面；
   * 一樣一個字一個字落到線上、被心跳彈起來，上半部才不會空著一大片。
   */
  private drawTitle(c: CanvasRenderingContext2D, t: number) {
    const { song } = this.ctx;
    const s = this.ctx.start;
    const title = song.title || '今晚的歌';
    const fam = F.archivo(100, 800);
    const maxW = X1 - LX - 40;
    const size = Math.max(54, Math.min(this.lyricSize * 0.85, fitSize(title, fam, maxW * 0.8)));
    const lay = layout(title, fam, size);
    const y0 = Y1 - 22;
    c.save();
    c.font = font(fam, size);
    c.textBaseline = 'alphabetic';
    c.fillStyle = rgba('bone', 0.9);
    for (const g of lay.glyphs) {
      const tIn = s + 0.25 + g.i * 0.035;
      const land = springStep(t - tIn, 2.4, 0.4);
      const a = clamp((t - tIn) / 0.12);
      if (a <= 0) continue;
      const cx = LX + g.x + g.w / 2;
      const b = this.bounce(cx, g.w, t);
      const y = y0 - (1 - land) * 64 + b.dy;
      c.save();
      c.globalAlpha = a;
      c.translate(cx, y); c.rotate(b.rot);
      c.fillText(g.ch, -g.w / 2, 0);
      c.restore();
    }
    if (song.artist) {
      const fa = F.serif(400, true), as = Math.round(size * 0.42);
      c.font = font(fa, as);
      const aw = c.measureText(song.artist).width;
      // 放得下就接在歌名後面，放不下就放在歌名上面一行
      const same = LX + lay.width + 28 + aw <= X1 - 20;
      c.globalAlpha = prog(t, s + 0.6, s + 1.0);
      c.fillStyle = rgba('ash', 0.95);
      c.fillText(song.artist, same ? LX + lay.width + 28 : LX + 4, same ? y0 : y0 - size * 1.02);
    }
    c.restore();
  }

  /** 掃描線從這個字底下經過、剛好心跳：往上彈一下再落回線上，往遠離心跳的方向歪一點。 */
  private bounce(cx: number, w: number, t: number): { dy: number; rot: number } {
    let dy = 0, rot = 0;
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i]!;
      const age = t - p.t;
      if (age < 0) continue;
      if (age > 0.9) break;
      const d = cx - this.pulseX[i]!;
      if (Math.abs(d) > w / 2 + 34) continue;
      const env = Math.exp(-age / 0.14) * Math.sin(TAU * 2.8 * age);
      dy -= (10 + 10 * p.a) * env;
      rot += (d >= 0 ? 1 : -1) * 0.045 * env;
    }
    return { dy, rot };
  }

  // ---------------------------------------------------------------- 紙條
  /** 醫囑紙條：第二拍開始，一拍一格從畫面下緣吐出來（像熱感應印表機送紙）。紙條的貼圖只上傳一次。 */
  private drawStrip(t: number, out: THREE.WebGLRenderTarget) {
    const S = this.strip;
    if (!S) return;
    const beat = this.beat;
    const st = Math.max(STRIP_TOP, SAFE_B - S.sigY);
    // 窗格很短（不到四小節）時從第一拍就開始、半拍一格，留給讀的時間才夠
    const short = this.tH0 - this.ctx.start < 3 * 4 * beat;
    const t0 = this.tB0 + (short ? 0 : beat), step = short ? beat / 2 : beat;
    let feed = 0;
    for (let i = 0; i < 4; i++) feed += prog(t, t0 + i * step, t0 + i * step + 0.3 * beat, ease.outQuart) / 4;
    if (feed <= 0) return;
    if (!this.stripUp) { S.layer.upload(); this.stripUp = true; }
    // 停住時對齊整數像素（貼圖 1:1，字才銳利）
    const y = feed >= 1 ? Math.round(st) : lerp(H + 30, st, feed);
    this.blit(S.layer.texture, LX - S.pad, y - S.pad, S.layer.w, S.layer.h, out);
    // 出紙口的陰影：紙越靠近畫面下緣越暗，看起來是從機器裡吐出來的，不是貼在畫面上的一張卡
    const sh = this.shade; sh.clear();
    for (let yy = H - 150; yy < H; yy += 3) {
      const a = 0.72 * ((yy - (H - 150)) / 150) ** 1.4;
      sh.seg2(LX - 30, yy + 1.5, LX + S.w + 30, yy + 1.5, 3.2, LIN.ink, a);
    }
    sh.render(this.ctx.renderer, out);
  }

  // ---------------------------------------------------------------- 判讀
  /** 愛心旁邊的判讀：像 pdoom 的圖上註記，一條引線指到愛心右邊。愛心快合上時就開始打字：快歌的平線只剩一拍，要在切走前讀得完。 */
  private drawNote(t: number, out: THREE.WebGLRenderTarget) {
    const N = this.note;
    if (t < this.tH0 || !N) return;
    const H0 = this.heart, nb = this.noteBox;
    const tA = lerp(this.tH0, this.tH1, 0.62);
    const ka = prog(t, tA, tA + 0.2);
    if (ka <= 0) return;
    const l1 = Array.from('偵測到特殊波形'), l2 = Array.from('判讀：良性，終身有效');
    const n1 = Math.ceil(l1.length * prog(t, tA, tA + 0.3));
    const n2 = Math.ceil(l2.length * prog(t, tA + 0.2, tA + 0.6));
    const tx = H0.cx + H0.s * 1.25 + 60, ty = (Y1 + Y2) / 2 - 8;
    const key = `${n1}|${n2}`;
    if (key !== this.noteKey) {
      this.noteKey = key;
      N.clear();
      const c = N.ctx;
      c.save();
      c.translate(-nb.x, -nb.y);
      c.textBaseline = 'alphabetic';
      c.font = font(F.hei(500), 24); c.letterSpacing = '4px'; c.fillStyle = rgba('bone', 0.92);
      c.fillText(l1.slice(0, n1).join(''), tx, ty);
      c.font = font(F.mono(500), 17); c.letterSpacing = '2px'; c.fillStyle = rgba('ash', 0.9);
      c.fillText(l2.slice(0, n2).join(''), tx, ty + 32);
      c.restore();
      N.upload();
    }
    this.blit(N.texture, nb.x, nb.y, nb.w, nb.h, out, { opacity: ka });
    // 引線與圓點（GPU 畫）
    const ax = H0.cx + H0.s * 0.92, ay = H0.cy - H0.s * 0.25;
    const col = scaled(LIN.ash, 0.55 * ka);
    this.I.seg2(ax + 6, ay, tx - 14, ty - 8, 1, col, 1);
    this.I.seg2(ax + 4, ay, ax + 4.01, ay, 6, col, 1);
  }
}
