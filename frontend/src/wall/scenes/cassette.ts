// 錄音帶（機器 A）：一卷錄音帶的大特寫（稍微歪著、左邊與下緣出畫面），上面一條錄音座的螢光顯示幕（VFD）。
// 照「留言尺寸與版面比例標準 v2」：錄音帶本身是主視覺（大），只有寫留言的那一塊照標準（≤ 860 × 430，字級 40～60 px）。
// 多補的動畫：錄音帶在第一拍滑進來落定；捲軸一直轉；每個小節線一道光從塑膠殼上斜斜掃過（像錄音座的燈打在殼上）；
// 大鼓一打捲軸抖一下（wow & flutter）；鏡頭整段慢慢推近。
//  - 焦點是錄音帶標籤上用簽字筆寫的主打留言（霞鶩文楷，畫面最大的字）：第一拍之後一個詞組一拍寫上去（筆尖是一顆小亮點），
//    寫完在右下署名。標籤上只留一行小小的「A · LOVE MIX」與一行冷面註腳「錄音保護片已拆除：這段祝福不能被覆蓋」。
//  - 窗裡的兩個捲軸：左邊放帶、右邊收帶，磁帶一圈圈捲著（細線畫的年輪），轉速跟著這首歌的速度
//    （收帶那邊越捲越大、轉得越慢），大鼓一打有一點點抖（wow & flutter）。
//  - 顯示幕是配角：只放歌詞（螢光管的字：還沒唱的字是淡淡的殘影、唱到的字是訊號色、唱完是白的）與一個小小的磁帶計數器。
//  - 沒有留言：標籤寫邀請（小一點），顯示幕的歌詞放大變成焦點。鏡頭整段慢慢推近。
// 跟黑膠（俯視、圓、字在溝紋上）不同：這裡是平放的長方形物件，看的是捲軸的機械與標籤上的手寫字。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, prog, hash, TAU } from '../engine/util';
import { fitText, phrases, type FitResult } from '../engine/text';
import { Lyrics, type Word } from '../engine/lyrics';
import { beatAfter, barAfter, signature, lyricAt, sparkHead, COUPLE_ZH, DATE_DOTS, joinBits, lyricSubOf, layoutLyric, subStyleFor, subSizeFor, subGap } from './_motifs';
import { msgMaxFor, lyricV2, sigV2, fitClauses, V2 } from './_v2';
import { fillWithHearts } from '../engine/motifs';
import { layoutWordRows } from './_t7';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'machine', paper: false, energy: [0, 0.75], bars: [4, 8] };

// ---------------------------------------------------------------- 版面
/** 錄音帶的本地座標 0..CW × 0..CH（畫的時候放大 sc 倍、轉一點點）。 */
const CW = 1060, CH = 672;
/** 標籤、窗、捲軸（本地座標）。 */
const LABEL = { x: 56, y: 36, w: CW - 112, h: 474 };
const WIN = { x: CW / 2 - 270, y: 330, w: 540, h: 124 };
const HUB_Y = 392, HUB_DX = 172, HUB_R = 40, PACK_MAX = 116;
/** 留言寫的地方（標籤左上，窗的上面；署名跟在最後一行下面，也在這個範圍裡）：放大 1.3 倍後 ≤ 860 × 430。 */
const WR = { x: 146, y: 46, w: 650, h: 262 };
const SIG_GAP = 10;
/** 標籤圖層（本地座標的範圍）。 */
const LL = { x: LABEL.x - 20, y: LABEL.y - 20, w: LABEL.w + 40, h: LABEL.h + 40 };

const F_LYR = F.archivo(100, 700);
const F_MSG = F.hand(700);
const INVITE = '這一卷還沒錄。掃描右下角 QR code，把你的祝福錄進來。';
const NOTE = '＊錄音保護片已拆除：這段祝福不能被覆蓋。';
const TEXT = `${INVITE}${NOTE}錄音帶標籤面祝福混音《》`;

/**
 * 塑膠殼上掃過的一道光（加亮疊上去）：只在錄音帶的範圍裡（旋轉的圓角方框），斜的一條，跟著小節線從左掃到右。
 */
