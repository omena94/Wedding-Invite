// 試算表（批次 T6・螢幕 B，亮）：紙色的試算表，儲存格在拍點上一格一格填進去。
// 構圖照試算表本來的樣子，但放大到會場最後一桌也看得到：
//  - 上面是公式列：fx 後面就是正在唱的歌詞（逐字跟唱）；沒在唱的時候顯示目前那一格的公式（=B3+C3、=SUM(愛)）。
//  - 左上是「幸福統計表」：一拍一列，選取框像拖曳填滿一樣往下滑，最後一列 =SUM(愛) 算出 ∞，之後每個小節線「重新計算」閃一下。
//  - 左下浮著一張長條圖：每一拍長出一根，高度是那一拍的音量，滿十六根就往左捲。
//  - 右邊一大格合併儲存格：主打留言被「貼上」在裡面——仙女棒先沿著外框描一圈，接著一行一行貼上，
//    外框變成複製時的虛線（螞蟻線）跟著拍子跑。沒有留言時這一格是空白的，等你來寫。
// 手法：紙底一個 shader，表格的格線與標籤畫在一張不會變的 Canvas 層（只上傳一次），會動的東西畫在第二張，火花用 LineBatch。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import type { FitResult } from '../engine/text';
import type { Lyrics } from '../engine/lyrics';
import { lyricAt, drawLyric, layoutLyric, drawMessage, signature, sparkHead, sparkParticles, beatAfter, COUPLE_ZH } from './_motifs';
import { beatsIn, inOut, fitMessage, type Rect } from './_t6';

