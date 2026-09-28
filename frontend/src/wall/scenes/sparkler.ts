// 仙女棒寫字（照 pdoom 的 open / fuse：火花是整支影片的主角，拖著一條線把字寫出來）。
// 暗色的信紙：細橫線對齊字的基線、左邊一條訊號色的邊線。仙女棒從第一個拍點開始，一個字一個字把主打留言寫出來，
// 剛寫好的字是燒紅的（訊號色、會發光），約一秒冷卻成紙白；寫完再用同一支筆簽名。
// 上方是「信頭」：正在唱的那行歌詞（逐字跟唱），下面一條細線跟著大鼓呼吸。
// 沒有留言的窗格：仙女棒改成跟著歌聲寫歌詞（唱到哪寫到哪），信頭放歌名。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type Msg } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, layout, type TextLayout } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { Lyrics } from '../engine/lyrics';
import { sparkHead, sparkParticles, lyricAt, drawLyric, layoutLyric, beatAfter, signature } from './_motifs';

// 右邊留一條（x ≥ 1380）給即時留言小卡，主打留言與歌詞都不進去
const BOX = { x: 230, y: 300, w: 1150, h: 520 };
const SKEW = 0.6; // 寫字的掃描線斜度（由左上往右下，像筆順）
const COOL = 0.9; // 字從燒紅冷卻到紙白要幾秒

