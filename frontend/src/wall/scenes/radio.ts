// 收音機（機器 A，亮版面）：五〇年代的桌上型收音機正面，畫成紙上的版畫線稿（墨線＋斜線陰影）。
//  - 上面是調頻刻度窗：FM 88～108，刻度上印著電台名（其他賓客的名字＋「台」），主打留言是「FM 103.13」那一台。
//    指針在拍點上一台一台跳（彈簧落定），第三拍對準主打那一台；刻度窗右邊的「魔眼」（調諧指示）對準時收成一條縫。
//    之後每四小節微調一下。兩個旋鈕跟著指針轉。
//  - 左下是喇叭網（織布，shader 畫的）：歌詞從布後面透出來（逐字跟唱、唱到的字彈一下），大鼓一打，喇叭把布往外推。
//  - 右下是一張「點歌卡」：第一拍滑進來，點播人是留言的名字，想說的話（主打留言，霞鶩文楷）一個詞組一拍寫上去，最後署名；
//    窗格最後一個小節線蓋上「已播出」的章。沒有留言時是一張空白的點歌卡，邀請大家掃 QR。
// 這個版面是紙：底色是主題的紙色，線與字是墨色（sepia），指針與正在唱的字是訊號色。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, lerp, prog, hash, springStep, TAU } from '../engine/util';
import { fitText, phrases, type FitResult } from '../engine/text';
import { Lyrics } from '../engine/lyrics';
import { beatAfter, barAfter, signature, lyricAt, COUPLE_EN, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { fillWithHearts } from '../engine/motifs';
import { layoutWordRows } from './_t7';
import { FRAG_RADIO } from './radio-glsl';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: true, energy: [0, 0.75], bars: [4, 8] };

// ---------------------------------------------------------------- 版面（px，y 往下）
const CAB = { x: 118, y: 108, w: 1226, h: 852 };
const DIAL = { x: 290, y: 150, w: 880, h: 150 };
/** 刻度：88～108 MHz 排在這一段。 */
const SC = { x0: 330, x1: 1060, y: 232 };
const EYE = { x: 1112, y: 224, r: 30 };
const KNOB_L = { x: 206, y: 225, r: 46 };
const KNOB_R = { x: 1256, y: 225, r: 46 };
const GRILLE = { x: 168, y: 350, w: 574, h: 572 };
const CARD = { x: 784, y: 344, w: 530, h: 580 };
/** 點歌卡的圖層（比卡片大一圈，放得下轉一點點的卡片與影子）。 */
const CL = { x: CARD.x - 30, y: CARD.y - 30, w: CARD.w + 60, h: CARD.h + 60 };
const FEAT = 103.13;

