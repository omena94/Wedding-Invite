// 遛狗（亮、dog）：河堤邊的紅磚步道，宣文一手牽 QQ 和元元（兩條藍色牽繩）、孟庭牽芃芃，一起散步，鏡頭跟著他們橫向移動。
// 角色是 Codex 畫的紙偶（_puppet.ts）。
//  - 走（一拍一步，人兩張走路圖、狗兩張小跑圖一拍換兩次，一步一彈）→ 在路邊的告示牌前停下來 → 窗格夠長時最後一小節再走出去。
//    鏡頭跟著走：地上的紅磚、路樹、遠處的街景照遠近用不同速度往後捲（視差），停下來時慢慢煞住。
//  - **狗狗在每棵樹停一下**：走的時候每小節輪流一隻狗在拍點上停在經過的樹下聞一拍（牠停住、景還在捲，所以牠往後退，牽繩拉長），
//    下一拍小跑追回原位。停在告示牌前時 QQ 跑去聞告示牌旁邊那棵樹、芃芃抬頭看孟庭、低頭聞草；
//    元元先站著望向告示牌，然後坐下來、每隔一小節歪頭「看公告」（牠是三隻裡最高、看得到牌子的那隻）。
//  - 牽繩由程式畫：從人手上的握把（圖上的道具點 hand）到狗脖子的蓬毛裡（狗不畫項圈，繩子最後一段淡進毛裡，_couple 的 leash）；
//    宣文一隻手握兩條。元元的圖沒有脖子的道具點，照圖量好寫在 YY_NECK。
//  - 歌詞是頭上的電線上停著的一排字（像停在電線上的麻雀），唱到的那個字跳一下、亮成訊號色（跟唱規則），比留言小一級（標準 v2：40～52）。
//  - **焦點是主打留言**：寫在路邊的社區告示牌上（綠色木框、小屋頂、軟木板，一張用圖釘釘著的公告紙），深墨手寫字、署名；
//    照「留言尺寸與版面比例標準 v2」：字 40～60、告示牌最大 700 × 370，停下來時停在畫面右邊，寬高跟著留言。沒有留言時寫邀請。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp } from '../engine/util';
import { Lyrics, type Line } from '../engine/lyrics';
import { lyricAt, barAfter, beatAfter, sparkHead, sparkParticles, msgChars } from './_motifs';
import { inkFor, paperBG, inkLine, inkPoly, inkEllipse, leash, drawNote, type Pt, type Note, type Ink } from './_couple';
import { loadPuppets, drawPuppet, drawCycle, puppetPoint, puppetBox, puppetInfo, puppetHeight, puppetShadow, puppetIn, hop, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'couple', family: 'dog', paper: true, energy: [0.3, 1], bars: [4, 8] };

