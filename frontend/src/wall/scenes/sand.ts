// 沙畫（暗）：從上往下看一個燈箱，玻璃上鋪了一層沙，燈從下面透上來——沙厚的地方是暗的，手指撥開的地方透出暖暖的光。
// 2026-09-29 依「留言尺寸與版面比例標準 v2」重做構圖：
//  - 場景是主視覺：右邊一幅沙畫在拍點上一筆一筆畫出來——一彎月亮、兩道山稜、山上一棵樹、一條彎彎的小路、一顆一顆的星星；
//    畫完之後每一小節手指再彈出一顆流星（窗格長時中段也一直有事件）。右下角 HUD 底下是堆高的沙（暗），不擋時間與 QR。
//  - 留言在左邊，是被手指撥開的字（霞鶩文楷，40～60 px，照 _v2），拍點上一個字一個字撥出來：剛撥開的地方最亮，
//    筆畫兩邊被推開的沙堆起一道暗暗的邊；愛心底下透玫瑰色的光。署名在最後一行下面（26～32 px）。
//  - 歌詞在下面一條「沙帶」裡（40～52 px，比留言小）：還沒唱的字是淺淺的一道、唱到的字撥開透出訊號色的光、唱完是暖白的光；
//    換句的時候一隻看不見的手把沙抹回去（一道抹痕由左往右掃過），新的一句再寫上去。
//  - 窗格最後半拍，一大把沙從一邊抹過整個燈箱（下一幅）。
//  - 沒有留言：歌詞在左邊當焦點（52 px、最多兩行），下面一行淺淺的邀請；純音樂又沒有留言：撥出新人的名字。
// 手法：一個全螢幕 shader（PlaneCam：燈箱是一張平面；沙的厚度＝底紋 − 撥開的字＋被推開的沙），留言是 _t14 的「依序出現」字模
// （每個字撥開的時間在 uniform 陣列），沙畫、歌詞畫在燈箱座標的 Canvas 圖層（透明度 = 撥開多少）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, hash } from '../engine/util';
import { lyricAt, COUPLE_ZH } from './_motifs';
import { grid, stagger, layoutRows, drawRows, type KaraokeInk } from './_t4';
import { PlaneCam, camUniforms, CAM_GLSL, orderMask, lineItems, msgBlockV2, INVITE, type OrderMask, type MsgBlock, type MaskItem, type Rect } from './_t14';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'craft', paper: false, energy: [0.05, 0.7], bars: [4, 8], weight: 1 };

/** 燈箱的發光範圍（燈箱座標）。 */
const BOX = { x0: 110, y0: 80, x1: 1810, y1: 1000 };
/** 留言在左邊這一塊（螢幕上寬 ≤ 860、高 ≤ 430，init 依鏡頭縮放換算），沙畫在右邊。 */
const MSG_BOX = { x: 200, y: 250, w: 800, h: 430 };
/** 歌詞的沙帶：有留言時在下面一行；沒有留言時放大在中間。 */
const LYR_S = { x: 220, y: 880, w: 1080 };
const LYR_B = { x: 220, y: 440, w: 780 };

// ---------------------------------------------------------------- 沙畫（燈箱座標，右半邊）
type Pt = [number, number];
/** 一筆：一串點（照畫的順序）、筆寬、開始時間與長度。 */
interface Stroke { pts: Pt[]; w: number; t0: number; d: number; dot?: boolean }
const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n = 40): Pt[] => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
const wave = (x0: number, y0: number, x1: number, y1: number, amp: number, k: number, ph: number, n = 60): Pt[] => Array.from({ length: n + 1 }, (_, i) => { const u = i / n; return [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u - amp * Math.sin(Math.PI * u * k + ph) * Math.sin(Math.PI * u)]; });
/** 近的山稜的高度（樹、小路要長在它上面）：跟 wave(1020, 660, 1740, 620, 70, 1.6, 0.4) 同一條線。 */
const HILL = (x: number) => { const u = (x - 1020) / 720; return 660 - 40 * u - 70 * Math.sin(Math.PI * u * 1.6 + 0.4) * Math.sin(Math.PI * u); };
const FAM_MSG = F.hand(700);
const FAM_LYR = F.hand(700);
const MAXC = 80;
const MS = 0.5;

