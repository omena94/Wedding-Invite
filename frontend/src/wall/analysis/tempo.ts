// 速度修正：自動分析偶爾會把慢歌聽成兩倍速（八分音符很密的抒情歌），或把快歌聽成一半。
// 後台的「速度減半／加倍」直接改存好的分析結果（拍點、小節線、BPM），不用重新分析。
import type { AudioJSON } from '../engine/audio';

/** 速度減半：每兩拍留一拍（保留小節線上的那些），每兩個小節線留一個。 */
export function halveTempo(j: AudioJSON): AudioJSON {
  const first = j.downbeats[0] ?? j.beats[0] ?? 0;
  const k0 = Math.max(0, j.beats.findIndex((b) => Math.abs(b - first) < 1e-3));
  const beats = j.beats.filter((_, i) => (i - k0) % 2 === 0);
  const downbeats = j.downbeats.filter((_, i) => i % 2 === 0);
  return { ...j, beats, downbeats, bpm: +(j.bpm / 2).toFixed(3), tempoFix: ((j as any).tempoFix ?? 1) / 2 } as AudioJSON;
}

/** 速度加倍：每兩拍中間補一拍，小節線中間也補一條。 */
export function doubleTempo(j: AudioJSON): AudioJSON {
  const mid = (a: number[]) => a.flatMap((b, i) => (i + 1 < a.length ? [b, +((b + a[i + 1]!) / 2).toFixed(3)] : [b]));
  return { ...j, beats: mid(j.beats), downbeats: mid(j.downbeats), bpm: +(j.bpm * 2).toFixed(3), tempoFix: ((j as any).tempoFix ?? 1) * 2 } as AudioJSON;
}
