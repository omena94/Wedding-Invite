// P7「旅途」照片版面共用的底子（mappin、luggage、trainwindow、roadtrip、ferry、stampbook、hotair、campnight、seaside、cablecar）。
// 檔名 _ 開頭，不會被當成版面。這一批的版面都是「一張全螢幕 shader 畫場景與照片＋一張 Canvas2D 字層」：
//  - JourneyPlate：init 裡載照片（解碼、做貼圖、先傳到顯示卡）與字型；makeText 排好這個窗格的字（_photo.ts 的 PhotoText，
//    規則跟所有照片版面一樣：主字＝賓客留言＋署名或新人的註解，歌詞在下面小一號跟唱；沒有主字時歌詞自己當主字；兩個都沒有就只有照片）。
//  - 說明字塊 paintBlock：相簿名（章節開頭才有的小標）＋PhotoText；內容沒變就不重畫、不重傳。
//    整塊放不進物件上的小地方（行李吊牌）時樣式設 lyricsApart，主字用 paintMain 寫在物件上、歌詞用 paintLyrics 另外放。
//  - setPhoto：每格設照片的 uniform，相片上的畫面往焦點推（focusCrop：新人點的臉越來越大、越來越靠近框的中間）。
//  - blit：把字層貼到畫面上的某個位置（可以跟著鏡頭縮放）；要寫在場景物件上（吊牌、沙灘）的就在 shader 裡用 layerAt 取樣。
//  - P7_GLSL：照片取樣（往焦點推的 crop、壓亮度、不發光）、字層取樣、實體相片（白邊）。
import type * as THREE from 'three';
import { Scene } from '../engine/scene';
import { type Compositor, type Layer2D, W, H, SCALE } from '../engine/gl';
import { font, loadText } from '../engine/type';
import { focusCrop, loadWords, photoTexture, PhotoText, settleK, type PhotoTextStyle } from './_photo';
import type { PhotoRef, PhotoImage } from '../photos';

/** 說明字塊的樣式：照片窗格的字（PhotoText 的樣式；h 含相簿名小標）＋相簿名小標。 */
export interface BlockStyle extends PhotoTextStyle {
  /** 相簿名小標（只在相簿的第一張畫）：≤ 22～26 px。 */
  label?: { family: string; size: number; color: string; tracking?: number; gap?: number };
}

/** 照片的 uniform（每個 pass 都要有 photo、lod、pgain、crop）。 */
type PhotoUniforms = Record<string, THREE.IUniform>;

export abstract class JourneyPlate extends Scene {
  photo: PhotoRef = this.ctx.params.photo;
  seed = Number(this.ctx.params.seed ?? 1);
  tex: THREE.Texture | null = null;
  img: PhotoImage | null = null;
  /** 這個窗格的字（主字＋署名＋歌詞）：init 裡 makeText 之後才有。 */
  words: PhotoText | null = null;
  st!: BlockStyle;
  /** 相簿的第一張：說明上面印相簿名。 */
  chapter = false;
  /** 有說明（主字或歌詞）；兩個都沒有時版面把照片移到中間，不留空的說明欄。 */
  get hasText() { return !!this.words?.has; }
  /** 有主字（留言或註解）。 */
  get hasMain() { return !!this.words?.hasMain; }
  /** 這個窗格有歌詞要唱（不管是主字還是字幕）。 */
  get sung() { return !!this.words?.sung; }
  /** 歌詞跟主字分開放（樣式設了 lyricsApart、而且有主字；沒有主字時歌詞自己當主字，照樣寫在主字的位置）。 */
  get apart() { return !!(this.st?.lyricsApart && this.words?.hasMain && this.words.sung); }
  /**
   * 照片的亮度增益：很暗的照片（平均亮度 < 0.3）稍微提亮，放在場景裡才不悶；最多 1.12 倍（0.82 × 1.12 ≈ 0.92，仍在 bloom 門檻下）。
   * 不知道亮度（開發用的假照片、舊資料）就是 1。shader 是模組層共用的，每格都要設 `u.pgain = this.gain`。
   */
  get gain() {
    const lum = this.photo?.lum;
    return typeof lum === 'number' && lum < 0.3 ? Math.min(1.12, 1 + 0.4 * (0.3 - lum)) : 1;
  }
  /** init() 一開始呼叫：載照片與字型（extra：版面自己要印的字，先載好第一格才不會用備援字型）。 */
  protected async loadPhoto(extra = '') {
    const ph = this.photo;
    // 照片版面只排在照片窗格（導演一定給 params.photo）；沒有就讓引擎跳過這個窗格，不要畫一半
    if (!ph) throw new Error('照片版面要有 params.photo');
    await loadText(`${ph.caption}${ph.album}${extra}`);
    await loadWords(this.ctx);
    this.img = await ph.load();
    this.tex = this.track(photoTexture(this.img));
    // 先上傳到顯示卡（不要拖到第一格才傳，切版面時會停一下）
    this.ctx.renderer.initTexture(this.tex);
    this.chapter = ph.chapter && !!ph.album;
  }

