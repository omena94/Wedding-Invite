// 販賣機（暗）：深夜巷口，一台亮著的「祝福販賣機」，後面是拉下來的鐵捲門，地上是濕的柏油路（映著販賣機的光）。
// v2（2026-09-28 新人：「留言板都太大太突兀」「空出來的地方可以再多補一些動畫」）重新構圖——
// 罐子只是小道具，販賣機的燈與巷子的動態才是主角：
//  - 販賣機站在畫面左邊（鏡頭很低、稍微仰拍）：頂上的燈箱招牌是歌詞（逐字跟唱，40～52 px），
//    中間兩層商品被裡面的燈照亮，商品下面的按鈕跟著拍子一顆一顆亮；
//    下半部一塊點陣 LED 看板——主打留言在拍點上一個字一個字「打」上去（訊號色的 LED 點，螢幕上 40～60 px），
//    打完之後，署名是一張手寫的小紙條「啪」地貼在 LED 右下角的機身上（26～32 px；點陣的小字糊成一團讀不出來），
//    之後每個小節線有一道光從左到右掃過 LED。LED 看板約 560×350（留言區 ≤ 860×430）。
//  - 第一個小節線：訊號色那一罐的按鈕被按下，「咚」一聲掉進取物口（機器震一下、取物口的蓋子閃一下），
//    一罐小小的罐子從取物口滾出來、在地上彈兩下，滾到畫面右前方停住、晃兩下（小道具）。
//  - 巷子一直在動：飛蛾繞著販賣機的招牌和右邊的路燈飛（翅膀一拍一拍，大鼓時有一隻撞一下燈）；路燈偶爾閃兩下、
//    把右邊那面牆（排水管、舊海報、冷氣機的水痕、電線）照亮一片；
//    隔幾個小節有車子從巷口經過，車燈掃過鐵捲門與地面；屋簷滴水，地上的水窪在拍點上起一圈漣漪。
//  - 沒有留言：LED 看板改成正在唱的歌詞（逐字跟唱，焦點），招牌放邀請；純音樂又沒有留言：LED 看板是邀請，招牌是歌名。
// 手法：three.js 真的 3D（販賣機、罐子、路燈是網格，自己寫的 shader 打光），販賣機正面、招牌、LED、罐子標籤是 Canvas 圖層
// （不會變的畫一次；LED 只有 252×150 個點，內容變了才重畫），LED 的點在 shader 裡用 texelFetch 一點一點取；
// 地面與鐵捲門是 shader（濕地的倒影、罐子的影子、漣漪、車燈）。4x MSAA。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H, sharedMSAA } from '../engine/gl';
import { GLSL_COMMON, THEME_UNIFORMS } from '../engine/glsl/common';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, prog, lerp, pulse, hash, mulberry32 } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { fillWithHearts, beatAfter, drawHeart, lyricSubOf, layoutLyric, subStyleFor, subGap, drawLyricSub, type LyricStyle } from './_motifs';
import { grid, layoutRows, drawRows, paperInk } from './_t4';
import { INVITE } from './_t14';
import { shownLyric, sigOf } from './_t24';
import { msgMaxFor, lyricV2, sigV2, V2, fitClauses } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'local', paper: false, energy: [0.25, 0.9], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 尺寸（世界單位，地面 y = 0）
/** 販賣機：正面寬 MW、高 MH、深 MD；正面的左下角在 M0，往右轉 MYAW（正面稍微朝向鏡頭，看得到一點右側板）。 */
const MW = 860, MH = 1400, MD = 560;
const MYAW = 0.12;
const M0 = new THREE.Vector3(-1150, 0, -320);
/** 正面上的各區（正面座標：左上原點、y 向下）。 */
const HEAD = { x: 30, y: 26, w: 800, h: 190 };
const WIN = { x: 30, y: 236, w: 800, h: 470 };
const LED = { x: 22, y: 730, w: 816, h: 486 };
const TRAY = { x: 60, y: 1252, w: 470, h: 116 };
/** 署名紙條：右緣、垂直中心（正面座標），一半貼在 LED 的右下角、一半貼在下面的機身上；LED 底下留這麼多點給它。 */
const STICK = { x1: LED.x + LED.w - 14, cy: LED.y + LED.h - 6, rot: -0.045, reserveDots: 16 };
/** LED 看板的點數：點距 3.24 世界單位（螢幕上約 2.2 px）。 */
const DOTW = 252, DOTH = 150;
const DOT = LED.w / DOTW;
/** 鏡頭看 LED 時，1 世界單位約是螢幕上幾 px（算 LED 上的字要幾個點）。 */
const S_LED = 0.68;
/** 螢幕 px → LED 的點數。 */
const dots = (screenPx: number) => screenPx / (S_LED * DOT);
/** 罐子（小道具）：半徑、長度；標籤只包中間那一段。 */
const CR = 62, CL = 240, LAB = 196;
const CIRC = 2 * Math.PI * CR;
/** 罐子最後停的地方（軸是世界的 x）。 */
const REST = new THREE.Vector3(60, CR, -130);
const FOV = 34;
/** 罐子在空中翻的軸（斜的，翻起來比較自然）。 */
const TUMBLE = new THREE.Vector3(0.35, 0.5, 0.8).normalize();
/** 路燈（巷子右邊）：燈柱位置、燈頭高度。 */
const LAMP = { x: 640, z: -520, h: 1560 };
/** 牆上的冷氣機（會滴水）與樓上的窗（世界座標，在鐵捲門那面牆上）。 */
const AC = { x0: 1120, x1: 1400, y0: 940, y1: 1080, dripX: 1330 };
/** 地上的水窪（世界 xz、半徑）：屋簷滴水在拍點上起漣漪；第一個在冷氣機的正下方（滴下來的水落在這裡）。 */
const PUDDLES: [number, number, number][] = [[AC.dripX, -860, 200], [380, -120, 300], [-120, -40, 180], [980, -420, 260]];
/** 水從冷氣機滴到地上要多久（秒）。 */
const DRIP_FALL = 0.42;
/** 鏡頭：開場稍微遠一點、偏右，慢慢推近到 PB（販賣機在左、巷子在右）。 */
const PA = { pos: [260, 560, 2480], look: [90, 700, -320] } as const;
const PB = { pos: [160, 520, 2260], look: [40, 690, -320] } as const;

const FAM_MSG = F.hei(700);
const FAM_LYR = F.archivo(100, 800);
const HEADER = '祝福販賣機';
const PRE = 'precision highp float;\nprecision highp int;\n';

