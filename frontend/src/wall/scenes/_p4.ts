// P4「電影與螢幕」照片版面共用的小工具（cinema、drivein、widescreen、crttv、phonealbum、vhs、intertitle、splitscreen、monitor、tvwall）。
// 檔名 _ 開頭，不會被當成版面。
//  - PhotoPlate：載照片（主角＋多張版面的其他張）、做貼圖、先傳到顯示卡；字（主字＋歌詞）用 _photo.ts 的 PhotoText 排（words()）。
//  - 螢幕在空間裡：quadToUV() 把畫面上一個透視的四邊形（螢幕、銀幕）換成 3×3 矩陣，shader 用它從畫面 px 算回螢幕上的 uv，
//    照片、字都照同一個透視貼在螢幕上（字是螢幕上的東西，跟著鏡頭一起動）。
//  - 照片放進螢幕：fitInScreen()（橫的夠大的裁滿，其他完整放），框裡的畫面一律往焦點推（focusCropAt：臉推到字幕上面的空處）。
import * as THREE from 'three';
import { Scene } from '../engine/scene';
import { W, H, SCALE, type Compositor, type Layer2D } from '../engine/gl';
import { F, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp } from '../engine/util';
import { focusCrop, loadWords, photoTexture, photoWords, PhotoText, type PhotoTextStyle } from './_photo';
import type { PhotoRef, PhotoImage } from '../photos';

/** 一張上螢幕的照片：照片、解碼好的圖、貼圖。 */
export interface Shot { ref: PhotoRef; img: PhotoImage; tex: THREE.Texture }

/**
 * 照片版面的底：init() 呼叫 loadPhotos()。照片版面只排在照片窗格（導演一定給 params.photo）；
 * 沒有就丟錯，讓引擎跳過這個窗格，不要畫一半。
 */
export abstract class PhotoPlate extends Scene {
  photo: PhotoRef = this.ctx.params.photo;
  seed = Number(this.ctx.params.seed ?? 1);
  /** shots[0] 是主角（params.photo）；多張的版面後面接其他張。 */
  shots: Shot[] = [];
  /** 這個窗格的字（主字＝賓客留言或新人的註解，＋跟唱的歌詞）：版面在 init() 裡用 words() 排好。 */
  text!: PhotoText;
  /** 有字（主字或歌詞）；兩個都沒有就只有照片，版面不要留空的說明欄。loadPhotos() 之後就知道（排字之前就能決定構圖）。 */
  hasText = false;

  get img(): PhotoImage { return this.shots[0]!.img; }
  get tex(): THREE.Texture { return this.shots[0]!.tex; }

  protected async loadPhotos(n = 1, glyphs = '') {
    const { renderer } = this.ctx;
    const ph = this.photo;
    if (!ph) throw new Error('照片版面要有 params.photo');
    // 導演保證 params.photos 剛好 n 張（第一張就是 params.photo）；萬一不夠就繞回來用，版面不會缺一格
    const list: PhotoRef[] = n > 1 && Array.isArray(this.ctx.params.photos) && this.ctx.params.photos.length ? this.ctx.params.photos : [ph];
    const refs = Array.from({ length: n }, (_, i) => (i === 0 ? ph : list[i % list.length] ?? ph));
    await loadText(`${ph.caption}${ph.album}${glyphs}`);
    // 主字（留言＋署名）的字型先載好，第一格才不會用備援字型
    await loadWords(this.ctx);
    const byId = new Map<number, Shot>();
    for (const ref of refs) {
      const hit = byId.get(ref.id);
      if (hit) { this.shots.push({ ...hit, ref }); continue; }
      const img = await ref.load();
      const tex = this.track(photoTexture(img));
      // 先傳到顯示卡（不要拖到第一格才傳，切版面時會停一下）
      renderer.initTexture(tex);
      const s = { ref, img, tex };
      byId.set(ref.id, s);
      this.shots.push(s);
    }
    const w = photoWords(this.ctx);
    this.hasText = w.kind !== 'none' || w.lyrics;
  }

  /** 排字：c 是要畫字的那張圖層（量字用），st 是這個版面的字族、顏色、範圍。 */
  protected words(c: CanvasRenderingContext2D, st: PhotoTextStyle): PhotoText {
    this.text = new PhotoText(this.ctx, c, st);
    this.hasText = this.text.has;
    return this.text;
  }
}

