// 單字卡（亮，雙語版面）：俯看一張淺色的切割墊，上面攤著一疊用兩個鐵環串起來的單字卡，像一本打開的小書：
//  - 右邊是還沒翻的那一疊，最上面一張的正面是「題目」：下一句歌詞的原文（沒翻譯的歌是一個大問號）。
//  - 每一句開唱前 0.3 秒，那張卡繞著鐵環翻到左邊（翻起來的卡越立越窄、影子拉長，落下時鐵環晃一下），
//    露出背面的「答案」：中文大字（思源黑體），原文小一號在正下方，兩行各照自己的逐字時間亮。
//    翻過去的卡一張張疊在左邊（疊得越來越厚），右邊的疊越來越薄；一句唱完，背面右上角被紅筆打一個勾，「已背熟」加一。
//  - 主打留言寫在下面一張比較大的索引卡上（紅色的頂線、淺淺的橫線、手寫字），它是「最重要的一張」。
//  - 沒有主打留言：索引卡是空白卡加一行邀請。純音樂：每兩小節翻一張冷面小考題（這首歌叫什麼？→ 歌名、今天誰結婚？→ 新人……）。
// 畫法：切割墊（格線、刻度、斜線、窗光）是一個 shader，畫一次存起來；索引卡的底畫一次在一張 Canvas2D；
// 卡片、鐵環、留言、歌詞每格畫在另一張；翻動中的卡用畫一次就好的正反面小畫布縮放貼上。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, makeRT } from '../engine/gl';
import { F, font, layout, loadText, measure } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, TAU } from '../engine/util';
import type { FitResult } from '../engine/text';
import { lyricSubOf, type Line } from '../engine/lyrics';
import { layoutLyric, drawLyric, drawLyricSub, beatAfter, barAfter, subGap, subSizeFor, COUPLE_ZH, type LyricStyle } from './_motifs';
import { lyricV2, sigV2, msgMaxFor, V2 } from './_v2';
import { fitMsgB2, sigOf, windowLines, linesText, inkSignal, PAPER_SING, mainOnly, lastRowY, INVITE, B2_SYMBOLS, no3, offCanvas, type Rect } from './_b2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'print', paper: true, energy: [0.25, 0.9], bars: [4, 8] };

/** 鐵環的軸（x）、卡片與軸的間隙、卡片大小、卡片上緣。 */
const AX = 980, GAP = 22, CW = 690, CH = 410, CY = 138;
const RIGHT_X = AX + GAP, LEFT_X = AX - GAP - CW;
/** 兩個鐵環的高度。 */
const RINGS = [CY + 96, CY + CH - 96];
/** 卡片裡字的左右邊距、可用寬度。 */
const PAD = 48, TW = CW - PAD * 2 - 20;
/** 翻一張卡要多久（開唱前開始翻，開唱那一刻落定）。 */
const FLIP = 0.32;
/** 下面那張大索引卡：左下角固定，大小跟著留言。 */
const IDX = { x: 176, bottom: 1004, textW: 740, textH: 250, padX: 46, head: 64, padB: 34 };
const MSG_FAM = F.hand(700);
const SIG_FAM = F.hand(400);
const ZH_FAM = F.hei(700);
const SUB_FAM = F.hei(500);
const NO_MSG = '這張卡還空著：掃描右下角 QR code，寫一張給新人。';
/** 純音樂：沒有歌詞可以背，就用一組冷面的小考題，每兩小節翻一張（答案 null＝歌名／歌手、couple＝新人）。 */
const QUIZ: [string, string | null][] = [['這首歌叫什麼？', null], ['今天誰結婚？', 'couple'], ['祝福要寫在哪裡？', '右下角的 QR code'], ['要愛多久？', '一直一直']];

