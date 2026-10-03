// 水墨暈染（亮）：俯看一張攤在桌上、剛刷過清水的宣紙，一幅水墨山水在拍點上一滴一滴暈出來——遠山、中景、近山各是一滴墨，
// 落在稜線上、順著濕紙往兩邊暈開（前緣有一條水痕、剛暈開的墨比較濃，乾了變淡）；之後太陽是一滴朱墨、苔點一拍一點、
// 水面偶爾落一滴（漣漪），兩隻鳥飛過，小船在水上漂，雲霧一直在山腰間流動。
// 主打留言是畫上的「題款」：寫在右上角的留白裡（霞鶩文楷，40～60 px，照留言尺寸標準 v2），一樣是墨一滴一滴落在一組字上、
// 往濕的筆畫裡收成字；署名下面蓋一方朱印（在拍點蓋上去）。歌詞是題款下面一行淡墨小字（逐字跟唱，正在唱的是朱墨）。
//  - 沒有留言：題款的位置寫歌詞（每個字唱到的那一刻落墨，一句一行輪流寫），下面一行淡淡的邀請；
//    純音樂又沒有留言：一拍一滴寫新人的名字，蓋印。
//  - 鏡頭：先看山（偏左），留言開始落墨時焦點慢慢移到題款，整段慢慢推近。
//  - 右下角（HUD）是水面的留白，不放東西。
// 手法：一個全螢幕 shader（PlaneCam 反查每個像素在紙上的哪裡）。山的稜線在 CPU 算好（高斯山峰＋值雜訊），放進 uniform 陣列，
// CPU 與 GPU 用同一條稜線（苔點才點得在山上）。字在 init() 畫成字模（清楚／暈 2.5 px／暈 16 px＋每個像素最近的三組），
// 每一組的中心、大小、落下的時間放在 uniform 陣列，墨的濃度用吸收（exp）疊，重疊的暈會更深。小船、鳥、水紋、印章、歌詞是紙面座標的 Canvas 圖層。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, mulberry32, fbm1, lerp, pulse } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { lyricAt, NAME_A, NAME_B, fitPx, lyricSubOf, layoutLyric, subStyleFor, subGap, drawLyricSub, type LyricStyle } from './_motifs';
import { grid, stagger, layoutRows, drawRows, type Grid, type KaraokeInk } from './_t4';
import { PlaneCam, camUniforms, CAM_GLSL } from './_t14';
import { inkStamp, freeCanvas } from './_t1';
import { loadAll, t21Grain, GRAIN_GLSL, groupLine, glyphMask, block, T21_INVITE, type Block, type TGlyph, type TGroup, type GlyphMask, type Rect } from './_t21';
import { V2, lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'print', paper: true, energy: [0.05, 0.7], bars: [4, 8], weight: 1 };

const MAXG = 40;
/** 題款（留言）的框：右上角的留白（720 × 390，畫面的 13%）。 */
const MSG_BOX = { x: 1060, y: 160, w: 720, h: 390 };
/** 歌詞：題款下面一行（右邊停在畫面內；HUD 在 y ≥ 830）。 */
const LYR = { x: 1060, w: 720 };
const FAM = F.hand(700);
const FAM_SIG = F.hand(400);
const FAM_LYR = F.hand(700);
/** 沒有留言時兩句歌詞輪流寫的兩行（中心 y）。 */
const BANDS = [300, 470];
/** 有韓文原文副行的窗格：每句多一行小字，兩行拉開一點（下面那行離邀請還有 60 px 以上）。 */
const BANDS_SUB = [285, 490];
/** 稜線的取樣：64 點，x 從 -200 到 2120（鏡頭搖的時候邊緣也有山）。 */
const RN = 64, RX0 = -200, RX1 = 2120;
const SEAL = '百年好合';
const MAXDOT = 16;

const slotDecl = (S: string) => `uniform sampler2D m${S}; uniform sampler2D x${S}; uniform vec4 r${S}; uniform vec2 s${S}; uniform float a${S}; uniform float w${S}; uniform int n${S}; uniform vec4 g${S}[${MAXG}]; uniform vec4 q${S}[${MAXG}];`;
// 一個字模（slot）：這個像素最近的一組（own：字、暈、落下前的影子都算）、第二、第三近的組與最近那組的前後各一組（只算那一團墨的暈與水痕）
const slotCode = (S: string) => /* glsl */ `
  if (a${S} > 0.0) {
    vec2 uv = (P - r${S}.xy) / r${S}.zw;
    if (uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) {
      vec4 sm = texture(m${S}, uv);
      vec4 ix = texelFetch(x${S}, ivec2(uv * s${S}), 0);
      int g0 = int(ix.r * 255.0 + 0.5), g1 = int(ix.g * 255.0 + 0.5), g2 = int(ix.b * 255.0 + 0.5);
      vec4 D = vec4(0.0); vec2 L = vec2(0.0);
      if (g0 < n${S}) {
        groupInk(P, sm, g${S}[g0], q${S}[g0], true, w${S}, nz, D, L);
        if (g0 > 0 && g0 - 1 != g1 && g0 - 1 != g2) groupInk(P, sm, g${S}[g0 - 1], q${S}[g0 - 1], false, 0.0, nz, D, L);
        if (g0 + 1 < n${S} && g0 + 1 != g1 && g0 + 1 != g2) groupInk(P, sm, g${S}[g0 + 1], q${S}[g0 + 1], false, 0.0, nz, D, L);
      }
      if (g1 < n${S}) groupInk(P, sm, g${S}[g1], q${S}[g1], false, 0.0, nz, D, L);
      if (g2 < n${S}) groupInk(P, sm, g${S}[g2], q${S}[g2], false, 0.0, nz, D, L);
      DK += D * a${S}; LI += L * a${S};
    }
  }`;

