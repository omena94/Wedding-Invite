// 收音機（機器 A，亮版面）：五〇年代的桌上型收音機，畫成紙上的版畫線稿（墨線＋斜線陰影），旁邊斜靠著一張手寫的點歌卡。
// MV 融合原則：一個焦點。
//  - 焦點是那張點歌卡：第一拍從右邊滑進來、靠在收音機上（有影子），主打留言用霞鶩文楷一個詞組一拍「寫」上去（畫面最大的字），
//    最後署名；窗格最後一個小節線蓋上「已播出」的章。
//  - 收音機是配角：上面的調頻刻度窗印著電台名，指針在拍點上一台一台跳（彈簧落定），第三拍對準主打那一台（FM 102.5），
//    「魔眼」對準時收成一條縫；喇叭網（織布）後面透出歌詞（逐字跟唱、唱到的字彈一下，比留言小一級），大鼓一打喇叭把布往外推。
//  - 沒有留言：點歌卡縮成一張小便條（邀請大家掃 QR），歌詞放大成焦點。
//  - 鏡頭整段慢慢推近。
// 這個版面是紙：底色是主題的紙色，線與字是墨色（sepia），指針與正在唱的字是訊號色。
// v2（留言板不能大到突兀、畫面要多一點會動的東西）：
//  - 點歌卡縮成右邊一張小卡（寬 660、高 ≤ 430，跟著字的多寡長高），留言 40～60 px、署名 26～32；
//    喇叭網後面的歌詞 40～52（不比留言大）。收音機（還有它周圍會動的東西）才是畫面的主體。
//  - 多補的動畫：收音機右上角一根伸縮天線，在風裡輕輕晃、大鼓一打彈一下，每一拍天線尖端發出一圈圈電波（小節線那一圈是訊號色）；
//    旁邊一盆線稿的小盆栽，葉子跟著拍子搖；一道窗光很慢地掃過整張紙（光裡有樹影在晃）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, lerp, prog, hash, springStep, TAU } from '../engine/util';
import { fitText, phrases, type FitResult } from '../engine/text';
import { Lyrics } from '../engine/lyrics';
import { beatAfter, barAfter, signature, lyricAt, COUPLE_EN, COUPLE_ZH, fitPx, lyricSubOf, subSizeFor, subGap } from './_motifs';
import { msgMaxFor, lyricV2, sigV2, V2 } from './_v2';
import { fillWithHearts } from '../engine/motifs';
import { layoutWordRows } from './_t7';
import { FRAG_RADIO } from './radio-glsl';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'machine', paper: true, energy: [0, 0.75], bars: [4, 8] };

// ---------------------------------------------------------------- 版面（px，y 往下）
/** v2：收音機整台往下移一點，上面留空間給天線與電波。 */
const DY = 60;
const CAB = { x: 110, y: 150 + DY, w: 900, h: 790 };
const DIAL = { x: 236, y: 188 + DY, w: 648, h: 128 };
/** 刻度：88～108 MHz 排在這一段。 */
const SC = { x0: 266, x1: 790, y: 262 + DY };
const EYE = { x: 842, y: 252 + DY, r: 26 };
const KNOB_L = { x: 172, y: 252 + DY, r: 38 };
const KNOB_R = { x: 948, y: 252 + DY, r: 38 };
const GRILLE = { x: 160, y: 386 + DY, w: 800, h: 504 };
/**
 * 點歌卡（v2）：有留言時寬 660、高照字算（≤ 430），直立靠在收音機右邊、畫面右側中間；
 * 沒有留言時是一張更小的便條（邀請）。高度在 measureCard 裡決定。
 */
const CARD_BIG = { x: 1120, y: 0, w: 660, h: 400 };
const CARD_SMALL = { x: 1150, y: 330, w: 580, h: 210 };
/** 點歌卡的垂直中心。 */
const CARD_CY = 428;
/** 主打那一台的頻率（跟左右兩台各隔 4 MHz 以上，刻度窗上的台名才不會疊在一起）與表頭、喇叭網上印的字。 */
const FEAT = 102.5;
const FEAT_TXT = 'FM 102.5';
/** 點歌卡上：表頭的高度、左右留白、署名那一列的高度。 */
const CARD_TOP = 64, CARD_PAD = 36, CARD_SIG = 58;
/** 天線：根部（收音機右上角）、長度、平常的角度（離垂直往右傾，弧度）。 */
const ANT = { x: CAB.x + CAB.w - 96, y: CAB.y + 8, len: 232, a: 1.1 };
/** 盆栽：盆底中心（跟收音機放在同一張桌上）。 */
const POT = { x: 1215, y: CAB.y + CAB.h + 12 };

const F_LYR = F.archivo(100, 800);
const F_MSG = F.hand(400);
const INVITE = '這一台還在等你點歌：掃描右下角 QR code，把想說的話寄到節目裡。';
const TEXT = `點歌卡已播出點歌台新人台新人點歌現正播放《》伴郎台伴娘台喜宴台同學台${FEAT_TXT}${INVITE}`;

const fx = (f: number) => SC.x0 + ((f - 88) / 20) * (SC.x1 - SC.x0);

