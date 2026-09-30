// 誓詞（亮）：一張奶油色的誓詞頁，隔著新娘的頭紗看過去。
//  - 開場：整個畫面在頭紗後面——細細的六角網眼、布的皺褶、邊上一圈蕾絲；後面的字是柔的、霧霧的。
//  - 第一個小節線（窗格短就第一拍）：頭紗被「撥開」（婚禮上掀頭紗的那一下）：中間先走、上下跟著，撥到畫面左邊，
//    從左上斜斜地垂下來（新娘在畫面外的左上方），一直在飄；每個小節線一陣風把它吹得鼓起來、蕾絲的影子掃過紙面。
//  - 紙的中間是「誓詞」：歌詞一句一句浮現（Cormorant／思源宋體），正在唱的字是訊號色；上一句留著、淡淡的往上退。
//  - 右邊是「見證人」：頭紗撥開之後，主打留言一行一行像墨水寫上去（手寫字），最後簽上署名——賓客是這場婚禮的見證人。
//    留言照留言標準 v2：40～60 px、那一塊 ≤ 740×380。
//  - 冷面註腳：本誓詞由 N 位見證人共同見證（N = 現在的留言數）。
//  - 沒有留言：誓詞（歌詞）放大到中間當主角，見證人欄留一條空白的簽名線與邀請。
// 畫法：紙與字是兩張圖層（留言那張畫一次、歌詞那張每格畫），一個 shader 畫紙、取樣圖層，頭紗蓋住的地方
// 把後面的紙模糊、罩一層霧，再畫網眼、皺褶、蕾絲；紙上有頭紗與蕾絲花紋的影子；留言「寫上去」是 shader 裡每一行一個遮罩。
// 鏡頭慢慢推近，頭紗在前景、動得比紙多（視差）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, lerp, noise1 } from '../engine/util';
import { fitText } from '../engine/text';
import type { Line } from '../engine/lyrics';
import { drawLyric, layoutLyric, lyricAt, beatAfter, lyricSubOf, subSizeFor, subStyleFor, subGap, type LyricStyle, type LyricLayout } from './_motifs';
import { preloadText, INVITE_SMALL, paperSignal } from './_t19';
import { ensureBake, barsIn, sigInk } from './_t1';
import { placeBlock, drawBlock, sigOf, fitV2, T22_TEXT, type Rect } from './_t22';
import { lyricV2, V2 } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'keepsake', paper: true, energy: [0, 0.6], bars: [4, 12], weight: 1 };

/**
 * 左欄（誓詞＝歌詞）與右欄（見證人＝留言）。留言標準 v2：見證人那一塊 ≤ 740×380、字 40～60 px；
 * 頭紗掀開之後不離開畫面，被撥到左邊垂著（前景、一直在飄），紙往右讓出位置。
 */
const VOW = { x: 500, w: 500, y: 600 };
const WIT = { x: 1075, y: 330, w: 740, h: 380 };
const RULE_X = 1035;
const LABEL_Y = 262;
/** 頭紗撥到左邊之後，蕾絲邊在畫面中間高度停在哪裡（螢幕 x）；SLOPE：往上每 1 px 邊往右多少（從左上斜斜垂下來）。 */
const REST = 390;
const SLOPE = 0.26;
/** 「寫上去」的遮罩最多幾塊（留言最多 5 行＋署名）。 */
const NREV = 7;
const ROMAN = ['i.', 'ii.', 'iii.', 'iv.', 'v.', 'vi.', 'vii.', 'viii.', 'ix.', 'x.', 'xi.', 'xii.'];

