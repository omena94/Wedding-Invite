// 水彩（亮）：冷壓水彩紙上，一束水彩花正在被畫出來——這是主視覺（畫面右邊大半）：
// 先是鉛筆輕輕打的草稿圈（拍點前一下子描出來），拍點上一朵花「暈」開（顏料在濕紙上長出花瓣的形狀、剛畫好濕亮，乾了邊緣積色、
// 顏料沉在紙的凹處），半拍一片葉子，花莖從花束的綁口一路長上去；花都開完了，小鼓上甩幾滴顏料點，最後綁上緞帶。
// 主打留言在左邊：事先用留白膠寫好（淡淡一層膜），一行一道排筆刷過去（落在拍點），刷過的地方字留成白的（40～60 px，
// 照留言尺寸標準 v2；留言區 660 × 400）；署名是鉛筆字，寫在最後一道下面。歌詞是留言下面一行鉛筆字（逐字跟唱，正在唱的是色鉛筆）。
//  - 沒有留言：左邊兩行輪流刷歌詞（筆刷跟著歌聲走，唱到哪刷到哪），下面一行鉛筆寫邀請；純音樂又沒有留言：一筆刷出新人的名字。
//  - 鏡頭：先看花（偏右），留言開始刷的時候焦點慢慢移到左邊，整段慢慢推近。右下角（HUD）是空白的紙。
// 手法：一個全螢幕 shader（PlaneCam）：每一朵花、葉子、顏料點是一個「暈開的色塊」（uniform 陣列：中心、大小、長寬比、角度、花瓣數、顏色、時間），
// 每一道筆刷是一條有波動的帶子；顏料的濃度用吸收疊（罩染自然變深），紙的齒與纖維取 _t21 烤好的紋理；留白膠是 init() 做好的字模。
// 鉛筆草稿、花莖、緞帶、署名、歌詞是紙面座標的 Canvas 圖層（石墨只卡在紙的齒上）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, mulberry32, lerp, pulse } from '../engine/util';
import { Lyrics, type Line, type Word } from '../engine/lyrics';
import { lyricAt, COUPLE_ZH, lyricSubOf, layoutLyric, subStyleFor, subGap, drawLyricSub } from './_motifs';
import { grid, stagger, layoutRows, drawRows, type Grid, type KaraokeInk } from './_t4';
import { PlaneCam, camUniforms, CAM_GLSL } from './_t14';
import { loadAll, sigOf, t21Grain, GRAIN_GLSL, glyphMask, groupLine, block, T21_INVITE, type Block, type TGlyph, type TGroup, type GlyphMask, type Rect } from './_t21';
import { V2, lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'print', paper: true, energy: [0.2, 0.85], bars: [4, 8], weight: 1 };

const MAXS = 8;
const MAXB = 48;
/** 留言（留白膠）在左邊：660 × 400（畫面的 13%）。 */
const MSG_BOX = { x: 120, y: 330, w: 660, h: 400 };
const FAM = F.hand(700);
const FAM_PEN = F.hand(400);
/** 沒有留言時兩行輪流刷歌詞（中心 y）。 */
const BANDS = [470, 640];
/** 有韓文原文副行的窗格：每句下面多一行鉛筆小字，兩行拉開（下面那行離邀請還有 60 px）。 */
const BANDS_SUB = [440, 660];
/** 花束綁起來的地方（花莖從這裡長上去）。 */
const TIE = { x: 1330, y: 800 };
/** 鏡頭整段的縮放在 0.97～1.0：頁面 px ≈ 螢幕 px。 */
const K = 0.97;

