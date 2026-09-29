// 翻頁鐘（機器 A）：一台放大到整面牆的翻頁鐘（three.js 立體），暖黑的烤漆機身、一盞燈打在上面，鏡頭斜斜地慢慢推近。
// 照「留言尺寸與版面比例標準 v2」：鐘本身是主視覺、一直在翻；留言翻在機身右邊一小塊奶油色的牌上（字級 40～60）。
//  - 左邊四格大翻牌是「小節：拍」：這首歌第幾小節、這一小節第幾拍——每一拍最右邊那一片翻一下，小節線時整排跟著翻
//    （翻牌是真的立體：上半片繞著轉軸往鏡頭倒下來、過了 90° 看到背面，落到底還會彈一下，倒下來的那片在下半片投影子）。
//    大牌是暗的（深色的字），讓出焦點給留言；小節線那一拍的「1」是訊號色。
//  - 大牌下面一排黑色小牌是歌詞（40～52，比留言小）：一句在唱之前翻上來（三成亮），唱到的字亮成訊號色、往前彈一下，唱完變紙白。
//  - 右邊一塊奶油色的牌（≤ 630 × 430）：主打留言（思源宋體、墨色的字），第一拍之後一個詞組一拍「啪、啪」翻上來；
//    最後一列下面一排小一號的牌是署名。沒有留言：翻上邀請（小一點）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { ease, lerp, prog, pulse, hash } from '../engine/util';
import { beatAfter, barAfter, signature, COUPLE_EN, DATE_DOTS } from './_motifs';
import { GlyphAtlas, cuePages, windowLines, flipAt, settle, cueCol, bestCellWrap, COL, type Flip, type GlyphReq, type CuePage } from './_t7';
import { msgMaxFor, lyricV2, sigV2, V2 } from './_v2';
import { CardBatch, boxMaterial, decalMaterial, WALL_FRAG } from './flipclock-gl';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: false, energy: [0.2, 0.85], bars: [4, 8] };

// ---------------------------------------------------------------- 版面（預設鏡頭下的螢幕像素，y 往下；3D 裡 1 單位 = 1 px）
/** 機身（正面）。 */
const HB = { x: 100, y: 120, w: 1720, h: 720, d: 120 };
/** 四格大翻牌「小節：拍」與中間的冒號。 */
const BIGU = { y: 172, w: 232, h: 432, xs: [150, 398, 690, 938], colon: 660 };
/** 歌詞：大牌下面一排黑色小牌（牌高依 v2 的歌詞字級決定）。 */
const LYA = { x: 150, y: 650, maxW: 1020 };
/** 留言的奶油色牌可以用的範圍（右邊）。 */
const MB = { x: 1236, y: 190, w: 540, h: 430 };
const FRONT_Z = -6;
const DIST = 540 / Math.tan((15 * Math.PI) / 180);
/** 鏡頭繞著轉的點（機身中心）。 */
const PIVOT = new THREE.Vector3(960 - 960, 540 - 520, 0);
/** 桌面（機器底部）：下面畫機器的倒影，畫面下三分之一才不會是一片空的暗色。 */
const FLOOR_Y = HB.y + HB.h;
/** 字模圖集裡字佔格高的比例：牌高 = 字級 ÷ 這個比例。 */
const GB = 150 / 216, GS = 86 / 128;

const F_BIG = F.ming(700);
const F_LYR = F.archivo(100, 700);
const F_DIG = F.archivo(62, 900);
const F_INV = F.hei(700);
const INVITE = '掃描右下角 QR code，把你的祝福翻上這座鐘';

interface Cam { yaw: number; pitch: number; dist: number }
/** 鏡位：右邊往後退（不會壓到右下角的 QR），每兩小節換一個（緩進小節線）。 */
const CAMS: Cam[] = [
  { yaw: -0.1, pitch: 0.05, dist: 1.02 },
  { yaw: -0.06, pitch: 0.08, dist: 1.01 },
  { yaw: -0.12, pitch: 0.03, dist: 1.03 },
  { yaw: -0.08, pitch: 0.07, dist: 1.0 },
];

