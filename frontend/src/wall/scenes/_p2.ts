// P2「相框與牆」這一批照片版面（woodframe、ornate、pegboard、clothesline、fridge、stairwall、digitalframe、windowsill、mirror、shadowbox）共用的工具。
// 檔名 _ 開頭，不會被當成版面。規則見 docs/wall/ENGINE.md「照片版面」：
//  - 照片在 init() 做成貼圖、先傳到顯示卡；取樣一律 textureLod、自己轉線性、乘 0.82（白紗、天空不能被 bloom 打到）。
//  - 字：主字（賓客留言＋署名，或新人的註解）＋跟唱的歌詞（_photo.ts 的 PhotoText），外加章節開頭的一行小小的相簿名；
//    兩樣都沒有就只有照片。
//  - 焦點：照片在框裡的畫面往新人點的臉推（focusCrop），實體相片再加鏡頭往臉那邊靠（字一直留在畫面的安全區裡）。
//  - 鏡頭是 2D 的推、搖：畫面座標 = (世界座標 − 鏡頭中心) × zoom + 畫面中心；字的圖層跟著同一個鏡頭貼上去。
import * as THREE from 'three';
import type { SceneCtx } from '../engine/scene';
import { type Layer2D, type Compositor, W, H, SCALE } from '../engine/gl';
import { font } from '../engine/type';
import { clamp } from '../engine/util';
import { HUD_SAFE } from '../engine/hud';
import { layoutLyric } from './_motifs';
import { photoTexture, PhotoText, type PhotoTextStyle } from './_photo';
import type { PhotoRef, PhotoImage } from '../photos';

/** 解碼好、傳到顯示卡的一張照片。 */
export interface P2Photo { ref: PhotoRef; img: PhotoImage; tex: THREE.Texture; w: number; h: number }

/**
 * 照片做成貼圖（`track` 傳版面的 this.track：窗格結束時釋放；照片池的圖不能 close）。
 * 照片版面只排在照片窗格，導演一定給 params.photo；沒有就丟錯讓引擎跳過這個窗格，不要畫一半。
 */
export async function loadPhotos(ctx: SceneCtx, track: <T extends { dispose(): void }>(x: T) => T, n = 1): Promise<P2Photo[]> {
  const main: PhotoRef | undefined = ctx.params.photo;
  if (!main) throw new Error('照片版面要有 params.photo');
  const refs: PhotoRef[] = n > 1 ? (ctx.params.photos as PhotoRef[] | undefined)?.slice(0, n) ?? [main] : [main];
  if (refs[0] !== main) refs.unshift(main);
  // 張數不夠（照理不會發生：導演只在照片池準備好時才排多張的版面）就重複主角，版面照樣畫得出來
  while (refs.length < n) refs.push(refs[refs.length - 1]!);
  const out: P2Photo[] = [];
  for (const ref of refs) {
    const img = await ref.load();
    const tex = track(photoTexture(img));
    ctx.renderer.initTexture(tex);
    out.push({ ref, img, tex, w: img.w, h: img.h });
  }
  return out;
}

/** 照片放進 maxW × maxH 的框（完整、不裁）：很小的舊照片最多放大到原尺寸 1.5 倍。 */
export function fitIn(w: number, h: number, maxW: number, maxH: number, up = 1.5) {
  const s = Math.min(maxW / w, maxH / h, up);
  return { w: w * s, h: h * s, s };
}

/** 照片取樣的 mip 層：照片上用到的像素 ÷ 畫面上的實體像素。 */
export const mipLod = (srcPx: number, screenPx: number) => Math.max(0, Math.log2(srcPx / Math.max(1, screenPx * SCALE)));

/**
 * 畫面上的一個 Layer2D（字的圖層）跟著鏡頭貼上去：圖層左上角在世界座標 (x, y)，
 * 鏡頭中心 (camX, camY)、放大 z。z = 1、鏡頭在畫面中心時就是原地貼上。
 */
export function drawLayer(comp: Compositor, renderer: THREE.WebGLRenderer, L: Layer2D, out: THREE.WebGLRenderTarget, x: number, y: number, cam: { x: number; y: number; z: number }, opacity = 1) {
  const z = cam.z;
  const X = (x - cam.x) * z + W / 2, Y = (y - cam.y) * z + H / 2;
  const sx = W / (L.w * z), sy = H / (L.h * z);
  comp.draw(renderer, L.texture, out, { opacity, scale: [sx, sy], offset: [0.5 * sx - 0.5 - X / (L.w * z), 0.5 - 0.5 * sy + Y / (L.h * z)] });
}

