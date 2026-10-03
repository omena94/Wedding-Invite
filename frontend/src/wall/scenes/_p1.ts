// P1「底片與暗房」這批照片版面共用的小工具（devtray、negative、slideshow、instant、homemovie、contactsheet、
// viewfinder、enlarger、filmroll、photolab）。檔名 _ 開頭，不會被當成版面。
//  - 照片：載入、上傳顯示卡、多張時湊滿張數、「完整放、最多放大 1.5 倍」的尺寸、mip 層。
//  - 桌面鏡頭（PlaneCam）：真的透視（射線打到桌面 z = 高度的平面），桌上的東西有遠近、景深可以照深度算；
//    TS 這邊同一個鏡頭把桌上的點投影回畫面（字、避讓範圍）。
//  - 字（P1Cap）：_photo.ts 的 PhotoText（主字＝賓客留言＋署名或新人的註解，歌詞小一號跟唱；沒有主字時歌詞自己當主字；
//    兩個都沒有就不畫，版面自己把照片移到中間），多了逐字手寫的小工具。每個版面只決定字寫在哪裡、用什麼字族與顏色。
//  - 焦點：鏡頭往焦點推（PlaneCam.zoomBy、safePush：推，但字不能被推出畫面）。
import * as THREE from 'three';
import type { SceneCtx } from '../engine/scene';
import { W, H, SCALE, type Compositor, type Layer2D } from '../engine/gl';
import { HUD_SAFE } from '../engine/hud';
import { font } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp } from '../engine/util';
import { photoTexture, PhotoText, type PhotoTextStyle } from './_photo';
import type { PhotoRef } from '../photos';

// ---------------------------------------------------------------- 照片

export interface P1Photo { ref: PhotoRef; tex: THREE.Texture; w: number; h: number; aspect: number }

/**
 * 這個窗格的照片：params.photos（多張版面）湊滿 n 張，第一張一定是 params.photo（主角）。
 * 照片池準備好的不夠時導演不會排多張版面，但開發模式或清單剛變動時可能少一兩張：重複前面的，畫面照樣成立。
 */
export function photoRefs(ctx: SceneCtx, n: number): PhotoRef[] {
  const main = ctx.params.photo as PhotoRef | undefined;
  // 照片版面只排在照片窗格（導演一定給 params.photo）；沒有就讓引擎跳過這個窗格，不要畫一半
  if (!main) throw new Error('照片版面要有 params.photo');
  const rest = ((ctx.params.photos ?? []) as (PhotoRef | null)[]).filter((p): p is PhotoRef => !!p && p !== main && p.id !== main.id);
  const out = [main, ...rest].slice(0, n);
  for (let k = 0; out.length < n; k++) out.push(out[k % out.length]!);
  return out;
}

/**
 * 解碼、做成貼圖、先傳到顯示卡（不要拖到第一格才傳，切版面會停一下）。
 * 同一張照片（張數不夠重複用的）只做一張貼圖。圖本身由照片池管，不 close。
 */
export async function loadPhotos(ctx: SceneCtx, refs: PhotoRef[], track: (t: THREE.Texture) => THREE.Texture): Promise<P1Photo[]> {
  const byId = new Map<number, Promise<P1Photo>>();
  return Promise.all(refs.map((ref) => {
    let p = byId.get(ref.id);
    if (!p) {
      p = ref.load().then((img) => {
        const tex = track(photoTexture(img));
        ctx.renderer.initTexture(tex);
        return { ref, tex, w: img.w, h: img.h, aspect: img.w / img.h };
      });
      byId.set(ref.id, p);
    }
    return p.then((ph) => ({ ...ph, ref }));
  }));
}

/** 完整放進 bw×bh 的縮放；很小的照片最多放大到原尺寸 `up` 倍（再大就糊了）。 */
export const containScale = (w: number, h: number, bw: number, bh: number, up = 1.5) => Math.min(bw / w, bh / h, up);

