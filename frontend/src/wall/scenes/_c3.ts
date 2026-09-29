// 批次 C3（狗狗＋約會：zoomies、dogportrait、ringbearer、picnic、kite、umbrella）共用的小工具。
//  - `Lit`：暗版面裡「只染紙偶、不染別的」的打光。_puppet 的 puppetLight 是對整層 source-atop，
//    紙偶跟字、道具交錯前後時（狗從歌詞前面跑過去、人站在留言前面）會連字一起染暗；
//    這裡先把紙偶畫到一張小的暫存畫布、在那裡染好，再貼回圖層，前後順序就可以任意排。
//  - `CharLyric`：一個字一個字擺的跟唱歌詞（每個字可以自己位移、轉：被狗撞得跳起來、在水面上晃），
//    上色照跟唱規則（還沒唱淡、正在唱訊號色、唱完紙白／墨色）。
import { Lyrics, type Line } from '../engine/lyrics';
import { font } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp } from '../engine/util';

type Ctx = CanvasRenderingContext2D;
type Box = readonly [number, number, number, number];

/** 暫存畫布（每個版面物件一張，窗格結束就丟；不用 track：沒有 GPU 資源）。 */
export class Lit {
  private cv: OffscreenCanvas;
  private sc: OffscreenCanvasRenderingContext2D;
  constructor(w = 1400, h = 1000) {
    this.cv = new OffscreenCanvas(w, h);
    this.sc = this.cv.getContext('2d')!;
  }

  /**
   * 在 box（畫面座標）裡用 draw 畫紙偶（照畫面座標畫，暫存畫布已經平移好），上面染 top、往下漸變到 bottom（source-atop，只染畫到的像素），
   * 再貼到 c。ghosts：先貼幾張位移過、淡的（殘影），最後才貼本體。
   */
  draw(c: Ctx, box: Box, top: string, bottom: string, draw: (sc: Ctx) => void, o: { alpha?: number; ghosts?: readonly { dx: number; dy: number; a: number }[] } = {}): void {
    const pad = 4;
    const bx = Math.floor(box[0] - pad), by = Math.floor(box[1] - pad);
    const w = Math.min(this.cv.width, Math.ceil(box[2] + pad * 2)), h = Math.min(this.cv.height, Math.ceil(box[3] + pad * 2));
    if (w <= 0 || h <= 0) return;
    const sc = this.sc;
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.globalAlpha = 1;
    sc.globalCompositeOperation = 'source-over';
    sc.clearRect(0, 0, w + 2, h + 2);
    sc.setTransform(1, 0, 0, 1, -bx, -by);
    draw(sc as unknown as Ctx);
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.globalCompositeOperation = 'source-atop';
    const g = sc.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    sc.fillStyle = g;
    sc.fillRect(0, 0, w, h);
    sc.globalCompositeOperation = 'source-over';
    const a0 = c.globalAlpha, a = o.alpha ?? 1;
    for (const gh of o.ghosts ?? []) {
      if (gh.a <= 0.003) continue;
      c.globalAlpha = a0 * a * gh.a;
      c.drawImage(this.cv, 0, 0, w, h, bx + gh.dx, by + gh.dy, w, h);
    }
    c.globalAlpha = a0 * a;
    c.drawImage(this.cv, 0, 0, w, h, bx, by, w, h);
    c.globalAlpha = a0;
    this.last = [bx, by, w, h];
  }

  private last: [number, number, number, number] | null = null;

  /**
   * 把上一次 draw() 染好的紙偶再貼一次（同一個位置，照 c 目前的變換與 alpha）：倒影、影子剪影不用重畫一次紙偶。
   * 同一格裡要先 draw() 才能 again()。
   */
  again(c: Ctx): void {
    const L = this.last;
    if (!L) return;
    c.drawImage(this.cv, 0, 0, L[2], L[3], L[0], L[1], L[2], L[3]);
  }
}

/** 一個字：在行內的 x（字的左緣）、寬、屬於第幾個 Word、在那個 Word 裡的第幾個字／共幾個字。 */
export interface LyricChar { ch: string; x: number; w: number; wi: number; j: number; n: number }
export interface CharLayout { size: number; width: number; chars: LyricChar[] }

const charCache = new Map<string, CharLayout>();

/**
 * 把一行歌詞拆成一個一個字排好（一排，縮到 maxWidth 放得下，不小於 minSize）。同一行同樣式快取。
 * 空白也佔位置（英文的字距），但畫的時候跳過。
 */
