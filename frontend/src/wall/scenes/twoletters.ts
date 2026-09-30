// 情書與譯本（亮，雙語版面）：亞麻桌布上並排兩封信——左邊是寄來的航空信（薄薄的航空信紙、紅藍斜紋的邊），寫的是原文；
// 右邊是米色信紙上的中文譯本。一句歌詞就是信裡的一句話，兩封信同一排對照。
//  - 每一句先用鉛筆打好草稿（中灰、讀得到整句），唱到的字被鋼筆一個一個描成墨（剛寫的墨是濕的訊號色、乾了變墨色）；
//    兩支鋼筆同時在兩張紙上寫，筆尖跟著各自的字走（原文跟原文的時間、中文跟中文的時間），筆身躺在這一句下面的空裡，不蓋到字。
//  - 譯本的右邊留一欄給鉛筆：一句寫完，有時候會多一條鉛筆的波浪底線和一句冷面的譯註（「語氣再溫柔一點」「原文更可愛」）。
//  - 一頁寫滿，舊的兩張信紙被推到一旁，底下是新的一張。
//  - 主打留言是信封背面的附言「P.S.」（手寫字、署名在最後一行下面），第一個拍點右邊的封蠟「咚」地蓋上。
//  - 沒翻譯的歌：航空信收起來，只剩一封中文信（放在中間）。純音樂：信裡一拍寫一個字，寫一封短短的信。
// 畫法：桌布是一個 shader，畫一次存起來；信紙、信封的紙畫一次存成小畫布；字、鋼筆、鉛筆註、封蠟每格畫在一張 Canvas2D。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, makeRT } from '../engine/gl';
import { F, font, layout, loadText, measure } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash, TAU } from '../engine/util';
import type { FitResult } from '../engine/text';
import { Lyrics, lyricSubOf, type Line } from '../engine/lyrics';
import { lyricAt, layoutLyric, drawLyric, beatAfter, subSizeFor, COUPLE_ZH, type LyricStyle, type LyricLayout } from './_motifs';
import { lyricV2, sigV2, msgMaxFor, V2 } from './_v2';
import { fitMsgB2, sigOf, windowLines, linesText, inkSignal, mainOnly, lyricBlock, penOnEdge, INVITE, B2_SYMBOLS, no3, offCanvas, type Rect } from './_b2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'print', paper: true, energy: [0.1, 0.65], bars: [4, 8] };

type Sheet = { x: number; y: number; w: number; h: number };
/** 航空信（原文）與譯本（中文）。沒翻譯的歌只有一封中文信，放中間。 */
const AIR: Sheet = { x: 128, y: 54, w: 640, h: 588 };
const ZH2: Sheet = { x: 812, y: 44, w: 900, h: 606 };
const ZH1: Sheet = { x: 420, y: 44, w: 900, h: 606 };
/** 信紙裡排字的上緣、下緣（相對信紙）、左右邊距；譯本右邊留一欄給鉛筆的譯註。 */
const TOP = 132, BOT = 560, MX = 54, NOTE_W = 176;
/** 信封（背面朝上，封口打開往上翻）。 */
const ENV = { x: 262, y: 676, w: 830, h: 318, flap: 84 };
const PS_TEXT = { x: 64, y: 70, w: 640, h: 214 };
const ZH_FAM = F.hand(700);
const SUB_FAM = F.hand(700);
const MSG_FAM = F.hand(700);
const SIG_FAM = F.hand(400);
const NO_MSG = '信封背面還空著，掃描右下角 QR code，寫一句附言給新人。';
/** 鉛筆的譯註（冷面、溫柔）：一句寫完之後，有時候寫在譯本右邊。 */
const NOTES: string[][] = [['語氣再', '溫柔一點'], ['原文', '更可愛'], ['這句', '押韻了！'], ['直譯太硬', '改意譯'], ['念起來', '很順 ✓'], ['這裡要', '慢慢讀']];
/** 沒翻譯的歌（只有一封信）：不提原文的註。 */
const NOTES1: string[][] = [['寫得', '真好'], ['這句', '押韻了！'], ['念起來', '很順 ✓'], ['這裡要', '慢慢讀'], ['字再', '大一點']];
/** 純音樂：一拍寫一個字的短信。 */
const INST_LETTER = ['今天這首歌沒有歌詞，', '那就寫一封短短的信：', '祝你們，', '一直一直幸福。'];

