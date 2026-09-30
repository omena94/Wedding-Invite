// 雙人腳踏車（亮、sport）：河濱自行車道的側面，宣文（前座）載孟庭（後座）騎協力車往右，後座的藤籃裡坐著芃芃與 QQ，元元在前面帶路跑，
// 景一層一層往後捲（遠的城市慢、河堤的樹與路燈快、路面的虛線最快）。角色是 Codex 畫的雙人紙偶（cp_tandem_1～4，_puppet.ts）。
//  - **踏板一拍一圈**：四張關鍵影格（曲柄朝前、朝下、朝後、朝上）一拍換完一輪（drawCycle，一拍四張）；車速也跟著拍子：
//    一拍往前 K px（快歌騎得快、慢歌騎得慢），輪子照車速轉（程式畫的輪子：外胎、輻條、花鼓，轉快時輻條淡成一片）。
//  - 車身跟著路面在拍點上輕輕一顛；籃子裡的兩隻狗在拍點上跟著彈一下、輪流歪頭。
//  - 元元（2026-09-30 新人加的第三隻：白色柴犬，比博美大很多，籃子裝不下）：在車子前面、路的另一側跟著跑、帶路，
//    一拍兩步（跑步兩張）、一步一彈，速度跟車子差不多但一下超前一下落後一點（每四小節來回一次），張嘴笑；
//    每兩小節的小節線開心地跳一下（最高點在小節線上）。跑在車的後面一層（輪子擋在牠前面），不會碰到右下角 HUD。
//  - **焦點是主打留言**：車尾用兩條繩子拖著一面布條（紙白的布、手寫字），布條在風裡一波一波飄（整張先畫好，每格切成細條上下錯開）；
//    開場布條從車尾往左「展開」。照「留言尺寸與版面比例標準 v2」：字 40～60、布條最大 660 × 400，高度跟著留言長短。沒有留言時寫邀請。
//  - 歌詞：車尾插著一根細長的旗桿（協力車常見的安全旗），歌詞像旗子上的飄帶，沿著一條會飄的波浪線從旗桿頂往後飄，照跟唱規則逐字亮，
//    比留言小一級（標準 v2：40～52）。
//  - 右上是天空與太陽（很淡），右下角 HUD 那一塊路面淡掉。鏡頭跟著車子，輕輕晃；整個窗格慢慢推近一點點。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H, SCALE } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, loadText } from '../engine/type';
import { lyricSubOf, type Lyrics } from '../engine/lyrics';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash } from '../engine/util';
import { lyricAt, sparkHead, sparkParticles } from './_motifs';
import { inkFor, paperBG, inkLine, inkPath, inkEllipse, lyricOnPath, drawNote, type Pt, type Note, type Ink } from './_couple';
import { loadPuppets, drawPuppet, drawCycle, puppetPoint, puppetShadow, puppetIn, breathe, beatKick, hop, jumpArc, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'sport', paper: true, energy: [0.3, 1], bars: [4, 8] };

