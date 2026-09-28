// 里程表（機器 A）：一塊雕刻紋的金屬儀表板，上面是一排排滾輪計數器，鏡頭斜斜地貼著看（像微距的產品照，遠的地方有一點景深）。
// 畫法：全螢幕 shader（odometer-glsl.ts）從鏡頭射線打到板子上，再畫圓柱滾輪；每個滾輪的位置（轉到哪一格、轉多快）在 CPU 算（純函數）。
//  - 上排三個小計數器：「今晚收到的祝福」（切進來時從少一點的數字一路滾到現在的則數）、「本曲心跳」（這首歌第幾拍：
//    每一拍最右邊那一格滾一格、正好落在拍點上，進位時左邊一格跟著滾）、「BPM」。最右邊那一格是反色的，像真的里程表。
//  - 中間一排大滾輪是歌詞：一句（太長就分頁）在唱之前「嘩」地一起轉上來，停在差一點點的位置（還沒卡進去、三成亮）；
//    唱到的那一刻「喀」一聲卡進定位（彈簧），亮成訊號色；唱完變紙白。
//  - 下面是一塊主題色的金屬銘牌，主打留言刻在上面：第一拍之後一個詞組一拍，剛刻好的字燒紅、冷卻成墨色；右下署名。
//    沒有留言：銘牌刻邀請。
//  - 每個小節線一道反光掃過整塊板子；鏡頭每兩小節換個角度（緩進小節線），整段慢慢推近。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { clamp, ease, lerp, prog, hash, springStep } from '../engine/util';
import { fitText, phrases, type FitResult } from '../engine/text';
import { beatAfter, barAfter, signature, COUPLE_EN, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { fillWithHearts } from '../engine/motifs';
import { GlyphAtlas, cuePages, windowLines, COL, type GlyphReq, type CuePage } from './_t7';
import { FRAG_ODO, NB } from './odometer-glsl';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: false, energy: [0.3, 0.9], bars: [4, 8] };

// ---------------------------------------------------------------- 版面（板子上的座標，px，y 往下；預設鏡頭下就是螢幕像素）
const PANEL = { x0: 104, y0: 104, x1: 1356, y1: 944 };
/** 滾輪組：x0 = 第一個輪面中心左邊的間距起點、中心 y、間距、輪面寬、半徑、每格角度、窗半高、滾輪數。 */
interface Bank { x0: number; cy: number; pitch: number; face: number; R: number; slot: number; winH: number; n: number; si: number; gw: number }
const SMALL = { pitch: 58, face: 52, R: 58, slot: 1.0, winH: 36 };
const WISH: Bank = { x0: 152, cy: 220, ...SMALL, n: 4, si: 0, gw: 44 };
const BEATS: Bank = { x0: 540, cy: 220, ...SMALL, n: 5, si: 4, gw: 44 };
const BPM: Bank = { x0: 1010, cy: 220, ...SMALL, n: 3, si: 9, gw: 44 };
/** 歌詞：13 個大滾輪（字級約 80 px）。 */
const LYR: Bank = { x0: 150, cy: 452, pitch: 92, face: 86, R: 122, slot: 1.02, winH: 96, n: 13, si: 12, gw: 88 };
/** 銘牌。 */
const PLATE = { x: 150, y: 588, w: 1150, h: 310 };
/** 銘牌上：編號那一列的高度、署名那一列的高度。 */
const P_TOP = 64, P_SIG = 62;
const LAB = { x: PANEL.x0, y: PANEL.y0, w: PANEL.x1 - PANEL.x0, h: PANEL.y1 - PANEL.y0 };
const FOCAL = 540 / Math.tan((15 * Math.PI) / 180);
/** 鏡頭繞著轉的點（板子中心）。 */
const PIV = { x: 730 - 960, y: 540 - 540 };

