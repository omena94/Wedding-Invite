// P5「光影與自然」照片版面共用的小工具（blinds、reflection、clouds、starfield、candle、fog、petals、rainwindow、snowdome、sunset）。
// 檔名 _ 開頭，不會被當成版面。
//  - PhotoScene：載照片、做貼圖、判斷這個窗格有沒有字（留言、註解或歌詞）；crop() 往焦點推。
//  - TextBlock：照片窗格的字（_photo.ts 的 PhotoText：主字＝留言＋署名或註解，歌詞小一號跟唱）＋相簿名（章節開頭），
//    畫在一小張 Canvas2D 上，只在內容變的時候重畫；整塊放不進說明的位置時歌詞另外放成字幕（lyricsApart）。
//  - 照片的擺法：containSize（完整放、很小的照片最多放大 1.5 倍）、coverable（橫的、夠大的才滿版）。
//  - P5_GLSL：照片取樣（壓亮度、不發光）、模糊版、往焦點推的 uv、文字層取樣。
import * as THREE from 'three';
import { Scene, type SceneCtx } from '../engine/scene';
import { Layer2D, W, H, SCALE, type Compositor } from '../engine/gl';
import { font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp } from '../engine/util';
import type { AudioData } from '../engine/audio';
import { lyricAt, layoutLyric } from './_motifs';
import { focusCrop, loadWords, photoTexture, photoWords, PhotoText, type PhotoTextStyle, type PhotoWords } from './_photo';
import type { PhotoRef, PhotoImage } from '../photos';

/** 照片版面的基本款：init() 裡先 `await this.loadPhoto()`。 */
export abstract class PhotoScene extends Scene {
  photo: PhotoRef = this.ctx.params.photo;
  seed = Number(this.ctx.params.seed ?? 1);
  img!: PhotoImage;
  tex!: THREE.Texture;
  /** 這個窗格有哪些字（主字是留言、註解或沒有；有沒有歌詞要唱）。 */
  words!: PhotoWords;
  /** 有沒有字（留言、註解或歌詞）；都沒有就只有照片（照片移到正中間，不留空的說明欄）。 */
  hasText = false;

  protected async loadPhoto(extraText = '') {
    const ph = this.photo;
    // 照片版面只排在照片窗格（導演一定給 params.photo）；沒有就讓引擎跳過這個窗格，不要畫一半
    if (!ph) throw new Error('照片版面要有 params.photo');
    await loadText(`${ph.caption}${ph.album}${extraText}`);
    await loadWords(this.ctx);
    this.img = await ph.load();
    this.tex = this.track(photoTexture(this.img));
    // 先上傳到顯示卡（不要拖到第一格才傳，切版面時會停一下）
    this.ctx.renderer.initTexture(this.tex);
    this.words = photoWords(this.ctx);
    this.hasText = this.words.kind !== 'none' || this.words.lyrics;
  }

  /**
   * 往焦點推（ENGINE.md「焦點」）：照片在框裡要看哪一塊（_photo.ts 的 focusCrop）。k 是 settleK(lt) 這種進度；
   * screenW 是框在畫面上的寬（很小的照片自動少推，不推糊）；aspect 預設跟照片同比例（完整放）。
   * shader 用 p5Crop(uv, crop) 把框裡的 uv 對應到這一塊，mip 層用 cropLod。
   */
  protected crop(k: number, screenW: number, zoom = 1.2, aspect = this.img.w / this.img.h, reverse = false) {
    return focusCrop(this.photo, this.img.w, this.img.h, aspect, k, { zoom, screenW, reverse });
  }

  /** 框裡放 crop 那一塊、框在畫面上 screenW 寬時的 mip 層。 */
  protected cropLod(crop: readonly number[], screenW: number) { return this.lod((crop[2]! - crop[0]!) * this.img.w, screenW); }

  /**
   * 很暗的照片（平均亮度 < 0.3）把暗部提一點，照片才不悶（p5Photo 只提暗部、亮部不動，照樣不發光）。
   * 不知道亮度（開發用的假照片、舊資料）就是 1。版面每格設 `u.pgain = this.gain`（shader 是共用的）。
   */
  get gain() {
    const l = this.photo.lum;
    return l == null || l >= 0.3 ? 1 : Math.min(1.35, 1 + (0.3 - l) * 1.6);
  }

  /** 照片在畫面上 `screenPx` 寬時該取樣的 mip 層（照片用到 `texPx` 個像素）。 */
  protected lod(texPx: number, screenPx: number) { return Math.max(0, Math.log2(texPx / Math.max(1, screenPx * SCALE))); }
}

