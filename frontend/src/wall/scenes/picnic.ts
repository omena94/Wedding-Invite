// 野餐（亮、date）：草地上的格紋野餐墊、籐籃、一盤三明治，宣文和孟庭坐在墊子上；芃芃偷偷摸摸爬過來偷三明治、QQ 在旁邊討吃的、
// 元元乖乖坐在墊子右邊。
// 角色是 Codex 畫的紙偶（_puppet.ts）。
//  - 第一個小節線起一陣風：**寫著留言的餐巾紙被吹起來**，翻著筋斗飛到右上方的空中，停在那裡隨風輕輕飄（留言就在餐巾紙上）；
//    宣文伸手去抓（撲空）、孟庭指著它大笑。**元元（大狗）在下一拍高高跳起來往右上方咬（最高點在拍點，也撲空）**——
//    博美跳不了那麼高；落地後歪頭看著天上的餐巾紙兩拍，再坐回去。草跟著拍子被風吹得一波一波。
//  - 芃芃：從左邊壓低身子一拍一步地爬過來（拍點上往前挪一下），**下一個小節線剛好叼走盤子上的一塊三明治**，
//    得意地往右後方跑走；QQ 晚一拍追上去、元元坐著仰頭叫一聲（在拍點，穩重的大哥在喊「小偷！」）。
//    四小節一輪，窗格長的話再來一次（盤子上的三明治少一塊）。
//  - 歌詞沿著一道風（天空左上方一條會起伏的弧線）逐字亮，照跟唱規則；比留言小一級。
//  - **焦點是主打留言**：餐巾紙（米白、四邊一圈小格紋）照「留言尺寸與版面比例標準 v2」：字 40～60、紙最大 700 × 380，
//    飛到之後一個字一個字寫上去、署名淡入。字先畫在一張暫存畫布上，飄的時候整張貼圖轉（不用每格重新光柵化斜的字）。
//    沒有留言時餐巾紙上寫邀請、字淡，歌詞變主角。
//  - 鏡頭：跟著餐巾紙慢慢往右上抬一點。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { lyricAt, barAfter, sparkHead, sparkParticles, msgChars } from './_motifs';
import { inkFor, paperBG, inkLine, inkPath, inkPoly, inkEllipse, hatch, lyricOnPath, drawNote, type Pt, type Note } from './_couple';
import { loadPuppets, drawPuppet, drawPick, drawCycle, puppetShadow, puppetIn, breathe, beatKick, landSquash, hop, jumpArc, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { INVITE } from './_c3';

export const spec: PlateSpecDecl = { group: 'couple', family: 'date', paper: true, energy: [0.25, 0.9], bars: [4, 8] };

const SZ = 460, DOG_S = 1.3;
/** 坐著的人：Codex 畫的坐姿比站姿的比例大一點（坐著快跟站著一樣高），縮回來才不會比狗大太多。 */
const SIT_S = 0.8;
const HORIZON = 612;
/** 野餐墊（梯形：遠的一邊窄、近的一邊寬）。 */
const MAT = { farY: 772, nearY: 978, far: [470, 1180], near: [300, 1320] };
const AL = { x: 600, y: 902 }, OM = { x: 890, y: 890 };
const PLATE = { x: 760, y: 944 };
const BASKET = { x: 420, y: 846 };
const QQ_BEG = { x: 1060, y: 906 };
/** 芃芃叼著三明治跑去的遠處草地（右後方，在餐巾紙下面、右下角 HUD 上面）：繞圈的右端、左右幅度、遠處的縮小。 */
const FAR = { x: 1700, y: 700, rx: 150, s: 0.6 };
/** 元元坐的地方（墊子右邊的草地，比 QQ 前面一點）、跳多高、往右跳多遠。三隻狗用同一個場景尺度。 */
const YY = { x: 1225, y: 976, jump: 118, dx: 40 };
/** 芃芃爬的那條線（墊子前緣的草地上）與叼到三明治時站的地方。 */
const SNEAK_Y = 1000, GRAB_X = 640;
/** 餐巾紙：飄在右上方的中心、最大寬高（標準 v2）、寫字內距。 */
const NAP = { cx: 1330, cy: 330, w: 700, h: 380 };
const PAD = { x: 42, top: 40, bottom: 30 };
const SPRITES = ['xw_picnic_sit', 'xw_picnic_reach', 'mt_picnic_sit', 'mt_picnic_laugh', 'pp_picnic_sneak', 'pp_picnic_steal', 'qq_beg', 'qq_run_1', 'qq_run_2',
  'yy_sit', 'yy_jump', 'yy_tilt', 'yy_howl'];

interface Heist { start: number; grab: number; flee: number; b: number }

export default class Picnic extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  nap = { w: NAP.w, h: NAP.h };
  /** 餐巾紙的圖（紙＋字），只在出現的字數變了才重畫。 */
  napCv = new OffscreenCanvas(NAP.w + 40, NAP.h + 40);
  napChars = -1;
  gust = 0;
  heists: Heist[] = [];
  alKeys: [number, string][] = [];
  omKeys: [number, string][] = [];
  lyricSize = 52;

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('一位賓客' + INVITE);
    this.track(await loadPuppets(SPRITES));
    // 風：第一個小節線（窗格太短就下一拍）
    let tg = barAfter(au, this.ctx.start + 0.5);
    if (this.ctx.end - tg < au.beatPeriod(tg) * 3) tg = au.nextBeat(this.ctx.start + 0.4);
    this.gust = tg;
    // 偷三明治：風之後的下一個小節線叼走（窗格太短就風後兩拍），之後每四小節一輪
    const bg = Math.round(au.beatAt(tg));
    let grab = bg + (this.ctx.end - au.timeOfBeat(bg + 4) > au.beatPeriod(tg) * 3 ? 4 : 2);
    for (let k = 0; k < 6; k++) {
      const tGrab = au.timeOfBeat(grab);
      if (tGrab > this.ctx.end - 0.2) break;
      const start = Math.max(this.ctx.start + 0.15, au.timeOfBeat(grab - 8));
      this.heists.push({ start, grab: tGrab, flee: au.timeOfBeat(grab + 3), b: grab });
      grab += 16;
    }
    // 宣文：坐著吃 → 風來時伸手抓（一拍半）→ 坐回去
    const bp = au.beatPeriod(tg);
    this.alKeys = [[-1e9, 'xw_picnic_sit'], [tg - 0.03, 'xw_picnic_reach'], [tg + bp * 1.6, 'xw_picnic_sit']];
    // 孟庭：坐著 → 風來時指著餐巾紙大笑兩小節；每次三明治被偷再笑兩拍
    const om: [number, string][] = [[-1e9, 'mt_picnic_sit'], [tg + bp * 0.25, 'mt_picnic_laugh'], [tg + bp * 6, 'mt_picnic_sit']];
    for (const h of this.heists) if (h.grab > tg + bp * 6) om.push([h.grab, 'mt_picnic_laugh'], [h.grab + bp * 2, 'mt_picnic_sit']);
    om.sort((a, b) => a[0] - b[0]);
    this.omKeys = om;
    // 餐巾紙上的留言：標準 v2 的字級；紙的寬高跟著留言
    const c = this.fg.ctx;
    const w = NAP.w - PAD.x * 2, hmax = NAP.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.55, { max: 44 });
    this.nap.w = Math.min(NAP.w, Math.max(tightenNote(c, this.note, 360) + PAD.x * 2, 440));
    this.nap.h = Math.min(NAP.h, Math.max(200, PAD.top + this.note.height + PAD.bottom + 8));
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.drawBackground();
  }

  /** 不會動的：地平線、遠處一排樹、草地、格紋野餐墊、籐籃。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx, ink = inkFor(true);
    L.clear();
    // 遠處：一道緩緩起伏的山丘線、三棵樹（樹冠是幾團疊起來的圓，只留外輪廓）
    c.strokeStyle = rgba('sepia', 0.22);
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(0, HORIZON - 40);
    c.bezierCurveTo(360, HORIZON - 110, 700, HORIZON - 20, 1040, HORIZON - 70);
    c.bezierCurveTo(1340, HORIZON - 115, 1620, HORIZON - 40, W, HORIZON - 80);
    c.stroke();
    for (const [x, k, sd] of [[170, 1.15, 1], [1560, 0.95, 2], [1790, 0.62, 3]] as const) this.tree(c, x, HORIZON + 4, k, sd);
    inkLine(c, [{ x: 30, y: HORIZON }, { x: 1890, y: HORIZON + 2 }], { ink, w: 0.8, seed: 2 });
    // 草地：一點點綠、往前越來越濃
    const g = c.createLinearGradient(0, HORIZON, 0, H);
    g.addColorStop(0, mixRgba('paper', 'gingham', 0.1));
    g.addColorStop(1, mixRgba('paper', 'gingham', 0.24));
    c.fillStyle = g;
    c.fillRect(0, HORIZON, W, H - HORIZON);
    // 格紋野餐墊
    this.drawMat(c);
    // 籐籃：籃身（交叉的淡線）、提把
    const B = BASKET;
    inkPoly(c, [{ x: B.x - 70, y: B.y - 70 }, { x: B.x + 70, y: B.y - 70 }, { x: B.x + 60, y: B.y }, { x: B.x - 60, y: B.y }], { ink, fill: mixRgba('paper', 'fur', 0.35), w: 0.9, seed: 5 });
    hatch(c, [{ x: B.x - 70, y: B.y - 70 }, { x: B.x + 70, y: B.y - 70 }, { x: B.x + 60, y: B.y }, { x: B.x - 60, y: B.y }], { ink, gap: 12, angle: 0.8, color: rgba('sepia', 0.25), w: 0.4, seed: 6 });
    hatch(c, [{ x: B.x - 70, y: B.y - 70 }, { x: B.x + 70, y: B.y - 70 }, { x: B.x + 60, y: B.y }, { x: B.x - 60, y: B.y }], { ink, gap: 12, angle: -0.8, color: rgba('sepia', 0.25), w: 0.4, seed: 7 });
    inkPath(c, [{ x: B.x - 56, y: B.y - 70 }, { x: B.x - 40, y: B.y - 150 }, { x: B.x + 40, y: B.y - 150 }, { x: B.x + 56, y: B.y - 70 }], { ink, w: 1.1, seed: 8 });
    L.upload();
  }

  /** 一棵遠處的樹：先畫每一團的外框、再用紙色把每一團填起來（蓋掉重疊處的線），只剩整個樹冠的外輪廓；下緣一點排線陰影。 */
  private tree(c: CanvasRenderingContext2D, x: number, y: number, k: number, seed: number) {
    const ink = inkFor(true, { line: rgba('sepia', 0.45) });
    const top = y - 330 * k;
    inkLine(c, [{ x: x - 10 * k, y }, { x: x - 6 * k, y: top + 150 * k }], { ink, w: 0.9, seed });
    inkLine(c, [{ x: x + 10 * k, y }, { x: x + 6 * k, y: top + 150 * k }], { ink, w: 0.9, seed: seed + 1 });
    const blobs: [number, number, number][] = [[0, 70, 100], [-78, 118, 72], [80, 112, 78], [-20, 150, 84], [40, 40, 70]];
    c.save();
    c.strokeStyle = rgba('sepia', 0.4);
    c.lineWidth = 2.2;
    for (const [dx, dy, r] of blobs) { c.beginPath(); c.ellipse(x + dx * k, top + dy * k, r * k, r * 0.82 * k, 0, 0, Math.PI * 2); c.stroke(); }
    c.fillStyle = rgba('paper');
    for (const [dx, dy, r] of blobs) { c.beginPath(); c.ellipse(x + dx * k, top + dy * k, r * k - 1.4, r * 0.82 * k - 1.4, 0, 0, Math.PI * 2); c.fill(); }
    c.restore();
    const crown = [{ x: x - 150 * k, y: top + 200 * k }, { x: x - 150 * k, y: top + 110 * k }, { x: x + 160 * k, y: top + 110 * k }, { x: x + 160 * k, y: top + 200 * k }];
    c.save();
    c.beginPath();
    for (const [dx, dy, r] of blobs) { c.moveTo(x + dx * k + r * k, top + dy * k); c.ellipse(x + dx * k, top + dy * k, r * k - 2, r * 0.82 * k - 2, 0, 0, Math.PI * 2); }
    c.clip();
    hatch(c, crown, { ink, angle: -0.9, gap: 9, w: 0.3, color: rgba('sepia', 0.14), seed });
    c.restore();
  }

  /** 格紋：直條往遠處收（透視）、橫條越遠越密，兩種半透明的條紋疊起來就是格子。 */
  private drawMat(c: CanvasRenderingContext2D) {
    const M = MAT, ink = inkFor(true);
    const quad = [{ x: M.far[0]!, y: M.farY }, { x: M.far[1]!, y: M.farY }, { x: M.near[1]!, y: M.nearY }, { x: M.near[0]!, y: M.nearY }];
    c.save();
    c.beginPath(); quad.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath();
    c.fillStyle = mixRgba('paper', 'bone', 0.5);
    c.fill();
    c.clip();
    c.fillStyle = mixRgba('gingham', 'paper', 0.25, 0.32);
    const N = 12;
    for (let i = 0; i < N; i += 2) {
      const a = i / N, b = (i + 1) / N;
      c.beginPath();
      c.moveTo(lerp(M.far[0]!, M.far[1]!, a), M.farY); c.lineTo(lerp(M.far[0]!, M.far[1]!, b), M.farY);
      c.lineTo(lerp(M.near[0]!, M.near[1]!, b), M.nearY); c.lineTo(lerp(M.near[0]!, M.near[1]!, a), M.nearY); c.closePath();
      c.fill();
    }
    const rows = 9;
    const yAt = (k: number) => M.farY + (M.nearY - M.farY) * Math.pow(k, 1.25);
    for (let i = 0; i < rows; i += 2) {
      const y0 = yAt(i / rows), y1 = yAt((i + 1) / rows);
      c.fillRect(0, y0, W, y1 - y0);
    }
    c.restore();
    inkPoly(c, quad, { ink, w: 0.9, seed: 3 });
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const bp = au.beatPeriod(t);
    this.paper.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const ink = inkFor(true);
    const rv = prog(t, s, s + 0.6, ease.inOutCubic);
    const wind = Math.exp(-Math.max(0, t - this.gust) / 1.2) * (t >= this.gust - 0.05 ? 1 : 0);

    // 雲：很淡、慢慢往右飄
    for (let i = 0; i < 3; i++) {
      const x = ((200 + i * 640 + (t - s) * 14) % 2200) - 140, y = 120 + i * 60;
      inkPath(c, [{ x, y }, { x: x + 60, y: y - 30 }, { x: x + 130, y: y - 26 }, { x: x + 190, y: y - 2 }], { ink: inkFor(true, { line: rgba('sepia', 0.25) }), w: 0.6, seed: i, t });
    }
    // 風：天空裡幾道細線（風來的那一下特別多）
    this.drawWind(c, t, wind);
    // 草：一撮一撮跟著拍子被風吹彎
    this.drawGrass(c, t, wind);

    // 歌詞：沿著天空左上方的一道風
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const path: Pt[] = [];
      for (let i = 0; i <= 48; i++) {
        const u = i / 48, x = lerp(150, 1000, u);
        path.push({ x, y: 250 + 40 * u + Math.sin(u * 5.5 + (t - s) * 1.3) * 16 });
      }
      lyricOnPath(c, ly.line, t, path, { family: F.archivo(100, this.msg ? 600 : 700), size: this.lyricSize, minSize: 40, offset: 0, alpha: ly.k * rv, unsung: rgba('sepia', 0.24), sung: rgba('sepia', this.msg ? 0.8 : 0.94), active: rgba('signal') });
    }

    // 盤子與三明治（被偷走的少一塊）
    const stolen = this.heists.filter((h) => t >= h.grab).length;
    this.drawPlate(c, 3 - Math.min(3, stolen));
    // 餐巾紙：風之前平放在盤子旁邊
    if (t < this.gust) inkPoly(c, [{ x: PLATE.x + 70, y: PLATE.y - 12 }, { x: PLATE.x + 130, y: PLATE.y - 14 }, { x: PLATE.x + 146, y: PLATE.y + 6 }, { x: PLATE.x + 82, y: PLATE.y + 8 }], { ink, fill: rgba('bone'), w: 0.6, seed: 21 });

    // ---- 人（後面）→ QQ → 芃芃（前面）
    this.drawPerson(c, t, 'xw', AL, this.alKeys, 0.05);
    this.drawPerson(c, t, 'mt', OM, this.omKeys, 0.14);
    this.drawQQ(c, t, bp);
    this.drawYuanyuan(c, t, bp);
    this.drawPenpen(c, t, bp);

    this.drawNapkin(c, t, bp);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：餐巾紙飛起來之後，慢慢往右上抬一點
    const k = ease.inOutCubic(prog(t, this.gust, this.ctx.end));
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.24, grain: 0.045, zoom: 1 + 0.03 * k, shake: [-(NAP.cx - W / 2) * 0.03 * k, -(NAP.cy + 120 - H / 2) * 0.03 * k] };
  }

  private drawWind(c: CanvasRenderingContext2D, t: number, wind: number) {
    c.save();
    c.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const period = 2.6, ph = ((t - this.ctx.start) / period + hash(i, 4)) % 1;
      const a = Math.sin(Math.PI * ph) * (0.18 + 0.5 * wind);
      if (a < 0.02) continue;
      const x0 = -200 + ph * 2300, y0 = 440 + hash(i, 5) * 260;
      c.strokeStyle = rgba('sepia', a);
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(x0, y0);
      c.bezierCurveTo(x0 + 80, y0 - 18, x0 + 150, y0 + 14, x0 + 230, y0 - 8);
      c.stroke();
    }
    c.restore();
  }

  private drawGrass(c: CanvasRenderingContext2D, t: number, wind: number) {
    const au = this.ctx.audio;
    c.save();
    c.strokeStyle = rgba('sepia', 0.4);
    c.lineWidth = 1.3;
    c.beginPath();
    for (let i = 0; i < 70; i++) {
      const x = 20 + i * 27 + hash(i, 1) * 14, y = HORIZON + 30 + Math.pow(hash(i, 2), 0.7) * 420;
      // 墊子上不長草
      const ky = (y - MAT.farY) / (MAT.nearY - MAT.farY);
      if (ky > -0.05 && ky < 1.05 && x > lerp(MAT.far[0]!, MAT.near[0]!, clamp(ky)) - 10 && x < lerp(MAT.far[1]!, MAT.near[1]!, clamp(ky)) + 10) continue;
      if (x > 1340 && y > 820) continue;
      const len = 10 + 12 * (y - HORIZON) / 400;
      // 拍點上被風推一下（一波從左到右），風來的時候彎很多
      const push = beatKick(au, t - x / 4000, 0.35) * 0.35 + wind * 0.9;
      for (const d of [-0.35, 0.1, 0.45]) {
        const ang = -Math.PI / 2 + d + push;
        c.moveTo(x + d * 6, y);
        c.quadraticCurveTo(x + d * 6 + Math.cos(ang) * len * 0.3, y - len * 0.6, x + d * 6 + Math.cos(ang) * len, y + Math.sin(ang) * len);
      }
    }
    c.stroke();
    c.restore();
  }

  /** 盤子上的三明治（三角形的白吐司、生菜邊）。 */
  private drawPlate(c: CanvasRenderingContext2D, n: number) {
    const ink = inkFor(true), P = PLATE;
    inkEllipse(c, P.x, P.y, 78, 20, 0, { ink, fill: rgba('bone'), w: 0.8, seed: 31 });
    inkEllipse(c, P.x, P.y - 2, 56, 13, 0, { ink, w: 0.4, seed: 32, color: rgba('sepia', 0.4) });
    for (let i = 0; i < n; i++) {
      const x = P.x - 40 + i * 36, y = P.y - 4;
      const tri = [{ x: x - 20, y }, { x: x + 20, y }, { x: x + 4, y: y - 34 }];
      inkPoly(c, tri, { ink, fill: mixRgba('cream', 'bone', 0.4), w: 0.7, seed: 40 + i });
      inkLine(c, [{ x: x - 16, y: y - 5 }, { x: x + 17, y: y - 5 }], { ink, w: 1.8, color: mixRgba('gingham', 'sepia', 0.2), seed: 50 + i });
    }
  }

  /** 坐在墊子上的人：照時間軸換姿勢，跟著拍子輕輕點頭；進場從側面翻正。 */
  private drawPerson(c: CanvasRenderingContext2D, t: number, who: 'xw' | 'mt', P: { x: number; y: number }, keys: [number, string][], delay: number) {
    const au = this.ctx.audio;
    const en = puppetIn(t, this.ctx.start + delay, 0.45);
    if (en.alpha <= 0) return;
    // 伸手抓／大笑的那一下往上彈一點
    let squash = breathe(t, 0.008, 3.1, who === 'xw' ? 0 : 0.4) + 0.012 * beatKick(au, t, 0.3);
    for (const [t0, n] of keys) if (n.endsWith('reach') || n.endsWith('laugh')) squash += -landSquash(t, t0, 0.07, 0.3);
    const o: PuppetOpts = { h: SZ, scale: SIT_S, squash, rot: 0.012 * Math.sin(au.beatAt(t) * Math.PI + (who === 'xw' ? 0 : 1)), pivot: 0.1, spin: en.spin, alpha: en.alpha };
    puppetShadow(c, who, P.x, P.y + 4, { h: SZ * SIT_S, wide: 1.8, alpha: 0.22 * en.alpha, color: '60,50,30' });
    drawPick(c, keys, t, P.x, P.y, o);
  }

  /** QQ：在孟庭旁邊站起來討吃的（拍點上一彈）；芃芃偷到之後晚一拍追出去，下一輪前走回來。 */
  private drawQQ(c: CanvasRenderingContext2D, t: number, bp: number) {
    const au = this.ctx.audio;
    const base: PuppetOpts = { h: SZ, scale: DOG_S };
    let h: Heist | null = null;
    for (const x of this.heists) if (t >= x.grab + bp) h = x;
    const en = puppetIn(t, this.ctx.start + 0.22, 0.42);
    if (h && t < h.grab + bp * 9) {
      const go = h.grab + bp, u = (t - go) / (bp * 3.2);
      const back = h.grab + bp * 8;
      if (t < back) {
        // 追出去：先跑到遠處的草地（三拍多），接著追著芃芃繞圈（落後半圈），偷之後第八拍回到孟庭旁邊
        let x: number, y: number, sc: number, flip = false;
        if (u <= 1) {
          x = lerp(QQ_BEG.x, FAR.x + 60, ease.inQuad(u)); y = lerp(QQ_BEG.y, FAR.y + 6, u); sc = lerp(1, FAR.s, u);
        } else {
          const p = this.farLoop(t, go + bp * 3.2, 0.5);
          x = p.x; y = p.y; sc = FAR.s; flip = p.flip;
        }
        const b = hop(au.beatAt(t), 2) * 8 * sc;
        const fade = 1 - prog(t, back - 0.12, back);
        puppetShadow(c, 'qq', x, y, { h: SZ * DOG_S * sc, lift: b, alpha: 0.25 * fade, color: '60,50,30' });
        drawCycle(c, au, t, ['qq_run_1', 'qq_run_2'], 2, x, y - b, { ...base, scale: DOG_S * sc, flip, rot: flip ? 0.1 : -0.1, alpha: fade });
        return;
      }
    }
    const back = h ? puppetIn(t, h.grab + bp * 8, 0.4) : en;
    if (back.alpha <= 0) return;
    const squash = 0.06 * beatKick(au, t, 0.25) + breathe(t, 0.02, 1.1);
    puppetShadow(c, 'qq', QQ_BEG.x, QQ_BEG.y, { h: SZ * DOG_S, alpha: 0.25 * back.alpha, color: '60,50,30' });
    drawPuppet(c, 'qq_beg', QQ_BEG.x, QQ_BEG.y, { ...base, flip: true, squash, spin: back.spin, alpha: back.alpha });
  }

  /**
   * 元元：坐在墊子右邊（拍點上輕輕點頭）。風來之後的下一拍高高跳起來往右上方咬餐巾紙（最高點在拍點、撲空），
   * 落地後歪頭看天上兩拍；每次三明治被偷，QQ 追出去的那一拍仰頭叫一聲（一拍半）。
   */
  private drawYuanyuan(c: CanvasRenderingContext2D, t: number, bp: number) {
    const au = this.ctx.audio;
    const en = puppetIn(t, this.ctx.start + 0.3, 0.42);
    if (en.alpha <= 0) return;
    const base: PuppetOpts = { h: SZ, scale: DOG_S, spin: en.spin, alpha: en.alpha };
    const apex = au.timeOfBeat(Math.round(au.beatAt(this.gust)) + 1), air = Math.min(0.32, bp * 0.6);
    const j = jumpArc(t, apex - air, apex + air, YY.jump, { crouch: 0.08, stretch: 0.1, land: 0.16 });
    // 跳的時候往右飛一點、落地後慢慢走回原位
    const dx = j.air ? YY.dx * j.u : YY.dx * (1 - ease.inOutCubic(prog(t, apex + air + bp * 2, apex + air + bp * 3)));
    const x = YY.x + (t >= apex - air ? dx : 0);
    if (j.air) {
      puppetShadow(c, 'yy', x, YY.y, { h: SZ * DOG_S, lift: -j.y, alpha: 0.25, color: '60,50,30' });
      drawPuppet(c, 'yy_jump', x, YY.y + j.y, { ...base, hide: ['ball'], squash: j.squash, rot: -0.18 * Math.sin(Math.PI * j.u), pivot: 0.5 });
      return;
    }
    let name = 'yy_sit';
    if (t > apex && t < apex + air + bp * 2) name = 'yy_tilt';
    for (const h of this.heists) { const tb = h.grab + bp; if (t >= tb && t < tb + bp * 1.5) name = 'yy_howl'; }
    const squash = j.squash + breathe(t, 0.012, 2.4, 0.7) + (name === 'yy_sit' ? 0.03 * beatKick(au, t, 0.25) : 0);
    puppetShadow(c, 'yy', x, YY.y, { h: SZ * DOG_S, alpha: 0.25 * en.alpha, color: '60,50,30' });
    drawPuppet(c, name, x, YY.y, { ...base, squash });
  }

  /**
   * 遠處草地上的追逐圈（芃芃叼著三明治在前、QQ 追在後）：一圈四拍，左右來回（sin），朝著跑的方向翻面。
   * from = 開始繞的時間，lag = 落後幾圈（QQ 0.5：在芃芃的另一邊追）。
   */
  private farLoop(t: number, from: number, lag: number): { x: number; y: number; flip: boolean } {
    const au = this.ctx.audio;
    const ph = ((au.beatAt(t) - au.beatAt(from)) / 4 - lag) * Math.PI * 2;
    return { x: FAR.x - FAR.rx + FAR.rx * Math.cos(ph), y: FAR.y + 10 * Math.sin(ph), flip: Math.sin(ph) > 0 };
  }

  /** 芃芃：一拍一步壓低身子爬過來（拍點上往前挪），小節線上叼走三明治，往右後方跑掉。 */
  private drawPenpen(c: CanvasRenderingContext2D, t: number, bp: number) {
    const au = this.ctx.audio;
    const h = [...this.heists].reverse().find((x) => t >= x.start) ?? null;
    if (!h) return;
    const base: PuppetOpts = { h: SZ, scale: DOG_S };
    if (t < h.grab) {
      // 爬：從畫面左邊外面到三明治前，每一拍挪一步（拍點上往前一送，其他時候幾乎不動）
      const b0 = au.beatAt(h.start), b1 = h.b, b = au.beatAt(t);
      const steps = Math.max(1, Math.round(b1 - b0));
      const i = Math.floor(b - b0), u = b - b0 - i;
      const k = clamp((i + ease.outCubic(clamp(u / 0.45))) / steps);
      const x = lerp(-160, GRAB_X, k);
      const squash = 0.05 * Math.exp(-u / 0.15);
      puppetShadow(c, 'pp', x, SNEAK_Y, { h: SZ * DOG_S, alpha: 0.25, color: '60,50,30' });
      drawPuppet(c, 'pp_picnic_sneak', x, SNEAK_Y, { ...base, squash });
      return;
    }
    // 叼到了：往右後方跑（越跑越遠、越小），三拍跑到遠處的草地，接著在那裡繞圈（QQ 追著牠繞），下一輪開始前跑出畫面
    const u = (t - h.grab) / (h.flee - h.grab);
    const next = this.heists[this.heists.indexOf(h) + 1];
    if (next && t >= next.start) return;
    let x: number, y: number, sc: number, flip = false;
    if (u <= 1) {
      x = lerp(GRAB_X, FAR.x, ease.inQuad(u)); y = lerp(SNEAK_Y, FAR.y, u); sc = lerp(1, FAR.s, u);
    } else {
      const p = this.farLoop(t, h.flee, 0);
      x = p.x; y = p.y; sc = FAR.s; flip = p.flip;
    }
    const b = hop(au.beatAt(t), 2) * 10 * sc;
    const squash = u < 0.15 ? landSquash(t, h.grab, 0.14, 0.2) : 0;
    puppetShadow(c, 'pp', x, y, { h: SZ * DOG_S * sc, lift: b, alpha: 0.25, color: '60,50,30' });
    drawPuppet(c, 'pp_picnic_steal', x, y - b, { ...base, scale: DOG_S * sc, squash, flip, rot: flip ? 0.06 : -0.06 });
    // 叼到的那一下：嘴邊一圈短線（訊號色）
    const k = 1 - clamp((t - h.grab) / 0.25);
    if (k > 0) {
      const mx = GRAB_X + 130, my = SNEAK_Y - 90;
      c.save();
      c.strokeStyle = rgba('signal', k);
      c.lineWidth = 3;
      c.lineCap = 'round';
      c.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2, r0 = 26 + (1 - k) * 24;
        c.moveTo(mx + Math.cos(a) * r0, my + Math.sin(a) * r0);
        c.lineTo(mx + Math.cos(a) * (r0 + 12 * k), my + Math.sin(a) * (r0 + 12 * k));
      }
      c.stroke();
      c.restore();
    }
    void bp;
  }

  /** 把餐巾紙（紙＋出現了的字）畫到暫存畫布；字數沒變就不重畫。 */
  private paintNapkin(chars: number, sigK: number) {
    const key = chars + Math.round(sigK * 10) * 1000;
    if (key === this.napChars) return;
    this.napChars = key;
    const n = this.note!;
    const cv = this.napCv, c = cv.getContext('2d')! as unknown as CanvasRenderingContext2D;
    const w = this.nap.w, h = this.nap.h, o = 20;
    c.clearRect(0, 0, cv.width, cv.height);
    // 紙：米白、四邊一圈小格紋（跟野餐墊一樣的綠）
    c.fillStyle = mixRgba('bone', 'paper', 0.2);
    c.fillRect(o, o, w, h);
    c.fillStyle = mixRgba('gingham', 'paper', 0.3, 0.55);
    const sq = 12;
    for (let x = 0; x < w; x += sq * 2) { c.fillRect(o + x, o, sq, sq); c.fillRect(o + x + sq, o + h - sq, sq, sq); }
    for (let y = 0; y < h; y += sq * 2) { c.fillRect(o, o + y + sq, sq, sq); c.fillRect(o + w - sq, o + y, sq, sq); }
    c.strokeStyle = rgba('sepia', 0.25);
    c.lineWidth = 1;
    c.strokeRect(o + 0.5, o + 0.5, w - 1, h - 1);
    const top = o + PAD.top, room = h - PAD.top - PAD.bottom;
    drawNote(c, n, o + PAD.x, top + Math.max(0, (room - n.height) * 0.45), { chars, color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.62), sigColor: rgba('sepia', 0.74), sigK });
  }

  /** 餐巾紙：風來的時候從盤子旁邊翻著筋斗飛到右上方，停下來之後隨風輕輕飄；字在飛到之後寫上去。 */
  private drawNapkin(c: CanvasRenderingContext2D, t: number, bp: number) {
    if (!this.note || t < this.gust) return;
    const fly = bp * 1.6;
    const u = clamp((t - this.gust) / fly);
    const e = ease.outCubic(u);
    const a = { x: PLATE.x + 110, y: PLATE.y - 6 }, ctl = { x: 1120, y: 180 }, b = { x: NAP.cx, y: NAP.cy };
    const x = (1 - e) * (1 - e) * a.x + 2 * e * (1 - e) * ctl.x + e * e * b.x;
    const y = (1 - e) * (1 - e) * a.y + 2 * e * (1 - e) * ctl.y + e * e * b.y;
    const land = this.gust + fly;
    const drift = t - land;
    const bob = Math.sin(drift * 1.7) * 10 * clamp(drift / 0.6), sway = Math.sin(drift * 1.1 + 0.6) * 0.025 * clamp(drift / 0.6);
    const rot = lerp(-4.2, 0, e) + sway - 0.02;
    const sc = lerp(0.16, 1, e);
    const flipX = Math.cos(lerp(Math.PI * 3, 0, ease.outQuad(u)));
    // 字：落定之後一個字一個字寫上去
    const n = this.note;
    const t0 = land + 0.1;
    const total = msgChars(n.fit);
    const per = clamp(1.5 / Math.max(1, total), 0.03, 0.1);
    const done = t0 + total * per;
    const chars = this.msg ? Math.max(0, Math.floor((t - t0) / per)) : 9999;
    this.paintNapkin(Math.min(chars, total + 1), this.msg ? Math.round(prog(t, done + 0.1, done + 0.5) * 10) / 10 : 1);
    c.save();
    c.translate(x, y + bob);
    c.rotate(rot);
    c.scale(sc * (Math.abs(flipX) < 0.06 ? 0.06 : flipX), sc);
    // 影子（淡、往右下）
    c.fillStyle = rgba('sepia', 0.1);
    c.fillRect(-this.nap.w / 2 + 12, -this.nap.h / 2 + 16, this.nap.w, this.nap.h);
    c.drawImage(this.napCv as unknown as CanvasImageSource, -this.nap.w / 2 - 20, -this.nap.h / 2 - 20);
    c.restore();
    // 飛起來的時候幾片葉子跟著風跑
    if (u < 1) {
      for (let i = 0; i < 5; i++) {
        const k = clamp(u * 1.2 - i * 0.05);
        const lx = lerp(PLATE.x - 60 + i * 40, 1500 + i * 60, k), ly = lerp(PLATE.y - 30, 260 + i * 50, ease.outQuad(k)) + Math.sin(k * 9 + i) * 20;
        c.save();
        c.translate(lx, ly);
        c.rotate(k * 8 + i);
        c.fillStyle = mixRgba('gingham', 'sepia', 0.3, 0.6 * (1 - k));
        c.beginPath(); c.ellipse(0, 0, 9, 4, 0, 0, Math.PI * 2); c.fill();
        c.restore();
      }
      sparkHead(this.glow, x, y, t, 0.4 * (1 - u));
      sparkParticles(this.glow, t, () => ({ x, y }), { rate: 30 * (1 - u), life: 0.2, speed: 90, seed: 3 });
    }
  }
}
