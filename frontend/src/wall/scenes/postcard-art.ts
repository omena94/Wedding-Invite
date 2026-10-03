// 明信片（postcard）的美術：3D 的桌面（亞麻布、檯燈的光、景深、卡片的影子）、正面的雕版風景、背面的紙、3D 卡片的材質，
// 背面「印好的」部分（表頭、郵票、地址欄）與郵戳，以及前景虛化的鋼筆。
// 座標：卡片上的東西一律用「卡面座標」（左上角 (0,0)、y 向下、1 單位 = 鏡頭在基準距離時螢幕上的 1 px）。
// 世界座標：桌面是 z = 0 的平面、y 向上，卡片靜止時中心在原點。
// MV 融合原則：畫面上只有一個焦點（留言；沒有留言時是歌詞），其他字一律小（≤ 22 px）、淡，集中成兩小群（表頭、右邊的郵務欄）。
// v2（留言板不要太大、空出來的地方多補動畫）：鏡頭拉遠，卡片在螢幕上只有約 0.49 倍（≈ 640×417，卡片本身就是留言的容器）；
// 背面的留言區加寬（郵務欄縮成右邊窄窄一條）；桌上多了道具（茶杯、散落的郵票、一個信封：畫在桌面 shader 取樣的一張圖上）、
// 窗外樹影在桌布上晃；前景是一叢失焦的葉子（取代原本失焦的鋼筆：真的鋼筆現在會在卡片上寫字）。
import * as THREE from 'three';
import { FSPass, makeRT, W, H } from '../engine/gl';
import { GLSL_COMMON, THEME_UNIFORMS } from '../engine/glsl/common';
import { F, font, measure } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { mulberry32, TAU } from '../engine/util';
import { DATE_DOT } from './_motifs';

/** 卡片大小（約 148×100 mm 的比例）。 */
export const CW = 1300, CH = 846;
/** 正面：風景的範圍（其餘是白邊）、底下寬邊是圖說。 */
export const PIC = { x0: 38, y0: 38, x1: CW - 38, y1: 640 };
/** 背面的格局：留言占左邊大部分；右邊一條窄窄的郵務欄（郵票、郵戳、地址，全部小而淡）；最下面一條 P.S.（歌詞）。 */
export const BACK = {
  headY: 62,
  msg: { x: 64, y: 92, w: 978, h: 604 },
  divX: 1064,
  right: { x0: 1086, x1: 1258 },
  stamp: { x: 1150, y: 36, w: 104, h: 128 },
  mark: { x: 1112, y: 158, r: 50 },
  zipY: 262,
  addr: [360, 440, 520],
  psRule: 706,
  ps: { x: 64, y0: 716, y1: 834, x1: 1250 },
};

