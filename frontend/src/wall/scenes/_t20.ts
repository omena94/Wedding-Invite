// 批次 T20（水與天空：海浪版畫、水窪漣漪、帆船、鵲橋、極光、肥皂泡）共用的小工具。
// 這批的歌詞與留言多半不是平平地畫一整行（刻在浪上、被漣漪扭曲、寫在旗子上、一字一字落下），
// 所以要「一個字一個字」知道它的跟唱狀態；時間與顏色規則跟 _motifs.ts 的 drawLyric 一樣：
// 字在 word.start 亮起、正在唱是訊號色、唱完是紙白（亮版面是墨色）、還沒唱三成透明。
import { Lyrics, type Line } from '../engine/lyrics';
import { rgba, mixRgba, LIN } from '../engine/palette';
import { clamp } from '../engine/util';
import { font, layout, measure } from '../engine/type';
import { fitText, type FitResult } from '../engine/text';

export type Rect = [number, number, number, number];

/** 一行歌詞裡一個字（code point）的跟唱進度：0 還沒唱、(0,1) 正在唱、1 唱完。 */
export interface GlyphP { ch: string; i: number; p: number; word: number }

/**
 * 一行歌詞每個字的跟唱進度。英文一個單字是一個 Word：單字裡的字母依序亮（跟 drawLyric 擦亮的速度一樣），
 * 中文一個字就是一個 Word。字與字之間的空白跟著前一個字。
 */
export function glyphProgress(line: Line, t: number): GlyphP[] {
  const out: GlyphP[] = [];
  let u = 0, i = 0, wi = 0, prev = 0;
  for (const ch of line.text) {
    while (wi < line.words.length && line.words[wi]!.o + line.words[wi]!.w.length <= u) wi++;
    const w = line.words[wi];
    let p = prev, word = -1;
    if (w && u >= w.o && u < w.o + w.w.length) {
      p = clamp(Lyrics.wordProgress(w, t) * w.w.length - (u - w.o));
      word = wi;
    }
    out.push({ ch, i, p, word });
    prev = p;
    u += ch.length;
    i++;
  }
  return out;
}

/** 每個字開始唱的時間（空白跟著前一個字）：逐字出現的版面用來排「字什麼時候落下／浮出」。 */
export function glyphStarts(line: Line): number[] {
  const out: number[] = [];
  let u = 0, wi = 0, prev = line.start;
  for (const ch of line.text) {
    while (wi < line.words.length && line.words[wi]!.o + line.words[wi]!.w.length <= u) wi++;
    const w = line.words[wi];
    if (w && u >= w.o && u < w.o + w.w.length) prev = w.start + ((w.end - w.start) * (u - w.o)) / Math.max(1, w.w.length);
    out.push(prev);
    u += ch.length;
  }
  return out;
}

/** 色票的相對亮度（linear）：判斷訊號色跟紙色是不是太接近。 */
export const lumOf = (k: keyof typeof LIN) => { const c = LIN[k]; return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };

/**
 * 亮版面上「正在唱」的訊號色：淺的訊號色（香檳、鼠尾草）在紙上讀不清楚，往暗部（blood）靠；
 * 靠多少看這首歌的訊號色有多亮（珊瑚、玫瑰本來就夠深，只混一點）。
 */
export const paperSignal = (a = 1) => mixRgba('signal', 'blood', clamp(0.4 + (lumOf('signal') - 0.35) * 1.4, 0.4, 0.85), a);

/** 跟唱的顏色：暗版面紙白／訊號色，亮版面墨色／偏深的訊號色。 */
export function singColor(p: number, paper = false, alpha = 1): string {
  if (p <= 0) return rgba(paper ? 'sepia' : 'bone', 0.3 * alpha);
  if (p < 1) return paper ? paperSignal(alpha) : rgba('signal', alpha);
  return rgba(paper ? 'sepia' : 'bone', (paper ? 0.94 : 0.96) * alpha);
}

/**
 * 畫一行跟唱的歌詞（一個字一個字畫，才能讓每個字有自己的位移／縮放），左端基線在 (x, y)。
 * `lift(i, p)` 回傳這個字的額外位移（例如唱到時跳一下），可省略。回傳正在唱的字的位置。
 */
