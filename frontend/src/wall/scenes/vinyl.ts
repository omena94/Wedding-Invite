// 黑膠唱片（照 pdoom 的 spacetime「字排在圓環上、唱到才點亮」與 loom「一條線被火花一路寫出來」）。
// 俯視一張轉動的黑膠：細線溝紋、反光扇形、圓心標籤（歌名、歌手、SIDE A · 2027 · 03 · 13 · ALAN & OMENA）。
//  - 歌詞刻在溝紋上（一條往內捲的螺旋），唱針固定在正上方：唱片的轉動「鎖」在歌聲上，
//    每個字正好在被唱到的那一刻轉到唱針底下、亮起來（訊號色、發光），唱完冷卻成紙白，轉到左邊淡掉。
//    所以字永遠在正上方被讀到、不會倒過來；唱針隨著螺旋慢慢往內走（唱臂跟著擺）。
//  - 要讓字由左往右讀、又讓唱針依序讀到，唱片只能逆時針轉——左下角的註腳一本正經地說明這件事。
//  - 唱針是仙女棒的火花：拖著一段剛讀過、還在發燙的溝。
//  - 主打留言是唱片封套的「liner notes」：一張紙卡在第一拍從右邊滑出來。沒有留言時是一張空白的卡，邀請大家掃 QR。
//  - 純音樂（這個窗格沒有人唱）：溝紋改刻留言（短的）或新人的名字，唱針用閱讀的速度讀過去；卡片改成唱片的製作名單。
//  - 轉速標籤依 BPM 選 33⅓ 或 45（冷面：真的轉得比較慢，是慢動作）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE, scaleContext2D } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, layout, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, prog, pulse, noise1, TAU } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { sparkHead, sparkParticles, beatAfter, signature, drawHeart, COUPLE_EN, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { FRAG_VINYL } from './vinyl-glsl';

// ---------------------------------------------------------------- 版面幾何（邏輯像素，y 向下）
/** 唱片圓心與半徑：下緣出畫面，上方留給唱臂，右邊留給卡片。 */
const C = { x: 740, y: 770 };
const R_REC = 650;
/** 圓心標籤半徑（真的唱片約三分之一）。 */
const R_LAB = 205;
/** 窗格開始時，唱針底下那個字的基線半徑；之後沿著螺旋往內。 */
const R0 = 466;
/** 溝紋上的字級（歌詞至少 48 px）。 */
const SIZE = 64;
/** 唱針尖在字的基線外多遠：停在字頂上方，唱頭才不會蓋住正在唱的字。 */
const STY = 74;
/** 唱臂軸心（右上角，卡片上方）。 */
const PIVOT = { x: 1650, y: 128 };
/** 刻字的那一層只涵蓋圓環附近（上傳比整張小一半以上）。 */
const TR = { x: 130, y: 96, w: 1210, h: 724 };
/** 卡片（liner notes）停住的位置與寬度；高度看內容，一定在 HUD（y ≥ 830）上面。 */
const CARD = { x: 1238, w: 612, top: 238, bottom: 818 };
/** 卡片圖層蓋住的範圍（含轉動與影子）與卡片圖留給影子的邊。 */
const CARD_R = { x: 1160, y: 150, w: 760, h: 760 };
const CARD_M = 70;
/** 左上角曲目資訊＋左下角註腳的圖層範圍。 */
const INFO_R = { x: 96, y: 90, w: 640, h: 910 };
/** 圓環上的字看得到的角度（從正上方算，度）：右邊（還沒唱的）與左邊（唱過的）各自淡出。 */
const VIS = { r0: 50, r1: 78, l0: 56, l1: 86 };
const DEG = Math.PI / 180;
/** 左上角曲目資訊的左緣。 */
const INFO_X = 128;
/** 真的黑膠外徑 150 mm：唱針位置的讀數用。 */
const MM = 150 / R_REC;

/** 歌詞的聲音：壓窄的 Archivo（中文、韓文自動接思源黑體）。 */
const FAM_LYRIC = F.archivo(75, 800);
/** 留言的聲音：霞鶩文楷。 */
const FAM_MSG = F.hand(700);

const FOOTNOTE = '＊本唱片逆時針播放，以便由左至右閱讀。';
const CARD_NOTE = '＊本面祝福建議以最大音量播放。';
const INVITE = ['這一面還空著。', '掃描右下角 QR code，', '把你的祝福刻進下一首歌。'];
const INVITE_NOTE = '＊收到的祝福會出現在接下來的歌裡。';

const BG = () => new FSPass(FRAG_VINYL, {
  uC: { value: new THREE.Vector2(C.x, C.y) }, uR: { value: R_REC }, uRl: { value: R_LAB }, uTh: { value: 0 }, uFan: { value: 0 },
  uFanK: { value: 1 }, uIn: { value: 1 }, uHat: { value: 0 },
  uS: { value: new THREE.Vector2() }, uE: { value: new THREE.Vector2() }, uP: { value: new THREE.Vector2(PIVOT.x, PIVOT.y) }, uLift: { value: 0 },
  uLab: { value: null }, uTxt: { value: null }, uTR: { value: new THREE.Vector4(TR.x, TR.y, TR.w, TR.h) },
});

// ---------------------------------------------------------------- 唱針讀到哪裡：時間 → 弧長
/**
 * 單調的三次插值（Fritsch–Carlson）：通過每個字的開始與結束（時間, 弧長），
 * 所以唱片的轉速平滑，但每個字「剛好在開始的那一刻」轉到唱針底下（不會提早，最多晚一點點）。
 * 第一個點之前、最後一個點之後用閒置轉速外插。
 */
class HeadCurve {
  private t: number[] = [];
  private x: number[] = [];
  private m: number[] = [];
  constructor(knots: [number, number][], private v: number) {
    for (const [t, x] of knots) { this.t.push(t); this.x.push(x); }
    const n = this.t.length;
    if (n < 2) return;
    const h: number[] = [], d: number[] = [];
    for (let k = 0; k < n - 1; k++) { h[k] = this.t[k + 1]! - this.t[k]!; d[k] = (this.x[k + 1]! - this.x[k]!) / h[k]!; }
    this.m[0] = Math.min(v, 3 * d[0]!);
    this.m[n - 1] = Math.min(v, 3 * d[n - 2]!);
    for (let k = 1; k < n - 1; k++) {
      const a = d[k - 1]!, b = d[k]!;
      if (a <= 0 || b <= 0) { this.m[k] = 0; continue; }
      const w1 = 2 * h[k]! + h[k - 1]!, w2 = h[k]! + 2 * h[k - 1]!;
      this.m[k] = Math.min((w1 + w2) / (w1 / a + w2 / b), 3 * Math.min(a, b));
    }
  }
  at(t: number): number {
    const T = this.t, X = this.x, n = T.length;
    if (!n) return this.v * t;
    if (t <= T[0]!) return X[0]! + this.v * (t - T[0]!);
    if (t >= T[n - 1]!) return X[n - 1]! + this.v * (t - T[n - 1]!);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T[mid]! <= t) lo = mid; else hi = mid; }
    const hh = T[hi]! - T[lo]!, s = (t - T[lo]!) / hh, s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * X[lo]! + (s3 - 2 * s2 + s) * hh * this.m[lo]! + (-2 * s3 + 3 * s2) * X[hi]! + (s3 - s2) * hh * this.m[hi]!;
  }
}

