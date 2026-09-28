// 在瀏覽器裡分析一首歌：節拍、小節、段落、能量包絡、鼓點（輸出格式跟 pdoom-video 的 data/audio.json 相容）。
//
// pdoom 用 Python（Demucs 分軌 + librosa）離線分析一首固定的歌；婚禮歌單會增減，新人要能在後台自己加歌，
// 所以改成純 TypeScript、在 Web Worker 裡跑（一首 4 分鐘的歌約 2～4 秒）。演算法：
//  1. 先降到 ~22 kHz、單聲道，1024 點 STFT、每秒 100 格
//  2. 對數頻譜通量（superflux 的簡化版）當 onset 強度；分低／中／高頻帶，各自挑峰值當 kick / snare / hat
//  3. 速度：onset 包絡的自相關，乘上以 110 BPM 為中心的先驗（跟 librosa 同一套想法）
//  4. 拍點：Ellis 2007 的動態規劃（librosa.beat.beat_track 同一個演算法）
//  5. 小節線：四種相位裡，挑「低頻重拍 + 和聲變化」最明顯的那一種
//  6. 段落：以小節為單位比較前後四小節的能量、亮度與和聲，找變化最大的地方切開；每段給一個能量值（導演挑版面用）
// 全部是確定性的（同一個檔案每次分析結果一樣）。
import type { AudioJSON, Section } from '../engine/audio';
import { packFeature } from '../engine/audio';

/** 分析演算法的版本：改了演算法就加一，大螢幕會自動重新分析舊的歌。 */
export const ANALYSIS_VERSION = 1;

const FFT_N = 1024;
const OUT_FPS = 50;

// ---------------------------------------------------------------- 小工具
function percentile(a: ArrayLike<number>, q: number): number {
  const s = Float32Array.from(a).sort();
  if (!s.length) return 0;
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]!;
}
function mean(a: ArrayLike<number>, i0 = 0, i1 = a.length): number {
  let s = 0; const n = Math.max(1, i1 - i0);
  for (let i = i0; i < i1; i++) s += a[i]!;
  return s / n;
}
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** 先低通再抽樣，降到 22.05 / 24 kHz（FFT 少一半以上的工作，節拍分析用不到更高的頻率）。 */
function decimate(x: Float32Array, sr: number): { y: Float32Array; sr: number } {
  const d = Math.max(1, Math.round(sr / 22050));
  if (d === 1) return { y: x, sr };
  // 窗化 sinc 低通（截止在新的 Nyquist 的 0.9 倍）
  const taps = 31, fc = 0.45 / d, h = new Float32Array(taps);
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const m = i - (taps - 1) / 2;
    const sinc = m === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m);
    const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1));
    h[i] = sinc * w; sum += h[i]!;
  }
  for (let i = 0; i < taps; i++) h[i]! /= sum;
  const n = Math.floor(x.length / d), y = new Float32Array(n), half = (taps - 1) / 2;
  for (let j = 0; j < n; j++) {
    const c = j * d;
    let acc = 0;
    for (let i = 0; i < taps; i++) { const k = c + i - half; if (k >= 0 && k < x.length) acc += x[k]! * h[i]!; }
    y[j] = acc;
  }
  return { y, sr: sr / d };
}

/** 原地 radix-2 FFT（re, im 長度是 2 的次方）。 */
class FFT {
  private rev: Uint32Array; private cos: Float32Array; private sin: Float32Array;
  constructor(public n: number) {
    const bits = Math.log2(n);
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); this.rev[i] = r; }
    this.cos = new Float32Array(n / 2); this.sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) { this.cos[i] = Math.cos((2 * Math.PI * i) / n); this.sin[i] = -Math.sin((2 * Math.PI * i) / n); }
  }
  run(re: Float32Array, im: Float32Array) {
    const n = this.n, rev = this.rev;
    for (let i = 0; i < n; i++) { const j = rev[i]!; if (j > i) { const tr = re[i]!; re[i] = re[j]!; re[j] = tr; const ti = im[i]!; im[i] = im[j]!; im[j] = ti; } }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let s = 0; s < n; s += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step]!, wi = this.sin[k * step]!;
          const a = s + k, b = a + half;
          const xr = re[b]! * wr - im[b]! * wi, xi = re[b]! * wi + im[b]! * wr;
          re[b] = re[a]! - xr; im[b] = im[a]! - xi;
          re[a] = re[a]! + xr; im[a] = im[a]! + xi;
        }
      }
    }
  }
}