const F_LYR = F.archivo(100, 800);
/** 滾輪上「路過」的亂數字：字號加上這個數，shader 就畫成暗的（不是這一格要顯示的字）。 */
const FILL = 10000;
const F_DIG = F.archivo(75, 700);
const F_MSG = F.ming(700);
const INVITE = '這塊銘牌還空著：掃描右下角 QR code，把你的祝福刻上來。';
const TEXT = `今晚收到的祝福則本曲心跳下每分鐘現在唱到純音樂${INVITE}新人＊本表只進不退，無法歸零。`;

interface Cam { yaw: number; pitch: number; dist: number }
const CAMS: Cam[] = [
  { yaw: -0.12, pitch: 0.15, dist: 1.03 },
  { yaw: 0.1, pitch: 0.12, dist: 1.02 },
  { yaw: -0.06, pitch: 0.18, dist: 1.04 },
  { yaw: 0.13, pitch: 0.16, dist: 1.03 },
];

const BG = () => new FSPass(FRAG_ODO, {
  uState: { value: null }, uAtlas: { value: null }, uAG: { value: new THREE.Vector2(1, 1) },
  uLab: { value: null }, uLabR: { value: new THREE.Vector4(LAB.x, LAB.y, LAB.w, LAB.h) },
  uPlate: { value: null }, uPlateR: { value: new THREE.Vector4(PLATE.x, PLATE.y, PLATE.w, PLATE.h) },
  uBA: { value: Array.from({ length: NB }, () => new THREE.Vector4()) },
  uBB: { value: Array.from({ length: NB }, () => new THREE.Vector4()) },
  uBC: { value: Array.from({ length: NB }, () => new THREE.Vector4()) },
  uPanel: { value: new THREE.Vector4(PANEL.x0, PANEL.y0, PANEL.x1, PANEL.y1) },
  uCP: { value: new THREE.Vector3(0, 0, FOCAL) }, uCR: { value: new THREE.Matrix3() }, uF: { value: FOCAL },
  uFocus: { value: FOCAL }, uSheen: { value: -9999 }, uIn: { value: 1 }, uKick: { value: 0 },
});

/** 滾輪位置的一段：roll = 一路轉過去（先快後慢），click = 卡進定位（彈簧）。 */
interface Seg { ta: number; tb: number; pa: number; pb: number; kind: 'roll' | 'click' }
interface Drum { segs: Seg[]; anchors: Map<number, number>; fill: number[]; cols: [number, number][]; seed: number }

/** 滾輪在 t 時的位置：最後一段已經開始的（後開始的蓋過前面還沒結束的）。 */
function posAt(d: Drum, t: number, p0 = 0): number {
  let cur: Seg | null = null;
  for (const s of d.segs) { if (s.ta <= t) cur = s; else break; }
  if (!cur) return p0;
  if (t >= cur.tb) return cur.pb;
  const x = (t - cur.ta) / (cur.tb - cur.ta);
  return cur.kind === 'roll' ? lerp(cur.pa, cur.pb, ease.outCubic(x)) : lerp(cur.pa, cur.pb, springStep(t - cur.ta, 4.5, 0.32));
}

