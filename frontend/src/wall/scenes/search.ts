// 搜尋框（亮）：一個很乾淨、不像任何搜尋引擎的搜尋框（自己的字標「Wishes · 祝福搜尋」），大量留白。
//  - 歌詞是打進搜尋框的字：唱到哪打到哪，還沒唱的部分是淡淡的「自動完成」灰字（三成），正在唱的字是訊號色的暗部；
//    游標跟著拍子閃。換下一句前，整句先被「全選」（反白一下）再被新的一句取代。
//  - 下拉的自動完成建議：最上面一列是主打留言（「精選祝福」，手寫字，讀得到），下面四列是冷面的建議
//    （「○○ 歌詞」「新婚快樂 怎麼說比較有誠意」「芃芃 QQ 可以當花童嗎」），每唱一個新的字就重新洗一次，
//    像真的自動完成一樣；鍵盤的選取列每一拍往下移一列、每個小節線回到主打留言。
//  - 第一拍下拉選單打開（卡片往下長），下一拍主打留言那一列出現。
//  - 純音樂：搜尋框一拍打一個字「今晚最想對新人說的話」。沒有留言：精選那一列是邀請。
// 畫法：紙、卡片的柔和陰影是全螢幕 shader（圓角 SDF，陰影用距離場算，不用模糊）；字、圖示、選取列是一張 Canvas2D（fast）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, prog, pulse } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { Lyrics, type Line } from '../engine/lyrics';
import { layoutLyric, drawLyric, lyricAt, drawHeart, fillWithHearts, signature, COUPLE_ZH, type LyricStyle, type LyricLayout } from './_motifs';
import { grid, windowLines, rrect, pad, lastOf, type Grid } from './_t5';

export const spec: PlateSpecDecl = { group: 'type', family: 'screen', paper: true, energy: [0.1, 0.75], bars: [4, 8] };

// ---------------------------------------------------------------- 版面
const CX = 150, CW = 1190; // 卡片 x 150..1340（右邊一條留給即時小卡）
const CY = 206; // 卡片上緣（搜尋框）
const FIELD_1 = 124, FIELD_2 = 186; // 搜尋框高：一行、兩行
const TX = CX + 104; // 字的左緣（放大鏡右邊）
const ROW_H = 66;
const NROW = 4;
const HINT_H = 58;
const QUERY: LyricStyle = { family: F.archivo(75, 700), size: 64, minSize: 48, maxWidth: CW - 104 - 150, align: 'left', lineHeight: 1.0 };
const INSTR_QUERY = '今晚最想對新人說的話';

const [GROOM, BRIDE] = COUPLE_ZH.split(/\s*&\s*/) as [string, string];
/** 冷面的自動完成建議（{kw} 會換成正在打的那句的開頭）。 */
const SUGGEST = [
  '{kw} 歌詞', '{kw} 是什麼意思', '新婚快樂 怎麼說比較有誠意', '喜餅 什麼時候發', `${GROOM} ${BRIDE} 怎麼認識的`,
  '婚禮 感動到哭 正常嗎', '芃芃 QQ 可以當花童嗎', '{kw} 一起唱', '一輩子 有多長', '永遠 的 近義詞', '捧花 怎麼接比較準',
];

