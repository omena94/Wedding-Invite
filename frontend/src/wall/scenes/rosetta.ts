// 雙文石碑（暗，雙語）：博物館裡一塊深色花崗岩石碑，碑上刻著兩種文字——每一句都是上面中文、下面原文（逐行對照），
// 像用兩種語言立的碑。
//  - 一盞聚光燈從天花板打下來（看得到淡淡的光錐與光裡飄的灰），照著正在唱的那一組；唱到的字刻痕裡填上顏色
//    （正在唱的是訊號色、唱完的像描白的碑文），還沒唱的只是刻痕，靠光影看得出來。
//  - 每一句開頭，光從左到右掃過新的那一組（刻痕一個一個被照亮）；鏡頭沿著石碑慢慢往下搖，下一組移到光裡。
//  - 每個小節線一道側光斜斜掃過石面，刻痕的立體感浮出來一下。窗格一開始先看到碑頂的題字，最後一句唱完看得到立碑的日期與碑座。
//  - 沒有翻譯的歌只刻中文一行一行（每一組只有中文）；純音樂刻新人的名字與日期。
//  - 主打留言是右邊牆上的展品說明牌（留言標準 v2：說明牌約 600×430、宋體 40～60 px、署名手寫），一盞小燈照著；沒有留言時說明牌上是邀請。
// 畫法：一個 shader 畫牆、地板、石碑（花崗岩的顆粒、邊緣倒角、聚光燈與側光）；刻字是一張白色遮罩（每格照捲動的位置畫），
// shader 取樣三次做出「上緣暗、下緣亮」的刻痕；填色（跟唱）是另一張圖層；說明牌是 init 畫一次的圖層。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, makeRT } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, noise1 } from '../engine/util';
import { fitText } from '../engine/text';
import type { Line } from '../engine/lyrics';
import { lyricAt, drawLyric, layoutLyric, drawLyricSub, subStyleFor, subGap, lyricSubOf, COUPLE_EN, COUPLE_ZH, HAS_LATIN_NAMES, DATE, fitPx, type LyricLayout, type LyricStyle } from './_motifs';
import { INVITE_SMALL } from './_t19';
import { barsIn } from './_t1';
import { placeBlock, drawBlock, sigOf, fitV2 } from './_t22';
import { lyricV2, V2 } from './_v2';
import { mainOnly, preloadPair, hasSubIn, type Rect } from './_b4';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'lingo', paper: false, energy: [0, 0.7], bars: [4, 12], weight: 1 };

/** 石碑（左右邊、中線）；碑上的字最寬多少；聚光燈照的那一組在畫面上的中線 y。 */
const SX0 = 170, SX1 = 1090, SCX = (SX0 + SX1) / 2, TXW = 760, FOCUS_Y = 450;
/** 碑頂題字、第一組字從哪裡開始（石碑座標 v，碑頂 = 0）；每一組之間的距離。 */
const TITLE_V = 104, FIRST_V = 214, PAIR_GAP = 54;
/** 說明牌。 */
const LBL = { x: 1180, y: 250, w: 600, h: 430 };
const LM = { x: 1224, y: 360, w: 520, h: 280 };

const T_TITLE = '祝　福　碑';
const T_LBL = '展品 No.';
const T_LBL2 = '祝福碑　花崗岩　雙語銘文';
const T_FOOT = '＊本展品禁止觸摸，但歡迎祝福。';
const ZH_NUM = '〇一二三四五六七八九';
/**
 * 碑尾的落款：「二〇二七年五月二十日　立」。還沒定日期就落「全體賓客　敬立」——這是一塊祝福碑，
 * 碑文本來就是大家寫的，碑尾不會空著、也不會出現假的日期。
 */
const STELE_DATE = (() => {
  if (!DATE) return '全體賓客　敬立';
  const small = (n: number) => (n <= 10 ? (n === 10 ? '十' : ZH_NUM[n]!) : n < 20 ? `十${ZH_NUM[n % 10]}` : `${ZH_NUM[Math.floor(n / 10)]}十${n % 10 ? ZH_NUM[n % 10] : ''}`);
  return `${Array.from(DATE.yyyy).map((c) => ZH_NUM[Number(c)]).join('')}年${small(DATE.m)}月${small(DATE.d)}日　立`;
})();
/**
 * 純音樂時碑文的第二行（另一種文字）：英文名；沒有英文名時 COUPLE_EN 就是中文、跟上一行重複，改刻一句通用的英文，
 * 「兩種文字的碑」照樣成立。
 */