/** 單極點的 attack/release 平滑（讓包絡「打得快、收得慢」，看起來像真的在跟音樂呼吸）。 */
function attackRelease(x: Float32Array, fps: number, attack = 0.012, release = 0.14): Float32Array {
  const a = Math.exp(-1 / (attack * fps)), r = Math.exp(-1 / (release * fps));
  const y = new Float32Array(x.length);
  let v = 0;
  for (let i = 0; i < x.length; i++) { const k = x[i]! > v ? a : r; v = k * v + (1 - k) * x[i]!; y[i] = v; }
  return y;
}

/** 功率（dB）→ 0..1：以整首歌的第 99.5 百分位為頂、往下 42 dB 為底（安靜的段落還看得到起伏）。 */
function normDb(db: Float32Array, range = 42): Float32Array {
  const hi = percentile(db, 0.995), lo = Math.max(hi - range, percentile(db, 0.05));
  return db.map((v) => clamp01((v - lo) / Math.max(1, hi - lo)));
}

/** 除以第 q 百分位，壓到 0..1。 */
function normPct(x: Float32Array, q = 0.98): Float32Array {
  const p = percentile(x, q) || 1;
  return x.map((v) => clamp01(v / p));
}

/** 峰值挑選：局部最大、比附近平均高一截、跟上一個峰至少隔 minGap 格。回傳 [時間, 強度 0..1]。 */
function pickPeaks(env: Float32Array, fps: number, o: { delta?: number; minGap?: number; floor?: number } = {}): [number, number][] {
  const delta = o.delta ?? 0.06, minGap = Math.round((o.minGap ?? 0.05) * fps), floor = o.floor ?? 0.08;
  const w = 3, avgW = 12, out: [number, number][] = [];
  let last = -Infinity;
  const top = percentile(env, 0.99) || 1;
  for (let i = w; i < env.length - w; i++) {
    const v = env[i]!;
    if (v < floor) continue;
    let isMax = true;
    for (let k = i - w; k <= i + w; k++) if (env[k]! > v) { isMax = false; break; }
    if (!isMax) continue;
    const m = mean(env, Math.max(0, i - avgW), Math.min(env.length, i + avgW + 1));
    if (v < m + delta) continue;
    if (i - last < minGap) continue;
    out.push([+(i / fps).toFixed(3), +clamp01(v / top).toFixed(3)]);
    last = i;
  }
  return out;
}

// ---------------------------------------------------------------- 速度與拍點（Ellis 2007 / librosa）
function estimateTempo(onset: Float32Array, fps: number): number {
  // 去掉慢變化，只留節奏
  const n = onset.length, hp = new Float32Array(n), win = Math.round(fps);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += onset[i]!; if (i >= win) acc -= onset[i - win]!;
    hp[i] = Math.max(0, onset[i]! - acc / Math.min(i + 1, win));
  }
  const lagMin = Math.floor((60 * fps) / 210), lagMax = Math.ceil((60 * fps) / 50);
  const R = new Float32Array(lagMax + 2);
  for (let l = lagMin; l <= lagMax + 1; l++) {
    let s = 0;
    for (let i = l; i < n; i++) s += hp[i]! * hp[i - l]!;
    R[l] = s / (n - l);
  }
  let best = lagMin, bestScore = -Infinity;
  for (let l = lagMin; l <= lagMax; l++) {
    const bpm = (60 * fps) / l;
    // 以 110 BPM 為中心的對數常態先驗（librosa 用 120；婚禮歌單慢歌多，往下挪一點）
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.9) ** 2);
    // 兩倍拍長的自相關也算一點分，壓低「把慢歌聽成兩倍速」的機率
    const harm = l * 2 <= lagMax + 1 ? 0.5 * R[l * 2]! : 0;
    const sc = (R[l]! + harm) * prior;
    if (sc > bestScore) { bestScore = sc; best = l; }
  }
  // 拋物線內插出小數的 lag
  const a = R[best - 1] ?? R[best]!, b = R[best]!, c = R[best + 1] ?? R[best]!;
  const den = a - 2 * b + c, off = den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
  return (60 * fps) / (best + off);
}