/** 照片取樣的 mip 層：照片上用到的像素 ÷ 畫面上的實體像素。 */
export const mipFor = (photoPx: number, screenPx: number) => Math.max(0, Math.log2(photoPx / Math.max(1, screenPx * SCALE)));

/**
 * 繞著焦點 (fx, fy) 裁成 aspect（寬÷高）時的取樣範圍（0..1，左上原點）：焦點盡量在中間，
 * 但不會超出照片；zoom > 1 再往焦點裁進去一點。
 */
export function cropAround(ph: P1Photo, aspect: number, zoom = 1, cx = ph.ref.fx, cy = ph.ref.fy): [number, number, number, number] {
  let fw = 1, fh = 1;
  if (aspect > ph.aspect) fh = ph.aspect / aspect; else fw = aspect / ph.aspect;
  fw /= zoom; fh /= zoom;
  const x = Math.min(Math.max(cx - fw / 2, 0), 1 - fw), y = Math.min(Math.max(cy - fh / 2, 0), 1 - fh);
  return [x, y, x + fw, y + fh];
}

/**
 * 很暗的照片（平均亮度 < 0.3）稍微提亮，在燈光、暗房這種暗場景裡才不會悶成一片；沒有亮度資料（開發用的假照片）就是 1。
 * 最多 1.3 倍：照片本來就暗，乘上版面的 0.8～0.84 之後還是在 bloom 門檻下面。
 */
export const gainOf = (ref: PhotoRef) => (ref.lum == null ? 1 : Math.min(1.3, Math.max(1, 1 + (0.3 - ref.lum) * 1.2)));

/** P1_GLSL 要的 uniform：每個用到 photoLin 的 pass 都要展開這個（不然 photoGain 是 0、照片全黑）。 */
export const p1Uniforms = () => ({ photoGain: { value: 1 } });

/** GLSL：照片取樣（sRGB → 線性，乘上 photoGain）。版面自己再乘 0.8～0.84，照片才不會被 bloom 打到。 */
export const P1_GLSL = /* glsl */ `
uniform float photoGain;
vec3 photoLin(sampler2D s, vec2 uv, float l) { return toLinear(textureLod(s, clamp(uv, 0.0, 1.0), l).rgb) * photoGain; }
// 圓角矩形的距離（半寬高 b、圓角 r）
float sdRound(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
// fast Layer2D 的貼圖在自己的 shader 裡取樣：畫布座標（0..1，左上原點）→ 解預乘、轉線性（預乘的 rgb 與 alpha）
vec4 layerAt(sampler2D s, vec2 q) {
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return vec4(0.0);
  return fastLayer(texture(s, vec2(q.x, 1.0 - q.y)));
}`;

// ---------------------------------------------------------------- 桌面鏡頭

/**
 * 看著桌面的鏡頭：世界座標 x 向右、y 往觀眾那邊（畫面下方）、z 往上（離開桌面），單位是「對焦處的畫面 px」。
 * look(目標, 距離, 傾斜…)：鏡頭在目標的正上方往觀眾那邊倒 tilt 度、繞垂直軸轉 yaw、繞視線轉 roll；
 * focal = 距離，所以目標那裡一個單位剛好一個畫面 px，近的大、遠的小。
 */
export class PlaneCam {
  pos = new THREE.Vector3();
  r = new THREE.Vector3(1, 0, 0);
  d = new THREE.Vector3(0, 1, 0);
  f = new THREE.Vector3(0, 0, -1);
  focal = 1600;

