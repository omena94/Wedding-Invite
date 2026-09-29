// 鈔票版面（banknote.ts）的幾何與 shader。照 pdoom 的 ascent-note.ts（LUNAR RESERVE NOTE）：
// 紙、鈔票紋（guilloché）外框、玫瑰花飾、版畫線條的中央徽章；徽章從月亮換成「兩只交扣的婚戒」。
//
// 分兩個 pass，理由是效能：
//  - BAKE：不會動的東西（紙纖維、外框的編織紋與四角小花飾、底紋）只算一次，存成「墨的覆蓋率」而不是顏色，
//    所以每首歌換主題（紙色、墨色、訊號色）時不用重算。整晚共用一張（shared()）。
//  - MAIN：每一格都畫的：取 BAKE 與這個窗格的文字遮罩（兩次取樣），再加上會動的玫瑰花飾（跟音樂呼吸、
//    仙女棒描過才出現）與交扣的戒指（光線步進，只在徽章的圓裡算）。
// 鏡頭（MV 融合原則：鈔票是桌上一張真的紙，不是正面貼滿畫面的介面）：MAIN 先用反投影矩陣 uInv 把螢幕像素換回
// 「桌面平面」座標（= 原本的版面座標），所有東西都在平面座標上算——花飾、戒指的細線直接在透視下算，不會像先畫再貼圖那樣被糊兩次。
// 桌面、鈔票的影子、暖色主光（左上來、右下暗下去）也在這裡；歌詞是桌面上的一條字（uLyr），一樣跟著透視與光線。
// 注意：迴圈裡不能用 fwidth / dFdx（Windows 的 ANGLE → D3D11 編譯器會直接拒絕），所以花飾的線用固定寬度的反鋸齒。
import * as THREE from 'three';
import { FSPass, W, H } from '../engine/gl';

/** 鈔票的紙（邏輯像素，y 向下）。下緣停在右下角 QR 區（y ≥ 830）之上，整張鈔票的四個角都看得到。 */
export const NOTE = { x: 70, y: 36, w: 1780, h: 790 };
/** 外框：外框線離紙邊的距離、編織帶的寬度（外框線 → 內框線）。 */
export const FRAME = { inset: 18, band: 66 };
/** 內框線圍出來的內容區。 */
export const INNER = {
  x0: NOTE.x + FRAME.inset + FRAME.band, y0: NOTE.y + FRAME.inset + FRAME.band,
  x1: NOTE.x + NOTE.w - FRAME.inset - FRAME.band, y1: NOTE.y + NOTE.h - FRAME.inset - FRAME.band,
};
/** 中央徽章（圓心、肖像圓的半徑、一個戒指座標單位是幾個像素）。 */
export const MED = { x: 1440, y: 426, rp: 158, unit: 156 };
/** 玫瑰花飾：兩圈（內圈細密、外圈大起伏），外加三條分隔的細圓線。仙女棒沿著外圈 k=0 那條曲線跑。 */
export const ROS = {
  inner: { R: 181, a: 8, n: 36, K: 6 },
  outer: { R: 227, a: 17, n: 20, K: 9 },
  rules: [163, 199, 255] as const,
};
/** 花飾外面一圈字的基線半徑（上緣 LOVE RESERVE NOTE、下緣 IN LOVE WE TRUST）。 */
export const ARC_R = 270;
/** 防偽金屬箔（直的一條燙箔，貫穿整張紙）的中線，在留言與徽章之間。 */
export const THREAD_X = 1150;

/** 仙女棒在外圈花飾上的位置：u = 從正上方順時針量的角度（0..2π），twist/amp 跟 shader 同一組。 */
export function rosettePoint(u: number, twist: number, amp: number) {
  const th = u - Math.PI / 2;
  const r = ROS.outer.R + ROS.outer.a * amp * Math.sin(ROS.outer.n * th + twist);
  return { x: MED.x + r * Math.cos(th), y: MED.y + r * Math.sin(th) };
}

