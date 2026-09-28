// 航班看板（機器 A）：機場的翻牌出發看板。目的地都是祝福、班次是留言編號，字牌在拍點嘩啦啦地翻。
// 畫法：整張看板是一個全螢幕 shader（departures-glsl.ts）。每一格翻牌的序列（什麼時候翻到哪個字、中途亂翻幾張）在 init 排好，
// 每一格在 CPU 算出「現在從哪個字翻到哪個字、翻到哪」（純函數），寫進一張 32×12 的狀態貼圖；字從字模圖集取（_t7.ts）。
//  - 上方「現正播放」兩列大字牌：一行歌詞在第一個字要唱之前嘩啦啦翻上來（三成亮），唱到的字再翻一下亮成訊號色、唱完變紙白。
//  - 中間四班「祝福航班」：時間、班次 AO042（留言編號）、目的地（四字祝福）、旅客（留言的名字）、狀態。
//    第一班是主打留言（登機中，燈跟著拍子閃；窗格最後一個小節線「已起飛」），其他三班每兩小節整排換一次。
//  - 下方「旅客留言」三列字牌（思源宋體，留言的聲音）：第一拍之後一個詞組一拍地翻上來，最後署名。
//  - 右邊一欄：今晚收到幾則祝福（大字牌）與登機須知（冷笑話）。這一欄只是裝飾，即時小卡可以蓋。
// 字牌是平面正視（跟翻頁鐘的立體大牌、里程表的滾輪不一樣）：這個版面的看點是整面牆一起翻的「文字壓力」。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { ease, prog, hash, fract } from '../engine/util';
import { beatAfter, barAfter, signature, COUPLE_EN, DATE_DOTS } from './_motifs';
import { GlyphAtlas, cuePages, windowLines, wrapCells, flipAt, settle, COL, cueCol, type Flip, type GlyphReq, type CuePage } from './_t7';
import { FRAG_BOARD, NG } from './departures-glsl';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: false, energy: [0.3, 1], bars: [4, 10] };

// ---------------------------------------------------------------- 版面（邏輯像素，y 往下）
const X0 = 120;
/** 一個格子區：左上角、每格間距、牌的大小、欄列數、在狀態貼圖的第幾列開始。 */
interface Grid { x: number; y: number; px: number; py: number; w: number; h: number; cols: number; rows: number; r0: number }
/** 現正播放：兩列 19 格大字牌（字級約 54 px）。 */
const LY: Grid = { x: X0, y: 226, px: 64, py: 88, w: 60, h: 80, cols: 19, rows: 2, r0: 0 };
/** 航班：一列 26 格（欄與欄之間空一格）。 */
const FL: Grid = { x: X0, y: 452, px: 44, py: 62, w: 40, h: 54, cols: 26, rows: 4, r0: 2 };
/** 旅客留言：22 格 × 3 列（字級約 45 px）；留言排不下時 4 列，整塊往上挪一列、航班少一班。 */
const MS: Grid = { x: X0, y: 752, px: 54, py: 72, w: 50, h: 66, cols: 22, rows: 3, r0: 6 };
/** 右邊：今晚收到幾則祝福。 */
const CT: Grid = { x: 1450, y: 276, px: 118, py: 160, w: 110, h: 148, cols: 3, rows: 1, r0: 10 };
const SW = 32, SH = 12;
/** 航班表的欄：起始格、格數。 */
const FC = { time: [0, 5], flight: [6, 5], dest: [12, 4], name: [17, 5], status: [23, 3] } as const;
const LAMP_X = FL.x + FL.cols * FL.px + 12;

/** 字族：歌詞的聲音（Archivo，中文接思源黑體）、看板（思源黑體）、數字（Plex Mono）、留言的聲音（思源宋體）。 */
const F_LY = F.archivo(100, 700);
const F_BD = F.hei(700);
const F_NUM = F.mono(500);
const F_MS = F.ming(700);

