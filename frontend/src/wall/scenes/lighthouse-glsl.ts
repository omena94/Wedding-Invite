// 燈塔版面的全螢幕 shader（lighthouse.ts 用）與「光束照到哪裡」的共用幾何。
// 一個 pass 畫完：夜空、霧、體積光束、版畫線的海（含光束的倒影）、岬角的岩石、燈塔。
//
// 體積光束不用 raymarch：每個像素的視線與光錐的軸線是兩條直線，解析地求最近點——
// 最近距離小於光錐半徑就是「視線穿過光束」，穿過的長度約是 2r / sin(夾角)，光的密度約 1 / r²，
// 所以散射到眼睛的光 ∝ 輪廓 / (r · sin 夾角)：光束轉向鏡頭時夾角變小、整片亮起來（眩光），轉開時變成細細一道。
// 同一個公式在 CPU 上也算一次（beamAt）：留言的字要知道光束什麼時候第一次照到自己。
//
// 相機：針孔、在原點、看 +z，y 向上；螢幕座標 y 向下（跟 Canvas2D 一樣）。地平線在螢幕 y = CY。
import { H } from '../engine/gl';

export const CAM = { cx: 960, cy: 640, f: 1400 };
/** 相機離海面的高度（世界單位）。 */
export const SEA_H = 160;
/** 燈室（燈）在螢幕上的位置與它的深度。 */
export const LAMP = { x: 1500, y: 266, z: 3000 };
/** 燈的世界座標。 */
export const LW: [number, number, number] = [(LAMP.x - CAM.cx) * LAMP.z / CAM.f, (CAM.cy - LAMP.y) * LAMP.z / CAM.f, LAMP.z];
/** 光束往下傾的角度（弧度）：轉到左邊時由上往下掃過整片天空，轉到遠方時打在地平線上。 */
export const TILT = 0.1;
/** 光錐：燈口的半徑與張角的正切。 */
export const R0 = 26, TANA = 0.075;
/** 光束「正對鏡頭」時的水平角：小節線上轉到這裡。 */
export const PHI_CAM = Math.atan2(-LW[2], -LW[0]);

/** 小節相位 u（0 = 小節線）→ 光束方向。往左轉：小節線眩光之後立刻掃過左邊的天空（留言在那裡）。 */
export function beamDir(u: number): [number, number, number] {
  const ph = PHI_CAM - Math.PI * 2 * u;
  const ce = Math.cos(TILT);
  return [Math.cos(ph) * ce, -Math.sin(TILT), Math.sin(ph) * ce];
}

/** 光束正對鏡頭的程度（0..1，只看方向）：眩光、後製的 flash 用。 */
export function facing(b: [number, number, number]) {
  const n = Math.hypot(LW[0], LW[1], LW[2]);
  return Math.max(0, -(b[0] * LW[0] + b[1] * LW[1] + b[2] * LW[2]) / n);
}

/**
 * 螢幕上 (x, y) 這個像素的視線，看到光束有多亮（不含霧的起伏；跟 shader 的 beam() 同一個公式）。
 * 大約 0..1.5：軸線正穿過這個像素時最亮。
 */
export function beamAt(x: number, y: number, b: [number, number, number]): number {
  let vx = x - CAM.cx, vy = CAM.cy - y, vz = CAM.f;
  const n = Math.hypot(vx, vy, vz); vx /= n; vy /= n; vz /= n;
  const w0x = -LW[0], w0y = -LW[1], w0z = -LW[2];
  const bb = vx * b[0] + vy * b[1] + vz * b[2];
  const d = vx * w0x + vy * w0y + vz * w0z, e = b[0] * w0x + b[1] * w0y + b[2] * w0z;
  const den = Math.max(1 - bb * bb, 1e-4);
  const sc = (bb * e - d) / den, tc = (e - bb * d) / den;
  if (tc < 0) return 0;
  const dx = w0x + sc * vx - tc * b[0], dy = w0y + sc * vy - tc * b[1], dz = w0z + sc * vz - tc * b[2];
  const r = R0 + tc * TANA;
  const prof = Math.exp(-2.2 * (dx * dx + dy * dy + dz * dz) / (r * r));
  const near = Math.min(1, Math.max(0, (sc - NEAR) / 1200));
  return BEAM_GAIN * prof / (r * Math.max(Math.sqrt(den), 0.12)) * Math.exp(-tc / 9000) * near;
}
/** 光束的總亮度（shader 與 beamAt 共用）。 */
export const BEAM_GAIN = 90;
/**
 * 離相機太近的那一段光束不算：光束轉向鏡頭時會從頭頂上掃過，近處那一段在畫面上會大到把整個畫面洗白，
 * 只留燈附近與遠方的霧（小節線上的眩光另外畫在燈的周圍）。
 */