// ---------------------------------------------------------------- shader
const VERT = /* glsl */ `${PRE}
in vec3 position; in vec3 normal; in vec2 uv;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
out vec3 vW; out vec3 vN; out vec2 vUv; out vec3 vO;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vUv = uv; vO = position;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** 光：路燈（右上後方、偏暖的白），販賣機正面是一大片冷冷的光。 */
const LIGHT = /* glsl */ `
uniform vec3 camPos; uniform vec3 machC; uniform vec3 machN; uniform float glow;
uniform float lampK;                 // 路燈的亮度（偶爾閃一下）
uniform vec4 sweep;                  // 車燈掃過：x 中心、強度、-、-
const vec3 LAMPP = vec3(${LAMP.x}.0, ${LAMP.h - 40}.0, ${LAMP.z}.0);
vec3 machGlowCol() { return mix(C_BONE, C_SIGNAL, 0.35); }
// 販賣機正面的光打到 P（面朝它、離它近的地方亮）
float machLight(vec3 P, vec3 N) {
  vec3 d = machC - P; float r = length(d);
  float facing = max(dot(-normalize(d), machN), 0.0);
  return glow * max(dot(N, d / r), 0.0) * facing * 520000.0 / (r * r + 250000.0);
}
float lampLight(vec3 P, vec3 N) {
  vec3 d = LAMPP - P; float r = length(d);
  return lampK * max(dot(N, d / r), 0.0) * 900000.0 / (r * r + 900000.0);
}`;

const CAN_FRAG = /* glsl */ `${PRE}
in vec3 vW; in vec3 vN; in vec2 vUv; in vec3 vO;
out vec4 fragColor;
${GLSL_COMMON}
${LIGHT}
uniform sampler2D lab;
void main() {
  vec3 N = normalize(vN), V = normalize(camPos - vW);
  float ax = vO.x;
  float ang = atan(vO.y, vO.z);
  vec3 base; float spec = 0.0; float rough = 30.0;
  float onLab = step(abs(ax), ${(LAB / 2).toFixed(1)});
  if (abs(vO.x) > ${(CL / 2 - 0.5).toFixed(1)}) {
    float rr = length(vO.yz) / ${CR.toFixed(1)};
    base = mix(C_ASH, C_BONE, 0.35) * (0.55 + 0.25 * sin(rr * 40.0) * step(rr, 0.85) + 0.2 * smoothstep(0.85, 0.95, rr));
    spec = 0.9; rough = 20.0;
  } else if (onLab > 0.5) {
    vec2 uv = vec2((ax + ${(LAB / 2).toFixed(1)}) / ${LAB.toFixed(1)}, 0.5 - ang / ${(2 * Math.PI).toFixed(5)});
    base = fastLayer(texture(lab, vec2(uv.x, 1.0 - uv.y))).rgb;
    spec = 0.35; rough = 42.0;
  } else {
    float k = (abs(ax) - ${(LAB / 2).toFixed(1)}) / ${(CL / 2 - LAB / 2).toFixed(1)};
    base = mix(C_ASH, C_BONE, 0.3) * (0.75 - 0.35 * smoothstep(0.55, 0.8, k) + 0.25 * smoothstep(0.8, 1.0, k));
    spec = 1.0; rough = 26.0;
  }
  vec3 L = normalize(LAMPP - vW);
  vec3 R = reflect(-L, N);
  float ao = 0.5 + 0.5 * smoothstep(-0.85, 0.35, N.y);
  vec3 col = base * (0.1 + 0.6 * lampLight(vW, N)) * ao;
  col += machGlowCol() * base * machLight(vW, N) * 0.8;
  col += mix(C_BONE, C_EMBER, 0.3) * spec * pow(max(dot(R, V), 0.0), rough) * 0.6 * lampK;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += machGlowCol() * rim * 0.35 * glow * max(dot(N, normalize(machC - vW)) + 0.3, 0.0);
  fragColor = vec4(col, 1.0);
}`;

/**
 * 販賣機：kind 0 = 機身（深色烤漆）、1 = 正面（貼圖＋自發光＋按鈕）、2 = 招牌燈箱（貼圖，發光）、3 = 點陣 LED、
 * 4 = 路燈的燈頭（發光）。
 */
const MACH_FRAG = /* glsl */ `${PRE}
in vec3 vW; in vec3 vN; in vec2 vUv; in vec3 vO;
out vec4 fragColor;
${GLSL_COMMON}
${LIGHT}
uniform float kind; uniform sampler2D tex;
uniform float btn[10]; uniform float thunk; uniform vec4 btnGeo; // 按鈕列：第一顆的 x、y、間距 x、間距 y（正面 px）
uniform vec2 ledSweep;  // LED 上掃過的光：位置（0..1）、強度
void main() {
  vec3 N = normalize(vN);
  if (kind < 0.5) {
    vec3 base = mix(C_INK2, C_GRAPHITE, 0.35);
    vec3 col = base * (0.2 + 0.5 * lampLight(vW, N)) + base * 0.35 * max(N.y, 0.0);
    col += mix(C_BONE, C_EMBER, 0.3) * 0.12 * sweep.y * exp(-pow((vW.x - sweep.x) / 260.0, 2.0)) * max(N.x, 0.0);
    fragColor = vec4(col, 1.0);
    return;
  }
  if (kind > 3.5) {
    fragColor = vec4(mix(C_EMBER, C_BONE, 0.5) * 3.2 * lampK, 1.0);
    return;
  }
  if (kind > 2.5) {
    // 點陣 LED：每個點一個格子，取那一格的字（texelFetch，不內插），點是圓的；沒亮的點淡淡看得到
    vec2 d = vUv * vec2(${DOTW}.0, ${DOTH}.0);
    vec2 cell = floor(d), lc = fract(d) - 0.5;
    vec4 Lx = fastLayer(texelFetch(tex, ivec2(cell), 0));
    float dotm = 1.0 - smoothstep(0.27, 0.43, length(lc));
    float on = smoothstep(0.18, 0.7, Lx.a);
    vec3 c = Lx.a > 0.0 ? Lx.rgb / Lx.a : vec3(0.0);
    // 色版：紅 = 留言（訊號色）、綠 = 愛心（點綴色）、藍 = 正在唱（最亮）、白 = 署名與唱完的字（紙白）
    float white = min(c.r, min(c.g, c.b));
    vec3 lit = C_BONE * white * 1.05 + C_SIGNAL * (c.r - white) * 1.5 + C_ROSE * (c.g - white) * 0.95 + C_EMBER * (c.b - white) * 2.4;
    float sw = ledSweep.y * exp(-pow((vUv.x - ledSweep.x) * 7.0, 2.0));
    lit *= 1.0 + 0.9 * sw;
    vec3 off = C_INK2 * 1.5 + C_SIGNAL * 0.012;
    vec3 col = mix(C_INK * 0.45, mix(off, lit, on), dotm);
    fragColor = vec4(col * glow, 1.0);
    return;
  }
  vec4 L = fastLayer(texture(tex, vUv));
  vec3 col = L.rgb * glow;
  if (kind < 1.5) {
    vec2 px = vec2(vUv.x * ${MW.toFixed(1)}, (1.0 - vUv.y) * ${MH.toFixed(1)});
    // 按鈕：拍點亮起來的那一顆（訊號色，會發光）
    for (int i = 0; i < 10; i++) {
      vec2 c = btnGeo.xy + vec2(float(i - (i / 5) * 5) * btnGeo.z, float(i / 5) * btnGeo.w);
      float d = length(px - c);
      col += C_SIGNAL * btn[i] * (1.8 * (1.0 - smoothstep(9.0, 11.0, d)) + 0.25 * exp(-d * d / 400.0));
    }
    // 取物口的蓋子：罐子掉下來那一下閃一下
    vec2 tq = abs(px - vec2(${(TRAY.x + TRAY.w / 2).toFixed(1)}, ${(TRAY.y + TRAY.h / 2).toFixed(1)})) - vec2(${(TRAY.w / 2).toFixed(1)}, ${(TRAY.h / 2).toFixed(1)});
    col += machGlowCol() * 0.25 * thunk * (1.0 - smoothstep(0.0, 4.0, max(tq.x, tq.y)));
    // 商品窗玻璃的斜反光
    float g = smoothstep(0.02, 0.0, abs(px.x * 0.35 + px.y - 520.0) / 300.0 - 0.1) * step(${WIN.y}.0, px.y) * step(px.y, ${WIN.y + WIN.h}.0);
    col += C_BONE * 0.03 * g;
  }
  fragColor = vec4(col, 1.0);
}`;

/** 地面（濕的柏油）、後面的鐵捲門、空氣裡的光。kind 0 = 地、1 = 鐵捲門、-1 = 販賣機前的一團光、-2 = 路燈的光錐。 */
const ENV_FRAG = /* glsl */ `${PRE}
in vec3 vW; in vec3 vN; in vec2 vUv; in vec3 vO;
out vec4 fragColor;
${GLSL_COMMON}
${LIGHT}
uniform float kind; uniform vec4 canS; // 罐子的影子：中心 x、z、長軸方向角、在地上嗎（0..1）
uniform vec4 rip[4];                  // 水窪的漣漪：中心 x、z、半徑、已經擴散多久（秒，< 0 沒有）
uniform vec3 drip;                    // 正在掉的水滴：x、y、亮度
uniform float uT; uniform float neon; // 時間、霓虹燈管的亮度（偶爾閃）
void main() {
  vec3 P = vW;
  vec3 gc = machGlowCol();
  vec3 warm = mix(C_BONE, C_EMBER, 0.35);
  if (kind > 0.5) {
    // 後面那面牆：下半是鐵捲門（橫的一條一條），右邊是樓房的牆——樓上一扇亮著的窗（窗簾在風裡晃）、窗下一台冷氣機（會滴水）；
    // 鐵捲門上緣一條霓虹燈管（訊號色，偶爾閃）。被販賣機與路燈照亮一片，車子經過時車燈從右掃到左。
    float lit = glow * 520000.0 / (dot(P - machC, P - machC) + 260000.0);
    // 路燈照到牆上：離燈越近越亮（距離平方衰減），牆面朝著燈的程度
    vec3 dl = LAMPP - P;
    float lamp = lampK * (1.4e6 / (dot(dl, dl) + 3.5e5)) * (0.35 + 0.65 * max(normalize(dl).z, 0.0));
    float sw = sweep.y * exp(-pow((P.x - sweep.x) / 240.0, 2.0)) * smoothstep(0.0, 300.0, P.y) * (1.0 - smoothstep(900.0, 1400.0, P.y));
    float shutter = step(P.x, 1060.0) * step(P.y, 1150.0);
    vec3 base;
    if (shutter > 0.5) {
      float rib = 0.5 + 0.5 * sin(P.y / 7.0);
      float seam = pxLine(abs(fract(P.y / 44.0) - 0.5) * 44.0, 0.6, 1.6);
      base = mix(C_INK2, C_GRAPHITE, 0.45) * (0.75 + 0.2 * rib) * (1.0 - 0.35 * seam) * (0.9 + 0.1 * snoise(P.xy / 200.0));
    } else {
      // 牆：舊舊的小磁磚（淡淡的格線、一片一片的髒污）
      vec2 tl = abs(fract(P.xy / vec2(46.0, 24.0)) - 0.5) * vec2(46.0, 24.0);
      base = mix(C_INK2, C_ASH, 0.22) * (0.78 + 0.22 * fbm(P.xy / 260.0, 2)) * (1.0 - 0.25 * (1.0 - smoothstep(0.5, 1.5, min(23.0 - tl.x, 12.0 - tl.y))));
      // 冷氣機底下一道往下流的水痕（比較暗）
      base *= 1.0 - 0.35 * exp(-pow((P.x - ${AC.dripX}.0 + 10.0 * sin(P.y * 0.01)) / 34.0, 2.0)) * step(P.y, ${AC.y0}.0) * (0.6 + 0.4 * snoise(vec2(P.x / 20.0, P.y / 200.0)));
      // 兩張舊海報（褪色的紙、下緣撕破、印刷的條紋——看不出字，只是生活感）
      for (int k = 0; k < 2; k++) {
        vec2 pc = k == 0 ? vec2(1215.0, 470.0) : vec2(1400.0, 430.0);
        vec2 ph = k == 0 ? vec2(80.0, 105.0) : vec2(62.0, 80.0);
        vec2 pq = rot2(k == 0 ? 0.03 : -0.05) * (P.xy - pc);
        float torn = ph.y * (0.75 + 0.25 * snoise(vec2(pq.x / 18.0, float(k) * 7.0)));
        if (abs(pq.x) < ph.x && pq.y < ph.y && pq.y > -torn) {
          float print = 0.85 + 0.15 * step(0.5, fract(pq.y / 14.0)) * step(abs(pq.x), ph.x - 14.0);
          base = mix(C_PAPER, C_SEPIA, 0.45) * 0.42 * print * (0.8 + 0.2 * snoise(pq / 30.0));
        }
      }
      // 排水管：一根直的圓管（左亮右暗），每隔一段一個固定環
      float pd = abs(P.x - 1590.0);
      if (pd < 18.0) {
        float cyl = 0.55 + 0.45 * cos(pd / 18.0 * 1.4 + 0.5);
        base = mix(C_GRAPHITE, C_ASH, 0.25) * 0.55 * cyl * (1.0 + 0.4 * step(abs(fract(P.y / 320.0) - 0.5) * 320.0, 6.0));
      }
      // 電線：兩條從右上方垂下來的弧線
      for (int k = 0; k < 2; k++) {
        float wy = 1720.0 - float(k) * 60.0 - 0.00016 * pow(P.x - 1350.0 - float(k) * 90.0, 2.0);
        base *= 1.0 - 0.8 * (1.0 - smoothstep(1.5, 3.5, abs(P.y - wy)));
      }
    }
    vec3 col = base * (0.03 + 0.5 * lit * lit + 0.42 * lamp) + gc * 0.05 * lit + warm * 0.22 * sw + warm * 0.01 * lamp;
    // 樓上的窗：暖黃的光，十字窗框，左邊的窗簾隨風擺（簾子的邊緣是一條慢慢晃的曲線）
    vec2 wq = P.xy - vec2(1380.0, 1420.0);
    if (abs(wq.x) < 190.0 && abs(wq.y) < 140.0) {
      float frame = step(abs(wq.x), 5.0) + step(abs(wq.y), 5.0) + step(176.0, abs(wq.x)) + step(126.0, abs(wq.y));
      float edge = -50.0 + 34.0 * sin(wq.y * 0.014 + uT * 1.1) + 16.0 * sin(uT * 0.7);
      float curtain = smoothstep(edge + 6.0, edge - 6.0, wq.x);
      vec3 room = mix(mix(C_EMBER, C_BLOOD, 0.3), C_BONE, 0.2) * (0.3 + 0.05 * sin(uT * 0.9)) * (1.0 - 0.35 * smoothstep(0.0, 140.0, abs(wq.y)));
      vec3 win = mix(room, room * 0.35 + C_BLOOD * 0.08, curtain);
      col = mix(win, C_INK * 0.8, min(frame, 1.0));
    }
    // 窗下往外灑的一片光
    col += mix(C_EMBER, C_BONE, 0.4) * 0.03 * exp(-pow((P.x - 1380.0) / 240.0, 2.0)) * exp(-max(0.0, 1280.0 - P.y) / 160.0) * step(P.y, 1280.0) * (1.0 - shutter);
    // 冷氣機：灰色的箱子、橫的散熱片
    if (P.x > ${AC.x0}.0 && P.x < ${AC.x1}.0 && P.y > ${AC.y0}.0 && P.y < ${AC.y1}.0) {
      float fin = 0.5 + 0.5 * sin(P.y * 0.9);
      col = mix(C_GRAPHITE, C_ASH, 0.2) * (0.12 + 0.06 * fin) * (0.4 + 0.6 * lamp + 0.5 * lit) + warm * 0.02;
    }
    // 霓虹燈管：鐵捲門上緣一條（兩根細管，訊號色），偶爾閃
    float tube = exp(-pow((P.y - 1178.0) / 3.2, 2.0)) + 0.6 * exp(-pow((P.y - 1194.0) / 2.6, 2.0));
    float span = smoothstep(-520.0, -500.0, P.x) * (1.0 - smoothstep(760.0, 780.0, P.x));
    col += C_SIGNAL * neon * (1.3 * tube + 0.06 * exp(-abs(P.y - 1185.0) / 60.0)) * span;
    // 正在掉的水滴：一小段亮亮的線（映著窗的光）
    col += warm * 0.8 * drip.z * exp(-pow((P.x - drip.x) / 3.0, 2.0)) * exp(-pow((P.y - drip.y) / 14.0, 2.0));
    fragColor = vec4(col, 1.0);
    return;
  }
  if (kind < -1.5) {
    // 路燈的光錐（加亮）：燈頭（v = 1）亮、往下散開變淡
    float edge = 1.0 - smoothstep(0.2, 0.5, abs(vUv.x - 0.5));
    fragColor = vec4(warm * 0.05 * lampK * edge * pow(sat(vUv.y), 1.4) * (0.7 + 0.3 * snoise(vec2(vUv.x * 4.0, vUv.y * 3.0 - 0.0))), 0.0);
    return;
  }
  if (kind < -0.5) {
    vec2 q = (vUv - 0.5) * vec2(1.0, 1.3);
    fragColor = vec4(gc * 0.07 * glow * exp(-dot(q, q) * 7.0), 0.0);
    return;
  }
  // 柏油：暗、有細顆粒；有水的地方比較黑、反光比較亮
  float wet = smoothstep(-0.1, 0.4, fbm(P.xz / 520.0, 3));
  float pud = 0.0;
  for (int i = 0; i < 4; i++) pud = max(pud, 1.0 - smoothstep(rip[i].z * 0.8, rip[i].z, length(P.xz - rip[i].xy)));
  wet = max(wet, pud);
  vec3 base = C_INK * (0.8 + 0.4 * (0.5 + 0.5 * snoise(P.xz / 3.0))) + C_INK2 * 0.2;
  base *= mix(1.0, 0.6, wet);
  vec3 V = normalize(camPos - P);
  vec3 Rv = reflect(-V, vec3(0.0, 1.0, 0.0));
  // 販賣機的倒影：從販賣機腳下往鏡頭拉長的一片光，有水的地方比較清楚
  vec3 toM = machC - P; toM.y = 0.0;
  float d = length(toM);
  float refl = pow(max(dot(Rv, normalize(machC - P)), 0.0), mix(18.0, 60.0, wet)) * mix(0.2, 1.0, wet);
  float pool = 900000.0 / (d * d + 600000.0);
  // 路燈：一圈光＋在濕地上的倒影
  vec2 lq = (P.xz - vec2(${LAMP.x}.0, ${LAMP.z}.0)) / vec2(560.0, 480.0);
  float lpool = exp(-dot(lq, lq)) * lampK;
  float lrefl = pow(max(dot(Rv, normalize(LAMPP - P)), 0.0), mix(20.0, 70.0, wet)) * mix(0.15, 1.0, wet) * lampK;
  vec3 col = base * (0.3 + 1.3 * pool * glow + 0.9 * lpool) + gc * (0.09 * pool + 0.7 * refl) * glow + warm * 0.5 * lrefl;
  // 樓上的窗與霓虹在濕地上的倒影（往鏡頭拉長）
  col += mix(C_EMBER, C_BONE, 0.4) * 0.06 * wet * exp(-pow((P.x - 1380.0) / 150.0, 2.0)) * smoothstep(200.0, -900.0, P.z);
  col += C_SIGNAL * neon * 0.08 * wet * step(-500.0, P.x) * step(P.x, 770.0) * exp(-max(0.0, P.z + 960.0) / 420.0);
  // 車燈掃過地面
  col += warm * 0.06 * sweep.y * exp(-pow((P.x - sweep.x) / 300.0, 2.0)) * smoothstep(-400.0, 400.0, P.z);
  // 漣漪：水窪上一圈往外擴散的亮環（映著販賣機的光）
  for (int i = 0; i < 4; i++) {
    if (rip[i].w < 0.0) continue;
    float r = rip[i].w * 190.0, a = 1.0 - rip[i].w / 1.1;
    if (a <= 0.0) continue;
    float dd = length(P.xz - rip[i].xy);
    float ring = exp(-pow((dd - r) / 5.0, 2.0)) + 0.5 * exp(-pow((dd - r * 0.6) / 4.0, 2.0));
    col += gc * 0.12 * ring * a * step(dd, rip[i].z) * glow;
  }
  // 罐子在地上的影子（橢圓，沿著罐子的軸拉長）
  vec2 q = P.xz - canS.xy;
  float ca = cos(canS.z), sa = sin(canS.z);
  vec2 lq2 = vec2(ca * q.x - sa * q.y, sa * q.x + ca * q.y);
  float sh = exp(-pow(lq2.x / ${(CL * 0.55).toFixed(1)}, 2.0) - pow(lq2.y / ${(CR * 0.9).toFixed(1)}, 2.0));
  col *= 1.0 - 0.75 * sh * canS.w;
  fragColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------- 共用的 3D 道具
class Rig {
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(FOV, W / H, 20, 30000);
  U = {
    camPos: { value: new THREE.Vector3() }, machC: { value: new THREE.Vector3() }, machN: { value: new THREE.Vector3() },
    glow: { value: 1 }, lampK: { value: 1 }, sweep: { value: new THREE.Vector4() },
  };
  canMat: THREE.RawShaderMaterial;
  bodyMat: THREE.RawShaderMaterial;
  frontMat: THREE.RawShaderMaterial;
  headMat: THREE.RawShaderMaterial;
  ledMat: THREE.RawShaderMaterial;
  stickMat: THREE.RawShaderMaterial;
  /** 署名紙條（1×1 的平面，每格照紙條的大小縮放、在 t 之前藏起來）。 */
  sticker: THREE.Mesh;
  groundMat: THREE.RawShaderMaterial;
  doorMat: THREE.RawShaderMaterial;
  can: THREE.Mesh;
  machine = new THREE.Group();
  drip = { value: new THREE.Vector3() };
  envT = { value: 0 };
  neon = { value: 1 };
  constructor() {
    const mk = (frag: string, extra: Record<string, THREE.IUniform>) => new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: frag, uniforms: { ...THEME_UNIFORMS, ...this.U, ...extra },
    });
    this.canMat = mk(CAN_FRAG, { lab: { value: null } });
    const mach = (kind: number) => mk(MACH_FRAG, {
      kind: { value: kind }, tex: { value: null }, btn: { value: new Array(10).fill(0) }, thunk: { value: 0 },
      btnGeo: { value: new THREE.Vector4(WIN.x + 80 + 42, WIN.y + 210, 160, 235) }, ledSweep: { value: new THREE.Vector2() },
    });
    this.bodyMat = mach(0); this.frontMat = mach(1); this.headMat = mach(2); this.ledMat = mach(3);
    // 紙條跟招牌走同一條路（貼圖 × 販賣機的光）：貼在亮著的機器上，被它照亮
    this.stickMat = mach(2);
    const rip = { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 1, -1)) };
    const env = { rip, drip: this.drip, uT: this.envT, neon: this.neon };
    this.groundMat = mk(ENV_FRAG, { kind: { value: 0 }, canS: { value: new THREE.Vector4(0, 0, 0, 0) }, ...env });
    this.doorMat = mk(ENV_FRAG, { kind: { value: 1 }, canS: { value: new THREE.Vector4(0, 0, 0, 0) }, ...env });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), this.groundMat);
    ground.frustumCulled = false;
    this.scene.add(ground);
    // 鐵捲門：在販賣機後面，往右一路延伸到巷子深處
    const door = new THREE.Mesh(new THREE.PlaneGeometry(7000, 2800), this.doorMat);
    door.position.set(1400, 1400, -960);
    door.frustumCulled = false;
    this.scene.add(door);
    // 販賣機：機身＋正面（貼圖）＋招牌＋LED（各自一片，蓋在正面上一點點）
    const body = new THREE.Mesh(new THREE.BoxGeometry(MW + 30, MH + 30, MD), this.bodyMat);
    body.position.set(MW / 2, MH / 2 + 10, -MD / 2 - 1);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(MW, MH), this.frontMat);
    front.position.set(MW / 2, MH / 2 + 25, 1);
    const panel = (r: { x: number; y: number; w: number; h: number }, mat: THREE.Material, z: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.h), mat);
      m.position.set(r.x + r.w / 2, MH + 25 - (r.y + r.h / 2), z);
      return m;
    };
    const head = panel(HEAD, this.headMat, 3), led = panel(LED, this.ledMat, 3);
    const haze = new THREE.Mesh(new THREE.PlaneGeometry(1800, 2100), mk(ENV_FRAG, { kind: { value: -1 }, canS: { value: new THREE.Vector4() }, ...env }));
    const hm = haze.material as THREE.RawShaderMaterial;
    hm.transparent = true; hm.depthWrite = false; hm.blending = THREE.CustomBlending;
    hm.blendSrc = THREE.OneFactor; hm.blendDst = THREE.OneFactor;
    haze.position.set(MW / 2, MH * 0.55, 200);
    haze.renderOrder = 5;
    this.sticker = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.stickMat);
    for (const m of [body, front, head, led, haze, this.sticker]) { m.frustumCulled = false; this.machine.add(m); }
    this.machine.position.copy(M0);
    this.machine.rotation.y = MYAW;
    this.scene.add(this.machine);
    // 路燈：燈柱、往左伸的燈臂、燈頭（發光）、往下的光錐（加亮）
    const lampMat = mach(4);
    const pole = new THREE.Mesh(new THREE.BoxGeometry(22, LAMP.h, 22), this.bodyMat);
    pole.position.set(LAMP.x + 150, LAMP.h / 2, LAMP.z);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(170, 14, 14), this.bodyMat);
    arm.position.set(LAMP.x + 70, LAMP.h - 10, LAMP.z);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(90, 18, 40), lampMat);
    bulb.position.set(LAMP.x, LAMP.h - 30, LAMP.z);
    const coneMat = mk(ENV_FRAG, { kind: { value: -2 }, canS: { value: new THREE.Vector4() }, ...env });
    coneMat.transparent = true; coneMat.depthWrite = false; coneMat.blending = THREE.CustomBlending;
    coneMat.blendSrc = THREE.OneFactor; coneMat.blendDst = THREE.OneFactor; coneMat.side = THREE.DoubleSide;
    const cg = new THREE.BufferGeometry();
    const ty = LAMP.h - 40;
    cg.setAttribute('position', new THREE.Float32BufferAttribute([LAMP.x - 40, ty, LAMP.z, LAMP.x + 40, ty, LAMP.z, LAMP.x + 520, 0, LAMP.z + 60, LAMP.x - 520, 0, LAMP.z + 60], 3));
    cg.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    cg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    cg.setIndex([0, 1, 2, 0, 2, 3]);
    const cone = new THREE.Mesh(cg, coneMat);
    cone.renderOrder = 6;
    for (const m of [pole, arm, bulb, cone]) { m.frustumCulled = false; this.scene.add(m); }
    // 罐子：軸是 x（CylinderGeometry 的軸是 y，轉過來）
    const g = new THREE.CylinderGeometry(CR, CR, CL, 64, 1, false).rotateZ(-Math.PI / 2);
    this.can = new THREE.Mesh(g, this.canMat);
    this.can.frustumCulled = false;
    this.scene.add(this.can);
  }
}