const STELE_EN = HAS_LATIN_NAMES ? COUPLE_EN : 'JUST MARRIED';
/** 純音樂碑文的字級：名字可能很長，放不下碑面就縮（刻痕遮罩與填色兩張圖要用同一個字級）。 */
const steleZhPx = () => fitPx(COUPLE_ZH, F.ming(900), 56, TXW, 14);
const steleEnPx = () => fitPx(STELE_EN, F.serif(600, true), 40, TXW, 4);

// ---------------------------------------------------------------- 花崗岩的雜訊（整晚只烤一次）
/** 烤的範圍：石碑座標 x 從 BKX 起 BKW 寬、y 從 0 到 BKH（更長的碑文就重複）。 */
const BKX = SX0 - 40, BKW = SX1 - SX0 + 80, BKH = 3072;
const BAKE_FRAG = /* glsl */ `
  void main() {
    vec2 q = vec2(${BKX}.0 + vUv.x * ${BKW}.0, (1.0 - vUv.y) * ${BKH}.0);
    float g = fbm(q / 220.0, 3);
    float gr = snoise(q * 0.45) * 0.6 + snoise(q * 1.1) * 0.4;
    float sp = smoothstep(0.55, 0.9, snoise(q * 0.8 + 3.0));
    float edge = 2.0 * snoise(q * 0.012) + 0.8 * snoise(q * 0.05);
    fragColor = vec4(sat(g * 0.5 + 0.5), sat(gr * 0.5 + 0.5), sp, sat(edge / 6.0 + 0.5));
  }`;
const granite: { rt: THREE.WebGLRenderTarget | null } = { rt: null };
function graniteBake(renderer: THREE.WebGLRenderer): THREE.Texture {
  if (!granite.rt) {
    granite.rt = makeRT(BKW, BKH, { pxScale: 1, type: THREE.UnsignedByteType, depthBuffer: false });
    const p = new FSPass(BAKE_FRAG);
    p.render(renderer, granite.rt);
    renderer.setRenderTarget(null);
    p.dispose();
  }
  return granite.rt.texture;
}

