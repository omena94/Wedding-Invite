// 刮刮卡（批次 T4・紙本 D，亮）：一張「幸福刮刮卡」擺在木頭桌上，一枚硬幣自己在拍點上刮銀漆。
//  - 焦點是中間那一大格銀漆底下的主打留言：第一拍起硬幣一拍刮一段（Z 字來回、刮在拍點上），一兩小節內整則刮出來，
//    刮痕有毛邊、邊上留著刮不乾淨的銀。歌詞是卡上印的「本期主題曲」（中等大小，逐字跟唱）。
//  - 下面三個小圓一拍刮一個，刮出三顆愛心，一條紅線把它們連起來；最後在小節線刮開一小條：恭喜中獎——一輩子。
//  - 鏡頭：斜斜地拍桌上的卡，一開始貼近，第一拍拉到位；之後跟著硬幣刮到哪一段輕輕移過去，焦點跟著硬幣（景深），
//    刮完退回全景、慢慢推近。硬幣刮完躺在卡片右下角，每個小節線自己彈起來翻一圈。
//  - 沒有留言：銀漆底下是一句邀請。純音樂：主題曲那一條寫歌名。
// 畫法：卡片（印刷紋、表頭放射紋）一個 shader 畫進卡片的 render target；印刷的字與銀漆底下的東西一張不會變的 Canvas；
// 刮痕是一張遮罩（半解析度）：每格把「到現在為止」的刮痕用 LineBatch 重畫一次（跟時間一一對應，往回跳也對），
// 銀漆 shader 讀遮罩、加雜訊做毛邊；硬幣與歌詞第二張 Canvas；銀屑 LineBatch。整張卡再交給 _t4 的舞台用透視鏡頭拍（桌面、影子、景深）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, SCALE, makeRT, clearRT } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog, pulse, TAU } from '../engine/util';
import type { FitResult } from '../engine/text';
import { lyricAt, signature, drawHeart, fillWithHearts, sparkParticles, WEDDING_DATE } from './_motifs';
import { grid, stagger, fitMsg, drawFit, layoutRows, drawRows, paperInk, Stage, docRT, camDist, type Grid, type RowsStyle, type P2, type V3 } from './_t4';

export const spec: PlateSpecDecl = { group: 'type', family: 'doc', paper: true, energy: [0.35, 1], bars: [4, 8] };

// ---------------------------------------------------------------- 卡面（卡片座標，左上原點、y 向下）
const CW = 1160, CH = 880;
const HEAD_B = 84; // 表頭（放射紋）的下緣
const LYR = { x: 44, y: 142, w: CW - 88, h: 128 };
const MSGP = { x: 40, y: 290, w: CW - 80, h: 372 };
const CIRC = [0, 1, 2].map((i) => ({ x: 118 + i * 150, y: 760, r: 62 }));
const PRIZE = { x: 560, y: 716, w: 330, h: 90 };
const REST = { x: 1040, y: 760 }; // 刮完硬幣躺的地方
const COIN_R = 52;
const PANELS: [number, number, number, number][] = [
  [MSGP.x, MSGP.y, MSGP.w, MSGP.h], ...CIRC.map((c): [number, number, number, number] => [c.x, c.y, -c.r, 0]), [PRIZE.x, PRIZE.y, PRIZE.w, PRIZE.h],
];

const LY: RowsStyle = { family: F.archivo(100, 800), size: 70, minSize: 58, maxW: LYR.w, maxRows: 2, lineHeight: 1.04 };
const TEXT = '幸福刮刮卡第期中獎機率本期主題曲你的祝福恭喜中獎一輩子兌獎期限永久本券限本人及另一半使用刮出三個即這一格留給你掃描右下角寫下想對新人說的話純音樂新人';
const PERIOD = WEDDING_DATE.slice(5).replace('-', '');

