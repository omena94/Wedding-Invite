// 雙語字典（亮，雙語版面）：俯看一本攤開在胡桃木桌上的厚字典，檯燈從左上方照下來，中縫有深深的陰影，
// 書口露出一層層的紙邊、一條緞帶書籤垂出書外。
//  - 右頁是這首歌的詞條：詞頭是歌名（〔名〕一首在婚禮上播放的歌……），底下的「例句」就是歌詞：
//    中文例句大字（思源宋體），原文例句小一號、斜體（Cormorant／思源宋體韓文）排在正下方，兩行各照自己的逐字時間亮。
//    上一句縮成一行小小的舊例句留在上面，像字典裡一條接一條的例句。
//  - 一支紅筆在唱到的字下面畫線（筆尖跟著正在唱的字走），一句唱完順手把例句編號圈起來，再放回頁邊，閒著時跟著拍子點紙。
//  - 左頁上半是密密的詞條（遠看像字，其實是細細的字塊），下半是「筆記 NOTES」的橫線區：主打留言就是寫在這裡的手寫註記。
//  - 進場：三張書頁從右往左翻過去（翻到這一頁）；每個小節線右上角的折角被風掀一下；鏡頭先看右頁，留言寫好後慢慢移向左頁。
//  - 沒翻譯的歌只有中文（或英文）例句，原文那一排收起來；純音樂：例句寫「這首歌沒有歌詞，大家一起哼」。
// 畫法：桌面、書、紙邊、中縫陰影、燈光、緞帶是一個 shader；印好的字（詞條、詞頭、橫線）畫一次在一張 Canvas2D；
// 會動的（例句、紅筆、留言、翻頁、折角）每格畫在另一張。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, makeRT } from '../engine/gl';
import { F, font, layout, loadText, measure } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, mulberry32, TAU } from '../engine/util';
import type { FitResult } from '../engine/text';
import { Lyrics, lyricSubOf, type Line } from '../engine/lyrics';
import { lyricAt, layoutLyric, drawLyric, drawLyricSub, beatAfter, subGap, subSizeFor, type LyricStyle, type LyricLayout } from './_motifs';
import { lyricV2, sigV2, msgMaxFor, V2 } from './_v2';
import { fitMsgB2, sigOf, windowLines, linesText, inkSignal, PAPER_SING, mainOnly, lastRowY, lyricBlock, penOnEdge, PEN_DOWN, INVITE, B2_SYMBOLS, no3, type Rect } from './_b2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'print', paper: true, energy: [0.1, 0.75], bars: [4, 8] };

/** 書（邏輯像素）：紙面的左右、中縫。上下緣靠中縫的地方往內凹一點（書頁彎進中縫）。 */
const BOOK = { xL: 116, xR: 1804, g: 960, yT: 72, yB: 1004 };
/** 右頁的詞條欄（x 起點、寬）與各列的基線。 */
const RX = 1044, RW = 716;
const HEAD_Y = 300, DEF_Y = 352, PREV_Y = 430, CUR_Y = 520;
/** 例句編號的小方塊（在例句左邊）與例句的字從哪裡開始。 */
const BADGE = { x: RX, w: 40, h: 30 };
const EX_X = RX + 56, EX_W = RW - 56;
/** 左頁下半的「筆記」區：留言寫在這裡。 */
const NOTE = { x: 186, y: 628, w: 700, h: 350 };
/**
 * 紅筆閒著時放的地方（筆尖）：右頁例句整塊的下面（最長的例句加原文也在這條線上面），筆身往右下，尾巴不進右下角 HUD。
 */
const REST = { x: 1150, y: 700 };
/** 圈編號時筆身的方向：往左下（編號在字的左邊，筆身伸到中縫那一側，不碰例句）。 */
const PEN_CIRCLE = 2.3;
const LYR_FAM = F.ming(700);
const SUB_FAM = F.serif(600, true);
const MSG_FAM = F.hand(700);
const SIG_FAM = F.hand(400);
const DEF1 = '一首在婚禮上播放的歌；聽到的人會想牽起身邊那個人的手。';
/** 純音樂：例句那一格的冷面話。 */
const INST_EX = '例　（這首歌沒有歌詞，大家一起哼。）';
const NO_MSG = '掃描右下角 QR code，把你的祝福寫在這一頁。';
/** 進場翻頁：三張書頁，一張 0.42 秒、相隔 0.13 秒；最後一張翻完的時間（相對開始翻）。 */
const FLIP_N = 3, FLIP_GAP = 0.13, FLIP_DUR = 0.42, FLIP_END = (FLIP_N - 1) * FLIP_GAP + FLIP_DUR;

