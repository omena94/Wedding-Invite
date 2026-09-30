// LRC → 逐字時間（pdoom 的 Lyrics 格式）。
//
// pdoom 用強制對齊（Demucs 分出人聲 + CTC + Whisper）拿到每個字的時間；婚禮歌單要能自己加歌，
// 所以改成：LRC 給每一行的開始時間（LRCLIB 抓來的，或新人自己按空白鍵對的），行內的字用「唱的速度」推估：
//  - 單位：中文、日文一個字；韓文一個音節；英文一個字（依母音組估音節數當權重）
//  - 一行大約用八分音符的速度唱（一拍兩個音節），跟下一行靠很近就一路唱到下一行前；
//  - 每個字的開始吸到最近的十六分音符格（流行歌的旋律幾乎都在拍子格上），看起來才會「跟著唱」。
// 有加強版逐字時間（<mm:ss.xx>）的行就直接用，不推估；可以每個字標，也可以一段標一次（段內平均分）。
// 沒標的行照舊推估，所以一首歌只要修唱不準的那幾行。
//
// 中文翻譯（韓文歌，2026-09-30）：另一份 LRC，照順序一句對一句配到原文（句數不同時找開始時間最接近的）。
// 配到的行：主行換成中文、原文掛在 sub。時間一律跟原文走——中文那句也有 <時間> 分段、段數跟原文一樣時，
// 中文第 k 段跟原文第 k 段同時亮；不然中文照原文這句「唱到幾成」等比例亮。原文改時間，中文自動跟著。
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
export function buildLyrics(src: string, au: AudioData, offset = 0, trans = ''): Lyrics {
  const doc = parseLrc(src);
  const lines = doc.lines.filter((l) => !Number.isNaN(l.t)).map((l) => ({ ...l, t: l.t + offset, words: l.words?.map((w) => ({ ...w, t: w.t + offset })) }));
  if (!lines.length) return Lyrics.empty();
  const out: LyricsJSON['lines'] = [];
  const kept: LrcLine[] = []; // 跟 out 一一對應的原文行（配翻譯用）
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const text = lineText(l);
    if (!text || !LETTER.test(text)) continue;
    const next = lines.slice(i + 1).find((x) => x.t > l.t + 0.05)?.t ?? au.duration;
    const words = l.words?.some((w) => w.w.trim()) ? fromTags(l, next, au) : estimate(text, l.t, next, au);
    if (!words.length) continue;
    out.push({ text, start: words[0]!.start, end: words[words.length - 1]!.end, words });
    kept.push(l);
  }
  if (trans.trim()) attachTrans(out, kept, trans, offset);
  return new Lyrics({ lines: out });
}

const lineText = (l: LrcLine) => (l.words?.length ? l.words.map((w) => w.w).join('').replace(/\s+/g, ' ').trim() : l.text);
const same = (a: string, b: string) => a.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') === b.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * 翻譯的每一行配到哪一句原文（回傳跟 orig 一樣長，配不到是 null）。
 * 句數一樣就照順序一句對一句（原文之後改時間、提早延後都不會配錯）；不一樣就找開始時間最接近的（1.5 秒內）。
 * 兩邊的時間都是 LRC 上寫的（各自扣掉自己的 [offset:]），跟整首的提早／延後無關。
 */
export function pairTrans(orig: LrcLine[], trans: string): (LrcLine | null)[] {
  const tr = parseLrc(trans).lines.filter((l) => !Number.isNaN(l.t) && LETTER.test(lineText(l)));
  if (tr.length === orig.length) return tr;
  return orig.map((o) => {
    let best: LrcLine | null = null;
    for (const l of tr) if (Math.abs(l.t - o.t) <= 1.5 && (!best || Math.abs(l.t - o.t) < Math.abs(best.t - o.t))) best = l;
    return best;
  });
}

type WordJSON = LyricsJSON['lines'][number]['words'][number];

/** 把翻譯掛上去：配到的行主行換成中文、原文變 sub。兩行一樣（「Ah-ah, mine」）就不掛，照原文顯示一行。 */
function attachTrans(out: LyricsJSON['lines'], orig: LrcLine[], trans: string, offset: number) {
  const pairs = pairTrans(orig.map((l) => ({ ...l, t: l.t - offset })), trans);
  out.forEach((line, i) => {
    const tr = pairs[i];
    const text = tr && lineText(tr);
    if (!tr || !text || same(text, line.text)) return;
    const words = segmentsMatch(orig[i]!, tr) ? bySegments(orig[i]!, tr, line.words) : byProgress(text, line.words);
    if (!words.length) return;
    out[i] = {
      text, words,
      start: Math.min(words[0]!.start, line.start), end: Math.max(words[words.length - 1]!.end, line.end),
      sub: line,
    };
  });
}

