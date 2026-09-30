// 航班看板（機器 A）：機場大廳裡的一面翻牌出發看板，鏡頭從斜下方仰看、慢慢推近，有一點景深。
// 照「留言尺寸與版面比例標準 v2」：整面看板（一直在翻的航班）是主視覺，留言翻在右上一塊字牌上（字級 40～60）。
//  - 左邊十班航班（小字牌、暗一點）：時間、班次、目的地（四字祝福）、旅客、狀態。第一班是主打留言的航班（登機中，燈跟著拍子閃；
//    窗格最後一個小節線「已起飛」），其他九班每兩小節整排往上捲一班（嘩啦啦）——這是一直在動的場景。
//    旅客是其他賓客的名字（沒有就用伴郎團、芃芃、QQ…）。
//  - 右上一塊字牌（≤ 830 × 430）：主打留言（思源宋體），第一拍之後一個詞組一拍翻上來；最後一列下面一排小一號的牌是署名。
//    沒有留言：這塊翻上邀請（小一點）。
//  - 下面兩列中字牌是現正播放的歌詞（40～52，比留言小）：一句在第一個字要唱之前翻上來（三成亮），唱到的字再翻一下亮成訊號色、
//    唱完變紙白。純音樂：翻上歌名。
// 畫法：全螢幕 shader（departures-glsl.ts）＋鏡頭射線打到看板平面；每一格的翻牌序列在 init 排好，
// 每一格在 CPU 算狀態（純函數），寫進一張小狀態貼圖；字從兩張字模圖集取（_t7.ts）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { ease, lerp, prog, hash, fract } from '../engine/util';
import { beatAfter, barAfter, signature, COUPLE_EN, DATE_DOTS, lyricSubOf, subSizeFor } from './_motifs';
import { GlyphAtlas, cuePages, windowLines, wrapCells, flipAt, settle, bestCellWrap, COL, cueCol, cueState, type Flip, type GlyphReq, type CuePage } from './_t7';
import { msgMaxFor, lyricV2, sigV2, V2 } from './_v2';
import { FRAG_BOARD, NG } from './departures-glsl';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'machine', paper: false, energy: [0.3, 1], bars: [4, 10] };

// ---------------------------------------------------------------- 版面（看板座標，px，y 往下；預設鏡頭下就是螢幕像素）
const BOARD = { x0: 60, y0: 86, x1: 1860, y1: 1004 };
const X0 = 128;
/** 一個格子區：左上角、每格間距、牌的大小、欄列數、在狀態貼圖的第幾列、用哪張圖集、字的亮度、要不要畫軌道。 */
interface Grid { x: number; y: number; px: number; py: number; w: number; h: number; cols: number; rows: number; r0: number; atlas: number; bright: number; rail?: boolean }
/** 航班：十列 26 格小字牌（欄與欄之間空一格）。 */
const FL: Grid = { x: X0, y: 176, px: 31, py: 44, w: 28, h: 37, cols: 26, rows: 10, r0: 0, atlas: 0, bright: 0.72, rail: true };
/** 留言字牌可以用的範圍（右上；含署名那一排）。 */
const MB = { x: 996, y: 176, w: 770, h: 430 };
const MB_R0 = 10, LY_R0 = 16, SG_R0 = 18, SUB_R0 = 20;
/** 距離起飛（多補的動畫：每一拍翻一次的倒數大字牌），在留言下面、右下角 QR 區的上面。 */
const CD: Grid = { x: 1560, y: 664, px: 82, py: 110, w: 76, h: 104, cols: 2, rows: 1, r0: 19, atlas: 0, bright: 1, rail: true };
/** 歌詞：兩列中字牌（下面三分之一；牌的大小依 v2 的歌詞字級決定）。 */
const LYA = { x: X0, y: 716, maxW: 1210 };
// 狀態貼圖：最後兩列給原文副行（韓文歌）用
const SW = 32, SH = 22;
/** 航班列的欄：起始格、格數。 */
const FC = { time: [0, 5], flight: [6, 5], dest: [12, 4], name: [17, 5], status: [23, 3] } as const;
/** 字模圖集裡字佔格高的比例（大圖集 150 / 216、小圖集 88 / 128）：牌的高度 = 字級 ÷ 這個比例。 */
const GB = 150 / 216, GS = 88 / 128;
const FOCAL = 540 / Math.tan((15 * Math.PI) / 180);
/** 鏡頭繞著轉的點（看板中心附近）。 */
const PIV = { x: 900 - 960, y: 540 - 520 };

