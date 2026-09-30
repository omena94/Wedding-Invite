// 月相（暗）：一顆版畫雕刻的大月亮在左半邊，右邊一欄天文年鑑式的月相表（新月→殘月）。
// 進場是細細的眉月；第一個拍點起每一拍前進一相（明暗交界用強烈緩動掃過、停住），一小節左右到滿月，
// 滿月的那一拍，主打留言從月面「顯影」出來：墨色的字寫在亮的月面上（月面的刻線在字後面淡下來）。
// 月亮外面一圈扁扁的軌道虛線（拍點上往前流一格），歌詞沿著軌道的下緣逐字跟唱，唱到的字下面有一顆火花沿著軌道走。
// 最後一拍月相往「虧凸」前進一點當退場。
//  - 月球、夜空、星星在 shader（moon-glsl.ts）；月相表、字在 Canvas2D；軌道虛線與火花是 LineBatch。
//  - 冷面註記：「觀測地點：婚宴會場 · 天氣：晴」「＊本月相僅供參考，今晚一律以滿月計。」
//  - 沒有主打留言：滿月上寫「今晚月色真美。」（有名的告白梗）＋新人名字與日期、邀請掃 QR；長窗格時月相改成一小節前進一相。
//  - 純音樂：軌道上寫歌名。
// v2（2026-09-29「留言尺寸與版面比例標準 v2」）：月亮照樣是大大的場景（留言寫在月面上，是場景物件），
// 只把月面上的留言縮到 v2 字級（40～60 px，依字數）、署名 26～32，軌道上的歌詞 40～52（不比留言大）。
// 多補的動畫是夜空自己的：兩條薄雲帶慢慢往左飄過月亮（擋一點光、下緣鑲銀邊，留言那一塊雲是透明的）；
// 每四小節一對喜鵲從月亮前面飛過去（鵲橋），翅膀一拍一拍。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, layout } from '../engine/type';
import { HEX, LIN, rgba } from '../engine/palette';
import { clamp, ease, prog, lerp, smoothstep, polylineLengths, pointAtLength, TAU, type V2 } from '../engine/util';
import { fitText, charCount } from '../engine/text';
import type { Line } from '../engine/lyrics';
import { sparkHead, sparkParticles, lyricAt, beatAfter, signature, drawHeart, COUPLE_ZH, DATE_DOTS, lyricSubOf, subSizeFor, subGap } from './_motifs';
import { glyphStates, glyphColor, alongPath, no3, INVITE_SMALL, preloadText, fitWithSig, type PathGlyph } from './_t19';
import { V2 as STD, msgMaxFor, lyricV2, sigV2, fitClauses } from './_v2';
import { FRAG_MOON } from './moon-glsl';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'light', paper: false, energy: [0, 0.7], bars: [4, 8] };

/** 大月亮的圓心（左半邊；右緣不超過 x = 1060，右邊是月相表與即時小卡）。 */
const C = { x: 700, y: 440 };
/** 軌道：以月亮為中心的扁橢圓。下緣曲率很平（半徑 rx²/ry ≈ 3000 px），歌詞沿著它字轉不超過 15°。 */
const ORB = { rx: 1150, ry: 460 };
/** 歌詞可以用的範圍（x）：左邊界到 HUD 前面。 */
const LYR_X0 = 150, LYR_X1 = 1300;
const LYR_FAM = F.archivo(100, 700);
/** 月相表：一欄八個小月亮（x = 1215），右邊是即時小卡的格子（x ≥ 1378）。 */
const COL = { x: 1215, y0: 200, dy: 74, r: 23 };
const PHASES = ['新月', '眉月', '上弦', '盈凸', '滿月', '虧凸', '下弦', '殘月'];
const MSG_FAM = F.ming(700);
const SIG_FAM = F.hand(400);
const LX = 150;
const FOOTNOTE = '＊本月相僅供參考，今晚一律以滿月計。';
const PLACE = '觀測地點：婚宴會場  ·  天氣：晴';
const EMPTY = '今晚月色真美。';
/** 一個朔望月（天）：月齡讀數用。 */
const SYNODIC = 29.53;

const BG = () => new FSPass(FRAG_MOON, {
  uC: { value: new THREE.Vector2(C.x, C.y) }, uR: { value: 340 }, uPhi: { value: 0 }, uRot: { value: 0 }, uIn: { value: 1 },
  uKick: { value: 0 }, uHat: { value: 0 }, uTxt: { value: new THREE.Vector4(C.x, C.y, 1, 1) }, uTxtK: { value: 0 }, uT: { value: 0 },
});