export function layoutChars(c: Ctx, line: Line, family: string, size: number, maxWidth: number, minSize = 40, tracking = 0): CharLayout {
  const key = `${line.i}|${line.text}|${family}|${size}|${maxWidth}|${minSize}|${tracking}`;
  const hit = charCache.get(key);
  if (hit) return hit;
  const chars = Array.from(line.text);
  const measure = (s: number) => {
    c.font = font(family, s);
    return chars.map((ch) => c.measureText(ch).width + tracking);
  };
  let ws = measure(size);
  let sum = ws.reduce((a, b) => a + b, 0);
  if (sum > maxWidth) {
    size = Math.max(minSize, Math.floor((size * maxWidth) / sum));
    ws = measure(size);
    sum = ws.reduce((a, b) => a + b, 0);
  }
  // 每個字屬於哪個 Word（跟唱進度用）：Word.o 是 UTF-16 位置
  const out: LyricChar[] = [];
  let wi = 0, u16 = 0, x = 0;
  for (let i = 0; i < chars.length; i++) {
    while (wi + 1 < line.words.length && line.words[wi + 1]!.o <= u16) wi++;
    out.push({ ch: chars[i]!, x, w: ws[i]!, wi, j: 0, n: 1 });
    x += ws[i]!;
    u16 += chars[i]!.length;
  }
  // 每個 Word 裡第幾個字（不算空白）：唱到一半的 Word 一個字一個字亮
  const count = new Map<number, number>();
  for (const ch of out) { if (ch.ch.trim()) { ch.j = count.get(ch.wi) ?? 0; count.set(ch.wi, ch.j + 1); } }
  for (const ch of out) ch.n = Math.max(1, count.get(ch.wi) ?? 1);
  const lay = { size, width: sum, chars: out };
  if (charCache.size > 300) charCache.clear();
  charCache.set(key, lay);
  return lay;
}

/** 這個字唱到哪：0 還沒、(0,1) 正在唱、1 唱完。 */
export function charProgress(line: Line, ch: LyricChar, t: number): number {
  const w = line.words[ch.wi];
  if (!w) return 1;
  const p = Lyrics.wordProgress(w, t);
  return clamp(p * ch.n - ch.j, 0, 1);
}

export interface CharStyle { unsung: string; sung: string; active: string; alpha?: number }

/**
 * 畫一排字：(x, y) 是第一個字的左緣、基線。each(i, 字的中心 x) 回傳這個字的位移、旋轉、縮放（沒有就原地）。
 * 回傳正在唱的字的中心（給火花用）。
 */
export function drawChars(c: Ctx, line: Line, lay: CharLayout, family: string, x: number, y: number, t: number, st: CharStyle,
  each?: (i: number, cx: number) => { dx?: number; dy?: number; rot?: number; s?: number; a?: number } | null): { x: number; y: number } | null {
  c.save();
  c.font = font(family, lay.size);
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  let head: { x: number; y: number } | null = null;
  const a0 = (st.alpha ?? 1) * c.globalAlpha;
  lay.chars.forEach((ch, i) => {
    if (!ch.ch.trim()) return;
    const cx = x + ch.x + ch.w / 2;
    const m = each?.(i, cx) ?? null;
    const p = charProgress(line, ch, t);
    const px = cx + (m?.dx ?? 0), py = y + (m?.dy ?? 0);
    c.globalAlpha = a0 * (m?.a ?? 1);
    c.fillStyle = p <= 0 ? st.unsung : p < 1 ? st.active : st.sung;
    if (m && (m.rot || (m.s && m.s !== 1))) {
      c.save();
      c.translate(px, py - lay.size * 0.35);
      if (m.rot) c.rotate(m.rot);
      if (m.s && m.s !== 1) c.scale(m.s, m.s);
      c.fillText(ch.ch, 0, lay.size * 0.35);
      c.restore();
    } else c.fillText(ch.ch, px, py);
    if (p > 0 && p < 1) head = { x: px, y: py - lay.size * 0.35 };
  });
  c.restore();
  return head;
}

/** 常用：沒有留言時木牌／卡片上的邀請。 */
export const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';

/** 暗版面紙偶的打光色（上面被燈照到、腳底暗）：rgba 字串。 */
export const shade = (a: number) => rgba('ink', a);
