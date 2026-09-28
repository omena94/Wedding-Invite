// 翻頁鐘（機器 A）：一座放大到整面牆的桌上翻頁鐘，立體的（three.js），鏡頭微微斜著看，像產品照。
//  - 上面四格大翻牌就是歌詞：一句切成幾頁（每頁最多四個字／英文四個字），一頁在第一個字要唱之前「啪、啪、啪」一格一格翻上來
//    （三成亮），唱到的字亮成訊號色、整格往前彈一下，唱完變紙白。翻牌是真的立體：上半片繞著轉軸往鏡頭倒下來、
//    過了 90° 看到它的背面（新字的下半），落到底還會彈一下；倒下來的那片在下半片投下影子。
//  - 沒有人唱的時候（間奏、純音樂），鐘就停在「03:13」（婚禮那天），冒號跟著拍子閃——這座鐘永遠停在那一天。
//  - 右邊一格小翻牌是「拍」：每一拍翻一片（1、2、3、4），第一拍是訊號色。
//  - 鐘的下巴印著完整的這一句歌詞（小字、照跟唱規則），讓人讀得到還沒翻上來的字。
//  - 下面一條同款的小翻牌列是主打留言（思源宋體，留言的聲音）：第一拍之後一個詞組一拍地翻上來，最後署名。
//  - 鏡頭：切進來時斜一點、第一拍落定；之後每兩小節換一個角度（緩進小節線）。
// 跟航班看板（平面、整面牆一起嘩啦啦）不同，這裡是少數幾格很大、很重的牌，一格一格慢慢翻，看的是機械與光影。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import type { Line, Word } from '../engine/lyrics';
import { rgba } from '../engine/palette';
import { ease, lerp, prog, pulse, hash } from '../engine/util';
import { beatAfter, barAfter, signature, COUPLE_EN, DATE_DOTS, WEDDING_DATE } from './_motifs';
import { GlyphAtlas, windowLines, wrapCells, flipAt, settle, lineCues, cueState, COL, type Flip, type GlyphReq } from './_t7';
import { CardBatch, boxMaterial, decalMaterial, WALL_FRAG } from './flipclock-gl';
import { fillWithHearts } from '../engine/motifs';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: false, energy: [0.2, 0.85], bars: [4, 8] };

// ---------------------------------------------------------------- 版面（預設鏡頭下的螢幕像素，y 往下；3D 裡 1 單位 = 1 px）
/** 四格大翻牌。 */
const BIG = { w: 228, h: 300, top: 150, xs: [150, 414, 678, 942] };
/** 冒號（只在「03:13」的時候出現）。 */
const COLON = { x: 660, y1: 252, y2: 350 };
/** 右邊的「拍」。 */
const BEAT = { x: 1214, w: 100, h: 136, top: 150 };
/** 機殼（正面）：上面是鐘，下面是留言，一整台；高度看留言有幾列。 */
const HB = { x: 112, y: 108, w: 1240, d: 110 };
/** 下巴上的整句歌詞。 */
const CAP = { x: 150, y: 462, w: 1024, h: 60 };
/** 留言的小翻牌：20 格一列，最多 4 列（字級約 45 px）。 */
const MS = { x: 150, top: 634, px: 56, py: 76, w: 50, h: 68, cols: 20, rows: 4 };
const FRONT_Z = -6;
/** 預設鏡頭距離：垂直視角 30° 時，z = 0 的平面上 1 單位剛好 1 px。 */
const DIST = 540 / Math.tan((15 * Math.PI) / 180);
/** 鏡頭繞著轉的點（整座鐘的中心）。 */
const PIVOT = new THREE.Vector3(732 - 960, 0, 0);

const F_BIG = F.archivo(62, 900);
const F_MS = F.ming(700);
const F_CAP = F.archivo(100, 500);
const [MM, DD] = String(WEDDING_DATE).split('-').slice(1) as [string, string];
/** 沒人唱的時候鐘停在婚禮那天：03:13。 */
const IDLE = [MM[0]!, MM[1]!, DD[0]!, DD[1]!];
const INVITE = '掃描右下角 QR code，把你的祝福翻上這座鐘。';
const TEXT = `拍留言新人廣播本鐘永遠停在這一天《》${INVITE}`;