/**
 * 整理控制點：時間要遞增、弧長不能倒退；兩點之間快到超過 vMax 就把後一點往後挪
 * （例如兩句歌詞接得很緊、中間又要空一段）。只會往後挪：反白永遠不跑在歌聲前面。
 */
function cleanKnots(k: [number, number][], vMax: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [t, x] of k) {
    const prev = out[out.length - 1];
    if (!prev) { out.push([t, x]); continue; }
    const xx = Math.max(x, prev[1]);
    const tt = Math.max(t, prev[0] + (xx - prev[1]) / vMax, prev[0] + 1e-3);
    if (xx - prev[1] < 0.01 && tt - prev[0] < 0.02) continue;
    out.push([tt, xx]);
  }
  return out;
}

/** 圓環上的一個字（字元）。s = 左緣在螺旋上的弧長。 */
interface RG { ch: string; fam: string; s: number; w: number; main: boolean }

/**
 * 把一小段字（新人的名字、日期）一再重複排在弧長 from～to 之間，排不下的字不排。
 * 只排一次版再平移：layout() 逐字量前綴，長字串會很慢。
 */
function tile(unit: string, fam: string, size: number, from: number, to: number, main: boolean): RG[] {
  const lay = layout(unit, fam, size);
  const out: RG[] = [];
  if (lay.width <= 0) return out;
  for (let o = from; o < to; o += lay.width) {
    for (const g of lay.glyphs) {
      if (!g.ch.trim()) continue;
      if (o + g.x + g.w > to) return out;
      out.push({ ch: g.ch, fam, s: o + g.x, w: g.w, main });
    }
  }
  return out;
}

/** 唱片的轉速：依 BPM（折到 70～140）選 45 或 33⅓。 */
function rpmFor(bpm: number) {
  let b = bpm || 100;
  while (b > 140) b /= 2;
  while (b < 70) b *= 2;
  return b >= 104 ? 45 : 100 / 3;
}