// ------------------------------------------------------------------ 共用的 GLSL 片段
const GEO = /* glsl */ `
const vec4 NOTE_R = vec4(${NOTE.x}.0, ${NOTE.y}.0, ${NOTE.w}.0, ${NOTE.h}.0);
const vec2 MED_C = vec2(${MED.x}.0, ${MED.y}.0);
vec2 pxDown() { return vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y); } // 轉成 y 向下，跟 Canvas2D 一樣
float sdRBox(vec2 p, vec2 c, vec2 hs, float r) { vec2 d = abs(p - c) - hs + r; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }
// 固定寬度的反鋸齒線（不用 fwidth：迴圈裡也能用）。w 是邏輯像素，至少一個實體像素寬。
float lAA(float d, float w) { float aa = 0.62 / PX_SCALE; float hw = max(w * 0.5, 0.5 / PX_SCALE); return 1.0 - smoothstep(hw - aa, hw + aa, abs(d)); }
// 一族 guilloché 曲線 r = R + a·sin(n·θ + 2πk/K + tw)，回傳墨的覆蓋率（距離用斜率校正，線寬才均勻）
float rosette(float rr, float th, float R, float a, float n, float K, float w, float tw) {
  float ink = 0.0;
  for (int k = 0; k < 16; k++) {
    if (float(k) >= K) break;
    float arg = n * th + float(k) * TAU / K + tw;
    float slope = a * n * cos(arg) / max(rr, 1.0);
    float d = (rr - R - a * sin(arg)) * inversesqrt(1.0 + slope * slope);
    ink = max(ink, lAA(d, w));
  }
  return ink;
}
`;

// ------------------------------------------------------------------ BAKE：只算一次
// R = 外框墨（外框線、編織帶、四角小花飾）　G = 淺色底紋（套色的那層：徽章外的車床紋、留言後面的波浪帶）
// B = 紙纖維（0..1）　A = 墨色的防偽細紋（全張鈔票很淡的兩族正弦線）
const BAKE_FRAG = /* glsl */ `
${GEO}
void main() {
  vec2 p = pxDown();
  vec2 nc = NOTE_R.xy + NOTE_R.zw * 0.5, nh = NOTE_R.zw * 0.5;
  // 紙纖維：拉長的雜訊（纖維有方向）＋細點
  float fib = 0.5 + 0.28 * snoise(p * vec2(0.0045, 0.03)) + 0.16 * snoise(p * 0.021 + 7.0) + 0.06 * (hash12(floor(p * 0.9)) - 0.5);

  // ---- 外框：四條框線，中間是兩組交纏的正弦（像編織的緞帶）
  float dF = sdRBox(p, nc, nh - ${FRAME.inset}.0, 26.0);
  float frame = lAA(dF, 2.2) + lAA(dF + 12.0, 1.0) + lAA(dF + 54.0, 1.0) + lAA(dF + 66.0, 2.0);
  // 沿著邊走的座標：上下邊用 x、左右邊用 y（轉角的接縫由四角的小花飾蓋住）
  vec2 q = p - nc;
  float along = (abs(q.x) - (nh.x - 51.0) > abs(q.y) - (nh.y - 51.0)) ? q.y : q.x;
  float bw = dF + 33.0;
  float s1 = 12.5 * sin(along * 0.0698), s2 = 7.5 * sin(along * 0.1396 + 1.0), s3 = 17.0 * sin(along * 0.0349 + 0.5);
  float weave = max(max(lAA(bw - s1, 1.0), lAA(bw + s1, 1.0)), max(lAA(bw - s2, 0.8), lAA(bw + s2, 0.8)));
  weave = max(weave, 0.55 * max(lAA(bw - s3, 0.7), lAA(bw + s3, 0.7)));
  float inBand = step(-54.0, dF) * step(dF, -12.0);
  // 編織帶裡的細點（像微縮印刷的顆粒）
  weave = max(weave, inBand * 0.35 * lAA(abs(bw) - 19.0, 0.6) * step(0.5, fract(along / 6.0)));
  frame = max(frame, inBand * weave);
  // 四角的小花飾：蓋住接縫
  vec2 cc = nc + sign(q) * (nh - 51.0);
  vec2 cq = p - cc;
  float cr = length(cq), cth = atan(cq.y, cq.x);
  if (cr < 40.0) {
    float ro = rosette(cr, cth, 21.0, 9.0, 8.0, 5.0, 0.8, 0.3);
    ro = max(ro, 0.7 * rosette(cr, cth, 21.0, 9.0, -8.0, 3.0, 0.7, 0.0));
    frame = max(0.8 * ro * smoothstep(33.0, 30.0, cr), max(lAA(cr - 37.0, 1.5), lAA(cr - 33.5, 0.8)));
  }
  float inNote = step(dF, -66.0);

  // ---- 防偽細紋（墨色、很淡）：兩族交錯的正弦
  float u1 = (p.y + 22.0 * sin(p.x * 0.011) + 7.0 * sin(p.x * 0.037 + 1.3)) / 10.0;
  float u2 = (p.y - 22.0 * sin(p.x * 0.011 + 1.9) - 7.0 * sin(p.x * 0.029)) / 10.0;
  float sec = (hatch(u1, 0.07) + hatch(u2, 0.07)) * inNote;

  // ---- 套色底紋：徽章外圍的車床紋（同心的波浪），越遠越淡
  vec2 mq = p - MED_C;
  float rr = length(mq), th = atan(mq.y, mq.x);
  float lathe = hatch((rr + 9.0 * sin(th * 14.0) + 4.0 * sin(th * 5.0)) / 8.0, 0.16) * smoothstep(258.0, 270.0, rr) * smoothstep(600.0, 300.0, rr);
  // 留言後面的波浪帶：一束交錯的正弦線，像鈔票底紋的緞帶
  float yc = 468.0 + 46.0 * sin(p.x * 0.0042 + 0.6);
  float dy = p.y - yc;
  float ribbon = hatch((dy + 16.0 * sin(p.x * 0.017 + dy * 0.021)) / 9.0, 0.15) * smoothstep(175.0, 70.0, abs(dy));
  ribbon = max(ribbon, 0.75 * hatch((dy - 16.0 * sin(p.x * 0.017 + 2.1 - dy * 0.021)) / 9.0, 0.12) * smoothstep(175.0, 70.0, abs(dy)));
  ribbon *= smoothstep(${INNER.x0}.0, ${INNER.x0 + 90}.0, p.x) * smoothstep(${THREAD_X - 20}.0, ${THREAD_X - 160}.0, p.x);
  // 留言後面的緞帶壓到很淡：字後面的紙要乾淨（MV 融合原則：字要清楚）
  float tint = max(lathe, ribbon * 0.4) * inNote;
  fragColor = vec4(sat(frame), sat(tint), sat(fib), sat(sec));
}`;

