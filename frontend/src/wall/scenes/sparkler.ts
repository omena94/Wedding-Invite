// 仙女棒寫字（照 pdoom 的 open / fuse：火花是整支影片的主角，拖著一條線把字寫出來）。
// 暗色的信紙：細橫線對齊字的基線、左邊一條訊號色的邊線。仙女棒從第一個拍點開始，一個字一個字把主打留言寫出來，
// 剛寫好的字是燒紅的（訊號色、會發光），約一秒冷卻成紙白；寫完再用同一支筆簽名。
// 上方是「信頭」：正在唱的那行歌詞（逐字跟唱，比留言小一級），下面一條細線跟著大鼓呼吸。
// 沒有留言的窗格：仙女棒改成跟著歌聲寫歌詞（唱到哪寫到哪），信頭放歌名。
// 2026-09-28 依「MV 融合原則」調整：
//  - 仙女棒是真的光源：筆尖附近的信紙被照亮（暖暖的一團光，橫線在光裡比較清楚），寫完光慢慢熄掉——
//    暗房間裡只有一支仙女棒在寫字，畫面自然只有一個焦點。
//  - 留言可以用整個寬度（右邊不用再替即時小卡留空）；信紙的橫線與邊線在四周淡出，不是一個方框。
//  - 拿掉角落的編號（只剩新人留言的小標）；鏡頭整個窗格慢慢推近。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type Msg } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, layout, loadText, type TextLayout } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { Lyrics, type Line } from '../engine/lyrics';
import { sparkHead, sparkParticles, lyricAt, drawLyric, layoutLyric, beatAfter, signature, drawHeart } from './_motifs';

/** 留言（或歌詞）寫在這一塊裡；下面留 110 給簽名。右下角 QR 區（x ≥ 1360、y ≥ 830）在它下面。 */
const BOX = { x: 220, y: 292, w: 1480, h: 530 };
/** 信頭（歌詞或歌名）的基線與它下面那條細線。 */
const HEAD_Y = 196, RULE_Y = 232;
/** 簽名的基線最低到這裡：簽名靠右，常常落在 x ≥ 1360，推鏡之後也不能碰到右下角 QR 區（y ≥ 830）。 */
const SIG_MAX_Y = 790;
const SKEW = 0.6; // 寫字的掃描線斜度（由左上往右下，像筆順）
const COOL = 0.9; // 字從燒紅冷卻到紙白要幾秒
/** 仙女棒停下來之後，照在紙上的光幾秒熄掉。 */
const EMBER = 0.5;

const BG = () => new FSPass(/* glsl */ `
  uniform float t; uniform float gap; uniform float y0; uniform float k; uniform float margin;
  uniform vec2 pen; uniform float penI;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y); // 轉成 y 向下，跟 Canvas2D 一樣
    vec3 col = C_INK + (C_INK2 - C_INK) * (0.45 + 0.4 * fbm(p / 380.0 + vec2(t * 0.015, 0.0), 4));
    // 仙女棒照在紙上的光：近的一團亮、遠的一大片很淡（暖色＝訊號色）
    float r = length(p - pen);
    float pl = penI * (0.5 * exp(-r / 150.0) + 0.5 * exp(-r / 460.0));
    col += C_SIGNAL * 0.08 * pl + (C_INK2 - C_INK) * 0.9 * pl;
    // 橫線：對齊字的基線，四周慢慢淡出（不是一個框），在光裡比較清楚
    float d = abs(mod(p.y - y0 + gap * 0.5, gap) - gap * 0.5);
    float page = smoothstep(${BOX.x - 90}.0, ${BOX.x - 20}.0, p.x) * (1.0 - smoothstep(${BOX.x + BOX.w - 40}.0, ${BOX.x + BOX.w + 90}.0, p.x))
               * smoothstep(${RULE_Y + 50}.0, ${RULE_Y + 100}.0, p.y) * (1.0 - smoothstep(790.0, 860.0, p.y));
    col += C_BONE * pxLine(d, 0.35, 1.2) * (0.045 + 0.12 * pl) * page * k;
    // 左邊的邊線（訊號色，很淡，上下淡出）
    float mv = smoothstep(${RULE_Y + 20}.0, ${RULE_Y + 140}.0, p.y) * (1.0 - smoothstep(820.0, 940.0, p.y));
    col += C_SIGNAL * pxLine(abs(p.x - margin), 0.35, 1.2) * (0.16 + 0.3 * pl) * k * mv;
    fragColor = vec4(col, 1.0);
  }`, {
  t: { value: 0 }, gap: { value: 90 }, y0: { value: 400 }, k: { value: 1 }, margin: { value: BOX.x - 28 },
  pen: { value: new THREE.Vector2(-9999, -9999) }, penI: { value: 0 },
});

