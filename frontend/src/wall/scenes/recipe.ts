// 愛情食譜卡（亮）：廚房流理台的磁磚上一張手寫的索引卡，斜斜地放著（透視：遠端窄一點），窗戶的光斜斜地落在上面，
// 磁磚出焦、卡片清楚（淺景深）；鏡頭一個小節一段地慢慢推近留言，在小節線緩停。
// 照「MV 融合原則」只有一個焦點：
//  - 有留言：留言就是「★ 秘方」，卡片上最大、最清楚的手寫字（占卡片右邊一大塊），第三拍起一個字一個字寫出來、
//    一兩小節內寫完、署名「—— 名字 提供」。歌詞是卡片下緣的「作法」：「N. 正在唱的那句」，中等大小（≥ 50 px）跟唱。
//  - 沒有留言：歌詞搬到大字的位置（「作法」變成主角），下緣只剩一行很小的邀請。純音樂又沒有留言：大字寫邀請。
//  - 其他字都是配角（≤ 22 px、淡）：左上一小群（標題「愛情食譜」、份量、編號）、左欄一小群（材料一拍一項寫出來、打勾；
//    純音樂時下面接四個冷面的作法步驟，一個小節勾一步）。
//  - 招牌是污漬：每個小節線有一滴醬汁或咖啡從鏡頭前落下來（越落越小、影子往落點收），「啪」地在卡片（或磁磚）上暈開：
//    outExpo 長大、邊緣是深色的咖啡環、周圍濺出幾個小點、剛滴下的還有一點濕亮。落點多半在卡片邊緣（一半落在磁磚上），
//    而且是半透明的疊印，字一直讀得到；右上角還有一個本來就在的杯底印。
//  - 切進來時卡片從上面「啪」地拍到檯面上（越靠近鏡頭越大、影子越遠越糊），第一拍落定、畫面震一下。
// 畫法：卡片上的墨是兩張卡片大小的 Canvas2D（不會變的印一次、會變的每格畫），磁磚、紙、橫線、影子、窗光、污漬、景深
// 全部在一個全螢幕 shader 裡算：用單應矩陣把螢幕像素換回「卡片座標」取樣，所以透視、卡片落下、鏡頭推近都不用 3D。
// 污漬是解析函數（橢圓＋角度雜訊的邊、咖啡環、濺點），跟時間的關係只有「第幾秒落下」，換主題顏色跟著色票走。
// v2（留言尺寸標準）：卡片放在畫面左邊（螢幕上約 840×550），留言 40～60 px；右邊的檯面上是照著這張食譜在做的一碗麵糊（俯視）：
// 打蛋器一拍攪一下（outBack 停住）、麵糊的紋路跟著轉，每個小節線中間冒一圈漣漪；旁邊撒了一點麵粉。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, SCALE, H } from '../engine/gl';
import { F, font, loadText, layout, type TextLayout } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, lerp, prog, pulse, hash, mulberry32 } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import type { Line } from '../engine/lyrics';
import { layoutLyric, drawLyric, fillWithHearts, signature, lyricSubOf, subSizeFor, subGap, NAME_A, NAME_B, fitPx, type LyricStyle, type LyricLayout } from './_motifs';
import { grid, windowLines, stagger, paperLyric, FAST_TEX_GLSL, type Grid } from './_t2';
import { V2, msgMaxFor, lyricV2, sigV2, fitClauses } from './_v2';
import { homography, applyH } from './_t11';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'doc', paper: true, energy: [0.1, 0.8], bars: [4, 8] };

// ---------------------------------------------------------------- 卡片座標（透視之前）
const CW = 1180, CH = 780;
type P2 = { x: number; y: number };
/** 卡片靜止時四個角在螢幕上的位置（左上、右上、右下、左下）：遠端（上緣）窄一點、整張順時針歪一點。 */
// v2：原本的形狀縮成 0.71 倍、中心移到畫面左邊 (560, 520)
const QS = 0.71, QC = { x: 753, y: 524 }, QT = { x: 560, y: 520 };
const QUAD: P2[] = [{ x: 205, y: 128 }, { x: 1318, y: 150 }, { x: 1340, y: 918 }, { x: 148, y: 900 }]
  .map((p) => ({ x: QT.x + (p.x - QC.x) * QS, y: QT.y + (p.y - QC.y) * QS }));
/** 攪拌碗（畫面座標，鏡頭推近之前）：卡片右邊的檯面上。 */
const MUG = { x: 1450, y: 440, r: 205 };
const CARD_CORNERS: P2[] = [{ x: 0, y: 0 }, { x: CW, y: 0 }, { x: CW, y: CH }, { x: 0, y: CH }];
/** 紅線與淡橫線（索引卡）。 */
const RULE_Y = 84, ROW0 = 130, ROW_DY = 48;
/** 左上的小字（標題、份量、編號）。 */
const HEAD = { x: 48, base: 62 };
/** 左欄：材料（小字、淡）；純音樂時下面接四個作法步驟。 */
const ING = { x: 48, label: 124, base0: 172, dy: 48, size: 24 };
const STEPS = { label: 364, base0: 412 };
/** 大字的地方：有留言是秘方，沒留言是歌詞（或邀請）。 */
const BIG = { x: 340, y: 150, w: 790, h: 390, label: 124 };
/** 材料一項最寬多少（方框後面到大字區左緣，留一點空）：有一組材料是新人的名字，長的名字縮字。 */
const ING_W = BIG.x - ING.x - 28 - 14;
/** 下緣的「作法」：有留言時歌詞在這裡（中等大小）。右界收在 1100：鏡頭推近後也不會碰到右下角的 QR 區。 */
const BAND = { x: 48, label: 606, base: 678, maxX: 1100 };
/** 有留言又有原文的窗格：作法欄往上挪多少（大字區的下緣也收一樣多，署名不會碰到作法欄）。 */
const BAND_UP = 80;
const HAND = F.hand(400), HAND_B = F.hand(700);
const MAX_STAINS = 8;
/** 鏡頭整個窗格推近多少（一個小節一段，在小節線緩停）。 */
const PUSH = 0.065;

/** 材料清單（溫柔的玩笑），一窗格用一組；第一組的主角是這一場的新人（名字執行時才知道）。 */
const INGREDIENTS = [
  [`${NAME_A} 1 位`, `${NAME_B} 1 位`, '回憶 一整罐', '親友的祝福 一大把'],
  ['耐心 2 杯', '笑聲 1 大匙', '包容 適量', '擁抱 不限量'],
  ['默契 少許', '晚安 每天 1 句', '小驚喜 不定時', '親友的祝福 一大把'],
];
/** 新人的留言：新人請大家吃的那一份。 */
const COUPLE_ING = ['好菜 一整桌', '好歌 一整晚', '來賓 全體', '謝謝 說不完'];
/** 純音樂：作法沒有歌詞可寫，就是這四步，一個小節勾一步。 */
const INSTR_STEPS = ['1. 播放這首歌', '2. 小火慢燉', '3. 加入親友的祝福', '4. 攪拌到天荒地老'];
/** 有歌詞的歌、但這個窗格剛好在間奏：一樣四步，第一步換掉。 */
const BREAK_STEPS = ['1. 間奏中，先攪拌一下', '2. 小火慢燉', '3. 加入親友的祝福', '4. 等下一段歌詞'];
const META = '份量：一輩子　準備：好幾年　難度：★★★☆☆';
/** 沒有留言也沒有歌詞時的大字（自己斷行：自動斷行會把「下一道」拆開）；怎麼掃寫在旁邊的小字。 */
const INVITE_LINES = ['你的祝福，', '就是下一道秘方'];
const INVITE = INVITE_LINES.join('');
const INVITE_SMALL = '★ 秘方徵求中　掃描右下角 QR code，寫下你的祝福';
const INTRO = '（前奏中，先把材料備好）';