  look(tx: number, ty: number, dist: number, tilt = 0, yaw = 0, roll = 0, tz = 0) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), st = Math.sin(tilt), ct = Math.cos(tilt);
    // 目標往鏡頭的方向：先往 +y 倒 tilt，再繞 z 轉 yaw
    const ox = -sy * st, oy = cy * st, oz = ct;
    this.pos.set(tx + ox * dist, ty + oy * dist, tz + oz * dist);
    this.f.set(-ox, -oy, -oz);
    const rx = cy, ry = sy, rz = 0;
    // 畫面往下 = r × f
    let dx = ry * this.f.z - rz * this.f.y, dy = rz * this.f.x - rx * this.f.z, dz = rx * this.f.y - ry * this.f.x;
    const cr = Math.cos(roll), sr = Math.sin(roll);
    this.r.set(rx * cr + dx * sr, ry * cr + dy * sr, rz * cr + dz * sr);
    [dx, dy, dz] = [-rx * sr + dx * cr, -ry * sr + dy * cr, -rz * sr + dz * cr];
    this.d.set(dx, dy, dz);
    this.focal = dist;
    return this;
  }

  /**
   * 推近（變焦）：look() 讓目標那裡一個單位剛好一個畫面 px，光把距離拉近只是改透視、東西不會變大；
   * 往焦點推要真的放大，就在 look() 之後乘上焦距。
   */
  zoomBy(z: number) {
    this.focal *= z;
    return this;
  }

  /**
   * 從 eye 看向 target（牆、銀幕這種直立的面：把牆當成 z = 0 的平面、y 向下，鏡頭在 z > 0 那邊）。
   * down 是大約的「畫面往下」方向；focal = 到目標的距離，目標那裡一個單位一個畫面 px。
   */
  lookAt(ex: number, ey: number, ez: number, tx: number, ty: number, tz: number, down: [number, number, number] = [0, 1, 0]) {
    const f = new THREE.Vector3(tx - ex, ty - ey, tz - ez);
    const dist = f.length();
    f.normalize();
    const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(...down)).normalize();
    const d = new THREE.Vector3().crossVectors(r, f);
    this.pos.set(ex, ey, ez); this.f.copy(f); this.r.copy(r); this.d.copy(d);
    this.focal = dist;
    return this;
  }

  /** 世界座標 → 畫面 px（y 向下）與深度（沿視線的距離）。 */
  project(x: number, y: number, z = 0): { x: number; y: number; z: number } {
    const vx = x - this.pos.x, vy = y - this.pos.y, vz = z - this.pos.z;
    const zc = vx * this.f.x + vy * this.f.y + vz * this.f.z;
    const k = this.focal / zc;
    return { x: W / 2 + k * (vx * this.r.x + vy * this.r.y + vz * this.r.z), y: H / 2 + k * (vx * this.d.x + vy * this.d.y + vz * this.d.z), z: zc };
  }

  /** 世界上的矩形（桌面上、高度 z）投影到畫面後的外框 [x, y, w, h]。 */
  rect(x: number, y: number, w: number, h: number, z = 0): [number, number, number, number] {
    const ps = [this.project(x, y, z), this.project(x + w, y, z), this.project(x, y + h, z), this.project(x + w, y + h, z)];
    const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    return [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0];
  }

  apply(u: Record<string, THREE.IUniform>) {
    (u.camPos!.value as THREE.Vector3).copy(this.pos);
    (u.camR!.value as THREE.Vector3).copy(this.r);
    (u.camD!.value as THREE.Vector3).copy(this.d);
    (u.camF!.value as THREE.Vector3).copy(this.f);
    u.camFocal!.value = this.focal;
  }
}

export const camUniforms = () => ({
  camPos: { value: new THREE.Vector3() }, camR: { value: new THREE.Vector3() }, camD: { value: new THREE.Vector3() },
  camF: { value: new THREE.Vector3() }, camFocal: { value: 1600 },
});

/** GLSL：畫面 px（y 向下）的射線打到高度 hz 的水平面，回傳 (x, y, 深度)。深度 ÷ camFocal = 一個畫面 px 是幾個世界單位。 */
export const CAM_GLSL = /* glsl */ `
uniform vec3 camPos; uniform vec3 camR; uniform vec3 camD; uniform vec3 camF; uniform float camFocal;
vec3 camHit(vec2 p, float hz) {
  vec3 d = camF * camFocal + camR * (p.x - ${W / 2}.0) + camD * (p.y - ${H / 2}.0);
  float s = (hz - camPos.z) / d.z;
  return vec3((camPos + d * s).xy, s * camFocal);
}`;

// ---------------------------------------------------------------- 字