const PASS = () => new FSPass(/* glsl */ `
  uniform sampler2D page; uniform sampler2D lyr; uniform sampler2D bake;
  uniform float hem; uniform float arch; uniform float sway; uniform float gust; uniform float billow;
  uniform vec2 dPage; uniform vec2 dVeil;
  // 留言一行一行寫上去：每一行的範圍（x、y、寬、高，螢幕 px）與寫到哪裡（0..1）
  uniform vec4 revR[${NREV}]; uniform float revK[${NREV}]; uniform float revN;
  float revealAt(vec2 p) {
    for (int i = 0; i < ${NREV}; i++) {
      if (float(i) >= revN) break;
      vec4 r = revR[i];
      if (p.y >= r.y && p.y < r.y + r.w) {
        // 墨水從左往右寫：邊緣柔柔的（像筆尖剛走過、墨還在滲）
        float ex = r.x - 20.0 + (r.z + 40.0) * revK[i];
        return 1.0 - smoothstep(ex - 18.0, ex + 6.0, p.x);
      }
    }
    return 1.0;
  }
  // 紙：奶油色、左上一點窗光、紙纖維
  vec3 paperAt(vec2 p) {
    vec4 bk = textureLod(bake, vec2(p.x / ${W}.0, 1.0 - p.y / ${H}.0), 0.0);
    vec3 c = mix(C_PAPER, C_BONE, 0.12) * (0.93 + 0.08 * bk.g) * (0.97 + 0.05 * bk.r);
    c *= 0.9 + 0.12 * exp(-pow(length((p - vec2(300.0, 150.0)) / vec2(1500.0, 1100.0)), 2.0));
    // 窗光：斜斜落在紙上的兩格窗（很柔、很淡，跟著 sway 很慢地移）
    vec2 w = rot2(-0.42) * (p - vec2(1420.0 + 40.0 * sin(sway * 0.2), 250.0));
    float pane = smoothstep(260.0, 200.0, abs(w.x)) * smoothstep(420.0, 330.0, abs(w.y));
    float mull = smoothstep(6.0, 22.0, abs(w.x)) * smoothstep(6.0, 22.0, abs(w.y));
    c *= 1.0 + 0.045 * pane * mull;
    return c;
  }
  vec3 pageAt(vec2 p) {
    vec2 uv = vec2(p.x / ${W}.0, 1.0 - p.y / ${H}.0);
    vec4 a = fastLayer(textureLod(page, uv, 0.0)) * revealAt(p);
    vec4 b = fastLayer(textureLod(lyr, uv, 0.0));
    vec3 c = paperAt(p);
    c = c * (1.0 - a.a) + a.rgb;
    return c * (1.0 - b.a) + b.rgb;
  }
  // 頭紗的邊（螢幕 x，隨 y 變）：從左上斜斜垂下來（越上面越往右）；撥開的時候中間先走；
  // 平常輕輕地波動，小節線一陣風把中段吹得往右鼓起來（billow），再慢慢垂回去
  float edgeX(float y) {
    float v = (y - 540.0) / 760.0;
    return hem + ${SLOPE} * (540.0 - y) - arch * (1.0 - v * v) + billow * (1.0 - v * v)
      + (12.0 + 26.0 * gust) * sin(y * 0.0055 + sway) + 7.0 * sin(y * 0.013 - sway * 1.4);
  }
  // 蕾絲邊（頭紗邊緣約 120 px 寬的一條，前景失焦所以都是柔的）：往外凸的扇形邊（每 72 px 一個）、
  // 扇形裡一朵五瓣小花、裡面一條帶葉子的藤、最裡面一條滾邊。along = 沿著邊的座標、d = 離邊多遠（往頭紗裡面是負的）。
  float scallop(float a) { float sa = mod(a, 72.0) - 36.0; return 24.0 * sqrt(max(0.0, 1.0 - sa * sa / 1296.0)); }
  float laceAt(float along, float d) {
    float sa = mod(along, 72.0) - 36.0;
    float band = smoothstep(-118.0, -110.0, d) * (1.0 - smoothstep(scallop(along) - 2.5, scallop(along) + 2.5, d));
    if (band <= 0.0) return 0.0;
    vec2 c = vec2(sa, d);
    float cord = 1.0 - smoothstep(1.4, 3.6, abs(length(c) - 24.0));
    float fl = 0.0;
    vec2 fc = c - vec2(0.0, -8.0);
    for (int i = 0; i < 5; i++) {
      float a = float(i) * 1.2566 - 1.5708;
      vec2 q = rot2(a) * fc - vec2(0.0, 7.5);
      fl = max(fl, 1.0 - smoothstep(0.7, 1.15, length(q / vec2(3.6, 6.2))));
    }
    fl = max(fl, 1.0 - smoothstep(1.8, 3.2, length(fc)));
    float vy = -62.0 + 9.0 * sin(along * 0.08727);
    float vine = 1.0 - smoothstep(1.2, 3.2, abs(d - vy));
    float lx = mod(along + 18.0, 36.0) - 18.0, side = mod(floor((along + 18.0) / 36.0), 2.0) * 2.0 - 1.0;
    float leaf = 1.0 - smoothstep(0.75, 1.1, length(rot2(0.7 * side) * vec2(lx, d - vy + side * 9.0) / vec2(9.0, 4.2)));
    float top = 1.0 - smoothstep(1.5, 3.5, abs(d + 108.0));
    return band * sat(0.28 + 0.72 * max(max(cord, fl), max(max(vine, leaf), top)));
  }
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = sp + dPage;                  // 紙（遠）動得少
    vec2 q = sp + dVeil;                  // 頭紗（近）動得多
    float ex = edgeX(q.y);
    float d = q.x - ex;                   // 離頭紗的邊多遠（頭紗在左邊：d < 0 是頭紗裡面）
    float cover = 1.0 - smoothstep(scallop(q.y) - 3.0, scallop(q.y) + 3.0, d);
    vec3 col;
    // 頭紗的影子落在紙上（光從左上來，頭紗離紙有一段距離：往右下偏、邊很柔）；
    // 紗本身很透、影子很淡，蕾絲的花紋擋光比較多，影子裡看得到花紋（隨風一起掃過紙面）
    vec2 qs = q - vec2(64.0, 44.0);
    float ds = qs.x - edgeX(qs.y);
    float shBody = 1.0 - smoothstep(scallop(qs.y) - 40.0, scallop(qs.y) + 46.0, ds);
    float shade = 1.0 - (0.07 * shBody + 0.1 * laceAt(qs.y, ds));
    vec3 sharp = pageAt(p) * shade;
    if (cover > 0.001) {
      // 頭紗後面：紙被霧化、模糊
      vec3 acc = sharp;
      float a0 = hash12(sp) * 6.2832;
      for (int i = 0; i < 9; i++) {
        float fi = float(i) + 0.5, ang = fi * 2.39996 + a0;
        acc += pageAt(p + vec2(cos(ang), sin(ang)) * 7.0 * sqrt(fi / 9.0)) * shade;
      }
      acc /= 10.0;
      // 布的皺褶：從上面垂下來的直條，褶子裡布比較多層（比較白、比較霧），褶峰有一點光澤；褶子跟著邊一起擺
      float fx = q.x - ex * 0.6;
      float fold = 0.5 + 0.5 * sin(fx / (52.0 + 0.02 * max(q.y, 0.0)) + 1.8 * snoise(vec2(fx / 430.0, sway * 0.12)) + 0.6 * sin(fx / 23.0 + sway));
      float lace = laceAt(q.y, d);
      // 越往頭紗裡面布越厚（從頭頂垂下來的好幾層）
      float depth = sat(-d / 420.0);
      float haze = 0.2 + 0.24 * fold * fold + 0.18 * depth + 0.55 * lace;
      float l1 = abs(fract((q.x + q.y * 0.577) / 9.0) - 0.5), l2 = abs(fract((q.x - q.y * 0.577) / 9.0) - 0.5), l3 = abs(fract(q.y / 7.8) - 0.5);
      float net = 1.0 - smoothstep(0.08, 0.26, min(min(l1, l2), l3));
      vec3 veil = mix(acc, C_BONE, haze) + C_BONE * (0.045 * net + 0.08 * smoothstep(0.82, 1.0, fold));
      // 褶子轉開的那一面暗一點（白紗疊在白紙上，靠褶子的明暗才看得出布的形狀）
      veil *= mix(0.9, 1.03, fold);
      // 蕾絲花紋的邊一點點灰（繡線的立體）
      veil *= 1.0 - 0.16 * lace * (1.0 - lace) * 4.0;
      col = mix(sharp, veil, cover);
    } else {
      col = sharp;
    }
    fragColor = vec4(col, 1.0);
  }`, {
  page: { value: null }, lyr: { value: null }, bake: { value: null },
  hem: { value: 2200 }, arch: { value: 0 }, sway: { value: 0 }, gust: { value: 0 }, billow: { value: 0 },
  dPage: { value: new THREE.Vector2() }, dVeil: { value: new THREE.Vector2() },
  revR: { value: Array.from({ length: NREV }, () => new THREE.Vector4()) }, revK: { value: new Array(NREV).fill(1) }, revN: { value: 0 },
});

