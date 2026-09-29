// 筆記本（亮）：書桌上一本線圈橫線筆記本，微微斜放。一支原子筆把歌詞一句一句寫在橫線上（跟唱：還沒唱的字是鉛筆打的淡稿，
// 唱到的那一刻筆尖寫過去、正在唱的字是訊號色的暗部，寫完是墨色），寫滿了本子就往上推一行（緩進、停住）。
//  - 主打留言是另一個人寫的便條：第一拍「啪」地貼上右下角，下兩拍各貼一條膠帶；字是比較粗的筆跡、稍微歪。
//  - 主打留言是整個畫面的焦點：便條大、字大、離鏡頭近；歌詞小一級，只寫在便條左邊。
//  - 頁首只剩一行很淡的「今晚的歌 ♪ 歌名」，旁邊用「正」字記小節數，每個小節線補一筆（冷面）。
//  - 鏡頭：整張桌子（2D 畫好）當成一張紙放在桌上，從桌邊斜斜拍（_t5 的 tilt：透視＋景深＋一盞桌燈），
//    慢慢推近，每個小節線緩一下；便條貼上去那一拍鏡頭輕輕往便條那邊帶。
//  - 沒有留言：便條是待辦清單（掃 QR、寫一句祝福、看它出現在這裡），每個小節線勾掉一項。
//  - 純音樂：沒有歌詞可寫，原子筆改成把留言寫在橫線上（字大一點），便條不貼。
// 畫法：書桌、紙、橫線、紅色邊線、線圈是一個全螢幕 shader（跟著頁面的旋轉與捲動）；字、筆、便條、膠帶是一張 Canvas2D（fast），
// 便條在 init() 先畫在自己的小畫布上（有陰影），每格只 drawImage 一次。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE } from '../engine/gl';
import { LIN } from '../engine/palette';
import { F, font, loadText, layout } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, prog, pulse } from '../engine/util';
import { fitText, wrap, type FitResult } from '../engine/text';
import { Lyrics, type Line } from '../engine/lyrics';
import { layoutLyric, fillWithHearts, signature, type LyricStyle, type PlacedWord } from './_motifs';
import { grid, windowLines, tiltRT, tiltPass, setV3, mixV, type Grid } from './_t5';

export const spec: PlateSpecDecl = { group: 'type', family: 'doc', paper: true, energy: [0.05, 0.7], bars: [4, 8] };

// ---------------------------------------------------------------- 頁面座標（旋轉、捲動之前）
const ROT = -0.021; // 本子斜放的角度
const PIV = { x: 960, y: 540 };
const PAGE = { x0: 150, x1: 1400 };
const ROW0 = 312, ROW_DY = 100; // 第一條可寫的橫線、行距
const MARGIN_X = 268; // 紅色邊線
const TX = 300; // 字的左緣
const WIDE = 1310; // 行的右界（便條旁邊的行到便條左邊為止）
// 便條（頁面座標，會跟著頁面捲）：寬固定、高度看留言長短，底邊對齊（長的往上長）
const NOTE_W = 600, NOTE_X = 846, NOTE_BOT = 900, NOTE_ROT = 0.03, NOTE_MAXH = 660;
const MAX_Y = 790; // 正在寫的那一行最低到這裡，再下去本子就往上推（最多推到便條頂端還在畫面裡）
const HAND = F.hand(400);
const HAND_B = F.hand(700);
const LY: LyricStyle = { family: HAND, size: 68, minSize: 60, maxWidth: WIDE - TX, align: 'left', lineHeight: 1.4 };
const SKEW = 0.5; // 寫字的掃描線斜度（筆順由左上往右下）

