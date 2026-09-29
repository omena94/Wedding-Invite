// 月相版面的全螢幕 shader（moon.ts 用）：夜空、稀疏的小星、版畫雕刻的月球。
// 月亮當成一顆球來算：圓盤座標 → 法線，太陽方向繞 y 軸轉就是月相（0 新月、π 滿月）。
// 月面的刻線沿著「緯度」走（月軸往鏡頭傾一點，緯線投影成彎的弧，像老版畫的地球儀），
// 線的粗細 = 暗度（明暗交界、月海、環形山的陰影），所以亮面是細細的髮絲線、越接近交界線越密越粗。
// 留言要寫在滿月上：uTxt 圈起來的範圍把紋理的對比壓低，字才讀得清楚。
// 座標：p 是邏輯像素、y 向下（跟 Canvas2D 一樣）；球的法線 y 向上。
import { H } from '../engine/gl';

export const FRAG_MOON = /* glsl */ `
uniform vec2 uC;       // 月亮圓心（px）
uniform float uR;      // 月亮半徑（px）
uniform float uPhi;    // 月相角：0 新月、π/2 上弦、π 滿月、3π/2 下弦
uniform float uRot;    // 月面經度的偏移（窗格裡很慢地轉一點點）
uniform float uIn;     // 進場 0..1
uniform float uKick;   // 大鼓：暈亮一點
uniform float uHat;    // hi-hat：星星閃
uniform vec4 uTxt;     // 留言範圍（橢圓）：中心 xy、半徑 zw（px）
uniform float uTxtK;   // 留言範圍壓低紋理的程度 0..1
uniform float uT;

// 月軸往鏡頭傾（緯線才會彎）；經度轉動在傾斜之後，緯線不會跟著跑
const float TILT = 0.14;
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }

// 環形山：月面座標裡的方向（會正規化）與角半徑
const int NC = 10;
const vec4 CR[NC] = vec4[NC](
  vec4(-0.30, -0.55, 0.78, 0.13), vec4(0.42, 0.18, 0.89, 0.09), vec4(-0.62, 0.30, 0.72, 0.07),
  vec4(0.10, 0.62, 0.78, 0.11), vec4(0.66, -0.40, 0.64, 0.08), vec4(-0.05, -0.12, 1.0, 0.05),
  vec4(0.28, -0.78, 0.55, 0.06), vec4(-0.80, -0.20, 0.56, 0.10), vec4(0.84, 0.30, 0.45, 0.06),
  vec4(-0.40, 0.72, 0.56, 0.05)
);

/** 月面某一點的「暗度」（刻線的粗細，0 = 紙白、1 = 全墨）：月海、環形山的碗與邊緣。 */
float surface(vec3 m, vec3 Lm, out float mare) {
  mare = smoothstep(0.0, 0.34, fbm(m * 1.55 + vec3(3.1, 1.7, 5.3), 4));
  float d = 0.36 * mare + 0.05 * snoise(m * 9.0);
  for (int i = 0; i < NC; i++) {
    vec3 c = normalize(CR[i].xyz);
    float r = CR[i].w;
    float ca = dot(m, c);
    if (ca < cos(r * 1.45)) continue;
    float x = acos(clamp(ca, -1.0, 1.0)) / r;
    vec3 tg = m - c * ca;
    float tl = length(tg);
    float side = tl > 1e-4 ? dot(tg / tl, Lm) : 0.0;  // >0：這一側朝著太陽
    float inside = 1.0 - smoothstep(0.82, 1.0, x);
    float rim = smoothstep(0.78, 1.0, x) * (1.0 - smoothstep(1.0, 1.4, x));
    // 碗：朝太陽那一側的內壁在陰影裡；外緣：朝太陽的一側亮、背光的一側暗
    d += inside * (0.10 + 0.55 * max(side, 0.0) * x) - rim * 0.22 * max(side, 0.0) + rim * 0.18 * max(-side, 0.0);
  }
  return d;
}

void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  vec2 dp = p - uC;
  float rpx = length(dp);

  // ---- 夜空：暖黑，極淡的雲氣
  vec3 col = C_INK * (0.86 + 0.14 * (0.5 + 0.5 * fbm(p / 640.0 + vec2(1.3, uT * 0.004), 3)));
  // 很淡的暈（亮面越大越亮，大鼓時亮一點）：只有一點點，不要漸層光暈的俗套
  float illum = 0.5 - 0.5 * cos(uPhi);
  float ho = max(rpx - uR, 0.0);
  col += C_BONE * (0.018 + 0.012 * uKick) * illum * exp(-ho / (uR * 0.32)) * uIn;
  // 一圈極細的刻線暈環（像星圖上的圖框線），很淡
  // 下半圈淡掉：軌道上的歌詞從那裡經過
  col += C_BONE * 0.035 * aaStroke(rpx - uR * 1.13, 0.8) * uIn * (1.0 - smoothstep(uC.y + uR * 0.35, uC.y + uR * 0.8, p.y));

  // ---- 稀疏的小星（避開月亮附近）；hi-hat 讓一部分閃一下
  vec2 cell = floor(p / 74.0);
  float hs = hash12(cell);
  if (hs > 0.84) {
    vec2 sp = cell * 74.0 + 10.0 + hash22(cell) * 54.0;
    float sd = length(p - sp);
    float sz = 0.55 + 1.1 * hash12(cell + 3.7);
    float tw = 0.75 + 0.25 * sin(uT * (1.3 + 2.0 * hash12(cell + 9.1)) + hs * 40.0);
    float b = (0.18 + 0.5 * hash12(cell + 1.9)) * tw * (1.0 + 1.6 * uHat * step(0.55, hash12(cell + 5.3)));
    float away = smoothstep(uR * 1.2, uR * 1.45, length(sp - uC));
    col += C_BONE * b * (1.0 - smoothstep(sz * 0.4, sz, sd)) * away * uIn;
  }

  // ---- 月球
  if (rpx < uR + 2.0) {
    vec2 d = dp / uR;
    float r2 = dot(d, d);
    vec3 n = vec3(d.x, -d.y, sqrt(max(0.0, 1.0 - r2)));
    vec3 L = vec3(sin(uPhi), 0.0, -cos(uPhi));
    float lam = dot(n, L);
    mat3 M = rotY(uRot) * rotX(TILT);
    vec3 m = M * n, Lm = M * L;
    float mare;
    float dk = surface(m, Lm, mare);
    // 明暗交界：越接近越暗（刻線越粗越密）
    // 月球幾乎沒有臨邊昏暗：只在交界線附近加暗，邊緣稍微暗一點點給一點圓度
    float shade = 1.0 - smoothstep(-0.02, 0.42, lam);
    float limb = 1.0 - smoothstep(0.0, 0.45, n.z);
    float dark = 0.06 + 0.66 * shade + 0.1 * limb + dk * 0.85;
    // 留言範圍：紋理的對比壓低（只剩淡淡的髮絲線）
    vec2 q = (p - uTxt.xy) / max(uTxt.zw, vec2(1.0));
    float tm = (1.0 - smoothstep(0.78, 1.06, length(q))) * uTxtK;
    // （MV 檢修：字後面再乾淨一點，只剩很淡的月海）
    dark = mix(dark, 0.03 + 0.08 * mare, tm * 0.94);
    // 刻線：緯線（主線）＋深暗處加經線（交叉線）
    float lat = asin(clamp(m.y, -1.0, 1.0));
    float lon = atan(m.x, m.z);
    float u = lat * uR / 5.4;
    float v = lon * uR / 6.2;
    float cov = hatch(u, dark);
    // （hatch 在暗度 0 時還會留一條半透明的反鋸齒線，交叉線要另外乘上開關，不然滿月上會出現網格）
    float d2 = sat((dark - 0.62) * 1.7);
    cov = max(cov, hatch(v, d2) * smoothstep(0.0, 0.08, d2));
    vec3 paper = C_BONE * (0.86 - 0.05 * mare);
    vec3 ink = mix(C_SEPIA, C_GRAPHITE, 0.2);
    // 刻線整體淡一點（背景要能呼吸），字後面更淡
    vec3 litCol = mix(paper, ink, cov * mix(0.72, 0.5, tm));
    // 暗面：ink2 上只有極淡的地照細線
    vec3 darkCol = C_INK2 * 1.1 + C_BONE * 0.016 * hatch(u, 0.16 + 0.14 * mare);
    float lit = smoothstep(-0.06, 0.04, lam);
    vec3 moon = mix(darkCol, litCol, lit);
    float a = aaFill(rpx - uR) * uIn;
    col = mix(col, moon, a);
    // 月緣一圈細線（暗面的輪廓也看得到）
    col += C_BONE * 0.12 * aaStroke(rpx - uR, 1.0) * uIn;
  }
  // ---- 薄雲（v2 多補的動畫，夜空自己的）：兩條很薄的雲帶慢慢往左飄，飄過月亮時擋住一點月光、
  //      雲的下緣被月光鑲一道銀邊；留言那一塊雲幾乎是透明的（字不能被擋）
  {
    float band = exp(-pow((p.y - (uC.y - uR * 0.72)) / 60.0, 2.0)) + 0.8 * exp(-pow((p.y - (uC.y + uR * 0.86)) / 52.0, 2.0));
    if (band > 0.01) {
      // 大尺度、只取兩層的 fbm：雲是一大片很淡的紗，不是一團團小斑點
      float n = fbm(vec2(p.x / 620.0 + uT * 0.03, p.y / 110.0 + 3.7), 2);
      float cl = smoothstep(-0.1, 0.45, n) * band;
      vec2 qt = (p - uTxt.xy) / max(uTxt.zw, vec2(1.0));
      cl *= 1.0 - 0.9 * (1.0 - smoothstep(0.85, 1.15, length(qt))) * uTxtK;
      float onMoon = aaFill(rpx - uR - 40.0);
      // 雲本身：比夜空亮一點點的灰（被月光從背後照），在月亮前面是擋光的暗灰
      vec3 cloudCol = mix(C_INK2 * 1.6, mix(C_INK2, C_ASH, 0.35), onMoon);
      col = mix(col, cloudCol, cl * mix(0.28, 0.42, onMoon) * uIn);
      // 銀邊：雲的下緣、靠近月亮的地方亮一點
      float edge = smoothstep(-0.05, 0.15, n) * (1.0 - smoothstep(0.15, 0.4, n)) * band;
      col += C_BONE * 0.04 * edge * exp(-max(rpx - uR, 0.0) / (uR * 0.6)) * illum * uIn;
    }
  }
  fragColor = vec4(col, 1.0);
}`;
