// 專輯歌詞本（暗，雙語版面）：夜裡的桌上，一盞檯燈照著一本攤開的 CD 歌詞本（黑底印白字的設計），旁邊一張 CD 在轉，
// 下面一張封底內頁「THANKS TO」。
//  - 歌詞本左頁印原文、右頁印中文（左右對照），一頁排三、四句；檯燈的光落在正在唱的那一句上（左右兩頁同一排一起亮），
//    換句時光圈滑到下一排。中文 46～52、原文約中文的 0.65 倍，兩行各照自己的逐字時間亮（原文比較安靜，不用訊號色）。
//    一頁唱完就翻頁（右頁翻過去、露出下一頁）。
//  - 沒翻譯的歌：左頁是專輯的封面插畫（版畫的放射線與同心圓）＋小小的歌名，右頁印歌詞。純音樂：右頁是演奏者名單，光一排一排掃過。
//  - 左上一張 CD 在轉（一小節一圈），印著「ALAN & OMENA · SIDE A」；每個小節線光在碟面上閃一下。
//  - 主打留言印在封底內頁的「THANKS TO」上（思源宋體，像專輯的致謝），署名在最後一行下面；一行一行浮出來。
// 畫法：桌面與燈光是一個 shader，畫一次存起來；歌詞本的紙、CD 盒、封底內頁畫一次在一張 Canvas2D；
// CD（旋轉）、光圈、歌詞、留言每格畫在另一張；翻頁用每頁畫一次就好的小畫布。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, makeRT } from '../engine/gl';
import { F, font, loadText, measure } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, TAU } from '../engine/util';
import type { FitResult } from '../engine/text';
import { lyricSubOf, type Line } from '../engine/lyrics';
import { lyricAt, layoutLyric, drawLyric, drawMessage, beatAfter, barAfter, subSizeFor, drawHeart, COUPLE_EN, DATE_DOTS, type LyricStyle, type LyricLayout } from './_motifs';
import { lyricV2, sigV2, msgMaxFor, V2 } from './_v2';
import { fitMsgB2, sigOf, windowLines, linesText, mainOnly, INVITE, B2_SYMBOLS, no3, offCanvas, type Rect } from './_b2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'print', paper: false, energy: [0.1, 0.7], bars: [4, 8] };

/** 歌詞本：左右兩頁、中縫。 */
const BK = { x0: 650, x1: 1800, y0: 90, y1: 680, g: 1225 };
const PW = BK.g - BK.x0;
/** 頁面裡字的邊距、可用寬、排字的上下範圍。 */
const MX = 46, TWL = PW - MX * 2, TWR = PW - MX * 2;
/** 排字的範圍（相對頁面上緣）：頁首線下面到頁碼上面。 */
const TOP = 112, BOT = 530;
/** CD：中心、半徑。 */
const CD = { x: 372, y: 336, r: 222 };
/** 封底內頁（THANKS TO）。 */
const TC = { x: 150, y: 626, w: 790, h: 366 };
const TC_TEXT = { x: 46, y: 88, w: 698, h: 250 };
const ZH_FAM = F.hei(700);
const SUB_FAM = F.hei(500);
const MSG_FAM = F.ming(700);
const SIG_FAM = F.hand(400);
const NO_MSG = '把你的名字也寫進致謝名單：掃描右下角 QR code。';
const CREDITS = ['演奏　今晚的樂手', '錄音　婚禮現場', '混音　大家的笑聲', '特別感謝　每一位來賓'];