export default class Vinyl extends Scene {
  bg = shared('vinyl.bg', BG);
  /** 刻在溝紋上的字（遮罩，交給 shader 上色、讓溝紋從字裡穿過去）。 */
  txt = this.track(new Layer2D(TR.w, TR.h));
  /** 左上角曲目資訊與左下角註腳：只有唱針讀數（0.5 mm 一格）變了才重畫；進場只調合成時的透明度。 */
  info = this.track(new Layer2D(INFO_R.w, INFO_R.h));
  /** 卡片：只蓋住右邊一塊；紙、內文、署名在 init 先各畫成一張，滑動時每格只是轉一下、貼上去。 */
  cardL = this.track(new Layer2D(CARD_R.w, CARD_R.h));
  cardParts: HTMLCanvasElement[] = [];
  /** 上一次畫的曲目資訊／卡片的樣子（一樣就不重畫、不重新上傳）。 */
  infoKey = '';
  cardKey = '';
  glow = this.track(new LineBatch(3000, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  labelTex: THREE.CanvasTexture | null = null;

  rpm = 45;
  vIdle = 200;
  head!: HeadCurve;
  glyphs: RG[] = [];
  /** 窗格開始時唱針的弧長位置（螺旋的起點）與螺旋每弧度往內幾 px。 */
  P0 = 0;
  k = 0;
  /** 唱臂長度（讓唱針在螺旋中段剛好在正上方）。 */
  armL = 900;
  /** 主要文字的每個字的時間（有沒有在唱：火花亮度用）。 */
  sung: [number, number][] = [];
  /** 卡片：'msg' 留言、'invite' 空白邀請、'credits' 製作名單（留言刻在溝紋上時）。 */
  cardKind: 'msg' | 'invite' | 'credits' = 'invite';
  cardFit: FitResult | null = null;
  cardH = 400;
  titleFit: FitResult | null = null;
  tDrop = 0;
  beat = 0.5;
  /** 即時留言小卡要避開的範圍（整個窗格都一樣，init 算好）。 */
  avoid: [number, number, number, number][] = [];

  override async init() {
    const { audio: au, lyrics, song, start, end } = this.ctx;
    // 刻字層是遮罩（各色版代表不同意思），不要做 sRGB 解碼
    this.txt.texture.colorSpace = THREE.NoColorSpace;
    this.beat = au.beatPeriod(start);
    this.tDrop = beatAfter(au, start + 0.05);
    this.rpm = rpmFor(au.bpm);
    // 慢動作的轉速（真的 45 轉，字會糊成一片）：約十分之一，換成圓環上的 px/s
    this.vIdle = (this.rpm / 60) * TAU * 0.105 * R0;
    const name = this.msg ? (this.msg.name || '一位賓客') : '';
    await loadText(`${song.title}${song.artist}${COUPLE_ZH}${FOOTNOTE}${CARD_NOTE}${INVITE.join('')}${INVITE_NOTE}${name}作詞收錄監製《》面婚禮現場錄音℗`);
    const inWin = lyrics.lines.filter((l) => l.end > start - 10 && l.start < end + 10);
    await loadText(inWin.map((l) => l.text).join(''));

    // 這個窗格裡有沒有人在唱：有就刻歌詞；沒有就刻留言（短的）或新人的名字
    const singing = lyrics.lines.some((l) => l.words.some((w) => w.end > start + 0.2 && w.start < end - 0.3));
    let knots: [number, number][] = [];
    if (singing) {
      knots = this.buildLyrics(inWin);
      this.cardKind = this.msg ? 'msg' : 'invite';
    } else if (this.msg && this.buildMessageRing(this.msg, (k) => (knots = k))) {
      this.cardKind = 'credits';
    } else {
      knots = this.buildNames();
      this.cardKind = this.msg ? 'msg' : 'invite';
    }
    this.head = new HeadCurve(cleanKnots(knots, 1500), this.vIdle);
    this.P0 = this.head.at(start);
    // 螺旋：整個窗格唱針往內走的量（一圈約一行字高，最多 110 px）
    const S = Math.max(1, this.head.at(end) - this.P0);
    const dr = Math.min(110, (72 * S) / (TAU * R0));
    this.k = dr / (S / (R0 - dr / 2));
    // 唱臂長度：螺旋中段時唱針剛好在正上方
    const rMid = R0 - dr / 2 + STY;
    this.armL = Math.hypot(PIVOT.x - C.x, PIVOT.y - (C.y - rMid));
    this.fillGaps();
    this.labelTex = this.buildLabel();
    this.layoutCard();
    // 歌名：一行最大 54 px；要兩行就壓到 42 px，整塊才不會往下擠到圓環左邊的字
    const tc = this.info.ctx, title = song.title || '今晚的歌';
    this.titleFit = fitText(tc, title, F.archivo(100, 800), 470, 60, { min: 28, max: 54, lineHeight: 1.04, maxLines: 1 });
    if (this.titleFit.width > 470 || this.titleFit.size < 34) this.titleFit = fitText(tc, title, F.archivo(100, 800), 470, 90, { min: 26, max: 42, lineHeight: 1.06, maxLines: 2 });
    this.buildCard();
    this.avoid = this.popupAvoid();
  }

  /**
   * 即時留言小卡不要蓋的地方：溝紋上正在讀的那一段（唱針左右約 55°，含唱針往內走的範圍）、
   * liner notes 卡片、左上角的歌名、圓心標籤。這樣留下來最空的是左下角（只蓋到註腳與唱過、正在淡出的字），
   * 小卡會優先挑那裡；左邊中段會蓋到剛唱完的半句，所以也算進讀字的範圍。
   */
  private popupAvoid(): [number, number, number, number][] {
    const out: [number, number, number, number][] = [];
    const rTop = R0 + STY + 12, rIn = R0 - 115, a = 55 * DEG;
    out.push([C.x - rTop * Math.sin(a) - 10, C.y - rTop - 30, 2 * rTop * Math.sin(a) + 20, rTop - rIn * Math.cos(a) + 40]);
    if (this.cardH) {
      const top = clamp(515 - this.cardH / 2, CARD.top, CARD.bottom - this.cardH);
      out.push([CARD.x - 12, top - 12, CARD.w + 24, this.cardH + 24]);
    }
    const Y = this.infoY();
    out.push([INFO_X - 10, 104, 480, Y.readout + 12 - 104]);
    out.push([C.x - R_LAB, C.y - R_LAB, 2 * R_LAB, 2 * R_LAB]);
    return out.map(([x, y, w, h]) => [Math.round(x), Math.round(y), Math.round(w), Math.round(h)]);
  }

  // ---------------------------------------------------------------- 溝紋上要刻什麼
  /** 歌詞：每行依序排在螺旋上，行與行之間空出間奏的長度（間奏越長、空白的溝越長，像唱片上曲與曲之間）。 */
  private buildLyrics(lines: { text: string; start: number; end: number; words: { w: string; start: number; end: number; o: number }[] }[]): [number, number][] {
    const knots: [number, number][] = [];
    let prevEndT = NaN, prevEndX = 0;
    for (const line of lines) {
      const lay = layout(line.text, FAM_LYRIC, SIZE);
      const cps = Array.from(line.text);
      const u2c: number[] = [];
      let u = 0;
      cps.forEach((ch, i) => { for (let q = 0; q < ch.length; q++) u2c[u + q] = i; u += ch.length; });
      u2c[u] = cps.length;
      const base = Number.isNaN(prevEndT) ? 0 : prevEndX + Math.max(SIZE * 1.3, this.vIdle * Math.max(0, line.start - prevEndT));
      let right = base;
      line.words.forEach((w, j) => {
        const c0 = u2c[w.o] ?? 0, c1 = Math.max(c0 + 1, u2c[w.o + w.w.length] ?? cps.length);
        const g0 = lay.glyphs[c0], g1 = lay.glyphs[Math.min(lay.glyphs.length - 1, c1 - 1)];
        if (!g0 || !g1) return;
        // 字前面的空白算在這個字裡：開頭可能晚一點點亮，但不會提早
        const x0 = j === 0 ? base + g0.x : right;
        const x1 = base + g1.x + g1.w;
        const t1 = Math.max(w.end, w.start + 0.06);
        knots.push([w.start, x0], [t1, x1]);
        right = x1;
        this.sung.push([w.start, t1]);
      });
      for (const g of lay.glyphs) if (g.ch.trim()) this.glyphs.push({ ch: g.ch, fam: FAM_LYRIC, s: base + g.x, w: g.w, main: true });
      prevEndT = line.end;
      prevEndX = Math.max(right, base + lay.width);
    }
    return knots;
  }

  /**
   * 純音樂＋留言：留言刻在溝紋上，第一拍之後用閱讀的速度讀過去，接著署名。
   * 太長（一秒要讀超過 6.5 個字、或一整圈都放不下）就不刻，改放在卡片上。
   */
  private buildMessageRing(m: Msg, set: (k: [number, number][]) => void): boolean {
    const { end } = this.ctx;
    const lay = layout(m.text, FAM_MSG, SIZE);
    const n = lay.glyphs.length;
    const t0 = this.tDrop + this.beat * 0.5;
    const usable = end - this.beat - 1.2 - t0;
    const rate = n / Math.max(0.1, usable);
    if (rate > 6.5 || lay.width > R0 * 2.4) return false;
    // 一秒讀 3.5 個字左右（至少要在窗格結束前讀完一遍）；讀完署名、一顆愛心，再從頭讀——像唱片的鎖溝一直轉
    const v = (Math.max(3.5, rate) * lay.width) / n;
    const sig = layout(signature(m.name), F.hand(400), SIZE * 0.75);
    const sx = lay.width + SIZE * 0.6, hx = sx + sig.width + SIZE * 0.7;
    const cycle = hx + SIZE * 0.8 + SIZE * 0.9;
    const reps = Math.ceil(((end - t0) * v + R0 * 2) / cycle) + 1;
    for (let k = 0; k < reps; k++) {
      const o = k * cycle;
      for (const g of lay.glyphs) if (g.ch.trim()) this.glyphs.push({ ch: g.ch, fam: FAM_MSG, s: o + g.x, w: g.w, main: true });
      for (const g of sig.glyphs) if (g.ch.trim()) this.glyphs.push({ ch: g.ch, fam: F.hand(400), s: o + sx + g.x, w: g.w, main: true });
      this.glyphs.push({ ch: '♥', fam: FAM_MSG, s: o + hx, w: SIZE * 0.8, main: true });
    }
    this.sung.push([t0, end]);
    set([[t0, 0], [t0 + (reps * cycle) / v, reps * cycle]]);
    return true;
  }

  /** 沒有歌詞也沒有（刻得下的）留言：刻新人的名字與日期，用閒置轉速一路讀過去。 */
  private buildNames(): [number, number][] {
    const { start, end } = this.ctx;
    const unit = `${COUPLE_EN.toUpperCase()}  ·  ${COUPLE_ZH}  ·  ${DATE_DOTS}  ·  `;
    const x0 = R0 * 2, x1 = x0 + this.vIdle * (end - start);
    this.glyphs.push(...tile(unit, FAM_LYRIC, SIZE, 0, x1 + R0 * 2, true));
    this.sung.push([start, end]);
    return [[start, x0], [end, x1]];
  }

  /**
   * 溝紋上的空白（間奏、窗格開頭結尾）太長時，淡淡地刻上新人的名字，像唱片曲間的小字，
   * 不然整段溝是空的。只填窗格裡看得到的範圍。
   */
  private fillGaps() {
    const { start, end } = this.ctx;
    const lo = this.head.at(start) - R0 * 1.8, hi = this.head.at(end) + R0 * 1.8;
    this.glyphs.sort((a, b) => a.s - b.s);
    const unit = `${COUPLE_EN.toUpperCase()}  ·  ${DATE_DOTS}  ·  `;
    const pad = SIZE * 1.1;
    const edges: [number, number][] = [];
    let cur = lo;
    for (const g of this.glyphs) {
      if (g.s + g.w < lo || g.s > hi) continue;
      if (g.s - cur > pad * 2 + SIZE * 3) edges.push([cur + pad, g.s - pad]);
      cur = Math.max(cur, g.s + g.w);
    }
    if (hi - cur > pad * 2 + SIZE * 3) edges.push([cur + pad, hi]);
    for (const [a, b] of edges) this.glyphs.push(...tile(unit, FAM_LYRIC, SIZE * 0.62, a, b, false));
    this.glyphs.sort((a, b) => a.s - b.s);
  }

  // ---------------------------------------------------------------- 螺旋
  /** 弧長（相對窗格開始時的唱針）→ 螺旋上的角度。r(ψ) = R0 − kψ，弧長 = R0ψ − kψ²/2。 */
  private psi(sRel: number) {
    const k = this.k;
    if (k < 1e-6) return sRel / R0;
    return (R0 - Math.sqrt(Math.max(1, R0 * R0 - 2 * k * sRel))) / k;
  }
  private rAt(psi: number) { return R0 - this.k * psi; }

  /** 唱針尖：唱臂繞軸心擺，與「離圓心 rs」那一圈的交點（取靠正上方那個）。回傳位置與它在唱片上的角度。 */
  private stylus(rs: number) {
    const dx = PIVOT.x - C.x, dy = PIVOT.y - C.y, D = Math.hypot(dx, dy), L = this.armL;
    const a = (rs * rs - L * L + D * D) / (2 * D);
    const h = Math.sqrt(Math.max(0, rs * rs - a * a));
    const mx = C.x + (a * dx) / D, my = C.y + (a * dy) / D;
    const p1 = { x: mx + (h * dy) / D, y: my - (h * dx) / D }, p2 = { x: mx - (h * dy) / D, y: my + (h * dx) / D };
    const ang = (p: { x: number; y: number }) => Math.atan2(p.x - C.x, -(p.y - C.y));
    const p = Math.abs(ang(p1)) < Math.abs(ang(p2)) ? p1 : p2;
    return { x: p.x, y: p.y, a: ang(p) };
  }

  /** t 時的唱針與唱片狀態。 */
  private stateAt(t: number) {
    const P = this.head.at(t);
    const ps = this.psi(P - this.P0);
    const rb = this.rAt(ps);
    const st = this.stylus(rb + STY);
    return { P, ps, rb, st, th: st.a - ps };
  }

  // ---------------------------------------------------------------- 標籤（init 時畫一次，shader 裡轉）
  private buildLabel(): THREE.CanvasTexture {
    const { song } = this.ctx;
    const LS = 2 * SCALE; // 比螢幕細兩倍：轉動時重新取樣才不會糊
    const D = 2 * R_LAB, R = R_LAB;
    const cv = document.createElement('canvas');
    cv.width = cv.height = Math.round(D * LS);
    const c = cv.getContext('2d')!;
    c.scale(LS, LS);
    c.textBaseline = 'alphabetic';
    // 底色：主題的深色（每首歌不同，像真的唱片公司標籤），邊緣一點點暗
    const g = c.createRadialGradient(R, R, 0, R, R, R);
    g.addColorStop(0, rgba('blood')); g.addColorStop(0.85, rgba('blood')); g.addColorStop(1, mixDark('blood', 0.2));
    c.fillStyle = g;
    c.beginPath(); c.arc(R, R, R, 0, TAU); c.fill();
    const ink = (a: number) => rgba('bone', a);
    c.strokeStyle = ink(0.55); c.lineWidth = 1;
    c.beginPath(); c.arc(R, R, R * 0.965, 0, TAU); c.stroke();
    c.lineWidth = 0.8;
    c.beginPath(); c.arc(R, R, R * 0.78, 0, TAU); c.stroke();
    // 外圈的環狀小字：一圈剛好排滿
    const rpmTxt = this.rpm === 45 ? '45' : '33⅓';
    const ring = `SIDE A  ·  ${DATE_DOTS}  ·  ${COUPLE_EN.toUpperCase()}  ·  ${rpmTxt} RPM  ·  STEREO  ·  `;
    const fam = F.mono(500), fs = 12.5, rr = R * 0.855;
    c.font = font(fam, fs);
    const unitW = c.measureText(ring).width, circ = TAU * rr;
    const reps = Math.max(1, Math.floor(circ / unitW));
    const chars = Array.from(ring.repeat(reps));
    const extra = (circ - unitW * reps) / chars.length;
    let s = 0;
    c.fillStyle = ink(0.85);
    for (const ch of chars) {
      const w = c.measureText(ch).width;
      const a = (s + w / 2) / rr;
      c.save();
      c.translate(R + Math.sin(a) * rr, R - Math.cos(a) * rr);
      c.rotate(a);
      c.fillText(ch, -w / 2, fs * 0.36);
      c.restore();
      s += w + extra;
    }
    // 歌名（上半部）與歌手
    const tf = fitText(c, song.title || '今晚的歌', F.archivo(100, 900), 240, 92, { min: 16, max: 40, lineHeight: 1.02, maxLines: 2 });
    c.font = font(F.archivo(100, 900), tf.size);
    c.textAlign = 'center';
    c.fillStyle = ink(0.96);
    const yT = R - 44 - (tf.lines.length - 1) * tf.lineHeight;
    tf.lines.forEach((ln, i) => c.fillText(ln, R, yT + i * tf.lineHeight));
    if (song.artist) {
      const af = fitText(c, song.artist, F.serif(400, true), 230, 30, { min: 13, max: 22, maxLines: 1 });
      c.font = font(F.serif(400, true), af.size);
      c.fillStyle = ink(0.8);
      c.fillText(af.lines[0] ?? '', R, R - 18);
    }
    // 軸心兩側：SIDE A 與轉速
    c.font = font(F.mono(600), 13);
    c.letterSpacing = '3px';
    c.fillStyle = ink(0.9);
    c.textAlign = 'right'; c.fillText('SIDE A', R - 26, R + 5);
    c.textAlign = 'left'; c.fillText(`${rpmTxt} RPM`, R + 28, R + 5);
    c.letterSpacing = '0px';
    // 下半部：編號、出品
    c.textAlign = 'center';
    c.font = font(F.mono(500), 11);
    c.letterSpacing = '2px';
    c.fillStyle = ink(0.7);
    c.fillText('AO-0313  ·  STEREO', R, R + 52);
    c.letterSpacing = '0px';
    c.font = font(F.hei(500), 11);
    c.fillText(`℗ 2027  ${COUPLE_ZH}  婚禮現場錄音`, R, R + 74);
    drawHeart(c, R, R + 102, 16);
    c.textAlign = 'left';
    // 軸心的孔（shader 裡畫金屬軸）
    c.globalCompositeOperation = 'destination-out';
    c.beginPath(); c.arc(R, R, 8, 0, TAU); c.fill();
    c.globalCompositeOperation = 'source-over';
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.flipY = true;
    this.track({ dispose: () => { tex.dispose(); cv.width = cv.height = 0; } });
    return tex;
  }

  // ---------------------------------------------------------------- 卡片排版
  private layoutCard() {
    const c = this.cardL.ctx, inner = CARD.w - 72;
    if (this.cardKind === 'msg' && this.msg) {
      // 標頭 + 分隔線 ≈ 92，署名 ≈ 72，註腳 ≈ 70
      const maxBody = CARD.bottom - CARD.top - 92 - 72 - 70;
      this.cardFit = fitClauses(c, this.msg.text, F.hand(400), inner, maxBody, { min: 44, max: 104, lineHeight: 1.34, maxLines: 6 });
      this.cardH = 92 + this.cardFit.height + 72 + 70;
    } else if (this.cardKind === 'credits') {
      this.cardH = 92 + 3 * 58 + 70;
    } else {
      this.cardH = 92 + 76 + 2 * 50 + 70 + 70;
    }
  }

  // ---------------------------------------------------------------- 每一格
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, beat = this.beat;
    // 進場：字與曲目資訊幾乎馬上出現（跨過切點還在唱的那一行不能消失），唱片的反光慢一點亮起來
    const inK = prog(t, s, s + 0.35, ease.outCubic), textK = prog(t, s, s + 0.12);
    // 唱臂：一開始懸著，第一拍落下（影子收近）；最後一拍抬起來
    const lift = Math.max(1 - prog(t, s, this.tDrop, ease.inOutCubic), prog(t, e - beat * 0.9, e - beat * 0.1, ease.inOutCubic) * 0.8);
    const down = t >= this.tDrop && lift < 0.2;
    const st = this.stateAt(t);
    const touch = pulse(t, this.tDrop, 0.12);

    // shader：唱片、標籤、刻字、唱臂
    const u = this.bg.u;
    u.uTh!.value = st.th;
    // 反光扇形：每小節轉四分之一圈（逆時針，跟唱片同向），下拍時剛好有一片掃過正上方的唱針
    u.uFan!.value = -0.5 * Math.PI * f.bar + 0.35;
    u.uFanK!.value = inK * (0.85 + 0.35 * f.a.kick + 0.4 * touch);
    u.uIn!.value = inK;
    u.uHat!.value = f.a.hat;
    (u.uS!.value as THREE.Vector2).set(st.st.x, st.st.y);
    const arm = this.armGeom(st.st);
    (u.uE!.value as THREE.Vector2).set(arm.ex, arm.ey);
    u.uLift!.value = lift;
    u.uLab!.value = this.labelTex;
    u.uTxt!.value = this.drawRing(t, st, textK * (1 - prog(t, e - 0.25, e)));
    this.bg.render(renderer, out);

    // 火花：唱針尖；後面拖著一段剛讀過、還在發燙的溝
    this.glow.clear();
    const singing = this.sung.some(([a, b]) => t >= a - 0.02 && t <= b + 0.1);
    const I = (singing ? 1 : 0.55) * (down ? 1 : 0) * (1 + 0.5 * f.a.kick + 1.2 * touch);
    if (I > 0) {
      this.trail(t, st, I);
      const hp = (tb: number) => { if (tb < this.tDrop) return null; const q = this.stateAt(tb).st; return { x: q.x, y: q.y }; };
      // 落針的那一瞬間噴一小把火星，之後唱的時候多、間奏時少
      const rate = (tb: number) => (tb < this.tDrop + 0.08 ? 360 : this.sung.some(([a, b]) => tb >= a && tb <= b) ? 80 : 26);
      sparkParticles(this.glow, t, hp, { rate, rateMax: 360, life: 0.38, speed: 210, seed: 11, intensity: 0.9 });
      sparkHead(this.glow, st.st.x, st.st.y, t, 1 + 0.3 * touch, I);
    }
    // 落針：一道光從針尖沿著那一圈溝往兩邊跑出去，半秒內散掉
    const rip = prog(t, this.tDrop, this.tDrop + 0.55, ease.outCubic);
    if (rip > 0 && rip < 1) {
      const rs = Math.hypot(st.st.x - C.x, st.st.y - C.y), span = 0.75 * rip, fade = (1 - rip) * 2.2, sg = LIN.signal, n = 30;
      for (const dir of [-1, 1]) {
        for (let i = 0; i < n; i++) {
          const u0 = i / n, u1 = (i + 1) / n, a0 = st.st.a + dir * span * u0, a1 = st.st.a + dir * span * u1;
          const k = fade * (0.15 + 0.85 * u1 * u1);
          this.glow.seg2(C.x + Math.sin(a0) * rs, C.y - Math.cos(a0) * rs, C.x + Math.sin(a1) * rs, C.y - Math.cos(a1) * rs, 1.4, [sg[0] * k, sg[1] * k, sg[2] * k], 1);
        }
      }
    }
    if (this.glow.count) this.glow.render(renderer, out);

    // 曲目資訊（唱針讀數變了才重畫）與卡片（沒變就不重畫）
    this.drawInfoLayer(st);
    comp.draw(renderer, this.info.texture, out, { opacity: textK, ...subRect(INFO_R) });
    if (this.drawCardLayer(t) < 1) comp.draw(renderer, this.cardL.texture, out, subRect(CARD_R));
    const kick = f.a.kick;
    // 每個小節線輕輕推一下鏡頭（很小，像唱盤跟著低音震）
    const db = pulse(t, au.timeOfBar(Math.floor(f.bar)), 0.14);
    return {
      popupAvoid: this.avoid,
      bloom: 0.7, vignette: 0.5, halation: 0.22,
      zoom: 1 + 0.018 * f.p + 0.004 * kick + 0.006 * db + 0.008 * touch,
      shake: [2.5 * touch * noise1(t * 40, 1), 2.5 * touch * noise1(t * 43, 2)] as [number, number],
    };
  }

  /** 唱臂：從軸心伸到唱頭座後端（唱頭座往唱片中心偏一點角度，像真的唱臂）。 */
  private armGeom(sp: { x: number; y: number }) {
    const ux = PIVOT.x - sp.x, uy = PIVOT.y - sp.y, L = Math.hypot(ux, uy);
    const dx = ux / L, dy = uy / L;
    const off = -22 * DEG, len = 74;
    const hx = dx * Math.cos(off) - dy * Math.sin(off), hy = dx * Math.sin(off) + dy * Math.cos(off);
    return { ex: sp.x + hx * len, ey: sp.y + hy * len };
  }

  /** 剛讀過的溝：唱針尖往回（逆時針方向）一小段弧，越舊越冷。 */
  private trail(t: number, st: ReturnType<Vinyl['stateAt']>, I: number) {
    const n = 40, span = 1.4, sg = LIN.signal, em = LIN.ember;
    let prev: { x: number; y: number } | null = null;
    for (let i = 0; i <= n; i++) {
      const tb = t - (span * i) / n;
      if (tb < this.tDrop) break;
      const P = this.head.at(tb);
      const ps = this.psi(P - this.P0);
      const r = this.rAt(ps) + STY;
      const a = ps + st.th;
      const p = { x: C.x + Math.sin(a) * r, y: C.y - Math.cos(a) * r };
      if (prev) {
        const k = Math.exp(-(t - tb) / 0.4) * I;
        this.glow.seg2(prev.x, prev.y, p.x, p.y, 1.5 + 1.2 * k, [lerp(sg[0], em[0], k) * 2.2 * k, lerp(sg[1], em[1], k) * 2.2 * k, lerp(sg[2], em[2], k) * 2.2 * k], 1);
      }
      prev = p;
    }
  }

  /** 把圓環上的字畫進遮罩層（r = 唱過、g = 熱度、b = 愛心、a = 不透明度），回傳貼圖。 */
  private drawRing(t: number, st: ReturnType<Vinyl['stateAt']>, alpha: number): THREE.Texture {
    const L = this.txt, c = L.ctx;
    L.clear();
    c.save();
    c.translate(-TR.x, -TR.y);
    c.textBaseline = 'alphabetic';
    const P = st.P, gl = this.glyphs;
    const lo = P - R0 * 1.8, hi = P + R0 * 1.6;
    // 二分搜尋第一個看得到的字
    let a0 = 0, b0 = gl.length;
    while (a0 < b0) { const m = (a0 + b0) >> 1; if (gl[m]!.s + gl[m]!.w < lo) a0 = m + 1; else b0 = m; }
    let fkey = '';
    for (let i = a0; i < gl.length; i++) {
      const g = gl[i]!;
      if (g.s > hi) break;
      const sc = g.s + g.w / 2;
      const ps = this.psi(sc - this.P0);
      const r = this.rAt(ps);
      const a = ps + st.th;
      const ad = a / DEG;
      const vis = alpha * prog(ad, -VIS.l1, -VIS.l0, ease.inOutQuad) * (1 - prog(ad, VIS.r0, VIS.r1, ease.inOutQuad));
      if (vis <= 0.004) continue;
      const size = g.main ? SIZE : SIZE * 0.62;
      if (fkey !== g.fam + size) { fkey = g.fam + size; c.font = font(g.fam, size); }
      const lit = clamp((P - g.s) / g.w);
      const heat = !g.main ? 0 : lit < 1 ? 1 : Math.exp(-(P - g.s - g.w) / 110);
      const wRef = g.w;
      c.save();
      c.translate(C.x + Math.sin(a) * r, C.y - Math.cos(a) * r);
      c.rotate(a);
      const x0 = -wRef / 2, split = x0 + lit * wRef;
      const unsungA = (g.main ? 0.3 : 0.16) * vis, sungA = (g.main ? 1 : 0.42) * vis;
      if (g.ch === '♥') {
        // 愛心只用自己畫的那顆、只用點綴色（b 版 = 1），讀到之前一樣淡
        c.globalAlpha = lit > 0.5 ? sungA : unsungA;
        drawHeart(c, 0, -size * 0.34, size * 0.78, 'rgb(0,0,255)');
        c.restore();
        continue;
      }
      if (lit < 1) {
        c.save();
        if (lit > 0) { c.beginPath(); c.rect(split, -size * 1.3, wRef + 8, size * 1.8); c.clip(); }
        c.globalAlpha = unsungA;
        c.fillStyle = 'rgb(0,0,0)';
        c.fillText(g.ch, x0, 0);
        c.restore();
      }
      if (lit > 0) {
        c.save();
        if (lit < 1) { c.beginPath(); c.rect(x0 - 8, -size * 1.3, split - x0 + 8, size * 1.8); c.clip(); }
        c.globalAlpha = sungA;
        c.fillStyle = `rgb(255,${Math.round(heat * 255)},0)`;
        c.fillText(g.ch, x0, 0);
        c.restore();
      }
      c.restore();
    }
    c.restore();
    return L.upload();
  }

  /** 左上角曲目資訊每一行的基線（跟圓環左邊的字保持距離：兩行歌名時整塊縮緊）。 */
  private infoY() {
    const tf = this.titleFit!;
    const title = 126 + 24 + tf.size;
    const last = title + (tf.lines.length - 1) * tf.lineHeight;
    const artist = last + (tf.lines.length > 1 ? 42 : 38);
    const rule = artist + 22;
    const rpm = rule + 32;
    return { title, artist, rule, rpm, readout: rpm + 34 };
  }

  // ---------------------------------------------------------------- 卡片、曲目資訊、註腳
  /**
   * 卡片這一格的樣子。卡片在切進來的那一拍（窗格一定切在拍點上）滑出來、晃一下停好，唱針在下一拍落下：
   * 兩件事各佔一拍。只有樣子變了才重畫、重新上傳。回傳滑出的程度（1 = 在畫面外，不用合成）。
   */
  private drawCardLayer(t: number): number {
    const s = this.ctx.start, e = this.ctx.end;
    const c0 = s + 0.04, dt = Math.max(0, t - c0);
    const cin = prog(t, c0, c0 + 0.62, ease.outExpo);
    const cout = prog(t, e - 0.5, e - 0.05, ease.inCubic);
    const settle = dt >= 1.4 ? 1 : 1 - Math.exp(-6 * dt) * Math.cos(9 * dt);
    const slide = Math.min(1, 1 - cin + cout);
    const rot = lerp(-5, -1.2, clamp(settle, 0, 1.2)) * DEG;
    const bodyK = prog(t, c0 + 0.2, c0 + 0.7);
    const sigK = this.cardKind === 'msg' ? prog(t, this.tDrop + this.beat, this.tDrop + this.beat + 0.4) : 1;
    const key = `${slide.toFixed(4)}|${rot.toFixed(4)}|${bodyK.toFixed(2)}|${sigK.toFixed(2)}`;
    if (slide >= 1 || key === this.cardKey) return slide;
    this.cardKey = key;
    const L = this.cardL, c = L.ctx;
    L.clear();
    const w = CARD.w, h = this.cardH, M = CARD_M;
    const top = clamp(515 - h / 2, CARD.top, CARD.bottom - h);
    const x = CARD.x + slide * (W - CARD.x + 60);
    const [paper, body, sig] = this.cardParts;
    c.save();
    c.translate(-CARD_R.x, -CARD_R.y);
    c.translate(x + w / 2, top + h / 2);
    c.rotate(rot);
    c.translate(-w / 2 - M, -h / 2 - M);
    c.drawImage(paper!, 0, 0, w + 2 * M, h + 2 * M);
    c.globalAlpha = bodyK;
    c.drawImage(body!, 0, 0, w + 2 * M, h + 2 * M);
    c.globalAlpha = sigK;
    c.drawImage(sig!, 0, 0, w + 2 * M, h + 2 * M);
    c.restore();
    L.upload();
    return slide;
  }

  /**
   * 曲目資訊層：唱針位置的讀數（跟著螺旋往內走）取到 0.5 mm，變了才重畫、重新上傳（一個窗格幾十次，不是每格）。
   */
  private drawInfoLayer(st: ReturnType<Vinyl['stateAt']>) {
    const r = `${(Math.round((st.rb + STY) * MM * 2) / 2).toFixed(1)}`;
    if (r === this.infoKey) return;
    this.infoKey = r;
    const L = this.info, c = L.ctx;
    L.clear();
    c.save(); c.translate(-INFO_R.x, -INFO_R.y);
    this.drawInfo(c, r);
    c.restore();
    L.upload();
  }

  /**
   * 左上角：曲目資訊（歌名、歌手、轉速、唱針讀數）；左下角：冷面註腳。
   * 小字的讀數墊一塊墨色的底（pdoom 的標籤做法）：唱片外緣的亮邊與刻度會從這裡穿過去。
   */
  private drawInfo(c: CanvasRenderingContext2D, readout: string) {
    const { song, audio: au } = this.ctx;
    const X = INFO_X, Y = this.infoY();
    c.save();
    c.textBaseline = 'alphabetic';
    c.font = font(F.mono(500), 15);
    c.letterSpacing = '4px';
    c.fillStyle = rgba('ash', 0.9);
    c.fillText(`NOW PLAYING  ·  SIDE A  ·  TRACK ${String(song.index).padStart(2, '0')}`, X, 126);
    c.letterSpacing = '0px';
    const tf = this.titleFit!;
    c.font = font(F.archivo(100, 800), tf.size);
    c.fillStyle = rgba('bone', 0.96);
    tf.lines.forEach((ln, i) => c.fillText(ln, X, Y.title + i * tf.lineHeight));
    if (song.artist) {
      const af = fitText(c, song.artist, F.serif(400, true), 400, 40, { min: 20, max: 32, maxLines: 1 });
      c.font = font(F.serif(400, true), af.size);
      c.fillStyle = rgba('ash', 0.95);
      c.fillText(af.lines[0] ?? '', X, Y.artist);
    }
    c.fillStyle = rgba('bone', 0.22);
    c.fillRect(X, Y.rule, 250, 1);
    // 轉速：45 或 33⅓（分數自己排，Plex Mono 沒有 ⅓ 這個字）
    const y = Y.rpm;
    const label = (x0: number, yb: number, w: number, hh: number) => { c.fillStyle = rgba('ink', 0.86); c.fillRect(x0 - 8, yb - hh + 4, w + 16, hh + 6); };
    const big0 = this.rpm === 45 ? '45' : '33', bpmTxt = `  ${Math.round(au.bpm)} BPM`;
    c.font = font(F.mono(500), 22);
    let lw = c.measureText(big0).width + 3 + (this.rpm === 45 ? 0 : 17) + c.measureText(' RPM').width;
    c.font = font(F.mono(400), 14); c.letterSpacing = '2px'; lw += c.measureText(bpmTxt).width; c.letterSpacing = '0px';
    label(X, y, lw, 28);
    c.font = font(F.mono(500), 22);
    c.fillStyle = rgba('signal');
    let x = X;
    const big = this.rpm === 45 ? '45' : '33';
    c.fillText(big, x, y); x += c.measureText(big).width + 3;
    if (this.rpm !== 45) {
      c.font = font(F.mono(500), 11);
      c.fillText('1', x, y - 10);
      c.save(); c.translate(x + 7, y - 7); c.rotate(-1.05); c.fillRect(-8, -0.6, 16, 1.2); c.restore();
      c.fillText('3', x + 8, y + 1);
      x += 17;
    }
    c.font = font(F.mono(500), 22);
    c.fillText(' RPM', x, y); x += c.measureText(' RPM').width;
    c.font = font(F.mono(400), 14);
    c.letterSpacing = '2px';
    c.fillStyle = rgba('ash', 0.85);
    c.fillText(`  ${Math.round(au.bpm)} BPM`, x, y - 1);
    // 唱針位置（真的唱片外徑 150 mm 換算）
    c.font = font(F.mono(500), 14);
    c.letterSpacing = '3px';
    const rt = `STYLUS  r ${readout} mm`;
    label(X, Y.readout, c.measureText(rt).width, 20);
    c.fillStyle = rgba('ash', 0.9);
    c.fillText(rt, X, Y.readout);
    c.letterSpacing = '2px';
    // 註腳
    c.font = font(F.mono(400), 15);
    c.fillStyle = rgba('ash', 0.72);
    c.fillText(FOOTNOTE, X, H - 108);
    c.letterSpacing = '0px';
    c.restore();
  }

  /**
   * liner notes 卡片的三張圖（紙＋標頭＋註腳、內文、署名）：紙色、墨色字。
   * 在 init 畫一次（紙的影子用 shadowBlur 很貴，不能每格畫），之後每格只是轉一下貼上去。
   */
  private buildCard() {
    const w = CARD.w, h = this.cardH, M = CARD_M, pad = 36;
    const mk = () => {
      const cv = document.createElement('canvas');
      cv.width = Math.round((w + 2 * M) * SCALE); cv.height = Math.round((h + 2 * M) * SCALE);
      const c = scaleContext2D(cv.getContext('2d')!, SCALE);
      c.translate(M, M);
      c.textBaseline = 'alphabetic';
      return { cv, c };
    };
    const P = mk(), B = mk(), S = mk();
    this.cardParts = [P.cv, B.cv, S.cv];
    this.track({ dispose: () => { for (const cv of this.cardParts) cv.width = cv.height = 0; } });
    const m = this.msg;
    // 紙：壓在唱片上的影子、紙色（往墨色靠一點：整張紙白的卡在暗版面上太刺眼）、很淡的光
    let c = P.c;
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.55)'; c.shadowBlur = 34; c.shadowOffsetX = 14; c.shadowOffsetY = 18;
    c.fillStyle = mixRgba('paper', 'sepia', 0.07);
    c.fillRect(0, 0, w, h);
    c.restore();
    const gr = c.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, 'rgba(255,255,255,0.05)'); gr.addColorStop(1, 'rgba(0,0,0,0.07)');
    c.fillStyle = gr; c.fillRect(0, 0, w, h);
    // 標頭
    c.font = font(F.mono(500), 15);
    c.letterSpacing = '4px';
    c.fillStyle = rgba('sepia', 0.8);
    c.fillText('LINER NOTES', pad, pad + 16);
    c.textAlign = 'right';
    const no = m ? `No.${String(m.n).padStart(3, '0')}` : 'No.———';
    if (m?.couple) { c.fillStyle = rgba('blood'); c.fillText(`FROM THE COUPLE  ·  ${no}`, w - pad, pad + 16); }
    else c.fillText(this.cardKind === 'credits' ? `A1  ·  ${no}` : no, w - pad, pad + 16);
    c.textAlign = 'left';
    c.letterSpacing = '0px';
    c.fillStyle = rgba('sepia', 0.4);
    c.fillRect(pad, pad + 34, w - 2 * pad, 1);
    c.fillRect(pad, pad + 38, w - 2 * pad, 0.6);
    // 註腳
    c.fillStyle = rgba('sepia', 0.35);
    c.fillRect(pad, h - pad - 30, w - 2 * pad, 0.8);
    c.font = font(F.mono(400), 13);
    c.letterSpacing = '1px';
    c.fillStyle = rgba('sepia', 0.62);
    c.fillText(this.cardKind === 'invite' ? INVITE_NOTE : CARD_NOTE, pad, h - pad - 6);
    c.letterSpacing = '0px';
    // 內文
    c = B.c;
    const y0 = pad + 34 + 22;
    if (this.cardKind === 'msg' && m && this.cardFit) {
      const fit = this.cardFit;
      c.font = font(F.hand(400), fit.size);
      c.fillStyle = rgba('sepia', 0.95);
      fit.lines.forEach((ln, i) => fillHearts(c, ln, pad, y0 + fit.size + i * fit.lineHeight, fit.size));
      // 署名：另一張圖，晚一拍才出現
      const sc = S.c;
      sc.font = font(F.hand(400), 36);
      sc.textAlign = 'right';
      sc.fillStyle = rgba('sepia', 0.78);
      sc.fillText(signature(m.name), w - pad, y0 + fit.height + 22 + 38);
    } else if (this.cardKind === 'credits' && m) {
      const rows: [string, string][] = [['作詞', m.name || '一位賓客'], ['收錄', `《${this.ctx.song.title || '今晚的歌'}》A 面`], ['監製', COUPLE_ZH]];
      rows.forEach(([k, v], i) => {
        const yy = y0 + 44 + i * 58;
        c.font = font(F.hei(500), 20); c.letterSpacing = '6px'; c.fillStyle = rgba('sepia', 0.6);
        c.fillText(k, pad, yy - 4); c.letterSpacing = '0px';
        const vf = fitText(c, v, F.hand(400), w - 2 * pad - 96, 50, { min: 24, max: 40, maxLines: 1 });
        c.font = font(F.hand(400), vf.size); c.fillStyle = rgba('sepia', 0.95);
        c.fillText(vf.lines[0] ?? v, pad + 96, yy);
      });
    } else {
      c.font = font(F.hand(700), 60); c.fillStyle = rgba('sepia', 0.95);
      c.fillText(INVITE[0]!, pad, y0 + 64);
      c.font = font(F.hand(400), 38); c.fillStyle = rgba('sepia', 0.85);
      c.fillText(INVITE[1]!, pad, y0 + 64 + 62);
      c.fillText(INVITE[2]!, pad, y0 + 64 + 112);
      // 留白的橫線（像等人來寫）與指向右下角 QR 的細箭頭
      c.fillStyle = rgba('sepia', 0.25);
      c.fillRect(pad, y0 + 64 + 150, w - 2 * pad - 70, 1);
      const ax = w - pad - 34, ay = y0 + 64 + 150;
      c.strokeStyle = rgba('sepia', 0.7); c.lineWidth = 1.4;
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(ax + 30, ay + 30); c.moveTo(ax + 30, ay + 30); c.lineTo(ax + 30, ay + 16); c.moveTo(ax + 30, ay + 30); c.lineTo(ax + 16, ay + 30); c.stroke();
    }
  }
}

