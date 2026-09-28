// 大字重擊（slam.ts）的排版：把一句歌詞（或一則留言）切成「一拍一組」的詞組，再排成撐滿舞台的大字塊。
// 為什麼不直接用 _motifs 的 layoutLyric：那是「一行字」的排法；重擊要一個詞組一個詞組地打上去，
// 每組有自己的位置（可以疊成好幾行），字級要大到撐滿舞台，而每個字仍然要照跟唱規則逐字亮起。
import { Lyrics, type Line, type Word } from '../engine/lyrics';
import { font } from '../engine/type';
import { phrases } from '../engine/text';
import { mixRgba, rgba, type PaletteKey } from '../engine/palette';
import { clamp, lerp } from '../engine/util';
import { drawHeart } from './_motifs';

const EASTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
/** 句讀：英文詞組到這裡一定斷開（一口氣唱完的地方）。 */
const BREAK_AFTER = /[，。！？!?,.;；:：、…~～]$/;

export const isEastern = (s: string) => EASTERN.test(s);
/** 重擊用大寫：拉丁字大寫才有海報的力道，而且沒有下伸部，行距可以壓得很緊。中文不受影響。 */
export const upper = (s: string) => s.toUpperCase();

/** 一個詞組：一拍打一組。 */
export interface Piece {
  /** 原文（歌詞行或留言）與詞組在原文裡的起訖位置。 */
  src: string;
  a: number;
  b: number;
  /** 顯示的字（拉丁字已轉大寫）。 */
  text: string;
  /** 前面原本有空白：跟前一組排在同一行時要留字距。 */
  gap: boolean;
  /** 歌詞的字（留言、邀請是空陣列）。 */
  words: Word[];
  /** 打上去的時間：歌詞是第一個字開始唱的那一刻；留言由版面排在拍點上。 */
  t0: number;
}

/**
 * 把文字切成詞組的起訖位置。空白一定斷開：中文歌詞的空白就是換氣的地方。
 * 中日韓的一段用 phrases()（瀏覽器內建斷詞）切成最多 cjkMax 字；英文一組最多 latinMax 個字母（短的虛詞會跟後面黏在一起）。
 */
export function splitRanges(text: string, cjkMax: number, latinMax: number): { a: number; b: number; gap: boolean }[] {
  const out: { a: number; b: number; gap: boolean }[] = [];
  // 累積中的英文詞組（pa < 0 表示沒有）
  let pa = -1, pb = -1, plen = 0, pgap = false;
  const flush = () => { if (pa >= 0) out.push({ a: pa, b: pb, gap: pgap }); pa = -1; };
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const tok = m[0], a = m.index, b = a + tok.length;
    const gap = out.length > 0 || pa >= 0;
    if (EASTERN.test(tok)) {
      flush();
      // phrases() 不增刪任何非空白字、順序不變：依序累加長度就能換回原文位置（對不上就整段當一組）
      const ps = phrases(tok, cjkMax);
      if (ps.join('') !== tok) { out.push({ a, b, gap }); continue; }
      let i = a;
      ps.forEach((p, k) => { out.push({ a: i, b: i + p.length, gap: k === 0 && gap }); i += p.length; });
    } else {
      const len = (tok.match(/[\p{L}\p{N}]/gu) ?? []).length;
      if (pa >= 0 && (plen + len > latinMax || BREAK_AFTER.test(text.slice(pa, pb)))) flush();
      if (pa < 0) { pa = a; pb = b; plen = len; pgap = gap; } else { pb = b; plen += len; }
    }
  }
  flush();
  return out;
}

/** 一行歌詞的詞組：字屬於它第一個字元落在的那組；沒有字的組（純標點）丟掉。 */
export function linePieces(line: Line, cjkMax = 4, latinMax = 9): Piece[] {
  const out: Piece[] = [];
  for (const r of splitRanges(line.text, cjkMax, latinMax)) {
    const words = line.words.filter((w) => w.o >= r.a && w.o < r.b);
    if (!words.length) continue;
    const first = words[0]!, last = words[words.length - 1]!;
    const a = first.o, b = Math.max(r.b, last.o + last.w.length);
    out.push({ src: line.text, a, b, text: upper(line.text.slice(a, b)), gap: r.gap, words, t0: first.start });
  }
  return out;
}

/** 留言、邀請之類不是唱出來的字：切好詞組，時間由版面排。 */
export function textPieces(text: string, cjkMax: number, latinMax: number): Piece[] {
  return splitRanges(text, cjkMax, latinMax).map((r) => ({ src: text, a: r.a, b: r.b, text: upper(text.slice(r.a, r.b)), gap: r.gap, words: [], t0: 0 }));
}