// ---------------------------------------------------------------- 卡面的印刷（shader）
const PRINT_BG = () => new FSPass(/* glsl */ `
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${CH}.0 - FRAG_PX.y);
    // 紙＋防偽細紋（兩組正弦波交織，訊號色的暗部很淡）
    vec3 col = C_PAPER * (0.985 + 0.012 * snoise(p / 60.0));
    float gy = p.y + 16.0 * sin(p.x / 55.0) + 6.0 * sin(p.x / 13.0);
    float gz = p.y - 16.0 * sin(p.x / 55.0 + 1.6);
    float gl = max(pxLine(abs(mod(gy, 22.0) - 11.0), 0.3, 1.1), pxLine(abs(mod(gz, 22.0) - 11.0), 0.3, 1.1));
    col = mix(col, C_BLOOD, gl * 0.06);
    // 表頭：從左邊放射出去的條紋（訊號色與暗部交錯）
    if (p.y < ${HEAD_B}.0) {
      vec2 q = p - vec2(90.0, 60.0);
      float ray = step(0.5, fract(atan(q.y, q.x) / TAU * 40.0));
      col = mix(col, mix(mix(C_SIGNAL, C_PAPER, 0.55), mix(C_SIGNAL, C_BLOOD, 0.35), ray * 0.5), 0.8);
    }
    col = mix(col, C_SEPIA, pxLine(abs(p.y - ${HEAD_B}.0), 0.8, 1.8) * 0.7);
    // 內框
    vec2 d = abs(p - vec2(${CW / 2}.0, ${CH / 2}.0)) - vec2(${CW / 2 - 16}.0, ${CH / 2 - 16}.0) + 10.0;
    float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - 10.0;
    col = mix(col, C_BLOOD, pxLine(abs(sd), 0.6, 1.6) * 0.5);
    fragColor = vec4(col, 1.0);
  }`);

// ---------------------------------------------------------------- 銀漆
const SILVER = () => new FSPass(/* glsl */ `
  uniform sampler2D mask;
  uniform vec4 panels[5];
  uniform float sheen;
  float panelSd(vec2 p, vec4 r) {
    if (r.z < 0.0) return length(p - r.xy) + r.z; // 圓：中心、負的半徑
    vec2 c = r.xy + r.zw * 0.5;
    return sdBox(p - c, r.zw * 0.5 - 8.0) - 8.0;
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${CH}.0 - FRAG_PX.y);
    float inside = 0.0, e = 1e9; vec4 R = vec4(0.0);
    for (int i = 0; i < 5; i++) {
      float d = panelSd(p, panels[i]);
      float k = 1.0 - smoothstep(-0.7, 0.7, d);
      if (k > inside) { inside = k; R = panels[i]; e = d; }
    }
    if (inside <= 0.0) discard;
    // 刮痕：遮罩＋兩層雜訊 → 毛邊；刮乾淨的地方也留幾顆很小的銀點
    float m = texture(mask, vUv).r;
    float n = snoise(p * 0.11) * 0.65 + snoise(p * 0.33) * 0.35;
    float v = m + n * 0.3 - 0.8 * step(0.9985, hash12(floor(p / 4.0)));
    float scratched = smoothstep(0.42, 0.58, v);
    float cover = (1.0 - scratched) * inside;
    if (cover <= 0.002) discard;
    // 銀：橫向的拉絲、交錯的小菱形花紋（愛心只能用點綴色，這裡用菱形）、每個小節線掃過去的反光
    float brush = fbm(vec2(p.x / 240.0, p.y / 1.8), 2);
    vec3 col = mix(C_ASH, C_BONE, 0.42 + 0.16 * brush);
    vec2 hp = mod(p + vec2(0.0, 17.0 * mod(floor(p.x / 34.0), 2.0)), 34.0) - 17.0;
    col = mix(col, C_ASH * 0.72, (1.0 - smoothstep(-0.8, 0.8, abs(hp.x) + abs(hp.y) - 5.0)) * 0.45);
    float band = exp(-pow((p.x + p.y * 0.6 - sheen) / 70.0, 2.0));
    col *= 0.86 + 0.3 * band;
    // 刮痕的邊緣：翹起來的銀比較暗；銀漆的邊壓一圈
    col *= 1.0 - 0.28 * smoothstep(0.22, 0.42, v) * (1.0 - scratched);
    col *= 1.0 - 0.18 * pxLine(abs(e + 5.0), 0.5, 1.5);
    fragColor = vec4(col, cover);
  }`, {
  mask: { value: null }, sheen: { value: 0 },
  panels: { value: PANELS.map((r) => new THREE.Vector4(...r)) },
}, { blending: THREE.NormalBlending, transparent: true });

