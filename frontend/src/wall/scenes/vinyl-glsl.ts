// 黑膠版面的全螢幕 shader（vinyl.ts 用）：唱盤底座、唱片（溝紋、反光扇形、灰塵）、圓心標籤、刻在溝紋上的字、唱臂與它的影子。
// 全部畫在一個 pass 裡：溝紋是幾千條同心圓，用 Canvas2D 每格畫會太慢（目標 < 12 ms），在 shader 裡一個像素算一次就好。
// 座標：p 是邏輯像素、y 向下（跟 Canvas2D 一樣），角度 a 從正上方起算、順時針為正。
import { H } from '../engine/gl';

export const FRAG_VINYL = /* glsl */ `
uniform vec2 uC;        // 唱片圓心
uniform float uR;       // 唱片半徑
uniform float uRl;      // 標籤半徑
uniform float uTh;      // 唱片轉過的角度（順時針為正）：灰塵、標籤跟著轉
uniform float uFan;     // 反光扇形的軸（兩片對稱）
uniform float uFanK;    // 反光強度（進場時亮起來、大鼓時亮一點）
uniform float uIn;      // 進場 0..1
uniform float uHat;     // hi-hat：灰塵閃一下
uniform vec2 uS;        // 唱針尖
uniform vec2 uE;        // 唱頭座後端（唱臂管接到這裡）
uniform vec2 uP;        // 唱臂軸心
uniform float uLift;    // 唱臂抬起 0..1（影子離得越遠、越糊）
uniform sampler2D uLab; // 圓心標籤（init 時畫好，這裡依 uTh 轉）
uniform sampler2D uTxt; // 刻在溝紋上的字（遮罩：r = 唱過、g = 熱度、b = 愛心、a = 覆蓋率）
uniform vec4 uTR;       // 字層在畫面上的範圍 x, y, w, h

// ---- 唱臂：各部件的距離場（邏輯像素，<0 在裡面）
float tubeSD(vec2 q) { return sdSegment(q, uP, uE) - 5.5; }
vec2 headFrame(vec2 q, out float hl) {
  vec2 hd = uS - uE; hl = length(hd);
  vec2 hn = hd / max(hl, 1e-3);
  vec2 m = (uE + uS) * 0.5;
  vec2 hq = q - m;
  return vec2(dot(hq, hn), dot(hq, vec2(-hn.y, hn.x)));
}
// 唱頭座：一片長方形的金屬片，側邊伸出一根手指勾（抬唱臂用）
float headSD(vec2 q) {
  float hl; vec2 h = headFrame(q, hl);
  float shell = sdBox(h - vec2(-6.0, 0.0), vec2(hl * 0.5 + 4.0, 14.0)) - 3.0;
  float lift = sdSegment(h, vec2(hl * 0.5 - 22.0, -14.0), vec2(hl * 0.5 - 30.0, -34.0)) - 2.4;
  return min(shell, lift);
}
vec2 cwDir() { return normalize(uP - uE); }
float cwSD(vec2 q) { vec2 k = cwDir(); return sdSegment(q, uP + k * 58.0, uP + k * 132.0) - 25.0; }
float baseSD(vec2 q) { return length(q - uP) - 46.0; }
float armSD(vec2 q) { return min(min(tubeSD(q), headSD(q)), min(cwSD(q), baseSD(q))); }

void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  vec2 d = p - uC;
  float r = length(d);
  float a = atan(d.x, -d.y);
  float b = mod(a - uTh + PI, TAU) - PI;              // 唱片（與轉盤）自己的角度：跟著轉

  // ---- 唱盤底座：暖黑、極淡的紋理，左上方來的光
  vec3 col = C_INK * (0.78 + 0.22 * (0.5 + 0.5 * fbm(p / 520.0 + 3.1, 3)));
  col += (C_INK2 - C_INK) * 0.9 * (1.0 - smoothstep(0.0, 1500.0, length(p - vec2(260.0, -120.0))));
  // 唱片壓在底座上的影子（光從左上來，影子往右下）
  col *= 1.0 - 0.55 * (1.0 - smoothstep(uR - 30.0, uR + 70.0, length(d - vec2(14.0, 20.0))));
  // 轉盤邊緣：一圈細細的金屬（比唱片大一點）
  float plat = aaStroke(r - uR - 9.0, 1.2) * 0.6 + aaStroke(r - uR - 15.0, 0.8) * 0.25;
  col += C_ASH * 0.10 * plat * uIn;
  // 轉盤邊緣的刻度（跟著轉）：每 2° 一刻、每 10° 長一點，像儀器的刻度盤
  float tk = abs(fract(b * 180.0 / TAU + 0.5) - 0.5) * (TAU / 180.0) * r;
  float major = step(abs(fract(b * 36.0 / TAU + 0.5) - 0.5), 0.04);
  float tickBand = step(uR + 5.0, r) * step(r, uR + (major > 0.5 ? 20.0 : 13.0));
  col += C_ASH * 0.16 * pxLine(tk, 0.25, 1.1) * tickBand * uIn;

  // ---- 唱片
  float rec = 1.0 - smoothstep(uR - 0.7, uR + 0.7, r);
  vec3 vc = C_INK * 0.3 + vec3(0.0012);               // 黑膠本身：比底座還黑
  // 有溝紋的範圍：外緣留一圈平滑的導入區、內圈留一圈平滑的導出區
  float grooved = smoothstep(uRl + 30.0, uRl + 34.0, r) * (1.0 - smoothstep(uR - 15.0, uR - 12.0, r));
  // 曲與曲之間的空白（比較亮、沒有溝）
  float gaps = 0.0;
  for (int i = 0; i < 3; i++) {
    float gr = uRl + (uR - uRl) * (0.30 + 0.215 * float(i));
    gaps = max(gaps, 1.0 - smoothstep(2.0, 4.0, abs(r - gr)));
  }
  grooved *= 1.0 - gaps;
  // 音樂的大聲小聲：溝距疏密 → 一圈一圈深淺不同的帶子
  float band = 0.5 + 0.5 * snoise(vec2(r / 27.0, 1.7));
  band = 0.45 + 0.55 * band * band;
  // 細溝：平滑的波（太細、看不出來時淡成平均值，免得出現疊紋）
  float gw = r / 3.1;
  float fine = 0.5 + 0.5 * cos(TAU * gw) * (1.0 - smoothstep(0.22, 0.5, fwidth(gw)));
  // 刻線：每 ~9 px 一條、有一點不規則（版畫的線）
  float hl = r / 9.0 + 0.4 * snoise(vec2(r / 60.0, 4.2));
  float hair = pxLine(abs(fract(hl) - 0.5) * 9.0, 0.25, 1.15);
  // 反光扇形：兩片對稱，越靠內越寬；外面再包一層很淡的寬光
  float df = abs(mod(a - uFan + PI * 0.5, PI) - PI * 0.5);
  float sg = 0.05 + 22.0 / (r + 60.0);
  float fan = exp(-df * df / (2.0 * sg * sg));
  float fanW = exp(-df * df / (2.0 * 16.0 * sg * sg));
  // 溝紋裡的「音樂」讓反光有一點顆粒：跟著唱片轉
  float grain = 0.75 + 0.25 * snoise(vec2(b * r / 23.0, r / 3.0));
  vec3 sheen = mix(C_BONE, C_EMBER, 0.14);
  float lum = grooved * band * (0.006 + 0.03 * fanW * uFanK + 0.34 * fan * uFanK * grain) * (0.3 + 0.7 * fine);
  lum += grooved * hair * (0.02 + 0.035 * fanW + 0.2 * fan * uFanK) * (0.5 + 0.5 * band);
  // 曲間空白：光滑的黑膠，只在反光裡亮
  lum += gaps * (0.01 + 0.26 * fan * uFanK);
  // 導入區、導出區：平滑
  float smoothZone = (smoothstep(uR - 14.0, uR - 11.0, r) + smoothstep(uRl + 33.0, uRl + 29.0, r) * step(uRl, r));
  lum += smoothZone * (0.006 + 0.18 * fan * uFanK);
  // 唱片外緣的倒角：一條細亮邊
  lum += aaStroke(r - uR + 2.0, 1.3) * (0.10 + 0.5 * fan);
  // 導出區的鎖溝
  lum += aaStroke(r - uRl - 21.0, 1.0) * (0.04 + 0.3 * fan);
  vc += sheen * lum;
  // 灰塵：唱片座標裡的稀疏小點（跟著轉，才看得出唱片在轉），反光裡、hi-hat 時亮
  vec2 pl = vec2(b * r, r);
  vec2 cell = floor(pl / 15.0);
  float hc = hash12(cell);
  if (hc > 0.972 && r > uRl + 4.0) {
    vec2 c0 = (cell + 0.5 + (hash22(cell) - 0.5) * 0.7) * 15.0;
    float dd = length(pl - c0);
    float dust = 1.0 - smoothstep(0.35, 1.3, dd);
    vc += C_BONE * dust * (0.05 + 0.4 * fan + 0.25 * uHat * hash12(cell + 7.0)) * (0.4 + 0.6 * hash12(cell + 3.0));
  }
  col = mix(col, vc, rec);

  // ---- 圓心標籤（init 畫好的貼圖，跟著唱片轉）
  vec2 loc = vec2(cos(uTh) * d.x + sin(uTh) * d.y, -sin(uTh) * d.x + cos(uTh) * d.y);
  vec2 luv = loc / (2.0 * uRl) + 0.5;
  vec4 lab = texture(uLab, vec2(luv.x, 1.0 - luv.y));
  float onLab = step(r, uRl + 2.0);
  // 紙的顆粒、左上來的光、反光扇形掃過時微微亮一下
  vec3 lc = lab.rgb * (0.9 + 0.08 * snoise(loc / 3.0) * 0.5 + 0.12 * (1.0 - smoothstep(0.0, 2.0 * uRl, length(loc + vec2(uRl * 0.6, uRl * 0.8)))));
  lc += C_BONE * 0.05 * fan;
  col = mix(col, lc, lab.a * onLab);
  // 軸心：金屬小圓柱
  float spin = 1.0 - smoothstep(7.5, 9.0, r);
  vec3 metal = mix(C_GRAPHITE * 0.5, C_BONE * 0.55, smoothstep(6.0, -4.0, dot(d, vec2(0.7, 0.7))));
  col = mix(col, metal, spin);
  col += C_BONE * 0.25 * aaStroke(r - 8.5, 0.9);

  // ---- 刻在溝紋上的字
  vec2 tp = (p - uTR.xy) / uTR.zw;
  vec4 tx = texture(uTxt, vec2(tp.x, 1.0 - tp.y));
  float tx2 = texture(uTxt, vec2(tp.x, 1.0 - tp.y) + vec2(-1.3, -1.3) / uTR.zw).a;
  float inT = step(0.0, tp.x) * step(tp.x, 1.0) * step(0.0, tp.y) * step(tp.y, 1.0);
  tx *= inT; tx2 *= inT;
  float heat = tx.g;
  vec3 ink = C_BONE * 0.93 * (0.9 + 0.1 * fine);                       // 溝紋從字裡穿過去
  // 正在讀的字：訊號色（保留色相，只比發光門檻高一點，光暈交給 bloom），冷卻成紙白
  ink = mix(ink, C_SIGNAL * 1.35 + C_EMBER * 0.25 * heat, smoothstep(0.0, 1.0, heat));
  // b 版 = 愛心：只用點綴色
  float rose = smoothstep(0.5, 0.9, tx.b);
  ink = mix(ink, C_ROSE * 0.9, rose);
  col = mix(col, ink, tx.a);
  // 字邊一點點浮雕（光從左上來）：刻出來的字不是貼上去的
  col += C_BONE * 0.12 * max(tx.a - tx2, 0.0) * (1.0 - heat) * (1.0 - rose);

  // ---- 唱臂：先畫影子（抬起來時影子離遠、變糊），再畫本體
  vec2 so = vec2(16.0, 10.0) * (0.55 + 1.6 * uLift);
  float blur = 3.0 + 16.0 * uLift;
  float sh = 1.0 - smoothstep(-blur, blur, armSD(p - so));
  col *= 1.0 - 0.62 * sh * uIn;
  float dT = tubeSD(p), dH = headSD(p), dC = cwSD(p), dB = baseSD(p);
  float dA = min(min(dT, dH), min(dC, dB));
  if (dA < 4.0) {
    vec3 body = C_INK2 * 1.25;
    // 管子：沿著管身一條高光（圓管的反光）
    vec2 tn = normalize(uE - uP); vec2 nn = vec2(-tn.y, tn.x);
    float across = dot(p - uP, nn);
    float tubeHi = exp(-pow((across + 2.2) / 1.3, 2.0));
    vec3 tubeC = body + C_BONE * (0.08 + 0.35 * tubeHi) + C_ASH * 0.04;
    // 唱頭座：平的金屬片，兩個小螺絲
    float hl; vec2 hq = headFrame(p, hl);
    vec3 headC = body + C_ASH * 0.10;
    float screws = aaFill(length(hq - vec2(-hl * 0.15, 5.5)) - 1.8) + aaFill(length(hq - vec2(-hl * 0.15, -5.5)) - 1.8);
    headC += C_BONE * 0.3 * screws;
    // 唱頭（針匣）：靠前端一塊比較暗的
    float cart = aaFill(sdBox(hq - vec2(hl * 0.5 - 12.0, 0.0), vec2(12.0, 8.0)) - 1.0);
    headC = mix(headC, C_INK * 0.6, cart * 0.8);
    // 軸座：車床的同心細紋
    float rp = length(p - uP);
    vec3 baseC = body + C_BONE * 0.05 * (0.5 + 0.5 * cos(TAU * rp / 3.2)) + C_BONE * 0.22 * aaStroke(rp - 30.0, 1.0) + C_BONE * 0.3 * aaStroke(rp - 12.0, 1.1);
    // 配重：垂直於軸的滾花
    vec2 k = cwDir();
    float along = dot(p - uP, k);
    vec3 cwC = body + C_BONE * 0.07 * pxLine(abs(fract(along / 5.0) - 0.5) * 5.0, 0.3, 1.1) + C_BONE * 0.16 * exp(-pow((dot(p - uP, vec2(-k.y, k.x)) + 9.0) / 5.0, 2.0));
    vec3 armC = dT <= min(dH, min(dC, dB)) ? tubeC : dH <= min(dC, dB) ? headC : dC <= dB ? cwC : baseC;
    col = mix(col, armC, aaFill(dA));
    // 外框細線（儀器圖的畫法）
    col += C_BONE * 0.34 * aaStroke(dA, 1.1);
  }
  fragColor = vec4(col, 1.0);
}`;
