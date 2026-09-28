// 彈珠台的材質（pinball.ts 用）：全部是 RawShaderMaterial，顏色一律來自色票 uniform（THEME_UNIFORMS），換主題跟著變。
//  - 檯面：漆面的暗色木紋＋畫好的線稿（Canvas 貼圖）＋燈（插在檯面裡的半透明燈罩，用 uniform 陣列在 shader 裡畫）＋鋼珠的影子
//  - 實心的零件（彈柱、擋板、邊欄）：簡單的漫射＋頂光，彈柱的蓋子被撞到時亮成訊號色
//  - 鋼珠：假的環境反射（上亮下暗、被撞亮的彈柱映在上面）＋一個很尖的高光（會發光）
import * as THREE from 'three';
import { GLSL_COMMON, THEME_UNIFORMS } from '../engine/glsl/common';

const VERT = /* glsl */ `
precision highp float;
in vec3 position; in vec3 normal; in vec2 uv;
uniform mat4 modelMatrix; uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix;
out vec3 vW; out vec3 vN; out vec2 vUV; out vec3 vL;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vL = position; vUV = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const head = `precision highp float;\nprecision highp int;\nin vec3 vW; in vec3 vN; in vec2 vUV; in vec3 vL;\nout vec4 fragColor;\n${GLSL_COMMON}\n`;

/** 最多幾盞燈（檯面上的燈罩）。 */
export const MAX_LAMPS = 24;

/** 檯面。tc = 檯面座標（u 橫向 ±320、v 從遠端 0 到近端 TL）。 */
export function playfieldMaterial(art: THREE.Texture, TL: number) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VERT,
    fragmentShader: head + /* glsl */ `
      uniform sampler2D art; uniform vec4 lamps[${MAX_LAMPS}]; uniform vec3 lampCol[${MAX_LAMPS}]; uniform vec3 ball; uniform float gi;
      vec4 decLayer(vec4 c) { return c.a > 0.0 ? vec4(toLinear(c.rgb / c.a) * c.a, c.a) : vec4(0.0); }
      void main() {
        vec2 tc = vec2(vW.x, vW.z + ${TL.toFixed(1)});
        // 漆面：暗色、順著檯面長邊的木紋，中間被燈照得亮一點
        float grain = fbm(tc / vec2(260.0, 26.0), 3) * 0.5 + 0.5;
        vec3 col = mix(C_INK2 * 1.25, C_INK * 1.1, grain * 0.6);
        col *= 0.75 + 0.45 * exp(-pow(tc.x / 360.0, 2.0)) * (0.8 + 0.2 * gi);
        col += C_BLOOD * 0.025 * gi;
        // 燈罩（先畫：線稿畫在燈上面）
        for (int i = 0; i < ${MAX_LAMPS}; i++) {
          vec4 L = lamps[i];
          if (L.z <= 0.0) continue;
          float d = length(tc - L.xy) - L.z;
          // 沒亮：暗暗的半透明塑膠；亮：整片亮起來＋一圈光暈
          float inside = 1.0 - smoothstep(-1.2, 1.2, d);
          col = mix(col, lampCol[i] * (0.1 + 1.25 * L.w), inside);
          col += lampCol[i] * L.w * 0.3 * exp(-max(d, 0.0) / 26.0);
        }
        vec4 a = decLayer(texture(art, vUV));
        col = col * (1.0 - a.a) + a.rgb;
        // 鋼珠的影子
        float bd = length(tc - ball.xy);
        col *= 1.0 - 0.55 * exp(-bd * bd / 900.0) * ball.z;
        fragColor = vec4(col, 1.0);
      }`,
    uniforms: {
      ...THEME_UNIFORMS, art: { value: art },
      lamps: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4()) },
      lampCol: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector3(1, 1, 1)) },
      ball: { value: new THREE.Vector3() }, gi: { value: 1 },
    },
  });
}

/** 實心零件：base 是本體的色（線性），flash 0..1 讓它亮成訊號色；cap = 1 的物件頂面畫成彈柱的燈蓋。 */
export function solidMaterial(base: THREE.Vector3, cap = 0) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VERT,
    fragmentShader: head + /* glsl */ `
      uniform vec3 base; uniform float flash; uniform float cap; uniform float radius;
      void main() {
        vec3 n = normalize(vN);
        float lam = 0.35 + 0.65 * max(dot(n, normalize(vec3(-0.25, 0.85, 0.45))), 0.0);
        vec3 col = base * lam;
        // 邊緣受光（背光從遠端來）
        col += C_BONE * 0.08 * pow(1.0 - abs(n.y), 3.0) * step(n.z, 0.0);
        col = mix(col, C_SIGNAL * (0.6 + 0.8 * lam), flash * 0.55 * (1.0 - cap));
        if (cap > 0.5 && n.y > 0.6) {
          // 彈柱的燈蓋：同心圓、中間一顆星，被撞到時整個亮起來
          float r = length(vL.xz) / radius;
          float ring = step(0.55, r) * step(r, 0.62) + step(0.86, r);
          vec3 lit = mix(C_SIGNAL * 1.1, C_EMBER * 2.6, exp(-r * 3.0));
          col = mix(C_INK2 * 1.6 + C_SIGNAL * 0.12, lit, flash);
          col = mix(col, C_BONE * (0.5 + 0.6 * flash), ring * 0.8);
        }
        fragColor = vec4(col, 1.0);
      }`,
    uniforms: { ...THEME_UNIFORMS, base: { value: base }, flash: { value: 0 }, cap: { value: cap }, radius: { value: 40 } },
  });
}

/** 鋼珠：假環境反射＋很尖的高光；env 是最近被撞亮的彈柱（映在珠子上）。 */
export function ballMaterial() {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VERT,
    fragmentShader: head + /* glsl */ `
      uniform vec3 cameraPosition; uniform float env;
      void main() {
        vec3 n = normalize(vN);
        vec3 v = normalize(cameraPosition - vW);
        vec3 r = reflect(-v, n);
        // 天花板（亮）與檯面（暗）的反射，中間一條地平線
        vec3 e = mix(C_INK2 * 0.6, C_BONE * 0.85, smoothstep(-0.15, 0.6, r.y));
        e = mix(e, C_BONE * 0.25, smoothstep(0.02, -0.02, abs(r.y - 0.05)) * 0.5);
        e += C_SIGNAL * env * 0.9 * smoothstep(0.2, -0.4, r.y);
        float spec = pow(max(dot(r, normalize(vec3(-0.35, 1.0, 0.55))), 0.0), 90.0);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        vec3 col = e * (0.75 + 0.25 * fres) + vec3(4.0) * spec;
        fragColor = vec4(col, 1.0);
      }`,
    uniforms: { ...THEME_UNIFORMS, cameraPosition: { value: new THREE.Vector3() }, env: { value: 0 } },
  });
}
