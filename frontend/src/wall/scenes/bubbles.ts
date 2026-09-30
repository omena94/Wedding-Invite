// 肥皂泡（亮）：紙上一支鋼筆線畫的泡泡棒（左下角），泡泡從棒子的圈圈裡吹出來往右上飄。
//  - 主打留言被拆成一小段一小段（中文兩個字、英文一個字），每一段裝在一顆泡泡裡：泡泡的薄膜有彩虹般的反光
//    （顏色全部從色票來：訊號色一家子＋點綴色），邊緣一道細墨線、左上一道窗形的高光。
//  - 泡泡照留言的順序一顆顆吹出來、飄一下，在八分音符上「啵」地破掉（破成一圈斷掉的線＋幾滴水珠），
//    裡面的字掉下來、彈一下，落在下面排好的位置——留言就這樣一段一段排出來（最長兩小節內排完）。
//  - 每一下小鼓，棒子再吹出一串沒有字的小泡泡（真的小鼓時間）；它們飄一陣子自己破掉。
//  - 歌詞在上方一行（逐字跟唱，正在唱的字用偏深的訊號色）；冷面註記「本泡泡內含祝福，破掉後自動送達。」
//  - 沒有主打留言：泡泡裡裝「泡泡會破，祝福不會。」＋邀請；純音樂：上方寫歌名。
// 畫法：紙與所有泡泡（薄膜、邊線、高光、破掉的環）是一個 shader（泡泡的位置用 uniform 陣列傳進去）；
// 泡泡棒、字、水珠、歌詞畫在一張 Canvas2D。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, layout, loadText, measure } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp, TAU } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, beatAfter, signature, COUPLE_ZH, type LyricStyle } from './_motifs';
import { paperSignal, fitV2, no3, slowPush, INVITE_SMALL, type Rect, SYMBOLS } from './_t20';
import { lyricV2, sigV2, msgMaxFor, V2 } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'water', paper: true, energy: [0.3, 1], bars: [4, 8] };

/** shader 裡最多幾顆泡泡。 */
const NB = 40;
/** 泡泡棒的圈圈（泡泡從這裡出來）。 */
const WAND = { x: 186, y: 430, rx: 50, ry: 58, rot: -0.3 };
const LYR = { x: 150, y: 214, maxW: 1150 };
const LYR_STYLE: LyricStyle = { family: F.archivo(100, 700), size: 60, minSize: 48, maxWidth: LYR.maxW, align: 'left' };
/** 留言最後排好的位置（標準 v2：≤ 860×430，畫面左下三分之一；上面與右邊留給泡泡）。 */
const BOX = { x: 340, y: 610, w: 820, h: 300 };
const MSG_FAM = F.hand(700);
const NO_MSG = '泡泡會破，祝福不會。';
const NOTE = '本泡泡內含祝福，破掉後自動送達。';
const F_HEI = F.hei(500);

