// P6「紙藝與手作」照片版面（letteropen、papercut、popup、embroidery、jianzhi、jigsaw、washpaint、sketch、pressedflower、unfold）共用的小工具。
// 檔名 _ 開頭，不會被當成版面。
//  - loadPhoto：載照片、做貼圖、先傳上顯示卡（每個版面 init() 第一件事）。
//  - Caption：照片窗格的字（_photo.ts 的 PhotoText 包一層）寫在場景裡的一張字層上：版面決定字層貼在哪個物件上
//    （信封、卡片、布、紙條…），這裡只管字——主字（賓客留言＋署名，或新人的註解，可以一個字一個字寫出來）、
//    歌詞小一號在下面跟唱；沒有主字時歌詞自己當主字；兩個都沒有就沒有字（版面把照片移到正中間，不留空的說明欄）。
//    相簿的第一張在字上面多一行小小的相簿名。物件上放不下整塊時用 lyricsApart：歌詞自己一張字層，版面另外放。
//  - 焦點：照片在紙上、框裡的用 P6_GLSL 的 pcrop（focusCrop 的結果）往焦點推；平面鏡頭往焦點推用 focusCam／focusAmp（字一直在安全區裡）。
//  - P6_GLSL：紙纖維、照片取樣（壓亮度，不發光、照 pcrop 裁）、在 shader 裡取樣字層（字跟著物件的旋轉、透視、材質一起動）。
//  - P6_POST：亮版面、照片不發光的後製。
import * as THREE from 'three';
import { Layer2D, W, H, SCALE, type Compositor } from '../engine/gl';
import { font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, lerp, prog } from '../engine/util';
import { HUD_SAFE } from '../engine/hud';
import { layoutLyric } from './_motifs';
import { focusCrop, loadWords, photoTexture, PhotoText, settleK, type PhotoTextStyle } from './_photo';
import type { PhotoRef, PhotoImage } from '../photos';
import type { SceneCtx, PostOverrides } from '../engine/scene';

/** 亮版面＋照片：紙不刺眼、照片（白紗、天空）不會被 bloom 打到。 */
export const P6_POST: PostOverrides = { paper: 1, bloom: 0.15, bloomThreshold: 1.1, halation: 0.05, vignette: 0.25 };

export interface Loaded { ph: PhotoRef; img: PhotoImage; tex: THREE.Texture }

/**
 * 照片版面只排在照片窗格（導演一定給 params.photo）；沒有就丟錯讓引擎跳過這個窗格，不要畫一半。
 * 貼圖交給版面 track()（窗格結束時釋放）；照片池的圖本身不能 close。
 */
export async function loadPhoto(ctx: SceneCtx, track: (t: THREE.Texture) => THREE.Texture, extraText = ''): Promise<Loaded> {
  const ph = ctx.params.photo as PhotoRef | undefined;
  if (!ph) throw new Error('照片版面要有 params.photo');
  await loadText(`${ph.caption}${ph.album}${extraText}`);
  // 主字可能是賓客留言（署名的「——」與名字也要先載，第一格才不會用備援字型）
  await loadWords(ctx);
  const img = await ph.load();
  const tex = track(photoTexture(img));
  // 先上傳到顯示卡（不要拖到第一格才傳，切版面時會停一下）
  ctx.renderer.initTexture(tex);
  return { ph, img, tex };
}

/** 照片放進 boxW×boxH 的縮放（完整放、不裁）：很小的舊照片最多放大到原尺寸約 1.5 倍，再大就糊了。 */
export const fitPhoto = (w: number, h: number, boxW: number, boxH: number, maxUp = 1.5) => Math.min(boxW / w, boxH / h, maxUp);

/** 照片取樣的 mip 層：照片上用到的像素 ÷ 畫面上的實體像素。 */
export const photoLod = (texPx: number, screenPx: number) => Math.max(0, Math.log2(texPx / Math.max(1, screenPx * SCALE)));