// ---------------------------------------------------------------- 3D：桌面（亞麻布＋檯燈的光＋景深＋卡片的影子）
const TABLE_VERT = /* glsl */ `
precision highp float;
in vec3 position;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
out vec3 vWP;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const TABLE_FRAG = /* glsl */ `
precision highp float;
precision highp int;
in vec3 vWP;
out vec4 fragColor;
uniform vec3 cameraPosition;
uniform float focus;       // 對焦距離（鏡頭到卡片）
uniform vec2 lamp;         // 檯燈照在桌上的光斑中心（世界座標）
uniform vec4 shC;          // 影子中心 xy、半寬高（世界座標）
uniform vec3 shP;          // 旋轉、模糊半徑、濃度
uniform float uT;          // 時間（樹影在風裡晃）
uniform sampler2D propsTex; // 桌上的道具（茶杯、郵票、信封）：一張 fast 圖層，蓋在 propsR 這個範圍（世界座標）
uniform vec4 propsR;
uniform float propsOn;
${GLSL_COMMON}
void main() {
  vec2 p = vWP.xy;
  // 景深：離對焦面越遠（畫面上緣比較遠、下緣比較近），布紋的細節越糊（高頻淡掉，只剩大塊的明暗）
  float depth = distance(cameraPosition, vWP);
  float blur = sat(abs(depth - focus) / focus * 5.5);
  float n1 = snoise(vec2(p.x * 0.02, p.y * 0.3)), n2 = snoise(vec2(p.x * 0.3, p.y * 0.02));
  float wx = 0.5 + 0.5 * sin(p.x * 1.15 + n1 * 2.0);
  float wy = 0.5 + 0.5 * sin(p.y * 1.15 + n2 * 2.0);
  float over = step(0.5, fract((floor(p.x / 5.46) + floor(p.y / 5.46)) * 0.5));
  float weave = mix(wx, wy, over) - 0.5;
  float slub = 0.5 * snoise(vec2(p.x * 0.004, p.y * 0.21)) + 0.5 * snoise(vec2(p.x * 0.21, p.y * 0.004));
  vec3 col = mix(C_PAPER, C_SEPIA, 0.42) * (0.95 + (0.075 * weave + 0.04 * slub) * (1.0 - blur) + 0.05 * fbm(p * 0.0012, 2));
  // 檯燈：左上方一盞燈，桌上一圈暖暖的光，往外慢慢暗下去（背景要能呼吸：光斑是唯一的大塊明暗）
  float d = length(p - lamp);
  float pool = exp(-d * d / (1350.0 * 1350.0));
  col *= 0.7 + 0.46 * pool;
  col = mix(col, col * (C_EMBER / max(max(C_EMBER.r, C_EMBER.g), C_EMBER.b)), 0.18 * pool);
  // 桌上的道具（景深：離對焦面遠的地方貼圖也跟著糊一點，取比較粗的 mip）
  if (propsOn > 0.5) {
    vec2 pu = (p - propsR.xy) / propsR.zw;
    if (pu.x > 0.0 && pu.x < 1.0 && pu.y > 0.0 && pu.y < 1.0) {
      vec4 pr = fastLayer(texture(propsTex, pu));
      col = col * (1.0 - pr.a) + pr.rgb * (0.55 + 0.6 * pool);
    }
  }
  // 窗外的樹影：只在畫面右上方的桌布上，很慢地在風裡晃（葉縫之間是亮的）
  vec2 lp = p * 0.0021 + vec2(0.3 * sin(uT * 0.45) + 0.07 * sin(uT * 1.3), 0.14 * sin(uT * 0.33 + 1.0));
  float leafM = smoothstep(400.0, 1900.0, p.x) * smoothstep(0.0, 1000.0, p.y);
  col *= 1.0 - 0.1 * leafM * smoothstep(0.17, 0.25, fbm(lp, 3));
  // 卡片的影子：旋轉過的方框、邊緣模糊（抬得越高越模糊越淡）
  vec2 q = rot2(shP.x) * (p - shC.xy);
  float sd = sdBox(q, shC.zw);
  col *= 1.0 - (1.0 - smoothstep(-shP.y, shP.y, sd)) * shP.z;
  fragColor = vec4(col, 1.0);
}`;

/** 卡面的紙色（正面白邊、背面共用）：比桌面亮、很細的纖維。不比 bone 刺眼。 */
const PAPER_GLSL = /* glsl */ `
vec3 cardPaper(vec2 p) {
  vec3 c = mix(C_PAPER, C_BONE, 0.35);
  return c * (0.985 + 0.018 * snoise(p * vec2(0.05, 0.11)) + 0.008 * snoise(p * 0.7));
}`;

// ---------------------------------------------------------------- 正面：雕版風景（render 到卡面大小的 RT）
/** 風景原本是照 1102 px 寬的畫面設計的；放大的卡面用同一套座標乘上這個比例（線距跟著變疏，畫面比較透氣）。 */
const LS = 1102 / (PIC.x1 - PIC.x0);
export const LAND = () => new FSPass(/* glsl */ `
  ${PAPER_GLSL}
  uniform float t; uniform float kick; uniform float bass; uniform float seed; uniform float boatX; uniform float bob;
  // picB：風景框的下緣。平常是 PIC.y1；韓文歌（圖說多一排原文）時往上收，底下的白邊變寬（風景照原本的座標，只是下面少一截湖面）
  uniform float picB;
  vec4 PIC = vec4(${PIC.x0}.0, ${PIC.y0}.0, ${PIC.x1}.0, ${PIC.y1}.0);
  const float HZ = 352.0;              // 地平線（風景座標，y 向下）
  const vec2 SUN = vec2(770.0, 250.0);
  const float R = 50.0;
  // 山稜：只跟 x 有關的脊狀雜訊（兩層就夠，這張圖要每格算）
  float ridged(float x, float f, float s) {
    float n = 0.65 * (1.0 - abs(snoise(vec2(x * f, s))));
    n += 0.35 * (1.0 - abs(snoise(vec2(x * f * 2.3, s + 13.7))));
    return n;
  }
  float yFar(float x)  { return HZ - 46.0 - 150.0 * ridged(x, 0.0021, seed); }
  float yMid(float x)  { return HZ - 12.0 - 118.0 * ridged(x + 300.0, 0.0033, seed + 5.0) * (0.5 + 0.5 * smoothstep(960.0, 280.0, x)); }
  // 近景：左邊一塊伸進湖裡、圓圓的岬角（平滑的起伏，稜線上一排小小的樹梢）
  float yBody(float x) { return HZ + 2.0 - 200.0 * smoothstep(620.0, 10.0, x) * (0.8 + 0.2 * snoise(vec2(x * 0.004, seed + 9.0))); }
  float yNear(float x) {
    float k = x / 17.0, f = fract(k) - 0.5;
    float tree = (5.0 + 5.0 * hash11(floor(k) + seed)) * sqrt(max(0.0, 0.25 - f * f)) * 2.0;
    return yBody(x) - tree * smoothstep(470.0, 300.0, x);
  }
  // 自己算反鋸齒寬度的平行線（hatch 用 fwidth，放射線在 atan 接縫會斷）
  float lines(float u, float dark, float aa) {
    float f = abs(fract(u) - 0.5), hw = 0.5 * sat(dark);
    return 1.0 - smoothstep(hw - aa, hw + aa, 0.5 - f);
  }
  float mask(float a) { return smoothstep(-0.7, 0.7, a); }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${CH}.0 - FRAG_PX.y);
    vec3 paper = cardPaper(p);
    vec2 q = (p - PIC.xy) * ${LS.toFixed(5)};
    float x = q.x;
    float yf = yFar(x), ym = yMid(x), yn = yNear(x);
    // 坡度（往右下降 = 面向右邊的太陽 = 亮）：取寬一點的差分，陰影才不會一條一條跳
    float sf = (yFar(x + 9.0) - yFar(x - 9.0)) / 18.0, sm = (yMid(x + 9.0) - yMid(x - 9.0)) / 18.0;
    float land = 1.0 - mask(q.y - HZ);
    float inNear = mask(q.y - yn) * land;
    float inMid = mask(q.y - ym) * land * (1.0 - inNear);
    float inFar = mask(q.y - yf) * land * (1.0 - inNear) * (1.0 - inMid);
    float inWater = 1.0 - land;
    float inSky = max(0.0, 1.0 - inNear - inMid - inFar - inWater);

    // ---- 天空：稀疏的橫向雕版線，只在上緣淡淡的一層（天空大部分留白，畫面才透氣）；雲是線斷掉的地方
    float dS = length(q - SUN);
    float cloud = fbm(vec2(q.x * 0.0032 + t * 0.012 + seed, q.y * 0.017), 2);
    float skyD = mix(0.3, 0.0, smoothstep(0.0, HZ * 0.8, q.y)) * smoothstep(R * 1.3, R * 5.0, dS);
    skyD *= 1.0 - 0.75 * smoothstep(0.05, 0.4, cloud);
    float skyInk = hatch(q.y / 4.6, skyD);
    // 太陽：同心圓線＋一圈外框；光芒是放射的細線，大鼓一打就伸長
    float sunIn = 1.0 - smoothstep(R - 0.8, R + 0.8, dS);
    float sunInk = hatch(dS / 4.6, 0.16) * sunIn + pxLine(abs(dS - R), 0.4, 1.3) * 0.8;
    float ang = atan(q.y - SUN.y, q.x - SUN.x);
    float rayLen = R * (1.85 + 0.9 * kick);
    float rays = lines(ang * 56.0 / TAU, 0.14, 56.0 / TAU / max(dS, 1.0) * 1.2)
      * smoothstep(R * 1.1, R * 1.3, dS) * (1.0 - smoothstep(rayLen * 0.6, rayLen, dS));
    vec3 skyWash = mix(paper, C_SIGNAL, 0.45 * sat(exp(-dS / 230.0) + 0.55 * smoothstep(HZ - 240.0, HZ, q.y)));
    vec3 sunWash = mix(paper, C_EMBER, 0.7);

    // ---- 山：三層，遠的線淡而密、近的深而疏；面向太陽的坡淡一點，山腳有霧
    float mist = 1.0 - 0.6 * smoothstep(HZ - 70.0, HZ, q.y);
    float dF = (0.1 + 0.06 * smoothstep(0.0, 140.0, q.y - yf) - 0.05 * clamp(sf * 2.0, -1.0, 1.0)) * mist;
    float dM = (0.2 + 0.1 * smoothstep(0.0, 120.0, q.y - ym) - 0.1 * clamp(sm * 2.0, -1.0, 1.0)) * mist;
    // 近景的線順著稜線的形狀往下排（版畫的「隨形線」），越往下越濃，最深處再加一層交叉線
    float yb = yBody(x);
    float dN = 0.24 + 0.22 * smoothstep(0.0, 150.0, q.y - yb);
    float farInk = hatch((rot2(0.1) * q).y / 3.0, dF);
    float midInk = hatch((rot2(-0.62) * q).y / 3.8, dM);
    float nearInk = max(hatch((q.y - yb) / 4.6, dN), hatch((rot2(0.9) * q).y / 5.0, sat((dN - 0.4) * 2.0)));
    nearInk = max(nearInk, hatch((rot2(-0.9) * q).y / 3.2, 0.5) * (1.0 - smoothstep(-0.5, 0.5, q.y - yb)));
    // 稜線：只畫看得到的那一段（被前面的山擋住的不畫）
    float oF = pxLine(abs(q.y - yf), 0.35, 1.2) * step(q.y, ym) * step(q.y, yn) * land;
    float oM = pxLine(abs(q.y - ym), 0.45, 1.3) * step(q.y, yn) * land;
    float oN = pxLine(abs(q.y - yn), 0.6, 1.5) * land * step(yn, HZ - 1.0);

    // ---- 湖：越遠越密的橫向波紋線（跟著低音晃），倒影、太陽的光帶
    float dy = max(q.y - HZ, 0.0);
    float wob = sin(q.x * 0.05 + t * 1.6 + dy * 0.21) * (0.05 + 0.2 * bass) + sin(q.x * 0.013 - t * 0.9) * 0.05;
    float wu = sqrt(dy) * 3.1 + wob;
    float reflN = 1.0 - smoothstep(-1.0, 1.0, q.y - (HZ + (HZ - yn) * 0.72));
    float reflM = 1.0 - smoothstep(-1.0, 1.0, q.y - (HZ + (HZ - ym) * 0.5));
    float gw = 12.0 + dy * 0.5;
    float path = exp(-pow((q.x - SUN.x) / gw, 2.0));
    float wD = (0.08 + 0.1 * smoothstep(0.0, 180.0, dy) + 0.22 * reflN + 0.07 * reflM * (1.0 - reflN)) * (1.0 - 0.85 * path);
    // 小船：在湖上慢慢漂，拍點上輕輕上下
    vec2 b = q - vec2(boatX, HZ + 66.0 + bob);
    float hull = max(abs(b.y + 1.0) - 7.0, abs(b.x) - (36.0 - (b.y + 8.0) * 1.2));
    float sail = max(max(1.5 - b.x, -80.0 - b.y), max(b.y + 12.0, b.x - (b.y + 80.0) / 68.0 * 34.0));
    float jib = max(max(b.x + 1.5, -70.0 - b.y), max(b.y + 12.0, -b.x - (b.y + 70.0) / 58.0 * 22.0));
    float mast = max(abs(b.x) - 1.2, max(-84.0 - b.y, b.y + 6.0));
    float boat = 1.0 - smoothstep(-0.7, 0.7, min(min(hull, mast), min(sail, jib)));
    vec2 br = vec2(b.x, -b.y - 14.0);
    float rs = max(max(1.5 - br.x, -80.0 - br.y), max(br.y + 12.0, br.x - (br.y + 80.0) / 68.0 * 34.0));
    wD += 0.26 * (1.0 - smoothstep(-0.7, 0.7, rs)) * step(0.0, sin(wu * 6.2832 * 0.5));
    float waterInk = hatch(wu, wD);
    float boatInk = boat * max(engrave(b, 0.7, 1.0 / 3.0, 0.5), 0.35);
    vec3 waterWash = mix(paper, C_SIGNAL, 0.08 + 0.45 * path * exp(-dy / 170.0));
    float horizon = pxLine(abs(q.y - HZ), 0.4, 1.2) * (1.0 - inNear);

    // ---- 合起來：先上色（手工洗色），再壓墨線
    vec3 wash = skyWash * inSky + mix(paper, C_SIGNAL, 0.12) * inFar + mix(paper, C_BLOOD, 0.08) * inMid
      + mix(paper, C_SEPIA, 0.12) * inNear + waterWash * inWater;
    wash = mix(wash, sunWash, sunIn * inSky);
    float ink = inSky * max(max(skyInk, sunInk), rays * 0.8) + inFar * farInk + inMid * midInk + inNear * nearInk
      + inWater * waterInk;
    ink = max(ink, max(max(oF * 0.8, oM * 0.9), oN) * 0.95);
    ink = max(ink, horizon * 0.7);
    ink = max(ink, boatInk * inWater);
    vec3 col = mix(wash, C_SEPIA, sat(ink) * 0.88);
    // 風景只在框裡；框外是白邊，框線一條細墨線
    PIC.w = picB;
    float inPic = step(PIC.x, p.x) * step(p.x, PIC.z) * step(PIC.y, p.y) * step(p.y, PIC.w);
    col = mix(paper, col, inPic);
    float frame = sdBox(p - (PIC.xy + PIC.zw) * 0.5, (PIC.zw - PIC.xy) * 0.5);
    col = mix(col, C_SEPIA, pxLine(abs(frame), 0.5, 1.3) * 0.7);
    fragColor = vec4(col, 1.0);
  }`, {
  t: { value: 0 }, kick: { value: 0 }, bass: { value: 0 }, seed: { value: 0 }, boatX: { value: 400 }, bob: { value: 0 }, picB: { value: PIC.y1 },
});

/** 背面的紙（字、郵票都在 Canvas2D 上，這裡只有紙本身）。 */
export const BACKPAPER = () => new FSPass(/* glsl */ `
  ${PAPER_GLSL}
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${CH}.0 - FRAG_PX.y);
    fragColor = vec4(cardPaper(p), 1.0);
  }`);

/**
 * 卡面的 RT：正反面一次只看得到一面，所以只要一張（看得到哪面就畫哪面）。
 * 有 mipmap＋非等向過濾：卡片斜放在空間裡、翻面時斜到快變一條線，雕版的細線與字才不會閃成摩爾紋。
 */
export const faceRT = () => {
  const rt = makeRT(CW, CH, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  rt.texture.anisotropy = 8;
  return rt;
};

// ---------------------------------------------------------------- 3D 卡片
const CARD_VERT = /* glsl */ `
precision highp float;
in vec3 position; in vec3 normal;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
out vec3 vLP; out vec3 vLN; out vec3 vWN; out vec3 vWP;
void main() {
  vLP = position; vLN = normal;
  vWN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const CARD_FRAG = /* glsl */ `
precision highp float;
precision highp int;
in vec3 vLP; in vec3 vLN; in vec3 vWN; in vec3 vWP;
out vec4 fragColor;
uniform sampler2D faceTex;
uniform vec2 lamp;
${GLSL_COMMON}
void main() {
  // 打光：燈在左上方高處。平放時亮度接近 1（卡面的顏色就是設計的顏色），靠燈的那一角亮一點、遠的那一角暗一點；
  // 翻起來的時候亮暗跟著變
  vec3 L = normalize(vec3(lamp - vWP.xy, 2600.0));
  float shade = clamp(mix(0.55, 1.0, max(dot(normalize(vWN), L), 0.0) / 0.93), 0.45, 1.08);
  float d = length(vWP.xy - lamp);
  shade *= 0.9 + 0.12 * exp(-d * d / (1500.0 * 1500.0));
  vec3 col;
  if (vLN.z > 0.5) {
    col = texture(faceTex, vec2(vLP.x / ${CW}.0 + 0.5, vLP.y / ${CH}.0 + 0.5)).rgb;
  } else if (vLN.z < -0.5) {
    // 背面：繞 x 軸翻過來看，左右不變、上下顛倒
    col = texture(faceTex, vec2(vLP.x / ${CW}.0 + 0.5, 0.5 - vLP.y / ${CH}.0)).rgb;
  } else {
    // 卡紙的切邊：比紙面暗一點
    col = mix(C_PAPER, C_SEPIA, 0.28);
  }
  fragColor = vec4(col * shade, 1.0);
}`;

/** 檯燈照在桌上的位置（世界座標，卡片的左上方）。 */
export const LAMP: [number, number] = [-520, 520];

/** 3D 的部分（桌面、卡片、鏡頭）整晚共用：同一時間只會有一張明信片在畫面上。 */
export const CARD3D = () => {
  const scene = new THREE.Scene();
  const fov = 22;
  const cam = new THREE.PerspectiveCamera(fov, W / H, 10, 30000);
  const table = new THREE.Mesh(new THREE.PlaneGeometry(9000, 7000), new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: TABLE_VERT, fragmentShader: TABLE_FRAG,
    uniforms: {
      ...THEME_UNIFORMS, focus: { value: 2800 }, lamp: { value: new THREE.Vector2(...LAMP) },
      shC: { value: new THREE.Vector4(0, 0, 1, 1) }, shP: { value: new THREE.Vector3(0, 8, 0.3) },
      uT: { value: 0 }, propsTex: { value: null }, propsR: { value: new THREE.Vector4(0, 0, 1, 1) }, propsOn: { value: 0 },
    },
    depthTest: false, depthWrite: false,
  }));
  table.renderOrder = 0;
  table.frustumCulled = false;
  const geo = new THREE.BoxGeometry(CW, CH, 3);
  const mat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: CARD_VERT, fragmentShader: CARD_FRAG,
    uniforms: { ...THEME_UNIFORMS, faceTex: { value: null }, lamp: { value: new THREE.Vector2(...LAMP) } },
    depthTest: true, depthWrite: true, side: THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  scene.add(table, mesh);
  /** 鏡頭在基準距離時，對焦面上 1 個世界單位 = 螢幕上 1 px。 */
  const D0 = (H / 2) / Math.tan((fov * Math.PI) / 360);
  return { scene, cam, mesh, mat, table, D0 };
};

