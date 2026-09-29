// 剪紙囍（暗）：暗色的牆上貼著兩張紅紙（訊號色的紙）：左邊一張斗方（菱形），右邊一張長方的窗花。
//  - 第一個拍點起，剪刀沿著窗花中間的「海棠窗」剪一圈（剪到哪、那段切口亮到哪），剪好的紙片翻著掉下去，
//    後面牆上的主打留言就露出來了（留言是寫在牆上的，一開始被紅紙擋住）。
//  - 接著剪斗方上的「囍」：字的每一筆（連在一起的一塊）是一刀，一拍剪一塊（塊多就半拍），剪下來的紙片一片片掉下去；
//    剪完之後的下一個小節線，斗方四邊的一圈小菱形「啪」地一次打穿。刀口在拍點上合起來（喀嚓）。
//  - 燈打在窗花上（留言是唯一的焦點）：斗方在燈的邊緣、暗一些、小一些，是配角；紅紙在牆上有影子。
//  - 畫法：紙在一張 Canvas2D 遮罩上（紙在不在、掉下來的紙片），shader 把它畫成有纖維、有摺痕、切口有厚度的紅紙，
//    並用同一張遮罩算牆上的影子；留言與歌詞在牆與紙之間。剪刀與切口的亮線是 GPU 細線。
//  - 歌詞在下緣的牆上逐字跟唱。沒有留言：窗花裡露出的是一句邀請。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, prog, hash, pulse, TAU } from '../engine/util';
import { type FitResult } from '../engine/text';
import { fillWithHearts } from '../engine/motifs';
import { lyricAt, drawLyric, layoutLyric, beatAfter, signature, type LyricStyle } from './_motifs';
import { subRect, rasterPieces, pieceCanvas, contourAt, fitMsg, type Pieces } from './_t13';

export const spec: PlateSpecDecl = { group: 'type', family: 'craft', paper: false, energy: [0.3, 0.9], bars: [4, 8] };

// ---------------------------------------------------------------- 版面（邏輯像素）
/** 紙的遮罩圖層範圍。 */
const PR = { x: 120, y: 110, w: 1250, h: 740 };
/** 斗方：中心與半對角線；裡面的囍（正方形的字框）。 */
const DC = { x: 420, y: 470 }, DH = 262;
const GS = 284;
/** 窗花（長方的紅紙）與中間的海棠窗。 */
const CT = { x: 790, y: 124, w: 560, h: 690, rot: 0.012 };
const WIN = { x: CT.x + 38, y: CT.y + 42, w: CT.w - 76, h: CT.h - 84, r: 38 };
/** 牆上的歌詞。 */
const LYR = { x: 170, base: 948, w: 1170 };
const LYR_R = { x: 120, y: 800, w: 1260, h: 190 };
const FAM_MSG = F.hand(400);
const INVITE = ['掃描右下角', 'QR code，', '把祝福貼在', '這扇窗上。'];

/** 牆：暖黑、左上一盞燈；紙的影子（遮罩往右下挪、糊一點）與穿過剪空處的光。 */
const WALL_FRAG = /* glsl */ `
uniform sampler2D uP; uniform vec4 uPR; uniform float uIn;
float paperAt(vec2 p) {
  vec2 uv = vec2((p.x - uPR.x) / uPR.z, 1.0 - (p.y - uPR.y) / uPR.w);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  return texture(uP, uv).a;
}
void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  vec3 col = C_INK * (0.85 + 0.2 * fbm(p / 380.0, 3)) + C_INK2 * 0.4;
  // 燈：打在窗花上（留言在這裡），往外暗下去
  float lamp = 1.0 - smoothstep(0.0, 1250.0, length((p - vec2(${(CT.x + CT.w / 2).toFixed(1)}, ${(CT.y + CT.h * 0.42).toFixed(1)})) * vec2(0.8, 1.0)));
  col += (C_INK2 * 1.7 + C_BLOOD * 0.05) * lamp * lamp;
  // 牆面的細紋（像粉刷過的灰泥）
  col *= 0.96 + 0.05 * snoise(p * 0.08) * snoise(p * 0.013 + 2.0);
  // 紙的影子：遮罩往右下 (22, 30) 挪、八個點平均（糊）
  float sh = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    sh += paperAt(p - vec2(22.0, 30.0) + vec2(cos(a), sin(a)) * 7.0);
  }
  sh /= 8.0;
  col *= 1.0 - 0.62 * sh * uIn;
  fragColor = vec4(col, 1.0);
}`;