/**
 * 很暗的照片（平均亮度 < 0.3）放在亮的紙上會顯得悶：照片整體提亮一點（最多 15%，乘上 p6Photo 的 0.82 還是不會發光）。
 * 沒有亮度資料（開發用的假照片、舊資料）就不動。
 */
export const photoGain = (ph: PhotoRef) => (ph.lum == null ? 1 : 1 + clamp((0.3 - ph.lum) / 0.3) * 0.15);

/** 用 P6_GLSL 的 shader 一定要有的 uniform（展開到自己的 uniforms 裡）：pgain 照片提亮、pcrop 照片要看的那一塊（往焦點推）。 */
export const P6_UNIFORMS = () => ({ pgain: { value: 1 }, pcrop: { value: new THREE.Vector4(0, 0, 1, 1) } });

/** 每格設好 P6_GLSL 的照片 uniform：提亮（photoGain）、照片要看的那一塊（focusCrop 的結果；不推就給整張）。 */
export function setP6Photo(u: Record<string, THREE.IUniform>, ph: PhotoRef, crop: readonly number[] = [0, 0, 1, 1]) {
  u.pgain!.value = photoGain(ph);
  (u.pcrop!.value as THREE.Vector4).set(crop[0]!, crop[1]!, crop[2]!, crop[3]!);
}

/**
 * 紙上、框裡的照片往焦點推（ENGINE.md「焦點」）：照片完整放（框跟照片同比例），框裡的畫面從整張慢慢推到 zoom 倍，
 * 臉越來越大、越來越靠近框的中間。印在紙、布上的給 1.12～1.2；screenW 是照片在畫面上的寬，很小的照片自動少推。
 * t0：從什麼時候開始推（照片完整出現的時候；預設窗格開頭）。
 */
export function p6Crop(ctx: SceneCtx, img: PhotoImage, t: number, o: { zoom?: number; screenW?: number; t0?: number; tau?: number } = {}) {
  const ph = ctx.params.photo as PhotoRef;
  return focusCrop(ph, img.w, img.h, img.w / img.h, settleK(t - (o.t0 ?? ctx.start), o.tau ?? 6), { zoom: o.zoom ?? 1.15, screenW: o.screenW });
}

/** 焦點在照片框裡的位置（0..1）換成框在世界座標的位置：rect = 照片（不含白邊）的 [x0, y0, x1, y1]。 */
export function focusAt(ph: { fx: number; fy: number }, crop: readonly number[], rect: readonly number[]): [number, number] {
  const u = (ph.fx - crop[0]!) / Math.max(1e-6, crop[2]! - crop[0]!), v = (ph.fy - crop[1]!) / Math.max(1e-6, crop[3]! - crop[1]!);
  return [lerp(rect[0]!, rect[2]!, u), lerp(rect[1]!, rect[3]!, v)];
}

/** 一塊範圍 [x0, y0, x1, y1]。 */
export type Box = [number, number, number, number];
/** 平面鏡頭：世界座標的中心 x, y 與放大 z（P6 版面 shader 的 cam uniform：畫面 = (世界 − 中心) × z + 畫面中間）。 */
export type Cam = [number, number, number];

/** box（世界座標）在鏡頭 cam 下有沒有在安全區裡：離四邊 ≥ 96 px、不進右下角 HUD。 */
export function camSafe(cam: Cam, b: Box): boolean {
  const [cx, cy, z] = cam;
  const x0 = W / 2 + (b[0] - cx) * z, x1 = W / 2 + (b[2] - cx) * z;
  const y0 = H / 2 + (b[1] - cy) * z, y1 = H / 2 + (b[3] - cy) * z;
  return x0 >= 96 && y0 >= 96 && x1 <= W - 96 && y1 <= H - 96 && !(x1 > HUD_SAFE.x && y1 > HUD_SAFE.y);
}

