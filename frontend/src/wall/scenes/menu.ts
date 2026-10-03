// 喜宴菜單（亮）：一張辦桌菜單卡平放在白色緞紋桌巾上，鏡頭從斜上方看（three.js 透視），全部中文直排、由右往左讀。
// 照「MV 融合原則」：整張卡只有一個焦點——「主廚推薦」這一道就是主打留言，直排的大字；其他都是小字、低對比的配角。
//  - 切進來：鏡頭從高一點、遠一點的地方滑進來（第一拍停住），之後每個小節慢慢推近一點、在小節線上緩停；
//    桌巾有景深（離焦點越遠花紋越糊），前景一只糊掉的瓷盤、遠處一只茶杯，光從左上打過來。
//  - 仙女棒從右上角出發，沿著卡片的雙線邊框一拍描一邊（窗格短就半拍一邊），描過的線變成「燙金」，轉過一個角就長出那個角的回紋；
//    每個小節線那一下大鼓，一道光掃過燙金的線。
//  - 第一拍起：右邊的標題（小小的燙金「囍」、喜宴菜單）壓上去；左上角一小群菜名（小字）一拍一欄由上往下刷出來。
//  - 「主廚推薦」：訊號色的小方章「碰」地蓋上，主打留言直排大字、一個字一個字寫出來（剛寫好是訊號色的暗部，冷卻成墨色），
//    寫完簽「—— 名字 特製」。英文為主的留言直排讀不了，改成橫排大字放在同一個位置。
//  - 留言寫完以後每個小節線「上一道菜」：菜名下面蓋一個小小的「已上」章；最後一個小節線標題下面蓋「囍」章落款、畫面輕震。
//  - 歌詞印在卡片下緣（中等大小，照跟唱規則：正在唱是訊號色的暗部、唱完墨色、還沒唱三成）。純音樂：寫歌名（純音樂）。
//  - 沒有留言：主廚推薦是「本道需現點」＋邀請掃 QR；新人的留言：章是「新人推薦」、署名是新人。
// v2（留言尺寸標準）：菜單卡縮到畫面左邊（螢幕上約 870×500），留言 40～60 px；右邊是辦桌的圓桌轉盤（玻璃轉盤上五盤菜冒著熱氣），
// 每個小節線轉盤轉一格（outBack），是這個版面的主視覺。
// 畫法：桌巾（景深、瓷盤、茶杯、轉盤、卡片的影子）與卡紙各是一個 three.js 的材質（模組層共用）；卡片上的字是一張 fast Canvas2D 貼上去
// （有 mipmap，斜著看才不會閃）：不會變的菜名、標題 init 時先畫在另一張畫布，每格只剪下「刷到哪裡」；
// 燙金的邊框、回紋、火花是 LineBatch，用跟卡片一樣的矩陣畫在 3D 裡（所以跟著透視）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H, SCALE } from '../engine/gl';
import { GLSL_COMMON, THEME_UNIFORMS } from '../engine/glsl/common';
import { LineBatch } from '../engine/lines';
import { F, font, layout, loadText, measure } from '../engine/type';
import { rgba, mixRgba, LIN } from '../engine/palette';
import { clamp, ease, lerp, prog, pulse, mulberry32 } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import type { Lyrics } from '../engine/lyrics';
import { lyricAt, drawLyric, layoutLyric, lyricSubOf, subGap, subSizeFor, subStyleFor, sparkHead, sparkParticles, COUPLE_ZH, NAME_A, NAME_B, DATE, joinBits, type LyricLayout, type LyricStyle } from './_motifs';
import { grid, stagger, paperLyric, mono, FAST_TEX_GLSL, type Grid } from './_t2';
import { V2, msgMaxFor, lyricV2, sigV2, fitClauses } from './_v2';
import { vFit, vColumn, vPlace, vDrawUnit, BR, type VLayout, type VPlaced } from './menu-vert';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'doc', paper: true, energy: [0.1, 0.85], bars: [4, 8] };

type P2 = { x: number; y: number };
type RGB = [number, number, number];

// ---------------------------------------------------------------- 卡片上的版面（卡片座標：1 單位 = 桌面上 1 px，y 向下）
const CW = 1240, CH = 820;
/** 卡片貼圖的解析度倍率：斜著看、推近時字還是銳利。 */
const RES = 1.25;
/** 邊框：外圈粗線、內圈細線（離卡緣的距離）。 */
const OUT_IN = 20, INN_IN = 30;
/** 右邊的標題欄（小）。 */
const TITLE = { cx: 1150, rule: 1096 };
/** 主打留言（主廚推薦）的範圍：卡片中間偏右的一大塊。 */
const MSG = { x0: 400, x1: 1076, top: 112, bot: 582 };
/** 左上角的菜名小字群。 */
const DISH = { x1: 392, pitch: 40, top: 118, size: 26, served: 262 };
/** 歌詞：小標籤、一行／兩行的基線。 */
const LYR = { x: 96, w: 1010, rule: 596, label: 620, top: 628, bot: 790 };
const HAND = F.hand(700);
/** 轉盤（桌面座標）：卡片右邊。 */
const SUSAN = { x: 1500, y: 330, r: 560 };
const DISH_F = F.ming(700);

// ---------------------------------------------------------------- 菜色（辦桌的吉祥菜名；種子換組合）
const OPENERS = ['金玉滿堂', '吉祥如意'];
const MAINS = ['鴻運當頭', '花好月圓', '年年有餘', '龍鳳呈祥', '比翼雙飛', '百年好合', '珠聯璧合', '好事成雙', '錦上添花'];
const FRUIT = '滿載而歸';
const DESSERTS = ['甜甜蜜蜜', '圓圓滿滿'];
/** 沒有留言時的邀請：自己決定斷在哪一欄（直排的自動斷欄會把「祝福」拆開）。 */
const INVITE_V = ['本道需現點：', '掃描右下角', 'QR code，', '寫下你的祝福'].join(BR);
const FIXED = `喜宴菜單伴宴歌曲純音樂主廚推薦新人特製已上囍一位賓客上菜${INVITE_V}${[...OPENERS, ...MAINS, FRUIT, ...DESSERTS].join('')}〇一二三四五六七八九十年月日`;

/** 婚禮日期寫成直排的國字：二〇二七年五月二十日（還沒定日期是空字串，標題欄就只寫名字）。 */
function cnDate(): string {
  if (!DATE) return '';
  const D = '〇一二三四五六七八九';
  const num = (n: number) => (n <= 10 ? (n === 10 ? '十' : D[n]!) : n < 20 ? '十' + D[n - 10]! : D[Math.floor(n / 10)]! + '十' + (n % 10 ? D[n % 10]! : ''));
  return `${Array.from(DATE.yyyy).map((ch) => D[+ch]!).join('')}年${num(DATE.m)}月${num(DATE.d)}日`;
}
/** 標題欄裡新人名字那一欄最長多高（卡片座標）：從 y 182 往下，要停在落款的「囍」章（y ≈ 542 起）上面。 */
const WHO_H = 340;

