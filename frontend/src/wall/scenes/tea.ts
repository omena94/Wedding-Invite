// 奉茶（亮）：從上面俯拍的茶席——淺色木桌上一只竹茶盤，盤上一只白瓷杯、兩只倒好茶的小品茗杯、一把紫砂壺（線條畫的）；
// 右邊一張手抄紙的小箋，左下一張茶籤。
//  - 小節線上奉茶：茶壺滑過來、壺身一傾，一道茶倒進杯裡（漣漪從落點一圈圈散開），杯底的乾茶葉被沖得轉起來，
//    轉慢之後一片片沉到杯底，排成一顆愛心；小箋角落一行冷面的小字「茶葉占卜：大吉」。
//  - 主打留言用毛筆寫在小箋上：從第一拍起一個字一個字寫出來（筆順方向斜斜掃過、墨還濕的時候邊緣暈一點），署名在最後一行下面。
//  - 歌詞印在茶籤上（逐字跟唱，比留言小一級）。
//  - 沒有留言：小箋上是正在唱的歌詞（焦點），茶籤上是邀請；純音樂又沒有留言：小箋上寫邀請，茶籤上是歌名。
// v2（「留言尺寸與版面比例標準 v2」）：原本半個畫面大的杯墊縮成右邊一張 820×400 的小箋（字 40～60 px、署名 26～32、
// 歌詞 40～52）；空出來的左半邊是茶盤（深色木框、一條條竹片、片與片之間濕濕的縫），而且照拍子一直有事：
//  - 每一拍：三只杯子的茶湯從中間漾出一圈漣漪（音樂把桌子震得微微晃）；
//  - 倒完茶之後每個小節線：擱回去的壺嘴滴下一滴茶，在茶盤的竹片上濺開一圈；熱氣照小節線冒一陣；
//  - 鏡頭：切進來貼近杯子，第一拍拉開，之後慢慢推近、往小箋那邊移一點。
// 手法：一個全螢幕 shader（_t14 的 PlaneCam：桌面是一張平面，鏡頭有一點俯角、會推會搖；木紋、茶盤、手抄紙的毛邊、瓷杯、茶湯、
// 漣漪、茶葉〔uniform 陣列〕、熱氣都在這裡算），留言是 _t14 的「依序出現」字模；茶壺與茶籤上的字是兩張 Canvas 圖層（變了才重畫）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp, pulse, TAU } from '../engine/util';
import { fitText } from '../engine/text';
import { heartPoints, lyricSubOf, layoutLyric, subStyleFor, subGap, drawLyricSub, type LyricStyle } from './_motifs';
import { grid, stagger, layoutRows, drawRows, paperInk } from './_t4';
import { PlaneCam, camUniforms, CAM_GLSL, orderMask, lineItems, msgBlockV2, INVITE, type OrderMask, type MsgBlock, type MaskItem } from './_t14';
import { shownLyric, type Rect } from './_t24';
import { V2, lyricV2, fitClauses } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'local', paper: true, energy: [0.15, 0.7], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 茶席（頁面座標，y 向下）
/** 竹茶盤（左半邊）。 */
const TRAY = { x0: 92, y0: 96, x1: 990, y1: 832 };
const CUP = { x: 620, y: 560, r: 190, liq: 164 };
/** 兩只小品茗杯（已經倒好茶）。 */
const SC1 = { x: 292, y: 668, r: 70 }, SC2 = { x: 884, y: 236, r: 64 };
/** 小箋（手抄紙）：最大的時候的中心、半寬半高、轉角；留言寫在裡面的框（v2：整張 ≤ 860×430）。
 *  有留言時紙跟著留言裁小（只比字多一點邊），整塊在框裡左右置中。 */
const MAT = { x: 1438, y: 432, hw: 410, hh: 200, rot: 0.018 };
const BOX = { x: 1066, y: 268, w: 748, h: 322 };
/** 茶籤：左下角一條長紙，歌詞（或邀請）印在上面。 */
const TAG = { x: 120, y: 874, w: 1000, h: 92, rot: -0.012 };
/** 茶壺：休息的位置（壺嘴朝右，不在杯子上面）、倒茶時落點（杯子裡）。 */
const POT0 = { x: 300, y: 236, rot: 0.2 };
const IMPACT = { x: 575, y: 485 };
/** 壺嘴離壺身中心多遠（壺的座標）。 */
const SPOUT = 262;
const NL = 24, MAXC = 80;
const FAM = F.hand(700), FAM_SIG = F.hand(400);
const FAM_LYR = F.archivo(100, 800);
const FORTUNE = '＊茶葉占卜：大吉';
const MS = 0.5;

