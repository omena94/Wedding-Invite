// 三面翻看板（trivision）的街景（v2：看板縮小免得留言板太突兀，空出來的地方補上會動的街景）：
// 看板縮到畫面右上角之後，其他地方是一條夜裡的街——全部是全螢幕 shader（螢幕座標，y 向下），看板的 3D 疊在中間：
//  - STREET（最底層）：夜空與薄雲、遠方一排建築（窗戶一格一格亮著，有幾扇每兩拍換一次）、對面的人行道與兩盞路燈、
//    濕的柏油路面（路燈、看板、窗戶的光在路上拉成長長的倒影）、中間的分向線。
//  - CARS（蓋在看板的 3D 上面：車在看板前面的馬路上開過）：兩個車道，遠的往左、近的往右；車身是剪影，
//    車頭燈（白、會發光）往前照一片光、車尾燈（訊號色的暗部），濕路面上有燈的倒影。
//    每一台車經過畫面中央的那一刻落在小節線或第三拍上（時間表在主檔排，這裡只照著畫）。
import { H } from '../engine/gl';

/** 對面人行道的上緣（遠方建築的底）、路面從哪裡開始（螢幕 y，向下）。看板的柱子立在人行道上。 */
export const HOR = 676, CURB = 712;
/** 兩個車道的車輪著地線（螢幕 y）。 */
export const FAR_B = 770, NEAR_B = 972;
/** 路燈（螢幕座標）：燈頭的位置。 */
export const LAMP_POSTS: [number, number][] = [[210, 372], [700, 398]];
/** 一次最多排幾台車（uniform 陣列的大小）。 */
export const MAX_CARS = 14;