const BG = () => new FSPass(/* glsl */ `
  ${CAM_GLSL}
  ${GRAIN_GLSL}
  uniform float t;
  uniform sampler2D mA; uniform vec4 rA; uniform float aA;
  uniform sampler2D mB; uniform vec4 rB; uniform float aB;
  uniform vec4 sG[${MAXS}]; uniform vec4 sF[${MAXS}]; uniform int nS;
  uniform vec4 bA[${MAXB}]; uniform vec4 bB[${MAXB}]; uniform int nB;
  uniform sampler2D pen;

  vec4 maskAt(sampler2D m, vec4 r, vec2 p) {
    vec2 uv = (p - r.xy) / r.zw;
    return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(m, uv);
  }
  vec3 absorb(vec3 c, vec3 base) { return -log(clamp(c / base, vec3(0.004), vec3(1.0))); }
  /** 顏料：0 = 訊號色的暗部往訊號色、1 = 淡的訊號色、2 = 葉子（墨＋灰）、3 = 深的暗部。 */
  vec3 pigment(float k) {
    if (k < 0.5) return mix(C_BLOOD, C_SIGNAL, 0.45);
    if (k < 1.5) return mix(C_SIGNAL, C_EMBER, 0.3);
    if (k < 2.5) return mix(mix(mix(C_SEPIA, C_GRAPHITE, 0.4), C_SIGNAL, 0.18), C_PAPER, 0.3);
    return mix(C_BLOOD, C_SEPIA, 0.3);
  }

  void main() {
    vec2 sp = SP();
    vec2 P = pcHit(sp, 0.0).xy;
    vec4 gr = paperGrain(P);
    // 紙：冷壓紙的齒（左上來的光把小丘照出明暗）
    float e1 = paperGrain(P + vec2(1.5, 0.0)).a - paperGrain(P - vec2(1.5, 0.0)).a;
    float e2 = paperGrain(P + vec2(0.0, 1.5)).a - paperGrain(P - vec2(0.0, 1.5)).a;
    float lit = 1.0 - 0.09 * (e1 + e2);
    vec3 pap = mix(C_PAPER, C_BONE, 0.62) * (0.972 + 0.028 * gr.b) * lit;
    // 留白膠：A = 加粗的字（膠）、B = 暈開一點（字邊積色用）
    vec4 ma = maskAt(mA, rA, P) * aA, mb = maskAt(mB, rB, P) * aB;
    float res = smoothstep(0.4, 0.62, max(ma.a, mb.a));
    float ring = clamp(max(ma.b, mb.b) - max(ma.a, mb.a) * 0.8, 0.0, 1.0);
    float nzL = snoise(P / 75.0);
    float nz = snoise(P / 17.0);
    float gran = 1.0 - gr.a; // 凹處
    vec3 A = vec3(0.0);
    float wetAll = 0.0, bead = 0.0, cover = 0.0;
    // ---- 花、葉子、顏料點：一個一個暈開的色塊
    for (int i = 0; i < ${MAXB}; i++) {
      if (i >= nB) break;
      vec4 A0 = bA[i], B0 = bB[i];
      float dt = t - A0.w;
      if (dt <= 0.0) continue;
      vec2 d = P - A0.xy;
      float rmax = A0.z * 1.3 + 16.0;
      if (abs(d.x) > rmax || abs(d.y) > rmax) continue;
      float sd = float(i) * 7.13;
      vec2 q = rot2(-B0.y) * d;
      q.y /= B0.x;
      float ang = atan(q.y, q.x), rr = length(q);
      // 花瓣：半徑照角度起伏（B0.z 片）；葉子是尖一點的橢圓；顏料點是圓的
      float shape = B0.z > 0.5 ? 0.7 + 0.3 * pow(abs(cos(ang * B0.z * 0.5 + sd)), 0.55) : 1.0;
      // 長大：一下子暈開（拍點），之後還慢慢往外爬一點點（濕的邊）
      float R = A0.z * shape * ((1.0 - exp(-dt * 7.0)) + 0.025 * log(1.0 + dt));
      float e = rr - R + A0.z * (0.07 * snoise(P / 20.0 + sd) + 0.025 * snoise(P / 6.0 + sd));
      if (B0.z > -0.5 && B0.z < 0.5) {
        // 葉子：兩頭尖的柳葉形（寬度照離中心的距離收窄），中間一條葉脈比較淡
        vec2 ql = rot2(-B0.y) * d;
        float hwl = B0.x * R * pow(max(0.0, 1.0 - pow(ql.x / max(R, 1.0), 2.0)), 0.8);
        e = max(abs(ql.x) - R, abs(ql.y) - hwl) + A0.z * 0.03 * snoise(P / 8.0 + sd);
        rr = abs(ql.y) / max(B0.x, 0.01);
      }
      float inside = smoothstep(1.2, -1.2, e);
      if (inside <= 0.0) continue;
      float wet = exp(-dt * 1.3);
      float core = clamp(rr / max(R, 1.0), 0.0, 1.0);
      float ringE = exp(-max(-e, 0.0) / (A0.z * 0.1 + 2.5));
      float den = inside * (0.4 + 0.3 * wet + 0.35 * gran * (1.0 - wet) + 0.12 * nzL) * (0.7 + 0.4 * core)
                + inside * ringE * 0.5 * (1.0 - wet);
      // 花心：晚一點點落一滴比較深的顏色（濕中濕）
      if (B0.z > 0.5) den += smoothstep(A0.z * 0.22, A0.z * 0.08, length(d) + 4.0 * snoise(P / 6.0 + sd)) * smoothstep(0.12, 0.5, dt) * 0.8;
      if (B0.z < -0.5) den *= 1.3;
      float k = B0.w;
      A += absorb(pigment(k), pap) * den * (k > 1.5 && k < 2.5 ? 0.55 : 1.0);
      wetAll = max(wetAll, wet * inside);
    }
    // ---- 留言的筆刷（一行一道）
    for (int i = 0; i < ${MAXS}; i++) {
      if (i >= nS) break;
      vec4 G = sG[i], Fz = sF[i];
      if (Fz.w <= 0.0) continue;
      float x0 = G.x, x1 = G.y, hw = G.w, front = Fz.x, seed = Fz.z;
      // 帶子的中心線：一點點起伏（手刷的）
      float yc = G.z + 8.0 * sin(P.x / 220.0 + seed) + 3.0 * sin(P.x / 80.0 + seed * 1.7);
      float dy = P.y - yc, ady = abs(dy);
      // 邊緣：大的起伏＋一點點小的（水彩的邊是圓順的，不是撕紙）
      float hwx = hw * (1.0 + 0.08 * snoise(vec2(P.x / 150.0, seed + (dy > 0.0 ? 5.0 : 0.0)))) + 4.0 * nzL + 1.0 * nz;
      if (ady > hwx + 16.0 || P.x < x0 - 50.0 || P.x > front + 30.0) continue;
      float u = ady / max(hw, 1.0);
      // 起筆是圓的（筆落下來）、前緣也是圓的（筆還在走）
      float startCap = smoothstep(-2.0, 3.0, P.x - (x0 + 26.0 * u * u) - 5.0 * nzL);
      float fx = front - 24.0 * u * u + 4.0 * nzL;
      float painted = smoothstep(fx + 2.0, fx - 2.0, P.x);
      float inBand = smoothstep(hwx + 2.0, hwx - 2.0, ady) * startCap;
      // 收筆的最後一段水不夠：沿著筆的方向拉出乾擦的飛白
      float along = clamp((P.x - x0) / max(x1 - x0, 1.0), 0.0, 1.0);
      float tail = smoothstep(0.82, 1.02, along);
      float streak = snoise(vec2(P.x / 80.0, P.y / 2.8) + seed * 3.0) * 0.5 + 0.5;
      float dry = smoothstep(0.2, 0.55, streak + 0.25 * gran + 1.0 - tail * 1.25);
      float cov = inBand * painted * dry * Fz.w;
      if (cov <= 0.0) continue;
      // 濕：前緣後面 220 px 還是濕的；整道刷完之後 0.7 秒內乾掉
      float wet = (1.0 - smoothstep(0.0, 220.0, front - P.x)) * (1.0 - smoothstep(0.0, 0.7, t - Fz.y));
      // 顏料：起筆最濃、往下沉（下緣濃一點）；顆粒沉在紙的凹處；乾了以後邊緣積色
      float edge = exp(-max(hwx - ady, 0.0) / 9.0) * inBand;
      float den = cov * (0.66 + 0.14 * nzL + 0.1 * snoise(P / 260.0 + seed) + 0.08 * nz + 0.28 * gran * (1.0 - wet) + 0.18 * (1.0 - along) + 0.14 * smoothstep(-hw, hw, dy))
                + cov * edge * 0.6 * (1.0 - 0.6 * wet);
      // 碰到留白膠刷不上去；膠的邊緣積一點色
      den *= 1.0 - 0.95 * res;
      den += cov * ring * 0.45 * (1.0 - wet);
      // 每一道的顏色：天空一樣的淡色（訊號色往亮的那一邊、加一點墨），跟花的濃色分開
      float hk = fract(seed * 0.618);
      vec3 pig = mix(mix(C_SIGNAL, C_BLOOD, 0.35 + 0.25 * hk), C_SEPIA, 0.12);
      A += absorb(pig, pap) * den;
      wetAll = max(wetAll, wet * cov);
      cover = max(cover, cov);
      // 前緣推著的水珠：一條深色的線
      bead = max(bead, exp(-pow((fx - P.x) / 6.0, 2.0)) * inBand * dry * step(front, x1 - 1.0) * Fz.w);
    }
    vec3 col = pap * exp(-max(A, vec3(0.0)));
    // 水珠與濕亮：濕的地方顏色深一點、有一點反光
    col *= 1.0 - 0.28 * bead - 0.08 * wetAll;
    col += C_BONE * (0.05 * wetAll * smoothstep(0.55, 0.8, gr.a) + 0.08 * bead * smoothstep(0.4, 0.7, snoise(P / 7.0)));
    // 還沒刷到的留白膠：淡淡的膜（有一點灰、左上一點反光）
    float film = res * (1.0 - cover);
    vec2 gm = vec2(maskAt(mA, rA, P + vec2(2.0, 0.0)).a - maskAt(mA, rA, P - vec2(2.0, 0.0)).a, maskAt(mA, rA, P + vec2(0.0, 2.0)).a - maskAt(mA, rA, P - vec2(0.0, 2.0)).a) * aA;
    col = mix(col, mix(pap, C_ASH, 0.55), 0.16 * film);
    col += C_BONE * 0.06 * clamp(-(gm.x + gm.y), 0.0, 1.0) * (1.0 - cover);
    // 刷過之後留白的字：紙白，邊上一圈很淡的膠
    col = mix(col, pap * 1.01, res * cover * 0.9);
    // 愛心不留白：刷過之後用點綴色（玫瑰）點上去；還沒刷到是淡淡的一顆
    float heart = smoothstep(0.3, 0.7, max(ma.r, mb.r));
    col *= exp(-absorb(C_ROSE, pap) * heart * (0.2 + 1.1 * cover));
    // 鉛筆（Canvas，紙面座標）：石墨只卡在紙的齒上
    vec4 Lp = fastLayer(texture(pen, pageUV(P)));
    float tooth = 0.45 + 0.55 * smoothstep(0.3, 0.68, gr.a);
    col = col * (1.0 - Lp.a * tooth) + Lp.rgb * tooth;
    // 一盞燈從左上打過來
    vec2 lp = (sp - vec2(560.0, 240.0)) / 1500.0;
    col *= 0.93 + 0.09 * exp(-dot(lp, lp) * 2.0);
    fragColor = vec4(col, 1.0);
  }`, {
  ...camUniforms(),
  grainTex: { value: null }, t: { value: 0 }, pen: { value: null },
  mA: { value: null }, rA: { value: new THREE.Vector4(0, 0, 1, 1) }, aA: { value: 0 },
  mB: { value: null }, rB: { value: new THREE.Vector4(0, 0, 1, 1) }, aB: { value: 0 },
  sG: { value: Array.from({ length: MAXS }, () => new THREE.Vector4()) },
  sF: { value: Array.from({ length: MAXS }, () => new THREE.Vector4()) },
  nS: { value: 0 },
  bA: { value: Array.from({ length: MAXB }, () => new THREE.Vector4()) },
  bB: { value: Array.from({ length: MAXB }, () => new THREE.Vector4(1, 0, 0, 0)) },
  nB: { value: 0 },
});

