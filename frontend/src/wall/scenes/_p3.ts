// 批次 P3（相簿與剪貼：flipalbum、scrapbook、stickyalbum、yearbook、journal、diary、cardback、photobook、bookmark、collagecard）共用的小工具。
// 十個版面都是「紙本的東西擺在桌上，鏡頭在空間裡拍」：相簿、手帳、日記、明信片、寫真書……
// 照風格聖經的 MV 融合原則，紙本不能是正面、靜止的平面截圖，所以每個版面都用一支透視鏡頭逐點打射線（一個全螢幕 shader），
// 紙、照片、字都是空間裡的面，跟著透視、光線、景深一起動。這裡放大家共用的部分：
//  - 鏡頭（Cam）：位置、方向、焦距，交給 shader 的 uniform；世界座標 x 往右、y 往桌子裡面、z 往上，單位約等於畫面 px。
//  - GLSL（P3_GLSL）：射線、景深的模糊圈、貼圖的 mip 層、照片取樣（壓亮度、不發光）、字層取樣、方盒與「翻頁」曲面的交點與影子。
//  - 烤好的雜訊貼圖（p3Noise）：紙纖維、木紋、斑駁都從這張可以重複鋪的貼圖取（mip 當景深模糊），不用每格每點算好幾層 fbm（會場內顯省力）。
//  - 照片：載入、做成貼圖、算在紙上多大（很小的照片最多放大到原尺寸約 1.5 倍）；相片上的畫面往焦點推（picCrop＋shader 的 cropUv）。
//  - 字（TextCol）：照 _photo.ts 的 PhotoText——主字（賓客留言＋署名，或新人的註解）＋跟唱的歌詞，畫在一張 Canvas 上
//    （有 mipmap，焦外時跟著糊），版面在 shader 裡把它貼到紙面上；兩個都沒有就沒有字。
import * as THREE from 'three';
import { FSPass, Layer2D, SCALE } from '../engine/gl';
import { shared, type SceneCtx } from '../engine/scene';
import type { AudioData } from '../engine/audio';
import { font } from '../engine/type';
import { clamp } from '../engine/util';
import { beatAfter } from './_motifs';
import { focusCrop, focusIn, photoTexture, photoWords, PhotoText } from './_photo';
import type { PhotoRef, PhotoImage } from '../photos';

export type V3 = [number, number, number];

/** 右下角 HUD（QR）：字不要進 x ≥ 1360 且 y ≥ 830。字離四邊至少 96 px。 */
export const HUD = { x: 1360, y: 830 };
export const EDGE = 96;

// ---------------------------------------------------------------- 鏡頭
/**
 * 透視鏡頭：shader 逐點打射線（viewDir），這裡只算位置與方向。
 * orbit()：從目標點往後退 dist，仰角 el（度，90 = 正上方往下看）、方位 az（度，正 = 鏡頭往右繞）、滾轉 roll（度）。
 */
/**
 * 視角 30 度的焦距（px）。版面算鏡頭距離一律用這個常數，不要用 `cam.focal`：
 * cam.focal 是「上一次 look() 的視角」算出來的，init() 裡為了排版用別的視角 look 過一次的話，
 * 窗格的第一格會拿到舊的焦距（照片突然變小），同一個時間點畫兩次就不一樣。
 */
export const CAM_FOCAL = 540 / Math.tan((30 * Math.PI) / 360);

export class Cam {
  pos = new THREE.Vector3(0, -2000, 1000);
  r = new THREE.Vector3(1, 0, 0);
  u = new THREE.Vector3(0, 1, 0);
  f = new THREE.Vector3(0, 0, -1);
  focal = 2015;
  private tmp = new THREE.Vector3();

  look(pos: V3, target: V3, fov = 30, roll = 0) {
    this.focal = 540 / Math.tan((fov * Math.PI) / 360);
    this.pos.set(...pos);
    this.f.set(target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]).normalize();
    // 地平線保持水平：以世界的上方（+z）定左右；幾乎正上方往下看時改用「桌子裡面（+y）」當畫面的上方
    const hint = Math.abs(this.f.z) > 0.98 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    this.r.crossVectors(this.f, hint).normalize();
    if (this.r.lengthSq() < 1e-6) this.r.set(1, 0, 0);
    this.u.crossVectors(this.r, this.f).normalize();
    if (roll) {
      const a = (roll * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
      const r2 = this.r.clone().multiplyScalar(c).addScaledVector(this.u, s);
      const u2 = this.u.clone().multiplyScalar(c).addScaledVector(this.r, -s);
      this.r.copy(r2); this.u.copy(u2);
    }
    return this;
  }

