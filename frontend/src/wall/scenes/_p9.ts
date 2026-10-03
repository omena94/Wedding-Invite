// 照片版面 P9「台灣味」共用的小工具（cookiebox、hongbao、lantern…）。檔名 _ 開頭，不會被當成版面。
//  - P9Plate：載照片、做貼圖（照片池的圖不 close）、算 mip 層、往焦點推（focus）。
//  - Words：照片窗格的字（_photo.ts 的 PhotoText 包一層）：主字（賓客留言＋署名，或新人的註解）＋跟唱的歌詞，
//    外加相簿第一張的相簿名小標籤、主字一個字一個字寫出來的時間。兩樣都沒有時 has = false，
//    版面把說明的物件收起來，照片移到中間（不留空的說明欄）。
//  - at()：comp.draw 把一張圖層貼在畫面的某個位置；P9_GLSL：照片取樣（不發光、可以裁一塊往焦點推）、圖層取樣、軟影子。
import * as THREE from 'three';
import { Scene, type SceneCtx } from '../engine/scene';
import { W, H, SCALE, type Layer2D } from '../engine/gl';
import { font, loadText } from '../engine/type';
import { clamp } from '../engine/util';
import { lyricAt, beatAfter } from './_motifs';
import { focusCrop, loadWords, photoTexture, PhotoText, settleK, type PhotoTextStyle } from './_photo';
import type { PhotoRef, PhotoImage } from '../photos';

export abstract class P9Plate extends Scene {
  photo: PhotoRef = this.ctx.params.photo;
  seed = Number(this.ctx.params.seed ?? 1);
  img!: PhotoImage;
  tex!: THREE.Texture;

  /** init() 一開始呼叫：照片版面只排在照片窗格（導演一定給 params.photo），沒有就讓引擎跳過這個窗格，不要畫一半。 */
  protected async loadPhoto(extraText = '') {
    const ph = this.photo;
    if (!ph) throw new Error('照片版面要有 params.photo');
    await loadText(`${ph.caption}${ph.album}${extraText}`);
    await loadWords(this.ctx);
    this.img = await ph.load();
    this.tex = this.track(photoTexture(this.img));
    // 先傳到顯示卡（拖到第一格才傳，切版面時會停一下）
    this.ctx.renderer.initTexture(this.tex);
  }

  /** 照片在畫面上 screenPx 寬時要取的 mip 層；crop：框裡用到照片寬的幾分之幾（往焦點推、裁掉一圈時）。 */
  protected lod(screenPx: number, crop = 1) { return Math.max(0, Math.log2((this.img.w * crop) / Math.max(1, screenPx * SCALE))); }

  /**
   * 往焦點推（ENGINE.md「焦點」）：框（寬高比 aspect）裡要看照片的哪一塊 [x0, y0, x1, y1]，設到 shader 的 crop。
   * t0 起一開始快、越來越慢地推到 zoom 倍；screenW 給框在畫面上的寬，很小的舊照片就少推（不超過原尺寸 1.5 倍）。
   */
  protected focus(t: number, t0: number, aspect: number, o: { zoom?: number; screenW?: number; tau?: number } = {}): [number, number, number, number] {
    return focusCrop(this.photo, this.img.w, this.img.h, aspect, settleK(t - t0, o.tau ?? 6), { zoom: o.zoom ?? 1.15, screenW: o.screenW });
  }

  /** 窗格的「主要動作」時間：第一個拍點（最晚開場一秒），短窗格也看得到照片露出來。 */
  protected cue(after = 0.3, latest = 1.0) {
    const s = this.ctx.start;
    return Math.min(beatAfter(this.ctx.audio, s + after), s + latest);
  }
}

/** 照片放進 boxW × boxH 的框裡（完整，不裁），很小的照片最多放大 maxUp 倍。回傳畫面上的寬高。 */
export function fitPhoto(img: PhotoImage, boxW: number, boxH: number, maxUp = 1.5) {
  const s = Math.min(boxW / img.w, boxH / img.h, maxUp);
  return { w: img.w * s, h: img.h * s, s };
}

/** comp.draw 的參數：圖層 L 的左上角放在畫面 (x, y)，放大 s 倍。 */
export function at(L: Layer2D, x: number, y: number, s = 1): { scale: [number, number]; offset: [number, number] } {
  const sx = W / (s * L.w), sy = H / (s * L.h);
  return { scale: [sx, sy], offset: [0.5 * sx - 0.5 - x / (s * L.w), 0.5 - 0.5 * sy + y / (s * L.h)] };
}

