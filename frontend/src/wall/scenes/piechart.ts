// 資訊圖表（亮）：「今晚的祝福組成」——一張一本正經的統計圖表，資料是真的：現場所有的留言。
// MV 融合原則：主角是主打留言（這張圖的「圖說」），圖表是配角。
//  - 右邊大字：主打留言一個字一個字寫上去（落在拍點上），左邊一條細細的圖說括線，最後署名。
//  - 左邊一個小小的甜甜圈：留言依內容分成六類（愛心派、英文派、長篇感言、成語派、恭喜派、真心話），用真的則數，
//    一拍長出一塊（outExpo），每一類用不同方向的版畫刻線區分（不只靠顏色）。中間是總則數（小字）。
//  - 切片長完的下一拍，甜甜圈轉一下（主打留言所屬的那一塊轉到三點鐘方向，正對著留言），再下一拍那一塊「彈出來」
//    變成訊號色，一條引線水平拉到圖說括線上。
//  - 甜甜圈下面的圖例只有色塊與類名；歌詞在左上（逐字跟唱，亮版面：訊號色的暗部＋螢光筆）；註腳一行。
//  - 標準 v2：甜甜圈是主視覺（放大）；留言 40～60 px、寫在右邊 860 寬的一塊。一支「計票指針」每拍轉四分之一圈
//    （拍點上一下子轉過去），掃過的那一塊亮一下，像在一張一張點票。
//  - 沒有留言可以統計：整圈虛線。沒有主打留言：右邊寫一行邀請（比歌詞小，這時歌詞是主角）。
// 畫法：紙（_t11 的共用紙）→ 甜甜圈、圖例色塊（全螢幕 shader，版畫刻線）→ 字（Canvas2D）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, TAU } from '../engine/util';
import type { FitResult } from '../engine/text';
import { lyricAt, beatAfter, signature, fillWithHearts } from './_motifs';
import { Paper, stagger, tag, type Rect } from './_t11';
import { paperLyric, lyricLine } from './_t12';
import { V2, msgMaxFor, lyricV2, sigV2, fitClauses } from './_v2';
import { fitText } from '../engine/text';

export const spec: PlateSpecDecl = { group: 'type', family: 'science', paper: true, energy: [0.3, 0.9], bars: [4, 10], weight: 1 };

// ---------------------------------------------------------------- 版面
/** 甜甜圈（配角：縮小、放左邊）：圓心、外半徑、內半徑。 */
const PIE = { x: 470, y: 560, r: 236, r0: 146 };
/** 圖例：甜甜圈下面兩欄三列（色塊的左緣 x、第一列的中線、列高）。 */
const LEG = { x: [260, 480], y: 860, row: 36 };
/** 主打留言（主角）：畫面右邊的一大塊；左邊一條括線。整塊在 y ≤ 800（右下角 QR 在 y ≥ 830）。 */
const MB = { x: 900, y: 330, w: 860, h: 430 };
const RULE_X = 866;
const LYR = { x: 124, base: 212, w: 1200, size: 64 };
const FAM_MSG = F.hand(700);
const FOOT = '＊統計方法：一則一票，愛心不另計分。';
const EMPTY_CAP = '本圖還缺你那一塊：掃右下角 QR code 補上。';
const MAXS = 6;
/** 署名那一行佔的高度（留言的字級依「可用高度扣掉署名」算，署名永遠在最後一行下面）。 */
const SIG_H = 60;

interface Cat { key: string; name: string }
const CATS: Cat[] = [
  { key: 'heart', name: '愛心派' },
  { key: 'en', name: '英文派' },
  { key: 'long', name: '長篇感言' },
  { key: 'idiom', name: '成語派' },
  { key: 'congrats', name: '恭喜派' },
  { key: 'plain', name: '真心話' },
];
const IDIOMS = /百年好合|早生貴子|永浴愛河|白頭偕老|永結同心|相親相愛|天作之合|佳偶天成|鸞鳳和鳴|心心相印|花好月圓|琴瑟和鳴|郎才女貌|甜甜蜜蜜|幸福美滿|恩恩愛愛/;