  orbit(target: V3, dist: number, el: number, az = 0, fov = 30, roll = 0) {
    const e = (el * Math.PI) / 180, a = (az * Math.PI) / 180;
    const pos: V3 = [target[0] + dist * Math.cos(e) * Math.sin(a), target[1] - dist * Math.cos(e) * Math.cos(a), target[2] + dist * Math.sin(e)];
    return this.look(pos, target, fov, roll);
  }

  /** 鏡頭空間的深度（沿視線）。 */
  depth(p: V3) { return this.tmp.set(p[0] - this.pos.x, p[1] - this.pos.y, p[2] - this.pos.z).dot(this.f); }
  /** 世界座標 → 畫面 px（y 向下）。 */
  toScreen(p: V3) {
    const v = this.tmp.set(p[0] - this.pos.x, p[1] - this.pos.y, p[2] - this.pos.z);
    const z = v.dot(this.f), x = v.dot(this.r), y = v.dot(this.u);
    return { x: 960 + (x / z) * this.focal, y: 540 - (y / z) * this.focal };
  }
  /** 在 p 這一點，一個世界單位是幾個畫面 px（面對鏡頭的面）。 */
  scaleAt(p: V3) { return this.focal / Math.max(1, this.depth(p)); }

  apply(u: Record<string, THREE.IUniform>) {
    (u.camPos!.value as THREE.Vector3).copy(this.pos);
    (u.camR!.value as THREE.Vector3).copy(this.r);
    (u.camU!.value as THREE.Vector3).copy(this.u);
    (u.camF!.value as THREE.Vector3).copy(this.f);
    u.camFocal!.value = this.focal;
  }
}

/** 兩個鏡頭姿勢之間內插（位置、目標點、仰角、方位、距離都是數字，各版面自己組）。 */
export const mixN = (a: number, b: number, k: number) => a + (b - a) * k;

/** P3 版面 shader 共用的 uniform（每個 pass 一份）。 */
export function camUniforms(): Record<string, THREE.IUniform> {
  return {
    camPos: { value: new THREE.Vector3() }, camR: { value: new THREE.Vector3(1, 0, 0) }, camU: { value: new THREE.Vector3(0, 1, 0) },
    camF: { value: new THREE.Vector3(0, 0, -1) }, camFocal: { value: 2015 },
    focusD: { value: 2000 }, aper: { value: 0 }, noiseTex: { value: null }, k: { value: 1 }, photoGain: { value: 1 },
  };
}

// ---------------------------------------------------------------- 烤好的雜訊
// 512² 可以重複鋪的雜訊（週期性的 value noise），四個通道：
//  r = 大片的斑駁（週期 4～64 格）、g = 纖維（橫的長條＋直的長條）、b = 每個 texel 的細顆粒、a = 中等的 fbm（木紋、布紋用）。
// 有 mipmap：焦外的地方取粗一層，就是景深模糊；確定性（同一張貼圖、自己算的 mip 層）。
const BAKE = () => new FSPass(/* glsl */ `
  float vnP(vec2 p, vec2 per) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash12(mod(i, per)), b = hash12(mod(i + vec2(1.0, 0.0), per));
    float c = hash12(mod(i + vec2(0.0, 1.0), per)), d = hash12(mod(i + vec2(1.0, 1.0), per));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbmP(vec2 uv, float base, int oct) {
    float s = 0.0, a = 0.5, w = 0.0, per = base;
    for (int i = 0; i < 6; i++) {
      if (i >= oct) break;
      s += a * vnP(uv * per + float(i) * 17.0, vec2(per)); w += a;
      per *= 2.0; a *= 0.5;
    }
    return s / w;
  }
  void main() {
    vec2 uv = vUv;
    float r = fbmP(uv, 4.0, 5);
    float g = 0.5 * vnP(uv * vec2(256.0, 12.0), vec2(256.0, 12.0)) + 0.5 * vnP(uv * vec2(12.0, 256.0) + 5.0, vec2(12.0, 256.0));
    g = 0.65 * g + 0.35 * vnP(uv * vec2(128.0, 64.0) + 9.0, vec2(128.0, 64.0));
    float b = hash12(floor(uv * 512.0) + 0.5);
    float a = fbmP(uv + 0.37, 16.0, 4);
    fragColor = vec4(r, g, b, a);
  }`);