/** 世界座標 → 畫面座標（檢查字有沒有進 HUD 區、離邊夠不夠用）。 */
export const toScreen = (x: number, y: number, cam: { x: number; y: number; z: number }) => ({ x: (x - cam.x) * cam.z + W / 2, y: (y - cam.y) * cam.z + H / 2 });

// ---------------------------------------------------------------- 字（主字＋歌詞）

export interface CapStyle extends PhotoTextStyle {
  /** 章節開頭的相簿名（小標籤，主字上面）；null = 不印。 */
  label?: { family: string; size: number; color: string; tracking?: number; gap?: number } | null;
}

/**
 * 這一批照片版面的字：_photo.ts 的 PhotoText（主字＝賓客留言＋署名或新人的註解，歌詞小一號在下面跟唱；
 * 沒有主字時歌詞自己當主字）包一層，多兩件事：
 *  - 章節開頭的相簿名小標籤（在整塊最上面）。
 *  - 主字一個字一個字寫出來（writeFrom）；署名在主字寫完才出現（PhotoText 管）。
 * 兩樣都沒有時 on = false：版面把照片移到正中間，不留空的卡片、空的說明欄。
 * 歌詞放不進物件上的小位置時（st.lyricsApart），主字留在物件上（draw），歌詞另外畫（drawLyrics，位置固定）。
 */
export class Caption {
  text: PhotoText;
  label = '';
  /** 相簿名那一行佔的高度（含跟下面字的間距）。 */
  labelH = 0;
  /** 逐字寫出來的開始、結束時間（tW1 ≤ tW0 = 一次出現）。 */
  tW0 = 0; tW1 = 0;
  /** 實際用到的寬度（相簿名、主字、署名、這個窗格每一句歌詞裡最寬的）：卡片、牌子照它的大小做。 */
  width = 0;

  constructor(ctx: SceneCtx, c: CanvasRenderingContext2D, public st: CapStyle) {
    const tx = (this.text = new PhotoText(ctx, c, st));
    const ph = ctx.params.photo as PhotoRef | undefined;
    if (tx.has && st.label && ph?.chapter && ph.album) {
      const lb = st.label;
      c.font = font(lb.family, lb.size);
      c.letterSpacing = `${lb.tracking ?? 0}px`;
      let s = ph.album;
      while (s.length > 1 && c.measureText(s).width > st.w) s = s.slice(0, -1);
      this.label = s === ph.album ? s : `${s}…`;
      this.width = c.measureText(this.label).width;
      c.letterSpacing = '0px';
      this.labelH = lb.size + (lb.gap ?? 22);
    }
    // PhotoText 的 width 在有歌詞時給上限（句子長短不一）；卡片要剛好包住字，所以自己量這個窗格裡每一句
    if (tx.fit) {
      this.width = Math.max(this.width, tx.fit.width);
      if (tx.words.sig) { c.font = font(st.sigFamily ?? st.family, tx.sigSize); this.width = Math.max(this.width, c.measureText(tx.words.sig).width); }
    }
    if (tx.sung && !this.apart) {
      const ls = tx.lyricStyle();
      for (const ln of ctx.lyrics.linesIn(ctx.start, ctx.end)) {
        const lay = layoutLyric(c, ln, ls);
        this.width = Math.max(this.width, ...lay.rows.map((r) => r.width), ...(lay.sub ? lay.sub.lay.rows.map((r) => r.width) : []));
      }
    }
    this.width = Math.min(Math.ceil(this.width), st.w);
  }

  /** 有沒有任何字（沒有的話版面不留說明欄）。 */
  get on() { return this.text.has; }
  get mode() { return this.text.mode; }
  /** 歌詞另外放（版面要了 lyricsApart，而且這一格主字、歌詞都有）。 */
  get apart() { return !!this.st.lyricsApart && this.text.hasMain && this.text.sung; }
  /** 整塊（相簿名＋主字＋署名＋歌詞；apart 時沒有歌詞）的高度：頂到最後一排基線。 */
  get height() { return this.labelH + this.text.height; }
  /** 主字（沒有主字時是歌詞）的字級、行距：排格線、算留白用。 */
  get size() { return this.text.size; }
  get lineHeight() { return this.text.fit ? this.text.fit.lineHeight : this.text.size * (this.st.lineHeight ?? 1.3); }

