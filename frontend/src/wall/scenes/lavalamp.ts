// 熔岩燈（暗）：暗暗的房間裡一盞熔岩燈，旁邊的桌上立著一張手寫的卡片。
//  - 燈：金屬的底座與燈帽、中間是鼓鼓的玻璃瓶，裡面的蠟塊（metaball）慢慢浮上、沉下，跟著低音膨脹一點，
//    大鼓一打整瓶輕輕一跳；每個小節線，瓶底的蠟池冒起一顆新的蠟往上浮。
//  - 歌詞是蠟聚成的字：一句快要唱的時候，瓶子中間的蠟慢慢聚攏成字（從一團糊糊的蠟收成清楚的字形），
//    還沒唱的字是暗紅的蠟，唱到的那一刻燒成訊號色（會發光），唱完變成淡淡的奶白色；唱完一句字又化開。
//    浮過字的蠟塊會淡到字的後面，字才讀得清楚。
//  - 主打留言寫在燈右邊牆上的一張小卡片上（畫面的焦點，比燈裡的字大）：切進來時燈還沒全亮，第一拍「喀」一聲燈亮起來，
//    暖暖的光照亮卡片（靠燈的那邊亮、遠的那邊暗），字一個一個寫出來；卡片用一段紙膠帶貼在牆上。署名在最後一行下面。
//    留言標準 v2：卡片 760×380（字 40～60），燈是主視覺；燈的光穿過蠟塊，在旁邊的牆上投出放大、慢慢往上漂的蠟影。
//  - 沒有留言：燈放大在畫面中間，蠟的字就是主角；桌上一行小字邀請。純音樂：蠟裡浮出新人的名字。
// 手法：牆、桌、燈（底座、玻璃、液體、蠟、蠟字、反光）、卡片的打光與陰影全在一個 shader。
// 蠟字與卡片上的字都是 init() 畫好的資料貼圖（_t25 glyphMask：覆蓋率、第幾個字、字裡的掃描順序），
// 蠟字「聚攏」是在 shader 裡用不同半徑取樣覆蓋率（糊→清楚）再跟蠟塊的場加在一起取門檻；卡片紙張是 init 畫一次的 Canvas2D。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, hash, pulse, lerp } from '../engine/util';
import { type Line } from '../engine/lyrics';
import { lyricAt, lyricSubOf, subGap, subSizeFor, COUPLE_ZH } from './_motifs';
import { V2, lyricV2 } from './_v2';
import {
  T25_TEXT, T25_INVITE, sigOf, winBars, winBeats, stagger, layMsgV2, glyphMask, glyphStates, MASK_GLSL,
  type GlyphMask, type MsgLay, type Rect, type MaskGlyph,
} from './_t25';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'journey', paper: false, energy: [0, 0.7], bars: [4, 8] };

/** 一句歌詞最多幾個字（韓文歌連原文副行一起算，所以留寬一點）。 */
const MAXG = 128;
/** 原文副行的字在字模裡的標記（R 通道）：shader 認得出來、用比較安靜的顏色。 */
const SUB_TAG = 100;
const NB = 10;
/**
 * 卡片（有留言）：中心、大小、角度；字的範圍（卡片座標，左上為 0）。
 * 留言標準 v2：卡片 760×380 貼在畫面右邊的牆上（燈在左邊，是主視覺），下緣離 HUD 很遠。
 */
const CARD = { cx: 1310, cy: 490, w: 760, h: 380, ang: -0.022 };
const CARD_TXT = { x: 52, y: 44, w: 656, h: 266 };
const FAM_MSG = F.hand(700);
// 蠟字比較小（40～52）：900 的黑體筆畫會黏成一團，用 700
const FAM_LYR = F.archivo(75, 700);
const FOOT = '＊本燈每一小節冒一顆泡泡，請勿搖晃。';
/** 卡片上的字模範圍（卡片的外框再大一點）。 */
const MM_RECT: Rect = [CARD.cx - CARD.w / 2 - 30, CARD.cy - CARD.h / 2 - 30, CARD.w + 60, CARD.h + 60];

/** 燈的輪廓（燈座高 230、玻璃高 520、燈帽高 100，乘上 k）：玻璃在高度 h（0 = 瓶底、1 = 瓶口）的半寬。 */
const glassW = (h: number) => 92 - 20 * h + 82 * Math.sin(Math.PI * Math.min(h * 1.25, 1));
interface Lamp { cx: number; yb: number; k: number }
const LAMP_MSG: Lamp = { cx: 560, yb: 985, k: 1.12 };
const LAMP_SOLO: Lamp = { cx: 960, yb: 956, k: 1.2 };

