// 翻頁鐘（機器 A）：一台放大到整面牆的翻頁鐘（three.js 立體），暖黑的烤漆機身、一盞燈打在上面，鏡頭斜斜地慢慢推近。
// MV 融合原則：一個焦點。
//  - 機身正中是一大片奶油色的翻牌：主打留言就翻在上面（思源宋體、墨色的字，牌的大小依留言長短自動決定），
//    第一拍之後一個詞組一拍「啪、啪、啪」翻上來，最後署名翻在右下角小一號的牌上。這是全畫面最大、最亮的東西。
//    翻牌是真的立體：上半片繞著轉軸往鏡頭倒下來、過了 90° 看到背面（新字的下半），落到底還會彈一下，倒下來的那片在下半片投影子。
//  - 機身上緣一排黑色小牌是歌詞（字級約 50 px，明顯比留言小）：一句在唱之前翻上來（三成亮），唱到的字亮成訊號色、往前彈一下，唱完變紙白。
//  - 右上角是真正的「鐘」：停在 03:13（婚禮那天），冒號跟著拍子閃，旁邊一格每一拍翻一片（1、2、3、4）。
// 沒有主打留言：奶油色的大牌改成放歌詞（焦點是歌詞，正在唱的字是訊號色的暗部），上緣那排收起來。純音樂又沒有留言：大牌翻上邀請。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { ease, lerp, prog, pulse, hash } from '../engine/util';
import { beatAfter, barAfter, signature, COUPLE_EN, DATE_DOTS, WEDDING_DATE } from './_motifs';
import { GlyphAtlas, cuePages, windowLines, wrapCells, flipAt, settle, cueCol, COL, type Flip, type GlyphReq, type CuePage } from './_t7';
import { CardBatch, boxMaterial, decalMaterial, WALL_FRAG } from './flipclock-gl';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: false, energy: [0.2, 0.85], bars: [4, 8] };

// ---------------------------------------------------------------- 版面（預設鏡頭下的螢幕像素，y 往下；3D 裡 1 單位 = 1 px）
/** 機身（正面）：高度看內容。 */
const HB = { x: 120, y: 110, w: 1680, d: 110 };
/** 上緣的歌詞列：黑色小牌。 */
const LY = { x: 172, y: 146, w: 52, h: 72, px: 57, cols: 20 };
/** 右上角的鐘（03:13）與拍。 */
const CLK = { y: 147, w: 50, h: 70, xs: [1452, 1507, 1580, 1635], colon: 1558, beat: 1712 };
/** 奶油色大牌可以用的範圍（右下角 QR 區上面就停）。 */
const MB = { x: 172, y: 262, w: 1576, h: 556 };
const FRONT_Z = -6;
const DIST = 540 / Math.tan((15 * Math.PI) / 180);
/** 鏡頭繞著轉的點（機身中心）。 */
const PIVOT = new THREE.Vector3(960 - 960, 540 - 520, 0);

const F_BIG = F.ming(700);
const F_LYR = F.archivo(100, 700);
const F_INV = F.hei(700);
const [MM, DD] = String(WEDDING_DATE).split('-').slice(1) as [string, string];
const IDLE = [MM[0]!, MM[1]!, DD[0]!, DD[1]!];
const INVITE = '掃描右下角 QR code，把你的祝福翻上這座鐘';

interface Cam { yaw: number; pitch: number; dist: number }
/** 鏡位：右邊往後退（不會壓到右下角的 QR），每兩小節換一個（緩進小節線）。 */
const CAMS: Cam[] = [
  { yaw: -0.11, pitch: 0.05, dist: 1.01 },
  { yaw: -0.07, pitch: 0.08, dist: 1.0 },
  { yaw: -0.13, pitch: 0.03, dist: 1.02 },
  { yaw: -0.09, pitch: 0.07, dist: 0.99 },
];