// ---------------------------------------------------------------- 牆、地板、石碑（整晚共用）
const PASS = () => new FSPass(/* glsl */ `
  uniform sampler2D mask; uniform sampler2D fill; uniform sampler2D bake;
  uniform float scroll; uniform float vEnd; uniform vec4 spot; uniform float spotK; uniform float scan;
  uniform vec2 rake; uniform float lamp; uniform float t;
  const float SX0 = ${SX0}.0, SX1 = ${SX1}.0, SCX = ${SCX}.0;
  float rbox(vec2 q, vec2 hs, float r) { vec2 d = abs(q) - hs + r; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }
  // 刻字與填色的圖層只蓋石碑那一條（省清除與上傳的時間）
  vec2 stUV(vec2 p) { return vec2((p.x - SX0) / ${SX1 - SX0}.0, 1.0 - p.y / ${H}.0); }
  float m(vec2 p) { return fastLayer(textureLod(mask, stUV(p), 0.0)).a; }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 q = vec2(p.x, p.y + scroll);               // 石碑座標（v 往下）
    // ---- 聚光燈（橢圓、邊很柔）：照著正在唱的那一組；新的一句開頭光從左往右掃
    float sp = 1.0 - smoothstep(0.62, 1.12, length((p - spot.xy) / spot.zw));
    sp *= mix(1.0, 0.35 + 0.65 * smoothstep(scan + 60.0, scan - 60.0, p.x), step(0.0, scan));
    sp *= spotK;
    float wash = 0.16 + 0.1 * exp(-pow((p.y - 200.0) / 700.0, 2.0));
    // ---- 牆：很暗的直條壁板，聚光燈的溢光、說明牌的小燈
    vec3 col = C_INK * 0.72 + C_INK2 * 0.18;
    float panel = abs(fract((p.x + 60.0) / 320.0) - 0.5);
    col *= 1.0 - 0.18 * smoothstep(0.49, 0.5, panel);
    col += mix(C_BONE, C_EMBER, 0.4) * 0.06 * exp(-pow(length((p - spot.xy) / vec2(900.0, 500.0)), 2.0)) * spotK;
    col += mix(C_BONE, C_EMBER, 0.35) * 0.1 * lamp * exp(-pow(length((p - vec2(${LBL.x + LBL.w / 2}.0, ${LBL.y + LBL.h / 2}.0)) / vec2(520.0, 360.0)), 2.0));
    // 地板（碑座底下）：深色、亮面，一點聚光燈的反光
    float floorY = vEnd + 96.0 - scroll;
    if (p.y > floorY) {
      col = C_INK * 0.55 + C_INK2 * 0.2;
      col += mix(C_BONE, C_EMBER, 0.4) * 0.05 * exp(-pow((p.x - SCX) / 600.0, 2.0)) * exp(-(p.y - floorY) / 60.0);
    }
    // ---- 石碑本體與碑座
    // 花崗岩的雜訊整晚只烤一次（bake），這裡查表：r = 大塊的明暗、g = 細顆粒、b = 亮晶粒、a = 邊緣的起伏
    vec4 bk = textureLod(bake, vec2((q.x - ${BKX}.0) / ${BKW}.0, 1.0 - mod(q.y, ${BKH}.0) / ${BKH}.0), 0.0);
    float g = bk.r * 2.0 - 1.0, gr = bk.g * 2.0 - 1.0;
    float sd = rbox(q - vec2(SCX, vEnd * 0.5), vec2((SX1 - SX0) * 0.5, vEnd * 0.5), 80.0) + (bk.a - 0.5) * 6.0;
    float base = rbox(q - vec2(SCX, vEnd + 48.0), vec2((SX1 - SX0) * 0.5 + 54.0, 48.0), 6.0);
    // 碑上的光：環境＋上面的洗牆燈＋聚光燈＋小節線的側光（從左邊斜斜打過來）
    float L = wash + 1.15 * sp;
    if (base < 0.0 && sd > 0.0) {
      vec3 st = mix(C_INK2, C_GRAPHITE, 0.2 + 0.1 * g) * (0.9 + 0.1 * gr);
      st *= 1.0 + 0.4 * smoothstep(-5.0, -1.0, base) * step(q.y, vEnd + 8.0);
      col = mix(col, st * (L * 0.8 + 0.1), 1.0 - smoothstep(-0.8, 0.8, base));
    }
    if (sd < 1.0) {
      vec3 st = mix(C_INK2, C_GRAPHITE, 0.24 + 0.14 * g) * (0.86 + 0.12 * gr);
      st += C_BONE * 0.06 * bk.b;   // 石頭裡的亮晶粒
      // 邊緣倒角：左上亮、右下暗
      float bev = smoothstep(-16.0, -2.0, sd);
      vec2 nrm = normalize(vec2(dFdx(sd), dFdy(sd)) + 1e-5);
      st *= 1.0 + bev * (0.45 * max(0.0, dot(nrm, vec2(-0.6, -0.8))) - 0.35 * max(0.0, dot(nrm, vec2(0.6, 0.8))));
      // 小節線的側光：一道斜斜的光從左掃到右（rake.x = 強度、rake.y = 光帶的位置）
      float rk = rake.x * exp(-pow((p.x - rake.y + (p.y - 540.0) * 0.35) / 240.0, 2.0));
      float Ls = L + 0.45 * rk;
      vec3 c = st * Ls;
      // ---- 刻字：凹下去的字，上緣在陰影裡、下緣接到光（側光時左緣也亮）
      float m0 = m(p);
      if (m0 > 0.001) {
        float mu = m(p - vec2(0.0, 2.4)), md = m(p + vec2(0.0, 2.4)), ml = m(p - vec2(2.4, 0.0));
        c *= 1.0 - 0.55 * m0;
        c *= 1.0 - 0.5 * m0 * (1.0 - mu);
        c += mix(C_BONE, C_EMBER, 0.2) * m0 * (1.0 - md) * (0.1 + 0.5 * Ls);
        c += C_BONE * m0 * (1.0 - ml) * rk * 0.6;
        vec4 f = fastLayer(textureLod(fill, stUV(p), 0.0));
        // 刻痕裡的填色：受光影響（光外暗一點），但一直讀得到
        c = c * (1.0 - f.a) + f.rgb * (0.12 + 0.9 * min(1.2, Ls));
      }
      col = mix(col, c, 1.0 - smoothstep(-0.8, 0.8, sd));
    }
    // ---- 光錐：從天花板的燈打到聚光的地方（很淡），裡面有灰塵慢慢飄
    vec2 A = vec2(SCX - 140.0, -300.0), Bp = spot.xy;
    vec2 ab = Bp - A; float h = clamp(dot(p - A, ab) / dot(ab, ab), 0.0, 1.0);
    float d = length(p - A - ab * h), w = 30.0 + h * spot.z * 0.9;
    float cone = exp(-pow(d / w, 2.0)) * smoothstep(0.0, 0.3, h) * spotK;
    col += mix(C_BONE, C_EMBER, 0.4) * 0.035 * cone;
    vec2 cell = floor((p + vec2(t * 6.0, t * 14.0)) / 46.0);
    vec2 r = hash22(cell);
    vec2 mp = (cell + 0.2 + 0.6 * r) * 46.0 - vec2(t * 6.0, t * 14.0);
    float mote = smoothstep(2.2, 0.4, length(p - mp)) * step(0.72, hash12(cell + 7.0));
    col += C_BONE * 0.35 * mote * cone;
    fragColor = vec4(col, 1.0);
  }`, {
  mask: { value: null }, fill: { value: null }, bake: { value: null }, scroll: { value: 0 }, vEnd: { value: 1200 }, spot: { value: new THREE.Vector4(SCX, FOCUS_Y, 470, 110) },
  spotK: { value: 0 }, scan: { value: -1 }, rake: { value: new THREE.Vector2(0, -999) }, lamp: { value: 0 }, t: { value: 0 },
});