const FRAG = /* glsl */ `
uniform vec4 uB[${NB}];   // x, y, 半徑, 狀態（0..1 完整；1..2 破掉中）
uniform float uS[${NB}];  // 每顆的種子
uniform int uN;
uniform float uT, uIn;
float ease_out(float x) { return 1.0 - (1.0 - x) * (1.0 - x) * (1.0 - x); }
// 薄膜的反光：沿著色票繞一圈（訊號色 → 點綴色 → 亮的訊號色 → 暗部），不寫死任何彩虹色
vec3 film(float h) {
  h = fract(h) * 4.0;
  // 紙是亮的：顏色往暗部靠一點才看得到（淺的主題色在紙上會糊掉）
  vec3 a = mix(C_SIGNAL, C_BLOOD, 0.45), b = mix(C_ROSE, C_BLOOD, 0.25), c = C_SIGNAL, d = mix(C_BLOOD, C_SEPIA, 0.2);
  return h < 1.0 ? mix(a, b, h) : h < 2.0 ? mix(b, c, h - 1.0) : h < 3.0 ? mix(c, d, h - 2.0) : mix(d, a, h - 3.0);
}
void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  vec3 col = C_PAPER * (0.975 + 0.025 * fbm(p / 240.0, 3));
  for (int i = 0; i < ${NB}; i++) {
    if (i >= uN) break;
    vec4 b = uB[i];
    vec2 v = p - b.xy;
    float r = length(v);
    if (r > b.z * 1.35 + 4.0) continue;
    float sd = uS[i];
    if (b.w <= 1.0) {
      float a = b.w * uIn;
      vec2 lp = v / b.z;
      float q = r / b.z;
      float inside = 1.0 - smoothstep(0.985, 1.0, q);
      // 薄膜：邊緣反光強（像 Fresnel），中間幾乎透明；厚薄不均的紋路慢慢流
      float fres = 0.05 + 0.95 * pow(q, 4.0);
      // 薄膜的紋路：繞著中心的一圈圈色帶（肥皂膜的漩渦），不是一塊一塊的斑
      float ang = atan(lp.y, lp.x);
      float th = 0.55 * snoise(vec2(q * 2.4 - uT * 0.12, ang * 1.3 + sd * 10.0)) + 0.3 * snoise(lp * 1.6 + sd * 5.0 + vec2(0.0, uT * 0.1));
      vec3 f = film(th * 0.8 + q * 0.9 + sd + uT * 0.04);
      col = mix(col, f, fres * inside * 0.55 * a);
      // 細墨線的邊
      col = mix(col, C_SEPIA, pxLine(abs(r - b.z), 0.45, 1.2) * 0.5 * a);
      // 窗形的高光（左上）與一顆小亮點（右下）
      float arc = abs(length(lp - vec2(0.12, 0.14)) - 0.66);
      float win = (1.0 - smoothstep(0.03, 0.07, arc)) * smoothstep(-0.05, -0.45, lp.x + lp.y) * inside;
      col = mix(col, vec3(1.0), win * 0.75 * a);
      col = mix(col, vec3(1.0), (1.0 - smoothstep(0.05, 0.085, length(lp - vec2(0.46, 0.4)))) * 0.7 * a);
    } else {
      // 破掉：一圈斷成好幾段的線往外脹、淡掉
      float k = b.w - 1.0;
      float R2 = b.z * (1.0 + 0.3 * ease_out(k));
      float ang = atan(v.y, v.x);
      float dash = step(0.45, fract(ang * 1.9 + sd * 3.0));
      col = mix(col, C_SEPIA, pxLine(abs(r - R2), 0.4, 1.0) * dash * (1.0 - k) * 0.6 * uIn);
    }
  }
  fragColor = vec4(col, 1.0);
}`;

const BG = () => new FSPass(FRAG, {
  uB: { value: Array.from({ length: NB }, () => new THREE.Vector4()) },
  uS: { value: new Array(NB).fill(0) },
  uN: { value: 0 }, uT: { value: 0 }, uIn: { value: 1 },
});

/** 一顆泡泡：吹出來（tb）、飄、破掉（tp）；帶字的泡泡破掉之後字掉到 (tx, ty)，落地時間 tl。 */
interface Bubble {
  tb: number; tp: number; R: number; seed: number;
  /** 飄向哪裡（帶字的泡泡照閱讀順序排在上方一帶，彼此不會疊在一起）。 */
  gx: number; gy: number;
  /** 帶的字（沒有字就是裝飾的小泡泡）。 */
  text: string; tx: number; ty: number; tl: number; w: number;
}

