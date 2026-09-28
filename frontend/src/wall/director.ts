// 導演：邊播邊排「下一個窗格」——用哪個版面、主打哪則留言、在哪一拍切。
//
// pdoom 的剪接（timeline.ts）是人工的：每個版面錨在某一句歌詞，切點吸到節拍格。婚禮歌單一直在變，
// 所以把同一套規則自動化：
//  - 切點只落在拍點上，偏好：段落開頭 > 歌詞一行開頭前的那一拍 > 小節線；避免切在一句歌詞中間。
//  - 窗格長度：版面自己的偏好小節數，而且要夠讀完主打的留言（中文約每秒 6 字，再加進場退場）。
//  - 版面：依這一段的能量挑（副歌用強烈的、抒情段用安靜的），不跟前兩個重複，暗底／紙底交替。
//  - 每首歌開頭是「歌名卡」；還沒有留言、或隔一陣子，就插一張大 QR 的「邀請卡」。
// 全部用種子（歌的 id、第幾個窗格）決定，同一首歌同樣的留言重播會排得一樣。
import type { Engine, TimelineEntry, SongRuntime } from './engine/engine';
import { hash } from './engine/util';
import { readSeconds } from './engine/text';
import type { MessagePool } from './pool';
import type { Msg } from './engine/scene';

export interface PlateSpec {
  /** scenes/<name>.ts */
  name: string;
  /** 類別：couple = 手繪新人互動，type = 文字／圖像。 */
  group?: 'couple' | 'type';
  /** 系列（同一系列不要連著出現）。 */
  family?: string;
  /** 適合的段落能量範圍（0..1）。 */
  energy: [number, number];
  /** 偏好的長度（小節數）。 */
  bars: [number, number];
  /** 紙底（亮）的版面：跟暗底交替，畫面才有明暗節奏。 */
  paper?: boolean;
  /** 一次展示很多則留言（祝福牆）：留言少於這個數字就不排。 */
  minMessages?: number;
  /** 沒有留言也能排（純歌詞）。 */
  lyricsOnly?: boolean;
  /** 被挑中的相對機率。 */
  weight?: number;
  /** 變化款數（params.variant = 0..n-1）。 */
  variants?: number;
}

/**
 * 版面清單。檔案不存在的（還沒做好）自動跳過；karaoke 是最基本的保底版面（pdoom 的 starter 版面改的）。
 */
export const PLATES: PlateSpec[] = [
  { name: 'sparkler', energy: [0, 0.75], bars: [4, 8], lyricsOnly: true, weight: 1.2 },
  { name: 'slam', energy: [0.5, 1], bars: [2, 4], lyricsOnly: true, weight: 1.2, variants: 4 },
  { name: 'certificate', energy: [0.15, 0.8], bars: [4, 8], paper: true, weight: 1 },
  { name: 'heartbeat', energy: [0.35, 1], bars: [4, 8], lyricsOnly: true, weight: 1 },
  { name: 'stars', energy: [0, 0.6], bars: [4, 8], lyricsOnly: true, weight: 1 },
  { name: 'banknote', energy: [0.2, 0.85], bars: [4, 8], paper: true, weight: 0.9 },
  { name: 'mosaic', energy: [0.45, 1], bars: [4, 8], minMessages: 6, weight: 0.8 },
  { name: 'fireworks', energy: [0.3, 1], bars: [4, 8], lyricsOnly: true, weight: 1 },
  { name: 'vinyl', energy: [0, 0.7], bars: [4, 8], lyricsOnly: true, weight: 0.9 },
  { name: 'karaoke', energy: [0, 1], bars: [4, 8], lyricsOnly: true, weight: 0.15 },
];

/** 每隔多久（秒）插一張大 QR 的邀請卡。 */
const INVITE_EVERY = 240;

export class Director {
  private song!: SongRuntime;
  private startAt = 0;
  private idx = 0;
  private history: string[] = [];
  /** 整晚最近用過的版面（換歌不清空）：兩百個版面要輪得開，不要上一首剛看過的又出現。 */
  private recent: string[] = [];
  private lastInvite = -Infinity;
  /** 外部可以強制下一個窗格用哪個版面（開發模式、截圖用）。 */
  force: { scene: string; params?: Record<string, any> } | null = null;

  constructor(private engine: Engine, private pool: MessagePool) {}

  /** 換歌。startAt：從第幾秒開始播（後台剪掉前奏時不是 0）。 */
  startSong(song: SongRuntime, startAt = 0) {
    this.song = song;
    this.startAt = startAt;
    this.idx = 0;
    this.history = [];
  }

  private rnd(k: number) { return hash(this.song.info.id, this.idx, k); }

