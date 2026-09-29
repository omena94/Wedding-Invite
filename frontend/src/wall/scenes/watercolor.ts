// 水彩（亮）：冷壓水彩紙上，留言事先用留白膠寫好了（乾掉的留白膠是淡淡的、有一點反光的膜，看得出字形但不搶眼）。
// 拍點上一支大排筆從左往右刷過一道水彩（一行字一道），顏料碰到留白膠刷不上去——刷過的地方，字就留成白的。
// 水彩的樣子：剛刷過的地方濕亮、筆的前緣推著一道深色的水珠；乾了以後邊緣積色（咖啡圈）、顏料沉在紙的凹處（顆粒）、
// 筆刷最後一段水不夠，拖出乾擦的飛白；兩道重疊的地方顏色疊深（罩染）。留白膠的字邊也會積一點色，字更清楚。
//  - 一個焦點：刷出來的白字（主打留言）。署名與歌詞是鉛筆字：署名在最後一道刷完後一拍寫上去，歌詞在下緣逐字跟唱（正在唱的是色鉛筆）。
//  - 沒有留言：每一句歌詞各刷一道，筆刷跟著歌聲走（唱到哪刷到哪，還沒唱的字是留白膠的淡膜），一句一行往下畫，鏡頭跟著往下搖；
//    純音樂又沒有留言：一筆刷出新人的名字，下面鉛筆寫邀請。
//  - 鏡頭：留言時跟著筆刷的前緣橫移（刷完回到中間、慢慢推近）；歌詞時跟著一句一句往下搖。
// 手法：一個全螢幕 shader（PlaneCam）：每一道筆刷是一條有波動的帶子（uniform 陣列：起訖、中心、寬、前緣位置、刷完的時間），
// 顏料的濃度用吸收疊（罩染自然變深），紙的齒與纖維取 _t21 烤好的紋理；留白膠是 init() 做好的字模。鉛筆字是紙面座標的 Canvas 圖層。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash } from '../engine/util';
import { Lyrics, type Line, type Word } from '../engine/lyrics';
import { lyricAt, lyricSizeFor, COUPLE_ZH } from './_motifs';
import { grid, stagger, layoutRows, drawRows, type Grid, type KaraokeInk } from './_t4';
import { PlaneCam, camUniforms, CAM_GLSL } from './_t14';
import { loadAll, sigOf, t21Grain, GRAIN_GLSL, glyphMask, groupLine, block, T21_INVITE, type Block, type TGlyph, type TGroup, type GlyphMask, type Rect } from './_t21';

export const spec: PlateSpecDecl = { group: 'type', family: 'print', paper: true, energy: [0.2, 0.85], bars: [4, 8], weight: 1 };

const MAXS = 8;
const MSG_BOX = { x: 220, y: 170, w: 1480, h: 610 };
/** 留言時歌詞寫在紙的下緣（鉛筆）。 */
const LYR = { x: 220, y: 962, w: 1100 };
const FAM = F.hand(700);
const FAM_PEN = F.hand(400);
/** 沒有留言時一句一行往下畫：第 k 句的中心 y。 */
const ROW0 = 400, ROW_GAP = 330;