export function drawSungLine(c: CanvasRenderingContext2D, line: Line, t: number, family: string, size: number, x: number, y: number,
  o: { paper?: boolean; alpha?: number; tracking?: number; lift?: (i: number, p: number) => [number, number] } = {}): { x: number; y: number } | null {
  const lay = layout(line.text, family, size, o.tracking ?? 0);
  const gp = glyphProgress(line, t);
  c.save();
  c.font = font(family, size);
  c.textBaseline = 'alphabetic';
  let head: { x: number; y: number } | null = null;
  lay.glyphs.forEach((g, k) => {
    const s = gp[k]!;
    if (g.ch === ' ') return;
    const [dx, dy] = o.lift ? o.lift(k, s.p) : [0, 0];
    c.fillStyle = singColor(s.p, o.paper, o.alpha ?? 1);
    c.fillText(g.ch, x + g.x + dx, y + dy);
    if (s.p > 0 && s.p < 1) head = { x: x + g.x + g.w * 0.5 + dx, y: y - size * 0.35 + dy };
  });
  c.restore();
  return head;
}

/** 一行歌詞的寬度（drawSungLine 的排法）。 */
export const lineWidth = (text: string, family: string, size: number, tracking = 0) => layout(text, family, size, tracking).width;

/** 找一個字級讓 text 在 maxW 裡放得下（最大 max、最小 min）。 */
export function fitLine(text: string, family: string, maxW: number, max: number, min: number, tracking = 0) {
  const w = lineWidth(text, family, 100, tracking * 100 / max);
  return clamp(Math.floor((100 * maxW) / Math.max(1, w)), min, max);
}

/** 留言編號：No.042。 */
export const no3 = (n: number) => `No.${String(n).padStart(3, '0')}`;

/** 沒有主打留言時的邀請（小字）。 */
export const INVITE_SMALL = '掃描右下角 QR code，把祝福寫上大螢幕';

/** [x, y, w, h] 的聯集外框（popupAvoid 用）。 */
export function unionRect(rs: Rect[]): Rect {
  const x0 = Math.min(...rs.map((r) => r[0])), y0 = Math.min(...rs.map((r) => r[1]));
  const x1 = Math.max(...rs.map((r) => r[0] + r[2])), y1 = Math.max(...rs.map((r) => r[1] + r[3]));
  return [x0, y0, x1 - x0, y1 - y0];
}


/** GLSL：取樣 fast 的 Layer2D（預乘、sRGB 編碼）→ 線性、預乘。自己的 shader 要讀 Canvas2D 的字時用。 */
export const DECODE_GLSL = /* glsl */ `
vec4 decodeLayer(sampler2D tex, vec2 uv) {
  vec4 c = texture(tex, uv);
  c.rgb = c.a > 0.0 ? toLinear(c.rgb / c.a) * c.a : vec3(0.0);
  return c;
}`;

/**
 * 排留言：短的留言（一行放得下、字級夠大）就一行，不要為了把字放到最大硬折成兩行（「新婚 / 快樂！！！」）；
 * `lines` 給了就照它斷行（自己寫的句子，自動斷行會拆在奇怪的地方），其他交給 fitText。
 */
export function fitMsg(c: CanvasRenderingContext2D, text: string, family: string, w: number, h: number,
  o: { min: number; max: number; lineHeight: number; maxLines?: number; oneLine?: number; lines?: string[] }): FitResult {
  const lines = o.lines ?? null;
  if (lines) {
    const widest = Math.max(...lines.map((l) => measure(l, family, 100)));
    const size = Math.floor(clamp(Math.min((100 * w) / widest, h / (1 + (lines.length - 1) * o.lineHeight)), o.min, o.max));
    return { size, lines, lineHeight: size * o.lineHeight, width: Math.max(...lines.map((l) => measure(l, family, size))), height: size * (1 + (lines.length - 1) * o.lineHeight) };
  }
  const one = Math.floor(Math.min(o.max, (100 * w) / Math.max(1, measure(text, family, 100)), h));
  if (one >= (o.oneLine ?? 64)) return { size: one, lines: [text], lineHeight: one * o.lineHeight, width: measure(text, family, one), height: one };
  return fitText(c, text, family, w, h, o);
}

/**
 * 歌詞字級（MV 融合原則：一格只有一個焦點）：有主打留言時歌詞比留言小一號（但 ≥ 48 px），
 * 沒有主打留言時歌詞就是焦點，放大一點。
 */
export function lyricSize(msgSize: number | null, base = 60): number {
  return msgSize ? clamp(Math.round(msgSize * 0.8), 48, base) : Math.round(base * 1.22);
}

/** 窗格的慢推鏡（整個窗格推近 3%，in-out）：讓平面的版面有一點電影鏡頭的空氣感。 */
export const slowPush = (p: number, amt = 0.03) => 1 + amt * (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