/**
 * 污漬的落點（卡片座標）：挑字比較少的地方——大多在卡片邊緣（一半落在磁磚上），少數在左欄的空處。
 * 前四個優先（洗牌時加權），窗格短的時候落下的都是邊緣那幾個。每個窗格用種子洗牌、再抖一點。
 */
const SPOTS: [number, number, number][] = [
  [1232, 300, 50], [-12, 470, 54], [600, 822, 52], [-95, 55, 62], [1212, 600, 50], [170, 490, 42], [320, 814, 46], [820, 34, 28],
];

// ---------------------------------------------------------------- shader：磁磚＋卡片＋窗光＋污漬＋景深
const FS = () => new FSPass(/* glsl */ `
uniform sampler2D stat; uniform sampler2D dyn;
uniform mat3 Hc; uniform mat3 Hb;
uniform float lift; uniform float t;
uniform vec4 stA[${MAX_STAINS}]; uniform vec4 stB[${MAX_STAINS}];
uniform vec4 cup;
uniform vec2 focus;
uniform vec3 mug;   // 攪拌碗（檯面座標）：中心 xy、半徑
uniform float stir; // 打蛋器的角度（一拍攪一下）
uniform float ripA; uniform float ripT; // 麵糊中間的漣漪：強度、經過的時間（小節線的大鼓）
${FAST_TEX_GLSL}
const vec2 CS = vec2(${CW}.0, ${CH}.0);

vec2 proj(mat3 m, vec2 s) { vec3 q = m * vec3(s, 1.0); return q.xy / q.z; }

// 污漬的穿透率（顏色 ÷ 紙色，Beer–Lambert）：kind 0 = 咖啡（偏墨色）、1 = 醬汁（偏訊號色的暗部）
vec3 stainT(float kind) {
  vec3 c = mix(mix(C_SEPIA, C_BLOOD, 0.22), mix(C_BLOOD, C_SEPIA, 0.3), kind);
  return clamp(c / max(C_PAPER, vec3(0.05)), 0.03, 1.0);
}

// 一個污漬在 p 的濃度與濕亮：A = (x, y, 半徑, 落下的時間)、B = (種子, 種類, 濃度, 有沒有)
vec2 stain(vec2 p, vec4 A, vec4 B) {
  float age = t - A.w;
  vec2 d = p - A.xy;
  if (length(d) > A.z * 2.3) return vec2(0.0);
  // 落下的瞬間很快攤開（outExpo），停住
  float grow = 1.0 - exp2(-age * 16.0);
  float r = A.z * (0.3 + 0.7 * grow);
  vec2 e = rot2(B.x * 6.2832) * d;
  e.x *= 0.84; // 滴下來有角度：稍微橢圓
  float ang = atan(e.y, e.x);
  float q = length(e) / r + 0.09 * snoise(vec2(cos(ang), sin(ang)) * 1.2 + B.x * 17.0) + 0.018 * snoise(d * 0.028 + B.x * 5.0);
  float w = 1.4 / r; // 邊緣反鋸齒（約 1.4 px）；不用 fwidth：這裡在分支裡
  float fill = 1.0 - smoothstep(1.0 - w, 1.0 + w, q);
  // 咖啡環：水往邊緣跑，顏色積在邊上（一圈細的深色邊＋裡面一道淡淡的水痕），中間淡而均勻
  float ring = pow(smoothstep(0.62, 1.0, q), 7.0);
  float tide = exp(-pow((q - 0.72 - 0.04 * snoise(vec2(ang * 1.5, B.x * 9.0))) * 22.0, 2.0));
  float dens = fill * (0.13 + 0.025 * snoise(d * 0.018 + B.x) + 0.75 * ring + 0.12 * tide);
  // 濺點：大多往同一邊噴（滴下來的角度），近的大、遠的小，拉成一點點水滴形
  float dir = B.x * 6.2832 + 2.2;
  for (int j = 0; j < 4; j++) {
    float fj = float(j);
    float a = dir + (hash12(vec2(B.x * 91.0, fj)) - 0.5) * 2.2;
    float h = hash12(vec2(fj, B.x * 37.0));
    float dist = A.z * (1.12 + 0.6 * h) * grow;
    float sr = A.z * (0.1 - 0.055 * h) * min(1.0, grow * 2.0);
    vec2 dv = vec2(cos(a), sin(a));
    vec2 o = p - A.xy - dv * dist;
    o = vec2(dot(o, dv) * 0.6, dot(o, vec2(-dv.y, dv.x)));
    dens += (1.0 - smoothstep(-1.0, 1.0, length(o) - sr)) * 0.7;
  }
  // 剛滴下的濕亮：光從左上來，亮在左上的邊
  float gl = fill * smoothstep(0.55, 0.95, q) * max(0.0, dot(normalize(e + 1e-4), vec2(-0.7, -0.7)));
  return vec2(dens * B.z, gl);
}

// 還在空中的那一滴：從鏡頭前落下（越近越大越糊），影子往落點收
void drop(vec2 p, vec4 A, vec4 B, inout vec3 col) {
  float age = t - A.w;
  if (age >= 0.0 || age < -0.24) return;
  float u = 1.0 + age / 0.24;
  float rr = A.z * 0.26;
  vec2 sp = A.xy + (1.0 - u) * vec2(50.0, 64.0);
  float s = length(p - sp) - rr;
  col *= 1.0 - 0.22 * u * (1.0 - smoothstep(-rr * 0.5, rr * (0.5 + 2.0 * (1.0 - u)), s));
  vec2 dp = A.xy + (1.0 - u) * vec2(-60.0, -110.0);
  float rd = rr * (1.0 + 3.2 * (1.0 - u) * (1.0 - u) + 0.6 * (1.0 - u));
  float soft = rd * 0.55 * (1.0 - u) + 1.0;
  float cov = 1.0 - smoothstep(-soft, soft, length(p - dp) - rd);
  vec3 dc = mix(C_SEPIA, C_BLOOD, 0.35 + 0.35 * B.y) * 0.55;
  float hl = 1.0 - smoothstep(0.0, rd * 0.4, length(p - dp + vec2(rd * 0.35)));
  col = mix(col, dc + C_BONE * 0.3 * hl, cov * (0.5 + 0.45 * u));
}

// 卡片上的墨：先印好的（stat）再疊會動的（dyn）
vec3 inked(vec3 paper, vec2 uv) {
  vec4 a = fastTex(stat, uv), b = fastTex(dyn, uv);
  paper = mix(paper, a.rgb, a.a);
  return mix(paper, b.rgb, b.a);
}

void main() {
  vec2 s = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  // 景深：焦點在卡片的中段（鏡頭推近的中心），往上（遠）往下（近）越來越糊
  float blur = max(0.0, abs(s.y - focus.y) - 340.0) * 0.024;
  vec2 pb = proj(Hb, s);

  // ---- 流理台：主題色的釉面磁磚（跟卡片的紙拉開色差）＋淡淡的灰縫；出焦的地方縫變軟、磁磚邊的隆起變平
  vec2 tf = mod(pb, 200.0);
  vec2 ti = floor(pb / 200.0);
  float edge = min(min(tf.x, 200.0 - tf.x), min(tf.y, 200.0 - tf.y));
  float tone = hash12(ti + 3.1);
  vec3 col = mix(C_PAPER, C_SIGNAL, 0.17 + 0.04 * tone) * (0.9 + 0.04 * tone);
  // 釉面在邊上圓圓地隆起：左上的邊亮、右下的邊暗
  float bev = 1.0 - smoothstep(3.0, 16.0 + blur * 2.0, edge);
  vec2 bd = (tf - 100.0) / 100.0;
  col *= 1.0 + bev * 0.05 * clamp(-(bd.x + bd.y), -1.0, 1.0);
  float grout = 1.0 - smoothstep(2.2, 3.6 + blur * 1.8, edge);
  col = mix(col, mix(C_PAPER, C_SEPIA, 0.2), grout * 0.8);

  // ---- 卡片的影子（抬起來時變大變淡）
  {
    vec2 so = vec2(9.0, 13.0) + lift * vec2(70.0, 100.0);
    float sdb = sdBox(pb - so - CS * 0.5, CS * 0.5);
    float soft = 12.0 + lift * 80.0;
    col *= 1.0 - (1.0 - smoothstep(-soft, soft, sdb)) * (0.28 - 0.12 * lift);
  }

  // ---- 卡片
  vec2 pc = proj(Hc, s);
  float sdc = sdBox(pc - CS * 0.5, CS * 0.5 - 8.0) - 8.0;
  float cw = max(fwidth(sdc), 0.5);
  float inCard = 1.0 - smoothstep(-cw, cw, sdc);
  if (inCard > 0.0) {
    vec3 paper = mix(C_PAPER, vec3(1.0), 0.2) * (0.978 + 0.018 * snoise(pc * 0.045) + 0.01 * snoise(pc * 0.42));
    // 上緣的紅線、淡淡的橫線（索引卡）
    paper = mix(paper, C_BLOOD, 0.7 * (1.0 - smoothstep(1.0, 2.0, abs(pc.y - ${RULE_Y}.0))));
    float row = abs(mod(pc.y - ${ROW0}.0 + ${ROW_DY / 2}.0, ${ROW_DY}.0) - ${ROW_DY / 2}.0);
    paper = mix(paper, mix(C_SEPIA, C_SIGNAL, 0.3), 0.1 * pxLine(row, 0.3, 1.1) * step(${ROW0 - 20}.0, pc.y));
    // 紙緣暗一點（有厚度）
    paper *= 1.0 - 0.07 * (1.0 - smoothstep(0.0, 5.0, -sdc));
    vec2 uv = vec2(pc.x / CS.x, 1.0 - pc.y / CS.y);
    vec3 card;
    if (blur > 0.4) {
      // 出焦的一小段（卡片最遠的上緣、最近的下緣）：四點平均
      vec2 o = vec2(blur * 0.6) / CS;
      card = 0.25 * (inked(paper, uv + vec2(o.x, o.y)) + inked(paper, uv + vec2(-o.x, o.y)) + inked(paper, uv + vec2(o.x, -o.y)) + inked(paper, uv - o));
    } else card = inked(paper, uv);
    col = mix(col, card, inCard);
  }

  // ---- 污漬（落定之後卡片座標 = 檯面座標，所以漬可以一半在卡上、一半在磁磚上）
  vec2 pp = inCard > 0.5 ? pc : pb;
  for (int i = 0; i < ${MAX_STAINS}; i++) {
    if (stB[i].w < 0.5) continue;
    float age = t - stA[i].w;
    if (age < 0.0) continue;
    vec2 dg = stain(pp, stA[i], stB[i]);
    col *= pow(stainT(stB[i].y), vec3(dg.x));
    col += C_BONE * 0.09 * dg.y * max(0.0, 1.0 - age / 1.6);
  }
  // 杯底印（本來就在的舊漬，只在卡片上）：一圈細細的環，有幾段斷掉
  {
    vec2 dc = pc - cup.xy;
    float L = length(dc) / cup.z;
    float ring = exp(-pow((L - 1.0) * 30.0, 2.0)) + 0.55 * exp(-pow((L - 0.93) * 44.0, 2.0));
    float gap = smoothstep(-0.35, 0.35, snoise(vec2(atan(dc.y, dc.x) * 1.7, 3.1)));
    col *= pow(stainT(0.0), vec3((ring * gap * 0.42 + 0.04 * step(L, 1.0)) * cup.w * inCard));
  }
  for (int i = 0; i < ${MAX_STAINS}; i++) if (stB[i].w > 0.5) drop(pp, stA[i], stB[i], col);

  // ---- 攪拌碗（俯視，檯面座標，跟著鏡頭推近）：影子、陶碗、碗緣、麵糊、打蛋器。打蛋器一拍攪一下，
  // 麵糊表面的紋路跟著轉；每個小節線那一下大鼓，麵糊中間冒一圈漣漪。旁邊撒了一點麵粉。
  {
    vec2 q = pb - mug.xy;
    float R = mug.z, r = length(q);
    // 檯面上撒的麵粉（碗的左下方，一小片不規則的白）
    vec2 fq = q - vec2(-R * 1.05, R * 0.95);
    float flour = smoothstep(0.35, 0.75, fbm(fq / 60.0, 3) + 0.55 - length(fq) / (R * 0.75));
    col = mix(col, mix(C_PAPER, C_BONE, 0.7), flour * 0.55);
    // 影子（光從左上：影子往右下）
    col *= 1.0 - 0.24 * (1.0 - smoothstep(R * 0.92, R * 1.3, length(q - vec2(R * 0.13, R * 0.17))));
    // 陶碗：外緣一圈釉（訊號色的暗部混紙色，跟主題走）、碗緣亮邊、內壁往下暗
    float body = 1.0 - smoothstep(R - 1.5, R + 1.5, r);
    vec3 glaze = mix(mix(C_BLOOD, C_SIGNAL, 0.35), C_PAPER, 0.45);
    vec3 mc = glaze * (0.95 + 0.07 * dot(normalize(q + 1e-4), vec2(-0.7, -0.7)));
    float lip = exp(-pow((r - R * 0.92) / (R * 0.03), 2.0));
    mc = mix(mc, mix(C_PAPER, C_BONE, 0.7), lip * 0.8);
    float inner = R * 0.86;
    mc = mix(mc, mc * 0.8, smoothstep(inner + 1.5, inner - 1.5, r) * smoothstep(inner * 0.55, inner, r));
    // 麵糊：奶油色，表面是打蛋器拉出來的弧形紋（跟著攪的角度轉），中間一圈漣漪（小節線的大鼓）
    float bat = smoothstep(inner * 0.9 + 1.2, inner * 0.9 - 1.2, r);
    float ang = atan(q.y, q.x);
    float fold = sin(ang * 3.0 + r / (R * 0.09) * 0.8 - stir * 1.3);
    float ripple = ripA * sin(r / (R * 0.05) - ripT * 22.0) * exp(-pow(r / (R * (0.2 + ripT * 1.4)) - 1.0, 2.0) * 3.0);
    // 麵糊的顏色：紙色帶一點墨色與訊號色（像加了蛋黃的奶油色），紋路要看得出來在轉
    vec3 bc = (mix(C_PAPER, C_SEPIA, 0.16) + C_SIGNAL * 0.06) * (0.9 + 0.1 * fold + 0.07 * ripple);
    bc = mix(bc, bc * 0.86, smoothstep(inner * 0.55, inner * 0.9, r));
    bc += C_BONE * 0.12 * exp(-dot(q - vec2(-R * 0.3, -R * 0.3), q - vec2(-R * 0.3, -R * 0.3)) / (R * R * 0.02));
    mc = mix(mc, bc, bat);
    col = mix(col, mc, body);
    // 打蛋器：握柄從碗中間斜斜伸出碗緣，頭是幾圈鋼絲（俯視是幾個細長的橢圓，繞著握柄轉）
    vec2 sd = vec2(cos(stir), sin(stir)), sn = vec2(-sd.y, sd.x);
    vec2 hc = mug.xy + sd * R * 0.05;
    vec2 a = mug.xy + sd * R * 0.42, b = mug.xy + sd * R * 1.5;
    float hsh = sdSegment(pb - vec2(10.0, 14.0), a, b) - 11.0;
    col *= 1.0 - 0.2 * (1.0 - smoothstep(-2.0, 12.0, hsh));
    float wires = 1e5;
    for (int k = 0; k < 4; k++) {
      float wa = stir * 2.0 + float(k) * 0.785;
      vec2 lq = pb - hc;
      vec2 lp = vec2(dot(lq, sd), dot(lq, sn));
      float squash = 0.18 + 0.3 * abs(sin(wa));
      float e = length(vec2((lp.x - R * 0.12) / (R * 0.42), lp.y / (R * 0.42 * squash))) - 1.0;
      wires = min(wires, abs(e) * R * 0.3 - 2.6);
    }
    vec3 steel = mix(C_GRAPHITE, C_BONE, 0.45);
    col *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 6.0, wires - 3.0)) * bat;
    col = mix(col, steel, (1.0 - smoothstep(-1.0, 1.0, wires)) * bat);
    float handle = sdSegment(pb, a, b) - 10.0;
    vec3 hcol = mix(C_ASH, C_BONE, 0.5 + 0.5 * sin(dot(pb - mug.xy, sn) * 0.25));
    col = mix(col, hcol, 1.0 - smoothstep(-1.2, 1.2, handle));
  }

  // ---- 窗光：左上方一扇四格窗透進來的一塊光（很柔，窗框的影子糊糊的），雲飄過時光慢慢呼吸；光外面暗一點
  {
    vec2 wq = rot2(-0.42) * (s - vec2(700.0 + 40.0 * sin(t * 0.07), 430.0 + 25.0 * cos(t * 0.05)));
    float win = (1.0 - smoothstep(620.0, 900.0, abs(wq.x))) * (1.0 - smoothstep(330.0, 560.0, abs(wq.y)));
    float bars = max(1.0 - smoothstep(14.0, 70.0, abs(wq.x - 40.0)), 1.0 - smoothstep(14.0, 70.0, abs(wq.y + 20.0)));
    float breathe = 0.1 + 0.02 * sin(t * 0.4);
    col *= 0.91 + breathe * win * (1.0 - 0.45 * bars);
  }
  fragColor = vec4(col, 1.0);
}`, {
  stat: { value: null }, dyn: { value: null },
  Hc: { value: new THREE.Matrix3() }, Hb: { value: new THREE.Matrix3() },
  lift: { value: 0 }, t: { value: 0 },
  stA: { value: Array.from({ length: MAX_STAINS }, () => new THREE.Vector4()) },
  stB: { value: Array.from({ length: MAX_STAINS }, () => new THREE.Vector4()) },
  cup: { value: new THREE.Vector4(CW - 96, 64, 92, 1) },
  focus: { value: new THREE.Vector2(740, 500) },
  mug: { value: new THREE.Vector3() }, stir: { value: 0 }, ripA: { value: 0 }, ripT: { value: 0 },
});