export const NEAR = 1500;

export const FRAG_LIGHTHOUSE = /* glsl */ `
uniform float uT;
uniform vec3 uB;       // 光束方向
uniform float uPow;    // 光束強度（0 = 還沒點燈／退場收掉）
uniform float uGlare;  // 正對鏡頭的眩光 0..1
uniform float uLamp;   // 燈室的亮度 0..1
uniform float uKick;   // 大鼓：海浪起伏
uniform float uHat;    // hi-hat：星星閃
uniform float uIn;     // 進場

const vec2 C0 = vec2(${CAM.cx.toFixed(1)}, ${CAM.cy.toFixed(1)});
const float FOC = ${CAM.f.toFixed(1)};
const float SEAH = ${SEA_H.toFixed(1)};
const vec3 LW = vec3(${LW.map((v) => v.toFixed(3)).join(', ')});
const vec2 LS = vec2(${LAMP.x.toFixed(1)}, ${LAMP.y.toFixed(1)});
const float R0 = ${R0.toFixed(2)};
const float TANA = ${TANA.toFixed(4)};
const float GAIN = ${BEAM_GAIN.toFixed(2)};

vec3 rayOf(vec2 p) { return normalize(vec3(p.x - C0.x, C0.y - p.y, FOC)); }

// 視線（o + s v）穿過光束的散射（跟 lighthouse-glsl.ts 的 beamAt 同一個公式）；sOut 回傳最近點在視線上的距離
float beam(vec3 o, vec3 v, float nearCut, out float sOut) {
  vec3 w0 = o - LW;
  float b = dot(v, uB), d = dot(v, w0), e = dot(uB, w0);
  float den = max(1.0 - b * b, 1e-4);
  float sc = (b * e - d) / den, tc = (e - b * d) / den;
  sOut = sc;
  if (tc < 0.0) return 0.0;
  vec3 dv = w0 + sc * v - tc * uB;
  float r = R0 + tc * TANA;
  float prof = exp(-2.2 * dot(dv, dv) / (r * r));
  float near = sat((sc - nearCut) / 1200.0);
  return GAIN * prof / (r * max(sqrt(den), 0.12)) * exp(-tc / 9000.0) * near;
}

// 岬角岩石的上緣（螢幕 y，向下）：燈塔腳下最高，往左斜進海裡、往右慢慢低下去
float rockTop(float x) {
  float k = smoothstep(1190.0, 1450.0, x);
  float y = mix(742.0, 668.0, k) + smoothstep(1580.0, 1920.0, x) * 34.0;
  y += (fbm(vec2(x / 64.0, 3.1), 3) * 12.0 + fbm(vec2(x / 17.0, 7.7), 2) * 3.0) * (0.35 + 0.65 * k);
  if (x < 1190.0) y += (1190.0 - x) * 1.35;
  // 燈塔腳下的小丘（自己平方：GLSL 的 pow 底數是負的時候沒有定義，有的顯卡會算出 NaN）
  float hx = (x - 1500.0) / 80.0;
  y -= 14.0 * exp(-hx * hx);
  return y;
}

// 燈塔（螢幕座標，y 向下）。回傳顏色與覆蓋率（a）
vec4 tower(vec2 p) {
  float x = p.x - LS.x;
  vec3 col = vec3(0.0); float a = 0.0;
  // 塔身：上窄下寬
  if (p.y > 316.0 && p.y < 672.0) {
    float k = (p.y - 316.0) / 356.0;
    float hw = mix(33.0, 52.0, k);
    float q = x / hw;
    float cov = sat(hw - abs(x) + 0.5);
    if (cov > 0.0) {
      // 圓柱的明暗（左邊迎著夜空的微光）＋沿著圓柱曲率的直向刻線
      float lit = 0.5 - 0.5 * q;
      float u = asin(clamp(q, -1.0, 1.0)) * 7.0;
      float ink = hatch(u, 0.25 + 0.55 * (1.0 - lit));
      // 兩道深色環帶
      float band = step(398.0, p.y) * step(p.y, 446.0) + step(528.0, p.y) * step(p.y, 578.0);
      vec3 body = mix(C_INK2 * 1.6 + C_ASH * 0.05 * lit, C_INK * 0.8, band * 0.85);
      body = mix(body, C_INK, ink * 0.55);
      // 輪廓的細亮邊（讓塔從夜空裡分出來）
      body += C_BONE * 0.10 * pxLine(hw - abs(x), 0.4, 1.4);
      // 小窗與門：裡面有一點暖光
      float win = 0.0;
      for (int i = 0; i < 3; i++) { float wy = 372.0 + float(i) * 104.0; win += step(abs(x + 4.0), 4.0) * step(abs(p.y - wy), 8.0); }
      body = mix(body, C_EMBER * 0.22 * uIn, sat(win));
      float door = step(abs(x), 10.0) * step(642.0, p.y);
      body = mix(body, C_INK * 0.5, door);
      col = body; a = cov;
    }
  }
  // 陽台：平台＋欄杆
  if (abs(x) < 50.0 && p.y > 309.0 && p.y < 318.0) { col = C_INK2 * 1.4 + C_BONE * 0.10 * pxLine(abs(p.y - 309.5), 0.4, 1.3); a = 1.0; }
  if (abs(x) < 47.0 && p.y > 290.0 && p.y <= 309.0) {
    float rail = pxLine(abs(p.y - 291.0), 0.35, 1.2) + pxLine(abs(p.y - 300.0), 0.3, 1.0) * 0.6;
    float bal = pxLine(abs(fract(x / 7.0 + 0.5) - 0.5) * 7.0, 0.3, 1.0);
    float m = sat(rail + bal * 0.8);
    col = mix(col, C_ASH * 0.22, m); a = max(a, m);
  }
  // 燈室：玻璃裡面是燈的光，前面有直向的窗框
  if (abs(x) < 25.0 && p.y > 238.0 && p.y <= 290.0) {
    float mull = 0.0;
    for (int i = 0; i < 4; i++) mull = max(mull, pxLine(abs(x - (-16.5 + float(i) * 11.0)), 0.6, 1.6));
    vec3 glass = C_EMBER * (0.25 + 1.3 * uLamp) * (0.6 + 0.4 * (1.0 - abs(x) / 25.0));
    col = mix(glass, C_INK2, mull * 0.9); a = 1.0;
  }
  // 圓頂＋頂針
  vec2 dq = vec2(x, p.y - 238.0);
  if (p.y <= 238.0 && length(dq) < 27.0) { col = C_INK2 * 1.3 + C_BONE * 0.10 * pxLine(27.0 - length(dq), 0.4, 1.4); a = sat(27.0 - length(dq) + 0.5); }
  if (abs(x) < 1.6 && p.y > 196.0 && p.y <= 212.0) { col = C_ASH * 0.3; a = 1.0; }
  return vec4(col, a);
}

void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  vec3 v = rayOf(p);
  float fogN = fbm(p * vec2(1.0 / 560.0, 1.0 / 240.0) + vec2(uT * 0.035, 0.0), 3);
  vec3 warm = mix(C_BONE, C_EMBER, 0.4);
  vec3 col;
  float sBeam;

  if (p.y < C0.y) {
    // ---- 天空：暖黑，靠近地平線稍微浮起來；霧團（只有被光束照到才看得出來，平常只有一點點）
    float hz = 1.0 - smoothstep(0.0, 420.0, C0.y - p.y);
    col = mix(C_INK, C_INK2, 0.35 + 0.65 * hz);
    float fog = 0.22 + 0.78 * smoothstep(-0.35, 0.55, fogN);
    fog *= 0.55 + 0.45 * smoothstep(80.0, 520.0, p.y);
    col += C_ASH * 0.012 * fog * uIn;
    // 很少很少的星星（hi-hat 閃一下）
    vec2 cell = floor(p / 46.0);
    float h = hash12(cell);
    bool textZone = p.x > 120.0 && p.x < 1290.0 && p.y > 80.0 && p.y < 620.0;
    if (h > 0.986 && p.y < C0.y - 60.0 && !textZone) {
      vec2 sp = (cell + 0.2 + 0.6 * hash22(cell + 3.1)) * 46.0;
      float tw = 0.5 + 0.5 * sin(uT * (1.3 + h * 3.0) + h * 40.0) + uHat * step(0.5, hash12(cell + 7.0));
      col += C_BONE * 0.35 * tw * exp(-dot(p - sp, p - sp) / 1.4) * (1.0 - smoothstep(420.0, 620.0, p.y)) * uIn;
    }
    // 光束
    float bm = beam(vec3(0.0), v, ${NEAR.toFixed(1)}, sBeam);
    col += warm * min(bm * fog * uPow * (1.0 - 0.6 * uGlare), 0.75);
  } else {
    // ---- 海：一條條版畫橫線（在地平線附近越來越密），光束的倒影碎在線上
    float dy = max(p.y - C0.y, 0.5);
    float sHit = SEAH / max(-v.y, 1e-4);
    vec3 hp = v * sHit;
    float wob = 0.22 * sin(hp.x / 150.0 + uT * 1.1) + 0.14 * sin(hp.x / 61.0 - uT * 1.7 + hp.z / 400.0);
    wob *= 1.0 + 1.6 * uKick;
    float u = log(dy) * 11.0 + wob;
    col = C_INK * 0.92;
    // 反射：從海面反彈的視線看到的光束（菲涅耳：越接近地平線越亮）
    vec3 rv = vec3(v.x, -v.y, v.z);
    float sr;
    float refl = beam(hp, rv, -1e4, sr) * uPow;
    float fres = 0.35 + 0.65 * (1.0 - smoothstep(0.0, 260.0, dy));
    // 燈本身的倒影：燈正下方一條閃爍的光柱
    float colW = 6.0 + dy * 0.22;
    float colX = abs(p.x - LS.x - 10.0 * sin(u * 2.3 + uT * 2.0));
    float lampCol = uLamp * (0.10 + 0.9 * uGlare) * exp(-colX / colW) * (1.0 - smoothstep(0.0, 380.0, dy));
    float light = refl * fres * 0.55 + lampCol;
    float line = hatch(u, 0.16 + 0.5 * sat(light * 2.0));
    col += C_GRAPHITE * 0.11 * line;
    col += warm * light * line * 1.4;
    // 光束在視線前面、海面上方那一段（打在遠方海上時）
    float bm = beam(vec3(0.0), v, ${NEAR.toFixed(1)}, sBeam);
    col += warm * bm * step(sBeam, sHit) * 0.6 * uPow * (0.5 + 0.5 * smoothstep(-0.35, 0.55, fogN));
    // 地平線：一條極細的亮線
    col += C_ASH * 0.10 * pxLine(p.y - C0.y, 0.3, 1.1);
  }

  // ---- 岬角岩石：剪影、斜向刻線、上緣淡淡的輪廓光
  float rt = rockTop(p.x);
  if (p.y > rt - 1.0) {
    float cov = sat(p.y - rt + 0.5);
    float dk = 0.55 + 0.35 * fbm(p / 90.0 + 5.0, 2);
    float ink = hatch((p.x * 0.6 + p.y) / 6.5, dk);
    vec3 rock = mix(C_INK2 * 1.2, C_INK * 0.7, ink);
    rock += C_BONE * 0.07 * pxLine(p.y - rt, 0.4, 1.6);
    rock += C_EMBER * 0.05 * uLamp * exp(-length(p - vec2(LS.x, 672.0)) / 120.0);
    col = mix(col, rock, cov);
  }

  // ---- 燈塔
  if (abs(p.x - LS.x) < 60.0 && p.y > 190.0 && p.y < 680.0) {
    vec4 tw = tower(p);
    col = mix(col, tw.rgb, tw.a);
  }

  // ---- 燈：核心、光暈；正對鏡頭時一大片眩光與一道橫向的星芒
  vec2 dl = p - LS;
  float r = length(dl);
  col += C_EMBER * uLamp * (3.5 * exp(-r / 5.0) + 0.5 * exp(-r / 22.0));
  col += warm * uGlare * (2.4 * exp(-r / 14.0) + 0.45 * exp(-r / 80.0) + 0.05 * exp(-r / 380.0));
  // 星芒只留在燈旁邊（短短一道）：拉滿整個畫面就成了鏡頭光暈的俗套，還會橫過霧裡的留言
  col += warm * uGlare * uGlare * 0.9 * exp(-abs(dl.y) / 2.0) * exp(-abs(dl.x) / 60.0);
  fragColor = vec4(col, 1.0);
}`;