const F_LY = F.archivo(100, 700);
const F_BD = F.hei(700);
const F_NUM = F.mono(500);
const F_MS = F.ming(700);

const DESTS = ['百年好合', '永浴愛河', '白頭偕老', '永結同心', '花好月圓', '天作之合', '相親相愛', '心心相印', '佳偶天成', '甜甜蜜蜜', '幸福美滿', '一生一世'];
/** 沒有別的留言可以排班時的旅客（伴郎伴娘、狗狗也要搭飛機）。 */
const EXTRA = ['全體賓客', '伴郎團', '伴娘團', '芃芃', 'QQ', '親友團', '同學會', '同事們', '表弟妹'];
const STATUS = ['準時', '準時', '直飛', '滿座'];
const INVITE = '掃描右下角 QR code，把祝福寫上看板';
const LABELS = `《》出發距離起飛拍登機中已起飛${DESTS.join('')}${EXTRA.join('')}${STATUS.join('')}${INVITE}`;

interface Cam { yaw: number; pitch: number; dist: number }
/** 鏡位：從左下仰看為主，每兩小節換一個（緩進小節線）。 */
const CAMS: Cam[] = [
  { yaw: 0.12, pitch: -0.08, dist: 1.02 },
  { yaw: 0.07, pitch: -0.06, dist: 1.0 },
  { yaw: 0.14, pitch: -0.05, dist: 1.03 },
  { yaw: 0.09, pitch: -0.1, dist: 1.01 },
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
interface Flight { time: string; code: string; dest: string; name: string; status: string }

/** 名字塞進 n 格：太長就截斷、最後一格放「…」。 */
function fitName(name: string, n: number) {
  const cs = Array.from(name.replace(/\s*&\s*/g, '&').replace(/\s+/g, ' ').trim());
  return cs.length <= n ? cs.join('') : cs.slice(0, n - 1).join('') + '…';
}

/** 一種大小的牌：高 h → 寬、間距。 */
const cellOf = (h: number) => { const w = Math.round(h * 0.78); return { h, w, px: w + Math.max(3, Math.round(w * 0.07)), py: h + Math.max(6, Math.round(h * 0.14)) }; };

/**
 * 在 MB 裡排留言的字牌：牌高從 maxH 往下試，找放得下全部字（加上署名那一排）的最大牌。
 * 回傳格子與每個字的位置（列、欄）。
 */
function fitGrid(chars: string[], sigRow: number, maxH: number, minH: number): { g: Grid; rows: number[][] } {
  // 照子句排（跟 v2 的 fitClauses 同一個想法），挑斷得最少、字最大的牌
  const colsOf = (h: number) => { const k = cellOf(h); return Math.min(SW, Math.floor((MB.w + (k.px - k.w)) / k.px)); };
  const r = bestCellWrap(chars, minH, maxH, colsOf, (n, h) => { const k = cellOf(h); return n * k.py - (k.py - h) + sigRow <= MB.h && n <= LY_R0 - MB_R0; });
  const k = cellOf(r.h);
  const used = Math.max(...r.rows.map((x) => x.length), 1);
  return { g: { x: MB.x, y: MB.y, px: k.px, py: k.py, w: k.w, h: r.h, cols: used, rows: r.rows.length, r0: MB_R0, atlas: 1, bright: 1 }, rows: r.rows };
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
  lyg!: Grid;
  sg: Grid = { x: 0, y: 0, px: 1, py: 1, w: 1, h: 1, cols: 0, rows: 0, r0: SG_R0, atlas: 1, bright: 0.9 };
  /** 原文副行（韓文歌）：歌詞字牌下面一兩列小一號的字牌；沒有原文就是 null。 */
  subg: Grid | null = null;
  msgPx = 48;
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
    const flights = this.flights();
    const bigText = m ? m.text : INVITE;
    const bigFam = m ? F_MS : F_BD;
    const subLines = lines.map((l) => lyricSubOf(l)).filter((x): x is NonNullable<typeof x> => !!x);
    await loadText(LABELS + lines.map((l) => l.text).join('') + subLines.map((l) => l.text).join('') + bigText + sig + title + flights.map((f) => f.name).join(''));

    // 字模：A（小）＝航班、歌詞；B（大）＝留言字牌
    const reqA: GlyphReq[] = [];
    const addA = (family: string, str: string) => { for (const ch of Array.from(str)) reqA.push({ ch, family }); };
    addA(F_LY, lines.map((l) => l.text).join('') + subLines.map((l) => l.text).join('') + title + 'AO');
    addA(F_NUM, '0123456789:');
    addA(F_BD, flights.map((f) => f.dest + f.name + f.status).join('') + '登機中已起飛');
    const reqB: GlyphReq[] = [];
    for (const ch of Array.from(bigText + sig)) reqB.push({ ch, family: bigFam });
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

    this.buildFlights(flights);
    // 留言字牌：字級上限依字數（v2），牌高 = 字級 ÷ 字佔格高的比例；沒有留言時邀請小一點
    const max = m ? msgMaxFor(bigText) : 40, min = m ? V2.msgMin : 34;
    const sigH = m ? sigV2(max) / GB + 8 : 0;
    const fit = fitGrid(Array.from(bigText), sigH, max / GB, min / GB);
    this.mb = fit.g;
    this.msgPx = this.mb.h * GB;
    this.buildMessage(fit, Array.from(bigText), Array.from(sig), !!m, bigFam);
    // 歌詞：40～52（有留言時比留言小），兩列
    const lk = cellOf(Math.round(lyricV2(m ? this.msgPx : null) / GS));
    const cols = Math.min(SW, Math.floor((LYA.maxW + lk.px - lk.w) / lk.px));
    const pages = cuePages(lines, cols, 2).filter((p) => p.t1 > s - 0.3 && p.t0 < e - 0.2);
    const used = pages.length ? Math.max(8, ...pages.flatMap((p) => p.rows.map((r) => r.length))) : Math.min(cols, Array.from(title).length);
    const nRows = pages.length ? Math.min(2, Math.max(1, ...pages.map((p) => p.rows.length))) : 1;
    // 原文副行：同一面看板上、歌詞字牌正下方再一兩列小一號的牌（字級照 subSizeFor）。只有沒有留言的窗格會有原文，
    // 右上的字牌只翻邀請、很短，所以整塊歌詞往上挪一點，副行才不會掉到畫面底下
    const sk = cellOf(Math.round(subSizeFor(lyricV2(m ? this.msgPx : null)) / GS));
    const sCols = Math.min(SW, Math.floor((LYA.maxW + sk.px - sk.w) / sk.px));
    // 沒有原文的句子（兩行一樣的句子）翻成一頁空白：原文那排不能還掛著上一句的原文
    const subPages = subLines.length
      ? lines.flatMap((l): CuePage[] => { const sl = lyricSubOf(l); return sl ? cuePages([sl], sCols, 2) : [{ line: l, cues: [], rows: [], t0: l.start, t1: l.start }]; })
        .filter((p) => p.t1 > s - 0.3 && p.t0 < e - 0.2)
      : [];
    const hasSub = subPages.some((p) => p.rows.length);
    const ly0 = hasSub ? LYA.y - 50 : LYA.y;
    this.lyg = { x: LYA.x, y: ly0, px: lk.px, py: lk.py, w: lk.w, h: lk.h, cols: Math.min(cols, used), rows: nRows, r0: LY_R0, atlas: 0, bright: 0.9, rail: true };
    // 有原文時中文貼著下排翻（只有一排字的句子不要跟原文中間隔一排空牌）
    this.buildLyrics(this.lyg, this.small, F_LY, pages, title, false, hasSub);
    if (hasSub) {
      const sUsed = Math.max(8, ...subPages.flatMap((p) => p.rows.map((r) => r.length)));
      const sRows = Math.min(2, Math.max(1, ...subPages.map((p) => p.rows.length)));
      // 比中文安靜：整塊亮度打八折，唱到、唱完都是紙白（不翻訊號色）
      this.subg = { x: LYA.x, y: ly0 + nRows * lk.py + 6, px: sk.px, py: sk.py, w: sk.w, h: sk.h, cols: Math.min(sCols, sUsed), rows: sRows, r0: SUB_R0, atlas: 0, bright: 0.9 * 0.8, rail: true };
      this.buildLyrics(this.subg, this.small, F_LY, subPages, '', true);
    }
    this.buildCountdown();

    const grids = [FL, this.mb, this.lyg, this.sg, CD, ...(this.subg ? [this.subg] : [])];
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
  /** 航班：第一班是主打留言（沒有留言：全體賓客飛往一生一世），其他是別的賓客（依編號），不夠用固定的旅客。 */
  private flights(): Flight[] {
    const m = this.msg;
    const clock = (n: number) => { const mm = 12 * 60 + 5 + ((n * 7) % 300); return `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`; };
    const dest = (n: number) => DESTS[Math.floor(hash(n, this.seed) * DESTS.length)]!;
    const out: Flight[] = [];
    if (m) out.push({ time: clock(m.n), code: `AO${String(m.n % 1000).padStart(3, '0')}`, dest: dest(m.n), name: fitName(m.couple ? '宣文&孟庭' : m.name || '一位賓客', FC.name[1]), status: '登機中' });
    else out.push({ time: '12:00', code: 'AO000', dest: '一生一世', name: '全體賓客', status: '登機中' });
    const others: Msg[] = ((this.ctx.params.messages ?? []) as Msg[]).filter((x) => !m || x.id !== m.id).sort((a, b) => a.n - b.n);
    for (const o of others.slice(0, 24)) out.push({ time: clock(o.n), code: `AO${String(o.n % 1000).padStart(3, '0')}`, dest: dest(o.n), name: fitName(o.couple ? '宣文&孟庭' : o.name || '一位賓客', FC.name[1]), status: STATUS[Math.floor(hash(o.n, 3) * STATUS.length)]! });
    for (let k = 0; out.length < 16; k++) out.push({ time: clock(900 + k * 5), code: `AO${String(900 + k).padStart(3, '0')}`, dest: dest(900 + k), name: EXTRA[k % EXTRA.length]!, status: STATUS[k % STATUS.length]! });
    return out;
  }

  private cell(g: Grid, r: number, c: number): Cell {
    const i = (g.r0 + r) * SW + c;
    let x = this.cells[i];
    if (!x) { x = { evs: [], g0: -1, c0: COL.BONE, fill: [], seed: hash(g.r0 + r, c, this.seed) * 1e6 }; this.cells[i] = x; }
    return x;
  }

  /** 航班：開機時整面翻上來；之後每兩小節，第 2～10 班整排往上捲一班（從左到右一波）；第一班在最後一個小節線「已起飛」。 */
  private buildFlights(fl: Flight[]) {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, A = this.small;
    const numFill = A.ofFamily(F_NUM), bdFill = A.ofFamily(F_BD);
    const cyc: number[] = [this.tBoot];
    for (let k = 2; ; k += 2) { const tc = barAfter(au, s + 0.1, k); if (tc > e - 0.9) break; cyc.push(tc); }
    const nOther = fl.length - 1;
    for (let r = 0; r < FL.rows; r++) {
      for (let c = 0; c < FL.cols; c++) if (!Object.values(FC).some(([a, n]) => c >= a && c < a + n)) this.cell(FL, r, c).g0 = -2;
      cyc.forEach((tc, ci) => {
        if (r === 0 && ci > 0) return; // 第一班（主打）不換
        const f = r === 0 ? fl[0]! : fl[1 + ((ci + r - 1) % nOther)]!;
        const hot = r === 0;
        const set = (key: keyof typeof FC, str: string, fam: string, colr: number) => {
          const [a, n] = FC[key];
          const cs = Array.from(str);
          for (let k = 0; k < n; k++) {
            const x = this.cell(FL, r, a + k);
            x.fill = fam === F_NUM ? numFill : bdFill;
            // 班次的英文字母用 Archivo（圓的 O），數字用 Plex Mono：AO042 才不會讀成 A0042
            const ff = fam === F_NUM && k < cs.length && /[A-Z]/.test(cs[k]!) ? F_LY : fam;
            x.evs.push({ tl: tc + 0.016 * (a + k) + 0.04 * r + (ci === 0 ? 0.06 : 0), g: k < cs.length ? A.get(ff, cs[k]!) : -1, c: colr, k: ci === 0 ? 6 : 4, d: 0.042 });
          }
        };
        set('time', f.time, F_NUM, hot ? COL.BONE : COL.ASH);
        set('flight', f.code, F_NUM, hot ? COL.SIGNAL : COL.ASH);
        set('dest', f.dest, F_BD, hot ? COL.BONE : COL.ASH);
        set('name', f.name, F_BD, hot ? COL.BONE : COL.ASH);
        set('status', f.status, F_BD, hot ? COL.SIGNAL : COL.ASH);
      });
    }
    if (Number.isFinite(this.tDep)) {
      const [a, n] = FC.status;
      const cs = Array.from('已起飛');
      for (let k = 0; k < n; k++) this.cell(FL, 0, a + k).evs.push({ tl: this.tDep + 0.03 * k, g: A.get(F_BD, cs[k] ?? ' '), c: COL.BONE, k: 3, d: 0.04 });
    }
    for (let r = 0; r < FL.rows; r++) for (let c = 0; c < FL.cols; c++) this.cell(FL, r, c).evs.sort((a, b) => a.tl - b.tl);
  }

  /** 留言字牌：第一拍之後一個詞組一拍（詞組多就半拍）翻上來，最後署名（最後一列下面一排小一號的牌）。 */
  private buildMessage(fit: ReturnType<typeof fitGrid>, chars: string[], sig: string[], isMsg: boolean, fam: string) {
    const { audio: au } = this.ctx;
    const e = this.ctx.end, A = this.big, g = this.mb;
    const fill = A.ofFamily(fam);
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) this.cell(g, r, c).fill = fill;
    const order: { r: number; c: number; ch: string }[] = [];
    fit.rows.forEach((row, r) => row.forEach((ci, c) => order.push({ r, c, ch: chars[ci]! })));
    // 沒有字的格子（列尾、英文字之間的空白）不放牌：灰色的空牌很吵，也讓留言區看起來比字大
    const used = new Set(order.filter((o) => o.ch !== ' ').map((o) => `${o.r},${o.c}`));
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) if (!used.has(`${r},${c}`)) this.cell(g, r, c).g0 = -2;
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
      // 署名：v2 的署名字級（26～32），靠右對齊留言字牌，最後一列下面
      const k = cellOf(Math.round(sigV2(this.msgPx) / GB));
      this.sg = { x: g.x + g.cols * g.px - (g.px - g.w) - (sig.length * k.px - (k.px - k.w)), y: g.y + g.rows * g.py + 4, px: k.px, py: k.py, w: k.w, h: k.h, cols: sig.length, rows: 1, r0: SG_R0, atlas: 1, bright: 0.9 };
      const ts = t0 + chunks.length * step;
      sig.forEach((ch, kk) => {
        const gi = A.get(fam, ch);
        const x = this.cell(this.sg, 0, kk);
        x.fill = fill;
        if (gi >= 0) x.evs.push({ tl: ts + kk * 0.025, g: gi, c: COL.ASH, k: 4, d: 0.045 });
      });
    }
  }

  /** 歌詞：每一頁在第一個字要唱之前嘩啦啦翻上來（三成亮），唱到的字翻一下亮起來、唱完變紙白。沒有歌詞的時段先翻上歌名。 */
  private buildLyrics(g: Grid, A: GlyphAtlas, fam: string, pages: CuePage[], title: string, quiet = false, bottom = false) {
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
      const r0 = bottom ? Math.max(0, g.rows - pg.rows.length) : 0;
      pg.rows.forEach((row, r) => row.forEach((ci, c) => { if (r + r0 < g.rows && c < g.cols) want[(r + r0) * g.cols + c] = { g: A.get(fam, pg.cues[ci]!.ch), cue: ci }; }));
      const base = Math.max(pg.t0 - 0.45, Math.min(prevEnd + 0.05, pg.t0 - 0.1), s + 0.1);
      let k = 0;
      for (let idx = 0; idx < n; idx++) {
        const w = want[idx]!;
        if (w.g === cur[idx] && w.g < 0) continue;
        const tl = base + 0.012 * k++;
        if (w.cue < 0) { put(idx, { tl, g: -1, c: COL.DIM, k: 2, d: 0.04, seg }); cur[idx] = -1; continue; }
        const cue = pg.cues[w.cue]!;
        // quiet（原文副行）：正在唱不翻訊號色，唱到就是紙白
        const c0 = quiet && cue.ch !== '♥' && cueState(cue, tl) > 0 ? COL.BONE : cueCol(cue, tl);
        put(idx, { tl, g: w.g, c: c0, k: 3, d: 0.04, seg });
        cur[idx] = w.g;
        if (cue.ch === '♥' || w.g < 0) continue;
        let tA = tl;
        if (cue.t0 > tl) { put(idx, { tl: cue.t0 + 0.07, g: w.g, c: quiet ? COL.BONE : COL.SIGNAL, k: 0, d: 0.07, seg }); tA = cue.t0 + 0.07; }
        if (cue.w1 > tA) put(idx, { tl: cue.w1, g: w.g, c: COL.BONE, d: 0, seg });
      }
      prevEnd = pg.t1;
    }
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) { const x = this.cell(g, r, c); x.evs = settle(x.evs); }
  }

  /** 距離起飛：每一拍翻一次（剩幾拍），最後四拍變訊號色；起飛（或窗格結束）時是 00。 */
  private buildCountdown() {
    const { audio: au } = this.ctx;
    const e = this.ctx.end, A = this.small;
    const digits = Array.from('0123456789').map((ch) => A.get(F_NUM, ch));
    const tEnd = Number.isFinite(this.tDep) ? this.tDep : e;
    const bEnd = Math.round(au.beatAt(tEnd));
    const b0 = Math.ceil(au.beatAt(this.tBoot) - 1e-6);
    const show = (n: number) => { const v = Math.max(0, Math.min(99, n)); return [Math.floor(v / 10), v % 10]; };
    for (let k = 0; k < 2; k++) { const x = this.cell(CD, 0, k); x.fill = digits; }
    let prev: number[] | null = null;
    for (let b = b0; b <= bEnd; b++) {
      const tb = au.timeOfBeat(b), n = bEnd - b, dd = show(n);
      const col = n <= 4 ? COL.SIGNAL : COL.BONE;
      dd.forEach((v, k) => {
        if (prev && prev[k] === v && n !== 4) return;
        this.cell(CD, 0, k).evs.push({ tl: tb, g: digits[v]!, c: col, k: prev ? 0 : 6, d: prev ? 0.09 : 0.045 });
      });
      prev = dd;
    }
  }

  // ---------------------------------------------------------------- 小字標籤（畫一次；整個畫面只有兩小群）
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
    // 距離起飛的標籤（倒數大字牌的左邊）
    c.font = font(F.hei(500), 18); c.letterSpacing = '5px'; c.textAlign = 'right';
    c.fillText('距離起飛', CD.x - 18 + ox, CD.y + 44 + oy);
    c.font = font(F.mono(500), 13); c.letterSpacing = '4px';
    c.fillText('BEATS TO GO', CD.x - 18 + ox, CD.y + 70 + oy);
    c.textAlign = 'left';
    c.font = font(F.hei(500), 18); c.letterSpacing = '5px';
    c.fillText('拍', CD.x + CD.cols * CD.px + 8 + ox, CD.y + CD.h - 10 + oy);
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
    c.dist *= 1.02 - 0.04 * ease.inOutCubic(prog(t, s, this.ctx.end)) + 0.05 * (1 - ease.outExpo(prog(t, s, this.tBoot + 0.2)));
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
    // 對焦在留言字牌中間
    const mc = new THREE.Vector3(this.mb.x + (this.mb.cols * this.mb.px) / 2 - 960, 540 - (this.mb.y + (this.mb.rows * this.mb.py) / 2), 0);
    u.uFocus!.value = mc.distanceTo(cam.pos);
    u.uIn!.value = prog(t, s, s + 0.45, ease.outCubic);
    u.uKick!.value = f.a.kick;
    const blink = t >= this.tBoot && t < this.tDep ? (fract(au.beatAt(t)) < 0.5 ? 1 : 0.12) : 0.04;
    (u.uLamp!.value as THREE.Vector4).set(FL.x + FL.cols * FL.px + 8, FL.y + FL.h / 2, 5, blink);
    this.bg.render(renderer, out);
    return { bloom: 0.6, vignette: 0.55, halation: 0.2 };
  }
}