/**
 * 卡片大小的畫布，整晚共用兩組（一張 1180×780 的畫布不便宜，每個窗格新建太浪費；兩組輪流，前後兩個窗格不會搶同一組）：
 * stat = 印一次的（小字、欄名），dyn = 每格畫的（寫出來的字、勾勾、歌詞），full = 全部寫完的樣子（不上傳，
 * 每格從它裁出「已經寫到哪裡」貼進 dyn，比每格重排字便宜）。
 */
let layerTurn = 0;
const LAYERS = () => ({
  stat: new Layer2D(CW, CH, SCALE, { fast: true }),
  dyn: new Layer2D(CW, CH, SCALE, { fast: true }),
  full: new Layer2D(CW, CH, SCALE),
});

interface Written { lay: TextLayout; x: number; base: number; times: number[] }
interface Stain { x: number; y: number; r: number; t0: number; seed: number; kind: number }
/** 歌詞放哪裡：big = 大字的位置（沒有留言時），band = 下緣的作法（有留言時）。 */
interface Slot { x: number; base: number; lh: number; st: LyricStyle }

/**
 * fitText，但行數少一點比較好讀：少一行只小一點點（85% 以內）就用少的那個
 * （「新婚快樂！！！」一行寫完，不要拆成「新婚／快樂！！！」）。
 */
