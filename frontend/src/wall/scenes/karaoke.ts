// 保底版面：最單純的逐字跟唱＋主打留言（照 pdoom-video 的 starter 版面 karaoke.ts 改的），任何歌都能用。
// 也是寫新版面的範本：一個全螢幕 shader 畫底、一個 Canvas2D 層畫字、一個加亮的 LineBatch 畫火花。
// 2026-09-28 依「MV 融合原則」重做：像暗場舞台上的一段獨白——
//  - 有主打留言時，留言就是焦點：手寫字、大大的、靠左，後面有一團很淡的光（像打在它身上的燈），第一個拍點後一個字一個字寫出來、署名；
//    歌詞退到下面一行（≥ 48 px，比留言小一級），照跟唱規則，仙女棒的火花跟著唱到的字。
//  - 沒有留言：歌詞放大到畫面中間，是唯一的焦點。沒有歌詞（純音樂）：留言再放大一點。
//  - 拿掉拍子計數、下一句預告、會呼吸的細線（介面感）；整個窗格鏡頭很慢地推近，光也慢慢飄。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type Msg } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { ease, lerp, prog } from '../engine/util';
import type { FitResult } from '../engine/text';
import { sparkHead, sparkParticles, lyricAt, drawLyric, layoutLyric, layoutMessage, drawMessage, signature, beatAfter, msgChars, type LyricStyle } from './_motifs';