interface Cam { yaw: number; pitch: number; dist: number }
/** 鏡位：每個都算過，四格大牌與留言都在安全範圍內（離邊 ≥ 96 px、不進右下角 QR 區）。 */
const CAMS: Cam[] = [
  { yaw: 0.12, pitch: -0.05, dist: 0.99 },
  { yaw: -0.1, pitch: 0.05, dist: 1.0 },
  { yaw: 0.05, pitch: 0.07, dist: 0.97 },
  { yaw: -0.13, pitch: -0.04, dist: 1.01 },
];

const WALL = () => new FSPass(WALL_FRAG, {
  uShadow: { value: [new THREE.Vector4(), new THREE.Vector4()] }, uPool: { value: new THREE.Vector2(760, 470) }, uIn: { value: 1 },
});

const SEG = new Intl.Segmenter('zh-Hant', { granularity: 'word' });
const isLatin = (s: string) => /[A-Za-z]/.test(s);

/** 一句切成幾頁（每頁最多 cap 個字／英文字）：先在空白與標點斷，太長再在斷詞的邊界平均切，中文詞不拆開。 */
function pagesOf(line: Line, cap: number): Word[][] {
  const ws = line.words;
  if (!ws.length) return [];
  const bounds = new Set<number>();
  for (const sg of SEG.segment(line.text)) bounds.add(sg.index);
  const phrases: Word[][] = [];
  let cur: Word[] = [];
  ws.forEach((w, i) => {
    cur.push(w);
    const nx = ws[i + 1];
    const gap = nx ? line.text.slice(w.o + w.w.length, nx.o) : '';
    const both = nx && isLatin(w.w) && isLatin(nx.w);
    if (!nx || /[，。！？!?,.、~～…；;：:]$/.test(w.w) || (!both && /\s/.test(gap))) { phrases.push(cur); cur = []; }
  });
  const split = (ph: Word[]): Word[][] => {
    if (ph.length <= cap) return [ph];
    const m = Math.ceil(ph.length / cap), ideal = ph.length / m;
    let best = Math.min(cap, ph.length - 1), bestD = Infinity;
    for (let j = Math.max(1, ph.length - cap * (m - 1)); j <= Math.min(cap, ph.length - 1); j++) {
      const d = Math.abs(j - ideal) + (bounds.has(ph[j]!.o) ? 0 : 10);
      if (d < bestD) { bestD = d; best = j; }
    }
    return [ph.slice(0, best), ...split(ph.slice(best))];
  };
  return phrases.flatMap(split);
}

interface Page { words: Word[]; line: Line; tIn: number; t0: number; t1: number }
interface Unit { evs: Flip[]; g0: number; c0: number; lights: number[] }

export default class Flipclock extends Scene {
  wall = shared('flipclock.wall', WALL);
  scene3 = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(30, W / H, 50, 9000);
  rig = new THREE.Object3D();
  big!: GlyphAtlas;
  small!: GlyphAtlas;
  cardsBig!: CardBatch;
  cardsMsg!: CardBatch;
  box!: THREE.Mesh;
  bodyH = 780;
  /** 下巴上的整句歌詞（每格可能變，但只有一條）。 */
  cap = this.track(new Layer2D(CAP.w, CAP.h, undefined, { fast: true }));
  /** 機殼上的小字與標籤：畫一次。 */
  lab!: Layer2D;
  private geoms: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  msg: Msg | null = this.ctx.params.message ?? null;
  units: Unit[] = [];
  beatUnit: Unit = { evs: [], g0: -1, c0: COL.BONE, lights: [] };
  msgUnits: { r: number; c: number; evs: Flip[] }[] = [];
  msRows = 3;
  pages: Page[] = [];
  /** 「03:13」的時段（冒號亮、下巴印歌名）。 */
  idle: [number, number][] = [];
  camTimes: number[] = [];
  beat = 0.5;
  tBoot = 0;
  avoid: [number, number, number, number][] = [];
  private capKey = '';
  private seed = 1;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    this.seed = this.ctx.params.seed ?? 1;
    this.beat = au.beatPeriod(s + 0.1);
    this.tBoot = beatAfter(au, s + 0.15);
    const lines = windowLines(lyrics, s, e);
    const m = this.msg;
    const body = m ? m.text : INVITE;
    const sig = m ? signature(m.name) : '';
    await loadText(TEXT + lines.map((l) => l.text).join('') + body + sig + (song.title ?? '') + (song.artist ?? ''));

