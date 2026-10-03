// P10「多張照片」（series: multi）共用的工具：diptych、triptych、photogrid、scatter、timeline、stack、photoring、storyboard、fan、cube。
// 檔名 _ 開頭，不會被當成版面。
//  - 照片：params.photos（剛好 n 張，第一張是主角）。主角原尺寸上傳；其他張縮到長邊約 1280 再上傳
//    （畫面上不會比這更大，六張 2048 的照片全部原尺寸放進顯示卡要將近一百 MB，內顯筆電吃不消）。
//  - 照片卡（Card）：每張照片是 3D 空間裡的一張平面卡（相片、畫框、格子）。一個全螢幕 shader 逐像素對每張卡做光線與平面求交，
//    照 JS 排好的順序由後往前疊，卡片彼此、卡片對背景的軟影子也在裡面算（遮光的距離越遠、影子越軟越淡）。
//    版面只寫背景、卡片的邊（白邊、卡紙、框）與打光三個鉤子，就有真的透視、鏡頭、景深（離焦的卡取樣較高的 mip 層、邊緣變軟）。
//  - 鏡頭（Cam）：透視鏡頭；世界單位 = 參考距離上的邏輯像素（鏡頭在 z = focal、看著原點時，z = 0 的平面跟畫面一比一），
//    所以排版可以直接用畫面像素想，再讓鏡頭推、搖、移。
//  - 字（Caption）：_photo.ts 的 PhotoText 包一層，只放主角的：主字（賓客留言＋署名，或新人的註解）在上，歌詞小一號在下面跟唱；
//    沒有主字時歌詞自己當主字；兩樣都沒有就不畫（版面不留說明欄）。物件上放不下時 lyricsApart：歌詞另外一張圖層，版面自己放。
//  - 焦點（pushCrop）：主角的畫面往新人點的焦點慢慢推（focusCrop），其他張完整放或繞著自己的焦點裁。
import * as THREE from 'three';
import type { SceneCtx } from '../engine/scene';
import type { AudioData } from '../engine/audio';
import { FSPass, Layer2D, W, H, SCALE } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { clamp, hexToLinear } from '../engine/util';
import { beatAfter } from './_motifs';
import { focusCrop, focusIn, loadWords, photoTexture, photoWords, PhotoText, settleK } from './_photo';
import type { PhotoRef, PhotoImage } from '../photos';

interface Disposable { dispose(): void }
export type Own = <T extends Disposable>(x: T) => T;

// ---------------------------------------------------------------- 照片

/** 一張載好的照片：原尺寸（w, h：算「最多放大 1.5 倍」用）與實際上傳的貼圖尺寸（tw, th：算 mip 層用）。 */
export interface Slot { ref: PhotoRef; tex: THREE.Texture; w: number; h: number; tw: number; th: number; aspect: number }

/**
 * 這一格的照片：params.photos（第一張是主角＝params.photo）。照片池張數不夠時導演不會排這個版面，
 * 但預覽、示範時可能少幾張：不夠的用前面幾張補（不要畫一半）。
 */
export function photoRefs(params: Record<string, any>, n: number): PhotoRef[] {
  const main: PhotoRef | undefined = params.photo ?? params.photos?.[0];
  // 照片版面只排在照片窗格（導演一定給 params.photo）；沒有就讓引擎跳過這個窗格
  if (!main) throw new Error('照片版面要有 params.photo');
  const rest = (Array.isArray(params.photos) ? params.photos : []).filter((p: PhotoRef | null) => p && p !== main) as PhotoRef[];
  const list = [main, ...rest];
  return Array.from({ length: n }, (_, i) => list[i % list.length]!);
}

/**
 * 載入照片、做成貼圖並先傳到顯示卡（init() 裡呼叫）。第 0 張（主角）原尺寸，其他張長邊縮到 sideMax 以下。
 * 同一張照片出現兩次（照片池很小時）只做一張貼圖。照片池的圖不能 close()；縮小的那份是自己的，窗格結束時關掉。
 */
