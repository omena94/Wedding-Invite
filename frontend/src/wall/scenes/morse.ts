// 摩斯電報（批次 T10・機器 D，暗）：深夜的電報局，桌上一支黃銅電報鍵，一條紙帶從收報機裡一直往左走。
//  - 主打留言一個字一個字發出去：每個字的第一下落在拍點上（短留言一拍一字，長的一拍兩、四、八字），電報鍵在每一個點、劃按下去，
//    接點冒一下火花；右邊收報機的針把點與劃壓在紙帶上（剛壓上去是燒紅的訊號色，一秒內冷成墨色），紙帶帶著它們往左走。
//    英文照真的摩斯碼；中文照老電報的做法：每個字先換成四位數的「電碼」，再用摩斯的短數字發（電碼是本局自編的，
//    愛心固定是 0520）。
//  - 下面是一張電報紙（印好格子的稿紙）：每個字發完，譯文就填進一格——上面小小的電碼（或英文的點劃），下面是那個字。
//    全部發完後，電報紙下面寫署名（發報人）。沒有留言：本局發一封邀請。
//  - 最上面是「收訊紀錄」：歌詞一行一行進來（逐字跟唱），比留言小一級。純音樂：紀錄寫「本段收訊：純音樂」與歌名。
// 手法：桌面、檯燈的光、紙帶（纖維跟著走）是一個 shader；點與劃是 LineBatch（墨色＋燒紅的加亮）；
// 電報鍵是每格用 Canvas 畫的版畫線稿（槓桿繞著後面的軸轉）；電報紙的格子與表頭畫一次。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba, LIN } from '../engine/palette';
import { clamp, ease, prog, lerp, window01, TAU } from '../engine/util';
import { tokens } from '../engine/text';
import { Lyrics, type Word } from '../engine/lyrics';
import { lyricAt, layoutLyric, drawLyric, sparkHead, sparkParticles, beatAfter, drawHeart, signature, COUPLE_ZH } from './_motifs';
import { stagger, bbox, pad3 } from './_t11';
import { windowLines, type Rect } from './_t10';
import { msgMaxFor, lyricV2, sigV2, V2 } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'machine', paper: false, energy: [0.25, 1], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 版面（邏輯像素，y 向下）
// 收訊紀錄（歌詞）：比電報紙上的留言小一級（MV 原則：焦點是留言）
const LOG = { x: 140, y: 100, w: 1200, base: 206 }; // 字級照標準 v2（lyricV2）
const TAPE = { y0: 330, y1: 396 }; // 紙帶
const PEN_X = 1290; // 收報機的針（紙帶往左走）
// 電報紙的格子（下面留一列給署名）
// 標準 v2：電報紙（留言區）連署名寬 ≤ 860、高 ≤ 430，字級 40～60
const GRID = { x: 140, y: 470, w: 760, h: 350 };
const KEY = { x: 996, y: 700 }; // 電報鍵（底座左上）
const KEY_PIVOT = { x: 1296, y: 866 }; // 槓桿的轉軸
const LEVER_L = 286; // 轉軸到按鈕的距離
const CONTACT_X = 1150; // 接點
/** 電報鍵整組放大 KS 倍（以底座右下角 KA 為中心）：側面的鍵本來很扁，放大才看得到按鈕在動。 */
const KS = 1.3, KA = { x: 1348, y: 944 };
const toKey = (p: { x: number; y: number }) => ({ x: KA.x + (p.x - KA.x) * KS, y: KA.y + (p.y - KA.y) * KS });
/** 紙帶平常的速度（px/秒）。 */
const V_IDLE = 250;

// ---------------------------------------------------------------- 摩斯碼
const MORSE: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--',
  N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', '!': '-.-.--', '&': '.-...', "'": '.----.', '-': '-....-', '/': '-..-.', '(': '-.--.',
  ')': '-.--.-', ':': '---...', ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '"': '.-..-.', '@': '.--.-.',
};
/** 短數字（老電報省時間的寫法）：0 = −、1 = ·−…9 = −·。 */
const CUT = ['-', '.-', '..-', '...-', '....-', '.', '-....', '-...', '-..', '-.'];
const PUNCT: Record<string, string> = { '，': ',', '。': '.', '！': '!', '？': '?', '、': ',', '～': '-', '~': '-', '：': ':', '；': ';', '（': '(', '）': ')', '「': '"', '」': '"', '…': '.', '’': "'", '‘': "'", '“': '"', '”': '"' };

interface Glyph { ch: string; show: string; code: string; morse: string[]; space: boolean }
/** 一個字 → 要發的碼：英文、數字、標點照摩斯；中文換成四位數電碼（本局自編，確定性）；愛心 0520。 */
function encode(ch: string): Glyph {
  if (ch === ' ') return { ch, show: '', code: '', morse: [], space: true };
  const up = ch.toUpperCase();
  const p = PUNCT[ch] ?? ch;
  if (MORSE[up]) return { ch, show: up, code: MORSE[up]!, morse: [MORSE[up]!], space: false };
  if (MORSE[p]) return { ch, show: ch, code: MORSE[p]!, morse: [MORSE[p]!], space: false };
  const cp = ch.codePointAt(0) ?? 0;
  const code = ch === '♥' ? '0520' : String(((cp * 2654435761) >>> 0) % 10000).padStart(4, '0');
  return { ch, show: ch, code, morse: Array.from(code, (d) => CUT[+d]!), space: false };
}

