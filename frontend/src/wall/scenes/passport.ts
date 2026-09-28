// 護照蓋章頁（亮版面）：一本「愛的護照」攤開在桌上，兩頁都是這些年去過的地方（夜市、海邊、狗狗公園、羽球館…）的入境章，
// 各種形狀、各種墨色、有的歪有的缺墨，疊在一起的地方墨會疊色（multiply，像真的蓋在紙上）。
//  - 第一個拍點：「祝福簽證 BLESSING VISA」大章「碰」地砸在左頁（畫面震一下），承辦人接著用筆（仙女棒的火花當筆尖）
//    在章裡把主打留言一個字一個字寫進去，最後簽上持有人（留言署名）。
//  - 之後每一拍（慢歌兩拍）右頁「碰」一個新的小章：章落下之前先看到印章的影子壓過來，落下的那一刻墨才出現。
//  - 窗格最後一個小節線：一個點綴色的愛心章「永遠 FOREVER」蓋在右頁正中間。
// 歌詞寫在左頁下方「官員註記」欄，照跟唱規則逐字亮。
// 沒有留言：大章是「候補簽證」，章裡寫邀請；新人的留言：章是「新人簽發」。
// 畫法：整個跨頁（紙、底紋、浮水印、頁碼、打孔的護照號碼、原本就有的章）開場畫在一張離屏畫布上；
// 落下的章直接 multiply 疊進另一張「現在的跨頁」畫布（倒轉時間就從底圖重畫），每格只 drawImage 一次再畫會動的東西。
// 不是任何國家的護照：沒有國徽、沒有真的欄位格式，只有自己設計的「愛的護照」。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import type { AudioData } from '../engine/audio';
import { LineBatch } from '../engine/lines';
import { F, font, layout, loadText, measure, type TextLayout } from '../engine/type';
import { mixRgba, rgba } from '../engine/palette';
import { clamp, ease, hash, mulberry32, prog, pulse, frameIdx, TAU } from '../engine/util';
import type { FitResult } from '../engine/text';
import { lyricAt, drawLyric, layoutLyric, beatAfter, sparkHead, sparkParticles, heartPoints, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { sigInk, ink, paper, paperLyric, makeCanvas, freeCanvas, inkStamp, arcText, writeGlyph, beatsIn, barsIn, xfRect, paperPass, ensureBake, themeKey, fitMsg, yieldFrame, type Rect } from './_t1';

export const spec: PlateSpecDecl = { group: 'type', family: 'doc', paper: true, energy: [0.35, 1], bars: [4, 8], weight: 1 };

type Ctx2 = CanvasRenderingContext2D;

/** 跨頁（螢幕座標，放好的樣子）：左頁 0..GUT、右頁 GUT..SPREAD.w。右下角落在 QR 區，那裡只有章，沒有要讀的字。 */
const SPREAD = { x: 70, y: 58, w: 1660, h: 964 };
const GUT = 830;
const ROT = -0.012;
/** 左頁的大簽證章（跨頁座標）。 */
const VISA = { x: 78, y: 118, w: 690, h: 560 };
/** 章裡寫留言的地方（跨頁座標）。 */
const VMSG = { x: VISA.x + 40, y: VISA.y + 138, w: VISA.w - 80, h: 300 };
/** 官員註記（歌詞）：左頁下方。 */
const NOTE = { x: 96, label: 736, base: 810, maxW: 690 };

const TEXT = '簽證入境紀錄祝福簽證候補簽證新人簽發持有人有效期限永久入境次數無限官員註記入境時播放的歌曲間奏中本曲為純音樂請自行哼唱掃描右下角把祝福寫上大螢幕全體賓客一位賓客愛的護照永遠核准入境出境';

/** 章的地點（這些年一起去過的地方；都是自己編的，不是真的關口）。 */
const PLACES: [string, string][] = [
  ['夜市', 'NIGHT MARKET'], ['海邊', 'SEASIDE'], ['狗狗公園', 'DOG PARK'], ['羽球館', 'COURT No.7'], ['咖啡店', 'CAFÉ'],
  ['阿嬤家', "GRANDMA'S"], ['蜜月島', 'HONEYMOON IS.'], ['喜宴港', 'BANQUET PORT'], ['月老關', 'MOON GATE'], ['甜蜜市', 'SWEET CITY'],
  ['心動鎮', 'HEARTBEAT'], ['早餐店', 'BRUNCH'], ['山上', 'THE HILLS'], ['電影院', 'CINEMA'], ['廚房', 'KITCHEN'], ['沙發', 'THE SOFA'],
];
type Shape = 'circle' | 'rect' | 'oval' | 'oct' | 'hex' | 'tri';
const SHAPES: Shape[] = ['circle', 'rect', 'oval', 'oct', 'hex', 'rect', 'circle', 'tri'];
type InkKey = 'sepia' | 'sig' | 'blood' | 'graphite';

interface Stamp {
  cv: ReturnType<typeof makeCanvas>;
  /** 跨頁座標的中心、角度。 */
  x: number; y: number; rot: number;
  /** 落下的時間（-Infinity = 本來就在頁上）。 */
  t: number;
  alpha: number;
}

export default class Passport extends Scene {
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  pass = shared('passport.paper', () => paperPass());
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = Number(this.ctx.params.seed ?? 1);
  /** 底圖（紙、底紋、原本的章）與「現在的跨頁」（底圖＋已經落下的章）。 */
  base: ReturnType<typeof makeCanvas> | null = null;
  page: ReturnType<typeof makeCanvas> | null = null;
  artKey = '';
  drawn = -1;
  stamps: Stamp[] = [];
  /** 這個窗格要落下的章（依時間排好；第一個是大簽證章）。 */
  drops: Stamp[] = [];

  fit: FitResult | null = null;
  msgFam = F.hand(700);
  glyphs: { ch: string; x: number; y: number; w: number; t0: number; t1: number }[] = [];
  holder = '';
  holderLay!: TextLayout;
  holderT: [number, number] = [0, 0];
  kind: 'msg' | 'invite' | 'couple' = 'msg';
  B = 0.5;
  tVisa = 0;
  avoid: Rect[] = [];
  handle: ReturnType<typeof makeCanvas> | null = null;

  override async init() {
    const { audio: au, lyrics, start: s, end: e } = this.ctx;
    const m = this.msg;
    this.kind = !m ? 'invite' : m.couple ? 'couple' : 'msg';
    this.holder = m ? (m.couple ? COUPLE_ZH : m.name || '一位賓客') : '全體賓客';
    const body = m ? m.text : '掃描右下角 QR code，把祝福寫上大螢幕。';
    await loadText(TEXT + PLACES.map((p) => p[0]).join('') + this.holder + body + COUPLE_ZH + lyrics.linesIn(s - 2, e + 1).map((l) => l.text).join(''));
    const B = (this.B = au.beatPeriod(s + 0.1));

    // ---- 時間：大章在第一個拍點，接著寫留言（最多兩小節、最多窗格的四成），再簽持有人
    this.tVisa = beatAfter(au, s + 0.08);
    const c = this.layer.ctx;
    this.fit = fitMsg(c, body, this.msgFam, VMSG.w, VMSG.h, { min: 44, max: 90, lineHeight: 1.3, maxLines: 5 });
    const fit = this.fit;
    const n = fit.lines.reduce((a, l) => a + Array.from(l).length, 0);
    const w0 = this.tVisa + B / 2;
    const budget = clamp(Math.min(8 * B, 0.4 * (e - s)), 0.8, 4.2);
    const per = Math.min(0.1, budget / Math.max(1, n));
    const top = VMSG.y + (VMSG.h - fit.height) / 2 + fit.size * 0.88;
    let k = 0;
    this.glyphs = [];
    fit.lines.forEach((ln, row) => {
      const lay = layout(ln, this.msgFam, fit.size);
      for (const g of lay.glyphs) { this.glyphs.push({ ch: g.ch, x: VMSG.x + g.x, y: top + row * fit.lineHeight, w: g.w, t0: w0 + k * per, t1: w0 + (k + 1) * per }); k++; }
    });
    const wEnd = w0 + n * per;
    let hs = 42;
    while (hs > 26 && measure(this.holder, F.hand(700), hs) > 300) hs -= 2;
    this.holderLay = layout(this.holder, F.hand(700), hs);
    const h0 = wEnd + B * 0.25;
    this.holderT = [h0, h0 + clamp(0.09 * this.holderLay.glyphs.length + 0.2, 0.35, 1.1)];

    // ---- 章：原本就在頁上的、這個窗格要落下的
    await yieldFrame();
    await this.buildStamps(au, e, true);
    await yieldFrame();
    this.drawBase();

    const X = SPREAD.x, Y = SPREAD.y;
    this.avoid = [xfRect([VISA.x, VISA.y, VISA.w, VISA.h], X, Y, ROT), xfRect([NOTE.x - 10, NOTE.label - 30, NOTE.maxW + 20, 200], X, Y, ROT)];
  }

  override dispose() { freeCanvas(this.base); freeCanvas(this.page); freeCanvas(this.handle); for (const s of [...this.stamps, ...this.drops]) freeCanvas(s.cv); super.dispose(); }

  /** 一個小章（地點、出入境、日期），形狀與墨色看種子。 */
  private smallStamp(i: number, rnd: () => number): Stamp['cv'] {
    const [zh, en] = PLACES[Math.floor(rnd() * PLACES.length)]!;
    const shape = SHAPES[Math.floor(rnd() * SHAPES.length)]!;
    const inkK: InkKey = (['sepia', 'sig', 'blood', 'graphite', 'sig', 'sepia'] as InkKey[])[Math.floor(rnd() * 6)]!;
    const col = inkK === 'sig' ? sigInk(0.95) : inkK === 'blood' ? rgba('blood', 0.9) : inkK === 'graphite' ? rgba('graphite', 0.95) : ink(0.88);
    const year = 2016 + Math.floor(rnd() * 11);
    const date = `${year}.${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}.${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`;
    const inOut = rnd() < 0.6 ? ['入境', 'ARRIVED'] : ['出境', 'DEPARTED'];
    const sz = 200 + rnd() * 60;
    const wh: [number, number] = shape === 'rect' ? [sz * 1.35, sz * 0.8] : shape === 'oval' ? [sz * 1.3, sz * 0.86] : [sz, sz];
    return inkStamp(wh[0] + 20, wh[1] + 20, this.seed * 31 + i, (c) => drawSmall(c, shape, wh[0], wh[1], col, zh, en, date, inOut as [string, string]), 1.25);
  }

  /** slow = true（init 裡）：每畫幾個章就讓出主執行緒一下。 */
  private async buildStamps(au: AudioData, e: number, slow = false) {
    for (const st of [...this.stamps, ...this.drops]) freeCanvas(st.cv);
    const rnd = mulberry32(this.seed * 7 + 13);
    // 原本就在頁上的章：散在左頁的邊邊與右頁（避開大簽證章與官員註記）
    const pre: [number, number][] = [[770, 34], [30, 1000], [940, 150], [1470, 170], [1000, 560], [1580, 520], [1130, 890]];
    this.stamps = [];
    for (const [i, [x, y]] of pre.entries()) {
      this.stamps.push({ cv: this.smallStamp(i, rnd), x: x + (rnd() - 0.5) * 30, y: y + (rnd() - 0.5) * 30, rot: (rnd() - 0.5) * 0.9, t: -Infinity, alpha: 0.7 + rnd() * 0.25 });
      if (slow && i % 3 === 2) await yieldFrame();
    }
    // 這個窗格要落下的：大簽證章（第一拍）＋右頁一拍一個（慢歌兩拍一個）＋最後小節線的愛心章
    const visa = inkStamp(VISA.w + 20, VISA.h + 20, this.seed + 99, (c) => drawVisa(c, this.kind, this.msg), 1.25, 0.45);
    this.drops = [{ cv: visa, x: VISA.x + VISA.w / 2, y: VISA.y + VISA.h / 2, rot: -0.02, t: this.tVisa, alpha: 0.92 }];
    // 新章的位置：右頁大致排成三欄四列（不要全擠在中間），避開右下角的 QR 區
    const slots: [number, number][] = [[1200, 190], [1420, 380], [980, 360], [1230, 470], [1450, 650], [1190, 720], [960, 770], [1330, 110]];
    for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [slots[i], slots[j]] = [slots[j]!, slots[i]!]; }
    const every = this.B < 0.42 ? 2 : 1;
    const bars = barsIn(au, this.tVisa + 4 * this.B, e - 0.5);
    const heartT = bars.length ? bars[bars.length - 1]! : Infinity;
    const beats = beatsIn(au, this.holderT[1] + 0.05, Math.min(heartT - 0.4, e - 0.3));
    let si = 0;
    for (const [i, bt] of beats.entries()) {
      if (i % every || si >= slots.length) continue;
      const [x, y] = slots[si]!;
      this.drops.push({ cv: this.smallStamp(100 + si, rnd), x: x + (rnd() - 0.5) * 50, y: y + (rnd() - 0.5) * 40, rot: (rnd() - 0.5) * 0.8, t: bt, alpha: 0.85 + rnd() * 0.1 });
      si++;
      if (slow && si % 3 === 0) await yieldFrame();
    }
    if (isFinite(heartT)) {
      const hc = inkStamp(400, 380, this.seed + 7, (c) => { c.scale(1.3, 1.3); drawHeartStamp(c); }, 1.25, 0.35);
      this.drops.push({ cv: hc, x: 1240, y: 520, rot: 0.1, t: heartT, alpha: 1 });
    }
    this.drops.sort((a, b) => a.t - b.t);
  }

  /** 底圖：跨頁的紙、頁緣、中縫的陰影、底紋、浮水印、頁首頁碼、打孔的護照號碼、原本就有的章。 */
  private drawBase() {
    this.artKey = themeKey();
    freeCanvas(this.base); freeCanvas(this.page);
    const b = (this.base = makeCanvas(SPREAD.w + 40, SPREAD.h + 40, 1.25));
    this.page = makeCanvas(SPREAD.w + 40, SPREAD.h + 40, 1.25);
    const c = b.c;
    c.translate(20, 20);
    // 頁緣：底下一疊紙（左右下緣各露出幾條線）
    for (let i = 4; i >= 1; i--) {
      c.fillStyle = i % 2 ? paper() : ink(0.08);
      c.beginPath(); c.roundRect(-i * 2.5, i * 2.2, SPREAD.w + i * 5, SPREAD.h, 12); c.fill();
      c.strokeStyle = ink(0.16); c.lineWidth = 1; c.stroke();
    }
    c.fillStyle = paper();
    c.beginPath(); c.roundRect(0, 0, SPREAD.w, SPREAD.h, 12); c.fill();
    // 底紋：細細的波浪線（左頁墨色、右頁訊號色），護照內頁的安全底紋
    c.save();
    c.beginPath(); c.roundRect(0, 0, SPREAD.w, SPREAD.h, 12); c.clip();
    for (let pg = 0; pg < 2; pg++) {
      const x0 = pg ? GUT : 0, x1 = pg ? SPREAD.w : GUT;
      c.strokeStyle = pg ? sigInk(0.13) : ink(0.07);
      c.lineWidth = 1;
      for (let y = -20; y < SPREAD.h + 20; y += 13) {
        c.beginPath();
        for (let x = x0; x <= x1; x += 8) {
          const yy = y + 4.5 * Math.sin(x * 0.021 + y * 0.05) + 2.5 * Math.sin(x * 0.057 - y * 0.02);
          if (x === x0) c.moveTo(x, yy); else c.lineTo(x, yy);
        }
        c.stroke();
      }
      // 浮水印：兩個交疊的圓（兩個人）外面一圈字（很淡）
      const cx = (x0 + x1) / 2, cy = SPREAD.h / 2 + 40;
      c.strokeStyle = pg ? ink(0.07) : sigInk(0.14);
      c.fillStyle = c.strokeStyle;
      c.lineWidth = 3;
      c.beginPath(); c.arc(cx - 70, cy, 130, 0, TAU); c.stroke();
      c.beginPath(); c.arc(cx + 70, cy, 130, 0, TAU); c.stroke();
      c.lineWidth = 1.2;
      c.beginPath(); c.arc(cx, cy, 250, 0, TAU); c.stroke();
      c.beginPath(); c.arc(cx, cy, 290, 0, TAU); c.stroke();
      c.save(); c.translate(cx, cy);
      arcText(c, 'LOVE PASSPORT · 愛的護照 · LOVE PASSPORT', 256, -Math.PI / 2, F.mono(600), 22, 6, true);
      arcText(c, `ALAN & OMENA · ${DATE_DOTS.split(' · ').join('.')}`, 256, Math.PI / 2, F.mono(600), 22, 6, false);
      c.restore();
    }
    // 中縫：兩邊往中間暗下去
    for (const dir of [-1, 1]) {
      const g = c.createLinearGradient(GUT, 0, GUT + dir * 90, 0);
      g.addColorStop(0, ink(0.2)); g.addColorStop(0.25, ink(0.07)); g.addColorStop(1, ink(0));
      c.fillStyle = g; c.fillRect(dir < 0 ? GUT - 90 : GUT, 0, 90, SPREAD.h);
    }
    c.fillStyle = ink(0.3); c.fillRect(GUT - 0.6, 0, 1.2, SPREAD.h);
    c.restore();
    // 頁首、頁碼、頁腳的微縮字
    const head = (x: number, zh: string, en: string, no: string, right: boolean) => {
      c.fillStyle = ink(0.7);
      c.font = font(F.hei(700), 20); c.letterSpacing = '12px';
      c.textAlign = right ? 'right' : 'left';
      c.fillText(zh, x, 44);
      c.font = font(F.mono(500), 12); c.letterSpacing = '4px'; c.fillStyle = ink(0.5);
      c.fillText(en, x, 64);
      // 頁碼：左頁在左下角；右頁的右下角在螢幕的 QR 區裡，改放在頁首
      c.font = font(F.mono(600), 18); c.letterSpacing = '2px'; c.fillStyle = ink(0.55);
      if (right) c.fillText(no, x, 88); else c.fillText(no, x, SPREAD.h - 26);
      c.textAlign = 'left'; c.letterSpacing = '0px';
    };
    head(40, '簽證', 'VISAS · 愛的護照', '08', false);
    head(SPREAD.w - 40, '入境紀錄', 'ENTRIES · LOVE PASSPORT', '09', true);
    c.font = font(F.mono(400), 8); c.fillStyle = ink(0.35); c.letterSpacing = '1px';
    const micro = 'LOVEPASSPORT·愛的護照·ALAN&OMENA·'.repeat(12);
    c.fillText(micro.slice(0, 120), 90, SPREAD.h - 10);
    c.letterSpacing = '0px';
    // 右頁外緣打孔的護照號碼（點陣的小洞，看得到底下的桌面）
    const serial = `AO${DATE_DOTS.split(' · ').join('').slice(2)}${String(this.msg?.n ?? 0).padStart(3, '0')}`;
    c.save();
    c.globalCompositeOperation = 'destination-out';
    let yy = 150;
    for (const ch of serial) {
      const rows = DOTS[ch] ?? DOTS['0']!;
      rows.forEach((row, ri) => {
        for (let ci = 0; ci < 5; ci++) if (row[ci] === '1') {
          // 字轉 90 度（沿著頁緣往下讀）
          c.beginPath(); c.arc(SPREAD.w - 32 - ri * 5.2, yy + ci * 5.2, 1.7, 0, TAU); c.fill();
        }
      });
      yy += 36;
    }
    c.restore();
    // 原本就有的章
    c.save();
    c.beginPath(); c.roundRect(0, 0, SPREAD.w, SPREAD.h, 12); c.clip();
    for (const st of this.stamps) this.putStamp(c, st);
    c.restore();
    this.drawn = -1;
  }

  /** 把一個章疊到紙上（multiply：墨疊墨會變深，像真的）。 */
  private putStamp(c: Ctx2, st: Stamp, scale = 1, alpha = 1) {
    c.save();
    c.globalCompositeOperation = 'multiply';
    c.globalAlpha = st.alpha * alpha;
    c.translate(st.x, st.y); c.rotate(st.rot); c.scale(scale, scale);
    c.drawImage(st.cv.cv, -st.cv.w / 2, -st.cv.h / 2, st.cv.w, st.cv.h);
    c.restore();
  }

  /** 「現在的跨頁」：底圖＋已經落下的章。落下的章多了就疊上去；時間倒退就從底圖重畫。 */
  private syncPage(t: number) {
    let n = 0;
    while (n < this.drops.length && this.drops[n]!.t <= t) n++;
    if (n === this.drawn) return;
    const p = this.page!;
    const c = p.c;
    if (n < this.drawn || this.drawn < 0) {
      c.save(); c.resetTransform(); c.globalCompositeOperation = 'copy'; c.drawImage(this.base!.cv, 0, 0, p.w, p.h); c.restore();
      this.drawn = 0;
    }
    c.save();
    c.translate(20, 20);
    c.beginPath(); c.roundRect(0, 0, SPREAD.w, SPREAD.h, 12); c.clip();
    for (let i = this.drawn; i < n; i++) this.putStamp(c, this.drops[i]!);
    c.restore();
    this.drawn = n;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, lyrics, audio: au } = this.ctx;
    const t = f.t, e = this.ctx.end;
    if (this.artKey !== themeKey()) { void this.buildStamps(au, e); this.drawBase(); }
    this.syncPage(t);
    const L = this.layer;
    L.clear();
    const c = L.ctx;
    this.glow.clear();
    c.save();
    c.translate(SPREAD.x, SPREAD.y); c.rotate(ROT);
    // 桌上的陰影（護照有厚度）
    c.fillStyle = ink(0.16);
    c.beginPath(); c.roundRect(8, 16, SPREAD.w, SPREAD.h, 14); c.fill();
    c.fillStyle = ink(0.08);
    c.beginPath(); c.roundRect(4, 26, SPREAD.w + 10, SPREAD.h, 18); c.fill();
    c.drawImage(this.page!.cv, -20, -20, this.page!.w, this.page!.h);

    // 大章裡的字：承辦人用筆寫留言、簽持有人（筆尖是仙女棒的火花）
    let pen: { x: number; y: number } | null = null;
    if (t >= this.tVisa) {
      c.font = font(this.msgFam, this.fit!.size);
      c.fillStyle = ink(0.95);
      for (const g of this.glyphs) {
        if (t < g.t0) break;
        const r = clamp((t - g.t0) / (g.t1 - g.t0));
        c.fillStyle = g.ch === '♥' ? rgba('rose') : ink(0.95);
        pen = writeGlyph(c, g.ch, g.x, g.y, this.fit!.size, g.w, r) ?? pen;
      }
      const [h0, h1] = this.holderT;
      if (t >= h0) {
        const hl = this.holderLay, per = (h1 - h0) / Math.max(1, hl.glyphs.length);
        c.font = font(hl.family, hl.size);
        c.fillStyle = ink(0.95);
        const hx = VISA.x + 170, hy = VISA.y + VISA.h - 52;
        for (const g of hl.glyphs) pen = writeGlyph(c, g.ch, hx + g.x, hy, hl.size, g.w, clamp((t - h0 - g.i * per) / per)) ?? pen;
      }
    }

    // 官員註記：歌詞
    this.drawNote(c, t);
    // 印章本身（俯視的木頭章柄）：落下前從上面壓下來、蓋完抬起來離開，墨是在它抬起來之後才看得到的
    this.drawHandles(c, t);
    c.restore();

    // 筆尖的火花（換成螢幕座標）
    if (pen) {
      const p = pen as { x: number; y: number };
      const cs = Math.cos(ROT), sn = Math.sin(ROT);
      const sx = SPREAD.x + cs * p.x - sn * p.y, sy = SPREAD.y + sn * p.x + cs * p.y;
      sparkParticles(this.glow, t, () => ({ x: sx, y: sy }), { rate: 70, life: 0.3, speed: 160, seed: this.seed });
      sparkHead(this.glow, sx, sy, t, 0.8, 0.9);
    }

    const P = this.pass.u;
    P.layer!.value = L.upload();
    P.bake!.value = ensureBake(renderer);
    P.tone!.value = 0.2;
    P.t!.value = t;
    this.pass.render(renderer, out);
    if (this.glow.count) this.glow.render(renderer, out);

    // 震動：大章最重、小章輕輕的
    let amp = 0, punch = 0;
    for (const d of this.drops) {
      if (t < d.t || t > d.t + 0.5) continue;
      const big = d === this.drops[0] || d === this.drops[this.drops.length - 1] ? 1 : 0.35;
      amp += 14 * big * pulse(t, d.t, 0.06);
      punch += 0.02 * big * pulse(t, d.t, 0.08);
    }
    const ph = frameIdx(t);
    return {
      paper: 1, popupAvoid: this.avoid, bloom: 0.35, bloomThreshold: 1.4, halation: 0.05, vignette: 0.28, grain: 0.05, ca: 0.5,
      shake: [amp * (hash(ph, 5) - 0.5) * 2, amp * (hash(ph, 6) - 0.5) * 2], zoom: 1 + punch,
    };
  }

  /** 俯視的印章：木頭章身（圓角方塊）＋圓的握把。落下前 0.12 秒從大（高）變小（壓到紙上），蓋完 0.12 秒抬起淡出。 */
  private drawHandles(c: Ctx2, t: number) {
    const hs = this.handle ??= makeHandle();
    for (const d of this.drops) {
      const u = (d.t - t) / 0.12, v = (t - d.t) / 0.14;
      let sc: number, a: number, lift: number;
      if (u > 0 && u <= 1) { lift = u; sc = 1 + 0.4 * u * u; a = 1; }
      else if (v >= 0 && v < 1) { lift = ease.outCubic(v); sc = 1 + 0.25 * lift; a = 1 - v * v; }
      else continue;
      const w = d.cv.w * 0.86, h = d.cv.h * 0.86;
      c.save();
      c.translate(d.x, d.y); c.rotate(d.rot);
      // 章身在紙上的影子：離紙越遠越大、越淡、越偏
      c.save();
      c.globalAlpha = a * (0.32 - 0.18 * lift);
      c.filter = `blur(${4 + 14 * lift}px)`;
      c.fillStyle = ink(1);
      c.beginPath(); c.roundRect(-w / 2 + 16 + 40 * lift, -h / 2 + 22 + 60 * lift, w, h, 18); c.fill();
      c.filter = 'none';
      c.restore();
      c.globalAlpha = a;
      c.scale(sc, sc);
      c.drawImage(hs.cv, -w / 2, -h / 2, w, h);
      c.restore();
    }
  }

  /** 官員註記欄（左頁下方）：標籤＋一行跟唱的歌詞；間奏與純音樂時寫一句冷面的註記。 */
  private drawNote(c: Ctx2, t: number) {
    const { lyrics } = this.ctx;
    c.fillStyle = ink(0.65);
    c.font = font(F.hei(500), 16); c.letterSpacing = '4px'; c.fillText('官員註記', NOTE.x, NOTE.label);
    c.font = font(F.mono(500), 12); c.letterSpacing = '3px';
    c.fillText("OFFICER'S NOTE · 入境時播放的歌曲", NOTE.x + measure('官員註記', F.hei(500), 16, 4) + 14, NOTE.label);
    c.letterSpacing = '0px';
    c.fillStyle = ink(0.3); c.fillRect(NOTE.x, NOTE.label + 12, NOTE.maxW, 1.1);
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const st = paperLyric(F.archivo(100, 800), 60, NOTE.maxW);
      const lay = layoutLyric(c, ly.line, st);
      const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.15));
      c.save();
      c.translate(NOTE.x, NOTE.base + (1 - inK) * 16);
      drawLyric(c, ly.line, t, st, lay, ly.k);
      c.restore();
      return;
    }
    const next = lyrics.nextLine(t), last = lyrics.lastLine(t);
    let k = 0.55;
    if (last) k *= clamp((t - last.end - 1.2) / 0.4);
    if (next) k *= clamp((next.start - 0.35 - t) / 0.25);
    if (k <= 0.01) return;
    c.save();
    c.globalAlpha = k;
    c.fillStyle = ink(0.6);
    c.font = font(F.hand(700), 44);
    c.fillText(lyrics.has ? '♪ 間奏中' : '♪ 本曲為純音樂，請自行哼唱', NOTE.x, NOTE.base);
    c.restore();
  }
}