export interface FocusCamOpts {
  /** 鏡頭原本的位置（版面自己的進場動作停好之後的；預設世界＝畫面）。 */
  base?: Cam;
  /** 推到底再放大幾倍（預設 1.05）。 */
  zoom?: number;
  /** 焦點往畫面中間移多少（0..1，預設 0.3；0 = 繞著焦點原地放大）。 */
  pull?: number;
}

/**
 * 實體相片、紙上的照片：平面鏡頭往焦點那一點推近（ENGINE.md「焦點」）——鏡頭從 base 慢慢放大到 zoom 倍，同時把焦點 f（世界座標）
 * 往畫面中間拉。k 是進度（settleK）乘上 focusAmp 算好的幅度。
 * 焦點在畫面上的位置是 s + (p − f)·z（s 隨 k 線性移向中間），所以兩頭都在安全區裡的字，中間也在。
 */
export function focusCam(f: readonly [number, number], k: number, o: FocusCamOpts = {}): Cam {
  const [bx, by, bz] = o.base ?? [W / 2, H / 2, 1];
  const z = bz * (1 + ((o.zoom ?? 1.05) - 1) * k);
  const pull = (o.pull ?? 0.3) * k;
  const sx = lerp(W / 2 + (f[0] - bx) * bz, W / 2, pull), sy = lerp(H / 2 + (f[1] - by) * bz, H / 2, pull);
  return [f[0] - (sx - W / 2) / z, f[1] - (sy - H / 2) / z, z];
}

/**
 * focusCam 能推多少（0..1，乘在進度上）：推到底時 keep 裡的範圍（字、字的容器）都還在安全區裡就是 1，
 * 不然整段少推一點（不是推到一半停住）。在 init() 算一次（只跟版面配置有關，確定性沒問題）。
 */
export function focusAmp(f: readonly [number, number], o: FocusCamOpts, keep: Box[]): number {
  const ok = (a: number) => keep.every((b) => camSafe(focusCam(f, a, o), b));
  if (ok(1)) return 1;
  let lo = 0, hi = 1;
  for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
  return lo;
}

/** 窗格短時把進場動作壓快一點（3 秒的窗格也要看得到完整的照片）：8 秒以上 1，最快到 0.45。 */
export const pace = (ctx: SceneCtx) => clamp((ctx.end - ctx.start) / 8, 0.45, 1);

/**
 * 把一張比畫面小的字層（左上角在畫面座標 x, y）疊到 out 上；zoom／zc：鏡頭繞著 zc 放大（字跟著場景一起被推近）。
 */
export function placeLayer(comp: Compositor, renderer: THREE.WebGLRenderer, L: Layer2D, out: THREE.WebGLRenderTarget, x: number, y: number, o: { opacity?: number; zoom?: number; zc?: [number, number] } = {}) {
  const z = o.zoom ?? 1, zc = o.zc ?? [W / 2, H / 2];
  const sx = W / (z * L.w), sy = H / (z * L.h);
  const ox = (zc[0] * (1 - 1 / z) - x) / L.w - 0.5 + 0.5 * sx;
  const oy = 1 - (zc[1] * (1 - 1 / z) + H / z - y) / L.h - 0.5 + 0.5 * sy;
  comp.draw(renderer, L.texture, out, { opacity: o.opacity ?? 1, scale: [sx, sy], offset: [ox, oy] });
}

/**
 * 字的樣式：就是 PhotoText 的樣式（_photo.ts；欄寬高在 Caption 的建構子給），墨色有紙上的預設，外加相簿名。
 * 畫在縮放過的平面上（立體卡片）時，字級（min、max、sigSize、lyricSize、lyricSubSize、gap）都要換算成平面上的大小。
 */
export interface CaptionStyle extends Omit<PhotoTextStyle, 'w' | 'h' | 'ink' | 'align'> {
  align?: 'left' | 'center';
  /** 主字（與唱完的歌詞）的墨色。預設是紙上的深咖啡墨；署名預設淡一點。 */
  ink?: string;
  /** 相簿名的顏色、字族、字級（≤ 22～26 px 的小標籤）。 */
  label?: string;
  labelFamily?: string;
  labelSize?: number;
}