  /** 每一格呼叫：時間軸上 t 之後至少要排到 t + 6 秒。 */
  update(t: number) {
    const tl = this.engine.timeline;
    let end = tl.length ? Math.max(...tl.map((e) => e.end)) : this.startAt;
    let guard = 0;
    while (end < Math.min(this.song.audio.duration, t + 6) && guard++ < 4) {
      const e = this.plan(end);
      this.engine.add(e);
      end = e.end;
    }
  }

  /** 從 from 開始排一個窗格。 */
  plan(from: number): TimelineEntry {
    const au = this.song.audio, dur = au.duration;
    const first = this.idx === 0;
    const exclude = new Set<number>(this.onScreen(from));
    let scene: string, params: Record<string, any> = {}, bars: [number, number] = [4, 8];
    let msg: Msg | null = null;
    const energy = au.energyAt(Math.min(dur - 0.01, from + 4));
    const avail = this.plates();

    if (this.force) {
      scene = this.force.scene; params = { ...(this.force.params ?? {}) };
      msg = params.message ?? this.pool.nextHero(this.rnd(1), exclude);
    } else if (first) {
      // 歌名卡：從 0 到前奏結束（或至少兩小節），不超過八小節
      scene = 'title'; params = { kind: 'song' }; bars = [2, 8];
    } else if (this.pool.count === 0 ? from - this.lastInvite > 45 : from > 30 && performance.now() / 1000 - this.lastInvite > INVITE_EVERY) {
      // 還沒有人留言：常常提醒大家掃 QR；有留言之後每四分鐘一次
      scene = 'title'; params = { kind: 'invite' }; bars = [4, 6];
      this.lastInvite = this.pool.count === 0 ? from : performance.now() / 1000;
    } else {
      msg = this.pool.nextHero(this.rnd(1), exclude);
      const lyricsNow = this.song.lyrics.linesIn(from, from + 12).length > 0;
      const ok = avail.filter((p) =>
        energy >= p.energy[0] - 0.05 && energy <= p.energy[1] + 0.05 &&
        (p.minMessages === undefined || this.pool.count >= p.minMessages) &&
        (msg || p.lyricsOnly) && (msg || lyricsNow || p.name !== 'karaoke') &&
        !this.history.slice(-2).includes(p.name));
      const specOf = (n: string | undefined) => avail.find((p) => p.name === n);
      const lastPaper = specOf(this.history[this.history.length - 1])?.paper;
      // 手繪新人互動是點綴（新人說「一點點、有些場景有就好」）：剛出現過就先不要再來
      const coupleRecently = [1, 2].some((k) => specOf(this.history[this.history.length - k])?.group === 'couple');
      const pool = (ok.length ? ok : avail.filter((p) => p.name !== this.history[this.history.length - 1])).map((p) => ({
        // 同一首歌已經用過的版面機率降到三成：一首歌裡盡量每個窗格都不一樣
        p, w: (p.weight ?? 1) * (p.paper && lastPaper ? 0.25 : 1) * (p.name === 'karaoke' && ok.length > 1 ? 0.2 : 1)
          * (this.history.includes(p.name) ? 0.3 : this.recent.includes(p.name) ? 0.4 : 1) * (coupleRecently && p.group === 'couple' ? 0.1 : 1)
          // 同一系列（例如都是運動、都是紙本文件）不要連著出現
          * (p.family && p.family === specOf(this.history[this.history.length - 1])?.family ? 0.2 : 1),
      }));
      let r = this.rnd(2) * pool.reduce((s, x) => s + x.w, 0);
      let spec = pool[0]?.p ?? { name: 'karaoke', energy: [0, 1], bars: [4, 8] } as PlateSpec;
      for (const x of pool) { r -= x.w; if (r <= 0) { spec = x.p; break; } }
      scene = spec.name;
      bars = spec.bars;
      // 還有新留言在排隊：窗格短一點（最多 8 小節），新留言才不用等太久才上螢幕
      if (this.pool.freshCount > 0) bars = [bars[0], Math.max(bars[0], Math.min(bars[1], 8))];
      if (spec.variants) params.variant = Math.floor(this.rnd(3) * spec.variants);
    }
    if (msg) { params.message = msg; this.pool.markShown(msg.id); }
    // 全部可上螢幕的留言：每個窗格都給（片尾名單、便利貼牆、聊天室的歷史泡泡會拿來用），版面不用為了拿清單而設 minMessages
    params.messages ??= this.pool.all.slice();
    params.seed = Math.floor(this.rnd(4) * 1e6);
    params.energy = energy;

    // 長度：版面偏好，但要夠讀完留言
    const barLen = Math.max(0.8, au.timeOfBar(Math.floor(au.barAt(from)) + 1) - au.timeOfBar(Math.floor(au.barAt(from))));
    const need = msg ? readSeconds(msg.text) + 3.5 : 0;
    const minD = Math.max(bars[0] * barLen, need, first ? 3.5 : 4);
    const maxD = Math.max(minD + barLen, bars[1] * barLen, need + 2 * barLen);
    let end = first ? this.introEnd(from, minD, Math.min(maxD, 8 * barLen)) : this.bestCut(from, minD, maxD, (minD + maxD) / 2);
    // 剩下的尾巴太短（不到 5 秒）：這個窗格直接撐到歌曲結束
    if (dur - end < 5) end = dur;
    const e: TimelineEntry = { id: `s${this.song.info.id}-w${this.idx}-${scene}`, scene, start: from, end, params };
    this.history.push(scene);
    this.recent.push(scene);
    if (this.recent.length > 60) this.recent.shift();
    this.idx++;
    return e;
  }