function trackBeats(onset: Float32Array, fps: number, bpm: number, tightness = 100): number[] {
  const n = onset.length;
  const period = (60 * fps) / bpm;
  // onset 標準化（除以標準差）
  const sd = Math.sqrt(mean(onset.map((v) => v * v))) || 1;
  const on = onset.map((v) => v / sd);
  // localscore：用高斯窗平滑
  const half = Math.round(period), g: number[] = [];
  for (let k = -half; k <= half; k++) g.push(Math.exp(-0.5 * ((k * 32) / period) ** 2));
  const local = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -half; k <= half; k++) { const j = i + k; if (j >= 0 && j < n) s += on[j]! * g[k + half]!; }
    local[i] = s;
  }
  const w0 = Math.round(-2 * period), w1 = Math.round(-period / 2);
  const offs: number[] = [], txwt: number[] = [];
  for (let o = w0; o <= w1; o++) { offs.push(o); txwt.push(-tightness * Math.log(-o / period) ** 2); }
  const cum = new Float32Array(n), back = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let best = -Infinity, bi = -1;
    for (let k = 0; k < offs.length; k++) {
      const j = i + offs[k]!;
      if (j < 0) continue;
      const v = cum[j]! + txwt[k]!;
      if (v > best) { best = v; bi = j; }
    }
    cum[i] = local[i]! + (bi >= 0 ? best : 0);
    back[i] = bi;
  }
  // 最後一拍：累積分數的局部最大裡，最後一個超過中位數一半的
  const maxima: number[] = [];
  for (let i = 1; i < n - 1; i++) if (cum[i]! >= cum[i - 1]! && cum[i]! >= cum[i + 1]!) maxima.push(i);
  const med = percentile(maxima.map((i) => cum[i]!), 0.5);
  let tail = n - 1;
  for (let k = maxima.length - 1; k >= 0; k--) if (cum[maxima[k]!]! >= 0.5 * med) { tail = maxima[k]!; break; }
  const beats: number[] = [];
  for (let i = tail; i >= 0; i = back[i]!) { beats.push(i); if (back[i]! < 0) break; }
  beats.reverse();
  // 頭尾在音樂還沒開始／已經結束的拍點拿掉（localscore 太弱的）
  const thr = 0.5 * Math.sqrt(mean(beats.map((i) => local[i]! ** 2)));
  let s0 = 0, s1 = beats.length;
  while (s0 < s1 && local[beats[s0]!]! < thr) s0++;
  while (s1 > s0 && local[beats[s1 - 1]!]! < thr) s1--;
  return beats.slice(s0, s1).map((i) => i / fps);
}

/**
 * 小節線：逐拍的 4 狀態 Viterbi（這一拍是小節裡的第幾拍）。正常情況一拍前進一格；
 * 允許偶爾跳格（拍點追蹤漏了一拍、多了一拍、橋段換拍），但要付代價，所以只有「錯位好幾小節」才會切換。
 * 觀察值：流行歌大鼓在 1、3 拍、小鼓在 2、4 拍；和弦多半在第 1 拍換（用來分出 1 跟 3）。
 * 回傳是小節第一拍的拍點索引。
 */