interface Mark { t0: number; t1: number; dash: boolean; p0: number; p1: number; src: 'msg' | 'lyr' | 'test'; word?: Word }
/**
 * 一串碼（每個元素是一組點劃，例如一位數字或一個字母）排成點劃的時間：點 1 單位、劃 3、點劃之間 1、組與組之間 3。
 * dur 秒內發完（單位最長 maxUnit 秒）。回傳點劃、每一組發完的時間、結束時間、單位長度。
 */
function sendCode(code: string[], t0: number, dur: number, maxUnit: number, src: Mark['src'], word?: Word) {
  const units = code.reduce((a, d, i) => a + (i ? 3 : 0) + Array.from(d).reduce((b, c, j) => b + (j ? 1 : 0) + (c === '-' ? 3 : 1), 0), 0);
  const unit = Math.min(maxUnit, dur / Math.max(1, units));
  const marks: Omit<Mark, 'p0' | 'p1'>[] = [];
  const digitT: number[] = [];
  let tt = t0;
  code.forEach((d, i) => {
    if (i) tt += 3 * unit;
    Array.from(d).forEach((c, j) => {
      if (j) tt += unit;
      const len = (c === '-' ? 3 : 1) * unit;
      marks.push({ t0: tt, t1: tt + len, dash: c === '-', src, word });
      tt += len;
    });
    digitT.push(tt);
  });
  return { marks, digitT, end: tt, unit };
}

interface Cell { g: Glyph; col: number; row: number; tSend: number; tDone: number; digitT: number[] }

const INVITE = '掃描右下角 QR code，發一封電報給新人。';
const TEXT = `收訊紀錄收報人發報人字數編號本局電碼本段收訊純音樂喜訊電報局速度字每分鐘譯文${INVITE}${COUPLE_ZH}＊中文依本局電碼簿發送：♥＝0520新人`;