/** 一則留言屬於哪一類（依序判斷，先符合的先算）。 */
function classify(text: string): number {
  const t = text.replace(/\s/g, '');
  if (/^[♥]+$/.test(t)) return 0;
  const latin = (t.match(/[A-Za-z]/g) ?? []).length, cjk = (t.match(/[㐀-鿿]/g) ?? []).length;
  if (latin > cjk) return 1;
  if (Array.from(t).length >= 30) return 2;
  if (IDIOMS.test(t)) return 3;
  if (/恭喜|新婚快樂|新婚愉快|結婚快樂|賀/.test(t)) return 4;
  return 5;
}

const CHART = () => {
  const p = new FSPass(/* glsl */ `
  uniform float cum[${MAXS + 1}]; uniform float grow[${MAXS}]; uniform float ns; uniform float hi; uniform float pop; uniform float rot; uniform float hand;
  uniform vec2 leg[${MAXS}]; uniform float k; uniform float empty;
  const vec2 C = vec2(${PIE.x}.0, ${PIE.y}.0);
  const float R1 = ${PIE.r}.0, R0 = ${PIE.r0}.0;
  vec4 over(vec4 d, vec3 c, float a) { return vec4(c * a + d.rgb * (1.0 - a), a + d.a * (1.0 - a)); }
  // 每一類的版畫紋：斜線、橫線、反斜線、交叉、點、直線（密度不同）
  float pat(int i, vec2 p) {
    if (i == 0) return hatch((p.x + p.y) / 7.0, 0.3);
    if (i == 1) return hatch(p.y / 6.0, 0.24);
    if (i == 2) return hatch((p.x - p.y) / 8.0, 0.3);
    if (i == 3) return max(hatch((p.x + p.y) / 9.0, 0.2), hatch((p.x - p.y) / 9.0, 0.2));
    if (i == 4) { vec2 g = fract(p / 8.0) - 0.5; return 1.0 - smoothstep(0.17, 0.25, length(g)); }
    return hatch(p.x / 7.0, 0.22);
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec4 o = vec4(0.0);
    // ---- 甜甜圈（從 12 點鐘方向順時針；整個轉 rot 圈）
    for (int i = 0; i < ${MAXS}; i++) {
      if (float(i) >= ns) break;
      float a0 = cum[i], a1 = cum[i + 1];
      float mid = ((a0 + a1) * 0.5 + rot) * TAU;
      vec2 dir = vec2(sin(mid), -cos(mid));
      float ex = float(i) == hi ? pop : 0.0;
      vec2 q = p - C - dir * ex * 22.0;
      float r = length(q);
      float ang = fract(atan(q.x, -q.y) / TAU - rot + 2.0);
      float a1g = a0 + (a1 - a0) * grow[i];
      // 切片之間留 3 px 的紙
      float gap = 3.0 / max(r, 1.0) / TAU;
      float inA = step(a0 + gap * 0.5, ang) * step(ang, a1g - gap * 0.5);
      float inR = step(R0, r) * step(r, R1 + ex * 6.0);
      float m = inA * inR * step(0.001, grow[i]);
      if (m < 0.5) continue;
      float edge = min(min(r - R0, R1 + ex * 6.0 - r), min((ang - a0) * TAU * r, (a1g - ang) * TAU * r));
      // 計票指針剛掃過的地方亮一下（指針後面拖一小段）
      float lag = fract(hand - (ang + rot) + 1.0);
      o = over(o, C_SIGNAL, 0.28 * exp(-lag * 14.0) * step(0.0005, hand));
      if (float(i) == hi && pop > 0.01) {
        o = over(o, C_SIGNAL, 0.85 * min(pop * 2.0, 1.0));
        o = over(o, C_SEPIA, pat(i, p) * 0.3);
      } else {
        // 配角：刻線淡一點
        o = over(o, C_SEPIA, pat(i, p) * 0.45);
      }
      o = over(o, C_SEPIA, pxLine(edge, 0.6, 1.5) * 0.6);
    }
    // 計票指針：從圓心畫到外圈外面一點（細墨線，尖端一個小點）
    if (hand > 0.0005) {
      float ha = hand * TAU;
      vec2 hd = vec2(sin(ha), -cos(ha));
      float hl = sdSegment(p, C + hd * (R0 - 8.0), C + hd * (R1 + 18.0));
      o = over(o, C_SEPIA, pxLine(hl, 0.5, 1.4) * 0.75);
      o = over(o, C_SEPIA, (1.0 - smoothstep(3.0, 4.2, length(p - C - hd * (R1 + 18.0)))) * 0.8);
    }
    // 沒有資料：一整圈淡淡的虛線
    if (empty > 0.5) {
      float r = length(p - C);
      float ang = atan(p.x - C.x, -(p.y - C.y));
      float dash = step(0.0, sin(ang * 60.0));
      o = over(o, C_SEPIA, (pxLine(abs(r - R1), 0.6, 1.5) + pxLine(abs(r - R0), 0.6, 1.5)) * dash * 0.6 * grow[0]);
    }
    // ---- 圖例：色塊（同樣的紋），跟著它的切片一起出現
    for (int i = 0; i < ${MAXS}; i++) {
      if (float(i) >= ns || empty > 0.5) break;
      vec2 sq = p - leg[i];
      float box = step(abs(sq.x), 10.0) * step(abs(sq.y), 10.0) * step(0.001, grow[i]);
      if (box > 0.5) {
        if (float(i) == hi && pop > 0.01) o = over(o, C_SIGNAL, 0.85);
        o = over(o, C_SEPIA, pat(i, p) * 0.55);
        o = over(o, C_SEPIA, pxLine(min(10.0 - abs(sq.x), 10.0 - abs(sq.y)), 0.5, 1.3) * 0.6);
      }
    }
    fragColor = o * k;
  }`, {
    cum: { value: new Array(MAXS + 1).fill(0) }, grow: { value: new Array(MAXS).fill(0) }, ns: { value: 0 }, hi: { value: -1 }, pop: { value: 0 }, rot: { value: 0 }, hand: { value: 0 },
    leg: { value: Array.from({ length: MAXS }, () => new THREE.Vector2()) }, k: { value: 1 }, empty: { value: 0 },
  }, { blending: THREE.CustomBlending, transparent: true });
  const m = p.mat;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  return p;
};

