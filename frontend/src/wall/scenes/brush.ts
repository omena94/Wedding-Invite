// 書法（亮）：一張鋪在毛氈上的大宣紙，上面是一幅水墨桃花（「桃之夭夭，灼灼其華」，詩經裡嫁女兒的那一首），
// 毛筆把主打留言當成這幅畫的題款，一個字一個字寫在右邊的空白處，落款是署名，最後蓋一方紅印。
//  - 畫是場景（主視覺）：桃枝從畫面左緣伸進來，用「很多根筆毛」的方法畫（每一筆是十幾條細線，越往筆尾越乾、飛白），
//    開場時已經畫好主幹與一部分花；之後每一拍開一朵桃花（花瓣用 outBack 綻開），每個小節線長出一根新的小枝。
//    題款寫完、蓋好印之後，筆移到畫上，每一拍在枝上「點」一朵花（點梅的畫法）。
//  - 題款（留言）：中文為主直書、由右到左（標點掛在字的右上、括號轉向）；英文為主的留言改橫書。
//    標準 v2：字級 40～60、落款 26～32、題款整塊 ≤ 600 × 430；歌詞 40～52，在左下角的空白處逐字跟唱（手寫字）。
//  - 落筆在拍點：題款切成幾個詞組，每個詞組在一個拍點（詞組多就半拍）「沾一次墨」開始寫；同一個詞組越寫越乾，
//    後面的字有飛白。一個字的寫法是筆沿著字從上到下一橫一橫掃過去（中文沒有筆順資料，這是近似），寫好的字邊緣暈開一點點墨。
//  - 寫完的下一拍寫落款（「阿哲 敬賀」），再下一拍蓋印（白文「百年好合」，畫面震一下）。
//  - 開場前就畫好的部分（主幹、舊的花、標題）畫一次存起來；新開的花、新長的枝、正在寫的字、筆在另一張全螢幕圖層每格畫。
//    每個字的字模在 init 一次做好（軟體畫布）：每次重畫都重新光柵化的話，同一個時間點畫兩次可能差一兩個色階。
//  - 沒有留言：題款寫一句邀請（落款「新人 敬邀」）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, layout, loadText, measure } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, mulberry32, noise1, TAU } from '../engine/util';
import { lyricAt, drawLyric, layoutLyric, beatAfter, drawHeart, type LyricStyle } from './_motifs';
import { subRect, paperLyric, cjkRatio } from './_t13';
import { msgMaxFor, lyricV2, sigV2, V2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'craft', paper: true, energy: [0, 0.65], bars: [4, 8] };

// ---------------------------------------------------------------- 紙與版面（邏輯像素）
/** 宣紙的範圍（外面是毛氈）。 */
const SHEET = { x0: 76, x1: 1846, y0: 46, y1: 1034 };
/** 題款（留言＋落款＋印）的範圍：右邊的空白處（標準 v2：≤ 860 × 430）。 */
const MSG = { x0: 1130, x1: 1730, y0: 176, y1: 606 };
/** 寫好的字那一層。 */
const INK_R = { x: 1080, y: 120, w: 720, h: 580 };
/** 畫（桃枝）可以伸到的範圍：左邊到中間，不進題款與左下的歌詞。 */
const ART = { x0: 60, x1: 1090, y0: 120, y1: 870 };
/** 左下的歌詞。 */
const LYR = { x: 170, base: 962, w: 1000 };
const LYR_R = { x: 130, y: 850, w: 1100, h: 150 };
const FAM = F.hand(700);
const FAM_SIG = F.hand(400);
const INVITE = '請掃描右下角，把祝福題在這幅畫上。';
const FOOT = '＊墨跡未乾，請勿觸摸螢幕。';
const TITLE = '書畫 · 桃之夭夭';
const SEAL_TXT = ['百', '年', '好', '合'];