const WALL = () => new FSPass(WALL_FRAG, {
  uShadow: { value: [new THREE.Vector4(), new THREE.Vector4()] }, uPool: { value: new THREE.Vector2(760, 470) }, uIn: { value: 1 },
});

/** 一格牌：翻牌序列、起始的字與色、唱到時往前彈的時間。 */
interface Unit { x: number; y: number; w: number; h: number; evs: Flip[]; g0: number; c0: number; lights: number[]; fill: number[] }
interface GridFit { cw: number; ch: number; px: number; py: number; cols: number; rows: number[][] }

/** 在 MB 裡排一塊大牌：從最大的牌往下試，找放得下全部字（留一列給署名）的最大牌。 */
function fitGrid(chars: string[], sigRow: number, maxH: number, minH: number, maxRows = 9): GridFit {
  let best: GridFit | null = null;
  for (let h = maxH; h >= minH; h -= 2) {
    const w = Math.round(h * 0.78), px = w + Math.max(5, Math.round(w * 0.08)), py = h + Math.max(10, Math.round(h * 0.16));
    const cols = Math.floor((MB.w + (px - w)) / px);
    const rows = wrapCells(chars, cols, true);
    best = { cw: w, ch: h, px, py, cols, rows };
    if (rows.length <= maxRows && rows.length * py - (py - h) + sigRow <= MB.h) return best;
  }
  return best!;
}

export default class Flipclock extends Scene {
  wall = shared('flipclock.wall', WALL);
  scene3 = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(30, W / H, 50, 9000);
  rig = new THREE.Object3D();
  small!: GlyphAtlas;
  big!: GlyphAtlas;
  cardsDark!: CardBatch;
  cardsCream!: CardBatch;
  box!: THREE.Mesh;
  bodyH = 760;
  /** 整台機器（機身、牌）：依內容高度上下置中。 */
  group = new THREE.Group();
  dy = 0;
  /** 機身上的一小行字（畫一次）。 */
  lab!: Layer2D;
  private geoms: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  msg: Msg | null = this.ctx.params.message ?? null;
  dark: Unit[] = [];
  cream: Unit[] = [];
  beatUnit!: Unit;
  lyricMode = false;
  beat = 0.5;
  tBoot = 0;
  camTimes: number[] = [];
  seed = 1;
  /** 大牌那一塊的範圍（對焦、燈的光圈）。 */
  focus = { x: 960, y: 520 };

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    this.seed = this.ctx.params.seed ?? 1;
    this.beat = au.beatPeriod(s + 0.1);
    this.tBoot = beatAfter(au, s + 0.15);
    for (let k = 2; ; k += 2) { const tb = barAfter(au, s + 0.1, k); if (tb > e - 0.6) break; this.camTimes.push(tb); }
    const m = this.msg;
    const lines = windowLines(lyrics, s, e);
    const sig = m ? signature(m.name).replace(/\s+/g, '') : '';
    this.lyricMode = !m && lines.length > 0;
    const bigText = m ? m.text : INVITE;
    const bigFam = this.lyricMode ? F_LYR : m ? F_BIG : F_INV;
    await loadText(lines.map((l) => l.text).join('') + bigText + sig + COUPLE_EN + (song.title ?? ''));

    // ---- 字模：小（黑牌：歌詞列、鐘）、大（奶油色的牌）
    const reqA: GlyphReq[] = [];
    for (const ch of Array.from(lines.map((l) => l.text).join('') + '0123456789')) reqA.push({ ch, family: F_LYR });
    const reqB: GlyphReq[] = [];
    for (const ch of Array.from((this.lyricMode ? lines.map((l) => l.text).join('') : bigText) + sig)) reqB.push({ ch, family: bigFam });
    this.small = this.track(new GlyphAtlas(reqA, 96, 128, { size: 86, mip: true }));
    this.big = this.track(new GlyphAtlas(reqB, 168, 216, { size: 150, mip: true }));
    this.ctx.renderer.initTexture(this.small.tex);
    this.ctx.renderer.initTexture(this.big.tex);

