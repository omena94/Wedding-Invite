// 樂譜（亮）：鏡頭貼著譜架上一頁手抄的譜《婚禮進行曲（現場版）》，譜正在「被寫出來」。
//  - 一行譜 = 一句歌詞：每個字是一個音符，落在那個字被唱到的時間（真的時間）上——音符在那一刻「落」到譜上（從大一點落定、一圈波紋）；
//    時值照下一個字多久之後來（八分、四分、二分、全音符；同一拍的八分音符用符槓連起來），音高是一條確定性的旋律線（跟著人聲起伏）；
//    歌詞寫在音符正下方，照跟唱規則逐字亮（正在唱的是訊號色的暗部）。小節線畫在真的小節線的位置，一條游標跟著時間走，每一拍閃一下。
//  - 下一句要來之前，整行譜往左滑走、新的一行從右邊滑進來（緩進、停住）。句子之間的間奏、整首純音樂：兩小節一行，每拍一個音。
//  - 主打留言是作曲者用鉛筆寫在譜下面的附記（這一張的焦點：最大的字，手寫、微微歪），從第一拍起一個字一個字寫上去，最後署名。
//  - 冷面的小字（小、淡）：Op. 313、♩ = 這首歌的速度、Allegro con amore、「為兩人、兩隻狗與全體賓客而作」、表情記號「（深情地）」。
//  - 鏡頭：譜微微往後倒（透視）、淺景深（譜頭與紙邊是虛的），整個窗格慢慢推近、跟著游標輕輕搖。
// 畫法：紙、譜架、透視、景深是 _t3 的文件攝影機；譜、音符、字每格畫在一張文件圖層（高音譜號用程式畫，字型不一定有）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, SCALE } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog, pulse } from '../engine/util';
import type { FitResult } from '../engine/text';
import type { Line, Word } from '../engine/lyrics';
import { drawLyric, drawMessage, signature, COUPLE_ZH, type LyricLayout, type LyricStyle } from './_motifs';
import { grid, stagger, windowLines, fitMsg, mono, pad3, paperLyric, DocCam, withMips, HUD, EDGE, type Grid, type Pose } from './_t3';