/**
 * 商品窗裡的一樣商品（底部中心在 (cx, by)）：罐裝＝圓柱（左右暗、中間亮）、上下一圈鋁邊、白標籤上兩行小字；
 * 瓶裝＝瓶身、瓶肩、瓶頸、有顏色的瓶蓋。都是線條＋平塗，被櫃子裡的燈從上面照。
 */
function drawProduct(c: CanvasRenderingContext2D, cx: number, by: number, tall: boolean, col: string) {
  const shade = (x0: number, w: number, a = 1) => {
    const g = c.createLinearGradient(x0, 0, x0 + w, 0);
    g.addColorStop(0, rgba(col, 0.5 * a)); g.addColorStop(0.35, rgba(col, a)); g.addColorStop(1, rgba(col, 0.42 * a));
    return g;
  };
  const metal = (x0: number, w: number) => {
    const g = c.createLinearGradient(x0, 0, x0 + w, 0);
    g.addColorStop(0, rgba('graphite')); g.addColorStop(0.35, rgba('bone')); g.addColorStop(1, rgba('graphite'));
    return g;
  };
  if (!tall) {
    const w = 72, h = 124, x0 = cx - w / 2, top = by - h;
    c.fillStyle = shade(x0, w); c.beginPath(); c.roundRect(x0, top + 6, w, h - 10, 4); c.fill();
    c.fillStyle = metal(x0, w);
    c.beginPath(); c.roundRect(x0 + 3, top, w - 6, 10, 4); c.fill();
    c.beginPath(); c.roundRect(x0 + 4, by - 8, w - 8, 8, 3); c.fill();
    c.fillStyle = rgba('bone', 0.9); c.fillRect(x0 + 6, top + 44, w - 12, 42);
    c.fillStyle = rgba(col, 0.9); c.fillRect(x0 + 6, top + 44, w - 12, 5);
    c.fillStyle = rgba('sepia', 0.55); c.fillRect(x0 + 14, top + 60, w - 28, 4); c.fillRect(x0 + 18, top + 70, w - 36, 3);
  } else {
    const w = 60, h = 160, x0 = cx - w / 2, top = by - h;
    c.fillStyle = shade(x0, w, 0.85);
    c.beginPath();
    c.moveTo(x0, by - 6); c.lineTo(x0, top + 70);
    c.quadraticCurveTo(x0, top + 42, cx - 12, top + 30); c.lineTo(cx - 12, top + 12);
    c.lineTo(cx + 12, top + 12); c.lineTo(cx + 12, top + 30);
    c.quadraticCurveTo(x0 + w, top + 42, x0 + w, top + 70); c.lineTo(x0 + w, by - 6);
    c.quadraticCurveTo(x0 + w, by, x0 + w - 6, by); c.lineTo(x0 + 6, by); c.quadraticCurveTo(x0, by, x0, by - 6);
    c.fill();
    c.fillStyle = rgba('blood'); c.beginPath(); c.roundRect(cx - 14, top, 28, 16, 3); c.fill();
    c.fillStyle = rgba('bone', 0.88); c.fillRect(x0 + 4, top + 84, w - 8, 44);
    c.fillStyle = rgba('sepia', 0.5); c.fillRect(x0 + 12, top + 100, w - 24, 4); c.fillRect(x0 + 16, top + 110, w - 32, 3);
    c.fillStyle = rgba('bone', 0.3); c.fillRect(x0 + 10, top + 46, 5, h - 60);
  }
}

