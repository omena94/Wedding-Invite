// 演唱會票根（ticket）的 shader：凸版印刷（letterpress）。
// 票面上所有的字與線都是「壓進去」的：Canvas2D 畫成資料圖層（R = 壓痕深度、G = 墨色、B = 訊號色的墨），
// 這裡用深度的差分算出每一點的法向量，再用一盞斜斜的燈打光——壓痕靠光的一側亮、背光的一側暗，
// 所以沒上墨的「盲壓」字也讀得到（跟唱：還沒唱的字就是盲壓）。墨照 Beer–Lambert 乘在紙色上，換主題整張跟著變。
//  - 紙的纖維、棉紙的細小凹凸（連同凹凸的梯度，打光用）跟時間無關，整晚只烤一次（BAKE_FRAG，存明暗與梯度，不存顏色）。
//  - 票的外形（圓角、齒孔兩端的半圓缺口）、齒孔的小洞、剪票剪出來的愛心洞、撕開的鋸齒邊，都是解析的 SDF，不用貼圖。
//  - 票平放在桌上、鏡頭斜斜往下看（有透視）：「螢幕 → 票面」是一個單應矩陣 Hi（主檔用針孔相機投影四個角算出來），
//    鏡頭慢推只是每格換一個 Hi。撕下來的票根在票面座標裡再做一次平移旋轉（sA/sB），跟主票分開畫，各有各的影子。
//  - 景深：焦點在票上；桌布只剩很柔的起伏（沒有細紋），左下角鏡頭前還有一張失焦的票，前後才有空氣。
//  - 剪下來的愛心紙屑（點綴色）最多八片，在最上面畫。
import { H } from '../engine/gl';

/** 票面座標（邏輯像素，y 向下）：整張票的大小、齒孔的位置。 */
export const TW = 1220, TH = 740, PERF = 900;
/** 主打留言（R 深度、G 墨量、B = 時間碼 × G）與歌詞條（R 盲壓、G 墨、B 訊號色的墨）的圖層在票面上的範圍。 */
export const MSG = { x: 48, y: 156, w: 820, h: 396 };
export const STRIP = { x: 48, y: 576, w: 820, h: 138 };
/** 剪票處八個愛心的中心（票面座標）與寬度。 */
export const SLOT_W = 40;
export const slotAt = (i: number) => ({ x: 1060 + ((i % 4) - 1.5) * 64, y: 528 + Math.floor(i / 4) * 62 });

export const BAKE_FRAG = /* glsl */ `
float fib(vec2 p, float cs) {
  float acc = 0.0;
  vec2 cell = floor(p / cs);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = cell + vec2(float(i), float(j));
    vec2 o = (c + hash22(c)) * cs;
    float a = hash12(c + 7.1) * TAU;
    float L = cs * (0.3 + 1.1 * hash12(c + 3.3));
    vec2 d = vec2(cos(a), sin(a));
    acc += (hash12(c + 9.9) - 0.5) * (1.0 - smoothstep(0.25, 1.3, sdSegment(p, o - d * L * 0.5, o + d * L * 0.5)));
  }
  return acc;
}
// 厚棉卡紙的毛氈感：低頻的起伏＋細的纖維
float bump(vec2 p) { return 0.7 * snoise(p * 0.07) + 0.25 * snoise(p * 0.3 + 7.0) + 0.35 * fib(p, 16.0); }
void main() {
  vec2 p = vec2(vUv.x * ${TW}.0, (1.0 - vUv.y) * ${TH}.0);
  float cloud = fbm(p * 0.0035, 3);
  float f = fib(p, 20.0) + 0.6 * fib(p * 1.7 + 31.0, 20.0);
  float b0 = bump(p), bx = bump(p + vec2(1.0, 0.0)), by = bump(p + vec2(0.0, 1.0));
  // r = 紙的明暗、g = 纖維（吃墨少）、ba = 凹凸的梯度（主 shader 拿來打光）
  fragColor = vec4(cloud, f, bx - b0, by - b0);
}`;

