// 等化器（機器 A）：暗的舞台上一整面 LED 光柱（shader），跟著這首歌的頻譜跳，底下亮面地板有倒影；鏡頭整段慢慢推近。
// 照「留言尺寸與版面比例標準 v2」：場景（光柱）是主視覺，留言在右邊一側、字級 40～60。
//  - 留言：手寫字（霞鶩文楷）浮在光柱右邊的暗處，一行一拍從右邊滑進來（跑馬燈的感覺，落在拍點上），最後一行下面署名。
//    有留言時光柱暗一點，最亮的是字。
//  - 光柱的高度來自這首歌的音訊包絡（低音、大鼓、人聲、高音…分到 24 個頻段），大鼓打低頻、小鼓打中頻、鈸打高頻；
//    每根柱子頂上有一格「峰值」慢慢掉下來。
//  - 歌詞一個字（英文一個字）一個字「站」在光柱上方（40～52，比留言小）：字的高度跟著它底下那幾根柱子起伏，
//    唱到的字跳起來、亮成訊號色，底下的柱子也整根變熱，柱子不會長到字上面（讀得清楚）。
//  - 多補的動畫：兩道舞台燈的光束慢慢擺（大鼓一打亮一下）、光束裡飄著灰塵；每個小節線一道光從左到右掃過整面光柱。
//  - 沒有留言：光柱變寬（還是避開右下角的 QR 區），右上角一行小小的邀請。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, noise1, fbm1 } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { Lyrics, type Line } from '../engine/lyrics';
import { beatAfter, barAfter, signature, lyricAt, lyricSubOf, drawLyricSub, layoutLyric, subGap, subStyleFor, COUPLE_ZH, type LyricStyle } from './_motifs';
import { fillWithHearts } from '../engine/motifs';
import { layoutWordRows, windowLines } from './_t7';
import { msgMaxFor, lyricV2, sigV2, fitClauses, V2 } from './_v2';
import { FRAG_EQ, NCOL, NSEG } from './equalizer-glsl';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'machine', paper: false, energy: [0.5, 1], bars: [4, 8] };

// ---------------------------------------------------------------- 版面
/** 留言區：光柱右邊（寬 ≤ 860、高 ≤ 430；下面一列署名）。 */
const MSG = { x: 1236, y: 170, w: 548, h: 380 };
const SIG_GAP = 16;
/** 光柱：有留言時窄一點（右邊讓給留言）；沒有留言時寬一點。右端都停在 x 1360 左邊（下面是右下角的 QR）。 */
const EQ_MSG = { x: 130, bottom: 860, pitch: 44, w: 38 };
const EQ_WIDE = { x: 150, bottom: 860, pitch: 50, w: 44 };
const SEG = { pitch: 24, h: 18 };
const EQH = NSEG * SEG.pitch;
/** 歌詞這一列的基線（光柱上方），每個字再跟著底下的柱子上下浮動一點點。 */
const ROW_Y = 360, RIDE = 18;
/** 歌詞圖層（光柱上方到地板）。 */
const WL = { x: 100, y: 250, w: 1300, h: 660 };

const F_LYR = F.archivo(100, 800);
const F_MSG = F.hand(700);
const INVITE = '掃描右下角 QR code，你的祝福就會在這裡跑過去';

const BG = () => new FSPass(FRAG_EQ, {
  uLvl: { value: new Array(NCOL).fill(0) }, uPeak: { value: new Array(NCOL).fill(0) }, uHot: { value: new Array(NCOL).fill(0) }, uCap: { value: new Array(NCOL).fill(1) },
  uEq: { value: new THREE.Vector4() }, uSeg: { value: new THREE.Vector2(SEG.pitch, SEG.h) },
  uGlow: { value: new THREE.Vector4(1500, 330, 520, 260) }, uBeam: { value: new THREE.Vector4() }, uSweep: { value: new THREE.Vector2(-999, 0) },
  uGain: { value: 1 }, uIn: { value: 1 },
});

/** 每個頻段的中心（0..1，低到高）與它用哪一條包絡。 */
const BANDS: [number, string][] = [[0.04, 'bass'], [0.12, 'low'], [0.26, 'drums'], [0.42, 'mid'], [0.55, 'vocal'], [0.7, 'other'], [0.9, 'high']];