export const makeBakePass = () => new FSPass(BAKE_FRAG, {});

// ------------------------------------------------------------------ MAIN：每一格
const MAIN_FRAG = /* glsl */ `
${GEO}
uniform sampler2D uBake, uMask;
uniform float uT, uS, uSpan;        // 歌曲時間、窗格開始、文字遮罩的時間碼範圍（秒）
uniform float uFrame, uUnder, uNote; // 外框描出來的進度（0..1）、底紋、整張鈔票的墨（淡入）
uniform vec4 uRos;                   // 花飾：twist、振幅倍數、仙女棒走到的角度（0..2π，從正上方順時針）、還沒描到的淡影
uniform vec4 uHot;                   // 花飾熱度：第一圈仙女棒的尾巴、之後每四小節那一圈仙女棒走到的角度與強度、-
uniform mat3 uRot;                   // 戒指的旋轉（物件 → 世界）
uniform vec2 uDev;                   // 戒指顯影：進度（0..1）、熱度
uniform float uPeriod;               // 大字的網線週期（px）
uniform vec2 uSig; uniform vec2 uSigT; // 簽名的左右（x0, x1）與寫的時間（開始、結束）
uniform vec3 uThread;                // 金屬箔的閃光：位置（y）、強度、-
uniform vec2 uShadow;                // 鈔票的影子偏移
uniform vec3 uSpark;                 // 仙女棒的位置與亮度：紙是亮的，只靠加亮的火花看不清楚，這裡再墊一圈有顏色的光
uniform vec3 uUV;                    // 驗鈔燈（紫外線）：光帶中心 x（平面座標）、強度、-
uniform mat3 uInv;                   // 鏡頭：螢幕 px → 桌面平面座標（齊次）
uniform sampler2D uLyr;              // 桌面上的歌詞（fast Layer2D：預乘、sRGB 編碼）
uniform vec2 uLyrY;                  // 歌詞那一條在平面上的 y 起點與高度

// ---- 交扣的婚戒（物件座標：一個單位 = ${MED.unit} px，y 向上）
const float RM = 0.47;
const vec3 CA = vec3(-0.25, 0.0, 0.0), CB = vec3(0.25, 0.0, 0.0);
const vec2 ABA = vec2(0.036, 0.098), ABB = vec2(0.031, 0.08); // 管的截面：徑向半厚、軸向半寬（一只寬一只細）
float sdE(vec2 q, vec2 ab) { float k0 = length(q / ab), k1 = length(q / (ab * ab)); return k0 * (k0 - 1.0) / max(k1, 1e-5); }
float ringA(vec3 p) { p -= CA; return sdE(vec2(length(p.xy) - RM, p.z), ABA); }
float ringB(vec3 p) { p -= CB; return sdE(vec2(length(p.xz) - RM, p.y), ABB); }
float rings(vec3 p) { return min(ringA(p), ringB(p)); }
vec3 ringsN(vec3 p) {
  const vec2 e = vec2(0.0015, -0.0015);
  return normalize(e.xyy * rings(p + e.xyy) + e.yyx * rings(p + e.yyx) + e.yxy * rings(p + e.yxy) + e.xxx * rings(p + e.xxx));
}

void main() {
  // 螢幕 → 桌面平面（鏡頭有傾斜、有透視）；之後所有東西都用平面座標 p 算
  vec3 hq = uInv * vec3(pxDown(), 1.0);
  vec2 p = hq.xy / hq.z;
  vec2 uv = vec2(p.x / ${W}.0, 1.0 - p.y / ${H}.0);
  vec4 bk = texture(uBake, uv);
  vec4 mk = texture(uMask, uv);
  vec2 nc = NOTE_R.xy + NOTE_R.zw * 0.5, nh = NOTE_R.zw * 0.5;
  float fib = bk.b;

  // ---- 桌面與鈔票的紙
  float dPaper = sdRBox(p, nc, nh, 12.0);
  // 邊緣反鋸齒跟著透視走（遠端一個平面 px 比螢幕 px 小）
  float aaP = max(fwidth(dPaper), 0.4);
  float inPaper = 1.0 - smoothstep(-aaP, aaP, dPaper);
  // 影子：主光從左上來，影子落在右下，柔一點（紙離桌面有一點點高）
  float dSh = sdRBox(p, nc + uShadow, nh, 12.0);
  float shadow = (1.0 - smoothstep(-14.0, 48.0, dSh)) * 0.3 + (1.0 - smoothstep(-2.0, 7.0, dSh)) * 0.1;
  // 桌面：比紙深一階的暖色（紙才浮得出來），拉長的纖維紋；超出烘焙範圍也要有，所以用程序雜訊
  float grain = 0.5 + 0.3 * snoise(p * vec2(0.0035, 0.024)) + 0.14 * snoise(p * 0.019 + 3.0);
  // v2：鏡頭拉遠、桌面露出來比較多：桌面比紙深兩階（紙才浮得出來，下面那張舊鈔票也分得出來）
  vec3 desk = mix(C_PAPER, C_SEPIA, 0.36) * (0.9 + 0.1 * grain) * (1.0 - shadow);
  vec3 paper = C_PAPER * (0.965 + 0.045 * fib);
  // 紙的邊緣一點點磨損的暗；紙不是完全平的，有很淡的起伏
  paper *= (1.0 - 0.05 * smoothstep(-10.0, 0.0, dPaper)) * (1.0 + 0.018 * snoise(p / 430.0 + 1.7));
  // 底下斜斜壓著一張舊鈔票（整疊的感覺）：同一套外框（取烘焙的底紋，淡一點、舊一點），比上面那張暗
  {
    vec2 q2 = rot2(0.075) * (p - nc - vec2(-70.0, 58.0)) + nc;
    float d2 = sdRBox(q2, nc, nh, 12.0);
    float in2 = 1.0 - smoothstep(-1.0, 1.0, d2);
    if (in2 > 0.0) {
      vec4 bk2 = texture(uBake, vec2(q2.x / ${W}.0, 1.0 - q2.y / ${H}.0));
      vec3 old = mix(C_PAPER, C_SEPIA, 0.12) * (0.9 + 0.04 * bk2.b);
      old = mix(old, C_SEPIA, 0.45 * bk2.r);
      old *= 1.0 - 0.1 * smoothstep(-12.0, 0.0, d2);
      // 舊鈔票自己落在桌上的影子（很淡）
      desk = mix(desk, old * (1.0 - 0.55 * shadow), in2);
    }
  }
  vec3 col = mix(desk, paper, inPaper);
  // 暖色主光：左上最亮、往右下慢慢暗下去（紙最亮處不超過原本的紙色，不比 bone 刺眼）
  vec2 lq = (p - vec2(380.0, 200.0)) / 1150.0;
  float light = 0.66 + 0.36 * exp(-0.5 * dot(lq, lq));
  // 紙上緣之外的桌面是鏡頭遠處：再暗一點，空間才有深度
  light *= mix(0.84, 1.0, smoothstep(-160.0, 260.0, p.y));


  float ink = 0.0;       // 墨色（sepia）
  float tint = 0.0;      // 套色（淺的訊號色）
  float acc = 0.0;       // 訊號色的暗部（序號、印章）
  float rose = 0.0;      // 點綴色（留言裡的愛心）
  // 燙：剛印上去的字、仙女棒的尾巴。紙是亮的，光用「加」的會變成一團白，所以改成把顏色換成（會發光的）訊號色
  float hot = 0.0;

  // ---- 外框：從左上角往兩邊描，最後在右下角接起來
  vec2 nq = (p - nc) / nh;
  float ang = atan(nq.y, nq.x);
  float v = abs(mod(ang + 0.75 * PI + PI, TAU) - PI) / PI; // 0 = 左上角，1 = 右下角
  float fr = bk.r * smoothstep(v - 0.02, v, uFrame) * uNote;
  ink = max(ink, fr);
  hot = max(hot, bk.r * exp(-abs(uFrame - v) * 30.0) * step(uFrame, 1.02) * uNote);
  ink = max(ink, bk.a * 0.1 * uUnder);
  tint = max(tint, bk.g * 0.8 * uUnder);
  // 套色的底色（鈔票的「彩虹印刷」）：徽章周圍一片很淡的訊號色，往左慢慢退成紙色
  float wash = 0.16 * (1.0 - smoothstep(120.0, 760.0, length((p - MED_C) * vec2(0.8, 1.2)))) + 0.05 * smoothstep(1300.0, 200.0, p.x);
  tint = max(tint, wash * uUnder * step(sdRBox(p, nc, nh - 84.0, 8.0), 0.0));

  // ---- 玫瑰花飾（會動：振幅跟著音樂、整圈慢慢轉；仙女棒描到哪、墨就印到哪）
  vec2 mq = p - MED_C;
  float rr = length(mq);
  if (rr > ${ROS.rules[0] - 6}.0 && rr < ${ROS.rules[2] + 6}.0) {
    float th = atan(mq.y, mq.x);
    float u = mod(th + 0.5 * PI, TAU); // 從正上方順時針
    float tw = uRos.x, am = uRos.y;
    float ro = 0.0;
    if (rr < ${ROS.rules[1]}.0) {
      ro = rosette(rr, th, ${ROS.inner.R}.0, ${ROS.inner.a}.0 * am, ${ROS.inner.n}.0, ${ROS.inner.K}.0, 0.8, -tw * 0.7);
    } else {
      ro = rosette(rr, th, ${ROS.outer.R}.0, ${ROS.outer.a}.0 * am, ${ROS.outer.n}.0, ${ROS.outer.K}.0, 0.9, tw);
      ro = max(ro, 0.7 * rosette(rr, th, ${ROS.outer.R}.0, ${ROS.outer.a}.0 * am, -${ROS.outer.n}.0, 4.0, 0.8, 0.2 - tw));
    }
    float rules = max(max(lAA(rr - ${ROS.rules[0]}.0, 1.6), lAA(rr - ${ROS.rules[1]}.0, 1.1)), max(lAA(rr - ${ROS.rules[2]}.0, 1.6), lAA(rr - ${ROS.rules[2] - 4}.0, 0.8)));
    float behind = mod(uRos.z - u, TAU);           // 仙女棒後面多遠（弧度）
    float shown = uRos.z >= TAU - 1e-3 ? 1.0 : step(u, uRos.z);
    float art = max(ro * 0.85, rules);
    ink = max(ink, art * mix(uRos.w, 1.0, shown) * uNote);
    hot = max(hot, art * shown * exp(-behind * ${ROS.outer.R}.0 / 190.0) * uHot.x);
    // 每四小節仙女棒再繞一圈：後面拖一段燙的尾巴（只到它這一圈走過的地方）
    float bs = mod(uHot.y - u, TAU);
    hot = max(hot, art * exp(-bs * ${ROS.outer.R}.0 / 150.0) * step(bs, uHot.y) * uHot.z);
  }

  // ---- 肖像圓：交扣的婚戒（光線步進；只在圓裡算）
  if (rr < ${MED.rp + 3}.0) {
    vec2 w2 = vec2(mq.x, -mq.y) / ${MED.unit}.0; // 物件單位、y 向上
    float rn = rr / ${MED.rp}.0;
    mat3 Mt = transpose(uRot);
    vec3 L = normalize(vec3(-0.5, 0.62, 0.62));
    vec3 ro3 = Mt * vec3(w2, 2.0), rd3 = Mt * vec3(0.0, 0.0, -1.0);
    float b2 = dot(w2, w2);
    float tt = 2.0 - sqrt(max(0.0, 0.93 * 0.93 - b2)), dmin = 1e3;
    bool hit = false;
    if (b2 < 0.93 * 0.93) {
      for (int i = 0; i < 64; i++) {
        float h = rings(ro3 + rd3 * tt);
        dmin = min(dmin, h);
        if (h < 0.0012) { hit = true; break; }
        tt += h * 0.85;
        if (tt > 4.2) break;
      }
    }
    // 背景：細橫線（像 pdoom 月亮的浮雕線），越靠近圓邊越密。戒指周圍留一圈白（版畫家分開主體與背景的做法），
    // 不畫投影：投影在細線背景上只會變成一團髒灰。
    float halo = smoothstep(0.02, 0.075, dmin) * mix(1.0, 0.0, 1.0 - uDev.x);
    float bgDark = (0.07 + 0.3 * smoothstep(0.5, 1.0, rn)) * mix(1.0, halo, uDev.x);
    float bgInk = hatch(p.y / 4.4, bgDark) * (1.0 - smoothstep(0.985, 1.0, rn));
    // 背景線跟花飾一樣，仙女棒掃到哪、印到哪（徽章整個是它「描」出來的）
    float uP = mod(atan(mq.y, mq.x) + 0.5 * PI, TAU);
    bgInk *= uRos.z >= TAU - 1e-3 ? 1.0 : mix(uRos.w, 1.0, step(uP, uRos.z));
    float ringInk = 0.0, heatR = 0.0;
    if (hit) {
      vec3 hp = ro3 + rd3 * tt;
      vec3 nw = uRot * ringsN(hp);
      bool isA = ringA(hp) < ringB(hp);
      vec3 lp = hp - (isA ? CA : CB);
      vec2 ab = isA ? ABA : ABB;
      vec2 cs = isA ? vec2(length(lp.xy) - RM, lp.z) : vec2(length(lp.xz) - RM, lp.y);
      float phi = isA ? atan(lp.y, lp.x) : atan(lp.z, lp.x);
      float psi = atan(cs.y / ab.y, cs.x / ab.x);
      float lam = max(dot(nw, L), 0.0);
      float spec = pow(max(dot(reflect(-L, nw), vec3(0.0, 0.0, 1.0)), 0.0), 10.0);
      // 金屬：環境（上亮下暗）反射在戒面上形成明暗帶，加上燈的漫射；戒指內側（背光）最暗
      float env = smoothstep(-0.5, 0.7, nw.y + 0.3 * nw.x);
      float inside = smoothstep(0.0, -0.02, cs.x); // 管截面靠圓心那一側 = 戒指的內面
      float dark = sat(1.02 - 0.42 * lam - 0.45 * env + 0.28 * inside);
      // 版畫：沿著戒圈走的平行線，暗處線粗、亮處剩細線、高光留白；最暗的內面再加一層橫過戒圈的交叉線
      float lines = hatch(psi / TAU * 16.0, 0.1 + 0.86 * dark * dark);
      float cross = hatch(phi / TAU * 40.0 + psi / TAU * 7.0, sat((dark - 0.72) * 2.2)); // 斜斜交叉，不要像梯子
      ringInk = max(lines, cross) * (1.0 - smoothstep(0.25, 0.6, spec));
      ringInk = max(ringInk, smoothstep(0.3, 0.08, abs(nw.z)));   // 輪廓：側面轉過去的邊
      // 顯影：沿著戒指一圈刻出來，刀口是燙的
      float a01 = fract(phi / TAU + (isA ? 0.25 : 0.75));
      float reveal = smoothstep(a01 - 0.03, a01, uDev.x * 1.06) * step(0.001, uDev.x);
      heatR = exp(-abs(uDev.x * 1.06 - a01) * 14.0) * uDev.y;
      ringInk *= reveal;
      bgInk *= 1.0 - reveal;  // 戒指擋住背景
    } else {
      // 沒打到：離戒指很近的像素畫輪廓（反鋸齒）
      float edge = 1.0 - smoothstep(0.35, 1.5, dmin * ${MED.unit}.0 * PX_SCALE);
      ringInk = edge * smoothstep(0.0, 0.3, uDev.x);
    }
    float por = max(bgInk, ringInk) * (1.0 - smoothstep(1.0, 1.02, rn));
    ink = max(ink, por * uNote);
    hot = max(hot, heatR * ringInk);
  }

  // ---- 防偽金屬帶：一條直的燙箔（套色＋細斜紋，兩邊細框），大鼓一打就有一道光往下跑。
  float dx = abs(p.x - ${THREAD_X}.0);
  // 箔是燙在紙上的：從紙的上緣貫穿到下緣（壓在外框上），才不會看起來像一條分隔線
  if (dx < 9.0 && p.y > NOTE_R.y && p.y < NOTE_R.y + NOTE_R.w) {
    float body = (1.0 - smoothstep(5.5, 6.5, dx)) * inPaper;
    float diag = hatch((p.x + p.y) / 3.4, 0.3);
    float sheenY = 0.5 + 0.5 * sin(p.y * 0.021 + uT * 0.8);   // 箔面的明暗慢慢流動
    // 箔壓淡一點：它是紙上的配角，不要像一條分隔線搶眼
    tint = max(tint, body * (0.42 + 0.28 * sheenY) * uNote);
    // 箔蓋住底下的印刷：先把墨擦掉，再畫箔自己的紋路
    ink *= 1.0 - body * 0.85;
    ink = max(ink, (body * diag * 0.26 * smoothstep(0.5, 3.5, dx) + lAA(dx - 6.0, 0.9) * 0.75 * inPaper) * uNote);
    float gl = exp(-pow((p.y - uThread.x) / 38.0, 2.0)) * uThread.y;
    hot = max(hot, gl * body);
  }

  // ---- 文字遮罩：顏色編碼類別（k = B/R）：0 雕版網線大字、0.5 愛心（點綴色）、1 訊號色（序號、印章）、
  // 4 簽名（照 x 位置由左往右寫出來）、很大（R=0）一般的字。G = 印出來的時間（相對窗格開始，uSpan 秒為滿格）。
  float cov = max(mk.r, mk.b);
  if (cov > 0.002) {
    float tRev = uS + mk.g / cov * uSpan;
    float k = mk.b / max(mk.r, 1e-3);
    if (k > 2.0 && k < 9.0) tRev = mix(uSigT.x, uSigT.y, sat((p.x - uSig.x) / max(1.0, uSig.y - uSig.x)));
    float age = uT - tRev;
    float on = cov * smoothstep(0.0, 0.07, age);
    float heat = age > 0.0 ? exp(-age / 0.32) : 0.0;
    float grit = 0.9 + 0.1 * snoise(p * 0.35);
    if (k > 2.0) ink = max(ink, on * 0.96 * grit);
    else if (k > 0.75) {
      // 印章墨：有一點不均勻（印泥）
      float void_ = smoothstep(0.35, 0.75, snoise(p * 0.06) * 0.5 + 0.5 + 0.35 * snoise(p * 0.5));
      acc = max(acc, on * (1.0 - 0.45 * void_));
    } else if (k > 0.25) {
      // 愛心：點綴色，也用雕版網線印（跟大字同一套印法）
      rose = max(rose, on * max(hatch(p.y / uPeriod, mix(0.3, 0.9, smoothstep(0.0, 0.4, age))), 0.5));
    }
    else {
      // 雕版大字：水平網線，剛印上去時線很細、慢慢變粗；網線之間透一點紙色
      float dk = mix(0.3, 0.9, smoothstep(0.0, 0.4, age));
      float lines = hatch(p.y / uPeriod, dk);
      ink = max(ink, on * max(lines, 0.5) * grit);
    }
    hot = max(hot, heat * on);
  }

  // ---- 仙女棒的光暈（有顏色，紙上才看得到）
  vec2 sd = p - uSpark.xy;
  hot = max(hot, uSpark.z * exp(-dot(sd, sd) / (2.0 * 26.0 * 26.0)) * 0.85);

  // ---- 上色：紙 → 套色 → 墨 → 訊號色 → 點綴色 → 發光
  vec3 tintCol = mix(C_PAPER, mix(C_SIGNAL, C_BLOOD, 0.4), 0.5);
  col = mix(col, tintCol, tint * inPaper);
  col = mix(col, C_SEPIA, sat(ink) * 0.94);
  col = mix(col, C_BLOOD, sat(acc) * 0.95);
  col = mix(col, C_ROSE * 0.85, sat(rose));
  // 桌面上的歌詞：跟桌面同一個平面，一樣吃主光
  if (p.y > uLyrY.x && p.y < uLyrY.x + uLyrY.y) {
    vec4 lc = texture(uLyr, vec2(p.x / ${W}.0, 1.0 - (p.y - uLyrY.x) / uLyrY.y));
    vec3 lin = lc.a > 0.0 ? toLinear(lc.rgb / lc.a) * lc.a : vec3(0.0);
    col = col * (1.0 - lc.a) + lin;
  }
  col *= light;
  // ---- 驗鈔燈（v2 多補的動畫，鈔票自己的防偽特徵）：每幾個小節一道紫外線光帶從左掃到右，
  //      光帶經過的地方，紙裡藏的螢光纖維（短短的彎線）與一個隱藏的「∞ 與愛心」浮水印亮起來（點綴色與訊號色），
  //      掃過就暗回去。平常看不到，只有驗鈔燈照到才出現——跟真的鈔票一樣。
  if (uUV.y > 0.001 && inPaper > 0.0) {
    float band = exp(-pow((p.x - uUV.x) / 170.0, 2.0)) * uUV.y * inPaper;
    if (band > 0.002) {
      // 螢光纖維：每格一根短短的彎線，方向、顏色（點綴色或訊號色）隨機
      vec2 cell = floor(p / 46.0), fc = fract(p / 46.0) - 0.5;
      float h1 = hash12(cell + 11.0), h2 = hash12(cell + 29.0), h3 = hash12(cell + 47.0);
      float ang = h1 * TAU;
      vec2 dir = vec2(cos(ang), sin(ang));
      vec2 q = fc - (vec2(h2, h3) - 0.5) * 0.4;
      float along = dot(q, dir), across = dot(q, vec2(-dir.y, dir.x)) + 0.35 * along * along * (h2 - 0.5);
      float fiber = step(0.45, h3) * (1.0 - smoothstep(0.012, 0.03, abs(across))) * (1.0 - smoothstep(0.18, 0.24, abs(along)));
      // 隱藏的浮水印：花飾左下方一個大大的愛心輪廓（只有邊框、很細）
      vec2 hq = (p - vec2(1180.0, 620.0)) / 90.0;
      hq.y = -hq.y + 0.25;
      float hd = pow(hq.x * hq.x + hq.y * hq.y - 1.0, 3.0) - hq.x * hq.x * hq.y * hq.y * hq.y;
      float heartLine = 1.0 - smoothstep(0.0, 0.18, abs(hd));
      vec3 fcol = mix(C_ROSE, C_SIGNAL, step(0.5, h1));
      col += fcol * 1.3 * fiber * band;
      col += C_SIGNAL * 0.8 * heartLine * band;
      // 紫外線本身讓紙微微泛藍紫（用訊號色的暗部，不寫死顏色）
      col = mix(col, col * mix(vec3(1.0), C_BLOOD / max(max(C_BLOOD.r, C_BLOOD.g), C_BLOOD.b), 0.25), band);
    }
  }
  // 燙的東西自己會發光，不吃主光
  col = mix(col, C_SIGNAL * 1.75, sat(hot));
  fragColor = vec4(col, 1.0);
}`;

export const makeMainPass = () => new FSPass(MAIN_FRAG, {
  uBake: { value: null }, uMask: { value: null },
  uT: { value: 0 }, uS: { value: 0 }, uSpan: { value: 1 },
  uFrame: { value: 0 }, uUnder: { value: 0 }, uNote: { value: 1 },
  uRos: { value: new THREE.Vector4(0, 1, 0, 0.1) }, uHot: { value: new THREE.Vector4() },
  uRot: { value: new THREE.Matrix3() }, uDev: { value: new THREE.Vector2() },
  uPeriod: { value: 4 },
  uSig: { value: new THREE.Vector2(0, 1) }, uSigT: { value: new THREE.Vector2(0, 1) },
  uThread: { value: new THREE.Vector3(-999, 0, 0) },
  uShadow: { value: new THREE.Vector2(12, 20) },
  uSpark: { value: new THREE.Vector3(0, 0, 0) },
  uUV: { value: new THREE.Vector3(-9999, 0, 0) },
  uInv: { value: new THREE.Matrix3() },
  uLyr: { value: null }, uLyrY: { value: new THREE.Vector2(0, 1) },
});
