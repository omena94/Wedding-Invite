// 燭光版面（candles.ts）的 3D 道具：長桌的桌布（桌面＋桌緣圓角＋垂下來的前擺）、七根細長蠟燭、黃銅燭台、燭焰。
// 這是整晚唯一用 three.js 真的 3D mesh 的版面：蠟燭的透光、黃銅的高光、桌布的布褶都要跟著燭光變，
// 用 2D 假裝會很假。幾何與材質在模組層共用（shared()）：一晚會建幾十次這個版面，shader 不要重編；
// 每一格由正在畫的那個窗格把 uniform（燭光位置、亮度、留言貼圖…）設好再畫。
// 座標：公尺左右的世界單位，桌面 y = 0、桌緣在 z = EDGE_Z（朝鏡頭），蠟燭站在 z = CANDLE_Z。
import * as THREE from 'three';
import { GLSL_COMMON, THEME_UNIFORMS } from '../engine/glsl/common';
import { lerp, smoothstep, hash } from '../engine/util';

export const N = 7;
export const EDGE_Z = 0.5;
export const CANDLE_Z = 0.2;
/** 燭台高度（蠟燭插在杯裡，從這裡往上）。 */
export const HOLDER_H = 0.126;
const SPACING = 0.42;
/** 第 k 根蠟燭的 x 與蠟身長度（每根燒得不太一樣：細長的 taper 燭、差幾公分）。 */
export const candleX = (k: number) => (k - (N - 1) / 2) * SPACING;
export const candleLen = (k: number) => 0.5 - 0.045 * hash(k, 91) + (k === 3 ? 0.02 : 0);
/** 蠟頂（燭芯根部）的高度。 */
export const waxTop = (k: number) => HOLDER_H + candleLen(k) + 0.006;
/** 燭芯頂端（火焰從這裡長出來）。 */
export const wickTop = (k: number) => waxTop(k) + 0.012;

/** 所有材質共用的 uniform（同一組物件：設一次，桌布、蠟燭、燭台、燭焰都讀得到）。 */
export const U = {
  uL: { value: Array.from({ length: N }, () => new THREE.Vector3()) }, // 光源（火焰中心）
  uI: { value: new Array<number>(N).fill(0) }, // 光源亮度（含閃爍）
  uTop: { value: new Array<number>(N).fill(0) }, // 蠟頂高度
  uX: { value: new Array<number>(N).fill(0) }, // 蠟燭的 x（留言的顯影權重用）
  uReveal: { value: new Array<number>(N).fill(0) }, // 每根點著了沒（0..1），它下面那一段留言跟著亮
  uH: { value: new Array<number>(N).fill(0) }, // 火焰長出來的程度
  uSway: { value: new Array<number>(N).fill(0) }, // 火焰被 hi-hat「吹」歪的量
  uAmb: { value: 0.03 },
  uMsg: { value: null as THREE.Texture | null },
  uMsgRect: { value: new THREE.Vector4(0, 0, 1, 1) }, // 留言貼圖在前擺上的範圍（世界 x0, y0, x1, y1）
  uMsgOn: { value: 0 },
  uRight: { value: new THREE.Vector3(1, 0, 0) },
};
for (let k = 0; k < N; k++) { U.uTop.value[k] = waxTop(k); U.uX.value[k] = candleX(k); }

const PRE = /* glsl */ `precision highp float;\nprecision highp int;\n`;
/** 燭光的顏色、光源陣列：每個材質都一樣。 */
const LIGHTS = /* glsl */ `
uniform vec3 uL[${N}]; uniform float uI[${N}]; uniform float uTop[${N}]; uniform float uX[${N}];
uniform float uReveal[${N}]; uniform float uAmb; uniform vec3 cameraPosition;
// 燭光：主題的訊號色一家子，混一點紙白的暖（鼠尾草、薰衣草主題的燭光才不會綠得、紫得像鬼火）
vec3 candleLight() { return mix(mix(C_SIGNAL, C_EMBER, 0.55), C_BONE, 0.3); }
`;