const BG = () => new FSPass(/* glsl */ `
  ${CAM_GLSL}
  uniform float t;
  uniform sampler2D mask; uniform vec4 mR; uniform float hasMask; uniform vec2 cI[${MAXC}];
  uniform sampler2D page; uniform sampler2D pot;
  uniform vec4 leaves[${NL}];  // x、y、角度、深度（0 = 浮在上面、1 = 沉在杯底）
  uniform float fill;          // 茶湯的量 0..1
  uniform vec4 pour;           // 落點 x、y、倒下去之後幾秒、正在倒（0..1）
  uniform vec2 bAge;           // 最近兩拍過了幾秒（茶湯上一圈圈的漣漪）
  uniform vec4 drip;           // 壺嘴滴下來的茶：落點 x、y、落下之後幾秒、在不在
  uniform float steam;         // 熱氣的量（剛倒完、小節線上多一點）
  uniform vec4 matR;           // 小箋：中心 x、y、半寬、半高（跟著留言的大小裁，只比字多一點邊）
  const vec2 CUPC = vec2(${CUP.x}.0, ${CUP.y}.0);
  vec3 teaCol() { return C_SIGNAL * 0.42 + C_BLOOD * 0.55; }
  float rbox(vec2 p, vec2 a, vec2 b, float r) { vec2 c = (a + b) * 0.5, h = (b - a) * 0.5; return sdBox(p - c, h - r) - r; }
  // 毛筆字：寫了多少（依序出現的字模）
  vec2 written(vec2 q) {
    vec2 mu = (q - mR.xy) / mR.zw;
    if (hasMask < 0.5 || mu.x < 0.0 || mu.y < 0.0 || mu.x > 1.0 || mu.y > 1.0) return vec2(0.0);
    vec4 m = texture(mask, mu);
    if (m.a < 0.01) return vec2(0.0);
    int i = min(int(floor(m.g * 255.0 + 0.5)), ${MAXC - 1});
    vec2 ci = cI[i];
    float k = sat((t - ci.x - m.b * ci.y) / 0.05);
    return vec2(m.a * k, step(0.5, m.r));
  }
  // 手抄紙的毛邊：矩形的距離場加一點雜訊
  float paperSD(vec2 P, vec2 c, vec2 hs, float rot, float seed) {
    vec2 q = rot2(-rot) * (P - c);
    float d = sdBox(q, hs);
    return d + 3.0 * snoise(q / 9.0 + seed) + 1.5 * snoise(q / 2.5 + seed);
  }
  // 拍點的漣漪：從杯子中心往外的一圈（最近兩拍疊在一起），d = 到中心的距離
  float beatRipple(float d) {
    float w = 0.0;
    for (int k = 0; k < 2; k++) {
      float a = k == 0 ? bAge.x : bAge.y;
      float rr = a * 150.0;
      w += sin((d - rr) * 0.3) * exp(-pow((d - rr) / 12.0, 2.0)) * exp(-a * 2.4);
    }
    return w;
  }
  // 小品茗杯（白瓷、倒好了茶）：rgb 顏色、a 覆蓋率
  vec4 smallCup(vec2 P, vec2 c, float r) {
    vec2 q = P - c; float d = length(q);
    if (d > r + 1.0) return vec4(0.0);
    vec3 por = mix(C_BONE, C_PAPER, 0.3);
    float liq = r * 0.8;
    vec3 col;
    if (d > liq) {
      float rim = (d - liq) / (r - liq);
      col = por * (0.82 + 0.18 * sin(rim * PI)) * (0.94 + 0.08 * dot(normalize(q + 1e-3), vec2(-0.6, -0.8)) * (1.0 - rim));
    } else {
      float u = d / liq;
      vec3 base = por * (0.86 + 0.08 * u);
      col = mix(base, base * teaCol() * 1.2 + teaCol() * 0.15, 0.85);
      float w = beatRipple(d * 2.2);
      col += C_BONE * (0.2 * exp(-pow(length((q - vec2(-r * 0.22, -r * 0.28) + w * 2.0) / vec2(r * 0.28, r * 0.18)), 4.0)) + 0.06 * w);
    }
    col *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 1.5, abs(d - r + 0.8))) - 0.15 * (1.0 - smoothstep(0.0, 1.2, abs(d - liq)));
    return vec4(col, 1.0 - smoothstep(r - 1.0, r + 0.5, d));
  }
  void main() {
    vec2 sp = SP();
    vec2 P = pcHit(sp, 0.0).xy;
    // ---- 木桌：淺色，木紋橫向，窗光從左上來
    float g = fbm(vec2(P.x / 1500.0, P.y / 90.0), 3);
    float ring = sin((P.y + 140.0 * g) / 9.0);
    vec3 col = mix(C_PAPER, C_SEPIA, 0.3 + 0.035 * ring * (0.5 + 0.5 * g) + 0.05 * g + 0.012 * snoise(vec2(P.x / 50.0, P.y / 3.0))) + C_BLOOD * 0.02;
    // 木板的接縫
    float seam = 180.0 - abs(mod(P.y + 60.0, 360.0) - 180.0);
    col *= 1.0 - 0.12 * (1.0 - smoothstep(0.5, 2.0, seam));
    float light = 0.9 + 0.12 * exp(-length((P - vec2(300.0, 100.0)) / vec2(1400.0, 1000.0)));
    col *= light;
    // ---- 竹茶盤：深色木框，裡面一條條竹片（橫的、隔一段一道竹節），片與片之間的縫是濕的（暗，偶爾一點水光）
    vec2 TA = vec2(${TRAY.x0}.0, ${TRAY.y0}.0), TB = vec2(${TRAY.x1}.0, ${TRAY.y1}.0);
    col *= 1.0 - 0.24 * (1.0 - smoothstep(0.0, 34.0, rbox(P - vec2(14.0, 18.0), TA, TB, 26.0)));
    float trd = rbox(P, TA, TB, 26.0);
    if (trd < 1.0) {
      float gr = fbm(vec2(P.x / 400.0, P.y / 30.0), 2);
      vec3 wood = mix(mix(C_SEPIA, C_BLOOD, 0.2), C_GRAPHITE, 0.3) * (0.7 + 0.08 * gr + 0.04 * sin(P.x / 7.0 + 6.0 * gr));
      wood *= 1.0 + 0.14 * (1.0 - smoothstep(0.0, 3.0, -trd));
      float inner = -trd - 36.0;
      vec3 c;
      if (inner < 0.0) {
        // 框：靠竹片那一側有一道斜面（暗一點）
        c = wood * (1.0 - 0.22 * (1.0 - smoothstep(0.0, 6.0, -inner)));
      } else {
        float row = floor((P.y - TA.y - 36.0) / 34.0);
        float sy = mod(P.y - TA.y - 36.0, 34.0);
        float s01 = sat((sy - 5.0) / 29.0);
        vec3 bam = mix(C_PAPER, mix(C_SEPIA, C_BLOOD, 0.3), 0.3) * (0.84 + 0.12 * sin(s01 * PI)) * (0.95 + 0.05 * snoise(vec2(P.x / 90.0, row * 3.1)));
        float node = 1.0 - smoothstep(0.8, 2.0, abs(mod(P.x + 97.0 * row, 230.0) - 115.0));
        bam *= 1.0 - 0.1 * node * step(4.0, sy);
        // 竹片是圓的：上緣一道亮邊
        bam += C_BONE * 0.08 * (1.0 - smoothstep(0.0, 2.5, abs(sy - 7.0)));
        vec3 wet = mix(bam, C_SEPIA * 0.45, 0.6) + C_BONE * 0.25 * pow(max(0.0, snoise(vec2(P.x / 60.0 + t * 0.12, row * 1.7))), 6.0);
        c = mix(bam, wet, 1.0 - smoothstep(2.5, 4.0, sy));
        // 框在竹片上投的一點影子
        c *= 0.78 + 0.22 * smoothstep(0.0, 12.0, inner);
        // 壺嘴滴下來的那一滴：在竹片上濺開一圈
        float dd = length(P - drip.xy);
        float rr = drip.z * 110.0;
        c += C_BONE * 0.35 * drip.w * exp(-pow((dd - rr) / 3.0, 2.0)) * exp(-drip.z * 3.0);
        c = mix(c, C_INK * 0.45, drip.w * (1.0 - smoothstep(4.0, 7.0, dd)) * exp(-drip.z * 1.5));
      }
      col = mix(col, c, 1.0 - smoothstep(-1.0, 1.0, trd));
    }
    // ---- 兩只品茗杯（影子往右下）
    for (int k = 0; k < 2; k++) {
      vec3 sc = k == 0 ? vec3(${SC1.x}.0, ${SC1.y}.0, ${SC1.r}.0) : vec3(${SC2.x}.0, ${SC2.y}.0, ${SC2.r}.0);
      col *= 1.0 - 0.25 * (1.0 - smoothstep(sc.z - 10.0, sc.z + 24.0, length(P - sc.xy - vec2(12.0, 16.0))));
      vec4 cc = smallCup(P, sc.xy, sc.z);
      col = mix(col, cc.rgb, cc.a);
    }
    // ---- 小箋（手抄紙）：影子、紙、毛筆字
    float md = paperSD(P, matR.xy, matR.zw, ${MAT.rot}, 1.0);
    float msh = paperSD(P - vec2(12.0, 16.0), matR.xy, matR.zw, ${MAT.rot}, 1.0);
    col *= 1.0 - 0.2 * (1.0 - smoothstep(-6.0, 24.0, msh));
    if (md < 0.0) {
      vec3 pc = C_PAPER * (0.98 + 0.03 * snoise(P / 60.0) + 0.02 * snoise(vec2(P.x / 3.0, P.y / 14.0)));
      // 纖維：細細的短線
      pc *= 1.0 - 0.03 * smoothstep(0.55, 0.9, snoise(vec2(P.x / 1.5, P.y / 30.0) + 7.0));
      pc *= 1.0 - 0.06 * (1.0 - smoothstep(0.0, 10.0, -md));
      vec2 w = written(P);
      // 墨：濕的時候邊緣暈一點（看旁邊幾點的覆蓋率）
      float halo = 0.25 * (written(P + vec2(2.5, 1.0)).x + written(P - vec2(2.5, 1.0)).x + written(P + vec2(-1.0, 2.5)).x + written(P - vec2(-1.0, 2.5)).x);
      vec3 ink = mix(C_SEPIA * 0.85, C_ROSE * 0.9, w.y);
      pc = mix(pc, mix(pc, ink, 0.25), halo * 0.6);
      pc = mix(pc, ink, w.x);
      vec4 L = fastLayer(texture(page, pageUV(P)));
      pc = pc * (1.0 - L.a) + L.rgb;
      col = mix(col, pc, 1.0 - smoothstep(-1.0, 1.0, md));
    }
    // ---- 茶籤
    float td = paperSD(P, vec2(${TAG.x + TAG.w / 2}.0, ${TAG.y + TAG.h / 2}.0), vec2(${TAG.w / 2}.0, ${TAG.h / 2}.0), ${TAG.rot}, 5.0);
    float tsh = paperSD(P - vec2(8.0, 12.0), vec2(${TAG.x + TAG.w / 2}.0, ${TAG.y + TAG.h / 2}.0), vec2(${TAG.w / 2}.0, ${TAG.h / 2}.0), ${TAG.rot}, 5.0);
    col *= 1.0 - 0.18 * (1.0 - smoothstep(-4.0, 16.0, tsh));
    if (td < 0.0) {
      vec3 tc = mix(C_PAPER, C_BLOOD, 0.08) * (0.97 + 0.03 * snoise(P / 40.0));
      // 左邊一個穿繩的小孔
      float hole = length(P - vec2(${TAG.x + 34}.0, ${TAG.y + TAG.h / 2}.0));
      tc = mix(tc, col * 0.7, 1.0 - smoothstep(8.0, 9.5, hole));
      tc = mix(tc, C_BLOOD * 0.8, (1.0 - smoothstep(0.5, 2.0, abs(hole - 12.0))) * 0.6);
      vec4 L = fastLayer(texture(page, pageUV(P)));
      tc = tc * (1.0 - L.a) + L.rgb;
      col = mix(col, tc, 1.0 - smoothstep(-1.0, 1.0, td));
    }
    // ---- 杯子的影子（往右下）、白瓷杯
    vec2 cq = P - CUPC;
    float cr = length(cq);
    col *= 1.0 - 0.28 * (1.0 - smoothstep(${CUP.r - 20}.0, ${CUP.r + 40}.0, length(cq - vec2(26.0, 32.0))));
    if (cr < ${CUP.r}.0) {
      // 杯緣（一圈亮的瓷）、內壁（往下漸暗，左上受光）
      vec3 por = mix(C_BONE, C_PAPER, 0.3);
      vec3 c;
      if (cr > ${CUP.liq}.0) {
        float rim = sat((cr - ${CUP.liq}.0) / ${CUP.r - CUP.liq}.0);
        c = por * (0.82 + 0.18 * sin(rim * PI)) * (0.94 + 0.08 * dot(normalize(cq), normalize(vec2(-0.6, -0.8))) * (1.0 - rim));
      } else {
        // 杯底的瓷：中間一圈淡淡的底足
        float uu = cr / ${CUP.liq}.0;
        c = por * (0.86 + 0.08 * uu) * (1.0 - 0.05 * (1.0 - smoothstep(0.0, 3.0, abs(cr - 70.0))));
        // 茶葉（乾的時候淺、泡開之後深，沉得越深被茶湯蓋得越多）
        float leaf = 0.0; float ld = 0.0;
        for (int i = 0; i < ${NL}; i++) {
          vec4 lf = leaves[i];
          vec2 q = rot2(-lf.z) * (P - lf.xy);
          float e = length(q / vec2(24.0, 8.5));
          float cov = 1.0 - smoothstep(0.85, 1.05, e);
          // 葉脈：中間一條
          cov *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 1.2, abs(q.y))) * step(abs(q.x), 18.0);
          if (cov > leaf) { leaf = cov; ld = lf.w; }
        }
        vec3 dry = mix(C_SEPIA, C_BLOOD, 0.35) * 0.9 + C_GRAPHITE * 0.1;
        vec3 wet = mix(C_SEPIA, C_BLOOD, 0.25) * 0.55;
        vec3 lc = mix(dry, wet, fill);
        c = mix(c, lc, leaf);
        // 茶湯：越中間越深；沉下去的葉子被蓋得多一點
        // （茶湯是透過白瓷看的：乘上去，中間厚一點顏色深一點）
        float depth = 0.8 + 0.2 * (1.0 - uu * uu);
        c = mix(c, c * teaCol() * (1.25 - 0.2 * uu) + teaCol() * 0.15, fill * depth * (0.9 + 0.1 * ld * leaf));
        // 漣漪：從落點一圈圈散開，擾動液面的反光；每一拍再從中間漾出一圈
        float pd = length(P - pour.xy);
        float wave = sin(pd * 0.22 - pour.z * 14.0) * exp(-pd / 140.0) * exp(-pour.z * 1.4) * step(0.0, pour.z) * step(pd, pour.z * 260.0 + 20.0);
        wave += 0.7 * beatRipple(cr) * fill;
        // 窗的倒影（液面左上一塊柔柔的亮），被漣漪弄皺
        vec2 wq = (P - CUPC - vec2(-60.0, -70.0) + wave * 6.0) / vec2(70.0, 44.0);
        float refl = exp(-pow(length(wq), 4.0)) * fill;
        c += C_BONE * (0.22 * refl + 0.06 * wave * fill);
        // 倒茶的那一柱：落點一團亮的水花
        c += C_EMBER * 0.25 * pour.w * exp(-pd * pd / 300.0);
      }
      // 杯緣的輪廓線（很細的墨色）
      c *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 2.0, abs(cr - ${CUP.r - 1}.0))) - 0.15 * (1.0 - smoothstep(0.0, 1.5, abs(cr - ${CUP.liq}.0)));
      col = mix(col, c, 1.0 - smoothstep(${CUP.r - 1.5}, ${CUP.r + 0.5}, cr));
    }
    // ---- 熱氣：倒完茶之後杯子上方一縷縷的白，往右上飄散（小節線上冒多一點）
    // （一縷縷：雜訊的零等高線附近才有，像拉長的煙絲，不是一團團的霧）
    vec2 sq = P - CUPC - vec2(30.0, -40.0) * steam;
    vec2 wp = vec2(sq.x / 110.0 - t * 0.12, sq.y / 70.0 + t * 0.45);
    wp += 0.6 * vec2(snoise(wp * 0.7 + 3.0), snoise(wp * 0.7 - 5.0));
    float wisp = 1.0 - smoothstep(0.0, 0.16, abs(snoise(wp)));
    float stm = steam * wisp * exp(-pow(length(sq) / ${(CUP.r * 0.95).toFixed(1)}, 2.0));
    col = mix(col, C_BONE, 0.22 * stm);
    // ---- 茶壺（Canvas 圖層：線條＋平塗，影子也畫在裡面）
    // 頁面外面不取樣（貼圖會被夾到邊緣，拖出一條條的顏色）
    float inPage = step(0.0, P.x) * step(P.x, 1920.0) * step(0.0, P.y) * step(P.y, 1080.0);
    vec4 PT = fastLayer(texture(pot, pageUV(P))) * inPage;
    col = col * (1.0 - PT.a) + PT.rgb;
    fragColor = vec4(col, 1.0);
  }`, {
  ...camUniforms(), t: { value: 0 },
  mask: { value: null }, mR: { value: new THREE.Vector4(0, 0, 1, 1) }, hasMask: { value: 0 },
  cI: { value: Array.from({ length: MAXC }, () => new THREE.Vector2(1e9, 0.2)) },
  page: { value: null }, pot: { value: null },
  leaves: { value: Array.from({ length: NL }, () => new THREE.Vector4(-999, -999, 0, 0)) },
  fill: { value: 0 }, pour: { value: new THREE.Vector4(0, 0, -1, 0) },
  bAge: { value: new THREE.Vector2(9, 9) }, drip: { value: new THREE.Vector4(0, 0, 0, 0) }, steam: { value: 0 },
  matR: { value: new THREE.Vector4(MAT.x, MAT.y, MAT.hw, MAT.hh) },
});

