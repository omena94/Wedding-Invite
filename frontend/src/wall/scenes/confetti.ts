// 花瓣雨（暗）：從上往下看一片深色的木地板，一盞燈在地上打出一圈暖光，花瓣從鏡頭上方飄下來（近的大而糊、落地的清楚）。
//  - 花瓣在拍點一陣一陣灑下來，落地的位置排成主打留言的字：一個字一個字（一拍幾個字）在拍點上「落定」，
//    剛落地的一瞬間亮一下；愛心的花瓣是點綴色（玫瑰），其他是暖白。字落定後，花瓣底下浮出同一個字的暖光（地上的光字），
//    花瓣排的字才讀得清楚。窗格夠長的話，最後半拍一陣風從左邊把字吹散（退場）。
//  - 留言照 v2 標準：40～60 px（照字數），排在畫面右側的地板上（留言區 ≤ 800×410），燈的光圈偏向那裡；署名是地上一行清楚的光字。
//  - 左半邊的主角是地上一支拉炮（紙筒、斜紋、筒口一圈金邊）：每兩小節（偶數小節線）「砰」一聲往後一頓，
//    從筒口噴出一大把花瓣和幾條會捲的彩帶，往鏡頭飛上來（近的大而糊）再落到左半邊的地板上，彩帶落地後捲成一條條波浪躺著；
//    砰的那一下筒口前面的地板被火光照亮，一圈風從筒口往外掃過地板，地上的花瓣被掀起來、翻一下又落回去（字的花瓣不動）。
//    窗格開始前炸過的幾把已經落在地上，所以一切進來左半邊就是熱鬧的。另外每個小節線從鏡頭上方灑下一小把花瓣。
//  - 歌詞（比留言小 4 px）是燈打在地板左下的一行光字，逐字跟唱。
//  - 沒有留言：花瓣排的是正在唱的那一句歌詞（52 px，排在留言的位置，每一句提早一點飄下來、唱到的字的花瓣變成訊號色），
//    唱完一陣風從左邊把它吹散，下一句的花瓣接著落下來；地板左下是新人的名字與一行小小的邀請。純音樂又沒有留言：花瓣排新人的名字。
//  - 鏡頭：幾乎是正上方往下看、稍微斜一點（有景深）；切進來時高一點、第一拍落定；之後很慢地往下推近。右下角（QR）的地板落在燈外。
// 手法：three.js。花瓣是一個 InstancedBufferGeometry（每片花瓣只有幾個固定的參數：落點、落地時間、飄多久、被風吹走的時間、
// 屬於哪個字），位置、翻轉、景深全在 vertex shader 裡用時間算（CPU 每格不用算幾千個矩陣，也是確定性的）；
// 地板是一個 shader（木紋、光圈、拉炮的影子），地上的光字是貼在地板上方一點點的透明平面（取樣一張 Canvas 圖層）；
// 彩帶是另一個 InstancedBufferGeometry（一條細長的帶子，沿著拋物線飛、螺旋地捲、扭，全在 vertex shader 裡算）；
// 整個場景畫進引擎共用的 MSAA 目標（花瓣用 alpha to coverage，不用排序）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H, clearRT, sharedMSAA } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, hash, TAU } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { lyricAt, beatAfter, drawHeart, COUPLE_ZH } from './_motifs';
import { layoutRows, drawRows, darkInk, type RowsLayout } from './_t4';
import { T23_INVITE, T23_TEXT, sigOf, layMsgV2, stagger, winBars, lastBefore, rawMat, type Glyph, type Rect } from './_t23';
import { V2, lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'instrument', paper: false, energy: [0.3, 1], bars: [4, 8] };

// ---------------------------------------------------------------- 版面（頁面 px = 地板上的座標，鏡頭在定位時大約就是畫面座標）
/** 頁面 1 px = 地板 0.1 單位。 */
const S = 0.1;
/** v2：寫留言的那塊在畫面右側的地板上（≤ 860×430），左半邊是灑下來的花瓣與空的地板。 */
const MSG_BOX = { x: 950, y: 300, w: 800, h: 410 };
const LYR = { x: 200, y: 930, w: 1060 };
/** 鏡頭有一點斜：地板下緣（歌詞那一行）離鏡頭近，畫面上大約放大 1.1 倍，字級要先縮回來才是 v2 的螢幕字級。 */
const K_LYR = 1 / 1.1;
/**
 * 留言用黑體（宋體的橫筆太細，花瓣排不出來）。字小（40～60），用 700 不用 900：花瓣會在筆畫外面圍一圈毛邊，
 * 再用最粗的，上面的清楚光字與花瓣會糊成一團。
 */
const FAM_MSG = F.hei(700);
const FAM_LYR = F.archivo(100, 600);
const FAM_SOLO = F.archivo(100, 800);
const CAP = 9000;
const NAMB = 280;
/** 每個小節線灑下來的一小把花瓣。 */
const NFLURRY = 16;
const FLOOR_PG = { w: 1920, h: 1080 };
/** 拉炮（頁面 px）：筒尾 B、筒口 M；筒口抬高一點（世界座標的高度）。 */
const POP = { bx: 170, by: 800, mx: 395, my: 640, mh: 5.5, bh: 0.7, r: 5.5 };
const POP_DIR = Math.atan2(POP.my - POP.by, POP.mx - POP.bx);
/** 每一砰：噴出的花瓣、彩帶數。 */
const NBURST = 70, NRIB = 4;
/** 彩帶一條的段數。 */
const RSEG = 40;
/** 右下角 HUD（QR 與小字）：地上的花瓣不要落在這裡。 */
const inHud = (x: number, y: number) => x > 1320 && y > 790;