/** 月面上的一個字：位置、字族、字級、顏色、第幾個出現。 */
interface MoonGlyph { ch: string; x: number; y: number; w: number; fam: string; size: number; col: 'sepia' | 'rose'; a: number; order: number; spacing?: number }
/** 排在軌道上的一行字（可能折成兩列）；sub 是原文副行（韓文歌），掛在軌道虛線下面。 */
interface ArcLyric { size: number; rows: { glyphs: PathGlyph[]; off: number }[]; sub?: { line: Line; size: number; glyphs: PathGlyph[]; off: number } }

/** 橢圓軌道（偏移 off px，正的往外）從左到右經過下緣的折線。 */
function orbitPts(off: number, n = 280): V2[] {
  const pts: V2[] = [];
  for (let i = 0; i <= n; i++) {
    const th = lerp(150, 30, i / n) * Math.PI / 180;
    pts.push({ x: C.x + (ORB.rx + off) * Math.cos(th), y: C.y + (ORB.ry + off) * Math.sin(th) });
  }
  return pts;
}
/** 折線上 x 座標對應的弧長（x 由左到右單調遞增）。 */
function sAtX(pts: V2[], L: Float32Array, x: number) {
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m]!.x < x) lo = m; else hi = m; }
  const a = pts[lo]!, b = pts[hi]!;
  return L[lo]! + (L[hi]! - L[lo]!) * clamp((x - a.x) / Math.max(1e-6, b.x - a.x));
}

/** 畫一個小月相（相位角 phi：0 新月、π 滿月），亮面 bone、暗面 ink2 加細線。 */
function drawPhase(c: CanvasRenderingContext2D, x: number, y: number, r: number, phi: number) {
  c.save();
  c.fillStyle = rgba('ink2');
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  // 暗面的刻線（跟大月亮的地照一樣很淡）
  c.save(); c.clip();
  c.strokeStyle = rgba('bone', 0.08); c.lineWidth = 0.8;
  for (let yy = y - r + 2.5; yy < y + r; yy += 4) { c.beginPath(); c.moveTo(x - r, yy); c.lineTo(x + r, yy); c.stroke(); }
  c.restore();
  // 亮面：一側的半圓邊緣＋明暗交界的半橢圓（x 半徑 r·|cos φ|）；虧月鏡射
  const k = Math.cos(phi), waning = Math.sin(phi) < -1e-6;
  c.translate(x, y);
  if (waning) c.scale(-1, 1);
  c.fillStyle = rgba('bone', 0.86);
  c.beginPath();
  c.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
  const rx = Math.max(0.001, r * Math.abs(k));
  if (k >= 0) c.ellipse(0, 0, rx, r, 0, Math.PI / 2, -Math.PI / 2, true);
  else c.ellipse(0, 0, rx, r, 0, Math.PI / 2, Math.PI * 1.5, false);
  c.closePath();
  if (k < 0.999) c.fill();
  c.restore();
  c.strokeStyle = rgba('bone', 0.34); c.lineWidth = 1;
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke();
}

