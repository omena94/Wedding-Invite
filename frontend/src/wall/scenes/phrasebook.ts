// 旅遊會話手冊（亮，雙語版面）：一本攤開的口袋會話手冊，壓在一張摺過的城市地圖上（地圖斜斜的、有摺痕、河、公園），午後的光。
//  - 右頁是「會話」：每句歌詞是一條會話，中文大字（思源黑體）、原文小一號在正下方，旁邊一個編號圓章和小喇叭。
//    下一條淡淡地排在下面（一本會話手冊的樣子）；換句時整排往上滑，舊的那一條滑走、淡掉。
//  - 螢光筆在拍點劃過正在唱的那一句：每一拍往前劃一段，追上唱到的位置（跟唱的顏色照舊由字自己的時間決定，螢光筆只在後面追）。
//    筆尖貼著這一條（中文＋原文）的上緣、筆身往右上伸到空著的那一帶，任何時候都不蓋到歌詞（_b2 的 penOnEdge，跟 dictionary 的紅筆同一條規則）。
//  - 左頁：課名色塊「LESSON 07 婚禮上用得到的話」、一張線稿插圖（街角的小店、遮雨棚、一串燈泡——燈泡在拍點輪流亮），
//    下面一個「小提醒」冷面註記。書頁上緣黏著三張便利貼當書籤，每個小節線被風掀一下。
//  - 主打留言寫在一張夾在書裡的車票背面（淡色票紙、磁條、手寫字），第一個拍點從書底下被抽出來；署名在最後一行下面。
//  - 地圖上一條訊號色的虛線路線慢慢往前走，終點的定位針每個小節線彈一下。
//  - 沒有主打留言：車票背面寫一行邀請；純音樂：右頁每兩小節一條冷面的婚禮會話（只有中文），螢光筆照樣劃。
// 畫法：地圖是一個 shader，畫一次存起來；書（紙、插圖、課名、頁碼）畫一次在一張 Canvas2D；車票在自己的一張（只有抽出來的那一下重畫）；
// 會話、螢光筆、燈泡、便利貼、路線每格畫在另一張。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, makeRT } from '../engine/gl';
import { F, font, layout, loadText, measure } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash, TAU } from '../engine/util';
import type { FitResult } from '../engine/text';
import { Lyrics, lyricSubOf, type Line } from '../engine/lyrics';
import { lyricAt, layoutLyric, drawLyric, drawLyricSub, beatAfter, barAfter, subGap, subSizeFor, drawMessage, type LyricStyle, type LyricLayout } from './_motifs';
import { lyricV2, sigV2, msgMaxFor, V2 } from './_v2';
import { fitMsgB2, sigOf, windowLines, linesText, PAPER_SING, mainOnly, lastRowY, lyricBlock, penOnEdge, INVITE, B2_SYMBOLS, no3, offCanvas, type Rect } from './_b2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'print', paper: true, energy: [0.2, 0.8], bars: [4, 8] };

/** 手冊：左右兩頁、中縫。 */
const BK = { x0: 330, x1: 1590, y0: 50, y1: 650, g: 960 };
/** 右頁會話的欄：編號圓章的中心 x、字從哪裡開始、可用寬。 */
const BADGE_X = 1012, TX = 1052, TW = BK.x1 - 44 - TX;
/** 上一條、這一條、下一條的基線。 */
const PREV_Y = 192, CUR_Y = 312, NEXT_Y = 580;
/** 車票：左上角、大小（邏輯像素）、傾斜；上緣有一段夾在書裡。 */
const TK = { x: 214, y: 598, w: 800, h: 380, rot: -0.035 };
/** 車票背面寫字的範圍（票紙座標）。 */
/** 車票背面下緣印的小字。 */
const PRINT = '本票限當日有效　乘車區間：幸福站 → 永遠站';
const TK_TEXT = { x: 46, y: 112, w: 700, h: 236 };
const ZH_FAM = F.hei(700);
const SUB_FAM = F.hei(500);
const MSG_FAM = F.hand(700);
const SIG_FAM = F.hand(400);
const NO_MSG = '這張車票背面還空著——掃描右下角 QR code，寫一句給新人。';
/** 純音樂：右頁的冷面會話（只有中文），每兩小節一條。 */
const INST_PHRASES = ['恭喜你們！', '可以跟你跳一支舞嗎？', '請問喜餅還有嗎？', '祝你們一直這麼幸福。'];
const TIP = ['小提醒：說的時候看著對方的眼睛。', '發音不準也沒關係，笑著說就對了。'];

