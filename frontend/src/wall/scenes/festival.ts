// 廟會燈籠（暗）：廟口的夜。右邊是一座廟的三川殿（中間高、兩側低的燕尾脊，屋脊上雙龍護塔，屋簷與屋脊掛滿小燈泡，
// 中門開著透出暖光、側門是一排排門釘），廟埕上正對中門一座天公爐，插滿了香、冒著煙；
// 左邊一串串燈籠從畫面外拉到廟前的燈篙上，下面是夜市攤位的燈箱招牌。
//  - 主打留言寫在燈籠上：一個燈籠一個字（英文一個字一個燈籠，燈籠跟著字變寬），像廟會「國泰民安」那樣一串一串掛著，
//    斷行照子句（逗號、句號變成燈籠之間的空隙）。燈籠一開始是暗的，從第一拍起照拍子一個一個點亮
//    （亮起來那一下閃一下，之後像燭火微微跳）；署名寫在最後一串下面。
//  - 歌詞在攤位的燈箱招牌上（逐字跟唱，比燈籠上的字小一級）。
//  - 沒有留言：燈籠上是正在唱的歌詞（唱到哪個字、那個燈籠就亮），招牌放邀請；純音樂又沒有留言：燈籠寫「新婚快樂　百年好合」。
// v2（「留言尺寸與版面比例標準 v2」）：燈籠上的字照標準（40～60 px，依字數），燈籠串縮在左上 860×430 以內；
// 空出來的右邊給廟與天公爐當主視覺，而且照拍子一直有事：
//  - 每一拍：屋簷、屋脊的小燈泡往前跑一格（廟會的跑馬燈）；大鼓一打，燈籠整串晃一下、香頭亮一下；
//  - 每個小節線颳一陣風：燈籠由左到右一波晃起來，燈篙的旗子翻起來，香煙跟著往一邊倒；
//  - 單數小節天公爐「轟」地冒出一把金紙的火星往上飄；雙數小節一道光由左到右掃過燈籠，廟上的燈泡全部亮一下；
//  - 最上面一排很近、失焦的大燈籠跟著風擺（前景），遠處的燈是散景；鏡頭切進來時往下看，第一個小節線前仰起來，之後慢慢推近。
// 手法：Canvas2D 的「燈籠精靈圖」——每個燈籠（含字、暗的與亮的兩張）在 init() 畫進一張圖集，每格只 drawImage（轉一點角度）；
// 光暈畫在半解析度的加亮層。夜空、廟（距離場畫的剪影＋輪廓光）、門光、燈泡、天公爐、香煙、散景是全螢幕 shader；
// 香腳與香頭、廟前的一對大燈籠畫在 Canvas（跟廟同一層視差）；火星是 LineBatch。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba, LIN } from '../engine/palette';
import { clamp, ease, prog, hash, noise1, pulse } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { Lyrics, type Line, type Word } from '../engine/lyrics';
import { drawHeart, lyricSubOf, drawLyricSub, subSizeFor, type LyricStyle } from './_motifs';
import { grid, stagger, layoutRows, drawRows, paperInk, darkInk } from './_t4';
import { INVITE } from './_t14';
import { shownLyric, sigOf, type Rect } from './_t24';
import { V2, msgMaxFor, lyricV2, sigV2, fitClauses } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'local', paper: false, energy: [0.3, 1], bars: [4, 8], weight: 1 };

const FAM = F.hand(700), FAM_SIG = F.hand(400);
const FAM_LYR = F.archivo(100, 800);
/** 燈籠串（留言或歌詞）的範圍：畫面左上（v2：寬 ≤ 860、高 ≤ 430），右邊留給廟。 */
const AREA = { x: 150, y: 128, w: 860, h: 430 };
/** 攤位的燈箱招牌（歌詞）。 */
const SIGN = { x: 150, y: 838, w: 860, h: 80 };
/** 廟的中線；天公爐的爐口（香插在這裡）。 */
const TEMPLE_X = 1480;
const RIM_Y = 690;
/** 燈籠串的右端綁在廟前的一根燈篙（高高的竹竿）上。 */
const POLE = { x: 1046 };
/** 廟跟天空同一層視差（深度 0.35）：香、廟前的大燈籠畫在 Canvas 時用同一個深度，才會黏在廟上。 */
const D_TEMPLE = 0.35;
const FALLBACK = '新婚快樂，百年好合';
/** 燈籠的比例（相對排版字級 s）：寬、高、間距、一串的高度；燈籠上的中文字約 CH·s。 */
const LW = 1.22, LH = 1.42, PITCH = 1.34, ROWH = 2.2, CH = 0.927;
/** 排版時一個字實際佔的寬（相對 s）：中文字的燈籠是「字寬 + 0.42 s」再加間距，比 PITCH 寬；用它找字級，整串才不會超出 AREA。 */
const PITCH_FIT = 1.56;
const PUNCT = /^[，。、,.．；;：:]+$/;
const NSPARK = 44;
/** 天公爐裡插的香：爐口上的位置、傾斜、長短（整晚固定）。 */
const STICKS = Array.from({ length: 34 }, (_, i) => {
  const x = (hash(i, 1) - 0.5) * 176;
  return { x, lean: (hash(i, 2) - 0.5) * 0.22 + x / 900, len: 62 + 46 * hash(i, 3), ph: hash(i, 4) * 10 };
});