/** 舞台：木頭桌面上的一張卡（整晚共用）。 */
function makeRig() {
  const doc = docRT(CW, CH);
  const mask = makeRT(CW, CH, { pxScale: SCALE * 0.5, depthBuffer: false });
  const st = new Stage(1, 30);
  const mat = st.docMaterial(doc.texture, [doc.width, doc.height], [CW, CH], { radius: 22 });
  const card = st.docMesh(mat, CW, CH, 0, 0, 1.5);
  card.rotation.z = -0.022;
  return { doc, mask, st, mat, card };
}

// ---------------------------------------------------------------- 刮的路徑
interface Swipe { pts: P2[]; len: number[]; t0: number; t1: number; panel: number; c: P2 }

/**
 * Z 字來回：x 從 r.x 到 r.x + r.w，上緣超出 top、下緣超出 bot（負的 = 不到邊，留一圈刮不乾淨的鋸齒銀邊），
 * step = 每一折往右多少。筆寬要比 step 寬，中間才刮得乾淨。
 */
function zigzag(r: { x: number; y: number; w: number; h: number }, step: number, top: number, bot: number, seed: number): P2[] {
  const pts: P2[] = [];
  const n = Math.max(2, Math.ceil(r.w / step));
  for (let k = 0; k <= n; k++) {
    const x = r.x + (r.w * k) / n + (hash(seed, k) - 0.5) * 8;
    const y = k % 2 ? r.y + r.h + bot - hash(seed, k, 3) * 10 : r.y - top + hash(seed, k, 5) * 10;
    pts.push({ x, y });
  }
  return pts;
}
function cumLen(pts: P2[]) {
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
  return L;
}
function at(sw: Swipe, u: number): P2 {
  const s = clamp(u) * sw.len[sw.len.length - 1]!;
  let i = 1;
  while (i < sw.len.length - 1 && sw.len[i]! < s) i++;
  const a = sw.pts[i - 1]!, b = sw.pts[i]!, seg = sw.len[i]! - sw.len[i - 1]!;
  const k = seg > 0 ? (s - sw.len[i - 1]!) / seg : 0;
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) };
}

const SW = 70; // 刮痕的寬（硬幣的邊）