function fitFew(c: CanvasRenderingContext2D, text: string, fam: string, w: number, h: number, o: { min: number; max: number; lineHeight: number; maxLines: number }): FitResult {
  const best = fitText(c, text, fam, w, h, o);
  for (let k = 1; k < best.lines.length; k++) {
    const f = fitText(c, text, fam, w, h, { ...o, maxLines: k });
    if (f.lines.length <= k && f.size >= best.size * 0.85) return f;
  }
  return best;
}

function setH(m: THREE.Matrix3, src: P2[]) {
  const h = homography(src, CARD_CORNERS);
  m.set(h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, h[8]!);
}

export default class Recipe extends Scene {
  fs = shared('recipe.fs', FS);
  // 兩組輪流用：下一個窗格是在這個窗格播放時預先建好的，萬一（極少）也是食譜卡，不能畫到正在播的這一組上
  L = shared('recipe.layers', () => [LAYERS(), LAYERS()])[layerTurn++ % 2]!;
  msg: Msg | null = this.ctx.params.message ?? null;
  g!: Grid;
  tLand = 0;
  items: string[] = [];
  itemT: number[] = [];
  itemSize = ING.size;
  /** 大字：留言，或（沒有留言也沒有歌詞時）邀請。沒有就是 null（大字的位置給歌詞）。 */
  big: FitResult | null = null;
  written: Written[] = [];
  bigEnd = 0;
  sig = '';
  sigPos = { x: 0, base: 0 };
  lines: Line[] = [];
  slot: Slot | null = null;
  /** 作法欄往上挪多少（有留言又有原文的窗格：中文＋原文兩段要在卡片下緣、咖啡漬上面）。 */
  bandUp = 0;
  steps = INSTR_STEPS;
  stepT: number[] = [];
  stepTick: number[] = [];
  stains: Stain[] = [];
  seed = 1;
  /** 鏡頭推近的分段（窗格開頭、每個小節線、窗格結尾）與推近的中心（螢幕座標）。 */
  camCuts: number[] = [];
  focus: P2 = { x: 740, y: 480 };
  /** 卡片座標 → 螢幕 px 的縮放（鏡頭推到一半時）：v2 的字級是螢幕 px。 */
  k = QS;
  sigSize = 44;
  mugB: P2 = { x: 0, y: 0 };
  mugR = 200;