export interface WordsStyle extends PhotoTextStyle {
  /** 相簿第一張：字的上面一行小小的相簿名（≤ 26 px）。 */
  album?: { family: string; size: number; color: string } | null;
  /** lyricsApart 時歌詞那一塊自己的樣式（寬、對齊、顏色…；沒給的跟主字一樣）。 */
  lyricBox?: Partial<PhotoTextStyle>;
}

/**
 * 照片窗格的字（PhotoText 包一層）：版面在 init() 建好，render 時 draw()（內容沒變就不重畫）。
 * 座標：draw(c, t, x, y) 的 (x, y) 是框的左上角（相簿名也算在框裡），框寬 st.w；對齊照 st.align。
 * 主字一個字一個字寫出來（writeFrom 設時間），署名在主字寫完才出現；歌詞照自己的時間跟唱。
 * lyricsApart 的版面：draw 只畫相簿名＋主字＋署名，歌詞用 drawLyrics 另外畫在別的地方（另一張圖層）。
 */
export class Words {
  text: PhotoText;
  /** apart 時歌詞那一塊（有 lyricBox 才另外排；沒有就用 text 的歌詞）。 */
  private lyr: PhotoText | null = null;
  /** 相簿名那一行佔的高度（沒有是 0）。 */
  head = 0;
  /** 主字寫字的起訖時間。 */
  w0 = 0; w1 = 0;

  constructor(private ctx: SceneCtx, c: CanvasRenderingContext2D, public st: WordsStyle) {
    this.text = new PhotoText(ctx, c, st);
    if (this.apart && st.lyricBox) this.lyr = new PhotoText(ctx, c, { ...st, ...st.lyricBox });
    const ph = ctx.params.photo as PhotoRef;
    this.head = this.text.has && ph.chapter && ph.album && st.album ? Math.round(st.album.size * 2.1) : 0;
  }

  /** 有沒有任何字（沒有的話版面不留說明的物件）。 */
  get has() { return this.text.has; }
  /** 有主字（留言或註解）。 */
  get hasMain() { return this.text.hasMain; }
  /** 有歌詞要唱。 */
  get sung() { return this.text.sung; }
  /** 歌詞真的要另外放（lyricsApart、有主字、也有歌詞）。 */
  get apart() { return !!this.st.lyricsApart && this.text.hasMain && this.text.sung; }
  /** 整塊的高度（相簿名＋主字＋署名＋歌詞；apart 時不含歌詞）：版面排位置用。 */
  get height() { return this.head + this.text.height; }
  /** 整塊實際用到的寬（短的註解不用留整欄）。 */
  get width() { return Math.min(this.st.w, Math.max(this.text.width, this.head ? 160 : 0)); }
  /** apart 時歌詞那一塊的高度（第一排頂到最後一排基線）。 */
  get lyricH() { return (this.lyr ?? this.text).lyricH; }

  /** 主字在 t0 開始寫，最多 dur 秒寫完（字多寫久一點）。 */
  writeFrom(t0: number, dur = 2) {
    this.w0 = t0;
    this.w1 = t0 + (this.text.hasMain ? Math.min(dur, 0.055 * this.text.chars + 0.35) : 0);
  }

  /** 主字已經寫出來幾個字（Infinity = 全部）。 */
  chars(t: number) {
    if (!this.text.hasMain) return 0;
    if (t >= this.w1) return Infinity;
    return Math.floor(clamp((t - this.w0) / Math.max(0.01, this.w1 - this.w0)) * this.text.chars);
  }

  /** 框的左上角 x → 對齊點（靠左＝左緣、置中＝中線、靠右＝右緣）。 */
  private ax(x: number, st: PhotoTextStyle = this.st) { return st.align === 'center' ? x + st.w / 2 : st.align === 'right' ? x + st.w : x; }

  /**
   * 整塊畫在框的左上角 (x, y)。內容變了才先 clear() 再畫、回傳 true（呼叫的人負責 upload）；沒變回傳 false。
   * lyricAlpha：歌詞自己的透明度（例如物件還沒出現時先不唱）。
   */
  draw(c: CanvasRenderingContext2D, t: number, x: number, y: number, clear: () => void, o: { alpha?: number; lyricAlpha?: number } = {}): boolean {
    const ax = this.ax(x), chars = this.chars(t);
    const paint = () => { clear(); this.paintAlbum(c, t, ax, y, chars); };
    if (this.apart) return this.text.drawMain(c, ax, y + this.head, { chars, alpha: o.alpha, clear: paint });
    return this.text.draw(c, t, ax, y + this.head, { chars, alpha: o.alpha, lyricAlpha: o.lyricAlpha, clear: paint });
  }

