// LRC 歌詞：解析與輸出。
// 支援：`[mm:ss.xx]` 一行一個（或多個）時間標記、`[offset:±毫秒]`、`[ar:]` 等資訊標籤、
// 加強版逐字時間 `<mm:ss.xx>字`（後台「逐字對時」存的就是這種）、沒有時間的純文字（還沒對時）。
// 空白的時間行（`[01:23.45]` 後面沒字）代表「這裡開始沒在唱」，用來結束上一行。

export interface LrcWord { t: number; w: string }
export interface LrcLine {
  /** 秒；還沒對時的行是 NaN。 */
  t: number;
  text: string;
  /** 逐字時間（加強版 LRC 才有）。 */
  words?: LrcWord[];
}
export interface LrcDoc { lines: LrcLine[]; meta: Record<string, string>; offset: number }

const TS = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
const WORD_TS = /<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>/g;
const META = /^\[([a-zA-Z#]+):(.*)\]\s*$/;

const toSec = (m: string, s: string) => Number(m) * 60 + Number(s.replace(':', '.'));

/** 秒 → `mm:ss.xx`。 */
export function fmtTime(t: number): string {
  const cs = Math.max(0, Math.round(t * 100));
  const m = Math.floor(cs / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

export function parseLrc(src: string): LrcDoc {
  const meta: Record<string, string> = {};
  const lines: LrcLine[] = [];
  for (const raw of (src || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const mm = META.exec(line);
    if (mm && !/^\d/.test(mm[1]!)) { meta[mm[1]!.toLowerCase()] = mm[2]!.trim(); continue; }
    const stamps: number[] = [];
    let rest = line.replace(TS, (_, m: string, s: string) => { stamps.push(toSec(m, s)); return ''; });
    // 逐字時間：<時間>字<時間>字…；最後常有一個後面沒字的 <時間>，代表最後一個字唱完的時間（留著給 build 用）
    let words: LrcWord[] | undefined;
    const lt = rest.indexOf('<');
    if (lt >= 0 && /<\d{1,3}:\d/.test(rest)) {
      words = [];
      const re = /<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>([^<]*)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(rest))) words.push({ t: toSec(m[1]!, m[2]!), w: m[3]! });
      const pre = rest.slice(0, lt);
      if (pre.trim() && stamps.length) words.unshift({ t: stamps[0]!, w: pre });
      rest = rest.replace(WORD_TS, '');
    }
    const text = rest.replace(/\s+/g, ' ').trim();
    if (!stamps.length) { lines.push({ t: NaN, text }); continue; }
    for (const t of stamps) lines.push({ t, text, ...(words && stamps.length === 1 ? { words } : {}) });
  }
  const offset = Number(meta.offset ?? 0) / 1000 || 0;
  // LRC 的 offset：正數代表歌詞要提早出現
  const synced = lines.filter((l) => !Number.isNaN(l.t)).map((l) => ({ ...l, t: l.t - offset, words: l.words?.map((w) => ({ ...w, t: w.t - offset })) }));
  const unsynced = lines.filter((l) => Number.isNaN(l.t));
  synced.sort((a, b) => a.t - b.t);
  return { lines: synced.length ? synced : unsynced, meta, offset };
}

/** 這份歌詞有沒有時間（沒有的話要先對時）。 */
export const isSynced = (doc: LrcDoc) => doc.lines.some((l) => !Number.isNaN(l.t));

/** 輸出 LRC。有逐字時間的行寫成加強版。 */
export function toLrc(lines: LrcLine[], meta: Record<string, string> = {}): string {
  const head = Object.entries(meta).filter(([k]) => k !== 'offset').map(([k, v]) => `[${k}:${v}]`);
  const body = lines.map((l) => {
    const ts = Number.isNaN(l.t) ? '' : `[${fmtTime(l.t)}]`;
    if (l.words?.length) return ts + l.words.map((w) => `<${fmtTime(w.t)}>${w.w}`).join('');
    return ts + l.text;
  });
  return [...head, ...body].join('\n');
}

/**
 * 原文的每一行各是哪幾句：[{ row（第幾行，從 0 算）, t, text }]，t 跟 parseLrc 一樣已經扣掉 [offset:]。
 * 後台點歌詞清單的一句時，用來找出它在 LRC 原文的哪一行（parseLrc 會排序、略過資訊標籤，行號對不上原文）。
 */
export function sourceRows(src: string): { row: number; t: number; text: string }[] {
  const off = parseLrc(src).offset;
  const out: { row: number; t: number; text: string }[] = [];
  (src || '').replace(/\r/g, '').split('\n').forEach((raw, row) => {
    for (const l of parseLrc(raw).lines) if (!Number.isNaN(l.t)) out.push({ row, t: l.t - off, text: l.text });
  });
  return out;
}

/** 整份歌詞平移 dt 秒（後台「整首提早／延後」用）。 */
export function shiftLrc(src: string, dt: number): string {
  const doc = parseLrc(src);
  return toLrc(doc.lines.map((l) => ({ ...l, t: l.t + dt, words: l.words?.map((w) => ({ ...w, t: w.t + dt })) })), doc.meta);
}
