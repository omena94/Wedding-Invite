// 組裝說明書（批次 T4・紙本 D，亮）：一張「組合式愛心」的無字說明書攤在工作桌上。
//  - 左邊是步驟圖：等角的線稿，零件是兩個半邊的心形木塊、兩根木榫、一支六角扳手。四個步驟跟著小節線換頁：
//    1 確認零件（零件一拍一個掉進來）→ 2 插入木榫（沿著虛線箭頭一拍插一根）→ 3 對齊・鎖緊（右半邊滑過去、喀！、扳手一拍轉四分之一圈）
//    → 4 完成（整顆心一拍轉一下給你看，正面填上點綴色）。步驟圖下面的說明文字就是現在唱的那句歌詞（中等大小，逐字跟唱）。
//  - 右邊是「注意事項」：主打留言像有人拿筆寫在說明書的空白處（手寫字、最大，是畫面的焦點），署名在下面。
//  - 其他字都很小：型號、步驟編號（空心的大數字只當圖形）、頁碼。冷面：「2 人組裝」「所需時間：一輩子」。
//  - 鏡頭：斜斜地拍桌上的說明書，換步驟時鏡頭往步驟圖推一下再回來；焦點在留言上，桌面遠端失焦。
// 畫法：線稿是 Canvas2D 自己做的 3D 投影（正交、偏航＋俯角），每個零件是擠出的多邊形，面照深度排序、先畫遠的，
// 所以被擋住的線自然被蓋掉（畫家演算法），只描輪廓、外形線與銳角的稜線（曲面上不畫一條條的分面線）。
// 紙面畫進 render target，交給 _t4 的舞台用透視鏡頭拍（桌面、影子、景深）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, SCALE } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, prog, pulse, TAU } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { lyricAt, signature, lyricSubOf, layoutLyric, subStyleFor, subGap, drawLyricSub, type LyricStyle } from './_motifs';
import { grid, drawFit, layoutRows, drawRows, paperInk, lastIdx, Stage, docRT, camDist, type Grid, type RowsStyle, type V3 } from './_t4';
import { msgMaxFor, lyricV2, sigV2, V2, fitClauses } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'doc', paper: true, energy: [0.2, 0.85], bars: [4, 8] };

// ---------------------------------------------------------------- 紙面（像素，左上原點、y 向下）
const DW = 1500, DH = 1000;
const ILL = { x: 70, y: 150, w: 720, h: 600, cx: 420, cy: 470 }; // 步驟圖
const CAP = { x: 70, y: 780, w: 720, h: 150 }; // 說明文字（歌詞）
const COL = 820; // 左右欄的分隔線
const NOTE = { x: 858, y: 250, w: 592, h: 640 }; // 注意事項（留言）
const SIG_K = 1.45; // 署名佔的高度 = 署名字級 × SIG_K
const STEP_NAMES = ['確認零件', '插入木榫', '對齊・鎖緊', '完成'];
// 符號（♪ ∞ ☑ → 之類）不在打包時掃的中文範圍裡，要跟中文一起預載，不然第一次畫會用備援字型（確定性也會不過）
const TEXT = '♪∞☑☐→·—♥%＄$組合式愛心組裝說明人組裝所需時間一輩子注意事項請勿單獨組裝本產品需兩人同時操作零件左半心右半心木榫六角扳手耐心確認插入對齊鎖緊完成喀頁這一格留給你的叮嚀掃描右下角寫下想對新人說的話純音樂間奏中';

// ---------------------------------------------------------------- 紙（shader）：很淡的纖維、左右欄之間的細線
const PAPER = () => new FSPass(/* glsl */ `
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${DH}.0 - FRAG_PX.y);
    vec3 col = C_PAPER * (0.992 + 0.01 * fbm(p / 240.0, 3) + 0.006 * snoise(p / 6.0));
    col = mix(col, C_SEPIA, pxLine(abs(p.x - ${COL}.0), 0.3, 1.2) * 0.35 * step(160.0, p.y) * step(p.y, ${DH - 90}.0));
    fragColor = vec4(col, 1.0);
  }`);

/** 工作桌上散落的東西（多出來的螺絲、一根木榫、一支鉛筆）：畫一次，整晚共用。 */
/**
 * 攤在木頭地板上的零件（俯視），畫一次、整晚共用。1024×512 的畫布分四格：
 * 左半：兩塊半邊的心形木塊；右上：兩根木榫＋一支六角扳手；右下左：三顆螺絲；右下右：一支鉛筆。
 */