  /** 主字一個字一個字寫出來：從 t0 開始，最多 maxDur 秒寫完（長留言也不能寫太久，要留時間讀）。 */
  writeFrom(t0: number, maxDur = 2) {
    if (!this.text.hasMain) return;
    this.tW0 = t0;
    this.tW1 = t0 + Math.min(maxDur, 0.06 * this.text.chars + 0.3);
  }

  /** t 時主字寫到第幾個字。 */
  charsAt(t: number) {
    const n = this.text.chars;
    if (this.tW1 <= this.tW0 || t >= this.tW1) return n;
    return Math.floor(clamp((t - this.tW0) / (this.tW1 - this.tW0)) * n);
  }

  /**
   * 畫到圖層的 (x, y)：這一塊的頂（x 是對齊點：靠左＝左緣、置中＝中線）。內容沒變就不重畫；回傳 true = 重畫了（呼叫的人要 upload）。
   * apart 時只畫相簿名＋主字＋署名，歌詞用 drawLyrics 另外畫。
   */
  draw(L: Layer2D, x: number, y: number, t: number): boolean {
    const clear = () => { L.clear(); this.paintLabel(L.ctx, x, y); };
    const o = { chars: this.charsAt(t), clear };
    return this.apart ? this.text.drawMain(L.ctx, x, y + this.labelH, o) : this.text.draw(L.ctx, t, x, y + this.labelH, o);
  }

  /** apart 時的歌詞：(x, y) 是第一排的頂（自己一張圖層）。高度是 text.lyricH。 */
  drawLyrics(L: Layer2D, x: number, y: number, t: number): boolean {
    return this.text.drawLyrics(L.ctx, t, x, y, { clear: () => L.clear() });
  }

  private paintLabel(c: CanvasRenderingContext2D, x: number, y: number) {
    const lb = this.st.label;
    if (!this.label || !lb) return;
    c.save();
    c.font = font(lb.family, lb.size);
    c.letterSpacing = `${lb.tracking ?? 0}px`;
    c.fillStyle = lb.color;
    c.textAlign = this.st.align ?? 'left';
    c.textBaseline = 'alphabetic';
    c.fillText(this.label, x, y + lb.size * 0.9);
    c.restore();
  }
}

// ---------------------------------------------------------------- 焦點、鏡頭

/** 畫面上字可以放的範圍：離四邊 ≥ 96 px，右下角的 HUD 區不能進。 */
export const SAFE = 96;

/**
 * 鏡頭往某一點靠（實體相片：往相片上的臉推），但字（世界座標的方框 [x0, y0, x1, y1]）要一直在畫面的安全區裡：
 * 離四邊 ≥ 96 px、右下角 HUD 區不能進。先照想要的中心算，再把中心夾回「字放得下」的範圍。
 * 字比安全區還大時（理論上不會），以靠左、靠上為準。
 */
export function keepIn(cam: { x: number; y: number; z: number }, boxes: readonly (readonly number[] | null)[]): { x: number; y: number; z: number } {
  let { x, y } = cam;
  const z = cam.z;
  const hx = (W / 2 - SAFE) / z, hy = (H / 2 - SAFE) / z;
  for (const b of boxes) {
    if (!b) continue;
    // 畫面座標 = (世界 − 鏡頭) × z + 畫面中心 → 世界 x0 在畫面上 ≥ SAFE ⇔ 鏡頭 x ≤ x0 + hx
    x = Math.min(b[0]! + hx, Math.max(b[2]! - hx, x));
    y = Math.min(b[1]! + hy, Math.max(b[3]! - hy, y));
    // 字的右緣進到 HUD 那一欄時，下緣要在 HUD 上面
    const sx1 = (b[2]! - x) * z + W / 2;
    if (sx1 > HUD_SAFE.x) y = Math.max(y, b[3]! - (HUD_SAFE.y - 6 - H / 2) / z);
  }
  return { x, y, z };
}

// ---------------------------------------------------------------- GLSL