const PAPER = () => new FSPass(/* glsl */ `
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
    // 毛氈：深色的羊毛，細細的絨
    vec3 felt = mix(C_SEPIA, C_INK, 0.45) * (0.85 + 0.12 * fbm(p * 0.02, 3) + 0.06 * snoise(p * 0.9));
    // 宣紙：比一般的紙白一點、纖維明顯、雲狀的厚薄；左上來的窗光
    float f = fibres(p, 30.0);
    vec3 paper = mix(C_PAPER, C_BONE, 0.3) * (0.978 + 0.022 * cloud + 0.03 * f);
    paper *= 0.965 + 0.05 * (1.0 - vUv.x * 0.5) * vUv.y;
    vec2 sc = vec2(${(SHEET.x0 + SHEET.x1) / 2}.0, ${(SHEET.y0 + SHEET.y1) / 2}.0), sh = vec2(${(SHEET.x1 - SHEET.x0) / 2}.0, ${(SHEET.y1 - SHEET.y0) / 2}.0);
    float dS = sdBox(p - sc, sh);
    // 紙在毛氈上的影子
    felt *= 1.0 - 0.35 * (1.0 - smoothstep(-4.0, 16.0, sdBox(p - sc - vec2(6.0, 9.0), sh)));
    vec3 col = mix(paper, felt, smoothstep(-0.8, 0.8, dS));
    // 紙鎮：一條深色的木頭壓在紙的上緣，底下有影子
    vec2 wc = vec2(960.0, 62.0), wh = vec2(560.0, 18.0);
    float dW = sdBox(p - wc, wh) - 8.0;
    col *= 1.0 - 0.22 * (1.0 - smoothstep(-4.0, 18.0, sdBox(p - wc - vec2(8.0, 12.0), wh) - 8.0));
    vec3 wood = mix(C_SEPIA, C_INK, 0.35) * (0.8 + 0.2 * fbm(vec2(p.x * 0.004, p.y * 0.12), 3));
    wood += C_BONE * 0.07 * (1.0 - smoothstep(0.0, 3.0, abs(p.y - (wc.y - wh.y + 3.0))));
    col = mix(col, wood, 1.0 - smoothstep(-0.8, 0.8, dW));
    fragColor = vec4(col, 1.0);
  }`);

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

/** 一個要寫的字：中心 (x, y)、字級、開始與寫完的時間、乾的程度、筆的方向。 */
interface G { ch: string; x: number; y: number; s: number; fam: string; t0: number; t1: number; dry: number; ang: number; turn: boolean; small: boolean; bw: number; bh: number }
/** 直書的排版單位：一個字、掛在右上的小標點、一串轉 90° 的英文、空白。adv 是佔幾格（一格 = 字級 × 1.06）。 */
interface Tok { t: string; kind: 'char' | 'small' | 'run' | 'space'; adv: number }
/** 畫裡的一筆：點（含粗細）、開始長的時間與長多久（開場前就畫好的是 -Infinity）。 */
interface Stroke { pts: { x: number; y: number; w: number }[]; t0: number; dur: number; seed: number; ink: number }
/** 一朵桃花：位置、大小、轉角、顏色偏向、開的時間（開場前就開了的是 -Infinity）、是不是花苞。 */
interface Blossom { x: number; y: number; r: number; rot: number; hue: number; t: number; bud: boolean }

const PUNCT_SMALL = new Set(Array.from('，。、．,.'));
const PUNCT_TURN = new Set(Array.from('…～~ー—「」『』（）()《》〈〉【】-'));
const BREAK_AFTER = new Set(Array.from('，。！？、,.!?；;：:'));
const NO_START = new Set(Array.from('、。，．,.!?！？：；:;）)」』】〕〉》…～~ー♥'));

export default class Brush extends Scene {
  paper = shared('brush.paper', PAPER);
  /** 寫好的字（寫完的字數變了才重畫）。 */
  ink = this.track(new Layer2D(INK_R.w, INK_R.h, undefined, { fast: true }));
  /** 開場前就畫好的畫（主幹、舊的花、標題）：畫一次。 */
  art = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 每格畫：新長的枝、新開的花、正在寫的字、筆、蓋印的動作。 */
  wet = this.track(new Layer2D(W, H, undefined, { fast: true }));
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
  /** glyphs 最後幾個是落款。 */
  nSig = 0;
  strokes: Stroke[] = [];
  blossoms: Blossom[] = [];
  /** 蓋完印之後由筆點的花（開的時間在這之後）。 */
  dotFrom = Infinity;

  override async init() {
    const { audio: au, start, song } = this.ctx;
    const m = this.msg;
    const text = m ? m.text : INVITE;
    const sig = m ? (m.couple ? '新人 敬謝' : `${m.name || '一位賓客'} 敬賀`) : '新人 敬邀';
    await loadText(`${text}${sig}${FOOT}${TITLE}${SEAL_TXT.join('')}${song.title}`);
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
    this.buildPainting(t0);
    this.drawArt();
  }

  override dispose() {
    // 一晚會建幾百次：字模、印的畫布馬上還掉，不等 GC
    for (const cv of [this.sealCv, ...this.gcv]) if (cv) cv.width = cv.height = 0;
    this.gcv = [];
    super.dispose();
  }

