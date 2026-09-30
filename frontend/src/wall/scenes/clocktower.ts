// 鐘樓（暗）：夜裡一座石造鐘樓的正面特寫，月亮在右邊塔身外面。
//  - 鐘面：深色琺瑯、外圈鎏金的框、一圈楔形的拱石。分針「一拍跳一刻」（90°，彈一下停住），所以每個小節線正好走到 12——
//    整點：鐘聲從鐘面往外擴散成一圈一圈的細環（訊號色），畫面輕輕一震，時針跳一格。
//  - 鐘面上的數字換成歌詞的字：唱到的那一刻亮成訊號色、唱完變成紙白；一句太長就分成上半圈、下半圈（都由左往右讀）。
//    句子之間、純音樂的時候，數字回來（羅馬數字）。
//  - 鐘下面的銅牌＝主打留言：鏡頭切進來時貼近鐘面，第一個小節線鐘響、鏡頭往後退，銅牌上方的燈「啪」地亮起來，
//    浮雕的字一個一個被擦亮（掠過一點訊號色的光）。署名在最後一行下面。
//  - 沒有留言：銅牌寫新人的名字與一行小字邀請（歌詞是主角，字大一級）。
// 手法：天空、塔身的石塊、鐘面、指針（SDF）、銅牌（浮雕：字模的覆蓋率取樣三點算明暗）、鐘聲的環全在一個 shader；
// 鐘面一圈的字（旋轉過的）與銅牌的字都在 init() 畫成資料貼圖（_t25 的 glyphMask），shader 依每個字的進度上色，每格不用重畫字。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { clamp, ease, prog, hash, lerp, pulse } from '../engine/util';
import { type Line } from '../engine/lyrics';
import { lyricAt, lyricSubOf, subGap, subSizeFor, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { V2, lyricV2 } from './_v2';
import {
  T25_TEXT, T25_INVITE, sigOf, winBars, winBeats, stagger, layMsg, layMsgV2, msgGlyphs, glyphMask, glyphStates, MASK_GLSL,
  type MaskGlyph, type GlyphMask, type MsgLay, type Rect,
} from './_t25';

export const spec: PlateSpecDecl = { group: 'type', family: 'journey', paper: false, energy: [0.15, 0.9], bars: [4, 8] };

// ---------------------------------------------------------------- 幾何（世界座標＝鏡頭休息時的畫面座標，y 向下）
/** 鐘面中心、外框（拱石內緣）、鐘面、字的那一圈（字的中心）、刻度圈。 */
const CLK = { x: 980, y: 326 };
const R_STONE = 290, R_BEZ = 244, R_DIAL = 222, R_RING = 168, R_TICK = 206;
/** 指針長度：比字的那一圈短，跳到哪裡都不會蓋住歌詞。 */
const L_MIN = 128, L_HR = 88;
/** 塔身左右緣（外面是夜空）、腰線（石頭的橫帶）。 */
const TOWER = { x0: 150, x1: 1610 };
const BAND = { y0: 634, y1: 660 };
/**
 * 銅牌（外框）與字的範圍（扣掉邊框）。留言標準 v2：銅牌 820×300（≤ 860×430），掛在塔身左下，
 * 鐘面與塔身是主視覺；最下面離畫面底 ≥ 96、右邊不進 QR 區。
 */
const PLQ = { x: 170, y: 690, w: 820, h: 300 };
const HEAD_Y = 726;
const MSG_BOX = { x: 214, y: 744, w: 732, h: 214 };
/** 塔身右下一扇拱窗（裡面點著燈），給空出來的牆一點生氣；不放到右下角 QR 底下。 */
const WINDOW = { x: 1150, y: 706, w: 96, h: 200 };
/** 鐘面一圈的字的資料貼圖範圍（1.25 倍解析度，鏡頭推近也清楚）。 */
const RING_RECT: Rect = [CLK.x - R_DIAL, CLK.y - R_DIAL, R_DIAL * 2, R_DIAL * 2];
const RING_SCALE = 1.25;
const PLQ_RECT: Rect = [PLQ.x, PLQ.y, PLQ.w, PLQ.h];
/** 月亮（塔身外面、右上）。 */
const MOON = { x: 1780, y: 206, r: 40 };
/** 一句歌詞最多幾個字（韓文歌連原文副行一起算，所以留寬一點）。 */
const MAXG = 128;
/** 原文副行的字在資料貼圖裡的標記（R 通道）：shader 認得出來、用比較安靜的顏色。 */
const SUB_TAG = 100;
/** 有原文副行時分針縮短：副行在字的那一圈裡面再一圈，分針照原本的長度會掃過副行。 */
const L_MIN_SUB = 96;
const FAM_LYR = F.archivo(75, 700);
const FAM_MSG = F.ming(900);
const FAM_SMALL = F.ming(700);
const FAM_NUM = F.serif(600);
const NUMERALS = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
const HEAD = `本鐘每一小節敲響一次　·　為 ${COUPLE_ZH} 報時　·　${DATE_DOTS}`;
const EMPTY_HEAD = `本鐘為 ${COUPLE_ZH} 報時`;

const BG = () => new FSPass(/* glsl */ `
  uniform float t; uniform vec2 camT; uniform float camZ;
  uniform float angM, angH;            // 分針、時針（弧度，順時針，從 12 點起）
  uniform float lenM;                  // 分針長度（有原文副行時短一點）
  uniform vec3 bells;                  // 最近三次鐘響過了幾秒（沒有是 99）
  uniform float lamp;                  // 銅牌的燈 0..1
  uniform float sweep;                 // 街上開過去的車燈掃過塔身（0..1；沒有是 -1）
  uniform sampler2D ring; uniform float ringOn; uniform float ringA; uniform vec2 gs[${MAXG}];
  uniform sampler2D nums; uniform float numA;
  uniform sampler2D plq; uniform float shown; uniform float plqOn;
  ${MASK_GLSL}
  const vec2 C = vec2(${CLK.x}.0, ${CLK.y}.0);
  const vec4 RR = vec4(${RING_RECT.join('.0, ')}.0);
  const vec4 PR = vec4(${PLQ_RECT.join('.0, ')}.0);

  // 石塊：一排一排錯開的方石（每排的石塊寬度不一樣），灰泥縫暗而且有點歪，每塊明暗、風化不同
  vec3 stone(vec2 p, out float mortar) {
    float bh = 66.0;
    float row = floor(p.y / bh);
    float bw = 118.0 + 64.0 * hash11(row * 1.37 + 0.3);
    float xq = p.x + hash11(row * 7.1 + 2.0) * bw;
    float cx = floor(xq / bw);
    vec2 id = vec2(cx, row);
    vec2 f = vec2(xq - cx * bw, p.y - row * bh);
    float e = min(min(f.x, bw - f.x), min(f.y, bh - f.y));
    mortar = 1.0 - smoothstep(1.0, 3.2, e + 0.9 * snoise(p / 9.0));
    float h = hash12(id + 3.7);
    float n = fbm(p / vec2(90.0, 42.0) + id * 1.3, 3);
    float pit = step(0.94, hash12(floor(p / 3.0) + id));
    vec3 c = C_INK2 * (0.9 + 0.42 * h + 0.3 * n) * (1.0 - 0.18 * pit) + C_GRAPHITE * 0.03 * n;
    // 縫旁邊暗一點（石塊的倒角），上緣被月光打亮一點
    c *= 0.72 + 0.28 * smoothstep(0.0, 16.0, e);
    c += C_ASH * 0.028 * (1.0 - smoothstep(0.0, 4.0, f.y)) * (1.0 - mortar);
    return mix(c, C_INK * 0.5, mortar);
  }
  // 一支指針（SDF）：沿著方向的座標 a、橫的座標 b
  float handSD(vec2 q, float ang, float len, float w0, float w1, float orn) {
    vec2 d = vec2(sin(ang), -cos(ang)), n = vec2(cos(ang), sin(ang));
    float a = dot(q, d), b = dot(q, n);
    float k = clamp((a + len * 0.2) / (len * 1.2), 0.0, 1.0);
    float w = mix(w0, w1, k);
    float shaft = max(abs(b) - w, max(-len * 0.2 - a, a - len));
    // 尖端的菱形、尾巴的配重圓
    vec2 dm = vec2(a - len * 0.8, b);
    float diamond = (abs(dm.x) / (len * 0.13) + abs(dm.y) / (w0 * 1.9)) - 1.0;
    diamond *= w0 * 1.6;
    float tail = length(vec2(a + len * 0.17, b)) - w0 * 1.6;
    float s = min(shaft, min(diamond, tail));
    // 時針：尖端前面一個空心的圈
    if (orn > 0.5) { float r = length(vec2(a - len * 0.66, b)); s = min(s, abs(r - w0 * 2.0) - w0 * 0.45); }
    return s;
  }
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = camT + (sp - vec2(960.0, 540.0)) / camZ;
    float px = 1.0 / camZ; // 一個畫面像素是幾個世界單位（反鋸齒用）

    // ---- 夜空（塔身外面）：上面深、地平線一點暖，稀疏的星、慢慢飄的雲、月亮
    vec3 sky = mix(C_INK * 0.55, C_INK2 * 0.9 + C_SIGNAL * 0.012, smoothstep(-200.0, 1200.0, p.y));
    float cl = fbm(vec2(p.x / 420.0 + t * 0.01, p.y / 190.0), 4);
    sky += C_GRAPHITE * 0.05 * smoothstep(0.05, 0.6, cl);
    vec2 sg = floor(p / 7.0);
    float st = step(0.9965, hash12(sg)) * (0.5 + 0.5 * sin(t * (0.6 + hash12(sg + 2.0) * 2.0) + hash12(sg + 5.0) * 6.28));
    sky += C_BONE * 0.35 * st * (1.0 - smoothstep(0.2, 0.7, cl));
    float md = length(p - vec2(${MOON.x}.0, ${MOON.y}.0));
    sky += C_BONE * (0.5 - 0.06 * smoothstep(-0.1, 0.5, fbm((p - vec2(${MOON.x}.0, ${MOON.y}.0)) / 22.0, 3))) * (1.0 - smoothstep(${MOON.r}.0 - px, ${MOON.r}.0 + px, md));
    sky += (C_BONE * 0.03 + C_SIGNAL * 0.006) * exp(-max(0.0, md - ${MOON.r}.0) / 140.0);
    vec3 col = sky;

    // ---- 塔身
    float inT = step(${TOWER.x0}.0, p.x) * step(p.x, ${TOWER.x1}.0);
    if (inT > 0.5) {
      float mortar;
      vec3 s = stone(p, mortar);
      // 腰線：一條突出的石頭橫帶，上面亮、下面有影子
      if (p.y > ${BAND.y0}.0 && p.y < ${BAND.y1}.0) {
        float k = (p.y - ${BAND.y0}.0) / ${BAND.y1 - BAND.y0}.0;
        s = C_INK2 * (1.5 - 0.7 * k) + C_ASH * 0.03 * (1.0 - smoothstep(0.0, 0.15, k));
      }
      if (p.y > ${BAND.y1}.0 && p.y < ${BAND.y1 + 24}.0) s *= mix(0.45, 1.0, (p.y - ${BAND.y1}.0) / 24.0);
      // 月光：右邊緣亮一點（塔的轉角）；左邊緣暗
      s *= (0.7 + 0.5 * smoothstep(${TOWER.x0}.0, ${TOWER.x1}.0, p.x)) * (0.75 + 0.25 * smoothstep(-100.0, 700.0, p.y));
      s += C_BONE * 0.05 * (1.0 - smoothstep(0.0, 14.0, ${TOWER.x1}.0 - p.x));
      s *= 0.55 + 0.45 * smoothstep(0.0, 26.0, p.x - ${TOWER.x0}.0);
      // 銅牌的燈照在牆上（一團暖光，從上面打下來）
      vec2 lp = (p - vec2(${PLQ.x + PLQ.w / 2}.0, ${PLQ.y - 30}.0)) / vec2(760.0, 460.0);
      float pool = exp(-dot(lp, lp) * 2.2) * smoothstep(${BAND.y1 - 10}.0, ${BAND.y1 + 60}.0, p.y);
      s += (C_SIGNAL * 0.05 + C_BONE * 0.018) * pool * lamp;
      // 鐘面透出來的光：拱石附近暖一點
      s += C_SIGNAL * 0.012 * exp(-max(0.0, length(p - C) - ${R_STONE}.0) / 120.0);
      // 拱窗：窗框是深色的石頭，裡面一盞暖燈（燭光一樣慢慢晃），十字的窗櫺
      vec2 wq = p - vec2(${WINDOW.x + WINDOW.w / 2}.0, ${WINDOW.y + WINDOW.h}.0);
      float wr = ${WINDOW.w / 2}.0;
      // 拱形：下面是長方形、上面半圓；窗框是同樣的形狀大一圈
      float archY = -${WINDOW.h}.0 + wr;
      float inW = wq.y > archY ? step(abs(wq.x), wr) * step(wq.y, 0.0) : step(length(wq - vec2(0.0, archY)), wr);
      float frameW = wq.y > archY ? step(abs(wq.x), wr + 12.0) * step(wq.y, 10.0) : step(length(wq - vec2(0.0, archY)), wr + 12.0);
      if (frameW > 0.5) s = C_INK * 0.8 + C_INK2 * 0.3;
      if (inW > 0.5) {
        float fl = 0.85 + 0.1 * sin(t * 7.3) + 0.05 * sin(t * 13.1 + 1.0);
        // 燈在窗子裡面偏下（看不到燈本身，只看到牆被照亮的一團），窗洞四周的石頭厚度擋掉一圈光：不要一整片平平的色塊
        vec2 lq = (wq - vec2(-10.0, -${Math.round(WINDOW.h * 0.35)}.0)) / vec2(70.0, 110.0);
        float glow = 0.35 + 0.75 * exp(-dot(lq, lq));
        float edge = wq.y > archY ? min(wr - abs(wq.x), -wq.y) : wr - length(wq - vec2(0.0, archY));
        float recess = smoothstep(0.0, 14.0, edge);
        vec3 wc = (C_SIGNAL * 0.2 + C_EMBER * 0.06) * fl * glow * (0.45 + 0.55 * recess);
        float bars = max(1.0 - smoothstep(2.0, 3.5, abs(wq.x)), 1.0 - smoothstep(2.0, 3.5, abs(wq.y + ${Math.round(WINDOW.h * 0.55)}.0)));
        s = mix(wc, C_INK * 0.5, bars);
      }
      // 窗子的光灑在旁邊的牆上
      s += C_SIGNAL * 0.02 * exp(-length(wq + vec2(0.0, ${WINDOW.h / 2}.0)) / 120.0) * (1.0 - inW);
      // 街上的車燈：一道很寬的暖白光從左掃到右（只照到塔身下半）
      if (sweep >= 0.0) {
        float sx = mix(-400.0, 2300.0, sweep);
        float band = exp(-pow((p.x - sx + (p.y - 1080.0) * 0.35) / 220.0, 2.0)) * smoothstep(560.0, 900.0, p.y);
        s += (C_BONE * 0.05 + C_SIGNAL * 0.02) * band * (1.0 - inW);
      }
      col = s;
    }

    // ---- 拱石：一圈楔形石（徑向的縫），內緣有一道陰影
    float d = length(p - C);
    float th = atan(p.x - C.x, -(p.y - C.y));
    if (d < ${R_STONE}.0) {
      float seg = 6.2831853 / 28.0;
      float fa = abs(mod(th + seg * 0.5, seg) - seg * 0.5) * d;
      float jr = 1.0 - smoothstep(1.2, 3.0, fa);
      vec3 vc = C_INK2 * (1.25 + 0.3 * hash11(floor((th + 3.1416) / seg) + 1.0)) * (0.85 + 0.15 * fbm(p / 40.0, 2));
      vc = mix(vc, C_INK * 0.6, max(jr, 1.0 - smoothstep(1.2, 3.0, abs(d - ${R_STONE}.0))));
      vc *= 0.7 + 0.3 * smoothstep(${R_BEZ}.0, ${R_BEZ + 26}.0, d);
      col = vc;
    }
    // ---- 鎏金外框：圓環的剖面（上面亮、下面暗），一點訊號色
    if (d < ${R_BEZ}.0) {
      float k = (d - ${R_DIAL}.0) / ${R_BEZ - R_DIAL}.0; // 0 內緣 1 外緣
      float prof = sin(k * 3.1416);
      float lit = 0.55 + 0.45 * (-(p.y - C.y) / max(d, 1.0)) * cos(k * 3.1416);
      vec3 gold = mix(C_BLOOD * 0.3, C_SIGNAL * 0.62, prof * clamp(lit, 0.0, 1.0)) + C_EMBER * 0.22 * pow(prof * max(lit, 0.0), 8.0);
      gold *= 0.85 + 0.15 * sin(th * 90.0 + d * 0.3);
      col = gold * (0.45 + 0.55 * prof);
      col = mix(col, C_INK * 0.4, 1.0 - smoothstep(0.0, 1.5 * px, abs(d - ${R_BEZ}.0)) * 0.6);
    }
    // ---- 鐘面：深色琺瑯、放射狀的細紋、玻璃的反光
    float bellK = exp(-bells.x * 3.0);
    if (d < ${R_DIAL}.0) {
      vec3 dc = C_INK2 * 0.95 + C_INK * 0.2;
      dc += C_GRAPHITE * 0.018 * (0.5 + 0.5 * sin(th * 240.0));
      dc *= 0.85 + 0.25 * smoothstep(${R_DIAL}.0, 40.0, d);
      dc += C_SIGNAL * 0.02 * bellK;
      // 內外兩圈細線（鎏金）
      float ln = max(1.0 - smoothstep(0.4 * px, 1.4 * px, abs(d - ${R_RING - 36}.0)), 1.0 - smoothstep(0.4 * px, 1.4 * px, abs(d - ${R_TICK - 8}.0)));
      dc = mix(dc, C_SIGNAL * 0.32, ln * 0.7);
      // 分鐘刻度（60 格，整點的長一點、粗一點）
      float m60 = 6.2831853 / 60.0;
      float fm = abs(mod(th + m60 * 0.5, m60) - m60 * 0.5) * d;
      float isH = step(abs(mod(th + 6.2831853 / 24.0, 6.2831853 / 12.0) - 6.2831853 / 24.0) * d, 3.0);
      float tk = (1.0 - smoothstep(0.6 + isH * 1.2, 1.6 + isH * 1.2, fm)) * step(${R_TICK - 4}.0 - isH * 6.0, d) * step(d, ${R_TICK + 8}.0);
      dc = mix(dc, mix(C_ASH * 0.45, C_SIGNAL * 0.6, isH) * (1.0 + bellK), tk);
      // 數字（羅馬數字，句子之間）
      vec4 nm = maskAt(nums, RR, p);
      dc = mix(dc, mix(C_BONE * 0.55, C_SIGNAL * 0.5, 0.35), nm.a * numA);
      // 歌詞：每個字的進度從 gs[] 查（x = 唱到的比例、y = 這個詞唱完了沒）
      if (ringOn > 0.5) {
        vec4 rg = maskAt(ring, RR, p);
        if (rg.a > 0.0) {
          int gi = min(int(rg.g * 255.0 + 0.5), ${MAXG - 1});
          vec2 g = gs[gi];
          float sw = rg.b;
          float on = smoothstep(sw - 0.04, sw + 0.04, g.x);
          vec3 unsung = C_BONE * 0.26;
          vec3 lit = g.y > 0.5 ? C_BONE * 0.9 : C_SIGNAL * 1.35;
          // 原文副行（韓文歌）：比中文安靜，唱到、唱完都是淡兩成的紙白，不發光
          if (rg.r > 0.3 && rg.r < 0.5) lit = C_BONE * 0.72;
          vec3 gc = mix(unsung, lit, on);
          if (rg.r > 0.9) gc = mix(C_ROSE * 0.4, C_ROSE, on); // 愛心
          dc = mix(dc, gc, rg.a * ringA);
        }
      }
      // 指針的影子（往右下偏一點）與指針本身（鎏金、中線亮）
      vec2 q = p - C;
      float shM = handSD(q - vec2(5.0, 8.0), angM, lenM, 4.2, 1.6, 0.0);
      float shH = handSD(q - vec2(5.0, 8.0), angH, ${L_HR}.0, 5.6, 2.6, 1.0);
      dc *= 1.0 - 0.55 * (1.0 - smoothstep(-2.0, 5.0, min(shM, shH)));
      float hm = handSD(q, angM, lenM, 4.2, 1.6, 0.0);
      float hh = handSD(q, angH, ${L_HR}.0, 5.6, 2.6, 1.0);
      float hs = min(hm, hh);
      float boss = length(q) - 10.0;
      hs = min(hs, boss);
      vec3 hc = mix(C_BLOOD * 0.55, C_SIGNAL * 0.7, 0.5 + 0.5 * clamp(-hs / 3.0, 0.0, 1.0)) + C_EMBER * 0.1 * bellK;
      dc = mix(dc, hc, 1.0 - smoothstep(-0.7 * px, 0.7 * px, hs));
      dc = mix(dc, C_EMBER * 0.5, 1.0 - smoothstep(-0.7 * px, 0.7 * px, length(q) - 3.5));
      // 玻璃：斜斜的一道很淡的反光
      float sheen = exp(-pow((dot(q, normalize(vec2(1.0, 0.6))) + 60.0) / 70.0, 2.0)) * smoothstep(${R_DIAL}.0, ${R_DIAL - 40}.0, d);
      dc += C_BONE * 0.018 * sheen;
      col = dc;
    }

    // ---- 銅牌：邊框的倒角、四顆鉚釘、有點斑駁的青銅；字是浮雕（覆蓋率取樣三點算明暗）
    vec2 pl = p - PR.xy;
    if (pl.x > 0.0 && pl.y > 0.0 && pl.x < PR.z && pl.y < PR.w) {
      float e = min(min(pl.x, PR.z - pl.x), min(pl.y, PR.w - pl.y));
      float light = 0.35 + 0.95 * lamp * exp(-pow((pl.x - PR.z * 0.5) / (PR.z * 0.55), 2.0)) * (1.0 - 0.35 * pl.y / PR.w);
      vec3 br = C_BLOOD * 0.2 + C_INK2 * 0.55 + C_GRAPHITE * 0.05 * fbm(p / 26.0, 3);
      br *= light;
      // 倒角：外緣 18 px 一圈，上面、左邊亮
      if (e < 18.0) {
        float up = (pl.y < 18.0 || pl.x < 18.0) ? 1.0 : 0.0;
        br = mix(br, (C_SIGNAL * 0.22 + C_BLOOD * 0.2) * light * mix(0.6, 1.5, up), 1.0 - smoothstep(12.0, 18.0, e));
        br = mix(br, C_INK * 0.4, 1.0 - smoothstep(0.0, 2.0, e));
      }
      // 鉚釘
      vec2 rv = vec2(min(pl.x, PR.z - pl.x), min(pl.y, PR.w - pl.y)) - vec2(34.0, 34.0);
      float rd = length(rv);
      br = mix(br, (C_SIGNAL * 0.3 + C_BONE * 0.08 * smoothstep(3.0, -3.0, rv.x + rv.y)) * light, 1.0 - smoothstep(6.0, 7.5, rd));
      // 字
      vec4 m0 = maskAt(plq, PR, p);
      if (plqOn > 0.5 && m0.a > 0.0 || maskAt(plq, PR, p + vec2(1.8)).a > 0.0) {
        vec4 mA = maskAt(plq, PR, p - vec2(1.8));
        vec4 mB = maskAt(plq, PR, p + vec2(1.8));
        float rel = mB.a - mA.a; // > 0：朝左上的邊（亮）；< 0：朝右下的邊（暗）
        float tag = m0.r * 255.0;
        float gi = floor(m0.g * 255.0 + 0.5);
        float rv2 = tag > 50.0 && tag < 90.0 ? 1.0 : clamp((shown - gi - m0.b) * 4.0, 0.0, 1.0);
        float glint = tag > 50.0 && tag < 90.0 ? 0.0 : exp(-pow((shown - gi - m0.b) * 2.2, 2.0)) * step(1e-3, shown - gi);
        vec3 face = mix(C_SIGNAL, C_BONE, 0.52) * 0.78 * light;
        if (tag > 250.0) face = C_ROSE * 0.75 * light;
        if (tag > 50.0 && tag < 90.0) {
          // 小字：刻進去的（凹），比較暗、下緣一道細亮邊
          vec3 inc = br * 0.45 + C_BONE * 0.05 * max(-rel, 0.0) * light;
          br = mix(br, inc, m0.a * plqOn);
        } else {
          vec3 raised = face + C_BONE * 0.25 * max(rel, 0.0) * light;
          raised *= 1.0 - 0.5 * max(-rel, 0.0);
          // 還沒擦亮：跟底一樣暗（只看得到一點點輪廓）
          vec3 dull = br * (1.0 + 0.1 * max(rel, 0.0) - 0.14 * max(-rel, 0.0));
          br = mix(br, mix(dull, raised, rv2), max(m0.a, abs(rel)) * plqOn);
          br += C_SIGNAL * 1.6 * glint * m0.a * plqOn;
        }
      }
      if (sweep >= 0.0) br += (C_BONE * 0.06 + C_SIGNAL * 0.03) * exp(-pow((p.x - mix(-400.0, 2300.0, sweep) + (p.y - 1080.0) * 0.35) / 220.0, 2.0));
      col = br;
    }
    // 銅牌下面的影子
    if (p.y > PR.y + PR.w && p.y < PR.y + PR.w + 26.0 && p.x > PR.x && p.x < PR.x + PR.z) col *= mix(0.5, 1.0, (p.y - PR.y - PR.w) / 26.0);

    // ---- 鐘聲：從鐘面往外擴散的細環（三圈一組），越遠越淡
    for (int i = 0; i < 3; i++) {
      float age = i == 0 ? bells.x : i == 1 ? bells.y : bells.z;
      for (int j = 0; j < 3; j++) {
        float a2 = age - float(j) * 0.1;
        if (a2 <= 0.0 || a2 > 3.0) continue;
        float r = ${R_BEZ}.0 + 1150.0 * (1.0 - exp(-a2 * 1.3));
        float w = 1.2 + 1.6 * exp(-a2 * 2.0);
        float ring = 1.0 - smoothstep(w - px, w + px, abs(d - r));
        col += C_SIGNAL * ring * 0.42 * exp(-a2 * 1.7) * (1.0 - 0.3 * float(j));
      }
    }
    fragColor = vec4(col, 1.0);
  }`, {
  t: { value: 0 }, camT: { value: new THREE.Vector2(960, 540) }, camZ: { value: 1 },
  angM: { value: 0 }, angH: { value: 0 }, lenM: { value: L_MIN }, bells: { value: new THREE.Vector3(99, 99, 99) }, lamp: { value: 0 },
  ring: { value: null }, ringOn: { value: 0 }, ringA: { value: 0 }, gs: { value: Array.from({ length: MAXG }, () => new THREE.Vector2()) },
  nums: { value: null }, numA: { value: 1 },
  plq: { value: null }, shown: { value: 0 }, plqOn: { value: 0 }, sweep: { value: -1 },
});

// 量字寬用的小畫布（排版只在 init 做）
let mc: CanvasRenderingContext2D | null = null;
const measure = (s: string, fam: string, size: number) => { mc ??= document.createElement('canvas').getContext('2d')!; mc.font = font(fam, size); return mc.measureText(s).width; };

/**
 * 一圈的字：上半圈由左往右（字的上方朝外）、下半圈也由左往右（字的上方朝圓心），都讀得順。
 * 放得下上半圈就只用上半圈；不然在最接近一半的詞之間分兩段，字級縮到兩段都放得下（最小 minSize）。
 * R：字的中心那一圈的半徑（原文副行用裡面一圈）。
 */
function ringGlyphs(units: { ch: string; gap: number }[][], fam: string, size0: number, minSize: number, idx0 = 0, tag = 0, R = R_RING): { items: MaskGlyph[]; size: number } {
  const cap = Math.PI * R * 0.92;
  const widthOf = (us: { ch: string; gap: number }[][], size: number) => us.flat().reduce((s, u) => s + measure(u.ch, fam, size) + u.gap * size, 0);
  let size = size0;
  let top = units, bot: typeof units = [];
  if (widthOf(units, size) > cap && units.length > 1) {
    let best = 1, bestD = Infinity;
    for (let k = 1; k < units.length; k++) {
      const d = Math.max(widthOf(units.slice(0, k), size), widthOf(units.slice(k), size));
      if (d < bestD) { bestD = d; best = k; }
    }
    top = units.slice(0, best); bot = units.slice(best);
  }
  const worst = Math.max(widthOf(top, size), widthOf(bot, size));
  if (worst > cap) size = Math.max(minSize, (size * cap) / worst);
  const items: MaskGlyph[] = [];
  let idx = idx0;
  const place = (us: typeof units, upper: boolean) => {
    const flat = us.flat();
    // 詞尾的空白不算（最後一個字後面的 gap 拿掉）
    const L = flat.reduce((s, u, i) => s + measure(u.ch, fam, size) + (i < flat.length - 1 ? u.gap * size : 0), 0);
    let s = -L / 2;
    for (const u of flat) {
      const w = measure(u.ch, fam, size);
      const a = (s + w / 2) / R;
      if (u.ch.trim()) {
        if (upper) {
          // 上半圈：從 12 點往兩邊，字的上方朝外；基線在字中心往圓心 0.35 字級
          const rb = R - size * 0.35;
          const px = CLK.x + rb * Math.sin(a), py = CLK.y - rb * Math.cos(a);
          items.push({ ch: u.ch, x: px - (w / 2) * Math.cos(a), y: py - (w / 2) * Math.sin(a), w, size, family: fam, rot: a, idx: idx++, tag });
        } else {
          // 下半圈：從 6 點往兩邊，由左往右讀，字的上方朝圓心
          const rb = R + size * 0.35;
          const px = CLK.x + rb * Math.sin(a), py = CLK.y + rb * Math.cos(a);
          items.push({ ch: u.ch, x: px - (w / 2) * Math.cos(-a), y: py - (w / 2) * Math.sin(-a), w, size, family: fam, rot: -a, idx: idx++, tag });
        }
      }
      s += w + u.gap * size;
    }
  };
  place(top, true);
  if (bot.length) place(bot, false);
  return { items, size };
}

/** 歌詞一行 → 一詞一組的字（英文詞之間留空白）。 */
function lineUnits(line: Line): { ch: string; gap: number }[][] {
  return line.words.map((w, i) => {
    const chars = Array.from(w.w).filter((ch) => ch.trim());
    const next = line.words[i + 1];
    const spaced = next ? /\s/.test(line.text.slice(w.o + w.w.length, next.o)) : false;
    return chars.map((ch, j) => ({ ch, gap: j === chars.length - 1 && spaced ? 0.3 : 0.02 }));
  });
}

export default class ClockTower extends Scene {
  bg = shared('clocktower.bg', BG);
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 131 + (this.msg?.id ?? 0) * 7919) >>> 0;
  rings = new Map<Line, GlyphMask>();
  /** 每句中文佔幾個字（資料貼圖裡原文副行的字接在後面編號）。 */
  ringN = new Map<Line, number>();
  /** 窗格裡有沒有原文副行（有的話整個窗格分針都短一點，不要一句長一句短）。 */
  subAny = false;
  nums: GlyphMask | null = null;
  plq: GlyphMask | null = null;
  lay: MsgLay | null = null;
  times: number[] = [];
  bars: number[] = [];
  tRev = 0;
  tPull = 0;
  pull = false;
  hour0 = 7;
  lyrSize = 52;
  msgSize: number | null = null;
  sweeps: number[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const lines = lyrics.linesIn(s - 0.5, e + 0.5);
    const subs = lines.map((l) => lyricSubOf(l));
    await loadText(`${T25_TEXT}${HEAD}${EMPTY_HEAD}${m?.text ?? ''}${m ? sigOf(m) : ''}${lines.map((l) => l.text).join('')}${song.title}`);
    const beat = au.beatPeriod(s);
    this.bars = winBars(au, s, e);
    // 鏡頭：窗格夠長（≥ 3 小節）時先貼近鐘面，第一個小節線（至少一拍半之後）退後、鐘響、銅牌的燈亮；短的窗格直接在第一拍亮
    const bar = au.timeOfBar(au.barAt(s) + 1) - au.timeOfBar(au.barAt(s));
    this.pull = e - s >= bar * 2.6;
    const firstBeat = winBeats(au, s + 0.12, e)[0] ?? s + 0.2;
    this.tRev = this.pull ? (this.bars.find((b) => b >= s + beat * 1.5) ?? firstBeat) : firstBeat;
    this.tPull = this.tRev;
    this.hour0 = 1 + Math.floor(hash(this.seed, 3) * 11);

    // ---- 鐘面一圈的字：每句歌詞一張資料貼圖；數字一張
    const numItems: MaskGlyph[] = [];
    NUMERALS.forEach((nm, i) => {
      const a = (i / 12) * Math.PI * 2, size = 46, w = measure(nm, FAM_NUM, size);
      const upper = Math.cos(a) > -0.01;
      // 上半圈字的上方朝外，下半圈朝圓心（跟歌詞一樣都讀得順）
      const rb = upper ? R_RING - size * 0.33 : R_RING + size * 0.33;
      const px = CLK.x + rb * Math.sin(a), py = CLK.y - rb * Math.cos(a);
      const rot = upper ? a : a - Math.PI;
      numItems.push({ ch: nm, x: px - (w / 2) * Math.cos(rot), y: py - (w / 2) * Math.sin(rot), w, size, family: FAM_NUM, rot, idx: 0 });
    });
    this.nums = this.track(glyphMask(numItems, RING_RECT, RING_SCALE, 1));

    // ---- 銅牌：上面一行刻進去的小字（標 64）、留言（浮雕，依序擦亮）、署名
    const c = document.createElement('canvas').getContext('2d')!;
    const items: MaskGlyph[] = [];
    const small = (text: string, y: number, size: number) => {
      const w = measure(text, FAM_SMALL, size);
      let x = PLQ.x + PLQ.w / 2 - w / 2;
      for (const ch of Array.from(text)) { const cw = measure(ch, FAM_SMALL, size); if (ch.trim()) items.push({ ch, x, y, w: cw, size, family: FAM_SMALL, idx: 250, tag: 64 }); x += cw; }
    };
    if (m) {
      small(HEAD, HEAD_Y, 20);
      const lay = layMsgV2(c, m.text, sigOf(m), FAM_MSG, MSG_BOX, { lineHeight: 1.3, maxLines: 4, sigFamily: FAM_SMALL, align: 'center' });
      this.lay = lay;
      this.msgSize = lay.screen;
      items.push(...msgGlyphs(this.lay));
      const n = this.lay.glyphs.length;
      const maxDur = Math.max(0.8, Math.min(1.6 * bar, 0.45 * (e - this.tRev)));
      this.times = stagger(au, this.tRev + 0.05, n, maxDur);
    } else {
      // 沒有留言：名字（比歌詞小一級）與一行邀請
      small(EMPTY_HEAD, HEAD_Y + 6, 22);
      // 名字比鐘面的歌詞小（沒有留言時焦點是歌詞）；純音樂時大一點
      this.lay = layMsg(c, COUPLE_ZH, '', FAM_MSG, { x: MSG_BOX.x, y: MSG_BOX.y + 30, w: MSG_BOX.w, h: 110 }, { min: 40, max: lyrics.has ? 44 : 60, maxLines: 1 });
      items.push(...msgGlyphs(this.lay));
      small(T25_INVITE, MSG_BOX.y + 176, 20);
      this.times = stagger(au, this.tRev + 0.05, this.lay.glyphs.length, 1.2);
    }
    this.plq = this.track(glyphMask(items.slice(0, 250), PLQ_RECT, 1, 2));

    // ---- 鐘面一圈的字（v2：比留言小 4 px，40～52）：每句歌詞一張資料貼圖
    this.lyrSize = lyricV2(this.msgSize);
    lines.forEach((ln, li) => {
      const { items: ri, size } = ringGlyphs(lineUnits(ln), FAM_LYR, this.lyrSize, V2.lyrMin);
      // 韓文歌：原文是字的那一圈裡面再一圈（同心、小一號；上半圈在中文正下方），中間隔著那條鎏金細線
      const sub = subs[li];
      let all = ri.slice(0, MAXG);
      if (sub) {
        const ss = subSizeFor(size);
        const r = R_RING - size * 0.35 - subGap(size, ss) + ss * 0.35;
        const { items: si } = ringGlyphs(lineUnits(sub), FAM_LYR, ss, Math.min(ss, 24), all.length, SUB_TAG, r);
        all = all.concat(si).slice(0, MAXG);
        this.subAny = true;
      }
      this.ringN.set(ln, ri.length);
      this.rings.set(ln, this.track(glyphMask(all, RING_RECT, RING_SCALE, 2)));
    });
    // 車燈：每兩個小節（從第二個小節線起）街上開過一台車
    this.sweeps = this.bars.filter((b, i) => b > this.tRev + 0.1 && i % 2 === 1);
  }

  /** 鏡頭：貼近鐘面 → 第一個小節線退後（落在小節線上）→ 很慢地推近。 */
  private cam(t: number) {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const beat = au.beatPeriod(s);
    const rest = { x: 960, y: 540, z: 1 };
    const close = { x: CLK.x, y: CLK.y + 60, z: 1.2 };
    let k = 1;
    if (this.pull) k = ease.inOutCubic(prog(t, this.tPull - beat * 0.9, this.tPull));
    const push = ease.inOutQuad(prog(t, this.tRev, e));
    const z = lerp(close.z, rest.z, k) + 0.03 * push;
    return { x: lerp(close.x, rest.x, k) - 20 * push, y: lerp(close.y, rest.y, k) + 20 * push, z: this.pull ? z : rest.z + 0.03 * ease.inOutQuad(prog(t, s, e)) };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio: au, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const u = this.bg.u;
    u.t!.value = t;
    const cam = this.cam(t);
    (u.camT!.value as THREE.Vector2).set(cam.x, cam.y);
    u.camZ!.value = cam.z;

    // ---- 指針：一拍跳一刻（90°），每個小節線正好在 12；時針跟著分針走（一小節 30°）
    const bi = Math.floor(au.barAt(t) + 1e-4);
    const b0 = au.timeOfBar(bi), b1 = au.timeOfBar(bi + 1);
    const nb = Math.max(1, Math.round(au.beatAt(b1) - au.beatAt(b0)));
    const j = clamp(Math.floor(au.beatAt(t) - au.beatAt(b0) + 1e-3), 0, nb - 1);
    const tj = au.timeOfBeat(au.beatAt(b0) + j);
    // 跳一下：很快到位、稍微過頭再彈回來（像車站的大鐘）
    const ph = t - tj;
    const jump = ph < 0 ? 0 : 1 - Math.exp(-ph * 26) * Math.cos(ph * 34);
    const turns = bi + (j - 1 + clamp(jump, 0, 1.12)) / nb;
    u.angM!.value = turns * Math.PI * 2;
    u.lenM!.value = this.subAny ? L_MIN_SUB : L_MIN;
    u.angH!.value = ((this.hour0 + turns) / 12) * Math.PI * 2;

    // ---- 鐘響：窗格裡的小節線（第一聲是銅牌亮的那一下）
    const past = this.bars.filter((b) => b <= t && b >= this.tRev - 1e-3).reverse();
    const bv = u.bells!.value as THREE.Vector3;
    bv.set(past[0] !== undefined ? t - past[0] : 99, past[1] !== undefined ? t - past[1] : 99, past[2] !== undefined ? t - past[2] : 99);
    if (!past.length && t >= this.tRev) bv.x = t - this.tRev;

    // ---- 銅牌的燈：亮一下、暗、再亮（老燈泡）
    const lt = t - this.tRev;
    const lamp = lt < -0.12 ? 0 : lt < -0.06 ? 0.7 : lt < 0 ? 0.1 : 1;
    // 沒有留言時銅牌是配角（焦點是鐘面上的歌詞）：燈暗一點
    u.lamp!.value = lamp * (this.msg ? 1 : 0.55) * (1 - 0.6 * ease.inCubic(prog(t, e - 0.35, e)));
    u.plq!.value = this.plq!.tex;
    u.plqOn!.value = 1;
    // 車燈掃過：1.3 秒從左到右
    const sw = this.sweeps.filter((b) => b <= t).pop();
    u.sweep!.value = sw !== undefined && t - sw < 1.3 ? ease.inOutQuad((t - sw) / 1.3) : -1;
    // 擦亮到第幾個字（小數＝這個字擦到哪）
    let shown = 0;
    for (let i = 0; i < this.times.length; i++) {
      const k = clamp((t - this.times[i]!) / 0.14);
      if (k <= 0) break;
      shown = i + k;
    }
    u.shown!.value = shown;

    // ---- 鐘面一圈的字
    const ly = lyricAt(lyrics, t, 1.0, 0.45);
    const gs = u.gs!.value as THREE.Vector2[];
    const mk = ly ? this.rings.get(ly.line) : undefined;
    u.nums!.value = this.nums!.tex;
    if (ly && mk) {
      u.ring!.value = mk.tex;
      u.ringOn!.value = 1;
      u.ringA!.value = ly.k;
      const st = glyphStates(ly.line, t);
      // 原文副行的字接在中文後面（照原文自己的逐字時間）
      const sub = lyricSubOf(ly.line);
      if (sub) { st.length = this.ringN.get(ly.line) ?? st.length; st.push(...glyphStates(sub, t)); }
      for (let i = 0; i < MAXG; i++) { const g = st[i]; gs[i]!.set(g ? g.p : 0, g?.done ? 1 : 0); }
      u.numA!.value = 1 - ly.k;
    } else {
      u.ring!.value = this.nums!.tex;
      u.ringOn!.value = 0;
      u.ringA!.value = 0;
      u.numA!.value = 1;
    }
    this.bg.render(renderer, out);

    const bell = past.length ? pulse(t, past[0]!, 0.09) : 0;
    const exit = ease.inCubic(prog(t, e - 0.3, e));
    const box = this.lay?.box;
    return {
      bloom: 0.7, vignette: 0.5, halation: 0.22,
      shake: [0, bell * 3],
      fade: exit * 0.35,
      popupAvoid: [[CLK.x - R_DIAL, CLK.y - R_DIAL, R_DIAL * 2, R_DIAL * 2], ...(box ? [box as Rect] : [])],
    };
  }
}