function trackBars(beats: number[], kick: number[], snare: number[], chord: number[], lift: number[], tune: AnalyzeTuning = {}): number[] {
  const wc = tune.wChord ?? 0.8, wl = tune.wLift ?? 0.8, ws = tune.wSnare ?? 0.6;
  const n = beats.length;
  if (n < 4) return n ? [0] : [];
  const nz = (a: number[]) => { const m = mean(a) || 1; return a.map((v) => v / m); };
  const K = nz(kick), S = nz(snare), C = nz(chord), E = nz(lift);
  const emit = (s: number, i: number) => {
    const k = K[i]!, sn = S[i]!, c = C[i]!;
    // 音量突然變大（段落開頭、副歌進來）幾乎都在第 1 拍
    if (s === 0) return 1.0 * k - ws * sn + wc * c + wl * E[i]!;
    if (s === 2) return 0.7 * k - ws * sn - 0.2 * wc * c;
    return 0.8 * sn - 0.5 * k - 0.3 * c;
  };
  const JUMP = tune.jump ?? 8;
  const score = new Float64Array(n * 4), from = new Int8Array(n * 4);
  // 歌多半從第 1 拍開始（有弱起的少數歌，後面的觀察值會把它拉回來）
  for (let s = 0; s < 4; s++) score[s] = emit(s, 0) + (s === 0 ? 1.5 : 0);
  for (let i = 1; i < n; i++) {
    for (let s = 0; s < 4; s++) {
      let best = -Infinity, bp = 0;
      for (let p = 0; p < 4; p++) {
        const v = score[(i - 1) * 4 + p]! - ((p + 1) % 4 === s ? 0 : JUMP);
        if (v > best) { best = v; bp = p; }
      }
      score[i * 4 + s] = best + emit(s, i);
      from[i * 4 + s] = bp;
    }
  }
  let s = 0, best = -Infinity;
  for (let q = 0; q < 4; q++) if (score[(n - 1) * 4 + q]! > best) { best = score[(n - 1) * 4 + q]!; s = q; }
  const state = new Int8Array(n);
  for (let i = n - 1; i >= 0; i--) { state[i] = s; s = from[i * 4 + s]!; }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (state[i] === 0 && (!out.length || i - out[out.length - 1]! >= 2)) out.push(i);
  return out;
}

// ---------------------------------------------------------------- 主程式
export interface AnalyzeProgress { (p: number, label: string): void }

/**
 * 分析單聲道 PCM。`pcm` 是 decodeAudioData 出來混成單聲道的樣本，`sr` 是取樣率。
 */
/** 調參用（測試腳本）；平常不用給。 */
export interface AnalyzeTuning { lowWeight?: number; tightness?: number; jump?: number; wChord?: number; wLift?: number; wSnare?: number; secK?: number }