    // ---- 字模：大牌（一格一個中文字或一個英文字）、小牌（留言）
    const reqs: GlyphReq[] = [];
    for (const l of lines) for (const w of l.words) reqs.push({ ch: w.w.trim(), family: F_BIG });
    for (const ch of '0123456789') reqs.push({ ch, family: F_BIG });
    this.big = this.track(new GlyphAtlas(reqs, 184, 240, { size: 150, fill: 0.86, shrink: true, mip: true }));
    this.small = this.track(new GlyphAtlas(Array.from(body + sig).map((ch) => ({ ch, family: F_MS })), 80, 108, { size: 73, mip: true }));
    this.ctx.renderer.initTexture(this.big.tex);
    this.ctx.renderer.initTexture(this.small.tex);

    this.buildPages(lines);
    this.buildBig();
    this.buildBeat();
    const rows = this.buildMessage(Array.from(body), Array.from(sig), !!m);
    this.msRows = Math.max(3, Math.min(MS.rows, rows));
    this.buildScene();
    this.drawLabels();
    // 鏡頭每兩小節換一次角度
    for (let k = 2; ; k += 2) { const tb = barAfter(au, s + 0.1, k); if (tb > e - 0.6) break; this.camTimes.push(tb); }
    this.avoid = this.computeAvoid();
  }

  // ---------------------------------------------------------------- 時間表
  private buildPages(lines: Line[]) {
    const s = this.ctx.start, e = this.ctx.end;
    const raw: { words: Word[]; line: Line }[] = [];
    for (const l of lines) for (const ws of pagesOf(l, 4)) raw.push({ words: ws, line: l });
    let prevEnd = -1e9;
    for (const r of raw) {
      const t0 = r.words[0]!.start, t1 = r.words[r.words.length - 1]!.end;
      if (t1 < s - 0.2 || t0 > e - 0.25) { prevEnd = Math.max(prevEnd, t1); continue; }
      // 在第一個字前 0.4 秒開始翻（四格依序，每格差 0.06 秒）；前一頁接得太緊就等它唱完，但一定在第一個字之前翻完
      const tIn = Math.max(s + 0.04, Math.min(Math.max(t0 - 0.4, prevEnd - 0.02), t0 - 0.2 - 0.06 * (r.words.length - 1)));
      this.pages.push({ ...r, tIn, t0, t1 });
      prevEnd = t1;
    }
    // 03:13 的時段：窗格開頭（第一頁還要等一陣子）、兩頁之間的長空檔、最後一頁之後
    const first = this.pages[0];
    if (!first || first.tIn > s + 1.0) this.idle.push([s, first ? first.tIn : e + 1]);
    this.pages.forEach((p, i) => {
      const nx = this.pages[i + 1];
      const a = p.t1 + 1.0, b = nx ? nx.tIn : e + 1;
      if (b - a > 1.6) this.idle.push([a, b]);
    });
  }

  private tokColor(w: Word, t: number) { return t < w.start ? COL.DIM : t < w.end ? COL.SIGNAL : COL.BONE; }

  /** 四格大牌的翻牌序列：每一頁翻上來（一格一格）、唱到的字變色（不翻）、03:13 的時段翻回日期。 */
  private buildBig() {
    const B = this.big;
    const idleG = IDLE.map((ch) => B.get(F_BIG, ch));
    // 鐘永遠有字：切進來時是 03:13，第一頁再翻上來
    this.units = BIG.xs.map((_, k) => ({ evs: [], g0: idleG[k]!, c0: COL.ASH, lights: [] }));
    type Ev = { t: number; kind: 'page'; p: Page } | { t: number; kind: 'idle' };
    const evs: Ev[] = [...this.pages.map((p) => ({ t: p.tIn, kind: 'page' as const, p })), ...this.idle.filter(([a]) => a > this.ctx.start).map(([a]) => ({ t: a, kind: 'idle' as const }))];
    evs.sort((a, b) => a.t - b.t);
    evs.forEach((ev, seg) => {
      for (let k = 0; k < 4; k++) {
        const u = this.units[k]!;
        const tl = ev.t + 0.06 * k + 0.17;
        if (ev.kind === 'idle') { u.evs.push({ tl, g: idleG[k]!, c: COL.ASH, k: 0, d: 0.17, seg }); continue; }
        const w = ev.p.words[k];
        if (!w) { u.evs.push({ tl, g: -1, c: COL.DIM, k: 0, d: 0.17, seg }); continue; }
        const g = B.get(F_BIG, w.w.trim());
        u.evs.push({ tl, g, c: this.tokColor(w, tl), k: 0, d: 0.17, seg });
        if (w.start > tl) u.evs.push({ tl: w.start, g, c: COL.SIGNAL, d: 0, seg });
        if (w.end > Math.max(tl, w.start)) u.evs.push({ tl: w.end, g, c: COL.BONE, d: 0, seg });
      }
    });
    // 被下一頁蓋掉的字不會亮（也不會彈）
    for (const u of this.units) { u.evs = settle(u.evs); u.lights = u.evs.filter((x) => x.d === 0 && x.c === COL.SIGNAL).map((x) => x.tl); }
  }

  /** 「拍」：每一拍翻一片，正好落在拍點上；第一拍是訊號色。 */
  private buildBeat() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, B = this.big;
    const numAt = (tb: number) => {
      const td = au.timeOfBar(Math.floor(au.barAt(tb + 1e-3)));
      return ((Math.round(au.beatAt(tb) - au.beatAt(td)) % 8) + 8) % 8 + 1;
    };
    const b0 = Math.floor(au.beatAt(s)), b1 = Math.ceil(au.beatAt(e)) + 1;
    const first = numAt(au.timeOfBeat(b0));
    this.beatUnit.g0 = B.get(F_BIG, String(first));
    this.beatUnit.c0 = first === 1 ? COL.SIGNAL : COL.BONE;
    for (let b = b0 + 1; b <= b1; b++) {
      const tb = au.timeOfBeat(b), n = numAt(tb);
      this.beatUnit.evs.push({ tl: tb, g: B.get(F_BIG, String(n)), c: n === 1 ? COL.SIGNAL : COL.BONE, k: 0, d: 0.12 });
    }
  }

  /** 留言：斷成 20 格一列；第一拍之後一個詞組一拍翻上來，最後署名。回傳用了幾列。 */
  private buildMessage(chars: string[], sig: string[], isMsg: boolean): number {
    const { audio: au } = this.ctx;
    const e = this.ctx.end, S = this.small;
    const rows = wrapCells(chars, MS.cols).slice(0, MS.rows);
    const order: { r: number; c: number; ch: string }[] = [];
    rows.forEach((row, r) => row.forEach((ci, c) => order.push({ r, c, ch: chars[ci]! })));
    const chunks: (typeof order)[] = [];
    let cur: typeof order = [];
    order.forEach((o, i) => {
      cur.push(o);
      const nx = order[i + 1];
      const word = /[\p{Script=Latin}\p{N}'’]/u.test(o.ch) && nx && /[\p{Script=Latin}\p{N}'’]/u.test(nx.ch);
      if (!nx || /[，。！？!?,.、~～…；;：:\s]/.test(o.ch) || (cur.length >= 4 && !word) || cur.length >= 10) { chunks.push(cur); cur = []; }
    });
    let sigAt: { r: number; c0: number } | null = null;
    const last = rows[rows.length - 1] ?? [];
    if (sig.length) {
      if (last.length + 1 + sig.length <= MS.cols) sigAt = { r: rows.length - 1, c0: MS.cols - sig.length };
      else if (rows.length < MS.rows) sigAt = { r: rows.length, c0: MS.cols - sig.length };
    }
    const t0 = beatAfter(au, this.tBoot + 0.2);
    const n = chunks.length + (sigAt ? 1 : 0);
    let step = n <= 8 ? this.beat : this.beat / 2;
    if (t0 + n * step > e - 0.8) step = Math.max(0.1, (e - 0.8 - t0) / Math.max(1, n));
    chunks.forEach((ch, j) => ch.forEach((o, i) => {
      const g = S.get(F_MS, o.ch);
      if (g < 0) return;
      this.msgUnits.push({ r: o.r, c: o.c, evs: [{ tl: t0 + j * step + i * 0.03, g, c: o.ch === '♥' ? COL.ROSE : isMsg ? COL.BONE : COL.ASH, k: 0, d: 0.11 }] });
    }));
    if (sigAt) {
      const ts = t0 + chunks.length * step;
      sig.forEach((ch, k) => {
        const g = S.get(F_MS, ch);
        if (g >= 0) this.msgUnits.push({ r: sigAt!.r, c: sigAt!.c0 + k, evs: [{ tl: ts + k * 0.03, g, c: COL.ASH, k: 0, d: 0.11 }] });
      });
    }
    return Math.max(rows.length, sigAt ? sigAt.r + 1 : 0);
  }

  // ---------------------------------------------------------------- 3D 場景
  private buildScene() {
    const wx = (x: number) => x - 960, wy = (y: number) => 540 - y;
    this.bodyH = MS.top + (this.msRows - 1) * MS.py + MS.h + 34 - HB.y;
    const H0 = this.bodyH;
    const mat = boxMaterial(HB.w, H0);
    const geo = new THREE.BoxGeometry(HB.w, H0, HB.d);
    this.box = new THREE.Mesh(geo, mat);
    this.box.position.set(wx(HB.x + HB.w / 2), wy(HB.y + H0 / 2), FRONT_Z - HB.d / 2);
    const wins = mat.uniforms.uWin!.value as THREE.Vector4[];
    BIG.xs.forEach((x, i) => wins[i]!.set(x - HB.x - 10, BIG.top - HB.y - 10, BIG.w + 20, BIG.h + 20));
    wins[4]!.set(BEAT.x - HB.x - 8, BEAT.top - HB.y - 8, BEAT.w + 16, BEAT.h + 16);
    // 下巴上印整句歌詞的深色長窗（奶油色的機殼上，訊號色的字不夠清楚）
    wins[5]!.set(CAP.x - HB.x - 14, CAP.y - HB.y - 4, CAP.w + 28, CAP.h + 4);
    // 鐘與留言之間一道溝
    wins[6]!.set(24, 556 - HB.y, HB.w - 48, 5);
    // 留言的牌
    wins[7]!.set(MS.x - HB.x - 12, MS.top - HB.y - 10, (MS.cols - 1) * MS.px + MS.w + 24, (this.msRows - 1) * MS.py + MS.h + 20);
    mat.uniforms.uNWin!.value = 8;
    mat.uniforms.uDot!.value.set(COLON.x - HB.x, COLON.y1 - HB.y, COLON.y2 - HB.y, 0);
    this.lab = this.track(new Layer2D(HB.w, H0, undefined, { fast: true }));
    // 貼在機殼上的字
    const decal = (tex: THREE.Texture, x: number, y: number, w: number, h: number) => {
      const g = new THREE.PlaneGeometry(w, h), mt = decalMaterial(tex);
      const me = new THREE.Mesh(g, mt);
      me.position.set(wx(x + w / 2), wy(y + h / 2), FRONT_Z + 0.6);
      this.geoms.push(g); this.mats.push(mt);
      this.scene3.add(me);
      return me;
    };
    decal(this.lab.texture, HB.x, HB.y, HB.w, H0);
    decal(this.cap.texture, CAP.x, CAP.y, CAP.w, CAP.h);
    this.cardsBig = new CardBatch(16, this.big.tex, [this.big.cols, this.big.rows], 9);
    this.cardsMsg = new CardBatch(MS.cols * MS.rows * 3 + 6, this.small.tex, [this.small.cols, this.small.rows], 4);
    this.geoms.push(geo); this.mats.push(mat);
    this.scene3.add(this.box, this.cardsBig.mesh, this.cardsMsg.mesh);
    this.rig.position.copy(PIVOT);
    this.rig.add(this.cam);
    this.scene3.add(this.rig);
  }

  private drawLabels() {
    const { song, audio: au } = this.ctx;
    const m = this.msg;
    const c = this.lab.ctx;
    this.lab.clear();
    c.textBaseline = 'alphabetic';
    // 機殼上緣：銘牌
    c.font = font(F.mono(500), 18); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 1);
    c.fillText(`${COUPLE_EN.toUpperCase()}  ·  ${DATE_DOTS}`, BIG.xs[0]! - HB.x, 30);
    c.textAlign = 'right';
    c.fillText('FLIP · CLOCK · No.0313', BEAT.x + BEAT.w - HB.x, 30);
    c.textAlign = 'left';
    // 「拍」的標籤與速度
    const bx = BEAT.x - HB.x, by = BEAT.top - HB.y + BEAT.h;
    c.font = font(F.hei(700), 26); c.letterSpacing = '0px'; c.fillStyle = rgba('sepia', 0.95);
    c.fillText('拍', bx, by + 48);
    c.font = font(F.mono(500), 14); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.8);
    c.fillText('BEAT', bx + 36, by + 46);
    let bpm = au.bpm || 100;
    while (bpm > 180) bpm /= 2;
    while (bpm < 60) bpm *= 2;
    c.font = font(F.mono(500), 30); c.letterSpacing = '1px'; c.fillStyle = rgba('sepia', 0.95);
    c.fillText(String(Math.round(bpm)), bx, by + 104);
    c.font = font(F.mono(500), 13); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.8);
    c.fillText('BPM', bx, by + 128);
    c.fillText(`${String(song.index).padStart(2, '0')}/${String(song.count).padStart(2, '0')}`, bx, by + 200);
    // 留言的標籤
    const ly = MS.top - HB.y - 24;
    c.font = font(F.hei(500), 19); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.9);
    const zh = m?.couple ? '新人廣播' : '留言';
    c.fillText(zh, MS.x - HB.x, ly);
    const w = c.measureText(zh).width;
    c.font = font(F.mono(500), 14); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.8);
    c.fillText(m ? (m.couple ? 'FROM THE COUPLE' : `MESSAGE  ·  No.${String(m.n).padStart(3, '0')}`) : 'MESSAGE  ·  —', MS.x - HB.x + w + 12, ly - 1);
    c.letterSpacing = '0px';
    this.ctx.renderer.initTexture(this.lab.upload());
  }

  // ---------------------------------------------------------------- 鏡頭
  private camAt(t: number): Cam {
    const s = this.ctx.start;
    const k0 = Math.floor(hash(this.seed, 7) * CAMS.length);
    let cur = CAMS[k0]!;
    // 切進來：多轉一點、近一點，第一拍落定
    const open: Cam = { yaw: cur.yaw + 0.07, pitch: cur.pitch - 0.03, dist: cur.dist * 0.94 };
    const ko = prog(t, s, Math.max(s + 0.35, this.tBoot + 0.1), ease.outExpo);
    let c: Cam = { yaw: lerp(open.yaw, cur.yaw, ko), pitch: lerp(open.pitch, cur.pitch, ko), dist: lerp(open.dist, cur.dist, ko) };
    this.camTimes.forEach((tb, i) => {
      const nx = CAMS[(k0 + i + 1) % CAMS.length]!;
      const k = prog(t, tb - 0.55 * this.beat, tb + 0.2 * this.beat, ease.inOutQuart);
      if (k <= 0) return;
      c = { yaw: lerp(c.yaw, nx.yaw, k), pitch: lerp(c.pitch, nx.pitch, k), dist: lerp(c.dist, nx.dist, k) };
      cur = nx;
    });
    // 很慢地往前推
    c.dist *= 1 - 0.018 * prog(t, s, this.ctx.end);
    return c;
  }

  private setCam(c: Cam) {
    this.rig.rotation.set(c.pitch, c.yaw, 0, 'YXZ');
    this.cam.position.set(-PIVOT.x, 0, DIST * c.dist);
    this.cam.rotation.set(0, 0, 0);
    this.rig.updateMatrixWorld(true);
    this.cam.updateMatrixWorld(true);
  }

  /** 螢幕上的範圍（所有鏡位的聯集）：四格大牌＋整句歌詞、留言。 */
  private computeAvoid(): [number, number, number, number][] {
    const wx = (x: number) => x - 960, wy = (y: number) => 540 - y;
    const rects = [
      [BIG.xs[0]! - 10, BIG.top - 10, BIG.xs[3]! + BIG.w + 10, CAP.y + CAP.h],
      [MS.x - 12, MS.top - 50, MS.x + (MS.cols - 1) * MS.px + MS.w + 12, MS.top + (this.msRows - 1) * MS.py + MS.h + 10],
    ];
    const out: [number, number, number, number][] = [];
    for (const [x0, y0, x1, y1] of rects) {
      let a = Infinity, b = Infinity, cx = -Infinity, dy = -Infinity;
      for (const cm of [...CAMS, ...CAMS.map((q) => ({ ...q, yaw: q.yaw + 0.07, pitch: q.pitch - 0.03, dist: q.dist * 0.94 }))]) {
        this.setCam(cm);
        for (const [x, y] of [[x0!, y0!], [x1!, y0!], [x0!, y1!], [x1!, y1!]]) {
          const v = new THREE.Vector3(wx(x), wy(y), 0).project(this.cam);
          const sx = (v.x * 0.5 + 0.5) * W, sy = (0.5 - v.y * 0.5) * H;
          a = Math.min(a, sx); b = Math.min(b, sy); cx = Math.max(cx, sx); dy = Math.max(dy, sy);
        }
      }
      out.push([a, b, cx - a, dy - b]);
    }
    return out;
  }

  /** 機殼在螢幕上的範圍（牆上的影子用）。 */
  private screenRect(mesh: THREE.Mesh, w: number, h: number, v: THREE.Vector4) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const [x, y] of [[-w / 2, -h / 2], [w / 2, -h / 2], [-w / 2, h / 2], [w / 2, h / 2]]) {
      const p = new THREE.Vector3(mesh.position.x + x!, mesh.position.y + y!, FRONT_Z - 60).project(this.cam);
      const sx = (p.x * 0.5 + 0.5) * W, sy = (0.5 - p.y * 0.5) * H;
      a = Math.min(a, sx); b = Math.min(b, sy); c = Math.max(c, sx); d = Math.max(d, sy);
    }
    v.set(a, b, c, d);
  }

  // ---------------------------------------------------------------- 每一格
  /** 一格大牌在 t 時的角度、字、色：翻動中用重力加速，落定後彈一下。 */
  private flapState(evs: Flip[], g0: number, c0: number, t: number, seed: number, bounce = 0.16) {
    const st = flipAt(evs, t, g0, c0, seed, []);
    if (st.since < 0) return { th: Math.PI * Math.pow(st.ph, 1.7), a: st.a, b: st.b, ca: st.ca, cb: st.cb };
    if (st.since < 0.35 && st.pa !== st.a) {
      const x = st.since;
      const th = Math.PI - bounce * Math.PI * Math.exp(-x / 0.07) * Math.abs(Math.sin(x * 26));
      return { th, a: st.pa, b: st.a, ca: st.pc, cb: st.ca };
    }
    return { th: 0, a: st.a, b: st.a, ca: st.ca, cb: st.ca };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const kIn = prog(t, s, s + 0.3, ease.outCubic);
    const cam = this.camAt(t);
    this.setCam(cam);
    const camPos = new THREE.Vector3().setFromMatrixPosition(this.cam.matrixWorld);

    // 牆（含機殼的影子）
    const sh = this.wall.u.uShadow!.value as THREE.Vector4[];
    this.screenRect(this.box, HB.w, this.bodyH, sh[0]!);
    sh[1]!.set(0, 0, 0, 0);
    this.wall.u.uIn!.value = kIn;
    this.wall.render(renderer, out);

    // 大牌
    const wx = (x: number) => x - 960, wy = (y: number) => 540 - y;
    const CB = this.cardsBig;
    CB.clear();
    let landed = 0;
    this.units.forEach((u, k) => {
      const st = this.flapState(u.evs, u.g0, u.c0, t, hash(this.seed, k) * 1e6);
      // 唱到的字：整格往前彈一下
      let lift = 0;
      for (const tl of u.lights) { const x = (t - tl) / 0.26; if (x >= 0 && x < 1) lift = Math.max(lift, 22 * Math.sin(Math.PI * x) * (1 - x)); }
      CB.unit(wx(BIG.xs[k]! + BIG.w / 2), wy(BIG.top + BIG.h / 2), 0, BIG.w, BIG.h, st.th, lift, st.a, st.b, st.ca, st.cb);
      for (const ev of u.evs) if ((ev.d ?? 0) > 0) landed = Math.max(landed, pulse(t, ev.tl, 0.05));
    });
    const bs = this.flapState(this.beatUnit.evs, this.beatUnit.g0, this.beatUnit.c0, t, 99, 0.1);
    CB.unit(wx(BEAT.x + BEAT.w / 2), wy(BEAT.top + BEAT.h / 2), 0, BEAT.w, BEAT.h, bs.th, 0, bs.a, bs.b, bs.ca, bs.cb);
    CB.commit();
    // 留言的小牌（沒有翻過的格子是空白的牌）
    const CM = this.cardsMsg;
    CM.clear();
    const filled = new Set<number>();
    for (const u of this.msgUnits) {
      const st = this.flapState(u.evs, -1, COL.BONE, t, u.r * 64 + u.c, 0.12);
      CM.unit(wx(MS.x + u.c * MS.px + MS.w / 2), wy(MS.top + u.r * MS.py + MS.h / 2), 0, MS.w, MS.h, st.th, 0, st.a, st.b, st.ca, st.cb);
      filled.add(u.r * 64 + u.c);
    }
    for (let r = 0; r < this.msRows; r++) for (let c = 0; c < MS.cols; c++) {
      if (filled.has(r * 64 + c)) continue;
      CM.unit(wx(MS.x + c * MS.px + MS.w / 2), wy(MS.top + r * MS.py + MS.h / 2), 0, MS.w, MS.h, 0, 0, -1, -1, 0, 0);
    }
    CM.commit();

    // 冒號：只在 03:13 的時段亮，跟著拍子閃
    const inIdle = this.idle.reduce((m, [a, b]) => Math.max(m, prog(t, a, a + 0.3) * (1 - prog(t, b - 0.1, b + 0.2))), 0);
    const lastBeat = au.timeOfBeat(Math.floor(au.beatAt(t)));
    const dot = inIdle > 0.01 ? inIdle * (0.25 + 0.75 * pulse(t, lastBeat, 0.16)) : -1;
    const bm = this.box.material as THREE.RawShaderMaterial;
    bm.uniforms.cameraPosition!.value.copy(camPos);
    bm.uniforms.uIn!.value = kIn;
    bm.uniforms.uDot!.value.w = dot;
    CB.mat.uniforms.cameraPosition!.value.copy(camPos);
    CM.mat.uniforms.cameraPosition!.value.copy(camPos);

    this.drawCaption(t, inIdle > 0.5);

    renderer.setRenderTarget(out);
    renderer.clearDepth();
    renderer.render(this.scene3, this.cam);
    return {
      bloom: 0.66, vignette: 0.5, halation: 0.22,
      zoom: 1 + 0.005 * landed,
      popupAvoid: this.avoid,
    };
  }

  /** 下巴：整句歌詞（照跟唱規則）；03:13 的時段印歌名。只有內容變了才重畫、重新上傳。 */
  private drawCaption(t: number, idle: boolean) {
    const { song } = this.ctx;
    const pg = [...this.pages].reverse().find((p) => t >= p.tIn - 0.2);
    const line = !idle && pg && t < pg.t1 + 1.6 ? pg.line : null;
    const cues = line ? lineCues(line) : null;
    const key = line ? `${line.i}|${cues!.map((c) => cueState(c, t)).join('')}` : `title|${idle}`;
    if (key === this.capKey) return;
    this.capKey = key;
    const L = this.cap, c = L.ctx;
    L.clear();
    c.textBaseline = 'alphabetic';
    const y = 42;
    if (!line || !cues) {
      c.font = font(F.mono(500), 16); c.letterSpacing = '4px'; c.fillStyle = rgba('ash', 0.8);
      const lab = '本鐘永遠停在這一天';
      c.fillText(idle ? lab : '', 0, y - 4);
      c.font = font(F_CAP, 30); c.letterSpacing = '1px'; c.fillStyle = rgba('bone', 0.7);
      const tt = `《${song.title || '今晚的歌'}》${song.artist ? `  ${song.artist}` : ''}`;
      c.textAlign = 'right';
      c.fillText(tt, CAP.w - 4, y);
      c.textAlign = 'left';
      L.upload();
      return;
    }
    // 整句一行：放不下就縮字（最小 26 px，這是輔助的一行，主角是上面的大牌）
    let size = 36;
    c.font = font(F_CAP, size);
    const wAll = c.measureText(line.text).width;
    if (wAll > CAP.w - 8) { size = Math.max(24, (size * (CAP.w - 8)) / wAll); c.font = font(F_CAP, size); }
    let x = 0;
    for (const cu of cues) {
      const st = cueState(cu, t);
      c.fillStyle = cu.ch === '♥' ? rgba('rose') : st === 0 ? rgba('bone', 0.32) : st === 1 ? rgba('signal') : rgba('bone', 0.9);
      if (cu.ch === '♥') fillWithHearts(c, cu.ch, x, y); else c.fillText(cu.ch, x, y);
      x += c.measureText(cu.ch).width;
    }
    L.upload();
  }

  override dispose() {
    for (const g of this.geoms) g.dispose();
    for (const m of this.mats) m.dispose();
    this.cardsBig?.dispose();
    this.cardsMsg?.dispose();
    super.dispose();
  }
}