// ---------------------------------------------------------------- 3D：桌巾與卡紙（模組層共用）
const VERT = /* glsl */ `
precision highp float;
in vec3 position; in vec2 uv;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
out vec3 vWP; out vec2 vUv;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz; vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

/**
 * 桌巾：緞紋暗花、斜紋細紋、燙過的摺痕；景深用「離焦點越遠，細節越糊、對比越低」近似（全是程序生成的花紋，
 * 模糊就是把邊緣的 smoothstep 放寬）。瓷盤（前景、糊）與茶杯（遠處、糊）也在這裡畫，卡片的影子用卡片的 SDF。
 */
const TABLE_FRAG = /* glsl */ `
precision highp float;
precision highp int;
in vec3 vWP; in vec2 vUv;
out vec4 fragColor;
uniform vec3 cameraPosition;
uniform vec4 card;   // 卡片中心 xy、半寬高（桌面座標）
uniform float cardR; // 卡片在桌上的旋轉
uniform float focus; // 對焦距離
uniform vec4 plate;  // 瓷盤中心 xy、半徑
uniform vec4 cup;    // 茶杯中心 xy、半徑
uniform vec4 susan;  // 轉盤中心 xy、半徑、轉角（v2：辦桌的玻璃轉盤是主視覺）
uniform float tt;    // 時間（熱氣）
${GLSL_COMMON}
float damask(vec2 p, float b) {
  vec2 q = p / vec2(230.0, 200.0);
  q.x += 0.5 * mod(floor(q.y), 2.0);
  vec2 f = abs(fract(q) - 0.5);
  float r = length(f), a = atan(f.y, f.x);
  float w = 0.02 + 0.14 * b;
  float petal = abs(r - 0.17 - 0.06 * cos(a * 4.0));
  float lattice = abs(f.x + f.y - 0.47);
  return max(1.0 - smoothstep(0.0, w, petal), (1.0 - smoothstep(0.0, w * 0.7, lattice)) * 0.5) * (1.0 - 0.55 * b);
}
// 一只圓形的瓷器（盤或杯）：白瓷、一圈燙金的邊、盤心淺淺的凹；b 是模糊程度
vec4 porcelain(vec2 p, vec4 d, float b, float well) {
  float r = length(p - d.xy), R = d.z;
  float w = 1.5 + 110.0 * b;
  float inside = 1.0 - smoothstep(R - w, R + w, r);
  vec3 col = mix(C_PAPER, C_BONE, 0.45) * (1.0 - 0.05 * well * smoothstep(R * 0.35, R * 0.8, r) * (1.0 - smoothstep(R * 0.8, R * 0.9, r)));
  float gw = 2.5 + 70.0 * b;
  float rim = exp(-pow((r - R * 0.87) / gw, 2.0)) * (1.0 - 0.5 * b);
  col = mix(col, mix(C_BLOOD, C_SIGNAL, 0.35), rim * 0.55);
  return vec4(col, inside);
}
void main() {
  vec2 p = vWP.xy;
  float dist = distance(cameraPosition, vWP);
  float b = clamp(abs(dist - focus) / 750.0, 0.0, 1.0);
  b = b * b * (3.0 - 2.0 * b);
  // 太小（遠處）的細紋畫不出來：依螢幕上的像素大小淡掉，免得閃
  float aa = clamp(1.4 - fwidth(p.x) * 0.9, 0.0, 1.0);
  vec3 cloth = mix(C_PAPER, C_SEPIA, 0.085);
  cloth *= 1.0 + 0.012 * (1.0 - b) * aa * (0.5 + 0.5 * sin((p.x + p.y) * 1.9));
  cloth *= 1.0 + 0.035 * damask(p, b);
  float cw = 14.0 + 90.0 * b;
  float dx = p.x - (floor((p.x - 300.0) / 620.0 + 0.5) * 620.0 + 300.0);
  float dy = p.y - (floor((p.y + 120.0) / 640.0 + 0.5) * 640.0 - 120.0);
  cloth *= 1.0 + 0.012 * sign(dx) * exp(-abs(dx) / cw) + 0.012 * sign(dy) * exp(-abs(dy) / cw);
  // 卡片、瓷盤、茶杯的影子（光從左上方來：影子往右下）
  vec2 q = rot2(-cardR) * (p - card.xy - vec2(16.0, -24.0));
  float sh = 1.0 - smoothstep(-26.0, 46.0, sdBox(q, card.zw - 6.0));
  float shP = 1.0 - smoothstep(-40.0 - 60.0 * b, 70.0 + 80.0 * b, length(p - plate.xy - vec2(26.0, -34.0)) - plate.z);
  float shC = 1.0 - smoothstep(-30.0 - 60.0 * b, 50.0 + 80.0 * b, length(p - cup.xy - vec2(20.0, -26.0)) - cup.z);
  cloth *= 1.0 - 0.2 * sh - 0.08 * shP - 0.08 * shC;
  vec3 col = cloth;
  vec4 pl = porcelain(p, plate, b, 1.0);
  col = mix(col, pl.rgb, pl.a);
  vec4 cu = porcelain(p, cup, b, 0.0);
  // 茶杯裡的茶：訊號色的暗部，很淡
  float tea = 1.0 - smoothstep(cup.z * 0.62 - 2.0 - 50.0 * b, cup.z * 0.62 + 2.0 + 50.0 * b, length(p - cup.xy));
  cu.rgb = mix(cu.rgb, mix(C_BLOOD, C_SEPIA, 0.4), tea * 0.45);
  col = mix(col, cu.rgb, cu.a);
  // ---- 轉盤：一大片玻璃（淡淡的反光、邊緣一圈亮線），上面五盤菜跟著轉，菜冒著熱氣。
  // 轉盤是主視覺：景深只糊一點點（b 打三折），菜才看得清楚
  {
    float bs = b * 0.3;
    vec2 sd = p - susan.xy;
    float sr = length(sd), SR = susan.z, bw = 2.0 + 60.0 * bs;
    float glass = 1.0 - smoothstep(SR - bw, SR + bw, sr);
    // 轉盤下面的影子（往右下）與玻璃本身（比桌巾亮一點點、帶一道斜斜的反光）
    col *= 1.0 - 0.1 * (1.0 - smoothstep(SR - 60.0, SR + 90.0, length(sd - vec2(24.0, -30.0))));
    float refl = exp(-pow(dot(sd, normalize(vec2(1.0, -0.8))) / (SR * 0.18), 2.0)) * 0.05;
    col = mix(col, col * 0.96 + C_BONE * (0.05 + refl), glass);
    col += C_BONE * 0.22 * exp(-pow((sr - SR) / (2.5 + 40.0 * bs), 2.0));
    for (int i = 0; i < 5; i++) {
      float a = susan.w + float(i) * TAU / 5.0;
      vec2 pc = susan.xy + vec2(cos(a), sin(a)) * SR * 0.6;
      float pr = SR * 0.27;
      col *= 1.0 - 0.1 * (1.0 - smoothstep(pr - 20.0, pr + 50.0, length(p - pc - vec2(14.0, -18.0))));
      vec4 dish = porcelain(p, vec4(pc, pr, 0.0), bs, 1.0);
      col = mix(col, dish.rgb, dish.a);
      // 菜：盤心一圈醬汁、上面一團菜（邊緣是雜訊的起伏）、幾點亮的配料；顏色從色票混出來，偏暖的醬色、不要太飽和
      vec2 fp = (p - pc) / (pr * 0.6);
      float n = snoise(fp * 1.6 + float(i) * 7.3);
      float fr = length(fp);
      float sauce = 1.0 - smoothstep(0.92 + 0.05 * n, 0.98 + 0.05 * n, fr);
      col = mix(col, mix(mix(C_BLOOD, C_SEPIA, 0.55), C_PAPER, 0.35), sauce * 0.55);
      float food = 1.0 - smoothstep(0.66 + 0.14 * n - 0.05, 0.66 + 0.14 * n + 0.05, fr);
      vec3 fc = mix(mix(C_SEPIA, C_PAPER, 0.28), mix(C_BLOOD, C_PAPER, 0.25), 0.35 + 0.3 * fract(float(i) * 0.43));
      // 菜的起伏：大尺度的雜訊＋一個圓頂的打光（左上亮、右下暗），再一小塊油亮的反光
      float tex = snoise((p - pc) / 26.0 + float(i) * 3.0);
      vec2 dome = fp / 0.7;
      float lit = 0.8 + 0.28 * (1.0 - dot(dome, dome)) + 0.12 * dot(normalize(dome + 1e-4), normalize(vec2(-0.7, 0.7))) * length(dome);
      fc *= lit * (0.93 + 0.1 * tex);
      float gloss = exp(-dot(fp - vec2(-0.25, 0.28), fp - vec2(-0.25, 0.28)) * 18.0);
      fc = mix(fc, C_BONE, 0.35 * gloss);
      col = mix(col, fc, food * 0.95);
      // 配料：幾個亮點（訊號色的亮部，像蔥花／枸杞）
      float dots = smoothstep(0.8, 0.92, snoise((p - pc) / 16.0 + float(i) * 11.0)) * food;
      col = mix(col, mix(C_EMBER, C_PAPER, 0.3), dots * 0.7);
      // 熱氣：往遠處（+y）飄的一縷白煙，隨時間往上捲（很柔，大尺度）
      vec2 q2 = (p - pc) / vec2(pr * 0.8, pr * 2.4) - vec2(0.0, 0.55);
      float plume = exp(-dot(q2, q2) * 1.8);
      float wisp = smoothstep(-0.1, 0.55, fbm((p - pc) / vec2(120.0, 260.0) - vec2(0.0, tt * 0.35) + float(i) * 3.1, 2));
      col += C_BONE * 0.2 * plume * wisp;
    }
    // 轉盤中間：一只不動的小糖碟
    vec4 hub = porcelain(p, vec4(susan.xy, SR * 0.16, 0.0), bs, 0.0);
    col = mix(col, hub.rgb, hub.a);
  }
  // 光：左上方一盞暖光，卡片附近最亮，四周暗下去
  vec2 lc = card.xy + vec2(-300.0, 380.0);
  col *= 0.86 + 0.16 * exp(-dot(p - lc, p - lc) / (2.0 * 1500.0 * 1500.0));
  fragColor = vec4(col, 1.0);
}`;

/** 卡紙：跟桌巾一樣的紙色但亮一點（不比 bone 刺眼）、很細的纖維、紙的厚度；字從 fast 的 Canvas2D 貼圖來。 */
const CARD_FRAG = /* glsl */ `
precision highp float;
precision highp int;
in vec3 vWP; in vec2 vUv;
out vec4 fragColor;
uniform sampler2D ink;
${GLSL_COMMON}
${FAST_TEX_GLSL}
void main() {
  vec2 px = vec2(vUv.x * ${CW}.0, (1.0 - vUv.y) * ${CH}.0);
  vec3 paper = mix(C_PAPER, C_BONE, 0.6) * (0.988 + 0.014 * snoise(px / 95.0) + 0.006 * snoise(px * 0.42));
  float e = min(min(px.x, ${CW}.0 - px.x), min(px.y, ${CH}.0 - px.y));
  paper *= 1.0 - 0.07 * (1.0 - smoothstep(0.0, 3.0, e));
  // 左上方來的光：卡片左上亮一點
  paper *= 0.965 + 0.04 * (1.0 - px.y / ${CH}.0) + 0.025 * (1.0 - px.x / ${CW}.0);
  vec4 k = fastTex(ink, vUv);
  fragColor = vec4(mix(paper, k.rgb, k.a), 1.0);
}`;

const make3D = () => {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(26, W / H, 50, 30000);
  const tableMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: TABLE_FRAG, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {
      ...THEME_UNIFORMS, card: { value: new THREE.Vector4() }, cardR: { value: 0 }, focus: { value: 2500 },
      plate: { value: new THREE.Vector4() }, cup: { value: new THREE.Vector4() }, susan: { value: new THREE.Vector4() }, tt: { value: 0 },
    },
  });
  const table = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000), tableMat);
  table.renderOrder = 0;
  const cardMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: CARD_FRAG, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { ...THEME_UNIFORMS, ink: { value: null } },
  });
  // 卡片的幾何直接用卡片座標（0..CW, 0..CH）：跟 Canvas2D、LineBatch 同一套座標，矩陣只有一個
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, CW, 0, 0, CW, CH, 0, 0, CH, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  const card = new THREE.Mesh(g, cardMat);
  card.renderOrder = 1;
  card.matrixAutoUpdate = false;
  card.frustumCulled = false;
  table.frustumCulled = false;
  scene.add(table, card);
  return { scene, cam, tableMat, cardMat, card };
};

// ---------------------------------------------------------------- 邊框與回紋（燙金的線，卡片座標）
interface Seg { a: P2; b: P2; p0: number; p1: number; w: number }
/** 邊框的四條邊依序（右上 → 左上 → 左下 → 右下 → 右上），每條邊一個參數區間 [k, k+1)，切成短段（掃光的顏色才會有位置）。 */
function frameSegs(inset: number, w: number): Seg[] {
  const x0 = inset, x1 = CW - inset, y0 = inset, y1 = CH - inset;
  const corners: P2[] = [{ x: x1, y: y0 }, { x: x0, y: y0 }, { x: x0, y: y1 }, { x: x1, y: y1 }, { x: x1, y: y0 }];
  const out: Seg[] = [];
  for (let k = 0; k < 4; k++) {
    const A = corners[k]!, B = corners[k + 1]!;
    const n = Math.max(2, Math.round(Math.hypot(B.x - A.x, B.y - A.y) / 22));
    for (let i = 0; i < n; i++) {
      const u0 = i / n, u1 = (i + 1) / n;
      out.push({ a: { x: lerp(A.x, B.x, u0), y: lerp(A.y, B.y, u0) }, b: { x: lerp(A.x, B.x, u1), y: lerp(A.y, B.y, u1) }, p0: k + u0, p1: k + u1, w });
    }
  }
  return out;
}
/** 四個角的回紋：往角裡捲的方形螺旋，依角鏡射。k：第幾個角（1 左上、2 左下、3 右下、4 右上，跟火花到達的順序一樣）。 */
function fretPolys(): { k: number; pts: P2[] }[] {
  const S = 40, off = INN_IN + 8;
  const unit: [number, number][] = [[0, 1], [0, 0], [1, 0], [1, 0.74], [0.26, 0.74], [0.26, 0.26], [0.74, 0.26], [0.74, 0.5], [0.5, 0.5]];
  const corners: [number, number, number, number, number][] = [[1, off, off, 1, 1], [2, off, CH - off, 1, -1], [3, CW - off, CH - off, -1, -1], [4, CW - off, off, -1, 1]];
  return corners.map(([k, cx, cy, sx, sy]) => ({ k, pts: unit.map(([u, v]) => ({ x: cx + sx * u * S, y: cy + sy * v * S })) }));
}

// ---------------------------------------------------------------- 章（init 預先畫好：印泥的斑駁、缺墨）
function makeSeal(o: { size: number; round: boolean; chars: string; fill: boolean; seed: number }): HTMLCanvasElement {
  const px = Math.ceil(o.size * SCALE * RES) + 4;
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const c = cv.getContext('2d')!;
  c.scale(px / o.size, px / o.size);
  const S = o.size, ink = mixRgba('signal', 'blood', 0.45);
  const shape = (inset: number) => {
    c.beginPath();
    if (o.round) c.arc(S / 2, S / 2, S / 2 - inset, 0, Math.PI * 2);
    else c.roundRect(inset, inset, S - inset * 2, S - inset * 2, S * 0.08);
  };
  const chars = Array.from(o.chars);
  const drawChars = () => {
    // 章裡的字：一個字置中；兩個字直排一欄；四個字排成兩欄（右欄先讀，跟印章一樣）
    c.textAlign = 'center'; c.textBaseline = 'middle';
    if (chars.length === 1) {
      c.font = font(F.ming(900), S * 0.66);
      c.fillText(chars[0]!, S / 2, S / 2 + S * 0.03);
    } else if (chars.length === 2) {
      const fs = S * 0.3;
      c.font = font(F.ming(900), fs);
      c.fillText(chars[0]!, S / 2, S / 2 - fs * 0.55); c.fillText(chars[1]!, S / 2, S / 2 + fs * 0.6);
    } else {
      const fs = S * 0.36;
      c.font = font(F.ming(900), fs);
      const xs = [S * 0.73, S * 0.73, S * 0.28, S * 0.28], ys = [S * 0.3, S * 0.71, S * 0.3, S * 0.71];
      chars.slice(0, 4).forEach((ch, i) => c.fillText(ch, xs[i]!, ys[i]!));
    }
  };
  c.fillStyle = ink; c.strokeStyle = ink;
  if (o.fill) {
    // 白文：整塊印泥、字挖空
    shape(1); c.fill();
    c.globalCompositeOperation = 'destination-out';
    drawChars();
    c.globalCompositeOperation = 'source-over';
  } else {
    // 朱文：一圈框＋紅字
    c.lineWidth = S * 0.07; shape(S * 0.05); c.stroke();
    drawChars();
  }
  // 印泥的斑駁：隨機的小缺墨點（確定性：用種子）
  const rnd = mulberry32(o.seed);
  c.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < Math.round(S * 0.9); i++) {
    c.globalAlpha = 0.25 + 0.6 * rnd();
    c.beginPath(); c.arc(rnd() * S, rnd() * S, 0.4 + rnd() * rnd() * S * 0.035, 0, Math.PI * 2); c.fill();
  }
  // 邊緣壓得不平：一側淡一點
  const gr = c.createLinearGradient(0, 0, S, S);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${0.18 + 0.2 * rnd()})`);
  c.globalAlpha = 1; c.fillStyle = gr; c.fillRect(0, 0, S, S);
  c.globalCompositeOperation = 'source-over';
  return cv;
}

