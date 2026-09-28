// 錄音帶（機器 A）：一卷錄音帶的特寫（稍微歪著放在深色的桌上），上面是錄音座的螢光顯示幕（VFD）。
//  - 顯示幕：歌詞用螢光管的字（還沒唱的字是淡淡的殘影、唱到的字是訊號色、唱完是白的，
//    上面蓋一層螢光管的細網格）；右邊是磁帶計數器（跟著收帶的捲軸轉數跳）、PLAY 燈、左右聲道的音量格。
//  - 錄音帶：煙燻黑的塑膠殼、奶油色的標籤。窗裡看得到兩個捲軸：左邊放帶、右邊收帶，磁帶一圈圈捲著（細線畫的年輪），
//    轉速跟著這首歌的速度（收帶那邊越捲越大、轉得越慢），大鼓一打有一點點抖（wow & flutter）。
//  - 標籤上用簽字筆寫著主打留言：第一拍之後一個詞組一拍寫上去（筆尖是一顆小亮點），右下署名，
//    角落印著「錄音保護片已拆除：這段祝福不能被覆蓋」。沒有留言：標籤寫著邀請。
// 跟黑膠（俯視、圓、字在溝紋上）不同：這裡是平放的長方形物件，看的是捲軸的機械與標籤上的手寫字。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, prog, hash, TAU } from '../engine/util';
import { fitText, phrases, type FitResult } from '../engine/text';
import { Lyrics } from '../engine/lyrics';
import { beatAfter, signature, lyricAt, sparkHead, COUPLE_EN, DATE_DOTS } from './_motifs';
import { fillWithHearts } from '../engine/motifs';
import { layoutWordRows } from './_t7';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: false, energy: [0, 0.75], bars: [4, 8] };

// ---------------------------------------------------------------- 版面
/** 顯示幕（螢幕座標）。 */
const VFD = { x: 120, y: 104, w: 1216, h: 172 };
/** 歌詞在顯示幕裡的範圍。 */
const VT = { x: 150, y: 116, w: 930, h: 148 };
/** 錄音帶（本地座標 0..CW × 0..CH），放在螢幕上的中心與角度。 */
const CW = 1060, CH = 672;
const CC = { x: 712, y: 634, rot: -0.035 };
/** 標籤、窗、捲軸（本地座標）。 */
const LABEL = { x: 56, y: 40, w: CW - 112, h: 470 };
const WIN = { x: CW / 2 - 290, y: 282, w: 580, h: 140 };
const HUB_Y = 352, HUB_DX = 182, HUB_R = 44, PACK_MAX = 150;
/** 留言寫的地方（標籤上半部，窗的上面）。 */
const WR = { x: 104, y: 86, w: CW - 208, h: 164 };
/** 標籤圖層（本地座標的範圍）。 */
const LL = { x: LABEL.x - 20, y: LABEL.y - 20, w: LABEL.w + 40, h: LABEL.h + 40 };

const F_LYR = F.archivo(100, 700);
const F_MSG = F.hand(700);
const INVITE = '這一卷還沒錄。掃描右下角 QR code，把你的祝福錄進來。';
const NOTE = '＊錄音保護片已拆除：這段祝福不能被覆蓋。';
const TEXT = `${INVITE}${NOTE}錄音帶標籤面祝福混音《》`;

const cs = Math.cos(CC.rot), sn = Math.sin(CC.rot);
/** 錄音帶本地座標 → 螢幕。 */
const toScreen = (u: number, v: number) => ({ x: CC.x + (u - CW / 2) * cs - (v - CH / 2) * sn, y: CC.y + (u - CW / 2) * sn + (v - CH / 2) * cs });
/**
 * 標籤圖層在螢幕上的框：Compositor 只會縮放平移、不會轉，所以標籤的字直接照錄音帶的角度畫在這個（正的）框裡。
 */
