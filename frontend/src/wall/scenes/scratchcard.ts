// 刮刮卡（批次 T4・紙本 D，暗）：彩券行的玻璃櫃台上擺著兩張「幸福刮刮卡」（玻璃底下是一排排別的刮刮卡），
// 旁邊一個放零錢的找零盤，頭頂一盞聚光燈，一枚硬幣自己在拍點上刮銀漆。
//  - 左邊那張小卡（v2：留言區 ≤ 860×430）：銀漆底下是主打留言。第一拍起硬幣一拍刮一段（Z 字來回），一兩小節內整則刮出來，
//    刮痕有毛邊、邊上留著刮不乾淨的銀。留言是手寫字 40～60 px（依字數），署名永遠在最後一行下面。
//  - 右邊那張是「幸運九宮格」（場景的主角，一直在動）：上面印著「本期主題曲」——現在唱的那一句（比留言小一級，逐字跟唱）；
//    留言刮完，硬幣飛過去一拍刮一格，刮到中間那一排三顆愛心連成一線（紅筆劃過、火星噴一下），下一個小節線刮開最下面那條：
//    恭喜中獎——一輩子。刮完硬幣躺到桌上，每個小節線自己彈起來翻一圈。
//  - 環境：聚光燈照著兩張卡，四周暗下去；燈跟著大鼓微微一亮；玻璃上的反光慢慢滑、每個小節線閃過一道；銀漆上也掃過一道反光；
//    鏡頭斜斜地拍，跟著硬幣輕輕移，焦點在留言上。
//  - 沒有留言：銀漆底下是一句邀請。純音樂：主題曲那一格寫歌名。
// 畫法：兩張卡攤在同一張 render target（展開圖）：印刷紋與表頭放射紋一個 shader、印刷的字與銀漆底下的東西一張不會變的 Canvas、
// 刮痕是一張遮罩（每格把「到現在為止」的刮痕用 LineBatch 重畫一次，往回跳也對），銀漆 shader 讀遮罩加雜訊做毛邊；
// 歌詞、連線、硬幣在卡上的影子第二張 Canvas。硬幣本身是桌上的 3D 道具（會抬起來、斜拿著刮、翻面）。
// 交給 _t4 的舞台拍（玻璃櫃台、聚光燈、影子、景深）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, SCALE, makeRT, clearRT } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog, pulse, TAU } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { lyricAt, signature, drawHeart, sparkParticles, WEDDING_DATE } from './_motifs';
import { grid, stagger, drawFit, layoutRows, drawRows, paperInk, Stage, docRT, camDist, type Grid, type RowsStyle, type P2, type V3 } from './_t4';
import { msgMaxFor, lyricV2, sigV2, V2, fitClauses } from './_v2';

// 背景是深色絨布：暗版面（右下角 HUD 用亮字）
export const spec: PlateSpecDecl = { group: 'type', family: 'doc', paper: false, energy: [0.35, 1], bars: [4, 8] };

// ---------------------------------------------------------------- 展開圖（像素，左上原點、y 向下）
const CA = { x: 0, y: 0, w: 880, h: 480 }; // 留言卡（v2：畫面上約 760×420）
const CB = { x: 900, y: 0, w: 580, h: 800 }; // 九宮格
const AW = 1480, AH = 800;
const HEAD = 58; // 表頭（放射紋）的高
const MSGP = { x: 30, y: 76, w: 820, h: 376 }; // 留言的銀漆
const LYR = { x: CB.x + 34, y: 96, w: CB.w - 68, h: 206 }; // 本期主題曲
const CELL = { x: CB.x + 40, y: 322, w: 156, h: 116, gap: 10 };
const cellRect = (i: number) => ({ x: CELL.x + (i % 3) * (CELL.w + CELL.gap), y: CELL.y + Math.floor(i / 3) * (CELL.h + CELL.gap), w: CELL.w, h: CELL.h });
const PRIZE = { x: CB.x + 40, y: 716, w: CB.w - 80, h: 60 };
const SYMBOLS = ['∞', '♥', '♪', '♥', '♥', '♥', '♪', '♥', '∞']; // 中間那一排三顆愛心 = 中獎
const PANELS: [number, number, number, number][] = [[MSGP.x, MSGP.y, MSGP.w, MSGP.h], ...Array.from({ length: 9 }, (_, i): [number, number, number, number] => { const r = cellRect(i); return [r.x, r.y, r.w, r.h]; }), [PRIZE.x, PRIZE.y, PRIZE.w, PRIZE.h]];
const NP = PANELS.length;