export default class Odometer extends Scene {
  bg = shared('odometer.bg', BG);
  atlas!: GlyphAtlas;
  data = new Float32Array(32 * 2 * 4);
  state = this.track(new THREE.DataTexture(this.data, 32, 2, THREE.RGBAFormat, THREE.FloatType));
  /** 絹印標籤（畫一次）與銘牌上的刻字（刻一個詞組才重畫一次）。 */
  lab = this.track(new Layer2D(LAB.w, LAB.h, undefined, { fast: true }));
  plate = this.track(new Layer2D(PLATE.w, PLATE.h, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  drums: Drum[] = [];
  digits: number[] = [];
  pages: CuePage[] = [];
  beat = 0.5;
  tBoot = 0;
  count = 0;
  bpm = 100;
  /** 銘牌：排好的字、每個詞組刻上去的時間。 */
  fit: FitResult | null = null;
  chunks: { line: number; from: number; to: number; t: number }[] = [];
  sigT = Infinity;
  sigText = '';
  plateFam = F_MSG;
  camTimes: number[] = [];
  sheens: number[] = [];
  avoid: [number, number, number, number][] = [];
  private plateKey = '';

  override async init() {
    const { audio: au, lyrics, song, live } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    this.beat = au.beatPeriod(s + 0.1);
    this.tBoot = beatAfter(au, s + 0.25);
    this.count = Math.min(9999, Math.max(0, live.count));
    let bpm = au.bpm || 100;
    while (bpm > 180) bpm /= 2;
    while (bpm < 60) bpm *= 2;
    this.bpm = Math.round(bpm);
    const lines = windowLines(lyrics, s, e);
    const m = this.msg;
    const body = m ? m.text : INVITE;
    this.sigText = m ? signature(m.name) : '';
    await loadText(TEXT + lines.map((l) => l.text).join('') + body + this.sigText + COUPLE_EN + COUPLE_ZH + (song.title ?? ''));

    const reqs: GlyphReq[] = [];
    for (const ch of Array.from(lines.map((l) => l.text).join('') + (song.title ?? '') + COUPLE_ZH)) reqs.push({ ch, family: F_LYR });
    for (const ch of '0123456789') reqs.push({ ch, family: F_DIG });
    this.atlas = this.track(new GlyphAtlas(reqs, 112, 160, { size: 104, fill: 0.9, mip: true }));
    this.ctx.renderer.initTexture(this.atlas.tex);
    this.digits = Array.from('0123456789').map((ch) => this.atlas.get(F_DIG, ch));
    this.state.minFilter = this.state.magFilter = THREE.NearestFilter;

    const u = this.bg.u;
    u.uAtlas!.value = this.atlas.tex;
    u.uState!.value = this.state;
    (u.uAG!.value as THREE.Vector2).set(this.atlas.cols, this.atlas.rows);
    [WISH, BEATS, BPM, LYR].forEach((b, i) => {
      (u.uBA!.value as THREE.Vector4[])[i]!.set(b.x0, b.cy, b.pitch, b.face);
      (u.uBB!.value as THREE.Vector4[])[i]!.set(b.R, b.slot, b.winH, b.n);
      (u.uBC!.value as THREE.Vector4[])[i]!.set(b.si, b.gw, 0, 0);
    });
    u.uLab!.value = this.lab.texture;
    u.uPlate!.value = this.plate.texture;

    this.pages = cuePages(lines, LYR.n, 1, true).filter((p) => p.t1 > s - 0.3 && p.t0 < e - 0.2);
    this.buildLyrics();
    // 純音樂（這個窗格沒有歌詞）：大滾輪轉上歌名（太長就轉上新人的名字）
    if (!this.pages.length) this.titleDrums(song.title && Array.from(song.title).length <= LYR.n ? song.title : COUPLE_ZH);
    this.layoutPlate(body);
    this.drawLabels();
    this.ctx.renderer.initTexture(this.lab.upload());
    for (let k = 2; ; k += 2) { const tb = barAfter(au, s + 0.1, k); if (tb > e - 0.6) break; this.camTimes.push(tb); }
    for (let k = 0; ; k++) { const tb = barAfter(au, s + 0.05, k); if (tb > e) break; this.sheens.push(tb); }
    this.avoid = this.computeAvoid();
  }

  // ---------------------------------------------------------------- 歌詞滾輪
  private buildLyrics() {
    const s = this.ctx.start, A = this.atlas;
    const fill = A.ofFamily(F_LYR);
    for (let j = 0; j < LYR.n; j++) this.drums.push({ segs: [], anchors: new Map([[0, -1]]), fill, cols: [[-1e9, COL.DIM]], seed: hash(j, this.ctx.params.seed ?? 1) * 1e6 });
    const slotOf = new Array(LYR.n).fill(0);
    /** 每個滾輪上現在的字什麼時候唱完：還在唱的字不能被轉走。 */
    const busy = new Array(LYR.n).fill(-1e9);
    for (const pg of this.pages) {
      const row = pg.rows[0]!;
      for (let j = 0; j < LYR.n; j++) {
        const d = this.drums[j]!;
        const ci = row[j];
        const cue = ci !== undefined ? pg.cues[ci]! : null;
        const g = cue ? A.get(F_LYR, cue.ch) : -1;
        const cur = d.anchors.get(slotOf[j]) ?? -1;
        if (g < 0 && cur < 0) continue;
        const from = slotOf[j], to = from + 3 + ((j + pg.line.i) % 3);
        slotOf[j] = to;
        // 轉過去的途中經過的格子是亂數字（暗的，+FILL 標記），停住的格子上下都是空白（不會露出雜字）
        for (let k = from + 1; k < to - 1; k++) d.anchors.set(k, fill.length ? FILL + fill[Math.floor(hash(d.seed, k) * fill.length)]! : -1);
        d.anchors.set(to - 1, -1);
        d.anchors.set(to, g);
        // 什麼時候轉到：比這一頁第一個字早 0.5 秒（一格一格錯開），但要等這個滾輪上的舊字唱完；
        // 不過新字自己要唱了就一定要到（寧可切掉舊字的尾巴，也不能讓新字晚出現）
        let tb = Math.max(pg.t0 - 0.5 + 0.03 * j, busy[j] + 0.15, s + 0.47 + 0.03 * j);
        if (cue && g >= 0) tb = Math.max(s + 0.47 + 0.03 * j, Math.min(tb, cue.t0 - 0.03));
        const ta = tb - 0.45;
        if (cue) busy[j] = cue.w1;
        // 上一頁還沒發生的事（還沒卡進去、還沒變色）作廢
        d.segs = d.segs.filter((x) => x.ta < ta);
        d.cols = d.cols.filter(([tc]) => tc < ta);
        // 還沒唱的字停在差一點的地方（還沒卡進去），唱到的那一刻卡進去
        const early = cue && g >= 0 && cue.t0 > tb + 0.02;
        d.segs.push({ ta, tb, pa: this.lastPos(d, from), pb: early ? to - 0.2 : to, kind: 'roll' });
        if (early) d.segs.push({ ta: cue!.t0, tb: cue!.t0 + 0.5, pa: to - 0.2, pb: to, kind: 'click' });
        if (cue && g >= 0) {
          d.cols.push([ta, cue.t0 > tb ? COL.DIM : cue.w1 > tb ? COL.SIGNAL : COL.BONE]);
          if (cue.t0 > tb) d.cols.push([cue.t0, COL.SIGNAL]);
          if (cue.w1 > Math.max(tb, cue.t0)) d.cols.push([cue.w1, COL.BONE]);
          if (cue.ch === '♥') d.cols.push([ta, COL.ROSE]);
        }
      }
    }
    for (const d of this.drums) { d.cols.sort((a, b) => a[0] - b[0]); d.segs.sort((a, b) => a.ta - b.ta); }
  }

  /** 沒有歌詞的窗格：第一拍前把一串字轉上來（紙白，不用跟唱）。 */
  private titleDrums(text: string) {
    const A = this.atlas, chars = Array.from(text);
    const x0 = Math.max(0, Math.floor((LYR.n - chars.length) / 2));
    chars.forEach((ch, i) => {
      const g = A.get(F_LYR, ch), d = this.drums[x0 + i];
      if (!d || g < 0) return;
      const to = 4 + (i % 3), tb = this.tBoot + 0.04 * i;
      for (let k = 1; k < to - 1; k++) d.anchors.set(k, d.fill.length ? FILL + d.fill[Math.floor(hash(d.seed, k) * d.fill.length)]! : -1);
      d.anchors.set(to, g);
      d.segs.push({ ta: tb - 0.6, tb, pa: 0, pb: to, kind: 'roll' });
      d.cols.push([tb - 0.6, COL.BONE]);
    });
  }

  private lastPos(d: Drum, fallback: number) { const s = d.segs[d.segs.length - 1]; return s ? s.pb : fallback; }

  // ---------------------------------------------------------------- 銘牌
  private layoutPlate(body: string) {
    const { audio: au } = this.ctx;
    const e = this.ctx.end;
    const c = this.plate.ctx;
    // 留言的框：編號下面到署名那一列上面（署名自己一列，不會壓到最後一行）
    this.fit = fitText(c, body, F_MSG, PLATE.w - 150, PLATE.h - P_TOP - P_SIG, { min: 44, max: 84, lineHeight: 1.26, maxLines: 4 });
    // 一個詞組一拍（詞組多就半拍），從第一拍的下一拍開始
    const ph = phrases(body.replace(/\s+/g, ' '), 6);
    const t0 = beatAfter(au, this.tBoot + 0.2);
    const n = ph.length + (this.sigText ? 1 : 0);
    let step = n <= 8 ? this.beat : this.beat / 2;
    if (t0 + n * step > e - 0.8) step = Math.max(0.12, (e - 0.8 - t0) / Math.max(1, n));
    // 詞組 → 排好的行裡的字位置（依讀的順序數字，空白不算）
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
      // 一個詞組可能跨行：拆成每行一段
      for (let L = from.line; L <= Math.min(li, lines.length - 1); L++) {
        const a = L === from.line ? from.ch : 0, b = L === li ? ci : lines[L]!.length;
        if (b > a) this.chunks.push({ line: L, from: a, to: b, t: t0 + k * step });
      }
    });
    if (this.sigText) this.sigT = t0 + ph.length * step;
  }