// ---------------------------------------------------------------- 背面印好的東西（Canvas2D）
type Ctx2 = CanvasRenderingContext2D;

/** 郵票：齒孔邊、訊號色的底、細線刻的小風景（太陽、山、湖）、「永久郵資」「∞」。畫在 (x, y)，寬 w 高 h。 */
function drawStamp(c: Ctx2, x: number, y: number, w: number, h: number) {
  const cv = document.createElement('canvas');
  const k = 2; // 郵票自己的畫布放大兩倍畫，細線才清楚
  cv.width = (w + 8) * k; cv.height = (h + 8) * k;
  const s = cv.getContext('2d')!;
  s.scale(k, k); s.translate(4, 4);
  s.fillStyle = mixRgba('paper', 'bone', 0.5);
  s.fillRect(0, 0, w, h);
  // 齒孔：沿著四邊挖半圓
  s.globalCompositeOperation = 'destination-out';
  const step = 10, r = 3.4;
  for (let px = step / 2; px < w; px += step) { s.beginPath(); s.arc(px, 0, r, 0, TAU); s.arc(px, h, r, 0, TAU); s.fill(); }
  for (let py = step / 2; py < h; py += step) { s.beginPath(); s.arc(0, py, r, 0, TAU); s.arc(w, py, r, 0, TAU); s.fill(); }
  s.globalCompositeOperation = 'source-over';
  const ix = 9, iy = 9, iw = w - 18, ih = h - 18;
  s.fillStyle = mixRgba('paper', 'signal', 0.32);
  s.fillRect(ix, iy, iw, ih);
  s.save();
  s.beginPath(); s.rect(ix, iy, iw, ih); s.clip();
  s.strokeStyle = rgba('blood', 0.75); s.lineWidth = 0.8;
  for (let yy = iy + 4; yy < iy + ih * 0.55; yy += 3) { s.globalAlpha = 0.2 + 0.5 * (1 - (yy - iy) / (ih * 0.55)); s.beginPath(); s.moveTo(ix, yy); s.lineTo(ix + iw, yy); s.stroke(); }
  s.globalAlpha = 1;
  const sx = ix + iw * 0.64, sy = iy + ih * 0.44;
  s.fillStyle = mixRgba('paper', 'ember', 0.5);
  s.beginPath(); s.arc(sx, sy, 13, 0, TAU); s.fill();
  for (let rr = 3; rr <= 13; rr += 3.3) { s.beginPath(); s.arc(sx, sy, rr, 0, TAU); s.stroke(); }
  const rnd = mulberry32(3);
  for (const [base, amp, a] of [[0.62, 0.22, 0.3], [0.7, 0.16, 0.45]] as const) {
    s.beginPath(); s.moveTo(ix, iy + ih);
    for (let xx = 0; xx <= iw; xx += iw / 7) s.lineTo(ix + xx, iy + ih * (base - amp * (0.4 + 0.6 * rnd())));
    s.lineTo(ix + iw, iy + ih); s.closePath();
    s.fillStyle = mixRgba('paper', 'blood', a); s.fill(); s.stroke();
  }
  s.fillStyle = mixRgba('paper', 'signal', 0.24);
  s.fillRect(ix, iy + ih * 0.74, iw, ih * 0.26);
  for (let yy = iy + ih * 0.76; yy < iy + ih; yy += 3) { s.beginPath(); s.moveTo(ix, yy); s.lineTo(ix + iw, yy); s.stroke(); }
  s.restore();
  s.strokeStyle = rgba('blood', 0.85); s.lineWidth = 1.1; s.strokeRect(ix, iy, iw, ih);
  s.fillStyle = rgba('blood', 0.9);
  s.font = font(F.hei(700), 11); s.letterSpacing = '2px';
  s.fillText('永久郵資', ix + 5, iy + 16);
  s.letterSpacing = '0px';
  s.font = font(F.serif(600), 30); s.textAlign = 'right';
  s.fillText('∞', ix + iw - 4, iy + ih - 5);
  s.textAlign = 'left';
  c.save();
  c.globalAlpha = 0.9;
  c.shadowColor = rgba('sepia', 0.14); c.shadowBlur = 3; c.shadowOffsetX = 1; c.shadowOffsetY = 1.5;
  c.drawImage(cv, x - 4, y - 4, w + 8, h + 8);
  c.restore();
}

