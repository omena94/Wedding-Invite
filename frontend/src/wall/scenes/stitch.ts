// 十字繡（亮）：鏡頭貼近一個繡框，框裡繃著一塊亞麻十字繡布（Aida），主打留言在拍點上一個字一個字被繡出來。
//  - 一個焦點：留言是十字繡（每一格一個 ×，先斜的「/」再疊上「\」），用這首歌的深色（blood）繡線，最大、最清楚；
//    布上先印著淡淡的圖樣（十字繡材料包的樣子），繡到哪裡、圖樣就被線蓋掉。剛繡好的字線色偏亮，半秒後沉回繡線的顏色。
//  - 格子大小跟著留言長短走（長留言用比較細的布），字高永遠約 15 格，繡出來的字讀得到。
//  - 歌詞是「緞面繡」（斜斜的線一條條排滿字）：還沒唱是布上淡淡的印稿、正在唱的字用 blood 線、唱完是深咖啡色線，
//    比留言小一級，放在繡框上緣；署名也是緞面繡，繡完留言之後的下一拍由左往右繡上去。
//  - 沒有留言：歌詞本身變成十字繡的主角，一句一句繡（唱到哪、繡到哪），換句時舊的那句被「拆掉」（從尾巴一格格消失）；
//    純音樂又沒有留言：繡新人的名字，下面一行小小的邀請。
//  - 鏡頭：切進來時從斜上方落定（outExpo，第一拍前停好），之後慢慢推近、微微橫移；繡框的木圈比布高一點（視差），
//    布框外鬆鬆的布有皺褶。一根針跟著正在繡的地方點動（每一針一下），繡完插在布的右上角。
// 手法：一個全螢幕 shader 畫布、繡線、繡框（PlaneCam 把每個像素打回布面座標），字模是「依序出現」的資料貼圖（_t14 orderMask），
// 緞面繡的字畫在布面座標的 Canvas 圖層、在 shader 裡加上斜紋、凸起與影子；針與線用 LineBatch。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { fitText } from '../engine/text';
import type { Line } from '../engine/lyrics';
import { lyricAt, lyricSizeFor, COUPLE_ZH } from './_motifs';
import { grid, stagger, layoutRows, drawRows, paperInk, type RowsLayout } from './_t4';
import { PlaneCam, camUniforms, CAM_GLSL, orderMask, lineItems, msgBlock, INVITE, type MaskItem, type OrderMask, type MsgBlock, type Rect } from './_t14';

export const spec: PlateSpecDecl = { group: 'type', family: 'craft', paper: true, energy: [0.1, 0.75], bars: [4, 8], weight: 1 };

/** 繡框（布面座標）：圓心、內圈半徑、木圈寬。框比布高 16（鏡頭有透視時會跟布錯開一點）。 */
const HOOP = { x: 930, y: 560, r: 815, w: 58 };
/** 有留言：留言（十字繡）＋署名在這一塊；歌詞（緞面繡）在上緣。 */
const MSG_BOX = { x: 270, y: 268, w: 1270, h: 520 };
const LYR = { x: 300, y: 204, w: 1160 };
/** 沒有留言：十字繡的歌詞在中間這一塊，邀請在下面。 */
const BIG = { x: 290, y: 300, w: 1290, h: 420 };
const INVITE_Y = 842;
/** 字模的解析度（每布面 px 幾個貼圖 px）：只在每一格的中心取樣，一半就夠。 */
const MS = 0.5;
const MAXC = 96;
const FAM_X = F.hei(700); // 十字繡：偏粗的黑體，縮成格子還讀得到（900 的筆畫會糊成一塊）
const FAM_SATIN = F.archivo(100, 700);
const FAM_SIG = F.hand(700);
const SLOT_H = 440;
/** 針停下來插在布上的地方（右上角，繡框裡）。 */
const PARK = { x: 1500, y: 300 };