/**
 * 原文副行（2026-09-30 雙語）：誓詞欄窄（VOW.w），自動排的原文會一路縮到 26 px；襯線字的韓文（系統字）又比中文小一號。
 * 改成至少 36 px、不再縮，太長就折成兩行（往下長，下面是空的紙）。
 */
function vowSub(c: CanvasRenderingContext2D, line: Line, st: LyricStyle, lay: LyricLayout): LyricLayout {
  const sub = lyricSubOf(line);
  if (!sub || !lay.sub) return lay;
  const size = Math.max(36, subSizeFor(lay.size));
  const sl = layoutLyric(c, sub, { ...subStyleFor(st, lay.size), size, minSize: size });
  const dy = lay.sub.dy - subGap(lay.size, lay.sub.lay.size) + subGap(lay.size, sl.size);
  return { ...lay, sub: { lay: sl, dy }, height: dy + (sl.height - sl.size) + lay.size };
}

export default class Vows extends Scene {
  pass = shared('vows.pass', PASS);
  page = this.track(new Layer2D(W, H, undefined, { fast: true }));
  lyr = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  tLift = 0;
  liftDur = 0.9;
  bars: number[] = [];
  st: LyricStyle = { family: F.serif(600), size: 56, minSize: 48, maxWidth: VOW.w, lineHeight: 1.12 };
  vx = VOW.x;
  vy = VOW.y;
  avoid: Rect[] = [];
  /** 留言「寫上去」：每一行（最後是署名）的範圍與開始、結束時間。 */
  rev: { r: Rect; t0: number; t1: number }[] = [];