  // ---------------------------------------------------------------- 題款排版
  /**
   * 直書：由右到左，行寬 = 字級 × 1.42。從字數決定的上限往下找最大的字級，讓題款＋落款放得進題款的範圍（高 430）。
   * 英文字、數字連成一串轉 90° 放（像直書的書本）。
   */
  private layoutVertical(text: string, sig: string) {
    const colH = MSG.y1 - MSG.y0;
    const bw = MSG.x1 - MSG.x0;
    let s: number = V2.msgMin, cols: Tok[][] = [];
    // 一行（直的）放得下幾格；標點可以掛在行尾，但「！！！」這種連續標點會一直掛下去、超出範圍：也要算進去
    const cells = (col: Tok[]) => col.reduce((a, tk) => a + tk.adv, 0);
    // 沒有留言時題的是邀請：焦點是歌詞，邀請的字不比歌詞大
    for (let size = this.msg ? msgMaxFor(text) : 48; size >= V2.msgMin; size -= 2) {
      const cap = colH / (size * 1.06);
      const cs = breakCols(toks(text, size), cap);
      s = size; cols = cs;
      if ((cs.length + 1) * size * 1.42 <= bw && cs.every((col) => cells(col) <= cap + 0.1)) break;
    }
    const cw = s * 1.42;
    const colX = (i: number) => MSG.x1 - cw * (i + 0.5);
    const put = (tk: Tok, x: number, top: number, size: number, fam: string) => {
      const L = tk.adv * size * 1.06;
      if (tk.kind === 'space') return;
      const small = tk.kind === 'small';
      const run = tk.kind === 'run';
      this.glyphs.push({
        ch: tk.t, x: x + (small ? size * 0.3 : 0), y: small ? top + size * 0.1 : top + L / 2, s: size, fam, t0: 0, t1: 0, dry: 0, ang: 0,
        turn: run || PUNCT_TURN.has(tk.t), small, bw: size * 1.1, bh: run ? L : size * 1.1,
      });
    };
    cols.forEach((col, ci) => {
      let top = MSG.y0;
      for (const tk of col) { put(tk, colX(ci), top, s, FAM); top += tk.adv * s * 1.06; }
    });
    // 落款：下一行、靠下，字小一點（26～32）；印蓋在落款下面
    const sealS = Math.round(clamp(s * 1.1, 48, 64));
    const room = colH - sealS - 30;
    let ss = sigV2(s), st = toks(sig, ss, FAM_SIG);
    const lenOf = (ts: Tok[], z: number) => ts.reduce((a, tk) => a + tk.adv, 0) * z * 1.06;
    while (ss > V2.sigMin && lenOf(st, ss) > room) { ss -= 1; st = toks(sig, ss, FAM_SIG); }
    const len = lenOf(st, ss);
    const x = colX(cols.length) + cw * 0.15;
    let top = Math.max(MSG.y0 + s * 0.8, MSG.y1 - sealS - 16 - len);
    const before = this.glyphs.length;
    for (const tk of st) { put(tk, x, top, ss, FAM_SIG); top += tk.adv * ss * 1.06; }
    this.nSig = this.glyphs.length - before;
    this.seal = { x, y: Math.min(MSG.y1 - sealS / 2, top + 12 + sealS / 2), s: sealS, t: Infinity, rot: -0.04 };
  }

  /** 橫書（英文為主）：在題款的範圍裡由左到右，一列一行；署名靠右、印在署名右邊。 */
  private layoutHorizontal(text: string, sig: string) {
    const c = this.ink.ctx;
    const maxW = MSG.x1 - MSG.x0;
    let s: number = V2.msgMin, lines: string[] = [text];
    for (let size = this.msg ? msgMaxFor(text) : 48; size >= V2.msgMin; size -= 2) {
      c.font = font(FAM, size);
      const ls = wrapWords(c, text, maxW);
      s = size; lines = ls;
      if (ls.length * size * 1.5 + size * 1.6 <= MSG.y1 - MSG.y0) break;
    }
    const rh = s * 1.5;
    lines.forEach((ln, li) => {
      const lay = layout(ln, FAM, s);
      const base = MSG.y0 + s + li * rh;
      for (const g of lay.glyphs) {
        if (g.ch === ' ') continue;
        this.glyphs.push({ ch: g.ch, x: MSG.x0 + g.x + g.w / 2, y: base - s * 0.34, s, fam: FAM, t0: 0, t1: 0, dry: 0, ang: 0, turn: false, small: false, bw: Math.max(g.w, s * 0.4) + 6, bh: s * 1.1 });
      }
    });
    const ss = sigV2(s);
    const sigText = `—— ${sig.replace(/ 敬.*$/, '')}`;
    const sl = layout(sigText, FAM_SIG, ss);
    const sealS = 54;
    const base = MSG.y0 + s + lines.length * rh + ss * 0.4;
    const x0 = MSG.x1 - sealS - 20 - sl.width;
    const before = this.glyphs.length;
    for (const g of sl.glyphs) {
      if (g.ch === ' ') continue;
      this.glyphs.push({ ch: g.ch, x: x0 + g.x + g.w / 2, y: base - ss * 0.34, s: ss, fam: FAM_SIG, t0: 0, t1: 0, dry: 0, ang: 0, turn: false, small: false, bw: Math.max(g.w, ss * 0.4) + 6, bh: ss * 1.1 });
    }
    this.nSig = this.glyphs.length - before;
    this.seal = { x: MSG.x1 - sealS / 2, y: base - ss * 0.34, s: sealS, t: Infinity, rot: 0.035 };
  }

