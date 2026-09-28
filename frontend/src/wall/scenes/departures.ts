// 航班看板（機器 A）：機場大廳裡的一面翻牌出發看板，鏡頭從斜下方仰看、慢慢推近，有一點景深。
// 看板上只有三件事（MV 融合原則：一個焦點，其他都是配角）：
//  - 最大的一塊是主打留言：整塊大字牌（思源宋體，留言的聲音），字牌大小依留言長短自動決定，
//    第一拍之後一個詞組一拍「嘩啦啦」翻上來，最後署名也翻在牌上。這是全畫面最大、最亮的東西。
//  - 上面一列小字牌是這則留言的「航班」：時間、班次 AO042（留言編號）、目的地（四字祝福）、旅客（名字）、狀態「登機中」
//    （燈跟著拍子閃，窗格最後一個小節線「已起飛」）。小、暗，是配角。
//  - 下面兩列中字牌是現正播放的歌詞：一句在第一個字要唱之前翻上來（三成亮），唱到的字再翻一下亮成訊號色、唱完變紙白。
// 沒有主打留言：大字牌那一塊改成放歌詞（焦點是歌詞），下面那兩列收起來。純音樂又沒有留言：大字牌翻上邀請。
// 畫法：全螢幕 shader（departures-glsl.ts）＋鏡頭射線打到看板平面；每一格的翻牌序列在 init 排好，
// 每一格在 CPU 算狀態（純函數），寫進一張小狀態貼圖；字從兩張字模圖集取（_t7.ts）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { ease, lerp, prog, hash, fract } from '../engine/util';
import { beatAfter, barAfter, signature, COUPLE_EN, DATE_DOTS } from './_motifs';
import { GlyphAtlas, cuePages, windowLines, wrapCells, flipAt, settle, COL, cueCol, type Flip, type GlyphReq, type CuePage } from './_t7';
import { FRAG_BOARD, NG } from './departures-glsl';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: false, energy: [0.3, 1], bars: [4, 10] };

// ---------------------------------------------------------------- 版面（看板座標，px，y 往下；預設鏡頭下就是螢幕像素）
const BOARD = { x0: 60, y0: 86, x1: 1860, y1: 1004 };
const X0 = 128;
/** 一個格子區：左上角、每格間距、牌的大小、欄列數、在狀態貼圖的第幾列、用哪張圖集、字的亮度。 */
interface Grid { x: number; y: number; px: number; py: number; w: number; h: number; cols: number; rows: number; r0: number; atlas: number; bright: number; rail?: boolean }
/** 航班列：一列 26 格小字牌（欄與欄之間空一格）。 */
const FL: Grid = { x: X0, y: 178, px: 30, py: 40, w: 27, h: 35, cols: 26, rows: 1, r0: 0, atlas: 0, bright: 0.8, rail: true };
/** 大字牌（主打留言，或沒有留言時的歌詞）可以用的範圍。 */
const MB = { x: X0, y: 252, w: 1640, h: 440 };
/** 歌詞列（有留言時）：兩列 21 格中字牌（字級約 50 px，明顯比留言小）。 */
const LYG: Grid = { x: X0, y: 744, px: 58, py: 80, w: 54, h: 72, cols: 21, rows: 2, r0: 9, atlas: 0, bright: 0.85, rail: true };
/** 署名：大字牌右下角一列小一號的牌（署名不要跟留言一樣大）。 */
const SG_R0 = 11;
const SW = 32, SH = 12;
const MB_R0 = 1;
/** 航班列的欄：起始格、格數。 */
const FC = { time: [0, 5], flight: [6, 5], dest: [12, 4], name: [17, 5], status: [23, 3] } as const;
const FOCAL = 540 / Math.tan((15 * Math.PI) / 180);
/** 鏡頭繞著轉的點（看板中心附近）。 */
const PIV = { x: 900 - 960, y: 540 - 520 };

const F_LY = F.archivo(100, 700);
const F_BD = F.hei(700);
const F_NUM = F.mono(500);
const F_MS = F.ming(700);

const DESTS = ['百年好合', '永浴愛河', '白頭偕老', '永結同心', '花好月圓', '天作之合', '相親相愛', '心心相印', '佳偶天成', '甜甜蜜蜜', '幸福美滿', '一生一世'];
const INVITE = '掃描右下角 QR code，把祝福寫上看板';
const LABELS = `《》出發登機中已起飛一生一世全體賓客${DESTS.join('')}${INVITE}`;

