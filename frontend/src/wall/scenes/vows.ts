// 誓詞（亮）：一張奶油色的誓詞頁，隔著新娘的頭紗看過去。
//  - 開場：整個畫面在頭紗後面——細細的六角網眼、布的皺褶、下緣一圈蕾絲；後面的字是柔的、霧霧的。
//  - 第一個小節線（窗格短就第一拍）：頭紗「掀起來」（婚禮上掀頭紗的那一下）：中間先起、兩邊跟著，往上收到畫面頂端，
//    只剩一圈失焦的蕾絲邊掛在上緣輕輕飄（前景）；之後每個小節線一陣小風。蕾絲的影子淡淡落在紙上。
//  - 紙的左邊是「誓詞」：歌詞一句一句浮現（Cormorant／思源宋體），正在唱的字是訊號色；上一句留著、淡淡的往上退。
//  - 右邊是「見證人」：主打留言（手寫、最大、最清楚），署名在下面——賓客是這場婚禮的見證人。
//  - 冷面註腳：本誓詞由 N 位見證人共同見證（N = 現在的留言數）。
//  - 沒有留言：誓詞（歌詞）放大到中間當主角，見證人欄留一條空白的簽名線與邀請。
// 畫法：紙與字是兩張圖層（留言那張畫一次、歌詞那張每格畫），一個 shader 畫紙、取樣圖層，頭紗蓋住的地方
// 把後面的紙模糊、罩一層霧，再畫網眼、皺褶、蕾絲；鏡頭慢慢推近，頭紗在前景、動得比紙多（視差）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, lerp, noise1 } from '../engine/util';
import { fitText } from '../engine/text';
import type { Line } from '../engine/lyrics';
import { drawLyric, layoutLyric, lyricAt, beatAfter, type LyricStyle } from './_motifs';
import { preloadText, fitWithSig, INVITE_SMALL, paperSignal } from './_t19';
import { ensureBake, barsIn, sigInk } from './_t1';
import { placeBlock, drawBlock, sigOf, T22_TEXT, type Rect } from './_t22';

export const spec: PlateSpecDecl = { group: 'type', family: 'keepsake', paper: true, energy: [0, 0.6], bars: [4, 12], weight: 1 };

/** 左欄（誓詞＝歌詞）與右欄（見證人＝留言）。 */
const VOW = { x: 190, w: 600, y: 600 };
const WIT = { x: 890, y: 300, w: 880, h: 470 };
const RULE_X = 845;
const LABEL_Y = 250;
/** 頭紗收起來之後，下緣（蕾絲）停在哪裡（螢幕 y）。 */
const REST = 118;
const ROMAN = ['i.', 'ii.', 'iii.', 'iv.', 'v.', 'vi.', 'vii.', 'viii.', 'ix.', 'x.', 'xi.', 'xii.'];