  /** 照片在 bw × bh 的框裡完整放下的倍率：很小的照片最多放大到原尺寸 up 倍（預設 1.5，再大就糊了）。 */
  protected fitScale(bw: number, bh: number, up = 1.5) {
    const { w, h } = this.img!;
    return Math.min(bw / w, bh / h, up);
  }

  /** 照片取樣的 mip 層：照片上用到的像素 ÷ 畫面上的實體像素。 */
  protected lodFor(screenW: number, uvW = 1) {
    return Math.max(0, Math.log2((this.img!.w * uvW) / Math.max(1, screenW * SCALE)));
  }

  /**
   * 照片的 uniform（shader 是模組層共用的，每格都要設）：貼圖、亮度增益、往焦點推的 crop、mip 層。回傳 crop（照片上看到的那一塊）。
   *  - screenW：照片（窗）在畫面上的寬（邏輯 px，含鏡頭縮放）：很小的舊照片照它少推，不推糊。
   *  - k：推到哪裡（0 = 整張，1 = 推到 zoom 倍）；版面給 focusK(t) 這種一開始快、越來越慢的進度。
   *  - zoom：推到最後放大幾倍——實體相片 1.12～1.2（還是要看得出是一整張照片），車窗這種「窗」1.2～1.25。
   * 框跟照片同比例（實體相片完整呈現），所以 k = 0 看到的是整張，焦點永遠在框裡。
   */
  protected setPhoto(u: PhotoUniforms, screenW: number, k: number, zoom = 1.18) {
    const { w, h } = this.img!;
    const crop = focusCrop(this.photo, w, h, w / h, k, { zoom, screenW });
    u.photo!.value = this.tex;
    u.pgain!.value = this.gain;
    (u.crop!.value as THREE.Vector4).set(crop[0], crop[1], crop[2], crop[3]);
    u.lod!.value = this.lodFor(screenW, crop[2] - crop[0]);
    return crop;
  }

  /** 往焦點推的進度：從 t0（照片落定、亮起來的時候；預設窗格開始）起，一開始快、之後越來越慢，3～16 秒的窗格都看得出來。 */
  protected focusK(t: number, t0 = this.ctx.start, tau = 5) { return settleK(t - t0, tau); }

  /** 排好這個窗格的字（init 裡呼叫一次，c 是字層的 ctx）。st.h 是整塊（相簿名＋主字＋署名＋歌詞）的高度上限。 */
  protected makeText(c: CanvasRenderingContext2D, st: BlockStyle) {
    this.st = st;
    this.words = new PhotoText(this.ctx, c, { ...st, h: st.h - this.labelH() });
    if (this.labelH() && st.label) {
      c.font = font(st.label.family, st.label.size);
      c.letterSpacing = `${st.label.tracking ?? 4}px`;
      this.labelW = Math.min(st.w, c.measureText(this.photo.album).width);
      c.letterSpacing = '0px';
    }
    return this.words;
  }
  private labelW = 0;

  /** 主字一個字一個字寫出來：t0 開始、最多 dur 秒寫完，回傳現在寫到第幾個字（署名在寫完才出現；沒有主字是 Infinity）。 */
  protected charsAt(t: number, t0: number, dur = 2) {
    const n = this.words?.chars ?? 0;
    if (!n) return Infinity;
    const t1 = t0 + Math.min(dur, 0.06 * n + 0.3);
    return t >= t1 ? Infinity : Math.floor(Math.max(0, (t - t0) / (t1 - t0)) * n);
  }

