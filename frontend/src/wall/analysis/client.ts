// 分析的入口：把音檔（mp3 / m4a / mp4…）解碼成單聲道，丟給背景執行緒分析。
// 後台上傳歌的時候用（檔案就在手上，不用再下載），大螢幕遇到還沒分析、或演算法改版的歌也會自己補做。
import type { AudioJSON } from '../engine/audio';
import { ANALYSIS_VERSION } from './analyze';

export { ANALYSIS_VERSION };

/** 解碼音檔並混成單聲道（decodeAudioData 會自動重新取樣成 44.1 kHz）。影片檔只取聲音。 */
export async function decodeToMono(buf: ArrayBuffer): Promise<{ pcm: Float32Array; sr: number; duration: number }> {
  const Ctx = window.OfflineAudioContext;
  const ctx = new Ctx(1, 1, 44100);
  const audio = await ctx.decodeAudioData(buf.slice(0));
  const n = audio.length, ch = audio.numberOfChannels;
  const pcm = new Float32Array(n);
  for (let c = 0; c < ch; c++) { const d = audio.getChannelData(c); for (let i = 0; i < n; i++) pcm[i]! += d[i]! / ch; }
  return { pcm, sr: audio.sampleRate, duration: audio.duration };
}

/** 分析一個已經讀進來的音檔。onProgress(0..1, 說明)。 */
export async function analyzeArrayBuffer(buf: ArrayBuffer, onProgress?: (p: number, label: string) => void): Promise<AudioJSON> {
  onProgress?.(0, '解碼音檔');
  let decoded;
  try { decoded = await decodeToMono(buf); }
  catch { throw new Error('這個檔案讀不出聲音，請改用 mp3 或 m4a'); }
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') onProgress?.(0.05 + 0.95 * m.p, m.label);
      else if (m.type === 'done') { w.terminate(); resolve(m.out as AudioJSON); }
      else if (m.type === 'error') { w.terminate(); reject(new Error(m.error)); }
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || '分析失敗')); };
    w.postMessage({ pcm: decoded.pcm, sr: decoded.sr }, [decoded.pcm.buffer]);
  });
}

/** 分析使用者選的檔案（後台上傳用）。 */
export async function analyzeFile(file: Blob, onProgress?: (p: number, label: string) => void): Promise<AudioJSON> {
  return analyzeArrayBuffer(await file.arrayBuffer(), onProgress);
}
