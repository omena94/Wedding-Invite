// 試算表（批次 T6・螢幕 B，亮）：白天、一台亮著的螢幕上開著一張試算表，鏡頭斜斜地貼近，淺景深。
// MV 檢修後：不再是整張「介面截圖」，只留三樣東西——
//  - 右邊一大格合併儲存格，主打留言被「貼上」在裡面（手寫字，整個畫面最大最清楚）：仙女棒先沿著外框描一圈，
//    接著一行一行貼上，外框變成複製時的虛線（螞蟻線）跟著拍子跑。沒有留言時這一格是空白的，等你來寫。
//  - 上面的公式列：fx 後面就是正在唱的歌詞（逐字跟唱，小一級）；沒在唱時顯示選到那一格的公式（=SUM(愛)）。
//  - 左邊的「幸福統計表」往後退、糊在景深裡：一拍填一列，選取框像拖曳填滿一樣往下滑，最後一列算出 ∞。
// 圖表、分頁、狀態列、儲存格標籤都拿掉了；小字只剩欄名列號與表格裡的數字（低對比）。
// 手法：螢幕內容畫在一張 Canvas 層（mipmap），用 _t6 的 ScreenRig 擺進三維空間（左邊往後退、兩個對焦範圍：公式列與留言），
// 房間是一個 GLSL pass（淺色的牆、螢幕下緣的影子、一道斜斜的窗光）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import type { FitResult } from '../engine/text';
import type { Lyrics } from '../engine/lyrics';
import { lyricAt, drawLyric, layoutLyric, drawMessage, signature, sparkHead, sparkParticles, beatAfter, COUPLE_ZH } from './_motifs';
import { beatsIn, inOut, fitMessage, ScreenRig, mipRT, blitToRT, loadPlateText } from './_t6';