  /** apart 時的歌詞：(x, y) 是歌詞框（寬 lyricBox.w，沒給就是 st.w）的左上角。內容變了才畫、回傳 true。 */
  drawLyrics(c: CanvasRenderingContext2D, t: number, x: number, y: number, clear: () => void, o: { alpha?: number } = {}): boolean {
    if (!this.apart) return false;
    const T = this.lyr ?? this.text;
    return T.drawLyrics(c, t, this.ax(x, T.st), y, { alpha: o.alpha, clear });
  }

  /** 相簿名跟著字一起出現（主字還沒開始寫、這一刻沒有歌詞時不要只剩一行相簿名）。 */
  private paintAlbum(c: CanvasRenderingContext2D, t: number, ax: number, y: number, chars: number) {
    const a = this.st.album, ph = this.ctx.params.photo as PhotoRef;
    if (!this.head || !a) return;
    const show = this.text.hasMain ? chars > 0 : !!lyricAt(this.ctx.lyrics, t, 6);
    if (!show) return;
    c.save();
    c.font = font(a.family, a.size);
    c.fillStyle = a.color;
    c.letterSpacing = `${Math.round(a.size * 0.2)}px`;
    c.textAlign = this.st.align ?? 'left';
    c.textBaseline = 'alphabetic';
    let s = ph.album;
    while (s.length > 1 && c.measureText(s).width > this.st.w) s = s.slice(0, -1);
    c.fillText(s === ph.album ? s : `${s}…`, ax, y + a.size);
    c.restore();
  }
}

/** P9 版面共用的 GLSL：照片取樣（不發光、往焦點裁）、fast 圖層取樣、軟影子、紙纖維、實體相片。 */
export const P9_GLSL = /* glsl */ `
  // 照片：原樣上傳的 sRGB，取樣後轉線性；最亮壓在 0.82（白紗、天空不會被 bloom 打到）
  vec3 photoLin(sampler2D tex, vec2 uv, float l) { return toLinear(textureLod(tex, clamp(uv, 0.0, 1.0), l).rgb) * 0.82; }
  // fast 的 Layer2D（預乘、sRGB 編碼、flipY）：uv 的 y = 0 是圖層最上面
  vec4 layerAt(sampler2D tex, vec2 uv) {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
    return fastLayer(textureLod(tex, vec2(uv.x, 1.0 - uv.y), 0.0));
  }
  // 方塊的軟影子（d = sdBox 的距離，blur = 半影寬）
  float boxShade(float d, float blur) { return 1.0 - smoothstep(-blur, blur, d); }
  // 紙：很淡的纖維與斑駁（亮版面的紙、卡紙）
  float paperTex(vec2 p) {
    return 0.6 * snoise(p / 140.0) + 0.25 * snoise(vec2(p.x / 2.2, p.y / 60.0)) + 0.15 * snoise(vec2(p.x / 55.0, p.y / 2.6));
  }
  // 抗鋸齒的填滿（d 以邏輯 px 計、w = 邊緣寬，景深模糊時給大一點）
  float fillAA(float d, float w) { return 1.0 - smoothstep(-w, w, d); }
  // 框裡的 uv（0..1）→ 照片上的 uv：crop 是往焦點推的那一塊（P9Plate.focus，[x0, y0, x1, y1]）
  vec2 cropUV(vec2 uv, vec4 crop) { return crop.xy + uv * (crop.zw - crop.xy); }
  // 一張實體相片（白邊、相紙）：q = 以相片中心為原點的局部座標，hs = 照片（不含白邊）的半寬高，bd = 白邊寬，aa = 邊緣寬，
  // crop = 相片上印的是照片的哪一塊（往焦點推）
  vec4 printAt(sampler2D tex, vec2 q, vec2 hs, float bd, float l, float aa, vec4 crop) {
    float d = sdBox(q, hs + bd);
    float a = fillAA(d, aa);
    if (a <= 0.0) return vec4(0.0);
    vec3 c = C_BONE * 0.9 * (0.975 + 0.025 * paperTex(q * 2.0));
    vec2 uv = cropUV((q + hs) / (2.0 * hs), crop);
    c = mix(c, photoLin(tex, uv, l), fillAA(sdBox(q, hs), aa));
    return vec4(c, a);
  }
`;

