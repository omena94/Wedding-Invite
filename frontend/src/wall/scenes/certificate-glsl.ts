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
//  - MV 融合原則（像電影、紙在空間裡）：紙是擺在暗色桌面上的一張實物（全景時看得到紙緣與陰影）；
//    一盞固定在桌上的燈打在紙上（中間亮、往外慢慢暗，鏡頭移動時光斑跟著紙走，不跟著畫面）；
//    推近時是微距鏡頭的淺景深：畫面上下緣的墨慢慢糊掉（tilt-shift），焦點在中間那一帶（正在打的字、歌詞）。
//  - 印好的表格（formTex）不再每格 drawImage 進墨的畫布（那一下要好幾毫秒），而是開場上傳一次、在這裡直接用紙面座標取樣
//    （有 mipmap：全景時細線不會閃；一律用 textureLod，確定性）。
import { W, H } from '../engine/gl';
import { L } from './certificate-form';

/** 印好的表格畫布涵蓋的紙面範圍與解析度（主檔畫表格、這裡取樣都用它）。 */
export const FORM_BOX = { x: 60, y: 80, w: 1720, h: 930 }, FORM_RES = 1.5;

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

const S = L.sheet;
const f1 = (v: number) => v.toFixed(1);

export const PAPER_FRAG = /* glsl */ `
uniform sampler2D inkTex;
uniform sampler2D roseTex;
uniform sampler2D bakeTex;
uniform sampler2D formTex;                 // 印好的表格（G 色版），紙面座標
uniform float roseOn;
uniform vec3 camA; uniform vec3 camB;     // 螢幕像素（y 向下）→ 紙面座標
uniform vec2 blurV;                        // 鏡頭甩動時的動態模糊（螢幕像素）
uniform float dofR;                        // 淺景深：畫面上下緣最糊的半徑（螢幕像素；全景是 0）
uniform vec4 st0; uniform vec4 st0b;       // 方章（訊號色）：中心 xy、半寬高 | 角度、力道、種子、-

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

float formAt(vec2 p, float lod) {
  vec2 uv = vec2((p.x - ${FORM_BOX.x}.0) / ${FORM_BOX.w}.0, 1.0 - (p.y - ${FORM_BOX.y}.0) / ${FORM_BOX.h}.0);
  return textureLod(formTex, uv, lod).g;
}

void main() {
  vec2 sp = vec2(vUv.x * ${W}.0, (1.0 - vUv.y) * ${H}.0);
  vec2 pp = vec2(dot(camA, vec3(sp, 1.0)), dot(camB, vec3(sp, 1.0)));
  // 一個螢幕像素是幾個紙面像素（鏡頭推近時小於 1）
  float ppx = length(vec2(camA.x, camB.x));
  // 螢幕位移（像素，y 向下）→ 紙面位移
  mat2 s2p = mat2(camA.x, camB.x, camA.y, camB.y);
  float flod = max(0.0, log2(${FORM_RES.toFixed(2)} * ppx));
  vec4 bk = texture(bakeTex, vec2((pp.x - ${BAKE.x}.0) / ${BAKE.w}.0, 1.0 - (pp.y - ${BAKE.y}.0) / ${BAKE.h}.0));

  // ---- 淺景深：離畫面中線越遠越糊（推近時才有，全景 dofR = 0）
  float dr = dofR * smoothstep(300.0, 600.0, abs(sp.y - ${H / 2}.0));

  // ---- 紙與桌面
  vec2 sc = vec2(${f1((S.x0 + S.x1) / 2)}, ${f1((S.y0 + S.y1) / 2)}), sh = vec2(${f1((S.x1 - S.x0) / 2)}, ${f1((S.y1 - S.y0) / 2)});
  float sd = sdBox(pp - sc, sh);
  float aw = max(fwidth(sd), 1e-3) + dr * ppx * 0.8;
  float onSheet = 1.0 - smoothstep(-aw, aw, sd);
  // 桌燈：固定在桌上（紙面座標），中間亮、往外慢慢暗；桌面離燈遠的地方暗得更快
  float ld = length((pp - vec2(860.0, 560.0)) * vec2(1.0, 1.2));
  float lamp = 1.0 - 0.17 * smoothstep(220.0, 1250.0, ld);
  float deskLamp = 0.42 + 0.58 * (1.0 - smoothstep(500.0, 1500.0, ld));
  // 桌面：暗、帶一點紙墨的暖色，紙的陰影往右下落
  float sdS = sdBox(pp - sc - vec2(12.0, 18.0), sh);
  float shadow = exp(-max(sdS, 0.0) / 30.0);
  vec3 desk = mix(C_INK, C_SEPIA, 0.22) * (0.85 + 0.3 * bk.r) * deskLamp * (1.0 - 0.6 * shadow);

  // ---- 紙（淺景深的地方纖維也跟著柔掉一點）
  float grain = mix(bk.r, 0.5, sat(dr / 6.0) * 0.6);
  vec3 paper = C_PAPER * (0.8 + 0.4 * grain) * lamp;
  // 斜斜打過來的光：左上亮一點
  paper *= 0.975 + 0.03 * (vUv.y * 0.6 + (1.0 - vUv.x) * 0.4);

  // ---- 墨（鏡頭甩動時沿 blurV 模糊；推近時上下緣是淺景深的糊）
  vec4 ink = vec4(0.0);
  float rose = 0.0, form = 0.0;
  float bl = length(blurV);
  vec2 texel = vec2(1.0 / ${W}.0, 1.0 / ${H}.0);
  if (bl > 1.0) {
    const int N = 24;
    float j = hash12(sp);
    for (int i = 0; i < N; i++) {
      float k = (float(i) + j) / float(N) - 0.5;
      vec2 uv = vUv + vec2(blurV.x, -blurV.y) * k * texel;
      ink += texture(inkTex, uv);
      form += formAt(pp + s2p * (blurV * k), flod);
      if (roseOn > 0.5) rose += texture(roseTex, uv).r;
    }
    form /= float(N);
    ink /= float(N);
    rose /= float(N);
  } else if (dr > 0.8) {
    // 黃金角螺旋取 10 點（圓盤），比方形取樣的糊自然
    const int N = 10;
    float a0 = hash12(sp) * TAU;
    for (int i = 0; i < N; i++) {
      float fi = float(i) + 0.5;
      float a = a0 + fi * 2.39996;
      vec2 o = vec2(cos(a), -sin(a)) * dr * sqrt(fi / float(N));
      vec2 uv = vUv + o * texel;
      ink += texture(inkTex, uv);
      form += formAt(pp + s2p * vec2(o.x, -o.y), flod);
      if (roseOn > 0.5) rose += texture(roseTex, uv).r;
    }
    form /= float(N);
    ink /= float(N);
    rose /= float(N);
  } else {
    ink = texture(inkTex, vUv);
    form = formAt(pp, flod);
    if (roseOn > 0.5) rose = texture(roseTex, vUv).r;
  }

  float sm0 = stampMask(pp, st0, st0b);
  // 印章邊緣：覆蓋率減掉附近的平均（邊上積墨）
  float edgeB = 0.0;
  if (sm0 > 0.0) {
    vec2 px = 3.0 * texel;
    vec4 b4 = (texture(inkTex, vUv + vec2(px.x, 0.0)) + texture(inkTex, vUv - vec2(px.x, 0.0)) + texture(inkTex, vUv + vec2(0.0, px.y)) + texture(inkTex, vUv - vec2(0.0, px.y))) * 0.25;
    edgeB = sat((ink.b - b4.b) * 2.0);
  }
  // 打字機的色帶：濃淡不均，紙纖維處吃墨少一點
  float dType = ink.r * (0.86 + 0.14 * bk.g) * (1.0 - 0.18 * bk.a);
  float dPrint = sat(ink.g + form);
  float dSig = ink.b * (0.9 + 0.2 * (bk.b - 0.5));
  if (sm0 > 0.0) dSig = stampInk(pp, ink.b, edgeB, st0b.z, st0b.y);

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

  // 活頁夾的打孔：看得到底下的桌面，下緣有一點亮邊
  {
    float hd = min(length(pp - vec2(${L.holeX}.0, ${L.holes[0]}.0)), length(pp - vec2(${L.holeX}.0, ${L.holes[1]}.0))) - 17.0;
    float w = max(fwidth(hd), 1e-3);
    float inside = 1.0 - smoothstep(-w, w, hd);
    col = mix(col, desk * 0.8, inside);
    col *= 1.0 - 0.16 * (1.0 - smoothstep(0.0, 6.0, hd)) * (1.0 - inside);
  }
  // 紙緣一點點陰影（紙有厚度，邊上略暗）
  col *= 1.0 - 0.06 * (1.0 - smoothstep(-10.0, 0.0, sd));
  col = mix(desk, col, onSheet);
  // 鏡頭本身一點點暗角（桌燈已經做了大部分的明暗）
  vec2 dc = vUv - 0.5;
  col *= 1.0 - 0.1 * pow(length(dc * vec2(1.0, 0.85)) * 1.5, 2.6);
  fragColor = vec4(col, 1.0);
}`;
