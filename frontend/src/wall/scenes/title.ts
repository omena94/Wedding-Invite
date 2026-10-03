// 片頭卡：每首歌開頭的「歌名卡」（params.kind = 'song'），和提醒大家掃 QR 的「邀請卡」（'invite'）。
// 照 pdoom 的書擋（open 的 TikZ 紙、outro 的 Regenerate）：只有這裡出現裁切角標，像一張張的圖版封面。
// 照「MV 融合原則」：片頭卡是電影的片名卡，不是介面——
//  - 歌名卡只有一個焦點：歌名（大、靠左、一個字一個字在拍點上升起），下面一條仙女棒畫的細線與歌手（典雅斜體）；
//    小字只剩最上面一列（左：第幾首，右：新人與日期）。角落的小 QR 照常由引擎畫，歌名卡不再自己放一個大 QR 搶焦點。
//  - 邀請卡的焦點是大 QR：像一張放在光裡的紙卡（紙色底、陰影），仙女棒沿著外框畫一圈；左邊兩行大字告訴大家要做什麼。
//  - 背景是很淡的製圖格線＋一團慢慢飄的柔光（有空氣、不是死黑），整個窗格鏡頭很慢地推近。
//  - 新人的名字、日期是每一場不一樣的執行時資料（../wedding.ts）：名字可能很長、可能還沒定日期，
//    所以右上那列與邀請卡的說明都在 init 量好字級（太長就縮、說明太長就折兩行），沒日期就連分隔點一起省掉。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, measure } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, lerp, prog } from '../engine/util';
import { fitText } from '../engine/text';
import { sparkHead, sparkParticles, drawQR, COUPLE_EN, NAME_A, NAME_B, DATE_DOTS, joinBits, fitPx, lyricAt, drawLyric, layoutLyric, barAfter } from './_motifs';