    // ---- 大牌
    let bottom = MB.y;
    if (this.lyricMode) {
      const longest = lines.reduce((a, l) => (Array.from(l.text).length > Array.from(a.text).length ? l : a), lines[0]!);
      const fit = fitGrid(Array.from(longest.text), 0, 200, 96, 3);
      const nRows = Math.min(3, fit.rows.length);
      const units = this.gridUnits(fit, fit.cols, nRows, this.big.ofFamily(F_LYR));
      const pages = cuePages(lines, fit.cols, nRows, true).filter((p) => p.t1 > s - 0.3 && p.t0 < e - 0.2);
      this.lyricGrid(units, fit.cols, nRows, pages, this.big, F_LYR, true);
      this.cream.push(...units);
      bottom = MB.y + nRows * fit.py - (fit.py - fit.ch);
      this.focus = { x: MB.x + (fit.cols * fit.px) / 2, y: MB.y + (nRows * fit.py) / 2 };
    } else {
      const fit = fitGrid(Array.from(bigText), sig ? 92 : 0, 236, 96);
      const width = Math.max(...fit.rows.map((r) => r.length), 1);
      const units = this.gridUnits(fit, width, fit.rows.length, this.big.ofFamily(bigFam));
      this.message(units, fit, width, Array.from(bigText), !!m, bigFam);
      this.cream.push(...units);
      bottom = MB.y + fit.rows.length * fit.py - (fit.py - fit.ch);
      if (sig) {
        // 署名：大牌右下角、小一號的一列牌
        const h = Math.round(Math.min(84, Math.max(64, fit.ch * 0.45))), w = Math.round(h * 0.78), px = w + 5;
        const x1 = MB.x + width * fit.px - (fit.px - fit.cw);
        const t0 = this.sigTime;
        Array.from(sig).forEach((ch, k) => {
          const g = this.big.get(bigFam, ch);
          const u: Unit = { x: x1 - (sig.length - k) * px + 5 + w / 2, y: bottom + 12 + h / 2, w, h, evs: [], g0: -1, c0: COL.ASH, lights: [], fill: this.big.ofFamily(bigFam) };
          if (g >= 0) u.evs.push({ tl: t0 + k * 0.04, g, c: COL.ASH, k: 0, d: 0.13 });
          this.cream.push(u);
        });
        bottom += 12 + h;
      }
      this.focus = { x: MB.x + (width * fit.px) / 2, y: (MB.y + bottom) / 2 };
      // 上緣的歌詞列
      const pages = cuePages(lines, LY.cols, 1, true).filter((p) => p.t1 > s - 0.3 && p.t0 < e - 0.2);
      if (pages.length) {
        const cols = Math.min(LY.cols, Math.max(8, ...pages.map((p) => p.rows[0]!.length)));
        const units2: Unit[] = [];
        for (let c = 0; c < cols; c++) units2.push({ x: LY.x + c * LY.px + LY.w / 2, y: LY.y + LY.h / 2, w: LY.w, h: LY.h, evs: [], g0: -1, c0: COL.DIM, lights: [], fill: this.small.ofFamily(F_LYR) });
        this.lyricGrid(units2, cols, 1, pages, this.small, F_LYR, false);
        this.dark.push(...units2);
      }
    }
    // ---- 鐘：03:13 與拍
    CLK.xs.forEach((x, k) => this.dark.push({ x: x + CLK.w / 2, y: CLK.y + CLK.h / 2, w: CLK.w, h: CLK.h, evs: [], g0: this.small.get(F_LYR, IDLE[k]!), c0: COL.ASH, lights: [], fill: [] }));
    this.beatUnit = this.makeBeat();
    this.dark.push(this.beatUnit);

