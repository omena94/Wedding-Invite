// 「留言尺寸與版面比例標準 v2」（docs/wall/TREATMENT.md；留言板做太大會很突兀，搶走整個畫面）的數字，
// 照新標準改過的版面共用，之後套到其他版面也用這一份，全片的字級才會一致。
// 字級一律是「螢幕上的 px」：有鏡頭縮放或 3D 的版面，要除以物件在畫面上的縮放倍數，才是畫在畫布／貼圖上的字級。
import { clamp } from '../engine/util';
import { font } from '../engine/type';
import { wrap, type FitResult } from '../engine/text';

export const V2 = {
  /** 留言：40～60（60 字長留言約 40～44、短句最多 60）；只有一兩個字或只有愛心可以到 72。 */
  msgMin: 40, msgMax: 60, msgTiny: 72,
  /** 署名：26～32，永遠在留言最後一行下面。 */
  sigMin: 26, sigMax: 32,
  /** 歌詞：40～52，不比留言大。 */
  lyrMin: 40, lyrMax: 52,
  /** 留言區（含容器）：寬 ≤ 860、高 ≤ 430、面積 ≤ 畫面 18%。 */
  boxW: 860, boxH: 430, boxArea: 0.18 * 1920 * 1080,
} as const;

/** 留言的字數（不算空白；♥ 算一個字）。 */
export const msgLen = (text: string) => Array.from(text.replace(/\s/g, '')).length;

/**
 * 留言字級的上限（螢幕 px），依字數：只有愛心或一兩個字 72、短句（≤ 10 字）60、一般（≤ 24）56、（≤ 40）50、長留言 44。
 * 版面再用 fitText 之類在框裡往下找（下限 V2.msgMin）。
 */
export function msgMaxFor(text: string): number {
  const n = msgLen(text);
  if (n <= 2 || /^[♥\s]+$/u.test(text)) return V2.msgTiny;
  if (n <= 10) return V2.msgMax;
  if (n <= 24) return 56;
  if (n <= 40) return 50;
  return 44;
}

/**
 * 歌詞字級（螢幕 px）：有留言時比留言小一點（小 4 px，40～52：歌詞多半是比較粗的黑體，一樣大看起來會比手寫的留言搶眼）；
 * 沒有留言時 52（歌詞是焦點，但一樣不超過標準）。
 */
export const lyricV2 = (msgSize: number | null) => (msgSize === null ? V2.lyrMax : clamp(Math.min(V2.lyrMax, msgSize - 4), V2.lyrMin, V2.lyrMax));

/** 署名字級（螢幕 px）：留言字級的六成，夾在 26～32。 */
export const sigV2 = (msgSize: number) => clamp(Math.round(msgSize * 0.6), V2.sigMin, V2.sigMax);

/**
 * 照子句排留言（標點與 ♥ 當子句的邊界）：放得下就整句一行，太長的子句才在句子裡面斷。
 * 從 max 往下每 1 px 找第一個放得下的字級；都放不下回傳 null（交給 fitText）。
 * 留言區變窄之後，fitText 只照寬度斷行，常斷出「…這一天，要／一直…」這種把下一句的頭留在行尾的斷法。
 */
export function fitClauses(c: CanvasRenderingContext2D, text: string, family: string, w: number, h: number, o: { min: number; max: number; lineHeight: number; maxLines: number }): FitResult | null {
  const P = '，。！？、,.!?~～…；;：:♥';
  const clauses = text.match(new RegExp(`[^${P}]+[${P}\\s]*|[${P}\\s]+`, 'gu')) ?? [text];
  for (let size = Math.floor(o.max); size >= o.min; size -= 1) {
    c.font = font(family, size);
    const fitsW = (x: string) => c.measureText(x.trim()).width <= w;
    const lines: string[] = [];
    let cur = '';
    for (const cl of clauses) {
      if (fitsW(cur + cl)) { cur += cl; continue; }
      if (cur.trim()) lines.push(cur.trim());
      cur = '';
      if (fitsW(cl)) { cur = cl; continue; }
      const sub = wrap(c, cl.trim(), w);
      lines.push(...sub.slice(0, -1));
      cur = sub[sub.length - 1] ?? '';
    }
    if (cur.trim()) lines.push(cur.trim());
    const height = size * (1 + (lines.length - 1) * o.lineHeight);
    if (lines.length > o.maxLines || height > h) continue;
    return { size, lines, lineHeight: size * o.lineHeight, width: Math.max(...lines.map((l) => c.measureText(l).width)), height };
  }
  return null;
}