// 兩張卡在桌上的位置（世界座標，中心）與角度
const WA = { x: -390, y: -150, rot: -0.035 };
const WB = { x: 430, y: 70, rot: 0.06 };
const COIN_R = 58;
const REST: V3 = [720, -250, 1.5]; // 刮完硬幣躺的地方（桌上，右邊卡片的右下）
const SIG_K = 1.5; // 署名佔的高度 = 署名字級 × SIG_K（含間距）

// 符號（♪ ∞ ☑ → 之類）不在打包時掃的中文範圍裡，要跟中文一起預載，不然第一次畫會用備援字型（確定性也會不過）
const TEXT = '♪∞☑☐→·—♥%＄$幸福刮刮卡第期幸運九宮格中獎機率本期主題曲恭喜中獎一輩子這一格留給你掃描右下角寫下想對新人說的話純音樂新人';
const PERIOD = WEDDING_DATE.slice(5).replace('-', '');

// ---------------------------------------------------------------- 卡面的印刷（shader）
const PRINT_BG = () => new FSPass(/* glsl */ `
  float rbox(vec2 p, vec4 r, float rad) { vec2 d = abs(p - r.xy - r.zw * 0.5) - r.zw * 0.5 + rad; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - rad; }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${AH}.0 - FRAG_PX.y);
    // 紙＋防偽細紋（兩組正弦波交織，訊號色的暗部很淡）
    vec3 col = C_PAPER * (0.985 + 0.012 * snoise(p / 60.0));
    float gy = p.y + 16.0 * sin(p.x / 55.0) + 6.0 * sin(p.x / 13.0);
    float gz = p.y - 16.0 * sin(p.x / 55.0 + 1.6);
    float gl = max(pxLine(abs(mod(gy, 22.0) - 11.0), 0.3, 1.1), pxLine(abs(mod(gz, 22.0) - 11.0), 0.3, 1.1));
    col = mix(col, C_BLOOD, gl * 0.06);
    // 表頭：放射條紋（訊號色與暗部交錯）
    if (p.y < ${HEAD}.0) {
      vec2 q = p - vec2(p.x < ${CB.x}.0 ? 70.0 : ${CB.x + 70}.0, 40.0);
      float ray = step(0.5, fract(atan(q.y, q.x) / TAU * 40.0));
      col = mix(col, mix(mix(C_SIGNAL, C_PAPER, 0.55), mix(C_SIGNAL, C_BLOOD, 0.35), ray * 0.5), 0.8);
    }
    col = mix(col, C_SEPIA, pxLine(abs(p.y - ${HEAD}.0), 0.8, 1.8) * 0.7);
    // 兩張卡的內框
    float fa = abs(rbox(p, vec4(14.0, 14.0, ${CA.w - 28}.0, ${CA.h - 28}.0), 10.0));
    float fb = abs(rbox(p, vec4(${CB.x + 14}.0, 14.0, ${CB.w - 28}.0, ${CB.h - 28}.0), 10.0));
    col = mix(col, C_BLOOD, pxLine(min(fa, fb), 0.6, 1.6) * 0.5);
    fragColor = vec4(col, 1.0);
  }`);

// ---------------------------------------------------------------- 銀漆
const SILVER = () => new FSPass(/* glsl */ `
  uniform sampler2D mask;
  uniform vec4 panels[${NP}];
  uniform float sheen;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${AH}.0 - FRAG_PX.y);
    float inside = 0.0, e = 1e9; vec4 R = vec4(0.0);
    for (int i = 0; i < ${NP}; i++) {
      vec4 r = panels[i];
      float d = sdBox(p - r.xy - r.zw * 0.5, r.zw * 0.5 - 8.0) - 8.0;
      float k = 1.0 - smoothstep(-0.7, 0.7, d);
      if (k > inside) { inside = k; R = r; e = d; }
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
    col *= 1.0 - 0.28 * smoothstep(0.22, 0.42, v) * (1.0 - scratched);
    col *= 1.0 - 0.18 * pxLine(abs(e + 5.0), 0.5, 1.5);
    fragColor = vec4(col, cover);
  }`, {
  mask: { value: null }, sheen: { value: 0 },
  panels: { value: PANELS.map((r) => new THREE.Vector4(...r)) },
}, { blending: THREE.NormalBlending, transparent: true });

/** 卡片的網格：展開圖上 rect 那一塊，平放在桌上 (x, y)、轉 rot。 */
function cardGeo(r: { x: number; y: number; w: number; h: number }) {
  const g = new THREE.PlaneGeometry(r.w, r.h);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (r.x + uv.getX(i) * r.w) / AW, 1 - (r.y + (1 - uv.getY(i)) * r.h) / AH);
  return g;
}