/** 圖例第 i 格的色塊中心（兩欄三列）。 */
const legPos = (i: number) => ({ x: LEG.x[i % 2]! + 10, y: LEG.y + Math.floor(i / 2) * LEG.row });

interface Slice { cat: number; name: string; n: number; frac: number; t: number }
interface Glyph { ch: string; x: number; y: number; w: number; t: number }

export default class PieChart extends Scene {
  paper = shared('t11.paper', () => new Paper());
  chart = shared('piechart.chart', CHART);
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  slices: Slice[] = [];
  total = 0;
  hi = -1;
  fit: FitResult | null = null;
  glyphs: Glyph[] = [];
  /** 留言區塊的上下緣（括線的範圍）。 */
  blockTop = 0; blockBot = 0;
  tFirst = 0; unit = 0.5; tRot = Infinity; tPop = Infinity;
  /** 甜甜圈要轉幾圈（讓主打的那一塊正對著留言）。 */
  rotTo = 0;
  sig = ''; sigT = Infinity; sigX = 0; sigY = 0;
  lyricsInWindow = false;
  avoid: Rect[] = [];
  /** 歌詞字級：有留言時比留言小一截（一格只有一個焦點）。 */
  lyrSize: number = LYR.size;
  sigSize = 30;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    // ---- 資料：所有留言分類計數（主打留言不在清單裡也算一票）
    const all: Msg[] = (this.ctx.params.messages as Msg[] | undefined)?.slice() ?? [];
    if (m && !all.some((x) => x.id === m.id)) all.push(m);
    const counts = new Array(CATS.length).fill(0) as number[];
    for (const x of all) counts[classify(x.text)]!++;
    this.total = all.length;
    const beat = au.beatPeriod(s);
    this.tFirst = beatAfter(au, s + Math.min(0.2, beat * 0.4));
    const beats = (e - this.tFirst) / beat;
    const u = this.unit = beats < 14 ? 0.5 : 1;
    const B = (k: number) => au.timeOfBeat(au.beatAt(this.tFirst) + k * u);
    let acc = 0;
    const present = CATS.map((c, i) => ({ c, i, n: counts[i]! })).filter((x) => x.n > 0);
    this.slices = present.map((x, j) => {
      const sl = { cat: x.i, name: x.c.name, n: x.n, frac: acc, t: B(j) };
      acc += x.n / Math.max(1, this.total);
      return sl;
    });
    const nS = this.slices.length;
    this.hi = m ? this.slices.findIndex((sl) => sl.cat === classify(m.text)) : -1;
    // 切片長完的下一拍轉、再下一拍彈出來；轉到三點鐘方向（0.25 圈），走近的那一邊
    this.tRot = B(Math.max(nS, 1));
    this.tPop = B(Math.max(nS, 1) + 1);
    if (this.hi >= 0) {
      const sl = this.slices[this.hi]!, next = this.slices[this.hi + 1]?.frac ?? 1;
      const want = 0.25 - (sl.frac + next) / 2;
      this.rotTo = want - Math.round(want);
    }
    this.sig = m ? (m.couple ? '—— 新郎新娘' : signature(m.name)) : '';
    const capText = m ? m.text : EMPTY_CAP;
    await loadText(`${capText}${this.sig}${CATS.map((c) => c.name).join('')}${FOOT}${song.title}${song.artist}今晚的祝福組成則祝福圖說目前還沒有留言可以統計（）0123456789?`);

