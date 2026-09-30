// 白板架構圖（亮、work）：會議室的大白板。宣文（連帽外套）拿黑色白板筆畫系統架構圖，孟庭（護理服）拿紅筆在旁邊打勾。
// 角色是 Codex 畫的紙偶（_puppet.ts，work 組）；白板、圖、便利貼、字用程式畫。
//  - 照拍子：一拍畫上一個方塊（筆畫描出來），半拍後一條箭頭接上前一個；宣文一拍換一次手（高、低），往下一個方塊挪一點。
//    孟庭在方塊畫好的下一拍打一個紅勾。方塊排在一顆愛心的輪廓上，**最後一個小節線最後一條箭頭接回第一個方塊**：整張圖連成一顆愛心（玫瑰色），
//    兩人轉過來比讚、頭上冒愛心。
//  - **焦點是主打留言**：寫在白板右邊的一張大便利貼上（稍微歪、上緣一條膠、有影子），深墨手寫字、署名；
//    照「留言尺寸與版面比例標準 v2」：字 40～60、便利貼最大 520 × 420，高度跟著留言長短。沒有留言時便利貼寫邀請、字淡，歌詞變主角。
//  - 歌詞是白板左上角的標題（像白板筆寫的字，照跟唱規則逐字亮），比留言小一級（標準 v2：40～52）。
//  - 鏡頭：整個窗格慢慢推近白板；左下一盆小植物，葉子跟著拍子輕輕晃。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, heartPoints, lyricSubOf } from './_motifs';
import { inkFor, inkLine, inkPath, inkPoly, inkRect, inkEllipse, paperBG, heartPop, type Pt, type Note } from './_couple';
import { loadPuppets, drawCycle, drawPick, puppetShadow, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { INVITE, enter, writeNote, barsIn, at } from './_c7';

export const spec: PlateSpecDecl = { group: 'couple', family: 'work', paper: true, energy: [0.35, 1], bars: [4, 8] };

const FLOOR = 940;
const SZ = 440;
/** 白板（牆上）與下緣的筆槽。 */
const BOARD = { x: 200, y: 104, w: 1530, h: 600 };
/** 愛心形的架構圖：中心、大小。 */
const HEART = { x: 820, y: 410, s: 240 };
/** 便利貼：最大的範圍（上緣固定、高度跟著留言）與寫字的內距。 */
const STICKY = { x: 1206, y: 150, w: 520, h: 420, rot: 0.02 };
const PAD = { x: 36, top: 44, bottom: 26 };
/** 標題（歌詞）。 */
const TITLE = { x: 262, y: 150, w: 900 };
const AL_X0 = 470, OM_X = 1085;
const LABELS = ['APP', 'API', 'AUTH', 'CACHE', 'DB', 'QUEUE', 'CDN', 'LOG'];
const POSES = ['xw_work_draw_1', 'xw_work_draw_2', 'xw_work_thumb', 'mt_work_tick', 'mt_work_thumb'];

interface Node { t: number; tick: number; p: Pt; label: string }

export default class Whiteboard extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  sticky = { ...STICKY };
  lyricSize = 52;
  nodes: Node[] = [];
  /** 愛心的輪廓（畫面座標），方塊之間的箭頭沿著它走。 */
  outline: Pt[] = [];
  idx: number[] = [];
  tClose = -1;
  /** 接回來之後的每個小節線（冒愛心、兩人一起彈一下）。 */
  after: number[] = [];
  msgT0 = 0;
  /** 愛心架構圖的位置。韓文歌（標題多一排原文）時小一點、往下挪，最上面的方塊與勾勾才不會頂到原文；整格固定。 */
  heart = HEART;

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('SYSTEM DESIGN · 0313一位賓客（先畫方塊，再接箭頭）' + LABELS.join('') + INVITE);
    this.track(await loadPuppets(POSES));
    const s = this.ctx.start;
    const bars = barsIn(au, s, this.ctx.end, 0.5);
    const n = bars.length;
    if (this.ctx.lyrics.linesIn(s, this.ctx.end).some((l) => lyricSubOf(l))) this.heart = { x: HEART.x, y: HEART.y + 22, s: HEART.s * 0.9 };
    const HT = this.heart;
    // 愛心輪廓上八個方塊：從凹口開始順時針，最後一條箭頭回到第一個
    this.outline = heartPoints(160).map((p) => ({ x: HT.x + p.x * HT.s, y: HT.y + p.y * HT.s }));
    const N = LABELS.length;
    // 方塊照「沿著輪廓的長度」排（照參數排的話凹口附近會擠成一團）；凹口兩側各留一大段空（方塊才不會疊在一起）
    const acc = [0];
    for (let i = 1; i < this.outline.length; i++) acc.push(acc[i - 1]! + Math.hypot(this.outline[i]!.x - this.outline[i - 1]!.x, this.outline[i]!.y - this.outline[i - 1]!.y));
    const total = acc[acc.length - 1]!;
    const FR = [0.07, 0.19, 0.3, 0.39, 0.61, 0.7, 0.81, 0.93];
    this.idx = FR.slice(0, N).map((f) => { const L = f * total; let j = 0; while (j < acc.length - 1 && acc[j]! < L) j++; return j % 160; });
    // 最後一個小節線接回來；方塊平均排在第一個拍點到收尾前一拍之間（一拍一個，拍子不夠時兩個擠一拍）
    const b0 = Math.ceil(au.beatAt(s + 0.6) - 1e-6);
    // 最多四小節就接回來（一個方塊最多兩拍，不要拖）；長的窗格後半段讓愛心停在白板上、每個小節線冒愛心
    this.tClose = n >= 2 ? at(bars, Math.min(n - 1, 4)) : au.timeOfBeat(b0 + N);
    this.after = bars.filter((b) => b > this.tClose + 0.05);
    const bClose = Math.round(au.beatAt(this.tClose));
    const span = Math.max(1, bClose - 1 - b0);
    this.nodes = LABELS.map((label, i) => {
      const t = au.timeOfBeat(b0 + (span * i) / Math.max(1, N - 1));
      return { t, tick: t + au.beatPeriod(t), p: this.outline[this.idx[i]!]!, label };
    });
    // 便利貼上的留言：標準 v2 的字級；寬高跟著留言
    const c = this.fg.ctx;
    const w = STICKY.w - PAD.x * 2, hmax = STICKY.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const sw = Math.min(STICKY.w, Math.max(360, tightenNote(c, this.note, 280) + PAD.x * 2));
    const sh = Math.min(STICKY.h, Math.max(260, PAD.top + this.note.height + PAD.bottom + 12));
    this.sticky = { ...STICKY, x: STICKY.x + (STICKY.w - sw) / 2, w: sw, h: sh };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.msgT0 = Math.min(s + 0.9, bars[0]!);
    this.drawBackground();
  }

  /** 不會動的：地板、白板（框、板面、筆槽）、小標、便利貼（畫一次）。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx, ink = inkFor(true);
    L.clear();
    inkLine(c, [{ x: 60, y: FLOOR }, { x: 1860, y: FLOOR - 1 }], { ink, w: 0.8, seed: 2 });
    c.strokeStyle = rgba('sepia', 0.12); c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(60, FLOOR - 24); c.lineTo(1860, FLOOR - 25); c.stroke();
    // 白板：影子、板面（比紙亮）、鋁框、下緣的筆槽（放兩支筆）
    const B = BOARD;
    c.fillStyle = rgba('sepia', 0.08);
    c.fillRect(B.x + 12, B.y + 14, B.w, B.h);
    c.fillStyle = mixRgba('paper', 'bone', 0.85);
    c.fillRect(B.x, B.y, B.w, B.h);
    inkRect(c, B.x, B.y, B.w, B.h, { ink, w: 1.2, seed: 3, r: 6 });
    c.strokeStyle = rgba('sepia', 0.15); c.lineWidth = 1;
    c.strokeRect(B.x + 8, B.y + 8, B.w - 16, B.h - 16);
    inkRect(c, B.x + 60, B.y + B.h, B.w - 120, 14, { ink, w: 0.8, seed: 4, fill: mixRgba('paper', 'graphite', 0.2) });
    inkRect(c, B.x + 200, B.y + B.h - 6, 70, 8, { ink, w: 0.5, seed: 5, fill: rgba('sepia', 0.8) });
    // 白板上的淡淡擦痕（上一次會議沒擦乾淨）
    c.strokeStyle = rgba('sepia', 0.04); c.lineWidth = 16; c.lineCap = 'round';
    c.beginPath(); c.moveTo(B.x + 1080, B.y + 520); c.bezierCurveTo(B.x + 1150, B.y + 490, B.x + 1220, B.y + 560, B.x + 1300, B.y + 530); c.stroke();
    // 標題上面的小標
    c.font = font(F.mono(500), 16);
    c.letterSpacing = '4px';
    c.fillStyle = rgba('sepia', 0.4);
    c.fillText('SYSTEM DESIGN · 0313', TITLE.x, TITLE.y - 14);
    c.letterSpacing = '0px';
    // 便利貼：稍微歪、影子、上緣一條膠
    const S = this.sticky;
    c.save();
    c.translate(S.x + S.w / 2, S.y + S.h / 2);
    c.rotate(S.rot);
    c.translate(-S.w / 2, -S.h / 2);
    c.fillStyle = rgba('sepia', 0.1);
    c.beginPath(); c.moveTo(10, 14); c.lineTo(S.w + 10, 16); c.lineTo(S.w + 4, S.h + 16); c.lineTo(12, S.h + 12); c.closePath(); c.fill();
    inkPoly(c, [{ x: 0, y: 0 }, { x: S.w, y: 1 }, { x: S.w - 1, y: S.h }, { x: 2, y: S.h - 2 }], { ink, fill: mixRgba('bone', 'ember', 0.34), w: 0.7, seed: 6 });
    c.fillStyle = mixRgba('bone', 'ember', 0.5);
    c.fillRect(0, 0, S.w, 26);
    c.restore();
    // 左下的小盆栽（葉子在 render 裡晃）
    inkPoly(c, [{ x: 92, y: FLOOR - 110 }, { x: 176, y: FLOOR - 110 }, { x: 166, y: FLOOR }, { x: 102, y: FLOOR }], { ink, w: 0.9, seed: 7, fill: mixRgba('paper', 'fur', 0.35) });
    L.upload();
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

    this.drawTitle(c, t);
    this.drawDiagram(c, t, ink);
    this.drawMessage(c, t);
    this.drawPlant(c, t, ink);
    this.drawPeople(c, t);

    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p);
    const cx = 960, cy = 380;
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.24, grain: 0.045, ca: 0.5, zoom: 1 + 0.03 * push, shake: [-(cx - W / 2) * 0.03 * push, -(cy - H / 2) * 0.03 * push] };
  }

  /** 架構圖：方塊在它的拍點上被描出來（筆畫的長度跟著時間），箭頭沿著愛心的輪廓接上；收尾時整條輪廓變成玫瑰色。 */
  private drawDiagram(c: CanvasRenderingContext2D, t: number, ink: ReturnType<typeof inkFor>) {
    const au = this.ctx.audio;
    const N = this.nodes.length, O = this.outline, M = O.length - 1;
    const close = this.tClose > 0 ? prog(t, this.tClose, this.tClose + 0.6, ease.outCubic) : 0;
    // 箭頭：第 i 個方塊畫好半拍後，從它沿著輪廓接到下一個（最後一條在收尾的小節線上接回第一個）
    for (let i = 0; i < N; i++) {
      const a = this.nodes[i]!, b = this.nodes[(i + 1) % N]!;
      const t0 = i === N - 1 ? this.tClose - au.beatPeriod(this.tClose) * 0.5 : Math.max(a.t, b.t - au.beatPeriod(b.t) * 0.5);
      const k = prog(t, t0, t0 + Math.min(0.4, au.beatPeriod(t0) * 0.8), ease.outCubic);
      if (k <= 0) continue;
      const i0 = this.idx[i]!, i1 = this.idx[(i + 1) % N]!;
      const seg: Pt[] = [];
      const len = ((i1 - i0 + M) % M) || M;
      // 方塊本身佔掉的一小段不畫（箭頭從方塊邊出去、進到下一個方塊邊）
      for (let j = 5; j <= len - 5; j++) seg.push(O[(i0 + j) % M]!);
      const cut = Math.max(2, Math.floor(seg.length * k));
      const pts = seg.slice(0, cut);
      if (pts.length < 2) continue;
      inkPath(c, pts, { ink, w: 0.9, seed: 50 + i, color: close > 0 ? mixRgba('sepia', 'rose', close) : rgba('sepia', 0.8) });
      if (k >= 1) {
        // 箭頭頭
        const p = pts[pts.length - 1]!, q = pts[pts.length - 3]!;
        const ang = Math.atan2(p.y - q.y, p.x - q.x);
        c.strokeStyle = close > 0 ? mixRgba('sepia', 'rose', close) : rgba('sepia', 0.8);
        c.lineWidth = 2.2; c.lineCap = 'round';
        c.beginPath();
        c.moveTo(p.x - Math.cos(ang - 0.5) * 12, p.y - Math.sin(ang - 0.5) * 12); c.lineTo(p.x, p.y); c.lineTo(p.x - Math.cos(ang + 0.5) * 12, p.y - Math.sin(ang + 0.5) * 12);
        c.stroke();
      }
    }
    // 收尾：整顆愛心淡淡地填上玫瑰色
    if (close > 0) {
      c.save();
      c.globalAlpha = 0.16 * close;
      c.fillStyle = rgba('rose');
      c.beginPath(); O.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath(); c.fill();
      c.restore();
    }
    // 方塊：描邊（四條邊依序畫出來）＋小小的標籤；打勾在右上角
    c.save();
    c.font = font(F.mono(500), 15);
    c.textAlign = 'center';
    for (const nd of this.nodes) {
      const k = prog(t, nd.t, nd.t + Math.min(0.3, au.beatPeriod(nd.t) * 0.6));
      if (k <= 0) continue;
      const w = 86, h = 42, x = nd.p.x - w / 2, y = nd.p.y - h / 2;
      c.fillStyle = mixRgba('paper', 'bone', 0.9);
      c.globalAlpha = k;
      c.fillRect(x, y, w, h);
      c.globalAlpha = 1;
      const per = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }];
      const sides = 4 * k, pts: Pt[] = [per[0]!];
      for (let j = 0; j < 4 && j < sides; j++) { const u = Math.min(1, sides - j); pts.push({ x: lerp(per[j]!.x, per[j + 1]!.x, u), y: lerp(per[j]!.y, per[j + 1]!.y, u) }); }
      inkPath(c, pts, { ink, w: 1, seed: nd.t * 10 });
      c.fillStyle = rgba('sepia', 0.6 * k);
      c.fillText(nd.label, nd.p.x, nd.p.y + 5);
      // 紅勾（孟庭的紅筆）
      const tk = prog(t, nd.tick, nd.tick + 0.18);
      if (tk > 0) {
        const cx = x + w - 2, cy = y - 4;
        const a = { x: cx - 10, y: cy }, b = { x: cx - 3, y: cy + 8 }, e = { x: cx + 14, y: cy - 14 };
        const tp: Pt[] = tk < 0.35 ? [a, { x: lerp(a.x, b.x, tk / 0.35), y: lerp(a.y, b.y, tk / 0.35) }] : [a, b, { x: lerp(b.x, e.x, (tk - 0.35) / 0.65), y: lerp(b.y, e.y, (tk - 0.35) / 0.65) }];
        inkPath(c, tp, { ink, w: 1.3, seed: nd.t * 7, color: rgba('collar', 0.95) });
      }
    }
    c.restore();
  }

  /** 兩個人：宣文一拍換一次手（高、低），往正在畫的方塊挪；孟庭（翻過來面向左）每次打勾往前點一下。收尾時兩人轉過來比讚。 */
  private drawPeople(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, s = this.ctx.start;
    const kick = beatKick(au, t, 0.22);
    const done = this.tClose > 0 && t >= this.tClose;
    const shade = '70,45,25';
    // 宣文：往目前畫到的方塊挪（只在左半邊移動，不擋到愛心的中間）
    let cur = 0;
    for (let i = 0; i < this.nodes.length; i++) if (t >= this.nodes[i]!.t) cur = i;
    const target = clamp(this.nodes[cur]?.p.x ?? AL_X0, 560, 760) - 110;
    const ax = lerp(AL_X0, target, 0.6);
    const ea = enter(this.glow, t, s + 0.05, ax, FLOOR - 6, 1);
    if (ea) {
      puppetShadow(c, 'xw', ax, FLOOR, { h: SZ, alpha: 0.3 * ea.alpha, color: shade });
      const o: PuppetOpts = { h: SZ, spin: ea.spin, alpha: ea.alpha, pivot: 0.3, rot: 0.02 * kick, squash: breathe(t, 0.008, 3.1) };
      if (done) drawPick(c, [[-1e9, 'xw_work_thumb']], t, ax, FLOOR, { ...o, squash: -0.04 * Math.exp(-(t - this.lastBar(t)) / 0.15) });
      else drawCycle(c, au, t, ['xw_work_draw_1', 'xw_work_draw_2'], 1, ax, FLOOR, o);
    }
    const eo = enter(this.glow, t, s + 0.16, OM_X, FLOOR - 6, 2);
    if (eo) {
      puppetShadow(c, 'mt', OM_X, FLOOR, { h: SZ, alpha: 0.3 * eo.alpha, color: shade });
      let tick = 0;
      for (const nd of this.nodes) { const d = t - nd.tick; if (d > -0.1 && d < 0.3) tick = Math.max(tick, 1 - Math.abs(d - 0.05) / 0.25); }
      const o: PuppetOpts = { h: SZ, flip: !done, spin: eo.spin, alpha: eo.alpha, pivot: 0.3, rot: -0.03 * tick, squash: breathe(t, 0.008, 3.3, 0.4) - (done ? 0.04 * Math.exp(-(t - this.lastBar(t)) / 0.15) : 0) };
      drawPick(c, [[-1e9, 'mt_work_tick'], [done ? this.tClose : 1e9, 'mt_work_thumb']], t, OM_X, FLOOR, o);
    }
    for (const t0 of this.tClose > 0 ? [this.tClose, ...this.after] : []) for (let i = 0; i < 3; i++) heartPop(c, this.heart.x - 60 + i * 60, this.heart.y + this.heart.s * 0.2 - i * 20, 40, (t - t0 - i * 0.15) / 1.3);
  }

  /** 收尾之後最近的一個小節線（兩人比讚時跟著彈一下）。 */
  private lastBar(t: number) { let b = this.tClose; for (const x of this.after) if (t >= x) b = x; return b; }

  /** 左下的盆栽：幾片葉子，拍點上被推一下。 */
  private drawPlant(c: CanvasRenderingContext2D, t: number, ink: ReturnType<typeof inkFor>) {
    const k = beatKick(this.ctx.audio, t, 0.5);
    const base = { x: 134, y: FLOOR - 108 };
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i - 2.5) * 0.32 + 0.05 * k * (i % 2 ? 1 : -1);
      const L = 90 + (i % 3) * 30;
      const tip = { x: base.x + Math.cos(a) * L, y: base.y + Math.sin(a) * L };
      const mid = { x: base.x + Math.cos(a - 0.2) * L * 0.55, y: base.y + Math.sin(a - 0.2) * L * 0.55 };
      inkPath(c, [base, mid, tip], { ink, w: 0.8, seed: 70 + i, color: rgba('sepia', 0.7) });
      inkEllipse(c, (mid.x + tip.x) / 2, (mid.y + tip.y) / 2, 18, 7, a, { ink, w: 0.6, seed: 80 + i, fill: mixRgba('paper', 'gingham', 0.5) });
    }
  }

  /** 白板左上角的標題：歌詞（白板筆的字，照跟唱規則）。間奏時一行淡淡的「（先畫方塊，再接箭頭）」。 */
  private drawTitle(c: CanvasRenderingContext2D, t: number) {
    const ly = lyricAt(this.ctx.lyrics, t);
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.6);
    if (ly) {
      const big = !this.msg;
      const st = { family: F.archivo(100, big ? 800 : 700), size: this.lyricSize, minSize: 40, maxWidth: TITLE.w, unsung: rgba('sepia', 0.22), sung: rgba('sepia', big ? 0.94 : 0.82), active: rgba('signal') };
      const lay = layoutLyric(c, ly.line, st);
      c.translate(TITLE.x, TITLE.y + lay.size * 0.86);
      drawLyric(c, ly.line, t, st, lay, ly.k);
    } else {
      c.font = font(F.hand(400), 40);
      c.fillStyle = rgba('sepia', 0.4);
      c.fillText('（先畫方塊，再接箭頭）', TITLE.x, TITLE.y + 38);
    }
    c.restore();
  }

  /** 便利貼上的留言：一個字一個字寫上去，寫完署名淡入；在便利貼上垂直置中（字不跟著轉：斜的字每格都要重畫，很貴）。 */
  private drawMessage(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const S = this.sticky;
    const top = S.y + PAD.top, h = S.h - PAD.top - PAD.bottom;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.6);
    writeNote(c, n, S.x + PAD.x, top + Math.max(0, (h - n.height) * 0.45), t, this.msgT0, { msg: !!this.msg, color: rgba('sepia', 0.95), faint: rgba('sepia', 0.6), sig: rgba('sepia', 0.74) });
    c.restore();
  }
}