const BG = () => new FSPass(/* glsl */ `
  uniform float t; uniform vec3 lamp; uniform float power;
  uniform vec4 blobs[${NB}];
  uniform sampler2D tm; uniform vec4 tr; uniform float lineK; uniform vec2 gs[${MAXG}]; uniform float tOn;
  uniform sampler2D card; uniform float cardOn; uniform vec4 cardR; uniform float cardA;
  uniform sampler2D mm; uniform float shown; uniform float hasMsg;
  ${MASK_GLSL}
  const vec4 MMR = vec4(${MM_RECT.join('.0, ')}.0);
  float glassW(float h) { return 92.0 - 20.0 * h + 82.0 * sin(3.14159 * min(h * 1.25, 1.0)); }
  // 蠟塊的場（越靠近越大，>1 是蠟；靠近的兩顆會黏在一起）
  float blobField(vec2 p, float band) {
    float s = 0.0;
    for (int i = 0; i < ${NB}; i++) {
      vec4 b = blobs[i];
      // 有邊界的核（(1 - d²/R²)³，R = 2.2r）：不像倒平方那樣尾巴很長，十顆加起來才不會整瓶都是蠟；d = r 時剛好 = 1
      vec2 d = p - b.xy;
      float R2 = b.z * b.z * 4.84;
      float q = max(0.0, 1.0 - dot(d, d) / max(R2, 1.0));
      s += q * q * q * 2.0 * (1.0 - 0.45 * band * b.w);
    }
    return s;
  }
  // 蠟字：以 r 為半徑取樣覆蓋率（五點平均）＝字「聚攏」的程度
  float textAt(vec2 p, float r) {
    float a = maskAt(tm, tr, p).a * 2.0;
    a += maskAt(tm, tr, p + vec2(r, r)).a + maskAt(tm, tr, p + vec2(-r, r)).a + maskAt(tm, tr, p + vec2(r, -r)).a + maskAt(tm, tr, p + vec2(-r, -r)).a;
    return a / 6.0;
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float k = lamp.z, cx = lamp.x, yb = lamp.y;
    float yg0 = yb - 230.0 * k, yg1 = yg0 - 520.0 * k;
    vec2 lc = vec2(cx, yg0 - 230.0 * k); // 燈光的中心（玻璃中段）
    vec3 warm = mix(C_BLOOD, C_SIGNAL, 0.55);
    // ---- 牆：燈照在牆上的一大團暖光
    float dl = length((p - lc) / vec2(1.0, 1.25));
    vec3 col = C_INK * 0.7 + C_INK2 * 0.25 * (0.9 + 0.1 * fbm(p / 260.0, 2));
    // 燈泡的光穿過蠟塊，在牆上投出放大的蠟影（跟著蠟塊慢慢往上漂；只在燈附近，照不到卡片）
    vec2 bulb = vec2(cx, yg0);
    float wsh = smoothstep(0.35, 1.2, blobField(bulb + (p - bulb) / 2.7, 0.0)) * (1.0 - smoothstep(-40.0, 20.0, p.y - yg0));
    col += warm * power * (0.18 * exp(-dl / (460.0 * k)) + 0.05 * exp(-dl / (1100.0 * k))) * (1.0 - 0.62 * wsh);
    // ---- 桌面
    if (p.y > yb - 4.0) {
      float z = p.y - yb;
      col = C_INK2 * 0.55 + warm * 0.07 * power * exp(-abs(p.x - cx) / (360.0 * k)) * exp(-z / 160.0);
      col += C_BONE * 0.03 * (1.0 - smoothstep(0.0, 3.0, abs(z - 1.0)));
      // 燈在桌面上的倒影（很淡、往下糊掉）
      float rw = glassW(0.2) * k;
      col += warm * 0.05 * power * (1.0 - smoothstep(rw * 0.6, rw * 1.2, abs(p.x - cx))) * exp(-z / 70.0);
    }
    // ---- 卡片的影子（光從燈那邊來，影子往右下）
    vec2 cq = rot2(-cardR.w) * (p - cardR.xy - vec2(34.0, 22.0));
    float csd = sdBox(cq, vec2(${CARD.w / 2}.0, ${CARD.h / 2}.0));
    col *= 1.0 - 0.55 * hasMsg * (1.0 - smoothstep(-20.0, 60.0, csd));

    // ---- 燈座（金屬錐）與燈帽
    float dx = p.x - cx;
    if (p.y > yg0 && p.y < yb) {
      float h = (yb - p.y) / (230.0 * k);
      float wb = (96.0 + 69.0 * pow(1.0 - h, 1.5)) * k;
      if (abs(dx) < wb) {
        float u = dx / wb;
        float band = 0.5 + 0.5 * cos(u * 2.6 + 0.5);
        vec3 mc = C_INK2 * (0.5 + 0.9 * band) + C_ASH * 0.12 * pow(band, 8.0);
        mc += warm * 0.25 * power * smoothstep(0.75, 1.0, h) * (1.0 - abs(u));
        mc *= 1.0 - 0.5 * smoothstep(0.85, 1.0, abs(u));
        col = mc;
      }
    }
    if (p.y < yg1 && p.y > yg1 - 100.0 * k) {
      float h = (yg1 - p.y) / (100.0 * k);
      float wc = mix(78.0, 44.0, h) * k;
      if (abs(dx) < wc) {
        float u = dx / wc;
        float band = 0.5 + 0.5 * cos(u * 2.6 + 0.5);
        col = C_INK2 * (0.45 + 0.8 * band) + C_ASH * 0.1 * pow(band, 8.0) + warm * 0.2 * power * (1.0 - smoothstep(0.0, 0.3, h));
      }
    }
    // ---- 玻璃瓶
    if (p.y >= yg1 && p.y <= yg0) {
      float h = (yg0 - p.y) / (520.0 * k);
      float wg = glassW(h) * k;
      if (abs(dx) < wg) {
        float u = dx / wg;
        // 液體：瓶底的燈泡往上照，下面亮上面暗；邊緣暗（玻璃的厚度）
        vec3 liq = (C_BLOOD * 0.2 + C_SIGNAL * 0.06) * (0.45 + 0.9 * (1.0 - h)) * power;
        // 蠟：蠟塊＋瓶底的蠟池＋瓶口一點點
        float band = 1.0 - smoothstep(0.0, 70.0, max(tr.y - p.y, p.y - tr.y - tr.w));
        band *= lineK;
        float P = blobField(p, band);
        P += 1.6 * exp(-(yg0 - p.y) / (26.0 * k)) * (1.0 + 0.25 * sin(p.x * 0.03 + t * 0.7));
        P += 0.5 * exp(-(p.y - yg1) / (12.0 * k));
        // 蠟字：聚攏的程度（半徑從糊到清楚）
        float r = mix(18.0, 1.2, lineK);
        // （字變小了：門檻放在覆蓋率五成左右，筆畫才不會加粗到黏在一起）
        float T = textAt(p, r) * 1.85 * smoothstep(0.0, 0.5, lineK);
        // 蠟塊與蠟字分開取門檻：字永遠在上面（蠟塊浮過去不會把字吃掉），靠近的時候彼此黏過去一點（融合）
        float Ptot = P + T * 0.5;
        float wax = smoothstep(0.92, 1.08, Ptot);
        float Tw = T + min(P, 2.0) * 0.2;
        float waxT = smoothstep(0.92, 1.08, Tw);
        // 光：用場的梯度當法向量（蠟是半透明的一團，邊緣暗、朝下的一面被燈泡照亮）
        vec2 g = vec2(dFdx(Ptot), dFdy(Ptot)) / max(fwidth(Ptot), 1e-3);
        float rim = 1.0 - smoothstep(1.0, 2.2, Ptot);
        vec3 waxC = mix(C_BLOOD, C_SIGNAL, 0.42) * (0.55 + 0.5 * (1.0 - h)) * power;
        waxC *= 1.0 - 0.35 * rim;
        waxC += C_EMBER * 0.12 * power * max(0.0, -normalize(g + 1e-4).y) * rim;
        // 浮過字那一段的蠟塊暗一點（在字的後面），字才讀得清楚
        waxC *= 1.0 - 0.55 * band;
        vec3 gc = mix(liq, waxC, wax);
        // 字的外圍一圈暗邊（字跟後面的蠟分得開）
        gc *= 1.0 - 0.6 * smoothstep(0.3, 0.8, T) * (1.0 - waxT) * smoothstep(0.0, 0.5, lineK);
        // 字：依每個字的狀態上色（還沒唱：暗紅的蠟；唱到：燒成訊號色；唱完：奶白）
        vec4 m = maskAt(tm, tr, p);
        if (waxT > 0.0) {
          int gi = min(int(m.g * 255.0 + 0.5), ${MAXG - 1});
          vec2 gsv = gs[gi];
          float on = smoothstep(m.b - 0.05, m.b + 0.05, gsv.x);
          vec3 unsung = C_BLOOD * 0.55 + C_SIGNAL * 0.08;
          vec3 lit = gsv.y > 0.5 ? mix(C_BONE, C_EMBER, 0.2) * 0.82 : C_SIGNAL * 1.6 + C_EMBER * 0.3;
          // 原文副行（韓文歌）：比中文安靜，唱到、唱完都是淡兩成的奶白，不燒成訊號色
          if (m.r > 0.3 && m.r < 0.5) lit = mix(C_BONE, C_EMBER, 0.2) * 0.66;
          vec3 tc = mix(unsung, lit, on);
          if (m.r > 0.9) tc = mix(C_ROSE * 0.35, C_ROSE * 0.9, on);
          float trim = 1.0 - smoothstep(1.0, 1.8, Tw);
          gc = mix(gc, tc * (1.0 - 0.25 * trim), waxT);
        }
        // 玻璃：左邊一道直的反光、右邊一道細的；邊緣暗
        gc += C_BONE * 0.05 * exp(-pow((u + 0.62) / 0.08, 2.0)) + C_BONE * 0.025 * exp(-pow((u - 0.72) / 0.04, 2.0));
        gc *= 1.0 - 0.5 * smoothstep(0.8, 1.0, abs(u));
        col = gc;
      }
    }

    // ---- 卡片：紙（init 畫好的圖層）＋燈照過來的光＋寫上去的字
    if (cardOn > 0.5) {
      vec4 cp = fastLayer(texture(card, vec2(p.x / ${W}.0, 1.0 - p.y / ${H}.0)));
      if (cp.a > 0.0) {
        // 光：離燈越近越亮（左邊暖、右邊暗一點），不要暗到字讀不清
        float dd = length(p - lc);
        // （卡片在右邊、離燈遠一點：光衰減放緩，最遠的角也讀得清楚）
        float L = (0.2 + 0.72 * power * exp(-max(0.0, dd - 420.0) / 950.0)) * cardA;
        // 卡片的四角暗一點（紙有一點點彎）
        vec2 cl = rot2(-cardR.w) * (p - cardR.xy) / vec2(${CARD.w / 2}.0, ${CARD.h / 2}.0);
        L *= 1.0 - 0.12 * dot(cl, cl) * 0.5;
        // 燈光是暖的：紙靠燈那邊染一點訊號色
        vec3 lit = cp.rgb * L * 0.9 + warm * 0.1 * L * cp.a;
        // 字（依序寫出來）：剛寫的墨還濕（帶一點訊號色的暗部），很快乾成紙上的墨色
        vec4 mk = maskAt(mm, MMR, p);
        float gi = floor(mk.g * 255.0 + 0.5);
        float rv = clamp((shown - gi - mk.b) * 5.0, 0.0, 1.0);
        float wet = clamp(1.0 - (shown - gi) / 6.0, 0.0, 1.0);
        vec3 ink = mix(C_SEPIA, C_BLOOD * 0.8, wet * 0.6) * L;
        if (mk.r > 0.9) ink = C_ROSE * 0.85 * L;
        lit = mix(lit, ink * cp.a, mk.a * rv * cp.a);
        col = col * (1.0 - cp.a) + lit;
      }
    }
    fragColor = vec4(col, 1.0);
  }`, {
  t: { value: 0 }, lamp: { value: new THREE.Vector3(960, 900, 1) }, power: { value: 1 },
  blobs: { value: Array.from({ length: NB }, () => new THREE.Vector4()) },
  tm: { value: null }, tr: { value: new THREE.Vector4(0, 0, 1, 1) }, lineK: { value: 0 }, gs: { value: Array.from({ length: MAXG }, () => new THREE.Vector2()) }, tOn: { value: 0 },
  card: { value: null }, cardOn: { value: 0 }, cardR: { value: new THREE.Vector4() }, cardA: { value: 1 },
  mm: { value: null }, shown: { value: 0 }, hasMsg: { value: 0 },
});