/** 桌面：蓋在倒影上的暖黑（倒影越往下越淡），右下角 HUD 那一塊整片蓋掉（背景要乾淨）。 */
const FLOOR = () => new FSPass(/* glsl */ `
  uniform float uY;
  uniform float uIn;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    if (p.y < uY - 2.0) discard;
    float k = clamp((p.y - uY) / 260.0, 0.0, 1.0);
    float a = mix(0.9, 0.992, k);
    a = max(a, smoothstep(1240.0, 1400.0, p.x));
    vec3 c = C_INK * 0.8 + (C_INK2 - C_INK) * 0.6 * (1.0 - k);
    // 桌面前緣一條細細的亮邊
    c += C_BONE * 0.03 * (1.0 - smoothstep(0.0, 2.0, abs(p.y - uY)));
    fragColor = vec4(c * uIn, a);
  }`, { uY: { value: 900 }, uIn: { value: 1 } }, { blending: THREE.NormalBlending, transparent: true });

const WALL = () => new FSPass(WALL_FRAG, {
  uShadow: { value: [new THREE.Vector4(), new THREE.Vector4()] }, uPool: { value: new THREE.Vector2(760, 470) }, uIn: { value: 1 },
});

/** 一格牌：位置大小、翻牌序列、起始的字與色、唱到時往前彈的時間。 */
interface Unit { x: number; y: number; w: number; h: number; evs: Flip[]; g0: number; c0: number; lights: number[] }
interface GridFit { cw: number; ch: number; px: number; py: number; cols: number; rows: number[][] }
const cellOf = (h: number) => { const w = Math.round(h * 0.78); return { cw: w, ch: h, px: w + Math.max(4, Math.round(w * 0.08)), py: h + Math.max(8, Math.round(h * 0.15)) }; };

/** 在 MB 裡排留言的牌：照子句排，挑斷得最少、字最大的牌（留一排給署名）。 */
function fitGrid(chars: string[], sigRow: number, maxH: number, minH: number): GridFit {
  const colsOf = (h: number) => { const k = cellOf(h); return Math.floor((MB.w + (k.px - k.cw)) / k.px); };
  const r = bestCellWrap(chars, minH, maxH, colsOf, (n, h) => { const k = cellOf(h); return n * k.py - (k.py - h) + sigRow <= MB.h; });
  return { ...cellOf(r.h), cols: colsOf(r.h), rows: r.rows };
}

export default class Flipclock extends Scene {
  wall = shared('flipclock.wall', WALL);
  scene3 = new THREE.Scene();
  /** 機器的所有東西（畫倒影時整組上下翻轉）。 */
  world = new THREE.Group();
  floor = shared('flipclock.floor', FLOOR);
  cam = new THREE.PerspectiveCamera(30, W / H, 50, 9000);
  rig = new THREE.Object3D();
  digits!: GlyphAtlas;
  small!: GlyphAtlas;
  big!: GlyphAtlas;
  cardsDig!: CardBatch;
  cardsLyr!: CardBatch;
  cardsCream!: CardBatch;
  box!: THREE.Mesh;
  /** 機身上的一小行字（畫一次）。 */
  lab!: Layer2D;
  private geoms: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  msg: Msg | null = this.ctx.params.message ?? null;
  bigUnits: Unit[] = [];
  lyrUnits: Unit[] = [];
  cream: Unit[] = [];
  msgPx = 48;
  beat = 0.5;
  tBoot = 0;
  sigTime = 0;
  camTimes: number[] = [];
  seed = 1;
  /** 留言那一塊的中心（對焦、燈的光圈）。 */
  focus = { x: 1400, y: 420 };

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
    const bigText = m ? m.text : INVITE;
    const bigFam = m ? F_BIG : F_INV;
    const title = song.title || '今晚的歌';
    await loadText(lines.map((l) => l.text).join('') + bigText + sig + COUPLE_EN + title);