export const spec: PlateSpecDecl = { group: 'type', family: 'screen', paper: true, energy: [0.25, 0.8], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 螢幕（貼圖座標，y 向下）
const SW = 1600, SH = 1000;
const FB = { x: 40, y: 36, w: SW - 80, h: 116 }; // 公式列
const REF_W = 150;
const FX_X = FB.x + REF_W + 22;
const FB_TEXT_X = FX_X + 70;
const HDR_Y = 168, HDR_H = 36;
const RH_X = 40, RH_W = 46;
const ROW0 = HDR_Y + HDR_H, RH = 62;
const COLS = [
  { k: 'A', x: 86, w: 236 }, { k: 'B', x: 322, w: 116 }, { k: 'C', x: 438, w: 116 }, { k: 'D', x: 554, w: 116 },
  { k: 'E', x: 670, w: 178 }, { k: 'F', x: 848, w: 178 }, { k: 'G', x: 1026, w: 178 }, { k: 'H', x: 1204, w: 178 }, { k: 'I', x: 1382, w: 178 },
];
const GRID_R = 1560;
const rowY = (r: number) => ROW0 + (r - 1) * RH;
/** 合併儲存格 E1:I12（主打留言）。 */
const MERGE = { x: 670, y: rowY(1), w: GRID_R - 670, h: rowY(13) - rowY(1) };
const TOTAL_ROW = 6;

const [GROOM, BRIDE] = COUPLE_ZH.split(/\s*&\s*/) as [string, string];
interface Row { label: string; b: string; c: string; d: string; fd: string }
const ROWS = (bpm: number): Row[] => [
  { label: '心跳（下／分）', b: String(bpm), c: String(bpm), d: '同步', fd: '=IF(B2=C2,"同步")' },
  { label: '牽手（次／日）', b: '12', c: '12', d: '24', fd: '=B3+C3' },
  { label: '遛芃芃與 QQ', b: '1', c: '1', d: '2', fd: '=B4+C4' },
  { label: '搶棉被（次）', b: '1', c: '3', d: '4', fd: '=B5+C5' },
];
const TEXT = `項目合計總計這一格留給你的祝福掃描右下角寫下想對新人說的話心跳下分牽手次日遛搶棉被同步${GROOM}${BRIDE}`;

// 房間：淺色的牆（紙色，比螢幕暗一點，才不會刺眼）、螢幕下緣投在桌上的影子、一道斜斜的窗光
const BG = () => new FSPass(/* glsl */ `
  uniform vec2 c; uniform vec2 r; uniform float k;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float n = fbm(p / 420.0, 3);
    vec3 col = C_PAPER * (0.8 + 0.03 * n - 0.1 * smoothstep(300.0, 1100.0, p.y));
    float beam = smoothstep(0.0, 260.0, 600.0 - abs(p.x * 0.8 + p.y * 0.55 - 900.0));
    col += C_PAPER * 0.07 * beam;
    vec2 d = (p - c - vec2(0.0, r.y * 0.9)) / vec2(r.x * 1.05, r.y * 0.28);
    col *= 1.0 - 0.18 * exp(-dot(d, d) * 1.4);
    fragColor = vec4(col * mix(0.85, 1.0, k), 1.0);
  }`, { c: { value: new THREE.Vector2(960, 540) }, r: { value: new THREE.Vector2(800, 500) }, k: { value: 1 } });

interface Key { t: number; c0: number; r0: number; c1: number; r1: number; formula: string }
interface Sel { key: Key; x: number; y: number; w: number; h: number; since: number }

export default class Spreadsheet extends Scene {
  bg = shared('spreadsheet.bg', BG);
  scr = this.track(new Layer2D(SW, SH, undefined, { fast: true }));
  scrRT = this.track(mipRT(SW, SH));
  rig = new ScreenRig(this.scrRT.texture, SW, SH, { decode: false, bezel: 30, radius: 18 });
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  rows: Row[] = ROWS(Math.round(this.ctx.audio.bpm || 100));
  beats: number[] = [];
  keys: Key[] = [];
  fit: FitResult | null = null;
  msgTop = 0;
  tPaste = 0; tTrace = 0; tTotal = 0;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadPlateText(this.ctx, TEXT);
    const b0 = beatAfter(au, s + 0.05);
    const beat = au.beatPeriod(b0);
    this.beats = beatsIn(au, b0, e + beat);
    const B = (i: number) => this.beats[Math.min(i, this.beats.length - 1)] ?? b0 + i * beat;
    // 仙女棒描外框從第一拍開始，描完（一拍）馬上貼上留言
    this.tTrace = b0;
    this.tPaste = b0 + Math.min(beat, 0.7);
    this.tTotal = B(this.rows.length + 1);
    // 選取框的行程：先停在 B2，一拍一列往下（B:D 整列），接著跳到合計，之後每兩拍跳到表格裡隨機一格
    this.keys.push({ t: s - 1, c0: 1, r0: 2, c1: 1, r1: 2, formula: this.rows[0]!.b });
    this.rows.forEach((r, i) => this.keys.push({ t: B(i + 1), c0: 1, r0: i + 2, c1: 3, r1: i + 2, formula: r.fd }));
    this.keys.push({ t: this.tTotal, c0: 3, r0: TOTAL_ROW, c1: 3, r1: TOTAL_ROW, formula: '=SUM(愛)' });
    const rnd = (k: number) => hash(this.ctx.params.seed ?? 1, k);
    for (let i = this.rows.length + 3, k = 0; i < this.beats.length; i += 2, k++) {
      const col = 1 + Math.floor(rnd(k) * 3), row = 2 + Math.floor(rnd(k + 50) * this.rows.length);
      const r = this.rows[row - 2]!;
      this.keys.push({ t: B(i), c0: col, r0: row, c1: col, r1: row, formula: col === 3 ? r.fd : col === 1 ? r.b : r.c });
    }
    const c = this.scr.ctx;
    const text = this.msg ? this.msg.text : '這一格留給你的祝福';
    // 亮螢幕上細的手寫字會發灰：留言用粗一點的文楷
    this.fit = fitMessage(c, text, F.hand(700), MERGE.w - 110, MERGE.h - (this.msg ? 190 : 260), { min: 52, max: this.msg ? 136 : 84, lineHeight: 1.26 });
    const block = this.fit.height + (this.msg ? 90 : 120);
    this.msgTop = MERGE.y + Math.max(40, (MERGE.h - block) / 2) + this.fit.size * 0.9;
  }

  override dispose() { this.rig.dispose(); super.dispose(); }

  /** 鏡頭：斜斜貼近，左邊（表格）往後退；整個窗格很慢地往留言推，每個小節線再推一點點。 */
  private pose(t: number) {
    const au = this.ctx.audio, s = this.ctx.start, e = this.ctx.end;
    const u = ease.inOutCubic(clamp((t - s) / Math.max(1, e - s)));
    const bars = Math.max(0, au.barAt(t) - au.barAt(this.tPaste));
    const step = Math.min(6, Math.floor(bars) + prog(bars - Math.floor(bars), 0, 0.3, ease.outExpo));
    const inK = prog(t, s, s + 0.8, ease.outCubic);
    this.rig.pose({
      fx: MERGE.x + MERGE.w * 0.45, fy: SH * 0.52, cx: lerp(1010, 980, u), cy: 560,
      scale: lerp(0.8, 0.86, u) * (1 + 0.01 * step) * lerp(0.95, 1, inK), rx: -0.04, ry: lerp(-0.34, -0.28, u) - 0.05 * (1 - inK), rz: 0.008,
    });
    // 對焦：公式列（歌詞）與合併儲存格（留言）；左邊的表格糊掉
    this.rig.focus(MERGE.x - 20, MERGE.y - 20, SW, SH, 85, [FB.x, FB.y - 10, FB.x + FB.w, FB.y + FB.h + 10]);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const k = inOut(t, s, e, 0.3, 0.25);
    this.pose(t);
    const c0 = this.rig.toScreen(SW / 2, SH / 2), c1 = this.rig.toScreen(SW, SH);
    (this.bg.u.c!.value as THREE.Vector2).set(c0.x, c0.y);
    (this.bg.u.r!.value as THREE.Vector2).set(Math.abs(c1.x - c0.x), Math.abs(c1.y - c0.y));
    this.bg.u.k!.value = k;
    this.bg.render(renderer, out);
    const head = this.drawScreen(t);
    blitToRT(renderer, this.ctx.comp, this.scr.texture, this.scrRT);
    const U = this.rig.u;
    (U.backCol!.value as THREE.Vector3).set(...LIN.paper);
    const bz = [0, 1, 2].map((i) => LIN.paper[i]! * 0.55 + LIN.sepia[i]! * 0.2) as [number, number, number];
    (U.bezelCol!.value as THREE.Vector3).set(...bz);
    (U.rimCol!.value as THREE.Vector3).set(...LIN.paper);
    U.gain!.value = 0.97;
    U.edgeDark!.value = 0.12;
    U.glare!.value = 0.35 - 0.3 * f.p;
    U.glareK!.value = 2;
    U.k!.value = k;
    this.rig.render(renderer, out);
    this.glow.clear();
    if (head && k > 0.5) {
      const p = this.rig.toScreen(head.x, head.y);
      sparkParticles(this.glow, t, (tt) => { const h = this.traceHead(tt); return h ? this.rig.toScreen(h.x, h.y) : null; }, { rate: 90, life: 0.35, speed: 210, seed: 11 });
      sparkHead(this.glow, p.x, p.y, t, 0.9);
    }
    if (this.glow.count) this.glow.render(renderer, out);
    return { paper: 1, bloom: 0.3, vignette: 0.3, grain: 0.035 };
  }

  // ------------------------------------------------------------ 螢幕內容
  private drawScreen(t: number): { x: number; y: number } | null {
    const L = this.scr; L.clear();
    const c = L.ctx;
    c.textBaseline = 'alphabetic';
    const sel = this.selection(t);
    this.drawGrid(c, sel);
    this.drawTable(c, t);
    this.drawSelection(c, sel);
    const head = this.drawMerge(c, t);
    this.drawFormulaBar(c, t, sel, this.ctx.lyrics);
    L.upload();
    return head;
  }

  /** 格線、欄名列號（很淡）、表格的標籤。 */
  private drawGrid(c: CanvasRenderingContext2D, sel: Sel) {
    c.fillStyle = rgba('sepia', 0.045);
    c.fillRect(RH_X, HDR_Y, GRID_R - RH_X, HDR_H);
    c.fillRect(RH_X, ROW0, RH_W, SH - ROW0);
    // 選到的欄與列：欄名、列號的底色深一點
    c.fillStyle = rgba('signal', 0.28);
    c.fillRect(sel.x, HDR_Y, sel.w, HDR_H);
    c.fillRect(RH_X, sel.y, RH_W, sel.h);
    c.fillStyle = rgba('sepia', 0.12);
    for (const x of [...COLS.map((cl) => cl.x), GRID_R]) {
      if (x > MERGE.x && x < MERGE.x + MERGE.w) c.fillRect(x, HDR_Y, 1, HDR_H);
      else c.fillRect(x, HDR_Y, 1, SH - HDR_Y);
    }
    for (let y = ROW0; y <= SH; y += RH) c.fillRect(RH_X, y, (y > MERGE.y && y < MERGE.y + MERGE.h ? MERGE.x : GRID_R) - RH_X, 1);
    c.font = font(F.mono(500), 18); c.fillStyle = rgba('sepia', 0.4); c.textAlign = 'center';
    for (const col of COLS) c.fillText(col.k, col.x + col.w / 2, HDR_Y + 25);
    for (let r = 1; rowY(r) + RH <= SH + 4; r++) c.fillText(String(r), RH_X + RH_W / 2, rowY(r) + RH / 2 + 6);
    c.textAlign = 'left';
    c.font = font(F.hei(700), 24); c.fillStyle = rgba('sepia', 0.7);
    c.fillText('項目', COLS[0]!.x + 14, rowY(1) + 40);
    c.textAlign = 'right';
    [GROOM, BRIDE, '合計'].forEach((s, i) => c.fillText(s, COLS[i + 1]!.x + COLS[i + 1]!.w - 12, rowY(1) + 40));
    c.textAlign = 'left';
    c.font = font(F.hei(500), 23); c.fillStyle = rgba('sepia', 0.7);
    this.rows.forEach((r, i) => c.fillText(r.label, COLS[0]!.x + 14, rowY(i + 2) + 40));
    c.font = font(F.hei(700), 24);
    c.fillText('總計', COLS[0]!.x + 14, rowY(TOTAL_ROW) + 40);
    c.fillStyle = rgba('sepia', 0.45);
    c.fillRect(COLS[1]!.x, rowY(TOTAL_ROW) - 2, COLS[3]!.x + COLS[3]!.w - COLS[1]!.x, 1.2);
    c.fillRect(COLS[1]!.x, rowY(TOTAL_ROW) + 2, COLS[3]!.x + COLS[3]!.w - COLS[1]!.x, 1.2);
  }

  /** 選取框（在兩個位置之間用 outExpo 滑過去）。 */
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
    return { key: cur, x: lerp(A.x, Bk.x, u), y: lerp(A.y, Bk.y, u), w: lerp(A.w, Bk.w, u), h: lerp(A.h, Bk.h, u), since: t - cur.t };
  }

  private drawSelection(c: CanvasRenderingContext2D, sel: Sel) {
    c.fillStyle = rgba('signal', 0.14); c.fillRect(sel.x, sel.y, sel.w, sel.h);
    c.strokeStyle = rgba('blood', 0.85); c.lineWidth = 3.5;
    c.strokeRect(sel.x + 1, sel.y + 1, sel.w - 1, sel.h - 1);
    c.fillStyle = rgba('blood'); c.fillRect(sel.x + sel.w - 5, sel.y + sel.h - 5, 10, 10);
  }

  /** 表格的數值：一拍一列；總計 ∞ 算出來的時候彈一下。 */
  private drawTable(c: CanvasRenderingContext2D, t: number) {
    c.textAlign = 'right';
    this.rows.forEach((r, i) => {
      const t0 = this.keys[i + 1]!.t;
      [r.b, r.c, r.d].forEach((v, j) => {
        const tj = t0 + j * 0.07;
        if (t < tj) return;
        const u = prog(t, tj, tj + 0.18, ease.outBack);
        const col = COLS[j + 1]!;
        c.font = font(F.mono(500), 28); c.fillStyle = rgba('sepia', 0.7);
        c.fillText(v, col.x + col.w - 12, rowY(i + 2) + 41 + (1 - u) * 12);
      });
    });
    if (t >= this.tTotal) {
      const d = COLS[3]!;
      const u = prog(t, this.tTotal + 0.08, this.tTotal + 0.4, ease.outBack);
      c.fillStyle = rgba('signal', 0.3 * (1 - prog(t, this.tTotal, this.tTotal + 0.8)) + 0.12);
      c.fillRect(d.x + 1, rowY(TOTAL_ROW) + 4, d.w - 1, RH - 4);
      c.save();
      c.translate(d.x + d.w - 12, rowY(TOTAL_ROW) + 46);
      c.scale(0.6 + 0.4 * u, 0.6 + 0.4 * u);
      c.font = font(F.archivo(100, 900), 42); c.fillStyle = rgba('blood', 0.85);
      c.fillText('∞', 0, 0);
      c.restore();
    }
    c.textAlign = 'left';
  }

  /** 仙女棒描外框時的筆尖（貼圖座標），沒在描是 null。 */
  private traceHead(t: number): { x: number; y: number } | null {
    const tr = prog(t, this.tTrace, this.tPaste, ease.inOutCubic);
    if (tr <= 0 || tr >= 1) return null;
    const M = MERGE, per = 2 * (M.w + M.h);
    let len = per * tr;
    const pts: [number, number][] = [[M.x, M.y], [M.x + M.w, M.y], [M.x + M.w, M.y + M.h], [M.x, M.y + M.h], [M.x, M.y]];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1]!, [bx, by] = pts[i]!;
      const sl = Math.hypot(bx - ax, by - ay);
      if (len <= sl) return { x: lerp(ax, bx, len / sl), y: lerp(ay, by, len / sl) };
      len -= sl;
    }
    return null;
  }

  /** 合併儲存格：描框、貼上留言、螞蟻線。回傳仙女棒的位置（描外框的時候）。 */
  private drawMerge(c: CanvasRenderingContext2D, t: number): { x: number; y: number } | null {
    const au = this.ctx.audio, m = this.msg, M = MERGE;
    const tr = prog(t, this.tTrace, this.tPaste, ease.inOutCubic);
    const head = this.traceHead(t);
    if (tr > 0 && tr < 1) {
      // 描到哪畫到哪（沿著外框的折線）
      const per = 2 * (M.w + M.h);
      c.strokeStyle = rgba('blood', 0.8); c.lineWidth = 2.5;
      c.setLineDash([per * tr, per]); c.lineDashOffset = 0;
      c.strokeRect(M.x, M.y, M.w, M.h);
      c.setLineDash([]);
    } else if (tr >= 1) {
      c.save();
      c.setLineDash([14, 10]); c.lineDashOffset = -au.beatAt(t) * 24;
      c.strokeStyle = rgba('blood', 0.7); c.lineWidth = 2.5;
      c.strokeRect(M.x + 2, M.y + 2, M.w - 3, M.h - 3);
      c.restore();
      c.fillStyle = rgba('signal', 0.25 * (1 - prog(t, this.tPaste, this.tPaste + 0.8)));
      c.fillRect(M.x + 3, M.y + 3, M.w - 5, M.h - 5);
    }
    if (tr < 1) return head;
    const fit = this.fit!;
    const x = M.x + 56;
    if (m) {
      // 一行一行貼上：每行一個快速的左到右擦入，整則在一小節內貼完
      const nl = fit.lines.length;
      const beat = au.beatPeriod(t);
      const step = Math.min(beat * 0.5, 2.2 / nl);
      let chars = 0;
      fit.lines.forEach((ln, i) => {
        const u = prog(t, this.tPaste + i * step, this.tPaste + i * step + 0.28, ease.outCubic);
        if (u > 0) chars += u >= 1 ? Array.from(ln).length : Math.ceil(Array.from(ln).length * u);
      });
      drawMessage(c, fit, F.hand(700), x, this.msgTop, { chars, color: rgba('sepia', 0.98) });
      const tSig = this.tPaste + nl * step + 0.15;
      const ka = prog(t, tSig, tSig + 0.35);
      if (ka > 0) {
        c.save(); c.globalAlpha *= ka;
        c.font = font(F.hand(400), 52); c.fillStyle = rgba('sepia', 0.72); c.textAlign = 'right';
        c.fillText(signature(m.name), M.x + M.w - 60, this.msgTop + fit.height - fit.size * 0.9 + 86);
        c.restore();
      }
    } else {
      // 沒有留言：空白的一格，游標在閃，一句邀請（小一號，焦點讓給歌詞）
      const ka = prog(t, this.tPaste, this.tPaste + 0.4);
      c.save(); c.globalAlpha *= ka;
      drawMessage(c, fit, F.hand(700), x, this.msgTop, { color: rgba('sepia', 0.55) });
      const last = fit.lines[fit.lines.length - 1]!;
      c.font = font(F.hand(700), fit.size);
      const blink = Math.floor(au.beatAt(t) * 2) % 2 === 0 ? 0.9 : 0;
      c.fillStyle = rgba('blood', blink);
      c.fillRect(x + c.measureText(last).width + 10, this.msgTop + fit.height - fit.size * 1.75, 4, fit.size * 1.05);
      c.font = font(F.hei(500), 26); c.fillStyle = rgba('sepia', 0.45);
      c.fillText('掃描右下角 QR code，寫下想對新人說的話', x, this.msgTop + fit.height - fit.size * 0.9 + 80);
      c.restore();
    }
    return head;
  }

  /** 公式列：fx 後面是歌詞；沒在唱時是選到那一格的公式。 */
  private drawFormulaBar(c: CanvasRenderingContext2D, t: number, sel: Sel, lyrics: Lyrics) {
    c.strokeStyle = rgba('sepia', 0.22); c.lineWidth = 1.5;
    c.strokeRect(FB.x + 0.5, FB.y + 0.5, REF_W, FB.h);
    c.strokeRect(FB.x + REF_W + 10.5, FB.y + 0.5, FB.w - REF_W - 10, FB.h);
    c.font = font(F.serif(600, true), 40); c.fillStyle = rgba('sepia', 0.45);
    c.fillText('fx', FX_X + 6, FB.y + FB.h / 2 + 13);
    const k = sel.key;
    const ref = `${COLS[k.c0]!.k}${k.r0}${k.c1 !== k.c0 || k.r1 !== k.r0 ? `:${COLS[k.c1]!.k}${k.r1}` : ''}`;
    c.font = font(F.mono(500), ref.length > 3 ? 24 : 30); c.fillStyle = rgba('sepia', 0.55); c.textAlign = 'center';
    c.fillText(ref, FB.x + REF_W / 2, FB.y + FB.h / 2 + 10);
    c.textAlign = 'left';
    const ly = lyricAt(lyrics, t);
    const maxW = FB.x + FB.w - FB_TEXT_X - 24;
    if (ly) {
      const size = this.msg ? 62 : 72;
      const st = { family: F.archivo(100, 700), size, minSize: 54, maxWidth: maxW, active: rgba('blood'), sung: rgba('sepia', 0.92), unsung: rgba('sepia', 0.26), lineHeight: 1.1 };
      const lay = layoutLyric(c, ly.line, st);
      c.save(); c.translate(FB_TEXT_X, FB.y + (FB.h - lay.height) / 2 + lay.size * 0.8);
      drawLyric(c, ly.line, t, st, lay, ly.k);
      c.restore();
    } else {
      const n = Math.ceil(k.formula.length * prog(sel.since, 0, 0.25));
      c.font = font(F.mono(500), 44); c.fillStyle = rgba('sepia', 0.5);
      c.fillText(k.formula.slice(0, n), FB_TEXT_X, FB.y + FB.h / 2 + 15);
    }
  }
}