/** 桌上的道具（硬幣、兩枚零錢、一支鉛筆）：畫一次，整晚共用。 */
function drawProps(c: CanvasRenderingContext2D) {
  const coin = (cx: number, cy: number, r: number) => {
    c.save(); c.translate(cx, cy);
    const gr = c.createLinearGradient(-r, -r, r, r);
    gr.addColorStop(0, rgba('bone')); gr.addColorStop(0.55, rgba('ash')); gr.addColorStop(1, rgba('bone', 0.95));
    c.fillStyle = gr; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
    c.strokeStyle = rgba('sepia', 0.5); c.lineWidth = 3; c.beginPath(); c.arc(0, 0, r * 0.8, 0, TAU); c.stroke();
    c.strokeStyle = rgba('sepia', 0.35); c.lineWidth = 2; c.beginPath();
    for (let i = 0; i < 44; i++) { const a = (i / 44) * TAU; c.moveTo(Math.cos(a) * r * 0.88, Math.sin(a) * r * 0.88); c.lineTo(Math.cos(a) * r * 0.98, Math.sin(a) * r * 0.98); }
    c.stroke();
    c.restore();
  };
  // 左半：主角硬幣（有愛心）；右半：櫃台上的找零盤（橡膠的圓盤，一圈防滑的凸點），盤裡兩枚零錢
  coin(128, 128, 120); drawHeart(c, 128, 132, 110);
  c.fillStyle = mixRgba('ink2', 'signal', 0.18); c.beginPath(); c.arc(384, 128, 120, 0, TAU); c.fill();
  c.strokeStyle = mixRgba('ink2', 'signal', 0.35); c.lineWidth = 8; c.beginPath(); c.arc(384, 128, 112, 0, TAU); c.stroke();
  c.fillStyle = mixRgba('ink2', 'signal', 0.3);
  for (let r = 30; r < 100; r += 18) for (let i = 0; i < Math.floor(r / 3); i++) { const a = (i / Math.floor(r / 3)) * TAU; c.beginPath(); c.arc(384 + Math.cos(a) * r, 128 + Math.sin(a) * r, 2.5, 0, TAU); c.fill(); }
  coin(350, 100, 40); coin(420, 150, 36);
}

function makeRig() {
  const doc = docRT(AW, AH);
  const mask = makeRT(AW, AH, { pxScale: SCALE * 0.5, depthBuffer: false });
  const st = new Stage(8, 30);
  // 聚光燈：光圈裡亮、外面很暗，光圈染一點暖色（玻璃底下的刮刮卡只在光裡看得到）
  st.U.poolFloor.value = 0.3; st.U.poolWarm.value = 0.18; st.U.ambient.value = 0.8;
  const mat = st.docMaterial(doc.texture, [doc.width, doc.height], [AW, AH], { edge: 0 });
  const mk = (r: typeof CA, w: typeof WA) => { const m = new THREE.Mesh(cardGeo(r), mat); m.position.set(w.x, w.y, 1.5); m.rotation.z = w.rot; m.frustumCulled = false; st.scene.add(m); return m; };
  const cardA = mk(CA, WA), cardB = mk(CB, WB);
  const propsL = new Layer2D(512, 256, SCALE, { fast: true });
  drawProps(propsL.ctx);
  const tp: [number, number] = [propsL.canvas.width, propsL.canvas.height];
  const coin = st.prop(propsL.texture, tp, [0, 0, 0.5, 1], COIN_R * 2.1, COIN_R * 2.1, 0, 0, 12);
  coin.renderOrder = 5;
  st.prop(propsL.texture, tp, [0.5, 0, 0.5, 1], 280, 280, -120, 360, 1, 0.3); // 找零盤
  const repaint = () => { propsL.clear(); drawProps(propsL.ctx); propsL.upload(); };
  return { doc, mask, st, cardA, cardB, coin, repaint };
}

// ---------------------------------------------------------------- 刮的路徑
interface Swipe { pts: P2[]; len: number[]; t0: number; t1: number; panel: number }

/** Z 字來回：x 從 r.x 到 r.x + r.w，上緣超出 top、下緣超出 bot（負的 = 不到邊，留一圈刮不乾淨的鋸齒銀邊）。 */
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
/** 展開圖上的一點 → 世界座標（看它在哪一張卡上）。 */
function toWorld(p: P2, z = 1.5): V3 {
  const onB = p.x >= CB.x - 10;
  const r = onB ? CB : CA, w = onB ? WB : WA;
  const x = p.x - r.x - r.w / 2, y = r.h / 2 - (p.y - r.y);
  return [w.x + x * Math.cos(w.rot) - y * Math.sin(w.rot), w.y + x * Math.sin(w.rot) + y * Math.cos(w.rot), z];
}

