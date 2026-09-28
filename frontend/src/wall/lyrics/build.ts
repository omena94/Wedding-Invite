// LRC → 逐字時間（pdoom 的 Lyrics 格式）。
//
// pdoom 用強制對齊（Demucs 分出人聲 + CTC + Whisper）拿到每個字的時間；婚禮歌單要能自己加歌，
// 所以改成：LRC 給每一行的開始時間（LRCLIB 抓來的，或新人自己按空白鍵對的），行內的字用「唱的速度」推估：
//  - 單位：中文、日文一個字；韓文一個音節；英文一個字（依母音組估音節數當權重）
//  - 一行大約用八分音符的速度唱（一拍兩個音節），跟下一行靠很近就一路唱到下一行前；
//  - 每個字的開始吸到最近的十六分音符格（流行歌的旋律幾乎都在拍子格上），看起來才會「跟著唱」。
// 有加強版逐字時間（<mm:ss.xx>）的行就直接用，不推估。
import type { AudioData } from '../engine/audio';
import { Lyrics, type LyricsJSON } from '../engine/lyrics';
import { parseLrc, type LrcLine } from './lrc';

interface Unit { w: string; syl: number }

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HANGUL = /\p{Script=Hangul}/u;
const LETTER = /[\p{L}\p{N}]/u;

/** 英文字的音節數（母音組數，結尾不發音的 e 不算），至少 1。 */
function englishSyllables(w: string): number {
  const s = w.toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return 1;
  let n = (s.match(/[aeiouy]+/g) ?? []).length;
  if (s.length > 2 && s.endsWith('e') && !/[aeiouy]le$/.test(s) && n > 1) n--;
  return Math.max(1, n);
}

/** 把一行歌詞切成「會被唱出來的單位」；標點黏在前一個單位後面。 */
export function lyricUnits(text: string): Unit[] {
  const out: Unit[] = [];
  const chars = Array.from(text);
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i]!;
    if (ch === ' ') { i++; continue; }
    if (CJK.test(ch) || HANGUL.test(ch)) { out.push({ w: ch, syl: 1 }); i++; }
    else if (LETTER.test(ch) || ch === "'" || ch === '’') {
      let w = '';
      while (i < chars.length && (LETTER.test(chars[i]!) || /['’\-]/.test(chars[i]!)) && !CJK.test(chars[i]!) && !HANGUL.test(chars[i]!)) w += chars[i++];
      out.push({ w, syl: englishSyllables(w) });
    } else {
      // 標點：黏到前一個單位（沒有前一個就自成一個不佔時間的單位）
      if (out.length) out[out.length - 1]!.w += ch; else out.push({ w: ch, syl: 0 });
      i++;
    }
  }
  return out;
}

/** 把時間吸到最近的十六分音符格（差不到三成格寬才吸）。 */
function snap16(au: AudioData, t: number): number {
  const q = Math.round(au.beatAt(t) * 4) / 4;
  const g = au.timeOfBeat(q);
  const sixteenth = au.beatPeriod(t) / 4;
  return Math.abs(g - t) < sixteenth * 0.35 ? g : t;
}

/**
 * 解析 LRC、推估逐字時間，回傳 Lyrics。`offset`：整首平移（秒，正數＝延後），後台的「整首提早／延後」。
 * 沒有時間的歌詞（還沒對時）回傳空的 Lyrics：大螢幕不顯示沒對好的歌詞，比顯示錯的好。
 */
export function buildLyrics(src: string, au: AudioData, offset = 0): Lyrics {
  const doc = parseLrc(src);
  const lines = doc.lines.filter((l) => !Number.isNaN(l.t)).map((l) => ({ ...l, t: l.t + offset, words: l.words?.map((w) => ({ ...w, t: w.t + offset })) }));
  if (!lines.length) return Lyrics.empty();
  const out: LyricsJSON['lines'] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const text = l.words?.length ? l.words.map((w) => w.w).join('').replace(/\s+/g, ' ').trim() : l.text;
    if (!text || !LETTER.test(text)) continue;
    const next = lines.slice(i + 1).find((x) => x.t > l.t + 0.05)?.t ?? au.duration;
    const words = l.words?.some((w) => w.w.trim()) ? fromTags(l, next) : estimate(text, l.t, next, au);
    if (!words.length) continue;
    out.push({ text, start: words[0]!.start, end: words[words.length - 1]!.end, words });
  }
  return new Lyrics({ lines: out });
}

/** 加強版 LRC：逐字時間照給的用；最後一個字唱到結尾標記（沒有的話唱一拍、不超過下一行）。 */
function fromTags(l: LrcLine, next: number) {
  const tags = l.words!;
  const res: { w: string; start: number; end: number }[] = [];
  for (let k = 0; k < tags.length; k++) {
    const w = tags[k]!.w.trim();
    if (!w) continue;
    const end = tags[k + 1]?.t ?? Math.min(next - 0.05, tags[k]!.t + 0.6);
    res.push({ w, start: tags[k]!.t, end: Math.max(tags[k]!.t + 0.05, end) });
  }
  return res;
}

/** 推估一行裡每個字的時間。 */
function estimate(text: string, start: number, next: number, au: AudioData) {
  const units = lyricUnits(text).filter((u) => u.w.trim());
  const total = units.reduce((s, u) => s + u.syl, 0) || 1;
  const beat = au.beatPeriod(start);
  // 大約八分音符一個音節（很快的歌不要快過 0.16 秒、很慢的不要慢過 0.42 秒）
  const syl = Math.min(0.42, Math.max(0.16, beat / 2));
  const gap = Math.max(0.3, next - start);
  let sing = Math.max(0.6, total * syl * 1.1);
  // 跟下一行靠得很近：一路唱到下一行前（最後一個字通常會拉長音）
  if (gap < sing * 1.6) sing = gap - Math.min(0.25, gap * 0.1);
  sing = Math.min(sing, gap - 0.05);
  const res: { w: string; start: number; end: number }[] = [];
  let acc = 0;
  for (const u of units) {
    let t0 = start + (sing * acc) / total;
    if (acc > 0) t0 = snap16(au, t0);
    acc += u.syl;
    const prev = res[res.length - 1];
    if (prev) { t0 = Math.max(t0, prev.start + 0.04); prev.end = t0; }
    res.push({ w: u.w, start: t0, end: start + sing });
  }
  // 最後一個字至少唱一小段
  const last = res[res.length - 1]!;
  last.end = Math.max(last.end, last.start + 0.12);
  return res;
}