export const MAIN_FRAG = /* glsl */ `
uniform sampler2D baseTex; uniform sampler2D msgTex; uniform sampler2D stripTex; uniform sampler2D bakeTex;
uniform mat3 Hi;                      // 螢幕（y 向下）→ 票面（單應矩陣，透視）
uniform vec3 sA; uniform vec3 sB;     // 票面 → 撕下來的票根自己的票面座標
uniform float sep;                    // 1 = 票根已經整個分開（各畫各的）
uniform float tearY;                  // 齒孔從上面撕開了多長（票面 px）
uniform vec2 lightDir;                // 燈的方向（票面座標，指向燈）
uniform float depth;                  // 壓痕深度（px）
uniform float sheen;                  // 掃過去的一道光（票面座標上的位置，很大 = 沒有）
uniform float msgT; uniform float msgRamp; // 留言的時間碼：現在走到哪、墨從沒有到有的寬度（時間碼單位）
uniform float punchN;                 // 剪了幾個洞
uniform vec4 chadP[8]; uniform float chadR[8]; // 愛心紙屑：螢幕 xy、翻面的橫向縮放、大小；旋轉
uniform vec4 shM; uniform vec4 shS;   // 影子：位移 xy、模糊、濃度（主票、票根）
uniform float jagSeed;
uniform vec4 spot[3]; uniform vec3 spotC[3]; // v2：舞台燈打在桌上的三團光（螢幕 xy、半徑、強度；顏色）

const vec2 TSZ = vec2(${TW}.0, ${TH}.0);
const float PX = ${PERF}.0;

vec2 aff(vec3 a, vec3 b, vec2 p) { return vec2(dot(a, vec3(p, 1.0)), dot(b, vec3(p, 1.0))); }
vec2 plane(vec2 sp) { vec3 v = Hi * vec3(sp, 1.0); return v.xy / v.z; }
float dot2(vec2 v) { return dot(v, v); }
// 愛心（iq 的 SDF，尖端在 y=0、往上 1.1）；包成「中心在原點、y 向下、寬 w 像素」
float sdHeartIQ(vec2 p) {
  p.x = abs(p.x);
  if (p.y + p.x > 1.0) return sqrt(dot2(p - vec2(0.25, 0.75))) - 0.35355;
  return sqrt(min(dot2(p - vec2(0.0, 1.0)), dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}
float sdHeart(vec2 p, float w) { float u = w / 1.21; return sdHeartIQ(vec2(p.x, -p.y) / u + vec2(0.0, 0.55)) * u; }

// 票的外形：圓角矩形，齒孔的上下兩端各咬一個半圓缺口（演唱會票的樣子）
float ticketSD(vec2 q) {
  vec2 c = TSZ * 0.5;
  vec2 d = abs(q - c) - (c - 14.0);
  float box = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - 14.0;
  float notch = min(length(q - vec2(PX, 0.0)), length(q - vec2(PX, TSZ.y))) - 18.0;
  return max(box, -notch);
}
// 撕開的邊：沿著齒孔、有纖維的鋸齒（只跟 y 有關，主票與票根兩邊咬得起來）
float jag(float y) { return 2.2 * snoise(vec2(y * 0.085, jagSeed)) + 1.1 * snoise(vec2(y * 0.42, jagSeed + 3.1)); }

/** 這一塊紙（0 = 主票，1 = 票根）的 SDF（負的是紙）。還沒分開時整張票是一塊。 */
float pieceSD(vec2 q, float which) {
  float d = ticketSD(q);
  if (sep < 0.5) return d;
  float e = q.x - (PX + jag(q.y));
  // 撕開的邊毛毛的
  e += 0.9 * (hash12(floor(q * 1.3)) - 0.5);
  return which < 0.5 ? max(d, e) : max(d, -e);
}

vec2 slot(int i) { return vec2(1060.0 + (mod(float(i), 4.0) - 1.5) * 64.0, 528.0 + floor(float(i) / 4.0) * 62.0); }

/** 紙上的洞（負的是洞）：齒孔的小圓洞、剪票的愛心、還沒分開時已經撕開的那一段縫。 */
float holeSD(vec2 q) {
  float d = 1e5;
  float ax = abs(q.x - PX);
  if (ax < 10.0 && q.y > 22.0 && q.y < TSZ.y - 22.0) {
    float yy = mod(q.y - 7.0, 14.0) - 7.0;
    d = min(d, length(vec2(q.x - PX, yy)) - 2.3);
  }
  if (sep < 0.5 && q.y < tearY && ax < 16.0) {
    // 撕開的縫：越上面（越早撕開）張得越開
    float gw = 0.7 + (tearY - q.y) * 0.0105;
    d = min(d, abs(q.x - PX - jag(q.y)) - gw + 0.8 * (hash12(floor(q * 1.3)) - 0.5));
  }
  if (q.x > PX + 20.0 && q.y > 480.0 && q.y < 620.0) {
    for (int i = 0; i < 8; i++) {
      if (float(i) >= punchN) break;
      d = min(d, sdHeart(q - slot(i), ${SLOT_W}.0));
    }
  }
  return d;
}

bool inR(vec2 q, vec4 r) { return q.x >= r.x && q.y >= r.y && q.x < r.x + r.z && q.y < r.y + r.w; }
vec2 uvR(vec2 q, vec4 r) { return vec2((q.x - r.x) / r.z, 1.0 - (q.y - r.y) / r.w); }
const vec4 RM = vec4(${MSG.x}.0, ${MSG.y}.0, ${MSG.w}.0, ${MSG.h}.0);
// 歌詞條的範圍是 uniform：韓文歌（中文＋原文兩段）時歌詞條往上長高（主檔的 KO_UP），平常就是 STRIP
uniform vec4 uRS;
#define RS uRS
vec2 uvT(vec2 q) { return vec2(q.x / TSZ.x, 1.0 - q.y / TSZ.y); }

// 留言的字：時間碼 = B / G（邊緣反鋸齒兩個通道等比例變淡，比例不變）；時間到了才壓下去、上墨
float printed(vec4 m) {
  if (m.g < 0.004) return 0.0;
  return sat((msgT - m.b / m.g) / msgRamp);
}
float heightAt(vec2 q) {
  float h = texture(baseTex, uvT(q)).r;
  if (inR(q, RM)) { vec4 m = texture(msgTex, uvR(q, RM)); h += m.r * printed(m); }
  if (inR(q, RS)) h += texture(stripTex, uvR(q, RS)).r;
  return min(h, 1.0);
}

vec3 desk(vec2 sp) {
  // 景深：桌布在焦點外，只留很柔的大片起伏（沒有細的經緯，背景才安靜）
  float n = snoise(sp / 720.0) * 0.5 + snoise(sp / 280.0 + 3.0) * 0.18;
  vec3 c = mix(C_PAPER, C_SEPIA, 0.27 + 0.03 * n);
  // 側光：從左上斜斜照進來，右下慢慢暗下去
  float lit = smoothstep(1700.0, -100.0, dot(sp, vec2(0.87, 0.49)));
  // v2：桌面暗一點（舞台的燈光才看得出來），票本身不變暗，還是最亮的紙
  return c * (0.74 + 0.15 * lit);
}
// 舞台燈（v2 的「燈光」環境動態）：三團柔柔的有色光在桌面上，每個小節線掃到新的位置（主檔算位置）
vec3 stage(vec2 sp) {
  vec3 a = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    vec2 d = (sp - spot[i].xy) / spot[i].z;
    a += spotC[i] * spot[i].w * exp(-dot(d, d) * 2.2);
  }
  return a;
}

/** 一點票面的顏色（打光、墨、纖維）。hd：到最近的洞的距離（洞的邊緣被剪壓，暗一點）。 */
vec3 paperAt(vec2 q, float hd) {
  vec2 uv = uvT(q);
  vec4 bk = texture(bakeTex, uv);
  vec4 bs = texture(baseTex, uv);
  float h = bs.r, inkS = bs.g, inkG = bs.b, inkR = 0.0;
  if (inR(q, RM)) {
    vec4 m = texture(msgTex, uvR(q, RM));
    float on = printed(m);
    h += m.r * on;
    // 愛心的 R/G 是 0.5（見主檔）：用點綴色的墨
    if (m.r < 0.75 * m.g) inkR += m.g * on; else inkS += m.g * on;
  }
  if (inR(q, RS)) { vec4 s = texture(stripTex, uvR(q, RS)); h += s.r; inkS += s.g; inkG += s.b; }
  h = min(h, 1.0);
  // 壓痕的斜面：±1.5 px 的差分
  const float D = 1.5;
  vec2 g = vec2(heightAt(q + vec2(D, 0.0)) - heightAt(q - vec2(D, 0.0)), heightAt(q + vec2(0.0, D)) - heightAt(q - vec2(0.0, D))) / (2.0 * D);
  vec3 n = normalize(vec3(g * depth + bk.ba * 0.22, 1.0));
  vec3 L = normalize(vec3(lightDir, 0.8));
  float lam = dot(n, L) / L.z;
  float shade = clamp(mix(1.0, lam, 0.8), 0.42, 1.06);
  // 棉卡紙：比桌面亮的奶油白，雲紋與纖維
  vec3 col = mix(C_PAPER, C_BONE, 0.3) * (0.955 + 0.05 * bk.r) * (1.0 - 0.025 * sat(bk.g));
  col *= 1.0 - 0.05 * h; // 壓下去的地方紙被壓實，暗一點
  col *= shade;
  // 掃過去的光（落定、每次換燈）
  float band = exp(-pow(((q.x + 0.45 * q.y) - sheen) / 130.0, 2.0));
  col += C_BONE * 0.055 * band * shade;
  // 墨：墨在纖維多的地方吃得少；字的邊緣墨多一點（凸版的「墨邊」）
  float mott = (0.9 + 0.1 * (1.0 - sat(bk.g))) * (1.0 + 0.35 * min(length(g) * 2.0, 1.0));
  vec3 tSep = clamp(mix(C_SEPIA, C_INK, 0.25) / C_PAPER, 0.003, 1.0);
  vec3 tSig = clamp(C_SIGNAL / C_PAPER, 0.003, 1.0);
  vec3 tRose = clamp(C_ROSE / C_PAPER, 0.003, 1.0);
  col *= mix(vec3(1.0), tSep, sat(inkS * mott));
  // 訊號色的墨疊濃一點（次方）：淡的主題（香檳、鼠尾草）在奶油色的紙上也讀得到
  col *= pow(tSig, vec3(2.3 * sat(inkG * mott)));
  col *= pow(tRose, vec3(1.5 * sat(inkR)));
  // 洞的邊緣：被剪票鉗壓扁、切口的陰影
  col *= 1.0 - 0.2 * (1.0 - smoothstep(0.0, 2.2, hd));
  return col;
}

void main() {
  vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  vec3 col = desk(sp);
  vec2 q = plane(sp);
  // ---- 主票（還沒分開時是整張）
  float sdS = pieceSD(plane(sp - shM.xy), 0.0);
  col *= 1.0 - shM.w * (1.0 - smoothstep(-shM.z, shM.z, sdS));
  float sd = pieceSD(q, 0.0);
  if (sd < 1.0) {
    float hd = holeSD(q);
    float inT = sat(0.5 - sd);
    // 洞裡看到的桌面：票就貼在上面，洞壁的影子讓它更暗（洞才讀得出是洞，不是印上去的灰愛心）
    col *= 1.0 - sat(0.5 - hd) * inT * (0.3 + 0.28 * (1.0 - smoothstep(0.0, 5.0, -hd)));
    float cov = inT * sat(hd + 0.5);
    if (cov > 0.0) col = mix(col, paperAt(q, hd), cov);
  }
  // ---- 撕下來的票根（在主票上面，有自己的影子）
  if (sep > 0.5) {
    vec2 qs = aff(sA, sB, q);
    float sdT = pieceSD(aff(sA, sB, plane(sp - shS.xy)), 1.0);
    col *= 1.0 - shS.w * (1.0 - smoothstep(-shS.z, shS.z, sdT));
    float sd2 = pieceSD(qs, 1.0);
    if (sd2 < 1.0) {
      float hd = holeSD(qs);
      float inT = sat(0.5 - sd2);
      col *= 1.0 - sat(0.5 - hd) * inT * (0.3 + 0.28 * (1.0 - smoothstep(0.0, 5.0, -hd)));
      float cov = inT * sat(hd + 0.5);
      if (cov > 0.0) col = mix(col, paperAt(qs, hd), cov);
    }
  }
  // ---- 剪下來的愛心紙屑（點綴色）：先畫影子再畫紙，翻到背面暗一點
  for (int i = 0; i < 8; i++) {
    vec4 c = chadP[i];
    if (c.w <= 0.0) continue;
    vec2 d = sp - c.xy;
    if (dot(d, d) > 3600.0 * c.w * c.w) continue;
    float sx = max(abs(c.z), 0.12);
    vec2 l = rot2(chadR[i]) * d;
    vec2 ls = rot2(chadR[i]) * (d - vec2(3.0, 5.0) * c.w);
    float w = ${SLOT_W}.0 * c.w;
    float dsh = sdHeart(vec2(ls.x / sx, ls.y), w) * sx;
    col *= 1.0 - 0.22 * (1.0 - smoothstep(-2.0, 3.0, dsh));
    float dh = sdHeart(vec2(l.x / sx, l.y), w) * sx;
    vec3 rc = C_ROSE * (c.z < 0.0 ? 0.8 : 1.0) * (0.92 + 0.08 * sx);
    col = mix(col, rc, sat(0.5 - dh));
  }
  // ---- 鏡頭前失焦的另一張票（右上角，很大、很糊，只是一點前景；v2：票移到左下，前景改放右上，不擋票也不擋 QR）
  {
    vec2 fp = rot2(-0.38) * (sp - vec2(1930.0, 10.0));
    float fd = sdBox(fp, vec2(300.0, 118.0)) - 12.0;
    float fsh = 1.0 - smoothstep(-40.0, 120.0, sdBox(rot2(-0.38) * (sp - vec2(1905.0, 45.0)), vec2(300.0, 118.0)));
    col *= 1.0 - 0.16 * fsh;
    col = mix(col, mix(C_PAPER, C_BONE, 0.3) * 0.93, (1.0 - smoothstep(-38.0, 38.0, fd)) * 0.96);
  }
  // 舞台燈照在整個畫面（桌子、票都一起）：乘上去，是光不是顏料
  col *= 1.0 + stage(sp);
  fragColor = vec4(col, 1.0);
}`;

