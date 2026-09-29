// 等化器的 shader：一整面 LED 光柱（每段圓角的小燈），底下亮面地板的倒影；暗的舞台上兩道舞台燈的光束（慢慢擺、大鼓一打亮一下），
// 光束裡飄著灰塵；每個小節線一道光從左到右掃過整面光柱。留言那一塊有一點點暖光讓字浮起來。
// 光柱的高度、峰值、哪幾柱被「正在唱的字」點亮都是 uniform（CPU 從音訊包絡算好）。
import { H } from '../engine/gl';

export const NCOL = 24;
export const NSEG = 18;

export const FRAG_EQ = /* glsl */ `
uniform float uLvl[${NCOL}];
uniform float uPeak[${NCOL}];
uniform float uHot[${NCOL}];
uniform float uCap[${NCOL}];  // 被字壓住的柱子最高只到這裡（字站在柱子上，燈不會跑到字上）
uniform vec4 uEq;       // 光柱區：x0, 底 y, 每柱間距, 柱寬
uniform vec2 uSeg;      // 每段間距, 段高
uniform vec4 uGlow;     // 留言那一塊的暖光：中心 x, y, 半徑 x, y
uniform vec4 uBeam;     // 兩道光束的擺角（弧度）、大鼓、灰塵的時間
uniform vec2 uSweep;    // 小節線掃過的光：x、強度
uniform float uGain;    // 光柱的亮度（有留言時暗一點，焦點留給留言）
uniform float uIn;

vec3 led(vec2 p, out float cov) {
  cov = 0.0;
  float lx = p.x - uEq.x;
  float i = floor(lx / uEq.z);
  if (i < 0.0 || i >= ${NCOL}.0) return vec3(0.0);
  float cx = lx - i * uEq.z;
  float h = uEq.y - p.y;               // 從底往上
  if (h < 0.0) return vec3(0.0);
  float s = floor(h / uSeg.x);
  if (s >= ${NSEG}.0) return vec3(0.0);
  float sy = h - s * uSeg.x;
  vec2 q = vec2(cx - uEq.w * 0.5, sy - uSeg.y * 0.5);
  float d = sdBox(q, vec2(uEq.w, uSeg.y) * 0.5 - 3.0) - 3.0;
  cov = 1.0 - smoothstep(-0.7, 0.7, d);
  int ii = int(i);
  float lvl = 0.0, pk = 0.0, hot = 0.0, cap = 1.0;
  for (int k = 0; k < ${NCOL}; k++) if (k == ii) { lvl = uLvl[k]; pk = uPeak[k]; hot = uHot[k]; cap = uCap[k]; }
  lvl = min(lvl, cap); pk = min(pk, cap);
  float f = s / ${NSEG - 1}.0;
  // 顏色：低的段是訊號色的暗部、中間訊號色、頂端更熱；被正在唱的字點亮的柱子整柱偏亮
  vec3 on = mix(C_BLOOD * 0.9, C_SIGNAL * 0.95, smoothstep(0.05, 0.6, f));
  on = mix(on, C_EMBER * 1.2, smoothstep(0.7, 0.98, f));
  // 小節線那一道光：經過的柱子亮一下
  float sw = uSweep.y * exp(-abs(p.x - uSweep.x) / 70.0);
  on = mix(on * (uGain + 0.5 * sw), C_SIGNAL * 1.5, hot * 0.6);
  float lit = clamp(lvl * ${NSEG}.0 - s, 0.0, 1.0);
  bool peak = abs(s - floor(pk * ${NSEG}.0 - 0.001)) < 0.5 && pk > 0.02;
  vec3 off = C_INK2 * 1.4 + C_GRAPHITE * 0.025 + C_SIGNAL * 0.05 * sw;
  vec3 c = mix(off, on, lit);
  if (peak && lit < 0.5) c = mix(off, C_EMBER * 1.1 * uGain, 0.8);
  c += C_BONE * 0.03 * (1.0 - smoothstep(0.0, 2.0, abs(sy - uSeg.y + 2.0)));
  return c;
}

/** 一道從天花板打下來的光束（o = 燈的位置，ang = 離垂直的角度）：越往下越寬越淡。 */
float beam(vec2 p, vec2 o, float ang) {
  vec2 d = vec2(sin(ang), cos(ang));
  vec2 q = p - o;
  float along = dot(q, d);
  if (along <= 0.0) return 0.0;
  float perp = abs(q.x * d.y - q.y * d.x);
  float w = 30.0 + along * 0.2;
  return exp(-pow(perp / w, 2.0)) * exp(-along / 1100.0);
}

void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  // 暗的舞台：光柱後面一片暖光（跟著大鼓亮一下），留言那一塊一點點光讓字浮起來
  float r = length((p - vec2(uEq.x + uEq.z * ${NCOL / 2}.0, uEq.y - 160.0)) / vec2(1100.0, 420.0));
  vec3 col = C_INK * 0.85 + (C_INK2 - C_INK) * 1.4 * exp(-r * r * 1.4) * (1.0 + 0.15 * uBeam.z);
  float g = length((p - uGlow.xy) / uGlow.zw);
  col += (C_INK2 - C_INK) * 1.1 * exp(-g * g * 1.6);
  // 兩道舞台燈的光束＋光束裡的灰塵
  float b = beam(p, vec2(uEq.x + 220.0, -80.0), uBeam.x) + beam(p, vec2(uEq.x + uEq.z * ${NCOL}.0 - 200.0, -80.0), uBeam.y);
  float dust = 0.0;
  vec2 cell = floor(p / 46.0);
  vec2 h2 = hash22(cell);
  vec2 dp = cell * 46.0 + 46.0 * fract(h2 + vec2(0.03, -0.05) * uBeam.w);
  dust = (1.0 - smoothstep(0.6, 2.2, length(p - dp))) * step(0.72, hash12(cell + 7.0));
  col += mix(C_SIGNAL, C_BONE, 0.5) * b * (0.035 + 0.05 * uBeam.z) + C_BONE * dust * b * 0.35;
  float cov;
  vec3 lc = led(p, cov);
  col = mix(col, lc, cov);
  // 地板的倒影：光柱底下往下鏡射，越遠越淡
  float fy = p.y - uEq.y;
  if (fy > 4.0) {
    vec3 rc = led(vec2(p.x, uEq.y - (fy - 4.0)), cov);
    col += rc * cov * exp(-fy / 34.0) * 0.28;
  }
  fragColor = vec4(col * mix(0.4, 1.0, uIn), 1.0);
}`;