    // ---- 字模：大牌的數字、小牌（歌詞）、奶油色的牌（留言）
    // 大牌是瘦長的（232 × 432）：圖集的格子照同樣的比例，數字才不會被拉長
    this.digits = this.track(new GlyphAtlas(Array.from('0123456789:').map((ch) => ({ ch, family: F_DIG })), 140, 260, { size: 214, fill: 0.86, mip: true }));
    const reqA: GlyphReq[] = Array.from(lines.map((l) => l.text).join('') + title).map((ch) => ({ ch, family: F_LYR }));
    this.small = this.track(new GlyphAtlas(reqA, 96, 128, { size: 86, mip: true }));
    this.big = this.track(new GlyphAtlas(Array.from(bigText + sig).map((ch) => ({ ch, family: bigFam })), 168, 216, { size: 150, mip: true }));
    for (const a of [this.digits, this.small, this.big]) this.ctx.renderer.initTexture(a.tex);

    this.buildBigUnits();
    // ---- 留言：字級上限依字數（v2），牌高 = 字級 ÷ 字佔格高的比例；沒有留言時邀請小一點
    const max = m ? msgMaxFor(bigText) : 40, min = m ? V2.msgMin : 34;
    const sigRow = m ? sigV2(max) / GB + 12 : 0;
    const fit = fitGrid(Array.from(bigText), sigRow, max / GB, min / GB);
    this.msgPx = fit.ch * GB;
    const width = Math.max(...fit.rows.map((r) => r.length), 1);
    // 只放有字的牌（每一列到最後一個字為止）：一整排空白的牌很吵，也讓留言區看起來比字大很多
    const at = new Map<string, number>();
    const chs = Array.from(bigText);
    fit.rows.forEach((row, r) => row.forEach((ci, c) => {
      // 空白不放牌（英文字之間空一格就好，灰色的空牌很吵）
      if (chs[ci] === ' ') return;
      at.set(`${r},${c}`, this.cream.length);
      this.cream.push({ x: MB.x + c * fit.px + fit.cw / 2, y: MB.y + r * fit.py + fit.ch / 2, w: fit.cw, h: fit.ch, evs: [], g0: -1, c0: COL.BONE, lights: [] });
    }));
    this.message(fit, at, Array.from(bigText), !!m, bigFam);
    let bottom = MB.y + fit.rows.length * fit.py - (fit.py - fit.ch);
    if (sig) {
      // 署名：留言最後一列下面、小一號的一排牌（v2 的署名字級），靠右對齊留言
      const k = cellOf(Math.round(sigV2(this.msgPx) / GB));
      const x1 = MB.x + width * fit.px - (fit.px - fit.cw);
      Array.from(sig).forEach((ch, i) => {
        const g = this.big.get(bigFam, ch);
        const u: Unit = { x: x1 - (sig.length - i) * k.px + (k.px - k.cw) + k.cw / 2, y: bottom + 12 + k.ch / 2, w: k.cw, h: k.ch, evs: [], g0: -1, c0: COL.ASH, lights: [] };
        if (g >= 0) u.evs.push({ tl: this.sigTime + i * 0.04, g, c: COL.ASH, k: 0, d: 0.13 });
        this.cream.push(u);
      });
      bottom += 12 + k.ch;
    }
    this.focus = { x: MB.x + (width * fit.px) / 2, y: (MB.y + bottom) / 2 };
    // ---- 歌詞：40～52（有留言時比留言小），一排
    const lk = cellOf(Math.round(lyricV2(m ? this.msgPx : null) / GS));
    const cols = Math.floor((LYA.maxW + lk.px - lk.cw) / lk.px);
    const pages = cuePages(lines, cols, 1, true).filter((p) => p.t1 > s - 0.3 && p.t0 < e - 0.2);
    const n = pages.length ? Math.max(6, ...pages.map((p) => p.rows[0]!.length)) : Math.min(cols, Array.from(title).length);
    for (let c = 0; c < Math.min(cols, n); c++) this.lyrUnits.push({ x: LYA.x + c * lk.px + lk.cw / 2, y: LYA.y + lk.ch / 2, w: lk.cw, h: lk.ch, evs: [], g0: -1, c0: COL.DIM, lights: [] });
    this.lyricRow(pages, title);