const LINEN = /* glsl */ `
void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  // 亞麻：經緯兩個方向的細紋，粗細不均（每一條線的粗細用雜訊）
  float wx = 0.5 + 0.5 * sin(p.x * 1.9 + 3.0 * snoise(vec2(p.x / 40.0, p.y / 400.0)));
  float wy = 0.5 + 0.5 * sin(p.y * 1.9 + 3.0 * snoise(vec2(p.x / 400.0, p.y / 40.0)));
  float slub = snoise(vec2(p.x / 6.0, p.y / 180.0)) * 0.5 + snoise(vec2(p.x / 180.0, p.y / 6.0)) * 0.5;
  vec3 cloth = mix(C_PAPER, mix(C_ASH, C_SIGNAL, 0.12), 0.22) * (0.955 + 0.03 * wx + 0.03 * wy + 0.02 * slub);
  // 窗光：左上方來的柔光，右下暗一點；右下角 HUD 那一塊乾淨一點
  cloth *= 0.93 + 0.1 * smoothstep(2000.0, 300.0, p.x * 0.7 + p.y);
  float hud = smoothstep(1300.0, 1420.0, p.x) * smoothstep(780.0, 870.0, p.y);
  cloth = mix(cloth, mix(C_PAPER, C_ASH, 0.15), hud * 0.5);
  fragColor = vec4(cloth, 1.0);
}`;
const BG = () => new FSPass(LINEN);

interface Ent { line: Line; zh: LyricLayout; sub: LyricLayout | null; y: number; h: number }
interface Page { ents: Ent[]; t0: number }
interface Glyph { ch: string; x: number; y: number; t: number }
/** 鋼筆：筆尖位置、筆身方向、不透明度（淡入淡出）。 */
interface Pen { x: number; y: number; ang: number; a: number }
/** 譯本的筆往右、航空信的筆往左，都幾乎是平的（躺在兩句之間的空裡）。 */
const PEN_R = 0.05, PEN_L = Math.PI - 0.05;
/** 還沒描墨的鉛筆草稿：中灰鉛筆、0.55（2026-09-30 主導者：草稿要能先讀到整句）。 */
const PENCIL = mixRgba('graphite', 'ash', 0.3, 0.55);