export default class Moon extends Scene {
  bg = shared('moon.bg', BG);
  /** 不會變的：月相表（小月亮、標籤）。第一格畫一次（主題在那時才確定），之後只重用貼圖。 */
  base = this.track(new Layer2D(W, H, undefined, { fast: true }));
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 正在唱的字另外畫一層、加亮疊上去才會發光（低解析度就夠）。 */
  hot = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  glow = this.track(new LineBatch(1600, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 97 + (this.msg?.id ?? 0) * 13) >>> 0;
  R = 330;
  glyphs: MoonGlyph[] = [];
  /** 月面上字的範圍（shader 用來壓低紋理、小卡避開）。 */
  box = { x: 0, y: 0, w: 0, h: 0 };
  t0 = 0; step = 0.5; dur = 0.3; tDev = 0; devSpan = 0.6; tExit = Infinity; exitDur = 0.3;
  label = ''; label2 = '';
  orbit: V2[] = [];
  orbitL = new Float32Array(0);
  arcCache = new Map<number, ArcLyric>();
  titleArc: ArcLyric | null = null;
  avoid: [number, number, number, number][] = [];
  baseSig = '';
  /** 月面上留言的字級（算軌道上歌詞的字級用）；沒有留言是 null。 */
  msgSize: number | null = null;

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const sigText = m ? signature(m.name) : '';
    this.label = `月相 LUNAR PHASE${m ? '  ·  ' + no3(m.n) : ''}${m?.couple ? '  ·  FROM THE COUPLE' : ''}`;
    this.label2 = PLACE;
    const title = song.title ? `♪ ${song.title}${song.artist ? ' — ' + song.artist : ''}` : '';
    await preloadText(this.ctx, `${m?.text ?? ''}${sigText}${this.label}${PLACE}${FOOTNOTE}${EMPTY}${COUPLE_ZH}${INVITE_SMALL}${PHASES.join('')}照明月齡日%${title}`);

    // ---- 時間：第一個拍點起每拍前進一相（眉月 → 上弦 → 盈凸 → 滿月）；窗格短就縮短間隔。
    // 沒有留言、窗格又夠長（≥ 8 小節）時照原意「一小節前進一相」，滿月慢慢來。
    this.t0 = beatAfter(au, s + 0.02);
    const B = au.beatPeriod(this.t0);
    const bar = au.timeOfBar(Math.floor(au.barAt(this.t0)) + 1) - au.timeOfBar(Math.floor(au.barAt(this.t0)));
    const perBar = !m && e - s >= bar * 7.5;
    this.step = perBar ? bar : Math.min(B, Math.max(0.18, (e - this.t0) * 0.12));
    this.dur = Math.min(this.step * 0.55, perBar ? 0.9 : 0.42);
    this.tDev = this.t0 + 2 * this.step + this.dur * 0.3;
    this.devSpan = Math.min(B, 0.8);
    // 退場：最後一拍往「虧凸」前進（滿月之後留言至少要讀一段時間才做）
    const lastBeat = au.timeOfBeat(Math.floor(au.beatAt(e - 0.06)));
    if (lastBeat > this.tDev + this.devSpan + 0.8 && e - lastBeat > 0.12) { this.tExit = lastBeat; this.exitDur = Math.min(B * 0.6, e - lastBeat); }

    // ---- 月面上的字
    const c = this.layer.ctx;
    this.glyphs = [];
    if (m) {
      // 字越多月亮越大：60 字時月面要能排 44～48 px
      // （MV 檢修：留言是焦點，要明顯比軌道上的歌詞大，所以月亮可以再大一點、框再高一點）
      // v2：月亮是場景（大小固定），字照 v2 字級排在月面中間
      this.R = 340;
      const R = this.R;
      // 框：月面內接的扁長方形（寬 1.46R 時上下緣還在月面內），下面留一列給署名
      const bw = R * 1.46, bh = R * 1.16 - 40;
      // 字級依「框高扣掉署名那一列」找（fitWithSig）：署名一定在最後一行下面、不重疊
      const sigO = { ratio: 0.6, min: STD.sigMin, max: STD.sigMax };
      const o = { min: STD.msgMin, max: msgMaxFor(m.text), lineHeight: 1.3, maxLines: 7 };
      let blk = fitWithSig(c, m.text, MSG_FAM, bw, bh + 40, o, sigO);
      // 照標點斷行（字級只小一點點也值得）
      const cl = fitClauses(c, m.text, MSG_FAM, bw, bh + 40 - STD.sigMax * 1.6, o);
      if (cl && cl.size >= blk.fit.size * 0.88) { const ss = sigV2(cl.size), sd = cl.size * 0.34 + ss * 1.02; blk = { fit: cl, sigSize: ss, sigDy: sd, height: cl.height + sd + ss * 0.26 }; }
      // 短短一句（「新婚快樂！！！」）不要被折成兩行：一行穿過月面正中間（那裡最寬）
      if (charCount(m.text) <= 12) {
        const one = fitWithSig(c, m.text, MSG_FAM, R * 1.7, bh + 40, { ...o, maxLines: 1 }, sigO);
        if (one.fit.lines.length === 1 && one.fit.size >= blk.fit.size * 0.95) blk = one;
      }
      this.msgSize = blk.fit.size;
      const fit = blk.fit, ss = blk.sigSize;
      const top = C.y - R * 0.03 - blk.height / 2 + fit.size;
      let order = 0;
      fit.lines.forEach((ln, i) => {
        const lay = layout(ln, MSG_FAM, fit.size);
        const x0 = C.x - lay.width / 2, y = top + i * fit.lineHeight;
        for (const g of lay.glyphs) {
          if (g.ch === ' ') continue;
          this.glyphs.push({ ch: g.ch, x: x0 + g.x, y, w: g.w, fam: MSG_FAM, size: fit.size, col: g.ch === '♥' ? 'rose' : 'sepia', a: 0.94, order: order++ });
        }
      });
      // 署名：最後一行下面、靠右對齊整塊字；右下角超出月面就往左收
      const lastY = top + (fit.lines.length - 1) * fit.lineHeight;
      c.font = font(SIG_FAM, ss);
      const sw = c.measureText(sigText).width;
      let sx = C.x + fit.width / 2 - sw;
      const sy = lastY + blk.sigDy;
      const maxX = C.x + Math.sqrt(Math.max(0, (R * 0.9) ** 2 - (sy - C.y) ** 2));
      if (sx + sw > maxX) sx = maxX - sw;
      this.glyphs.push({ ch: sigText, x: sx, y: sy, w: sw, fam: SIG_FAM, size: ss, col: 'sepia', a: 0.72, order: order + 2 });
      this.box = { x: C.x - fit.width / 2, y: top - fit.size * 0.9, w: fit.width, h: sy + ss * 0.3 - (top - fit.size * 0.9) };
    } else {
      // 沒有留言：「今晚月色真美。」＋新人與日期＋邀請（固定字級，不自動斷行）
      this.R = 320;
      const R = this.R;
      // 沒有留言時焦點是軌道上的歌詞：月面上的字小一級
      const big = Math.min(STD.lyrMax, Math.floor((R * 1.42) / Array.from(EMPTY).length));
      const nameSize = 40, dateSize = 20, invSize = 22;
      const yBig = C.y - R * 0.12, yName = yBig + big * 1.05, yDate = yName + 46, yInv = C.y + R * 0.66;
      const put = (text: string, fam: string, size: number, y: number, a: number, order: number, spacing = 0) => {
        c.font = font(fam, size); c.letterSpacing = `${spacing}px`;
        const w = c.measureText(text).width; c.letterSpacing = '0px';
        this.glyphs.push({ ch: text, x: C.x - w / 2, y, w, fam, size, col: 'sepia', a, order, spacing });
        return w;
      };
      const wBig = put(EMPTY, MSG_FAM, big, yBig, 0.94, 0);
      put(COUPLE_ZH, MSG_FAM, nameSize, yName, 0.9, 3);
      put(DATE_DOTS, F.mono(500), dateSize, yDate, 0.7, 4, 3);
      put(INVITE_SMALL, F.hei(500), invSize, yInv, 0.78, 6, 1);
      c.font = font(F.hei(500), invSize); c.letterSpacing = '1px';
      const wInv = c.measureText(INVITE_SMALL).width; c.letterSpacing = '0px';
      const bw = Math.max(wBig, wInv);
      this.box = { x: C.x - bw / 2, y: yBig - big, w: bw, h: yInv + 10 - (yBig - big) };
    }

    // ---- 軌道與歌詞
    this.orbit = orbitPts(0);
    this.orbitL = polylineLengths(this.orbit);
    // 純音樂：軌道上的歌名是配角（小、淡），焦點留給月面上的留言
    if (!lyrics.has && title) this.titleArc = this.arcLayout(c, title, null, 38);
    this.avoid = [
      [this.box.x - 24, this.box.y - 24, this.box.w + 48, this.box.h + 48],
      [LYR_X0 - 10, 772, LYR_X1 - LYR_X0 + 20, 208],
    ];
  }

