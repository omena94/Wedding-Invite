// 批次 B2（書與紙的雙語版面：雙語字典、單字卡、會話手冊、歌詞本、情書與譯本、對聯）共用的小工具。
// 這批都是「印在紙上／寫在紙上」的歌詞：中文（翻譯）是主行，原文（line.sub）在同一張紙上的另一個位置，
// 兩行各照自己的逐字時間亮（規則見 TREATMENT.md「雙語版面」、ENGINE.md「原文副行」）。
import { Lyrics, lyricSubOf, type Line } from '../engine/lyrics';
import { rgba, mixRgba, LIN } from '../engine/palette';
import { clamp } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import type { Msg } from '../engine/scene';
import { SCALE, scaleContext2D } from '../engine/gl';
import { V2, msgMaxFor, fitClauses } from './_v2';
import { signature, COUPLE_ZH, type LyricLayout } from './_motifs';

export type Rect = [number, number, number, number];

/** 這批會畫到的符號與小字：init 時跟著 loadText 預載（第一次畫才不會先用備援字型，確定性會不過）。 */
export const B2_SYMBOLS = '…♪—–·•※＊：；／、。，「」『』（）〔〕【】①②③④⑤⑥⑦⑧⑨→←↑↓✓✔×0123456789No.FROMTHECOUPLE新人例名詞動副';

/** 窗格會唱到的每一行（前後多抓一點，進場前、退場後的那一句也排好）。 */
export const windowLines = (lyrics: Lyrics, s: number, e: number): Line[] => lyrics.linesIn(s - 2, e + 1);

/** 這些行（連同原文）的全部文字：loadText 用（韓文要先載字，不然第一格是方框或備援字）。 */
export const linesText = (ls: Line[]) => ls.map((l) => l.text + (lyricSubOf(l)?.text ?? '')).join('');

/** 這個窗格有沒有原文副行（有翻譯的歌）。整格固定一種排法，換句時版面不跳。 */
export const anySub = (ls: Line[]) => ls.some((l) => !!lyricSubOf(l));

/**
 * 一行歌詞每個字元（UTF-16 位置）的跟唱進度：0 還沒唱、(0,1) 正在唱、1 唱完。英文一個單字是一個 Word，
 * 單字裡的字母依序亮（跟 drawLyric 擦亮的速度一樣）；字與字之間的空白跟著前一個字。
 * 自己一個字一個字排歌詞的版面（直排的對聯）用。
 */
export function charProgress(line: Line, t: number): number[] {
  const out = new Array<number>(line.text.length).fill(0);
  let prev = 0, wi = 0;
  for (let u = 0; u < line.text.length; u++) {
    while (wi < line.words.length && line.words[wi]!.o + line.words[wi]!.w.length <= u) wi++;
    const w = line.words[wi];
    if (w && u >= w.o && u < w.o + w.w.length) prev = clamp(Lyrics.wordProgress(w, t) * w.w.length - (u - w.o));
    out[u] = prev;
  }
  return out;
}

/** 署名：新人的留言署「—— 宣文 & 孟庭」，其他「—— 名字」（沒填名字是「一位賓客」）。 */
export const sigOf = (m: Msg) => (m.couple ? `—— ${COUPLE_ZH}` : signature(m.name));

/** 留言編號：No.042。 */
export const no3 = (n: number) => `No.${String(n).padStart(3, '0')}`;

/** 沒有主打留言時的邀請（小字）。 */
export const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';

/**
 * 照「留言尺寸標準 v2」排留言：字級上限依字數（msgMaxFor）、下限 40；先照子句斷行（fitClauses），放不下才交給 fitText。
 * `h` 要先扣掉署名的高度，署名才永遠在最後一行下面。
 */
export function fitMsgB2(c: CanvasRenderingContext2D, text: string, family: string, w: number, h: number,
  o: { lineHeight: number; maxLines?: number; max?: number; min?: number }): FitResult {
  const max = Math.min(o.max ?? 99, msgMaxFor(text));
  // min 只給「沒有留言時的邀請／冷面句子」用（歌詞是焦點，這句要比留言小）
  const q = { min: Math.min(o.min ?? V2.msgMin, max), max, lineHeight: o.lineHeight, maxLines: o.maxLines ?? 5 };
  return fitClauses(c, text, family, w, h, q) ?? fitText(c, text, family, w, h, q);
}

/** 色票的相對亮度（linear）。 */
const lumOf = (k: keyof typeof LIN) => { const c = LIN[k]; return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };

/**
 * 紙上「正在唱」的訊號色：淺的訊號色（香檳、鼠尾草）在紙上讀不清楚，往暗部（blood）靠；
 * 靠多少看這首歌的訊號色有多亮（珊瑚、玫瑰本來就夠深，只混一點）。紅筆、螢光筆的筆跡也用這個。
 */
