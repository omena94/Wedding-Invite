// 元素週期表（亮）：一張印在奶茶色紙上的週期表海報，右上角是真的 118 個元素（細線、小字、族別淡淡上色）。
//  - 主打留言的每個字是一個「元素」：從第一拍起，表上的某一格在拍點前亮起（訊號色），一塊元素方塊從那格飛出來，
//    邊飛邊變大，落地前翻面——背面是原本的元素符號（Au、Ne…），正面是留言的字——正好在拍點上落定。
//    方塊左上角是原子序：從留言編號開始（No.042 的第一個字是 42 號）。標點與空白不做方塊，跟在前一格後面。
//  - 右下方的「圖例」：一格大方塊「囍」，名稱是留言的署名、原子序是留言編號、原子量 1314.520（一生一世我愛你），
//    旁邊用細線標註每一欄是什麼——一本正經的冷面笑話。
//  - 歌詞在左上的「現場歌詞」欄，照跟唱規則（亮版面：唱到的字是訊號色的暗部，底下一道螢光筆）。
//  - 全部落定後，每一拍有一格的邊框亮一下，像有人拿筆一個字一個字指著讀。
//  - 沒有留言：方塊拼出「宣文♥孟庭」，下面邀請大家掃 QR（你的祝福也能成為一種元素）。純音樂：歌詞欄寫「本表配樂」與歌名。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, prog, pulse, hash } from '../engine/util';
import { tokens } from '../engine/text';
import { Lyrics } from '../engine/lyrics';
import { lyricAt, layoutLyric, beatAfter, drawHeart, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { Paper, stagger, bbox, pad3, mono, tag, type Rect } from './_t11';

export const spec: PlateSpecDecl = { group: 'type', family: 'science', paper: true, energy: [0.3, 0.9], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 週期表
const SYM = ('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe ' +
  'Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr ' +
  'Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og').split(' ');
/** 原子序 → 表上的列、行（鑭系、錒系放在下面兩列，列 7.3、8.3）。 */
function cellOf(z: number): { r: number; c: number } {
  if (z === 1) return { r: 0, c: 0 };
  if (z === 2) return { r: 0, c: 17 };
  if (z <= 4) return { r: 1, c: z - 3 };
  if (z <= 10) return { r: 1, c: z - 5 + 12 };
  if (z <= 12) return { r: 2, c: z - 11 };
  if (z <= 18) return { r: 2, c: z - 13 + 12 };
  if (z <= 36) return { r: 3, c: z - 19 };
  if (z <= 54) return { r: 4, c: z - 37 };
  if (z <= 56) return { r: 5, c: z - 55 };
  if (z <= 71) return { r: 7.3, c: z - 57 + 2 };
  if (z <= 86) return { r: 5, c: z - 72 + 3 };
  if (z <= 88) return { r: 6, c: z - 87 };
  if (z <= 103) return { r: 8.3, c: z - 89 + 2 };
  return { r: 6, c: z - 104 + 3 };
}
/** 族別（淡淡的底色）：s 區、d 區、p 區、鈍氣、f 區。 */
function family(z: number): 's' | 'd' | 'p' | 'n' | 'f' {
  const { r, c } = cellOf(z);
  if (r > 7) return 'f';
  if (c === 17) return 'n';
  if (c <= 1 && z !== 1) return 's';
  if (c >= 12 || z === 1) return 'p';
  return 'd';
}
/** 表的位置與格子大小（右上角）。 */
const TB = { x: 944, y: 112, cell: 48 };
const cellXY = (z: number) => { const { r, c } = cellOf(z); return { x: TB.x + c * TB.cell, y: TB.y + r * TB.cell }; };

// ---------------------------------------------------------------- 版面
const TITLE = '祝福元素週期表';
const LYR = { x: 124, y: 392, w: 740, size: 76 };
/** 留言方塊排在這裡（x < 1360：右下角 QR 上面不放字）。 */
const TILES = { x: 124, y: 604, w: 1210, h: 318 };
/** 圖例（大方塊＋標註）。 */
const KEY = { x: 1408, y: 612, s: 196 };
const FOOT = '＊原子序依祝福送達順序編排。本元素性質穩定，半衰期：永久。';
const INVITE = '掃描右下角 QR code，你的祝福也能成為一種新元素。';
const FAM_TILE = F.archivo(100, 700);

interface Tile { ch: string; tile: boolean; x: number; y: number; z: number; land: number; num: number }

export default class Elements extends Scene {
  paper = shared('t11.paper', () => new Paper());
  /** 不會變的：週期表、標題、註腳（init 畫一次）。 */
  base = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 每格重畫：亮起的格子、飛行中與落定的方塊、歌詞、圖例。 */
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 977 + (this.msg?.id ?? 0) * 131) >>> 0;
  tiles: Tile[] = [];
  S = 60; T = 78;
  dur = 0.4;
  tFirst = 0; tLast = 0; tKey = 0;
  name = '';
  num = 0;
  lyricsInWindow = false;
  avoid: Rect[] = [];
  bottom = 0;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const text = m ? m.text : COUPLE_ZH.replace(/\s*&\s*/, '♥');
    this.name = m ? (m.couple ? '新郎新娘' : m.name || '一位賓客') : '你？';
    this.num = m ? m.n : 0;
    await loadText(`${text}${TITLE}${FOOT}${INVITE}${this.name}${song.title}${song.artist}囍現場歌詞本表配樂圖例原子序原子量元素名稱符號一個字寫的人第幾則祝福一生一世我愛你`);
    const c = this.layer.ctx;

    // ---- 排方塊：找最大的字級，方塊邊長 = 字級 × 1.3，英文字不拆、標點跟在前一格後面
    const toks = tokens(text);
    const narrow = (ch: string) => !/[\p{L}\p{N}♥]/u.test(ch);
    const place = (S: number) => {
      const T = Math.round(S * 1.3), g = Math.round(T * 0.1), lh = T + Math.round(T * 0.2);
      const adv = (ch: string) => (ch === ' ' ? T * 0.42 : narrow(ch) ? S * 0.78 : T + g);
      const lines: { ch: string; x: number }[][] = [[]];
      let x = 0;
      for (const tk of toks) {
        const chars = Array.from(tk);
        const w = chars.reduce((a, ch) => a + adv(ch), 0);
        const wTrim = w - (tk.endsWith(' ') ? adv(' ') : 0);
        if (x > 0 && x + wTrim > TILES.w) { lines.push([]); x = 0; }
        for (const ch of chars) {
          if (!(x === 0 && ch === ' ')) lines[lines.length - 1]!.push({ ch, x });
          if (!(x === 0 && ch === ' ')) x += adv(ch);
        }
      }
      const h = lines.length * lh - Math.round(T * 0.2);
      return { T, lh, lines, h, ok: h <= TILES.h && lines.length <= 5 && lines.every((l) => l.every((q) => q.x + (narrow(q.ch) ? S * 0.78 : T) <= TILES.w + 1)) };
    };
    let lo = 40, hi = 150, best = place(lo);
    for (let k = 0; k < 12; k++) { const mid = (lo + hi) / 2, r = place(mid); if (r.ok) { best = r; lo = mid; } else hi = mid; }
    this.S = Math.floor(lo); best = place(this.S); this.T = best.T;
    // 元素：每個字挑一格（不重複）
    const used = new Set<number>();
    const pick = (i: number) => { let z = 1 + Math.floor(hash(this.seed, i, 7) * 118); while (used.has(z)) z = (z % 118) + 1; used.add(z); return z; };
    let k = 0;
    best.lines.forEach((ln, li) => {
      for (const q of ln) {
        const tile = !(q.ch === ' ' || narrow(q.ch));
        this.tiles.push({ ch: q.ch, tile, x: TILES.x + q.x, y: TILES.y + li * best.lh, z: tile ? pick(k) : 0, land: 0, num: tile ? (m ? m.n : 1) + k : 0 });
        if (tile) k++;
      }
    });
    this.bottom = TILES.y + best.h;

    // ---- 時間：第一拍後一拍一塊（或更密），兩小節內、也不超過窗格的四成五落定
    const beat = au.beatPeriod(s);
    this.tFirst = beatAfter(au, s + Math.min(0.2, beat * 0.4));
    this.dur = clamp(beat * 0.9, 0.3, 0.46);
    const bar = au.timeOfBar(au.barAt(this.tFirst) + 1) - this.tFirst;
    const t0 = Math.max(this.tFirst, beatAfter(au, s + this.dur + 0.05));
    const lands = stagger(au, t0, k, Math.min(2 * bar, 0.45 * (e - s)));
    let j = 0, lastLand = t0;
    for (const tl of this.tiles) { if (tl.tile) lastLand = lands[j++]!; tl.land = lastLand; }
    this.tLast = lastLand;
    this.tKey = Math.min(e - 0.6, this.tLast + beat);
    this.lyricsInWindow = lyrics.linesIn(s, e).length > 0;

    this.drawBase();

    // ---- 即時小卡避開：方塊、歌詞欄、圖例
    const tilesR: Rect = [TILES.x - 16, TILES.y - 20, TILES.w + 32, this.bottom - TILES.y + (m ? 30 : 110)];
    const key: Rect = [KEY.x - 16, KEY.y - 40, W - 96 - KEY.x + 32, KEY.s + 60];
    this.avoid = [tilesR, tilesR, key];
    if (this.lyricsInWindow) {
      let rows = 1;
      for (const line of lyrics.linesIn(s, e)) rows = Math.max(rows, layoutLyric(c, line, { family: F.archivo(100, 800), size: LYR.size, minSize: 48, maxWidth: LYR.w }).rows.length);
      const r = bbox([[LYR.x - 10, LYR.y - LYR.size - 10, LYR.w + 20, LYR.size * (rows > 1 ? 2.3 : 1.25) + 20]]);
      this.avoid.push(r, r);
    }
  }

  /** 不會變的東西畫一次：週期表（細線、小字、族別底色）、標題、註腳。 */
  private drawBase() {
    const c = this.base.ctx, cs = TB.cell;
    this.base.clear();
    const tint: Record<string, string> = { s: rgba('signal', 0.2), d: rgba('sepia', 0.035), p: rgba('blood', 0.08), n: rgba('rose', 0.16), f: rgba('sepia', 0.07) };
    for (let z = 1; z <= 118; z++) {
      const { x, y } = cellXY(z);
      c.fillStyle = tint[family(z)]!;
      c.fillRect(x + 1, y + 1, cs - 2, cs - 2);
      c.strokeStyle = rgba('sepia', 0.5); c.lineWidth = 1;
      c.strokeRect(x + 0.5, y + 0.5, cs - 1, cs - 1);
      c.font = font(F.mono(500), 9); c.fillStyle = rgba('sepia', 0.55);
      c.fillText(String(z), x + 4, y + 11);
      c.font = font(F.archivo(100, 700), 18); c.fillStyle = rgba('sepia', 0.85); c.textAlign = 'center';
      c.fillText(SYM[z - 1]!, x + cs / 2, y + 36);
      c.textAlign = 'left';
    }
    // 鑭系、錒系的佔位格（虛線）
    c.setLineDash([3, 3]); c.strokeStyle = rgba('sepia', 0.45);
    for (const r of [5, 6]) c.strokeRect(TB.x + 2 * cs + 0.5, TB.y + r * cs + 0.5, cs - 1, cs - 1);
    c.setLineDash([]);
    c.font = font(F.mono(500), 9); c.fillStyle = rgba('sepia', 0.55); c.textAlign = 'center';
    c.fillText('57–71', TB.x + 2.5 * cs, TB.y + 5.6 * cs); c.fillText('89–103', TB.x + 2.5 * cs, TB.y + 6.6 * cs);
    c.textAlign = 'left';
    // 族的編號
    for (let g = 1; g <= 18; g++) mono(c, String(g), TB.x + (g - 0.5) * cs, TB.y - 10 + (g === 1 || g === 18 ? 0 : g === 2 || g >= 13 ? cs : 3 * cs), { size: 10, tracking: 1, align: 'center', color: rgba('sepia', 0.5) });
    // 標題
    c.font = font(F.ming(900), 60); c.fillStyle = rgba('sepia');
    c.fillText(TITLE, 124, 176);
    mono(c, `PERIODIC TABLE OF WISHES  ·  ${DATE_DOTS}`, 126, 212, { size: 15, tracking: 3, color: rgba('sepia', 0.6) });
    c.fillStyle = rgba('sepia', 0.7); c.fillRect(124, 234, 740, 2);
    // 註腳
    c.font = font(F.hei(500), 17); c.letterSpacing = '2px'; c.fillStyle = rgba('sepia', 0.6);
    c.fillText(FOOT, 124, 978);
    c.letterSpacing = '0px';
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const fadeIn = prog(t, s, s + 0.3), exit = prog(t, e - 0.35, e, ease.inCubic);
    this.paper.render(renderer, out);
    comp.draw(renderer, this.base.texture, out, { opacity: fadeIn });
    const L = this.layer, c = L.ctx;
    L.clear();
    c.globalAlpha = 1 - exit;

    this.lyric(c, t);

    // ---- 方塊：先畫落定的，再畫飛行中的（在上面）
    const beat = au.beatPeriod(t);
    const S = this.S, T = this.T;
    const flying: Tile[] = [];
    // 全部落定後：每一拍輪到一格亮邊（像有人指著讀）
    const readIdx = t > this.tLast + beat ? Math.floor(au.beatAt(t) - au.beatAt(this.tLast + beat)) : -1;
    const tileList = this.tiles.filter((q) => q.tile);
    const reading = readIdx >= 0 && tileList.length ? tileList[readIdx % tileList.length]! : null;
    for (const q of this.tiles) {
      if (!q.tile) {
        if (t >= q.land) {
          c.font = font(FAM_TILE, S); c.fillStyle = rgba('sepia');
          c.fillText(q.ch, q.x + S * 0.02, q.y + T * 0.72);
        }
        continue;
      }
      const t0 = q.land - this.dur;
      // 起飛前 0.12 秒：表上那一格先亮
      if (t >= t0 - 0.12 && t < q.land + 0.5) {
        const { x, y } = cellXY(q.z);
        c.fillStyle = rgba('signal', t < t0 ? prog(t, t0 - 0.12, t0) * 0.9 : 0.9 * (1 - prog(t, t0, q.land + 0.5)));
        c.fillRect(x + 1, y + 1, TB.cell - 2, TB.cell - 2);
      }
      if (t < t0) continue;
      if (t < q.land) { flying.push(q); continue; }
      const thud = pulse(t, q.land, 0.09);
      this.tile(c, q, q.x, q.y - thud * 6, T, 1, 1, false, reading === q ? pulse(t, au.timeOfBeat(Math.floor(au.beatAt(t))), 0.25) : 0, thud);
    }
    for (const q of flying) {
      const p = (t - (q.land - this.dur)) / this.dur;
      const u = ease.outExpo(p);
      const from = cellXY(q.z);
      // 先往下、再往左（垂直方向走得比較快）：路線從歌詞欄的下面繞過去，不會掃過正在唱的字；邊飛邊從格子大小長到方塊大小
      const x = lerp(from.x, q.x, ease.outQuart(p)), y = lerp(from.y, q.y, u) + Math.sin(Math.PI * u) * 40;
      const sz = lerp(TB.cell, T, ease.outCubic(p));
      // 翻面：飛行的後三成，前半看到元素符號、後半看到留言的字
      const fl = clamp((p - 0.7) / 0.3);
      const sx = Math.abs(Math.cos(fl * Math.PI));
      this.tile(c, q, x, y, sz, sx, 1 + 0.08 * Math.sin(Math.PI * p), fl < 0.5, 0, 0, (1 - u) * 0.25 * (hash(q.z) - 0.5));
    }

    // ---- 圖例
    if (t >= this.tKey) this.key(c, t);
    // 沒有留言：方塊下面一行邀請
    if (!this.msg && t >= this.tLast) {
      c.save(); c.globalAlpha *= prog(t, this.tLast, this.tLast + 0.4);
      c.font = font(F.hand(700), 46); c.fillStyle = rgba('sepia');
      c.fillText(INVITE, TILES.x, this.bottom + 76);
      c.restore();
    }
    comp.draw(renderer, L.upload(), out);
    const landHit = this.tiles.reduce((a, q) => Math.max(a, q.tile ? pulse(t, q.land, 0.08) : 0), 0);
    return { paper: 1, bloom: 0.35, vignette: 0.22, grain: 0.04, halation: 0.05, zoom: 1 + 0.004 * landHit + 0.006 * pulse(t, this.tLast, 0.2), popupAvoid: this.avoid };
  }

  /**
   * 一塊元素方塊（左上角 x, y、邊長 sz）。sx：翻面時的水平縮放；back = 顯示背面（原本的元素）。
   * read：被「指著讀」的亮邊；thud：剛落定的那一下。
   */
  private tile(c: CanvasRenderingContext2D, q: Tile, x: number, y: number, sz: number, sx: number, lift: number, back: boolean, read: number, thud: number, rot = 0) {
    const fam = family(q.z);
    const heart = q.ch === '♥';
    c.save();
    c.translate(x + sz / 2, y + sz / 2);
    c.rotate(rot);
    c.scale(sx * lift, lift);
    const h = sz / 2;
    // 影子：飛起來的時候比較遠、比較淡
    const sh = (lift - 1) * 120 + 4;
    c.fillStyle = rgba('sepia', lift > 1.001 ? 0.12 : 0.1);
    c.fillRect(-h + sh * 0.6, -h + sh, sz, sz);
    // 底：紙色，族別淡淡上色
    c.fillStyle = rgba('paper');
    c.fillRect(-h, -h, sz, sz);
    const tint: Record<string, string> = { s: rgba('signal', 0.26), d: rgba('sepia', 0.05), p: rgba('blood', 0.1), n: rgba('rose', 0.2), f: rgba('sepia', 0.09) };
    c.fillStyle = tint[fam]!;
    c.fillRect(-h, -h, sz, sz);
    c.strokeStyle = read > 0.02 || thud > 0.02 ? mixRgba('sepia', 'blood', Math.max(read, thud)) : rgba('sepia', 0.85);
    c.lineWidth = Math.max(1.5, sz * 0.022) + 2.5 * Math.max(read, thud);
    c.strokeRect(-h, -h, sz, sz);
    // 左上：原子序；右上：原本的元素符號（小字，註明出處）
    const small = Math.max(11, sz * 0.13);
    c.font = font(F.mono(500), small); c.fillStyle = rgba('sepia', 0.75);
    c.fillText(back ? String(q.z) : String(q.num), -h + sz * 0.07, -h + small * 1.15);
    if (!back && sz > 70) { c.textAlign = 'right'; c.fillStyle = rgba('sepia', 0.45); c.fillText(SYM[q.z - 1]!, h - sz * 0.07, -h + small * 1.15); c.textAlign = 'left'; }
    // 中間：留言的字（或背面的元素符號）
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    if (back) {
      c.font = font(F.archivo(100, 700), sz * 0.46); c.fillStyle = rgba('sepia', 0.9);
      c.fillText(SYM[q.z - 1]!, 0, sz * 0.2);
    } else if (heart) {
      drawHeart(c, 0, sz * 0.04, sz * 0.52);
    } else {
      const fs = sz / 1.3;
      c.font = font(FAM_TILE, fs); c.fillStyle = rgba('sepia');
      c.fillText(q.ch, 0, fs * 0.36 + sz * 0.02);
    }
    c.textAlign = 'left';
    c.restore();
  }

  /** 圖例：一格「囍」元素，旁邊用細線標註每一欄。 */
  private key(c: CanvasRenderingContext2D, t: number) {
    const k = prog(t, this.tKey, this.tKey + 0.35, ease.outCubic);
    const { x, y, s } = KEY;
    c.save();
    c.globalAlpha *= k;
    tag(c, '圖例　KEY', x, y - 16, { size: 16, color: rgba('sepia', 0.7), tracking: 4 });
    c.fillStyle = rgba('sepia', 0.1); c.fillRect(x + 5, y + 7, s, s);
    c.fillStyle = rgba('paper'); c.fillRect(x, y, s, s);
    c.fillStyle = rgba('rose', 0.14); c.fillRect(x, y, s, s);
    c.strokeStyle = rgba('sepia'); c.lineWidth = 2.5;
    // 框用畫的：0.35 秒內沿著邊畫一圈
    const corners: [number, number][] = [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];
    c.beginPath(); c.moveTo(x, y);
    let left = 4 * s * k;
    for (let i = 1; i < 5 && left > 0; i++) {
      const [ax, ay] = corners[i - 1]!, [bx, by] = corners[i]!, u = Math.min(1, left / s);
      c.lineTo(lerp(ax, bx, u), lerp(ay, by, u));
      left -= s;
    }
    c.stroke();
    c.font = font(F.mono(600), 24); c.fillStyle = rgba('sepia');
    c.fillText(this.msg ? pad3(this.num) : '000', x + 14, y + 34);
    c.font = font(F.mono(500), 15); c.fillStyle = rgba('sepia', 0.75); c.textAlign = 'right';
    c.fillText('1314.520', x + s - 12, y + 30);
    c.textAlign = 'center';
    c.font = font(F.ming(900), 92); c.fillStyle = rgba('blood');
    c.fillText('囍', x + s / 2, y + s * 0.64);
    c.font = font(F.hei(700), Array.from(this.name).length > 6 ? 22 : Array.from(this.name).length > 4 ? 28 : 34); c.fillStyle = rgba('sepia');
    c.fillText(this.name, x + s / 2, y + s - 22);
    c.textAlign = 'left';
    // 標註：細線＋小字
    const lx = x + s + 18;
    const notes: [number, string][] = [[y + 26, '原子序＝第幾則祝福'], [y + 60, '原子量＝一生一世我愛你'], [y + s * 0.5, '符號＝一個字'], [y + s - 28, '名稱＝寫的人']];
    c.strokeStyle = rgba('sepia', 0.6); c.lineWidth = 1;
    notes.forEach(([ny, label], i) => {
      const kk = prog(t, this.tKey + 0.2 + i * 0.08, this.tKey + 0.45 + i * 0.08);
      if (kk <= 0) return;
      c.globalAlpha = k * kk;
      c.beginPath(); c.moveTo(x + s - 6, ny - 5); c.lineTo(lx - 4, ny - 5); c.stroke();
      c.fillStyle = rgba('sepia', 0.6); c.beginPath(); c.arc(x + s - 6, ny - 5, 2.5, 0, Math.PI * 2); c.fill();
      tag(c, label, lx, ny, { size: 15, color: rgba('sepia', 0.8), tracking: 1 });
    });
    c.restore();
  }

  /** 左上的歌詞欄：逐字跟唱（唱到的字訊號色的暗部＋一道螢光筆），純音樂寫「本表配樂」與歌名。 */
  private lyric(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    const ly = lyricAt(lyrics, t, 2.4);
    mono(c, this.lyricsInWindow ? '♪  現場歌詞　LIVE LYRICS' : '♪  本表配樂', LYR.x, 290, { size: 15, tracking: 3, color: rgba('sepia', 0.6) });
    if (!ly) {
      if (!this.lyricsInWindow) {
        c.font = font(F.ming(700), 56); c.fillStyle = rgba('sepia', 0.9);
        c.fillText(song.title, LYR.x, LYR.y - 10);
        if (song.artist) { c.font = font(F.ming(400), 30); c.fillStyle = rgba('sepia', 0.6); c.fillText(song.artist, LYR.x, LYR.y + 44); }
      }
      return;
    }
    const st = { family: F.archivo(100, 800), size: LYR.size, minSize: 48, maxWidth: LYR.w, lineHeight: 1.12 };
    const lay = layoutLyric(c, ly.line, st);
    const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.15));
    const oy = LYR.y - (lay.height - lay.size) * 0.5 + (1 - inK) * 18;
    c.save();
    c.globalAlpha *= ly.k;
    c.font = font(st.family, lay.size);
    for (const pw of lay.words) {
      const p = Lyrics.wordProgress(pw.word, t);
      const x = LYR.x + pw.x, y = oy + pw.y;
      if (p > 0 && p < 1) {
        // 螢光筆：跟著唱的進度畫過去
        c.fillStyle = rgba('signal', 0.42);
        c.fillRect(x - 4, y - lay.size * 0.42, (pw.w + 8) * p, lay.size * 0.5);
      }
      c.fillStyle = rgba('sepia', 0.26);
      if (p < 1) c.fillText(pw.word.w, x, y);
      if (p <= 0) continue;
      c.save(); c.beginPath(); c.rect(x - 6, y - lay.size * 1.1, (pw.w + 12) * p, lay.size * 1.5); c.clip();
      c.fillStyle = p < 1 ? rgba('blood') : rgba('sepia');
      c.fillText(pw.word.w, x, y);
      c.restore();
    }
    c.restore();
  }
}