export default class Equalizer extends Scene {
  bg = shared('equalizer.bg', BG);
  /** 站在光柱上的歌詞（每格都在動，每格重畫；只有光柱上方那一塊）。 */
  words = this.track(new Layer2D(WL.w, WL.h, undefined, { fast: true }));
  /** 留言（滑進來的時候才重畫）。 */
  disp = this.track(new Layer2D(MSG.w + 40, MSG.h + 80, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  EQ = { ...EQ_MSG };
  fit: FitResult | null = null;
  sigSize = 30;
  lineT: number[] = [];
  sigT = Infinity;
  beat = 0.5;
  tBoot = 0;
  lyrMax: number = V2.lyrMax;
  bars: number[] = [];
  /** 太長、一列放不下的歌詞拆成兩頁（每頁是一個只含部分字的 Line，排版結果會快取）。 */
  pages = new Map<Line, Line[]>();
  private dispKey = '';

  override async init() {
    const { audio: au, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    this.beat = au.beatPeriod(s + 0.1);
    this.tBoot = beatAfter(au, s + 0.15);
    const m = this.msg;
    const body = m ? m.text : INVITE;
    const lines = windowLines(lyrics, s, e);
    this.EQ = { ...(m ? EQ_MSG : EQ_WIDE) };
    await loadText(INVITE + body + (m ? signature(m.name) : '') + lines.map((l) => l.text).join('') + COUPLE_ZH);
    const dc = this.disp.ctx;
    // 留言：依字數決定字級上限，照子句斷行（放不下再交給 fitText）；下面留署名的空間
    if (m) {
      const max = msgMaxFor(body), sig = sigV2(max);
      const o = { min: V2.msgMin, max, lineHeight: 1.28, maxLines: 8 };
      this.fit = fitClauses(dc, body, F_MSG, MSG.w, MSG.h - sig - SIG_GAP, o) ?? fitText(dc, body, F_MSG, MSG.w, MSG.h - sig - SIG_GAP, o);
      this.sigSize = sigV2(this.fit.size);
    } else {
      this.fit = fitText(dc, body, F_MSG, MSG.w, 120, { min: 30, max: 34, lineHeight: 1.3, maxLines: 2 });
    }
    this.lyrMax = lyricV2(m ? this.fit.size : null);
    const maxW = this.lyrW();
    const c = this.words.ctx;
    for (const l of lines) {
      const lay = layoutWordRows(c, l, F_LYR, maxW, 120, { min: V2.lyrMin, max: this.lyrMax, maxRows: 1 });
      if ((lay.rows[0]?.w ?? 0) <= maxW + 1 || l.words.length < 2) continue;
      // 一列放不下：拆兩頁，在中間附近斷
      const half = Math.ceil(l.words.length / 2);
      this.pages.set(l, [{ ...l, words: l.words.slice(0, half) }, { ...l, words: l.words.slice(half) }]);
    }
    const t0 = beatAfter(au, this.tBoot + 0.2);
    this.lineT = this.fit.lines.map((_, i) => t0 + i * this.beat);
    if (m) this.sigT = t0 + this.fit.lines.length * this.beat;
    for (let k = 0; ; k++) { const tb = barAfter(au, s + 0.05, k); if (tb > e) break; this.bars.push(tb); }
    const u = this.bg.u;
    (u.uEq!.value as THREE.Vector4).set(this.EQ.x, this.EQ.bottom, this.EQ.pitch, this.EQ.w);
    (u.uGlow!.value as THREE.Vector4).set(MSG.x + MSG.w * 0.45, MSG.y + MSG.h * 0.45, 560, 300);
    u.uGain!.value = m ? 0.62 : 0.9;
  }

  /** 歌詞可以用的寬度（光柱的寬度）。 */
  private lyrW() { return (NCOL - 1) * this.EQ.pitch + this.EQ.w; }

  // ---------------------------------------------------------------- 頻譜
  /** 第 i 根柱子在 t 時的原始高度（0..1）。 */
  private raw(i: number, t: number) {
    const au = this.ctx.audio;
    const f = i / (NCOL - 1);
    let sum = 0, wsum = 0;
    for (const [cx, name] of BANDS) {
      const w = Math.exp(-((f - cx) * (f - cx)) / 0.012);
      sum += w * au.env(name, t); wsum += w;
    }
    let v = sum / Math.max(1e-4, wsum);
    v = 0.05 + 0.78 * Math.pow(clamp(v), 1.05);
    v += 0.09 * noise1(t * 6.5 + i * 1.7, i);
    v += 0.32 * au.hit('kick', t, 0.1) * clamp(1 - f * 3.2);
    v += 0.26 * au.hit('snare', t, 0.12) * Math.exp(-((f - 0.45) ** 2) / 0.02);
    v += 0.22 * au.hit('hat', t, 0.06) * clamp((f - 0.7) * 4);
    return clamp(v * (0.85 + 0.25 * au.env('rms', t)));
  }
  /** 平滑過的高度（往回取幾個樣本加權，不要逐格亂跳；是 t 的純函數）。 */
  private level(i: number, t: number) {
    let s = 0, w = 0;
    for (let k = 0; k < 6; k++) { const wk = Math.pow(0.6, k); s += this.raw(i, t - k * 0.022) * wk; w += wk; }
    return s / w;
  }
  /** 峰值：過去 0.8 秒裡最高的一格，像有重力一樣慢慢掉下來。 */
  private peak(i: number, t: number, now: number) {
    let pk = now;
    for (let k = 1; k <= 16; k++) { const tau = k * 0.05; pk = Math.max(pk, this.raw(i, t - tau) - 1.8 * tau * tau); }
    return pk;
  }

  // ---------------------------------------------------------------- 留言
  private drawMessage(t: number) {
    const fit = this.fit!, m = this.msg;
    const slides = this.lineT.map((t0) => prog(t, t0 - 0.42, t0, ease.outExpo));
    const sig = prog(t, this.sigT - 0.3, this.sigT + 0.2, ease.outCubic);
    const key = `${slides.map((x) => Math.round(x * 60)).join(',')}|${Math.round(sig * 20)}`;
    if (key === this.dispKey) return;
    this.dispKey = key;
    const L = this.disp, c = L.ctx;
    L.clear();
    c.textBaseline = 'alphabetic';
    c.font = font(F_MSG, fit.size);
    const top = fit.size * 0.92;
    fit.lines.forEach((ln, i) => {
      const k = slides[i]!;
      if (k <= 0) return;
      // 從右邊滑進來、停在左邊
      const x = (1 - k) * (MSG.w + 60);
      c.fillStyle = m ? rgba('bone', 0.96) : rgba('ash', 0.7);
      fillWithHearts(c, ln, x, top + i * fit.lineHeight, rgba('rose'));
    });
    if (m && sig > 0) {
      // 署名：最後一行下面、靠右（永遠不會跟留言重疊：排版時已經扣掉這一列）
      c.globalAlpha = sig;
      c.font = font(F.hand(700), this.sigSize);
      c.textAlign = 'right';
      c.fillStyle = rgba('ash');
      const sy = top + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.28 + SIG_GAP + this.sigSize;
      c.fillText(signature(m.couple ? COUPLE_ZH : m.name), MSG.w - 6 + (1 - sig) * 40, sy);
      c.textAlign = 'left';
      c.globalAlpha = 1;
    }
    L.upload();
  }

  // ---------------------------------------------------------------- 站在光柱上的字
  private drawWords(t: number, lv: number[], hot: number[], cap: number[]) {
    const { lyrics } = this.ctx;
    const L = this.words, c = L.ctx, EQ = this.EQ;
    L.clear();
    c.textBaseline = 'alphabetic';
    const ly = lyricAt(lyrics, t);
    if (!ly) { L.upload(); return; }
    let line = ly.line;
    const pg = this.pages.get(line);
    if (pg) line = pg[1]!.words[0]!.start - 0.3 <= t ? pg[1]! : pg[0]!;
    const maxW = this.lyrW();
    const lay = layoutWordRows(c, line, F_LYR, maxW, 120, { min: V2.lyrMin, max: this.lyrMax, maxRows: 1 });
    c.font = font(F_LYR, lay.size);
    const x0 = EQ.x;
    for (const b of lay.words) {
      const wx0 = x0 + b.x, wx1 = wx0 + b.w;
      const i0 = clamp(Math.floor((wx0 - EQ.x) / EQ.pitch), 0, NCOL - 1), i1 = clamp(Math.floor((wx1 - EQ.x) / EQ.pitch), 0, NCOL - 1);
      let top = 0;
      for (let i = i0; i <= i1; i++) top = Math.max(top, lv[i]!);
      const p = Lyrics.wordProgress(b.word, t);
      const jump = t >= b.word.start ? 26 * Math.exp(-(t - b.word.start) / 0.16) * Math.min(1, (t - b.word.start) / 0.04) : 0;
      if (p > 0 && p < 1) for (let i = i0; i <= i1; i++) hot[i] = 1;
      // 字的基線：整列在同一個高度附近，跟著底下的柱子浮動一點點；唱到的時候跳起來
      const y = ROW_Y - RIDE * (top - 0.45) * 2 - jump;
      // 字底下的柱子被字壓住：最高只到字的下緣
      const c2 = (EQ.bottom - (y + lay.size * 0.2 + 12)) / EQH;
      for (let i = i0; i <= i1; i++) cap[i] = Math.min(cap[i]!, c2);
      c.globalAlpha = ly.k;
      c.fillStyle = b.word.w === '♥' ? rgba('rose') : p <= 0 ? rgba('bone', 0.3) : p < 1 ? rgba('signal') : rgba('bone', 0.95);
      c.fillText(b.word.w, wx0 - WL.x, y - WL.y);
    }
    c.globalAlpha = 1;
    // 韓文歌：原文小一號排成一列，站在中文底下、跟中文一樣在光柱上方置中（中文跟著柱子浮動、跳起來，
    // 原文比較安靜：整列不動）。基線放在中文浮到最低時的下面；原文底下的柱子也被它壓住，長不到字上面
    const sub = lyricSubOf(ly.line);
    if (sub) {
      const st: LyricStyle = { family: F_LYR, size: lay.size, maxWidth: maxW, align: 'center', active: rgba('signal'), sung: rgba('bone', 0.95), unsung: rgba('bone', 0.3) };
      const sl = layoutLyric(c, sub, subStyleFor(st, lay.size));
      const ys = ROW_Y + RIDE * 0.9 + subGap(lay.size, sl.size), cx = x0 + maxW / 2;
      const c2 = (EQ.bottom - (ys + sl.height - sl.size + sl.size * 0.25 + 12)) / EQH;
      const hw = sl.rows.reduce((w, r) => Math.max(w, r.width), 0) / 2;
      const i0 = clamp(Math.floor((cx - hw - EQ.x) / EQ.pitch), 0, NCOL - 1), i1 = clamp(Math.floor((cx + hw - EQ.x) / EQ.pitch), 0, NCOL - 1);
      for (let i = i0; i <= i1; i++) cap[i] = Math.min(cap[i]!, c2);
      c.save();
      c.translate(cx - WL.x, ys - WL.y);
      drawLyricSub(c, sub, t, st, lay.size, ly.k);
      c.restore();
    }
    L.upload();
  }

  private blit(tex: THREE.Texture, x: number, y: number, w: number, h: number, out: THREE.WebGLRenderTarget) {
    this.ctx.comp.draw(this.ctx.renderer, tex, out, { scale: [W / w, H / h], offset: [0.5 * W / w - 0.5 - x / w, 0.5 + y / h - 0.5 * H / h] });
  }

  // ---------------------------------------------------------------- 每一格
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start;
    // 開場：光柱從左到右一根一根升上來
    const u = this.bg.u;
    const lv = u.uLvl!.value as number[], pk = u.uPeak!.value as number[], hot = u.uHot!.value as number[], cap = u.uCap!.value as number[];
    for (let i = 0; i < NCOL; i++) {
      const rise = ease.outCubic(prog(t, s + i * 0.012, s + 0.35 + i * 0.012));
      const l = this.level(i, t) * rise;
      lv[i] = l;
      pk[i] = Math.max(l, this.peak(i, t, l) * rise);
      hot[i] = 0;
      cap[i] = 1;
    }
    this.drawWords(t, lv, hot, cap);
    // 舞台燈：兩道光束很慢地擺（兩道方向相反），大鼓一打亮一下；灰塵往上飄
    (u.uBeam!.value as THREE.Vector4).set(0.28 + 0.16 * fbm1(t * 0.18, 2, 3), -0.3 - 0.16 * fbm1(t * 0.18 + 40, 2, 5), f.a.kick, t);
    // 小節線：一道光從左到右掃過光柱（0.7 秒）
    const lastBar = this.bars.filter((tb) => tb <= t).pop();
    const EQ = this.EQ, span = this.lyrW();
    if (lastBar !== undefined && t - lastBar < 0.7) {
      const k = ease.outCubic((t - lastBar) / 0.7);
      (u.uSweep!.value as THREE.Vector2).set(EQ.x - 100 + k * (span + 200), 1 - k);
    } else (u.uSweep!.value as THREE.Vector2).set(-999, 0);
    u.uIn!.value = prog(t, s, s + 0.3, ease.outCubic);
    this.bg.render(renderer, out);
    this.blit(this.words.texture, WL.x, WL.y, WL.w, WL.h, out);
    this.drawMessage(t);
    // 沒有留言：邀請放在右上角一小行
    const my = this.msg ? MSG.y : MSG.y - 10;
    this.blit(this.disp.texture, MSG.x, my, MSG.w + 40, MSG.h + 80, out);
    // 鏡頭：整段慢慢推近，大鼓時輕輕一頂
    return { bloom: 0.6, vignette: 0.5, halation: 0.22, zoom: 1 + 0.022 * ease.inOutCubic(f.p) + 0.004 * f.a.kick };
  }
}
