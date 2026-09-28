// 翻頁鐘的 three.js 材質：翻牌片（一個 InstancedMesh 畫所有的片）、機殼（有厚度的盒子，正面挖出放牌的窗）、
// 貼在機殼上的字（Canvas 圖層）與後面的牆。全部用 RawShaderMaterial，顏色一律來自色票 uniform（THEME_UNIFORMS）。
//
// 每一格翻牌是三片：上半（新字的上半，靜止）、下半（舊字的下半，靜止）、翻動的那片（正面＝舊字的上半、背面＝新字的下半）。
// 翻動的那片繞著中間的轉軸往鏡頭倒下來：過了 90° 就看到它的背面，落到底剛好蓋住下半片——真的翻頁鐘就是這樣動的。
import * as THREE from 'three';
import { GLSL_COMMON, THEME_UNIFORMS } from '../engine/glsl/common';
import { GLYPH_GLSL, CODE_GLSL } from './_t7';

const HEAD = `precision highp float;\nprecision highp int;\n`;

// ---------------------------------------------------------------- 翻牌片
const CARD_VERT = /* glsl */ `${HEAD}
in vec3 position;
in vec4 iA; // 牌中心 x, y, z、第幾片（0 上半、1 下半、2 翻動的那片）
in vec4 iB; // 寬、高、翻動角度（0..π）、往前彈出的距離
in vec4 iG; // 舊字、新字、舊色碼、新色碼
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
out vec2 vUV;
out float vS;
out vec3 vN;
out vec3 vWP;
flat out vec4 vG;
flat out vec3 vInfo; // 片、寬、高
out float vTh;
void main() {
  float u = position.x + 0.5, s = position.y + 0.5;
  float w = iB.x, h = iB.y, th = iB.z, piece = iA.w;
  float x = (u - 0.5) * w;
  vec3 p; vec3 n = vec3(0.0, 0.0, 1.0);
  if (piece < 0.5) { p = vec3(x, s * h * 0.5, 0.0); vUV = vec2(u, 0.5 - s * 0.5); }
  else if (piece < 1.5) { p = vec3(x, -s * h * 0.5, 0.0); vUV = vec2(u, 0.5 + s * 0.5); }
  else {
    float yl = s * h * 0.5;
    p = vec3(x, yl * cos(th), 1.5 + yl * sin(th));
    n = vec3(0.0, -sin(th), cos(th));
    vUV = vec2(u, 0.5 - s * 0.5);
  }
  p += iA.xyz + vec3(0.0, 0.0, iB.w);
  vS = s; vN = n; vWP = p; vG = iG; vInfo = vec3(piece, w, h); vTh = th;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const CARD_FRAG = /* glsl */ `${HEAD}