/** 相簿名那一行（含底下的空）的高度。 */
const LABEL_H = 50;

/** 換掉 rgba() 字串的透明度（乘上 k）。 */
const fadeRgba = (c: string, k: number) => c.replace(/([\d.]+)\)$/, (_, a: string) => `${(+a * k).toFixed(3)})`);

/**
 * 照片窗格的字層：_photo.ts 的 PhotoText（主字＝賓客留言＋署名或新人的註解，歌詞小一號在下面跟唱；沒有主字時歌詞自己當主字；
 * 都沒有 has = false）包一層，多兩件事：章節開頭的一行小小的相簿名、主字一個字一個字寫出來（署名在主字寫完才出現，PhotoText 管）。
 * 字層的大小 = 欄寬 × (欄高＋相簿名) + 四邊 pad；內容從 (pad, pad) 開始往下排。
 * 版面用 blockH（相簿名＋整塊字的高度）、blockW 把它擺在物件上，再用 placeLayer 或自己的 shader（P6_GLSL 的 p6Layer）貼上去。
 * 欄高 h 是整塊（主字＋署名＋歌詞）的上限：主字在剩下的高度裡縮字、折行，60 字的留言也要放得下（窄欄的版面 maxLines 給 5～6）。
 * lyricsApart 而且這一格主字、歌詞都有時（apart）：L 只有相簿名＋主字＋署名，歌詞畫在 LL（版面自己決定貼哪裡、位置固定）。
 * 用 this.track(new Caption(...))：窗格結束時字層一起釋放。
 */
export class Caption {
  readonly L: Layer2D;
  /** apart 時歌詞自己的字層（setup() 之後才有；其他時候 null）。內容從 (pad, pad) 開始，寬跟 L 一樣。 */
  LL: Layer2D | null = null;
  readonly pad = 22;
  text!: PhotoText;
  label = '';
  /** 一個字一個字寫出來的起訖（tW1 <= tW0：一次出現）。 */
  tW0 = 0;
  tW1 = 0;
  /** 實際用到的寬度（相簿名、主字、署名、這個窗格每一句歌詞裡最寬的；apart 時不含歌詞）：紙卡、標籤、盒蓋照它的大小做。 */
  blockW = 0;
  /** apart 時歌詞實際用到的寬度。 */
  lyricW = 0;

  constructor(readonly w: number, readonly h: number, readonly st: CaptionStyle) {
    // 沒有主字時歌詞自己當主字（48 px、可能折兩行、韓文歌有原文副行）：欄再矮也要留得下
    this.L = new Layer2D(w + 2 * this.pad, Math.max(h, 240) + LABEL_H + 2 * this.pad, undefined, { fast: true });
  }

  dispose() { this.L.dispose(); this.LL?.dispose(); }

  setup(ctx: SceneCtx, ph: PhotoRef) {
    const s = this.st, c = this.L.ctx;
    const ink = s.ink ?? rgba('sepia', 0.92);
    const tx = (this.text = new PhotoText(ctx, c, {
      ...s, w: this.w, h: this.h, ink, align: s.align ?? 'left',
      active: s.active ?? mixRgba('signal', 'sepia', 0.45), sigInk: s.sigInk ?? fadeRgba(ink, 0.8),
    }));
    let bw = 0;
    if (tx.fit) {
      bw = tx.fit.width;
      if (tx.words.sig) { c.font = font(s.sigFamily ?? s.family, tx.sigSize); bw = Math.max(bw, c.measureText(tx.words.sig).width); }
    }
    // PhotoText 的 width 在有歌詞時給上限（句子長短不一）；紙卡要剛好包住字，所以自己量這個窗格裡每一句
    if (tx.sung) {
      const ls = tx.lyricStyle();
      let lw = 0;
      for (const ln of ctx.lyrics.linesIn(ctx.start, ctx.end)) {
        const lay = layoutLyric(c, ln, ls);
        lw = Math.max(lw, ...lay.rows.map((r) => r.width), ...(lay.sub ? lay.sub.lay.rows.map((r) => r.width) : []));
      }
      if (this.apart) this.lyricW = Math.min(Math.ceil(lw), this.w);
      else bw = Math.max(bw, lw);
    }
    this.label = ph.chapter && ph.album && tx.has ? ph.album : '';
    if (this.label) {
      c.font = font(s.labelFamily ?? s.family, s.labelSize ?? 22);
      c.letterSpacing = '5px';
      let a = this.label;
      while (a.length > 1 && c.measureText(a).width > this.w - 10) a = a.slice(0, -1);
      if (a !== this.label) this.label = `${a}…`;
      bw = Math.max(bw, c.measureText(this.label).width);
      c.letterSpacing = '0px';
    }
    this.blockW = Math.min(Math.ceil(bw), this.w);
    if (this.apart) this.LL = new Layer2D(this.w + 2 * this.pad, Math.ceil(tx.lyricH + tx.lyricSize * 0.4) + 2 * this.pad, undefined, { fast: true });
  }

