// 里程表的 shader（照 pdoom ascent 的滾輪計數器 ascent-odo.ts 改的）：一整塊雕刻紋的金屬儀表板，鏡頭斜斜地看著它。
// 每個像素先從鏡頭射一條線打到儀表板上（平面 z = 0），拿到板子上的座標，再畫：板子（雕刻斜線、邊框的斜角）、
// 滾輪窗、滾輪（圓柱：用 asin 把窗裡的高度換成滾輪轉的角度，字貼在圓柱上、兩邊壓扁變暗）、滾輪之間的滾花邊、
// 銘牌（留言刻在上面；剛刻好的字燒紅，冷卻成墨色）、絹印的標籤。
import { H } from '../engine/gl';
import { GLYPH_GLSL, CODE_GLSL } from './_t7';

export const NB = 4;

export const FRAG_ODO = /* glsl */ `
uniform sampler2D uState;   // 每個滾輪兩個 texel：(第 k-1、k、k+1、k+2 格的字)、(位置、色碼、模糊、反色)
uniform sampler2D uAtlas;
uniform vec2 uAG;
uniform sampler2D uLab;     // 絹印標籤（R）
uniform vec4 uLabR;         // 標籤圖層在板子上的範圍
uniform sampler2D uPlate;   // 銘牌上的字（G = 刻好的字，B = 還在燙的字）
uniform vec4 uPlateR;       // 銘牌範圍
uniform vec4 uBA[${NB}];    // 滾輪組：x0, 中心 y, 間距, 輪面寬
uniform vec4 uBB[${NB}];    // 半徑, 每格的角度, 窗的半高, 滾輪數
uniform vec4 uBC[${NB}];    // 在 state 裡的起點, 字寬（px）, 0, 0
uniform vec4 uPanel;        // 板子範圍 x0, y0, x1, y1
uniform vec3 uCP;           // 鏡頭位置
uniform mat3 uCR;           // 鏡頭的軸（右、上、後）
uniform float uF;           // 焦距（px）
uniform float uFocus;       // 對焦距離
uniform float uSheen;       // 掃過板子的反光（x）
uniform float uIn;
uniform float uKick;
${GLYPH_GLSL}
${CODE_GLSL}

vec2 planeAt(vec2 sp, out float dist) {
  vec3 dir = normalize(uCR * vec3(sp.x - 960.0, 540.0 - sp.y, -uF));
  float tt = -uCP.z / dir.z;
  vec3 w = uCP + dir * tt;
  dist = tt;
  return vec2(w.x + 960.0, 540.0 - w.y);
}

void main() {
  vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  float dist;
  vec2 q = planeAt(sp, dist);
  float aa = max(length(fwidth(q)), 0.5);
  // 景深：離對焦距離越遠越糊（只糊字與細節，輪廓用 aa 放寬一點）
  float dof = clamp(abs(dist - uFocus) / uFocus * 9.0, 0.0, 2.2);
  aa *= 1.0 + dof * 0.8;

  // 背景：板子外面是暗的桌面
  vec3 col = C_INK * (0.8 + 0.2 * fbm(q / 500.0, 3));
  // 板子：深色金屬，細斜線雕刻，受光從左上來
  vec2 pc = (uPanel.xy + uPanel.zw) * 0.5, ph = (uPanel.zw - uPanel.xy) * 0.5;
  float dp = sdBox(q - pc, ph - 24.0) - 24.0;
  float mp = 1.0 - smoothstep(-aa, aa, dp);
  float lightG = 1.0 - 0.35 * clamp((q.x - uPanel.x) / (ph.x * 2.0), 0.0, 1.0) - 0.25 * clamp((q.y - uPanel.y) / (ph.y * 2.0), 0.0, 1.0);
  float eng = hatch((q.x * 0.42 + q.y) / 5.0, 0.16 + 0.08 * snoise(q * 0.004));
  vec3 plate = (C_INK2 * 1.5 + C_GRAPHITE * 0.05) * lightG + C_GRAPHITE * 0.09 * eng;
  plate += C_BONE * 0.05 * exp(-pow((q.x + q.y * 0.35 - uSheen) / 140.0, 2.0));
  // 斜角：外緣一圈亮邊、內一圈暗邊
  plate += C_BONE * 0.09 * (1.0 - smoothstep(0.0, 2.2 * aa, abs(dp + 1.0))) * step(q.y, pc.y + ph.y * 0.3);
  plate *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 14.0, -dp)) * step(pc.y, q.y);
  col = mix(col, plate, mp);
  // 螺絲：四個角
  for (int i = 0; i < 4; i++) {
    vec2 sc = vec2(i % 2 == 0 ? uPanel.x + 34.0 : uPanel.z - 34.0, i < 2 ? uPanel.y + 34.0 : uPanel.w - 34.0);
    float ds = length(q - sc) - 9.0;
    float ms = 1.0 - smoothstep(-aa, aa, ds);
    vec3 scol = C_GRAPHITE * (0.5 + 0.4 * (sc.y - q.y) / 9.0);
    float slot = 1.0 - smoothstep(0.0, aa * 1.5, abs(dot(q - sc, normalize(vec2(1.0, 0.6)))) - 1.2);
    col = mix(col, scol * (1.0 - 0.7 * slot), ms * mp);
  }

  // 絹印標籤
  vec2 lu = (q - uLabR.xy) / uLabR.zw;
  if (lu.x > 0.0 && lu.x < 1.0 && lu.y > 0.0 && lu.y < 1.0) {
    float l = texture(uLab, vec2(lu.x, 1.0 - lu.y), dof * 0.8).r;
    col = mix(col, C_BONE * 0.62, l * mp);
  }

  // 銘牌：主題色的金屬（訊號色的暗部），刻字填墨；剛刻好的字燒紅
  vec2 pu = (q - uPlateR.xy) / uPlateR.zw;
  {
    vec2 c2 = uPlateR.xy + uPlateR.zw * 0.5;
    float d2 = sdBox(q - c2, uPlateR.zw * 0.5 - 10.0) - 10.0;
    float m2 = 1.0 - smoothstep(-aa, aa, d2);
    if (m2 > 0.0) {
      float brushed = 0.9 + 0.1 * snoise(vec2(q.x * 0.004, q.y * 0.6));
      // 主題色的金屬，但往灰色收一點（珊瑚、薰衣草的主題不要變成一塊鮮豔的塑膠板）
      vec3 metal = mix(mix(C_BLOOD, C_SIGNAL, 0.34), vec3(luma(mix(C_BLOOD, C_SIGNAL, 0.34))), 0.35);
      vec3 brass = metal * 0.5 * brushed * (1.08 - 0.3 * clamp(pu.y, 0.0, 1.0));
      brass += mix(C_BLOOD, C_SIGNAL, 0.5) * 0.12 * exp(-pow((q.x + q.y * 0.35 - uSheen) / 110.0, 2.0));
      brass += C_BONE * 0.07 * (1.0 - smoothstep(0.0, 2.0 * aa, abs(d2 + 2.0))) * step(q.y, c2.y);
      brass *= 1.0 - 0.4 * (1.0 - smoothstep(0.0, 8.0, -d2)) * step(c2.y, q.y);
      if (pu.x > 0.0 && pu.x < 1.0 && pu.y > 0.0 && pu.y < 1.0) {
        vec2 tuv = vec2(pu.x, 1.0 - pu.y);
        vec4 tx = texture(uPlate, tuv);
        // 刻痕：字裡面暗，字的正下方一條亮邊（光從上面來，刻痕的下壁被照亮）。亮邊畫在字外面，
        // 宋體很細的橫畫（「一」）才不會被亮邊吃掉
        float up = texture(uPlate, tuv + vec2(0.0, 2.0 / uPlateR.w)).g;
        float lip = clamp(up - tx.g, 0.0, 1.0);
        brass = mix(brass, C_INK * 0.25, tx.g * 0.96);
        brass += mix(C_BLOOD, C_SIGNAL, 0.5) * 0.35 * lip;
        brass = mix(brass, C_EMBER * 2.4, tx.b);
      }
      col = mix(col, brass, m2);
      // 銘牌的陰影（板子上）
    } else col *= 1.0 - 0.4 * (1.0 - smoothstep(0.0, 22.0, d2 - 6.0)) * step(c2.y - uPlateR.w * 0.3, q.y);
  }

  // 滾輪組
  for (int b = 0; b < ${NB}; b++) {
    vec4 A = uBA[b], B = uBB[b], C = uBC[b];
    float n = B.w;
    if (n < 0.5) continue;
    float w = n * A.z;
    vec2 wc = vec2(A.x + w * 0.5 - (A.z - A.w) * 0.5, A.y);
    vec2 wh = vec2(w * 0.5 + 10.0, B.z + 10.0);
    float dw = sdBox(q - wc, wh - 10.0) - 10.0;
    // 窗外一圈斜角
    col += C_BONE * 0.08 * (1.0 - smoothstep(0.0, 2.0 * aa, abs(dw - 3.0))) * step(A.y, q.y);
    col *= 1.0 - 0.4 * (1.0 - smoothstep(0.0, 3.0 * aa, abs(dw - 3.0))) * step(q.y, A.y);
    if (dw > 0.0) continue;
    float lx = q.x - (A.x - (A.z - A.w) * 0.5);
    float j = floor(lx / A.z);
    if (j < 0.0 || j >= n) { col = C_INK * 0.4; continue; }
    float fx = lx - j * A.z - A.z * 0.5;   // 輪面中心為 0
    float yy = clamp((q.y - A.y) / B.x, -0.999, 0.999);
    float th = asin(yy), cth = cos(th);
    float shade = mix(0.16, 1.0, pow(cth, 1.3));
    int si = int(C.x + j);
    vec4 G = texelFetch(uState, ivec2(si, 0), 0);
    vec4 S = texelFetch(uState, ivec2(si, 1), 0);
    vec3 c;
    if (abs(fx) < A.w * 0.5) {
      float pos = S.x, k = floor(pos);
      float u = 0.5 + fx / C.y;
      float ink = 0.0;
      int NS = S.z > 0.04 ? 7 : 1;
      for (int s = 0; s < 7; s++) {
        if (s >= NS) break;
        float o = NS == 1 ? 0.0 : (float(s) / 6.0 - 0.5) * min(S.z, 3.0);
        float d = pos + o + th / B.y;
        float cell = floor(d + 0.5);
        float v = fract(d + 0.5);
        float ix = cell - (k - 1.0);
        float gi = ix < 0.5 ? G.x : ix < 1.5 ? G.y : ix < 2.5 ? G.z : ix < 3.5 ? G.w : -1.0;
        // 路過的亂數字（字號 +10000）畫暗的：只有停在窗中間的那一格是要讀的字
        float dim = 1.0;
        if (gi > 9999.5) { gi -= 10000.0; dim = 0.28; }
        ink += glyphAtBias(gi, vec2(u, v), dof) * dim;
      }
      ink /= float(NS);
      bool inv = S.w > 0.5;
      // 輪面：黑色（反色的那一格是紙白，像真的里程表最右邊那一格）
      vec3 faceCol = inv ? C_BONE * 0.8 : C_INK2 * 1.7 + C_GRAPHITE * 0.04;
      // 圓柱的緯線（越靠上下越密），讓它看起來是圓的
      float lat = hatch(th * 22.0, clamp((1.0 - cth) * 2.2 - 0.15, 0.0, 1.0));
      faceCol *= 1.0 - 0.5 * lat;
      faceCol += C_BONE * 0.12 * exp(-pow((q.x + q.y * 0.35 - uSheen) / 90.0, 2.0)) * pow(cth, 8.0);
      vec3 inkCol = inv ? C_INK * 0.5 : codeCol(S.y);
      c = mix(faceCol * shade, inkCol * mix(1.0, shade, 0.5), ink);
    } else {
      // 滾輪之間的滾花邊
      float rim = hatch((q.y + th * 2.0) / 3.0, 0.45);
      c = (C_INK2 + C_GRAPHITE * 0.25 * rim) * shade;
    }
    // 窗的上緣投下的影子
    c *= mix(0.3, 1.0, smoothstep(-B.z, -B.z + 26.0, q.y - A.y)) * mix(0.55, 1.0, smoothstep(B.z, B.z - 16.0, q.y - A.y));
    col = c;
  }
  // 大鼓：整塊板子很淡地亮一下（機械「喀」一聲）
  col *= (1.0 + 0.06 * uKick) * uIn;
  fragColor = vec4(col, 1.0);
}`;