// ------------------------------------------------------------------ 章的樣子
/** 印章的章身（俯視）：木頭色的圓角方塊、側邊暗一點、中間一個圓握把（跟主題的墨色與紙色混出來）。 */
function makeHandle() {
  const s = makeCanvas(300, 300, 1);
  const c = s.c;
  const wood = (k: number, a = 1) => mixRgba('paper', 'sepia', k, a);
  c.fillStyle = wood(0.62); c.beginPath(); c.roundRect(6, 10, 288, 284, 30); c.fill();
  c.fillStyle = wood(0.42); c.beginPath(); c.roundRect(14, 14, 272, 264, 24); c.fill();
  // 木紋
  c.strokeStyle = wood(0.55, 0.5); c.lineWidth = 2;
  for (let i = 0; i < 9; i++) { c.beginPath(); c.moveTo(20, 30 + i * 29); c.bezierCurveTo(100, 20 + i * 29, 200, 44 + i * 29, 280, 28 + i * 29); c.stroke(); }
  // 握把
  const g = c.createRadialGradient(130, 128, 10, 150, 150, 82);
  g.addColorStop(0, wood(0.25)); g.addColorStop(0.7, wood(0.6)); g.addColorStop(1, wood(0.78));
  c.fillStyle = wood(0.85, 0.5); c.beginPath(); c.arc(158, 162, 80, 0, TAU); c.fill();
  c.fillStyle = g; c.beginPath(); c.arc(150, 150, 78, 0, TAU); c.fill();
  return s;
}

