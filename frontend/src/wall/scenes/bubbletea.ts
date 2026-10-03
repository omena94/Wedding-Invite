// 珍珠奶茶（亮）：飲料店的吧台上一杯珍奶的特寫，後面是被午後的窗光斜斜照亮的牆。
//  - 杯底一層黑亮的珍珠，大鼓一打就整堆跳一下（上面的跳得高）；杯身有冰塊、水珠、一圈牛皮紙的杯套。
//  - 主打留言：從第一拍起，粗吸管一顆一顆把珍珠吸上來，珍珠從吸管口「啵」地飛出去、落在右邊，
//    一落地就長成一個字（深咖啡色，像珍珠的顏色）——一個字一顆珍珠，最後署名淡淡出現。
//  - 歌詞印在杯套上（圓柱的曲面，逐字跟唱，比留言小一級）。
//  - 沒有留言：珍珠變成正在唱的歌詞（唱到哪個字、那顆珍珠剛好落地），杯套上印邀請；純音樂又沒有留言：珍珠排出邀請。
// v2（「留言尺寸與版面比例標準 v2」）：落在牆上的字照標準（留言 40～60 px、署名 26～32、歌詞 40～52），
// 整塊縮在右邊 780×400 以內；杯子仍是主角，而且一直有事：
//  - 每一拍：冰塊被震得浮一下；大鼓一打珍珠堆跳一下（上面的跳得高）；奶茶裡一直有細細的氣泡往上冒；
//  - 每吐一顆珍珠：吸管被頂得晃一下，吸管口噴出幾滴奶茶；飛著的珍珠在牆上投一個淡淡的影子；
//  - 每個小節線：杯子外面一顆水珠沿著杯身滑下來，留下一道擦亮的水痕；
//  - 每兩小節：窗外有人走過，牆上的窗光被一道影子掃過；窗光本身也很慢地移動（午後的太陽）。
// 手法：一個全螢幕 shader 畫整個場景（牆的窗光、吧台、塑膠杯的反光與水珠、奶茶、冰塊、珍珠堆〔每顆是一個球，
// 位置在 uniform 陣列〕、吸管與吸管裡的珍珠、杯套〔Canvas 圖層照圓柱取樣〕）；飛出去的珍珠與字是另一張 Canvas 圖層。
// 鏡頭：切進來時貼近杯子，第一拍往後拉開露出右邊，之後很慢地推近。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, layout, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, mulberry32, lerp } from '../engine/util';
import { fitText } from '../engine/text';
import { Lyrics, type Line, type Word } from '../engine/lyrics';
import { drawHeart, lyricSubOf, layoutLyric, subStyleFor, subGap, drawLyricSub, type LyricStyle } from './_motifs';
import { grid, stagger, layoutRows, drawRows, paperInk } from './_t4';
import { msgBlockV2, INVITE, type MsgBlock } from './_t14';
import { shownLyric, sigOf, type Rect } from './_t24';
import { V2, lyricV2, fitClauses } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'local', paper: true, energy: [0.25, 0.9], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 杯子（頁面座標，y 向下）
const CX = 540, YT = 262, YB = 986, HT = 248, HB = 186;
/** 奶茶的液面、杯套的上下緣、吧台的桌面。 */
const YL = 318, SY0 = 548, SY1 = 772, TABLE = 1004;
/** 吸管：從杯蓋（A）往右上斜到吸管口（B）。 */
const SA = { x: CX + 64, y: YT }, SB = { x: CX + 150, y: 92 }, SR = 25;
const NP = 48, NSP = 10, ND = 3;
/** 留言（或歌詞）的框（v2：寬 ≤ 860、高 ≤ 430，放在右邊、杯子的旁邊）。 */
const BOX = { x: 980, y: 250, w: 780, h: 400 };
const SLW = 700, SLH = SY1 - SY0;
const FAM = F.hand(700), FAM_SIG = F.hand(400);
const FAM_LYR = F.archivo(100, 800);
const FLY = 0.42, SUCK = 0.16;

const hw = (y: number) => lerp(HT, HB, clamp((y - YT) / (YB - YT)));