export interface BackCopy { to: string; addr: string; from: string; tag: string }

/**
 * 背面印好（與早就寫好）的部分：表頭、分隔線、郵票、郵遞區號、地址、P.S. 的線。只畫一次。
 * 全部小（≤ 22 px）而淡：這一面的焦點是留言，這些只是讓人一眼認出「這是明信片的背面」。
 */
export function drawBackStatic(c: Ctx2, cp: BackCopy) {
  c.clearRect(0, 0, CW, CH);
  c.textBaseline = 'alphabetic';
  // 表頭：一小群（POST CARD · 明信片 · No.042）
  c.fillStyle = rgba('sepia', 0.42);
  c.font = font(F.serif(600), 30); c.letterSpacing = '10px';
  c.fillText('POST CARD', BACK.msg.x, BACK.headY);
  const hw = c.measureText('POST CARD').width;
  c.font = font(F.mono(500), 18); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.36);
  c.fillText(`明信片  ·  ${cp.tag}`, BACK.msg.x + hw + 18, BACK.headY - 2);
  c.letterSpacing = '0px';
  // 分隔線
  c.fillStyle = rgba('sepia', 0.2);
  c.fillRect(BACK.divX, 110, 1.2, BACK.psRule - 140);
  // 右邊的郵務欄（第二小群）：郵票、郵遞區號、地址
  drawStamp(c, BACK.stamp.x, BACK.stamp.y, BACK.stamp.w, BACK.stamp.h);
  const R = BACK.right;
  c.font = font(F.mono(500), 14); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.36);
  c.fillText('ZIP', R.x0, BACK.zipY - 38);
  c.letterSpacing = '0px';
  c.strokeStyle = rgba('blood', 0.45); c.lineWidth = 1.1;
  ['5', '2', '0'].forEach((d, i) => {
    const bx = R.x0 + 6 + i * 38;
    c.strokeRect(bx, BACK.zipY - 28, 28, 32);
    c.fillStyle = rgba('sepia', 0.6); c.font = font(F.hand(700), 22); c.textAlign = 'center';
    c.fillText(d, bx + 14, BACK.zipY - 4);
    c.textAlign = 'left';
  });
  const labels = ['TO', '', 'FROM'];
  const texts = [cp.to, cp.addr, cp.from];
  BACK.addr.forEach((y, i) => {
    c.fillStyle = rgba('sepia', 0.2);
    c.fillRect(R.x0, y + 10, R.x1 - R.x0, 1);
    if (labels[i]) { c.font = font(F.mono(500), 14); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.34); c.fillText(labels[i]!, R.x0, y - 34); c.letterSpacing = '0px'; }
    c.fillStyle = rgba('sepia', i === 0 ? 0.62 : 0.5);
    // 收件人、寄件人是名字（可能很長）、地址也不短：郵務欄很窄，多縮一點也要寫完整，不要截成「…」。
    // 寄件人縮到一半還放不下（新人的名字很長）就拿掉「寄件人：」，上面已經有 FROM 的小標
    let txt = texts[i]!;
    if (i === 2 && measure(txt, F.hand(700), 14) > R.x1 - R.x0 - 4) txt = txt.replace(/^寄件人：/, '');
    fitHand(c, txt, R.x0 + 2, y, R.x1 - R.x0 - 4, 28, 0.5);
  });
  // P.S. 那一條的線
  c.fillStyle = rgba('sepia', 0.16);
  c.fillRect(BACK.ps.x, BACK.psRule, BACK.right.x1 - BACK.ps.x, 1);
}