    this.buildScene();
    this.drawLabels();
  }

  /** 大牌「小節：拍」：每一拍最右邊那一格翻，小節線時整排翻（進位）；小節線那一拍是訊號色。 */
  private buildBigUnits() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, A = this.digits;
    const d = (ch: string) => A.get(F_DIG, ch);
    const b0 = Math.floor(au.beatAt(s)), b1 = Math.ceil(au.beatAt(e)) + 1;
    const stateAt = (b: number) => {
      const tb = au.timeOfBeat(b);
      const bar = Math.max(0, Math.floor(au.barAt(tb + 1e-3)));
      const beatIn = ((Math.round(au.beatAt(tb) - au.beatAt(au.timeOfBar(bar))) % 8) + 8) % 8 + 1;
      return { bar: String((bar + 1) % 100).padStart(2, '0'), beat: String(beatIn).padStart(2, '0'), down: beatIn === 1 };
    };
    const st0 = stateAt(b0);
    const chars0 = [...st0.bar, ...st0.beat];
    this.bigUnits = BIGU.xs.map((x, k) => ({ x: x + BIGU.w / 2, y: BIGU.y + BIGU.h / 2, w: BIGU.w, h: BIGU.h, evs: [], g0: d(chars0[k]!), c0: k === 3 && st0.down ? COL.SIGNAL : COL.ASH, lights: [] }));
    let prev = chars0;
    for (let b = b0 + 1; b <= b1; b++) {
      const st = stateAt(b), tb = au.timeOfBeat(b);
      const chars = [...st.bar, ...st.beat];
      chars.forEach((ch, k) => {
        const col = k === 3 && st.down ? COL.SIGNAL : COL.ASH;
        // 字一樣就不翻（只換顏色）；翻的那一片正好落在拍點上，翻的那一下亮成紙白、0.3 秒後退回灰
        if (ch === prev[k]) { this.bigUnits[k]!.evs.push({ tl: tb, g: d(ch), c: col, d: 0 }); return; }
        const tl = tb + 0.02 * (3 - k);
        this.bigUnits[k]!.evs.push({ tl, g: d(ch), c: col === COL.SIGNAL ? col : COL.BONE, k: 0, d: 0.16 });
        if (col !== COL.SIGNAL) this.bigUnits[k]!.evs.push({ tl: tl + 0.3, g: d(ch), c: col, d: 0 });
      });
      prev = chars;
    }
  }

  /** 留言：第一拍之後一個詞組一拍，一格一格「啪」地翻上來。 */
  private message(fit: GridFit, at: Map<string, number>, chars: string[], isMsg: boolean, fam: string) {
    const { audio: au } = this.ctx;
    const e = this.ctx.end, B = this.big;
    const order: { i: number; ch: string; r: number }[] = [];
    fit.rows.forEach((row, r) => row.forEach((ci, c) => { const i = at.get(`${r},${c}`); if (i !== undefined) order.push({ i, ch: chars[ci]!, r }); }));
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
      this.cream[o.i]!.evs.push({ tl: t0 + j * step + k * 0.045, g, c: o.ch === '♥' ? COL.ROSE : isMsg ? COL.BONE : COL.ASH, k: 0, d: 0.16 });
    }));
    this.sigTime = t0 + chunks.length * step;
  }

  /** 歌詞：一頁在第一個字要唱之前一格一格翻上來（三成亮），唱到的字變色、往前彈一下，唱完變紙白；沒有歌詞先翻上歌名。 */
  private lyricRow(pages: CuePage[], title: string) {
    const s = this.ctx.start, A = this.small, units = this.lyrUnits;
    const d = 0.13;
    const cur = new Array(units.length).fill(-1);
    const first = pages[0];
    if (!first || first.t0 - 0.5 > this.tBoot + 1.6) {
      Array.from(title).slice(0, units.length).forEach((ch, i) => {
        const g = A.get(F_LYR, ch);
        if (g < 0) return;
        units[i]!.evs.push({ tl: this.tBoot + 0.04 * i, g, c: COL.ASH, k: 0, d, seg: -1 });
        cur[i] = g;
      });
    }
    let prevEnd = -1e9;
    for (const [seg, pg] of pages.entries()) {
      const want = units.map(() => ({ g: -1, cue: -1 }));
      pg.rows[0]!.forEach((ci, c) => { if (c < units.length) want[c] = { g: A.get(F_LYR, pg.cues[ci]!.ch), cue: ci }; });
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

  // ---------------------------------------------------------------- 3D 場景
  private buildScene() {
    const wx = (x: number) => x - 960, wy = (y: number) => 540 - y;
    const mat = boxMaterial(HB.w, HB.h);
    const geo = new THREE.BoxGeometry(HB.w, HB.h, HB.d);
    this.box = new THREE.Mesh(geo, mat);
    this.box.position.set(wx(HB.x + HB.w / 2), wy(HB.y + HB.h / 2), FRONT_Z - HB.d / 2);
    // 凹下去的窗：大牌、歌詞、留言
    const wins = mat.uniforms.uWin!.value as THREE.Vector4[];
    let nw = 0;
    const win = (us: Unit[], pad: number) => {
      if (!us.length) return;
      const x0 = Math.min(...us.map((u) => u.x - u.w / 2)), x1 = Math.max(...us.map((u) => u.x + u.w / 2));
      const y0 = Math.min(...us.map((u) => u.y - u.h / 2)), y1 = Math.max(...us.map((u) => u.y + u.h / 2));
      wins[nw++]!.set(x0 - pad - HB.x, y0 - pad - HB.y, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad);
    };
    win(this.bigUnits, 14);
    win(this.lyrUnits, 10);
    win(this.cream, 16);
    mat.uniforms.uNWin!.value = nw;
    mat.uniforms.uDot!.value.set(BIGU.colon - HB.x, BIGU.y + BIGU.h * 0.33 - HB.y, BIGU.y + BIGU.h * 0.67 - HB.y, 0);
    this.lab = this.track(new Layer2D(HB.w, HB.h, undefined, { fast: true }));
    const g = new THREE.PlaneGeometry(HB.w, HB.h), mt = decalMaterial(this.lab.texture);
    const decal = new THREE.Mesh(g, mt);
    decal.position.set(wx(HB.x + HB.w / 2), wy(HB.y + HB.h / 2), FRONT_Z + 0.6);
    this.geoms.push(g, geo); this.mats.push(mt, mat);
    this.cardsDig = new CardBatch(this.bigUnits.length * 3 + 3, this.digits.tex, [this.digits.cols, this.digits.rows], 10);
    this.cardsLyr = new CardBatch(this.lyrUnits.length * 3 + 3, this.small.tex, [this.small.cols, this.small.rows], 5);
    this.cardsCream = new CardBatch(this.cream.length * 3 + 3, this.big.tex, [this.big.cols, this.big.rows], 6);
    this.cardsCream.mat.uniforms.uCream!.value = 1;
    // 燈的光圈：打在留言那一塊（大牌在光圈邊上，比較暗）
    for (const mm of [this.cardsDig.mat, this.cardsLyr.mat, this.cardsCream.mat, mat]) {
      // 光圈在大牌與留言中間：兩邊都照得到（大牌是主視覺，不要沉在暗處）
      (mm.uniforms.uPool!.value as THREE.Vector2).set(wx(1000), wy(420));
      mm.uniforms.uPoolR!.value = 1500;
    }
    this.world.add(this.box, decal, this.cardsDig.mesh, this.cardsLyr.mesh, this.cardsCream.mesh);
    this.scene3.add(this.world);
    this.rig.position.copy(PIVOT);
    this.rig.add(this.cam);
    this.scene3.add(this.rig);
  }

  /** 機身上的小字：大牌上面「小節 · 拍」、機身下緣一行銘文（整個畫面只有這兩小群小字）。 */
  private drawLabels() {
    const c = this.lab.ctx;
    this.lab.clear();
    c.textBaseline = 'alphabetic';
    c.fillStyle = rgba('ash', 0.55);
    c.font = font(F.hei(500), 17); c.letterSpacing = '5px';
    c.fillText('小節', BIGU.xs[0]! - HB.x, BIGU.y - 16 - HB.y);
    c.fillText('拍', BIGU.xs[2]! - HB.x, BIGU.y - 16 - HB.y);
    c.font = font(F.mono(500), 14); c.letterSpacing = '5px'; c.fillStyle = rgba('ash', 0.45);
    c.fillText(`FLIP · CLOCK  ·  ${COUPLE_EN.toUpperCase()}  ·  ${DATE_DOTS}`, BIGU.xs[0]! - HB.x, HB.h - 22);
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
    c.dist *= 1.03 - 0.045 * ease.inOutCubic(prog(t, s, this.ctx.end)) + 0.06 * ko;
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
    for (const [x, y] of [[-HB.w / 2, -HB.h / 2], [HB.w / 2, -HB.h / 2], [-HB.w / 2, HB.h / 2], [HB.w / 2, HB.h / 2]]) {
      const p = new THREE.Vector3(this.box.position.x + x!, this.box.position.y + y!, FRONT_Z - 60).project(this.cam);
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
    (this.wall.u.uPool!.value as THREE.Vector2).set(1000, 420);
    this.wall.u.uIn!.value = kIn;
    this.wall.render(renderer, out);

    this.drawUnits(this.cardsDig, this.bigUnits, t, 0.14);
    this.drawUnits(this.cardsLyr, this.lyrUnits, t, 0.12);
    this.drawUnits(this.cardsCream, this.cream, t, 0.12);
    // 冒號：跟著拍子閃
    const lastBeat = au.timeOfBeat(Math.floor(au.beatAt(t)));
    const bm = this.box.material as THREE.RawShaderMaterial;
    bm.uniforms.uDot!.value.w = 0.2 + 0.8 * pulse(t, lastBeat, 0.16);
    bm.uniforms.cameraPosition!.value.copy(camPos);
    bm.uniforms.uIn!.value = kIn;
    for (const b of [this.cardsDig, this.cardsLyr, this.cardsCream]) b.mat.uniforms.cameraPosition!.value.copy(camPos);
    renderer.setRenderTarget(out);
    // 桌面上的倒影：整組對桌面（機器底部）上下翻轉畫一次，再蓋一層越往下越濃的桌面色（倒影越遠越淡）
    this.world.scale.y = -1;
    this.world.position.y = 2 * (540 - FLOOR_Y);
    this.world.updateMatrixWorld(true);
    renderer.clearDepth();
    renderer.render(this.scene3, this.cam);
    this.world.scale.y = 1;
    this.world.position.y = 0;
    this.world.updateMatrixWorld(true);
    const fp = new THREE.Vector3(0, 540 - FLOOR_Y, FRONT_Z).project(this.cam);
    this.floor.u.uY!.value = (0.5 - fp.y * 0.5) * H;
    this.floor.u.uIn!.value = kIn;
    this.floor.render(renderer, out);
    renderer.setRenderTarget(out);
    renderer.clearDepth();
    renderer.render(this.scene3, this.cam);
    return { bloom: 0.6, vignette: 0.6, halation: 0.2 };
  }

  override dispose() {
    for (const g of this.geoms) g.dispose();
    for (const m of this.mats) m.dispose();
    this.cardsDig?.dispose();
    this.cardsLyr?.dispose();
    this.cardsCream?.dispose();
    super.dispose();
  }
}