/** 路面：輪子著地的那條線；路的上緣、下緣、中間的虛線。 */
const GROUND = 806;
const ROAD = { top: 752, bottom: 862, dash: 806 };
const SZ = 430;
/** 車子（紙偶的錨點 x）；整台車的額外縮放（協力車的圖裡人畫得比站著的圖小，照輪距換算回來）。 */
const BIKE_X = 1160, BIKE_S = 1.45;
/** 一拍往前幾 px（車速）。 */
const K = 190;
/** 布條：最大範圍（標準 v2）、寫字的內距；右緣離車尾多遠。 */
const BANNER = { w: 660, h: 400, gap: 70 };
const PAD = { x: 34, top: 30, bottom: 24 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const FRAMES = ['cp_tandem_1', 'cp_tandem_2', 'cp_tandem_3', 'cp_tandem_4'];
const SPRITES = [...FRAMES, 'pp_sit', 'qq_sit', 'yy_run_1', 'yy_run_2', 'yy_jump'];
/** 三隻狗同一個倍數（大小比例照 dogs3）。 */
const DOG_S = 1.35;
/** 元元跑的地方：路的另一側（遠的那一邊）、車頭前面；每四小節前後來回 YY.swing px。 */
const YY = { x: 1680, g: 772, swing: 45, jump: 58 };

/** 布條的布料：一次畫好在自己的畫布上（字、布紋、邊），每格切成細條上下錯開貼上去，看起來在風裡飄。 */
class Cloth {
  canvas = document.createElement('canvas');
  ctx: CanvasRenderingContext2D;
  constructor(public w: number, public h: number) {
    this.canvas.width = Math.ceil(w * SCALE);
    this.canvas.height = Math.ceil(h * SCALE);
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(SCALE, SCALE);
  }
  dispose() { this.canvas.width = this.canvas.height = 0; }
}

/**
 * 一層視差背景：一條頭尾接得起來的橫向長圖（週期 L px，畫面的 y0 到 y0 + h），init 畫一次，每格照捲動距離貼兩三次。
 * 以前每格用手繪筆重畫幾十條線、幾十個橢圓（每格 5 ms 多），現在每層只剩幾次 drawImage。
 * 圖裡的東西照週期排（第 i 個用 hash(i mod N)），所以一個週期裡的每一樣都要畫三份（左移、原位、右移一個週期），跨過接縫的才完整。
 */
class Strip {
  canvas = document.createElement('canvas');
  ctx: CanvasRenderingContext2D;
  constructor(public L: number, public y0: number, public h: number, res = SCALE) {
    this.canvas.width = Math.ceil(L * res);
    this.canvas.height = Math.ceil(h * res);
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(res, res);
    this.ctx.translate(0, -y0);
  }
  /** 畫一個週期的內容（畫面座標；x 在 0..L），左右各多畫一份。 */
  paint(fn: (c: CanvasRenderingContext2D) => void) {
    for (const k of [-1, 0, 1]) { this.ctx.save(); this.ctx.translate(k * this.L, 0); fn(this.ctx); this.ctx.restore(); }
  }
  /** 貼到畫面：捲了 off px（往左），再往右挪 dx px。 */
  blit(c: CanvasRenderingContext2D, off: number, dx = 0) {
    let x = -(((off % this.L) + this.L) % this.L) + dx;
    while (x > 0) x -= this.L;
    for (; x < W; x += this.L) c.drawImage(this.canvas, x, this.y0, this.L, this.h);
  }
  dispose() { this.canvas.width = this.canvas.height = 0; }
}

/** 視差背景的週期（px）：樹與路燈每 520 一組、五組一個週期；路的虛線 150、路邊草 170（2550 兩個都整除）；前景草坡每 120 一撮、二十撮一個週期。 */
const PER = { city: 2600, river: 2200, trees: 2600, road: 2550, verge: 2400 };

export default class Tandem extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(512, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  cloth: Cloth | null = null;
  /** 視差背景的長圖（init 畫好）：遠城、河、樹與路燈（還有一張樹冠的遮罩：蓋住後面的城與河）、路面的虛線與路邊草、前景草坡。 */
  strips: { city: Strip; river: Strip; trees: Strip; treeMask: Strip; road: Strip; verge: Strip } | null = null;
  /** 車子這一格的錨點 y（輪子剛好著地）、兩個輪軸、輪子半徑、籃子、車尾（綁繩子、插旗桿）——在 init 用第一張圖算好（四張車身一樣）。 */
  bikeY = GROUND;
  wheels: Pt[] = [];
  wheelR = 60;
  basket: Pt = { x: 0, y: 0 };
  rack: Pt = { x: 0, y: 0 };
  bw = BANNER.w;
  bh = BANNER.h;
  lyricSize = 52;

  override async init() {
    await loadText('一位賓客' + INVITE);
    this.track(await loadPuppets(SPRITES));
    // 輪子：圖上只畫到輪軸（輪子由程式畫、跟著車速轉）。半徑照輪距換算（協力車的輪距約是輪子直徑的 2.6 倍），車子放在輪子剛好著地的高度
    const o: PuppetOpts = { h: SZ, scale: BIKE_S };
    const f0 = puppetPoint(FRAMES[0]!, 'wheel_f', BIKE_X, GROUND, o), r0 = puppetPoint(FRAMES[0]!, 'wheel_r', BIKE_X, GROUND, o);
    const wf = f0 ?? { x: BIKE_X + SZ * 0.62, y: GROUND - SZ * 0.2 }, wr = r0 ?? { x: BIKE_X - SZ * 0.62, y: GROUND - SZ * 0.2 };
    this.wheelR = f0?.r || Math.abs(wf.x - wr.x) / 5.2;
    const lift = Math.max(wf.y, wr.y) + this.wheelR - GROUND;
    this.bikeY = GROUND - lift;
    this.wheels = [{ x: wr.x, y: wr.y - lift }, { x: wf.x, y: wf.y - lift }];
    this.basket = puppetPoint(FRAMES[0]!, 'basket', BIKE_X, this.bikeY, o) ?? { x: wr.x + 10, y: wr.y - lift - SZ * 0.3 };
    this.rack = puppetPoint(FRAMES[0]!, 'rack', BIKE_X, this.bikeY, o) ?? { x: wr.x - 30, y: wr.y - lift - SZ * 0.18 };
    // 布條：標準 v2 的字級；寬高跟著留言，整面先畫在自己的畫布上
    const c = this.fg.ctx;
    const tw = BANNER.w - PAD.x * 2, th = BANNER.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, tw, th) : noteV2(c, INVITE, null, tw, th * 0.5, { max: 44 });
    this.bw = Math.min(BANNER.w, tightenNote(c, this.note, 300) + PAD.x * 2);
    this.bh = Math.min(BANNER.h, Math.max(150, PAD.top + this.note.height + PAD.bottom));
    this.cloth = this.track(new Cloth(this.bw, this.bh));
    this.paintCloth();
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.drawBackground();
    this.paintStrips();
  }

  /** 布條（一次）：紙白的布、上下兩道縫邊、左右兩端的布邊，字寫在上面（手寫、墨色）。 */
  private paintCloth() {
    const K2 = this.cloth!, c = K2.ctx, n = this.note!;
    const w = K2.w, h = K2.h;
    c.fillStyle = mixRgba('bone', 'paper', 0.25);
    c.fillRect(0, 0, w, h);
    c.strokeStyle = rgba('sepia', 0.22);
    c.lineWidth = 1.2;
    c.setLineDash([7, 5]);
    c.beginPath(); c.moveTo(6, 8); c.lineTo(w - 6, 8); c.moveTo(6, h - 8); c.lineTo(w - 6, h - 8); c.stroke();
    c.setLineDash([]);
    c.strokeStyle = rgba('sepia', 0.5);
    c.lineWidth = 1.5;
    c.strokeRect(0.75, 0.75, w - 1.5, h - 1.5);
    drawNote(c, n, PAD.x, PAD.top + Math.max(0, (h - PAD.top - PAD.bottom - n.height) / 2), { color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.62), sigColor: rgba('sepia', 0.74) });
  }

  /** 不會動的（畫一次）：天上很淡的太陽（右上）、河堤的線、路面（底色、上下緣）、前景草坡的邊線；右下角（HUD）那一塊淡掉。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx, ink = inkFor(true);
    L.clear();
    inkEllipse(c, 1560, 250, 74, 74, 0, { ink, w: 0.5, seed: 3, color: rgba('sepia', 0.22), fill: mixRgba('paper', 'signal', 0.12) });
    for (let k = 0; k < 3; k++) inkEllipse(c, 1560, 250, 100 + k * 34, 100 + k * 34, 0, { ink, w: 0.25, seed: 4 + k, color: rgba('sepia', 0.07 - k * 0.015) });
    inkLine(c, [{ x: 0, y: 792 }, { x: W, y: 792 }], { ink, w: 0.5, seed: 7, color: rgba('sepia', 0.3) });
    c.fillStyle = rgba('sepia', 0.045);
    c.fillRect(0, ROAD.top, W, ROAD.bottom - ROAD.top);
    inkLine(c, [{ x: 0, y: ROAD.top }, { x: W, y: ROAD.top }], { ink, w: 0.7, seed: 9, color: rgba('sepia', 0.5) });
    inkLine(c, [{ x: 0, y: ROAD.bottom }, { x: W, y: ROAD.bottom }], { ink, w: 0.9, seed: 10, color: rgba('sepia', 0.55) });
    inkLine(c, [{ x: 0, y: 900 }, { x: W, y: 900 }], { ink, w: 0.4, seed: 12, color: rgba('sepia', 0.2) });
    this.hudFade(c);
    L.upload();
  }

  /** 右下角（HUD）：景在那裡淡掉（挖掉這一層已經畫的東西）。 */
  private hudFade(c: CanvasRenderingContext2D) {
    c.save();
    c.globalCompositeOperation = 'destination-out';
    const g = c.createRadialGradient(1760, 1040, 60, 1760, 1040, 500);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.5, 'rgba(0,0,0,0.9)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(1200, 700, 720, 380);
    c.restore();
  }

  /**
   * 畫視差背景的長圖（一次）。每一層的內容跟以前每格畫的一樣（位置、線、顏色），只是第 i 個用 i mod N 挑形狀，整條頭尾接得起來。
   * 樹冠的手繪線以前每 1/8 秒抖一次（boiling），遠景這一點點抖動拿掉，換來每格少畫幾十個橢圓。
   */
  private paintStrips() {
    const ink = inkFor(true);
    // 遠處的城市：一排高高低低的樓（很淡），接一座拱橋（以前 x0 = 捲動 - 200，所以內容從 -200 開始）
    const city = this.track(new Strip(PER.city, 430, 215));
    city.paint((c) => {
      c.strokeStyle = rgba('sepia', 0.16);
      c.lineWidth = 1.2;
      c.beginPath();
      const x0 = -200;
      let x = x0;
      c.moveTo(x, 640);
      for (let k = 0; k < 34; k++) {
        const bw = 50 + hash(k, 1) * 70, bh = 30 + hash(k, 2) * (k % 7 === 3 ? 160 : 80);
        c.lineTo(x, 640 - bh); c.lineTo(x + bw, 640 - bh); c.lineTo(x + bw, 640);
        x += bw + hash(k, 3) * 20;
      }
      c.moveTo(x0 + 1700, 640); c.quadraticCurveTo(x0 + 1950, 520, x0 + 2200, 640);
      c.moveTo(x0 + 1680, 600); c.lineTo(x0 + 2220, 600);
      c.stroke();
    });
    // 河面：幾道淡淡的水紋
    const river = this.track(new Strip(PER.river, 650, 135));
    river.paint((c) => {
      c.strokeStyle = rgba('sepia', 0.1);
      c.lineWidth = 1.4;
      c.beginPath();
      for (let k = 0; k < 16; k++) {
        const y = 660 + (k % 6) * 22 + hash(k, 4) * 8, len = 60 + hash(k, 5) * 120;
        const x = hash(k, 6) * PER.river - 150;
        c.moveTo(x, y); c.lineTo(x + len, y);
      }
      c.stroke();
    });
    // 河堤的樹與路燈：每 520 px 一棵樹（以前的 x = i × 520 + 180）、樹與樹之間一盞路燈
    const trees = this.track(new Strip(PER.trees, 425, 385));
    const treeMask = this.track(new Strip(PER.trees, 425, 385, SCALE * 0.5));
    const blobs: [number, number, number, number, number][] = [];
    const n = PER.trees / 520;
    for (const kk of [-1, 0, 1]) {
      for (let i = 0; i < n; i++) {
        const x = kk * PER.trees + i * 520 + 180, hk = 0.8 + 0.4 * hash(i, 8);
        for (const [dx, dy, r] of [[0, -230, 90], [-70, -180, 66], [74, -186, 70], [0, -150, 64]] as const) blobs.push([x + dx * hk, 792 + dy * hk, r * hk, r * 0.78 * hk, i * 10 + dx]);
      }
    }
    {
      const c = trees.ctx;
      trees.paint((c) => {
        for (let i = 0; i < n; i++) {
          const x = i * 520 + 180, hk = 0.8 + 0.4 * hash(i, 8);
          inkLine(c, [{ x, y: 792 }, { x: x + 2, y: 792 - 150 * hk }], { ink, w: 0.8, seed: i, color: rgba('sepia', 0.35) });
          const lx = x + 260;
          inkLine(c, [{ x: lx, y: 800 }, { x: lx, y: 560 }], { ink, w: 0.7, seed: i + 50, color: rgba('sepia', 0.4) });
          inkPath(c, [{ x: lx, y: 560 }, { x: lx + 14, y: 540 }, { x: lx + 42, y: 538 }], { ink, w: 0.7, seed: i + 60, color: rgba('sepia', 0.4) });
          c.fillStyle = rgba('sepia', 0.3);
          c.fillRect(lx + 34, 538, 16, 8);
        }
      });
      for (const [x, y, rx, ry, sd] of blobs) inkEllipse(c, x, y, rx, ry, 0, { ink, w: 0.5, seed: sd, color: rgba('sepia', 0.24) });
      const union = (cc: CanvasRenderingContext2D, d: number) => { cc.beginPath(); for (const [x, y, rx, ry] of blobs) { cc.moveTo(x + rx - d, y); cc.ellipse(x, y, rx - d, ry - d, 0, 0, Math.PI * 2); } };
      // 樹冠裡面挖空（只留外輪廓）、再鋪一層很淡的墨；遮罩是同一塊（貼的時候挖掉後面的城與河，樹冠才擋得住後面的線）
      c.save();
      c.globalCompositeOperation = 'destination-out';
      c.fillStyle = '#000';
      union(c, 2.5); c.fill();
      c.restore();
      union(c, 0); c.fillStyle = rgba('sepia', 0.05); c.fill();
      union(treeMask.ctx, 2.5); treeMask.ctx.fillStyle = '#000'; treeMask.ctx.fill();
    }
    // 路面的虛線（每 150）與路邊的小草（每 170）
    const road = this.track(new Strip(PER.road, 728, 110));
    road.paint((c) => {
      c.strokeStyle = rgba('sepia', 0.3);
      c.lineWidth = 4;
      c.beginPath();
      for (let x = 0; x < PER.road; x += 150) { c.moveTo(x, ROAD.dash + 26); c.lineTo(x + 80, ROAD.dash + 26); }
      c.stroke();
      c.strokeStyle = rgba('sepia', 0.3);
      c.lineWidth = 1.3;
      c.beginPath();
      for (let i = 0; i < PER.road / 170; i++) {
        const x = i * 170 + hash(i, 11) * 60;
        for (let j = 0; j < 3; j++) { const gx = x + j * 6; c.moveTo(gx, ROAD.top); c.quadraticCurveTo(gx - 2, ROAD.top - 8, gx - 6 + j * 3, ROAD.top - 14 - 6 * hash(i, j)); }
      }
      c.stroke();
    });
    // 前景：路外側的草坡，一撮一撮的草與幾朵小花（每 120 一撮）
    const verge = this.track(new Strip(PER.verge, 905, 160));
    verge.paint((c) => {
      c.strokeStyle = rgba('sepia', 0.28);
      c.lineWidth = 1.6;
      c.lineCap = 'round';
      c.beginPath();
      for (let i = 0; i < PER.verge / 120; i++) {
        const x = i * 120 + hash(i, 21) * 50, y = 950 + hash(i, 22) * 110;
        for (let j = 0; j < 4; j++) { const gx = x + j * 7, h = 16 + 22 * hash(i, 23 + j); c.moveTo(gx, y); c.quadraticCurveTo(gx - 2, y - h * 0.6, gx - 8 + j * 4, y - h); }
      }
      c.stroke();
      c.fillStyle = rgba('signal', 0.35);
      for (let i = 0; i < PER.verge / 120; i++) {
        if (hash(i, 31) < 0.6) continue;
        const x = i * 120 + hash(i, 21) * 50 + 10, y = 950 + hash(i, 22) * 110 - 34;
        c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.fill();
      }
    });
    this.strips = { city, river, trees, treeMask, road, verge };
  }

  /** 捲動的距離（px）：一拍 K px，從窗格開始算。 */
  private scroll(t: number) { return K * (this.ctx.audio.beatAt(t) - this.ctx.audio.beatAt(this.ctx.start)); }

  /** 一層一層往後捲的景：雲與鳥每格畫（很少、會動）；遠的城市（0.08 倍）、河面（0.2）、河堤的樹與路燈（0.5）、路面的線（1）、前景草坡（1.35）貼 init 畫好的長圖。 */
  private scenery(c: CanvasRenderingContext2D, t: number, ink: Ink) {
    const s = this.scroll(t);
    const wrap = (x: number, span: number) => ((x % span) + span) % span;
    // 天上：兩三朵很淡的雲（幾乎不動）、三隻鳥（翅膀一拍拍一下，跟車子同方向飛、比車慢一點，所以慢慢往後退）
    for (let k = 0; k < 3; k++) {
      const x = wrap(260 + k * 640 - s * 0.03, 2100) - 150, y = 120 + k * 48;
      if (x > 1300) continue;
      inkPath(c, [{ x, y }, { x: x + 60, y: y - 18 }, { x: x + 130, y: y - 8 }, { x: x + 200, y: y - 22 }, { x: x + 270, y }], { ink, w: 0.45, seed: 40 + k, color: rgba('sepia', 0.18), t });
    }
    const flap = this.ctx.audio.beatAt(t);
    c.save();
    c.strokeStyle = rgba('sepia', 0.45);
    c.lineWidth = 1.6;
    c.lineCap = 'round';
    c.beginPath();
    for (let k = 0; k < 3; k++) {
      const bx = wrap(900 + k * 70 - s * 0.12, 1700) - 200, by = 210 + k * 22 + Math.sin(t * 1.3 + k) * 6;
      if (bx > 1350) continue;
      const w = 12 - k * 2, up = Math.cos((flap + k * 0.3) * Math.PI * 2) * w * 0.6;
      c.moveTo(bx - w, by - up); c.quadraticCurveTo(bx - w * 0.4, by - up * 0.3 - 3, bx, by); c.quadraticCurveTo(bx + w * 0.4, by - up * 0.3 - 3, bx + w, by - up);
    }
    c.stroke();
    c.restore();
    // 各層視差背景：照捲動距離貼長圖（遠城 0.08、河 0.2、樹與路燈 0.5、路 1、前景草坡 1.35）
    const S = this.strips;
    if (!S) return;
    S.city.blit(c, s * 0.08);
    S.river.blit(c, s * 0.2);
    // 樹：拍點上被風推一下（整排往右挪一點點）；先用遮罩挖掉樹冠後面的城與河，再貼樹
    const gust = beatKick(this.ctx.audio, t, 0.5) * 2;
    c.save();
    c.globalCompositeOperation = 'destination-out';
    S.treeMask.blit(c, s * 0.5, gust);
    c.restore();
    S.trees.blit(c, s * 0.5, gust);
    S.road.blit(c, s);
    S.verge.blit(c, s * 1.35);
    this.hudFade(c);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, st = this.ctx.start;
    this.paper.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const ink = inkFor(true);
    const rv = prog(t, st, st + 0.6, ease.inOutCubic);

    this.scenery(c, t, ink);
    // 車身：拍點上路面一顛（往上一下再落回），車頭微微跟著點
    const bump = beatKick(au, t, 0.18);
    const dy = -3 * bump;
    const ent = puppetIn(t, st + 0.05, 0.5);
    this.drawBanner(c, t, dy);
    this.drawFlagLyric(c, t, dy, rv, lyrics);
    this.drawYuan(c, t);
    if (ent.alpha > 0) {
      puppetShadow(c, 'cp', BIKE_X, GROUND + 3, { h: SZ, alpha: 0.3 * ent.alpha, wide: 1.9, color: '70,45,25' });
      this.drawWheels(c, t, dy, ent.alpha);
      this.drawDogs(c, t, dy, ent);
      const o: PuppetOpts = { h: SZ, scale: BIKE_S, spin: ent.spin, alpha: ent.alpha, rot: -0.006 * bump, pivot: 0.2, squash: breathe(t, 0.004, 2.6) };
      drawCycle(c, au, t, FRAMES, 4, BIKE_X, this.bikeY + dy, o, 0.02);
      if (ent.k < 1) {
        sparkHead(this.glow, BIKE_X, GROUND - 6, t, 0.8);
        sparkParticles(this.glow, t, () => ({ x: BIKE_X, y: GROUND - 6 }), { rate: 60, life: 0.3, speed: 150, seed: 1 });
      }
    }
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：跟著車子輕輕晃（拍點上一顛），整個窗格慢慢推近一點點
    const push = ease.inOutCubic(f.p);
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.22, grain: 0.045, ca: 0.4, zoom: 1 + 0.022 * push, shake: [-12 * push, 1.5 * bump] };
  }

  /**
   * 元元在前面帶路跑：一拍兩步（跑步兩張交叉換）、一步一彈；位置跟著四小節一個來回前後晃；
   * 每兩小節的小節線跳一下（jumpArc，最高點在小節線上；用跳起來接東西那張，圖上畫的球蓋掉）。
   */
  private drawYuan(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const en = puppetIn(t, this.ctx.start + 0.25, 0.45);
    if (en.alpha <= 0) return;
    const bar = au.barAt(t);
    const x = YY.x + YY.swing * Math.sin((bar / 4) * Math.PI * 2);
    const base: PuppetOpts = { h: SZ, scale: DOG_S, spin: en.spin, alpha: en.alpha };
    // 這一格在不在跳：最近的偶數小節線前後半拍
    const n = Math.round(bar / 2) * 2, tb = au.timeOfBar(n), bp = au.beatPeriod(tb);
    const j = jumpArc(t, tb - bp * 0.5, tb + bp * 0.5, YY.jump, { crouch: 0.06, land: 0.12 });
    if (j.air) {
      puppetShadow(c, 'yy', x, YY.g + 2, { h: SZ * DOG_S, lift: -j.y, alpha: 0.26 * en.alpha, color: '70,45,25' });
      drawPuppet(c, 'yy_jump', x, YY.g + j.y, { ...base, rot: -0.14 + 0.28 * j.u, pivot: 0.5, squash: j.squash, hide: ['ball'] });
    } else {
      const b = hop(au.beatAt(t), 2) * 7;
      puppetShadow(c, 'yy', x, YY.g + 2, { h: SZ * DOG_S, lift: b, alpha: 0.26 * en.alpha, color: '70,45,25' });
      // 跑步兩張的頭高差很多，交叉淡化只留一格（不然換圖那一下看得到兩個頭）
      drawCycle(c, au, t, ['yy_run_1', 'yy_run_2'], 2, x, YY.g - b, { ...base, squash: j.squash, rot: 0.03 }, 0.017);
    }
    if (en.k < 1) {
      sparkHead(this.glow, x, YY.g - 6, t, 0.7);
      sparkParticles(this.glow, t, () => ({ x, y: YY.g - 6 }), { rate: 50, life: 0.25, speed: 140, seed: 5 });
    }
  }

  /** 兩個輪子（在車身後面）：外胎、輪圈、花鼓、輻條；照車速轉，轉得快時輻條畫淡一點、多幾條殘影。 */
  private drawWheels(c: CanvasRenderingContext2D, t: number, dy: number, alpha: number) {
    const ink = inkFor(true);
    const R = this.wheelR;
    const ang = this.scroll(t) / R;
    const spin = K / this.ctx.audio.beatPeriod(t) / R; // 弧度／秒
    c.save();
    c.globalAlpha = alpha;
    for (const w of this.wheels) {
      const x = w.x, y = w.y + dy;
      inkEllipse(c, x, y, R, R, 0, { ink, w: 1.8, seed: 70, color: rgba('sepia', 0.85) });
      inkEllipse(c, x, y, R * 0.9, R * 0.9, 0, { ink, w: 0.6, seed: 71, color: rgba('sepia', 0.5) });
      const n = 16, ghosts = spin > 8 ? 3 : 1;
      c.lineCap = 'round';
      for (let gi = 0; gi < ghosts; gi++) {
        c.strokeStyle = rgba('sepia', (gi === 0 ? 0.55 : 0.18) * (spin > 8 ? 0.7 : 1));
        c.lineWidth = 1.1;
        c.beginPath();
        for (let k = 0; k < n; k++) {
          const a = ang - gi * 0.05 + (k / n) * Math.PI * 2;
          c.moveTo(x + Math.cos(a) * R * 0.1, y + Math.sin(a) * R * 0.1);
          c.lineTo(x + Math.cos(a + 0.18) * R * 0.88, y + Math.sin(a + 0.18) * R * 0.88);
        }
        c.stroke();
      }
      c.fillStyle = rgba('sepia', 0.8);
      c.beginPath(); c.arc(x, y, R * 0.09, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }

  /** 籃子裡的兩隻狗（畫在車身之前：藤籃會蓋住身體，只露出頭和胸口；籃子底以下裁掉，貨架是空的）；拍點上彈一下、輪流歪頭。 */
  private drawDogs(c: CanvasRenderingContext2D, t: number, dy: number, ent: { spin: number; alpha: number }) {
    const au = this.ctx.audio;
    const b = au.beatAt(t);
    const kick = beatKick(au, t, 0.22);
    c.save();
    c.beginPath();
    c.rect(0, 0, W, this.basket.y + dy - 4);
    c.clip();
    for (const [who, dx, ph] of [['qq', -34, 0], ['pp', 30, 1]] as const) {
      const tilt = Math.floor(b) % 2 === ph ? 0.09 * Math.sin(Math.PI * (b % 1)) : 0;
      const o: PuppetOpts = { h: SZ, scale: DOG_S, rot: tilt * (ph ? 1 : -1), pivot: 0.6, squash: -0.04 * kick + breathe(t, 0.012, 1.4, ph * 0.5), spin: ent.spin, alpha: ent.alpha, flip: who === 'qq' };
      drawPuppet(c, `${who}_sit`, this.basket.x + dx, this.basket.y + dy - 8 * kick, o);
    }
    c.restore();
  }

  /**
   * 布條：從車尾兩條繩子拖著，右緣離車尾 gap；開場從右往左展開（一小節內）。每格把整面切成 6 px 的細條，
   * 每條照一道往左傳的波上下錯開、往左越飄越大，波谷那一側稍微暗一點（布的明暗）。
   */
  private drawBanner(c: CanvasRenderingContext2D, t: number, dy: number) {
    const K2 = this.cloth;
    if (!K2) return;
    const au = this.ctx.audio;
    const st = this.ctx.start;
    const bw = this.bw, bh = this.bh;
    const x1 = this.rack.x - BANNER.gap, x0 = x1 - bw;
    const y0 = clamp(this.rack.y - bh * 0.6, 110, 900 - bh);
    const open = prog(t, st + 0.3, st + 0.3 + Math.min(1.6, au.beatPeriod(st) * 4), ease.outCubic);
    if (open <= 0) return;
    const shown = bw * open;
    const wave = (x: number) => {
      const u = (x1 - x) / bw; // 0 = 綁繩子那一端、1 = 尾端
      const amp = 3 + 9 * u;
      return amp * Math.sin((x / 110) + t * 7.5) + 1.5 * Math.sin((x / 41) + t * 11);
    };
    // 兩條繩子（從車尾到布條右緣的上下角）
    const rk = { x: this.rack.x, y: this.rack.y + dy };
    inkPath(c, [rk, { x: (rk.x + x1) / 2, y: (rk.y + y0) / 2 + 6 }, { x: x1, y: y0 + wave(x1) }], { ink: inkFor(true), w: 0.5, seed: 81, color: rgba('sepia', 0.6), t });
    inkPath(c, [rk, { x: (rk.x + x1) / 2, y: (rk.y + y0 + bh) / 2 + 6 }, { x: x1, y: y0 + bh + wave(x1) }], { ink: inkFor(true), w: 0.5, seed: 82, color: rgba('sepia', 0.6), t });
    // 一條 12 px：夠細、看起來是連續的波浪，貼圖次數只有 6 px 的一半
    const step = 12;
    const src = K2.canvas;
    for (let sx = bw - shown; sx < bw; sx += step) {
      const w = Math.min(step, bw - sx) + 0.6;
      const x = x0 + sx;
      const o = wave(x + step / 2);
      // 影子（往右下）
      c.fillStyle = rgba('sepia', 0.07);
      c.fillRect(x + 8, y0 + o + 12, w, bh);
      c.drawImage(src, sx * SCALE, 0, w * SCALE, bh * SCALE, x, y0 + o, w, bh);
      // 布的明暗：斜率往下的地方暗一點
      const slope = (wave(x + step) - wave(x)) * (6 / step);
      if (slope > 0) { c.fillStyle = rgba('sepia', Math.min(0.1, slope * 0.02)); c.fillRect(x, y0 + o, w, bh); }
    }
  }

  /**
   * 旗桿要拉高多少：這個窗格裡有原文的句子，每句用「波浪往下最深」的靜態路徑先排一次（alpha 0，不會畫出來），
   * 量整塊歌詞的底，跟布條的上緣（布條最高、波浪往上最高的時候）比，取最多的那句。第一格算一次（跟時間無關，截圖也是確定的）。
   */
  private lift: number | null = null;
  private flagLift(c: CanvasRenderingContext2D, topX: number): number {
    if (this.lift !== null) return this.lift;
    const y0 = clamp(this.rack.y - this.bh * 0.6, 110, 900 - this.bh) - 12 - 3;
    let lift = 0;
    for (const line of this.ctx.lyrics.linesIn(this.ctx.start - 1, this.ctx.end + 1)) {
      if (!lyricSubOf(line)) continue;
      const r = lyricOnPath(c, line, 0, flagPath({ x: topX, y: 300 }, null), { family: F.archivo(100, 700), size: this.lyricSize, minSize: 40, offset: -this.lyricSize * 0.3, alpha: 0 });
      lift = Math.max(lift, Math.ceil(r.box[1] + r.box[3] + 16 - y0));
    }
    return (this.lift = lift);
  }

  /** 旗桿與飄帶上的歌詞：車尾一根細長的旗桿（往後彎一點）、頂上一面小三角旗；歌詞沿著從旗桿頂往後飄的波浪線。 */
  private drawFlagLyric(c: CanvasRenderingContext2D, t: number, dy: number, rv: number, lyrics: Lyrics) {
    const ink = inkFor(true);
    const base = { x: this.rack.x + 6, y: this.rack.y + dy };
    const ly = lyricAt(lyrics, t);
    // 雙語（2026-09-30）：有原文的句子多一排（原文在中文下面），長留言的布條又高，原文會疊到布條上。
    // 旗桿拉高 flagLift(…)：歌詞整塊（到原文最後一排）的底離布條上緣至少 16 px；整個窗格用同一個高度（換句時旗子不會跳）
    const top = { x: base.x - 26, y: 300 - this.flagLift(c, base.x - 26) };
    inkPath(c, [base, { x: base.x - 6, y: (base.y + top.y) / 2 }, top], { ink, w: 0.6, seed: 91, color: rgba('sepia', 0.7), t });
    const fl = Math.sin(t * 9) * 4;
    c.fillStyle = rgba('signal', 0.85);
    c.beginPath(); c.moveTo(top.x, top.y); c.lineTo(top.x - 46, top.y + 10 + fl); c.lineTo(top.x, top.y + 24); c.closePath(); c.fill();
    if (!ly) return;
    const path = flagPath(top, t);
    lyricOnPath(c, ly.line, t, path, { family: F.archivo(100, 700), size: this.lyricSize, minSize: 40, offset: -this.lyricSize * 0.3, alpha: ly.k * rv, unsung: rgba('sepia', 0.24), sung: rgba('sepia', 0.9), active: rgba('signal') });
  }
}

/** 飄帶的波浪線（從旗桿頂往後飄）：t = null 時是「每一點都往下到最深」的靜態版本（量高度用）。 */
function flagPath(top: Pt, t: number | null): Pt[] {
  const path: Pt[] = [];
  for (let i = 0; i <= 60; i++) {
    const u = i / 60;
    const x = top.x - 60 - u * (top.x - 60 - 120);
    const w = t === null ? 1 : Math.sin(x / 110 + t * 5);
    path.push({ x, y: top.y + 30 + (6 + 14 * u) * w + 26 * u });
  }
  return path.reverse();
}