  /** 銘牌的刻字：G = 刻好的字，B = 還在燙的字（刻完 0.6 秒內）。 */
  private drawPlate(t: number) {
    const fit = this.fit!;
    const heatOf = (t0: number) => 1 - clamp((t - t0) / 0.6);
    const shown = this.chunks.filter((k) => t >= k.t);
    const hot = shown.filter((k) => heatOf(k.t) > 0);
    const sigOn = t >= this.sigT, sigHeat = sigOn ? heatOf(this.sigT) : 0;
    const key = `${shown.length}|${hot.map((k) => Math.round(heatOf(k.t) * 12)).join(',')}|${sigOn}|${Math.round(sigHeat * 12)}`;
    if (key === this.plateKey) return;
    this.plateKey = key;
    const L = this.plate, c = L.ctx;
    L.clear();
    c.textBaseline = 'alphabetic';
    // 銘牌的固定字：左上的編號
    c.fillStyle = 'rgb(0,255,0)';
    c.font = font(F.mono(500), 18); c.letterSpacing = '4px';
    const m = this.msg;
    c.fillText(m ? (m.couple ? 'FROM THE COUPLE  ·  新人' : `No.${String(m.n).padStart(3, '0')}`) : 'No.———', 50, 48);
    c.letterSpacing = '0px';
    const x0 = 60, y0 = P_TOP + (PLATE.h - P_TOP - P_SIG - fit.height) / 2 + fit.size * 0.9;
    c.font = font(F_MSG, fit.size);
    const lines = fit.lines.map((l) => Array.from(l));
    const pass = (list: typeof shown, color: (k: (typeof shown)[number]) => string) => {
      for (const k of list) {
        const arr = lines[k.line]!;
        const pre = arr.slice(0, k.from).join(''), part = arr.slice(k.from, k.to).join('');
        c.fillStyle = color(k);
        fillWithHearts(c, part, x0 + c.measureText(pre).width, y0 + k.line * fit.lineHeight, c.fillStyle as string);
      }
    };
    pass(shown, () => 'rgb(0,255,0)');
    // 燙的字：用加的疊在藍色版上（不要蓋掉綠色版）
    c.globalCompositeOperation = 'lighter';
    pass(hot, (k) => `rgba(0,0,255,${heatOf(k.t).toFixed(3)})`);
    c.globalCompositeOperation = 'source-over';
    if (sigOn) {
      c.font = font(F_MSG, Math.max(40, fit.size * 0.62));
      c.textAlign = 'right';
      c.fillStyle = 'rgb(0,255,0)';
      c.fillText(this.sigText, PLATE.w - 60, PLATE.h - 24);
      if (sigHeat > 0) { c.globalCompositeOperation = 'lighter'; c.fillStyle = `rgba(0,0,255,${sigHeat.toFixed(3)})`; c.fillText(this.sigText, PLATE.w - 60, PLATE.h - 24); c.globalCompositeOperation = 'source-over'; }
      c.textAlign = 'left';
    }
    L.upload();
  }