const BG = () => new FSPass(/* glsl */ `
  ${CAM_GLSL}
  uniform sampler2D mask; uniform vec4 mR; uniform vec2 mOff; uniform vec4 mClip;
  uniform float cell; uniform vec4 cI[${MAXC}]; uniform float nC; uniform float now;
  uniform float legT; uniform float stencilA; uniform float mode; uniform float unpick; uniform float hasMask;
  uniform sampler2D satin; uniform vec4 hoop; uniform float focus; uniform float aperture;

  // 一條繡線的明暗：圓柱（中間亮、兩側暗）、朝左上方的那側受光、兩股線的撚紋
  vec3 thread(vec3 base, float sd, float al, float hwv, float side, float detail) {
    float x = clamp(sd / hwv, -1.0, 1.0);
    float up = sqrt(max(0.0, 1.0 - x * x));
    float twist = 0.5 + 0.5 * sin((al * 5.0 + x * 0.8) * TAU);
    return base * (0.6 + 0.4 * up - 0.12 * x * side) * (0.9 + 0.18 * twist * detail);
  }

  void main() {
    vec2 sp = SP();
    vec3 h0 = pcHit(sp, 0.0);
    vec2 P = h0.xy;
    float blur = aperture * abs(h0.z - focus) / max(h0.z, 1.0);
    vec2 fwP = fwidth(P);
    float ppx = max(fwP.x, fwP.y) * (1.0 + blur * 0.6);

    // ---- 布：Aida 的一格一格（中間鼓起、格與格之間的縫、四角的小洞、細織紋）
    vec2 g = P / cell; vec2 id = floor(g); vec2 f = g - id;
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
    float pat = 1.0 - 0.06 * gapL - 0.035 * weave - 0.08 * dot(q, q) - 0.3 * hole + 0.05 * slub;
    col *= mix(0.955, pat, detail);

    // ---- 框外的布：鬆的、有皺褶、暗一點；框的影子（光從左上來，影子偏右下）
    vec2 hp = P - hoop.xy;
    float r0 = length(hp);
    float ang = atan(hp.y, hp.x);
    float outside = smoothstep(hoop.z + hoop.w * 0.6, hoop.z + hoop.w + 6.0, r0);
    float fold = sin(ang * 34.0 + 2.6 * snoise(vec2(ang * 2.2, r0 / 240.0)) + r0 / 90.0);
    col *= mix(1.0, 0.84 + 0.07 * fold + 0.04 * snoise(P / 90.0), outside);
    float rs = length(P - hoop.xy - vec2(9.0, 12.0));
    float shIn = smoothstep(hoop.z - 36.0, hoop.z + 2.0, rs) * (1.0 - smoothstep(hoop.z + hoop.w, hoop.z + hoop.w + 30.0, rs));
    col *= 1.0 - 0.3 * shIn;

    // ---- 繡線（字模：A 覆蓋、G 第幾個字、B 字裡的順序、R 愛心）
    if (hasMask > 0.5) {
      vec2 cc = (id + 0.5) * cell + mOff;
      vec2 mu = (cc - mR.xy) / mR.zw;
      // 只看這一句自己的那一格（字模裡上下還有別句）
      if (cc.x > mClip.x && cc.y > mClip.y && cc.x < mClip.z && cc.y < mClip.w) {
        vec4 m = texture(mask, mu);
        if (m.a > 0.5) {
          int i = min(int(floor(m.g * 255.0 + 0.5)), ${MAXC - 1});
          float sw = m.b;
          vec4 ci = cI[i];
          float ts = ci.x + sw * ci.y;
          float a1 = now - ts, a2 = a1 - legT;
          // 換句時從尾巴一格格拆掉
          float keep = 1.0 - step(0.0001, unpick) * step(1.0 - unpick, (float(i) + sw) / max(nC, 1.0));
          bool heart = m.r > 0.5;
          float v1 = step(0.0, a1) * keep, v2 = step(0.0, a2) * keep;
          float sd1 = (f.x + f.y - 1.0) * 0.7071, al1 = (f.x - f.y + 1.0) * 0.5;
          float sd2 = (f.y - f.x) * 0.7071, al2 = (f.x + f.y) * 0.5;
          // 還沒繡：印在布上的圖樣（兩條細斜線）
          float st = max(1.0 - smoothstep(0.03, 0.05 + aa, abs(sd1)), 1.0 - smoothstep(0.03, 0.05 + aa, abs(sd2)));
          col = mix(col, mix(C_SEPIA, C_ASH, 0.35), st * stencilA * (1.0 - v1) * mix(0.7, 1.0, detail));
          // 線色：留言用這首歌的深色、剛繡好的偏亮；歌詞正在唱 blood、唱完深咖啡
          vec3 settled = mode < 0.5 ? mix(C_BLOOD, C_SEPIA, 0.12) : C_SEPIA * 1.2;
          vec3 act = mode < 0.5 ? mix(C_BLOOD, C_SIGNAL, 0.5) : mix(C_BLOOD, C_SIGNAL, 0.22) * 1.08;
          if (heart) { settled = mix(C_ROSE, C_BLOOD, 0.22); act = C_ROSE; }
          float fresh = mode < 0.5 ? 1.0 - sat((now - ts - legT) / 0.7) : (now < ci.z ? 1.0 : 1.0 - sat((now - ci.z) / 0.25));
          vec3 thc = mix(settled, act, fresh);
          float hw = 0.2;
          float t1 = hw * (0.72 + 0.28 * sin(PI * sat(al1))), t2 = hw * (0.72 + 0.28 * sin(PI * sat(al2)));
          float c1 = 1.0 - smoothstep(t1 - aa, t1 + aa, abs(sd1));
          float c2 = 1.0 - smoothstep(t2 - aa, t2 + aa, abs(sd2));
          // 線在布上的影子（偏右下）
          float s1 = 1.0 - smoothstep(t1, t1 + 0.12 + aa, abs(sd1 - 0.05));
          float s2 = 1.0 - smoothstep(t2, t2 + 0.12 + aa, abs((f.y - 0.06 - f.x + 0.03) * 0.7071));
          col *= 1.0 - 0.26 * max(s1 * v1, s2 * v2);
          col = mix(col, thread(thc, sd1, al1, t1, 1.0, detail), c1 * v1);
          col *= 1.0 - 0.28 * v2 * v1 * (1.0 - smoothstep(t2, t2 + 0.1 + aa, abs(sd2))) * (1.0 - c2);
          col = mix(col, thread(thc * 1.04, sd2, al2, t2, 0.0, detail), c2 * v2);
        }
      }
    }

    // ---- 緞面繡的字（布面座標的圖層）：影子、凸起的明暗、斜斜的線紋
    vec4 s = fastLayer(texture(satin, pageUV(P)));
    // 影子只給真的繡上去的線（還沒唱的印稿很淡，平方之後幾乎沒有影子）
    float sh = texture(satin, pageUV(P - vec2(1.4, 2.0))).a;
    col *= 1.0 - 0.22 * sh * sh * (1.0 - s.a);
    if (s.a > 0.002) {
      float ax = texture(satin, pageUV(P + vec2(1.6, 0.0))).a - texture(satin, pageUV(P - vec2(1.6, 0.0))).a;
      float ay = texture(satin, pageUV(P + vec2(0.0, 1.6))).a - texture(satin, pageUV(P - vec2(0.0, 1.6))).a;
      float lit = 1.0 + 0.3 * (ax * 0.6 + ay * 0.8) * s.a;
      float stripe = 0.8 + 0.26 * (0.5 + 0.5 * sin((P.x - P.y) * TAU / 3.8));
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
      float grain = 0.5 + 0.5 * sin(an * 520.0 + rr * 0.35 + 6.0 * snoise(vec2(an * 5.0, rr / 25.0)));
      vec3 wood = mix(mix(C_PAPER, C_BLOOD, 0.18), C_SEPIA, 0.3 + 0.1 * grain);
      // 上過亮光漆的木頭：受光那側一條細細的高光
      float spec = pow(sat(toL * 0.8 + face * 0.4), 12.0);
      vec3 wc = wood * (0.5 + 0.38 * face + 0.3 * toL) + C_BONE * spec * 0.25;
      float cov = smoothstep(-fr, fr, rr) * (1.0 - smoothstep(hoop.w - fr, hoop.w + fr, rr));
      float seam = 1.0 - smoothstep(0.5, 1.6 + fr, abs(rr - 25.0));
      col = mix(col, wc * (1.0 - 0.5 * seam), cov);
    }

    // 一盞燈從左上打過來：畫面右下角暗一點
    col *= 0.93 + 0.1 * exp(-dot((sp - vec2(700.0, 380.0)) / 1300.0, (sp - vec2(700.0, 380.0)) / 1300.0) * 2.0);
    fragColor = vec4(col, 1.0);
  }`, {
  ...camUniforms(),
  mask: { value: null }, mR: { value: new THREE.Vector4(0, 0, 1, 1) }, mOff: { value: new THREE.Vector2() }, mClip: { value: new THREE.Vector4(-1e9, -1e9, 1e9, 1e9) },
  cell: { value: 8 }, cI: { value: Array.from({ length: MAXC }, () => new THREE.Vector4(1e9, 0.2, 1e9, 0)) },
  nC: { value: 1 }, now: { value: 0 }, legT: { value: 0.06 }, stencilA: { value: 0.2 }, mode: { value: 0 }, unpick: { value: 0 }, hasMask: { value: 0 },
  satin: { value: null }, hoop: { value: new THREE.Vector4(HOOP.x, HOOP.y, HOOP.r, HOOP.w) }, focus: { value: 1600 }, aperture: { value: 3 },
});