/** 一張只蓋住畫面一部分的圖層（r，邏輯像素、y 向下）貼回全螢幕時，Compositor 要的 UV 縮放與位移。 */
function subRect(r: { x: number; y: number; w: number; h: number }) {
  return {
    scale: [W / r.w, H / r.h] as [number, number],
    offset: [(0.5 * W - r.x) / r.w - 0.5, (0.5 * H - (H - r.y - r.h)) / r.h - 0.5] as [number, number],
  };
}

/**
 * 畫一行字，裡面的 ♥ 換成自己畫的愛心（點綴色）：字型裡的愛心顏色跟著字走，不符合「愛心只用點綴色」。
 * 愛心佔的寬度照字型的 ♥ 量（斷行時就是這樣量的）。
 */
function fillHearts(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number) {
  if (!text.includes('♥')) { c.fillText(text, x, y); return; }
  const parts = text.split('♥');
  const hw = c.measureText('♥').width;
  parts.forEach((part, i) => {
    if (part) c.fillText(part, x, y);
    x += c.measureText(part).width;
    if (i < parts.length - 1) { drawHeart(c, x + hw / 2, y - size * 0.34, size * 0.72); x += hw; }
  });
}

/**
 * 留言的排版：中文先試「只在標點處斷行」（詞才不會被拆開，例如「相親 / 相愛」），
 * 字級不會小太多（≥ 52 px、且至少是一般排法的 55%）就用它；不然照一般的平衡斷行。英文照一般排法。
 */