// ---------------------------------------------------------------- 紙、卡片、陰影
const BG = () => new FSPass(/* glsl */ `
  uniform float t; uniform vec4 card; uniform float sep; uniform float lift;
  float box(vec2 p, vec4 r, float rad) { vec2 c = r.xy + r.zw * 0.5; return sdBox(p - c, r.zw * 0.5 - rad) - rad; }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y); // y 向下
    // 紙：比紙色暗一點點，細纖維
    float fib = fbm(vec2(p.x / 900.0, p.y / 60.0), 3) * 0.5 + fbm(p / 180.0, 2) * 0.5;
    vec3 col = C_PAPER * (0.905 + 0.02 * fib);
    col *= 1.0 - 0.06 * smoothstep(500.0, 1300.0, length(p - vec2(760.0, 520.0)));
    // 卡片的影子：兩層距離場（近的實、遠的散），打開時浮起來一點
    float ds = box(p - vec2(0.0, 10.0 + 8.0 * lift), card, 42.0);
    float sh = 0.13 * exp(-max(ds, 0.0) / (10.0 + 6.0 * lift)) + (0.07 + 0.05 * lift) * exp(-max(ds, 0.0) / (46.0 + 30.0 * lift));
    col = mix(col, col * mix(C_SEPIA / max(C_PAPER, vec3(0.05)), vec3(1.0), 0.55), clamp(sh, 0.0, 0.5));
    // 卡片本身：比紙亮（不到會發光的亮度）
    float d = box(p, card, 42.0);
    vec3 panel = mix(C_PAPER, vec3(1.0), 0.2);
    col = mix(col, panel, aaFill(d));
    col = mix(col, C_SEPIA, aaStroke(d, 1.0) * 0.14);
    // 搜尋框與下拉選單之間的細線
    float inX = step(card.x + 40.0, p.x) * step(p.x, card.x + card.z - 40.0);
    col = mix(col, C_SEPIA, pxLine(abs(p.y - sep), 0.3, 1.1) * 0.12 * inX * step(sep + 2.0, card.y + card.w));
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 }, card: { value: new THREE.Vector4() }, sep: { value: 0 }, lift: { value: 0 } });

export default class Search extends Scene {
  bg = shared('search.bg', BG);
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  g!: Grid;
  lines: Line[] = [];
  heroFit: FitResult | null = null;
  heroFamily = F.hand(400);
  heroH = 0;
  tOpen = 0;
  tHero = 0;
  /** 每一行歌詞的排版（決定搜尋框要一行還是兩行高）。 */
  lays = new Map<Line, LyricLayout>();
  instr = false;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const g = this.g = grid(au, s, e);
    const c = this.layer.ctx;
    this.lines = windowLines(lyrics, s, e);
    this.instr = this.lines.length === 0;
    const m = this.msg;
    await loadText(`${SUGGEST.join('')}精選祝福還沒有人搜尋祝福掃描右下角你的祝福會出現在這裡選擇送出搜尋一位賓客約有則結果秒${INSTR_QUERY}${COUPLE_ZH}${song.title}${m ? m.text + m.name : ''}${this.lines.map((l) => l.text).join('')}`);
    for (const l of this.lines) this.lays.set(l, layoutLyric(c, l, QUERY));
    // 下拉選單在第一拍打開，主打那一列下一拍出現
    this.tOpen = g.b0;
    this.tHero = g.b0 + g.beat;
    const text = m ? m.text : '掃描右下角 QR code，你的祝福會出現在這裡';
    this.heroFamily = m ? F.hand(400) : F.hei(500);
    this.heroFit = fitText(c, text, this.heroFamily, CW - 104 - 160, 190, { min: 44, max: 62, lineHeight: 1.28, maxLines: 3 });
    this.heroH = 26 + 34 + this.heroFit.height + this.heroFit.size * 0.3 + (m ? 50 : 22);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, g = this.g;
    const ly = this.instr ? null : lyricAt(lyrics, t);
    const lay = ly ? this.lays.get(ly.line) ?? layoutLyric(this.layer.ctx, ly.line, QUERY) : null;
    // 搜尋框的高度：這句要兩行就長高（彈簧）
    const twoRows = lay ? lay.rows.length > 1 : false;
    const fieldH = twoRows ? FIELD_2 : FIELD_1;
    const open = prog(t, this.tOpen, this.tOpen + 0.42, ease.outExpo);
    const listH = 16 + this.heroH + NROW * ROW_H + HINT_H;
    const cardH = fieldH + listH * open;
    this.bg.u.t!.value = t;
    (this.bg.u.card!.value as THREE.Vector4).set(CX, CY, CW, cardH);
    this.bg.u.sep!.value = CY + fieldH;
    this.bg.u.lift!.value = open;
    this.bg.render(renderer, out);

    const L = this.layer; L.clear();
    const c = L.ctx;
    c.globalAlpha = prog(t, s, s + 0.2);
    this.wordmark(c);
    const kw = this.field(c, t, ly?.line ?? null, lay, fieldH);
    if (open > 0.02) {
      c.save();
      c.beginPath(); c.rect(CX, CY + fieldH, CW, listH * open); c.clip();
      this.list(c, t, CY + fieldH + 16, kw);
      c.restore();
    }
    comp.draw(renderer, L.upload(), out);
    void au; void e;
    // 主打那一列出現時鏡頭往前推一點點，之後停住
    const push = 0.018 * prog(t, this.tHero, this.tHero + 0.7, ease.outExpo);
    return {
      paper: 1, bloom: 0.25, vignette: 0.22, grain: 0.04, zoom: 1 + push + 0.004 * pulse(t, lastOf(g.bars, t), 0.1),
      popupAvoid: [[CX - 10, CY - 80, CW + 20, FIELD_2 + 16 + this.heroH + NROW * ROW_H + HINT_H + 100]],
    };
  }

  /** 左上的字標（自己設計的：襯線斜體＋mono）。 */
  private wordmark(c: CanvasRenderingContext2D) {
    c.font = font(F.serif(600, true), 48); c.fillStyle = rgba('sepia', 0.92);
    c.fillText('Wishes', CX + 8, CY - 36);
    const w = c.measureText('Wishes').width;
    drawHeart(c, CX + 8 + w + 16, CY - 50, 16);
    c.font = font(F.mono(500), 17); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.55);
    c.fillText('祝福搜尋 · BETA', CX + 8 + w + 40, CY - 42);
    c.letterSpacing = '0px';
  }

  /** 搜尋框：放大鏡、打進去的字（歌詞）、游標、右邊的送出鍵。回傳給自動完成用的「開頭」。 */
  private field(c: CanvasRenderingContext2D, t: number, line: Line | null, lay: LyricLayout | null, fieldH: number): string {
    const { audio: au } = this.ctx;
    const g = this.g;
    const cy = CY + fieldH / 2;
    // 放大鏡（大鼓一打鏡片亮一下）
    const kick = au.hit('kick', t, 0.14);
    c.strokeStyle = rgba('sepia', 0.7); c.lineWidth = 4; c.lineCap = 'round';
    c.beginPath(); c.arc(CX + 58, CY + FIELD_1 / 2 - 6, 17, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(CX + 71, CY + FIELD_1 / 2 + 7); c.lineTo(CX + 84, CY + FIELD_1 / 2 + 20); c.stroke();
    if (kick > 0.05) { c.fillStyle = rgba('signal', 0.5 * kick); c.beginPath(); c.arc(CX + 58, CY + FIELD_1 / 2 - 6, 14, 0, Math.PI * 2); c.fill(); }
    // 右邊的送出鍵：每個小節線被「按」一下
    const bx = CX + CW - 84, by = CY + FIELD_1 / 2;
    const press = pulse(t, lastOf(g.bars, t), 0.09);
    c.fillStyle = mixRgba('signal', 'blood', 0.35 + 0.4 * press);
    c.beginPath(); c.arc(bx, by, 34 * (1 - 0.1 * press), 0, Math.PI * 2); c.fill();
    c.strokeStyle = rgba('paper', 1); c.lineWidth = 4;
    c.beginPath(); c.moveTo(bx - 12, by); c.lineTo(bx + 12, by); c.moveTo(bx + 3, by - 10); c.lineTo(bx + 13, by); c.lineTo(bx + 3, by + 10); c.stroke();

    const base = CY + (lay && lay.rows.length > 1 ? 82 : FIELD_1 / 2 + 22);
    let caretX = TX, caretY = base;
    const blink = ((t - g.b0) / g.beat) % 1 < 0.55 || t < g.b0;
    let kw = '';
    if (line && lay) {
      // 換下一句前 0.15 秒：整句「全選」反白
      const next = this.lines[this.lines.indexOf(line) + 1];
      const sel = next ? prog(t, next.start - 0.35 - 0.16, next.start - 0.35 - 0.1) * (t < next.start - 0.35 ? 1 : 0) : 0;
      if (sel > 0) {
        for (const r of lay.rows) { c.fillStyle = rgba('signal', 0.35 * sel); c.fillRect(TX + r.x - 4, base + r.y - lay.size * 0.9, r.width + 8, lay.size * 1.18); }
      }
      c.save(); c.translate(TX, base);
      drawLyric(c, line, t, { ...QUERY, active: rgba('blood'), sung: rgba('sepia', 0.95), unsung: rgba('sepia', 0.3) }, lay, 1);
      c.restore();
      // 游標：停在唱到的地方
      for (const pw of lay.words) {
        const p = Lyrics.wordProgress(pw.word, t);
        if (p <= 0) break;
        caretX = TX + pw.x + pw.w * p + 3; caretY = base + pw.y;
      }
      const m = /^\S+/.exec(line.text);
      kw = m ? Array.from(m[0]).slice(0, 6).join('') : line.text.slice(0, 4);
    } else if (this.instr) {
      // 純音樂：一拍打一個字
      const n = clamp(Math.floor((t - g.b0) / g.beat) + 1, 0, Array.from(INSTR_QUERY).length);
      const typed = Array.from(INSTR_QUERY).slice(0, t < g.b0 ? 0 : n).join('');
      c.font = font(F.hei(500), 60); c.fillStyle = rgba('sepia', 0.95);
      c.fillText(typed, TX, base);
      caretX = TX + c.measureText(typed).width + 4;
      kw = typed || '今晚';
    } else {
      c.font = font(F.hei(400), 52); c.fillStyle = rgba('sepia', 0.35);
      c.fillText('搜尋祝福…', TX, base);
      kw = '祝福';
    }
    if (blink) { c.fillStyle = rgba('blood', 0.95); c.fillRect(caretX, caretY - 58, 4, 70); }
    void cy;
    return kw;
  }

  /** 下拉選單：精選祝福一列、四列冷面建議、最下面一行按鍵提示；選取列每拍往下移一列。 */
  private list(c: CanvasRenderingContext2D, t: number, y0: number, kw: string) {
    const { lyrics } = this.ctx;
    const g = this.g, m = this.msg, fit = this.heroFit!;
    // 選取列：小節線在精選那一列，之後每拍往下一列
    const selAt = (x: number) => {
      if (x === -Infinity || x < this.tHero - 1e-3) return 0;
      const bar = lastOf(g.bars, x + 1e-3);
      return Math.round((x - (bar === -Infinity ? g.b0 : bar)) / g.beat) % (NROW + 1);
    };
    const bt = lastOf(g.beats, t);
    const k = selAt(bt), prevK = selAt(lastOf(g.beats, bt - 1e-3));
    const rowY = (i: number) => (i === 0 ? y0 : y0 + this.heroH + (i - 1) * ROW_H);
    const rowH = (i: number) => (i === 0 ? this.heroH : ROW_H);
    const u = prog(t, bt, bt + 0.14, ease.outCubic);
    const hy = lerp(rowY(prevK), rowY(k), u), hh = lerp(rowH(prevK), rowH(k), u);
    if (t >= this.tHero) { c.fillStyle = mixRgba('paper', 'signal', 0.2, 0.85); rrect(c, CX + 18, hy, CW - 36, hh - 6, 18); c.fill(); c.fillStyle = rgba('blood', 0.9); c.fillRect(CX + 18, hy + 14, 5, hh - 34); }

    // 精選祝福
    const hk = prog(t, this.tHero, this.tHero + 0.35, ease.outCubic);
    if (hk > 0) {
      c.save();
      c.globalAlpha *= hk;
      c.translate(0, (1 - hk) * 18);
      const x = TX, y = y0 + 26;
      drawHeart(c, CX + 58, y + 18, 30);
      c.font = font(F.mono(500), 18); c.letterSpacing = '3px'; c.fillStyle = rgba('blood', 0.95);
      c.fillText(m ? `精選祝福 · No.${pad(m.n)}${m.couple ? ' · FROM THE COUPLE' : ''}` : '還沒有人搜尋祝福', x, y + 24);
      c.letterSpacing = '0px';
      c.font = font(this.heroFamily, fit.size); c.fillStyle = rgba('sepia', 0.96);
      fit.lines.forEach((ln, i) => fillWithHearts(c, ln, x, y + 34 + fit.size * 0.95 + i * fit.lineHeight));
      if (m) {
        c.font = font(F.hand(400), 32); c.fillStyle = rgba('sepia', 0.7); c.textAlign = 'right';
        c.fillText(signature(m.name), CX + CW - 60, y + 34 + fit.height + fit.size * 0.3 + 38);
        c.textAlign = 'left';
      }
      c.restore();
    }
    // 建議：每唱一個新的字就重洗（新的字從下面滑上來）
    const w = lyrics.lastWord(t);
    const seed = this.instr ? Math.floor((t - this.g.b0) / this.g.beat) : w ? w.gi : 0;
    const tw = this.instr ? this.g.b0 + seed * this.g.beat : w ? w.start : -9;
    for (let i = 0; i < NROW; i++) {
      const txt = SUGGEST[(Math.abs(seed) * 3 + i * 4) % SUGGEST.length]!.replace('{kw}', kw);
      const y = rowY(i + 1);
      const a = prog(t, tw + i * 0.03, tw + i * 0.03 + 0.18, ease.outCubic);
      const rk = prog(t, this.tOpen + 0.1 + i * 0.05, this.tOpen + 0.4 + i * 0.05, ease.outCubic);
      c.save();
      c.globalAlpha *= rk * (0.35 + 0.65 * a);
      // 小放大鏡
      c.strokeStyle = rgba('sepia', 0.35); c.lineWidth = 2.5;
      c.beginPath(); c.arc(CX + 56, y + ROW_H / 2 - 4, 10, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(CX + 63, y + ROW_H / 2 + 3); c.lineTo(CX + 70, y + ROW_H / 2 + 10); c.stroke();
      // 開頭（打進去的部分）淡、補完的部分深
      const ty = y + ROW_H / 2 + 12 + (1 - a) * 14;
      c.font = font(F.hei(400), 34);
      if (txt.startsWith(kw)) {
        c.fillStyle = rgba('sepia', 0.5); c.fillText(kw, TX, ty);
        const kwW = c.measureText(kw).width;
        c.font = font(F.hei(700), 34); c.fillStyle = rgba('sepia', 0.9); c.fillText(txt.slice(kw.length), TX + kwW, ty);
      } else { c.fillStyle = rgba('sepia', 0.85); c.fillText(txt, TX, ty); }
      c.restore();
    }
    // 按鍵提示
    const hy2 = rowY(NROW + 1) + 38;
    c.font = font(F.mono(500), 17); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.45);
    c.fillText(`↑↓ 選擇 · ENTER 送出祝福 · 約有 ∞ 則結果（${(0.1 + (this.ctx.song.index % 7) * 0.01).toFixed(2)} 秒）`, TX, hy2);
    c.letterSpacing = '0px';
  }
}
