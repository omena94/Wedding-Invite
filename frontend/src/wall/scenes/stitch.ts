// 十字繡（亮）：鏡頭貼近一個大繡框，框裡繃著一塊 Aida 十字繡布——一幅正在繡的「紀念繡」（sampler）。
// 2026-09-29 依「留言尺寸與版面比例標準 v2」重做構圖：
//  - 場景是主視覺：右半邊是一幅十字繡圖（一間小房子、兩棵樹、屋頂上一顆愛心、地上一排草、下面繡著 2027，外面一圈點點的邊框），
//    布上先印著淡淡的彩色圖稿（材料包的樣子），拍點上一塊一塊繡出來（每一格先「/」再「\」，剛繡好的線偏亮、半秒沉回線色）；
//    主圖繡完之後每一小節針會去地上多繡一朵小花（窗格長時中段也一直有事件）。
//  - 留言在左邊，用「緞面繡」繡字（霞鶩文楷，40～60 px，照 _v2），拍點上一個字一個字繡出來（還沒繡的字是布上淡淡的印稿），
//    署名在最後一行下面（26～32 px）。留言是這一格畫面最清楚的東西：深色的線、寫在乾淨的布面上。
//  - 歌詞是上緣一行緞面繡（40～52 px，比留言小）：還沒唱是淡淡的印稿、正在唱 blood 線、唱完深咖啡線。
//  - 沒有留言：歌詞放在左邊當焦點（52 px、最多兩行），下面一行小小的邀請；純音樂又沒有留言：繡新人的名字。
//  - 繡框比畫面大，只看得到左上兩段木圈（右下角 HUD 底下是乾淨的布）。鏡頭切進來時從斜上方落定，之後慢慢推近。
//    一根針跟著正在繡的地方點動（每一針一下），沒事做時插在布上。
// 手法：一個全螢幕 shader 畫布、十字繡、繡框（PlaneCam 把每個像素打回布面座標）；十字繡圖是一張小小的格子資料貼圖
// （每格：顏色、第幾塊、塊裡的順序），每一塊的開始時間在 uniform 陣列；緞面繡的字畫在布面座標的 Canvas 圖層、shader 加斜紋與凸起；
// 針與線用 LineBatch。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, layout, loadText, type TextLayout } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { lyricAt, lyricSubOf, subGap, subSizeFor, COUPLE_ZH, WEDDING_DATE, drawHeart } from './_motifs';
import { grid, stagger, layoutRows, drawRows, paperInk } from './_t4';
import { PlaneCam, camUniforms, CAM_GLSL, msgBlockV2, INVITE, type MsgBlock, type Rect } from './_t14';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'craft', paper: true, energy: [0.1, 0.75], bars: [4, 8], weight: 1 };

/** 繡框（布面座標）：圓心、內圈半徑、木圈寬。框比畫面大：右下角（HUD）落在框裡面的乾淨布上，木圈只出現在左、上兩邊。 */
const HOOP = { x: 1010, y: 650, r: 1060, w: 58 };
/** 十字繡圖：50 × 50 格、一格 12 px，放在右半邊。 */
const CELL = 12, GN = 50;
const MOTIF = { x: 1070, y: 190 };
/** 留言（緞面繡）在左邊這一塊（螢幕上寬 ≤ 860、高 ≤ 430，init 依鏡頭縮放換算）；歌詞在上緣。 */
const MSG_BOX = { x: 190, y: 286, w: 820, h: 420 };
const LYR = { x: 190, y: 204, w: 820 };
const INVITE_Y = 800;
const FAM_MSG = F.hand(700);
const FAM_LYR = F.archivo(100, 700);
const MAXE = 24;
/** 針沒事做時插在布上的地方（留言與繡圖之間的下方）。 */
const PARK = { x: 1010, y: 760 };

// ---------------------------------------------------------------- 十字繡圖（格子）
/** 線的顏色（shader 照編號上色）：1 紅（blood）、2 咖啡（sepia）、3 金、4 玫瑰（只給愛心）、5 樹葉（咖啡混一點訊號色）。 */
type Cell = { c: number; r: number; col: number };
interface Motif { data: Uint8Array; els: { cells: Cell[] }[] }

const DIGITS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'], '2': ['111', '001', '111', '100', '111'], '7': ['111', '001', '010', '010', '010'],
  '1': ['010', '110', '010', '010', '111'], '3': ['111', '001', '111', '001', '111'],
};
const HEART = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];

/**
 * 繡圖（只由種子決定，每個窗格只算一次）：回傳每一塊依繡的順序排好的格子。塊的順序就是繡的順序（地面 → 牆 → 屋頂 → …），
 * 最後幾塊是「每小節一朵小花」。
 */
