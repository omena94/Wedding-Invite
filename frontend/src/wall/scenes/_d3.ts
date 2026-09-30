// 批次 D3（雙語・語言與遠距）共用：換姿勢時「臉不跳」。
// Codex 畫的坐姿，每張的人在畫布裡的位置、大小都有一點不一樣（坐著沒有腳底可以對齊，腳底錨點一換圖頭就跳），
// 所以每張圖在 sprites.json 量一個 face 點（臉的中心、半徑 = 臉的大小，同一個人的幾張用樣板比對量的），
// 版面換圖時把每一張的臉對到「基準姿勢」的臉：位移＋縮放，桌子擋住下半身，看起來就是同一個人換了動作。
import { drawPuppet, puppetPoint, FADE, type PuppetOpts } from './_puppet';

export interface Lock { dx: number; dy: number; s: number }

/**
 * 算每張圖對齊到基準姿勢的位移與縮放（在 init 算一次；跟 render 用同一組 x、y、opts，rot 用 0）。
 * 沒有 face 點的圖不動（dx = dy = 0、s = 1）。
 */
export function faceLocks(names: readonly string[], base: string, x: number, y: number, o: PuppetOpts): Map<string, Lock> {
  const out = new Map<string, Lock>();
  const b = puppetPoint(base, 'face', x, y, o);
  for (const n of new Set(names)) {
    const p = puppetPoint(n, 'face', x, y, o);
    if (!b || !p || !p.r || !b.r) { out.set(n, { dx: 0, dy: 0, s: 1 }); continue; }
    const s = b.r / p.r;
    // 縮放是繞腳底（x, y）：先算縮放之後的臉在哪，再位移到基準的臉
    const q = puppetPoint(n, 'face', x, y, { ...o, scale: (o.scale ?? 1) * s })!;
    out.set(n, { dx: b.x - q.x, dy: b.y - q.y, s });
  }
  return out;
}

/** 照時間軸換姿勢（跟 drawPick 一樣，換圖時舊的一張淡出 FADE 秒），每張照 faceLocks 對齊。回傳這一格的圖名。 */
export function drawLocked(c: CanvasRenderingContext2D, keys: readonly (readonly [number, string])[], t: number, x: number, y: number, o: PuppetOpts, locks: Map<string, Lock>): string {
  let k = 0;
  for (let i = 0; i < keys.length; i++) if (t >= keys[i]![0]) k = i;
  const one = (n: string, alpha: number) => {
    const L = locks.get(n) ?? { dx: 0, dy: 0, s: 1 };
    drawPuppet(c, n, x + L.dx, y + L.dy, { ...o, scale: (o.scale ?? 1) * L.s, alpha });
  };
  const cur = keys[k]![1];
  one(cur, o.alpha ?? 1);
  if (k > 0) {
    const since = t - keys[k]![0], prev = keys[k - 1]![1];
    if (since < FADE && prev !== cur) one(prev, (o.alpha ?? 1) * (1 - since / FADE));
  }
  return cur;
}

/** 對齊之後，圖上某個道具點在畫面上的位置（擊掌的手、單字卡）。 */
export function lockedPoint(name: string, key: string, x: number, y: number, o: PuppetOpts, locks: Map<string, Lock>) {
  const L = locks.get(name) ?? { dx: 0, dy: 0, s: 1 };
  return puppetPoint(name, key, x + L.dx, y + L.dy, { ...o, scale: (o.scale ?? 1) * L.s });
}