/** 一道筆刷：起訖 x、中心 y、半寬；t0～t1 從起點刷到終點（留言）或跟著歌聲（歌詞）。 */
interface Stroke { x0: number; x1: number; y: number; hw: number; t0: number; t1: number; seed: number }
/** 沒有留言時一句歌詞：留白膠的字模、一道筆刷、每個字的位置（筆刷跟著歌聲走）。 */
interface LineSet { line: Line; mask: GlyphMask; stroke: Stroke; words: { x: number; w: number; word: Word }[]; cy: number; sub: { line: Line; y: number; size: number } | null }
/** 一個暈開的色塊：中心、半徑、長寬比、角度、花瓣數（0 = 葉子、-1 = 顏料點）、顏色、時間。 */
interface Blob { x: number; y: number; r: number; asp: number; rot: number; pet: number; kind: number; t: number }
/** 一枝花莖：從綁口長到花（二次曲線），長到的時間。 */
interface Stem { cx: number; cy: number; x: number; y: number; t0: number; t1: number }

export default class Watercolor extends Scene {
  bg = shared('watercolor.bg', BG);
  /** 鉛筆（紙面座標）：草稿、花莖、緞帶、署名、歌詞，每格重畫。 */
  pen = this.track(new Layer2D(W, H, undefined, { fast: true }));
  cam = new PlaneCam();
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 71 + (this.msg?.id ?? 0) * 13) >>> 0;
  g!: Grid;
  block: Block | null = null;
  mask: GlyphMask | null = null;
  strokes: Stroke[] = [];
  lines: LineSet[] = [];
  blobs: Blob[] = [];
  stems: Stem[] = [];
  tRibbon = Infinity;
  /** 署名（鉛筆）開始寫的時間。 */
  tSig = Infinity;
  lyrSize = 44;
  lyrY = 860;
  hasLyrics = false;
  names = COUPLE_ZH.replace(/\s*&\s*/, ' ♥ ');
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    // 原文副行在 await 之前先拿：引擎只在呼叫 init 前設好這一格的開關，等字型的時候別的窗格可能改掉
    const subOf = new Map(lyrics.linesIn(s - 1, e).map((l) => [l, lyricSubOf(l)] as const));
    const hasSub = [...subOf.values()].some(Boolean);
    await loadAll(this.ctx, this.names);
    const g = (this.g = grid(au, s, e));
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
    const c = this.pen.ctx;
    // 留言的第一道落在第一個小節線（開場第一拍先畫花）；太遠就第二拍
    const tMsg = g.bar0 - g.b0 < g.beat * 0.5 ? au.timeOfBeat(au.beatAt(g.b0) + 1) : g.bar0;
    if (m) {
      const b = (this.block = block(c, m, FAM, MSG_BOX, { align: 'left', sigFamily: FAM_PEN, lineHeight: 1.42, maxLines: 5, v2: K, valign: 0.4 }));
      // 一個字一個字（♥ 換成我們自己的愛心）
      const glyphs: TGlyph[] = [], groups: TGroup[] = [];
      for (const ln of b.lines) groupLine(ln.text, ln.x, ln.y, FAM, b.fit.size, 99, 0, glyphs, groups);
      this.mask = this.track(glyphMask(glyphs, [], 2, 6, 40, 0, Math.max(1, b.fit.size * 0.018), true));
      // 一行一道：一拍一道（行多就半拍），每道刷 0.3～0.5 秒；最多花窗格的三成
      const ts = stagger(au, tMsg, b.lines.length, clamp((e - tMsg) * 0.3, g.beat, 3.5));
      const dur = clamp(g.beat * 0.8, 0.3, 0.5);
      b.lines.forEach((ln, i) => {
        const r = hash(this.seed, i);
        this.strokes.push({ x0: ln.x - 36 - 26 * r, x1: ln.x + ln.w + 40 + 30 * hash(this.seed, i, 2), y: ln.y - b.fit.size * 0.36, hw: b.fit.lineHeight * 0.56, t0: ts[i]!, t1: ts[i]! + dur, seed: 1 + 13.7 * hash(this.seed, i, 3) });
      });
      this.tSig = (ts[ts.length - 1] ?? tMsg) + dur + g.beat * 0.5;
      this.lyrSize = lyricV2(b.fit.size * K) / K;
      this.lyrY = b.box[1] + b.box[3] + 36 + this.lyrSize;
      this.avoid = [b.box, [MSG_BOX.x, this.lyrY - this.lyrSize - 10, MSG_BOX.w, this.lyrSize * 2.4]];
    } else if (this.hasLyrics) {
      // 沒有留言：兩行輪流，每一句一張留白膠的字模、一道筆刷（跟著歌聲走）
      const all = lyrics.lines;
      lyrics.linesIn(s - 1, e).forEach((line) => {
        const idx = all.indexOf(line);
        const lay = layoutRows(c, line, { family: FAM, size: V2.lyrMax / K, minSize: V2.lyrMin / K, maxW: MSG_BOX.w, maxRows: 2, align: 'left', lineHeight: 1.24 });
        // 原文副行：鉛筆小字寫在這一道筆刷正下方的紙上；中文＋原文一起置中在這一行，筆刷只刷中文
        const subLine = subOf.get(line) ?? null;
        let sub: LineSet['sub'] = null, hh = lay.height;
        if (subLine) {
          const sl = layoutLyric(c, subLine, subStyleFor({ family: FAM_PEN, size: lay.size, maxWidth: MSG_BOX.w, align: 'left' }, lay.size));
          // 筆刷比字多刷出去 0.2 個字高、邊緣又是毛的：原文再往下讓一點，才不會被顏料蓋到上緣
          const gap = (lay.rows.length - 1) * lay.lineHeight + subGap(lay.size, sl.size) + lay.size * 0.25;
          sub = { line: subLine, y: gap, size: lay.size };
          hh = lay.size + gap + (sl.height - sl.size);
        }
        const band = (hasSub ? BANDS_SUB : BANDS)[idx % 2]!;
        const cy = band - (hh - lay.height) / 2;
        const y0 = cy - lay.height / 2 + lay.size * 0.8;
        if (sub) sub.y += y0;
        const glyphs: TGlyph[] = [];
        const words = lay.words.map((pw) => {
          glyphs.push({ ch: pw.word.w, x: MSG_BOX.x + pw.x, y: y0 + pw.y, w: pw.w, size: lay.size, family: FAM, g: 0 });
          return { x: MSG_BOX.x + pw.x, w: pw.w, word: pw.word };
        });
        if (!glyphs.length) return;
        const mask = this.track(glyphMask(glyphs, [], 2, 6, 40, 0, Math.max(1, lay.size * 0.018), true));
        const x0 = Math.min(...words.map((w) => w.x)) - 40, x1 = Math.max(...words.map((w) => w.x + w.w)) + 46;
        const stroke = { x0, x1, y: cy, hw: Math.max(lay.height * 0.5 + lay.size * 0.2, lay.size * 0.66), t0: line.start - 0.3, t1: line.end, seed: 1 + 13.7 * hash(this.seed, idx, 3) };
        this.lines.push({ line, mask, stroke, words, cy, sub });
      });
      this.lyrY = 800;
      this.avoid = [hasSub ? [MSG_BOX.x - 20, 340, MSG_BOX.w + 40, 410] : [MSG_BOX.x - 20, 380, MSG_BOX.w + 40, 360]];
    } else {
      // 純音樂又沒有留言：一筆刷出新人的名字（60 px）
      const size = V2.msgMax / K;
      c.font = font(FAM, size);
      const w = c.measureText(this.names).width, x = MSG_BOX.x, y = 540;
      const glyphs: TGlyph[] = [], groups: TGroup[] = [];
      groupLine(this.names, x, y, FAM, size, 99, 0, glyphs, groups);
      this.mask = this.track(glyphMask(glyphs, [], 2, 6, 40, 0, 1.2, true));
      this.strokes.push({ x0: x - 50, x1: x + w + 60, y: y - size * 0.36, hw: size * 0.8, t0: tMsg, t1: tMsg + clamp(g.beat * 1.2, 0.4, 0.7), seed: 3.3 });
      this.lyrY = 660;
      this.avoid = [[x - 40, 460, w + 100, 120], [MSG_BOX.x, 600, 700, 80]];
    }
    this.buildBouquet();
  }

  /**
   * 花束（CPU 排好、放進 uniform）：綁口在 TIE，花頭排成一個往上的圓頂；每一拍開一朵（大的先開）、半拍一片葉子，
   * 花開完之後每一拍甩一兩滴顏料點，再下一個小節線綁緞帶。短窗格用 stagger 擠進去（一拍兩朵、四朵）。
   */
  private buildBouquet() {
    const au = this.ctx.audio, g = this.g, e = this.ctx.end;
    const rnd = mulberry32(this.seed * 5 + 11);
    const heads: Blob[] = [];
    // 圓頂：內圈 5 朵（大）、外圈 6 朵（小一點），外圈插在內圈的空隙；橫向壓扁一點（左邊留給留言）
    const ring = (n: number, r0: number, r1: number, s0: number, s1: number, a0: number, a1: number, off: number) => {
      for (let i = 0; i < n; i++) {
        const a = lerp(a0, a1, (i + off) / n) + (rnd() - 0.5) * 0.12;
        const rad = lerp(r0, r1, rnd());
        heads.push({ x: TIE.x + Math.cos(a) * rad * 0.8, y: TIE.y + Math.sin(a) * rad, r: lerp(s0, s1, rnd()), asp: lerp(0.78, 1, rnd()), rot: rnd() * 3, pet: 5 + Math.floor(rnd() * 3), kind: [0, 1, 3, 0, 1, 1][Math.floor(rnd() * 6)]!, t: 0 });
      }
    };
    ring(5, 300, 360, 95, 130, -2.55, -0.6, 0.5);
    ring(6, 470, 540, 70, 100, -2.6, -0.55, 0.5);
    const N = heads.length;
    // 大的先開
    const order = heads.slice().sort((a, b) => b.r - a.r);
    const leaves: Blob[] = [];
    for (let i = 0; i < 10; i++) {
      const h = heads[(i * 3 + 1) % N]!;
      const u = lerp(0.35, 0.62, rnd());
      const x = lerp(TIE.x, h.x, u) + (rnd() - 0.5) * 20, y = lerp(TIE.y, h.y, u);
      const dir = Math.atan2(h.y - TIE.y, h.x - TIE.x) + (i % 2 ? 0.8 : -0.8);
      leaves.push({ x: x + Math.cos(dir) * 44, y: y + Math.sin(dir) * 44, r: lerp(50, 74, rnd()), asp: 0.34, rot: dir, pet: 0, kind: 2, t: 0 });
    }
    // 時間：花一拍一朵、葉子在兩朵之間（stagger 讓短窗格也畫得完）
    const seq: Blob[] = [];
    for (let i = 0; i < Math.max(order.length, leaves.length); i++) { if (order[i]) seq.push(order[i]!); if (leaves[i]) seq.push(leaves[i]!); }
    const ts = stagger(au, g.b0, seq.length, clamp((e - g.b0) * 0.55, g.beat * 2, 9));
    seq.forEach((b, i) => { b.t = ts[i]!; });
    this.blobs.push(...seq);
    // 花莖：每一朵花一枝，從綁口開始長，花開的時候剛好長到
    for (const h of heads) {
      const mx = (TIE.x + h.x) / 2 + (h.x - TIE.x) * 0.1 + (rnd() - 0.5) * 40, my = (TIE.y + h.y) / 2 + 30;
      // 花莖停在花的邊緣（鉛筆層疊在顏料上面，伸進花裡會像一條線劃過花）
      const dx = TIE.x - h.x, dy = TIE.y - h.y, dl = Math.hypot(dx, dy) || 1;
      this.stems.push({ cx: mx, cy: my, x: h.x + (dx / dl) * h.r * 0.8, y: h.y + (dy / dl) * h.r * 0.8, t0: Math.max(this.ctx.start, h.t - g.beat * 1.5), t1: h.t });
    }
    // 花開完之後：一拍一兩滴顏料點（小鼓那一拍兩滴），落在花束周圍
    const tDone = ts[ts.length - 1]! + g.beat;
    for (let i = 0, k = 0; this.blobs.length < MAXB - 1 && k < 40; k++) {
      const tb = au.timeOfBeat(au.beatAt(tDone) + k);
      if (tb > e - 0.3) break;
      const n = k % 2 ? 2 : 1;
      for (let j = 0; j < n && this.blobs.length < MAXB; j++, i++) {
        const a = -Math.PI * (0.1 + 0.8 * rnd()), rad = lerp(380, 560, rnd());
        const x = TIE.x + Math.cos(a) * rad, y = TIE.y + Math.sin(a) * rad * 0.9;
        if (x > 1780 || x < 900) continue;
        this.blobs.push({ x, y, r: lerp(5, 11, rnd()), asp: 1, rot: 0, pet: -1, kind: Math.floor(rnd() * 2), t: tb + j * g.beat * 0.25 });
      }
    }
    this.tRibbon = au.timeOfBeat(Math.ceil(au.beatAt(tDone) - 1e-6));
  }

  /** 留言的筆刷前緣（outCubic：落筆很快、收筆慢下來）。 */
  private frontOf(s: Stroke, t: number) {
    return t < s.t0 ? -1e5 : s.x0 + (s.x1 - s.x0 + 50) * ease.outCubic(clamp((t - s.t0) / (s.t1 - s.t0)));
  }

  /** 歌詞的筆刷前緣：唱到哪刷到哪（第一個字之前 0.3 秒從起點刷到第一個字前面）。 */
  private lyricFront(ls: LineSet, t: number) {
    const s = ls.stroke, w0 = ls.words[0]!;
    if (t < s.t0) return -1e5;
    if (t < w0.word.start) return s.x0 + (w0.x - 6 - s.x0) * ease.outCubic(clamp((t - s.t0) / Math.max(0.05, w0.word.start - s.t0)));
    let x = w0.x;
    for (const w of ls.words) {
      if (t < w.word.start) break;
      x = w.x + w.w * Lyrics.wordProgress(w.word, t);
    }
    const last = ls.words[ls.words.length - 1]!;
    // 最後一個字唱完：把剩下的一段刷完
    if (t >= last.word.end) x = last.x + last.w + (s.x1 + 50 - last.x - last.w) * ease.outCubic(clamp((t - last.word.end) / 0.35));
    return x;
  }

  /** 現在這一句（沒有留言時）。 */
  private curLine(t: number) {
    let k = -1;
    for (let i = 0; i < this.lines.length; i++) if (this.lines[i]!.stroke.t0 <= t) k = i;
    return k;
  }

  /** 鏡頭：先看花（偏右），留言開始刷的時候焦點慢慢移到左邊；整段慢慢推近。 */
  private pose(t: number) {
    const s = this.ctx.start, e = this.ctx.end;
    const land = ease.outExpo(prog(t, s, s + Math.min(1.1, this.g.beat * 2.2)));
    const push = prog(t, s, e, ease.inOutQuad);
    const side = hash(this.seed, 5) < 0.5 ? -1 : 1;
    const t0 = this.strokes[0]?.t0 ?? this.lines[0]?.stroke.t0 ?? s + 1;
    const toText = ease.inOutCubic(prog(t, t0 - 0.3, t0 + 2));
    return {
      tx: lerp(1040, 930, toText), ty: 540 + 10 * (1 - land),
      dist: 1600 * (1.03 - 0.015 * land - 0.015 * push),
      pitch: 0.12 - 0.08 * land, yaw: side * (0.07 - 0.045 * land), roll: side * 0.01 * (1 - land), level: 0.8, focal: 1600,
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
    // 花束
    const BA = u.bA!.value as THREE.Vector4[], BB = u.bB!.value as THREE.Vector4[];
    this.blobs.forEach((b, i) => { BA[i]!.set(b.x, b.y, b.r, b.t); BB[i]!.set(b.asp, b.rot, b.pet, b.kind); });
    u.nB!.value = this.blobs.length;
    // 筆刷
    const SG = u.sG!.value as THREE.Vector4[], SF = u.sF!.value as THREE.Vector4[];
    let n = 0;
    const put = (st: Stroke, front: number, done: number, a = 1) => {
      if (n >= MAXS || a <= 0) return;
      SG[n]!.set(st.x0, st.x1, st.y, st.hw);
      SF[n]!.set(front, done, st.seed, a);
      n++;
    };
    const bindMask = (S: 'A' | 'B', m: GlyphMask | null, a: number) => {
      u[`a${S}`]!.value = m ? a : 0;
      if (!m) return;
      u[`m${S}`]!.value = m.tex;
      (u[`r${S}`]!.value as THREE.Vector4).set(...m.rect);
    };
    /** 要寫原文副行的句子與它的淡入淡出（跟著中文那一句）。 */
    let subs: [LineSet | null, number][] = [];
    if (this.lines.length) {
      // 兩行輪流：現在這一句 A、上一句 B；上一句在它那一行要換下一句之前 0.5 秒淡掉
      const k = this.curLine(t);
      const cur = this.lines[Math.max(0, k)]!, prev = k > 0 ? this.lines[k - 1]! : null;
      const next = this.lines[k + 1];
      const kb = next ? 1 - clamp((t - (next.stroke.t0 - 0.8)) / 0.5) : 1;
      bindMask('A', cur.mask, 1);
      bindMask('B', prev?.mask ?? null, kb);
      if (k >= 0) put(cur.stroke, this.lyricFront(cur, t), cur.line.end + 0.35);
      if (prev) put(prev.stroke, this.lyricFront(prev, t), prev.line.end + 0.35, kb);
      // 原文在筆刷刷過來的時候一起出現（筆刷提早 0.3 秒起筆）
      subs = [[cur, clamp((t - (cur.line.start - 0.35)) / 0.35)], [prev, kb]];
    } else {
      bindMask('A', this.mask, 1);
      bindMask('B', null, 0);
      for (const st of this.strokes) put(st, this.frontOf(st, t), st.t1);
    }
    u.nS!.value = n;

    // ---- 鉛筆
    const P = this.pen; P.clear();
    const c = P.ctx;
    const graphite = mixRgba('graphite', 'ink', 0.45, 0.95);
    this.drawBouquetPencil(c, t);
    if (this.msg && this.block) {
      const b = this.block;
      // 署名：一個字一個字寫上去
      const sg = Array.from(b.sig.text);
      const k = clamp((t - this.tSig) / clamp(0.08 * sg.length + 0.2, 0.4, 0.9));
      if (k > 0) {
        c.font = font(FAM_PEN, b.sig.size); c.fillStyle = graphite;
        c.save(); c.beginPath(); c.rect(b.sig.x - 10, b.sig.y - b.sig.size * 1.2, (b.sig.w + 20) * k, b.sig.size * 1.6); c.clip();
        c.fillText(b.sig.text, b.sig.x, b.sig.y);
        c.restore();
      }
      const ly = lyricAt(lyrics, t);
      if (ly) {
        const ink: KaraokeInk = { active: rgba('blood'), sung: graphite, unsung: rgba('graphite', 0.3) };
        const lay = layoutRows(c, ly.line, { family: FAM_PEN, size: this.lyrSize, minSize: V2.lyrMin / K, maxW: MSG_BOX.w, maxRows: 2, align: 'left' });
        c.save(); c.translate(MSG_BOX.x, this.lyrY);
        drawRows(c, lay, FAM_PEN, t, ink, ly.k);
        c.restore();
      } else if (!this.hasLyrics) {
        this.small(c, `♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`, MSG_BOX.x, this.lyrY - 20, F.mono(500), 18, 4);
      }
      if (this.msg.couple) this.small(c, 'FROM THE COUPLE  ·  新人', MSG_BOX.x, b.box[1] - 30, F.mono(500), 17, 5, rgba('blood', 0.8));
    } else {
      // 原文副行：鉛筆字（跟署名、邀請同一支筆），唱到的變深
      for (const [ls, k] of subs) {
        if (!ls?.sub || k <= 0) continue;
        c.save(); c.translate(MSG_BOX.x, ls.sub.y);
        drawLyricSub(c, ls.sub.line, t, { family: FAM_PEN, size: ls.sub.size, maxWidth: MSG_BOX.w, align: 'left', sung: graphite, unsung: rgba('graphite', 0.3) }, ls.sub.size, k);
        c.restore();
      }
      this.small(c, T21_INVITE, MSG_BOX.x, this.lyrY, F.hei(500), 22, 3, rgba('graphite', 0.75));
      if (!this.hasLyrics) this.small(c, `♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`, MSG_BOX.x, this.lyrY + 40, F.mono(500), 17, 4);
    }
    u.pen!.value = P.upload();
    this.bg.render(renderer, out);
    return {
      paper: 1, bloom: 0.2, vignette: 0.38, grain: 0.035,
      shake: [0, pulse(t, this.tRibbon, 0.07) * 2],
      popupAvoid: this.avoid.map((r) => this.cam.screenRect(r, 10)),
    };
  }

  /**
   * 花束的鉛筆：每一朵花開之前 0.4 秒，鉛筆先輕輕描一個草稿圈（之後留著淡淡的）；花莖從綁口一路長上去（淡綠的水彩筆線）；
   * 花都開完後的下一拍綁上緞帶（訊號色的兩個圈、兩條尾巴，一下子描出來）。
   */
  private drawBouquetPencil(c: CanvasRenderingContext2D, t: number) {
    c.save();
    c.lineCap = 'round'; c.lineJoin = 'round';
    // 草稿圈
    c.strokeStyle = rgba('graphite', 0.3); c.lineWidth = 1.3;
    for (const b of this.blobs) {
      if (b.pet <= 0) continue;
      const k = clamp((t - (b.t - 0.4)) / 0.3);
      if (k <= 0) continue;
      c.beginPath();
      c.ellipse(b.x + 3, b.y - 2, b.r * 0.92, b.r * 0.92 * b.asp, b.rot, 0.3, 0.3 + Math.PI * 2 * 0.92 * ease.outCubic(k));
      c.stroke();
    }
    // 花莖
    c.strokeStyle = mixRgba('sepia', 'signal', 0.2, 0.42); c.lineWidth = 3.5;
    for (const s of this.stems) {
      const k = ease.inOutCubic(clamp((t - s.t0) / Math.max(0.05, s.t1 - s.t0)));
      if (k <= 0) continue;
      c.beginPath(); c.moveTo(TIE.x, TIE.y);
      for (let i = 1; i <= 16; i++) {
        const u = (i / 16) * k, a = (1 - u) * (1 - u), bq = 2 * u * (1 - u), cq = u * u;
        c.lineTo(a * TIE.x + bq * s.cx + cq * s.x, a * TIE.y + bq * s.cy + cq * s.y);
      }
      c.stroke();
    }
    // 綁口以下的莖（短短一截，右下角 HUD 前面就停）
    const k0 = clamp((t - (this.stems[0]?.t0 ?? 0)) / 0.5);
    if (k0 > 0) for (let i = -2; i <= 2; i++) {
      c.beginPath(); c.moveTo(TIE.x + i * 5, TIE.y); c.lineTo(TIE.x + i * 7 + 8, TIE.y + 55 * k0); c.stroke();
    }
    // 緞帶
    const kr = clamp((t - (this.tRibbon - 0.05)) / 0.35);
    if (kr > 0) {
      c.strokeStyle = mixRgba('signal', 'blood', 0.35, 0.85); c.lineWidth = 3.5;
      for (const sd of [-1, 1]) {
        c.beginPath(); c.ellipse(TIE.x + sd * 26, TIE.y - 4, 26, 13, sd * 0.35, 0, Math.PI * 2 * ease.outCubic(kr)); c.stroke();
        c.beginPath(); c.moveTo(TIE.x, TIE.y); c.quadraticCurveTo(TIE.x + sd * 18, TIE.y + 30 * kr, TIE.x + sd * 30, TIE.y + 52 * kr); c.stroke();
      }
    }
    c.restore();
  }

  private small(c: CanvasRenderingContext2D, text: string, x: number, y: number, family: string, size: number, tracking: number, color = rgba('graphite', 0.7)) {
    c.font = font(family, size); c.letterSpacing = `${tracking}px`; c.fillStyle = color;
    c.fillText(text, x, y);
    c.letterSpacing = '0px';
  }
}
