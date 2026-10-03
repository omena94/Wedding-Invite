// 里程表（機器 A）：一塊雕刻紋的金屬儀表板，鏡頭斜斜地貼著看（像微距的產品照，遠的地方有一點景深）。
// 畫法：全螢幕 shader（odometer-glsl.ts）從鏡頭射線打到板子上，再畫圓柱滾輪；每個滾輪的位置（轉到哪一格、轉多快）在 CPU 算（純函數）。
// 照「留言尺寸與版面比例標準 v2」：整塊儀表板（一排排會轉的滾輪）是主視覺，留言刻在右下的一塊小銘牌上（字級 40～60）。
//  - 銘牌（≤ 860 × 380）：主題色的金屬，主打留言刻在上面（思源宋體）：第一拍之後一個詞組一拍，剛刻好的字燒紅、冷卻成墨色；
//    最後一行下面署名。沒有留言時銘牌刻邀請（小一點）。
//  - 上面一排滾輪是歌詞（40～52，比留言小）：一句（太長就分頁）在唱之前「嘩」地一起轉上來，停在差一點點的位置（還沒卡進去、三成亮）；
//    唱到的那一刻「喀」一聲卡進定位（彈簧），亮成訊號色；唱完變紙白。
//  - 左下三個大計數器（多補的動畫）：「今晚收到的祝福」切進來時一路滾到現在的則數、「本曲心跳」每一拍滾一格（進位時左邊一格跟著滾）、
//    「每分鐘」滾到這首歌的速度。最右邊那一格反色，像真的里程表。
//  - 每個小節線一道反光掃過整塊板子；鏡頭每兩小節換個角度（緩進小節線），整段慢慢推近，景深對在銘牌上。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { clamp, ease, lerp, prog, hash, springStep } from '../engine/util';
import { fitText, phrases, type FitResult } from '../engine/text';
import { beatAfter, barAfter, signature, lyricAt, lyricSubOf, drawLyricSub, layoutLyric, subStyleFor, COUPLE_ZH, INITIALS, type LyricStyle } from './_motifs';
import { msgMaxFor, lyricV2, sigV2, fitClauses, V2 } from './_v2';
import { fillWithHearts } from '../engine/motifs';
import { GlyphAtlas, cuePages, windowLines, COL, type GlyphReq, type CuePage } from './_t7';
import { FRAG_ODO, NB } from './odometer-glsl';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'machine', paper: false, energy: [0.3, 0.9], bars: [4, 8] };

// ---------------------------------------------------------------- 版面（板子上的座標，px，y 往下；預設鏡頭下就是螢幕像素）
const PANEL = { x0: 96, y0: 96, x1: 1824, y1: 984 };
/** 滾輪組：x0 = 第一個輪面的左邊、中心 y、間距、輪面寬、半徑、每格角度、窗半高、滾輪數、在 state 的起點、字寬。 */
interface Bank { x0: number; cy: number; pitch: number; face: number; R: number; slot: number; winH: number; n: number; si: number; gw: number }
/** 一組數字滾輪（字寬 gw → 其他尺寸照比例；字級約 gw × 0.93）。 */
const digitBank = (x0: number, cy: number, n: number, si: number, gw: number): Bank => ({ x0, cy, pitch: gw + 8, face: gw + 4, R: gw * 1.3, slot: 1.0, winH: gw * 0.82, n, si, gw });
/** 左下三個大計數器（多補的動畫）：今晚收到的祝福、本曲心跳、每分鐘。 */
const WISH = digitBank(150, 470, 4, 0, 60);
const BEATS = digitBank(150, 640, 5, 4, 60);
const BPM = digitBank(150, 810, 3, 9, 60);
/** 歌詞滾輪（上面一排）：字寬依 v2 的歌詞字級決定（init 裡算）。 */
const LYR0: Bank = { x0: 150, cy: 262, pitch: 58, face: 54, R: 74, slot: 1.02, winH: 58, n: 22, si: 12, gw: 52 };
/** 銘牌（主打留言）：右下，下緣停在右下角 QR 區上面。 */
const PLATE = { x: 820, y: 424, w: 860, h: 376 };
/** 銘牌上：上下留白、左右留白、署名跟最後一行的間距。 */
const P_PAD = 34, P_SIDE = 56, SIG_GAP = 12;
/** 韓文歌有原文副行時，歌詞滾輪往上挪多少（讓出一排給原文）。 */
const SUB_UP = 26;
/** 心動指數的指針表（右上）。 */
const GAUGE = { x: 1560, y: 292, r: 104 };
/** state 貼圖的寬（每個滾輪一格）。 */
const SW = 40;
const LAB = { x: PANEL.x0, y: PANEL.y0, w: PANEL.x1 - PANEL.x0, h: PANEL.y1 - PANEL.y0 };
const FOCAL = 540 / Math.tan((15 * Math.PI) / 180);
/** 鏡頭繞著轉的點（板子中心）。 */
const PIV = { x: 900 - 960, y: 540 - 520 };