  // ---------------------------------------------------------------- 時間
  /**
   * 題款切成詞組（標點後、或滿四個字／一個英文字），每個詞組在拍點（太多就半拍）沾墨開始寫；
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
    tail.forEach((g, i) => { g.t0 = ts + i * 0.12; g.t1 = g.t0 + 0.11; g.dry = 0.15 + 0.4 * (i / Math.max(1, tail.length - 1)); g.ang = 0.1; end = g.t1; });
    this.seal.t = beatAfter(au, end + 0.1);
  }

  // ---------------------------------------------------------------- 畫（桃枝與桃花）
  /**
   * 桃枝：主幹從畫面左緣斜斜伸進來往右上，兩根大枝，幾十根往上翹的小枝（桃、梅的小枝是直的，像鞭子）。
   * 形狀固定（構圖要好看），細節用種子抖動；開場前就畫好主幹、大枝與一半的小枝、花；
   * 之後每個小節線長一根新小枝、每一拍開一朵花（蓋完印之後的花由筆點出來）。
   */
  private buildPainting(t0: number) {
    const au = this.ctx.audio;
    const rnd = mulberry32(((this.ctx.params.seed ?? 5) * 7919) >>> 0);
    const wobble = (ctrl: [number, number][], w0: number, w1: number): { x: number; y: number; w: number }[] => {
      const out: { x: number; y: number; w: number }[] = [];
      const n = (ctrl.length - 1) * 6;
      for (let i = 0; i <= n; i++) {
        const u = i / n, k = u * (ctrl.length - 1), j = Math.min(ctrl.length - 2, Math.floor(k)), fr = k - j;
        const a = ctrl[j]!, b = ctrl[j + 1]!;
        const jit = i % 6 === 0 ? 0 : (rnd() - 0.5) * 8;
        const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
        out.push({ x: a[0] + dx * fr - (dy / L) * jit, y: a[1] + dy * fr + (dx / L) * jit, w: (w0 + (w1 - w0) * u) * (0.9 + 0.2 * rnd()) });
      }
      return out;
    };
    const pre = -Infinity;
    const trunk = wobble([[20, 830], [300, 700], [500, 575], [690, 520], [860, 390], [1000, 300]], 46, 12);
    const b1 = wobble([[300, 700], [370, 540], [345, 400], [420, 270], [395, 170]], 24, 6);
    const b2 = wobble([[690, 520], [810, 600], [960, 612], [1060, 690]], 16, 5);
    this.strokes.push({ pts: trunk, t0: pre, dur: 0, seed: 1, ink: 0.92 }, { pts: b1, t0: pre, dur: 0, seed: 2, ink: 0.85 }, { pts: b2, t0: pre, dur: 0, seed: 3, ink: 0.8 });
    // 小枝：從大枝上長出來，往上翹（方向在「沿著枝」與「往上」之間）
    const twigs: Stroke[] = [];
    const mains = [trunk, b1, b2];
    for (let k = 0; k < 40 && twigs.length < 22; k++) {
      const base = mains[Math.floor(rnd() * mains.length)]!;
      const i = 3 + Math.floor(rnd() * (base.length - 5));
      const p = base[i]!, q = base[i + 1]!;
      const along = Math.atan2(q.y - p.y, q.x - p.x);
      const side = rnd() < 0.5 ? -1 : 1;
      const ang = along * 0.45 + (-Math.PI / 2) * 0.55 + side * (0.25 + 0.5 * rnd());
      const L = 60 + 90 * rnd();
      const ex = p.x + Math.cos(ang) * L, ey = p.y + Math.sin(ang) * L;
      if (ex < ART.x0 + 40 || ex > ART.x1 || ey < ART.y0 || ey > ART.y1) continue;
      const mx = p.x + Math.cos(ang - 0.08 * side) * L * 0.55, my = p.y + Math.sin(ang - 0.08 * side) * L * 0.55;
      const w0 = Math.min(p.w * 0.45, 9);
      twigs.push({ pts: [{ x: p.x, y: p.y, w: w0 }, { x: mx, y: my, w: w0 * 0.6 }, { x: ex, y: ey, w: 1.4 }], t0: pre, dur: 0, seed: 10 + k, ink: 0.8 });
    }
    // 後面 8 根是這個窗格裡、每個小節線長出來的
    const bar0 = Math.ceil(au.barAt(t0) - 1e-6);
    twigs.forEach((tw, i) => {
      const j = i - (twigs.length - 8);
      if (j >= 0) {
        tw.t0 = au.timeOfBar(bar0 + 1 + j) + 0.02;
        tw.dur = Math.min(0.5, (au.timeOfBar(bar0 + 2 + j) - au.timeOfBar(bar0 + 1 + j)) * 0.4);
      }
    });
    this.strokes.push(...twigs);
    // 花：開在大枝與舊小枝的旁邊（新長的小枝尾巴上是花苞）
    const spots: { x: number; y: number }[] = [];
    const hosts = [trunk, b1, b2, ...twigs.filter((tw) => tw.t0 === pre).map((tw) => tw.pts)];
    for (let k = 0; spots.length < 64 && k < 400; k++) {
      const h = hosts[Math.floor(rnd() * hosts.length)]!;
      const i = Math.floor(rnd() * (h.length - 1)) + (h === trunk ? 8 : 0);
      const p = h[Math.min(h.length - 1, i)]!;
      const a = rnd() * TAU, d = p.w * 0.5 + 6 + 10 * rnd();
      const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
      if (x < ART.x0 + 40 || x > ART.x1 || y < ART.y0 || y > ART.y1) continue;
      if (spots.some((s) => Math.hypot(s.x - x, s.y - y) < 30)) continue;
      spots.push({ x, y });
    }
    // 開的時間：前 24 朵開場前就開了；之後每一拍一朵
    const b0 = au.beatAt(t0);
    const endB = au.beatAt(this.ctx.end - 0.15);
    spots.forEach((sp, i) => {
      const j = i - 24;
      const tb = j < 0 ? pre : b0 + j <= endB ? au.timeOfBeat(Math.round(b0) + j) : Infinity;
      this.blossoms.push({ x: sp.x, y: sp.y, r: 11 + 7 * rnd(), rot: rnd() * TAU, hue: rnd(), t: tb, bud: rnd() < 0.18 });
    });
    for (const tw of twigs.slice(-8)) {
      const e = tw.pts[tw.pts.length - 1]!;
      this.blossoms.push({ x: e.x, y: e.y, r: 6, rot: 0, hue: 0.6, t: tw.t0 + tw.dur, bud: true });
    }
    this.dotFrom = this.seal.t + 0.4;
  }