/** 兩條走道：宣文與 QQ 走遠的那一邊（腳底高一點、小一點點），孟庭與芃芃走近的那一邊。 */
const LANE_B = 850, LANE_F = 906;
const SZ = 400, FAR_K = 0.95;
const AL_X = 470, OM_X = 280;
/** 狗走路時的位置：芃芃在孟庭前面（近的那一道），元元與 QQ 在宣文前面（遠的那一道，元元緊跟著、QQ 衝在最前面）。 */
const DOG_X: Record<Dog, number> = { pp: 520, yy: 640, qq: 880 };
const DOG_S = 1.15;
type Dog = 'pp' | 'qq' | 'yy';
/** 元元各張圖的脖子（圖上的 px，量 public/wall-sprites/yuanyuan 的圖）：牽繩接在這裡（yuanyuan 組只量了嘴，不動別人的組）。 */
const YY_NECK: Record<string, [number, number]> = { yy_walk: [430, 160], yy_stand: [380, 160], yy_sit: [110, 185], yy_tilt: [104, 190] };
/** 步道的遠邊與近邊。 */
const PATH = { top: 800, bottom: 968 };
/** 告示牌：停下來時的左緣、底邊（遠邊的路旁），最大寬高（標準 v2），寫字的內距。 */
const BOARD = { x: 930, bottom: 700, w: 700, h: 370 };
const PAD = { x: 42, top: 58, bottom: 30 };
/** 電線（歌詞停在上面）：兩端與下垂量。 */
const WIRE = { x0: -40, y0: 196, x1: 1960, y1: 214, sag: 58 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const LABEL = '社區公告 · NOTICE';
const SPRITES = [
  'xw_dogwalk_1', 'xw_dogwalk_2', 'xw_dogwalk_stop', 'mt_dogwalk_1', 'mt_dogwalk_2', 'mt_dogwalk_point', 'mt_dogwalk_stop',
  'pp_dogwalk_1', 'pp_dogwalk_2', 'pp_sniff', 'pp_beg', 'qq_dogwalk_1', 'qq_dogwalk_2', 'qq_sniff', 'qq_stand',
  'yy_walk', 'yy_stand', 'yy_sit', 'yy_tilt',
];

/** 走路的速度 w(t)：0 = 停、1 = 走；煞車與起步各半拍。 */
interface Phase { t0: number; t1: number }
/** 一次「狗在樹下停一拍」：哪隻、幾點停下、停多久、多久追回來。 */
interface Sniff { who: 'pp' | 'qq'; t0: number; t1: number; t2: number }

export default class DogWalk extends Scene {
  paper = paperBG();
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  walks: Phase[] = [];
  stopT = 0;
  /** 鏡頭走了多遠（px）：從窗格開始前一秒起，每 1/120 秒一格積分好。 */
  xs: Float32Array = new Float32Array(1);
  x0t = 0;
  sniffs: Sniff[] = [];
  trees: number[] = [];
  /** 停下來那棵樹（告示牌左邊）的世界座標。 */
  stopTree = 0;
  boardX = 0;
  note: Note | null = null;
  board = { x: BOARD.x, y: BOARD.bottom - BOARD.h, w: BOARD.w, h: BOARD.h };
  lyricSize = 50;
  msgT0 = 0;

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('一位賓客' + INVITE + LABEL);
    this.track(await loadPuppets(SPRITES));
    const s = this.ctx.start, e = this.ctx.end, bp0 = au.beatPeriod(s);
    const barDur = bp0 * 4, dur = e - s;
    // 走進來 → 停在告示牌前（小節線）→ 窗格有五小節以上時，最後一小節再走出去
    this.stopT = barAfter(au, s + Math.min(barDur * 1.2, dur * 0.3));
    this.walks = [{ t0: -1e9, t1: this.stopT }];
    if (dur > barDur * 4.6) this.walks.push({ t0: au.timeOfBar(Math.round(au.barAt(e)) - 1), t1: 1e9 });
    // 鏡頭的位置：速度（一拍一步）積分
    const step = 1 / 120;
    this.x0t = s - 1;
    const n = Math.ceil((e + 1 - this.x0t) / step) + 2;
    this.xs = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      const t = this.x0t + i * step;
      this.xs[i] = this.xs[i - 1]! + (SZ * 0.36 / au.beatPeriod(t)) * this.walkK(t) * step;
    }
    // 走的時候每小節一次，兩隻狗輪流在拍點上停在一棵樹下聞一拍，下一拍追回來；樹就種在那裡
    let k = 0;
    for (const w of this.walks) {
      let b = Math.ceil(au.beatAt(Math.max(s + 0.3, w.t0 + bp0)) - 1e-6);
      for (;;) {
        const t0 = au.timeOfBeat(b);
        if (t0 > Math.min(e, w.t1) - bp0 * 2) break;
        if (Math.abs(au.barAt(t0) - Math.round(au.barAt(t0))) < 0.05 || b === Math.ceil(au.beatAt(Math.max(s + 0.3, w.t0 + bp0)) - 1e-6)) {
          const who: 'pp' | 'qq' = k++ % 2 ? 'pp' : 'qq';
          this.sniffs.push({ who, t0, t1: au.timeOfBeat(b + 1), t2: au.timeOfBeat(b + 2) });
          this.trees.push(this.camX(t0) + DOG_X[who] + 52);
          b += 4;
        } else b++;
      }
    }
    // 告示牌停在畫面右邊；它左邊一棵樹（停下來時 QQ 去聞的那棵）；其他地方補幾棵
    this.boardX = BOARD.x + this.camX(this.stopT);
    this.stopTree = this.boardX - 70;
    this.trees.push(this.stopTree);
    for (let x = this.camX(s) - 300; x < this.camX(e) + W + 300; x += 620) {
      if (this.trees.every((tx) => Math.abs(tx - x) > 260) && Math.abs(x - this.boardX - BOARD.w / 2) > BOARD.w / 2 + 160) this.trees.push(x);
    }
    // 告示牌上的留言：標準 v2 的字級；牌子的寬高跟著留言（左緣、底邊固定）
    const c = this.fg.ctx;
    const w = BOARD.w - PAD.x * 2, hmax = BOARD.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const bh = Math.min(BOARD.h, Math.max(220, PAD.top + this.note.height + PAD.bottom + 14));
    const bw = Math.min(BOARD.w, tightenNote(c, this.note, 340) + PAD.x * 2);
    this.board = { x: BOARD.x, y: BOARD.bottom - bh, w: bw, h: bh };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.msgT0 = Math.max(beatAfter(au, s + 0.4), this.stopT - bp0 * 2);
  }

  /** 走路的程度（0..1）：起步、煞車各半拍的緩動。 */
  private walkK(t: number) {
    const bp = this.ctx.audio.beatPeriod(t);
    let k = 0;
    for (const w of this.walks) k = Math.max(k, prog(t, w.t0 - bp * 0.5, w.t0, ease.inOutCubic) * (1 - prog(t, w.t1 - bp * 0.5, w.t1, ease.inOutCubic)));
    return k;
  }

  /** 鏡頭在 t 走到哪裡（世界座標 px）。 */
  private camX(t: number) {
    const u = clamp((t - this.x0t) * 120, 0, this.xs.length - 1.001);
    const i = Math.floor(u);
    return lerp(this.xs[i]!, this.xs[i + 1]!, u - i);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.paper.render(renderer, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const ink = inkFor(true);
    const cam = this.camX(t);
    const rv = prog(t, s, s + 0.5, ease.inOutCubic);

    this.drawSkyline(c, ink, cam);
    this.drawWire(c, ink, cam);
    for (const tx of this.trees) this.tree(c, ink, tx - cam, t, tx);
    this.drawBoard(c, ink, t, this.boardX - cam);
    this.drawPath(c, ink, cam);
    // 遠的那一道：宣文與 QQ；近的那一道：孟庭與芃芃（先畫遠的）
    this.drawPair(c, t, 'xw', ['yy', 'qq']);
    this.drawPair(c, t, 'mt', ['pp']);
    this.drawGrass(c, cam);
    const ly = lyricAt(lyrics, t);
    if (ly) this.perched(c, ly.line, t, ly.k * rv);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：跟著走的時候跟著步伐輕輕上下，停下來慢慢推近告示牌（最多 1.03 倍）
    const settle = prog(t, this.stopT, this.stopT + (this.ctx.end - this.stopT) * 0.8, ease.inOutCubic);
    const B = this.board;
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.24, grain: 0.045, ca: 0.5, zoom: 1 + 0.03 * settle, shake: [-(B.x + B.w / 2 - W / 2) * 0.03 * settle, 1.5 * Math.sin(f.beat * Math.PI * 2) * this.walkK(t)] };
  }

  /** 遠處的街景：一排矮樓的輪廓（很淡的線），跟著鏡頭慢慢捲（視差 0.2）。 */
  private drawSkyline(c: CanvasRenderingContext2D, ink: Ink, cam: number) {
    const off = -((cam * 0.2) % 2400);
    c.save();
    c.strokeStyle = rgba('sepia', 0.16); c.lineWidth = 1.4;
    c.beginPath();
    for (let rep = -1; rep <= 1; rep++) {
      let x = off + rep * 2400;
      for (let k = 0; k < 20 && x < W + 200; k++) {
        const w = 70 + 90 * hash(k, 3), h = 70 + 150 * hash(k, 4);
        if (x + w > -50) { c.moveTo(x, PATH.top - 60); c.lineTo(x, PATH.top - 60 - h); c.lineTo(x + w, PATH.top - 60 - h); c.lineTo(x + w, PATH.top - 60); }
        x += w + 10 + 40 * hash(k, 5);
      }
    }
    c.stroke();
    c.restore();
    // 河堤：遠處一條淡淡的水平線
    inkLine(c, [{ x: 0, y: PATH.top - 60 }, { x: W, y: PATH.top - 62 }], { ink, w: 0.5, color: rgba('sepia', 0.35), seed: 3 });
  }

  /** 電線：兩條（上面那條是空的），電線桿跟著鏡頭經過。 */
  private drawWire(c: CanvasRenderingContext2D, ink: Ink, cam: number) {
    c.save();
    c.strokeStyle = rgba('sepia', 0.45); c.lineWidth = 1.6;
    for (const dy of [0, -34]) {
      c.beginPath();
      for (let x = WIRE.x0; x <= WIRE.x1; x += 40) { const y = this.wireY(x) + dy; x === WIRE.x0 ? c.moveTo(x, y) : c.lineTo(x, y); }
      c.stroke();
    }
    c.restore();
    // 電線桿：很遠才一根（跟著鏡頭經過），只畫到電線上面一點
    const gap = 2600, off = ((-cam * 0.9) % gap + gap) % gap - 200;
    for (let x = off; x < W + 200; x += gap) inkLine(c, [{ x, y: 120 }, { x: x + 3, y: PATH.top - 40 }], { ink, w: 1.4, color: rgba('sepia', 0.5), seed: 7 });
  }

  private wireY(x: number) { const u = (x - WIRE.x0) / (WIRE.x1 - WIRE.x0); return lerp(WIRE.y0, WIRE.y1, u) + WIRE.sag * 4 * u * (1 - u); }

  /** 一棵路樹（在步道遠邊）：樹幹、三團樹冠（拍點上被風推一下）；很淡。 */
  private tree(c: CanvasRenderingContext2D, ink: Ink, x: number, t: number, seed: number) {
    if (x < -260 || x > W + 260) return;
    const au = this.ctx.audio, g = beatKick(au, t, 0.5) * 6;
    const base = PATH.top + 4, top = base - 360;
    inkPoly(c, [{ x: x - 12, y: base }, { x: x + 12, y: base }, { x: x + 8, y: top + 150 }, { x: x - 7, y: top + 150 }], { ink, fill: mixRgba('paper', 'fur', 0.3), w: 0.8, seed });
    const blobs: [number, number, number][] = [[-70, 120, 95], [70, 110, 100], [0, 50, 120]];
    for (const [dx, dy, r] of blobs) inkEllipse(c, x + dx + g * (1 - dy / 160), top + dy, r, r * 0.82, 0, { ink, fill: mixRgba('paper', 'gingham', 0.28), w: 0.8, seed: seed + dx, color: rgba('sepia', 0.7) });
  }

  /** 紅磚步道：遠邊、近邊兩條線，中間三排錯開的磚縫（跟著鏡頭捲）；磚是淡淡的紅磚色。 */
  private drawPath(c: CanvasRenderingContext2D, ink: Ink, cam: number) {
    c.fillStyle = mixRgba('paper', 'collar', 0.12);
    c.fillRect(0, PATH.top, W, PATH.bottom - PATH.top);
    inkLine(c, [{ x: 0, y: PATH.top }, { x: W, y: PATH.top }], { ink, w: 0.9, seed: 11 });
    inkLine(c, [{ x: 0, y: PATH.bottom }, { x: 1340, y: PATH.bottom }], { ink, w: 0.9, seed: 12 });
    c.save();
    c.strokeStyle = rgba('sepia', 0.2); c.lineWidth = 1.3;
    c.beginPath();
    const rows = 4, rh = (PATH.bottom - PATH.top) / rows;
    // 右下角 HUD（x ≥ 1360、y ≥ 830）裡不畫磚縫，那一塊只留淡淡的磚色
    const hud = (y: number) => (y > 826 ? 1340 : W);
    for (let r = 1; r < rows; r++) { const y = PATH.top + r * rh; c.moveTo(0, y); c.lineTo(hud(y), y); }
    for (let r = 0; r < rows; r++) {
      // 越近的磚越長（透視）
      const bw = 70 + r * 12, off = ((-cam - (r % 2) * bw / 2) % bw + bw) % bw;
      const y0 = PATH.top + r * rh, y1 = y0 + rh;
      for (let x = off - bw; x < hud(y1) + 3; x += bw) { c.moveTo(x, y0 + 2); c.lineTo(x - 3, y1 - 2); }
    }
    c.stroke();
    c.restore();
  }

  /** 步道近邊外的草（最前面，捲得最快）。 */
  private drawGrass(c: CanvasRenderingContext2D, cam: number) {
    const off = -((cam * 1.15) % 1200);
    c.save();
    c.strokeStyle = rgba('sepia', 0.4); c.lineWidth = 1.2;
    c.beginPath();
    for (let rep = -1; rep <= 1; rep++) {
      for (let k = 0; k < 40; k++) {
        const x = off + rep * 1200 + k * 30 + 12 * hash(k, 9);
        if (x < -20 || x > W + 20) continue;
        const y = PATH.bottom + 6 + 60 * hash(k, 10), h = 10 + 8 * hash(k, 11);
        if (x > 1340 && y > 820) continue;
        c.moveTo(x, y); c.lineTo(x + 3, y - h); c.moveTo(x + 5, y); c.lineTo(x + 9, y - h * 0.8);
      }
    }
    c.stroke();
    c.restore();
  }

  /**
   * 告示牌：綠色木框、上面一個小小的斜屋頂、兩根柱子，裡面是軟木板，一張公告紙用紅色圖釘釘著；
   * 左上角一行小字。留言寫在公告紙上（逐字寫出來、寫完署名淡入）。
   */
  private drawBoard(c: CanvasRenderingContext2D, ink: Ink, t: number, x: number) {
    const B = { ...this.board, x };
    if (x > W + 40 || x + B.w < -40) return;
    const green = mixRgba('paper', 'gingham', 0.55), fr = 16;
    // 柱子
    for (const px of [B.x + 40, B.x + B.w - 40]) inkPoly(c, [{ x: px - 9, y: B.y + B.h }, { x: px + 9, y: B.y + B.h }, { x: px + 9, y: PATH.top + 2 }, { x: px - 9, y: PATH.top + 2 }], { ink, fill: green, w: 0.8, seed: 21 });
    // 小屋頂
    inkPoly(c, [{ x: B.x - fr - 22, y: B.y - fr }, { x: B.x + B.w / 2, y: B.y - fr - 46 }, { x: B.x + B.w + fr + 22, y: B.y - fr }], { ink, fill: mixRgba('paper', 'collar', 0.35), w: 0.9, seed: 22 });
    // 框與軟木板
    inkPoly(c, [{ x: B.x - fr, y: B.y - fr }, { x: B.x + B.w + fr, y: B.y - fr }, { x: B.x + B.w + fr, y: B.y + B.h + fr }, { x: B.x - fr, y: B.y + B.h + fr }], { ink, fill: green, w: 1, seed: 23 });
    c.fillStyle = mixRgba('paper', 'fur', 0.3);
    c.fillRect(B.x, B.y, B.w, B.h);
    // 公告紙（比軟木板小一圈，歪一點點的影子）
    const P = { x: B.x + 14, y: B.y + 12, w: B.w - 28, h: B.h - 24 };
    c.fillStyle = rgba('sepia', 0.12);
    c.fillRect(P.x + 6, P.y + 7, P.w, P.h);
    inkPoly(c, [{ x: P.x, y: P.y }, { x: P.x + P.w, y: P.y + 1 }, { x: P.x + P.w - 1, y: P.y + P.h }, { x: P.x + 1, y: P.y + P.h - 1 }], { ink, fill: rgba('bone'), w: 0.6, seed: 24 });
    for (const px of [P.x + 20, P.x + P.w - 20]) {
      c.fillStyle = rgba('collar'); c.beginPath(); c.arc(px, P.y + 16, 7, 0, Math.PI * 2); c.fill();
      c.fillStyle = rgba('bone', 0.6); c.beginPath(); c.arc(px - 2, P.y + 14, 2, 0, Math.PI * 2); c.fill();
    }
    c.font = font(F.hei(500), 17);
    c.letterSpacing = '6px';
    c.fillStyle = rgba('sepia', 0.5);
    c.fillText(LABEL, B.x + PAD.x, B.y + 44);
    c.letterSpacing = '0px';
    const n = this.note;
    if (!n) return;
    const total = msgChars(n.fit);
    const per = clamp(1.6 / Math.max(1, total), 0.03, 0.1);
    const done = this.msgT0 + total * per;
    const top = B.y + PAD.top, h = B.h - PAD.top - PAD.bottom;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.6);
    drawNote(c, n, B.x + PAD.x, top + Math.max(0, (h - n.height) * 0.45), {
      chars: this.msg ? (t - this.msgT0) / per : Infinity, color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.62), sigColor: rgba('sepia', 0.74), sigK: prog(t, done + 0.1, done + 0.5),
    });
    c.restore();
  }

  /** 狗現在落後原位多少（px）：在樹下停一拍時停在原地（鏡頭還在走），下一拍小跑追回來。 */
  private lag(t: number, who: Dog) {
    let lag = 0, state: 'walk' | 'sniff' | 'catch' = 'walk';
    for (const sn of this.sniffs) {
      if (sn.who !== who || t < sn.t0 || t > sn.t2) continue;
      const stopped = this.camX(Math.min(t, sn.t1)) - this.camX(sn.t0);
      if (t < sn.t1) { lag = stopped; state = 'sniff'; }
      else { lag = stopped * (1 - ease.inOutCubic((t - sn.t1) / (sn.t2 - sn.t1))); state = 'catch'; }
    }
    return { lag, state };
  }

  /**
   * 一個人和他牽的狗：人走路（一拍一步）或停下來；每隻狗照自己的樣子走或停（drawDog），牽繩從人手上的握把連到每隻狗的脖子。
   * 停下來時：宣文低頭看狗；孟庭先指著告示牌、再低頭看芃芃。
   */
  private drawPair(c: CanvasRenderingContext2D, t: number, p: 'xw' | 'mt', dogs: readonly Dog[]) {
    const au = this.ctx.audio;
    const far = p === 'xw';
    const y = far ? LANE_B : LANE_F, sc = far ? FAR_K : 1;
    const px = far ? AL_X : OM_X;
    const en = puppetIn(t, this.ctx.start + (far ? 0.12 : 0.04), 0.42);
    if (en.alpha <= 0) return;
    const wk = this.walkK(t);
    const walking = wk > 0.35;
    const bp = au.beatPeriod(t);
    // ---- 人
    const po: PuppetOpts = { h: SZ, scale: sc, spin: en.spin, alpha: en.alpha };
    let person: string;
    const lift = walking ? hop(au.beatAt(t)) * 7 * wk : 0;
    puppetShadow(c, p, px, y, { h: SZ * sc, lift, alpha: 0.3 * en.alpha, color: '70,45,25' });
    if (walking) person = drawCycle(c, au, t, [`${p}_dogwalk_1`, `${p}_dogwalk_2`], 1, px, y - lift, po);
    else {
      const since = t - this.stopT;
      person = p === 'xw' ? 'xw_dogwalk_stop' : since < bp * 6 && since > -bp ? 'mt_dogwalk_point' : 'mt_dogwalk_stop';
      drawPuppet(c, person, px, y, { ...po, squash: breathe(t, 0.01, 3.1, far ? 0 : 0.4) + 0.012 * beatKick(au, t, 0.3) });
    }
    const hand = puppetPoint(person, 'hand', px, y - lift, po) ?? { x: px + SZ * 0.24, y: y - SZ * 0.43 };
    // ---- 狗（先畫後面的；牽繩最後畫，蓋在狗的上面）
    const necks = dogs.map((d) => this.drawDog(c, t, d, y, sc, en, walking, wk));
    for (const neck of necks) leash(c, hand, neck, { ink: inkFor(true), t, h: SZ, slack: Math.max(8, Math.hypot(neck.x - hand.x, neck.y - hand.y) * 0.12) });
    // 進場：仙女棒的火花在腳邊
    if (en.k < 1) {
      sparkHead(this.glow, px, y - 6, t, 0.7);
      sparkParticles(this.glow, t, () => ({ x: px, y: y - 6 }), { rate: 50, life: 0.25, speed: 140, seed: far ? 1 : 2 });
    }
  }

  /**
   * 一隻狗，回傳牠脖子的畫面座標（接牽繩）。
   *  - 博美走路：一拍兩步、一步一彈；在樹下停一拍聞（lag），下一拍小跑追回來。
   *  - 元元走路：一拍一步（大狗走得從容），走路與站的圖交替，身體起伏小一點。
   *  - 停下來：QQ 跑到告示牌旁邊那棵樹下聞；芃芃在孟庭腳邊（每小節換一次：抬頭看她 → 低頭聞草）；
   *    元元先站著望向告示牌，兩拍後坐下，之後每隔一小節歪頭看公告。
   */
  private drawDog(c: CanvasRenderingContext2D, t: number, d: Dog, y: number, sc: number, en: { spin: number; alpha: number }, walking: boolean, wk: number): Pt {
    const au = this.ctx.audio, bp = au.beatPeriod(t);
    const dx0 = DOG_X[d];
    const doS = sc * DOG_S;
    const dogO: PuppetOpts = { h: SZ, scale: doS, spin: en.spin, alpha: en.alpha };
    let dx = dx0, name: string, bob = 0;
    if (walking) {
      if (d === 'yy') {
        bob = hop(au.beatAt(t)) * 4 * wk;
        name = Math.floor(au.beatAt(t)) % 2 ? 'yy_stand' : 'yy_walk';
      } else {
        const { lag, state } = this.lag(t, d);
        dx = dx0 - lag;
        if (state === 'sniff') name = `${d}_sniff`;
        else {
          bob = hop(au.beatAt(t), 2) * 6 * wk;
          name = [`${d}_dogwalk_1`, `${d}_dogwalk_2`][Math.floor(au.beatAt(t) * (state === 'catch' ? 3 : 2)) % 2]!;
        }
      }
    } else {
      const cam = this.camX(t);
      const since = t - this.stopT;
      if (d === 'qq') {
        const tx = this.stopTree - cam - 30;
        const u = clamp(since / (bp * 1.5));
        dx = lerp(dx0, tx, ease.inOutCubic(u));
        name = u < 1 ? [`${d}_dogwalk_1`, `${d}_dogwalk_2`][Math.floor(au.beatAt(t) * 2) % 2]! : Math.floor(au.barAt(t)) % 2 ? 'qq_stand' : 'qq_sniff';
        if (u < 1) bob = hop(au.beatAt(t), 2) * 6;
      } else if (d === 'yy') {
        name = since < bp * 2 ? 'yy_stand' : Math.floor(au.barAt(t)) % 2 ? 'yy_tilt' : 'yy_sit';
      } else {
        dx = dx0 + 10;
        name = Math.floor(au.barAt(t)) % 2 ? 'pp_sniff' : 'pp_beg';
      }
    }
    puppetShadow(c, d, dx, y, { h: SZ * doS, lift: bob, alpha: 0.32 * en.alpha, color: '70,45,25' });
    const sq = 0.03 * beatKick(au, t, 0.25) + breathe(t, 0.012, d === 'yy' ? 2.2 : 1.2, d === 'qq' ? 0 : 0.5);
    drawPuppet(c, name, dx, y - bob, { ...dogO, squash: sq });
    const yn = YY_NECK[name];
    const neck = yn ? puppetPointAt(name, yn, dx, y - bob, dogO) : null;
    return neck ?? puppetPoint(name, 'neck', dx, y - bob, dogO) ?? neckGuess(name, dx, y - bob, dogO);
  }

  /**
   * 歌詞停在電線上：一個字（英文一個字詞）一格，字的底貼著電線（像停在電線上的麻雀）；
   * 唱到的那個字跳一下、亮成訊號色；唱完墨色；還沒唱三成透明。太長就縮字（不小於 40）。
   */
  private perched(c: CanvasRenderingContext2D, line: Line, t: number, alpha: number) {
    if (alpha <= 0.01) return;
    const words = line.words.filter((w) => w.w.trim());
    if (!words.length) return;
    const fam = F.archivo(100, this.msg ? 600 : 700);
    let size = this.lyricSize;
    const avail = 1640;
    const widths = (sz: number) => { c.font = font(fam, sz); return words.map((w) => c.measureText(w.w.trim()).width + sz * 0.22); };
    let ws = widths(size);
    let total = ws.reduce((a, b) => a + b, 0);
    if (total > avail) { size = Math.max(40, Math.floor((size * avail) / total)); ws = widths(size); total = ws.reduce((a, b) => a + b, 0); }
    c.save();
    c.globalAlpha = alpha;
    c.font = font(fam, size);
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    let x = W / 2 - Math.min(total, avail) / 2;
    words.forEach((w, i) => {
      const cx = x + ws[i]! / 2;
      x += ws[i]!;
      const p = Lyrics.wordProgress(w, t);
      const jump = p > 0 ? Math.sin(Math.PI * clamp((t - w.start) / 0.22)) * size * 0.35 : 0;
      c.fillStyle = p >= 1 ? rgba('sepia', this.msg ? 0.82 : 0.94) : p > 0 ? rgba('signal') : rgba('sepia', 0.26);
      c.fillText(w.w.trim(), cx, this.wireY(cx) - 3 - jump);
    });
    c.restore();
  }
}

/** 沒量脖子道具點的狗圖：照外框估（側面朝右：身體前三分之一、上面四成）。 */
/**
 * 圖上的一點（圖的 px）→ 畫面座標：跟 drawPuppet 同一套縮放（腳底錨點、身高），加上翻面（spin）的水平縮；
 * 沒算壓扁（牽繩的端點差一兩 px 看不出來）。給沒有量道具點的圖用（元元的脖子）。
 */
function puppetPointAt(name: string, pt: readonly [number, number], x: number, y: number, o: PuppetOpts): Pt | null {
  const info = puppetInfo(name);
  if (!info) return null;
  const k = puppetHeight(name, o.h, o.scale ?? 1) / info.ref;
  const sx = Math.cos((o.spin ?? 0) * Math.PI * 2) * (o.flip ? -1 : 1);
  return { x: x + (pt[0] - info.ax) * k * sx, y: y + (pt[1] - info.ay) * k };
}

function neckGuess(name: string, x: number, y: number, o: PuppetOpts): Pt {
  const [bx, by, bw, bh] = puppetBox(name, x, y, o);
  const fx = o.flip ? 0.3 : 0.7;
  return { x: bx + bw * fx, y: by + bh * 0.42 };
}