/** 手寫一行：放不下就縮字級（最小 minK 倍），再放不下就截斷加「…」。 */
function fitHand(c: Ctx2, s: string, x: number, y: number, maxW: number, size: number, minK = 0.7) {
  const fam = F.hand(700);
  c.font = font(fam, size);
  let w = c.measureText(s).width;
  if (w > maxW) { c.font = font(fam, Math.max(size * minK, (size * maxW) / w)); w = c.measureText(s).width; }
  let str = s;
  while (w > maxW && Array.from(str).length > 2) { str = Array.from(str).slice(0, -2).join('') + '…'; w = c.measureText(str).width; }
  c.fillText(str, x, y);
}

/**
 * 郵戳：雙圈、弧形的「喜宴郵局」「WEDDING POST」、中間是日期（沒有留言：「待寄」；還沒定日期：一個「囍」），右邊四條波浪的消印線。
 * 印泥斑駁（缺墨的小洞）一次做好：畫在一張自己的畫布上，蓋章時整張貼上去。回傳畫布與圓心在畫布上的位置。
 */
export function makePostmark(center: string, seed: number): { cv: HTMLCanvasElement; cx: number; cy: number; w: number; h: number } {
  const w = 260, h = 140, k = 2, cx = 66, cy = 70, r = BACK.mark.r;
  const cv = document.createElement('canvas');
  cv.width = w * k; cv.height = h * k;
  const c = cv.getContext('2d')!;
  c.scale(k, k);
  const ink = rgba('blood', 0.62);
  c.strokeStyle = ink; c.fillStyle = ink;
  c.lineWidth = 2.2; c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.stroke();
  c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, r - 17, 0, TAU); c.stroke();
  const arc = (str: string, rad: number, fam: string, size: number, top: boolean, spread: number) => {
    const chars = Array.from(str);
    c.font = font(fam, size);
    chars.forEach((ch, i) => {
      const a = (top ? -Math.PI / 2 : Math.PI / 2) + (i - (chars.length - 1) / 2) * spread * (top ? 1 : -1);
      c.save(); c.translate(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); c.rotate(a + (top ? Math.PI / 2 : -Math.PI / 2));
      c.textAlign = 'center'; c.fillText(ch, 0, size * 0.36);
      c.restore();
    });
  };
  arc('喜宴郵局', r - 8.5, F.hei(700), 12, true, 0.36);
  arc('WEDDING·POST', r - 8.5, F.mono(600), 7.5, false, 0.155);
  c.textAlign = 'center';
  if (center === '待寄') {
    c.font = font(F.hei(900), 18); c.fillText('待 寄', cx, cy + 6);
  } else if (!center) {
    c.font = font(F.hei(900), 24); c.fillText('囍', cx, cy + 8);
  } else {
    c.font = font(F.mono(600), 11); c.fillText(center, cx, cy + 4);
  }
  c.textAlign = 'left';
  c.lineWidth = 1.7;
  for (let i = 0; i < 4; i++) {
    const y0 = cy - 27 + i * 18;
    c.beginPath();
    for (let xx = cx + r + 8; xx <= w - 6; xx += 3) {
      const yy = y0 + Math.sin((xx - cx) * 0.09) * 3;
      if (xx === cx + r + 8) c.moveTo(xx, yy); else c.lineTo(xx, yy);
    }
    c.stroke();
  }
  // 印泥斑駁：很多小洞＋幾片比較淡的地方
  const rnd = mulberry32(seed);
  c.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 300; i++) {
    const x = rnd() * w, y = rnd() * h, rr = 0.3 + rnd() * rnd() * 1.8;
    c.globalAlpha = 0.5 + 0.5 * rnd();
    c.beginPath(); c.arc(x, y, rr, 0, TAU); c.fill();
  }
  for (let i = 0; i < 5; i++) {
    const x = rnd() * w, y = rnd() * h, rr = 10 + rnd() * 18;
    const g = c.createRadialGradient(x, y, 0, x, y, rr);
    g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.globalAlpha = 1; c.fillStyle = g;
    c.beginPath(); c.arc(x, y, rr, 0, TAU); c.fill();
  }
  c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
  return { cv, cx, cy, w, h };
}