/** 小章：地點（中文大字）、英文、出入境、日期。形狀：圓、長方、橢圓、八角、六角、三角。 */
function drawSmall(c: Ctx2, shape: Shape, w: number, h: number, col: string, zh: string, en: string, date: string, io: [string, string]) {
  c.strokeStyle = col; c.fillStyle = col;
  c.lineJoin = 'round';
  const poly = (n: number, r: number, a0: number) => { c.beginPath(); for (let i = 0; i < n; i++) { const a = a0 + (i / n) * TAU; if (i) c.lineTo(Math.cos(a) * r, Math.sin(a) * r); else c.moveTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); };
  c.textAlign = 'center';
  if (shape === 'circle') {
    const r = w / 2 - 6;
    c.lineWidth = 5; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke();
    c.lineWidth = 2; c.beginPath(); c.arc(0, 0, r - 34, 0, TAU); c.stroke();
    arcText(c, en, r - 30, -Math.PI / 2, F.mono(600), 17, 3, true);
    arcText(c, date, r - 30, Math.PI / 2, F.mono(600), 16, 3, false);
    c.font = font(F.hei(900), Math.min(46, (r * 1.2) / Math.max(2, Array.from(zh).length))); c.fillText(zh, 0, 8);
    c.font = font(F.hei(700), 17); c.fillText(`✈ ${io[0]}`, 0, 38);
  } else if (shape === 'rect') {
    c.lineWidth = 5; c.beginPath(); c.roundRect(-w / 2 + 6, -h / 2 + 6, w - 12, h - 12, 10); c.stroke();
    c.lineWidth = 1.6; c.beginPath(); c.roundRect(-w / 2 + 14, -h / 2 + 14, w - 28, h - 28, 6); c.stroke();
    c.font = font(F.mono(600), 16); c.fillText(`${en} · ${io[1]}`, 0, -h / 2 + 44);
    c.font = font(F.hei(900), Math.min(54, (w * 0.7) / Math.max(2, Array.from(zh).length))); c.fillText(zh, 0, 20);
    c.font = font(F.mono(600), 18); c.fillText(`${io[0]}  ${date}`, 0, h / 2 - 28);
  } else if (shape === 'oval') {
    c.lineWidth = 4.5; c.beginPath(); c.ellipse(0, 0, w / 2 - 6, h / 2 - 6, 0, 0, TAU); c.stroke();
    c.lineWidth = 1.5; c.beginPath(); c.ellipse(0, 0, w / 2 - 16, h / 2 - 16, 0, 0, TAU); c.stroke();
    c.font = font(F.hei(900), Math.min(48, (w * 0.55) / Math.max(2, Array.from(zh).length))); c.fillText(zh, 0, 4);
    c.font = font(F.mono(600), 15); c.fillText(en, 0, -h / 2 + 46);
    c.fillText(`${io[1]} ${date}`, 0, h / 2 - 34);
  } else if (shape === 'oct' || shape === 'hex') {
    const n = shape === 'oct' ? 8 : 6, r = w / 2 - 6;
    c.lineWidth = 5; poly(n, r, Math.PI / n); c.stroke();
    c.lineWidth = 1.6; poly(n, r - 12, Math.PI / n); c.stroke();
    c.font = font(F.mono(600), 15); c.fillText(en, 0, -r * 0.42);
    c.font = font(F.hei(900), Math.min(46, (r * 1.3) / Math.max(2, Array.from(zh).length))); c.fillText(zh, 0, 14);
    c.font = font(F.mono(600), 15); c.fillText(date, 0, r * 0.52);
  } else {
    // 三角：尖端朝上，字擠在下半部
    const r = w / 2 - 8;
    c.lineWidth = 5; poly(3, r, -Math.PI / 2); c.stroke();
    c.lineWidth = 1.6; poly(3, r - 16, -Math.PI / 2); c.stroke();
    c.font = font(F.hei(900), Math.min(36, (r * 0.9) / Math.max(2, Array.from(zh).length))); c.fillText(zh, 0, r * 0.18);
    c.font = font(F.mono(600), 13); c.fillText(date, 0, r * 0.36);
  }
  c.textAlign = 'left';
}