export async function loadSlots(ctx: SceneCtx, refs: PhotoRef[], own: Own, sideMax = 1280): Promise<Slot[]> {
  await loadText(refs.map((r) => `${r.caption}${r.album}`).join(''));
  const byId = new Map<number, Promise<Omit<Slot, 'ref'>>>();
  const make = async (ref: PhotoRef, full: boolean) => {
    const img: PhotoImage = await ref.load();
    const cap = Math.min(2048, Math.round(sideMax * SCALE));
    const s = full ? 1 : Math.min(1, cap / Math.max(img.w, img.h));
    let use = img;
    if (s < 0.98) {
      const w = Math.max(1, Math.round(img.w * s)), h = Math.max(1, Math.round(img.h * s));
      const bmp = await createImageBitmap(img.image, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
      own({ dispose: () => bmp.close() });
      use = { image: bmp, w, h };
    }
    const tex = own(photoTexture(use));
    ctx.renderer.initTexture(tex);
    return { tex, w: img.w, h: img.h, tw: use.w, th: use.h, aspect: img.w / img.h };
  };
  // 主角原尺寸；其他張同一張照片共用一份（跟主角同一張就用主角那份）。幾張一起解碼、縮圖，不要一張等一張
  const jobs = refs.map((ref, i) => {
    let p = byId.get(ref.id);
    if (!p) { p = make(ref, i === 0); byId.set(ref.id, p); }
    return p;
  });
  const done = await Promise.all(jobs);
  return refs.map((ref, i) => ({ ref, ...done[i]! }));
}

/** 照片完整放進 bw×bh（contain），最多放大到原尺寸的 maxUp 倍。回傳半寬、半高。 */
export function contain(sl: Slot, bw: number, bh: number, maxUp = 1.45): [number, number] {
  const s = Math.min(bw / sl.w, bh / sl.h, maxUp);
  return [(sl.w * s) / 2, (sl.h * s) / 2];
}

/** 裁成 aspect（寬／高）的比例，繞著焦點、焦點不出框（cover）。回傳 [u0, v0, u1, v1]。 */
export function coverCrop(sl: Slot, aspect: number): [number, number, number, number] {
  const a = sl.aspect, fx = sl.ref.fx, fy = sl.ref.fy;
  if (a > aspect) {
    const cw = aspect / a, cx = clamp(fx, cw / 2, 1 - cw / 2);
    return [cx - cw / 2, 0, cx + cw / 2, 1];
  }
  const ch = a / aspect, cy = clamp(fy, ch / 2, 1 - ch / 2);
  return [0, cy - ch / 2, 1, cy + ch / 2];
}

/** 照片比例跟框差不多（差 ≤ tol）才用 cover 填滿，不然 contain：直的、小的照片不硬裁。 */
export const nearAspect = (a: number, b: number, tol = 0.16) => Math.abs(Math.log(a / b)) <= Math.log(1 + tol);

// ---------------------------------------------------------------- 鏡頭

const V = () => new THREE.Vector3();

/**
 * 透視鏡頭。世界：x 向右、y 向上、z 朝向觀眾。`rest(fov)` 是基準位置（z = focal、看著原點）：z = 0 的平面跟畫面一比一，
 * 所以 `S(x, y)`（畫面像素 → z = 0 平面上的世界座標）可以直接拿來排版。
 */
export class Cam {
  pos = new THREE.Vector3(); target = new THREE.Vector3(); up = new THREE.Vector3(0, 1, 0);
  fov = 30; focal = 1; r = V(); u = V(); f = V();
  constructor(fov = 30) { this.rest(fov); }
  /** 回到基準位置。 */
  rest(fov = this.fov) {
    this.fov = fov;
    this.focal = (H / 2) / Math.tan((fov * Math.PI) / 360);
    this.pos.set(0, 0, this.focal); this.target.set(0, 0, 0); this.up.set(0, 1, 0);
    return this.update();
  }
  /** 基準位置時鏡頭離 z = 0 平面多遠。 */
  get D() { return (H / 2) / Math.tan((this.fov * Math.PI) / 360); }
  update() {
    this.focal = (H / 2) / Math.tan((this.fov * Math.PI) / 360);
    this.f.subVectors(this.target, this.pos).normalize();
    this.r.crossVectors(this.f, this.up).normalize();
    this.u.crossVectors(this.r, this.f);
    return this;
  }
  /** 世界座標 → 畫面（邏輯像素，y 向下）與深度。 */
  project(p: THREE.Vector3): { x: number; y: number; z: number } {
    const d = V().subVectors(p, this.pos);
    const z = d.dot(this.f);
    return { x: W / 2 + (this.focal * d.dot(this.r)) / z, y: H / 2 - (this.focal * d.dot(this.u)) / z, z };
  }
  /** 畫面上 (x, y) 那條光線打到 z = zp 平面的點（只給基準方向的鏡頭用：排版）。 */
  unproject(x: number, y: number, zp = 0): THREE.Vector3 {
    const rd = V().copy(this.f).multiplyScalar(this.focal).addScaledVector(this.r, x - W / 2).addScaledVector(this.u, -(y - H / 2)).normalize();
    const s = (zp - this.pos.z) / rd.z;
    return V().copy(this.pos).addScaledVector(rd, s);
  }
  apply(pass: FSPass) {
    const u = pass.u;
    (u.camPos!.value as THREE.Vector3).copy(this.pos);
    (u.camR!.value as THREE.Vector3).copy(this.r);
    (u.camU!.value as THREE.Vector3).copy(this.u);
    (u.camF!.value as THREE.Vector3).copy(this.f);
    u.focal!.value = this.focal;
  }
}

/** 畫面像素（y 向下）→ 基準鏡頭下 z = 0 平面的世界座標。 */
export const S = (x: number, y: number, z = 0) => new THREE.Vector3(x - W / 2, H / 2 - y, z);

// ---------------------------------------------------------------- 照片卡

/** 一次最多幾張卡（照片最多 6 張，再加說明卡、標籤）。 */
export const NC = 8;

export interface Card {
  /** 中心、右方向、下方向（單位向量；卡的正面 = cross(v, u)）。 */
  c: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3;
  /** 卡的半寬高（含白邊、卡紙、框）。 */
  hw: number; hh: number;
  /** 照片的半寬高（0 = 沒有照片）與在卡上的偏移。 */
  pw: number; ph: number; ox: number; oy: number;
  /** 貼圖槽（0..5，-1 = 沒有照片）與邊的樣式（版面自己定義）。 */
  slot: number; kind: number;
  crop: [number, number, number, number];
  /** log2(照片在卡上每個世界單位幾個貼圖像素)：算 mip 層。 */
  lodBase: number;
  /** 景深：離焦的模糊半徑（邏輯像素）；亮度；不透明度。 */
  blur: number; dim: number; alpha: number;
  /** 圓角、背面樣式、會不會投影子、版面自用的值。 */
  radius: number; back: number; cast: number; extra: number;
  /** 照片本身的增益（只乘在照片上，框與白邊不變）：很暗的照片稍微提亮。setPhoto() 會照照片的平均亮度設好。 */
  gain: number;
}

export function card(): Card {
  return {
    c: V(), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, -1, 0), hw: 100, hh: 100, pw: 0, ph: 0, ox: 0, oy: 0,
    slot: -1, kind: 0, crop: [0, 0, 1, 1], lodBase: 0, blur: 0, dim: 1, alpha: 1, radius: 0, back: 0, cast: 1, extra: 0, gain: 1,
  };
}