  // ---------------------------------------------------------------- 標籤（畫一次，紅色版＝絹印白漆）
  private drawLabels() {
    const c = this.lab.ctx;
    this.lab.clear();
    c.fillStyle = 'rgb(255,0,0)';
    c.textBaseline = 'alphabetic';
    const ox = -LAB.x, oy = -LAB.y;
    const lab = (x: number, y: number, zh: string, en: string) => {
      c.font = font(F.hei(700), 20); c.letterSpacing = '4px';
      c.fillText(zh, x + ox, y + oy);
      const w = c.measureText(zh).width;
      c.font = font(F.mono(500), 14); c.letterSpacing = '3px';
      c.fillText(en, x + ox + w + 12, y + oy - 1);
      c.letterSpacing = '0px';
    };
    const top = WISH.cy - WISH.winH - 26;
    lab(WISH.x0, top, '今晚收到的祝福', 'WISHES');
    lab(BEATS.x0, top, '本曲心跳', 'HEARTBEATS');
    lab(BPM.x0, top, '每分鐘', 'BPM');
    c.font = font(F.hei(700), 26);
    c.fillText('則', WISH.x0 + WISH.n * WISH.pitch + 14 + ox, WISH.cy + 10 + oy);
    c.fillText('下', BEATS.x0 + BEATS.n * BEATS.pitch + 14 + ox, BEATS.cy + 10 + oy);
    const ly = LYR.cy - LYR.winH - 26;
    lab(LYR.x0, ly, this.pages.length ? '現在唱到' : '純音樂', this.pages.length ? 'NOW SINGING' : 'INSTRUMENTAL');
    // 板子的銘文（歌詞窗的右上）與冷面註腳（銘牌下）
    c.font = font(F.mono(500), 14); c.letterSpacing = '5px';
    c.textAlign = 'right';
    c.fillText(`LOVE ODOMETER  ·  ${COUPLE_EN.toUpperCase()}  ·  ${DATE_DOTS}`, LYR.x0 + LYR.n * LYR.pitch - 10 + ox, ly - 1 + oy);
    c.font = font(F.hei(500), 15); c.letterSpacing = '3px';
    c.fillText('＊本表只進不退，無法歸零。', PLATE.x + PLATE.w + ox, PLATE.y + PLATE.h + 28 + oy);
    c.textAlign = 'left';
    c.letterSpacing = '0px';
  }