// 量字寬用的小畫布
let mc: CanvasRenderingContext2D | null = null;
const measure = (s: string, fam: string, size: number) => { mc ??= document.createElement('canvas').getContext('2d')!; mc.font = font(fam, size); return mc.measureText(s).width; };

/** 一行歌詞（或一段字）在瓶子裡排成幾排：詞不拆開，每排置中；放不下就縮字級（最小 40，留言標準 v2 的歌詞下限）。 */
function waxRows(units: { ch: string; gap: number }[][], fam: string, size0: number, cx: number, cy: number, maxW: number, maxRows = 4, balance = false): { items: MaskGlyph[]; rect: Rect } {
  let size = size0;
  let rows: typeof units[] = [];
  // 沒有空白隔開的詞併成一段（中文歌詞一個字一個詞，不併的話會斷在「一句一句話」的中間）；一段放不下一排才拆成一個一個字
  const phrases: typeof units = [];
  let curP: typeof units[number] = [];
  for (const u of units) { curP.push(...u); if (u.at(-1)!.gap > 0.1) { phrases.push(curP); curP = []; } }
  if (curP.length) phrases.push(curP);
  const wrap = (limit: number) => {
    const out: typeof units[] = [];
    let cur: typeof units = [], w = 0;
    const pieces = phrases.flatMap((ph) => (ph.reduce((s, x) => s + measure(x.ch, fam, size), 0) <= maxW ? [ph] : ph.map((x) => [x])));
    for (const u of pieces) {
      const uw = u.reduce((s, x) => s + measure(x.ch, fam, size), 0);
      const gap = cur.length ? (cur[cur.length - 1]!.at(-1)!.gap * size) : 0;
      if (cur.length && w + gap + uw > limit) { out.push(cur); cur = [u]; w = uw; } else { cur.push(u); w += gap + uw; }
    }
    if (cur.length) out.push(cur);
    return out;
  };
  for (let tries = 0; tries < 8; tries++) {
    rows = wrap(maxW);
    if (rows.length <= maxRows || size <= V2.lyrMin) break;
    size = Math.max(V2.lyrMin, size * 0.9);
  }
  // balance（雙語 2026-09-30）：排數不變、每排盡量一樣長——不要最後一排只剩一個字（「我們兩個人的／歌」）。
  // 找「還是這麼多排」的最窄寬度（二分），用那個寬度重排
  if (balance && rows.length > 1) {
    const n = rows.length;
    let lo = maxW * 0.3, hi = maxW;
    for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (wrap(mid).length <= n) hi = mid; else lo = mid; }
    rows = wrap(hi);
  }
  const lh = size * 1.1;
  const items: MaskGlyph[] = [];
  const top = cy - ((rows.length - 1) * lh) / 2 + size * 0.36;
  let idx = 0;
  rows.forEach((row, r) => {
    const flat = row.flatMap((u, i) => u.map((x, j) => ({ ...x, last: j === u.length - 1 && i < row.length - 1 })));
    const rw = flat.reduce((s, x) => s + measure(x.ch, fam, size) + (x.last ? x.gap * size : 0), 0);
    let x = cx - rw / 2;
    for (const g of flat) {
      const w = measure(g.ch, fam, size);
      if (g.ch.trim()) items.push({ ch: g.ch, x, y: top + r * lh, w, size, family: fam, idx: idx++ });
      x += w + (g.last ? g.gap * size : 0);
    }
  });
  const h = (rows.length - 1) * lh + size * 1.3;
  return { items, rect: [cx - maxW / 2 - 40, cy - h / 2 - 40, maxW + 80, h + 80] };
}