  /** 開場前就畫好的部分：標題、主幹、大枝、舊的小枝、已經開的花（畫一次）。 */
  private drawArt() {
    const L = this.art, c = L.ctx;
    L.clear();
    c.font = font(F.hei(500), 20);
    c.letterSpacing = '6px';
    c.fillStyle = rgba('sepia', 0.5);
    c.fillText(TITLE, 150, 140);
    c.letterSpacing = '0px';
    // 墨暈：大枝底下先淡淡地暈一層（宣紙吃墨）
    c.save();
    c.filter = 'blur(3px)';
    for (const s of this.strokes) if (s.t0 === -Infinity && s.pts[0]!.w > 10) paintBody(c, s.pts, 1, mixRgba('sepia', 'ink', 0.4, 0.14), 1.35);
    c.restore();
    for (const s of this.strokes) if (s.t0 === -Infinity) paintStroke(c, s, 1, true);
    // 苔點：主幹上幾顆濃墨點
    const trunk = this.strokes[0]!.pts;
    for (let i = 0; i < 12; i++) {
      const p = trunk[4 + ((i * 7) % (trunk.length - 8))]!;
      c.fillStyle = mixRgba('sepia', 'ink', 0.7, 0.85);
      c.beginPath(); c.arc(p.x + (hash(i, 1) - 0.5) * p.w, p.y - p.w * 0.45 - 2, 2 + 2.5 * hash(i, 2), 0, TAU); c.fill();
    }
    for (const b of this.blossoms) if (b.t === -Infinity) drawBlossom(c, b, 1);
    L.upload();
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

  // ---------------------------------------------------------------- 字
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
    this.paper.render(renderer, out);
    comp.draw(renderer, this.art.texture, out);

    // ---- 寫好的字（含落好的印）
    const done = this.glyphs.filter((g) => t >= g.t1).length;
    const sealIn = t >= this.seal.t + 0.14;
    const key = `${done}|${sealIn}`;
    if (key !== this.inkKey) { this.inkKey = key; this.drawInk(done, sealIn); }
    comp.draw(renderer, this.ink.texture, out, { ...subRect(INK_R), opacity: vis });

    // ---- 新長的枝、新開的花、正在寫的字、筆、蓋印
    const shake = this.drawWet(t, vis, f);
    comp.draw(renderer, this.wet.upload(), out);

    // ---- 歌詞
    this.drawLyr(t, vis, lyricAt(lyrics, t));
    comp.draw(renderer, this.lyr.upload(), out, subRect(LYR_R));

    return {
      // 色差調小：紙的邊緣壓在深色毛氈上，預設的色差會在紙邊出現一條藍邊
      paper: 1, bloom: 0.3, bloomThreshold: 0.98, bloomKnee: 0.12, halation: 0.08, vignette: 0.22, grain: 0.055, ca: 0.4,
      shake: [shake * noise1(t * 60, 3) * 5, shake * noise1(t * 57, 4) * 5],
      zoom: 1 + 0.03 * ease.inOutCubic(f.p) + 0.003 * f.a.kick,
      popupAvoid: [[MSG.x0 - 20, MSG.y0 - 20, MSG.x1 - MSG.x0 + 40, MSG.y1 - MSG.y0 + 40], [LYR.x - 20, LYR.base - 80, LYR.w + 40, 110]],
    };
  }

