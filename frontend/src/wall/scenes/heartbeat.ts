// 心電圖（照 pdoom 的 spacetime 第一樂章：觸發的磷光示波器、掃描線把歌詞寫在波形上；loss 的「字騎在曲線上」）。
// 一台雙頻道的監護儀，擺在暗暗的房間裡、鏡頭稍微從側面拍（heartbeat-screen.ts）：上面是新郎、下面是新娘，
// 兩條心電圖用主題的訊號色、掃描線有殘影，心跳打在這首歌真的大鼓上，而且兩個人永遠同步。
//  - 上面那條是倒過來的導程：兩條線的心跳都「朝對方伸過去」，中間留一條空隙。
//  - 歌詞坐在上面那條線上，逐字跟唱；掃描線從哪個字底下經過、剛好心跳，那個字就被彈一下。
//  - 主打留言是心電圖機印出來的「醫囑」紙條，在前景一拍一格從畫面下緣送上來——整個畫面最大、最清楚的字；
//    紙條上來時鏡頭對焦到紙上，後面的螢幕虛一點、暗一點（淺景深）。沒有留言就印一張小小的邀請，歌詞是焦點。
//  - 讀數只剩螢幕上角一行小字（心率 = 這首歌的 BPM、同步率 100%、心動指數：超出量表），不搶字。
//  - 最後一小節的強拍：心跳先漏一拍，兩條線往中間彎，一條從凹口往左、一條從尖端往右，互相追著畫出一顆愛心
//    （玫瑰色，唯一的點綴色），合起來後填上細網線，兩條線各自恢復平穩切走。
// 座標：監護儀畫面的東西都畫在「螢幕座標」（一張 1920×1080 的 render target），再以透視貼到畫面上；紙條在畫面座標。
// 效能：Canvas 上傳貼圖是最貴的，所以沒有全螢幕的 Canvas 層——歌詞一條小帶子每格上傳（fast）、判讀與紙條只在內容變的時候上傳，
// 會閃的小東西都用 LineBatch 在 GPU 畫。
// v2（2026-09-29「留言尺寸與版面比例標準 v2」）：醫囑紙條縮成左下角一張 ≤ 860 寬的收據（留言 40～60 px、署名 26～32，
// 露出來的紙 ≤ 430 高）；監護儀的歌詞在畫面上 40～52 px（不比留言大）。監護儀才是畫面的主體：
// 下半多了第三條波形「呼吸」——跟著這首歌的音量起伏的平滑曲線，同一條掃描線寫過去，每個小節線在曲線上亮一顆小點。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, makeRT } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, layout, fitSize, loadText } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, fract, lerp, prog, pulse, springStep, TAU } from '../engine/util';
import { Lyrics } from '../engine/lyrics';
import { sparkHead, sparkParticles, lyricAt, layoutLyric, beatAfter, type LyricLayout } from './_motifs';
import { V2, msgMaxFor, lyricV2 } from './_v2';
import { pickPulses, ecgAt, Sweep, heartPaths, partial, scanRows, type Pulse, type HeartPaths, type Row } from './heartbeat-ecg';
import { buildStrip, msgStrip, INVITE_STRIP, STRIP_TEXT, STRIP_FIXED, type Strip } from './heartbeat-strip';
import { MONITOR, monitorPose, setPose } from './heartbeat-screen';
// 最早的版面：排程參數在 director.ts 的 PLATES；這裡只宣告雙語（2026-09-30 雙語普查通過：有翻譯＋主打留言時中文、原文、留言三樣都清楚）
export const spec: PlateSpecDecl = { bilingual: true };