// ---------------------------------------------------------------- 大字塊
/** 一個可以單獨上色的片段：歌詞的一個字（跟唱用），或整組非歌詞的字。x 相對詞組左緣。 */
export interface Cell { s: string; x: number; w: number; word: Word | null }
export interface Placed { x: number; y: number; w: number; row: number; cells: Cell[] }
export interface Row { y: number; x: number; w: number; asc: number; desc: number }
export interface Slab {
  family: string;
  size: number;
  /** 字距（px，已經乘上字級）。 */
  tracking: number;
  pieces: Placed[];
  rows: Row[];
  /** 整塊的墨色範圍（原點＝整塊左緣、第一行基線）。 */
  width: number;
  top: number;
  bottom: number;
  eastern: boolean;
}

export interface SlabOpts {
  /** 候選字族（拉丁字的寬度），排在前面的優先。 */
  families: string[];
  w: number;
  h: number;
  maxRows?: number;
  maxSize?: number;
  minSize?: number;
  align?: 'left' | 'center';
  /** 字距（em）。 */
  track?: number;
  /** 行距（em）；預設中文 1.1、純大寫拉丁 0.96。 */
  pitch?: number;
}

function measurer(c: CanvasRenderingContext2D, family: string, size: number, trackEm: number) {
  c.font = font(family, size);
  c.letterSpacing = `${trackEm * size}px`;
  return (s: string) => c.measureText(s).width;
}

/**
 * 把詞組分成 r 行（連續、不改順序）：最寬的一行盡量窄，但換行最好落在句讀或空白（換氣的地方），
 * 不然「吵吵鬧鬧到／現在」這種斷法很難讀。`soft[i]`：第 i 組前面可以自然換行。回傳每行第一組的索引。
 * 詞組最多十幾組、最多四行，直接窮舉。
 */
function partition(w: number[], gaps: number[], soft: boolean[], r: number): number[] {
  const n = w.length;
  const rowW = (i: number, j: number) => { let s = 0; for (let k = i; k < j; k++) s += w[k]! + (k > i ? gaps[k]! : 0); return s; };
  let best: number[] = [0], bestS = Infinity;
  const cur: number[] = [0];
  const walk = (from: number, left: number) => {
    if (left === 0) {
      let m = 0, hard = 0;
      cur.forEach((s0, k) => { m = Math.max(m, rowW(s0, cur[k + 1] ?? n)); if (k > 0 && !soft[s0]) hard++; });
      const sc = m * (1 + 0.14 * hard);
      if (sc < bestS) { bestS = sc; best = cur.slice(); }
      return;
    }
    for (let i = from + 1; i <= n - left; i++) { cur.push(i); walk(i, left - 1); cur.pop(); }
  };
  walk(0, r - 1);
  return best;
}

/**
 * 排一塊大字：試每個候選字族與行數，找字級最大的排法（行數多、字族窄會小小扣分：一樣大時選行少、字寬的，比較好讀）。
 * 每組的位置、每個字的位置都在這裡算好（init 時做），畫的時候只要照著畫。
 */
export function layoutSlab(c: CanvasRenderingContext2D, pieces: Piece[], o: SlabOpts): Slab {
  const n = pieces.length, trackEm = o.track ?? 0;
  const eastern = pieces.some((p) => EASTERN.test(p.text));
  const pitchEm = o.pitch ?? (eastern ? 1.1 : 0.96);
  const maxRows = Math.max(1, Math.min(o.maxRows ?? 4, n));
  const soft = pieces.map((p, i) => i === 0 || p.gap || BREAK_AFTER.test(pieces[i - 1]!.text));
  let best: { fam: string; starts: number[]; size: number; score: number } | null = null;
  o.families.forEach((fam, fi) => {
    const m = measurer(c, fam, 100, trackEm);
    const w100 = pieces.map((p) => m(p.text));
    const sp = m(' ');
    const gaps = pieces.map((p, i) => (i > 0 && p.gap ? sp : 0));
    for (let r = 1; r <= maxRows; r++) {
      const starts = partition(w100, gaps, soft, r);
      let maxW = 0, asc0 = 0, descL = 0;
      starts.forEach((s0, k) => {
        const s1 = starts[k + 1] ?? n;
        let rw = 0;
        for (let i = s0; i < s1; i++) rw += w100[i]! + (i > s0 ? gaps[i]! : 0);
        maxW = Math.max(maxW, rw);
        const txt = pieces.slice(s0, s1).map((p) => p.text).join('');
        const mt = c.measureText(txt);
        if (k === 0) asc0 = mt.actualBoundingBoxAscent;
        if (k === starts.length - 1) descL = Math.max(0, mt.actualBoundingBoxDescent);
      });
      const inkH = asc0 + (r - 1) * pitchEm * 100 + descL;
      const size = Math.min(o.maxSize ?? 600, (o.w * 100) / Math.max(1, maxW), (o.h * 100) / Math.max(1, inkH));
      const score = size * (1 - 0.05 * (r - 1)) * (1 - 0.035 * fi);
      if (!best || score > best.score) best = { fam, starts, size, score };
    }
  });
  const b = best!;
  const size = Math.max(o.minSize ?? 1, Math.floor(b.size));
  const family = b.fam, tracking = trackEm * size;
  const m = measurer(c, family, size, trackEm);
  const sp = m(' ');
  const rows: Row[] = [];
  const placed: Placed[] = [];
  b.starts.forEach((s0, k) => {
    const s1 = b.starts[k + 1] ?? n;
    let x = 0;
    for (let i = s0; i < s1; i++) {
      const p = pieces[i]!;
      if (i > s0 && p.gap) x += sp;
      const w = m(p.text);
      const cells: Cell[] = p.words.length
        ? p.words.map((wd) => ({ s: upper(wd.w), x: m(upper(p.src.slice(p.a, wd.o))), w: m(upper(wd.w)), word: wd }))
        : [{ s: p.text, x: 0, w, word: null }];
      placed.push({ x, y: k * pitchEm * size, w, row: k, cells });
      x += w;
    }
    const mt = c.measureText(pieces.slice(s0, s1).map((p) => p.text).join(''));
    rows.push({ y: k * pitchEm * size, x: 0, w: x, asc: mt.actualBoundingBoxAscent, desc: Math.max(0, mt.actualBoundingBoxDescent) });
  });
  c.letterSpacing = '0px';
  const width = Math.max(...rows.map((r) => r.w));
  if (o.align === 'center') {
    for (const r of rows) r.x = (width - r.w) / 2;
    for (const p of placed) p.x += rows[p.row]!.x;
  }
  const last = rows[rows.length - 1]!;
  return { family, size, tracking, pieces: placed, rows, width, top: -rows[0]!.asc, bottom: last.y + last.desc, eastern };
}

