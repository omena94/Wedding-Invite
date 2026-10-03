// 旋轉木馬（暗）：夜裡的遊樂園，一座旋轉木馬（沒有人）從正面看：上面是條紋的頂篷與一圈垂下來的花邊，中間是一圈木馬繞著
// 鏡子柱子轉，下面是平台的圍裙板。整座被自己的燈泡照亮，木馬是逆光的剪影（上緣一道暖光）。
//  - 木馬跟著節拍上下：相鄰的木馬一上一下，在拍點到頂（強烈的緩動，停一下再往下）；整座一小節轉過一匹馬的距離（跟歌的速度走）。
//    頂篷花邊上的燈泡一拍走一格（跑馬燈），大鼓時整圈亮一下。
//  - 畫面的焦點＝主打留言：寫在平台正面的圍裙板上（旋轉木馬的名牌：深色漆板、描金的框），第一拍起一個字一個字「亮」起來
//    （剛亮是訊號色、冷卻成紙白），署名在最後一行下面。
//  - 歌詞（比留言小一級）寫在頂篷的花邊上，逐字跟唱。沒有留言：歌詞寫在圍裙板上（主角），花邊上是新人的名字；
//    純音樂：花邊上是小小的歌名。每個小節線有一道光浪從正前方往兩邊跑過所有燈泡（窗格裡每小節一個小事件）。
//    名牌的框只比字多一點邊距（v2），右下角（QR）讓平台沒入暗處。
//  - 鏡頭：切進來時稍微從下面往上搖（看得到頂篷），第一拍落定；之後很慢地推近。
// 手法：Canvas2D 插畫。不會動的（夜空、遠處的燈、鏡子柱子、圍裙板）在 init() 畫成圖；每格只畫會動的
// （轉動的頂篷條紋與花邊、繞圈的木馬與銅柱、燈泡、字），燈泡的光另外畫在一張半解析度的圖層上加亮疊上去（會發光）。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, TAU } from '../engine/util';
import { lyricAt, beatAfter, drawHeart, COUPLE_ZH, fitPx, lyricSubOf, layoutLyric, subStyleFor, subGap, drawLyricSub, type LyricStyle } from './_motifs';
import { layoutRows, drawRows, darkInk } from './_t4';
import { T23_INVITE, T23_TEXT, sigOf, layMsgV2, stagger, type MsgLay, type Rect } from './_t23';
import { V2, lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'instrument', paper: false, energy: [0.2, 0.9], bars: [4, 8] };

// ---------------------------------------------------------------- 幾何（畫面座標，y 向下）
const CX = 960;
/** 平台（橢圓）：中心 y、橫半徑、縱半徑（鏡頭稍微在上面）。 */
const PL = { y: 612, rx: 900, ry: 58 };
/** 頂篷的花邊：上緣、下緣（中間），兩邊往下垂多少（鏡頭在它下面）。 */
const RIM = { top: 112, bot: 222, droop: 34, rx: 940 };
/** 鏡子柱子的半寬。 */
const COL = 190;
/** 圍裙板：平台正面下面那一圈。 */
const SKIRT = { top: 676, bot: 1000 };
/** 留言的範圍（圍裙板上，避開右下角 QR）。 */
/** 名牌（v2：寫留言的那塊 ≤ 860×430）：圍裙板正中偏左一點，右邊留給 QR。 */
const MSG_BOX = { x: 530, y: 712, w: 760, h: 250 };
/** 名牌的中線（避開右下角 QR，比畫面中線偏左）。 */
const MX = MSG_BOX.x + MSG_BOX.w / 2;
const FAM_MSG = F.hand(700);
const FAM_LYR = F.archivo(100, 700);
const NOUT = 8;

/** 木馬精靈圖的大小與鞍座（銅柱穿過的點）在圖上的位置（畫面 px；實際畫布是兩倍解析度）。 */
const SPR = { w: 340, h: 250, ox: 180, oy: 128, k: 2 };

/**
 * 木馬（面向右，跳躍的姿勢：前腳收、後腳往後伸、頭抬高、尾巴往後飄）：用身體、胸、臀、脖子、頭、腿、尾巴幾塊拼起來，
 * 先整隻塗成「逆光的暖色」，再把整隻往左下錯開一點、用暗色蓋回去（只蓋在馬身上），留下上緣與背後一道光；最後加鞍、韁繩。
 * init() 畫一次，之後每格縮放、翻面、壓扁（側面轉到正面）貼上去。
 */
