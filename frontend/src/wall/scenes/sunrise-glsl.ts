// 日出（sunrise.ts）的全螢幕 shader：整張剪紙風景都在這裡畫——天空、放射的光芒、太陽的光暈與日輪、
// 歌詞的光芒紙條、海與三層浪、太陽在海上的倒影紙條、雲（主打留言那朵＋兩朵小雲）。
// 為什麼全放 shader：剪紙的味道來自「每一層紙底下都有一圈柔和的影子」，用距離場在 shader 裡算影子幾乎不花錢；
// Canvas2D 的 shadowBlur 每格畫會太慢（目標 < 12 ms），而且光芒、太陽、雲每格都在動。字另外用 Canvas2D 疊上去。
// 座標：p 是邏輯像素、y 向下（跟 Canvas2D 一樣）；角度也照 Canvas2D（往右上是負的）。
import { H } from '../engine/gl';

/** 光芒的格數、雲的圓形數（JS 端的 uniform 陣列長度要一致）。 */
export const N_RAYS = 12;
export const N_CIRC = 28;
/** 第一層浪的基準高度（sunrise.ts 的紙船照同一個公式貼著它走）。 */
export const WAVE_A = 868;

export const FRAG_SUNRISE = /* glsl */ `
uniform vec2 uSun;          // 太陽圓心
uniform float uR;           // 太陽半徑（大鼓時脹一點）
uniform vec4 uRay[${N_RAYS}];   // 光芒：角度、長度（0 = 還沒射出）、半張角、脈衝走到的半徑（< 0 沒有）
uniform float uRot;         // 整組光芒的轉角（每小節轉一點）
uniform float uFlash;       // 小鼓：光芒亮一下
uniform vec4 uStrip[2];     // 歌詞紙條：角度、長度、起點半寬、開關
uniform vec2 uStrip2[2];    // 歌詞紙條：從哪個半徑開始、半寬沿長度的增加率
uniform vec4 uCirc[${N_CIRC}];  // 雲的圓：x、y、半徑、第幾朵雲（0 = 主打留言那朵）
uniform vec4 uBody[3];      // 雲的身體（圓角矩形）：中心 xy、半寬高
uniform vec3 uBodyR;        // 雲身體的圓角半徑
uniform vec2 uGOff[3];      // 雲的位移（滑進來、慢慢飄）
uniform vec4 uCloudBox;     // 所有雲的外框（外面就不用算雲，省時間）
uniform vec3 uWave;         // 三層浪的橫向位移（每拍推一下）
uniform float uInkK;        // 太陽的墨混多少暗部（訊號色太接近紙色的主題混多一點，JS 端依色票算）
uniform vec4 uBoat;         // 紙船：甲板中點 xy、傾斜角（正的船頭往下）、縮放（0 = 不畫）
uniform float uGlint;       // 波光：倒影紙條左右錯動的相位（每拍推一下）

// 太陽的墨：訊號色帶一點暗部，淺的主題（香檳）在紙上才有份量
vec3 sunInk() { return mix(C_SIGNAL, C_BLOOD, uInkK); }

// 一層紙：先在紙的下方壓一圈柔和的影子（ds 是往右下偏移取樣的距離），再平塗這層紙
vec3 sheet(vec3 col, float d, float ds, vec3 c, float sh) {
  col *= 1.0 - sh * (1.0 - smoothstep(-12.0, 18.0, ds));
  return mix(col, c, aaFill(d));
}
// 同上，再加一條切口的亮邊（紙的斷面吃到光）：海浪、日輪、雲用，光芒不用（線太多會花）
vec3 sheetE(vec3 col, float d, float ds, vec3 c, float sh) {
  col = sheet(col, d, ds, c, sh);
  return mix(col, mix(c, C_BONE, 0.6), 0.55 * aaStroke(d + 1.6, 1.4));
}

float rayD(vec2 q, vec4 ry) {
  vec2 v = q - uSun;
  float r = length(v);
  float a = atan(v.y, v.x);
  float da = abs(a - (ry.x + uRot));
  return max((da - ry.z) * max(r, 1.0), r - ry.y);
}

float stripD(vec2 q, vec4 s, vec2 s2) {
  vec2 v = q - uSun;
  vec2 dir = vec2(cos(s.x), sin(s.x));
  float u = dot(v, dir), w = dot(v, vec2(-dir.y, dir.x));
  float hw = s.z + s2.y * max(u, 0.0);
  // 尾端削成尖的（像一道光的尖端）：射出去、縮回來的時候看起來是光，不是一條方方的紙帶
  return max(abs(w) - hw, max(s2.x - u, u - s.y + abs(w) * 1.1));
}

float rbox(vec2 p, vec2 b, float r) { vec2 d = abs(p) - b + r; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }

void clouds(vec2 q, out float d0, out float d1, out float d2) {
  d0 = rbox(q - uGOff[0] - uBody[0].xy, uBody[0].zw, uBodyR.x);
  d1 = rbox(q - uGOff[1] - uBody[1].xy, uBody[1].zw, uBodyR.y);
  d2 = rbox(q - uGOff[2] - uBody[2].xy, uBody[2].zw, uBodyR.z);
  for (int i = 0; i < ${N_CIRC}; i++) {
    vec4 c = uCirc[i];
    if (c.z <= 0.0) continue;
    if (c.w < 0.5) d0 = min(d0, length(q - uGOff[0] - c.xy) - c.z);
    else if (c.w < 1.5) d1 = min(d1, length(q - uGOff[1] - c.xy) - c.z);
    else d2 = min(d2, length(q - uGOff[2] - c.xy) - c.z);
  }
}

// 梯形（上緣半寬 r1、下緣半寬 r2、半高 he，y 向下）與三角形的距離場（照 Inigo Quilez 的公式）
float sdTrap(vec2 p, float r1, float r2, float he) {
  vec2 k1 = vec2(r2, he), k2 = vec2(r2 - r1, 2.0 * he);
  p.x = abs(p.x);
  vec2 ca = vec2(p.x - min(p.x, (p.y < 0.0) ? r1 : r2), abs(p.y) - he);
  vec2 cb = p - k1 + k2 * clamp(dot(k1 - p, k2) / dot(k2, k2), 0.0, 1.0);
  float s = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
  return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
}
float sdTri(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
  vec2 v0 = p - p0, v1 = p - p1, v2 = p - p2;
  vec2 q0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 q1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 q2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(q0, q0), s * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(q1, q1), s * (v1.x * e1.y - v1.y * e1.x))), vec2(dot(q2, q2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
// 紙船（船頭朝右）的三張紙：船身、主帆（桅杆後面）、前帆；q 是船的座標（原點在甲板中點，y 向下，未縮放）
void boatD(vec2 q, out float hull, out float sail, out float jib) {
  hull = sdTrap(q - vec2(0.0, 8.0), 46.0, 28.0, 8.0);
  sail = sdTri(q, vec2(2.0, -66.0), vec2(2.0, -6.0), vec2(-40.0, -6.0));
  jib = sdTri(q, vec2(9.0, -56.0), vec2(9.0, -9.0), vec2(38.0, -9.0));
}

float waveY(float x, float base, float ph, float k) {
  float xx = x + ph;
  return base + 7.0 * sin(xx / (92.0 * k) + 0.8 * k) + 3.5 * sin(xx / (39.0 * k) + 2.3 * k);
}

void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  vec2 so = p - vec2(5.0, 9.0);        // 影子往右下
  vec3 ink = sunInk();

  // ---- 天空：紙色，太陽附近暖一點（很淡，剪紙是平塗的）
  vec3 col = C_PAPER;
  float g = exp(-length((p - uSun) * vec2(0.5, 1.0)) / 640.0);
  col = mix(col, mix(C_PAPER, ink, 0.5), 0.14 * g + 0.08 * smoothstep(250.0, 800.0, p.y));
  // 天空是幾張同心的大弧（剪紙的立體舞台）：越靠近太陽顏色越暖
  float r = length(p - uSun), rs = length(so - uSun);
  col = sheet(col, r - 1650.0, rs - 1650.0, mix(C_PAPER, ink, 0.05), 0.05);
  col = sheet(col, r - 1160.0, rs - 1160.0, mix(C_PAPER, ink, 0.085), 0.06);
  col = sheet(col, r - 740.0, rs - 740.0, mix(C_PAPER, ink, 0.12), 0.07);

  // ---- 放射的光芒：一條條楔形紙片，深淺交錯
  for (int k = 0; k < ${N_RAYS}; k++) {
    vec4 ry = uRay[k];
    if (ry.y <= 1.0) continue;
    float d = rayD(p, ry), ds = rayD(so, ry);
    if (min(d, ds) > 24.0) continue;
    // 光芒淡一點（背景要能呼吸，字才是焦點）
    float tint = (mod(float(k), 2.0) < 0.5 ? 0.17 : 0.10) + 0.06 * uFlash;
    // 自己平方：GLSL 的 pow 底數是負的時候沒有定義，有的顯卡會算出 NaN
    if (ry.w > 0.0) { float rq = (length(p - uSun) - ry.w) / 110.0; tint += 0.17 * exp(-rq * rq); }
    col = sheet(col, d, ds, mix(C_PAPER, ink, tint), 0.09);
  }

  // ---- 太陽的光暈：兩圈剪紙圓
  col = sheetE(col, r - (uR + 88.0), rs - (uR + 88.0), mix(C_PAPER, ink, 0.2), 0.12);
  col = sheetE(col, r - (uR + 42.0), rs - (uR + 42.0), mix(C_PAPER, ink, 0.34), 0.14);

  // ---- 歌詞的光芒紙條（淺色、壓在光暈上、從日輪後面伸出來）
  for (int s = 0; s < 2; s++) {
    if (uStrip[s].w <= 0.0) continue;
    float d = stripD(p, uStrip[s], uStrip2[s]), ds = stripD(so, uStrip[s], uStrip2[s]);
    col = sheet(col, d, ds, mix(C_PAPER, C_BONE, 0.85), 0.2);
    // 紙條內緣一條很淡的壓線（剪紙的刀痕）
    col = mix(col, mix(col, C_SEPIA, 0.14), aaStroke(d + 9.0, 1.0) * step(0.0, -d));
  }

  // ---- 日輪：外圈訊號色、內圈亮一點（兩張疊起來的紙）
  vec3 disc = mix(C_SIGNAL, C_BLOOD, uInkK * 0.55);
  col = sheetE(col, r - uR, rs - uR, disc, 0.22);
  col = sheetE(col, r - uR * 0.72, rs - uR * 0.72, mix(disc, C_EMBER, 0.32), 0.12);

  // ---- 海：地平線那層把太陽的下半截擋住
  const float HZ = 800.0;
  vec3 sea = mix(C_SEPIA, ink, 0.3);   // 海帶一點太陽的顏色
  col = sheetE(col, HZ - p.y, HZ - so.y, mix(C_PAPER, sea, 0.15), 0.18);
  // 太陽在海上的倒影：幾條越來越短的紙條；每拍各自往左或往右錯開一點（波光，v2）
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float y = HZ + 17.0 + fi * (15.0 + fi * 4.5);
    float hl = (118.0 - fi * 21.0) * (uR / 172.0);
    float sx = (6.0 + fi * 2.5) * sin(fi * 2.4 + uGlint);
    float d = sdSegment(p, vec2(uSun.x - hl + sx, y), vec2(uSun.x + hl + sx, y)) - (6.0 - fi * 0.7);
    col = mix(col, mix(C_PAPER, ink, 0.34), aaFill(d));
  }
  // ---- 紙船（v2）：畫在第一層浪的後面，船底被浪擋住；帆是白紙、前帆吃到一點太陽的顏色
  if (uBoat.w > 0.0) {
    vec2 q = rot2(uBoat.z) * (p - uBoat.xy) / uBoat.w, qs = rot2(uBoat.z) * (so - uBoat.xy) / uBoat.w;
    if (max(abs(q.x), abs(qs.x)) < 80.0 && min(q.y, qs.y) > -90.0 && max(q.y, qs.y) < 40.0) {
      float h0, s0, j0, h1, s1, j1;
      boatD(q, h0, s0, j0);
      boatD(qs, h1, s1, j1);
      float k = uBoat.w;
      col = sheetE(col, s0 * k, s1 * k, mix(C_PAPER, C_BONE, 0.9), 0.16);
      col = sheetE(col, j0 * k, j1 * k, mix(C_PAPER, ink, 0.4), 0.12);
      col = mix(col, mix(C_PAPER, C_SEPIA, 0.7), aaFill((sdSegment(q, vec2(5.0, -70.0), vec2(5.0, 0.0)) - 1.4) * k));
      col = sheetE(col, h0 * k, h1 * k, mix(C_PAPER, sea, 0.85), 0.2);
    }
  }
  // 三層浪，越近越深
  float yA = waveY(p.x, ${WAVE_A}.0, uWave.x, 1.0), yAs = waveY(so.x, ${WAVE_A}.0, uWave.x, 1.0);
  col = sheetE(col, yA - p.y, yAs - so.y, mix(C_PAPER, sea, 0.26), 0.18);
  float yB = waveY(p.x, 934.0, uWave.y, 1.3), yBs = waveY(so.x, 934.0, uWave.y, 1.3);
  col = sheetE(col, yB - p.y, yBs - so.y, mix(C_PAPER, sea, 0.38), 0.2);
  float yC = waveY(p.x, 1000.0, uWave.z, 0.8), yCs = waveY(so.x, 1000.0, uWave.z, 0.8);
  col = sheetE(col, yC - p.y, yCs - so.y, mix(C_PAPER, sea, 0.52), 0.22);

  // ---- 雲：每朵兩張紙（後面一張深一點、往右上錯開），主打留言那朵最後畫、在最前面
  if (p.x > uCloudBox.x - 60.0 && p.x < uCloudBox.z + 60.0 && p.y > uCloudBox.y - 60.0 && p.y < uCloudBox.w + 60.0) {
    vec2 bo = vec2(20.0, -15.0);
    float c0, c1, c2, s0, s1, s2, b0, b1, b2, t0, t1, t2;
    clouds(p, c0, c1, c2);
    clouds(so, s0, s1, s2);
    clouds(p - bo, b0, b1, b2);
    clouds(so - bo, t0, t1, t2);
    vec3 back = mix(C_PAPER, C_SEPIA, 0.08), front = mix(C_PAPER, C_BONE, 0.9);
    col = sheet(col, b1 - 5.0, t1 - 5.0, back, 0.12); col = sheetE(col, c1, s1, front, 0.14);
    col = sheet(col, b2 - 5.0, t2 - 5.0, back, 0.12); col = sheetE(col, c2, s2, front, 0.14);
    col = sheet(col, b0 - 7.0, t0 - 7.0, back, 0.16); col = sheetE(col, c0, s0, front, 0.2);
    col = mix(col, mix(col, C_SEPIA, 0.13), aaStroke(c0 + 10.0, 1.0) * step(0.0, -c0));
  }

  // ---- 紙紋：大片的雲紋、橫向的纖維、細顆粒（跟時間無關，紙不會動）
  float n = snoise(p * 0.0035) * 0.014 + snoise(p * vec2(0.045, 0.32)) * 0.007 + (hash12(floor(p)) - 0.5) * 0.022;
  col *= 1.0 + n;
  fragColor = vec4(col, 1.0);
}`;