const BG = () => new FSPass(/* glsl */ `
  uniform float t; uniform float gap; uniform float y0; uniform float k; uniform float margin;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y); // 轉成 y 向下，跟 Canvas2D 一樣
    vec3 col = C_INK + (C_INK2 - C_INK) * (0.55 + 0.45 * fbm(p / 380.0 + vec2(t * 0.015, 0.0), 4));
    // 橫線：對齊字的基線，只畫在信紙範圍內
    float d = abs(mod(p.y - y0 + gap * 0.5, gap) - gap * 0.5);
    float inPage = step(${BOX.x - 60}.0, p.x) * step(p.x, ${BOX.x + BOX.w + 60}.0) * step(y0 - gap * 1.2, p.y) * step(p.y, y0 + gap * 6.0);
    col += C_BONE * pxLine(d, 0.35, 1.2) * 0.075 * inPage * k;
    // 左邊的邊線（訊號色，很淡）
    col += C_SIGNAL * pxLine(abs(p.x - margin), 0.35, 1.2) * 0.22 * k * step(120.0, p.y) * step(p.y, ${H - 110}.0);
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 }, gap: { value: 90 }, y0: { value: 400 }, k: { value: 1 }, margin: { value: BOX.x - 40 } });

interface Glyphs { lay: TextLayout; x: number; y: number; t0: number; t1: number }

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

  override init() {
    const { audio: au } = this.ctx;
    if (!this.msg) return;
    const c = this.layer.ctx;
    const family = F.hand(400);
    this.fit = fitText(c, this.msg.text, family, BOX.w, BOX.h - 110, { min: 44, max: 132, lineHeight: 1.42, maxLines: 5 });
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
    const sigSize = Math.max(40, fit.size * 0.5);
    const sl = layout(signature(this.msg.name), family, sigSize);
    const last = this.lines[this.lines.length - 1]!;
    const s0 = this.writeEnd + au.beatPeriod(this.writeEnd) * 0.5;
    this.sig = { lay: sl, x: Math.min(BOX.x + BOX.w - sl.width, BOX.x + Math.max(...this.lines.map((l) => l.lay.width)) - sl.width + 40), y: last.y + fit.lineHeight * 0.95, t0: s0, t1: s0 + clamp(0.07 * sl.glyphs.length + 0.3, 0.6, 1.4) };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, song } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const fadeIn = prog(t, s, s + 0.5), exit = prog(t, e - 0.6, e, ease.inCubic);
    const fit = this.fit;
    this.bg.u.t!.value = t;
    this.bg.u.gap!.value = fit ? fit.lineHeight : 120;
    this.bg.u.y0!.value = this.lines[0]?.y ?? 560;
    this.bg.u.k!.value = fadeIn * (1 - exit);
    this.bg.render(renderer, out);
    const L = this.layer, HL = this.hot;
    L.clear(); HL.clear();
    const c = L.ctx, hc = HL.ctx;
    this.glow.clear();
    c.globalAlpha = hc.globalAlpha = fadeIn * (1 - exit);
    let pen: { x: number; y: number } | null = null;

    // 信頭：正在唱的歌詞；沒有留言時信頭放歌名（歌詞由仙女棒寫在信紙上）
    const ly = lyricAt(lyrics, t);
    if (this.msg && ly) {
      const st = { family: F.archivo(100, 800), size: 66, minSize: 40, maxWidth: BOX.w + 40 };
      c.save(); c.translate(BOX.x - 40, 190);
      drawLyric(c, ly.line, t, st, layoutLyric(c, ly.line, st), ly.k);
      c.restore();
    } else if (!this.msg) {
      c.font = font(F.mono(500), 18); c.letterSpacing = '4px'; c.fillStyle = rgba('ash', 0.8);
      c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`.toUpperCase(), BOX.x - 40, 190);
      c.letterSpacing = '0px';
    }
    // 信頭下的細線：大鼓一打就亮一下
    const kick = f.a.kick;
    c.fillStyle = rgba('bone', 0.14 + 0.4 * kick);
    c.fillRect(BOX.x - 40, 226, BOX.w + 80, 1 + kick * 1.5);

    if (this.msg && fit) {
      for (const g of this.lines) pen = this.write(c, hc, g, t, fit.size) ?? pen;
      if (this.sig) pen = this.write(c, hc, this.sig, t, this.sig.lay.size, rgba('ash')) ?? pen;
      // mono 的小註記：第幾則、幾點寫的（像信紙角落的編號）
      c.font = font(F.mono(500), 15); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.7 * prog(t, s + 0.3, s + 0.9));
      c.fillText(`NO.${String(this.msg.n).padStart(3, '0')}${this.msg.couple ? '  ·  FROM THE COUPLE' : ''}`, BOX.x - 40, H - 150);
      c.letterSpacing = '0px';
    } else {
      pen = this.writeLyric(c, hc, t);
    }
    comp.draw(renderer, L.upload(), out);
    comp.draw(renderer, HL.upload(), out, { mode: 'add', tint: [1.9, 1.9, 1.9] });
    if (pen && exit < 0.5) {
      const p = pen;
      sparkParticles(this.glow, t, () => p, { rate: 110, life: 0.4, speed: 230, seed: this.ctx.params.seed ?? 1 });
      sparkHead(this.glow, p.x, p.y, t, 1.05);
    }
    if (this.glow.count) this.glow.render(renderer, out);
    return { bloom: 0.75, vignette: 0.5, zoom: 1 + 0.025 * f.p, popupAvoid: [[BOX.x - 50, 110, BOX.w + 90, 140], [BOX.x - 20, BOX.y - 40, BOX.w + 40, BOX.h + 80]] };
  }

  /**
   * 寫一行（逐字斜掃出現）。已經寫好的字畫在主層（冷卻中的字同時也畫在發光層），回傳筆尖位置（這行正在寫時）。
   */
  private write(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, g: Glyphs, t: number, size: number, done = rgba('bone', 0.96)): { x: number; y: number } | null {
    if (t < g.t0) return null;
    const n = g.lay.glyphs.length, per = (g.t1 - g.t0) / Math.max(1, n);
    c.font = hc.font = font(g.lay.family, size);
    c.textBaseline = hc.textBaseline = 'alphabetic';
    let pen: { x: number; y: number } | null = null;
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
          ctx.fillStyle = ctx === hc ? rgba('signal', heat) : col;
          ctx.fillText(gl.ch, x, g.y);
          ctx.restore();
        }
        pen = { x: x + clamp(S - SKEW * h * 0.5, 0, gl.w), y: top + h * 0.5 };
      } else {
        c.fillStyle = col;
        c.fillText(gl.ch, x, g.y);
        if (heat > 0.05) { hc.fillStyle = rgba('signal', heat * heat); hc.fillText(gl.ch, x, g.y); }
      }
    }
    return pen;
  }

  /** 沒有留言：仙女棒跟著歌聲寫歌詞，一次一行，大大的；寫完的行往上淡出。 */
  private writeLyric(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number): { x: number; y: number } | null {
    const ly = lyricAt(this.ctx.lyrics, t, 1.6, 0.2);
    if (!ly) return null;
    const line = ly.line, family = F.hand(700);
    const fit = fitText(c, line.text, family, BOX.w, BOX.h, { min: 56, max: 150, lineHeight: 1.3, maxLines: 2 });
    const chars = Lyrics.lineCharProgress(line, t);
    let pen: { x: number; y: number } | null = null;
    let left = chars, idx = 0;
    const top = BOX.y + (BOX.h - fit.height) / 2 + fit.size;
    c.save(); hc.save();
    c.globalAlpha *= ly.k; hc.globalAlpha *= ly.k;
    fit.lines.forEach((ln, i) => {
      const lay = layout(ln, family, fit.size);
      c.font = hc.font = font(family, fit.size);
      for (const gl of lay.glyphs) {
        const r = clamp(left - idx);
        idx++;
        const x = BOX.x + gl.x, y = top + i * fit.lineHeight;
        c.fillStyle = rgba('bone', 0.14);
        c.fillText(gl.ch, x, y);
        if (r <= 0) continue;
        const h = fit.size * 1.15, tp = y - fit.size * 0.92, S = r * (gl.w + SKEW * h);
        const w = this.ctx.lyrics.wordAt(t);
        const hotNow = r < 1 || (w && w.line === line.i && Array.from(line.text.slice(0, w.o + w.w.length)).length >= idx);
        c.save();
        c.beginPath();
        c.moveTo(x - 10, tp - 10); c.lineTo(x + S + 10 * SKEW, tp - 10); c.lineTo(x + S - SKEW * (h + 10), tp + h + 10); c.lineTo(x - 10, tp + h + 10);
        c.closePath(); c.clip();
        c.fillStyle = hotNow ? rgba('signal') : rgba('bone', 0.96);
        c.fillText(gl.ch, x, y);
        c.restore();
        if (hotNow) { hc.fillStyle = rgba('signal', 0.8); hc.fillText(gl.ch, x, y); }
        if (r < 1) pen = { x: x + clamp(S - SKEW * h * 0.5, 0, gl.w), y: tp + h * 0.5 };
      }
    });
    c.restore(); hc.restore();
    void hash; void lerp;
    return pen;
  }
}