const BG = () => new FSPass(/* glsl */ `
  uniform float t; uniform float zoom; uniform vec2 zc;
  uniform vec3 pl[${NP}];     // 珍珠：中心 x、y、半徑（頁面座標）
  uniform vec2 sp[${NSP}];    // 吸管裡的珍珠：沿吸管的位置 0..1、在不在
  uniform vec4 drops[${ND}];  // 滑下來的水珠：x、起點 y、現在的 y、在不在
  uniform sampler2D sleeve;
  uniform float kick; uniform float bob; uniform float walk; uniform vec2 sB;
  const float CX = ${CX}.0, YT = ${YT}.0, YB = ${YB}.0, HT = ${HT}.0, HB = ${HB}.0, YL = ${YL}.0;
  float hwAt(float y) { return mix(HT, HB, sat((y - YT) / (YB - YT))); }
  // 奶茶：紙色（牛奶）＋訊號色的暗部（茶）——燭光金是焦糖奶茶，鼠尾草變抹茶、薰衣草變芋頭，剛好
  // （紙色的藍太多，加多了會變成灰粉紅；茶色主要來自 blood，再帶一點訊號色）
  vec3 tea() { return (C_PAPER * 0.25 + C_BLOOD * 0.45 + C_SIGNAL * 0.1) * 1.08; }
  // 吸管的軸：A（杯蓋）→ sB（吸管口，吐珍珠時被頂得晃一下）；回傳到軸的距離與沿軸的位置（0 在 A、1 在 B）
  vec2 strawD(vec2 P) {
    vec2 A = vec2(${SA.x}.0, ${SA.y}.0);
    vec2 ba = sB - A; float h = dot(P - A, ba) / dot(ba, ba);
    return vec2(length(P - A - ba * h), h);
  }
  void main() {
    vec2 sp0 = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 P = (sp0 - zc) / zoom + zc;
    // ---- 牆：午後的窗光斜斜打在牆上（窗格的影子），很慢地往右移（太陽在走）；每兩小節窗外有人走過，一道影子掃過窗光
    vec2 wq = vec2(P.x - 0.45 * P.y - t * 1.5, P.y);
    float wpatch = smoothstep(80.0, 180.0, wq.x) * (1.0 - smoothstep(620.0, 760.0, wq.x)) * smoothstep(60.0, 260.0, P.y);
    float mull = 1.0 - 0.5 * (1.0 - smoothstep(6.0, 16.0, abs(wq.x - 360.0))) - 0.5 * (1.0 - smoothstep(6.0, 16.0, abs(P.y - 520.0)));
    wpatch *= 1.0 - 0.55 * exp(-pow((wq.x - walk) / 70.0, 2.0));
    // 杯子在牆上的影子（窗光從左上來，影子往右下偏）：擋掉窗光；光穿過奶茶那一段在影子裡聚成一片晃動的琥珀色光斑
    // （杯套、珍珠擋光；冰塊一浮、大鼓一打，光斑跟著晃）
    vec2 S = P - vec2(120.0, 46.0);
    float sdx = S.x - CX, shw = hwAt(S.y);
    float shadow = smoothstep(4.0, -10.0, abs(sdx) - shw) * smoothstep(YT - 8.0, YT + 8.0, S.y) * smoothstep(YB + 12.0, YB - 6.0, S.y);
    float thru = step(YL, S.y) * (1.0 - step(${SY0}.0, S.y) * step(S.y, ${SY1}.0)) * (1.0 - smoothstep(620.0, 680.0, S.y));
    float caus = pow(0.5 + 0.5 * snoise(vec2(S.x / 38.0 + 0.4 * bob, S.y / 55.0 + t * 0.35)), 3.0) * (0.6 + 0.8 * exp(-pow(sdx / (shw * 0.45), 2.0))) * (1.0 + 0.6 * kick);
    vec3 col = C_PAPER * (0.74 + 0.2 * wpatch * mull * (1.0 - 0.8 * shadow)) * (0.94 + 0.06 * smoothstep(0.0, 800.0, P.y));
    col += tea() * 0.3 * wpatch * shadow * thru * caus;
    // 右邊（字的後面）一片柔柔的亮
    col += C_PAPER * 0.1 * exp(-pow((P.x - 1370.0) / 520.0, 2.0) - pow((P.y - 450.0) / 380.0, 2.0));
    // ---- 吧台：淺色木頭，杯子的影子往右後方
    if (P.y > ${TABLE}.0) {
      float g = fbm(vec2(P.x / 900.0, P.y / 40.0), 3);
      col = mix(C_PAPER, C_SEPIA, 0.2 + 0.05 * g) * (0.9 + 0.1 * smoothstep(${TABLE}.0, ${TABLE + 60}.0, P.y));
      col *= 1.0 - 0.06 * (1.0 - smoothstep(${TABLE}.0, ${TABLE + 4}.0, P.y));
      vec2 sq = (P - vec2(CX + 170.0, ${TABLE + 14}.0)) / vec2(300.0, 14.0);
      col *= 1.0 - 0.3 * exp(-dot(sq, sq));
      // 光穿過奶茶打在桌上的一片琥珀色（跟著奶茶微微晃）
      vec2 cq = (P - vec2(CX + 250.0 + 6.0 * sin(t * 1.3), ${TABLE + 26}.0)) / vec2(160.0, 12.0);
      col += tea() * (0.1 + 0.03 * sin(t * 2.1 + P.x / 30.0)) * exp(-dot(cq, cq));
    }
    // ---- 杯子
    float dx = P.x - CX;
    float hwv = hwAt(P.y);
    float nx = dx / hwv;
    // 杯底：一個橢圓的底（坐在桌上）
    float inBody = step(YT, P.y) * step(abs(nx), 1.0) * step(P.y, YB + 16.0 * sqrt(max(0.0, 1.0 - nx * nx)));
    // 吸管在杯子上面的那一段（杯蓋之上）
    vec2 sd = strawD(P);
    if (inBody > 0.5) {
      float nz = sqrt(max(0.0, 1.0 - nx * nx));
      vec3 c;
      if (P.y > YL) {
        // 奶茶：中間厚一點（深），邊緣薄（淺、帶一點杯子的白）
        c = mix(tea() * 1.12, tea() * 0.9, nz);
        c *= 0.96 + 0.04 * snoise(vec2(P.x / 90.0, P.y / 260.0 + t * 0.05));
        // 細細的氣泡一直往上冒（珍珠堆上面那一段）
        if (P.y < 660.0) {
          vec2 bq = vec2(P.x, P.y + t * 46.0);
          vec2 bc = floor(bq / 30.0);
          vec2 bo = (bc + 0.2 + 0.6 * hash22(bc)) * 30.0 + vec2(3.0 * sin(t * 2.0 + bc.y), 0.0);
          float br = 1.2 + 2.2 * hash12(bc + 5.0);
          float bd = length(bq - bo);
          float bub = step(0.6, hash12(bc + 9.0)) * (1.0 - smoothstep(br - 0.8, br + 0.4, bd)) * smoothstep(YL + 20.0, YL + 60.0, P.y);
          c = mix(c, mix(c, C_BONE, 0.45), bub * (0.4 + 0.6 * smoothstep(br * 0.3, br, bd)));
        }
        // 珍珠堆：找最靠前（球面最高）的那一顆
        if (P.y > 640.0) {
          float best = -1.0; vec3 bp = vec3(0.0);
          for (int i = 0; i < ${NP}; i++) {
            vec3 q = pl[i];
            vec2 d = P - q.xy;
            float d2 = dot(d, d);
            if (d2 < q.z * q.z) {
              float hh = sqrt(q.z * q.z - d2) + q.z * 0.02 * float(i - (i / 7) * 7);
              if (hh > best) { best = hh; bp = q; }
            }
          }
          if (best > 0.0) {
            vec3 n = normalize(vec3((P - bp.xy) / bp.z, best / bp.z));
            n.y = -n.y;
            vec3 L = normalize(vec3(-0.5, 0.6, 0.62));
            float dif = max(dot(n, L), 0.0);
            vec3 pc = mix(C_SEPIA * 0.45, C_INK * 0.9, 0.45) * (0.45 + 0.7 * dif);
            pc += C_BONE * 0.55 * pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 24.0);
            pc += C_BLOOD * 0.1 * pow(1.0 - n.z, 2.0);
            // 泡在奶茶裡：邊緣被奶茶蓋掉一點
            c = mix(pc, c, 0.12 + 0.35 * pow(1.0 - n.z, 3.0));
          }
        }
      } else {
        // 液面以上：透過杯子看到後面的牆（有點霧）＋浮在上面的冰塊
        c = mix(col, C_BONE, 0.18);
      }
      // 冰塊：幾顆半透明的圓角方塊，卡在液面附近；每一拍被震得浮一下、轉一點
      for (int k = 0; k < 4; k++) {
        float fk = float(k);
        vec2 ic = vec2(CX - 150.0 + fk * 100.0 + 12.0 * sin(fk * 3.1), YL + 30.0 + 30.0 * sin(fk * 1.7) - bob * (6.0 + 4.0 * sin(fk * 2.7)));
        vec2 iq = rot2(0.3 * sin(fk * 2.3) + 0.05 * bob * sin(fk * 5.1)) * (P - ic);
        float idd = sdBox(iq, vec2(44.0, 38.0)) - 10.0;
        float ice = 1.0 - smoothstep(-1.5, 1.5, idd);
        vec3 icol = mix(c, C_BONE, 0.32) + C_BONE * 0.25 * (1.0 - smoothstep(0.0, 5.0, abs(idd + 5.0)));
        c = mix(c, icol, ice * 0.8);
      }
      // 杯套：牛皮紙（Canvas 圖層照圓柱展開取樣）
      if (P.y > ${SY0}.0 && P.y < ${SY1}.0) {
        vec2 uv = vec2(0.5 + asin(clamp(nx, -1.0, 1.0)) / PI, (P.y - ${SY0}.0) / ${SLH}.0);
        vec4 L = fastLayer(texture(sleeve, vec2(uv.x, 1.0 - uv.y)));
        vec3 kraft = mix(C_PAPER, C_BLOOD, 0.16) * 0.93;
        vec3 sc = kraft * (1.0 - L.a) + L.rgb;
        sc *= 0.72 + 0.3 * pow(nz, 0.6) + 0.05 * snoise(P / 3.0);
        c = sc;
      } else {
        // 塑膠杯：邊緣（掠射角）比較白、兩道直的窗光反光；水珠
        float fres = pow(1.0 - nz, 3.0);
        c = mix(c, C_BONE, 0.35 * fres);
        float hl = exp(-pow((nx + 0.62) / 0.05, 2.0)) * 0.5 + exp(-pow((nx - 0.78) / 0.025, 2.0)) * 0.3;
        c += C_BONE * hl * 0.5;
        vec2 dg = floor(P / 18.0);
        vec2 dc = (dg + 0.2 + 0.6 * hash22(dg)) * 18.0;
        float dr = 2.0 + 3.5 * hash12(dg + 3.0);
        float dd = length(P - dc);
        float drop = step(0.72, hash12(dg + 11.0)) * step(YL + 40.0, P.y) * (1.0 - smoothstep(dr - 1.0, dr, dd));
        // 滑下來的水珠：經過的地方小水珠被帶走、留下一道比較透的水痕，水珠本身圓圓亮亮的
        for (int k = 0; k < ${ND}; k++) {
          vec4 dp = drops[k];
          if (dp.w < 0.01) continue;
          float wob = 2.0 * sin((P.y - dp.y) / 30.0);
          float tx = abs(P.x - dp.x - wob);
          float along = step(dp.y, P.y) * step(P.y, dp.z);
          float trail = (1.0 - smoothstep(2.0, 4.0, tx)) * along * dp.w;
          drop *= 1.0 - (1.0 - smoothstep(4.0, 9.0, tx)) * step(dp.y, P.y) * step(P.y, dp.z + 6.0);
          c = mix(c, c * 0.86, trail * 0.9);
          c += C_BONE * 0.4 * trail * (1.0 - smoothstep(0.0, 1.2, abs(P.x - dp.x - wob + 1.5)));
          vec2 hq = (P - vec2(dp.x, dp.z)) / vec2(7.0, 9.5);
          float head = (1.0 - smoothstep(0.85, 1.05, length(hq))) * dp.w;
          c = mix(c, c * 0.78, head);
          c += C_BONE * 0.55 * head * (1.0 - smoothstep(0.0, 0.45, length(hq + vec2(0.3, 0.35))));
        }
        c = mix(c, c * 0.8, drop);
        c += C_BONE * 0.35 * drop * (1.0 - smoothstep(0.0, dr * 0.5, length(P - dc + vec2(dr * 0.35))));
      }
      // 杯子的邊（很細的深色輪廓）
      c *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 2.5, (1.0 - abs(nx)) * hwv));
      col = c;
    }
    // ---- 杯蓋：封口膜（從稍微上面看是一個扁橢圓），印著一圈圖案
    vec2 lq = (P - vec2(CX, YT)) / vec2(HT + 6.0, 24.0);
    float ld = length(lq);
    if (ld < 1.0) {
      vec3 film = mix(C_BONE, C_PAPER, 0.4) * (0.9 + 0.1 * lq.y);
      float ring = pxLine(abs(ld - 0.62) * 24.0, 0.8, 2.4);
      film = mix(film, C_SIGNAL * 0.8 + C_BLOOD * 0.1, 0.5 * ring);
      col = mix(col, film, 0.9);
      col *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.08, 1.0 - ld));
    }
    // ---- 吸管（杯蓋以上）：半透明、帶訊號色，裡面有正在被吸上去的珍珠；吸管口斜切
    float cutd = dot(P - sB, normalize(vec2(1.0, -0.7)));
    if (sd.x < ${SR}.0 && sd.y > 0.0 && cutd < 0.0 && P.y < YT + 4.0) {
      float u = sd.x / ${SR}.0;
      vec3 sc = mix(col, C_SIGNAL, 0.55) * (0.85 + 0.15 * sqrt(1.0 - u * u));
      // 吸管裡的珍珠
      for (int k = 0; k < ${NSP}; k++) {
        if (sp[k].y < 0.5) continue;
        vec2 pc = mix(vec2(${SA.x}.0, ${SA.y}.0), sB, sp[k].x);
        float pd = length(P - pc);
        float pm = 1.0 - smoothstep(19.0, 21.0, pd);
        vec3 pcol = mix(C_SEPIA * 0.45, C_INK, 0.45) + C_BONE * 0.4 * (1.0 - smoothstep(0.0, 6.0, length(P - pc + vec2(6.0, 6.0))));
        sc = mix(sc, pcol, pm * 0.9);
      }
      sc += C_BONE * 0.35 * exp(-pow((u - 0.45) / 0.12, 2.0));
      sc *= 1.0 - 0.3 * smoothstep(0.75, 1.0, u);
      col = sc;
    }
    fragColor = vec4(col, 1.0);
  }`, {
  t: { value: 0 }, zoom: { value: 1 }, zc: { value: new THREE.Vector2(CX, 540) }, kick: { value: 0 },
  bob: { value: 0 }, walk: { value: -1e4 }, sB: { value: new THREE.Vector2(SB.x, SB.y) },
  pl: { value: Array.from({ length: NP }, () => new THREE.Vector3(-999, -999, 1)) },
  sp: { value: Array.from({ length: NSP }, () => new THREE.Vector2(0, 0)) },
  drops: { value: Array.from({ length: ND }, () => new THREE.Vector4(0, 0, 0, 0)) },
  sleeve: { value: null },
});