  override async init() {
    const { audio: au, start: s, end: e, live } = this.ctx;
    const m = this.msg;
    const foot = `＊本誓詞由 ${Math.max(1, live.count)} 位見證人共同見證。`;
    await preloadText(this.ctx, `${m ? m.text + sigOf(m) : ''}${T22_TEXT}${INVITE_SMALL}${foot}誓詞 · VOWS見證人 · WITNESSFROM THE COUPLE${ROMAN.join('')}`);
    const B = au.beatPeriod(s + 0.1);
    const first = beatAfter(au, s + Math.min(0.35, B * 0.7));
    const bars = barsIn(au, first, e);
    const barLen = bars.length > 1 ? bars[1]! - bars[0]! : B * 4;
    this.tLift = bars[0] !== undefined && bars[0] - first <= barLen * 0.55 && e - bars[0] > barLen * 1.5 ? bars[0] : first;
    this.liftDur = Math.min(1.1, Math.max(0.6, B * 1.6), (e - this.tLift) * 0.3);
    this.bars = barsIn(au, this.tLift + this.liftDur + 0.3, e);
    const act = paperSignal();
    this.st = { ...this.st, active: act, sung: rgba('sepia', 0.95), unsung: rgba('sepia', 0.28) };

    // ---- 紙上固定的字：兩個小標、中間的細線、見證人的留言與署名、註腳
    const c = this.page.ctx;
    this.page.clear();
    c.textBaseline = 'alphabetic';
    const label = (t: string, x: number, y: number, col = rgba('sepia', 0.55), align: CanvasTextAlign = 'left') => {
      c.textAlign = align; c.font = font(F.mono(500), 16); c.letterSpacing = '6px'; c.fillStyle = col; c.fillText(t, x, y); c.letterSpacing = '0px'; c.textAlign = 'left';
    };
    if (m) {
      label('誓詞 · VOWS', VOW.x, LABEL_Y);
      label(m.couple ? 'FROM THE COUPLE · 新人' : '見證人 · WITNESS', WIT.x, LABEL_Y, sigInk(0.9));
      c.fillStyle = rgba('sepia', 0.18);
      c.fillRect(RULE_X, LABEL_Y + 30, 1, 520);
      const fam = F.hand(700), sig = sigOf(m);
      const blk = fitV2(c, m.text, fam, WIT.w, WIT.h, 1, { lineHeight: 1.3 });
      const top = WIT.y + Math.max(0, (WIT.h - blk.height) * 0.4);
      // 誓詞（歌詞）比見證人的留言小一級；Cormorant 的字面比較小，多給 4 px
      this.st = { ...this.st, size: Math.min(V2.lyrMax, lyricV2(blk.fit.size) + 4), minSize: V2.lyrMin };
      const pl = placeBlock(c, blk, fam, sig, WIT.x, top);
      drawBlock(c, blk, pl, fam, sig, { color: rgba('sepia', 0.94), sigColor: rgba('sepia', 0.72) });
      this.avoid = [pl.rect, [VOW.x - 20, 440, VOW.w + 40, 300]];
      // 頭紗撥開之後，留言一行一行寫上去（每行花的時間照字寬），最後簽名：
      // 全部寫完不超過約一小節（窗格短就更快），留言才有時間停在那裡讓人讀完
      const fz = blk.fit.size, ss = blk.sigSize;
      const rows: Rect[] = pl.lines.map((l) => [l.x, l.y - fz * 0.98, l.w + fz * 0.9, fz * 1.3]);
      const w0 = this.tLift + this.liftDur * 0.75;
      const Tw = clamp(Math.min(B * 4 * 1.1, (e - w0) * 0.3), 0.6, 2.6);
      const total = rows.reduce((a, r) => a + r[2], 0);
      let acc = 0;
      this.rev = rows.map((r) => { const t0 = w0 + (Tw * acc) / total; acc += r[2]; return { r, t0, t1: w0 + (Tw * acc) / total }; });
      const sg0 = w0 + Tw + 0.08;
      this.rev.push({ r: [pl.sig.x, pl.sig.y - ss * 1.0, pl.sig.w + 10, ss * 1.35], t0: sg0, t1: sg0 + clamp(Tw * 0.3, 0.25, 0.6) });
      label(foot, VOW.x, 940, rgba('sepia', 0.42));
    } else {
      // 沒有留言：誓詞放大到中間；見證人欄是一條空白的簽名線與邀請
      this.st = { ...this.st, size: V2.lyrMax + 4, minSize: V2.lyrMin, maxWidth: 1180, align: 'left' };
      this.vx = 560; this.vy = 540;
      label('誓詞 · VOWS', this.vx, LABEL_Y + 40);
      c.fillStyle = rgba('sepia', 0.35);
      c.fillRect(this.vx, 794, 520, 1.4);
      label('見證人 · WITNESS', this.vx, 828);
      c.font = font(F.ming(700), 30); c.fillStyle = rgba('sepia', 0.6);
      const fit = fitText(c, INVITE_SMALL, F.ming(700), 640, 50, { min: 24, max: 30 });
      c.font = font(F.ming(700), fit.size);
      c.fillText(INVITE_SMALL, this.vx + 560, 788);
      this.avoid = [[this.vx - 20, 330, 1240, 400]];
    }
    this.page.upload();
  }