export const spec: PlateSpecDecl = { group: 'type', family: 'screen', paper: true, energy: [0.25, 0.8], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 版面（邏輯像素，y 向下）
const FB = { x: 96, y: 96, w: 1244, h: 112 }; // 公式列
const REF_W = 150; // 公式列左邊的儲存格位址框
const FX_X = FB.x + REF_W + 22; // fx
const FB_TEXT_X = FX_X + 70; // 歌詞從這裡開始
const HDR_Y = 222, HDR_H = 40; // 欄名（A B C…）那一列
const RH_X = 96, RH_W = 54; // 列號那一欄
const ROW0 = HDR_Y + HDR_H, RH = 58; // 第 1 列的上緣、列高
const GRID_B = 924; // 格線畫到這裡（下面是工作表分頁與狀態列）
const COLS = [
  { k: 'A', x: 150, w: 250 }, { k: 'B', x: 400, w: 120 }, { k: 'C', x: 520, w: 120 }, { k: 'D', x: 640, w: 120 },
  { k: 'E', x: 760, w: 116 }, { k: 'F', x: 876, w: 116 }, { k: 'G', x: 992, w: 116 }, { k: 'H', x: 1108, w: 116 }, { k: 'I', x: 1224, w: 116 },
];
const GRID_R = 1340;
const rowY = (r: number) => ROW0 + (r - 1) * RH;
/** 合併儲存格 E1:I11（主打留言）。 */
const MERGE = { x: 760, y: rowY(1), w: GRID_R - 760, h: rowY(12) - rowY(1) };
/** 浮在 A8:D11 上面的長條圖。 */
const CHART = { x: 172, y: rowY(8) - 12, w: 566, h: 4 * RH - 6 };
const SLOTS = 16; // 長條圖同時顯示幾根
const TOTAL_ROW = 6;

// 幸福統計表（B、C 是兩個人，D 是合計）
const [GROOM, BRIDE] = COUPLE_ZH.split(/\s*&\s*/) as [string, string];
interface Row { label: string; b: string; c: string; d: string; fd: string }
const ROWS = (bpm: number): Row[] => [
  { label: '心跳（下／分）', b: String(bpm), c: String(bpm), d: '同步', fd: '=IF(B2=C2,"同步")' },
  { label: '牽手（次／日）', b: '12', c: '12', d: '24', fd: '=B3+C3' },
  { label: '遛芃芃與 QQ（趟）', b: '1', c: '1', d: '2', fd: '=B4+C4' },
  { label: '搶棉被（次／晚）', b: '1', c: '3', d: '4', fd: '=B5+C5' },
];
const TEXT = `項目合計總計幸福統計賓客祝福芃芃與就緒計數總和指數每拍即時更新合併儲存格空白這一格留給你的掃描右下角寫下想對新人說話心跳下分牽手次日遛趟搶棉被晚同步則${GROOM}${BRIDE}`;

const BG = () => new FSPass(/* glsl */ `
  uniform float t;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 紙色的「螢幕」：很淡的雲紋，加一點點由上往下的亮度差（像背光）
    float n = fbm(p / 340.0 + vec2(0.0, t * 0.004), 3);
    vec3 col = C_PAPER * (0.972 + 0.02 * n - 0.03 * smoothstep(200.0, 1080.0, p.y));
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 } });

interface Key { t: number; c0: number; r0: number; c1: number; r1: number; formula: string }
interface Sel { key: Key; x: number; y: number; w: number; h: number; moving: boolean; since: number }

export default class Spreadsheet extends Scene {
  bg = shared('spreadsheet.bg', BG);
  /** 不會變的：格線、欄名列號、表格標籤、圖表的框、分頁（第一格畫好上傳一次）。 */
  base = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 每格重畫：數值、選取框、歌詞、留言、長條。 */
  live = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  rows: Row[] = ROWS(Math.round(this.ctx.audio.bpm || 100));
  beats: number[] = [];
  keys: Key[] = [];
  fit: FitResult | null = null;
  msgTop = 0;
  tPaste = 0; tTrace = 0; tTotal = 0;
  private baseDrawn = false;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText(TEXT);
    const b0 = beatAfter(au, s + 0.05);
    const beat = au.beatPeriod(b0);
    this.beats = beatsIn(au, b0, e + beat);
    const B = (i: number) => this.beats[Math.min(i, this.beats.length - 1)] ?? b0 + i * beat;
    // 仙女棒描外框從第一拍開始，描完（一拍）馬上貼上留言
    this.tTrace = b0;
    this.tPaste = b0 + Math.min(beat, 0.7);
    this.tTotal = B(this.rows.length + 1);
    // 選取框的行程：先停在 B2，第 1～4 拍一列一列往下（B:D 整列），第 5 拍跳到合計，之後每兩拍跳到表格裡隨機一格
    this.keys.push({ t: s - 1, c0: 1, r0: 2, c1: 1, r1: 2, formula: this.rows[0]!.b });
    this.rows.forEach((r, i) => this.keys.push({ t: B(i + 1), c0: 1, r0: i + 2, c1: 3, r1: i + 2, formula: r.fd }));
    this.keys.push({ t: this.tTotal, c0: 3, r0: TOTAL_ROW, c1: 3, r1: TOTAL_ROW, formula: '=SUM(愛)' });
    const rnd = (k: number) => hash(this.ctx.params.seed ?? 1, k);
    for (let i = this.rows.length + 3, k = 0; i < this.beats.length; i += 2, k++) {
      const col = 1 + Math.floor(rnd(k) * 3), row = 2 + Math.floor(rnd(k + 50) * this.rows.length);
      const r = this.rows[row - 2]!;
      this.keys.push({ t: B(i), c0: col, r0: row, c1: col, r1: row, formula: col === 3 ? r.fd : col === 1 ? r.b : r.c });
    }
    if (this.msg) {
      const c = this.live.ctx;
      this.fit = fitMessage(c, this.msg.text, F.hand(400), MERGE.w - 64, MERGE.h - 170, { min: 44, max: 104, lineHeight: 1.3 });
      // 留言＋署名整塊在合併儲存格裡垂直置中（上面留 60 px 給儲存格標籤）
      const block = this.fit.height + 76;
      this.msgTop = MERGE.y + 60 + Math.max(0, (MERGE.h - 60 - 24 - block) / 2) + this.fit.size * 0.9;
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const k = inOut(t, s, e, 0.3, 0.25);
    this.bg.u.t!.value = t;
    this.bg.render(renderer, out);
    if (!this.baseDrawn) { this.drawBase(); this.baseDrawn = true; }
    comp.draw(renderer, this.base.texture, out, { opacity: k });

    const L = this.live; L.clear();
    const c = L.ctx;
    c.globalAlpha = k;
    this.glow.clear();
    const sel = this.selection(t);
    this.drawHeaders(c, sel);
    this.drawTable(c, t);
    this.drawChart(c, t);
    const head = this.drawMerge(c, t);
    this.drawSelection(c, t, sel);
    this.drawFormulaBar(c, t, sel, lyrics);
    this.drawStatus(c);
    comp.draw(renderer, L.upload(), out);
    if (head && k > 0.5) {
      const h = head;
      sparkParticles(this.glow, t, () => h, { rate: 90, life: 0.35, speed: 210, seed: 11 });
      sparkHead(this.glow, h.x, h.y, t, 0.9);
    }
    if (this.glow.count) this.glow.render(renderer, out);
    const avoid: Rect[] = [[FB.x - 10, FB.y - 10, FB.w + 20, FB.h + 20], [MERGE.x - 10, MERGE.y - 10, MERGE.w + 20, MERGE.h + 20]];
    // 很慢的推鏡：整個窗格推進 1.5%（字還在安全邊以內），畫面才不會像截圖
    return { paper: 1, bloom: 0.35, vignette: 0.22, grain: 0.035, zoom: 1 + 0.015 * ease.inOutCubic(f.p), popupAvoid: avoid };
  }

  // ------------------------------------------------------------ 不會變的底圖
  private drawBase() {
    const c = this.base.ctx;
    this.base.clear();
    c.textBaseline = 'alphabetic';
    // 公式列：位址框、fx、內容框
    c.strokeStyle = rgba('sepia', 0.35); c.lineWidth = 1.5;
    c.strokeRect(FB.x + 0.5, FB.y + 0.5, REF_W, FB.h);
    c.strokeRect(FB.x + REF_W + 10.5, FB.y + 0.5, FB.w - REF_W - 10, FB.h);
    c.font = font(F.serif(600, true), 40); c.fillStyle = rgba('sepia', 0.55);
    c.fillText('fx', FX_X + 6, FB.y + FB.h / 2 + 13);
    c.fillStyle = rgba('sepia', 0.18); c.fillRect(FX_X + 56, FB.y + 18, 1.2, FB.h - 36);
    // 欄名列、列號欄的底色
    c.fillStyle = rgba('sepia', 0.055);
    c.fillRect(RH_X, HDR_Y, GRID_R - RH_X, HDR_H);
    c.fillRect(RH_X, ROW0, RH_W, GRID_B - ROW0);
    // 格線：直線（欄）與橫線（列）；合併儲存格裡面沒有格線
    c.fillStyle = rgba('sepia', 0.16);
    for (const col of [...COLS.map((cl) => cl.x), GRID_R]) {
      const inMerge = col > MERGE.x && col < MERGE.x + MERGE.w;
      if (inMerge) { c.fillRect(col, HDR_Y, 1, HDR_H); c.fillRect(col, MERGE.y + MERGE.h, 1, GRID_B - MERGE.y - MERGE.h); }
      else c.fillRect(col, HDR_Y, 1, GRID_B - HDR_Y);
    }
    c.fillRect(RH_X, HDR_Y, 1, GRID_B - HDR_Y);
    for (let r = 0; ROW0 + r * RH <= GRID_B; r++) {
      const y = ROW0 + r * RH;
      const inMerge = y > MERGE.y && y < MERGE.y + MERGE.h;
      c.fillRect(RH_X, y, (inMerge ? MERGE.x : GRID_R) - RH_X, 1);
    }
    c.fillRect(RH_X, HDR_Y, GRID_R - RH_X, 1);
    // 欄名與列號（mono）
    c.font = font(F.mono(500), 20); c.fillStyle = rgba('sepia', 0.55); c.textAlign = 'center';
    for (const col of COLS) c.fillText(col.k, col.x + col.w / 2, HDR_Y + 27);
    for (let r = 1; rowY(r) + RH <= GRID_B + 4; r++) c.fillText(String(r), RH_X + RH_W / 2, rowY(r) + RH / 2 + 7);
    c.textAlign = 'left';
    // 表格：標題列、A 欄的項目
    c.fillStyle = rgba('sepia', 0.07); c.fillRect(COLS[0]!.x + 1, rowY(1) + 1, COLS[3]!.x + COLS[3]!.w - COLS[0]!.x - 1, RH - 1);
    c.font = font(F.hei(700), 26); c.fillStyle = rgba('sepia', 0.85);
    c.fillText('項目', COLS[0]!.x + 16, rowY(1) + 38);
    c.textAlign = 'right';
    [GROOM, BRIDE, '合計'].forEach((s, i) => c.fillText(s, COLS[i + 1]!.x + COLS[i + 1]!.w - 14, rowY(1) + 38));
    c.textAlign = 'left';
    c.font = font(F.hei(500), 25); c.fillStyle = rgba('sepia', 0.9);
    this.rows.forEach((r, i) => c.fillText(r.label, COLS[0]!.x + 16, rowY(i + 2) + 38));
    c.font = font(F.hei(700), 26);
    c.fillText('總計', COLS[0]!.x + 16, rowY(TOTAL_ROW) + 38);
    // 總計列上面的雙線（會計的慣例）
    c.fillStyle = rgba('sepia', 0.6);
    c.fillRect(COLS[1]!.x, rowY(TOTAL_ROW) - 2, COLS[3]!.x + COLS[3]!.w - COLS[1]!.x, 1.2);
    c.fillRect(COLS[1]!.x, rowY(TOTAL_ROW) + 2, COLS[3]!.x + COLS[3]!.w - COLS[1]!.x, 1.2);
    // 長條圖的框（浮在工作表上：紙色底、細框、一點點陰影）
    c.fillStyle = rgba('sepia', 0.08); c.fillRect(CHART.x + 6, CHART.y + 7, CHART.w, CHART.h);
    c.fillStyle = rgba('paper'); c.fillRect(CHART.x, CHART.y, CHART.w, CHART.h);
    c.strokeStyle = rgba('sepia', 0.4); c.lineWidth = 1.2; c.strokeRect(CHART.x + 0.5, CHART.y + 0.5, CHART.w, CHART.h);
    c.font = font(F.hei(700), 22); c.fillStyle = rgba('sepia', 0.9);
    c.fillText('幸福指數', CHART.x + 22, CHART.y + 38);
    c.font = font(F.mono(400), 15); c.fillStyle = rgba('sepia', 0.55); c.letterSpacing = '1px';
    c.fillText('每拍即時更新', CHART.x + 128, CHART.y + 37);
    c.letterSpacing = '0px';
    const pb = this.plotBox();
    c.fillStyle = rgba('sepia', 0.5); c.fillRect(pb.x, pb.y + pb.h, pb.w, 1.2);
    c.font = font(F.mono(400), 14); c.fillStyle = rgba('sepia', 0.5); c.textAlign = 'right';
    for (const [v, lab] of [[0, '0'], [0.5, '50'], [1, '100']] as const) {
      c.fillText(lab, pb.x - 10, pb.y + pb.h - v * pb.h + 5);
      if (v > 0) { c.fillStyle = rgba('sepia', 0.1); c.fillRect(pb.x, pb.y + pb.h - v * pb.h, pb.w, 1); c.fillStyle = rgba('sepia', 0.5); }
    }
    c.textAlign = 'left';
    // 工作表分頁（左下）
    const tabs = ['幸福統計', '賓客祝福', '芃芃與 QQ', '＋'];
    let x = RH_X;
    c.font = font(F.hei(500), 20);
    tabs.forEach((tb, i) => {
      const w = c.measureText(tb).width + 44;
      if (i === 0) { c.fillStyle = rgba('paper'); c.fillRect(x, GRID_B, w, 44); c.fillStyle = rgba('blood', 0.9); c.fillRect(x, GRID_B + 41, w, 3); }
      c.strokeStyle = rgba('sepia', 0.25); c.strokeRect(x + 0.5, GRID_B + 0.5, w, 44);
      c.fillStyle = rgba('sepia', i === 0 ? 0.95 : 0.55);
      c.fillText(tb, x + 22, GRID_B + 30);
      x += w;
    });
  }

  private plotBox() { return { x: CHART.x + 62, y: CHART.y + 62, w: CHART.w - 90, h: CHART.h - 92 }; }

  // ------------------------------------------------------------ 選取框
  /** 這一格選取框的範圍（像素），在兩個位置之間用 outExpo 滑過去。 */
  private selection(t: number): Sel {
    let i = 0;
    while (i + 1 < this.keys.length && this.keys[i + 1]!.t <= t) i++;
    const cur = this.keys[i]!, prev = this.keys[Math.max(0, i - 1)]!;
    const u = i === 0 ? 1 : prog(t, cur.t, cur.t + 0.22, ease.outExpo);
    const rectOf = (k: Key) => {
      const a = COLS[k.c0]!, b = COLS[k.c1]!;
      return { x: a.x, y: rowY(k.r0), w: b.x + b.w - a.x, h: rowY(k.r1) + RH - rowY(k.r0) };
    };
    const A = rectOf(prev), Bk = rectOf(cur);
    return {
      key: cur,
      x: lerp(A.x, Bk.x, u), y: lerp(A.y, Bk.y, u), w: lerp(A.w, Bk.w, u), h: lerp(A.h, Bk.h, u),
      moving: u < 1, since: t - cur.t,
    };
  }

  private drawHeaders(c: CanvasRenderingContext2D, sel: Sel) {
    // 目前選到的欄與列：欄名、列號的底色變深（試算表本來就會這樣）
    c.fillStyle = rgba('signal', 0.32);
    c.fillRect(sel.x, HDR_Y + 1, sel.w, HDR_H - 1);
    c.fillRect(RH_X + 1, sel.y, RH_W - 1, sel.h);
    c.fillStyle = rgba('blood', 0.85);
    c.fillRect(sel.x, HDR_Y + HDR_H - 3, sel.w, 3);
    c.fillRect(RH_X + RH_W - 3, sel.y, 3, sel.h);
  }

  private drawSelection(c: CanvasRenderingContext2D, t: number, sel: Sel) {
    // 範圍選取：淡淡的底色；外框粗線；右下角的填滿控點（小方塊）
    c.fillStyle = rgba('signal', 0.16);
    c.fillRect(sel.x, sel.y, sel.w, sel.h);
    c.strokeStyle = rgba('blood', 0.95); c.lineWidth = 3.5;
    c.strokeRect(sel.x + 1, sel.y + 1, sel.w - 1, sel.h - 1);
    const hx = sel.x + sel.w, hy = sel.y + sel.h;
    c.fillStyle = rgba('paper'); c.fillRect(hx - 7, hy - 7, 14, 14);
    c.fillStyle = rgba('blood'); c.fillRect(hx - 5, hy - 5, 10, 10);
    // 合計列算出來的那一刻：公式的小提示框
    if (t >= this.tTotal && t < this.tTotal + 1.2 * this.ctx.audio.beatPeriod(t)) {
      const d = COLS[3]!, x = d.x + d.w - 176, y = rowY(TOTAL_ROW) + RH + 8;
      const a = prog(t, this.tTotal, this.tTotal + 0.12) * (1 - prog(t, this.tTotal + 0.9 * this.ctx.audio.beatPeriod(t), this.tTotal + 1.2 * this.ctx.audio.beatPeriod(t)));
      c.save(); c.globalAlpha *= a;
      c.fillStyle = rgba('sepia', 0.92); c.fillRect(x, y, 176, 40);
      c.font = font(F.mono(500), 22); c.fillStyle = rgba('paper');
      c.fillText('=SUM(愛)', x + 16, y + 28);
      c.restore();
    }
  }

  // ------------------------------------------------------------ 表格的數值
  private drawTable(c: CanvasRenderingContext2D, t: number) {
    c.textAlign = 'right';
    this.rows.forEach((r, i) => {
      const t0 = this.keys[i + 1]!.t;
      [r.b, r.c, r.d].forEach((v, j) => {
        const tj = t0 + j * 0.07;
        if (t < tj) return;
        const u = prog(t, tj, tj + 0.18, ease.outBack);
        const col = COLS[j + 1]!;
        c.font = font(j === 2 ? F.mono(600) : F.mono(500), 30);
        c.fillStyle = rgba('sepia', j === 2 ? 0.95 : 0.85);
        c.fillText(v, col.x + col.w - 14, rowY(i + 2) + 40 + (1 - u) * 14);
      });
    });
    // 總計 ∞：算出來的時候彈一下，之後每個小節線「重新計算」閃一下
    if (t >= this.tTotal) {
      const d = COLS[3]!;
      const bar = this.ctx.audio.barAt(t), sinceBar = (bar - Math.floor(bar)) * 4 * this.ctx.audio.beatPeriod(t);
      const recalc = t > this.tTotal + 1 ? Math.max(0, 1 - sinceBar / 0.35) : 0;
      const u = prog(t, this.tTotal + 0.08, this.tTotal + 0.4, ease.outBack);
      c.fillStyle = rgba('signal', 0.25 + 0.4 * recalc + 0.4 * (1 - prog(t, this.tTotal, this.tTotal + 0.6)));
      c.fillRect(d.x + 1, rowY(TOTAL_ROW) + 4, d.w - 1, RH - 4);
      c.save();
      c.translate(d.x + d.w - 14, rowY(TOTAL_ROW) + 44);
      c.scale(0.6 + 0.4 * u, 0.6 + 0.4 * u);
      c.font = font(F.archivo(100, 900), 46); c.fillStyle = rgba('blood');
      c.fillText('∞', 0, 0);
      c.restore();
    }
    c.textAlign = 'left';
  }

  // ------------------------------------------------------------ 長條圖
  private drawChart(c: CanvasRenderingContext2D, t: number) {
    const pb = this.plotBox();
    const au = this.ctx.audio;
    const done = this.beats.filter((b) => b <= t);
    const n = done.length;
    if (!n) return;
    const slot = pb.w / SLOTS, bw = slot * 0.62;
    // 滿了之後每長一根就往左捲一格（捲動用 outExpo，停在拍點）
    const last = done[n - 1]!;
    const shift = n > SLOTS ? (n - SLOTS - 1 + prog(t, last, last + 0.25, ease.outExpo)) : 0;
    c.save();
    c.beginPath(); c.rect(pb.x, pb.y - 10, pb.w, pb.h + 10); c.clip();
    for (let i = Math.max(0, n - SLOTS - 1); i < n; i++) {
      const bt = done[i]!;
      const v = clamp(0.28 + 0.8 * au.env('rms', bt + 0.04) + 0.12 * (hash(i, 7) - 0.5), 0.12, 0.98);
      const g = prog(t, bt, bt + 0.22, ease.outBack);
      const x = pb.x + (i - shift) * slot + (slot - bw) / 2;
      const h = pb.h * v * g;
      c.fillStyle = i === n - 1 ? rgba('blood', 0.9) : rgba('sepia', 0.32);
      c.fillRect(x, pb.y + pb.h - h, bw, h);
    }
    c.restore();
    // 右上角的最新讀數
    c.font = font(F.mono(600), 20); c.fillStyle = rgba('blood'); c.textAlign = 'right';
    c.fillText(n >= SLOTS ? '破表' : `第 ${n} 拍`, CHART.x + CHART.w - 20, CHART.y + 37);
    c.textAlign = 'left';
  }

  // ------------------------------------------------------------ 合併儲存格（主打留言）
  /** 回傳仙女棒的位置（描外框的時候）。 */
  private drawMerge(c: CanvasRenderingContext2D, t: number): { x: number; y: number } | null {
    const au = this.ctx.audio, m = this.msg;
    const M = MERGE, per = 2 * (M.w + M.h);
    // 描外框：第一拍開始，一拍描完一圈
    const tr = prog(t, this.tTrace, this.tPaste, ease.inOutCubic);
    let head: { x: number; y: number } | null = null;
    if (tr > 0 && tr < 1) {
      const pts = [[M.x, M.y], [M.x + M.w, M.y], [M.x + M.w, M.y + M.h], [M.x, M.y + M.h], [M.x, M.y]];
      c.strokeStyle = rgba('blood', 0.9); c.lineWidth = 2.5;
      c.beginPath(); c.moveTo(M.x, M.y);
      let acc = 0; const len = per * tr;
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1]!, [bx, by] = pts[i]!;
        const sl = Math.hypot(bx! - ax!, by! - ay!);
        if (acc + sl <= len) { c.lineTo(bx!, by!); acc += sl; continue; }
        const u = (len - acc) / sl;
        head = { x: lerp(ax!, bx!, u), y: lerp(ay!, by!, u) };
        c.lineTo(head.x, head.y);
        break;
      }
      c.stroke();
    } else if (tr >= 1) {
      // 貼上之後：複製的虛線（螞蟻線），一拍跑一格虛線的長度
      const bp = au.beatAt(t);
      c.save();
      c.setLineDash([14, 10]); c.lineDashOffset = -bp * 24;
      c.strokeStyle = rgba('blood', 0.9); c.lineWidth = 3;
      c.strokeRect(M.x + 2, M.y + 2, M.w - 3, M.h - 3);
      c.restore();
      // 貼上的那一刻整格亮一下
      c.fillStyle = rgba('signal', 0.3 * (1 - prog(t, this.tPaste, this.tPaste + 0.8)));
      c.fillRect(M.x + 3, M.y + 3, M.w - 5, M.h - 5);
    }
    // 儲存格標籤（mono 小字）
    c.font = font(F.mono(500), 17); c.letterSpacing = '2px'; c.fillStyle = rgba('sepia', 0.6);
    const tag = m ? `E1:I11 · 祝福 NO.${String(m.n).padStart(3, '0')}${m.couple ? ' · 新人' : ''}` : 'E1:I11 · 空白儲存格';
    c.fillText(tag, M.x + 30, M.y + 40);
    c.letterSpacing = '0px';
    if (tr < 1) return head;
    if (m && this.fit) {
      // 一行一行貼上：每行一個快速的左到右擦入，整則在一小節內貼完
      const fit = this.fit, nl = fit.lines.length;
      const beat = au.beatPeriod(t);
      const step = Math.min(beat * 0.5, 2.2 / nl);
      const x = M.x + 32;
      let chars = 0;
      fit.lines.forEach((ln, i) => {
        const u = prog(t, this.tPaste + i * step, this.tPaste + i * step + 0.28, ease.outCubic);
        if (u > 0) chars += u >= 1 ? Array.from(ln).length : Math.ceil(Array.from(ln).length * u);
      });
      drawMessage(c, fit, F.hand(400), x, this.msgTop, { chars, color: rgba('sepia', 0.95) });
      const tSig = this.tPaste + nl * step + 0.15;
      const ka = prog(t, tSig, tSig + 0.35);
      if (ka > 0) {
        c.save(); c.globalAlpha *= ka;
        c.font = font(F.hand(400), 44); c.fillStyle = rgba('sepia', 0.7); c.textAlign = 'right';
        c.fillText(signature(m.name), M.x + M.w - 34, this.msgTop + fit.height - fit.size * 0.9 + 76);
        c.restore();
      }
    } else {
      // 沒有留言：空白的一格，游標在閃，旁邊一句邀請
      const ka = prog(t, this.tPaste, this.tPaste + 0.4);
      c.save(); c.globalAlpha *= ka;
      const cy = M.y + M.h / 2 - 20;
      c.font = font(F.hand(700), 64); c.fillStyle = rgba('sepia', 0.9);
      c.fillText('這一格', M.x + 40, cy);
      c.fillText('留給你的祝福', M.x + 40, cy + 84);
      const blink = Math.floor(au.beatAt(t) * 2) % 2 === 0 ? 1 : 0;
      c.fillStyle = rgba('blood', blink);
      c.fillRect(M.x + 40 + c.measureText('留給你的祝福').width + 10, cy + 84 - 56, 4, 68);
      c.font = font(F.hei(500), 26); c.fillStyle = rgba('sepia', 0.65);
      c.fillText('掃描右下角 QR code，寫下想對新人說的話', M.x + 40, cy + 170);
      c.restore();
    }
    return head;
  }

  // ------------------------------------------------------------ 公式列（歌詞）
  private drawFormulaBar(c: CanvasRenderingContext2D, t: number, sel: Sel, lyrics: Lyrics) {
    // 位址框：選取框的左上角那一格（範圍選取時寫 B3:D3）
    const k = sel.key;
    const ref = `${COLS[k.c0]!.k}${k.r0}${k.c1 !== k.c0 || k.r1 !== k.r0 ? `:${COLS[k.c1]!.k}${k.r1}` : ''}`;
    c.font = font(F.mono(600), ref.length > 3 ? 26 : 32); c.fillStyle = rgba('sepia', 0.9); c.textAlign = 'center';
    c.fillText(ref, FB.x + REF_W / 2, FB.y + FB.h / 2 + 11);
    c.textAlign = 'left';
    const ly = lyricAt(lyrics, t);
    const maxW = FB.x + FB.w - FB_TEXT_X - 24;
    if (ly) {
      const st = { family: F.archivo(100, 700), size: 58, minSize: 48, maxWidth: maxW, active: rgba('blood'), sung: rgba('sepia', 0.95), unsung: rgba('sepia', 0.28), lineHeight: 1.12 };
      const lay = layoutLyric(c, ly.line, st);
      const y = FB.y + (FB.h - lay.height) / 2 + lay.size * 0.8;
      c.save(); c.translate(FB_TEXT_X, y);
      drawLyric(c, ly.line, t, st, lay, ly.k);
      c.restore();
    } else {
      // 沒在唱：公式列顯示這一格的公式（打字機一樣打出來）
      const n = Math.ceil(k.formula.length * prog(sel.since, 0, 0.25));
      c.font = font(F.mono(500), 44); c.fillStyle = rgba('sepia', 0.8);
      c.fillText(k.formula.slice(0, n), FB_TEXT_X, FB.y + FB.h / 2 + 15);
    }
  }

  private drawStatus(c: CanvasRenderingContext2D) {
    const { live } = this.ctx;
    c.font = font(F.mono(500), 18); c.letterSpacing = '2px'; c.fillStyle = rgba('sepia', 0.6); c.textAlign = 'right';
    c.fillText(`就緒　·　計數 ${live.count} 則祝福　·　總和 ∞`, 1320, GRID_B + 30);
    c.textAlign = 'left'; c.letterSpacing = '0px';
  }
}