function drawProps(c: CanvasRenderingContext2D) {
  // 兩塊木頭（半邊的心），淺色木頭＋幾條木紋，側面一圈比較暗（厚度）
  const piece = (poly: [number, number][], ox: number, oy: number, sc: number) => {
    const path = () => { c.beginPath(); poly.forEach(([x, y], i) => (i ? c.lineTo(ox + x * sc, oy + y * sc) : c.moveTo(ox + x * sc, oy + y * sc))); c.closePath(); };
    c.save();
    c.translate(10, 12); path(); c.fillStyle = mixRgba('paper', 'sepia', 0.45); c.fill(); c.translate(-10, -12);
    path(); c.fillStyle = mixRgba('paper', 'sepia', 0.22); c.fill();
    c.clip();
    c.strokeStyle = mixRgba('paper', 'sepia', 0.38, 0.6); c.lineWidth = 2;
    for (let k = 0; k < 9; k++) { c.beginPath(); c.moveTo(ox - 200, oy - 120 + k * 30); c.bezierCurveTo(ox - 60, oy - 100 + k * 30, ox + 40, oy - 140 + k * 30, ox + 200, oy - 115 + k * 30); c.stroke(); }
    c.restore();
    path(); c.strokeStyle = rgba('sepia', 0.55); c.lineWidth = 2.5; c.stroke();
  };
  piece(HALF_L, 250, 230, 1.35);
  piece(HALF_R, 290, 290, 1.35);
  // 木榫：兩根短短的圓棒
  const dowel = (x: number, y: number) => {
    c.fillStyle = mixRgba('paper', 'sepia', 0.3); c.fillRect(x, y, 170, 30);
    c.fillStyle = mixRgba('paper', 'sepia', 0.18); c.fillRect(x, y + 5, 170, 8);
    c.strokeStyle = rgba('sepia', 0.5); c.lineWidth = 2; c.strokeRect(x, y, 170, 30);
    c.fillStyle = mixRgba('paper', 'sepia', 0.4); c.beginPath(); c.ellipse(x + 170, y + 15, 7, 15, 0, 0, TAU); c.fill();
  };
  dowel(560, 40); dowel(600, 100);
  // 六角扳手：L 形，金屬（灰）
  c.save(); c.strokeStyle = rgba('sepia', 0.7); c.lineWidth = 20; c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath(); c.moveTo(830, 60); c.lineTo(980, 60); c.lineTo(980, 200); c.stroke();
  c.strokeStyle = rgba('ash'); c.lineWidth = 13;
  c.beginPath(); c.moveTo(830, 60); c.lineTo(980, 60); c.lineTo(980, 200); c.stroke();
  c.restore();
  // 螺絲（俯視：圓頭＋十字）
  const screw = (x: number, y: number, r: number) => {
    const gr = c.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
    gr.addColorStop(0, rgba('bone')); gr.addColorStop(1, rgba('ash'));
    c.fillStyle = gr; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    c.strokeStyle = rgba('sepia', 0.6); c.lineWidth = 2; c.stroke();
    c.lineWidth = 3; c.beginPath(); c.moveTo(x - r * 0.55, y); c.lineTo(x + r * 0.55, y); c.moveTo(x, y - r * 0.55); c.lineTo(x, y + r * 0.55); c.stroke();
  };
  screw(580, 330, 30); screw(670, 360, 26); screw(620, 430, 28);
  // 鉛筆（斜的）
  c.save(); c.translate(790, 470); c.rotate(-0.72);
  c.fillStyle = rgba('signal', 0.85); c.fillRect(0, -10, 260, 20);
  c.fillStyle = rgba('sepia', 0.2); c.fillRect(0, 3, 260, 7);
  c.fillStyle = rgba('bone'); c.beginPath(); c.moveTo(260, -10); c.lineTo(300, 0); c.lineTo(260, 10); c.fill();
  c.fillStyle = rgba('sepia', 0.85); c.beginPath(); c.moveTo(290, -2.5); c.lineTo(300, 0); c.lineTo(290, 2.5); c.fill();
  c.restore();
}

function makeRig() {
  const doc = docRT(DW, DH);
  // 說明書攤在木頭地板上，旁邊散著零件（兩塊心形木塊、木榫、扳手、螺絲、鉛筆）；頭頂一盞工作燈，光圈清楚、四周暗一點
  const st = new Stage(5, 30);
  st.U.poolFloor.value = 0.6;
  const mat = st.docMaterial(doc.texture, [doc.width, doc.height], [DW, DH], { radius: 3 });
  const page = st.docMesh(mat, DW, DH, 0, 0, 1);
  page.rotation.z = 0.018;
  const pl = new Layer2D(1024, 512, SCALE, { fast: true });
  drawProps(pl.ctx);
  const tp: [number, number] = [pl.canvas.width, pl.canvas.height];
  st.prop(pl.texture, tp, [0, 0, 0.5, 1], 460, 460, 1010, 170, 1, 0.35); // 兩塊心形木塊（說明書右邊的地板上）
  st.prop(pl.texture, tp, [0.5, 0, 0.5, 0.45], 420, 190, 960, 560, 1, -0.3); // 木榫與扳手（右上）
  st.prop(pl.texture, tp, [0.5, 0.55, 0.25, 0.45], 180, 160, -870, 380, 1, 0.2); // 三顆螺絲（左上）
  st.prop(pl.texture, tp, [0.74, 0.5, 0.26, 0.5], 250, 250, -950, -330, 1, 0.3); // 鉛筆（左下）
  const repaint = () => { pl.clear(); drawProps(pl.ctx); pl.upload(); };
  return { doc, st, mat, page, repaint };
}

// ---------------------------------------------------------------- 等角線稿
type P3 = [number, number, number];
interface View { yaw: number; pitch: number; s: number; ox: number; oy: number }
/** 零件空間（x 右、y 下、z 朝前）→ 紙面像素與深度（大 = 近）。 */
function proj(v: View, p: P3): [number, number, number] {
  const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw), cp = Math.cos(v.pitch), sp = Math.sin(v.pitch);
  const x1 = p[0] * cy + p[2] * sy, z1 = -p[0] * sy + p[2] * cy;
  const y2 = p[1] * cp + z1 * sp, z2 = -p[1] * sp + z1 * cp;
  return [v.ox + v.s * x1, v.oy + v.s * y2, z2];
}
/** 法向量轉到視角空間後的 z（> 0 = 朝向我們）與照光（左上前方來的光）。 */
function facing(v: View, n: P3): { z: number; light: number } {
  const o = proj({ ...v, s: 1, ox: 0, oy: 0 }, n);
  const L = [-0.45, -0.6, 0.66];
  const len = Math.hypot(o[0], o[1], o[2]) || 1;
  return { z: o[2], light: Math.max(0, (o[0] * L[0]! + o[1] * L[1]! + o[2] * L[2]!) / len) };
}