const SHEEN = () => new FSPass(/* glsl */ `
  uniform vec4 uBox;   // 錄音帶中心 x, y、半寬、半高（螢幕 px）
  uniform float uRot;
  uniform float uPos;  // 光的位置（沿著錄音帶的 x，-1..1）
  uniform float uK;    // 亮度
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y) - uBox.xy;
    float c = cos(-uRot), s = sin(-uRot);
    vec2 q = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
    float d = sdBox(q, uBox.zw - 40.0) - 40.0;
    float inside = 1.0 - smoothstep(-1.0, 1.0, d);
    float u = (q.x + q.y * 0.45) / uBox.z;
    float band = exp(-pow((u - uPos) / 0.07, 2.0)) + 0.35 * exp(-pow((u - uPos + 0.16) / 0.03, 2.0));
    fragColor = vec4(C_BONE * 0.1 * band * uK * inside, 1.0);
  }`, { uBox: { value: new THREE.Vector4() }, uRot: { value: 0 }, uPos: { value: -2 }, uK: { value: 0 } }, { blending: THREE.AdditiveBlending, transparent: true });

const BG = () => new FSPass(/* glsl */ `
  uniform float uIn;
  uniform vec2 uPool;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 深色的桌面：錄音帶底下一圈暖暖的光（一盞檯燈）、很淡的木紋
    float r = length((p - uPool) / vec2(1100.0, 720.0));
    vec3 c = C_INK * 0.8 + (C_INK2 - C_INK) * 2.0 * exp(-r * r * 1.6);
    c *= 0.92 + 0.08 * fbm(vec2(p.x / 900.0, p.y / 28.0), 3);
    fragColor = vec4(c * mix(0.5, 1.0, uIn), 1.0);
  }`, { uIn: { value: 1 }, uPool: { value: new THREE.Vector2(900, 620) } });

