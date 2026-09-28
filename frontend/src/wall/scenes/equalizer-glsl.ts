// 等化器的 shader：24 段的 LED 光柱（每段圓角的小燈），底下亮面地板的倒影，上面的顯示幕玻璃。
// 光柱的高度、峰值、哪幾柱被「正在唱的字」點亮都是 uniform（CPU 從音訊包絡算好）。
import { H } from '../engine/gl';

export const NCOL = 24;
export const NSEG = 15;

export const FRAG_EQ = /* glsl */ `
uniform float uLvl[${NCOL}];
uniform float uPeak[${NCOL}];
uniform float uHot[${NCOL}];
uniform float uCap[${NCOL}];  // 被字壓住的柱子最高只到這裡（字站在柱子上，燈不會跑到字上）
uniform vec4 uEq;       // 光柱區：x0, 底 y, 每柱間距, 柱寬
uniform vec2 uSeg;      // 每段間距, 段高
uniform vec4 uDisp;     // 顯示幕：x, y, w, h
uniform float uIn;
uniform float uKick;

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
  // 顏色：低的段是紙白偏暗、中間訊號色、頂端更熱；被正在唱的字點亮的柱子整柱偏熱
  vec3 on = mix(C_BLOOD * 0.9, C_SIGNAL * 0.95, smoothstep(0.05, 0.6, f));
  on = mix(on, C_EMBER * 1.25, smoothstep(0.7, 0.98, f));
  on = mix(on, C_SIGNAL * 1.6, hot * 0.6);
  float lit = clamp(lvl * ${NSEG}.0 - s, 0.0, 1.0);
  bool peak = abs(s - floor(pk * ${NSEG}.0 - 0.001)) < 0.5 && pk > 0.02;
  vec3 off = C_INK2 * 1.6 + C_GRAPHITE * 0.035;
  vec3 c = mix(off, on, lit);
  if (peak && lit < 0.5) c = mix(off, C_EMBER * 1.3, 0.85);
  // 燈罩：上緣一條亮邊，中間一點點高光
  c += C_BONE * 0.04 * (1.0 - smoothstep(0.0, 2.0, abs(sy - uSeg.y + 2.0)));
  return c;
}

void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  // 背景：深色，光柱後面一點點暖光
  float r = length((p - vec2(730.0, uEq.y - 200.0)) / vec2(1000.0, 520.0));
  vec3 col = C_INK + (C_INK2 - C_INK) * 1.6 * exp(-r * r * 1.4);
  col *= 1.0 + 0.08 * uKick * exp(-r * r * 2.0);
  // 顯示幕：暗色玻璃
  {
    vec2 c = uDisp.xy + uDisp.zw * 0.5;
    float d = sdBox(p - c, uDisp.zw * 0.5 - 14.0) - 14.0;
    float m = 1.0 - smoothstep(-0.8, 0.8, d);
    vec3 g = C_INK * 0.55 + (C_INK2 - C_INK) * 0.4 * (1.0 - (p.y - uDisp.y) / uDisp.w);
    g *= 1.0 - 0.06 * step(0.5, fract(p.y / 3.0));
    col = mix(col, g, m);
    col += C_GRAPHITE * 0.25 * (1.0 - smoothstep(0.0, 1.4, abs(d)));
  }
  // 光柱
  float cov;
  vec3 lc = led(p, cov);
  col = mix(col, lc, cov);
  // 地板的倒影：光柱底下往下鏡射，越遠越淡
  float fy = p.y - uEq.y;
  if (fy > 4.0) {
    vec3 rc = led(vec2(p.x, uEq.y - (fy - 4.0)), cov);
    float fade = exp(-fy / 38.0) * 0.32;
    col += rc * cov * fade;
  }
  fragColor = vec4(col * mix(0.4, 1.0, uIn), 1.0);
}`;
