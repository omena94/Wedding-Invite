// 心電圖版面（heartbeat.ts）的「螢幕在房間裡」：監護儀的畫面先畫進一張 render target（螢幕座標 1920×1080），
// 這裡用透視（單應矩陣）把它貼到畫面上——稍微側轉的映像管，看得到機器的邊框、玻璃的弧度與一條淡淡的反光，
// 螢幕的光溢到周圍的暗房間。MV 融合原則：螢幕類版面要「螢幕在空間裡」，不要正面、完全靜止的介面截圖。
// 鏡頭是一個很簡單的 3D：監護儀是一片平面，繞垂直軸轉一點點（右邊比較遠），鏡頭慢慢推近、往前繞一點。
import * as THREE from 'three';
import { FSPass, W, H } from '../engine/gl';
import { clamp, ease, lerp } from '../engine/util';

type P2 = { x: number; y: number };

/** 監護儀在畫面上的姿勢：側轉角（弧度，正值 = 右邊比較遠）、中心的縮放、畫面上的中心點。 */
export interface MonitorPose { yaw: number; scale: number; cx: number; cy: number }

/** 鏡頭的距離（螢幕像素）：越近透視越強。 */
const DIST = 2600;

/**
 * 窗格進度 p（0..1）時的姿勢：一開始比較斜、比較遠，整個窗格慢慢推近、轉正一點（繞著監護儀往前走）。
 * 推得很慢：一個窗格只推 5%，像電影裡等待的鏡頭，不是縮放動畫。
 */
export function monitorPose(p: number): MonitorPose {
  const k = ease.inOutCubic(clamp(p));
  return { yaw: lerp(0.125, 0.085, k), scale: lerp(0.8, 0.842, k), cx: lerp(W / 2 - 14, W / 2 + 8, k), cy: lerp(H / 2 - 22, H / 2 - 30, k) };
}

/** 螢幕座標（監護儀畫面上的像素）→ 畫面像素。 */
export function project(pose: MonitorPose, u: number, v: number): P2 {
  const X = u - W / 2, Y = v - H / 2;
  const xr = X * Math.cos(pose.yaw), zr = X * Math.sin(pose.yaw);
  const k = DIST / (DIST + zr);
  return { x: pose.cx + pose.scale * xr * k, y: pose.cy + pose.scale * Y * k };
}

/** 3×3 單應矩陣（列優先）：四邊形 src 的四個角對到 dst 的四個角（DLT，高斯消去）。 */
export function homography(src: P2[], dst: P2[]): number[] {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]!, { x: u, y: v } = dst[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r;
    [A[c], A[p]] = [A[p]!, A[c]!];
    const d = A[c]![c]! || 1e-12;
    for (let k = c; k < 9; k++) A[c]![k]! /= d;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r]![c]!;
      if (f) for (let k = c; k < 9; k++) A[r]![k]! -= f * A[c]![k]!;
    }
  }
  return [A[0]![8]!, A[1]![8]!, A[2]![8]!, A[3]![8]!, A[4]![8]!, A[5]![8]!, A[6]![8]!, A[7]![8]!, 1];
}

/** 監護儀螢幕四周的邊框寬（螢幕座標的像素）。 */
const BEZEL = 64;