export const spec: PlateSpecDecl = { group: 'type', family: 'doc', paper: true, energy: [0.05, 0.8], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 文件（譜）座標，y 向下
const DW = 1800, DH = 1120;
const TS = SCALE * 1.25;
const SP = 22; // 譜線間距
const VT = 336, VB = VT + 4 * SP; // 譜表的第一線與第五線
const LYR_Y = VB + 100; // 歌詞基線
const SX0 = 170, SX1 = 1630; // 譜表左右
const NX0 = 320, NX1 = 1590; // 音符可以放的範圍
const LYR_FAM = F.archivo(75, 700);
const MSG_FAM = F.hand(400);
const MSG_BOX = { x: 176, y: 640, w: 1440, h: 300 };
const FIXED = '婚禮進行曲現場版為兩人兩隻狗與全體賓客而作作曲編曲全體賓客深情地附記作曲者的話新人空白處請賓客自由填寫祝福掃描右下角把你的一句寫進來';

const PAPER_GLSL = /* glsl */ `
vec3 paperCol(vec2 d, vec4 fb) {
  // 厚一點的譜紙：比一般的紙白一點、纖維淡；焦點附近被燈照亮一點
  vec3 p = mix(C_PAPER, C_BONE, 0.25) * (0.92 + 0.1 * (fb.r - 0.5) + 0.04 * (fb.g - 0.5));
  vec2 q = (d - focus) / vec2(1100.0, 700.0);
  return p * (0.9 + 0.1 * exp(-dot(q, q)));
}
vec3 deskCol(vec2 s, vec4 fb) {
  // 譜架後面：暗暗的木頭（直紋），上面比較暗
  float grain = fbm(vec2(s.x / 30.0, s.y / 700.0), 3);
  return mix(C_SEPIA, C_PAPER, 0.22 + 0.05 * grain) * (0.55 + 0.25 * (s.y / 1080.0)) * (0.92 + 0.08 * fb.r);
}`;

// ---------------------------------------------------------------- 高音譜號（程式畫）
/** 從尾巴的鉤往上穿過譜表、繞上面的圈、斜斜落下、繞著 G 線捲進去（單位是譜線間距，原點在 G 線上）。 */
const G_CLEF: [number, number][] = [
  [-0.55, 2.35], [-0.2, 2.75], [0.3, 2.55], [0.38, 1.7], [0.28, 0.4], [0.16, -1.2], [0.08, -2.6],
  [0.4, -3.6], [0.2, -4.45], [-0.3, -4.0], [-0.5, -3.0], [-0.85, -2.0], [-1.15, -0.95], [-1.1, 0.25],
  [-0.55, 1.1], [0.35, 1.2], [0.95, 0.45], [0.8, -0.5], [0.05, -0.85], [-0.45, -0.35], [-0.25, 0.25], [0.2, 0.18],
];
function catmull(pts: [number, number][], n = 8): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((d) => 0.5 * (2 * p1[d]! + (-p0[d]! + p2[d]!) * t + (2 * p0[d]! - 5 * p1[d]! + 4 * p2[d]! - p3[d]!) * t2 + (-p0[d]! + 3 * p1[d]! - 3 * p2[d]! + p3[d]!) * t3)) as [number, number]);
    }
  }
  out.push(pts[pts.length - 1]!);
  return out;
}
const G_PTS = catmull(G_CLEF);
function drawGClef(c: CanvasRenderingContext2D, x: number, yG: number, s: number, col: string) {
  c.save();
  c.strokeStyle = col; c.fillStyle = col; c.lineCap = 'round';
  for (let i = 1; i < G_PTS.length; i++) {
    const [ax, ay] = G_PTS[i - 1]!, [bx, by] = G_PTS[i]!;
    // 往左下走的筆畫粗、往上的細（像鋼筆寫的）
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    c.lineWidth = (0.1 + 0.2 * clamp((dy / L) * 0.6 - (dx / L) * 0.6 + 0.2)) * s;
    c.beginPath(); c.moveTo(x + ax * s, yG + ay * s); c.lineTo(x + bx * s, yG + by * s); c.stroke();
  }
  c.beginPath(); c.arc(x - 0.45 * s, yG + 2.45 * s, 0.3 * s, 0, Math.PI * 2); c.fill();
  c.restore();
}

// ---------------------------------------------------------------- 一行譜
type Kind = 8 | 4 | 2 | 1; // 八分、四分、二分、全音符
interface Note { x: number; p: number; t: number; kind: Kind; beam: number; word: Word | null }
interface System {
  /** 這一行什麼時候變成「現在這一行」（滑進來的時間）。 */
  t0: number;
  line: Line | null;
  notes: Note[];
  bars: { x: number; n: number }[];
  rests: { x: number; t: number }[];
  lyr: LyricLayout | null;
  /** 時間 → x（游標用）。 */
  map: { t: number; x: number }[];
  dyn: string;
  first: boolean;
}
const vy = (p: number) => VB - (p * SP) / 2;

