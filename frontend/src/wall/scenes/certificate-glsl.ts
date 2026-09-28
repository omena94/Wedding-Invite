// 祝福登記表（certificate）的紙張 shader：把 Canvas2D 上「分色編碼」的墨（R = 打字機的墨、G = 印刷的表格、B = 訊號色的印泥）
// 印到程序生成的紙上。照 pdoom 的 bureau（FIG. 7）做法：紙纖維、雲紋、墨色濃淡、印章的缺墨與邊緣積墨，
// 墨用 Beer–Lambert 疊印（乘上穿透率），所以印章壓在字上時字還看得到，跟真的一樣。
// 婚禮版改的地方：
//  - 紙色、墨色一律用色票（C_PAPER、C_SEPIA、C_INK、C_SIGNAL、C_ROSE），每首歌換主題時整張紙跟著變。
//  - 訊號色在亮紙上常常太淡（香檳、鼠尾草）：印泥用「穿透率的次方」疊得比較濃，顏色會自然變飽和、讀得到，
//    而不是另外寫死一個紅色。
//  - 會場筆電多半是內顯：紙的紋理（纖維、雲紋、墨色濃淡的雜訊）跟時間無關，開場時先烤成一張紙面座標的貼圖
//    （BAKE_FRAG，只存「明暗倍率」不存顏色，換主題不用重烤），每格只要讀一次貼圖。
//  - 愛心另外一張貼圖（roseTex，只在打的字裡有 ♥ 時才用），用點綴色印上去。
import { W, H } from '../engine/gl';

/** 烤好的紙面範圍（紙面座標）：鏡頭最遠 z≈0.96、再加上震動，看得到的都在裡面。 */
export const BAKE = { x: -120, y: -120, w: 2200, h: 1340 };

/** 烤紙：r = 紙的明暗倍率（0.8 + r × 0.4）、g = 打字墨的濃淡、b = 印泥的濃淡、a = 纖維（吃墨少的地方）。 */
export const BAKE_FRAG = /* glsl */ `
float fibres(vec2 p, float cs) {
  float acc = 0.0;
  vec2 cell = floor(p / cs);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = cell + vec2(float(i), float(j));
    vec2 h = hash22(c);
    vec2 o = (c + h) * cs;
    float a = hash12(c + 7.1) * TAU;
    float L = cs * (0.3 + 1.1 * hash12(c + 3.3));
    vec2 d = vec2(cos(a), sin(a));
    float dist = sdSegment(p, o - d * L * 0.5, o + d * L * 0.5);
    float s = hash12(c + 9.9) - 0.5;
    acc += s * (1.0 - smoothstep(0.25, 1.3, dist));
  }
  return acc;
}
void main() {
  vec2 pp = vec2(${BAKE.x}.0 + vUv.x * ${BAKE.w}.0, ${BAKE.y}.0 + (1.0 - vUv.y) * ${BAKE.h}.0);
  float cloud = fbm(pp * 0.0021, 4);
  float mid = snoise(pp * 0.018);
  float fib = fibres(pp, 22.0) + 0.6 * fibres(pp * 1.7 + 31.0, 22.0);
  float speck = step(0.99965, hash12(floor(pp * 0.5)));
  float paper = (0.975 + 0.028 * cloud + 0.008 * mid + 0.05 * fib) * (1.0 - speck * 0.35);
  fragColor = vec4(sat((paper - 0.8) / 0.4), smoothstep(-0.5, 0.6, snoise(pp * 0.35)), 0.5 + 0.5 * snoise(pp * 0.25), sat(fib * 4.0));
}`;