    this.bodyH = Math.max(420, bottom + 46 - HB.y);
    // 整台機器在畫面裡上下置中（短留言時機器比較矮，不要擠在上半部）
    // （但署名那一角要留在右下角 QR 區上面：鏡頭斜看時右邊會變大，多留一點）
    this.dy = Math.max(0, Math.min(Math.round(540 - (HB.y + this.bodyH / 2)), 770 - bottom));
    this.focus.y += this.dy;
    this.buildScene();
    this.drawLabels();
  }

  private sigTime = 0;

  /** 一塊格子的牌（奶油色）。 */
  private gridUnits(fit: GridFit, cols: number, rows: number, fill: number[]): Unit[] {
    const out: Unit[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
      out.push({ x: MB.x + c * fit.px + fit.cw / 2, y: MB.y + r * fit.py + fit.ch / 2, w: fit.cw, h: fit.ch, evs: [], g0: -1, c0: COL.BONE, lights: [], fill });
    return out;
  }

  /** 留言：第一拍之後一個詞組一拍，一格一格「啪」地翻上來。 */
  private message(units: Unit[], fit: GridFit, cols: number, chars: string[], isMsg: boolean, fam: string) {
    const { audio: au } = this.ctx;
    const e = this.ctx.end, B = this.big;
    const order: { i: number; ch: string; r: number }[] = [];
    fit.rows.forEach((row, r) => row.forEach((ci, c) => order.push({ i: r * cols + c, ch: chars[ci]!, r })));
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
    const n = chunks.length + 1;
    let step = n <= 8 ? this.beat : this.beat / 2;
    if (t0 + n * step > e - 0.8) step = Math.max(0.1, (e - 0.8 - t0) / Math.max(1, n));
    chunks.forEach((ch, j) => ch.forEach((o, k) => {
      const g = B.get(fam, o.ch);
      if (g < 0) return;
      units[o.i]!.evs.push({ tl: t0 + j * step + k * 0.045, g, c: o.ch === '♥' ? COL.ROSE : isMsg ? COL.BONE : COL.ASH, k: 0, d: 0.16 });
    }));
    this.sigTime = t0 + chunks.length * step;
  }

  /** 歌詞頁：在第一個字要唱之前一格一格翻上來（三成亮），唱到的字變色、往前彈一下，唱完變紙白。 */
  private lyricGrid(units: Unit[], cols: number, rows: number, pages: CuePage[], A: GlyphAtlas, fam: string, heavy: boolean) {
    const s = this.ctx.start;
    const d = heavy ? 0.16 : 0.13;
    let prevEnd = -1e9;
    const cur = new Array(units.length).fill(-1);
    for (const [seg, pg] of pages.entries()) {
      const want = new Array(units.length).fill(null).map(() => ({ g: -1, cue: -1 }));
      pg.rows.forEach((row, r) => row.forEach((ci, c) => { if (r < rows && c < cols) want[r * cols + c] = { g: A.get(fam, pg.cues[ci]!.ch), cue: ci }; }));
      const base = Math.max(pg.t0 - 0.5, Math.min(prevEnd + 0.05, pg.t0 - 0.15), s + 0.05);
      let k = 0;
      want.forEach((w, i) => {
        if (w.g === cur[i] && w.g < 0) return;
        const tl = base + d + 0.03 * k++;
        const u = units[i]!;
        if (w.cue < 0) { u.evs.push({ tl, g: -1, c: COL.DIM, k: 0, d, seg }); cur[i] = -1; return; }
        const cue = pg.cues[w.cue]!;
        u.evs.push({ tl, g: w.g, c: cueCol(cue, tl), k: 0, d, seg });
        cur[i] = w.g;
        if (cue.ch === '♥' || w.g < 0) return;
        if (cue.t0 > tl) u.evs.push({ tl: cue.t0, g: w.g, c: COL.SIGNAL, d: 0, seg });
        if (cue.w1 > Math.max(tl, cue.t0)) u.evs.push({ tl: cue.w1, g: w.g, c: COL.BONE, d: 0, seg });
      });
      prevEnd = pg.t1;
    }
    for (const u of units) { u.evs = settle(u.evs); u.lights = u.evs.filter((x) => x.d === 0 && x.c === COL.SIGNAL).map((x) => x.tl); }
  }

  /** 拍：每一拍翻一片，正好落在拍點上；第一拍是訊號色。 */
  private makeBeat(): Unit {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, A = this.small;
    const numAt = (tb: number) => {
      const td = au.timeOfBar(Math.floor(au.barAt(tb + 1e-3)));
      return ((Math.round(au.beatAt(tb) - au.beatAt(td)) % 8) + 8) % 8 + 1;
    };
    const b0 = Math.floor(au.beatAt(s)), b1 = Math.ceil(au.beatAt(e)) + 1;
    const first = numAt(au.timeOfBeat(b0));
    const u: Unit = { x: CLK.beat + CLK.w / 2, y: CLK.y + CLK.h / 2, w: CLK.w, h: CLK.h, evs: [], g0: A.get(F_LYR, String(first)), c0: first === 1 ? COL.SIGNAL : COL.ASH, lights: [], fill: [] };
    for (let b = b0 + 1; b <= b1; b++) {
      const tb = au.timeOfBeat(b), n = numAt(tb);
      u.evs.push({ tl: tb, g: A.get(F_LYR, String(n)), c: n === 1 ? COL.SIGNAL : COL.ASH, k: 0, d: 0.12 });
    }
    return u;
  }

  // ---------------------------------------------------------------- 3D 場景
  private buildScene() {
    const wx = (x: number) => x - 960, wy = (y: number) => 540 - y;
    const H0 = this.bodyH;
    const mat = boxMaterial(HB.w, H0);
    const geo = new THREE.BoxGeometry(HB.w, H0, HB.d);
    this.box = new THREE.Mesh(geo, mat);
    this.box.position.set(wx(HB.x + HB.w / 2), wy(HB.y + H0 / 2), FRONT_Z - HB.d / 2);
    // 凹下去的窗：歌詞列、鐘、大牌
    const wins = mat.uniforms.uWin!.value as THREE.Vector4[];
    let nw = 0;
    const lyUnits = this.dark.filter((u) => u.y === LY.y + LY.h / 2);
    if (lyUnits.length) { const x0 = Math.min(...lyUnits.map((u) => u.x - u.w / 2)), x1 = Math.max(...lyUnits.map((u) => u.x + u.w / 2)); wins[nw++]!.set(x0 - 12 - HB.x, LY.y - 10 - HB.y, x1 - x0 + 24, LY.h + 20); }
    wins[nw++]!.set(CLK.xs[0]! - 12 - HB.x, CLK.y - 10 - HB.y, CLK.beat + CLK.w - CLK.xs[0]! + 24, CLK.h + 20);
    const cx0 = Math.min(...this.cream.map((u) => u.x - u.w / 2)), cx1 = Math.max(...this.cream.map((u) => u.x + u.w / 2));
    const cy0 = Math.min(...this.cream.map((u) => u.y - u.h / 2)), cy1 = Math.max(...this.cream.map((u) => u.y + u.h / 2));
    wins[nw++]!.set(cx0 - 18 - HB.x, cy0 - 16 - HB.y, cx1 - cx0 + 36, cy1 - cy0 + 32);
    mat.uniforms.uNWin!.value = nw;
    mat.uniforms.uDot!.value.set(CLK.colon - HB.x, CLK.y + 22 - HB.y, CLK.y + CLK.h - 22 - HB.y, 0);
    this.lab = this.track(new Layer2D(HB.w, H0, undefined, { fast: true }));
    const g = new THREE.PlaneGeometry(HB.w, H0), mt = decalMaterial(this.lab.texture);
    const decal = new THREE.Mesh(g, mt);
    decal.position.set(wx(HB.x + HB.w / 2), wy(HB.y + H0 / 2), FRONT_Z + 0.6);
    this.geoms.push(g, geo); this.mats.push(mt, mat);
    this.cardsDark = new CardBatch(this.dark.length * 3 + 3, this.small.tex, [this.small.cols, this.small.rows], 5);
    this.cardsCream = new CardBatch(this.cream.length * 3 + 3, this.big.tex, [this.big.cols, this.big.rows], 7);
    this.cardsCream.mat.uniforms.uCream!.value = 1;
    // 燈的光圈：打在大牌那一塊
    // （牌的 shader 用機器自己的座標、機殼用世界座標；機器整台往下挪了 dy）
    for (const mm of [this.cardsDark.mat, this.cardsCream.mat]) {
      (mm.uniforms.uPool!.value as THREE.Vector2).set(wx(this.focus.x - 120), wy(this.focus.y - this.dy - 60));
      mm.uniforms.uPoolR!.value = 1150;
    }
    (mat.uniforms.uPool!.value as THREE.Vector2).set(wx(this.focus.x - 120), wy(this.focus.y - 60));
    mat.uniforms.uPoolR!.value = 1150;
    this.group.add(this.box, decal, this.cardsDark.mesh, this.cardsCream.mesh);
    this.group.position.y = -this.dy;
    this.scene3.add(this.group);
    this.rig.position.copy(PIVOT);
    this.rig.add(this.cam);
    this.scene3.add(this.rig);
  }

  /** 機身下緣的一小行字（整個畫面只有這一小群小字）。 */
  private drawLabels() {
    const c = this.lab.ctx;
    this.lab.clear();
    c.textBaseline = 'alphabetic';
    c.font = font(F.mono(500), 15); c.letterSpacing = '5px'; c.fillStyle = rgba('ash', 0.45);
    c.fillText(`${COUPLE_EN.toUpperCase()}  ·  ${DATE_DOTS}`, LY.x - HB.x, this.bodyH - 18);
    c.letterSpacing = '0px';
    this.ctx.renderer.initTexture(this.lab.upload());
  }

  // ---------------------------------------------------------------- 鏡頭
  private camAt(t: number): Cam {
    const s = this.ctx.start;
    const k0 = Math.floor(hash(this.seed, 7) * CAMS.length);
    let c: Cam = { ...CAMS[k0]! };
    this.camTimes.forEach((tb, i) => {
      const nx = CAMS[(k0 + i + 1) % CAMS.length]!;
      const k = prog(t, tb - 0.7 * this.beat, tb + 0.1 * this.beat, ease.inOutQuart);
      if (k > 0) c = { yaw: lerp(c.yaw, nx.yaw, k), pitch: lerp(c.pitch, nx.pitch, k), dist: lerp(c.dist, nx.dist, k) };
    });
    // 慢推；切進來時從遠一點、斜一點落定在第一拍
    const ko = 1 - ease.outExpo(prog(t, s, Math.max(s + 0.4, this.tBoot + 0.1)));
    c.yaw -= 0.06 * ko;
    c.dist *= 1.03 - 0.05 * ease.inOutCubic(prog(t, s, this.ctx.end)) + 0.06 * ko;
    return c;
  }

  private setCam(c: Cam) {
    this.rig.rotation.set(c.pitch, c.yaw, 0, 'YXZ');
    this.cam.position.set(-PIVOT.x, -PIVOT.y, DIST * c.dist);
    this.cam.rotation.set(0, 0, 0);
    this.rig.updateMatrixWorld(true);
    this.cam.updateMatrixWorld(true);
  }

  private screenRect(v: THREE.Vector4) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    const w = HB.w, h = this.bodyH;
    for (const [x, y] of [[-w / 2, -h / 2], [w / 2, -h / 2], [-w / 2, h / 2], [w / 2, h / 2]]) {
      const p = new THREE.Vector3(this.box.position.x + x!, this.box.position.y - this.dy + y!, FRONT_Z - 60).project(this.cam);
      const sx = (p.x * 0.5 + 0.5) * W, sy = (0.5 - p.y * 0.5) * H;
      a = Math.min(a, sx); b = Math.min(b, sy); c = Math.max(c, sx); d = Math.max(d, sy);
    }
    v.set(a, b, c, d);
  }

  // ---------------------------------------------------------------- 每一格
  /** 一格牌在 t 時的角度、字、色：翻動中用重力加速，落定後彈一下。 */
  private flapState(u: Unit, t: number, seed: number, bounce: number) {
    const st = flipAt(u.evs, t, u.g0, u.c0, seed, []);
    if (st.since < 0) return { th: Math.PI * Math.pow(st.ph, 1.7), a: st.a, b: st.b, ca: st.ca, cb: st.cb };
    if (st.since < 0.35 && st.pa !== st.a) {
      const x = st.since;
      return { th: Math.PI - bounce * Math.PI * Math.exp(-x / 0.07) * Math.abs(Math.sin(x * 26)), a: st.pa, b: st.a, ca: st.pc, cb: st.ca };
    }
    return { th: 0, a: st.a, b: st.a, ca: st.ca, cb: st.ca };
  }

  private drawUnits(batch: CardBatch, units: Unit[], t: number, bounce: number) {
    const wx = (x: number) => x - 960, wy = (y: number) => 540 - y;
    batch.clear();
    units.forEach((u, i) => {
      const st = this.flapState(u, t, hash(this.seed, i, u.x) * 1e6, bounce);
      let lift = 0;
      for (const tl of u.lights) { const x = (t - tl) / 0.26; if (x >= 0 && x < 1) lift = Math.max(lift, (u.h * 0.2) * Math.sin(Math.PI * x) * (1 - x)); }
      batch.unit(wx(u.x), wy(u.y), 0, u.w, u.h, st.th, lift, st.a, st.b, st.ca, st.cb);
    });
    batch.commit();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const kIn = prog(t, s, s + 0.4, ease.outCubic);
    this.setCam(this.camAt(t));
    const camPos = new THREE.Vector3().setFromMatrixPosition(this.cam.matrixWorld);
    const sh = this.wall.u.uShadow!.value as THREE.Vector4[];
    this.screenRect(sh[0]!);
    sh[1]!.set(0, 0, 0, 0);
    (this.wall.u.uPool!.value as THREE.Vector2).set(this.focus.x, this.focus.y);
    this.wall.u.uIn!.value = kIn;
    this.wall.render(renderer, out);

    this.drawUnits(this.cardsDark, this.dark, t, 0.14);
    this.drawUnits(this.cardsCream, this.cream, t, 0.12);
    // 冒號：跟著拍子閃
    const lastBeat = au.timeOfBeat(Math.floor(au.beatAt(t)));
    const bm = this.box.material as THREE.RawShaderMaterial;
    bm.uniforms.uDot!.value.w = 0.2 + 0.8 * pulse(t, lastBeat, 0.16);
    bm.uniforms.cameraPosition!.value.copy(camPos);
    bm.uniforms.uIn!.value = kIn;
    this.cardsDark.mat.uniforms.cameraPosition!.value.copy(camPos);
    this.cardsCream.mat.uniforms.cameraPosition!.value.copy(camPos);
    renderer.setRenderTarget(out);
    renderer.clearDepth();
    renderer.render(this.scene3, this.cam);
    return { bloom: 0.6, vignette: 0.6, halation: 0.2 };
  }

  override dispose() {
    for (const g of this.geoms) g.dispose();
    for (const m of this.mats) m.dispose();
    this.cardsDark?.dispose();
    this.cardsCream?.dispose();
    super.dispose();
  }
}