  /** 有沒有任何字（主字或歌詞；沒有的話版面不留說明欄）。 */
  get has() { return this.text.has; }
  /** 有主字（留言或註解）：一個字一個字寫出來，不用淡入。 */
  get hasMain() { return this.text.hasMain; }
  /** 這個窗格有歌詞要唱。 */
  get sung() { return this.text.sung; }
  /** 歌詞另外放（版面要了 lyricsApart，而且這一格主字、歌詞都有）。 */
  get apart() { return !!this.st.lyricsApart && this.text.hasMain && this.text.sung; }
  get labelH() { return this.label ? LABEL_H : 0; }
  /** 字（相簿名＋主字＋署名＋歌詞；apart 時沒有歌詞）的高度：頂到最後一排基線。 */
  get blockH() { return this.labelH + this.text.height; }
  /** apart 時歌詞那一塊的高度（頂到最後一排基線，照這個窗格最長的那句預留）。 */
  get lyricH() { return this.apart ? this.text.lyricH : 0; }

  /** 從 t0 開始一個字一個字寫出來（最多 maxDur 秒寫完：長留言也不能寫太久，要留時間讀）。 */
  writeAt(t0: number, maxDur = 2) {
    if (!this.hasMain) return;
    this.tW0 = t0;
    this.tW1 = t0 + Math.min(maxDur, 0.06 * this.text.chars + 0.3);
  }

  /**
   * 這個窗格裡字出現的時間範圍：主字從開始寫的那一刻起；只有歌詞時從第一句快要唱到起、到最後一句唱完再留一會兒。
   * 字寫在一個容器上（紙卡、標籤）的版面用它讓容器跟著字出現，不要先擺一張空白的卡。
   */
  span(ctx: SceneCtx): [number, number] {
    if (this.hasMain) return [this.tW0, Infinity];
    const ls = this.sung ? ctx.lyrics.linesIn(ctx.start, ctx.end) : [];
    if (!ls.length) return [Infinity, Infinity];
    return [ls[0]!.start - 0.35, ls[ls.length - 1]!.end + 6];
  }

  /** 主字寫到第幾個字（Infinity = 全部）。 */
  chars(t: number) {
    if (!this.hasMain) return 0;
    if (this.tW1 <= this.tW0) return t >= this.tW0 ? Infinity : 0;
    return t >= this.tW1 ? Infinity : Math.floor(clamp((t - this.tW0) / (this.tW1 - this.tW0)) * this.text.chars);
  }