function fitClauses(c: CanvasRenderingContext2D, text: string, family: string, w: number, h: number, o: { min: number; max: number; lineHeight: number; maxLines: number }): FitResult {
  const base = fitText(c, text, family, w, h, o);
  if (!/[\p{Script=Han}]/u.test(text)) return base;
  const parts = text.match(/[^，。！？!?,.、~～…；;：:\s]+[，。！？!?,.、~～…；;：:\s]*|[，。！？!?,.、~～…；;：:\s]+/gu) ?? [text];
  for (let size = o.max; size >= Math.max(o.min, 52); size -= 2) {
    c.font = font(family, size);
    const lines: string[] = [];
    let cur = '', ok = true;
    for (const part of parts) {
      if (c.measureText((cur + part).trimEnd()).width <= w) { cur += part; continue; }
      if (!cur.trim()) { ok = false; break; }
      lines.push(cur.trimEnd());
      cur = part.trimStart();
      if (c.measureText(cur.trimEnd()).width > w) { ok = false; break; }
    }
    if (!ok) continue;
    if (cur.trim()) lines.push(cur.trimEnd());
    const lh = size * o.lineHeight, height = size + (lines.length - 1) * lh;
    if (lines.length > o.maxLines || height > h) continue;
    if (size < base.size * 0.55) break;
    return { size, lines, lineHeight: lh, width: Math.max(...lines.map((l) => c.measureText(l).width)), height };
  }
  return base;
}

/** 色票往黑色混一點（Canvas2D 用）。 */
function mixDark(key: string, k: number) {
  const m = rgba(key).match(/\d+/g)!.map(Number);
  return `rgba(${Math.round(m[0]! * (1 - k))},${Math.round(m[1]! * (1 - k))},${Math.round(m[2]! * (1 - k))},1)`;
}