// ---------------------------------------------------------------- 螢幕上的版面（螢幕座標；四周留寬一點：映像管的玻璃是鼓的，邊緣會被推出去）
const X0 = 150, X1 = 1770, WTR = X1 - X0; // 波形區：用整個寬度（右邊不再有數字欄）
const Y1 = 300, Y2 = 470; // 兩條基線（上：新郎、下：新娘）：放在螢幕上半，下半留給前景的紙條
const AMP = 72; // R 波高度（px）
const LX = 182; // 歌詞的左緣
const HEAD_Y = 138; // 規格列與讀數的基線
const GAP = 34; // 掃描線前面清掉的空隙（監護儀的擦除條）
const NS = 760; // 每條波形取樣點數（~2 px 一點，R 波夠尖又不會閃）
const PHI_H = 0.5; // 愛心畫在波形區的哪裡（0..1）
// 歌詞帶（規格列＋讀數＋坐在上面那條線上的歌詞）在螢幕上的範圍（只上傳這麼大）
const BAND = { x: 120, y: 96, w: 1680, h: 216 };
// ---------------------------------------------------------------- 前景的紙條（畫面座標）
const SX = 130; // 紙的左緣（字從 SX + 44 開始，離左邊 ≥ 96）
const SX_MAX = 1350; // 紙的右緣不超過這裡：再過去、再往下就是右下角 QR 的地盤
/** v2：紙條主文最寬（紙寬 ≤ 860 = 主文＋左右各 44）。 */
const STRIP_BODY_W = 772;
/** 監護儀在畫面上大約是螢幕座標的幾倍（透視、推鏡之後最小約 0.77）：螢幕上的字級要除以它才是螢幕座標的字級。 */
const MON_S = 0.84;
/** 第三條波形（呼吸）的基線與振幅（螢幕座標）。 */
const Y3 = 770, AMP3 = 72;
const STRIP_TOP = 505; // 紙條最高只到這裡（下面那條線在畫面上最低約到 y = 475）
const SAFE_B = H - 96; // 最後一行字的基線不能低於這裡（投影機會裁邊）

// 固定會畫到的中文（init 時一次載好）
const TEXT = '導程心動指數超出量表量測中偵測到特殊波形判讀：良性，終身有效今晚的歌' + STRIP_TEXT;

// ---------------------------------------------------------------- 螢幕的內容：映像管玻璃＋心電圖格子（格子間距 = 0.2 秒的掃描長度，所以真的能量時間）
const BG = () => new FSPass(/* glsl */ `
  uniform float t; uniform float k; uniform float gridPx; uniform vec4 box; uniform float yRef;
  uniform float beamX; uniform float beamI;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y); // y 向下，跟 Canvas2D 一樣
    vec2 uv = p / vec2(${W}.0, ${H}.0) - 0.5;
    float rc = length(uv * vec2(1.7778, 1.0));
    // 映像管玻璃：中間一點點浮起來的暗色，邊緣收掉
    vec3 col = C_INK + (C_INK2 - C_INK) * (0.9 - 0.8 * smoothstep(0.1, 0.95, rc));
    col += (C_INK2 - C_INK) * 0.25 * fbm(p / 520.0 + vec2(0.0, t * 0.01), 3);
    // 格子只在波形區：大格實線、小格只點交叉點（心電圖紙的 5 mm / 1 mm），開機時從中間往兩邊蝕刻出來。很淡：背景要能呼吸
    float cxm = 0.5 * (box.x + box.y);
    float inside = step(box.x, p.x) * step(p.x, box.y) * step(box.z, p.y) * step(p.y, box.w)
                 * step(abs(p.x - cxm), k * 0.5 * (box.y - box.x) + 1.0);
    // 格子的上下緣淡出（不要一個硬邊的方框）
    inside *= smoothstep(box.z, box.z + 60.0, p.y) * smoothstep(box.w, box.w - 60.0, p.y);
    vec2 q = vec2(p.x - box.x, p.y - yRef) / gridPx;
    vec2 d = abs(fract(q + 0.5) - 0.5) * gridPx;
    float major = max(pxLine(d.x, 0.35, 1.2), pxLine(d.y, 0.35, 1.2));
    vec2 dm = abs(fract(q * 5.0 + 0.5) - 0.5) * gridPx / 5.0;
    float dots = pxLine(length(dm), 0.6, 1.5);
    // 掃描線經過的地方玻璃被照亮一點（pdoom 示波器的做法）
    float bl = beamI * exp(-abs(p.x - beamX) / 180.0);
    vec3 gc = mix(C_BLOOD, C_SIGNAL, 0.35);
    col += gc * (major * 0.05 + dots * 0.035) * (1.0 + 2.0 * bl) * inside;
    // 很淡的掃描線（映像管的橫紋）
    col *= 1.0 - 0.02 * step(0.5, fract(p.y / 3.0));
    fragColor = vec4(col, 1.0);
  }`, {
  t: { value: 0 }, k: { value: 1 }, gridPx: { value: 70 }, box: { value: new THREE.Vector4(X0, X1, Y1 - 150, Y3 + 110) }, yRef: { value: Y1 },
  beamX: { value: 0 }, beamI: { value: 0 },
});