export default class Twoletters extends Scene {
  bg = shared('twoletters.bg', BG);
  bgRT = this.track(makeRT(W, H, { depthBuffer: false }));
  bgReady = false;
  /** 信封與信紙的紙（進場落定之後都不動）：畫一次；進場那 0.45 秒才每格畫在 live。 */
  base = this.track(new Layer2D(W, H, undefined, { fast: true }));
  live = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 41 + (this.msg?.id ?? 0) * 19) >>> 0;
  b0 = 0;
  beat = 0.5;
  fit: FitResult | null = null;
  psGlyphs: Glyph[] = [];
  sig: { text: string; x: number; y: number; size: number; t: number } | null = null;
  lyrSize = 50;
  stZh!: LyricStyle;
  stSub!: LyricStyle;
  pages: Page[] = [];
  bi = false;
  zh: Sheet = ZH2;
  /** 信紙、信封的紙（畫一次）。 */
  airPaper: HTMLCanvasElement | null = null;
  zhPaper: HTMLCanvasElement | null = null;
  envPaper: HTMLCanvasElement | null = null;
  shadowCv: HTMLCanvasElement | null = null;
  /** 舊的一頁（推到一旁用）：每頁每張一張小畫布。 */
  snaps = new Map<string, HTMLCanvasElement>();
  /** 純音樂：信裡每個字寫下去的時間（一拍一字）。 */
  instG: Glyph[] = [];
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.b0 = beatAfter(au, s + 0.05);
    this.beat = clamp(au.beatPeriod(this.b0), 0.25, 1.2);
    const lines = windowLines(lyrics, s - 6, e + 4);
    const text = m ? m.text : NO_MSG;
    const sigText = m ? sigOf(m) : '';
    await loadText(text + sigText + NO_MSG + INVITE + [...NOTES, ...NOTES1].flat().join('') + INST_LETTER.join('') + song.title + song.artist + linesText(lines) + COUPLE_ZH
      + 'P.S.PARAVIONAIRMAIL航空給譯本原文A&O第頁' + B2_SYMBOLS);

    // ---- 信封背面的附言（逐字寫）
    const c = this.live.ctx;
    const reserve = m ? sigV2(msgMaxFor(text)) + 18 : 0;
    this.fit = fitMsgB2(c, text, MSG_FAM, PS_TEXT.w, PS_TEXT.h - reserve, { lineHeight: 1.3, maxLines: 4, max: m ? undefined : 32, min: m ? undefined : 28 });
    const fit = this.fit;
    this.lyrSize = lyricV2(m ? fit.size : null);
    const ss = sigV2(fit.size);
    const blockH = fit.height + (m ? fit.size * 0.28 + ss * 1.15 : 0);
    const top = ENV.y + PS_TEXT.y + Math.max(0, (PS_TEXT.h - blockH) / 2) + fit.size * 0.88;
    const n = fit.lines.reduce((a, l) => a + Array.from(l).length, 0);
    const t0 = this.b0 + 0.15;
    const dur = clamp(0.05 * n + 0.3, 0.6, Math.min(this.beat * 6, 0.3 * (e - s)));
    let k = 0;
    fit.lines.forEach((ln, i) => {
      const lay = layout(ln, MSG_FAM, fit.size);
      for (const g of lay.glyphs) this.psGlyphs.push({ ch: g.ch, x: ENV.x + PS_TEXT.x + g.x, y: top + i * fit.lineHeight, t: t0 + (dur * k++) / Math.max(1, n) });
    });
    if (m) {
      const sw = measure(sigText, SIG_FAM, ss);
      const lastY = top + (fit.lines.length - 1) * fit.lineHeight;
      this.sig = { text: sigText, x: ENV.x + PS_TEXT.x + Math.max(fit.width, sw + 60) - sw, y: lastY + fit.size * 0.28 + ss * 1.1, size: ss, t: t0 + dur + 0.15 };
    }

    // ---- 排頁：同一句在兩封信的同一排
    this.bi = lines.some((l) => !!lyricSubOf(l));
    this.zh = this.bi ? ZH2 : ZH1;
    const zw = this.zh.w - MX * 2 - (this.bi ? NOTE_W : NOTE_W * 0.6);
    this.stZh = { family: ZH_FAM, size: this.lyrSize, minSize: V2.lyrMin, maxWidth: zw, align: 'left', lineHeight: 1.2, active: inkSignal(), sung: rgba('sepia', 0.94), unsung: PENCIL };
    const subSize = subSizeFor(this.lyrSize);
    this.stSub = { family: SUB_FAM, size: subSize, minSize: Math.min(subSize, 30), maxWidth: AIR.w - MX * 2, align: 'left', lineHeight: 1.22, active: rgba('sepia', 0.9), sung: rgba('sepia', 0.82), unsung: PENCIL };
    let page: Page | null = null, y = 0;
    for (const line of lyrics.has ? lines : []) {
      const zh = mainOnly(layoutLyric(c, line, this.stZh));
      const sl = lyricSubOf(line);
      const sub = sl ? layoutLyric(c, sl, this.stSub) : null;
      const hz = zh.size + (zh.rows.length - 1) * zh.size * 1.2;
      const hs = sub ? sub.size + (sub.rows.length - 1) * sub.size * 1.22 : 0;
      // 句與句之間留一條空（58）：鋼筆就躺在這一句下面的空裡，不碰到下一句
      const h = Math.max(hz, hs) + 58;
      if (!page || y + h > BOT - TOP) { page = { ents: [], t0: line.start }; this.pages.push(page); y = 0; }
      page.ents.push({ line, zh, sub, y, h });
      y += h;
    }
    if (!lyrics.has) {
      // 純音樂：從第一拍起一拍寫一個字
      let bi = Math.round(au.beatAt(this.b0));
      INST_LETTER.forEach((ln, i) => {
        const lay = layout(ln, ZH_FAM, 48);
        for (const g of lay.glyphs) { this.instG.push({ ch: g.ch, x: this.zh.x + MX + g.x, y: this.zh.y + TOP + 48 * 0.9 + i * 88, t: au.timeOfBeat(bi) }); if (g.ch.trim()) bi++; }
      });
    }

    this.airPaper = this.makeAir();
    this.zhPaper = this.makeZhPaper();
    this.envPaper = this.makeEnvelope();
    this.shadowCv = this.makeShadow();
    this.drawPapers(this.base.ctx, 0);
    this.base.upload();
    this.avoid = [[ENV.x - 10, ENV.y - ENV.flap - 10, ENV.w + 20, ENV.h + ENV.flap + 20], [this.zh.x, this.zh.y, this.zh.w, this.zh.h]];
    if (this.bi) this.avoid.push([AIR.x, AIR.y, AIR.w, AIR.h]);
  }

  /** 柔邊的影子（紙張共用，貼的時候縮放）。 */
  private makeShadow() {
    const { cv, c } = offCanvas(400, 400, 0.5);
    c.filter = 'blur(14px)';
    c.fillStyle = rgba('ink', 0.26);
    c.fillRect(40, 40, 320, 320);
    return cv;
  }

  /** 航空信紙：很薄（透一點點桌布的色）、紅藍斜紋的邊、左上角「PAR AVION · 航空」。 */
  private makeAir() {
    const { cv, c } = offCanvas(AIR.w, AIR.h);
    c.fillStyle = mixRgba('paper', 'bone', 0.5, 0.96);
    c.fillRect(0, 0, AIR.w, AIR.h);
    // 斜紋的邊：訊號色、玫瑰色交替（顏色跟著主題）
    c.save();
    c.beginPath(); c.rect(0, 0, AIR.w, AIR.h); c.rect(14, 14, AIR.w - 28, AIR.h - 28); c.clip('evenodd');
    for (let i = -40; i < (AIR.w + AIR.h) / 18 + 40; i++) {
      c.fillStyle = i % 4 === 0 ? mixRgba('signal', 'blood', 0.4, 0.8) : i % 4 === 2 ? mixRgba('ash', 'sepia', 0.3, 0.7) : rgba('paper', 0);
      c.beginPath(); c.moveTo(i * 18, 0); c.lineTo(i * 18 + 10, 0); c.lineTo(i * 18 + 10 - AIR.h, AIR.h); c.lineTo(i * 18 - AIR.h, AIR.h); c.closePath(); c.fill();
    }
    c.restore();
    c.font = font(F.mono(600), 14); c.letterSpacing = '4px'; c.fillStyle = mixRgba('signal', 'blood', 0.5, 0.75);
    c.fillText('PAR AVION · 航空', MX, 70);
    c.letterSpacing = '0px';
    // 摺痕（信摺成三折）
    for (const fy of [AIR.h / 3, (AIR.h * 2) / 3]) {
      const g = c.createLinearGradient(0, fy - 5, 0, fy + 5);
      g.addColorStop(0, rgba('sepia', 0)); g.addColorStop(0.5, rgba('sepia', 0.07)); g.addColorStop(0.52, rgba('bone', 0.3)); g.addColorStop(1, rgba('sepia', 0));
      c.fillStyle = g; c.fillRect(14, fy - 5, AIR.w - 28, 10);
    }
    return cv;
  }

  /** 譯本的信紙：米色、淡淡的橫線、信頭的「A&O」、右邊鉛筆欄的細線。 */
  private makeZhPaper() {
    const S = this.zh;
    const { cv, c } = offCanvas(S.w, S.h);
    c.fillStyle = mixRgba('paper', 'bone', 0.3, 1);
    c.fillRect(0, 0, S.w, S.h);
    c.font = font(F.serif(600, true), 26); c.fillStyle = mixRgba('signal', 'blood', 0.5, 0.7); c.textAlign = 'center';
    c.fillText('A & O', S.w / 2, 62);
    c.font = font(F.mono(500), 12); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.4);
    c.fillText(this.bi ? '譯本 · TRANSLATION' : 'LETTER', S.w / 2, 86);
    c.letterSpacing = '0px'; c.textAlign = 'left';
    c.strokeStyle = rgba('ash', 0.35); c.lineWidth = 1;
    c.beginPath();
    for (let y = TOP + 8; y < S.h - 30; y += 44) { c.moveTo(MX - 8, y); c.lineTo(S.w - MX + 8, y); }
    c.stroke();
    const nx = S.w - MX - NOTE_W * (this.bi ? 1 : 0.6) + 14;
    c.strokeStyle = mixRgba('rose', 'paper', 0.3, 0.5);
    c.beginPath(); c.moveTo(nx, 110); c.lineTo(nx, S.h - 30); c.stroke();
    for (const fy of [S.h / 3, (S.h * 2) / 3]) {
      const g = c.createLinearGradient(0, fy - 6, 0, fy + 6);
      g.addColorStop(0, rgba('sepia', 0)); g.addColorStop(0.5, rgba('sepia', 0.06)); g.addColorStop(0.52, rgba('bone', 0.35)); g.addColorStop(1, rgba('sepia', 0));
      c.fillStyle = g; c.fillRect(0, fy - 6, S.w, 12);
    }
    return cv;
  }

  /** 信封背面：紙、打開往上翻的封口（三角形）、兩邊的接縫線、左上角小小的「P.S.」。 */
  private makeEnvelope() {
    const { cv, c } = offCanvas(ENV.w, ENV.h + ENV.flap);
    const fy = ENV.flap;
    const paper = mixRgba('paper', 'signal', 0.07, 1);
    c.fillStyle = mixRgba(paper, 'sepia', 0.06, 1);
    c.beginPath(); c.moveTo(0, fy); c.lineTo(ENV.w / 2, 0); c.lineTo(ENV.w, fy); c.closePath(); c.fill();
    c.fillStyle = paper;
    c.fillRect(0, fy, ENV.w, ENV.h);
    c.strokeStyle = rgba('sepia', 0.14); c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(0, ENV.h + fy); c.lineTo(ENV.w * 0.2, fy + ENV.h * 0.55); c.moveTo(ENV.w, ENV.h + fy); c.lineTo(ENV.w * 0.8, fy + ENV.h * 0.55); c.stroke();
    c.font = font(F.serif(600, true), 30); c.fillStyle = inkSignal(0.85);
    c.fillText('P.S.', PS_TEXT.x - 6, fy + 46);
    if (this.msg) {
      c.font = font(F.mono(500), 13); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.45);
      const no = no3(this.msg.n);
      c.fillText(no, ENV.w - 50 - measure(no, F.mono(500), 13) - 12, fy + 42);
      c.letterSpacing = '0px';
    }
    return cv;
  }

  /** 一張信紙上的一頁字（畫一次，推到一旁用）：全部唱完的樣子。 */
  private snap(pi: number, side: 'A' | 'Z'): HTMLCanvasElement {
    const key = `${pi}${side}`;
    const hit = this.snaps.get(key);
    if (hit) return hit;
    const S = side === 'A' ? AIR : this.zh;
    const { cv, c } = offCanvas(S.w, S.h, 0.75);
    c.drawImage(side === 'A' ? this.airPaper! : this.zhPaper!, 0, 0, S.w, S.h);
    c.translate(-S.x, -S.y);
    const pg = this.pages[pi];
    if (pg) this.drawPageText(c, pg, side, 1e9, null, 0, 0);
    this.snaps.set(key, cv);
    return cv;
  }

  /** 一頁的字：一句一排，鉛筆草稿上用墨描；寫完的句子留著。 */
  private drawPageText(c: CanvasRenderingContext2D, pg: Page, side: 'A' | 'Z', t: number, cur: Line | null, ox: number, oy: number) {
    const S = side === 'A' ? AIR : this.zh;
    for (const en of pg.ents) {
      const a = cur && en.line !== cur && en.line.start > (cur?.start ?? 0) ? 0.8 : 1;
      c.save();
      c.translate(S.x + MX + ox, S.y + TOP + en.y + en.zh.size * 0.9 + oy);
      if (side === 'Z') drawLyric(c, en.line, t, this.stZh, en.zh, a);
      else if (en.sub) drawLyric(c, lyricSubOf(en.line)!, t, this.stSub, en.sub, a);
      c.restore();
    }
  }

  private pageAt(t: number): { pi: number; swap: number } {
    let pi = 0;
    for (let i = 1; i < this.pages.length; i++) if (this.pages[i]!.t0 - 0.6 <= t) pi = i;
    const t0 = this.pages[pi]?.t0 ?? 0;
    const sw = pi > 0 ? prog(t, t0 - 0.6, t0 - 0.1) : 1;
    return { pi, swap: sw >= 1 ? 0 : sw };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start;
    if (!this.bgReady) { this.bg.render(renderer, this.bgRT); this.bgReady = true; }
    comp.draw(renderer, this.bgRT.texture, out, { mode: 'replace' });

    const L = this.live;
    L.clear();
    const c = L.ctx;
    const inK = prog(t, s, s + 0.35, ease.outCubic);
    c.globalAlpha = inK;
    // 紙：進場（信紙落下）時每格畫，落定之後用畫好的那一張（大張的 drawImage 每格畫很吃 GPU）
    const drop = (1 - ease.outCubic(prog(t, s, s + 0.45))) * -30;
    if (t < s + 0.45) this.drawPapers(c, drop);
    else comp.draw(renderer, this.base.texture, out);
    this.drawEnvelope(c, t);
    c.globalAlpha = 1;
    if (lyrics.has) this.drawLetters(c, t, drop, inK);
    else this.drawInst(c, t);
    comp.draw(renderer, L.upload(), out);

    // 鏡頭：先看兩封信，附言寫完之後往下（信封）看一點；整個窗格慢慢推近
    const zoom = 1.015 + 0.03 * ease.inOutCubic(f.p);
    const roomX = (W - W / zoom) / 2, roomY = (H - H / zoom) / 2;
    const toMsg = this.msg ? ease.inOutCubic(prog(t, this.b0 + 1.8, this.b0 + 4.8)) : 0;
    return {
      paper: 1, popupAvoid: this.avoid, bloom: 0.1, bloomThreshold: 1.8, halation: 0.02, vignette: 0.22, grain: 0.04, ca: 0.3, zoom,
      shake: [lerp(-0.1, 0.35, toMsg) * roomX, lerp(0.5, -0.6, toMsg) * roomY],
    };
  }

  /** 兩封信的字、兩支鋼筆、鉛筆的譯註、換頁（舊的兩張推到一旁）。 */
  private drawLetters(c: CanvasRenderingContext2D, t: number, dy: number, inK: number) {
    const { lyrics } = this.ctx;
    const { pi, swap } = this.pageAt(t);
    const pg = this.pages[pi];
    if (!pg) return;
    const ly = lyricAt(lyrics, t, 30, 0.35);
    const cur = ly && pg.ents.some((en) => en.line === ly.line) ? ly.line : null;
    c.save();
    c.globalAlpha = inK;
    if (this.bi) this.drawPageText(c, pg, 'A', t, cur, 0, dy);
    this.drawPageText(c, pg, 'Z', t, cur, 0, dy);
    this.drawNotes(c, t, pg, dy);
    c.restore();
    // 鋼筆：筆尖跟著正在寫的字（兩封信各一支）；沒在寫的時候停在紙邊
    const heads = this.heads(t, pg, cur, dy);
    if (this.bi) for (const p of heads.a) this.drawPen(c, p, false);
    for (const p of heads.z) this.drawPen(c, p, true);
    // 換頁：舊的兩張往左下推走、轉一點點（底下是新的一張）
    if (swap > 0 && pi > 0) {
      const q = ease.inCubic(swap);
      for (const side of (this.bi ? ['A', 'Z'] : ['Z']) as ('A' | 'Z')[]) {
        const S = side === 'A' ? AIR : this.zh;
        c.save();
        c.globalAlpha = 1 - q * 0.9;
        c.translate(S.x + S.w / 2 - 260 * q, S.y + S.h / 2 + 120 * q + dy);
        c.rotate(-0.12 * q);
        c.drawImage(this.snap(pi - 1, side), -S.w / 2, -S.h / 2, S.w, S.h);
        c.restore();
      }
    }
  }

  /**
   * 兩支筆放在哪（_b2 的 penOnEdge：筆在任何時候都不蓋到任何一行字）：寫字時筆尖貼著這一句整塊的下緣、x 跟著寫到的地方，
   * 筆身躺在這一句下面的空裡——譯本的筆往右、航空信的筆往左（兩支筆往外、對稱）。沒在寫的時候停在信紙下緣的空白；
   * 兩個位置之間不滑過去（會掃過中間的字），而是先淡出、再在新位置淡入。
   */
  private heads(t: number, pg: Page, cur: Line | null, dy: number): { z: Pen[]; a: Pen[] } {
    const idle = (S: Sheet, right: boolean, a: number): Pen => ({ x: right ? S.x + S.w - 250 : S.x + 250, y: S.y + S.h - 26 + dy, ang: right ? PEN_R : PEN_L, a });
    const en = cur ? pg.ents.find((x) => x.line === cur) : null;
    const one = (S: Sheet, right: boolean, lay: LyricLayout | null, line: Line | null): Pen[] => {
      if (!en || !lay || !line) return [idle(S, right, 1)];
      // 寫到哪裡：唱過的字的尾巴（還沒開始就是第一個字的開頭）
      let fx = lay.words[0]?.x ?? 0;
      for (const pw of lay.words) { const p = Lyrics.wordProgress(pw.word, t); if (p > 0) fx = pw.x + pw.w * p; }
      const base = S.y + TOP + en.y + en.zh.size * 0.9 + dy;
      const tip = penOnEdge(S.x + MX + fx, lyricBlock(S.x + MX, base, lay), 'bottom', 10);
      const wA = prog(t, line.start - 0.18, line.start - 0.02) * (1 - prog(t, line.end + 0.12, line.end + 0.28));
      const iA = 1 - prog(t, line.start - 0.36, line.start - 0.2) + prog(t, line.end + 0.3, line.end + 0.46);
      return [idle(S, right, clamp(iA)), { ...tip, ang: right ? PEN_R : PEN_L, a: wA }];
    };
    return { z: one(this.zh, true, en?.zh ?? null, en?.line ?? null), a: one(AIR, false, en?.sub ?? null, en ? lyricSubOf(en.line) : null) };
  }

  /** 鋼筆：筆尖在 (x, y)、筆身沿 ang；影子只偏一點點（貼著紙）。a 是淡入淡出。 */
  private drawPen(c: CanvasRenderingContext2D, p: Pen, main: boolean) {
    if (p.a <= 0.001) return;
    c.save();
    c.globalAlpha *= p.a;
    c.save();
    c.translate(p.x + 3, p.y + 5);
    c.rotate(p.ang);
    c.fillStyle = rgba('ink', 0.12);
    c.beginPath(); c.roundRect(0, -8, 200, 16, 8); c.fill();
    c.restore();
    c.translate(p.x, p.y);
    c.rotate(p.ang);
    // 筆尖（金屬、中間一條縫）、握位、筆身、筆蓋的夾子
    c.fillStyle = mixRgba('ember', 'ash', 0.5, 1);
    c.beginPath(); c.moveTo(0, 0); c.lineTo(24, -6); c.lineTo(30, 0); c.lineTo(24, 6); c.closePath(); c.fill();
    c.strokeStyle = rgba('sepia', 0.7); c.lineWidth = 1; c.beginPath(); c.moveTo(4, 0); c.lineTo(22, 0); c.stroke();
    c.fillStyle = rgba('sepia', 0.9);
    c.fillRect(28, -7, 34, 14);
    c.fillStyle = main ? mixRgba('blood', 'sepia', 0.35, 1) : mixRgba('ash', 'sepia', 0.45, 1);
    c.beginPath(); c.roundRect(60, -9, 140, 18, 8); c.fill();
    c.fillStyle = rgba('paper', 0.3); c.fillRect(66, -6, 126, 3);
    c.fillStyle = mixRgba('ember', 'ash', 0.5, 1); c.fillRect(66, -9, 5, 18);
    c.restore();
  }

  /** 譯本右邊的鉛筆譯註：一句寫完之後（有些句子），先一條波浪底線、再一句小小的譯註（從左到右寫出來）。 */
  private drawNotes(c: CanvasRenderingContext2D, t: number, pg: Page, dy: number) {
    const S = this.zh;
    const nx = S.x + S.w - MX - NOTE_W * (this.bi ? 1 : 0.6) + 26;
    for (const en of pg.ents) {
      const h = hash(en.line.i, this.seed, 3);
      if (h > 0.55) continue;
      const a = en.line.end + 0.1;
      const q = prog(t, a, a + 0.6);
      if (q <= 0) continue;
      const by = S.y + TOP + en.y + en.zh.size * 0.9 + dy;
      // 波浪底線：這句的最後兩三個字底下
      const last = en.zh.words.filter((w) => w.y === en.zh.rows[en.zh.rows.length - 1]!.y);
      const w0 = last[Math.max(0, last.length - 3)], w1 = last[last.length - 1];
      if (w0 && w1) {
        const x0 = S.x + MX + w0.x, x1 = S.x + MX + w1.x + w1.w;
        const yy = by + w1.y + 10;
        c.save();
        c.strokeStyle = rgba('graphite', 0.55); c.lineWidth = 1.6;
        c.beginPath();
        for (let x = x0; x <= lerp(x0, x1, clamp(q * 2)); x += 4) { const y = yy + 3 * Math.sin((x - x0) * 0.25); if (x === x0) c.moveTo(x, y); else c.lineTo(x, y); }
        c.stroke();
        c.restore();
      }
      // 譯註：兩行小字（照詞斷好，不會斷出單獨一個「！」），用 clip 從左到右寫出來
      const pool = this.bi ? NOTES : NOTES1;
      const rows = pool[Math.floor(hash(en.line.i, this.seed, 7) * pool.length)]!;
      c.save();
      c.font = font(F.hand(400), 22); c.fillStyle = rgba('graphite', 0.8);
      rows.forEach((r, ri) => {
        const rq = clamp(q * rows.length - ri);
        if (rq <= 0) return;
        const w = measure(r, F.hand(400), 22);
        c.save(); c.beginPath(); c.rect(nx - 4, by - 40 + ri * 28 - 22, (w + 8) * rq, 32); c.clip();
        c.fillText(r, nx, by - 40 + ri * 28);
        c.restore();
      });
      c.restore();
    }
  }

  /** 純音樂：信裡一拍寫一個字（寫到的字先是濕的墨）。 */
  private drawInst(c: CanvasRenderingContext2D, t: number) {
    c.save();
    c.font = font(ZH_FAM, 48);
    let head: Glyph | null = null;
    for (const g of this.instG) {
      const a = prog(t, g.t, g.t + 0.12);
      if (a <= 0) { c.fillStyle = PENCIL; c.fillText(g.ch, g.x, g.y); continue; }
      c.fillStyle = t < g.t + 0.5 ? inkSignal(0.95) : rgba('sepia', 0.94);
      c.fillText(g.ch, g.x, g.y);
      if (g.ch.trim()) head = { ...g, x: g.x + measure(g.ch, ZH_FAM, 48) };
    }
    c.font = font(F.mono(400), 16); c.fillStyle = rgba('sepia', 0.45);
    c.fillText(`♪ ${this.ctx.song.title}`, this.zh.x + MX, this.zh.y + this.zh.h - 50);
    c.restore();
    // 筆躺在正在寫的那一行底下的空裡（行距 88，字 48：中間有 34 的空）
    if (head) {
      const tip = penOnEdge(head.x, [this.zh.x + MX, head.y - 48 * 0.85, this.zh.w - MX * 2, 48 * 1.13], 'bottom', 8);
      this.drawPen(c, { ...tip, ang: PEN_R, a: 1 }, true);
    } else this.drawPen(c, { x: this.zh.x + this.zh.w - 250, y: this.zh.y + this.zh.h - 26, ang: PEN_R, a: 1 }, true);
  }

  /** 信封背面：紙、附言逐字寫出來、署名；第一拍封蠟蓋在封口的尖上（壓扁、彈一下）。 */
  /** 紙：信封（在信紙底下：封口往上翻，信是從裡面抽出來的）、兩張信紙（dy：進場時從上面落下）。 */
  private drawPapers(c: CanvasRenderingContext2D, dy: number) {
    const x = ENV.x, y = ENV.y - ENV.flap;
    c.drawImage(this.shadowCv!, x - 40 * (ENV.w / 320) + 6, y - 40 * ((ENV.h + ENV.flap) / 320) + 12, ENV.w * 400 / 320, (ENV.h + ENV.flap) * 400 / 320);
    c.drawImage(this.envPaper!, x, y, ENV.w, ENV.h + ENV.flap);
    const paperAt = (S: Sheet, img: HTMLCanvasElement) => {
      c.drawImage(this.shadowCv!, S.x - 40 * (S.w / 320) + 6, S.y - 40 * (S.h / 320) + 12 + dy, S.w * 400 / 320, S.h * 400 / 320);
      c.drawImage(img, S.x, S.y + dy, S.w, S.h);
    };
    if (this.bi) paperAt(AIR, this.airPaper!);
    paperAt(this.zh, this.zhPaper!);
  }

  /** 信封背面的字：附言逐字寫出來、署名；第一拍封蠟蓋下去。 */
  private drawEnvelope(c: CanvasRenderingContext2D, t: number) {
    const x = ENV.x, y = ENV.y - ENV.flap;
    const fit = this.fit;
    if (fit) {
      c.save();
      c.font = font(MSG_FAM, fit.size);
      const ink = rgba('sepia', this.msg ? 0.94 : 0.62);
      for (const g of this.psGlyphs) {
        const a = prog(t, g.t - 0.02, g.t + 0.16);
        if (a <= 0) continue;
        c.globalAlpha *= 1;
        c.fillStyle = g.ch === '♥' ? rgba('rose') : t < g.t + 0.45 && this.msg ? inkSignal(0.9) : ink;
        c.save(); c.globalAlpha = c.globalAlpha * a;
        c.fillText(g.ch, g.x, g.y);
        c.restore();
      }
      if (this.sig && t >= this.sig.t) {
        c.globalAlpha = prog(t, this.sig.t, this.sig.t + 0.4);
        c.font = font(SIG_FAM, this.sig.size); c.fillStyle = rgba('sepia', 0.8);
        c.fillText(this.sig.text, this.sig.x, this.sig.y);
      }
      c.restore();
    }
    // 封蠟：信封右邊（封口的尖壓在信紙底下看不到，改蓋在右邊；第一拍蓋下去）
    const au = this.ctx.audio;
    const q = prog(t, this.b0 - 0.12, this.b0, ease.inCubic);
    const land = t >= this.b0 ? Math.exp(-(t - this.b0) * 7) * Math.sin((t - this.b0) * 30) : 0;
    const sx = x + ENV.w - 78, sy = ENV.y + ENV.h * 0.6;
    c.save();
    c.translate(sx, sy - (1 - q) * 60);
    c.scale(1 + 0.12 * land, 1 - 0.12 * land);
    c.globalAlpha *= q;
    c.fillStyle = rgba('ink', 0.15);
    c.beginPath(); c.ellipse(4, 6, 40, 36, 0, 0, TAU); c.fill();
    c.fillStyle = mixRgba('blood', 'signal', 0.25, 1);
    c.beginPath();
    for (let i = 0; i <= 24; i++) { const a = (i / 24) * TAU; const r = 36 + 4 * Math.sin(a * 5 + 1) + 2 * Math.sin(a * 9); if (i) c.lineTo(Math.cos(a) * r, Math.sin(a) * r); else c.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    c.fill();
    c.strokeStyle = mixRgba('blood', 'ink', 0.3, 0.6); c.lineWidth = 2;
    c.beginPath(); c.arc(0, 0, 24, 0, TAU); c.stroke();
    c.font = font(F.serif(600, true), 22); c.fillStyle = mixRgba('blood', 'ink', 0.35, 0.85); c.textAlign = 'center';
    c.fillText('A&O', 0, 7);
    c.restore();
    void au;
  }
}
