// 書法（亮）：一張八行箋（宣紙、印好的紅色直行線），毛筆把主打留言一個字一個字寫上去，落款是署名，最後蓋一方紅印。
//  - 中文為主的留言直書、由右到左（標點掛在字的右上、括號轉向）；英文為主的留言改用橫格的信紙、由左到右。
//  - 落筆在拍點：留言切成幾個詞組，每個詞組在一個拍點（詞組多就半拍）「沾一次墨」開始寫；同一個詞組越寫越乾，
//    後面的字有飛白（筆毛分岔的乾擦痕）。一個字的寫法是筆沿著字從上到下一橫一橫掃過去（中文沒有筆順資料，這是近似），
//    寫好的字邊緣暈開一點點墨。
//  - 寫完的下一拍寫落款（「阿哲 敬賀」），再下一拍蓋印（白文「百年好合」，畫面震一下）。
//  - 寫好的字畫在一張圖層上、只有「寫完的字數」變了才重畫；正在寫的那個字、筆、蓋印的動作在另一張小圖層每格畫。
//  - 歌詞在信紙下緣逐字跟唱（手寫字）。沒有留言：信紙上寫一句邀請（落款「新人 敬邀」）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { F, font, layout, loadText, measure } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, mulberry32, noise1 } from '../engine/util';
import { lyricAt, drawLyric, layoutLyric, beatAfter, drawHeart, type LyricStyle } from './_motifs';
import { subRect, paperLyric, cjkRatio } from './_t13';

export const spec: PlateSpecDecl = { group: 'type', family: 'craft', paper: true, energy: [0, 0.65], bars: [4, 8] };

// ---------------------------------------------------------------- 信紙（邏輯像素）
/** 印好的格子範圍：直書八行，橫書七列。 */
const SHEET = { x0: 206, x1: 1310, y0: 152, y1: 812 };
const NCOL = 8, NROW = 7;
const CW = (SHEET.x1 - SHEET.x0) / NCOL, RH = (SHEET.y1 - SHEET.y0) / NROW;
/** 寫好的字那一層的範圍（含上方的標籤）。 */
const INK_R = { x: 150, y: 90, w: 1200, h: 760 };
/** 下緣的歌詞。 */
const LYR = { x: SHEET.x0, base: 938, w: 1110 };
const LYR_R = { x: 150, y: 850, w: 1210, h: 140 };
const FAM = F.hand(700);
const FAM_SIG = F.hand(400);
const INVITE = '請掃描右下角，把祝福寫在這張信紙上。';
const FOOT = '＊墨跡未乾，請勿觸摸螢幕。';
const SEAL_TXT = ['百', '年', '好', '合'];

const PAPER = () => new FSPass(/* glsl */ `
  uniform float uVert;
  float fibres(vec2 p, float cs) {
    float acc = 0.0;
    vec2 cell = floor(p / cs);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 c = cell + vec2(float(i), float(j));
      vec2 o = (c + hash22(c)) * cs;
      float a = hash12(c + 7.1) * TAU;
      float L = cs * (0.5 + 1.4 * hash12(c + 3.3));
      vec2 d = vec2(cos(a), sin(a));
      float dist = sdSegment(p, o - d * L * 0.5, o + d * L * 0.5);
      acc += (hash12(c + 9.9) - 0.35) * (1.0 - smoothstep(0.2, 1.1, dist));
    }
    return acc;
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float cloud = fbm(p * 0.0019, 3);
    float f = fibres(p, 30.0);
    // 宣紙：比一般的紙白一點、纖維明顯、雲狀的厚薄
    vec3 paper = mix(C_PAPER, C_BONE, 0.3) * (0.978 + 0.022 * cloud + 0.03 * f);
    paper *= 0.97 + 0.045 * (1.0 - vUv.x * 0.5) * vUv.y;
    // 印刷的紅格線（訊號色的暗部）：線有一點點深淺不勻
    vec3 red = mix(C_BLOOD, C_SIGNAL, 0.3);
    float inY = step(${SHEET.y0}.0, p.y) * step(p.y, ${SHEET.y1}.0);
    float inX = step(${SHEET.x0 - 1}.0, p.x) * step(p.x, ${SHEET.x1 + 1}.0);
    float ln = 0.0;
    if (uVert > 0.5) {
      float d = abs(mod(p.x - ${SHEET.x0}.0 + ${(CW / 2).toFixed(3)}, ${CW.toFixed(3)}) - ${(CW / 2).toFixed(3)});
      ln = pxLine(d, 0.45, 1.3) * inY * inX;
    } else {
      float d = abs(mod(p.y - ${SHEET.y0}.0 + ${(RH / 2).toFixed(3)}, ${RH.toFixed(3)}) - ${(RH / 2).toFixed(3)});
      ln = pxLine(d, 0.45, 1.3) * inY * inX;
      ln = max(ln, pxLine(abs(p.x - ${SHEET.x0}.0), 0.45, 1.3) * inY);
      ln = max(ln, pxLine(abs(p.x - ${SHEET.x1}.0), 0.45, 1.3) * inY);
    }
    // 外框：上下一粗一細，左右粗線
    float fy = step(${SHEET.x0 - 14}.0, p.x) * step(p.x, ${SHEET.x1 + 14}.0);
    ln = max(ln, fy * (pxLine(abs(p.y - ${SHEET.y0 - 12}.0), 1.4, 2.4) + pxLine(abs(p.y - ${SHEET.y1 + 12}.0), 1.4, 2.4)));
    ln = max(ln, fy * (pxLine(abs(p.y - ${SHEET.y0}.0), 0.45, 1.3) + pxLine(abs(p.y - ${SHEET.y1}.0), 0.45, 1.3)));
    float fx = step(${SHEET.y0 - 12}.0, p.y) * step(p.y, ${SHEET.y1 + 12}.0);
    ln = max(ln, fx * (pxLine(abs(p.x - ${SHEET.x0 - 14}.0), 1.4, 2.4) + pxLine(abs(p.x - ${SHEET.x1 + 14}.0), 1.4, 2.4)));
    ln *= 0.72 + 0.28 * smoothstep(-0.6, 0.6, snoise(p * 0.03));
    fragColor = vec4(mix(paper, red, sat(ln) * 0.4), 1.0);
  }`, { uVert: { value: 1 } });