const SKY = () => new FSPass(/* glsl */ `
  uniform float t; uniform vec2 cam; uniform float zoom; uniform float beat; uniform float wind; uniform float puff; uniform float wave;
  const float TX = ${TEMPLE_X}.0;
  // 遠處失焦的燈（散景）：一顆顆軟軟的圓，暖色
  float bokeh(vec2 p, float cell, float seed, float r) {
    vec2 g = floor(p / cell), f = p - g * cell;
    float acc = 0.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 id = g + vec2(float(i), float(j));
      float h = hash12(id + seed);
      if (h < 0.55) continue;
      vec2 c = (vec2(float(i), float(j)) + 0.2 + 0.6 * hash22(id + seed * 3.1)) * cell;
      float d = length(f - c);
      acc += (0.5 + 0.5 * hash12(id + 7.0)) * (1.0 - smoothstep(r * 0.82, r, d)) * (0.75 + 0.25 * smoothstep(r * 0.4, r * 0.95, d));
    }
    return acc;
  }
  // 覆蓋率：d = 到邊緣的距離（px，正的在裡面），邊緣一個像素寬的抗鋸齒
  float cv(float d) { return sat(d + 0.5); }
  vec3 warm() { return mix(C_BLOOD, C_SIGNAL, 0.45); }
  // 屋脊的上緣：中間低、往兩端微微翹，最後一段（燕尾）往上甩
  float ridgeTop(float dx, float hw, float R, float lift) {
    float u = dx / hw;
    return R - 6.0 * u * u - lift * pow(max(0.0, (u - 0.72) / 0.38), 2.4);
  }
  // 簷口：兩端（簷角）往上翹
  float eaveY(float dx, float hw, float E) {
    float u = dx / hw;
    return E + 5.0 * u * u - 20.0 * pow(max(0.0, (u - 0.8) / 0.22), 2.0);
  }
  // 一段屋頂：x = 屋面覆蓋、y = 屋脊（含燕尾）覆蓋、z = 在屋面上的位置（0 脊 .. 1 簷）、w = 到屋脊上緣的距離
  vec4 roof(vec2 q, float hw, float R, float th, float E, float lift, float tail) {
    float dx = abs(q.x - TX), u = dx / hw;
    float top = ridgeTop(dx, hw, R, lift);
    float sl = ridgeTop(dx + 1.0, hw, R, lift) - top;
    float nrm = inversesqrt(1.0 + sl * sl);
    float thk = th * mix(1.0, 0.55, sat((u - 0.8) / 0.3));
    float dTop = (q.y - top) * nrm;
    float dR = min(min(dTop, (top + thk - q.y) * nrm), (tail - u) * hw);
    // 燕尾的尾端分岔：最後一小段中間開一道縫
    float fork = sat((u - tail + 0.09) / 0.02);
    dR = min(dR, mix(dR, abs(q.y - top - thk * 0.5) * nrm - thk * 0.13, fork));
    // 屋面：屋脊下緣（不跟著燕尾翹，燕尾是懸空的）到簷口
    float y0 = R - 6.0 * u * u + thk - 1.0;
    float yk = sat((q.y - y0) / max(1.0, eaveY(dx, hw, E) - y0));
    float dS = min(min(q.y - y0, eaveY(dx, hw, E) - q.y), hw * mix(0.94, 1.02, yk) - dx);
    return vec4(cv(dS), cv(dR), yk, dTop);
  }
  vec3 roofShade(vec4 r, vec2 q) {
    // 筒瓦：一條條直的瓦溝（很淡）；越靠近簷口越暖（簷下的燈泡往上照），簷口一排瓦當
    float groove = 1.0 - smoothstep(0.5, 1.5, abs(mod(q.x - TX + 7.0, 14.0) - 7.0));
    vec3 c = (C_INK * 0.5 + C_INK2 * 0.2) * (1.0 - 0.2 * groove);
    return c + warm() * (0.05 * smoothstep(0.5, 1.0, r.z) + 0.1 * smoothstep(0.9, 1.0, r.z) * (1.0 - groove));
  }
  vec3 ridgeShade(vec4 r, vec2 q) {
    vec3 c = C_INK * 0.4 + C_INK2 * 0.15;
    // 上緣一道暖色的輪廓光（廟會的燈從後面照）
    return c + warm() * 0.45 * exp(-max(r.w, 0.0) / 1.8);
  }
  // 一顆小燈泡：跑馬燈，每一拍往前一格、三顆一組亮一顆；雙數小節的那一下全亮
  float bulbAt(vec2 q, vec2 b, float k) {
    float d = length(q - b);
    float on = 0.28 + 0.72 * max(step(abs(mod(k - floor(beat), 3.0)), 0.5), wave);
    return on * ((1.0 - smoothstep(1.8, 3.2, d)) + 0.22 * exp(-d * d / 50.0));
  }
  float eaveBulbs(vec2 q, float hw, float E, float sp) {
    float k = floor((q.x - TX) / sp + 0.5);
    float bx = TX + k * sp, dx = abs(bx - TX);
    return dx > hw * 0.99 ? 0.0 : bulbAt(q, vec2(bx, eaveY(dx, hw, E) + 6.0), k);
  }
  float ridgeBulbs(vec2 q, float hw, float R, float lift, float tail, float sp) {
    float k = floor((q.x - TX) / sp + 0.5);
    float bx = TX + k * sp, dx = abs(bx - TX);
    return dx > hw * (tail - 0.04) ? 0.0 : bulbAt(q, vec2(bx, ridgeTop(dx, hw, R, lift) - 4.0), k);
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y); // y 向下
    // 視差：天空與廟最遠（移得最少）
    vec2 q = (p - vec2(960.0, 540.0)) / (1.0 + (zoom - 1.0) * ${D_TEMPLE}) + vec2(960.0, 540.0) - vec2(0.0, cam.y * ${D_TEMPLE});
    float y = q.y / 1080.0;
    vec3 W = warm();
    vec3 col = mix(C_INK * 0.9, C_INK2 * 1.4 + C_BLOOD * 0.06, smoothstep(0.1, 1.0, y));
    col += mix(C_BLOOD, C_SIGNAL, 0.35) * 0.08 * smoothstep(0.45, 1.05, y);
    // 廟會的燈光把廟後面的夜空照亮一片（廟的剪影才出得來）
    col += mix(C_BLOOD, C_SIGNAL, 0.4) * 0.13 * exp(-pow((q.y - 420.0) / 240.0, 2.0) - pow((q.x - TX) / 560.0, 2.0));
    // 散景：兩層，遠的小、近的大（視差比較多）
    vec2 b1 = (p - vec2(960.0, 540.0)) / (1.0 + (zoom - 1.0) * 0.5) + vec2(960.0, 540.0) - vec2(t * 4.0, cam.y * 0.5);
    vec2 b2 = (p - vec2(960.0, 540.0)) / (1.0 + (zoom - 1.0) * 0.8) + vec2(960.0, 540.0) - vec2(t * 9.0, cam.y * 0.8);
    col += mix(C_BLOOD, C_SIGNAL, 0.6) * (0.05 * bokeh(b1, 120.0, 3.0, 16.0) * smoothstep(250.0, 700.0, p.y) + 0.03 * bokeh(b2, 240.0, 11.0, 34.0) * smoothstep(300.0, 800.0, p.y));

    // ---- 廟（三川殿的正面）
    float dx = abs(q.x - TX);
    // 屋身：中間高、兩側低，前面一片門面（屋頂蓋在上面）
    float mass = max(max(cv(184.0 - dx) * cv(q.y - 452.0), cv(370.0 - dx) * cv(q.y - 510.0)), cv(398.0 - dx) * cv(q.y - 574.0)) * cv(800.0 - q.y);
    vec3 tc = C_INK * 0.62 + C_INK2 * 0.15;
    // 上層的格窗：裡面點著燈，一根根木條、中間一道橫檔
    float lat = cv(168.0 - dx) * cv(q.y - 486.0) * cv(532.0 - q.y);
    float slat = smoothstep(1.0, 2.2, abs(mod(q.x - TX + 5.0, 10.0) - 5.0)) * smoothstep(1.0, 2.0, abs(q.y - 509.0));
    tc += W * 0.2 * lat * slat;
    // 簷下的斗栱：一排小方塊，下緣被燈照亮
    float brk = cv(398.0 - dx) * cv(q.y - 578.0) * cv(600.0 - q.y);
    tc = mix(tc, C_INK * 0.42, brk);
    tc += W * 0.12 * brk * step(abs(mod(q.x - TX + 16.0, 32.0) - 16.0), 10.0) * smoothstep(588.0, 600.0, q.y);
    // 柱子：四根石柱，靠中門那一邊被門光照亮
    float pdx = dx < 253.0 ? 150.0 : 356.0;
    float pil = cv(12.0 - abs(dx - pdx)) * cv(q.y - 600.0) * cv(800.0 - q.y);
    tc = mix(tc, C_INK * 0.48, pil);
    tc += W * 0.35 * pil * exp(-abs(dx - pdx + 12.0) / 2.5);
    // 匾額：中門上一塊深色木匾、金邊
    float pq = sdBox(vec2(dx, q.y - 614.0), vec2(96.0, 14.0));
    tc = mix(tc, mix(C_BLOOD, C_INK, 0.62), cv(-pq));
    tc += mix(C_SIGNAL, C_EMBER, 0.2) * 0.4 * (1.0 - smoothstep(0.0, 1.4, abs(pq + 2.5)));
    // 中門：開著，裡面暖暖的燈（上面一盞天公燈），燭光微微跳；最下面一道高高的門檻
    float fl = 0.93 + 0.07 * sin(t * 3.1) * sin(t * 1.7 + 1.0);
    float door = cv(100.0 - dx) * cv(q.y - 638.0) * cv(800.0 - q.y);
    vec3 dcol = W * (0.22 + 0.55 * exp(-pow((q.y - 650.0) / 55.0, 2.0) - pow(dx / 85.0, 2.0))) * fl;
    // 兩扇門板往裡開：左右兩條暗面（越往外越亮一點，是門板的正面）
    dcol = mix(dcol, mix(C_BLOOD, C_INK, 0.78) * (0.8 + 0.5 * sat((dx - 76.0) / 24.0)), smoothstep(72.0, 76.0, dx));
    dcol += mix(C_SIGNAL, C_EMBER, 0.5) * 1.2 * exp(-(dx * dx + pow(q.y - 652.0, 2.0)) / 40.0) * fl;
    dcol = mix(dcol, C_INK * 0.45, cv(q.y - 782.0));
    tc = mix(tc, dcol, door);
    // 側門：關著，朱紅的門板（很暗）、一排排門釘被燈照到一點、兩扇門中間一道縫
    float sx = abs(dx - 252.0);
    float sdoor = cv(46.0 - sx) * cv(q.y - 662.0) * cv(800.0 - q.y);
    vec3 scol = mix(C_BLOOD, C_INK, 0.8) * (0.85 + 0.15 * sat((q.y - 662.0) / 138.0));
    vec2 sg = vec2(mod(sx + 6.0, 12.0) - 6.0, mod(q.y - 672.0, 20.0) - 10.0);
    float stud = cv(3.0 - length(sg)) * step(6.0, sx) * step(sx, 42.0) * step(672.0, q.y) * step(q.y, 782.0);
    scol += W * 0.25 * stud * (0.6 + 0.4 * sat(0.5 - sg.y / 3.0));
    scol *= 1.0 - 0.5 * (1.0 - smoothstep(0.5, 1.5, sx));
    tc = mix(tc, scol, sdoor);
    col = mix(col, tc, mass);
    // 台基與台階：中間三階，每一階上緣一條光
    float plat = cv(440.0 - dx) * cv(q.y - 800.0) * cv(828.0 - q.y);
    float edge = exp(-abs(q.y - 800.5) / 1.2) + step(dx, 150.0) * (exp(-abs(q.y - 809.5) / 1.2) + exp(-abs(q.y - 818.5) / 1.2));
    col = mix(col, C_INK * 0.7 + C_INK2 * 0.2 + W * (0.12 * edge + 0.06 * exp(-dx / 120.0)), plat);
    // 屋頂：兩側（後面、低）→ 中間（高）→ 步口簷（最前面、最寬）
    vec4 rs = roof(q, 380.0, 450.0, 15.0, 522.0, 86.0, 1.1);
    col = mix(col, roofShade(rs, q), rs.x); col = mix(col, ridgeShade(rs, q), rs.y);
    vec4 rc = roof(q, 196.0, 380.0, 20.0, 470.0, 72.0, 1.12);
    col = mix(col, roofShade(rc, q), rc.x); col = mix(col, ridgeShade(rc, q), rc.y);
    vec4 rl = roof(q, 410.0, 540.0, 8.0, 580.0, 0.0, 1.0);
    col = mix(col, roofShade(rl, q), rl.x); col = mix(col, ridgeShade(rl, q), rl.y);
    // 中脊上的雙龍護塔（剪影，邊緣一圈暖光）
    float rt = ridgeTop(dx, 196.0, 380.0, 72.0);
    float pag = min(min(sdBox(vec2(dx, q.y - 375.0), vec2(15.0, 6.0)), sdCircle(vec2(dx, q.y - 359.0), 11.0)),
                    min(sdCircle(vec2(dx, q.y - 342.0), 7.0), sdBox(vec2(dx, q.y - 330.0), vec2(1.5, 8.0))));
    float du = (dx - 34.0) / 118.0;
    float body = abs(q.y - (rt - 11.0 - 9.0 * sin(du * 9.0))) - mix(6.5, 1.5, sat(du));
    body = max(body, max(-du, du - 1.0) * 118.0);
    float orn = min(pag, min(body, sdCircle(vec2(dx - 31.0, q.y - (rt - 20.0)), 8.5)));
    col = mix(col, C_INK * 0.4 + C_INK2 * 0.15 + W * 0.35 * (1.0 - smoothstep(0.0, 2.0, -orn)), cv(-orn));
    // 廟埕的地：門光灑在地上一點（很淡）；右下角 HUD 那一塊保持乾淨
    float gnd = cv(q.y - 828.0);
    col = mix(col, C_INK * 0.55 + C_INK2 * 0.1, gnd);
    col += W * 0.07 * gnd * exp(-pow(dx / 170.0, 2.0)) * exp(-(q.y - 828.0) / 30.0);

    // ---- 天公爐：正對中門一座三腳的銅爐（兩隻立耳），背著門光是剪影，邊緣一圈暖光
    float by = q.y;
    float belly = max((length(vec2(dx / 104.0, (by - 752.0) / 54.0)) - 1.0) * 54.0, 707.0 - by);
    float neck = sdBox(vec2(dx, by - 707.0), vec2(90.0, 7.0));
    float lip = sdBox(vec2(dx, by - 696.0), vec2(114.0, 5.0)) - 2.0;
    vec2 eq = vec2(dx - 100.0 - (700.0 - by) * 0.2, by - 678.0);
    float ear = max(sdBox(eq, vec2(11.0, 20.0)) - 2.0, -sdBox(eq - vec2(0.0, -3.0), vec2(4.5, 11.0)));
    float legs = min(sdBox(vec2(dx, by - 808.0), vec2(9.0, 18.0)), sdBox(vec2(dx - 74.0 - (by - 792.0) * 0.3, by - 806.0), vec2(9.0, 16.0)));
    float feet = min(length(vec2(dx / 16.0, (by - 823.0) / 5.0)), length(vec2((dx - 84.0) / 15.0, (by - 821.0) / 5.0))) * 5.0 - 5.0;
    float bd = min(min(min(belly, neck), min(lip, ear)), min(legs, feet));
    float burner = cv(-bd);
    vec3 bc = C_INK * 0.4 + C_INK2 * 0.12;
    // 銅：左邊被攤位與燈籠照到一點、肚子上一道凸起的紋帶、邊緣一圈暖光（背後是門光的地方更亮）；冒火星那一下整個亮一點
    bc += mix(C_SIGNAL, C_BLOOD, 0.5) * 0.07 * sat((TX - q.x) / 110.0 + 0.3);
    bc += W * 0.1 * cv(2.5 - abs(by - 731.0)) * step(belly, 0.0);
    bc += W * (0.14 + 0.45 * door) * (1.0 - smoothstep(0.0, 2.5, -bd));
    bc += W * 0.1 * puff;
    col = mix(col, bc, burner);
    // 爐裡燒著的香與金紙：爐口上一團暖光（火星冒出來那一下更亮）
    col += mix(C_SIGNAL, C_EMBER, 0.5) * (0.12 + 0.7 * puff) * exp(-pow(dx / 105.0, 2.0) - pow((by - 686.0) / 12.0, 2.0)) * (1.0 - burner * 0.7);
    // ---- 香煙：從香頭往上飄，越高越散；風一吹就往右倒；背著門光是暖灰
    float hgt = 640.0 - by;
    if (hgt > -30.0 && hgt < 640.0) {
      float hh = max(hgt, 0.0);
      float lean = (0.1 + 0.35 * wind) * hh + 16.0 * sin(hgt / 90.0 - t * 0.9);
      float core = exp(-pow((q.x - TX - lean) / (50.0 + hh * 0.3), 2.0));
      float n = fbm(vec2((q.x - lean) / 70.0, by / 110.0 + t * 0.55), 4);
      float dens = core * smoothstep(-30.0, 50.0, hgt) * (1.0 - smoothstep(220.0, 640.0, hgt)) * sat(0.35 + 0.9 * n);
      col = mix(col, mix(C_ASH, C_SIGNAL, 0.25) * 0.42, 0.5 * dens);
    }
    // ---- 小燈泡：步口簷、中港的簷口與屋脊（沿著燕尾勾出輪廓）、兩側的簷口（會發光）
    float bl = eaveBulbs(q, 410.0, 580.0, 24.0) + eaveBulbs(q, 196.0, 470.0, 22.0) + ridgeBulbs(q, 196.0, 380.0, 72.0, 1.12, 20.0)
             + (eaveBulbs(q, 380.0, 522.0, 24.0) + ridgeBulbs(q, 380.0, 450.0, 86.0, 1.1, 24.0)) * step(206.0, dx);
    col += mix(C_SIGNAL, C_EMBER, 0.4) * 1.6 * bl;
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 }, cam: { value: new THREE.Vector2() }, zoom: { value: 1 }, beat: { value: 0 }, wind: { value: 0 }, puff: { value: 0 }, wave: { value: 0 } });

/** 一個燈籠：字（或 null）、在圖集裡的兩張（暗、亮）、掛的位置、大小、亮起來的時間。 */
interface Lantern {
  text: string;
  small: boolean;
  /** 掛點（燈籠頂的繩子接在電線上的地方）。 */
  x: number; y: number;
  w: number; h: number;
  /** 圖集裡的位置（暗的一張，亮的在右邊 sw 處）。 */
  sx: number; sy: number; sw: number; sh: number;
  /** 亮起來的時間（歌詞：那個字開始唱）；word：歌詞的字（跟唱用）。 */
  t0: number;
  word?: Word;
  seed: number;
}

/** 一串電線：左端在畫面外、右端綁在燈篙上（稍微往上拉的懸鏈線）。 */
interface Wire { y: number }
interface LSet {
  lanterns: Lantern[];
  wires: Wire[];
  /** 燈籠上的字在螢幕上的大小（px）。 */
  char: number;
  sig?: { text: string; x: number; y: number; size: number };
}

/** 電線在 x 的高度：左端（x = -200）在 y，右端綁在燈篙上（高一點點），中間往下垂。 */
function wireY(w: Wire, x: number) {
  const x0 = -200, x1 = POLE.x, u = clamp((x - x0) / (x1 - x0));
  return w.y - 12 * u + 34 * 4 * u * (1 - u);
}

export default class Festival extends Scene {
  sky = shared('festival.sky', SKY);
  main = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  sparks = this.track(new LineBatch(NSPARK * 4 + 8, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 71 + (this.msg?.id ?? 0) * 29) >>> 0;
  atlas: HTMLCanvasElement = document.createElement('canvas');
  fg: HTMLCanvasElement = document.createElement('canvas');
  /** 廟前的一對大燈籠（沒有字，亮的）。 */
  temLantern: HTMLCanvasElement = document.createElement('canvas');
  /** 有留言（或純音樂的固定字）：一組燈籠；沒有留言：每句歌詞一組。 */
  msgSet: LSet | null = null;
  lineSets = new Map<Line, LSet>();
  avoid: Rect[] = [];
  camK0 = 0;
  /** 風（小節線）、火星（單數小節）、掃過燈籠的一道光（雙數小節）的時間。 */
  gusts: number[] = [];
  bursts: number[] = [];
  waves: number[] = [];
  lyrSize: number = V2.lyrMax;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const gr = grid(au, s, e);
    this.camK0 = gr.bar0;
    this.gusts = gr.bars.length ? gr.bars : [gr.b0];
    this.bursts = this.gusts.filter((_, i) => i % 2 === 0);
    this.waves = this.gusts.filter((_, i) => i % 2 === 1);
    const lines = m ? [] : lyrics.linesIn(s - 4, e).filter((l) => l.end > s - 1.5);
    await loadText(`${m?.text ?? ''}${m ? sigOf(m) : ''}${FALLBACK}${INVITE}${lines.map((l) => l.text).join('')}${song.title}${song.artist}古早味♪·FROM THE COUPLE · 新人`);
    const c = this.main.ctx;
    if (m || !lines.length) {
      const text = m ? m.text : FALLBACK;
      // v2：燈籠上的字（螢幕 px）40～依字數的上限；沒有留言時燈籠寫的是固定字，當歌詞看（≤ 52）
      const set = this.layoutText(c, text, m ? 5 : 2, m ? msgMaxFor(text) : V2.lyrMax, undefined, !!m);
      if (m) {
        const last = set.lanterns[set.lanterns.length - 1]!;
        const sz = sigV2(set.char);
        c.font = font(FAM_SIG, sz);
        const sw = c.measureText(sigOf(m)).width;
        const row = set.lanterns.filter((l) => l.y === last.y);
        const rowEnd = Math.max(...row.map((l) => l.x + l.w / 2));
        const rowY = Math.max(...row.map((l) => wireY({ y: l.y }, l.x) + l.h * 1.62));
        set.sig = { text: sigOf(m), size: sz, x: Math.max(AREA.x, rowEnd - sw), y: rowY + sz * 1.2 };
        this.lyrSize = lyricV2(set.char);
      }
      // 亮起來的時間：從第一拍起照拍子一個一個
      const n = set.lanterns.length;
      const ts = stagger(au, gr.b0, n, Math.min(gr.bar * 1.75, Math.max(gr.beat * 2, (e - gr.b0) * 0.5)));
      set.lanterns.forEach((l, i) => { l.t0 = ts[i]!; });
      this.msgSet = set;
    } else {
      for (const l of lines) this.lineSets.set(l, this.layoutText(c, l.text, 2, V2.lyrMax, l));
    }
    const all = [...(this.msgSet ? [this.msgSet] : []), ...this.lineSets.values()];
    this.buildAtlas(all.flatMap((st) => st.lanterns));
    this.buildForeground();
    this.avoid = [[AREA.x, AREA.y, AREA.w, AREA.h + 60], [SIGN.x, SIGN.y, SIGN.w, SIGN.h]];
  }

  /**
   * 把一段字排成一串串燈籠：用 fitText 找字級與斷行（子句斷行），每個字（英文一個字）一個燈籠，
   * 逗號句號變成燈籠之間的空隙，驚嘆號、問號是小燈籠。歌詞的話記下每個燈籠是哪個 Word（跟唱用）。
   * charMax：燈籠上的字在螢幕上最大幾 px（v2）；排版字級 s 與字的關係是 字 ≈ CH·s。
   */
  private layoutText(c: CanvasRenderingContext2D, text: string, maxLines: number, charMax: number, line?: Line, sig = false): LSet {
    const min = V2.msgMin / CH, max = charMax / CH;
    // 整塊要多高：每串一個燈籠（含流蘇）＋串與串的間距＋署名；fitText 只算字的行高，超出就把框縮小再排一次
    const need = (sz: number, n: number) => sz * (LH * 1.62 + (n - 1) * ROWH) + (sig ? V2.sigMax * 1.6 : 0);
    // 照子句斷（「每一／年」這種斷法燈籠串會很難讀），放不下才交給 fitText
    const fitIn = (h: number) => fitClauses(c, text, FAM, AREA.w / PITCH_FIT, h, { min, max, lineHeight: ROWH, maxLines })
      ?? fitText(c, text, FAM, AREA.w / PITCH_FIT, h, { min, max, lineHeight: ROWH, maxLines });
    let hFit = AREA.h, fit: FitResult = fitIn(hFit);
    for (let k = 0; k < 4; k++) {
      const over = need(fit.size, fit.lines.length) - AREA.h;
      if (over <= 0) break;
      hFit -= over + 4;
      fit = fitIn(hFit);
    }
    const s = fit.size;
    const lanterns: Lantern[] = [];
    const wires: Wire[] = [];
    // 整塊在 AREA 裡稍微偏上的置中（短留言不要孤零零地貼在最上面）；歌詞照最多行數算，換句的時候燈籠串不會上下跳
    const top = AREA.y + Math.max(0, (AREA.h - need(s, line ? maxLines : fit.lines.length)) * 0.4);
    let cursor = 0;
    fit.lines.forEach((ln, ri) => {
      const y = top + ri * fit.lineHeight;
      // 這一行的單位：中文一字、英文一個字（連著的拉丁字母、數字）、標點
      const units = ln.match(/[A-Za-z0-9'’&@#+\-]+[!?！？]*|♥|[^\sA-Za-z0-9]/g) ?? [];
      let x = AREA.x;
      for (const u of units) {
        const at = text.indexOf(u, cursor);
        if (at >= 0) cursor = at + u.length;
        if (PUNCT.test(u)) { x += s * 0.5; continue; }
        const small = /^[!?！？~～…]+$/.test(u);
        c.font = font(FAM, s);
        const tw = c.measureText(u).width;
        // 一個中文字的燈籠寬 LW·s；英文字的燈籠跟著字變寬
        const w = small ? s * 0.78 : Math.max(s * LW, tw + s * 0.42);
        const h = small ? s * 0.95 : s * LH * (w > s * LW * 1.4 ? 0.92 : 1);
        const word = line?.words.find((wd) => at >= wd.o && at < wd.o + wd.w.length);
        lanterns.push({ text: u, small, x: x + w / 2, y, w, h, sx: 0, sy: 0, sw: 0, sh: 0, t0: word ? word.start : 0, word, seed: lanterns.length });
        x += w + s * (PITCH - LW);
      }
      wires.push({ y });
    });
    return { lanterns, wires, char: s * CH };
  }

  /** 燈籠精靈圖：每個燈籠畫暗的、亮的兩張進同一張圖集（書架式排列）。 */
  private buildAtlas(ls: Lantern[]) {
    const PAD = 8;
    let x = 0, y = 0, rowH = 0, maxW = 0;
    const MAXW = 2400;
    for (const l of ls) {
      const sw = Math.ceil(l.w * 1.08 + PAD * 2), sh = Math.ceil(l.h * 1.75 + PAD * 2);
      if (x + sw * 2 > MAXW) { x = 0; y += rowH; rowH = 0; }
      l.sx = x; l.sy = y; l.sw = sw; l.sh = sh;
      x += sw * 2; rowH = Math.max(rowH, sh); maxW = Math.max(maxW, x);
    }
    const cv = this.atlas;
    cv.width = Math.max(1, maxW); cv.height = Math.max(1, y + rowH);
    const c = cv.getContext('2d')!;
    for (const l of ls) {
      for (const lit of [false, true]) {
        c.save();
        c.translate(l.sx + (lit ? l.sw : 0) + l.sw / 2, l.sy + PAD);
        this.drawLantern(c, l, lit);
        c.restore();
      }
    }
  }

  /** 畫一個燈籠（原點 = 頂端掛點）：頂蓋、竹骨、紙面（亮的時候裡面有火）、字、底蓋、流蘇。 */
  private drawLantern(c: CanvasRenderingContext2D, l: Lantern, lit: boolean) {
    const w = l.w, h = l.h, cy = h * 0.12 + h / 2, rx = w / 2, ry = h / 2;
    // 流蘇
    c.strokeStyle = lit ? rgba('blood', 0.95) : mixRgba('blood', 'ink', 0.55);
    c.lineWidth = Math.max(1.2, w * 0.018);
    const ty = cy + ry + h * 0.08;
    for (let k = -2; k <= 2; k++) { c.beginPath(); c.moveTo(k * w * 0.03, ty); c.lineTo(k * w * 0.05, ty + h * 0.42); c.stroke(); }
    // 紙面：亮的時候中間最亮（火），邊緣暗紅；暗的時候整顆暗暗的
    const g = c.createRadialGradient(0, cy + ry * 0.1, rx * 0.1, 0, cy, Math.max(rx, ry) * 1.02);
    if (lit) {
      g.addColorStop(0, rgba('ember')); g.addColorStop(0.42, rgba('signal')); g.addColorStop(0.82, mixRgba('signal', 'blood', 0.55)); g.addColorStop(1, rgba('blood'));
    } else {
      g.addColorStop(0, mixRgba('blood', 'ink', 0.35)); g.addColorStop(1, mixRgba('blood', 'ink', 0.72));
    }
    c.fillStyle = g;
    c.beginPath(); c.ellipse(0, cy, rx, ry, 0, 0, Math.PI * 2); c.fill();
    // 竹骨：幾條經線（橢圓，越外面越扁）
    c.strokeStyle = lit ? mixRgba('blood', 'signal', 0.2, 0.55) : mixRgba('blood', 'ink', 0.8, 0.8);
    c.lineWidth = Math.max(1, w * 0.012);
    for (const k of [0.35, 0.7]) { c.beginPath(); c.ellipse(0, cy, rx * k, ry, 0, 0, Math.PI * 2); c.stroke(); }
    // 字：黑墨（亮的時候很清楚；暗的時候淡淡看得到）；愛心用點綴色。一個中文字約 CH 倍排版字級
    const s = l.small ? h * 0.72 : Math.min(h * 0.66, (w - h * 0.2) / Math.max(1, Array.from(l.text).length) * 1.05, w * 0.76);
    if (l.text === '♥') drawHeart(c, 0, cy, s * 0.95, lit ? rgba('rose') : mixRgba('rose', 'ink', 0.6));
    else if (l.text) {
      c.font = font(FAM, s);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      const tw = c.measureText(l.text).width;
      c.save(); c.translate(0, cy + s * 0.04);
      if (tw > w * 0.84) c.scale((w * 0.84) / tw, 1);
      c.fillStyle = lit ? rgba('ink', 0.94) : rgba('ink', 0.55);
      c.fillText(l.text, 0, 0);
      c.restore();
    }
    // 頂蓋、底蓋：黑漆，一圈金邊
    const capW = w * 0.52, capH = h * 0.1;
    for (const [yy, hh] of [[cy - ry - capH * 0.55, capH], [cy + ry - capH * 0.45, capH]] as const) {
      c.fillStyle = rgba('ink');
      c.beginPath(); c.roundRect(-capW / 2, yy, capW, hh, capH * 0.3); c.fill();
      c.fillStyle = lit ? rgba('signal', 0.8) : mixRgba('signal', 'ink', 0.7);
      c.fillRect(-capW / 2, yy + hh * 0.42, capW, Math.max(1, hh * 0.16));
    }
    // 掛繩
    c.strokeStyle = rgba('graphite'); c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(0, cy - ry - capH * 0.5); c.stroke();
  }

  /** 前景：很近、失焦的大燈籠（init 模糊一次，每格只貼，最上面一排跟著風擺）；廟前的一對大燈籠（不模糊）。 */
  private buildForeground() {
    const blank = (w: number, h: number): Lantern => ({ text: '', small: false, x: 0, y: 0, w, h, sx: 0, sy: 0, sw: 0, sh: 0, t0: 0, seed: 0 });
    const cv = this.fg;
    cv.width = 300; cv.height = 420;
    const c = cv.getContext('2d')!;
    c.filter = 'blur(14px)';
    c.translate(150, 40);
    this.drawLantern(c, blank(190, 230), true);
    c.filter = 'none';
    const tv = this.temLantern;
    tv.width = 90; tv.height = 150;
    const tc = tv.getContext('2d')!;
    tc.translate(45, 4);
    this.drawLantern(tc, blank(66, 78), true);
  }

  /** 風：最近一次小節線颳起的一陣（阻尼的擺動，0 附近來回）；x 越右邊越晚到（一波由左到右）。 */
  private gustAt(t: number, x = 0) {
    const tt = t - x / 2600;
    let g = 0;
    for (const tb of this.gusts) {
      if (tt < tb) break;
      const d = tt - tb;
      g = Math.exp(-d * 2.1) * Math.sin(d * 6.5);
    }
    return g;
  }

  /** 雙數小節那一道光：到 x 的時候燈籠亮一下（由左到右掃過去），回傳 0..1。 */
  private waveAt(t: number, x: number) {
    let v = 0;
    for (const tw of this.waves) v = Math.max(v, pulse(t, tw + (x - AREA.x) / 1500, 0.1));
    return v;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    // 鏡頭：切進來時往下看一點（攤位），第一個小節線前仰起來看燈籠；之後慢慢推近
    const tilt = 1 - ease.inOutCubic(prog(t, s, Math.max(s + 0.6, this.camK0)));
    const pe = ease.inOutQuad(clamp((t - s) / Math.max(1, e - s)));
    const zoom = 1 + 0.04 * pe;
    const camY = -60 * tilt;
    const exit = prog(t, e - 0.3, e, ease.inCubic);
    const L = this.main, G = this.glow;
    L.clear(); G.clear();
    const c = L.ctx, gc = G.ctx;
    /** 深度 d 的一層：推近與仰角的視差（d = 1 是燈籠那一層）。 */
    const layer = (ctx: CanvasRenderingContext2D, d: number) => {
      const z = 1 + (zoom - 1) * d;
      ctx.setTransform(z, 0, 0, z, 960 * (1 - z), 540 * (1 - z) + camY * d);
    };
    const kick = f.a.kick;
    // 天公爐冒火星的那一下（單數小節）
    let puff = 0;
    for (const tb of this.bursts) { if (t < tb) break; puff = Math.max(puff, pulse(t, tb, 0.25)); }
    // ---- 廟這一層：香（爐口插滿的香腳、香頭一點點紅，大鼓與冒火星時亮一下）、廟前的一對大燈籠
    layer(c, D_TEMPLE); layer(gc, D_TEMPLE);
    this.drawTempleProps(c, gc, t, kick, puff);
    // ---- 遠處一串裝飾燈籠（小、沒有字、比較暗）
    layer(c, 0.55); layer(gc, 0.55);
    {
      const yy = 22, n = 17;
      c.strokeStyle = rgba('graphite', 0.35); c.lineWidth = 1.2;
      c.beginPath();
      for (let x = -100; x <= 2020; x += 40) { const sag = 60 * (1 - Math.pow((x - 960) / 1060, 2)); x === -100 ? c.moveTo(x, yy + sag) : c.lineTo(x, yy + sag); }
      c.stroke();
      const pitch = 2120 / n;
      for (let i = 0; i < n; i++) {
        const x = -60 + pitch * (i + 0.5), sag = 60 * (1 - Math.pow((x - 960) / 1060, 2));
        const w = 36, h = 43, cy = yy + sag + h * 0.62 + 4 * this.gustAt(t, x);
        const flick = 0.75 + 0.25 * noise1(t * 3 + i * 1.7, 5) + 0.4 * this.waveAt(t, x);
        const g = c.createRadialGradient(x, cy, 0, x, cy, w * 0.55);
        g.addColorStop(0, mixRgba('signal', 'ember', 0.3, 0.35 * flick)); g.addColorStop(0.7, rgba('blood', 0.3 * flick)); g.addColorStop(1, rgba('blood', 0));
        c.fillStyle = g; c.beginPath(); c.ellipse(x, cy, w / 2, h / 2, 0, 0, Math.PI * 2); c.fill();
        gc.fillStyle = rgba('signal', 0.06 * flick); gc.beginPath(); gc.arc(x, cy, w * 0.8, 0, Math.PI * 2); gc.fill();
      }
    }
    // ---- 中景一串沒有字的小燈籠（比主角遠、暗）：左下的夜空不會空空的，一樣跟著風擺、被那道光掃過
    layer(c, 0.8); layer(gc, 0.8);
    this.drawDecor(c, gc, t);
    // ---- 燈篙與旗子、主角的燈籠串
    layer(c, 1); layer(gc, 1);
    this.drawPole(c, t);
    let set: LSet | null = this.msgSet, alpha = 1;
    let line: Line | null = null;
    if (!set) {
      const sl = shownLyric(lyrics, t, s, e);
      line = sl?.line ?? null;
      set = line ? this.lineSets.get(line) ?? null : null;
      alpha = sl ? (sl.live ? sl.k : 1) : 0;
    }
    // 退場：最後一下燈籠一起熄掉
    if (set) this.drawSet(c, gc, set, t, kick, alpha, line, 1 - exit);
    // ---- 攤位：遮雨棚的剪影、燈箱招牌（歌詞）
    layer(c, 1.05);
    this.drawStalls(c, t);
    // ---- 前景：最上面一排很近、失焦的大燈籠，跟著風擺（視差最大）
    layer(c, 1.5);
    for (let k = 0; k < 4; k++) {
      const x = 90 + k * 560 + 60 * hash(k, 9), y0 = -150 + 30 * hash(k, 4);
      const ang = 0.03 * Math.sin(t * 1.1 + k * 1.9) + 0.07 * this.gustAt(t, x);
      c.globalAlpha = 0.5;
      c.save(); c.translate(x, y0); c.rotate(ang); c.drawImage(this.fg, -150, -40); c.restore();
    }
    c.globalAlpha = 1;
    c.setTransform(1, 0, 0, 1, 0, 0); gc.setTransform(1, 0, 0, 1, 0, 0);

    // ---- 天公爐的火星：單數小節「轟」地冒一把，往上飄、隨風往右偏、慢慢熄（廟那一層的座標，換成螢幕座標）
    const sb = this.sparks; sb.clear();
    const zt = 1 + (zoom - 1) * D_TEMPLE;
    const toS = (x: number, y: number): [number, number] => [960 + (x - 960) * zt, 540 + (y - 540) * zt + camY * D_TEMPLE];
    const sig = LIN.signal, emb = LIN.ember;
    for (const tb of this.bursts) {
      const age0 = t - tb;
      if (age0 < 0) break;
      if (age0 > 2.2) continue;
      for (let i = 0; i < NSPARK; i++) {
        const life = 1.2 + 0.9 * hash(tb * 7, i, 1);
        const age = age0 - 0.25 * hash(tb * 7, i, 2);
        if (age < 0 || age > life) continue;
        const vx = (hash(tb * 7, i, 3) - 0.5) * 160, vy = -(160 + 260 * hash(tb * 7, i, 4));
        const drag = (1 - Math.exp(-age * 1.6)) / 1.6;
        const [x, y] = toS(TEMPLE_X + (hash(tb * 7, i, 5) - 0.5) * 180 + vx * drag + 60 * age * age + 8 * Math.sin(age * 9 + i), RIM_Y - 8 + vy * drag);
        const k = 1 - age / life;
        const I = 2.6 * k * k;
        const col: [number, number, number] = [(sig[0] + (emb[0] - sig[0]) * k) * I, (sig[1] + (emb[1] - sig[1]) * k) * I, (sig[2] + (emb[2] - sig[2]) * k) * I];
        sb.seg2(x, y, x - 1.5, y + 7, 1.6 + k, col, Math.min(1, k * 1.5));
      }
    }
    // 平常爐口也一直有零星的火星（每 0.12 秒一顆）
    for (let n = Math.floor((t - 1.4) / 0.12); n <= Math.floor(t / 0.12); n++) {
      const tb = n * 0.12, age = t - tb;
      if (age < 0 || age > 1.4) continue;
      const [x, y] = toS(TEMPLE_X + (hash(n, 11) - 0.5) * 160 + 30 * age * age + 6 * Math.sin(age * 7 + n), RIM_Y - 10 - (70 + 90 * hash(n, 12)) * age);
      const k = 1 - age / 1.4, I = 1.8 * k;
      sb.seg2(x, y, x - 1, y + 4, 1.4, [sig[0] * I, sig[1] * I, sig[2] * I], k);
    }

    const u = this.sky.u;
    u.t!.value = t;
    (u.cam!.value as THREE.Vector2).set(0, camY);
    u.zoom!.value = zoom;
    u.beat!.value = au.beatAt(t);
    u.wind!.value = 0.8 * this.gustAt(t, TEMPLE_X);
    u.puff!.value = puff;
    u.wave!.value = this.waves.reduce((v, tw) => Math.max(v, pulse(t, tw + 0.5, 0.14)), 0);
    this.sky.render(renderer, out);
    comp.draw(renderer, L.upload(), out);
    comp.draw(renderer, G.upload(), out, { mode: 'add', tint: [1.6, 1.6, 1.6] });
    if (sb.count) sb.render(renderer, out);
    return { bloom: 0.6, vignette: 0.6, halation: 0.3, zoom: 1 + 0.004 * kick, popupAvoid: this.avoid };
  }

  /** 天公爐裡的香（香腳細細的、香頭一點紅，跟著煙微微晃）、掛在步口簷下的一對大燈籠（被風吹得擺）。 */
  private drawTempleProps(c: CanvasRenderingContext2D, gc: CanvasRenderingContext2D, t: number, kick: number, puff: number) {
    const sway = 0.012 * this.gustAt(t, TEMPLE_X);
    c.lineCap = 'round';
    for (const st of STICKS) {
      const a = st.lean + sway;
      const x0 = TEMPLE_X + st.x, y0 = RIM_Y - 1;
      const x1 = x0 + Math.sin(a) * st.len, y1 = y0 - Math.cos(a) * st.len;
      c.strokeStyle = mixRgba('blood', 'ink', 0.45); c.lineWidth = 2;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
      // 香頭：一小段燒紅的（大鼓與冒火星時亮一下）
      const hot = clamp(0.5 + 0.25 * noise1(t * 2 + st.ph, 3) + 0.3 * kick + 0.5 * puff, 0, 1.2);
      c.strokeStyle = mixRgba('signal', 'blood', 0.35, Math.min(1, 0.4 + 0.6 * hot)); c.lineWidth = 2.4;
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x1 - Math.sin(a) * 4, y1 + Math.cos(a) * 4); c.stroke();
      gc.fillStyle = rgba('signal', 0.1 * hot); gc.beginPath(); gc.arc(x1, y1, 6, 0, Math.PI * 2); gc.fill();
    }
    c.lineCap = 'butt';
    for (const sx of [-1, 1]) {
      const x = TEMPLE_X + sx * 250, y = 584;
      const ang = 0.02 * Math.sin(t * 1.3 + sx) + 0.05 * this.gustAt(t, x);
      c.save(); c.translate(x, y); c.rotate(ang); c.drawImage(this.temLantern, -45, -4); c.restore();
      const g = gc.createRadialGradient(x, y + 50, 0, x, y + 50, 90);
      g.addColorStop(0, rgba('signal', 0.16)); g.addColorStop(1, rgba('signal', 0));
      gc.fillStyle = g; gc.beginPath(); gc.arc(x, y + 50, 90, 0, Math.PI * 2); gc.fill();
    }
  }

  /** 中景的一串小燈籠：左端在畫面外，右端綁在燈篙的下半截；沒有字，半透明、小。 */
  private drawDecor(c: CanvasRenderingContext2D, gc: CanvasRenderingContext2D, t: number) {
    const y0 = 668, x0 = -120, x1 = POLE.x;
    const wy = (x: number) => { const u = clamp((x - x0) / (x1 - x0)); return y0 - 20 * u + 44 * 4 * u * (1 - u); };
    c.strokeStyle = rgba('graphite', 0.4); c.lineWidth = 1.2;
    c.beginPath();
    for (let x = x0; x <= x1; x += 40) (x === x0 ? c.moveTo(x, wy(x)) : c.lineTo(x, wy(x)));
    c.lineTo(x1, wy(x1)); c.stroke();
    for (let i = 0; i < 15; i++) {
      const x = -40 + i * 72, y = wy(x);
      const flick = 0.5 + 0.12 * noise1(t * 3 + i * 2.3, 8) + 0.35 * this.waveAt(t, x);
      const ang = 0.03 * Math.sin(t * 1.4 + i) + 0.08 * this.gustAt(t, x);
      c.globalAlpha = flick;
      c.save(); c.translate(x, y); c.rotate(ang); c.scale(0.42, 0.42); c.drawImage(this.temLantern, -45, -4); c.restore();
      gc.fillStyle = rgba('signal', 0.05 * flick); gc.beginPath(); gc.arc(x, y + 18, 26, 0, Math.PI * 2); gc.fill();
    }
    c.globalAlpha = 1;
  }

  /** 燈篙：一根竹竿從畫面上面插到地上（一節一節），頂上一面三角旗被風吹。 */
  private drawPole(c: CanvasRenderingContext2D, t: number) {
    c.fillStyle = mixRgba('ink2', 'graphite', 0.3);
    c.fillRect(POLE.x - 5, 40, 10, 980);
    for (let k = 0; k < 12; k++) c.fillRect(POLE.x - 7, 70 + k * 80, 14, 3);
    const fl = 0.3 * this.gustAt(t, POLE.x) + 0.08 * Math.sin(t * 2.3);
    c.fillStyle = mixRgba('blood', 'signal', 0.3, 0.9);
    c.beginPath(); c.moveTo(POLE.x + 5, 46);
    for (let i = 1; i <= 8; i++) { const u = i / 8; c.lineTo(POLE.x + 5 + 90 * u, 46 + 30 * u * fl + 6 * Math.sin(u * 5 - t * 6) * u); }
    for (let i = 8; i >= 0; i--) { const u = i / 8; c.lineTo(POLE.x + 5 + 90 * u, 46 + 44 + 30 * u * fl + 6 * Math.sin(u * 5 - t * 6) * u - 18 * u); }
    c.closePath(); c.fill();
  }

  /** 畫一組燈籠：電線（左端在畫面外、右端綁在燈篙上）、燈籠（暗的或亮的精靈圖，照亮度疊）、光暈、署名。 */
  private drawSet(c: CanvasRenderingContext2D, gc: CanvasRenderingContext2D, set: LSet, t: number, kick: number, alpha: number, line: Line | null, power = 1) {
    c.save(); gc.save();
    c.globalAlpha = alpha; gc.globalAlpha = alpha;
    c.strokeStyle = rgba('graphite', 0.7); c.lineWidth = 1.6;
    for (const w of set.wires) {
      c.beginPath();
      for (let x = -200; x <= POLE.x; x += 30) (x === -200 ? c.moveTo(x, wireY(w, x)) : c.lineTo(x, wireY(w, x)));
      c.lineTo(POLE.x, wireY(w, POLE.x));
      c.stroke();
    }
    for (const l of set.lanterns) {
      const hy = wireY({ y: l.y }, l.x);
      // 亮度：還沒到是暗的；點亮那一下閃一下，之後像燭火微微跳；雙數小節一道光由左到右掃過
      let lit = 0;
      if (line && l.word) lit = Lyrics.wordProgress(l.word, t) > 0 ? 1 : 0;
      else lit = t >= l.t0 ? 1 : 0;
      const since = t - (l.word ? l.word.start : l.t0);
      const flash = lit ? 0.5 * pulse(t, l.word ? l.word.start : l.t0, 0.09) + 0.45 * this.waveAt(t, l.x) : 0;
      const flick = lit ? 0.9 + 0.1 * noise1(t * 5 + l.seed * 3.3, 11) : 0;
      const on = (lit ? Math.min(1, clamp(since / 0.08)) : 0) * power;
      // 擺動：風（慢）＋小節線的一陣風（由左到右一波）＋大鼓一打整串晃一下
      const ang = 0.03 * Math.sin(t * 1.2 + l.seed * 0.7) + 0.09 * this.gustAt(t, l.x) + 0.04 * kick * Math.sin(l.seed * 2.1 + 1);
      c.save(); c.translate(l.x, hy); c.rotate(ang);
      c.drawImage(this.atlas, l.sx, l.sy, l.sw, l.sh, -l.sw / 2, -8, l.sw, l.sh);
      if (on > 0) {
        c.globalAlpha = alpha * on * Math.min(1, flick + flash);
        c.drawImage(this.atlas, l.sx + l.sw, l.sy, l.sw, l.sh, -l.sw / 2, -8, l.sw, l.sh);
        c.globalAlpha = alpha;
      }
      c.restore();
      if (on > 0) {
        const cy = hy + l.h * 0.62;
        // 光暈照燈籠的高算（英文字的燈籠很寬，照寬算會變成一大片霧）
        const r = l.h * (0.95 + 0.35 * flash);
        const g = gc.createRadialGradient(l.x, cy, 0, l.x, cy, r);
        g.addColorStop(0, rgba('signal', 0.2 * on * (flick + flash))); g.addColorStop(0.6, rgba('signal', 0.05 * on)); g.addColorStop(1, rgba('signal', 0));
        gc.fillStyle = g; gc.beginPath(); gc.arc(l.x, cy, r, 0, Math.PI * 2); gc.fill();
      }
    }
    // 原文（韓文歌）：不做燈籠，小一號寫在最下面那串燈籠的流蘇底下（同一層、同樣靠左），像燈籠照亮的一行字
    const sub = line ? lyricSubOf(line) : null;
    if (sub && set.lanterns.length) {
      const lastY = Math.max(...set.lanterns.map((l) => l.y));
      const bottom = Math.max(...set.lanterns.filter((l) => l.y === lastY).map((l) => wireY({ y: l.y }, l.x) + l.h * 1.62));
      const st: LyricStyle = { family: FAM, size: set.char, maxWidth: AREA.w, align: 'left', ...darkInk() };
      c.save(); c.translate(AREA.x, bottom + subSizeFor(set.char) * 0.95);
      drawLyricSub(c, sub, t, st, set.char, alpha * power);
      c.restore();
    }
    if (set.sig) {
      const sg = set.sig, last = set.lanterns[set.lanterns.length - 1]!;
      c.globalAlpha = alpha * clamp((t - last.t0 - 0.2) / 0.4);
      c.font = font(FAM_SIG, sg.size); c.fillStyle = rgba('bone', 0.9);
      c.textBaseline = 'alphabetic';
      c.fillText(sg.text, sg.x, sg.y);
    }
    if (this.msg?.couple) {
      c.globalAlpha = alpha;
      c.font = font(F.mono(500), 18); c.letterSpacing = '4px'; c.fillStyle = rgba('signal', 0.8);
      c.textBaseline = 'alphabetic';
      c.fillText('FROM THE COUPLE · 新人', AREA.x, AREA.y - 36);
      c.letterSpacing = '0px';
    }
    c.restore(); gc.restore();
  }

  /** 下面的夜市攤位：一排遮雨棚的剪影（下面透出暖光），燈箱招牌：有留言放歌詞，沒有留言放邀請。右下角 HUD 那一塊不放東西。 */
  private drawStalls(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    // 攤位下面的暖光
    const g = c.createLinearGradient(0, 900, 0, 1080);
    g.addColorStop(0, rgba('signal', 0)); g.addColorStop(1, rgba('blood', 0.35));
    c.fillStyle = g; c.fillRect(-100, 900, 1380, 280);
    // 遮雨棚：一排，邊緣是波浪（只到廟前，不進 HUD 區）
    for (let k = 0; k < 4; k++) {
      const x0 = -80 + k * 340, w = 320, y0 = 944 + 14 * hash(k, 3);
      c.fillStyle = rgba('ink2', 0.96);
      c.beginPath(); c.moveTo(x0, y0 - 36); c.lineTo(x0 + w, y0 - 36); c.lineTo(x0 + w, y0);
      for (let i = 8; i >= 0; i--) c.quadraticCurveTo(x0 + (i + 0.5) * w / 8, y0 + 16, x0 + i * w / 8, y0);
      c.closePath(); c.fill();
      c.fillStyle = rgba('ink', 0.98); c.fillRect(x0, y0 + 8, w, 200);
    }
    // 燈箱招牌：外框是紅色烤漆的鐵皮，上下一條細細的金邊；燈箱面中間亮、兩端暗（裡面的燈管）
    const B = SIGN;
    c.fillStyle = mixRgba('blood', 'ink', 0.35); c.beginPath(); c.roundRect(B.x - 10, B.y - 10, B.w + 20, B.h + 20, 6); c.fill();
    c.fillStyle = rgba('signal', 0.5); c.fillRect(B.x - 10, B.y - 10, B.w + 20, 2); c.fillRect(B.x - 10, B.y + B.h + 8, B.w + 20, 2);
    const lg = c.createLinearGradient(B.x, 0, B.x + B.w, 0);
    lg.addColorStop(0, mixRgba('paper', 'signal', 0.3, 0.78)); lg.addColorStop(0.5, rgba('paper', 0.9)); lg.addColorStop(1, mixRgba('paper', 'signal', 0.3, 0.78));
    c.fillStyle = lg; c.fillRect(B.x, B.y, B.w, B.h);
    c.fillStyle = rgba('ink', 0.95);
    c.fillRect(B.x + 60, B.y + B.h + 8, 10, 60); c.fillRect(B.x + B.w - 70, B.y + B.h + 8, 10, 60);
    c.textBaseline = 'alphabetic';
    if (this.msg) {
      const ly = shownLyric(lyrics, t, s, e);
      if (ly) {
        const st = { family: FAM_LYR, size: this.lyrSize, minSize: V2.lyrMin, maxW: B.w - 50, maxRows: 1, align: 'left' as const };
        const lay = layoutRows(c, ly.line, st);
        c.save(); c.translate(B.x + 26, B.y + B.h / 2 + lay.size * 0.36);
        drawRows(c, lay, FAM_LYR, t, paperInk(), ly.k);
        c.restore();
      } else {
        c.font = font(F.mono(500), 20); c.letterSpacing = '5px'; c.fillStyle = rgba('sepia', 0.7);
        c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`.toUpperCase(), B.x + 26, B.y + B.h / 2 + 7);
        c.letterSpacing = '0px';
      }
    } else {
      c.font = font(F.hei(700), 30); c.fillStyle = rgba('sepia', 0.9);
      c.fillText(INVITE, B.x + 26, B.y + B.h / 2 + 10);
    }
    // 右邊一塊小招牌（配角：小字、暗）
    c.fillStyle = mixRgba('blood', 'ink', 0.3, 0.9); c.fillRect(1080, 852, 110, 56);
    c.font = font(F.hei(700), 20); c.fillStyle = rgba('paper', 0.6);
    c.fillText('古早味', 1105, 888);
  }
}