// ---------------------------------------------------------------- shader
const PETAL_V = /* glsl */ `
in vec3 position; in vec2 uv;
in vec4 aTgt;   // 落點 x、z、平放時的角度、大小
in vec4 aTime;  // 落地時間、飄多久、被風吹走的時間、種類（0 = 字、1 = 零星、2 = 愛心）
in vec4 aSeed;  // 亂數
in vec2 aWord;  // 屬於的那個字的開始、結束（跟唱；不是歌詞是 -1）
in vec4 aFrom;  // 從拉炮噴出來的：出發點 xyz、飛多高（0 = 從上面飄下來的）
uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
uniform float uT; uniform float uFocus; uniform float uRip; uniform vec2 uPM;
out vec2 vUv; out float vLand; out float vCoc; out vec3 vN; out float vKind; out vec2 vWord; out float vHot; out float vSeed; out float vFade;
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
void main() {
  float land = aTime.x, fall = aTime.y, gust = aTime.z;
  float tau = uT - land;
  vUv = uv; vKind = aTime.w; vWord = aWord; vSeed = aSeed.x;
  float u = clamp((tau + fall) / fall, 0.0, 1.0);   // 0 = 剛從上面出現、1 = 落地
  float air = 1.0 - u;
  // 還沒出現：丟到鏡頭後面
  if (tau < -fall) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  vec3 pos = vec3(aTgt.x, 0.0, aTgt.y);
  if (aFrom.w > 0.0) {
    // 從拉炮噴出來：水平方向先快後慢（空氣阻力），高度是一條往鏡頭拋上去再落下的拋物線
    float hu = 1.0 - pow(air, 2.2);
    pos = vec3(mix(aFrom.x, aTgt.x, hu), 0.0, mix(aFrom.z, aTgt.y, hu));
    pos.y = mix(aFrom.y, 0.02 + aSeed.w * 0.03, u) + aFrom.w * 4.0 * u * air;
    pos.x += sin(tau * (3.0 + 2.0 * aSeed.y) + aSeed.x * 20.0) * 1.5 * air;
  } else {
    // 飄落：高度照 (1-u)^1.7 往下（快落地時慢下來）、橫著飄、左右擺；翻轉在落地前收成平的
    float h = 130.0 * pow(air, 1.7) * (0.75 + 0.5 * aSeed.y);
    pos.y += h + 0.02 + aSeed.w * 0.03;
    pos.x += (aSeed.z - 0.5) * 60.0 * pow(air, 1.3) + sin(tau * (2.0 + 2.0 * aSeed.y) + aSeed.x * 20.0) * 3.0 * air;
    pos.z += -(22.0 + 20.0 * aSeed.w) * pow(air, 1.4) + cos(tau * (1.7 + aSeed.z) + aSeed.y * 9.0) * 2.0 * air;
  }
  mat3 R = rotY(aTgt.z) * rotX((aSeed.x - 0.5) * 12.0 * air + sin(tau * 5.0 + aSeed.w * 10.0) * 1.2 * air) * rotZ((aSeed.y - 0.5) * 9.0 * air);
  // 拉炮砰的那一下，一圈風從筒口往外掃過地板：地上零星的花瓣被掀起來一點、翻一下又落回去（字的花瓣不動，字要讀得清楚）
  if (aTime.w > 0.5 && aTime.w < 1.5 && tau > 0.0 && uRip >= 0.0 && uRip < 2.0) {
    float front = 2000.0 * (uRip / 1.4);
    float d = (length(vec2(aTgt.x / ${S} + 960.0, aTgt.y / ${S} + 540.0) - uPM) - front) / 200.0;
    float lift = exp(-d * d);
    pos.y += lift * (1.2 + 2.4 * aSeed.y);
    pos.x += lift * 1.2;
    R = R * rotX(lift * (aSeed.x - 0.5) * 3.2) * rotZ(lift * (aSeed.w - 0.5) * 2.2);
  }
  // 風：從左邊吹過來，花瓣被掀起來往右飛、翻、淡掉
  vFade = 1.0;
  if (uT > gust) {
    float g = uT - gust;
    pos += vec3(40.0 * g + 70.0 * g * g, 18.0 * g * (0.5 + aSeed.y) - 4.0 * g * g, -6.0 * g * (aSeed.z - 0.5));
    R = R * rotX(g * (6.0 + 6.0 * aSeed.x)) * rotZ(g * 4.0 * (aSeed.w - 0.5));
    vFade = 1.0 - smoothstep(0.5, 1.4, g);
  }
  // 花瓣：躺在 XZ 平面上的一片（local 的 xy → 世界的 xz），大小 aTgt.w
  vec3 lp = vec3(position.x, 0.0, position.y) * aTgt.w;
  vec3 wp = pos + R * lp;
  vN = R * vec3(0.0, 1.0, 0.0);
  vLand = step(0.0, tau) * step(uT, gust);
  vHot = tau >= 0.0 ? exp(-tau / 0.25) : 0.0;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  // 景深：離焦點越遠越糊（近的花瓣大而糊）
  vCoc = clamp(abs(-mv.z - uFocus) / uFocus * 3.2, 0.0, 1.0);
  gl_Position = projectionMatrix * mv;
}`;
const PETAL_F = /* glsl */ `
in vec2 vUv; in float vLand; in float vCoc; in vec3 vN; in float vKind; in vec2 vWord; in float vHot; in float vSeed; in float vFade;
uniform float uT; uniform float uKick;
void main() {
  // 花瓣的形狀：一頭圓、一頭尖一點，圓的那頭有一個小凹口（像玫瑰花瓣）
  vec2 q = vUv - 0.5;
  q.y += 0.06;
  float r = length(vec2(q.x * (1.25 + 0.9 * max(q.y, 0.0)), q.y));
  float notch = smoothstep(0.02, 0.0, abs(q.x)) * smoothstep(0.3, 0.42, q.y) * 0.1;
  float d = r + notch - 0.42;
  float soft = 0.01 + 0.2 * vCoc;
  float a = 1.0 - smoothstep(-soft, soft, d);
  a *= 1.0 - 0.55 * vCoc;
  a *= vFade;
  if (a < 0.02) discard;
  // 顏色：字的花瓣是帶一點訊號色的暖白（比上面的清楚光字暗一階，字才分得出來）、愛心玫瑰、零星的花瓣帶多一點訊號色；尖端稍微深一點
  vec3 base = vKind > 1.5 ? C_ROSE : vKind > 0.5 ? mix(mix(C_BONE, C_SIGNAL, 0.45), C_ROSE, step(0.8, vSeed) * 0.6) : mix(C_BONE, C_EMBER, 0.3) * 0.72;
  if (vWord.x >= 0.0) {
    // 歌詞的花瓣：還沒唱是暗的、正在唱是訊號色、唱完是暖白
    bool on = uT >= vWord.x && uT < vWord.y + 0.05;
    base = on ? mix(C_SIGNAL, C_EMBER, 0.3) * 1.6 : uT >= vWord.x ? base : base * 0.42;
  }
  vec3 col = base * (0.55 + 0.45 * smoothstep(0.45, -0.2, q.y));
  col *= 1.0 - 0.25 * smoothstep(0.1, 0.0, abs(q.x)) * smoothstep(-0.3, 0.2, q.y) * 0.4;
  // 燈從上面來：平躺的最亮，翻起來的暗；背面（翻過去）再暗一點
  float lit = 0.55 + 0.45 * abs(vN.y);
  col *= lit * (vN.y < 0.0 ? 0.8 : 1.0);
  // 零星的花瓣落地後暗一點（地上的，不搶字）
  if (vKind > 0.5 && vKind < 1.5) col *= mix(1.0, 0.45, vLand);
  // 剛落地的一瞬間亮一下（大鼓時也亮一點）
  col += mix(C_SIGNAL, C_EMBER, 0.5) * vHot * 1.4 * (vKind < 0.5 || vKind > 1.5 ? 1.0 : 0.3);
  col *= 1.0 + 0.1 * uKick * vLand;
  // alpha to coverage：顏色不要預乘（覆蓋率由 MSAA 的取樣點決定）
  fragColor = vec4(col, a);
}`;
const FLOOR_V = /* glsl */ `
in vec3 position; in vec2 uv;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
out vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FLOOR_F = /* glsl */ `
in vec3 vW;
uniform sampler2D uGlow; uniform float uGlowA; uniform float uOn; uniform float uKick;
uniform vec2 uPB; uniform vec2 uPM; uniform float uPop;
void main() {
  vec2 pg = vec2(vW.x / ${S} + 960.0, vW.z / ${S} + 540.0);   // 地板 → 頁面座標
  // 深色木地板：一條條的木板（接縫、每條深淺不一、細細的木紋）
  float plank = floor(pg.y / 64.0);
  float h = hash11(plank * 7.3);
  float seam = 1.0 - smoothstep(0.0, 2.5, min(mod(pg.y, 64.0), 64.0 - mod(pg.y, 64.0)));
  float endSeam = 1.0 - smoothstep(0.0, 2.0, abs(mod(pg.x + h * 900.0, 700.0) - 350.0) - 348.0);
  float grain = 0.8 + 0.2 * snoise(vec2(pg.x * 0.004 + h * 10.0, pg.y * 0.12));
  vec3 col = mix(C_INK2, C_BLOOD * 0.35, 0.3) * (0.55 + 0.35 * h) * grain;
  col *= 1.0 - 0.6 * max(seam, endSeam);
  // 燈打在地上的一圈暖光：偏向右邊寫留言的地方，左邊慢慢暗下去（左下還留一點給歌詞）
  float pool = exp(-pow(length((pg - vec2(1250.0, 480.0)) / vec2(820.0, 520.0)), 2.0));
  col *= 0.2 + 2.3 * pool * uOn;
  col += C_SIGNAL * 0.012 * pool * uOn;
  // 拉炮的影子（燈在右上方，影子往左下偏一點）：筒尾細、筒口粗的一條軟影子，拉炮才是「放在地上」
  vec2 ba = uPM - uPB, sp = pg - vec2(-12.0, 14.0);
  float hh = clamp(dot(sp - uPB, ba) / dot(ba, ba), 0.0, 1.0);
  float rad = mix(10.0, 60.0, hh);
  col *= 1.0 - 0.65 * (1.0 - smoothstep(rad * 0.5, rad * 1.4, length(sp - uPB - ba * hh)));
  // 砰的那一下：筒口前面的地板被火光照亮
  col += mix(C_SIGNAL, C_EMBER, 0.5) * 0.28 * uPop * exp(-pow(length(pg - uPM - normalize(ba) * 140.0) / 170.0, 2.0)); // 砰的火光收小：香檳、珊瑚這類亮色主題下原本太大太亮
  // 右下角（QR 與小字）落在燈外的暗處，HUD 的字才清楚
  col *= 1.0 - 0.8 * smoothstep(1240.0, 1480.0, pg.x) * smoothstep(700.0, 880.0, pg.y);
  // 字的花瓣底下一層很淡的暖光（花瓣反射的光）：字全部落定後浮出來，花瓣排的字才讀得清楚
  vec4 G = fastLayer(texture(uGlow, vec2(pg.x / 1920.0, 1.0 - pg.y / 1080.0)));
  col += G.rgb * uGlowA;
  fragColor = vec4(col, 1.0);
}`;
/**
 * 地上的光字（留言、署名、歌詞、名字）：貼在地板上方一點點的一張透明平面，比落地的花瓣高、比飄在空中的花瓣低，
 * 所以落地的花瓣不會蓋住字（花瓣排的字外面一圈花瓣的毛邊、中間是清楚的字），飄下來的花瓣照樣從字前面經過。
 */
const TEXT_F = /* glsl */ `
in vec3 vW;
uniform sampler2D uTxt;
void main() {
  vec2 pg = vec2(vW.x / ${S} + 960.0, vW.z / ${S} + 540.0);
  vec4 L = fastLayer(texture(uTxt, vec2(pg.x / 1920.0, 1.0 - pg.y / 1080.0)));
  if (L.a < 0.004) discard;
  fragColor = vec4(L.rgb, L.a);
}`;

/** 拉炮：紙筒（圓錐，開口朝右上），外面斜紋、筒口一圈金邊，裡面暗、砰的那一下被火光照亮。 */
const POP_V = /* glsl */ `
in vec3 position; in vec3 normal; in vec2 uv;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
out vec3 vN; out vec2 vUv;
void main() { vN = normalize(mat3(modelMatrix) * normal); vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`;
const POP_F = /* glsl */ `
in vec3 vN; in vec2 vUv;
uniform float uPop;
void main() {
  vec3 N = normalize(vN);
  // 筒子裡面（背面）：暗，砰的那一下從筒口往裡被照亮（uv.y = 0 是筒口）
  if (!gl_FrontFacing) { fragColor = vec4(C_INK * 0.25 + mix(C_SIGNAL, C_EMBER, 0.5) * uPop * 0.9 * (1.0 - vUv.y), 1.0); return; }
  float stripe = step(0.5, fract(vUv.x * 8.0 + vUv.y * 2.5));
  vec3 base = mix(mix(C_BONE, C_PAPER, 0.4) * 0.8, mix(C_SIGNAL, C_BLOOD, 0.4) * 0.85, stripe);
  base = mix(base, mix(C_EMBER, C_BONE, 0.3) * 0.9, step(vUv.y, 0.07));
  // 燈從上面來：朝上的面亮、側面暗，邊緣一點點反光
  float lit = 0.28 + 0.72 * max(N.y, 0.0) + 0.12 * pow(1.0 - abs(N.y), 3.0);
  fragColor = vec4(base * lit, 1.0);
}`;
/**
 * 彩帶：一條細長的紙帶（position.x = 沿著帶子 0..1、position.y = 左右 -1..1）。帶頭沿著拋物線飛，帶身晚一點跟上（從筒口被拉出來），
 * 飛的時候螺旋地捲、扭，落地後平躺成一條波浪，帶頭在落點、帶身往筒口的方向鋪開。
 */
const RIB_V = /* glsl */ `
in vec3 position;
in vec4 aA;   // 出發點 xyz、噴出的時間
in vec4 aB;   // 帶頭的落點 x、z、長度、寬度
in vec4 aC;   // 飛多高、飛多久、捲幾圈、捲的幅度
in vec4 aD;   // 亂數 ×3、顏色
uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
uniform float uT;
out vec3 vN; out float vCol;
vec3 ribbonAt(float s) {
  float u = clamp((uT - aA.w - s * 0.3) / aC.y, 0.0, 1.0);
  vec2 d = normalize(aB.xy - aA.xz + vec2(1e-4, 0.0));
  // 落地後帶身往哪個方向鋪：大致朝筒口，但每條偏一點（不要全部排成放射狀）
  float ra = (aD.z - 0.5) * 2.2;
  vec2 dl = vec2(d.x * cos(ra) - d.y * sin(ra), d.x * sin(ra) + d.y * cos(ra));
  vec2 tg = aB.xy - dl * s * aB.z;
  float hu = 1.0 - pow(1.0 - u, 2.2);
  vec3 p = vec3(mix(aA.x, tg.x, hu), 0.0, mix(aA.z, tg.y, hu));
  p.y = mix(aA.y, 0.05 + 0.03 * aD.x, u) + aC.x * 4.0 * u * (1.0 - u);
  // 捲：垂直於前進方向的螺旋，飛的時候大、會轉，落地後剩下地上的波浪
  float ph = s * aC.z * 6.2831853 + aD.y * 6.0 + uT * 5.0 * (1.0 - u);
  float amp = aC.w * (0.45 + 0.55 * (1.0 - u));
  p.xz += vec2(-d.y, d.x) * sin(ph) * amp;
  p.y += (0.5 + 0.5 * cos(ph)) * amp * 1.6 * (1.0 - u);
  return p;
}
void main() {
  vCol = aD.w;
  if (uT < aA.w) { vN = vec3(0.0, 1.0, 0.0); gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  float s = position.x;
  vec3 p = ribbonAt(s);
  vec3 T = normalize(ribbonAt(min(s + 0.015, 1.0)) - ribbonAt(max(s - 0.015, 0.0)) + vec3(1e-4, 0.0, 0.0));
  vec3 side = normalize(cross(T, vec3(0.0, 1.0, 0.0)) + vec3(0.0, 1e-4, 0.0));
  // 飛的時候帶子扭（亮面、暗面交替），落地前收成平躺
  float u = clamp((uT - aA.w - s * 0.3) / aC.y, 0.0, 1.0);
  float th = (s * 10.0 + uT * 6.0 + aD.z * 6.0) * (1.0 - u) * (1.0 - u);
  side = side * cos(th) + cross(T, side) * sin(th);
  p += side * position.y * aB.w * 0.5;
  vN = normalize(cross(T, side));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const RIB_F = /* glsl */ `
in vec3 vN; in float vCol;
void main() {
  // 顏色跟著這首歌的主題（訊號色一家子與紙色），不用愛心的玫瑰色；壓暗一點，不搶右邊的留言
  vec3 base = vCol < 0.3 ? mix(C_SIGNAL, C_BLOOD, 0.2) : vCol < 0.55 ? C_EMBER : vCol < 0.8 ? mix(C_BONE, C_PAPER, 0.4) : mix(C_SIGNAL, C_BONE, 0.5);
  float lit = 0.3 + 0.7 * abs(normalize(vN).y);
  fragColor = vec4(base * lit * (gl_FrontFacing ? 0.72 : 0.52), 1.0);
}`;

/** 共用的舞台：地板、花瓣的材質（shader 整晚只編一次）；花瓣的幾何每個窗格自己建。 */
class Stage {
  scene = new THREE.Scene();
  U = {
    uT: { value: 0 }, uFocus: { value: 160 }, uKick: { value: 0 }, uRip: { value: -1 }, uTxt: { value: null as THREE.Texture | null }, uGlow: { value: null as THREE.Texture | null }, uGlowA: { value: 0 }, uOn: { value: 1 },
    uPop: { value: 0 }, uPB: { value: new THREE.Vector2(POP.bx, POP.by) }, uPM: { value: new THREE.Vector2(POP.mx, POP.my) },
  };
  petalMat: THREE.RawShaderMaterial;
  petals: THREE.Mesh;
  ribbons: THREE.Mesh;
  popper: THREE.Mesh;
  /** 拉炮平常的位置（筒尾與筒口的中點）與軸（筒口 → 筒尾），砰的時候沿著軸往後一頓。 */
  popAt = new THREE.Vector3();
  popAxis = new THREE.Vector3();
  constructor() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(420, 260), rawMat(FLOOR_V, FLOOR_F, this.U));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 0);
    this.scene.add(floor);
    const text = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_PG.w * S, FLOOR_PG.h * S), rawMat(FLOOR_V, TEXT_F, this.U, { transparent: true, depthWrite: false }));
    text.rotation.x = -Math.PI / 2;
    // 落地的花瓣最高約 0.05、被小風掀起來的會更高：字的平面放在 0.12
    text.position.set(0, 0.12, 0);
    text.renderOrder = 2;
    this.scene.add(text);
    this.petalMat = rawMat(PETAL_V, PETAL_F, this.U, { transparent: false, alphaToCoverage: true, side: THREE.DoubleSide, depthWrite: true });
    this.petals = new THREE.Mesh(new THREE.InstancedBufferGeometry(), this.petalMat);
    this.petals.frustumCulled = false;
    this.scene.add(this.petals);
    this.ribbons = new THREE.Mesh(new THREE.InstancedBufferGeometry(), rawMat(RIB_V, RIB_F, this.U, { side: THREE.DoubleSide }));
    this.ribbons.frustumCulled = false;
    this.scene.add(this.ribbons);
    // 拉炮：圓錐的 +y 是尖端，轉成尖端朝筒尾、開口朝筒口
    const B = new THREE.Vector3((POP.bx - 960) * S, POP.bh, (POP.by - 540) * S), M = new THREE.Vector3((POP.mx - 960) * S, POP.mh, (POP.my - 540) * S);
    this.popAxis.copy(B).sub(M);
    const len = this.popAxis.length();
    this.popAxis.normalize();
    this.popAt.copy(B).add(M).multiplyScalar(0.5);
    this.popper = new THREE.Mesh(new THREE.ConeGeometry(POP.r, len, 48, 1, true), rawMat(POP_V, POP_F, this.U, { side: THREE.DoubleSide }));
    this.popper.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.popAxis);
    this.popper.position.copy(this.popAt);
    this.scene.add(this.popper);
  }
}