interface NoiseBake { rt: THREE.WebGLRenderTarget; pass: FSPass; done: boolean }

/** 雜訊貼圖（第一次用時烤一次，整晚共用）。版面在 init() 裡呼叫、存在自己的欄位。 */
export function p3Noise(renderer: THREE.WebGLRenderer): THREE.Texture {
  const n = shared<NoiseBake>('p3.noise', () => ({
    rt: new THREE.WebGLRenderTarget(512, 512, {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, depthBuffer: false,
    }),
    pass: BAKE(), done: false,
  }));
  if (!n.done) {
    const prev = renderer.getRenderTarget();
    n.pass.render(renderer, n.rt);
    renderer.setRenderTarget(prev);
    n.done = true;
  }
  return n.rt.texture;
}

// ---------------------------------------------------------------- GLSL
export const P3_GLSL = /* glsl */ `
uniform vec3 camPos; uniform vec3 camR; uniform vec3 camU; uniform vec3 camF; uniform float camFocal;
uniform float focusD; uniform float aper; uniform sampler2D noiseTex; uniform float k; uniform float photoGain;

/** 這個像素的邏輯座標（y 向下，跟 Canvas 一樣）。 */
vec2 pxPos() { return vec2(FRAG_PX.x, 1080.0 - FRAG_PX.y); }
/** 從鏡頭穿過畫面上 px 的射線方向。 */
vec3 viewDir(vec2 px) { return normalize(camR * (px.x - 960.0) + camU * (540.0 - px.y) + camF * camFocal); }
/** 射線打到 z = h 的平面的距離（打不到或在背後 < 0）。 */
float hitZ(vec3 ro, vec3 rd, float h) { return abs(rd.z) < 1e-6 ? -1.0 : (h - ro.z) / rd.z; }
/** 景深：沿視線深度 d 的模糊圈半徑（邏輯 px）。 */
float cocAt(float d) { return aper * abs(d - focusD) / max(d, 1.0); }
/** 一個邏輯 px 對應幾個世界單位：t = 射線長、n = 面的法向量（斜的面縮得多）。 */
float wppAt(float t, vec3 rd, vec3 n) { return t * dot(rd, camF) / (camFocal * sqrt(max(abs(dot(rd, n)), 0.12))); }
/** 貼圖的 mip 層：texPerWorld = 一個世界單位幾個 texel；模糊取「像素大小」與「模糊圈」大的那個。 */
float lodFor(float texPerWorld, float wpp, float coc) { return max(0.0, log2(texPerWorld * wpp * max(1.0 / PX_SCALE, coc * 0.7))); }
/** 雜訊（烤好的貼圖）：period = 貼圖一整張代表幾個世界單位。 */
vec4 nz(vec2 p, float period, float wpp, float coc) { return textureLod(noiseTex, p / period, lodFor(512.0 / period, wpp, coc)); }
/** 往焦點推：相片上的 uv（0..1）對應到照片的哪一塊（crop = picCrop() 的結果）。 */
vec2 cropUv(vec2 uv, vec4 crop) { return mix(crop.xy, crop.zw, uv); }
/** 照片取樣：sRGB → linear，壓到 0.82（白紗、天空不發光）；很暗的照片稍微提亮（photoGain，見 photoGain()）。 */
vec3 photoAt(sampler2D tex, vec2 uv, float lod) { return toLinear(textureLod(tex, clamp(uv, 0.0, 1.0), lod).rgb) * 0.82 * photoGain; }
/** 字層（fast Layer2D，有 mipmap）：uv 在 0..1 外是空的。 */
vec4 inkAt(sampler2D tex, vec2 uv, float lod) {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  return fastLayer(textureLod(tex, uv, lod));
}
/**
 * 織紋（布、亞麻）：-1..1 的三角波相乘。不用 sin(大數)：座標上千時 sin 的精度跟著顯示卡的編譯結果走，
 * 同一格畫兩次會差一階，整個畫面散著幾百個像素（確定性檢查不過）；fract 是精確的乘法與取整。
 */
float tri(float x) { return abs(fract(x) - 0.5) * 4.0 - 1.0; }
float weave(vec2 p, float period) { return 0.5 + 0.5 * tri(p.x / period) * tri(p.y / period); }
/** 軟邊的方塊覆蓋率（q 已經是方塊中心的座標）。 */
float boxCov(vec2 q, vec2 hs, float soft) { return 1.0 - smoothstep(-soft, soft, sdBox(q, hs)); }
/** 射線與軸對齊方盒：回傳 (進, 出)；進 > 出 就是沒打到。 */
vec2 boxHit(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (bmin - ro) * inv, t1 = (bmax - ro) * inv;
  vec3 tn = min(t0, t1), tf = max(t0, t1);
  return vec2(max(max(tn.x, tn.y), tn.z), min(min(tf.x, tf.y), tf.z));
}
/** 方盒上一點的法向量（打到哪一面）。 */
vec3 boxNormal(vec3 p, vec3 bmin, vec3 bmax) {
  vec3 c = (bmin + bmax) * 0.5, hs = (bmax - bmin) * 0.5;
  vec3 q = (p - c) / hs;
  vec3 a = abs(q);
  return a.x > a.y && a.x > a.z ? vec3(sign(q.x), 0.0, 0.0) : a.y > a.z ? vec3(0.0, sign(q.y), 0.0) : vec3(0.0, 0.0, sign(q.z));
}

/**
 * 翻頁的曲面：一張紙從鉸鏈線（平行 y 軸，在 xz 平面上的 h 點）出發，截面是固定曲率的圓弧（或直線）：
 * 起點切線角 a（0 = 平放朝 +x，PI = 平放朝 -x），整張轉 b 弧度，弧長 L，y 的範圍 yr。
 * 回傳 vec4(t, s, y, phi)：射線距離（沒打到 -1）、從鉸鏈量起的弧長、y、那一點的切線角（法向量 = (-sin phi, 0, cos phi) 是原本朝上的那面）。
 */
vec4 curlHit(vec3 ro, vec3 rd, vec2 h, float a, float b, float L, vec2 yr, float tMin) {
  // 只有一個出口（HLSL 對提早 return 的函式會警告回傳值可能沒初始化，不同的編譯結果可能差一點點）
  vec4 res = vec4(-1.0);
  vec2 o = ro.xz - h, d = rd.xz;
  if (abs(b) < 1e-3) {
    vec2 T = vec2(cos(a), sin(a)), N = vec2(-sin(a), cos(a));
    float dn = dot(d, N);
    if (abs(dn) >= 1e-7) {
      float t = -dot(o, N) / dn;
      float s = dot(o + t * d, T), y = ro.y + t * rd.y;
      if (t >= tMin && s >= 0.0 && s <= L && y >= yr.x && y <= yr.y) res = vec4(t, s, y, a);
    }
  } else {
    float kap = b / L;
    vec2 C = vec2(-sin(a), cos(a)) / kap;
    vec2 oc = o - C;
    float A = dot(d, d), B = dot(oc, d), Cq = dot(oc, oc) - 1.0 / (kap * kap);
    float disc = B * B - A * Cq;
    if (disc >= 0.0) {
      float sq = sqrt(disc);
      for (int i = 0; i < 2; i++) {
        float t = (-B + (i == 0 ? -sq : sq)) / A;
        vec2 P = oc + t * d;
        float phi = atan(kap * P.x, -kap * P.y);
        float dphi = mod(phi - a + PI, TAU) - PI;
        float s = dphi / kap, y = ro.y + t * rd.y;
        if (res.x < 0.0 && t >= tMin && s >= 0.0 && s <= L && y >= yr.x && y <= yr.y) res = vec4(t, s, y, a + dphi);
      }
    }
  }
  return res;
}
/** 翻頁曲面投在 p 點上的影子（0..1，邊緣隨距離變軟）：從 p 往光的方向 l 打射線，看會不會穿過那張紙。 */
float curlShadow(vec3 p, vec3 l, vec2 h, float a, float b, float L, vec2 yr) {
  vec2 o = p.xz - h, d = l.xz;
  float occ = 0.0;
  if (abs(b) < 1e-3) {
    vec2 T = vec2(cos(a), sin(a)), N = vec2(-sin(a), cos(a));
    float dn = dot(d, N);
    if (abs(dn) >= 1e-7) {
      float t = -dot(o, N) / dn;
      float s = dot(o + t * d, T), y = p.y + t * l.y;
      float dd = max(max(-s, s - L), max(yr.x - y, y - yr.y));
      float soft = 2.0 + 0.07 * t;
      occ = t < 0.5 ? 0.0 : 1.0 - smoothstep(-soft, soft, dd);
    }
  } else {
    float kap = b / L;
    vec2 C = vec2(-sin(a), cos(a)) / kap;
    vec2 oc = o - C;
    float A = dot(d, d), B = dot(oc, d), Cq = dot(oc, oc) - 1.0 / (kap * kap);
    float disc = B * B - A * Cq;
    if (disc >= 0.0) {
      float sq = sqrt(disc);
      for (int i = 0; i < 2; i++) {
        float t = (-B + (i == 0 ? -sq : sq)) / A;
        vec2 P = oc + t * d;
        float phi = atan(kap * P.x, -kap * P.y);
        float s = (mod(phi - a + PI, TAU) - PI) / kap, y = p.y + t * l.y;
        float dd = max(max(-s, s - L), max(yr.x - y, y - yr.y));
        float soft = 2.0 + 0.07 * t;
        if (t >= 0.5) occ = max(occ, 1.0 - smoothstep(-soft, soft, dd));
      }
    }
  }
  return occ;
}

/** 平放、離桌面 z 的東西（照片、膠帶、票根…）：射線打到 z 平面後，換成它自己的座標（中心 c、轉 ang）。 */
vec2 flatAt(vec3 ro, vec3 rd, vec2 c, float z, float ang, out float t) {
  t = hitZ(ro, rd, z);
  vec3 P = ro + rd * t;
  return rot2(ang) * (P.xy - c);
}
/** 離紙面 h 高的方塊（半寬高 hs、轉 ang）投在紙面 p 點上的軟影子（0..1）：光從 l 來，越高越偏、越軟。 */
float liftShadow(vec2 p, vec2 c, vec2 hs, float ang, float h, vec3 l) {
  vec2 q = rot2(ang) * (p - c + l.xy / l.z * h);
  float soft = 2.5 + 0.22 * h;
  return 1.0 - smoothstep(-soft, soft, sdBox(q, hs - soft * 0.3));
}
/** 紙膠帶：q = 膠帶自己的座標（長邊沿 x）、hs = 半長寬、seed。回傳 (覆蓋率, 花紋)：兩端是撕開的鋸齒、半透明。 */
vec2 tape(vec2 q, vec2 hs, float seed) {
  // 撕開的兩端：每 7 單位一個齒，深淺亂數
  float j = hash12(vec2(floor(q.y / 7.0), seed + sign(q.x) * 3.0));
  float endX = hs.x - 5.0 * j - 2.0 * hash12(vec2(floor(q.y / 2.5), seed));
  float cov = (1.0 - smoothstep(endX - 0.8, endX + 0.8, abs(q.x))) * (1.0 - smoothstep(hs.y - 0.8, hs.y + 0.6, abs(q.y)));
  // 花紋：斜條紋（跟膠帶一起轉）
  float pat = smoothstep(0.35, 0.5, abs(fract((q.x + q.y) / 22.0) - 0.5));
  return vec2(cov, pat);
}
/** 毛邊（波浪邊）的白邊相片：d = 外框的 SDF 加上一圈小波浪。q = 相片座標、hs = 外框半寬高、step = 波浪間距。 */
float deckleBox(vec2 q, vec2 hs, float stp, float amp) {
  vec2 a = abs(q);
  float along = (hs.x - a.x) < (hs.y - a.y) ? q.y : q.x;
  return sdBox(q, hs) + amp * (0.5 + 0.5 * cos(along * TAU / stp));
}
/**
 * 射線與空間裡任意方向的長方形（中心 c、兩個單位軸 ex、ey、半寬高 hs）：回傳 (t, u, v)，u、v 是從中心量的座標；沒打到 t = -1。
 * 飛起來、翻過去、立起來的照片與卡片用。
 */
vec3 rectHit(vec3 ro, vec3 rd, vec3 c, vec3 ex, vec3 ey, vec2 hs) {
  vec3 n = cross(ex, ey);
  float dn = dot(rd, n);
  if (abs(dn) < 1e-6) return vec3(-1.0);
  float t = dot(c - ro, n) / dn;
  vec3 q = ro + rd * t - c;
  float u = dot(q, ex), v = dot(q, ey);
  if (t < 0.0 || abs(u) > hs.x || abs(v) > hs.y) return vec3(-1.0, u, v);
  return vec3(t, u, v);
}
`;