// ---------------------------------------------------------------- 桌面、檯燈、紙帶
const BG = () => new FSPass(/* glsl */ `
  uniform float t; uniform float scroll; uniform float k; uniform float lamp;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 深色的木頭桌面：很淡的木紋
    float g = fbm(vec2(p.x * 0.0012, p.y * 0.012), 3);
    vec3 col = mix(C_INK, C_INK2 * 1.2, 0.5 + 0.35 * g);
    // 檯燈：右下（電報鍵那裡）一圈暖光，左上的電報紙也分到一點
    float l1 = exp(-length((p - vec2(1160.0, 820.0)) / vec2(620.0, 420.0)));
    float l2 = exp(-length((p - vec2(520.0, 720.0)) / vec2(900.0, 520.0)));
    col += (C_SIGNAL * 0.05 + C_BONE * 0.03) * l1 * lamp + C_BONE * 0.018 * l2;
    // 紙帶：米色的窄紙條，纖維跟著紙帶往左走
    if (p.y > ${TAPE.y0}.0 && p.y < ${TAPE.y1}.0) {
      vec2 q = vec2(p.x + scroll, p.y);
      float fib = snoise(vec2(q.x * 0.05, q.y * 0.6)) * 0.5 + snoise(vec2(q.x * 0.2, q.y * 0.15)) * 0.25;
      vec3 paper = mix(C_BONE, C_ASH, 0.42) * (0.78 + 0.05 * fib);
      // 檯燈在右邊：紙帶越往左越暗，不會變成一條滿版的亮帶搶走留言
      paper *= 0.22 + 0.78 * smoothstep(0.0, 1500.0, p.x);
      // 上下緣暗一點（紙的厚度與陰影）
      float e = min(p.y - ${TAPE.y0}.0, ${TAPE.y1}.0 - p.y);
      paper *= 0.75 + 0.25 * smoothstep(0.0, 4.0, e);
      col = mix(col, paper * k, k);
    }
    // 紙帶的影子
    col *= 1.0 - 0.45 * smoothstep(0.0, 1.0, 1.0 - abs(p.y - ${TAPE.y1 + 6}.0) / 7.0) * step(${TAPE.y1}.0, p.y) * k;
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 }, scroll: { value: 0 }, k: { value: 1 }, lamp: { value: 1 } });

export default class Morse extends Scene {
  bg = shared('morse.bg', BG);
  /** 不會變的：電報紙的格子、表頭、註腳、收訊紀錄的標題（畫一次）。 */
  base = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 每格重畫：歌詞、填進格子的字、電報鍵、電線。 */
  dyn = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 剛填進去的字、正在唱的字的光暈（半解析度）。 */
  hot = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  ink = this.track(new LineBatch(3000, { screen2D: true, blend: 'normal' }));
  glow = this.track(new LineBatch(3000, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  body = '';
  cells: Cell[] = [];
  marks: Mark[] = [];
  S = 60; cw = 70; chh = 96; cols = 10; rows = 1;
  /** 紙帶的位置（從窗格開始走了幾 px）：發留言時跑得快、平常慢，先積分成一張表。 */
  private tapeT0 = 0; private tape = new Float32Array(1);
  tFirst = 0; tLast = 0; beat = 0.5;
  hasLyrics = false;
  wpm = 20;
  avoid: Rect[] = [];
  sender = '';
  /** 署名、歌詞的字級（標準 v2）。 */
  sigSize = 30; lyrSize = 52;
  private baseUp = false;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.body = m ? m.text : INVITE;
    const sender = m ? (m.couple ? '新人' : m.name || '一位賓客') : '喜訊電報局';
    await loadText(`${TEXT}${this.body.toUpperCase()}${sender}${song.title}${song.artist}`);
    this.beat = au.beatPeriod(s + 0.1);
    this.hasLyrics = windowLines(lyrics, s, e).length > 0;

    // ---- 電報紙：找最大的格子（英文不拆字、標點跟著前一個字）
    const toks = tokens(this.body);
    const place = (S: number) => {
      const cw = Math.round(S * 1.2), chh = Math.round(S * 1.18 + 26);
      const cols = Math.max(4, Math.floor(GRID.w / cw));
      const pos: { col: number; row: number; ch: string }[] = [];
      let col = 0, row = 0;
      for (const tk of toks) {
        const chars = Array.from(tk);
        const body = Array.from(tk.trimEnd());
        if (col > 0 && col + body.length > cols && body.length <= cols) { row++; col = 0; }
        for (const ch of chars) {
          if (ch === ' ' && col === 0) continue;
          if (col >= cols) { row++; col = 0; if (ch === ' ') continue; }
          pos.push({ col, row, ch });
          col++;
        }
      }
      const rows = row + 1;
      return { cw, chh, cols, rows, pos, ok: rows * chh <= GRID.h && rows <= 6 };
    };
    let lo: number = V2.msgMin, hi = msgMaxFor(this.body) + 0.5, best = place(lo);
    for (let k = 0; k < 10; k++) { const mid = (lo + hi) / 2, r = place(mid); if (r.ok) { best = r; lo = mid; } else hi = mid; }
    this.S = Math.floor(lo); best = place(this.S);
    this.sigSize = sigV2(this.S);
    this.lyrSize = lyricV2(m ? this.S : null);
    Object.assign(this, { cw: best.cw, chh: best.chh, cols: best.cols, rows: best.rows });

    // ---- 發報時間：第一拍起，一拍 1／2／4／8 個字，兩小節（不超過窗格的四成五）內發完；空白不佔拍
    const glyphs = best.pos.map((p) => ({ ...p, g: encode(p.ch) }));
    const sendable = glyphs.filter((x) => !x.g.space);
    this.tFirst = beatAfter(au, s + 0.25);
    const times = stagger(au, this.tFirst, sendable.length, Math.min(8 * this.beat, 0.45 * (e - s)));
    let si = 0, minUnit = 1;
    const cells: Cell[] = [];
    const marks: Omit<Mark, 'p0' | 'p1'>[] = [];
    for (const x of glyphs) {
      if (x.g.space) { cells.push({ g: x.g, col: x.col, row: x.row, tSend: -1, tDone: -1, digitT: [] }); continue; }
      const t0 = times[si]!, t1 = si + 1 < times.length ? times[si + 1]! : t0 + this.beat;
      si++;
      const r = sendCode(x.g.morse, t0, (t1 - t0) * 0.82, 0.1, 'msg');
      minUnit = Math.min(minUnit, r.unit);
      marks.push(...r.marks);
      cells.push({ g: x.g, col: x.col, row: x.row, tSend: t0, tDone: r.end, digitT: r.digitT });
    }
    this.cells = cells;
    this.tLast = Math.max(this.tFirst, ...cells.map((c) => c.tDone));
    this.wpm = Math.round(1.2 / Math.max(0.02, minUnit));
    // ---- 收訊：歌詞唱到的字也從線路進來（發留言的時候線路佔線，不收）。中文收兩位電碼、英文照摩斯
    for (const line of windowLines(lyrics, s, e)) {
      for (const w of line.words) {
        if (w.start < s || w.start > e - 0.15) continue;
        if (w.start > this.tFirst - 0.1 && w.start < this.tLast + 0.15) continue;
        const code = Array.from(w.w).flatMap((ch) => {
          const g = encode(ch);
          if (g.space || !g.morse.length) return [];
          return g.morse.length === 4 ? g.morse.slice(2) : g.morse;
        });
        if (!code.length) continue;
        const r = sendCode(code, w.start, Math.max(0.12, w.end - w.start) * 0.85, 0.07, 'lyr', w);
        marks.push(...r.marks);
      }
    }
    // ---- 空下來的小節：小節線上打一個「V」（···－，電報員試線路的訊號），紙帶與鍵不會停太久
    const bar = 4 * this.beat;
    for (let b = Math.ceil(au.barAt(s + 0.2)); ; b++) {
      const tb = au.timeOfBar(b);
      if (tb > e - 0.6 * bar) break;
      const busy = marks.some((mk) => mk.t1 > tb - 0.1 && mk.t0 < tb + 0.7 * bar);
      if (!busy) marks.push(...sendCode(['...-'], tb, 9 * this.beat / 8, this.beat / 8, 'test').marks);
    }
    marks.sort((a, b) => a.t0 - b.t0);
    // ---- 紙帶的位置：發留言那段跑快一點（最短的一下至少 3.5 px），其他時間 V_IDLE
    const vMsg = clamp(3.5 / Math.max(1e-3, minUnit), V_IDLE, 950);
    const dt = 1 / 240;
    this.tapeT0 = s - 1;
    const n = Math.ceil((e + 1 - this.tapeT0) / dt) + 2;
    this.tape = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      const tt = this.tapeT0 + i * dt;
      const v = V_IDLE + (vMsg - V_IDLE) * window01(tt, this.tFirst - 0.2, this.tLast + 0.35, 0.2, 0.35);
      this.tape[i] = this.tape[i - 1]! + v * dt;
    }
    this.marks = marks.map((mk) => ({ ...mk, p0: this.tapePos(mk.t0), p1: this.tapePos(mk.t1) }));
    this.drawBase(sender);

    // ---- 即時小卡避開：收訊紀錄、電報紙
    const gh = this.rows * this.chh;
    this.avoid = [
      [LOG.x - 16, LOG.y, LOG.w + 32, 210],
      [GRID.x - 16, GRID.y - 70, GRID.w + 32, gh + 90],
    ];
    this.avoid.push(bbox(this.avoid));
  }

  /** 紙帶在 t 時走了多遠（px）。 */
  private tapePos(t: number): number {
    const x = (t - this.tapeT0) * 240;
    const i = Math.max(0, Math.min(this.tape.length - 2, Math.floor(x)));
    const f = clamp(x - i, 0, 1);
    return this.tape[i]! + (this.tape[i + 1]! - this.tape[i]!) * f;
  }

  private cellXY(c: Cell) { return { x: GRID.x + c.col * this.cw, y: GRID.y + c.row * this.chh }; }

  /** 不會變的：電報紙（印好的格子，訊號色的暗部）、表頭、註腳、收訊紀錄的標題。 */
  private drawBase(sender: string) {
    const L = this.base, c = L.ctx;
    L.clear();
    const m = this.msg;
    // 收訊紀錄的標題（小、低對比）
    c.font = font(F.mono(500), 14); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.55);
    c.fillText('收訊紀錄  ·  RECEIVED', LOG.x, LOG.y + 20);
    c.letterSpacing = '0px';
    // 電報紙
    const gw = this.cols * this.cw, gh = this.rows * this.chh;
    const line = mixRgba('blood', 'signal', 0.35);
    c.strokeStyle = line; c.globalAlpha = 0.32; c.lineWidth = 1;
    for (let r = 0; r < this.rows; r++) for (let k = 0; k < this.cols; k++) {
      const x = GRID.x + k * this.cw, y = GRID.y + r * this.chh;
      c.strokeRect(x + 0.5, y + 0.5, this.cw, this.chh);
      // 電碼那一小格
      c.beginPath(); c.moveTo(x, y + 24.5); c.lineTo(x + this.cw, y + 24.5); c.stroke();
    }
    c.globalAlpha = 0.6;
    c.strokeStyle = line; c.lineWidth = 1.5;
    c.strokeRect(GRID.x - 6, GRID.y - 6, gw + 12, gh + 12);
    c.globalAlpha = 1;
    // 冷面註腳（小、低對比，跟署名同一列、靠左）
    c.font = font(F.hei(500), 14); c.letterSpacing = '2px'; c.fillStyle = rgba('ash', 0.5);
    c.fillText('＊中文依本局電碼簿發送：♥＝0520', GRID.x, GRID.y + gh + this.sigSize + 20);
    c.letterSpacing = '0px';
    this.sender = sender;
    void m;
  }

  // ---------------------------------------------------------------- 每一格
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const fadeIn = prog(t, s, s + 0.3), exit = prog(t, e - 0.3, e, ease.inCubic);
    const down = this.keyDown(t);
    this.bg.u.t!.value = t;
    this.bg.u.scroll!.value = this.tapePos(t);
    this.bg.u.k!.value = fadeIn * (1 - exit);
    this.bg.u.lamp!.value = 0.8 + 0.4 * down;
    this.bg.render(renderer, out);
    if (!this.baseUp) { this.base.upload(); this.baseUp = true; }
    comp.draw(renderer, this.base.texture, out, { opacity: fadeIn * (1 - exit) });

    const L = this.dyn, c = L.ctx, HL = this.hot, hc = HL.ctx;
    L.clear(); HL.clear();
    c.globalAlpha = hc.globalAlpha = 1 - exit;
    this.ink.clear(); this.glow.clear();

    const glowLyric = this.drawLog(c, hc, t);
    const glowGrid = this.drawGrid(c, hc, t);
    this.drawMarks(t, fadeIn * (1 - exit));
    this.drawKey(c, t, down);
    this.drawSounder(c, t, down);

    comp.draw(renderer, L.upload(), out);
    if (glowLyric || glowGrid) comp.draw(renderer, HL.upload(), out, { mode: 'add', tint: [1.7, 1.7, 1.7] });
    this.ink.render(renderer, out);
    // 接點的火花：按下去的那一下
    const cp = this.contactPoint(down);
    if (down > 0.6 && exit < 0.5) sparkHead(this.glow, cp.x, cp.y, t, 0.32, down);
    sparkParticles(this.glow, t, (tb) => (this.keyDown(tb) > 0.6 ? this.contactPoint(1) : null), { rate: 70, life: 0.22, speed: 140, seed: 7, gravity: 500 });
    this.glow.render(renderer, out);
    // 鏡頭：整段慢慢推近（緩進緩出）
    return { bloom: 0.72, vignette: 0.55, halation: 0.25, zoom: 1 + 0.04 * ease.inOutCubic(f.p), popupAvoid: this.avoid };
  }

  /** 電報鍵按下去的程度（0..1）：點劃期間按著，放開有一點點彈回的時間。純函數。 */
  private keyDown(t: number): number {
    const ms = this.marks;
    let lo = 0, hi = ms.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (ms[mid]!.t0 <= t) lo = mid + 1; else hi = mid; }
    let d = 0;
    for (let i = Math.max(0, lo - 3); i < Math.min(ms.length, lo + 1); i++) {
      const mk = ms[i]!;
      const k = t < mk.t0 ? 0 : t < mk.t1 ? prog(t, mk.t0, mk.t0 + 0.012) : 1 - prog(t, mk.t1, mk.t1 + 0.035);
      d = Math.max(d, k);
    }
    return d;
  }

  private contactPoint(down: number) {
    const a = this.leverAngle(down);
    const dx = CONTACT_X - KEY_PIVOT.x;
    return toKey({ x: CONTACT_X, y: KEY_PIVOT.y + dx * Math.sin(a) + 21 });
  }
  /** 槓桿的角度：放開時按鈕那頭翹起來（正的角度 = 左邊往上），按到底是水平、上下接點碰在一起。 */
  private leverAngle(down: number) { return 0.045 * (1 - down); }

  /** 紙帶上的點與劃：針在 PEN_X，紙往左走；剛壓上去燒紅，一秒內冷成墨色。 */
  private drawMarks(t: number, k: number) {
    if (k <= 0) return;
    const yc = (TAPE.y0 + TAPE.y1) / 2;
    const inkC = LIN.ink, sg = LIN.signal, em = LIN.ember;
    for (const mk of this.marks) {
      if (mk.t0 > t) break;
      const pt = this.tapePos(t);
      const xl = PEN_X - (pt - mk.p0);
      const xr = PEN_X - (t < mk.t1 ? 0 : pt - mk.p1);
      if (xr < -20) continue;
      // 試線路的 V 淡一點（不是訊息）
      const w = mk.src === 'test' ? 7 : 9;
      this.ink.seg2(xl + 4, yc, Math.max(xl + 4.01, xr - 4), yc, w, inkC, 0.9 * k);
      const heat = t < mk.t1 ? 1 : Math.exp(-(t - mk.t1) / 0.45);
      if (heat > 0.02) {
        const I = 1.2 + 2.2 * heat;
        this.glow.seg2(xl + 4, yc, Math.max(xl + 4.01, xr - 4), yc, w - 1, [lerp(sg[0], em[0], heat) * I * heat, lerp(sg[1], em[1], heat) * I * heat, lerp(sg[2], em[2], heat) * I * heat], k);
      }
    }
    // 收報機的針（從紙帶下面壓上來）
    const d = this.keyDown(t);
    const nx = PEN_X, ny = TAPE.y1 + 4 - d * 4;
    this.ink.seg2(nx, ny, nx, ny + 46, 3, LIN.ash, 0.9 * k);
    this.ink.seg2(nx - 16, ny + 46, nx + 16, ny + 46, 5, LIN.graphite, 0.9 * k);
    if (d > 0.3) this.glow.seg2(nx, TAPE.y1 - 6, nx, TAPE.y1 - 5.9, 10, [sg[0] * 3 * d, sg[1] * 3 * d, sg[2] * 3 * d], k);
  }

  /** 收訊紀錄：收訊時間＋這一行歌詞（逐字跟唱）。純音樂：本段收訊：純音樂《歌名》。 */
  private drawLog(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number): boolean {
    const { lyrics, song } = this.ctx;
    const ly = lyricAt(lyrics, t, 1.4);
    if (ly) {
      const st = { family: F.archivo(100, 800), size: this.lyrSize, minSize: V2.lyrMin, maxWidth: LOG.w, lineHeight: 1.1 };
      const lay = layoutLyric(c, ly.line, st);
      const rows = lay.rows.length;
      const y = LOG.base - (rows - 1) * lay.size * 0.55;
      c.save(); c.translate(LOG.x, y);
      drawLyric(c, ly.line, t, st, lay, ly.k);
      c.restore();
      // 正在唱的字另外畫到光暈層
      let glow = false;
      hc.save(); hc.translate(LOG.x, y); hc.globalAlpha *= ly.k;
      hc.font = font(st.family, lay.size);
      for (const pw of lay.words) {
        const p = Lyrics.wordProgress(pw.word, t);
        if (p <= 0 || p >= 1) continue;
        glow = true;
        hc.fillStyle = rgba('signal', 0.5);
        hc.fillText(pw.word.w, pw.x, pw.y);
      }
      hc.restore();
      return glow;
    }
    if (!this.hasLyrics) {
      const s = this.ctx.start;
      c.save(); c.globalAlpha *= prog(t, s + 0.2, s + 0.6);
      c.font = font(F.archivo(100, 700), this.lyrSize); c.fillStyle = rgba('bone', 0.85);
      c.fillText(`本段收訊：純音樂《${song.title || '今晚的歌'}》`, LOG.x, LOG.base);
      c.restore();
    }
    return false;
  }

  /** 電報紙：每個字發完就填進它那一格（上面電碼一位一位出現，下面是字，剛填好是燒紅的）。 */
  private drawGrid(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number): boolean {
    let glow = false;
    const S = this.S;
    for (const q of this.cells) {
      if (q.g.space || t < q.tSend) continue;
      const { x, y } = this.cellXY(q);
      const cx = x + this.cw / 2;
      // 電碼：中文一位一位（每位數發完就寫上去），英文是點劃
      const nd = q.g.code.length === 4 && !/[.-]/.test(q.g.code) ? q.digitT.filter((d) => d <= t).length : (t >= q.tDone ? 1 : 0);
      c.font = font(F.mono(500), 14); c.textAlign = 'center'; c.fillStyle = rgba('ash', 0.5);
      const codeTxt = /[.-]/.test(q.g.code) ? (nd ? q.g.code.replace(/\./g, '·').replace(/-/g, '–') : '') : q.g.code.slice(0, nd);
      c.fillText(codeTxt, cx, y + 18);
      if (t < q.tDone) { c.textAlign = 'left'; continue; }
      // 譯文：剛寫好的字是訊號色，0.6 秒冷成紙白
      const heat = Math.exp(-(t - q.tDone) / 0.35);
      const pop = 1 + 0.12 * Math.exp(-(t - q.tDone) / 0.08);
      const by = y + 26 + (this.chh - 26) * 0.5 + S * 0.36;
      c.save(); c.translate(cx, by - S * 0.36); c.scale(pop, pop); c.translate(-cx, -(by - S * 0.36));
      if (q.g.ch === '♥') drawHeart(c, cx, by - S * 0.36, S * 0.72);
      else {
        c.font = font(/[A-Za-z0-9]/.test(q.g.show) ? F.archivo(100, 700) : F.ming(700), S);
        c.fillStyle = heat > 0.04 ? mixRgba('bone', 'signal', heat) : rgba('bone', 0.96);
        c.fillText(q.g.show, cx, by);
      }
      c.restore();
      if (heat > 0.04 && q.g.ch !== '♥') {
        glow = true;
        hc.font = font(/[A-Za-z0-9]/.test(q.g.show) ? F.archivo(100, 700) : F.ming(700), S); hc.textAlign = 'center';
        hc.fillStyle = rgba('signal', 0.7 * heat);
        hc.fillText(q.g.show, cx, by);
        hc.textAlign = 'left';
      }
      c.textAlign = 'left';
    }
    // 署名：全部發完之後寫在電報紙下面、靠右（永遠在留言的最後一列下面）
    if (t >= this.tLast) {
      const gw = this.cols * this.cw, gh = this.rows * this.chh;
      c.save(); c.globalAlpha *= prog(t, this.tLast, this.tLast + 0.3);
      c.font = font(F.hand(700), this.sigSize); c.fillStyle = rgba('bone', 0.9); c.textAlign = 'right';
      c.fillText(this.msg ? signature(this.sender) : '—— ' + this.sender, GRID.x + gw + 6, GRID.y + gh + this.sigSize + 22);
      c.restore();
    }
    return glow;
  }

  /**
   * 收報的響鍵（sounder）：兩個線圈上面一根黃銅銜鐵，電報鍵每按一下它就「喀」地被吸下去、放開彈回來。
   * 放在右邊的空處（標準 v2：留言區變小，空出來的畫面用這個版面自己的機器補動作），跟電報鍵同一個訊號。
   */
  private drawSounder(c: CanvasRenderingContext2D, t: number, down: number) {
    const s = this.ctx.start;
    const k = prog(t, s + 0.1, s + 0.45);
    if (k <= 0) return;
    const ink = rgba('bone', 0.85), thin = rgba('bone', 0.35);
    const bx = 1470, by = 772, bw = 330;
    c.save();
    c.globalAlpha *= k;
    c.lineCap = 'round'; c.lineJoin = 'round';
    // 底座（木頭）
    c.fillStyle = mixRgba('ink2', 'sepia', 0.5); c.fillRect(bx, by, bw, 30);
    c.strokeStyle = ink; c.lineWidth = 1.8; c.strokeRect(bx, by, bw, 30);
    c.strokeStyle = thin; c.lineWidth = 1;
    for (let x = bx + 8; x < bx + bw; x += 7) { c.beginPath(); c.moveTo(x, by + 29); c.lineTo(x - 9, by + 19); c.stroke(); }
    // 兩個線圈（直立的圓柱，細線纏繞）
    for (const cx of [bx + 92, bx + 168]) {
      const top = by - 118;
      c.fillStyle = mixRgba('ink2', 'sepia', 0.55); c.fillRect(cx - 26, top, 52, 118);
      c.strokeStyle = ink; c.lineWidth = 1.6; c.strokeRect(cx - 26, top, 52, 118);
      c.strokeStyle = rgba('signal', 0.18 + 0.4 * down); c.lineWidth = 1;
      for (let y = top + 6; y < by - 4; y += 5) { c.beginPath(); c.moveTo(cx - 25, y); c.lineTo(cx + 25, y + 2); c.stroke(); }
      c.fillStyle = rgba('ink2'); c.fillRect(cx - 18, top - 10, 36, 10);
      c.strokeStyle = ink; c.strokeRect(cx - 18, top - 10, 36, 10);
    }
    // 支架＋轉軸（右邊）
    const px = bx + 286, py = by - 162;
    c.fillStyle = mixRgba('blood', 'signal', 0.35);
    c.beginPath(); c.moveTo(px - 16, by); c.lineTo(px - 10, py + 6); c.lineTo(px + 10, py + 6); c.lineTo(px + 16, by); c.closePath(); c.fill();
    c.strokeStyle = ink; c.lineWidth = 1.6; c.stroke();
    // 上下兩顆擋塊（銜鐵在中間敲）
    const sx = bx + 40;
    c.fillStyle = mixRgba('ash', 'bone', 0.3);
    c.fillRect(sx - 7, py - 40, 14, 22); c.strokeStyle = ink; c.lineWidth = 1.2; c.strokeRect(sx - 7, py - 40, 14, 22);
    c.fillRect(sx - 7, by - 60, 14, 60); c.strokeRect(sx - 7, by - 60, 14, 60);
    // 銜鐵（黃銅長條）：按下時被吸下來、放開彈回（角度跟電報鍵同一個訊號）
    const a = -0.05 * (1 - down) + 0.012 * down;
    c.save(); c.translate(px, py); c.rotate(a);
    const g = c.createLinearGradient(0, -8, 0, 8);
    g.addColorStop(0, mixRgba('signal', 'bone', 0.35)); g.addColorStop(0.5, rgba('signal', 0.9)); g.addColorStop(1, rgba('blood'));
    c.fillStyle = g;
    c.beginPath(); c.moveTo(8, -7); c.lineTo(-(px - sx) - 16, -6); c.lineTo(-(px - sx) - 16, 7); c.lineTo(8, 8); c.closePath(); c.fill();
    c.strokeStyle = ink; c.lineWidth = 1.6; c.stroke();
    c.strokeStyle = rgba('ink', 0.45); c.lineWidth = 1;
    for (let x = -(px - sx) - 10; x < 4; x += 6) { c.beginPath(); c.moveTo(x, 2); c.lineTo(x + 3, 6); c.stroke(); }
    c.restore();
    c.fillStyle = rgba('ink2'); c.beginPath(); c.arc(px, py, 6, 0, TAU); c.fill();
    c.strokeStyle = ink; c.lineWidth = 1.4; c.stroke();
    // 敲到的那一下：擋塊上一點火花光（小，不搶留言）
    if (down > 0.9) { c.fillStyle = rgba('ember', 0.6 * down); c.beginPath(); c.arc(sx, by - 64, 4, 0, TAU); c.fill(); }
    c.restore();
  }

  // ---------------------------------------------------------------- 電報鍵（版畫線稿，側面）
  private drawKey(c: CanvasRenderingContext2D, t: number, down: number) {
    const s = this.ctx.start;
    const k = prog(t, s, s + 0.35);
    if (k <= 0) return;
    const P = KEY_PIVOT, a = this.leverAngle(down);
    const ink = rgba('bone', 0.88), thin = rgba('bone', 0.4);
    c.save();
    c.globalAlpha *= k;
    c.lineCap = 'round'; c.lineJoin = 'round';
    // ---- 電線：從接線柱彎到收報機
    const wireHot = down;
    for (const [i, wx] of [[0, 1316], [1, 1334]] as const) {
      const a0 = toKey({ x: wx, y: 895 });
      c.strokeStyle = wireHot > 0.3 && i === 0 ? mixRgba('ash', 'signal', wireHot) : rgba('ash', 0.55);
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(a0.x, a0.y);
      c.bezierCurveTo(a0.x + 50, a0.y - 20, 1380 + i * 10, 700, PEN_X + 8 + i * 10, TAPE.y1 + 52);
      c.stroke();
    }
    // 以下整組放大（以底座右下角為中心）
    c.translate(KA.x, KA.y); c.scale(KS, KS); c.translate(-KA.x, -KA.y);
    // ---- 底座（木頭）：外框＋斜線陰影
    const bx = KEY.x, by = 906, bw = 350, bh = 34;
    c.fillStyle = mixRgba('ink2', 'sepia', 0.5); c.fillRect(bx, by, bw, bh);
    c.strokeStyle = ink; c.lineWidth = 2; c.strokeRect(bx, by, bw, bh);
    c.strokeStyle = thin; c.lineWidth = 1;
    for (let x = bx + 8; x < bx + bw; x += 7) { c.beginPath(); c.moveTo(x, by + bh - 1); c.lineTo(x - 10, by + bh - 12 + 11); c.stroke(); }
    c.beginPath(); c.moveTo(bx + 4, by + 8); c.lineTo(bx + bw - 4, by + 8); c.stroke();
    // 接線柱
    for (const wx of [1316, 1334]) { c.fillStyle = mixRgba('blood', 'signal', 0.4); c.fillRect(wx - 5, by - 12, 10, 12); c.strokeStyle = ink; c.lineWidth = 1.2; c.strokeRect(wx - 5, by - 12, 10, 12); }
    // ---- 轉軸的支架（兩根柱子＋軸）
    c.fillStyle = mixRgba('blood', 'signal', 0.35);
    c.beginPath(); c.moveTo(P.x - 26, by); c.lineTo(P.x - 12, P.y - 14); c.lineTo(P.x + 12, P.y - 14); c.lineTo(P.x + 26, by); c.closePath(); c.fill();
    c.strokeStyle = ink; c.lineWidth = 1.8; c.stroke();
    c.strokeStyle = rgba('ink', 0.35); c.lineWidth = 1;
    for (let y = P.y; y < by; y += 6) { c.beginPath(); c.moveTo(P.x + 4, y); c.lineTo(P.x + 18, y + 4); c.stroke(); }
    // ---- 接點（下面那顆）
    c.fillStyle = mixRgba('ash', 'bone', 0.3); c.fillRect(CONTACT_X - 9, by - 20, 18, 20);
    c.strokeStyle = ink; c.lineWidth = 1.4; c.strokeRect(CONTACT_X - 9, by - 20, 18, 20);
    // ---- 彈簧（轉軸前面）
    const spX = P.x - 60;
    const spTop = P.y + (spX - P.x) * Math.sin(a) + 8;
    c.strokeStyle = thin; c.lineWidth = 1.5;
    c.beginPath();
    const coils = 7;
    for (let i = 0; i <= coils * 2; i++) {
      const y = lerp(spTop, by - 2, i / (coils * 2));
      const x = spX + (i % 2 ? 7 : -7);
      if (i) c.lineTo(x, y); else c.moveTo(spX, y);
    }
    c.stroke();
    // ---- 槓桿（黃銅）：繞著轉軸轉
    c.save();
    c.translate(P.x, P.y); c.rotate(a);
    const lg = c.createLinearGradient(0, -9, 0, 9);
    lg.addColorStop(0, mixRgba('signal', 'bone', 0.35)); lg.addColorStop(0.5, rgba('signal', 0.9)); lg.addColorStop(1, rgba('blood'));
    c.fillStyle = lg;
    c.beginPath(); c.moveTo(12, -8); c.lineTo(-LEVER_L, -6); c.lineTo(-LEVER_L, 6); c.lineTo(12, 9); c.closePath(); c.fill();
    c.strokeStyle = ink; c.lineWidth = 1.8; c.stroke();
    // 版畫的細線：槓桿下半的陰影
    c.strokeStyle = rgba('ink', 0.45); c.lineWidth = 1;
    for (let x = -LEVER_L + 6; x < 6; x += 6) { c.beginPath(); c.moveTo(x, 2); c.lineTo(x + 3, 7); c.stroke(); }
    // 上面那顆接點的螺絲
    const cxl = CONTACT_X - P.x;
    c.fillStyle = mixRgba('ash', 'bone', 0.3); c.fillRect(cxl - 6, 8, 12, 12);
    c.strokeStyle = ink; c.lineWidth = 1.2; c.strokeRect(cxl - 6, 8, 12, 12);
    // 按鈕（黑色的蘑菇頭＋下面的裙邊）
    const kx = -LEVER_L + 20;
    c.fillStyle = mixRgba('ink2', 'graphite', 0.3);
    c.beginPath(); c.ellipse(kx, -10, 34, 7, 0, 0, TAU); c.fill(); c.strokeStyle = ink; c.lineWidth = 1.6; c.stroke();
    // 蘑菇頭：短短的頸、扁圓的頭（手指壓的那一面）
    c.fillStyle = rgba('ink2');
    c.beginPath(); c.moveTo(kx - 9, -12); c.lineTo(kx - 9, -24); c.lineTo(kx + 9, -24); c.lineTo(kx + 9, -12); c.closePath(); c.fill();
    c.strokeStyle = ink; c.lineWidth = 1.6; c.stroke();
    c.beginPath(); c.moveTo(kx - 30, -24); c.bezierCurveTo(kx - 32, -44, kx + 32, -44, kx + 30, -24); c.closePath(); c.fill();
    c.strokeStyle = ink; c.lineWidth = 1.8; c.stroke();
    // 按鈕的高光（一道弧）
    c.strokeStyle = rgba('bone', 0.5); c.lineWidth = 2;
    c.beginPath(); c.moveTo(kx - 20, -30); c.quadraticCurveTo(kx - 10, -37, kx + 2, -37); c.stroke();
    c.restore();
    // 轉軸
    c.fillStyle = rgba('ink2'); c.beginPath(); c.arc(P.x, P.y, 7, 0, TAU); c.fill();
    c.strokeStyle = ink; c.lineWidth = 1.5; c.stroke();
    c.restore();
  }
}
