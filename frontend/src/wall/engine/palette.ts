import { hexToLinear } from './util';

// 大螢幕的配色（照 pdoom-video 的做法：一個底色、一個紙白、一個會發光的訊號色，再加一個很少出現的點綴色）。
// pdoom 整支影片只有一組色；婚禮一晚要播 30 幾首，所以每首歌換一組「主題」（themes.ts 挑），
// 但每組都守同樣的規則：只有 signal/ember 可以發光（>0.85 linear），點綴色只給愛心，紙白的字不發光。
// HEX / LIN 是可變的：換歌時 setTheme() 就地改值，場景每一格讀到的就是新顏色（rgba('signal') 也一樣）。
// GLSL 裡的 C_SIGNAL 等是 uniform（見 glsl/common.ts 與 gl.ts 的 THEME_UNIFORMS），不用重編 shader。
export const HEX = {
  ink: '#0B0A09', // 底色：帶一點暖的黑
  ink2: '#17140F', // 浮起來的黑（面板、暗處的紙）
  graphite: '#5F5850', // 暗線、次要文字
  ash: '#A1978A', // 中灰
  bone: '#F2EBDF', // 紙白、主要文字
  signal: '#FFB547', // 訊號色（預設燭光金）：火花、跟唱中的字、重點
  ember: '#FFD98C', // 更熱更亮的訊號色（火花核心、高光）
  blood: '#9C5A1A', // 訊號色的暗部
  rose: '#F0788A', // 點綴色：只給愛心
  paper: '#F1E7D8', // 亮版面的紙（預設奶茶色）
  sepia: '#3B2C20', // 紙上的墨（深咖啡，亮版面的字與線）
};

export type PaletteKey = keyof typeof HEX;

/** GL 用的 linear RGB（跟 HEX 同步，換主題時就地更新）。 */
export const LIN = {} as Record<PaletteKey, [number, number, number]>;
function syncLin() {
  for (const [k, v] of Object.entries(HEX)) {
    const lin = hexToLinear(v);
    const cur = LIN[k as PaletteKey];
    // 就地改陣列內容：有場景把 LIN.signal 這個陣列存起來用也會跟著變
    if (cur) { cur[0] = lin[0]; cur[1] = lin[1]; cur[2] = lin[2]; } else LIN[k as PaletteKey] = lin;
  }
}
syncLin();

const listeners: (() => void)[] = [];
/** 換色時要一起更新的東西（例如 GLSL 的主題 uniform）。 */
export function onPaletteChange(fn: () => void) { listeners.push(fn); fn(); }

/** 套用一組顏色（只改有給的鍵）。 */
export function setPalette(p: Partial<Record<PaletteKey, string>>) {
  for (const [k, v] of Object.entries(p)) if (v && k in HEX) (HEX as Record<string, string>)[k] = v;
  syncLin();
  for (const fn of listeners) fn();
}

/** Canvas2D 用的 CSS rgba()。 */
export function rgba(key: PaletteKey | string, a = 1): string {
  const hex = (HEX as Record<string, string>)[key] ?? key;
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** 兩個色票之間的混色（Canvas2D 用）。 */
export function mixRgba(a: PaletteKey | string, b: PaletteKey | string, k: number, alpha = 1): string {
  const pa = rgba(a).match(/\d+/g)!.map(Number), pb = rgba(b).match(/\d+/g)!.map(Number);
  return `rgba(${[0, 1, 2].map((i) => Math.round(pa[i]! + (pb[i]! - pa[i]!) * k)).join(',')},${alpha})`;
}