// ---------------------------------------------------------------- 照片
export interface Pic { ref: PhotoRef; img: PhotoImage; tex: THREE.Texture }

/** 載入照片、做成貼圖、先傳到顯示卡（版面自己 this.track(pic.tex)）。照片池的圖不能 close。 */
export async function loadPic(renderer: THREE.WebGLRenderer, ref: PhotoRef): Promise<Pic> {
  const img = await ref.load();
  const tex = photoTexture(img);
  renderer.initTexture(tex);
  return { ref, img, tex };
}

/**
 * 照片在紙上的大小（世界單位）：放進 boxW × boxH，不裁切；readScale = 讀的時候一個世界單位是幾個畫面 px，
 * 很小的照片在畫面上最多放大到原尺寸約 1.5 倍。
 */
export function picSize(img: PhotoImage, boxW: number, boxH: number, readScale = 1, maxUp = 1.5): [number, number] {
  const s = Math.min(boxW / img.w, boxH / img.h, maxUp / readScale);
  return [img.w * s, img.h * s];
}

/**
 * 很暗的照片（平均亮度 < 0.3，例如夜景、室內沒開燈）放在紙上會悶：最多提亮 15%。
 * 暗的照片本來就沒有亮到會發光的地方，而且這批版面的 bloom 門檻都在 1.05 以上；不知道亮度（null）就不動。
 */