const F_LYR = F.archivo(100, 800);
const F_MSG = F.hand(400);
const INVITE = '這一台還在等你的點播。掃描右下角 QR code，把想說的話寄到節目裡。';
const TEXT = `點歌卡點播人想說的話頻道已播出心頻調頻婚禮點歌台新人台（你的名字）新人想說的話現正播放《》伴郎台伴娘台芃芃台喜宴台同學台${INVITE}`;

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
  /** 點歌卡（寫字時才重畫）。 */
  card = this.track(new Layer2D(CL.w, CL.h, undefined, { fast: true }));
  lines = this.track(new LineBatch(256, { screen2D: true, blend: 'normal' }));
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
  avoid: [number, number, number, number][] = [];
  private txtKey = '';
  private cardKey = '';

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    this.beat = au.beatPeriod(s + 0.1);
    this.tBoot = beatAfter(au, s + 0.15);
    this.tCard = this.tBoot;
    const m = this.msg;
    this.stations = this.makeStations();
    const inWin = lyrics.lines.filter((l) => l.end > s - 1 && l.start < e + 1);
    await loadText(TEXT + this.stations.map((x) => x.name).join('') + (m ? m.text + m.name + signature(m.name) : '') + inWin.map((l) => l.text).join('') + (song.title ?? '') + COUPLE_ZH);
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
    this.avoid = [
      [GRILLE.x - 10, GRILLE.y - 10, GRILLE.w + 20, GRILLE.h + 20],
      [CARD.x - 16, CARD.y - 16, CARD.w + 32, CARD.h + 32],
      [DIAL.x, DIAL.y, DIAL.w, DIAL.h],
    ];
  }

  /** 電台：主打留言那一台在 103.13；其他台是別的賓客（名字＋「台」），不夠就用固定的台。 */
  private makeStations(): Station[] {
    const m = this.msg;
    const others: Msg[] = (this.ctx.params.messages ?? []).filter((x: Msg) => x.name && (!m || x.id !== m.id));
    const fixed = ['伴郎台', '伴娘台', '芃芃台', '喜宴台', '同學台', 'QQ台'];
    const freqs = [89.1, 91.9, 94.7, 97.5, 100.1, 106.5];
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
  private layoutCard(body: string) {
    const { audio: au } = this.ctx;
    const e = this.ctx.end;
    const c = this.card.ctx;
    // 想說的話的框：「想說的話」標籤下面到署名上面
    this.fit = fitText(c, body, F_MSG, CARD.w - 90, CARD.h - 196 - 96, { min: 44, max: 60, lineHeight: 1.24, maxLines: 7 });
    const ph = phrases(body.replace(/\s+/g, ' '), 6);
    const t0 = beatAfter(au, this.tCard + 0.3);
    const n = ph.length + (this.msg ? 1 : 0);
    let step = n <= 8 ? this.beat : this.beat / 2;
    if (t0 + n * step > e - 0.8) step = Math.max(0.12, (e - 0.8 - t0) / Math.max(1, n));
    const lines = this.fit.lines.map((l) => Array.from(l));
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
    const fit = this.fit!;
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
    // 卡片稍微歪一點，影子落在機殼上
    c.translate(CL.w / 2, CL.h / 2);
    c.rotate(-0.018);
    c.translate(-CARD.w / 2, -CARD.h / 2);
    c.fillStyle = rgba('sepia', 0.16);
    c.filter = 'blur(10px)';
    c.fillRect(10, 14, CARD.w, CARD.h);
    c.filter = 'none';
    c.fillStyle = rgba('bone');
    c.fillRect(0, 0, CARD.w, CARD.h);
    c.strokeStyle = rgba('sepia', 0.35); c.lineWidth = 1;
    c.strokeRect(0.5, 0.5, CARD.w - 1, CARD.h - 1);
    // 表頭：訊號色的一條線、「點歌卡」、編號
    c.fillStyle = rgba('signal', 0.9);
    c.fillRect(0, 74, CARD.w, 2.5);
    c.textBaseline = 'alphabetic';
    c.fillStyle = rgba('sepia');
    c.font = font(F.hei(900), 34);
    c.fillText('點歌卡', 34, 54);
    c.font = font(F.mono(500), 14); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.7);
    c.fillText('REQUEST · FM 103.13', 166, 52);
    c.textAlign = 'right';
    c.fillText(m ? `No.${String(m.n).padStart(3, '0')}` : 'No.———', CARD.w - 30, 52);
    c.textAlign = 'left';
    c.letterSpacing = '0px';
    // 點播人
    c.font = font(F.hei(500), 17); c.fillStyle = rgba('sepia', 0.65);
    c.fillText('點播人', 34, 124);
    c.font = font(F.hand(700), 38); c.fillStyle = rgba('sepia');
    c.fillText(m ? (m.couple ? COUPLE_ZH : m.name || '一位賓客') : '（你的名字）', 108, 126);
    c.fillStyle = rgba('sepia', 0.25);
    c.fillRect(104, 134, CARD.w - 138, 1);
    c.font = font(F.hei(500), 17); c.fillStyle = rgba('sepia', 0.65);
    c.fillText(m?.couple ? '新人想說的話' : '想說的話', 34, 176);
    // 橫線（卡片的格線）
    const y0 = 196 + fit.size;
    c.fillStyle = rgba('sepia', 0.14);
    for (let i = 0; i < 7; i++) c.fillRect(34, y0 + i * fit.lineHeight + 10, CARD.w - 68, 1);
    // 想說的話：一個詞組一個詞組「寫」上去
    c.font = font(F_MSG, fit.size);
    c.fillStyle = m ? rgba('sepia') : rgba('sepia', 0.6);
    const lines = fit.lines.map((l) => Array.from(l));
    for (const k of this.chunks) {
      const r = wp(k.t);
      if (r <= 0) continue;
      const arr = lines[k.line]!;
      const pre = arr.slice(0, k.from).join(''), part = arr.slice(k.from, k.to).join('');
      const x = 38 + c.measureText(pre).width, y = y0 + k.line * fit.lineHeight, w = c.measureText(part).width;
      c.save();
      c.beginPath(); c.rect(x - 4, y - fit.size * 1.1, (w + 8) * r, fit.size * 1.5); c.clip();
      fillWithHearts(c, part, x, y, rgba('rose'));
      c.restore();
    }
    // 署名
    if (m && t >= this.sigT) {
      const r = wp(this.sigT);
      c.font = font(F.hand(700), 40);
      c.textAlign = 'right';
      const sg = signature(m.name), w = c.measureText(sg).width;
      c.save(); c.beginPath(); c.rect(CARD.w - 34 - w - 4, CARD.h - 84, (w + 8) * r, 70); c.clip();
      c.fillText(sg, CARD.w - 34, CARD.h - 32);
      c.restore();
      c.textAlign = 'left';
    }
    // 已播出的章（訊號色，歪的，蓋下去那一下比較大）
    if (stampK > 0) {
      c.save();
      c.translate(CARD.w - 120, 128);
      c.rotate(-0.22);
      const sc = 1.25 - 0.25 * stampK;
      c.scale(sc, sc);
      c.globalAlpha = 0.85 * stampK;
      c.strokeStyle = rgba('signal'); c.lineWidth = 4;
      c.beginPath(); c.arc(0, 0, 52, 0, TAU); c.stroke();
      c.lineWidth = 1.5; c.beginPath(); c.arc(0, 0, 44, 0, TAU); c.stroke();
      c.fillStyle = rgba('signal');
      c.font = font(F.hei(900), 26); c.textAlign = 'center';
      c.fillText('已播出', 0, 10);
      c.font = font(F.mono(500), 10); c.letterSpacing = '2px';
      c.fillText('ON AIR', 0, 30);
      c.letterSpacing = '0px';
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
    c.font = font(F.mono(500), 19); c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    for (let f = 88; f <= 108; f += 4) c.fillText(String(f), fx(f), SC.y + 30);
    // 電台名（主打那一台粗一點）
    c.textAlign = 'center';
    for (const st of this.stations) {
      c.font = font(F.hei(st.hot ? 900 : 500), st.hot ? 21 : 18);
      c.fillStyle = ink(st.hot ? 1 : 0.72);
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
    c.font = font(F.mono(500), 12); c.letterSpacing = '3px'; c.fillStyle = ink(0.7); c.textAlign = 'center';
    c.fillText('VOLUME', KNOB_L.x, KNOB_L.y + KNOB_L.r + 30);
    c.fillText('TUNING', KNOB_R.x, KNOB_R.y + KNOB_R.r + 30);
    // 魔眼的框
    c.beginPath(); c.arc(EYE.x, EYE.y, EYE.r + 6, 0, TAU); c.strokeStyle = ink(0.9); c.lineWidth = 2; c.stroke();
    // 廠牌：刻度窗與喇叭之間
    c.font = font(F.serif(600, true), 30); c.letterSpacing = '1px'; c.fillStyle = ink(0.95);
    c.fillText(`${COUPLE_EN}`, (CAB.x + CAB.x + CAB.w) / 2, 336);
    c.font = font(F.mono(500), 12); c.letterSpacing = '5px'; c.fillStyle = ink(0.65);
    c.textAlign = 'left';
    c.fillText('心頻 HEART · FM', DIAL.x, 334);
    c.textAlign = 'right';
    c.fillText(`MODEL ${DATE_DOTS}`, DIAL.x + DIAL.w, 334);
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
    if (!ly) {
      const key = 'idle';
      if (key === this.txtKey) return;
      this.txtKey = key;
      this.txt.clear();
      c.textAlign = 'center'; c.textBaseline = 'alphabetic';
      c.font = font(F.archivo(100, 800), 64); c.fillStyle = rgba('bone', 0.4);
      c.fillText('FM 103.13', GRILLE.w / 2, GRILLE.h / 2 - 10);
      c.font = font(F.hei(700), 30); c.fillStyle = rgba('bone', 0.32);
      c.fillText(`現正播放《${song.title || '今晚的歌'}》`, GRILLE.w / 2, GRILLE.h / 2 + 50);
      c.textAlign = 'left';
      this.txt.upload();
      return;
    }
    const lay = layoutWordRows(c, ly.line, F_LYR, GRILLE.w - PAD * 2, GRILLE.h - PAD * 2, { min: 56, max: 118, maxRows: 4, lh: 1.14 });
    // 內容：每個字的狀態＋正在唱的字彈到哪（量化，一樣就不重畫）
    const pops = lay.words.map((b) => {
      const p = Lyrics.wordProgress(b.word, t);
      const pop = t >= b.word.start ? Math.exp(-(t - b.word.start) / 0.11) : 0;
      return `${p <= 0 ? 0 : p < 1 ? 1 : 2}${Math.round(pop * 10)}`;
    }).join('');
    const key = `${ly.line.i}|${Math.round(ly.k * 20)}|${pops}`;
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
      c.translate(b.x + b.w / 2, b.y - lay.size * 0.35);
      c.scale(s, s);
      c.translate(-b.w / 2, lay.size * 0.35);
      c.fillStyle = b.word.w === '♥' ? rgba('rose') : p <= 0 ? rgba('bone', 0.26) : p < 1 ? rgba('signal') : rgba('bone', 0.96);
      c.fillText(b.word.w, 0, 0);
      c.restore();
    }
    c.restore();
    this.txt.upload();
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
    this.lines.render(renderer, out);
    this.glow.render(renderer, out);

    // 點歌卡：第一拍從右邊滑進來
    this.drawCard(t);
    const slide = 1 - ease.outExpo(prog(t, this.tCard - 0.28, this.tCard + 0.35));
    this.blit(this.card.texture, CL.x + slide * 760, CL.y, CL.w, CL.h, out);
    return { paper: 1, bloom: 0.45, vignette: 0.28, halation: 0.12, grain: 0.05, popupAvoid: this.avoid };
  }
}