const VERT_LIT = /* glsl */ `${PRE}
in vec3 position; in vec3 normal; in float cid;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
out vec3 vPos; out vec3 vN; flat out int vId;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vId = int(cid + 0.5);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const VERT_CLOTH = /* glsl */ `${PRE}
in vec3 position; in vec3 normal;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
out vec3 vPos; out vec3 vN;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz; vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// 桌布：亞麻（紙白偏暗）、被燭光照。前擺其實在燭光「後面」照不到（蠟燭站在桌面上），照實算會一片黑，
// 所以前擺用「光池」：離燭光越近越亮、布褶朝向燭光的那一面亮一點——好看比物理正確重要。
// 留言是繡在前擺上的紙白線：貼圖（fast Layer2D：預乘、sRGB）解碼後當顏色，亮度照「它上面的蠟燭點著了沒」。
const FRAG_CLOTH = /* glsl */ `${PRE}
in vec3 vPos; in vec3 vN;
out vec4 fragColor;
${GLSL_COMMON}
${LIGHTS}
uniform sampler2D uMsg; uniform vec4 uMsgRect; uniform float uMsgOn;
void main() {
  vec3 n = normalize(vN);
  float drape = smoothstep(0.55, 0.85, n.z) * step(vPos.y, -0.004);
  vec3 alb = C_BONE * 0.6 * (0.96 + 0.05 * snoise(vPos.xz * vec2(9.0, 30.0) + vPos.y * 7.0));
  vec3 lc = candleLight();
  vec3 L = C_ASH * uAmb;
  float pool = 0.0, ao = 1.0;
  float below = max(-vPos.y, 0.0);
  for (int i = 0; i < ${N}; i++) {
    vec3 d = uL[i] - vPos; float r2 = dot(d, d); vec3 l = d * inversesqrt(r2);
    // 桌面：Lambert、平方反比
    float onTop = sat(dot(n, l)) * 0.075 / (r2 + 0.02);
    // 前擺：燭光越過桌緣灑下來的光池——在蠟燭正下方最亮、往下很快變暗；布褶朝向那盞燈的一面亮一點
    float dx = vPos.x - uL[i].x;
    float pl = (0.5 * exp(-dx * dx / 0.05) + 0.22 * exp(-dx * dx / 0.4)) * exp(-below / 0.42) * 0.22;
    pl *= max(0.0, 1.0 + 2.2 * n.x * clamp(-dx * 3.0, -1.0, 1.0));
    float fall = uI[i] * mix(onTop, pl, drape);
    L += lc * fall;
    pool += fall;
    // 燭台壓在桌布上的接觸陰影
    vec2 q = vPos.xz - vec2(uX[i], ${CANDLE_Z.toFixed(3)});
    ao *= 1.0 - 0.55 * (1.0 - drape) * exp(-dot(q, q) / 0.006);
  }
  vec3 col = alb * L * ao;
  // 桌緣下方一點的滾邊：兩條細細的虛線（刺繡的針腳）
  float y = -vPos.y;
  float stitch = step(0.45, fract(vPos.x * 55.0));
  float hem = (aaStroke(y - 0.075, 0.004) + aaStroke(y - 0.092, 0.0025) * 0.6) * stitch * drape;
  col = mix(col, C_BONE * (0.02 + 0.8 * pool), hem * 0.4);
  // ---- 繡在前擺上的留言
  vec2 uv = (vPos.xy - uMsgRect.xy) / (uMsgRect.zw - uMsgRect.xy);
  if (drape > 0.5 && uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
    vec2 tx = 1.0 / vec2(textureSize(uMsg, 0));
    vec4 m = texture(uMsg, uv);
    // 線是凸起來的：右下方有一點點影子
    float sh = texture(uMsg, uv + vec2(-1.2, 1.8) * tx).a;
    col *= 1.0 - 0.35 * sh * uMsgOn;
    float reveal = 0.0;
    for (int i = 0; i < ${N}; i++) {
      float xi = uX[i];
      float lft = i > 0 ? uX[max(i - 1, 0)] : xi - 100.0;
      float rgt = i < ${N - 1} ? uX[min(i + 1, ${N - 1})] : xi + 100.0;
      float w = vPos.x < xi ? sat((vPos.x - lft) / (xi - lft)) : sat((rgt - vPos.x) / (rgt - xi));
      reveal += uReveal[i] * w;
    }
    vec3 ink = m.a > 0.0 ? toLinear(m.rgb / m.a) : vec3(0.0);
    // 點著之前淡淡的（線性 6%，看起來約兩成亮）、點著之後至少紙白的九成五；燭光近的地方偏暖一點
    float br = mix(0.06, 0.97, sat(reveal)) * (0.97 + 0.03 * sat(pool * 2.0));
    ink = mix(ink, ink * mix(vec3(1.0), lc / max(max(lc.r, lc.g), lc.b), 0.25), sat(pool * 1.5) * sat(reveal));
    col = mix(col, ink * br, m.a * uMsgOn);
  }
  fragColor = vec4(col, 1.0);
}`;