// ---------------------------------------------------------------- 照片的擺法
/** 橫的、夠大（滿版不用放大超過約 1.6 倍）才滿版；直的、方的、很小的舊照片完整放。 */
export const coverable = (w: number, h: number) => w / h >= 1.25 && w >= W / 1.6;

/** 完整放進 maxW × maxH：很小的照片最多放大到原尺寸 `maxUp` 倍（再大就糊了）。 */
export function containSize(w: number, h: number, maxW: number, maxH: number, maxUp = 1.5) {
  const s = Math.min(maxW / w, maxH / h, maxUp);
  return { w: w * s, h: h * s, s };
}

// ---------------------------------------------------------------- 節拍
/** t 以前（含）最近 n 個拍點（bars = true 只算小節線）的時間，新的在前。 */
export function pastBeats(au: AudioData, t: number, n: number, bars = false): number[] {
  const out: number[] = [];
  const i = Math.floor((bars ? au.barAt(t) : au.beatAt(t)) + 1e-6);
  for (let k = 0; k < n; k++) out.push(bars ? au.timeOfBar(i - k) : au.timeOfBeat(i - k));
  return out;
}

// ---------------------------------------------------------------- 鏡頭與貼上
/** 2D 鏡頭：畫面 = c + (世界 − c) × z + d（繞 c 推近、再平移）。 */
export interface Cam2 { z: number; cx: number; cy: number; dx: number; dy: number }
export const CAM0: Cam2 = { z: 1, cx: W / 2, cy: H / 2, dx: 0, dy: 0 };

/** 把一張放在世界座標 (x, y)、大小 lw × lh 的 Layer2D 貼到畫面上（跟著鏡頭推近、平移）。 */
export function blitLayer(comp: Compositor, renderer: THREE.WebGLRenderer, L: Layer2D, out: THREE.WebGLRenderTarget, x: number, y: number, opacity: number, cam: Cam2 = CAM0, tint?: [number, number, number]) {
  const lw = L.w, lh = L.h, z = cam.z;
  const sx = W / (z * lw), sy = H / (z * lh);
  const ox = (cam.cx - x - (cam.dx + cam.cx) / z) / lw + 0.5 * sx - 0.5;
  const K = (cam.cy - y - (cam.dy + cam.cy) / z) / lh;
  const oy = 0.5 - K - 0.5 * sy;
  comp.draw(renderer, L.texture, out, { opacity, scale: [sx, sy], offset: [ox, oy], tint });
}

// ---------------------------------------------------------------- 字：主字（留言或註解）＋歌詞＋相簿名
export interface Box { x: number; y: number; w: number; h: number }
export interface TextStyle {
  family: string;
  /** 主字（留言、註解）的字級範圍（預設 40～50）、行高、最多幾行（預設 4；窄的側欄給 5，60 字的留言才不會縮到 40 以下）。 */
  min?: number; max?: number; lineHeight?: number; maxLines?: number;
  align?: 'left' | 'center' | 'right';
  tracking?: number;
  /** 主字與唱完的歌詞、還沒唱的歌詞、正在唱的字（預設訊號色）。 */
  color: string; unsung: string; active?: string;
  /** 署名（只有留言有）：字族（預設主字的）、字級（預設 28）、顏色（預設主字的）。 */
  sigFamily?: string; sigSize?: number; sigColor?: string;
  /** 歌詞：沒有主字、歌詞自己當主字時的字級（預設 48）；在主字下面當字幕時（預設 38）。 */
  lyricSize?: number; lyricSubSize?: number;
  /** 字邊緣一圈很淡的暗影（字在照片或亮處上照樣清楚，不是框）。 */
  shadow?: { color: string; blur: number };
  /** 相簿名（章節開頭才有）：小標籤，`rule` 是上面一條短線的顏色。 */
  label?: { family: string; size: number; color: string; tracking?: number; rule?: string };
}

/**
 * 歌詞另外放（PhotoText 的 lyricsApart）：主字＋署名留在說明的位置，歌詞像字幕放在 box（世界座標），
 * 這一句的最後一排基線貼框底（折兩行時往上長），位置固定、不跟著句子跳。
 * always：有主字又有歌詞就一定分開；沒寫的話只有整塊（主字＋署名＋歌詞）放不進說明的位置才分開。
 * size：歌詞字級（預設 40：自己一塊、離主字遠，比 PhotoText 在主字下面的 38 大一點點，仍比主字小）。
 */
export interface ApartOpts { box: Box; align?: 'left' | 'center' | 'right'; size?: number; always?: boolean }

/** 文字層比框多留的邊（暗影不會被切掉）。 */
const PAD = 36;