const SW = 70; // 刮痕的寬（硬幣的邊）

export default class ScratchCard extends Scene {
  bgPass = shared('scratchcard.print2', PRINT_BG);
  silver = shared('scratchcard.silver2', SILVER);
  rig = shared('scratchcard.rig2', makeRig);
  /** 不會變的：卡面印刷的字、銀漆底下的留言與九宮格。 */
  print = this.track(new Layer2D(AW, AH, undefined, { fast: true }));
  /** 每格重畫：歌詞、連線、硬幣在卡上的影子。 */
  live = this.track(new Layer2D(AW, AH, undefined, { fast: true }));
  scratch = this.track(new LineBatch(2048, { screen2D: true, blend: 'max' }));
  dust = this.track(new LineBatch(2048, { screen2D: true, blend: 'normal' }));
  sparks = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  g!: Grid;
  swipes: Swipe[] = [];
  tWin = Infinity; tPrize = Infinity;
  fit: FitResult | null = null;
  /** 留言卡、九宮格在畫面上是展開圖的幾倍（鏡頭停好時量的），v2 的字級要換算。 */
  sA = 0.75; sB = 0.72;
  msgScreen: number | null = null;
  sigSize = 40;
  private printed = false;

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText(TEXT + song.title + (this.msg ? signature(this.msg.name) : '') + lyrics.linesIn(s, e).map((l) => l.text).join(''));
    const g = (this.g = grid(au, s, e));
    const seed = (this.ctx.params.seed ?? 7) * 13;
    // 鏡頭停好的位置先擺一次，量兩張卡在畫面上的縮放
    this.look(1, { x: 0, y: 0 }, 0);
    const st = this.rig.st;
    const scaleAt = (p: P2) => { const a = st.toScreen(toWorld(p)), b = st.toScreen(toWorld({ x: p.x + 100, y: p.y })); return Math.hypot(b.x - a.x, b.y - a.y) / 100; };
    this.sA = scaleAt({ x: MSGP.x + MSGP.w / 2 - 50, y: MSGP.y + MSGP.h / 2 });
    this.sB = scaleAt({ x: LYR.x + LYR.w / 2 - 50, y: LYR.y + LYR.h / 2 });
    // 刮的順序：留言兩條×左右兩半（4 段）→ 九宮格一拍一格 → 下一個小節線刮開獎項那一條。
    // 相鄰兩段互相超出一點才刮得乾淨；貼著銀漆外緣的那一邊不超出（留一圈鋸齒的銀邊，看得出刮過）
    const bandH = MSGP.h / 2, IN = 26, OV = 34, EDGE = -4;
    const plan: { r: { x: number; y: number; w: number; h: number }; panel: number; top: number; bot: number }[] = [];
    for (let b = 0; b < 2; b++) for (let hf = 0; hf < 2; hf++) {
      const x0 = hf ? MSGP.x + MSGP.w / 2 - 24 : MSGP.x + IN, x1 = hf ? MSGP.x + MSGP.w - IN : MSGP.x + MSGP.w / 2 + 24;
      plan.push({ r: { x: x0, y: MSGP.y + b * bandH, w: x1 - x0, h: bandH }, panel: 0, top: b ? OV : EDGE, bot: b < 1 ? OV : EDGE });
    }
    for (let i = 0; i < 9; i++) { const r = cellRect(i); plan.push({ r: { x: r.x + 18, y: r.y, w: r.w - 36, h: r.h }, panel: 1 + i, top: EDGE, bot: EDGE }); }
    const avail = Math.max(1.2, e - g.b0 - 0.8);
    const add = (i: number, t0: number, next: number) => {
      const pl = plan[i]!;
      const pts = zigzag(pl.r, 42, pl.top, pl.bot, seed + i);
      this.swipes.push({ pts, len: cumLen(pts), t0, t1: t0 + Math.min(0.5, Math.max(0.16, (next - t0) * 0.78)), panel: pl.panel });
    };
    const tMsg = stagger(au, g.b0, 4, Math.min(3 * g.beat, avail * 0.3));
    tMsg.forEach((t0, i) => add(i, t0, tMsg[i + 1] ?? t0 + (tMsg[1]! - tMsg[0]!)));
    // 九宮格：留言刮完，硬幣飛過去（一拍），一拍刮一格（短窗格半拍一格）
    const gStart = au.timeOfBeat(Math.ceil(au.beatAt(this.swipes[3]!.t1 + 0.05)) + 1);
    const tCell = stagger(au, gStart, 9, Math.min(9 * g.beat, Math.max(1, e - gStart - 1.2)));
    tCell.forEach((t0, i) => add(4 + i, t0, tCell[i + 1] ?? t0 + (tCell[1]! - tCell[0]!)));
    this.tWin = this.swipes[4 + 5]!.t1; // 中間那一排的最後一格刮完 = 連成一線
    const lastCell = this.swipes[this.swipes.length - 1]!.t1;
    let tp = g.bars.find((b) => b >= lastCell + 0.15) ?? Infinity;
    if (tp > e - 1.0) tp = au.timeOfBeat(Math.ceil(au.beatAt(lastCell + 0.1)));
    if (tp < e - 0.4) {
      const r = { x: PRIZE.x + IN, y: PRIZE.y, w: PRIZE.w - 2 * IN, h: PRIZE.h };
      const pts = zigzag(r, 42, EDGE, EDGE, seed + 99);
      this.swipes.push({ pts, len: cumLen(pts), t0: tp, t1: tp + Math.min(0.45, g.beat * 0.9), panel: NP - 1 });
      this.tPrize = tp;
    }
    // v2：留言字級照螢幕標準（依字數 40～60）換成卡面字級；可用高度先扣掉署名，照子句斷行
    if (this.msg) {
      const c = this.print.ctx, fam = F.hand(700), S = this.sA;
      const maxS = msgMaxFor(this.msg.text);
      const sigEst = sigV2(maxS) / S;
      const boxW = MSGP.w - 90, boxH = MSGP.h - 36 - sigEst * SIG_K;
      const opt = { min: V2.msgMin / S, max: maxS / S, lineHeight: 1.24, maxLines: 6 };
      const byW = fitText(c, this.msg.text, fam, boxW, boxH, opt);
      const byC = fitClauses(c, this.msg.text, fam, boxW, boxH, opt);
      this.fit = byC && byC.size >= byW.size * 0.9 ? byC : byW;
      this.msgScreen = this.fit.size * S;
      this.sigSize = Math.round(sigV2(this.msgScreen) / S);
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t;
    const R = this.rig, doc = R.doc;
    // ---- 1. 兩張卡畫進展開圖
    this.bgPass.render(renderer, doc);
  // 道具的畫布整晚共用，但顏色來自色票：每首歌換主題時要重畫（每個窗格第一格重畫一次，很小、很便宜）
    if (!this.printed) { this.drawPrint(); R.repaint(); this.printed = true; }
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
    this.silver.u.sheen!.value = lerp(-300, AW + 500, ease.outCubic(clamp(bp * 1.6)));
    this.silver.render(renderer, doc);
    const coin = this.coinAt(t);
    this.dust.clear(); this.sparks.clear();
    this.drawDust(t);
    const L = this.live; L.clear();
    const c = L.ctx;
    this.drawLyric(c, t);
    this.drawWin(c, t);
    if (coin.onCard) this.drawCoinShadow(c, coin);
    comp.draw(renderer, L.upload(), doc);
    if (this.dust.count) this.dust.render(renderer, doc);
    if (t > this.tWin - 0.05) {
      // 連成一線：中間那一排噴一下火星；刮開獎項那一條時再噴一次
      const y = cellRect(4).y + CELL.h / 2, x0 = cellRect(3).x, x1 = cellRect(5).x + CELL.w;
      const head = (tb: number) => (tb >= this.tWin && tb <= this.tWin + 0.3 ? { x: lerp(x0, x1, (tb - this.tWin) / 0.3), y } : null);
      sparkParticles(this.sparks, t, head, { rate: 150, life: 0.5, speed: 260, seed: 5, intensity: 0.6 });
      if (this.tPrize < Infinity && t > this.tPrize) {
        const pz = this.swipes[this.swipes.length - 1]!;
        sparkParticles(this.sparks, t, (tb) => (tb >= pz.t0 && tb <= pz.t1 ? at(pz, prog(tb, pz.t0, pz.t1, ease.inOutQuad)) : null), { rate: 120, life: 0.5, speed: 280, seed: 6, intensity: 0.6 });
      }
      if (this.sparks.count) this.sparks.render(renderer, doc);
    }
    // ---- 2. 硬幣（桌上的 3D 道具）、舞台
    R.coin.position.set(...coin.p);
    R.coin.rotation.set(-coin.tilt * 0.6 + coin.spin, 0, -0.5 + 0.12 * Math.sin(t * 7) * coin.tilt);
    this.shoot(t, coin);
    R.st.render(renderer, out);
    const win = pulse(t, this.tWin, 0.12) + (this.tPrize < Infinity ? pulse(t, this.swipes[this.swipes.length - 1]!.t1, 0.12) : 0);
    return { bloom: 0.45, vignette: 0.45, grain: 0.045, flash: 0.04 * win };
  }