const FRAG = /* glsl */ `
uniform float uIn;
float edgeT(float x) { return ${BOOK.yT}.0 + 10.0 * exp(-abs(x - ${BOOK.g}.0) / 70.0); }
float edgeB(float x) { return ${BOOK.yB}.0 - 8.0 * exp(-abs(x - ${BOOK.g}.0) / 70.0); }
void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  // 桌面：胡桃木（順著 x 的長木紋），燈照的地方亮一點
  float gr = fbm(vec2(p.x / 700.0, p.y / 22.0) + vec2(fbm(p / 260.0, 2) * 1.6, 0.0), 3);
  float lampD = length((p - vec2(520.0, 180.0)) / vec2(1.25, 1.0));
  float lamp = exp(-lampD * lampD / (2.0 * 760.0 * 760.0));
  vec3 desk = mix(C_INK2, mix(C_SEPIA, C_BLOOD, 0.25), 0.55 + 0.35 * gr) * (0.55 + 0.6 * lamp);
  float yt = edgeT(p.x), yb = edgeB(p.x);
  // 書殼（深色布面）：比紙塊大一圈
  vec2 q = abs(p - vec2(${BOOK.g}.0, ${(BOOK.yT + BOOK.yB) / 2}.0)) - vec2(${(BOOK.xR - BOOK.xL) / 2 + 26}.0, ${(BOOK.yB - BOOK.yT) / 2 + 20}.0);
  float cover = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 10.0;
  vec3 col = desk;
  // 書殼在桌上的影子（往右下）
  vec2 qs = abs(p - vec2(${BOOK.g}.0 + 14.0, ${(BOOK.yT + BOOK.yB) / 2}.0 + 18.0)) - vec2(${(BOOK.xR - BOOK.xL) / 2 + 26}.0, ${(BOOK.yB - BOOK.yT) / 2 + 20}.0);
  float sh = length(max(qs, 0.0)) + min(max(qs.x, qs.y), 0.0) - 10.0;
  col *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, 34.0, sh));
  if (cover < 0.0) col = mix(C_BLOOD, C_INK, 0.62) * (0.8 + 0.25 * lamp) * (0.96 + 0.04 * fbm(p / 6.0, 2));
  // 紙塊：上下、外側露出一層層的紙邊（細線），紙面在裡面
  bool inBlock = p.x > ${BOOK.xL - 14}.0 && p.x < ${BOOK.xR + 14}.0 && p.y > yt - 6.0 && p.y < yb + 16.0;
  if (inBlock) {
    float dE = min(min(p.x - ${BOOK.xL - 14}.0, ${BOOK.xR + 14}.0 - p.x), yb + 16.0 - p.y);
    // 紙邊：一條一條的細紋（越往外越暗）
    float stripes = 0.5 + 0.5 * sin((p.x < ${BOOK.xL}.0 || p.x > ${BOOK.xR}.0 ? p.x : p.y) * 2.1);
    col = C_PAPER * (0.8 + 0.08 * stripes) * (0.78 + 0.22 * smoothstep(0.0, 14.0, dE)) * (0.85 + 0.2 * lamp);
  }
  bool onPage = p.x > ${BOOK.xL}.0 && p.x < ${BOOK.xR}.0 && p.y > yt && p.y < yb;
  if (onPage) {
    float g = abs(p.x - ${BOOK.g}.0);
    float fib = fbm(p / 180.0, 3);
    vec3 paper = C_PAPER * (0.975 + 0.03 * fib);
    // 中縫：書頁彎進去的陰影，靠中縫一條很暗的線；外側邊緣也稍微暗一點（紙往下彎）
    float shade = 1.0 - 0.34 * exp(-g / 24.0) - 0.1 * exp(-g / 150.0) - 0.05 * smoothstep(700.0, 844.0, g);
    // 紙面靠中縫那一段有一條淡淡的反光（彎起來的地方朝著燈）
    shade += 0.025 * exp(-pow((g - 70.0) / 26.0, 2.0));
    float light = 0.9 + 0.13 * lamp;
    col = paper * shade * light;
    // 書頁上下緣很細的一條陰影
    col *= 1.0 - 0.12 * (1.0 - smoothstep(0.0, 5.0, min(p.y - yt, yb - p.y)));
  }
  // 緞帶書籤：從中縫上面垂到書外（中縫右邊一點，不壓到例句）
  vec2 a = vec2(${BOOK.g + 16}.0, ${BOOK.yT - 20}.0), b = vec2(${BOOK.g + 44}.0, 1100.0);
  float rb = sdSegment(p, a, b) - 6.0;
  float rbs = sdSegment(p - vec2(4.0, 3.0), a, b) - 6.0;
  col *= 1.0 - 0.22 * (1.0 - smoothstep(-1.0, 3.0, rbs)) * step(0.0, rb);
  if (rb < 0.0) {
    float u = clamp(dot(p - a, normalize(b - a)), 0.0, 2000.0);
    float across = (sdSegment(p, a, b) / 6.0);
    float sheen = 0.75 + 0.35 * exp(-pow((across - 0.2 * sin(u / 90.0)) * 2.2, 2.0));
    col = mix(C_BLOOD, C_INK, 0.35) * sheen * (0.8 + 0.25 * lamp);
  }
  fragColor = vec4(col * mix(0.0, 1.0, uIn), 1.0);
}`;

const BG = () => new FSPass(FRAG, { uIn: { value: 1 } });

interface Glyph { ch: string; x: number; y: number; t: number }