const DESTS = ['百年好合', '永浴愛河', '白頭偕老', '永結同心', '花好月圓', '天作之合', '相親相愛', '心心相印', '佳偶天成', '甜甜蜜蜜', '幸福美滿', '一生一世'];
/** 沒有別的留言可以排班時的旅客（伴郎伴娘、狗狗也要搭飛機）。 */
const EXTRA = ['全體賓客', '伴郎團', '伴娘團', '芃芃', 'QQ', '親友團', '同學會', '同事們'];
const STATUS = ['準時', '準時', '直飛', '滿座'];
const INVITE = '歡迎登機：掃描右下角 QR code，把你的祝福寫上大螢幕。';
const LABELS = `《》出發現正播放純音樂時間班次目的地旅客狀態登機中已起飛旅客留言新人廣播空位今晚收到的祝福則本站航班皆為單程目的地：永遠行李限重：兩顆心${DESTS.join('')}${EXTRA.join('')}${STATUS.join('')}${INVITE}`;

const BG = () => new FSPass(FRAG_BOARD, {
  uState: { value: null }, uAtlas: { value: null }, uAG: { value: new THREE.Vector2(1, 1) },
  uG: { value: Array.from({ length: NG }, () => new THREE.Vector4()) },
  uGS: { value: Array.from({ length: NG }, () => new THREE.Vector4()) },
  uGR: { value: new Array(NG).fill(0) }, uNG: { value: 0 },
  uLamp: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) },
  uT: { value: 0 }, uKick: { value: 0 }, uIn: { value: 1 }, uRule: { value: 190 },
});

interface Cell { evs: Flip[]; g0: number; c0: number; fill: number[]; seed: number }
interface Flight { time: string; code: string; dest: string; name: string; status: string; hot: boolean }

/** 名字塞進 n 格：太長就截斷、最後一格放「…」。 */
function fitName(name: string, n: number) {
  // 「宣文 & 孟庭」→「宣文&孟庭」：一格一個字，空白很浪費
  const cs = Array.from(name.replace(/\s*&\s*/g, '&').replace(/\s+/g, ' ').trim());
  return cs.length <= n ? cs.join('') : cs.slice(0, n - 1).join('') + '…';
}

export default class Departures extends Scene {
  bg = shared('departures.bg', BG);
  /** 表頭、欄名、標籤：整個窗格不變，畫一次、上傳一次。 */
  labels = this.track(new Layer2D(W, H, undefined, { fast: true }));
  atlas!: GlyphAtlas;
  data = new Float32Array(SW * SH * 4);
  state = this.track(new THREE.DataTexture(this.data, SW, SH, THREE.RGBAFormat, THREE.FloatType));
  cells: (Cell | null)[] = new Array(SW * SH).fill(null);
  msg: Msg | null = this.ctx.params.message ?? null;
  msGrid: Grid = { ...MS };
  flRows = FL.rows;
  tBoot = 0;
  tDep = Infinity;
  beat = 0.5;
  pages: CuePage[] = [];
  avoid: [number, number, number, number][] = [];
  private labelsUp = false;