const S = 128; // 心的大小（半寬）
/** 半邊的心（side = -1 左、+1 右）：從底尖沿外緣到上方凹口，再沿中線回到底尖。 */
function halfHeart(side: -1 | 1, n = 30): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = side < 0 ? Math.PI + (i / n) * Math.PI : Math.PI - (i / n) * Math.PI;
    const x = 16 * Math.sin(a) ** 3, y = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
    pts.push([(x / 16) * S, ((y + 2.5) / 16 - 0.31) * S]);
  }
  return pts;
}
const HALF_L = halfHeart(-1), HALF_R = halfHeart(1);
const THICK = 62;
const DOWEL_Y = [-0.02 * S, 0.5 * S];

interface Style { ink: string; w: number; fill: (light: number) => string; cap?: string }
const woodStyle = (): Style => ({ ink: rgba('sepia', 0.92), w: 2.2, fill: (l) => mixRgba('paper', 'sepia', 0.16 - 0.12 * l, 1) });

/** 擠出的多邊形（畫家演算法）。poly 在 xy 平面，z ∈ [-T/2, T/2]，整個平移 off。 */
function drawPrism(c: CanvasRenderingContext2D, v: View, poly: [number, number][], T: number, off: P3, st: Style) {
  const n = poly.length;
  let area = 0;
  for (let i = 0; i < n; i++) { const a = poly[i]!, b = poly[(i + 1) % n]!; area += a[0] * b[1] - b[0] * a[1]; }
  const orient = area > 0 ? 1 : -1; // y 向下的座標系裡，orient > 0 是順時針
  const F = poly.map((p) => proj(v, [p[0] + off[0], p[1] + off[1], T / 2 + off[2]]));
  const B = poly.map((p) => proj(v, [p[0] + off[0], p[1] + off[1], -T / 2 + off[2]]));
  const sides: { i: number; d: number; vis: boolean; light: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i]!, b = poly[(i + 1) % n]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const f = facing(v, [dy * orient, -dx * orient, 0]);
    sides.push({ i, d: (F[i]![2] + F[(i + 1) % n]![2] + B[i]![2] + B[(i + 1) % n]![2]) / 4, vis: f.z > 1e-3, light: f.light });
  }
  const front = facing(v, [0, 0, 1]);
  c.save();
  c.lineJoin = 'round'; c.lineCap = 'round';
  // 側面：由遠到近
  for (const sd of [...sides].filter((q) => q.vis).sort((p, q) => p.d - q.d)) {
    const i = sd.i, j = (i + 1) % n;
    c.fillStyle = st.fill(sd.light);
    c.strokeStyle = c.fillStyle;
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(F[i]![0], F[i]![1]); c.lineTo(F[j]![0], F[j]![1]); c.lineTo(B[j]![0], B[j]![1]); c.lineTo(B[i]![0], B[i]![1]); c.closePath();
    c.fill(); c.stroke();
    // 前後的輪廓邊
    c.strokeStyle = st.ink; c.lineWidth = st.w;
    c.beginPath(); c.moveTo(F[i]![0], F[i]![1]); c.lineTo(F[j]![0], F[j]![1]); c.moveTo(B[i]![0], B[i]![1]); c.lineTo(B[j]![0], B[j]![1]); c.stroke();
    // 稜線：這一面跟下一面一個看得到一個看不到（外形線），或是轉角很銳利
    for (const k of [i, j]) {
      const prev = sides[(k - 1 + n) % n]!, next = sides[k % n]!;
      const a0 = poly[(k - 1 + n) % n]!, a1 = poly[k]!, a2 = poly[(k + 1) % n]!;
      const t1 = Math.atan2(a1[1] - a0[1], a1[0] - a0[0]), t2 = Math.atan2(a2[1] - a1[1], a2[0] - a1[0]);
      let turn = Math.abs(t2 - t1); if (turn > Math.PI) turn = TAU - turn;
      if (prev.vis !== next.vis || turn > 0.55) {
        c.beginPath(); c.moveTo(F[k]![0], F[k]![1]); c.lineTo(B[k]![0], B[k]![1]); c.stroke();
      }
    }
  }
  // 看得到的那一個蓋子
  const cap = front.z > 0 ? F : B;
  c.fillStyle = st.cap ?? st.fill(front.z > 0 ? front.light : facing(v, [0, 0, -1]).light);
  c.strokeStyle = st.ink; c.lineWidth = st.w;
  c.beginPath(); cap.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath();
  c.fill(); c.stroke();
  c.restore();
}

/** 沿 x 軸的圓柱（木榫）：兩端的圓投影成橢圓，外形取凸包，再畫看得到的那一端。 */
function drawDowel(c: CanvasRenderingContext2D, v: View, x0: number, x1: number, y: number, z: number, r: number, st: Style) {
  const ring = (x: number) => Array.from({ length: 18 }, (_, i) => { const a = (i / 18) * TAU; return proj(v, [x, y + Math.cos(a) * r, z + Math.sin(a) * r]); });
  const A = ring(x0), B2 = ring(x1);
  const hull = convexHull([...A, ...B2].map((p) => [p[0], p[1]] as [number, number]));
  c.save();
  c.lineJoin = 'round';
  c.fillStyle = st.fill(0.4); c.strokeStyle = st.ink; c.lineWidth = st.w;
  c.beginPath(); hull.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); c.fill(); c.stroke();
  const endVis = facing(v, [1, 0, 0]).z > 0 ? B2 : A;
  c.fillStyle = st.fill(0.9);
  c.beginPath(); endVis.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); c.fill(); c.stroke();
  c.restore();
}
function convexHull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], hi: [number, number][] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2]!, hi[hi.length - 1]!, q) <= 0) hi.pop(); hi.push(q); }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}