  private drawInk(done: number, sealIn: boolean) {
    const L = this.ink, c = L.ctx;
    L.clear();
    c.save();
    c.translate(-INK_R.x, -INK_R.y);
    for (let i = 0; i < done; i++) this.drawGlyph(c, this.glyphs[i]!, this.gcv[i]!);
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

  /** 每格：新長的小枝、新開的花、正在寫的字（一橫一橫掃過去）、剛寫好的濕墨、毛筆、蓋印。回傳畫面震動量。 */
  private drawWet(t: number, vis: number, f: Frame): number {
    const L = this.wet, c = L.ctx;
    L.clear();
    c.save();
    c.globalAlpha = vis;
    // 新長的小枝（小節線上長出來，outCubic）、新開的花（拍點上綻開，outBack）
    for (const s of this.strokes) if (s.t0 !== -Infinity && t >= s.t0) paintStroke(c, s, ease.outCubic(clamp((t - s.t0) / s.dur)));
    for (const b of this.blossoms) {
      if (b.t === -Infinity || t < b.t) continue;
      drawBlossom(c, b, ease.outBack(clamp((t - b.t) / 0.28)));
    }
    let tip: { x: number; y: number; press: number } | null = null;
    const gi = this.glyphs.findIndex((g) => t >= g.t0 && t < g.t1);
    if (gi >= 0) {
      const g = this.glyphs[gi]!;
      const u = clamp((t - g.t0) / (g.t1 - g.t0));
      // 掃過去的路線：四橫（直書、橫書都一樣，由上而下），每一橫由左到右
      const bw = g.bw, bh = g.bh, rows = Math.max(4, Math.round((4 * bh) / bw)), x0 = g.x - bw / 2, y0 = g.y - bh / 2;
      const R = (bh / rows) * 0.8;
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
      const k = Math.min(rows - 1e-6, u * rows), ri = Math.floor(k), fr = k - ri;
      tip = { x: x0 + fr * bw + R * 0.2, y: y0 + (ri + 0.5) * (bh / rows), press: 1 - g.dry * 0.5 };
    } else {
      let last: G | null = null;
      for (const g of this.glyphs) if (g.t1 <= t) last = g;
      const next = this.glyphs.find((g) => g.t0 > t);
      if (last && next && next.t0 - last.t1 < 1.5) {
        // 兩個詞組之間：筆提起來，移到下一個字
        const k = ease.inOutCubic(clamp((t - last.t1) / Math.max(0.05, next.t0 - last.t1)));
        tip = { x: last.x + (next.x - next.s * 0.5 - last.x) * k, y: last.y + (next.y - next.s * 0.5 - last.y) * k, press: 0 };
      } else if (!last && next) {
        // 開場：筆從右上方畫面外飛進來
        const k = ease.outExpo(prog(t, this.ctx.start, next.t0));
        tip = { x: next.x - next.s * 0.5 + 260 * (1 - k), y: next.y - next.s * 0.5 - 220 * (1 - k), press: 0 };
      } else if (last && t >= this.dotFrom - 0.6) {
        // 題完款、蓋好印：筆移到畫上，每一拍點一朵花
        tip = this.dotTip(t, last);
      } else if (last) {
        tip = { x: last.x + 20, y: last.y - 30, press: 0 };
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
    void f;
    return shake;
  }

  /** 點花：筆在前一朵與下一朵（開的時間在 dotFrom 之後）之間移動，拍點上壓下去。 */
  private dotTip(t: number, last: G): { x: number; y: number; press: number } {
    const list = this.blossoms.filter((b) => !b.bud && b.t >= this.dotFrom && b.t !== Infinity);
    const nextI = list.findIndex((b) => b.t + 0.12 > t);
    const prev = nextI > 0 ? list[nextI - 1]! : nextI === -1 ? list[list.length - 1] : null;
    const next = nextI >= 0 ? list[nextI]! : null;
    const from = prev ? { x: prev.x, y: prev.y, t: prev.t + 0.12 } : { x: last.x + 20, y: last.y - 30, t: this.dotFrom - 0.6 };
    if (!next) return { x: from.x + 6, y: from.y - 18, press: 0 };
    const k = ease.inOutCubic(clamp((t - from.t) / Math.max(0.05, next.t - 0.06 - from.t)));
    const press = Math.max(0, 1 - Math.abs(t - next.t) / 0.1);
    // 移動時筆提高一點（y 往上 16），拍點上壓下去
    return { x: from.x + (next.x - from.x) * k, y: from.y + (next.y - from.y) * k - 16 * (1 - press), press };
  }

  /** 毛筆：筆尖（墨色的尖毫）、金屬箍、竹桿。題款時桿往左上（直書）或右下（橫書），點花時往右上。 */
  private drawBrush(c: CanvasRenderingContext2D, x: number, y: number, press: number) {
    const w0 = this.vert ? { x: -0.5, y: -0.866 } : { x: 0.42, y: 0.907 }, w1 = { x: 0.5, y: -0.866 };
    const rk = clamp((1100 - x) / 200);
    const dx0 = w0.x + (w1.x - w0.x) * rk, dy0 = w0.y + (w1.y - w0.y) * rk, dl = Math.hypot(dx0, dy0) || 1;
    const dir = { x: dx0 / dl, y: dy0 / dl };
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
      // 歌詞比題款小一點（題款是焦點）
      const st: LyricStyle = { family: F.hand(700), size: lyricV2(this.msg ? this.glyphs[0]?.s ?? null : null), minSize: V2.lyrMin, maxWidth: LYR.w, ...paperLyric() };
      const lay = layoutLyric(c, ly.line, st);
      const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.2));
      c.translate(LYR.x, LYR.base - (lay.height - lay.size) + (1 - inK) * 16);
      drawLyric(c, ly.line, t, st, lay, ly.k * vis);
    } else {
      const { song } = this.ctx;
      c.font = font(F.mono(500), 16);
      c.letterSpacing = '4px';
      c.fillStyle = rgba('sepia', 0.5);
      c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`.toUpperCase(), LYR.x, LYR.base - 40);
      c.letterSpacing = '0px';
      c.font = font(F.hei(500), 20);
      c.fillStyle = rgba('sepia', 0.45);
      c.fillText(FOOT, LYR.x, LYR.base);
    }
    c.restore();
  }
}

/** 一筆的「墨身」：沿著點畫一條有粗細的帶子（到 frac 為止），scale 是寬度倍數。 */
function paintBody(c: CanvasRenderingContext2D, pts: { x: number; y: number; w: number }[], frac: number, fill: string, scale: number) {
  const n = pts.length, last = Math.max(1, Math.floor(frac * (n - 1)));
  const L: { x: number; y: number }[] = [], R: { x: number; y: number }[] = [];
  for (let i = 0; i <= last; i++) {
    const p = pts[i]!, a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(n - 1, i + 1)]!;
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
    const hw = (p.w * scale) / 2;
    L.push({ x: p.x - (dy / d) * hw, y: p.y + (dx / d) * hw });
    R.push({ x: p.x + (dy / d) * hw, y: p.y - (dx / d) * hw });
  }
  c.fillStyle = fill;
  c.beginPath();
  L.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
  for (let i = R.length - 1; i >= 0; i--) c.lineTo(R[i]!.x, R[i]!.y);
  c.closePath();
  c.fill();
}

/**
 * 畫一筆（到 frac 為止）：先一條濃墨的墨身，中間隨機幾段再疊一層更濃的（墨汁積在那裡）；
 * dry = true 時再用「筆毛」細線把筆尾挖出幾道白（飛白），越往筆尾、越靠兩側越乾。斷不斷由雜湊決定（確定性）。
 * 挖白用 destination-out：只給開場前就畫好的那一層用（那時候花還沒畫上去）。
 */
function paintStroke(c: CanvasRenderingContext2D, s: Stroke, frac: number, dry = false) {
  if (frac <= 0) return;
  const pts = s.pts, n = pts.length;
  paintBody(c, pts, frac, mixRgba('sepia', 'ink', 0.8, Math.min(1, 1.04 * s.ink)), 1);
  // 積墨：幾段比較濃
  const last = Math.floor(frac * (n - 1));
  for (let i = 0; i < last; i += 3) {
    if (hash(s.seed, i, 7) < 0.55) continue;
    paintBody(c, pts.slice(i, Math.min(last, i + 3) + 1), 1, mixRgba('ink', 'sepia', 0.2, 0.35), 0.55);
  }
  if (!dry || pts[0]!.w < 6) return;
  const NB = pts[0]!.w > 20 ? 11 : 6;
  c.save();
  c.globalCompositeOperation = 'destination-out';
  c.lineCap = 'round';
  for (let b = 0; b < NB; b++) {
    const o = (b + 0.5) / NB - 0.5;
    let pen = false;
    c.beginPath();
    for (let i = 0; i <= last; i++) {
      const p = pts[i]!, a = pts[Math.max(0, i - 1)]!, q = pts[Math.min(n - 1, i + 1)]!;
      const dx = q.x - a.x, dy = q.y - a.y, d = Math.hypot(dx, dy) || 1;
      const u = i / (n - 1);
      // 挖白的機率：筆頭幾乎不挖、筆尾與兩側挖得多
      const gap = Math.max(0, (u - 0.4) * 1.2) + 0.3 * Math.abs(o) * u;
      if (hash(s.seed, b, i) > gap) { if (pen) { c.stroke(); c.beginPath(); } pen = false; continue; }
      const x = p.x - (dy / d) * o * p.w, y = p.y + (dx / d) * o * p.w;
      if (pen) c.lineTo(x, y); else c.moveTo(x, y);
      pen = true;
      c.lineWidth = Math.max(0.7, (p.w / NB) * 0.5);
      c.strokeStyle = `rgba(0,0,0,${0.55 + 0.4 * hash(s.seed, b, 9)})`;
    }
    if (pen) c.stroke();
  }
  c.restore();
}

/** 一朵桃花（k 是綻開的程度，可以超過 1 一點點：outBack）：五片花瓣疊出水彩的深淺，花心幾根花蕊；花苞是一顆小點。 */
function drawBlossom(c: CanvasRenderingContext2D, b: Blossom, k: number) {
  if (k <= 0.01) return;
  const col = mixRgba('signal', 'blood', 0.25 + 0.45 * b.hue, 0.62);
  c.save();
  c.translate(b.x, b.y);
  c.rotate(b.rot);
  c.scale(k, k);
  if (b.bud) {
    c.fillStyle = mixRgba('signal', 'blood', 0.6, 0.85);
    c.beginPath(); c.ellipse(0, 0, b.r * 0.5, b.r * 0.7, 0, 0, TAU); c.fill();
    c.restore();
    return;
  }
  c.fillStyle = col;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    c.beginPath(); c.arc(Math.cos(a) * b.r * 0.62, Math.sin(a) * b.r * 0.62, b.r * 0.58, 0, TAU); c.fill();
  }
  c.strokeStyle = mixRgba('sepia', 'ink', 0.5, 0.75);
  c.fillStyle = mixRgba('sepia', 'ink', 0.5, 0.85);
  c.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3, L = b.r * (0.55 + 0.2 * (i % 2));
    c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * L, Math.sin(a) * L); c.stroke();
    c.beginPath(); c.arc(Math.cos(a) * L, Math.sin(a) * L, 1.6, 0, TAU); c.fill();
  }
  c.restore();
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