// ---------------------------------------------------------------- 書桌＋筆記本
const PAGE_FS = () => new FSPass(/* glsl */ `
  uniform float t; uniform float scroll; uniform float k;
  void main() {
    vec2 s = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y); // 螢幕座標，y 向下
    // 螢幕 → 頁面：先把捲動加回去，再轉回來
    vec2 d = s - vec2(${PIV.x}.0, ${PIV.y}.0);
    float c = cos(${ROT}), sn = sin(${ROT});
    vec2 p = vec2(c * d.x + sn * d.y, -sn * d.x + c * d.y) + vec2(${PIV.x}.0, ${PIV.y}.0) + vec2(0.0, scroll);
    // 書桌：比紙暗、帶一點木紋的橫向纖維
    float grain = fbm(vec2(s.x / 1400.0, s.y / 38.0), 3);
    vec3 desk = mix(C_PAPER, C_SEPIA, 0.16 + 0.035 * grain);
    // 本子的影子（往右下）
    float inPage = smoothstep(-0.8, 0.8, p.x - ${PAGE.x0}.0) * smoothstep(-0.8, 0.8, ${PAGE.x1}.0 - p.x);
    float shadow = smoothstep(40.0, 0.0, max(${PAGE.x0}.0 - (p.x - 14.0), (p.x - 14.0) - ${PAGE.x1}.0));
    vec3 col = mix(desk, desk * 0.8, shadow * 0.55 * (1.0 - inPage));
    // 紙：亮一點、很細的纖維
    vec3 paper = mix(C_PAPER, vec3(1.0), 0.13) * (0.985 + 0.02 * fbm(p / 160.0, 2));
    // 橫線（墨色很淡）、頁首那條粗一點、紅色的雙邊線（訊號色的暗部）
    float row = abs(mod(p.y - ${ROW0}.0 + ${ROW_DY / 2}.0, ${ROW_DY}.0) - ${ROW_DY / 2}.0);
    float ruled = pxLine(row, 0.35, 1.2) * step(${ROW0 - ROW_DY / 2}.0, p.y) * step(${PAGE.x0 + 44}.0, p.x) * step(p.x, ${PAGE.x1 - 30}.0);
    float head = pxLine(abs(p.y - ${ROW0 - 86}.0), 0.8, 1.8) * step(${PAGE.x0 + 44}.0, p.x) * step(p.x, ${PAGE.x1 - 30}.0);
    paper = mix(paper, C_SEPIA, ruled * 0.16 + head * 0.3);
    float mar = pxLine(abs(p.x - ${MARGIN_X}.0), 0.35, 1.2) + pxLine(abs(p.x - ${MARGIN_X + 7}.0), 0.35, 1.2);
    paper = mix(paper, C_BLOOD, mar * 0.45);
    // 線圈的洞（看得到書桌）
    vec2 hp = vec2(p.x - ${PAGE.x0 + 26}.0, mod(p.y, 54.0) - 27.0);
    float hole = 1.0 - smoothstep(8.0, 9.5, length(hp));
    paper = mix(paper, desk * 0.8, hole);
    col = mix(col, paper, inPage * k);
    // 線圈：從洞穿出去、繞過紙邊（金屬的灰，有一條亮線）
    vec2 wa = vec2(${PAGE.x0 + 26}.0, 0.0), wb = vec2(${PAGE.x0 - 34}.0, -16.0);
    vec2 q = vec2(p.x, mod(p.y, 54.0) - 27.0);
    float dw = sdSegment(q, wa, wb) - 4.2;
    float wire = 1.0 - smoothstep(-0.8, 0.8, dw);
    vec3 metal = mix(C_GRAPHITE, C_ASH, 0.5 + 0.5 * smoothstep(3.0, -3.0, q.y - mix(wa.y, wb.y, clamp((wa.x - q.x) / 60.0, 0.0, 1.0)) + 1.5));
    col = mix(col, metal, wire);
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 }, scroll: { value: 0 }, k: { value: 1 } });

/** 一行歌詞在本子上的位置：從第幾行開始、排版（每個字的位置已經改成行距對齊橫線）。 */
interface Placed { line: Line; row: number; words: PlacedWord[]; size: number; rows: number; page: number; idx: number }

export default class Notebook extends Scene {
  pageFs = shared('notebook.page', PAGE_FS);
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 便條先畫好（含陰影），每格貼上去就好。 */
  note = this.track(new Layer2D(NOTE_W + 80, NOTE_MAXH + 80, SCALE));
  /** 便條在頁面上的位置（init 依留言長短決定高度）。 */
  nr = { x: NOTE_X, y: NOTE_BOT - 380, w: NOTE_W, h: 380, rot: NOTE_ROT };
  noteFit: FitResult | null = null;
  msg: Msg | null = this.ctx.params.message ?? null;
  g!: Grid;
  placed: Placed[] = [];
  /** 翻頁的時間（第 k 頁從 pageAt[k-1] 開始）與本子最多往上推多少。 */
  pageAt: number[] = [];
  scrollCap = 0;
  instr = false;
  /** 純音樂：留言寫在橫線上。 */
  written: { lines: string[]; size: number; t0: number; per: number; sig: string; tSig: number } | null = null;
  todo = ['掃右下角的 QR code', '寫一句祝福', '看它出現在這裡'];
  tNote = 0;
  showNote = true;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const g = this.g = grid(au, s, e);
    const c = this.layer.ctx;
    const lines = windowLines(lyrics, s, e, 0.35, 0.8);
    this.instr = lines.length === 0;
    const m = this.msg;
    await loadText(`今晚的歌小節待辦掃右下角的寫一句祝福看它出現在這裡一位賓客${this.todo.join('')}${song.title}${m ? m.text + m.name : ''}${lines.map((l) => l.text).join('')}`);
    this.tNote = g.b0;
    if (m) {
      this.noteFit = fitText(c, m.text, HAND_B, NOTE_W - 80, NOTE_MAXH - 170, { min: 66, max: 120, lineHeight: 1.18, maxLines: 7 });
      this.nr.h = clamp(60 + this.noteFit.height + this.noteFit.size * 0.3 + 70 + 40, 360, NOTE_MAXH);
    } else this.nr.h = 400;
    this.nr.y = NOTE_BOT - this.nr.h;
    // 歌詞排進橫線：便條旁邊的行窄一點；一句放不下一行就折兩行。
    // 本子往上推最多推到便條頂端還在畫面裡；再寫不下就翻到新的一頁（舊的幾行淡掉，從第一行重新寫）。
    this.scrollCap = Math.max(0, Math.floor((this.nr.y - 70) / ROW_DY)) * ROW_DY;
    const lastRow = Math.floor((MAX_Y + this.scrollCap - ROW0) / ROW_DY);
    let row = 0, page = 0;
    const place = (l: Line, r: number) => {
      const y = ROW0 + r * ROW_DY;
      const nr = this.nr;
      const narrow = y + 15 > nr.y - 20 && y - 75 < nr.y + nr.h + 40 && !this.instr && this.showNote;
      return layoutLyric(c, l, { ...LY, maxWidth: (narrow ? nr.x - 26 : WIDE) - TX });
    };
    lines.forEach((l, idx) => {
      let lay = place(l, row);
      if (row > 0 && row + lay.rows.length - 1 > lastRow) {
        page++; row = 0; lay = place(l, 0);
        this.pageAt.push(l.start - 0.35 - 0.35);
      }
      const lh = lay.rows.length > 1 ? lay.rows[1]!.y : ROW_DY;
      const words = lay.words.map((pw) => ({ ...pw, y: Math.round(pw.y / Math.max(1, lh)) * ROW_DY }));
      this.placed.push({ line: l, row, words, size: lay.size, rows: lay.rows.length, page, idx });
      row += lay.rows.length;
    });
    if (this.instr && m) {
      // 純音樂：原子筆把留言寫在橫線上（最多四行，字大一點），寫完簽名
      this.showNote = false;
      const fit = fitText(c, m.text, HAND_B, WIDE - TX, ROW_DY * 3.6, { min: 48, max: 76, lineHeight: ROW_DY / 60, maxLines: 4 });
      c.font = font(HAND_B, Math.min(fit.size, 76));
      const ls = wrap(c, m.text, WIDE - TX);
      const n = ls.reduce((a, x) => a + Array.from(x).length, 0);
      const per = clamp(3.2 / n, 0.06, 0.13);
      const t0 = g.b0;
      this.written = { lines: ls, size: Math.min(fit.size, 76), t0, per, sig: signature(m.name), tSig: t0 + n * per + g.beat * 0.5 };
    }
    this.drawNote();
  }

  /** 便條：主題色的便利貼紙、翻起來的右下角、比較粗的筆跡。沒有留言時是待辦清單。 */
  private drawNote() {
    const N = this.note, c = N.ctx, m = this.msg;
    const x = 40, y = 34, w = this.nr.w, h = this.nr.h;
    // 影子（只畫一次，所以可以用 shadowBlur）
    c.save();
    c.shadowColor = rgba('sepia', 0.28); c.shadowBlur = 18; c.shadowOffsetX = 6; c.shadowOffsetY = 12;
    c.fillStyle = mixRgba('paper', 'signal', 0.34);
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + w, y); c.lineTo(x + w, y + h - 44); c.lineTo(x + w - 44, y + h); c.lineTo(x, y + h); c.closePath(); c.fill();
    c.restore();
    // 上緣黏膠那一條稍微深一點、翻起來的角
    const gr = c.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, rgba('signal', 0.1)); gr.addColorStop(0.12, rgba('signal', 0)); gr.addColorStop(1, rgba('sepia', 0.05));
    c.fillStyle = gr; c.fillRect(x, y, w, h - 44);
    c.fillStyle = mixRgba('paper', 'signal', 0.5);
    c.beginPath(); c.moveTo(x + w, y + h - 44); c.lineTo(x + w - 38, y + h - 36); c.lineTo(x + w - 44, y + h); c.closePath(); c.fill();
    c.fillStyle = rgba('sepia', 0.1);
    c.beginPath(); c.moveTo(x + w, y + h - 44); c.lineTo(x + w - 44, y + h); c.lineTo(x + w - 38, y + h - 36); c.closePath(); c.fill();
    c.textBaseline = 'alphabetic';
    if (m) {
      const fit = this.noteFit!;
      c.font = font(HAND_B, fit.size); c.fillStyle = rgba('sepia', 0.94);
      // 另一個人的筆跡：每一行都往右斜一點（斜體），比原子筆粗
      fit.lines.forEach((ln, i) => {
        c.save(); c.translate(x + 40, y + 60 + fit.size * 0.9 + i * fit.lineHeight); c.transform(1, 0, -0.1, 1, 0, 0);
        fillWithHearts(c, ln, 0, 0);
        c.restore();
      });
      c.font = font(HAND, 40); c.fillStyle = rgba('sepia', 0.72); c.textAlign = 'right';
      c.fillText(signature(m.name), x + w - 40, y + 60 + fit.height + fit.size * 0.3 + 58);
      c.textAlign = 'left';
    } else {
      c.font = font(HAND_B, 40); c.fillStyle = rgba('sepia', 0.9);
      c.fillText('待辦', x + 32, y + 72);
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au, song } = this.ctx;
    const t = f.t, s = this.ctx.start, g = this.g;
    // 正在寫的那一行（純音樂：寫到的那一行）
    const cur = this.currentRow(t);
    const scroll = this.scrollAt(t, cur);
    const rt = tiltRT();
    this.pageFs.u.t!.value = t; this.pageFs.u.scroll!.value = scroll;
    this.pageFs.render(renderer, rt);

    const L = this.layer; L.clear();
    const c = L.ctx;
    c.globalAlpha = prog(t, s, s + 0.15);
    c.save();
    // 頁面座標 → 螢幕
    c.translate(PIV.x, PIV.y); c.rotate(ROT); c.translate(-PIV.x, -PIV.y - scroll);
    this.header(c, t);
    let pen: { x: number; y: number; writing: boolean } | null = null;
    if (this.written) pen = this.writeMessage(c, t);
    else {
      // 這一頁的歌詞；上一頁的在翻頁那 0.3 秒內淡掉
      const pg = this.pageOf(t);
      const cur = this.placed.filter((pl) => pl.line.start - 0.35 <= t).pop()?.idx ?? -1;
      for (const pl of this.placed) {
        if (pl.page === pg) pen = this.writeLine(c, pl, t, pl.idx >= cur - 1 ? 1 : 0.45) ?? pen;
        else if (pl.page === pg - 1) { const f = 1 - prog(t, this.pageAt[pg - 1]!, this.pageAt[pg - 1]! + 0.3); if (f > 0) this.writeLine(c, pl, t, 0.45 * f); }
      }
    }
    if (this.showNote) this.stickNote(c, t);
    this.penAt(c, t, pen);
    c.restore();
    comp.draw(renderer, L.upload(), rt);
    // ---- 鏡頭：整張桌子當成平放的紙，從桌邊（畫面下方）斜斜往上看；慢慢推近，每個小節線緩一下，
    // 便條貼上去之後鏡頭輕輕往右帶（留言在畫面裡偏中間）。純音樂時留言寫在左邊，鏡頭留在左邊。
    const tp = tiltPass();
    let step = 0;
    for (const b of g.bars) step += prog(t, b - 0.1, b + 0.7, ease.inOutCubic);
    const toNote = this.showNote ? prog(t, this.tNote, this.tNote + 1.2, ease.inOutCubic) : 0;
    const lookX = lerp(-40, 70, toNote), lookY = -20 - 20 * toNote;
    const D = 1560 - Math.min(step, 6) * 22 - 40 * toNote, a = 0.3;
    (tp.u.look!.value as THREE.Vector3).set(lookX, lookY, 0);
    (tp.u.cam!.value as THREE.Vector3).set(lookX + 90, lookY - Math.sin(a) * D, Math.cos(a) * D);
    tp.u.fov!.value = 2 * Math.atan(505 / D);
    tp.u.roll!.value = -0.02;
    tp.u.focus!.value = D; tp.u.range!.value = 170; tp.u.maxR!.value = 7;
    setV3(tp.u.edge!, mixV(LIN.paper, LIN.sepia, 0.17));
    (tp.u.light!.value as THREE.Vector2).set(620, 330);
    tp.u.lightK!.value = 1;
    tp.u.src!.value = rt.texture;
    tp.render(renderer, out);
    void song; void au;
    return { paper: 1, bloom: 0.2, vignette: 0.32, grain: 0.045, zoom: 1 + 0.004 * pulse(t, this.tNote, 0.12) };
  }

  /** 目前在寫第幾行（頁面上的行號）。 */
  private currentRow(t: number): number {
    if (this.written) {
      const w = this.written;
      const n = Math.floor((t - w.t0) / w.per);
      let acc = 0;
      for (let i = 0; i < w.lines.length; i++) { acc += Array.from(w.lines[i]!).length; if (n < acc) return i; }
      return w.lines.length;
    }
    let r = 0;
    for (const pl of this.placed) if (pl.line.start - 0.35 <= t) r = pl.row + pl.rows - 1;
    return r;
  }

  /** 本子往上推：正在寫的那一行太低就推一行（在那一句開始前、緩進）。 */
  private scrollAt(t: number, _row: number): number {
    const need = (row: number) => Math.max(0, ROW0 + row * ROW_DY - MAX_Y);
    let sc = 0;
    if (this.written) {
      const w = this.written;
      let acc = 0;
      for (let i = 0; i < w.lines.length; i++) {
        const tStart = w.t0 + acc * w.per;
        sc = lerp(sc, need(i), prog(t, tStart - 0.35, tStart, ease.inOutCubic));
        acc += Array.from(w.lines[i]!).length;
      }
      return sc;
    }
    const pg = this.pageOf(t);
    for (const pl of this.placed) {
      if (pl.page !== pg) continue;
      const tStart = pl.line.start - 0.35;
      sc = lerp(sc, Math.min(this.scrollCap, need(pl.row + pl.rows - 1)), prog(t, tStart - 0.3, tStart, ease.inOutCubic));
    }
    return sc;
  }

  /** t 時在第幾頁。 */
  private pageOf(t: number): number {
    let k = 0;
    for (const x of this.pageAt) if (t >= x) k++;
    return k;
  }

  /** 頁首：一行很淡的歌名，旁邊用「正」字記小節（配角：小、淡）。 */
  private header(c: CanvasRenderingContext2D, t: number) {
    const { song } = this.ctx;
    const g = this.g;
    const y = ROW0 - 100;
    c.font = font(HAND, 34); c.fillStyle = rgba('sepia', 0.5);
    const title = Array.from(song.title || '').slice(0, 14).join('');
    const head = `今晚的歌 ♪ ${title}`;
    c.fillText(head, TX, y);
    const fx = TX + c.measureText(head).width + 40;
    const done = g.bars.filter((b) => b <= t);
    c.strokeStyle = rgba('sepia', 0.5); c.lineWidth = 2.6; c.lineCap = 'round';
    done.forEach((b, i) => {
      const u = prog(t, b, b + 0.15, ease.outCubic);
      const box = fx + Math.floor(i / 5) * 40, by = y - 26, S = 26;
      const k = i % 5;
      // 正：橫、豎、橫、豎（左）、橫（底）
      const seg: [number, number, number, number][] = [[0, 0, S, 0], [S / 2, 0, S / 2, S], [S / 2, S / 2, S * 0.9, S / 2], [S * 0.15, S * 0.4, S * 0.15, S], [0, S, S, S]];
      const [ax, ay, bx, bby] = seg[k]!;
      c.beginPath(); c.moveTo(box + ax, by + ay); c.lineTo(box + lerp(ax, bx, u), by + lerp(ay, bby, u)); c.stroke();
      // 前面已經完成的筆畫
      for (let j = 0; j < k; j++) { const [a1, a2, b1, b2] = seg[j]!; c.beginPath(); c.moveTo(box + a1, by + a2); c.lineTo(box + b1, by + b2); c.stroke(); }
    });
  }

  /** 寫一句歌詞：還沒唱的是鉛筆淡稿，唱到的斜斜地寫過去。回傳筆尖。 */
  private writeLine(c: CanvasRenderingContext2D, pl: Placed, t: number, alpha = 1): { x: number; y: number; writing: boolean } | null {
    const lead = pl.line.start - 0.35;
    if (t < lead) return null;
    // 比上一句更早的行淡一點：畫面上只有正在寫的這一句（和剛寫完的上一句）是清楚的
    c.save(); c.globalAlpha *= alpha;
    const base = ROW0 + pl.row * ROW_DY - 8;
    const size = pl.size;
    c.font = font(HAND, size);
    c.textBaseline = 'alphabetic';
    let head: { x: number; y: number; writing: boolean } | null = null;
    const ghost = prog(t, lead, lead + 0.3);
    for (const pw of pl.words) {
      const x = TX + pw.x, y = base + pw.y;
      const p = Lyrics.wordProgress(pw.word, t);
      if (p < 1) { c.fillStyle = rgba('sepia', 0.3 * ghost); c.fillText(pw.word.w, x, y); }
      if (p <= 0) continue;
      const h = size * 1.2, top = y - size * 0.95, S = p * (pw.w + SKEW * h);
      c.save();
      c.beginPath();
      c.moveTo(x - 8, top - 6); c.lineTo(x + S + 6 * SKEW, top - 6); c.lineTo(x + S - SKEW * (h + 6), top + h + 6); c.lineTo(x - 8, top + h + 6);
      c.closePath(); c.clip();
      c.fillStyle = p < 1 ? rgba('blood', 1) : rgba('sepia', 0.94);
      c.fillText(pw.word.w, x, y);
      c.restore();
      if (p < 1) head = { x: x + clamp(S - SKEW * h * 0.5, 0, pw.w), y: y - size * 0.3, writing: true };
      else head = { x: x + pw.w, y: y - size * 0.3, writing: false };
    }
    c.restore();
    return head;
  }

  /** 純音樂：把留言寫在橫線上（一個字一個字），寫完簽名。 */
  private writeMessage(c: CanvasRenderingContext2D, t: number): { x: number; y: number; writing: boolean } | null {
    const w = this.written!;
    let head: { x: number; y: number; writing: boolean } | null = null;
    let idx = 0;
    c.font = font(HAND_B, w.size); c.textBaseline = 'alphabetic';
    w.lines.forEach((ln, i) => {
      const y = ROW0 + i * ROW_DY - 8;
      const lay = layout(ln, HAND_B, w.size);
      for (const gl of lay.glyphs) {
        const a = w.t0 + idx * w.per;
        idx++;
        const x = TX + gl.x;
        c.fillStyle = rgba('sepia', 0.14); c.fillText(gl.ch, x, y);
        if (t < a) continue;
        const r = clamp((t - a) / w.per);
        const h = w.size * 1.2, top = y - w.size * 0.95, S = r * (gl.w + SKEW * h);
        c.save(); c.beginPath();
        c.moveTo(x - 8, top - 6); c.lineTo(x + S + 6 * SKEW, top - 6); c.lineTo(x + S - SKEW * (h + 6), top + h + 6); c.lineTo(x - 8, top + h + 6);
        c.closePath(); c.clip();
        c.fillStyle = gl.ch === '♥' ? rgba('rose') : rgba('sepia', 0.94);
        c.fillText(gl.ch, x, y);
        c.restore();
        head = { x: x + clamp(S - SKEW * h * 0.5, 0, gl.w), y: y - w.size * 0.3, writing: r < 1 };
      }
    });
    if (t >= w.tSig) {
      const y = ROW0 + w.lines.length * ROW_DY - 8;
      const u = prog(t, w.tSig, w.tSig + 0.8);
      c.font = font(HAND, 40);
      const sw = c.measureText(w.sig).width;
      const x = WIDE - sw;
      c.save(); c.beginPath(); c.rect(x - 4, y - 50, sw * u + 8, 70); c.clip();
      c.fillStyle = rgba('sepia', 0.8); c.fillText(w.sig, x, y);
      c.restore();
      if (u < 1) head = { x: x + sw * u, y: y - 12, writing: true };
    }
    return head;
  }

  /** 便條：第一拍貼上（從大一點、歪一點啪地落下），下兩拍各貼一條膠帶。沒有留言時的待辦清單每個小節勾一項。 */
  private stickNote(c: CanvasRenderingContext2D, t: number) {
    const g = this.g;
    if (t < this.tNote - 0.02) return;
    const u = prog(t, this.tNote - 0.02, this.tNote + 0.16, ease.outExpo);
    const sc = lerp(1.14, 1, u), rot = this.nr.rot + (1 - u) * 0.09;
    const cx = this.nr.x + this.nr.w / 2, cy = this.nr.y + this.nr.h / 2;
    c.save();
    c.globalAlpha *= clamp(u * 3);
    c.translate(cx, cy); c.rotate(rot); c.scale(sc, sc); c.translate(-cx, -cy);
    // 便條畫布是照最高的便條開的：只取用到的那一段（整張縮進來會把字壓扁）
    const cv = this.note.canvas;
    c.drawImage(cv, 0, 0, cv.width, Math.min(cv.height, (this.nr.h + 80) * SCALE), this.nr.x - 40, this.nr.y - 34, this.nr.w + 80, this.nr.h + 80);
    if (!this.msg) {
      // 待辦清單：每個小節線勾掉一項
      const done = g.bars.filter((b) => b > this.tNote + 0.1);
      c.font = font(HAND, 38); c.textBaseline = 'alphabetic';
      this.todo.forEach((item, i) => {
        const y = this.nr.y + 150 + i * 78;
        c.strokeStyle = rgba('sepia', 0.8); c.lineWidth = 2.5;
        c.strokeRect(this.nr.x + 34, y - 30, 30, 30);
        c.fillStyle = rgba('sepia', 0.9);
        const fit = Array.from(item).length > 9 ? 32 : 38;
        c.font = font(HAND, fit);
        c.fillText(item, this.nr.x + 80, y);
        const b = done[i];
        if (b !== undefined && t >= b) {
          const v = prog(t, b, b + 0.14, ease.outCubic);
          c.strokeStyle = rgba('blood', 1); c.lineWidth = 5; c.lineCap = 'round';
          c.beginPath(); c.moveTo(this.nr.x + 36, y - 16);
          const mx = this.nr.x + 46, my = y - 2, ex = this.nr.x + 72, ey = y - 42;
          if (v < 0.4) c.lineTo(lerp(this.nr.x + 36, mx, v / 0.4), lerp(y - 16, my, v / 0.4));
          else { c.lineTo(mx, my); c.lineTo(lerp(mx, ex, (v - 0.4) / 0.6), lerp(my, ey, (v - 0.4) / 0.6)); }
          c.stroke();
        }
      });
    }
    // 膠帶：下兩拍各貼一條（半透明、兩端鋸齒）
    [[this.nr.x + 40, this.nr.y - 8, -0.32], [this.nr.x + this.nr.w - 40, this.nr.y - 8, 0.3]].forEach(([tx, ty, ang], i) => {
      const t0 = this.tNote + g.beat * (i + 1);
      const v = prog(t, t0 - 0.02, t0 + 0.12, ease.outExpo);
      if (v <= 0) return;
      c.save();
      c.translate(tx!, ty!); c.rotate(ang!); c.scale(lerp(1.3, 1, v), lerp(1.3, 1, v));
      c.globalAlpha *= clamp(v * 2) * 0.72;
      c.fillStyle = mixRgba('bone', 'ash', 0.3);
      c.beginPath();
      const tw = 130, th = 40;
      c.moveTo(-tw / 2, -th / 2);
      for (let k = 0; k <= 6; k++) c.lineTo(-tw / 2 + (k / 6) * tw, -th / 2 + (k % 2) * 3);
      for (let k = 0; k <= 6; k++) c.lineTo(tw / 2 - (k / 6) * tw, th / 2 - (k % 2) * 3);
      c.closePath(); c.fill();
      c.strokeStyle = rgba('sepia', 0.2); c.lineWidth = 1.2; c.stroke();
      c.restore();
    });
    c.restore();
  }

  /** 原子筆：筆尖跟著寫的地方走，沒在寫的時候抬起來停在旁邊。 */
  private penAt(c: CanvasRenderingContext2D, t: number, head: { x: number; y: number; writing: boolean } | null) {
    let x: number, y: number, lift: number;
    if (head) {
      x = head.x; y = head.y;
      lift = head.writing ? 0 : 1;
      // 寫字時手的小抖動（一秒七八下，確定性）
      if (head.writing) { x += Math.sin(t * 47) * 2; y += Math.sin(t * 31 + 1) * 3; }
    } else {
      x = TX + 40; y = ROW0 - 20; lift = 1;
    }
    const L = 330;
    const ang = -0.98; // 筆身朝右上
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const lh = 18 * lift;
    // 影子（筆抬得越高，影子離得越遠）
    c.save();
    c.lineCap = 'round';
    c.strokeStyle = rgba('sepia', 0.14); c.lineWidth = 20;
    c.beginPath(); c.moveTo(x + 10 + lh, y + 8 + lh * 0.6); c.lineTo(x + 10 + lh + dx * L, y + 8 + lh * 0.6 + dy * L); c.stroke();
    const px = x - lh * 0.3, py = y - lh;
    // 筆尖（金屬錐）、握把（訊號色的暗部）、筆桿（墨色）、筆夾
    const pt = (d: number, o = 0) => ({ x: px + dx * d - dy * o, y: py + dy * d + dx * o });
    const poly = (pts: { x: number; y: number }[], fill: string) => { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath(); c.fillStyle = fill; c.fill(); };
    poly([pt(0, 0), pt(34, -8), pt(34, 8)], rgba('ash', 1));
    poly([pt(0, 0), pt(10, -2.4), pt(10, 2.4)], rgba('sepia', 1));
    poly([pt(34, -9), pt(120, -11), pt(120, 11), pt(34, 9)], mixRgba('blood', 'sepia', 0.25));
    for (let k = 0; k < 6; k++) { const a = pt(44 + k * 12, -10), b = pt(44 + k * 12, 10); c.strokeStyle = rgba('sepia', 0.35); c.lineWidth = 1.5; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
    poly([pt(120, -11), pt(L, -11), pt(L + 8, -7), pt(L + 8, 7), pt(L, 11), pt(120, 11)], rgba('sepia', 0.95));
    // 亮線
    const h1 = pt(126, -5), h2 = pt(L - 6, -5);
    c.strokeStyle = rgba('bone', 0.35); c.lineWidth = 2.5; c.beginPath(); c.moveTo(h1.x, h1.y); c.lineTo(h2.x, h2.y); c.stroke();
    const k1 = pt(L - 110, 13), k2 = pt(L - 4, 13);
    c.strokeStyle = rgba('ash', 1); c.lineWidth = 4; c.beginPath(); c.moveTo(k1.x, k1.y); c.lineTo(k2.x, k2.y); c.stroke();
    c.restore();
  }
}