    // ---- 主打留言：右邊一大塊，字級依「可用高度扣掉署名」算；一個字一個字落在拍點上
    const c = this.layer.ctx;
    const fo = { min: V2.msgMin, max: msgMaxFor(capText), lineHeight: 1.3, maxLines: 6 };
    const fit = this.fit = m
      ? fitClauses(c, capText, FAM_MSG, MB.w, MB.h - SIG_H, fo) ?? fitText(c, capText, FAM_MSG, MB.w, MB.h - SIG_H, fo)
      // 沒有主打留言：邀請比歌詞小（這時歌詞是主角）
      : fitText(c, capText, FAM_MSG, MB.w, 140, { min: 36, max: 40, lineHeight: 1.3, maxLines: 2 });
    const blockH = fit.height + (m ? SIG_H : 0);
    const top = MB.y + (MB.h - blockH) / 2;
    const base0 = top + fit.size * 0.86;
    c.font = font(FAM_MSG, fit.size);
    const chars: Omit<Glyph, 't'>[] = [];
    fit.lines.forEach((ln, li) => {
      let x = MB.x;
      for (const ch of Array.from(ln)) { const w = c.measureText(ch).width; chars.push({ ch, x, y: base0 + li * fit.lineHeight, w }); x += w; }
    });
    const bar = au.timeOfBar(au.barAt(this.tFirst) + 1) - this.tFirst;
    const times = stagger(au, B(1), chars.length, Math.min(2 * bar, 0.4 * (e - s)));
    this.glyphs = chars.map((g, i) => ({ ...g, t: times[i]! }));
    const tLast = times[times.length - 1] ?? this.tFirst;
    this.sigT = tLast + beat * 0.5;
    // 署名：最後一行下面、靠右對齊最寬的那一行（♥ 是符號字型，用逐字排好的位置量）
    const wEnd = Math.max(MB.x + 200, ...chars.map((g) => g.x + Math.max(g.w, g.ch === '♥' ? fit.size : 0)));
    this.sigX = Math.min(MB.x + MB.w, wEnd);
    this.sigSize = sigV2(fit.size);
    this.sigY = base0 + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.3 + this.sigSize + 12;
    this.blockTop = top - 6;
    this.blockBot = base0 + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.24;
    this.lyricsInWindow = lyrics.linesIn(s, e).length > 0;
    this.lyrSize = lyricV2(m ? fit.size : null);
    this.avoid = [[RULE_X - 20, Math.round(top - 20), MB.x + MB.w - RULE_X + 40, Math.round(blockH + 40)]];
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const vis = prog(t, s, s + 0.25) * (1 - prog(t, e - 0.3, e, ease.inCubic));
    this.paper.render(renderer, out, { k: 1 });
    const nS = this.slices.length, empty = nS === 0;
    // ---- 切片一拍長一塊（outExpo）；轉到正對留言（inOutCubic）；主打那一塊彈出來（outBack）
    const grows = this.slices.map((sl) => ease.outExpo(clamp((t - sl.t) / 0.4)));
    const rot = this.rotTo * ease.inOutCubic(clamp((t - this.tRot) / 0.5));
    const pop = this.hi >= 0 ? ease.outBack(clamp((t - this.tPop) / 0.45)) : 0;
    const u = this.chart.u;
    const cum = u.cum!.value as number[], gr = u.grow!.value as number[], leg = u.leg!.value as THREE.Vector2[];
    for (let i = 0; i <= MAXS; i++) cum[i] = i < nS ? this.slices[i]!.frac : 1;
    for (let i = 0; i < MAXS; i++) {
      gr[i] = empty ? (i === 0 ? ease.outExpo(prog(t, this.tFirst, this.tFirst + 0.5)) : 0) : (grows[i] ?? 0);
      const lp = legPos(i); leg[i]!.set(lp.x, lp.y);
    }
    u.ns!.value = empty ? 0 : nS; u.hi!.value = this.hi; u.pop!.value = pop; u.rot!.value = rot; u.k!.value = vis; u.empty!.value = empty ? 1 : 0;
    // 計票指針：切片長完之後出現，每拍轉四分之一圈（拍點上 outExpo 轉過去、停住）
    const hb = this.ctx.audio.beatAt(t) - this.ctx.audio.beatAt(this.tRot);
    const hbi = Math.floor(hb);
    u.hand!.value = empty || hb < 0 ? 0 : 1e-3 + (hbi + ease.outExpo(clamp((hb - hbi) / 0.4))) * 0.25;
    this.chart.render(renderer, out);

