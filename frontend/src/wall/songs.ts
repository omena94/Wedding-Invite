// 歌單：把一首歌需要的東西都準備好（音檔、節拍分析、歌詞、配色主題），交給播放器與引擎。
// 分析優先用後台存好的；沒有、或演算法改版了，就在這台電腦上重新分析並存回去（下次就不用再算）。
import { AudioData, type AudioJSON } from './engine/audio';
import { Lyrics } from './engine/lyrics';
import type { SongRuntime } from './engine/engine';
import { buildLyrics } from './lyrics/build';
import { analyzeArrayBuffer, ANALYSIS_VERSION } from './analysis/client';
import { fetchAnalysis, fetchAudio, saveAnalysis, type SongRow } from './net';
import { pickTheme, themeByKey } from './themes';

export interface LoadedSong {
  row: SongRow;
  runtime: SongRuntime;
  blob: Blob;
  /** 播放範圍（秒）：後台可以剪掉前奏、尾奏。 */
  startAt: number;
  endAt: number;
  /** 把這首歌的音量拉到跟其他歌差不多（線性倍數）。 */
  gain: number;
}

/** 目標響度（dBFS RMS）：大部分流行歌母帶在 -10～-14，拉齊到 -14，太小聲的最多放大 2 倍。 */
const TARGET_DB = -14;

export function gainFor(loudness: number): number {
  return Math.min(2, Math.max(0.35, 10 ** ((TARGET_DB - loudness) / 20)));
}

/**
 * 準備一首歌。`status` 回報進度（顯示在操作列上）。`index`/`count` 是它在歌單裡的位置，
 * `prevTheme` 用來避免跟上一首同色。
 */
export async function loadSong(row: SongRow, index: number, count: number, prevTheme: string, status: (s: string) => void = () => {}, opts: { save?: boolean; fetchBlob?: (row: SongRow) => Promise<Blob>; analysis?: AudioJSON | null } = {}): Promise<LoadedSong> {
  status(`下載「${row.title}」`);
  const blob = opts.fetchBlob ? await opts.fetchBlob(row) : await fetchAudio(row.id, row.updated_at);
  let json: AudioJSON | null = opts.analysis ?? null;
  if (!json && opts.save !== false) {
    const a = await fetchAnalysis(row.id).catch(() => null);
    if (a && a.version === ANALYSIS_VERSION && a.data) json = a.data as AudioJSON;
  }
  if (!json) {
    json = await analyzeArrayBuffer(await blob.arrayBuffer(), (p, label) => status(`分析「${row.title}」：${label} ${Math.round(p * 100)}%`));
    if (opts.save !== false) {
      saveAnalysis(row.id, { version: ANALYSIS_VERSION, duration: json.duration, bpm: json.bpm, data: json }).catch(() => { /* 存不回去（沒權限、斷線）也照樣播 */ });
    }
  }
  const audio = new AudioData(json);
  const startAt = Math.max(0, Math.min(row.start_at || 0, audio.duration - 10));
  const endAt = row.end_at && row.end_at > startAt + 10 ? Math.min(row.end_at, audio.duration) : audio.duration;
  // 導演與引擎用 duration 當這首歌的結尾：剪掉尾奏就是改這裡
  audio.duration = endAt;
  const lyrics = row.instrumental || !row.lyrics_lrc ? Lyrics.empty() : buildLyrics(row.lyrics_lrc, audio, row.lyrics_offset || 0);
  const theme = themeByKey(row.theme) ? row.theme : pickTheme(audio, row.id, prevTheme ? [prevTheme] : []);
  return {
    row, blob, startAt, endAt, gain: gainFor(audio.loudness),
    runtime: { info: { id: row.id, title: row.title, artist: row.artist, index, count, theme }, audio, lyrics },
  };
}