/** 六角扳手：L 形的管子（先粗的墨線、再細一點的紙色，看起來是有外框的棒子）。 */
function drawKey(c: CanvasRenderingContext2D, v: View, pts: P3[], st: Style) {
  const P = pts.map((p) => proj(v, p));
  c.save();
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.strokeStyle = st.ink; c.lineWidth = 15;
  c.beginPath(); P.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.stroke();
  c.strokeStyle = st.fill(0.7); c.lineWidth = 10;
  c.beginPath(); P.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.stroke();
  c.restore();
}

/** 虛線箭頭（紙面像素）。u = 0..1 畫到哪裡。 */
function arrow(c: CanvasRenderingContext2D, a: [number, number], b: [number, number], u: number, col: string) {
  if (u <= 0) return;
  const x = lerp(a[0], b[0], u), y = lerp(a[1], b[1], u);
  c.save();
  c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 2.5; c.setLineDash([10, 8]);
  c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(x, y); c.stroke();
  c.setLineDash([]);
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  c.translate(x, y); c.rotate(ang);
  c.beginPath(); c.moveTo(4, 0); c.lineTo(-14, -8); c.lineTo(-14, 8); c.closePath(); c.fill();
  c.restore();
}

export default class Manual extends Scene {
  paper = shared('manual.paper', PAPER);
  rig = shared('manual.rig', makeRig);
  /** 不會變的：型號、欄線、注意事項的標題與圖示、頁碼。 */
  base = this.track(new Layer2D(DW, DH, undefined, { fast: true }));
  /** 每格重畫：步驟圖、步驟編號、歌詞、留言。 */
  live = this.track(new Layer2D(DW, DH, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  g!: Grid;
  /** 每一步開始的拍號（beatAt 的整數）與每步幾拍。 */
  stepBeat: number[] = [];
  per = 4;
  fit: FitResult | null = null;
  /** 注意事項、說明文字在畫面上是紙面的幾倍（鏡頭停好時量的），v2 的字級要換算。 */
  sNote = 0.85; sCap = 0.85;
  msgScreen: number | null = null;
  sigSize = 36;
  private baseDrawn = false;

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText(TEXT + song.title + (this.msg ? signature(this.msg.name) : '') + lyrics.linesIn(s, e).map((l) => l.text).join(''));
    const g = (this.g = grid(au, s, e));
    // 每一步幾拍：長窗格一步兩小節（或更長），四到七小節一步一小節，很短的窗格一步半小節
    const b0 = Math.round(au.beatAt(g.b0));
    const nBeats = Math.max(1, Math.floor(au.beatAt(e) - b0));
    this.per = nBeats >= 32 ? Math.floor(nBeats / 16) * 4 : nBeats >= 16 ? 4 : Math.max(1, Math.floor(nBeats / 4));
    // 第一步從窗格一開始就在（零件從第一拍開始掉進來），後面的步驟落在小節線上
    this.stepBeat = [0, 1, 2, 3].map((i) => b0 + i * this.per);
    // 鏡頭停好的位置先擺一次，量注意事項與說明文字在畫面上的縮放
    this.look(1, 0);
    const st = this.rig.st;
    const scaleAt = (u: number, v: number) => { const a = st.toScreen(this.world(u, v)), b = st.toScreen(this.world(u + 100, v)); return Math.hypot(b.x - a.x, b.y - a.y) / 100; };
    this.sNote = scaleAt(NOTE.x + NOTE.w / 2 - 50, NOTE.y + NOTE.h * 0.4);
    this.sCap = scaleAt(CAP.x + CAP.w / 2 - 50, CAP.y + CAP.h / 2);
    // v2：留言字級照螢幕標準（依字數 40～60）換成紙面字級；可用高度先扣掉署名，照子句斷行
    if (this.msg) {
      const c = this.live.ctx, S = this.sNote, fam = F.hand(700), maxS = msgMaxFor(this.msg.text);
      const boxH = Math.min(NOTE.h, 420 / S) - (sigV2(maxS) / S) * SIG_K;
      const opt = { min: V2.msgMin / S, max: maxS / S, lineHeight: 1.26, maxLines: 7 };
      const byW = fitText(c, this.msg.text, fam, NOTE.w, boxH, opt);
      const byC = fitClauses(c, this.msg.text, fam, NOTE.w, boxH, opt);
      // 照子句斷行比較好讀，但欄位窄時子句一句一行會變得很高：多出來超過一行就用一般的斷法
      this.fit = byC && byC.size >= byW.size * 0.9 && byC.lines.length <= byW.lines.length + 1 ? byC : byW;
      this.msgScreen = this.fit.size * S;
      this.sigSize = Math.round(sigV2(this.msgScreen) / S);
    }
  }

  /** 第 i 步裡第 k 個動作的時間（步驟短時動作跟著壓縮）。 */
  private act(i: number, k: number) {
    const sc = Math.min(1, this.per / 4);
    return this.ctx.audio.timeOfBeat(this.stepBeat[i]! + k * sc);
  }
  private stepAt(t: number) {
    const bt = this.ctx.audio.beatAt(t);
    let i = 0;
    for (let k = 1; k < 4; k++) if (bt >= this.stepBeat[k]! - 1e-6) i = k;
    return i;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, R = this.rig;
    this.paper.render(renderer, R.doc);
  // 道具的畫布整晚共用，但顏色來自色票：每首歌換主題時要重畫（每個窗格第一格重畫一次，很小、很便宜）
    if (!this.baseDrawn) { this.drawBase(); R.repaint(); this.baseDrawn = true; }
    comp.draw(renderer, this.base.texture, R.doc);
    const L = this.live; L.clear();
    const c = L.ctx;
    const step = this.stepAt(t);
    this.drawStep(c, t, step);
    this.drawLyric(c, t);
    this.drawNote(c, t);
    comp.draw(renderer, L.upload(), R.doc);
    this.shoot(t, step);
    R.st.render(renderer, out);
    return { paper: 1, bloom: 0.3, vignette: 0.3, grain: 0.04 };
  }

  private world(u: number, v: number, z = 1): V3 {
    const r = this.rig.page.rotation.z, x = u - DW / 2, y = DH / 2 - v;
    return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r), z];
  }

  /** 鏡頭位置：intro = 開場進度（0 貼近、1 停好），push = 換步驟時往步驟圖推一下。 */
  private look(intro: number, push: number) {
    const D = camDist(30);
    // 說明書偏左上一點：右下角的 QR 區留乾淨（紙的角不要壓在 HUD 下面）
    const aim = { x: lerp(DW * 0.5 + 190, ILL.cx, 0.25 * push), y: lerp(DH * 0.62, ILL.cy + 40, 0.2 * push) };
    const T = this.world(aim.x, aim.y, 0);
    // 幾乎正上方往下看（像在工作桌前看說明書），說明書佔滿大半個畫面
    const dist = D * lerp(0.98, 1.16, intro) * (1 - 0.06 * push);
    const tilt = THREE.MathUtils.degToRad(lerp(28, 14, intro));
    const yaw = lerp(-0.2, -0.06, intro);
    this.rig.st.look([T[0] + Math.sin(yaw) * dist, T[1] - Math.sin(tilt) * dist, Math.cos(tilt) * dist], T);
  }

  /** 鏡頭：斜斜地拍整張說明書；換步驟時往步驟圖推一下（outExpo）、半小節後慢慢退回來。焦點在留言。 */
  private shoot(t: number, step: number) {
    const st = this.rig.st, g = this.g, s = this.ctx.start;
    const intro = ease.outExpo(clamp((t - s) / Math.max(0.3, g.b0 - s + 0.4)));
    const ts = step > 0 ? this.ctx.audio.timeOfBeat(this.stepBeat[step]!) : -1e9;
    const push = step > 0 ? ease.outExpo(clamp((t - ts) / 0.35)) * (1 - ease.inOutCubic(clamp((t - ts - g.bar * 0.5) / (g.bar * 0.8)))) : 0;
    this.look(intro, push);
    st.U.goboT.value = t;
    st.U.focus.value = st.depthOf(this.world(NOTE.x + NOTE.w / 2, NOTE.y + NOTE.h * 0.45));
    st.U.aperture.value = 34;
    // 工作燈：換步驟時燈被碰了一下，光圈左右晃幾下再停（阻尼擺）
    const sw = step > 0 ? Math.exp(-(t - ts) * 1.6) * Math.sin((t - ts) * 5.5) : 0;
    st.U.pool.value.set(-120 + 90 * sw, 120, 1350, 0.75);
    const c0 = this.world(DW / 2, DH / 2, 0);
    st.shadows([{ x: c0[0] + 10, y: c0[1] - 14, w: DW, h: DH, rot: this.rig.page.rotation.z, blur: 22, k: 0.3, r: 4 }]);
  }

  // ------------------------------------------------------------ 不會變的
  private drawBase() {
    const c = this.base.ctx;
    this.base.clear();
    c.textBaseline = 'alphabetic';
    c.font = font(F.hei(700), 22); c.fillStyle = rgba('sepia', 0.85);
    c.fillText('組合式愛心　HRT-0313', 70, 96);
    c.font = font(F.mono(500), 15); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.6);
    c.fillText('ASSEMBLY INSTRUCTIONS', 330, 94);
    c.letterSpacing = '0px';
    c.textAlign = 'right';
    c.font = font(F.hei(500), 18); c.fillStyle = rgba('sepia', 0.7);
    c.fillText('2 人組裝　·　所需時間：一輩子', DW - 60, 96);
    c.textAlign = 'left';
    c.fillStyle = rgba('sepia', 0.5); c.fillRect(70, 114, DW - 130, 1.5);
    // 注意事項：小小的警告三角形（通用的樣子）＋標題
    const ix = NOTE.x, iy = NOTE.y - 70;
    c.save();
    c.strokeStyle = rgba('sepia', 0.9); c.lineWidth = 3; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(ix + 20, iy - 18); c.lineTo(ix + 42, iy + 20); c.lineTo(ix - 2, iy + 20); c.closePath(); c.stroke();
    c.fillStyle = rgba('sepia', 0.9);
    c.fillRect(ix + 18.5, iy - 4, 3, 14); c.fillRect(ix + 18.5, iy + 13, 3, 3);
    c.restore();
    c.font = font(F.hei(900), 22); c.fillStyle = rgba('sepia', 0.9);
    c.fillText('注意事項', ix + 56, iy + 16);
    c.font = font(F.mono(500), 14); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.55);
    c.fillText('CAUTION', ix + 160, iy + 14);
    c.letterSpacing = '0px';
  }

  // ------------------------------------------------------------ 步驟圖
  private drawStep(c: CanvasRenderingContext2D, t: number, step: number) {
    const au = this.ctx.audio;
    const ts = step > 0 ? au.timeOfBeat(this.stepBeat[step]!) : this.ctx.start - 1;
    // 換步驟：舊的往左滑走、新的從右邊滑進來（outExpo，0.35 秒）
    const sl = step > 0 ? ease.outExpo(clamp((t - ts) / 0.35)) : 1;
    c.save();
    c.beginPath(); c.rect(ILL.x - 20, ILL.y - 40, ILL.w + 40, ILL.h + 60); c.clip();
    if (sl < 1) {
      c.save(); c.globalAlpha = 1 - sl; c.translate(-260 * sl, 0);
      this.illustration(c, ts - 0.001, step - 1);
      c.restore();
    }
    c.save(); c.globalAlpha = sl; c.translate(260 * (1 - sl), 0);
    this.illustration(c, t, step);
    c.restore();
    c.restore();
    // 步驟編號：空心的大數字（圖形，不搶字）＋小小的步驟名
    c.save();
    c.globalAlpha = sl;
    c.font = font(F.archivo(100, 900), 84); c.strokeStyle = rgba('sepia', 0.4); c.lineWidth = 2;
    c.strokeText(String(step + 1), ILL.x, ILL.y + 64);
    c.font = font(F.hei(700), 20); c.fillStyle = rgba('sepia', 0.75);
    c.fillText(STEP_NAMES[step]!, ILL.x + 64, ILL.y + 40);
    c.font = font(F.mono(500), 13); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.45);
    c.fillText(`STEP ${step + 1} / 4`, ILL.x + 64, ILL.y + 64);
    c.letterSpacing = '0px';
    c.restore();
  }

  private illustration(c: CanvasRenderingContext2D, t: number, step: number) {
    const st = woodStyle();
    const accent = rgba('blood', 0.9);
    // 步驟越後面零件越少，畫大一點
    // 每一拍零件輕輕彈一下（次要動作落在拍點；只彈幾 px，不會飄）
    const au0 = this.ctx.audio, hop = 7 * pulse(t, au0.timeOfBeat(Math.floor(au0.beatAt(t) + 1e-6)), 0.08);
    const v: View = { yaw: -0.55, pitch: 0.42, s: [1.05, 1.3, 1.3, 1.45][step]!, ox: ILL.cx + [60, 100, 90, 40][step]!, oy: ILL.cy + 10 - hop };
    const drop = (k: number) => { const a = this.act(step, k); return { u: ease.outBack(clamp((t - a) / 0.3), 1.6), a: clamp((t - a) / 0.08) }; };
    if (step === 0) {
      // 零件一拍一個掉進來：A 左半、B 右半、C 木榫 ×2、D 扳手
      const parts: { x: number; draw: (vv: View) => void; label: string; n: string }[] = [
        { x: -290, label: 'A', n: '×1', draw: (vv) => drawPrism(c, vv, HALF_L, THICK, [0, 0, 0], st) },
        { x: -70, label: 'B', n: '×1', draw: (vv) => drawPrism(c, vv, HALF_R, THICK, [0, 0, 0], st) },
        { x: 125, label: 'C', n: '×2', draw: (vv) => { drawDowel(c, vv, -34, 34, -40, 0, 12, st); drawDowel(c, vv, -34, 34, 30, 0, 12, st); } },
        { x: 280, label: 'D', n: '×1', draw: (vv) => drawKey(c, vv, [[-40, -70, 0], [-40, 60, 0], [20, 60, 0]], st) },
      ];
      parts.forEach((p, i) => {
        const d = drop(i);
        if (d.a <= 0) return;
        c.save(); c.globalAlpha *= d.a;
        const vv = { ...v, ox: v.ox + p.x, oy: v.oy - 240 * (1 - d.u) };
        p.draw(vv);
        // 零件代號（圓圈字母）＋數量
        const lx = vv.ox - 10, ly = ILL.cy + 215;
        c.strokeStyle = rgba('sepia', 0.8); c.lineWidth = 2;
        c.beginPath(); c.arc(lx, ly, 17, 0, TAU); c.stroke();
        c.font = font(F.archivo(100, 700), 20); c.fillStyle = rgba('sepia'); c.textAlign = 'center';
        c.fillText(p.label, lx, ly + 7);
        c.font = font(F.mono(600), 18); c.textAlign = 'left';
        c.fillText(p.n, lx + 26, ly + 7);
        c.restore();
      });
      return;
    }
    const Ax = -110;
    if (step === 1) {
      // 左半邊躺好，木榫沿著虛線箭頭一拍插一根
      drawPrism(c, v, HALF_L, THICK, [Ax, 0, 0], st);
      // 切面上的兩個孔
      DOWEL_Y.forEach((y) => {
        const ring = Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * TAU; return proj(v, [Ax, y + Math.cos(a) * 12, Math.sin(a) * 12]); });
        c.fillStyle = rgba('sepia', 0.55);
        c.beginPath(); ring.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); c.fill();
      });
      DOWEL_Y.forEach((y, i) => {
        const a = this.act(1, 1 + i);
        const u = ease.outExpo(clamp((t - a) / 0.3));
        const x0 = lerp(Ax + 220, Ax, u);
        const pa = proj(v, [Ax + 250, y, 0]), pb = proj(v, [Ax + 40, y, 0]);
        // 虛線箭頭先畫出來（動作前半秒），木榫插到底就收掉
        if (u < 0.98) arrow(c, [pa[0], pa[1]], [pb[0], pb[1]], clamp((t - a + 0.5) / 0.3), accent);
        drawDowel(c, v, x0 - 28, x0 + 28, y, 0, 12, st);
      });
      return;
    }
    if (step === 2) {
      // 右半邊滑過去（第一拍），喀！（第二拍），扳手一拍轉四分之一圈
      const aB = this.act(2, 1), aClick = this.act(2, 2);
      const u = ease.outExpo(clamp((t - aB) / 0.3));
      const Bx = lerp(Ax + 190, Ax, u);
      drawPrism(c, v, HALF_L, THICK, [Ax, 0, 0], st);
      DOWEL_Y.forEach((y) => drawDowel(c, v, Ax - 28, Ax + 28, y, 0, 12, st));
      drawPrism(c, v, HALF_R, THICK, [Bx, 0, 0], st);
      const pa = proj(v, [Ax + 290, 0, THICK / 2]), pb = proj(v, [Ax + 140, 0, THICK / 2]);
      if (u < 0.98) arrow(c, [pa[0], pa[1]], [pb[0], pb[1]], clamp((t - aB + 0.6) / 0.3), accent);
      // 喀：接縫兩邊幾條短短的放射線＋小字
      const ck = t >= aClick ? pulse(t, aClick, 0.25) : 0;
      if (ck > 0.02) {
        const pc = proj(v, [Ax, -0.55 * S, THICK / 2]);
        c.save(); c.globalAlpha *= clamp(ck * 1.5);
        c.strokeStyle = accent; c.lineWidth = 3; c.lineCap = 'round';
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + (i - 2) * 0.42;
          c.beginPath(); c.moveTo(pc[0] + Math.cos(a) * 26, pc[1] + Math.sin(a) * 26); c.lineTo(pc[0] + Math.cos(a) * (46 + 10 * ck), pc[1] + Math.sin(a) * (46 + 10 * ck)); c.stroke();
        }
        c.font = font(F.hei(900), 28); c.fillStyle = accent; c.textAlign = 'center';
        c.fillText('喀！', pc[0], pc[1] - 66);
        c.restore();
      }
      // 扳手：插在接縫正面的螺絲上，第三拍起每拍轉 90 度
      if (u >= 1) {
        const k0 = this.act(2, 3);
        let ang = 0;
        for (let k = 0; k < 8; k++) { const a = this.act(2, 3 + k * Math.max(1, this.per / 8)); if (t > a) ang += (Math.PI / 2) * ease.outBack(clamp((t - a) / 0.22)); }
        const bolt: P3 = [Ax, 0.18 * S, THICK / 2];
        const hex = Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * TAU; return proj(v, [bolt[0] + Math.cos(a) * 14, bolt[1] + Math.sin(a) * 14, bolt[2]]); });
        c.fillStyle = mixRgba('paper', 'sepia', 0.3); c.strokeStyle = rgba('sepia', 0.9); c.lineWidth = 2;
        c.beginPath(); hex.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); c.fill(); c.stroke();
        if (t > k0 - 0.3) {
          const L = 150, z1 = bolt[2] + 46;
          drawKey(c, v, [bolt, [bolt[0], bolt[1], z1], [bolt[0] + Math.cos(ang - 0.5) * L, bolt[1] + Math.sin(ang - 0.5) * L, z1]], st);
          // 轉動的弧形箭頭
          const pc = proj(v, [bolt[0], bolt[1], z1]);
          c.save(); c.strokeStyle = accent; c.lineWidth = 2.5; c.setLineDash([8, 6]);
          c.beginPath(); c.ellipse(pc[0], pc[1], 70, 40, 0, -2.4 + ang * 0.3, -0.6 + ang * 0.3); c.stroke();
          c.restore();
        }
      }
      return;
    }
    // 完成：正面填點綴色；每個小節線整顆心快速轉一圈（outCubic）停回正面，每一拍輕輕彈一下；旁邊一個打勾的圓
    const au = this.ctx.audio;
    const t3 = au.timeOfBeat(this.stepBeat[3]!);
    const bars = this.g.bars.filter((b) => b > t3 + 0.2 && b <= t);
    const lastBar = bars.length ? bars[bars.length - 1]! : -1e9;
    const spin = ease.outCubic(clamp((t - lastBar) / 0.6)) * TAU * (bars.length ? 1 : 0);
    const bi = Math.floor(au.beatAt(t) + 1e-6);
    const bounce = 1 + 0.05 * pulse(t, au.timeOfBeat(bi), 0.08);
    const vv: View = { ...v, yaw: -0.35 + (spin % TAU), s: v.s * bounce, ox: ILL.cx + 10 };
    const heartSt: Style = { ...st, cap: rgba('rose', 0.95) };
    // 兩半合起來：依深度決定先畫哪一半
    const dl = proj(vv, [-S * 0.5, 0, 0])[2], dr = proj(vv, [S * 0.5, 0, 0])[2];
    const halves: [number, [number, number][]][] = [[dl, HALF_L], [dr, HALF_R]];
    halves.sort((p, q) => p[0] - q[0]).forEach(([, poly]) => drawPrism(c, vv, poly, THICK, [0, 0, 0], heartSt));
    const ok = ease.outBack(clamp((t - this.act(3, 1)) / 0.3), 2);
    if (ok > 0) {
      c.save();
      c.translate(ILL.cx + 290, ILL.cy - 170); c.scale(ok, ok);
      c.strokeStyle = accent; c.lineWidth = 4; c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath(); c.arc(0, 0, 38, 0, TAU); c.stroke();
      c.beginPath(); c.moveTo(-17, 1); c.lineTo(-4, 14); c.lineTo(19, -12); c.stroke();
      c.restore();
    }
  }

  // ------------------------------------------------------------ 說明文字（歌詞）
  private drawLyric(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    const ly = lyricAt(lyrics, t);
    // v2：說明文字（歌詞）比留言小一級
    const LY: RowsStyle = { family: F.archivo(100, 800), size: lyricV2(this.msgScreen) / this.sCap, minSize: V2.lyrMin / this.sCap, maxW: CAP.w, maxRows: 2, lineHeight: 1.06 };
    if (ly) {
      const lay = layoutRows(c, ly.line, LY);
      // 原文（韓文歌）：同一段說明文字小一號印在中文正下方。字級照螢幕 px 算（說明書上要除以 sCap）；
      // 整組放不進說明欄就往上長（步驟圖的零件標籤底下還有一點空，最多借 60）
      const sub = lyricSubOf(ly.line), sc = this.sCap, ms = lay.size * sc;
      const sst: LyricStyle = { family: LY.family, size: ms, maxWidth: CAP.w * sc, align: 'left', ...paperInk() };
      const sLay = sub ? layoutLyric(c, sub, subStyleFor(sst, ms)) : null;
      const sGap = sLay ? subGap(ms, sLay.size) / sc : 0;
      let top = CAP.y + (CAP.h - lay.height) / 2 + lay.size * 0.84;
      if (sLay) {
        const total = lay.size * 0.84 + (lay.rows.length - 1) * lay.lineHeight + sGap + (sLay.height - sLay.size + sLay.size * 0.25) / sc;
        const y0 = total <= CAP.h ? CAP.y + (CAP.h - total) / 2 : Math.max(CAP.y - 60, CAP.y + CAP.h - 4 - total);
        top = y0 + lay.size * 0.84;
      }
      c.save(); c.translate(CAP.x, top);
      drawRows(c, lay, LY.family, t, paperInk(), ly.k);
      if (sub) {
        c.translate(0, (lay.rows.length - 1) * lay.lineHeight + sGap); c.scale(1 / sc, 1 / sc);
        drawLyricSub(c, sub, t, sst, ms, ly.k);
      }
      c.restore();
      return;
    }
    c.font = font(F.archivo(100, 800), Math.round(V2.lyrMin / this.sCap)); c.fillStyle = rgba('sepia', lyrics.has ? 0.26 : 0.8);
    c.fillText(song.title || '組合式愛心', CAP.x, CAP.y + 92);
    if (!lyrics.has) {
      const w = Math.min(c.measureText(song.title).width, 600);
      c.font = font(F.hei(500), 20); c.fillStyle = rgba('sepia', 0.55);
      c.fillText('（純音樂）', CAP.x + w + 20, CAP.y + 90);
    }
  }

  // ------------------------------------------------------------ 注意事項（留言，焦點）
  private drawNote(c: CanvasRenderingContext2D, t: number) {
    const m = this.msg, g = this.g;
    const t0 = g.b0;
    if (t < t0) return;
    if (m && this.fit) {
      const fit = this.fit;
      const top = NOTE.y + fit.size * 0.9 + 10;
      // 手寫：一行一行由左往右寫出來，整則在一小節內寫完
      const per = Math.min(g.beat * 0.5, 2.4 / fit.lines.length);
      fit.lines.forEach((ln, i) => {
        const a = t0 + i * per, u = prog(t, a, a + per * 0.95, ease.inOutQuad);
        if (u <= 0) return;
        c.save();
        c.beginPath(); c.rect(NOTE.x - 10, top + i * fit.lineHeight - fit.size * 1.05, (NOTE.w + 20) * u, fit.size * 1.45); c.clip();
        drawFit(c, { ...fit, lines: [ln] }, F.hand(700), NOTE.x, top + i * fit.lineHeight, { color: rgba('sepia') });
        c.restore();
      });
      const ts = t0 + fit.lines.length * per + 0.15;
      const ka = prog(t, ts, ts + 0.3);
      if (ka > 0) {
        c.save(); c.globalAlpha = ka;
        // 署名永遠在最後一行下面（字級是扣掉署名的高度算的）：讓出下伸部再放署名
        c.font = font(F.hand(700), this.sigSize); c.fillStyle = rgba('sepia', 0.8); c.textAlign = 'right';
        c.fillText(`${signature(m.name)}${m.couple ? '（新人）' : ''}`, NOTE.x + NOTE.w, top + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.3 + this.sigSize * 1.05);
        c.restore();
      }
      return;
    }
    // 沒有留言：印好的冷面注意事項＋一句邀請
    const u = prog(t, t0, t0 + 0.3);
    c.save(); c.globalAlpha = u;
    // 螢幕上約 52 px 的注意事項三行＋ 30 px 的邀請兩行（欄寬 592，一行最多 9 個字）
    const S = this.sNote, big = Math.min(Math.round(52 / S), Math.floor(NOTE.w / 9.5)), small = Math.round(30 / S);
    c.font = font(F.hand(700), big); c.fillStyle = rgba('sepia', 0.92);
    ['請勿單獨組裝。', '本產品需兩人', '同時操作。'].forEach((ln, i) => c.fillText(ln, NOTE.x, NOTE.y + big * (1 + i * 1.3)));
    c.font = font(F.hand(700), small); c.fillStyle = rgba('sepia', 0.66);
    const y0 = NOTE.y + big * 3.6 + small * 1.6;
    c.fillText('這一格留給你的叮嚀：', NOTE.x, y0);
    c.fillText('掃描右下角 QR code', NOTE.x, y0 + small * 1.4);
    c.restore();
  }
}