${GLSL_COMMON}
in vec2 vUV;
in float vS;
in vec3 vN;
in vec3 vWP;
flat in vec4 vG;
flat in vec3 vInfo;
in float vTh;
uniform sampler2D uAtlas;
uniform vec2 uAG;
uniform vec3 cameraPosition;
uniform vec3 uLight;
uniform float uRad;
uniform float uCream;   // 1 = 奶油色的牌、墨色的字（主打留言用）；0 = 黑牌白字
uniform vec2 uPool;     // 燈的光圈中心（世界座標 x, y）與半徑在 uPoolR
uniform float uPoolR;
out vec4 fragColor;
${GLYPH_GLSL}
${CODE_GLSL}
/** 奶油色牌上的墨：唱完／留言＝深墨、還沒唱＝三成、正在唱＝訊號色的暗部（淺底上看得清楚）。 */
vec3 creamInk(float k, vec3 card) {
  if (k < 1.5) return mix(card, C_SEPIA, 0.3);
  if (k < 2.5) return C_SEPIA * 0.85;
  if (k < 3.5) return C_BLOOD * 0.9;
  if (k < 4.5) return mix(card, C_SEPIA, 0.72);
  if (k < 5.5) return C_ROSE * 0.75;
  if (k < 6.5) return C_BLOOD;
  return mix(card, C_SEPIA, 0.4);
}
void main() {
  vec2 uv = vUV;
  float gi = vG.x, code = vG.z;
  vec3 n = normalize(vN);
  float piece = vInfo.x;
  vec2 sz = vInfo.yz;
  if (piece < 0.5) { gi = vG.y; code = vG.w; }
  else if (piece > 1.5 && !gl_FrontFacing) { uv.y = 1.0 - uv.y; gi = vG.y; code = vG.w; n = -n; }
  // 圓角（只有整張牌的四個外角）
  vec2 lp = (uv - 0.5) * sz;
  float r = uRad;
  float d = sdBox(lp, sz * 0.5 - r) - r;
  float cov = 1.0 - smoothstep(-0.8, 0.8, d);
  if (cov < 0.02) discard;
  vec3 L = normalize(uLight);
  vec3 V = normalize(cameraPosition - vWP);
  float dif = 0.42 + 0.7 * max(dot(n, L), 0.0);
  float spec = pow(max(dot(reflect(-L, n), V), 0.0), 36.0);
  // 牌面：上半片上面亮一點、下半片暗一點（燈從上面來），很淡的紋理
  float halfK = uv.y < 0.5 ? mix(1.2, 1.0, uv.y * 2.0) : mix(0.85, 0.7, (uv.y - 0.5) * 2.0);
  vec3 card = uCream > 0.5 ? C_PAPER * 0.74 * mix(halfK, 1.0, 0.5) : (C_INK2 * 1.5 + C_GRAPHITE * 0.06) * halfK;
  card *= uCream > 0.5 ? 0.985 + 0.015 * snoise(lp * 0.04) : 0.94 + 0.06 * snoise(lp * 0.05);
  // 空白的牌暗一點：牌的質感還在，但不搶字
  if (gi < -0.5 && vG.x < -0.5 && vG.y < -0.5) card *= uCream > 0.5 ? 0.5 : 0.7;
  // 燈的光圈：光圈外的牌暗下去（像一盞燈只照在這台機器上）
  float pool = exp(-pow(length(vWP.xy - uPool) / uPoolR, 2.0));
  card *= mix(0.55, 1.05, pool);
  float a = glyphAt(gi, uv);
  vec3 ink = uCream > 0.5 ? creamInk(code, card) : codeCol(code);
  vec3 col = mix(card * dif, ink * mix(1.0, dif, 0.35), a);
  col += C_BONE * spec * (uCream > 0.5 ? 0.05 : 0.1) * (1.0 - a * 0.5);
  // 翻下來的那片在下半片投的影子（越接近垂直越暗、越靠近轉軸越暗）
  if (piece > 0.5 && piece < 1.5) col *= 1.0 - 0.62 * sin(vTh) * (1.0 - smoothstep(0.0, 0.85, vS));
  // 轉軸的縫
  float hy = abs(uv.y - 0.5) * sz.y;
  col *= 1.0 - 0.88 * (1.0 - smoothstep(0.7, 2.2, hy));
  // 牌緣一圈細細的光（奶油色的牌是一圈暗邊）
  col += (uCream > 0.5 ? -C_SEPIA * 0.08 : C_BONE * 0.05) * (1.0 - smoothstep(0.0, 2.2, -d));
  fragColor = vec4(col * cov, 1.0);
}`;

/** 一個 InstancedMesh 畫所有翻牌片：每片 12 個 float（iA、iB、iG），每格更新。 */
export class CardBatch {
  geo = new THREE.InstancedBufferGeometry();
  mat: THREE.RawShaderMaterial;
  mesh: THREE.Mesh;
  A: Float32Array; B: Float32Array; G: Float32Array;
  private attrs: THREE.InstancedBufferAttribute[];
  count = 0;
  constructor(public capacity: number, atlas: THREE.Texture, grid: [number, number], radius = 8) {
    const plane = new THREE.PlaneGeometry(1, 1, 1, 1);
    this.geo.setAttribute('position', plane.getAttribute('position'));
    this.geo.setIndex(plane.getIndex());
    this.A = new Float32Array(capacity * 4); this.B = new Float32Array(capacity * 4); this.G = new Float32Array(capacity * 4);
    this.attrs = [new THREE.InstancedBufferAttribute(this.A, 4), new THREE.InstancedBufferAttribute(this.B, 4), new THREE.InstancedBufferAttribute(this.G, 4)];
    this.attrs.forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('iA', this.attrs[0]!); this.geo.setAttribute('iB', this.attrs[1]!); this.geo.setAttribute('iG', this.attrs[2]!);
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: CARD_VERT, fragmentShader: CARD_FRAG,
      uniforms: {
        ...THEME_UNIFORMS, uAtlas: { value: atlas }, uAG: { value: new THREE.Vector2(...grid) },
        uLight: { value: new THREE.Vector3(-0.3, 0.75, 0.6) }, uRad: { value: radius }, cameraPosition: { value: new THREE.Vector3() },
        uCream: { value: 0 }, uPool: { value: new THREE.Vector2(0, 0) }, uPoolR: { value: 1e5 },
      },
      side: THREE.DoubleSide, depthTest: true, depthWrite: true,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    plane.dispose();
  }
  clear() { this.count = 0; }
  /** 加一片：中心、第幾片、大小、角度、彈出、舊字新字與色碼。 */
  add(x: number, y: number, z: number, piece: number, w: number, h: number, th: number, lift: number, ga: number, gb: number, ca: number, cb: number) {
    if (this.count >= this.capacity) return;
    const i = this.count++ * 4;
    this.A[i] = x; this.A[i + 1] = y; this.A[i + 2] = z; this.A[i + 3] = piece;
    this.B[i] = w; this.B[i + 1] = h; this.B[i + 2] = th; this.B[i + 3] = lift;
    this.G[i] = ga; this.G[i + 1] = gb; this.G[i + 2] = ca; this.G[i + 3] = cb;
  }
  /** 一整格（三片）。 */
  unit(x: number, y: number, z: number, w: number, h: number, th: number, lift: number, ga: number, gb: number, ca: number, cb: number) {
    for (let p = 0; p < 3; p++) this.add(x, y, z, p, w, h, th, lift, ga, gb, ca, cb);
  }
  commit() {
    for (const a of this.attrs) { a.needsUpdate = true; a.clearUpdateRanges(); a.addUpdateRange(0, this.count * 4); }
    this.geo.instanceCount = this.count;
  }
  dispose() { this.geo.dispose(); this.mat.dispose(); }
}

// ---------------------------------------------------------------- 機殼
const BOX_VERT = /* glsl */ `${HEAD}
in vec3 position; in vec3 normal; in vec2 uv;
uniform mat4 projectionMatrix; uniform mat4 modelViewMatrix; uniform mat4 modelMatrix;
out vec3 vN; out vec2 vUV; out vec3 vWP;
void main() {
  vN = normal; vUV = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const MAX_WIN = 8;
const BOX_FRAG = /* glsl */ `${HEAD}
${GLSL_COMMON}
in vec3 vN; in vec2 vUV; in vec3 vWP;
uniform vec2 uSize;          // 正面的寬高
uniform vec4 uWin[${MAX_WIN}];     // 凹下去的窗（放牌、放字）：正面座標，px，y 往下
uniform int uNWin;
uniform vec4 uDot;           // 冒號的兩顆點：x, y1, y2, 亮度（< 0 = 不畫）
uniform vec3 uLight;
uniform vec3 cameraPosition;
uniform float uIn;
uniform vec2 uPool;
uniform float uPoolR;
out vec4 fragColor;
void main() {
  vec3 n = normalize(vN);
  vec3 L = normalize(uLight);
  vec3 V = normalize(cameraPosition - vWP);
  float dif = 0.3 + 0.8 * max(dot(n, L), 0.0);
  float spec = pow(max(dot(reflect(-L, n), V), 0.0), 18.0);
  // 機殼：暖黑的烤漆（奶油色的牌放在上面才是焦點）；燈的光圈外暗下去
  vec3 body = C_INK2 * 2.2 + C_GRAPHITE * 0.06;
  body *= mix(0.45, 1.1, exp(-pow(length(vWP.xy - uPool) / uPoolR, 2.0)));
  vec3 col;
  if (n.z > 0.5) {
    vec2 lp = vec2(vUV.x * uSize.x, (1.0 - vUV.y) * uSize.y);
    // 正面：左上亮、右下暗（燈從左上來），很淡的塑膠顆粒
    float g = 1.08 - 0.22 * (lp.x / uSize.x) * 0.6 - 0.22 * (lp.y / uSize.y);
    col = body * g * (0.97 + 0.03 * snoise(lp * 0.35));
    col *= dif;
    col += C_PAPER * 0.05 * spec;
    float edge = min(min(lp.x, uSize.x - lp.x), min(lp.y, uSize.y - lp.y));
    col += C_PAPER * 0.1 * (1.0 - smoothstep(0.0, 3.0, edge)) * (lp.y < uSize.y * 0.5 ? 1.0 : 0.35);
    col *= 1.0 - 0.25 * (1.0 - smoothstep(3.0, 12.0, edge)) * step(uSize.y * 0.5, lp.y);
    // 窗：凹下去的深色框，上緣有內陰影、下緣一條亮邊
    for (int i = 0; i < ${MAX_WIN}; i++) {
      if (i >= uNWin) break;
      vec4 R = uWin[i];
      vec2 c = R.xy + R.zw * 0.5;
      float d = sdBox(lp - c, R.zw * 0.5 - 6.0) - 6.0;
      float m = 1.0 - smoothstep(-0.8, 0.8, d);
      float inner = smoothstep(0.0, 22.0, lp.y - R.y);
      col = mix(col, C_INK * mix(0.2, 0.75, inner), m);
      col += C_PAPER * 0.14 * (1.0 - smoothstep(0.0, 1.6, abs(d))) * step(c.y, lp.y);
      col *= 1.0 - 0.3 * (1.0 - m) * (1.0 - smoothstep(0.0, 8.0, d)) * step(lp.y, c.y);
    }
    // 冒號：兩顆圓點，拍子一到亮成訊號色
    if (uDot.w >= 0.0) {
      for (int k = 0; k < 2; k++) {
        float y = k == 0 ? uDot.y : uDot.z;
        float dd = length(lp - vec2(uDot.x, y)) - 11.0;
        float mm = 1.0 - smoothstep(-0.8, 0.8, dd);
        col = mix(col, mix(C_INK2 * 1.2, C_SIGNAL * 2.4, uDot.w), mm * min(1.0, uDot.w * 4.0 + 0.001));
        col += C_SIGNAL * 0.35 * uDot.w * exp(-max(dd, 0.0) / 9.0);
      }
    }
  } else {
    // 側面、頂面、底面：同一塊塑膠，只靠受光分出面
    col = body * dif * (n.y > 0.5 ? 1.15 : n.y < -0.5 ? 0.35 : 0.7) + C_PAPER * 0.04 * spec;
  }
  fragColor = vec4(col * uIn, 1.0);
}`;

export function boxMaterial(w: number, h: number) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: BOX_VERT, fragmentShader: BOX_FRAG,
    uniforms: {
      ...THEME_UNIFORMS, uSize: { value: new THREE.Vector2(w, h) },
      uWin: { value: Array.from({ length: MAX_WIN }, () => new THREE.Vector4()) }, uNWin: { value: 0 },
      uDot: { value: new THREE.Vector4(0, 0, 0, -1) }, uLight: { value: new THREE.Vector3(-0.3, 0.75, 0.6) },
      cameraPosition: { value: new THREE.Vector3() }, uIn: { value: 1 },
      uPool: { value: new THREE.Vector2(0, 0) }, uPoolR: { value: 1e5 },
    },
  });
}