  /** 相簿名小標的高度（含跟下面字的間距）；不是章節開頭是 0。 */
  protected labelH() {
    const lb = this.st?.label;
    return this.chapter && lb ? lb.size + (lb.gap ?? 18) : 0;
  }

  /** 字塊的高度（相簿名＋主字＋署名＋歌詞，頂到最後一排的基線；lyricsApart 時不含歌詞）。沒有字是 0。 */
  protected blockH() {
    return this.hasText ? this.labelH() + this.words!.height : 0;
  }

  /** 字塊實際用到的寬（有歌詞時是上限：句子長短不一）。 */
  protected blockW() {
    return this.hasText ? Math.max(this.words!.width, this.labelW) : 0;
  }

  /** 相簿名小標：畫在字塊頂（x 是對齊點）。太長就截斷加「…」，不超過字塊寬。 */
  private paintLabel(c: CanvasRenderingContext2D, x: number, top: number, alpha: number) {
    const st = this.st, lb = st.label;
    if (!this.labelH() || !lb) return;
    c.save();
    c.globalAlpha = alpha;
    if (st.shadow) { c.shadowColor = st.shadow.color; c.shadowBlur = st.shadow.blur; }
    c.font = font(lb.family, lb.size);
    c.fillStyle = lb.color;
    c.letterSpacing = `${lb.tracking ?? 4}px`;
    c.textAlign = st.align ?? 'left';
    let s = this.photo.album;
    while (s.length > 1 && c.measureText(s).width > st.w) s = s.slice(0, -1);
    c.fillText(s === this.photo.album ? s : `${s}…`, x, top + lb.size * 0.9);
    c.restore();
  }

  /**
   * 在字層上畫說明字塊（相簿名＋主字＋署名＋歌詞）。x：對齊點（靠左＝左緣、置中＝中線）；y：anchor 'top' 是字塊頂、'bottom' 是最後一排的基線。
   * chars：主字寫到第幾個字；lyricAlpha：歌詞自己的透明度。內容沒變就不重畫、不重傳，回傳 false。
   * lyricsApart 的版面有主字時改用 paintMain／paintLyrics。
   */
  protected paintBlock(L: Layer2D, t: number, x: number, y: number, o: { anchor?: 'top' | 'bottom'; chars?: number; alpha?: number; lyricAlpha?: number } = {}): boolean {
    const w = this.words;
    if (!w?.has) return false;
    const top = o.anchor === 'bottom' ? y - this.blockH() : y;
    const a = o.alpha ?? 1;
    const drawn = w.draw(L.ctx, t, x, top + this.labelH(), { chars: o.chars, alpha: a, lyricAlpha: o.lyricAlpha, clear: () => { L.clear(); this.paintLabel(L.ctx, x, top, a); } });
    if (drawn) L.upload();
    return drawn;
  }

  /** lyricsApart：只畫相簿名＋主字＋署名（y 是字塊頂）。 */
  protected paintMain(L: Layer2D, x: number, y: number, o: { chars?: number; alpha?: number } = {}): boolean {
    const w = this.words;
    if (!w?.hasMain) return false;
    const a = o.alpha ?? 1;
    const drawn = w.drawMain(L.ctx, x, y + this.labelH(), { chars: o.chars, alpha: a, clear: () => { L.clear(); this.paintLabel(L.ctx, x, y, a); } });
    if (drawn) L.upload();
    return drawn;
  }

  /** lyricsApart：只畫歌詞（自己一張層；y 是歌詞第一排的頂）。 */
  protected paintLyrics(L: Layer2D, t: number, x: number, y: number, o: { alpha?: number } = {}): boolean {
    const w = this.words;
    if (!w?.sung) return false;
    const drawn = w.drawLyrics(L.ctx, t, x, y, { alpha: o.alpha, clear: () => L.clear() });
    if (drawn) L.upload();
    return drawn;
  }
}

/**
 * 把一張 Canvas2D 層貼到畫面上：層的左上角在畫面 (x, y)（邏輯 px），層上 1 px = 畫面 s px。
 * 鏡頭繞 (zx, zy) 放大 z 倍時：x = zx + (x0 - zx) * z、y 同理、s = z。
 */