/** 平放在桌上（面向 +z）、在畫面上順時針轉 a（弧度）。 */
export function lay(cd: Card, c: THREE.Vector3, a: number): Card {
  const co = Math.cos(a), si = Math.sin(a);
  cd.c.copy(c); cd.u.set(co, -si, 0); cd.v.set(-si, -co, 0);
  return cd;
}

/** 立著（面向 (sin yaw, 0, cos yaw)），再往後仰 pitch（弧度，正的是頂端往後倒）。 */
export function stand(cd: Card, c: THREE.Vector3, yaw: number, pitch = 0, roll = 0): Card {
  cd.c.copy(c);
  const e = new THREE.Euler(-pitch, yaw, -roll, 'YXZ');
  cd.u.set(1, 0, 0).applyEuler(e); cd.v.set(0, -1, 0).applyEuler(e);
  return cd;
}

/** 照片貼滿卡上的照片區時的 mip 基準。 */
export function lodFor(sl: Slot, cd: Card): number {
  const cw = Math.max(1e-4, cd.crop[2] - cd.crop[0]);
  return Math.log2(Math.max(1e-6, (sl.tw * cw) / Math.max(1, 2 * cd.pw)));
}

/** 照片放進卡裡：照片區半寬高、裁切，順便算好 mip 基準。 */
export function setPhoto(cd: Card, sl: Slot, slot: number, pw: number, ph: number, crop: [number, number, number, number] = [0, 0, 1, 1]) {
  cd.slot = slot; cd.pw = pw; cd.ph = ph; cd.crop = crop;
  cd.lodBase = lodFor(sl, cd);
  cd.gain = photoGain(sl.ref);
  return cd;
}

/**
 * 很暗的照片（平均亮度 < 0.3：夜景、室內沒開燈）在版面裡會悶成一團：照片本身稍微提亮（最多約 1.2 倍）。
 * 暗的照片提亮後還是遠低於 bloom 門檻，不會發光；不知道亮度（開發用的假照片）就不動。
 */
export function photoGain(ref: PhotoRef): number {
  const l = ref.lum;
  return l == null || l >= 0.3 ? 1 : 1 + (0.3 - l) * 0.7;
}

/**
 * 照片的平均色調（線性 RGB），亮度調成跟 like 一樣、只留色相：環境光、背景的光暈跟著照片走。
 * 沒有資料（空字串、開發用的假照片）回傳 null，版面照原本的顏色。
 */
