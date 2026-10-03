// Music analysis sampled at arbitrary song time.
//
// 複製自 pdoom-video（MIT，見 ./LICENSE）並改成婚禮版：pdoom 的分析是離線用 Python（Demucs 分軌、librosa）做好的 audio.json；
// 大螢幕的歌由新人自己在後台增減，所以改在瀏覽器裡分析（analysis/analyze.ts），格式跟 pdoom 相容，再加：
//  - features 可以是壓縮過的 base64 Uint8（每首歌存進資料庫只要一兩百 KB）
//  - sections 多了 energy（0..1，這段有多「滿」）：導演（director.ts）用它挑版面，副歌用強烈的、抒情段用安靜的
//  - 沒有分軌，vocal/drums/bass/other 是用頻帶近似出來的（夠做反應，不要拿來判斷「有沒有人在唱」）

export interface Section { name: string; start: number; end: number; energy: number }

export interface AudioJSON {
  version?: number;
  duration: number;
  bpm: number;
  fps: number;
  beats: number[];
  downbeats: number[];
  sections: Section[];
  /** 0..1 的包絡：number[]，或壓縮成 base64 的 Uint8（0..255）。 */
  features: Record<string, number[] | string>;
  onsets: Record<string, [number, number][]>;
  /** 整首歌的平均響度（dBFS，RMS），播放時拿來把每首歌的音量拉齊。 */
  loudness?: number;
  /** 亮度（頻譜重心的中位數，Hz），挑配色主題用。 */
  brightness?: number;
}

export interface AudioSample {
  rms: number; low: number; mid: number; high: number;
  vocal: number; drums: number; bass: number; other: number;
  /** Decaying pulses (1 at the hit, half-life ~90-140 ms), scaled by hit strength. */
  kick: number; snare: number; hat: number; vonset: number;
}

const FEATURES = ['rms', 'low', 'mid', 'high', 'vocal', 'drums', 'bass', 'other'] as const;

/** base64 Uint8 → 0..1 的 Float32Array。 */
export function unpackFeature(v: number[] | string | undefined): Float32Array {
  if (!v) return new Float32Array(0);
  if (typeof v !== 'string') return Float32Array.from(v);
  const bin = atob(v);
  const out = new Float32Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) / 255;
  return out;
}

/** 0..1 的數列 → base64 Uint8（存檔用）。 */
export function packFeature(a: ArrayLike<number>): string {
  let s = '';
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(Math.max(0, Math.min(255, Math.round(a[i]! * 255))));
  return btoa(s);
}

export class AudioData {
  duration: number;
  bpm: number;
  beats: number[];
  downbeats: number[];
  sections: Section[];
  loudness: number;
  brightness: number;
  private fps: number;
  private feat: Record<string, Float32Array> = {};
  onsets: Record<string, [number, number][]>;

  constructor(j: AudioJSON) {
    this.duration = j.duration;
    this.bpm = j.bpm;
    this.beats = j.beats;
    this.downbeats = j.downbeats;
    this.sections = (j.sections ?? []).map((s) => ({ ...s, energy: s.energy ?? 0.5 }));
    this.fps = j.fps || 100;
    this.loudness = j.loudness ?? -14;
    this.brightness = j.brightness ?? 2000;
    // envelopes may be nested under `features` or top-level arrays
    for (const k of FEATURES) this.feat[k] = unpackFeature(j.features?.[k] ?? ((j as any)[k] as number[] | undefined));
    this.onsets = j.onsets ?? {};
  }

  /**
   * 沒有音檔（歌單還是空的）時用的假節拍：固定 BPM、四拍一小節、整段一個中等能量的段落。
   * 大螢幕照樣能跑版面與留言，只是沒有音樂可以對。
   */
  static silent(duration = 240, bpm = 96): AudioData {
    const p = 60 / bpm, beats: number[] = [];
    for (let t = 0; t < duration; t += p) beats.push(t);
    return new AudioData({
      duration, bpm, fps: 50, beats, downbeats: beats.filter((_, i) => i % 4 === 0),
      sections: [{ name: 'silent', start: 0, end: duration, energy: 0.35 }], features: {}, onsets: {},
    });
  }

  /** Linear-interpolated envelope value at time t. */
  env(name: string, t: number): number {
    const a = this.feat[name];
    if (!a || a.length === 0) return 0;
    const x = t * this.fps;
    const i = Math.floor(x);
    if (i < 0) return a[0]!;
    if (i >= a.length - 1) return a[a.length - 1]!;
    const f = x - i;
    return a[i]! * (1 - f) + a[i + 1]! * f;
  }

  /** Max over [t - w, t]: a peak-hold for punchy reactions. */
  envPeak(name: string, t: number, w = 0.08): number {
    let m = 0;
    for (let s = t - w; s <= t; s += 1 / this.fps) m = Math.max(m, this.env(name, s));
    return m;
  }

