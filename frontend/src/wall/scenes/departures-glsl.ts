// 航班看板的 shader：鏡頭從看板斜下方仰看（機場大廳裡的一面翻牌看板），整張看板一次畫完。
// 每個像素先從鏡頭射線打到看板平面上（跟里程表一樣的做法），拿到看板座標再畫：看板面、每一格翻牌、狀態燈、小字標籤。
// 每一格的狀態（從哪個字翻到哪個字、翻到哪、兩面的色碼）在 uState（每格一個 texel），字從兩張字模圖集取
// （A：小格子——航班列、歌詞列；B：大格子——主打留言，字大所以圖集的格子也大）。
// 翻牌是平面的：上半片以轉軸往前倒，正面（舊字的上半）被壓扁；過了 90° 換成背面（新字的下半）蓋下來，並在下半片投下影子。
// 景深：離對焦距離（主打留言那一塊）越遠，字取樣越糊、牌的邊越軟。
import { H } from '../engine/gl';
import { CODE_GLSL } from './_t7';

// 格子區最多幾塊：航班、留言、歌詞、署名、倒數，韓文歌再多一塊原文副行（沒有原文時 uNG 還是 5，畫面不變）
export const NG = 6;

export const FRAG_BOARD = /* glsl */ `
uniform sampler2D uState;
uniform sampler2D uAtlasA;
uniform sampler2D uAtlasB;
uniform vec2 uAGA;
uniform vec2 uAGB;
uniform vec4 uG[${NG}];   // 格子區：x0, y0（左上，看板座標 px，y 往下）, 每格間距 x, y
uniform vec4 uGS[${NG}];  // 牌的寬、高、欄數、列數
uniform vec4 uGX[${NG}];  // 在 uState 的第幾列開始、用哪張圖集（0 = A、1 = B）、字的亮度、要不要畫軌道
uniform int uNG;
uniform vec4 uLamp;       // 狀態燈：x, y, 半徑, 亮度
uniform sampler2D uLab;   // 小字標籤（fast Layer2D，只取 alpha）
uniform vec4 uLabR;
uniform vec4 uBoard;      // 看板範圍 x0, y0, x1, y1
uniform vec3 uCP;
uniform mat3 uCR;
uniform float uF;
uniform float uFocus;
uniform float uIn;
uniform float uKick;
${CODE_GLSL}

vec2 planeAt(vec2 sp, out float dist) {
  vec3 dir = normalize(uCR * vec3(sp.x - 960.0, 540.0 - sp.y, -uF));
  float tt = -uCP.z / dir.z;
  vec3 w = uCP + dir * tt;
  dist = tt;
  return vec2(w.x + 960.0, 540.0 - w.y);
}

float glyphIn(float atlas, float gi, vec2 uv, float bias) {
  if (gi < -0.5 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  if (atlas < 0.5) {
    vec2 cell = vec2(mod(gi, uAGA.x), floor(gi / uAGA.x + 1e-4));
    return texture(uAtlasA, (cell + uv) / uAGA, bias).a;
  }
  vec2 cell = vec2(mod(gi, uAGB.x), floor(gi / uAGB.x + 1e-4));
  return texture(uAtlasB, (cell + uv) / uAGB, bias).a;
}

/** 一張翻牌（lp = 牌內 px，sz = 牌的大小）。回傳顏色，m = 覆蓋率。 */
vec3 flapCard(vec2 lp, vec2 sz, vec4 st, float atlas, float bright, float aa, float bias, out float m) {
  vec2 uv = lp / sz;
  float th = clamp(st.z, 0.0, 1.0) * PI, c = cos(th);
  float ca = floor(st.w / 16.0 + 1e-3), cb = st.w - ca * 16.0;
  float gi = st.x, code = ca, v = uv.y, shade = 1.0;
  if (uv.y < 0.5) {
    float edge = 0.5 - 0.5 * c;
    if (th < 0.5 * PI && uv.y >= edge) { v = 0.5 - (0.5 - uv.y) / max(c, 1e-3); shade = 0.55 + 0.45 * c; }
    else { gi = st.y; code = cb; }
  } else {
    float edge = 0.5 - 0.5 * c;
    if (th > 0.5 * PI && uv.y <= edge) { gi = st.y; code = cb; v = 0.5 + (uv.y - 0.5) / max(-c, 1e-3); shade = 0.55 + 0.45 * (-c); }
    else { shade = 1.0 - 0.55 * sin(th) * (1.0 - smoothstep(0.5, 0.95, uv.y)); }
  }
  float half_ = v < 0.5 ? mix(1.12, 1.0, v * 2.0) : mix(0.86, 0.76, (v - 0.5) * 2.0);
  vec3 card = mix(C_INK2, C_GRAPHITE, 0.13) * half_;
  // 空白的牌暗一點：看板的質感還在，但不搶字
  if (st.x < -0.5 && st.y < -0.5) card *= 0.6;
  float a = glyphIn(atlas, gi, vec2(uv.x, v), bias);
  vec3 col = mix(card, codeCol(code) * bright, a) * shade;
  float hy = abs(lp.y - sz.y * 0.5);
  col *= 1.0 - 0.75 * (1.0 - smoothstep(0.4 * aa, 1.4 * aa, hy));
  col += C_BONE * 0.03 * (1.0 - smoothstep(0.0, 1.6 * aa, lp.y));
  float r = min(sz.x, sz.y) * 0.05;
  float d = sdBox(lp - sz * 0.5, sz * 0.5 - r) - r;
  m = 1.0 - smoothstep(-0.6 * aa, 0.6 * aa, d);
  return col;
}

void main() {
  vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  float dist;
  vec2 p = planeAt(sp, dist);
  float aa = max(length(fwidth(p)), 0.6);
  float dof = clamp(abs(dist - uFocus) / uFocus * 7.0, 0.0, 2.0);
  aa *= 1.0 + dof;

  // 大廳：看板外面是很暗的空間，看板的光往外暈一點
  vec2 bc = (uBoard.xy + uBoard.zw) * 0.5, bh = (uBoard.zw - uBoard.xy) * 0.5;
  float db = sdBox(p - bc, bh);
  vec3 col = C_INK * 0.55 + (C_INK2 - C_INK) * 0.9 * exp(-max(db, 0.0) / 260.0);
  // 看板面：暖黑、極淡的橫向髮絲紋，下緣暗一點
  float mb = 1.0 - smoothstep(-aa, aa, db);
  vec3 board = C_INK + (C_INK2 - C_INK) * (0.75 + 0.2 * snoise(vec2(p.x * 0.003, p.y * 0.7)));
  board *= 1.0 - 0.25 * smoothstep(uBoard.y, uBoard.w, p.y);
  board += C_BONE * 0.04 * (1.0 - smoothstep(0.0, 2.0 * aa, abs(p.y - uBoard.y - 1.0)));
  col = mix(col, board, mb);

  for (int g = 0; g < ${NG}; g++) {
    if (g >= uNG) break;
    vec4 G = uG[g], S = uGS[g], X = uGX[g];
    if (S.w < 0.5) continue;
    vec2 q = p - G.xy;
    float w = (S.z - 1.0) * G.z + S.x;
    // 字牌的軌道：每一列後面一條更暗的長條
    float ry = floor(q.y / G.w);
    float ly = q.y - ry * G.w;
    float pad = S.y * 0.08;
    if (X.w > 0.5 && q.x > -pad && q.x < w + pad && ry >= 0.0 && ry < S.w && ly > -pad && ly < S.y + pad) {
      float rd = sdBox(vec2(q.x - w * 0.5, ly - S.y * 0.5), vec2(w * 0.5 + pad, S.y * 0.5 + pad * 0.7));
      col = mix(col, C_INK * 0.5, (1.0 - smoothstep(-aa, aa, rd)) * 0.9);
    }
    vec2 ci = floor(q / G.zw);
    if (ci.x < 0.0 || ci.y < 0.0 || ci.x >= S.z || ci.y >= S.w) continue;
    vec2 lp = q - ci * G.zw;
    if (lp.x > S.x + aa || lp.y > S.y + aa) continue;
    vec4 st = texelFetch(uState, ivec2(int(ci.x), int(X.x + ci.y)), 0);
    if (st.x < -1.5) continue;
    float m;
    vec3 cc = flapCard(lp, S.xy, st, X.y, X.z, aa, dof * 1.2, m);
    col = mix(col, cc, m);
  }

  // 小字標籤（低對比）
  vec2 lu = (p - uLabR.xy) / uLabR.zw;
  if (lu.x > 0.0 && lu.x < 1.0 && lu.y > 0.0 && lu.y < 1.0) {
    float l = texture(uLab, vec2(lu.x, 1.0 - lu.y)).a;
    col = mix(col, C_ASH * 0.55, l);
  }

  // 狀態燈
  if (uLamp.z > 0.0) {
    float d = length(p - uLamp.xy) - uLamp.z;
    float lm = 1.0 - smoothstep(-aa, aa, d);
    col = mix(col, mix(C_BLOOD * 0.12, C_SIGNAL * 2.0, uLamp.w), lm);
    col += C_SIGNAL * 0.2 * uLamp.w * exp(-max(d, 0.0) / 8.0);
  }
  col *= (1.0 + 0.03 * uKick) * uIn;
  fragColor = vec4(col, 1.0);
}`;