// ---------------------------------------------------------------- 貼在機殼上的字（fast 的 Layer2D：預乘、sRGB，要自己解）
const DECAL_VERT = /* glsl */ `${HEAD}
in vec3 position; in vec2 uv;
uniform mat4 projectionMatrix; uniform mat4 modelViewMatrix;
out vec2 vUV;
void main() { vUV = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const DECAL_FRAG = /* glsl */ `${HEAD}
${GLSL_COMMON}
in vec2 vUV;
uniform sampler2D uTex;
uniform float uOpacity;
out vec4 fragColor;
void main() {
  vec4 c = texture(uTex, vUV);
  vec3 rgb = c.a > 0.0 ? toLinear(c.rgb / c.a) * c.a : vec3(0.0);
  fragColor = vec4(rgb, c.a) * uOpacity;
}`;

export function decalMaterial(tex: THREE.Texture) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: DECAL_VERT, fragmentShader: DECAL_FRAG,
    uniforms: { ...THEME_UNIFORMS, uTex: { value: tex }, uOpacity: { value: 1 } },
    transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}

// ---------------------------------------------------------------- 牆
/** 後面的牆：暖黑，機殼後面一圈柔光（像檯燈打在牆上），機殼的影子（往右下偏、很柔）。 */
export const WALL_FRAG = /* glsl */ `
uniform vec4 uShadow[2]; // 機殼在螢幕上的範圍（px，y 往下）：x0, y0, x1, y1
uniform vec2 uPool;      // 柔光中心
uniform float uIn;
void main() {
  vec2 p = vec2(FRAG_PX.x, 1080.0 - FRAG_PX.y);
  float r = length((p - uPool) / vec2(1150.0, 700.0));
  vec3 col = C_INK * 0.8 + (C_INK2 - C_INK) * (2.2 * exp(-r * r * 1.6)) + C_BLOOD * 0.012 * exp(-r * r * 2.5);
  col += (C_INK2 - C_INK) * 0.35 * fbm(p / 420.0, 3);
  // 很淡的直條壁板
  col *= 1.0 - 0.05 * smoothstep(0.35, 0.5, abs(fract(p.x / 160.0) - 0.5));
  for (int i = 0; i < 2; i++) {
    vec4 R = uShadow[i];
    if (R.z <= R.x) continue;
    vec2 c = (R.xy + R.zw) * 0.5 + vec2(26.0, 38.0);
    vec2 hs = (R.zw - R.xy) * 0.5;
    float d = sdBox(p - c, hs - 20.0) - 20.0;
    col *= 1.0 - 0.55 * (1.0 - smoothstep(-30.0, 70.0, d));
  }
  fragColor = vec4(col * mix(0.6, 1.0, uIn), 1.0);
}`;