const F_LYR = F.archivo(100, 800);
/** 滾輪上「路過」的亂數字：字號加上這個數，shader 就畫成暗的（不是這一格要顯示的字）。 */
const FILL = 10000;
const F_DIG = F.archivo(75, 700);
const F_MSG = F.ming(700);
const INVITE = '這塊銘牌還空著：掃描右下角 QR code，把你的祝福刻上來。';
const NOTE = '＊本表只進不退，無法歸零。';
const TEXT = `今晚收到的祝福則本曲心跳下每分鐘${INVITE}${NOTE}`;

interface Cam { yaw: number; pitch: number; dist: number }
const CAMS: Cam[] = [
  { yaw: -0.12, pitch: 0.14, dist: 1.02 },
  { yaw: 0.09, pitch: 0.11, dist: 1.01 },
  { yaw: -0.06, pitch: 0.17, dist: 1.03 },
  { yaw: 0.12, pitch: 0.15, dist: 1.02 },
];

const BG = () => new FSPass(FRAG_ODO, {
  uState: { value: null }, uAtlas: { value: null }, uAG: { value: new THREE.Vector2(1, 1) },
  uLab: { value: null }, uLabR: { value: new THREE.Vector4(LAB.x, LAB.y, LAB.w, LAB.h) },
  uSub: { value: null }, uSubR: { value: new THREE.Vector4(0, 0, 0, 0) },
  uPlate: { value: null }, uPlateR: { value: new THREE.Vector4(PLATE.x, PLATE.y, PLATE.w, PLATE.h) },
  uBA: { value: Array.from({ length: NB }, () => new THREE.Vector4()) },
  uBB: { value: Array.from({ length: NB }, () => new THREE.Vector4()) },
  uBC: { value: Array.from({ length: NB }, () => new THREE.Vector4()) },
  uPanel: { value: new THREE.Vector4(PANEL.x0, PANEL.y0, PANEL.x1, PANEL.y1) },
  uCP: { value: new THREE.Vector3(0, 0, FOCAL) }, uCR: { value: new THREE.Matrix3() }, uF: { value: FOCAL },
  uFocus: { value: FOCAL }, uSheen: { value: -9999 }, uIn: { value: 1 }, uKick: { value: 0 },
  uGauge: { value: new THREE.Vector4(GAUGE.x, GAUGE.y, GAUGE.r, 0) },
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
  data = new Float32Array(SW * 2 * 4);
  state = this.track(new THREE.DataTexture(this.data, SW, 2, THREE.RGBAFormat, THREE.FloatType));
  /** 絹印標籤（畫一次）與銘牌上的刻字（刻一個詞組才重畫一次）。 */
  lab = this.track(new Layer2D(LAB.w, LAB.h, undefined, { fast: true }));
  /** 歌詞滾輪用哪一組尺寸（有銘牌：中；沒有：大）。 */
  LYR: Bank = { ...LYR0 };
  hasPlate = true;
  count = 0;
  bpm = 100;
  msgPx = 48;
  sigPx = 30;
  /** 銘牌的刻字圖層：高度照字的多少（排好版才建）。 */
  plate!: Layer2D;
  /** 銘牌的上緣與高度：只比字多一點邊（v2：容器要輕），下緣固定。 */
  PY = PLATE.y;
  PH = PLATE.h;
  PW = PLATE.w;
  msg: Msg | null = this.ctx.params.message ?? null;
  drums: Drum[] = [];
  digits: number[] = [];
  pages: CuePage[] = [];
  beat = 0.5;
  tBoot = 0;
  /** 銘牌：排好的字、每個詞組刻上去的時間。 */
  fit: FitResult | null = null;
  chunks: { line: number; from: number; to: number; t: number }[] = [];
  sigT = Infinity;
  sigText = '';
  plateFam = F_MSG;
  camTimes: number[] = [];
  sheens: number[] = [];
  private plateKey = '';
  /**
   * 韓文原文副行：一條印在歌詞滾輪下面的字（每格重畫，很小）。沒有副行的窗格是 null，畫面跟原本一樣。
   * 有副行時歌詞滾輪整排往上挪 SUB_UP，讓出一排給原文（下面的計數器標籤不動）。
   */
  sub: Layer2D | null = null;
  subR = { x: 0, y: 0, w: 0, h: 0 };

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    this.beat = au.beatPeriod(s + 0.1);
    this.tBoot = beatAfter(au, s + 0.25);
    const lines = windowLines(lyrics, s, e);
    const m = this.msg;
    const anySub = lines.some((l) => lyricSubOf(l));
    const body = m ? m.text : INVITE;
    this.sigText = m ? signature(m.name) : '';
    await loadText(TEXT + lines.map((l) => l.text).join('') + body + this.sigText + COUPLE_ZH + INITIALS + (song.title ?? ''));
    this.count = Math.min(9999, Math.max(0, this.ctx.live.count));
    let bpm = au.bpm || 100;
    while (bpm > 180) bpm /= 2;
    while (bpm < 60) bpm *= 2;
    this.bpm = Math.round(bpm);
    // 銘牌一直都在（沒有留言時刻邀請）；先排好留言，歌詞的字級要看留言的字級
    this.hasPlate = true;
    this.layoutPlate(body);
    const gw = lyricV2(m ? this.msgPx : null) / 0.93;
    this.LYR = { ...LYR0, gw, face: gw + 4, pitch: gw + 8, R: gw * 1.42, winH: gw * 1.1 };
    if (anySub) {
      // 原文印在滾輪窗下緣與「今晚收到的祝福」標籤之間；滾輪往上挪一點，兩行之間才有空氣
      this.LYR.cy -= SUB_UP;
      const x = this.LYR.x0 - 16, y = this.LYR.cy + this.LYR.winH + 14;
      this.subR = { x, y, w: GAUGE.x - GAUGE.r - 24 - x, h: WISH.cy - WISH.winH - 36 - y };
      this.sub = this.track(new Layer2D(this.subR.w, this.subR.h, undefined, { fast: true }));
    }

    const reqs: GlyphReq[] = [];
    for (const ch of Array.from(lines.map((l) => l.text).join('') + (song.title ?? '') + COUPLE_ZH + INITIALS)) reqs.push({ ch, family: F_LYR });
    for (const ch of '0123456789') reqs.push({ ch, family: F_DIG });
    this.atlas = this.track(new GlyphAtlas(reqs, 112, 160, { size: 104, fill: 0.9, mip: true }));
    this.ctx.renderer.initTexture(this.atlas.tex);
    this.digits = Array.from('0123456789').map((ch) => this.atlas.get(F_DIG, ch));
    this.state.minFilter = this.state.magFilter = THREE.NearestFilter;

    const u = this.bg.u;
    u.uAtlas!.value = this.atlas.tex;
    u.uState!.value = this.state;
    (u.uAG!.value as THREE.Vector2).set(this.atlas.cols, this.atlas.rows);
    this.pages = cuePages(lines, this.LYR.n, 1, true).filter((p) => p.t1 > s - 0.3 && p.t0 < e - 0.2);
    // 滾輪只放用得到的數量（多出來的空滾輪很吵）
    const L = this.LYR;
    // 純音樂時滾輪上的字：歌名 → 新人的名字 → 縮寫，挑第一個放得進滾輪數（最多 20 個）的；
    // 名字是執行時的值，特別長的也不會被截掉一半
    const cap = Math.min(20, SW - L.si);
    const title = [song.title ?? '', COUPLE_ZH, INITIALS].find((x) => x && Array.from(x).length <= cap) ?? INITIALS;
    const need = this.pages.length ? Math.max(...this.pages.map((p) => p.rows[0]!.length)) : Array.from(title).length;
    // （最多 20 個：右上角要留給指針表）
    L.n = Math.max(6, Math.min(20, need, SW - L.si));
    [WISH, BEATS, BPM, L].forEach((b, i) => {
      (u.uBA!.value as THREE.Vector4[])[i]!.set(b.x0, b.cy, b.pitch, b.face);
      (u.uBB!.value as THREE.Vector4[])[i]!.set(b.R, b.slot, b.winH, b.n);
      (u.uBC!.value as THREE.Vector4[])[i]!.set(b.si, b.gw, 0, 0);
    });
    u.uLab!.value = this.lab.texture;
    u.uPlate!.value = this.plate.texture;
    (u.uPlateR!.value as THREE.Vector4).set(PLATE.x, this.PY, this.PW, this.PH);

    this.buildLyrics();
    // 純音樂（這個窗格沒有歌詞）：滾輪轉上歌名（太長就轉上新人的名字）
    if (!this.pages.length) this.titleDrums(title);
    this.drawLabels();
    this.ctx.renderer.initTexture(this.lab.upload());
    for (let k = 2; ; k += 2) { const tb = barAfter(au, s + 0.1, k); if (tb > e - 0.6) break; this.camTimes.push(tb); }
    for (let k = 0; ; k++) { const tb = barAfter(au, s + 0.05, k); if (tb > e) break; this.sheens.push(tb); }
  }

  // ---------------------------------------------------------------- 歌詞滾輪
  private buildLyrics() {
    const s = this.ctx.start, A = this.atlas;
    const fill = A.ofFamily(F_LYR);
    const N = this.LYR.n;
    for (let j = 0; j < N; j++) this.drums.push({ segs: [], anchors: new Map([[0, -1]]), fill, cols: [[-1e9, COL.DIM]], seed: hash(j, this.ctx.params.seed ?? 1) * 1e6 });
    const slotOf = new Array(N).fill(0);
    /** 每個滾輪上現在的字什麼時候唱完：還在唱的字不能被轉走。 */
    const busy = new Array(N).fill(-1e9);
    for (const pg of this.pages) {
      const row = pg.rows[0]!;
      for (let j = 0; j < N; j++) {
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
    const x0 = Math.max(0, Math.floor((this.LYR.n - chars.length) / 2));
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
    const c = this.lab.ctx;
    // 字級照 v2（依字數定上限、照子句斷行）；署名跟在最後一行下面，排版時先扣掉署名那一列
    const w = PLATE.w - 2 * P_SIDE;
    if (this.msg) {
      const max = msgMaxFor(body), h = PLATE.h - 2 * P_PAD - sigV2(max) - SIG_GAP;
      const o = { min: V2.msgMin, max, lineHeight: 1.26, maxLines: 6 };
      this.fit = fitClauses(c, body, F_MSG, w, h, o) ?? fitText(c, body, F_MSG, w, h, o);
    } else this.fit = fitText(c, body, F_MSG, w, 200, { min: 34, max: 40, lineHeight: 1.3, maxLines: 3 });
    this.msgPx = this.fit.size;
    this.sigPx = sigV2(this.fit.size);
    const blockH = this.fit.height + (this.msg ? SIG_GAP + this.sigPx : 0);
    this.PH = Math.round(Math.max(200, Math.min(PLATE.h, blockH + 2 * P_PAD + 16)));
    this.PY = PLATE.y + PLATE.h - this.PH;
    // 寬度也只比字多一點（短留言的銘牌是一塊小牌子）
    c.font = font(F_MSG, this.sigPx);
    const sigW = this.msg ? c.measureText(this.sigText).width : 0;
    this.PW = Math.round(Math.max(440, Math.min(PLATE.w, Math.max(this.fit.width, sigW) + 2 * P_SIDE)));
    this.plate = this.track(new Layer2D(this.PW, this.PH, undefined, { fast: true }));
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
    // 整塊（留言＋署名）在銘牌上下置中
    const blockH = fit.height + (this.sigText ? SIG_GAP + this.sigPx : 0);
    const x0 = P_SIDE, y0 = (this.PH - blockH) / 2 + fit.size * 0.9;
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
      // 署名：最後一行下面、靠右
      c.font = font(F_MSG, this.sigPx);
      c.textAlign = 'right';
      c.fillStyle = 'rgb(0,255,0)';
      const sy = y0 + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.25 + SIG_GAP + this.sigPx;
      c.fillText(this.sigText, this.PW - P_SIDE, sy);
      if (sigHeat > 0) { c.globalCompositeOperation = 'lighter'; c.fillStyle = `rgba(0,0,255,${sigHeat.toFixed(3)})`; c.fillText(this.sigText, this.PW - P_SIDE, sy); c.globalCompositeOperation = 'source-over'; }
      c.textAlign = 'left';
    }
    L.upload();
  }

  // ---------------------------------------------------------------- 韓文原文副行
  /**
   * 原文小一號印在歌詞滾輪下面（跟滾輪第一格靠左對齊），照原文自己的逐字時間：R 版 = 還沒唱、G 版 = 唱到／唱完。
   * shader 當成印在板子上的字（跟著鏡頭的透視與景深）。
   */
  private drawSub(t: number) {
    const u = this.bg.u;
    const R = u.uSubR!.value as THREE.Vector4;
    const ly = this.sub ? lyricAt(this.ctx.lyrics, t) : null;
    const sub = ly ? lyricSubOf(ly.line) : null;
    // 沒有副行：清掉貼圖（板子的 shader 是共用的，不能留著上一個窗格已經釋放的圖層）
    if (!this.sub || !ly || !sub) { R.set(0, 0, 0, 0); u.uSub!.value = null; return; }
    const L = this.sub, c = L.ctx, S = this.subR;
    L.clear();
    const main = this.LYR.gw * 0.93;
    const st: LyricStyle = { family: F_LYR, size: main, maxWidth: S.w - 32, align: 'left', active: 'rgb(0,255,0)', sung: 'rgb(0,255,0)', unsung: 'rgb(255,0,0)' };
    const sl = layoutLyric(c, sub, subStyleFor(st, main));
    c.save();
    // 字頂離滾輪窗的斜角約一個副行字高的七成（斜斜地看時窗框的影子會吃掉一點）
    c.translate(16, sl.size * 0.84 + 10);
    drawLyricSub(c, sub, t, st, main, ly.k);
    c.restore();
    u.uSub!.value = L.upload();
    R.set(S.x, S.y, S.w, S.h);
  }

  // ---------------------------------------------------------------- 標籤（畫一次，紅色版＝絹印白漆）：整個畫面只有兩小群小字
  private drawLabels() {
    const c = this.lab.ctx;
    this.lab.clear();
    c.fillStyle = 'rgb(255,0,0)';
    c.textBaseline = 'alphabetic';
    const ox = -LAB.x, oy = -LAB.y;
    // 三個計數器：上面一行小標籤、右邊單位
    const lab = (b: Bank, zh: string, unit: string) => {
      c.font = font(F.hei(500), 17); c.letterSpacing = '4px';
      c.fillText(zh, b.x0 + ox, b.cy - b.winH - 16 + oy);
      if (unit) { c.font = font(F.hei(500), 20); c.fillText(unit, b.x0 + b.n * b.pitch + 12 + ox, b.cy + 8 + oy); }
    };
    lab(WISH, '今晚收到的祝福', '則');
    lab(BEATS, '本曲心跳', '下');
    lab(BPM, '每分鐘', 'BPM');
    // 指針表下的標籤與冷面註腳（銘牌下）
    c.font = font(F.hei(500), 17); c.letterSpacing = '4px'; c.textAlign = 'center';
    c.fillText('心動指數', GAUGE.x + ox, GAUGE.y + GAUGE.r + 44 + oy);
    c.textAlign = 'left';
    c.font = font(F.hei(500), 15); c.letterSpacing = '3px';
    c.fillText(NOTE, PLATE.x + ox, PLATE.y + PLATE.h + 30 + oy);
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
    const o0 = i * 4, o1 = (SW + i) * 4;
    d[o0] = glyphAt(k - 1); d[o0 + 1] = glyphAt(k); d[o0 + 2] = glyphAt(k + 1); d[o0 + 3] = glyphAt(k + 2);
    d[o1] = pos; d[o1 + 1] = code; d[o1 + 2] = blur; d[o1 + 3] = inv;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const dg = (slot: number) => this.digits[((slot % 10) + 10) % 10]!;
    const blurOf = (fn: (tt: number) => number) => Math.abs(fn(t + 0.008) - fn(t - 0.008)) / 0.016 * 0.03;
    const beatV = (tt: number) => {
      const b = Math.max(0, au.beatAt(tt)), n = Math.floor(b), fr = b - n;
      const r = clamp(0.2 / au.beatPeriod(tt), 0.1, 0.6);
      return n + 1 + ease.inOutCubic(clamp((fr - (1 - r)) / r));
    };
    // 切進來時從少一點的數字一路滾到現在的值，落在第一拍
    const wishV = (tt: number) => lerp(Math.max(0, this.count - 36), this.count, ease.outCubic(prog(tt, s + 0.05, this.tBoot + 0.05)));
    const bpmV = (tt: number) => lerp(Math.max(0, this.bpm - 24), this.bpm, ease.outCubic(prog(tt, s + 0.05, this.tBoot + 0.12)));
    for (let j = 0; j < WISH.n; j++) { const pj = (tt: number) => this.digitPos(wishV(tt), WISH.n - 1 - j); this.writeDrum(WISH.si + j, pj(t), dg, COL.BONE, blurOf(pj), j === WISH.n - 1 ? 1 : 0); }
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
      this.writeDrum(this.LYR.si + j, pos, glyph, code, blurOf(pf), 0);
    });
    this.state.needsUpdate = true;
    if (this.hasPlate) this.drawPlate(t);
    this.drawSub(t);

    const cam = this.camera(this.camAt(t));
    const u = this.bg.u;
    (u.uCP!.value as THREE.Vector3).copy(cam.pos);
    (u.uCR!.value as THREE.Matrix3).setFromMatrix4(cam.m);
    // 對焦在銘牌上（留言）；沒有留言時對在歌詞
    const L = this.LYR;
    const fp = this.msg ? { x: PLATE.x + this.PW / 2, y: this.PY + this.PH / 2 } : { x: L.x0 + (L.n * L.pitch) / 2, y: L.cy };
    const fc = new THREE.Vector3(fp.x - 960, 540 - fp.y, 0).distanceTo(cam.pos);
    u.uFocus!.value = fc;
    const lastSheen = this.sheens.filter((tb) => tb <= t).pop();
    u.uSheen!.value = lastSheen !== undefined ? lerp(-300, 1900, prog(t, lastSheen, lastSheen + 0.9, ease.outCubic)) : -9999;
    u.uIn!.value = prog(t, s, s + 0.3, ease.outCubic);
    u.uKick!.value = f.a.kick;
    // 指針：跟著音量與大鼓擺（彈簧感：大鼓的衰減），小節線後 0.3 秒衝過紅區「超出量表」
    const lb = this.sheens.filter((tb) => tb <= t).pop();
    let v = 0.28 + 0.55 * au.env('rms', t) + 0.3 * au.hit('kick', t, 0.16);
    if (lb !== undefined && t - lb < 0.45) v = lerp(1.08, v, ease.inCubic(clamp((t - lb) / 0.45)));
    (u.uGauge!.value as THREE.Vector4).w = -2.1 + 4.2 * clamp(v, 0, 1.08) * prog(t, s, s + 0.4, ease.outCubic);
    this.bg.render(renderer, out);
    return { bloom: 0.65, vignette: 0.6, halation: 0.22 };
  }
}