/** 窗格結束後共用的花瓣、彩帶網格換成這個空的（不留著已經釋放的幾何）。 */
const EMPTY = new THREE.InstancedBufferGeometry();

interface Petal { x: number; z: number; rot: number; size: number; land: number; fall: number; gust: number; kind: number; seed: [number, number, number, number]; word: [number, number]; from?: [number, number, number, number] }
/** 一條彩帶（世界座標）：出發點與時間、帶頭落點、長寬、飛多高多久、捲的圈數與幅度、亂數與顏色。 */
interface Ribbon { a: [number, number, number, number]; b: [number, number, number, number]; c: [number, number, number, number]; d: [number, number, number, number] }
/** 沒有留言時，一句歌詞排成花瓣的位置（地上的光字也照這個畫）。 */
interface SoloLine { line: Line; lay: RowsLayout; x0: number; y0: number; gust: number }

export default class Confetti extends Scene {
  stage = shared('confetti.stage', () => new Stage());
  cam = new THREE.PerspectiveCamera(36, W / H, 1, 1000);
  txt = this.track(new Layer2D(FLOOR_PG.w, FLOOR_PG.h, undefined, { fast: true }));
  /** 字底下的暖光（init 畫一次、半解析度、模糊）。 */
  glow = this.track(new Layer2D(FLOOR_PG.w, FLOOR_PG.h, 0.5, { fast: true }));
  sig: { text: string; x: number; y: number; size: number; family: string } | null = null;
  geo = new THREE.InstancedBufferGeometry();
  rgeo = new THREE.InstancedBufferGeometry();
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 157 + (this.msg?.id ?? 0) * 41) >>> 0;
  tOn = 0;
  hasLyr = false;
  lyrSize = 54;
  sigT = Infinity;
  gustAt = Infinity;
  /** 花瓣排的字（留言，或純音樂又沒有留言時的新人名字）：每個字與它落定的時間。 */
  glyphs: Glyph[] = [];
  gT: number[] = [];
  solo: SoloLine[] = [];
  /** 拉炮砰的時間（每兩小節，偶數小節線；含窗格開始前的幾下，那幾把已經落在地上）。 */
  pops: number[] = [];
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const lines = lyrics.linesIn(s - 1, e + 1);
    this.hasLyr = lines.length > 0;
    const sig = m ? sigOf(m) : '';
    await loadText(`${T23_TEXT}${m?.text ?? ''}${sig}${song.title}${song.artist ?? ''}${lines.map((l) => l.text).join('')}`);
    const beat = au.beatPeriod(s);
    this.tOn = beatAfter(au, s + Math.min(0.15, beat * 0.3));
    const bar = au.timeOfBar(au.barAt(this.tOn) + 1) - this.tOn;
    const rnd = (i: number, k: number) => hash(this.seed, i, k);
    const P: Petal[] = [];
    const sd = (i: number): [number, number, number, number] => [rnd(i, 11), rnd(i, 12), rnd(i, 13), rnd(i, 14)];
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d', { willReadFrequently: true })!;
    /** 一個字（或一組字）的光柵 → 花瓣的落點。 */
    const sample = (draw: () => void, box: [number, number, number, number], st: number, add: (x: number, y: number) => void) => {
      c.clearRect(0, 0, W, H);
      c.fillStyle = '#fff'; c.textBaseline = 'alphabetic';
      draw();
      const [bx, by, bw, bh] = box.map(Math.round) as [number, number, number, number];
      if (bw <= 0 || bh <= 0) return;
      const img = c.getImageData(bx, by, bw, bh).data;
      for (let y = st / 2; y < bh; y += st) for (let x = st / 2; x < bw; x += st) {
        const jx = (hash(bx + x, by + y, 3) - 0.5) * st * 0.3, jy = (hash(bx + x, by + y, 4) - 0.5) * st * 0.3;
        const ix = Math.floor(clamp(x + jx, 0, bw - 1)), iy = Math.floor(clamp(y + jy, 0, bh - 1));
        if (img[(iy * bw + ix) * 4 + 3]! < 100) continue;
        add(bx + x + jx, by + y + jy);
      }
    };
    const toFloor = (x: number, y: number) => ({ x: (x - 960) * S, z: (y - 540) * S });
    // 花瓣排的字：有留言排留言；純音樂又沒有留言排新人的名字（沒有署名）
    const text = m ? m.text : this.hasLyr ? null : COUPLE_ZH;
    if (text !== null) {
      const lay = layMsgV2(this.txt.ctx, text, sig, FAM_MSG, MSG_BOX, { lineHeight: 1.3, maxLines: 5, sigFamily: F.ming(700), align: 'left' });
      if (sig) this.sig = { text: lay.sig.text, x: lay.sig.x, y: lay.sig.y, size: lay.sig.size, family: lay.sig.family };
      this.lyrSize = lyricV2(lay.fit.size) * K_LYR;
      const body = lay.glyphs.filter((g) => g.row >= 0);
      this.glyphs = body;
      const gT = stagger(au, this.tOn, body.length, Math.min(1.5 * bar, Math.max(0.6, 0.4 * (e - this.tOn))));
      this.gT = gT;
      this.sigT = (gT[gT.length - 1] ?? this.tOn) + beat * 0.5;
      // 退場：窗格夠長，最後半拍一陣風從左邊把字吹散
      const gustAt = e - this.sigT > 3 ? e - Math.min(0.45, beat) : Infinity;
      this.gustAt = gustAt;
      // 字小（40～60）：格點密一點、花瓣小一點，字的筆畫才排得出來
      const st = clamp(lay.fit.size / 9, 4.2, 7.5);
      // 字底下的暖光：整段字模糊一次畫在半解析度的圖層上
      const gc = this.glow.ctx;
      gc.filter = 'blur(7px)'; gc.fillStyle = rgba('signal', 0.5); gc.textBaseline = 'alphabetic'; gc.font = font(FAM_MSG, lay.fit.size);
      for (const ln of lay.lines) gc.fillText(ln.text, ln.x, ln.y);
      gc.filter = 'none';
      this.glow.upload();
      // 署名不排花瓣（字太小排不清楚）：地上一行清楚的光字
      body.forEach((g, gi) => {
        sample(() => {
          if (g.ch === '♥') drawHeart(c, g.x + g.w / 2, g.y - g.size * 0.36, Math.min(g.w, g.size * 0.8) * 0.92, '#fff');
          else { c.font = font(FAM_MSG, g.size); c.fillText(g.ch, g.x, g.y); }
        }, [g.x - 4, g.y - g.size * 1.0, g.w + 8, g.size * 1.3], st, (x, y) => {
          if (P.length >= CAP - NAMB - 600) return;
          const i = P.length, f = toFloor(x, y);
          const land = gT[gi]! + (rnd(i, 1) - 0.5) * 0.08;
          P.push({ x: f.x, z: f.z, rot: rnd(i, 2) * TAU, size: st * S * (1.15 + 0.25 * rnd(i, 3)), land, fall: 1.1 + 0.5 * rnd(i, 4), gust: gustAt + ((x - 200) / 1600) * 0.3, kind: g.ch === '♥' ? 2 : 0, seed: sd(i), word: [-1, -1] });
        });
      });
    } else {
      // 沒有留言：每一句歌詞各自排成花瓣（提早 1 秒開始飄、在句子開始時落定），唱完一陣風吹走
      lines.forEach((ln, li) => {
        const lay = layoutRows(this.txt.ctx, ln, { family: FAM_SOLO, size: lyricV2(null), minSize: V2.lyrMin, maxW: MSG_BOX.w, maxRows: 2, align: 'left', lineHeight: 1.3 });
        const x0 = MSG_BOX.x, y0 = MSG_BOX.y + MSG_BOX.h / 2 - lay.height / 2 + lay.size * 0.8;
        const next = lines[li + 1];
        const gust = next ? Math.max(ln.end + 0.3, next.start - 1.2) : ln.end + 1.2;
        this.solo.push({ line: ln, lay, x0, y0, gust });
        const st = clamp(lay.size / 10.5, 3.8, 7);
        for (const pw of lay.words) {
          sample(() => { c.font = font(FAM_SOLO, lay.size); c.fillText(pw.word.w, x0 + pw.x, y0 + pw.y); },
            [x0 + pw.x - 6, y0 + pw.y - lay.size, pw.w + 12, lay.size * 1.3], st, (x, y) => {
              if (P.length >= CAP - NAMB - 600) return;
              const i = P.length, f = toFloor(x, y);
              const land = ln.start - 0.35 + ((x - MSG_BOX.x) / MSG_BOX.w) * 0.3 + (rnd(i, 1) - 0.5) * 0.1;
              P.push({ x: f.x, z: f.z, rot: rnd(i, 2) * TAU, size: st * S * (1.3 + 0.3 * rnd(i, 3)), land, fall: 1.0 + 0.4 * rnd(i, 4), gust: gust + ((x - 200) / 1600) * 0.35, kind: 0, seed: sd(i), word: [pw.word.start, pw.word.end] });
            });
        }
      });
    }
    /** 零星花瓣的落點：大多落在字的外面，右下角 HUD 不放。 */
    const scatter = (i: number) => {
      let x = rnd(i, 21) * 1920, y = rnd(i, 22) * 1080;
      if (x > MSG_BOX.x - 20 && x < MSG_BOX.x + MSG_BOX.w && y > MSG_BOX.y - 20 && y < MSG_BOX.y + MSG_BOX.h + 40 && rnd(i, 23) < 0.85) x = rnd(i, 24) * (MSG_BOX.x - 60);
      if (inHud(x, y)) { x = rnd(i, 25) * 1300; }
      return toFloor(x, y);
    };
    // 零星的花瓣：窗格開始前就有一些落在地上，之後一直慢慢飄
    for (let k = 0; k < NAMB; k++) {
      const i = P.length, f = scatter(i);
      const land = s - 6 + rnd(i, 26) * (e - s + 8);
      P.push({ x: f.x, z: f.z, rot: rnd(i, 27) * TAU, size: 0.9 + 0.7 * rnd(i, 28), land, fall: 2.2 + 1.5 * rnd(i, 29), gust: Infinity, kind: 1, seed: sd(i), word: [-1, -1] });
    }
    // 每個小節線：從鏡頭上方灑下一小把花瓣（在小節線那一刻出現，飄一兩秒落地）；窗格裡每小節一個看得到的節奏
    const bars = winBars(au, s - 0.01, e);
    for (const tb of bars) {
      for (let k = 0; k < NFLURRY && P.length < CAP; k++) {
        const i = P.length, f = scatter(i);
        const fall = 1.2 + 0.9 * rnd(i, 30);
        P.push({ x: f.x, z: f.z, rot: rnd(i, 27) * TAU, size: 1.0 + 0.8 * rnd(i, 28), land: tb + 0.04 * k / NFLURRY + fall, fall, gust: Infinity, kind: 1, seed: sd(i), word: [-1, -1] });
      }
    }
    // ---- 拉炮：每兩小節（偶數小節線）砰一聲，噴出一大把花瓣與幾條彩帶，落在左半邊的地板上
    this.pops = winBars(au, s - 9, e).filter((tb) => Math.round(au.barAt(tb)) % 2 === 0);
    const mouth: [number, number, number] = [(POP.mx - 960) * S, POP.mh, (POP.my - 540) * S];
    /** 筒口前面一個扇形裡的落點（頁面 px）：避開留言、歌詞那一行與右下角 HUD。 */
    const fan = (i: number, r0: number, r1: number) => {
      for (let k = 0; k < 10; k++) {
        const a = POP_DIR + (rnd(i, 40 + k) - 0.5) * 1.7, r = r0 + (r1 - r0) * Math.sqrt(rnd(i, 60 + k));
        const x = POP.mx + Math.cos(a) * r, y = POP.my + Math.sin(a) * r;
        if (x > 50 && x < MSG_BOX.x - 50 && y > 50 && y < 860 && !inHud(x, y)) return { x, y, r };
      }
      return { x: POP.mx + Math.cos(POP_DIR) * r0, y: POP.my + Math.sin(POP_DIR) * r0, r: r0 };
    };
    const R: Ribbon[] = [];
    for (const [pi, tp] of this.pops.entries()) {
      for (let k = 0; k < NBURST && P.length < CAP; k++) {
        const i = P.length, g = fan(i, 90, 720), f = toFloor(g.x, g.y);
        const fall = 1.0 + 0.9 * rnd(i, 31);
        P.push({ x: f.x, z: f.z, rot: rnd(i, 27) * TAU, size: 1.0 + 0.9 * rnd(i, 28), land: tp + 0.05 * rnd(i, 32) + fall, fall, gust: Infinity, kind: 1, seed: sd(i), word: [-1, -1], from: [...mouth, 22 + 60 * rnd(i, 33)] });
      }
      for (let k = 0; k < NRIB; k++) {
        const i = 50000 + pi * 16 + k, g = fan(i, 180, 640), f = toFloor(g.x, g.y);
        const L = Math.min(g.r * S * 0.7, 14 + 22 * rnd(i, 70));
        R.push({ a: [...mouth, tp + 0.03 * k], b: [f.x, f.z, L, 1.0 + 0.5 * rnd(i, 71)], c: [28 + 45 * rnd(i, 72), 1.5 + 0.8 * rnd(i, 73), 2 + 2.5 * rnd(i, 74), 1.3 + 1.6 * rnd(i, 75)], d: [rnd(i, 76), rnd(i, 77), rnd(i, 78), rnd(i, 79)] });
      }
    }
    this.buildGeo(P);
    this.buildRibbons(R);
    this.avoid = [[MSG_BOX.x, MSG_BOX.y, MSG_BOX.w, MSG_BOX.h], [LYR.x, LYR.y - 60, LYR.w, 80], [POP.bx - 40, POP.my - 80, POP.mx - POP.bx + 120, POP.by - POP.my + 120]];
  }

  private buildGeo(P: Petal[]) {
    const g = this.geo;
    const base = new THREE.PlaneGeometry(1, 1);
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    g.setIndex(base.getIndex());
    const n = P.length;
    const tgt = new Float32Array(n * 4), tim = new Float32Array(n * 4), sd = new Float32Array(n * 4), wd = new Float32Array(n * 2), fr = new Float32Array(n * 4);
    P.forEach((p, i) => {
      tgt.set([p.x, p.z, p.rot, p.size], i * 4);
      if (p.from) fr.set(p.from, i * 4);
      // Infinity 在 GPU 上不好用：吹走的時間沒有就放很大
      tim.set([p.land, p.fall, Number.isFinite(p.gust) ? p.gust : 1e6, p.kind], i * 4);
      sd.set(p.seed, i * 4);
      wd.set(p.word, i * 2);
    });
    g.setAttribute('aTgt', new THREE.InstancedBufferAttribute(tgt, 4));
    g.setAttribute('aTime', new THREE.InstancedBufferAttribute(tim, 4));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(sd, 4));
    g.setAttribute('aWord', new THREE.InstancedBufferAttribute(wd, 2));
    g.setAttribute('aFrom', new THREE.InstancedBufferAttribute(fr, 4));
    g.instanceCount = n;
    base.dispose();
  }

  /** 彩帶：一條 RSEG 段的帶子（兩排頂點），每條彩帶的參數放在 instance attribute。 */
  private buildRibbons(R: Ribbon[]) {
    const g = this.rgeo;
    const pos = new Float32Array((RSEG + 1) * 2 * 3), idx: number[] = [];
    for (let j = 0; j <= RSEG; j++) {
      pos.set([j / RSEG, -1, 0, j / RSEG, 1, 0], j * 6);
      if (j < RSEG) { const a = j * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    const A = new Float32Array(R.length * 4), B = new Float32Array(R.length * 4), C = new Float32Array(R.length * 4), D = new Float32Array(R.length * 4);
    R.forEach((r, i) => { A.set(r.a, i * 4); B.set(r.b, i * 4); C.set(r.c, i * 4); D.set(r.d, i * 4); });
    g.setAttribute('aA', new THREE.InstancedBufferAttribute(A, 4));
    g.setAttribute('aB', new THREE.InstancedBufferAttribute(B, 4));
    g.setAttribute('aC', new THREE.InstancedBufferAttribute(C, 4));
    g.setAttribute('aD', new THREE.InstancedBufferAttribute(D, 4));
    g.instanceCount = R.length;
  }

  /**
   * 地上的光字：花瓣排的字上面同一個字的清楚光字（字落定後浮出來，讓花瓣排的字讀得清楚）、署名；
   * 有留言時左下是歌詞（或純音樂的歌名）；沒有留言時是正在唱的那一句（跟唱）與左下的新人名字、邀請。
   */
  private drawFloorText(t: number) {
    const L = this.txt, c = L.ctx, { lyrics, song } = this.ctx;
    L.clear();
    c.textBaseline = 'alphabetic';
    // 風把字吹散的時候，地上的光字也一起退掉
    const out = 1 - prog(t, this.gustAt, this.gustAt + 0.35);
    this.glyphs.forEach((g, gi) => {
      const a = prog(t, this.gT[gi]! + 0.15, this.gT[gi]! + 0.6, ease.outCubic) * out;
      if (a <= 0) return;
      c.globalAlpha = a;
      if (g.ch === '♥') { drawHeart(c, g.x + g.w / 2, g.y - g.size * 0.36, Math.min(g.w, g.size * 0.8) * 0.92); return; }
      c.font = font(FAM_MSG, g.size); c.fillStyle = rgba('bone', 0.95);
      c.fillText(g.ch, g.x, g.y);
    });
    c.globalAlpha = 1;
    if (this.sig && t >= this.sigT) {
      c.globalAlpha = prog(t, this.sigT, this.sigT + 0.4) * out;
      c.font = font(this.sig.family, this.sig.size); c.fillStyle = rgba('bone', 0.85);
      c.fillText(this.sig.text, this.sig.x, this.sig.y);
      c.globalAlpha = 1;
    }
    if (this.msg) {
      const ly = this.hasLyr ? lyricAt(lyrics, t) : null;
      if (ly) {
        const lay = layoutRows(c, ly.line, { family: FAM_LYR, size: this.lyrSize, minSize: V2.lyrMin * K_LYR, maxW: LYR.w, maxRows: 1, align: 'left' });
        c.save(); c.translate(LYR.x, LYR.y); drawRows(c, lay, FAM_LYR, t, darkInk(), ly.k); c.restore();
      } else if (!this.hasLyr) {
        c.font = font(F.mono(500), 20); c.fillStyle = rgba('ash', 0.75); c.letterSpacing = '4px';
        c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`, LYR.x, LYR.y - 10);
        c.letterSpacing = '0px';
      }
    } else {
      // 地上排著的那一句（花瓣落定到被風吹走之間）：花瓣上面同一句的光字，照唱的進度亮起來。
      // 兩句之間的空檔花瓣還在地上，光字也要留著（不然只剩一團讀不出來的花瓣），被風吹走時一起退掉
      let sl: SoloLine | undefined;
      for (const x of this.solo) if (x.line.start - 0.4 <= t) sl = x;
      if (sl) {
        const k = Math.min(prog(t, sl.line.start - 0.4, sl.line.start - 0.05), 1 - prog(t, sl.gust, sl.gust + 0.35));
        if (k > 0) { c.save(); c.translate(sl.x0, sl.y0); drawRows(c, sl.lay, FAM_SOLO, t, darkInk(), k); c.restore(); }
      }
      if (this.hasLyr) {
        c.font = font(F.ming(700), 34); c.fillStyle = rgba('bone', 0.8); c.letterSpacing = '4px';
        c.fillText(COUPLE_ZH, LYR.x, LYR.y - 24);
      }
      c.font = font(F.hei(500), 20); c.fillStyle = rgba('ash', 0.75); c.letterSpacing = '3px';
      c.fillText(T23_INVITE, LYR.x, LYR.y + 16);
      c.letterSpacing = '0px';
    }
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const st = this.stage, U = st.U;
    st.petals.geometry = this.geo;
    st.ribbons.geometry = this.rgeo;
    U.uT.value = t;
    U.uKick.value = f.a.kick;
    U.uOn.value = 0.6 + 0.4 * ease.outCubic(prog(t, s, this.tOn + 0.1));
    // 拉炮：砰的那一下往後一頓（很快、再慢慢回來），筒口與前面的地板亮一下；同時一圈風從筒口往外掃
    const tp = lastBefore(this.pops, t), tau = t - tp;
    U.uRip.value = Number.isFinite(tp) ? tau : -1;
    const pop = tau >= 0 && tau < 0.8 ? Math.exp(-tau / 0.12) : 0;
    U.uPop.value = pop;
    const kick = tau >= 0 && tau < 1 ? Math.min(1, tau / 0.025) * Math.exp(-tau / 0.16) : 0;
    st.popper.position.copy(st.popAt).addScaledVector(st.popAxis, 2.6 * kick);
    this.drawFloorText(t);
    U.uTxt.value = this.txt.texture;
    U.uGlow.value = this.glow.texture;
    // 風吹散字的時候，字底下的光也一起退掉
    U.uGlowA.value = this.glyphs.length ? 0.4 * prog(t, this.sigT - 0.3, this.sigT + 0.8) * (1 - prog(t, this.gustAt, this.gustAt + 0.3)) : 0;
    // 鏡頭：幾乎正上方往下看（稍微斜），切進來時高一點、第一拍落定，之後很慢地往下推
    const land = ease.outExpo(prog(t, s, Math.max(s + 0.3, this.tOn + 0.1)));
    const drift = ease.inOutQuad(clamp((t - s) / Math.max(1, e - s)));
    const cam = this.cam;
    const hgt = 158 + 22 * (1 - land) - 8 * drift;
    cam.position.set(0, hgt, hgt * 0.3);
    cam.lookAt(0, 0, -0.5);
    cam.updateMatrixWorld();
    U.uFocus.value = cam.position.length();
    // 全引擎共用的一張 MSAA：畫進去之後在這個 render() 裡就解析到 out
    const rt = sharedMSAA();
    clearRT(renderer, rt, [0, 0, 0]);
    renderer.setRenderTarget(rt);
    renderer.render(st.scene, cam);
    comp.draw(renderer, rt.texture, out, { mode: 'replace', premult: false });
    return { bloom: 0.8, bloomThreshold: 0.92, vignette: 0.6, halation: 0.3, popupAvoid: this.avoid };
  }

  override dispose() {
    if (this.stage.petals.geometry === this.geo) this.stage.petals.geometry = EMPTY;
    if (this.stage.ribbons.geometry === this.rgeo) this.stage.ribbons.geometry = EMPTY;
    this.geo.dispose();
    this.rgeo.dispose();
    super.dispose();
  }
}