  override async init() {
    const { audio: au, lyrics, song, live } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    this.beat = au.beatPeriod(s + 0.1);
    this.tBoot = beatAfter(au, s + 0.2);
    // 主打留言在最後一個小節線「已起飛」（窗格太短就不飛）
    const lastBar = au.timeOfBar(Math.floor(au.barAt(e - 0.05)));
    if (lastBar > this.tBoot + 3 * this.beat && lastBar < e - 0.2) this.tDep = lastBar;

    const lines = windowLines(lyrics, s, e);
    this.pages = cuePages(lines, LY.cols, LY.rows).filter((p) => p.t1 > s - 0.3 && p.t0 < e - 0.2);
    const flights = this.makeFlights();
    const m = this.msg;
    const body = m ? m.text : INVITE;
    const sig = m ? signature(m.name) : '';
    const title = song.title || '今晚的歌';
    await loadText(LABELS + lines.map((l) => l.text).join('') + body + sig + title + (song.artist ?? '') + flights.map((f) => f.name).join(''));

    // 字模圖集：每個字族各自一套（同一個字在看板與留言裡是不同字型）
    const reqs: GlyphReq[] = [];
    const add = (family: string, str: string) => { for (const ch of Array.from(str)) reqs.push({ ch, family }); };
    add(F_LY, lines.map((l) => l.text).join('') + title + (song.artist ?? '') + 'AO');
    add(F_NUM, '0123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    add(F_BD, flights.map((f) => f.dest + f.name + f.status).join('') + '登機中已起飛' + DESTS.join(''));
    add(F_MS, body + sig);
    this.atlas = this.track(new GlyphAtlas(reqs, 96, 128, { size: 88, mip: true }));
    this.ctx.renderer.initTexture(this.atlas.tex);

    this.state.minFilter = this.state.magFilter = THREE.NearestFilter;
    const u = this.bg.u;
    u.uAtlas!.value = this.atlas.tex;
    u.uState!.value = this.state;
    (u.uAG!.value as THREE.Vector2).set(this.atlas.cols, this.atlas.rows);

    // 留言：先斷列，決定要不要 4 列
    const msChars = Array.from(body);
    let msRows = wrapCells(msChars, MS.cols);
    if (msRows.length > MS.rows) {
      this.msGrid = { ...MS, y: MS.y - MS.py, rows: 4 };
      this.flRows = 3;
      msRows = msRows.slice(0, 4);
    }

    this.buildBand(title + (song.artist ? `  ${song.artist}` : ''));
    this.buildFlights(flights);
    this.buildMessage(msChars, msRows, sig, !!m);
    this.buildCount(live.count);

    const grids = [LY, { ...FL, rows: this.flRows }, this.msGrid, CT];
    grids.forEach((g, i) => {
      (u.uG!.value as THREE.Vector4[])[i]!.set(g.x, g.y, g.px, g.py);
      (u.uGS!.value as THREE.Vector4[])[i]!.set(g.w, g.h, g.cols, g.rows);
      (u.uGR!.value as number[])[i] = g.r0;
    });
    u.uNG!.value = grids.length;

    this.drawLabels(title);
    this.ctx.renderer.initTexture(this.labels.upload());
    // 即時小卡避開：現正播放、旅客留言（航班表與右邊一欄是裝飾，可以蓋）
    const mg = this.msGrid;
    this.avoid = [
      [LY.x - 14, LY.y - 40, LY.cols * LY.px + 24, LY.rows * LY.py + 40],
      [mg.x - 14, mg.y - 40, mg.cols * mg.px + 24, mg.rows * mg.py + 40],
    ];
  }

  // ---------------------------------------------------------------- 內容
  /** 航班：其他留言（依編號）當旅客；沒有別的留言就用固定的旅客（伴郎團、芃芃、QQ…）。 */
  private makeFlights(): Flight[] {
    const m = this.msg;
    const all: Msg[] = (this.ctx.params.messages ?? []).filter((x: Msg) => !m || x.id !== m.id);
    const others = [...all].sort((a, b) => a.n - b.n);
    const seed = this.ctx.params.seed ?? 1;
    const clock = (n: number) => { const mm = 12 * 60 + 5 + ((n * 7) % 300); return `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`; };
    const dest = (n: number) => DESTS[Math.floor(hash(n, seed) * DESTS.length)]!;
    const out: Flight[] = [];
    // 第一班：主打留言（沒有就是「全體賓客」飛往「永遠」）
    if (m) out.push({ time: clock(m.n), code: `AO${String(m.n % 1000).padStart(3, '0')}`, dest: dest(m.n), name: fitName(m.name || '一位賓客', FC.name[1]), status: '登機中', hot: true });
    else out.push({ time: '12:00', code: 'AO000', dest: '一生一世', name: '全體賓客', status: '登機中', hot: true });
    const n = Math.max(12, others.length);
    for (let i = 0; i < n; i++) {
      const o = others[i % Math.max(1, others.length)];
      if (o && i < others.length) out.push({ time: clock(o.n), code: `AO${String(o.n % 1000).padStart(3, '0')}`, dest: dest(o.n), name: fitName(o.name || '一位賓客', FC.name[1]), status: STATUS[Math.floor(hash(o.n, 3) * STATUS.length)]!, hot: false });
      else { const k = i - others.length; out.push({ time: clock(900 + k * 5), code: `AO${String(900 + k).padStart(3, '0')}`, dest: dest(900 + k), name: EXTRA[k % EXTRA.length]!, status: STATUS[k % STATUS.length]!, hot: false }); }
    }
    return out;
  }

  private cell(g: Grid, r: number, c: number): Cell {
    const i = (g.r0 + r) * SW + c;
    let x = this.cells[i];
    if (!x) { x = { evs: [], g0: -1, c0: COL.BONE, fill: [], seed: hash(g.r0 + r, c, this.ctx.params.seed ?? 1) * 1e6 }; this.cells[i] = x; }
    return x;
  }

  /** 現正播放：每一頁在第一個字要唱之前嘩啦啦翻上來（三成亮），唱到的字翻一下亮起來、唱完變紙白。 */
  private buildBand(title: string) {
    const s = this.ctx.start, A = this.atlas;
    const fill = A.ofFamily(F_LY);
    const cur: number[] = new Array(LY.cols * LY.rows).fill(-1);
    for (let r = 0; r < LY.rows; r++) for (let c = 0; c < LY.cols; c++) this.cell(LY, r, c).fill = fill;
    const put = (idx: number, ev: Flip) => { const r = Math.floor(idx / LY.cols), c = idx % LY.cols; this.cell(LY, r, c).evs.push(ev); };
    // 沒有歌詞（純音樂），或第一句還要等好一陣子：先翻上歌名
    const first = this.pages[0];
    if (!first || first.t0 - 0.5 > this.tBoot + 1.6) {
      const cs = Array.from(title);
      const rows = wrapCells(cs, LY.cols).slice(0, LY.rows);
      let k = 0;
      rows.forEach((row, r) => row.forEach((ci, c) => {
        const g = A.get(F_LY, cs[ci]!);
        if (g < 0) return;
        put(r * LY.cols + c, { tl: this.tBoot + 0.02 * k++, g, c: COL.ASH, k: 5, d: 0.045, seg: -1 });
        cur[r * LY.cols + c] = g;
      }));
    }
    let prevEnd = -1e9;
    for (const [seg, pg] of this.pages.entries()) {
      const want: { g: number; cue: number }[] = new Array(LY.cols * LY.rows).fill(null).map(() => ({ g: -1, cue: -1 }));
      pg.rows.forEach((row, r) => row.forEach((ci, c) => { want[r * LY.cols + c] = { g: A.get(F_LY, pg.cues[ci]!.ch), cue: ci }; }));
      // 翻上來的時間：第一個字前 0.45 秒；前一句接得很緊就等它唱完（但不晚於第一個字前 0.1 秒）
      const base = Math.max(pg.t0 - 0.45, Math.min(prevEnd + 0.05, pg.t0 - 0.1), s + 0.1);
      let k = 0;
      for (let idx = 0; idx < want.length; idx++) {
        const w = want[idx]!;
        if (w.g === cur[idx] && w.g < 0) continue;
        const tl = base + 0.012 * k++;
        if (w.cue < 0) { put(idx, { tl, g: -1, c: COL.DIM, k: 2, d: 0.04, seg }); cur[idx] = -1; continue; }
        const cue = pg.cues[w.cue]!;
        put(idx, { tl, g: w.g, c: cueCol(cue, tl), k: 3, d: 0.04, seg });
        cur[idx] = w.g;
        if (cue.ch === '♥' || w.g < 0) continue;
        // 唱到的那一刻再翻一次（同一個字，三成亮 → 訊號色），唱完直接變紙白
        let tA = tl;
        if (cue.t0 > tl) { put(idx, { tl: cue.t0 + 0.07, g: w.g, c: COL.SIGNAL, k: 0, d: 0.07, seg }); tA = cue.t0 + 0.07; }
        if (cue.w1 > tA) put(idx, { tl: cue.w1, g: w.g, c: COL.BONE, d: 0, seg });
      }
      prevEnd = pg.t1;
    }
    // 事件依時間排好（翻牌序列要照順序走）
    for (let r = 0; r < LY.rows; r++) for (let c = 0; c < LY.cols; c++) { const x = this.cell(LY, r, c); x.evs = settle(x.evs); }
  }

  /** 航班：開機時整面翻上來；之後每兩小節，第 2～4 班整排往上換（從左到右一波）。 */
  private buildFlights(fl: Flight[]) {
    const { audio: au } = this.ctx;
    const e = this.ctx.end, s = this.ctx.start, A = this.atlas;
    const numFill = A.ofFamily(F_NUM), bdFill = A.ofFamily(F_BD);
    const cyc: number[] = [this.tBoot];
    for (let k = 2; ; k += 2) { const tc = barAfter(au, s + 0.1, k); if (tc > e - 0.9) break; cyc.push(tc); }
    const rowAt = (r: number, ci: number): Flight => (r === 0 ? fl[0]! : fl[1 + ((ci * (this.flRows - 1) + r - 1) % (fl.length - 1))]!);
    for (let r = 0; r < FL.rows; r++) {
      // 沒有用到的欄（欄與欄之間的空位）與沒有排的列：沒有牌
      for (let c = 0; c < FL.cols; c++) {
        const col = Object.values(FC).find(([a, n]) => c >= a && c < a + n);
        const x = this.cell(FL, r, c);
        if (!col || r >= this.flRows) { x.g0 = -2; continue; }
      }
      if (r >= this.flRows) continue;
      cyc.forEach((tc, ci) => {
        if (r === 0 && ci > 0) return; // 第一班（主打）不換
        const f = rowAt(r, ci);
        const set = (key: keyof typeof FC, str: string, fam: string, colr: number) => {
          const [a, n] = FC[key];
          const cs = Array.from(str);
          for (let k = 0; k < n; k++) {
            const x = this.cell(FL, r, a + k);
            x.fill = fam === F_NUM ? numFill : bdFill;
            // 班次的英文字母用 Archivo（圓的 O），數字用 Plex Mono：AO042 才不會讀成 A0042
            const ff = fam === F_NUM && k < cs.length && /[A-Z]/.test(cs[k]!) ? F_LY : fam;
            const g = k < cs.length ? A.get(ff, cs[k]!) : -1;
            const tl = tc + 0.016 * (a + k) + 0.05 * r + (ci === 0 ? 0.06 : 0);
            x.evs.push({ tl, g, c: colr, k: ci === 0 ? 6 : 4, d: 0.042 });
          }
        };
        set('time', f.time, F_NUM, COL.BONE);
        set('flight', f.code, F_NUM, f.hot ? COL.SIGNAL : COL.ASH);
        set('dest', f.dest, F_BD, COL.BONE);
        set('name', f.name, F_BD, COL.BONE);
        set('status', f.status, F_BD, f.hot ? COL.SIGNAL : COL.ASH);
      });
    }
    // 主打這班在最後一個小節線起飛
    if (Number.isFinite(this.tDep)) {
      const [a, n] = FC.status;
      const cs = Array.from('已起飛');
      for (let k = 0; k < n; k++) this.cell(FL, 0, a + k).evs.push({ tl: this.tDep + 0.03 * k, g: A.get(F_BD, cs[k] ?? ' '), c: COL.BONE, k: 3, d: 0.04 });
    }
    for (let r = 0; r < FL.rows; r++) for (let c = 0; c < FL.cols; c++) this.cell(FL, r, c).evs.sort((a, b) => a.tl - b.tl);
  }

  /** 旅客留言：第一拍之後一個詞組一拍（詞組多就半拍）翻上來，最後署名。 */
  private buildMessage(chars: string[], rows: number[][], sig: string, isMsg: boolean) {
    const { audio: au } = this.ctx;
    const e = this.ctx.end, A = this.atlas, g = this.msGrid;
    const fill = A.ofFamily(F_MS);
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) this.cell(g, r, c).fill = fill;
    // 讀的順序 → 格子
    const order: { r: number; c: number; ch: string }[] = [];
    rows.forEach((row, r) => row.forEach((ci, c) => order.push({ r, c, ch: chars[ci]! })));
    // 詞組：遇到標點或空白就斷，最多 5 格；英文字不從中間斷
    const chunks: (typeof order)[] = [];
    let cur: typeof order = [];
    order.forEach((o, i) => {
      cur.push(o);
      const nx = order[i + 1];
      const word = /[\p{Script=Latin}\p{N}'’]/u.test(o.ch) && nx && /[\p{Script=Latin}\p{N}'’]/u.test(nx.ch);
      if (/[，。！？!?,.、~～…；;：:\s]/.test(o.ch) || (cur.length >= 5 && !word) || cur.length >= 12 || !nx || nx.r !== o.r && cur.length >= 3) { chunks.push(cur); cur = []; }
    });
    if (cur.length) chunks.push(cur);
    // 署名：放得下就靠右放在最後一列，不然放下一列
    const sc = Array.from(sig);
    let sigAt: { r: number; c0: number } | null = null;
    if (sc.length) {
      const last = rows[rows.length - 1] ?? [];
      if (last.length + 1 + sc.length <= g.cols) sigAt = { r: rows.length - 1, c0: g.cols - sc.length };
      else if (rows.length < g.rows) sigAt = { r: rows.length, c0: g.cols - sc.length };
    }
    const tMsg0 = beatAfter(au, this.tBoot + 0.3);
    const n = chunks.length + (sigAt ? 1 : 0);
    let step = n <= 8 ? this.beat : this.beat / 2;
    if (tMsg0 + n * step > e - 0.8) step = Math.max(0.1, (e - 0.8 - tMsg0) / Math.max(1, n));
    chunks.forEach((ch, j) => ch.forEach((o, i) => {
      const gi = A.get(F_MS, o.ch);
      if (gi < 0) return;
      this.cell(g, o.r, o.c).evs.push({ tl: tMsg0 + j * step + i * 0.016, g: gi, c: o.ch === '♥' ? COL.ROSE : isMsg ? COL.BONE : COL.ASH, k: 4, d: 0.04 });
    }));
    if (sigAt) {
      const t0 = tMsg0 + chunks.length * step;
      sc.forEach((ch, k) => {
        const gi = A.get(F_MS, ch);
        if (gi >= 0) this.cell(g, sigAt!.r, sigAt!.c0 + k).evs.push({ tl: t0 + k * 0.02, g: gi, c: COL.ASH, k: 3, d: 0.04 });
      });
    }
  }