  /** 月相（0..8 的相位序號，1 = 眉月、4 = 滿月、5 = 虧凸）在 t 時。 */
  private phaseK(t: number) {
    let k = 1;
    for (let i = 0; i < 3; i++) k += prog(t, this.t0 + i * this.step, this.t0 + i * this.step + this.dur, ease.outExpo);
    if (t > this.tExit) k += prog(t, this.tExit, this.tExit + this.exitDur, ease.outExpo);
    return k;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const R = this.R;
    const k = this.phaseK(t), phi = (k * Math.PI) / 4;
    const inK = prog(t, s, s + 0.3);
    const dev = prog(t, this.tDev, this.tDev + this.devSpan + 0.3, ease.inOutCubic);

    const u = this.bg.u;
    (u.uC!.value as THREE.Vector2).set(C.x, C.y);
    u.uR!.value = R;
    u.uPhi!.value = phi;
    // 月面每個小節線「秤動」一小步（強烈緩動、停住）：長窗格裡月亮也在呼吸，字後面的紋理已經壓低，不影響閱讀
    const bf = au.barAt(t) - au.barAt(s), bi = Math.floor(bf);
    u.uRot!.value = 0.35 + 0.035 * (bi + ease.outExpo(clamp((bf - bi) / 0.3)));
    u.uIn!.value = inK;
    u.uKick!.value = f.a.kick;
    u.uHat!.value = f.a.hat;
    (u.uTxt!.value as THREE.Vector4).set(this.box.x + this.box.w / 2, this.box.y + this.box.h / 2, this.box.w / 2 + 46, this.box.h / 2 + 40);
    u.uTxtK!.value = dev;
    u.uT!.value = t;
    this.bg.render(renderer, out);

    // ---- 不會變的一層：月相表（換主題時重畫）＋月面上已經顯影完的留言。
    // 留言顯影完、退場之前都不會變：畫一次就好。GPU 畫布每格重畫幾十個大字，字形快取的狀態會讓同一格畫兩次
    // 差一兩個色階（確定性檢查偶爾抓到），也省每格的繪製與上傳。
    const still = t >= this.tDev + this.devSpan + 0.35 && t < this.tExit;
    const sig = `${HEX.bone}${HEX.ink2}${HEX.ash}${HEX.sepia}${HEX.rose}|${still ? 1 : 0}`;
    if (sig !== this.baseSig) { this.baseSig = sig; this.drawBase(still ? phi : null, t); }
    comp.draw(renderer, this.base.texture, out, { opacity: inK });

    const L = this.layer, HL = this.hot;
    L.clear(); HL.clear();
    const c = L.ctx, hc = HL.ctx;
    this.glow.clear();
    c.globalAlpha = inK;

    // ---- mono 註記：左上一行、左下註腳（配角：小、低對比）
    c.font = font(F.mono(500), 16); c.letterSpacing = '3px';
    c.fillStyle = rgba('ash', 0.5); c.fillText(this.label, LX, 126);
    c.fillStyle = rgba('ash', 0.36); c.fillText(FOOTNOTE, LX, 978);
    c.letterSpacing = '0px';

    // ---- 月相表的指示：一圈訊號色的細環，跟著大月亮的相位走（拍點上跳一格）；讀數、引線都拿掉（介面感太重）
    const ki = ((k % 8) + 8) % 8;
    const yk = COL.y0 + ki * COL.dy;
    c.strokeStyle = rgba('signal', 0.8); c.lineWidth = 1.4;
    c.beginPath(); c.arc(COL.x, yk, COL.r + 7, 0, TAU); c.stroke();

    // ---- 月面上的字：滿月的那一拍起逐字顯影；退場時被明暗交界吃掉（顯影完、退場前在不會變的那一層）
    if (t >= this.tDev && !still) this.drawGlyphs(c, t, phi);
    // ---- 喜鵲：每四小節一對從月亮上緣前面飛過去
    this.drawMagpies(c, t, inK);

    // ---- 軌道虛線：拍點上往前流一格
    const beat = au.beatAt(t);
    const flow = (Math.floor(beat) + ease.outExpo(clamp((beat - Math.floor(beat)) / 0.4))) * 26;
    this.dashes(flow, inK);

    // ---- 歌詞沿著軌道（純音樂：歌名）
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const arc = this.arcFor(c, ly.line);
      this.drawArc(c, hc, arc, ly.line, t, ly.k * inK);
    } else if (this.titleArc) {
      this.drawArc(c, hc, this.titleArc, null, t, inK * 0.45);
    }