  /**
   * 照 t 畫字（內容沒變就不重畫、不重傳）。回傳有沒有重畫。
   * 有主字時，相簿名與歌詞跟著主字開始寫的那一刻出現（主字還沒寫，物件上不要先冒出一行歌詞）。
   */
  draw(t: number): boolean {
    const tx = this.text;
    if (!tx.has) return false;
    const ax = this.pad + (this.st.align === 'center' ? this.w / 2 : 0);
    const n = this.chars(t);
    const lyricAlpha = tx.hasMain ? prog(t, this.tW0, this.tW0 + 0.5) : 1;
    let up = false;
    if (tx.draw(this.L.ctx, t, ax, this.pad + this.labelH, { chars: n, lyricAlpha, clear: () => this.clearMain(!tx.hasMain || n > 0) })) { this.L.upload(); up = true; }
    const LL = this.LL;
    if (LL && tx.drawLyrics(LL.ctx, t, ax, this.pad, { alpha: lyricAlpha, clear: () => LL.clear() })) { LL.upload(); up = true; }
    return up;
  }

  /** 清掉主字層、重畫相簿名（PhotoText 要重畫主字時呼叫；label = false：主字還沒開始寫，相簿名也先不出來）。 */
  private clearMain(label: boolean) {
    const L = this.L, c = L.ctx, s = this.st;
    L.clear();
    if (!this.label || !label) return;
    const center = s.align === 'center';
    const ls = s.labelSize ?? 22;
    c.font = font(s.labelFamily ?? s.family, ls);
    c.fillStyle = s.label ?? rgba('sepia', 0.6);
    c.letterSpacing = '5px';
    c.textAlign = center ? 'center' : 'left';
    c.textBaseline = 'alphabetic';
    c.fillText(this.label, this.pad + (center ? this.w / 2 : 0), this.pad + ls);
    c.letterSpacing = '0px';
    c.textAlign = 'left';
  }
}

/**
 * 版面 shader 共用的 GLSL（放在自己的 FSPass 前面）：
 *  - p6Photo(tex, uv, lod)：照片取樣、轉線性、壓亮度（不發光；最亮約 0.82，很暗的照片乘上 pgain 提亮一點，見 photoGain）。
 *    uv 是照片框裡的位置（0..1，超出的夾在邊上），照 pcrop（focusCrop 的結果）對應到照片上——框裡的畫面往焦點推。
 *    用到 P6_GLSL 的 shader，uniforms 要展開 ...P6_UNIFORMS()，每格 setP6Photo()。lod 要照 pcrop 那一塊算。
 *  - p6Crop(uv)：框裡的位置 → 照片上的位置（自己另外取樣照片衍生的圖時用，例如素描的邊緣圖）。
 *  - p6Paper(p, base)：紙的纖維與斑駁（p 是紙面上的邏輯 px）。
 *  - p6Layer(tl, q, size)：取樣 fast 的 Layer2D（q = 字層裡的邏輯 px，y 向下；超出範圍是透明），回傳預乘、線性的顏色。
 *  - p6Soft(d, w)：距離場的軟邊（影子、失焦的邊）。
 */
export const P6_GLSL = /* glsl */ `
uniform float pgain; uniform vec4 pcrop;
vec2 p6Crop(vec2 uv) { return pcrop.xy + clamp(uv, 0.0, 1.0) * (pcrop.zw - pcrop.xy); }
vec3 p6Photo(sampler2D tex, vec2 uv, float lod) { return toLinear(textureLod(tex, p6Crop(uv), lod).rgb) * 0.82 * pgain; }
float p6Fiber(vec2 p) { return snoise(vec2(p.x / 2.5, p.y / 70.0)) * 0.5 + snoise(vec2(p.x / 60.0, p.y / 3.0)) * 0.5; }
vec3 p6Paper(vec2 p, vec3 base) { return base * (0.95 + 0.035 * fbm(p / 300.0, 3) + 0.012 * p6Fiber(p)); }
// 一個出口（中途 return 在 ANGLE／D3D 上可能編出不一樣的結果）
vec4 p6Layer(sampler2D tl, vec2 q, vec2 size) {
  vec2 uv = vec2(q.x / size.x, 1.0 - q.y / size.y);
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  return fastLayer(textureLod(tl, clamp(uv, 0.0, 1.0), 0.0)) * inside;
}
float p6Soft(float d, float w) { return 1.0 - smoothstep(-w, w, d); }
`;