export function blit(comp: Compositor, renderer: THREE.WebGLRenderer, L: Layer2D, out: THREE.WebGLRenderTarget, x: number, y: number, o: { opacity?: number; s?: number; mode?: 'normal' | 'add' | 'multiply'; tint?: [number, number, number] } = {}) {
  const s = o.s ?? 1;
  comp.draw(renderer, L.texture, out, {
    opacity: o.opacity ?? 1, mode: o.mode, tint: o.tint,
    scale: [W / (s * L.w), H / (s * L.h)],
    offset: [(0.5 * W - x) / (s * L.w) - 0.5, 0.5 - (0.5 * H - y) / (s * L.h)],
  });
}

/** 鏡頭（繞 zc 放大 z 倍、再平移 pan）：場景座標 → 畫面座標。 */
export const camXY = (x: number, y: number, z: number, zx: number, zy: number, px = 0, py = 0): [number, number] => [zx + (x - zx) * z + px, zy + (y - zy) * z + py];

/**
 * 這一批 shader 共用的 GLSL（FSPass 自帶 GLSL_COMMON，接在它後面）。用到的 pass 要有 uniform：photo、lod、pgain、crop（每格用 setPhoto 設）。
 *  - photoAt(uv)：照片（uv 0..1 是相片框裡的位置、左上原點，對應到照片上 crop 那一塊：往焦點推），sRGB → 線性，
 *    最亮壓在 0.82（暗照片乘 pgain 最多到 0.92）：白紗、天空不會被 bloom 打到。
 *  - layerAt(tex, uv)：fast 的 Canvas2D 層（預乘、sRGB 編碼、flipY）；uv 是層上的位置（0..1、左上原點），出界是透明。
 *  - printAt(q, hs, b, white)：實體相片（白邊 b）；q 是相片座標（中心原點、已經轉正），回傳 rgb 與覆蓋率。
 *  - shadowAt(d, blur)：軟影子（d 是到物件的距離，裡面是 1）。
 *  - fireCol(x)：真的火的顏色（固定暖色，不跟主題換）。
 */
export const P7_GLSL = /* glsl */ `
uniform sampler2D photo; uniform float lod; uniform float pgain; uniform vec4 crop;
vec3 photoAt(vec2 uv) { return toLinear(textureLod(photo, mix(crop.xy, crop.zw, clamp(uv, 0.0, 1.0)), lod).rgb) * 0.82 * pgain; }
vec4 layerAt(sampler2D tex, vec2 uv) {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  return fastLayer(textureLod(tex, vec2(uv.x, 1.0 - uv.y), 0.0));
}
float shadowAt(float d, float blur) { return d < 0.0 ? 1.0 : exp(-d / blur); }
// 真的火（營火、燃燒器）：固定的暖色（從 fur 暖橘來），不跟主題換——換到鼠尾草、薰衣草主題，火也不能變綠、變紫。
// x：0 = 沒有，0.3 = 深橘紅的火根，0.55 = 橘，0.8 = 黃，1 = 白熱。只有火要發光時才乘到 > 1。
vec3 fireCol(float x) {
  vec3 deep = C_FUR * vec3(0.55, 0.22, 0.1);
  vec3 mid = C_FUR * vec3(1.2, 1.05, 0.6);
  vec3 hot = mix(C_FUR, vec3(1.0, 0.9, 0.62), 0.65);
  vec3 c = deep * smoothstep(0.0, 0.3, x);
  c = mix(c, mid, smoothstep(0.25, 0.55, x));
  c = mix(c, hot, smoothstep(0.55, 0.8, x));
  return mix(c, vec3(1.0, 0.95, 0.86), smoothstep(0.8, 1.0, x));
}
vec4 printAt(vec2 q, vec2 hs, float b, vec3 white) {
  float d = sdBox(q, hs + vec2(b));
  float a = 1.0 - smoothstep(-0.8, 0.8, d);
  if (a <= 0.0) return vec4(0.0);
  vec3 pr = white * (1.0 - 0.07 * smoothstep(-2.5, 0.0, d));
  float di = sdBox(q, hs);
  float ai = 1.0 - smoothstep(-0.7, 0.7, di);
  if (ai > 0.0) {
    vec2 uv = (q + hs) / (2.0 * hs);
    vec3 ph = photoAt(uv);
    // 相紙的光澤：很淡的一道斜光
    ph += white * 0.02 * smoothstep(0.3, 0.0, abs(uv.x - uv.y * 0.6 - 0.25));
    pr = mix(pr, ph, ai);
  }
  return vec4(pr, a);
}
`;