const DESK = /* glsl */ `
void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  // 深色的石板桌面：很細的顆粒、幾道淡淡的紋
  float g = fbm(p / 380.0, 3), fine = hash12(floor(p / 2.0));
  vec3 desk = mix(C_INK, C_INK2, 0.6 + 0.4 * g) * (0.96 + 0.08 * fine);
  // 檯燈：暖暖的一大圈光落在歌詞本上（右上），往左下慢慢暗掉
  float d = length((p - vec2(1180.0, 330.0)) / vec2(1.15, 1.0));
  float pool = exp(-d * d / (2.0 * 620.0 * 620.0));
  desk += mix(C_BLOOD, C_SIGNAL, 0.25) * 0.09 * pool + C_BONE * 0.015 * pool;
  // 右下角 HUD 那一塊壓暗一點
  float hud = smoothstep(1300.0, 1420.0, p.x) * smoothstep(780.0, 870.0, p.y);
  desk *= 1.0 - 0.25 * hud;
  fragColor = vec4(desk, 1.0);
}`;
const BG = () => new FSPass(DESK);

interface Ent { line: Line; zh: LyricLayout; sub: LyricLayout | null; y: number; h: number }
interface Page { ents: Ent[]; t0: number }

export default class Lyricbook extends Scene {
  bg = shared('lyricbook.bg', BG);
  bgRT = this.track(makeRT(W, H, { depthBuffer: false }));
  bgReady = false;
  base = this.track(new Layer2D(W, H, undefined, { fast: true }));
  live = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  b0 = 0;
  fit: FitResult | null = null;
  msgTop = 0;
  sig: { text: string; x: number; y: number; size: number } | null = null;
  lyrSize = 52;
  stZh!: LyricStyle;
  stSub!: LyricStyle;
  pages: Page[] = [];
  /** 這一格有沒有原文（有翻譯的歌）：沒有的話左頁是封面插畫。 */
  bi = false;
  /** 每一頁的左右兩面（翻頁時用）：唱完的樣子、還沒唱的樣子。 */
  snaps = new Map<string, HTMLCanvasElement>();
  label: HTMLCanvasElement | null = null;
  art: HTMLCanvasElement | null = null;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.b0 = beatAfter(au, s + 0.05);
    const lines = windowLines(lyrics, s - 6, e + 6);
    const text = m ? m.text : NO_MSG;
    const sigText = m ? sigOf(m) : '';
    await loadText(text + sigText + NO_MSG + INVITE + CREDITS.join('') + song.title + song.artist + linesText(lines) + COUPLE_EN + DATE_DOTS
      + 'THANKSTOSIDEALYRICSORIGINAL中文翻譯歌詞原文TRACK本曲為演奏曲' + B2_SYMBOLS);

    // ---- 留言（封底內頁）
    const c = this.live.ctx;
    const reserve = m ? sigV2(msgMaxFor(text)) + 22 : 0;
    this.fit = fitMsgB2(c, text, MSG_FAM, TC_TEXT.w, TC_TEXT.h - reserve, { lineHeight: 1.36, maxLines: 5, max: m ? undefined : 32, min: m ? undefined : 28 });
    const fit = this.fit;
    this.lyrSize = lyricV2(m ? fit.size : null);
    const ss = sigV2(fit.size);
    const blockH = fit.height + (m ? fit.size * 0.3 + ss * 1.2 : 0);
    this.msgTop = TC.y + TC_TEXT.y + Math.max(0, (TC_TEXT.h - blockH) / 2) + fit.size * 0.88;
    if (m) {
      const sw = measure(sigText, SIG_FAM, ss);
      const lastY = this.msgTop + (fit.lines.length - 1) * fit.lineHeight;
      this.sig = { text: sigText, x: TC.x + TC_TEXT.x + Math.max(fit.width, sw + 60) - sw, y: lastY + fit.size * 0.3 + ss * 1.1, size: ss };
    }