export function analyze(pcmIn: Float32Array, srIn: number, progress?: AnalyzeProgress, tune: AnalyzeTuning = {}): AudioJSON {
  const duration = pcmIn.length / srIn;
  progress?.(0.02, '降取樣');
  const { y: x, sr } = decimate(pcmIn, srIn);
  const hop = Math.round(sr / 100), fps = sr / hop, N = FFT_N, bins = N / 2 + 1;
  const nFrames = Math.max(1, Math.floor(x.length / hop));
  const hann = new Float32Array(N);
  for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const fft = new FFT(N);
  const re = new Float32Array(N), im = new Float32Array(N);
  const binHz = sr / N;
  const band = (lo: number, hi: number): [number, number] => [Math.max(1, Math.floor(lo / binHz)), Math.min(bins - 1, Math.ceil(hi / binHz))];
  const B = { low: band(30, 150), bass: band(30, 250), mid: band(150, 2500), vocal: band(300, 3400), high: band(2500, 10000), hat: band(5000, 10500), other: band(250, 5000), snare: band(1000, 5000) };

  const pow = { all: new Float32Array(nFrames), low: new Float32Array(nFrames), bass: new Float32Array(nFrames), mid: new Float32Array(nFrames), vocal: new Float32Array(nFrames), high: new Float32Array(nFrames), other: new Float32Array(nFrames) };
  const flux = { all: new Float32Array(nFrames), low: new Float32Array(nFrames), snare: new Float32Array(nFrames), hat: new Float32Array(nFrames), vocal: new Float32Array(nFrames) };
  const centroid = new Float32Array(nFrames);
  const chroma = new Float32Array(nFrames * 12);
  // 每個 bin 屬於哪個音級（60 Hz～5 kHz 才算）
  const pc = new Int8Array(bins).fill(-1);
  for (let k = 1; k < bins; k++) { const f = k * binHz; if (f >= 60 && f <= 5000) pc[k] = ((Math.round(12 * Math.log2(f / 440)) % 12) + 12 + 9) % 12; }
  let prevLog = new Float32Array(bins), curLog = new Float32Array(bins);
  const sumRange = (arr: Float32Array, [a, b]: [number, number]) => { let s = 0; for (let k = a; k <= b; k++) s += arr[k]!; return s; };
  const magSq = new Float32Array(bins);

  for (let f = 0; f < nFrames; f++) {
    const c0 = f * hop - N / 2;
    for (let i = 0; i < N; i++) { const j = c0 + i; re[i] = j >= 0 && j < x.length ? x[j]! * hann[i]! : 0; im[i] = 0; }
    fft.run(re, im);
    let tot = 0, cw = 0, totMag = 0;
    for (let k = 0; k < bins; k++) {
      const m2 = re[k]! * re[k]! + im[k]! * im[k]!;
      magSq[k] = m2; tot += m2; cw += Math.sqrt(m2) * k * binHz; totMag += Math.sqrt(m2);
      const mag = Math.sqrt(m2);
      curLog[k] = Math.log1p(100 * mag);
      if (pc[k]! >= 0) chroma[f * 12 + pc[k]!]! += mag;
    }
    pow.all[f] = tot;
    for (const key of ['low', 'bass', 'mid', 'vocal', 'high', 'other'] as const) pow[key][f] = sumRange(magSq, B[key]);
    centroid[f] = totMag > 1e-9 ? cw / totMag : 0;
    // 頻譜通量：跟上一格「附近三個 bin 的最大值」比（superflux 的簡化，抖音不會被當成 onset）
    if (f > 0) {
      let fa = 0, fl = 0, fs = 0, fh = 0, fv = 0;
      for (let k = 1; k < bins - 1; k++) {
        const ref = Math.max(prevLog[k - 1]!, prevLog[k]!, prevLog[k + 1]!);
        const d = curLog[k]! - ref;
        if (d <= 0) continue;
        fa += d;
        if (k >= B.low[0] && k <= B.low[1]) fl += d;
        if (k >= B.snare[0] && k <= B.snare[1]) fs += d;
        if (k >= B.hat[0] && k <= B.hat[1]) fh += d;
        if (k >= B.vocal[0] && k <= B.vocal[1]) fv += d;
      }
      flux.all[f] = fa; flux.low[f] = fl; flux.snare[f] = fs; flux.hat[f] = fh; flux.vocal[f] = fv;
    }
    [prevLog, curLog] = [curLog, prevLog];
    if (f % 2000 === 0) progress?.(0.05 + 0.6 * (f / nFrames), '頻譜分析');
  }

  progress?.(0.68, '找節拍');
  const dB = (p: Float32Array) => p.map((v) => 10 * Math.log10(v + 1e-10));
  const onsetAll = normPct(flux.all, 0.99);
  // 追拍用的 onset 加重低頻：大鼓多半落在正拍，高頻的鈸、切分的合成器常在反拍，只看全頻很容易整段被吸到反拍去
  const lowN = normPct(flux.low, 0.99);
  const lw = tune.lowWeight ?? 0.25;
  const onsetBeat = onsetAll.map((v, i) => (1 - lw) * v + lw * lowN[i]!);
  const bpm0 = estimateTempo(onsetBeat, fps);
  // 先用粗估的速度追一次，再用追到的拍點回歸出精確速度重追（粗估差 1% 追久了就會漂）
  let beats = trackBeats(onsetBeat, fps, bpm0, tune.tightness ?? 300);
  const fitBpm = (bs: number[]) => {
    if (bs.length < 8) return bpm0;
    // 拍號 i 對時間 t 的最小平方直線；斜率就是一拍幾秒
    const n = bs.length, mi = (n - 1) / 2, mt = mean(bs);
    let sxy = 0, sxx = 0;
    bs.forEach((t, i) => { sxy += (i - mi) * (t - mt); sxx += (i - mi) ** 2; });
    return 60 / (sxy / sxx);
  };
  const bpm1 = fitBpm(beats);
  if (Math.abs(bpm1 - bpm0) / bpm0 < 0.08) beats = trackBeats(onsetBeat, fps, bpm1, tune.tightness ?? 300);
  if (beats.length < 8) {
    // 幾乎沒有節奏（純鋼琴、環境音）：用估出來的速度鋪一個均勻的網格
    const p = 60 / bpm0; beats = [];
    for (let t = 0.1; t < duration; t += p) beats.push(+t.toFixed(3));
  }
  // 次格精修：每一拍往附近（±30 ms）onset 最強的地方靠，再用拋物線內插到毫秒
  beats = beats.map((b) => {
    const i = Math.round(b * fps);
    let bi = i;
    for (let k = i - 3; k <= i + 3; k++) if (k > 0 && k < onsetAll.length - 1 && onsetAll[k]! > onsetAll[bi]!) bi = k;
    if (bi <= 0 || bi >= onsetAll.length - 1 || onsetAll[bi]! < 0.15) return b;
    const a = onsetAll[bi - 1]!, c = onsetAll[bi + 1]!, m = onsetAll[bi]!, den = a - 2 * m + c;
    const off = den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
    return (bi + off) / fps;
  });
  const bpm = fitBpm(beats);

  progress?.(0.78, '找小節');
  const fluxLowN = normPct(flux.low, 0.99), fluxSnN = normPct(flux.snare, 0.99);
  const at = (arr: Float32Array, t: number) => { const i = Math.round(t * fps); let m = 0; for (let k = i - 2; k <= i + 2; k++) if (k >= 0 && k < arr.length) m = Math.max(m, arr[k]!); return m; };
  // 拍與拍之間的平均和聲（色度），比較相鄰兩拍有沒有換和弦
  const beatChroma = beats.map((b, i) => {
    const f0 = Math.round(b * fps), f1 = Math.round((beats[i + 1] ?? b + 60 / bpm) * fps);
    const v = new Float32Array(12);
    for (let f = Math.max(0, f0); f < Math.min(nFrames, f1); f++) for (let k = 0; k < 12; k++) v[k]! += chroma[f * 12 + k]!;
    const nrm = Math.hypot(...v) || 1;
    return v.map((q) => q / nrm);
  });
  const chordChange = beatChroma.map((v, i) => (i === 0 ? 0 : 1 - v.reduce((s, q, k) => s + q * beatChroma[i - 1]![k]!, 0)));
  // 每一拍前後各一拍的音量差（只算變大的）
  const rmsDb = normDb(dB(pow.all));
  const lift = beats.map((b, i) => { const p = beats[i + 1] !== undefined ? beats[i + 1]! - b : 60 / bpm; const f = Math.round(b * fps), w = Math.max(2, Math.round(p * fps)); return Math.max(0, mean(rmsDb, f, Math.min(nFrames, f + w)) - mean(rmsDb, Math.max(0, f - w), f)); });
  const downbeats = trackBars(beats, beats.map((b) => at(fluxLowN, b)), beats.map((b) => at(fluxSnN, b)), chordChange, lift, tune).map((i) => beats[i]!);

  progress?.(0.85, '找段落');
  const rmsEnv = normDb(dB(pow.all));
  const sections = findSections(downbeats, duration, fps, rmsEnv, normDb(dB(pow.high)), normPct(flux.all, 0.95), chroma, nFrames, tune.secK ?? -0.25);

  progress?.(0.93, '整理');
  // 輸出的包絡：50 fps（兩格平均），打得快收得慢
  const toOut = (a: Float32Array) => {
    const r = fps / OUT_FPS, n = Math.floor(a.length / r), o = new Float32Array(n);
    for (let i = 0; i < n; i++) { const i0 = Math.floor(i * r), i1 = Math.max(i0 + 1, Math.floor((i + 1) * r)); o[i] = mean(a, i0, Math.min(a.length, i1)); }
    return packFeature(attackRelease(o, OUT_FPS));
  };
  const features: Record<string, string> = {
    rms: toOut(rmsEnv), low: toOut(normDb(dB(pow.low))), mid: toOut(normDb(dB(pow.mid))), high: toOut(normDb(dB(pow.high))),
    vocal: toOut(normDb(dB(pow.vocal))), drums: toOut(normPct(flux.all, 0.97)), bass: toOut(normDb(dB(pow.bass))), other: toOut(normDb(dB(pow.other))),
  };
  const onsets = {
    kick: pickPeaks(normPct(flux.low, 0.99), fps, { delta: 0.08, minGap: 0.09, floor: 0.12 }),
    snare: pickPeaks(normPct(flux.snare, 0.99), fps, { delta: 0.07, minGap: 0.08, floor: 0.12 }),
    hat: pickPeaks(normPct(flux.hat, 0.99), fps, { delta: 0.05, minGap: 0.05, floor: 0.1 }),
    vocal: pickPeaks(normPct(flux.vocal, 0.99), fps, { delta: 0.06, minGap: 0.08, floor: 0.1 }),
  };
  // 整首歌的平均響度（有聲音的格子）與亮度
  const dbAll = dB(pow.all).map((v) => v - 20 * Math.log10(N / 2));
  const loud = dbAll.filter((v) => v > percentile(dbAll, 0.99) - 40);
  const loudness = loud.length ? 10 * Math.log10(mean(loud.map((v) => 10 ** (v / 10)))) : -30;
  const bright = percentile(Array.from(centroid).filter((_, i) => rmsEnv[i]! > 0.3), 0.5);

  progress?.(1, '完成');
  return {
    version: ANALYSIS_VERSION,
    duration: +duration.toFixed(3),
    bpm: +bpm.toFixed(3),
    fps: OUT_FPS,
    beats: beats.map((b) => +b.toFixed(3)),
    downbeats: downbeats.map((b) => +b.toFixed(3)),
    sections,
    features,
    onsets,
    loudness: +loudness.toFixed(2),
    brightness: Math.round(bright || 2000),
  };
}