// ---------------------------------------------------------------- 版面物件
interface Dish { name: string; cx: number; t: number; served: number }

export default class Menu extends Scene {
  g3 = shared('menu.3d', make3D);
  /** 卡片上會動的字（每格重畫、上傳；有 mipmap）。 */
  ink = this.track(new Layer2D(CW, CH, SCALE * RES, { fast: true }));
  /** 不會變的字（菜名、標題）：init 畫一次，不上傳，每格從這裡剪下已經刷出來的部分。 */
  pre = this.track(new Layer2D(CW, CH, SCALE * RES));
  /** 燙金的線與火花：先把卡片座標投影到畫面（PM），畫成 2D 的細線（線寬固定幾 px，跟著透視走的只有位置）。 */
  foil = this.track(new LineBatch(1200, { screen2D: true, blend: 'normal' }));
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  PM = new THREE.Matrix4();
  msg: Msg | null = this.ctx.params.message ?? null;
  g!: Grid;
  dishes: Dish[] = [];
  tTitle = 0;
  tSp = 0;
  /** 直排的留言（或橫排的 fit）、每個字的位置與出現時間。 */
  vl: VLayout | null = null;
  vp: VPlaced[] = [];
  hfit: FitResult | null = null;
  hglyphs: { ch: string; x: number; y: number; i: number }[] = [];
  hsig = { x: 0, y: 0 };
  msgT: number[] = [];
  sig: VLayout | null = null;
  sigP: VPlaced[] = [];
  sigText = '';
  sigSize = 38;
  tSig = Infinity;
  /** 方章的位置。 */
  seal = { x: 0, y: 0 };
  /** 火花描邊：四條邊各自的開始時間與長度。 */
  edgeT: number[] = [];
  edgeDur = 0.4;
  outer = frameSegs(OUT_IN, 2.4);
  inner = frameSegs(INN_IN, 1.1);
  frets = fretPolys();
  /** 最後的落款章。 */
  tFinal = Infinity;
  seals: { chef: HTMLCanvasElement; served: HTMLCanvasElement[]; xi: HTMLCanvasElement } | null = null;
  sealText = '主廚推薦';
  rd = 0.3;
  instr = false;
  /** 卡片 → 世界的矩陣（卡片座標 y 向下 → 桌面 y 向上）。 */
  M = new THREE.Matrix4();
  cardRot = -0.05;
  /** 卡片座標 → 螢幕 px 的縮放（留言那一帶、歌詞那一帶；init 用鏡頭推到一半時量）：v2 的字級是螢幕 px。 */
  k = 0.7; kLy = 0.7;
  /** 署名那一欄的寬度（卡片座標）。 */
  sigW = 60;
  /**
   * 韓文歌有原文副行時，歌詞帶（連上面的細線與「伴宴歌曲」標籤）往上長多少：中文兩行＋原文才放得進內框。
   * 有副行一定沒有主打留言（留言的窗格副行收起來），直排的邀請字排在少這麼多的高度裡；沒有副行是 0，版面跟原本一樣。
   */
  lyrUp = 0;