interface Glyphs { lay: TextLayout; x: number; y: number; t0: number; t1: number }

/** 畫一個字；♥ 換成我們自己畫的愛心（字型裡的 ♥ 每套字長得不一樣，TREATMENT 規定只用 drawHeart）。 */
function glyph(c: CanvasRenderingContext2D, ch: string, x: number, y: number, w: number, size: number, color: string) {
  if (ch === '♥') { drawHeart(c, x + w / 2, y - size * 0.36, Math.min(w, size) * 0.78, color); return; }
  c.fillStyle = color;
  c.fillText(ch, x, y);
}
type P2 = { x: number; y: number };
/** 沒有留言時一行歌詞的排版（每一行只排一次）。 */
/**
 * 沒有留言時一行歌詞的排版（每一行只排一次）。每個字記下它在歌詞原文裡的位置（UTF-16，跟 lineCharProgress 同一套）
 * 與唱完的時間：斷行時吃掉的空白不會讓後面的字對不上，唱完的字也能照時間從燒紅冷卻。
 */
interface LyricGlyph { ch: string; x: number; w: number; row: number; off: number; len: number; done: number }
interface LyricSet { fit: FitResult; glyphs: LyricGlyph[]; top: number }

export default class Sparkler extends Scene {
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 燒紅的字另外畫一層、加亮疊上去才會發光（低解析度就夠，本來就是一團光）。 */
  hot = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  glow = this.track(new LineBatch(4096, { screen2D: true, blend: 'add' }));
  bg = shared('sparkler.bg', BG);
  msg: Msg | null = this.ctx.params.message ?? null;
  fit: FitResult | null = null;
  lines: Glyphs[] = [];
  sig: Glyphs | null = null;
  writeEnd = 0;
  private lyricSets = new Map<Line, LyricSet>();

  /** 信紙橫線的基線與間距：有留言對齊留言；沒有留言對齊窗格裡第一句歌詞（之後字級不同的句子就讓它不對齊）。 */
  gridY0 = 560; gridGap = 120;

  override async init() {
    const { audio: au, lyrics, start, end } = this.ctx;
    if (!this.msg) {
      // 歌詞的排版會快取：先把這個窗格會寫到的字載好，量字寬才不會量到備援字型
      const ls = lyrics.linesIn(start - 2, end);
      await loadText(ls.map((l) => l.text).join('') + this.ctx.song.title + (this.ctx.song.artist ?? ''));
      const first = lyrics.linesIn(start, end)[0];
      if (first) { const set = this.lyricSet(first); this.gridY0 = set.top; this.gridGap = set.fit.lineHeight; }
      return;
    }
    const c = this.layer.ctx;
    const family = F.hand(400);
    this.fit = fitText(c, this.msg.text, family, BOX.w, BOX.h - 110, { min: 48, max: 150, lineHeight: 1.42, maxLines: 5 });
    const fit = this.fit;
    // 從第一個拍點開始寫；一個字約 0.085 秒，整則 1.4～4.5 秒寫完
    const n = fit.lines.reduce((s, l) => s + Array.from(l).length, 0);
    const t0 = beatAfter(au, this.ctx.start + 0.15);
    const dur = clamp(0.085 * n + 0.6, 1.4, 4.5);
    let acc = 0;
    const top = BOX.y + (BOX.h - 110 - fit.height) / 2 + fit.size;
    this.lines = fit.lines.map((ln, i) => {
      const lay = layout(ln, family, fit.size);
      const k = Array.from(ln).length;
      const g = { lay, x: BOX.x, y: top + i * fit.lineHeight, t0: t0 + (dur * acc) / n, t1: t0 + (dur * (acc + k)) / n };
      acc += k;
      return g;
    });
    this.writeEnd = t0 + dur;
    // 簽名：寫完後停半拍，靠右寫在最後一行下面
    const sigSize = clamp(fit.size * 0.45, 42, 58);
    const sl = layout(signature(this.msg.name), family, sigSize);
    const last = this.lines[this.lines.length - 1]!;
    const s0 = this.writeEnd + au.beatPeriod(this.writeEnd) * 0.5;
    this.sig = { lay: sl, x: Math.min(BOX.x + BOX.w - sl.width, BOX.x + Math.max(...this.lines.map((l) => l.lay.width)) - sl.width + 40), y: Math.max(last.y + sigSize * 1.25, Math.min(last.y + Math.max(fit.lineHeight * 0.8, sigSize * 1.6), SIG_MAX_Y)), t0: s0, t1: s0 + clamp(0.07 * sl.glyphs.length + 0.3, 0.6, 1.4) };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, song } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const fadeIn = prog(t, s, s + 0.5), exit = prog(t, e - 0.6, e, ease.inCubic);
    const fit = this.fit;
    // 先畫字（要知道筆尖在哪，信紙的光才打得對），再畫底、疊上去
    const L = this.layer, HL = this.hot;
    L.clear(); HL.clear();
    const c = L.ctx, hc = HL.ctx;
    this.glow.clear();
    c.globalAlpha = hc.globalAlpha = fadeIn * (1 - exit);
    let pen: P2 | null = null;

