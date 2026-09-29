// OK 繃（亮、work）：家裡的客廳。宣文被紙割到手指，孟庭（護理服）熟練地消毒、貼上 OK 繃、再在上面畫一顆愛心；芃芃和 QQ 坐在腳邊歪頭看。
// 角色是 Codex 畫的紙偶（_puppet.ts，work 組；狗是 base 的坐姿＋work 組的歪頭）；客廳、OK 繃、盒子用程式畫。**不畫血。**
//  - 一個小節一個步驟（窗格短時往前擠）：被紙割到（嘶！手指邊一圈小火花）→ 小節線上伸手，孟庭用棉花棒一拍點一下 →
//    小節線上貼上 OK 繃（手指上多一片米色的小 OK 繃）→ 小節線上用紅筆畫愛心（OK 繃上冒出一顆小愛心、頭上冒一顆大的）→
//    小節線上宣文舉起手指開心地看、孟庭比讚；之後每個小節線冒愛心、狗輪流彈一下。
//  - 狗狗：芃芃和 QQ 輪流歪頭（兩拍換一次），貼好的那一下兩隻一起彈一下。
//  - **焦點是主打留言**：印在前景桌上的 OK 繃盒子正面（離鏡頭近、比較大，像商品特寫；盒蓋打開、露出幾片 OK 繃），
//    深墨字、署名；照「留言尺寸與版面比例標準 v2」：字 40～60、盒面最大 560 × 400，放在畫面左下，高度跟著留言長短。
//    盒子上只有一行小小的「OK 繃 · 20 片入」。沒有留言時盒子印邀請、字淡，歌詞變主角。
//  - 歌詞寫在右上的牆上，比留言小一級（標準 v2：40～52）。鏡頭：慢慢推近兩個人的手。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric } from './_motifs';
import { inkFor, inkLine, inkPoly, inkRect, hatch, paperBG, heartPop, type Pt, type Note } from './_couple';
import { loadPuppets, drawPuppet, drawPick, pick, puppetPoint, puppetShadow, breathe, beatKick, landSquash, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { INVITE, enter, writeNote, barsIn } from './_c7';

export const spec: PlateSpecDecl = { group: 'couple', family: 'work', paper: true, energy: [0.2, 0.8], bars: [4, 8] };

const FLOOR = 880;
const SZ = 530;
const AL_X = 920;
/** 狗坐的位置：芃芃在宣文左邊、QQ 在兩個人中間（手底下）；放大一點（遠處的桌子也要認得出來）。 */
const PP_X = 740, DOG_S = 1.15;
/** 前景的桌子（左下）與桌上的 OK 繃盒：盒子正面的最大範圍（底邊固定在桌面上、高度跟著留言）與寫字的內距。 */
const TABLE_Y = 930;
const BOX = { x: 120, w: 560, h: 400 };
const PAD = { x: 36, top: 92, bottom: 26 };
/** 右上牆上的歌詞。 */
const WALL = { x: 800, y: 150, w: 900 };
const POSES = ['xw_work_ouch', 'xw_work_hand', 'xw_work_finger', 'mt_work_idle_front', 'mt_work_swab', 'mt_work_press', 'mt_work_pen', 'mt_work_thumb',
  'pp_sit', 'qq_sit', 'pp_work_tilt', 'qq_work_tilt'];

export default class Bandaid extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  box = { x: BOX.x, y: TABLE_Y - BOX.h, w: BOX.w, h: BOX.h };
  lyricSize = 52;
  omX = 1180;
  /** 手指（伸出去的那隻）在畫面上的位置；割到的時候舉在胸前的手指。 */
  finger: Pt = { x: 0, y: 0 };
  ouchAt: Pt = { x: 0, y: 0 };
  /** 事件：割到、消毒、貼、畫愛心、舉手指。 */
  tCut = 0;
  tSwab = 0;
  tPress = 0;
  tPen = 0;
  tDone = 0;
  /** 舉手指之後的每個小節線：兩人頭上冒愛心、狗輪流彈一下、孟庭輪流比讚／站著（窗格長時後半段也有事）。 */
  after: number[] = [];
  alKeys: [number, string][] = [];
  omKeys: [number, string][] = [];
  msgT0 = 0;

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('OK 繃 · 20 片入一位賓客（輕輕的）嘶！' + INVITE);
    this.track(await loadPuppets(POSES));
    const s = this.ctx.start;
    const bars = barsIn(au, s, this.ctx.end, 0.5);
    // 四個步驟：夠長就一個小節線一個；不夠就平均排在拍點上（至少一拍一個）
    let ev: number[];
    if (bars.length >= 4) ev = bars.slice(0, 4);
    else {
      const b0 = Math.ceil(au.beatAt(s + 0.9) - 1e-6), b1 = Math.floor(au.beatAt(this.ctx.end - 0.4));
      const step = Math.max(1, Math.floor((b1 - b0) / 4));
      ev = [0, 1, 2, 3].map((k) => au.timeOfBeat(b0 + k * step));
    }
    [this.tSwab, this.tPress, this.tPen, this.tDone] = ev as [number, number, number, number];
    this.tCut = Math.max(s + 0.4, this.tSwab - au.beatPeriod(this.tSwab) * 2);
    this.alKeys = [[-1e9, 'xw_work_ouch'], [this.tSwab, 'xw_work_hand'], [this.tDone, 'xw_work_finger']];
    this.omKeys = [[-1e9, 'mt_work_idle_front'], [this.tSwab, 'mt_work_swab'], [this.tPress, 'mt_work_press'], [this.tPen, 'mt_work_pen'], [this.tDone, 'mt_work_thumb']];
    this.after = bars.filter((b) => b > this.tDone + 0.05);
    this.after.forEach((b, i) => this.omKeys.push([b, i % 2 ? 'mt_work_thumb' : 'mt_work_idle_front']));
    // 孟庭（翻過來面向左）站在她的手剛好托著宣文伸出來的手指的位置
    this.finger = puppetPoint('xw_work_hand', 'finger', AL_X, FLOOR, { h: SZ }) ?? { x: AL_X + SZ * 0.3, y: FLOOR - SZ * 0.5 };
    this.ouchAt = puppetPoint('xw_work_ouch', 'finger', AL_X, FLOOR, { h: SZ }) ?? { x: AL_X + SZ * 0.12, y: FLOOR - SZ * 0.68 };
    const hand = puppetPoint('mt_work_swab', 'hand', 0, FLOOR, { h: SZ, flip: true });
    this.omX = hand ? this.finger.x - hand.x + 6 : AL_X + SZ * 0.6;
    // 盒子上的留言：標準 v2 的字級；盒子的寬高跟著留言（底邊在桌面上）
    const c = this.fg.ctx;
    const w = BOX.w - PAD.x * 2, hmax = BOX.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const bw = Math.min(BOX.w, Math.max(420, tightenNote(c, this.note, 300) + PAD.x * 2));
    const bh = Math.min(BOX.h, Math.max(270, PAD.top + this.note.height + PAD.bottom + 12));
    this.box = { x: BOX.x, y: TABLE_Y - bh, w: bw, h: bh };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.msgT0 = Math.min(s + 0.9, this.tSwab);
    this.drawBackground();
  }

  /** 不會動的：地板、沙發、牆上的畫框、前景的桌子與 OK 繃盒（畫一次）。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx, ink = inkFor(true);
    L.clear();
    inkLine(c, [{ x: 60, y: FLOOR }, { x: 1860, y: FLOOR - 1 }], { ink, w: 0.8, seed: 2 });
    c.strokeStyle = rgba('sepia', 0.12); c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(60, FLOOR - 24); c.lineTo(1860, FLOOR - 25); c.stroke();
    // 沙發（後面、很淡）：椅背、扶手、坐墊的線
    const soft = rgba('sepia', 0.3);
    inkPoly(c, [{ x: 640, y: FLOOR - 4 }, { x: 640, y: 640 }, { x: 700, y: 600 }, { x: 1420, y: 600 }, { x: 1480, y: 640 }, { x: 1480, y: FLOOR - 4 }], { ink, w: 0.7, seed: 3, color: soft, fill: mixRgba('paper', 'shirtblue', 0.18) });
    inkLine(c, [{ x: 700, y: 720 }, { x: 1420, y: 720 }], { ink, w: 0.5, seed: 4, color: soft });
    inkLine(c, [{ x: 1060, y: 604 }, { x: 1060, y: 720 }], { ink, w: 0.4, seed: 5, color: soft });
    // 牆上的小畫框（裡面一條地平線與一顆小太陽）
    inkRect(c, 1530, 330, 170, 130, { ink, w: 0.8, seed: 6, fill: mixRgba('paper', 'bone', 0.6) });
    inkLine(c, [{ x: 1545, y: 420 }, { x: 1685, y: 410 }], { ink, w: 0.4, seed: 7, color: soft });
    c.strokeStyle = soft; c.lineWidth = 1.2; c.beginPath(); c.arc(1640, 380, 16, 0, Math.PI * 2); c.stroke();
    // 前景的桌子：桌面前緣一條線、下面的桌板（離鏡頭近，線粗一點）
    c.fillStyle = mixRgba('paper', 'fur', 0.22);
    c.fillRect(0, TABLE_Y, 760, H - TABLE_Y);
    inkLine(c, [{ x: -10, y: TABLE_Y }, { x: 760, y: TABLE_Y + 2 }, { x: 790, y: H + 10 }], { ink, w: 1.4, seed: 8 });
    hatch(c, [{ x: 0, y: TABLE_Y + 20 }, { x: 760, y: TABLE_Y + 22 }, { x: 780, y: H }, { x: 0, y: H }], { ink, angle: 0.1, gap: 16, w: 0.3, color: rgba('sepia', 0.1) });
    this.drawBox(c, ink);
    L.upload();
  }

  /** OK 繃盒：打開的盒蓋往後立著、露出三片 OK 繃；盒子正面（寫留言的地方）上緣一條 OK 繃的圖、一行小字。 */
  private drawBox(c: CanvasRenderingContext2D, ink: ReturnType<typeof inkFor>) {
    const B = this.box, dep = 46;
    const card = mixRgba('bone', 'paper', 0.25);
    // 盒蓋（往後打開、有一點透視）
    inkPoly(c, [{ x: B.x + 14, y: B.y - dep }, { x: B.x + B.w + 14, y: B.y - dep }, { x: B.x + B.w + 30, y: B.y - dep - 120 }, { x: B.x + 30, y: B.y - dep - 120 }], { ink, w: 0.9, seed: 20, fill: mixRgba('paper', 'bone', 0.4) });
    // 露出來的 OK 繃
    for (let i = 0; i < 3; i++) {
      const x = B.x + 80 + i * 140, y = B.y - dep - 30 + i * 6;
      this.bandage(c, x, y, 120, 34, -0.12 + i * 0.1, ink);
    }
    // 盒子頂面（透視的平行四邊形）與正面
    inkPoly(c, [{ x: B.x, y: B.y }, { x: B.x + B.w, y: B.y }, { x: B.x + B.w + 14, y: B.y - dep }, { x: B.x + 14, y: B.y - dep }], { ink, w: 0.9, seed: 21, fill: mixRgba('paper', 'sepia', 0.1) });
    c.fillStyle = rgba('sepia', 0.1);
    c.fillRect(B.x + 12, B.y + 14, B.w, B.h);
    inkPoly(c, [{ x: B.x, y: B.y }, { x: B.x + B.w, y: B.y }, { x: B.x + B.w, y: B.y + B.h }, { x: B.x, y: B.y + B.h }], { ink, w: 1.1, seed: 22, fill: card });
    // 正面上緣：一片 OK 繃的圖（印刷）＋一行小字
    this.bandage(c, B.x + PAD.x + 70, B.y + 36, 140, 36, 0, ink);
    c.font = font(F.hei(500), 18);
    c.letterSpacing = '4px';
    c.fillStyle = rgba('sepia', 0.5);
    c.fillText('OK 繃 · 20 片入', B.x + PAD.x + 160, B.y + 44);
    c.letterSpacing = '0px';
    c.strokeStyle = rgba('sepia', 0.14); c.lineWidth = 1;
    c.beginPath(); c.moveTo(B.x + PAD.x, B.y + 70); c.lineTo(B.x + B.w - PAD.x, B.y + 70); c.stroke();
  }

  /** 一片 OK 繃：圓角長條（米色）、中間的棉墊（淺一點、有小點）。 */
  private bandage(c: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, rot: number, ink: ReturnType<typeof inkFor>) {
    c.save();
    c.translate(cx, cy);
    c.rotate(rot);
    inkRect(c, -w / 2, -h / 2, w, h, { ink, w: 0.7, seed: cx, r: h / 2, fill: mixRgba('cream', 'fur', 0.35) });
    c.fillStyle = mixRgba('cream', 'bone', 0.5);
    c.fillRect(-w * 0.17, -h * 0.34, w * 0.34, h * 0.68);
    c.fillStyle = rgba('sepia', 0.2);
    for (let i = -2; i <= 2; i++) for (const j of [-1, 1]) { c.beginPath(); c.arc(i * w * 0.05, j * h * 0.15, 1.3, 0, Math.PI * 2); c.fill(); }
    c.restore();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t;
    this.paper.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const ink = inkFor(true);

    this.drawLyric(c, t);
    this.drawPeople(c, t, ink);
    this.drawDogs(c, t);
    this.drawMessage(c, t);

    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p);
    const cx = this.finger.x, cy = this.finger.y;
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.24, grain: 0.045, ca: 0.5, zoom: 1 + 0.03 * push, shake: [-(cx - W / 2) * 0.03 * push, -(cy - H / 2) * 0.03 * push] };
  }

  /** 兩個人：照步驟換姿勢；消毒時每拍點一下、貼的時候壓一下、畫愛心時筆一拍動一下。手指上的 OK 繃與愛心用程式畫。 */
  private drawPeople(c: CanvasRenderingContext2D, t: number, ink: ReturnType<typeof inkFor>) {
    const au = this.ctx.audio, s = this.ctx.start;
    const kick = beatKick(au, t, 0.2);
    const shade = '70,45,25';
    const ea = enter(this.glow, t, s + 0.05, AL_X, FLOOR - 6, 1);
    if (ea) {
      const name = pick(this.alKeys, t);
      // 割到的那一下：整個人縮一下
      const flinch = t >= this.tCut ? Math.exp(-(t - this.tCut) / 0.12) : 0;
      const o: PuppetOpts = { h: SZ, spin: ea.spin, alpha: ea.alpha, pivot: 0.3, rot: -0.03 * flinch, squash: 0.03 * flinch + breathe(t, 0.008, 3.2) + (name === 'xw_work_finger' ? -0.03 * Math.exp(-(t - this.lastBar(t)) / 0.15) : 0) };
      puppetShadow(c, 'xw', AL_X, FLOOR, { h: SZ, alpha: 0.3 * ea.alpha, color: shade });
      drawPick(c, this.alKeys, t, AL_X, FLOOR, o);
      // 割到：手指邊一圈小火花（不畫血）
      const k = t >= this.tCut ? 1 - (t - this.tCut) / 0.35 : 0;
      if (k > 0 && name === 'xw_work_ouch') {
        c.save();
        c.strokeStyle = rgba('signal', k); c.lineWidth = 2.4; c.lineCap = 'round';
        c.beginPath();
        for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 - 0.3, r0 = 10 + (1 - k) * 12; c.moveTo(this.ouchAt.x + Math.cos(a) * r0, this.ouchAt.y + Math.sin(a) * r0); c.lineTo(this.ouchAt.x + Math.cos(a) * (r0 + 9 * k), this.ouchAt.y + Math.sin(a) * (r0 + 9 * k)); }
        c.stroke();
        c.restore();
      }
      // 手指上的 OK 繃（貼上之後；舉手指那張圖本來就畫了）、畫上去的小愛心
      if (name === 'xw_work_hand' && t >= this.tPress) {
        const F0 = this.finger;
        const pop = 1 + 0.3 * Math.exp(-(t - this.tPress) / 0.1);
        this.bandage(c, F0.x - 16, F0.y + 1, 26 * pop, 11 * pop, 0.05, ink);
        if (t >= this.tPen + 0.1) {
          c.save();
          c.fillStyle = rgba('collar', 0.9);
          c.beginPath();
          const hx = F0.x - 16, hy = F0.y + 1, sz = 3.2 * clamp((t - this.tPen - 0.1) / 0.15);
          c.moveTo(hx, hy + sz); c.bezierCurveTo(hx - sz * 2, hy - sz * 0.5, hx - sz * 0.6, hy - sz * 2, hx, hy - sz * 0.6); c.bezierCurveTo(hx + sz * 0.6, hy - sz * 2, hx + sz * 2, hy - sz * 0.5, hx, hy + sz); c.fill();
          c.restore();
        }
      }
    }
    const eo = enter(this.glow, t, s + 0.16, this.omX, FLOOR - 6, 2);
    if (eo) {
      const name = pick(this.omKeys, t);
      let rot = 0, squash = breathe(t, 0.008, 3.4, 0.4);
      if (name === 'mt_work_swab') rot = -0.02 * kick;
      if (name === 'mt_work_press') squash += 0.03 * Math.exp(-(t - this.tPress) / 0.12);
      if (name === 'mt_work_pen') rot = -0.015 * Math.sin(au.beatAt(t) * Math.PI * 2);
      if (t >= this.tDone) squash -= 0.04 * Math.exp(-(t - this.lastBar(t)) / 0.15);
      puppetShadow(c, 'mt', this.omX, FLOOR, { h: SZ, alpha: 0.3 * eo.alpha, color: shade });
      // 側面的圖翻過來面向宣文；正面的（站著、比讚）不翻
      drawPick(c, this.omKeys, t, this.omX, FLOOR, { h: SZ, flip: !name.endsWith('_front') && !name.endsWith('_thumb'), spin: eo.spin, alpha: eo.alpha, pivot: 0.2, rot, squash });
    }
    // 畫好愛心：兩人手上冒一顆大愛心；舉手指的時候再冒兩顆
    heartPop(c, this.finger.x, this.finger.y - 50, 46, (t - this.tPen - 0.2) / 1.3);
    for (const t0 of [this.tDone, ...this.after]) for (let i = 0; i < 2; i++) heartPop(c, AL_X - 40 + i * 120, FLOOR - SZ * 1.05, 32, (t - t0 - i * 0.15) / 1.3);
  }

  /** 舉手指之後最近的一個小節線（跟著彈一下）。 */
  private lastBar(t: number) { let b = this.tDone; for (const x of this.after) if (t >= x) b = x; return b; }

  /** 狗狗：坐在兩個人前面，輪流歪頭（兩拍換一次）；貼好 OK 繃的那一下兩隻一起彈一下。 */
  private drawDogs(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, s = this.ctx.start;
    const phase = Math.floor(au.beatAt(t) / 2) % 2;
    for (const [d, x, i] of [['pp', PP_X, 0], ['qq', (AL_X + this.omX) / 2 + 6, 1]] as const) {
      const e = enter(this.glow, t, s + 0.26 + i * 0.08, x, FLOOR - 6, 3 + i);
      if (!e) continue;
      const tilt = phase === i && t > s + 0.8;
      // 貼好的那一下兩隻一起彈；之後每個小節線輪流彈一下
      let hopT = this.tPress + i * 0.06;
      this.after.forEach((b, k) => { if (k % 2 === i && t >= b) hopT = b; });
      const lift = t >= hopT && t < hopT + 0.3 ? 26 * Math.sin((Math.PI * (t - hopT)) / 0.3) : 0;
      puppetShadow(c, d, x, FLOOR, { h: SZ * DOG_S, lift, alpha: 0.3 * e.alpha, color: '70,45,25' });
      drawPuppet(c, tilt ? `${d}_work_tilt` : `${d}_sit`, x, FLOOR - lift, { h: SZ, scale: DOG_S, spin: e.spin, alpha: e.alpha, squash: landSquash(t, hopT + 0.3, 0.12) + breathe(t, 0.015, 1.4, i * 0.5) });
    }
  }

  /** 右上牆上的歌詞（照跟唱規則）。間奏時一行淡淡的「（輕輕的）」。 */
  private drawLyric(c: CanvasRenderingContext2D, t: number) {
    const ly = lyricAt(this.ctx.lyrics, t);
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.6);
    if (ly) {
      const big = !this.msg;
      const st = { family: F.archivo(100, big ? 800 : 700), size: this.lyricSize, minSize: 40, maxWidth: WALL.w, unsung: rgba('sepia', 0.22), sung: rgba('sepia', big ? 0.94 : 0.82), active: rgba('signal') };
      const lay = layoutLyric(c, ly.line, st);
      c.translate(WALL.x, WALL.y + lay.size * 0.86);
      drawLyric(c, ly.line, t, st, lay, ly.k);
    } else {
      c.font = font(F.hand(400), 40);
      c.fillStyle = rgba('sepia', 0.4);
      c.fillText('（輕輕的）', WALL.x, WALL.y + 40);
    }
    c.restore();
  }

  /** 盒子正面的留言：一個字一個字印上去，寫完署名淡入；在小字底下垂直置中。 */
  private drawMessage(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const B = this.box;
    const top = B.y + PAD.top, h = B.h - PAD.top - PAD.bottom;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.6);
    writeNote(c, n, B.x + PAD.x, top + Math.max(0, (h - n.height) * 0.45), t, this.msgT0, { msg: !!this.msg, color: rgba('sepia', 0.95), faint: rgba('sepia', 0.6), sig: rgba('sepia', 0.74) });
    c.restore();
  }
}