/** 郵戳中間的日期：「YYYY.MM.DD」；還沒定日期是空字串（郵戳中間改蓋「囍」）。 */
export const MARK_DATE = DATE_DOT;

/**
 * 前景虛化：畫面左下角一叢離鏡頭很近的葉子（失焦的深色剪影），在風裡輕輕晃（主檔每格給一點位移與轉動）。
 * 在 init() 畫一次（blur 濾鏡只跑一次）。原本這裡是一支失焦的鋼筆——v2 的鋼筆會在卡片上寫字，前景就換成葉子。
 */
export function drawForegroundLeaves(c: Ctx2) {
  c.clearRect(0, 0, W, H);
  c.save();
  c.filter = 'blur(9px)';
  const rnd = mulberry32(11);
  const leaf = (x: number, y: number, a: number, L: number, wd: number) => {
    c.save(); c.translate(x, y); c.rotate(a);
    c.beginPath(); c.moveTo(0, 0);
    c.quadraticCurveTo(L * 0.45, -wd, L, 0); c.quadraticCurveTo(L * 0.45, wd, 0, 0);
    c.fill();
    c.restore();
  };
  // 兩根枝子從左下角伸進畫面，葉子一左一右
  for (const [bx, by, ba, n] of [[-40, 1120, -0.75, 7], [120, 1140, -1.05, 5]] as const) {
    let x = bx, y = by;
    for (let i = 0; i < n; i++) {
      const L = 150 + 60 * rnd(), a = ba + (rnd() - 0.5) * 0.3;
      x += Math.cos(a) * 70; y += Math.sin(a) * 70;
      const g = c.createLinearGradient(x, y - 40, x, y + 40);
      g.addColorStop(0, mixRgba('ink2', 'sepia', 0.25, 0.92)); g.addColorStop(1, rgba('ink', 0.95));
      c.fillStyle = g;
      leaf(x, y, a + (i % 2 ? 0.9 : -0.9), L, 34 + 14 * rnd());
    }
  }
  c.restore();
}