/** 紅紙：遮罩的 alpha 是紙，顏色是訊號色的紙（不發光），纖維、斗方中間的摺痕、切口的厚度（左上亮、右下暗）。 */
const PAPER_FRAG = /* glsl */ `
uniform sampler2D uP; uniform vec4 uPR; uniform float uIn; uniform float uKick;
float paperAt(vec2 p) {
  vec2 uv = vec2((p.x - uPR.x) / uPR.z, 1.0 - (p.y - uPR.y) / uPR.w);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  return texture(uP, uv).a;
}
void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  float a = paperAt(p);
  if (a <= 0.003) discard;
  // 切口的厚度：往左上看是空的就亮一點（紙邊受光），往右下看是空的就暗一點
  float tl = paperAt(p + vec2(-1.8, -1.8)), br = paperAt(p + vec2(1.8, 1.8));
  float edgeL = sat(a - tl), edgeD = sat(a - br);
  vec3 base = C_SIGNAL * 0.62 + C_BLOOD * 0.2;
  float fib = snoise(p * vec2(0.9, 0.06)) * 0.5 + snoise(p * 0.35 + 7.0) * 0.3;
  vec3 col = base * (0.88 + 0.08 * fib + 0.05 * fbm(p / 260.0, 3));
  // 燈在左上：紙面整體左上亮、右下暗一點；大鼓時燈閃一下
  // 燈打在窗花上：窗花亮、斗方在燈的邊緣暗一些（配角）；大鼓時燈閃一下
  float lampK = 1.0 - smoothstep(180.0, 820.0, length(p - vec2(${(CT.x + CT.w / 2).toFixed(1)}, ${(CT.y + CT.h * 0.42).toFixed(1)})));
  col *= 0.5 + 0.55 * lampK + 0.05 * uKick;
  // 燈照不到的地方也比較灰（斗方退成配角）
  col = mix(vec3(luma(col)), col, 0.55 + 0.45 * lampK);
  // 斗方對摺過（剪紙是對摺剪的）：中間一條直的摺痕
  float crease = pxLine(abs(p.x - ${DC.x}.0), 0.4, 1.6) * step(abs(p.y - ${DC.y}.0) + abs(p.x - ${DC.x}.0), ${DH}.0);
  col *= 1.0 - 0.1 * crease;
  col += C_EMBER * 0.18 * edgeL;
  col *= 1.0 - 0.35 * edgeD;
  fragColor = vec4(col * a * uIn, a * uIn);
}`;

const WALL = () => new FSPass(WALL_FRAG, { uP: { value: null }, uPR: { value: new THREE.Vector4(PR.x, PR.y, PR.w, PR.h) }, uIn: { value: 1 } });
const PAPER = () => {
  const p = new FSPass(PAPER_FRAG, { uP: { value: null }, uPR: { value: new THREE.Vector4(PR.x, PR.y, PR.w, PR.h) }, uIn: { value: 1 }, uKick: { value: 0 } }, { blending: THREE.CustomBlending, transparent: true });
  // 預乘的「蓋上去」
  const m = p.mat;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  return p;
};

/** 一塊要剪下來的紙：輪廓（剪刀的路線）、它在遮罩上的圖、剪的時間、掉下去的樣子。 */
interface Cut { pts: { x: number; y: number }[]; cv: HTMLCanvasElement; x: number; y: number; w: number; h: number; t0: number; t1: number; spin: number; drift: number; big: boolean }