  // ---------------------------------------------------------------- 鏡頭
  private camAt(t: number): Cam {
    const s = this.ctx.start;
    const k0 = Math.floor(hash(this.ctx.params.seed ?? 1, 11) * CAMS.length);
    let c: Cam = { ...CAMS[k0]! };
    // 切進來：更斜、更近，第一拍落定
    const open: Cam = { yaw: c.yaw * 1.4, pitch: c.pitch + 0.1, dist: c.dist * 0.93 };
    const ko = prog(t, s, Math.max(s + 0.4, this.tBoot + 0.15), ease.outExpo);
    c = { yaw: lerp(open.yaw, c.yaw, ko), pitch: lerp(open.pitch, c.pitch, ko), dist: lerp(open.dist, c.dist, ko) };
    this.camTimes.forEach((tb, i) => {
      const nx = CAMS[(k0 + i + 1) % CAMS.length]!;
      const k = prog(t, tb - 0.6 * this.beat, tb + 0.15 * this.beat, ease.inOutQuart);
      if (k > 0) c = { yaw: lerp(c.yaw, nx.yaw, k), pitch: lerp(c.pitch, nx.pitch, k), dist: lerp(c.dist, nx.dist, k) };
    });
    c.dist *= 1 - 0.025 * prog(t, s, this.ctx.end);
    return c;
  }