/**
 * 照片窗格的字＋相簿名，畫在一小張 fast Canvas2D 上（規則在 _photo.ts 的 PhotoText，這裡只管擺在哪裡）：
 *  - 有主字（留言＋署名，或註解）：主字在上，歌詞小一號在下面跟唱；沒有主字：歌詞自己當主字。
 *  - 整塊的高度照這個窗格最長的那句歌詞預留，換句子時字不會跳出框；主字在剩下的高度裡縮字、折行。
 *  - 放不進（或版面指定）時歌詞另外放成字幕（apart），主字留在說明的位置。
 * valign：top = 從框頂往下排；center = 置中；bottom = 最後一行貼框底（字幕）。
 * 文字層在世界座標的位置是 (layerX, layerY)，用 blit() 或在自己的 shader 裡取樣（p5Text）。
 */
export class TextBlock {
  L: Layer2D;
  /** 主字＋署名＋歌詞（歌詞另外放時只有主字＋署名）。 */
  pt: PhotoText;
  /** 歌詞另外放時：歌詞自己的一層、排版（寬度是字幕框的）、設定。 */
  LL: Layer2D | null = null;
  private ptL: PhotoText | null = null;
  apart: ApartOpts | null = null;
  private label = '';
  private labelW = 0;
  /** 實際用到的寬：主字、署名、相簿名、這個窗格最寬的那句歌詞（在這一塊裡時）裡最寬的。area() 用它（不用整個框寬，字後面才不會壓暗一大條）。 */
  private inkW = 0;

  constructor(private ctx: SceneCtx, public box: Box, public st: TextStyle, public valign: 'top' | 'center' | 'bottom' = 'top', apart?: ApartOpts) {
    this.L = new Layer2D(box.w + 2 * PAD, box.h + 2 * PAD, undefined, { fast: true });
    const c = this.L.ctx;
    const photo = ctx.params.photo as PhotoRef;
    if (photo.chapter && photo.album && st.label) {
      c.font = font(st.label.family, st.label.size);
      c.letterSpacing = `${st.label.tracking ?? 0}px`;
      let s = photo.album;
      while (s.length > 1 && c.measureText(s).width > box.w) s = s.slice(0, -1);
      this.label = s === photo.album ? s : `${s}…`;
      this.labelW = c.measureText(this.label).width;
      c.letterSpacing = '0px';
    }
    const h = box.h - this.labelH();
    const style = (w: number, hh: number, lyricsApart: boolean): PhotoTextStyle => ({
      family: st.family, w, h: hh, min: st.min, max: st.max, lineHeight: st.lineHeight, maxLines: st.maxLines,
      align: st.align, tracking: st.tracking, ink: st.color, unsung: st.unsung, active: st.active,
      sigFamily: st.sigFamily, sigSize: st.sigSize, sigInk: st.sigColor,
      lyricSize: st.lyricSize, lyricSubSize: st.lyricSubSize, shadow: st.shadow ?? null, lyricsApart,
    });
    let pt = new PhotoText(ctx, c, style(box.w, h, false));
    // 主字＋署名＋歌詞整塊放不進：主字縮到最小還是太高、超過行數或太寬
    const over = (p: PhotoText) => !!p.fit && (p.height > h + 1 || p.fit.lines.length > (st.maxLines ?? 4) || p.fit.width > box.w * 1.001);
    if (apart && pt.hasMain && pt.sung && (apart.always || over(pt))) {
      pt = new PhotoText(ctx, c, style(box.w, h, true));
      this.apart = apart;
      this.LL = new Layer2D(apart.box.w + 2 * PAD, apart.box.h + 2 * PAD, undefined, { fast: true });
      // 字幕的歌詞照字幕框的寬排（不是說明欄的寬），只用它的 drawLyrics
      this.ptL = new PhotoText(ctx, this.LL.ctx, {
        ...style(apart.box.w, apart.box.h, true), align: apart.align ?? 'center', lyricSubSize: apart.size ?? 40,
      });
    }
    this.pt = pt;
    let iw = Math.max(this.labelW, pt.fit?.width ?? 0);
    if (pt.words.sig) {
      c.font = font(st.sigFamily ?? st.family, st.sigSize ?? 28);
      iw = Math.max(iw, c.measureText(pt.words.sig).width);
    }
    if (pt.sung && !this.ptL) {
      const ls = pt.lyricStyle();
      for (const ln of ctx.lyrics.linesIn(ctx.start, ctx.end)) {
        const lay = layoutLyric(c, ln, ls);
        for (const r of [...lay.rows, ...(lay.sub?.lay.rows ?? [])]) iw = Math.max(iw, r.width);
      }
    }
    this.inkW = Math.min(box.w, iw);
  }

