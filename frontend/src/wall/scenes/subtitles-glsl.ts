// 老電影雙語字幕（subtitles.ts）的全螢幕 shader：老戲院（兩側的絨布幕、前排椅背、空氣裡的灰塵）＋銀幕上放的黑白片。
// 片子是五個「空鏡頭」（不拍人：大螢幕只有新人的紙偶版面才畫人），每小節硬切一個：
//  0 海上的月亮  1 雨夜的窗  2 下雪的路燈  3 黃昏的屋頂  4 火車窗外的電線桿
// 每個鏡頭算一個 0..1 的亮度，再照老片的樣子上色（ink→bone）、加放映的東西：一秒 24 格的片門晃動、亮度閃爍、刮痕、灰塵、
// 換鏡頭那一下的接片跳格（黑色的格線滾過去）。字幕那一帶與留言的標題卡後面壓暗一點（不是框，是很寬的柔邊）。
// 座標：p 是邏輯像素、y 向下（跟 Canvas2D 一樣）。
import { H } from '../engine/gl';

/** 銀幕（放映出來的畫面）在畫面上的範圍：1.85:1，下緣停在 y = 800，下面是椅背（右下角 HUD 那一塊是暗的）。 */
export const SCR = { x0: 285, y0: 70, x1: 1635, y1: 800 };

