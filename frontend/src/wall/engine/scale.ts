// 輸出解析度倍率，開頁時從網址讀一次（`?scale=0.75` 給比較弱的會場筆電省力，`?scale=2` 是 4K）。
// 版面一律用 1920x1080 的「邏輯像素」排，引擎自己乘上 SCALE。
// 放在獨立模組，是為了讓 glsl/common.ts 能用它又不會跟 gl.ts 互相 import。
// pdoom 只允許整數倍；大螢幕要能在內顯筆電上跑，所以多開放 0.5～0.75 的小數倍（以 0.25 為一級）。
function readScale() {
  if (typeof location === 'undefined') return 1;
  const raw = Number(new URLSearchParams(location.search).get('scale') ?? '1');
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(2, Math.max(0.5, Math.round(raw * 4) / 4));
}

/** 每個邏輯像素對應幾個實體像素（0.5～2，預設 1）。 */
export const SCALE = readScale();
