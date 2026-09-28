// 批次 T9（機器 C：jukebox、clawmachine、marquee、neon、dashboard、metronome）共用的小工具。
//  - 很小的「點陣畫布」：一個點 = 一個像素的 Canvas，給 LED 點陣、霓虹管取樣用（貼圖小，每格上傳很便宜）
//  - 5×7 點陣字（拉丁字母、數字、幾個符號）：跑馬燈上方那條小字、儀表板的讀數。中文太複雜，5×7 畫不出來，一律用字型光柵化。
//  - 進出場係數、窗格裡的歌詞行
import * as THREE from 'three';
import type { Lyrics, Line } from '../engine/lyrics';
import { clamp } from '../engine/util';
import { rgba } from '../engine/palette';
import { drawHeart } from '../engine/motifs';

export type Rect = [number, number, number, number];

/**
 * 小畫布＋貼圖（不經過 Layer2D：Layer2D 會把畫布放大 SCALE 倍，點陣要的是「一格一個像素」）。
 * 用 premultiplied 上傳：shader 讀到的 rgb 就是「顏色 × 覆蓋率」，可以直接當亮度用。
 */
export class DotCanvas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  constructor(public w: number, public h: number, filter: THREE.MagnificationTextureFilter = THREE.NearestFilter) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.premultiplyAlpha = true;
    // flipY 關掉：shader 用 texelFetch(ivec2(x, y)) 讀，y 跟畫布一樣是由上往下
    this.texture.flipY = false;
    this.texture.minFilter = filter as THREE.MinificationTextureFilter;
    this.texture.magFilter = filter;
    this.texture.generateMipmaps = false;
  }
  clear() { const c = this.ctx; c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, this.w, this.h); }
  upload() { this.texture.needsUpdate = true; return this.texture; }
  dispose() { this.texture.dispose(); this.canvas.width = this.canvas.height = 0; }
}

// ---------------------------------------------------------------- 5×7 點陣字
// 每個字 7 列、每列 5 格（# = 亮）。照老式 LCD／LED 模組的字形自己畫的。
const G5: Record<string, string> = {
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#', B: '####.|#...#|#...#|####.|#...#|#...#|####.',
  C: '.###.|#...#|#....|#....|#....|#...#|.###.', D: '###..|#..#.|#...#|#...#|#...#|#..#.|###..',
  E: '#####|#....|#....|####.|#....|#....|#####', F: '#####|#....|#....|####.|#....|#....|#....',
  G: '.###.|#...#|#....|#.###|#...#|#...#|.####', H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  I: '.###.|..#..|..#..|..#..|..#..|..#..|.###.', J: '..###|...#.|...#.|...#.|...#.|#..#.|.##..',
  K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#', L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#', N: '#...#|#...#|##..#|#.#.#|#..##|#...#|#...#',
  O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.', P: '####.|#...#|#...#|####.|#....|#....|#....',
  Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#', R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S: '.####|#....|#....|.###.|....#|....#|####.', T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.', V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  W: '#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.', X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..', Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  '0': '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.', '1': '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
  '2': '.###.|#...#|....#|...#.|..#..|.#...|#####', '3': '#####|...#.|..#..|...#.|....#|#...#|.###.',
  '4': '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.', '5': '#####|#....|####.|....#|....#|#...#|.###.',
  '6': '..##.|.#...|#....|####.|#...#|#...#|.###.', '7': '#####|....#|...#.|..#..|.#...|.#...|.#...',
  '8': '.###.|#...#|#...#|.###.|#...#|#...#|.###.', '9': '.###.|#...#|#...#|.####|....#|...#.|.##..',
  '.': '.....|.....|.....|.....|.....|.##..|.##..', ':': '.....|.##..|.##..|.....|.##..|.##..|.....',
  '&': '.##..|#..#.|#.#..|.#...|#.#.#|#..#.|.##.#', '-': '.....|.....|.....|#####|.....|.....|.....',
  '!': '..#..|..#..|..#..|..#..|..#..|.....|..#..', '/': '.....|....#|...#.|..#..|.#...|#....|.....',
  "'": '..#..|..#..|.#...|.....|.....|.....|.....', ',': '.....|.....|.....|.....|.##..|..#..|.#...',
  '♥': '.....|.#.#.|#####|#####|.###.|..#..|.....', '✦': '..#..|..#..|.###.|#####|.###.|..#..|..#..',
  '♪': '..#..|..##.|..#.#|..#..|.##..|###..|.#...', '→': '.....|..#..|...#.|#####|...#.|..#..|.....',
  '%': '##..#|##.#.|...#.|..#..|.#...|.#.##|#..##', '+': '.....|..#..|..#..|#####|..#..|..#..|.....',
  '°': '.##..|#..#.|.##..|.....|.....|.....|.....', '×': '.....|#...#|.#.#.|..#..|.#.#.|#...#|.....',
  '(': '...#.|..#..|.#...|.#...|.#...|..#..|...#.', ')': '.#...|..#..|...#.|...#.|...#.|..#..|.#...',
};
const G5BITS = new Map<string, boolean[][]>();
for (const [k, v] of Object.entries(G5)) G5BITS.set(k, v.split('|').map((r) => Array.from(r, (ch) => ch === '#')));

/** 5×7 字的寬度（每字 5 格＋1 格字距；空白 3 格）。 */
export function dot5Width(text: string): number {
  let w = 0;
  for (const ch of Array.from(text.toUpperCase())) w += ch === ' ' ? 4 : 6;
  return Math.max(0, w - 1);
}

/** 把 5×7 字畫在點陣畫布上（左上角 x, y，一格一像素）。不認得的字畫成空白。回傳寬度。 */
export function drawDot5(c: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string): number {
  c.fillStyle = fill;
  let cx = Math.round(x);
  const y0 = Math.round(y);
  for (const ch of Array.from(text.toUpperCase())) {
    if (ch === ' ') { cx += 4; continue; }
    const g = G5BITS.get(ch);
    if (g) for (let r = 0; r < 7; r++) for (let k = 0; k < 5; k++) if (g[r]![k]) c.fillRect(cx + k, y0 + r, 1, 1);
    cx += 6;
  }
  return cx - Math.round(x) - 1;
}

// ---------------------------------------------------------------- 一個字（愛心用自己畫的那顆）
/**
 * 畫一個字（用目前的 font）：一般的字用 fill；♥ 照風格聖經改畫 drawHeart（點綴色），位置、大小照字型那顆的框。
 * 逐字出現的留言用它，才不會漏掉愛心。
 */
export function fillGlyph(c: CanvasRenderingContext2D, ch: string, x: number, y: number, fill: string, heart = rgba('rose')) {
  if (ch !== '♥') { c.fillStyle = fill; c.fillText(ch, x, y); return; }
  const m = c.measureText('♥');
  const h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  const cy = y - (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  drawHeart(c, x + m.width / 2, cy, Math.min(m.width, h * 1.15) * 0.92, heart);
}

// ---------------------------------------------------------------- 時間
/** 進出場：開頭 a 秒淡入、結尾 b 秒淡出。 */
export const inOut = (t: number, s: number, e: number, a = 0.3, b = 0.3) => Math.min(clamp((t - s) / a), clamp((e - t) / b));

/** 這個窗格前後會用到的歌詞行（前後各多拿一點，進出場時也有東西）。 */
export const windowLines = (ly: Lyrics, s: number, e: number): Line[] => ly.linesIn(s - 6, e + 2);