/** 碑上的一組字：中文與原文的排版、在石碑上的位置（v，第一排基線）。 */
interface Pair { line: Line; main: LyricLayout; sub: LyricLayout | null; mainV: number; subV: number; top: number; bot: number }

export default class Rosetta extends Scene {
  pass = shared('rosetta.pass', PASS);
  /** 刻字的遮罩（白字；每格照捲動的位置畫）。 */
  mask = this.track(new Layer2D(SX1 - SX0, H, undefined, { fast: true }));
  /** 刻痕裡的填色（跟唱；每格畫）。 */
  fillL = this.track(new Layer2D(SX1 - SX0, H, undefined, { fast: true }));
  /** 遮罩上次畫的捲動量（遮罩只跟捲動量有關：沒變就不重畫、不上傳）。 */
  private maskSc = NaN;
  /** 說明牌（畫一次）。 */
  props = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  bilingual = false;
  pairs: Pair[] = [];
  vEnd = 1100;
  maxScroll = 0;
  bars: number[] = [];
  tLight = 0;
  st: LyricStyle = { family: F.ming(700), size: V2.lyrMax, minSize: V2.lyrMin, maxWidth: TXW, align: 'center', lineHeight: 1.16, active: rgba('signal'), sung: rgba('bone', 0.9), unsung: 'rgba(0,0,0,0)' };
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, start: s, end: e, lyrics, live } = this.ctx;
    const m = this.msg;
    await preloadPair(this.ctx, `${m ? m.text + sigOf(m) : ''}${INVITE_SMALL}${T_TITLE}${T_LBL}${T_LBL2}${T_FOOT}${STELE_DATE}${COUPLE_ZH}${STELE_EN}FROM THE COUPLE · 新人0123456789${live.count}`);
    this.bilingual = hasSubIn(this.ctx);
    this.bars = barsIn(au, s, e);
    this.tLight = s + Math.min(0.5, au.beatPeriod(s) * 0.9);
    this.drawLabel();
    // ---- 碑文的排版：每一句一組（中文、下面原文），從碑頂往下排
    const c = this.mask.ctx;
    let v = FIRST_V;
    for (const line of lyrics.linesIn(s - 0.3, e + 0.3)) {
      const main = layoutLyric(c, mainOnly(line), this.st);
      const lh = main.size * (this.st.lineHeight ?? 1.18);
      const mainV = v + main.size * 0.88;
      const subLine = this.bilingual ? lyricSubOf(line) : null;
      let sub: LyricLayout | null = null, subV = mainV, bot = mainV + (main.rows.length - 1) * lh + main.size * 0.2;
      if (subLine) {
        sub = layoutLyric(c, subLine, subStyleFor(this.st, main.size));
        subV = mainV + (main.rows.length - 1) * lh + subGap(main.size, sub.size);
        bot = subV + (sub.rows.length - 1) * sub.size * 1.18 + sub.size * 0.25;
      }
      this.pairs.push({ line, main, sub, mainV, subV, top: v, bot });
      v = bot + PAIR_GAP;
    }
    this.vEnd = Math.max(FOCUS_Y + 520, v + 110);
    this.maxScroll = Math.max(0, this.vEnd + 96 - 1030);
    this.avoid = [[SX0, 120, SX1 - SX0, 660], [LBL.x, LBL.y, LBL.w, LBL.h]];
  }

  /** 說明牌：淺色的牌子、細框；展品編號、冷面小字、留言（宋體）、署名（手寫）。 */
  private drawLabel() {
    const L = this.props, c = L.ctx, m = this.msg;
    L.clear();
    c.textBaseline = 'alphabetic';
    c.fillStyle = rgba('ink', 0.5); c.fillRect(LBL.x + 10, LBL.y + 14, LBL.w, LBL.h);
    const g = c.createLinearGradient(LBL.x, LBL.y, LBL.x + LBL.w * 0.4, LBL.y + LBL.h);
    g.addColorStop(0, mixRgba('paper', 'bone', 0.25)); g.addColorStop(1, mixRgba('paper', 'sepia', 0.16));
    c.fillStyle = g; c.fillRect(LBL.x, LBL.y, LBL.w, LBL.h);
    c.strokeStyle = rgba('sepia', 0.3); c.lineWidth = 1; c.strokeRect(LBL.x + 14, LBL.y + 14, LBL.w - 28, LBL.h - 28);
    c.font = font(F.mono(500), 15); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.7);
    c.fillText(m?.couple ? 'FROM THE COUPLE · 新人' : `${T_LBL}${String(m?.n ?? this.ctx.live.count).padStart(3, '0')}`, LM.x, LBL.y + 58);
    c.font = font(F.hei(500), 15); c.fillStyle = rgba('sepia', 0.55);
    c.fillText(T_LBL2, LM.x, LBL.y + 84);
    c.letterSpacing = '0px';
    c.fillStyle = rgba('sepia', 0.25); c.fillRect(LM.x, LBL.y + 100, LM.w, 1);
    if (m) {
      const fam = F.ming(700), sfam = F.hand(700), sig = sigOf(m);
      const blk = fitV2(c, m.text, fam, LM.w, LM.h, 1, { lineHeight: 1.3 });
      const top = LM.y + Math.max(0, (LM.h - blk.height) * 0.35);
      const pl = placeBlock(c, blk, fam, sig, LM.x, top, { sigFamily: sfam });
      drawBlock(c, blk, pl, fam, sig, { color: rgba('sepia', 0.95), sigColor: rgba('sepia', 0.75), sigFamily: sfam });
      this.st = { ...this.st, size: lyricV2(blk.fit.size) };
    } else {
      c.fillStyle = rgba('sepia', 0.85);
      const fit = fitText(c, INVITE_SMALL, F.ming(700), LM.w, 130, { min: 30, max: 40, maxLines: 2 });
      c.font = font(F.ming(700), fit.size);
      fit.lines.forEach((ln, i) => c.fillText(ln, LM.x, LM.y + 70 + i * fit.lineHeight));
    }
    c.font = font(F.hei(500), 15); c.fillStyle = rgba('sepia', 0.5);
    c.fillText(T_FOOT, LM.x, LBL.y + LBL.h - 36);
    L.upload();
  }

  /** 這一格的捲動量：每一句開頭前一點開始，鏡頭往下搖到那一組在聚光燈裡。 */
  private scrollAt(t: number) {
    const tgt = (p: Pair) => clamp((p.top + p.bot) / 2 - FOCUS_Y, 0, this.maxScroll);
    if (!this.pairs.length) return 0;
    let sc = 0;
    this.pairs.forEach((p, i) => {
      const prev = i === 0 ? 0 : tgt(this.pairs[i - 1]!);
      sc += (tgt(p) - prev) * ease.inOutCubic(clamp((t - (p.line.start - 0.75)) / 0.9));
    });
    // 最後一句唱完，再往下搖一點看到立碑日期與碑座
    const last = this.pairs[this.pairs.length - 1]!;
    sc += (this.maxScroll - tgt(last)) * ease.inOutCubic(clamp((t - last.line.end - 0.4) / 1.4));
    return sc;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, song } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const sc = this.scrollAt(t);

    // ---- 刻字遮罩（只跟捲動量有關）與填色（只畫畫面裡的那幾組）；兩張圖層只蓋石碑那一條，座標平移 SX0
    const M = this.mask, mc = M.ctx, FL = this.fillL, fc = FL.ctx;
    const ly = lyricAt(lyrics, t, 1.6);
    const vis = this.pairs.filter((p) => p.bot - sc > -40 && p.top - sc < H + 40);
    const cur = ly ? vis.find((p) => p.line === ly.line) ?? null : null;
    const dv = (this.pairs.length ? this.pairs[this.pairs.length - 1]!.bot + 70 : FIRST_V + 190) - sc;
    if (sc !== this.maskSc) {
      this.maskSc = sc;
      M.clear();
      mc.save(); mc.translate(-SX0, 0);
      mc.fillStyle = '#fff'; mc.textBaseline = 'alphabetic'; mc.textAlign = 'center';
      // 碑頂題字與花邊
      const ty = TITLE_V - sc;
      if (ty > -60) {
        mc.font = font(F.ming(900), 34); mc.letterSpacing = '10px'; mc.fillText(T_TITLE, SCX + 5, ty); mc.letterSpacing = '0px';
        mc.fillRect(SCX - 300, ty + 30, 600, 2.5); mc.fillRect(SCX - 300, ty + 38, 600, 1.2);
      }
      for (const p of vis) {
        mc.font = font(this.st.family, p.main.size);
        for (const r of p.main.rows) mc.fillText(r.text, SCX, p.mainV - sc + r.y);
        if (p.sub) { mc.font = font(this.st.family, p.sub.size); for (const r of p.sub.rows) mc.fillText(r.text, SCX, p.subV - sc + r.y); }
      }
      // 純音樂：碑文是新人的名字；碑尾是立碑日期
      if (!lyrics.has) {
        const zp = steleZhPx(), ep = steleEnPx();
        mc.font = font(F.ming(900), zp); mc.letterSpacing = `${(14 * zp) / 56}px`; mc.fillText(COUPLE_ZH, SCX + (7 * zp) / 56, FIRST_V + 90 - sc);
        mc.font = font(F.serif(600, true), ep); mc.letterSpacing = `${(4 * ep) / 40}px`; mc.fillText(STELE_EN, SCX + (2 * ep) / 40, FIRST_V + 160 - sc); mc.letterSpacing = '0px';
      }
      if (dv < H + 40) { mc.font = font(F.ming(700), 26); mc.letterSpacing = '6px'; mc.fillText(STELE_DATE, SCX + 3, dv + 24); mc.letterSpacing = '0px'; }
      mc.restore();
      M.upload();
    }
    FL.clear();
    fc.save(); fc.translate(-SX0, 0);
    fc.textBaseline = 'alphabetic';
    for (const p of vis) {
      if (t < p.line.start - 0.05 && p !== cur) continue;
      const subLine = this.bilingual ? lyricSubOf(p.line) : null;
      if (p === cur) {
        // 正在唱的那一組：逐字跟唱（唱完的像描白的碑文，正在唱的是訊號色）；還沒唱到的字填實心的中灰（像刻痕裡的陰影），
        // 聚光燈下只有空心刻痕反而最難讀，賓客要能先讀到整句
        const st = { ...this.st, unsung: rgba('ash', 0.7) };
        fc.save(); fc.translate(SCX, p.mainV - sc); drawLyric(fc, mainOnly(p.line), t, st, p.main, 1); fc.restore();
        if (subLine && p.sub) { fc.save(); fc.translate(SCX, p.subV - sc); drawLyricSub(fc, subLine, t, st, p.main.size, 1); fc.restore(); }
      } else if (t > p.line.end) {
        // 已經唱過、離開聚光燈的那幾組：整行描白、淡一點（整行一次畫，不用逐字）
        fc.textAlign = 'center'; fc.fillStyle = this.st.sung!;
        fc.globalAlpha = 0.55; fc.font = font(this.st.family, p.main.size);
        for (const r of p.main.rows) fc.fillText(r.text, SCX, p.mainV - sc + r.y);
        if (p.sub) { fc.globalAlpha = 0.44; fc.font = font(this.st.family, p.sub.size); for (const r of p.sub.rows) fc.fillText(r.text, SCX, p.subV - sc + r.y); }
        fc.globalAlpha = 1; fc.textAlign = 'left';
      }
    }
    if (!lyrics.has) {
      const zp = steleZhPx();
      fc.textAlign = 'center'; fc.font = font(F.ming(900), zp); fc.letterSpacing = `${(14 * zp) / 56}px`; fc.fillStyle = rgba('bone', 0.85 * prog(t, s + 0.4, s + 1.4));
      fc.fillText(COUPLE_ZH, SCX + (7 * zp) / 56, FIRST_V + 90 - sc); fc.letterSpacing = '0px';
      fc.font = font(F.mono(500), 18); fc.fillStyle = rgba('bone', 0.5 * prog(t, s + 0.8, s + 1.8)); fc.letterSpacing = '4px';
      fc.fillText(`♪  ${song.title}`, SCX, FIRST_V + 230 - sc); fc.letterSpacing = '0px'; fc.textAlign = 'left';
    }
    fc.restore();
    FL.upload();

    // ---- 聚光燈：照著正在唱的那一組（沒有在唱就留在上一組、暗一點）；新的一句開頭光從左往右掃
    const on = ease.outCubic(clamp((t - this.tLight) / 0.6));
    const target = cur ?? this.pairs.find((p) => p.line.start > t) ?? null;
    const sy = target ? ((target.top + target.bot) / 2 - sc) : FOCUS_Y;
    const sh = target ? (target.bot - target.top) / 2 + 60 : 180;
    let scan = -1;
    if (cur) { const k = (t - (cur.line.start - 0.3)) / 0.55; if (k >= 0 && k < 1) scan = lerp(SX0 - 80, SX1 + 80, ease.inOutQuad(k)); }
    let rake = 0, rakeX = -999;
    for (const b of this.bars) if (t >= b && t < b + 1.1) { const k = (t - b) / 1.1; rake = Math.sin(Math.PI * k); rakeX = lerp(SX0 - 300, SX1 + 300, ease.inOutQuad(k)); }
    const P = this.pass;
    P.u.mask!.value = M.texture;
    P.u.fill!.value = FL.texture;
    P.u.bake!.value = graniteBake(renderer);
    P.u.scroll!.value = sc;
    P.u.vEnd!.value = this.vEnd;
    (P.u.spot!.value as THREE.Vector4).set(SCX, sy, 500, sh);
    P.u.spotK!.value = on * (cur ? 1 : 0.7) * (1 + 0.03 * noise1(t * 0.8, 4));
    P.u.scan!.value = scan;
    (P.u.rake!.value as THREE.Vector2).set(rake, rakeX);
    P.u.lamp!.value = ease.outCubic(clamp((t - this.tLight - 0.3) / 0.6));
    P.u.t!.value = t;
    P.render(renderer, out);
    comp.draw(renderer, this.props.texture, out, { opacity: 0.35 + 0.65 * (P.u.lamp!.value as number) });

    const push = ease.inOutQuad(prog(t, s, e));
    return { bloom: 0.55, bloomThreshold: 1.0, halation: 0.1, vignette: 0.45, grain: 0.06, zoom: 1 + 0.025 * push, popupAvoid: this.avoid };
  }
}