/**
 * 這一批 shader 共用的函式（接在 GLSL_COMMON 後面）：
 *  - photoLin：取照片（sRGB → 線性，乘 0.82，最亮壓在 ~0.82，不發光）
 *  - photoSoft：失焦的照片（景深）：同一個 mip 層附近幾點平均
 *  - layerAt：在 shader 裡取 fast 的 Layer2D（字貼在斜的、透視的物件上），q 是圖層上的邏輯 px（左上原點）
 *  - yawInv／pitchInv：轉了一個角度的平面（左右轉／前後仰）上的座標：s 是畫面上離平面中心的位移、f 是焦距（px）
 *  - softShadow：方框的軟影（d = 到方框的距離）
 *  - woodGrain：木紋（p 沿著木紋方向是 x），base 是木頭的顏色
 *  - leafShadow：窗外植物落下的葉影（稀疏的橢圓葉片，會隨風晃）
 */
export const P2_GLSL = /* glsl */ `
vec3 photoLin(sampler2D tex, vec2 uv, float lod) { return toLinear(textureLod(tex, clamp(uv, 0.0, 1.0), lod).rgb) * 0.82; }
vec3 photoSoft(sampler2D tex, vec2 uv, float lod, float r) {
  vec3 s = photoLin(tex, uv, lod);
  if (r > 0.0005) {
    for (int i = 0; i < 6; i++) {
      float a = float(i) * 1.0472 + 0.4;
      s += photoLin(tex, uv + vec2(cos(a), sin(a)) * r, lod);
    }
    s /= 7.0;
  }
  return s;
}
vec4 layerAt(sampler2D L, vec2 q, vec2 size) {
  vec2 uv = vec2(q.x / size.x, 1.0 - q.y / size.y);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  return fastLayer(textureLod(L, uv, 0.0));
}
vec2 yawInv(vec2 s, float th, float f) {
  float X = s.x * f / (f * cos(th) - s.x * sin(th));
  return vec2(X, s.y * (f + X * sin(th)) / f);
}
vec2 pitchInv(vec2 s, float ph, float f) {
  float Y = s.y * f / (f * cos(ph) - s.y * sin(ph));
  return vec2(s.x * (f + Y * sin(ph)) / f, Y);
}
// 樹葉的影子（窗外的植物）：一格一片葉子（橢圓，隨機大小、方向），稀疏；sway 是整片被風吹的位移、soft 是影子的糊（px）
float leafShadow(vec2 p, vec2 sway, float t, float soft) {
  vec2 pp = p + sway;
  vec2 g = floor(pp / 150.0), f = pp - g * 150.0;
  float sh = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = g + vec2(float(i), float(j));
    vec2 h = hash22(c);
    if (h.x < 0.3) continue;
    vec2 ctr = (vec2(float(i), float(j)) + 0.15 + 0.7 * hash22(c + 17.0)) * 150.0;
    float ang = h.y * 6.2832 + 0.18 * sin(t * 0.9 + h.x * 9.0);
    vec2 q = rot2(ang) * (f - ctr);
    vec2 sz = vec2(70.0, 26.0) * (0.75 + 0.5 * h.x);
    float d = (length(q / sz) - 1.0) * sz.y;
    sh = max(sh, 1.0 - smoothstep(-soft, soft, d));
  }
  return sh;
}
float softShadow(float d, float blur) { return d < 0.0 ? 1.0 : exp(-d / max(blur, 0.001)); }
vec3 woodGrain(vec2 p, vec3 base) {
  float g = fbm(vec2(p.x / 900.0, p.y / 70.0), 3);
  float ring = sin((p.y + 120.0 * g) / 6.0 + 2.0 * snoise(vec2(p.x / 400.0, p.y / 40.0)));
  float fib = snoise(vec2(p.x / 90.0, p.y / 2.2));
  return base * (0.84 + 0.12 * g + 0.035 * ring + 0.03 * fib);
}
`;

/** 鏡頭：一開始快、之後越來越慢（窗格 3～16 秒都好看）。 */
export const settle = (lt: number, tau = 7) => 1 - Math.exp(-Math.max(0, lt) / tau);

/** GLSL 的 vec4 uniform 一行設好。 */
export const v4 = (u: THREE.IUniform, a: number, b: number, c: number, d: number) => (u.value as THREE.Vector4).set(a, b, c, d);
export const v2 = (u: THREE.IUniform, a: number, b: number) => (u.value as THREE.Vector2).set(a, b);
