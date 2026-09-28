// 每首歌的配色主題。pdoom 整支影片一組色；婚禮一晚 30 幾首，全部同色會膩，所以每首歌換一組，
// 但只換「訊號色」這一家子（火花、跟唱的字、重點）和亮版面的紙色，底色、紙白、版面語言不變，看起來還是同一部作品。
// 沒指定的歌依節奏與能量自動挑（快歌熱鬧的顏色、慢歌溫暖的顏色），相鄰兩首不重複；後台可以每首指定。
import { setPalette, type PaletteKey } from './engine/palette';
import type { AudioData } from './engine/audio';
import { hash } from './engine/util';

export interface Theme { key: string; label: string; colors: Partial<Record<PaletteKey, string>>; energy: number; tempo: number }

export const THEMES: Theme[] = [
  { key: 'gold', label: '燭光金', energy: 0.4, tempo: 85,
    colors: { ink: '#0B0A09', ink2: '#17140F', signal: '#FFB547', ember: '#FFD98C', blood: '#9C5A1A', rose: '#F0788A', paper: '#F1E7D8', sepia: '#3B2C20' } },
  { key: 'champagne', label: '香檳', energy: 0.25, tempo: 72,
    colors: { ink: '#0A0A0A', ink2: '#161512', signal: '#F2D19B', ember: '#FFF0D4', blood: '#8C6A3C', rose: '#F0788A', paper: '#F3EDE3', sepia: '#3A3024' } },
  { key: 'rose', label: '玫瑰', energy: 0.55, tempo: 100,
    colors: { ink: '#0D090A', ink2: '#1A1214', signal: '#FF7F93', ember: '#FFC4CD', blood: '#A33650', rose: '#FFD08A', paper: '#F5E6E4', sepia: '#43262B' } },
  { key: 'sage', label: '鼠尾草', energy: 0.45, tempo: 95,
    colors: { ink: '#090B0A', ink2: '#121613', signal: '#A8D5A2', ember: '#E1F4DC', blood: '#3F7446', rose: '#F59AA5', paper: '#EBEFE6', sepia: '#25332A' } },
  { key: 'lilac', label: '薰衣草', energy: 0.62, tempo: 110,
    colors: { ink: '#09090D', ink2: '#131219', signal: '#B99BFF', ember: '#E4D9FF', blood: '#5E43A8', rose: '#FF8FA8', paper: '#EEEAF4', sepia: '#2E2638' } },
  { key: 'coral', label: '珊瑚', energy: 0.8, tempo: 125,
    colors: { ink: '#0B0908', ink2: '#171210', signal: '#FF6F4E', ember: '#FFB59E', blood: '#A5311C', rose: '#FF9EB5', paper: '#F6E8E0', sepia: '#40241B' } },
];

export const themeByKey = (k: string) => THEMES.find((t) => t.key === k);

/** 整首歌的平均能量（段落能量依長度加權）。 */
export function songEnergy(au: AudioData): number {
  let s = 0, w = 0;
  for (const sec of au.sections) { const d = sec.end - sec.start; s += sec.energy * d; w += d; }
  return w ? s / w : 0.5;
}

/**
 * 自動挑主題：能量與速度最接近的，避開上一首用過的；同分時用歌的 id 當種子，每次開都一樣。
 */
export function pickTheme(au: AudioData, songId: number, avoid: string[] = []): string {
  const e = songEnergy(au);
  // 速度有「聽成兩倍／一半」的問題：折到 70～140 之間再比
  let bpm = au.bpm || 100;
  while (bpm > 140) bpm /= 2;
  while (bpm < 70) bpm *= 2;
  let best = THEMES[0]!.key, bestScore = -Infinity;
  for (const th of THEMES) {
    if (avoid.includes(th.key)) continue;
    const sc = -(Math.abs(e - th.energy) * 2.2 + Math.abs(bpm - th.tempo) / 55) + hash(songId, th.key.length * 7) * 0.35;
    if (sc > bestScore) { bestScore = sc; best = th.key; }
  }
  return best;
}

/** 套用主題（換歌時呼叫；所有 shader 與 Canvas2D 的顏色馬上跟著變）。 */
export function applyTheme(key: string) {
  const th = themeByKey(key) ?? THEMES[0]!;
  setPalette(th.colors);
  return th.key;
}