export default class Cassette extends Scene {
  bg = shared('cassette.bg', BG);
  sheen = shared('cassette.sheen', SHEEN);
  /** 殼、標籤底、顯示幕的框：畫一次。 */
  shell = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 標籤上的手寫字（寫的時候才重畫；照錄音帶的角度畫在一個正的框裡）。 */
  label!: Layer2D;
  /** 顯示幕的字（內容變了才重畫）。 */
  vfd!: Layer2D;
  /** 捲軸：磁帶的年輪、輪轂（一般混色）；筆尖的火花、捲軸的反光（加亮）。 */
  reels = this.track(new LineBatch(9000, { screen2D: true, blend: 'normal' }));
  glow = this.track(new LineBatch(600, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  beat = 0.5;
  tBoot = 0;
  fit: FitResult | null = null;
  chunks: { line: number; from: number; to: number; t: number }[] = [];
  sigT = Infinity;
  speed = 60;
  /** 錄音帶在螢幕上的位置與角度：左邊與下緣稍微出畫面（大特寫），右緣停在右下角 QR 區的左邊。 */
  CC = { x: 650, y: 648, rot: -0.035 };
  /** 錄音帶在畫面上的縮放（字級照 v2 換算：畫在標籤上的字級 = 螢幕字級 ÷ sc）。 */
  sc = 1.3;
  /** 進場：錄音帶從右邊滑進來，第一拍落定（toScreen 加上這個位移）。 */
  dx = 0;
  /** 標籤上署名的字級（本地座標）與留言在螢幕上的字級。 */
  sigL = 34;
  msgPx = 48;
  bars: number[] = [];
  /** 顯示幕與裡面放歌詞的範圍（錄音帶上面、畫面上緣的一條）。 */
  VFD = { x: 100, y: 84, w: 1440, h: 110 };
  VT = { x: 132, y: 90, w: 1180, h: 100 };
  LB = { x: 0, y: 0, w: 1, h: 1 };
  private vfdKey = '';
  private labelKey = '';

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    this.beat = au.beatPeriod(s + 0.1);
    this.tBoot = beatAfter(au, s + 0.15);
    let bpm = au.bpm || 100;
    while (bpm > 160) bpm /= 2;
    while (bpm < 70) bpm *= 2;
    this.speed = bpm * 0.55;
    const m = this.msg;
    if (!m) {
      // 沒有留言：歌詞是焦點，顯示幕放大；錄音帶小一點、往下（標籤上的邀請是小字）
      this.CC = { x: 700, y: 730, rot: -0.035 };
      this.sc = 1.15;
      this.VFD = { x: 100, y: 84, w: 1440, h: 196 };
      this.VT = { x: 136, y: 94, w: 1300, h: 178 };
    }
    for (let k = 0; ; k++) { const tb = barAfter(au, s + 0.05, k); if (tb > e) break; this.bars.push(tb); }
    this.label = this.track(new Layer2D(1, 1, undefined, { fast: true }));
    const pts = [[LL.x, LL.y], [LL.x + LL.w, LL.y], [LL.x, LL.y + LL.h], [LL.x + LL.w, LL.y + LL.h]].map(([u, v]) => this.toScreen(u!, v!));
    const lx = Math.floor(Math.min(...pts.map((p) => p.x))), ly = Math.floor(Math.min(...pts.map((p) => p.y)));
    this.LB = { x: lx, y: ly, w: Math.ceil(Math.max(...pts.map((p) => p.x))) - lx, h: Math.ceil(Math.max(...pts.map((p) => p.y))) - ly };
    this.label.dispose();
    this.label = this.track(new Layer2D(this.LB.w, this.LB.h, undefined, { fast: true }));
    this.vfd = this.track(new Layer2D(this.VFD.w, this.VFD.h, undefined, { fast: true }));
    const inWin = lyrics.lines.filter((l) => l.end > s - 1 && l.start < e + 1);
    await loadText(TEXT + (m ? m.text + signature(m.name) : '') + inWin.map((l) => l.text).join('') + (song.title ?? '') + COUPLE_ZH);
    this.layoutLabel(m ? m.text : INVITE);
    this.drawShell();
    this.ctx.renderer.initTexture(this.shell.upload());
    (this.bg.u.uPool!.value as THREE.Vector2).set(this.CC.x - 60, this.CC.y - 40);
  }

  /** 錄音帶本地座標 → 螢幕。 */
  private toScreen(u: number, v: number) {
    const cs = Math.cos(this.CC.rot) * this.sc, sn = Math.sin(this.CC.rot) * this.sc;
    return { x: this.CC.x + this.dx + (u - CW / 2) * cs - (v - CH / 2) * sn, y: this.CC.y + (u - CW / 2) * sn + (v - CH / 2) * cs };
  }
  /** 在 Canvas 上套用錄音帶的座標（圖層左上角在螢幕的 ox, oy）。 */
  private applyLocal(c: CanvasRenderingContext2D, ox: number, oy: number) {
    c.translate(this.CC.x - ox, this.CC.y - oy); c.rotate(this.CC.rot); c.scale(this.sc, this.sc); c.translate(-CW / 2, -CH / 2);
  }

  // ---------------------------------------------------------------- 標籤
  private layoutLabel(body: string) {
    const { audio: au } = this.ctx;
    const e = this.ctx.end;
    // v2 的字級是螢幕 px：畫在標籤上（本地座標）要除以 sc。署名跟在最後一行下面，排版時先扣掉它的高度
    const c = this.label.ctx, sc = this.sc;
    if (this.msg) {
      const max = msgMaxFor(body);
      this.sigL = sigV2(max) / sc;
      const o = { min: V2.msgMin / sc, max: max / sc, lineHeight: 1.2, maxLines: 5 };
      const h = WR.h - this.sigL - SIG_GAP;
      this.fit = fitClauses(c, body, F_MSG, WR.w, h, o) ?? fitText(c, body, F_MSG, WR.w, h, o);
      this.msgPx = this.fit.size * sc;
      this.sigL = sigV2(this.msgPx) / sc;
    } else this.fit = fitText(c, body, F_MSG, WR.w, WR.h * 0.5, { min: 30 / sc, max: 36 / sc, lineHeight: 1.3, maxLines: 3 });
    const ph = phrases(body.replace(/\s+/g, ' '), 6);
    const t0 = beatAfter(au, this.tBoot + 0.2);
    const n = ph.length + (this.msg ? 1 : 0);
    let step = n <= 8 ? this.beat : this.beat / 2;
    if (t0 + n * step > e - 0.8) step = Math.max(0.12, (e - 0.8 - t0) / Math.max(1, n));
    const lines = this.fit.lines.map((l) => Array.from(l));
    let li = 0, ci = 0;
    ph.forEach((p, k) => {
      let left = Array.from(p.replace(/\s/g, '')).length;
      const from = { line: li, ch: ci };
      while (left > 0 && li < lines.length) {
        const ch = lines[li]![ci];
        if (ch === undefined) { li++; ci = 0; continue; }
        ci++;
        if (ch.trim()) left--;
      }
      for (let L = from.line; L <= Math.min(li, lines.length - 1); L++) {
        const a = L === from.line ? from.ch : 0, b = L === li ? ci : lines[L]!.length;
        if (b > a) this.chunks.push({ line: L, from: a, to: b, t: t0 + k * step });
      }
    });
    this.sigT = this.msg ? t0 + ph.length * step : Infinity;
  }

  /** 標籤上的字。回傳筆尖（本地座標），沒在寫是 null。 */
  private drawLabel(t: number): { x: number; y: number } | null {
    const fit = this.fit!, m = this.msg;
    const WRT = 0.3;
    const wp = (t0: number) => clamp((t - t0) / WRT);
    const key = `${this.chunks.map((k) => Math.round(wp(k.t) * 24)).join('')}|${Math.round(wp(this.sigT) * 24)}`;
    let pen: { x: number; y: number } | null = null;
    const lines = fit.lines.map((l) => Array.from(l));
    const c = this.label.ctx;
    c.font = font(F_MSG, fit.size);
    const x0 = WR.x, y0 = this.labelY0();
    for (const k of this.chunks) {
      const r = wp(k.t);
      if (r > 0 && r < 1) {
        const arr = lines[k.line]!;
        const px = x0 + c.measureText(arr.slice(0, k.from).join('')).width, w = c.measureText(arr.slice(k.from, k.to).join('')).width;
        pen = { x: px + w * r, y: y0 + k.line * fit.lineHeight - fit.size * 0.3 };
      }
    }
    if (key === this.labelKey) return pen;
    this.labelKey = key;
    const L = this.label;
    L.clear();
    c.save();
    this.applyLocal(c, this.LB.x, this.LB.y);
    c.textBaseline = 'alphabetic';
    c.fillStyle = m ? rgba('sepia') : rgba('sepia', 0.6);
    c.font = font(F_MSG, fit.size);
    for (const k of this.chunks) {
      const r = wp(k.t);
      if (r <= 0) continue;
      const arr = lines[k.line]!;
      const pre = arr.slice(0, k.from).join(''), part = arr.slice(k.from, k.to).join('');
      const x = x0 + c.measureText(pre).width, y = y0 + k.line * fit.lineHeight, w = c.measureText(part).width;
      c.save();
      c.beginPath(); c.rect(x - 4, y - fit.size * 1.1, (w + 8) * r, fit.size * 1.5); c.clip();
      fillWithHearts(c, part, x, y, rgba('rose'));
      c.restore();
    }
    // 署名：最後一行下面、靠右（排版時已經扣掉這一列，不會跟留言重疊）
    if (m && t >= this.sigT) {
      const r = wp(this.sigT);
      c.font = font(F.hand(700), this.sigL);
      const sg = signature(m.couple ? COUPLE_ZH : m.name), w = c.measureText(sg).width;
      const sx = WR.x + WR.w - w, sy = y0 + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.28 + SIG_GAP + this.sigL;
      c.save(); c.beginPath(); c.rect(sx - 4, sy - 44, (w + 8) * r, 60); c.clip();
      c.fillText(sg, sx, sy);
      c.restore();
    }
    c.restore();
    L.upload();
    return pen;
  }

  // ---------------------------------------------------------------- 殼（畫一次）
  private drawShell() {
    const L = this.shell, c = L.ctx, m = this.msg, V = this.VFD;
    L.clear();
    const rr = (x: number, y: number, w: number, h: number, r: number) => { c.beginPath(); c.roundRect(x, y, w, h, r); };
    // ---- 錄音帶
    c.save();
    this.applyLocal(c, 0, 0);
    c.save(); c.filter = 'blur(28px)'; rr(26, 34, CW, CH, 36); c.fillStyle = 'rgba(0,0,0,0.6)'; c.fill(); c.restore();
    // 殼：煙燻黑塑膠
    rr(0, 0, CW, CH, 36);
    const g = c.createLinearGradient(0, 0, CW, CH);
    g.addColorStop(0, mixRgba('ink2', 'graphite', 0.2)); g.addColorStop(1, mixRgba('ink', 'ink2', 0.6));
    c.fillStyle = g; c.fill();
    c.strokeStyle = rgba('graphite', 0.8); c.lineWidth = 1.6; c.stroke();
    rr(10, 10, CW - 20, CH - 20, 28); c.strokeStyle = rgba('bone', 0.05); c.lineWidth = 1; c.stroke();
    // 下緣的磁頭區（梯形凸起）與兩個主導輪孔
    c.beginPath();
    c.moveTo(CW * 0.19, CH - 2); c.lineTo(CW * 0.25, CH - 104); c.lineTo(CW * 0.75, CH - 104); c.lineTo(CW * 0.81, CH - 2);
    c.strokeStyle = rgba('graphite', 0.8); c.lineWidth = 1.4; c.stroke();
    for (const x of [CW * 0.31, CW * 0.69]) { c.beginPath(); c.arc(x, CH - 52, 15, 0, TAU); c.fillStyle = rgba('ink'); c.fill(); c.strokeStyle = rgba('graphite'); c.stroke(); }
    for (const x of [CW * 0.42, CW * 0.5, CW * 0.58]) { rr(x - 20, CH - 70, 40, 26, 4); c.fillStyle = rgba('ink', 0.9); c.fill(); }
    for (const [x, y] of [[36, 36], [CW - 36, 36], [36, CH - 36], [CW - 36, CH - 36], [CW / 2, CH - 124]]) {
      c.beginPath(); c.arc(x!, y!, 10, 0, TAU); c.fillStyle = rgba('graphite', 0.6); c.fill();
      c.strokeStyle = rgba('ink', 0.9); c.lineWidth = 2; c.beginPath(); c.moveTo(x! - 5, y! - 5); c.lineTo(x! + 5, y! + 5); c.moveTo(x! + 5, y! - 5); c.lineTo(x! - 5, y! + 5); c.stroke();
    }
    // 標籤：奶油色的紙（暗的版面上壓暗一點點，不要變成刺眼的白板），窗的上面一條訊號色的帶子
    rr(LABEL.x, LABEL.y, LABEL.w, LABEL.h, 12); c.fillStyle = mixRgba('paper', 'ash', 0.24); c.fill();
    c.fillStyle = rgba('signal', 0.8); c.fillRect(LABEL.x, WIN.y - 9, LABEL.w, 4);
    // 寫字的格線
    c.fillStyle = rgba('sepia', 0.1);
    const fit = this.fit!;
    const y0 = this.labelY0();
    for (let i = 0; i < fit.lines.length; i++) c.fillRect(WR.x - 16, y0 + i * fit.lineHeight + fit.size * 0.16, WR.w + 32, 1);
    void m;
    // 標籤最下面一行小字：冷面註腳（左）與 A 面（右）
    c.textBaseline = 'alphabetic';
    c.font = font(F.hei(500), 14); c.letterSpacing = '2px'; c.fillStyle = rgba('sepia', 0.5);
    c.fillText(NOTE, LABEL.x + 30, LABEL.y + LABEL.h - 18);
    c.font = font(F.mono(500), 13); c.letterSpacing = '4px'; c.textAlign = 'right';
    // 還沒定日期就只寫「SIDE A · LOVE MIX」（不留多的分隔點）
    c.fillText(joinBits('  ·  ', 'SIDE A', 'LOVE MIX', DATE_DOTS), LABEL.x + LABEL.w - 30, LABEL.y + LABEL.h - 18);
    c.textAlign = 'left'; c.letterSpacing = '0px';
    // 窗：挖空（捲軸從下面露出來），蓋一層很淡的玻璃與一道斜的反光
    c.save();
    rr(WIN.x, WIN.y, WIN.w, WIN.h, 22); c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000'; c.fill();
    c.restore();
    c.save();
    rr(WIN.x, WIN.y, WIN.w, WIN.h, 22); c.clip();
    c.fillStyle = rgba('bone', 0.03); c.fillRect(WIN.x, WIN.y, WIN.w, WIN.h);
    const gl = c.createLinearGradient(WIN.x, WIN.y, WIN.x + 200, WIN.y + WIN.h);
    gl.addColorStop(0, 'rgba(255,255,255,0)'); gl.addColorStop(0.5, 'rgba(255,255,255,0.06)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = gl; c.fillRect(WIN.x + 60, WIN.y, 220, WIN.h);
    c.restore();
    rr(WIN.x, WIN.y, WIN.w, WIN.h, 22); c.strokeStyle = rgba('sepia', 0.8); c.lineWidth = 2; c.stroke();
    c.restore();
    void V;
  }

  /** 留言第一行的基線（本地座標）：靠上排，署名緊跟在最後一行下面。 */
  private labelY0() { const fit = this.fit!; return WR.y + (this.msg ? 0 : 10) + fit.size * 0.92; }

  // ---------------------------------------------------------------- 顯示幕
  private drawVfd(t: number) {
    const { lyrics, song } = this.ctx;
    const V = this.VFD, VT = this.VT;
    const L = this.vfd, c = L.ctx;
    const ly = lyricAt(lyrics, t);
    const counter = String(Math.floor((t * this.speed) / 60) % 10000).padStart(4, '0');
    let lyKey = 'idle';
    const sub = ly ? lyricSubOf(ly.line) : null;
    const state = (w: Word) => { const p = Lyrics.wordProgress(w, t); return p <= 0 ? 0 : p < 1 ? 1 : 2; };
    if (ly) lyKey = `${ly.line.i}|${Math.round(ly.k * 16)}|${ly.line.words.map(state).join('')}${sub ? '|' + sub.words.map(state).join('') : ''}`;
    const key = `${lyKey}|${counter}`;
    if (key === this.vfdKey) return;
    this.vfdKey = key;
    L.clear();
    // 顯示幕的玻璃與細框（跟字畫在同一張圖層：錄音帶的圖層要能單獨滑進來）
    c.beginPath(); c.roundRect(1, 1, V.w - 2, V.h - 2, 14); c.fillStyle = mixRgba('ink', 'ink2', 0.4); c.fill();
    c.strokeStyle = rgba('graphite', 0.7); c.lineWidth = 1.2; c.stroke();
    const gv = c.createLinearGradient(0, 0, 0, V.h * 0.5);
    gv.addColorStop(0, 'rgba(255,255,255,0.05)'); gv.addColorStop(1, 'rgba(255,255,255,0)');
    c.beginPath(); c.roundRect(5, 5, V.w - 10, V.h * 0.5, 10); c.fillStyle = gv; c.fill();
    c.textBaseline = 'alphabetic';
    const ox = -V.x, oy = -V.y;
    if (ly) {
      // 歌詞 40～52（有留言時比留言小）
      const top = lyricV2(this.msg ? this.msgPx : null);
      // 原文副行：顯示幕高度固定，有原文時中文讓出下面一排（基線距離 + 小一號的字高），中文＋原文一起置中
      const reserve = sub ? top * 0.37 + subSizeFor(top) * 1.1 : 0;
      const lay = layoutWordRows(c, ly.line, F_LYR, VT.w, VT.h - reserve, { min: V2.lyrMin, max: top, maxRows: 2, lh: 1.06 });
      const sl = sub ? layoutLyric(c, sub, subStyleFor({ family: F_LYR, size: lay.size, maxWidth: VT.w, align: 'left' }, lay.size)) : null;
      let dy = 0, sy = 0;
      if (sl) {
        const top0 = (VT.h - reserve - lay.height) / 2;
        sy = top0 + lay.size * 0.86 + (lay.rows.length - 1) * lay.lineH + subGap(lay.size, sl.size);
        dy = (VT.h - (sy + sl.height - sl.size * 0.78 - top0)) / 2 - top0;
      }
      c.save();
      c.translate(VT.x + ox, VT.y + oy + dy);
      c.font = font(F_LYR, lay.size);
      for (const b of lay.words) {
        const p = Lyrics.wordProgress(b.word, t);
        c.globalAlpha = ly.k;
        c.fillStyle = b.word.w === '♥' ? rgba('rose', p > 0 ? 1 : 0.3) : p <= 0 ? rgba('signal', 0.2) : p < 1 ? rgba('signal') : rgba('bone', 0.95);
        // 靠左對齊（layoutWordRows 是置中排的，減掉這一列左邊的空）
        c.fillText(b.word.w, b.x - (VT.w - lay.rows[b.row]!.w) / 2, b.y);
      }
      if (sl) {
        // 同一片螢光管、同樣一個字一個字整個亮起來（不用訊號色、淡兩成：跟中文不搶）；逐字時間是原文自己的
        c.font = font(F_LYR, sl.size);
        for (const pw of sl.words) {
          const p = Lyrics.wordProgress(pw.word, t);
          c.globalAlpha = ly.k * (p > 0 ? 0.8 : 1);
          c.fillStyle = p <= 0 ? rgba('signal', 0.2) : rgba('bone', 0.95);
          c.fillText(pw.word.w, pw.x, sy + pw.y);
        }
      }
      c.restore();
    } else {
      c.font = font(F.mono(500), 26); c.letterSpacing = '6px'; c.fillStyle = rgba('signal', 0.3);
      c.fillText(`${song.title || 'SIDE A'}`.toUpperCase().slice(0, 28), VT.x + ox, VT.y + oy + VT.h * 0.62);
      c.letterSpacing = '0px';
    }
    // 右邊：一個小小的磁帶計數器
    c.font = font(F.mono(500), 22); c.letterSpacing = '5px'; c.fillStyle = rgba('signal', 0.55);
    c.textAlign = 'right';
    c.fillText(counter, V.w - 28, V.h - 22);
    c.textAlign = 'left'; c.letterSpacing = '0px';
    // 螢光管的細網格
    c.fillStyle = 'rgba(0,0,0,0.35)';
    for (let y = 10; y < V.h - 10; y += 4) c.fillRect(10, y, V.w - 20, 1);
    L.upload();
  }

  // ---------------------------------------------------------------- 捲軸
  private drawReels(t: number) {
    const R = this.reels, au = this.ctx.audio;
    R.clear();
    const p = clamp(t / Math.max(1, au.duration));
    const rTake = Math.sqrt(HUB_R * HUB_R + p * (PACK_MAX * PACK_MAX - HUB_R * HUB_R));
    const rSup = Math.sqrt(PACK_MAX * PACK_MAX - p * (PACK_MAX * PACK_MAX - HUB_R * HUB_R));
    const flutter = 0.03 * this.ctx.audio.hit('kick', t, 0.08);
    const tapeCol: [number, number, number] = [LIN.sepia[0] * 0.55 + LIN.blood[0] * 0.25, LIN.sepia[1] * 0.55 + LIN.blood[1] * 0.25, LIN.sepia[2] * 0.55 + LIN.blood[2] * 0.25];
    for (const [side, rPack] of [[-1, rSup], [1, rTake]] as const) {
      const cx = CW / 2 + side * HUB_DX, cy = HUB_Y;
      const ang = (t * this.speed) / rPack + flutter + side * 0.7;
      for (let r = HUB_R + 3; r < rPack; r += 2.2) {
        const k = 0.85 + 0.15 * hash(Math.floor(r * 3), side + 5);
        const edge = r > rPack - 6 ? 1.6 : 1;
        this.circle(cx, cy, r, 2.6, [tapeCol[0] * k * edge, tapeCol[1] * k * edge, tapeCol[2] * k * edge], 72, ang * 0.02);
      }
      for (let r = HUB_R + 6; r < rPack - 2; r += 3) this.arc(cx, cy, r, -2.3, -1.9, 2.4, [LIN.bone[0] * 0.07, LIN.bone[1] * 0.07, LIN.bone[2] * 0.07]);
      this.circle(cx, cy, HUB_R, 5.5, [LIN.bone[0] * 0.7, LIN.bone[1] * 0.7, LIN.bone[2] * 0.7], 64, 0);
      this.circle(cx, cy, HUB_R - 13, 2.2, [LIN.bone[0] * 0.45, LIN.bone[1] * 0.45, LIN.bone[2] * 0.45], 48, 0);
      for (let k = 0; k < 6; k++) {
        const a = ang + (k * TAU) / 6;
        const p0 = this.toScreen(cx + Math.cos(a) * (HUB_R - 13), cy + Math.sin(a) * (HUB_R - 13));
        const p1 = this.toScreen(cx + Math.cos(a) * (HUB_R - 27), cy + Math.sin(a) * (HUB_R - 27));
        R.seg2(p0.x, p0.y, p1.x, p1.y, 6.5, [LIN.bone[0] * 0.65, LIN.bone[1] * 0.65, LIN.bone[2] * 0.65], 1);
      }
    }
    const a = this.toScreen(CW / 2 - HUB_DX, HUB_Y + rSup), b = this.toScreen(CW / 2 + HUB_DX, HUB_Y + rTake);
    R.seg2(a.x, a.y, b.x, b.y, 3.5, tapeCol, 1);
  }

  private circle(cx: number, cy: number, r: number, w: number, col: [number, number, number], n: number, a0: number) {
    let prev = this.toScreen(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
    for (let i = 1; i <= n; i++) {
      const a = a0 + (i / n) * TAU;
      const p = this.toScreen(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      this.reels.seg2(prev.x, prev.y, p.x, p.y, w, col, 1);
      prev = p;
    }
  }
  private arc(cx: number, cy: number, r: number, a0: number, a1: number, w: number, col: [number, number, number]) {
    const n = 8;
    let prev = this.toScreen(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
    for (let i = 1; i <= n; i++) {
      const a = lerp(a0, a1, i / n);
      const p = this.toScreen(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      this.glow.seg2(prev.x, prev.y, p.x, p.y, w, col, 1);
      prev = p;
    }
  }

  private blit(tex: THREE.Texture, x: number, y: number, w: number, h: number, out: THREE.WebGLRenderTarget) {
    this.ctx.comp.draw(this.ctx.renderer, tex, out, { scale: [W / w, H / h], offset: [0.5 * W / w - 0.5 - x / w, 0.5 + y / h - 0.5 * H / h] });
  }

  // ---------------------------------------------------------------- 每一格
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const kIn = prog(t, s, s + 0.4, ease.outCubic);
    this.bg.u.uIn!.value = kIn * (1 + 0.06 * f.a.kick);
    this.bg.render(renderer, out);
    // 進場：錄音帶從右邊滑進來，第一拍落定（最後一點點彈一下）
    const kc = prog(t, s, Math.max(s + 0.35, this.tBoot), ease.outExpo);
    this.dx = 1100 * (1 - kc);
    this.glow.clear();
    this.drawReels(t);
    this.reels.render(renderer, out);
    this.blit(this.shell.texture, this.dx, 0, W, H, out);
    const penL = this.drawLabel(t);
    this.blit(this.label.texture, this.LB.x + this.dx, this.LB.y, this.LB.w, this.LB.h, out);
    const pen = penL ? this.toScreen(penL.x, penL.y) : null;
    // 小節線：一道光從殼上斜斜掃過（0.9 秒）
    const lastBar = this.bars.filter((tb) => tb <= t).pop();
    const su = this.sheen.u;
    (su.uBox!.value as THREE.Vector4).set(this.CC.x + this.dx, this.CC.y, (CW / 2) * this.sc, (CH / 2) * this.sc);
    su.uRot!.value = this.CC.rot;
    if (lastBar !== undefined && t - lastBar < 0.9) { const k = ease.inOutCubic((t - lastBar) / 0.9); su.uPos!.value = -1.4 + 2.8 * k; su.uK!.value = 1 - 0.4 * k; }
    else su.uK!.value = 0;
    if ((su.uK!.value as number) > 0) this.sheen.render(renderer, out);
    this.drawVfd(t);
    this.blit(this.vfd.texture, this.VFD.x, this.VFD.y, this.VFD.w, this.VFD.h, out);
    if (pen) sparkHead(this.glow, pen.x, pen.y, t, 0.5);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：整段慢慢推近
    return { bloom: 0.62, vignette: 0.6, halation: 0.2, zoom: 1 + 0.03 * ease.inOutCubic(f.p) + 0.003 * f.a.kick };
  }
}