  /**
   * 一行歌詞的排版（誓詞的字）；上一句留在上面、淡一點。
   * subK：原文副行（韓文歌，drawLyric 自動畫在中文下面）的淡出係數——上一句往上退的時候原文先淡掉，
   * 不然它會壓到下面正在唱的那一句（一次顯示兩句：只有正在唱的那句留原文）。
   */
  private drawVow(c: CanvasRenderingContext2D, line: Line, t: number, y: number, alpha: number, dim: boolean, subK = 1) {
    const st = dim ? { ...this.st, active: rgba('sepia', 0.3), sung: rgba('sepia', 0.3), unsung: rgba('sepia', 0.18) } : this.st;
    const lay = vowSub(c, line, st, layoutLyric(c, line, st));
    c.save();
    c.translate(this.vx, y - (lay.rows.length - 1) * lay.size * 1.12);
    if (lay.sub && subK < 1) {
      drawLyric(c, line, t, st, { ...lay, sub: undefined } as LyricLayout, alpha);
      // 只畫原文（主行空著）：drawLyric 照 lay.sub 的排版畫在 dy 那裡
      if (subK > 0) drawLyric(c, line, t, st, { ...lay, rows: [], words: [] }, alpha * subK);
    } else drawLyric(c, line, t, st, lay, alpha);
    // 條文編號（左邊界外、很小的羅馬數字）
    c.globalAlpha = alpha * (dim ? 0.5 : 1);
    c.textAlign = 'right'; c.font = font(F.serif(400, true), 24); c.fillStyle = rgba('sepia', 0.45);
    c.fillText(ROMAN[line.i % ROMAN.length]!, -22, 0);
    c.textAlign = 'left';
    c.restore();
    return lay;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, lyrics, song } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;