const FRAG = /* glsl */ `
uniform float uIn;
void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  // 切割墊：比紙暗一點的淺色（亮版面：右下角 HUD 的深色字才讀得清楚），帶一點這首歌的色調
  vec3 mat = mix(C_PAPER, mix(C_ASH, C_BLOOD, 0.15), 0.16) * (0.985 + 0.02 * fbm(p / 300.0, 2));
  // 窗光：從右上方斜斜照進來的一大片柔光
  float win = smoothstep(-500.0, 900.0, (p.x - p.y * 0.6) - 400.0);
  mat *= 0.93 + 0.1 * win;
  // 格線：30 px 細線、150 px 粗一點；45° 的斜線（切割角度的參考線）很淡
  vec2 gq = abs(fract((p - vec2(60.0, 30.0)) / 30.0) - 0.5) * 30.0;
  vec2 gQ = abs(fract((p - vec2(60.0, 30.0)) / 150.0) - 0.5) * 150.0;
  float grid = max(pxLine(min(gq.x, gq.y), 0.4, 1.0) * 0.07, pxLine(min(gQ.x, gQ.y), 0.7, 1.4) * 0.14);
  float diag = pxLine(abs(fract((p.x + p.y) / 420.0) - 0.5) * 420.0, 0.5, 1.1) * 0.05;
  // 右下角 HUD 那一塊格線淡一點
  float hud = smoothstep(1300.0, 1400.0, p.x) * smoothstep(780.0, 860.0, p.y);
  mat = mix(mat, C_SEPIA, (grid + diag) * (1.0 - 0.7 * hud));
  // 上緣的刻度尺（公分刻度，每 5 格長一點）
  float tick = p.y < 34.0 ? pxLine(abs(fract((p.x - 60.0) / 15.0) - 0.5) * 15.0, 0.4, 1.0) * step(p.y, mod(floor((p.x - 60.0) / 15.0 + 0.5), 5.0) < 0.5 ? 26.0 : 14.0) : 0.0;
  mat = mix(mat, C_SEPIA, tick * 0.35);
  fragColor = vec4(mat * uIn, 1.0);
}`;
const BG = () => new FSPass(FRAG, { uIn: { value: 1 } });

/** 一張卡的內容：題目（原文或問號）與答案（中文＋原文），或封面／結尾卡。 */
type Card = { kind: 'line'; line: Line } | { kind: 'inst'; j: number } | { kind: 'cover' } | { kind: 'end' };

export default class Flashcards extends Scene {
  bg = shared('flashcards.bg', BG);
  bgRT = this.track(makeRT(W, H, { depthBuffer: false }));
  bgReady = false;
  /** 印好的：切割墊的刻度數字、索引卡的底。 */
  base = this.track(new Layer2D(W, H, undefined, { fast: true }));
  live = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  b0 = 0;
  beat = 0.5;
  fit: FitResult | null = null;
  /** 索引卡的位置（依留言大小）。 */
  idx = { x: 0, y: 0, w: 0, h: 0 };
  glyphs: { ch: string; x: number; y: number; t: number }[] = [];
  sig: { text: string; x: number; y: number; size: number; t: number } | null = null;
  lyrSize = 52;
  st!: LyricStyle;
  /** 每一句（line.i）翻好的卡的正反面（還沒唱的樣子），翻動時縮放貼上。 */
  faces = new Map<string, { front: HTMLCanvasElement; back: HTMLCanvasElement }>();
  shadow!: HTMLCanvasElement;
  /** 純音樂：每張小考題翻過去的時間（第一拍後一拍半，之後每兩小節一張）。 */
  instTs: number[] = [];
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.b0 = beatAfter(au, s + 0.05);
    this.beat = clamp(au.beatPeriod(this.b0), 0.25, 1.2);
    const lines = windowLines(lyrics, s - 4, e + 4);
    const text = m ? m.text : NO_MSG;
    const sigText = m ? sigOf(m) : '';
    await loadText(text + sigText + NO_MSG + INVITE + QUIZ.flat().join('') + COUPLE_ZH + song.title + song.artist + linesText(lines)
      + '單字卡婚禮用語已背熟共張翻面必背★背完了全部答對題目答案Vol.QA↻' + B2_SYMBOLS);

