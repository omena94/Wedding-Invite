// 元素週期表（亮）：一張奶茶色紙上的週期表海報。MV 版：表是背景（右上、淡、微微失焦，像離鏡頭比較遠），
// 焦點是下方用「元素方塊」拼出來的主打留言；鏡頭整個窗格慢慢往前推。
//  - 主打留言的每個字是一個「元素」：從第一拍起，表上的某一格在拍點前亮起（訊號色），一塊方塊從那格飛出來，
//    邊飛邊變大、從模糊的背景飛到清楚的前景，落地前翻面——背面是原本的元素符號（Au、Ne…），正面是留言的字——正好在拍點上落定。
//    方塊左上角小小的原子序從留言編號開始（No.042 的第一個字是 42 號）。標點與空白不做方塊，跟在前一格後面。
//  - 歌詞在左上（比留言小一級），照跟唱規則（亮版面：唱到的字是訊號色的暗部，底下一道螢光筆）。
//  - 署名在方塊的右下；全部落定後，每一拍有一格的邊框亮一下，像有人拿筆一個字一個字指著讀。
//  - 小字只有兩群：左上的刊頭一行、左下的冷面註腳（原子量 1314.520＝一生一世我愛你）。
//  - 沒有留言：歌詞放大成焦點，方塊小小地拼出「宣文♥孟庭」、下面一行邀請。純音樂：左上寫這張表的配樂（歌名）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, prog, pulse, hash } from '../engine/util';
import { tokens } from '../engine/text';
import { Lyrics } from '../engine/lyrics';
import { lyricAt, layoutLyric, beatAfter, drawHeart, signature, fillWithHearts, COUPLE_ZH } from './_motifs';
import { Paper, stagger, mono, tag } from './_t11';

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
/** 表的位置與格子大小（右上角，背景）。 */
const TB = { x: 1062, y: 92, cell: 42 };
const cellXY = (z: number) => { const { r, c } = cellOf(z); return { x: TB.x + c * TB.cell, y: TB.y + r * TB.cell }; };

// ---------------------------------------------------------------- 版面
const MAST = 'PERIODIC TABLE OF WISHES　·　祝福元素週期表';
/** 有留言：歌詞在左上（表的左邊）；方塊在下面一整條（最下緣 820：鏡頭推近以後也不碰右下角 QR）。 */
const LYR_M = { x: 124, y: 316, w: 860 };
const TILES_M = { x: 124, y: 556, w: 1560, h: 262 };
/** 沒有留言：歌詞放大在中間偏下，方塊小小一排在更下面。 */
const LYR_N = { x: 124, y: 600, w: 1560, size: 104 };
const TILES_N = { x: 124, y: 700, w: 1200, h: 100 };
const FOOT = '＊原子序依祝福送達順序編排；原子量 1314.520（一生一世我愛你）。';
const INVITE = '掃描右下角 QR code，你的祝福也能成為一種新元素。';
const FAM_TILE = F.archivo(100, 700);
/** 鏡頭推近的最大倍率（字離邊與 QR 的距離是照這個算的）。 */
const PUSH = 0.02;

/** 一塊方塊。英文一個單字一塊（長方形，寬是字寬、高跟中文方塊一樣）：一個字母一格太碎，讀不出單字。r = 寬 ÷ 高。 */
interface Tile { ch: string; tile: boolean; x: number; y: number; z: number; land: number; num: number; r: number }