    // ---- 歌詞排頁：右頁中文、左頁原文，同一句同一排（高度取兩邊比較高的那邊）
    this.bi = lines.some((l) => !!lyricSubOf(l));
    this.stZh = { family: ZH_FAM, size: this.lyrSize, minSize: V2.lyrMin, maxWidth: TWR, align: 'left', lineHeight: 1.16, active: rgba('signal'), sung: rgba('bone', 0.95), unsung: rgba('bone', 0.26) };
    const subSize = subSizeFor(this.lyrSize);
    // 原文在自己的一頁：比較安靜，唱到、唱完都用紙白（不用訊號色）
    this.stSub = { family: SUB_FAM, size: subSize, minSize: Math.min(subSize, 30), maxWidth: TWL, align: 'left', lineHeight: 1.2, active: rgba('bone', 0.92), sung: rgba('bone', 0.8), unsung: rgba('bone', 0.24) };
    let page: Page | null = null, y = 0;
    for (const line of lyrics.has ? lines : []) {
      const zh = mainOnly(layoutLyric(c, line, this.stZh));
      const sl = lyricSubOf(line);
      const sub = sl ? layoutLyric(c, sl, this.stSub) : null;
      const hz = zh.size + (zh.rows.length - 1) * zh.size * 1.16;
      const hs = sub ? sub.size + (sub.rows.length - 1) * sub.size * 1.2 : 0;
      const h = Math.max(hz, hs) + 34;
      if (!page || y + h > BOT - TOP) { page = { ents: [], t0: line.start }; this.pages.push(page); y = 0; }
      page.ents.push({ line, zh, sub, y, h });
      y += h;
    }
    // 每一頁的內容在頁面裡垂直置中一點（頁少的時候不要全擠在上面）
    for (const pg of this.pages) {
      const tot = pg.ents.reduce((a, en) => a + en.h, 0);
      const off = Math.max(0, (BOT - TOP - tot) * 0.35);
      for (const en of pg.ents) en.y += off;
    }
    this.label = this.makeLabel();
    if (!this.bi) this.art = this.makeArt();
    this.drawBase();
    this.avoid = [[TC.x - 10, TC.y - 10, TC.w + 20, TC.h + 20], [BK.x0, BK.y0, BK.x1 - BK.x0, BK.y1 - BK.y0]];
    void e;
  }

  /** 黑底的歌詞本頁面：印刷的細線框、頁首的小字、頁碼；檯燈照的地方亮一點。 */
  private pagePaper(c: CanvasRenderingContext2D, x: number, left: boolean, pn: number) {
    c.fillStyle = mixRgba('ink2', 'graphite', 0.18, 1);
    c.fillRect(x, BK.y0, PW, BK.y1 - BK.y0);
    // 燈光：紙面上一大圈暖光（中心在書的中間偏上）
    const g = c.createRadialGradient(BK.g, 300, 40, BK.g, 300, 760);
    g.addColorStop(0, mixRgba('signal', 'bone', 0.4, 0.09)); g.addColorStop(1, rgba('ink', 0));
    c.fillStyle = g; c.fillRect(x, BK.y0, PW, BK.y1 - BK.y0);
    // 中縫：往中縫暗下去
    const gg = c.createLinearGradient(left ? x + PW - 70 : x + 70, 0, left ? x + PW : x, 0);
    gg.addColorStop(0, rgba('ink', 0)); gg.addColorStop(1, rgba('ink', 0.55));
    c.fillStyle = gg; c.fillRect(left ? x + PW - 70 : x, BK.y0, 70, BK.y1 - BK.y0);
    // 印刷：細框、頁首、頁碼
    c.strokeStyle = rgba('bone', 0.14); c.lineWidth = 1;
    c.strokeRect(x + 22, BK.y0 + 22, PW - 44, BK.y1 - BK.y0 - 44);
    c.font = font(F.mono(500), 13); c.letterSpacing = '4px'; c.fillStyle = rgba('bone', 0.42);
    const head = left ? (this.bi ? 'ORIGINAL · 原文' : 'SIDE A') : (this.bi ? '中文翻譯 · LYRICS' : 'LYRICS · 歌詞');
    c.fillText(head, x + MX, BK.y0 + 64);
    c.fillText(String(pn).padStart(2, '0'), left ? x + MX : x + PW - MX - 26, BK.y1 - 42);
    c.letterSpacing = '0px';
    c.strokeStyle = rgba('bone', 0.2);
    c.beginPath(); c.moveTo(x + MX, BK.y0 + 80); c.lineTo(x + PW - MX, BK.y0 + 80); c.stroke();
  }

  /** 印好的：歌詞本（影子、兩頁）、CD 盒、封底內頁（紙、框、THANKS TO、編號）。 */
  private drawBase() {
    const c = this.base.ctx;
    c.save();
    c.filter = 'blur(16px)';
    c.fillStyle = rgba('ink', 0.7);
    c.fillRect(BK.x0 + 8, BK.y0 + 18, BK.x1 - BK.x0, BK.y1 - BK.y0);
    c.fillRect(TC.x + 8, TC.y + 14, TC.w, TC.h);
    c.fillRect(CD.x - 262 + 8, CD.y - 250 + 14, 524, 500);
    c.restore();
    // CD 盒：透明塑膠的殼（細亮邊）、黑色的托盤、中間的齒輪卡榫
    c.fillStyle = mixRgba('ink2', 'ink', 0.4, 1);
    c.beginPath(); c.roundRect(CD.x - 262, CD.y - 250, 524, 500, 8); c.fill();
    c.strokeStyle = rgba('bone', 0.22); c.lineWidth = 1.4; c.stroke();
    c.strokeStyle = rgba('bone', 0.08);
    c.beginPath(); c.roundRect(CD.x - 250, CD.y - 238, 500, 476, 6); c.stroke();
    // 封底內頁
    c.fillStyle = mixRgba('ink2', 'graphite', 0.22, 1);
    c.fillRect(TC.x, TC.y, TC.w, TC.h);
    c.strokeStyle = rgba('bone', 0.16); c.lineWidth = 1;
    c.strokeRect(TC.x + 18, TC.y + 18, TC.w - 36, TC.h - 36);
    c.font = font(F.mono(600), 15); c.letterSpacing = '6px'; c.fillStyle = rgba('bone', 0.55);
    c.fillText('THANKS TO', TC.x + TC_TEXT.x, TC.y + 58);
    c.letterSpacing = '3px'; c.font = font(F.mono(500), 13); c.fillStyle = rgba('bone', 0.35);
    const no = this.msg ? no3(this.msg.n) : '';
    if (no) c.fillText(no, TC.x + TC.w - 46 - measure(no, F.mono(500), 13) - 12, TC.y + 58);
    c.letterSpacing = '0px';
    c.fillStyle = rgba('signal', 0.7);
    c.fillRect(TC.x + TC_TEXT.x, TC.y + 70, 38, 2);
    // 歌詞本：頁邊的厚度（下緣一層層）、兩頁
    for (let i = 4; i >= 1; i--) { c.fillStyle = mixRgba('ink2', 'graphite', 0.1 + 0.05 * i, 1); c.fillRect(BK.x0 + 2, BK.y0 + i * 2, BK.x1 - BK.x0 - 4, BK.y1 - BK.y0); }
    this.pagePaper(c, BK.x0, true, 6);
    this.pagePaper(c, BK.g, false, 7);
    c.fillStyle = rgba('ink', 0.8); c.fillRect(BK.g - 1, BK.y0, 2, BK.y1 - BK.y0);
    if (this.art) c.drawImage(this.art, BK.x0, BK.y0, PW, BK.y1 - BK.y0);
    c.restore();
    this.base.upload();
  }

  /** 沒翻譯的歌：左頁的封面插畫（版畫的放射線、同心圓，淡淡的訊號色）＋小小的歌名與歌手。 */
  private makeArt(): HTMLCanvasElement {
    const ph = BK.y1 - BK.y0;
    const { cv, c } = offCanvas(PW, ph);
    c.translate(-BK.x0, -BK.y0);
    this.pagePaper(c, BK.x0, true, 6);
    const cx = BK.x0 + PW / 2, cy = BK.y0 + 275;
    c.save();
    c.beginPath(); c.rect(BK.x0 + 40, BK.y0 + 100, PW - 80, 350); c.clip();
    c.strokeStyle = rgba('signal', 0.3); c.lineWidth = 1;
    c.beginPath();
    for (let i = 0; i < 72; i++) { const a = (i / 72) * TAU; c.moveTo(cx + Math.cos(a) * 60, cy + Math.sin(a) * 60); c.lineTo(cx + Math.cos(a) * 420, cy + Math.sin(a) * 420); }
    c.stroke();
    c.strokeStyle = rgba('bone', 0.2);
    for (let r = 40; r < 300; r += 22) { c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.stroke(); }
    c.fillStyle = mixRgba('signal', 'blood', 0.4, 0.8);
    c.beginPath(); c.arc(cx, cy, 34, 0, TAU); c.fill();
    c.restore();
    const title = this.ctx.song.title, artist = this.ctx.song.artist;
    c.font = font(F.serif(600, true), 22); c.fillStyle = rgba('bone', 0.75);
    // 歌名與歌手在插畫下面、頁碼上面
    c.fillText(title, BK.x0 + MX, BK.y0 + 490);
    c.font = font(F.mono(400), 14); c.fillStyle = rgba('bone', 0.4);
    c.fillText(artist, BK.x0 + MX, BK.y0 + 490 + 26);
    return cv;
  }

  /** CD 的印刷面（轉的時候整張轉）：深色的底、同心細線、一段訊號色的弧、沿著外圈的字、中心的透明圈與孔。 */
  private makeLabel(): HTMLCanvasElement {
    const R = CD.r, S = R * 2;
    const { cv, c } = offCanvas(S, S);
    c.translate(R, R);
    c.fillStyle = mixRgba('ink2', 'graphite', 0.25, 1);
    c.beginPath(); c.arc(0, 0, R, 0, TAU); c.fill();
    c.strokeStyle = rgba('bone', 0.1); c.lineWidth = 1;
    for (let r = 70; r < R - 30; r += 9) { c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke(); }
    c.strokeStyle = rgba('signal', 0.75); c.lineWidth = 5;
    c.beginPath(); c.arc(0, 0, R - 44, -0.4, 1.3); c.stroke();
    c.fillStyle = rgba('bone', 0.85);
    const ring = `${COUPLE_EN.toUpperCase()} · SIDE A · ${DATE_DOTS} · `;
    c.font = font(F.mono(500), 15);
    const chars = Array.from(ring + ring);
    const step = TAU / chars.length;
    chars.forEach((ch, i) => { c.save(); c.rotate(i * step); c.translate(0, -(R - 20)); c.fillText(ch, -4, 0); c.restore(); });
    drawHeart(c, 0, -(R - 80), 22, rgba('rose', 0.95));
    // 中心：透明的圈（看得到底下的托盤）、孔
    c.globalCompositeOperation = 'destination-out';
    c.beginPath(); c.arc(0, 0, 58, 0, TAU); c.fill();
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = rgba('bone', 0.1);
    c.beginPath(); c.arc(0, 0, 58, 0, TAU); c.arc(0, 0, 18, 0, TAU, true); c.fill();
    c.strokeStyle = rgba('bone', 0.3); c.lineWidth = 1;
    c.beginPath(); c.arc(0, 0, 58, 0, TAU); c.stroke();
    c.beginPath(); c.arc(0, 0, R - 0.5, 0, TAU); c.stroke();
    return cv;
  }

  /** 一頁的一面（翻頁用，畫一次）：左頁（原文或插畫）、右頁（中文），唱完或還沒唱的樣子。 */
  private snap(pi: number, side: 'L' | 'R', sung: boolean): HTMLCanvasElement {
    const key = `${pi}${side}${sung ? 1 : 0}`;
    const hit = this.snaps.get(key);
    if (hit) return hit;
    const ph = BK.y1 - BK.y0;
    const { cv, c } = offCanvas(PW, ph, 0.75);
    const x = side === 'L' ? BK.x0 : BK.g;
    c.translate(-x, -BK.y0);
    if (side === 'L' && this.art) c.drawImage(this.art, BK.x0, BK.y0, PW, ph);
    else {
      this.pagePaper(c, x, side === 'L', side === 'L' ? 6 + pi * 2 : 7 + pi * 2);
      const pg = this.pages[pi];
      if (pg) this.drawPage(c, pg, side, sung ? 1e9 : -1e9, null);
    }
    this.snaps.set(key, cv);
    return cv;
  }

  /** 一頁的字：每一句一排；正在唱的那一句亮、其他句淡一點。 */
  private drawPage(c: CanvasRenderingContext2D, pg: Page, side: 'L' | 'R', t: number, cur: Line | null) {
    for (const en of pg.ents) {
      const a = cur ? (en.line === cur ? 1 : 0.55) : 0.7;
      if (side === 'R') {
        c.save(); c.translate(BK.g + MX, BK.y0 + TOP + en.y + en.zh.size * 0.9);
        drawLyric(c, en.line, t, this.stZh, en.zh, a);
        c.restore();
      } else if (en.sub) {
        const sl = lyricSubOf(en.line)!;
        c.save(); c.translate(BK.x0 + MX, BK.y0 + TOP + en.y + en.zh.size * 0.9);
        drawLyric(c, sl, t, this.stSub, en.sub, a);
        c.restore();
      }
    }
  }

  /** 這一格在哪一頁、翻頁的進度（0 沒在翻；翻的時候是 0..1）。 */
  private pageAt(t: number): { pi: number; flip: number } {
    let pi = 0;
    for (let i = 1; i < this.pages.length; i++) if (this.pages[i]!.t0 - 0.55 <= t) pi = i;
    const t0 = this.pages[pi]?.t0 ?? 0;
    const flip = pi > 0 ? prog(t, t0 - 0.55, t0 - 0.08) : 1;
    return { pi, flip: flip >= 1 ? 0 : flip };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    if (!this.bgReady) { this.bg.render(renderer, this.bgRT); this.bgReady = true; }
    comp.draw(renderer, this.bgRT.texture, out, { mode: 'replace' });
    comp.draw(renderer, this.base.texture, out);

    const L = this.live;
    L.clear();
    const c = L.ctx;
    const inK = prog(t, s, s + 0.4, ease.outCubic);
    c.globalAlpha = inK;
    this.drawDisc(c, t, f.beat);
    if (lyrics.has) this.drawLyrics(c, t);
    else this.drawCredits(c, t);
    c.globalAlpha = 1;
    this.drawMessage(c, t);
    comp.draw(renderer, L.upload(), out);
    void au;

    // 鏡頭：先看歌詞本，留言浮出來之後往左下（THANKS TO）移；整個窗格慢慢推近
    // 推近與平移都收斂：右頁的字推近之後還要在安全範圍裡（離邊 96 px）
    const zoom = 1.015 + 0.028 * ease.inOutCubic(f.p);
    const roomX = (W - W / zoom) / 2, roomY = (H - H / zoom) / 2;
    const toMsg = this.msg ? ease.inOutCubic(prog(t, this.b0 + 1.6, this.b0 + 4.6)) : 0;
    return {
      popupAvoid: this.avoid, bloom: 0.55, vignette: 0.5, zoom,
      shake: [lerp(-0.5, 0.3, toMsg) * roomX, lerp(0.3, -0.5, toMsg) * roomY],
    };
  }

  /** 歌詞本：這一頁的字、檯燈落在正在唱的那一排的光、翻頁。 */
  private drawLyrics(c: CanvasRenderingContext2D, t: number) {
    const { lyrics } = this.ctx;
    const { pi, flip } = this.pageAt(t);
    const pg = this.pages[pi];
    if (!pg) return;
    const ly = lyricAt(lyrics, t, 30, 0.35);
    const cur = ly && pg.ents.some((en) => en.line === ly.line) ? ly.line : null;
    // 光圈：跟著正在唱的那一排，換句時滑過去（0.35 秒）
    const ci = cur ? pg.ents.findIndex((en) => en.line === cur) : -1;
    if (ci >= 0) {
      const en = pg.ents[ci]!, prev = pg.ents[ci - 1];
      const q = ease.inOutCubic(prog(t, cur!.start - 0.4, cur!.start - 0.05));
      const cy = (e: Ent) => BK.y0 + TOP + e.y + e.h / 2 - 12;
      const y = prev ? lerp(cy(prev), cy(en), q) : cy(en);
      const hh = en.h + 30;
      for (const x0 of [BK.x0, BK.g]) {
        if (x0 === BK.x0 && !this.bi) continue;
        const g = c.createRadialGradient(x0 + PW / 2, y, 10, x0 + PW / 2, y, PW * 0.62);
        g.addColorStop(0, mixRgba('signal', 'bone', 0.35, 0.12)); g.addColorStop(0.55, mixRgba('signal', 'bone', 0.35, 0.045)); g.addColorStop(1, rgba('signal', 0));
        c.save();
        c.translate(0, y); c.scale(1, hh / (PW * 0.9)); c.translate(0, -y);
        c.fillStyle = g; c.fillRect(x0 + 8, y - PW, PW - 16, PW * 2);
        c.restore();
      }
    }
    if (this.bi) this.drawPage(c, pg, 'L', t, cur);
    this.drawPage(c, pg, 'R', t, cur);
    // 翻頁：上一頁的右頁翻過去（越立越窄），翻過中縫之後是新一頁的左頁（還沒唱）
    if (flip > 0) {
      const th = Math.PI * ease.inOutCubic(flip), cs = Math.cos(th), lift = Math.sin(th);
      const ph = BK.y1 - BK.y0;
      // 翻開之前，底下是上一頁的左頁（左邊還蓋著）
      if (cs > 0) c.drawImage(this.snap(pi - 1, 'L', true), BK.x0, BK.y0, PW, ph);
      const w = PW * Math.abs(cs);
      const img = cs > 0 ? this.snap(pi - 1, 'R', true) : this.snap(pi, 'L', false);
      const x = cs > 0 ? BK.g : BK.g - w;
      c.save();
      c.fillStyle = rgba('ink', 0.4 * lift);
      c.fillRect(cs > 0 ? BK.g : BK.g - w - 40 * lift, BK.y0 + 10, w + 40 * lift, ph);
      c.drawImage(img, x, BK.y0 - 12 * lift, w, ph);
      c.fillStyle = rgba('bone', 0.06 * lift);
      c.fillRect(x, BK.y0 - 12 * lift, w, ph);
      c.restore();
    }
  }

  /** 純音樂：右頁是演奏者名單，光一排一排掃過（每小節一排）。 */
  private drawCredits(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const k = Math.max(0, au.barAt(t) - au.barAt(this.b0));
    const cur = Math.floor(k) % CREDITS.length;
    const q = ease.inOutCubic(clamp((k % 1) / 0.25));
    const rowY = (i: number) => BK.y0 + 250 + i * 86;
    const y = lerp(rowY((cur + CREDITS.length - 1) % CREDITS.length), rowY(cur), Math.floor(k) === 0 ? 1 : q);
    // 光圈：橫的橢圓（把圓形的漸層在 y 方向壓扁），邊緣是柔的
    const g = c.createRadialGradient(BK.g + PW / 2, y - 14, 10, BK.g + PW / 2, y - 14, PW * 0.62);
    g.addColorStop(0, mixRgba('signal', 'bone', 0.35, 0.12)); g.addColorStop(0.55, mixRgba('signal', 'bone', 0.35, 0.045)); g.addColorStop(1, rgba('signal', 0));
    c.save();
    c.translate(0, y - 14); c.scale(1, 110 / (PW * 0.9)); c.translate(0, -(y - 14));
    c.fillStyle = g; c.fillRect(BK.g + 8, y - 14 - PW, PW - 16, PW * 2);
    c.restore();
    c.save();
    c.font = font(F.mono(500), 17); c.letterSpacing = '4px'; c.fillStyle = rgba('bone', 0.45);
    c.fillText('本曲為演奏曲', BK.g + MX, BK.y0 + 150);
    c.letterSpacing = '0px';
    CREDITS.forEach((cr, i) => {
      c.font = font(ZH_FAM, 40);
      c.fillStyle = rgba('bone', i === cur ? 0.95 : 0.4);
      c.fillText(cr, BK.g + MX, rowY(i));
    });
    c.restore();
  }

  /** CD：一小節轉一圈；每個小節線光在碟面上閃一下（一道細細的反光）。 */
  private drawDisc(c: CanvasRenderingContext2D, t: number, beat: number) {
    const au = this.ctx.audio;
    if (!this.label) return;
    const a = (beat / 4) * TAU;
    c.save();
    c.translate(CD.x, CD.y);
    // 托盤中心的卡榫（從透明圈看得到）
    c.fillStyle = rgba('graphite', 0.8);
    for (let i = 0; i < 8; i++) { const aa = (i / 8) * TAU; c.beginPath(); c.arc(Math.cos(aa) * 30, Math.sin(aa) * 30, 5, 0, TAU); c.fill(); }
    c.save();
    c.rotate(a);
    c.drawImage(this.label, -CD.r, -CD.r, CD.r * 2, CD.r * 2);
    c.restore();
    // 反光：燈在右上，碟面上一道固定的斜光（不跟著轉）；小節線時亮一下
    const bi = Math.floor(au.barAt(t) + 1e-4), age = t - au.timeOfBar(bi);
    const glint = t > this.b0 ? Math.exp(-age * 4) : 0;
    c.globalCompositeOperation = 'lighter';
    c.beginPath(); c.arc(0, 0, CD.r - 1, 0, TAU); c.arc(0, 0, 58, 0, TAU, true); c.clip('evenodd');
    const g = c.createLinearGradient(-CD.r * 0.6, -CD.r, CD.r * 0.6, CD.r);
    g.addColorStop(0.36, rgba('bone', 0));
    g.addColorStop(0.46, rgba('bone', 0.05 + 0.18 * glint));
    g.addColorStop(0.5, mixRgba('ember', 'bone', 0.4, 0.08 + 0.3 * glint));
    g.addColorStop(0.56, rgba('bone', 0));
    c.fillStyle = g; c.fillRect(-CD.r, -CD.r, CD.r * 2, CD.r * 2);
    c.restore();
  }

  /** 封底內頁的致謝：一行一行浮出來，署名在最後一行下面。 */
  private drawMessage(c: CanvasRenderingContext2D, t: number) {
    const fit = this.fit;
    if (!fit) return;
    const t0 = this.b0 + 0.1;
    c.save();
    fit.lines.forEach((ln, i) => {
      const a = prog(t, t0 + i * 0.22, t0 + i * 0.22 + 0.45, ease.outCubic);
      if (a <= 0) return;
      c.globalAlpha = a;
      drawMessage(c, { ...fit, lines: [ln] }, MSG_FAM, TC.x + TC_TEXT.x, this.msgTop + i * fit.lineHeight + (1 - a) * 8, { color: rgba('bone', this.msg ? 0.95 : 0.6) });
    });
    if (this.sig) {
      const ts = t0 + fit.lines.length * 0.22 + 0.3;
      c.globalAlpha = prog(t, ts, ts + 0.4);
      c.font = font(SIG_FAM, this.sig.size); c.fillStyle = rgba('signal', 0.9);
      c.fillText(this.sig.text, this.sig.x, this.sig.y);
    }
    if (this.msg?.couple) {
      c.globalAlpha = prog(t, t0, t0 + 0.3);
      c.font = font(F.mono(500), 13); c.letterSpacing = '4px'; c.fillStyle = rgba('signal', 0.85);
      c.fillText('FROM THE COUPLE · 新人', TC.x + TC_TEXT.x + 170, TC.y + 58);
    }
    c.restore();
  }
}