interface Cam { yaw: number; pitch: number; dist: number }
/** 鏡位：從左下仰看為主，每兩小節換一個（緩進小節線）。 */
const CAMS: Cam[] = [
  { yaw: 0.15, pitch: -0.1, dist: 1.02 },
  { yaw: 0.09, pitch: -0.08, dist: 1.0 },
  { yaw: 0.17, pitch: -0.06, dist: 1.03 },
  { yaw: 0.11, pitch: -0.12, dist: 1.01 },
];

const BG = () => new FSPass(FRAG_BOARD, {
  uState: { value: null }, uAtlasA: { value: null }, uAtlasB: { value: null },
  uAGA: { value: new THREE.Vector2(1, 1) }, uAGB: { value: new THREE.Vector2(1, 1) },
  uG: { value: Array.from({ length: NG }, () => new THREE.Vector4()) },
  uGS: { value: Array.from({ length: NG }, () => new THREE.Vector4()) },
  uGX: { value: Array.from({ length: NG }, () => new THREE.Vector4()) },
  uNG: { value: 0 }, uLamp: { value: new THREE.Vector4() },
  uLab: { value: null }, uLabR: { value: new THREE.Vector4(BOARD.x0, BOARD.y0, BOARD.x1 - BOARD.x0, BOARD.y1 - BOARD.y0) },
  uBoard: { value: new THREE.Vector4(BOARD.x0, BOARD.y0, BOARD.x1, BOARD.y1) },
  uCP: { value: new THREE.Vector3(0, 0, FOCAL) }, uCR: { value: new THREE.Matrix3() }, uF: { value: FOCAL }, uFocus: { value: FOCAL },
  uIn: { value: 1 }, uKick: { value: 0 },
});

interface Cell { evs: Flip[]; g0: number; c0: number; fill: number[]; seed: number }

/** 名字塞進 n 格：太長就截斷、最後一格放「…」。 */
function fitName(name: string, n: number) {
  const cs = Array.from(name.replace(/\s*&\s*/g, '&').replace(/\s+/g, ' ').trim());
  return cs.length <= n ? cs.join('') : cs.slice(0, n - 1).join('') + '…';
}

/**
 * 在 MB 裡排一塊大字牌：從最大的牌往下試，找放得下全部字（加上署名）的最大牌。
 * 回傳格子與每個字的位置（列、欄）。
 */
function fitGrid(chars: string[], sigRow: number, maxH: number, minH: number): { g: Grid; rows: number[][] } {
  let best: { g: Grid; rows: number[][] } | null = null;
  for (let h = maxH; h >= minH; h -= 2) {
    const w = Math.round(h * 0.78), px = w + Math.max(4, Math.round(w * 0.07)), py = h + Math.max(8, Math.round(h * 0.14));
    const cols = Math.min(SW, Math.floor((MB.w + (px - w)) / px));
    const rows = wrapCells(chars, cols, true);
    const used = Math.max(...rows.map((r) => r.length), 1);
    best = { g: { x: MB.x, y: MB.y, px, py, w, h, cols: used, rows: rows.length, r0: MB_R0, atlas: 1, bright: 1 }, rows };
    if (rows.length * py - (py - h) + sigRow <= MB.h && rows.length <= LYG.r0 - MB_R0) return best;
  }
  return best!;
}

export default class Departures extends Scene {
  bg = shared('departures.bg', BG);
  /** 小字標籤：整個窗格不變，畫一次、上傳一次。 */
  labels = this.track(new Layer2D(BOARD.x1 - BOARD.x0, BOARD.y1 - BOARD.y0, undefined, { fast: true }));
  small!: GlyphAtlas;
  big!: GlyphAtlas;
  data = new Float32Array(SW * SH * 4);
  state = this.track(new THREE.DataTexture(this.data, SW, SH, THREE.RGBAFormat, THREE.FloatType));
  cells: (Cell | null)[] = new Array(SW * SH).fill(null);
  msg: Msg | null = this.ctx.params.message ?? null;
  mb!: Grid;
  lyg: Grid = { ...LYG };
  sg: Grid = { ...LYG, rows: 0, r0: SG_R0, rail: false };
  tBoot = 0;
  tDep = Infinity;
  beat = 0.5;
  camTimes: number[] = [];
  seed = 1;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    this.seed = this.ctx.params.seed ?? 1;
    this.beat = au.beatPeriod(s + 0.1);
    this.tBoot = beatAfter(au, s + 0.2);
    const lastBar = au.timeOfBar(Math.floor(au.barAt(e - 0.05)));
    if (lastBar > this.tBoot + 3 * this.beat && lastBar < e - 0.2) this.tDep = lastBar;
    for (let k = 2; ; k += 2) { const tb = barAfter(au, s + 0.1, k); if (tb > e - 0.6) break; this.camTimes.push(tb); }

