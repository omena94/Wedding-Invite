// 批次 T2（紙本 B：postcard、ticket、menu、librarycard、recipe、patent）共用的小工具。
// 六個版面的手法各不相同（3D 翻面、凸版印刷的光影、直排、大理石紋內頁、景深、繪圖機的線稿），
// 共用的只有「亮紙上的跟唱配色」「小圖層貼到畫面的哪裡」「fast 圖層在自己的 shader 裡怎麼解」這幾件小事，
// 放在一起是為了讓六張紙的墨色、跟唱規則一致。時間骨架（第一拍、小節線）用 _t5 的 grid，標籤用 _t11 的 mono/tag。
import { W, H } from '../engine/gl';
import { rgba } from '../engine/palette';
import type { LyricStyle } from './_motifs';

export { grid, windowLines, lineState, pop, settle, lastOf, type Grid } from './_t5';
export { mono, tag, stagger, bbox, pad3, HUD, EDGE, type Rect } from './_t11';

/**
 * 亮紙上的跟唱配色：正在唱是訊號色的暗部（淡的訊號色──香檳、鼠尾草──在奶茶色紙上讀不到），
 * 唱完是墨色，還沒唱是三成的墨。
 */
export const paperLyric = (): Pick<LyricStyle, 'active' | 'sung' | 'unsung'> => ({
  active: rgba('blood'), sung: rgba('sepia', 0.95), unsung: rgba('sepia', 0.28),
});

/** 沒有主打留言時的邀請（各版面自己改寫成那張紙的口吻，這句是最短的版本）。 */
export const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';

/**
 * 把一張 w×h 的小圖層（Layer2D(w, h)）用 comp.draw 貼到畫面的 (x, y)（左上角，邏輯像素）。
 * 用法：`comp.draw(renderer, layer.upload(), out, subRect(x, y, w, h))`。只上傳小圖層比整張畫布便宜。
 */
export function subRect(x: number, y: number, w: number, h: number) {
  return {
    scale: [W / w, H / h] as [number, number],
    offset: [(0.5 * W - x) / w - 0.5, (y + 0.5 * h - 0.5 * H) / h] as [number, number],
  };
}

/**
 * GLSL：讀 fast 的 Layer2D（預乘、sRGB 編碼）→ 線性、非預乘的顏色與覆蓋率。
 * 自己的 shader 要把 Canvas2D 的字貼到 3D 面上、或當成墨的遮罩時用（comp.draw 會自己解，不用這個）。
 */
export const FAST_TEX_GLSL = /* glsl */ `
vec4 fastTex(sampler2D s, vec2 uv) {
  vec4 c = texture(s, uv);
  return c.a > 0.0 ? vec4(toLinear(c.rgb / c.a), c.a) : vec4(0.0);
}`;