  /** 右邊的大字牌：今晚收到幾則祝福。 */
  private buildCount(count: number) {
    const A = this.atlas;
    const digits = A.ofFamily(F_NUM).filter((_, i) => i < 10);
    const str = String(Math.min(999, Math.max(0, count))).padStart(3, '0');
    Array.from(str).forEach((ch, k) => {
      const x = this.cell(CT, 0, k);
      x.fill = digits;
      x.evs.push({ tl: this.tBoot + 0.12 + 0.09 * k, g: A.get(F_NUM, ch), c: COL.BONE, k: 9, d: 0.045 });
    });
  }

  // ---------------------------------------------------------------- 標籤（畫一次）
  private drawLabels(title: string) {
    const c = this.labels.ctx, m = this.msg, g = this.msGrid;
    this.labels.clear();
    c.textBaseline = 'alphabetic';
    // 表頭：「出發 DEPARTURES」＋右邊的航廈資訊
    c.fillStyle = rgba('bone');
    c.font = font(F.hei(900), 58);
    c.fillText('出發', X0, 166);
    const w0 = c.measureText('出發').width;
    c.font = font(F.archivo(125, 700), 30);
    c.letterSpacing = '6px';
    c.fillStyle = rgba('ash');
    c.fillText('DEPARTURES', X0 + w0 + 24, 163);
    c.font = font(F.mono(500), 17);
    c.letterSpacing = '3px';
    c.textAlign = 'right';
    c.fillText(`${COUPLE_EN.toUpperCase()}  ·  ${DATE_DOTS}`, LY.x + LY.cols * LY.px - 4, 161);
    c.textAlign = 'left';
    // 現正播放
    const lab = (x: number, y: number, zh: string, en: string, col = rgba('ash')) => {
      c.fillStyle = col;
      c.font = font(F.hei(500), 18); c.letterSpacing = '4px';
      c.fillText(zh, x, y);
      const w = c.measureText(zh).width;
      c.font = font(F.mono(500), 14); c.letterSpacing = '3px';
      c.fillText(en, x + w + 12, y);
      return x + w + 12 + c.measureText(en).width;
    };
    const x1 = lab(LY.x, LY.y - 16, this.pages.length ? '現正播放' : '現正播放 · 純音樂', 'NOW PLAYING');
    c.font = font(F.hei(500), 18); c.letterSpacing = '1px'; c.fillStyle = rgba('bone', 0.7);
    if (this.pages.length) c.fillText(`《${title}》`, x1 + 16, LY.y - 16);
    // 航班表的欄名
    const heads: [keyof typeof FC, string, string][] = [['time', '時間', 'TIME'], ['flight', '班次', 'FLIGHT'], ['dest', '目的地', 'DESTINATION'], ['name', '旅客', 'PASSENGER'], ['status', '狀態', 'STATUS']];
    for (const [k, zh, en] of heads) lab(FL.x + FC[k][0] * FL.px, FL.y - 14, zh, en);
    // 旅客留言
    const lx = lab(g.x, g.y - 16, m?.couple ? '新人廣播' : '旅客留言', m?.couple ? 'FROM THE COUPLE' : 'MESSAGE');
    c.font = font(F.mono(500), 15); c.letterSpacing = '3px'; c.fillStyle = rgba('bone', 0.62);
    c.fillText(m ? `No.${String(m.n).padStart(3, '0')}` : '空位  ·  VACANT', lx + 18, g.y - 16);
    // 右邊一欄
    c.letterSpacing = '0px';
    lab(CT.x, CT.y - 22, '今晚收到的祝福', '');
    c.font = font(F.mono(500), 14); c.letterSpacing = '3px'; c.fillStyle = rgba('ash');
    c.fillText('WISHES RECEIVED', CT.x, CT.y + CT.h + 30);
    c.font = font(F.hei(500), 20); c.letterSpacing = '2px'; c.fillStyle = rgba('ash', 0.85);
    const notes = ['本站航班皆為單程', '目的地：永遠', '行李限重：兩顆心'];
    notes.forEach((s, i) => c.fillText(s, CT.x, CT.y + CT.h + 110 + i * 40));
    c.font = font(F.mono(400), 13); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.6);
    c.fillText('ONE WAY ONLY · NON-STOP TO FOREVER', CT.x, CT.y + CT.h + 110 + notes.length * 40 + 6);
    c.letterSpacing = '0px';
    // 航班表下的一條細線
    c.fillStyle = rgba('ash', 0.18);
    c.fillRect(FL.x, FL.y - 6, FL.cols * FL.px, 1);
  }

  // ---------------------------------------------------------------- 每一格
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const d = this.data;
    for (let i = 0; i < this.cells.length; i++) {
      const x = this.cells[i];
      const o = i * 4;
      if (!x) { d[o] = d[o + 1] = -2; d[o + 2] = 0; d[o + 3] = 0; continue; }
      if (x.g0 === -2) { d[o] = d[o + 1] = -2; d[o + 2] = 0; d[o + 3] = 0; continue; }
      const st = flipAt(x.evs, t, x.g0, x.c0, x.seed, x.fill);
      d[o] = st.a; d[o + 1] = st.b; d[o + 2] = st.ph; d[o + 3] = st.ca * 16 + st.cb;
    }
    this.state.needsUpdate = true;
    const u = this.bg.u;
    const kIn = prog(t, s, s + 0.55, ease.outExpo);
    u.uT!.value = t;
    u.uKick!.value = f.a.kick;
    u.uIn!.value = kIn;
    // 狀態燈：主打那班跟著拍子閃（起飛後熄掉），其他班暗著
    const lamps = u.uLamp!.value as THREE.Vector4[];
    const blink = t >= this.tBoot && t < this.tDep ? (fract(au.beatAt(t)) < 0.5 ? 1 : 0.12) : 0.04;
    for (let r = 0; r < 4; r++) lamps[r]!.set(LAMP_X, FL.y + r * FL.py + FL.h / 2, r < this.flRows ? 6.5 : 0, r === 0 ? blink : 0.04);
    this.bg.render(renderer, out);
    comp.draw(renderer, this.labels.texture, out, { opacity: kIn });
    return {
      bloom: 0.68, vignette: 0.42, halation: 0.2,
      zoom: 1 + 0.014 * ease.inOutCubic(f.p) + 0.004 * f.a.kick,
      popupAvoid: this.avoid,
    };
  }
}

