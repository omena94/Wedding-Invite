// 黑膠唱片（照 pdoom 的 spacetime「字排在圓環上、唱到才點亮」與 loom「一條線被火花一路寫出來」）。
// 一張轉動的黑膠擺在唱盤上，旁邊放著唱片封套裡的 liner notes 紙卡；一台相機斜斜往下看、很慢地搖與推（像 MV 的桌面特寫），
// 一盞暖燈照在唱針與紙卡之間，遠端暗下去、微微失焦。
//  - 歌詞刻在溝紋上（一條往內捲的螺旋），唱針固定在正上方：唱片的轉動「鎖」在歌聲上，
//    每個字正好在被唱到的那一刻轉到唱針底下、亮起來（訊號色、發光），唱完冷卻成紙白，轉到左邊淡掉。
//    溝紋上只看得到正在唱的那一句（下一句快開始才浮出來），其他的溝是空的——背景要能呼吸。
//  - 要讓字由左往右讀、又讓唱針依序讀到，唱片只能逆時針轉——左下角的小註腳一本正經地說明這件事。
//  - 唱針是仙女棒的火花：拖著一段剛讀過、還在發燙的溝。
//  - 主打留言印在 liner notes 紙卡上：一張真的紙在第一拍滑進來、落到桌上（影子收近），跟著桌面一起有透視與燈光。
//    留言是整個畫面最大、最清楚的字；沒有留言時是一張寫著邀請的卡（焦點交給歌詞）。
//  - 純音樂（這個窗格沒有人唱）：溝紋改刻留言（短的）或新人的名字，唱針用閱讀的速度讀過去；卡片改成唱片的製作名單。
//  - 轉速依 BPM 選 33⅓ 或 45（印在標籤上）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides } from '../engine/scene';
import { FSPass, Layer2D, makeRT, W, H, SCALE } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, layout, loadText } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, lerp, prog, pulse, noise1, TAU } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { sparkHead, sparkParticles, beatAfter, signature, drawHeart, COUPLE_EN, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { FRAG_VINYL, FRAG_DOF } from './vinyl-glsl';

type P2 = { x: number; y: number };

// ---------------------------------------------------------------- 桌面上的東西（桌面座標：邏輯 px，y 向下）
/** 唱片圓心與半徑：下緣出畫面，上方留給唱臂，右邊放紙卡。 */
const C = { x: 600, y: 790 };
const R_REC = 640;
/** 圓心標籤半徑（真的唱片約三分之一）。 */
const R_LAB = 205;
/** 窗格開始時，唱針底下那個字的基線半徑；之後沿著螺旋往內。 */
const R0 = 466;
/** 唱臂軸心（右上角，紙卡上方）。 */
const PIVOT = { x: 1640, y: 128 };
/** 刻字的那一層只涵蓋圓環附近（上傳比整張小一半以上）。 */
const TR = { x: 40, y: 170, w: 1190, h: 660 };
/** 紙卡：中心、寬、最高多高（高度看內容）。透視之後右緣約在螢幕 x 1800、下緣在 QR（y ≥ 830）上面。 */
const CARD = { x: 1400, y: 525, w: 540, maxH: 556, top: 244 };
/** 紙卡的字畫得比桌面細兩倍：相機推近時放大才不會糊。 */
const CARD_PX = 2;
/** 燈照在桌面上的中心。 */
const LAMP = { x: 1050, y: 330 };
/** 螢幕上的小字（曲目、註腳）的圖層範圍。 */
const INFO_R = { x: 96, y: 90, w: 900, h: 910 };
const INFO_X = 128;
/** 圓環上的字看得到的角度（從正上方算，度）：右邊（還沒唱的）與左邊（唱過的）各自淡出。 */
const VIS = { r0: 50, r1: 78, l0: 52, l1: 82 };
const DEG = Math.PI / 180;
/** 景深：最大模糊半徑（邏輯 px）、比唱針遠多少開始糊。 */
const DOF_R = 4.5;

/** 歌詞的聲音：壓窄的 Archivo（中文、韓文自動接思源黑體）。 */
const FAM_LYRIC = F.archivo(75, 800);
/** 留言的聲音：霞鶩文楷。 */
const FAM_MSG = F.hand(700);

const FOOTNOTE = '＊本唱片逆時針播放，以便由左至右閱讀。';
const INVITE = ['這一面還空著。', '掃描右下角 QR code，', '把你的祝福刻進下一首歌。'];

const BG = () => new FSPass(FRAG_VINYL, {
  uHinv: { value: new THREE.Matrix3() }, uDepth: { value: new THREE.Vector3(0, 0, 1) }, uFocus: { value: new THREE.Vector2(1, 10) },
  uLamp: { value: new THREE.Vector2(LAMP.x, LAMP.y) },
  uC: { value: new THREE.Vector2(C.x, C.y) }, uR: { value: R_REC }, uRl: { value: R_LAB }, uTh: { value: 0 }, uFan: { value: 0 },
  uFanK: { value: 1 }, uIn: { value: 1 }, uHat: { value: 0 },
  uS: { value: new THREE.Vector2() }, uE: { value: new THREE.Vector2() }, uP: { value: new THREE.Vector2(PIVOT.x, PIVOT.y) }, uLift: { value: 0 },
  uLab: { value: null }, uTxt: { value: null }, uTR: { value: new THREE.Vector4(TR.x, TR.y, TR.w, TR.h) },
  uCard: { value: null }, uCardG: { value: new THREE.Vector4() }, uCardS: { value: new THREE.Vector2(1, 1) }, uCardK: { value: new THREE.Vector3() },
});
const DOF = () => new FSPass(FRAG_DOF, { uScn: { value: null }, uMaxR: { value: DOF_R }, uTexel: { value: new THREE.Vector2(1 / W, 1 / H) } });

// ---------------------------------------------------------------- 相機：桌面 → 螢幕
/**
 * 針孔相機斜斜往下看桌面。桌面是一個平面，所以「桌面 → 螢幕」是一個 3×3 的單應矩陣：
 * shader 拿它的反矩陣把每個螢幕像素換回桌面座標（唱片、紙卡、唱臂一起有透視），
 * 火花（LineBatch 畫在螢幕上）則用 proj() 把桌面上的點換到螢幕。
 */
class TableCam {
  f = 1700;
  private rx = [1, 0, 0];
  private ry = [0, 1, 0];
  private rz = [0, 0, 1];
  private D = 1700;
  private T: P2 = { x: 0, y: 0 };
  private S: P2 = { x: 0, y: 0 };
  /**
   * th：視線偏離正上方幾度；phi：桌面上「遠端」的方向（度，y 向下，180 = 左邊）；
   * s：對準的那一點放大幾倍（推鏡頭）；T：對準桌面上的哪一點，S：那一點在螢幕上的位置。
   */
  set(th: number, phi: number, s: number, T: P2, S: P2) {
    const t = th * DEG, p = phi * DEG, c = Math.cos(t), sn = Math.sin(t);
    // Rodrigues：相機三個軸繞桌面上的軸 u（垂直於遠端方向）轉 th
    const ux = -Math.sin(p), uy = Math.cos(p);
    const rot = (vx: number, vy: number, vz: number, o: number[]) => {
      const dot = ux * vx + uy * vy;
      o[0] = vx * c + uy * vz * sn + ux * dot * (1 - c);
      o[1] = vy * c - ux * vz * sn + uy * dot * (1 - c);
      o[2] = vz * c + (ux * vy - uy * vx) * sn;
    };
    rot(1, 0, 0, this.rx); rot(0, 1, 0, this.ry); rot(0, 0, 1, this.rz);
    this.D = this.f / s;
    this.T = T; this.S = S;
  }
  private z(x: number, y: number) { return this.rz[0]! * (x - this.T.x) + this.rz[1]! * (y - this.T.y) + this.D; }
  proj(x: number, y: number): P2 {
    const X = x - this.T.x, Y = y - this.T.y, z = this.z(x, y);
    return { x: this.S.x + (this.f * (this.rx[0]! * X + this.rx[1]! * Y)) / z, y: this.S.y + (this.f * (this.ry[0]! * X + this.ry[1]! * Y)) / z };
  }
  /** 桌面上這一點在螢幕上放大幾倍（字級換算、景深用）。 */
  mag(x: number, y: number) { return this.f / this.z(x, y); }
  /** 螢幕 → 桌面（shader 的 uHinv）。 */
  inverse(m: THREE.Matrix3) {
    const { f, rx, ry, rz, D, T, S } = this;
    const row = (a: number, b: number, cc: number) => [a, b, cc - a * T.x - b * T.y] as const;
    const r1 = row(f * rx[0]! + S.x * rz[0]!, f * rx[1]! + S.x * rz[1]!, S.x * D);
    const r2 = row(f * ry[0]! + S.y * rz[0]!, f * ry[1]! + S.y * rz[1]!, S.y * D);
    const r3 = row(rz[0]!, rz[1]!, D);
    return m.set(r1[0], r1[1], r1[2], r2[0], r2[1], r2[2], r3[0], r3[1], r3[2]).invert();
  }
  /** 1 / 放大率 = dot(xy, p) + z（shader 的 uDepth）。 */
  depth(v: THREE.Vector3) {
    const { f, rz, D, T } = this;
    return v.set(rz[0]! / f, rz[1]! / f, (D - rz[0]! * T.x - rz[1]! * T.y) / f);
  }
}

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

/**
 * 圓環上的一個字（字元）。s = 左緣在螺旋上的弧長；dim = 亮度（新人名字當配角時比較暗）；
 * ln = 第幾句歌詞（-1：不是歌詞，一直看得到）。
 */
interface RG { ch: string; fam: string; s: number; w: number; size: number; dim: number; ln: number }

/**
 * 把一小段字（新人的名字、日期）一再重複排在弧長 from～to 之間，排不下的字不排。
 * 只排一次版再平移：layout() 逐字量前綴，長字串會很慢。
 */
function tile(unit: string, fam: string, size: number, from: number, to: number, dim: number): RG[] {
  const lay = layout(unit, fam, size);
  const out: RG[] = [];
  if (lay.width <= 0) return out;
  for (let o = from; o < to; o += lay.width) {
    for (const g of lay.glyphs) {
      if (!g.ch.trim()) continue;
      if (o + g.x + g.w > to) return out;
      out.push({ ch: g.ch, fam, s: o + g.x, w: g.w, size, dim, ln: -1 });
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
  dof = shared('vinyl.dof', DOF);
  /** 主 pass 先畫到這裡（alpha = 景深模糊量），再由景深 pass 貼到輸出。 */
  scn = this.track(makeRT(W, H, { depthBuffer: false }));
  /** 刻在溝紋上的字（遮罩，交給 shader 上色、讓溝紋從字裡穿過去）。fast 上傳：每格都要重畫、重傳。 */
  txt = this.track(new Layer2D(TR.w, TR.h, SCALE, { fast: true }));
  /** 螢幕上的兩小群字（左上角曲目、左下角註腳）：init 畫一次。 */
  info = this.track(new Layer2D(INFO_R.w, INFO_R.h, SCALE, { fast: true }));
  glow = this.track(new LineBatch(3000, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  labelTex: THREE.CanvasTexture | null = null;
  cardTex: THREE.CanvasTexture | null = null;
  cam = new TableCam();
  hinv = new THREE.Matrix3();

  rpm = 45;
  vIdle = 200;
  head!: HeadCurve;
  glyphs: RG[] = [];
  /** 每句歌詞的時間（溝紋上只看得到正在唱的那一句）。 */
  lines: { start: number; end: number }[] = [];
  /** 溝紋上主要文字的字級（桌面 px）與唱針尖在字的基線外多遠（停在字頂上方，唱頭才不會蓋住正在唱的字）。 */
  sz = 60;
  sty = 70;
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
  /** 紙卡的寬高（桌面 px）：留言用大卡；邀請、製作名單不是焦點，用小一點的卡。 */
  cardW: number = CARD.w;
  cardH = 400;
  tDrop = 0;
  beat = 0.5;

  override async init() {
    const { audio: au, lyrics, song, start, end } = this.ctx;
    this.beat = au.beatPeriod(start);
    this.tDrop = beatAfter(au, start + 0.05);
    this.rpm = rpmFor(au.bpm);
    // 慢動作的轉速（真的 45 轉，字會糊成一片）：約十分之一，換成圓環上的 px/s
    this.vIdle = (this.rpm / 60) * TAU * 0.105 * R0;
    const name = this.msg ? (this.msg.name || '一位賓客') : '';
    await loadText(`${song.title}${song.artist}${COUPLE_ZH}${FOOTNOTE}${INVITE.join('')}${name}作詞收錄監製《》面婚禮現場錄音℗`);
    const inWin = lyrics.lines.filter((l) => l.end > start - 10 && l.start < end + 10);
    await loadText(inWin.map((l) => l.text).join(''));

    // 紙卡先排：歌詞的字級要看留言的字級（歌詞一定比留言小一級）
    const singing = lyrics.lines.some((l) => l.words.some((w) => w.end > start + 0.2 && w.start < end - 0.3));
    this.cardKind = this.msg ? 'msg' : 'invite';
    if (!singing && this.msg && this.messageFitsRing(this.msg)) this.cardKind = 'credits';
    this.layoutCard();
    // 相機走完整個窗格，唱針那裡最小會放大幾倍：溝紋上的字在螢幕上至少 50 px
    let magMin = Infinity;
    for (const u of [0, 0.5, 1]) { this.camAt(start + 1.3 + u * Math.max(0, end - start - 1.3)); magMin = Math.min(magMin, this.cam.mag(C.x, C.y - R0 - 30)); }
    const minSz = Math.ceil(50 / magMin);
    const msgSz = this.cardKind === 'msg' && this.cardFit ? this.cardFit.size : 999;
    this.sz = clamp(Math.round(msgSz * 0.86), minSz, Math.max(minSz, 60));

    let knots: [number, number][] = [];
    if (singing) knots = this.buildLyrics(inWin);
    else if (this.cardKind === 'credits') knots = this.buildMessageRing(this.msg!, minSz);
    else knots = this.buildNames(minSz);
    this.sty = this.sz + 10;
    this.head = new HeadCurve(cleanKnots(knots, 1500), this.vIdle);
    this.P0 = this.head.at(start);
    // 螺旋：整個窗格唱針往內走的量（一圈約一行字高，最多 110 px）
    const S = Math.max(1, this.head.at(end) - this.P0);
    const dr = Math.min(110, (72 * S) / (TAU * R0));
    this.k = dr / (S / (R0 - dr / 2));
    // 唱臂長度：螺旋中段時唱針剛好在正上方
    const rMid = R0 - dr / 2 + this.sty;
    this.armL = Math.hypot(PIVOT.x - C.x, PIVOT.y - (C.y - rMid));
    this.glyphs.sort((a, b) => a.s - b.s);
    this.labelTex = this.buildLabel();
    this.cardTex = this.buildCard();
    this.drawInfo();
  }

  // ---------------------------------------------------------------- 溝紋上要刻什麼
  /** 歌詞：每行依序排在螺旋上，行與行之間空出間奏的長度（間奏越長、空白的溝越長，像唱片上曲與曲之間）。 */
  private buildLyrics(lines: { text: string; start: number; end: number; words: { w: string; start: number; end: number; o: number }[] }[]): [number, number][] {
    const knots: [number, number][] = [];
    const size = this.sz;
    let prevEndT = NaN, prevEndX = 0;
    for (const line of lines) {
      const lay = layout(line.text, FAM_LYRIC, size);
      const cps = Array.from(line.text);
      const u2c: number[] = [];
      let u = 0;
      cps.forEach((ch, i) => { for (let q = 0; q < ch.length; q++) u2c[u + q] = i; u += ch.length; });
      u2c[u] = cps.length;
      const base = Number.isNaN(prevEndT) ? 0 : prevEndX + Math.max(size * 1.3, this.vIdle * Math.max(0, line.start - prevEndT));
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
      const ln = this.lines.length;
      this.lines.push({ start: line.start, end: line.end });
      for (const g of lay.glyphs) if (g.ch.trim()) this.glyphs.push({ ch: g.ch, fam: FAM_LYRIC, s: base + g.x, w: g.w, size, dim: 1, ln });
      prevEndT = line.end;
      prevEndX = Math.max(right, base + lay.width);
    }
    return knots;
  }

  /** 純音樂時，留言刻得上溝紋嗎（一秒要讀超過 6.5 個字、或一整圈都放不下就不刻，放在卡片上）。 */
  private messageFitsRing(m: Msg) {
    const lay = layout(m.text, FAM_MSG, 66);
    const usable = this.ctx.end - this.beat - 1.2 - (this.tDrop + this.beat * 0.5);
    return lay.glyphs.length / Math.max(0.1, usable) <= 6.5 && lay.width <= R0 * 2.4;
  }

  /**
   * 純音樂＋短留言：留言是溝紋上的主角（比平常的歌詞大一點），第一拍之後用閱讀的速度讀過去，接著署名。
   * 讀完一遍、一顆愛心，再從頭讀——像唱片的鎖溝一直轉。
   */
  private buildMessageRing(m: Msg, minSz: number): [number, number][] {
    const { end } = this.ctx;
    const size = this.sz = Math.max(66, minSz);
    const lay = layout(m.text, FAM_MSG, size);
    const n = lay.glyphs.length;
    const t0 = this.tDrop + this.beat * 0.5;
    const rate = n / Math.max(0.1, end - this.beat - 1.2 - t0);
    const v = (Math.max(3.5, rate) * lay.width) / n;
    const sig = layout(signature(m.name), F.hand(400), size * 0.72);
    const sx = lay.width + size * 0.6, hx = sx + sig.width + size * 0.7;
    const cycle = hx + size * 0.8 + size * 0.9;
    const reps = Math.ceil(((end - t0) * v + R0 * 2) / cycle) + 1;
    for (let k = 0; k < reps; k++) {
      const o = k * cycle;
      for (const g of lay.glyphs) if (g.ch.trim()) this.glyphs.push({ ch: g.ch, fam: FAM_MSG, s: o + g.x, w: g.w, size, dim: 1, ln: -1 });
      for (const g of sig.glyphs) if (g.ch.trim()) this.glyphs.push({ ch: g.ch, fam: F.hand(400), s: o + sx + g.x, w: g.w, size: size * 0.72, dim: 0.8, ln: -1 });
      this.glyphs.push({ ch: '♥', fam: FAM_MSG, s: o + hx, w: size * 0.8, size, dim: 1, ln: -1 });
    }
    this.sung.push([t0, end]);
    return [[t0, 0], [t0 + (reps * cycle) / v, reps * cycle]];
  }

  /**
   * 沒有歌詞也沒有（刻得下的）留言：刻新人的名字與日期，用閒置轉速一路讀過去。
   * 旁邊的紙卡上有留言時，名字只是配角（小一號、暗一點）。
   */
  private buildNames(minSz: number): [number, number][] {
    const { start, end } = this.ctx;
    const second = this.cardKind === 'msg';
    const size = this.sz = second ? Math.max(minSz * 0.86, 44) : this.sz;
    const unit = `${COUPLE_EN.toUpperCase()}  ·  ${COUPLE_ZH}  ·  ${DATE_DOTS}  ·  `;
    const x0 = R0 * 2, x1 = x0 + this.vIdle * (end - start);
    this.glyphs.push(...tile(unit, FAM_LYRIC, size, 0, x1 + R0 * 2, second ? 0.45 : 1));
    this.sung.push([start, end]);
    return [[start, x0], [end, x1]];
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
    const ang = (p: P2) => Math.atan2(p.x - C.x, -(p.y - C.y));
    const p = Math.abs(ang(p1)) < Math.abs(ang(p2)) ? p1 : p2;
    return { x: p.x, y: p.y, a: ang(p) };
  }

  /** t 時的唱針與唱片狀態（桌面座標）。 */
  private stateAt(t: number) {
    const P = this.head.at(t);
    const ps = this.psi(P - this.P0);
    const rb = this.rAt(ps);
    const st = this.stylus(rb + this.sty);
    return { P, ps, rb, st, th: st.a - ps };
  }

  // ---------------------------------------------------------------- 鏡頭
  /**
   * 這一格的相機：整個窗格很慢地繞一點、推近一點（窗格越長走越多，短窗格只走一小段，不會變成甩鏡頭）；
   * 切進來時從高一點、偏一點的地方落定（進場的動作），最後一拍半加速推近。
   */
  private camAt(t: number) {
    const s = this.ctx.start, e = this.ctx.end;
    const amt = clamp((e - s) / 16, 0.35, 1);
    const p = ease.inOutQuad(clamp((t - s) / Math.max(0.1, e - s))) - 0.5;
    const kin = 1 - prog(t, s, s + 1.25, ease.outCubic);
    const kout = prog(t, e - this.beat * 1.5, e, ease.inCubic);
    this.cam.set(19.5 - 3 * amt * p + 6 * kin, 201 + 10 * amt * p - 7 * kin, 1 + 0.06 * amt * p - 0.06 * kin + 0.035 * kout,
      { x: 905 + 16 * amt * p, y: 540 }, { x: 930, y: 540 });
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
    tex.anisotropy = Math.min(4, this.ctx.renderer.capabilities.getMaxAnisotropy());
    tex.flipY = true;
    this.track({ dispose: () => { tex.dispose(); cv.width = cv.height = 0; } });
    return tex;
  }

  // ---------------------------------------------------------------- 紙卡
  /** 卡片的內容排版與高度（桌面 px）。上緣一行極小的標記，內文、署名；沒有標題列、編號、註腳。 */
  private layoutCard() {
    const c = this.txt.ctx;
    this.cardW = this.cardKind === 'msg' ? CARD.w : this.cardKind === 'credits' ? 440 : 470;
    const inner = this.cardW - 2 * 40;
    if (this.cardKind === 'msg' && this.msg) {
      // 上 40 + 標記 42、下：署名 64 + 36
      const maxBody = CARD.maxH - 40 - 42 - 64 - 36;
      this.cardFit = fitClauses(c, this.msg.text, FAM_MSG, inner, maxBody, { min: 44, max: 96, lineHeight: 1.3, maxLines: 6 });
      this.cardH = 40 + 42 + this.cardFit.height + 64 + 36;
    } else if (this.cardKind === 'credits') {
      this.cardH = 40 + 42 + 3 * 46 + 30;
    } else {
      this.cardH = 40 + 42 + 44 + 22 + 2 * 42 + 34 + 30;
    }
  }

  /**
   * 紙卡上的字畫成一張遮罩（黑底；r = 內文、g = 署名、b = 愛心），shader 在紙上用墨色／點綴色印出來。
   * init 畫一次（有 mipmap 與各向異性過濾：斜看的紙上的字才不會糊或閃）。
   */
  private buildCard(): THREE.CanvasTexture {
    const w = this.cardW, h = this.cardH, pad = 40, LS = CARD_PX * SCALE;
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * LS); cv.height = Math.round(h * LS);
    const c = cv.getContext('2d')!;
    c.scale(LS, LS);
    c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
    c.textBaseline = 'alphabetic';
    const m = this.msg;
    const BODY = 'rgb(255,0,0)', SIG = 'rgb(0,255,0)', HEART = 'rgb(0,0,255)';
    // 極小的標記：像封套背面印的一行字（低對比）
    c.font = font(F.serif(500, true), 21);
    c.fillStyle = 'rgba(255,0,0,0.5)';
    c.fillText(m?.couple ? 'liner notes — from the couple' : 'liner notes', pad, pad + 14);
    const y0 = pad + 42;
    if (this.cardKind === 'msg' && m && this.cardFit) {
      const fit = this.cardFit;
      c.font = font(FAM_MSG, fit.size);
      c.fillStyle = BODY;
      fit.lines.forEach((ln, i) => fillHearts(c, ln, pad, y0 + fit.size * 0.92 + i * fit.lineHeight, fit.size, HEART));
      c.font = font(F.hand(400), 38);
      c.textAlign = 'right';
      c.fillStyle = SIG;
      c.fillText(signature(m.name), w - pad, y0 + fit.height + 54);
      c.textAlign = 'left';
    } else if (this.cardKind === 'credits' && m) {
      const rows: [string, string][] = [['作詞', m.name || '一位賓客'], ['收錄', `《${this.ctx.song.title || '今晚的歌'}》A 面`], ['監製', COUPLE_ZH]];
      rows.forEach(([k, v], i) => {
        const yy = y0 + 30 + i * 46;
        c.font = font(F.hei(500), 17); c.letterSpacing = '6px'; c.fillStyle = 'rgba(255,0,0,0.6)';
        c.fillText(k, pad, yy - 3); c.letterSpacing = '0px';
        const vf = fitText(c, v, F.hand(400), w - 2 * pad - 84, 36, { min: 20, max: 28, maxLines: 1 });
        c.font = font(F.hand(400), vf.size); c.fillStyle = BODY;
        c.fillText(vf.lines[0] ?? v, pad + 84, yy);
      });
    } else {
      // 沒有留言時焦點是歌詞：邀請的字比溝紋上的歌詞小一級
      c.font = font(F.hand(700), 42); c.fillStyle = BODY;
      c.fillText(INVITE[0]!, pad, y0 + 40);
      c.font = font(F.hand(400), 29); c.fillStyle = 'rgba(255,0,0,0.85)';
      c.fillText(INVITE[1]!, pad, y0 + 40 + 22 + 34);
      c.fillText(INVITE[2]!, pad, y0 + 40 + 22 + 76);
      // 指向右下角 QR 的細箭頭
      const ax = w - pad - 30, ay = y0 + 40 + 22 + 88;
      c.strokeStyle = 'rgba(255,0,0,0.7)'; c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(ax + 26, ay + 26); c.moveTo(ax + 26, ay + 26); c.lineTo(ax + 26, ay + 13); c.moveTo(ax + 26, ay + 26); c.lineTo(ax + 13, ay + 26); c.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.NoColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = Math.min(8, this.ctx.renderer.capabilities.getMaxAnisotropy());
    tex.flipY = true;
    this.track({ dispose: () => { tex.dispose(); cv.width = cv.height = 0; } });
    return tex;
  }

  /**
   * 紙卡這一格在桌面上的樣子：切進來的那一拍從右邊滑進來、落到桌上（離桌面的高度收到 0、影子收近）、晃一下停好；
   * 最後半秒滑出去。回傳中心、轉角、高度，與在不在畫面上。
   */
  private cardAt(t: number) {
    const s = this.ctx.start, e = this.ctx.end;
    const c0 = s + 0.04, dt = Math.max(0, t - c0);
    const cin = prog(t, c0, c0 + 0.7, ease.outExpo);
    const cout = prog(t, e - 0.5, e - 0.05, ease.inCubic);
    const settle = dt >= 1.4 ? 1 : 1 - Math.exp(-6 * dt) * Math.cos(9 * dt);
    const slide = Math.min(1, 1 - cin + cout);
    const top = Math.max(CARD.top, CARD.y - this.cardH / 2);
    return {
      x: CARD.x + (CARD.w - this.cardW) / 2 + slide * 820, y: top + this.cardH / 2 - slide * 40,
      rot: lerp(-6, -1.6, clamp(settle, 0, 1.2)) * DEG,
      lift: Math.min(1, (1 - cin) * 1.4 + cout),
      on: slide < 1,
    };
  }

  // ---------------------------------------------------------------- 每一格
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, beat = this.beat;
    // 進場：字幾乎馬上出現（跨過切點還在唱的那一行不能消失），唱片的反光慢一點亮起來
    const inK = prog(t, s, s + 0.35, ease.outCubic), textK = prog(t, s, s + 0.12);
    // 唱臂：一開始懸著，第一拍落下（影子收近）；最後一拍抬起來
    const lift = Math.max(1 - prog(t, s, this.tDrop, ease.inOutCubic), prog(t, e - beat * 0.9, e - beat * 0.1, ease.inOutCubic) * 0.8);
    const down = t >= this.tDrop && lift < 0.2;
    const st = this.stateAt(t);
    const touch = pulse(t, this.tDrop, 0.12);
    this.camAt(t);
    const cam = this.cam;

    // shader：唱片、標籤、刻字、紙卡、唱臂（桌面座標，相機換到螢幕）
    const u = this.bg.u;
    cam.inverse(u.uHinv!.value as THREE.Matrix3);
    cam.depth(u.uDepth!.value as THREE.Vector3);
    // 對焦在唱針（正在唱的字）與紙卡之間：比唱針遠的地方才開始糊
    (u.uFocus!.value as THREE.Vector2).set(cam.mag(st.st.x, st.st.y) - 0.02, 1 / 0.08);
    u.uTh!.value = st.th;
    // 反光扇形：每小節轉四分之一圈（逆時針，跟唱片同向），下拍時剛好有一片掃過正上方的唱針
    u.uFan!.value = -0.5 * Math.PI * f.bar + 0.35;
    u.uFanK!.value = inK * (0.8 + 0.3 * f.a.kick + 0.4 * touch);
    u.uIn!.value = inK;
    u.uHat!.value = f.a.hat;
    (u.uS!.value as THREE.Vector2).set(st.st.x, st.st.y);
    const arm = this.armGeom(st.st);
    (u.uE!.value as THREE.Vector2).set(arm.ex, arm.ey);
    u.uLift!.value = lift;
    u.uLab!.value = this.labelTex;
    u.uTxt!.value = this.drawRing(t, st, textK * (1 - prog(t, e - 0.25, e)));
    const cd = this.cardAt(t);
    u.uCard!.value = this.cardTex;
    (u.uCardG!.value as THREE.Vector4).set(cd.x, cd.y, cd.rot, cd.lift);
    (u.uCardS!.value as THREE.Vector2).set(this.cardW / 2, this.cardH / 2);
    const sigK = this.cardKind === 'msg' ? prog(t, this.tDrop + beat, this.tDrop + beat + 0.4) : 1;
    (u.uCardK!.value as THREE.Vector3).set(1, sigK, cd.on ? 1 : 0);
    this.bg.render(renderer, this.scn);
    this.dof.u.uScn!.value = this.scn.texture;
    this.dof.render(renderer, out);

    // 火花：唱針尖；後面拖著一段剛讀過、還在發燙的溝（桌面上的點換到螢幕）
    this.glow.clear();
    const singing = this.sung.some(([a, b]) => t >= a - 0.02 && t <= b + 0.1);
    const I = (singing ? 1 : 0.55) * (down ? 1 : 0) * (1 + 0.5 * f.a.kick + 1.2 * touch);
    const sp = cam.proj(st.st.x, st.st.y);
    if (I > 0) {
      this.trail(t, st, I);
      const hp = (tb: number) => { if (tb < this.tDrop) return null; const q = this.stateAt(tb).st; return cam.proj(q.x, q.y); };
      // 落針的那一瞬間噴一小把火星，之後唱的時候多、間奏時少
      const rate = (tb: number) => (tb < this.tDrop + 0.08 ? 360 : this.sung.some(([a, b]) => tb >= a && tb <= b) ? 80 : 26);
      sparkParticles(this.glow, t, hp, { rate, rateMax: 360, life: 0.38, speed: 210, seed: 11, intensity: 0.9 });
      sparkHead(this.glow, sp.x, sp.y, t, 1 + 0.3 * touch, I);
    }
    // 落針：一道光從針尖沿著那一圈溝往兩邊跑出去，半秒內散掉
    const rip = prog(t, this.tDrop, this.tDrop + 0.55, ease.outCubic);
    if (rip > 0 && rip < 1) {
      const rs = Math.hypot(st.st.x - C.x, st.st.y - C.y), span = 0.75 * rip, fade = (1 - rip) * 2.2, sg = LIN.signal, n = 30;
      for (const dir of [-1, 1]) {
        let prev = cam.proj(C.x + Math.sin(st.st.a) * rs, C.y - Math.cos(st.st.a) * rs);
        for (let i = 0; i < n; i++) {
          const u1 = (i + 1) / n, a1 = st.st.a + dir * span * u1;
          const q = cam.proj(C.x + Math.sin(a1) * rs, C.y - Math.cos(a1) * rs);
          const k = fade * (0.15 + 0.85 * u1 * u1);
          this.glow.seg2(prev.x, prev.y, q.x, q.y, 1.4, [sg[0] * k, sg[1] * k, sg[2] * k], 1);
          prev = q;
        }
      }
    }
    if (this.glow.count) this.glow.render(renderer, out);

    // 螢幕上的兩小群字（像片頭的小字，不跟著桌面動）
    comp.draw(renderer, this.info.texture, out, { opacity: textK * (1 - prog(t, e - 0.3, e)) * 0.95, ...subRect(INFO_R) });
    const kick = f.a.kick;
    // 每個小節線輕輕推一下鏡頭（很小，像唱盤跟著低音震）
    const db = pulse(t, au.timeOfBar(Math.floor(f.bar)), 0.14);
    return {
      bloom: 0.7, vignette: 0.55, halation: 0.22,
      zoom: 1 + 0.004 * kick + 0.005 * db + 0.008 * touch,
      shake: [2.5 * touch * noise1(t * 40, 1), 2.5 * touch * noise1(t * 43, 2)] as [number, number],
    };
  }

  /** 唱臂：從軸心伸到唱頭座後端（唱頭座往唱片中心偏一點角度，像真的唱臂）。 */
  private armGeom(sp: P2) {
    const ux = PIVOT.x - sp.x, uy = PIVOT.y - sp.y, L = Math.hypot(ux, uy);
    const dx = ux / L, dy = uy / L;
    const off = -22 * DEG, len = 74;
    const hx = dx * Math.cos(off) - dy * Math.sin(off), hy = dx * Math.sin(off) + dy * Math.cos(off);
    return { ex: sp.x + hx * len, ey: sp.y + hy * len };
  }

  /** 剛讀過的溝：唱針尖往回（逆時針方向）一小段弧，越舊越冷。 */
  private trail(t: number, st: ReturnType<Vinyl['stateAt']>, I: number) {
    const n = 40, span = 1.4, sg = LIN.signal, em = LIN.ember, cam = this.cam;
    let prev: P2 | null = null;
    for (let i = 0; i <= n; i++) {
      const tb = t - (span * i) / n;
      if (tb < this.tDrop) break;
      const P = this.head.at(tb);
      const ps = this.psi(P - this.P0);
      const r = this.rAt(ps) + this.sty;
      const a = ps + st.th;
      const p = cam.proj(C.x + Math.sin(a) * r, C.y - Math.cos(a) * r);
      if (prev) {
        const k = Math.exp(-(t - tb) / 0.4) * I;
        this.glow.seg2(prev.x, prev.y, p.x, p.y, 1.5 + 1.2 * k, [lerp(sg[0], em[0], k) * 2.2 * k, lerp(sg[1], em[1], k) * 2.2 * k, lerp(sg[2], em[2], k) * 2.2 * k], 1);
      }
      prev = p;
    }
  }

  /**
   * 把圓環上的字畫進遮罩層（r = 唱過、g = 熱度、b = 愛心、a = 不透明度），回傳貼圖。
   * 只畫正在唱的那一句：下一句在開始前一下子浮出來，唱完的那句轉到左邊、停一下就淡掉。
   */
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
      let lk = 1;
      if (g.ln >= 0) {
        const ln = this.lines[g.ln]!;
        lk = prog(t, ln.start - 0.45, ln.start - 0.1) * (1 - prog(t, ln.end + 1.0, ln.end + 1.7));
        if (lk <= 0.004) continue;
      }
      const sc = g.s + g.w / 2;
      const ps = this.psi(sc - this.P0);
      const r = this.rAt(ps);
      const a = ps + st.th;
      const ad = a / DEG;
      const vis = alpha * lk * g.dim * prog(ad, -VIS.l1, -VIS.l0, ease.inOutQuad) * (1 - prog(ad, VIS.r0, VIS.r1, ease.inOutQuad));
      if (vis <= 0.004) continue;
      const size = g.size;
      if (fkey !== g.fam + size) { fkey = g.fam + size; c.font = font(g.fam, size); }
      const lit = clamp((P - g.s) / g.w);
      const heat = g.dim < 1 ? 0 : lit < 1 ? 1 : Math.exp(-(P - g.s - g.w) / 110);
      const wRef = g.w;
      c.save();
      c.translate(C.x + Math.sin(a) * r, C.y - Math.cos(a) * r);
      c.rotate(a);
      const x0 = -wRef / 2, split = x0 + lit * wRef;
      const unsungA = 0.3 * vis, sungA = vis;
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
        c.fillStyle = `rgb(255,${Math.round(Math.sqrt(heat) * 255)},0)`;
        c.fillText(g.ch, x0, 0);
        c.restore();
      }
      c.restore();
    }
    c.restore();
    return L.upload();
  }

  // ---------------------------------------------------------------- 螢幕上的小字
  /**
   * 整個畫面只有兩小群小字（≤ 16 px、低對比）：左上角是這首歌（標籤上的字在轉、看不清楚），
   * 左下角是一本正經的註腳。init 畫一次、上傳一次。
   */
  private drawInfo() {
    const { song } = this.ctx;
    const L = this.info, c = L.ctx;
    L.clear();
    c.save(); c.translate(-INFO_R.x, -INFO_R.y);
    c.textBaseline = 'alphabetic';
    c.font = font(F.mono(500), 14);
    c.letterSpacing = '3px';
    c.fillStyle = rgba('ash', 0.55);
    let line = `NOW PLAYING   ${song.title || '今晚的歌'}${song.artist ? `  ·  ${song.artist}` : ''}`;
    while (Array.from(line).length > 12 && c.measureText(line).width > 760) line = Array.from(line).slice(0, -2).join('') + '…';
    c.fillText(line, INFO_X, 126);
    c.letterSpacing = '2px';
    c.font = font(F.hei(500), 15);
    c.fillStyle = rgba('ash', 0.45);
    c.fillText(FOOTNOTE, INFO_X, H - 110);
    c.letterSpacing = '0px';
    c.restore();
    L.upload();
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
 * 畫一行字，裡面的 ♥ 換成自己畫的愛心（點綴色；紙卡的遮罩用 b 版）：字型裡的愛心顏色跟著字走，不符合「愛心只用點綴色」。
 * 愛心佔的寬度照字型的 ♥ 量（斷行時就是這樣量的）。
 */
function fillHearts(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, heart?: string) {
  if (!text.includes('♥')) { c.fillText(text, x, y); return; }
  const parts = text.split('♥');
  const hw = c.measureText('♥').width;
  parts.forEach((part, i) => {
    if (part) c.fillText(part, x, y);
    x += c.measureText(part).width;
    if (i < parts.length - 1) { drawHeart(c, x + hw / 2, y - size * 0.34, size * 0.72, heart); x += hw; }
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