export const STREET_FRAG = /* glsl */ `
uniform float par;       // 鏡頭的水平位置（遠景視差）
uniform float uT;
uniform float beatI;     // 現在是第幾拍（窗戶每兩拍換一次）
uniform vec4 boardR;     // 看板在螢幕上的範圍（x0, y0, x1, y1）：路面上的倒影
uniform float lampK;     // 路燈的亮度（大鼓時稍微閃一下）
const float HOR = ${HOR}.0, CURB = ${CURB}.0;
const vec2 L1 = vec2(${LAMP_POSTS[0]![0]}.0, ${LAMP_POSTS[0]![1]}.0), L2 = vec2(${LAMP_POSTS[1]![0]}.0, ${LAMP_POSTS[1]![1]}.0);

// 一盞路燈：燈柱、往右伸的燈臂、燈頭（發光）、燈下一錐淡淡的光、照在人行道上的一圈光
vec3 lamp(vec2 q, vec2 L, vec3 col) {
  vec3 add = vec3(0.0);
  float pole = (1.0 - smoothstep(2.0, 3.5, abs(q.x - L.x + 26.0))) * step(L.y - 6.0, q.y) * step(q.y, HOR + 8.0);
  float arm = (1.0 - smoothstep(1.5, 3.0, abs(q.y - L.y + 4.0 + 0.08 * (q.x - L.x)))) * step(L.x - 26.0, q.x) * step(q.x, L.x + 4.0);
  float body = max(pole, arm);
  add -= col * body * 0.85;
  vec3 warm = mix(C_EMBER, C_BONE, 0.45);
  float head = exp(-dot((q - L) / vec2(14.0, 5.0), (q - L) / vec2(14.0, 5.0)));
  add += warm * lampK * (2.4 * head + 0.35 * exp(-length(q - L) / 38.0));
  // 燈下的光錐（往下越來越寬、越淡）
  float dy = q.y - L.y;
  if (dy > 0.0 && q.y < CURB + 4.0) {
    float w = 12.0 + dy * 0.42;
    add += warm * lampK * 0.05 * exp(-pow((q.x - L.x) / w, 2.0)) * exp(-dy / 420.0);
  }
  // 人行道上的一圈光
  add += warm * lampK * 0.08 * exp(-pow((q.x - L.x) / 120.0, 2.0)) * step(HOR, q.y) * step(q.y, CURB);
  return add;
}

void main() {
  vec2 p = FRAG_PX;
  vec2 q = vec2(p.x, ${H}.0 - p.y);
  // ---- 夜空：上面最暗，接近地平線帶一點城市的暖光；很淡的雲慢慢飄
  vec3 col = mix(C_INK2 * 1.25 + C_BLOOD * 0.05, C_INK, smoothstep(0.02, 0.85, p.y / ${H}.0 + 0.3));
  col += C_SIGNAL * 0.05 * exp(-max(0.0, HOR - q.y) / 170.0) + C_BLOOD * 0.04 * exp(-max(0.0, HOR - q.y) / 420.0);
  col += C_INK2 * 0.35 * smoothstep(0.1, 0.7, fbm(vec2(q.x / 900.0 + par * 0.0002 + uT * 0.004, q.y / 300.0), 3)) * smoothstep(620.0, 120.0, q.y);

  // ---- 遠方的建築（站在 HOR 上，跟著鏡頭慢一點地移）：焦點在看板上，所以建築是失焦的——輪廓軟、窗戶是一團團小光；
  //      有幾扇窗每兩拍換一次亮暗（遠方的人家在開燈關燈）
  float x = q.x + par * 0.12;
  float bx = floor(x / 76.0);
  float hgt = 60.0 + 240.0 * hash11(bx * 1.37 + 3.0) * (0.55 + 0.45 * sin(bx * 0.23 + 1.0));
  float bld = smoothstep(HOR - hgt - 4.0, HOR - hgt + 4.0, q.y) * step(q.y, HOR);
  col = mix(col, C_INK * 0.9 + C_INK2 * 0.3, bld * 0.92);
  vec2 cell = vec2(floor(x / 16.0), floor((HOR - q.y) / 22.0));
  vec2 wc = vec2(fract(x / 16.0), fract((HOR - q.y) / 22.0)) - 0.5;
  float shape = exp(-dot(wc * vec2(1.0, 1.3), wc * vec2(1.0, 1.3)) * 22.0);
  float on = step(0.8, hash12(cell));
  float flipper = step(0.94, hash12(cell + 7.7));
  on = abs(on - flipper * mod(floor(beatI * 0.5 + hash12(cell + 3.1) * 4.0), 2.0));
  float winTone = hash12(cell + 1.3);
  col += mix(mix(C_EMBER, C_BONE, 0.5), C_SIGNAL, 0.35 * winTone) * 0.11 * shape * on * bld * step(12.0, q.y - (HOR - hgt));

  // ---- 對面的人行道
  if (q.y > HOR && q.y < CURB) col = mix(C_INK * 0.8 + C_INK2 * 0.3, C_INK2 * 0.85, smoothstep(HOR, CURB, q.y));
  // 路緣石：一條亮一點的線
  col += C_GRAPHITE * 0.12 * (1.0 - smoothstep(0.0, 2.0, abs(q.y - CURB)));

  // ---- 路面：濕的柏油，映著燈、看板、窗戶的光（往下拉長的倒影）
  if (q.y > CURB) {
    float d = q.y - CURB;
    float n = snoise(q / vec2(3.0, 1.5));
    vec3 road = C_INK * (0.7 + 0.14 * n) + C_INK2 * 0.12;
    // 濕的地方（水窪）倒影比較清楚；路面本身不變亮，免得看起來像一片水
    float wet = smoothstep(-0.1, 0.45, fbm(q / vec2(300.0, 55.0) + 3.0, 2));
    vec3 warm = mix(C_EMBER, C_BONE, 0.45);
    float refl = 0.0;
    refl += exp(-pow((q.x - L1.x) / 20.0, 2.0)) + exp(-pow((q.x - L2.x) / 20.0, 2.0));
    road += warm * lampK * 0.32 * refl * exp(-d / 240.0) * (0.35 + 0.65 * wet);
    // 看板（亮的紙面）在路上的倒影
    float bm = smoothstep(boardR.x, boardR.x + 60.0, q.x) * (1.0 - smoothstep(boardR.z - 60.0, boardR.z, q.x));
    road += mix(C_PAPER, C_EMBER, 0.2) * 0.022 * bm * exp(-d / 130.0);
    // 窗戶的光糊成一片
    road += mix(C_EMBER, C_SIGNAL, 0.4) * 0.012 * (0.6 + 0.4 * snoise(vec2(q.x / 30.0, 1.7))) * exp(-d / 90.0) * wet;
    // 分向線：兩車道中間一條虛線
    float mid = ${((FAR_B + NEAR_B) / 2 + 16).toFixed(1)};
    float dash = step(fract((q.x + par * 0.5) / 170.0), 0.55) * (1.0 - smoothstep(1.5, 3.0, abs(q.y - mid)));
    road += C_BONE * 0.07 * dash;
    col = road;
  }
  // ---- 路燈
  col += lamp(q, L1, col) + lamp(q, L2, col);
  fragColor = vec4(col, 1.0);
}`;