function buildMotif(seed: number, year: string): { els: Cell[][] } {
  const taken = new Set<string>();
  const els: Cell[][] = [];
  const add = (cells: Cell[]) => {
    const out = cells.filter((q) => q.c >= 0 && q.r >= 0 && q.c < GN && q.r < GN && !taken.has(`${q.c},${q.r}`));
    out.forEach((q) => taken.add(`${q.c},${q.r}`));
    // 一塊裡照「一排一排、由左到右」繡（真的十字繡是這樣走的）
    out.sort((a, b) => a.r - b.r || a.c - b.c);
    els.push(out);
  };
  const rect = (c0: number, c1: number, r0: number, r1: number, col: number) => {
    const o: Cell[] = [];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) o.push({ c, r, col });
    return o;
  };
  // 屋頂先登記（窗戶、煙囪不能蓋到它），但放在牆之後繡
  const roof: Cell[] = [];
  for (let r = 16; r <= 26; r++) { const hw = 1.5 + (r - 16) * 0.95; for (let c = 0; c < GN; c++) if (Math.abs(c + 0.5 - 25) <= hw) roof.push({ c, r, col: 1 }); }
  roof.forEach((q) => taken.add(`${q.c},${q.r}`));
  const ground: Cell[] = [];
  for (let c = 3; c <= 46; c++) { ground.push({ c, r: 41, col: 2 }); if (c % 2 === 0) ground.push({ c, r: 40, col: 5 }); }
  add(ground);
  // 窗戶與門也先登記（牆不能蓋到它們），繡完屋頂才繡
  const openings = [...rect(18, 21, 29, 32, 2), ...rect(28, 31, 29, 32, 2), ...rect(23, 26, 34, 39, 1)];
  openings.forEach((q) => taken.add(`${q.c},${q.r}`));
  add(rect(16, 33, 27, 39, 3)); // 牆
  roof.forEach((q) => taken.delete(`${q.c},${q.r}`));
  add(roof);
  add(rect(29, 31, 12, 21, 2)); // 煙囪（被屋頂蓋住的格子自動略過）
  openings.forEach((q) => taken.delete(`${q.c},${q.r}`));
  add(openings);
  const tree = (cx: number) => {
    const o: Cell[] = [];
    for (let r = 22; r <= 34; r++) for (let c = Math.floor(cx) - 6; c <= Math.floor(cx) + 6; c++) if (Math.hypot(c + 0.5 - cx, (r + 0.5 - 28.5) * 1.05) <= 5.3) o.push({ c, r, col: 5 });
    o.push(...rect(Math.floor(cx) - 1, Math.floor(cx), 34, 39, 2));
    return o;
  };
  add(tree(8.5)); add(tree(41.5));
  const heart: Cell[] = [];
  HEART.forEach((row, r) => Array.from(row).forEach((ch, c) => { if (ch === 'X') heart.push({ c: 22 + c, r: 7 + r, col: 4 }); }));
  add(heart);
  const date: Cell[] = [];
  Array.from(year).forEach((d, k) => (DIGITS[d] ?? DIGITS['0']!).forEach((row, r) => Array.from(row).forEach((ch, c) => { if (ch === '1') date.push({ c: 18 + k * 4 + c, r: 43 + r, col: 1 }); })));
  add(date);
  // 邊框：沿著外圈每隔一格一針，照繞圈的順序繡（add 會照排列排序，所以自己推進去）
  const ring: Cell[] = [];
  const per: [number, number][] = [];
  for (let c = 1; c <= 48; c++) per.push([c, 1]);
  for (let r = 2; r <= 48; r++) per.push([48, r]);
  for (let c = 47; c >= 1; c--) per.push([c, 48]);
  for (let r = 47; r >= 2; r--) per.push([1, r]);
  per.forEach(([c, r], i) => { if (i % 2 === 0) ring.push({ c, r, col: 3 }); });
  ring.forEach((q) => taken.add(`${q.c},${q.r}`));
  els.push(ring);
  // 小花（每小節一朵）：地上草叢之間，位置用種子挑
  const spots = [5, 12, 37, 44, 14, 35];
  const off = Math.floor(hash(seed, 3) * spots.length);
  for (let k = 0; k < 4; k++) {
    const c = spots[(k + off) % spots.length]!;
    const fl: Cell[] = [{ c, r: 37, col: 1 }, { c: c - 1, r: 38, col: 1 }, { c: c + 1, r: 38, col: 1 }, { c, r: 38, col: 3 }, { c, r: 39, col: 5 }];
    add(fl);
  }
  return { els };
}