  get layerX() { return this.box.x - PAD; }
  get layerY() { return this.box.y - PAD; }
  /** 文字層在世界座標的範圍 (x, y, w, h)。 */
  get rect(): [number, number, number, number] { return [this.layerX, this.layerY, this.L.w, this.L.h]; }
  dispose() { this.L.dispose(); this.LL?.dispose(); }

  private labelH() { return this.label && this.st.label ? this.st.label.size + 24 + (this.st.label.rule ? 22 : 0) : 0; }

  /** 整塊（相簿名＋主字＋署名＋歌詞；歌詞另外放時不含歌詞）的高度：第一行的頂到最後一行的基線附近。 */
  get height() { return this.labelH() + this.pt.height; }

  /** 整塊的頂（世界座標，依 valign）。 */
  get top() {
    const b = this.box, h = this.height;
    return this.valign === 'top' ? b.y : this.valign === 'bottom' ? b.y + b.h - h : b.y + (b.h - h) / 2;
  }

  private alignX() {
    const b = this.box, a = this.st.align ?? 'left';
    return a === 'left' ? b.x : a === 'right' ? b.x + b.w : b.x + b.w / 2;
  }

  /**
   * 字實際佔的範圍（世界座標 x0, y0, x1, y1，含相簿名）：給 shader 在字後面很淡地壓暗（照片很亮時字照樣清楚，不是框）。
   * 歌詞在這一塊裡時每句寬度不一樣：用這個窗格最寬的那句（範圍不會跟著句子跳）。
   */
  area(): [number, number, number, number] {
    const b = this.box, a = this.st.align ?? 'left';
    const w = Math.min(b.w, this.inkW + (this.st.tracking ?? 0) * 2);
    const x0 = a === 'left' ? b.x : a === 'right' ? b.x + b.w - w : b.x + (b.w - w) / 2;
    const y0 = this.top;
    return [x0, y0, x0 + w, y0 + this.height];
  }

  /** 歌詞另外放時字幕的範圍（世界座標 x0, y0, x1, y1；照最長的那句預留）；沒有另外放是 null。 */
  lyricArea(): [number, number, number, number] | null {
    if (!this.apart || !this.ptL) return null;
    const b = this.apart.box;
    return [b.x, b.y + b.h - this.ptL.lyricH, b.x + b.w, b.y + b.h];
  }

  private paintLabel() {
    const lb = this.st.label;
    if (!this.label || !lb) return;
    const c = this.L.ctx, align = this.st.align ?? 'left';
    const ax = this.alignX() - this.layerX;
    let y = this.top - this.layerY;
    c.save();
    if (this.st.shadow) { c.shadowColor = this.st.shadow.color; c.shadowBlur = this.st.shadow.blur; }
    if (lb.rule) {
      c.fillStyle = lb.rule;
      c.fillRect(align === 'left' ? ax : align === 'right' ? ax - 40 : ax - 20, y, 40, 2);
      y += 22;
    }
    c.font = font(lb.family, lb.size);
    c.letterSpacing = `${lb.tracking ?? 0}px`;
    c.textAlign = align;
    c.textBaseline = 'alphabetic';
    c.fillStyle = lb.color;
    c.fillText(this.label, ax, y + lb.size * 0.9);
    c.letterSpacing = '0px';
    c.restore();
  }

  /**
   * 畫這一格（內容沒變就不重畫、不上傳）。reveal：主字寫出了幾成（0..1，一個字一個字出現，署名在主字寫完才出現；預設 1）。
   * 歌詞照常逐字跟唱。回傳有沒有東西可以貼。
   */
  draw(t: number, reveal = 1): boolean {
    const pt = this.pt;
    if (!pt.has) return false;
    const chars = reveal >= 1 ? Infinity : Math.floor(clamp(reveal) * pt.chars);
    const L = this.L, c = L.ctx;
    const x = this.alignX() - this.layerX, top = this.top - this.layerY + this.labelH();
    const clear = () => { L.clear(); this.paintLabel(); };
    if (this.ptL ? pt.drawMain(c, x, top, { chars, clear }) : pt.draw(c, t, x, top, { chars, clear })) L.upload();
    const LL = this.LL, pl = this.ptL, ap = this.apart;
    if (LL && pl && ap) {
      const b = ap.box, a = ap.align ?? 'center';
      const lx = PAD + (a === 'left' ? 0 : a === 'right' ? b.w : b.w / 2);
      // 這一句的最後一排基線貼框底（折兩行時往上長）
      const ly = lyricAt(this.ctx.lyrics, t, 6);
      const lh = ly ? layoutLyric(LL.ctx, ly.line, pl.lyricStyle()).height : pl.lyricH;
      if (pl.drawLyrics(LL.ctx, t, lx, PAD + b.h - lh, { clear: () => LL.clear() })) LL.upload();
    }
    return true;
  }