const BG = () => new FSPass(/* glsl */ `
  ${CAM_GLSL}
  ${GRAIN_GLSL}
  uniform float t;
  ${slotDecl('A')}
  ${slotDecl('B')}
  uniform sampler2D lyr;
  // 山：三層稜線（x 遠、y 中、z 近）；每一層一滴墨暈開：落點 x、y、時間、最大半徑
  uniform vec4 ridge[${RN}];
  uniform vec4 lay[3];
  uniform vec4 sun;          // 太陽（朱墨）：x、y、半徑、時間
  uniform vec4 dots[${MAXDOT}]; // 苔點：x、y、時間、大小
  uniform vec4 rip[4];       // 水面的一滴：x、y、時間
  uniform vec2 side;         // x：題款在右邊（1）或左邊（-1）

  // 一組字的墨：G = (中心 x, y, 半寬, 落下的時間)，Q = (半高, 墨色 0 黑／1 淡墨／2 愛心, 朱墨退掉的時間（< 0 = 不用）, 種子)。
  // D：x = 黑墨、y = 朱墨（正在唱）、z = 愛心的玫瑰色、w = 水（濕紙變深）；L：x = 反光、y = 影子。
  void groupInk(vec2 p, vec4 sm, vec4 G, vec4 Q, bool own, float water, float nz, inout vec4 D, inout vec2 L) {
    float dt = t - G.w;
    // 每一滴不一樣：落點偏一點、大小差一點
    vec3 hv = hash33(vec3(Q.w, 1.3, 2.7));
    vec2 c0 = G.xy + (hv.xy - 0.5) * vec2(G.z * 0.3, Q.x * 0.3);
    vec2 hs = vec2(G.z * 0.85 + 34.0, Q.x * 0.9 + 22.0) * (0.85 + 0.35 * hv.z);
    float d = length((p - c0) / hs);
    float tone = Q.y;
    float kt = tone > 0.5 && tone < 1.5 ? 0.5 : 1.0;
    if (own) D.w = max(D.w, water * (0.55 * sm.g + 0.45 * sm.a));
    if (dt < 0.0) {
      // 墨滴落下前：影子從右下往落點收、越來越小越濃
      if (own && dt > -0.32) {
        float k = 1.0 + dt / 0.32;
        vec2 c = c0 + (1.0 - k) * vec2(70.0, 55.0);
        float r = 7.0 + 34.0 * (1.0 - k);
        L.y = max(L.y, (1.0 - smoothstep(r * 0.25, r, length(p - c))) * 0.2 * k * k);
      }
      return;
    }
    float R = 1.18 * (1.0 - exp(-dt * 3.4));
    float e = d - R + nz;
    float inside = smoothstep(0.1, -0.12, e);
    float core = clamp(1.0 - d / max(R, 0.05), 0.0, 1.0);
    // 那一團墨：中間濃、往外淡；剛落下很濃，幾拍之後淡成一片很淡的墨（題款要乾淨，暈不能太重）；邊緣一條很細的水痕
    float wash = inside * ((0.008 + 0.04 * core) + (0.04 + 0.24 * core * core) * exp(-dt * 1.9));
    float tide = exp(-pow(e / 0.045, 2.0)) * 0.04 * smoothstep(0.1, 0.5, dt);
    float dens = wash + tide;
    // 濺出去的小墨點（不是每一滴都有）
    if (hv.z > 0.45) for (int j = 0; j < 2; j++) {
      vec3 h = hash33(vec3(Q.w, float(j), 7.1));
      float a = h.x * 6.2832;
      vec2 sp = c0 + vec2(cos(a), sin(a)) * hs * (1.05 + 0.3 * h.y);
      float rr = 1.6 + 4.0 * h.z * h.z;
      dens += (1.0 - smoothstep(rr * 0.4, rr, length(p - sp))) * 0.9 * smoothstep(0.0, 0.08, dt);
    }
    if (own) {
      // 墨往濕的筆畫裡收：離中心近的先收；字的邊緣順著紙纖維暈出一點毛邊（字一定會完整出現，不受那一團墨的邊緣影響）
      float inG = smoothstep(0.1, -0.12, d - R * 1.3);
      float cond = smoothstep(0.0, 0.34, dt - d * 0.18);
      float stroke = max(sm.r, smoothstep(0.44, 0.58, sm.g + 0.07 * snoise(p / 10.0 + Q.w)));
      dens += stroke * inG * cond * 1.6 + sm.b * inG * (0.04 + 0.22 * exp(-dt * 1.5));
      // 落下的那一下：濕紙上的反光漾開一圈
      if (dt < 0.4) {
        float rr = 10.0 + 200.0 * dt;
        L.x = max(L.x, exp(-pow((length(p - c0) - rr) / 4.0, 2.0)) * (1.0 - dt / 0.4));
      }
    }
    dens *= kt;
    float act = (own && Q.z > 0.0) ? 1.0 - smoothstep(Q.z, Q.z + 0.35, t) : 0.0;
    if (tone > 1.5) D.z += dens; else { D.x += dens * (1.0 - act); D.y += dens * act; }
  }

  vec3 ridgeAt(float x) {
    float f = clamp((x - ${RX0}.0) / ${RX1 - RX0}.0 * ${RN - 1}.0, 0.0, ${RN - 1}.0 - 0.001);
    int i = int(f);
    return mix(ridge[i].xyz, ridge[i + 1].xyz, fract(f));
  }

  /**
   * 一層山的墨：稜線（深、有毛邊）＋往下淡掉的渲染＋直的皴（披麻皴的近似）；那一滴墨從落點暈開（前緣一條水痕），
   * 剛暈開的地方比較濃（濕的），幾秒後乾成定色。雲霧在山腰流動，把下半部洗淡。
   */
  float mountain(vec2 P, float ry, float dens, float fall, float k, vec4 L0) {
    float dt = t - L0.z;
    if (dt <= 0.0) return 0.0;
    float h = P.y - ry;
    float edge = smoothstep(-1.5, 2.5, h + 2.5 * snoise(P / 11.0 + k * 11.0) + 1.0 * snoise(P / 4.0));
    if (edge <= 0.0) return 0.0;
    float line = exp(-h / (6.0 + 3.0 * k)) * (0.55 + 0.45 * snoise(P / vec2(38.0, 7.0) + k));
    float wash = exp(-h / fall);
    // 皴：斜斜的、不規則的一片一片（不要一排整齊的直條紋）
    vec2 cq = rot2(0.35 - 0.2 * k) * P;
    float cun = smoothstep(0.52, 0.9, fbm(vec2(cq.x / 26.0 + k * 3.0, cq.y / 70.0), 3) * 0.5 + 0.5) * exp(-h / (fall * 1.3));
    float m = edge * dens * (wash * 0.75 + line * (0.4 + 0.3 * k) + cun * 0.45);
    // 暈開：以落點為中心往兩邊（橫的比較快）；前緣有毛邊與水痕
    float dd = length((P - L0.xy) / vec2(1.0, 0.6)) + 70.0 * snoise(P / 120.0 + k * 5.0) + 25.0 * snoise(P / 30.0);
    float R = L0.w * (1.0 - exp(-dt * 1.7));
    float rev = smoothstep(R, R - 50.0, dd);
    float wet = exp(-dt * 0.9);
    float tide = exp(-pow((dd - R) / 7.0, 2.0)) * 0.35 * wet * step(dd, R + 20.0);
    // 雲霧：一條一條橫的淡帶，慢慢往右飄，洗掉山腰
    float mist = smoothstep(0.1, 0.75, fbm(vec2(P.x / 520.0 - t * 0.035 - k * 3.1, P.y / 70.0 + k * 1.7), 3) * 0.5 + 0.5);
    float wash2 = 1.0 - 0.7 * mist * smoothstep(20.0, 140.0, h);
    return (m * rev * (1.0 + 0.45 * wet) + tide * edge * dens) * wash2;
  }

  vec3 absorb(vec3 c, vec3 base) { return -log(clamp(c / base, vec3(0.004), vec3(1.0))); }

  void main() {
    vec2 sp = SP();
    vec3 hit = pcHit(sp, 0.0);
    vec2 P = hit.xy;
    vec4 gr = paperGrain(P);
    // 宣紙：比奶茶色的紙更白一點（但不比紙白刺眼），雲紋、長纖維
    vec3 pap = mix(C_PAPER, C_BONE, 0.55) * (0.955 + 0.04 * gr.b + 0.018 * (gr.r - 0.5));
    pap = mix(pap, C_BONE * 1.02, 0.35 * gr.g);
    float nz = 0.1 * snoise(P / 95.0) + 0.045 * snoise(P / 31.0) - 0.07 * gr.g;
    vec4 DK = vec4(0.0); vec2 LI = vec2(0.0);
    ${slotCode('A')}
    ${slotCode('B')}
    // ---- 山水（題款那一側與右下角留白：往那邊淡掉，像水氣）
    float px = side.x > 0.0 ? P.x : 1920.0 - P.x;
    float fade = 1.0 - smoothstep(880.0, 1180.0, px);
    vec3 ry = ridgeAt(P.x);
    float mt = 0.0;
    if (fade > 0.0) {
      mt += mountain(P, ry.x, 0.2, 110.0, 0.0, lay[0]);
      mt += mountain(P, ry.y, 0.38, 140.0, 1.0, lay[1]);
      mt += mountain(P, ry.z, 0.62, 170.0, 2.0, lay[2]);
      mt *= fade;
      // 苔點：近山稜線上的小墨點，一拍一點暈開
      for (int i = 0; i < ${MAXDOT}; i++) {
        vec4 dd = dots[i];
        float dt = t - dd.z;
        if (dt <= 0.0) continue;
        float r = dd.w * (1.0 - exp(-dt * 9.0));
        float q = length((P - dd.xy) / vec2(1.0, 0.8)) + 1.2 * snoise(P / 2.5);
        mt += (1.0 - smoothstep(r - 1.0, r + 0.8, q)) * 0.9;
      }
    }
    // 太陽：一滴朱墨，中間淡、邊緣積色
    float sd = t - sun.w, sunI = 0.0;
    if (sd > 0.0) {
      float r = sun.z * (1.0 - exp(-sd * 3.0));
      float q = length(P - sun.xy) + 4.0 * snoise(P / 14.0);
      float in0 = 1.0 - smoothstep(r - 1.5, r + 1.5, q);
      sunI = in0 * (0.42 + 0.25 * smoothstep(r * 0.6, r, q) + 0.08 * gr.r);
    }
    // 水面的一滴：幾圈扁扁的淡墨漣漪
    float ri = 0.0;
    for (int i = 0; i < 4; i++) {
      float dt = t - rip[i].z;
      if (dt <= 0.0 || dt > 4.0) continue;
      float q = length((P - rip[i].xy) / vec2(1.0, 0.28));
      for (int j = 0; j < 3; j++) {
        float r = (8.0 + 150.0 * (1.0 - exp(-(dt - float(j) * 0.18) * 1.3))) * step(float(j) * 0.18, dt);
        ri += exp(-pow((q - r) / 2.2, 2.0)) * exp(-dt * 0.9) * 0.22;
      }
      ri += (1.0 - smoothstep(2.0, 5.0, length(P - rip[i].xy))) * 0.8 * step(dt, 0.25);
    }
    vec3 inkC = mix(C_SEPIA, C_INK, 0.55) * 0.95;
    vec3 actC = mix(C_BLOOD, C_SIGNAL, 0.2) * 0.9;
    // 墨吃進紙的纖維：纖維多的地方濃一點
    float fib = 0.9 + 0.2 * gr.r + 0.15 * gr.g;
    vec3 A = absorb(inkC, pap) * (DK.x + mt + ri) + absorb(actC, pap) * (DK.y + sunI) + absorb(C_ROSE, pap) * DK.z;
    vec3 col = pap * exp(-A * fib);
    // 清水寫的字：濕的地方暗一點、偏暖
    col *= 1.0 - 0.075 * clamp(DK.w, 0.0, 1.0);
    // Canvas 層（小船、鳥、水紋、印章、歌詞）：字緣多一圈很淡的暈
    vec4 Ly = fastLayer(texture(lyr, pageUV(P)));
    float fe = 0.25 * (texture(lyr, pageUV(P + vec2(2.5, 0.0))).a + texture(lyr, pageUV(P - vec2(2.5, 0.0))).a
      + texture(lyr, pageUV(P + vec2(0.0, 2.5))).a + texture(lyr, pageUV(P - vec2(0.0, 2.5))).a);
    col *= 1.0 - 0.08 * fe;
    col = col * (1.0 - Ly.a) + Ly.rgb * fib;
    // 墨滴的影子、落下時的反光
    col *= 1.0 - LI.y;
    col += C_BONE * 0.14 * LI.x;
    // 一盞燈從左上打過來
    vec2 lp = (sp - vec2(620.0, 260.0)) / 1500.0;
    col *= 0.93 + 0.09 * exp(-dot(lp, lp) * 2.0);
    fragColor = vec4(col, 1.0);
  }`, {
  ...camUniforms(),
  grainTex: { value: null }, t: { value: 0 }, lyr: { value: null },
  ...slotUniforms('A'), ...slotUniforms('B'),
  ridge: { value: Array.from({ length: RN }, () => new THREE.Vector4()) },
  lay: { value: Array.from({ length: 3 }, () => new THREE.Vector4(0, 0, 1e9, 1)) },
  sun: { value: new THREE.Vector4(0, 0, 1, 1e9) },
  dots: { value: Array.from({ length: MAXDOT }, () => new THREE.Vector4(0, 0, 1e9, 1)) },
  rip: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 1e9, 0)) },
  side: { value: new THREE.Vector2(1, 0) },
});