export default class SheetMusic extends Scene {
  cam = shared('sheetmusic.cam', () => new DocCam(PAPER_GLSL));
  doc = this.track(withMips(new Layer2D(DW, DH, TS, { fast: true })));
  msg: Msg | null = this.ctx.params.message ?? null;
  g!: Grid;
  systems: System[] = [];
  fit: FitResult | null = null;
  msgTimes: number[] = [];
  tSig = 0;
  meter = 4;
  lyrMax = 56;
  shift = { x: 0, y: 0 };

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const g = this.g = grid(au, s, e);
    const m = this.msg;
    const wl = windowLines(lyrics, s, e);
    await loadText(`${FIXED}${COUPLE_ZH}${song.title}${m ? m.text + signature(m.name) : ''}${wl.map((l) => l.text).join('')}`);
    this.meter = clamp(Math.round(g.bar / g.beat), 2, 6);
    const c = this.doc.ctx;
    // 附記（焦點）：先排，歌詞的字級要比它小一號
    if (m) {
      this.fit = fitMsg(c, m.text, MSG_FAM, MSG_BOX.w - 150, MSG_BOX.h - 70, { min: 52, max: 104, lineHeight: 1.24 });
      this.lyrMax = clamp(Math.round(this.fit.size * 0.82), 52, 60);
      const n = Array.from(this.fit.lines.join('')).length;
      this.msgTimes = stagger(au, g.b0, n, clamp((e - g.b0) * 0.45, g.beat * 2, g.bar * 1.5));
      this.tSig = (this.msgTimes[n - 1] ?? g.b0) + g.beat * 0.5;
    } else this.lyrMax = 64;
    // 行的時間表：每句一行（太長就拆兩行）；句子之間超過一小節半的空檔、窗格開頭、整首純音樂，用兩小節一行的間奏補上
    const segs: { t0: number; line: Line | null; words: Word[]; t1: number }[] = [];
    const filler = (a: number, b: number) => {
      let t = a;
      while (b - t > g.bar * 0.75) {
        const nx = Math.min(b, au.timeOfBar(Math.round(au.barAt(t)) + 2));
        const t1 = nx > t + g.beat ? nx : b;
        segs.push({ t0: t, t1, line: null, words: [] });
        t = t1;
      }
    };
    let cur = s;
    wl.forEach((l, i) => {
      const tIn = Math.max(s, l.start - 0.4);
      if (tIn - cur > g.bar * 1.5) filler(cur, tIn - 0.01);
      this.split(c, l).forEach((ws, k) => segs.push({ t0: k === 0 ? tIn : ws[0]!.start - 0.4, t1: 0, line: l, words: ws }));
      const endL = l.end + g.beat * 0.5;
      const nx = wl[i + 1];
      cur = nx && nx.start - 0.4 - endL < g.bar * 1.5 ? nx.start - 0.4 : endL;
    });
    if (e - cur > g.bar * 0.75) filler(cur, e);
    segs.sort((a, b) => a.t0 - b.t0);
    segs.forEach((sg, i) => { sg.t1 = segs[i + 1]?.t0 ?? e; });
    this.systems = segs.map((sg, i) => this.build(c, sg, i === 0));
    // 鏡頭推到最近時：附記的最後一行與署名不能碰到下緣／HUD
    for (let it = 0; it < 3; it++) {
      this.cam.pose(this.pose(e, NX0), DW, DH);
      const bl = this.cam.project(MSG_BOX.x + MSG_BOX.w, MSG_BOX.y + MSG_BOX.h), br = this.cam.project(MSG_BOX.x, MSG_BOX.y + MSG_BOX.h);
      let up = 0, left = 0;
      for (const p of [bl, br]) {
        if (p.y > 1080 - EDGE) up = Math.max(up, p.y - (1080 - EDGE));
        if (p.y > HUD.y - 10 && p.x > HUD.x - 20) up = Math.max(up, p.y - (HUD.y - 10));
      }
      if (bl.x > 1920 - EDGE) left = bl.x - (1920 - EDGE);
      this.shift.y -= up; this.shift.x -= left;
    }
  }

  /** 一句歌詞要不要拆成兩行：52 px（鏡頭拉遠時螢幕上約 48 px）、字間最少 10 px 還是放不下就拆。 */
  private split(c: CanvasRenderingContext2D, l: Line): Word[][] {
    c.font = font(LYR_FAM, 52);
    const need = l.words.reduce((a, w) => a + Math.max(SP * 2.2, c.measureText(w.w).width + 10), 0);
    if (need <= NX1 - NX0 || l.words.length < 2) return [l.words];
    const half = Math.ceil(l.words.length / 2);
    return [l.words.slice(0, half), l.words.slice(half)];
  }

  /** 排一行譜：音符的 x（照時間、但保證歌詞不擠在一起）、時值、符槓、音高、小節線、休止符。 */
  private build(c: CanvasRenderingContext2D, sg: { t0: number; t1: number; line: Line | null; words: Word[] }, first: boolean): System {
    const au = this.ctx.audio, g = this.g;
    const sys: System = { t0: sg.t0, line: sg.line, notes: [], bars: [], rests: [], lyr: null, map: [], dyn: 'mf', first };
    const seed = sg.line ? sg.line.i * 7.3 : Math.round(sg.t0 * 10);
    const e = au.energyAt(sg.words[0]?.start ?? sg.t0);
    sys.dyn = e < 0.3 ? 'p' : e < 0.55 ? 'mp' : e < 0.8 ? 'mf' : 'f';
    // 旋律：一條慢慢起伏的線 + 人聲的起伏；句尾回到 G 或 B（聽起來「收」了）
    const pitch = (j: number, n: number, t: number) => {
      if (j === n - 1 && n > 2) return hash(seed, 9) > 0.5 ? 2 : 4;
      return clamp(Math.round(4 + 2.6 * Math.sin(0.95 * j + hash(seed) * 6.28) + (hash(seed, j) - 0.5) * 2 + (au.env('vocal', t) - 0.45) * 3), -1, 9);
    };
    let onsets: { t: number; w: Word | null; need: number }[];
    let size = this.lyrMax;
    if (sg.words.length) {
      for (size = this.lyrMax; size > 52; size -= 2) {
        c.font = font(LYR_FAM, size);
        if (sg.words.reduce((a, w) => a + Math.max(SP * 2.2, c.measureText(w.w).width + 12), 0) <= NX1 - NX0) break;
      }
      c.font = font(LYR_FAM, size);
      onsets = sg.words.map((w) => ({ t: w.start, w, need: Math.max(SP * 2.2, c.measureText(w.w).width + 12) }));
    } else {
      // 間奏：每拍一個音（偶爾兩個八分音符）
      onsets = [];
      for (const bt of g.beats) {
        if (bt < sg.t0 - 1e-3 || bt >= sg.t1 - 0.05) continue;
        onsets.push({ t: bt, w: null, need: SP * 2.2 });
        if (hash(seed, bt * 10) > 0.62) onsets.push({ t: bt + g.beat / 2, w: null, need: SP * 2.2 });
      }
    }
    const n = onsets.length;
    if (n) {
      // x：先照最小間距排，剩下的空間依「到下一個音多久」分配（時間長的音後面空比較多，像真的抄譜）
      const gaps = onsets.map((o, j) => Math.max(0.05, (onsets[j + 1]?.t ?? (o.w ? o.w.end : o.t + g.beat)) - o.t));
      const minW = onsets.reduce((a, o) => a + o.need, 0);
      const slack = Math.max(0, NX1 - NX0 - minW);
      const gsum = gaps.reduce((a, b) => a + b, 0);
      let x = NX0;
      onsets.forEach((o, j) => {
        const r = gaps[j]! / g.beat;
        const kind: Kind = r < 0.72 ? 8 : r < 1.45 ? 4 : r < 2.9 ? 2 : 1;
        sys.notes.push({ x: x + o.need / 2, p: pitch(j, n, o.t), t: o.t, kind, beam: -1, word: o.w });
        x += o.need + slack * (gaps[j]! / gsum);
      });
      // 符槓：同一拍裡相鄰的八分音符兩兩連起來
      for (let j = 0; j + 1 < n; j++) {
        const a = sys.notes[j]!, b = sys.notes[j + 1]!;
        if (a.kind === 8 && b.kind === 8 && a.beam < 0 && Math.floor(au.beatAt(a.t) + 0.02) === Math.floor(au.beatAt(b.t) + 0.02)) { a.beam = j + 1; b.beam = j; }
      }
      const last = sys.notes[n - 1]!;
      sys.map = sys.notes.map((nt) => ({ t: nt.t, x: nt.x }));
      sys.map.unshift({ t: sys.notes[0]!.t - g.beat, x: sys.notes[0]!.x - SP * 3 });
      sys.map.push({ t: last.t + gaps[n - 1]!, x: Math.min(NX1 + 10, last.x + onsets[n - 1]!.need / 2 + slack * (gaps[n - 1]! / gsum)) });
      for (let j = 0; j + 1 < n; j++) {
        const w = onsets[j]!.w;
        if (w && onsets[j + 1]!.t - w.end > g.beat * 1.2) sys.rests.push({ x: (sys.notes[j]!.x + sys.notes[j + 1]!.x) / 2, t: w.end });
      }
    }
    const tA = sys.map[0]?.t ?? sg.t0, tB = sys.map[sys.map.length - 1]?.t ?? sg.t1;
    for (let i = Math.ceil(au.barAt(tA) + 0.02); au.timeOfBar(i) < tB; i++) {
      let x = this.xAt(sys, au.timeOfBar(i)) - SP * 1.1;
      for (const nt of sys.notes) if (Math.abs(nt.x - x) < SP * 0.9) x = nt.x - SP * 1.2;
      if (x > NX0 - SP && x < NX1 + SP) sys.bars.push({ x, n: i + 1 });
    }
    if (sg.words.length) {
      c.font = font(LYR_FAM, size);
      sys.lyr = { size, rows: [], height: size, words: sys.notes.map((nt) => { const w = c.measureText(nt.word!.w).width; return { word: nt.word!, x: nt.x - w / 2, y: 0, w }; }) };
    }
    return sys;
  }

  /** 時間 → x（音符之間線性，兩端停住）。 */
  private xAt(sys: System, t: number): number {
    const m = sys.map;
    if (!m.length) return NX0 + ((t - sys.t0) / Math.max(0.5, this.g.bar * 2)) * (NX1 - NX0);
    if (t <= m[0]!.t) return m[0]!.x;
    for (let i = 1; i < m.length; i++) if (t <= m[i]!.t) return lerp(m[i - 1]!.x, m[i]!.x, (t - m[i - 1]!.t) / Math.max(1e-3, m[i]!.t - m[i - 1]!.t));
    return m[m.length - 1]!.x;
  }

  /** 鏡頭：整個窗格慢慢推近；水平方向輕輕跟著游標（只跟兩成，字才不會跑）。 */
  private pose(t: number, cursorX: number): Pose {
    const slow = ease.inOutCubic(prog(t, this.ctx.start, this.ctx.end));
    return {
      x: lerp(900, cursorX, 0.12), y: 600,
      z: 0.93 + 0.05 * slow + 0.006 * pulse(t, this.g.b0, 0.12),
      roll: -0.015 + 0.01 * slow, tilt: 0.2, pan: 0.1 - 0.12 * slow,
      sx: 960 + this.shift.x, sy: 548 + this.shift.y,
    };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t;
    const D = this.doc; D.clear();
    const c = D.ctx;
    this.drawHeader(c);
    let ci = 0;
    for (let i = 0; i < this.systems.length; i++) if (this.systems[i]!.t0 <= t) ci = i;
    const cur = this.systems[ci]!;
    const slide = ci > 0 ? ease.inOutCubic(prog(t, cur.t0 - 0.02, cur.t0 + 0.3)) : 1;
    if (ci > 0 && slide < 1) this.drawSystem(c, this.systems[ci - 1]!, t, -DW * slide, false);
    this.drawSystem(c, cur, t, DW * (1 - slide), true);
    this.drawNote(c, t);
    D.upload();
    const cx = cur.map.length ? this.xAt(cur, t) : 900;
    this.cam.pose(this.pose(t, cx), DW, DH);
    this.cam.render(renderer, out, {
      tex: D.texture, docW: DW, docH: DH, texScale: TS, rect: [60, 40, DW - 120, DH - 60],
      focus: { x: 900, y: 620 }, focusR: [760, 380], blur: 6, shadow: [10, 22],
    });
    return { paper: 1, bloom: 0.28, vignette: 0.4, grain: 0.045, halation: 0.06 };
  }

  // ------------------------------------------------------------ 譜頭（小字、淡）
  private drawHeader(c: CanvasRenderingContext2D) {
    const ink = (a: number) => rgba('sepia', a);
    c.textBaseline = 'alphabetic';
    c.font = font(F.ming(700), 22); c.fillStyle = ink(0.8);
    c.fillText('婚禮進行曲（現場版）', SX0, 142);
    c.font = font(F.serif(400, true), 21); c.fillStyle = ink(0.6);
    c.fillText('為兩人、兩隻狗與全體賓客而作 · Op. 313', SX0 + 250, 142);
    c.textAlign = 'right';
    c.font = font(F.ming(400), 18); c.fillStyle = ink(0.6);
    c.fillText(`作曲　${COUPLE_ZH}　／　編曲　全體賓客`, SX1, 142);
    c.textAlign = 'left';
    const bpm = Math.round(this.ctx.audio.bpm || 120);
    c.font = font(F.serif(600, true), 22); c.fillStyle = ink(0.72);
    c.fillText(`Allegro con amore　♩ = ${bpm}`, SX0, 214);
    mono(c, `NO.${pad3(this.ctx.song.index)}`, SX1, 214, { size: 13, color: ink(0.45), align: 'right', tracking: 3 });
  }

  // ------------------------------------------------------------ 一行譜
  private drawSystem(c: CanvasRenderingContext2D, sys: System, t: number, dx: number, current: boolean) {
    const ink = (a: number) => rgba('sepia', a);
    c.save();
    c.translate(dx, 0);
    c.textBaseline = 'alphabetic';
    c.fillStyle = ink(0.55);
    for (let i = 0; i < 5; i++) c.fillRect(SX0, VT + i * SP - 0.7, SX1 - SX0, 1.4);
    c.fillStyle = ink(0.8);
    c.fillRect(SX0 - 1, VT, 2.2, VB - VT);
    c.fillRect(SX1 - 2, VT, 2, VB - VT);
    c.fillRect(SX1 - 8, VT, 5, VB - VT);
    drawGClef(c, SX0 + 44, VT + 3 * SP, SP, ink(0.9));
    if (sys.first) {
      c.font = font(F.serif(600), SP * 2.6); c.fillStyle = ink(0.9); c.textAlign = 'center';
      c.fillText(String(this.meter), SX0 + 108, VT + SP * 1.85); c.fillText('4', SX0 + 108, VT + SP * 3.85);
      c.textAlign = 'left';
    }
    for (const b of sys.bars) {
      c.fillStyle = ink(0.75); c.fillRect(b.x - 1, VT, 2, VB - VT);
      c.font = font(F.serif(400, true), 18); c.fillStyle = ink(0.5);
      c.fillText(String(b.n), b.x - 4, VT - 14);
    }
    if (sys.notes.length) {
      c.font = font(F.serif(600, true), 34); c.fillStyle = ink(0.75);
      c.fillText(sys.dyn, NX0 - 8, VT - 56);
      if (sys.line) { c.font = font(F.ming(700), 19); c.fillStyle = ink(0.55); c.fillText('（深情地）', NX0 + 48, VT - 60); }
    }
    if (sys.line && sys.notes.length >= 3) this.slur(c, sys, t);
    for (const r of sys.rests) if (t >= r.t) this.rest(c, r.x, prog(t, r.t, r.t + 0.12, ease.outBack));
    for (const nt of sys.notes) this.note(c, sys, nt, t);
    if (sys.line && sys.lyr) {
      const st: LyricStyle = { family: LYR_FAM, size: sys.lyr.size, maxWidth: NX1 - NX0, ...paperLyric() };
      c.save(); c.translate(0, LYR_Y);
      drawLyric(c, sys.line, t, st, sys.lyr, prog(t, sys.t0, sys.t0 + 0.2));
      c.restore();
    }
    // 游標：跟著時間走，每一拍閃一下
    if (current && sys.map.length) {
      const t0 = sys.map[0]!.t, t1 = sys.map[sys.map.length - 1]!.t;
      if (t >= t0 && t <= t1 + 0.4) {
        const x = this.xAt(sys, t);
        const a = 1 - prog(t, t1, t1 + 0.4);
        const beat = pulse(t, this.ctx.audio.timeOfBeat(Math.floor(this.ctx.audio.beatAt(t) + 1e-6)), 0.1);
        c.fillStyle = rgba('signal', (0.14 + 0.2 * beat) * a); c.fillRect(x - 10, VT - 44, 20, VB - VT + 88);
        c.fillStyle = rgba('blood', 0.8 * a); c.fillRect(x - 1.5, VT - 44, 3, VB - VT + 88);
      }
    }
    c.restore();
  }

  /** 一個音符：到了它的時間才出現（從大一點落定），正在唱的是訊號色的暗部。 */
  private note(c: CanvasRenderingContext2D, sys: System, nt: Note, t: number) {
    if (t < nt.t - 0.02) return;
    const u = prog(t, nt.t - 0.02, nt.t + 0.16, ease.outBack);
    const singing = nt.word ? t < nt.word.end && t >= nt.word.start : t < nt.t + 0.15;
    const col = singing ? rgba('blood') : rgba('sepia', 0.92);
    const y = vy(nt.p);
    c.fillStyle = rgba('sepia', 0.7);
    for (let p = -2; p >= nt.p - 1 && p >= -6; p -= 2) if (nt.p <= p) c.fillRect(nt.x - SP * 0.95, vy(p) - 0.7, SP * 1.9, 1.4);
    for (let p = 10; p <= nt.p + 1 && p <= 16; p += 2) if (nt.p >= p) c.fillRect(nt.x - SP * 0.95, vy(p) - 0.7, SP * 1.9, 1.4);
    // 剛落下的那一下：一圈淡淡的波紋
    const rip = prog(t, nt.t, nt.t + 0.5);
    if (rip > 0 && rip < 1) { c.strokeStyle = rgba('signal', 0.6 * (1 - rip)); c.lineWidth = 2; c.beginPath(); c.arc(nt.x, y, SP * (0.8 + 1.6 * rip), 0, Math.PI * 2); c.stroke(); }
    c.save();
    c.translate(nt.x, y); c.scale(lerp(1.6, 1, u), lerp(1.6, 1, u));
    this.head(c, nt.kind <= 2, col, nt.kind === 1 ? 1.15 : 1);
    c.restore();
    if (nt.kind === 1) return;
    // 符桿：高音往下、低音往上
    const up = nt.p < 4;
    const sx = up ? nt.x + SP * 0.58 : nt.x - SP * 0.58;
    const tipY = up ? y - SP * 3.4 : y + SP * 3.4;
    c.fillStyle = col;
    c.fillRect(sx - 1.1, Math.min(y, tipY), 2.2, Math.abs(tipY - y));
    if (nt.kind !== 8) return;
    const other = nt.beam >= 0 ? sys.notes[nt.beam] : null;
    if (other && other.x > nt.x && t >= other.t - 0.02) {
      // 符槓：畫在左邊那顆，兩顆都出現才連
      const oy = vy(other.p), osx = up ? other.x + SP * 0.58 : other.x - SP * 0.58;
      const oTip = up ? Math.min(oy - SP * 3.4, tipY + (oy - y) * 0.3) : Math.max(oy + SP * 3.4, tipY + (oy - y) * 0.3);
      const th = SP * 0.5 * (up ? 1 : -1);
      c.beginPath();
      c.moveTo(sx - 1, tipY); c.lineTo(osx + 1, oTip); c.lineTo(osx + 1, oTip + th); c.lineTo(sx - 1, tipY + th); c.closePath();
      c.fillStyle = rgba('sepia', 0.92); c.fill();
      c.fillRect(osx - 1.1, Math.min(oy, oTip), 2.2, Math.abs(oTip - oy));
    } else if (!other) {
      // 符尾：一道彎
      const d = up ? 1 : -1;
      c.beginPath();
      c.moveTo(sx, tipY);
      c.bezierCurveTo(sx + SP * 0.2, tipY + d * SP * 1.0, sx + SP * 1.3, tipY + d * SP * 1.3, sx + SP * 0.8, tipY + d * SP * 2.6);
      c.bezierCurveTo(sx + SP * 1.0, tipY + d * SP * 1.6, sx + SP * 0.2, tipY + d * SP * 1.5, sx, tipY + d * SP * 1.1);
      c.closePath(); c.fillStyle = col; c.fill();
    }
  }

  /** 符頭：斜斜的橢圓（空心 = 二分、全音符）。 */
  private head(c: CanvasRenderingContext2D, hollow: boolean, col: string, k = 1) {
    c.save();
    c.rotate(-0.36);
    c.beginPath(); c.ellipse(0, 0, SP * 0.64 * k, SP * 0.44 * k, 0, 0, Math.PI * 2);
    c.fillStyle = col; c.fill();
    if (hollow) {
      c.globalCompositeOperation = 'destination-out';
      c.beginPath(); c.ellipse(0, 0, SP * 0.44 * k, SP * 0.2 * k, 0.5, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }

  private rest(c: CanvasRenderingContext2D, x: number, u: number) {
    c.save();
    c.translate(x, VT + SP * 2); c.scale(u, u);
    c.strokeStyle = rgba('sepia', 0.85); c.lineWidth = SP * 0.22; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(-SP * 0.3, -SP * 1.4); c.lineTo(SP * 0.35, -SP * 0.6); c.lineTo(-SP * 0.3, SP * 0.1); c.lineTo(SP * 0.35, SP * 0.8);
    c.quadraticCurveTo(-SP * 0.6, SP * 0.5, -SP * 0.05, SP * 1.5);
    c.stroke();
    c.restore();
  }

  /** 整句的圓滑線：從第一個音到最後一個音上方的一道弧，畫到最新出現的那個音。 */
  private slur(c: CanvasRenderingContext2D, sys: System, t: number) {
    const ns = sys.notes, a = ns[0]!, b = ns[ns.length - 1]!;
    if (t < a.t) return;
    const top = Math.min(VT - SP, ...ns.map((n) => (n.p >= 4 ? vy(n.p) - SP : vy(n.p) - SP * 4)));
    const y0 = Math.min(vy(a.p) - SP * 1.4, VT - SP * 0.5), y1 = Math.min(vy(b.p) - SP * 1.4, VT - SP * 0.5);
    const cy = top - SP * 0.8;
    const last = ns.filter((n) => n.t <= t).pop()!;
    const u = clamp((last.x - a.x) / Math.max(1, b.x - a.x));
    c.save();
    c.beginPath(); c.rect(a.x - 10, 0, (b.x - a.x) * u + 20, DH); c.clip();
    c.fillStyle = rgba('sepia', 0.6);
    c.beginPath();
    c.moveTo(a.x, y0);
    c.bezierCurveTo(a.x + (b.x - a.x) * 0.25, cy, a.x + (b.x - a.x) * 0.75, cy, b.x, y1);
    c.bezierCurveTo(a.x + (b.x - a.x) * 0.75, cy + 5, a.x + (b.x - a.x) * 0.25, cy + 5, a.x, y0);
    c.fill();
    c.restore();
  }

  // ------------------------------------------------------------ 附記（留言，鉛筆寫的，焦點）
  private drawNote(c: CanvasRenderingContext2D, t: number) {
    const m = this.msg, B = MSG_BOX;
    c.save();
    c.translate(B.x + B.w / 2, B.y + B.h / 2); c.rotate(-0.014); c.translate(-B.x - B.w / 2, -B.y - B.h / 2);
    const pencil = mixRgba('sepia', 'ash', 0.18, 0.95);
    // 小小的「附記」：鉛筆寫在左邊，一個箭頭指向譜
    c.font = font(F.hand(700), 26); c.fillStyle = mixRgba('sepia', 'ash', 0.3, 0.7);
    c.fillText(m?.couple ? '作曲者的話' : '附記', B.x, B.y + 6);
    c.strokeStyle = mixRgba('sepia', 'ash', 0.3, 0.55); c.lineWidth = 2.2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(B.x + 10, B.y - 22); c.quadraticCurveTo(B.x - 6, B.y - 60, B.x + 30, B.y - 88); c.stroke();
    c.beginPath(); c.moveTo(B.x + 30, B.y - 88); c.lineTo(B.x + 14, B.y - 86); c.moveTo(B.x + 30, B.y - 88); c.lineTo(B.x + 26, B.y - 72); c.stroke();
    const lx = B.x + 120;
    if (m && this.fit) {
      const n = this.msgTimes.filter((x) => x <= t).length;
      drawMessage(c, this.fit, MSG_FAM, lx, B.y + this.fit.size * 0.88, { chars: n, color: pencil });
      const ks = prog(t, this.tSig, this.tSig + 0.3);
      if (ks > 0) {
        c.globalAlpha *= ks;
        c.font = font(MSG_FAM, 40); c.fillStyle = mixRgba('sepia', 'ash', 0.25, 0.82); c.textAlign = 'right';
        c.fillText(signature(m.name), B.x + B.w, B.y + this.fit.height + 62);
        c.textAlign = 'left';
      }
    } else if (!m) {
      c.globalAlpha *= prog(t, this.g.b0, this.g.b0 + 0.4);
      c.font = font(MSG_FAM, 50); c.fillStyle = mixRgba('sepia', 'ash', 0.25, 0.7);
      c.fillText('空白處請賓客自由填寫祝福——', lx, B.y + 44);
      c.font = font(MSG_FAM, 40);
      c.fillText('掃描右下角 QR code，把你的一句寫進來。', lx, B.y + 112);
    }
    c.restore();
  }
}