/** 珍珠堆：六角形排列在杯底，稍微亂一點（整晚固定）。 */
const PILE: { x: number; y: number; r: number; row: number }[] = (() => {
  const rnd = mulberry32(31);
  const out: { x: number; y: number; r: number; row: number }[] = [];
  const r0 = 25;
  for (let row = 0; out.length < NP && row < 8; row++) {
    const y = YB - 6 - r0 - row * r0 * 1.62;
    const w = hw(y) - r0 - 6;
    const n = Math.floor((2 * w) / (r0 * 2.02)) + 1;
    for (let i = 0; i < n && out.length < NP; i++) {
      const x = CX - w + (row % 2 ? r0 * 0.9 : 0) + i * r0 * 2.02 + (rnd() - 0.5) * 6;
      if (Math.abs(x - CX) > w + 2) continue;
      // 最上面一層稀稀落落
      if (row >= 4 && rnd() < 0.45) continue;
      out.push({ x, y: y + (rnd() - 0.5) * 6, r: r0 * (0.92 + 0.14 * rnd()), row });
    }
  }
  return out;
})();

/** 一個字（或英文一個字）：頁面上的位置、落地的時間、跟唱用的 Word。 */
interface Glyph { ch: string; x: number; y: number; w: number; size: number; t: number; word?: Word; heart: boolean }