function horseSprite(rim: string, body: string, saddle: string, blanket: string): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = SPR.w * SPR.k; cv.height = SPR.h * SPR.k;
  const c = cv.getContext('2d')!;
  c.setTransform(SPR.k, 0, 0, SPR.k, SPR.ox * SPR.k, SPR.oy * SPR.k);
  const shape = (fill: string) => {
    c.fillStyle = fill; c.strokeStyle = fill; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.ellipse(0, 0, 76, 31, -0.04, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(50, 4, 30, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(-52, -3, 33, 0, Math.PI * 2); c.fill();
    // 脖子（往前上方彎）
    c.beginPath(); c.moveTo(28, -20); c.quadraticCurveTo(46, -62, 62, -90); c.lineTo(90, -86); c.quadraticCurveTo(84, -40, 76, 4); c.lineTo(46, 26); c.closePath(); c.fill();
    // 頭：額頭、鼻樑、口鼻、下巴
    c.beginPath(); c.moveTo(60, -88); c.quadraticCurveTo(78, -108, 100, -99); c.quadraticCurveTo(122, -84, 138, -58);
    c.quadraticCurveTo(143, -46, 133, -41); c.quadraticCurveTo(117, -40, 104, -52); c.quadraticCurveTo(94, -58, 84, -58); c.closePath(); c.fill();
    // 耳朵
    c.beginPath(); c.moveTo(74, -98); c.lineTo(80, -121); c.lineTo(89, -100); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(66, -95); c.lineTo(68, -116); c.lineTo(77, -98); c.closePath(); c.fill();
    // 腿：前腳收起來（膝蓋往前、小腿往下），後腳往後伸
    const leg = (pts: number[][], w: number[]) => {
      for (let i = 1; i < pts.length; i++) { c.lineWidth = w[i - 1]!; c.beginPath(); c.moveTo(pts[i - 1]![0]!, pts[i - 1]![1]!); c.lineTo(pts[i]![0]!, pts[i]![1]!); c.stroke(); }
    };
    leg([[52, 18], [84, 32], [82, 60], [88, 66]], [17, 11, 11]);
    leg([[38, 22], [60, 46], [50, 70], [54, 76]], [16, 10, 10]);
    leg([[-60, 10], [-86, 40], [-118, 54], [-130, 57]], [22, 12, 10]);
    leg([[-44, 16], [-60, 46], [-80, 70], [-88, 74]], [19, 11, 10]);
    // 尾巴（往後飄）
    c.beginPath(); c.moveTo(-96, -22); c.quadraticCurveTo(-142, -36, -160, 4); c.quadraticCurveTo(-163, 28, -148, 40);
    c.quadraticCurveTo(-152, 12, -130, -2); c.quadraticCurveTo(-114, -8, -98, -4); c.closePath(); c.fill();
    // 鬃毛：沿著脖子上緣一撮撮往後飄
    for (let k = 0; k < 6; k++) {
      const x = 66 - k * 7, y = -90 + k * 12;
      c.beginPath(); c.moveTo(x + 6, y - 4); c.quadraticCurveTo(x - 16, y - 6, x - 26, y + 12); c.lineTo(x, y + 6); c.closePath(); c.fill();
    }
  };
  // 1) 整隻塗逆光色 2) 往左下錯開、用暗色蓋在馬身上（source-atop），上緣與背後留一道光
  shape(rim);
  c.globalCompositeOperation = 'source-atop';
  c.save(); c.translate(-3, 4); shape(body); c.restore();
  // 鞍墊、鞍（描金）、韁繩、眼睛
  c.fillStyle = blanket;
  c.beginPath(); c.moveTo(-34, -26); c.quadraticCurveTo(-30, 18, -6, 22); c.quadraticCurveTo(18, 18, 22, -26); c.closePath(); c.fill();
  c.fillStyle = saddle;
  c.beginPath(); c.ellipse(-6, -30, 30, 8, 0, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.moveTo(-34, -34); c.quadraticCurveTo(-38, -46, -30, -46); c.lineTo(-26, -34); c.fill();
  c.strokeStyle = saddle; c.lineWidth = 2.4; c.lineCap = 'round';
  c.beginPath(); c.moveTo(126, -48); c.quadraticCurveTo(96, -62, 78, -84); c.stroke();
  c.beginPath(); c.moveTo(118, -44); c.quadraticCurveTo(70, -40, 22, -30); c.stroke();
  c.fillStyle = saddle; c.beginPath(); c.arc(100, -84, 2.6, 0, Math.PI * 2); c.fill();
  c.globalCompositeOperation = 'source-over';
  return cv;
}

interface Horse { ring: number; a0: number; ph: number; s: number }

export default class Carousel extends Scene {
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  dyn = this.track(new Layer2D(W, H, undefined, { fast: true }));
  hot = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 131 + (this.msg?.id ?? 0) * 37) >>> 0;
  horseCv: HTMLCanvasElement | null = null;
  col: HTMLCanvasElement = document.createElement('canvas');
  skirt: HTMLCanvasElement = document.createElement('canvas');
  horses: Horse[] = [];
  lay: MsgLay | null = null;
  gT: number[] = [];
  sigT = Infinity;
  tOn = 0;
  hasLyr = false;
  lyrSize = 54;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const lines = lyrics.linesIn(s - 1, e + 1);
    this.hasLyr = lines.length > 0;
    const sig = m ? sigOf(m) : '';
    await loadText(`${T23_TEXT}${m?.text ?? ''}${sig}${song.title}${lines.map((l) => l.text).join('')}`);
    const beat = au.beatPeriod(s);
    this.tOn = beatAfter(au, s + Math.min(0.15, beat * 0.3));
    const bar = au.timeOfBar(au.barAt(this.tOn) + 1) - this.tOn;
    for (let i = 0; i < NOUT; i++) this.horses.push({ ring: 0, a0: (i / NOUT) * TAU, ph: i % 2, s: 1 });
    this.horseCv = horseSprite(mixRgba('ember', 'bone', 0.25), mixRgba('ink', 'ink2', 0.7), mixRgba('signal', 'blood', 0.35), mixRgba('blood', 'ink', 0.35));
    if (m) {
      this.lay = layMsgV2(this.dyn.ctx, m.text, sig, FAM_MSG, MSG_BOX, { lineHeight: 1.28, maxLines: 5, sigFamily: F.hand(400), align: 'center' });
      this.lyrSize = lyricV2(this.lay.fit.size);
      const n = this.lay.glyphs.filter((g) => g.row >= 0).length;
      this.gT = stagger(au, this.tOn, n, Math.min(1.5 * bar, Math.max(0.6, 0.4 * (e - this.tOn))));
      this.sigT = (this.gT[this.gT.length - 1] ?? this.tOn) + beat * 0.5;
    }
    this.drawBg();
    this.drawColumn();
    this.drawSkirt();
    this.avoid = [[MSG_BOX.x, MSG_BOX.y, MSG_BOX.w, MSG_BOX.h], [360, RIM.top, 1200, RIM.bot - RIM.top]];
  }

  /** 夜空、遠處遊樂園的燈（散景）、地面。 */
  private drawBg() {
    const L = this.bg, c = L.ctx;
    L.clear();
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, mixRgba('ink', 'ink2', 0.3)); g.addColorStop(0.55, mixRgba('ink2', 'blood', 0.12)); g.addColorStop(1, rgba('ink'));
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // 遠處的燈：很糊的圓（散景），暖色為主
    const rnd = (i: number, k: number) => hash(this.seed, i, k);
    for (let i = 0; i < 46; i++) {
      const x = rnd(i, 1) * W, y = 250 + rnd(i, 2) * 420, r = 14 + 40 * rnd(i, 3) ** 2;
      const rg = c.createRadialGradient(x, y, 0, x, y, r);
      const col = rnd(i, 4) < 0.7 ? 'signal' : rnd(i, 4) < 0.9 ? 'bone' : 'rose';
      rg.addColorStop(0, rgba(col, 0.07 + 0.08 * rnd(i, 5))); rg.addColorStop(0.7, rgba(col, 0.04)); rg.addColorStop(1, rgba(col, 0));
      c.fillStyle = rg; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    }
    // 地面：平台下面一圈暖光
    const fg = c.createRadialGradient(CX, 1000, 50, CX, 1000, 900);
    fg.addColorStop(0, rgba('signal', 0.06)); fg.addColorStop(1, rgba('signal', 0));
    c.fillStyle = fg; c.fillRect(0, 700, W, 380);
    L.upload();
  }

  /** 中間的鏡子柱子：一根圓柱，表面一條條直的鏡子（映著燈泡的散景），上下描金的腰線與一圈小燈。畫在自己的畫布上，每格貼上（後排的木馬要在它後面）。 */
  private drawColumn() {
    const w = COL * 2 + 20, h = PL.y - RIM.bot + 14;
    const cv = this.col; cv.width = w; cv.height = h;
    const c = cv.getContext('2d')!;
    const cx = w / 2, y0 = 30, y1 = h - 34;
    const g = c.createLinearGradient(cx - COL, 0, cx + COL, 0);
    g.addColorStop(0, rgba('ink')); g.addColorStop(0.35, mixRgba('ink2', 'blood', 0.3)); g.addColorStop(0.6, mixRgba('ink2', 'blood', 0.22)); g.addColorStop(1, rgba('ink'));
    c.fillStyle = g; c.fillRect(cx - COL, 0, COL * 2, h);
    const rnd = (i: number, k: number) => hash(this.seed + 7, i, k);
    const N = 11;
    for (let k = 0; k < N; k++) {
      const a0 = -Math.PI / 2 + ((k + 0.12) / N) * Math.PI, a1 = -Math.PI / 2 + ((k + 0.88) / N) * Math.PI;
      const x0 = cx + Math.sin(a0) * COL, x1 = cx + Math.sin(a1) * COL;
      const face = Math.cos((a0 + a1) / 2);
      c.fillStyle = mixRgba('ink', 'graphite', 0.2 + 0.25 * face); c.fillRect(x0, y0, x1 - x0, y1 - y0);
      c.save(); c.beginPath(); c.rect(x0, y0, x1 - x0, y1 - y0); c.clip();
      for (let i = 0; i < 5; i++) {
        const x = x0 + rnd(k * 9 + i, 1) * (x1 - x0), y = y0 + rnd(k * 9 + i, 2) * (y1 - y0), r = 6 + 16 * rnd(k * 9 + i, 3);
        const rg = c.createRadialGradient(x, y, 0, x, y, r);
        rg.addColorStop(0, rgba('ember', 0.4 * face)); rg.addColorStop(0.6, rgba('signal', 0.12 * face)); rg.addColorStop(1, rgba('signal', 0));
        c.fillStyle = rg; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
      }
      c.restore();
      c.fillStyle = rgba('bone', 0.1 * face); c.fillRect(x0 + (x1 - x0) * 0.2, y0, 1.5, y1 - y0);
    }
    // 上下描金的腰線（圓柱，中間低兩邊高一點）與一圈小燈
    for (const yy of [y0 - 10, y1 + 4]) {
      c.fillStyle = mixRgba('signal', 'blood', 0.5);
      c.beginPath(); c.ellipse(cx, yy, COL, 8, 0, 0, Math.PI); c.lineTo(cx - COL, yy); c.fill();
    }
    for (let k = 0; k < 13; k++) {
      const a = -Math.PI / 2 + ((k + 0.5) / 13) * Math.PI;
      c.fillStyle = rgba('ember', 0.5 + 0.5 * Math.cos(a));
      c.beginPath(); c.arc(cx + Math.sin(a) * (COL - 6), y0 - 4 + 6 * Math.cos(a), 3, 0, TAU); c.fill();
    }
  }

  /** 平台的圍裙板：深色漆板、描金的框、兩邊的捲草紋，留言寫在上面（名牌）。 */
  private drawSkirt() {
    const cv = this.skirt; cv.width = W; cv.height = H;
    const c = cv.getContext('2d')!;
    // 板子是圓柱的正面：上緣跟著平台的橢圓（中間低、兩邊高），下緣再低一點
    const topY = (x: number) => PL.y + PL.ry * Math.sqrt(Math.max(0, 1 - ((x - CX) / PL.rx) ** 2)) + 6;
    const botY = (x: number) => SKIRT.bot + 40 * Math.sqrt(Math.max(0, 1 - ((x - CX) / PL.rx) ** 2)) - 40;
    c.beginPath();
    for (let x = CX - PL.rx; x <= CX + PL.rx; x += 10) c.lineTo(x, topY(x));
    for (let x = CX + PL.rx; x >= CX - PL.rx; x -= 10) c.lineTo(x, botY(x));
    c.closePath();
    const g = c.createLinearGradient(0, SKIRT.top, 0, SKIRT.bot);
    g.addColorStop(0, mixRgba('ink2', 'blood', 0.32)); g.addColorStop(1, mixRgba('ink', 'blood', 0.12));
    c.fillStyle = g; c.fill();
    // 圓柱的明暗：兩邊暗
    const sg = c.createLinearGradient(CX - PL.rx, 0, CX + PL.rx, 0);
    sg.addColorStop(0, rgba('ink', 0.85)); sg.addColorStop(0.25, rgba('ink', 0)); sg.addColorStop(0.75, rgba('ink', 0)); sg.addColorStop(1, rgba('ink', 0.85));
    c.fillStyle = sg; c.fill();
    // 上緣一條描金的飾條、下緣一條細的
    c.strokeStyle = mixRgba('signal', 'blood', 0.3); c.lineWidth = 5;
    c.beginPath(); for (let x = CX - PL.rx; x <= CX + PL.rx; x += 10) c.lineTo(x, topY(x) + 4); c.stroke();
    c.lineWidth = 2; c.strokeStyle = mixRgba('signal', 'blood', 0.5);
    c.beginPath(); for (let x = CX - PL.rx; x <= CX + PL.rx; x += 10) c.lineTo(x, botY(x) - 10); c.stroke();
    // 名牌的框：描金細線、四角一個小圓。有留言時框只比字（含署名）多一點邊距（v2：容器要輕），短留言不會掛著一個空空的大框；
    // 沒有留言時框住歌詞的整塊範圍
    let bx = MSG_BOX.x - 40, bw = MSG_BOX.w + 80, by = MSG_BOX.y - 14, bh = MSG_BOX.h + 16;
    if (this.lay) {
      const [lx, ly, lw, lh] = this.lay.box;
      const px = Math.max(48, this.lay.fit.size * 0.9), py = Math.max(26, this.lay.fit.size * 0.5);
      bw = Math.max(460, lw + 2 * px); bx = lx + lw / 2 - bw / 2;
      by = ly - py; bh = lh + 2 * py;
    }
    c.strokeStyle = mixRgba('signal', 'blood', 0.4); c.lineWidth = 1.6;
    c.strokeRect(bx, by, bw, bh);
    c.fillStyle = mixRgba('signal', 'blood', 0.4);
    for (const [x, y] of [[bx, by], [bx + bw, by], [bx, by + bh], [bx + bw, by + bh]]) { c.beginPath(); c.arc(x!, y!, 5, 0, TAU); c.fill(); }
  }

  override dispose() {
    // 自己開的畫布（不是 Layer2D）也把記憶體還掉
    for (const cv of [this.col, this.skirt, this.horseCv]) if (cv) cv.width = cv.height = 0;
    super.dispose();
  }

  /** 轉了多少（弧度）：一小節轉過一匹外圈的馬。 */
  private rot(t: number) { return (this.ctx.audio.barAt(t) * TAU) / NOUT + hash(this.seed, 5) * TAU; }

  /** 木馬 k 在 t 的上下（px，往上是負的）：兩拍一個來回，相鄰的相反，在拍點到頂或到底（停一下）。 */
  private bob(h: Horse, beat: number) {
    const u = ((beat + h.ph) % 2 + 2) % 2;
    const k = u < 1 ? ease.inOutCubic(u) : 1 - ease.inOutCubic(u - 1);
    return -34 * k * h.s;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, song } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const rot = this.rot(t);
    const kick = f.a.kick;
    // 鏡頭：切進來時畫面低一點（往上看頂篷）、第一拍落定；之後很慢地推近
    const land = ease.outExpo(prog(t, s, Math.max(s + 0.3, this.tOn + 0.1)));
    const drift = ease.inOutQuad(clamp((t - s) / Math.max(1, e - s)));
    const z = 1 + 0.04 * drift, oy = 60 * (1 - land);
    const setCam = (cc: CanvasRenderingContext2D) => cc.setTransform(z, 0, 0, z, CX - CX * z, 540 - 540 * z + oy);

    comp.draw(renderer, this.bg.texture, out, { mode: 'replace', premult: false });
    const D = this.dyn, c = D.ctx, Hh = this.hot, hc = Hh.ctx;
    D.clear(); Hh.clear();
    setCam(c); setCam(hc);
    const beat = f.beat;
    const lit = 0.85 + 0.15 * kick;

    // ---- 頂篷：往上收的條紋（跟著轉）
    const rimTop = (x: number) => RIM.top + RIM.droop * 0.6 * ((x - CX) / RIM.rx) ** 2;
    const rimBot = (x: number) => RIM.bot + RIM.droop * ((x - CX) / RIM.rx) ** 2;
    const NS = 24;
    for (let j = 0; j < NS; j++) {
      const a0 = (j / NS) * TAU + rot, a1 = ((j + 1) / NS) * TAU + rot;
      if (Math.cos((a0 + a1) / 2) < -0.05) continue;
      const x0 = CX + RIM.rx * Math.sin(a0), x1 = CX + RIM.rx * Math.sin(a1);
      c.fillStyle = j % 2 ? mixRgba('ink2', 'blood', 0.5) : mixRgba('ink2', 'bone', 0.1);
      c.beginPath(); c.moveTo(x0, rimTop(x0) + 2); c.lineTo(x1, rimTop(x1) + 2); c.lineTo(CX + (x1 - CX) * 0.2, -120); c.lineTo(CX + (x0 - CX) * 0.2, -120); c.closePath(); c.fill();
    }
    // 頂篷的明暗（上面暗）
    const cg = c.createLinearGradient(0, -60, 0, RIM.top);
    cg.addColorStop(0, rgba('ink', 0.85)); cg.addColorStop(1, rgba('ink', 0.1));
    c.fillStyle = cg; c.fillRect(0, -80, W, RIM.top + 90);
    // ---- 花邊（一圈深色的帶子，下緣是一個個扇形，每個扇形掛一顆燈泡）
    c.beginPath();
    for (let x = 0; x <= W; x += 16) c.lineTo(x, rimTop(x));
    for (let x = W; x >= 0; x -= 16) c.lineTo(x, rimBot(x));
    c.closePath();
    const rg = c.createLinearGradient(0, RIM.top, 0, RIM.bot);
    rg.addColorStop(0, mixRgba('ink2', 'blood', 0.35)); rg.addColorStop(1, mixRgba('ink', 'blood', 0.2));
    c.fillStyle = rg; c.fill();
    c.strokeStyle = mixRgba('signal', 'blood', 0.35); c.lineWidth = 3;
    c.beginPath(); for (let x = 0; x <= W; x += 16) c.lineTo(x, rimTop(x) + 6); c.stroke();
    const NSC = 44, step = Math.floor(beat + 1e-4);
    // 每個小節線：一道光浪從正前方往兩邊跑過所有燈泡（窗格裡每小節一個小事件）
    const tb = this.ctx.audio.timeOfBar(Math.floor(this.ctx.audio.barAt(t) + 1e-4)), tw = t - tb;
    const wave = (x: number) => (tw < 1.2 ? Math.exp(-(((Math.abs(x - CX) / RIM.rx - tw * 1.5) / 0.07) ** 2)) : 0);
    for (let j = 0; j < NSC; j++) {
      const a = (j / NSC) * TAU + rot;
      if (Math.cos(a) < 0.08) continue;
      const x = CX + RIM.rx * Math.sin(a), y = rimBot(x);
      const w = (TAU / NSC) * RIM.rx * Math.cos(a) * 0.5;
      c.fillStyle = mixRgba('blood', 'signal', 0.18);
      c.beginPath(); c.ellipse(x, y, w, 16, 0, 0, Math.PI); c.fill();
      c.strokeStyle = mixRgba('signal', 'blood', 0.4); c.lineWidth = 1.5;
      c.beginPath(); c.ellipse(x, y, w, 16, 0, 0, Math.PI); c.stroke();
      // 跑馬燈：一拍走一格，三顆亮一顆暗；大鼓時全亮一下；小節線的那一道光浪經過時也亮
      const on = (j + step) % 3 !== 0 || kick > 0.6 || wave(x) > 0.5;
      const by = y + 14, br = 5 * Math.cos(a) + 1;
      c.fillStyle = on ? rgba('ember', 0.95) : rgba('graphite', 0.8);
      c.beginPath(); c.arc(x, by, br, 0, TAU); c.fill();
      if (on) { hc.fillStyle = rgba('signal', 0.55 * lit); hc.beginPath(); hc.arc(x, by, br * 2.6, 0, TAU); hc.fill(); }
    }
    // 花邊上緣一排小燈（不跑）
    for (let j = 0; j < 60; j++) {
      const a = (j / 60) * TAU + rot;
      if (Math.cos(a) < 0.08) continue;
      const x = CX + RIM.rx * Math.sin(a), y = rimTop(x) + 6;
      c.fillStyle = rgba('ember', 0.8); c.beginPath(); c.arc(x, y, 2.6 * Math.cos(a) + 0.8, 0, TAU); c.fill();
      hc.fillStyle = rgba('signal', 0.3 * lit); hc.beginPath(); hc.arc(x, y, 6, 0, TAU); hc.fill();
    }

    // ---- 頂篷下面的暗處（柱子頂）、後排的木馬、柱子、前排的木馬
    const under = c.createLinearGradient(0, RIM.bot, 0, RIM.bot + 120);
    under.addColorStop(0, rgba('ink', 0.9)); under.addColorStop(1, rgba('ink', 0));
    c.fillStyle = under; c.fillRect(0, RIM.bot - 10, W, 140);
    // 平台（從上面看到的橢圓木地板）
    c.fillStyle = mixRgba('ink', 'blood', 0.18);
    c.beginPath(); c.ellipse(CX, PL.y, PL.rx, PL.ry, 0, 0, TAU); c.fill();
    const list = this.horses.map((h) => {
      const a = h.a0 + rot;
      const r = h.ring ? 0.66 : 0.88;
      return { h, a, r, zc: Math.cos(a) * r };
    }).sort((p, q) => p.zc - q.zc);
    const drawOne = (it: typeof list[number]) => {
      const { h, a, r } = it;
      const cz = Math.cos(a);
      const x = CX + r * PL.rx * Math.sin(a);
      const sc = h.s * (0.74 + 0.26 * (cz * 0.5 + 0.5));
      const baseY = PL.y + r * PL.ry * cz;
      const y = baseY - 150 * sc + this.bob(h, beat) * sc;
      const dir = cz >= 0 ? 1 : -1;
      const squash = Math.max(0.14, Math.abs(cz));
      const shade = 0.3 + 0.7 * (cz * 0.5 + 0.5);
      // 銅柱：頂篷到平台，穿過鞍座（後排的暗）
      const poleTop = rimBot(x) + 10, poleBot = baseY;
      c.strokeStyle = mixRgba('ink', 'signal', 0.2 + 0.45 * shade); c.lineWidth = 7 * sc;
      c.beginPath(); c.moveTo(x, poleTop); c.lineTo(x, poleBot); c.stroke();
      c.strokeStyle = rgba('ember', 0.55 * shade); c.lineWidth = 1.6 * sc;
      c.beginPath(); c.moveTo(x - 1.6 * sc, poleTop); c.lineTo(x - 1.6 * sc, poleBot); c.stroke();
      // 馬（精靈圖）：側面轉到正面時壓扁，後排的暗一點
      c.save();
      c.globalAlpha = 0.45 + 0.55 * shade;
      c.translate(x, y); c.scale(dir * squash * sc, sc);
      c.drawImage(this.horseCv!, -SPR.ox, -SPR.oy, SPR.w, SPR.h);
      c.restore();
      // 銅柱在馬前面的那一段（穿過鞍座）
      c.strokeStyle = mixRgba('ink', 'signal', 0.25 + 0.5 * shade); c.lineWidth = 6 * sc;
      c.beginPath(); c.moveTo(x, y - 60 * sc); c.lineTo(x, y + 30 * sc); c.stroke();
      if (cz > 0.3) { hc.fillStyle = rgba('signal', 0.22 * shade * lit); hc.beginPath(); hc.arc(x, y - 30 * sc, 12 * sc, 0, TAU); hc.fill(); }
    };
    for (const it of list) if (it.zc < 0) drawOne(it);
    c.drawImage(this.col, CX - COL - 10, RIM.bot - 10);
    for (const it of list) if (it.zc >= 0) drawOne(it);

    // ---- 平台正面與圍裙板（名牌）
    c.drawImage(this.skirt, 0, 0);
    // 平台邊緣一圈燈
    for (let j = 0; j < 50; j++) {
      const a = (j / 50) * TAU + rot;
      if (Math.cos(a) < 0.05) continue;
      const x = CX + PL.rx * Math.sin(a), y = PL.y + PL.ry * Math.cos(a) + 10;
      const wv = wave(x);
      const on = (j + step) % 2 === 0 || wv > 0.5;
      c.fillStyle = on ? rgba('ember', 0.9) : rgba('graphite', 0.7);
      c.beginPath(); c.arc(x, y, (3.2 * Math.cos(a) + 1) * (1 + 0.6 * wv), 0, TAU); c.fill();
      if (on) { hc.fillStyle = rgba('signal', (0.35 + 0.5 * wv) * lit); hc.beginPath(); hc.arc(x, y, 8 + 8 * wv, 0, TAU); hc.fill(); }
    }

    // ---- 字：名牌上的留言（或沒有留言時的歌詞）、花邊上的歌詞（或名字、歌名）
    const ink = darkInk();
    const rimY = RIM.top + (RIM.bot - RIM.top) * 0.64;
    if (m && this.lay) {
      const lay = this.lay;
      c.textBaseline = 'alphabetic';
      let i = 0;
      for (const g of lay.glyphs) {
        if (g.row < 0) continue;
        const tg = this.gT[i++]!;
        if (t < tg) break;
        const heat = Math.exp(-(t - tg) / 0.3);
        c.globalAlpha = ease.outCubic(clamp((t - tg) / 0.06));
        if (g.ch === '♥') { drawHeart(c, g.x + g.w / 2, g.y - g.size * 0.36, Math.min(g.w, g.size * 0.8) * 0.92); continue; }
        c.font = font(FAM_MSG, g.size);
        c.fillStyle = heat > 0.02 ? mixRgba('bone', 'signal', heat) : rgba('bone', 0.95);
        c.fillText(g.ch, g.x, g.y);
        if (heat > 0.05) { hc.globalAlpha = heat; hc.font = font(FAM_MSG, g.size); hc.fillStyle = rgba('signal', 0.8); hc.fillText(g.ch, g.x, g.y); hc.globalAlpha = 1; }
      }
      c.globalAlpha = 1;
      if (t >= this.sigT) {
        c.globalAlpha = prog(t, this.sigT, this.sigT + 0.3);
        c.font = font(lay.sig.family, lay.sig.size); c.fillStyle = rgba('bone', 0.8);
        c.fillText(lay.sig.text, lay.sig.x, lay.sig.y);
        c.globalAlpha = 1;
      }
      const ly = this.hasLyr ? lyricAt(lyrics, t) : null;
      if (ly) {
        const L2 = layoutRows(c, ly.line, { family: FAM_LYR, size: this.lyrSize, minSize: V2.lyrMin, maxW: 1180, maxRows: 1, align: 'center' });
        c.save(); c.translate(CX, rimY + L2.size * 0.36); drawRows(c, L2, FAM_LYR, t, ink, ly.k); c.restore();
      } else if (!this.hasLyr) {
        c.font = font(F.mono(500), 20); c.fillStyle = rgba('ash', 0.75); c.letterSpacing = '4px'; c.textAlign = 'center';
        c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`, CX, rimY + 8);
        c.letterSpacing = '0px'; c.textAlign = 'left';
      }
    } else {
      // 沒有留言：花邊上是新人的名字，名牌上是歌詞（主角）
      // 名字長短每一場不一樣：照花邊的寬度（跟歌詞一樣 1180）縮字，字距跟著縮
      const nPx = fitPx(COUPLE_ZH, F.ming(700), 40, 1180, 8);
      c.font = font(F.ming(700), nPx); c.fillStyle = rgba('bone', 0.75); c.textAlign = 'center'; c.letterSpacing = `${(8 * nPx) / 40}px`;
      c.fillText(COUPLE_ZH, CX, rimY + 14);
      c.letterSpacing = '0px';
      // 句子之間的空檔：上一句留在名牌上（淡一點），名牌不要突然空掉
      let ly = this.hasLyr ? lyricAt(lyrics, t) : null;
      if (!ly && this.hasLyr) { const last = lyrics.lastLine(t); if (last && last.end > s - 4) ly = { line: last, k: 0.55 }; }
      if (ly) {
        const L2 = layoutRows(c, ly.line, { family: FAM_LYR, size: lyricV2(null), minSize: V2.lyrMin, maxW: MSG_BOX.w, maxRows: 2, align: 'center', lineHeight: 1.2 });
        // 原文副行（韓文歌）：一起寫在名牌上、中文正下方；整塊（中文＋原文）在名牌裡置中，所以中文往上讓一點
        const sub = lyricSubOf(ly.line);
        const sst: LyricStyle = { family: FAM_LYR, size: L2.size, maxWidth: MSG_BOX.w, align: 'center', sung: ink.sung, unsung: ink.unsung };
        const lastY = (L2.rows.length - 1) * L2.lineHeight, gap = sub ? subGap(L2.size) : 0;
        const sl = sub ? layoutLyric(c, sub, subStyleFor(sst, L2.size)) : null;
        const extra = sl ? gap + sl.height - sl.size : 0;
        const y0 = MSG_BOX.y + MSG_BOX.h / 2 - 20 - (L2.height + extra) / 2 + L2.size * 0.8;
        c.save(); c.translate(MX, y0); drawRows(c, L2, FAM_LYR, t, ink, ly.k);
        // drawLyricSub 的字位置是排好的左緣：這裡的 textAlign 還是上面名字用的 center，要先改回來
        if (sub) { c.translate(0, lastY + gap); c.textAlign = 'left'; drawLyricSub(c, sub, t, sst, L2.size, c.globalAlpha * ly.k); }
        c.restore();
      } else if (!this.hasLyr) {
        c.font = font(F.hand(700), fitPx(COUPLE_ZH, F.hand(700), 60, MSG_BOX.w - 40)); c.fillStyle = rgba('bone', 0.9);
        c.fillText(COUPLE_ZH, MX, MSG_BOX.y + 130);
      }
      c.font = font(F.hei(500), 22); c.fillStyle = rgba('ash', 0.75); c.letterSpacing = '3px';
      c.fillText(T23_INVITE, MX, MSG_BOX.y + MSG_BOX.h - 8);
      c.letterSpacing = '0px'; c.textAlign = 'left';
    }
    c.setTransform(1, 0, 0, 1, 0, 0); hc.setTransform(1, 0, 0, 1, 0, 0);
    // 右下角（QR 與小字）：圍裙板與燈沒入暗處，HUD 的字才清楚
    const hg = c.createRadialGradient(1760, 1000, 60, 1760, 1000, 520);
    hg.addColorStop(0, rgba('ink', 0.92)); hg.addColorStop(0.55, rgba('ink', 0.75)); hg.addColorStop(1, rgba('ink', 0));
    c.fillStyle = hg; c.fillRect(1150, 600, W - 1150, H - 600);
    hc.save(); hc.globalCompositeOperation = 'destination-out'; hc.fillStyle = hg; hc.fillRect(1150, 600, W - 1150, H - 600); hc.restore();
    comp.draw(renderer, D.upload(), out);
    comp.draw(renderer, Hh.upload(), out, { mode: 'add', tint: [1.8, 1.8, 1.8] });
    return { bloom: 0.8, vignette: 0.55, halation: 0.35, popupAvoid: this.avoid };
  }
}