/**
 * 桌上的道具（世界座標的一塊，桌面 shader 取樣）：茶杯（跟祝福登記表同一組）、三張散落的郵票、一個信封。
 * 畫一次；熱氣會動，主檔另外畫在螢幕上。
 */
export const PROPS_R = { x: 1080, y: -620, w: 1360, h: 1560 };
export const CUP_W = { x: 1800, y: 560 };
export function drawTableProps(c: Ctx2, cup: HTMLCanvasElement, cupO: { ox: number; oy: number }, env: HTMLCanvasElement, envO: { ox: number; oy: number }) {
  const R = PROPS_R;
  c.clearRect(0, 0, R.w, R.h);
  // 世界 (x, y) → 這張圖的座標（y 向下）
  const at = (x: number, y: number) => ({ x: x - R.x, y: R.y + R.h - y });
  // 右下角 HUD（螢幕 x ≥ 1460、y ≥ 820）那一塊不放東西：信封小一點、往上放
  const e = at(1590, -210);
  c.save(); c.translate(e.x, e.y); c.drawImage(env, -envO.ox, -envO.oy); c.restore();
  const rnd = mulberry32(5);
  for (const [x, y, a] of [[1150, 380, -0.3], [1300, 300, 0.25], [1120, 190, 0.1]] as const) {
    const q = at(x + 40 * rnd(), y);
    c.save(); c.translate(q.x, q.y); c.rotate(a); c.scale(1.5, 1.5);
    drawStamp(c, -52, -64, 104, 128);
    c.restore();
  }
  const cp = at(CUP_W.x, CUP_W.y);
  c.save(); c.translate(cp.x, cp.y); c.scale(1.4, 1.4); c.drawImage(cup, -cupO.ox, -cupO.oy); c.restore();
}