const BG = () => new FSPass(/* glsl */ `
  ${CAM_GLSL}
  uniform sampler2D motif; uniform vec2 mOrigin; uniform float cell;
  uniform vec2 eT[${MAXE}]; uniform float now; uniform float legT; uniform float stencilA;
  uniform sampler2D satin; uniform vec4 hoop; uniform float focus; uniform float aperture;

  // 一條繡線的明暗：圓柱（中間亮、兩側暗）、朝左上方的那側受光、兩股線的撚紋
  vec3 thread(vec3 base, float sd, float al, float hwv, float side, float detail) {
    float x = clamp(sd / hwv, -1.0, 1.0);
    float up = sqrt(max(0.0, 1.0 - x * x));
    float twist = 0.5 + 0.5 * sin((al * 5.0 + x * 0.8) * TAU);
    return base * (0.6 + 0.4 * up - 0.12 * x * side) * (0.9 + 0.18 * twist * detail);
  }
  vec3 threadColor(float k) {
    if (k < 1.5) return mix(C_BLOOD, C_SIGNAL, 0.12);
    if (k < 2.5) return C_SEPIA * 1.3;
    if (k < 3.5) return mix(C_SIGNAL, C_BLOOD, 0.45);
    if (k < 4.5) return mix(C_ROSE, C_BLOOD, 0.15);
    return mix(C_SEPIA, C_SIGNAL, 0.22);
  }

  void main() {
    vec2 sp = SP();
    vec3 h0 = pcHit(sp, 0.0);
    vec2 P = h0.xy;
    float blur = aperture * abs(h0.z - focus) / max(h0.z, 1.0);
    vec2 fwP = fwidth(P);
    float ppx = max(fwP.x, fwP.y) * (1.0 + blur * 0.6);

    // ---- 布：Aida 的一格一格（中間鼓起、格與格之間的縫、四角的小洞、細織紋），格子跟繡圖對齊
    vec2 g = (P - mOrigin) / cell; vec2 id = floor(g); vec2 f = g - id;
    float aa = ppx / cell;
    float detail = sat(1.3 - aa * 4.0);
    vec3 linen = mix(C_PAPER, C_BONE, 0.35);
    vec3 col = linen * (0.955 + 0.035 * snoise(P / 260.0) + 0.012 * snoise(P / 23.0));
    vec2 q = f - 0.5;
    float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    float gapL = 1.0 - smoothstep(0.02, 0.1 + aa, edge);
    vec2 cn = f - floor(f + 0.5);
    float hole = 1.0 - smoothstep(0.12, 0.15 + aa, length(cn));
    float weave = 0.5 + 0.5 * sin(g.x * TAU * 3.0) * sin(g.y * TAU * 3.0);
    float slub = hash12(id) - 0.5;
    float pat = 1.0 - 0.035 * gapL - 0.025 * weave - 0.05 * dot(q, q) - 0.12 * hole + 0.035 * slub;
    col *= mix(0.965, pat, detail);

    // ---- 框外的布：鬆的、有皺褶、暗一點；框在布上的影子（光從左上來，影子偏右下）
    vec2 hp = P - hoop.xy;
    float r0 = length(hp);
    float ang = atan(hp.y, hp.x);
    float outside = smoothstep(hoop.z + hoop.w * 0.6, hoop.z + hoop.w + 6.0, r0);
    float fold = sin(ang * 34.0 + 2.6 * snoise(vec2(ang * 2.2, r0 / 240.0)) + r0 / 90.0);
    col *= mix(1.0, 0.84 + 0.07 * fold + 0.04 * snoise(P / 90.0), outside);
    float rs = length(P - hoop.xy - vec2(9.0, 12.0));
    float shIn = smoothstep(hoop.z - 36.0, hoop.z + 2.0, rs) * (1.0 - smoothstep(hoop.z + hoop.w, hoop.z + hoop.w + 30.0, rs));
    col *= 1.0 - 0.3 * shIn;

    // ---- 十字繡圖（格子資料：R 顏色編號、G 第幾塊、B 塊裡的順序）
    if (id.x >= 0.0 && id.y >= 0.0 && id.x < ${GN}.0 && id.y < ${GN}.0) {
      vec4 m = texelFetch(motif, ivec2(id), 0);
      float ck = floor(m.r * 255.0 + 0.5);
      if (ck > 0.5) {
        int ei = min(int(floor(m.g * 255.0 + 0.5)), ${MAXE - 1});
        vec2 et = eT[ei];
        float ts = et.x + m.b * et.y;
        float a1 = now - ts, a2 = a1 - legT;
        float v1 = step(0.0, a1), v2 = step(0.0, a2);
        vec3 settled = threadColor(ck);
        // 印在布上的圖稿：淡淡的彩色方塊（還沒繡的地方看得到整幅圖）
        col = mix(col, mix(linen, settled, 0.55), stencilA * (1.0 - v1) * (0.6 + 0.4 * detail));
        float sd1 = (f.x + f.y - 1.0) * 0.7071, al1 = (f.x - f.y + 1.0) * 0.5;
        float sd2 = (f.y - f.x) * 0.7071, al2 = (f.x + f.y) * 0.5;
        float fresh = 1.0 - sat((now - ts - legT) / 0.5);
        vec3 thc = mix(settled, mix(settled, C_SIGNAL, 0.45) * 1.15, fresh);
        float hw = 0.22;
        float t1 = hw * (0.72 + 0.28 * sin(PI * sat(al1))), t2 = hw * (0.72 + 0.28 * sin(PI * sat(al2)));
        float c1 = 1.0 - smoothstep(t1 - aa, t1 + aa, abs(sd1));
        float c2 = 1.0 - smoothstep(t2 - aa, t2 + aa, abs(sd2));
        float s1 = 1.0 - smoothstep(t1, t1 + 0.12 + aa, abs(sd1 - 0.05));
        float s2 = 1.0 - smoothstep(t2, t2 + 0.12 + aa, abs((f.y - 0.06 - f.x + 0.03) * 0.7071));
        col *= 1.0 - 0.26 * max(s1 * v1, s2 * v2);
        col = mix(col, thread(thc, sd1, al1, t1, 1.0, detail), c1 * v1);
        col *= 1.0 - 0.28 * v2 * v1 * (1.0 - smoothstep(t2, t2 + 0.1 + aa, abs(sd2))) * (1.0 - c2);
        col = mix(col, thread(thc * 1.04, sd2, al2, t2, 0.0, detail), c2 * v2);
      }
    }

    // ---- 緞面繡的字（布面座標的圖層）：影子、凸起的明暗、斜斜的線紋
    vec4 s = fastLayer(texture(satin, pageUV(P)));
    // 影子只給真的繡上去的線（還沒繡的印稿很淡，平方之後幾乎沒有影子）
    float sh = texture(satin, pageUV(P - vec2(1.2, 1.8))).a;
    col *= 1.0 - 0.22 * sh * sh * (1.0 - s.a);
    if (s.a > 0.002) {
      float ax = texture(satin, pageUV(P + vec2(1.2, 0.0))).a - texture(satin, pageUV(P - vec2(1.2, 0.0))).a;
      float ay = texture(satin, pageUV(P + vec2(0.0, 1.2))).a - texture(satin, pageUV(P - vec2(0.0, 1.2))).a;
      float lit = 1.0 + 0.3 * (ax * 0.6 + ay * 0.8) * s.a;
      float stripe = 0.84 + 0.2 * (0.5 + 0.5 * sin((P.x - P.y) * TAU / 3.2));
      vec3 sc = s.rgb / max(s.a, 1e-3);
      col = mix(col, sc * lit * mix(1.0, stripe, detail), s.a);
    }

    // ---- 繡框（比布高 16）：內圈、外圈兩圈木頭，圓柱的明暗、木紋、中間一條縫
    vec2 H1 = pcHit(sp, -16.0).xy - hoop.xy;
    float rr = length(H1) - hoop.z;
    float fr = max(fwidth(rr), 1e-3);
    if (rr > -2.0 && rr < hoop.w + 2.0) {
      vec2 rad = H1 / max(length(H1), 1.0);
      float inner = rr < 24.0 ? 1.0 : 0.0;
      float a0 = inner > 0.5 ? 0.0 : 26.0, b0 = inner > 0.5 ? 24.0 : hoop.w;
      float u = sat((rr - a0) / (b0 - a0));
      float n = u * 2.0 - 1.0;
      float face = sqrt(max(0.0, 1.0 - n * n));
      float toL = dot(rad * n, normalize(vec2(-0.6, -0.8)));
      float an = atan(H1.y, H1.x);
      float grain = 0.5 + 0.5 * sin(an * 620.0 + rr * 0.35 + 6.0 * snoise(vec2(an * 5.0, rr / 25.0)));
      vec3 wood = mix(mix(C_PAPER, C_BLOOD, 0.18), C_SEPIA, 0.3 + 0.1 * grain);
      float spec = pow(sat(toL * 0.8 + face * 0.4), 12.0);
      vec3 wc = wood * (0.5 + 0.38 * face + 0.3 * toL) + C_BONE * spec * 0.25;
      float cov = smoothstep(-fr, fr, rr) * (1.0 - smoothstep(hoop.w - fr, hoop.w + fr, rr));
      float seam = 1.0 - smoothstep(0.5, 1.6 + fr, abs(rr - 25.0));
      col = mix(col, wc * (1.0 - 0.5 * seam), cov);
    }

    // 一盞燈從左上打過來：畫面右下角暗一點點（HUD 底下還是亮的布）
    col *= 0.95 + 0.08 * exp(-dot((sp - vec2(700.0, 380.0)) / 1300.0, (sp - vec2(700.0, 380.0)) / 1300.0) * 2.0);
    fragColor = vec4(col, 1.0);
  }`, {
  ...camUniforms(),
  motif: { value: null }, mOrigin: { value: new THREE.Vector2(MOTIF.x, MOTIF.y) }, cell: { value: CELL },
  eT: { value: Array.from({ length: MAXE }, () => new THREE.Vector2(1e9, 0.3)) }, now: { value: 0 }, legT: { value: 0.05 }, stencilA: { value: 0.3 },
  satin: { value: null }, hoop: { value: new THREE.Vector4(HOOP.x, HOOP.y, HOOP.r, HOOP.w) }, focus: { value: 1600 }, aperture: { value: 3 },
});

