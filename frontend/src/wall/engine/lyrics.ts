// Word-timed lyrics with queries for karaoke rendering.
//
// 複製自 pdoom-video（MIT，見 ./LICENSE）並改成婚禮版：
//  - pdoom 的歌詞是英文，「字」之間一定有空白；婚禮歌單有中文、韓文，中文一個字就是一個 Word、中間沒有空白。
//    所以每個 Word 多記一個 o（在整行文字裡的起始位置），lineCharProgress 改用它算，不再假設空白。
//  - 歌詞來源是後台的 LRC（lyrics/build.ts 轉成這個格式），沒有 load()。
//  - 有中文翻譯的歌（韓文歌，2026-09-30）：每行的 text／words 是中文（照原文唱的進度亮），原文掛在 sub，
//    版面在中文下面小一號畫原文（`_motifs.ts` 的 drawLyric／lyricOnPath 自動畫；自己畫歌詞的版面用 lyricSubOf）。
import { smart } from './type';

export interface Word {
  w: string; // display token (punctuation attached, typographic quotes: don’t, ’cause)
  start: number;
  end: number;
  conf?: number;
  syl?: [number, number][];
  /** filled in by Lyrics: */
  line: number;
  index: number; // index within line
  gi: number; // global word index
  /** 這個字在 line.text 裡從第幾個字元（UTF-16）開始。 */
  o: number;
}
export interface Line {
  i: number;
  text: string;
  start: number;
  end: number;
  words: Word[];
  /** 原文（有翻譯的歌才有）：真正在唱的那一行，逐字時間是原文自己的。 */
  sub?: Line;
}

type LineJSON = { text: string; start: number; end: number; words: { w: string; start: number; end: number; syl?: [number, number][] }[] };
export interface LyricsJSON {
  lines: (LineJSON & { sub?: LineJSON })[];
}

/**
 * 這一行要畫的原文副行（沒有就是 null）。自己畫歌詞的版面用這個判斷要不要畫第二行。
 * 有主打留言的窗格收起原文（留言是焦點、歌詞已經縮小一級，原文再縮會小到看不清楚）：引擎給那種窗格的 ctx.lyrics
 * 是 withoutSub() 的版本，行上本來就沒有 sub。不用全域開關——下一個窗格是在前一個還在播時預載的，init 裡 await 之後開關早就被改掉了。
 */
export const lyricSubOf = (line: Line | null | undefined): Line | null => line?.sub ?? null;

export class Lyrics {
  lines: Line[];
  words: Word[];
  constructor(j: LyricsJSON) {
    // display text gets curly apostrophes and quotes (the data keeps the typed ones); mono UI
    // text that wants them straight uses plain()
    const mk = (l: LineJSON, li: number): Line => {
      const text = smart(l.text);
      let at = 0;
      const words = l.words.map((w, wi) => {
        const ww = smart(w.w);
        const i = text.indexOf(ww, at);
        const o = i >= 0 ? i : at;
        at = o + ww.length;
        return { ...w, w: ww, line: li, index: wi, gi: 0, o };
      });
      return { text, start: l.start, end: l.end, i: li, words };
    };
    this.lines = j.lines.map((l, li) => {
      const line = mk(l, li);
      // 原文的字不進 this.words（wordAt、findWords 等全域查詢都是對主行）
      if (l.sub) line.sub = mk(l.sub, li);
      return line;
    });
    this.words = this.lines.flatMap((l) => l.words);
    this.words.forEach((w, i) => (w.gi = i));
  }

  static empty() { return new Lyrics({ lines: [] }); }

  private plain?: Lyrics;
  /** 同一份歌詞拿掉原文副行（有主打留言的窗格用，見 engine.ts）。沒有翻譯就是自己；每首歌只算一次。 */
  withoutSub(): Lyrics {
    if (!this.lines.some((l) => l.sub)) return this;
    return (this.plain ??= new Lyrics({
      lines: this.lines.map((l) => ({ text: l.text, start: l.start, end: l.end, words: l.words.map((w) => ({ w: w.w, start: w.start, end: w.end, ...(w.syl ? { syl: w.syl } : {}) })) })),
    }));
  }