/**
 * 螢幕上的字幕（銀幕、電視、錄影帶）：思源黑體、置中、紙白的字、字邊一圈軟的暗影（照片很亮的地方字照樣清楚）。
 * 主字 40～50、署名 28、歌詞字幕 38（沒有主字時 48）；版面給寬、高，其他要改的再蓋過去。
 */
export function subtitleStyle(w: number, h: number, o: Partial<PhotoTextStyle> = {}): PhotoTextStyle {
  return {
    family: F.hei(500), w, h, min: 40, max: 48, lineHeight: 1.36, maxLines: 4, align: 'center', tracking: 1,
    ink: rgba('bone', 0.97), unsung: rgba('bone', 0.42), sigInk: rgba('bone', 0.8), sigSize: 28,
    shadow: { color: rgba('ink', 0.8), blur: 10 }, ...o,
  };
}

// ---------------------------------------------------------------- 照片放進框
/** 完整放進 bw×bh：很小的照片最多放大 maxUp 倍（再大就糊了）。 */
export function contain(w: number, h: number, bw: number, bh: number, maxUp = 1.5) {
  const s = Math.min(bw / w, bh / h, maxUp);
  return { w: w * s, h: h * s, s };
}

/**
 * 橫的、夠大的照片（裁成 aspect 滿版時不用放大超過 maxUp 倍）才可以裁滿；直的、方的、小的（掃描的舊照片）一律完整放。
 */
export function canCover(img: PhotoImage, aspect: number, boxW: number, maxUp = 1.5) {
  const a = img.w / img.h;
  if (a < 1.25 || img.w < 1200) return false;
  // 裁成 aspect 後剩下的寬（照片 px）放大到 boxW 要幾倍
  const usedW = a > aspect ? img.h * aspect : img.w;
  return boxW / usedW <= maxUp;
}

/** 往焦點推的選項：k 推到哪裡（0..1，settleK）、zoom 推到最後幾倍、at 臉最後停在框裡哪裡（0..1，預設正中間）、reverse 從臉的特寫拉遠。 */
export interface Push { k: number; zoom?: number; at?: readonly [number, number]; reverse?: boolean }

/**
 * _photo.ts 的 focusCrop（往焦點推、焦點永遠在框裡），再加上「臉最後停在框裡的哪裡」：螢幕下面有字幕時，
 * 臉推到字幕上面的空處（at = [0.5, 0.32] 這種），不是推到正中間被字蓋住。推得越近（框越小）越靠近 at；
 * 一開始框幾乎等於整張，中心被擠在中間，跟 focusCrop 一樣。at 在 (0, 1) 之間時焦點一定還在框裡。
 */
export function focusCropAt(ph: { fx: number; fy: number }, imgW: number, imgH: number, aspect: number, p: Push, screenW?: number): [number, number, number, number] {
  const c = focusCrop(ph, imgW, imgH, aspect, p.k, { zoom: p.zoom ?? 1.25, screenW, reverse: p.reverse });
  if (!p.at) return c;
  const w = c[2] - c[0], h = c[3] - c[1];
  const ax = clamp(p.at[0], 0.08, 0.92), ay = clamp(p.at[1], 0.08, 0.92);
  const cx = clamp(ph.fx + (0.5 - ax) * w, w / 2, 1 - w / 2), cy = clamp(ph.fy + (0.5 - ay) * h, h / 2, 1 - h / 2);
  return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
}

/**
 * 照片在一個 aspect 的螢幕裡：可以裁滿就裁（rect = 整個螢幕），不然完整放在中間（黑邊）。框裡的畫面一律往焦點推（push）。
 * rect：照片在螢幕 uv 裡的範圍；crop：照片取哪一塊。screenPxW：螢幕在畫面上大約幾 px 寬（判斷小照片要不要放大、推多少才不會糊）。
 * push.at 是螢幕 uv（臉最後停在螢幕的哪裡），完整放時換算成照片框裡的位置。
 */