const MAP_FRAG = /* glsl */ `
void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  // 地圖斜放（轉 8°）
  float a = 0.14;
  vec2 m = mat2(cos(a), -sin(a), sin(a), cos(a)) * (p - vec2(960.0, 540.0)) + vec2(960.0, 540.0);
  vec3 col = mix(C_PAPER, C_BONE, 0.25) * (0.975 + 0.03 * fbm(m / 260.0, 3));
  // 街廓：小街 88 px 一格（紙色的街、淡淡上色的街廓），每四格一條大路（兩邊細墨線）
  vec2 f = fract(m / 88.0);
  float d = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * 88.0;
  float block = smoothstep(2.0, 3.5, d);
  float h = hash12(floor(m / 88.0));
  col = mix(col, mix(col, mix(C_ASH, C_BLOOD, 0.12), 0.08 + 0.05 * h), block);
  vec2 F4 = abs(fract(m / 352.0 + 0.5 / 4.0) - 0.5) * 352.0;
  float road = min(F4.x, F4.y);
  col = mix(col, mix(C_PAPER, C_BONE, 0.5), 1.0 - smoothstep(7.0, 9.0, road));
  col = mix(col, C_SEPIA, pxLine(abs(road - 9.0), 0.5, 1.1) * 0.28);
  // 公園：幾塊大一點的區域打細斜線
  float park = smoothstep(0.62, 0.66, fbm(m / 520.0 + 3.1, 3));
  col = mix(col, mix(C_PAPER, C_SEPIA, 0.1), park * 0.6);
  col = mix(col, C_SEPIA, park * pxLine(abs(fract((m.x - m.y) / 9.0) - 0.5) * 9.0, 0.4, 0.9) * 0.18);
  // 河：一條彎彎的帶子（淡淡的灰藍用 ash 混一點暗部），岸邊細線
  float ry = 900.0 + 130.0 * sin(m.x / 420.0) + 40.0 * sin(m.x / 150.0 + 1.0);
  float rd = abs(m.y - ry);
  col = mix(col, mix(C_ASH, C_BLOOD, 0.1) * 1.05, (1.0 - smoothstep(44.0, 47.0, rd)) * 0.3);
  col = mix(col, C_SEPIA, pxLine(abs(rd - 46.0), 0.5, 1.0) * 0.3);
  // 摺痕：地圖摺成八格（直的兩條、橫的一條），摺痕一邊亮一邊暗
  float fx = m.x - 560.0 - 480.0 * floor((m.x - 320.0) / 480.0);
  float fy = m.y - 540.0;
  float crease = exp(-abs(fx - 240.0) / 5.0) * sign(fx - 240.0) + exp(-abs(fy) / 5.0) * sign(fy);
  col *= 1.0 - 0.05 * crease - 0.03 * (exp(-abs(fx - 240.0) / 40.0) + exp(-abs(fy) / 40.0));
  // 午後的光：左上亮、右下暗一點；右下角 HUD 那一塊地圖淡掉（深色的 HUD 字要讀得清楚）
  col *= 0.9 + 0.12 * smoothstep(1800.0, 200.0, p.x + p.y * 0.8);
  float hud = smoothstep(1300.0, 1420.0, p.x) * smoothstep(780.0, 870.0, p.y);
  col = mix(col, mix(C_PAPER, C_BONE, 0.25), hud * 0.75);
  fragColor = vec4(col, 1.0);
}`;
const MAP = () => new FSPass(MAP_FRAG);

interface Entry { kind: 'line'; line: Line }
interface InstEntry { kind: 'inst'; j: number; t0: number; t1: number }