    // ---- 誓詞（歌詞）：這一句在基線，上一句往上退、變淡
    const L = this.lyr, c = L.ctx;
    L.clear();
    const ly = lyricAt(lyrics, t, 1.6);
    if (ly) {
      const line = ly.line;
      const kin = ease.outCubic(prog(t, line.start - 0.45, line.start + 0.15));
      const lay = layoutLyric(c, line, this.st);
      const rowsH = (lay.rows.length - 1) * lay.size * 1.12;
      const prev = line.i > 0 ? lyrics.lines[line.i - 1] : undefined;
      if (prev && prev.end > s - 0.5 && line.start - prev.end < 4) {
        const up = lerp(0, 1, kin);
        const pLay = layoutLyric(c, prev, this.st);
        const gap = pLay.size * 1.55 + rowsH;
        this.drawVow(c, prev, t, this.vy - gap * up, lerp(1, 0.9, up), up > 0.5, 1 - prog(up, 0, 0.45));
      }
      c.save(); c.globalAlpha = 1; this.drawVow(c, line, t, this.vy + (1 - kin) * 22, ly.k, false); c.restore();
    } else {
      const last = lyrics.lastLine(t);
      if (last && last.end > s - 0.5) this.drawVow(c, last, t, this.vy, 0.9, true);
      else if (!lyrics.has) {
        c.font = font(F.serif(400, true), 34); c.fillStyle = rgba('sepia', 0.45 * prog(t, s, s + 0.6));
        c.fillText(`♪ ${song.title}`, this.vx, this.vy);
      }
    }
    L.upload();

    // ---- 頭紗：整個畫面蓋著 → 小節線被撥到左邊（中間先走、上下跟上，過頭一點再彈回來），之後垂在左邊一直飄
    const u = clamp((t - this.tLift) / this.liftDur);
    const hemK = ease.inOutCubic(u);
    const after = t - this.tLift - this.liftDur;
    const hem = lerp(2250, REST, hemK) + (after > 0 ? 22 * Math.sin(after * 6) * Math.exp(-after * 2.5) : 0) + 10 * Math.sin(t * 0.6);
    const arch = 560 * Math.sin(Math.PI * u) + 50 * hemK;
    let gust = 0, billow = 0;
    for (const b of this.bars) {
      if (t < b) continue;
      const a = t - b;
      gust = Math.max(gust, Math.exp(-a * 2.2) * Math.sin(Math.min(Math.PI, a * 5)));
      // 小節線的風：中段很快被吹得往右鼓起來（約 60 px），再像布一樣慢慢垂回去、晃一下
      billow += 62 * Math.sin(Math.min(Math.PI / 2, a * 7)) * Math.exp(-a * 1.9) * (a < 0.22 ? 1 : 1 + 0.25 * Math.sin((a - 0.22) * 7));
    }
    const P = this.pass;
    P.u.page!.value = this.page.texture;
    P.u.lyr!.value = L.texture;
    P.u.bake!.value = ensureBake(renderer);
    P.u.hem!.value = hem;
    P.u.arch!.value = arch;
    P.u.billow!.value = billow;
    P.u.sway!.value = t * 0.7 + 1.8 * gust;
    P.u.gust!.value = gust + 0.25 * f.a.kick;
    // 留言寫到哪裡（每一行照自己的時間；寫的時候筆速先快後慢）
    const rr = P.u.revR!.value as THREE.Vector4[], rk = P.u.revK!.value as number[];
    this.rev.forEach((v, i) => { rr[i]!.set(v.r[0], v.r[1], v.r[2], v.r[3]); rk[i] = ease.outQuad(clamp((t - v.t0) / (v.t1 - v.t0))); });
    P.u.revN!.value = this.rev.length;
    // 鏡頭慢慢往右上漂：頭紗（近）動得比紙（遠）多
    const dr = ease.inOutQuad(f.p);
    (P.u.dPage!.value as THREE.Vector2).set(-10 + 22 * dr, 6 * noise1(t * 0.2, 4));
    (P.u.dVeil!.value as THREE.Vector2).set(-40 + 90 * dr, 14 * noise1(t * 0.25, 7));
    P.render(renderer, out);
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.5, halation: 0.04, vignette: 0.3, grain: 0.05, zoom: 1 + 0.03 * dr, popupAvoid: this.avoid };
  }
}