export default class Dictionary extends Scene {
  bg = shared('dictionary.bg', BG);
  /** 桌面與書整張都不會動（燈亮起來之後）：畫一次存起來，之後每格只複製（fbm 很貴，整個窗格省下幾毫秒）。 */
  bgRT = this.track(makeRT(W, H, { depthBuffer: false }));
  bgReady = false;
  /** 印好的字（畫一次）。 */
  page = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 會動的（每格畫）。 */
  live = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 37 + (this.msg?.id ?? 0) * 13) >>> 0;
  b0 = 0;
  beat = 0.5;
  fit: FitResult | null = null;
  glyphs: Glyph[] = [];
  sig: { text: string; x: number; y: number; size: number; t: number } | null = null;
  /** 留言寫完的時間（鏡頭從右頁移到左頁）。 */
  msgDone = Infinity;
  /** 例句字級：有留言時比留言小一點（lyricV2），沒有留言時 52。 */
  lyrSize = 52;
  st!: LyricStyle;
  avoid: Rect[] = [];
  /** 翻頁用的「一頁字」（半解析度，畫一次）。 */
  sheet: HTMLCanvasElement | null = null;
  /** 進場翻頁的時間。 */
  flipT0 = 0;

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.b0 = beatAfter(au, s + 0.05);
    this.beat = clamp(au.beatPeriod(this.b0), 0.25, 1.2);
    const lines = windowLines(lyrics, s, e);
    // 前一句（小小的舊例句）也要載字
    const prevs = lines.map((l) => lyrics.lines[l.i - 1]).filter((l): l is Line => !!l);
    const text = m ? m.text : NO_MSG;
    const sigText = m ? sigOf(m) : '';
    await loadText(text + sigText + NO_MSG + INVITE + DEF1 + INST_EX + song.title + song.artist + linesText(lines) + linesText(prevs)
      + '筆記NOTES例名婚喜313314xǐhūn〔〕' + B2_SYMBOLS);

    // ---- 留言：左頁下半的筆記區（手寫），署名在最後一行下面
    const c = this.live.ctx;
    const tagH = m?.couple ? 30 : 0;
    const reserve = m ? sigV2(msgMaxFor(text)) + 22 : 0;
    this.fit = fitMsgB2(c, text, MSG_FAM, NOTE.w, NOTE.h - reserve - tagH, { lineHeight: 1.36, maxLines: 5, max: m ? undefined : 34, min: m ? undefined : 30 });
    const fit = this.fit;
    this.lyrSize = lyricV2(m ? fit.size : null);
    const top = NOTE.y + tagH + fit.size * 0.92;
    const n = fit.lines.reduce((a, l) => a + Array.from(l).length, 0);
    // 進場翻頁：窗格一開始，三張書頁在第一拍之前翻過去（第一拍太近就從窗格開頭翻）；留言等頁翻好再寫
    this.flipT0 = this.b0 - s > 0.55 ? this.b0 - 0.55 : s;
    const t0 = Math.max(this.b0 + 0.1, this.flipT0 + FLIP_END);
    const dur = clamp(0.055 * n + 0.3, 0.6, Math.min(this.beat * 6, 0.3 * (e - s)));
    let k = 0;
    fit.lines.forEach((ln, i) => {
      const lay = layout(ln, MSG_FAM, fit.size);
      for (const g of lay.glyphs) this.glyphs.push({ ch: g.ch, x: NOTE.x + g.x, y: top + i * fit.lineHeight, t: t0 + (dur * k++) / Math.max(1, n) });
    });
    this.msgDone = t0 + dur;
    if (m) {
      const ss = sigV2(fit.size);
      const sw = measure(sigText, SIG_FAM, ss);
      const lastY = top + (fit.lines.length - 1) * fit.lineHeight;
      this.sig = { text: sigText, x: NOTE.x + Math.max(fit.width, sw + 40) - sw, y: lastY + fit.size * 0.34 + ss * 1.1, size: ss, t: this.msgDone + 0.15 };
    }

    // ---- 例句的樣式
    this.st = { family: LYR_FAM, size: this.lyrSize, minSize: V2.lyrMin, maxWidth: EX_W, align: 'left', lineHeight: 1.28, ...PAPER_SING() };
    for (const l of lines) layoutLyric(c, l, this.st);

    this.drawPage(song.title, song.artist, fit, top, !!m);
    this.sheet = this.makeSheet();
    const blockH = fit.height + reserve + tagH;
    this.avoid = [[NOTE.x - 20, NOTE.y - 20, NOTE.w + 40, blockH + 40], [RX - 10, HEAD_Y - 50, RW + 20, 420]];
  }

  /** 印好的部分：兩頁的字塊（遠看像密密的詞條）、書眉、頁碼、詞頭、釋義、筆記區的橫線。 */
  private drawPage(title: string, artist: string, fit: FitResult, msgTop: number, hasMsg: boolean) {
    const c = this.page.ctx;
    const rnd = mulberry32(this.seed ^ 0x2d11);
    // 字塊：一個一個小方塊（中文字典的字就是這個節奏），偶爾一條新詞條的開頭（深一點的粗字）
    const greek = (x0: number, x1: number, y0: number, y1: number, pitch = 22) => {
      for (let y = y0; y <= y1; y += pitch) {
        const head = rnd() < 0.18;
        const end = rnd() < 0.14 ? x0 + (x1 - x0) * (0.25 + 0.5 * rnd()) : x1;
        let x = x0;
        if (head) {
          const hw = 26 + Math.floor(rnd() * 3) * 13;
          c.fillStyle = rgba('sepia', 0.5);
          for (let i = 0; i < hw; i += 13) c.fillRect(x + i, y - 11, 11, 11);
          x += hw + 12;
        } else if (rnd() < 0.3) x += 22;
        c.fillStyle = rgba('sepia', 0.15);
        while (x < end - 9) {
          const len = 2 + Math.floor(rnd() * 7);
          for (let i = 0; i < len && x < end - 9; i++, x += 10) c.fillRect(x, y - 8, 8.5, 8.5);
          x += 6;
        }
      }
    };
    // 左頁：兩欄詞條
    greek(180, 548, 150, 520);
    greek(588, 890, 150, 520);
    // 右頁：上一條的尾巴、詞條後面的下一條
    greek(RX, RX + RW, 150, 238);
    greek(RX, RX + RW, 732, 800);
    c.save();
    // 書眉與頁碼
    c.font = font(F.ming(700), 20);
    c.fillStyle = rgba('sepia', 0.62);
    c.fillText('313', 180, 116);
    c.fillText('314', RX + RW - measure('314', F.ming(700), 20), 116);
    c.font = font(F.ming(700), 18);
    c.fillText('婚 hūn', 890 - measure('婚 hūn', F.ming(700), 18), 116);
    c.fillText('喜 xǐ', RX, 116);
    c.strokeStyle = rgba('sepia', 0.35);
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(180, 128); c.lineTo(890, 128); c.moveTo(RX, 128); c.lineTo(RX + RW, 128); c.stroke();
    // 左頁的章節分隔與筆記區標題
    c.font = font(F.ming(700), 20);
    c.fillStyle = rgba('sepia', 0.45);
    c.textAlign = 'center';
    c.fillText('※', 535, 572);
    c.textAlign = 'left';
    c.beginPath(); c.moveTo(300, 565); c.lineTo(505, 565); c.moveTo(565, 565); c.lineTo(770, 565); c.stroke();
    c.font = font(F.hei(500), 17);
    c.letterSpacing = '4px';
    c.fillStyle = rgba('sepia', 0.5);
    c.fillText('筆記　NOTES', NOTE.x, NOTE.y - 12);
    c.letterSpacing = '0px';
    // 筆記區的橫線：跟留言的基線對齊（字寫在線上），往下排滿
    c.strokeStyle = rgba('ash', 0.45);
    c.lineWidth = 1;
    c.beginPath();
    for (let y = msgTop + 8; y < NOTE.y + NOTE.h + 10; y += fit.lineHeight) { c.moveTo(NOTE.x - 6, y); c.lineTo(NOTE.x + NOTE.w + 4, y); }
    c.stroke();
    // 右頁：詞頭（歌名）、〔名〕、歌手、釋義
    // 詞頭（歌名）是小標題：比例句小，不搶留言
    const hs = clamp(Math.floor((100 * (RW - 200)) / Math.max(1, measure(title, F.ming(700), 100))), 26, 32);
    c.font = font(F.ming(700), hs);
    c.fillStyle = rgba('sepia', 0.95);
    c.fillText('◆', RX, HEAD_Y - 2);
    c.fillText(title, RX + hs * 1.05, HEAD_Y);
    let x = RX + hs * 1.05 + measure(title, F.ming(700), hs) + 16;
    c.strokeStyle = rgba('sepia', 0.7); c.lineWidth = 1.2;
    c.strokeRect(x, HEAD_Y - 24, 28, 26);
    c.font = font(F.ming(700), 18); c.fillStyle = rgba('sepia', 0.8);
    c.fillText('名', x + 5, HEAD_Y - 4);
    x += 42;
    if (artist) {
      c.font = font(F.mono(400), 17); c.fillStyle = rgba('sepia', 0.6);
      const a = `〔${artist}〕`;
      if (x + measure(a, F.mono(400), 17) < RX + RW) c.fillText(a, x, HEAD_Y - 4);
    }
    c.font = font(F.ming(400), 23);
    c.fillStyle = rgba('sepia', 0.78);
    c.fillText(DEF1, RX, DEF_Y);
    // 右頁的拇指索引（外側一格深色的「喜」）
    c.fillStyle = mixRgba('blood', 'sepia', 0.4, 0.9);
    c.fillRect(BOOK.xR - 30, 360, 30, 70);
    c.font = font(F.ming(900), 18); c.fillStyle = rgba('paper', 0.95);
    c.fillText('喜', BOOK.xR - 24, 402);
    if (!hasMsg) {
      // 沒有留言：筆記區一個往右下角（QR）彎過去的手繪箭頭
      c.strokeStyle = rgba('sepia', 0.5); c.lineWidth = 2.2; c.lineCap = 'round';
      c.beginPath(); c.moveTo(640, 820); c.bezierCurveTo(760, 880, 860, 900, 930, 870); c.stroke();
      c.beginPath(); c.moveTo(930, 870); c.lineTo(906, 862); c.moveTo(930, 870); c.lineTo(914, 890); c.stroke();
    }
    c.restore();
    this.page.upload();
  }

  /** 翻頁用的一頁（書頁的紙＋字塊），半解析度、畫一次。 */
  private makeSheet(): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    const pw = BOOK.g - BOOK.xL, ph = BOOK.yB - BOOK.yT;
    cv.width = Math.round(pw / 2); cv.height = Math.round(ph / 2);
    const c = cv.getContext('2d')!;
    c.scale(0.5, 0.5);
    c.fillStyle = rgba('paper', 1);
    c.fillRect(0, 0, pw, ph);
    const rnd = mulberry32(this.seed ^ 0x51ee);
    c.fillStyle = rgba('sepia', 0.22);
    for (const [x0, x1] of [[70, 420], [460, 780]] as const) {
      for (let y = 70; y < ph - 60; y += 22) {
        let x = x0;
        while (x < x1 - 9) { const len = 2 + Math.floor(rnd() * 7); for (let i = 0; i < len && x < x1 - 9; i++, x += 10) c.fillRect(x, y, 8.5, 8.5); x += 6; }
      }
    }
    // 中縫那一側（圖的右邊）暗下去，外側也暗一點點：跟 shader 畫的書頁一樣是彎的
    const g = c.createLinearGradient(pw - 150, 0, pw, 0);
    g.addColorStop(0, rgba('sepia', 0)); g.addColorStop(1, rgba('sepia', 0.32));
    c.fillStyle = g; c.fillRect(pw - 150, 0, 150, ph);
    const g2 = c.createLinearGradient(0, 0, 60, 0);
    g2.addColorStop(0, rgba('sepia', 0.08)); g2.addColorStop(1, rgba('sepia', 0));
    c.fillStyle = g2; c.fillRect(0, 0, 60, ph);
    return cv;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start;
    // 進場：檯燈亮起來（0.3 秒）；之後桌面與書都不變，用存好的那一張
    if (t < s + 0.3) {
      this.bg.u.uIn!.value = 0.35 + 0.65 * prog(t, s, s + 0.3, ease.outCubic);
      this.bg.render(renderer, out);
    } else {
      if (!this.bgReady) { this.bg.u.uIn!.value = 1; this.bg.render(renderer, this.bgRT); this.bgReady = true; }
      comp.draw(renderer, this.bgRT.texture, out, { mode: 'replace' });
    }
    comp.draw(renderer, this.page.texture, out);

    const L = this.live;
    L.clear();
    const c = L.ctx;
    this.drawMessage(c, t);
    const ex = this.drawExamples(c, t);
    this.drawCorner(c, t);
    this.drawFlips(c, t);
    this.drawPen(c, this.penAt(t, ex), t);
    comp.draw(renderer, L.upload(), out);
    void lyrics;

    // 鏡頭：先看右頁（詞條），留言寫好之後慢慢移向左頁（筆記）；整個窗格慢慢推近
    const zoom = 1.015 + 0.04 * ease.inOutCubic(f.p);
    const room = (W - W / zoom) / 2;
    const toMsg = this.msg ? ease.inOutCubic(prog(t, this.msgDone, this.msgDone + 2.4)) : 0.3 * f.p;
    const pan = lerp(-0.7, 0.85, toMsg) * room * 0.95;
    return { paper: 1, popupAvoid: this.avoid, bloom: 0.1, bloomThreshold: 1.8, halation: 0.02, vignette: 0.26, grain: 0.04, ca: 0.3, zoom, shake: [pan, 0] };
  }

  /** 筆記區的手寫留言：一個字一個字寫出來，寫完署名。 */
  private drawMessage(c: CanvasRenderingContext2D, t: number) {
    const fit = this.fit;
    if (!fit) return;
    c.save();
    c.font = font(MSG_FAM, fit.size);
    c.textBaseline = 'alphabetic';
    if (this.msg?.couple) {
      c.globalAlpha = prog(t, this.b0, this.b0 + 0.3);
      c.font = font(F.mono(500), 15); c.letterSpacing = '4px'; c.fillStyle = inkSignal(0.9);
      c.fillText('FROM THE COUPLE · 新人', NOTE.x, NOTE.y + 14);
      c.letterSpacing = '0px';
      c.font = font(MSG_FAM, fit.size);
    }
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
      c.font = font(SIG_FAM, this.sig.size);
      c.fillStyle = rgba('sepia', 0.78);
      c.fillText(this.sig.text, this.sig.x, this.sig.y);
      if (this.msg) {
        c.font = font(F.mono(500), 14); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.45);
        c.fillText(no3(this.msg.n), NOTE.x, this.sig.y);
        c.letterSpacing = '0px';
      }
    }
    c.restore();
  }

  /**
   * 右頁的例句：上一句縮成一行小字；這一句中文大字＋原文斜體小一號在正下方，紅筆的底線跟著唱到的字畫。
   * 回傳紅筆要用的位置（底線的筆尖、這一句的編號方塊）。
   */
  private drawExamples(c: CanvasRenderingContext2D, t: number): ExState | null {
    const { lyrics } = this.ctx;
    if (!lyrics.has) {
      c.save();
      c.globalAlpha = prog(t, this.b0, this.b0 + 0.5);
      c.font = font(F.ming(400), 30); c.fillStyle = rgba('sepia', 0.7);
      c.fillText(INST_EX, RX, CUR_Y);
      c.restore();
      return null;
    }
    const ly = lyricAt(lyrics, t, 8, 0.35);
    if (!ly) return null;
    const line = ly.line;
    const lay = layoutLyric(c, line, this.st);
    const sub = lyricSubOf(line);
    const k = ly.k * prog(t, this.ctx.start + 0.25, this.ctx.start + 0.6);
    // 換句：新的例句「印」上來（從淡到實、往上浮 6 px）
    const inK = ease.outCubic(prog(t, line.start - 0.35, line.start + 0.05));
    c.save();
    // ---- 上一句：一行小小的舊例句（中文＋原文），低對比
    const prev = lyrics.lines[line.i - 1];
    if (prev) {
      c.globalAlpha = k * (0.35 + 0.65 * inK);
      c.font = font(F.mono(500), 14); c.fillStyle = rgba('sepia', 0.45);
      c.fillText(String(prev.i + 1).padStart(2, '0'), RX + 6, PREV_Y);
      c.save();
      c.beginPath(); c.rect(EX_X, PREV_Y - 30, EX_W, 44); c.clip();
      c.font = font(LYR_FAM, 22); c.fillStyle = rgba('sepia', 0.5);
      c.fillText(prev.text, EX_X, PREV_Y);
      const psub = lyricSubOf(prev);
      if (psub) {
        const pw = measure(prev.text, LYR_FAM, 22);
        c.font = font(SUB_FAM, 20); c.fillStyle = rgba('sepia', 0.4);
        c.fillText(psub.text, EX_X + pw + 18, PREV_Y);
      }
      c.restore();
    }
    // ---- 這一句
    c.globalAlpha = k;
    const oy = CUR_Y + (1 - inK) * 6;
    // 編號方塊（墨色的小方塊、紙色的數字）
    const bx = BADGE.x, by = oy - BADGE.h + 6;
    c.fillStyle = rgba('sepia', 0.88);
    c.fillRect(bx, by, BADGE.w, BADGE.h);
    c.font = font(F.mono(600), 16); c.fillStyle = rgba('paper', 0.96);
    const num = String(line.i + 1).padStart(2, '0');
    c.fillText(num, bx + (BADGE.w - measure(num, F.mono(600), 16)) / 2, by + 21);
    c.save();
    c.translate(EX_X, oy);
    c.globalAlpha = k * inK;
    drawLyric(c, line, t, this.st, mainOnly(lay), 1);
    // 紅筆的底線：每個唱到的字底下一段（手畫的，微微起伏）
    let head: { x: number; y: number } | null = null;
    let rowJump = -1;
    c.strokeStyle = inkSignal(0.85);
    c.lineWidth = 3;
    c.lineCap = 'round';
    for (const pw of lay.words) {
      const p = Lyrics.wordProgress(pw.word, t);
      if (p <= 0) continue;
      const y = pw.y + lay.size * 0.2;
      const x0 = pw.x - 2, x1 = pw.x + (pw.w + 4) * p;
      c.beginPath();
      for (let x = x0; x <= x1; x += 10) {
        const yy = y + 1.6 * Math.sin(x * 0.045 + line.i) + 1.1 * Math.sin(x * 0.13 + 2);
        if (x === x0) c.moveTo(x, yy); else c.lineTo(x, yy);
      }
      c.lineTo(x1, y + 1.6 * Math.sin(x1 * 0.045 + line.i) + 1.1 * Math.sin(x1 * 0.13 + 2));
      c.stroke();
      if (head && pw.y > head.y - lay.size * 0.2 + 1) rowJump = pw.word.start;
      head = { x: x1, y };
    }
    // ---- 原文（斜體，小一號）在中文正下方
    let subL: { lay: LyricLayout; dy: number } | null = null;
    if (sub) {
      const sy = lastRowY(lay) + subGap(lay.size, subSizeFor(lay.size));
      c.save();
      c.translate(0, sy);
      subL = { lay: drawLyricSub(c, sub, t, { ...this.st, family: SUB_FAM }, lay.size, 1), dy: sy };
      c.restore();
    }
    c.restore();
    // 這一句（中文＋原文）整塊的外框：紅筆只能在它外面（下緣底下）
    const block = lyricBlock(EX_X, oy, lay, subL);
    // 一句唱完：紅筆把編號圈起來（圈到一半就停在圈上）
    const circ = this.circleSpan(line);
    if (circ && t > circ[0]) {
      const q = ease.inOutCubic(prog(t, circ[0], circ[1]));
      c.strokeStyle = inkSignal(0.85); c.lineWidth = 2.6;
      c.beginPath();
      const cx = bx + BADGE.w / 2, cy = by + BADGE.h / 2;
      for (let i = 0; i <= 40 * q; i++) {
        const a = -Math.PI * 0.6 + (TAU * 1.08 * i) / 40;
        const r = 30 + 3 * Math.sin(i * 0.7);
        const x = cx + Math.cos(a) * r * 1.2, y = cy + Math.sin(a) * r * 0.95;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    }
    c.restore();
    return {
      line, lay, ox: EX_X, oy, head: head ? { x: EX_X + head.x, y: oy + head.y } : null, rowJump,
      start: { x: EX_X + (lay.words[0]?.x ?? 0), y: oy + lay.size * 0.2 }, badge: { x: bx + BADGE.w / 2, y: by + BADGE.h / 2 }, circ, block,
    };
  }

  /** 這一句唱完之後紅筆圈編號的時間（下一句太快開始就不圈）。 */
  private circleSpan(line: Line): [number, number] | null {
    const next = this.ctx.lyrics.lines[line.i + 1];
    // 先花 0.25 秒沿著字塊外面繞到編號旁邊，再圈；圈完還要 0.55 秒回到頁邊，下一句才開始
    const a = line.end + 0.3, b = a + 0.45;
    if (next && next.start - 0.35 < b + 0.55) return null;
    return [a, b];
  }

  /**
   * 紅筆的筆尖在哪裡、抬多高（0 貼著紙、1 抬起來）、筆身的方向。規則照 _b2 的 penOnEdge：寫字時筆尖貼著這一句（中文＋原文）
   * 整塊的下緣、x 跟著正在畫底線的字，筆身往右下，整支筆在字塊外面；圈編號時沿著字塊外面（下緣 → 左邊的空白）繞過去，
   * 筆身往左下伸到中縫那一側。任何時候都不蓋到歌詞。
   */
  private penAt(t: number, ex: ExState | null): Pen {
    const au = this.ctx.audio;
    // 閒著：放在頁邊，跟著拍子點紙（拍點上筆尖碰到紙，之後抬起來）
    const bp = au.beatAt(t) % 1;
    const idle: Pen = { x: REST.x, y: REST.y, lift: 0.35 * (1 - Math.exp(-bp * 7)), ang: PEN_DOWN };
    if (!ex) return idle;
    const { line, block } = ex;
    const at = (x: number, lift: number): Pen => ({ ...penOnEdge(x, block, 'bottom'), lift });
    const mv = (a: Pen, b: Pen, q: number, hop: number): Pen => ({
      x: lerp(a.x, b.x, q), y: lerp(a.y, b.y, q), ang: lerp(a.ang, b.ang, q), lift: lerp(a.lift, b.lift, q) + hop * Math.sin(Math.PI * q),
    });
    const home = (from: Pen, t0: number) => mv(from, idle, ease.inOutCubic(prog(t, t0, t0 + 0.4)), 0.9);
    if (t < line.start) return mv(idle, at(ex.start.x, 0), ease.inOutCubic(prog(t, line.start - 0.3, line.start)), 0.8);
    if (t <= line.end + 0.05 && ex.head) {
      // 換到第二排：沿著下緣從第一排的尾巴滑到第二排的開頭（0.14 秒）
      if (ex.rowJump > 0 && t < ex.rowJump + 0.14) {
        return mv(at(this.rowEndBefore(ex).x, 0), at(ex.head.x, 0), ease.inOutCubic(prog(t, ex.rowJump, ex.rowJump + 0.14)), 0.5);
      }
      return at(ex.head.x, 0.05);
    }
    const endP = at((ex.head ?? ex.start).x, 0.1);
    if (!ex.circ) return home(endP, line.end + 0.05);
    const [a, b] = ex.circ;
    // 繞過去：先沿著下緣往左到編號那一欄（字的左邊），再往上到圈的起點；圈完原路下來、回頁邊
    const m0 = line.end + 0.05;
    const corner: Pen = { x: ex.badge.x, y: block[1] + block[3] + 10, ang: PEN_DOWN, lift: 0.3 };
    const c0: Pen = { ...this.circlePt(ex.badge, 0), ang: PEN_CIRCLE, lift: 0 };
    const c1: Pen = { ...this.circlePt(ex.badge, 1), ang: PEN_CIRCLE, lift: 0 };
    if (t < m0) return endP;
    if (t < m0 + 0.13) return mv(endP, corner, ease.inOutCubic(prog(t, m0, m0 + 0.13)), 0.3);
    if (t < a) return mv(corner, c0, ease.inOutCubic(prog(t, m0 + 0.13, a)), 0.2);
    if (t < b) return { ...this.circlePt(ex.badge, ease.inOutCubic(prog(t, a, b))), ang: PEN_CIRCLE, lift: 0 };
    if (t < b + 0.15) return mv(c1, corner, ease.inOutCubic(prog(t, b, b + 0.15)), 0.3);
    return home(corner, b + 0.15);
  }

  private circlePt(b: { x: number; y: number }, q: number) {
    const i = 40 * q, a = -Math.PI * 0.6 + (TAU * 1.08 * i) / 40, r = 30 + 3 * Math.sin(i * 0.7);
    return { x: b.x + Math.cos(a) * r * 1.2, y: b.y + Math.sin(a) * r * 0.95 };
  }

  /** 第一排最後一個字的尾巴（紅筆換排時從這裡滑過去）。 */
  private rowEndBefore(ex: ExState) {
    const first = ex.lay.words.filter((w) => w.y === 0);
    const w = first[first.length - 1];
    return w ? { x: ex.ox + w.x + w.w + 2, y: ex.oy + ex.lay.size * 0.2 } : ex.start;
  }

  /** 紅筆（原子筆）：筆尖在 (x, y)、筆身沿 ang；抬起來時影子離得遠、筆大一點點。 */
  private drawPen(c: CanvasRenderingContext2D, pen: Pen, t: number) {
    const inK = prog(t, this.flipT0 + FLIP_END - 0.1, this.flipT0 + FLIP_END + 0.2);
    if (inK <= 0) return;
    const lift = clamp(pen.lift, 0, 1.2);
    const ang = pen.ang - 0.05 * lift;
    const shape = (cx: CanvasRenderingContext2D) => {
      // 沿著筆身的 u（0 = 筆尖）與寬度：筆尖錐、握位、筆桿、尾蓋
      cx.beginPath();
      cx.moveTo(0, 0);
      cx.lineTo(18, -3.4); cx.lineTo(70, -7); cx.lineTo(222, -8.2); cx.lineTo(232, -6.4);
      cx.lineTo(232, 6.4); cx.lineTo(222, 8.2); cx.lineTo(70, 7); cx.lineTo(18, 3.4);
      cx.closePath();
    };
    c.save();
    c.globalAlpha = inK;
    // 影子：抬得越高離得越遠、越淡
    c.save();
    c.translate(pen.x + 8 + 26 * lift, pen.y + 10 + 30 * lift);
    c.rotate(ang);
    c.fillStyle = rgba('ink', 0.16 * (1 - 0.35 * lift));
    shape(c); c.fill();
    c.restore();
    c.translate(pen.x, pen.y - 4 * lift);
    c.rotate(ang);
    const sc = 1 + 0.05 * lift;
    c.scale(sc, sc);
    // 筆桿（紅筆＝這首歌的訊號色）
    shape(c);
    c.fillStyle = inkSignal(1);
    c.fill();
    // 握位（深色）、筆尖（金屬）、尾蓋
    c.fillStyle = rgba('sepia', 0.9);
    c.beginPath(); c.moveTo(18, -3.4); c.lineTo(70, -7); c.lineTo(70, 7); c.lineTo(18, 3.4); c.closePath(); c.fill();
    c.fillStyle = rgba('ash', 1);
    c.beginPath(); c.moveTo(0, 0); c.lineTo(18, -3.4); c.lineTo(18, 3.4); c.closePath(); c.fill();
    c.fillStyle = rgba('sepia', 0.85);
    c.fillRect(222, -8.2, 10, 16.4);
    // 筆夾與一道反光
    c.fillStyle = rgba('ash', 0.95);
    c.fillRect(150, -12.5, 64, 4);
    c.fillStyle = rgba('paper', 0.35);
    c.fillRect(74, -5.5, 146, 2.2);
    c.restore();
  }

  /** 右頁右上角的折角：每個小節線被風掀一下（彈簧），平常只折一點點。 */
  private drawCorner(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const bi = Math.floor(au.barAt(t) + 1e-4), tb = au.timeOfBar(bi);
    const age = t - tb;
    const kick = tb >= this.b0 - 0.01 ? Math.exp(-age * 5) * Math.sin(age * 18 + 0.4) * 0.5 + Math.exp(-age * 4) : 0;
    const sz = 30 + 22 * clamp(kick, -0.2, 1);
    const x = BOOK.xR, y = BOOK.yT + 1;
    c.save();
    // 掀起來的角底下露出下一頁（一點點陰影）
    c.fillStyle = rgba('sepia', 0.12);
    c.beginPath(); c.moveTo(x - sz - 6, y); c.lineTo(x, y); c.lineTo(x, y + sz + 6); c.closePath(); c.fill();
    c.fillStyle = mixRgba('paper', 'sepia', 0.08, 1);
    c.beginPath(); c.moveTo(x - sz, y); c.lineTo(x, y + sz); c.lineTo(x - sz * 0.92, y + sz * 0.92); c.closePath(); c.fill();
    c.strokeStyle = rgba('sepia', 0.25); c.lineWidth = 1;
    c.beginPath(); c.moveTo(x - sz, y); c.lineTo(x, y + sz); c.stroke();
    c.restore();
  }

  /**
   * 進場：三張書頁從右頁翻到左頁（翻起來的頁越直越窄，翻到一半最暗）。翻完之前：右頁蓋著還沒翻的那一疊，
   * 左頁蓋著剛翻過去的頁背；最後一張翻起來才露出這首歌的詞條，翻完落下才露出左頁的筆記。
   */
  private drawFlips(c: CanvasRenderingContext2D, t: number) {
    const sheet = this.sheet;
    if (!sheet) return;
    const pw = BOOK.g - BOOK.xL, ph = BOOK.yB - BOOK.yT;
    const a0 = this.flipT0, last = a0 + (FLIP_N - 1) * FLIP_GAP;
    if (t >= a0 + FLIP_END) return;
    // 疊著的頁：左頁一張（中縫在圖的右邊）、右頁一張（左右翻過來，中縫在左邊）
    const cover = (right: boolean) => {
      c.save();
      if (right) { c.translate(BOOK.g, 0); c.scale(-1, 1); c.drawImage(sheet, 0, BOOK.yT, pw, ph); }
      else c.drawImage(sheet, BOOK.xL, BOOK.yT, pw, ph);
      c.restore();
    };
    cover(false);
    if (t < last) cover(true);
    for (let k = 0; k < FLIP_N; k++) {
      const a = a0 + k * FLIP_GAP;
      const q = prog(t, a, a + FLIP_DUR, ease.inOutCubic);
      if (q <= 0 || q >= 1) continue;
      const th = Math.PI * q, lift = Math.sin(th);
      const w = pw * Math.abs(Math.cos(th));
      const right = th < Math.PI / 2;
      const x0 = right ? BOOK.g : BOOK.g - w;
      c.save();
      // 翻起來的頁在紙上的影子（往翻的方向拖長）
      c.fillStyle = rgba('ink', 0.14 * lift);
      const sw = w + pw * 0.22 * lift;
      c.fillRect(right ? BOOK.g : BOOK.g - sw, BOOK.yT + 8, sw, ph);
      c.save();
      if (right) { c.translate(BOOK.g, 0); c.scale(-1, 1); c.drawImage(sheet, 0, BOOK.yT - 10 * lift, w, ph); }
      else c.drawImage(sheet, x0, BOOK.yT - 10 * lift, w, ph);
      c.restore();
      c.fillStyle = rgba('sepia', 0.2 * lift + (right ? 0 : 0.05));
      c.fillRect(x0, BOOK.yT - 10 * lift, w, ph);
      c.restore();
    }
  }
}

interface ExState {
  line: Line; lay: LyricLayout; ox: number; oy: number;
  head: { x: number; y: number } | null; rowJump: number;
  start: { x: number; y: number }; badge: { x: number; y: number }; circ: [number, number] | null;
  /** 這一句（中文＋原文）整塊的外框。 */
  block: Rect;
}
/** 紅筆：筆尖位置、抬多高、筆身方向。 */
interface Pen { x: number; y: number; lift: number; ang: number }