export const inkSignal = (a = 1) => mixRgba('signal', 'blood', clamp(0.4 + (lumOf('signal') - 0.35) * 1.4, 0.4, 0.85), a);

/** 紙上的跟唱樣式顏色：還沒唱三成、正在唱偏深的訊號色、唱完墨色。 */
export const PAPER_SING = () => ({ active: inkSignal(), sung: rgba('sepia', 0.94), unsung: rgba('sepia', 0.3) });

/** 只留主行（原文另外畫在別的位置／別的字族時用）：drawLyric 看到 sub 會自動畫在正下方。 */
export const mainOnly = (lay: LyricLayout): LyricLayout => (lay.sub ? { ...lay, sub: undefined } : lay);

/** 一行歌詞排好之後，主行最後一排的基線（相對第一排基線）。 */
export const lastRowY = (lay: LyricLayout) => lay.rows[lay.rows.length - 1]?.y ?? 0;

/** 窗格的慢推鏡（in-out）：整個窗格推近 amt。 */
export const slowPush = (p: number, amt = 0.03) => 1 + amt * (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

/**
 * 一張畫一次就好的小畫布（卡片的正反面、翻頁用的紙）：跟 Layer2D 一樣用邏輯像素畫、背後是 SCALE 倍的像素，
 * 之後每格 drawImage 縮放貼上（翻面、旋轉時不用每格重新排字）。不上傳成貼圖，所以不用 dispose。
 */
export function offCanvas(w: number, h: number, scale = SCALE): { cv: HTMLCanvasElement; c: CanvasRenderingContext2D } {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w * scale)); cv.height = Math.max(1, Math.round(h * scale));
  const c = scaleContext2D(cv.getContext('2d')!, scale);
  return { cv, c };
}

/**
 * 一行歌詞（中文＋原文）整塊的外框 [x, y, w, h]（畫面座標）：(x, y) 是主行第一排基線的對齊點；
 * sub 是原文的排版與它第一排基線離主行第一排基線多遠。上緣算到字頂、下緣算到最後一排的字底（含底線的位置）。
 */
export function lyricBlock(x: number, y: number, lay: LyricLayout, sub?: { lay: LyricLayout; dy: number } | null): Rect {
  const rows = [...lay.rows.map((r) => ({ x0: r.x, x1: r.x + r.width, base: r.y, size: lay.size })),
    ...(sub ? sub.lay.rows.map((r) => ({ x0: r.x, x1: r.x + r.width, base: sub.dy + r.y, size: sub.lay.size })) : [])];
  if (!rows.length) return [x, y - lay.size, 0, lay.size];
  const x0 = Math.min(...rows.map((r) => r.x0)), x1 = Math.max(...rows.map((r) => r.x1));
  const top = Math.min(...rows.map((r) => r.base - r.size * 0.85)), bot = Math.max(...rows.map((r) => r.base + r.size * 0.28));
  return [x + x0, y + top, x1 - x0, bot - top];
}

/**
 * 筆放在哪（2026-09-30 主導者：筆在任何時候都不能蓋到任何一行歌詞）。dictionary 的紅筆、phrasebook 的螢光筆共用這一條：
 * 筆尖貼著「這一句歌詞整塊」（lyricBlock：中文＋原文）的上緣或下緣，x 跟著正在寫／劃的字；筆身從那裡往字塊外面伸——
 * 貼下緣的往右下（PEN_DOWN）、貼上緣的往右上（PEN_UP）。整支筆永遠在字塊外面，字上只留畫好的線或螢光。
 * 筆的圖形沿著 +x 畫（筆尖在原點），用回傳的 ang 旋轉。
 */
export const PEN_DOWN = 0.62, PEN_UP = -0.95;
export function penOnEdge(x: number, block: Rect, edge: 'top' | 'bottom', gap = 10): { x: number; y: number; ang: number } {
  return {
    x: clamp(x, block[0], block[0] + block[2]),
    y: edge === 'top' ? block[1] - gap : block[1] + block[3] + gap,
    ang: edge === 'top' ? PEN_UP : PEN_DOWN,
  };
}

/** [x, y, w, h] 的聯集外框（popupAvoid 用）。 */
export function unionRect(rs: Rect[]): Rect {
  const x0 = Math.min(...rs.map((r) => r[0])), y0 = Math.min(...rs.map((r) => r[1]));
  const x1 = Math.max(...rs.map((r) => r[0] + r[2])), y1 = Math.max(...rs.map((r) => r[1] + r[3]));
  return [x0, y0, x1 - x0, y1 - y0];
}