export const CARS_FRAG = /* glsl */ `
uniform vec4 cars[${MAX_CARS}];  // 每台：經過畫面中央的時間、車道（0 遠、1 近）、速度（px/秒）、種子
uniform float nCars;
uniform float uT;
const float FAR_B = ${FAR_B}.0, NEAR_B = ${NEAR_B}.0;
// 車的剪影（q：沿著車身 0..L、車輪著地往上 0..Hh；車頭朝 +x）
// 轎車的側面：低低的車身（車頭略低）、前擋風玻璃斜、後擋風玻璃也斜的車廂、兩個輪子
float carD(vec2 q, float L, float Hh) {
  float body = sdBox(q - vec2(0.5 * L, 0.33 * Hh), vec2(0.5 * L - 0.06 * Hh, 0.16 * Hh)) - 0.07 * Hh;
  body = max(body, q.y - (0.56 * Hh - 0.1 * Hh * smoothstep(0.7 * L, L, q.x)));
  float u = clamp((q.y - 0.5 * Hh) / (0.42 * Hh), 0.0, 1.0);
  float xl = mix(0.2 * L, 0.36 * L, u), xr = mix(0.76 * L, 0.6 * L, u);
  float cab = max(max(xl - q.x, q.x - xr), max(0.46 * Hh - q.y, q.y - 0.92 * Hh));
  float w1 = length(q - vec2(0.2 * L, 0.16 * Hh)) - 0.16 * Hh;
  float w2 = length(q - vec2(0.8 * L, 0.16 * Hh)) - 0.16 * Hh;
  return min(min(body, cab), min(w1, w2));
}
void main() {
  vec2 p = FRAG_PX;
  float sx = p.x, sy = ${H}.0 - p.y;
  vec3 acc = vec3(0.0);
  float al = 0.0;
  vec3 warm = mix(C_BONE, C_EMBER, 0.25);
  for (int lane = 0; lane < 2; lane++) {
    for (int i = 0; i < ${MAX_CARS}; i++) {
      if (float(i) >= nCars) break;
      vec4 c = cars[i];
      if (int(c.y + 0.5) != lane) continue;
      float near = c.y;
      float sc = mix(0.6, 1.0, near);
      float L = 380.0 * sc, Hh = 112.0 * sc;
      float dir = near > 0.5 ? 1.0 : -1.0;
      float yb = mix(FAR_B, NEAR_B, near);
      float xc = 960.0 + dir * c.z * (uT - c.x);
      float dx = (sx - xc) * dir;
      if (dx < -0.5 * L - 60.0 * sc || dx > 0.5 * L + 620.0 * sc) continue;
      if (sy < yb - Hh - 40.0 * sc || sy > yb + 240.0 * sc) continue;
      vec2 q = vec2(dx + 0.5 * L, yb - sy);
      vec2 hl = vec2(L - 6.0 * sc, 0.34 * Hh), tl = vec2(6.0 * sc, 0.36 * Hh);
      // 車頭燈往前照：一錐很淡的光，照在前面的路上一片
      if (q.x > L) {
        // 光錐很窄、往前慢慢淡掉，到外框之前就淡到 0（外框切掉的地方不會有一條硬邊）
        float fx = q.x - L;
        float w = 5.0 * sc + 0.07 * fx;
        float fade = 1.0 - smoothstep(0.45, 0.95, fx / (620.0 * sc));
        acc += warm * 0.07 * exp(-fx / (300.0 * sc)) * exp(-pow((q.y - hl.y + 0.05 * fx) / w, 2.0)) * fade;
        acc += warm * 0.16 * exp(-fx / (220.0 * sc)) * exp(-abs(q.y + 3.0 * sc) / (6.0 * sc)) * fade;
      }
      // 車身（剪影，頂上被路燈照亮一點）、車窗
      float d = carD(q, L, Hh);
      float a = 1.0 - smoothstep(-1.0, 1.0, d);
      if (a > 0.0) {
        vec3 bodyCol = C_INK * 1.1 + C_INK2 * 0.35;
        // 肩線被路燈照出一條細細的亮邊；輪子更暗
        bodyCol += C_ASH * 0.09 * (1.0 - smoothstep(0.0, 3.0 * sc, abs(q.y - 0.5 * Hh))) * step(0.04 * L, q.x) * step(q.x, 0.96 * L);
        float wheel = step(min(length(q - vec2(0.2 * L, 0.16 * Hh)), length(q - vec2(0.8 * L, 0.16 * Hh))), 0.16 * Hh);
        bodyCol = mix(bodyCol, C_INK * 0.6, wheel);
        float uu = clamp((q.y - 0.54 * Hh) / (0.34 * Hh), 0.0, 1.0);
        float glass = step(0.54 * Hh, q.y) * step(q.y, 0.87 * Hh) * step(mix(0.24 * L, 0.38 * L, uu), q.x) * step(q.x, mix(0.72 * L, 0.58 * L, uu)) * step(4.0 * sc, abs(q.x - 0.49 * L));
        // 車窗：比車身暗一點、斜斜一道路燈的反光（窗戶是暗的，車廂的輪廓才看得出來）
        float streak = 1.0 - smoothstep(0.0, 6.0 * sc, abs(q.x - 0.6 * L + 0.8 * (q.y - 0.7 * Hh)));
        bodyCol = mix(bodyCol, C_INK * 0.7 + C_ASH * 0.05 * streak, glass * 0.9);
        // 車頂的一條亮邊
        bodyCol += C_ASH * 0.07 * (1.0 - smoothstep(0.0, 2.5 * sc, abs(q.y - 0.9 * Hh))) * step(0.36 * L, q.x) * step(q.x, 0.6 * L);
        acc = acc * (1.0 - a) + bodyCol * a;
        al = al * (1.0 - a) + a;
      }
      // 車燈：車頭（白、發光）、車尾（訊號色的暗部）
      vec2 hd = (q - hl) / vec2(1.0, 0.65), td = (q - tl) / vec2(1.0, 0.65);
      acc += warm * (3.0 * exp(-dot(hd, hd) / (30.0 * sc * sc)) + 0.3 * exp(-length(hd) / (34.0 * sc)));
      acc += mix(C_BLOOD, C_SIGNAL, 0.2) * (2.2 * exp(-dot(td, td) / (26.0 * sc * sc)) + 0.22 * exp(-length(td) / (26.0 * sc)));
      // 濕路面上的倒影：燈的正下方往下拉長
      if (q.y < 0.0) {
        acc += warm * 0.5 * exp(-pow((q.x - hl.x) / (9.0 * sc), 2.0)) * exp(q.y / (100.0 * sc));
        acc += mix(C_BLOOD, C_SIGNAL, 0.2) * 0.45 * exp(-pow((q.x - tl.x) / (9.0 * sc), 2.0)) * exp(q.y / (80.0 * sc));
      }
    }
  }
  fragColor = vec4(acc, al);
}`;