  override async init() {
    const { audio: au, lyrics, start: s, end: e } = this.ctx;
    this.seed = this.ctx.params.seed ?? 1;
    const g = this.g = grid(au, s, e);
    const m = this.msg;
    this.lines = windowLines(lyrics, s, e, 0.35, 0.8);
    // 雙語：有留言時歌詞在卡片下緣的作法欄，原文接在下面會掉出卡片、被咖啡漬蓋住：作法欄整段往上 BAND_UP
    if (m && this.lines.some((l) => lyricSubOf(l))) this.bandUp = BAND_UP;
    this.items = m?.couple ? COUPLE_ING : INGREDIENTS[Math.floor(hash(this.seed, 5) * INGREDIENTS.length)]!;
    // 大字寫什麼：留言；沒有留言但有歌詞 → 大字給歌詞；兩個都沒有 → 大字寫邀請
    const bigText = m ? m.text : this.lines.length ? '' : INVITE;
    this.sig = m ? `${signature(m.name)} ${m.couple ? '敬上' : '提供'}` : '';
    await loadText(`愛情食譜材料作法秘方主廚的話新人徵求中請勿外傳提供敬上一位賓客間奏純音樂${META}${INVITE}${INVITE_SMALL}${INTRO}${INGREDIENTS.flat().join('')}${COUPLE_ING.join('')}${INSTR_STEPS.join('')}${BREAK_STEPS.join('')}${bigText}${this.sig}${this.ctx.song.title}${this.lines.map((l) => l.text).join('')}０１２３４５６７８９`);

    // ---- 時間表：第一拍卡片落定；材料一拍一項；大字從第三拍開始寫，一兩小節內寫完
    this.tLand = g.b0;
    this.itemT = stagger(au, this.tLand, this.items.length, g.beat * 3.2);
    const L = this.L;
    const fc = L.full.ctx;
    L.full.clear();
    fc.textBaseline = 'alphabetic';
    // 材料（配角：小、淡）：方框＋字
    this.items.forEach((it, i) => {
      const y = ING.base0 + i * ING.dy;
      this.handBox(fc, ING.x, y - 16, 16, 11 + i);
      fc.font = font(HAND, fitPx(it, HAND, ING.size, ING_W)); fc.fillStyle = rgba('sepia', 0.6);
      fc.fillText(it, ING.x + 28, y);
    });
    // 大字（F.hand 700，另一個人的筆跡），愛心用點綴色；整塊（含署名）在大字區裡垂直置中
    // v2：留言 40～60、署名 26～32（螢幕 px），除以縮放換成卡片座標
    const kz = this.k = QS * (1 + PUSH * 0.5);
    this.sigSize = sigV2(m ? msgMaxFor(m.text) : 44) / kz;
    if (bigText) {
      const sigH = this.sig ? this.sigSize * 1.9 : 0;
      // 沒有歌詞的窗格下緣是空的：大字區往下延伸，整塊置中在卡片上
      const bh = this.lines.length ? BIG.h - this.bandUp * 0.75 : BAND.base - BIG.y;
      const opt = { min: V2.msgMin / kz, max: (m ? msgMaxFor(bigText) : 52) / kz, lineHeight: 1.2, maxLines: 6 };
      const fit = this.big = m ? (fitClauses(fc, bigText, HAND_B, BIG.w, bh - sigH, opt) ?? fitFew(fc, bigText, HAND_B, BIG.w, bh - sigH, opt)) : this.inviteFit(fc);
      const top = BIG.y + (bh - fit.height - sigH) / 2 + fit.size * 0.88;
      const n = fit.lines.reduce((a, l) => a + Array.from(l).length, 0);
      const t0 = au.timeOfBeat(Math.round(au.beatAt(this.tLand)) + 2);
      const times = stagger(au, t0, n, clamp(0.085 * n + 0.5, 0.8, 3.2));
      let k = 0;
      fc.font = font(HAND_B, fit.size); fc.fillStyle = rgba('sepia', 0.97);
      this.written = fit.lines.map((ln, i) => {
        const lay = layout(ln, HAND_B, fit.size);
        const base = top + i * fit.lineHeight;
        fillWithHearts(fc, ln, BIG.x, base);
        return { lay, x: BIG.x, base, times: lay.glyphs.map(() => times[k++] ?? t0) };
      });
      this.bigEnd = (times[times.length - 1] ?? t0) + Math.min(0.12, g.beat * 0.4);
      if (this.sig) {
        // 署名靠右、貼著留言的右緣（短留言時不會離得很遠）
        fc.font = font(HAND, this.sigSize);
        const sw = fc.measureText(this.sig).width;
        this.sigPos = { x: BIG.x + Math.max(fit.width, sw), base: top + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.3 + this.sigSize * 1.3 };
        fc.fillStyle = rgba('sepia', 0.8); fc.textAlign = 'right';
        fc.fillText(this.sig, this.sigPos.x, this.sigPos.base);
        fc.textAlign = 'left';
      }
    }
    // 歌詞放哪裡：有大字 → 下緣的作法（中等）；沒有大字 → 大字的位置（主角）
    if (this.lines.length) {
      const numW = (size: number) => { fc.font = font(HAND_B, size); return fc.measureText('8. ').width; };
      // v2：有留言時比留言小一級（lyricV2），沒有留言時 52；螢幕 px 換成卡片座標
      const lmin = V2.lyrMin / kz;
      if (this.big) {
        // 配角的歌詞用比留言細的筆（400）：一眼看過去留言是焦點
        const ls = lyricV2(m ? this.big.size * kz : null) / kz;
        // 有原文：用到卡片右緣（中文少折一排，兩段才放得進作法欄）
        const maxX = this.bandUp ? CW - 56 : BAND.maxX;
        this.slot = { x: BAND.x, base: BAND.base - this.bandUp, lh: 1.1, st: { family: HAND, size: ls, minSize: lmin, maxWidth: maxX - BAND.x - numW(ls), align: 'left', lineHeight: 1.1, ...paperLyric() } };
      } else {
        const ls = V2.lyrMax / kz;
        this.slot = { x: BIG.x, base: 0, lh: 1.12, st: { family: HAND_B, size: ls, minSize: lmin, maxWidth: BIG.w - numW(ls), align: 'left', lineHeight: 1.12, ...paperLyric() } };
      }
    }

    // ---- 純音樂（或間奏）：左欄下面四步，一拍寫一步，之後一個小節勾一步
    if (!this.lines.length) {
      this.steps = lyrics.has ? BREAK_STEPS : INSTR_STEPS;
      this.stepT = stagger(au, this.tLand + g.beat, this.steps.length, g.beat * 3.2);
      const bars = g.bars.filter((b) => b > this.stepT[0]! + g.beat * 0.9);
      this.stepTick = this.steps.map((_, i) => bars[i] ?? this.stepT[i]! + g.beat * (2 + i));
    }

    // ---- 污漬：從第一個離落定夠遠的小節線起，每個小節線一滴，最多六滴；窗格很長就隔一個小節
    let drops = g.bars.filter((b) => b >= this.tLand + g.beat * 0.6 && b <= e - 0.15);
    if (drops.length > 6) drops = drops.filter((_, i) => i % 2 === 0).slice(0, 6);
    if (!drops.length && this.tLand + g.beat * 2 < e - 0.1) drops = [this.tLand + g.beat * 2];
    const rnd = mulberry32(this.seed * 7 + 3);
    // 有原文的作法欄貼近卡片下緣：下緣那兩個點（y > CH）不滴，免得污漬蓋到原文
    const order = SPOTS.filter(([, y]) => !this.bandUp || y < CH).map((sp, i) => ({ sp, k: rnd() + (i < 4 ? 0 : 0.35) })).sort((a, b) => a.k - b.k);
    this.stains = drops.map((t0, i) => {
      const [x, y, r] = order[i % order.length]!.sp;
      // 抖一點（邊緣的點只沿著邊抖，不要往字的方向跑）
      const edge = x < 20 || x > CW - 20 || y > CH - 10, jx = (rnd() - 0.5) * (x < 20 || x > CW - 20 ? 10 : 40), jy = (rnd() - 0.5) * (edge ? (y > CH - 10 ? 8 : 60) : 16);
      return { x: x + jx, y: y + jy, r: r * (0.85 + 0.3 * rnd()), t0, seed: rnd(), kind: rnd() < 0.5 ? 0 : 1 };
    });

    // ---- 鏡頭：推近的中心是焦點（大字區的中心），每個小節一段
    const fwd = homography(CARD_CORNERS, QUAD);
    this.focus = applyH(fwd, BIG.x + BIG.w / 2 - 40, BIG.y + BIG.h / 2 + 40);
    // 攪拌碗：畫面座標換成檯面座標（跟卡片同一套：卡片座標往外延伸）
    const inv = homography(QUAD, CARD_CORNERS);
    this.mugB = applyH(inv, MUG.x, MUG.y);
    this.mugR = MUG.r / QS;
    this.camCuts = [s, ...g.bars.filter((b) => b > s + 0.3 && b < e - 0.3), e];

    this.drawStatic();
    L.stat.upload();
    this.ctx.renderer.initTexture(L.stat.texture);
  }