// 每個輸出像素：用反向的單應矩陣找回監護儀平面上的位置；螢幕裡取畫面（映像管微微鼓起）、邊框是暗色的塑膠，
// 外面是暗房間，靠近螢幕的地方被螢幕的光照亮一點。對焦拉到前景的紙條時，螢幕稍微虛一點、暗一點（淺景深）。
const FRAG = /* glsl */ `
uniform sampler2D scr; uniform mat3 toC; uniform float blur; uniform float dim; uniform float on;
const vec2 SZ = vec2(${W}.0, ${H}.0);
const vec2 DISC[8] = vec2[8](vec2(1.0, 0.0), vec2(0.707, 0.707), vec2(0.0, 1.0), vec2(-0.707, 0.707), vec2(-1.0, 0.0), vec2(-0.707, -0.707), vec2(0.0, -1.0), vec2(0.707, -0.707));
vec3 tap(vec2 c) {
  // render target 沒有 mipmap，但照規則在迴圈裡一律用 textureLod（確定性）
  return textureLod(scr, vec2(c.x / SZ.x, 1.0 - c.y / SZ.y), 0.0).rgb;
}
void main() {
  vec2 sp = vec2(vUv.x * SZ.x, (1.0 - vUv.y) * SZ.y);   // 畫面像素，y 向下
  vec3 q = toC * vec3(sp, 1.0);
  vec2 c = q.xy / q.z;                                    // 監護儀平面上的位置（螢幕座標）
  // 映像管的玻璃微微鼓起：取樣位置往外推一點（四周的內容被推出去，看起來是凸的）
  vec2 d = c / SZ - 0.5;
  vec2 cc = (0.5 + d * (1.0 - 0.1 * dot(d, d))) * SZ;
  float sdS = sdBox(c - SZ * 0.5, SZ * 0.5 - 36.0) - 36.0;          // 螢幕（圓角）
  float sdB = sdBox(c - SZ * 0.5, SZ * 0.5 + ${BEZEL}.0 - 44.0) - 44.0; // 機身外緣
  float px = length(vec2(dFdx(c.x), dFdy(c.y))) + 0.5;               // 一個畫面像素是多少螢幕像素（反鋸齒）

  // ---- 房間：底色，靠近機器的地方被螢幕的光照亮（訊號色帶一點紙白）
  vec3 room = C_INK * 0.6;
  float spill = exp(-max(sdB, 0.0) / 220.0);
  room += mix(C_SIGNAL, C_BONE, 0.35) * 0.011 * spill * on;
  // 地板（桌面）：畫面下緣暗一點
  room *= 0.85 + 0.15 * smoothstep(${H}.0, ${H * 0.5}.0, sp.y);

  // ---- 機身：暗色塑膠，上緣受一點光，內緣被螢幕照亮
  vec3 body = C_INK2 * 0.75 + C_GRAPHITE * 0.012;
  // 外緣一圈受光（上面多一點），內緣被螢幕照亮：靠這兩條細亮邊讀出機身的形狀
  body += C_BONE * 0.022 * smoothstep(14.0, 0.0, abs(sdB + 6.0)) * (0.35 + 0.65 * smoothstep(${H * 0.7}.0, 0.0, c.y));
  body += mix(C_SIGNAL, C_BONE, 0.4) * 0.03 * exp(-max(sdS, 0.0) / 9.0) * on;

  // ---- 螢幕：取樣（對焦在前景時用八點圓盤虛一點），四角暗、一條斜斜的反光
  vec3 scrc = tap(cc);
  if (blur > 0.05) {
    vec3 acc = scrc;
    for (int i = 0; i < 8; i++) acc += tap(cc + DISC[i] * blur);
    scrc = acc / 9.0;
  }
  scrc *= dim;
  float edge = length(d * vec2(1.0, 1.1)) * 1.35;
  scrc *= 1.0 - 0.45 * pow(sat(edge), 3.0);
  // 玻璃的反光：房間裡某盞燈的倒影，一條很淡、很寬的斜帶（只加在暗的地方看得出來）
  float band = d.x * 0.55 + d.y;
  float refl = smoothstep(0.2, 0.0, abs(band + 0.18)) * 0.015 + smoothstep(0.06, 0.0, abs(band + 0.31)) * 0.01;
  scrc += C_BONE * refl * (1.0 - smoothstep(0.2, 0.5, abs(d.x + 0.1)));

  vec3 col = room;
  col = mix(col, body, 1.0 - smoothstep(-px, px, sdB));
  col = mix(col, scrc, 1.0 - smoothstep(-px, px, sdS));
  // 螢幕與機身交界的一條細暗縫
  col *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, 2.5 * px, abs(sdS)));
  fragColor = vec4(col, 1.0);
}`;

/** 把監護儀畫面（螢幕座標的 render target）以透視貼到輸出上。 */
export const MONITOR = () => new FSPass(FRAG, {
  scr: { value: null }, toC: { value: new THREE.Matrix3() }, blur: { value: 0 }, dim: { value: 1 }, on: { value: 1 },
});

/** 設定這一格的單應矩陣（畫面像素 → 螢幕座標）。 */
export function setPose(pass: FSPass, pose: MonitorPose) {
  const src = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
  const dst = src.map((p) => project(pose, p.x, p.y));
  const m = homography(dst, src);
  (pass.u.toC!.value as THREE.Matrix3).set(m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!, m[6]!, m[7]!, m[8]!);
}