  /** Sum of decaying pulses from onsets of a kind (kick/snare/hat/vocal) before t. */
  hit(kind: string, t: number, halfLife = 0.11): number {
    const list = this.onsets[kind];
    if (!list || list.length === 0) return 0;
    let lo = 0, hi = list.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (list[m]![0] <= t) lo = m + 1; else hi = m; }
    let v = 0;
    for (let i = lo - 1; i >= 0 && i >= lo - 6; i--) {
      const [ot, s] = list[i]!;
      const dt = t - ot;
      if (dt > halfLife * 8) break;
      v = Math.max(v, s * Math.pow(0.5, dt / halfLife));
    }
    return v;
  }

  /** Onset events of a kind in [t0, t1). */
  events(kind: string, t0: number, t1: number): [number, number][] {
    // 婚禮版：二分搜尋起點（一首歌有上千個 onset，版面每格都可能呼叫）
    const list = this.onsets[kind] ?? [];
    let lo = 0, hi = list.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (list[m]![0] < t0) lo = m + 1; else hi = m; }
    const out: [number, number][] = [];
    for (let i = lo; i < list.length && list[i]![0] < t1; i++) out.push(list[i]!);
    return out;
  }

  sample(t: number): AudioSample {
    return {
      rms: this.env('rms', t), low: this.env('low', t), mid: this.env('mid', t), high: this.env('high', t),
      vocal: this.env('vocal', t), drums: this.env('drums', t), bass: this.env('bass', t), other: this.env('other', t),
      kick: this.hit('kick', t, 0.12), snare: this.hit('snare', t, 0.14), hat: this.hit('hat', t, 0.06),
      vonset: this.hit('vocal', t, 0.15),
    };
  }

  /**
   * 網格外（第一拍之前、最後一拍之後）外插用的一拍長度：靠近那一端的 8 個間隔的平均（跟著當地的速度，又不會被單一個抖動的間隔帶歪）。
   * beatAt 與 timeOfBeat **一定要用同一個值**：以前一邊用平均週期、一邊用頭尾的單一間隔，網格外 beatAt(timeOfBeat(b)) ≠ b，
   * beatAfter 在拍點上會多算（或少算）一拍（歌的前奏與結尾的窗格）。
   */
  private edgePeriod(end: 'head' | 'tail'): number {
    const b = this.beats, n = b.length;
    if (n < 2) return 60 / this.bpm;
    const k = Math.min(8, n - 1);
    return end === 'head' ? (b[k]! - b[0]!) / k : (b[n - 1]! - b[n - 1 - k]!) / k;
  }

  /** Continuous beat index: 0 at first beat, fractional in between (extrapolated outside). */
  beatAt(t: number): number {
    const b = this.beats;
    if (b.length === 0) return t * (this.bpm / 60);
    if (b.length === 1) return (t - b[0]!) / this.edgePeriod('head');
    if (t <= b[0]!) return (t - b[0]!) / this.edgePeriod('head');
    if (t >= b[b.length - 1]!) return b.length - 1 + (t - b[b.length - 1]!) / this.edgePeriod('tail');
    let lo = 0, hi = b.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (b[m]! <= t) lo = m; else hi = m; }
    return lo + (t - b[lo]!) / (b[hi]! - b[lo]!);
  }

  /** Time of (fractional) beat index（beatAt 的反函數：網格外用同一個 edgePeriod 外插）。 */
  timeOfBeat(i: number): number {
    const b = this.beats;
    const n = b.length;
    if (n === 0) return i * (60 / this.bpm);
    if (i <= 0) return b[0]! + i * this.edgePeriod('head');
    if (i >= n - 1) return b[n - 1]! + (i - (n - 1)) * this.edgePeriod('tail');
    const k = Math.floor(i);
    return b[k]! + (b[k + 1]! - b[k]!) * (i - k);
  }

  /** Continuous bar index from downbeats (0 at first downbeat). */
  barAt(t: number): number {
    const d = this.downbeats;
    if (d.length < 2) return this.beatAt(t) / 4;
    if (t <= d[0]!) return (t - d[0]!) / (d[1]! - d[0]!);
    if (t >= d[d.length - 1]!) {
      const p = d[d.length - 1]! - d[d.length - 2]!;
      return d.length - 1 + (t - d[d.length - 1]!) / p;
    }
    let lo = 0, hi = d.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (d[m]! <= t) lo = m; else hi = m; }
    return lo + (t - d[lo]!) / (d[hi]! - d[lo]!);
  }

  /** 小節 i（可以是小數）開始的時間（barAt 的反函數，超出範圍時照最後一小節的長度外插）。 */
  timeOfBar(i: number): number {
    const d = this.downbeats;
    if (d.length < 2) return this.timeOfBeat(i * 4);
    const n = d.length;
    if (i <= 0) return d[0]! + i * (d[1]! - d[0]!);
    if (i >= n - 1) return d[n - 1]! + (i - (n - 1)) * (d[n - 1]! - d[n - 2]!);
    const k = Math.floor(i);
    return d[k]! + (d[k + 1]! - d[k]!) * (i - k);
  }

  /** 一拍幾秒（在 t 附近）。 */
  beatPeriod(t: number): number {
    const i = Math.floor(this.beatAt(t));
    return Math.max(0.2, this.timeOfBeat(i + 1) - this.timeOfBeat(i));
  }

  /** Nearest beat time to t. */
  nearestBeat(t: number): number {
    return this.timeOfBeat(Math.round(this.beatAt(t)));
  }

  /** t 之後（含）的第一個拍點。 */
  nextBeat(t: number): number {
    return this.timeOfBeat(Math.ceil(this.beatAt(t) - 1e-6));
  }

  /** t 之後（含）的第一個小節線。 */
  nextDownbeat(t: number): number {
    return this.timeOfBar(Math.ceil(this.barAt(t) - 1e-6));
  }

  section(t: number) {
    return this.sections.find((s) => t >= s.start && t < s.end) ?? this.sections[this.sections.length - 1];
  }

  /** 這一段有多「滿」（0..1），沒有段落資料時 0.5。 */
  energyAt(t: number): number {
    return this.section(t)?.energy ?? 0.5;
  }
}
