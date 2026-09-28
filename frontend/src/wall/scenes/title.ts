// 片頭卡：每首歌開頭的「歌名卡」（params.kind = 'song'），和提醒大家掃 QR 的「邀請卡」（'invite'）。
// 照 pdoom 的書擋（open 的 TikZ 紙、outro 的 Regenerate）：只有這裡出現裁切角標，像一張張的圖版封面；
// 底是很淡的製圖格線，仙女棒在第一個小節線把細線畫出來，字在拍點上一個個升起。右邊是大 QR（角落的小 QR 就收掉）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, lerp, prog } from '../engine/util';
import { fitText } from '../engine/text';
import { sparkHead, sparkParticles, drawQR, COUPLE_EN, COUPLE_ZH, DATE_DOTS, lyricAt, drawLyric, layoutLyric, barAfter, beatAfter, signature, layoutMessage, drawMessage } from './_motifs';

const BG = () => new FSPass(/* glsl */ `
  uniform float t; uniform float k;
  void main() {
    vec2 p = FRAG_PX;
    // 很淡的製圖格線：48 px 細格、240 px 粗格
    float g1 = pxLine(min(abs(fract(p.x / 48.0 + 0.5) - 0.5), abs(fract(p.y / 48.0 + 0.5) - 0.5)) * 48.0, 0.3, 1.1);
    float g2 = pxLine(min(abs(fract(p.x / 240.0 + 0.5) - 0.5), abs(fract(p.y / 240.0 + 0.5) - 0.5)) * 240.0, 0.4, 1.3);
    vec3 col = C_INK + C_BONE * (g1 * 0.007 + g2 * 0.016) * k;
    // 一點點紙的起伏
    col += (C_INK2 - C_INK) * (0.5 + 0.5 * fbm(p / 420.0 + t * 0.02, 3));
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 }, k: { value: 1 } });

export default class Title extends Scene {
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(4096, { screen2D: true, blend: 'add' }));
  bg = shared('title.bg', BG);
  kind: 'song' | 'invite' = this.ctx.params.kind === 'invite' ? 'invite' : 'song';
  /** 歌名排版（init 時算好）。 */
  titleFit = { size: 120, lines: [''], lineHeight: 140, width: 0, height: 0 };
  tFirstBar = 0;

  override init() {
    const { audio: au, song } = this.ctx;
    this.tFirstBar = Math.min(barAfter(au, this.ctx.start + 0.05), this.ctx.start + 2);
    const c = this.layer.ctx;
    if (this.kind === 'song') this.titleFit = fitText(c, song.title || '今晚的歌', F.archivo(100, 900), 1080, 330, { min: 56, max: 170, lineHeight: 1.05, maxLines: 2 });
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    this.bg.u.t!.value = t;
    this.bg.u.k!.value = prog(t, s, s + 0.6);
    this.bg.render(renderer, out);
    const L = this.layer; L.clear();
    const c = L.ctx;
    this.glow.clear();
    // 退場：最後半拍整張往上收、淡掉
    const beat = au.beatPeriod(t);
    const exit = prog(t, e - beat * 0.9, e, ease.inCubic);
    c.save();
    c.globalAlpha = 1 - exit;
    c.translate(0, -60 * exit);
    const head = this.kind === 'song' ? this.drawSong(c, t, beat) : this.drawInvite(c, t, beat);
    // 片頭卡期間如果已經開始唱：歌詞放在左下，照跟唱規則
    const ly = lyricAt(lyrics, t);
    if (ly) {
      // 歌名卡放左下（上面是大大的歌名）；邀請卡的左下是範例留言，歌詞改放最上面
      const st = { family: F.archivo(100, 700), size: this.kind === 'song' ? 54 : 46, minSize: 34, maxWidth: 1000, align: 'left' as const };
      c.save(); c.translate(this.kind === 'song' ? 160 : 150, this.kind === 'song' ? H - 150 : 128);
      drawLyric(c, ly.line, t, st, layoutLyric(c, ly.line, st), ly.k);
      c.restore();
    }
    c.restore();
    comp.draw(renderer, L.upload(), out);
    if (head && exit < 0.5) {
      sparkParticles(this.glow, t, () => head, { rate: 80, life: 0.35, speed: 200, seed: 7 });
      sparkHead(this.glow, head.x, head.y, t, 1, 1 - exit * 2);
    }
    if (this.glow.count) this.glow.render(renderer, out);
    // 角標：第一拍飛進來、最後一拍飛出去
    const frame = Math.min(prog(t, s, s + beat, ease.outCubic), 1 - exit);
    const avoid: [number, number, number, number][] = this.kind === 'song' ? [[140, 200, 1100, 560], [1380, 280, 420, 600], [140, H - 210, 1100, 140]] : [[130, 90, 1000, 860], [1170, 170, 620, 780]];
    return { frame, qr: 0, popups: 0.85, bloom: 0.65, vignette: 0.45, popupAvoid: avoid };
  }

  /** 歌名卡。回傳仙女棒筆尖（畫線中），沒在畫是 null。 */
  private drawSong(c: CanvasRenderingContext2D, t: number, beat: number): { x: number; y: number } | null {
    const { song, audio: au, live } = this.ctx;
    const s = this.ctx.start, b0 = this.tFirstBar;
    const X = 160;
    c.textBaseline = 'alphabetic';
    // 眉標：mono 打字出來
    const eyebrow = `NO.${String(song.index).padStart(2, '0')} / ${String(song.count).padStart(2, '0')}  ·  NOW PLAYING`;
    const n = Math.floor(eyebrow.length * prog(t, s + 0.05, s + 0.6));
    c.font = font(F.mono(500), 20);
    c.letterSpacing = '5px';
    c.fillStyle = rgba('signal');
    c.fillText(eyebrow.slice(0, n), X, 262);
    c.letterSpacing = '0px';
    // 歌名：每個字從下面升起，一拍一拍錯開（太長就壓在兩拍內）
    const fit = this.titleFit;
    c.font = font(F.archivo(100, 900), fit.size);
    const all = fit.lines.join('');
    const total = Array.from(all).length;
    const stagger = Math.min(beat / 4, (beat * 2) / Math.max(1, total));
    let k = 0;
    const y0 = 262 + 40 + fit.size;
    fit.lines.forEach((ln, li) => {
      const chars = Array.from(ln);
      let x = X;
      for (const ch of chars) {
        const tk = b0 + k * stagger;
        const r = prog(t, tk - 0.02, tk + 0.35, ease.outExpo);
        const w = c.measureText(ch).width;
        if (r > 0) {
          c.save();
          c.beginPath(); c.rect(x - 4, y0 + li * fit.lineHeight - fit.size * 1.05, w + 8, fit.size * 1.3); c.clip();
          c.fillStyle = rgba('bone', 0.97);
          c.fillText(ch, x, y0 + li * fit.lineHeight + (1 - r) * fit.size * 0.9);
          c.restore();
        }
        x += w;
        k++;
      }
    });
    const yRule = y0 + (fit.lines.length - 1) * fit.lineHeight + 58;
    // 細線：仙女棒在第一個小節線後畫出來，大鼓一打就粗一點
    const tr0 = b0 + beat, tr1 = tr0 + beat * 1.5;
    const pr = prog(t, tr0, tr1, ease.inOutCubic);
    const len = 1000 * pr;
    let head: { x: number; y: number } | null = null;
    if (pr > 0) {
      c.fillStyle = rgba('bone', 0.5);
      c.fillRect(X, yRule, len, 1.2 + 1.5 * au.hit('kick', t, 0.12));
      if (pr < 1) head = { x: X + len, y: yRule };
    }
    // 歌手：典雅的斜體，第三拍淡入
    const ka = prog(t, b0 + beat * 2, b0 + beat * 3, ease.outCubic);
    if (ka > 0 && song.artist) {
      c.save();
      c.globalAlpha *= ka;
      c.font = font(F.serif(400, true), 58);
      c.fillStyle = rgba('bone', 0.82);
      c.fillText(song.artist, X, yRule + 78);
      c.restore();
    }
    // 底部：新人與日期（mono，像圖版的出版資訊）
    c.font = font(F.mono(400), 17);
    c.letterSpacing = '3px';
    c.fillStyle = rgba('ash', 0.85 * prog(t, s + 0.3, s + 1));
    c.fillText(`${COUPLE_EN.toUpperCase()}  ·  ${COUPLE_ZH}  ·  ${DATE_DOTS}`, X, H - 96);
    c.letterSpacing = '0px';
    this.qrPanel(c, t, 1400, 300, 360, b0, beat, live.count > 0 ? `已收到 ${live.count} 則祝福` : '第一則祝福等你來寫');
    return head;
  }

  /** 邀請卡：大字＋大 QR；有留言的話在下面放一則當範例。 */
  private drawInvite(c: CanvasRenderingContext2D, t: number, beat: number): { x: number; y: number } | null {
    const { live, params } = this.ctx;
    const b0 = this.tFirstBar, X = 150;
    c.textBaseline = 'alphabetic';
    const lines = [['掃描 QR code', 'bone'], ['把祝福寫上', 'bone'], ['大螢幕', 'signal']] as const;
    lines.forEach(([txt, col], i) => {
      const tk = b0 + i * beat * 0.5;
      const r = prog(t, tk - 0.02, tk + 0.4, ease.outExpo);
      if (r <= 0) return;
      c.save();
      c.font = font(F.hei(900), 112);
      const y = 262 + i * 136;
      c.beginPath(); c.rect(X - 10, y - 130, 1000, 158); c.clip();
      c.fillStyle = rgba(col, 0.97);
      c.fillText(txt, X, y + (1 - r) * 120);
      c.restore();
    });
    const ka = prog(t, b0 + beat * 2, b0 + beat * 3, ease.outCubic);
    c.save();
    c.globalAlpha *= ka;
    c.font = font(F.hand(400), 40);
    c.fillStyle = rgba('bone', 0.8);
    c.fillText(`寫下想對${COUPLE_ZH.replace(' & ', '和')}說的話，幾秒後就會出現在這裡。`, X, 640);
    c.font = font(F.mono(500), 18);
    c.letterSpacing = '3px';
    c.fillStyle = rgba('signal');
    c.fillText(live.count > 0 ? `已收到 ${String(live.count).padStart(3, '0')} 則祝福` : '第一則祝福，等你來寫', X, 690);
    c.letterSpacing = '0px';
    // 範例留言：「剛剛有人寫」
    const m = params.message as { text: string; name: string } | undefined;
    if (m) {
      // 範例留言放在左下：標籤、最多兩行的留言、署名（到 y≈930 為止，不碰右下的 QR 說明）
      const fit = layoutMessage(c, `「${m.text}」`, F.hand(400), 940, 100, { max: 40, min: 26, maxLines: 2 });
      c.font = font(F.mono(400), 16); c.letterSpacing = '2px'; c.fillStyle = rgba('ash', 0.8);
      c.fillText('剛剛有人寫：', X, 760); c.letterSpacing = '0px';
      drawMessage(c, fit, F.hand(400), X, 760 + 18 + fit.size, { color: rgba('bone', 0.85) });
      c.font = font(F.hand(400), 28); c.fillStyle = rgba('ash');
      c.fillText(signature(m.name), X, 760 + 18 + fit.height + 46);
    }
    c.restore();
    return this.qrPanel(c, t, 1200, 200, 560, b0, beat, '');
  }

  /** 右邊的 QR：模組由左上往右下長出來，仙女棒沿外框跑一圈。回傳筆尖。 */
  private qrPanel(c: CanvasRenderingContext2D, t: number, x: number, y: number, size: number, b0: number, beat: number, note: string): { x: number; y: number } | null {
    const { live } = this.ctx;
    const rv = prog(t, b0, b0 + beat * 2, ease.inOutCubic);
    if (rv <= 0) return null;
    drawQR(c, live.url, x, y, size, { ink: rgba('ink'), paper: rgba('bone', 0.96), reveal: rv, radius: 10 });
    // 外框：隔 14 px 的細框，仙女棒畫出來
    const m = 14, x0 = x - m, y0 = y - m, w = size + 2 * m;
    const per = 4 * w, pr = prog(t, b0 + beat * 0.5, b0 + beat * 2.5, ease.inOutCubic), len = per * pr;
    const pts = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + w], [x0, y0 + w], [x0, y0]];
    c.strokeStyle = rgba('bone', 0.45); c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(x0, y0);
    let acc = 0, head: { x: number; y: number } | null = null;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1]!, [bx, by] = pts[i]!;
      if (acc + w <= len) { c.lineTo(bx!, by!); acc += w; continue; }
      const u = clamp((len - acc) / w);
      head = { x: lerp(ax!, bx!, u), y: lerp(ay!, by!, u) };
      c.lineTo(head.x, head.y);
      break;
    }
    c.stroke();
    const ka = prog(t, b0 + beat * 1.5, b0 + beat * 2.5);
    c.save();
    c.globalAlpha *= ka;
    c.textAlign = 'center';
    c.font = font(F.hei(700), size > 400 ? 40 : 32);
    c.fillStyle = rgba('bone', 0.95);
    c.fillText('掃描留言', x + size / 2, y + w + 56);
    c.font = font(F.mono(500), size > 400 ? 22 : 18);
    c.fillStyle = rgba('ash');
    c.fillText(live.shortUrl, x + size / 2, y + w + 92);
    if (note) { c.font = font(F.mono(500), 16); c.letterSpacing = '2px'; c.fillStyle = rgba('signal'); c.fillText(note, x + size / 2, y + w + 124); c.letterSpacing = '0px'; }
    c.restore();
    return pr > 0 && pr < 1 ? head : null;
  }
}