export default class Bubbles extends Scene {
  bg = shared('bubbles.bg', BG);
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 53 + (this.msg?.id ?? 0) * 43) >>> 0;
  b0 = 0;
  bubbles: Bubble[] = [];
  size = 60;
  done = 0;
  sig: { text: string; x: number; y: number; size: number } | null = null;
  tag: { x: number; y: number } | null = null;
  invite: { x: number; y: number } | null = null;
  title = '';
  avoid: Rect[] = [];
  /** 一陣陣的風（雙數小節線）：沒有字的泡泡被吹走、大泡泡被推一下。 */
  gusts: number[] = [];
  /** 歌詞字級：有留言時比留言小一號，沒有留言時歌詞是焦點。 */
  lyrSize = 60;

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.b0 = beatAfter(au, s + 0.05);
    const beat = au.beatPeriod(this.b0);
    this.title = `♪  ${song.title}${song.artist ? '  —  ' + song.artist : ''}`;
    const text = m ? m.text : NO_MSG;
    const sigText = m ? (m.couple ? `—— ${COUPLE_ZH}` : signature(m.name)) : '';
    const lines = lyrics.linesIn(s - 2, e + 1);
    await loadText(text + sigText + NO_MSG + INVITE_SMALL + NOTE + this.title + lines.map((l) => l.text).join('') + 'FROM THE COUPLE · 新人No.0123456789' + SYMBOLS);

    // ---- 留言排好的樣子（字最後落在這裡）
    const c = this.layer.ctx;
    const tagH = m?.couple ? 34 : 0;
    // 署名的高度先照字級上限扣掉：署名永遠在最後一行下面（K 情境也一樣）
    const reserve = m ? sigV2(msgMaxFor(text)) + 16 : 52;
    // 沒有主打留言時歌詞是焦點：泡泡裡的句子小一點
    const fit = fitV2(c, text, MSG_FAM, BOX.w, BOX.h - reserve - tagH, { lineHeight: 1.26, maxLines: 4, max: m ? undefined : 44 });
    const sigSize = sigV2(fit.size);
    this.size = fit.size;
    this.lyrSize = lyricV2(m ? fit.size : null);
    const blockH = tagH + fit.height + reserve;
    const top = BOX.y + (BOX.h - blockH) / 2;

    // ---- 拆成一段一段（中文兩個字、英文一個字；標點黏在前一段），每段一顆泡泡
    interface Chunk { text: string; x: number; y: number; w: number; line: number }
    const chunks: Chunk[] = [];
    fit.lines.forEach((ln, i) => {
      const lay = layout(ln, MSG_FAM, fit.size);
      const y = top + tagH + fit.size * 0.9 + i * fit.lineHeight;
      let cur: { s: string; x0: number; x1: number; cjk: number } | null = null;
      const flush = () => { if (cur && cur.s.trim()) chunks.push({ text: cur.s.trim(), x: BOX.x + cur.x0, y, w: cur.x1 - cur.x0, line: i }); cur = null; };
      for (const g of lay.glyphs) {
        const latin = /[A-Za-z0-9'’&]/.test(g.ch);
        const punct = /[，。！？、,.!?~～…：:；;）)」』]/.test(g.ch);
        if (g.ch === ' ') { flush(); continue; }
        if (cur && !punct && (latin ? (cur.cjk > 0) : (cur.cjk >= 2 || /[A-Za-z]$/.test(cur.s)))) flush();
        if (!cur) cur = { s: '', x0: g.x, x1: g.x, cjk: 0 };
        cur.s += g.ch; cur.x1 = g.x + g.w;
        if (!latin && !punct) cur.cjk++;
      }
      flush();
    });
    // ---- 時間：第一拍開始吹，照順序；在八分音符上破掉；最後一段最晚在第一拍後兩小節（短窗格就更早）落地
    const bar = Math.max(beat * 2, au.timeOfBar(au.barAt(this.b0) + 1) - this.b0);
    const F = clamp(0.1 * chunks.length + 1.0, 1.3, Math.min(2 * bar, 0.55 * (e - this.b0)));
    const n = chunks.length;
    const b0i = au.beatAt(this.b0);
    // 泡泡一顆接一顆吹出來、只飄一下就破（同時在畫面上的只有五六顆，不會擠成一團）；
    // 每顆飄到它那段字「正上方」，破掉時字直直落進位置，不會橫著劃過別的字
    const float = clamp(0.3 * F, 0.55, 0.8);
    chunks.forEach((ch, j) => {
      const tb = this.b0 + (Math.max(0.3, F - float - 0.42) * j) / Math.max(1, n - 1);
      // 破在最近的八分音符上
      const raw = tb + float + 0.1 * hash(this.seed, j, 3);
      const tp = Math.max(tb + 0.35, au.timeOfBeat(b0i + Math.round((au.beatAt(raw) - b0i) * 2) / 2));
      const R = clamp(ch.w * 0.32 + 14, 34, 62) * (0.95 + 0.1 * hash(this.seed, j, 4));
      const gx = ch.x + ch.w / 2;
      // 同時在飄的只有連續的七八顆（最多跨兩三行）：單數行、雙數行各一條高度，就不會上下疊在一起
      const gy = (ch.line % 2 ? 424 : 322) + (j % 2 ? 12 : -8) + (hash(this.seed, j, 6) - 0.5) * 10;
      this.bubbles.push({ tb, tp, R, seed: hash(this.seed, j, 2), gx, gy, text: ch.text, tx: ch.x, ty: ch.y, tl: tp + 0.42, w: ch.w });
    });
    this.done = Math.max(...this.bubbles.map((b) => b.tl), this.b0 + 0.5);
    // ---- 小鼓：每一下吹一串沒有字的小泡泡（真的小鼓時間）
    const snares = au.events('snare', this.b0 - 0.05, e);
    snares.forEach(([ts], k) => {
      // 一下兩顆、一兩秒就破：背景要能呼吸，不要滿天泡泡
      for (let i = 0; i < 2; i++) {
        const h = hash(this.seed, k, i, 9);
        const tb = ts + i * 0.05;
        const gx = 320 + 1060 * hash(this.seed, k, i, 7), gy = 290 + 250 * hash(this.seed, k, i, 6);
        this.bubbles.push({ tb, tp: tb + 0.9 + 1.0 * hash(this.seed, k, i, 8), R: 10 + 20 * h, seed: h, gx, gy, text: '', tx: 0, ty: 0, tl: 0, w: 0 });
      }
    });

    // 右邊兩顆很大的泡泡慢慢飄（整個窗格都在，畫面右半邊才不會空著；即時小卡蓋在上面也沒關係）
    for (const [gx, gy, R, sdd] of [[1590, 500, 168, 0.31], [1420, 262, 78, 0.77]] as const) {
      this.bubbles.push({ tb: s - 30, tp: e + 30, R, seed: sdd, gx, gy, text: '', tx: 0, ty: 0, tl: 0, w: -1 });
    }
    if (m) {
      const sw = measure(sigText, MSG_FAM, sigSize);
      this.sig = { text: sigText, x: BOX.x + Math.max(fit.width, sw) - sw, y: top + tagH + fit.height + 12 + sigSize * 0.9, size: sigSize };
      if (m.couple) this.tag = { x: BOX.x, y: top + 14 };
    } else {
      this.invite = { x: BOX.x, y: top + fit.height + 42 };
    }
    for (const line of lines) layoutLyric(c, line, this.lyrStyle());
    const bw = Math.max(fit.width, m ? 0 : measure(INVITE_SMALL, F_HEI, 26));
    // 風：第一個拍點之後，每逢雙數小節一陣
    for (let b = Math.ceil(au.barAt(this.b0) / 2) * 2; au.timeOfBar(b) < e; b += 2) this.gusts.push(au.timeOfBar(b));
    // 即時小卡避開：歌詞、留言排好的位置、泡泡飄的那一帶（泡泡裡也是字）
    this.avoid = [[LYR.x - 20, LYR.y - 90, LYR.maxW + 40, 120], [BOX.x - 20, top - 20, bw + 40, blockH + 30], [300, 260, 1060, 280]];
  }

  private lyrStyle(): LyricStyle {
    return { ...LYR_STYLE, size: this.lyrSize, minSize: V2.lyrMin, active: paperSignal(), sung: rgba('sepia', 0.94), unsung: rgba('sepia', 0.3) };
  }

  /** 泡泡在 t 時的位置（從泡泡棒出來，先快後慢，左右輕輕晃）。 */
  private pos(b: Bubble, t: number) {
    // 背景的大泡泡：風來時被推一下、慢慢彈回來（像被繩子牽著）
    if (b.w < 0) {
      let dx = 0;
      for (const tg of this.gusts) { const a = t - tg; if (a > 0 && a < 5) dx += 46 * (1 - Math.exp(-3 * a)) * Math.exp(-0.8 * a) * (0.6 + 0.4 * b.seed); }
      return { x: b.gx + 18 * Math.sin(t * 0.4 + b.seed * 9) - dx, y: b.gy + 14 * Math.sin(t * 0.55 + b.seed * 4) - dx * 0.25 };
    }
    const age = Math.max(0, t - b.tb);
    // 從棒子吹出來：很快飄到目標（0.4 秒內），途中往上拱一點，之後慢慢往上浮、左右輕輕晃
    const k = 1 - Math.exp(-age * 6);
    const x0 = WAND.x + 46, y0 = WAND.y - 10;
    // 沒有字的小泡泡會被風吹走（有字的要落回自己的位置，不吹）
    let wind = 0;
    if (!b.text) for (const tg of this.gusts) if (tg > b.tb && t > tg) wind += 150 * (1 - Math.exp(-2.4 * (t - tg)));
    const x = lerp(x0, b.gx, k) + 8 * Math.sin(age * 2.2 + b.seed * 9) * k + wind;
    const y = lerp(y0, b.gy, k) - 12 * age + 5 * Math.sin(age * 1.7 + b.seed * 5) - 40 * Math.sin(Math.PI * k);
    return { x, y };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const u = this.bg.u;
    const arr = u.uB!.value as THREE.Vector4[], sd = u.uS!.value as number[];
    // 這一格看得到的泡泡：還在飄的＋正在破的；帶字的優先
    const rank = (b: Bubble) => (b.text ? 2 : b.w < 0 ? 1 : 0);
    const live = this.bubbles.filter((b) => t >= b.tb && t < b.tp + 0.2).sort((a, b) => rank(b) - rank(a)).slice(0, NB);
    live.forEach((b, i) => {
      const p = this.pos(b, Math.min(t, b.tp));
      const inflate = ease.outBack(prog(t, b.tb, b.tb + 0.28));
      const state = t < b.tp ? clamp(inflate * 1.4) : 1 + clamp((t - b.tp) / 0.2);
      arr[i]!.set(p.x, p.y, b.R * Math.max(0.3, inflate), state);
      sd[i] = b.seed;
    });
    u.uN!.value = live.length;
    u.uT!.value = t;
    u.uIn!.value = prog(t, s, s + 0.3);
    this.bg.render(renderer, out);

    const L = this.layer;
    L.clear();
    const c = L.ctx;
    this.drawWand(c, t);
    this.drawChunks(c, t);
    this.drawLyrics(c, t);
    this.drawNotes(c, t);
    comp.draw(renderer, L.upload(), out);
    return { paper: 1, popupAvoid: this.avoid, bloom: 0.1, bloomThreshold: 1.8, halation: 0.02, vignette: 0.16, grain: 0.04, ca: 0.3, zoom: slowPush(f.p) };
  }

  /** 泡泡棒：一個斜的圈圈（裡面一層薄膜）＋往左下伸出畫面的柄；吹泡泡的瞬間薄膜往右上鼓一下。 */
  private drawWand(c: CanvasRenderingContext2D, t: number) {
    const last = this.bubbles.reduce((m, b) => (b.tb <= t && b.tb > m ? b.tb : m), -1);
    const puff = last > 0 ? Math.pow(0.5, (t - last) / 0.08) : 0;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start, this.ctx.start + 0.3);
    c.translate(WAND.x, WAND.y);
    c.rotate(WAND.rot);
    // 薄膜
    c.fillStyle = rgba('rose', 0.1 + 0.08 * puff);
    c.beginPath(); c.ellipse(puff * 10, -puff * 6, WAND.rx - 4, WAND.ry - 4, 0, 0, TAU); c.fill();
    c.strokeStyle = rgba('sepia', 0.9);
    c.lineWidth = 4;
    c.beginPath(); c.ellipse(0, 0, WAND.rx, WAND.ry, 0, 0, TAU); c.stroke();
    c.lineWidth = 1.2;
    c.beginPath(); c.ellipse(0, 0, WAND.rx - 7, WAND.ry - 7, 0, 0, TAU); c.stroke();
    // 柄
    c.lineWidth = 5;
    c.lineCap = 'round';
    c.beginPath(); c.moveTo(0, WAND.ry); c.lineTo(0, WAND.ry + 260); c.stroke();
    c.restore();
  }

  /**
   * 帶字的泡泡：還在飄時字在泡泡正中間（跟著泡泡晃）；破掉之後往下掉（先加速、落地彈一下）到排好的位置，
   * 之後就留在那裡。破掉的瞬間噴出幾滴水珠。
   */
  private drawChunks(c: CanvasRenderingContext2D, t: number) {
    const size = this.size;
    c.save();
    c.font = font(MSG_FAM, size);
    c.textBaseline = 'alphabetic';
    const ink = rgba('sepia', 0.94);
    for (const b of this.bubbles) {
      if (t < b.tb) continue;
      if (!b.text) {
        this.drops(c, b, t);
        continue;
      }
      let x: number, y: number, sc = 1, alpha = 1;
      if (t < b.tp) {
        const p = this.pos(b, t);
        const inflate = ease.outBack(prog(t, b.tb, b.tb + 0.28));
        sc = Math.min(0.85, (b.R * 1.45) / Math.max(1, b.w)) * inflate;
        x = p.x; y = p.y + size * 0.34 * sc;
        // 飛的時候泡泡是空的，飄到定點才在薄膜裡浮出字（畫面才不會一團字在飛）
        alpha = 0.9 * prog(t, b.tb + 0.22, b.tb + 0.4);
      } else {
        // 掉下來：從泡泡的中心到排好的位置（水平先走、垂直加速），最後 0.1 秒彈一下
        const from = this.pos(b, b.tp);
        const q = clamp((t - b.tp) / (b.tl - b.tp));
        const qy = q < 1 ? q * q : 1;
        const bounce = q >= 1 ? -Math.max(0, Math.sin(clamp((t - b.tl) / 0.18) * Math.PI)) * 7 * (1 - clamp((t - b.tl) / 0.18)) : 0;
        const sc0 = Math.min(0.85, (b.R * 1.45) / Math.max(1, b.w));
        sc = lerp(sc0, 1, ease.outCubic(q));
        x = lerp(from.x, b.tx + b.w / 2, ease.outCubic(q));
        y = lerp(from.y + size * 0.34 * sc0, b.ty, qy) + bounce;
        // 往下掉的途中會穿過已經排好的行：半路淡一點（一閃而過），快落地時再實起來
        alpha = 1 - 0.62 * prog(q, 0.08, 0.25) * (1 - prog(q, 0.72, 0.95));
        this.drops(c, b, t);
      }
      c.save();
      c.translate(x, y);
      c.scale(sc, sc);
      c.globalAlpha = alpha;
      c.fillStyle = ink;
      // ♥ 用點綴色
      if (b.text.includes('♥')) {
        let dx = -b.w / 2;
        for (const ch of b.text) { const w = c.measureText(ch).width; c.fillStyle = ch === '♥' ? rgba('rose') : ink; c.fillText(ch, dx, 0); dx += w; }
      } else c.fillText(b.text, -b.w / 2, 0);
      c.restore();
    }
    c.globalAlpha = 1;
    if (this.sig && t > this.done) {
      c.globalAlpha = prog(t, this.done, this.done + 0.4);
      c.font = font(MSG_FAM, this.sig.size);
      c.fillStyle = paperSignal(0.95);
      c.fillText(this.sig.text, this.sig.x, this.sig.y);
    }
    if (this.tag) {
      c.globalAlpha = prog(t, this.b0, this.b0 + 0.3);
      c.font = font(F.mono(500), 16); c.letterSpacing = '4px'; c.fillStyle = paperSignal(0.95);
      c.fillText('FROM THE COUPLE · 新人', this.tag.x, this.tag.y);
      c.letterSpacing = '0px';
    }
    if (this.invite && t > this.done) {
      c.globalAlpha = prog(t, this.done, this.done + 0.4);
      c.font = font(F_HEI, 26); c.letterSpacing = '2px'; c.fillStyle = rgba('sepia', 0.75);
      c.fillText(INVITE_SMALL, this.invite.x, this.invite.y);
      c.letterSpacing = '0px';
    }
    c.restore();
  }

  /** 泡泡破掉時噴出去的水珠（六滴，0.3 秒）。 */
  private drops(c: CanvasRenderingContext2D, b: Bubble, t: number) {
    const age = t - b.tp;
    if (age < 0 || age > 0.3) return;
    const p = this.pos(b, b.tp);
    c.save();
    c.fillStyle = rgba('sepia', 0.6 * (1 - age / 0.3));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + b.seed * 6;
      const d = b.R * (1 + 1.6 * ease.outCubic(age / 0.3));
      c.beginPath();
      c.arc(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d + 40 * age * age * 10, 2.2, 0, TAU);
      c.fill();
    }
    c.restore();
  }

  /** 上方的歌詞（逐字跟唱）。 */
  private drawLyrics(c: CanvasRenderingContext2D, t: number) {
    const { lyrics } = this.ctx;
    if (!lyrics.has) {
      c.save();
      c.globalAlpha = prog(t, this.b0, this.b0 + 0.5) * 0.85;
      c.font = font(F.mono(500), 22); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.7);
      c.fillText(this.title.toUpperCase(), LYR.x, LYR.y);
      c.restore();
      return;
    }
    const ly = lyricAt(lyrics, t);
    if (!ly) return;
    const st = this.lyrStyle();
    const lay = layoutLyric(c, ly.line, st);
    c.save();
    c.translate(LYR.x, LYR.y - (lay.rows.length - 1) * lay.size * 1.18);
    drawLyric(c, ly.line, t, st, lay, ly.k);
    c.restore();
  }

  private drawNotes(c: CanvasRenderingContext2D, t: number) {
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.7);
    c.font = font(F.mono(500), 16);
    c.letterSpacing = '3px';
    c.fillStyle = rgba('sepia', 0.7);
    c.fillText(`${this.msg ? no3(this.msg.n) + '　' : ''}${NOTE}`, LYR.x, 120);
    c.restore();
  }
}