const PASS = () => new FSPass(/* glsl */ `
  uniform sampler2D page; uniform sampler2D lyr; uniform sampler2D bake;
  uniform float hem; uniform float arch; uniform float sway; uniform float gust;
  uniform vec2 dPage; uniform vec2 dVeil;
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
    vec4 a = fastLayer(textureLod(page, uv, 0.0));
    vec4 b = fastLayer(textureLod(lyr, uv, 0.0));
    vec3 c = paperAt(p);
    c = c * (1.0 - a.a) + a.rgb;
    return c * (1.0 - b.a) + b.rgb;
  }
  // 頭紗的下緣（螢幕 y）：掀起來的時候中間先起；平常輕輕地波動
  float hemY(float x) {
    float u = (x - 960.0) / 1150.0;
    return hem - arch * (1.0 - u * u) + (10.0 + 18.0 * gust) * sin(x * 0.0055 + sway) + 6.0 * sin(x * 0.013 - sway * 1.4);
  }
  // 蕾絲邊（頭紗下緣約 120 px 寬的一圈，前景失焦所以都是柔的）：往下垂的扇形邊（每 72 px 一個）、
  // 扇形裡一朵五瓣小花、上面一條帶葉子的藤、最上面一條滾邊。回傳花紋的濃度（0..1）。
  float scallop(float x) { float sx = mod(x, 72.0) - 36.0; return 24.0 * sqrt(max(0.0, 1.0 - sx * sx / 1296.0)); }
  float laceAt(vec2 q, float h) {
    float sx = mod(q.x, 72.0) - 36.0;
    float edge = h + scallop(q.x);
    float band = smoothstep(h - 118.0, h - 110.0, q.y) * (1.0 - smoothstep(edge - 2.5, edge + 2.5, q.y));
    if (band <= 0.0) return 0.0;
    vec2 c = vec2(sx, q.y - h);
    float cord = 1.0 - smoothstep(1.4, 3.6, abs(length(c) - 24.0));              // 扇形的滾邊
    float fl = 0.0;
    vec2 fc = c - vec2(0.0, -8.0);
    for (int i = 0; i < 5; i++) {
      float a = float(i) * 1.2566 - 1.5708;
      vec2 d = rot2(a) * fc - vec2(0.0, 7.5);
      fl = max(fl, 1.0 - smoothstep(0.7, 1.15, length(d / vec2(3.6, 6.2))));
    }
    fl = max(fl, 1.0 - smoothstep(1.8, 3.2, length(fc)));
    float vy = h - 62.0 + 9.0 * sin(q.x * 0.08727);                               // 藤（一個扇形一個波）
    float vine = 1.0 - smoothstep(1.2, 3.2, abs(q.y - vy));
    float lx = mod(q.x + 18.0, 36.0) - 18.0, side = mod(floor((q.x + 18.0) / 36.0), 2.0) * 2.0 - 1.0;
    float leaf = 1.0 - smoothstep(0.75, 1.1, length(rot2(0.7 * side) * vec2(lx, q.y - vy + side * 9.0) / vec2(9.0, 4.2)));
    float top = 1.0 - smoothstep(1.5, 3.5, abs(q.y - (h - 108.0)));
    return band * sat(0.28 + 0.72 * max(max(cord, fl), max(max(vine, leaf), top)));
  }
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = sp + dPage;                  // 紙（遠）動得少
    vec2 q = sp + dVeil;                  // 頭紗（近）動得多
    float h = hemY(q.x);
    float edge = h + scallop(q.x);
    float cover = 1.0 - smoothstep(edge - 3.0, edge + 3.0, q.y);
    vec3 col;
    vec3 sharp = pageAt(p);
    if (cover > 0.001) {
      // 頭紗後面：紙被霧化、模糊
      vec3 acc = sharp;
      float a0 = hash12(sp) * 6.2832;
      for (int i = 0; i < 9; i++) {
        float fi = float(i) + 0.5, ang = fi * 2.39996 + a0;
        acc += pageAt(p + vec2(cos(ang), sin(ang)) * 7.0 * sqrt(fi / 9.0));
      }
      acc /= 10.0;
      // 布的皺褶：往下散開的直條，褶子裡布比較多層（比較白、比較霧），褶峰有一點光澤
      float fold = 0.5 + 0.5 * sin(q.x / (58.0 + 0.03 * max(q.y, 0.0)) + 1.8 * snoise(vec2(q.x / 430.0, sway * 0.12)) + 0.6 * sin(q.x / 23.0 + sway));
      float lace = laceAt(q, h);
      float haze = 0.2 + 0.26 * fold * fold + 0.55 * lace;
      // 網眼：三組細線組成的六角網（很淡）
      float l1 = abs(fract((q.x + q.y * 0.577) / 9.0) - 0.5), l2 = abs(fract((q.x - q.y * 0.577) / 9.0) - 0.5), l3 = abs(fract(q.y / 7.8) - 0.5);
      float net = 1.0 - smoothstep(0.08, 0.26, min(min(l1, l2), l3));
      vec3 veil = mix(acc, C_BONE, haze) + C_BONE * (0.035 * net + 0.07 * smoothstep(0.82, 1.0, fold));
      // 蕾絲的立體：花紋的邊一點點灰
      veil *= 1.0 - 0.08 * lace * (1.0 - lace) * 4.0;
      col = mix(sharp, veil, cover);
    } else {
      col = sharp;
      // 蕾絲的影子落在紙上（往右下偏、很柔）
      vec2 qs = q - vec2(26.0, 38.0);
      float es = hemY(qs.x) + scallop(qs.x);
      float sh = 1.0 - smoothstep(es - 20.0, es + 30.0, qs.y);
      col *= 1.0 - 0.08 * sh;
    }
    fragColor = vec4(col, 1.0);
  }`, {
  page: { value: null }, lyr: { value: null }, bake: { value: null },
  hem: { value: 1300 }, arch: { value: 0 }, sway: { value: 0 }, gust: { value: 0 },
  dPage: { value: new THREE.Vector2() }, dVeil: { value: new THREE.Vector2() },
});

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
      const short = Array.from(m.text).length <= 8;
      const blk = fitWithSig(c, m.text, fam, WIT.w, WIT.h, { min: 56, max: short ? 140 : 110, lineHeight: 1.3, maxLines: 5 }, { ratio: 0.46, min: 42, max: 58 });
      const top = WIT.y + Math.max(0, (WIT.h - blk.height) * 0.4);
      const pl = placeBlock(c, blk, fam, sig, WIT.x, top);
      drawBlock(c, blk, pl, fam, sig, { color: rgba('sepia', 0.94), sigColor: rgba('sepia', 0.72) });
      this.avoid = [pl.rect, [VOW.x - 20, 440, VOW.w + 40, 300]];
      label(foot, VOW.x, 930, rgba('sepia', 0.42));
    } else {
      // 沒有留言：誓詞放大到中間；見證人欄是一條空白的簽名線與邀請
      this.st = { ...this.st, size: 82, minSize: 56, maxWidth: 1340, align: 'left' };
      this.vx = 290; this.vy = 560;
      label('誓詞 · VOWS', this.vx, LABEL_Y + 40);
      c.fillStyle = rgba('sepia', 0.35);
      c.fillRect(this.vx, 794, 520, 1.4);
      label('見證人 · WITNESS', this.vx, 828);
      c.font = font(F.ming(700), 30); c.fillStyle = rgba('sepia', 0.6);
      const fit = fitText(c, INVITE_SMALL, F.ming(700), 760, 50, { min: 26, max: 30 });
      c.font = font(F.ming(700), fit.size);
      c.fillText(INVITE_SMALL, this.vx + 560, 788);
      this.avoid = [[this.vx - 20, 330, 1400, 400]];
    }
    this.page.upload();
  }

  /** 一行歌詞的排版（誓詞的字）；上一句留在上面、淡一點。 */
  private drawVow(c: CanvasRenderingContext2D, line: Line, t: number, y: number, alpha: number, dim: boolean) {
    const st = dim ? { ...this.st, active: rgba('sepia', 0.3), sung: rgba('sepia', 0.3), unsung: rgba('sepia', 0.18) } : this.st;
    const lay = layoutLyric(c, line, st);
    c.save();
    c.translate(this.vx, y - (lay.rows.length - 1) * lay.size * 1.12);
    drawLyric(c, line, t, st, lay, alpha);
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
        this.drawVow(c, prev, t, this.vy - gap * up, lerp(1, 0.9, up), up > 0.5);
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

    // ---- 頭紗：掀起來（中間先起、兩邊跟上），之後掛在上緣輕輕飄；小節線一陣風
    const u = clamp((t - this.tLift) / this.liftDur);
    const hemK = ease.inOutCubic(u);
    const hem = lerp(950, REST, hemK) + 16 * Math.sin(Math.PI * clamp((t - this.tLift - this.liftDur) / 0.7)) * (u >= 1 ? 1 : 0) * Math.exp(-(t - this.tLift - this.liftDur) * 2);
    const arch = 520 * Math.sin(Math.PI * u) + 60 * hemK;
    let gust = 0;
    for (const b of this.bars) if (t >= b) gust = Math.max(gust, Math.exp(-(t - b) * 2.2) * Math.sin(Math.min(Math.PI, (t - b) * 5)));
    const P = this.pass;
    P.u.page!.value = this.page.texture;
    P.u.lyr!.value = L.texture;
    P.u.bake!.value = ensureBake(renderer);
    P.u.hem!.value = hem;
    P.u.arch!.value = arch;
    P.u.sway!.value = t * 0.7 + 1.8 * gust;
    P.u.gust!.value = gust;
    // 鏡頭慢慢往右上漂：頭紗（近）動得比紙（遠）多
    const dr = ease.inOutQuad(f.p);
    (P.u.dPage!.value as THREE.Vector2).set(-10 + 22 * dr, 6 * noise1(t * 0.2, 4));
    (P.u.dVeil!.value as THREE.Vector2).set(-40 + 90 * dr, 14 * noise1(t * 0.25, 7));
    P.render(renderer, out);
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.5, halation: 0.04, vignette: 0.3, grain: 0.05, zoom: 1 + 0.03 * dr, popupAvoid: this.avoid };
  }
}