type P2 = { x: number; y: number };
type RGB = [number, number, number];
const scaled = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

export default class Heartbeat extends Scene {
  bg = shared('heartbeat.bg', BG);
  monitor = shared('heartbeat.monitor', MONITOR);
  /** 監護儀的畫面（螢幕座標），每格畫好再以透視貼到畫面上。 */
  scr = this.track(makeRT(W, H, { depthBuffer: false }));
  /** 規格列＋讀數＋歌詞（每格上傳，但只有一條帶子那麼大）。 */
  band = this.track(new Layer2D(BAND.w, BAND.h, undefined, { fast: true }));
  /** 正在唱的字的光暈（同一條帶子、半解析度）。 */
  bandGlow = this.track(new Layer2D(BAND.w, BAND.h, 0.5, { fast: true }));
  /** 愛心旁邊的判讀（打字時才上傳）。 */
  note: Layer2D | null = null;
  noteBox = { x: 0, y: 0, w: 480, h: 90 };
  /** 波形、愛心、網線、火花（加亮）。 */
  L = this.track(new LineBatch(7000, { screen2D: true, blend: 'add' }));
  /** 會閃的小燈（取最大值，疊在一起不會變兩倍亮）。 */
  I = this.track(new LineBatch(256, { screen2D: true, blend: 'max' }));
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
  lyricSize = 76;
  hx = 0;
  /** 大愛心（網線）的掃描列。 */
  hatchRows: Row[] = [];
  /** 讀數前面那顆會閃的點的位置（螢幕座標，畫讀數時量出來）。 */
  private dotX = X1;
  // 小圖層的「上次畫了什麼」：內容只由 key 決定，一樣就不重畫、不重新上傳（所以任何時間順序畫出來都一樣）
  private noteKey = '';
  private bandKey = '';
  private glowEmpty = true;
  private stripUp = false;

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    // 歌詞裡的中文字也先載好：第一次畫到時如果還在用備援字型，同一格畫兩次會不一樣
    await loadText(TEXT + (song.title ?? '') + (song.artist ?? '') + lyrics.linesIn(s - 1, e + 1).map((l) => l.text).join(''));
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
    this.hatchRows = scanRows(this.heart.outline, this.heart.top - 2, this.heart.tip.y, 5);
    // 判讀的小圖層：放在愛心右邊
    const tx = this.heart.cx + this.heart.s * 1.25 + 60, ty = (Y1 + Y2) / 2 - 8;
    this.noteBox = { x: Math.floor(tx - 6), y: Math.floor(ty - 34), w: 470, h: 84 };
    this.note = this.track(new Layer2D(this.noteBox.w, this.noteBox.h, undefined, { fast: true }));