/** 把一張（比畫面小的）Layer2D 貼在畫面 (x, y)（左上角，邏輯 px）。 */
export function blitAt(comp: Compositor, renderer: THREE.WebGLRenderer, L: Layer2D, out: THREE.WebGLRenderTarget, x: number, y: number, opacity = 1, mode: 'normal' | 'add' = 'normal') {
  comp.draw(renderer, L.texture, out, { mode, opacity, scale: [W / L.w, H / L.h], offset: [0.5 * W / L.w - 0.5 - x / L.w, 0.5 + y / L.h - 0.5 * H / L.h] });
}

/** 這批的字的樣式就是 PhotoText 的樣式（_photo.ts）。 */
export type CapStyle = PhotoTextStyle;

/**
 * 這批照片版面的字：就是 _photo.ts 的 PhotoText（主字＝賓客留言＋署名或新人的註解、歌詞小一號跟唱，規則全部照它），
 * 多兩個手寫用的小工具——這批很多版面是一個字一個字寫在紙上、標籤上、白邊上。
 */
export class P1Cap extends PhotoText {
  /** 逐字寫出：t0 開始寫、t1 寫完（之後 Infinity，署名跟著出現）；沒有主字（只有歌詞）時一律 Infinity。 */
  charsAt(t: number, t0: number, t1: number): number {
    if (!this.hasMain) return Infinity;
    return t >= t1 ? Infinity : Math.floor(clamp((t - t0) / Math.max(0.01, t1 - t0)) * this.chars);
  }

  /** 主字要寫幾秒：字越多越久，但最多 max 秒（留言要留時間讀，不能一直在寫）。 */
  writeDur(per = 0.08, max = 2.6) { return Math.min(max, per * this.chars + 0.3); }
}

/** 畫面上的矩形 [x, y, w, h] 有沒有在字的安全範圍裡：離四邊 ≥ m、不碰右下角的 HUD（x ≥ 1360 且 y ≥ 830）。 */
export function inSafe(r: readonly number[], m = 96): boolean {
  const [x, y, w, h] = r as [number, number, number, number];
  if (x < m || y < m || x + w > W - m || y + h > H - m) return false;
  return !(x + w > HUD_SAFE.x && y + h > HUD_SAFE.y);
}

/**
 * 鏡頭往焦點推，但字不能被推出畫面（ENGINE.md「焦點」：字一直要在畫面裡、離邊 ≥ 96 px）：
 * k 是想推到哪裡（0..1），place(k) 照 k 擺好鏡頭、回傳這個 k 之下畫面還成不成立（字在安全範圍、照片沒跑到字底下…）；
 * 推太多時往回找最大的可行 k（二分，只跟 k 有關，所以還是確定的），最後一定用回傳的 k 再擺一次鏡頭。
 * k = 0（沒推）本來就不成立時回傳 0：那是版面排位置的問題，推不推都一樣。
 */
export function safePush(k: number, place: (k: number) => boolean): number {
  let kk = k;
  if (k > 0 && !place(k)) {
    let lo = 0, hi = k;
    for (let i = 0; i < 10; i++) { const m = (lo + hi) / 2; if (place(m)) lo = m; else hi = m; }
    kk = lo;
  }
  place(kk);
  return kk;
}

/** 小標籤（相簿名之類，≤ 22～26 px）：太長的截斷加「…」。 */
export function fitLabel(c: CanvasRenderingContext2D, s: string, family: string, px: number, maxW: number, tracking = 0): string {
  c.font = font(family, px);
  c.letterSpacing = `${tracking}px`;
  let r = s;
  while (r.length > 1 && c.measureText(r === s ? r : `${r}…`).width > maxW) r = r.slice(0, -1);
  c.letterSpacing = '0px';
  return r === s ? s : `${r}…`;
}

/** 版面的種子（params.seed，沒有就用照片 id）。 */
export const seedOf = (ctx: SceneCtx) => Number(ctx.params.seed ?? (ctx.params.photo as PhotoRef | undefined)?.id ?? 1);

export { rgba };