/** 十字繡的一個「句子」：字模裡的一格（atlas 的 slot）、每個字的時間。 */
interface Slot { items: MaskItem[]; times: { s: number; d: number; e: number }[]; off: [number, number]; line: Line | null; clip: Rect }

export default class Stitch extends Scene {
  bg = shared('stitch.bg', BG);
  /** 緞面繡的字（布面座標）。 */
  satin = this.track(new Layer2D(W, H, undefined, { fast: true }));
  pins = this.track(new LineBatch(256, { screen2D: true, blend: 'normal' }));
  cam = new PlaneCam();
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 131 + (this.msg?.id ?? 0) * 17) >>> 0;
  mask: OrderMask | null = null;
  block: MsgBlock | null = null;
  slots: Slot[] = [];
  /** 沒有留言：歌詞一句一格；純音樂就一格新人的名字。 */
  lyricMode = false;
  cell = 8;
  sigT = Infinity; sigDur = 0.6;
  t0 = 0; tDone = 0;
  lyrSize = 52;
  hasLyrics = false;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const c = this.satin.ctx;
    const gr = grid(au, s, e);
    this.t0 = gr.b0;
    const ls = lyrics.linesIn(s - 0.5, e + 0.4);
    this.hasLyrics = ls.length > 0;
    const names = COUPLE_ZH.replace(/\s*&\s*/, ' ♥ ');
    await loadText(`${m?.text ?? ''}${m ? (m.couple ? '—— 新郎新娘' : m.name) : ''}${ls.map((l) => l.text).join('')}${names}${INVITE}${song.title}${song.artist}——一位賓客`);

    if (m) {
      // ---- 有留言：留言十字繡、署名緞面繡
      const b = (this.block = msgBlock(c, m, FAM_X, MSG_BOX, { align: 'center', sigFamily: FAM_SIG, sigMin: 42, sigMax: 54, min: 48, max: 150, lineHeight: 1.22, maxLines: 5 }));
      this.cell = clamp(b.fit.size / 16.5, 4, 10);
      const items = lineItems(b.lines, FAM_X, b.fit.size);
      const n = items.length;
      const times = stagger(au, this.t0, n, Math.min(gr.bar * 1.75, Math.max(gr.beat, (e - this.t0) * 0.5)));
      const tt = times.map((ts, i) => {
        const next = times[i + 1] ?? ts + (n > 1 ? times[1]! - times[0]! : gr.beat);
        const d = clamp((next - ts) * 0.9, 0.08, 0.45);
        return { s: ts, d, e: ts + d };
      });
      this.slots = [{ items, times: tt, off: [0, 0], line: null, clip: [-1e9, -1e9, 2e9, 2e9] }];
      const pad = this.cell * 2;
      const [bx, by, bw, bh] = b.box;
      this.mask = this.track(orderMask(items, [bx - pad, by - pad, bw + pad * 2, bh + pad * 2], MS, 'diag'));
      const last = tt[tt.length - 1]!;
      this.tDone = last.e + 0.1;
      this.sigT = Math.max(this.tDone, au.timeOfBeat(Math.ceil(au.beatAt(this.tDone) - 1e-3)));
      if (this.sigT > e - 1.2) this.sigT = Math.max(this.tDone, e - 1.2);
      this.sigDur = clamp(gr.beat * 1.2, 0.4, 0.8);
      this.lyrSize = lyricSizeFor(b.fit.size);
      this.avoid = [b.box, [LYR.x - 10, LYR.y - 64, LYR.w + 20, 140]];
    } else {
      // ---- 沒有留言：歌詞一句一句十字繡；純音樂繡新人的名字
      this.lyricMode = true;
      const texts: { text: string; line: Line | null }[] = ls.length ? ls.slice(0, 10).map((l) => ({ text: l.text, line: l })) : [{ text: names, line: null }];
      let maxSize = 150;
      const fits = texts.map((tx) => fitText(c, tx.text, FAM_X, BIG.w, BIG.h, { min: 60, max: 150, lineHeight: 1.2, maxLines: 2 }));
      // 同一個窗格的每一句用同一種布（格子一樣大）：以最小的字級決定格子
      for (const ft of fits) maxSize = Math.min(maxSize, ft.size);
      this.cell = clamp(maxSize / 16.5, 4, 9.5);
      const allItems: MaskItem[] = [];
      texts.forEach((tx, k) => {
        const ft = fits[k]!;
        c.font = font(FAM_X, ft.size);
        const top = (BIG.h - ft.height) / 2 + ft.size * 0.9;
        const rows = ft.lines.map((ln, i) => ({ text: ln, x: (BIG.w - c.measureText(ln).width) / 2, y: k * SLOT_H + top + i * ft.lineHeight }));
        const items = lineItems(rows, FAM_X, ft.size);
        const times = tx.line ? this.glyphTimes(tx.line, rows, ft.size) : this.nameTimes(items.length, gr);
        allItems.push(...items.map((it, i) => ({ ...it, idx: i })));
        this.slots.push({ items, times, off: [-BIG.x, -BIG.y + k * SLOT_H], line: tx.line, clip: [0, k * SLOT_H, BIG.w, SLOT_H] });
      });
      // 所有句子放在同一張字模裡（一句一格，由上往下），shader 用位移挑現在那一句
      this.mask = this.track(orderMask(allItems, [0, 0, BIG.w, SLOT_H * texts.length], MS, 'x'));
      this.avoid = [[BIG.x, BIG.y, BIG.w, BIG.h], [BIG.x, INVITE_Y - 40, 900, 60]];
    }
  }

  /** 沒有留言時一句歌詞的每個字：在它那個字（英文是那個詞，照字母平分）唱到時繡，唱完那個詞才算完成。 */
  private glyphTimes(line: Line, rows: { text: string; x: number; y: number }[], _size: number) {
    const out: { s: number; d: number; e: number }[] = [];
    let cursor = 0;
    for (const r of rows) {
      const at = line.text.indexOf(r.text, cursor), base = at >= 0 ? at : cursor;
      cursor = base + r.text.length;
      let o = base;
      for (const ch of Array.from(r.text)) {
        const len = ch.length;
        if (ch.trim()) {
          const wd = line.words.find((w) => o >= w.o && o < w.o + w.w.length);
          if (wd) {
            const L = Math.max(1, wd.w.length), dur = Math.max(0.05, wd.end - wd.start);
            const st = wd.start + ((o - wd.o) / L) * dur;
            out.push({ s: st, d: Math.min(0.25, Math.max(0.06, dur / L)), e: wd.end });
          } else out.push({ s: line.start, d: 0.2, e: line.start + 0.3 });
        }
        o += len;
      }
    }
    return out;
  }

  /** 新人的名字：從第一拍開始一拍一個字。 */
  private nameTimes(n: number, gr: ReturnType<typeof grid>) {
    const ts = stagger(this.ctx.audio, gr.b0, n, gr.bar * 1.5);
    return ts.map((s) => ({ s, d: Math.min(0.35, gr.beat * 0.8), e: s + 0.5 }));
  }

  /** 沒有留言時，t 這一刻繡的是第幾句（-1 = 沒有）。 */
  private slotAt(t: number): number {
    if (!this.lyricMode) return 0;
    if (!this.slots[0]?.line) return 0;
    const ly = lyricAt(this.ctx.lyrics, t, 1.2, 0.35);
    if (ly) { const k = this.slots.findIndex((sl) => sl.line === ly.line); if (k >= 0) return k; }
    // 兩句之間：留著剛唱完的那一句；窗格一開始還沒唱：先印著第一句的圖樣
    const last = this.ctx.lyrics.lastLine(t);
    const k = this.slots.findIndex((sl) => sl.line === last);
    return k >= 0 ? k : 0;
  }

  /** 換句前 0.28 秒開始拆：回傳拆掉的比例（0..1）。換句的時間用二分找（t 的純函數）。 */
  private unpickAt(t: number, cur: number): number {
    const W0 = 0.28;
    if (this.slotAt(t + W0) === cur) return 0;
    let lo = t, hi = t + W0;
    for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (this.slotAt(mid) === cur) lo = mid; else hi = mid; }
    return clamp(1 - (hi - t) / W0);
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
      tx: 945 + side * 30 * (p - 0.5) + 260 * exit,
      ty: 548 - 60 * (1 - land),
      dist: F0 * (1.1 - 0.1 * land) * (1 - 0.045 * ease.inOutQuad(p)) * (1 + 0.04 * exit),
      pitch: 0.17 + 0.1 * (1 - land),
      yaw: -0.05 * side + 0.03 * side * (1 - land) + 0.1 * exit,
      roll: 0.035 * side * (1 - land) - 0.004 * side,
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
    u.cell!.value = this.cell;
    u.focus!.value = this.cam.toScreen(945, 520).depth;
    u.hasMask!.value = this.mask ? 1 : 0;
    const L = this.satin; L.clear();
    const c = L.ctx;
    c.textBaseline = 'alphabetic';
    let needle: { x: number; y: number; ph: number } | null = null;

    if (this.mask) {
      const mk = this.mask;
      u.mask!.value = mk.tex;
      (u.mR!.value as THREE.Vector4).set(mk.rect[0], mk.rect[1], mk.rect[2], mk.rect[3]);
    }
    if (!this.lyricMode && this.block) {
      // ---- 有留言
      const sl = this.slots[0]!;
      this.setSlot(sl, 0);
      u.mode!.value = 0;
      u.stencilA!.value = 0.2 * prog(t, s, s + 0.4);
      u.unpick!.value = 0;
      u.legT!.value = 0.07;
      needle = this.needleAt(sl, t);
      // 署名：緞面繡，由左往右一段一段繡上去
      const b = this.block, sg = b.sig;
      const k = prog(t, this.sigT, this.sigT + this.sigDur, ease.inOutQuad);
      if (k > 0) {
        c.save();
        c.beginPath(); c.rect(sg.x - 10, sg.y - sg.size * 1.2, (sg.w + 20) * k, sg.size * 1.6); c.clip();
        c.font = font(FAM_SIG, sg.size); c.fillStyle = rgba('sepia', 0.95);
        c.fillText(sg.text, sg.x, sg.y);
        c.restore();
        if (k < 1) needle = { x: sg.x + sg.w * k, y: sg.y - sg.size * 0.35, ph: (t - this.sigT) * 9 };
      }
      if (this.msg?.couple) this.smallLabel(c, 'FROM THE COUPLE  ·  新人', b.box[0], b.box[1] - 4, t);
      // 歌詞：上緣一行緞面繡
      const ly = lyricAt(lyrics, t);
      if (ly) {
        const st = { family: FAM_SATIN, size: this.lyrSize, minSize: 48, maxW: LYR.w, maxRows: 1, align: 'left' as const };
        const lay: RowsLayout = layoutRows(c, ly.line, st);
        c.save(); c.translate(LYR.x, LYR.y); drawRows(c, lay, FAM_SATIN, t, paperInk(), ly.k); c.restore();
      }
    } else {
      // ---- 沒有留言：歌詞（或新人的名字）十字繡
      const cur = this.slotAt(t);
      const sl = this.slots[cur];
      if (sl) {
        this.setSlot(sl, cur);
        u.mode!.value = sl.line ? 1 : 0;
        u.stencilA!.value = sl.line ? 0.5 : 0.2;
        u.unpick!.value = this.unpickAt(t, cur);
        u.legT!.value = 0.05;
        needle = this.needleAt(sl, t);
      }
      c.font = font(F.hei(500), 28); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.72 * prog(t, s + 0.3, s + 0.9));
      c.fillText(INVITE, BIG.x, INVITE_Y);
      c.letterSpacing = '0px';
      if (!this.hasLyrics) {
        const song = this.ctx.song;
        c.font = font(F.mono(500), 18); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.55);
        c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`.toUpperCase(), BIG.x, 236);
        c.letterSpacing = '0px';
      }
    }
    u.satin!.value = L.upload();
    this.bg.render(renderer, out);
    this.drawNeedle(t, needle);
    if (this.pins.count) this.pins.render(renderer, out);
    return { paper: 1, bloom: 0.35, vignette: 0.42, grain: 0.045, popupAvoid: this.avoid };
  }

  /** 把一句的時間與字模位移交給 shader。 */
  private setSlot(sl: Slot, _k: number) {
    const u = this.bg.u;
    const arr = u.cI!.value as THREE.Vector4[];
    for (let i = 0; i < MAXC; i++) {
      const x = sl.times[i];
      if (x) arr[i]!.set(x.s, x.d, x.e, 0); else arr[i]!.set(1e9, 0.2, 1e9, 0);
    }
    u.nC!.value = sl.items.length;
    (u.mOff!.value as THREE.Vector2).set(sl.off[0], sl.off[1]);
    (u.mClip!.value as THREE.Vector4).set(sl.clip[0], sl.clip[1], sl.clip[0] + sl.clip[2], sl.clip[1] + sl.clip[3]);
  }

  /** 針在哪裡：正在繡的那個字（照它的斜掃順序），ph 是「第幾針」（一針一下）。 */
  private needleAt(sl: Slot, t: number): { x: number; y: number; ph: number } | null {
    const its = sl.items, ts = sl.times;
    // 字模座標 → 布面座標
    const ox = -sl.off[0], oy = -sl.off[1];
    for (let i = 0; i < its.length; i++) {
      const tm = ts[i]!;
      if (t < tm.s - 0.12) {
        if (i === 0) return null;
        // 兩個字之間：從上一個字跳到這一個
        const a = its[i - 1]!, b = its[i]!, ta = ts[i - 1]!;
        const k = ease.inOutCubic(clamp((t - (ta.s + ta.d)) / Math.max(0.05, tm.s - ta.s - ta.d)));
        return { x: lerp(a.x + a.w, b.x, k) + ox, y: lerp(a.y - a.size * 0.1, b.y - b.size * 0.8, k) + oy, ph: 0 };
      }
      if (t < tm.s + tm.d + 0.05) {
        const it = its[i]!, k = clamp((t - tm.s) / tm.d);
        return { x: it.x + it.w * k + ox, y: it.y - it.size * 0.8 + it.size * 0.9 * k + oy, ph: (t - tm.s) / 0.07 };
      }
    }
    return null;
  }

  /**
   * 針（鋼色的細線、一個針眼）與拖著的繡線：針尖在正在繡的地方，每一針往布裡點一下；沒在繡就插在右上角。
   * 布面座標算好再投影到螢幕（針尾離布比較高，有透視）。
   */
  private drawNeedle(t: number, nd: { x: number; y: number; ph: number } | null) {
    const pb = this.pins; pb.clear();
    const s = this.ctx.start;
    const park = { x: PARK.x, y: PARK.y };
    let tip = park, dip = 0, parked = !nd;
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
    // 針眼：一個小小的長圈
    const e1 = cam.toScreen(tip.x + 104, tip.y - 51, parked ? -62 : -78 - 12 * dip), e2 = cam.toScreen(tip.x + 114, tip.y - 56, parked ? -68 : -84 - 13 * dip);
    pb.seg2(e1.x, e1.y, e2.x, e2.y, 1.6, [LIN.paper[0], LIN.paper[1], LIN.paper[2]], ent);
    // 繡線：從針眼垂下來、繞回布面（一段往下彎的曲線）
    const thr = this.lyricMode ? LIN.sepia : LIN.blood;
    // 線：從針眼拖出來，鬆鬆地躺回布上（往右下方一段三次曲線）
    const ez = parked ? -66 : -82 - 13 * dip;
    const P0 = [tip.x + 112, tip.y - 55, ez], P3 = [tip.x + 150, tip.y + 170, 0];
    const P1 = [P0[0]! + 70, P0[1]! + 30, ez * 0.5], P2 = [P3[0]! + 50, P3[1]! - 90, 0];
    let prev = e2;
    for (let i = 1; i <= 16; i++) {
      const k = i / 16, a0 = (1 - k) ** 3, a1 = 3 * k * (1 - k) ** 2, a2 = 3 * k * k * (1 - k), a3 = k ** 3;
      const x = a0 * P0[0]! + a1 * P1[0]! + a2 * P2[0]! + a3 * P3[0]!;
      const y = a0 * P0[1]! + a1 * P1[1]! + a2 * P2[1]! + a3 * P3[1]!;
      const z = a0 * P0[2]! + a1 * P1[2]! + a2 * P2[2]! + a3 * P3[2]!;
      const p = cam.toScreen(x, y, z);
      pb.seg2(prev.x, prev.y, p.x, p.y, 2.2 * p.scale, [thr[0], thr[1], thr[2]], ent);
      prev = p;
    }
  }

  private smallLabel(c: CanvasRenderingContext2D, text: string, x: number, y: number, t: number) {
    c.font = font(F.mono(500), 18); c.letterSpacing = '4px';
    c.fillStyle = rgba('blood', 0.8 * prog(t, this.ctx.start + 0.3, this.ctx.start + 0.9));
    c.fillText(text, x, y);
    c.letterSpacing = '0px';
  }
}
