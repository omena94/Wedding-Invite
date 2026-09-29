// 烤蛋糕（亮）：兩個鏡頭。
//  1. 烤箱：奶油色琺瑯烤箱的正面特寫，玻璃窗裡上下兩排電熱管燒得通紅，烤盤上的蛋糕一拍一拍慢慢膨起來；
//     上面的計時器照拍子倒數（每一拍跳一格），數到 0 在小節線「叮！」——白光一閃，切到下一個鏡頭。
//  2. 出爐：從上面俯拍桌上一大塊方形的奶油蛋糕（邊緣擠了一圈貝殼花邊、角落放莓果），擠花袋在蛋糕上用巧克力
//     一個字一個字擠出主打留言（巧克力有厚度、有光澤），署名擠在最後一行下面。
//  - 歌詞寫在一張食譜卡上：第一個鏡頭貼在烤箱門的左下角，第二個鏡頭放在蛋糕旁邊（逐字跟唱，比留言小一級）。
//  - 沒有留言：蛋糕上擠的是正在唱的歌詞（唱到哪擠到哪，還沒唱的字是淡淡的鉛筆草稿），食譜卡上是邀請；
//    純音樂又沒有留言：蛋糕上擠邀請。窗格太短（兩小節）就直接從出爐開始。
// v2（2026-09-29「留言尺寸與版面比例標準 v2」）：
//  - 烤箱縮到畫面左邊（右下角 HUD 底下是乾淨的磁磚牆），右邊牆上的掛桿掛著隔熱手套、打蛋器、刮刀，
//    照拍子輪流被震得晃一下（烤箱在「轟轟」地烤）；計時器照拍子倒數、蛋糕一拍一拍膨起來。
//  - 出爐的蛋糕：巧克力字擠在蛋糕的左邊（留言 40～60 px、署名 26～32，整塊 ≤ 860×430），
//    右邊三分之一是一堆莓果——出爐後先一拍、之後每兩拍落下一顆（離鏡頭近時大、落定時壓扁一下，落在拍點上），一路堆到窗格結束。
//  - 歌詞在食譜卡上（40～52 px，不比留言大）。
// 手法：烤箱是一個全螢幕 shader（琺瑯、磁磚、玻璃窗裡的火光與膨起來的蛋糕）＋ Canvas（計時器的數字、食譜卡）；
// 蛋糕是另一個全螢幕 shader（_t14 的 PlaneCam 俯拍）：巧克力是 _t14 的「依序出現」字模，取樣周圍幾點算出厚度與法線，
// 打光出巧克力的光澤；擠花袋與食譜卡是頁面座標的 Canvas 圖層。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { beatAfter } from './_motifs';
import { fitText } from '../engine/text';
import type { Line } from '../engine/lyrics';
import { grid, stagger, layoutRows, drawRows, paperInk } from './_t4';
import { PlaneCam, camUniforms, CAM_GLSL, orderMask, lineItems, msgBlockV2, INVITE, type OrderMask, type MsgBlock, type MaskItem } from './_t14';
import { shownLyric, type Rect, type P2 } from './_t24';
import { V2, lyricV2, fitClauses } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'local', paper: true, energy: [0.3, 0.9], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 第一個鏡頭：烤箱（螢幕座標）
const OVEN = { x0: 250, y0: 70, x1: 1670, y1: 1040 };
/** 烤箱縮小放左邊：縮放 z 從 0.84 慢慢推到 0.88，推的時候玻璃窗中心（烤箱座標 960, 590）停在畫面的 OVEN_AIM 不動，
 *  烤箱的右下角才不會跑進 HUD。 */
const OVEN_Z0 = 0.84, OVEN_Z1 = 0.88, OVEN_AIM = { x: 726, y: 507 };
const WIN = { x0: 420, y0: 360, x1: 1500, y1: 820 };
const TIMER = { x: 1170, y: 118, w: 320, h: 96 };
/** 食譜卡（貼在烤箱門左下角）：中心、半寬半高、轉角。 */
const CARD1 = { x: 640, y: 915, hw: 400, hh: 62, rot: -0.025 };
// ---------------------------------------------------------------- 第二個鏡頭：蛋糕（頁面座標）
const CAKE = { x0: 300, y0: 150, x1: 1520, y1: 780 };
/** 巧克力字擠在蛋糕的左邊（v2：≤ 860×430），右邊三分之一留給莓果。 */
const BOX = { x: 386, y: 260, w: 760, h: 410 };
const CARD2 = { x: 540, y: 914, hw: 420, hh: 58, rot: 0.02 };
const MAXC = 80, MS = 0.5;
/** 蛋糕右邊的一堆莓果（整晚固定的落點，頁面座標）；前 NF0 顆出爐時就在，其他每兩拍落下一顆。 */
const NF = 20, NF0 = 6;
/** 排法：向日葵的螺旋（黃金角）壓成一個直立的橢圓，由裡往外——後來落下的一顆顆疊在外圈，整堆越長越大。 */
const FRUITS = Array.from({ length: NF }, (_, i) => {
  const r = Math.sqrt((i + 0.5) / NF), a = i * 2.39996 + 0.6;
  return { x: 1334 + 112 * r * Math.cos(a) + (hash(i, 2) - 0.5) * 10, y: 474 + 212 * r * Math.sin(a) + (hash(i, 1) - 0.5) * 10, r: 21 + 7 * hash(i, 3) };
});
/** 右邊牆上的掛桿（螢幕座標）與掛著的東西。 */
const RAIL = { x0: 1430, x1: 1860, y: 150 };
const HOOKS = [{ x: 1500, kind: 'mitt' }, { x: 1640, kind: 'whisk' }, { x: 1770, kind: 'spatula' }] as const;
const FAM = F.hand(700), FAM_SIG = F.hand(700);
const FAM_LYR = F.archivo(100, 800);