/**
 * 韓文歌：中文照原本排（最多四排，留位置給原文），原文小一號排在下面（同樣每排置中），兩段一起在瓶子中間垂直置中。
 * 原文的字接在中文後面編號、標上 SUB_TAG。
 */
function withSub(main: { ch: string; gap: number }[][], sub: { ch: string; gap: number }[][], size0: number, cx: number, cy: number, maxW: number): { items: MaskGlyph[]; rect: Rect } {
  const a = waxRows(main, FAM_LYR, size0, cx, cy, maxW, 4, true);
  const size = a.items[0]?.size ?? size0, lhA = size * 1.1;
  const ss = subSizeFor(size);
  const b = waxRows(sub, FAM_LYR, ss, cx, cy, maxW, 3, true);
  const lhB = (b.items[0]?.size ?? ss) * 1.1;
  const rowsOf = (it: MaskGlyph[]) => new Set(it.map((g) => g.y)).size;
  const nA = rowsOf(a.items), nB = rowsOf(b.items);
  const gap = subGap(size, ss);
  // 中文第一排的中線到原文最後一排的中線
  const span = (nA - 1) * lhA + size * 0.36 + gap - ss * 0.36 + (nB - 1) * lhB;
  const top = cy - span / 2;
  const dyA = top - (cy - ((nA - 1) * lhA) / 2);
  const dyB = top + (nA - 1) * lhA + size * 0.36 + gap - ss * 0.36 - (cy - ((nB - 1) * lhB) / 2);
  const items = [
    ...a.items.map((g) => ({ ...g, y: g.y + dyA })),
    ...b.items.map((g, i) => ({ ...g, y: g.y + dyB, idx: a.items.length + i, tag: SUB_TAG })),
  ];
  const y0 = Math.min(a.rect[1] + dyA, b.rect[1] + dyB), y1 = Math.max(a.rect[1] + a.rect[3] + dyA, b.rect[1] + b.rect[3] + dyB);
  return { items, rect: [a.rect[0], y0, a.rect[2], y1 - y0] };
}

