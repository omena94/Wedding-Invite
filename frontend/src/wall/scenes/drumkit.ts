// 鼓組（暗）：舞台上一套沒有人的鼓，從正面看：中間是大鼓（黑色的前鼓皮），左邊小鼓與腳踏鈸、右邊落地鼓，上面兩片銅鈸。
//  - 鼓真的在鼓點被敲：大鼓在每個 kick 上「咚」——鼓皮一圈波紋往外擴散、整顆鼓跟著一頓；小鼓在 snare 上鼓皮起漣漪；
//    腳踏鈸在 hat 上合一下；吊鈸在每四小節的第一拍（與高能量段落的小節線）被敲、整片晃好幾下慢慢停；疊音鈸每拍輕輕一晃；
//    落地鼓在每四小節最後兩拍來一段過門。全部用分析出來的 onset，不是固定節奏。
//  - 畫面的焦點＝主打留言：印在大鼓的前鼓皮上（思源宋體，像老樂團在大鼓皮上漆的團名），一拍印一行：
//    每一行在拍點上「啪」地亮起（訊號色）再冷卻成紙白；鼓皮震動時字也跟著微微晃。署名在最後一行下面。
//  - 歌詞（比留言小一級）是燈打在後面布幕上的字：跟著布幕的皺褶一明一暗，逐字跟唱。
//    沒有留言：歌詞印在鼓皮上（主角、逐字跟唱），布幕上是新人的名字與一行小小的邀請。純音樂：布幕上是小小的歌名。
//  - 鏡頭：舞台燈在第一拍「亮」起來，之後整個窗格很慢地推近大鼓；大鼓的每一下讓畫面輕輕一震。
// 手法：整個舞台（布幕、地板、光錐、鼓身的烤漆與鍍鉻、鼓皮的振動、銅鈸的車紋與晃動）都在一個全螢幕 shader 裡用 SDF 畫，
// 鼓皮上的字與布幕上的字各是一張 Canvas 圖層，由 shader 取樣（字跟著鼓皮的波紋與布幕的皺褶一起動）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog } from '../engine/util';
import { lyricAt, beatAfter, drawHeart, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { layoutRows, drawRows, darkInk, type RowsLayout } from './_t4';
import { T23_INVITE, T23_TEXT, sigOf, layMsg, lastBefore, winBeats, winBars, type MsgLay, type Rect } from './_t23';
import type { Line } from '../engine/lyrics';

export const spec: PlateSpecDecl = { group: 'type', family: 'instrument', paper: false, energy: [0.4, 1], bars: [4, 8] };

// ---------------------------------------------------------------- 舞台（畫面座標，y 向下）
const BD = { x: 960, y: 614, r: 360, hoop: 26 };
/** 鼓皮上可以印字的範圍（圓裡面的矩形）。 */
const HEAD_BOX = { x: 660, y: 402, w: 600, h: 428 };
const SN = { x: 432, y: 546, rx: 150, ry: 34, h: 118 };
const FT = { x: 1492, y: 600, rx: 168, ry: 38, h: 300 };
const HH = { x: 205, y: 432, rx: 142, ry: 13 };
const CR = { x: 440, y: 262, rx: 226, ry: 30, a: -0.12 };
const RD = { x: 1530, y: 330, rx: 246, ry: 34, a: 0.1 };
const FLOOR = 1000;
/** 布幕上的歌詞。 */
const LYR = { x: 960, y: 170, w: 1180 };
const FAM_MSG = F.ming(700);
const FAM_LYR = F.archivo(100, 500);
const NROW = 8;

const f1 = (v: number) => v.toFixed(1);

const STAGE = () => new FSPass(/* glsl */ `
  uniform sampler2D uTxt; uniform sampler2D uCur;
  uniform float uZoom; uniform vec2 uPan; uniform float uOn; uniform float uT; uniform float uRaw;
  uniform float kT, sT, hT, cT, rT, fT;   // 距離上一下的秒數
  uniform float kA, sA, cA;               // 那一下的力道
  uniform vec4 rows[${NROW}];             // 鼓皮上每一行字：y0, y1, 出現了沒（0..1）, 剛出現的熱度
  uniform float nrow;

  float ellip(vec2 p, vec2 c, vec2 r) { return length((p - c) / r); }
  // 圓柱的明暗（u = -1..1 橫過鼓身）：中間亮、兩邊暗，偏左一道高光
  float cyl(float u) { return 0.3 + 0.7 * sqrt(max(0.0, 1.0 - u * u)); }
  float streak(float u, float at, float w) { return exp(-pow((u - at) / w, 2.0)); }
  // 鍍鉻：暗暗的環境、幾道很亮很細的反光（舞台燈）
  vec3 chrome(float u) { return C_BONE * (0.05 + 0.12 * cyl(u) + 0.95 * streak(u, -0.45, 0.05) + 0.25 * streak(u, -0.1, 0.04) + 0.35 * streak(u, 0.62, 0.06)) + C_SIGNAL * 0.04 * streak(u, 0.3, 0.3); }
  // 舞台燈：一盞頂燈照在鼓組中間（兩邊慢慢暗下去），外加後面一盞訊號色的逆光
  float spot(vec2 p) { return exp(-pow((p.x - 960.0) / (520.0 + 0.25 * p.y), 2.0)) * (0.55 + 0.45 * smoothstep(1050.0, 250.0, p.y)); }
  float seg(vec2 p, vec2 a, vec2 b) { return sdSegment(p, a, b); }
  vec4 layer(sampler2D s, vec2 q) { return fastLayer(texture(s, vec2(q.x / ${W}.0, 1.0 - q.y / ${H}.0))); }

  // 一片銅鈸：c 中心、r 半徑、a 角度；wob = 晃的角度、sq = 上下壓扁的比例（晃的時候變）、glint = 被敲的亮
  vec4 cymbal(vec2 p, vec2 c, vec2 r, float a, float wob, float sq, float glint) {
    vec2 q = rot2(-(a + wob)) * (p - c);
    q.y /= max(0.25, sq);
    float d = length(q / r);
    if (d > 1.02) return vec4(0.0);
    float aa = 1.0 - smoothstep(0.985, 1.02, d);
    float rr = d;
    // 銅色：主題色只帶一點（薰衣草、鼠尾草的鈸不要變成紫的綠的塑膠）
    vec3 bronze = mix(C_ASH * 0.8, mix(C_BLOOD, C_SIGNAL, 0.3), 0.45) * 0.2;
    float lathe = 0.93 + 0.07 * sin(rr * 160.0);
    float bell = 1.0 - smoothstep(0.13, 0.19, rr);
    // 舞台燈在銅鈸上的反光：一道窄的亮帶（跟著晃動的角度走）、上緣一條逆光
    float hl = exp(-pow((q.x / r.x + 0.3 + 2.2 * wob) / 0.09, 2.0)) * (0.3 + 0.7 * (1.0 - rr));
    vec3 col = bronze * lathe * (0.55 + 0.45 * (q.y / r.y + 1.0) * 0.5);
    col += mix(C_SIGNAL, C_EMBER, 0.5) * (0.5 * hl + bell * 0.08);
    col += mix(C_SIGNAL, C_EMBER, 0.4) * 0.35 * smoothstep(0.93, 1.0, rr) * step(q.y, 0.0);
    col += mix(C_SIGNAL, C_EMBER, 0.6) * glint * (0.5 + 2.0 * hl);
    return vec4(col, aa);
  }

  // 一顆從上面看得到鼓皮的鼓（小鼓、落地鼓）：鼓身（圓柱）＋上面的鼓皮（橢圓）＋鍍鉻的鼓框；tau = 距離上一下
  vec4 drum(vec2 p, vec2 c, vec2 r, float h, float tau, float amp, float metal, vec3 lac) {
    float u = (p.x - c.x) / r.x;
    vec4 o = vec4(0.0);
    // 鼓身
    float yb = c.y + h + r.y * sqrt(max(0.0, 1.0 - u * u));
    float yt = c.y + r.y * sqrt(max(0.0, 1.0 - u * u));
    if (abs(u) <= 1.0 && p.y >= c.y && p.y <= yb) {
      vec3 sh = metal > 0.5 ? chrome(u) * (0.7 + 0.3 * smoothstep(yb, c.y, p.y)) : lac * cyl(u) * (0.55 + 0.45 * smoothstep(yb, c.y, p.y)) + C_BONE * (0.16 * streak(u, -0.42, 0.05) + 0.05 * streak(u, 0.55, 0.1));
      // 鍍鉻的耳朵（鼓身上一根根直的）
      for (int k = 0; k < 8; k++) {
        float ph = (float(k) + 0.5) / 8.0 * TAU;
        float ux = sin(ph);
        if (cos(ph) < 0.0) continue;
        float lx = c.x + ux * r.x * 0.97;
        float ly0 = c.y + h * 0.25, ly1 = c.y + h * 0.75;
        float dd = sdBox(p - vec2(lx, (ly0 + ly1) * 0.5), vec2(5.0 * sqrt(max(0.1, 1.0 - ux * ux)), (ly1 - ly0) * 0.5)) ;
        sh = mix(sh, chrome((p.x - lx) / 6.0), 1.0 - smoothstep(-0.5, 0.8, dd));
      }
      // 上下兩圈鼓框
      float band = step(p.y, yt + 10.0) + step(yb - 9.0, p.y);
      sh = mix(sh, chrome(u), clamp(band, 0.0, 1.0));
      float aa = (1.0 - smoothstep(0.985, 1.0, abs(u)));
      o = vec4(sh, aa);
    }
    // 鼓皮（橢圓）：打的時候一圈圈漣漪往外走
    float e = ellip(p, c, r);
    if (e < 1.0) {
      // 一圈往外跑的波（打下去的那一刻從中間出發，0.3 秒跑到鼓框）
      float fr = tau * 3.4;
      float rip = exp(-tau / 0.2) * amp * (exp(-pow((e - fr) / 0.07, 2.0)) - 0.6 * exp(-pow((e - fr + 0.13) / 0.07, 2.0)));
      vec3 head = mix(C_BONE, C_PAPER, 0.4) * (0.26 + 0.14 * (1.0 - e)) * (1.0 + 0.5 * rip) + C_BONE * 0.2 * exp(-tau / 0.06) * amp;
      float rim = smoothstep(0.86, 0.93, e);
      head = mix(head, chrome((p.x - c.x) / r.x) * 1.1, rim);
      o = vec4(head, 1.0 - smoothstep(0.985, 1.0, e));
    }
    return o;
  }

  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = vec2(960.0, 560.0) + (sp - vec2(960.0, 560.0)) / uZoom + uPan;
    // 大鼓一下：整顆鼓（連前鼓皮）往前一頓，畫面上是鼓的座標縮一點點
    float thump = exp(-kT / 0.09) * kA;

    // ---- 布幕：直的皺褶，舞台燈的光錐從上面打下來
    float fold = sin(p.x * 0.028 + 0.9 * sin(p.x * 0.0061 + 1.3)) * 0.5 + 0.5;
    float fold2 = sin(p.x * 0.071 + 2.0) * 0.5 + 0.5;
    float cone = exp(-pow((p.x - 960.0) / (330.0 + 0.55 * p.y), 2.0));
    float fshade = 0.15 + 0.7 * pow(fold, 1.6) + 0.15 * fold2;
    vec3 cur = mix(C_INK2, C_BLOOD * 0.3, 0.3) * fshade;
    vec3 col = cur * (0.05 + 0.34 * cone * uOn);
    // 後面一盞訊號色的逆光：鼓組後面一團暖暖的光暈（打在布幕的皺褶上）
    col += mix(C_BLOOD, C_SIGNAL, 0.5) * 0.04 * exp(-pow(length((p - vec2(960.0, 660.0)) / vec2(760.0, 460.0)), 2.0)) * uOn * fshade;
    // 兩道斜斜的舞台光束（煙裡看得到），從上面兩個角打向鼓組
    for (int k = 0; k < 2; k++) {
      float sx = float(k) * 2.0 - 1.0;
      vec2 o = vec2(960.0 + sx * 1100.0, -200.0), dd = normalize(vec2(960.0 - sx * 120.0, 900.0) - o);
      vec2 rel = p - o;
      float along = dot(rel, dd), across = abs(rel.x * dd.y - rel.y * dd.x);
      float beam = exp(-pow(across / (40.0 + along * 0.12), 2.0)) * smoothstep(0.0, 600.0, along);
      col += mix(C_SIGNAL, C_BONE, 0.3) * 0.028 * beam * uOn * (0.8 + 0.2 * snoise(p * 0.004 + vec2(uT * 0.05, 0.0)));
    }
    // 布幕上的字（燈打上去的）：跟著皺褶一明一暗
    vec4 L = layer(uCur, p);
    col = col * (1.0 - L.a * 0.6) + L.rgb * (0.62 + 0.4 * fold) * uOn;
    // 空氣裡的光錐（很淡的煙）
    col += C_BONE * 0.018 * cone * uOn * (1.0 - smoothstep(200.0, 1000.0, p.y) * 0.5);
    // 地板：鼓墊與舞台燈的光圈
    if (p.y > ${FLOOR}.0 - 4.0) {
      float pool = exp(-pow(length((p - vec2(960.0, 1030.0)) / vec2(900.0, 70.0)), 2.0));
      vec3 fl = C_INK2 * (0.5 + 0.2 * snoise(p * vec2(0.004, 0.05))) * (0.3 + 1.1 * pool * uOn);
      col = mix(col, fl, smoothstep(${FLOOR}.0 - 4.0, ${FLOOR}.0 + 2.0, p.y));
    }
    // 鼓在地上的影子
    col *= 1.0 - 0.55 * exp(-pow(length((p - vec2(960.0, 1004.0)) / vec2(560.0, 26.0)), 2.0));

    vec3 lac = mix(C_BLOOD, C_SIGNAL, 0.15) * 0.3;
    float lit = 0.35 + 0.75 * spot(p);

    // ---- 架子（鍍鉻的細管）
    float st = 1e9;
    st = min(st, seg(p, vec2(${CR.x}.0, ${CR.y + 20}.0), vec2(${CR.x - 40}.0, 990.0)) - 3.2);
    st = min(st, seg(p, vec2(${RD.x}.0, ${RD.y + 20}.0), vec2(${RD.x + 60}.0, 990.0)) - 3.2);
    st = min(st, seg(p, vec2(${HH.x}.0, ${HH.y - 40}.0), vec2(${HH.x}.0, 990.0)) - 3.0);
    for (int k = 0; k < 3; k++) {
      float sx = float(k - 1);
      st = min(st, seg(p, vec2(${CR.x - 40}.0 + sx * 6.0, 900.0), vec2(${CR.x - 40}.0 + sx * 70.0, 1000.0)) - 2.5);
      st = min(st, seg(p, vec2(${RD.x + 60}.0 + sx * 6.0, 900.0), vec2(${RD.x + 60}.0 + sx * 70.0, 1000.0)) - 2.5);
      st = min(st, seg(p, vec2(${HH.x}.0 + sx * 5.0, 880.0), vec2(${HH.x}.0 + sx * 80.0, 1000.0)) - 2.5);
      st = min(st, seg(p, vec2(${SN.x}.0 + sx * 5.0, ${SN.y + SN.h + 30}.0), vec2(${SN.x}.0 + sx * 90.0, 1000.0)) - 2.5);
    }
    st = min(st, seg(p, vec2(${SN.x}.0, ${SN.y + SN.h}.0), vec2(${SN.x}.0, ${SN.y + SN.h + 34}.0)) - 3.0);
    for (int k = 0; k < 2; k++) {
      float sx = float(k) * 2.0 - 1.0;
      st = min(st, seg(p, vec2(${FT.x}.0 + sx * ${FT.rx - 22}.0, ${FT.y + 60}.0), vec2(${FT.x}.0 + sx * ${FT.rx + 10}.0, 1000.0)) - 3.0);
    }
    if (st < 1.0) col = mix(chrome(clamp(st / 3.2, -1.0, 1.0) - 0.2) * lit, col, smoothstep(-0.8, 0.8, st));

    // ---- 銅鈸：吊鈸（左上）、疊音鈸（右上）、腳踏鈸（左，上下兩片）
    float cw = cA * exp(-cT / 0.9) * sin(cT * 17.0) * 0.16;
    float csq = 1.0 + cA * exp(-cT / 0.9) * sin(cT * 13.0 + 1.0) * 0.9;
    vec4 c1 = cymbal(p, vec2(${CR.x}.0, ${CR.y}.0), vec2(${CR.rx}.0, ${CR.ry}.0), ${f1(CR.a)}, cw, csq, cA * exp(-cT / 0.25));
    col = mix(col, c1.rgb * lit, c1.a);
    float rw = exp(-rT / 0.5) * sin(rT * 15.0) * 0.035;
    vec4 c2 = cymbal(p, vec2(${RD.x}.0, ${RD.y}.0), vec2(${RD.rx}.0, ${RD.ry}.0), ${f1(RD.a)}, rw, 1.0 + rw * 3.0, 0.4 * exp(-rT / 0.12));
    col = mix(col, c2.rgb * lit, c2.a);
    float hc = exp(-hT / 0.07);
    vec4 h2 = cymbal(p, vec2(${HH.x}.0, ${HH.y + 16}.0), vec2(${HH.rx}.0, ${HH.ry}.0), 0.0, 0.0, 1.0, 0.0);
    col = mix(col, h2.rgb * lit, h2.a);
    vec4 h1 = cymbal(p, vec2(${HH.x}.0, ${HH.y}.0 + 10.0 * hc), vec2(${HH.rx}.0, ${HH.ry}.0), 0.0, 0.0, 1.0, 0.5 * hc);
    col = mix(col, h1.rgb * lit, h1.a);

    // ---- 小鼓（鍍鉻的鼓身）與落地鼓（烤漆）
    vec4 sn = drum(p, vec2(${SN.x}.0, ${SN.y}.0 + 3.0 * exp(-sT / 0.06) * sA), vec2(${SN.rx}.0, ${SN.ry}.0), ${SN.h}.0, sT, sA, 1.0, lac);
    col = mix(col, sn.rgb * lit, sn.a);
    vec4 ft = drum(p, vec2(${FT.x}.0, ${FT.y}.0 + 2.0 * exp(-fT / 0.07)), vec2(${FT.rx}.0, ${FT.ry}.0), ${FT.h}.0, fT, 1.0, 0.0, lac);
    col = mix(col, ft.rgb * lit, ft.a);

    // ---- 大鼓：正面，鼓框（烤漆＋鍍鉻的鼓爪）＋黑色前鼓皮＋印在上面的字
    vec2 bc = vec2(${BD.x}.0, ${BD.y}.0);
    vec2 bq = bc + (p - bc) / (1.0 + 0.012 * thump);
    float r = length(bq - bc);
    float R = ${BD.r}.0, HO = ${BD.hoop}.0;
    // 鼓爪（10 個，鼓框外面一圈）
    float ang = atan(bq.y - bc.y, bq.x - bc.x);
    float sect = TAU / 10.0;
    float a0 = mod(ang + sect * 0.5 + 0.3, sect) - sect * 0.5;
    vec2 lp = vec2(r - (R + HO + 6.0), a0 * r);
    float claw = sdBox(lp, vec2(14.0, 9.0)) - 2.0;
    if (claw < 1.0) col = mix(chrome(lp.y / 11.0) * lit, col, smoothstep(-0.8, 0.8, claw));
    if (r < R + HO + 1.0) {
      // 鼓框：烤漆的木框，中間一條鍍鉻的鑲線
      float t2 = (r - R) / HO;
      vec3 hoop = lac * (0.7 + 0.5 * sin(t2 * 3.14159)) + C_BONE * 0.14 * exp(-pow((ang + 2.2) / 0.5, 2.0));
      hoop = mix(hoop, chrome(t2 * 2.0 - 1.0), 1.0 - smoothstep(0.08, 0.16, abs(t2 - 0.5)));
      vec3 hc2 = hoop * lit;
      // 前鼓皮：黑色，燈打出一團柔的反光；被踩的時候一圈波紋往外跑
      float e = r / R;
      float fr = kT * 3.0;
      float rip = kA * exp(-kT / 0.25) * (exp(-pow((e - fr) / 0.06, 2.0)) - 0.6 * exp(-pow((e - fr + 0.12) / 0.06, 2.0)));
      vec3 head = C_INK * 0.9 + C_INK2 * 0.5 * (1.0 - e * 0.5);
      head += C_BONE * 0.035 * exp(-pow(length((bq - bc - vec2(-150.0, -170.0)) / vec2(230.0, 170.0)), 2.0)) * (1.0 + 0.8 * rip);
      head += C_BONE * 0.006 * rip;
      // 字：沿著半徑被波紋推一點點
      vec2 dir = (bq - bc) / max(r, 1.0);
      vec2 tq = bq - dir * 2.5 * rip;
      vec4 tx = layer(uTxt, tq);
      if (tx.a > 0.0) {
        float rev = 1.0, heat = 0.0;
        for (int i = 0; i < ${NROW}; i++) {
          if (float(i) >= nrow) break;
          vec4 rw = rows[i];
          if (tq.y >= rw.x && tq.y < rw.y) { rev = rw.z; heat = rw.w; }
        }
        // 白字＝印刷的紙白；紅＝愛心（點綴色）；剛印上去的一行是訊號色（燒紅）再冷卻
        float heart = clamp((tx.r - tx.g) / max(tx.a, 1e-3), 0.0, 1.0);
        vec3 ink = mix(C_BONE * 0.86, C_ROSE * 0.8, heart);
        ink = mix(ink, mix(C_SIGNAL, C_EMBER, 0.4) * 2.2, heat * (1.0 - heart));
        // 沒有留言時鼓皮上是跟唱的歌詞：直接用圖層自己的顏色
        if (uRaw > 0.5) ink = tx.rgb / max(tx.a, 1e-3);
        head = mix(head, ink, tx.a * rev);
      }
      head *= 0.9 + 0.1 * uOn;
      col = mix(head, hc2, smoothstep(R - 1.0, R + 1.0, r));
      col = mix(col, col * 0.5, smoothstep(R + HO - 2.0, R + HO + 1.0, r));
    }
    // 舞台燈還沒亮的時候整體暗
    col *= 0.25 + 0.75 * uOn;
    fragColor = vec4(col, 1.0);
  }`, {
  uTxt: { value: null }, uCur: { value: null }, uRaw: { value: 0 }, uZoom: { value: 1 }, uPan: { value: new THREE.Vector2() }, uOn: { value: 1 }, uT: { value: 0 },
  kT: { value: 9 }, sT: { value: 9 }, hT: { value: 9 }, cT: { value: 9 }, rT: { value: 9 }, fT: { value: 9 },
  kA: { value: 1 }, sA: { value: 1 }, cA: { value: 1 },
  rows: { value: Array.from({ length: NROW }, () => new THREE.Vector4()) }, nrow: { value: 0 },
});

export default class DrumKit extends Scene {
  stage = shared('drumkit.stage', STAGE);
  /** 鼓皮上的字（有留言：init 畫一次；沒留言：每格畫跟唱的歌詞）。 */
  txt = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 布幕上的字（歌詞、名字、邀請）。 */
  cur = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  lay: MsgLay | null = null;
  rowT: number[] = [];
  rowY: [number, number][] = [];
  kicks: [number, number][] = [];
  snares: [number, number][] = [];
  hats: number[] = [];
  crashes: number[] = [];
  rides: number[] = [];
  toms: number[] = [];
  tOn = 0;
  hasLyr = false;
  lyrSize = 56;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const lines = lyrics.linesIn(s - 1, e + 1);
    this.hasLyr = lines.length > 0;
    const sig = m ? sigOf(m) : '';
    await loadText(`${T23_TEXT}${m?.text ?? ''}${sig}${song.title}${lines.map((l) => l.text).join('')}`);
    const beat = au.beatPeriod(s);
    this.tOn = beatAfter(au, s + Math.min(0.15, beat * 0.3));

    // ---- 什麼時候敲什麼（窗格前兩秒也算，切進來時鈸還在晃）
    this.kicks = au.events('kick', s - 2, e);
    this.snares = au.events('snare', s - 2, e);
    this.hats = au.events('hat', s - 2, e).map((x) => x[0]);
    const beats = winBeats(au, s - 2, e), bars = winBars(au, s - 2, e);
    const en = au.energyAt(s);
    // 沒有 onset 資料的歌（或很安靜的段落）：大鼓落在每小節的一、三拍，小鼓在二、四拍
    if (!this.kicks.length) this.kicks = beats.filter((_, i) => i % 2 === 0).map((x) => [x, 0.8]);
    if (!this.snares.length) this.snares = beats.filter((_, i) => i % 2 === 1).map((x) => [x, 0.8]);
    this.crashes = bars.filter((tb) => {
      const b = Math.round(au.barAt(tb));
      return b % 4 === 0 || (en > 0.7 && b % 2 === 0);
    });
    // 切進來的第一個小節線一定敲一下吊鈸（燈亮的那一刻）
    const firstBar = bars.find((x) => x >= s - 0.05);
    if (firstBar !== undefined && !this.crashes.includes(firstBar)) this.crashes.push(firstBar);
    this.crashes.push(this.tOn);
    this.crashes.sort((a, b) => a - b);
    this.rides = en > 0.35 ? beats : beats.filter((_, i) => i % 2 === 0);
    // 過門：每四小節的最後兩拍，落地鼓八分音符
    for (const tb of bars) {
      const b = Math.round(au.barAt(tb));
      if (b % 4 !== 3) continue;
      const bp = (au.timeOfBar(b + 1) - tb) / 4;
      for (let k = 0; k < 4; k++) this.toms.push(tb + bp * 2 + (k * bp) / 2);
    }

    // ---- 鼓皮上的字
    const c = this.txt.ctx;
    if (m) {
      this.lay = layMsg(c, m.text, sig, FAM_MSG, HEAD_BOX, { min: 48, max: 150, lineHeight: 1.22, maxLines: 6, sigFamily: F.ming(400), sigSize: [34, 42], align: 'center' });
      this.lyrSize = Math.max(48, Math.min(56, Math.round(this.lay.fit.size * 0.72)));
      this.drawHeadText();
      // 一拍印一行（行多就半拍一行），署名跟在最後一行後面半拍
      const n = this.lay.lines.length;
      const per = n > 4 ? 0.5 : 1;
      for (let i = 0; i < n; i++) this.rowT.push(au.timeOfBeat(au.beatAt(this.tOn) + i * per));
      this.rowT.push(au.timeOfBeat(au.beatAt(this.tOn) + (n - 1) * per + 1));
      const lay = this.lay;
      lay.lines.forEach((ln, i) => this.rowY.push([ln.y - lay.fit.size * 0.95, ln.y + lay.fit.size * 0.3 + (i === n - 1 ? 0 : 0)]));
      this.rowY.push([lay.sig.y - lay.sig.size * 1.0, lay.sig.y + lay.sig.size * 0.4]);
    }
    this.avoid = [[BD.x - BD.r, BD.y - BD.r, BD.r * 2, BD.r * 2], [LYR.x - LYR.w / 2, LYR.y - 70, LYR.w, 100]];
  }

  /** 留言印在鼓皮上：白字（紙白）、愛心畫紅色（shader 用紅綠通道的差分辨）。 */
  private drawHeadText() {
    const L = this.txt, c = L.ctx, lay = this.lay!;
    L.clear();
    c.textBaseline = 'alphabetic';
    c.fillStyle = 'rgb(255,255,255)';
    c.font = font(lay.family, lay.fit.size);
    for (const g of lay.glyphs) {
      if (g.row < 0) continue;
      if (g.ch === '♥') { drawHeart(c, g.x + g.w / 2, g.y - g.size * 0.36, Math.min(g.w, g.size * 0.8) * 0.92, 'rgb(255,0,0)'); continue; }
      c.fillText(g.ch, g.x, g.y);
    }
    c.font = font(lay.sig.family, lay.sig.size);
    c.fillText(lay.sig.text, lay.sig.x, lay.sig.y);
    L.upload();
  }

  private layLine(c: CanvasRenderingContext2D, line: Line, big: boolean): RowsLayout {
    return big
      ? layoutRows(c, line, { family: F.archivo(100, 800), size: 104, minSize: 64, maxW: HEAD_BOX.w + 40, maxRows: 3, align: 'center', lineHeight: 1.1 })
      : layoutRows(c, line, { family: FAM_LYR, size: this.lyrSize, minSize: 48, maxW: LYR.w, maxRows: 1, align: 'center' });
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, lyrics, audio: au, song } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const u = this.stage.u;
    // ---- 誰剛被敲
    const last = (ev: [number, number][]) => { let r: [number, number] = [-99, 0]; for (const x of ev) { if (x[0] <= t) r = x; else break; } return r; };
    const k = last(this.kicks), sn = last(this.snares);
    u.kT!.value = t - k[0]; u.kA!.value = clamp(0.5 + k[1]);
    u.sT!.value = t - sn[0]; u.sA!.value = clamp(0.5 + sn[1]);
    u.hT!.value = t - lastBefore(this.hats, t);
    u.cT!.value = t - lastBefore(this.crashes, t); u.cA!.value = 1;
    u.rT!.value = t - lastBefore(this.rides, t);
    u.fT!.value = t - lastBefore(this.toms, t);
    for (const key of ['kT', 'sT', 'hT', 'cT', 'rT', 'fT']) u[key]!.value = Math.min(99, u[key]!.value as number);
    // ---- 燈在第一拍亮起來
    const on = 0.2 + 0.8 * ease.outExpo(prog(t, this.tOn - 0.02, this.tOn + 0.25));
    u.uOn!.value = on;
    // ---- 鏡頭：很慢地推近大鼓
    const drift = ease.inOutQuad(clamp((t - s) / Math.max(1, e - s)));
    u.uZoom!.value = 1 + 0.045 * drift;
    (u.uPan!.value as THREE.Vector2).set(0, 20 * drift);
    // ---- 鼓皮上的字：每一行印上去了沒、熱度
    const rows = u.rows!.value as THREE.Vector4[];
    const m = this.msg;
    if (m && this.lay) {
      u.nrow!.value = Math.min(NROW, this.rowY.length);
      for (let i = 0; i < Math.min(NROW, this.rowY.length); i++) {
        const ta = this.rowT[i]!, y = this.rowY[i]!;
        const rev = ease.outExpo(prog(t, ta - 0.01, ta + 0.08));
        const heat = t < ta ? 0 : Math.exp(-(t - ta) / 0.35);
        rows[i]!.set(y[0], y[1], rev, heat);
      }
    } else {
      u.nrow!.value = 0;
      // 沒有留言：鼓皮上印的是正在唱的歌詞
      const L = this.txt, c = L.ctx;
      L.clear();
      const ly = lyricAt(lyrics, t);
      // 鼓皮上面一圈像團名一樣印著新人的名字（小），中間是正在唱的歌詞（主角）
      c.font = font(F.ming(700), 40); c.fillStyle = rgba('bone', 0.55); c.textAlign = 'center'; c.letterSpacing = '6px';
      c.fillText(COUPLE_ZH, BD.x, BD.y - BD.r + 92);
      c.font = font(F.mono(500), 18); c.letterSpacing = '5px'; c.fillStyle = rgba('bone', 0.35);
      c.fillText(DATE_DOTS, BD.x, BD.y + BD.r - 64);
      c.letterSpacing = '0px'; c.textAlign = 'left';
      if (ly && this.hasLyr) {
        const lay = this.layLine(c, ly.line, true);
        c.save(); c.translate(BD.x, BD.y - lay.height / 2 + lay.size * 0.72);
        drawRows(c, lay, F.archivo(100, 800), t, { ...darkInk(), sung: rgba('bone', 0.9) }, ly.k);
        c.restore();
      }
      L.upload();
    }
    // ---- 布幕上的字
    const C2 = this.cur, cc = C2.ctx;
    C2.clear();
    const ink = darkInk();
    if (m) {
      const ly = this.hasLyr ? lyricAt(lyrics, t) : null;
      if (ly) {
        const lay = this.layLine(cc, ly.line, false);
        cc.save(); cc.translate(LYR.x, LYR.y); drawRows(cc, lay, FAM_LYR, t, ink, ly.k); cc.restore();
      } else if (!this.hasLyr) {
        cc.font = font(F.mono(500), 20); cc.fillStyle = rgba('ash', 0.7); cc.letterSpacing = '4px'; cc.textAlign = 'center';
        cc.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`, LYR.x, LYR.y - 20);
        cc.letterSpacing = '0px'; cc.textAlign = 'left';
      }
    } else {
      cc.textAlign = 'center';
      cc.font = font(F.hei(500), 22); cc.fillStyle = rgba('ash', 0.75); cc.letterSpacing = '3px';
      cc.fillText(T23_INVITE, LYR.x, LYR.y - 10);
      cc.letterSpacing = '0px'; cc.textAlign = 'left';
    }
    C2.upload();
    u.uTxt!.value = this.txt.texture;
    u.uRaw!.value = m ? 0 : 1;
    u.uCur!.value = this.cur.texture;
    u.uT!.value = t;
    this.stage.render(renderer, out);
    void au;
    const thump = Math.exp(-(t - k[0]) / 0.09);
    return { bloom: 0.8, vignette: 0.55, halation: 0.3, zoom: 1 + 0.006 * thump * on, shake: [0, 1.5 * thump * on], popupAvoid: this.avoid };
  }
}