/** 飛白用的乾擦紋（一張共用的貼圖：很多條長短不一的細橫紋）。 */
let STREAK: HTMLCanvasElement | null = null;
function streaks() {
  if (STREAK) return STREAK;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const c = cv.getContext('2d')!;
  const rnd = mulberry32(1313);
  c.fillStyle = '#fff';
  for (let i = 0; i < 150; i++) {
    const y = rnd() * 256, x = rnd() * 256 - 60, w = 40 + rnd() * 220, h = 0.6 + rnd() * rnd() * 3.2;
    c.globalAlpha = 0.45 + 0.55 * rnd();
    c.fillRect(x, y, w, h);
    c.fillRect(x - 256, y, w, h);
  }
  STREAK = cv;
  return cv;
}

/** 一個要寫的字：格子中心 (x, y)、字級、開始與寫完的時間、乾的程度、筆的方向。 */
interface G { ch: string; x: number; y: number; s: number; fam: string; t0: number; t1: number; dry: number; ang: number; turn: boolean; dx: number; dy: number; small: boolean; bw: number; bh: number }
/** 直書的排版單位：一個字、掛在右上的小標點、一串轉 90° 的英文、空白。adv 是佔幾格（一格 = 字級 × 1.06）。 */
interface Tok { t: string; kind: 'char' | 'small' | 'run' | 'space'; adv: number }

const PUNCT_SMALL = new Set(Array.from('，。、．,.'));
const PUNCT_TURN = new Set(Array.from('…～~ー—「」『』（）()《》〈〉【】-'));
const BREAK_AFTER = new Set(Array.from('，。！？、,.!?；;：:'));
const NO_START = new Set(Array.from('、。，．,.!?！？：；:;）)」』】〕〉》…～~ー♥'));