  /** 鏡頭：k = 開場進度（0 貼近、1 停好），follow = 往硬幣那邊偏多少（世界座標）。 */
  private look(k: number, follow: P2, push: number) {
    const st = this.rig.st;
    const D = camDist(30);
    // 兩張卡佔滿大半個畫面（場景是主角；留言卡本身仍 ≤ 860×430）
    const dist = D * lerp(0.95, 1.18, k) * (1 - push);
    const tilt = THREE.MathUtils.degToRad(lerp(34, 25, k));
    const yaw = lerp(-0.12, 0.03, k);
    const T: V3 = [lerp(-250, 30, k) + follow.x, lerp(-150, -20, k) + follow.y, 0];
    st.look([T[0] + Math.sin(yaw) * dist * 0.6, T[1] - Math.sin(tilt) * dist, Math.cos(tilt) * dist], T);
  }

  private shoot(t: number, coin: { p: V3 }) {
    const st = this.rig.st, s = this.ctx.start, g = this.g, e = this.ctx.end;
    // 開場貼近左邊的留言卡，第一拍 outExpo 拉到停好的位置；刮的時候鏡頭往硬幣那邊偏一點點，刮完慢慢推近
    const intro = ease.outExpo(clamp((t - s) / Math.max(0.3, g.b0 - s + 0.35)));
    const last = this.swipes.length ? this.swipes[this.swipes.length - 1]!.t1 : s;
    const scratching = t > g.b0 && t < last + 0.4 ? 1 : 0;
    const fk = ease.inOutCubic(clamp((t - g.b0) / 0.6)) * (1 - ease.inOutCubic(clamp((t - last - 0.4) / 0.8)));
    const follow = { x: (coin.p[0] - 30) * 0.12 * fk * (scratching || fk > 0 ? 1 : 0), y: (coin.p[1] + 20) * 0.1 * fk };
    const push = 0.05 * ease.inOutCubic(clamp((t - last) / Math.max(1, e - last)));
    this.look(intro, follow, push);
    // 焦點：留言卡（歌詞在右邊那張，景深很淺，兩張都清楚，只有桌子的遠端失焦）
    st.U.focus.value = st.depthOf(toWorld({ x: MSGP.x + MSGP.w * 0.6, y: MSGP.y + MSGP.h / 2 }));
    st.U.aperture.value = 16;
    st.U.pool.value.set(0, 20, 1250, 0.92 + 0.06 * this.ctx.audio.hit('kick', t, 0.1));
    // 玻璃上的反光：一道寬寬的光慢慢往右滑；每個小節線另外有一道很快地閃過（像有人經過擋到燈）
    const lastBar = this.g.bars.filter((b) => b <= t).pop() ?? -1e9;
    const gx = -1400 + (((t - s) * 90) % 3400);
    (st.tableMat.uniforms.hl!.value as THREE.Vector4).set(gx, 0, 380, 1 + 1.6 * pulse(t, lastBar, 0.15));
    const sh = (r: typeof CA, w: typeof WA) => ({ x: w.x + 10, y: w.y - 14, w: r.w, h: r.h, rot: w.rot, blur: 22, k: 0.32, r: 10 });
    const coinSh = coin.p[2] > 3 && !this.coinAt(t).onCard ? [{ x: coin.p[0] + 8 + coin.p[2] * 0.3, y: coin.p[1] - 10 - coin.p[2] * 0.4, w: COIN_R * 1.9, h: COIN_R * 1.9, blur: 8 + coin.p[2] * 0.15, k: 0.3, r: COIN_R }] : [];
    st.shadows([sh(CA, WA), sh(CB, WB), { x: -110, y: 350, w: 250, h: 250, blur: 14, k: 0.35, r: 125 }, ...coinSh]);
  }