export function fitInScreen(img: PhotoImage, ref: PhotoRef, aspect: number, screenPxW: number, push: Push, o: { cover?: boolean } = {}) {
  const cover = o.cover ?? canCover(img, aspect, screenPxW);
  if (cover) return { cover, rect: [0, 0, 1, 1] as [number, number, number, number], crop: focusCropAt(ref, img.w, img.h, aspect, push, screenPxW) };
  const screenPxH = screenPxW / aspect;
  const c = contain(img.w, img.h, screenPxW, screenPxH);
  const rw = c.w / screenPxW, rh = c.h / screenPxH;
  const rect: [number, number, number, number] = [(1 - rw) / 2, (1 - rh) / 2, (1 + rw) / 2, (1 + rh) / 2];
  const at = push.at && ([(push.at[0] - rect[0]) / rw, (push.at[1] - rect[1]) / rh] as const);
  return { cover, rect, crop: focusCropAt(ref, img.w, img.h, img.w / img.h, { ...push, at }, c.w) };
}

/** 臉要停在哪裡（螢幕 uv 的 y）：字幕從 top 開始往下蓋，臉推到上面空處的中間（不高過 0.3，太上面看起來像被擠出去）。 */
export const aboveText = (top: number, has: boolean): [number, number] => [0.5, has ? clamp(top * 0.55, 0.3, 0.5) : 0.5];

/** 照片取樣的 mip 層：照片上用到的 px ÷ 畫面上的實體 px。 */
export const photoLod = (photoPx: number, screenPx: number) => Math.max(0, Math.log2(photoPx / Math.max(1, screenPx * SCALE)));

// ---------------------------------------------------------------- 透視
/** 畫面上的四邊形（px，y 向下）：左上、右上、右下、左下。 */
export type Quad = [[number, number], [number, number], [number, number], [number, number]];

/**
 * 畫面 px → 四邊形上的 uv（0..1，左上原點）的投影矩陣（Heckbert 的正方形對四邊形，再求反矩陣）。
 * shader：`vec3 h = m * vec3(px, 1.0); vec2 uv = h.xy / h.z;`（px 是 y 向下的邏輯 px）。
 */
export function quadToUV(q: Quad, out = new THREE.Matrix3()): THREE.Matrix3 {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    a = x1 - x0; b = x3 - x0; c = x0; d = y1 - y0; e = y3 - y0; f = y0; g = 0; h = 0;
  } else {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; c = x0;
    d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0;
  }
  // uv → px 是 [[a b c] [d e f] [g h 1]]；反矩陣（伴隨矩陣，比例不重要）
  out.set(
    e - f * h, c * h - b, b * f - c * e,
    f * g - d, a - c * g, c * d - a * f,
    d * h - e * g, b * g - a * h, a * e - b * d,
  );
  return out;
}

/** 很簡單的針孔鏡頭：世界座標 px 尺度（x 右、y 上、z 朝向鏡頭），鏡頭在 (x, y, z) 往 -z 看，yaw／pitch 是鏡頭轉的角度。 */
export interface Cam { x: number; y: number; z: number; yaw: number; pitch: number; f: number; cx?: number; cy?: number }

/** 世界座標的一點投影到畫面 px（y 向下）。 */
export function project(cam: Cam, p: [number, number, number]): [number, number] {
  let x = p[0] - cam.x, y = p[1] - cam.y, z = p[2] - cam.z;
  const cy = Math.cos(-cam.yaw), sy = Math.sin(-cam.yaw);
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  const cp = Math.cos(-cam.pitch), sp = Math.sin(-cam.pitch);
  [y, z] = [y * cp - z * sp, y * sp + z * cp];
  const k = cam.f / Math.max(1e-3, -z);
  return [(cam.cx ?? W / 2) + x * k, (cam.cy ?? H / 2) - y * k];
}

/**
 * 立在空間裡的一塊平面（螢幕、銀幕）：中心 c、半寬半高、自己的 yaw（繞 y 軸轉，正的往右轉開）、pitch（往後仰）。
 * 回傳四個角在畫面上的位置（左上、右上、右下、左下）。
 */