/** 兩邊都有 <時間> 分段、而且段數一樣（連空白段、結尾標記都算）：中文第 k 段就跟原文第 k 段一起唱。 */
const segmentsMatch = (o: LrcLine, tr: LrcLine) => !!o.words?.length && !!tr.words?.length && o.words.length === tr.words.length;

/** 中文第 k 段的時間 = 原文第 k 段開始到第 k+1 段開始（最後一段到原文最後一個字唱完），段內照音節平均分。 */
function bySegments(o: LrcLine, tr: LrcLine, ko: WordJSON[]): WordJSON[] {
  const koEnd = ko[ko.length - 1]!.end;
  // 原文的段落時間照 fromTags 的規則往後推（手打倒退的時間不讓字倒著亮）
  const bounds: number[] = [];
  let floor = -Infinity;
  for (const w of o.words!) { floor = Math.max(w.t, floor); bounds.push(floor); }
  const res: WordJSON[] = [];
  tr.words!.forEach((seg, k) => {
    const units = lyricUnits(seg.w).filter((u) => u.w.trim());
    if (!units.length) return;
    const start = Math.min(bounds[k]!, koEnd), end = Math.max(start + 0.05, Math.min(bounds[k + 1] ?? koEnd, koEnd));
    const total = units.reduce((s, u) => s + Math.max(1, u.syl), 0);
    let acc = 0;
    for (const u of units) {
      const t0 = start + ((end - start) * acc) / total;
      acc += Math.max(1, u.syl);
      res.push({ w: u.w, start: t0, end: start + ((end - start) * acc) / total });
    }
  });
  return res;
}

/**
 * 段落對不上時：中文照原文這句「唱到幾成」等比例亮（原文唱第幾個音節，中文就亮到整句的幾成），
 * 原文中間停頓時中文也停，兩行同時開始、同時唱完。
 */
function byProgress(text: string, ko: WordJSON[]): WordJSON[] {
  const kw = ko.map((w) => Math.max(1, lyricUnits(w.w).reduce((s, u) => s + u.syl, 0)));
  const kTotal = kw.reduce((a, b) => a + b, 0);
  const cum = [0];
  for (const w of kw) cum.push(cum[cum.length - 1]! + w);
  // 唱到整句的 p（0..1）是幾秒；atEnd：剛好在兩個字的交界時算前一個字唱完（不然會跳到下一個字的開始、把停頓吃掉）
  const timeAt = (p: number, atEnd: boolean) => {
    const x = p * kTotal;
    for (let j = 0; j < ko.length; j++) {
      if (atEnd ? x <= cum[j + 1]! + 1e-9 : x < cum[j + 1]! - 1e-9) return ko[j]!.start + ((x - cum[j]!) / kw[j]!) * (ko[j]!.end - ko[j]!.start);
    }
    return ko[ko.length - 1]!.end;
  };
  const units = lyricUnits(text).filter((u) => u.w.trim());
  const total = units.reduce((s, u) => s + Math.max(1, u.syl), 0) || 1;
  let acc = 0;
  return units.map((u) => {
    const a = acc / total;
    acc += Math.max(1, u.syl);
    return { w: u.w, start: timeAt(a, false), end: timeAt(acc / total, true) };
  });
}

/**
 * 加強版 LRC：標了時間的就照標的用；最後一段唱到結尾標記。沒有結尾標記（後台「對字」最後一下可以不按）的話，
 * 最後一段照唱的速度推算（大約八分音符一個音節，跟自動推算一樣），不超過下一行。
 * 一個標記後面可以是一個字，也可以是一段（新人可以只標「窗外飛過著／宣告戀愛／的蜻蜓」三段）：
 * 一段裡有好幾個字就把這段的時間依音節平均分給每個字，大螢幕才會一個字一個字亮，而不是整段一起亮。
 */
function fromTags(l: LrcLine, next: number, au: AudioData) {
  const tags = l.words!;
  const res: { w: string; start: number; end: number }[] = [];
  let floor = -Infinity;
  for (let k = 0; k < tags.length; k++) {
    if (!tags[k]!.w.trim()) continue;
    // 手打的時間偶爾會倒退（打錯一位數）：往後推，至少不讓字倒著亮
    const start = Math.max(tags[k]!.t, floor);
    const units = lyricUnits(tags[k]!.w).filter((u) => u.w.trim());
    const total = units.reduce((s, u) => s + Math.max(1, u.syl), 0) || 1;
    const syl = Math.min(0.42, Math.max(0.16, au.beatPeriod(start) / 2));
    const end = Math.max(start + 0.05, tags[k + 1]?.t ?? Math.min(next - 0.05, start + Math.max(0.6, total * syl * 1.1)));
    let acc = 0;
    for (const u of units) {
      const t0 = start + ((end - start) * acc) / total;
      acc += Math.max(1, u.syl);
      res.push({ w: u.w, start: t0, end: start + ((end - start) * acc) / total });
    }
    floor = end;
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