// 蠟：偏暖的紙白，被鄰居的燭光從側面照（wrap 光：蠟會透光），自己的火焰讓蠟頂透出暖光（次表面的感覺）。
const FRAG_WAX = /* glsl */ `${PRE}
in vec3 vPos; in vec3 vN; flat in int vId;
out vec4 fragColor;
${GLSL_COMMON}
${LIGHTS}
void main() {
  vec3 n = normalize(vN);
  vec3 lc = candleLight();
  float top = uTop[vId];
  float own = uI[vId];
  if (vPos.y > top + 0.0015) {
    // 燭芯：黑的，點著時頂端燒紅
    float tip = smoothstep(top + 0.006, top + 0.013, vPos.y);
    fragColor = vec4(C_INK * 0.6 + lc * own * (0.15 + 2.2 * tip), 1.0);
    return;
  }
  vec3 alb = mix(C_BONE, C_PAPER, 0.5) * 0.8;
  vec3 v = normalize(cameraPosition - vPos);
  float dy = max(top - vPos.y, 0.0);
  // 蠟淚：每根兩三道從蠟頂流下來的凸起（角度、長度用蠟燭編號 hash），比旁邊亮一點、透一點
  float ang = atan(vPos.z - ${CANDLE_Z.toFixed(3)}, vPos.x - uX[vId]);
  float drip = 0.0;
  for (int k = 0; k < 3; k++) {
    float a0 = hash11(float(vId * 7 + k) * 1.73) * TAU - PI;
    float len = 0.02 + 0.09 * hash11(float(vId * 13 + k) * 2.9);
    float da = abs(mod(ang - a0 + PI, TAU) - PI);
    float wd = 0.28 * (1.0 - 0.5 * sat(dy / len));
    drip = max(drip, smoothstep(wd, wd * 0.45, da) * smoothstep(len, len * 0.8, dy));
  }
  vec3 L = C_ASH * uAmb * 1.4, S = vec3(0.0);
  for (int i = 0; i < ${N}; i++) {
    if (i == vId) continue;
    vec3 d = uL[i] - vPos; float r2 = dot(d, d); vec3 l = d * inversesqrt(r2);
    float fall = uI[i] * 0.05 / (r2 + 0.02);
    L += lc * sat((dot(n, l) + 0.4) / 1.4) * fall;
    // 蠟有一點點光澤
    S += lc * pow(sat(dot(n, normalize(l + v))), 24.0) * fall * (0.18 + 0.3 * drip);
  }
  // 自己的火焰：蠟頂（融蠟池）最亮，往下透光很快變弱；蠟淚比較薄，透得遠一點
  vec3 sss = lc * own * (1.7 * exp(-dy / 0.02) + 0.35 * exp(-dy / mix(0.09, 0.16, drip)) + 0.07 * exp(-dy / 0.35));
  // 正對鏡頭的邊緣稍微暗一點（圓柱的立體感）
  float rim = 0.75 + 0.25 * sat(dot(n, v));
  fragColor = vec4(alb * (L * (1.0 + 0.25 * drip) + sss) * rim + S, 1.0);
}`;

// 黃銅燭台：暗的金屬底色＋每盞燭光一個小高光。
const FRAG_BRASS = /* glsl */ `${PRE}
in vec3 vPos; in vec3 vN; flat in int vId;
out vec4 fragColor;
${GLSL_COMMON}
${LIGHTS}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vPos);
  vec3 lc = candleLight();
  vec3 alb = mix(C_BLOOD, C_SIGNAL, 0.4) * 0.42 + C_ASH * 0.03;
  vec3 L = C_ASH * uAmb * 1.5, S = vec3(0.0);
  for (int i = 0; i < ${N}; i++) {
    vec3 d = uL[i] - vPos; float r2 = dot(d, d); vec3 l = d * inversesqrt(r2);
    float fall = uI[i] * 0.05 / (r2 + 0.02);
    L += lc * sat(dot(n, l)) * fall;
    vec3 h = normalize(l + v);
    S += lc * pow(sat(dot(n, h)), 70.0) * fall * 2.2;
  }
  // 環境：桌布反上來的一點點光
  L += lc * 0.05 * sat(-n.y) * uI[vId];
  fragColor = vec4(alb * L + S * mix(vec3(1.0), alb * 3.0, 0.4), 1.0);
}`;