export const PAPER_FRAG = /* glsl */ `
uniform sampler2D inkTex;
uniform sampler2D roseTex;
uniform sampler2D bakeTex;
uniform float roseOn;
uniform vec3 camA; uniform vec3 camB;     // 螢幕像素（y 向下）→ 紙面座標
uniform vec2 blurV;                        // 鏡頭甩動時的動態模糊（螢幕像素）
uniform vec4 st0; uniform vec4 st0b;       // 方章（訊號色）：中心 xy、半寬高 | 角度、力道、種子、-
uniform vec4 st1; uniform vec4 st1b;       // 核准章（印刷墨）

float stampMask(vec2 p, vec4 s, vec4 sb) {
  if (sb.y <= 0.0) return 0.0;
  vec2 q = rot2(-sb.x) * (p - s.xy);
  vec2 d = abs(q) - s.zw;
  return (d.x < 0.0 && d.y < 0.0) ? 1.0 : 0.0;
}
// 橡皮章的墨：缺墨的小洞、濃淡斑駁、邊緣積墨比較重（只在章的範圍裡算，面積小，留在每格即時算）
float stampInk(vec2 p, float cov, float edge, float seed, float strength) {
  float n = snoise(p * 0.07 + seed) * 0.45 + snoise(p * 0.23 + seed * 2.0) * 0.35 + snoise(p * 0.9 - seed) * 0.2;
  float press = smoothstep(-0.9, 0.3, snoise(p * 0.0045 + seed * 3.0));
  float voids = smoothstep(-0.58, -0.36, n + (strength - 1.0) * 0.8 + 0.25 * press);
  float mott = 0.72 + 0.28 * press;
  return sat(cov * voids * mott * 1.25 + edge * 0.5);
}

void main() {
  vec2 sp = vec2(vUv.x * ${W}.0, (1.0 - vUv.y) * ${H}.0);
  vec2 pp = vec2(dot(camA, vec3(sp, 1.0)), dot(camB, vec3(sp, 1.0)));
  vec4 bk = texture(bakeTex, vec2((pp.x - ${BAKE.x}.0) / ${BAKE.w}.0, 1.0 - (pp.y - ${BAKE.y}.0) / ${BAKE.h}.0));

  // ---- 紙
  vec3 paper = C_PAPER * (0.8 + 0.4 * bk.r);
  // 斜斜打過來的光：左上亮一點
  paper *= 0.97 + 0.035 * (vUv.y * 0.6 + (1.0 - vUv.x) * 0.4);

  // ---- 墨（鏡頭甩動時沿 blurV 模糊）
  vec4 ink = vec4(0.0);
  float rose = 0.0;
  float bl = length(blurV);
  if (bl > 1.0) {
    const int N = 24;
    float j = hash12(sp);
    for (int i = 0; i < N; i++) {
      float k = (float(i) + j) / float(N) - 0.5;
      vec2 uv = vUv + vec2(blurV.x, -blurV.y) * k / vec2(${W}.0, ${H}.0);
      ink += texture(inkTex, uv);
      if (roseOn > 0.5) rose += texture(roseTex, uv).r;
    }
    ink /= float(N);
    rose /= float(N);
  } else {
    ink = texture(inkTex, vUv);
    if (roseOn > 0.5) rose = texture(roseTex, vUv).r;
  }

  float sm0 = stampMask(pp, st0, st0b), sm1 = stampMask(pp, st1, st1b);
  // 印章邊緣：覆蓋率減掉附近的平均（邊上積墨）
  float edgeB = 0.0, edgeG = 0.0;
  if (sm0 + sm1 > 0.0) {
    vec2 px = vec2(3.0) / vec2(${W}.0, ${H}.0);
    vec4 b4 = (texture(inkTex, vUv + vec2(px.x, 0.0)) + texture(inkTex, vUv - vec2(px.x, 0.0)) + texture(inkTex, vUv + vec2(0.0, px.y)) + texture(inkTex, vUv - vec2(0.0, px.y))) * 0.25;
    edgeB = sat((ink.b - b4.b) * 2.0);
    edgeG = sat((ink.g - b4.g) * 2.0);
  }
  // 打字機的色帶：濃淡不均，紙纖維處吃墨少一點
  float dType = ink.r * (0.86 + 0.14 * bk.g) * (1.0 - 0.18 * bk.a);
  float dPrint = ink.g;
  float dSig = ink.b * (0.9 + 0.2 * (bk.b - 0.5));
  if (sm0 > 0.0) dSig = stampInk(pp, ink.b, edgeB, st0b.z, st0b.y);
  if (sm1 > 0.0) dPrint = stampInk(pp, ink.g, edgeG, st1b.z, st1b.y) * 0.9;

  // ---- 疊印：紙色 × 各色墨的穿透率
  vec3 col = paper;
  vec3 tSig = clamp(C_SIGNAL / C_PAPER, 0.004, 1.0);
  vec3 tPrint = clamp(C_SEPIA / C_PAPER, 0.004, 1.0);
  vec3 tType = clamp(mix(C_INK, C_SEPIA, 0.35) / C_PAPER, 0.004, 1.0);
  vec3 tRose = clamp(C_ROSE / C_PAPER, 0.004, 1.0);
  // 印泥：濃度拉到 2.6 次方，淡的訊號色（香檳、鼠尾草）在紙上也飽和、讀得到
  col *= pow(tSig, vec3(2.6 * sat(dSig)));
  col *= mix(vec3(1.0), tPrint, sat(dPrint));
  // 打字的墨：淡的地方（三成的預告字、字的邊緣）照覆蓋率混；濃的地方改用次方，
  // 深墨在線性空間混色時一點點濃淡差就會變成明顯的白點（像影印壞掉），次方的變化比較像色帶的濃淡
  float vT = sat(dType);
  col *= mix(vec3(1.0), pow(tType, vec3(max(vT, 0.6))), min(vT / 0.6, 1.0));
  col *= pow(tRose, vec3(1.5 * sat(rose)));

  // 活頁夾的打孔：看得到底下暗色的桌面，下緣有一點亮邊
  {
    float hd = min(length(pp - vec2(104.0, 330.0)), length(pp - vec2(104.0, 770.0))) - 17.0;
    float w = max(fwidth(hd), 1e-3);
    float inside = 1.0 - smoothstep(-w, w, hd);
    col = mix(col, C_INK * 0.6, inside);
    col *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 6.0, hd)) * (1.0 - inside);
  }
  // 紙面本身的一點暗角
  vec2 dc = vUv - 0.5;
  col *= 1.0 - 0.16 * pow(length(dc * vec2(1.0, 0.85)) * 1.5, 2.6);
  fragColor = vec4(col, 1.0);
}`;