    // ---- 索引卡上的留言（大小跟著字：只比字多一點邊距）
    const c = this.live.ctx;
    const reserve = m ? sigV2(msgMaxFor(text)) + 20 : 0;
    this.fit = fitMsgB2(c, text, MSG_FAM, IDX.textW, IDX.textH - reserve, { lineHeight: 1.34, maxLines: 5, max: m ? undefined : 32, min: m ? undefined : 28 });
    const fit = this.fit;
    this.lyrSize = lyricV2(m ? fit.size : null);
    const w = Math.max(560, Math.min(IDX.textW, Math.max(fit.width, m ? measure(sigText, SIG_FAM, sigV2(fit.size)) : 0)) + IDX.padX * 2);
    const h = IDX.head + fit.height + (m ? fit.size * 0.34 + sigV2(fit.size) * 1.2 : 0) + IDX.padB + 14;
    this.idx = { x: IDX.x, y: IDX.bottom - h, w, h };
    const top = this.idx.y + IDX.head + fit.size * 0.9;
    const n = fit.lines.reduce((a, l) => a + Array.from(l).length, 0);
    const t0 = this.b0 + 0.12;
    const dur = clamp(0.055 * n + 0.3, 0.6, Math.min(this.beat * 6, 0.3 * (e - s)));
    let k = 0;
    fit.lines.forEach((ln, i) => {
      const lay = layout(ln, MSG_FAM, fit.size);
      for (const g of lay.glyphs) this.glyphs.push({ ch: g.ch, x: IDX.x + IDX.padX + g.x, y: top + i * fit.lineHeight, t: t0 + (dur * k++) / Math.max(1, n) });
    });
    if (m) {
      const ss = sigV2(fit.size), sw = measure(sigText, SIG_FAM, ss);
      const lastY = top + (fit.lines.length - 1) * fit.lineHeight;
      this.sig = { text: sigText, x: this.idx.x + w - IDX.padX - sw, y: lastY + fit.size * 0.34 + ss * 1.1, size: ss, t: t0 + dur + 0.15 };
    }