const BG = () => new FSPass(/* glsl */ `
  ${CAM_GLSL}
  uniform sampler2D mask; uniform vec4 mR; uniform float hasMask;
  uniform vec2 cI[${MAXC}]; uniform float t;
  uniform sampler2D lyr; uniform vec4 box;
  uniform vec3 wipe;     // 歌詞帶的抹痕：前緣 x、帶的上緣 y、下緣 y（沒有在抹：x = -1e4）
  uniform float exitX;   // 窗格最後一抹的前緣（對角線座標），之前的地方沙被抹回去
  uniform float glow;

  // 字模：這一點被撥開了多少（0..1）；heartAt：這裡是不是愛心（愛心底下墊一片玫瑰色的玻璃紙）
  float heartAt(vec2 q) {
    vec2 mu = (q - mR.xy) / mR.zw;
    if (hasMask < 0.5 || mu.x < 0.0 || mu.y < 0.0 || mu.x > 1.0 || mu.y > 1.0) return 0.0;
    return step(0.5, texture(mask, mu).r);
  }
  float dug(vec2 q) {
    vec2 mu = (q - mR.xy) / mR.zw;
    if (hasMask < 0.5 || mu.x < 0.0 || mu.y < 0.0 || mu.x > 1.0 || mu.y > 1.0) return 0.0;
    vec4 m = texture(mask, mu);
    if (m.a < 0.01) return 0.0;
    m.a = smoothstep(0.25, 0.75, m.a);
    int i = min(int(floor(m.g * 255.0 + 0.5)), ${MAXC - 1});
    vec2 ci = cI[i];
    float r = sat((t - ci.x - m.b * ci.y) / 0.06);
    return m.a * r;
  }

  void main() {
    vec2 sp = SP();
    vec2 P = pcHit(sp, 0.0).xy;
    float px = max(max(fwidth(P.x), fwidth(P.y)), 0.3);
    // 燈箱：框裡發光，四周是深色的木框與桌面
    vec2 bq = abs(P - (box.xy + box.zw) * 0.5) - (box.zw - box.xy) * 0.5;
    float inBox = 1.0 - smoothstep(-2.0, 2.0, max(bq.x, bq.y));
    float edgeGlow = smoothstep(-260.0, 0.0, max(bq.x, bq.y));
    vec3 lightC = mix(mix(C_EMBER, C_SIGNAL, 0.35), C_BONE, 0.3) * (1.08 - 0.25 * edgeGlow) * glow;
    // 沙的厚度：底紋（一片一片不均、有手抹過的弧紋）
    // 手掌抹勻的沙：大片的濃淡很平順，加上一道道弧形的抹紋與細細的沙粒
    // 中間的沙薄一點（燈箱中央透出一團暖光），往四周越來越厚
    vec2 cc = (P - vec2(960.0, 470.0)) / vec2(900.0, 560.0);
    float D = 1.32 - 0.4 * exp(-dot(cc, cc) * 1.6) + 0.07 * snoise(P / 520.0) + 0.035 * snoise(P / 110.0);
    D += 0.035 * sin(length(P - vec2(1500.0, -300.0)) / 17.0 + 2.5 * snoise(P / 380.0));
    D += 0.07 * (hash12(floor(P * 0.9)) - 0.5) * sat(1.4 - px);
    // 右下角：推到角落堆高的沙（燈透不過來，HUD 的字才讀得清楚）
    D += 0.9 * smoothstep(1180.0, 1440.0, P.x) * smoothstep(700.0, 860.0, P.y);
    // 撥開的字：邊緣是手指撥出來的毛邊；字裡面留一點點沙；字的旁邊被推開的沙堆高一點
    vec2 jit = vec2(snoise(P / 5.0), snoise(P / 5.0 + 9.1)) * 1.5;
    float d0 = dug(P + jit);
    float nb = 0.25 * (dug(P + vec2(8.0, 0.0)) + dug(P - vec2(8.0, 0.0)) + dug(P + vec2(0.0, 8.0)) + dug(P - vec2(0.0, 8.0)));
    float resid = 0.07 + 0.035 * snoise(P / 7.0) + 0.02 * snoise(P / 2.2);
    D = mix(D, resid, d0) + 0.4 * max(nb - d0, 0.0);
    // 歌詞與波浪（Canvas 圖層，透明度 = 撥開多少；顏色 = 透出來的光的顏色）
    vec4 L = fastLayer(texture(lyr, pageUV(P + jit)));
    float la = 0.25 * (texture(lyr, pageUV(P + vec2(7.0, 0.0))).a + texture(lyr, pageUV(P - vec2(7.0, 0.0))).a + texture(lyr, pageUV(P + vec2(0.0, 7.0))).a + texture(lyr, pageUV(P - vec2(0.0, 7.0))).a);
    D = mix(D, resid, L.a) + 0.35 * max(la - L.a, 0.0);
    // 歌詞帶正在被抹：前緣附近是一道橫的抹痕（沙被拖出一條條紋）
    if (P.y > wipe.y && P.y < wipe.z) {
      float f = P.x - wipe.x;
      float streak = 0.5 + 0.5 * snoise(vec2(P.x / 160.0, P.y / 4.0));
      D += (1.0 - smoothstep(0.0, 90.0, abs(f))) * 0.5 * streak;
    }
    // 最後一抹：對角線前緣之前的地方沙回來了（抹過去的痕跡還在）
    float diag = (P.x + P.y * 0.6);
    if (diag < exitX) {
      float streak = 0.5 + 0.5 * snoise(vec2(diag / 300.0, (P.y - P.x * 0.6) / 5.0));
      D = max(D, 0.95 + 0.25 * streak);
    }
    D += (1.0 - smoothstep(0.0, 120.0, abs(diag - exitX))) * 0.4;
    // 透光：沙越厚越暗；沙本身在上面被一點點室內光照到（暖暗的顆粒）
    float Tr = exp(-3.2 * max(D, 0.0));
    float grain = 0.75 + 0.25 * snoise(P / 1.7) * sat(1.5 - px);
    vec3 sandC = mix(C_SEPIA, C_BLOOD, 0.25) * 0.14 * grain;
    vec3 lit = lightC * mix(vec3(1.0), L.a > 0.02 ? L.rgb / max(L.a, 1e-3) : vec3(1.0), sat(L.a * 1.2) * 0.85);
    lit = mix(lit, C_ROSE * 0.95 * glow, heartAt(P + jit) * d0);
    vec3 col = lit * Tr + sandC * (1.0 - Tr);
    // 框外：深色的桌面與木框
    vec3 outside = C_INK * (0.6 + 0.2 * snoise(P / 200.0)) + mix(C_SEPIA, C_INK2, 0.5) * 0.3 * (1.0 - smoothstep(0.0, 40.0, max(bq.x, bq.y))) * step(0.0, max(bq.x, bq.y));
    col = mix(outside + lightC * 0.04 * exp(-max(max(bq.x, bq.y), 0.0) / 120.0), col, inBox);
    fragColor = vec4(col, 1.0);
  }`, {
  ...camUniforms(),
  mask: { value: null }, mR: { value: new THREE.Vector4(0, 0, 1, 1) }, hasMask: { value: 0 },
  cI: { value: Array.from({ length: MAXC }, () => new THREE.Vector2(1e9, 0.2)) }, t: { value: 0 },
  lyr: { value: null }, box: { value: new THREE.Vector4(BOX.x0, BOX.y0, BOX.x1, BOX.y1) },
  wipe: { value: new THREE.Vector3(-1e4, 0, 0) }, exitX: { value: -1e4 }, glow: { value: 1 },
});