    const m = this.msg;
    const lines = windowLines(lyrics, s, e);
    const title = song.title || '今晚的歌';
    // 署名：「—— 名字」（一格一個字，中間的空白不要佔一格）
    const sig = m ? signature(m.name).replace(/\s+/g, '') : '';
    const flight = this.flight();
    await loadText(LABELS + lines.map((l) => l.text).join('') + (m ? m.text : '') + sig + title + flight.name);

    // ---- 大字牌放什麼：有留言放留言；沒有留言放歌詞；純音樂又沒留言放邀請
    const lyricMode = !m && lines.length > 0;
    const bigText = m ? m.text : INVITE;
    const bigFam = lyricMode ? F_LY : m ? F_MS : F_BD;
    // 字模：A（小）＝航班列、歌詞列；B（大）＝大字牌
    const reqA: GlyphReq[] = [];
    const addA = (family: string, str: string) => { for (const ch of Array.from(str)) reqA.push({ ch, family }); };
    addA(F_LY, lines.map((l) => l.text).join('') + 'AO');
    addA(F_NUM, '0123456789:');
    addA(F_BD, flight.dest + flight.name + '登機中已起飛' + DESTS.join(''));
    const reqB: GlyphReq[] = [];
    for (const ch of Array.from((lyricMode ? lines.map((l) => l.text).join('') : bigText) + sig)) reqB.push({ ch, family: bigFam });
    this.small = this.track(new GlyphAtlas(reqA, 96, 128, { size: 88, mip: true }));
    this.big = this.track(new GlyphAtlas(reqB, 168, 216, { size: 150, mip: true }));
    this.ctx.renderer.initTexture(this.small.tex);
    this.ctx.renderer.initTexture(this.big.tex);
    this.state.minFilter = this.state.magFilter = THREE.NearestFilter;
    const u = this.bg.u;
    u.uAtlasA!.value = this.small.tex; u.uAtlasB!.value = this.big.tex;
    (u.uAGA!.value as THREE.Vector2).set(this.small.cols, this.small.rows);
    (u.uAGB!.value as THREE.Vector2).set(this.big.cols, this.big.rows);
    u.uState!.value = this.state;
    u.uLab!.value = this.labels.texture;