  get has() { return this.lines.length > 0; }

  /** The line being sung at t (or null in gaps). */
  lineAt(t: number): Line | null {
    return this.lines.find((l) => t >= l.start && t < l.end) ?? null;
  }
  /** Most recent line that started at or before t. */
  lastLine(t: number): Line | null {
    let best: Line | null = null;
    for (const l of this.lines) if (l.start <= t) best = l;
    return best;
  }
  nextLine(t: number): Line | null {
    return this.lines.find((l) => l.start > t) ?? null;
  }
  linesIn(t0: number, t1: number): Line[] {
    return this.lines.filter((l) => l.end > t0 && l.start < t1);
  }
  /**
   * 畫面上該顯示的那一行：正在唱的；兩行之間的空檔先留著上一行（最多 hold 秒），
   * 下一行在 lead 秒前就可以先淡淡出現（pdoom 的規則：可以提早讓人看到，但反白不能跑在歌聲前面）。
   */
  shownLine(t: number, hold = 1.2, lead = 0.35): Line | null {
    const cur = this.lineAt(t);
    if (cur) return cur;
    const next = this.nextLine(t);
    if (next && next.start - t <= lead) return next;
    const last = this.lastLine(t);
    if (last && t - last.end <= hold) return last;
    return null;
  }
  /** Lines whose text includes `s` (case-insensitive, straight or curly quotes). Handy for finding a lyric by content. */
  find(s: string): Line[] {
    const q = fold(s);
    return this.lines.filter((l) => fold(l.text).includes(q));
  }
  /** First line containing `s`; throws if missing (fail loudly while authoring). */
  get(s: string, nth = 0): Line {
    const l = this.find(s)[nth];
    if (!l) throw new Error(`lyric not found: ${s}`);
    return l;
  }
  wordAt(t: number): Word | null {
    return this.words.find((w) => t >= w.start && t < w.end) ?? null;
  }
  lastWord(t: number): Word | null {
    let best: Word | null = null;
    for (const w of this.words) if (w.start <= t) best = w;
    return best;
  }
  /** Words whose normalized text matches (e.g. 'p(doom)'). */
  findWords(s: string): Word[] {
    const q = norm(s);
    return this.words.filter((w) => norm(w.w) === q);
  }

  /**
   * Sung progress of a word at time t: 0 before start, 1 after end, linear inside
   * (or piecewise across syllables when available). Use for karaoke wipes.
   */
  static wordProgress(w: Word, t: number): number {
    if (t <= w.start) return 0;
    if (t >= w.end) return 1;
    if (w.syl && w.syl.length > 1) {
      const n = w.syl.length;
      for (let i = 0; i < n; i++) {
        const [a, b] = w.syl[i]!;
        if (t < a) return i / n;
        if (t < b) return (i + (t - a) / Math.max(1e-3, b - a)) / n;
      }
      return 1;
    }
    return (t - w.start) / Math.max(1e-3, w.end - w.start);
  }

  /**
   * Progress through a whole line in characters (0..text.length), for per-glyph wipes.
   * （婚禮版：用每個字的 o 算，中文沒有空白也對。）
   */
  static lineCharProgress(l: Line, t: number): number {
    let chars = 0;
    for (const w of l.words) {
      const p = Lyrics.wordProgress(w, t);
      if (p <= 0) break;
      chars = w.o + p * w.w.length;
      if (p < 1) break;
      // 唱完的字連同後面的空白一起算進去（下一個字的 o 會蓋過來）
      chars = w.o + w.w.length;
    }
    return Math.min(chars, l.text.length);
  }
}

export const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}()]/gu, '');
const fold = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