/**
 * 段落：以小節為單位，比較每個小節線前後四小節的能量、亮度、活動量與和聲，變化大的地方切開。
 * 段落邊界偏好落在第 4、8 小節（流行歌大多四小節一句），太短的段落併回前一段。
 */
function findSections(downbeats: number[], duration: number, fps: number, rms: Float32Array, high: Float32Array, act: Float32Array, chroma: Float32Array, nFrames: number, secK = 0): Section[] {
  const nb = downbeats.length;
  if (nb < 8) return [{ name: 'part1', start: 0, end: duration, energy: +clamp01(mean(rms) * 0.8 + mean(act) * 0.6).toFixed(3) }];
  const bars = downbeats.map((d, i) => {
    const f0 = Math.max(0, Math.round(d * fps)), f1 = Math.min(nFrames, Math.round((downbeats[i + 1] ?? duration) * fps));
    const ch = new Float32Array(12);
    for (let f = f0; f < f1; f++) for (let k = 0; k < 12; k++) ch[k]! += chroma[f * 12 + k]!;
    const nrm = Math.hypot(...ch) || 1;
    return { rms: mean(rms, f0, f1), high: mean(high, f0, f1), act: mean(act, f0, f1), ch: ch.map((q) => q / nrm) };
  });
  const W = 4;
  const nov = new Float32Array(nb);
  for (let i = W; i <= nb - W; i++) {
    const a = bars.slice(i - W, i), b = bars.slice(i, i + W);
    const avg = (xs: typeof bars, k: 'rms' | 'high' | 'act') => xs.reduce((s, q) => s + q[k], 0) / xs.length;
    const cha = new Float32Array(12), chb = new Float32Array(12);
    for (const q of a) for (let k = 0; k < 12; k++) cha[k]! += q.ch[k]!;
    for (const q of b) for (let k = 0; k < 12; k++) chb[k]! += q.ch[k]!;
    const cos = cha.reduce((s, v, k) => s + v * chb[k]!, 0) / ((Math.hypot(...cha) * Math.hypot(...chb)) || 1);
    nov[i] = 1.4 * Math.abs(avg(b, 'rms') - avg(a, 'rms')) + 0.8 * Math.abs(avg(b, 'high') - avg(a, 'high')) + 1.0 * Math.abs(avg(b, 'act') - avg(a, 'act')) + 0.8 * (1 - cos);
    // 四小節、八小節的位置加分（流行歌的句子長度）
    nov[i]! *= i % 8 === 0 ? 1.25 : i % 4 === 0 ? 1.12 : i % 2 === 0 ? 0.95 : 0.8;
  }
  const vals = Array.from(nov).filter((v) => v > 0);
  const thr = mean(vals) + secK * Math.sqrt(mean(vals.map((v) => (v - mean(vals)) ** 2)));
  const cuts: number[] = [0];
  for (let i = W; i <= nb - W; i++) {
    if (nov[i]! < thr) continue;
    if (nov[i]! < (nov[i - 1] ?? 0) || nov[i]! < (nov[i + 1] ?? 0)) continue;
    if (i - cuts[cuts.length - 1]! < 4) {
      // 太近：留分數高的那個
      const last = cuts[cuts.length - 1]!;
      if (last > 0 && nov[i]! > nov[last]!) cuts[cuts.length - 1] = i;
      continue;
    }
    cuts.push(i);
  }
  const bounds = cuts.map((i) => (i === 0 ? 0 : downbeats[i]!));
  // 第一個小節線前有一段（前奏的弱起）：併進第一段
  const secs: Section[] = [];
  for (let k = 0; k < bounds.length; k++) {
    const i0 = cuts[k]!, i1 = cuts[k + 1] ?? nb;
    const s = bars.slice(i0, i1);
    const e = s.reduce((acc, q) => acc + q.rms * 0.55 + q.act * 0.45, 0) / Math.max(1, s.length);
    secs.push({ name: '', start: +bounds[k]!.toFixed(3), end: +(k + 1 < bounds.length ? bounds[k + 1]! : duration).toFixed(3), energy: e });
  }
  // 能量：一半看整首歌裡的相對高低（副歌一定比主歌亮），一半看絕對值（整首抒情歌就是安靜）
  const es = secs.map((s) => s.energy), lo = Math.min(...es), hi = Math.max(...es);
  secs.forEach((s, i) => {
    const rel = hi > lo ? (s.energy - lo) / (hi - lo) : 0.5;
    s.energy = +clamp01(0.55 * rel + 0.45 * clamp01(s.energy * 1.4)).toFixed(3);
    s.name = i === 0 && s.energy < 0.45 ? 'intro' : i === secs.length - 1 && s.energy < 0.45 ? 'outro' : `part${i + 1}`;
  });
  return secs;
}