const BG = () => new FSPass(/* glsl */ `
  ${CAM_GLSL}
  ${GRAIN_GLSL}
  uniform float t;
  uniform sampler2D mA; uniform vec4 rA; uniform float aA;
  uniform sampler2D mB; uniform vec4 rB; uniform float aB;
  uniform vec4 sG[${MAXS}]; uniform vec4 sF[${MAXS}]; uniform int nS;
  uniform sampler2D pen;

  vec4 maskAt(sampler2D m, vec4 r, vec2 p) {
    vec2 uv = (p - r.xy) / r.zw;
    return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(m, uv);
  }
  vec3 absorb(vec3 c, vec3 base) { return -log(clamp(c / base, vec3(0.004), vec3(1.0))); }

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
    for (int i = 0; i < ${MAXS}; i++) {
      if (i >= nS) break;
      vec4 G = sG[i], Fz = sF[i];
      if (Fz.w <= 0.0) continue;
      float x0 = G.x, x1 = G.y, hw = G.w, front = Fz.x, seed = Fz.z;
      // 帶子的中心線：一點點起伏（手刷的）
      float yc = G.z + 12.0 * sin(P.x / 260.0 + seed) + 5.0 * sin(P.x / 91.0 + seed * 1.7);
      float dy = P.y - yc, ady = abs(dy);
      // 邊緣：大的起伏＋一點點小的（水彩的邊是圓順的，不是撕紙）
      float hwx = hw * (1.0 + 0.09 * snoise(vec2(P.x / 170.0, seed + (dy > 0.0 ? 5.0 : 0.0)))) + 6.0 * nzL + 1.3 * nz;
      if (ady > hwx + 20.0 || P.x < x0 - 60.0 || P.x > front + 40.0) continue;
      float u = ady / max(hw, 1.0);
      // 起筆是圓的（筆落下來）、前緣也是圓的（筆還在走）
      float startCap = smoothstep(-2.0, 3.0, P.x - (x0 + 36.0 * u * u) - 6.0 * nzL);
      float fx = front - 34.0 * u * u + 5.0 * nzL;
      float painted = smoothstep(fx + 2.0, fx - 2.0, P.x);
      float inBand = smoothstep(hwx + 2.2, hwx - 2.2, ady) * startCap;
      // 收筆的最後一段水不夠：沿著筆的方向拉出乾擦的飛白
      float along = clamp((P.x - x0) / max(x1 - x0, 1.0), 0.0, 1.0);
      float tail = smoothstep(0.8, 1.02, along);
      float streak = snoise(vec2(P.x / 90.0, P.y / 3.2) + seed * 3.0) * 0.5 + 0.5;
      float dry = smoothstep(0.2, 0.55, streak + 0.25 * gran + 1.0 - tail * 1.25);
      float cov = inBand * painted * dry;
      if (cov <= 0.0) continue;
      // 濕：前緣後面 280 px 還是濕的；整道刷完之後 0.7 秒內乾掉
      float wet = (1.0 - smoothstep(0.0, 280.0, front - P.x)) * (1.0 - smoothstep(0.0, 0.7, t - Fz.y));
      // 回流的水花（backrun）：每道一兩朵，裡面顏料被推開變淡、邊緣一圈深
      vec3 hb = hash33(vec3(seed, 3.1, 9.7));
      vec2 bc = vec2(mix(x0, x1, 0.2 + 0.6 * hb.x), G.z + (hb.y - 0.5) * hw);
      float br = (0.45 + 0.35 * hb.z) * hw;
      float bd = length(P - bc) + 14.0 * nzL + 6.0 * nz - br;
      float bloomIn = smoothstep(4.0, -10.0, bd) * (1.0 - wet);
      float bloomRim = exp(-pow(bd / 5.0, 2.0)) * (1.0 - wet);
      // 顏料：起筆最濃、往下沉（下緣濃一點）；顆粒沉在紙的凹處；乾了以後邊緣積色
      float edge = exp(-max(hwx - ady, 0.0) / 12.0) * inBand;
      float den = cov * (0.7 + 0.16 * nzL + 0.1 * snoise(P / 320.0 + seed) + 0.1 * nz + 0.3 * gran * (1.0 - wet) + 0.2 * (1.0 - along) + 0.16 * smoothstep(-hw, hw, dy))
                * (1.0 - 0.38 * bloomIn)
                + cov * (edge * 0.7 * (1.0 - 0.6 * wet) + bloomRim * 0.35);
      // 碰到留白膠刷不上去；膠的邊緣積一點色
      den *= 1.0 - 0.95 * res;
      den += cov * ring * 0.45 * (1.0 - wet);
      // 每一道的顏色：訊號色的暗部往訊號色偏一點（每道不一樣），加一點點墨（有深度）
      float hk = fract(seed * 0.618);
      vec3 pig = mix(mix(C_BLOOD, C_SIGNAL, 0.18 + 0.3 * hk), C_SEPIA, 0.12 + 0.1 * (1.0 - hk));
      A += absorb(pig, pap) * den;
      wetAll = max(wetAll, wet * cov);
      cover = max(cover, cov);
      // 前緣推著的水珠：一條深色的線，上緣一點反光
      bead = max(bead, exp(-pow((fx - P.x) / 7.0, 2.0)) * inBand * dry * step(front, x1 - 1.0));
    }
    vec3 col = pap * exp(-A);
    // 水珠與濕亮：濕的地方顏色深一點、有一點反光
    col *= 1.0 - 0.28 * bead - 0.08 * wetAll;
    col += C_BONE * (0.05 * wetAll * smoothstep(0.55, 0.8, gr.a) + 0.08 * bead * smoothstep(0.4, 0.7, snoise(P / 7.0)));
    // 還沒刷到的留白膠：淡淡的膜（有一點灰、左上一點反光）
    float film = res * (1.0 - cover);
    vec2 gm = vec2(maskAt(mA, rA, P + vec2(2.0, 0.0)).a - maskAt(mA, rA, P - vec2(2.0, 0.0)).a, maskAt(mA, rA, P + vec2(0.0, 2.0)).a - maskAt(mA, rA, P - vec2(0.0, 2.0)).a) * aA;
    col = mix(col, mix(pap, C_ASH, 0.55), 0.14 * film);
    col += C_BONE * 0.06 * clamp(-(gm.x + gm.y), 0.0, 1.0) * (1.0 - cover);
    // 刷過之後留白的字：紙白，邊上一圈很淡的膠
    col = mix(col, pap * 1.01, res * cover * 0.9);
    // 愛心不留白：刷過之後用點綴色（玫瑰）點上去；還沒刷到是淡淡的一顆
    float heart = smoothstep(0.3, 0.7, max(ma.r, mb.r));
    col *= exp(-absorb(C_ROSE, pap) * heart * (0.2 + 1.1 * cover));
    // 鉛筆字（Canvas，紙面座標）：石墨只卡在紙的齒上
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
});

/** 一道筆刷：起訖 x、中心 y、半寬；t0～t1 從起點刷到終點（留言）或跟著歌聲（歌詞）。 */
interface Stroke { x0: number; x1: number; y: number; hw: number; t0: number; t1: number; seed: number }
/** 沒有留言時一句歌詞：留白膠的字模、一道筆刷、每個字的位置（筆刷跟著歌聲走）。 */
interface LineSet { line: Line; mask: GlyphMask; stroke: Stroke; words: { x: number; w: number; word: Word }[]; cy: number }

export default class Watercolor extends Scene {
  bg = shared('watercolor.bg', BG);
  /** 鉛筆字（紙面座標），每格重畫。 */
  pen = this.track(new Layer2D(W, H, undefined, { fast: true }));
  cam = new PlaneCam();
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 71 + (this.msg?.id ?? 0) * 13) >>> 0;
  g!: Grid;
  block: Block | null = null;
  mask: GlyphMask | null = null;
  strokes: Stroke[] = [];
  lines: LineSet[] = [];
  /** 署名（鉛筆）開始寫的時間。 */
  tSig = Infinity;
  lyrSize = 52;
  hasLyrics = false;
  names = COUPLE_ZH.replace(/\s*&\s*/, ' ♥ ');
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    await loadAll(this.ctx, this.names);
    const g = (this.g = grid(au, s, e));
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
    const c = this.pen.ctx;
    if (m) {
      const bo = { align: 'left' as 'left' | 'center', sigFamily: FAM_PEN, sigMin: 44, sigMax: 60, min: 50, max: 150, lineHeight: 1.4, maxLines: 5, sigText: sigOf(m) };
      let b = block(c, m, FAM, MSG_BOX, bo);
      // 只有一行的短留言：那一道刷在畫面正中間（靠左的話右邊空一大片）
      if (b.lines.length === 1) b = block(c, m, FAM, MSG_BOX, { ...bo, align: 'center' });
      this.block = b;
      // 一個字一個字（♥ 換成我們自己的愛心）
      const glyphs: TGlyph[] = [], groups: TGroup[] = [];
      for (const ln of b.lines) groupLine(ln.text, ln.x, ln.y, FAM, b.fit.size, 99, 0, glyphs, groups);
      this.mask = this.track(glyphMask(glyphs, [], 2, 7, 40, 0, Math.max(1.2, b.fit.size * 0.012), true));
      // 一行一道：從第一拍開始一拍一道（行多就半拍），每道刷 0.35～0.6 秒；最多花窗格的四成
      const ts = stagger(au, g.b0, b.lines.length, clamp((e - g.b0) * 0.4, g.beat, 4));
      const dur = clamp(g.beat * 0.9, 0.35, 0.6);
      b.lines.forEach((ln, i) => {
        const r = hash(this.seed, i);
        this.strokes.push({ x0: ln.x - 70 - 50 * r, x1: ln.x + ln.w + 80 + 70 * hash(this.seed, i, 2), y: ln.y - b.fit.size * 0.36, hw: b.fit.lineHeight * 0.6, t0: ts[i]!, t1: ts[i]! + dur, seed: 1 + 13.7 * hash(this.seed, i, 3) });
      });
      this.tSig = (ts[ts.length - 1] ?? g.b0) + dur + g.beat * 0.5;
      // 鏡頭開場時稍微拉遠一點：歌詞多留一點字級，縮小之後也不會小於 48 px
      this.lyrSize = Math.max(52, lyricSizeFor(b.fit.size));
      this.avoid = [b.box, [LYR.x, LYR.y - 64, LYR.w, 84]];
    } else if (this.hasLyrics) {
      // 沒有留言：窗格裡每一句一行（往下排），各做一張留白膠的字模、一道筆刷
      const ls = lyrics.linesIn(s - 1, e);
      ls.forEach((line, k) => {
        const lay = layoutRows(c, line, { family: FAM, size: 124, minSize: 64, maxW: 1400, maxRows: 2, align: 'center', lineHeight: 1.2 });
        const cy = ROW0 + k * ROW_GAP;
        const y0 = cy - lay.height / 2 + lay.size * 0.8;
        const glyphs: TGlyph[] = [];
        const words = lay.words.map((pw) => {
          glyphs.push({ ch: pw.word.w, x: W / 2 + pw.x, y: y0 + pw.y, w: pw.w, size: lay.size, family: FAM, g: 0 });
          return { x: W / 2 + pw.x, w: pw.w, word: pw.word };
        });
        if (!glyphs.length) return;
        const mask = this.track(glyphMask(glyphs, [], 2, 7, 40, 0, Math.max(1.2, lay.size * 0.012), true));
        const x0 = Math.min(...words.map((w) => w.x)) - 90, x1 = Math.max(...words.map((w) => w.x + w.w)) + 100;
        const stroke = { x0, x1, y: cy, hw: Math.max(lay.height * 0.5 + lay.size * 0.2, lay.size * 0.72), t0: line.start - 0.3, t1: line.end, seed: 1 + 13.7 * hash(this.seed, k, 3) };
        this.lines.push({ line, mask, stroke, words, cy });
      });
      this.avoid = [[200, 220, 1520, 560]];
    } else {
      // 純音樂又沒有留言：一筆刷出新人的名字
      c.font = font(FAM, 180);
      const w = c.measureText(this.names).width, x = (W - w) / 2, y = 560;
      const glyphs: TGlyph[] = [], groups: TGroup[] = [];
      groupLine(this.names, x, y, FAM, 180, 99, 0, glyphs, groups);
      this.mask = this.track(glyphMask(glyphs, [], 2, 7, 40, 0, 2, true));
      this.strokes.push({ x0: x - 110, x1: x + w + 120, y: y - 66, hw: 150, t0: g.b0, t1: g.b0 + clamp(g.beat * 1.6, 0.5, 0.9), seed: 3.3 });
      this.avoid = [[x - 60, 380, w + 120, 250], [LYR.x, 900, 1100, 80]];
    }
  }

  /** 留言的筆刷前緣（outCubic：落筆很快、收筆慢下來）。 */
  private frontOf(s: Stroke, t: number) {
    return t < s.t0 ? -1e5 : s.x0 + (s.x1 - s.x0 + 60) * ease.outCubic(clamp((t - s.t0) / (s.t1 - s.t0)));
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
    if (t >= last.word.end) x = last.x + last.w + (s.x1 + 60 - last.x - last.w) * ease.outCubic(clamp((t - last.word.end) / 0.35));
    return x;
  }

  /** 現在這一句（沒有留言時）。 */
  private curLine(t: number) {
    let k = -1;
    for (let i = 0; i < this.lines.length; i++) if (this.lines[i]!.stroke.t0 <= t) k = i;
    return k;
  }

  private pose(t: number) {
    const s = this.ctx.start, e = this.ctx.end;
    const land = ease.outExpo(prog(t, s, s + Math.min(1.1, this.g.beat * 2.2)));
    const push = prog(t, s, e, ease.inOutQuad);
    const side = hash(this.seed, 5) < 0.5 ? -1 : 1;
    let tx = 960, ty = 540;
    if (this.lines.length) {
      // 一句一行往下：鏡頭在新的一句開始前 0.5 秒搖過去（inOutCubic）
      const k = Math.max(0, this.curLine(t));
      const prev = Math.max(0, k - 1);
      const cur = this.lines[k]!;
      const mv = ease.inOutCubic(clamp((t - (cur.stroke.t0 - 0.5)) / 0.7));
      ty = (this.lines[prev]!.cy + (cur.cy - this.lines[prev]!.cy) * (k === 0 ? 1 : mv)) + 40;
      const f = this.lyricFront(cur, t);
      tx = 960 + 0.06 * (clamp(f, cur.stroke.x0, cur.stroke.x1) - 960);
    } else if (this.strokes.length) {
      // 跟著正在刷的那一道的前緣橫移；刷完回到中間
      let fx = 960, w = 0;
      for (const st of this.strokes) {
        const k = clamp((t - st.t0 + 0.2) / 0.4) * (1 - clamp((t - st.t1) / 0.8));
        if (k > 0) { fx = fx * (1 - k) + clamp(this.frontOf(st, t), st.x0, st.x1) * k; w = Math.max(w, k); }
      }
      tx = 960 + 0.08 * (fx - 960) * w;
    }
    return {
      tx, ty, dist: 1600 * (1.06 - 0.06 * land - 0.04 * push),
      pitch: 0.12 - 0.08 * land, yaw: side * (0.09 - 0.05 * land), roll: side * 0.01 * (1 - land), level: 0.8, focal: 1600,
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
    const SG = u.sG!.value as THREE.Vector4[], SF = u.sF!.value as THREE.Vector4[];
    let n = 0;
    const put = (st: Stroke, front: number, done: number, a = 1) => {
      if (n >= MAXS) return;
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
    if (this.lines.length) {
      const k = this.curLine(t);
      const cur = this.lines[Math.max(0, k)]!, prev = k > 0 ? this.lines[k - 1]! : null;
      bindMask('A', cur.mask, 1);
      bindMask('B', prev?.mask ?? null, 1);
      if (k >= 0) put(cur.stroke, this.lyricFront(cur, t), cur.line.end + 0.35);
      if (prev) put(prev.stroke, this.lyricFront(prev, t), prev.line.end + 0.35);
    } else {
      bindMask('A', this.mask, 1);
      bindMask('B', null, 0);
      for (const st of this.strokes) put(st, this.frontOf(st, t), st.t1);
    }
    u.nS!.value = n;

    // ---- 鉛筆字
    const P = this.pen; P.clear();
    const c = P.ctx;
    const graphite = mixRgba('graphite', 'ink', 0.45, 0.95);
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
        const lay = layoutRows(c, ly.line, { family: FAM_PEN, size: this.lyrSize, minSize: 48, maxW: LYR.w, maxRows: 2, align: 'left' });
        c.save(); c.translate(LYR.x, LYR.y - (lay.rows.length - 1) * lay.lineHeight);
        drawRows(c, lay, FAM_PEN, t, ink, ly.k);
        c.restore();
      } else if (!this.hasLyrics) {
        this.small(c, `♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`, LYR.x, LYR.y - 12, F.mono(500), 20, 4);
      }
      if (this.msg.couple) this.small(c, 'FROM THE COUPLE  ·  新人', MSG_BOX.x, 132, F.mono(500), 18, 5, rgba('blood', 0.8));
    } else if (this.lines.length) {
      // 邀請用鉛筆寫在紙的最上面（第一句的上方；鏡頭往下搖之後就出畫了）
      this.small(c, T21_INVITE, 220, ROW0 - 200, F.hei(500), 26, 4, rgba('graphite', 0.75));
    } else {
      this.small(c, T21_INVITE, LYR.x, LYR.y - 12, F.hei(500), 28, 4, rgba('graphite', 0.8));
      this.small(c, `♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`, LYR.x, LYR.y - 62, F.mono(500), 18, 4);
    }
    u.pen!.value = P.upload();
    this.bg.render(renderer, out);
    return {
      paper: 1, bloom: 0.2, vignette: 0.38, grain: 0.035,
      popupAvoid: this.avoid.map((r) => this.cam.screenRect(r, 10)),
    };
  }

  private small(c: CanvasRenderingContext2D, text: string, x: number, y: number, family: string, size: number, tracking: number, color = rgba('graphite', 0.7)) {
    c.font = font(family, size); c.letterSpacing = `${tracking}px`; c.fillStyle = color;
    c.fillText(text, x, y);
    c.letterSpacing = '0px';
  }
}
