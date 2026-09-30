// 自動鋼琴紙卷（批次 T10・機器 D，亮）：鏡頭貼著自動鋼琴的琴譜箱，一大卷打了孔的琴譜紙由下往上捲，經過黃銅的讀譜條、捲進上面的收紙軸。
//  - 孔是從這首歌算出來的：大鼓打低音、每個小節線一組和弦（長長的孔）、歌詞的每個字是一個旋律音（孔的長度就是唱的長度），
//    長音照真的琴譜紙打成一串短孔（孔之間留紙，紙才不會斷）。孔經過讀譜條的那一刻就是那個音響起來：孔透出訊號色的光、
//    讀譜條上那個小氣孔亮一下——所以孔亮起來一定落在鼓點、小節線、唱到的字上。
//  - 歌詞印在紙卷的左邊（老的「歌詞琴譜」就是這樣，給大家邊彈邊唱）：一行歌詞印在它開始唱的那個位置，
//    所以正好在唱的時候經過讀譜條旁邊的「唱到這裡」線；照跟唱規則逐字上色（正在唱是訊號色的暗部＋螢光筆），唱完的往上捲走。
//  - 主打留言是這卷琴譜的曲目卡（插在上面的黃銅卡框裡）：窗格一開始一個詞組一拍印上去，署名是「演奏」。沒有留言：曲目卡是邀請。
// 手法：紙、收紙軸、讀譜條是一個 shader（紙的纖維跟著捲）；孔與歌詞每格用 Canvas 畫（畫面上同時大約一百個孔），
// 響著的孔另外畫在一張半解析度的光暈層加亮；曲目卡的框與標籤畫一次。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, pulse, hash, lerp } from '../engine/util';
import { Lyrics, type Line } from '../engine/lyrics';
import type { FitResult } from '../engine/text';
import { lyricAt, layoutLyric, layoutMessage, signature, beatAfter, drawHeart, DATE_DOTS, lyricSubOf, drawLyricSub, type LyricLayout, type LyricStyle } from './_motifs';
import { drawReveal, phraseSchedule, revealAt, fitCharsF, windowLines, type Rect } from './_t10';
import { pad3 } from './_t11';
import { msgMaxFor, lyricV2, sigV2, fitClauses, V2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: true, energy: [0.2, 0.9], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 版面（邏輯像素，y 向下）
const ROLL = { x0: 40, x1: 1880 }; // 紙卷的左右緣
// 曲目卡（插在左上的黃銅卡框裡）：標準 v2，寬 ≤ 860，照字的大小裁，只比字多一點邊；右上空出來的地方是收紙軸的齒輪
const CARD = { x: 110, y: 94, maxW: 860, maxH: 258, padX: 40, padT: 22, padB: 14 };
const GEAR = { x: 1660, y: 214, r: 118, x2: 1488, y2: 280, r2: 58 };
const SPOOL = { y0: 356, y1: 398 }; // 收紙軸
const TRK = 800; // 讀譜條（孔在這一條上響）
// 孔的欄：右邊留一段空白的紙邊（右下角的 QR 與說明字底下不要有孔，不然字不好讀）
const HOLES = { x0: 736, x1: 1440, n: 56 };
const pitch = (HOLES.x1 - HOLES.x0) / HOLES.n;
const colX = (i: number) => HOLES.x0 + (i + 0.5) * pitch;
const LYR = { x: 146, w: 540 }; // 歌詞印在左邊（字級照標準 v2：比曲目卡上的留言小一點）
const HOLE_W = 8;

interface Hole { col: number; t0: number; t1: number; kind: 'bass' | 'chord' | 'mel' | 'edge' }
interface Printed { line: Line; lay: LyricLayout }

const INVITE = '這一卷還空著：掃描右下角 QR code，把你的祝福打成琴譜。';
const TEXT = `祝福卷曲目演奏速度唱到這裡歌詞琴譜本卷由新郎新娘監製${INVITE}一位賓客新人`;

// ---------------------------------------------------------------- 紙、收紙軸、讀譜條
const BG = () => new FSPass(/* glsl */ `
  uniform float scroll; uniform float k; uniform float flash;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 上面的琴譜箱面板（奶油色的漆面，比紙暗一點）
    vec3 col = C_PAPER * (0.86 + 0.03 * fbm(p / 300.0, 3));
    col *= 0.96 + 0.05 * (1.0 - p.y / ${H}.0);
    if (p.y > ${SPOOL.y0}.0) {
      if (p.x > ${ROLL.x0}.0 && p.x < ${ROLL.x1}.0) {
        // 紙卷：纖維跟著紙往上捲（scroll = 紙走了幾 px）
        vec2 q = vec2(p.x, p.y + scroll);
        float fib = 0.6 * fbm(q * vec2(0.012, 0.004), 3) + 0.4 * snoise(q * vec2(0.09, 0.02));
        float speck = step(0.9985, hash12(floor(q / 2.0)));
        col = C_PAPER * (0.975 + 0.035 * fib - 0.12 * speck);
        // 紙卷兩邊的邊緣：一條細細的陰影
        float e = min(p.x - ${ROLL.x0}.0, ${ROLL.x1}.0 - p.x);
        col *= 0.8 + 0.2 * smoothstep(0.0, 6.0, e);
      } else {
        // 琴譜箱的內部（深色木頭）
        col = mix(C_SEPIA, C_INK2, 0.4) * (0.8 + 0.2 * fbm(p / 40.0, 2));
      }
      // 收紙軸下面的影子
      col *= 1.0 - 0.28 * exp(-(p.y - ${SPOOL.y1}.0) / 18.0) * step(${SPOOL.y1}.0, p.y);
    }
    // 收紙軸：捲起來的紙（一圈一圈的細線）＋兩端的法蘭
    if (p.y > ${SPOOL.y0}.0 && p.y < ${SPOOL.y1}.0) {
      float u = (p.y - ${SPOOL.y0}.0) / ${SPOOL.y1 - SPOOL.y0}.0;
      float sh = 0.45 + 0.55 * sin(3.14159 * u);
      float rings = 0.94 + 0.06 * step(0.5, fract((p.y + scroll * 0.02) / 3.0));
      col = C_PAPER * sh * rings;
      if (p.x < ${ROLL.x0 + 4}.0 || p.x > ${ROLL.x1 - 4}.0) col = mix(C_BLOOD, C_SEPIA, 0.5) * (0.5 + 0.6 * sh);
    }
    // 讀譜條：黃銅的橫條（只在孔的那一段），上緣亮、下緣暗，底下一道影子
    float by = p.y - ${TRK - 9}.0;
    if (p.x > ${HOLES.x0 - 24}.0 && p.x < ${HOLES.x1 + 16}.0) {
      if (by > 0.0 && by < 18.0) {
        float g = by / 18.0;
        vec3 brass = mix(C_SIGNAL * 0.85 + C_BONE * 0.15, C_BLOOD * 0.8, g);
        brass += C_BONE * 0.25 * (1.0 - smoothstep(0.0, 0.2, g));
        col = brass * (1.0 + 0.25 * flash);
      }
      // 先把指數裁在 0 以下：讀譜條上面 by 是很大的負數，exp 會變成無限大、乘上 0 變 NaN（整塊 bloom 變黑）
      col *= 1.0 - 0.3 * exp(-max(by - 18.0, 0.0) / 7.0) * step(18.0, by);
    }
    fragColor = vec4(col * k + C_PAPER * (1.0 - k), 1.0);
  }`, { scroll: { value: 0 }, k: { value: 1 }, flash: { value: 0 } });

export default class Pianoroll extends Scene {
  bg = shared('pianoroll.bg', BG);
  /** 不會變的：曲目卡的框與小字（畫一次）。 */
  base = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 每格重畫：孔、歌詞、曲目卡上的字、錶的指針。 */
  dyn = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 響著的孔、讀譜條上的氣孔（半解析度，加亮）。 */
  hot = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  fit!: FitResult;
  body = '';
  sched: { t: number; chars: number }[] = [];
  holes: Hole[] = [];
  printed: Printed[] = [];
  v = 70; // 紙速（px/秒）
  /** 曲目卡的大小（照字裁）、署名與歌詞的字級。 */
  card = { w: 860, h: 200 }; sigSize = 30; lyrSize = 52;
  tFirst = 0; beat = 0.5;
  hasLyrics = false;
  lyrSt!: LyricStyle;
  avoid: Rect[] = [];
  private baseUp = false;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.body = m ? m.text : INVITE;
    const lines = windowLines(lyrics, s - 8, e + 12);
    await loadText(`${TEXT}${this.body}${m ? m.name : ''}${song.title}${song.artist}${lines.map((l) => l.text + (l.sub?.text ?? '')).join('')}`);
    this.beat = au.beatPeriod(s + 0.1);
    this.hasLyrics = windowLines(lyrics, s, e).length > 0;
    const c = this.dyn.ctx;
    // ---- 曲目卡
    // 標準 v2：字級上限依字數，照子句斷行；框高先扣掉署名那一列（署名永遠在最後一行下面）
    const fam = F.ming(700);
    this.sigSize = sigV2(Math.min(msgMaxFor(this.body), 52));
    const sigRow = m ? this.sigSize + 12 : 0;
    const boxW = CARD.maxW - 2 * CARD.padX, boxH = CARD.maxH - CARD.padT - CARD.padB - sigRow;
    const o = { min: V2.msgMin, max: msgMaxFor(this.body), lineHeight: 1.18, maxLines: 4 };
    this.fit = fitClauses(c, this.body, fam, boxW, boxH, o) ?? layoutMessage(c, this.body, fam, boxW, boxH, o);
    this.sigSize = sigV2(this.fit.size);
    this.lyrSize = lyricV2(m ? this.fit.size : null);
    c.font = font(F.hand(700), this.sigSize);
    const sigW = m ? c.measureText('演奏　' + (m.name || '一位賓客')).width : 0;
    this.card = { w: Math.min(CARD.maxW, Math.max(this.fit.width, sigW) + 2 * CARD.padX), h: CARD.padT + this.fit.height + (m ? this.sigSize + 12 : 0) + CARD.padB + 8 };
    this.tFirst = beatAfter(au, s + 0.2);
    this.sched = phraseSchedule(au, this.body, this.tFirst, Math.min(8 * this.beat, 0.45 * (e - s)), 4);

    // ---- 歌詞：排好每一行；紙速要讓相鄰兩行不疊在一起
    const st: LyricStyle = { family: F.archivo(100, 800), size: this.lyrSize, minSize: V2.lyrMin, maxWidth: LYR.w, lineHeight: 1.1 };
    this.lyrSt = st;
    this.printed = lines.map((line) => ({ line, lay: layoutLyric(c, line, st) }));
    let v = 62;
    for (let i = 0; i + 1 < this.printed.length; i++) {
      const a = this.printed[i]!, b = this.printed[i + 1]!;
      const gap = Math.max(0.25, b.line.start - a.line.start);
      // 有原文副行時 lay.height 算到原文的基線，紙速一起算進去，原文不會跟下一行疊在一起
      v = Math.max(v, (a.lay.height + this.lyrSize * 0.55 + 26) / gap);
    }
    this.v = clamp(v, 62, 190);

    // ---- 打孔：從這首歌的鼓、小節線、歌詞算出來（前後多打一點，紙一進畫面就有孔）
    const t0 = s - (H - TRK) / this.v - 1, t1 = e + (TRK - SPOOL.y1) / this.v + 1;
    const rnd = (a: number, b: number) => hash(a * 7.13 + 1, b * 3.7 + 2);
    const holes: Hole[] = [];
    // 和弦：每個小節線三個長孔（根音、三度、五度），接下來兩拍半
    for (let b = Math.floor(au.barAt(t0)); ; b++) {
      const tb = au.timeOfBar(b);
      if (tb > t1) break;
      const root = 12 + Math.floor(rnd(b, 1) * 9);
      for (const iv of [0, 4, 7]) holes.push({ col: root + iv, t0: tb, t1: tb + 2.6 * this.beat, kind: 'chord' });
      // 小節中間再補一個和弦（第三拍，短一點）
      holes.push({ col: root + 12, t0: tb + 2 * this.beat, t1: tb + 3.2 * this.beat, kind: 'chord' });
    }
    // 低音：大鼓（根音＋高八度）；小鼓：中音區一個短孔
    for (const [kt] of au.events('kick', t0, t1)) {
      const b = Math.floor(au.barAt(kt)), root = 2 + Math.floor(rnd(b, 2) * 8);
      holes.push({ col: root, t0: kt, t1: kt + 0.55 * this.beat, kind: 'bass' });
      holes.push({ col: root + 12, t0: kt, t1: kt + 0.4 * this.beat, kind: 'bass' });
    }
    for (const [st] of au.events('snare', t0, t1)) {
      const b = Math.floor(au.barAt(st));
      holes.push({ col: 12 + Math.floor(rnd(b, 1) * 9) + 19, t0: st, t1: st + 0.3 * this.beat, kind: 'chord' });
    }
    // 琶音：每個八分音符輪流打和弦音（高一個八度），琴譜紙才會像真的一樣密
    for (let i = Math.ceil(au.beatAt(t0) * 2); ; i++) {
      const ta = au.timeOfBeat(i / 2);
      if (ta > t1) break;
      const b = Math.floor(au.barAt(ta + 1e-3)), root = 12 + Math.floor(rnd(b, 1) * 9);
      holes.push({ col: root + 12 + [0, 4, 7, 12, 7, 4][i % 6]!, t0: ta, t1: ta + 0.38 * this.beat, kind: 'chord' });
    }
    // 旋律：歌詞的每個字（沒有歌詞就用人聲的起音）
    const words = lyrics.words.filter((w) => w.end > t0 && w.start < t1);
    let mel = 44;
    if (words.length) {
      for (const w of words) {
        mel = clamp(mel + Math.round((rnd(w.gi, 5) - 0.5) * 9), 32, 54);
        holes.push({ col: mel, t0: w.start, t1: Math.max(w.start + 0.12, w.end - 0.04), kind: 'mel' });
      }
    } else {
      for (const [vt] of au.events('vocal', t0, t1)) {
        mel = clamp(mel + Math.round((rnd(vt * 10, 5) - 0.5) * 9), 32, 54);
        holes.push({ col: mel, t0: vt, t1: vt + 0.8 * this.beat, kind: 'mel' });
      }
      // 人聲也沒有：高音部一拍一個
      if (!au.events('vocal', t0, t1).length) {
        for (let i = Math.ceil(au.beatAt(t0)); au.timeOfBeat(i) < t1; i++) {
          mel = clamp(mel + Math.round((rnd(i, 6) - 0.5) * 9), 32, 54);
          holes.push({ col: mel, t0: au.timeOfBeat(i), t1: au.timeOfBeat(i) + 0.7 * this.beat, kind: 'mel' });
        }
      }
    }
    // 右邊緣的表情孔（踏板）：每一拍一個小圓孔
    for (let i = Math.ceil(au.beatAt(t0)); au.timeOfBeat(i) < t1; i++) holes.push({ col: HOLES.n + 1, t0: au.timeOfBeat(i), t1: au.timeOfBeat(i) + 0.01, kind: 'edge' });
    this.holes = holes.sort((a, b) => a.t0 - b.t0);

    this.drawBase();
    // 即時小卡避開：曲目卡、歌詞那一欄（讀譜條上下）
    this.avoid = [
      [CARD.x - 10, CARD.y - 10, this.card.w + 20, this.card.h + 20],
      [LYR.x - 16, SPOOL.y1 + 10, LYR.w + 40, H - 96 - SPOOL.y1 - 10],
    ];
  }

  /** 紙上 time 那一刻的點現在在畫面的哪個 y（讀譜條在 TRK；未來的在下面，過去的往上捲走）。 */
  private yOf(time: number, t: number) { return TRK - (t - time) * this.v; }

  // ---------------------------------------------------------------- 不會變的
  private drawBase() {
    const L = this.base, c = L.ctx;
    L.clear();
    const m = this.msg, { song, audio: au } = this.ctx;
    // 曲目卡：細的黃銅卡框（6 px）＋奶油色的薄卡、柔柔的影子
    const cw = this.card.w, ch = this.card.h;
    c.filter = 'blur(8px)'; c.fillStyle = rgba('sepia', 0.2); c.fillRect(CARD.x + 6, CARD.y + 10, cw, ch); c.filter = 'none';
    const g = c.createLinearGradient(0, CARD.y - 6, 0, CARD.y + ch + 6);
    g.addColorStop(0, mixRgba('signal', 'bone', 0.35)); g.addColorStop(0.5, mixRgba('signal', 'blood', 0.35)); g.addColorStop(1, rgba('blood'));
    c.fillStyle = g; c.fillRect(CARD.x - 6, CARD.y - 6, cw + 12, ch + 12);
    c.fillStyle = mixRgba('paper', 'bone', 0.4); c.fillRect(CARD.x, CARD.y, cw, ch);
    c.strokeStyle = rgba('sepia', 0.3); c.lineWidth = 1; c.strokeRect(CARD.x + 8.5, CARD.y + 8.5, cw - 17, ch - 17);
    for (const [x, y] of [[CARD.x - 3, CARD.y - 3], [CARD.x + cw + 3, CARD.y - 3], [CARD.x - 3, CARD.y + ch + 3], [CARD.x + cw + 3, CARD.y + ch + 3]] as const) {
      c.fillStyle = rgba('sepia', 0.6); c.beginPath(); c.arc(x, y, 3, 0, Math.PI * 2); c.fill();
    }
    void m; void au;
    void song;
  }

  // ---------------------------------------------------------------- 每一格
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const fadeIn = prog(t, s, s + 0.25), exit = prog(t, e - 0.3, e, ease.inCubic);
    // 讀譜條在響的時候亮一點
    let sounding = 0;
    for (const h of this.holes) { if (h.t0 > t) break; if (t <= h.t1 + 0.05 && h.kind !== 'edge') sounding++; }
    this.bg.u.scroll!.value = (t - s) * this.v;
    this.bg.u.k!.value = 1;
    this.bg.u.flash!.value = clamp(sounding / 6) * 0.6 + 0.6 * au.hit('kick', t, 0.1);
    this.bg.render(renderer, out);
    if (!this.baseUp) { this.base.upload(); this.baseUp = true; }
    comp.draw(renderer, this.base.texture, out);

    const L = this.dyn, c = L.ctx, HL = this.hot, hc = HL.ctx;
    L.clear(); HL.clear();
    c.globalAlpha = 1 - exit;
    let glow = this.drawHoles(c, hc, t);
    glow = this.drawLyrics(c, hc, t) || glow;
    this.drawCard(c, t);
    this.drawGears(c, t);
    void fadeIn;

    comp.draw(renderer, L.upload(), out);
    if (glow) comp.draw(renderer, HL.upload(), out, { mode: 'add', tint: [1.8, 1.8, 1.8] });
    // 鏡頭：整段慢慢推近（緩進緩出），大鼓輕輕一震
    return { paper: 1, bloom: 0.45, vignette: 0.28, grain: 0.04, halation: 0.08, zoom: 1 + 0.04 * ease.inOutCubic(f.p) + 0.003 * au.hit('kick', t, 0.12), popupAvoid: this.avoid };
  }

  /**
   * 右上的收紙軸齒輪（大小兩個咬在一起）：跟著紙速轉（純函數：角度 = 紙走的距離 / 半徑），
   * 每個小節線棘爪「喀」地落進一齒（標準 v2：留言卡變小之後，空出來的畫面要有東西在動）。
   */
  private drawGears(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, s = this.ctx.start;
    const dist = (t - s) * this.v;
    const a1 = dist / GEAR.r, a2 = -dist / GEAR.r2;
    const gear = (x: number, y: number, r: number, n: number, a: number, spokes: number) => {
      // 影子（不跟著轉）
      c.save(); c.filter = 'blur(6px)'; c.fillStyle = rgba('sepia', 0.18);
      c.beginPath(); c.arc(x + 6, y + 9, r + 6, 0, Math.PI * 2); c.fill(); c.restore();
      c.save(); c.translate(x, y); c.rotate(a);
      // 齒
      c.beginPath();
      for (let k = 0; k < n; k++) {
        const b0 = (k / n) * Math.PI * 2, da = (Math.PI * 2) / n;
        c.lineTo(Math.cos(b0) * r, Math.sin(b0) * r);
        c.lineTo(Math.cos(b0 + da * 0.12) * (r + 10), Math.sin(b0 + da * 0.12) * (r + 10));
        c.lineTo(Math.cos(b0 + da * 0.45) * (r + 10), Math.sin(b0 + da * 0.45) * (r + 10));
        c.lineTo(Math.cos(b0 + da * 0.57) * r, Math.sin(b0 + da * 0.57) * r);
      }
      c.closePath();
      const g = c.createLinearGradient(-r, -r, r, r);
      g.addColorStop(0, mixRgba('signal', 'bone', 0.3)); g.addColorStop(1, mixRgba('blood', 'sepia', 0.3));
      c.fillStyle = g; c.fill();
      c.strokeStyle = rgba('sepia', 0.5); c.lineWidth = 1.2; c.stroke();
      // 鏤空：輪輻之間挖掉（露出後面的面板）
      c.fillStyle = mixRgba('paper', 'sepia', 0.12);
      for (let k = 0; k < spokes; k++) {
        const b0 = (k / spokes) * Math.PI * 2 + 0.18, b1 = ((k + 1) / spokes) * Math.PI * 2 - 0.18;
        c.beginPath(); c.arc(0, 0, r * 0.78, b0, b1); c.arc(0, 0, r * 0.3, b1 - 0.1, b0 + 0.1, true); c.closePath(); c.fill();
      }
      c.fillStyle = rgba('sepia', 0.7); c.beginPath(); c.arc(0, 0, r * 0.1, 0, Math.PI * 2); c.fill();
      c.restore();
    };
    gear(GEAR.x, GEAR.y, GEAR.r, 36, a1, 6);
    gear(GEAR.x2, GEAR.y2, GEAR.r2, 18, a2, 4);
    // 棘爪：每個小節線落進一齒（彈一下）
    const tb = au.timeOfBar(Math.floor(au.barAt(t) + 1e-6));
    const kick = Math.exp(-Math.max(0, t - tb) / 0.12) * Math.sin(Math.min(Math.PI, (t - tb) * 30));
    const px = GEAR.x + GEAR.r + 34, py = GEAR.y - 86, ang = 2.55 - 0.16 * kick;
    c.strokeStyle = rgba('sepia', 0.8); c.lineWidth = 5; c.lineCap = 'round';
    c.beginPath(); c.moveTo(px, py); c.lineTo(px + Math.cos(ang) * 64, py + Math.sin(ang) * 64); c.stroke();
    c.fillStyle = rgba('sepia', 0.85); c.beginPath(); c.arc(px, py, 7, 0, Math.PI * 2); c.fill();
  }

  /** 孔：過去的是深色的洞（下緣一道紙的厚度亮邊），正在讀譜條上的透出訊號色的光。長音打成一串短孔。 */
  private drawHoles(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number): boolean {
    let glow = false;
    const top = SPOOL.y1, bot = H + 10;
    for (const h of this.holes) {
      const yT = this.yOf(h.t0, t), yB = this.yOf(h.t1, t);
      if (yT > bot) break;
      if (yB < top) continue;
      const x = h.kind === 'edge' ? ROLL.x1 - 24 : colX(h.col);
      const on = t >= h.t0 && t <= h.t1 + 0.04;
      if (h.kind === 'edge') {
        const y = yT;
        if (y < top || y > bot) continue;
        c.fillStyle = rgba('ink', 0.85); c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.fill();
        continue;
      }
      // 長孔切成一段一段（每段最長 26 px，中間留 4 px 的紙）
      const segs: [number, number][] = [];
      const len = Math.max(6, yB - yT);
      const n = Math.max(1, Math.round(len / 26));
      for (let k = 0; k < n; k++) segs.push([yT + (k * len) / n, yT + ((k + 1) * len) / n - (k < n - 1 ? 4 : 0)]);
      for (const [a, b] of segs) {
        const y0 = Math.max(top, a), y1 = Math.min(bot, b);
        if (y1 <= y0) continue;
        c.fillStyle = on ? rgba('signal') : rgba('ink', 0.6);
        c.fillRect(x - HOLE_W / 2, y0, HOLE_W, y1 - y0);
        // 下緣：紙的厚度被光打到
        if (!on) { c.fillStyle = rgba('bone', 0.55); c.fillRect(x - HOLE_W / 2, y1 - 1.2, HOLE_W, 1.2); }
      }
      if (on) {
        glow = true;
        const k = 0.5 + 0.5 * pulse(t, h.t0, 0.15);
        hc.fillStyle = rgba('signal', 0.75 * k);
        hc.fillRect(x - HOLE_W / 2 - 3, Math.max(top, yT) - 3, HOLE_W + 6, Math.max(6, Math.min(bot, yB) - Math.max(top, yT) + 6));
        // 讀譜條上的氣孔
        hc.fillStyle = rgba('ember', 0.9 * k);
        hc.fillRect(x - 5, TRK - 4, 10, 8);
      }
    }
    return glow;
  }

  /** 歌詞：印在紙卷左邊、跟著紙往上捲，開始唱的那一刻經過「唱到這裡」線。逐字：正在唱是訊號色的暗部＋一道螢光筆。 */
  private drawLyrics(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number): boolean {
    const { song } = this.ctx;
    // 「唱到這裡」線
    c.fillStyle = rgba('blood', 0.55); c.fillRect(LYR.x - 30, TRK, LYR.w + 60, 1.5);
    c.beginPath(); c.moveTo(LYR.x - 30, TRK - 7); c.lineTo(LYR.x - 18, TRK + 0.75); c.lineTo(LYR.x - 30, TRK + 8); c.closePath(); c.fill();
    let glow = false;
    const fam = F.archivo(100, 800);
    // 只有正在唱的那一行是完整的濃度；唱過的、還沒唱的都退到背景（MV 原則：一次只有一組歌詞搶眼）
    const cur = lyricAt(this.ctx.lyrics, t, 1.4)?.line ?? null;
    for (const pr of this.printed) {
      const { line, lay } = pr;
      const y0 = this.yOf(line.start, t);
      if (y0 - lay.size > H || y0 + lay.height < SPOOL.y1) continue;
      c.save();
      if (line !== cur) c.globalAlpha *= line.end < t ? 0.3 : 0.55;
      // 捲進收紙軸的地方裁掉
      c.beginPath(); c.rect(0, SPOOL.y1, W, H - SPOOL.y1); c.clip();
      c.font = font(fam, lay.size);
      for (const pw of lay.words) {
        const p = Lyrics.wordProgress(pw.word, t);
        const x = LYR.x + pw.x, y = y0 + pw.y;
        if (p > 0 && p < 1) {
          // 螢光筆（畫在字的下半，「一」的橫畫才不會被蓋住）：香檳、鼠尾草主題的訊號色很淡，混一點暗部才看得出來
          c.fillStyle = mixRgba('signal', 'blood', 0.15, 0.5);
          c.fillRect(x - 4, y - lay.size * 0.26, (pw.w + 8) * p, lay.size * 0.36);
        }
        c.fillStyle = rgba('sepia', 0.3);
        if (p < 1) c.fillText(pw.word.w, x, y);
        if (p <= 0) continue;
        c.save(); c.beginPath(); c.rect(x - 6, y - lay.size * 1.1, (pw.w + 12) * p, lay.size * 1.5); c.clip();
        c.fillStyle = p < 1 ? rgba('blood') : rgba('sepia');
        c.fillText(pw.word.w, x, y);
        c.restore();
        // 亮版面不加光暈：加亮疊在紙上會把深色的字洗淡
      }
      // 原文副行（韓文歌）：一樣印在紙上、跟著紙捲，小一號、墨色，不上螢光筆（比中文安靜）；
      // 紙速在 init 已經照含副行的高度算過，相鄰兩行不會疊在一起
      const sub = lyricSubOf(line);
      if (sub && lay.sub) {
        c.translate(LYR.x, y0 + lay.sub.dy);
        drawLyricSub(c, sub, t, { ...this.lyrSt, sung: rgba('sepia'), unsung: rgba('sepia', 0.3) }, lay.size, c.globalAlpha);
      }
      c.restore();
    }
    // 純音樂：紙卷左邊印一行「本卷為純音樂」與歌名（跟著紙走）
    if (!this.hasLyrics) {
      // 每四小節印一次（紙一直在走，左邊不會一直空著）；剛經過讀譜條的那一個最濃，其他退到背景
      const per = 16 * this.beat;
      for (let k = -1; k < 8; k++) {
        const y = this.yOf(this.ctx.start + 1.2 + k * per, t);
        if (!(y > SPOOL.y1 + 40 && y < H + 60)) continue;
        c.save();
        c.globalAlpha *= y <= TRK + 20 && y > TRK - per * this.v + 20 ? 1 : 0.35;
        c.font = font(F.mono(500), 16); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.6);
        c.fillText('本卷為純音樂', LYR.x, y - 64);
        c.letterSpacing = '0px';
        c.font = font(F.archivo(100, 800), 56); c.fillStyle = rgba('sepia', 0.9);
        c.fillText(song.title || '今晚的歌', LYR.x, y);
        c.restore();
      }
    }
    return glow;
  }

  /** 曲目卡上的字：主打留言一個詞組一拍印上去，最後是「演奏　名字」（永遠在留言最後一行下面）。 */
  private drawCard(c: CanvasRenderingContext2D, t: number) {
    const m = this.msg, fit = this.fit;
    const shown = fitCharsF(fit.lines, revealAt(this.sched, t, Math.min(0.18, this.beat * 0.35)));
    const y = CARD.y + CARD.padT + fit.size * 0.9;
    drawReveal(c, fit, F.ming(700), CARD.x + CARD.padX, y, shown, { color: rgba('sepia') });
    const done = this.sched.length ? this.sched[this.sched.length - 1]!.t + 0.2 : this.tFirst;
    if (m && t >= done) {
      c.save();
      c.globalAlpha *= prog(t, done, done + 0.3);
      c.textAlign = 'right';
      const nm = m.couple ? '新郎新娘' : m.name || '一位賓客';
      const sy = y + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.3 + this.sigSize + 8;
      c.font = font(F.hand(700), this.sigSize); c.fillStyle = rgba('sepia', 0.85);
      const nw = c.measureText(nm).width;
      c.fillText(nm, CARD.x + this.card.w - CARD.padX, sy);
      c.font = font(F.hei(500), 16); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.6);
      c.fillText('演奏', CARD.x + this.card.w - CARD.padX - nw - 12, sy - 3);
      c.letterSpacing = '0px';
      c.restore();
    }
    void signature; void drawHeart; void lerp;
  }
}