/** 兩個 CSS rgba() 顏色之間的混色（mixRgba 只收色票名稱）。 */
function mixCss(a: string, b: string, k: number): string {
  const pa = a.match(/[\d.]+/g)!.map(Number), pb = b.match(/[\d.]+/g)!.map(Number);
  return `rgba(${[0, 1, 2].map((i) => Math.round(pa[i]! + (pb[i]! - pa[i]!) * k)).join(',')},1)`;
}

/** 緞面繡的一個字：位置、繡的時間。 */
interface SGlyph { ch: string; x: number; y: number; w: number; size: number; s: number; d: number }

export default class Stitch extends Scene {
  bg = shared('stitch.bg', BG);
  /** 緞面繡的字（布面座標）。 */
  satin = this.track(new Layer2D(W, H, undefined, { fast: true }));
  pins = this.track(new LineBatch(256, { screen2D: true, blend: 'normal' }));
  cam = new PlaneCam();
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 131 + (this.msg?.id ?? 0) * 17) >>> 0;
  motifTex: THREE.DataTexture | null = null;
  /** 每一塊繡圖：格子（照繡的順序）與開始時間、長度。 */
  els: { cells: Cell[]; s: number; d: number }[] = [];
  block: MsgBlock | null = null;
  glyphs: SGlyph[] = [];
  sig: SGlyph[] = [];
  t0 = 0;
  /** 留言與署名都繡完的時間（之後針去繡花）。 */
  msgDone = 0;
  lyrSize = 52;
  /** 鏡頭在留言那一塊的縮放（1 布面 px = k 螢幕 px）。 */
  k = 1;
  hasLyrics = false;
  /** 沒有留言也沒有歌詞：繡新人的名字。 */
  names: SGlyph[] = [];
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const c = this.satin.ctx;
    const gr = grid(au, s, e);
    this.t0 = gr.b0;
    this.hasLyrics = lyrics.linesIn(s - 0.5, e + 0.4).length > 0;
    const names = COUPLE_ZH.replace(/\s*&\s*/, ' ♥ ');
    await loadText(`${m?.text ?? ''}${m ? (m.couple ? '—— 新郎新娘' : m.name) : ''}${names}${INVITE}${song.title}${song.artist}——一位賓客`);
    // 鏡頭在留言那一塊的縮放（窗格中間的姿勢）：畫在布上的字級要除以它，畫面上才是標準的大小
    this.cam.set(this.pose((s + e) / 2));
    const k = (this.k = this.cam.toScreen(MSG_BOX.x + MSG_BOX.w / 2, MSG_BOX.y + MSG_BOX.h / 2).scale);

    // ---- 十字繡圖：主圖一拍一塊（最多兩小節半、窗格的六成），之後每一小節一朵花
    const year = String(WEDDING_DATE).slice(0, 4);
    const { els } = buildMotif(this.seed, year);
    const main = els.slice(0, els.length - 4), flowers = els.slice(els.length - 4);
    const ts = stagger(au, gr.b0, main.length, Math.min(gr.bar * 2.5, Math.max(gr.beat * 2, (e - gr.b0) * 0.6)));
    const gap = ts.length > 1 ? ts[1]! - ts[0]! : gr.beat;
    main.forEach((cells, i) => this.els.push({ cells, s: ts[i]!, d: clamp(gap * 0.85, 0.12, 0.5) }));
    const lastMain = ts[ts.length - 1]! + gap;
    const fbars = gr.bars.filter((b) => b > lastMain + 0.05);
    flowers.forEach((cells, i) => this.els.push({ cells, s: fbars[i] ?? 1e9, d: clamp(gr.beat * 0.8, 0.2, 0.45) }));
    const data = new Uint8Array(GN * GN * 4);
    this.els.forEach((el, ei) => el.cells.forEach((q, j) => {
      const o = (q.r * GN + q.c) * 4;
      data[o] = q.col; data[o + 1] = ei; data[o + 2] = Math.round((255 * j) / Math.max(1, el.cells.length - 1)); data[o + 3] = 255;
    }));
    const tex = new THREE.DataTexture(data, GN, GN, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
    this.motifTex = this.track(tex);

    if (m) {
      // ---- 有留言：左邊一塊緞面繡（v2：40～60 px、署名 26～32、照子句斷行）
      const bw = Math.min(MSG_BOX.w, 860 / k), bh = Math.min(MSG_BOX.h, 430 / k);
      const b = (this.block = msgBlockV2(c, m, FAM_MSG, { x: MSG_BOX.x, y: MSG_BOX.y + (MSG_BOX.h - bh) / 2, w: bw, h: bh }, { align: 'left', sigFamily: FAM_MSG, scale: k, lineHeight: 1.36 }));
      const all: Omit<SGlyph, 's' | 'd'>[] = [];
      for (const ln of b.lines) for (const g of layout(ln.text, FAM_MSG, b.fit.size).glyphs) if (g.ch.trim()) all.push({ ch: g.ch, x: ln.x + g.x, y: ln.y, w: g.w, size: b.fit.size });
      const gt = stagger(au, gr.b0, all.length, Math.min(gr.bar * 1.75, Math.max(gr.beat * 2, (e - gr.b0) * 0.5)));
      const gg = gt.length > 1 ? gt[1]! - gt[0]! : gr.beat;
      this.glyphs = all.map((g, i) => ({ ...g, s: gt[i]!, d: clamp(gg * 0.9, 0.08, 0.4) }));
      // 署名：留言繡完的下一拍，一口氣由左往右繡（一個字一小段）
      const last = this.glyphs[this.glyphs.length - 1]!;
      const sigT = Math.min(Math.max(last.s + last.d, au.timeOfBeat(Math.ceil(au.beatAt(last.s + last.d) - 1e-3))), Math.max(last.s + last.d, e - 1.2));
      const sl: TextLayout = layout(b.sig.text, FAM_MSG, b.sig.size);
      const per = clamp(gr.beat * 1.2, 0.4, 0.8) / Math.max(1, sl.glyphs.length);
      this.sig = sl.glyphs.map((g, i) => ({ ch: g.ch, x: b.sig.x + g.x, y: b.sig.y, w: g.w, size: b.sig.size, s: sigT + i * per, d: per }));
      this.msgDone = sigT + per * sl.glyphs.length;
      this.lyrSize = lyricV2(b.fit.size * k) / k;
      this.avoid = [this.cam.screenRect(b.box, 10)];
    } else {
      this.lyrSize = lyricV2(null) / k;
      if (!this.hasLyrics) {
        // 純音樂又沒有留言：繡新人的名字（60 px），一拍一個字
        const size = 60 / k;
        const lay = layout(names, FAM_MSG, size);
        const nt = stagger(au, gr.b0, lay.glyphs.length, gr.bar * 1.5);
        this.names = lay.glyphs.map((g, i) => ({ ch: g.ch, x: MSG_BOX.x + g.x, y: 520, w: g.w, size, s: nt[i]!, d: clamp(gr.beat * 0.8, 0.15, 0.4) }));
        this.msgDone = (nt[nt.length - 1] ?? gr.b0) + gr.beat;
      }
      this.avoid = [[MSG_BOX.x, 360, MSG_BOX.w, 300]];
    }
  }

  /** 鏡頭：從斜上方、遠一點、歪一點的地方 outExpo 落定（第一拍前停好），之後慢慢推近、橫移；最後半拍往右搖開。 */
  private pose(t: number) {
    const s = this.ctx.start, e = this.ctx.end;
    const land = prog(t, s, Math.max(s + 0.35, this.t0), ease.outExpo);
    const p = clamp((t - s) / (e - s));
    const exit = prog(t, e - 0.45, e, ease.inCubic);
    const side = hash(this.seed, 3) < 0.5 ? -1 : 1;
    const F0 = 1700;
    return {
      tx: 945 + side * 24 * (p - 0.5) + 260 * exit,
      ty: 530 - 60 * (1 - land),
      dist: F0 * (1.1 - 0.1 * land) * (1 - 0.04 * ease.inOutQuad(p)) * (1 + 0.04 * exit),
      pitch: 0.15 + 0.1 * (1 - land),
      yaw: -0.05 * side + 0.03 * side * (1 - land) + 0.1 * exit,
      roll: 0.03 * side * (1 - land) - 0.004 * side,
      focal: F0,
    };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.cam.set(this.pose(t));
    const u = this.bg.u;
    this.cam.apply(u);
    u.now!.value = t;
    u.focus!.value = this.cam.toScreen(945, 500).depth;
    u.motif!.value = this.motifTex;
    const arr = u.eT!.value as THREE.Vector2[];
    for (let i = 0; i < MAXE; i++) { const el = this.els[i]; if (el) arr[i]!.set(el.s, el.d); else arr[i]!.set(1e9, 0.3); }
    u.stencilA!.value = 0.3 * prog(t, s, s + 0.4);
    const L = this.satin; L.clear();
    const c = L.ctx;
    c.textBaseline = 'alphabetic';

    // ---- 緞面繡：留言、署名（或新人的名字）
    const thread = this.msg ? mixRgba('blood', 'sepia', 0.3, 1) : rgba('sepia');
    for (const g of this.glyphs) this.satinGlyph(c, g, t, FAM_MSG, thread);
    for (const g of this.sig) this.satinGlyph(c, g, t, FAM_MSG, rgba('sepia'), false);
    for (const g of this.names) this.satinGlyph(c, g, t, FAM_MSG, rgba('sepia'));
    if (this.msg?.couple && this.block) {
      c.font = font(F.mono(500), 18 / this.k); c.letterSpacing = '4px';
      c.fillStyle = rgba('blood', 0.75 * prog(t, s + 0.3, s + 0.9));
      c.fillText('FROM THE COUPLE  ·  新人', this.block.box[0], this.block.box[1] - 10);
      c.letterSpacing = '0px';
    }
    // ---- 歌詞：有留言時上緣一行；沒有留言時在左邊當焦點（最多兩行）
    const ly = lyricAt(lyrics, t);
    // 沒有留言時歌詞是焦點：兩句之間不要空著，先印著下一句（還沒繡），窗格裡沒有下一句就留著剛繡完的那句
    const e = this.ctx.end, nx = lyrics.nextLine(t), lsl = lyrics.lastLine(t);
    const line = ly?.line ?? (this.msg ? null : nx && nx.start < e ? nx : lsl && lsl.end > s - 4 ? lsl : null);
    if (line) {
      const big = !this.msg;
      const st = { family: FAM_LYR, size: this.lyrSize, minSize: 40 * this.lyrSize / 52, maxW: LYR.w, maxRows: big ? 2 : 1, align: 'left' as const };
      const lay = layoutRows(c, line, st);
      const sub = lyricSubOf(line);
      if (sub) {
        // 韓文歌（沒有留言才有）：原文小一號繡在中文正下方（同一塊布、同樣靠左），兩段一起在左邊垂直置中。
        // 字級照螢幕 px 算（布在畫面上縮成約 k 倍）；原文比中文安靜：繡到、繡完都是淡兩成的咖啡線，不用 blood 線
        const ss = subSizeFor(lay.size * this.k) / this.k;
        const sl = layoutRows(c, sub, { family: FAM_LYR, size: ss, minSize: Math.min(ss, 26 / this.k), maxW: LYR.w, maxRows: 2, align: 'left' });
        const gap = subGap(lay.size, sl.size), more = gap + (sl.rows.length - 1) * sl.lineHeight;
        const ink = paperInk(), lit = rgba('sepia', 0.95 * 0.8);
        c.save(); c.translate(LYR.x, 480 - ((lay.rows.length - 1) * lay.lineHeight + more) * 0.5);
        drawRows(c, lay, FAM_LYR, t, ink, ly ? ly.k : 1);
        c.translate(0, (lay.rows.length - 1) * lay.lineHeight + gap);
        drawRows(c, sl, FAM_LYR, t, { active: lit, sung: lit, unsung: ink.unsung }, ly ? ly.k : 1);
        c.restore();
      } else {
        c.save(); c.translate(LYR.x, big ? 480 - (lay.rows.length - 1) * lay.lineHeight * 0.5 : LYR.y);
        drawRows(c, lay, FAM_LYR, t, paperInk(), ly ? ly.k : 1);
        c.restore();
      }
    }
    if (!this.msg) {
      c.font = font(F.hei(500), 24); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.66 * prog(t, s + 0.3, s + 0.9));
      c.fillText(INVITE, MSG_BOX.x, INVITE_Y);
      c.letterSpacing = '0px';
      if (!this.hasLyrics) {
        const song = this.ctx.song;
        c.font = font(F.mono(500), 18); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.5);
        c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`.toUpperCase(), MSG_BOX.x, LYR.y);
        c.letterSpacing = '0px';
      }
    }
    u.satin!.value = L.upload();
    this.bg.render(renderer, out);
    this.drawNeedle(t, this.needleAt(t));
    if (this.pins.count) this.pins.render(renderer, out);
    return { paper: 1, bloom: 0.35, vignette: 0.4, grain: 0.045, popupAvoid: this.avoid };
  }

  /**
   * 繡一個緞面繡的字：還沒繡是布上淡淡的印稿；繡的時候斜斜地由左上往右下掃出來（剛繡的線偏亮），之後沉回線色。
   * ghost = false：署名沒有印稿（繡的時候才出現）。
   */
  private satinGlyph(c: CanvasRenderingContext2D, g: SGlyph, t: number, family: string, thread: string, ghost = true) {
    const r = clamp((t - g.s) / g.d);
    const heart = g.ch === '♥';
    const base = heart ? rgba('rose') : thread;
    const draw = (color: string) => {
      if (heart) drawHeart(c, g.x + g.w / 2, g.y - g.size * 0.36, Math.min(g.w, g.size) * 0.82, color);
      else { c.fillStyle = color; c.fillText(g.ch, g.x, g.y); }
    };
    c.font = font(family, g.size);
    if (r < 1 && ghost) draw(rgba(heart ? 'rose' : 'sepia', 0.16));
    if (r <= 0) return;
    const fresh = 1 - clamp((t - g.s - g.d) / 0.5);
    const col = fresh > 0.02 && !heart ? mixCss(base, rgba('signal'), fresh * 0.4) : base;
    if (r >= 1) { draw(col); return; }
    const top = g.y - g.size * 0.95, h = g.size * 1.2, S = r * (g.w + 0.6 * h);
    c.save();
    c.beginPath();
    c.moveTo(g.x - 8, top - 8); c.lineTo(g.x + S + 5, top - 8); c.lineTo(g.x + S - 0.6 * (h + 8), top + h + 8); c.lineTo(g.x - 8, top + h + 8);
    c.closePath(); c.clip();
    draw(col);
    c.restore();
  }

  /** 針在哪裡：正在繡的字 → 字與字之間跳過去 → 留言繡完之後去繡花（繡圖的那一格）→ 都沒有就插著。ph 是「第幾針」。 */
  private needleAt(t: number): { x: number; y: number; ph: number } | null {
    const seq = [...this.glyphs, ...this.sig, ...this.names];
    for (let i = 0; i < seq.length; i++) {
      const g = seq[i]!;
      if (t < g.s - 0.1) {
        if (i === 0) break;
        const a = seq[i - 1]!;
        const k = ease.inOutCubic(clamp((t - (a.s + a.d)) / Math.max(0.05, g.s - a.s - a.d)));
        return { x: lerp(a.x + a.w, g.x, k), y: lerp(a.y - a.size * 0.1, g.y - g.size * 0.8, k), ph: 0 };
      }
      if (t < g.s + g.d + 0.05) {
        const k = clamp((t - g.s) / g.d);
        return { x: g.x + g.w * k, y: g.y - g.size * 0.8 + g.size * 0.9 * k, ph: (t - g.s) / 0.07 };
      }
    }
    // 留言繡完之後：針去繡圖那邊，跟著正在繡的那一塊走（每小節的小花）
    if (t > this.msgDone) {
      for (const el of this.els) {
        if (t < el.s - 0.25 || t > el.s + el.d + 0.05 || !el.cells.length) continue;
        const j = Math.min(el.cells.length - 1, Math.floor(clamp((t - el.s) / el.d) * el.cells.length));
        const q = el.cells[Math.max(0, j)]!;
        return { x: MOTIF.x + (q.c + 0.5) * CELL, y: MOTIF.y + (q.r + 0.5) * CELL, ph: (t - el.s) / 0.06 };
      }
    }
    return null;
  }

  /**
   * 針（鋼色的細線、一個針眼）與拖著的繡線：針尖在正在繡的地方，每一針往布裡點一下；沒在繡就插在布上。
   * 布面座標算好再投影到螢幕（針尾離布比較高，有透視）。
   */
  private drawNeedle(t: number, nd: { x: number; y: number; ph: number } | null) {
    const pb = this.pins; pb.clear();
    const s = this.ctx.start;
    let tip = { x: PARK.x, y: PARK.y }, dip = 0;
    const parked = !nd;
    if (nd) { tip = { x: nd.x, y: nd.y }; dip = Math.abs(Math.sin(Math.PI * nd.ph)); }
    const ent = prog(t, s, s + 0.4);
    if (ent <= 0) return;
    const cam = this.cam;
    const tipZ = parked ? 6 : -4 + 10 * dip; // 插在布上時針尖在布下面一點（被布蓋住的樣子）
    const a = cam.toScreen(tip.x, tip.y, tipZ);
    const tail = cam.toScreen(tip.x + 118, tip.y - 58, parked ? -70 : -86 - 14 * dip);
    const steel = LIN.graphite, hi = LIN.bone;
    pb.seg2(a.x, a.y, tail.x, tail.y, 3.2 * a.scale, [steel[0] * 0.9, steel[1] * 0.9, steel[2] * 0.9], ent);
    pb.seg2(a.x + 0.6, a.y - 0.8, tail.x + 0.6, tail.y - 0.8, 1.1 * a.scale, [hi[0], hi[1], hi[2]], 0.8 * ent);
    const e1 = cam.toScreen(tip.x + 104, tip.y - 51, parked ? -62 : -78 - 12 * dip), e2 = cam.toScreen(tip.x + 114, tip.y - 56, parked ? -68 : -84 - 13 * dip);
    pb.seg2(e1.x, e1.y, e2.x, e2.y, 1.6, [LIN.paper[0], LIN.paper[1], LIN.paper[2]], ent);
    // 繡線：從針眼拖出來，鬆鬆地躺回布上（往右下方一段三次曲線）；顏色跟著正在繡的東西
    const thr = this.msg ? LIN.blood : LIN.sepia;
    const ez = parked ? -66 : -82 - 13 * dip;
    const P0 = [tip.x + 112, tip.y - 55, ez], P3 = [tip.x + 150, tip.y + 150, 0];
    const P1 = [P0[0]! + 70, P0[1]! + 30, ez * 0.5], P2 = [P3[0]! + 50, P3[1]! - 90, 0];
    let prev = e2;
    for (let i = 1; i <= 16; i++) {
      const k = i / 16, a0 = (1 - k) ** 3, a1 = 3 * k * (1 - k) ** 2, a2 = 3 * k * k * (1 - k), a3 = k ** 3;
      const p = cam.toScreen(a0 * P0[0]! + a1 * P1[0]! + a2 * P2[0]! + a3 * P3[0]!, a0 * P0[1]! + a1 * P1[1]! + a2 * P2[1]! + a3 * P3[1]!, a0 * P0[2]! + a1 * P1[2]! + a2 * P2[2]! + a3 * P3[2]!);
      pb.seg2(prev.x, prev.y, p.x, p.y, 2.2 * p.scale, [thr[0], thr[1], thr[2]], ent);
      prev = p;
    }
  }
}