export function toneLin(ref: PhotoRef, like: readonly number[]): [number, number, number] | null {
  if (!/^#[0-9a-f]{6}$/i.test(ref.tone || '')) return null;
  const c = hexToLinear(ref.tone);
  const lum = (x: readonly number[]) => 0.2126 * x[0]! + 0.7152 * x[1]! + 0.0722 * x[2]!;
  let k = lum(like) / Math.max(1e-3, lum(c));
  // 很飽和的色調（亮度低、某一色很高）調亮後會有一色衝太高：最亮的那一色不超過原本顏色最亮那色的 1.3 倍
  const top = Math.max(c[0], c[1], c[2]) * k, cap = 1.3 * Math.max(like[0]!, like[1]!, like[2]!);
  if (top > cap) k *= cap / top;
  return [c[0] * k, c[1] * k, c[2] * k];
}

/** 由遠到近排（畫家演算法）：照卡片中心沿鏡頭方向的深度。 */
export function byDepth(cards: Card[], cam: Cam): Card[] {
  const d = (c: Card) => V().subVectors(c.c, cam.pos).dot(cam.f);
  return cards.slice().sort((a, b) => d(b) - d(a));
}

/** 把卡片寫進 shader（照給的順序由後往前疊）。 */
export function setCards(pass: FSPass, cards: Card[]) {
  const u = pass.u;
  const n = Math.min(NC, cards.length);
  u.nCards!.value = n;
  const C = u.cC!.value as THREE.Vector3[], U = u.cU!.value as THREE.Vector3[], Vv = u.cV!.value as THREE.Vector3[];
  const B = u.cBox!.value as THREE.Vector4[], P = u.cPh!.value as THREE.Vector4[], R = u.cCrop!.value as THREE.Vector4[];
  const X = u.cFx!.value as THREE.Vector4[], X2 = u.cFx2!.value as THREE.Vector4[], G = u.cGain!.value as number[];
  for (let i = 0; i < NC; i++) {
    const cd = cards[i];
    if (!cd || i >= n) { X[i]!.set(0, 0, 0, 0); continue; }
    C[i]!.copy(cd.c); U[i]!.copy(cd.u); Vv[i]!.copy(cd.v);
    B[i]!.set(cd.hw, cd.hh, cd.pw, cd.ph);
    P[i]!.set(cd.ox, cd.oy, cd.slot, cd.kind);
    R[i]!.set(...cd.crop);
    X[i]!.set(cd.lodBase, cd.blur, cd.dim, cd.alpha);
    X2[i]!.set(cd.radius, cd.back, cd.cast, cd.extra);
    G[i] = cd.gain;
  }
}

/** 每格都要重設照片（shader 是同一個版面的所有窗格共用的）。 */
export function setSlots(pass: FSPass, slots: Slot[]) {
  for (let i = 0; i < 6; i++) pass.u[`ph${i}`]!.value = slots[Math.min(i, slots.length - 1)]?.tex ?? null;
}

const arr3 = () => Array.from({ length: NC }, () => new THREE.Vector3());
const arr4 = () => Array.from({ length: NC }, () => new THREE.Vector4());

/**
 * 照片卡的全螢幕 shader。版面給兩段 GLSL：
 *  - pre（卡片的鉤子，traceCards 之前）：
 *      `vec3 matColor(int i, vec2 q, vec2 hb, float pxw)`：卡上照片以外的地方（白邊、卡紙、框）。q 是卡上座標（x 向右、y 向下，中心原點），hb 是卡的半寬高。
 *      `vec3 backColor(int i, vec2 q, vec2 hb)`：背面。
 *      `vec3 shade(int i, vec3 base, vec3 hp, vec3 n, vec3 rd, float isPh, vec2 q, bool refl)`：打光（影子用 shadowAt(hp, i)）。
 *  - post（背景與收尾，可以呼叫 traceCards 算倒影）：
 *      `vec3 background(vec3 ro, vec3 rd, vec2 p)`、`vec3 finish(vec3 col, vec2 p, vec3 rd)`（p 是畫面邏輯像素，y 向下）。
 * 照片取樣：`photoAt(slot, uv, lod)`（線性、最亮壓在 0.82，不會被 bloom 打到）、`photoBlur(...)`。
 */
export function cardsPass(pre: string, post: string, uniforms: Record<string, THREE.IUniform> = {}) {
  return new FSPass(/* glsl */ `
  #define NC ${NC}
  uniform sampler2D ph0; uniform sampler2D ph1; uniform sampler2D ph2; uniform sampler2D ph3; uniform sampler2D ph4; uniform sampler2D ph5;
  uniform vec3 camPos; uniform vec3 camR; uniform vec3 camU; uniform vec3 camF; uniform float focal;
  uniform int nCards;
  uniform vec3 cC[NC]; uniform vec3 cU[NC]; uniform vec3 cV[NC];
  uniform vec4 cBox[NC]; uniform vec4 cPh[NC]; uniform vec4 cCrop[NC]; uniform vec4 cFx[NC]; uniform vec4 cFx2[NC]; uniform float cGain[NC];
  uniform vec3 lightDir; uniform float shadowK; uniform float penumbra; uniform float k; uniform float time;

  vec3 phRaw(int s, vec2 uv, float lod) {
    vec4 c;
    if (s <= 0) c = textureLod(ph0, uv, lod);
    else if (s == 1) c = textureLod(ph1, uv, lod);
    else if (s == 2) c = textureLod(ph2, uv, lod);
    else if (s == 3) c = textureLod(ph3, uv, lod);
    else if (s == 4) c = textureLod(ph4, uv, lod);
    else c = textureLod(ph5, uv, lod);
    return c.rgb;
  }
  // 照片不能發光：白紗、天空在線性空間壓在 0.82 以下
  vec3 photoAt(int s, vec2 uv, float lod) { return toLinear(phRaw(s, clamp(uv, 0.0, 1.0), max(lod, 0.0))) * 0.82; }
  // 模糊一點（離焦、當底）：低一點的 mip 層加一圈八個取樣（只用 mip 會看到方塊）。r：圈的半徑（uv）
  vec3 photoBlur(int s, vec2 uv, float lod, vec2 r) {
    vec3 b = photoAt(s, uv, lod) * 0.2;
    for (int j = 0; j < 8; j++) {
      float a = float(j) * 0.785398 + 0.3927;
      b += photoAt(s, uv + vec2(cos(a), sin(a)) * r * (j % 2 == 0 ? 1.0 : 0.6), lod) * 0.1;
    }
    return b;
  }
  float sdRBox(vec2 p, vec2 b, float r) { r = min(r, min(b.x, b.y)); vec2 d = abs(p) - b + r; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }
  vec3 cardN(int i) { return normalize(cross(cV[i], cU[i])); }
  vec2 cardQ(int i, vec3 x) { vec3 d = x - cC[i]; return vec2(dot(d, cU[i]), dot(d, cV[i])); }

  // x 點被其他卡擋住多少光（1 = 全亮）：沿著光的方向找擋在前面的卡，離得越遠影子越軟、越淡
  float shadowAt(vec3 x, int self) {
    float lit = 1.0;
    for (int j = 0; j < NC; j++) {
      if (j >= nCards) break;
      if (j == self || cFx2[j].z < 0.5 || cFx[j].w <= 0.0) continue;
      vec3 n = cardN(j);
      float dn = dot(lightDir, n);
      if (abs(dn) < 1e-3) continue;
      float s = dot(cC[j] - x, n) / dn;
      if (s <= 0.02) continue;
      vec2 q = cardQ(j, x + lightDir * s);
      float w = 1.5 + s * penumbra;
      float d = sdRBox(q, cBox[j].xy, cFx2[j].x);
      float occ = (1.0 - smoothstep(-w, w, d)) * mix(1.0, 0.45, sat(s / 500.0));
      lit *= 1.0 - shadowK * occ * cFx[j].w;
    }
    return lit;
  }

  ${pre}

  // 卡片 i 在這條光線上的顏色與覆蓋率（a = 0：沒打到）
  vec4 cardHit(int i, vec3 ro, vec3 rd, bool refl) {
    vec4 fx = cFx[i];
    if (fx.w <= 0.0) return vec4(0.0);
    vec3 n = cardN(i);
    float dn = dot(rd, n);
    if (abs(dn) < 1e-4) return vec4(0.0);
    float t = dot(cC[i] - ro, n) / dn;
    if (t <= 0.0) return vec4(0.0);
    vec3 hp = ro + rd * t;
    vec2 q = cardQ(i, hp);
    vec4 box = cBox[i];
    // 一個實體像素在卡上多寬（斜看的卡拉長一點）；景深的模糊加在邊緣與 mip 層上
    float pxw = t / (focal * PX_SCALE) * inversesqrt(max(abs(dn), 0.04));
    float soft = pxw * (1.0 + fx.y * PX_SCALE * 1.4);
    float d = sdRBox(q, box.xy, cFx2[i].x);
    float a = 1.0 - smoothstep(-0.5 * soft, 0.5 * soft, d);
    if (a <= 0.0) return vec4(0.0);
    bool back = dn > 0.0;
    vec3 base;
    float isPh = 0.0;
    if (back) base = backColor(i, q, box.xy);
    else {
      base = matColor(i, q, box.xy, pxw);
      vec4 ph = cPh[i];
      if (ph.z > -0.5 && box.z > 0.0) {
        vec2 pq = q - ph.xy;
        float dp = sdBox(pq, box.zw);
        float ap = 1.0 - smoothstep(-0.5 * soft, 0.5 * soft, dp);
        if (ap > 0.0) {
          vec4 cr = cCrop[i];
          vec2 uv = cr.xy + (pq / (2.0 * box.zw) + 0.5) * (cr.zw - cr.xy);
          float lod = fx.x + log2(pxw);
          int s = int(ph.z + 0.5);
          vec3 pc;
          if (fx.y > 0.6) pc = photoBlur(s, uv, lod + log2(1.0 + 0.45 * fx.y * PX_SCALE), vec2(0.9 * fx.y * PX_SCALE * pxw) / (2.0 * box.zw) * (cr.zw - cr.xy));
          else pc = photoAt(s, uv, lod);
          base = mix(base, pc * cGain[i], ap);
          isPh = ap;
        }
      }
    }
    vec3 c = shade(i, base, hp, back ? -n : n, rd, isPh, q, refl);
    return vec4(c * fx.z, a * fx.w);
  }

  vec3 traceCards(vec3 ro, vec3 rd, vec3 col, bool refl) {
    for (int i = 0; i < NC; i++) {
      if (i >= nCards) break;
      vec4 h = cardHit(i, ro, rd, refl);
      col = mix(col, h.rgb, h.a);
    }
    return col;
  }

  ${post}

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 rd = normalize(camF * focal + camR * (p.x - ${W / 2}.0) - camU * (p.y - ${H / 2}.0));
    vec3 col = background(camPos, rd, p);
    col = traceCards(camPos, rd, col, false);
    col = finish(col, p, rd);
    fragColor = vec4(col * k, 1.0);
  }`, {
    ph0: { value: null }, ph1: { value: null }, ph2: { value: null }, ph3: { value: null }, ph4: { value: null }, ph5: { value: null },
    camPos: { value: V() }, camR: { value: V() }, camU: { value: V() }, camF: { value: V() }, focal: { value: 1 },
    nCards: { value: 0 }, cC: { value: arr3() }, cU: { value: arr3() }, cV: { value: arr3() },
    cBox: { value: arr4() }, cPh: { value: arr4() }, cCrop: { value: arr4() }, cFx: { value: arr4() }, cFx2: { value: arr4() },
    cGain: { value: Array.from({ length: NC }, () => 1) },
    lightDir: { value: new THREE.Vector3(-0.3, 0.4, 0.87).normalize() }, shadowK: { value: 0.5 }, penumbra: { value: 0.1 },
    k: { value: 1 }, time: { value: 0 },
    ...uniforms,
  });
}

/** 卡片上的字層取樣（fast 的 Layer2D：預乘、sRGB；flipY，v = 0 是畫布底）：q 是卡上座標，hb 是卡的半寬高，size 是字層的大小（世界單位）。 */
export const GLSL_INK = /* glsl */ `
  vec4 inkAt(sampler2D tx, vec2 q, vec2 hb, vec2 size, float lod) {
    // 字層的左上角對齊卡片的左上角（卡片可以比字層矮或高：只用到重疊的那一段）
    // （只留一個出口：中途 return 會讓 ANGLE／D3D 出 X4000 警告）
    vec2 uv = (q + hb) / size;
    vec4 c = vec4(0.0);
    if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) c = fastLayer(textureLod(tx, vec2(uv.x, 1.0 - uv.y), max(lod, 0.0)));
    return c;
  }`;

/** 讓 Layer2D 有 mipmap（字貼在會縮放、斜放的卡上時才不會閃）。 */
export function mipLayer(L: Layer2D) {
  L.texture.generateMipmaps = true;
  L.texture.minFilter = THREE.LinearMipmapLinearFilter;
  return L;
}

// ---------------------------------------------------------------- 字層

/** 把 Layer2D 貼到畫面上：左上角在 (x, y)、放大 s 倍。 */
export function drawLayer(ctx: SceneCtx, L: Layer2D, out: THREE.WebGLRenderTarget, x: number, y: number, opacity = 1, s = 1) {
  const sx = W / (L.w * s), sy = H / (L.h * s);
  ctx.comp.draw(ctx.renderer, L.texture, out, { opacity, scale: [sx, sy], offset: [0.5 * sx - 0.5 - x / (L.w * s), 0.5 + y / (L.h * s) - 0.5 * sy] });
}

// ---------------------------------------------------------------- 字（主角的主字＋歌詞：_photo.ts 的 PhotoText 包一層）

/** 這個窗格有沒有任何字（主字或歌詞）：沒有的話版面不留說明欄，照片照自己的排法置中。 */
export function hasWords(ctx: SceneCtx): boolean {
  const w = photoWords(ctx);
  return w.kind !== 'none' || w.lyrics;
}

/** 排版、量高度用的畫布（字層要等量完才知道多大）。 */
let scratch: CanvasRenderingContext2D | null = null;
const measureCtx = () => (scratch ??= document.createElement('canvas').getContext('2d')!);

export interface CapStyle {
  family: string;
  /** 字塊（主字＋署名＋歌詞）的寬、高上限（不含 pad 與上面的相簿名）。lyricsApart 時高度只算主字＋署名。 */
  w: number; h: number;
  /** 主字的字級範圍（預設 40～50）、行高、最多幾行（預設 4）。 */
  min?: number; max?: number; lineHeight?: number; maxLines?: number;
  align?: 'left' | 'center' | 'right';
  tracking?: number;
  /** 主字與唱完的歌詞的顏色；正在唱的、還沒唱的。 */
  color: string; active?: string; unsung?: string;
  /** 字邊的軟影（字直接寫在照片或暗底上才需要；紙上的字不用）。 */
  shadow?: string; shadowBlur?: number;
  /** 署名（只有留言有）：字族（預設主字的）、字級（預設 28）、顏色（預設 color）。 */
  sigFamily?: string; sigSize?: number; sigColor?: string;
  /** 歌詞：字族；沒有主字、歌詞自己當主字的字級（預設 48）；在主字下面當字幕的字級（預設 38）；跟主字之間的空。 */
  lyricFamily?: string; lyricSize?: number; lyricSubSize?: number; gap?: number;
  /** 相簿的第一張：字塊上面小小一行相簿名。 */
  album?: { family: string; size: number; color: string; tracking?: number } | null;
  /** 字塊上面一條短線。 */
  rule?: { color: string; w: number } | null;
  /** 相簿名的基線離字塊上緣多遠（預設 14）。 */
  headGap?: number;
  /** 主字一個字一個字寫出來（每個字幾秒；0 = 整段一起出現）。署名在主字寫完才出現。 */
  write?: number;
  /** 字層四周多留的邊（px）、字層解析度倍數（貼在會縮放的卡上時給 1.5）。 */
  pad?: number; scale?: number;
  /**
   * 有主字時歌詞另外放（物件上放不下）：主字＋署名在 L，歌詞在另一張圖層 LL（一樣寬），版面決定歌詞放哪（位置固定）。
   * 沒有主字時歌詞照樣當主字、畫在 L。
   */
  lyricsApart?: boolean;
}

/**
 * 主角的字（P10 這批的說明欄）：PhotoText 的主字（留言＋署名，或新人的註解）＋跟唱的歌詞，加上相簿名小標籤、短線、逐字寫出。
 * 字層照字的多寡做（量完才建）：init() 之後才有 L。
 */
export class Caption {
  L!: Layer2D;
  /** 歌詞另外一張（lyricsApart 而且有主字、有歌詞時才有）。 */
  LL: Layer2D | null = null;
  text!: PhotoText;
  pad: number;
  headH = 0;
  /** 字塊（相簿名＋主字＋署名＋歌詞）的高度：版面排位置用。 */
  blockH = 0;
  /** 逐字寫出的起點與終點。 */
  t0 = 0; t1 = 0;
  private headOn = false;
  constructor(private ctx: SceneCtx, public photo: PhotoRef, public st: CapStyle, private own: Own) {
    this.pad = st.pad ?? 24;
  }

  async init() {
    const st = this.st, ph = this.photo;
    await loadText(`${ph.album}…`);
    await loadWords(this.ctx);
    this.text = new PhotoText(this.ctx, measureCtx(), {
      family: st.family, w: st.w, h: st.h, min: st.min ?? 40, max: st.max ?? 50, lineHeight: st.lineHeight ?? 1.4, maxLines: st.maxLines ?? 4,
      align: st.align ?? 'left', tracking: st.tracking ?? 0, ink: st.color, unsung: st.unsung, active: st.active,
      sigFamily: st.sigFamily, sigSize: st.sigSize ?? 28, sigInk: st.sigColor,
      lyricFamily: st.lyricFamily, lyricSize: st.lyricSize, lyricSubSize: st.lyricSubSize, gap: st.gap,
      shadow: st.shadow ? { color: st.shadow, blur: st.shadowBlur ?? 12 } : null, lyricsApart: !!st.lyricsApart,
    });
    const al = st.album && ph.chapter && ph.album ? st.album.size + 4 + (st.headGap ?? 14) : 0;
    const ru = st.rule ? 26 : 0;
    this.headH = this.text.has ? al + ru : 0;
    this.blockH = this.text.has ? this.headH + this.text.height : 0;
    // 字層照實際的字塊做（不留一大片空白：卡片、紙條照這個高度裁，上傳也省）；最後一行的下伸部（g、y）在 pad 裡
    const scale = (st.scale ?? 1) * SCALE;
    this.L = this.own(new Layer2D(st.w + 2 * this.pad, Math.ceil(2 * this.pad + Math.max(this.blockH, 1) + 8), scale, { fast: true }));
    if (this.apart) this.LL = this.own(new Layer2D(st.w + 2 * this.pad, Math.ceil(2 * this.pad + this.text.lyricH + 8), scale, { fast: true }));
  }

  get has() { return this.text.has; }
  get hasMain() { return this.text.hasMain; }
  /** 主字的排版（沒有主字是 null）：紙上的橫線跟著它的行距。 */
  get fit() { return this.text.fit; }
  /** 歌詞另外放（版面要畫 LL）。 */
  get apart() { return !!this.st.lyricsApart && this.text.hasMain && this.text.sung; }
  /** 字層裡實際用到的高度（上下 pad 都算）。 */
  get usedH() { return this.L.h; }
  /** 字塊第一行的頂、對齊點（字層座標）。 */
  get top() { return this.pad + this.headH; }
  private get ax() { const a = this.st.align ?? 'left'; return a === 'center' ? this.pad + this.st.w / 2 : a === 'right' ? this.pad + this.st.w : this.pad; }

  /** 主字逐字寫出：從 t0 開始，最多 maxDur 秒寫完。 */
  writeFrom(t0: number, maxDur = 2) {
    this.t0 = t0;
    this.t1 = t0 + Math.min(maxDur, (this.st.write ?? 0.06) * this.text.chars + 0.2);
  }

  /** 主字這一格寫到第幾個字（不逐字寫就是全部）。 */
  private charsAt(t: number) {
    const n = this.text.chars;
    if (!this.st.write) return Infinity;
    return t >= this.t1 ? Infinity : Math.floor(clamp((t - this.t0) / Math.max(0.01, this.t1 - this.t0)) * n);
  }

  /** 畫到字層（內容沒變就不重畫、不重傳）。回傳這個窗格有沒有字（沒有就不用貼）。 */
  draw(t: number): boolean {
    const T = this.text;
    if (!T.has) return false;
    const L = this.L, chars = this.charsAt(t);
    // 逐字寫出的還沒開始寫：相簿名也先不要出現（第一個字出來時一起出現）
    this.headOn = !T.hasMain || chars > 0;
    if (T.draw(L.ctx, t, this.ax, this.top, { chars, clear: () => { L.clear(); this.paintHead(); } })) L.upload();
    return true;
  }

  /** 歌詞另外放時：畫歌詞那一張（LL，(pad, pad) 是第一排的頂）。回傳有沒有。 */
  drawLyrics(t: number): boolean {
    const LL = this.LL;
    if (!LL) return false;
    if (this.text.drawLyrics(LL.ctx, t, this.ax, this.pad, { clear: () => LL.clear() })) LL.upload();
    return true;
  }

  /** 相簿名與短線：在字塊上面。 */
  private paintHead() {
    const st = this.st, c = this.L.ctx, ax = this.ax, align = st.align ?? 'left';
    if (!this.headOn || !this.headH) return;
    let hy = this.top - (st.headGap ?? 14);
    c.save();
    if (st.album && this.photo.chapter && this.photo.album) {
      const a = st.album;
      c.font = font(a.family, a.size);
      c.letterSpacing = `${a.tracking ?? 4}px`;
      c.fillStyle = a.color;
      c.textAlign = align;
      let s = this.photo.album;
      while (s.length > 1 && c.measureText(s).width > st.w) s = s.slice(0, -1);
      c.fillText(s === this.photo.album ? s : `${s}…`, ax, hy);
      hy -= a.size + 12;
    }
    if (st.rule) {
      c.fillStyle = st.rule.color;
      const rx = align === 'center' ? ax - st.rule.w / 2 : align === 'right' ? ax - st.rule.w : ax;
      c.fillRect(rx, hy - 4, st.rule.w, 2);
    }
    c.restore();
  }
}

// ---------------------------------------------------------------- 焦點

/**
 * 主角往焦點推（ENGINE.md「焦點」）：照片放在 pw×ph（半寬高）的框裡，框裡的畫面繞著焦點慢慢放大到 zoom 倍。
 * 框跟照片同比例（完整放）時 k = 0 是整張；框的比例不一樣時先繞著焦點裁成框的比例。很小的照片照框在畫面上的寬（screenW）少推，不推糊。
 */
export function pushCrop(sl: Slot, pw: number, ph: number, k: number, zoom = 1.18, screenW = 2 * pw): [number, number, number, number] {
  return focusCrop(sl.ref, sl.w, sl.h, pw / Math.max(1e-3, ph), k, { zoom, screenW });
}

// ---------------------------------------------------------------- 時間

/**
 * n 個事件的時間：從 t0 之後的拍點開始，一拍（或幾拍）一個，全部在 span 秒內；拍子太慢、窗格太短就半拍一個，再不夠就平均排。
 * 主角的事件在最後：版面用這個把配角的動作做完，主角停最久。
 */
export function beatTimes(au: AudioData, t0: number, n: number, span: number): number[] {
  if (n <= 0) return [];
  const bp = au.beatPeriod(t0);
  const b0 = Math.ceil(au.beatAt(t0) - 1e-6);
  const first = au.timeOfBeat(b0);
  const room = Math.max(0.2, span - (first - t0));
  const per = room / n;
  let step = Math.floor(per / bp);
  if (step >= 1) {
    step = Math.min(step, 4);
    return Array.from({ length: n }, (_, i) => au.timeOfBeat(b0 + i * step));
  }
  if (per >= bp / 2) return Array.from({ length: n }, (_, i) => au.timeOfBeat(b0 + i * 0.5));
  return Array.from({ length: n }, (_, i) => t0 + (span * (i + 0.5)) / n);
}

/** 拍點之後的一下「推」：很快起來、慢慢回去（0..1）。 */
export function kickAt(au: AudioData, t: number, perBar = true, decay = 4): number {
  const i = perBar ? Math.floor(au.barAt(t)) : Math.floor(au.beatAt(t));
  const t0 = perBar ? au.timeOfBar(i) : au.timeOfBeat(i);
  const dt = t - t0;
  if (dt < 0) return 0;
  return Math.exp(-dt * decay) * (1 - Math.exp(-dt * 28));
}

export { beatAfter, F, focusIn, settleK };
