// 營火版面的全螢幕 shader（campfire.ts 用）：夜空與遠處的樹影、地面、火光、煙、火堆裡的柴與炭床、火舌，
// 以及前景那根劈開的圓木（平的剖面朝鏡頭，上面是縱切面的年輪）。
// 全部在一個 pass 裡：火焰是程序生成的（fbm 往上捲），每格都要重算，用 Canvas2D 畫不出這種質感、也太慢；
// fbm 只在火堆附近的方框裡算（效能：整個畫面算 fbm 會超過預算）。
// 座標：p 是邏輯像素、y 向下（跟 Canvas2D 一樣）。
import { H } from '../engine/gl';

/** 火堆底部的中心（螢幕座標）。右邊 x ≥ 1380 留給即時小卡：火在右半邊但不貼右緣。 */
export const FIRE = { x: 1090, y: 834 };
/** 前景的圓木長凳：上緣樹皮、平的剖面、下緣樹皮（y 範圍）與左右兩端（x）。 */
export const BENCH = { x0: 96, x1: 1336, top: 842, face0: 854, face1: 984, bottom: 998 };
/** 地平線（遠處樹影的腳）。 */
export const HORIZON = 640;
/** 火舌的數量（uniform 陣列的長度）。 */
export const TONGUES = 5;