export default class BubbleTea extends Scene {
  bg = shared('bubbletea.bg', BG);
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  sleeve = this.track(new Layer2D(SLW, SLH, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 57 + (this.msg?.id ?? 0) * 23) >>> 0;
  block: MsgBlock | null = null;
  glyphs: Glyph[] = [];
  /** 每一句歌詞落在牆上的字；sub = 韓文歌的原文（小一號寫在中文正下方：左緣、第一排基線、主行字級）。 */
  lineGlyphs = new Map<Line, { gl: Glyph[]; size: number; sub?: { line: Line; x: number; y: number; size: number } }>();
  b0 = 0;
  /** 小節線（水珠滑下來）、窗外有人走過（每兩小節）的時間。 */
  bars: number[] = [];
  walks: number[] = [];
  sleeveSig = '';
  lyrSize: number = V2.lyrMax;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const gr = grid(au, s, e);
    this.b0 = gr.b0;
    this.bars = gr.bars.length ? gr.bars : [gr.bar0];
    this.walks = this.bars.filter((_, i) => i % 2 === 1);
    const lines = m ? [] : lyrics.linesIn(s - 4, e).filter((l) => l.end > s - 1.5);
    await loadText(`${m?.text ?? ''}${m ? sigOf(m) : ''}${INVITE}${lines.map((l) => l.text).join('')}${song.title}FROM THE COUPLE · 新人`);
    const c = this.layer.ctx;
    /** 沒有留言時落在牆上的字（歌詞或邀請）：v2 歌詞的字級（≤ 52），照子句斷行。 */
    const fitLyric = (text: string) => fitClauses(c, text, FAM, BOX.w, BOX.h, { min: V2.lyrMin, max: lyricV2(null), lineHeight: 1.3, maxLines: 3 })
      ?? fitText(c, text, FAM, BOX.w, BOX.h, { min: V2.lyrMin, max: lyricV2(null), lineHeight: 1.3, maxLines: 3 });
    if (m) {
      const b = (this.block = msgBlockV2(c, m, FAM, BOX, { align: 'left', sigFamily: FAM_SIG, lineHeight: 1.32 }));
      const gl = this.glyphsOf(b.lines, b.fit.size);
      const ts = stagger(au, gr.b0, gl.length, Math.min(gr.bar * 1.75, Math.max(gr.beat * 2, (e - gr.b0) * 0.5)));
      gl.forEach((g, i) => { g.t = ts[i]!; });
      this.glyphs = gl;
      this.lyrSize = lyricV2(b.fit.size);
      this.avoid = [b.box];
    } else if (!lines.length) {
      const ft = fitLyric(INVITE);
      const top = BOX.y + (BOX.h - ft.height) / 2 + ft.size * 0.88;
      const gl = this.glyphsOf(ft.lines.map((ln, i) => ({ text: ln, x: BOX.x, y: top + i * ft.lineHeight })), ft.size);
      const ts = stagger(au, gr.b0, gl.length, gr.bar * 1.75);
      gl.forEach((g, i) => { g.t = ts[i]!; });
      this.glyphs = gl;
      this.avoid = [[BOX.x, BOX.y, BOX.w, BOX.h]];
    } else {
      // 沒有留言：每一句歌詞排一次；每個字（英文一個字）在它開始唱的那一刻落地
      for (const l of lines) {
        // 有原文（韓文歌）：中文只用框的上三分之二，原文排在正下方，整組在框裡置中
        const sub = lyricSubOf(l);
        const ft = sub
          ? fitClauses(c, l.text, FAM, BOX.w, BOX.h * 0.66, { min: V2.lyrMin, max: lyricV2(null), lineHeight: 1.3, maxLines: 3 }) ?? fitText(c, l.text, FAM, BOX.w, BOX.h * 0.66, { min: V2.lyrMin, max: lyricV2(null), lineHeight: 1.3, maxLines: 3 })
          : fitLyric(l.text);
        let hAll = ft.height, gap = 0;
        if (sub) {
          const sl = layoutLyric(c, sub, subStyleFor(this.subStyle(ft.size), ft.size));
          gap = subGap(ft.size, sl.size);
          hAll = ft.size + (ft.lines.length - 1) * ft.lineHeight + gap + sl.height - sl.size + sl.size * 0.25;
        }
        const top = BOX.y + (BOX.h - hAll) / 2 + ft.size * 0.88;
        const gl = this.glyphsOf(ft.lines.map((ln, i) => ({ text: ln, x: BOX.x, y: top + i * ft.lineHeight })), ft.size, l);
        this.lineGlyphs.set(l, { gl, size: ft.size, sub: sub ? { line: sub, x: BOX.x, y: top + (ft.lines.length - 1) * ft.lineHeight + gap, size: ft.size } : undefined });
      }
      this.avoid = [[BOX.x, BOX.y, BOX.w, BOX.h]];
    }
  }