    const m = this.msg;
    // 紙條：主文的框 = 從 STRIP_TOP 到畫面安全邊（離下緣 96 px），紙的右緣不過 SX_MAX
    const first = this.pulses.find((p) => p.t >= s) ?? { t: this.tB0, a: 1 };
    const trace = (x01: number) => ecgAt(this.pulses, first.t - 0.35 + x01 * 2.4, this.q, 0, au);
    const body = m ? msgStrip(m) : INVITE_STRIP;
    this.strip = buildStrip({
      ...body, bodyFamily: F.hand(400), trace,
      maxW: m ? STRIP_BODY_W : SX_MAX - SX - 88, maxH: m ? Math.min(SAFE_B - STRIP_TOP, V2.boxH) - STRIP_FIXED : 60, min: m ? V2.msgMin : 34, max: m ? msgMaxFor(m.text) : 40,
    });
    this.track(this.strip.layer);
    // 沒有留言：歌詞是焦點（螢幕上約 85 px）。有留言：歌詞是第二層，比紙條上的留言小一級（約七成），
    // 但透視縮放後最遠的字也要 ≥ 48 px（監護儀在畫面上最小約 0.77 倍 → 螢幕座標至少 64）
    // v2：畫面上 40～52 px（有留言時不比留言大），換成螢幕座標
    this.lyricSize = lyricV2(m ? this.strip.fit.size : null) / MON_S;
  }

  /** 把一張小圖層（邏輯像素的範圍 x,y,w,h）貼到 target 上的那個位置（Compositor 只會縮放平移）。 */
  private blit(tex: THREE.Texture, x: number, y: number, w: number, h: number, out: THREE.WebGLRenderTarget, o: { mode?: 'normal' | 'add'; opacity?: number; tint?: [number, number, number] } = {}) {
    this.ctx.comp.draw(this.ctx.renderer, tex, out, { ...o, scale: [W / w, H / h], offset: [0.5 * W / w - 0.5 - x / w, 0.5 + y / h - 0.5 * H / h] });
  }

  /** 紙條送上來了多少（0..1）：第二拍開始，一拍一格（短窗格從第一拍、半拍一格，留給讀的時間才夠）。 */
  private feed(t: number) {
    const S = this.strip;
    if (!S) return 0;
    const beat = this.beat;
    const short = this.tH0 - this.ctx.start < 3 * 4 * beat;
    const t0 = this.tB0 + (short ? 0 : beat), step = short ? beat / 2 : beat;
    let feed = 0;
    for (let i = 0; i < 4; i++) feed += prog(t, t0 + i * step, t0 + i * step + 0.3 * beat, ease.outQuart) / 4;
    return feed;
  }

  /** 鏡頭的手持感：很慢、很小的晃動（確定性，只跟時間有關）。 */
  private drift(t: number): P2 {
    return { x: 4 * Math.sin(t * 0.37 + 1.3) + 2 * Math.sin(t * 0.83), y: 2.5 * Math.sin(t * 0.29 + 0.4) + 1.5 * Math.sin(t * 0.71 + 2) };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const uNow = this.sweep.u(t);
    const xb = X0 + WTR * fract(uNow);
    const drawing = t >= this.tH0 && t < this.tH1;
    const scr = this.scr;
    this.L.clear(); this.I.clear();

    // ---- 監護儀的畫面（螢幕座標）
    this.bg.u.t!.value = t;
    this.bg.u.k!.value = prog(t, s, s + 0.45, ease.outExpo);
    this.bg.u.gridPx!.value = this.gridPx;
    this.bg.u.beamX!.value = drawing ? this.hx : xb;
    this.bg.u.beamI!.value = prog(t, s, s + 0.3);
    this.bg.render(renderer, scr);
    this.drawBand(t, scr);
    this.drawNote(t, scr);
    this.drawTrace(0, t, uNow, xb);
    this.drawTrace(1, t, uNow, xb);
    this.drawBreath(t, uNow, xb);
    this.drawHeartTrace(t);
    this.drawDot(t);
    this.drawBeams(t);
    this.L.render(renderer, scr);
    this.I.render(renderer, scr);
    if (!this.glowEmpty) this.blit(this.bandGlow.texture, BAND.x, BAND.y, BAND.w, BAND.h, scr, { mode: 'add', tint: [1.7, 1.7, 1.7] });

    // ---- 把螢幕以透視貼到房間裡；紙條送上來時對焦到紙上（螢幕虛一點、暗一點）
    const feed = this.feed(t);
    const dr = this.drift(t);
    const pose = monitorPose((t - s) / Math.max(0.5, e - s));
    pose.cx += dr.x; pose.cy += dr.y;
    const M = this.monitor;
    setPose(M, pose);
    M.u.scr!.value = scr.texture;
    const focus = this.msg ? ease.inOutCubic(feed) : 0;
    M.u.blur!.value = 1.0 * focus;
    M.u.dim!.value = (1 - 0.14 * focus) * (0.25 + 0.75 * prog(t, s, s + 0.12));
    M.u.on!.value = prog(t, s, s + 0.3);
    M.render(renderer, out);

    // ---- 前景的紙條（離鏡頭近：跟著手持的晃動多動一點）
    this.drawStrip(out, feed, dr);

    return {
      bloom: 0.72, halation: 0.3, vignette: 0.5,
      zoom: 1 + 0.012 * pulse(t, this.tH1, 0.18),
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
      if (old) I *= oldK * 0.7;
      const y = this.yOf(ch, v);
      if (have && pOld === old) {
        const h = hot * 0.65, k = I * 1.25;
        L.seg2(px, py, x, y, 1.9 + 1.4 * hot, [lerp(sg[0], em[0], h) * k, lerp(sg[1], em[1], h) * k, lerp(sg[2], em[2], h) * k], 1);
        // 柔光只給還亮著的那段（殘影不需要，也省一半線段）
        if (I > 0.55) L.seg2(px, py, x, y, 10, scaled(sg, 0.045 * I), 1);
      }
      px = x; py = y; pOld = old; have = true;
    }
  }

  /**
   * 第三條波形「呼吸」：跟著這首歌的音量（rms）起伏的平滑曲線，一小節一次深呼吸；跟心電圖同一條掃描線寫過去，
   * 上一趟的殘影在右邊變暗。比心電圖細、暗（配角），每個小節線在曲線上亮一顆小點。畫愛心的時候也照樣呼吸。
   */
  private drawBreath(t: number, uNow: number, xb: number) {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, L = this.L, sw = this.sweep, sg = LIN.signal, bn = LIN.bone;
    const k0 = Math.floor(uNow), on = prog(t, s + 0.15, s + 0.6);
    if (on <= 0) return;
    const breath = (tau: number) => {
      const bar = au.barAt(tau);
      return 0.55 * Math.sin(Math.PI * 2 * bar) * (0.55 + 0.45 * au.env('rms', tau)) + 0.35 * (au.env('low', tau) - 0.4);
    };
    let px = 0, py = 0, pOld = false, have = false;
    const N = 380;
    for (let i = 0; i <= N; i++) {
      const x = X0 + (WTR * i) / N;
      let u = k0 + (x - X0) / WTR;
      const old = u > uNow;
      if (old) { u -= 1; if (x - xb < GAP) { have = false; continue; } }
      const tau = sw.tOf(u);
      if (tau < s - 4) { have = false; continue; }
      const age = Math.max(0, t - tau);
      const I = (0.38 + 0.9 * Math.exp(-age / 0.3)) * (old ? 0.6 : 1) * on;
      const y = Y3 - breath(tau) * AMP3;
      // 呼吸的曲線本來就是平滑的：前後差很多的只會是掃描線停住（畫愛心）時的接縫，不畫
      if (have && pOld === old && Math.abs(y - py) < 18) {
        const hot = Math.exp(-age / 0.08);
        L.seg2(px, py, x, y, 1.8 + hot, [lerp(sg[0], bn[0], 0.35 + 0.4 * hot) * I, lerp(sg[1], bn[1], 0.35 + 0.4 * hot) * I, lerp(sg[2], bn[2], 0.35 + 0.4 * hot) * I], 1);
      }
      px = x; py = y; pOld = old; have = true;
    }
    // 小節線：曲線上亮一顆小點（掃描線剛寫過的那幾個）
    for (let b = Math.ceil(au.barAt(t - 3)); au.timeOfBar(b) <= t; b++) {
      const tb = au.timeOfBar(b), uu = sw.u(tb);
      if (uNow - uu > 0.95) continue;
      const x = X0 + WTR * fract(uu), y = Y3 - breath(tb) * AMP3, k = Math.exp(-(t - tb) / 0.6) * on;
      if (k < 0.03) continue;
      this.I.seg2(x, y, x + 0.01, y, 7, scaled(sg, 1.6 * k), 1);
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
        L.seg2(a.x, a.y, b.x, b.y, 2.6 + 1.2 * heat, [lerp(base[0] * k, em[0] * 3, heat), lerp(base[1] * k, em[1] * 3, heat), lerp(base[2] * k, em[2] * 3, heat)], 1);
        L.seg2(a.x, a.y, b.x, b.y, 12, scaled(base, 0.06), 1);
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

  /** 讀數前面的小點：跟著心跳閃（畫愛心時一直亮著）。 */
  private drawDot(t: number) {
    const s = this.ctx.start;
    const a = prog(t, s + 0.1, s + 0.45);
    if (a <= 0) return;
    const last = this.lastPulse(t);
    const blink = t >= this.tH0 ? 1 : last ? pulse(t, last.t, 0.14) : 0;
    const x = this.dotX, y = HEAD_Y - 6;
    this.I.seg2(x, y, x + 0.01, y, 8, scaled(LIN.signal, a * (0.35 + 1.4 * blink)), 1);
  }

  // ---------------------------------------------------------------- 規格列＋讀數＋歌詞
  private drawBand(t: number, target: THREE.WebGLRenderTarget) {
    const s = this.ctx.start;
    const B = this.band, G = this.bandGlow;
    const { lyrics, audio: au } = this.ctx;
    const ly = lyricAt(lyrics, t);
    const spec = Array.from('ECG  ·  導程 II  ·  25 mm/s  ·  10 mm/mV');
    const n = Math.floor(spec.length * prog(t, s + 0.05, s + 0.6));
    const got = this.pulses.filter((p) => p.t >= s && p.t <= t).length >= 2;
    const over = t >= this.tB0 + 4 * this.beat;
    // 規格列打完、兩句之間沒有歌詞時，帶子的內容只由讀數的狀態決定：一樣就不重畫也不重新上傳
    const idle = !ly && lyrics.has && n >= spec.length;
    const key = idle ? `idle|${got}|${over}` : '';
    if (!key || key !== this.bandKey) {
      B.clear(); G.clear();
      const c = B.ctx, gc = G.ctx;
      c.save(); gc.save();
      c.translate(-BAND.x, -BAND.y); gc.translate(-BAND.x, -BAND.y);
      c.textBaseline = 'alphabetic';
      // 左上：規格列，開機時 mono 打字出來（很淡，儀器本來就有的字）
      c.font = font(F.mono(500), 16);
      c.letterSpacing = '3px';
      c.fillStyle = rgba('ash', 0.55);
      c.fillText(spec.slice(0, n).join(''), X0, HEAD_Y);
      // 右上：一行讀數（心率 = 這首歌的 BPM、同步率、心動指數）；量到兩下心跳才有數字，四拍後「超出量表」
      const hr = got ? String(Math.round(au.bpm)) : '---';
      const tail = over ? '超出量表' : '量測中';
      const head = `HR ${hr} bpm  ·  SYNC 100%  ·  心動指數：`;
      c.textAlign = 'right';
      c.fillStyle = over ? rgba('signal', 0.75) : rgba('ash', 0.55);
      c.fillText(tail, X1, HEAD_Y);
      const tw = c.measureText(tail).width;
      c.fillStyle = rgba('ash', 0.55);
      c.fillText(head, X1 - tw - 3, HEAD_Y);
      this.dotX = X1 - tw - 3 - c.measureText(head).width - 18;
      c.textAlign = 'left';
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
    this.blit(B.texture, BAND.x, BAND.y, BAND.w, BAND.h, target);
  }

  /**
   * 歌詞坐在上面那條線上（逐字跟唱，規則跟 drawLyric 一樣）。新的一行一個字一個字「落」到線上（彈簧），
   * 掃描線從哪個字底下經過又剛好心跳，那個字就被彈起來一下。回傳有沒有畫到正在唱的字（發光層）。
   */
  private drawLyric(c: CanvasRenderingContext2D, gc: CanvasRenderingContext2D, t: number, ly: NonNullable<ReturnType<typeof lyricAt>>): boolean {
    const line = ly.line;
    let st = { family: F.archivo(100, 800), size: this.lyricSize, minSize: V2.lyrMin / MON_S, maxWidth: X1 - LX - 20, lineHeight: 1.08 };
    let lay = layoutLyric(c, line, st);
    let oy = Y1 - 22 - lay.rows[lay.rows.length - 1]!.y;
    if (lay.sub) {
      // 韓文歌：線的正上方只有一條字的位置（線下面是往下伸的心跳），所以原文坐在線上、中文坐在原文正上方；
      // 兩段太高、碰到上面的規格列就一起縮（中文不小於 lyrMin）
      const subLast = (l: LyricLayout) => l.sub!.dy + l.sub!.lay.rows[l.sub!.lay.rows.length - 1]!.y;
      for (let k = 1; k < 8 && Y1 - 22 - subLast(lay) - lay.size * 0.92 < HEAD_Y + 16 && lay.size > st.minSize; k++) {
        st = { ...st, size: Math.max(st.minSize, this.lyricSize * Math.pow(0.93, k)) };
        lay = layoutLyric(c, line, st);
      }
      oy = Y1 - 22 - subLast(lay);
    }
    const size = lay.size;
    let glow = false;
    c.save(); gc.save();
    c.font = gc.font = font(st.family, size);
    c.textBaseline = gc.textBaseline = 'alphabetic';
    const kout = 1 - clamp((t - line.end - 0.6) / 0.6);
    if (lay.sub) this.drawSubOnLine(c, lay.sub.lay, st.family, oy + lay.sub.dy, t, ly.k, line.start, kout);
    lay.words.forEach((pw, i) => {
      const tIn = line.start - 0.35 + i * 0.028;
      const land = springStep(t - tIn, 2.4, 0.4);
      const a = ly.k * clamp((t - tIn) / 0.12);
      if (a <= 0.003) return;
      const cxw = LX + pw.x + pw.w / 2;
      const b = this.bounce(cxw, pw.w, t);
      const x = LX + pw.x, y = oy + pw.y - (1 - land) * 48 - (1 - kout) * 26 + b.dy;
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
        gc.fillStyle = rgba('signal', 0.5);
        gc.fillText(pw.word.w, x, y);
        gc.restore();
      }
    });
    c.restore(); gc.restore();
    return glow;
  }

  /**
   * 原文副行坐在線上：跟中文一樣一個字一個字落下來、被心跳彈起來，但比中文安靜——
   * 唱到、唱完都是淡兩成的紙白（不用訊號色、不進發光層），還沒唱三成。逐字時間是原文自己的。
   */
  private drawSubOnLine(c: CanvasRenderingContext2D, lay: LyricLayout, family: string, oy: number, t: number, k: number, start: number, kout: number) {
    const size = lay.size;
    c.save();
    c.font = font(family, size);
    lay.words.forEach((pw, i) => {
      const tIn = start - 0.3 + i * 0.028;
      const land = springStep(t - tIn, 2.4, 0.4);
      const a = k * clamp((t - tIn) / 0.12);
      if (a <= 0.003) return;
      const cxw = LX + pw.x + pw.w / 2;
      const b = this.bounce(cxw, pw.w, t);
      const x = LX + pw.x, y = oy + pw.y - (1 - land) * 36 - (1 - kout) * 20 + b.dy;
      const p = Lyrics.wordProgress(pw.word, t);
      c.save();
      c.translate(cxw, y); c.rotate(b.rot); c.translate(-cxw, -y);
      c.globalAlpha = a;
      if (p < 1) { c.fillStyle = rgba('bone', 0.3); c.fillText(pw.word.w, x, y); }
      if (p > 0) {
        c.beginPath();
        c.rect(x - size * 0.1, y - size * 1.1, (pw.w + size * 0.2) * p, size * 1.5);
        c.clip();
        c.fillStyle = rgba('bone', 0.96 * 0.8);
        c.fillText(pw.word.w, x, y);
      }
      c.restore();
    });
    c.restore();
  }

  /**
   * 純音樂（整首沒有歌詞）：線上坐的是歌名（紙白、不跟唱），歌手用典雅的斜體接在後面；
   * 一樣一個字一個字落到線上、被心跳彈起來。有留言時歌名小一級（留言才是焦點）。
   */
  private drawTitle(c: CanvasRenderingContext2D, t: number) {
    const { song } = this.ctx;
    const s = this.ctx.start;
    const title = song.title || '今晚的歌';
    const fam = F.archivo(100, 800);
    const maxW = X1 - LX - 20;
    const size = Math.max(V2.lyrMin / MON_S, Math.min(this.lyricSize * 0.9, fitSize(title, fam, maxW * 0.8)));
    const lay = layout(title, fam, size);
    const y0 = Y1 - 22;
    c.save();
    c.font = font(fam, size);
    c.textBaseline = 'alphabetic';
    c.fillStyle = rgba('bone', 0.88);
    for (const g of lay.glyphs) {
      const tIn = s + 0.25 + g.i * 0.035;
      const land = springStep(t - tIn, 2.4, 0.4);
      const a = clamp((t - tIn) / 0.12);
      if (a <= 0) continue;
      const cx = LX + g.x + g.w / 2;
      const b = this.bounce(cx, g.w, t);
      const y = y0 - (1 - land) * 48 + b.dy;
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
      // 放得下就接在歌名後面，放不下就不放（上面是規格列）
      if (LX + lay.width + 28 + aw <= X1 - 20) {
        c.globalAlpha = prog(t, s + 0.6, s + 1.0);
        c.fillStyle = rgba('ash', 0.9);
        c.fillText(song.artist, LX + lay.width + 28, y0);
      }
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
      dy -= (8 + 8 * p.a) * env;
      rot += (d >= 0 ? 1 : -1) * 0.04 * env;
    }
    return { dy, rot };
  }

  // ---------------------------------------------------------------- 紙條（前景）
  /** 醫囑紙條：一拍一格從畫面下緣送上來（像熱感應印表機送紙）。紙條的貼圖只上傳一次。 */
  private drawStrip(out: THREE.WebGLRenderTarget, feed: number, dr: P2) {
    const S = this.strip;
    if (!S || feed <= 0) return;
    if (!this.stripUp) { S.layer.upload(); this.stripUp = true; }
    const st = Math.max(STRIP_TOP, SAFE_B - S.sigY);
    // 離鏡頭近：手持的晃動在前景大一點（視差）；停住時對齊整數像素（貼圖 1:1，字才銳利）
    const x = Math.round(SX + dr.x * 1.8), y = feed >= 1 ? Math.round(st + dr.y * 1.8) : lerp(H + 40, st, feed);
    // 紙在暗房間裡、離螢幕有點距離：比紙本來的顏色暗一點（不要比紙白還刺眼）
    this.blit(S.layer.texture, x - S.pad, y - S.pad, S.layer.w, S.layer.h, out, { tint: [0.9, 0.9, 0.9] });
  }

  // ---------------------------------------------------------------- 判讀
  /** 愛心旁邊的判讀：像 pdoom 的圖上註記，一條引線指到愛心右邊。愛心快合上時就開始打字：快歌的平線只剩一拍，要在切走前讀得完。 */
  private drawNote(t: number, target: THREE.WebGLRenderTarget) {
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
      c.font = font(F.hei(500), 24); c.letterSpacing = '4px'; c.fillStyle = rgba('bone', 0.8);
      c.fillText(l1.slice(0, n1).join(''), tx, ty);
      c.font = font(F.mono(500), 18); c.letterSpacing = '2px'; c.fillStyle = rgba('ash', 0.75);
      c.fillText(l2.slice(0, n2).join(''), tx, ty + 32);
      c.restore();
      N.upload();
    }
    this.blit(N.texture, nb.x, nb.y, nb.w, nb.h, target, { opacity: ka });
    // 引線與圓點（GPU 畫）
    const ax = H0.cx + H0.s * 0.92, ay = H0.cy - H0.s * 0.25;
    const col = scaled(LIN.ash, 0.5 * ka);
    this.I.seg2(ax + 6, ay, tx - 14, ty - 8, 1, col, 1);
    this.I.seg2(ax + 4, ay, ax + 4.01, ay, 6, col, 1);
  }
}