const BG = () => new FSPass(/* glsl */ `
  uniform float t; uniform float k; uniform vec2 lp; uniform float li;
  void main() {
    vec2 p = FRAG_PX;
    // 很淡的製圖格線：48 px 細格、240 px 粗格，只在柔光裡看得到一點（離光越遠越淡）
    float g1 = pxLine(min(abs(fract(p.x / 48.0 + 0.5) - 0.5), abs(fract(p.y / 48.0 + 0.5) - 0.5)) * 48.0, 0.3, 1.1);
    float g2 = pxLine(min(abs(fract(p.x / 240.0 + 0.5) - 0.5), abs(fract(p.y / 240.0 + 0.5) - 0.5)) * 240.0, 0.4, 1.3);
    // 柔光：像打在字後面的一盞燈（lp 是 y 向上的像素座標），讓底色有空氣、字後面比較亮一點點
    vec2 d = (p - lp) / vec2(1150.0, 720.0);
    float light = exp(-dot(d, d) * 1.6) * li;
    vec3 col = C_INK + (C_INK2 - C_INK) * (0.35 + 0.4 * fbm(p / 520.0 + vec2(t * 0.012, -t * 0.006), 3));
    col += (C_INK2 - C_INK) * 1.6 * light + C_SIGNAL * 0.006 * light;
    col += C_BONE * (g1 * 0.0022 + g2 * 0.0055) * k * (0.2 + 0.8 * light);
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 }, k: { value: 1 }, lp: { value: new THREE.Vector2(700, 560) }, li: { value: 1 } });

/** 左邊界：離邊 160（規定 96，投影機裁邊再多留）。 */
const X = 160;
/** 最上面那列小字的基線。 */
const TOP_Y = 150;
/** 邀請卡的大 QR（右邊、比左邊的大字還搶眼：它才是要大家做的事）。 */
const QR = { x: 1176, y: 196, size: 548 };
/** 右上那列小字（新人與日期）：mono 17 px、字距 5 px；名字太長時縮字（不能跟左邊那列撞在一起）。 */
const CREDIT = { size: 17, tracking: 5 };
/** 邀請卡說明那句（手寫 34 px）：左邊界到 QR 外框之前；縮到 28 px 還放不下就在逗號後折成兩行。 */
const NOTE = { size: 34, min: 28, maxW: QR.x - 16 - 40 - X };

export default class Title extends Scene {
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(4096, { screen2D: true, blend: 'add' }));
  bg = shared('title.bg', BG);
  kind: 'song' | 'invite' = this.ctx.params.kind === 'invite' ? 'invite' : 'song';
  /** 歌名排版與整塊（歌名＋細線＋歌手）的第一行基線（init 時算好）。 */
  titleFit = { size: 120, lines: [''], lineHeight: 140, width: 0, height: 0 };
  titleY = 400;
  tFirstBar = 0;
  /** 右上「新人 · 日期」：字串與字級（沒日期就只有名字，不留多餘的分隔點）。 */
  credit = joinBits('  ·  ', COUPLE_EN.toUpperCase(), DATE_DOTS);
  creditSize = CREDIT.size;
  /** 邀請卡的說明：一行或兩行（名字很長時）與字級。 */
  note: string[] = [];
  noteSize = NOTE.size;

  override init() {
    const { audio: au, song } = this.ctx;
    this.tFirstBar = Math.min(barAfter(au, this.ctx.start + 0.05), this.ctx.start + 2);
    const c = this.layer.ctx;
    if (this.kind === 'song') {
      const fit = (this.titleFit = fitText(c, song.title || '今晚的歌', F.archivo(100, 900), 1480, 380, { min: 64, max: 210, lineHeight: 1.02, maxLines: 2 }));
      // 歌名＋細線＋歌手這一整塊放在畫面偏上的中線（下面留給歌詞）：字面頂約 0.75 em、細線在最後一行下 58、歌手再下 78
      const block = fit.size * 0.75 + (fit.lines.length - 1) * fit.lineHeight + 58 + (song.artist ? 96 : 0);
      this.titleY = Math.max(TOP_Y + 110 + fit.size * 0.75, 490 - block / 2 + fit.size * 0.75);
      // 右上的新人與日期：從畫面右邊界往左，最多到左邊那列「NO.xx / xx · NOW PLAYING」之後留 60 px
      const eyebrowW = measure(this.eyebrow(), F.mono(500), CREDIT.size, CREDIT.tracking);
      this.creditSize = fitPx(this.credit, F.mono(500), CREDIT.size, W - 2 * X - eyebrowW - 60, CREDIT.tracking);
    } else {
      // 說明那句用兩個名字組（不要拆 COUPLE_ZH 的「&」：新人可能填了別的寫法）
      const one = `寫下想對${NAME_A}和${NAME_B}說的話，幾秒後就會出現在這裡。`;
      const size = fitPx(one, F.hand(400), NOTE.size, NOTE.maxW);
      if (size >= NOTE.min) { this.note = [one]; this.noteSize = size; }
      else {
        this.note = [`寫下想對${NAME_A}和${NAME_B}說的話，`, '幾秒後就會出現在這裡。'];
        this.noteSize = Math.max(18, fitPx(this.note[0]!, F.hand(400), NOTE.size, NOTE.maxW));
      }
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const beat = au.beatPeriod(t);
    const exit = prog(t, e - beat * 0.9, e, ease.inCubic);
    // 柔光：歌名卡在歌名後面（左邊）、邀請卡在 QR 後面，整個窗格很慢地往右飄一點
    this.bg.u.t!.value = t;
    this.bg.u.k!.value = prog(t, s, s + 0.6);
    const lx = this.kind === 'song' ? lerp(620, 760, f.p) : lerp(QR.x + QR.size / 2 - 60, QR.x + QR.size / 2 + 40, f.p);
    (this.bg.u.lp!.value as THREE.Vector2).set(lx, H - (this.kind === 'song' ? this.titleY - 60 : QR.y + QR.size / 2));
    this.bg.u.li!.value = prog(t, s, s + 1.2, ease.outCubic) * (1 - 0.6 * exit);
    this.bg.render(renderer, out);
    const L = this.layer; L.clear();
    const c = L.ctx;
    this.glow.clear();
    // 退場：最後將近一拍整張往上收、淡掉
    c.save();
    c.globalAlpha = 1 - exit;
    c.translate(0, -60 * exit);
    const head = this.kind === 'song' ? this.drawSong(c, t, beat) : this.drawInvite(c, t, beat);
    // 片頭卡期間如果已經開始唱：歌詞照跟唱規則，歌名卡放左下、邀請卡放最上面（第二層：比歌名、比 QR 小一級）
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const song = this.kind === 'song';
      const st = { family: F.archivo(100, 700), size: song ? 58 : 52, minSize: 48, maxWidth: song ? 1150 : 980, align: 'left' as const };
      const lay = layoutLyric(c, ly.line, st);
      // 折成兩行時往上長（最後一行的基線固定），不要掉進下緣的安全邊
      c.save(); c.translate(X, song ? H - 158 - (lay.height - lay.size) : TOP_Y);
      drawLyric(c, ly.line, t, st, lay, ly.k);
      c.restore();
    }
    c.restore();
    comp.draw(renderer, L.upload(), out);
    if (head && exit < 0.5) {
      sparkParticles(this.glow, t, () => head, { rate: 80, life: 0.35, speed: 200, seed: 7 });
      sparkHead(this.glow, head.x, head.y, t, 1, 1 - exit * 2);
    }
    if (this.glow.count) this.glow.render(renderer, out);
    // 角標：第一拍飛進來、最後一拍飛出去。鏡頭整個窗格慢慢推近（後製的 zoom 不影響角標與角落 QR）
    const frame = Math.min(prog(t, s, s + beat, ease.outCubic), 1 - exit);
    return { frame, qr: this.kind === 'invite' ? 0 : 1, bloom: 0.6, vignette: 0.5, zoom: 1 + 0.028 * ease.inOutQuad(f.p) };
  }

  /** 左上那列小字：第幾首。 */
  private eyebrow() {
    const { song } = this.ctx;
    return `NO.${String(song.index).padStart(2, '0')} / ${String(song.count).padStart(2, '0')}  ·  NOW PLAYING`;
  }

  /** 歌名卡。回傳仙女棒筆尖（畫線中），沒在畫是 null。 */
  private drawSong(c: CanvasRenderingContext2D, t: number, beat: number): { x: number; y: number } | null {
    const { song, audio: au } = this.ctx;
    const s = this.ctx.start, b0 = this.tFirstBar;
    c.textBaseline = 'alphabetic';
    // 最上面一列小字：左邊第幾首（mono 打字出來），右邊新人與日期（像圖版的出版資訊）
    const eyebrow = this.eyebrow();
    const n = Math.floor(eyebrow.length * prog(t, s + 0.05, s + 0.6));
    c.font = font(F.mono(500), 17);
    c.letterSpacing = '5px';
    c.fillStyle = rgba('ash', 0.75);
    c.fillText(eyebrow.slice(0, n), X, TOP_Y);
    c.textAlign = 'right';
    c.fillStyle = rgba('ash', 0.55 * prog(t, s + 0.3, s + 1));
    // 字級照名字長短縮過（init），字距跟著等比例縮；canvas 的字距也加在最後一個字後面，右對齊時往右補回來
    const tr = (CREDIT.tracking * this.creditSize) / CREDIT.size;
    c.font = font(F.mono(500), this.creditSize);
    c.letterSpacing = `${tr}px`;
    c.fillText(this.credit, W - X + tr, TOP_Y);
    c.textAlign = 'left';
    c.letterSpacing = '0px';
    // 歌名：每個字從下面升起，一拍一拍錯開（太長就壓在兩拍內）
    const fit = this.titleFit;
    c.font = font(F.archivo(100, 900), fit.size);
    const total = Array.from(fit.lines.join('')).length;
    const stagger = Math.min(beat / 4, (beat * 2) / Math.max(1, total));
    let k = 0;
    const y0 = this.titleY;
    fit.lines.forEach((ln, li) => {
      let x = X;
      for (const ch of Array.from(ln)) {
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
    // 細線：仙女棒在第一個小節線後畫出來，大鼓一打就粗一點；長度跟著歌名（至少 640）
    const tr0 = b0 + beat, tr1 = tr0 + beat * 1.5;
    const pr = prog(t, tr0, tr1, ease.inOutCubic);
    const len = Math.max(640, Math.min(fit.width, 1480)) * pr;
    let head: { x: number; y: number } | null = null;
    if (pr > 0) {
      c.fillStyle = rgba('bone', 0.42);
      c.fillRect(X, yRule, len, 1.2 + 1.5 * au.hit('kick', t, 0.12));
      if (pr < 1) head = { x: X + len, y: yRule };
    }
    // 歌手：典雅的斜體，第三拍淡入
    const ka = prog(t, b0 + beat * 2, b0 + beat * 3, ease.outCubic);
    if (ka > 0 && song.artist) {
      c.save();
      c.globalAlpha *= ka;
      c.font = font(F.serif(400, true), 62);
      c.fillStyle = rgba('bone', 0.8);
      c.fillText(song.artist, X, yRule + 84 + (1 - ka) * 10);
      c.restore();
    }
    return head;
  }

  /** 邀請卡：左邊兩行大字＋一句說明，右邊是大 QR（焦點）。 */
  private drawInvite(c: CanvasRenderingContext2D, t: number, beat: number): { x: number; y: number } | null {
    const { live } = this.ctx;
    const b0 = this.tFirstBar;
    c.textBaseline = 'alphabetic';
    // 兩行大字：半拍一行從下面升起（「大螢幕」三個字用訊號色）
    const rows: [string, string][][] = [[['掃描 QR code', 'bone']], [['把祝福寫上', 'bone'], ['大螢幕', 'signal']]];
    rows.forEach((parts, i) => {
      const tk = b0 + i * beat * 0.5;
      const r = prog(t, tk - 0.02, tk + 0.4, ease.outExpo);
      if (r <= 0) return;
      c.save();
      c.font = font(F.hei(900), 100);
      const y = 420 + i * 128;
      c.beginPath(); c.rect(X - 10, y - 118, 1000, 146); c.clip();
      let x = X;
      for (const [txt, col] of parts) {
        c.fillStyle = rgba(col as 'bone' | 'signal', 0.97);
        c.fillText(txt, x, y + (1 - r) * 112);
        x += c.measureText(txt).width;
      }
      c.restore();
    });
    // 一句說明（手寫、淡一點）與留言數（mono 小字）：第三拍淡入
    const ka = prog(t, b0 + beat * 2, b0 + beat * 3, ease.outCubic);
    c.save();
    c.globalAlpha *= ka;
    c.font = font(F.hand(400), this.noteSize);
    c.fillStyle = rgba('bone', 0.7);
    // 名字很長時說明折成兩行，留言數那行跟著往下讓
    this.note.forEach((ln, i) => c.fillText(ln, X, 660 + i * this.noteSize * 1.3));
    const dy = (this.note.length - 1) * this.noteSize * 1.3;
    c.font = font(F.mono(500), 18);
    c.letterSpacing = '4px';
    c.fillStyle = rgba('signal', 0.85);
    c.fillText(live.count > 0 ? `已收到 ${String(live.count).padStart(3, '0')} 則祝福` : '第一則祝福，等你來寫', X, 712 + dy);
    c.letterSpacing = '0px';
    c.restore();
    return this.qrCard(c, t, b0, beat);
  }

  /**
   * 右邊的大 QR：像一張放在光裡的紙卡（紙色底、軟陰影），模組由左上往右下長出來，
   * 仙女棒沿著外面一圈細框跑一圈；下面一行短網址（手機掃不到的人用）。回傳筆尖。
   */
  private qrCard(c: CanvasRenderingContext2D, t: number, b0: number, beat: number): { x: number; y: number } | null {
    const { live } = this.ctx;
    const { x, y, size } = QR;
    const rv = prog(t, b0, b0 + beat * 2, ease.inOutCubic);
    if (rv <= 0) return null;
    // 紙卡：先淡入、有陰影（跟著卡片一起出現，不是先有一塊黑影）
    const cardA = prog(t, b0, b0 + beat * 0.6, ease.outCubic);
    c.save();
    c.globalAlpha *= cardA;
    c.shadowColor = rgba('ink', 0.85);
    c.shadowBlur = 48;
    c.shadowOffsetY = 20;
    c.fillStyle = rgba('bone', 0.96);
    c.beginPath(); c.roundRect(x, y, size, size, 12); c.fill();
    c.restore();
    drawQR(c, live.url, x, y, size, { ink: rgba('ink'), paper: rgba('bone', 0.96), reveal: rv, radius: 12 });
    // 外框：隔 16 px 的細框，仙女棒畫出來
    const m = 16, x0 = x - m, y0 = y - m, w = size + 2 * m;
    const per = 4 * w, pr = prog(t, b0 + beat * 0.5, b0 + beat * 2.5, ease.inOutCubic), len = per * pr;
    const pts = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + w], [x0, y0 + w], [x0, y0]];
    c.strokeStyle = rgba('bone', 0.4); c.lineWidth = 1.2;
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
    c.font = font(F.mono(500), 21);
    c.letterSpacing = '2px';
    c.fillStyle = rgba('ash', 0.85);
    c.fillText(live.shortUrl, x + size / 2, y + size + m + 46);
    c.letterSpacing = '0px';
    c.restore();
    return pr > 0 && pr < 1 ? head : null;
  }
}