export const photoGain = (lum: number | null | undefined) => (lum == null ? 1 : 1 + 0.15 * clamp((0.3 - lum) / 0.3));

/** 照片的 mip 層（給 shader 的 lodFor 用）：一個世界單位幾個 texel；crop = 往焦點推時用到照片的哪一塊。 */
export const texPerWorld = (img: PhotoImage, worldW: number, crop?: readonly number[]) => (img.w * (crop ? crop[2]! - crop[0]! : 1)) / Math.max(1, worldW);

/**
 * 往焦點推（ENGINE.md「焦點」）：相片完整印在紙上（框跟照片同比例），相片上的畫面慢慢往焦點（新人點的臉）推，
 * 臉越來越大、越來越靠近相片中間，永遠不會被裁出去。實體相片推得少（預設 1.16 倍）；
 * screenW = 相片在畫面上的寬（px），很小的舊照片自動少推，不會推糊。回傳照片 uv 的範圍，shader 用 cropUv() 取樣。
 */
export function picCrop(pic: Pic, k: number, o: { zoom?: number; screenW?: number } = {}): [number, number, number, number] {
  const { img, ref } = pic;
  return focusCrop(ref, img.w, img.h, img.w / Math.max(1, img.h), k, { zoom: o.zoom ?? 1.16, screenW: o.screenW });
}