export const FRAG_CAMPFIRE = /* glsl */ `
uniform float uT;
uniform float uLvl;     // 火勢（0 = 小火苗、1 = 正常、>1 = 竄高）
uniform float uIn;      // 進場
uniform float uHat;     // hi-hat：星星閃
uniform float uFlick;   // 火光的閃爍（CPU 算好，火光與地面一起閃）
uniform float uCool;    // 主題的訊號色離「火的顏色」多遠（0 = 暖色主題、1 = 綠／紫）：越冷混越多紙白
uniform vec4 uTg[${TONGUES}]; // 每條火舌：x 偏移、半寬、高度、相位

const vec2 FB = vec2(${FIRE.x.toFixed(1)}, ${FIRE.y.toFixed(1)});
const float HZ = ${HORIZON.toFixed(1)};
const vec4 BX = vec4(${BENCH.x0.toFixed(1)}, ${BENCH.x1.toFixed(1)}, ${BENCH.top.toFixed(1)}, ${BENCH.bottom.toFixed(1)});
const vec2 FACE = vec2(${BENCH.face0.toFixed(1)}, ${BENCH.face1.toFixed(1)});

// 火的顏色：heat() 色階（底色→暗部→訊號色→ember→白熱），再混三成紙白的暖度，
// 綠色、紫色主題的火才不會像鬼火（亮度照舊，只是色相收斂）
vec3 fireCol(float h) {
  vec3 c = heat(h);
  float l = luma(c);
  return mix(c, C_BONE * (l / max(luma(C_BONE), 1e-3)), mix(0.1, 0.42, uCool));
}

// 火堆裡的一根柴：膠囊，回傳距離（<0 在裡面）與沿著柴的座標
float logSD(vec2 p, vec2 a, vec2 b, float r, out float along) {
  vec2 pa = p - a, ba = b - a;
  float h = sat(dot(pa, ba) / dot(ba, ba));
  along = h * length(ba);
  return length(pa - ba * h) - r;
}

void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  float lvl = uLvl * uIn;
  float fl = uFlick;

  // ---- 熱浪（v2）：火的上方，空氣受熱讓後面的星星與樹影左右扭動（只影響背景，不影響火與前景）
  vec2 pb = p;
  {
    vec2 hq = vec2(p.x - FB.x, FB.y - p.y);
    float hz = exp(-hq.x * hq.x / (2.0 * 150.0 * 150.0)) * smoothstep(120.0, 360.0, hq.y) * (1.0 - smoothstep(560.0, 820.0, hq.y));
    pb.x += hz * uLvl * (4.5 * sin(p.y / 13.0 - uT * 9.0) + 2.5 * sin(p.y / 5.0 + uT * 13.0));
  }
  // ---- 夜空：底色往地平線稍微浮起來一點
  vec3 col = mix(C_INK, C_INK2, 0.35 + 0.65 * smoothstep(80.0, HZ, p.y));
  // 星星：很少很少，hi-hat 閃
  if (p.y < HZ - 90.0) {
    vec2 cell = floor(pb / 96.0);
    vec2 h2 = hash22(cell + 17.0);
    if (h2.x < 0.3) {
      vec2 sp = (cell + 0.2 + 0.6 * hash22(cell + 3.1)) * 96.0;
      float d = length(pb - sp);
      float tw = 0.55 + 0.45 * sin(uT * (1.3 + h2.y * 2.0) + h2.y * 40.0) + uHat * step(0.7, h2.y) * 1.2;
      col += C_BONE * (1.0 - smoothstep(0.4, 1.6, d)) * (0.18 + 0.3 * h2.y) * tw * uIn * smoothstep(40.0, 300.0, p.y);
    }
  }
  // 遠處的樹影：地平線上一排暗暗的輪廓（比天空再暗一點），火附近被照到一點點
  float tree = HZ - 46.0 - 70.0 * (0.5 + 0.5 * snoise(vec2(pb.x / 150.0, 2.7))) - 26.0 * snoise(vec2(pb.x / 38.0, 8.1));
  float inTree = smoothstep(tree - 1.0, tree + 1.0, p.y);
  vec3 treeCol = C_INK * 0.7 + C_SIGNAL * 0.018 * lvl * exp(-abs(p.x - FB.x) / 380.0);
  col = mix(col, treeCol, inTree);
  // 地面：地平線以下，偏暗的底色，帶一點點起伏的質感
  float ground = smoothstep(HZ - 1.0, HZ + 2.0, p.y);
  vec3 gcol = C_INK2 * (0.55 + 0.25 * (0.5 + 0.5 * snoise(p / vec2(90.0, 16.0))));
  col = mix(col, gcol, ground);

  // ---- 火光：空氣裡一團暖光、地面上一片光池、樹影被照到的邊（都跟著火勢與閃爍）
  // 火光的顏色：訊號色偏 ember、混一點紙白（冷色主題的火光才不會是綠的、紫的）
  vec3 lightC = mix(mix(C_SIGNAL, C_EMBER, 0.3), C_BONE, mix(0.15, 0.38, uCool));
  vec2 da = (p - (FB - vec2(0.0, 170.0))) / vec2(560.0, 430.0);
  col += lightC * exp(-dot(da, da) * 1.6) * 0.075 * lvl * fl;
  vec2 dg = (p - (FB - vec2(0.0, 20.0))) / vec2(660.0, 130.0);
  col += lightC * exp(-dot(dg, dg) * 1.4) * 0.16 * lvl * fl * ground;

  // ---- 火堆附近（方框裡才算 fbm）
  vec2 q = vec2(p.x - FB.x, FB.y - p.y); // q.y 向上：離火堆底部的高度
  if (abs(q.x) < 360.0 && q.y > -60.0 && q.y < 820.0) {
    // 煙：火的上方，很淡的一縷往上飄、往左偏（大尺度的噪聲；寬度用高斯收掉，方框邊緣之前就歸零）
    if (q.y > 200.0) {
      float sy = q.y;
      float sx = q.x + 0.00016 * sy * sy + 22.0 * sin(sy / 170.0 - uT * 0.6);
      float sn = fbm(vec2(sx / 260.0, sy / 300.0 - uT * 0.22), 2);
      float spread = 60.0 + sy * 0.22;
      float smoke = smoothstep(-0.2, 0.7, sn) * exp(-sx * sx / (2.0 * spread * spread)) * smoothstep(200.0, 420.0, sy) * (1.0 - smoothstep(560.0, 800.0, sy));
      col += (C_ASH * 0.022 + lightC * 0.012 * lvl) * smoke * uIn;
    }

    // 火舌：每條是一個被 fbm 扭曲的淚滴，越往上越窄、越被「咬」掉；多條取最大值，再用噪聲侵蝕出碎火。
    // 條與條之間留暗縫，火才看得出一條一條的舌頭，不會糊成一團。
    float nA = fbm(vec2(q.x / 58.0, q.y / 86.0 - uT * 2.8), 3);
    float nB = snoise(vec2(q.x / 26.0, q.y / 30.0 - uT * 4.8));
    float dens = 0.0;
    for (int i = 0; i < ${TONGUES}; i++) {
      vec4 g = uTg[i];
      if (g.z < 2.0) continue;
      float y = q.y / g.z;
      if (y < -0.12 || y > 1.3) continue;
      float x = (q.x - g.x - sin(uT * 2.1 + g.w + y * 2.6) * 9.0 * y - nA * 40.0 * y * y) / g.y;
      float w = 1.15 * sqrt(sat(y + 0.06)) * pow(sat(1.0 - y), 1.1);
      float d = abs(x) / max(w, 1e-3);
      float body = (1.0 - smoothstep(0.42, 1.0, d)) * smoothstep(-0.1, 0.03, y);
      dens = max(dens, body * (1.0 - 0.38 * sat(y)));
    }
    // 底部的一團主體（柴堆裡最熱的地方）：火舌從這裡長出來，火才有「身體」
    vec2 cm = (q - vec2(0.0, 34.0)) / vec2(118.0, 62.0);
    dens = max(dens, (1.0 - smoothstep(0.35, 1.0, length(cm) + 0.25 * nA)) * 0.95);
    float hgt = sat(q.y / 320.0);
    // 侵蝕只作用在火舌本身（乘上 sat(dens * 4)）：不然噪聲會在火舌外面憑空生出一片片碎火
    dens = sat(dens + (nB * 0.16 + nA * 0.3) * (0.15 + 1.1 * hgt) * sat(dens * 4.0) - 0.1 * hgt);
    dens *= smoothstep(-24.0, 4.0, q.y);
    // 顏色：外層暗紅→訊號色→ember，只有最底部的核心白熱（> 1 會發光）
    float hh = pow(dens, 0.72) * 0.9 + 0.1 * smoothstep(0.75, 1.0, dens) * (1.0 - hgt);
    vec3 fc = fireCol(hh) * smoothstep(0.02, 0.3, dens) * (0.7 + 1.5 * smoothstep(0.78, 0.98, hh));
    col += fc * uIn;

    // 炭床：火堆底部一堆凹凸不平的炭，一點一點暗紅發亮
    float cn = snoise(vec2(q.x / 13.0, q.y / 8.0 + uT * 0.2)) * 0.5 + 0.5;
    vec2 cb = q / vec2(140.0, 22.0 + 10.0 * snoise(vec2(q.x / 40.0, 1.3)));
    float bed = (1.0 - smoothstep(0.75, 1.0, length(cb))) * step(-30.0, q.y);
    col = mix(col, C_INK * 0.6, bed * 0.6);
    col += fireCol(0.3 + 0.55 * cn * cn) * bed * 1.1 * lvl * fl;

    // 火堆裡交疊的柴（畫在火舌前面：暗暗的剪影擋住火的底部，上緣被火照亮，底部有發紅的裂紋）
    for (int i = 0; i < 3; i++) {
      vec2 a = i == 0 ? vec2(-132.0, 2.0) : i == 1 ? vec2(136.0, 0.0) : vec2(-104.0, -6.0);
      vec2 b = i == 0 ? vec2(44.0, 64.0) : i == 1 ? vec2(-40.0, 58.0) : vec2(116.0, 8.0);
      float r = i == 2 ? 14.0 : 15.5;
      float al; float d = logSD(q, a, b, r, al);
      float cov = 1.0 - smoothstep(-1.0, 1.0, d);
      if (cov <= 0.0) continue;
      float n = snoise(vec2(al / 46.0 + float(i) * 7.0, (d + r) / 12.0));
      // 柴的截面明暗：上緣受光、下緣暗
      vec2 ab = normalize(b - a); vec2 nrm = vec2(-ab.y, ab.x); if (nrm.y < 0.0) nrm = -nrm;
      float side = dot(q - a, nrm) / r;
      // 裂紋只在柴的下半、靠近炭床的地方，稀稀落落的幾道
      float crack = smoothstep(0.5, 0.78, n) * (1.0 - smoothstep(-0.2, 0.4, side)) * (1.0 - smoothstep(10.0, 56.0, q.y));
      vec3 wc = C_INK * 0.55 + C_SEPIA * 0.28 * (0.5 + 0.5 * snoise(vec2(al / 6.0, side * 2.0)));
      wc += lightC * 0.5 * smoothstep(0.3, 1.0, side) * lvl * fl;
      wc += fireCol(0.5 + 0.35 * n) * crack * (1.0 + 0.5 * sin(uT * 3.0 + al * 0.07)) * lvl;
      col = mix(col, wc, cov);
    }
  }

  // ---- 前景的圓木：劈開的平面朝鏡頭（火在它後面：剖面偏暗，上緣的樹皮有一道逆光的邊）
  if (p.x > BX.x - 2.0 && p.x < BX.y + 2.0 && p.y > BX.z - 8.0 && p.y < BX.w + 2.0) {
    // 兩端鋸口微微不規則；上緣樹皮有一點起伏
    float endL = BX.x + 4.0 * snoise(vec2(p.y / 30.0, 1.0));
    float endR = BX.y + 4.0 * snoise(vec2(p.y / 30.0, 5.0));
    float topE = BX.z + 3.0 * snoise(vec2(p.x / 90.0, 3.0)) + 1.0 * snoise(vec2(p.x / 31.0, 9.0));
    float inside = smoothstep(endL - 1.0, endL + 1.0, p.x) * (1.0 - smoothstep(endR - 1.0, endR + 1.0, p.x))
      * smoothstep(topE - 1.0, topE + 1.0, p.y) * (1.0 - smoothstep(BX.w - 1.0, BX.w + 1.0, p.y));
    if (inside > 0.0) {
      vec3 wc;
      float fx = FB.x;
      float rimK = exp(-abs(p.x - fx) / 420.0) * 0.8 + 0.2;
      if (p.y < FACE.x || p.y > FACE.y) {
        // 樹皮：粗糙的深色帶，細的直紋
        float bn = snoise(vec2(p.x / 7.0, p.y / 2.5)) * 0.5 + 0.5;
        wc = C_INK * 0.9 + C_SEPIA * 0.22 * bn;
        // 上緣的逆光邊（火從後面照過來）
        float rim = (1.0 - smoothstep(0.0, 5.0, p.y - topE)) * step(p.y, FACE.x);
        wc += lightC * rim * 0.55 * lvl * rimK * fl;
      } else {
        // 剖面：縱切面的年輪＝「教堂拱形」。圓木是圓柱、年輪是同心圓柱，剖面跟軸線有一點夾角，
        // 所以剖面上看到的是 r = sqrt(d(x)² + v²) 的等高線：一層層往右收尖的拱。
        float u = (p.x - BX.x) / (BX.y - BX.x);
        float v = (p.y - (FACE.x + FACE.y) * 0.5) / ((FACE.y - FACE.x) * 0.5);
        float dd = 0.08 + 1.25 * u + 0.05 * snoise(vec2(u * 3.0, 1.7));
        float rr = sqrt(dd * dd + v * v * 0.9) * 9.0 + 0.3 * snoise(vec2(p.x / 260.0, v * 1.3 + 4.0));
        float fw = max(fwidth(rr), 1e-4);
        float f = abs(fract(rr + 0.5) - 0.5);
        float ringLine = 1.0 - smoothstep(fw * 0.6, fw * 1.8, f);
        float late = smoothstep(0.15, 0.45, fract(rr)) * (1.0 - smoothstep(0.75, 0.98, fract(rr)));
        // 細細的纖維（順著木頭的方向）
        float fib = snoise(vec2(p.x / 90.0, p.y / 1.6)) * 0.5 + 0.5;
        wc = mix(C_SEPIA * 0.62, C_SEPIA * 0.9 + C_INK2 * 0.2, late) * (0.85 + 0.25 * fib);
        wc = mix(wc, C_INK * 0.8, ringLine * 0.55);
        // 剖面上緣接到一點火光的反射（越靠近火越亮），下緣暗
        float top = 1.0 - smoothstep(0.0, 70.0, p.y - FACE.x);
        wc += lightC * 0.022 * (0.4 + 0.6 * top) * lvl * rimK * fl;
        wc *= 0.8 + 0.2 * (1.0 - sat((p.y - FACE.x) / (FACE.y - FACE.x)));
        // 剖面與樹皮的交界：一條細細的亮線（刨平的邊）
        wc += C_BONE * 0.03 * (1.0 - smoothstep(0.0, 2.0, abs(p.y - FACE.x)));
      }
      col = mix(col, wc, inside);
    }
  }

  fragColor = vec4(col, 1.0);
}`;