  /** 鏡頭：位置與三個軸（右、上、後）。繞著板子中心轉，預設（0, 0, 1）時板子座標 = 螢幕像素。 */
  private camera(c: Cam) {
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(c.pitch, c.yaw, 0, 'YXZ'));
    const off = new THREE.Vector3(-PIV.x, -PIV.y, FOCAL * c.dist).applyMatrix4(m);
    const pos = new THREE.Vector3(PIV.x, PIV.y, 0).add(off);
    return { pos, m };
  }

  private project(cam: { pos: THREE.Vector3; m: THREE.Matrix4 }, x: number, y: number) {
    const v = new THREE.Vector3(x - 960, 540 - y, 0).sub(cam.pos).applyMatrix4(cam.m.clone().transpose());
    return { x: 960 + (FOCAL * v.x) / -v.z, y: 540 - (FOCAL * v.y) / -v.z };
  }

  private computeAvoid(): [number, number, number, number][] {
    const rects = [
      [LYR.x0 - 16, LYR.cy - LYR.winH - 50, LYR.x0 + LYR.n * LYR.pitch + 16, LYR.cy + LYR.winH + 14],
      [PLATE.x - 8, PLATE.y - 8, PLATE.x + PLATE.w + 8, PLATE.y + PLATE.h + 8],
    ];
    const cams = [...CAMS, ...CAMS.map((c) => ({ yaw: c.yaw * 1.4, pitch: c.pitch + 0.1, dist: c.dist * 0.93 }))];
    return rects.map(([x0, y0, x1, y1]) => {
      let a = Infinity, b = Infinity, c2 = -Infinity, d = -Infinity;
      for (const cm of cams) {
        const cam = this.camera(cm);
        for (const [x, y] of [[x0!, y0!], [x1!, y0!], [x0!, y1!], [x1!, y1!]]) {
          const p = this.project(cam, x, y);
          a = Math.min(a, p.x); b = Math.min(b, p.y); c2 = Math.max(c2, p.x); d = Math.max(d, p.y);
        }
      }
      return [a, b, c2 - a, d - b] as [number, number, number, number];
    });
  }

  // ---------------------------------------------------------------- 每一格
  /** 數字滾輪：值 v（連續）→ 第 j 位（0 = 個位）的位置；低位從 9 滾到 0 時才帶著高位滾（真的里程表）。 */
  private digitPos(v: number, j: number) {
    const p = Math.pow(10, j);
    const hi = Math.floor(v / p);
    const carry = j === 0 ? v - Math.floor(v) : clamp(v - hi * p - (p - 1));
    return hi + carry;
  }

  private writeDrum(i: number, pos: number, glyphAt: (slot: number) => number, code: number, blur: number, inv: number) {
    const k = Math.floor(pos), d = this.data;
    const o0 = i * 4, o1 = (32 + i) * 4;
    d[o0] = glyphAt(k - 1); d[o0 + 1] = glyphAt(k); d[o0 + 2] = glyphAt(k + 1); d[o0 + 3] = glyphAt(k + 2);
    d[o1] = pos; d[o1 + 1] = code; d[o1 + 2] = blur; d[o1 + 3] = inv;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const dg = (slot: number) => this.digits[((slot % 10) + 10) % 10]!;
    // 上排計數器：切進來時從少一點的數字滾到現在的值，落在第一拍
    const blurOf = (fn: (tt: number) => number) => Math.abs(fn(t + 0.008) - fn(t - 0.008)) / 0.016 * 0.03;
    const wishV = (tt: number) => lerp(Math.max(0, this.count - 36), this.count, ease.outCubic(prog(tt, s + 0.05, this.tBoot + 0.05)));
    const bpmV = (tt: number) => lerp(Math.max(0, this.bpm - 24), this.bpm, ease.outCubic(prog(tt, s + 0.05, this.tBoot + 0.12)));
    const beatV = (tt: number) => {
      const b = Math.max(0, au.beatAt(tt)), n = Math.floor(b), fr = b - n;
      const r = clamp(0.2 / au.beatPeriod(tt), 0.1, 0.6);
      return n + 1 + ease.inOutCubic(clamp((fr - (1 - r)) / r));
    };
    for (let j = 0; j < WISH.n; j++) { const pj = (tt: number) => this.digitPos(wishV(tt), WISH.n - 1 - j); this.writeDrum(WISH.si + j, pj(t), dg, COL.BONE, blurOf(pj), 0); }
    for (let j = 0; j < BEATS.n; j++) { const pj = (tt: number) => this.digitPos(beatV(tt), BEATS.n - 1 - j); this.writeDrum(BEATS.si + j, pj(t), dg, COL.BONE, blurOf(pj), j === BEATS.n - 1 ? 1 : 0); }
    for (let j = 0; j < BPM.n; j++) { const pj = (tt: number) => this.digitPos(bpmV(tt), BPM.n - 1 - j); this.writeDrum(BPM.si + j, pj(t), dg, COL.BONE, blurOf(pj), 0); }
    // 歌詞滾輪
    this.drums.forEach((d, j) => {
      const pf = (tt: number) => posAt(d, tt);
      const pos = pf(t);
      let code: number = COL.DIM;
      for (const [tc, cc] of d.cols) { if (tc <= t) code = cc; else break; }
      // 亂數字只在轉動的時候看得到（停住時上下一格是空白）
      const rolling = d.segs.some((sg) => sg.kind === 'roll' && t >= sg.ta && t < sg.tb);
      const glyph = (slot: number) => { const g = d.anchors.get(slot) ?? -1; return g >= FILL && !rolling ? -1 : g; };
      this.writeDrum(LYR.si + j, pos, glyph, code, blurOf(pf), 0);
    });
    this.state.needsUpdate = true;
    this.drawPlate(t);

    const cam = this.camera(this.camAt(t));
    const u = this.bg.u;
    (u.uCP!.value as THREE.Vector3).copy(cam.pos);
    (u.uCR!.value as THREE.Matrix3).setFromMatrix4(cam.m);
    // 對焦在歌詞那一排
    const fc = new THREE.Vector3(LYR.x0 + LYR.n * LYR.pitch * 0.5 - 960, 540 - LYR.cy, 0).distanceTo(cam.pos);
    u.uFocus!.value = fc;
    const lastSheen = this.sheens.filter((tb) => tb <= t).pop();
    u.uSheen!.value = lastSheen !== undefined ? lerp(-300, 1900, prog(t, lastSheen, lastSheen + 0.9, ease.outCubic)) : -9999;
    u.uIn!.value = prog(t, s, s + 0.3, ease.outCubic);
    u.uKick!.value = f.a.kick;
    this.bg.render(renderer, out);
    return { bloom: 0.7, vignette: 0.55, halation: 0.25, popupAvoid: this.avoid };
  }
}