export default class ScratchCard extends Scene {
  bgPass = shared('scratchcard.print', PRINT_BG);
  silver = shared('scratchcard.silver', SILVER);
  rig = shared('scratchcard.rig', makeRig);
  /** 不會變的：卡面印刷的字、銀漆底下的留言、愛心、獎項。 */
  print = this.track(new Layer2D(CW, CH, undefined, { fast: true }));
  /** 每格重畫：歌詞、硬幣、連線。 */
  live = this.track(new Layer2D(CW, CH, undefined, { fast: true }));
  scratch = this.track(new LineBatch(2048, { screen2D: true, blend: 'max' }));
  dust = this.track(new LineBatch(2048, { screen2D: true, blend: 'normal' }));
  sparks = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  g!: Grid;
  swipes: Swipe[] = [];
  tPrize = Infinity;
  fit: FitResult | null = null;
  private printed = false;

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText(TEXT + song.title + (this.msg ? signature(this.msg.name) : '') + lyrics.linesIn(s, e).map((l) => l.text).join(''));
    const g = (this.g = grid(au, s, e));
    const seed = (this.ctx.params.seed ?? 7) * 13;
    // 刮的順序：留言三條×左右兩半（6 段）、三個小圓（3 段）、最後在小節線上刮開獎項那一條。
    // 相鄰兩段互相超出一點才刮得乾淨；貼著銀漆外緣的那一邊不超出（留一圈鋸齒的銀邊，看得出刮過）
    const bandH = MSGP.h / 3, IN = 26, OV = 34, EDGE = -4;
    const plan: { r: { x: number; y: number; w: number; h: number }; panel: number; top: number; bot: number }[] = [];
    for (let b = 0; b < 3; b++) for (let hf = 0; hf < 2; hf++) {
      const x0 = hf ? MSGP.x + MSGP.w / 2 - 24 : MSGP.x + IN, x1 = hf ? MSGP.x + MSGP.w - IN : MSGP.x + MSGP.w / 2 + 24;
      plan.push({ r: { x: x0, y: MSGP.y + b * bandH, w: x1 - x0, h: bandH }, panel: 0, top: b ? OV : EDGE, bot: b < 2 ? OV : EDGE });
    }
    CIRC.forEach((c, i) => plan.push({ r: { x: c.x - c.r + 18, y: c.y - c.r, w: 2 * c.r - 36, h: 2 * c.r }, panel: 1 + i, top: 6, bot: 6 }));
    const avail = Math.max(1.2, e - g.b0 - 0.8);
    // 一段刮多久：到下一段開始前留一點空（硬幣抬起來換位置），最長半秒
    const add = (i: number, t0: number, next: number) => {
      const pl = plan[i]!;
      const pts = zigzag(pl.r, 42, pl.top, pl.bot, seed + i);
      this.swipes.push({ pts, len: cumLen(pts), t0, t1: t0 + Math.min(0.5, Math.max(0.16, (next - t0) * 0.78)), panel: pl.panel, c: { x: pl.r.x + pl.r.w / 2, y: pl.r.y + pl.r.h / 2 } });
    };
    const tMsg = stagger(au, g.b0, 6, Math.min(5 * g.beat, avail * 0.45));
    tMsg.forEach((t0, i) => add(i, t0, tMsg[i + 1] ?? t0 + (tMsg[1]! - tMsg[0]!)));
    // 小圓從留言刮完後的下一個半拍開始
    const symStart = au.timeOfBeat(Math.ceil(au.beatAt(this.swipes[5]!.t1 + 0.05) * 2) / 2);
    const tSym = stagger(au, symStart, 3, Math.min(2 * g.beat, avail * 0.25));
    tSym.forEach((t0, i) => add(6 + i, t0, tSym[i + 1] ?? t0 + (tSym[1]! - tSym[0]!)));
    // 獎項：刮完小圓後的下一個小節線（窗格短就下一拍）
    const lastSym = this.swipes[this.swipes.length - 1]!.t1;
    let tp = g.bars.find((b) => b >= lastSym + 0.15) ?? Infinity;
    if (tp > e - 1.0) tp = au.timeOfBeat(Math.ceil(au.beatAt(lastSym + 0.1)));
    if (tp < e - 0.4) {
      const r = { x: PRIZE.x + IN, y: PRIZE.y, w: PRIZE.w - 2 * IN, h: PRIZE.h };
      const pts = zigzag(r, 42, EDGE, EDGE, seed + 99);
      this.swipes.push({ pts, len: cumLen(pts), t0: tp, t1: tp + Math.min(0.45, g.beat * 0.9), panel: 4, c: { x: r.x + r.w / 2, y: r.y + r.h / 2 } });
      this.tPrize = tp;
    }
    // 字級依「可用高度扣掉署名」算：署名一定在留言下面
    if (this.msg) this.fit = fitMsg(this.print.ctx, this.msg.text, F.hand(700), MSGP.w - 100, MSGP.h - 50 - 70 - 20, { min: 52, max: 120, lineHeight: 1.22, maxLines: 4 });
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t;
    const R = this.rig, doc = R.doc;
    // ---- 1. 卡面畫進卡片的 render target
    this.bgPass.render(renderer, doc);
    if (!this.printed) { this.drawPrint(); this.printed = true; }
    comp.draw(renderer, this.print.texture, doc);
    this.scratch.clear();
    for (const sw of this.swipes) {
      if (t <= sw.t0) break;
      const u = prog(t, sw.t0, sw.t1, ease.inOutQuad);
      const s = u * sw.len[sw.len.length - 1]!;
      for (let i = 1; i < sw.pts.length; i++) {
        const a = sw.pts[i - 1]!, b = sw.pts[i]!;
        if (sw.len[i - 1]! >= s) break;
        const k = Math.min(1, (s - sw.len[i - 1]!) / Math.max(1e-3, sw.len[i]! - sw.len[i - 1]!));
        const bx = lerp(a.x, b.x, k), by = lerp(a.y, b.y, k);
        // 兩層：中間刮乾淨（1），外面一圈半刮（0.45，shader 的雜訊決定留不留）→ 毛毛的邊
        this.scratch.seg2(a.x, a.y, bx, by, SW + 20, [0.45, 0.45, 0.45], 1);
        this.scratch.seg2(a.x, a.y, bx, by, SW, [1, 1, 1], 1);
      }
    }
    clearRT(renderer, R.mask, [0, 0, 0], 1);
    if (this.scratch.count) this.scratch.render(renderer, R.mask);
    const bar = au.barAt(t), bp = bar - Math.floor(bar);
    this.silver.u.mask!.value = R.mask.texture;
    this.silver.u.sheen!.value = lerp(-300, 1700, ease.outCubic(clamp(bp * 1.6)));
    this.silver.render(renderer, doc);
    this.dust.clear(); this.sparks.clear();
    this.drawDust(t);
    const L = this.live; L.clear();
    const c = L.ctx;
    this.drawLyric(c, t);
    this.drawWin(c, t);
    const coin = this.drawCoin(c, t);
    comp.draw(renderer, L.upload(), doc);
    if (this.dust.count) this.dust.render(renderer, doc);
    if (this.tPrize < Infinity && t > this.tPrize) {
      const pz = this.swipes[this.swipes.length - 1]!;
      sparkParticles(this.sparks, t, (tb) => (tb >= pz.t0 && tb <= pz.t1 ? at(pz, prog(tb, pz.t0, pz.t1, ease.inOutQuad)) : null), { rate: 120, life: 0.5, speed: 280, seed: 5, intensity: 0.6 });
      if (this.sparks.count) this.sparks.render(renderer, doc);
    }