function lineUnits(line: Line): { ch: string; gap: number }[][] {
  return line.words.map((w, i) => {
    const chars = Array.from(w.w).filter((ch) => ch.trim());
    const next = line.words[i + 1];
    const spaced = next ? /\s/.test(line.text.slice(w.o + w.w.length, next.o)) : false;
    return chars.map((ch, j) => ({ ch, gap: j === chars.length - 1 && spaced ? 0.28 : 0.03 }));
  });
}

interface Blob { u: number; T: number; ph: number; r: number; lo: number; hi: number }

export default class LavaLamp extends Scene {
  bg = shared('lavalamp.bg', BG);
  card = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 131 + (this.msg?.id ?? 0) * 7919) >>> 0;
  lamp: Lamp = this.msg ? LAMP_MSG : LAMP_SOLO;
  /** 每句一張字模；n = 中文佔幾個字（原文副行的字接在後面編號）。 */
  masks = new Map<Line, { m: GlyphMask; rect: Rect; n: number }>();
  names: { m: GlyphMask; rect: Rect } | null = null;
  mm: GlyphMask | null = null;
  lay: MsgLay | null = null;
  times: number[] = [];
  bars: number[] = [];
  blobs: Blob[] = [];
  tOn = 0;
  lyrSize = 52;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const lines = lyrics.linesIn(s - 1, e + 0.5);
    const subs = lines.map((l) => lyricSubOf(l));
    await loadText(`${T25_TEXT}${FOOT}${m?.text ?? ''}${m ? sigOf(m) : ''}${lines.map((l) => l.text).join('')}${song.title}`);
    const bar = au.timeOfBar(au.barAt(s) + 1) - au.timeOfBar(au.barAt(s));
    this.bars = winBars(au, s - bar * 2, e);
    this.tOn = winBeats(au, s + 0.12, e)[0] ?? s + 0.2;
    const L = this.lamp, k = L.k;
    const yg0 = L.yb - 230 * k, glassH = 520 * k;
    // 字放在瓶子最鼓的那一段
    const cy = yg0 - glassH * 0.42;
    const maxW = (glassW(0.42) * 2 - 70) * k;

    // ---- 蠟字：每句一張字模
    const c = document.createElement('canvas').getContext('2d')!;
    let msgSize: number | null = null;
    if (m) {
      // 卡片上的留言（卡片座標 → 畫面座標：繞卡片中心轉 ang）
      const lay = layMsgV2(c, m.text, sigOf(m), FAM_MSG, { ...CARD_TXT, x: 0, y: 0 }, { lineHeight: 1.3, maxLines: 5, align: 'left' });
      this.lay = lay;
      msgSize = lay.screen;
      const ca = Math.cos(CARD.ang), sa = Math.sin(CARD.ang);
      const toScr = (x: number, y: number) => {
        const lx = CARD_TXT.x + x - CARD.w / 2, ly = CARD_TXT.y + y - CARD.h / 2;
        return { x: CARD.cx + lx * ca - ly * sa, y: CARD.cy + lx * sa + ly * ca };
      };
      const items: MaskGlyph[] = this.lay.glyphs.map((g, i) => {
        const q = toScr(g.x, g.y);
        return { ch: g.ch, x: q.x, y: q.y, w: g.w, size: g.size, family: g.row < 0 ? this.lay!.sig.family : FAM_MSG, rot: CARD.ang, idx: i };
      });
      this.mm = this.track(glyphMask(items, MM_RECT, 1, 2));
      const maxDur = Math.max(0.8, Math.min(1.7 * bar, 0.45 * (e - this.tOn)));
      this.times = stagger(au, this.tOn + au.beatPeriod(s) * 0.5, items.length, maxDur);
    }
    this.lyrSize = lyricV2(msgSize);
    for (const [li, ln] of lines.entries()) {
      const sub = subs[li];
      const { items, rect } = sub ? withSub(lineUnits(ln), lineUnits(sub), this.lyrSize, L.cx, cy, maxW) : waxRows(lineUnits(ln), FAM_LYR, this.lyrSize, L.cx, cy, maxW, 5);
      this.masks.set(ln, { m: this.track(glyphMask(items.slice(0, MAXG), rect, 1, 2)), rect, n: sub ? items.filter((g) => g.tag !== SUB_TAG).length : MAXG });
    }
    if (!lyrics.linesIn(s, e).length) {
      // 純音樂：蠟裡浮出新人的名字
      const units = Array.from(COUPLE_ZH.replace(/\s*&\s*/, '&')).map((ch) => [{ ch, gap: 0.04 }]);
      const { items, rect } = waxRows(units, FAM_LYR, m ? lyricV2(msgSize) : V2.lyrMax, L.cx, cy, maxW, 3);
      this.names = { m: this.track(glyphMask(items, rect, 1, 2)), rect };
    }

    // ---- 卡片（紙、紙膠帶、註腳）或桌上的邀請
    const cc = this.card.ctx;
    this.card.clear();
    if (m) {
      cc.save();
      cc.translate(CARD.cx, CARD.cy); cc.rotate(CARD.ang);
      const x0 = -CARD.w / 2, y0 = -CARD.h / 2;
      cc.fillStyle = rgba('paper');
      cc.fillRect(x0, y0, CARD.w, CARD.h);
      // 紙的纖維（很淡的斑點）
      for (let i = 0; i < 900; i++) {
        const rx = hash(this.seed, i, 1), ry = hash(this.seed, i, 2);
        cc.fillStyle = rgba('sepia', 0.025 + 0.03 * hash(i, 3));
        cc.fillRect(x0 + rx * CARD.w, y0 + ry * CARD.h, 1 + 2 * hash(i, 4), 1);
      }
      // 註腳
      cc.font = font(F.hei(500), 18); cc.letterSpacing = '2px'; cc.fillStyle = rgba('sepia', 0.5);
      cc.fillText(FOOT, x0 + CARD_TXT.x, y0 + CARD.h - 24);
      cc.letterSpacing = '0px';
      // 紙膠帶：上緣中間一段，貼在牆上（半透明、兩端鋸齒）
      cc.fillStyle = rgba('bone', 0.5);
      cc.beginPath();
      const tw = 150, th = 40, tx = -tw / 2 + 24, ty = y0 - th * 0.55;
      cc.moveTo(tx, ty);
      for (let i = 0; i <= 6; i++) cc.lineTo(tx + tw + (i % 2 ? 5 : 0), ty + (th * i) / 6);
      for (let i = 6; i >= 0; i--) cc.lineTo(tx + (i % 2 ? 5 : 0), ty + (th * i) / 6);
      cc.closePath();
      cc.fill();
      cc.restore();
    } else {
      // 邀請寫在牆上、桌緣上面一點（寫在桌緣上會被燈光的明暗吃掉，讀不清楚）
      cc.font = font(F.hei(500), 20); cc.letterSpacing = '3px'; cc.fillStyle = rgba('ash', 0.85);
      cc.fillText(T25_INVITE, 262, LAMP_SOLO.yb - 40);
      cc.letterSpacing = '0px';
    }
    this.card.upload();

    // ---- 蠟塊：各自慢慢上下（週期不同），半徑不同
    for (let i = 0; i < 7; i++) {
      // 各自的高度範圍與週期不同，才不會一起到頂、一起到底
      const r = hash(this.seed, i, 7);
      this.blobs.push({ u: (hash(this.seed, i, 1) - 0.5) * 1.0, T: 9 + 9 * hash(this.seed, i, 2), ph: hash(this.seed, i, 3), r: 30 + 26 * r, lo: 0.1, hi: 0.76 });
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio: au, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const u = this.bg.u;
    const L = this.lamp, k = L.k;
    u.t!.value = t;
    (u.lamp!.value as THREE.Vector3).set(L.cx, L.yb, k);
    // 燈：切進來時是半亮的（還在熱），第一拍「喀」一聲全亮（閃一下）
    const on = t < this.tOn - 0.1 ? 0.35 : t < this.tOn - 0.05 ? 0.8 : t < this.tOn ? 0.4 : 1;
    const power = on * (0.94 + 0.06 * f.a.low) * (1 - 0.4 * ease.inCubic(prog(t, e - 0.3, e)));
    u.power!.value = power;
    u.tOn!.value = this.tOn;

    // ---- 蠟塊的位置
    const yg0 = L.yb - 230 * k, glassH = 520 * k;
    const bv = u.blobs!.value as THREE.Vector4[];
    const kick = f.a.kick;
    let n = 0;
    for (const b of this.blobs) {
      // 上下：餘弦（在頂端、底端停久一點），大鼓一打往上跳一點
      const ph = (t / b.T + b.ph) % 1;
      // 三角波（兩端不停太久）再稍微圓一點
      const tri = 1 - Math.abs(2 * ph - 1);
      const v = lerp(b.lo, b.hi, tri * tri * (3 - 2 * tri) * 0.6 + tri * 0.4) + 0.012 * kick;
      const h = clamp(v, 0, 1);
      const x = L.cx + b.u * glassW(h) * k * 0.95;
      const y = yg0 - h * glassH;
      bv[n++]!.set(x, y, b.r * k * (1 + 0.12 * f.a.low), 1);
    }
    // 每個小節線，瓶底冒起一顆新的蠟（很快離開蠟池，然後慢下來往上漂）
    const recent = this.bars.filter((b) => b <= t).slice(-3);
    recent.forEach((tb, i) => {
      if (n >= NB) return;
      const age = t - tb;
      const v = 0.02 + 0.85 * (1 - Math.exp(-age / 2.2));
      const side = hash(this.seed, Math.round(tb * 10), 5) - 0.5;
      const h = clamp(v, 0, 1);
      const grow = ease.outBack(clamp(age / 0.35));
      bv[n++]!.set(L.cx + side * glassW(h) * k * 0.7, yg0 - h * glassH, (34 + 6 * i) * k * grow, 1);
    });
    while (n < NB) bv[n++]!.set(-9999, -9999, 0, 0);

    // ---- 蠟字
    const gs = u.gs!.value as THREE.Vector2[];
    const ly = lyricAt(lyrics, t, 1.3, 0.9);
    const mk = ly ? this.masks.get(ly.line) : undefined;
    if (ly && mk) {
      u.tm!.value = mk.m.tex;
      (u.tr!.value as THREE.Vector4).set(...mk.rect);
      // 聚攏：提早 0.9 秒開始收，唱的時候全清楚；唱完停一下再化開
      u.lineK!.value = ease.inOutQuad(ly.k);
      const st = glyphStates(ly.line, t);
      // 原文副行的字接在中文後面（照原文自己的逐字時間）
      const sub = lyricSubOf(ly.line);
      if (sub) { st.length = Math.min(st.length, mk.n); st.push(...glyphStates(sub, t)); }
      for (let i = 0; i < MAXG; i++) { const g = st[i]; gs[i]!.set(g ? g.p : 0, g?.done ? 1 : 0); }
    } else if (this.names) {
      u.tm!.value = this.names.m.tex;
      (u.tr!.value as THREE.Vector4).set(...this.names.rect);
      u.lineK!.value = ease.inOutQuad(prog(t, this.tOn, this.tOn + au.beatPeriod(s) * 3));
      for (let i = 0; i < MAXG; i++) gs[i]!.set(1, 1);
    } else {
      u.tm!.value = this.card.texture;
      (u.tr!.value as THREE.Vector4).set(-10, -10, 1, 1);
      u.lineK!.value = 0;
    }

    // ---- 卡片
    u.card!.value = this.card.texture;
    u.cardOn!.value = 1;
    (u.cardR!.value as THREE.Vector4).set(CARD.cx, CARD.cy, 0, CARD.ang);
    u.cardA!.value = this.msg ? 1 : 0.8;
    u.mm!.value = this.mm?.tex ?? this.card.texture;
    let shown = 0;
    if (this.mm) {
      for (let i = 0; i < this.times.length; i++) {
        const kk = clamp((t - this.times[i]!) / 0.13);
        if (kk <= 0) break;
        shown = i + kk;
      }
    } else shown = -1;
    u.shown!.value = shown;
    u.hasMsg!.value = this.msg ? 1 : 0;
    this.bg.render(renderer, out);

    const box = this.lay?.box;
    return {
      bloom: 0.8, vignette: 0.55, halation: 0.3,
      zoom: 1 + 0.035 * ease.inOutQuad(f.p) + pulse(t, this.tOn, 0.1) * 0.006,
      popupAvoid: box ? [[CARD.cx - CARD.w / 2, CARD.cy - CARD.h / 2, CARD.w, CARD.h]] : [[L.cx - 250, 150, 500, 600]],
    };
  }
}