  // ------------------------------------------------------------ 印刷（畫一次）
  private drawPrint() {
    const c = this.print.ctx, m = this.msg;
    this.print.clear();
    c.textBaseline = 'alphabetic';
    // 表頭：小小的卡名與期數（配角）
    for (const [x0, title] of [[CA.x, '幸福刮刮卡'], [CB.x, '幸運九宮格']] as const) {
      c.font = font(F.hei(900), 22); c.fillStyle = rgba('sepia', 0.9);
      c.fillText(title, x0 + 40, 38);
      c.font = font(F.mono(600), 13); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.6);
      c.fillText(`第 ${PERIOD} 期`, x0 + 170, 37);
      c.letterSpacing = '0px';
    }
    c.textAlign = 'right';
    c.font = font(F.hei(900), 16);
    const pill = '中獎機率 100%', pw = c.measureText(pill).width + 24;
    c.fillStyle = rgba('blood', 0.9); c.beginPath(); c.roundRect(CA.w - 36 - pw, 16, pw, 28, 14); c.fill();
    c.fillStyle = rgba('paper'); c.fillText(pill, CA.w - 36 - 12, 36);
    c.textAlign = 'left';
    c.font = font(F.hei(700), 16); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.6);
    c.fillText('♪ 本期主題曲', LYR.x, LYR.y - 10);
    c.letterSpacing = '0px';
    // 銀漆底下：留言（焦點）＋署名（永遠在最後一行下面）
    if (m && this.fit) {
      const fit = this.fit, sigH = this.sigSize * SIG_K;
      const block = fit.height + sigH;
      const top = MSGP.y + 18 + Math.max(0, (MSGP.h - 18 - block) / 2) + fit.size * 0.86;
      drawFit(c, fit, F.hand(700), MSGP.x + 45, top, { color: rgba('sepia') });
      c.font = font(F.hand(700), this.sigSize); c.fillStyle = rgba('sepia', 0.8); c.textAlign = 'right';
      c.fillText(`${signature(m.name)}${m.couple ? '（新人）' : ''}`, MSGP.x + MSGP.w - 40, top + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.3 + this.sigSize * 1.05);
      c.textAlign = 'left';
    } else {
      const S = this.sA;
      c.font = font(F.hand(700), Math.round(60 / S)); c.fillStyle = rgba('sepia');
      c.fillText('這一格留給你', MSGP.x + 50, MSGP.y + 150);
      c.font = font(F.hand(700), Math.round(30 / S)); c.fillStyle = rgba('sepia', 0.72);
      c.fillText('掃描右下角 QR code，寫下想對新人說的話', MSGP.x + 54, MSGP.y + 240);
    }
    // 九宮格：愛心（點綴色）、∞、♪（墨色）
    SYMBOLS.forEach((sym, i) => {
      const r = cellRect(i), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      if (sym === '♥') { drawHeart(c, cx, cy + 3, 64); return; }
      c.font = font(sym === '∞' ? F.archivo(100, 700) : F.hei(700), 58); c.fillStyle = rgba('sepia', 0.8); c.textAlign = 'center';
      c.fillText(sym, cx, cy + 20);
      c.textAlign = 'left';
    });
    c.font = font(F.hei(700), 22); c.fillStyle = rgba('blood', 0.9); c.textAlign = 'center';
    c.fillText('恭喜中獎：一輩子', PRIZE.x + PRIZE.w / 2, PRIZE.y + PRIZE.h / 2 + 8);
    c.textAlign = 'left';
  }

  // ------------------------------------------------------------ 歌詞（本期主題曲，九宮格那張的上面）
  private drawLyric(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    const S = this.sB;
    const size = lyricV2(this.msgScreen) / S;
    const st: RowsStyle = { family: F.archivo(100, 800), size, minSize: V2.lyrMin / S, maxW: LYR.w, maxRows: 3, lineHeight: 1.06 };
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const lay = layoutRows(c, ly.line, st);
      const top = LYR.y + (LYR.h - lay.height) / 2 + lay.size * 0.82;
      c.save(); c.translate(LYR.x, top);
      drawRows(c, lay, st.family, t, paperInk(), ly.k);
      c.restore();
      return;
    }
    c.font = font(st.family, V2.lyrMin / S); c.fillStyle = rgba('sepia', lyrics.has ? 0.26 : 0.8);
    c.fillText(song.title || '本期主題曲', LYR.x, LYR.y + LYR.h / 2 + 10);
    if (!lyrics.has) { c.font = font(F.hei(500), 18); c.fillStyle = rgba('sepia', 0.55); c.fillText('（純音樂）', LYR.x, LYR.y + LYR.h / 2 + 56); }
  }

  // ------------------------------------------------------------ 硬幣
  /** 硬幣：位置（世界）、抬起來的高度、斜拿的程度、翻面角度；onCard = 貼在卡上（影子畫在卡上）。 */
  private coinAt(t: number): { p: V3; tilt: number; spin: number; onCard: boolean; doc: P2 | null; lift: number } {
    const sws = this.swipes, s = this.ctx.start;
    const first = sws[0];
    const restPose = { p: REST, tilt: 0, spin: 0, onCard: false, doc: null, lift: 0 };
    if (!first) return restPose;
    const Z = 12; // 貼在卡上刮的時候的高度（硬幣的半徑斜拿著）
    if (t < first.t0) {
      // 從右下角外面飛進來，第一拍剛好落在起點
      const u = prog(t, Math.max(s, first.t0 - 0.7), first.t0, ease.outCubic);
      const p0 = toWorld(first.pts[0]!, Z);
      return { p: [lerp(REST[0], p0[0], u), lerp(REST[1] - 200, p0[1], u), lerp(160, Z, u) + Math.sin(u * Math.PI) * 60], tilt: 1, spin: 0, onCard: u > 0.8, doc: first.pts[0]!, lift: 1 - u };
    }
    for (let i = 0; i < sws.length; i++) {
      const sw = sws[i]!;
      if (t <= sw.t1) {
        if (t >= sw.t0) { const d = at(sw, prog(t, sw.t0, sw.t1, ease.inOutQuad)); return { p: toWorld(d, Z), tilt: 1, spin: 0, onCard: true, doc: d, lift: 0 }; }
        // 兩段之間：抬起來、弧線移到下一段的起點（從留言卡飛到九宮格時抬高一點）
        const prev = sws[i - 1]!;
        const u = prog(t, prev.t1, sw.t0, ease.inOutCubic);
        const a = toWorld(prev.pts[prev.pts.length - 1]!, Z), b = toWorld(sw.pts[0]!, Z);
        const far = Math.hypot(b[0] - a[0], b[1] - a[1]) > 400;
        const h = Math.sin(u * Math.PI) * (far ? 160 : 40);
        const same = !far;
        const da = prev.pts[prev.pts.length - 1]!, db = sw.pts[0]!;
        return { p: [lerp(a[0], b[0], u), lerp(a[1], b[1], u), Z + h], tilt: 1, spin: far ? ease.inOutCubic(u) * TAU : 0, onCard: same, doc: same ? { x: lerp(da.x, db.x, u), y: lerp(da.y, db.y, u) } : null, lift: Math.sin(u * Math.PI) };
      }
    }
    // 刮完：躺到桌上；之後每個小節線自己彈起來翻一圈半、在下一拍前落地
    const last = sws[sws.length - 1]!;
    const tRest = last.t1 + 0.6;
    if (t < tRest) {
      const u = prog(t, last.t1 + 0.1, tRest, ease.inOutCubic);
      const a = toWorld(last.pts[last.pts.length - 1]!, Z);
      return { p: [lerp(a[0], REST[0], u), lerp(a[1], REST[1], u), lerp(Z, REST[2], u) + Math.sin(u * Math.PI) * 90], tilt: 1 - u, spin: 0, onCard: false, doc: null, lift: Math.sin(u * Math.PI) };
    }
    const g = this.g;
    let bi = -1;
    for (let i = 0; i < g.bars.length; i++) if (g.bars[i]! >= tRest + 0.1 && g.bars[i]! <= t) bi = i;
    if (bi >= 0) {
      const b = g.bars[bi]!, u = prog(t, b, b + Math.min(0.5, g.beat * 0.95));
      if (u < 1) return { p: [REST[0], REST[1], REST[2] + Math.sin(u * Math.PI) * 130], tilt: 0, spin: ease.outCubic(u) * Math.PI * 3, onCard: false, doc: null, lift: Math.sin(u * Math.PI) };
    }
    return restPose;
  }

  /** 硬幣貼在卡上時，卡面上的影子（桌面的影子會被卡片蓋住，所以畫在卡上）。 */
  private drawCoinShadow(c: CanvasRenderingContext2D, coin: { doc: P2 | null; lift: number }) {
    if (!coin.doc) return;
    c.save();
    c.fillStyle = rgba('sepia', 0.2 - 0.08 * coin.lift);
    c.beginPath(); c.ellipse(coin.doc.x + 10 + 26 * coin.lift, coin.doc.y + 14 + 34 * coin.lift, COIN_R, COIN_R * 0.62, -0.5, 0, TAU); c.fill();
    c.restore();
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
    // 中間那一排三顆愛心刮出來：一條紅筆線劃過去
    const u = prog(t, this.tWin + 0.02, this.tWin + 0.3, ease.outCubic);
    if (u <= 0) return;
    const y = cellRect(4).y + CELL.h / 2 + 4, x0 = cellRect(3).x + 16, x1 = cellRect(5).x + CELL.w - 16;
    c.save();
    c.strokeStyle = rgba('blood', 0.85); c.lineWidth = 6; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x0, y + 6); c.quadraticCurveTo((x0 + x1) / 2, y - 14, lerp(x0, x1, u), y + 4 - 6 * u); c.stroke();
    c.restore();
  }
}