/**
 * 鏡頭（P9 的版面共用）：世界座標 x 往右、y 往下（桌面往觀眾、牆面往地上）、z 從桌面／牆面朝向鏡頭。
 * 俯拍的桌面與正拍的牆都是「z = 0 的平面」，鏡頭的 pitch 往上斜看（看得到物件朝觀眾那一面）、yaw 繞著 y 軸轉（斜斜地看牆）、roll 是畫面的旋轉。
 * shader 裡 `onZ(p, z)`：畫面上的點 p 落在高度 z 的平面上的哪裡；`camRay(p)` 是那個像素的射線方向。
 */
export const P9_CAM_GLSL = /* glsl */ `
  uniform vec3 camO; uniform vec3 camX; uniform vec3 camY; uniform vec3 camF; uniform float camFoc;
  vec3 camRay(vec2 p) { vec2 s = p - vec2(960.0, 540.0); return s.x * camX + s.y * camY + camFoc * camF; }
  vec2 onZ(vec2 p, float z) { vec3 d = camRay(p); return (camO + d * ((z - camO.z) / d.z)).xy; }
`;

export const camUniforms = () => ({
  camO: { value: new THREE.Vector3() }, camX: { value: new THREE.Vector3(1, 0, 0) }, camY: { value: new THREE.Vector3(0, 1, 0) },
  camF: { value: new THREE.Vector3(0, 0, -1) }, camFoc: { value: 2400 },
});

export interface Cam {
  /** 看著哪一點（世界座標）。 */
  x: number; y: number; z: number;
  /** 鏡頭離那一點多遠（px）：越近透視越強。在那個距離、zoom = 1 時，平面上 1 px 就是畫面上 1 px。 */
  dist: number;
  /** 往上斜看（弧度，0 = 正對平面）、繞 y 軸轉、畫面旋轉。 */
  pitch?: number; yaw?: number; roll?: number;
  zoom?: number;
}

/** 算好鏡頭、設到 shader 的 uniform（camUniforms() 那幾個），回傳把世界座標投影到畫面的函式。 */
export function setCam(u: Record<string, THREE.IUniform>, c: Cam): (x: number, y: number, z: number) => [number, number] {
  const p = c.pitch ?? 0, b = c.yaw ?? 0, r = c.roll ?? 0;
  // 先 pitch（繞 x 軸）
  let fx = 0, fy = -Math.sin(p), fz = -Math.cos(p);
  let yx = 0, yy = Math.cos(p), yz = -Math.sin(p);
  let xx = 1, xy = 0, xz = 0;
  // 再 yaw（繞世界的 y 軸）
  const cb = Math.cos(b), sb = Math.sin(b);
  const ry = (v: [number, number, number]): [number, number, number] => [v[0] * cb + v[2] * sb, v[1], -v[0] * sb + v[2] * cb];
  [fx, fy, fz] = ry([fx, fy, fz]); [yx, yy, yz] = ry([yx, yy, yz]); [xx, xy, xz] = ry([xx, xy, xz]);
  // 最後 roll（畫面旋轉）
  const cr = Math.cos(r), sr = Math.sin(r);
  const X: [number, number, number] = [xx * cr + yx * sr, xy * cr + yy * sr, xz * cr + yz * sr];
  const Y: [number, number, number] = [-xx * sr + yx * cr, -xy * sr + yy * cr, -xz * sr + yz * cr];
  const O: [number, number, number] = [c.x - fx * c.dist, c.y - fy * c.dist, c.z - fz * c.dist];
  const foc = c.dist * (c.zoom ?? 1);
  (u.camO!.value as THREE.Vector3).set(...O);
  (u.camX!.value as THREE.Vector3).set(...X);
  (u.camY!.value as THREE.Vector3).set(...Y);
  (u.camF!.value as THREE.Vector3).set(fx, fy, fz);
  u.camFoc!.value = foc;
  return (x, y, z) => {
    const vx = x - O[0], vy = y - O[1], vz = z - O[2];
    const cz = vx * fx + vy * fy + vz * fz;
    return [W / 2 + (foc * (vx * X[0] + vy * X[1] + vz * X[2])) / cz, H / 2 + (foc * (vx * Y[0] + vy * Y[1] + vz * Y[2])) / cz];
  };
}
