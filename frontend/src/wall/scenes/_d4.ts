// 批次 D4（三隻狗的日子，雙語版面：dogcafe、dogtraining、dogbirthday、stroller、dogswim）共用的小工具。
//  - `mainOnly`：同一行歌詞拿掉原文副行，給「中文、原文分開放」的設計用（兩個對話框、兩串彩旗）：中文畫在一個地方，原文另外用 drawLyricSub 畫。
//  - `NoteSheet`：留言先畫在一張暫存畫布上（浮板、旗子、插牌、卡片），字數變了才重畫；物件會晃、會轉時整張貼上去，
//    不用每格重新光柵化斜的字（又慢、又可能每次差一點點，確定性會不過）。
//  - `writeTiming`：留言一個字一個字寫上去的時間（全批一致：1.5 秒左右寫完，每字 0.03～0.1 秒），寫完署名淡入。
import type { Line } from '../engine/lyrics';
import { layoutLyric, drawLyric, type LyricStyle, type LyricLayout } from './_motifs';
import { clamp, prog } from '../engine/util';
import { msgChars } from './_motifs';
import { drawNote, inkFor, inkLine, hatch, type Note } from './_couple';
import { rgba } from '../engine/palette';

type Ctx = CanvasRenderingContext2D;

const bare = new WeakMap<Line, Line>();
/** 這一行歌詞只留中文主行（沒有 sub）。同一行回傳同一個物件，layoutLyric 的快取才有用。 */
export function mainOnly(line: Line): Line {
  if (!line.sub) return line;
  let b = bare.get(line);
  if (!b) { b = { ...line, sub: undefined }; bare.set(line, b); }
  return b;
}

/** 留言寫到第幾個字、署名淡入到哪（沒有留言時 = 全部寫好：邀請文字直接出現）。 */
export function writeTiming(note: Note, t0: number, t: number, hasMsg: boolean): { chars: number; sigK: number } {
  if (!hasMsg) return { chars: Infinity, sigK: 1 };
  const total = msgChars(note.fit);
  const per = clamp(1.5 / Math.max(1, total), 0.03, 0.1);
  const done = t0 + total * per;
  return { chars: Math.max(0, Math.min(total + 1, Math.floor((t - t0) / per))), sigK: Math.round(prog(t, done + 0.1, done + 0.5) * 10) / 10 };
}

/**
 * 一張會動的「寫著留言的東西」：底（紙、布、浮板…）由 paintBase 畫，留言由 drawNote 畫在 (padX, padTop) 起的框裡、垂直置中。
 * 貼的時候以中心為準轉、縮放。w × h 是物件本體的大小；四周留 m 的空白給陰影、描邊。
 */
export class NoteSheet {
  cv: OffscreenCanvas;
  private key = '';
  constructor(public w: number, public h: number, public m = 24) {
    this.cv = new OffscreenCanvas(Math.ceil(w + m * 2), Math.ceil(h + m * 2));
  }

  /** 重畫（字數、署名淡入、樣子的 key 沒變就不畫）。 */
  paint(note: Note, o: { chars: number; sigK: number; padX: number; padTop: number; padBottom: number; color: string; sigColor: string; align?: 'left' | 'center'; key?: string },
    paintBase: (c: Ctx, x: number, y: number, w: number, h: number) => void): void {
    const key = `${o.chars}|${o.sigK}|${o.color}|${o.key ?? ''}`;
    if (key === this.key) return;
    this.key = key;
    const c = this.cv.getContext('2d')! as unknown as Ctx;
    c.clearRect(0, 0, this.cv.width, this.cv.height);
    const x = this.m, y = this.m;
    paintBase(c, x, y, this.w, this.h);
    const room = this.h - o.padTop - o.padBottom;
    drawNote(c, note, x + (o.align === 'center' ? (this.w - note.width) / 2 : o.padX), y + o.padTop + Math.max(0, (room - note.height) * 0.45), {
      chars: o.chars, color: o.color, sigColor: o.sigColor, sigK: o.sigK, align: o.align === 'center' ? 'center' : 'left',
    });
  }