export default class Sand extends Scene {
  bg = shared('sand.bg', BG);
  /** 歌詞、波浪（燈箱座標）。 */
  lyr = this.track(new Layer2D(W, H, undefined, { fast: true }));
  cam = new PlaneCam();
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 59 + (this.msg?.id ?? 0) * 23) >>> 0;
  mask: OrderMask | null = null;
  block: MsgBlock | null = null;
  items: MaskItem[] = [];
  times: { s: number; d: number }[] = [];
  /** 沙畫的每一筆（月亮、山、樹、小路、星星、之後每小節一顆流星）。 */
  strokes: Stroke[] = [];
  lyr0 = { ...LYR_S, size: 52 };
  k = 1;
  hasLyrics = false;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const c = this.lyr.ctx;
    const gr = grid(au, s, e);
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
    const names = COUPLE_ZH.replace(/\s*&\s*/, ' ♥ ');
    await loadText(`${m?.text ?? ''}${m ? (m.couple ? '—— 新郎新娘' : m.name) : ''}${names}${INVITE}${song.title}${song.artist}——一位賓客`);
    // 鏡頭在留言那一塊的縮放（窗格中間的姿勢）：畫在燈箱上的字級要除以它，畫面上才是標準的大小
    this.cam.set(this.pose((s + e) / 2));
    const k = (this.k = this.cam.toScreen(MSG_BOX.x + MSG_BOX.w / 2, MSG_BOX.y + MSG_BOX.h / 2).scale);
    let items: MaskItem[] = [];
    if (m) {
      const b = (this.block = msgBlockV2(c, m, FAM_MSG, { x: MSG_BOX.x, y: MSG_BOX.y, w: Math.min(MSG_BOX.w, 860 / k), h: Math.min(MSG_BOX.h, 430 / k) }, { align: 'left', sigFamily: FAM_MSG, scale: k, lineHeight: 1.34 }));
      items = lineItems(b.lines, FAM_MSG, b.fit.size);
      // 署名字小：不加粗（加粗會糊成一團）
      items.push(...lineItems([{ text: b.sig.text, x: b.sig.x, y: b.sig.y }], FAM_MSG, b.sig.size, items.length).map((it) => ({ ...it, thick: 0.4 })));
      this.lyr0 = { ...LYR_S, size: lyricV2(b.fit.size * k) / k };
      this.avoid = [this.cam.screenRect(b.box, 10)];
    } else {
      this.lyr0 = { ...LYR_B, size: lyricV2(null) / k };
      if (!this.hasLyrics) {
        const size = 60 / k;
        items = lineItems([{ text: names, x: LYR_B.x, y: 470 }], FAM_MSG, size);
      }
      this.avoid = [this.cam.screenRect([LYR_B.x, 320, LYR_B.w, 260], 10)];
    }
    this.items = items;
    if (items.length) {
      const n = items.length;
      // 留言從第一拍開始一拍一個字（長的一拍兩、四個），一小節半內（或窗格的一半）撥完；署名在最後
      const ts = stagger(au, gr.b0, n, Math.min(gr.bar * 1.75, Math.max(gr.beat * 2, (e - gr.b0) * 0.5)));
      this.times = ts.map((t0, i) => ({ s: t0, d: clamp(((ts[i + 1] ?? t0 + gr.beat) - t0) * 0.85, 0.08, 0.45) }));
      const x0 = Math.min(...items.map((g) => g.x)) - 30, x1 = Math.max(...items.map((g) => g.x + g.w)) + 30;
      const y0 = Math.min(...items.map((g) => g.y - g.size)) - 30, y1 = Math.max(...items.map((g) => g.y + g.size * 0.35)) + 30;
      const thick = clamp(items[0]!.size * 0.012, 0.5, 1);
      this.mask = this.track(orderMask(items, [x0, y0, x1 - x0, y1 - y0], MS, 'diag', 3, thick));
    }
    // ---- 沙畫：一拍一筆（兩小節內、或窗格的六成內畫完），之後每一小節一顆流星
    const R = (i: number) => hash(this.seed, i);
    const tx = 1300 + (R(1) - 0.5) * 60;
    const shapes: Omit<Stroke, 't0' | 'd'>[] = [
      { pts: arc(1560, 250, 70, Math.PI * 0.42, Math.PI * 1.58), w: 22 }, // 月亮（一彎）
      // 遠的山稜（細、在上面），在樹那裡斷開（樹在它前面）
      { pts: wave(1060, 520, 1740, 500, 26, 2.2, 1.2).filter(([x]) => x < tx - 70), w: 6 },
      { pts: wave(1060, 520, 1740, 500, 26, 2.2, 1.2).filter(([x]) => x > tx + 70), w: 6 },
      { pts: wave(1020, 660, 1740, 620, 70, 1.6, 0.4), w: 12 }, // 近的山稜
      { pts: [[tx, HILL(tx) - 4], [tx - 3, HILL(tx) - 80], [tx + 2, HILL(tx) - 130]], w: 11 }, // 樹幹
      // 樹冠：一圈蓬蓬的輪廓（半徑帶五個鼓起來的包），從樹幹頂端繞一圈回來
      { pts: Array.from({ length: 49 }, (_, i): Pt => { const a = Math.PI * 0.5 + (i / 48) * Math.PI * 2; const r = 56 + 11 * Math.abs(Math.sin(a * 2.5)); return [tx + Math.cos(a) * r * 1.1, HILL(tx) - 185 - Math.sin(a) * r * 0.9 + 0]; }), w: 8 },
      // 小路：從畫面下方彎彎地走上山、走到樹下
      { pts: Array.from({ length: 30 }, (_, i): Pt => { const u = i / 29; const x = 1150 + (tx - 60 - 1150) * u + 50 * Math.sin(u * Math.PI * 1.5); return [x, 800 - (800 - HILL(x) - 8) * u]; }), w: 6 },
    ];
    // 星星：避開月亮與樹
    for (let i = 0; i < 6; i++) {
      const x = 1060 + R(10 + i) * 640, y = 140 + R(20 + i) * 280;
      if (Math.hypot(x - 1560, y - 250) < 120 || (Math.abs(x - tx) < 100 && y > HILL(tx) - 260)) continue;
      shapes.push({ pts: [[x, y]], w: 9 + R(30 + i) * 6, dot: true });
    }
    const ts = stagger(au, gr.b0, shapes.length, Math.min(gr.bar * 2, Math.max(gr.beat * 2, (e - gr.b0) * 0.6)));
    const per = ts.length > 1 ? ts[1]! - ts[0]! : gr.beat;
    shapes.forEach((sh, i) => this.strokes.push({ ...sh, t0: ts[i]!, d: sh.dot ? 0.12 : clamp(per * 0.9, 0.15, 0.5) }));
    const done = ts[ts.length - 1]! + per;
    let j = 0;
    for (const b of gr.bars) {
      if (b < done || b > e - gr.beat * 2 || j >= 6) continue;
      const x = 1080 + R(40 + j) * 560, y = 130 + R(50 + j) * 200, len = 70 + R(60 + j) * 50;
      this.strokes.push({ pts: [[x, y], [x - len * 0.9, y + len * 0.35]], w: 4, t0: b, d: clamp(gr.beat * 0.6, 0.12, 0.3) });
      this.strokes.push({ pts: [[x, y]], w: 9, t0: b, d: 0.1, dot: true });
      j++;
    }
  }

  /** 換句的抹痕：t 這一刻歌詞帶正在被抹回去的前緣（0..1，沒有在抹 = -1）。換句的時間用二分找（t 的純函數）。 */
  private wipeAt(t: number): number {
    const WIN = 0.3;
    const ly = lyricAt(this.ctx.lyrics, t);
    const cur = ly?.line ?? null;
    const later = lyricAt(this.ctx.lyrics, t + WIN)?.line ?? null;
    if (!cur || later === cur) return -1;
    let lo = t, hi = t + WIN;
    for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if ((lyricAt(this.ctx.lyrics, mid)?.line ?? null) === cur) lo = mid; else hi = mid; }
    return clamp(1 - (hi - t) / WIN);
  }

  /** 鏡頭：幾乎正上方往下看，切進來時從轉一點、高一點的地方落定；之後很慢地轉、推近。 */
  private pose(t: number) {
    const s = this.ctx.start, e = this.ctx.end;
    const land = prog(t, s, s + 0.8, ease.outExpo);
    const p = clamp((t - s) / (e - s));
    const side = hash(this.seed, 2) < 0.5 ? -1 : 1;
    const F0 = 1700;
    return {
      tx: 960 + 14 * side * (p - 0.5), ty: 545,
      dist: F0 * (1.04 + 0.08 * (1 - land) - 0.045 * ease.inOutQuad(p)),
      pitch: 0.08 + 0.04 * (1 - land), yaw: 0.02 * side,
      roll: side * (0.035 * (1 - land) + 0.008 * (p - 0.5)), focal: F0,
    };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, lyrics, song } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    this.cam.set(this.pose(t));
    const u = this.bg.u;
    this.cam.apply(u);
    u.t!.value = t;
    u.mask!.value = this.mask?.tex ?? null;
    u.hasMask!.value = this.mask ? 1 : 0;
    if (this.mask) (u.mR!.value as THREE.Vector4).set(...this.mask.rect);
    const arr = u.cI!.value as THREE.Vector2[];
    for (let i = 0; i < MAXC; i++) { const x = this.times[i]; if (x) arr[i]!.set(x.s, x.d); else arr[i]!.set(1e9, 0.2); }
    // 燈箱的光：開頭 0.3 秒亮起來
    u.glow!.value = 0.15 + 0.85 * prog(t, s, s + 0.3, ease.outCubic);
    // 最後一抹：窗格最後半拍，對角線前緣從左上掃到右下
    const exD = Math.min(0.45, 0.12 * (e - s));
    const ex = prog(t, e - exD, e - 0.03, ease.inOutCubic);
    u.exitX!.value = ex > 0 ? -300 + ex * 3100 : -1e4;

    // ---- 沙畫與歌詞（燈箱座標；透明度 = 撥開多少）
    const L = this.lyr; L.clear();
    const c = L.ctx;
    c.lineCap = 'round'; c.lineJoin = 'round';
    this.drawPicture(c, t);
    const ink: KaraokeInk = { active: rgba('signal'), sung: rgba('bone'), unsung: rgba('bone', 0.3) };
    const ly = lyricAt(lyrics, t);
    const lz = this.lyr0;
    // 兩句之間（間奏）：沒有留言時沙帶不要空著——下一句先淺淺地畫好（還沒唱），窗格裡沒有下一句就留著剛唱完的
    const nx = lyrics.nextLine(t), lsl = lyrics.lastLine(t);
    const line = ly?.line ?? (this.msg ? null : nx && nx.start < e ? nx : lsl && lsl.end > s - 4 ? lsl : null);
    if (line) {
      const st = { family: FAM_LYR, size: lz.size, minSize: 40 / this.k, maxW: lz.w, maxRows: this.msg ? 1 : 2, align: 'left' as const };
      const lay = layoutRows(c, line, st);
      const y = this.msg ? lz.y : lz.y + lay.size * 0.35 - ((lay.rows.length - 1) * lay.lineHeight) / 2;
      // 換句前一刻：一隻看不見的手把這一句由左往右抹掉
      const w = this.wipeAt(t);
      const fx = lz.x - 60 + (lay.width + 160) * Math.max(0, w);
      c.save();
      if (w >= 0) { c.beginPath(); c.rect(fx, 0, W, H); c.clip(); }
      c.translate(lz.x, y);
      drawRows(c, lay, FAM_LYR, t, ink, ly ? ly.k : 1);
      c.restore();
      const top = y - lay.size - (this.msg ? 0 : 0), bot = y + lay.size * 0.4 + (lay.rows.length - 1) * lay.lineHeight;
      (u.wipe!.value as THREE.Vector3).set(w >= 0 ? fx : -1e4, top - 20, bot + 20);
    } else (u.wipe!.value as THREE.Vector3).set(-1e4, 0, 0);
    if (!this.msg) {
      c.font = font(F.hand(700), 28 / this.k); c.fillStyle = rgba('bone', 0.5 * prog(t, s + 0.4, s + 1));
      c.fillText(INVITE, LYR_B.x, 700);
      if (!this.hasLyrics) {
        c.font = font(F.mono(500), 18 / this.k); c.letterSpacing = '4px'; c.fillStyle = rgba('bone', 0.4);
        c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`.toUpperCase(), LYR_B.x, 760);
        c.letterSpacing = '0px';
      }
    } else if (this.msg.couple) {
      c.font = font(F.mono(500), 18); c.letterSpacing = '4px'; c.fillStyle = rgba('signal', 0.6);
      c.fillText('FROM THE COUPLE  ·  新人', MSG_BOX.x, (this.block?.box[1] ?? MSG_BOX.y) - 16);
      c.letterSpacing = '0px';
    }
    u.lyr!.value = L.upload();
    this.bg.render(renderer, out);
    return { bloom: 0.55, bloomThreshold: 0.9, vignette: 0.55, halation: 0.3, popupAvoid: this.avoid };
  }

  /** 畫沙畫：每一筆照時間畫出一段（手指沿著線走），星星在它的那一拍一下子撥開。 */
  private drawPicture(c: CanvasRenderingContext2D, t: number) {
    c.strokeStyle = c.fillStyle = rgba('bone', 0.9);
    for (const st of this.strokes) {
      const u = prog(t, st.t0, st.t0 + st.d, ease.inOutQuad);
      if (u <= 0) continue;
      if (st.dot) {
        c.beginPath(); c.arc(st.pts[0]![0], st.pts[0]![1], (st.w / 2) * ease.outBack(Math.min(1, u)), 0, Math.PI * 2); c.fill();
        continue;
      }
      const n = st.pts.length - 1, f = u * n, i = Math.floor(f);
      c.lineWidth = st.w;
      c.beginPath();
      c.moveTo(st.pts[0]![0], st.pts[0]![1]);
      for (let q = 1; q <= Math.min(i, n); q++) c.lineTo(st.pts[q]![0], st.pts[q]![1]);
      if (i < n) { const a = st.pts[i]!, b = st.pts[i + 1]!, r = f - i; c.lineTo(a[0] + (b[0] - a[0]) * r, a[1] + (b[1] - a[1]) * r); }
      c.stroke();
    }
  }
}