export default class Brush extends Scene {
  paper = shared('brush.paper', PAPER);
  /** 寫好的字（寫完的字數變了才重畫）。 */
  ink = this.track(new Layer2D(INK_R.w, INK_R.h, undefined, { fast: true }));
  /** 正在寫的字、筆、蓋印的動作（每格畫）。 */
  wet = this.track(new Layer2D(INK_R.w, INK_R.h + 60, undefined, { fast: true }));
  lyr = this.track(new Layer2D(LYR_R.w, LYR_R.h, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  vert = true;
  glyphs: G[] = [];
  seal = { x: 0, y: 0, s: 100, t: Infinity, rot: 0 };
  sealCv: HTMLCanvasElement | null = null;
  inkKey = '';
  /**
   * 每個字的「字模」（含飛白、暈墨），init 時一次做好，之後寫字、濕墨、整張重畫都用同一張：
   * 每次重畫都重新光柵化的話，瀏覽器可能這次用 GPU、下次用 CPU 畫（畫布多的時候會退回 CPU），
   * 邊緣差一兩個色階，同一個時間點畫兩次就不一樣了。
   */
  gcv: HTMLCanvasElement[] = [];
  /** 詞組開始的時間（沾墨）。 */
  dips: number[] = [];
  /** glyphs 最後幾個是落款。 */
  nSig = 0;

  override async init() {
    const { audio: au, start, song } = this.ctx;
    const m = this.msg;
    const text = m ? m.text : INVITE;
    const sig = m ? (m.couple ? '新人 敬謝' : `${m.name || '一位賓客'} 敬賀`) : '新人 敬邀';
    await loadText(`${text}${sig}${FOOT}${SEAL_TXT.join('')}書法八行箋${song.title}`);
    // 字模只做一次、做了就不再變：一定要等真正用到的繁中字型（文楷、思源宋體）到了再做，等久一點
    await loadText(`${text}${sig}`, 12000, true);
    // 中文為主、或根本沒有英文字（例如只有愛心）就直書
    this.vert = cjkRatio(text) >= 0.5 || !/[A-Za-z]/.test(text);
    const t0 = beatAfter(au, start + 0.05);
    if (this.vert) this.layoutVertical(text, sig);
    else this.layoutHorizontal(text, sig);
    this.schedule(t0);
    this.sealCv = this.buildSeal(this.seal.s);
    this.gcv = this.glyphs.map((g) => this.glyphCanvas(g));
  }

  override dispose() {
    // 一晚會建幾百次：字模、印的畫布馬上還掉，不等 GC
    for (const cv of [this.sealCv, ...this.gcv]) if (cv) cv.width = cv.height = 0;
    this.gcv = [];
    super.dispose();
  }

  // ---------------------------------------------------------------- 排版
  /** 直書：選最大的字級，讓留言＋落款一行放得進八行；用到的行置中。英文字、數字連成一串轉 90° 放（像直書的書本）。 */
  private layoutVertical(text: string, sig: string) {
    const colH = SHEET.y1 - SHEET.y0 - 36;
    let s = 44, cols: Tok[][] = [];
    // 一行（直的）放得下幾格；標點可以掛在行尾一格，但「！！！」這種連續標點會一直掛下去、超出紙：也要算進去
    const cells = (col: Tok[]) => col.reduce((a, tk) => a + tk.adv, 0);
    for (let size = 100; size >= 44; size -= 2) {
      const cap = colH / (size * 1.06);
      const cs = breakCols(toks(text, size), cap);
      s = size; cols = cs;
      if (cs.length + 1 <= NCOL && cs.every((col) => cells(col) <= cap + 0.1)) break;
    }
    if (s > CW * 0.7) { s = CW * 0.7; cols = breakCols(toks(text, s), colH / (s * 1.06)); }
    const used = cols.length + 1;
    const first = Math.floor((NCOL - used) / 2); // 從右邊數第幾行開始
    const colX = (i: number) => SHEET.x1 - CW * (first + i + 0.5);
    const put = (tk: Tok, x: number, top: number, size: number, fam: string) => {
      const L = tk.adv * size * 1.06;
      if (tk.kind === 'space') return;
      const small = tk.kind === 'small';
      const run = tk.kind === 'run';
      this.glyphs.push({
        ch: tk.t, x: x + (small ? size * 0.3 : 0), y: small ? top + size * 0.1 : top + L / 2, s: size, fam, t0: 0, t1: 0, dry: 0, ang: 0,
        turn: run || PUNCT_TURN.has(tk.t), dx: 0, dy: 1, small, bw: size * 1.1, bh: run ? L : size * 1.1,
      });
    };
    cols.forEach((col, ci) => {
      let top = SHEET.y0 + 18;
      for (const tk of col) { put(tk, colX(ci), top, s, FAM); top += tk.adv * s * 1.06; }
    });
    // 落款：下一行、靠下，字小一點；印蓋在落款下面
    const sealS = Math.round(clamp(s * 1.05, 76, CW * 0.74));
    // 落款的字級：名字很長（「孟庭的高中同學們 敬賀」）就縮小，免得壓到印
    const room = colH - sealS - 60 - s * 0.8;
    let ss = Math.max(40, Math.round(s * 0.56)), st = toks(sig, ss, FAM_SIG);
    const lenOf = (ts: Tok[], z: number) => ts.reduce((a, tk) => a + tk.adv, 0) * z * 1.06;
    while (ss > 36 && lenOf(st, ss) > room) { ss -= 2; st = toks(sig, ss, FAM_SIG); }
    const len = lenOf(st, ss);
    const x = colX(cols.length);
    let top = Math.max(SHEET.y0 + 40 + s * 0.8, SHEET.y1 - 22 - sealS - 26 - len);
    const before = this.glyphs.length;
    for (const tk of st) { put(tk, x, top, ss, FAM_SIG); top += tk.adv * ss * 1.06; }
    this.nSig = this.glyphs.length - before;
    this.seal = { x, y: Math.min(SHEET.y1 - 16 - sealS / 2, top + 20 + sealS / 2), s: sealS, t: Infinity, rot: -0.04 };
  }

  /** 橫書（英文為主）：在七列的格子裡，字級 44～72，一列一行。 */
  private layoutHorizontal(text: string, sig: string) {
    const c = this.ink.ctx;
    const maxW = SHEET.x1 - SHEET.x0 - 80;
    let s = 44, lines: string[] = [text];
    for (let size = 76; size >= 44; size -= 2) {
      c.font = font(FAM, size);
      const ls = wrapWords(c, text, maxW);
      s = size; lines = ls;
      if (ls.length <= NROW - 2) break;
    }
    // 用到的列（留言＋落款）上下置中
    const row0 = Math.max(0, Math.floor((NROW - lines.length - 1) / 2));
    lines.forEach((ln, li) => {
      const lay = layout(ln, FAM, s);
      const base = SHEET.y0 + RH * (row0 + li + 1) - RH * 0.24;
      for (const g of lay.glyphs) {
        if (g.ch === ' ') continue;
        this.glyphs.push({ ch: g.ch, x: SHEET.x0 + 40 + g.x + g.w / 2, y: base - s * 0.34, s, fam: FAM, t0: 0, t1: 0, dry: 0, ang: 0, turn: false, dx: 1, dy: 0, small: false, bw: Math.max(g.w, s * 0.4) + 6, bh: s * 1.1 });
      }
    });
    const ss = Math.max(40, Math.round(s * 0.62));
    const sigText = `—— ${sig.replace(/ 敬.*$/, '')}`;
    const sl = layout(sigText, FAM_SIG, ss);
    const sealS = 86;
    const base = SHEET.y0 + RH * (row0 + lines.length + 1) - RH * 0.24;
    const x0 = SHEET.x1 - 40 - sealS - 24 - sl.width;
    const before = this.glyphs.length;
    for (const g of sl.glyphs) {
      if (g.ch === ' ') continue;
      this.glyphs.push({ ch: g.ch, x: x0 + g.x + g.w / 2, y: base - ss * 0.34, s: ss, fam: FAM_SIG, t0: 0, t1: 0, dry: 0, ang: 0, turn: false, dx: 1, dy: 0, small: false, bw: Math.max(g.w, ss * 0.4) + 6, bh: ss * 1.1 });
    }
    this.nSig = this.glyphs.length - before;
    this.seal = { x: SHEET.x1 - 40 - sealS / 2, y: base - ss * 0.34, s: sealS, t: Infinity, rot: 0.035 };
  }

  // ---------------------------------------------------------------- 時間
  /**
   * 留言切成詞組（標點後、或滿四個字／一個英文字），每個詞組在拍點（太多就半拍）沾墨開始寫；
   * 詞組裡一個字接一個字，越寫越乾。落款在下一拍，印再下一拍。
   */
  private schedule(t0: number) {
    const au = this.ctx.audio;
    const nSig = this.nSig;
    const body = this.glyphs.slice(0, this.glyphs.length - nSig);
    const tail = this.glyphs.slice(this.glyphs.length - nSig);
    const groups: G[][] = [];
    let cur: G[] = [];
    for (let i = 0; i < body.length; i++) {
      const g = body[i]!;
      cur.push(g);
      const latin = /[A-Za-z0-9']/.test(g.ch);
      const nextLatin = /[A-Za-z0-9']/.test(body[i + 1]?.ch ?? '');
      const wordEnd = latin && !nextLatin;
      if (BREAK_AFTER.has(g.ch) || (!latin && cur.length >= 4) || (wordEnd && cur.length >= 5)) { groups.push(cur); cur = []; }
    }
    if (cur.length) groups.push(cur);
    const beat = au.beatPeriod(t0);
    const b0 = au.beatAt(t0);
    // 兩小節內寫完：詞組多就半拍一組、再多就三分之一拍
    const div = groups.length <= 8 ? 1 : groups.length <= 16 ? 2 : 3;
    let end = t0;
    groups.forEach((grp, gi) => {
      const ts = au.timeOfBeat(b0 + gi / div);
      const slot = beat / div;
      const dc = Math.min(0.24, (slot * 0.92) / grp.length);
      this.dips.push(ts);
      grp.forEach((g, i) => {
        g.t0 = ts + i * dc;
        g.t1 = g.t0 + dc * 0.94;
        g.dry = clamp(Math.pow(i / Math.max(1, grp.length - 1), 1.6) * 0.7 + (hash(gi, i, 3) - 0.5) * 0.16, 0, 0.75) * (grp.length > 1 ? 1 : 0.2);
        g.ang = (hash(gi, i, 5) - 0.5) * 0.7 + (this.vert ? 0.12 : -0.08);
        end = g.t1;
      });
    });
    // 落款：寫完的下一拍，一個字 0.12 秒
    const ts = beatAfter(au, end + 0.05);
    this.dips.push(ts);
    tail.forEach((g, i) => { g.t0 = ts + i * 0.12; g.t1 = g.t0 + 0.11; g.dry = 0.15 + 0.4 * (i / Math.max(1, tail.length - 1)); g.ang = 0.1; end = g.t1; });
    this.seal.t = beatAfter(au, end + 0.1);
  }

  /** 白文方印（紅底、字是白的）：印泥不勻、邊緣有缺角。 */
  private buildSeal(S: number) {
    const cv = document.createElement('canvas');
    const k = 2;
    cv.width = cv.height = Math.ceil(S * k);
    const c = cv.getContext('2d')!;
    c.scale(k, k);
    c.fillStyle = mixRgba('signal', 'blood', 0.55);
    c.fillRect(0, 0, S, S);
    c.globalCompositeOperation = 'destination-out';
    // 字（右上起、直讀：右行「百年」、左行「好合」）
    const fs = S * 0.4;
    c.font = font(F.ming(900), fs);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const pos = [[0.73, 0.28], [0.73, 0.72], [0.27, 0.28], [0.27, 0.72]];
    SEAL_TXT.forEach((ch, i) => c.fillText(ch, S * pos[i]![0]!, S * pos[i]![1]!));
    // 印泥沒吃滿的小白點、邊緣的缺口
    const rnd = mulberry32(42);
    for (let i = 0; i < 260; i++) {
      const x = rnd() * S, y = rnd() * S, r = rnd() * rnd() * 2.2 + 0.3;
      c.globalAlpha = 0.35 + 0.65 * rnd();
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;
    for (let i = 0; i < 14; i++) {
      const e = Math.floor(rnd() * 4), u = rnd() * S, r = 1.5 + rnd() * 3;
      const x = e === 0 ? u : e === 1 ? S : e === 2 ? u : 0, y = e === 0 ? 0 : e === 1 ? u : e === 2 ? S : u;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
    return cv;
  }

  // ---------------------------------------------------------------- 畫
  /** 一個字的「字模」：墨色的字，按乾的程度用乾擦紋挖掉一些（飛白），邊緣帶一點暈開的墨。 */
  private glyphCanvas(g: G) {
    const P = Math.ceil(Math.max(g.s * 1.6, g.bh + g.s * 0.6)), K = 1.5;
    const cv = document.createElement('canvas');
    cv.width = cv.height = Math.ceil(P * K);
    // 軟體畫布：每次畫出來都一樣（GPU 畫布的模糊與反鋸齒可能每次差一點點）
    const c = cv.getContext('2d', { willReadFrequently: true })!;
    c.scale(K, K);
    const inkCol = mixRgba('sepia', 'ink', 0.7, 0.97);
    c.translate(P / 2, P / 2);
    // 手寫的字不會排得像印刷一樣整齊：每個字一點點歪、一點點大小不同
    c.rotate((hash(g.x, g.y, 11) - 0.5) * 0.06);
    const sc = 0.96 + 0.08 * hash(g.x, g.y, 12);
    c.scale(sc, sc);
    if (g.turn) c.rotate(this.vert ? Math.PI / 2 : 0);
    if (g.ch === '♥') {
      drawHeart(c, 0, 0, g.s * 0.72);
      return cv;
    }
    c.font = font(g.fam, g.small ? g.s * 0.9 : g.s);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    // 暈開的墨（宣紙吃墨）
    c.filter = 'blur(1.6px)';
    c.fillStyle = mixRgba('sepia', 'ink', 0.4, 0.3);
    c.fillText(g.ch, 0, 0);
    c.filter = 'none';
    c.fillStyle = inkCol;
    c.fillText(g.ch, 0, 0);
    if (g.dry > 0.05) {
      // 飛白：乾擦紋只出現在筆畫的「收尾」那一側（右邊、下面），越往尾巴越乾；紋路的角度每個字不同
      const m = document.createElement('canvas');
      m.width = m.height = Math.ceil(P * K);
      const mc = m.getContext('2d', { willReadFrequently: true })!;
      mc.scale(K, K);
      mc.translate(P / 2, P / 2);
      mc.rotate(g.ang);
      mc.drawImage(streaks(), -P, -P * 0.5 + (hash(g.x, g.y) - 0.5) * 80, P * 2, P);
      mc.setTransform(1, 0, 0, 1, 0, 0);
      const gr = mc.createLinearGradient(P * K * 0.1, P * K * 0.15, P * K * 0.95, P * K * 0.7);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(0.5, 'rgba(0,0,0,0.35)');
      gr.addColorStop(1, 'rgba(0,0,0,1)');
      mc.globalCompositeOperation = 'destination-in';
      mc.fillStyle = gr;
      mc.fillRect(0, 0, m.width, m.height);
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = 'destination-out';
      c.globalAlpha = Math.min(1, g.dry * 1.25);
      c.drawImage(m, 0, 0);
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
      m.width = m.height = 0;
    }
    return cv;
  }

  private drawGlyph(c: CanvasRenderingContext2D, g: G, cv: HTMLCanvasElement) {
    const P = cv.width / 1.5;
    c.drawImage(cv, g.x - P / 2, g.y - P / 2, P, P);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const vis = prog(t, s, s + 0.3) * (1 - prog(t, e - 0.25, e));
    this.paper.u.uVert!.value = this.vert ? 1 : 0;
    this.paper.render(renderer, out);

    // ---- 寫好的字（含落好的印、上方標籤）
    const done = this.glyphs.filter((g) => t >= g.t1).length;
    const sealIn = t >= this.seal.t + 0.14;
    const key = `${done}|${sealIn}`;
    if (key !== this.inkKey) { this.inkKey = key; this.drawInk(done, sealIn); }
    comp.draw(renderer, this.ink.texture, out, { ...subRect(INK_R), opacity: vis });

    // ---- 正在寫的字、筆、蓋印
    const shake = this.drawWet(t, vis);
    comp.draw(renderer, this.wet.upload(), out, subRect({ ...INK_R, h: INK_R.h + 60 }));

    // ---- 歌詞
    this.drawLyr(t, vis, lyricAt(lyrics, t));
    comp.draw(renderer, this.lyr.upload(), out, subRect(LYR_R));

    const box = this.bounds();
    return {
      paper: 1, bloom: 0.3, bloomThreshold: 0.98, bloomKnee: 0.12, halation: 0.08, vignette: 0.22, grain: 0.055,
      shake: [shake * noise1(t * 60, 3) * 5, shake * noise1(t * 57, 4) * 5],
      zoom: 1 + 0.03 * ease.inOutCubic(f.p) + 0.003 * f.a.kick,
      popupAvoid: [box, [LYR.x - 20, LYR.base - 80, LYR.w + 40, 110]],
    };
  }

  /** 留言、落款、印的範圍（小卡避開）。 */
  private bounds(): [number, number, number, number] {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const g of this.glyphs) { x0 = Math.min(x0, g.x - g.s / 2); x1 = Math.max(x1, g.x + g.s / 2); y0 = Math.min(y0, g.y - g.s / 2); y1 = Math.max(y1, g.y + g.s / 2); }
    x0 = Math.min(x0, this.seal.x - this.seal.s / 2); x1 = Math.max(x1, this.seal.x + this.seal.s / 2); y1 = Math.max(y1, this.seal.y + this.seal.s / 2);
    return [x0 - 20, y0 - 20, x1 - x0 + 40, y1 - y0 + 40];
  }

  private drawInk(done: number, sealIn: boolean) {
    const L = this.ink, c = L.ctx;
    L.clear();
    c.save();
    c.translate(-INK_R.x, -INK_R.y);
    // 上方的標籤（mono 與小字）
    c.font = font(F.hei(500), 20);
    c.letterSpacing = '6px';
    c.fillStyle = rgba('sepia', 0.55);
    c.fillText(this.vert ? '書法 · 八行箋' : '書法 · 橫格信箋', SHEET.x0 - 14, SHEET.y0 - 34);
    c.letterSpacing = '0px';
    for (let i = 0; i < done; i++) {
      const g = this.glyphs[i]!;
      this.drawGlyph(c, g, this.gcv[i]!);
    }
    if (sealIn && this.sealCv) this.drawSeal(c, 1, 1);
    c.restore();
    L.upload();
  }

  private drawSeal(c: CanvasRenderingContext2D, scale: number, a: number) {
    const S = this.seal;
    c.save();
    c.globalAlpha = a;
    c.translate(S.x, S.y);
    c.rotate(S.rot);
    c.scale(scale, scale);
    c.drawImage(this.sealCv!, -S.s / 2, -S.s / 2, S.s, S.s);
    c.restore();
  }

  /** 正在寫的那個字（沿著字一橫一橫掃過去）、毛筆、蓋印。回傳畫面震動量。 */
  private drawWet(t: number, vis: number): number {
    const L = this.wet, c = L.ctx;
    L.clear();
    c.save();
    c.translate(-INK_R.x, -INK_R.y);
    c.globalAlpha = vis;
    let tip: { x: number; y: number; press: number } | null = null;
    const gi = this.glyphs.findIndex((g) => t >= g.t0 && t < g.t1);
    if (gi >= 0) {
      const g = this.glyphs[gi]!;
      const u = clamp((t - g.t0) / (g.t1 - g.t0));
      // 掃過去的路線：四橫（直書、橫書都一樣，由上而下），每一橫由左到右
      const bw = g.bw, bh = g.bh, rows = Math.max(4, Math.round((4 * bh) / bw)), x0 = g.x - bw / 2, y0 = g.y - bh / 2;
      const R = (bh / rows) * 0.8;
      const pt = (v: number) => {
        const k = Math.min(rows - 1e-6, v * rows), ri = Math.floor(k), fr = k - ri;
        return { x: x0 + fr * bw, y: y0 + (ri + 0.5) * (bh / rows) };
      };
      c.save();
      c.beginPath();
      for (let r = 0; r < rows; r++) {
        const ry = y0 + (r + 0.5) * (bh / rows);
        const full = clamp(u * rows - r);
        if (full <= 0) break;
        c.rect(x0 - 4, ry - bh / rows / 2 - 2, bw * full + 8, bh / rows + 4);
      }
      c.clip();
      this.drawGlyph(c, g, this.gcv[gi]!);
      c.restore();
      const p = pt(u);
      tip = { x: p.x + R * 0.2, y: p.y, press: 1 - g.dry * 0.5 };
    } else {
      // 兩個詞組之間：筆提起來，停在剛寫完的字旁邊
      let last: G | null = null;
      for (const g of this.glyphs) if (g.t1 <= t) last = g;
      const next = this.glyphs.find((g) => g.t0 > t);
      if (last && next && next.t0 - last.t1 < 1.5) {
        const k = ease.inOutCubic(clamp((t - last.t1) / Math.max(0.05, next.t0 - last.t1)));
        tip = { x: last.x + (next.x - next.s * 0.5 - last.x) * k, y: last.y + (next.y - next.s * 0.5 - last.y) * k, press: 0 };
      } else if (!last && next) {
        const k = ease.outExpo(prog(t, this.ctx.start, next.t0));
        tip = { x: next.x - next.s * 0.5 - 160 * (1 - k), y: next.y - next.s * 0.5 - 120 * (1 - k), press: 0 };
      }
    }
    // 剛寫好的字還是濕的：墨色深一點、慢慢乾（淡回去）
    for (let i = 0; i < this.glyphs.length; i++) {
      const g = this.glyphs[i]!;
      if (t < g.t1 || t > g.t1 + 1.4 || g.ch === '♥') continue;
      c.save();
      c.globalAlpha *= 0.38 * (1 - (t - g.t1) / 1.4);
      this.drawGlyph(c, g, this.gcv[i]!);
      c.restore();
    }
    if (tip) this.drawBrush(c, tip.x, tip.y, tip.press);
    // 蓋印：拍點上從上面壓下來（放大 → 1），壓下去的那一下畫面震
    let shake = 0;
    const st = this.seal.t;
    if (this.sealCv && t >= st - 0.22 && t < st + 0.14) {
      if (t < st) {
        const k = prog(t, st - 0.22, st, ease.inCubic);
        this.drawSeal(c, 1.5 - 0.5 * k, 0.25 + 0.5 * k);
      } else this.drawSeal(c, 1, 1);
    }
    if (t >= st) shake = Math.pow(0.5, (t - st) / 0.06) * (t < st + 0.4 ? 1 : 0);
    c.restore();
    return shake;
  }

  /** 毛筆：筆尖（墨色的尖毫）、金屬箍、竹桿；直書時桿往左上（還沒寫的那一側），橫書時往右下。 */
  private drawBrush(c: CanvasRenderingContext2D, x: number, y: number, press: number) {
    const dir = this.vert ? { x: -0.5, y: -0.866 } : { x: 0.42, y: 0.907 };
    const nx = -dir.y, ny = dir.x;
    const lift = (1 - press) * 14;
    const bx = x + dir.x * lift, by = y + dir.y * lift;
    // 影子（提筆時離得遠一點）
    c.save();
    c.globalAlpha *= 0.12;
    c.strokeStyle = rgba('sepia');
    c.lineCap = 'round';
    c.lineWidth = 18;
    c.beginPath(); c.moveTo(bx + 16 + lift, by + 20 + lift); c.lineTo(bx + 16 + lift + dir.x * 360, by + 20 + lift + dir.y * 360); c.stroke();
    c.restore();
    // 筆尖：水滴形，壓下去時粗一點
    const tl = 58, tw = 11 + 5 * press;
    c.fillStyle = mixRgba('sepia', 'ink', 0.6);
    c.beginPath();
    c.moveTo(bx, by);
    c.quadraticCurveTo(bx + dir.x * tl * 0.45 + nx * tw, by + dir.y * tl * 0.45 + ny * tw, bx + dir.x * tl + nx * tw * 0.8, by + dir.y * tl + ny * tw * 0.8);
    c.lineTo(bx + dir.x * tl - nx * tw * 0.8, by + dir.y * tl - ny * tw * 0.8);
    c.quadraticCurveTo(bx + dir.x * tl * 0.45 - nx * tw, by + dir.y * tl * 0.45 - ny * tw, bx, by);
    c.fill();
    // 金屬箍
    const f0 = tl, f1 = tl + 22;
    c.strokeStyle = mixRgba('sepia', 'ash', 0.35);
    c.lineWidth = 19;
    c.lineCap = 'butt';
    c.beginPath(); c.moveTo(bx + dir.x * f0, by + dir.y * f0); c.lineTo(bx + dir.x * f1, by + dir.y * f1); c.stroke();
    // 竹桿（有竹節）
    const h1 = f1 + 330;
    c.strokeStyle = mixRgba('paper', 'sepia', 0.42);
    c.lineWidth = 15;
    c.beginPath(); c.moveTo(bx + dir.x * f1, by + dir.y * f1); c.lineTo(bx + dir.x * h1, by + dir.y * h1); c.stroke();
    c.strokeStyle = rgba('sepia', 0.5);
    c.lineWidth = 1.5;
    for (const k of [0.3, 0.72]) {
      const d = f1 + (h1 - f1) * k;
      c.beginPath(); c.moveTo(bx + dir.x * d + nx * 8, by + dir.y * d + ny * 8); c.lineTo(bx + dir.x * d - nx * 8, by + dir.y * d - ny * 8); c.stroke();
    }
    c.strokeStyle = rgba('paper', 0.4);
    c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(bx + dir.x * f1 + nx * 4, by + dir.y * f1 + ny * 4); c.lineTo(bx + dir.x * h1 + nx * 4, by + dir.y * h1 + ny * 4); c.stroke();
  }

  private drawLyr(t: number, vis: number, ly: ReturnType<typeof lyricAt>) {
    const L = this.lyr, c = L.ctx;
    L.clear();
    c.save();
    c.translate(-LYR_R.x, -LYR_R.y);
    c.globalAlpha = vis;
    if (ly) {
      // 歌詞比留言小一級（留言是焦點）
      const ms = this.glyphs[0]?.s ?? 70;
      const st: LyricStyle = { family: F.hand(700), size: Math.round(clamp(ms * 0.78, 48, 58)), minSize: 48, maxWidth: LYR.w, ...paperLyric() };
      const lay = layoutLyric(c, ly.line, st);
      const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.2));
      c.translate(LYR.x, LYR.base - (lay.height - lay.size) + (1 - inK) * 16);
      drawLyric(c, ly.line, t, st, lay, ly.k * vis);
    } else {
      const { song } = this.ctx;
      c.font = font(F.mono(500), 17);
      c.letterSpacing = '4px';
      c.fillStyle = rgba('sepia', 0.55);
      c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`.toUpperCase(), LYR.x, LYR.base - 44);
      c.letterSpacing = '0px';
      c.font = font(F.hei(500), 24);
      c.fillStyle = rgba('sepia', 0.5);
      c.fillText(FOOT, LYR.x, LYR.base);
    }
    c.restore();
  }
}

const LATIN = /[A-Za-z0-9&'’.\-@#+]/;
/** 直書的排版單位（字級 size 決定英文串的長度）。 */
function toks(text: string, size: number, fam = FAM): Tok[] {
  const cs = Array.from(text.replace(/\s+/g, ' ').trim());
  const out: Tok[] = [];
  for (let i = 0; i < cs.length; i++) {
    const ch = cs[i]!;
    if (LATIN.test(ch)) {
      // 英文字、數字連成一串（中間的單一空白也算進去：「QR code」是一串）
      let run = ch;
      while (i + 1 < cs.length && (LATIN.test(cs[i + 1]!) || (cs[i + 1] === ' ' && LATIN.test(cs[i + 2] ?? '')))) run += cs[++i];
      if (run.length === 1 && /[0-9]/.test(run)) { out.push({ t: run, kind: 'char', adv: 1 }); continue; }
      out.push({ t: run, kind: 'run', adv: measure(run, fam, size) / (size * 1.06) + 0.3 });
    } else if (ch === ' ') out.push({ t: ch, kind: 'space', adv: 0.4 });
    else if (PUNCT_SMALL.has(ch)) out.push({ t: ch, kind: 'small', adv: 0.5 });
    else out.push({ t: ch, kind: 'char', adv: 1 });
  }
  return out;
}

/** 直書斷行：一行最多 cap 格；標點不放行首（掛在上一行的尾巴）；空白不放行首。 */
function breakCols(tokens: Tok[], cap: number): Tok[][] {
  const cols: Tok[][] = [];
  let cur: Tok[] = [], used = 0;
  for (const tk of tokens) {
    if (tk.kind === 'space' && (!cur.length || used + tk.adv > cap)) continue;
    const hang = NO_START.has(tk.t) && cur.length > 0;
    if (cur.length && used + tk.adv > cap + 1e-6 && !hang) { cols.push(cur); cur = []; used = 0; }
    cur.push(tk);
    used += tk.adv;
  }
  if (cur.length) cols.push(cur);
  return cols;
}

/** 英文按字斷行（不拆字）。 */
function wrapWords(c: CanvasRenderingContext2D, text: string, maxW: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && c.measureText(next).width > maxW) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}