    const L = this.layer, c = L.ctx;
    L.clear();
    c.globalAlpha = vis;
    // ---- 配角：圖表的標題、中間的總數（小）、圖例的類名、一行註腳
    const shown = empty ? 0 : Math.round(this.slices.reduce((a, sl, i) => a + sl.n * (grows[i] ?? 0), 0));
    c.textAlign = 'center';
    c.font = font(F.archivo(100, 700), 48); c.fillStyle = rgba('sepia', 0.7);
    c.fillText(empty ? '?' : String(shown), PIE.x, PIE.y + 10);
    tag(c, '今晚的祝福', PIE.x, PIE.y + 42, { size: 17, color: rgba('sepia', 0.55), align: 'center' });
    c.textAlign = 'left';
    for (let i = 0; i < nS; i++) {
      const g = grows[i] ?? 0;
      if (g <= 0) continue;
      const lp = legPos(i), isHi = i === this.hi && pop > 0.05;
      c.save(); c.globalAlpha *= clamp(g * 1.5);
      tag(c, this.slices[i]!.name, lp.x + 20, lp.y + 7, { size: 19, color: isHi ? rgba('blood') : rgba('sepia', 0.62), weight: isHi ? 700 : 500, tracking: 1 });
      c.restore();
    }
    if (empty) tag(c, '（目前還沒有留言可以統計）', LEG.x[0]!, LEG.y + 6, { size: 19, color: rgba('sepia', 0.62) });
    tag(c, FOOT, 124, 984, { size: 16, color: rgba('sepia', 0.5), tracking: 1 });
    this.lyric(c, t);
    // ---- 圖說括線：留言左邊一條細線；引線從彈出來的那一塊水平拉過來（照長度一路畫出來）
    const fit = this.fit!;
    const g0 = this.glyphs[0]?.t ?? this.tFirst;
    const kRule = ease.outCubic(prog(t, g0, g0 + 0.5));
    if (this.msg && kRule > 0) {
      const mid = (this.blockTop + this.blockBot) / 2, half = ((this.blockBot - this.blockTop) / 2) * kRule;
      c.fillStyle = rgba('sepia', 0.4);
      c.fillRect(RULE_X, mid - half, 1.5, half * 2);
    }
    if (this.hi >= 0 && pop > 0.02) {
      const k = ease.outCubic(clamp((t - this.tPop) / 0.5));
      const x0 = PIE.x + PIE.r + pop * 22 + 10, y0 = PIE.y;
      c.strokeStyle = rgba('blood', 0.8); c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(lerp(x0, RULE_X, k), y0);
      // 留言區塊沒有蓋到甜甜圈的中線：沿著括線接過去
      if (k >= 1 && (y0 < this.blockTop || y0 > this.blockBot)) c.lineTo(RULE_X, clamp(y0, this.blockTop, this.blockBot));
      c.stroke();
      c.fillStyle = rgba('blood');
      c.beginPath(); c.arc(x0, y0, 4.5, 0, TAU); c.fill();
    }
    // ---- 主打留言：一個字一個字寫上去
    c.font = font(FAM_MSG, fit.size);
    for (const g of this.glyphs) {
      if (t < g.t) break;
      const kk = clamp((t - g.t) / 0.14), wet = 1 - clamp((t - g.t) / 0.8);
      c.save();
      if (kk < 1) { c.beginPath(); c.rect(g.x - 4, g.y - fit.size, (g.w + 8) * kk, fit.size * 1.4); c.clip(); }
      c.fillStyle = g.ch === '♥' ? rgba('rose') : this.msg ? mixRgba('sepia', 'blood', wet * 0.9) : rgba('sepia', 0.78);
      c.fillText(g.ch, g.x, g.y);
      c.restore();
    }
    if (this.msg && t >= this.sigT) {
      c.save(); c.globalAlpha *= prog(t, this.sigT, this.sigT + 0.35);
      c.font = font(F.hand(400), this.sigSize); c.fillStyle = rgba('sepia', 0.78); c.textAlign = 'right';
      fillWithHearts(c, this.sig, this.sigX, this.sigY);
      c.restore();
    }
    comp.draw(renderer, L.upload(), out);
    // 鏡頭：整個窗格慢慢推近（像電影）
    return { paper: 1, bloom: 0.3, vignette: 0.25, grain: 0.04, zoom: 1 + 0.02 * ease.inOutCubic(f.p) + 0.003 * f.a.kick, popupAvoid: this.avoid };
  }

  /** 左上的歌詞：逐字跟唱；純音樂寫歌名。 */
  private lyric(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    const ly = lyricAt(lyrics, t);
    if (!ly) {
      if (!this.lyricsInWindow) {
        c.font = font(F.archivo(100, 800), 56); c.fillStyle = rgba('sepia', 0.9); c.textAlign = 'left';
        c.fillText(song.title, LYR.x, LYR.base);
      }
      return;
    }
    const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.1));
    c.save(); c.textAlign = 'left'; c.translate(LYR.x, LYR.base + (1 - inK) * 14);
    lyricLine(c, ly.line, t, paperLyric(this.lyrSize, LYR.w), ly.k * c.globalAlpha, true);
    c.restore();
  }
}