// 燭焰：面向鏡頭的四邊形（只繞 y 軸轉），淚滴形、中心白熱、外層訊號色，外面一圈很淡的光暈。加法混合，
// 核心 > 1 才會發光。hi-hat 把火焰「吹」歪（剪切），大鼓讓火焰長高一點（uH 由版面算好）。
const VERT_FLAME = /* glsl */ `${PRE}
in vec3 position; in float cid;
uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
uniform vec3 uL[${N}]; uniform float uH[${N}]; uniform vec3 uRight;
out vec2 vQ; out vec2 vUV; flat out int vId;
const vec2 HALF = vec2(0.3, 0.34);
void main() {
  int id = int(cid + 0.5);
  vId = id;
  float h = max(uH[id], 0.0);
  // 四邊形固定大小（光暈的半徑是固定的，四邊形跟著火焰縮小會把光暈切出一個方框）
  vUV = position.xy;
  vQ = position.xy * HALF + vec2(0.0, 0.08); // 燭芯頂端在四邊形中心下方
  vec3 wick = uL[id] - vec3(0.0, 0.05, 0.0);
  vec3 wp = wick + uRight * vQ.x + vec3(0.0, vQ.y, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const FRAG_FLAME = /* glsl */ `${PRE}
in vec2 vQ; in vec2 vUV; flat in int vId;
out vec4 fragColor;
${GLSL_COMMON}
uniform float uH[${N}]; uniform float uSway[${N}]; uniform float uI[${N}];
void main() {
  float h = uH[vId];
  if (h <= 0.001) discard;
  float hf = 0.13 * h;                   // 火焰高度（世界單位）
  float y = vQ.y, s = (y + 0.006) / (hf + 0.006);
  float sw = uSway[vId];
  float x = vQ.x - sw * 0.03 * s * s;    // 越往上歪得越多
  float w = 0.04 * sqrt(sat(s)) * pow(sat(1.0 - s), 0.85);
  float d = abs(x) - w;
  float body = smoothstep(0.0022, -0.0018, d) * step(-0.012, y) * step(s, 1.0);
  // 核心：中下段、中間最熱；底部（燭芯旁）暗一點
  float core = 1.0 - smoothstep(0.0, 1.0, length(vec2(x / max(w, 1e-3) * 0.9, (s - 0.36) * 2.1)));
  float base = smoothstep(0.02, 0.2, s);
  vec3 col = heat(0.42 + 0.58 * core) * (0.7 + 2.6 * core * core) * body * mix(0.35, 1.0, base);
  // 光暈：一圈近的、一圈遠的，只有訊號色，很克制
  vec2 g = vec2(vQ.x, vQ.y - hf * 0.42);
  float r2 = dot(g, g);
  float win = (1.0 - smoothstep(0.55, 1.0, abs(vUV.x))) * (1.0 - smoothstep(0.55, 1.0, abs(vUV.y)));
  col += C_SIGNAL * (0.25 * exp(-r2 / (0.034 * 0.034)) + 0.045 * exp(-r2 / (0.13 * 0.13))) * min(h, 1.0) * win;
  col *= uI[vId] > 0.0 ? 0.85 + 0.25 * min(uI[vId], 1.2) : 1.0;
  fragColor = vec4(col, 0.0);
}`;

// ---------------------------------------------------------------- 幾何
function mergeWithId(parts: { g: THREE.BufferGeometry; id: number; x: number; y: number; z: number }[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], cid: number[] = [], idx: number[] = [];
  for (const p of parts) {
    const g = p.g;
    const P = g.getAttribute('position'), Nn = g.getAttribute('normal');
    const base = pos.length / 3;
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i) + p.x, P.getY(i) + p.y, P.getZ(i) + p.z);
      nor.push(Nn.getX(i), Nn.getY(i), Nn.getZ(i));
      cid.push(p.id);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + base);
    else for (let i = 0; i < P.count; i++) idx.push(base + i);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('cid', new THREE.Float32BufferAttribute(cid, 1));
  out.setIndex(idx);
  return out;
}

const V2 = (r: number, y: number) => new THREE.Vector2(r, y);

function holderProfile() {
  return [
    V2(0, 0), V2(0.078, 0), V2(0.081, 0.004), V2(0.077, 0.01), V2(0.058, 0.016), V2(0.03, 0.026), V2(0.018, 0.04),
    V2(0.016, 0.046), V2(0.027, 0.053), V2(0.029, 0.058), V2(0.018, 0.066), V2(0.012, 0.08), V2(0.011, 0.094),
    V2(0.016, 0.102), V2(0.024, 0.108), V2(0.036, 0.116), V2(0.041, 0.124), V2(0.039, 0.128), V2(0.028, 0.125), V2(0, 0.125),
  ];
}

function candleProfile(L: number) {
  const y0 = HOLDER_H - 0.012;
  return [
    V2(0, y0), V2(0.024, y0), V2(0.024, y0 + 0.03), V2(0.0215, y0 + 0.012 + L * 0.7), V2(0.0205, y0 + 0.012 + L),
    V2(0.0192, y0 + 0.012 + L + 0.0055), V2(0.0165, y0 + 0.012 + L + 0.0068), V2(0.01, y0 + 0.012 + L + 0.004),
    V2(0.0035, y0 + 0.012 + L + 0.0055), V2(0.0019, y0 + 0.012 + L + 0.0062), V2(0.0016, y0 + 0.012 + L + 0.018), V2(0, y0 + 0.012 + L + 0.0195),
  ];
}

/** 桌布：剖面（桌面 → 桌緣圓角 → 前擺）沿著 x 拉出來，前擺越往下布褶越深。 */
function clothGeometry(): THREE.BufferGeometry {
  const R = 0.035, X0 = -4.2, X1 = 4.2, NX = 220;
  const prof: { y: number; z: number }[] = [];
  for (let i = 0; i <= 18; i++) prof.push({ y: 0, z: lerp(-1.8, EDGE_Z - R, i / 18) });
  for (let i = 1; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; prof.push({ y: -R + R * Math.cos(a), z: EDGE_Z - R + R * Math.sin(a) }); }
  for (let i = 1; i <= 70; i++) prof.push({ y: -R - 1.7 * Math.pow(i / 70, 1.15), z: EDGE_Z });
  const fold = (x: number, y: number) => 0.55 * Math.sin(x * 4.3 + 0.8) + 0.3 * Math.sin(x * 9.1 + 2.1 + y * 0.9) + 0.22 * Math.sin(x * 2.1 - 0.4);
  const pos: number[] = [], idx: number[] = [];
  for (const p of prof) {
    const amp = 0.022 * smoothstep(0.02, 0.9, -p.y - R);
    for (let i = 0; i <= NX; i++) {
      const x = lerp(X0, X1, i / NX);
      pos.push(x, p.y, p.z + amp * fold(x, p.y));
    }
  }
  const row = NX + 1;
  for (let j = 0; j < prof.length - 1; j++) for (let i = 0; i < NX; i++) {
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // 桌面的法線要朝上（繞法反了就整組翻過來）
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  if (n.getY(Math.floor(row / 2)) < 0) { for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i)); }
  return g;
}

function flameGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], cid: number[] = [], idx: number[] = [];
  for (let k = 0; k < N; k++) {
    const b = pos.length / 3;
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) { pos.push(x, y, 0); cid.push(k); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('cid', new THREE.Float32BufferAttribute(cid, 1));
  g.setIndex(idx);
  return g;
}

const raw = (vertexShader: string, fragmentShader: string, extra: Partial<THREE.ShaderMaterialParameters> = {}) =>
  new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader, fragmentShader, uniforms: { ...THEME_UNIFORMS, ...U }, ...extra });

export interface Rig { scene: THREE.Scene; cam: THREE.PerspectiveCamera }

/** 整組道具（模組層共用：幾何與 shader 一晚只建一次）。 */
export function makeRig(): Rig {
  const scene = new THREE.Scene();
  const cloth = new THREE.Mesh(clothGeometry(), raw(VERT_CLOTH, FRAG_CLOTH));
  const holders = new THREE.Mesh(mergeWithId(Array.from({ length: N }, (_, k) => ({ g: new THREE.LatheGeometry(holderProfile(), 40), id: k, x: candleX(k), y: 0, z: CANDLE_Z }))), raw(VERT_LIT, FRAG_BRASS));
  const wax = new THREE.Mesh(mergeWithId(Array.from({ length: N }, (_, k) => ({ g: new THREE.LatheGeometry(candleProfile(candleLen(k)), 36), id: k, x: candleX(k), y: 0, z: CANDLE_Z }))), raw(VERT_LIT, FRAG_WAX));
  const flameMat = raw(VERT_FLAME, FRAG_FLAME, { transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending });
  flameMat.blendEquation = THREE.AddEquation;
  flameMat.blendSrc = THREE.OneFactor; flameMat.blendDst = THREE.OneFactor;
  flameMat.blendSrcAlpha = THREE.ZeroFactor; flameMat.blendDstAlpha = THREE.OneFactor;
  const flames = new THREE.Mesh(flameGeometry(), flameMat);
  flames.renderOrder = 10;
  for (const m of [cloth, holders, wax, flames]) { m.frustumCulled = false; scene.add(m); }
  const cam = new THREE.PerspectiveCamera(30, 1920 / 1080, 0.05, 40);
  return { scene, cam };
}