/**
 * 焦點在紙上的哪裡（世界座標）：相片中心 c、半寬高 hs（只算照片，不含白邊）、轉角 ang（逆時針、世界 y 往上）。
 * 鏡頭往臉推的版面用：讀的位置從「照片＋字」的中間往這一點靠一點。
 */
export function focusAt(pic: Pic, crop: readonly number[], c: readonly number[], hs: readonly number[], ang = 0): [number, number] {
  const [u, v] = focusIn(pic.ref, crop);
  const x = (u - 0.5) * 2 * hs[0]!, y = (0.5 - v) * 2 * hs[1]!;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  return [c[0]! + x * cs - y * sn, c[1]! + x * sn + y * cs];
}

// ---------------------------------------------------------------- 字
/** 有 mipmap 的字層（fast）：貼在斜的紙面上縮小時不閃，焦外時取粗一層就是糊的。 */
export function inkLayer(w: number, h: number) {
  const L = new Layer2D(Math.ceil(w), Math.ceil(h), SCALE, { fast: true });
  L.texture.generateMipmaps = true;
  L.texture.minFilter = THREE.LinearMipmapLinearFilter;
  return L;
}

export interface ColStyle {
  /** 主字（註解、留言）的字族、顏色（唱完的歌詞也是這個顏色）。 */
  family: string;
  ink: string;
  /** 還沒唱的歌詞、正在唱的字的顏色。 */
  unsung: string;
  active: string;
  /** 歌詞的字族（預設同主字）。 */
  lyricFamily?: string;
  /** 署名的字族、顏色（預設同主字）。 */
  sigFamily?: string;
  sigInk?: string;
  /**
   * 讀的時候一個世界單位是幾個畫面 px。字層上一個 px 就是一個世界單位，字級（畫面 px）除以它再畫上去，
   * 畫面上才是 ENGINE.md 的字級：主字 40～50、署名 28、主字下面的字幕歌詞 38、沒有主字時歌詞 48。
   */
  rs: number;
  /** 主字的字級範圍（畫面 px，預設 40～50）。 */
  size?: [number, number];
  lineHeight: number;
  /** 主字最多幾行（窄的欄可以多折幾行，只要高度放得下；60 字的留言也要放得進去）。 */
  maxLines: number;
  align?: 'left' | 'center';
  /** 主字（含署名）跟下面的歌詞之間的空（畫面 px，預設 25；要在中間畫底線之類的可以留多一點）。 */
  gap?: number;
  /** 相簿名的小標（相簿的第一張才有）。 */
  label?: { family: string; size: number; color: string; tracking: number; gap: number };
}