    // 信頭：正在唱的歌詞（第二層，比留言小一級）；沒有留言時信頭放歌名（歌詞由仙女棒寫在信紙上）
    const ly = lyricAt(lyrics, t);
    if (this.msg && ly) {
      const st = { family: F.archivo(100, 800), size: 60, minSize: 48, maxWidth: BOX.w + 40 };
      c.save(); c.translate(BOX.x - 40, HEAD_Y);
      drawLyric(c, ly.line, t, st, layoutLyric(c, ly.line, st), ly.k);
      c.restore();
    } else if (!this.msg) {
      c.font = font(F.mono(500), 18); c.letterSpacing = '4px'; c.fillStyle = rgba('ash', 0.7);
      c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`.toUpperCase(), BOX.x - 40, HEAD_Y);
      c.letterSpacing = '0px';
    }
    // 信頭下的細線：大鼓一打就亮一下（很淡，兩端淡出）
    const kick = f.a.kick;
    const rg = c.createLinearGradient(BOX.x - 40, 0, BOX.x + BOX.w + 40, 0);
    rg.addColorStop(0, rgba('bone', 0.1 + 0.3 * kick)); rg.addColorStop(0.75, rgba('bone', 0.08 + 0.2 * kick)); rg.addColorStop(1, rgba('bone', 0));
    c.fillStyle = rg;
    c.fillRect(BOX.x - 40, RULE_Y, BOX.w + 80, 1 + kick * 1.5);

    let light: { p: P2; k: number } | null = null;
    if (this.msg && fit) {
      for (const g of this.lines) pen = this.write(c, hc, g, t, fit.size) ?? pen;
      if (this.sig) pen = this.write(c, hc, this.sig, t, this.sig.lay.size, rgba('ash')) ?? pen;
      // 新人自己的留言：信頭右邊一個很小的標籤
      if (this.msg.couple) {
        c.textAlign = 'right';
        c.font = font(F.mono(500), 16); c.letterSpacing = '4px'; c.fillStyle = rgba('signal', 0.8 * prog(t, s + 0.3, s + 0.9));
        c.fillText('FROM THE COUPLE  ·  新人', BOX.x + BOX.w, HEAD_Y);
        c.letterSpacing = '0px'; c.textAlign = 'left';
      }
      light = this.msgLight(t);
    } else {
      pen = this.writeLyric(c, hc, t);
      light = this.lyricLight(t);
    }

    this.bg.u.t!.value = t;
    this.bg.u.gap!.value = fit ? fit.lineHeight : this.gridGap;
    this.bg.u.y0!.value = this.lines[0]?.y ?? this.gridY0;
    this.bg.u.k!.value = fadeIn * (1 - exit);
    (this.bg.u.pen!.value as THREE.Vector2).set(light ? light.p.x : -9999, light ? light.p.y : -9999);
    this.bg.u.penI!.value = light ? light.k * (1 - exit) : 0;
    this.bg.render(renderer, out);
    comp.draw(renderer, L.upload(), out);
    comp.draw(renderer, HL.upload(), out, { mode: 'add', tint: [1.9, 1.9, 1.9] });
    if (pen && exit < 0.5) {
      const p = pen;
      sparkParticles(this.glow, t, () => p, { rate: 110, life: 0.4, speed: 230, seed: this.ctx.params.seed ?? 1 });
      sparkHead(this.glow, p.x, p.y, t, 1.05);
    }
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭整個窗格慢慢推近（後製的 zoom 不影響角落 QR）
    return { bloom: 0.75, vignette: 0.55, zoom: 1 + 0.04 * ease.inOutQuad(f.p) };
  }

  /**
   * 仙女棒照在紙上的光（只由時間決定）：正在寫的那一段就在筆尖、全亮；停筆之後留在最後一個字、慢慢熄掉。
   * 字與字、行與行之間的空檔很短，光不會一閃一閃。
   */
  private msgLight(t: number): { p: P2; k: number } | null {
    let best: { p: P2; k: number } | null = null;
    for (const g of [...this.lines, ...(this.sig ? [this.sig] : [])]) {
      if (t < g.t0) break;
      const size = g.lay.size, n = g.lay.glyphs.length;
      if (t < g.t1) {
        const u = ((t - g.t0) / (g.t1 - g.t0)) * n, i = Math.min(n - 1, Math.floor(u));
        const gl = g.lay.glyphs[i]!;
        return { p: { x: g.x + gl.x + gl.w * (u - i), y: g.y - size * 0.4 }, k: 1 };
      }
      best = { p: { x: g.x + g.lay.width, y: g.y - size * 0.4 }, k: Math.exp(-(t - g.t1) / EMBER) };
    }
    return best;
  }

  /** 沒有留言：光跟著寫歌詞的筆尖；唱到一半停住（換氣、句子之間）時慢慢熄掉。 */
  private lyricLight(t: number): { p: P2; k: number } | null {
    const ly = lyricAt(this.ctx.lyrics, t, 1.6, 0.2);
    if (!ly) return null;
    const set = this.lyricSet(ly.line);
    const now = Lyrics.lineCharProgress(ly.line, t);
    if (now <= 0 || !set.glyphs.length) return null;
    // 最近 0.35 秒寫了多少：一直在寫就是全亮，停下來就熄
    const k = clamp((now - Lyrics.lineCharProgress(ly.line, t - 0.35)) * 1.4) * ly.k;
    let g = set.glyphs[0]!;
    for (const q of set.glyphs) { if (q.off <= now) g = q; else break; }
    const u = clamp((now - g.off) / g.len);
    return { p: { x: BOX.x + g.x + g.w * u, y: set.top + g.row * set.fit.lineHeight - set.fit.size * 0.4 }, k };
  }

  /**
   * 寫一行（逐字斜掃出現）。已經寫好的字畫在主層（冷卻中的字同時也畫在發光層），回傳筆尖位置（這行正在寫時）。
   */
  private write(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, g: Glyphs, t: number, size: number, done = rgba('bone', 0.96)): P2 | null {
    if (t < g.t0) return null;
    const n = g.lay.glyphs.length, per = (g.t1 - g.t0) / Math.max(1, n);
    c.font = hc.font = font(g.lay.family, size);
    c.textBaseline = hc.textBaseline = 'alphabetic';
    let pen: P2 | null = null;
    for (const gl of g.lay.glyphs) {
      const a = g.t0 + gl.i * per;
      if (t < a) break;
      const r = clamp((t - a) / per);
      const x = g.x + gl.x, top = g.y - size * 0.92, h = size * 1.15;
      const heat = 1 - clamp((t - a - per) / COOL);
      // 冷卻後的顏色；愛心冷卻成點綴色（玫瑰）
      const cool = gl.ch === '♥' ? rgba('rose') : done;
      const col = heat > 0.02 ? mixRgba(gl.ch === '♥' ? 'rose' : 'bone', 'signal', heat * 0.9, 0.96) : cool;
      if (r < 1) {
        const S = r * (gl.w + SKEW * h);
        for (const ctx of heat > 0.05 ? [c, hc] : [c]) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(x - 10, top - 10); ctx.lineTo(x + S + 10 * SKEW, top - 10); ctx.lineTo(x + S - SKEW * (h + 10), top + h + 10); ctx.lineTo(x - 10, top + h + 10);
          ctx.closePath(); ctx.clip();
          glyph(ctx, gl.ch, x, g.y, gl.w, size, ctx === hc ? rgba('signal', heat) : col);
          ctx.restore();
        }
        pen = { x: x + clamp(S - SKEW * h * 0.5, 0, gl.w), y: top + h * 0.5 };
      } else {
        glyph(c, gl.ch, x, g.y, gl.w, size, col);
        if (heat > 0.05) glyph(hc, gl.ch, x, g.y, gl.w, size, rgba('signal', heat * heat));
      }
    }
    return pen;
  }

  /** 沒有留言時一行歌詞的排版（大大的手寫字，最多兩行）：每一行只排一次。 */
  private lyricSet(line: Line): LyricSet {
    let set = this.lyricSets.get(line);
    if (!set) {
      const family = F.hand(700);
      const fit = fitText(this.layer.ctx, line.text, family, BOX.w, BOX.h - 60, { min: 60, max: 150, lineHeight: 1.3, maxLines: 2 });
      const glyphs: LyricGlyph[] = [];
      let cursor = 0;
      fit.lines.forEach((ln, row) => {
        // 這一排在原文裡從哪裡開始（斷行吃掉的空白跳過去）
        const at = line.text.indexOf(ln, cursor), base = at >= 0 ? at : cursor;
        cursor = base + ln.length;
        let o = base;
        for (const gl of layout(ln, family, fit.size).glyphs) {
          // 這個字唱完的時間：它所在的那個詞，照字數平分
          const wd = line.words.find((w) => o >= w.o && o < w.o + w.w.length);
          const done = wd ? wd.start + ((o - wd.o + gl.ch.length) / wd.w.length) * (wd.end - wd.start) : line.start;
          glyphs.push({ ch: gl.ch, x: gl.x, w: gl.w, row, off: o, len: gl.ch.length, done });
          o += gl.ch.length;
        }
      });
      set = { fit, glyphs, top: BOX.y + (BOX.h - 60 - fit.height) / 2 + fit.size };
      this.lyricSets.set(line, set);
    }
    return set;
  }

  /**
   * 沒有留言：仙女棒跟著歌聲寫歌詞，一次一行，大大的。還沒唱的字淡淡地先在紙上，唱到的字被斜斜地寫出來、
   * 燒紅，唱完約一秒冷卻成紙白（跟寫留言同一種筆）。
   */
  private writeLyric(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number): P2 | null {
    const ly = lyricAt(this.ctx.lyrics, t, 1.6, 0.2);
    if (!ly) return null;
    const line = ly.line, family = F.hand(700);
    const { fit, glyphs, top } = this.lyricSet(line);
    const chars = Lyrics.lineCharProgress(line, t);
    let pen: P2 | null = null;
    c.save(); hc.save();
    c.globalAlpha *= ly.k; hc.globalAlpha *= ly.k;
    c.font = hc.font = font(family, fit.size);
    c.textBaseline = hc.textBaseline = 'alphabetic';
    for (const g of glyphs) {
      const x = BOX.x + g.x, y = top + g.row * fit.lineHeight;
      const r = clamp((chars - g.off) / g.len);
      if (r < 1) { c.fillStyle = rgba('bone', 0.14); c.fillText(g.ch, x, y); }
      if (r <= 0) continue;
      const heat = r < 1 ? 1 : 1 - clamp((t - g.done) / COOL);
      const col = heat > 0.02 ? mixRgba('bone', 'signal', heat * 0.9, 0.96) : rgba('bone', 0.96);
      if (r < 1) {
        const h = fit.size * 1.15, tp = y - fit.size * 0.92, S = r * (g.w + SKEW * h);
        for (const ctx of [c, hc]) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(x - 10, tp - 10); ctx.lineTo(x + S + 10 * SKEW, tp - 10); ctx.lineTo(x + S - SKEW * (h + 10), tp + h + 10); ctx.lineTo(x - 10, tp + h + 10);
          ctx.closePath(); ctx.clip();
          ctx.fillStyle = ctx === hc ? rgba('signal', 0.9) : col;
          ctx.fillText(g.ch, x, y);
          ctx.restore();
        }
        pen = { x: x + clamp(S - SKEW * h * 0.5, 0, g.w), y: tp + h * 0.5 };
      } else {
        c.fillStyle = col;
        c.fillText(g.ch, x, y);
        if (heat > 0.05) { hc.fillStyle = rgba('signal', heat * heat * 0.9); hc.fillText(g.ch, x, y); }
      }
    }
    c.restore(); hc.restore();
    return pen;
  }
}