const LB = (() => {
  const pts = [[LL.x, LL.y], [LL.x + LL.w, LL.y], [LL.x, LL.y + LL.h], [LL.x + LL.w, LL.y + LL.h]].map(([u, v]) => toScreen(u!, v!));
  const x = Math.floor(Math.min(...pts.map((p) => p.x))), y = Math.floor(Math.min(...pts.map((p) => p.y)));
  return { x, y, w: Math.ceil(Math.max(...pts.map((p) => p.x))) - x, h: Math.ceil(Math.max(...pts.map((p) => p.y))) - y };
})();

const BG = () => new FSPass(/* glsl */ `
  uniform float uIn;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 深色的桌面：錄音帶底下一圈暖暖的光、很淡的木紋
    float r = length((p - vec2(760.0, 600.0)) / vec2(1100.0, 700.0));
    vec3 c = C_INK + (C_INK2 - C_INK) * 1.8 * exp(-r * r * 1.5);
    c *= 0.9 + 0.1 * fbm(vec2(p.x / 900.0, p.y / 28.0), 3);
    fragColor = vec4(c * mix(0.5, 1.0, uIn), 1.0);
  }`, { uIn: { value: 1 } });

export default class Cassette extends Scene {
  bg = shared('cassette.bg', BG);
  /** 殼、標籤底、顯示幕的框：畫一次。 */
  shell = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 標籤上的手寫字（寫的時候才重畫）。 */
  label = this.track(new Layer2D(LB.w, LB.h, undefined, { fast: true }));
  /** 顯示幕的字（內容變了才重畫）。 */
  vfd = this.track(new Layer2D(VFD.w, VFD.h, undefined, { fast: true }));
  /** 捲軸：磁帶的年輪、輪轂（一般混色）；筆尖的火花（加亮）。 */
  reels = this.track(new LineBatch(9000, { screen2D: true, blend: 'normal' }));
  glow = this.track(new LineBatch(600, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  beat = 0.5;
  tBoot = 0;
  fit: FitResult | null = null;
  chunks: { line: number; from: number; to: number; t: number }[] = [];
  sigT = Infinity;
  /** 磁帶速度（px/秒，跟 BPM 走）與整首歌的進度（收帶有多大）。 */
  speed = 60;
  avoid: [number, number, number, number][] = [];
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
    const inWin = lyrics.lines.filter((l) => l.end > s - 1 && l.start < e + 1);
    await loadText(TEXT + (m ? m.text + signature(m.name) : '') + inWin.map((l) => l.text).join('') + (song.title ?? '') + (song.artist ?? ''));
    this.layoutLabel(m ? m.text : INVITE);
    this.drawShell();
    this.ctx.renderer.initTexture(this.shell.upload());
    // 即時小卡避開：顯示幕的歌詞、標籤上的字（用錄音帶的四角換算到螢幕）
    const corners = [[WR.x, WR.y], [WR.x + WR.w, WR.y], [WR.x, LABEL.y + LABEL.h], [WR.x + WR.w, LABEL.y + LABEL.h]].map(([u, v]) => toScreen(u!, v!));
    const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
    this.avoid = [
      [VT.x - 10, VT.y - 6, VT.w + 20, VT.h + 12],
      [Math.min(...xs) - 10, Math.min(...ys) - 10, Math.max(...xs) - Math.min(...xs) + 20, Math.max(...ys) - Math.min(...ys) + 20],
    ];
  }

  // ---------------------------------------------------------------- 標籤
  private layoutLabel(body: string) {
    const { audio: au } = this.ctx;
    const e = this.ctx.end;
    this.fit = fitText(this.label.ctx, body, F_MSG, WR.w, WR.h, { min: 44, max: 76, lineHeight: 1.22, maxLines: 3 });
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

  /** 標籤上的字（標籤圖層座標 = 錄音帶本地座標 - LL.xy）。回傳筆尖（本地座標），沒在寫是 null。 */
  private drawLabel(t: number): { x: number; y: number } | null {
    const fit = this.fit!, m = this.msg;
    const WRT = 0.3;
    const wp = (t0: number) => clamp((t - t0) / WRT);
    const key = `${this.chunks.map((k) => Math.round(wp(k.t) * 24)).join('')}|${Math.round(wp(this.sigT) * 24)}`;
    // 筆尖位置：正在寫的那一段的右緣
    let pen: { x: number; y: number } | null = null;
    const lines = fit.lines.map((l) => Array.from(l));
    const c = this.label.ctx;
    c.font = font(F_MSG, fit.size);
    const x0 = WR.x, y0 = WR.y + (WR.h - fit.height) / 2 + fit.size;
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
    // 本地座標（錄音帶）→ 圖層：跟錄音帶一樣轉
    c.save();
    c.translate(CC.x - LB.x, CC.y - LB.y); c.rotate(CC.rot); c.translate(-CW / 2, -CH / 2);
    c.textBaseline = 'alphabetic';
    c.fillStyle = m ? rgba('sepia') : rgba('sepia', 0.55);
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
    // 署名：窗的右下
    if (m && t >= this.sigT) {
      const r = wp(this.sigT);
      c.font = font(F.hand(700), 44);
      const sg = signature(m.name), w = c.measureText(sg).width;
      const sx = LABEL.x + LABEL.w - 40 - w, sy = WIN.y + WIN.h + 62;
      c.save(); c.beginPath(); c.rect(sx - 4, sy - 50, (w + 8) * r, 70); c.clip();
      c.fillText(sg, sx, sy);
      c.restore();
    }
    c.restore();
    L.upload();
    return pen;
  }

  // ---------------------------------------------------------------- 殼（畫一次）
  private drawShell() {
    const L = this.shell, c = L.ctx, m = this.msg, { song } = this.ctx;
    L.clear();
    const rr = (x: number, y: number, w: number, h: number, r: number) => { c.beginPath(); c.roundRect(x, y, w, h, r); };
    // ---- 顯示幕：深色玻璃、細框
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 30; c.shadowOffsetY = 12;
    rr(VFD.x, VFD.y, VFD.w, VFD.h, 16); c.fillStyle = mixRgba('ink', 'ink2', 0.5); c.fill();
    c.restore();
    rr(VFD.x, VFD.y, VFD.w, VFD.h, 16); c.strokeStyle = rgba('graphite', 0.9); c.lineWidth = 1.5; c.stroke();
    rr(VFD.x + 8, VFD.y + 8, VFD.w - 16, VFD.h - 16, 10); c.strokeStyle = rgba('bone', 0.06); c.lineWidth = 1; c.stroke();
    // ---- 錄音帶
    c.save();
    c.translate(CC.x, CC.y); c.rotate(CC.rot); c.translate(-CW / 2, -CH / 2);
    // 影子
    c.save(); c.filter = 'blur(28px)'; rr(26, 34, CW, CH, 36); c.fillStyle = 'rgba(0,0,0,0.6)'; c.fill(); c.restore();
    // 殼：煙燻黑塑膠
    rr(0, 0, CW, CH, 36);
    const g = c.createLinearGradient(0, 0, CW, CH);
    g.addColorStop(0, mixRgba('ink2', 'graphite', 0.22)); g.addColorStop(1, mixRgba('ink', 'ink2', 0.6));
    c.fillStyle = g; c.fill();
    c.strokeStyle = rgba('graphite', 0.9); c.lineWidth = 2; c.stroke();
    rr(10, 10, CW - 20, CH - 20, 28); c.strokeStyle = rgba('bone', 0.07); c.lineWidth = 1; c.stroke();
    // 下緣的磁頭區（梯形凸起）與兩個主導輪孔
    c.beginPath();
    c.moveTo(CW * 0.19, CH - 2); c.lineTo(CW * 0.25, CH - 104); c.lineTo(CW * 0.75, CH - 104); c.lineTo(CW * 0.81, CH - 2);
    c.strokeStyle = rgba('graphite', 0.95); c.lineWidth = 1.5; c.stroke();
    for (const x of [CW * 0.31, CW * 0.69]) { c.beginPath(); c.arc(x, CH - 52, 15, 0, TAU); c.fillStyle = rgba('ink'); c.fill(); c.strokeStyle = rgba('graphite'); c.stroke(); }
    for (const x of [CW * 0.42, CW * 0.5, CW * 0.58]) { rr(x - 20, CH - 70, 40, 26, 4); c.fillStyle = rgba('ink', 0.9); c.fill(); }
    // 螺絲
    for (const [x, y] of [[36, 36], [CW - 36, 36], [36, CH - 36], [CW - 36, CH - 36], [CW / 2, CH - 124]]) {
      c.beginPath(); c.arc(x!, y!, 11, 0, TAU); c.fillStyle = rgba('graphite', 0.7); c.fill();
      c.strokeStyle = rgba('ink', 0.9); c.lineWidth = 2; c.beginPath(); c.moveTo(x! - 6, y! - 6); c.lineTo(x! + 6, y! + 6); c.moveTo(x! + 6, y! - 6); c.lineTo(x! - 6, y! + 6); c.stroke();
    }
    // 標籤：奶油色的紙，上面一條訊號色的帶子
    // （暗的版面上，紙色壓暗一點點，不要變成一塊刺眼的白板）
    rr(LABEL.x, LABEL.y, LABEL.w, LABEL.h, 12); c.fillStyle = mixRgba('paper', 'ash', 0.16); c.fill();
    c.fillStyle = rgba('signal', 0.85); c.fillRect(LABEL.x, WIN.y - 16, LABEL.w, 6);
    c.fillStyle = rgba('sepia', 0.9); c.fillRect(LABEL.x, WIN.y + WIN.h + 16, LABEL.w, 2);
    // 標籤上的格線（寫字的地方）
    c.fillStyle = rgba('sepia', 0.14);
    const fit = this.fit!;
    const y0 = WR.y + (WR.h - fit.height) / 2 + fit.size;
    for (let i = 0; i < fit.lines.length; i++) c.fillRect(WR.x - 20, y0 + i * fit.lineHeight + 10, WR.w + 40, 1);
    // 側標「A」
    c.beginPath(); c.arc(LABEL.x + 34, LABEL.y + 30, 18, 0, TAU); c.strokeStyle = rgba('sepia', 0.85); c.lineWidth = 2; c.stroke();
    c.fillStyle = rgba('sepia'); c.font = font(F.archivo(100, 900), 22); c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('A', LABEL.x + 34, LABEL.y + 32);
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    c.font = font(F.mono(500), 14); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.75);
    c.fillText(`LOVE MIX  ·  C-∞  ·  ${DATE_DOTS}`, LABEL.x + 64, LABEL.y + 36);
    c.textAlign = 'right';
    c.fillText(m ? `No.${String(m.n).padStart(3, '0')}` : 'BLANK', LABEL.x + LABEL.w - 24, LABEL.y + 36);
    c.textAlign = 'left';
    // 窗的下面：這首歌、冷面註腳
    c.font = font(F.hei(500), 17); c.letterSpacing = '2px'; c.fillStyle = rgba('sepia', 0.8);
    const below = WIN.y + WIN.h + 42;
    c.fillText(`${song.title ? `《${song.title}》` : ''}${song.artist ? ` ${song.artist}` : ''}`.trim() || COUPLE_EN, LABEL.x + 30, below);
    c.font = font(F.hei(500), 15); c.fillStyle = rgba('sepia', 0.6);
    c.fillText(NOTE, LABEL.x + 30, LABEL.y + LABEL.h - 14);
    c.letterSpacing = '0px';
    // 窗：挖空（捲軸從下面露出來），蓋一層很淡的玻璃與一道斜的反光
    c.save();
    rr(WIN.x, WIN.y, WIN.w, WIN.h, 22); c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000'; c.fill();
    c.restore();
    c.save();
    rr(WIN.x, WIN.y, WIN.w, WIN.h, 22); c.clip();
    c.fillStyle = rgba('bone', 0.03); c.fillRect(WIN.x, WIN.y, WIN.w, WIN.h);
    const gl = c.createLinearGradient(WIN.x, WIN.y, WIN.x + 200, WIN.y + WIN.h);
    gl.addColorStop(0, 'rgba(255,255,255,0)'); gl.addColorStop(0.5, 'rgba(255,255,255,0.07)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = gl; c.fillRect(WIN.x + 60, WIN.y, 220, WIN.h);
    c.restore();
    rr(WIN.x, WIN.y, WIN.w, WIN.h, 22); c.strokeStyle = rgba('sepia', 0.9); c.lineWidth = 2; c.stroke();
    c.restore();
  }

  // ---------------------------------------------------------------- 顯示幕
  private drawVfd(t: number) {
    const { lyrics, song } = this.ctx;
    const L = this.vfd, c = L.ctx;
    const ly = lyricAt(lyrics, t);
    // 計數器：收帶捲軸的轉數（每秒跳好幾下）；PLAY 燈與聲道音量每格都會變，所以這塊每格重畫（很小）
    const counter = String(Math.floor((t * this.speed) / 60) % 10000).padStart(4, '0');
    const lv = this.ctx.audio.sample(t);
    const bars = [Math.round(clamp(lv.low * 0.6 + lv.rms * 0.8) * 12), Math.round(clamp(lv.mid * 0.6 + lv.rms * 0.8) * 12)];
    let lyKey = 'idle';
    if (ly) lyKey = `${ly.line.i}|${Math.round(ly.k * 16)}|${ly.line.words.map((w) => { const p = Lyrics.wordProgress(w, t); return p <= 0 ? 0 : p < 1 ? 1 : 2; }).join('')}`;
    const key = `${lyKey}|${counter}|${bars.join(',')}|${Math.floor(t * 2) % 2}`;
    if (key === this.vfdKey) return;
    this.vfdKey = key;
    L.clear();
    c.textBaseline = 'alphabetic';
    const ox = -VFD.x, oy = -VFD.y;
    // 歌詞
    if (ly) {
      const lay = layoutWordRows(c, ly.line, F_LYR, VT.w, VT.h, { min: 48, max: 78, maxRows: 2, lh: 1.08 });
      c.save();
      c.translate(VT.x + ox, VT.y + oy);
      c.font = font(F_LYR, lay.size);
      for (const b of lay.words) {
        const p = Lyrics.wordProgress(b.word, t);
        // 還沒唱：螢光管沒點亮的殘影（訊號色、很淡）
        c.globalAlpha = ly.k;
        c.fillStyle = b.word.w === '♥' ? rgba('rose', p > 0 ? 1 : 0.3) : p <= 0 ? rgba('signal', 0.2) : p < 1 ? rgba('signal') : rgba('bone', 0.95);
        // 靠左對齊（layoutWordRows 是置中排的，減掉這一列左邊的空）
        c.fillText(b.word.w, b.x - (VT.w - lay.rows[b.row]!.w) / 2, b.y);
      }
      c.restore();
    } else {
      c.font = font(F.mono(500), 30); c.letterSpacing = '6px'; c.fillStyle = rgba('signal', 0.3);
      c.fillText(`${song.title || 'SIDE A'}`.toUpperCase().slice(0, 28), VT.x + ox, VT.y + oy + 88);
      c.letterSpacing = '0px';
    }
    // 右邊：計數器、PLAY、音量格
    const rx = 1110 + ox;
    c.font = font(F.mono(500), 13); c.letterSpacing = '3px'; c.fillStyle = rgba('signal', 0.5);
    c.fillText('COUNTER', rx, VFD.y + 36 + oy);
    c.font = font(F.mono(500), 44); c.letterSpacing = '6px'; c.fillStyle = rgba('signal', 0.95);
    c.fillText(counter, rx, VFD.y + 84 + oy);
    c.font = font(F.mono(500), 15); c.letterSpacing = '3px';
    c.fillStyle = rgba('signal', Math.floor(t * 2) % 2 ? 0.95 : 0.5);
    c.fillText('▶ PLAY', rx, VFD.y + 114 + oy);
    c.fillStyle = rgba('signal', 0.5);
    c.fillText('A', rx + 150, VFD.y + 114 + oy);
    c.letterSpacing = '0px';
    for (let ch = 0; ch < 2; ch++) {
      const y = VFD.y + 132 + ch * 14 + oy;
      c.font = font(F.mono(500), 11); c.fillStyle = rgba('signal', 0.5);
      c.fillText(ch ? 'R' : 'L', rx, y + 9);
      for (let i = 0; i < 12; i++) {
        c.fillStyle = rgba(i >= 10 ? 'ember' : 'signal', i < bars[ch]! ? 0.9 : 0.12);
        c.fillRect(rx + 18 + i * 14, y, 10, 9);
      }
    }
    // 螢光管的細網格
    c.fillStyle = 'rgba(0,0,0,0.35)';
    for (let y = 12; y < VFD.h - 12; y += 4) c.fillRect(12, y, VFD.w - 24, 1);
    L.upload();
  }

  // ---------------------------------------------------------------- 捲軸
  private drawReels(t: number) {
    const R = this.reels, au = this.ctx.audio;
    R.clear();
    // 收帶有多大：整首歌的進度（放帶那邊相反）
    const p = clamp(t / Math.max(1, au.duration));
    const rTake = Math.sqrt(HUB_R * HUB_R + p * (PACK_MAX * PACK_MAX - HUB_R * HUB_R));
    const rSup = Math.sqrt(PACK_MAX * PACK_MAX - p * (PACK_MAX * PACK_MAX - HUB_R * HUB_R));
    const flutter = 0.03 * this.ctx.audio.hit('kick', t, 0.08);
    const tapeCol: [number, number, number] = [LIN.sepia[0] * 0.55 + LIN.blood[0] * 0.25, LIN.sepia[1] * 0.55 + LIN.blood[1] * 0.25, LIN.sepia[2] * 0.55 + LIN.blood[2] * 0.25];
    for (const [side, rPack] of [[-1, rSup], [1, rTake]] as const) {
      const cx = CW / 2 + side * HUB_DX, cy = HUB_Y;
      // 轉角：磁帶等速走，捲得越大轉得越慢
      const ang = (t * this.speed) / rPack + flutter + side * 0.7;
      // 磁帶的年輪：一圈一圈的細線（外圈亮一點，像磁帶邊緣反光）
      for (let r = HUB_R + 3; r < rPack; r += 2.2) {
        const k = 0.85 + 0.15 * hash(Math.floor(r * 3), side + 5);
        const edge = r > rPack - 6 ? 1.6 : 1;
        const col: [number, number, number] = [tapeCol[0] * k * edge, tapeCol[1] * k * edge, tapeCol[2] * k * edge];
        this.circle(cx, cy, r, 2.4, col, 72, ang * 0.02);
      }
      // 反光：捲軸上一道斜的亮帶（不跟著轉，是燈的反射）
      for (let r = HUB_R + 6; r < rPack - 2; r += 3) {
        const a0 = -2.3, a1 = -1.9;
        this.arc(cx, cy, r, a0, a1, 2, [LIN.bone[0] * 0.08, LIN.bone[1] * 0.08, LIN.bone[2] * 0.08]);
      }
      // 輪轂：白色的圈、六個齒（跟著轉）
      this.circle(cx, cy, HUB_R, 5, [LIN.bone[0] * 0.75, LIN.bone[1] * 0.75, LIN.bone[2] * 0.75], 64, 0);
      this.circle(cx, cy, HUB_R - 14, 2, [LIN.bone[0] * 0.5, LIN.bone[1] * 0.5, LIN.bone[2] * 0.5], 48, 0);
      for (let k = 0; k < 6; k++) {
        const a = ang + (k * TAU) / 6;
        const p0 = this.local(cx + Math.cos(a) * (HUB_R - 14), cy + Math.sin(a) * (HUB_R - 14));
        const p1 = this.local(cx + Math.cos(a) * (HUB_R - 30), cy + Math.sin(a) * (HUB_R - 30));
        R.seg2(p0.x, p0.y, p1.x, p1.y, 6, [LIN.bone[0] * 0.7, LIN.bone[1] * 0.7, LIN.bone[2] * 0.7], 1);
      }
    }
    // 兩個捲軸之間的磁帶（窗的下緣看得到的那一段）
    const a = this.local(CW / 2 - HUB_DX, HUB_Y + rSup), b = this.local(CW / 2 + HUB_DX, HUB_Y + rTake);
    R.seg2(a.x, a.y, b.x, b.y, 3, tapeCol, 1);
  }

  private local(u: number, v: number) { return toScreen(u, v); }
  private circle(cx: number, cy: number, r: number, w: number, col: [number, number, number], n: number, a0: number) {
    let prev = this.local(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
    for (let i = 1; i <= n; i++) {
      const a = a0 + (i / n) * TAU;
      const p = this.local(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      this.reels.seg2(prev.x, prev.y, p.x, p.y, w, col, 1);
      prev = p;
    }
  }
  private arc(cx: number, cy: number, r: number, a0: number, a1: number, w: number, col: [number, number, number]) {
    const n = 8;
    let prev = this.local(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
    for (let i = 1; i <= n; i++) {
      const a = lerp(a0, a1, i / n);
      const p = this.local(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      this.glow.seg2(prev.x, prev.y, p.x, p.y, w, col, 1);
      prev = p;
    }
  }

  private blit(tex: THREE.Texture, x: number, y: number, w: number, h: number, out: THREE.WebGLRenderTarget, o: { mode?: 'normal' | 'add'; tint?: [number, number, number]; opacity?: number } = {}) {
    this.ctx.comp.draw(this.ctx.renderer, tex, out, { ...o, scale: [W / w, H / h], offset: [0.5 * W / w - 0.5 - x / w, 0.5 + y / h - 0.5 * H / h] });
  }

  // ---------------------------------------------------------------- 每一格
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const kIn = prog(t, s, s + 0.4, ease.outCubic);
    this.bg.u.uIn!.value = kIn;
    this.bg.render(renderer, out);
    this.glow.clear();
    this.drawReels(t);
    this.reels.render(renderer, out);
    comp.draw(renderer, this.shell.texture, out);
    // 標籤上的字（圖層本身已經照錄音帶的角度畫好）
    const penL = this.drawLabel(t);
    this.blit(this.label.texture, LB.x, LB.y, LB.w, LB.h, out);
    const pen = penL ? toScreen(penL.x, penL.y) : null;
    this.drawVfd(t);
    // （紙白的字不發光：只有訊號色的字夠亮會被 bloom 帶出一點光，螢光管的感覺靠殘影與網格）
    this.blit(this.vfd.texture, VFD.x, VFD.y, VFD.w, VFD.h, out);
    if (pen) sparkHead(this.glow, pen.x, pen.y, t, 0.5);
    if (this.glow.count) this.glow.render(renderer, out);
    return { bloom: 0.72, vignette: 0.5, halation: 0.22, zoom: 1 + 0.004 * f.a.kick, popupAvoid: this.avoid };
  }

}