const BG = () => new FSPass(/* glsl */ `
  uniform float t; uniform float k; uniform vec2 lp; uniform float li;
  void main() {
    vec2 p = FRAG_PX;
    // 底：暗色裡有一點慢慢飄的霧（空氣），後面一團柔光（lp 是 y 向上的像素座標）
    vec3 col = C_INK + (C_INK2 - C_INK) * (0.3 + 0.45 * fbm(p / 560.0 + vec2(t * 0.011, t * 0.004), 3));
    vec2 d = (p - lp) / vec2(1050.0, 640.0);
    float light = exp(-dot(d, d) * 1.7) * li * k;
    col += (C_INK2 - C_INK) * 1.8 * light + C_SIGNAL * 0.007 * light;
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 }, k: { value: 1 }, lp: { value: new THREE.Vector2(760, 600) }, li: { value: 1 } });

const X0 = 160;
/** 有留言時歌詞那一行的基線（最後一行；折兩行時往上長）：在右下角 QR 區（y ≥ 830）上面。 */
const LYRIC_Y = 806;
/** 留言的框：有歌詞時在上面一大塊，沒有歌詞時更大、更置中。 */
const BOX_LYR = { x: X0, y: 170, w: 1480, h: 470 };
const BOX_HERO = { x: X0, y: 200, w: 1560, h: 560 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';

export default class Karaoke extends Scene {
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  bg = shared('karaoke.bg', BG);
  msg: Msg | null = this.ctx.params.message ?? null;
  /** 這個窗格有沒有歌詞：整個窗格用同一種版面（不要唱到一半留言跳位置）。 */
  sung = false;
  fit: FitResult | null = null;
  box = BOX_LYR;
  /** 留言開始寫、寫完的時間。 */
  tW0 = 0; tW1 = 0;

  override async init() {
    const { audio: au, lyrics, start, end } = this.ctx;
    this.sung = lyrics.linesIn(start, end).length > 0;
    const c = this.layer.ctx;
    if (!this.msg) { await loadText(INVITE); return; }
    this.box = this.sung ? BOX_LYR : BOX_HERO;
    this.fit = layoutMessage(c, this.msg.text, F.hand(400), this.box.w, this.box.h - 90, { min: 52, max: this.sung ? 140 : 150, lineHeight: 1.3, maxLines: 5 });
    // 第一個拍點開始寫，一個字約 0.07 秒，最多兩秒半寫完（要留夠時間讀）
    this.tW0 = beatAfter(au, start + 0.1);
    this.tW1 = this.tW0 + Math.min(2.5, 0.07 * msgChars(this.fit) + 0.4);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const fadeIn = prog(t, s, s + 0.4), exit = prog(t, e - 0.4, e, ease.inCubic);
    // 光打在焦點後面：有留言打在留言上，沒有就打在歌詞上；整個窗格慢慢往右飄一點
    const fit = this.fit;
    const fy = fit ? this.box.y + (this.box.h - 90) / 2 : H * 0.52;
    this.bg.u.t!.value = t;
    this.bg.u.k!.value = fadeIn * (1 - 0.5 * exit);
    (this.bg.u.lp!.value as THREE.Vector2).set(lerp(700, 820, f.p), H - fy);
    this.bg.u.li!.value = prog(t, s, s + 1.2, ease.outCubic);
    this.bg.render(renderer, out);
    const L = this.layer; L.clear();
    const c = L.ctx;
    this.glow.clear();
    c.globalAlpha = fadeIn * (1 - exit);
    c.translate(0, -24 * exit);

    let head: { x: number; y: number } | null = null;
    // 沒有留言時歌詞是唯一的東西：唱完的句子多留一會兒（淡淡地等下一句），不要兩句之間突然一片黑
    const ly = lyricAt(lyrics, t, this.msg ? 1.2 : 6);
    if (ly) {
      // 有留言：歌詞是第二層（一行、64 px 起跳，放不下縮到 48 再折兩行）；沒有留言：歌詞大大的在中間
      const hero = !this.msg;
      const st: LyricStyle = hero
        ? { family: F.archivo(87.5, 800), size: 132, minSize: 64, maxWidth: W - 2 * X0 }
        : { family: F.archivo(100, 700), size: 64, minSize: 48, maxWidth: 1560 };
      const lay = layoutLyric(c, ly.line, st);
      // 新的一行從下面彈上來；折兩行時往上長（最後一行的基線固定）
      const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.2));
      const base = (hero ? H * 0.52 + lay.size * 0.36 : LYRIC_Y) + (1 - inK) * (hero ? 50 : 26) - (lay.height - lay.size);
      c.save();
      c.translate(X0, base);
      const h = drawLyric(c, ly.line, t, st, lay, ly.k);
      c.restore();
      if (h) head = { x: X0 + h.x, y: base + h.y - 24 * exit };
    }
    if (this.msg && fit) this.drawMsg(c, t);
    else if (!this.msg) {
      // 沒有留言、這一段又沒有歌詞（整個窗格都沒有，或很長的間奏）：一句邀請慢慢浮出來，歌詞一來就讓位
      const last = lyrics.lastLine(t), next = lyrics.nextLine(t);
      const k = !this.sung ? 1 : ly ? 0 : Math.min(last ? prog(t, last.end + 6, last.end + 7) : 1, next ? 1 - prog(t, next.start - 1.2, next.start - 0.5) : 1);
      if (k > 0) this.drawInvite(c, t, k);
    }
    comp.draw(renderer, L.upload(), out);
    if (head && exit < 0.5) {
      const h = head as { x: number; y: number };
      // 有留言時火花小一點：焦點是留言，火花只是跟唱的筆尖
      sparkParticles(this.glow, t, () => h, { rate: this.msg ? 40 : 60, life: 0.3, speed: this.msg ? 140 : 180 });
      sparkHead(this.glow, h.x, h.y, t, this.msg ? 0.6 : 0.9);
    }
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭整個窗格很慢地推近；大鼓只輕輕推一下
    return { bloom: 0.6, vignette: 0.5, zoom: (1 + 0.03 * ease.inOutQuad(f.p)) * (1 + 0.005 * f.a.kick) };
  }

  /** 主打留言：第一個拍點後一個字一個字浮出來（最新的字還淡淡的），寫完再署名。 */
  private drawMsg(c: CanvasRenderingContext2D, t: number) {
    const m = this.msg!, fit = this.fit!, box = this.box;
    const total = msgChars(fit);
    const chars = total * prog(t, this.tW0, this.tW1);
    // 整塊在框裡垂直置中（留 90 給署名）
    const y0 = box.y + (box.h - 90 - fit.height) / 2 + fit.size;
    // 已經寫好的字：全亮；正在出現的那個字：淡淡浮上來（整數個字用 drawMessage 畫，最後一個字另外畫一層淡的）
    const whole = Math.floor(chars);
    drawMessage(c, fit, F.hand(400), box.x, y0, { chars: whole, color: rgba('bone', 0.96) });
    const frac = chars - whole;
    if (frac > 0 && whole < total) {
      // 下一個字在第幾行、哪個位置：只在它的範圍裡（clip）多畫一個字，淡淡地從下面浮上來
      let left = whole, li = 0;
      while (li < fit.lines.length - 1 && left >= Array.from(fit.lines[li]!).length) { left -= Array.from(fit.lines[li]!).length; li++; }
      const ln = Array.from(fit.lines[li]!);
      c.save();
      c.font = font(F.hand(400), fit.size);
      const x0 = box.x + c.measureText(ln.slice(0, left).join('')).width;
      const x1 = box.x + c.measureText(ln.slice(0, left + 1).join('')).width;
      const y = y0 + li * fit.lineHeight;
      c.beginPath(); c.rect(x0 - 1, y - fit.size * 1.1, x1 - x0 + 2, fit.size * 1.5); c.clip();
      c.globalAlpha *= frac;
      c.translate(0, (1 - frac) * 10);
      drawMessage(c, fit, F.hand(400), box.x, y0, { chars: whole + 1, color: rgba('bone', 0.96) });
      c.restore();
    }
    // 新人的留言：留言上面一個很小的標籤（全畫面唯一的小字）
    if (m.couple) {
      c.save();
      c.globalAlpha *= prog(t, this.tW0 - 0.2, this.tW0 + 0.3);
      c.font = font(F.mono(500), 17);
      c.letterSpacing = '5px';
      c.fillStyle = rgba('signal', 0.85);
      c.fillText('FROM THE COUPLE  ·  新人', box.x, y0 - fit.size - 30);
      c.letterSpacing = '0px';
      c.restore();
    }
    // 署名：寫完之後淡入，靠右對齊在留言的右緣下面（像信的落款）
    const ks = prog(t, this.tW1 + 0.1, this.tW1 + 0.6, ease.outCubic);
    if (ks > 0) {
      c.save();
      c.globalAlpha *= ks;
      c.font = font(F.hand(400), this.sung ? 44 : 50);
      c.fillStyle = rgba('ash', 0.95);
      const sig = signature(m.name);
      const sw = c.measureText(sig).width;
      const sx = Math.max(box.x, box.x + Math.max(fit.width, sw) - sw);
      c.fillText(sig, sx, y0 + fit.height - fit.size + 76 + (1 - ks) * 8);
      c.restore();
    }
  }

  /** 沒有留言也沒有歌詞（純音樂、長間奏的保底）：一句邀請。 */
  private drawInvite(c: CanvasRenderingContext2D, t: number, k = 1) {
    const s = this.ctx.start;
    c.save();
    c.globalAlpha *= prog(t, s + 0.3, s + 1.2, ease.outCubic) * k;
    c.font = font(F.hand(400), 72);
    c.fillStyle = rgba('bone', 0.92);
    c.fillText(INVITE, X0, H * 0.5);
    c.restore();
  }
}