  /** 貼到畫面：(cx, cy) 是物件中心；rot 轉、sx／sy 縮放（sx 接近 0 = 翻面中）。 */
  blit(c: Ctx, cx: number, cy: number, o: { rot?: number; sx?: number; sy?: number; alpha?: number } = {}): void {
    c.save();
    c.globalAlpha *= o.alpha ?? 1;
    c.translate(cx, cy);
    if (o.rot) c.rotate(o.rot);
    c.scale(o.sx ?? 1, o.sy ?? 1);
    c.drawImage(this.cv as unknown as CanvasImageSource, -this.w / 2 - this.m, -this.h / 2 - this.m);
    c.restore();
  }
}

/**
 * 亮版面遠處的一棵樹（公園、草地）：樹幹兩條線、樹冠是幾團疊起來的圓——先描每一團、再用紙色填掉重疊處的線，只剩外輪廓；
 * 下半部一點排線的陰影。k = 大小（1 ≈ 330 px 高），淡淡的，只是空氣。
 */
export function parkTree(c: Ctx, x: number, y: number, k: number, seed: number, alpha = 1): void {
  const ink = inkFor(true, { line: rgba('sepia', 0.45 * alpha) });
  const top = y - 330 * k;
  inkLine(c, [{ x: x - 10 * k, y }, { x: x - 6 * k, y: top + 150 * k }], { ink, w: 0.9, seed });
  inkLine(c, [{ x: x + 10 * k, y }, { x: x + 6 * k, y: top + 150 * k }], { ink, w: 0.9, seed: seed + 1 });
  const blobs: [number, number, number][] = [[0, 70, 100], [-78, 118, 72], [80, 112, 78], [-20, 150, 84], [40, 40, 70]];
  c.save();
  c.strokeStyle = rgba('sepia', 0.4 * alpha);
  c.lineWidth = 2.2;
  for (const [dx, dy, r] of blobs) { c.beginPath(); c.ellipse(x + dx * k, top + dy * k, r * k, r * 0.82 * k, 0, 0, Math.PI * 2); c.stroke(); }
  c.fillStyle = rgba('paper');
  for (const [dx, dy, r] of blobs) { c.beginPath(); c.ellipse(x + dx * k, top + dy * k, r * k - 1.4, r * 0.82 * k - 1.4, 0, 0, Math.PI * 2); c.fill(); }
  c.beginPath();
  for (const [dx, dy, r] of blobs) { c.moveTo(x + dx * k + r * k, top + dy * k); c.ellipse(x + dx * k, top + dy * k, r * k - 2, r * 0.82 * k - 2, 0, 0, Math.PI * 2); }
  c.clip();
  const crown = [{ x: x - 150 * k, y: top + 200 * k }, { x: x - 150 * k, y: top + 110 * k }, { x: x + 160 * k, y: top + 110 * k }, { x: x + 160 * k, y: top + 200 * k }];
  hatch(c, crown, { ink, angle: -0.9, gap: 9, w: 0.3, color: rgba('sepia', 0.14 * alpha), seed });
  c.restore();
}

/**
 * 原文副行的樣式（本批自己畫原文的地方共用）：字級是主行的 0.68 倍、**至少 32 px**（標準），放不下就折成兩排、不再縮；
 * 顏色照副行的規矩：唱到、唱完都用「唱完」的顏色（不用訊號色，不跟中文搶）。
 */
export function subLine(st: LyricStyle, mainSize: number, maxWidth: number): LyricStyle {
  return { ...st, size: Math.max(32, Math.round(mainSize * 0.68)), minSize: 32, maxWidth, tracking: (st.tracking ?? 0) * 0.5, active: st.sung, sung: st.sung };
}

/** 排原文副行（subLine 的樣式）。 */
export const layoutSub = (c: Ctx, sub: Line, sst: LyricStyle): LyricLayout => layoutLyric(c, sub, sst);

/** 畫原文副行（已經 translate 到第一排基線的對齊點）。 */
export function drawSub(c: Ctx, sub: Line, t: number, sst: LyricStyle, lay: LyricLayout, alpha: number): void {
  drawLyric(c, sub, t, sst, lay, alpha);
}

/** 常用：沒有留言時的邀請。 */
export const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