    // ---- 2. 舞台：鏡頭跟著硬幣刮到的那一段移過去、焦點在硬幣上
    this.shoot(t, coin);
    R.st.render(renderer, out);
    const win = this.tPrize < Infinity ? pulse(t, this.swipes[this.swipes.length - 1]!.t1, 0.12) : 0;
    return { paper: 1, bloom: 0.3, vignette: 0.3, grain: 0.04, flash: 0.05 * win };
  }

  /** 卡片座標 → 世界座標（卡片平放、稍微轉一點）。 */
  private world(u: number, v: number, z = 1.5): V3 {
    const r = this.rig.card.rotation.z, x = u - CW / 2, y = CH / 2 - v;
    return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r), z];
  }

  private shoot(t: number, coin: P2) {
    const R = this.rig, st = R.st, s = this.ctx.start, g = this.g;
    const D = camDist(30);
    // 鏡頭看的點：刮到哪一段就往那一段偏一點（每段開始時 outCubic 移過去）；刮完回到整張卡的中間偏上
    // 卡片放在畫面偏左（鏡頭看卡片中心偏右的地方），右下角的 QR 區留給 HUD
    const home: P2 = { x: CW / 2 + 170, y: CH * 0.5 };
    let aim: P2 = home;
    let prevAim = aim, since = 99;
    const done = this.swipes.length ? this.swipes[this.swipes.length - 1]!.t1 + 0.4 : s;
    for (let i = 0; i < this.swipes.length; i++) {
      const sw = this.swipes[i]!;
      if (t < sw.t0) break;
      prevAim = aim;
      aim = { x: lerp(home.x, sw.c.x, 0.25), y: lerp(home.y, sw.c.y, 0.25) };
      since = t - sw.t0;
    }
    if (t >= done) { prevAim = aim; aim = home; since = t - done; }
    const k = ease.outCubic(clamp(since / 0.45));
    const a = { x: lerp(prevAim.x, aim.x, k), y: lerp(prevAim.y, aim.y, k) };
    // 開場：貼近、比較斜，第一拍 outExpo 拉到位；刮完之後慢慢推近
    const intro = ease.outExpo(clamp((t - s) / Math.max(0.3, g.b0 - s + 0.35)));
    const push = t > done ? 0.05 * ease.inOutCubic(clamp((t - done) / Math.max(1, this.ctx.end - done))) : 0;
    const dist = D * lerp(0.86, 1.14, intro) * (1 - push);
    const tilt = THREE.MathUtils.degToRad(lerp(30, 21, intro));
    const yaw = lerp(-0.12, 0.035, intro);
    const T = this.world(a.x, a.y, 0);
    st.look([T[0] + Math.sin(yaw) * dist * 0.6, T[1] - Math.sin(tilt) * dist, Math.cos(tilt) * dist], T);
    st.U.focus.value = st.depthOf(this.world(coin.x, coin.y));
    st.U.aperture.value = 34;
    st.U.pool.value.set(-260, 260, 1500, 0.55);
    const c0 = this.world(CW / 2, CH / 2, 0);
    st.shadows([{ x: c0[0] + 12, y: c0[1] - 18, w: CW, h: CH, rot: this.rig.card.rotation.z, blur: 26, k: 0.34, r: 22 }]);
  }

  // ------------------------------------------------------------ 印刷（畫一次）
  private drawPrint() {
    const c = this.print.ctx, m = this.msg;
    this.print.clear();
    c.textBaseline = 'alphabetic';
    // 表頭：小小的卡名與期數（配角，不搶留言）
    c.font = font(F.hei(900), 24); c.fillStyle = rgba('sepia', 0.9);
    c.fillText('幸福刮刮卡', 44, 54);
    c.font = font(F.mono(600), 14); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.6);
    c.fillText(`第 ${PERIOD} 期`, 190, 52);
    c.letterSpacing = '0px';
    c.textAlign = 'right';
    c.font = font(F.hei(900), 20);
    const pill = '中獎機率 100%';
    const pw = c.measureText(pill).width + 30;
    c.fillStyle = rgba('blood', 0.9);
    c.beginPath(); c.roundRect(CW - 44 - pw, 26, pw, 38, 19); c.fill();
    c.fillStyle = rgba('paper');
    c.fillText(pill, CW - 44 - 15, 52);
    c.textAlign = 'left';
    c.font = font(F.hei(700), 18); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.6);
    c.fillText('♪ 本期主題曲', LYR.x, LYR.y - 12);
    c.letterSpacing = '0px';
    // 銀漆底下：留言（焦點）
    if (m && this.fit) {
      // 留言＋署名整塊置中；署名永遠在最後一行下面（字級是扣掉署名的高度算的）
      const fit = this.fit, SIG = 70;
      const block = fit.height + SIG;
      const top = MSGP.y + 30 + Math.max(0, (MSGP.h - 50 - block) / 2) + fit.size * 0.86;
      drawFit(c, fit, F.hand(700), MSGP.x + 50, top, { color: rgba('sepia') });
      c.font = font(F.hand(700), 48); c.fillStyle = rgba('sepia', 0.8); c.textAlign = 'right';
      c.fillText(`${signature(m.name)}${m.couple ? '（新人）' : ''}`, MSGP.x + MSGP.w - 44, top + (fit.lines.length - 1) * fit.lineHeight + SIG);
      c.textAlign = 'left';
    } else {
      c.font = font(F.hand(700), 92); c.fillStyle = rgba('sepia');
      c.fillText('這一格留給你', MSGP.x + 50, MSGP.y + 170);
      c.font = font(F.hand(700), 48); c.fillStyle = rgba('sepia', 0.72);
      c.fillText('掃描右下角 QR code，寫下想對新人說的話', MSGP.x + 54, MSGP.y + 262);
    }
    // 三個小圓：愛心；獎項那一條
    for (const r of CIRC) drawHeart(c, r.x, r.y + 3, 70);
    c.font = font(F.hei(700), 24); c.fillStyle = rgba('blood', 0.9);
    c.textAlign = 'center';
    c.fillText('恭喜中獎：一輩子', PRIZE.x + PRIZE.w / 2, PRIZE.y + PRIZE.h / 2 + 9);
    c.textAlign = 'left';
  }

  // ------------------------------------------------------------ 歌詞（本期主題曲）
  private drawLyric(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const lay = layoutRows(c, ly.line, LY);
      const top = LYR.y + (LYR.h - lay.height) / 2 + lay.size * 0.82;
      c.save(); c.translate(LYR.x, top);
      drawRows(c, lay, LY.family, t, paperInk(), ly.k);
      c.restore();
      return;
    }
    c.font = font(F.archivo(100, 800), 58); c.fillStyle = rgba('sepia', lyrics.has ? 0.26 : 0.8);
    c.fillText(song.title || '本期主題曲', LYR.x, LYR.y + 80);
    if (!lyrics.has) {
      const w = Math.min(c.measureText(song.title).width, 700);
      c.font = font(F.hei(500), 20); c.fillStyle = rgba('sepia', 0.55);
      c.fillText('（純音樂）', LYR.x + w + 20, LYR.y + 78);
    }
  }

  // ------------------------------------------------------------ 硬幣
  /** 硬幣在 t 的位置、「抬起來」的高度（0 = 貼在卡上刮）、斜拿的程度、翻面的角度。 */
  private coinAt(t: number): { p: P2; lift: number; tilt: number; spin: number } {
    const sws = this.swipes, s = this.ctx.start;
    const first = sws[0];
    if (!first) return { p: REST, lift: 0, tilt: 0, spin: 0 };
    const enter = { x: CW + 160, y: CH + 120 };
    if (t < first.t0) {
      // 從右下角外面滑進來，第一拍剛好落在起點
      const u = prog(t, Math.max(s, first.t0 - 0.7), first.t0, ease.outCubic);
      const p0 = first.pts[0]!;
      return { p: { x: lerp(enter.x, p0.x, u), y: lerp(enter.y, p0.y, u) - Math.sin(u * Math.PI) * 60 }, lift: 1 - u, tilt: 1, spin: 0 };
    }
    for (let i = 0; i < sws.length; i++) {
      const sw = sws[i]!;
      if (t <= sw.t1) {
        if (t >= sw.t0) return { p: at(sw, prog(t, sw.t0, sw.t1, ease.inOutQuad)), lift: 0, tilt: 1, spin: 0 };
        // 兩段之間：抬起來、弧線移到下一段的起點
        const prev = sws[i - 1]!;
        const u = prog(t, prev.t1, sw.t0, ease.inOutCubic);
        const a = prev.pts[prev.pts.length - 1]!, b = sw.pts[0]!;
        return { p: { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) - Math.sin(u * Math.PI) * 40 }, lift: Math.sin(u * Math.PI), tilt: 1, spin: 0 };
      }
    }
    // 刮完：躺到卡片右下角；之後每個小節線自己彈起來翻一圈半、在下一拍前落地（閒著也跟著拍子）
    const last = sws[sws.length - 1]!;
    const tRest = last.t1 + 0.6;
    if (t < tRest) {
      const u = prog(t, last.t1 + 0.1, tRest, ease.inOutCubic);
      const a = last.pts[last.pts.length - 1]!;
      return { p: { x: lerp(a.x, REST.x, u), y: lerp(a.y, REST.y, u) - Math.sin(u * Math.PI) * 70 }, lift: Math.sin(u * Math.PI), tilt: 1 - u, spin: 0 };
    }
    const g = this.g;
    let bi = -1;
    for (let i = 0; i < g.bars.length; i++) if (g.bars[i]! >= tRest + 0.1 && g.bars[i]! <= t) bi = i;
    if (bi >= 0) {
      const b = g.bars[bi]!, u = prog(t, b, b + Math.min(0.5, g.beat * 0.95));
      if (u < 1) return { p: { x: REST.x, y: REST.y - Math.sin(u * Math.PI) * 110 }, lift: Math.sin(u * Math.PI), tilt: 0, spin: ease.outCubic(u) * Math.PI * 3 };
    }
    return { p: REST, lift: 0, tilt: 0, spin: 0 };
  }

  /** 畫硬幣，回傳它的位置（對焦用）。 */
  private drawCoin(c: CanvasRenderingContext2D, t: number): P2 {
    const { p, lift, tilt, spin } = this.coinAt(t);
    // 刮的時候硬幣是斜拿著的（橢圓），躺平是正圓；翻面時高度跟著 cos 變（看到側邊）
    const flip = Math.abs(Math.cos(spin));
    const rx = COIN_R * (1 + 0.1 * lift), ry = Math.max(4, COIN_R * lerp(1, 0.62, tilt) * (1 + 0.1 * lift) * flip);
    const rot = -0.5 + 0.12 * Math.sin(t * 7) * tilt;
    c.save();
    // 影子：抬越高越遠越淡
    c.fillStyle = rgba('sepia', 0.2 - 0.09 * lift);
    c.beginPath(); c.ellipse(p.x + 5 + 26 * lift, p.y + 7 + 34 * lift + 50 * lift * (1 - tilt), rx * 0.98, Math.max(ry, COIN_R * 0.6) * 0.98, rot, 0, TAU); c.fill();
    c.translate(p.x, p.y); c.rotate(rot);
    c.fillStyle = rgba('sepia', 0.55);
    c.beginPath(); c.ellipse(0, 7 * Math.max(tilt, 1 - flip), rx, ry, 0, 0, TAU); c.fill();
    const gr = c.createLinearGradient(-rx, -ry, rx, ry);
    gr.addColorStop(0, rgba('bone')); gr.addColorStop(0.55, rgba('ash')); gr.addColorStop(1, rgba('bone', 0.9));
    c.fillStyle = gr;
    c.beginPath(); c.ellipse(0, 0, rx, ry, 0, 0, TAU); c.fill();
    c.strokeStyle = rgba('sepia', 0.5); c.lineWidth = 2;
    c.beginPath(); c.ellipse(0, 0, rx * 0.8, ry * 0.8, 0, 0, TAU); c.stroke();
    c.strokeStyle = rgba('sepia', 0.35); c.lineWidth = 1.5;
    c.beginPath();
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * TAU;
      c.moveTo(Math.cos(a) * rx * 0.88, Math.sin(a) * ry * 0.88);
      c.lineTo(Math.cos(a) * rx * 0.98, Math.sin(a) * ry * 0.98);
    }
    c.stroke();
    if (ry > 10) { c.scale(1, ry / rx); drawHeart(c, 0, 2, rx * 0.72); }
    c.restore();
    return p;
  }

  /** 銀屑：刮的時候從硬幣邊緣噴出去、往下掉（出生時間固定、速度用 hash，往回跳也一樣）。 */
  private drawDust(t: number) {
    const rate = 90, life = 0.7;
    const col = LIN.ash;
    for (let n = Math.floor((t - life) * rate); n <= Math.floor(t * rate); n++) {
      const tb = n / rate;
      if (tb > t) continue;
      const sw = this.swipes.find((s) => tb >= s.t0 && tb <= s.t1);
      if (!sw) continue;
      const h = at(sw, prog(tb, sw.t0, sw.t1, ease.inOutQuad));
      const age = t - tb, lf = life * (0.4 + 0.6 * hash(n, 3));
      if (age > lf) continue;
      const a = -Math.PI * (0.15 + 0.7 * hash(n, 1)), sp = 120 + 260 * hash(n, 2);
      const x = h.x + Math.cos(a) * sp * age + (hash(n, 4) - 0.5) * 30;
      const y = h.y + Math.sin(a) * sp * age + 0.5 * 900 * age * age;
      const k = 1 - age / lf;
      const sz = 2 + 3.5 * hash(n, 5);
      const ang = hash(n, 6) * TAU + age * 12;
      this.dust.seg2(x, y, x + Math.cos(ang) * sz, y + Math.sin(ang) * sz, 2.4, [col[0] * 0.8, col[1] * 0.8, col[2] * 0.8], k);
    }
  }

  // ------------------------------------------------------------ 對獎
  private drawWin(c: CanvasRenderingContext2D, t: number) {
    // 三顆愛心都刮出來之後：一條紅筆線把三個圓連起來
    const sym = this.swipes.filter((s) => s.panel >= 1 && s.panel <= 3);
    if (sym.length !== 3) return;
    const t0 = sym[2]!.t1 + 0.05;
    const u = prog(t, t0, t0 + 0.25, ease.outCubic);
    if (u <= 0) return;
    const y = CIRC[0]!.y + 4, x0 = CIRC[0]!.x - 40, x1 = CIRC[2]!.x + 40;
    c.save();
    c.strokeStyle = rgba('blood', 0.85); c.lineWidth = 6; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x0, y + 6); c.quadraticCurveTo((x0 + x1) / 2, y - 14, lerp(x0, x1, u), y + 4 - 6 * u); c.stroke();
    c.restore();
  }
}