export default class Phrasebook extends Scene {
  map = shared('phrasebook.map', MAP);
  mapRT = this.track(makeRT(W, H, { depthBuffer: false }));
  mapReady = false;
  /** 書（畫一次）。 */
  book = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 車票（只有抽出來的時候重畫）。 */
  ticketL = this.track(new Layer2D(W, H, undefined, { fast: true }));
  ticketQ = -1;
  live = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 59 + (this.msg?.id ?? 0) * 7) >>> 0;
  b0 = 0;
  beat = 0.5;
  fit: FitResult | null = null;
  lyrSize = 52;
  st!: LyricStyle;
  /** 車票背面（畫一次）。 */
  ticket: HTMLCanvasElement | null = null;
  /** 車票抽出來的時間。 */
  pullT = 0;
  inst: InstEntry[] = [];
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.b0 = beatAfter(au, s + 0.05);
    this.beat = clamp(au.beatPeriod(this.b0), 0.25, 1.2);
    const lines = windowLines(lyrics, s, e);
    const around = lines.flatMap((l) => [lyrics.lines[l.i - 1], lyrics.lines[l.i + 1]]).filter((l): l is Line => !!l);
    const text = m ? m.text : NO_MSG;
    const sigText = m ? sigOf(m) : '';
    await loadText(text + sigText + NO_MSG + INVITE + INST_PHRASES.join('') + TIP.join('') + song.title + song.artist + linesText(lines) + linesText(around)
      + 'LESSON07婚禮上用得到的話會話PHRASES在婚禮上4647車票背面本票限當日有效一路順風乘車區間幸福站→永遠站' + B2_SYMBOLS);

    // ---- 車票背面的留言（票紙座標）
    const tk = offCanvas(TK.w, TK.h);
    const c = tk.c;
    const reserve = m ? sigV2(msgMaxFor(text)) + 20 : 0;
    this.fit = fitMsgB2(c, text, MSG_FAM, TK_TEXT.w, TK_TEXT.h - reserve, { lineHeight: 1.32, maxLines: 5, max: m ? undefined : 34, min: m ? undefined : 30 });
    this.lyrSize = lyricV2(m ? this.fit.size : null);
    this.drawTicket(c, sigText);
    this.ticket = tk.cv;
    this.pullT = this.b0;

    this.st = { family: ZH_FAM, size: this.lyrSize, minSize: V2.lyrMin, maxWidth: TW, align: 'left', lineHeight: 1.2, ...PAPER_SING() };
    for (const l of [...lines, ...around]) layoutLyric(this.live.ctx, l, this.st);
    if (!lyrics.has) {
      // 純音樂：每兩小節一條冷面會話（從第一拍開始）
      let j = 0;
      for (let t0 = this.b0; t0 < e - 0.3; t0 = barAfter(au, t0 + 0.05, 1), j++) {
        const t1 = Math.min(e, barAfter(au, t0 + 0.05, 1));
        this.inst.push({ kind: 'inst', j, t0, t1 });
      }
    }
    this.drawBook();
    this.avoid = [[TK.x - 10, TK.y + 40, TK.w + 20, TK.h - 20], [BK.g, 90, BK.x1 - BK.g, 620]];
  }

  /** 車票背面：淡色的票紙、上緣一條磁條（夾在書裡的那一段）、手寫的留言與署名、小小的印刷字。 */
  private drawTicket(c: CanvasRenderingContext2D, sigText: string) {
    const fit = this.fit!, m = this.msg;
    c.save();
    // 票紙：四角圓、右邊一個剪票的缺口
    c.fillStyle = mixRgba('paper', 'bone', 0.55, 1);
    c.beginPath(); c.roundRect(0, 0, TK.w, TK.h, 12); c.fill();
    c.globalCompositeOperation = 'destination-out';
    c.beginPath(); c.arc(TK.w, TK.h * 0.62, 16, 0, TAU); c.fill();
    c.globalCompositeOperation = 'source-over';
    c.strokeStyle = rgba('sepia', 0.18); c.lineWidth = 1.2;
    c.beginPath(); c.roundRect(0.5, 0.5, TK.w - 1, TK.h - 1, 12); c.stroke();
    // 磁條
    c.fillStyle = mixRgba('sepia', 'blood', 0.25, 0.82);
    c.fillRect(0, 22, TK.w, 34);
    // 背面的淡色底紋（細斜線）
    c.strokeStyle = rgba('sepia', 0.05); c.lineWidth = 1;
    c.beginPath();
    for (let x = -TK.h; x < TK.w; x += 12) { c.moveTo(x, TK.h); c.lineTo(x + TK.h * 0.6, 60); }
    c.stroke();
    c.font = font(F.hei(500), 14); c.fillStyle = rgba('sepia', 0.42); c.letterSpacing = '2px';
    c.fillText(PRINT, 46, TK.h - 22);
    const PRINT_W = c.measureText(PRINT).width;
    c.letterSpacing = '0px';
    if (m) {
      c.font = font(F.mono(500), 14); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.5);
      // 編號在車票下緣、緊接在印刷的小字後面（右上角會被書蓋住；右下角是署名）
      c.fillText(no3(m.n), 46 + PRINT_W + 28, TK.h - 22);
      c.letterSpacing = '0px';
    }
    // 手寫的字：垂直置中在寫字區
    const ss = sigV2(fit.size);
    const blockH = fit.height + (m ? fit.size * 0.3 + ss * 1.2 : 0);
    const top = TK_TEXT.y + Math.max(0, (TK_TEXT.h - blockH) / 2) + fit.size * 0.88;
    drawMessage(c, fit, MSG_FAM, TK_TEXT.x, top, { color: rgba('sepia', m ? 0.92 : 0.6) });
    if (m) {
      const sw = measure(sigText, SIG_FAM, ss);
      const lastY = top + (fit.lines.length - 1) * fit.lineHeight;
      c.font = font(SIG_FAM, ss); c.fillStyle = rgba('sepia', 0.78);
      c.fillText(sigText, TK_TEXT.x + Math.max(fit.width, sw + 60) - sw, lastY + fit.size * 0.3 + ss * 1.1);
      if (m.couple) {
        c.font = font(F.mono(500), 14); c.letterSpacing = '4px'; c.fillStyle = mixRgba('signal', 'blood', 0.6, 0.9);
        c.fillText('FROM THE COUPLE · 新人', TK_TEXT.x, TK_TEXT.y - 4);
        c.letterSpacing = '0px';
      }
    }
    c.restore();
  }

  /** 書：封面的邊、紙、中縫的陰影、頁碼、左頁的課名與插圖與小提醒、右頁的標頭。 */
  private drawBook() {
    const c = this.book.ctx;
    // 影子（blur 只跑一次）
    c.save();
    c.filter = 'blur(18px)';
    c.fillStyle = rgba('ink', 0.28);
    c.fillRect(BK.x0 + 10, BK.y0 + 22, BK.x1 - BK.x0, BK.y1 - BK.y0);
    c.restore();
    // 封面（比紙大一圈）、底下露出的一層層頁邊
    c.fillStyle = mixRgba('blood', 'sepia', 0.45, 1);
    c.beginPath(); c.roundRect(BK.x0 - 12, BK.y0 - 10, BK.x1 - BK.x0 + 24, BK.y1 - BK.y0 + 26, 10); c.fill();
    for (let i = 5; i >= 1; i--) {
      c.fillStyle = mixRgba('paper', 'sepia', 0.06 + 0.03 * i, 1);
      c.fillRect(BK.x0 + 2, BK.y0 + i * 2.2, BK.x1 - BK.x0 - 4, BK.y1 - BK.y0);
    }
    // 兩頁紙：靠中縫的地方暗下去（紙彎進中縫）
    for (const [x0, x1] of [[BK.x0, BK.g], [BK.g, BK.x1]] as const) {
      c.fillStyle = mixRgba('paper', 'bone', 0.35, 1);
      c.fillRect(x0, BK.y0, x1 - x0, BK.y1 - BK.y0);
      const left = x0 === BK.x0;
      const g = c.createLinearGradient(left ? x1 - 90 : x0 + 90, 0, left ? x1 : x0, 0);
      g.addColorStop(0, rgba('sepia', 0)); g.addColorStop(0.8, rgba('sepia', 0.1)); g.addColorStop(1, rgba('sepia', 0.3));
      c.fillStyle = g;
      c.fillRect(left ? x1 - 90 : x0, BK.y0, 90, BK.y1 - BK.y0);
    }
    c.fillStyle = rgba('sepia', 0.35); c.fillRect(BK.g - 1, BK.y0, 2, BK.y1 - BK.y0);
    // 頁碼
    c.font = font(F.mono(500), 15); c.fillStyle = rgba('sepia', 0.45);
    c.fillText('46', BK.x0 + 36, BK.y1 - 22);
    c.fillText('47', BK.x1 - 36 - measure('47', F.mono(500), 15), BK.y1 - 22);
    // ---- 左頁：課名色塊
    const lx = BK.x0 + 40, lw = BK.g - 40 - lx;
    c.fillStyle = mixRgba('signal', 'blood', 0.55, 0.92);
    c.fillRect(lx, 84, lw, 46);
    c.font = font(F.mono(600), 16); c.letterSpacing = '4px'; c.fillStyle = rgba('paper', 0.96);
    c.fillText('LESSON 07', lx + 18, 113);
    c.letterSpacing = '1px';
    c.font = font(F.hei(700), 20);
    c.fillText('婚禮上用得到的話', lx + 160, 114);
    c.letterSpacing = '0px';
    // 插圖框：街角的小店（線稿）
    this.drawStreet(c, lx, 150, lw, 280);
    // 小提醒
    c.strokeStyle = rgba('sepia', 0.3); c.lineWidth = 1; c.setLineDash([4, 4]);
    c.strokeRect(lx, 450, lw, 92);
    c.setLineDash([]);
    c.font = font(F.hei(500), 17); c.fillStyle = rgba('sepia', 0.6);
    c.fillText(TIP[0]!, lx + 18, 488);
    c.fillText(TIP[1]!, lx + 18, 520);
    // ---- 右頁：標頭
    const rx = BK.g + 40;
    c.font = font(F.mono(600), 14); c.letterSpacing = '4px'; c.fillStyle = mixRgba('signal', 'blood', 0.55, 0.9);
    c.fillText('會話 · PHRASES', rx, 108);
    c.letterSpacing = '0px';
    c.strokeStyle = mixRgba('signal', 'blood', 0.55, 0.6); c.lineWidth = 2;
    c.beginPath(); c.moveTo(rx, 122); c.lineTo(BK.x1 - 40, 122); c.stroke();
    this.book.upload();
  }

  /** 左頁的插圖：兩間小店（遮雨棚、窗、門）、一根路燈、一條燈泡線（燈泡每格另外畫）、石板路。細線、墨色。 */
  private drawStreet(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    c.save();
    c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.fillStyle = mixRgba('paper', 'signal', 0.08, 1);
    c.fillRect(x, y, w, h);
    c.strokeStyle = rgba('sepia', 0.75); c.lineWidth = 1.6; c.lineJoin = 'round';
    const gy = y + h - 60;
    // 石板路：透視的橫線
    c.beginPath();
    for (let k = 0; k < 5; k++) { const yy = gy + 8 + k * k * 3.2; c.moveTo(x, yy); c.lineTo(x + w, yy); }
    c.stroke();
    // 店一：遮雨棚（條紋）、窗、門
    const s1 = { x: x + 40, w: 230, top: y + 70 };
    c.strokeRect(s1.x, s1.top, s1.w, gy - s1.top);
    c.beginPath();
    c.moveTo(s1.x - 12, s1.top + 60); c.lineTo(s1.x + s1.w + 12, s1.top + 60); c.lineTo(s1.x + s1.w, s1.top + 30); c.lineTo(s1.x, s1.top + 30); c.closePath();
    c.stroke();
    c.save(); c.clip();
    c.fillStyle = mixRgba('signal', 'blood', 0.4, 0.35);
    for (let i = 0; i < 12; i += 2) c.fillRect(s1.x - 12 + i * 22, s1.top + 28, 22, 34);
    c.restore();
    c.strokeRect(s1.x + 24, s1.top + 86, 90, 76);
    c.beginPath(); c.moveTo(s1.x + 69, s1.top + 86); c.lineTo(s1.x + 69, s1.top + 162); c.stroke();
    c.strokeRect(s1.x + 140, s1.top + 90, 60, gy - s1.top - 90);
    // 店二：高一點、斜屋頂、兩扇窗
    const s2 = { x: x + 330, w: 200, top: y + 40 };
    c.beginPath();
    c.moveTo(s2.x, gy); c.lineTo(s2.x, s2.top + 30); c.lineTo(s2.x + s2.w / 2, s2.top); c.lineTo(s2.x + s2.w, s2.top + 30); c.lineTo(s2.x + s2.w, gy);
    c.stroke();
    for (const [wx, wy] of [[30, 60], [120, 60], [30, 140], [120, 140]] as const) c.strokeRect(s2.x + wx, s2.top + wy, 50, 56);
    // 路燈
    c.beginPath(); c.moveTo(x + 296, gy); c.lineTo(x + 296, y + 60); c.lineTo(x + 314, y + 60); c.stroke();
    c.beginPath(); c.arc(x + 314, y + 70, 9, 0, TAU); c.stroke();
    // 燈泡線（兩條懸鏈，燈泡位置在 bulbs()）
    c.lineWidth = 1.1;
    for (const [a, b] of this.wires()) {
      c.beginPath();
      for (let i = 0; i <= 20; i++) { const q = i / 20; const px = lerp(a[0], b[0], q), py = lerp(a[1], b[1], q) + 26 * Math.sin(Math.PI * q); if (i) c.lineTo(px, py); else c.moveTo(px, py); }
      c.stroke();
    }
    c.restore();
  }

  /** 燈泡線的兩端（插圖裡）。 */
  private wires(): [[number, number], [number, number]][] {
    const x = BK.x0 + 40, y = 150;
    return [[[x + 40, y + 100], [x + 296, y + 64]], [[x + 296, y + 64], [x + 540, y + 72]]];
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start;
    if (!this.mapReady) { this.map.render(renderer, this.mapRT); this.mapReady = true; }
    comp.draw(renderer, this.mapRT.texture, out, { mode: 'replace' });

    // 車票：第一拍從書底下被抽出來（往下、往左一點），只有在動的時候重畫
    const q = ease.outCubic(prog(t, this.pullT - 0.05, this.pullT + 0.5));
    const qq = Math.round(q * 400) / 400;
    if (qq !== this.ticketQ) {
      this.ticketQ = qq;
      const c = this.ticketL.ctx;
      this.ticketL.clear();
      c.save();
      c.translate(TK.x - 30 * (1 - qq), TK.y - 250 * (1 - qq));
      c.rotate(TK.rot * (0.4 + 0.6 * qq));
      c.save(); c.filter = 'blur(6px)'; c.fillStyle = rgba('ink', 0.18); c.fillRect(6, 10, TK.w, TK.h); c.restore();
      if (this.ticket) c.drawImage(this.ticket, 0, 0, TK.w, TK.h);
      c.restore();
      this.ticketL.upload();
    }
    comp.draw(renderer, this.ticketL.texture, out);
    comp.draw(renderer, this.book.texture, out);

    const L = this.live;
    L.clear();
    const c = L.ctx;
    this.drawRoute(c, t);
    this.drawBulbs(c, t);
    this.drawTabs(c, t);
    if (lyrics.has) this.drawEntries(c, t); else this.drawInst(c, t);
    comp.draw(renderer, L.upload(), out);

    // 鏡頭：先看右頁的會話，車票抽出來之後往左下看一點；整個窗格慢慢推近
    const zoom = 1.02 + 0.04 * ease.inOutCubic(f.p);
    const roomX = (W - W / zoom) / 2, roomY = (H - H / zoom) / 2;
    const toMsg = this.msg ? ease.inOutCubic(prog(t, this.pullT + 1.5, this.pullT + 4.5)) : 0;
    void s;
    return {
      paper: 1, popupAvoid: this.avoid, bloom: 0.1, bloomThreshold: 1.8, halation: 0.02, vignette: 0.24, grain: 0.04, ca: 0.3, zoom,
      shake: [lerp(-0.5, 0.6, toMsg) * roomX * 0.95, lerp(0.2, -0.5, toMsg) * roomY * 0.95],
    };
  }

  /**
   * 右頁的會話：這一條（中文大字＋原文小一號，螢光筆在拍點劃過）、下一條（小、淡）排在下面；換句時舊的那一條往上滑走、淡掉。
   * 上面那一帶留空：螢光筆的筆身往右上伸到那裡（_b2 的 penOnEdge），才不會蓋到任何一行歌詞。
   */
  private drawEntries(c: CanvasRenderingContext2D, t: number) {
    const { lyrics } = this.ctx;
    const ly = lyricAt(lyrics, t, 8, 0.35);
    const inK = prog(t, this.ctx.start + 0.1, this.ctx.start + 0.45);
    if (!ly) return;
    const line = ly.line;
    const prev = lyrics.lines[line.i - 1], next = lyrics.lines[line.i + 1];
    // 換句時整排往上滑一格（新的一條從下面上來）
    const slide = 1 - ease.outCubic(prog(t, line.start - 0.35, line.start + 0.05));
    const dy = slide * (NEXT_Y - CUR_Y) * 0.5;
    c.save();
    c.globalAlpha = inK;
    c.beginPath(); c.rect(BK.g + 10, 130, BK.x1 - BK.g - 20, BK.y1 - 170); c.clip();
    // 上一條只在換句那一下看得到（往上滑走、淡掉）：平常上面那一帶是空的，給螢光筆的筆身
    if (prev && slide > 0.01) this.smallEntry(c, prev, PREV_Y + dy, 0.55 * slide);
    if (next) this.smallEntry(c, next, NEXT_Y + dy, 0.42);
    // ---- 這一條
    const lay = layoutLyric(c, line, this.st);
    const sub = lyricSubOf(line);
    const y = CUR_Y + dy;
    c.globalAlpha = inK * (0.4 + 0.6 * (1 - slide));
    this.badge(c, line.i + 1, y - lay.size * 0.36, 1);
    c.save();
    c.translate(TX, y);
    const pen = this.highlight(c, line, lay, t);
    drawLyric(c, line, t, this.st, mainOnly(lay));
    let subL: { lay: LyricLayout; dy: number } | null = null;
    if (sub) {
      const sy = lastRowY(lay) + subGap(lay.size, subSizeFor(lay.size));
      c.translate(0, sy);
      subL = { lay: drawLyricSub(c, sub, t, { ...this.st, family: SUB_FAM }, lay.size), dy: sy };
    }
    c.restore();
    c.restore();
    // 螢光筆：筆尖貼著這一條（中文＋原文）整塊的上緣、x 在剛劃到的地方，筆身往右上伸出去（不跨過任何一行字）
    if (pen) this.drawMarker(c, penOnEdge(TX + pen.x, lyricBlock(TX, y, lay, subL), 'top'), pen.lift, inK);
  }

  /** 螢光筆（筆尖在原點、沿 ang 畫）：斜切的筆頭、深色筆桿、一道反光；lift 越大越往上抬、越淡。 */
  private drawMarker(c: CanvasRenderingContext2D, p: { x: number; y: number; ang: number }, lift: number, a: number) {
    c.save();
    c.globalAlpha = a * (1 - lift);
    c.translate(p.x + Math.cos(p.ang) * 12 * lift, p.y + Math.sin(p.ang) * 12 * lift);
    c.rotate(p.ang);
    c.fillStyle = mixRgba('signal', 'blood', 0.2, 1);
    c.beginPath(); c.moveTo(0, -6); c.lineTo(26, -14); c.lineTo(26, 14); c.lineTo(0, 10); c.closePath(); c.fill();
    c.fillStyle = rgba('sepia', 0.8);
    c.fillRect(26, -16, 150, 32);
    c.fillStyle = rgba('paper', 0.3);
    c.fillRect(30, -12, 140, 5);
    c.restore();
  }

  /** 上一條、下一條：小字的中文＋原文（一行放不下就截在頁邊）。 */
  private smallEntry(c: CanvasRenderingContext2D, line: Line, y: number, a: number) {
    c.save();
    c.globalAlpha *= a;
    this.badge(c, line.i + 1, y - 9, 0.62);
    // 放不下就縮小（最小 18），還是放不下就截斷加「…」，不要被頁邊切掉半個字
    const fitTxt = (txt: string, fam: string, max: number) => {
      const sz = clamp(Math.floor((max * TW) / Math.max(1, measure(txt, fam, max))), 18, max);
      let out = txt;
      while (out.length > 1 && measure(out, fam, sz) > TW) out = Array.from(out).slice(0, -2).join('') + '…';
      return { sz, out };
    };
    const a1 = fitTxt(line.text, ZH_FAM, 26);
    c.font = font(ZH_FAM, a1.sz); c.fillStyle = rgba('sepia', 0.9);
    c.fillText(a1.out, TX, y);
    const sub = lyricSubOf(line);
    if (sub) { const a2 = fitTxt(sub.text, SUB_FAM, 20); c.font = font(SUB_FAM, a2.sz); c.fillStyle = rgba('sepia', 0.75); c.fillText(a2.out, TX, y + 30); }
    c.restore();
  }

  /** 編號圓章＋小喇叭。 */
  private badge(c: CanvasRenderingContext2D, n: number, cy: number, k: number) {
    const r = 17 * k;
    c.save();
    c.fillStyle = mixRgba('signal', 'blood', 0.55, 0.9);
    c.beginPath(); c.arc(BADGE_X, cy, r, 0, TAU); c.fill();
    c.font = font(F.mono(600), Math.round(15 * k)); c.fillStyle = rgba('paper', 0.97); c.textAlign = 'center';
    c.fillText(String(n).padStart(2, '0'), BADGE_X, cy + 5 * k);
    c.restore();
  }

  /**
   * 螢光筆：每一拍往前劃一段，追上那一拍時唱到的位置（落在拍點、0.16 秒劃完）；一句唱完整句劃滿。
   * 螢光筆只追在歌聲後面，字的顏色照舊是字自己的時間。
   */
  private highlight(c: CanvasRenderingContext2D, line: Line, lay: LyricLayout, t: number): { x: number; lift: number } | null {
    const au = this.ctx.audio;
    // 這一拍、上一拍時唱到哪裡（整句的字數比例 → 每一排劃到的寬度）
    const bi = Math.floor(au.beatAt(t) + 1e-4);
    const tb = au.timeOfBeat(bi), tp = au.timeOfBeat(bi - 1);
    const at = (tt: number) => (tt >= line.end ? Infinity : tt);
    const q = ease.outCubic(clamp((t - tb) / 0.16));
    const ext = (tt: number) => lay.words.map((pw) => ({ pw, p: Lyrics.wordProgress(pw.word, at(tt)) }));
    const e0 = ext(tp), e1 = ext(t >= line.end ? Infinity : tb);
    const col = mixRgba('signal', 'ember', 0.35, 0.42);
    c.save();
    c.fillStyle = col;
    const rows = new Map<number, { x0: number; x1: number }>();
    e1.forEach(({ pw, p }, i) => {
      const p0 = e0[i]!.p;
      const pp = lerp(p0, p, q);
      if (pp <= 0) return;
      const r = rows.get(pw.y) ?? { x0: pw.x, x1: pw.x };
      r.x1 = Math.max(r.x1, pw.x + pw.w * pp);
      rows.set(pw.y, r);
    });
    for (const [y, r] of rows) {
      // 螢光筆的筆畫：粗、邊緣有一點不齊、兩端斜斜的
      const top = y - lay.size * 0.78, bot = y + lay.size * 0.16;
      c.beginPath();
      c.moveTo(r.x0 - 8, bot);
      for (let x = r.x0 - 4; x <= r.x1; x += 24) c.lineTo(x, top + 3 * Math.sin(x * 0.07 + line.i + hash(line.i, 3) * 6));
      c.lineTo(r.x1 + 6, top + 2);
      c.lineTo(r.x1 - 2, bot);
      c.closePath();
      c.fill();
    }
    c.restore();
    // 筆：劃的那 0.3 秒看得到（x 在剛劃到的地方），之後抬走；位置交給 drawEntries 照 penOnEdge 放
    const last = [...rows.values()].pop();
    const lift = clamp((t - tb) / 0.3);
    return last && t < line.end + 0.3 && lift < 1 ? { x: last.x1 + 4, lift } : null;
  }

  /** 純音樂：每兩小節一條冷面會話（只有中文），螢光筆在拍點照樣劃過。 */
  private drawInst(c: CanvasRenderingContext2D, t: number) {
    const e = this.inst.find((x) => t >= x.t0 && t < x.t1) ?? this.inst[this.inst.length - 1];
    if (!e) return;
    const txt = INST_PHRASES[e.j % INST_PHRASES.length]!;
    const size = 46;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.1, this.ctx.start + 0.45);
    const prevTxt = e.j > 0 ? INST_PHRASES[(e.j - 1) % INST_PHRASES.length]! : null;
    if (prevTxt) { this.badge(c, e.j, PREV_Y - 9, 0.62); c.font = font(ZH_FAM, 26); c.fillStyle = rgba('sepia', 0.5); c.fillText(prevTxt, TX, PREV_Y); }
    this.badge(c, e.j + 1, CUR_Y - size * 0.36, 1);
    const w = measure(txt, ZH_FAM, size);
    // 螢光筆：從這一條開始的那一拍起，每拍劃一段，兩拍劃完
    const au = this.ctx.audio;
    const k = clamp((au.beatAt(t) - au.beatAt(e.t0)) / 2);
    const kq = Math.floor(k * 2) / 2 + ease.outCubic(clamp(((k * 2) % 1) / 0.35)) / 2 * (k < 1 ? 1 : 0);
    c.fillStyle = mixRgba('signal', 'ember', 0.35, 0.42);
    c.fillRect(TX - 6, CUR_Y - size * 0.78, (w + 12) * clamp(kq), size * 0.94);
    c.font = font(ZH_FAM, size); c.fillStyle = rgba('sepia', 0.9);
    c.fillText(txt, TX, CUR_Y);
    c.font = font(F.mono(400), 17); c.fillStyle = rgba('sepia', 0.45);
    c.fillText(`♪ ${this.ctx.song.title}`, TX, CUR_Y + 52);
    c.restore();
  }

  /** 插圖裡的燈泡：每一拍輪到一顆亮（訊號色），其他暗暗的。 */
  private drawBulbs(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const b = Math.floor(au.beatAt(t));
    const bp = au.beatAt(t) - b;
    let k = 0;
    c.save();
    for (const [a, z] of this.wires()) {
      for (let i = 1; i < 7; i++, k++) {
        const q = i / 7;
        const x = lerp(a[0], z[0], q), y = lerp(a[1], z[1], q) + 26 * Math.sin(Math.PI * q) + 7;
        const on = ((k + b) % 4 === 0) && t > this.b0 ? Math.exp(-bp * 2.5) : 0;
        c.fillStyle = mixRgba(mixRgba('paper', 'sepia', 0.25), 'signal', 0.35 + 0.65 * on, 1);
        c.beginPath(); c.arc(x, y, 5, 0, TAU); c.fill();
        if (on > 0.05) { c.fillStyle = rgba('signal', 0.18 * on); c.beginPath(); c.arc(x, y, 15, 0, TAU); c.fill(); }
      }
    }
    c.restore();
  }

  /** 右頁上緣的三張便利貼書籤：每個小節線被風掀一下（彈簧）。 */
  private drawTabs(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const bi = Math.floor(au.barAt(t) + 1e-4), tb = au.timeOfBar(bi), age = t - tb;
    const gust = tb >= this.b0 - 0.01 ? Math.exp(-age * 3.5) * Math.sin(age * 16) : 0;
    const cols = [mixRgba('signal', 'paper', 0.3, 1), mixRgba('rose', 'paper', 0.35, 1), mixRgba('ash', 'paper', 0.3, 1)];
    c.save();
    [1240, 1330, 1420].forEach((x, i) => {
      const lift = gust * (0.6 + 0.25 * i);
      c.save();
      c.translate(x, BK.y0 + 26);
      // 黏在頁面上的那一段不動，露出書外的那一段往上掀（y 方向縮短＝翹起來）
      c.fillStyle = cols[i]!;
      c.fillRect(0, 0, 58, 44);
      c.fillStyle = rgba('ink', 0.08 * (1 + lift));
      c.fillRect(2, -2, 58, 3);
      const hh = 46 * (1 - 0.35 * Math.max(0, lift)) + 6 * Math.max(0, -lift);
      c.fillStyle = cols[i]!;
      c.fillRect(0, -hh, 58, hh);
      c.fillStyle = rgba('paper', 0.25 * Math.max(0, lift));
      c.fillRect(0, -hh, 58, hh * 0.4);
      c.restore();
    });
    c.restore();
  }

  /** 地圖上的路線：訊號色虛線慢慢往前走（虛線往前流），終點的定位針每個小節線彈一下。 */
  private drawRoute(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const pts: [number, number][] = [[124, 150], [206, 136], [246, 236], [186, 330], [258, 420], [210, 500]];
    const lt = t - this.ctx.start;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start, this.ctx.start + 0.4);
    c.strokeStyle = mixRgba('signal', 'blood', 0.5, 0.85); c.lineWidth = 4; c.lineCap = 'round'; c.lineJoin = 'round';
    c.setLineDash([2, 13]);
    c.lineDashOffset = -lt * 26;
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.stroke();
    c.setLineDash([]);
    // 起點的小圓圈、終點的定位針（小節線彈一下）
    c.strokeStyle = mixRgba('signal', 'blood', 0.5, 0.9); c.lineWidth = 3;
    c.beginPath(); c.arc(pts[0]![0], pts[0]![1], 9, 0, TAU); c.stroke();
    const bi = Math.floor(au.barAt(t) + 1e-4), age = t - au.timeOfBar(bi);
    const hop = t > this.b0 ? Math.max(0, Math.sin(clamp(age / 0.35) * Math.PI)) * 18 : 0;
    const [ex, ey] = pts[pts.length - 1]!;
    c.fillStyle = rgba('ink', 0.15);
    c.beginPath(); c.ellipse(ex, ey + 2, 10 - hop * 0.2, 4, 0, 0, TAU); c.fill();
    c.translate(ex, ey - hop);
    c.fillStyle = mixRgba('signal', 'blood', 0.35, 1);
    c.beginPath(); c.moveTo(0, 0); c.bezierCurveTo(-16, -22, -16, -40, 0, -40); c.bezierCurveTo(16, -40, 16, -22, 0, 0); c.fill();
    c.fillStyle = rgba('paper', 0.95);
    c.beginPath(); c.arc(0, -27, 6, 0, TAU); c.fill();
    c.restore();
  }
}