export function planeQuad(cam: Cam, c: [number, number, number], hw: number, hh: number, yaw = 0, pitch = 0): Quad {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const pt = (u: number, v: number): [number, number] => {
    // 平面上的點（u 右、v 上），先仰（繞 x）再轉（繞 y）
    let x = u, y = v * cp, z = -v * sp;
    [x, z] = [x * cy + z * sy, -x * sy + z * cy];
    return project(cam, [c[0] + x, c[1] + y, c[2] + z]);
  };
  return [pt(-hw, hh), pt(hw, hh), pt(hw, -hh), pt(-hw, -hh)];
}

/** 四邊形的外框（給文字層、光暈定位）。 */
export function quadBounds(q: Quad) {
  const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

// ---------------------------------------------------------------- 字
/**
 * 把一張文字層（左上角在畫面 (x, y)、邏輯大小 L.w×L.h）疊到 out；zoom 繞著畫面上的 zc 放大（跟著鏡頭推近）。
 */
export function drawLayer(comp: Compositor, renderer: THREE.WebGLRenderer, L: Layer2D, out: THREE.WebGLRenderTarget, x: number, y: number, o: { opacity?: number; zoom?: number; zc?: [number, number]; mode?: 'normal' | 'add'; tint?: [number, number, number] } = {}) {
  const z = o.zoom ?? 1, zx = o.zc?.[0] ?? W / 2, zy = o.zc?.[1] ?? H / 2;
  const sx = W / (z * L.w), sy = H / (z * L.h);
  const k = 1 - 1 / z;
  comp.draw(renderer, L.texture, out, {
    opacity: o.opacity ?? 1, mode: o.mode, tint: o.tint,
    scale: [sx, sy],
    offset: [0.5 * sx - 0.5 + (zx * k - x) / L.w, 0.5 - 0.5 * sy + (y - zy * k) / L.h],
  });
}

/** 相簿名太長就截斷加「…」（小標籤，不折行）。 */
export function clip(c: CanvasRenderingContext2D, s: string, maxW: number): string {
  if (c.measureText(s).width <= maxW) return s;
  let t = s;
  while (t.length > 1 && c.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

// ---------------------------------------------------------------- GLSL
/**
 * 版面 shader 共用的函式（放在 frag 最前面）：
 *  - P4photo：照片取樣（sRGB → 線性，乘 0.82 壓在 bloom 門檻下：照片不發光）
 *  - P4quad：畫面 px（y 向下）→ 四邊形上的 uv
 *  - P4avg：照片的平均色（最高的 mip 層；螢幕照到四周的光用它，換照片光的顏色也跟著換）
 *  - P4layer：取樣 fast 的文字層（uv 左上原點）
 */
export const P4_GLSL = /* glsl */ `
vec3 P4photo(sampler2D s, vec2 uv, float lod) { return toLinear(textureLod(s, clamp(uv, 0.0, 1.0), lod).rgb) * 0.82; }
vec2 P4quad(mat3 m, vec2 p) { vec3 h = m * vec3(p, 1.0); return h.xy / h.z; }
vec3 P4avg(sampler2D s) { return toLinear(textureLod(s, vec2(0.5), 12.0).rgb) * 0.82; }
vec4 P4layer(sampler2D s, vec2 uv) { return fastLayer(textureLod(s, vec2(uv.x, 1.0 - uv.y), 0.0)); }
// 照片放在螢幕裡：rect 是照片在螢幕 uv 的範圍、crop 是取照片的哪一塊；回傳 (顏色, 在不在照片裡)
vec4 P4screenPhoto(sampler2D s, vec2 suv, vec4 rect, vec4 crop, float lod) {
  vec2 q = (suv - rect.xy) / (rect.zw - rect.xy);
  float inside = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
  vec3 c = P4photo(s, crop.xy + clamp(q, 0.0, 1.0) * (crop.zw - crop.xy), lod);
  return vec4(c, inside);
}`;

/** Vector4 的 uniform 設值（少寫幾個 as）。 */
export const v4 = (u: THREE.IUniform, a: readonly number[]) => (u.value as THREE.Vector4).set(a[0]!, a[1]!, a[2]!, a[3]!);
export const v2 = (u: THREE.IUniform, x: number, y: number) => (u.value as THREE.Vector2).set(x, y);
export const m3 = (u: THREE.IUniform, m: THREE.Matrix3) => (u.value as THREE.Matrix3).copy(m);