  /** 原文的樣式：跟落地的字同一支筆、同樣左對齊，唱到的字是墨色（不用 blood），還沒唱的淡淡的。 */
  private subStyle(size: number): LyricStyle {
    return { family: FAM, size, maxWidth: BOX.w, align: 'left', ...paperInk() };
  }

  /** 排好的行 → 一個個字（英文連著的字母算一個）；歌詞的話記下每個字屬於哪個 Word、落地時間 = 那個 Word 開始唱。 */
  private glyphsOf(lines: { text: string; x: number; y: number }[], size: number, line?: Line): Glyph[] {
    const out: Glyph[] = [];
    let cursor = 0;
    for (const ln of lines) {
      const lay = layout(ln.text, FAM, size);
      let i = 0;
      while (i < lay.glyphs.length) {
        const g = lay.glyphs[i]!;
        if (!g.ch.trim()) { i++; continue; }
        let ch = g.ch, w = g.w, j = i + 1;
        if (/[A-Za-z0-9'’]/.test(g.ch)) {
          while (j < lay.glyphs.length && /[A-Za-z0-9'’!?.,&]/.test(lay.glyphs[j]!.ch)) { ch += lay.glyphs[j]!.ch; w = lay.glyphs[j]!.x + lay.glyphs[j]!.w - g.x; j++; }
        }
        const src = line ? line.text : '';
        const at = line ? src.indexOf(ch, cursor) : -1;
        if (at >= 0) cursor = at + ch.length;
        const word = line?.words.find((wd) => at >= wd.o && at < wd.o + wd.w.length);
        out.push({ ch, x: ln.x + g.x, y: ln.y, w, size, t: word ? word.start : 0, word, heart: ch === '♥' });
        i = j;
      }
    }
    return out;
  }

  /** 吸管口（頁面座標）。 */
  private mouth() { return { x: SB.x + 6, y: SB.y - 8 }; }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    // ---- 鏡頭：切進來貼近杯子，第一拍往後拉開，之後慢慢推近
    const open = ease.outCubic(prog(t, s, Math.max(s + 0.5, this.b0 + 0.25)));
    const pe = ease.inOutQuad(clamp((t - s) / Math.max(1, e - s)));
    const zoom = lerp(1.22, 1, open) + 0.035 * pe;
    const zc = { x: lerp(CX + 60, 960, open), y: lerp(560, 520, open) };
    // ---- 這一格顯示的字
    let gl: Glyph[] = this.glyphs, lineAlpha = 1, line: Line | null = null;
    if (!this.msg && this.lineGlyphs.size) {
      const sl = shownLyric(lyrics, t, s, e);
      line = sl?.line ?? null;
      const set = line ? this.lineGlyphs.get(line) : null;
      gl = set?.gl ?? [];
      lineAlpha = sl ? (sl.live ? sl.k : 1) : 0;
    }
    // ---- 珍珠堆：大鼓一打整堆跳一下（上面的跳得高），每顆稍微不同步
    const u = this.bg.u;
    const pl = u.pl!.value as THREE.Vector3[];
    for (let i = 0; i < NP; i++) {
      const p = PILE[i];
      if (!p) { pl[i]!.set(-999, -999, 1); continue; }
      const jump = (5 + p.row * 7) * f.a.kick * (0.6 + 0.4 * hash(i, 3));
      pl[i]!.set(p.x + 1.5 * Math.sin(t * 1.3 + i), p.y - jump, p.r);
    }
    // ---- 吸管裡的珍珠；吐出去那一下吸管被頂得晃一下（阻尼的擺動）
    const sp = u.sp!.value as THREE.Vector2[];
    let nsp = 0, recoil = 0;
    for (const g of gl) {
      const a = g.t - FLY - SUCK;
      if (t >= a && t < g.t - FLY && nsp < NSP) sp[nsp++]!.set((t - a) / SUCK, 1);
      const d = t - (g.t - FLY);
      if (d > 0 && d < 0.6) recoil += Math.exp(-d * 9) * Math.sin(d * 38) * lineAlpha;
    }
    for (let k = nsp; k < NSP; k++) sp[k]!.set(0, 0);
    (u.sB!.value as THREE.Vector2).set(SB.x + 6 * recoil, SB.y - 3 * recoil);
    // ---- 每一拍冰塊浮一下；每兩小節窗外有人走過；每個小節線一顆水珠沿著杯身滑下來
    const bp = f.beatPhase;
    u.bob!.value = Math.sin(Math.min(1, bp * 3) * Math.PI) * Math.exp(-bp * 2);
    let walk = -1e4;
    for (const tw of this.walks) { const k = (t - tw) / 1.6; if (k >= 0 && k <= 1) walk = lerp(-60, 860, ease.inOutQuad(k)); }
    u.walk!.value = walk;
    const dr = u.drops!.value as THREE.Vector4[];
    let nd = 0;
    for (let i = this.bars.length - 1; i >= 0 && nd < ND; i--) {
      const tb = this.bars[i]!, age = t - tb;
      if (age < 0 || age > 2.6) continue;
      // 單數的從杯套上面滑下來（滑進杯套底下），雙數的從杯套下面滑到杯底
      const top = i % 2 === 0;
      const y0 = top ? YL + 50 + 60 * hash(tb, 2) : SY1 + 20 + 50 * hash(tb, 2);
      const yEnd = top ? SY0 + 10 : YB - 10;
      const y = Math.min(yEnd, y0 + 40 * age + 150 * age * age);
      const x = CX + (hash(tb, 1) - 0.5) * 1.4 * hw(y0);
      dr[nd++]!.set(x, y0, y, clamp((2.6 - age) / 0.5));
    }
    for (let k = nd; k < ND; k++) dr[k]!.set(0, 0, 0, 0);
    // ---- 杯套（歌詞或邀請）
    this.drawSleeve(t);
    // ---- 字與飛出去的珍珠
    const L = this.layer; L.clear();
    const c = L.ctx;
    c.setTransform(zoom, 0, 0, zoom, zc.x * (1 - zoom), zc.y * (1 - zoom));
    this.drawGlyphs(c, gl, t, lineAlpha, line);
    // 原文（韓文歌）：不是珍珠變的，直接淡淡地寫在牆上、中文正下方（跟著同一個鏡頭）
    const sub = line ? this.lineGlyphs.get(line)?.sub : undefined;
    if (sub) {
      c.save(); c.translate(sub.x, sub.y);
      drawLyricSub(c, sub.line, t, this.subStyle(sub.size), sub.size, lineAlpha);
      c.restore();
    }
    c.setTransform(1, 0, 0, 1, 0, 0);

    u.t!.value = t;
    u.zoom!.value = zoom;
    (u.zc!.value as THREE.Vector2).set(zc.x, zc.y);
    u.kick!.value = f.a.kick;
    u.sleeve!.value = this.sleeve.texture;
    this.bg.render(renderer, out);
    comp.draw(renderer, L.upload(), out);
    // 退場：最後一下輕輕推近（硬切在小節線上）；大鼓時杯子這一側微微一震
    const exit = prog(t, e - 0.35, e, ease.inCubic);
    return { paper: 1, bloom: 0.3, vignette: 0.4, zoom: 1 + 0.003 * f.a.kick + 0.02 * exit, popupAvoid: this.avoid };
  }

  /**
   * 字：落地前是一顆飛著的珍珠（從吸管口拋物線飛過去，牆上跟著一個淡淡的影子），落地那一刻珍珠縮小、字從珍珠長出來（彈一下）。
   * 珍珠吐出來那一下，吸管口噴出幾滴奶茶。歌詞：正在唱是 blood、唱完是墨色；還沒唱的字淡淡的先在那裡。
   */
  private drawGlyphs(c: CanvasRenderingContext2D, gl: Glyph[], t: number, alpha: number, line: Line | null) {
    const M = this.mouth();
    c.textBaseline = 'alphabetic';
    c.globalAlpha = alpha;
    for (let gi = 0; gi < gl.length; gi++) {
      const g = gl[gi]!;
      const cx = g.x + g.w / 2, cy = g.y - g.size * 0.36;
      const tl = g.t;
      // 吸管口噴出來的奶茶（幾滴，往右上噴、落下）
      const ds = t - (tl - FLY);
      if (ds > 0 && ds < 0.55) {
        c.fillStyle = mixRgba('blood', 'paper', 0.35, 0.75 * (1 - ds / 0.55));
        for (let k = 0; k < 4; k++) {
          const vx = 60 + 140 * hash(gi, k, 1), vy = -(120 + 160 * hash(gi, k, 2));
          c.beginPath(); c.arc(M.x + vx * ds, M.y + vy * ds + 900 * ds * ds, 2.2 + 1.8 * hash(gi, k, 3), 0, Math.PI * 2); c.fill();
        }
      }
      // 飛行中的珍珠（大小跟字差不多）與它在牆上的影子
      if (t >= tl - FLY && t < tl + 0.12) {
        const q = clamp((t - (tl - FLY)) / FLY);
        const x = lerp(M.x, cx, q), y = lerp(M.y, cy, q) - 70 * 4 * q * (1 - q);
        const r = g.size * 0.36 * (t < tl ? 1 : 1 - clamp((t - tl) / 0.12));
        if (r > 0.5) {
          // 影子：珍珠離牆越遠（飛在中間）影子越偏、越淡
          const off = 10 + 26 * 4 * q * (1 - q);
          const sg = c.createRadialGradient(x + off, y + off * 1.3, 0, x + off, y + off * 1.3, r * 1.6);
          sg.addColorStop(0, rgba('sepia', 0.16)); sg.addColorStop(1, rgba('sepia', 0));
          c.fillStyle = sg; c.beginPath(); c.arc(x + off, y + off * 1.3, r * 1.6, 0, Math.PI * 2); c.fill();
          const pg = c.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
          pg.addColorStop(0, rgba('graphite')); pg.addColorStop(0.35, rgba('sepia')); pg.addColorStop(1, rgba('ink'));
          c.fillStyle = pg; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
          c.fillStyle = rgba('bone', 0.7); c.beginPath(); c.arc(x - r * 0.35, y - r * 0.4, r * 0.22, 0, Math.PI * 2); c.fill();
        }
      }
      // 字
      const ink = paperInk();
      let col = ink.sung;
      if (g.word) {
        const p = Lyrics.wordProgress(g.word, t);
        col = p <= 0 ? ink.unsung : p < 1 ? ink.active : ink.sung;
      }
      const grow = t < tl ? 0 : ease.outBack(clamp((t - tl) / 0.26), 2.2);
      if (grow <= 0) {
        // 歌詞：還沒唱的字淡淡的先在那裡
        if (line && g.word) {
          c.font = font(FAM, g.size); c.fillStyle = ink.unsung;
          c.globalAlpha = alpha * 0.55;
          if (g.heart) drawHeart(c, cx, cy, g.size * 0.8, rgba('rose', 0.3)); else c.fillText(g.ch, g.x, g.y);
          c.globalAlpha = alpha;
        }
        continue;
      }
      c.save();
      c.translate(cx, cy); c.scale(grow, grow); c.translate(-cx, -cy);
      if (g.heart) drawHeart(c, cx, cy, g.size * 0.8, rgba('rose'));
      else { c.font = font(FAM, g.size); c.fillStyle = col; c.fillText(g.ch, g.x, g.y); }
      c.restore();
    }
    // 署名、新人標籤
    if (this.block && this.msg && gl.length) {
      const last = gl[gl.length - 1]!, b = this.block;
      c.globalAlpha = alpha * clamp((t - last.t - 0.25) / 0.4);
      c.font = font(FAM_SIG, b.sig.size); c.fillStyle = rgba('sepia', 0.8);
      c.fillText(b.sig.text, b.sig.x, b.sig.y);
      if (this.msg.couple) {
        c.font = font(F.mono(500), 18); c.letterSpacing = '4px'; c.fillStyle = rgba('blood');
        c.fillText('FROM THE COUPLE · 新人', BOX.x, b.box[1] - 16);
        c.letterSpacing = '0px';
      }
    }
    c.globalAlpha = 1;
  }

  /** 杯套：有留言印歌詞（逐字跟唱）；沒有留言印邀請。牛皮紙的底由 shader 上色，這裡只畫字與細線。 */
  private drawSleeve(t: number) {
    const { lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const ly = this.msg ? shownLyric(lyrics, t, s, e) : null;
    const sig = ly ? `${ly.line.start}:${t >= ly.line.start - 0.05 && t <= ly.line.end + 0.05 ? t.toFixed(3) : t < ly.line.start ? 'pre' : 'post'}:${ly.k.toFixed(2)}` : 'static';
    if (sig === this.sleeveSig) return;
    this.sleeveSig = sig;
    const L = this.sleeve, c = L.ctx;
    L.clear();
    c.fillStyle = rgba('blood', 0.7);
    c.fillRect(0, 10, SLW, 3); c.fillRect(0, SLH - 13, SLW, 3);
    c.textBaseline = 'alphabetic';
    if (ly) {
      // 杯套中間 1 貼圖 px ≈ 1 螢幕 px：v2 歌詞字級直接用
      const st = { family: FAM_LYR, size: this.lyrSize, minSize: V2.lyrMin, maxW: SLW * 0.6, maxRows: 3, align: 'center' as const, lineHeight: 1.1 };
      const lay = layoutRows(c, ly.line, st);
      c.save(); c.translate(SLW / 2, SLH / 2 - lay.height / 2 + lay.size * 0.82);
      drawRows(c, lay, FAM_LYR, t, paperInk(), ly.k);
      c.restore();
    } else if (!this.msg && this.lineGlyphs.size) {
      const ft = fitText(c, INVITE, F.hei(700), SLW * 0.56, SLH - 60, { min: 22, max: 34, lineHeight: 1.35, maxLines: 3 });
      c.font = font(F.hei(700), ft.size); c.fillStyle = rgba('sepia', 0.85); c.textAlign = 'center';
      ft.lines.forEach((ln, i) => c.fillText(ln, SLW / 2, SLH / 2 - ft.height / 2 + ft.size * 0.85 + i * ft.lineHeight));
      c.textAlign = 'left';
    } else {
      drawHeart(c, SLW / 2, SLH / 2, 60, rgba('rose'));
    }
    L.upload();
  }
}