  /**
   * 貼到畫面上（跟著鏡頭）。歌詞另外放時字幕另外貼：lyricOpacity（預設跟 opacity 一樣）、
   * lyricCam（預設不跟鏡頭：字幕固定在畫面上，不會被推出邊）。
   */
  blit(comp: Compositor, renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, opacity: number, cam: Cam2 = CAM0, lyricOpacity = opacity, lyricCam: Cam2 = CAM0) {
    if (opacity > 0.002) blitLayer(comp, renderer, this.L, out, this.layerX, this.layerY, opacity, cam);
    if (this.LL && this.apart && lyricOpacity > 0.002) blitLayer(comp, renderer, this.LL, out, this.apart.box.x - PAD, this.apart.box.y - PAD, lyricOpacity, lyricCam);
  }
}

/** 暗版面的字：紙白、邊緣一圈很淡的暗影；署名淡一點。 */
export const DARK_TEXT = (family: string, o: Partial<TextStyle> = {}): TextStyle => ({
  family, color: rgba('bone', 0.96), unsung: rgba('bone', 0.34), sigColor: rgba('bone', 0.78), shadow: { color: rgba('ink', 0.75), blur: 14 },
  label: { family, size: 24, color: rgba('ash', 0.92), tracking: 6, rule: rgba('signal', 0.8) }, ...o,
});

// ---------------------------------------------------------------- GLSL
/**
 * 版面 shader 前面接上：p5Photo（照片取樣：sRGB → 線性、最亮壓在 0.84，白紗、天空不發光；很暗的照片用 pgain 提暗部，
 * 所以每個用 P5_GLSL 的 pass 都要有 `pgain: { value: 1 }`）、
 * p5Blur（模糊版：高 mip 層再加一圈取樣，不會看到方塊）、p5Crop（框裡的 uv 對應到往焦點推的那一塊：PhotoScene.crop()）、
 * p5Text（文字層取樣：rect = 世界座標的 x, y, w, h，y 向下）。
 * 一律 textureLod（照片有 mipmap，分支與迴圈裡的導數沒有定義）。
 */
export const P5_GLSL = /* glsl */ `
uniform float pgain;
vec2 p5Crop(vec2 uv, vec4 crop) { return crop.xy + uv * (crop.zw - crop.xy); }
vec3 p5Photo(sampler2D tex, vec2 uv, float lod) {
  vec3 c = toLinear(textureLod(tex, clamp(uv, 0.0, 1.0), lod).rgb) * 0.84;
  // 很暗的照片：只提暗部（亮部不動，最亮還是 0.84）
  return c * (1.0 + (pgain - 1.0) * (1.0 - smoothstep(0.2, 0.75, luma(c))));
}
vec3 p5Blur(sampler2D tex, vec2 uv, float lod, vec2 r) {
  vec3 b = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 2.39996, rr = sqrt(float(i) + 0.5) / 2.9;
    b += p5Photo(tex, uv + vec2(cos(a), sin(a)) * rr * r, lod);
  }
  return b / 8.0;
}
vec4 p5Text(sampler2D tex, vec2 p, vec4 rect) {
  vec2 uv = (p - rect.xy) / rect.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  return fastLayer(textureLod(tex, vec2(uv.x, 1.0 - uv.y), 0.0));
}
// 字後面壓暗：r = 字的範圍 (x0, y0, x1, y1)，邊緣很軟（不是框）。只壓亮的地方（照片的天空、白紗）：
// 本來就暗的背景幾乎不動，亮的背景壓到紙白的字清楚為止。回傳壓過的顏色
vec3 p5Shade(vec3 col, vec2 p, vec4 r, float k) {
  vec2 c = (r.xy + r.zw) * 0.5, hs = (r.zw - r.xy) * 0.5;
  // 圓角很大、往外兩百多 px 才退完：霧、天空這種一整片均勻的亮底上也看不出一個方塊
  float rr = min(min(hs.x, hs.y), 90.0);
  float d = sdBox(p - c, max(hs - rr, vec2(0.0))) - rr;
  float m = 1.0 - smoothstep(-50.0, 220.0, d);
  return col * (1.0 - k * m * m * smoothstep(0.02, 0.22, luma(col)));
}
// 畫面像素（y 向下的邏輯 px）
vec2 p5Px() { return vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y); }
`;
