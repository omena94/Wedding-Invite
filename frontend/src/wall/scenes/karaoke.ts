// 保底版面：最單純的逐字跟唱（照 pdoom-video 的 starter 版面 karaoke.ts 改的），任何歌都能用。
// 也是寫新版面的範本：一個 Canvas2D 層畫字、一個加亮的 LineBatch 畫火花、拍點與鼓點驅動的小動作。
//  - 目前這行歌詞大大的、瑞士網格靠左，唱到的字亮起來，正在唱的用訊號色，火花跟著筆尖
//  - 下一行用 mono 小字在下面等；一條細線隨大鼓呼吸
//  - 右上角是這個窗格主打的留言（手寫字、署名），沒有歌詞時留言放大到中間
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides, type Msg } from '../engine/scene';
import { Layer2D, W, H, clearRT } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, prog } from '../engine/util';
import { sparkHead, sparkParticles, lyricAt, drawLyric, layoutLyric, layoutMessage, drawMessage, signature, beatAfter } from './_motifs';

const X0 = 160;
const BASE = H * 0.62;

export default class Karaoke extends Scene {
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  /** 留言的排版（兩種位置各算一次，不要每格重算：fitText 要量上百次字寬）。 */
  private fits = new Map<boolean, ReturnType<typeof layoutMessage>>();

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t;
    clearRT(renderer, out, LIN.ink);
    const L = this.layer; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const fadeIn = prog(t, this.ctx.start, this.ctx.start + 0.4), fadeOut = 1 - prog(t, this.ctx.end - 0.35, this.ctx.end);
    c.globalAlpha = Math.min(fadeIn, fadeOut);

    // mono 註記（機器的聲音）：拍子計數
    c.font = font(F.mono(500), 15);
    c.letterSpacing = '3px';
    c.fillStyle = rgba('bone', 0.4);
    c.fillText(`BAR ${String(Math.floor(f.bar) + 1).padStart(3, '0')} · ${Math.floor(f.beatPhase * 4) + 1}/4`, X0, 110);
    c.fillText(`${Math.round(au.bpm)} BPM`, X0 + 260, 110);
    c.letterSpacing = '0px';

    const ly = lyricAt(lyrics, t);
    let head: { x: number; y: number } | null = null;
    if (ly) {
      const st = { family: F.archivo(87.5, 800), size: 128, minSize: 60, maxWidth: W - 2 * X0 - 80 };
      const lay = layoutLyric(c, ly.line, st);
      // 新的一行從下面彈上來
      const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.2));
      c.save();
      c.translate(X0, BASE + (1 - inK) * 50 - (lay.height - lay.size));
      const h = drawLyric(c, ly.line, t, st, lay, ly.k);
      c.restore();
      if (h) head = { x: X0 + h.x, y: BASE + (1 - inK) * 50 - (lay.height - lay.size) + h.y };
      const next = lyrics.lines[ly.line.i + 1];
      if (next) {
        const k = prog(t, next.start - 2, next.start - 0.4, ease.inOutCubic);
        c.font = font(F.mono(400), 28);
        c.fillStyle = rgba('bone', 0.1 + 0.28 * k);
        c.fillText(next.text, X0, BASE + 130);
      }
    }
    // 細線：跟著大鼓呼吸
    const kick = f.a.kick;
    c.fillStyle = rgba('bone', 0.16 + 0.45 * kick);
    c.fillRect(X0, BASE + 62, (W - 2 * X0) * (0.2 + 0.8 * clamp(f.barPhase + kick * 0.1)), 1 + kick * 2);

    if (this.msg) this.drawMsg(c, t, !ly);
    comp.draw(renderer, L.upload(), out);
    if (head) {
      const h = head as { x: number; y: number };
      sparkParticles(this.glow, t, () => h, { rate: 60, life: 0.3, speed: 180 });
      sparkHead(this.glow, h.x, h.y, t, 0.9);
    }
    if (this.glow.count) this.glow.render(renderer, out);
    return { bloom: 0.6, vignette: 0.35, popupAvoid: [[X0 - 20, BASE - 300, W - 2 * X0 + 40, 460], this.msg && lyrics.has ? [W - X0 - 780, 150, 800, 340] : [X0 - 20, 200, 1440, 520]] };
  }

  /** 主打留言：有歌詞時在右上角的卡片，沒歌詞時放大到畫面中間。第一個拍點後逐字寫出來。 */
  private drawMsg(c: CanvasRenderingContext2D, t: number, hero: boolean) {
    const m = this.msg!, au = this.ctx.audio;
    const t0 = beatAfter(au, this.ctx.start + 0.1);
    const w = hero ? 1400 : 760, h = hero ? 420 : 300;
    const x = hero ? X0 : W - X0 - w, y = hero ? 250 : 170;
    let fit = this.fits.get(hero);
    if (!fit) { fit = layoutMessage(c, m.text, F.hand(400), w, h, { max: hero ? 120 : 64 }); this.fits.set(hero, fit); }
    const total = Array.from(fit.lines.join('')).length;
    const chars = total * prog(t, t0, t0 + Math.min(2.5, 0.08 * total + 0.4));
    drawMessage(c, fit, F.hand(400), x, y + fit.size, { chars, color: rgba('bone', 0.95) });
    const ka = prog(t, t0 + 0.6, t0 + 1.2);
    c.save();
    c.globalAlpha *= ka;
    c.font = font(F.hand(400), hero ? 44 : 32);
    c.fillStyle = rgba('ash');
    c.fillText(signature(m.name), x, y + fit.size + fit.height + (hero ? 70 : 50));
    c.restore();
  }
}
