// 航班看板的 shader：整張看板一次畫完（機殼、字牌的軌道、每一格翻牌、狀態燈）。
// 每一格的狀態（從哪個字翻到哪個字、翻到哪、兩面的色碼）在 uState（每格一個 texel），字從 uAtlas（_t7.ts 的 GlyphAtlas）取。
// 翻牌是平面的：上半片以轉軸（格子正中的橫線）往前倒，正面（舊字的上半）被壓扁；過了 90° 換成背面（新字的下半）蓋下來。
// 倒下來的那片會在下半片投下影子，轉到快垂直時比較暗——這些就是「機械感」。
import { H } from '../engine/gl';
import { GLYPH_GLSL, CODE_GLSL } from './_t7';

export const NG = 5;

export const FRAG_BOARD = /* glsl */ `
uniform sampler2D uState;
uniform sampler2D uAtlas;
uniform vec2 uAG;
uniform vec4 uG[${NG}];   // 每個格子區：x0, y0（左上，px，y 往下）, 每格間距 x, y
uniform vec4 uGS[${NG}];  // 牌的寬、高、欄數、列數
uniform float uGR[${NG}]; // 在 uState 裡從第幾列開始
uniform int uNG;
uniform vec4 uLamp[4];     // 狀態燈：x, y, 半徑, 亮度（訊號色）
uniform float uT, uKick, uIn, uRule;
${GLYPH_GLSL}
${CODE_GLSL}

vec3 housing(vec2 p) {
  // 機殼：暖黑，極細的橫向髮絲紋（拉絲鋁），上方一點點亮
  vec3 c = C_INK + (C_INK2 - C_INK) * (0.7 + 0.3 * smoothstep(1080.0, 0.0, p.y));
  float brush = snoise(vec2(p.x * 0.004, p.y * 0.9)) * 0.5 + 0.5;
  c += (C_INK2 - C_INK) * 0.5 * brush;
  return c;
}

/** 一張翻牌（lp = 牌內 px，sz = 牌的大小）。回傳顏色，m = 牌的覆蓋率（圓角外是 0）。 */
vec3 flapCard(vec2 lp, vec2 sz, vec4 st, out float m) {
  vec2 uv = lp / sz;
  float th = clamp(st.z, 0.0, 1.0) * PI, c = cos(th);
  float ca = floor(st.w / 16.0 + 1e-3), cb = st.w - ca * 16.0;
  float gi = st.x, code = ca, v = uv.y, shade = 1.0;
  bool face = false;
  if (uv.y < 0.5) {
    float edge = 0.5 - 0.5 * c;
    if (th < 0.5 * PI && uv.y >= edge) { gi = st.x; code = ca; v = 0.5 - (0.5 - uv.y) / max(c, 1e-3); shade = 0.55 + 0.45 * c; face = true; }
    else { gi = st.y; code = cb; }
  } else {
    float edge = 0.5 - 0.5 * c;
    if (th > 0.5 * PI && uv.y <= edge) { gi = st.y; code = cb; v = 0.5 + (uv.y - 0.5) / max(-c, 1e-3); shade = 0.55 + 0.45 * (-c); face = true; }
    else { gi = st.x; code = ca; shade = 1.0 - 0.55 * sin(th) * (1.0 - smoothstep(0.5, 0.95, uv.y)); }
  }
  // 牌面：上半片上緣亮一點、下半片暗一點（燈從上面打下來）
  // （翻動中的那片用它自己的座標 v：正面是上半片、背面是下半片）
  float half_ = v < 0.5 ? mix(1.18, 1.0, v * 2.0) : mix(0.86, 0.74, (v - 0.5) * 2.0);
  vec3 card = mix(C_INK2, C_GRAPHITE, 0.17) * half_;
  float a = glyphAt(gi, vec2(uv.x, v));
  vec3 col = mix(card, codeCol(code), a) * shade;
  // 轉軸：中間一條縫，左右兩個卡榫
  float hy = abs(lp.y - sz.y * 0.5);
  col *= 1.0 - 0.8 * (1.0 - smoothstep(0.5, 1.3, hy));
  if (hy < 3.0 && (lp.x < 2.2 || lp.x > sz.x - 2.2)) col *= 0.25;
  // 上緣一條細細的反光
  col += C_BONE * 0.035 * (1.0 - smoothstep(0.0, 1.6, lp.y));
  float d = sdBox(lp - sz * 0.5, sz * 0.5 - 3.5) - 3.5;
  m = 1.0 - smoothstep(-0.6, 0.6, d);
  return col;
}

void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  vec3 col = housing(p);
  // 表頭下的一條訊號色細線：大鼓一打就亮一下
  float rule = (1.0 - smoothstep(0.4, 1.2, abs(p.y - uRule))) * step(120.0, p.x) * step(p.x, 120.0 + 1212.0 * uIn);
  col += C_SIGNAL * rule * (0.35 + 1.4 * uKick);

  for (int g = 0; g < ${NG}; g++) {
    if (g >= uNG) break;
    vec4 G = uG[g], S = uGS[g];
    vec2 q = p - G.xy;
    float w = (S.z - 1.0) * G.z + S.x;
    // 字牌的軌道：每一列後面一條更暗的長條（牌裝在上面）
    float ry = floor(q.y / G.w);
    float ly = q.y - ry * G.w;
    if (q.x > -9.0 && q.x < w + 9.0 && ry >= 0.0 && ry < S.w && ly > -6.0 && ly < S.y + 6.0) {
      float rd = sdBox(vec2(q.x - w * 0.5, ly - S.y * 0.5), vec2(w * 0.5 + 9.0, S.y * 0.5 + 6.0) - 2.0) - 2.0;
      float rm = 1.0 - smoothstep(-0.6, 0.6, rd);
      col = mix(col, C_INK * 0.55, rm * 0.9);
      col += C_ASH * 0.05 * (1.0 - smoothstep(0.0, 1.2, abs(ly + 6.0))) * rm;
    }
    vec2 ci = floor(q / G.zw);
    if (ci.x < 0.0 || ci.y < 0.0 || ci.x >= S.z || ci.y >= S.w) continue;
    vec2 lp = q - ci * G.zw;
    if (lp.x > S.x + 1.0 || lp.y > S.y + 1.0) continue;
    vec4 st = texelFetch(uState, ivec2(int(ci.x), int(uGR[g] + ci.y)), 0);
    if (st.x < -1.5) continue; // 這格沒有牌（欄與欄之間的空位）
    float m;
    vec3 cc = flapCard(lp, S.xy, st, m);
    col = mix(col, cc, m);
  }

  // 狀態燈：圓形小燈，亮的時候是訊號色（會發光），暗的時候是一顆暗紅的玻璃
  for (int i = 0; i < 4; i++) {
    vec4 L = uLamp[i];
    if (L.z <= 0.0) continue;
    float d = length(p - L.xy) - L.z;
    float lm = 1.0 - smoothstep(-0.7, 0.7, d);
    vec3 lc = mix(C_BLOOD * 0.12, C_SIGNAL * 2.2, L.w);
    col = mix(col, lc, lm);
    col += C_SIGNAL * 0.25 * L.w * exp(-max(d, 0.0) / 7.0);
  }
  fragColor = vec4(col, 1.0);
}`;