const BG = () => new FSPass(FRAG_RADIO, {
  uGrille: { value: new THREE.Vector4(GRILLE.x, GRILLE.y, GRILLE.w, GRILLE.h) }, uText: { value: null },
  uDial: { value: new THREE.Vector4(DIAL.x, DIAL.y, DIAL.w, DIAL.h) },
  uEye: { value: new THREE.Vector4(EYE.x, EYE.y, EYE.r, 0) }, uLevel: { value: 0 }, uPump: { value: 0 }, uT: { value: 0 }, uIn: { value: 1 },
});

interface Station { f: number; name: string; hot: boolean }
interface Hop { t: number; f: number }

export default class Radio extends Scene {
  bg = shared('radio.bg', BG);
  /** 機殼、刻度、旋鈕的座：畫一次。 */
  cab = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 喇叭網後面的歌詞（內容變了才重畫）。 */
  txt = this.track(new Layer2D(GRILLE.w, GRILLE.h, undefined, { fast: true }));
  /** 點歌卡（寫字時才重畫）：圖層比卡片大一圈，放得下轉一點點的卡片與影子。 */
  CARD = { ...CARD_BIG };
  CL = { x: 0, y: 0, w: 1, h: 1 };
  card!: Layer2D;
  lines = this.track(new LineBatch(1600, { screen2D: true, blend: 'normal' }));
  glow = this.track(new LineBatch(64, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  stations: Station[] = [];
  hops: Hop[] = [];
  beat = 0.5;
  tBoot = 0;
  tCard = 0;
  fit: FitResult | null = null;
  chunks: { line: number; from: number; to: number; t: number }[] = [];
  sigT = Infinity;
  stampT = Infinity;
  sigSize = 30;
  private txtKey = '';
  private cardKey = '';

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    this.beat = au.beatPeriod(s + 0.1);
    this.tBoot = beatAfter(au, s + 0.15);
    this.tCard = this.tBoot;
    const m = this.msg;
    this.CARD = { ...(m ? CARD_BIG : CARD_SMALL) };
    this.stations = this.makeStations();
    const inWin = lyrics.lines.filter((l) => l.end > s - 1 && l.start < e + 1);
    await loadText(TEXT + this.stations.map((x) => x.name).join('') + (m ? m.text + m.name + signature(m.name) : '') + inWin.map((l) => l.text).join('') + (song.title ?? '') + COUPLE_ZH);
    // 卡片的大小跟著字（先量字，再開卡片的圖層）
    this.measureCard(m ? m.text : INVITE);
    this.CL = { x: this.CARD.x - 40, y: this.CARD.y - 40, w: this.CARD.w + 80, h: this.CARD.h + 80 };
    this.card = this.track(new Layer2D(this.CL.w, this.CL.h, undefined, { fast: true }));
    this.bg.u.uText!.value = this.txt.texture;

    // 指針：前兩拍一台一台掃過去，第三拍對準主打的那一台（窗格很短就第一拍直接對準）；之後每四小節微調一下
    const bars = au.barAt(e) - au.barAt(s);
    const others = this.stations.filter((x) => !x.hot);
    const f0 = others[Math.floor(hash(this.ctx.params.seed ?? 1, 3) * others.length)]!.f;
    this.hops.push({ t: s - 1, f: f0 });
    const scan = bars >= 3.5 ? 2 : 0;
    for (let k = 0; k < scan; k++) this.hops.push({ t: beatAfter(au, s + 0.15, k), f: others[(Math.floor(hash(this.ctx.params.seed ?? 1, k) * others.length) + k + 1) % others.length]!.f });
    const tTune = beatAfter(au, s + 0.15, scan);
    this.hops.push({ t: tTune, f: FEAT });
    for (let k = 4; ; k += 4) {
      const tb = barAfter(au, tTune + 0.1, k - 1);
      if (tb > e - 1.2) break;
      this.hops.push({ t: tb - this.beat, f: FEAT + (k % 8 ? 0.45 : -0.4) }, { t: tb, f: FEAT });
    }
    // 點歌卡：第一拍滑進來；想說的話從下一拍開始寫；最後一個小節線蓋章
    this.layoutCard(m ? m.text : INVITE);
    const lastBar = au.timeOfBar(Math.floor(au.barAt(e - 0.05)));
    if (m && lastBar > this.sigT + this.beat && bars >= 3.5) this.stampT = lastBar;
    this.drawCabinet();
    this.ctx.renderer.initTexture(this.cab.upload());
  }

  /** 電台：主打留言那一台在 FEAT；其他台是別的賓客（名字＋「台」），不夠就用固定的台。 */
  private makeStations(): Station[] {
    const m = this.msg;
    const others: Msg[] = (this.ctx.params.messages ?? []).filter((x: Msg) => x.name && (!m || x.id !== m.id));
    const fixed = ['伴郎台', '伴娘台', '喜宴台', '同學台'];
    const freqs = [89.9, 93.7, 97.3, 107.1];
    const short = (n: string) => { const cs = Array.from(n.replace(/\s+/g, '')); return (cs.length > 3 ? cs.slice(0, 3).join('') : cs.join('')) + '台'; };
    const out: Station[] = freqs.map((f, i) => ({ f, name: others[i] ? (others[i]!.couple ? '新人台' : short(others[i]!.name)) : fixed[i]!, hot: false }));
    out.push({ f: FEAT, name: m ? (m.couple ? '新人台' : short(m.name || '賓客')) : '點歌台', hot: true });
    return out;
  }

  /** 指針在 t 時的頻率：每一跳在拍點前 0.24 秒起跳，彈簧落在拍點上。 */
  private freqAt(t: number): number {
    let f = this.hops[0]!.f;
    for (let i = 1; i < this.hops.length; i++) {
      const h = this.hops[i]!;
      const t0 = h.t - 0.24;
      if (t < t0) break;
      const x = t - t0;
      f = lerp(f, h.f, x >= 0.9 ? 1 : springStep(x, 3.2, 0.42));
    }
    return f;
  }

  // ---------------------------------------------------------------- 點歌卡
  /**
   * 排點歌卡的字，決定卡片多高（v2：卡片只比字多一點邊距）。有留言：字級照 v2 標準（40～60），最多五行；
   * 沒有留言的小便條：邀請 28～34 px。卡片放在畫面右側、垂直置中在 CARD_CY。
   */
  private measureCard(body: string) {
    const c = document.createElement('canvas').getContext('2d')!;
    const CARD = this.CARD;
    if (this.msg) {
      this.fit = fitText(c, body, F_MSG, CARD.w - 2 * CARD_PAD, V2.boxH - CARD_TOP - CARD_SIG - 30, { min: V2.msgMin, max: msgMaxFor(body), lineHeight: 1.3, maxLines: 5 });
      CARD.h = Math.round(CARD_TOP + this.fit.height + 18 + CARD_SIG + 12);
      this.sigSize = sigV2(this.fit.size);
    } else {
      this.fit = fitText(c, body, F_MSG, CARD.w - 2 * CARD_PAD, CARD.h - CARD_TOP - 24, { min: 28, max: 34, lineHeight: 1.3, maxLines: 3 });
    }
    CARD.y = Math.round(CARD_CY - CARD.h / 2);
  }

  private layoutCard(body: string) {
    const { audio: au } = this.ctx;
    const e = this.ctx.end;
    const ph = phrases(body.replace(/\s+/g, ' '), 6);
    const t0 = beatAfter(au, this.tCard + 0.3);
    const n = ph.length + (this.msg ? 1 : 0);
    let step = n <= 8 ? this.beat : this.beat / 2;
    if (t0 + n * step > e - 0.8) step = Math.max(0.12, (e - 0.8 - t0) / Math.max(1, n));
    const lines = this.fit!.lines.map((l) => Array.from(l));
    let li = 0, ci = 0;
    ph.forEach((p, k) => {
      let left = Array.from(p.replace(/\s/g, '')).length;
      const from = { line: li, ch: ci };
      while (left > 0 && li < lines.length) {
        const ch = lines[li]![ci];
        if (ch === undefined) { li++; ci = 0; continue; }
        ci++;
        if (ch.trim()) left--;
      }
      for (let L = from.line; L <= Math.min(li, lines.length - 1); L++) {
        const a = L === from.line ? from.ch : 0, b = L === li ? ci : lines[L]!.length;
        if (b > a) this.chunks.push({ line: L, from: a, to: b, t: t0 + k * step });
      }
    });
    this.sigT = this.msg ? t0 + ph.length * step : Infinity;
  }

  /** 畫點歌卡（卡片座標：CL 的左上角為原點）。寫字用左到右的遮罩「寫」出來，每個詞組 0.28 秒。 */
  private drawCard(t: number) {
    const fit = this.fit!, CARD = this.CARD, CL = this.CL;
    const WR = 0.28;
    const wp = (t0: number) => clamp((t - t0) / WR);
    const prog0 = this.chunks.map((k) => Math.round(wp(k.t) * 20)).join('');
    const stampK = prog(t, this.stampT, this.stampT + 0.12);
    const key = `${prog0}|${Math.round(wp(this.sigT) * 20)}|${Math.round(stampK * 10)}`;
    if (key === this.cardKey) return;
    this.cardKey = key;
    const L = this.card, c = L.ctx, m = this.msg;
    L.clear();
    c.save();
    // 卡片稍微歪一點，影子落在收音機與紙上
    c.translate(CL.w / 2, CL.h / 2);
    c.rotate(m ? 0.014 : -0.03);
    c.translate(-CARD.w / 2, -CARD.h / 2);
    c.fillStyle = rgba('sepia', 0.2);
    c.filter = 'blur(14px)';
    c.fillRect(14, 20, CARD.w, CARD.h);
    c.filter = 'none';
    c.fillStyle = rgba('bone');
    c.fillRect(0, 0, CARD.w, CARD.h);
    c.strokeStyle = rgba('sepia', 0.25); c.lineWidth = 1;
    c.strokeRect(0.5, 0.5, CARD.w - 1, CARD.h - 1);
    // 表頭：一條訊號色的細線、小小的「點歌卡 · FM 102.5」
    c.fillStyle = rgba('signal', 0.85);
    c.fillRect(0, 46, CARD.w, 2);
    c.textBaseline = 'alphabetic';
    c.font = font(F.hei(500), 18); c.letterSpacing = '5px'; c.fillStyle = rgba('sepia', 0.55);
    c.fillText(`${m?.couple ? '新人點歌' : '點歌卡'}  ·  ${FEAT_TXT}`, CARD_PAD, 32);
    c.letterSpacing = '0px';
    // 橫線（卡片的格線）
    const y0 = CARD_TOP + (m ? 0 : Math.max(0, (CARD.h - CARD_TOP - 16 - fit.height) / 2)) + fit.size * 0.92;
    c.fillStyle = rgba('sepia', 0.1);
    for (let i = 0; i < fit.lines.length; i++) c.fillRect(CARD_PAD - 6, y0 + i * fit.lineHeight + fit.size * 0.18, CARD.w - 2 * CARD_PAD + 12, 1);
    // 留言：一個詞組一個詞組「寫」上去
    c.font = font(F_MSG, fit.size);
    c.fillStyle = m ? rgba('sepia') : rgba('sepia', 0.72);
    const lines = fit.lines.map((l) => Array.from(l));
    const x0 = CARD_PAD;
    for (const k of this.chunks) {
      const r = wp(k.t);
      if (r <= 0) continue;
      const arr = lines[k.line]!;
      const pre = arr.slice(0, k.from).join(''), part = arr.slice(k.from, k.to).join('');
      const x = x0 + c.measureText(pre).width, y = y0 + k.line * fit.lineHeight, w = c.measureText(part).width;
      c.save();
      c.beginPath(); c.rect(x - 4, y - fit.size * 1.1, (w + 8) * r, fit.size * 1.5); c.clip();
      fillWithHearts(c, part, x, y, rgba('rose'));
      c.restore();
    }
    // 署名
    if (m && t >= this.sigT) {
      const r = wp(this.sigT);
      c.font = font(F.hand(700), this.sigSize);
      c.textAlign = 'right';
      const sg = signature(m.couple ? COUPLE_ZH : m.name), w = c.measureText(sg).width;
      const sy = CARD.h - 22;
      c.save(); c.beginPath(); c.rect(CARD.w - CARD_PAD - w - 4, sy - this.sigSize * 1.2, (w + 8) * r, this.sigSize * 1.6); c.clip();
      c.fillText(sg, CARD.w - CARD_PAD, sy);
      c.restore();
      c.textAlign = 'left';
    }
    // 已播出的章（訊號色，歪的，蓋下去那一下比較大）
    if (stampK > 0) {
      c.save();
      c.translate(CARD_PAD + 64, CARD.h - 46);
      c.rotate(-0.22);
      const sc = (1.25 - 0.25 * stampK) * 0.76;
      c.scale(sc, sc);
      c.globalAlpha = 0.8 * stampK;
      c.strokeStyle = rgba('signal'); c.lineWidth = 4;
      c.beginPath(); c.arc(0, 0, 50, 0, TAU); c.stroke();
      c.lineWidth = 1.5; c.beginPath(); c.arc(0, 0, 42, 0, TAU); c.stroke();
      c.fillStyle = rgba('signal');
      c.font = font(F.hei(900), 24); c.textAlign = 'center';
      c.fillText('已播出', 0, 9);
      c.restore();
    }
    c.restore();
    L.upload();
  }

  // ---------------------------------------------------------------- 機殼（畫一次）
  private drawCabinet() {
    const L = this.cab, c = L.ctx;
    L.clear();
    const ink = (a = 1) => rgba('sepia', a);
    const rr = (x: number, y: number, w: number, h: number, rt: number, rb = rt) => {
      c.beginPath();
      c.moveTo(x + rt, y); c.lineTo(x + w - rt, y); c.quadraticCurveTo(x + w, y, x + w, y + rt);
      c.lineTo(x + w, y + h - rb); c.quadraticCurveTo(x + w, y + h, x + w - rb, y + h);
      c.lineTo(x + rb, y + h); c.quadraticCurveTo(x, y + h, x, y + h - rb);
      c.lineTo(x, y + rt); c.quadraticCurveTo(x, y, x + rt, y);
      c.closePath();
    };
    // 影子
    c.save();
    c.filter = 'blur(26px)';
    c.fillStyle = ink(0.22);
    rr(CAB.x + 18, CAB.y + 26, CAB.w, CAB.h, 70, 26); c.fill();
    c.restore();
    // 機殼：比紙深一點點的面，右邊與下緣用斜線雕出陰影
    rr(CAB.x, CAB.y, CAB.w, CAB.h, 70, 26);
    c.fillStyle = rgba('paper'); c.fill();
    c.fillStyle = ink(0.05); c.fill();
    c.save();
    rr(CAB.x, CAB.y, CAB.w, CAB.h, 70, 26); c.clip();
    c.strokeStyle = ink(0.28); c.lineWidth = 1.1;
    for (let k = -CAB.h; k < CAB.w + CAB.h; k += 7) {
      // 右邊一條、下面一條陰影帶（離邊越近線越密越粗）
      c.beginPath(); c.moveTo(CAB.x + k, CAB.y + CAB.h); c.lineTo(CAB.x + k + CAB.h * 0.5, CAB.y); c.stroke();
    }
    c.globalCompositeOperation = 'destination-in';
    const g = c.createLinearGradient(CAB.x + CAB.w - 70, 0, CAB.x + CAB.w, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
    const g2 = c.createLinearGradient(0, CAB.y + CAB.h - 40, 0, CAB.y + CAB.h);
    g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(1, 'rgba(0,0,0,1)');
    c.fillStyle = g; c.fillRect(CAB.x, CAB.y, CAB.w, CAB.h - 40);
    c.globalCompositeOperation = 'source-over';
    c.restore();
    c.save();
    rr(CAB.x, CAB.y, CAB.w, CAB.h, 70, 26); c.clip();
    c.strokeStyle = ink(0.3); c.lineWidth = 1;
    for (let x = CAB.x - 60; x < CAB.x + CAB.w; x += 7) { c.beginPath(); c.moveTo(x, CAB.y + CAB.h); c.lineTo(x + 40, CAB.y + CAB.h - 38); c.stroke(); }
    c.restore();
    // 外框：粗線＋內一圈細線
    c.strokeStyle = ink(0.95); c.lineWidth = 2.6;
    rr(CAB.x, CAB.y, CAB.w, CAB.h, 70, 26); c.stroke();
    c.strokeStyle = ink(0.5); c.lineWidth = 1;
    rr(CAB.x + 12, CAB.y + 12, CAB.w - 24, CAB.h - 24, 60, 18); c.stroke();
    // 桌面：一條淡淡的線（收音機與盆栽擺在同一張桌上）
    c.fillStyle = ink(0.2);
    c.fillRect(40, CAB.y + CAB.h + 16, 1320, 1.4);
    // 腳
    c.fillStyle = ink(0.85);
    for (const x of [CAB.x + 110, CAB.x + CAB.w - 170]) { rr(x, CAB.y + CAB.h - 2, 60, 18, 3, 8); c.fill(); }

    // 刻度窗的框
    c.strokeStyle = ink(0.9); c.lineWidth = 2.2;
    rr(DIAL.x, DIAL.y, DIAL.w, DIAL.h, 12); c.stroke();
    c.strokeStyle = ink(0.4); c.lineWidth = 1;
    rr(DIAL.x - 8, DIAL.y - 8, DIAL.w + 16, DIAL.h + 16, 18); c.stroke();
    // 刻度：每 0.5 MHz 一小格，每 2 MHz 一大格與數字
    c.fillStyle = ink(0.85);
    for (let f = 88; f <= 108.001; f += 0.5) {
      const x = fx(f), big = Math.abs(f / 2 - Math.round(f / 2)) < 1e-6;
      c.fillRect(x - (big ? 1 : 0.5), SC.y - (big ? 18 : 9), big ? 2 : 1, big ? 18 : 9);
    }
    c.fillRect(SC.x0, SC.y, SC.x1 - SC.x0, 1.5);
    c.font = font(F.mono(500), 17); c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillStyle = ink(0.7);
    for (let f = 88; f <= 108; f += 4) c.fillText(String(f), fx(f), SC.y + 28);
    // 電台名（主打那一台粗一點）
    c.textAlign = 'center';
    for (const st of this.stations) {
      c.font = font(F.hei(st.hot ? 900 : 500), st.hot ? 20 : 17);
      c.fillStyle = ink(st.hot ? 0.95 : 0.55);
      c.fillText(st.name, fx(st.f), SC.y - 34);
      c.fillRect(fx(st.f) - 0.5, SC.y - 28, 1, 6);
    }
    c.textAlign = 'left';
    // 旋鈕的座（滾花）
    for (const k of [KNOB_L, KNOB_R]) {
      c.beginPath(); c.arc(k.x, k.y, k.r + 8, 0, TAU); c.strokeStyle = ink(0.5); c.lineWidth = 1; c.stroke();
      c.beginPath(); c.arc(k.x, k.y, k.r, 0, TAU); c.fillStyle = rgba('paper'); c.fill(); c.strokeStyle = ink(0.95); c.lineWidth = 2.2; c.stroke();
      c.strokeStyle = ink(0.35); c.lineWidth = 1;
      for (let a = 0; a < TAU; a += TAU / 48) { c.beginPath(); c.moveTo(k.x + Math.cos(a) * (k.r - 7), k.y + Math.sin(a) * (k.r - 7)); c.lineTo(k.x + Math.cos(a) * k.r, k.y + Math.sin(a) * k.r); c.stroke(); }
    }
    // 魔眼的框
    c.beginPath(); c.arc(EYE.x, EYE.y, EYE.r + 6, 0, TAU); c.strokeStyle = ink(0.9); c.lineWidth = 2; c.stroke();
    // 廠牌：刻度窗與喇叭之間，一行斜體
    // 廠牌是新人的名字（執行時才知道；沒有英文名時是中文，Canvas 的字族接了中文備援）：太長就縮到刻度窗的寬度以內
    const brandPx = fitPx(COUPLE_EN, F.serif(600, true), 26, DIAL.w - 40, 1);
    c.font = font(F.serif(600, true), brandPx); c.letterSpacing = `${brandPx / 26}px`; c.fillStyle = ink(0.75); c.textAlign = 'center';
    c.fillText(COUPLE_EN, CAB.x + CAB.w / 2, 360 + DY);
    c.textAlign = 'left';
    c.letterSpacing = '0px';
    // 喇叭網的框：外一圈粗線、內一圈細線、上緣一點斜線陰影
    c.strokeStyle = ink(0.95); c.lineWidth = 2.4;
    rr(GRILLE.x, GRILLE.y, GRILLE.w, GRILLE.h, 22); c.stroke();
    c.strokeStyle = ink(0.45); c.lineWidth = 1;
    rr(GRILLE.x - 10, GRILLE.y - 10, GRILLE.w + 20, GRILLE.h + 20, 30); c.stroke();
  }

  // ---------------------------------------------------------------- 喇叭網後面的歌詞
  private drawText(t: number) {
    const { lyrics, song } = this.ctx;
    const ly = lyricAt(lyrics, t);
    const c = this.txt.ctx;
    const PAD = 44;
    const big = !this.msg;
    if (!ly) {
      const key = 'idle';
      if (key === this.txtKey) return;
      this.txtKey = key;
      this.txt.clear();
      c.textAlign = 'center'; c.textBaseline = 'alphabetic';
      c.font = font(F.archivo(100, 800), 44); c.fillStyle = rgba('bone', 0.36);
      c.fillText(FEAT_TXT, GRILLE.w / 2, GRILLE.h / 2 - 10);
      c.font = font(F.hei(700), 24); c.fillStyle = rgba('bone', 0.3);
      c.fillText(`現正播放《${song.title || '今晚的歌'}》`, GRILLE.w / 2, GRILLE.h / 2 + 46);
      c.textAlign = 'left';
      this.txt.upload();
      return;
    }
    // 有留言時歌詞是第二順位（比留言小一級）；沒有留言時歌詞是焦點
    // v2：歌詞 40～52 px，有留言時不比留言大
    const top = lyricV2(this.msg && this.fit ? this.fit.size : null);
    // 原文副行（韓文歌）：喇叭網裡替原文留兩列小字的高度，中文照舊找最大字級；兩組合起來在網子裡垂直置中
    const sub = lyricSubOf(ly.line);
    const iw = GRILLE.w - PAD * 2, ih = GRILLE.h - PAD * 2;
    const reserve = sub ? subGap(top) + subSizeFor(top) * 1.16 : 0;
    const lay = layoutWordRows(c, ly.line, F_LYR, iw, ih - reserve, big ? { min: 44, max: top, maxRows: 3, lh: 1.16 } : { min: V2.lyrMin, max: top, maxRows: 3, lh: 1.16 });
    const sl = sub ? layoutWordRows(c, sub, F_LYR, iw, subSizeFor(top) * 2.4, { min: 26, max: subSizeFor(lay.size), maxRows: 2, lh: 1.16 }) : null;
    let dyMain = 0, dySub = 0;
    if (sl) {
      const gap = subGap(lay.size, sl.size);
      const total = lay.height + gap + (sl.rows.length - 1) * sl.lineH;
      const y1 = (ih - total) / 2 + lay.size * 0.86; // 中文第一列的基線
      dyMain = y1 - lay.rows[0]!.y;
      dySub = y1 + (lay.rows.length - 1) * lay.lineH + gap - sl.rows[0]!.y;
    }
    // 內容：每個字的狀態＋正在唱的字彈到哪（量化，一樣就不重畫）
    const pops = lay.words.map((b) => {
      const p = Lyrics.wordProgress(b.word, t);
      const pop = t >= b.word.start ? Math.exp(-(t - b.word.start) / 0.11) : 0;
      return `${p <= 0 ? 0 : p < 1 ? 1 : 2}${Math.round(pop * 10)}`;
    }).join('');
    const subKey = sl ? sl.words.map((b) => (Lyrics.wordProgress(b.word, t) > 0 ? 1 : 0)).join('') : '';
    const key = `${ly.line.i}|${Math.round(ly.k * 20)}|${pops}|${subKey}`;
    if (key === this.txtKey) return;
    this.txtKey = key;
    this.txt.clear();
    c.save();
    c.translate(PAD, PAD);
    c.globalAlpha = ly.k;
    c.font = font(F_LYR, lay.size);
    c.textBaseline = 'alphabetic';
    for (const b of lay.words) {
      const p = Lyrics.wordProgress(b.word, t);
      const pop = t >= b.word.start ? Math.exp(-(t - b.word.start) / 0.11) : 0;
      c.save();
      const s = 1 + 0.16 * pop;
      c.translate(b.x + b.w / 2, b.y + dyMain - lay.size * 0.35);
      c.scale(s, s);
      c.translate(-b.w / 2, lay.size * 0.35);
      c.fillStyle = b.word.w === '♥' ? rgba('rose') : p <= 0 ? rgba('bone', 0.26) : p < 1 ? rgba('signal') : rgba('bone', 0.96);
      c.fillText(b.word.w, 0, 0);
      c.restore();
    }
    if (sl) {
      // 原文比中文安靜：不彈、不用訊號色，唱到、唱完都是紙白淡兩成
      c.font = font(F_LYR, sl.size);
      for (const b of sl.words) {
        c.fillStyle = Lyrics.wordProgress(b.word, t) > 0 ? rgba('bone', 0.96 * 0.8) : rgba('bone', 0.26);
        c.fillText(b.word.w, b.x, b.y + dySub);
      }
    }
    c.restore();
    this.txt.upload();
  }

  // ---------------------------------------------------------------- 天線、電波、盆栽（v2 多補的動畫，細線畫在 LineBatch）
  /** 天線的角度（離垂直往右傾）：風裡很慢地晃，大鼓一打往後彈一下。 */
  private antAngle(t: number) {
    return ANT.a + 0.03 * Math.sin(t * 0.8) + 0.012 * Math.sin(t * 2.1 + 1) - 0.05 * this.ctx.audio.hit('kick', t, 0.16);
  }

  /**
   * 伸縮天線（三節，越往上越細、頂端一顆小球）＋電波：每一拍從天線尖端發出一圈弧線往外擴散、變淡，
   * 小節線那一圈是訊號色（「正在播出」）。弧線朝天線指的方向張開，不會畫進收音機裡。
   */
  private drawAntenna(f: Frame) {
    const t = f.t, au = this.ctx.audio, Lb = this.lines;
    const a = this.antAngle(t), dx = Math.sin(a), dy = -Math.cos(a), len = ANT.len;
    const ink = LIN.sepia, hi = LIN.paper;
    const at = (u: number) => ({ x: ANT.x + dx * len * u, y: ANT.y + dy * len * u });
    // 底座的鉸鏈
    for (let q = 0; q < 16; q++) {
      const a0 = (q / 16) * TAU, a1 = ((q + 1) / 16) * TAU;
      Lb.seg2(ANT.x + Math.cos(a0) * 10, ANT.y + Math.sin(a0) * 10, ANT.x + Math.cos(a1) * 10, ANT.y + Math.sin(a1) * 10, 2, ink, 0.9);
    }
    for (const [u0, u1, w] of [[0, 0.44, 6.5], [0.42, 0.76, 4.6], [0.74, 1, 3.2]] as const) {
      const p = at(u0), q = at(u1);
      Lb.seg2(p.x, p.y, q.x, q.y, w, ink, 0.95);
      Lb.seg2(p.x - dy * w * 0.12, p.y + dx * w * 0.12, q.x - dy * w * 0.12, q.y + dx * w * 0.12, w * 0.26, hi, 0.75);
      // 套管的接頭：一小段粗一點的環
      const j = at(u1 - 0.02);
      Lb.seg2(j.x - dy * (w + 2), j.y + dx * (w + 2), j.x + dy * (w + 2), j.y - dx * (w + 2), 3, ink, 0.9);
    }
    const tip = at(1);
    Lb.seg2(tip.x, tip.y, tip.x + 0.01, tip.y, 12, ink, 0.95);
    Lb.seg2(tip.x - 2, tip.y - 2, tip.x - 1.99, tip.y - 2, 3.5, hi, 0.8);
    // 電波：最近三拍各一圈
    const dir = Math.atan2(dy, dx), beat = this.beat;
    const bi = Math.floor(au.beatAt(t) + 1e-4);
    for (let k = 0; k < 3; k++) {
      const tb = au.timeOfBeat(bi - k), u = (t - tb) / (2.2 * beat);
      if (u < 0 || u > 1) continue;
      const down = Math.abs(au.barAt(tb) - Math.round(au.barAt(tb))) < 0.02;
      const r = 18 + 165 * ease.outCubic(u), al = 0.75 * (1 - u) ** 1.4;
      const col = down ? LIN.signal : ink, spread = 0.8;
      for (let q = 0; q < 16; q++) {
        const a0 = dir - spread + (2 * spread * q) / 16, a1 = dir - spread + (2 * spread * (q + 1)) / 16;
        Lb.seg2(tip.x + Math.cos(a0) * r, tip.y + Math.sin(a0) * r, tip.x + Math.cos(a1) * r, tip.y + Math.sin(a1) * r, down ? 2.6 : 1.8, col, al);
      }
    }
  }

  /**
   * 盆栽：線稿的陶盆（右半邊斜線陰影）＋六根莖、每根兩片葉子。整盆在風裡慢慢晃，大鼓一打葉子一左一右抖一下。
   * 都是細線（LineBatch），不佔圖層。
   */
  private drawPlant(f: Frame) {
    const t = f.t, Lb = this.lines, ink = LIN.sepia;
    const { x, y } = POT;
    const top = y - 104, wT = 64, wB = 48;
    const poly = (pts: [number, number][], w: number, al: number, close = false) => {
      for (let i = 1; i < pts.length + (close ? 1 : 0); i++) {
        const p = pts[i - 1]!, q = pts[i % pts.length]!;
        Lb.seg2(p[0], p[1], q[0], q[1], w, ink, al);
      }
    };
    // 陶盆：盆身、盆緣、右邊一片斜線陰影
    poly([[x - wT, top], [x + wT, top], [x + wB, y], [x - wB, y]], 2.2, 0.9, true);
    poly([[x - wT - 7, top - 18], [x + wT + 7, top - 18], [x + wT + 7, top], [x - wT - 7, top]], 2, 0.9, true);
    for (let k = 0; k < 7; k++) {
      const yy = top + 12 + k * 13, xr = x + wT - (wT - wB) * ((yy - top) / (y - top));
      Lb.seg2(xr - 26, yy + 8, xr - 4, yy - 4, 1.1, ink, 0.45);
    }
    // 莖與葉
    const au = this.ctx.audio;
    const sway = 0.05 * Math.sin(t * 1.05) + 0.025 * Math.sin(t * 2.3 + 1);
    const kick = au.hit('kick', t, 0.2);
    const base = { x, y: top - 18 };
    const stems = [[-0.62, 128], [-0.34, 180], [-0.1, 212], [0.12, 198], [0.36, 166], [0.62, 124]] as const;
    stems.forEach(([a0, len], i) => {
      const a = a0 + sway * (0.6 + 0.4 * (len / 250)) + kick * 0.035 * (i % 2 ? 1 : -1);
      const bend = 0.38 * Math.sign(a0 || 0.1);
      const pt = (u: number) => {
        // 莖往外彎：角度隨高度加大
        let px = base.x + (i - 2.5) * 5, py = base.y;
        const N = 8;
        for (let j = 0; j < Math.round(u * N); j++) {
          const aa = a + bend * (j / N);
          px += Math.sin(aa) * (len / N); py -= Math.cos(aa) * (len / N);
        }
        return { x: px, y: py, a: a + bend * u };
      };
      let prev = pt(0);
      for (let j = 1; j <= 8; j++) { const q = pt(j / 8); Lb.seg2(prev.x, prev.y, q.x, q.y, 1.8, ink, 0.85); prev = q; }
      const leaf = (u: number, side: number, L0: number) => {
        const p = pt(u);
        const la = p.a + side * 0.75 + 0.08 * Math.sin(t * 1.7 + i * 1.3 + side) + kick * 0.08 * side;
        const ux = Math.sin(la), uy = -Math.cos(la), nx = -uy, ny = ux;
        const L: [number, number][] = [], R: [number, number][] = [];
        for (let k = 0; k <= 8; k++) {
          const v = k / 8, w = Math.sin(Math.PI * v) * L0 * 0.24;
          L.push([p.x + ux * L0 * v + nx * w, p.y + uy * L0 * v + ny * w]);
          R.push([p.x + ux * L0 * v - nx * w, p.y + uy * L0 * v - ny * w]);
        }
        poly(L, 1.6, 0.85); poly(R, 1.6, 0.85);
        Lb.seg2(p.x, p.y, p.x + ux * L0 * 0.85, p.y + uy * L0 * 0.85, 1, ink, 0.5);
      };
      leaf(0.55, i % 2 ? 1 : -1, 46);
      leaf(1, 0, 58);
    });
  }

  // ---------------------------------------------------------------- 每一格
  private blit(tex: THREE.Texture, x: number, y: number, w: number, h: number, out: THREE.WebGLRenderTarget, opacity = 1) {
    this.ctx.comp.draw(this.ctx.renderer, tex, out, { opacity, scale: [W / w, H / h], offset: [0.5 * W / w - 0.5 - x / w, 0.5 + y / h - 0.5 * H / h] });
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const kIn = prog(t, s, s + 0.35, ease.outCubic);
    const fq = this.freqAt(t);
    const tuned = 1 - clamp(Math.abs(fq - FEAT) / 1.1);
    const u = this.bg.u;
    (u.uEye!.value as THREE.Vector4).w = tuned;
    u.uLevel!.value = f.a.rms;
    u.uPump!.value = f.a.kick;
    u.uT!.value = t;
    u.uIn!.value = kIn;
    this.drawText(t);
    this.bg.render(renderer, out);
    comp.draw(renderer, this.cab.texture, out);

    // 指針（訊號色，淡淡的光）與兩個旋鈕的指示線
    this.lines.clear(); this.glow.clear();
    const x = fx(fq);
    this.lines.seg2(x, DIAL.y + 18, x, DIAL.y + DIAL.h - 16, 3.2, [LIN.signal[0] * 1.05, LIN.signal[1] * 1.05, LIN.signal[2] * 1.05], 1);
    this.glow.seg2(x, DIAL.y + 20, x, DIAL.y + DIAL.h - 18, 14, [LIN.signal[0] * 0.12, LIN.signal[1] * 0.12, LIN.signal[2] * 0.12], 1);
    const knob = (k: typeof KNOB_L, a: number) => {
      const ca = Math.cos(a), sa = Math.sin(a);
      this.lines.seg2(k.x + ca * 10, k.y + sa * 10, k.x + ca * (k.r - 12), k.y + sa * (k.r - 12), 3, LIN.sepia, 1);
    };
    knob(KNOB_R, -Math.PI / 2 + (fq - 98) * 0.42);
    knob(KNOB_L, -Math.PI / 2 - 0.9 + 1.4 * clamp(0.3 + f.a.rms));
    this.drawAntenna(f);
    this.drawPlant(f);
    this.lines.render(renderer, out);
    this.glow.render(renderer, out);

    // 點歌卡：第一拍從右邊滑進來（最後一點點用彈簧落定）
    this.drawCard(t);
    const slide = 1 - ease.outExpo(prog(t, this.tCard - 0.28, this.tCard + 0.35));
    this.blit(this.card.texture, this.CL.x + slide * 1000, this.CL.y, this.CL.w, this.CL.h, out);
    // 鏡頭：整段慢慢推近
    return { paper: 1, bloom: 0.45, vignette: 0.32, halation: 0.12, grain: 0.05, zoom: 1 + 0.03 * ease.inOutCubic(f.p) };
  }
}