/** 大簽證章：雙框、表頭（祝福簽證 BLESSING VISA）、右上角的圓形徽章、下緣的持有人與有效期限。字留給承辦人寫。 */
function drawVisa(c: Ctx2, kind: 'msg' | 'invite' | 'couple', m: Msg | null) {
  const w = VISA.w, h = VISA.h, x0 = -w / 2, y0 = -h / 2;
  const col = sigInk(0.95);
  c.strokeStyle = col; c.fillStyle = col; c.lineJoin = 'round';
  c.lineWidth = 7; c.beginPath(); c.roundRect(x0 + 6, y0 + 6, w - 12, h - 12, 16); c.stroke();
  c.lineWidth = 2; c.beginPath(); c.roundRect(x0 + 18, y0 + 18, w - 36, h - 36, 10); c.stroke();
  // 表頭
  const title = kind === 'invite' ? '候補簽證' : kind === 'couple' ? '新人簽發' : '祝福簽證';
  const en = kind === 'invite' ? 'STANDBY VISA' : kind === 'couple' ? 'ISSUED BY THE COUPLE' : 'BLESSING VISA';
  c.font = font(F.hei(900), 50); c.letterSpacing = '14px'; c.fillText(title, x0 + 40, y0 + 84); c.letterSpacing = '0px';
  c.font = font(F.mono(600), 16); c.letterSpacing = '5px';
  c.fillText(`${en} · No.${String(m?.n ?? 0).padStart(3, '0')}`, x0 + 42, y0 + 114);
  c.letterSpacing = '0px';
  c.fillRect(x0 + 40, y0 + 126, w - 80, 2.5);
  // 右上角的圓形徽章：兩個交疊的圓（兩個人）
  const cx = x0 + w - 96, cy = y0 + 72;
  c.lineWidth = 3; c.beginPath(); c.arc(cx, cy, 44, 0, TAU); c.stroke();
  c.lineWidth = 2.2;
  c.beginPath(); c.arc(cx - 11, cy, 20, 0, TAU); c.stroke();
  c.beginPath(); c.arc(cx + 11, cy, 20, 0, TAU); c.stroke();
  // 下緣：持有人（留空，等等手寫）與有效期限
  c.fillRect(x0 + 40, y0 + h - 104, w - 80, 1.6);
  c.font = font(F.hei(700), 20); c.letterSpacing = '4px';
  c.fillText('持有人', x0 + 42, y0 + h - 56);
  c.font = font(F.mono(500), 12); c.letterSpacing = '3px'; c.fillText('HOLDER', x0 + 42, y0 + h - 36);
  c.textAlign = 'right';
  c.font = font(F.hei(700), 18); c.letterSpacing = '3px'; c.fillText('有效期限：永久', x0 + w - 42, y0 + h - 62);
  c.fillText('入境次數：無限', x0 + w - 42, y0 + h - 34);
  c.textAlign = 'left'; c.letterSpacing = '0px';
}

/** 最後的愛心章（點綴色：愛心是唯一用點綴色的東西）。 */
function drawHeartStamp(c: Ctx2) {
  const hp = heartPoints(96);
  const col = rgba('rose', 0.95);
  c.strokeStyle = col; c.fillStyle = col;
  const path = (s: number) => { c.beginPath(); hp.forEach((p, i) => (i ? c.lineTo(p.x * s, p.y * s - 8) : c.moveTo(p.x * s, p.y * s - 8))); c.closePath(); };
  c.lineWidth = 7; path(128); c.stroke();
  c.lineWidth = 2; path(110); c.stroke();
  c.textAlign = 'center';
  c.font = font(F.hei(900), 50); c.letterSpacing = '10px'; c.fillText('永遠', 6, 8);
  c.font = font(F.mono(600), 15); c.letterSpacing = '4px'; c.fillText('FOREVER', 3, 38);
  c.fillText(DATE_DOTS.split(' · ').join('.'), 3, 60);
  c.textAlign = 'left'; c.letterSpacing = '0px';
}

/** 5×7 點陣（打孔的護照號碼用）：只要 A、O 與數字。 */
const DOTS: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  '0': ['01110', '10011', '10101', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
};