    comp.draw(renderer, L.upload(), out);
    comp.draw(renderer, HL.upload(), out, { mode: 'add', tint: [1.7, 1.7, 1.7] });
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：整個窗格很慢地推近（inOutSine）
    const push = 1 + 0.03 * (0.5 - 0.5 * Math.cos(Math.PI * f.p));
    return { bloom: 0.7, vignette: 0.55, zoom: push, popupAvoid: this.avoid };
  }

  /**
   * 喜鵲（v2 多補的小事件，鵲橋的暗示）：每四小節的小節線起，一對喜鵲從右往左飛過月亮的上緣（在留言上面，不擋字），
   * 飛一小節多一點。剪影（墨色，落在亮的月面上最清楚）；翅膀「往下拍」落在每一拍上（次要動作跟著節拍），
   * 兩隻一前一後、高低錯開、拍翅差半拍。
   */
  private drawMagpies(c: CanvasRenderingContext2D, t: number, k: number) {
    const au = this.ctx.audio, s = this.ctx.start;
    const b = Math.floor(au.barAt(t) + 1e-4);
    const b0 = b - (((b % 4) + 4) % 4) + 1;
    const t0 = au.timeOfBar(b0), t1 = au.timeOfBar(b0 + 1) + (au.timeOfBar(b0 + 1) - t0) * 0.4;
    if (t < t0 || t > t1 || t0 < s + 0.5) return;
    const u = (t - t0) / (t1 - t0);
    // 飛行高度：月面上緣附近，而且一定在留言那一塊的上面（長留言的第一行比較高時跟著往上）
    const yFly = Math.min(C.y - this.R * 0.78, this.box.y - 44);
    c.save();
    c.globalAlpha *= k * Math.min(1, u * 8, (1 - u) * 8);
    c.fillStyle = rgba('ink2', 0.95);
    for (const [dx, dy, ph] of [[0, 0, 0], [78, 30, 0.5]] as const) {
      const x = lerp(C.x + this.R * 1.25, C.x - this.R * 1.35, u) + dx;
      const y = yFly + dy - 24 * Math.sin(u * Math.PI);
      // 拍翅：拍點上翅膀在最高處，前 35% 拍用力往下拍、剩下的時間慢慢收回去
      const bp = au.beatAt(t) + ph, fr = bp - Math.floor(bp);
      const flap = fr < 0.35 ? lerp(1, -0.75, ease.inOutCubic(fr / 0.35)) : lerp(-0.75, 1, ease.inOutQuad((fr - 0.35) / 0.65));
      this.magpie(c, x, y, 22, flap);
    }
    c.restore();
  }

  /** 一隻往左飛的喜鵲剪影：圓頭短喙、紡錘形身體、長長的楔形尾巴，翅膀是一片會上下拍的弧形（flap 1 最高、-1 最低）。 */
  private magpie(c: CanvasRenderingContext2D, x: number, y: number, s: number, flap: number) {
    // 身體＋頭
    c.beginPath(); c.ellipse(x, y, s * 0.85, s * 0.3, -0.06, 0, TAU); c.fill();
    c.beginPath(); c.arc(x - s * 0.88, y - s * 0.1, s * 0.25, 0, TAU); c.fill();
    c.beginPath(); c.moveTo(x - s * 1.08, y - s * 0.16); c.lineTo(x - s * 1.42, y - s * 0.04); c.lineTo(x - s * 1.08, y + s * 0.02); c.fill();
    // 長尾巴：往後、稍微往下，尾端比根部寬一點（喜鵲的尾巴跟身體差不多長）
    c.beginPath();
    c.moveTo(x + s * 0.6, y - s * 0.1); c.lineTo(x + s * 2.25, y + s * 0.12);
    c.lineTo(x + s * 2.2, y + s * 0.36); c.lineTo(x + s * 0.6, y + s * 0.14);
    c.fill();
    // 翅膀：肩在身體前半，翼尖往後上（或後下）掃；翅膀水平時從側面看只剩一條薄片
    const tipY = y - s * 1.45 * flap, tipX = x + s * (0.55 + 0.25 * (1 - Math.abs(flap)));
    const midY = y - s * 0.8 * flap;
    c.beginPath();
    c.moveTo(x - s * 0.35, y - s * 0.08);
    c.quadraticCurveTo(x - s * 0.2, midY - s * 0.12, tipX - s * 0.15, tipY);
    c.lineTo(tipX + s * 0.08, tipY + s * 0.1 * Math.sign(flap || 1));
    c.quadraticCurveTo(x + s * 0.45, midY + s * 0.2 * Math.sign(flap || 1), x + s * 0.3, y + s * 0.02);
    c.closePath(); c.fill();
  }

  /** 月面上的字（逐字顯影；lit 跟 shader 同一個公式，只在退場時有差）。 */
  private drawGlyphs(c: CanvasRenderingContext2D, t: number, phi: number) {
    const R = this.R;
    const n = Math.max(1, this.glyphs.length - 1);
    const Lx = Math.sin(phi), Lz = -Math.cos(phi);
    for (const g of this.glyphs) {
      const ti = this.tDev + this.devSpan * Math.min(1, g.order / n);
      const a = prog(t, ti, ti + 0.3, ease.outCubic);
      if (a <= 0) continue;
      const dx = (g.x + g.w / 2 - C.x) / R, dy = (g.y - g.size * 0.35 - C.y) / R;
      const nz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
      const lit = smoothstep(-0.02, 0.1, dx * Lx + nz * Lz);
      const alpha = g.a * a * lit;
      if (alpha <= 0.01) continue;
      c.font = font(g.fam, g.size);
      c.letterSpacing = `${g.spacing ?? 0}px`;
      if (g.ch === '♥') drawHeart(c, g.x + g.w / 2, g.y - g.size * 0.36, g.size * 0.84, rgba('rose', alpha));
      else { c.fillStyle = rgba(g.col, alpha); c.fillText(g.ch, g.x, g.y + (1 - a) * 6); }
      c.letterSpacing = '0px';
    }
  }

  /** 不會變的一層：月相表（八個小月亮＋標籤，畫淡一點）＋顯影完的留言（phi 不是 null 時）。 */
  private drawBase(phi: number | null, t: number) {
    const B = this.base, c = B.ctx;
    B.clear();
    c.globalAlpha = 0.75;
    c.strokeStyle = rgba('bone', 0.12); c.lineWidth = 1;
    // 欄的中線（細）：小月亮串在上面
    c.beginPath(); c.moveTo(COL.x, COL.y0 - 30); c.lineTo(COL.x, COL.y0 + 7 * COL.dy + 30); c.stroke();
    PHASES.forEach((name, i) => {
      const y = COL.y0 + i * COL.dy;
      drawPhase(c, COL.x, y, COL.r, (i * Math.PI) / 4);
      c.font = font(F.hei(500), 16); c.letterSpacing = '2px'; c.fillStyle = rgba('ash', 0.55);
      c.fillText(name, COL.x + COL.r + 14, y + 6);
      c.letterSpacing = '0px';
    });
    c.globalAlpha = 1;
    if (phi !== null) this.drawGlyphs(c, t, phi);
    B.upload();
  }

  /** 軌道的虛線（下緣那一段，兩端淡出）。 */
  private dashes(flow: number, k: number) {
    const pts = this.orbit, Ls = this.orbitL, tot = Ls[Ls.length - 1]!;
    const P = 26, D = 13;
    const b = LIN.bone;
    for (let s0 = (flow % P) - P; s0 < tot; s0 += P) {
      const a = pointAtLength(pts, Ls, Math.max(0, s0)), q = pointAtLength(pts, Ls, Math.min(tot, s0 + D));
      if (s0 + D <= 0) continue;
      const fade = smoothstep(60, 220, a.x) * (1 - smoothstep(1500, 1700, a.x)) * k;
      if (fade <= 0.01) continue;
      this.glow.seg2(a.x, a.y, q.x, q.y, 1.2, [b[0] * 0.3, b[1] * 0.3, b[2] * 0.3], fade);
    }
  }

  private arcFor(c: CanvasRenderingContext2D, line: Line): ArcLyric {
    let a = this.arcCache.get(line.i);
    // 歌詞：有留言時比留言小一級，沒有留言時歌詞就是焦點、大一點
    if (!a) { a = this.arcLayout(c, line.text, line, lyricV2(this.msgSize), lyricSubOf(line)); this.arcCache.set(line.i, a); }
    return a;
  }

  /**
   * 把一行字沿著軌道下緣排：先縮字級（到 48）讓它放得進 x 150～1300；還是放不下就在中間附近的字之間折兩列，
   * 第一列站在軌道上、第二列掛在軌道下面。每列以月亮正下方為中心，碰到邊界就推回來。
   */
  private arcLayout(c: CanvasRenderingContext2D, text: string, line: Line | null, size0: number, sub: Line | null = null): ArcLyric {
    const width = (s: string, size: number) => { c.font = font(LYR_FAM, size); let w = 0; for (const ch of s) w += c.measureText(ch).width; return w; };
    const room = (off: number) => { const p = orbitPts(off), L = polylineLengths(p); return { p, L, lo: sAtX(p, L, LYR_X0), hi: sAtX(p, L, LYR_X1), mid: sAtX(p, L, C.x) }; };
    const r1 = room(-18);
    let size = size0;
    const full = width(text, size);
    if (full > r1.hi - r1.lo) size = Math.max(STD.lyrMin, (size * (r1.hi - r1.lo)) / full);
    const place = (s: string, off: number, from: number) => {
      const r = off < 0 ? r1 : room(off);
      const w = width(s, size);
      const s0 = clamp(r.mid - w / 2, r.lo, Math.max(r.lo, r.hi - w));
      return alongPath(c, s, LYR_FAM, size, r.p, s0).map((g) => ({ ...g, i: g.i + from }));
    };
    // 原文副行：中文站在軌道虛線上面、原文掛在虛線下面（小一號，基線離中文最後一列 subGap），同樣沿著軌道、以月亮正下方為中心
    const withSub = (arc: ArcLyric): ArcLyric => {
      if (!sub) return arc;
      const ss = subSizeFor(size), off = arc.rows[arc.rows.length - 1]!.off + Math.round(subGap(size, ss));
      const r = room(off), w = width(sub.text, ss);
      let sz = ss;
      if (w > r.hi - r.lo) sz = Math.max(26, (ss * (r.hi - r.lo)) / w);
      const s0 = clamp(r.mid - width(sub.text, sz) / 2, r.lo, Math.max(r.lo, r.hi - width(sub.text, sz)));
      return { ...arc, sub: { line: sub, size: sz, glyphs: alongPath(c, sub.text, LYR_FAM, sz, r.p, s0), off } };
    };
    if (width(text, size) <= r1.hi - r1.lo + 1 || !line || line.words.length < 2) return withSub({ size, rows: [{ glyphs: place(text, -18, 0), off: -18 }] });
    // 折兩列：挑讓兩列最長的那列最短的斷點（在字與字之間）
    let best = 1, bestW = Infinity;
    for (let k = 1; k < line.words.length; k++) {
      const o = line.words[k]!.o;
      const w = Math.max(width(text.slice(0, o).trimEnd(), size), width(text.slice(o), size));
      if (w < bestW) { bestW = w; best = k; }
    }
    const o = line.words[best]!.o;
    const a = text.slice(0, o).trimEnd(), b = text.slice(o);
    const off2 = Math.round(size * 1.02);
    // 有原文時兩列中文都站在虛線上面（第一列往月亮那邊抬一行），原文才放得進虛線下面、不會掉到畫面底下
    if (sub) {
      const up = -18 - Math.round(size * 1.12);
      return withSub({ size, rows: [{ glyphs: place(a, up, 0), off: up }, { glyphs: place(b, -18, Array.from(text.slice(0, o)).length), off: -18 }] });
    }
    return { size, rows: [{ glyphs: place(a, -18, 0), off: -18 }, { glyphs: place(b, off2, Array.from(text.slice(0, o)).length), off: off2 }] };
  }

  /** 畫軌道上的字：逐字跟唱（line 為 null 是歌名，靜止紙白）；唱到的字下面，火花沿著軌道走。 */
  private drawArc(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, arc: ArcLyric, line: Line | null, t: number, alpha: number) {
    const st = line ? glyphStates(line, t) : null;
    c.font = hc.font = font(LYR_FAM, arc.size);
    c.textBaseline = hc.textBaseline = 'alphabetic';
    let head: { x: number; y: number } | null = null;
    for (const row of arc.rows) {
      for (const g of row.glyphs) {
        if (g.ch === ' ') continue;
        const p = st ? st[g.i]?.p ?? 0 : 1;
        c.save(); c.translate(g.x, g.y); c.rotate(g.a);
        c.fillStyle = st ? glyphColor(p, false, alpha) : rgba('bone', alpha);
        c.fillText(g.ch, -g.w / 2, 0);
        c.restore();
        if (st && p > 0 && p < 1) {
          hc.save(); hc.translate(g.x, g.y); hc.rotate(g.a);
          hc.fillStyle = rgba('signal', 0.85 * alpha); hc.fillText(g.ch, -g.w / 2, 0);
          hc.restore();
          // 字底下的軌道上（第一列在字下面、第二列在字上面）
          // 軌道 = 字的基線往「外法線」（字的下方）退回 off
          const ca = Math.cos(g.a), sa = Math.sin(g.a), along = (p - 0.5) * g.w;
          head = { x: g.x + ca * along + row.off * sa, y: g.y + sa * along - row.off * ca };
        }
      }
    }
    // 原文副行：比中文安靜——唱到、唱完都是紙白再淡兩成（不用訊號色、不發光、沒有火花），還沒唱的一樣三成
    if (arc.sub) {
      const ss = glyphStates(arc.sub.line, t);
      c.font = font(LYR_FAM, arc.sub.size);
      for (const g of arc.sub.glyphs) {
        if (g.ch === ' ') continue;
        const p = ss[g.i]?.p ?? 0;
        c.save(); c.translate(g.x, g.y); c.rotate(g.a);
        c.fillStyle = p > 0 ? rgba('bone', 0.96 * 0.8 * alpha) : glyphColor(0, false, alpha);
        c.fillText(g.ch, -g.w / 2, 0);
        c.restore();
      }
    }
    if (head && alpha > 0.3) {
      const h = head;
      sparkParticles(this.glow, t, () => h, { rate: 60, life: 0.3, speed: 120, seed: this.seed + 5, width: 1.2 });
      sparkHead(this.glow, h.x, h.y, t, 0.5, alpha);
    }
  }
}