    this.buildFlight(flight);
    if (lyricMode) {
      // 沒有留言：歌詞就是焦點，放大字牌（一句最多三列），下面兩列收起來
      const longest = lines.reduce((a, l) => (Array.from(l.text).length > Array.from(a.text).length ? l : a), lines[0]!);
      const fit = fitGrid(Array.from(longest.text), 0, 190, 96);
      this.mb = { ...fit.g, rows: Math.min(3, fit.g.rows), cols: Math.floor((MB.w + (fit.g.px - fit.g.w)) / fit.g.px) };
      this.mb.cols = Math.min(SW, this.mb.cols);
      const pages = cuePages(lines, this.mb.cols, this.mb.rows, true).filter((p) => p.t1 > s - 0.3 && p.t0 < e - 0.2);
      this.buildLyrics(this.mb, this.big, F_LY, pages, title);
      this.lyg = { ...LYG, rows: 0 };
    } else {
      const fit = fitGrid(Array.from(bigText), sig ? 96 : 0, 230, 96);
      this.mb = fit.g;
      this.buildMessage(fit, Array.from(bigText), Array.from(sig), !!m);
      const pages = cuePages(lines, LYG.cols, LYG.rows).filter((p) => p.t1 > s - 0.3 && p.t0 < e - 0.2);
      // 歌詞列只放用得到的寬度（多出來的空牌很吵）
      const used = Math.max(10, ...pages.flatMap((p) => p.rows.map((r) => r.length)));
      this.lyg = { ...LYG, cols: Math.min(LYG.cols, used), rows: Math.min(LYG.rows, Math.max(1, ...pages.map((p) => p.rows.length))) };
      if (pages.length) this.buildLyrics(this.lyg, this.small, F_LY, pages, '');
      else this.lyg = { ...LYG, rows: 0 };
    }
    const grids = [FL, this.mb, this.lyg, this.sg];
    grids.forEach((g, i) => {
      (u.uG!.value as THREE.Vector4[])[i]!.set(g.x, g.y, g.px, g.py);
      (u.uGS!.value as THREE.Vector4[])[i]!.set(g.w, g.h, g.cols, g.rows);
      (u.uGX!.value as THREE.Vector4[])[i]!.set(g.r0, g.atlas, g.bright, g.rail ? 1 : 0);
    });
    u.uNG!.value = grids.length;
    this.drawLabels();
    this.ctx.renderer.initTexture(this.labels.upload());
  }

  // ---------------------------------------------------------------- 內容
  /** 這則留言的航班（沒有留言：全體賓客飛往一生一世）。 */
  private flight() {
    const m = this.msg;
    const clock = (n: number) => { const mm = 12 * 60 + 5 + ((n * 7) % 300); return `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`; };
    if (!m) return { time: '12:00', code: 'AO000', dest: '一生一世', name: '全體賓客' };
    return { time: clock(m.n), code: `AO${String(m.n % 1000).padStart(3, '0')}`, dest: DESTS[Math.floor(hash(m.n, 7) * DESTS.length)]!, name: fitName(m.couple ? '宣文&孟庭' : m.name || '一位賓客', FC.name[1]) };
  }

  private cell(g: Grid, r: number, c: number): Cell {
    const i = (g.r0 + r) * SW + c;
    let x = this.cells[i];
    if (!x) { x = { evs: [], g0: -1, c0: COL.BONE, fill: [], seed: hash(g.r0 + r, c, this.seed) * 1e6 }; this.cells[i] = x; }
    return x;
  }

  /** 航班列：開機時翻上來；最後一個小節線「已起飛」。 */
  private buildFlight(f: { time: string; code: string; dest: string; name: string }) {
    const A = this.small;
    const numFill = A.ofFamily(F_NUM), bdFill = A.ofFamily(F_BD);
    for (let c = 0; c < FL.cols; c++) if (!Object.values(FC).some(([a, n]) => c >= a && c < a + n)) this.cell(FL, 0, c).g0 = -2;
    const set = (key: keyof typeof FC, str: string, fam: string, colr: number, tl0: number) => {
      const [a, n] = FC[key];
      const cs = Array.from(str);
      for (let k = 0; k < n; k++) {
        const x = this.cell(FL, 0, a + k);
        x.fill = fam === F_NUM ? numFill : bdFill;
        const ff = fam === F_NUM && k < cs.length && /[A-Z]/.test(cs[k]!) ? F_LY : fam;
        x.evs.push({ tl: tl0 + 0.02 * (a + k), g: k < cs.length ? A.get(ff, cs[k]!) : -1, c: colr, k: 5, d: 0.04 });
      }
    };
    const t0 = this.tBoot;
    set('time', f.time, F_NUM, COL.ASH, t0);
    set('flight', f.code, F_NUM, COL.ASH, t0);
    set('dest', f.dest, F_BD, COL.ASH, t0);
    set('name', f.name, F_BD, COL.ASH, t0);
    set('status', '登機中', F_BD, COL.SIGNAL, t0);
    if (Number.isFinite(this.tDep)) set('status', '已起飛', F_BD, COL.ASH, this.tDep - 0.46);
  }

  /** 大字牌的留言：第一拍之後一個詞組一拍（詞組多就半拍）翻上來，最後署名。 */
  private buildMessage(fit: ReturnType<typeof fitGrid>, chars: string[], sig: string[], isMsg: boolean) {
    const { audio: au } = this.ctx;
    const e = this.ctx.end, A = this.big, g = this.mb;
    const fill = A.ofFamily(F_MS).concat(A.ofFamily(F_BD));
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) this.cell(g, r, c).fill = fill;
    const fam = isMsg ? F_MS : F_BD;
    const order: { r: number; c: number; ch: string }[] = [];
    fit.rows.forEach((row, r) => row.forEach((ci, c) => order.push({ r, c, ch: chars[ci]! })));
    const chunks: (typeof order)[] = [];
    let cur: typeof order = [];
    order.forEach((o, i) => {
      cur.push(o);
      const nx = order[i + 1];
      const word = /[\p{Script=Latin}\p{N}'’]/u.test(o.ch) && nx && /[\p{Script=Latin}\p{N}'’]/u.test(nx.ch);
      if (/[，。！？!?,.、~～…；;：:\s]/.test(o.ch) || (cur.length >= 5 && !word) || cur.length >= 12 || !nx || (nx.r !== o.r && cur.length >= 3)) { chunks.push(cur); cur = []; }
    });
    if (cur.length) chunks.push(cur);
    const t0 = beatAfter(au, this.tBoot + 0.05);
    const n = chunks.length + (sig.length ? 1 : 0);
    let step = n <= 8 ? this.beat : this.beat / 2;
    if (t0 + n * step > e - 0.8) step = Math.max(0.1, (e - 0.8 - t0) / Math.max(1, n));
    chunks.forEach((ch, j) => ch.forEach((o, i) => {
      const gi = A.get(fam, o.ch);
      if (gi < 0) return;
      this.cell(g, o.r, o.c).evs.push({ tl: t0 + j * step + i * 0.02, g: gi, c: o.ch === '♥' ? COL.ROSE : isMsg ? COL.BONE : COL.ASH, k: 5, d: 0.045 });
    }));
    if (sig.length) {
      // 署名：大字牌右下角、小一號的一列牌（靠右對齊大字牌）
      const h = Math.round(Math.min(84, Math.max(64, g.h * 0.45))), w = Math.round(h * 0.78), px = w + 5;
      this.sg = { x: g.x + g.cols * g.px - (g.px - g.w) - (sig.length * px - 5), y: g.y + g.rows * g.py + 10, px, py: h + 8, w, h, cols: sig.length, rows: 1, r0: SG_R0, atlas: 1, bright: 0.9, rail: false };
      const ts = t0 + chunks.length * step;
      sig.forEach((ch, k) => {
        const gi = A.get(fam, ch);
        const x = this.cell(this.sg, 0, k);
        x.fill = fill;
        if (gi >= 0) x.evs.push({ tl: ts + k * 0.025, g: gi, c: COL.ASH, k: 4, d: 0.045 });
      });
    }
  }

  /** 歌詞：每一頁在第一個字要唱之前嘩啦啦翻上來（三成亮），唱到的字翻一下亮起來、唱完變紙白。沒有歌詞的時段先翻上歌名。 */
  private buildLyrics(g: Grid, A: GlyphAtlas, fam: string, pages: CuePage[], title: string) {
    const s = this.ctx.start;
    const fill = A.ofFamily(fam);
    const n = g.cols * g.rows;
    const cur: number[] = new Array(n).fill(-1);
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) this.cell(g, r, c).fill = fill;
    const put = (idx: number, ev: Flip) => this.cell(g, Math.floor(idx / g.cols), idx % g.cols).evs.push(ev);
    const first = pages[0];
    if (title && (!first || first.t0 - 0.5 > this.tBoot + 1.6)) {
      const cs = Array.from(title);
      wrapCells(cs, g.cols).slice(0, g.rows).forEach((row, r) => row.forEach((ci, c) => {
        const gi = A.get(fam, cs[ci]!);
        if (gi < 0) return;
        put(r * g.cols + c, { tl: this.tBoot + 0.02 * c, g: gi, c: COL.ASH, k: 5, d: 0.045, seg: -1 });
        cur[r * g.cols + c] = gi;
      }));
    }
    let prevEnd = -1e9;
    for (const [seg, pg] of pages.entries()) {
      const want = new Array(n).fill(null).map(() => ({ g: -1, cue: -1 }));
      pg.rows.forEach((row, r) => row.forEach((ci, c) => { if (r < g.rows) want[r * g.cols + c] = { g: A.get(fam, pg.cues[ci]!.ch), cue: ci }; }));
      const base = Math.max(pg.t0 - 0.45, Math.min(prevEnd + 0.05, pg.t0 - 0.1), s + 0.1);
      let k = 0;
      for (let idx = 0; idx < n; idx++) {
        const w = want[idx]!;
        if (w.g === cur[idx] && w.g < 0) continue;
        const tl = base + 0.012 * k++;
        if (w.cue < 0) { put(idx, { tl, g: -1, c: COL.DIM, k: 2, d: 0.04, seg }); cur[idx] = -1; continue; }
        const cue = pg.cues[w.cue]!;
        put(idx, { tl, g: w.g, c: cueCol(cue, tl), k: 3, d: 0.04, seg });
        cur[idx] = w.g;
        if (cue.ch === '♥' || w.g < 0) continue;
        let tA = tl;
        if (cue.t0 > tl) { put(idx, { tl: cue.t0 + 0.07, g: w.g, c: COL.SIGNAL, k: 0, d: 0.07, seg }); tA = cue.t0 + 0.07; }
        if (cue.w1 > tA) put(idx, { tl: cue.w1, g: w.g, c: COL.BONE, d: 0, seg });
      }
      prevEnd = pg.t1;
    }
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) { const x = this.cell(g, r, c); x.evs = settle(x.evs); }
  }

  // ---------------------------------------------------------------- 小字標籤（畫一次；整個畫面只有這一小群）
  private drawLabels() {
    const c = this.labels.ctx;
    this.labels.clear();
    const ox = -BOARD.x0, oy = -BOARD.y0;
    c.fillStyle = '#fff';
    c.textBaseline = 'alphabetic';
    c.font = font(F.hei(500), 20); c.letterSpacing = '6px';
    c.fillText('出發', X0 + ox, 150 + oy);
    const w = c.measureText('出發').width;
    c.font = font(F.mono(500), 14); c.letterSpacing = '5px';
    c.fillText(`DEPARTURES   ·   ${COUPLE_EN.toUpperCase()}   ·   ${DATE_DOTS}`, X0 + w + 18 + ox, 149 + oy);
    c.letterSpacing = '0px';
  }

  // ---------------------------------------------------------------- 鏡頭
  private camAt(t: number): Cam {
    const s = this.ctx.start;
    const k0 = Math.floor(hash(this.seed, 5) * CAMS.length);
    let c: Cam = { ...CAMS[k0]! };
    this.camTimes.forEach((tb, i) => {
      const nx = CAMS[(k0 + i + 1) % CAMS.length]!;
      const k = prog(t, tb - 0.7 * this.beat, tb + 0.1 * this.beat, ease.inOutQuart);
      if (k > 0) c = { yaw: lerp(c.yaw, nx.yaw, k), pitch: lerp(c.pitch, nx.pitch, k), dist: lerp(c.dist, nx.dist, k) };
    });
    // 慢推：整個窗格往前推一點；切進來的第一拍前從遠一點落定
    c.dist *= 1.02 - 0.045 * ease.inOutCubic(prog(t, s, this.ctx.end)) + 0.05 * (1 - ease.outExpo(prog(t, s, this.tBoot + 0.2)));
    return c;
  }

  private camera(c: Cam) {
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(c.pitch, c.yaw, 0, 'YXZ'));
    const off = new THREE.Vector3(-PIV.x, -PIV.y, FOCAL * c.dist).applyMatrix4(m);
    return { pos: new THREE.Vector3(PIV.x, PIV.y, 0).add(off), m };
  }

  // ---------------------------------------------------------------- 每一格
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const d = this.data;
    for (let i = 0; i < this.cells.length; i++) {
      const x = this.cells[i];
      const o = i * 4;
      if (!x || x.g0 === -2) { d[o] = d[o + 1] = -2; d[o + 2] = 0; d[o + 3] = 0; continue; }
      const st = flipAt(x.evs, t, x.g0, x.c0, x.seed, x.fill);
      d[o] = st.a; d[o + 1] = st.b; d[o + 2] = st.ph; d[o + 3] = st.ca * 16 + st.cb;
    }
    this.state.needsUpdate = true;
    const u = this.bg.u;
    const cam = this.camera(this.camAt(t));
    (u.uCP!.value as THREE.Vector3).copy(cam.pos);
    (u.uCR!.value as THREE.Matrix3).setFromMatrix4(cam.m);
    // 對焦在大字牌中間
    const mc = new THREE.Vector3(this.mb.x + (this.mb.cols * this.mb.px) / 2 - 960, 540 - (this.mb.y + (this.mb.rows * this.mb.py) / 2), 0);
    u.uFocus!.value = mc.distanceTo(cam.pos);
    u.uIn!.value = prog(t, s, s + 0.45, ease.outCubic);
    u.uKick!.value = f.a.kick;
    const blink = t >= this.tBoot && t < this.tDep ? (fract(au.beatAt(t)) < 0.5 ? 1 : 0.12) : 0.04;
    (u.uLamp!.value as THREE.Vector4).set(FL.x + FL.cols * FL.px + 10, FL.y + FL.h / 2, 6, blink);
    this.bg.render(renderer, out);
    return { bloom: 0.6, vignette: 0.55, halation: 0.2 };
  }
}