// ---------------------------------------------------------------- 版面
/** LED 上的一個字（點陣座標）：什麼時候打上去。 */
interface LedChar { ch: string; x: number; y: number; t: number }
/** 一隻飛蛾：繞著燈飛的橢圓（世界座標的中心與半徑）、速度、相位、拍翅的快慢。 */
interface Moth { c: THREE.Vector3; rx: number; ry: number; rz: number; sp: number; ph: number; flap: number }

export default class Vending extends Scene {
  rig = shared('vending.rig', () => new Rig());
  /** 全引擎共用的 4x MSAA（畫完同一個 render() 裡就解析到 out，不 track／dispose）。 */
  msaa = sharedMSAA();
  front = this.track(new Layer2D(MW, MH, 0.8, { fast: true }));
  head = this.track(new Layer2D(HEAD.w, HEAD.h, 0.8, { fast: true }));
  /** LED：一個像素一個點（texelFetch 取）。 */
  led = this.track(new Layer2D(DOTW, DOTH, 1, { fast: true }));
  label = this.track(new Layer2D(LAB, CIRC, 2, { fast: true }));
  moths = this.track(new LineBatch(160, { screen2D: true, blend: 'normal' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 97 + (this.msg?.id ?? 0) * 13) >>> 0;
  /** LED 上的字（留言或邀請）；沒有就是 null（歌詞模式：LED 是正在唱的歌詞）。 */
  ledChars: LedChar[] | null = null;
  ledFit: FitResult | null = null;
  /** 署名紙條：什麼時候貼上去、大小（正面座標）。 */
  ledSig: { t: number; w: number; h: number } | null = null;
  /** 署名紙條的貼圖（有留言才建）。 */
  stick: Layer2D | null = null;
  tDrop = 0; tOut = 0; tRest = 0;
  lyrSize = 48;
  headSig = ''; ledKey = '';
  sweeps: number[] = [];
  mothList: Moth[] = [];

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const gr = grid(au, s, e);
    await loadText(`${m?.text ?? ''}${m ? sigOf(m) : ''}${HEADER}${INVITE}${song.title}${song.artist}FROM THE COUPLE · 新人BLESSINGS 24H 祝福 100%♪$0123456789`);
    // 掉罐子：第一個小節線（太近就下一拍），短窗格第一拍
    let td = gr.nBars < 3 ? gr.b0 : gr.bar0;
    if (td - s < 0.5) td += gr.beat;
    this.tDrop = td;
    this.tOut = td + Math.min(0.28, gr.beat * 0.55);
    // 落地在拍點：彈出來之後至少半秒的那一拍
    this.tRest = beatAfter(au, this.tOut + 0.55);
    this.drawFront();
    this.drawLabel();
    const body = m ? m.text : lyrics.has ? null : INVITE;
    if (body) this.layoutLed(body, gr.b0, gr.beat);
    this.lyrSize = lyricV2(m && this.ledFit ? this.ledFit.size * DOT * S_LED : null) / S_LED;
    // 車子從巷口經過（車燈掃過鐵捲門）：大約每兩小節一台，落在小節線
    for (let b = Math.ceil(au.barAt(s) - 1e-6), k = 0; k < 40; b++, k++) {
      const tb = au.timeOfBar(b);
      if (tb > e) break;
      if (hash(this.seed, b, 51) < 0.55) this.sweeps.push(tb);
    }
    // 飛蛾：三隻繞著販賣機頂上的招牌飛（在招牌上緣附近，不擋歌詞與 LED 的字）、三隻繞著右邊的路燈
    const rnd = mulberry32(this.seed);
    const mq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), MYAW);
    for (let k = 0; k < 6; k++) {
      const atLamp = k >= 3;
      const c = atLamp
        ? new THREE.Vector3(LAMP.x + (rnd() - 0.5) * 120, LAMP.h - 80 - 120 * rnd(), LAMP.z + 60)
        : new THREE.Vector3(160 + 560 * rnd(), MH + 25 - (-40 + 50 * rnd()), 90 + 90 * rnd()).applyQuaternion(mq).add(M0);
      // 招牌上的飛蛾只在招牌上緣附近上下飛（不擋到招牌上的歌詞）
      this.mothList.push({ c, rx: 90 + 110 * rnd(), ry: atLamp ? 40 + 60 * rnd() : 25 + 25 * rnd(), rz: 60 * rnd(), sp: 1.3 + 1.6 * rnd(), ph: rnd() * 10, flap: 13 + 6 * rnd() });
    }
  }

  // ---------------------------------------------------------------- LED
  /**
   * 排 LED 上的字（點陣座標）：字級照螢幕的標準（40～60 px，依字數）換成點數，最多五行；署名在最後一行下面（26～32 px）。
   * 每個字在拍點的細分上打上去，兩小節內打完（窗格短就更快）。
   */
  private layoutLed(text: string, b0: number, beat: number) {
    const c = this.led.ctx, m = this.msg;
    const pad = 8;
    const reserve = m ? STICK.reserveDots : 0;
    const bw = DOTW - 2 * pad, bh = DOTH - 2 * pad - reserve;
    const opt = { min: dots(m ? V2.msgMin : 36), max: dots(m ? msgMaxFor(text) : 46), lineHeight: 1.22, maxLines: 5 };
    // 照子句斷行（字級只小一點點也值得：「…這一天，要／一直…」很難讀）；放不下才交給 fitText
    const byWidth = fitText(c, text, FAM_MSG, bw, bh, opt);
    const byClause = fitClauses(c, text, FAM_MSG, bw, bh, opt);
    const fit = byClause && byClause.size >= byWidth.size * 0.9 ? byClause : byWidth;
    this.ledFit = fit;
    const blockH = fit.size + (fit.lines.length - 1) * fit.lineHeight;
    const top = Math.max(pad, (DOTH - reserve - blockH) / 2) + fit.size * 0.88;
    const chars: LedChar[] = [];
    c.font = font(FAM_MSG, fit.size);
    fit.lines.forEach((ln, li) => {
      let x = pad;
      for (const ch of Array.from(ln)) { chars.push({ ch, x, y: top + li * fit.lineHeight, t: 0 }); x += c.measureText(ch).width; }
    });
    const n = chars.length;
    const au = this.ctx.audio, e = this.ctx.end;
    const budget = Math.max(0.6, Math.min(8 * beat, 0.45 * (e - b0)));
    let step = beat / 4;
    for (const k of [2, 4, 8]) { step = beat / k; if ((n - 1) * step <= budget) break; }
    if ((n - 1) * step > budget) step = budget / Math.max(1, n - 1);
    chars.forEach((ch, i) => (ch.t = b0 + i * step));
    this.ledChars = chars;
    if (m) {
      // 署名紙條：手寫字，螢幕上 26～32 px（正面座標要除以 S_LED）；打完留言的下一拍貼上去
      const size = sigV2(fit.size * DOT * S_LED) / S_LED, fam = F.hand(700), sig = sigOf(m);
      const tc = document.createElement('canvas').getContext('2d')!;
      tc.font = font(fam, size);
      const w = Math.ceil(tc.measureText(sig).width + size * 1.1), h = Math.ceil(size * 1.75);
      const S = (this.stick = this.track(new Layer2D(w, h, 1.5, { fast: true })));
      const sc = S.ctx;
      S.clear(rgba('paper'));
      // 紙的邊緣暗一點、上緣一截半透明的膠帶
      const g = sc.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, rgba('sepia', 0.03)); g.addColorStop(1, rgba('sepia', 0.12));
      sc.fillStyle = g; sc.fillRect(0, 0, w, h);
      sc.fillStyle = rgba('bone', 0.55); sc.fillRect(w * 0.3, 0, w * 0.4, size * 0.28);
      sc.textBaseline = 'alphabetic';
      sc.font = font(fam, size); sc.fillStyle = rgba('sepia', 0.92);
      sc.fillText(sig, size * 0.55, h / 2 + size * 0.36);
      S.upload();
      this.ledSig = { t: beatAfter(au, b0 + n * step + 0.05), w, h };
    }
  }

  /** 畫 LED（內容變了才重畫）：留言／邀請一個字一個字打上去；歌詞模式是正在唱的那一行（逐字跟唱）。 */
  private drawLed(t: number) {
    const { lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const L = this.led, c = L.ctx;
    if (this.ledChars) {
      let k = 0;
      for (const ch of this.ledChars) if (t >= ch.t) k++;
      const key = `m${k}`;
      if (key === this.ledKey) return;
      this.ledKey = key;
      L.clear();
      c.textBaseline = 'alphabetic';
      c.font = font(FAM_MSG, this.ledFit!.size);
      // 紅色版 = 訊號色的點；愛心走綠色版（點綴色）
      c.fillStyle = 'rgb(255,0,0)';
      for (let i = 0; i < k; i++) { const ch = this.ledChars[i]!; fillWithHearts(c, ch.ch, ch.x, ch.y, 'rgb(0,255,0)'); }
      L.upload();
      return;
    }
    // 歌詞模式：LED 是正在唱的歌詞（沒唱：暗的訊號色點、正在唱：最亮、唱完：紙白）
    const ly = shownLyric(lyrics, t, s, e);
    const key = ly ? `${ly.line.start}:${ly.live ? t.toFixed(3) : 'idle'}:${ly.k.toFixed(2)}` : 'none';
    if (key === this.ledKey) return;
    this.ledKey = key;
    L.clear();
    if (ly) {
      // 有原文（韓文歌）：中文最多兩行，原文小一號打在正下方（同一塊 LED），整組上下置中
      const sub = lyricSubOf(ly.line);
      const st = { family: FAM_MSG, size: dots(V2.lyrMax), minSize: dots(V2.lyrMin), maxW: DOTW - 16, maxRows: sub ? 2 : 3, align: 'left' as const, lineHeight: 1.18 };
      const lay = layoutRows(c, ly.line, st);
      // 原文照螢幕 px 排，再縮回點數（1 點 = S_LED·DOT 螢幕 px）。唱到、唱完都是暗一點的白（色版的白 = 紙白，灰一點 = 淡一點），
      // 還沒唱的跟中文一樣是暗暗的訊號色點
      const px = S_LED * DOT, ms = lay.size * px;
      const sst: LyricStyle = { family: FAM_MSG, size: ms, maxWidth: (DOTW - 16) * px, align: 'left', unsung: 'rgba(255,0,0,0.3)', sung: 'rgb(200,200,200)' };
      const sLay = sub ? layoutLyric(c, sub, subStyleFor(sst, ms)) : null;
      const sGap = sLay ? subGap(ms, sLay.size) / px : 0;
      const hAll = sLay ? lay.height + sGap + (sLay.height - sLay.size + sLay.size * 0.2) / px : lay.height;
      const y = DOTH / 2 - hAll / 2 + lay.size * 0.84;
      c.save(); c.translate(8, y);
      drawRows(c, lay, FAM_MSG, t, { unsung: 'rgba(255,0,0,0.3)', active: 'rgb(0,0,255)', sung: 'rgb(255,255,255)' }, ly.k);
      c.restore();
      if (sub) {
        c.save(); c.translate(8, y + (lay.rows.length - 1) * lay.lineHeight + sGap); c.scale(1 / px, 1 / px);
        drawLyricSub(c, sub, t, sst, ms, ly.k);
        c.restore();
      }
    }
    L.upload();
  }

  // ---------------------------------------------------------------- 招牌、罐子標籤、販賣機正面
  /** 招牌燈箱：有留言放歌詞（逐字跟唱）；沒有留言時放邀請（LED 是歌詞）；純音樂放歌名。 */
  private drawHead(t: number) {
    const { lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const ly = this.msg ? shownLyric(lyrics, t, s, e) : null;
    const sig = ly ? `${ly.line.start}:${ly.live ? t.toFixed(3) : 'idle'}:${ly.k.toFixed(2)}` : 'static';
    if (sig === this.headSig) return;
    this.headSig = sig;
    const L = this.head, c = L.ctx;
    // 燈箱：亮的紙面、上下兩條訊號色的細邊、左上角小小的「祝福販賣機」
    const g = c.createLinearGradient(0, 0, 0, HEAD.h);
    g.addColorStop(0, rgba('bone', 0.97)); g.addColorStop(1, rgba('paper', 0.9));
    L.clear(); c.fillStyle = g; c.fillRect(0, 0, HEAD.w, HEAD.h);
    c.fillStyle = rgba('signal', 0.9); c.fillRect(0, 0, HEAD.w, 8); c.fillRect(0, HEAD.h - 8, HEAD.w, 8);
    c.textBaseline = 'alphabetic';
    c.font = font(F.hei(700), 26); c.letterSpacing = '8px'; c.fillStyle = rgba('sepia', 0.5);
    c.fillText(`${HEADER}  ·  BLESSINGS 24H`, 26, 44);
    c.letterSpacing = '0px';
    const box = { x: 26, y: 58, w: HEAD.w - 52, h: HEAD.h - 72 };
    if (ly) {
      const st = { family: FAM_LYR, size: this.lyrSize, minSize: V2.lyrMin / S_LED, maxW: box.w, maxRows: 2, align: 'left' as const, lineHeight: 1.06 };
      const lay = layoutRows(c, ly.line, st);
      c.save(); c.translate(box.x, box.y + (box.h - lay.height) / 2 + lay.size * 0.8);
      drawRows(c, lay, FAM_LYR, t, paperInk(), ly.k);
      c.restore();
    } else {
      const txt = this.msg || this.ledChars ? `♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}` : INVITE;
      const ft = fitText(c, txt, F.hei(700), box.w, box.h, { min: 34, max: 50, lineHeight: 1.2, maxLines: 2 });
      c.font = font(F.hei(700), ft.size); c.fillStyle = rgba('sepia', 0.85);
      ft.lines.forEach((ln, i) => c.fillText(ln, box.x, box.y + (box.h - ft.height) / 2 + ft.size * 0.86 + i * ft.lineHeight));
    }
    L.upload();
  }

  /** 罐子的標籤（小道具，不放字級要求的字）：兩端訊號色的色帶、中間一顆愛心與「祝福」。畫一次。 */
  private drawLabel() {
    const L = this.label, c = L.ctx;
    L.clear(rgba('bone'));
    for (const [x, w, col] of [[0, 22, 'signal'], [24, 4, 'blood'], [LAB - 22, 22, 'signal'], [LAB - 28, 4, 'blood']] as const) {
      c.fillStyle = rgba(col, 0.92); c.fillRect(x, 0, w, CIRC);
    }
    const cy = CIRC / 2;
    drawHeart(c, LAB / 2, cy - 30, 54, rgba('rose'));
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.font = font(F.hei(900), 34); c.fillStyle = rgba('sepia');
    c.fillText('祝福', LAB / 2, cy + 30);
    c.font = font(F.mono(500), 11); c.fillStyle = rgba('sepia', 0.6);
    c.fillText('BLESSINGS 24H', LAB / 2, cy + 50);
    c.textAlign = 'left';
    L.upload();
  }

  /** 販賣機正面（畫一次）：商品窗兩層、價格標籤與按鈕、LED 的外框、投幣口、取物口。 */
  private drawFront() {
    const L = this.front, c = L.ctx;
    L.clear(rgba('ink2'));
    c.textBaseline = 'alphabetic';
    // 招牌與 LED 的底座（深色的框）
    c.fillStyle = rgba('ink', 0.95);
    c.fillRect(HEAD.x - 8, HEAD.y - 8, HEAD.w + 16, HEAD.h + 16);
    c.fillRect(LED.x - 10, LED.y - 10, LED.w + 20, LED.h + 20);
    // 商品窗：裡面有燈（上亮下暗），兩層、每層五樣
    const wg = c.createLinearGradient(0, WIN.y, 0, WIN.y + WIN.h);
    wg.addColorStop(0, rgba('bone', 0.9)); wg.addColorStop(1, rgba('ash', 0.55));
    c.fillStyle = wg; c.fillRect(WIN.x, WIN.y, WIN.w, WIN.h);
    const rnd = mulberry32(7);
    const cols = ['signal', 'blood', 'rose', 'graphite', 'sepia', 'ash'] as const;
    for (let r = 0; r < 2; r++) {
      const y0 = WIN.y + 14 + r * 235;
      c.fillStyle = rgba('graphite', 0.7); c.fillRect(WIN.x, y0 + 176, WIN.w, 6);
      for (let k = 0; k < 5; k++) {
        const cx = WIN.x + 80 + k * 160;
        const special = r === 1 && k === 1; // 訊號色那一罐（會被按下去的）
        const tall = rnd() < 0.35 && !special;
        const col = special ? 'signal' : cols[Math.floor(rnd() * cols.length)]!;
        drawProduct(c, cx, y0 + 170, tall, col);
        // 價格標籤＋按鈕
        c.fillStyle = rgba('ink', 0.9); c.fillRect(cx - 56, y0 + 186, 112, 24);
        c.font = font(F.mono(500), 16); c.fillStyle = rgba('signal', 0.85); c.textAlign = 'center';
        c.fillText(`$${[20, 25, 25, 30, 35][Math.floor(rnd() * 5)]}`, cx - 18, y0 + 204);
        c.textAlign = 'left';
        c.fillStyle = rgba('graphite'); c.beginPath(); c.arc(cx + 42, y0 + 196, 10, 0, Math.PI * 2); c.fill();
      }
    }
    // 下面：投幣口、取物口
    c.fillStyle = rgba('graphite', 0.6); c.fillRect(600, 1240, 200, 140);
    c.fillStyle = rgba('ink'); c.fillRect(680, 1262, 36, 64); c.fillRect(650, 1344, 96, 20);
    c.fillStyle = rgba('ink'); c.fillRect(TRAY.x - 10, TRAY.y - 10, TRAY.w + 20, TRAY.h + 20);
    const tg = c.createLinearGradient(0, TRAY.y, 0, TRAY.y + TRAY.h);
    tg.addColorStop(0, rgba('graphite', 0.9)); tg.addColorStop(1, rgba('ink2', 0.9));
    c.fillStyle = tg; c.fillRect(TRAY.x, TRAY.y, TRAY.w, TRAY.h);
    c.font = font(F.mono(500), 16); c.fillStyle = rgba('ash', 0.6); c.letterSpacing = '5px';
    c.fillText('PUSH', TRAY.x + TRAY.w / 2 - 26, TRAY.y + 68);
    c.letterSpacing = '0px';
    L.upload();
  }

  // ---------------------------------------------------------------- 罐子的路徑
  /**
   * 罐子在 t 時的位置與姿勢：從取物口「啵」地彈出來，在空中翻著飛出去（拋物線），落地在拍點，
   * 彈兩下、在地上晃兩下停住——停下來時軸是水平的。
   */
  private canPose(t: number) {
    const mq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), MYAW);
    const exit = new THREE.Vector3(TRAY.x + TRAY.w / 2, MH + 25 - (TRAY.y + TRAY.h / 2), 40).applyQuaternion(mq).add(M0);
    const u = clamp((t - this.tOut) / Math.max(0.2, this.tRest - this.tOut));
    const ex = u * (1.2 - 0.2 * u);
    const p = new THREE.Vector3(lerp(exit.x, REST.x, ex), lerp(exit.y, REST.y, u) + 300 * u * (1 - u), lerp(exit.z, REST.z, ex));
    const d = t - this.tRest;
    if (d > 0) p.y += 36 * Math.abs(Math.sin(d * 8)) * Math.exp(-d * 6);
    const q = new THREE.Quaternion().setFromAxisAngle(TUMBLE, -(1 - ease.outCubic(u)) * 5.4);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.5));
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.1 + (d > 0 ? 0.2 * Math.sin(d * 9) * Math.exp(-d * 3.4) : 0)));
    return { p, q, inside: t < this.tOut };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const rig = this.rig;
    this.drawHead(t);
    this.drawLed(t);
    // ---- 光、按鈕、路燈、車燈、LED 的掃光
    const mq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), MYAW);
    const U = rig.U;
    U.machC.value.set(MW / 2, MH * 0.55, 30).applyQuaternion(mq).add(M0);
    U.machN.value.set(0, 0, 1).applyQuaternion(mq);
    const thunk = pulse(t, this.tOut - 0.05, 0.12);
    U.glow.value = 1 + 0.06 * f.a.kick - 0.08 * thunk;
    // 路燈偶爾閃兩下（接觸不良）：有些拍點暗兩次
    const bi = Math.floor(au.beatAt(t) + 1e-4);
    const tb = au.timeOfBeat(bi);
    let lampK = 1;
    if (hash(this.seed, bi, 61) < 0.12) { const d = t - tb; if ((d > 0 && d < 0.06) || (d > 0.12 && d < 0.16)) lampK = 0.35; }
    U.lampK.value = lampK;
    let swX = 0, swK = 0;
    for (const t0 of this.sweeps) {
      const u = (t - t0) / 1.3;
      if (u < 0 || u > 1) continue;
      swX = lerp(3200, -900, ease.inOutQuad(u)); swK = Math.sin(Math.PI * u);
    }
    (U.sweep.value as THREE.Vector4).set(swX, swK, 0, 0);
    const btn = rig.frontMat.uniforms.btn!.value as number[];
    for (let i = 0; i < 10; i++) btn[i] = 0;
    // 平常：每拍一顆，照順序跑；按下去的那一顆（第二層第二顆）從掉罐子前一拍一直亮著
    if (t < this.tDrop - 0.4) btn[((bi % 10) + 10) % 10] = 0.55 * (1 - (au.beatAt(t) % 1) * 0.6);
    btn[6] = t >= this.tDrop - 0.4 ? 1 : btn[6]!;
    rig.frontMat.uniforms.thunk!.value = thunk;
    rig.frontMat.uniforms.tex!.value = this.front.texture;
    rig.headMat.uniforms.tex!.value = this.head.texture;
    rig.ledMat.uniforms.tex!.value = this.led.texture;
    const sg = this.ledSig;
    rig.sticker.visible = !!(sg && this.stick && t >= sg.t);
    if (sg && this.stick && rig.sticker.visible) {
      const u = prog(t, sg.t, sg.t + 0.14, ease.outCubic), k = 1 + 0.22 * (1 - u);
      rig.stickMat.uniforms.tex!.value = this.stick.texture;
      rig.sticker.scale.set(sg.w * k, sg.h * k, 1);
      rig.sticker.rotation.z = -STICK.rot - 0.08 * (1 - u);
      rig.sticker.position.set(STICK.x1 - sg.w / 2, MH + 25 - STICK.cy, 5 + 30 * (1 - u));
    }
    rig.canMat.uniforms.lab!.value = this.label.texture;
    // LED 的掃光：留言打完之後，每個小節線一道光從左掃到右
    const bar = au.timeOfBar(Math.floor(au.barAt(t) + 1e-4));
    const doneT = this.ledSig ? this.ledSig.t : this.ledChars ? this.ledChars[this.ledChars.length - 1]!.t : Infinity;
    const su = (t - bar) / 0.7;
    (rig.ledMat.uniforms.ledSweep!.value as THREE.Vector2).set(-0.2 + 1.4 * su, bar >= doneT && su >= 0 && su <= 1 ? Math.sin(Math.PI * su) : 0);
    // 水窪的漣漪：屋簷與冷氣機滴水，有些拍點滴一滴（每個水窪各自的節奏；冷氣機下面那個每兩拍一滴，看得到水滴掉下來）
    const rips = rig.groundMat.uniforms.rip!.value as THREE.Vector4[];
    const drips = (i: number, b: number) => (i === 0 ? ((b % 2) + 2) % 2 === 0 : hash(this.seed, b, i, 71) < 0.4);
    PUDDLES.forEach(([x, z, r], i) => {
      let age = -1;
      for (let k = 0; k < 4; k++) {
        const b = bi - k;
        if (drips(i, b)) { const tt = au.timeOfBeat(b); if (t >= tt) { age = t - tt; break; } }
      }
      rips[i]!.set(x, z, r, age);
    });
    // 冷氣機的水滴：在落地（拍點）前 DRIP_FALL 秒從冷氣機底下掉下來
    rig.drip.value.set(AC.dripX, -1000, 0);
    for (const b of [bi + 1, bi + 2]) {
      if (!drips(0, b)) continue;
      const u = (t - (au.timeOfBeat(b) - DRIP_FALL)) / DRIP_FALL;
      if (u >= 0 && u <= 1) rig.drip.value.set(AC.dripX, AC.y0 - 10 - (AC.y0 - 10) * u * u, 1);
    }
    rig.envT.value = t;
    // 霓虹燈管：大部分時間亮著，有些小節線閃兩下
    const bb = Math.floor(au.barAt(t) + 1e-4), dt = t - au.timeOfBar(bb);
    const blink = hash(this.seed, bb, 81) < 0.3 && ((dt > 0.02 && dt < 0.09) || (dt > 0.16 && dt < 0.22));
    rig.neon.value = 0.85 + 0.15 * f.a.kick - (blink ? 0.7 : 0);
    // ---- 罐子
    const cp = this.canPose(t);
    rig.can.visible = !cp.inside;
    rig.can.position.copy(cp.p);
    rig.can.quaternion.copy(cp.q);
    (rig.groundMat.uniforms.canS!.value as THREE.Vector4).set(cp.p.x, cp.p.z, -0.5, cp.inside ? 0 : clamp(1 - (cp.p.y - CR) / 200));
    // ---- 鏡頭：從遠一點、偏右的地方慢慢推近；掉罐子那一下機器震一下
    const cam = rig.cam;
    const k = ease.inOutQuad(clamp((t - s) / Math.max(1, e - s)));
    const land = ease.outCubic(prog(t, s, s + 1.2));
    const sh = thunk * 4 * Math.sin(t * 90);
    cam.position.set(lerp(PA.pos[0], PB.pos[0], k) + 60 * (1 - land), lerp(PA.pos[1], PB.pos[1], k) + sh, lerp(PA.pos[2], PB.pos[2], k) + 120 * (1 - land));
    cam.lookAt(lerp(PA.look[0], PB.look[0], k), lerp(PA.look[1], PB.look[1], k), lerp(PA.look[2], PB.look[2], k));
    cam.updateMatrixWorld();
    U.camPos.value.copy(cam.position);

    const rt = this.msaa;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
    renderer.render(rig.scene, cam);
    comp.draw(renderer, rt.texture, out, { mode: 'replace', premult: false });
    this.drawMoths(t, cam, out);
    const exit = prog(t, e - 0.35, e, ease.inCubic);
    return { bloom: 0.55, vignette: 0.62, halation: 0.28, zoom: 1 + 0.003 * f.a.kick + 0.015 * exit };
  }

  /**
   * 飛蛾（螢幕上翅展約 26～40 px）：兩對翅膀（前翅長、後翅短）一拍一拍地開合、身體、兩根觸角。
   * 被燈照著：淺淺的米色，壓在亮的招牌前面時看得出是深一點的剪影。大鼓時第一隻往燈撞一下。
   */
  private drawMoths(t: number, cam: THREE.PerspectiveCamera, out: THREE.WebGLRenderTarget) {
    const lb = this.moths; lb.clear();
    const v = new THREE.Vector3(), v2 = new THREE.Vector3();
    const kick = this.ctx.audio.hit('kick', t, 0.18);
    const wing: [number, number, number] = [LIN.bone[0] * 0.55 + LIN.ash[0] * 0.25, LIN.bone[1] * 0.55 + LIN.ash[1] * 0.25, LIN.bone[2] * 0.55 + LIN.ash[2] * 0.25];
    const body: [number, number, number] = [LIN.graphite[0] * 0.8, LIN.graphite[1] * 0.8, LIN.graphite[2] * 0.8];
    this.mothList.forEach((m, i) => {
      const a = t * m.sp + m.ph;
      const bump = i === 0 ? kick * 50 : 0;
      v.set(m.c.x + Math.cos(a) * m.rx + 20 * Math.sin(a * 2.7 + i), m.c.y + Math.sin(a * 1.3) * m.ry + 12 * Math.cos(a * 3.1), m.c.z + Math.sin(a) * m.rz + bump);
      // 翅展約 50 世界單位（比真的飛蛾大一點：遠遠看才認得出是飛蛾，不是雜點）
      v2.copy(v).x += 50;
      v.project(cam); v2.project(cam);
      const x = (v.x * 0.5 + 0.5) * W, y = (0.5 - v.y * 0.5) * H;
      // 翅展（px）：跟著遠近縮放
      const span = Math.max(26, Math.abs((v2.x - v.x) * 0.5 * W));
      // 拍翅：開合（0 = 翅膀收起、1 = 張開），每秒十幾下；飛的方向決定身體的角度
      const open = 0.35 + 0.65 * Math.abs(Math.sin(t * m.flap + i));
      const dir = Math.atan2(Math.cos(a * 1.3) * m.ry * 1.3, -Math.sin(a) * m.rx) * 0.25;
      const cs = Math.cos(dir), sn = Math.sin(dir);
      const P = (dx: number, dy: number) => ({ x: x + dx * cs - dy * sn, y: y + dx * sn + dy * cs });
      const s = span / 2;
      for (const side of [-1, 1]) {
        // 前翅：從肩膀往外上方，根部寬、尖端窄
        const fa = P(side * s * 0.15, -s * 0.12), fb = P(side * s * (0.25 + 0.75 * open), -s * (0.1 + 0.3 * open)), fm = P(side * s * (0.2 + 0.4 * open), -s * (0.1 + 0.2 * open));
        lb.seg2(fa.x, fa.y, fm.x, fm.y, s * 0.55, wing, 0.95);
        lb.seg2(fm.x, fm.y, fb.x, fb.y, s * 0.32, wing, 0.95);
        // 後翅：短一點、往外下方
        const ha = P(side * s * 0.1, s * 0.12), hb = P(side * s * (0.2 + 0.45 * open), s * (0.25 + 0.1 * open));
        lb.seg2(ha.x, ha.y, hb.x, hb.y, s * 0.38, wing, 0.9);
        // 觸角
        const aa = P(side * s * 0.05, -s * 0.42), ab = P(side * s * 0.28, -s * 0.8);
        lb.seg2(aa.x, aa.y, ab.x, ab.y, 1.1, body, 0.9);
      }
      const b0 = P(0, -s * 0.45), b1 = P(0, s * 0.5);
      lb.seg2(b0.x, b0.y, b1.x, b1.y, Math.max(2.4, s * 0.2), body, 1);
    });
    lb.render(this.ctx.renderer, out);
  }
}