export const FRAG_SUBTITLES = /* glsl */ `
uniform float uT;        // 片子的時間（一秒 24 格，量化過）
uniform float uShot;     // 第幾個鏡頭（0..4）
uniform float uShotT;    // 這個鏡頭放了幾秒
uniform float uSeed;     // 這個鏡頭的種子（同一個鏡頭每次出現，構圖稍微不一樣）
uniform float uBeat;     // 拍子的相位（整數是拍點）：火車的電線桿一拍過一根、屋頂的窗在拍點亮
uniform float uFrame;    // 第幾格（刮痕、灰塵每格換）
uniform vec2 uWeave;     // 片門晃動（px）
uniform float uFlick;    // 亮度閃爍
uniform float uSplice;   // 換鏡頭的接片跳格（1 → 0）
uniform float uLamp;     // 放映機的燈（進場亮起來）
uniform vec4 uTxt;       // 留言標題卡的範圍（中心 xy、半寬高），後面壓暗
uniform float uTxtK;
uniform float uSubK;     // 字幕那一帶壓暗多少（有歌詞時）

const vec4 S = vec4(${SCR.x0}.0, ${SCR.y0}.0, ${SCR.x1}.0, ${SCR.y1}.0);
const float ASP = ${((SCR.x1 - SCR.x0) / (SCR.y1 - SCR.y0)).toFixed(4)};

// ---- 0 海上的月亮：月亮在右上，海面一條碎光路，細細的浪線往畫面下方越來越疏
float shotSea(vec2 q, float u, float sd) {
  vec2 m = vec2(ASP * (0.7 + 0.05 * sd) - u * 0.01, 0.27);
  const float HZ = 0.56;
  float v;
  if (q.y < HZ) {
    v = mix(0.05, 0.2, q.y / HZ);
    float d = length(q - m);
    v += 0.25 * exp(-d * 5.0) + 0.1 * exp(-d * 1.6);
    float cl = fbm(vec2(q.x * 1.8 + u * 0.04, q.y * 8.0) + sd * 9.0, 3);
    v = mix(v, v * 0.45 + 0.04, smoothstep(0.05, 0.45, cl) * smoothstep(0.1, 0.4, q.y) * 0.8);
    v = mix(v, 0.98, smoothstep(0.072, 0.066, d));
  } else {
    float dy = q.y - HZ;
    float z = 1.0 / (dy + 0.025);
    v = 0.035 + 0.05 * exp(-dy * 6.0);
    float path = exp(-pow((q.x - m.x) / (0.03 + dy * 0.55), 2.0));
    float rip = snoise(vec2(q.x * 10.0 * (0.4 + dy), z * 1.3 - u * 1.4));
    v += path * smoothstep(0.3, 0.75, rip) * 0.85;
    v += 0.06 * smoothstep(0.55, 0.9, snoise(vec2(q.x * 6.0 * (0.4 + dy), z * 0.9 - u * 0.9)));
    v = mix(v, 0.3, (1.0 - smoothstep(0.0, 0.004, dy)) * 0.5);
  }
  return v;
}

// ---- 1 雨夜的窗：窗外一顆顆失焦的街燈（光圈），玻璃上的雨滴流下來，拍點上有新的一顆開始流；窗框是暗的十字
float shotRain(vec2 q, float u, float sd) {
  float v = 0.05 + 0.04 * q.y;
  for (int k = 0; k < 2; k++) {
    float sc = k == 0 ? 7.0 : 3.6;
    vec2 g = q * sc + vec2(u * (k == 0 ? 0.08 : 0.04), sd * 5.0 + float(k) * 3.0);
    vec2 id = floor(g), f = fract(g) - 0.5;
    vec2 h = hash22(id + float(k) * 7.3);
    if (h.x > 0.62) {
      // 失焦的光圈：邊緣軟、外圈稍亮一點（鏡頭的散景），遠的小而亮、近的大而淡
      float r = 0.16 + 0.2 * h.y;
      float d = length(f - (h - 0.5) * 0.35);
      float b = (k == 0 ? 0.3 : 0.14) * (0.4 + 0.6 * h.y) * (0.8 + 0.2 * sin(u * 1.7 + h.x * 40.0));
      v += b * smoothstep(r, r - 0.1, d) * (0.75 + 0.25 * smoothstep(r - 0.1, r - 0.02, d));
    }
  }
  // 留言那一塊（左上）的光圈淡一點，字才清楚
  v *= 1.0 - 0.45 * uTxtK * (1.0 - smoothstep(0.35, 0.65, q.x / ASP)) * (1.0 - smoothstep(0.45, 0.7, q.y));
  // 雨滴：一條條直的流痕，每條有一顆亮的水珠頭
  float cx = q.x * 34.0, col = floor(cx), fx = fract(cx) - 0.5;
  float h1 = hash11(col * 1.37 + sd * 11.0), h2 = hash11(col * 3.11 + 5.0);
  float sp = 0.18 + 0.35 * h2;
  float head = fract(-u * sp + h1 + floor(uBeat * 0.5) * 0.37 * step(0.7, h2));
  float dy = q.y - head;
  float lane = exp(-fx * fx * 60.0);
  v += 0.28 * lane * step(0.35, h1) * (smoothstep(0.03, 0.0, abs(dy)) + 0.25 * step(-0.35, dy) * step(dy, 0.0) * (1.0 + dy / 0.35));
  // 窗框
  float frameX = abs(q.x - ASP * (0.64 + 0.04 * sd));
  v = mix(v, 0.015, smoothstep(0.016, 0.012, frameX) + (1.0 - smoothstep(0.012, 0.016, abs(q.y - 0.46))) * step(ASP * 0.6, q.x));
  // 窗台（最下面一條暗的）：字幕在它上面
  v = mix(v, 0.02, smoothstep(0.84, 0.86, q.y));
  return v;
}

// ---- 2 下雪的路燈：右邊一盞路燈、一圈光錐，三層雪花往下飄（光錐裡的比較亮），地上一圈積雪的亮
float shotSnow(vec2 q, float u, float sd) {
  vec2 L = vec2(ASP * (0.72 + 0.04 * sd), 0.26);
  float v = 0.05 + 0.035 * (1.0 - q.y);
  vec2 d = q - L;
  float cone = d.y > 0.0 ? exp(-pow(d.x / (0.035 + d.y * 0.5), 2.0)) * exp(-d.y * 1.1) : 0.0;
  v += 0.22 * cone + 0.45 * exp(-length(d) * 14.0);
  v = mix(v, 0.97, smoothstep(0.03, 0.022, length(d * vec2(1.0, 1.6))));
  // 燈罩（燈泡上面一片梯形的暗、頂上一顆小圓頭）、燈柱
  float capW = 0.012 + (d.y + 0.05) / 0.026 * 0.028;
  v = mix(v, 0.02, step(abs(d.x), capW) * step(-0.05, d.y) * step(d.y, -0.022));
  v = mix(v, 0.02, smoothstep(0.009, 0.007, length(d - vec2(0.0, -0.056))));
  v = mix(v, 0.02, step(abs(q.x - L.x), 0.007) * step(L.y - 0.02, q.y) * step(q.y, 0.86));
  // 地面：路燈下一圈亮
  float g = smoothstep(0.855, 0.865, q.y);
  v = mix(v, 0.06 + 0.3 * exp(-pow((q.x - L.x) / 0.3, 2.0)), g);
  // 遠處的矮牆
  v = mix(v, 0.025, smoothstep(0.7, 0.705, q.y) * (1.0 - g) * (1.0 - 0.6 * cone));
  // 雪：三層，近的大、快；風每小節換一點方向
  for (int k = 0; k < 3; k++) {
    float fk = float(k), sc = 9.0 + fk * 7.0;
    vec2 g2 = q * sc + vec2(sin(u * 0.7 + fk) * 0.6 + u * (0.2 + 0.1 * sd), -u * (1.1 - fk * 0.25));
    vec2 id = floor(g2), f = fract(g2) - 0.5;
    vec2 h = hash22(id + fk * 13.1);
    f -= (h - 0.5) * 0.6;
    float r = (0.07 + 0.05 * h.x) * (1.0 - fk * 0.22);
    float lit = 0.35 + 0.9 * cone + 0.3 * exp(-length(d) * 5.0);
    v += step(0.35, h.y) * smoothstep(r, r * 0.4, length(f)) * lit * (0.5 - fk * 0.1);
  }
  return v;
}

// ---- 3 黃昏的屋頂：天邊一抹亮、一排屋頂與煙囪的剪影，窗戶在拍點一扇一扇亮起來，天線上的電線
float shotRoofs(vec2 q, float u, float sd) {
  float v = mix(0.06, 0.42, smoothstep(0.1, 0.62, q.y));
  float x = q.x + u * 0.015;
  // 兩排屋頂（遠的淡、近的暗）
  float far = 0.55 + 0.04 * step(0.5, hash11(floor(x * 9.0) + sd * 3.0)) + 0.03 * hash11(floor(x * 23.0));
  v = mix(v, 0.16, step(far, q.y));
  float bx = floor(x * 5.0 + sd * 2.0);
  float hb = hash11(bx + 2.0);
  float near = 0.62 + 0.1 * hb;
  // 斜屋頂：每棟一個山形
  float fx = fract(x * 5.0 + sd * 2.0) - 0.5;
  near -= 0.06 * (0.5 - abs(fx)) * step(0.5, hash11(bx + 9.0));
  // 煙囪
  near -= 0.07 * step(abs(fx - 0.25 * (hb - 0.5)), 0.03) * step(0.6, hb);
  float inB = step(near, q.y);
  v = mix(v, 0.025, inB);
  // 窗：近的那排房子上的小方格，拍點上一扇一扇亮（亮了就留著）
  vec2 wg = vec2(x * 38.0, (q.y - near) * 30.0);
  vec2 wi = floor(wg), wf = fract(wg);
  float hw = hash12(wi + sd * 17.0);
  float on = step(hw * 16.0, floor(uBeat) - 1.0) * step(0.82, hash12(wi + 3.3));
  v = mix(v, 0.5 + 0.25 * hw, on * inB * step(1.0, wg.y) * step(wf.x, 0.45) * step(wf.y, 0.5) * step(q.y, 0.84));
  // 電線：兩根桿子之間往下垂的弧
  float fw = fract(x * 1.2);
  float wire = 0.34 + 0.09 * 4.0 * fw * (1.0 - fw);
  v = mix(v, 0.03, (1.0 - smoothstep(0.0015, 0.003, abs(q.y - wire))) * (1.0 - inB));
  // 撐電線的細桿（在弧的最高點）
  float dp = (fw < 0.5 ? fw : fw - 1.0) / 1.2;
  v = mix(v, 0.03, (1.0 - smoothstep(0.0025, 0.004, abs(dp))) * step(0.33, q.y) * (1.0 - inB));
  return v;
}

// ---- 4 火車窗外：遠山慢慢往後、近的電線桿一拍一根「刷」地過去，電線跟著上下起伏
float shotTrain(vec2 q, float u, float sd) {
  float v = mix(0.1, 0.46, smoothstep(0.05, 0.6, q.y));
  float hill = 0.55 - 0.08 * (0.5 + 0.5 * snoise(vec2((q.x + u * 0.05) * 1.3, sd * 7.0)));
  v = mix(v, 0.14, smoothstep(hill, hill + 0.004, q.y));
  // 遠處一排樹（慢）、田（一條條被拉成橫線的田壟，越近越快）、最近的草叢（很快、糊成一片）
  float trees = 0.6 - 0.035 * (0.5 + 0.5 * snoise(vec2((q.x + u * 0.12) * 7.0, sd * 3.0)));
  v = mix(v, 0.07, smoothstep(trees, trees + 0.003, q.y));
  float field = 0.64;
  if (q.y > field) {
    float dz = (q.y - field) / (1.0 - field);
    float speed = 0.6 + 5.0 * dz * dz;
    float rows = snoise(vec2((q.x + u * speed) * 1.5 / (0.2 + dz), q.y * 90.0 * (1.2 - dz)));
    v = mix(0.1, 0.2, 0.5 + 0.5 * rows) * (1.0 - 0.4 * dz);
    float bush = 0.9 + 0.05 * snoise(vec2((q.x + u * 7.0) * 2.5, sd));
    v = mix(v, 0.03, smoothstep(bush, bush + 0.03, q.y));
  }
  // 電線桿：等距排在鐵路旁，火車等速往前，第 i 根在第 i 拍正好經過畫面中間（間距 1.6 個畫面寬，一次最多看到一根）
  float w = (q.x / ASP - 0.5) / 1.6 + uBeat;
  float dx = (w - floor(w + 0.5)) * 1.6 * ASP;
  float pole = step(abs(dx), 0.022) * step(0.08, q.y);
  // 電線：兩根桿子之間往下垂
  float f = fract(w);
  for (int k = 0; k < 2; k++) {
    float y = 0.14 + 0.05 * float(k) + 0.24 * f * (1.0 - f);
    v = mix(v, 0.03, 1.0 - smoothstep(0.0015, 0.0035, abs(q.y - y)));
  }
  v = mix(v, 0.02, pole);
  // 桿上的橫擔
  v = mix(v, 0.02, step(abs(dx), 0.07) * step(abs(q.y - 0.14), 0.006));
  return v;
}

float film(vec2 q, float shot, float u, float sd) {
  float v = 0.0;
  if (shot < 0.5) v = shotSea(q, u, sd);
  else if (shot < 1.5) v = shotRain(q, u, sd);
  else if (shot < 2.5) v = shotSnow(q, u, sd);
  else if (shot < 3.5) v = shotRoofs(q, u, sd);
  else v = shotTrain(q, u, sd);
  return v;
}

void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  vec3 col = C_INK * 0.6;
  vec2 sc = vec2(S.x + S.z, S.y + S.w) * 0.5, sh = vec2(S.z - S.x, S.w - S.y) * 0.5;
  float lamp = uLamp * uFlick;
  // ---- 戲院：兩側的絨布幕（垂直的皺褶，被銀幕的光照到靠近銀幕的那一邊）
  float side = max(S.x - 40.0 - p.x, p.x - S.z - 40.0);
  if (side > 0.0) {
    float fold = 0.5 + 0.5 * sin(p.x / 34.0 + 1.4 * sin(p.x / 97.0));
    float spill = exp(-side / 180.0) * lamp;
    vec3 velvet = mix(C_INK, mix(C_BLOOD, C_INK2, 0.7), 0.35) * (0.35 + 0.65 * pow(fold, 1.5));
    col = mix(col, velvet * (0.2 + 0.7 * spill), smoothstep(0.0, 6.0, side));
  }
  // 銀幕外框（黑色的遮幅）與銀幕反射到牆上的一點光
  vec2 dq = abs(p - sc) - sh;
  float outside = max(dq.x, dq.y);
  col += C_BONE * 0.012 * exp(-max(outside, 0.0) / 90.0) * lamp;
  // ---- 前排椅背：一排圓頂的剪影，上緣被銀幕照到一條亮邊
  float seatW = 150.0, sx = mod(p.x + 40.0, seatW) - seatW * 0.5;
  float top = 868.0 + 10.0 * hash11(floor((p.x + 40.0) / seatW)) + 0.004 * sx * sx;
  if (p.y > top - 2.0) {
    float rim = exp(-(p.y - top) / 5.0) * (1.0 - smoothstep(55.0, 70.0, abs(sx)));
    col = mix(col, C_INK * 0.35, smoothstep(top - 1.0, top + 1.0, p.y) * step(abs(sx), 70.0));
    col += C_BONE * 0.03 * rim * lamp * step(abs(sx), 70.0);
  }
  // ---- 片子
  vec2 pi = p - uWeave;
  vec2 uv = (pi - S.xy) / (S.zw - S.xy);
  if (outside < 0.0) {
    // 接片跳格：換鏡頭那一下畫面往上滾一點，黑色的格線從上面滾過去
    float roll = uSplice * 0.16;
    vec2 fu = vec2(uv.x, uv.y + roll);
    float fl = step(1.0, fu.y) * step(fu.y, 1.035);
    fu.y = fract(fu.y);
    vec2 q = vec2(fu.x * ASP, fu.y);
    float v = film(q, uShot, uShotT, uSeed);
    // 放映的亮斑：中間亮、四角暗
    vec2 cq = (uv - 0.5) * vec2(1.0, 0.9);
    v *= 1.0 - 0.55 * dot(cq, cq);
    // 字幕那一帶、留言標題卡後面壓暗（很寬的柔邊）
    v *= 1.0 - 0.55 * uSubK * smoothstep(0.72, 0.93, uv.y);
    vec2 tq = (p - uTxt.xy) / max(uTxt.zw, vec2(1.0));
    v *= 1.0 - 0.5 * uTxtK * exp(-dot(tq, tq) * 1.1);
    // 刮痕：一兩條細細的直線（每三格換一次位置、偶爾整條閃）
    float fr3 = floor(uFrame / 3.0);
    for (int k = 0; k < 2; k++) {
      float hk = hash11(fr3 * 1.7 + float(k) * 9.1);
      if (hk > 0.55) {
        float xs = hash11(fr3 * 3.3 + float(k) * 4.7);
        // 刮痕只在一段一段出現（不是整條貫穿），淡淡的
        float seg = step(0.4, hash11(floor(uv.y * 5.0) + fr3 * 2.1 + float(k)));
        v = mix(v, k == 0 ? 0.7 : 0.03, (1.0 - smoothstep(0.0, 0.0012, abs(uv.x - xs))) * 0.3 * seg);
      }
    }
    // 灰塵：偶爾一顆黑點、一根細毛（每格換）
    vec2 dg = uv * vec2(28.0, 15.0);
    vec2 did = floor(dg);
    float hd = hash12(did + uFrame * 0.131);
    if (hd > 0.994) {
      vec2 dp = fract(dg) - 0.5 - (hash22(did + uFrame) - 0.5) * 0.5;
      v = mix(v, 0.02, smoothstep(0.1, 0.05, length(dp * vec2(1.0, 1.8))));
    }
    v *= fl < 0.5 ? 1.0 : 0.0;
    v = clamp(v * lamp, 0.0, 1.0);
    vec3 fc = mix(C_INK * 0.5, C_BONE * 0.92, pow(v, 1.9));
    col = mix(col, fc, 1.0 - smoothstep(-1.0, 1.0, outside));
  }
  // ---- 放映光裡的灰塵：兩層很稀的小亮點慢慢飄（光從我們頭上打過去）
  for (int k = 0; k < 2; k++) {
    float fk = float(k), sz = 70.0 + fk * 50.0;
    vec2 g = (p + vec2(uT * (8.0 + fk * 5.0), -uT * (5.0 + fk * 3.0))) / sz;
    vec2 id = floor(g), f = fract(g) - 0.5;
    vec2 h = hash22(id + fk * 21.0);
    if (h.x > 0.86) {
      f -= (h - 0.5) * 0.6;
      float tw = 0.5 + 0.5 * sin(uT * (1.0 + h.y * 2.0) + h.x * 30.0);
      col += C_BONE * 0.06 * tw * smoothstep(0.05, 0.0, length(f)) * lamp * (1.0 - smoothstep(780.0, 900.0, p.y));
    }
  }
  fragColor = vec4(col, 1.0);
}`;