    this.st = { family: ZH_FAM, size: this.lyrSize, minSize: V2.lyrMin, maxWidth: TW, align: 'left', lineHeight: 1.2, ...PAPER_SING() };
    for (const l of lines) this.facesOf({ kind: 'line', line: l });
    this.shadow = this.makeShadow();
    for (let tq = beatAfter(au, this.b0 + this.beat * 1.5); tq < e - 0.4 && this.instTs.length < QUIZ.length; tq = barAfter(au, tq + 0.05, 1)) this.instTs.push(tq);
    this.drawBase();
    this.avoid = [[this.idx.x - 10, this.idx.y - 10, w + 20, h + 20], [LEFT_X - 20, CY - 20, CW * 2 + GAP * 2 + 40, CH + 90]];
  }

  /** 印好的：切割墊上緣刻度的數字、索引卡（紙、紅頂線、橫線、標頭）。 */
  private drawBase() {
    const c = this.base.ctx;
    c.save();
    c.font = font(F.mono(400), 12);
    c.fillStyle = rgba('sepia', 0.4);
    for (let i = 0; i * 75 + 60 < W - 40; i++) if (i % 2 === 0) c.fillText(String(i / 2 * 5), 60 + i * 75 + 3, 46);
    // 索引卡：影子、紙、紅色頂線、淺淺的橫線（跟留言的基線對齊）
    const { x, y, w, h } = this.idx;
    c.drawImage(this.shadow, x - 30 + 8, y - 30 + 12, w + 60, h + 60);
    c.fillStyle = mixRgba('paper', 'bone', 0.7, 1);
    c.beginPath(); c.roundRect(x, y, w, h, 6); c.fill();
    c.strokeStyle = inkSignal(0.55); c.lineWidth = 2;
    c.beginPath(); c.moveTo(x, y + IDX.head - 16); c.lineTo(x + w, y + IDX.head - 16); c.stroke();
    const fit = this.fit!;
    c.strokeStyle = rgba('ash', 0.4); c.lineWidth = 1;
    c.beginPath();
    for (let yy = y + IDX.head + fit.size * 0.9 + 8; yy < y + h - 10; yy += fit.lineHeight) { c.moveTo(x + 14, yy); c.lineTo(x + w - 14, yy); }
    c.stroke();
    c.font = font(F.mono(500), 15); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.5);
    c.fillText(this.msg ? no3(this.msg.n) : 'No.—', x + IDX.padX, y + 32);
    c.letterSpacing = '0px';
    c.font = font(F.hand(700), 22); c.fillStyle = inkSignal(0.85);
    const tag = this.msg?.couple ? '新人的一張 ★' : this.msg ? '必背 ★' : '空白卡';
    c.fillText(tag, x + w - IDX.padX - measure(tag, F.hand(700), 22), y + 34);
    c.restore();
    this.base.upload();
  }

  /**
   * 鉛筆：斜放在索引卡右邊（HUD 的左上方）。每張卡翻過去落下時桌面一震，鉛筆就往左下滾一小段（六角筆桿的亮面跟著轉）。
   */
  private drawPencil(c: CanvasRenderingContext2D, t: number) {
    const { lyrics } = this.ctx;
    const s = this.ctx.start;
    let roll = 0;
    const lands = lyrics.has ? lyrics.lines.map((l) => l.start) : this.instTs;
    for (const tl of lands) if (tl > s && tl <= t) roll += 11 * ease.outCubic(prog(t, tl, tl + 0.4));
    roll = Math.min(roll, 70);
    const ang = -0.32;
    c.save();
    // 往筆桿的垂直方向（左下）滾
    c.translate(1110 - Math.sin(-ang) * roll * 0.35 - roll * 0.3, 770 + Math.cos(ang) * roll);
    c.rotate(ang);
    c.fillStyle = rgba('ink', 0.12); c.fillRect(6, 8, 250, 16);
    // 六角筆桿：三條亮暗不同的面，滾的時候面的位置跟著移
    const ph = (roll / 5) % 3;
    const faces = [mixRgba('signal', 'paper', 0.5, 1), mixRgba('signal', 'paper', 0.3, 1), mixRgba('signal', 'sepia', 0.1, 1)];
    for (let i = 0; i < 3; i++) { c.fillStyle = faces[(i + Math.floor(ph)) % 3]!; c.fillRect(0, i * 16 / 3, 210, 16 / 3 + 0.5); }
    c.fillStyle = rgba('ash', 1); c.fillRect(-26, 0, 26, 16);
    c.fillStyle = mixRgba('rose', 'paper', 0.3, 1); c.fillRect(-44, 0, 18, 16);
    c.fillStyle = mixRgba('paper', 'sepia', 0.25, 1);
    c.beginPath(); c.moveTo(210, 0); c.lineTo(250, 8); c.lineTo(210, 16); c.closePath(); c.fill();
    c.fillStyle = rgba('sepia', 0.9);
    c.beginPath(); c.moveTo(238, 5.5); c.lineTo(250, 8); c.lineTo(238, 10.5); c.closePath(); c.fill();
    c.restore();
  }

  /**
   * 右邊那疊最上面一張的右下角：跟著拍子被拇指掀一下（預備動作），快翻的時候掀得越來越高。
   */
  private drawCorner(c: CanvasRenderingContext2D, t: number, nextFlip: number) {
    const au = this.ctx.audio;
    const bp = au.beatAt(t) % 1;
    const tap = t > this.b0 ? Math.exp(-bp * 5) : 0;
    const ramp = ease.inCubic(prog(t, nextFlip - 0.9, nextFlip));
    const a = 10 + 14 * tap + 46 * ramp;
    const cx = RIGHT_X + CW - 4, cy = CY + CH - 4;
    c.save();
    // 掀起來的角：背面（暗一點）＋摺線的影子
    c.fillStyle = rgba('ink', 0.1);
    c.beginPath(); c.moveTo(cx - a - 6, cy + 2); c.lineTo(cx + 2, cy - a - 6); c.lineTo(cx - a * 1.05, cy - a * 1.05); c.closePath(); c.fill();
    c.fillStyle = mixRgba('paper', 'sepia', 0.14, 1);
    c.beginPath(); c.moveTo(cx - a, cy); c.lineTo(cx, cy - a); c.lineTo(cx - a * 0.94, cy - a * 0.94); c.closePath(); c.fill();
    c.strokeStyle = rgba('sepia', 0.2); c.lineWidth = 1;
    c.beginPath(); c.moveTo(cx - a, cy); c.lineTo(cx, cy - a); c.stroke();
    c.restore();
  }

  /** 卡片的影子（柔邊的圓角方塊，畫一次，貼的時候縮放）。 */
  private makeShadow(): HTMLCanvasElement {
    const { cv, c } = offCanvas(CW + 60, CH + 60, 0.5);
    c.filter = 'blur(12px)';
    c.fillStyle = rgba('ink', 0.3);
    c.beginPath(); c.roundRect(30, 30, CW, CH, 14); c.fill();
    return cv;
  }

  /** 一張卡的正反面（還沒唱的樣子）：翻動時用。畫一次存起來。 */
  private facesOf(card: Card) {
    const key = card.kind === 'line' ? `l${card.line.i}` : card.kind === 'inst' ? `i${card.j}` : card.kind;
    let f = this.faces.get(key);
    if (f) return f;
    const front = offCanvas(CW, CH), back = offCanvas(CW, CH);
    this.drawFront(front.c, card);
    this.drawBack(back.c, card, -1e9);
    f = { front: front.cv, back: back.cv };
    this.faces.set(key, f);
    return f;
  }

  /** 卡紙：圓角、淡淡的上緣光、靠鐵環那一邊的兩個孔。 */
  private paper(c: CanvasRenderingContext2D, holesLeft: boolean) {
    c.fillStyle = mixRgba('paper', 'bone', 0.6, 1);
    c.beginPath(); c.roundRect(0, 0, CW, CH, 14); c.fill();
    c.strokeStyle = rgba('sepia', 0.14); c.lineWidth = 1.2; c.stroke();
    const hx = holesLeft ? 22 : CW - 22;
    for (const ry of RINGS) {
      c.fillStyle = mixRgba('paper', 'sepia', 0.35, 1);
      c.beginPath(); c.arc(hx, ry - CY, 9, 0, TAU); c.fill();
    }
  }

  /** 正面（題目）：原文（沒翻譯的歌是一個大問號），右下角「↻ 翻面」。 */
  private drawFront(c: CanvasRenderingContext2D, card: Card) {
    this.paper(c, true);
    c.save();
    const lab = card.kind === 'line' ? `Q.${String(card.line.i + 1).padStart(2, '0')}` : card.kind === 'inst' ? `Q.0${card.j + 1}` : card.kind === 'end' ? '' : 'Vol.1';
    c.font = font(F.mono(500), 16); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.5);
    c.fillText(lab, PAD + 10, 46);
    c.letterSpacing = '0px';
    c.font = font(F.hei(500), 15); c.fillStyle = inkSignal(0.75);
    c.fillText('婚禮用語', CW - PAD - measure('婚禮用語', F.hei(500), 15), 46);
    const sub = card.kind === 'line' ? lyricSubOf(card.line) : null;
    if (sub) {
      // 題目是下一句（還沒唱）：淡一點、小一點，不跟左邊正在唱的答案搶
      const q = rgba('sepia', 0.5);
      const st: LyricStyle = { family: SUB_FAM, size: 38, minSize: 30, maxWidth: TW, align: 'center', lineHeight: 1.22, sung: q, unsung: q, active: q };
      const lay = layoutLyric(c, sub, st);
      c.translate(CW / 2 + 10, CH / 2 + lay.size * 0.35 - (lay.height - lay.size) / 2);
      drawLyric(c, sub, 1e9, st, mainOnly(lay));
    } else if (card.kind === 'end') {
      c.font = font(F.hand(700), 44); c.fillStyle = rgba('sepia', 0.8); c.textAlign = 'center';
      c.fillText('背完了！', CW / 2 + 10, CH / 2 + 4);
      c.font = font(F.hei(500), 18); c.fillStyle = inkSignal(0.8);
      c.fillText('✓ 全部答對', CW / 2 + 10, CH / 2 + 50);
    } else if (card.kind === 'inst') {
      c.font = font(F.hei(700), 44); c.fillStyle = rgba('sepia', 0.85); c.textAlign = 'center';
      c.fillText(QUIZ[card.j % QUIZ.length]![0], CW / 2 + 10, CH / 2 + 14);
    } else {
      // 題目是原文，沒翻譯的歌就是一個問號（翻過去才知道答案）
      c.font = font(F.hei(900), 132); c.fillStyle = inkSignal(0.22); c.textAlign = 'center';
      c.fillText('？', CW / 2 + 10, CH / 2 + 46);
      c.font = font(F.hand(700), 24); c.fillStyle = rgba('sepia', 0.5);
      c.fillText(card.kind === 'cover' ? '單字卡　Vol.1' : '這一句是……', CW / 2 + 10, CH - 70);
    }
    c.textAlign = 'left';
    c.font = font(F.mono(500), 14); c.fillStyle = rgba('sepia', 0.35);
    if (card.kind !== 'end') c.fillText('↻ 翻面', CW - PAD - 60, CH - 30);
    c.restore();
  }

  /** 背面（答案）：中文大字、原文小一號在正下方（跟唱），左上「A.07」。t 很小時是還沒唱的樣子。 */
  private drawBack(c: CanvasRenderingContext2D, card: Card, t: number) {
    this.paper(c, false);
    c.save();
    c.font = font(F.mono(500), 16); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.5);
    const lab = card.kind === 'line' ? `A.${String(card.line.i + 1).padStart(2, '0')}` : card.kind === 'inst' ? `A.0${card.j + 1}` : '';
    c.fillText(lab, PAD, 46);
    c.letterSpacing = '0px';
    if (card.kind === 'line') {
      const line = card.line;
      const lay = layoutLyric(c, line, this.st);
      const sub = lyricSubOf(line);
      const subSt = { ...this.st, family: SUB_FAM };
      const subY = lastRowY(lay) + subGap(lay.size, subSizeFor(lay.size));
      const subLay = sub ? layoutLyric(c, sub, { ...subSt, size: subSizeFor(lay.size), minSize: Math.min(subSizeFor(lay.size), 26) }) : null;
      const blockH = sub && subLay ? subY + (subLay.rows.length - 1) * subLay.size * 1.18 + lay.size * 0.85 : lay.height;
      const y0 = 72 + (CH - 72 - 26 - blockH) / 2 + lay.size * 0.85;
      c.translate(PAD, y0);
      drawLyric(c, line, t, this.st, mainOnly(lay));
      if (sub) { c.translate(0, subY); drawLyricSub(c, sub, t, subSt, lay.size); }
    } else if (card.kind === 'inst' && QUIZ[card.j % QUIZ.length]![1] !== null) {
      const a = QUIZ[card.j % QUIZ.length]![1]!;
      const ans = a === 'couple' ? COUPLE_ZH : a;
      c.font = font(ZH_FAM, 48); c.fillStyle = rgba('sepia', 0.92);
      c.fillText(ans, PAD, CH / 2 + 10);
    } else if (card.kind === 'inst') {
      const title = this.ctx.song.title;
      const sz = clamp(Math.floor((100 * TW) / Math.max(1, measure(title, ZH_FAM, 100))), 36, 52);
      c.font = font(ZH_FAM, sz); c.fillStyle = rgba('sepia', 0.92);
      c.fillText(title, PAD, CH / 2 + 10);
      c.font = font(F.mono(400), 18); c.fillStyle = rgba('sepia', 0.55);
      c.fillText(this.ctx.song.artist, PAD, CH / 2 + 50);
    } else {
      c.font = font(F.hei(700), 30); c.fillStyle = rgba('sepia', 0.8);
      c.fillText('單字卡　Vol.1', PAD, CH / 2);
      c.font = font(F.mono(400), 17); c.fillStyle = rgba('sepia', 0.5);
      c.fillText(`婚禮用語 · 共 ${this.ctx.lyrics.lines.length || 1} 張`, PAD, CH / 2 + 40);
    }
    c.restore();
  }

  /** 這一格：左邊攤著的卡（已經翻過去的）、翻到一半的卡（θ）、右邊最上面的卡。 */
  private deckAt(t: number): { left: Card; flip: { card: Card; th: number; t0: number } | null; right: Card; flipped: number; total: number; lastLand: number; nextFlip: number } {
    const { lyrics } = this.ctx;
    if (!lyrics.has) {
      // 跟歌詞一樣：第 k 張在 instTs[k] 落定，前 FLIP 秒開始翻
      const ts = this.instTs, n = ts.length;
      let k = -1;
      for (let i = 0; i < n; i++) if (ts[i]! - FLIP <= t) k = i;
      const flipping = k >= 0 && t < ts[k]!;
      const sk = flipping ? k - 1 : k;
      const q = (j: number): Card => (j < n ? { kind: 'inst', j } : { kind: 'end' });
      return {
        left: sk >= 0 ? q(sk) : { kind: 'cover' }, right: q(k + 1),
        flip: flipping ? { card: q(k), th: Math.PI * ease.inOutCubic(prog(t, ts[k]! - FLIP, ts[k]!)), t0: ts[k]! - FLIP } : null,
        flipped: sk + 1, total: n, lastLand: sk >= 0 ? ts[sk]! : -1, nextFlip: k + 1 < n ? ts[k + 1]! - FLIP : Infinity,
      };
    }
    const ls = lyrics.lines;
    let k = -1;
    for (let i = 0; i < ls.length; i++) if (ls[i]!.start - FLIP <= t) k = i; else break;
    const cur = ls[k];
    const flipping = cur && t < cur.start;
    const settled = flipping ? ls[k - 1] : cur;
    const next = ls[k + 1];
    return {
      left: settled ? { kind: 'line', line: settled } : { kind: 'cover' },
      flip: flipping && cur ? { card: { kind: 'line', line: cur }, th: Math.PI * ease.inOutCubic(prog(t, cur.start - FLIP, cur.start)), t0: cur.start - FLIP } : null,
      right: next ? { kind: 'line', line: next } : (flipping ? { kind: 'end' } : cur ? { kind: 'end' } : { kind: 'line', line: ls[0]! }),
      flipped: k + 1, total: ls.length, lastLand: settled ? settled.start : -1, nextFlip: next ? next.start - FLIP : Infinity,
    };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start;
    if (!this.bgReady) { this.bg.render(renderer, this.bgRT); this.bgReady = true; }
    comp.draw(renderer, this.bgRT.texture, out, { mode: 'replace' });
    comp.draw(renderer, this.base.texture, out);

    const L = this.live;
    L.clear();
    const c = L.ctx;
    const inK = prog(t, s, s + 0.35, ease.outCubic);
    c.globalAlpha = inK;
    const d = this.deckAt(t);
    // 進場：整疊卡從上面滑進來、落定
    const dropY = (1 - ease.outBack(prog(t, s, s + 0.45), 1.2)) * -80;
    c.save();
    c.translate(0, dropY);
    this.drawDeck(c, t, d);
    c.restore();
    this.drawPencil(c, t);
    c.globalAlpha = 1;
    this.drawMessage(c, t);
    this.drawTally(c, t, d);
    comp.draw(renderer, L.upload(), out);

    // 鏡頭：先看卡片那一疊，留言寫好之後往左下（索引卡）移一點；整個窗格慢慢推近。翻卡落下時畫面輕輕一沉
    const zoom = 1.012 + 0.035 * ease.inOutCubic(f.p) + 0.004 * Math.exp(-Math.max(0, t - d.lastLand) * 9) * (d.lastLand > 0 && t >= d.lastLand ? 1 : 0);
    const roomX = (W - W / zoom) / 2, roomY = (H - H / zoom) / 2;
    const toMsg = this.msg ? ease.inOutCubic(prog(t, this.b0 + 1.2, this.b0 + 4)) : 0;
    return {
      paper: 1, popupAvoid: this.avoid, bloom: 0.1, bloomThreshold: 1.8, halation: 0.02, vignette: 0.22, grain: 0.04, ca: 0.3, zoom,
      shake: [lerp(-0.2, 0.55, toMsg) * roomX * 0.95, lerp(-0.5, 0.45, toMsg) * roomY * 0.95],
    };
  }

  /** 兩疊卡、翻動中的卡、鐵環。 */
  private drawDeck(c: CanvasRenderingContext2D, t: number, d: ReturnType<Flashcards['deckAt']>) {
    // 右邊還沒翻的一疊（越翻越薄）、左邊翻過的一疊（越疊越厚）：卡邊一層層往下露出來
    const leftN = clamp(d.flipped, 0, 7), rightN = clamp(d.total - d.flipped, 0, 7);
    const stack = (x: number, n: number) => {
      c.drawImage(this.shadow, x - 30 + 6, CY - 30 + 10 + n * 3, CW + 60, CH + 60);
      for (let i = n; i >= 1; i--) {
        c.fillStyle = mixRgba('paper', 'sepia', 0.1 + 0.02 * i, 1);
        c.beginPath(); c.roundRect(x, CY + i * 3, CW, CH, 14); c.fill();
      }
    };
    stack(LEFT_X, Math.max(1, leftN));
    stack(RIGHT_X, Math.max(1, rightN));
    // 左邊：翻過去的卡的背面（答案），照唱的進度亮
    c.save();
    c.translate(LEFT_X, CY);
    this.drawBack(c, d.left, t);
    // 一句唱完：右上角紅筆打一個勾
    if (d.left.kind === 'line') this.drawCheck(c, t, d.left.line);
    c.restore();
    // 右邊：最上面一張的正面（題目）
    c.drawImage(this.facesOf(d.right).front, RIGHT_X, CY, CW, CH);
    if (d.right.kind !== 'end') this.drawCorner(c, t, d.nextFlip);
    // 翻動中的卡：繞著鐵環轉，前半露正面（往左越來越窄），後半露背面
    if (d.flip) {
      const { th } = d.flip;
      const fc = this.facesOf(d.flip.card);
      const cs = Math.cos(th), lift = Math.sin(th);
      const w = CW * Math.abs(cs), sy = 1 + 0.07 * lift;
      const hh = CH * sy, y = CY + (CH - hh) / 2 - 16 * lift;
      c.save();
      // 立起來的卡在桌上的影子：往外拖長、淡淡的
      c.globalAlpha *= 0.55 * lift;
      c.drawImage(this.shadow, cs > 0 ? AX - 20 : AX - GAP - w - 60 * lift, CY - 10, w + 60 * lift + 40, CH + 50);
      c.restore();
      if (cs > 0) c.drawImage(fc.front, AX + GAP * cs, y, w, hh);
      else c.drawImage(fc.back, AX - GAP * -cs - w, y, w, hh);
      // 轉到側面的時候暗一點（背光）
      c.fillStyle = rgba('sepia', 0.22 * lift);
      c.fillRect(cs > 0 ? AX + GAP * cs : AX - GAP * -cs - w, y, w, hh);
    }
    // 鐵環：從上面看是一個扁扁的環穿過兩疊的孔；卡落下時晃一下
    const land = d.lastLand > 0 ? t - d.lastLand : 99;
    const wob = land >= 0 ? Math.exp(-land * 6) * Math.sin(land * 30) * 5 : 0;
    for (const ry of RINGS) {
      c.save();
      c.translate(AX + wob, ry);
      c.lineCap = 'round';
      c.strokeStyle = rgba('ink', 0.18); c.lineWidth = 9;
      c.beginPath(); c.ellipse(4, 6, 40, 14, 0, Math.PI * 1.05, Math.PI * 1.95); c.stroke();
      c.strokeStyle = mixRgba('ash', 'sepia', 0.3, 1); c.lineWidth = 8;
      c.beginPath(); c.ellipse(0, 0, 40, 14, 0, Math.PI * 1.05, Math.PI * 1.95); c.stroke();
      c.strokeStyle = rgba('bone', 0.8); c.lineWidth = 2.2;
      c.beginPath(); c.ellipse(0, -2, 38, 12, 0, Math.PI * 1.3, Math.PI * 1.7); c.stroke();
      c.restore();
    }
  }

  /** 背面右上角的勾：這一句唱完就用紅筆勾一下（0.25 秒畫完）。 */
  private drawCheck(c: CanvasRenderingContext2D, t: number, line: Line) {
    const q = prog(t, line.end + 0.05, line.end + 0.3, ease.outCubic);
    if (q <= 0) return;
    const pts: [number, number][] = [[CW - 118, 36], [CW - 100, 58], [CW - 64, 18]];
    const L1 = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]), L2 = Math.hypot(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1]);
    const len = (L1 + L2) * q;
    c.strokeStyle = inkSignal(0.9); c.lineWidth = 5; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(...pts[0]);
    if (len <= L1) c.lineTo(lerp(pts[0][0], pts[1][0], len / L1), lerp(pts[0][1], pts[1][1], len / L1));
    else { c.lineTo(...pts[1]); const k = (len - L1) / L2; c.lineTo(lerp(pts[1][0], pts[2][0], k), lerp(pts[1][1], pts[2][1], k)); }
    c.stroke();
  }

  /** 右邊那疊下面的小字：已背熟 7／35（勾一下就跳一格）。 */
  private drawTally(c: CanvasRenderingContext2D, t: number, d: ReturnType<Flashcards['deckAt']>) {
    const { lyrics } = this.ctx;
    let done = 0;
    for (const l of lyrics.lines) if (l.end + 0.3 <= t) done++;
    const total = lyrics.has ? lyrics.lines.length : this.instTs.length;
    if (!lyrics.has) done = this.instTs.filter((x) => x + 0.4 <= t).length;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.3, this.ctx.start + 0.7);
    c.font = font(F.mono(500), 17); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.55);
    c.fillText(`已背熟 ${done}／${total}`, RIGHT_X + 8, CY + CH + 52);
    c.restore();
    void d;
  }

  /** 索引卡上的手寫留言：一個字一個字寫出來，寫完署名。 */
  private drawMessage(c: CanvasRenderingContext2D, t: number) {
    const fit = this.fit;
    if (!fit) return;
    c.save();
    c.font = font(MSG_FAM, fit.size);
    const ink = rgba('sepia', this.msg ? 0.94 : 0.62);
    for (const g of this.glyphs) {
      const a = prog(t, g.t - 0.02, g.t + 0.16);
      if (a <= 0) continue;
      c.globalAlpha = a;
      c.fillStyle = g.ch === '♥' ? rgba('rose') : ink;
      c.fillText(g.ch, g.x, g.y + (1 - a) * 3);
    }
    if (this.sig && t >= this.sig.t) {
      c.globalAlpha = prog(t, this.sig.t, this.sig.t + 0.4);
      c.font = font(SIG_FAM, this.sig.size); c.fillStyle = rgba('sepia', 0.78);
      c.fillText(this.sig.text, this.sig.x, this.sig.y);
    }
    c.restore();
  }
}