/** 讓 PhotoText 忘記上一次畫了什麼（欄裡的相簿名、底線、箭頭跟著重畫時，主字也要一起重畫）。 */
const forget = (tx: PhotoText) => tx.reset();

/**
 * 照片窗格的字一欄（畫在 inkLayer 上，左上角留 pad），內容照 _photo.ts 的 PhotoText（每個照片版面規則一致）：
 *  - 主字：賓客留言＋署名，或新人的註解；可以一個字一個字寫出來（writeFrom／writeTo，沒設就一次出現），署名在寫完才出現。
 *  - 歌詞：有主字時在主字下面小一號跟唱；沒有主字時歌詞自己當主字。
 *    這批版面的字都寫在紙面上夠大的地方（欄不夠時把紙、欄放大），整塊排在一起，不用 PhotoText 的 lyricsApart。
 *  - 都沒有：has = false，版面把照片移到中間，不留空欄。
 * 相簿的第一張在最上面多一行相簿名。
 */
export class TextCol {
  text: PhotoText;
  label = '';
  /** 相簿名佔的高度（版面可以改，例如日記讓它剛好佔一行橫線）。 */
  labelH = 0;
  writeFrom = -1;
  writeTo = -1;
  /** 字畫完之後在同一張圖層上加畫的東西（底線、箭頭…）：sig(t) 變了才重畫。 */
  deco: { sig(t: number): string; draw(c: CanvasRenderingContext2D, t: number): void } | null = null;
  readonly pad: number;
  /** 左邊留的空（預設跟 pad 一樣；要在字的左邊畫箭頭之類的可以留多一點）。 */
  readonly padL: number;
  private extra = '';