// ---------------------------------------------------------------- 畫
/** 一組顏色：[色票, 透明度]。 */
export type Ink = [PaletteKey, number];
export interface Tone { un: Ink; act: Ink; sung: Ink }

const mix = (a: Ink, b: Ink, k: number) => (k <= 0 ? rgba(a[0], a[1]) : k >= 1 ? rgba(b[0], b[1]) : mixRgba(a[0], b[0], k, lerp(a[1], b[1], k)));

/**
 * 畫字，♥ 換成我們自己畫的愛心（點綴色）。TREATMENT 規定愛心只用 drawHeart 的那顆：
 * 字型裡的 ♥ 每套字都長得不一樣，大字時特別明顯。
 */
export function fillRich(c: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, heartA = 1) {
  c.fillStyle = color;
  if (!s.includes('♥')) { c.fillText(s, x, y); return; }
  let i = 0;
  for (const part of s.split(/(♥)/)) {
    if (!part) continue;
    const px = x + (i ? c.measureText(s.slice(0, i)).width : 0);
    if (part === '♥') {
      const w = c.measureText('♥').width;
      drawHeart(c, px + w / 2, y - size * 0.36, size * 0.72, rgba('rose', heartA));
    } else { c.fillStyle = color; c.fillText(part, px, y); }
    i += part.length;
  }
}

/**
 * 畫一組（原點在這組的左緣基線，字型已設好）。歌詞照跟唱規則：還沒唱的淡、正在唱的訊號色（掃過去）、
 * 唱完的在 `cool` 秒內從訊號色退成紙白——像仙女棒寫的字冷卻下來，不是一下子跳色。
 * 非歌詞的字用 `heat`（0..1，剛打上去是熱的）在 sung 與 act 之間混色。
 * 回傳正在唱的筆尖（相對原點），給火花用。
 */
export function drawCells(c: CanvasRenderingContext2D, cells: Cell[], size: number, t: number, tone: Tone, heat = 0, cool = 0.4): { x: number; y: number } | null {
  let head: { x: number; y: number } | null = null;
  for (const cl of cells) {
    if (!cl.word) { fillRich(c, cl.s, cl.x, 0, size, mix(tone.sung, tone.act, heat), tone.sung[1]); continue; }
    const w = cl.word, p = Lyrics.wordProgress(w, t);
    if (p < 1) fillRich(c, cl.s, cl.x, 0, size, rgba(tone.un[0], tone.un[1]), tone.un[1]);
    if (p <= 0) continue;
    const h = p < 1 ? 1 : 1 - clamp((t - w.end) / cool);
    const col = mix(tone.sung, tone.act, h);
    if (p < 1) {
      c.save();
      c.beginPath();
      c.rect(cl.x - size * 0.08, -size * 1.3, (cl.w + size * 0.16) * p, size * 1.8);
      c.clip();
      fillRich(c, cl.s, cl.x, 0, size, col);
      c.restore();
      head = { x: cl.x + cl.w * p, y: 0 };
    } else fillRich(c, cl.s, cl.x, 0, size, col);
  }
  return head;
}

/** 這組歌詞在 t 時的筆尖（相對原點；沒在唱是 null）。給火花的粒子回推過去的位置用。 */
export function headAt(cells: Cell[], t: number): { x: number; y: number } | null {
  for (const cl of cells) {
    if (!cl.word) continue;
    const p = Lyrics.wordProgress(cl.word, t);
    if (p > 0 && p < 1) return { x: cl.x + cl.w * p, y: 0 };
  }
  return null;
}