function slotUniforms(S: string) {
  return {
    [`m${S}`]: { value: null }, [`x${S}`]: { value: null }, [`r${S}`]: { value: new THREE.Vector4(0, 0, 1, 1) }, [`s${S}`]: { value: new THREE.Vector2(1, 1) },
    [`a${S}`]: { value: 0 }, [`w${S}`]: { value: 0 }, [`n${S}`]: { value: 0 },
    [`g${S}`]: { value: Array.from({ length: MAXG }, () => new THREE.Vector4()) },
    [`q${S}`]: { value: Array.from({ length: MAXG }, () => new THREE.Vector4()) },
  } as Record<string, THREE.IUniform>;
}

/** 一張字模＋每一組的資料（中心、大小、落下的時間、墨色）。 */
interface InkSet { mask: GlyphMask; G: THREE.Vector4[]; Q: THREE.Vector4[]; n: number; rect: Rect }
/** 沒有留言時一句歌詞的字模。 */
interface LineSet extends InkSet { line: Line; idx: number; sub: { line: Line; st: LyricStyle; y: number; size: number } | null }

export default class Ink extends Scene {
  bg = shared('ink.bg', BG);
  /** 紙面座標的 Canvas：小船、鳥、水紋、印章、歌詞（每格重畫）。 */
  lyr = this.track(new Layer2D(W, H, undefined, { fast: true }));
  cam = new PlaneCam();
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 131 + (this.msg?.id ?? 0) * 17) >>> 0;
  g!: Grid;
  block: Block | null = null;
  main: InkSet | null = null;
  lines: LineSet[] = [];
  lyrSize = 48;
  hasLyrics = false;
  avoid: Rect[] = [];
  /** 題款（留言）的墨滴：鏡頭的焦點跟著移過來。 */
  drops: { t: number; x: number; y: number }[] = [];
  /** 山：三層稜線（每 36.8 px 一點）、每一層那一滴、太陽、苔點、水面的滴、鳥飛過的時間。 */
  ridge: [number, number, number][] = [];
  layDrops: THREE.Vector4[] = [];
  sunV = new THREE.Vector4(0, 0, 1, 1e9);
  dotsV: THREE.Vector4[] = [];
  ripV: THREE.Vector4[] = [];
  birds: number[] = [];
  /** 印章（畫一次）與蓋下去的時間、位置。 */
  seal: { cv: HTMLCanvasElement; w: number; h: number } | null = null;
  tSeal = Infinity; sealAt = { x: 0, y: 0 };
  boat = { x: 880, y: 860 };

  override async init() {
    const { audio: au, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const names = `${NAME_A} ♥ ${NAME_B}`;
    // 原文副行在 await 之前先拿：引擎只在呼叫 init 前設好這一格的開關，等字型的時候別的窗格可能改掉
    const subOf = new Map(lyrics.linesIn(s - 1, e).map((l) => [l, lyricSubOf(l)] as const));
    const hasSub = [...subOf.values()].some(Boolean);
    await loadAll(this.ctx, names + SEAL);
    const g = (this.g = grid(au, s, e));
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
    const c = this.lyr.ctx;
    // 鏡頭整段的縮放在 0.97～1.0 之間：頁面 px ≈ 螢幕 px；留言字級照 v2（稍微放大一點，推近前也不會小於 40）
    const K = 0.97;
    let sigEnd = { x: 0, y: 0, size: 0, t: g.b0 };
    if (m) {
      const b = (this.block = block(c, m, FAM, MSG_BOX, { align: 'left', sigFamily: FAM_SIG, lineHeight: 1.36, maxLines: 5, v2: K, valign: 0.35 }));
      const glyphs: TGlyph[] = [], groups: TGroup[] = [];
      const nChars = b.lines.reduce((a, l) => a + Array.from(l.text.replace(/\s/g, '')).length, 0);
      const run = clamp(Math.ceil(nChars / 12), 1, 4);
      for (const ln of b.lines) groupLine(ln.text, ln.x, ln.y, FAM, b.fit.size, run, 0, glyphs, groups);
      const nMsg = groups.length;
      groupLine(b.sig.text, b.sig.x, b.sig.y, FAM_SIG, b.sig.size, 99, 0, glyphs, groups);
      // 一組一滴：從第一拍開始，一拍 1、2、4 滴（最多花窗格的四成、5 秒）；署名在最後一滴之後一拍、一拍半
      const maxDur = clamp((e - g.b0) * 0.4, g.beat * 1.5, 5);
      const ts = stagger(au, g.b0, nMsg, maxDur);
      const tl = ts[ts.length - 1] ?? g.b0;
      for (let i = nMsg; i < groups.length; i++) ts.push(tl + g.beat * (1 + 0.5 * (i - nMsg)));
      this.main = this.inkSet(glyphs, groups, ts.map((x) => [x, -1]), (i) => (i >= nMsg ? 1 : groups[i]!.heart ? 2 : 0), true);
      sigEnd = { x: b.sig.x + b.sig.w, y: b.sig.y, size: b.sig.size, t: ts[ts.length - 1]! };
      this.lyrSize = lyricV2(b.fit.size * K) / K;
      this.avoid = [b.box, [LYR.x, b.box[1] + b.box[3] + 20, LYR.w, 130]];
    } else if (this.hasLyrics) {
      // 沒有留言：題款的位置寫歌詞，每一句各做一張字模（一個字＝一組，唱到那個字的時候落墨），兩行輪流
      const all = lyrics.lines;
      for (const line of lyrics.linesIn(s - 1, e)) {
        const idx = all.indexOf(line);
        const lay = layoutRows(c, line, { family: FAM_LYR, size: V2.lyrMax / K, minSize: V2.lyrMin / K, maxW: MSG_BOX.w, maxRows: 2, align: 'left', lineHeight: 1.24 });
        // 原文副行：淡墨小字寫在同一張紙上、中文最後一排的正下方（Canvas 層，字緣一樣有紙的暈）；中文＋原文一起置中在這一行
        const subLine = subOf.get(line) ?? null;
        let sub: LineSet['sub'] = null, hh = lay.height;
        if (subLine) {
          const st: LyricStyle = { family: FAM_LYR, size: lay.size, maxWidth: MSG_BOX.w, align: 'left' };
          const sl = layoutLyric(c, subLine, subStyleFor(st, lay.size));
          const gap = (lay.rows.length - 1) * lay.lineHeight + subGap(lay.size, sl.size);
          sub = { line: subLine, st, y: gap, size: lay.size };
          hh = lay.size + gap + (sl.height - sl.size);
        }
        const cy = (hasSub ? BANDS_SUB : BANDS)[idx % 2]!;
        const y0 = cy - hh / 2 + lay.size * 0.82;
        if (sub) sub.y += y0;
        const glyphs: TGlyph[] = [], groups: TGroup[] = [];
        const tw: [number, number][] = [];
        for (const pw of lay.words) {
          const x = MSG_BOX.x + pw.x, y = y0 + pw.y;
          glyphs.push({ ch: pw.word.w, x, y, w: pw.w, size: lay.size, family: FAM_LYR, g: groups.length });
          groups.push({ x, y: y - lay.size * 0.95, w: pw.w, h: lay.size * 1.2, from: glyphs.length - 1, to: glyphs.length, heart: pw.word.w === '♥' });
          tw.push([pw.word.start - 0.03, pw.word.end]);
        }
        if (!groups.length) continue;
        const set = this.inkSet(glyphs, groups, tw, (i) => (groups[i]!.heart ? 2 : 0), false);
        this.lines.push({ ...set, line, idx, sub });
      }
      this.avoid = [[MSG_BOX.x - 20, 200, MSG_BOX.w + 40, hasSub ? 390 : 360]];
    } else {
      // 純音樂又沒有留言：一拍一滴寫新人的名字（60 px；名字長就縮到一行放得進題字框），蓋印
      const size = fitPx(names, FAM, V2.msgMax / K, MSG_BOX.w);
      const gl: TGlyph[] = [], groups: TGroup[] = [];
      groupLine(names, MSG_BOX.x, 360, FAM, size, 1, 0, gl, groups);
      const ts = groups.map((_, i) => au.timeOfBeat(au.beatAt(g.b0) + i));
      this.main = this.inkSet(gl, groups, ts.map((x) => [x, -1]), (i) => (groups[i]!.heart ? 2 : 0), true);
      const last = gl[gl.length - 1]!;
      sigEnd = { x: last.x + last.w, y: 360, size, t: ts[ts.length - 1]! };
      this.avoid = [[MSG_BOX.x - 20, 280, 700, 200]];
    }
    // ---- 印章：署名（或名字）寫完之後一拍蓋下去
    if (m || !this.hasLyrics) {
      const S = Math.round(clamp(sigEnd.size * 1.7, 50, 64));
      this.seal = inkStamp(S, S, this.seed, (sc) => {
        sc.fillStyle = mixRgba('blood', 'signal', 0.25);
        sc.fillRect(-S / 2, -S / 2, S, S);
        // 白文印：字挖掉（兩行兩字，由右往左讀）
        sc.globalCompositeOperation = 'destination-out';
        sc.font = font(F.ming(900), S * 0.36); sc.textAlign = 'center'; sc.textBaseline = 'middle'; sc.fillStyle = '#000';
        const ch = Array.from(SEAL);
        sc.fillText(ch[0]!, S * 0.2, -S * 0.2); sc.fillText(ch[1]!, S * 0.2, S * 0.2);
        sc.fillText(ch[2]!, -S * 0.2, -S * 0.2); sc.fillText(ch[3]!, -S * 0.2, S * 0.2);
        sc.globalCompositeOperation = 'source-over';
      }, 1.5, 0.6);
      this.tSeal = au.timeOfBeat(Math.ceil(au.beatAt(sigEnd.t + g.beat * 0.6) - 1e-6));
      // 署名右邊放得下就放右邊，不然放在署名下面
      const right = sigEnd.x + 16 + S <= MSG_BOX.x + MSG_BOX.w + 30;
      this.sealAt = right ? { x: sigEnd.x + 16, y: sigEnd.y - S * 0.78 } : { x: sigEnd.x - S, y: sigEnd.y + 14 };
    }
    this.buildLandscape();
  }

  /**
   * 山水的稜線與事件（CPU 算、放進 uniform）：
   * 遠山、中景、近山各一滴（第一拍、之後的小節線），太陽（再下一個小節線），之後每一拍點一個苔點、
   * 每兩小節水面落一滴或兩隻鳥飛過（窗格長也一直有事情發生）。
   */
  private buildLandscape() {
    const au = this.ctx.audio, g = this.g, e = this.ctx.end;
    const rnd = mulberry32(this.seed * 7 + 3);
    // 每一層：基準線（往題款那邊沉下去）＋ 2～3 座高斯山峰＋值雜訊的起伏
    const specs = [
      { base: 600, sink: 220, peaks: 4, hMin: 80, hMax: 190, x0: 80, x1: 820, w: [55, 125], rough: 16, sc: 50 },
      { base: 740, sink: 250, peaks: 4, hMin: 150, hMax: 320, x0: -40, x1: 660, w: [60, 135], rough: 20, sc: 42 },
      { base: 920, sink: 300, peaks: 3, hMin: 80, hMax: 190, x0: -160, x1: 560, w: [80, 170], rough: 22, sc: 34 },
    ];
    const peaks = specs.map((sp) => Array.from({ length: sp.peaks }, () => ({ x: lerp(sp.x0, sp.x1, rnd()), h: lerp(sp.hMin, sp.hMax, rnd()), w: lerp(sp.w[0]!, sp.w[1]!, rnd()) })));
    const ridgeY = (k: number, x: number) => {
      const sp = specs[k]!;
      const u = clamp((x - 700) / 700);
      let y = sp.base + sp.sink * u * u * (3 - 2 * u);
      for (const p of peaks[k]!) y -= p.h * Math.exp(-(((x - p.x) / p.w) ** 2));
      return y + sp.rough * fbm1(x / sp.sc, 3, this.seed + k * 13);
    };
    this.ridge = Array.from({ length: RN }, (_, i) => {
      const x = RX0 + ((RX1 - RX0) * i) / (RN - 1);
      return [ridgeY(0, x), ridgeY(1, x), ridgeY(2, x)] as [number, number, number];
    });
    // 事件的時間：短窗格（< 3 小節）改成一拍一個
    const bars = g.bars.filter((b) => b >= g.b0 - 1e-3);
    const slot = (i: number) => (g.nBars < 3 ? au.timeOfBeat(au.beatAt(g.b0) + i) : i === 0 ? g.b0 : bars[i] ?? au.timeOfBeat(au.beatAt(g.b0) + i * 2));
    const top = (k: number) => {
      // 那一層最高的山峰
      const p = peaks[k]!.reduce((a, b) => (b.h > a.h ? b : a));
      return { x: p.x, y: ridgeY(k, p.x) + 10 };
    };
    for (let k = 0; k < 3; k++) {
      const p = top(k);
      this.layDrops.push(new THREE.Vector4(p.x, p.y, slot(k), 1300));
    }
    this.sunV.set(250 + 180 * rnd(), 175 + 50 * rnd(), 54, slot(3));
    // 苔點：從太陽之後，一拍一點，點在近山與中景的稜線上
    const tDots = slot(3) + g.beat;
    for (let i = 0; i < MAXDOT; i++) {
      const k = i % 3 === 2 ? 1 : 2;
      const pk = peaks[k]![Math.floor(rnd() * peaks[k]!.length)]!;
      const x = pk.x + (rnd() - 0.5) * pk.w * 1.4;
      const td = au.timeOfBeat(au.beatAt(tDots) + i);
      this.dotsV.push(new THREE.Vector4(x, ridgeY(k, x) + 2 + rnd() * 5, td < e ? td : 1e9, 3 + rnd() * 4));
    }
    // 每兩小節：水面落一滴，或兩隻鳥飛過（輪流）
    let k = 0;
    for (let i = 4; ; i += 2) {
      const tt = g.nBars < 3 ? Infinity : bars[i] ?? Infinity;
      if (!(tt < e - 0.5)) break;
      if (k % 2 === 0 && this.ripV.length < 4) this.ripV.push(new THREE.Vector4(760 + 380 * rnd(), 830 + 50 * rnd(), tt, 0));
      else this.birds.push(tt);
      k++;
    }
    // 至少一群鳥（短窗格：太陽之後一拍）
    if (!this.birds.length) this.birds.push(slot(3) + g.beat * 0.5);
    while (this.ripV.length < 4) this.ripV.push(new THREE.Vector4(0, 0, 1e9, 0));
    this.boat = { x: 820 + 160 * rnd(), y: 868 };
  }

  /** 做一張字模＋每組的 uniform 資料；focus：題款（留言）的墨滴，鏡頭跟著移過去。 */
  private inkSet(glyphs: TGlyph[], groups: TGroup[], times: [number, number][], tone: (i: number) => number, focus: boolean): InkSet {
    const mask = glyphMask(glyphs, groups, 2.5, 14, 150, 130, 3);
    this.track(mask);
    const n = Math.min(MAXG, groups.length);
    const G: THREE.Vector4[] = [], Q: THREE.Vector4[] = [];
    for (let i = 0; i < n; i++) {
      const gr = groups[i]!, [t0, t1] = times[i]!;
      G.push(new THREE.Vector4(gr.x + gr.w / 2, gr.y + gr.h / 2, gr.w / 2, t0));
      Q.push(new THREE.Vector4(gr.h / 2, tone(i), t1, hash(this.seed, i) * 97));
      if (focus) this.drops.push({ t: t0, x: gr.x + gr.w / 2, y: gr.y + gr.h / 2 });
    }
    return { mask, G, Q, n, rect: mask.rect };
  }

  private bind(S: string, set: InkSet | null, a: number, water: number) {
    const u = this.bg.u;
    u[`a${S}`]!.value = set ? a : 0;
    if (!set) return;
    u[`m${S}`]!.value = set.mask.tex; u[`x${S}`]!.value = set.mask.idx;
    (u[`r${S}`]!.value as THREE.Vector4).set(...set.rect);
    (u[`s${S}`]!.value as THREE.Vector2).set(set.mask.w, set.mask.h);
    u[`w${S}`]!.value = water; u[`n${S}`]!.value = set.n;
    const G = u[`g${S}`]!.value as THREE.Vector4[], Q = u[`q${S}`]!.value as THREE.Vector4[];
    for (let i = 0; i < set.n; i++) { G[i]!.copy(set.G[i]!); Q[i]!.copy(set.Q[i]!); }
  }

  /** 鏡頭：先看山（偏左、稍斜），題款開始落墨時焦點慢慢移過去；整段慢慢推近（縮放一直在 0.97～1.0）。 */
  private pose(t: number) {
    const s = this.ctx.start, e = this.ctx.end;
    const land = ease.outExpo(prog(t, s, s + Math.min(1.1, this.g.beat * 2.2)));
    const push = prog(t, s, e, ease.inOutQuad);
    const t0 = this.drops[0]?.t ?? (this.lines[0]?.line.start ?? s + 1);
    const toText = ease.inOutCubic(prog(t, t0 - 0.2, t0 + 2.2));
    const side = hash(this.seed, 5) < 0.5 ? -1 : 1;
    return {
      tx: lerp(900, 1000, toText), ty: 540 + 8 * (1 - land),
      dist: 1600 * (1.03 - 0.015 * land - 0.015 * push),
      pitch: 0.12 - 0.08 * land, yaw: side * (0.05 - 0.035 * land + 0.012 * push), roll: side * 0.01 * (1 - land), level: 0.75, focal: 1600,
    };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, lyrics, song } = this.ctx;
    const t = f.t;
    this.cam.set(this.pose(t));
    const u = this.bg.u;
    this.cam.apply(u);
    u.t!.value = t;
    u.grainTex!.value = t21Grain(renderer);
    // 山水
    const RG = u.ridge!.value as THREE.Vector4[];
    for (let i = 0; i < RN; i++) { const r = this.ridge[i]!; RG[i]!.set(r[0], r[1], r[2], 0); }
    (u.lay!.value as THREE.Vector4[]).forEach((v, i) => v.copy(this.layDrops[i]!));
    (u.sun!.value as THREE.Vector4).copy(this.sunV);
    (u.dots!.value as THREE.Vector4[]).forEach((v, i) => v.copy(this.dotsV[i]!));
    (u.rip!.value as THREE.Vector4[]).forEach((v, i) => v.copy(this.ripV[i]!));

    const L = this.lyr; L.clear();
    const c = L.ctx;
    /** 要畫原文副行的句子與它的淡入淡出（跟著中文那一句）。 */
    let subs: [LineSet | undefined, number][] = [];
    if (this.main) {
      this.bind('A', this.main, 1, 1);
      this.bind('B', null, 0, 0);
    } else {
      // 沒有留言：現在這一句（或下一句，提早 0.35 秒）用 A、上一句用 B（乾了、淡下去）
      const cur = this.lines.findIndex((ls) => t < ls.line.end + 0.05 && t >= ls.line.start - 0.35);
      let a = cur, b = -1;
      if (a < 0) {
        // 兩句之間：最後唱完的那一句還留著
        for (let i = 0; i < this.lines.length; i++) if (this.lines[i]!.line.start - 0.35 <= t) a = i;
      }
      if (a > 0) b = a - 1;
      const la = this.lines[a], lb = this.lines[b];
      const kin = la ? clamp((t - (la.line.start - 0.35)) / 0.35) : 0;
      this.bind('A', la ?? null, 1, kin);
      // 上一句：新的一句開始唱之後淡到四成，同一行要換下一句之前消失
      const kb = la ? 1 - 0.6 * clamp((t - la.line.start) / 0.8) : 1;
      this.bind('B', lb ?? null, kb, 1);
      subs = [[la, kin], [lb, kb]];
    }

    this.drawWater(c, t);
    this.drawBirds(c, t);
    // ---- 印章：在拍點「蓋」下去（先大一點、淡，一下子壓實）
    if (this.seal && t >= this.tSeal - 0.06) {
      const k = clamp((t - (this.tSeal - 0.06)) / 0.06), sc = lerp(1.25, 1, ease.outCubic(k));
      c.save();
      c.globalAlpha = 0.25 + 0.75 * k;
      c.translate(this.sealAt.x + this.seal.w / 2, this.sealAt.y + this.seal.h / 2);
      c.rotate(-0.03); c.scale(sc, sc);
      c.drawImage(this.seal.cv, -this.seal.w / 2, -this.seal.h / 2, this.seal.w, this.seal.h);
      c.restore();
    }
    // ---- 題款下面的淡墨歌詞
    const ink: KaraokeInk = { active: rgba('blood'), sung: rgba('sepia', 0.85), unsung: rgba('sepia', 0.25) };
    if (this.msg && this.block) {
      const ly = lyricAt(lyrics, t);
      const y = this.block.box[1] + this.block.box[3] + 34 + this.lyrSize;
      if (ly) {
        const lay = layoutRows(c, ly.line, { family: FAM_LYR, size: this.lyrSize, minSize: V2.lyrMin / 0.97, maxW: LYR.w, maxRows: 2, align: 'left' });
        c.save(); c.translate(LYR.x, y);
        drawRows(c, lay, FAM_LYR, t, ink, ly.k);
        c.restore();
      } else if (!this.hasLyrics) {
        this.small(c, `♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`, LYR.x, y - 20, F.mono(500), 18, 4);
      }
      if (this.msg.couple) this.small(c, 'FROM THE COUPLE  ·  新人', MSG_BOX.x, this.block.box[1] - 22, F.mono(500), 17, 5, rgba('blood', 0.75));
    } else {
      // 原文副行（淡墨）：現在這一句與上一句各自跟著中文淡入、淡到四成
      for (const [ls, k] of subs) {
        if (!ls?.sub || k <= 0) continue;
        c.save(); c.translate(MSG_BOX.x, ls.sub.y);
        drawLyricSub(c, ls.sub.line, t, { ...ls.sub.st, sung: ink.sung, unsung: ink.unsung }, ls.sub.size, k);
        c.restore();
      }
      this.small(c, T21_INVITE, MSG_BOX.x, this.hasLyrics ? 640 : 470, F.hei(500), 22, 3, rgba('sepia', 0.55));
      if (!this.hasLyrics) this.small(c, `♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`, MSG_BOX.x, 510, F.mono(500), 17, 4);
    }
    u.lyr!.value = L.upload();
    this.bg.render(renderer, out);
    return {
      paper: 1, bloom: 0.2, vignette: 0.4, grain: 0.04,
      shake: [0, pulse(t, this.tSeal, 0.07) * 2.5],
      popupAvoid: this.avoid.map((r) => this.cam.screenRect(r, 10)),
    };
  }

  /** 水：幾筆橫的淡墨水紋（慢慢晃）、一艘小船（跟著大鼓輕輕浮一下，慢慢往右漂）。右下角（HUD）留白。 */
  private drawWater(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, s = this.ctx.start;
    c.save();
    c.lineCap = 'round';
    const rnd = mulberry32(this.seed + 41);
    for (let i = 0; i < 7; i++) {
      const y = 812 + i * 17 + rnd() * 8, x = 560 + rnd() * 560, w = 50 + rnd() * 120;
      const dx = 10 * Math.sin(t * 0.6 + i * 1.7);
      c.strokeStyle = rgba('sepia', 0.1 + 0.08 * rnd()); c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(x + dx, y); c.quadraticCurveTo(x + dx + w / 2, y - 2, x + dx + w, y + 1); c.stroke();
    }
    // 小船：船身一道弧、竹篷一個半圓；大鼓時浮一下
    const bob = 2.5 * pulse(t, au.timeOfBeat(Math.floor(au.beatAt(t))), 0.18);
    const bx = this.boat.x + 7 * (t - s), by = this.boat.y + bob + 1.2 * Math.sin(t * 1.3);
    c.strokeStyle = rgba('sepia', 0.85); c.lineWidth = 2.4;
    c.beginPath(); c.moveTo(bx - 42, by - 6); c.quadraticCurveTo(bx, by + 8, bx + 46, by - 8); c.stroke();
    c.fillStyle = rgba('sepia', 0.55);
    c.beginPath(); c.moveTo(bx - 16, by - 3); c.quadraticCurveTo(bx - 2, by - 26, bx + 16, by - 4); c.closePath(); c.fill();
    c.lineWidth = 1.4; c.beginPath(); c.moveTo(bx + 30, by - 5); c.lineTo(bx + 58, by - 38); c.stroke();
    // 倒影：兩三筆斷斷續續的淡線
    c.strokeStyle = rgba('sepia', 0.18); c.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) { const yy = by + 9 + i * 7; c.beginPath(); c.moveTo(bx - 30 + i * 6, yy); c.lineTo(bx + 20 - i * 8, yy); c.stroke(); }
    c.restore();
  }

  /** 兩隻鳥：從題款左邊往左上飛過山頭（兩小節），翅膀一拍拍一下。 */
  private drawBirds(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, g = this.g;
    for (const tb of this.birds) {
      const dur = g.bar * 2;
      const k = (t - tb) / dur;
      if (k < 0 || k > 1) continue;
      for (let j = 0; j < 2; j++) {
        const x = lerp(1000, 120, k) - j * 46, y = lerp(330, 210, k) + j * 22 + 8 * Math.sin(k * 9 + j);
        const flap = Math.sin(au.beatAt(t) * Math.PI * 2 + j * 1.2);
        const wing = 10 + 3 * flap, lift = 5 + 5 * flap;
        c.save();
        c.globalAlpha = Math.min(1, k * 8, (1 - k) * 8);
        c.strokeStyle = rgba('sepia', 0.8); c.lineWidth = 2; c.lineCap = 'round';
        c.beginPath(); c.moveTo(x - wing, y - lift); c.quadraticCurveTo(x - 3, y - 2, x, y); c.quadraticCurveTo(x + 3, y - 2, x + wing, y - lift); c.stroke();
        c.restore();
      }
    }
  }

  private small(c: CanvasRenderingContext2D, text: string, x: number, y: number, family: string, size: number, tracking: number, color = rgba('sepia', 0.6)) {
    c.font = font(family, size); c.letterSpacing = `${tracking}px`; c.fillStyle = color;
    c.fillText(text, x, y);
    c.letterSpacing = '0px';
  }

  override dispose() {
    if (this.seal) freeCanvas(this.seal);
    super.dispose();
  }
}