const OVEN_FS = () => new FSPass(/* glsl */ `
  uniform float t; uniform float rise; uniform float fire; uniform float zoom; uniform vec2 zc; uniform float puff;
  float rbox(vec2 p, vec2 a, vec2 b, float r) { vec2 c = (a + b) * 0.5, h = (b - a) * 0.5; return sdBox(p - c, h - r) - r; }
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = (sp - zc) / zoom + zc;
    // 牆：白色的地鐵磚（紙色、細細的磚縫）
    vec2 tq = vec2(p.x + (mod(floor(p.y / 70.0), 2.0) * 70.0), p.y);
    float grout = min(abs(mod(tq.x, 140.0) - 70.0) - 68.0, abs(mod(tq.y, 70.0) - 35.0) - 33.0);
    // （右下角 HUD 底下的磚縫淡到幾乎看不見：那一區的背景要乾淨）
    float hudClean = smoothstep(1300.0, 1380.0, sp.x) * smoothstep(780.0, 850.0, sp.y);
    vec3 col = C_PAPER * (0.84 + 0.04 * snoise(p / 300.0)) * (1.0 - 0.18 * (1.0 - 0.8 * hudClean) * (1.0 - smoothstep(-0.5, 1.5, -grout)));
    // 流理台：烤箱坐在上面（檯面一道亮邊，下面是檯面的正面，平平的，右下角 HUD 底下也乾淨）
    float ctop = ${OVEN.y1}.0 - 6.0;
    if (p.y > ctop) {
      col = mix(C_PAPER, C_SEPIA, 0.24) * (0.9 - 0.06 * sat((p.y - ctop) / 200.0));
      col += C_BONE * 0.12 * (1.0 - smoothstep(0.0, 5.0, p.y - ctop));
      col *= 1.0 - 0.12 * (1.0 - smoothstep(10.0, 16.0, p.y - ctop)) * smoothstep(8.0, 10.0, p.y - ctop);
    }
    // 烤箱在牆上投的影子
    float od = rbox(p, vec2(${OVEN.x0}.0, ${OVEN.y0}.0), vec2(${OVEN.x1}.0, ${OVEN.y1}.0), 36.0);
    col *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 70.0, rbox(p - vec2(20.0, 28.0), vec2(${OVEN.x0}.0, ${OVEN.y0}.0), vec2(${OVEN.x1}.0, ${OVEN.y1}.0), 36.0)));
    if (od < 0.0) {
      // 琺瑯：奶油色、上亮下暗、邊緣一圈圓角的反光
      vec3 en = mix(C_PAPER, C_BONE, 0.5) * (0.97 - 0.12 * (p.y - ${OVEN.y0}.0) / ${OVEN.y1 - OVEN.y0}.0);
      en *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 26.0, -od));
      en += C_BONE * 0.12 * (1.0 - smoothstep(0.0, 4.0, abs(od + 10.0)));
      // 控制面板（上面一條，顏色深一點）與門的分界
      float panel = step(p.y, 262.0);
      en = mix(en, en * 0.9, panel);
      en *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 2.0, abs(p.y - 262.0)));
      // 兩顆旋鈕
      for (int k = 0; k < 2; k++) {
        vec2 kc = vec2(420.0 + float(k) * 170.0, 166.0);
        float kd = length(p - kc);
        vec3 kn = mix(C_ASH, C_BONE, 0.5) * (0.75 + 0.3 * dot(normalize(p - kc + 1e-3), vec2(-0.6, -0.8)) * smoothstep(0.0, 46.0, kd));
        // 旋鈕上的指針
        vec2 kq = rot2(-0.8 + float(k) * 1.9) * (p - kc);
        kn = mix(kn, C_SEPIA * 0.8, (1.0 - smoothstep(3.0, 4.5, abs(kq.x))) * step(0.0, kq.y) * step(kq.y, 36.0));
        en = mix(en, kn, 1.0 - smoothstep(46.0, 48.0, kd));
        en *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 3.0, abs(kd - 48.0)));
      }
      // 門把：一條金屬橫桿
      float hd = rbox(p, vec2(560.0, 290.0), vec2(1360.0, 318.0), 14.0);
      vec3 hc = mix(C_ASH, C_BONE, 0.4) * (0.7 + 0.5 * (1.0 - sat((p.y - 290.0) / 28.0)));
      en *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 14.0, rbox(p - vec2(0.0, 10.0), vec2(560.0, 290.0), vec2(1360.0, 318.0), 14.0)));
      en = mix(en, hc, 1.0 - smoothstep(-1.0, 1.0, hd));
      // 計時器的黑色面板
      float td = rbox(p, vec2(${TIMER.x}.0, ${TIMER.y}.0), vec2(${TIMER.x + TIMER.w}.0, ${TIMER.y + TIMER.h}.0), 10.0);
      en = mix(en, C_INK2 * 1.2, 1.0 - smoothstep(-1.0, 1.0, td));
      // 玻璃窗：外框一圈黑邊、裡面是烤箱
      float wd = rbox(p, vec2(${WIN.x0}.0, ${WIN.y0}.0), vec2(${WIN.x1}.0, ${WIN.y1}.0), 34.0);
      if (wd < 14.0) en = mix(en, C_INK2, 1.0 - smoothstep(12.0, 14.0, wd));
      if (wd < 0.0) {
        vec2 q = p;
        // 烤箱裡：暗、被電熱管照成暖色（火力跟著大鼓呼吸）
        float yy = (q.y - ${WIN.y0}.0) / ${WIN.y1 - WIN.y0}.0;
        vec3 inside = C_INK * 0.8 + mix(C_BLOOD, C_SIGNAL, 0.4) * (0.18 + 0.14 * fire) * (0.6 + 0.4 * (exp(-yy * 5.0) + exp(-(1.0 - yy) * 6.0)));
        // 後壁的烤箱孔（一排排小點）
        vec2 hq = mod(q - vec2(440.0, 380.0), 36.0) - 18.0;
        inside *= 1.0 - 0.25 * (1.0 - smoothstep(3.0, 4.5, length(hq))) * step(0.1, yy) * step(yy, 0.9);
        // 電熱管：上下各一條鋸齒，燒紅（會發光）
        for (int k = 0; k < 2; k++) {
          float ey = k == 0 ? ${WIN.y0 + 38}.0 : ${WIN.y1 - 30}.0;
          float zz = ey + 14.0 * abs(fract(q.x / 90.0) * 2.0 - 1.0) - 7.0;
          float el = 1.0 - smoothstep(3.0, 6.0, abs(q.y - zz));
          inside = mix(inside, mix(C_BLOOD, C_EMBER, 0.55 + 0.45 * fire) * (1.3 + 1.2 * fire), el * step(${WIN.x0 + 40}.0, q.x) * step(q.x, ${WIN.x1 - 40}.0));
          inside += mix(C_BLOOD, C_SIGNAL, 0.5) * 0.25 * fire * exp(-abs(q.y - ey) / 30.0);
        }
        // 烤架（兩條橫的鐵線）
        inside += C_ASH * 0.18 * (1.0 - smoothstep(1.0, 2.5, abs(q.y - 712.0)));
        // 烤模（圓的，側面看是梯形）與蛋糕：蛋糕從烤模裡膨出一個圓頂，頂上烤得比較金黃
        float cx = 960.0, py = 705.0;
        float mold = step(abs(q.x - cx), 250.0 - (py - q.y) * 0.1) * step(py - 70.0, q.y) * step(q.y, py);
        vec3 mc = mix(C_ASH, C_GRAPHITE, 0.5) * (0.5 + 0.35 * fire) * (0.8 + 0.2 * sin((q.x - cx) / 250.0 * 1.5 + 1.2));
        float domeH = 20.0 + 120.0 * rise + 10.0 * puff;
        float dx = (q.x - cx) / 236.0;
        float domeTop = py - 70.0 - domeH * sqrt(max(0.0, 1.0 - dx * dx));
        float cake = step(abs(dx), 1.0) * step(domeTop, q.y) * step(q.y, py - 66.0);
        float ck = sat((q.y - domeTop) / max(domeH, 1.0));
        vec3 cc = mix(mix(C_SIGNAL, C_BLOOD, 0.35), mix(C_PAPER, C_SIGNAL, 0.35), smoothstep(0.0, 0.5, ck)) * (0.55 + 0.5 * fire) * (0.85 + 0.15 * snoise(q / 14.0));
        inside = mix(inside, cc, cake);
        inside = mix(inside, mc, mold);
        // 玻璃：斜斜的反光、四角暗一點
        float gl = exp(-pow((q.x * 0.6 + q.y - 900.0) / 90.0, 2.0)) + 0.5 * exp(-pow((q.x * 0.6 + q.y - 1130.0) / 40.0, 2.0));
        inside += C_BONE * 0.07 * gl;
        inside *= 1.0 - 0.4 * (1.0 - smoothstep(0.0, 40.0, -wd));
        en = mix(en, inside, 1.0 - smoothstep(-1.0, 1.0, wd));
      }
      col = mix(col, en, 1.0 - smoothstep(-1.0, 1.0, od));
    }
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 }, rise: { value: 0 }, fire: { value: 0 }, zoom: { value: 1 }, zc: { value: new THREE.Vector2(960, 590) }, puff: { value: 0 } });

const CAKE_FS = () => new FSPass(/* glsl */ `
  ${CAM_GLSL}
  uniform float t;
  uniform sampler2D mask; uniform vec4 mR; uniform float hasMask; uniform vec2 cI[${MAXC}]; uniform float ghost;
  uniform sampler2D page;
  uniform vec4 fruit[${NF}];   // 莓果：落點 x、y、離蛋糕多高（0 = 落定、1 = 剛放手）、畫面上的半徑（還沒出現 = 0）
  float rbox(vec2 p, vec2 a, vec2 b, float r) { vec2 c = (a + b) * 0.5, h = (b - a) * 0.5; return sdBox(p - c, h - r) - r; }
  // 擠了多少巧克力（x）、是不是愛心（y）、還沒擠的字的草稿（z）
  vec3 piped(vec2 q) {
    vec2 mu = (q - mR.xy) / mR.zw;
    if (hasMask < 0.5 || mu.x < 0.0 || mu.y < 0.0 || mu.x > 1.0 || mu.y > 1.0) return vec3(0.0);
    vec4 m = texture(mask, mu);
    if (m.a < 0.01) return vec3(0.0);
    int i = min(int(floor(m.g * 255.0 + 0.5)), ${MAXC - 1});
    vec2 ci = cI[i];
    float k = sat((t - ci.x - m.b * ci.y) / 0.035);
    return vec3(m.a * k, step(0.5, m.r), m.a * (1.0 - k));
  }
  void main() {
    vec2 sp = SP();
    vec2 P = pcHit(sp, 0.0).xy;
    // 桌：淺色木頭
    float g = fbm(vec2(P.x / 1400.0, P.y / 80.0), 3);
    vec3 col = mix(C_PAPER, C_SEPIA, 0.28 + 0.03 * sin((P.y + 120.0 * g) / 8.0) + 0.05 * g);
    col *= 0.9 + 0.12 * exp(-length((P - vec2(400.0, 100.0)) / vec2(1500.0, 1100.0)));
    // 蛋糕底板（白色的紙板，比蛋糕大一圈）與影子
    vec2 A = vec2(${CAKE.x0}.0, ${CAKE.y0}.0), B = vec2(${CAKE.x1}.0, ${CAKE.y1}.0);
    float bd = rbox(P, A - 40.0, B + 40.0, 24.0);
    col *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 40.0, rbox(P - vec2(18.0, 24.0), A - 40.0, B + 40.0, 24.0)));
    col = mix(col, mix(C_BONE, C_PAPER, 0.4) * 0.96, 1.0 - smoothstep(-1.0, 1.0, bd));
    // 蛋糕的影子落在底板上
    float cd = rbox(P, A, B, 30.0);
    col *= 1.0 - 0.28 * (1.0 - smoothstep(0.0, 26.0, rbox(P - vec2(10.0, 14.0), A, B, 30.0)));
    if (cd < 0.0) {
      // 奶油：抹刀抹過的弧形紋路（很淡），窗光從左上
      float sw = snoise(vec2(P.x / 220.0, P.y / 90.0)) + 0.5 * snoise(P / 60.0);
      vec3 cream = mix(C_BONE, C_PAPER, 0.45) * (0.95 + 0.012 * sw + 0.014 * sin((length(P - vec2(900.0, 1400.0)) + 40.0 * sw) / 22.0));
      // 貝殼花邊：沿著邊緣一圈一顆顆的小丘
      float edge = -cd;
      float along = abs(P.y - ${CAKE.y0}.0) < 70.0 || abs(P.y - ${CAKE.y1}.0) < 70.0 ? P.x : P.y;
      float bump = 0.5 + 0.5 * cos(along / 26.0 * TAU * 0.5);
      float band = smoothstep(4.0, 12.0, edge) * (1.0 - smoothstep(34.0, 46.0, edge));
      float shell = band * (0.55 + 0.45 * bump);
      cream *= 1.0 - 0.1 * band * (1.0 - bump) - 0.08 * (1.0 - smoothstep(0.0, 6.0, edge));
      cream += C_BONE * 0.06 * shell * (1.0 - sat(abs(edge - 20.0) / 14.0));
      // 左邊兩個角的莓果（blood 色的小球，有反光；右邊有一整堆）
      for (int k = 0; k < 4; k++) {
        if (k == 1 || k == 3) continue;
        vec2 bc = vec2(k == 0 || k == 2 ? A.x + 76.0 : B.x - 76.0, k < 2 ? A.y + 72.0 : B.y - 72.0);
        for (int j = 0; j < 3; j++) {
          vec2 c = bc + vec2(float(j) * 30.0 - 30.0, float(j - 1) * float(j - 1) * 20.0 - 10.0) * (k == 1 || k == 2 ? -1.0 : 1.0);
          float d = length(P - c);
          float cov = 1.0 - smoothstep(15.0, 17.0, d);
          vec3 bcol = C_BLOOD * (0.6 + 0.4 * sat(1.0 - d / 16.0)) + C_BONE * 0.5 * (1.0 - smoothstep(0.0, 4.0, length(P - c + vec2(5.0, 5.0))));
          cream *= 1.0 - 0.2 * (1.0 - smoothstep(14.0, 24.0, length(P - c - vec2(5.0, 6.0))));
          cream = mix(cream, bcol, cov);
        }
      }
      // 巧克力：用周圍四點的覆蓋率當厚度算法線 → 打光（左上的窗光）＋一點鏡面反光
      vec3 m0 = piped(P);
      float hx = piped(P + vec2(2.0, 0.0)).x - piped(P - vec2(2.0, 0.0)).x;
      float hy = piped(P + vec2(0.0, 2.0)).x - piped(P - vec2(0.0, 2.0)).x;
      vec3 n = normalize(vec3(-hx * 1.4, -hy * 1.4, 1.0));
      vec3 L = normalize(vec3(-0.5, -0.6, 0.65));
      vec3 choc = mix(C_SEPIA * 0.9, C_ROSE * 0.85, m0.y);
      vec3 cc = choc * (0.55 + 0.6 * max(dot(n, L), 0.0)) + C_BONE * 0.45 * pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 18.0);
      // 巧克力的影子（往右下）
      float shd = piped(P - vec2(4.0, 5.0)).x;
      cream *= 1.0 - 0.18 * shd * (1.0 - m0.x);
      // 還沒擠的字：淡淡的鉛筆草稿（沒有留言、跟唱歌詞時）
      cream = mix(cream, C_SEPIA, 0.12 * ghost * m0.z);
      cream = mix(cream, cc, m0.x);
      col = mix(col, cream, 1.0 - smoothstep(-1.0, 1.0, cd));
    }
    // ---- 右邊的莓果：影子（離蛋糕越高越偏、越淡越散）→ 果子（離鏡頭越近越大、邊緣越虛）
    for (int k = 0; k < ${NF}; k++) {
      vec4 f = fruit[k];
      if (f.w < 0.5) continue;
      float h = max(f.z, 0.0);
      float sd = length(P - f.xy - vec2(6.0, 8.0) - vec2(46.0, 58.0) * h);
      col *= 1.0 - (0.3 - 0.22 * h) * (1.0 - smoothstep(f.w * 0.5, f.w * (1.25 + 1.4 * h), sd));
    }
    for (int k = 0; k < ${NF}; k++) {
      vec4 f = fruit[k];
      if (f.w < 0.5) continue;
      float h = max(f.z, 0.0);
      vec2 q = (P - f.xy) / f.w;
      float d = length(q);
      if (d > 1.1) continue;
      float cov = 1.0 - smoothstep(0.93 - 0.3 * h, 1.02, d);
      vec3 n = vec3(q, sqrt(max(0.0, 1.0 - d * d)));
      vec3 L = normalize(vec3(-0.5, -0.6, 0.65));
      // 三顆裡有一顆是深色的藍莓（頂上一個小小的星形蒂），其他是 blood 色的莓果
      bool blue = k - (k / 3) * 3 == 0;
      vec3 base = blue ? mix(C_INK2, C_SIGNAL, 0.12) * 1.4 : C_BLOOD;
      vec3 fc = base * (0.45 + 0.62 * max(dot(n, L), 0.0)) + C_BONE * 0.45 * pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 20.0);
      if (blue) fc *= 1.0 - 0.35 * (1.0 - smoothstep(0.08, 0.16, d + 0.04 * sin(atan(q.y, q.x) * 5.0)));
      col = mix(col, fc, cov);
    }
    // 頁面圖層（食譜卡、擠花袋）
    float inPage = step(0.0, P.x) * step(P.x, 1920.0) * step(0.0, P.y) * step(P.y, 1080.0);
    vec4 Lp = fastLayer(texture(page, pageUV(P))) * inPage;
    col = col * (1.0 - Lp.a) + Lp.rgb;
    fragColor = vec4(col, 1.0);
  }`, {
  ...camUniforms(), t: { value: 0 },
  mask: { value: null }, mR: { value: new THREE.Vector4(0, 0, 1, 1) }, hasMask: { value: 0 }, ghost: { value: 0 },
  cI: { value: Array.from({ length: MAXC }, () => new THREE.Vector2(1e9, 0.2)) },
  page: { value: null },
  fruit: { value: Array.from({ length: NF }, () => new THREE.Vector4(0, 0, 0, 0)) },
});

/** 一組要擠的字：字模、每個字的時間。 */
interface PipeSet { mask: OrderMask; items: MaskItem[]; times: { s: number; d: number }[] }

export default class Baking extends Scene {
  oven = shared('baking.oven', OVEN_FS);
  cake = shared('baking.cake', CAKE_FS);
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  cam = new PlaneCam();
  msg: Msg | null = this.ctx.params.message ?? null;
  block: MsgBlock | null = null;
  pipe: PipeSet | null = null;
  linePipes = new Map<Line, PipeSet>();
  tDing = 0; b0 = 0; beat = 0.5; nBeats = 4;
  lyrSize: number = V2.lyrMax;
  /** 蛋糕那一格：字框、食譜卡在畫面上的縮放（1 頁面 px = 幾螢幕 px，鏡頭落定之後）。 */
  kBox = 1; kCard2 = 1;
  /** 每顆莓果落定的時間（前 NF0 顆出爐時就在）。 */
  fDrop: number[] = [];
  /** 掛桿上的東西被震的拍點（第 i 拍震第 i % 3 個）。 */
  pushes: number[] = [];
  avoid1: Rect[] = []; avoid2: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const gr = grid(au, s, e);
    this.b0 = gr.b0; this.beat = gr.beat;
    // 叮：第一個小節線（至少一秒後；太近就再下一個小節線）；兩小節的窗格直接出爐
    let td = gr.bar0;
    if (td - s < 1.0) td += gr.bar;
    if (gr.nBars < 3) td = s;
    this.tDing = Math.min(td, s + gr.bar * 1.6);
    this.nBeats = Math.max(1, Math.round(au.beatAt(this.tDing) - au.beatAt(s)));
    this.pushes = gr.beats.filter((b) => b <= this.tDing + 0.01);
    // 莓果：出爐後第一拍起，先一拍一顆（六顆），之後兩拍一顆（落定在拍點上）
    const bd = Math.ceil(au.beatAt(this.tDing + 0.05) - 1e-6);
    this.fDrop = FRUITS.map((_, i) => { const k = i - NF0; return k < 0 ? -1e9 : au.timeOfBeat(bd + 1 + (k < 6 ? k : 6 + 2 * (k - 6))); });
    // 鏡頭落定之後字框、食譜卡的縮放（字級是螢幕 px，畫在頁面上要除以它）
    this.cam.set(this.cakePose((this.tDing + e) / 2));
    const k = (this.kBox = this.cam.toScreen(BOX.x + BOX.w / 2, BOX.y + BOX.h / 2).scale);
    this.kCard2 = this.cam.toScreen(CARD2.x, CARD2.y).scale;
    const lines = m ? [] : lyrics.linesIn(s - 4, e).filter((l) => l.end > s - 1.5);
    await loadText(`${m?.text ?? ''}${m ? (m.couple ? '—— 新郎新娘' : m.name) : ''}——一位賓客${INVITE}${lines.map((l) => l.text).join('')}${song.title}♪叮！0123456789:BAKE·°C食譜FROM THE COUPLE · 新人`);
    const c = this.layer.ctx;
    const t0 = beatAfter(au, this.tDing + 0.05);
    const dur = Math.min(gr.bar * 1.4, Math.max(gr.beat * 2, (e - t0) * 0.45));
    /** 沒有留言時擠的字（歌詞或邀請）：v2 歌詞的字級（≤ 52），照子句斷行，在框裡置中。 */
    const fitLyric = (text: string) => {
      const o = { min: V2.lyrMin / k, max: lyricV2(null) / k, lineHeight: 1.28, maxLines: 3 };
      const ft = fitClauses(c, text, FAM, BOX.w, BOX.h, o) ?? fitText(c, text, FAM, BOX.w, BOX.h, o);
      const top = BOX.y + (BOX.h - ft.height) / 2 + ft.size * 0.9;
      c.font = font(FAM, ft.size);
      return { ft, rows: ft.lines.map((ln, i) => ({ text: ln, x: BOX.x + (BOX.w - c.measureText(ln).width) / 2, y: top + i * ft.lineHeight })) };
    };
    if (m) {
      const b = (this.block = msgBlockV2(c, m, FAM, BOX, { align: 'center', sigFamily: FAM_SIG, scale: k, lineHeight: 1.3 }));
      const items = lineItems(b.lines, FAM, b.fit.size);
      items.push(...lineItems([{ text: b.sig.text, x: b.sig.x, y: b.sig.y }], FAM_SIG, b.sig.size, items.length));
      this.pipe = this.makePipe(items, stagger(au, t0, items.length, dur), b.fit.size);
      this.lyrSize = lyricV2(b.fit.size * k);
      this.avoid2 = [b.box];
    } else if (!lines.length) {
      const { ft, rows } = fitLyric(INVITE);
      const items = lineItems(rows, FAM, ft.size);
      this.pipe = this.makePipe(items, stagger(au, t0, items.length, dur), ft.size);
      this.avoid2 = [[BOX.x, BOX.y, BOX.w, BOX.h]];
    } else {
      // 沒有留言：每一句歌詞一組字模，每個字在它開始唱的時候擠出來
      for (const l of lines) {
        const { ft, rows } = fitLyric(l.text);
        const items = lineItems(rows, FAM, ft.size);
        // 每個字對到歌詞的 Word：照順序在原文裡找
        let cur = 0;
        const times = items.map((it) => {
          const at = l.text.indexOf(it.ch, cur);
          if (at >= 0) cur = at + it.ch.length;
          const w = l.words.find((wd) => at >= wd.o && at < wd.o + wd.w.length) ?? l.words[0]!;
          const kk = w.w.length > 1 ? (at - w.o) / w.w.length : 0;
          const span = Math.max(0.08, (w.end - w.start) / Math.max(1, w.w.length));
          return { s: w.start + kk * (w.end - w.start), d: Math.min(0.3, span) };
        });
        this.linePipes.set(l, this.makePipeT(items, times, ft.size));
      }
      this.avoid2 = [[BOX.x, BOX.y, BOX.w, BOX.h]];
    }
    const z = OVEN_Z0, zc = this.ovenZc(z);
    const toS = (x: number, y: number) => ({ x: zc.x + (x - zc.x) * z, y: zc.y + (y - zc.y) * z });
    const a = toS(CARD1.x - CARD1.hw, CARD1.y - CARD1.hh), b2 = toS(CARD1.x + CARD1.hw, CARD1.y + CARD1.hh);
    this.avoid1 = [[a.x, a.y, b2.x - a.x, b2.y - a.y]];
  }

  private makePipe(items: MaskItem[], ts: number[], size: number): PipeSet {
    return this.makePipeT(items, ts.map((t0, i) => ({ s: t0, d: clamp(((ts[i + 1] ?? t0 + this.beat) - t0) * 0.9, 0.08, 0.32) })), size);
  }
  private makePipeT(items: MaskItem[], times: { s: number; d: number }[], size: number): PipeSet {
    const x0 = Math.min(...items.map((g) => g.x)) - 20, x1 = Math.max(...items.map((g) => g.x + g.w)) + 20;
    const y0 = Math.min(...items.map((g) => g.y - g.size)) - 20, y1 = Math.max(...items.map((g) => g.y + g.size * 0.35)) + 20;
    // 擠花：筆畫比字型粗、轉角圓（描一圈邊）
    const mask = this.track(orderMask(items, [x0, y0, x1 - x0, y1 - y0], MS, 'x', 3, clamp(size * 0.016, 0.8, 2)));
    return { mask, items, times };
  }

  /** 烤箱縮放 z 時的縮放中心：讓玻璃窗中心（烤箱座標 960, 590）停在 OVEN_AIM。 */
  private ovenZc(z: number) { return { x: (OVEN_AIM.x - 960 * z) / (1 - z), y: (OVEN_AIM.y - 590 * z) / (1 - z) }; }

  /** 蛋糕那一格的鏡頭：切過來時貼近、有一點歪，很快落定、拉開；之後慢慢推近。 */
  private cakePose(t: number) {
    const e = this.ctx.end;
    const land = ease.outExpo(prog(t, this.tDing, this.tDing + 0.8));
    const pe = ease.inOutQuad(clamp((t - this.tDing) / Math.max(1, e - this.tDing)));
    const F0 = 1600;
    return { tx: lerp(1000, 950, land), ty: lerp(480, 520, land), dist: F0 * (lerp(0.8, 1.02, land) - 0.035 * pe), pitch: 0.16, yaw: -0.04, roll: 0.05 * (1 - land), level: 1, focal: F0 };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const t = f.t;
    if (t < this.tDing) return this.renderOven(f, out);
    return this.renderCake(f, out);
  }

  // ---------------------------------------------------------------- 第一個鏡頭
  private renderOven(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const u = this.oven.u;
    const k = clamp((t - s) / Math.max(0.3, this.tDing - s));
    // 蛋糕照拍子一下一下膨起來；鏡頭慢慢推近玻璃窗
    const bi = au.beatAt(t) - au.beatAt(s);
    u.rise!.value = clamp((Math.floor(bi) + ease.outBack(clamp((bi % 1) / 0.35), 2)) / Math.max(1, this.nBeats));
    u.puff!.value = f.a.kick;
    u.fire!.value = 0.75 + 0.25 * f.a.kick;
    const z = lerp(OVEN_Z0, OVEN_Z1, ease.inOutQuad(k)), zc = this.ovenZc(z);
    u.zoom!.value = z;
    (u.zc!.value as THREE.Vector2).set(zc.x, zc.y);
    u.t!.value = t;
    this.oven.render(renderer, out);
    // 計時器、食譜卡
    const L = this.layer; L.clear();
    const c = L.ctx;
    c.setTransform(z, 0, 0, z, zc.x * (1 - z), zc.y * (1 - z));
    const left = Math.max(0, Math.ceil(au.beatAt(this.tDing) - au.beatAt(t) - 1e-3));
    c.textBaseline = 'alphabetic';
    c.font = font(F.mono(600), 60); c.letterSpacing = '6px';
    const blink = 0.75 + 0.25 * (1 - (au.beatAt(t) % 1));
    c.fillStyle = rgba('signal', blink);
    c.fillText(`0:${String(left).padStart(2, '0')}`, TIMER.x + 58, TIMER.y + 70);
    c.letterSpacing = '0px';
    c.font = font(F.mono(500), 16); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.6);
    c.fillText('BAKE · 180°C', TIMER.x - 190, TIMER.y + 56);
    c.letterSpacing = '0px';
    this.drawCard(c, CARD1, t, z);
    c.setTransform(1, 0, 0, 1, 0, 0);
    // 右邊牆上的掛桿：隔熱手套、打蛋器、刮刀
    this.drawRail(c, t);
    comp.draw(renderer, L.upload(), out);
    // 叮之前半拍：光越來越亮
    return { paper: 1, bloom: 0.55, vignette: 0.45, flash: 0.35 * prog(t, this.tDing - 0.12, this.tDing, ease.inQuad), popupAvoid: this.avoid1 };
  }

  /** 掛桿上的東西在 t 時的擺角：最近一次被震（輪到它的拍點）的阻尼擺動，震的那一下往右甩。 */
  private swing(i: number, t: number) {
    let a = 0;
    for (let k = 0; k < this.pushes.length; k++) {
      const tb = this.pushes[k]!;
      if (tb > t) break;
      if (k % HOOKS.length !== i) continue;
      const d = t - tb;
      a = 0.16 * Math.exp(-d * 2.6) * Math.sin(d * 7.5);
    }
    return a + 0.01 * Math.sin(t * 1.3 + i * 2);
  }

  /** 掛桿（螢幕座標）：一根金屬桿、兩個壁座，三個 S 形掛勾，東西線條＋平塗，牆上一個淡淡的影子。 */
  private drawRail(c: CanvasRenderingContext2D, t: number) {
    const line = rgba('sepia', 0.9);
    c.lineJoin = 'round'; c.lineCap = 'round';
    // 桿與壁座
    c.fillStyle = rgba('sepia', 0.12); c.fillRect(RAIL.x0 + 8, RAIL.y + 10, RAIL.x1 - RAIL.x0, 10);
    for (const x of [RAIL.x0 + 20, RAIL.x1 - 20]) { c.fillStyle = mixRgba('ash', 'sepia', 0.4); c.fillRect(x - 7, RAIL.y - 16, 14, 26); }
    const rg = c.createLinearGradient(0, RAIL.y - 6, 0, RAIL.y + 6);
    rg.addColorStop(0, mixRgba('bone', 'ash', 0.3)); rg.addColorStop(1, mixRgba('ash', 'sepia', 0.35));
    c.fillStyle = rg; c.beginPath(); c.roundRect(RAIL.x0, RAIL.y - 6, RAIL.x1 - RAIL.x0, 12, 6); c.fill();
    c.strokeStyle = line; c.lineWidth = 1.5; c.stroke();
    HOOKS.forEach((hk, i) => {
      const ang = this.swing(i, t);
      for (const shadow of [true, false]) {
        c.save();
        c.translate(hk.x + (shadow ? 12 : 0), RAIL.y + (shadow ? 16 : 0));
        // S 形掛勾
        c.strokeStyle = shadow ? rgba('sepia', 0.12) : line; c.lineWidth = 3;
        c.beginPath(); c.arc(0, 4, 7, Math.PI * 1.1, Math.PI * 2.2); c.stroke();
        c.beginPath(); c.moveTo(7, 6); c.quadraticCurveTo(8, 22, 0, 26); c.stroke();
        c.translate(0, 26); c.rotate(ang);
        if (shadow) { c.globalAlpha = 0.12; c.fillStyle = rgba('sepia'); c.strokeStyle = rgba('sepia'); }
        this.drawTool(c, hk.kind, shadow);
        c.restore();
      }
    });
    c.globalAlpha = 1;
  }

  /** 一件廚具（原點 = 掛點，往下掛）。 */
  private drawTool(c: CanvasRenderingContext2D, kind: 'mitt' | 'whisk' | 'spatula', shadow: boolean) {
    const line = shadow ? rgba('sepia') : rgba('sepia', 0.9);
    c.strokeStyle = line; c.lineWidth = 2.5;
    // 掛繩圈
    c.beginPath(); c.ellipse(0, 10, 6, 10, 0, 0, Math.PI * 2); c.stroke();
    if (kind === 'mitt') {
      // 隔熱手套：大拇指往左，一道道縫線
      c.beginPath();
      c.moveTo(-40, 24); c.lineTo(40, 24); c.lineTo(46, 200);
      c.quadraticCurveTo(48, 262, 4, 266); c.quadraticCurveTo(-42, 266, -44, 212);
      c.quadraticCurveTo(-86, 200, -84, 162); c.quadraticCurveTo(-80, 136, -52, 150);
      c.closePath();
      if (!shadow) { c.fillStyle = mixRgba('blood', 'paper', 0.25); c.fill(); }
      else c.fill();
      c.stroke();
      if (!shadow) {
        c.strokeStyle = rgba('paper', 0.45); c.lineWidth = 1.2; c.setLineDash([5, 5]);
        for (const x of [-20, 0, 20]) { c.beginPath(); c.moveTo(x, 44); c.lineTo(x * 1.1, 240); c.stroke(); }
        c.setLineDash([]);
        c.fillStyle = mixRgba('paper', 'bone', 0.4); c.fillRect(-40, 24, 80, 20);
        c.strokeStyle = line; c.lineWidth = 2; c.strokeRect(-40, 24, 80, 20);
      }
    } else if (kind === 'whisk') {
      // 打蛋器：握把＋一圈圈鋼絲（水滴形）
      c.beginPath(); c.roundRect(-9, 20, 18, 110, 8);
      if (!shadow) { c.fillStyle = mixRgba('signal', 'paper', 0.35); } c.fill(); c.stroke();
      c.lineWidth = 1.6;
      for (const k of [-1, -0.55, -0.15, 0.15, 0.55, 1]) {
        c.beginPath(); c.moveTo(k * 6, 130);
        c.bezierCurveTo(k * 70, 190, k * 62, 300, 0, 316);
        c.stroke();
      }
    } else {
      // 刮刀：長柄＋矽膠刀頭
      c.beginPath(); c.roundRect(-7, 20, 14, 170, 6);
      if (!shadow) c.fillStyle = mixRgba('ash', 'paper', 0.3); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(-30, 186); c.lineTo(30, 186); c.quadraticCurveTo(36, 262, 22, 270); c.lineTo(-22, 270); c.quadraticCurveTo(-36, 262, -30, 186); c.closePath();
      if (!shadow) c.fillStyle = mixRgba('signal', 'blood', 0.4); c.fill(); c.stroke();
    }
  }

  // ---------------------------------------------------------------- 第二個鏡頭
  private renderCake(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    this.cam.set(this.cakePose(t));
    const u = this.cake.u;
    this.cam.apply(u);
    u.t!.value = t;
    // 這一格擠的是哪一組字（有留言：留言；沒有留言：正在唱的那一句）
    let pipe = this.pipe;
    let line: Line | null = null;
    if (!pipe && this.linePipes.size) {
      const sl = shownLyric(lyrics, t, s, e);
      line = sl?.line ?? null;
      pipe = line ? this.linePipes.get(line) ?? null : null;
    }
    u.mask!.value = pipe?.mask.tex ?? null;
    u.hasMask!.value = pipe ? 1 : 0;
    u.ghost!.value = line ? 1 : 0;
    if (pipe) (u.mR!.value as THREE.Vector4).set(...pipe.mask.rect);
    const arr = u.cI!.value as THREE.Vector2[];
    for (let i = 0; i < MAXC; i++) { const x = pipe?.times[i]; if (x) arr[i]!.set(x.s, x.d); else arr[i]!.set(1e9, 0.2); }
    // 莓果：落定前 0.32 秒從鏡頭前面掉下來（重力，越來越快），落定那一下壓扁、彈一下
    const fr = u.fruit!.value as THREE.Vector4[];
    FRUITS.forEach((p, i) => {
      const td = this.fDrop[i]!;
      if (t < td - 0.32) { fr[i]!.set(0, 0, 0, 0); return; }
      const h = t < td ? 1 - ease.inQuad(clamp((t - (td - 0.32)) / 0.32)) : 0;
      const squash = t >= td ? Math.exp(-(t - td) * 9) * Math.sin(Math.min(Math.PI, (t - td) * 22)) : 0;
      fr[i]!.set(p.x, p.y, h, p.r * (1 + 1.3 * h + 0.14 * squash));
    });
    // 頁面圖層：食譜卡、擠花袋
    const L = this.layer; L.clear();
    const c = L.ctx;
    this.drawCard(c, CARD2, t, this.kCard2);
    const head = pipe ? this.headAt(pipe, t) : null;
    if (head) this.drawBag(c, head, t);
    u.page!.value = L.upload();
    this.cake.render(renderer, out);
    const exit = prog(t, e - 0.35, e, ease.inCubic);
    return { paper: 1, bloom: 0.25, vignette: 0.4, zoom: 1 + 0.02 * exit, flash: this.tDing > s + 0.01 ? 0.5 * (1 - clamp((t - this.tDing) / 0.18)) : 0, popupAvoid: this.avoid2.map((r) => this.cam.screenRect(r, 10)) };
  }

  /** 擠花嘴在 t 時的位置（正在擠的那個字，照掃描方向往右走、上下動一點）；沒在擠是 null（停在最後一個字旁邊一下下）。 */
  private headAt(p: PipeSet, t: number): P2 | null {
    let last: P2 | null = null;
    for (let i = 0; i < p.items.length; i++) {
      const tm = p.times[i]!, it = p.items[i]!;
      if (t < tm.s) return last && t - (p.times[i - 1]!.s + p.times[i - 1]!.d) < 0.35 ? last : null;
      if (t < tm.s + tm.d) {
        const k = (t - tm.s) / tm.d;
        return { x: it.x + it.w * k, y: it.y - it.size * (0.4 + 0.25 * Math.sin(k * 11 + i)) };
      }
      last = { x: it.x + it.w, y: it.y - it.size * 0.4 };
    }
    const lt = p.times[p.times.length - 1];
    return lt && last && t - (lt.s + lt.d) < 0.35 ? last : null;
  }

  /** 擠花袋（從上面看：一個圓錐，嘴在 head，袋子往右上方），線條＋平塗，下面一點影子。 */
  private drawBag(c: CanvasRenderingContext2D, h: P2, t: number) {
    // 袋子往右上斜（蓋住的是還沒擠的地方，不是剛擠好的字）；小一點、半透明（字變小了，袋子跟著小）
    const ang = -0.32 + 0.05 * Math.sin(t * 7);
    c.save();
    c.translate(h.x + 14, h.y + 20); c.rotate(ang);
    const sg = c.createRadialGradient(120, 0, 16, 120, 0, 160);
    sg.addColorStop(0, rgba('sepia', 0.18)); sg.addColorStop(1, rgba('sepia', 0));
    c.fillStyle = sg; c.fillRect(-20, -170, 330, 340);
    c.restore();
    c.save();
    c.globalAlpha = 0.92;
    c.translate(h.x, h.y); c.rotate(ang); c.scale(0.62, 0.62);
    c.lineWidth = 3; c.strokeStyle = rgba('sepia'); c.lineJoin = 'round';
    // 袋子（半透明的白，裡面透出巧克力）
    c.beginPath(); c.moveTo(34, -14); c.quadraticCurveTo(170, -96, 320, -86); c.quadraticCurveTo(356, 0, 320, 86); c.quadraticCurveTo(170, 96, 34, 14); c.closePath();
    const bg = c.createLinearGradient(0, -60, 0, 60);
    bg.addColorStop(0, mixRgba('bone', 'sepia', 0.1)); bg.addColorStop(0.5, mixRgba('bone', 'sepia', 0.35)); bg.addColorStop(1, mixRgba('bone', 'sepia', 0.15));
    c.fillStyle = bg; c.fill(); c.stroke();
    // 袋子被捏出來的摺痕、袋口扭起來的地方
    c.lineWidth = 1.5; c.strokeStyle = rgba('sepia', 0.4);
    for (const k of [-0.45, 0, 0.4]) { c.beginPath(); c.moveTo(60, k * 12); c.quadraticCurveTo(190, k * 80, 318, k * 70); c.stroke(); }
    c.lineWidth = 3; c.strokeStyle = rgba('sepia');
    c.beginPath(); c.moveTo(326, -46); c.lineTo(384, -20); c.lineTo(384, 20); c.lineTo(326, 46); c.stroke();
    // 花嘴（金屬）
    c.beginPath(); c.moveTo(0, 0); c.lineTo(40, -16); c.lineTo(40, 16); c.closePath();
    c.fillStyle = mixRgba('ash', 'bone', 0.5); c.fill(); c.stroke();
    c.restore();
  }

  /** 食譜卡：一張白卡、兩段膠帶；上面印歌詞（有留言）或邀請（沒有留言）。k = 卡片在畫面上的縮放（歌詞字級照 v2 換算）。 */
  private drawCard(c: CanvasRenderingContext2D, K: { x: number; y: number; hw: number; hh: number; rot: number }, t: number, k: number) {
    const { lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    c.save();
    c.translate(K.x, K.y); c.rotate(K.rot);
    c.fillStyle = rgba('sepia', 0.16); c.fillRect(-K.hw + 8, -K.hh + 10, K.hw * 2, K.hh * 2);
    c.fillStyle = mixRgba('bone', 'paper', 0.3); c.fillRect(-K.hw, -K.hh, K.hw * 2, K.hh * 2);
    c.fillStyle = rgba('blood', 0.45); c.fillRect(-K.hw, -K.hh + 12, K.hw * 2, 2);
    // 膠帶
    for (const sx of [-1, 1]) {
      c.save(); c.translate(sx * (K.hw - 20), -K.hh); c.rotate(sx * 0.5);
      c.fillStyle = rgba('paper', 0.75); c.fillRect(-34, -12, 68, 24); c.restore();
    }
    c.textBaseline = 'alphabetic';
    const x0 = -K.hw + 26;
    // 純音樂又沒有留言：蛋糕上擠的是邀請，卡片上就放歌名（不要重複）
    if (this.msg || !this.linePipes.size) {
      const ly = shownLyric(lyrics, t, s, e);
      if (ly) {
        const st = { family: FAM_LYR, size: this.lyrSize / k, minSize: V2.lyrMin / k, maxW: K.hw * 2 - 50, maxRows: 1, align: 'left' as const };
        const lay = layoutRows(c, ly.line, st);
        c.save(); c.translate(x0, 8 + lay.size * 0.36);
        drawRows(c, lay, FAM_LYR, t, paperInk(), ly.k);
        c.restore();
      } else {
        c.font = font(F.mono(500), 20); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.7);
        c.fillText(`♪  ${song.title}`.toUpperCase().slice(0, 36), x0, 14);
        c.letterSpacing = '0px';
      }
    } else {
      const ft = fitText(c, INVITE, F.hei(700), K.hw * 2 - 50, K.hh * 2 - 20, { min: 22, max: 30, lineHeight: 1.3, maxLines: 2 });
      c.font = font(F.hei(700), ft.size); c.fillStyle = rgba('sepia', 0.85);
      ft.lines.forEach((ln, i) => c.fillText(ln, x0, 8 - ft.height / 2 + ft.size * 0.85 + i * ft.lineHeight));
    }
    c.restore();
  }
}