/** 茶葉：乾的時候堆在杯底中間，最後排成的愛心上的位置（整晚固定）。 */
const LEAF0 = Array.from({ length: NL }, (_, i) => {
  const a = hash(i, 1) * TAU, r = 20 + 60 * Math.sqrt(hash(i, 2));
  return { x: CUP.x + Math.cos(a) * r, y: CUP.y + Math.sin(a) * r, ang: hash(i, 3) * TAU };
});
const HEART = heartPoints(NL).slice(0, NL).map((p) => ({ x: CUP.x + p.x * 92, y: CUP.y - 8 + p.y * 92 }));

export default class Tea extends Scene {
  bg = shared('tea.bg', BG);
  page = this.track(new Layer2D(W, H, undefined, { fast: true }));
  pot = this.track(new Layer2D(W, H, undefined, { fast: true }));
  cam = new PlaneCam();
  msg: Msg | null = this.ctx.params.message ?? null;
  mask: OrderMask | null = null;
  block: MsgBlock | null = null;
  items: MaskItem[] = [];
  times: { s: number; d: number }[] = [];
  tPour = 0; b0 = 0; beat = 0.5;
  /** 倒完茶、壺擱回去之後的小節線（壺嘴滴一滴、熱氣冒一陣）。 */
  drips: number[] = [];
  bars: number[] = [];
  pageSig = ''; potSig = '';
  /** 小箋、茶籤上 1 頁面 px 在螢幕上幾 px（鏡頭落定之後），字級照 v2 換算。 */
  kMat = 1; kTag = 1;
  lyrSize: number = V2.lyrMax;
  hasLyrics = false;
  /** 這一格的小箋（中心、半寬、半高）。 */
  mat = { x: MAT.x, y: MAT.y, hw: MAT.hw, hh: MAT.hh };
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const gr = grid(au, s, e);
    this.b0 = gr.b0; this.beat = gr.beat;
    // 奉茶：第一個小節線（太近就下一拍）；短窗格第一拍
    let tp = gr.nBars < 3 ? gr.b0 : gr.bar0;
    if (tp - s < 0.45) tp += gr.beat;
    this.tPour = tp;
    this.bars = gr.bars;
    this.drips = gr.bars.filter((b) => b > tp + gr.beat * 1.6 + 0.7);
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
    // 鏡頭落定之後（窗格中間）小箋與茶籤的縮放：字級是螢幕 px，畫在頁面上要除以它
    this.cam.set(this.pose((s + e) / 2));
    this.kMat = this.cam.toScreen(BOX.x + BOX.w / 2, BOX.y + BOX.h / 2).scale;
    this.kTag = this.cam.toScreen(TAG.x + TAG.w / 2, TAG.y + TAG.h / 2).scale;
    await loadText(`${m?.text ?? ''}${m ? (m.couple ? '—— 新人' : m.name) : ''}——一位賓客${INVITE}${FORTUNE}${song.title}${song.artist}♪·FROM THE COUPLE · 新人`);
    const c = this.page.ctx;
    const k = this.kMat;
    let items: MaskItem[] = [];
    if (m) {
      const b = (this.block = msgBlockV2(c, m, FAM, BOX, { align: 'left', sigFamily: FAM_SIG, scale: k, lineHeight: 1.32 }));
      // 整塊在框裡左右置中（短留言不要擠在紙的左上角），紙裁到只比字多一點邊（≤ 一行字高）、下面留一行占卜的小字
      const [bx, by, bw, bh] = b.box;
      const dx = BOX.x + BOX.w / 2 - (bx + bw / 2);
      const pad = Math.max(30, b.fit.size * 0.7);
      this.mat = { x: bx + dx + bw / 2, y: by + bh / 2 + 12, hw: Math.max(250, bw / 2 + pad), hh: Math.min(MAT.hh, bh / 2 + pad + 12) };
      items = lineItems(b.lines.map((l) => ({ ...l, x: l.x + dx })), FAM, b.fit.size);
      items.push(...lineItems([{ text: b.sig.text, x: b.sig.x + dx, y: b.sig.y }], FAM_SIG, b.sig.size, items.length).map((it) => ({ ...it, thick: 0 })));
      this.lyrSize = lyricV2(b.fit.size * k);
      this.avoid = [[bx + dx, by, bw, bh], [TAG.x, TAG.y, TAG.w, TAG.h]];
    } else if (!this.hasLyrics) {
      const o = { min: V2.lyrMin / k, max: V2.lyrMax / k, lineHeight: 1.35, maxLines: 3 };
      const ft = fitClauses(c, INVITE, FAM, BOX.w, BOX.h, o) ?? fitText(c, INVITE, FAM, BOX.w, BOX.h, o);
      const top = BOX.y + (BOX.h - ft.height) / 2 + ft.size * 0.9;
      const dx = (BOX.w - ft.width) / 2;
      items = lineItems(ft.lines.map((ln, i) => ({ text: ln, x: BOX.x + dx, y: top + i * ft.lineHeight })), FAM, ft.size);
      const pad = ft.size * 0.8;
      this.mat = { x: BOX.x + BOX.w / 2, y: BOX.y + BOX.h / 2 + 12, hw: ft.width / 2 + pad, hh: Math.min(MAT.hh, ft.height / 2 + pad + 12) };
      this.avoid = [[BOX.x, BOX.y, BOX.w, BOX.h]];
    } else this.avoid = [[BOX.x, BOX.y, BOX.w, BOX.h]];
    this.items = items;
    if (items.length) {
      const n = items.length;
      const ts = stagger(au, gr.b0, n, Math.min(gr.bar * 1.75, Math.max(gr.beat * 2, (e - gr.b0) * 0.5)));
      this.times = ts.map((t0, i) => ({ s: t0, d: clamp(((ts[i + 1] ?? t0 + gr.beat) - t0) * 0.9, 0.08, 0.35) }));
      const x0 = Math.min(...items.map((g) => g.x)) - 20, x1 = Math.max(...items.map((g) => g.x + g.w)) + 20;
      const y0 = Math.min(...items.map((g) => g.y - g.size)) - 20, y1 = Math.max(...items.map((g) => g.y + g.size * 0.35)) + 20;
      this.mask = this.track(orderMask(items, [x0, y0, x1 - x0, y1 - y0], MS, 'diag', 3, 0));
    }
  }

  /** 茶壺在 t 時的位置、轉角、傾斜（倒茶時壺身往壺嘴那邊壓扁一點）與正在倒的程度。 */
  private potPose(t: number) {
    const dir = Math.atan2(IMPACT.y - POT0.y, IMPACT.x - POT0.x);
    const pour1 = { x: IMPACT.x - Math.cos(dir) * 235, y: IMPACT.y - Math.sin(dir) * 235 };
    const tp = this.tPour, b = this.beat;
    const come = ease.outCubic(prog(t, tp - 0.4, tp - 0.05));
    const go = ease.inOutCubic(prog(t, tp + b * 1.6, tp + b * 1.6 + 0.6));
    const k = come * (1 - go);
    const tilt = ease.outBack(prog(t, tp - 0.1, tp + 0.12)) * (1 - ease.inOutCubic(prog(t, tp + b * 1.3, tp + b * 1.6)));
    const pouring = t >= tp && t < tp + b * 1.4 ? 1 : 0;
    return { x: lerp(POT0.x, pour1.x, k), y: lerp(POT0.y, pour1.y, k), rot: lerp(POT0.rot, dir, k), tilt, pouring };
  }

  /** 茶葉：乾 → 被沖起來轉（轉速慢慢變慢）→ 沉下去排成愛心。 */
  private leafPose(i: number, t: number, kick: number) {
    const L = LEAF0[i]!, Hh = HEART[i]!;
    const dt = t - this.tPour - 0.05;
    if (dt <= 0) return { x: L.x, y: L.y, a: L.ang, d: 1 };
    const tau = 1.1, w0 = 6.5 * (0.8 + 0.4 * hash(i, 5));
    const th = w0 * tau * (1 - Math.exp(-dt / tau));
    const r0 = Math.hypot(L.x - CUP.x, L.y - CUP.y), a0 = Math.atan2(L.y - CUP.y, L.x - CUP.x);
    const rs = lerp(r0, 70 + 70 * hash(i, 6), ease.outCubic(clamp(dt / 0.5)));
    const sx = CUP.x + Math.cos(a0 + th) * rs, sy = CUP.y + Math.sin(a0 + th) * rs;
    const settle = ease.inOutCubic(clamp((dt - 0.9) / 2.4));
    const j = 3 * kick * (1 - settle);
    return {
      x: lerp(sx, Hh.x, settle) + j * Math.sin(i * 1.7), y: lerp(sy, Hh.y, settle) + j * Math.cos(i * 2.3),
      a: lerp(a0 + th + Math.PI / 2, L.ang, settle), d: lerp(0.25, 1, clamp(dt / 1.2) * 0.4 + settle * 0.6),
    };
  }

  /** 鏡頭：切進來貼近杯子，第一拍拉開，之後慢慢推近、往小箋那邊移一點（有一點俯角，桌面往遠處縮）。 */
  private pose(t: number) {
    const s = this.ctx.start, e = this.ctx.end;
    const open = ease.inOutCubic(prog(t, s, Math.max(s + 0.6, this.b0 + 0.3)));
    const pe = ease.inOutQuad(clamp((t - s) / Math.max(1, e - s)));
    const F0 = 1600;
    return { tx: lerp(640, 962, open) + 22 * pe, ty: lerp(470, 520, open), dist: F0 * (lerp(0.72, 1.07, open) - 0.04 * pe), pitch: 0.2, yaw: -0.05, level: 1, focal: F0 };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio: au } = this.ctx;
    const t = f.t;
    this.cam.set(this.pose(t));
    const u = this.bg.u;
    this.cam.apply(u);
    u.t!.value = t;
    u.mask!.value = this.mask?.tex ?? null;
    u.hasMask!.value = this.mask ? 1 : 0;
    if (this.mask) (u.mR!.value as THREE.Vector4).set(...this.mask.rect);
    const arr = u.cI!.value as THREE.Vector2[];
    for (let i = 0; i < MAXC; i++) { const x = this.times[i]; if (x) arr[i]!.set(x.s, x.d); else arr[i]!.set(1e9, 0.2); }
    // 茶湯：倒茶的那一拍半慢慢滿上來
    u.fill!.value = ease.outCubic(prog(t, this.tPour + 0.02, this.tPour + this.beat * 1.5));
    const pp = this.potPose(t);
    (u.pour!.value as THREE.Vector4).set(IMPACT.x, IMPACT.y, t - this.tPour, pp.pouring);
    const lv = u.leaves!.value as THREE.Vector4[];
    for (let i = 0; i < NL; i++) { const l = this.leafPose(i, t, f.a.kick); lv[i]!.set(l.x, l.y, l.a, l.d); }
    // 每一拍的漣漪：最近兩拍過了幾秒
    const bi = Math.floor(au.beatAt(t));
    (u.bAge!.value as THREE.Vector2).set(t - au.timeOfBeat(bi), t - au.timeOfBeat(bi - 1));
    // 壺嘴滴下來的茶：最近一個（壺擱回去之後的）小節線，落在壺嘴下面的竹片上
    let dr: number | null = null;
    for (const tb of this.drips) if (t >= tb) dr = tb;
    const tip = { x: POT0.x + Math.cos(POT0.rot) * (SPOUT + 6), y: POT0.y + Math.sin(POT0.rot) * (SPOUT + 6) };
    (u.drip!.value as THREE.Vector4).set(tip.x, tip.y, dr === null ? 0 : t - dr, dr === null ? 0 : clamp(1 - (t - dr) / 1.2));
    // 熱氣：倒完茶最多、慢慢少一點，小節線上冒一陣
    let puff = 0;
    for (const tb of this.bars) if (tb > this.tPour) puff = Math.max(puff, pulse(t, tb, 0.35));
    u.steam!.value = (u.fill!.value as number) * (0.45 + 0.45 * Math.exp(-Math.max(0, t - this.tPour) / 3) + 0.35 * puff);
    (u.matR!.value as THREE.Vector4).set(this.mat.x, this.mat.y, this.mat.hw, this.mat.hh);
    this.drawPage(t);
    this.drawPot(pp, t);
    u.page!.value = this.page.texture;
    u.pot!.value = this.pot.texture;
    this.bg.render(renderer, out);
    // 退場：最後一下輕輕推近（硬切在小節線上）
    const exit = prog(t, this.ctx.end - 0.35, this.ctx.end, ease.inCubic);
    return { paper: 1, bloom: 0.25, vignette: 0.4, zoom: 1 + 0.02 * exit, popupAvoid: this.avoid.map((r) => this.cam.screenRect(r, 10)) };
  }

  /** 頁面圖層：茶籤上的字（歌詞或邀請）、沒有留言時小箋上的歌詞、茶葉占卜的小字。 */
  private drawPage(t: number) {
    const { lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const ly = shownLyric(lyrics, t, s, e);
    // 原文（韓文歌）的逐字時間是自己的：頭尾可能比中文早一點、晚一點，這段時間也要逐幀重畫
    const lsub = !this.msg ? lyricSubOf(ly?.line) : null;
    const live = ly && t >= Math.min(ly.line.start, lsub?.start ?? Infinity) - 0.05 && t <= Math.max(ly.line.end, lsub?.end ?? -Infinity) + 0.05;
    const fortune = t > this.tPour + 3.2;
    // 鏡頭還貼著杯子的時候，茶籤在畫面邊上：字等鏡頭拉開才淡入（不要在畫面邊緣被切一半）
    const open = clamp((t - this.ctx.start) / Math.max(0.3, this.b0 + 0.3 - this.ctx.start));
    const sig = `${open.toFixed(2)}:${ly ? ly.line.start : -1}:${live ? t.toFixed(3) : ly ? (t < ly.line.start ? 'pre' : 'post') : ''}:${ly?.k.toFixed(2)}:${fortune ? clamp((t - this.tPour - 3.2) / 0.5).toFixed(2) : 0}`;
    if (sig === this.pageSig) return;
    this.pageSig = sig;
    const L = this.page, c = L.ctx;
    L.clear();
    c.textBaseline = 'alphabetic';
    const ink = paperInk();
    // 茶籤（v2：歌詞在螢幕上 40～52 px，不比留言大）
    c.save(); c.globalAlpha = open * open; c.translate(TAG.x + TAG.w / 2, TAG.y + TAG.h / 2); c.rotate(TAG.rot); c.translate(-(TAG.x + TAG.w / 2), -(TAG.y + TAG.h / 2));
    if (this.msg || !this.hasLyrics) {
      if (ly) {
        const st = { family: FAM_LYR, size: this.lyrSize / this.kTag, minSize: V2.lyrMin / this.kTag, maxW: TAG.w - 110, maxRows: 1, align: 'left' as const };
        const lay = layoutRows(c, ly.line, st);
        c.save(); c.translate(TAG.x + 72, TAG.y + TAG.h / 2 + lay.size * 0.36);
        drawRows(c, lay, FAM_LYR, t, ink, ly.k);
        c.restore();
      } else {
        c.font = font(F.mono(500), 22); c.letterSpacing = '5px'; c.fillStyle = rgba('sepia', 0.7);
        c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`.toUpperCase(), TAG.x + 72, TAG.y + TAG.h / 2 + 8);
        c.letterSpacing = '0px';
      }
    } else {
      c.font = font(F.hei(700), 30); c.fillStyle = rgba('sepia', 0.85);
      c.fillText(INVITE, TAG.x + 72, TAG.y + TAG.h / 2 + 11);
    }
    c.restore();
    // 沒有留言：歌詞寫在小箋上（焦點，v2 歌詞的字級）
    if (!this.msg && this.hasLyrics && ly) {
      const k = this.kMat;
      // 有原文（韓文歌）：中文最多兩行，原文用同一支筆小一號寫在正下方，整組在小箋上置中
      const sub = lsub;
      const st = { family: FAM, size: lyricV2(null) / k, minSize: V2.lyrMin / k, maxW: BOX.w, maxRows: sub ? 2 : 3, align: 'left' as const, lineHeight: 1.3 };
      const lay = layoutRows(c, ly.line, st);
      // 原文照螢幕 px 排（subSizeFor 的 32～56 是螢幕上的大小），畫在小箋座標要除以 k
      const ms = lay.size * k;
      const sst: LyricStyle = { family: FAM, size: ms, maxWidth: BOX.w * k, align: 'left', ...ink };
      const sLay = sub ? layoutLyric(c, sub, subStyleFor(sst, ms)) : null;
      const sGap = sLay ? subGap(ms, sLay.size) / k : 0;
      const hAll = sLay ? lay.height + sGap + (sLay.height - sLay.size + sLay.size * 0.25) / k : lay.height;
      const y0 = BOX.y + (BOX.h - hAll) / 2 + lay.size * 0.85;
      c.save(); c.translate(BOX.x, y0);
      drawRows(c, lay, FAM, t, ink, ly.k);
      c.restore();
      if (sub) {
        c.save(); c.translate(BOX.x, y0 + (lay.rows.length - 1) * lay.lineHeight + sGap); c.scale(1 / k, 1 / k);
        drawLyricSub(c, sub, t, sst, ms, ly.k);
        c.restore();
      }
    }
    // 茶葉沉好之後：小箋左下角一行冷面的小字
    if (fortune) {
      c.globalAlpha = clamp((t - this.tPour - 3.2) / 0.5);
      c.font = font(F.hei(500), 20); c.fillStyle = rgba('sepia', 0.5);
      c.fillText(FORTUNE, this.mat.x - this.mat.hw + 28, this.mat.y + this.mat.hh - 16);
      c.globalAlpha = 1;
    }
    L.upload();
  }

  /** 茶壺（從上面看的紫砂壺：壺身、壺蓋、壺鈕、壺嘴、把手；線條＋平塗）、影子、倒出來的那一柱茶。 */
  private drawPot(pp: { x: number; y: number; rot: number; tilt: number; pouring: number }, t: number) {
    const sig = `${pp.x.toFixed(1)}:${pp.y.toFixed(1)}:${pp.tilt.toFixed(3)}:${pp.pouring ? (t * 30 | 0) : 0}`;
    if (sig === this.potSig) return;
    this.potSig = sig;
    const L = this.pot, c = L.ctx;
    L.clear();
    const clay = rgba('blood'), line = rgba('sepia');
    // 影子（右下，壺越低越實）
    c.save(); c.translate(pp.x + 34, pp.y + 44);
    const sg = c.createRadialGradient(0, 0, 60, 0, 0, 230);
    sg.addColorStop(0, rgba('sepia', 0.28)); sg.addColorStop(1, rgba('sepia', 0));
    c.fillStyle = sg; c.beginPath(); c.arc(0, 0, 230, 0, TAU); c.fill();
    c.restore();
    // 倒出來的那一柱：從壺嘴到落點（俯角看得到一小段），琥珀色＋一條亮邊
    if (pp.pouring) {
      const tip = { x: pp.x + Math.cos(pp.rot) * SPOUT, y: pp.y + Math.sin(pp.rot) * SPOUT };
      c.strokeStyle = rgba('blood', 0.85); c.lineCap = 'round'; c.lineWidth = 11;
      c.beginPath(); c.moveTo(tip.x, tip.y); c.quadraticCurveTo(tip.x + 14, tip.y + 40, IMPACT.x, IMPACT.y); c.stroke();
      c.strokeStyle = rgba('ember', 0.8); c.lineWidth = 3;
      c.beginPath(); c.moveTo(tip.x - 2, tip.y); c.quadraticCurveTo(tip.x + 10, tip.y + 38, IMPACT.x - 2, IMPACT.y); c.stroke();
    }
    c.save(); c.translate(pp.x, pp.y); c.rotate(pp.rot);
    // 倒茶時壺身往前傾：沿壺嘴方向壓扁一點
    c.scale(1 - 0.1 * pp.tilt, 1);
    c.lineWidth = 3; c.strokeStyle = line; c.lineJoin = 'round'; c.lineCap = 'round';
    // 把手（後面）
    c.beginPath(); c.arc(-150, 0, 70, Math.PI * 0.55, Math.PI * 1.45); c.lineWidth = 26; c.strokeStyle = clay; c.stroke();
    c.lineWidth = 3; c.strokeStyle = line;
    c.beginPath(); c.arc(-150, 0, 83, Math.PI * 0.6, Math.PI * 1.4); c.stroke();
    c.beginPath(); c.arc(-150, 0, 57, Math.PI * 0.62, Math.PI * 1.38); c.stroke();
    // 壺嘴（前面，往前變細）
    c.beginPath();
    c.moveTo(140, -30); c.quadraticCurveTo(210, -22, SPOUT, -12); c.lineTo(SPOUT, 12); c.quadraticCurveTo(210, 22, 140, 30); c.closePath();
    c.fillStyle = clay; c.fill(); c.stroke();
    c.beginPath(); c.ellipse(SPOUT, 0, 5, 12, 0, 0, TAU); c.fillStyle = rgba('ink', 0.8); c.fill();
    // 壺身：受光在左上
    const bg = c.createRadialGradient(-50, -60, 20, 0, 0, 170);
    bg.addColorStop(0, rgba('signal', 0.9)); bg.addColorStop(0.35, clay); bg.addColorStop(1, rgba('sepia'));
    c.fillStyle = bg; c.beginPath(); c.arc(0, 0, 160, 0, TAU); c.fill(); c.stroke();
    // 陰影那一側的排線（版畫感）
    c.save(); c.beginPath(); c.arc(0, 0, 158, 0, TAU); c.clip();
    c.strokeStyle = rgba('sepia', 0.35); c.lineWidth = 1.4;
    for (let k = 0; k < 9; k++) { const r = 100 + k * 7; c.beginPath(); c.arc(0, 0, r, -0.2, 1.4); c.stroke(); }
    c.restore();
    // 壺蓋、壺鈕
    c.beginPath(); c.arc(0, 0, 96, 0, TAU); c.strokeStyle = line; c.stroke();
    c.beginPath(); c.arc(0, 0, 84, 0, TAU); c.fillStyle = rgba('blood', 0.9); c.fill(); c.stroke();
    const kg = c.createRadialGradient(-8, -8, 2, 0, 0, 24);
    kg.addColorStop(0, rgba('signal')); kg.addColorStop(1, clay);
    c.fillStyle = kg; c.beginPath(); c.arc(0, 0, 22, 0, TAU); c.fill(); c.stroke();
    c.restore();
    L.upload();
  }
}