export default class Xi extends Scene {
  wall = shared('xi.wall', WALL);
  paperPass = shared('xi.paper', PAPER);
  /** 紙的遮罩（每格重畫：掉下來的紙片一直在動）。 */
  mask = this.track(new Layer2D(PR.w, PR.h, undefined, { fast: true }));
  /** 牆上的留言（寫完就不變）。 */
  txt = this.track(new Layer2D(WIN.w + 40, WIN.h + 40, undefined, { fast: true }));
  lyr = this.track(new Layer2D(LYR_R.w, LYR_R.h, undefined, { fast: true }));
  glow = this.track(new LineBatch(1600, { screen2D: true, blend: 'add' }));
  tool = this.track(new LineBatch(600, { screen2D: true, blend: 'normal' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  sheet: HTMLCanvasElement | null = null;
  cuts: Cut[] = [];
  /** 斗方邊上的一圈小菱形：一起打穿的時間。 */
  punchT = Infinity;
  punches: { x: number; y: number; s: number }[] = [];
  fit: FitResult | null = null;
  sigSize = 42;
  glyphFull: HTMLCanvasElement | null = null;
  glyphDone = Infinity;
  /** 紙＋已經剪好的洞（掉下去的紙片不在這裡）。 */
  holes: HTMLCanvasElement | null = null;
  holeKey = '';
  txtDone = false;

  override async init() {
    const { audio: au, start, end } = this.ctx;
    const m = this.msg;
    await loadText(`囍${INVITE.join('')}${m ? m.text + signature(m.name) : ''}剪紙`);
    this.sheet = this.buildSheet();
    const t0 = beatAfter(au, start + 0.05);
    const b0 = au.beatAt(t0);
    const beat = au.beatPeriod(t0);
    // ---- 1. 海棠窗：一拍半剪一圈
    const win = this.windowCut();
    win.t0 = t0; win.t1 = au.timeOfBeat(b0 + 1.5);
    this.cuts.push(win);
    // ---- 2. 囍：每一塊一刀，拍點上開剪
    const P = rasterPieces(GS, GS, (c) => {
      c.font = font(F.ming(900), GS * 0.98);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('囍', GS / 2, GS / 2 + GS * 0.04);
      // 粗的囍整個字連成一塊：用幾條 1 px 的細縫切成上下幾段、左右兩個喜，一段一刀
      // （掉下去的洞會多挖 1 px，細縫不會留在紙上）
      for (const y of [0.25, 0.42, 0.58, 0.76]) c.clearRect(0, GS * y, GS, 1);
      c.clearRect(GS * 0.5, 0, 1, GS);
    }, 40, 3);
    const pcs = this.glyphCuts(P);
    // 整個字（沒切縫）：最後一刀剪完時一起挖掉，切縫與太小沒算成一塊的碎屑都不會留在紙上
    const gf = document.createElement('canvas');
    gf.width = gf.height = GS;
    const gc = gf.getContext('2d')!;
    gc.fillStyle = '#fff';
    gc.font = font(F.ming(900), GS * 0.98);
    gc.textAlign = 'center';
    gc.textBaseline = 'middle';
    gc.fillText('囍', GS / 2, GS / 2 + GS * 0.04);
    this.glyphFull = gf;
    // 剪囍用掉窗格的大半（至少十二拍，窗格短就擠一點），一塊佔幾拍取 2、1、½、¼ 拍裡最接近的
    const avail = Math.max(2, Math.floor(au.beatAt(end - 0.1) - b0) - 3.5);
    const span = Math.min(avail, Math.max(12, avail * 0.7));
    const per = [2, 1, 0.5, 0.25].find((q) => q * pcs.length <= span) ?? 0.25;
    pcs.forEach((c, i) => {
      c.t0 = au.timeOfBeat(b0 + 2 + i * per);
      c.t1 = c.t0 + Math.min(beat * per * 0.85, 0.2 + 0.0012 * c.pts.length * 3);
      this.cuts.push(c);
    });
    // ---- 3. 剪完的下一個小節線：一圈小菱形一次打穿
    const last = this.cuts[this.cuts.length - 1]!.t1;
    this.glyphDone = last;
    this.punchT = Math.min(au.timeOfBar(Math.ceil(au.barAt(last + 0.05))), end - 0.4);
    for (let e = 0; e < 4; e++) for (let k = 1; k < 10; k++) {
      const u = k / 10;
      const A = [[DC.x, DC.y - DH + 34], [DC.x + DH - 34, DC.y], [DC.x, DC.y + DH - 34], [DC.x - DH + 34, DC.y]][e]!, B = [[DC.x + DH - 34, DC.y], [DC.x, DC.y + DH - 34], [DC.x - DH + 34, DC.y], [DC.x, DC.y - DH + 34]][e]!;
      this.punches.push({ x: A[0]! + (B[0]! - A[0]!) * u, y: A[1]! + (B[1]! - A[1]!) * u, s: 7 + (k % 2) * 3 });
    }
    // 窗花的框上也打一圈小圓孔（跟斗方同一下）
    const fx0 = CT.x + 20, fy0 = CT.y + 22, fx1 = CT.x + CT.w - 20, fy1 = CT.y + CT.h - 22;
    for (let i = 1; i < 12; i++) { const u = i / 12; this.punches.push({ x: fx0 + (fx1 - fx0) * u, y: fy0, s: -5 }, { x: fx0 + (fx1 - fx0) * u, y: fy1, s: -5 }); }
    for (let i = 1; i < 16; i++) { const u = i / 16; this.punches.push({ x: fx0, y: fy0 + (fy1 - fy0) * u, s: -5 }, { x: fx1, y: fy0 + (fy1 - fy0) * u, s: -5 }); }
    // 窗花整張轉了一點點：框上的孔跟著轉
    const ccx = CT.x + CT.w / 2, ccy = CT.y + CT.h / 2, cs = Math.cos(CT.rot), sn = Math.sin(CT.rot);
    for (const pu of this.punches) if (pu.s < 0) { const dx = pu.x - ccx, dy = pu.y - ccy; pu.x = ccx + dx * cs - dy * sn; pu.y = ccy + dx * sn + dy * cs; }
    // ---- 牆上的留言
    const c = this.txt.ctx;
    if (m) {
      // 八個字以內排成一行（窗是直的，兩行會從詞中間折斷：「新婚快／樂！！！」）
      const short = Array.from(m.text).length <= 8;
      this.fit = fitMsg(c, m.text, FAM_MSG, WIN.w - 60, WIN.h - 120, { min: 46, max: 112, lineHeight: 1.34, maxLines: short ? 1 : 9 });
      this.sigSize = Math.round(clamp(this.fit.size * 0.5, 40, 50));
    }
  }

  /** 兩張紅紙（白色 = 有紙）：斗方與窗花，窗花稍微歪一點。 */
  private buildSheet() {
    const cv = document.createElement('canvas');
    cv.width = PR.w; cv.height = PR.h;
    const c = cv.getContext('2d')!;
    c.translate(-PR.x, -PR.y);
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(DC.x, DC.y - DH); c.lineTo(DC.x + DH, DC.y); c.lineTo(DC.x, DC.y + DH); c.lineTo(DC.x - DH, DC.y);
    c.closePath(); c.fill();
    c.save();
    c.translate(CT.x + CT.w / 2, CT.y + CT.h / 2); c.rotate(CT.rot); c.translate(-(CT.x + CT.w / 2), -(CT.y + CT.h / 2));
    c.fillRect(CT.x, CT.y, CT.w, CT.h);
    c.restore();
    return cv;
  }

  /** 重做「紙＋洞」：前 nCut 刀的紙片挖掉（四個方向各偏 1 px，把切塊之間的細縫一起挖掉）、整個囍、前 nPunch 個小孔。 */
  private buildHoles(nCut: number, glyphDone: boolean, nPunch: number) {
    if (!this.holes) { this.holes = document.createElement('canvas'); this.holes.width = PR.w; this.holes.height = PR.h; }
    const c = this.holes.getContext('2d')!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, PR.w, PR.h);
    if (this.sheet) c.drawImage(this.sheet, 0, 0);
    c.translate(-PR.x, -PR.y);
    c.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < nCut; i++) {
      const k = this.cuts[i]!;
      for (const [ox, oy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) c.drawImage(k.cv, k.x + ox!, k.y + oy!, k.w, k.h);
    }
    if (glyphDone && this.glyphFull) c.drawImage(this.glyphFull, DC.x - GS / 2, DC.y - GS / 2, GS, GS);
    c.fillStyle = '#fff';
    for (let i = 0; i < nPunch; i++) {
      const pu = this.punches[i]!;
      c.beginPath();
      // s < 0：小圓孔；s > 0：小菱形
      if (pu.s < 0) c.arc(pu.x, pu.y, -pu.s, 0, TAU);
      else { c.moveTo(pu.x, pu.y - pu.s); c.lineTo(pu.x + pu.s * 0.7, pu.y); c.lineTo(pu.x, pu.y + pu.s); c.lineTo(pu.x - pu.s * 0.7, pu.y); c.closePath(); }
      c.fill();
    }
    c.globalCompositeOperation = 'source-over';
  }

  /** 窗花中間的海棠窗（四個角往內凹的長方形）：輪廓點與它的紙片。 */
  private windowCut(): Cut {
    const { x, y, w, h, r } = WIN;
    const pts: { x: number; y: number }[] = [];
    const arc = (cx: number, cy: number, a0: number, a1: number) => { for (let i = 0; i <= 10; i++) { const a = a0 + ((a1 - a0) * i) / 10; pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); } };
    const line = (x0: number, y0: number, x1: number, y1: number) => { for (let i = 0; i <= 16; i++) pts.push({ x: x0 + ((x1 - x0) * i) / 16, y: y0 + ((y1 - y0) * i) / 16 }); };
    line(x + r, y, x + w - r, y); arc(x + w, y, Math.PI, Math.PI / 2);
    line(x + w, y + r, x + w, y + h - r); arc(x + w, y + h, -Math.PI / 2, -Math.PI);
    line(x + w - r, y + h, x + r, y + h); arc(x, y + h, 0, -Math.PI / 2);
    line(x, y + h - r, x, y + r); arc(x, y, Math.PI / 2, 0);
    // 窗花整張轉了一點點：輪廓跟著轉
    const cx = CT.x + CT.w / 2, cy = CT.y + CT.h / 2, cs = Math.cos(CT.rot), sn = Math.sin(CT.rot);
    const rp = pts.map((p) => ({ x: cx + (p.x - cx) * cs - (p.y - cy) * sn, y: cy + (p.x - cx) * sn + (p.y - cy) * cs }));
    const bx = Math.min(...rp.map((p) => p.x)) - 4, by = Math.min(...rp.map((p) => p.y)) - 4;
    const bw = Math.max(...rp.map((p) => p.x)) - bx + 8, bh = Math.max(...rp.map((p) => p.y)) - by + 8;
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(bw); cv.height = Math.ceil(bh);
    const c = cv.getContext('2d')!;
    c.fillStyle = '#fff';
    c.beginPath();
    rp.forEach((p, i) => (i ? c.lineTo(p.x - bx, p.y - by) : c.moveTo(p.x - bx, p.y - by)));
    c.closePath(); c.fill();
    return { pts: rp, cv, x: bx, y: by, w: bw, h: bh, t0: 0, t1: 0, spin: 0.9, drift: -40, big: true };
  }

  /** 囍的每一塊：由上而下、左右兩個喜交錯剪（對摺剪的，兩邊同時出現也說得通，但一塊一塊看得比較清楚）。 */
  private glyphCuts(P: Pieces): Cut[] {
    const gx = DC.x - GS / 2, gy = DC.y - GS / 2;
    const order = P.pieces.slice().sort((a, b) => (a.cy - b.cy) || (a.cx - b.cx));
    return order.map((pc, i) => {
      const { cv, x, y } = pieceCanvas(P, pc, 2);
      return {
        pts: pc.contour.map((p) => ({ x: gx + p.x, y: gy + p.y })), cv, x: gx + x, y: gy + y, w: cv.width, h: cv.height,
        t0: 0, t1: 0, spin: (hash(i, 3) - 0.5) * 7, drift: (hash(i, 4) - 0.5) * 160, big: false,
      };
    });
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const vis = prog(t, s, s + 0.3) * (1 - prog(t, e - 0.25, e));
    // ---- 紙的遮罩：整張 → 挖掉剪好的洞（洞的樣子只有剪好一刀、打孔時才變：存起來，變了才重做）→ 畫還在掉的紙片
    const nCut = this.cuts.filter((k) => t >= k.t1).length;
    const nPunch = t >= this.punchT ? Math.min(this.punches.length, Math.floor((t - this.punchT) / 0.006) + 1) : 0;
    const holeKey = `${nCut}|${t >= this.glyphDone}|${nPunch}`;
    if (holeKey !== this.holeKey) { this.holeKey = holeKey; this.buildHoles(nCut, t >= this.glyphDone, nPunch); }
    const Mk = this.mask, c = Mk.ctx;
    Mk.clear();
    c.save();
    if (this.holes) c.drawImage(this.holes, 0, 0, PR.w, PR.h);
    c.translate(-PR.x, -PR.y);
    // 掉下去的紙片：翻著（x 方向縮放 = 在翻面）、轉著、往下加速
    for (const k of this.cuts) {
      const age = t - k.t1;
      if (age < 0 || age > 1.6) continue;
      const g = k.big ? 1500 : 2100;
      const cx = k.x + k.w / 2 + k.drift * age, cy = k.y + k.h / 2 + 0.5 * g * age * age - (k.big ? 30 : 60) * age;
      if (cy - k.h > PR.y + PR.h + 200) continue;
      c.save();
      c.translate(cx, cy);
      c.rotate(k.spin * age);
      c.scale(Math.cos(age * (k.big ? 3.2 : 7) + 0.001), 1);
      c.drawImage(k.cv, -k.w / 2, -k.h / 2, k.w, k.h);
      c.restore();
    }
    c.restore();
    Mk.upload();

    // ---- 牆（含影子）→ 牆上的字 → 紅紙
    this.wall.u.uP!.value = Mk.texture;
    // 紙與牆不淡入淡出（窗格本來就是硬切）：紙半透明時，後面還沒剪開的留言會透出來
    this.wall.u.uIn!.value = 1;
    this.wall.render(renderer, out);
    this.drawMsg();
    comp.draw(renderer, this.txt.texture, out, { ...subRect({ x: WIN.x - 20, y: WIN.y - 20, w: WIN.w + 40, h: WIN.h + 40 }), opacity: vis });
    this.drawLyr(t, vis, lyricAt(lyrics, t));
    comp.draw(renderer, this.lyr.upload(), out, subRect(LYR_R));
    // 紙的 shader 讀的是 fast 圖層的 alpha（alpha 不經過 sRGB 編碼，直接用）
    this.paperPass.u.uP!.value = Mk.texture;
    this.paperPass.u.uIn!.value = 1;
    this.paperPass.u.uKick!.value = f.a.kick;
    this.paperPass.render(renderer, out);

    // ---- 剪刀與切口
    this.glow.clear(); this.tool.clear();
    this.drawCuts(t, f, vis);
    if (this.glow.count) this.glow.render(renderer, out);
    if (this.tool.count) this.tool.render(renderer, out);

    const punch = pulse(t, this.punchT, 0.08);
    return {
      bloom: 0.7, vignette: 0.45, halation: 0.2,
      zoom: 1 + 0.015 * f.p + 0.004 * f.a.kick + 0.006 * punch,
      shake: [punch * 3, punch * 2],
      popupAvoid: [[WIN.x - 20, WIN.y - 20, WIN.w + 40, WIN.h + 40], [LYR.x - 20, LYR.base - 100, LYR.w + 40, 130]],
    };
  }

  override dispose() {
    // 一晚會建幾百次：畫布的記憶體馬上還掉，不等 GC
    for (const cv of [this.sheet, this.holes, this.glyphFull, ...this.cuts.map((k) => k.cv)]) if (cv) cv.width = cv.height = 0;
    super.dispose();
  }

  /** 正在剪的那一刀：剪過的輪廓亮起來（訊號色、會發光），剪刀停在刀口、拍點上合起來。 */
  private drawCuts(t: number, f: Frame, vis: number) {
    const k = this.cuts.find((c) => t >= c.t0 && t < c.t1);
    if (!k) {
      // 兩刀之間：剪刀停在剛剪完的地方（剪完最後一刀就收走）
      const prev = [...this.cuts].reverse().find((c) => c.t1 <= t);
      const next = this.cuts.find((c) => c.t0 > t);
      if (prev && next) {
        const a = prev.pts[prev.pts.length - 1]!, b = next.pts[0]!;
        const u = ease.inOutCubic(clamp((t - prev.t1) / Math.max(0.05, next.t0 - prev.t1)));
        this.scissors(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, -0.9, f, vis);
      } else if (!prev && next) {
        const b = next.pts[0]!, u = ease.outExpo(prog(t, this.ctx.start, next.t0));
        this.scissors(b.x + 260 * (1 - u), b.y + 180 * (1 - u), -0.9, f, vis);
      }
      return;
    }
    const u = ease.inOutQuad(clamp((t - k.t0) / (k.t1 - k.t0)));
    const n = Math.max(2, Math.floor(u * (k.pts.length - 1)));
    const sg = LIN.signal, em = LIN.ember;
    for (let i = 1; i <= n; i++) {
      const a = k.pts[i - 1]!, b = k.pts[i]!;
      const heat = Math.pow(i / n, 3);
      const I = (0.6 + 2.4 * heat) * vis;
      this.glow.seg2(a.x, a.y, b.x, b.y, 1.4 + heat * 1.2, [(sg[0] + (em[0] - sg[0]) * heat) * I, (sg[1] + (em[1] - sg[1]) * heat) * I, (sg[2] + (em[2] - sg[2]) * heat) * I], 1);
    }
    const p = contourAt(k.pts, u);
    this.scissors(p.x, p.y, p.a, f, vis);
  }

  /** 剪刀（鋼色細線）：刀尖在 (x, y)、沿著 ang 的方向剪；刀口開合跟著拍子，拍點上合起來。 */
  private scissors(x: number, y: number, ang: number, f: Frame, vis: number) {
    const L = this.tool;
    const open = 0.08 + 0.34 * clamp(f.beatPhase * 1.6) * (1 - clamp((f.beatPhase - 0.85) * 6.6));
    const steel: [number, number, number] = [LIN.bone[0] * 0.78, LIN.bone[1] * 0.78, LIN.bone[2] * 0.78];
    const dark = LIN.ash;
    const pv = { x: x - Math.cos(ang) * 78, y: y - Math.sin(ang) * 78 };
    for (const sgn of [1, -1]) {
      const a = ang + sgn * open / 2;
      const tip = { x: pv.x + Math.cos(a) * 82, y: pv.y + Math.sin(a) * 82 };
      // 刀身：粗到細
      for (let i = 0; i < 4; i++) {
        const u0 = i / 4, u1 = (i + 1) / 4;
        L.seg2(pv.x + (tip.x - pv.x) * u0, pv.y + (tip.y - pv.y) * u0, pv.x + (tip.x - pv.x) * u1, pv.y + (tip.y - pv.y) * u1, 7 - i * 1.5, steel, 0.95 * vis);
      }
      // 把手：往後斜出去，接一個圈
      const hb = a + Math.PI + sgn * 0.32;
      const hx = pv.x + Math.cos(hb) * 56, hy = pv.y + Math.sin(hb) * 56;
      L.seg2(pv.x, pv.y, hx, hy, 5, dark, 0.95 * vis);
      const rc = { x: hx + Math.cos(hb) * 17, y: hy + Math.sin(hb) * 17 };
      for (let i = 0; i < 16; i++) {
        const a0 = (i / 16) * TAU, a1 = ((i + 1) / 16) * TAU;
        L.seg2(rc.x + 17 * Math.cos(a0), rc.y + 17 * Math.sin(a0), rc.x + 17 * Math.cos(a1), rc.y + 17 * Math.sin(a1), 4, dark, 0.95 * vis);
      }
    }
    L.seg2(pv.x, pv.y, pv.x + 0.01, pv.y, 9, LIN.graphite, vis);
  }

  /** 牆上的留言（在窗花後面，窗剪開才看得到）：一開始就寫好了，只畫一次。 */
  private drawMsg() {
    if (this.txtDone) return;
    this.txtDone = true;
    const L = this.txt, c = L.ctx;
    L.clear();
    c.save();
    c.translate(-(WIN.x - 20), -(WIN.y - 20));
    const cx = CT.x + CT.w / 2, cy = CT.y + CT.h / 2;
    c.translate(cx, cy); c.rotate(CT.rot); c.translate(-cx, -cy);
    const m = this.msg, fit = this.fit;
    c.textBaseline = 'alphabetic';
    if (m && fit) {
      const blockH = fit.height + this.sigSize * 1.9;
      const top = WIN.y + (WIN.h - blockH) / 2 + fit.size * 0.9;
      c.font = font(FAM_MSG, fit.size);
      c.fillStyle = rgba('bone', 0.95);
      fit.lines.forEach((ln, i) => { const w = c.measureText(ln).width; fillWithHearts(c, ln, cx - w / 2, top + i * fit.lineHeight); });
      c.font = font(FAM_MSG, this.sigSize);
      c.fillStyle = rgba('ash');
      const sig = signature(m.name), sw = c.measureText(sig).width;
      c.fillText(sig, cx + Math.min(fit.width / 2, WIN.w / 2 - 40) - sw, top + (fit.lines.length - 1) * fit.lineHeight + this.sigSize * 1.8);
    } else {
      c.font = font(FAM_MSG, 56);
      c.fillStyle = rgba('bone', 0.9);
      INVITE.forEach((ln, i) => { const w = c.measureText(ln).width; c.fillText(ln, cx - w / 2, cy - 110 + i * 78); });
    }
    c.restore();
    L.upload();
  }

  private drawLyr(t: number, vis: number, ly: ReturnType<typeof lyricAt>) {
    const L = this.lyr, c = L.ctx;
    L.clear();
    c.save();
    c.translate(-LYR_R.x, -LYR_R.y);
    c.globalAlpha = vis;
    if (ly) {
      const size = this.fit ? Math.round(clamp(this.fit.size * 0.8, 48, 60)) : 64;
      const st: LyricStyle = { family: F.archivo(87.5, 800), size, minSize: 48, maxWidth: LYR.w };
      const lay = layoutLyric(c, ly.line, st);
      const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.2));
      c.save();
      c.translate(LYR.x, LYR.base - (lay.height - lay.size) + (1 - inK) * 18);
      drawLyric(c, ly.line, t, st, lay, ly.k * vis);
      c.restore();
    } else {
      const { song } = this.ctx;
      c.font = font(F.mono(500), 15);
      c.letterSpacing = '4px';
      c.fillStyle = rgba('ash', 0.55);
      c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`.toUpperCase(), LYR.x, LYR.base - 20);
      c.letterSpacing = '0px';
    }
    c.restore();
  }
}
