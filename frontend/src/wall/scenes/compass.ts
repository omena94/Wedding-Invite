// 羅盤（批次 T18・儀器，亮）：一只黃銅的懷錶式羅盤躺在航海圖上，鏡頭斜斜地從上面看。
//  - 切進來時蓋子是闔著的（蓋子外面是一圈一圈的鈔票紋），第一拍「喀」一聲卡榫彈開一點；
//    揭曉（小節線）時蓋子繞著鉸鏈翻開、「啪」地躺平彈一下——蓋子內側刻著主打留言（刻進黃銅的字，凹槽有明暗）。
//  - 錶面：版畫刻線的十六方位玫瑰、一圈度數刻度，北方寫的不是 N，是「幸福」。
//    歌詞沿著錶面外圈刻成一圈字（上半圈由左到右、長的話接到下半圈），逐字跟唱；
//    指針在唱到的那個字上擺過去指著它（真的指針：有慣性、會晃、在拍點被震一下），句子唱完、窗格最後一小節，
//    指針回到「幸福」、穩穩停住。
//  - 沒有留言：蓋子內側刻新人的名字與日期、一行邀請；歌詞是主角。
// 畫法：航海圖、黃銅（有法向量的假 3D：錶殼的圓環、鉸鏈、指針的稜線）、刻線玫瑰、蓋子翻開（沿鉸鏈的投影）
// 全部在一個全螢幕 shader 裡程序化畫出來（PlaneCam：整張航海圖是空間裡的平面，鏡頭會推、會搖）；
// 蓋子上的字是一張遮罩（刻字的明暗在 shader 算），外圈的歌詞與方位字是每格重畫的一張 Canvas。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog, springStep, TAU } from '../engine/util';
import { Lyrics, type Line } from '../engine/lyrics';
import { lyricAt, fillWithHearts, drawHeart, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { grid, paperInk, type Grid } from './_t4';
import { PlaneCam, camUniforms, CAM_GLSL, type MsgBlock } from './_t14';
import { loadWindow, revealAt, beatsBetween, v2Block } from './_t18';
import { lyricV2, V2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'science', paper: true, energy: [0.2, 0.85], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 版面（航海圖座標 = 鏡頭在正前方時的螢幕座標）
/** 錶身（下）的中心、半徑；鉸鏈；打開後蓋子的中心。 */
// v2：整只羅盤往左上收（右下角 HUD 底下要乾淨），蓋子內側寫字的那一塊 ≤ 500×380
const BC = { x: 470, y: 432 }, R = 350;
const HINGE = BC.x + R + 18;
const LC = { x: 2 * HINGE - BC.x, y: BC.y };
/** 錶面各圈：錶殼內緣、刻度、歌詞的基線、方位字。 */
const R_FACE = 312, R_TICK0 = 290, R_TICK1 = 309, R_LYR = 252, R_LABEL = 216;
/** 歌詞一圈最多用多大的角度（上半圈、下半圈各一段）。 */
const ARC_SPAN = 2.45;
/** 蓋子內側寫字的範圍（打開後的位置）。 */
const MBOX = { x: LC.x - 236, y: LC.y - 182, w: 472, h: 364 };
const NORTH = -Math.PI / 2;
/** 航海圖下方的航線（轉折點）：羅盤下面、右下角 HUD 的左邊。 */
const ROUTE: [number, number][] = [[150, 950], [360, 900], [560, 954], [770, 904], [980, 944], [1170, 910]];
const FAM_MSG = F.ming(700);
const FAM_SIG = F.hand(400);
const FAM_LYR = F.archivo(100, 800);
const FAM_LYR_N = F.archivo(62, 800);
const NORTH_LABEL = '幸福';
const INVITE = '掃描右下角 QR code，把祝福刻上來';

const BG = () => new FSPass(/* glsl */ `
  ${CAM_GLSL}
  uniform sampler2D msgT; uniform sampler2D lyrT;
  uniform float t; uniform float lidA; uniform float needle; uniform float glintX; uniform float glintK; uniform float nOn;
  const vec2 BC = vec2(${BC.x}.0, ${BC.y}.0);
  const float R = ${R}.0, HX = ${HINGE}.0;
  const vec3 LD = normalize(vec3(-0.5, -0.62, 0.62)); // 光從左上來（y 向下）
  vec3 brass() { return mix(C_SEPIA, C_SIGNAL, 0.5); }
  vec3 metal(vec3 alb, vec3 n, float gloss) {
    float dif = max(dot(n, LD), 0.0);
    vec3 h = normalize(LD + vec3(0.0, 0.0, 1.0));
    float sp = pow(max(dot(n, h), 0.0), 36.0);
    // 環境反射：朝上的面映著亮的房間、朝下的映著暗的桌面
    float env = 0.5 + 0.5 * (-n.y * 0.6 + n.z * 0.4);
    return alb * (0.32 + 0.62 * dif + 0.25 * env) + mix(C_PAPER, C_EMBER, 0.35) * sp * gloss;
  }
  /** 錶殼的圓環（r 在 r0..r1 之間像一條管子）：回傳法向量。 */
  vec3 ringN(vec2 q, float r, float r0, float r1) {
    float u = clamp((r - 0.5 * (r0 + r1)) / (0.5 * (r1 - r0)), -1.0, 1.0);
    return normalize(vec3(normalize(q) * u, sqrt(max(1.0 - u * u, 0.02))));
  }
  float tri(vec2 p, float L, float w) { return (p.x < 0.0 || p.x > L) ? -1.0 : w * (1.0 - p.x / L) - abs(p.y); }
  void main() {
    vec2 sp = SP();
    vec2 P = pcHit(sp, 0.0).xy;
    // ---- 航海圖
    vec3 col = C_PAPER * (0.9 + 0.05 * fbm(P / 320.0, 3) + 0.015 * snoise(P / 3.0));
    float ink = 0.0;
    // 恆向線：從兩個（畫面外的）羅經點放射出去
    for (int k = 0; k < 2; k++) {
      vec2 O = k == 0 ? vec2(1780.0, 1010.0) : vec2(90.0, 90.0);
      vec2 d = P - O; float rr = length(d), an = atan(d.y, d.x);
      float st = PI / 16.0, da = abs(mod(an + st * 0.5, st) - st * 0.5) * rr;
      ink += 0.1 * pxLine(da, 0.3, 1.1);
    }
    // 經緯線（很淡）與一條海岸線
    vec2 gq = abs(mod(P + 80.0, 240.0) - 120.0);
    ink += 0.07 * pxLine(min(gq.x, gq.y), 0.3, 1.0);
    float land = fbm(P / 520.0 + vec2(3.1, 7.7), 4) - 0.18 + (P.y - 900.0) / 2600.0;
    float lw = fwidth(land);
    ink += 0.22 * pxLine(abs(land) / max(lw, 1e-4), 0.5, 1.5);
    ink += 0.07 * hatch((P.x + P.y) / 7.0, 0.35) * step(0.0, land);
    col = mix(col, C_SEPIA, clamp(ink, 0.0, 1.0));
    // 航海圖上用鉛筆畫的航線（跟外圈歌詞同一張 Canvas；錶身會蓋在上面）
    vec4 chA = fastLayer(texture(lyrT, pageUV(P)));
    col = col * (1.0 - chA.a) + chA.rgb;
    // ---- 影子（錶身與打開的蓋子，偏右下）
    float c = cos(lidA), s = sin(lidA);
    float sc = 1.0 / (1.0 - 0.2 * s);
    float shB = 1.0 - smoothstep(-26.0, 30.0, length(P - BC - vec2(16.0, 26.0)) - R);
    vec2 lidC = vec2(HX - (HX - BC.x) * c * sc, BC.y);
    vec2 lp = (P - lidC - vec2(16.0 + 60.0 * s, 26.0 + 40.0 * s)) / vec2(max(abs(c), 0.05) * sc, sc);
    float shL = (1.0 - smoothstep(-26.0 - 40.0 * s, 30.0 + 60.0 * s, length(lp) - R)) * (0.6 + 0.4 * abs(c));
    col *= 1.0 - 0.3 * max(shB, shL);
    // ---- 錶身
    vec2 q = P - BC; float r = length(q), a = atan(q.y, q.x);
    // 用到螢幕導數的東西都在分支外面算（分支裡的 fwidth 沒有定義）：玫瑰的刻線、一個像素在航海圖上多大
    float hh = hatch(dot(q, vec2(0.7, 0.7)) / 4.2, 0.55);
    float pw = max(length(fwidth(P)) * 0.7071, 1e-3);
    if (r < R + 1.0) {
      vec3 bc;
      if (r > R_FACE_) {
        // 錶殼：一圈黃銅管，外緣壓花
        vec3 n = ringN(q, r, R_FACE_, R);
        n.xy += 0.12 * sin(a * 220.0) * smoothstep(R - 16.0, R - 4.0, r);
        bc = metal(brass(), normalize(n), 1.0);
      } else {
        // 錶面：白色琺瑯
        bc = mix(C_PAPER, C_BONE, 0.5) * (0.97 + 0.03 * fbm(q / 90.0, 2));
        float dk = 0.0;
        // 刻度：每 2 度一條、每 10 度長一點、每 30 度最長
        float st = PI / 90.0, da = abs(mod(a + st * 0.5, st) - st * 0.5) * r;
        float big = step(abs(mod(a + PI / 36.0, PI / 18.0) - PI / 36.0), st * 0.5);
        float big3 = step(abs(mod(a + PI / 12.0, PI / 6.0) - PI / 12.0), st * 0.5);
        float rt0 = mix(R_TICK0_ + 8.0, R_TICK0_ - 4.0 * big3, big);
        dk = max(dk, pxLine(da, mix(0.35, 0.8, big), mix(1.0, 1.6, big)) * step(rt0, r) * step(r, R_TICK1_));
        dk = max(dk, 0.8 * pxLine(abs(r - R_TICK1_), 0.4, 1.2));
        dk = max(dk, 0.5 * pxLine(abs(r - 206.0), 0.3, 1.0));
        dk = max(dk, 0.35 * pxLine(abs(r - 104.0), 0.3, 1.0));
        // 十六方位玫瑰（版畫：每個尖角一半留白、一半刻線）
        float roseInk = 0.0, roseN = 0.0;
        for (int k = 0; k < 16; k++) {
          int lvl = (k % 4 == 0) ? 0 : ((k % 2 == 0) ? 1 : 2);
          float L = lvl == 0 ? 196.0 : (lvl == 1 ? 140.0 : 94.0);
          float w = lvl == 0 ? 27.0 : (lvl == 1 ? 19.0 : 13.0);
          float ang = -PI * 0.5 + float(k) * PI / 8.0;
          vec2 p = vec2(cos(ang) * q.x + sin(ang) * q.y, -sin(ang) * q.x + cos(ang) * q.y);
          float d = tri(p, L, w);
          float fw = pw;
          float inside = smoothstep(-fw, fw, d);
          if (inside > 0.0) {
            float edge = pxLine(abs(d) / fw, 0.6, 1.6);
            float half_ = step(0.0, p.y);
            // 蓋掉底下比較短的尖角
            roseInk = mix(roseInk, max(edge, half_ * hh * 0.9), inside);
            roseN = mix(roseN, (k == 0 ? 1.0 : 0.0) * half_, inside);
          }
        }
        // 北方的尖角塗上訊號色的暗部
        bc = mix(bc, mix(C_BLOOD, C_SIGNAL, 0.35), roseN * 0.85);
        dk = max(dk, roseInk * (1.0 - roseN * 0.6));
        bc = mix(bc, C_SEPIA, clamp(dk, 0.0, 1.0) * 0.85);
        // 外圈的歌詞與方位字（Canvas，已經是最終的顏色）
        vec4 ly = fastLayer(texture(lyrT, pageUV(P)));
        bc = bc * (1.0 - ly.a) + ly.rgb;
        // 指針（有稜線的鋼片，北邊是訊號色）與它的影子
        if (nOn > 0.0) {
          vec2 nd = vec2(cos(needle), sin(needle));
          vec2 np = vec2(dot(q, nd), -q.x * nd.y + q.y * nd.x);
          vec2 npS = vec2(dot(q - vec2(7.0, 10.0), nd), -(q.x - 7.0) * nd.y + (q.y - 10.0) * nd.x);
          float dS = max(tri(npS, 236.0, 12.5), tri(vec2(-npS.x, npS.y), 170.0, 12.5));
          bc *= 1.0 - 0.28 * smoothstep(-4.0, 6.0, dS) * nOn;
          float dN = tri(np, 236.0, 12.5), dSo = tri(vec2(-np.x, np.y), 170.0, 12.5);
          float fN = smoothstep(-0.8, 0.8, dN), fS = smoothstep(-0.8, 0.8, dSo);
          float ridge = np.y > 0.0 ? 0.72 : 1.08;
          vec3 cn = mix(C_BLOOD, C_SIGNAL, 0.38) * ridge;
          vec3 cs = mix(C_SEPIA, C_ASH, 0.35) * ridge;
          bc = mix(bc, cn, fN * nOn);
          bc = mix(bc, cs, fS * nOn);
          // 軸心：一顆黃銅小帽
          float rc = length(q);
          vec3 capN = normalize(vec3(q / 16.0, sqrt(max(1.0 - dot(q, q) / 256.0, 0.02))));
          bc = mix(bc, metal(brass(), capN, 1.2), (1.0 - smoothstep(15.0, 16.5, rc)) * nOn);
        }
        // 玻璃：斜斜一道很寬的反光、內緣一圈亮邊
        float gl = exp(-pow((dot(q, vec2(0.62, 0.78)) + 120.0) / 90.0, 2.0));
        bc += C_BONE * 0.05 * gl;
        bc *= 1.0 - 0.18 * smoothstep(R_FACE_ - 30.0, R_FACE_, r);
      }
      col = mix(bc, col, smoothstep(R - 1.0, R + 1.0, r));
    }
    // ---- 鉸鏈（一小截直立的黃銅管）
    {
      float u = (P.x - HX) / 13.0;
      if (abs(u) < 1.0 && abs(P.y - BC.y) < 56.0) {
        vec3 n = normalize(vec3(u, 0.0, sqrt(1.0 - u * u)));
        vec3 hc = metal(brass(), n, 1.0) * (0.85 + 0.15 * step(0.5, fract((P.y - BC.y) / 37.0 + 0.5)));
        col = hc;
      }
    }
    // ---- 蓋子（繞著鉸鏈翻：闔著時蓋在錶身上，打開後躺在右邊；c > 0 看到外面，c < 0 看到內側）
    // 蓋子的座標與鈔票紋在分支外面算（fwidth 要在一致的控制流裡）
    float cc = abs(c) > 0.015 ? c : 0.015;
    float ul = (HX - P.x) / (cc * sc), vl = (P.y - BC.y) / sc;
    vec2 lq = vec2(ul - (HX - BC.x), vl);
    float lr = length(lq), la = atan(lq.y, lq.x);
    float g1 = sin(lr * 0.32 + 5.0 * sin(la * 12.0 + lr * 0.018));
    float g2 = sin(lr * 0.3 - 5.0 * sin(la * 12.0 - lr * 0.02));
    float gw1 = max(fwidth(g1), 1e-3), gw2 = max(fwidth(g2), 1e-3);
    if (abs(c) > 0.015) {
      if (ul > 0.0 && lr < R + 1.0) {
        // 蓋子受光：翻起來的時候面朝鏡頭側邊
        vec3 fn = normalize(vec3(-s * sign(c), 0.0, abs(c)));
        float lit = 0.72 + 0.35 * dot(fn, normalize(vec3(-0.5, -0.3, 0.8)));
        vec3 lc;
        if (lr > R_FACE_) {
          vec3 n = ringN(lq * vec2(c < 0.0 ? -1.0 : 1.0, 1.0), lr, R_FACE_, R);
          lc = metal(brass(), n, 1.0) * lit;
        } else if (c > 0.0) {
          // 外面：鈔票紋（一圈一圈的波紋刻線）
          float gg = pxLine(abs(g1) / gw1, 0.3, 1.1) * 0.5 + pxLine(abs(g2) / gw2, 0.3, 1.1) * 0.5;
          vec3 n = normalize(vec3(lq / R * 0.25, 1.0));
          lc = metal(brass(), n, 0.6) * lit * (1.0 - 0.5 * gg * smoothstep(40.0, 70.0, lr) * (1.0 - smoothstep(R_FACE_ - 40.0, R_FACE_ - 20.0, lr)));
          lc *= 1.0 - 0.25 * pxLine(abs(lr - (R_FACE_ - 26.0)), 0.5, 1.5);
          // 闔著的時候歌詞刻在蓋子外面的同一圈（蓋子翻起來時跟著轉走）
          vec4 lb = fastLayer(texture(lyrT, pageUV(vec2(HX - ul, BC.y + vl))));
          lc = lc * (1.0 - lb.a * 0.92) + lb.rgb * 0.92 * lit;
        } else {
          // 內側：拋光的黃銅（比錶殼亮），刻著留言
          vec2 Pm = vec2(HX + ul, BC.y + vl);
          vec3 alb = mix(C_PAPER, C_SIGNAL, 0.2) * (0.9 + 0.03 * sin(lr * 1.7 + 3.0 * snoise(lq / 40.0)));
          vec3 n = normalize(vec3(lq / R * 0.18, 1.0));
          lc = alb * (0.78 + 0.22 * dot(n, LD) + 0.12 * (-lq.y / R) * 0.5) * lit;
          // 一道光掃過去（揭曉之後）
          float gx = exp(-pow(((Pm.x - glintX) + (Pm.y - BC.y) * 0.5) / 60.0, 2.0)) * glintK;
          lc += mix(C_PAPER, C_EMBER, 0.4) * 0.35 * gx;
          // 刻線的雙圈
          lc = mix(lc, C_SEPIA * 0.9, 0.5 * pxLine(abs(lr - (R_FACE_ - 24.0)), 0.4, 1.2) + 0.35 * pxLine(abs(lr - (R_FACE_ - 32.0)), 0.3, 1.0));
          // 刻字：遮罩 G = 字、R−G = 愛心（填玫瑰色琺瑯）；凹槽左上的壁是暗的、右下的壁受光
          vec4 m0 = fastLayer(texture(msgT, pageUV(Pm)));
          float mA = fastLayer(texture(msgT, pageUV(Pm - vec2(1.6, 1.6)))).a;
          float mB = fastLayer(texture(msgT, pageUV(Pm + vec2(1.6, 1.6)))).a;
          float m = m0.a, heart = max(m0.r - m0.g, 0.0);
          // 凹槽：底是暗的；靠左上的壁背光更暗、靠右下的壁受光亮一點（仍比表面暗，字才不會斷開）
          vec3 floorC = mix(C_SEPIA, brass(), 0.22) * 0.85;
          vec3 cut = floorC * (1.0 - 0.3 * clamp(m - mA, 0.0, 1.0) + 0.45 * clamp(m - mB, 0.0, 1.0));
          lc = mix(lc, cut, m0.g);
          // 表面上、凹槽右下緣外面一條很細的亮邊（刀口反光）
          lc += mix(C_PAPER, C_EMBER, 0.3) * 0.12 * clamp(mA - m, 0.0, 1.0);
          lc = mix(lc, C_ROSE * 0.85 * lit, heart);
        }
        // 蓋子邊緣的暗線（厚度）
        lc *= 1.0 - 0.4 * pxLine(abs(lr - R), 0.8, 2.0);
        col = mix(lc, col, smoothstep(R - 1.0, R + 1.0, lr));
      }
    }
    fragColor = vec4(col, 1.0);
  }`.replace(/R_FACE_/g, `${R_FACE}.0`).replace(/R_TICK0_/g, `${R_TICK0}.0`).replace(/R_TICK1_/g, `${R_TICK1}.0`), {
  ...camUniforms(),
  msgT: { value: null }, lyrT: { value: null },
  t: { value: 0 }, lidA: { value: 0 }, needle: { value: NORTH }, glintX: { value: -9999 }, glintK: { value: 0 }, nOn: { value: 0 },
});

/** 外圈歌詞的一個字：在第幾段（0 = 上半圈、1 = 下半圈）、中心角度、屬於哪個 Word、是那個詞的第幾個字。 */
interface RingChar { ch: string; row: number; ang: number; wi: number; k: number; n: number }
interface RingLine { size: number; family: string; chars: RingChar[]; wordAng: number[] }

export default class Compass extends Scene {
  bg = shared('compass.bg', BG);
  /** 蓋子內側的刻字（遮罩，畫一次）。 */
  msgL = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 外圈的歌詞、方位字（每格重畫）。 */
  lyrL = this.track(new Layer2D(W, H, undefined, { fast: true }));
  cam = new PlaneCam();
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = Number(this.ctx.params.seed ?? 1);
  block: MsgBlock | null = null;
  lyrSize = 58;
  g!: Grid;
  tOpen = 0;
  rings = new Map<Line, RingLine>();
  /** 指針的目標：(時間, 角度)。指針的角度 = 每一步的彈簧響應疊起來（線性系統，純時間函數）。 */
  steps: { t: number; a: number }[] = [];
  beats: number[] = [];

  override async init() {
    const { audio: au, lyrics, start: s, end: e } = this.ctx;
    await loadWindow(this.ctx, NORTH_LABEL + INVITE + COUPLE_ZH + DATE_DOTS + 'ESW');
    const g = (this.g = grid(au, s, e));
    this.tOpen = revealAt(au, g.b0, e, { minB: 2, maxB: 4 });
    this.beats = beatsBetween(au, this.tOpen, e);
    // ---- 蓋子內側的刻字（打開後的位置；白 = 字、紅 = 愛心）
    const c = this.msgL.ctx;
    this.msgL.clear();
    c.textBaseline = 'alphabetic';
    if (this.msg) {
      // v2：鏡頭停好時蓋子在畫面上差不多 1:1（推近到最後約 0.97～1.0 倍），航海圖座標的字級就是螢幕上的字級
      const b = (this.block = v2Block(c, this.msg, FAM_MSG, MBOX, { align: 'center', sigFamily: FAM_SIG, k: 1, lineHeight: 1.3, maxLines: 7 }));
      c.font = font(FAM_MSG, b.fit.size);
      c.fillStyle = '#fff';
      for (const ln of b.lines) fillWithHearts(c, ln.text, ln.x, ln.y, '#f00');
      c.font = font(FAM_SIG, b.sig.size);
      fillWithHearts(c, b.sig.text, b.sig.x, b.sig.y, '#f00');
      this.lyrSize = lyricV2(b.screen);
    } else {
      c.fillStyle = '#fff';
      c.font = font(FAM_MSG, 58);
      // fillWithHearts 照左對齊量位置：自己算置中
      const names = COUPLE_ZH.replace(/\s*&\s*/, ' ♥ ');
      fillWithHearts(c, names, LC.x - c.measureText(names).width / 2, LC.y - 10, '#f00');
      c.textAlign = 'center';
      c.font = font(F.serif(600), 32);
      c.letterSpacing = '6px';
      c.fillText(DATE_DOTS, LC.x, LC.y + 58);
      c.letterSpacing = '2px';
      c.font = font(F.hei(500), 24);
      c.fillText(INVITE, LC.x, LC.y + 130);
      c.letterSpacing = '0px';
      c.textAlign = 'left';
      this.lyrSize = lyricV2(null);
    }
    this.msgL.upload();

    // ---- 指針的目標：每個字唱到時指著它；句子唱完、最後一小節指回「幸福」
    const lines = lyrics.linesIn(s - 1, e + 1);
    const raw: { t: number; a: number }[] = [];
    for (const ln of lines) {
      const rl = this.ring(ln);
      ln.words.forEach((w, i) => { if (rl.wordAng[i] !== undefined) raw.push({ t: w.start, a: rl.wordAng[i]! }); });
      raw.push({ t: ln.end + 0.35, a: NORTH });
    }
    const lastBar = g.bars.length ? g.bars[g.bars.length - 1]! : e - g.bar;
    const settle = Math.max(this.tOpen + g.beat, Math.min(lastBar, e - g.bar * 0.9));
    // 打開的那一刻指針從歪的地方甩過來
    let prev = NORTH + 2.4 + hash(this.seed, 3);
    const cur = (tt: number) => { let a = NORTH; for (const st of raw) { if (st.t <= tt) a = st.a; else break; } return a; };
    raw.sort((x, y) => x.t - y.t);
    const all = [{ t: this.tOpen, a: cur(this.tOpen) }, ...raw.filter((x) => x.t > this.tOpen && x.t < settle), { t: settle, a: NORTH }];
    this.steps = [];
    for (const st of all) {
      // 角度走最近的那一邊（不要多繞一圈）
      let a = st.a;
      while (a - prev > Math.PI) a -= TAU;
      while (a - prev < -Math.PI) a += TAU;
      this.steps.push({ t: st.t, a: a - prev });
      prev = a;
    }
    this.a0 = prev - this.steps.reduce((sum, x) => sum + x.a, 0);
  }
  a0 = NORTH;

  /** 一行歌詞排成外圈的字（快取）：先試一段，放不下就上下兩段，再不行換窄的字、縮到 40（v2 的歌詞下限）。 */
  private ring(line: Line): RingLine {
    const hit = this.rings.get(line);
    if (hit) return hit;
    const c = this.lyrL.ctx;
    const text = line.text;
    const cap = ARC_SPAN * R_LYR;
    const widthOf = (fam: string, size: number, a: number, b: number) => { c.font = font(fam, size); return c.measureText(text.slice(a, b).trim()).width; };
    let fam = FAM_LYR, size = this.lyrSize, split = -1;
    const nW = line.words.length;
    const bestSplit = (fm: string, sz: number) => {
      let best = -1, bw = Infinity;
      for (let k = 1; k < nW; k++) {
        const o = line.words[k]!.o;
        const w = Math.max(widthOf(fm, sz, 0, o), widthOf(fm, sz, o, text.length));
        if (w < bw) { bw = w; best = k; }
      }
      return { k: best, w: bw };
    };
    outer: for (const fm of [FAM_LYR, FAM_LYR_N]) {
      for (let sz = this.lyrSize; sz >= V2.lyrMin; sz -= 2) {
        if (widthOf(fm, sz, 0, text.length) <= cap) { fam = fm; size = sz; split = -1; break outer; }
        if (nW > 1) { const b = bestSplit(fm, sz); if (b.w <= cap) { fam = fm; size = sz; split = b.k; break outer; } }
        fam = fm; size = sz; split = nW > 1 ? bestSplit(fm, sz).k : -1;
      }
    }
    c.font = font(fam, size);
    const rows = split < 0 ? [[0, text.length]] : [[0, line.words[split]!.o], [line.words[split]!.o, text.length]];
    const chars: RingChar[] = [];
    rows.forEach(([a, b], ri) => {
      const seg = text.slice(a, b);
      const lead = seg.length - seg.trimStart().length;
      const s0 = a! + lead, str = text.slice(s0, b).trimEnd();
      const total = c.measureText(str).width;
      // 半徑：下半圈的字頭朝內，基線放在外面，兩段的字落在同一條環帶上
      const r = ri === 0 ? R_LYR : R_LYR + size * 0.72;
      for (let i = 0; i < str.length; i++) {
        const ch = str[i]!;
        if (!ch.trim()) continue;
        const x0 = c.measureText(str.slice(0, i)).width, w = c.measureText(ch).width;
        const xc = x0 + w / 2 - total / 2;
        const ang = ri === 0 ? NORTH + xc / r : Math.PI / 2 - xc / r;
        const off = s0 + i;
        const wi = line.words.findIndex((wd) => off >= wd.o && off < wd.o + wd.w.length);
        if (wi < 0) continue;
        const wd = line.words[wi]!;
        chars.push({ ch, row: ri, ang, wi, k: off - wd.o, n: wd.w.length });
      }
    });
    const wordAng = line.words.map((_, i) => {
      const cs = chars.filter((q) => q.wi === i);
      if (!cs.length) return NORTH;
      // 角度的平均（同一段裡不會跨過 ±π）
      let sx = 0, sy = 0;
      for (const q of cs) { sx += Math.cos(q.ang); sy += Math.sin(q.ang); }
      return Math.atan2(sy, sx);
    });
    const rl = { size, family: fam, chars, wordAng };
    this.rings.set(line, rl);
    return rl;
  }

  private needleAt(t: number): number {
    let a = this.a0;
    for (const st of this.steps) {
      if (t <= st.t) break;
      a += st.a * springStep(t - st.t, 1.5, 0.3);
    }
    // 拍點上被震一下
    for (const b of this.beats) {
      const d = t - b;
      if (d < 0) break;
      if (d > 1.2) continue;
      a += 0.035 * Math.exp(-d / 0.22) * Math.sin(d * TAU * 3.2);
    }
    return a;
  }

  /**
   * 航海圖下方用鉛筆畫的航線：每兩小節畫出一段新的航程（在小節線上一筆畫過去、轉折點打一個叉），
   * 小船照拍子一格一格往前開，終點是一座小島「幸福」。讓羅盤以外空出來的航海圖也有事情在發生。
   */
  private drawRoute(c: CanvasRenderingContext2D, t: number) {
    const g = this.g, au = this.ctx.audio;
    const pts = ROUTE;
    const legT = (k: number) => g.b0 + k * 2 * g.bar;
    // 畫到哪裡（段數，小數 = 這一段畫到一半）
    let done = 0;
    for (let k = 0; k < pts.length - 1; k++) done += prog(t, legT(k), legT(k) + 0.55, ease.inOutCubic);
    c.save();
    c.strokeStyle = rgba('sepia', 0.55); c.lineWidth = 2; c.setLineDash([7, 9]); c.lineCap = 'round';
    c.beginPath(); c.moveTo(pts[0]![0], pts[0]![1]);
    let head = { x: pts[0]![0], y: pts[0]![1] };
    for (let k = 0; k < pts.length - 1 && k < done; k++) {
      const a = pts[k]!, b = pts[k + 1]!, q = Math.min(1, done - k);
      head = { x: lerp(a[0], b[0], q), y: lerp(a[1], b[1], q) };
      c.lineTo(head.x, head.y);
    }
    c.stroke();
    c.setLineDash([]);
    // 轉折點的叉
    c.lineWidth = 1.6;
    for (let k = 1; k < pts.length - 1 && k <= done; k++) {
      const [x, y] = pts[k]!;
      c.beginPath(); c.moveTo(x - 6, y - 6); c.lineTo(x + 6, y + 6); c.moveTo(x + 6, y - 6); c.lineTo(x - 6, y + 6); c.stroke();
    }
    // 終點的小島（鉛筆斜線）與「幸福」
    const [ix, iy] = pts[pts.length - 1]!;
    c.beginPath(); c.ellipse(ix + 34, iy + 4, 34, 15, -0.1, 0, Math.PI * 2);
    c.strokeStyle = rgba('sepia', 0.6); c.lineWidth = 1.6; c.stroke();
    c.save(); c.clip();
    c.strokeStyle = rgba('sepia', 0.25); c.lineWidth = 1;
    for (let x = ix - 10; x < ix + 80; x += 6) { c.beginPath(); c.moveTo(x, iy + 22); c.lineTo(x + 20, iy - 14); c.stroke(); }
    c.restore();
    c.font = font(F.hei(500), 20); c.fillStyle = rgba('sepia', 0.7); c.letterSpacing = '3px';
    c.fillText(NORTH_LABEL, ix + 14, iy - 22);
    c.letterSpacing = '0px';
    drawHeart(c, ix + 74, iy - 30, 14);
    // 小船：停在航線畫到的地方，拍點上被浪頂一下
    const bob = 3 * Math.sin(t * 2.4) - 5 * Math.exp(-(t - au.timeOfBeat(Math.floor(au.beatAt(t)))) / 0.12);
    const sx = head.x, sy = head.y - 12 + bob;
    c.fillStyle = rgba('sepia', 0.85);
    c.beginPath(); c.moveTo(sx - 14, sy); c.lineTo(sx + 14, sy); c.lineTo(sx + 9, sy + 7); c.lineTo(sx - 9, sy + 7); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(sx, sy - 2); c.lineTo(sx, sy - 22); c.lineTo(sx + 12, sy - 6); c.closePath();
    c.fillStyle = rgba('blood', 0.85); c.fill();
    c.restore();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, g = this.g, B = g.beat, to = this.tOpen;
    const u = this.bg.u;
    // ---- 蓋子：第一拍卡榫彈開一點，揭曉時翻開、躺平彈一下
    const click = t >= g.b0 ? 0.09 * Math.exp(-(t - g.b0) / 0.25) * Math.abs(Math.sin((t - g.b0) * 9)) : 0;
    const t0 = to - 0.42 * B, t1 = to;
    let lid = click;
    if (t >= t0) {
      const k = prog(t, t0, t1, ease.inQuad);
      lid = Math.max(click, Math.PI * k);
      if (t > t1) lid = Math.PI - 0.22 * Math.exp(-(t - t1) / 0.13) * Math.abs(Math.sin((t - t1) * 16));
    }
    u.lidA!.value = lid;
    u.nOn!.value = lid > 1.2 ? 1 : 0;
    u.needle!.value = this.needleAt(t);
    const gp = prog(t, to + 0.25, to + 1.15, ease.inOutCubic);
    u.glintX!.value = lerp(LC.x - R - 200, LC.x + R + 200, gp);
    u.glintK!.value = gp > 0 && gp < 1 ? 1 : 0;
    u.t!.value = t;

    // ---- 鏡頭：闔著的時候貼近錶身；打開時跟著蓋子往右搖，之後整段慢慢推近
    const land = ease.outExpo(prog(t, s, s + Math.min(1, B * 2)));
    const open = ease.inOutCubic(prog(t, to - 0.5 * B, to + 0.6 * B));
    const push = ease.inOutQuad(prog(t, to + 0.6 * B, Math.max(to + 2, e)));
    // 羅盤在船上：整張航海圖跟著浪很慢地左右搖（兩小節一個來回）
    const swell = Math.sin(((t - s) / (2 * g.bar)) * Math.PI * 2) * 0.012;
    this.cam.set({
      tx: lerp(lerp(540, 500, land), 890, open) + 20 * push, ty: lerp(470, 440, land) + 48 * open + 6 * push,
      dist: 1600 * (lerp(lerp(0.84, 0.8, land), 1.07, open) - 0.03 * push),
      yaw: lerp(-0.08, 0.03, open), pitch: lerp(0.24, 0.15, open) - 0.02 * push, roll: lerp(-0.05, 0, open) + swell, level: 0.85,
    });
    this.cam.apply(u);

    // ---- 外圈的歌詞與方位字（航海圖座標）
    const L = this.lyrL, c = L.ctx;
    L.clear();
    c.textBaseline = 'alphabetic';
    c.textAlign = 'center';
    const ink = paperInk();
    // 方位字：北方是「幸福」（最後指針停在這裡時亮一點）
    const home = Math.abs(((this.needleAt(t) - NORTH + Math.PI) % TAU + TAU) % TAU - Math.PI) < 0.06 && t > to + B ? 1 : 0;
    // 方位字在錶面上：蓋子還蓋著（看得到蓋子外面）時不畫，免得跟著歌詞一起刻到蓋子外面
    if (lid > Math.PI / 2) {
    c.font = font(F.hei(700), 30); c.letterSpacing = '6px';
    c.fillStyle = home ? rgba('blood') : rgba('sepia', 0.85);
    c.fillText(NORTH_LABEL, BC.x + 3, BC.y - R_LABEL + 6);
    c.letterSpacing = '0px';
    c.font = font(F.serif(600), 30); c.fillStyle = rgba('sepia', 0.7);
    for (const [ch, ang] of [['E', 0], ['S', Math.PI / 2], ['W', Math.PI]] as const) {
      c.save(); c.translate(BC.x + Math.cos(ang) * R_LABEL, BC.y + Math.sin(ang) * R_LABEL); c.rotate(ang + Math.PI / 2);
      c.fillText(ch, 0, 10); c.restore();
    }
    }
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const rl = this.ring(ly.line);
      c.font = font(rl.family, rl.size);
      c.globalAlpha = ly.k * prog(t, s, s + 0.4);
      for (const q of rl.chars) {
        const w = ly.line.words[q.wi]!;
        const p = Lyrics.wordProgress(w, t) * q.n - q.k;
        c.fillStyle = p >= 1 ? ink.sung : p > 0 ? ink.active : ink.unsung;
        const r = q.row === 0 ? R_LYR : R_LYR + rl.size * 0.72;
        c.save();
        c.translate(BC.x + Math.cos(q.ang) * r, BC.y + Math.sin(q.ang) * r);
        c.rotate(q.row === 0 ? q.ang + Math.PI / 2 : q.ang - Math.PI / 2);
        c.fillText(q.ch, 0, 0);
        c.restore();
      }
      c.globalAlpha = 1;
    }
    c.textAlign = 'left';
    this.drawRoute(c, t);
    u.lyrT!.value = L.upload();
    u.msgT!.value = this.msgL.texture;
    this.bg.render(renderer, out);
    void hash;

    const avoid: [number, number, number, number] = this.block ? this.cam.screenRect(this.block.box, 10) : this.cam.screenRect([LC.x - R, LC.y - R, 2 * R, 2 * R]);
    return { paper: 1, bloom: 0.35, vignette: 0.32, grain: 0.045, popupAvoid: [avoid], zoom: 1 + 0.012 * Math.exp(-Math.max(0, t - t1) / 0.12) * (t > t1 ? 1 : 0) };
  }
}