  /** 邀請的大字：照 INVITE_LINES 斷行，字級取放得下的最大（最多 104）。 */
  private inviteFit(c: CanvasRenderingContext2D): FitResult {
    c.font = font(HAND_B, 100);
    const w100 = Math.max(...INVITE_LINES.map((l) => c.measureText(l).width));
    const size = Math.floor(Math.min(V2.lyrMax / this.k, (100 * BIG.w) / w100));
    c.font = font(HAND_B, size);
    const width = Math.max(...INVITE_LINES.map((l) => c.measureText(l).width));
    return { size, lines: INVITE_LINES, lineHeight: size * 1.2, width, height: size * (1 + 1.2 * (INVITE_LINES.length - 1)) };
  }

  /** 手畫的方框（抖一點）。 */
  private handBox(c: CanvasRenderingContext2D, x: number, y: number, s: number, seed: number) {
    const j = (k: number) => (hash(seed, k) - 0.5) * 2;
    c.strokeStyle = rgba('sepia', 0.5); c.lineWidth = 1.6; c.lineJoin = 'round'; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x + j(1), y + j(2)); c.lineTo(x + s + j(3), y + j(4)); c.lineTo(x + s + j(5), y + s + j(6)); c.lineTo(x + j(7), y + s + j(8)); c.closePath();
    c.stroke();
  }

  /** 小字的欄名：中文（手寫 bold）＋英文 mono，都小、都淡。 */
  private label(c: CanvasRenderingContext2D, zh: string, en: string, x: number, y: number, color = rgba('sepia', 0.55)) {
    c.font = font(HAND_B, 20); c.fillStyle = color;
    c.fillText(zh, x, y);
    const w = c.measureText(zh).width;
    if (!en) return;
    c.font = font(F.mono(500), 11); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.35);
    c.fillText(en, x + w + 12, y - 1);
    c.letterSpacing = '0px';
  }

  /** 印一次的：左上的小字、欄名（全部 ≤ 22 px、淡）。 */
  private drawStatic() {
    const c = this.L.stat.ctx, m = this.msg;
    this.L.stat.clear();
    c.textBaseline = 'alphabetic'; c.textAlign = 'left';
    // 左上一小群：標題（紅筆）、份量、編號
    c.font = font(HAND_B, 22); c.fillStyle = rgba('blood', 0.8);
    c.fillText('愛情食譜', HEAD.x, HEAD.base);
    const tw = c.measureText('愛情食譜').width;
    c.font = font(HAND, 16); c.fillStyle = rgba('sepia', 0.45);
    c.fillText(META, HEAD.x + tw + 22, HEAD.base);
    const mw = c.measureText(META).width;
    c.font = font(F.mono(500), 11); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.35);
    c.fillText(`No.${String(m ? m.n : this.ctx.song.index).padStart(3, '0')}`, HEAD.x + tw + 22 + mw + 22, HEAD.base - 1);
    c.letterSpacing = '0px';
    // 欄名
    this.label(c, '材料', 'INGREDIENTS', ING.x, ING.label);
    if (!this.lines.length) this.label(c, '作法', 'METHOD', ING.x, STEPS.label);
    const bigLabel = !m ? (this.big ? '★ 秘方徵求中：掃描右下角 QR code' : '作法') : m.couple ? '★ 主廚的話（新人）' : '★ 秘方';
    this.label(c, bigLabel, !m && !this.big ? 'METHOD' : m?.couple ? 'FROM THE CHEFS' : 'SECRET', BIG.x, BIG.label, rgba('blood', 0.72));
    // 下緣那一行：有留言又有歌詞是「作法」；沒有留言（歌詞在大字）是一行小小的邀請；沒有歌詞是歌名
    if (m && this.lines.length) this.label(c, '作法', 'METHOD', BAND.x, BAND.label - this.bandUp);
    else if (!m && this.lines.length) { c.font = font(HAND, 20); c.fillStyle = rgba('sepia', 0.5); c.fillText(INVITE_SMALL, BAND.x, BAND.base - 20); }
    else {
      const title = Array.from(this.ctx.song.title || '').slice(0, 18).join('');
      c.font = font(HAND, 18); c.fillStyle = rgba('sepia', 0.45);
      c.fillText(`♪ ${title}${this.ctx.lyrics.has ? '（間奏）' : '（純音樂）'}`, BAND.x, BAND.base - 20);
    }
  }

  /** 鏡頭推近的量（0..1）：一個小節一段，每段 inOutCubic——小節中間推、在小節線緩停。 */
  private push(t: number): number {
    const cuts = this.camCuts, n = cuts.length - 1;
    if (n <= 0) return 0;
    for (let i = 0; i < n; i++) if (t < cuts[i + 1]!) return (i + ease.inOutCubic(clamp((t - cuts[i]!) / (cuts[i + 1]! - cuts[i]!)))) / n;
    return 1;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const L = this.L;

    // ---- 卡片落下：從鏡頭前（大、歪、影子遠）加速落到檯面上，第一拍落定
    const fall = this.tLand > s + 0.05 ? prog(t, s, this.tLand, ease.inQuad) : 1;
    const lift = 1 - fall;
    const land = pulse(t, this.tLand, 0.07);
    const sc = 1 + 0.075 * lift - 0.006 * land, rot = 0.035 * lift;
    const cx = QUAD.reduce((a, p) => a + p.x, 0) / 4, cy = QUAD.reduce((a, p) => a + p.y, 0) / 4;
    const anim = QUAD.map((p) => {
      const dx = (p.x - cx) * sc, dy = (p.y - cy) * sc;
      return { x: cx + dx * Math.cos(rot) - dy * Math.sin(rot) - 30 * lift, y: cy + dx * Math.sin(rot) + dy * Math.cos(rot) - 44 * lift };
    });
    // ---- 鏡頭：以焦點為中心慢慢推近，同時往左上帶一點（整個檯面一起動）
    const P = this.push(t), z = 1 + PUSH * P, F0 = this.focus;
    const cam = (p: P2): P2 => ({ x: F0.x + (p.x - F0.x) * z - 14 * P, y: F0.y + (p.y - F0.y) * z - 8 * P });
    const u = this.fs.u;
    setH(u.Hc!.value as THREE.Matrix3, anim.map(cam));
    setH(u.Hb!.value as THREE.Matrix3, QUAD.map(cam));
    (u.focus!.value as THREE.Vector2).set(F0.x, F0.y);
    u.lift!.value = lift;
    u.t!.value = t;
    u.stat!.value = L.stat.texture;
    const A = u.stA!.value as THREE.Vector4[], B = u.stB!.value as THREE.Vector4[];
    for (let i = 0; i < MAX_STAINS; i++) {
      const st = this.stains[i];
      if (st) { A[i]!.set(st.x, st.y, st.r, st.t0); B[i]!.set(st.seed, st.kind, 1, 1); } else B[i]!.set(0, 0, 0, 0);
    }
    (u.cup!.value as THREE.Vector4).set(CW - 96, 64, 92, 0.9 + 0.2 * hash(this.seed, 9));
    (u.mug!.value as THREE.Vector3).set(this.mugB.x, this.mugB.y, this.mugR);
    // 打蛋器：一拍攪四分之一圈（outBack 停住）；卡片落下之前不動
    const au = this.ctx.audio;
    const bi = Math.floor(au.beatAt(t) + 1e-6), b0 = Math.round(au.beatAt(this.tLand));
    const ph = clamp((t - au.timeOfBeat(bi)) / Math.min(0.32, this.g.beat * 0.6));
    const turns = t < this.tLand ? 0 : bi - b0 + ease.outBack(ph, 1.6);
    u.stir!.value = -0.6 + turns * (Math.PI / 2);
    // 漣漪：最近的一個小節線起算（2 秒內淡掉）
    const lb = [...this.g.bars].reverse().find((b) => b <= t && b >= this.tLand);
    u.ripA!.value = lb === undefined ? 0 : Math.max(0, 1 - (t - lb) / 1.6);
    u.ripT!.value = lb === undefined ? 0 : t - lb;

    // ---- 會動的墨
    L.dyn.clear();
    const c = L.dyn.ctx;
    c.textBaseline = 'alphabetic';
    this.drawTitleStroke(c, t);
    this.drawItems(c, t);
    this.drawBig(c, t);
    if (this.slot) this.drawLyricSlot(c, t, this.slot);
    else this.drawSteps(c, t);
    u.dyn!.value = L.dyn.upload();
    this.fs.render(renderer, out);

    // 滴下來的那一刻、卡片落定的那一刻：畫面震一下
    let shx = 0, shy = land * 5;
    for (const st of this.stains) {
      const p = pulse(t, st.t0, 0.06);
      shx += (st.seed - 0.5) * 7 * p; shy += 4 * p;
    }
    return { paper: 1, bloom: 0.18, bloomThreshold: 0.98, halation: 0.05, vignette: 0.34, grain: 0.05, shake: [shx, shy] };
  }

  /** 標題底下的紅筆：落定那一拍刷一道。 */
  private drawTitleStroke(c: CanvasRenderingContext2D, t: number) {
    const v = prog(t, this.tLand, this.tLand + 0.2, ease.outCubic);
    if (v <= 0) return;
    c.save();
    c.strokeStyle = rgba('blood', 0.6); c.lineWidth = 2.4; c.lineCap = 'round';
    c.beginPath();
    const x0 = HEAD.x - 2, x1 = HEAD.x + 94;
    c.moveTo(x0, HEAD.base + 7);
    c.quadraticCurveTo(lerp(x0, x1, v * 0.5), HEAD.base + 10, lerp(x0, x1, v), HEAD.base + 6 - 2 * v);
    c.stroke();
    c.restore();
  }

  /** 從「全部寫完」的畫布裁一塊貼過來（寫到哪裡貼到哪裡）。 */
  private reveal(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    if (w <= 0.5 || h <= 0) return;
    const S = SCALE;
    c.drawImage(this.L.full.canvas, x * S, y * S, w * S, h * S, x, y, w, h);
  }

  /** 打勾（v：0..1 畫到哪裡）。 */
  private tick(c: CanvasRenderingContext2D, x: number, y: number, s: number, v: number) {
    if (v <= 0) return;
    const a = { x: x + s * 0.12, y: y + s * 0.5 }, m = { x: x + s * 0.42, y: y + s * 0.85 }, b = { x: x + s * 1.05, y: y - s * 0.25 };
    c.save();
    c.strokeStyle = rgba('blood', 0.7); c.lineWidth = 2.6; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(a.x, a.y);
    if (v < 0.35) c.lineTo(lerp(a.x, m.x, v / 0.35), lerp(a.y, m.y, v / 0.35));
    else { c.lineTo(m.x, m.y); c.lineTo(lerp(m.x, b.x, (v - 0.35) / 0.65), lerp(m.y, b.y, (v - 0.35) / 0.65)); }
    c.stroke();
    c.restore();
  }

  /** 材料：一拍一項由左往右寫出來，方框接著打勾。 */
  private drawItems(c: CanvasRenderingContext2D, t: number) {
    const dur = Math.min(0.3, this.g.beat * 0.7);
    this.items.forEach((it, i) => {
      const t0 = this.itemT[i]!;
      if (t < t0) return;
      c.font = font(HAND, fitPx(it, HAND, ING.size, ING_W));
      const y = ING.base0 + i * ING.dy;
      const w = 28 + c.measureText(it).width + 8;
      const v = prog(t, t0, t0 + dur, ease.outCubic);
      this.reveal(c, ING.x - 4, y - 26, w * v + 4, 36);
      this.tick(c, ING.x, y - 16, 16, prog(t, t0 + dur * 0.6, t0 + dur * 0.6 + 0.16, ease.outCubic));
    });
  }

  /** 大字：一個字一個字寫出來（逐字掃過去），寫完署名。 */
  private drawBig(c: CanvasRenderingContext2D, t: number) {
    const fit = this.big;
    if (!fit) return;
    for (const w of this.written) {
      const gl = w.lay.glyphs;
      let vis = 0;
      for (let i = 0; i < gl.length; i++) {
        const a = w.times[i]!;
        if (t < a) break;
        const next = w.times[i + 1] ?? a + 0.12;
        const r = clamp((t - a) / Math.max(0.05, Math.min(0.14, next - a)));
        vis = gl[i]!.x + gl[i]!.w * r;
      }
      if (vis > 0) this.reveal(c, w.x - 8, w.base - fit.size * 1.02, vis + 10, fit.size * 1.36);
    }
    if (this.sig && t >= this.bigEnd) {
      const v = prog(t, this.bigEnd, this.bigEnd + 0.45, ease.outCubic);
      c.font = font(HAND, this.sigSize);
      const w = c.measureText(this.sig).width;
      this.reveal(c, this.sigPos.x - w - 6, this.sigPos.base - this.sigSize * 1.12, (w + 12) * v, this.sigSize * 1.5);
    }
  }

  /** 作法（歌詞）：這一句跟唱，下一句開始前 0.35 秒換——上一句往上淡出、這一句淡入。 */
  private drawLyricSlot(c: CanvasRenderingContext2D, t: number, slot: Slot) {
    const lines = this.lines;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) if (lines[i]!.start - 0.35 <= t) idx = i;
    if (idx < 0) {
      // 前奏：還沒有步驟可寫（小字，不搶）
      c.font = font(HAND, 22); c.fillStyle = rgba('sepia', 0.4);
      c.fillText(INTRO, slot.x, slot === this.slot && this.big ? slot.base : BIG.y + BIG.h / 2);
      return;
    }
    const T = lines[idx]!.start - 0.35;
    // 先讓上一句往上退掉（0.14 秒），這一句再從下面浮上來：大字疊在一起會糊成一團
    const out = prog(t, T, T + 0.14, ease.inCubic), inn = prog(t, T + 0.08, T + 0.32, ease.outCubic);
    if (idx >= 1 && out < 1) this.drawStep(c, lines[idx - 1]!, idx, t, slot, -34 * out, 1 - out);
    this.drawStep(c, lines[idx]!, idx + 1, t, slot, 18 * (1 - inn), inn);
  }

  /**
   * 原文副行（韓文歌）的排版（卡片 px）：卡片在畫面上縮了 k 倍，drawLyric 自動畫的原文（照卡片 px 算 32～56）
   * 在畫面上會小到看不清楚，所以照「畫面上」的主行字級算原文字級，再換回卡片。dy = 原文第一排基線離中文第一排基線多遠。
   */
  private subLay(c: CanvasRenderingContext2D, line: Line, st: LyricStyle, lay: LyricLayout) {
    const sub = lyricSubOf(line);
    if (!sub) return null;
    // 雙語：原文至少 36 螢幕 px（卡片斜放在檯面上會壓扁一點）、不再縮，太長就折行
    const k = this.k, ss = Math.max(36, subSizeFor(lay.size * k)) / k;
    const sl = layoutLyric(c, sub, { ...st, size: ss, minSize: ss, tracking: (st.tracking ?? 0) * 0.5 });
    const dy = lay.rows[lay.rows.length - 1]!.y + subGap(lay.size * k, sl.size * k) / k;
    return { sub, sl, dy, height: dy + sl.rows[sl.rows.length - 1]!.y + lay.size };
  }

  /** 畫一步「N. 歌詞」（dy：往上下挪的量，alpha：透明度）。大字的位置依行數垂直置中。 */
  private drawStep(c: CanvasRenderingContext2D, line: Line, n: number, t: number, slot: Slot, dy: number, alpha: number) {
    if (alpha <= 0.01) return;
    let st = slot.st, lay = layoutLyric(c, line, st);
    let d = this.subLay(c, line, st, lay);
    // 作法欄（有留言）：中文＋原文的底（原文字腳）要在卡片下緣 30 以上，放不下就把中文縮小一點（不小於 40 螢幕 px）
    if (this.big && d) {
      const minSize = st.minSize ?? st.size;
      for (let sz = st.size; slot.base + d.height - lay.size + d.sl.size * 0.25 > CH - 30 && sz > minSize;) {
        sz = Math.max(minSize, sz * 0.95);
        st = { ...st, size: sz };
        lay = layoutLyric(c, line, st);
        d = this.subLay(c, line, st, lay)!;
      }
    }
    const base = this.big ? slot.base : BIG.y + (BIG.h - (d ? d.height : lay.height)) / 2 + lay.size * 0.86;
    c.save();
    c.translate(slot.x, base + dy);
    c.globalAlpha = alpha;
    c.font = font(st.family, lay.size); c.fillStyle = rgba('sepia', 0.55);
    const num = `${n}.`;
    c.fillText(num, 0, 0);
    c.translate(c.measureText(num).width + lay.size * 0.22, 0);
    drawLyric(c, line, t, st, d ? ({ ...lay, sub: undefined } as LyricLayout) : lay, alpha);
    if (d) {
      // 原文：同一支筆寫在中文下面、小一號；比中文安靜（唱到、唱完都是「唱完」的墨色再淡兩成）
      c.translate(0, d.dy);
      const q = rgba('sepia', 0.95 * 0.8);
      drawLyric(c, d.sub, t, { ...st, active: q, sung: q }, d.sl, alpha);
    }
    c.restore();
  }

  /** 純音樂（或間奏）：左欄四步（小、淡），一拍寫一步，一個小節勾一步。 */
  private drawSteps(c: CanvasRenderingContext2D, t: number) {
    c.font = font(HAND, 19);
    this.steps.forEach((txt, i) => {
      const t0 = this.stepT[i]!;
      if (t < t0) return;
      const y = STEPS.base0 + i * ING.dy;
      const v = prog(t, t0, t0 + 0.28, ease.outCubic);
      const w = c.measureText(txt).width;
      c.save();
      c.beginPath(); c.rect(ING.x - 4, y - 26, (w + 8) * v, 36); c.clip();
      c.fillStyle = rgba('sepia', 0.6);
      c.fillText(txt, ING.x, y);
      c.restore();
      const tk = this.stepTick[i]!;
      this.tick(c, ING.x + w + 10, y - 15, 15, prog(t, tk, tk + 0.16, ease.outCubic));
    });
  }
}