  constructor(ctx: ConstructorParameters<typeof Scene>[0]) {
    super(ctx);
    // 卡片斜著看：貼圖要有 mipmap 與非等向過濾，遠端的字才不會閃
    const tx = this.ink.texture;
    tx.generateMipmaps = true;
    tx.minFilter = THREE.LinearMipmapLinearFilter;
    tx.anisotropy = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy());
    // 桌上的卡片：先轉到桌面（y 翻過來），再在桌上稍微歪一點；中心在桌面原點
    this.M.makeRotationZ(this.cardRot)
      .multiply(new THREE.Matrix4().makeTranslation(-CW / 2, CH / 2, 0.5))
      .multiply(new THREE.Matrix4().makeScale(1, -1, 1));
  }

  override async init() {
    const { audio: au, lyrics, song, start: s, end: e } = this.ctx;
    const g = this.g = grid(au, s, e);
    const m = this.msg;
    const seed = this.ctx.params.seed ?? 1;
    // 量縮放：用一台暫時的相機擺到窗格中間的位置（共用的相機可能正在畫上一個窗格）
    {
      const tmp = new THREE.PerspectiveCamera(26, W / H, 50, 30000);
      this.camSet(tmp, (s + e) / 2);
      const PMt = new THREE.Matrix4().multiplyMatrices(tmp.projectionMatrix, tmp.matrixWorldInverse).multiply(this.M);
      const kAt = (x: number, y: number) => { const a = this.projWith(PMt, x - 50, y), b = this.projWith(PMt, x + 50, y); return Math.hypot(b.x - a.x, b.y - a.y) / 100; };
      this.k = kAt((MSG.x0 + MSG.x1) / 2, (MSG.top + MSG.bot) / 2);
      this.kLy = kAt(560, (LYR.top + LYR.bot) / 2);
    }
    const rnd = mulberry32(seed);
    this.instr = !lyrics.has;
    const txt = m ? m.text : INVITE_V;
    this.sealText = m?.couple ? '新人推薦' : '主廚推薦';
    this.sigText = m ? (m.couple ? `—— ${m.name || COUPLE_ZH}` : `—— ${m.name || '一位賓客'} 特製`) : '—— 主廚';
    const lyr = lyrics.linesIn(s - 0.5, e + 0.5).map((l) => l.text).join('');
    this.lyrUp = !m && lyrics.linesIn(s - 0.5, e + 0.5).some((l) => lyricSubOf(l)) ? 64 : 0;
    await loadText(`${FIXED}${COUPLE_ZH}${txt}${this.sigText}${song.title}${lyr}${cnDate()}＆`);

    // ---- 主打留言：直排大字（英文為主就橫排），在留言範圍裡找最大字級、置中
    const pre = this.pre.ctx;
    const latin = (txt.match(/[A-Za-z]/g) ?? []).length, cjk = (txt.match(/[㐀-鿿가-힯]/g) ?? []).length;
    const horiz = latin > 6 && latin > cjk * 2;
    const msgBot = MSG.bot - this.lyrUp;
    const colH = msgBot - MSG.top, areaW = MSG.x1 - MSG.x0;
    // 署名先排好（它的空間先扣掉，留言才在剩下的地方找字級）：直排時是留言左邊獨立的一欄，要放得進留言的高度；
    // 橫排時是最後一行下面的一行，要放得進留言的寬度。名字太長縮到最小還放不下，就從尾巴截掉加「…」
    const SIG_F = F.hand(400);
    const sigFits = (text: string, size: number) => (horiz ? measure(text, SIG_F, size) <= areaW - 20 : vColumn(text, SIG_F, size).height <= colH);
    // v2：留言 40～60（依字數的上限）、署名 26～32，都是螢幕 px，除以縮放換成卡片座標
    const k = this.k;
    const mMax = (m ? msgMaxFor(txt) : 50) / k, mMin = V2.msgMin / k;
    let sigSize = sigV2(m ? msgMaxFor(txt) : 44) / k;
    while (sigSize > V2.sigMin / k && !sigFits(this.sigText, sigSize)) sigSize -= 2;
    // 新人的署名是兩個人的全名，可能很長：截成「司馬…」會少掉一個人，先換緊湊的寫法（全形＆、不留空白、拿掉破折號），
    // 再小一點點（不小於署名下限的八成），真的還放不下才截
    if (m?.couple && !sigFits(this.sigText, sigSize)) {
      const alts = [`—— ${NAME_A}＆${NAME_B}`, `${NAME_A}＆${NAME_B}`];
      const alt = alts.find((a) => sigFits(a, sigSize));
      if (alt) this.sigText = alt;
      else {
        this.sigText = alts[1]!;
        while (sigSize > (V2.sigMin * 0.8) / k && !sigFits(this.sigText, sigSize)) sigSize -= 2;
      }
    }
    if (m && !sigFits(this.sigText, sigSize)) {
      let name = Array.from(m.name || '一位賓客');
      const mk = () => (m.couple ? `—— ${name.join('')}…` : `—— ${name.join('')}… 特製`);
      while (name.length > 1 && !sigFits(mk(), sigSize)) name = name.slice(0, -1);
      this.sigText = mk();
    }
    this.sigSize = sigSize;
    this.sigW = Math.ceil(sigSize * 1.25);
    const SIGW = this.sigW;
    if (horiz) {
      const hOpt = { min: mMin, max: mMax, lineHeight: 1.2, maxLines: 7 };
      const hH = colH - sigSize * 1.9;
      this.hfit = fitClauses(pre, txt, HAND, areaW - 20, hH, hOpt) ?? fitText(pre, txt, HAND, areaW - 20, hH, hOpt);
      const fit = this.hfit;
      const top = MSG.top + (hH - fit.height) / 2 + fit.size * 0.9;
      const x0 = MSG.x0 + (areaW - fit.width) / 2;
      let i = 0;
      fit.lines.forEach((ln, r) => {
        for (const gl of layout(ln, HAND, fit.size).glyphs) this.hglyphs.push({ ch: gl.ch, x: x0 + gl.x, y: top + r * fit.lineHeight, i: i++ });
      });
      // 署名在最後一行下面、靠右（太長就往右挪，不超出留言範圍的左緣）
      const sw = measure(this.sigText, SIG_F, sigSize);
      this.hsig = { x: clamp(x0 + fit.width, MSG.x0 + sw, MSG.x1), y: top + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.3 + sigSize * 1.2 };
      this.seal = { x: x0 + fit.width + 36, y: top - fit.size * 0.9 - 18 };
    } else {
      this.vl = vFit(txt, HAND, areaW - SIGW - 12, colH, { min: mMin, max: mMax });
      const l = this.vl;
      const groupW = l.width + SIGW + 12;
      const xr = MSG.x0 + (areaW + groupW) / 2;
      const yTop = MSG.top + (colH - l.height) / 2;
      this.vp = vPlace(l, xr, yTop);
      // 署名：留言最後一欄（最左邊）的再左邊一欄，底部跟留言齊；永遠在留言範圍的上下界裡
      this.sig = vColumn(this.sigText, SIG_F, sigSize);
      const sx = xr - l.width - SIGW / 2 - 8;
      const sigBot = clamp(Math.max(yTop + l.height, yTop + this.sig.height), MSG.top + this.sig.height, msgBot);
      this.sigP = vPlace(this.sig, sx + this.sig.pitch / 2, 0, 'bottom', sigBot);
      this.seal = { x: xr - l.pitch / 2, y: yTop - 50 };
    }

    // ---- 菜：左上角一小群，一欄一道（小字）
    const mains = MAINS.slice();
    for (let i = mains.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [mains[i], mains[j]] = [mains[j]!, mains[i]!]; }
    const names = [OPENERS[Math.floor(rnd() * OPENERS.length)]!, ...mains.slice(0, 4), FRUIT, DESSERTS[Math.floor(rnd() * DESSERTS.length)]!];
    names.forEach((name, i) => this.dishes.push({ name, cx: DISH.x1 - DISH.pitch * (i + 0.5), t: 0, served: Infinity }));

    // ---- 時間：標題在第一拍，接著一拍一道菜（窗格短就一拍兩道、四道）；主廚推薦在第二道之後
    const beat = g.beat;
    this.rd = clamp(beat * 0.7, 0.18, 0.4);
    const n = this.dishes.length + 2;
    const maxD = clamp(Math.min(2 * g.bar, (e - g.b0) * 0.45), beat * 1.5, 2 * g.bar);
    const ts = stagger(au, g.b0, n, maxD);
    this.tTitle = ts[0]!;
    this.dishes.forEach((d, i) => (d.t = ts[i < 2 ? i + 1 : i + 2]!));
    this.tSp = ts[3]!;
    const nUnits = horiz ? this.hfit!.lines.reduce((a, l) => a + Array.from(l).length, 0) : this.vl!.count;
    const m0 = this.tSp + beat * 0.5;
    const maxM = clamp(Math.min(2 * g.bar, (e - m0) * 0.4), 0.5, 2 * g.bar);
    this.msgT = stagger(au, m0, nUnits, maxM);
    this.tSig = (this.msgT[this.msgT.length - 1] ?? m0) + beat * 0.5;

    // ---- 上菜：留言寫完以後，每個小節線上一道；最後一個小節線（甜湯）＋落款章
    const tDone = Math.max(this.tSig + 0.5, ts[ts.length - 1]! + this.rd);
    const barsOk = g.bars.filter((b) => b >= tDone + beat * 0.9 && b <= e - 0.3);
    const beatsOk = g.beats.filter((b) => b >= tDone + beat * 0.4 && b <= e - 0.25);
    const tLast = barsOk.length ? barsOk[barsOk.length - 1]! : beatsOk.length ? beatsOk[beatsOk.length - 1]! : Infinity;
    if (Number.isFinite(tLast)) {
      this.tFinal = tLast;
      const ds = this.dishes;
      const bLast = Math.round(au.beatAt(tLast)), avail = bLast - au.beatAt(tDone);
      const per = avail / Math.max(1, ds.length - 1);
      const step = [8, 4, 2, 1, 0.5].find((k) => k <= per);
      if (step) ds.forEach((d, i) => (d.served = au.timeOfBeat(bLast - (ds.length - 1 - i) * step)));
      else ds[ds.length - 1]!.served = tLast;
    }

    // ---- 火花描邊：一拍一邊（窗格短就半拍一邊），從窗格開頭的那一拍起
    const long = e - s >= 3.5 * g.bar;
    const stepE = long ? 1 : 0.5;
    const bS = Math.ceil(au.beatAt(s) - 0.08);
    this.edgeT = [0, 1, 2, 3].map((k) => Math.max(s, au.timeOfBeat(bS + k * stepE)));
    this.edgeDur = Math.max(0.12, au.beatPeriod(s) * stepE * 0.88);

    // ---- 章
    this.seals = {
      chef: makeSeal({ size: 56, round: false, chars: this.sealText, fill: true, seed: seed + 1 }),
      served: [0, 1, 2].map((k) => makeSeal({ size: 30, round: true, chars: '已上', fill: false, seed: seed + 10 + k })),
      xi: makeSeal({ size: 60, round: false, chars: '囍', fill: true, seed: seed + 3 }),
    };
    this.drawPre();
  }

  /** 不會變的字：標題（「囍」除外，它是燙金、每格畫）、菜名。全部小字、低對比。 */
  private drawPre() {
    const c = this.pre.ctx;
    const col = (text: string, fam: string, size: number, x: number, y: number, fill: string) => {
      const l = vColumn(text, fam, size);
      c.fillStyle = fill;
      for (const p of vPlace(l, x + l.pitch / 2, y)) vDrawUnit(c, p.u, p.x, p.y, fam, size);
    };
    col('喜宴菜單', F.ming(700), 26, TITLE.cx + 10, 178, rgba('sepia', 0.62));
    // 名字可能很長、日期可能很長（十二月二十二日）：整欄放不下就縮字，不壓到最後蓋的「囍」章
    const who = joinBits('　', COUPLE_ZH, cnDate());
    const whoPx = Math.max(10, Math.min(16, Math.floor((16 * WHO_H) / Math.max(1, vColumn(who, F.hei(500), 16).height))));
    col(who, F.hei(500), whoPx, TITLE.cx - 26, 182, rgba('sepia', 0.42));
    for (const d of this.dishes) col(d.name, DISH_F, DISH.size, d.cx, DISH.top, rgba('sepia', 0.55));
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, lyrics, song } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const G3 = this.g3, cam = G3.cam;

    const focusPt = this.camSet(cam, t);
    this.PM.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).multiply(this.M);

    const tu = G3.tableMat.uniforms;
    const cc = new THREE.Vector3(CW / 2, CH / 2, 0).applyMatrix4(this.M);
    (tu.card!.value as THREE.Vector4).set(cc.x, cc.y, CW / 2, CH / 2);
    tu.cardR!.value = this.cardRot;
    tu.focus!.value = cam.position.distanceTo(focusPt);
    (tu.plate!.value as THREE.Vector4).set(-700, -740, 340, 0);
    (tu.cup!.value as THREE.Vector4).set(-1150, 760, 150, 0);
    // 轉盤：卡片的右邊（桌面座標），每個小節線轉一格（五分之一圈，outBack 停住）
    let turn = 0;
    for (const b of this.g.bars) turn += prog(t, b, b + Math.min(0.6, this.g.bar * 0.4), (x) => ease.outBack(x, 1.4));
    (tu.susan!.value as THREE.Vector4).set(SUSAN.x, SUSAN.y, SUSAN.r, -turn * ((Math.PI * 2) / 5) + 0.3);
    tu.tt!.value = t;
    G3.card.matrix.copy(this.M);
    G3.card.matrixWorldNeedsUpdate = true;

    // ---- 卡片上的字
    const L = this.ink;
    L.clear();
    const c = L.ctx;
    const sheen = this.sheenAt(t);

    // 印好的細線：標題欄左邊的直線、歌詞上面的線
    const ruleK = prog(t, s, s + 0.25);
    c.fillStyle = rgba('sepia', 0.2 * ruleK);
    c.fillRect(TITLE.rule, 96, 1, 520 - this.lyrUp);
    c.fillRect(LYR.x, LYR.rule - this.lyrUp, CW - LYR.x * 2, 1);

    // 標題的「囍」：小小的燙金，第一拍壓上去
    if (t >= this.tTitle - 0.02) {
      const v = prog(t, this.tTitle - 0.02, this.tTitle + 0.18, ease.outExpo);
      c.save();
      c.globalAlpha = clamp(v * 2.5) * 0.85;
      c.translate(TITLE.cx, 110); c.scale(lerp(1.25, 1, v), lerp(1.25, 1, v));
      c.font = font(F.ming(900), 60); c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = this.foilGrad(c, sheen, TITLE.cx, 110, 40);
      c.fillText('囍', 0, 3);
      c.restore();
      this.reveal(c, TITLE.cx - 50, TITLE.cx + 50, 160, 640, prog(t, this.tTitle - 0.02, this.tTitle + this.rd * 1.5, ease.outExpo));
    }
    // 菜名：一欄一欄由上往下刷出來；上菜時蓋小小的「已上」章
    let served = 0;
    this.dishes.forEach((d, i) => {
      const r = prog(t, d.t - 0.02, d.t + this.rd, ease.outExpo);
      if (r > 0) this.reveal(c, d.cx - DISH.pitch / 2, d.cx + DISH.pitch / 2, DISH.top - 6, DISH.top + 140, r);
      if (t >= d.served - 0.02) { served++; this.stamp(c, this.seals!.served[i % 3]!, d.cx, DISH.served, 30, -0.2 + 0.13 * ((i * 7) % 3), d.served, t); }
    });
    if (t >= this.dishes[0]!.t) {
      const kk = prog(t, this.dishes[0]!.t, this.dishes[0]!.t + 0.3);
      const bump = Math.max(...this.dishes.map((d) => pulse(t, d.served, 0.1)));
      mono(c, `上菜 ${served}/${this.dishes.length}`, DISH.x1 - DISH.pitch * this.dishes.length + 8, DISH.served + 62 - bump * 2, { size: 15, color: served ? rgba('blood', 0.7 * kk) : rgba('sepia', 0.4 * kk), tracking: 2 });
    }

    // 主廚推薦（主打留言）
    this.special(c, t);
    // 歌詞
    this.lyricBand(c, t, lyrics, song.title);
    // 落款：最後一個小節線，標題下面蓋「囍」章
    if (Number.isFinite(this.tFinal)) this.stamp(c, this.seals!.xi, TITLE.cx - 4, 572, 60, -0.1, this.tFinal, t);
    G3.cardMat.uniforms.ink!.value = L.upload();

    renderer.setRenderTarget(out);
    renderer.clear();
    renderer.render(G3.scene, cam);

    // ---- 燙金的邊框、回紋；火花（跟卡片同一個矩陣，畫在 3D 裡）
    this.drawFoil(t, sheen, out);
    if (this.glow.count) this.glow.render(renderer, out);

    const shk = pulse(t, this.tSp, 0.06) * 0.5 + pulse(t, this.tFinal, 0.08);
    return {
      paper: 1, bloom: 0.3, bloomThreshold: 1.05, bloomKnee: 0.15, halation: 0.06, vignette: 0.3, grain: 0.045,
      shake: [Math.sin(t * 91) * 4 * shk, Math.cos(t * 77) * 3 * shk],
    };
  }

  /** 把預畫好的一欄從上往下刷出來：r 是刷到哪裡（0..1），刷頭那一小段淡一點（毛筆的飛白）。 */
  private reveal(c: CanvasRenderingContext2D, x0: number, x1: number, y0: number, y1: number, r: number) {
    if (r <= 0) return;
    const src = this.pre.canvas, S = src.width / CW;
    const h = (y1 - y0) * r, feather = 14;
    const draw = (ya: number, yb: number, a: number) => {
      if (yb <= ya) return;
      c.globalAlpha = a;
      c.drawImage(src, x0 * S, ya * S, (x1 - x0) * S, (yb - ya) * S, x0, ya, x1 - x0, yb - ya);
    };
    if (r >= 1) draw(y0, y1, 1);
    else { draw(y0, y0 + Math.max(0, h - feather), 1); draw(y0 + Math.max(0, h - feather), y0 + h, 0.45); }
    c.globalAlpha = 1;
  }

  /** 主廚推薦：方章、留言逐字（直排大字或橫排大字）、署名。 */
  private special(c: CanvasRenderingContext2D, t: number) {
    if (t < this.tSp - 0.03) return;
    this.stamp(c, this.seals!.chef, this.seal.x, this.seal.y, 56, 0.06, this.tSp, t);
    // 剛寫好的字是訊號色的暗部，約 0.8 秒冷卻成墨色；愛心是點綴色
    const heat = (ti: number) => 1 - clamp((t - ti - 0.12) / 0.8);
    const colFor = (ch: string, ti: number) => (ch === '♥' ? rgba('rose') : mixRgba('sepia', 'blood', heat(ti) * 0.95, 0.97));
    if (this.vl) {
      const l = this.vl;
      for (const p of this.vp) {
        const ti = this.msgT[p.i] ?? Infinity;
        if (t < ti - 0.01) continue;
        const w = prog(t, ti - 0.01, ti + 0.12, ease.outCubic);
        c.fillStyle = colFor(p.u.s, ti);
        if (w < 1) {
          c.save(); c.beginPath(); c.rect(p.x - l.size, p.y - 4, l.size * 2, (p.u.len + 8) * w); c.clip();
          vDrawUnit(c, p.u, p.x, p.y, l.family, l.size);
          c.restore();
        } else vDrawUnit(c, p.u, p.x, p.y, l.family, l.size);
      }
    } else if (this.hfit) {
      c.font = font(HAND, this.hfit.size); c.textBaseline = 'alphabetic';
      for (const gl of this.hglyphs) {
        const ti = this.msgT[gl.i] ?? Infinity;
        if (t < ti - 0.01) continue;
        c.globalAlpha = prog(t, ti - 0.01, ti + 0.1);
        c.fillStyle = colFor(gl.ch, ti);
        c.fillText(gl.ch, gl.x, gl.y);
      }
      c.globalAlpha = 1;
    }
    // 署名（直排一欄在留言左邊；橫排的留言署名也橫排、靠右）
    if (t >= this.tSig - 0.01) {
      const u = prog(t, this.tSig - 0.01, this.tSig + 0.5, ease.outCubic);
      c.fillStyle = rgba('sepia', 0.72);
      if (this.hfit) {
        c.font = font(F.hand(400), this.sigSize); c.textAlign = 'right';
        const w = c.measureText(this.sigText).width;
        c.save(); c.beginPath(); c.rect(this.hsig.x - w - 4, this.hsig.y - 50, (w + 8) * u, 70); c.clip();
        c.fillText(this.sigText, this.hsig.x, this.hsig.y);
        c.restore(); c.textAlign = 'left';
      } else if (this.sig && this.sigP.length) {
        const sl = this.sig, top = this.sigP[0]!.y, bot = this.sigP[this.sigP.length - 1]!.y + sl.adv;
        const x = this.sigP[0]!.x;
        c.save(); c.beginPath(); c.rect(x - sl.size, top - 6, sl.size * 2, (bot - top + 12) * u); c.clip();
        for (const p of this.sigP) vDrawUnit(c, p.u, p.x, p.y, sl.family, sl.size);
        c.restore();
      }
    }
  }

  /** 蓋章：從大一點、歪一點的地方「碰」地落下（t0 之前不畫）。 */
  private stamp(c: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number, size: number, rot: number, t0: number, t: number) {
    if (t < t0 - 0.03) return;
    const u = prog(t, t0 - 0.03, t0 + 0.12, ease.outExpo);
    const sc = lerp(1.4, 1, u);
    c.save();
    c.globalAlpha = clamp(u * 3) * 0.9;
    c.translate(x, y); c.rotate(rot + (1 - u) * 0.12); c.scale(sc, sc);
    c.drawImage(img, -size / 2, -size / 2, size, size);
    c.restore();
  }

  /** 歌詞：卡片下緣，一行小小的「♪ 伴宴歌曲」標籤，下面是正在唱的那句（中等大小，兩行也放得下）。 */
  private lyricBand(c: CanvasRenderingContext2D, t: number, lyrics: Lyrics, title: string) {
    const k = prog(t, this.ctx.start, this.ctx.start + 0.3);
    c.save();
    c.globalAlpha = k;
    const au = this.ctx.audio;
    const beatNow = au.timeOfBeat(Math.floor(au.beatAt(t)));
    c.font = font(F.hei(500), 16); c.letterSpacing = '4px'; c.textBaseline = 'alphabetic';
    c.fillStyle = rgba('blood', 0.4 + 0.35 * pulse(t, beatNow, 0.15));
    c.fillText('♪', LYR.x, LYR.label - this.lyrUp);
    c.fillStyle = rgba('sepia', 0.42);
    c.fillText('伴宴歌曲', LYR.x + 24, LYR.label - this.lyrUp);
    c.letterSpacing = '0px';
    if (this.instr) {
      // 純音樂：寫歌名（純音樂）
      const txt = `${title}（純音樂）`;
      // 沒有歌詞時留言才是焦點：歌名小一號、淡一點
      const s0 = V2.lyrMin / this.kLy;
      c.font = font(F.ming(700), s0);
      const w = c.measureText(txt).width;
      const size = w > LYR.w ? (s0 * LYR.w) / w : s0;
      c.font = font(F.ming(700), size); c.fillStyle = rgba('sepia', 0.6);
      c.fillText(txt, LYR.x, (LYR.top + LYR.bot) / 2 + size * 0.35);
    } else {
      const ly = lyricAt(lyrics, t);
      if (ly) {
        // 歌詞是第二主角：中等大小、中等字重（斜著看時卡片下緣離鏡頭近，畫面上約 55 px，比留言小一截）
        // v2：歌詞比留言小一級（lyricV2），螢幕 px 換成卡片座標
        const msgScr = this.vl ? this.vl.size * this.k : this.hfit ? this.hfit.size * this.k : null;
        const st: LyricStyle = { family: F.archivo(100, 500), size: lyricV2(this.msg ? msgScr : null) / this.kLy, minSize: V2.lyrMin / this.kLy, maxWidth: LYR.w, lineHeight: 1.12, ...paperLyric() };
        let lay = layoutLyric(c, ly.line, st);
        let y0 = lay.rows.length > 1 ? LYR.top + lay.size * 0.9 : (LYR.top + LYR.bot) / 2 + lay.size * 0.35;
        const sub = lyricSubOf(ly.line);
        if (sub && lay.sub) {
          // 韓文歌：原文副行（drawLyric 畫在中文正下方）。卡片斜著看、畫面上縮成約 kLy 倍，
          // 原文的字級照螢幕 px 算（32～56 是螢幕上的大小），所以換掉 layoutLyric 用卡片座標排的那一份
          const withSub = (l: LyricLayout): LyricLayout => {
            const ss = subSizeFor(l.size * this.kLy) / this.kLy;
            const sl = layoutLyric(c, sub, { ...subStyleFor(st, l.size), size: ss, minSize: Math.min(ss, 26 / this.kLy) });
            const dy = (l.rows.length - 1) * l.size * (st.lineHeight ?? 1.18) + subGap(l.size, sl.size);
            return { ...l, sub: { lay: sl, dy }, height: l.size + dy + sl.height - sl.size };
          };
          // 歌詞帶往上長了 lyrUp；還是放不下就把主行縮一點（先變回一行），整塊在歌詞帶裡垂直置中、不出內框
          const top = LYR.top - this.lyrUp, band = LYR.bot - top - 6;
          const need = (l: LyricLayout) => l.height + (l.sub ? l.sub.lay.size * 0.22 : 0);
          lay = withSub(lay);
          let s2 = st;
          for (let i = 0; i < 8 && need(lay) > band; i++) {
            s2 = { ...s2, size: lay.size * 0.94, minSize: Math.min(s2.minSize ?? s2.size, lay.size * 0.94) };
            lay = withSub(layoutLyric(c, ly.line, s2));
          }
          y0 = top + (band - need(lay)) / 2 + lay.size;
        }
        c.save();
        c.translate(LYR.x, y0);
        drawLyric(c, ly.line, t, st, lay, ly.k * k);
        c.restore();
      }
    }
    c.restore();
  }

  /**
   * 掃光的中心（沿著卡片座標 x·0.8 + y·0.6 的斜線）：每個小節線的那一下大鼓，一道光由左上掃到右下。
   * 不是每個大鼓都掃：快歌一拍一個大鼓，光會還沒掃完就重來，看起來只是一直在閃。
   */
  private sheenAt(t: number): number {
    const au = this.ctx.audio, g = this.g;
    let tk = -Infinity;
    for (const b of g.bars) {
      if (b > t) break;
      const kk = au.events('kick', b - 0.1, b + 0.1);
      tk = kk.length ? Math.min(t, kk[0]![0]) : b;
    }
    const dur = clamp(g.bar * 0.45, 0.5, 0.9);
    const u = prog(t, tk, tk + dur, ease.outCubic);
    const d0 = -150, d1 = CW * 0.8 + CH * 0.6 + 150;
    return u >= 1 || !Number.isFinite(tk) ? -1e5 : lerp(d0, d1, u);
  }

  /** 燙金色（線性）：金色的暗部，掃光經過的地方亮起來。 */
  private foilRGB(x: number, y: number, sheen: number, out: RGB): RGB {
    const d = x * 0.8 + y * 0.6 - sheen, kk = Math.exp(-(d * d) / (2 * 80 * 80));
    for (let i = 0; i < 3; i++) {
      const base = lerp(LIN.blood[i]!, LIN.signal[i]!, 0.32);
      const hi = lerp(LIN.signal[i]!, LIN.ember[i]!, 0.55) * 1.05;
      out[i] = lerp(base, hi, kk);
    }
    return out;
  }

  /** Canvas 的燙金漸層（給「囍」）：同一道掃光。呼叫的地方已經 translate 到 (cx, cy)，漸層以 (0,0) 為中心。 */
  private foilGrad(c: CanvasRenderingContext2D, sheen: number, cx: number, cy: number, r: number): CanvasGradient {
    const ax = cx - r * 0.8, ay = cy - r * 0.6, bx = cx + r * 0.8, by = cy + r * 0.6;
    const gr = c.createLinearGradient(-r * 0.8, -r * 0.6, r * 0.8, r * 0.6);
    const base = mixRgba('blood', 'signal', 0.32), hi = mixRgba('signal', 'ember', 0.55);
    const d0 = ax * 0.8 + ay * 0.6, d1 = bx * 0.8 + by * 0.6;
    const h = (sheen - d0) / (d1 - d0);
    gr.addColorStop(0, base);
    if (h > -0.3 && h < 1.3) {
      const w = 0.22;
      if (h - w > 0 && h - w < 1) gr.addColorStop(h - w, base);
      if (h > 0 && h < 1) gr.addColorStop(h, hi);
      if (h + w > 0 && h + w < 1) gr.addColorStop(h + w, base);
    }
    gr.addColorStop(1, base);
    return gr;
  }

  /** 邊框與回紋：還沒描到的是淡淡的壓印線，描過的是燙金；火花在描的地方。 */
  private drawFoil(t: number, sheen: number, out: THREE.WebGLRenderTarget) {
    const lb = this.foil, gl = this.glow;
    const pr = (x: number, y: number) => this.proj(x, y);
    const seg = (ax: number, ay: number, bx: number, by: number, w: number, rgb: RGB, a: number) => {
      const A = pr(ax, ay), B = pr(bx, by);
      lb.seg2(A.x, A.y, B.x, B.y, w, rgb, a);
    };
    lb.clear(); gl.clear();
    const P = this.traceP(t);
    const faint: RGB = [LIN.sepia[0], LIN.sepia[1], LIN.sepia[2]];
    const col: RGB = [0, 0, 0];
    for (const sg of [...this.outer, ...this.inner]) {
      if (sg.p0 >= P) { seg(sg.a.x, sg.a.y, sg.b.x, sg.b.y, sg.w * 0.8, faint, 0.1); continue; }
      const u = clamp((P - sg.p0) / (sg.p1 - sg.p0));
      const bx = lerp(sg.a.x, sg.b.x, u), by = lerp(sg.a.y, sg.b.y, u);
      this.foilRGB((sg.a.x + bx) / 2, (sg.a.y + by) / 2, sheen, col);
      seg(sg.a.x, sg.a.y, bx, by, sg.w, col, 0.95);
      if (u < 1) seg(bx, by, sg.b.x, sg.b.y, sg.w * 0.8, faint, 0.1);
    }
    // 回紋：火花經過那個角之後 0.2 秒內長出來
    for (const fr of this.frets) {
      const tc = this.edgeT[fr.k - 1]! + this.edgeDur;
      const v = prog(t, tc - 0.02, tc + 0.22, ease.outCubic);
      const pts = fr.pts;
      let total = 0;
      for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
      let left = total * v;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!, b = pts[i]!, Lg = Math.hypot(b.x - a.x, b.y - a.y);
        if (v <= 0) { seg(a.x, a.y, b.x, b.y, 1.4, faint, 0.08); continue; }
        const u = clamp(left / Lg);
        left -= Lg;
        if (u > 0) {
          const ex = lerp(a.x, b.x, u), ey = lerp(a.y, b.y, u);
          this.foilRGB((a.x + ex) / 2, (a.y + ey) / 2, sheen, col);
          seg(a.x, a.y, ex, ey, 1.9, col, 0.95);
        }
        if (u < 1) seg(lerp(a.x, b.x, u), lerp(a.y, b.y, u), b.x, b.y, 1.4, faint, 0.08);
      }
    }
    lb.render(this.ctx.renderer, out);
    // 火花：描邊的時候在筆尖；描完那一刻在右上角閃一下就熄
    const tEnd = this.edgeT[3]! + this.edgeDur;
    const headAt = (tb: number): P2 | null => { if (tb < this.edgeT[0]! - 0.01 || tb > tEnd + 0.02) return null; const q = this.edgePoint(this.traceP(tb)); return pr(q.x, q.y); };
    if (t >= this.edgeT[0]! - 0.01 && t <= tEnd + 0.5) {
      sparkParticles(gl, t, headAt, { rate: 120, life: 0.42, speed: 240, seed: (this.ctx.params.seed ?? 1) + 5, intensity: 0.9 });
      const h = headAt(t);
      if (h) sparkHead(gl, h.x, h.y, t, 1.25, 1);
      else if (t > tEnd) { const q = this.edgePoint(4), p = pr(q.x, q.y); sparkHead(gl, p.x, p.y, t, 1 + 1.5 * pulse(t, tEnd, 0.08), clamp(1 - (t - tEnd) / 0.25)); }
    }
  }

  /**
   * 鏡頭：每個小節推近一點、在小節線上緩停；切進來時從高一點、遠一點的地方滑進來。
   * v2：拉遠一點（卡片在螢幕上約 870 寬），卡片放在畫面左邊，右邊是轉盤。回傳看的點（桌面座標）。
   */
  private camSet(cam: THREE.PerspectiveCamera, t: number): THREE.Vector3 {
    const s = this.ctx.start, e = this.ctx.end;
    const bars = this.g.bars.filter((b) => b > s + 0.05);
    const nb = Math.max(1, bars.length);
    let k = 0;
    for (let i = 0; i < bars.length; i++) {
      const b0 = i === 0 ? s : bars[i - 1]!, b1 = bars[i]!;
      k += prog(t, b0, b1, ease.inOutCubic);
    }
    k += prog(t, bars[bars.length - 1] ?? s, e, ease.inOutCubic) * 0.5;
    const u = k / (nb + 0.5);
    const enter = 1 - prog(t, s, s + Math.max(0.35, this.g.beat * 1.5), ease.outExpo);
    const dist = lerp(3750, 3450, u) + 450 * enter;
    const tilt = (lerp(31, 26, u) + 7 * enter) * (Math.PI / 180);
    const az = (lerp(4, -3, u) + 4 * enter) * (Math.PI / 180);
    // 看的點：留言的中心附近（卡片座標 → 桌面）
    const focusPt = new THREE.Vector3(760, 380, 0).applyMatrix4(this.M);
    focusPt.z = 0;
    const off = new THREE.Vector3(0, -dist * Math.sin(tilt), dist * Math.cos(tilt)).applyAxisAngle(new THREE.Vector3(0, 0, 1), az);
    cam.position.copy(focusPt).add(off);
    cam.up.set(-Math.sin(az), Math.cos(az), 0);
    cam.lookAt(focusPt);
    // 焦點（留言）放在畫面左邊：右邊是轉盤，右下角留給 QR
    cam.setViewOffset(W, H, W / 2 - 640, H / 2 - 560, W, H);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    return focusPt;
  }

  /** 卡片座標 → 畫面座標（任意鏡頭矩陣）。 */
  private projWith(PM: THREE.Matrix4, x: number, y: number): P2 {
    const e = PM.elements;
    const X = e[0]! * x + e[4]! * y + e[12]!, Y = e[1]! * x + e[5]! * y + e[13]!, Wc = e[3]! * x + e[7]! * y + e[15]!;
    return { x: (X / Wc * 0.5 + 0.5) * W, y: (0.5 - Y / Wc * 0.5) * H };
  }

  /** 卡片座標 → 畫面座標（這一格的鏡頭）。 */
  private proj(x: number, y: number): P2 {
    const e = this.PM.elements;
    const X = e[0]! * x + e[4]! * y + e[12]!, Y = e[1]! * x + e[5]! * y + e[13]!, Wc = e[3]! * x + e[7]! * y + e[15]!;
    return { x: (X / Wc * 0.5 + 0.5) * W, y: (0.5 - Y / Wc * 0.5) * H };
  }

  /** 描邊的進度：0..4（第 k 條邊描到哪）。 */
  private traceP(t: number): number {
    let P = 0;
    for (let k = 0; k < 4; k++) P += prog(t, this.edgeT[k]!, this.edgeT[k]! + this.edgeDur, ease.inOutCubic);
    return P;
  }

  /** 外框上參數 P（0..4）的位置（卡片座標）：右上 → 左上 → 左下 → 右下 → 右上。 */
  private edgePoint(P: number): P2 {
    const x0 = OUT_IN, x1 = CW - OUT_IN, y0 = OUT_IN, y1 = CH - OUT_IN;
    const cs: P2[] = [{ x: x1, y: y0 }, { x: x0, y: y0 }, { x: x0, y: y1 }, { x: x1, y: y1 }, { x: x1, y: y0 }];
    const k = clamp(Math.floor(P), 0, 3), u = clamp(P - k);
    return { x: lerp(cs[k]!.x, cs[k + 1]!.x, u), y: lerp(cs[k]!.y, cs[k + 1]!.y, u) };
  }
}