  constructor(public L: Layer2D, public w: number, public h: number, public st: ColStyle, ref: PhotoRef, ctx: SceneCtx, pad = 24, padL = pad) {
    this.pad = pad;
    this.padL = padL;
    const words = photoWords(ctx);
    if ((words.kind !== 'none' || words.lyrics) && ref.chapter && ref.album && st.label) {
      const c = L.ctx;
      c.font = font(st.label.family, st.label.size);
      c.letterSpacing = `${st.label.tracking}px`;
      let s = ref.album;
      while (s.length > 1 && c.measureText(s).width > w - 10) s = s.slice(0, -1);
      c.letterSpacing = '0px';
      this.label = s === ref.album ? s : `${s}…`;
      this.labelH = st.label.size + st.label.gap;
    }
    const rs = st.rs, [min, max] = st.size ?? [40, 50];
    this.text = new PhotoText(ctx, L.ctx, {
      family: st.family, w, h: h - this.labelH, min: min / rs, max: max / rs, lineHeight: st.lineHeight, maxLines: st.maxLines,
      align: st.align ?? 'left', ink: st.ink, unsung: st.unsung, active: st.active,
      sigFamily: st.sigFamily, sigInk: st.sigInk, sigSize: 28 / rs,
      lyricFamily: st.lyricFamily, lyricSize: 48 / rs, lyricSubSize: 38 / rs, gap: (st.gap ?? 25) / rs,
    });
  }

  /** 主字是什麼：留言、註解、歌詞（沒有主字）、都沒有。 */
  get mode() { return this.text.mode; }
  get has() { return this.text.has; }
  get hasMain() { return this.text.hasMain; }
  /** 主字的排版（沒有主字是 null）。 */
  get fit() { return this.text.fit; }
  get chars() { return this.text.chars; }
  /** 欄裡整塊的高度（相簿名＋主字＋署名＋歌詞）：版面排位置用。 */
  get contentH() { return this.text.has ? this.labelH + this.text.height : 0; }

  /** 在 t 畫好（內容有變才重畫、重傳），回傳有沒有字。yTop：整塊在欄裡往下移多少（垂直置中用）。 */
  draw(t: number, yTop = 0): boolean {
    const tx = this.text;
    if (!tx.has) return false;
    const L = this.L, c = L.ctx, center = this.st.align === 'center';
    let chars = Infinity;
    if (tx.hasMain && this.writeTo > this.writeFrom && t < this.writeTo) chars = Math.floor(clamp((t - this.writeFrom) / (this.writeTo - this.writeFrom)) * tx.chars);
    const extra = `${yTop}|${this.deco ? this.deco.sig(t) : ''}`;
    if (extra !== this.extra) { this.extra = extra; forget(tx); }
    const x0 = this.padL + (center ? this.w / 2 : 0);
    const drew = tx.draw(c, t, x0, this.pad + yTop + this.labelH, {
      chars,
      clear: () => {
        L.clear();
        const lb = this.st.label;
        if (!this.label || !lb) return;
        c.font = font(lb.family, lb.size);
        c.letterSpacing = `${lb.tracking}px`;
        c.fillStyle = lb.color;
        c.textAlign = center ? 'center' : 'left';
        c.fillText(this.label, x0, this.pad + yTop + lb.size * 0.9);
        c.textAlign = 'left';
        c.letterSpacing = '0px';
      },
    });
    if (drew) {
      if (this.deco) this.deco.draw(c, t);
      L.upload();
    }
    return true;
  }
}

// ---------------------------------------------------------------- 節拍
/** 窗格的第一拍（等太久就不等，直接在開頭後一點點）。 */
export function firstBeat(au: AudioData, start: number, maxWait = 0.6) {
  const b = beatAfter(au, start + 0.05);
  return b - start > maxWait ? start + 0.1 : b;
}
/** t 之後最近的一拍，限制在 [lo, hi] 之間（動作要落在拍點上，但短窗格不能等太久）。 */
export function beatNear(au: AudioData, t: number, lo: number, hi: number) {
  const b = beatAfter(au, t);
  return b > hi ? clamp(t, lo, hi) : Math.max(lo, b);
}
/** 一開始快、之後越來越慢（窗格長短都好看）。 */
export const settle = (lt: number, tau = 7) => 1 - Math.exp(-Math.max(0, lt) / tau);