  /**
   * 可以排的版面：有載到的版面模組（title 是片頭卡，另外排）。參數以版面檔的 export const spec 為準，
   * 其次是上面的 PLATES，都沒有就用預設值。
   */
  private plates(): PlateSpec[] {
    const out: PlateSpec[] = [];
    for (const name of this.engine.classes.keys()) {
      if (name === 'title') continue;
      const base = PLATES.find((p) => p.name === name);
      const decl = this.engine.specs.get(name) ?? {};
      out.push({ energy: [0, 1], bars: [4, 8], lyricsOnly: true, weight: 1, group: 'type', ...base, ...decl, name });
    }
    return out;
  }

  /** 正在畫面上（或排好了）的留言 id：主打不要跟它們重複。 */
  private onScreen(t: number): number[] {
    const ids: number[] = [];
    for (const e of this.engine.timeline) if (e.end > t - 4 && e.params?.message) ids.push(e.params.message.id);
    for (const m of this.pool.all) if (this.engine.overlay.showing(m.id, t)) ids.push(m.id);
    return ids;
  }

  /** 歌名卡在哪裡結束：第一句歌詞前的那一拍（前奏很長就最多 maxD）。 */
  private introEnd(from: number, minD: number, maxD: number): number {
    const first = this.song.lyrics.lines[0];
    const au = this.song.audio;
    if (first && first.start - from >= minD && first.start - from <= maxD + 4) {
      const b = au.timeOfBeat(Math.floor(au.beatAt(first.start + 0.02)));
      if (b - from >= minD) return b;
    }
    return this.bestCut(from, minD, maxD, Math.min(maxD, minD + 2));
  }

  /**
   * 在 [from+minD, from+maxD] 裡挑一個切點：靠近 target、落在段落開頭／歌詞一行開頭前的拍點／小節線加分，
   * 切在一句歌詞正中間扣分。
   */
  private bestCut(from: number, minD: number, maxD: number, target: number): number {
    const au = this.song.audio, ly = this.song.lyrics;
    const lo = from + minD, hi = Math.min(au.duration, from + maxD);
    if (lo >= au.duration) return au.duration;
    const cands = new Map<number, number>(); // 時間 → 加分
    const add = (t: number, bonus: number) => {
      if (t < lo - 1e-3 || t > hi + 1e-3) return;
      const k = Math.round(t * 1000) / 1000;
      cands.set(k, Math.max(cands.get(k) ?? 0, bonus));
    };
    for (let b = Math.ceil(au.barAt(lo)); au.timeOfBar(b) <= hi; b++) add(au.timeOfBar(b), 0.5);
    for (const s of au.sections) add(au.nearestBeat(s.start), 1.6);
    for (const l of ly.lines) add(au.timeOfBeat(Math.floor(au.beatAt(l.start + 0.02))), 1.1);
    if (!cands.size) {
      // 範圍內沒有小節線（很慢的歌）：退而求其次用拍點
      for (let b = Math.ceil(au.beatAt(lo)); au.timeOfBeat(b) <= hi; b++) add(au.timeOfBeat(b), 0);
    }
    if (!cands.size) return Math.min(au.duration, au.nextBeat(lo));
    const barLen = Math.max(0.8, au.beatPeriod(from) * 4);
    let best = lo, bestScore = -Infinity;
    for (const [t, bonus] of cands) {
      const mid = ly.lines.some((l) => l.start < t - 0.35 && l.end > t + 0.35);
      const sc = -Math.abs(t - (from + target)) / barLen + bonus - (mid ? 1.8 : 0);
      if (sc > bestScore) { bestScore = sc; best = t; }
    }
    return best;
  }
}