export default class Elements extends Scene {
  paper = shared('t11.paper', () => new Paper());
  /** 不會變的：週期表（微微失焦）、刊頭、註腳（init 畫一次）。 */
  base = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 每格重畫：亮起的格子、飛行中與落定的方塊、歌詞、署名。 */
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 977 + (this.msg?.id ?? 0) * 131) >>> 0;
  tiles: Tile[] = [];
  S = 60; T = 78;
  dur = 0.4;
  tFirst = 0; tLast = 0;
  lyrSize = 64;
  sig = '';
  sigX = 0; sigY = 0;
  lyricsInWindow = false;
  bottom = 0;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const text = m ? m.text : COUPLE_ZH.replace(/\s*&\s*/, '♥');
    this.sig = m ? (m.couple ? '—— 新郎新娘' : signature(m.name)) : '';
    await loadText(`${text}${MAST}${FOOT}${INVITE}${this.sig}${song.title}${song.artist}本表配樂`);
    const box = m ? TILES_M : TILES_N;

    // ---- 排方塊：找最大的字級，方塊邊長 = 字級 × 1.3；中文一字一塊、英文一個單字一塊，標點跟在前一格後面
    const toks = tokens(text);
    const narrow = (ch: string) => !/[\p{L}\p{N}♥]/u.test(ch);
    const mc = this.layer.ctx;
    const place = (S: number) => {
      const T = Math.round(S * 1.3), g = Math.round(T * 0.1), lh = T + Math.round(T * 0.2);
      mc.font = font(FAM_TILE, S);
      // 一個單位：英文單字（連在一起的拉丁字母、數字）是一塊，其他一字一個
      const units = (tk: string) => { const out: string[] = []; for (const part of tk.split(/([\p{Script=Latin}\p{N}'’\-&]+)/u)) { if (!part) continue; if (/^[\p{Script=Latin}\p{N}'’\-&]+$/u.test(part)) out.push(part); else out.push(...Array.from(part)); } return out; };
      const width = (u: string) => (u === ' ' ? T * 0.42 : narrow(u) ? S * 0.78 : Array.from(u).length > 1 ? Math.max(T, mc.measureText(u).width + T * 0.34) : T);
      const lines: { ch: string; x: number; w: number }[][] = [[]];
      let x = 0;
      for (const tk of toks) {
        const us = units(tk);
        const w = us.reduce((a, u) => a + width(u) + (u === ' ' || narrow(u) ? 0 : g), 0);
        const wTrim = w - (tk.endsWith(' ') ? width(' ') : 0);
        if (x > 0 && x + wTrim > box.w) { lines.push([]); x = 0; }
        for (const u of us) {
          if (x === 0 && u === ' ') continue;
          lines[lines.length - 1]!.push({ ch: u, x, w: width(u) });
          x += width(u) + (u === ' ' || narrow(u) ? 0 : g);
        }
      }
      const h = lines.length * lh - Math.round(T * 0.2);
      const right = Math.max(...lines.map((l) => (l.length ? l[l.length - 1]!.x + l[l.length - 1]!.w : 0)));
      return { T, lh, lines, h, right, ok: h <= box.h && lines.length <= 5 && right <= box.w + 1 };
    };
    let lo = 40, hi = m ? 150 : 56, best = place(lo);
    for (let k = 0; k < 12; k++) { const mid = (lo + hi) / 2, r = place(mid); if (r.ok) { best = r; lo = mid; } else hi = mid; }
    this.S = Math.floor(lo); best = place(this.S); this.T = best.T;
    // 元素：每個字挑一格（不重複）
    const used = new Set<number>();
    const pick = (i: number) => { let z = 1 + Math.floor(hash(this.seed, i, 7) * 118); while (used.has(z)) z = (z % 118) + 1; used.add(z); return z; };
    let k = 0;
    best.lines.forEach((ln, li) => {
      for (const q of ln) {
        const tile = !(q.ch === ' ' || narrow(q.ch));
        this.tiles.push({ ch: q.ch, tile, x: box.x + q.x, y: box.y + li * best.lh, z: tile ? pick(k) : 0, land: 0, num: tile ? (m ? m.n : 1) + k : 0, r: q.w / best.T });
        if (tile) k++;
      }
    });
    this.bottom = box.y + best.h;
    // 署名：方塊右下，靠右對齊（不進右下角 QR 區）
    this.sigX = Math.min(box.x + best.right, 1330);
    this.sigY = this.bottom + 58;
    // 歌詞比留言小一級（留言方塊的字 × 0.72，48～64 px）
    this.lyrSize = Math.round(clamp(this.S * 0.72, 48, 64));

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
    this.lyricsInWindow = lyrics.linesIn(s, e).length > 0;
    this.drawBase();
  }

  /** 不會變的東西畫一次：週期表（淡、微微失焦＝背景）、刊頭、註腳。 */
  private drawBase() {
    const c = this.base.ctx, cs = TB.cell;
    this.base.clear();
    c.save();
    c.filter = 'blur(1.4px)';
    c.globalAlpha = 0.62;
    const tint: Record<string, string> = { s: rgba('signal', 0.18), d: rgba('sepia', 0.03), p: rgba('blood', 0.07), n: rgba('rose', 0.14), f: rgba('sepia', 0.06) };
    for (let z = 1; z <= 118; z++) {
      const { x, y } = cellXY(z);
      c.fillStyle = tint[family(z)]!;
      c.fillRect(x + 1, y + 1, cs - 2, cs - 2);
      c.strokeStyle = rgba('sepia', 0.4); c.lineWidth = 1;
      c.strokeRect(x + 0.5, y + 0.5, cs - 1, cs - 1);
      c.font = font(F.archivo(100, 700), 16); c.fillStyle = rgba('sepia', 0.7); c.textAlign = 'center';
      c.fillText(SYM[z - 1]!, x + cs / 2, y + cs * 0.66);
      c.textAlign = 'left';
    }
    c.restore();
    // 刊頭（一行小字）與註腳（一行小字）：整個畫面只有這兩群小字
    mono(c, MAST, 124, 132, { size: 16, tracking: 3, color: rgba('sepia', 0.5) });
    tag(c, FOOT, 124, 976, { size: 17, tracking: 2, color: rgba('sepia', 0.5) });
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
      // 起飛前 0.12 秒：表上那一格先亮（背景失焦，所以亮得軟一點）
      if (t >= t0 - 0.12 && t < q.land + 0.5) {
        const { x, y } = cellXY(q.z);
        const a = t < t0 ? prog(t, t0 - 0.12, t0) : 1 - prog(t, t0, q.land + 0.5);
        c.fillStyle = rgba('signal', 0.3 * a); c.fillRect(x - 3, y - 3, TB.cell + 6, TB.cell + 6);
        c.fillStyle = rgba('signal', 0.75 * a); c.fillRect(x + 1, y + 1, TB.cell - 2, TB.cell - 2);
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
      // 先往下、再往左（垂直方向走得比較快）：路線從歌詞的下面繞過去，不會掃過正在唱的字；邊飛邊從格子大小長到方塊大小
      const x = lerp(from.x, q.x, ease.outQuart(p)), y = lerp(from.y, q.y, u) + Math.sin(Math.PI * u) * 40;
      const sz = lerp(TB.cell, T, ease.outCubic(p));
      // 翻面：飛行的後三成，前半看到元素符號、後半看到留言的字
      const fl = clamp((p - 0.7) / 0.3);
      const sx = Math.abs(Math.cos(fl * Math.PI));
      this.tile(c, q, x, y, sz, sx, 1 + 0.08 * Math.sin(Math.PI * p), fl < 0.5, 0, 0, (1 - u) * 0.25 * (hash(q.z) - 0.5));
    }

    // ---- 署名（留言）或邀請（沒有留言）
    if (t >= this.tLast) {
      const k = prog(t, this.tLast + beat * 0.5, this.tLast + beat * 0.5 + 0.35);
      c.save(); c.globalAlpha *= k;
      if (this.msg) {
        c.font = font(F.hand(400), 44); c.fillStyle = rgba('sepia', 0.8); c.textAlign = 'right';
        fillWithHearts(c, this.sig, this.sigX, this.sigY);
      } else {
        c.font = font(F.hand(700), 34); c.fillStyle = rgba('sepia', 0.7);
        c.fillText(INVITE, TILES_N.x, this.sigY - 6);
      }
      c.restore();
    }
    comp.draw(renderer, L.upload(), out);
    // 鏡頭：整個窗格慢慢往前推（inOutSine），方塊落定時頓一下
    const u = (1 - Math.cos(Math.PI * clamp((t - s) / Math.max(1, e - s)))) / 2;
    const landHit = this.tiles.reduce((a, q) => Math.max(a, q.tile ? pulse(t, q.land, 0.08) : 0), 0);
    return { paper: 1, bloom: 0.35, vignette: 0.3, grain: 0.04, halation: 0.05, zoom: 1 + PUSH * u + 0.003 * landHit };
  }

  /**
   * 一塊元素方塊（左上角 x, y、邊長 sz）。sx：翻面時的水平縮放；back = 顯示背面（原本的元素）。
   * read：被「指著讀」的亮邊；thud：剛落定的那一下。
   */
  private tile(c: CanvasRenderingContext2D, q: Tile, x: number, y: number, sz: number, sx: number, lift: number, back: boolean, read: number, thud: number, rot = 0) {
    const fam = family(q.z);
    const heart = q.ch === '♥';
    const wd = sz * q.r, hw = wd / 2;
    c.save();
    c.translate(x + hw, y + sz / 2);
    c.rotate(rot);
    c.scale(sx * lift, lift);
    const h = sz / 2;
    // 影子：飛起來的時候比較遠、比較淡
    const sh = (lift - 1) * 120 + 4;
    c.fillStyle = rgba('sepia', lift > 1.001 ? 0.12 : 0.1);
    c.fillRect(-hw + sh * 0.6, -h + sh, wd, sz);
    // 底：紙色，族別淡淡上色
    c.fillStyle = rgba('paper');
    c.fillRect(-hw, -h, wd, sz);
    const tint: Record<string, string> = { s: rgba('signal', 0.2), d: rgba('sepia', 0.04), p: rgba('blood', 0.08), n: rgba('rose', 0.16), f: rgba('sepia', 0.07) };
    c.fillStyle = tint[fam]!;
    c.fillRect(-hw, -h, wd, sz);
    c.strokeStyle = read > 0.02 || thud > 0.02 ? mixRgba('sepia', 'blood', Math.max(read, thud)) : rgba('sepia', 0.8);
    c.lineWidth = Math.max(1.5, sz * 0.02) + 2.5 * Math.max(read, thud);
    c.strokeRect(-hw, -h, wd, sz);
    // 左上：原子序（小字、淡）
    const small = Math.max(11, sz * 0.12);
    c.font = font(F.mono(500), small); c.fillStyle = rgba('sepia', 0.55);
    c.fillText(back ? String(q.z) : String(q.num), -hw + sz * 0.07, -h + small * 1.15);
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

  /** 歌詞：有留言時在左上（比留言小一級）；沒有留言時放大成焦點。唱到的字訊號色的暗部＋一道螢光筆。純音樂寫配樂。 */
  private lyric(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    const m = this.msg;
    const box = m ? { ...LYR_M, size: this.lyrSize } : LYR_N;
    const ly = lyricAt(lyrics, t, 2.4);
    if (!ly) {
      if (!this.lyricsInWindow) {
        tag(c, '本表配樂', box.x, box.y - box.size * 0.9 - 14, { size: 18, color: rgba('sepia', 0.5), tracking: 4 });
        c.font = font(F.ming(700), Math.round(box.size * 0.9)); c.fillStyle = rgba('sepia', 0.85);
        c.fillText(song.title, box.x, box.y);
      }
      return;
    }
    const st = { family: F.archivo(100, 800), size: box.size, minSize: 48, maxWidth: box.w, lineHeight: 1.12 };
    const lay = layoutLyric(c, ly.line, st);
    const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.15));
    // 兩行時往上長（最後一行的基線固定）
    const oy = box.y - (lay.height - lay.size) + (1 - inK) * 18;
    c.save();
    c.globalAlpha *= ly.k;
    c.font = font(st.family, lay.size);
    for (const pw of lay.words) {
      const p = Lyrics.wordProgress(pw.word, t);
      const x = box.x + pw.x, y = oy + pw.y;
      if (p > 0 && p < 1) {
        // 螢光筆：跟著唱的進度畫過去
        c.fillStyle = rgba('signal', 0.4);
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
