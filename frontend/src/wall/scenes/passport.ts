// 護照蓋章頁（亮版面）：一本「愛的護照」攤開在桌上，頁上有幾個兩個人常去的地方（夜市、海邊、咖啡店、早餐店…）的舊章，
// 形狀、墨色各不同、有的缺墨，疊在一起的地方墨會疊色（multiply，像真的蓋在紙上）。
// MV 化：焦點是左頁的大簽證章與裡面手寫的留言；鏡頭從斜上方看著攤開的護照（透視、景深、一盞燈），慢慢推近；
// 舊章淡淡的、少少的，右頁新蓋的章在畫面邊緣（失焦），只是節奏。頁首、頁碼、微縮字、英文標籤都拿掉了。
//  - 第一個拍點：「祝福簽證 BLESSING VISA」大章「碰」地砸在左頁（畫面震一下），承辦人接著用筆（仙女棒的火花當筆尖）
//    在章裡把主打留言一個字一個字寫進去，最後簽上持有人（留言署名）。
//  - 之後每一拍（慢歌兩拍）右頁「碰」一個新的小章：章落下之前先看到印章的影子壓過來，落下的那一刻墨才出現。
//  - 窗格最後一個小節線：一個點綴色的愛心章「永遠 FOREVER」蓋在右頁正中間。
// 歌詞寫在左頁下方「官員註記」欄，照跟唱規則逐字亮。
// 沒有留言：大章是「候補簽證」，章裡寫邀請；新人的留言：章是「新人簽發」。
// 畫法：整個跨頁（紙、底紋、浮水印、頁碼、打孔的護照號碼、原本就有的章）開場畫在一張離屏畫布上；
// 落下的章直接 multiply 疊進另一張「現在的跨頁」畫布（倒轉時間就從底圖重畫），每格只 drawImage 一次再畫會動的東西。
// v2（留言尺寸與版面比例標準 v2＋場景多元化）：夜裡一盞暖黃的燈，護照攤在打開的皮革行李箱上，底下墊著一張舊旅行地圖、
// 旁邊散著幾張舊票根。護照很大（它就是場景），簽證章裡寫留言的那一塊照 v2：留言 40～60 px、持有人（署名）26～32 px 在留言下面、
// 歌詞比留言小。地圖上每兩小節在小節線上多插一根大頭針、紅線從上一站畫過去（這些年一起去過的地方，一站一站連起來）；
// 右頁每兩拍（慢歌四拍）蓋一個新章、最後一個小節線蓋愛心章。
// 不是任何國家的護照：沒有國徽、沒有真的欄位格式，只有自己設計的「愛的護照」。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H, SCALE } from '../engine/gl';
import type { AudioData } from '../engine/audio';
import { LineBatch } from '../engine/lines';
import { F, font, layout, loadText, measure, type TextLayout } from '../engine/type';
import { mixRgba, rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, mulberry32, prog, pulse, frameIdx, fbm2, TAU } from '../engine/util';
import type { FitResult } from '../engine/text';
import { lyricAt, drawLyric, layoutLyric, beatAfter, sparkHead, sparkParticles, heartPoints, COUPLE_ZH, DATE, DATE_DOT, lyricSubOf, subSizeFor, subStyleFor, subGap, type LyricLayout, type LyricStyle } from './_motifs';
import type { Line } from '../engine/lyrics';
import { msgMaxFor, lyricV2, sigV2, V2 } from './_v2';
import {
  sigInk, ink, paper, paperLyric, makeCanvas, freeCanvas, inkStamp, arcText, writeGlyph, beatsIn, barsIn, ensureBake, themeKey, fitMsg, yieldFrame, heartGlyph,
  tablePass, setTableCam, fitCam, lerpCam, project, TABLE_F, deskScale, fitV2, setLight, lightTint, type TableCam, type Rect,
} from './_t1';

// 夜裡的皮革行李箱、一盞燈：四周是暗的，右下角 HUD 用淺色字 → 暗版面
export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'doc', paper: false, energy: [0.35, 1], bars: [4, 8], weight: 1 };

type Ctx2 = CanvasRenderingContext2D;

/** 跨頁（跨頁座標 w × h；在桌上左上角 (x, y)、縮放 K、轉 ROT）：左頁 0..GUT、右頁 GUT..SPREAD.w。 */
const SPREAD = { x: 40, y: 200, w: 1660, h: 964 };
const K = 0.82;
const GUT = 830;
const ROT = -0.05;
/** 左頁的大簽證章（跨頁座標）。v2：高度收到螢幕上 ≤ 430。 */
const VISA = { x: 78, y: 130, w: 690, h: 520 };
/** 章裡寫留言的地方（跨頁座標）；持有人（署名）在章的下緣、留言下面。 */
const VMSG = { x: VISA.x + 44, y: VISA.y + 100, w: VISA.w - 88, h: 300 };
/** 官員註記（歌詞）：左頁下方。 */
const NOTE = { x: 96, label: 712, base: 790, maxW: 690 };
/** 有原文的窗格：官員註記整段往上挪多少（簽證章下緣在 650），歌詞＋原文的底不能超過 NOTE_FLOOR（頁面下緣上面一點）。 */
const NOTE_UP = 20, NOTE_FLOOR = 940;
/** 舊旅行地圖（桌面座標）：墊在護照底下、比護照大，四周露出來。 */
const MAP = { x: -120, y: -10, w: 1860, h: 1080, rot: 0.04 };
/** 地圖上的站（桌面座標）：護照外面露出來的地方；每兩小節多一站。 */
const STOPS: [number, number][] = [[380, 90], [820, 70], [1250, 60], [1560, 160], [1620, 420], [1600, 640], [40, 560]];
/** 跨頁座標 → 桌面座標。 */
const toDesk = (u: number, v: number): [number, number] => [SPREAD.x + K * (Math.cos(ROT) * u - Math.sin(ROT) * v), SPREAD.y + K * (Math.sin(ROT) * u + Math.cos(ROT) * v)];

const TEXT = '簽證入境紀錄祝福簽證候補簽證新人簽發持有人有效期限永久入境次數無限官員註記入境時播放的歌曲間奏中本曲為純音樂請自行哼唱掃描右下角把祝福寫上大螢幕全體賓客一位賓客愛的護照永遠核准入境出境';

/** 章的地點（情侶常去、任何一對都可能去過的地方；都是自己編的，不是真的關口）。 */
const PLACES: [string, string][] = [
  ['夜市', 'NIGHT MARKET'], ['海邊', 'SEASIDE'], ['遊樂園', 'FUNFAIR'], ['書店', 'BOOKSHOP'], ['咖啡店', 'CAFÉ'],
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
  layer = this.track(new Layer2D(W, H, SCALE * 1.25, { fast: true }));
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  pass = shared('passport.table', () => tablePass(LEATHER_GLSL));
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
  camA!: TableCam;
  camB!: TableCam;
  /** 一定要清楚的點（留言與歌詞的中心，桌面座標）。 */
  focusPts: [number, number][] = [];
  handle: ReturnType<typeof makeCanvas> | null = null;
  /** 地圖（含票根）的畫布；每兩小節插一根針的時間。 */
  map: ReturnType<typeof makeCanvas> | null = null;
  pins: number[] = [];
  /** 跨頁 px → 螢幕 px（K × 鏡頭在簽證章那裡的縮放）：v2 的字級是螢幕 px。 */
  S = 1;
  /** 官員註記那一行在畫面上的縮放（鏡頭從遠推近，取最遠的時候）：原文照它換算螢幕字級。 */
  sNote = 1;
  /** 官員註記往上挪了多少（有原文的窗格 = NOTE_UP）。 */
  noteUp = 0;
  lyrPx = 56;

  override async init() {
    const { audio: au, lyrics, start: s, end: e } = this.ctx;
    const m = this.msg;
    this.noteUp = lyrics.linesIn(s, e).some((l) => lyricSubOf(l)) ? NOTE_UP : 0;
    this.kind = !m ? 'invite' : m.couple ? 'couple' : 'msg';
    this.holder = m ? (m.couple ? COUPLE_ZH : m.name || '一位賓客') : '全體賓客';
    const body = m ? m.text : '掃描右下角 QR code，把祝福寫上大螢幕。';
    await loadText(TEXT + PLACES.map((p) => p[0]).join('') + this.holder + body + COUPLE_ZH + lyrics.linesIn(s - 2, e + 1).map((l) => l.text).join(''));
    const B = (this.B = au.beatPeriod(s + 0.1));

    // ---- 鏡頭先定好（字級要換成螢幕 px）：從左下斜斜地看攤開的護照，簽證章在畫面左半、右頁往遠處失焦
    const box = (r: Rect): Rect => {
      const pts = [toDesk(r[0], r[1]), toDesk(r[0] + r[2], r[1]), toDesk(r[0], r[1] + r[3]), toDesk(r[0] + r[2], r[1] + r[3])];
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    };
    const keep = [box([VISA.x, VISA.y, VISA.w, VISA.h]), box([NOTE.x - 10, NOTE.base - 62, NOTE.maxW + 20, 130])];
    this.focusPts = [toDesk(VMSG.x + VMSG.w / 2, VMSG.y), toDesk(NOTE.x + 200, NOTE.base)];
    const [cu, cv] = toDesk(GUT - 60, SPREAD.h * 0.52);
    this.camB = fitCam({ tu: cu, tv: cv, dist: TABLE_F * 1.05, tilt: 0.42, yaw: 0.16, roll: -0.14 }, keep);
    this.camA = { ...this.camB, dist: this.camB.dist * 1.08, tu: this.camB.tu + 90, yaw: 0.22, roll: -0.19 };
    this.pins = barsIn(au, s + 0.3, e - 0.3).filter((_, i) => i % 2 === 0);
    const [vu, vv] = toDesk(VMSG.x + VMSG.w / 2, VMSG.y + VMSG.h / 2);
    this.S = K * deskScale(this.camB, vu, vv);
    const [nu, nv] = toDesk(NOTE.x + NOTE.maxW / 2, NOTE.base);
    this.sNote = K * Math.min(deskScale(this.camA, nu, nv), deskScale(this.camB, nu, nv));
    const S = this.S;

    // ---- 時間：大章在第一個拍點，接著寫留言（最多兩小節、最多窗格的四成），再簽持有人
    this.tVisa = beatAfter(au, s + 0.08);
    const c = this.layer.ctx;
    const o = { min: V2.msgMin / S, max: msgMaxFor(body) / S, lineHeight: 1.26, maxLines: 5 };
    this.fit = fitV2(c, body, this.msgFam, VMSG.w, VMSG.h, o);
    const fit = this.fit;
    this.lyrPx = lyricV2(m ? fit.size * S : null) / S;
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
    // 持有人（署名）：26～32 螢幕 px，太長就再縮一點（寫在章的下緣那一格）
    let hs = sigV2(fit.size * S) / S;
    while (hs > V2.sigMin / S && measure(this.holder, F.hand(700), hs) > 420) hs -= 1;
    this.holderLay = layout(this.holder, F.hand(700), hs);
    const h0 = wEnd + B * 0.25;
    this.holderT = [h0, h0 + clamp(0.09 * this.holderLay.glyphs.length + 0.2, 0.35, 1.1)];

    // ---- 章：原本就在頁上的、這個窗格要落下的
    await yieldFrame();
    await this.buildStamps(au, e, true);
    await yieldFrame();
    this.drawBase();

  }

  override dispose() { freeCanvas(this.base); freeCanvas(this.page); freeCanvas(this.handle); freeCanvas(this.map); for (const s of [...this.stamps, ...this.drops]) freeCanvas(s.cv); super.dispose(); }

  /** 一個小章（地點、出入境、日期），形狀與墨色看種子。 */
  private smallStamp(i: number, rnd: () => number): Stamp['cv'] {
    const [zh, en] = PLACES[Math.floor(rnd() * PLACES.length)]!;
    const shape = SHAPES[Math.floor(rnd() * SHAPES.length)]!;
    // 舊章的墨：大多是低彩度的墨色、鉛灰，偶爾一個訊號色（訊號色留給焦點）
    const inkK: InkKey = (['sepia', 'graphite', 'blood', 'graphite', 'sig', 'sepia'] as InkKey[])[Math.floor(rnd() * 6)]!;
    const col = inkK === 'sig' ? sigInk(0.95) : inkK === 'blood' ? rgba('blood', 0.9) : inkK === 'graphite' ? rgba('graphite', 0.95) : ink(0.88);
    // 舊章是婚禮之前十年內蓋的（年份照婚禮那年往回推，章上的日期才不會比婚禮還晚）；還沒定日期就用 2016～2026
    const year = (DATE ? DATE.y - 11 : 2016) + Math.floor(rnd() * 11);
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
    // 韓文歌（有原文副行）：官員註記多一排原文、比較低，左下角那個舊章再往角落塞一點，才不會壓到原文
    const subDrop = this.ctx.lyrics.linesIn(this.ctx.start, e).some((l) => lyricSubOf(l)) ? 60 : 0;
    const pre: [number, number][] = [[770, 40], [40 - subDrop * 0.5, 990 + subDrop], [1480, 560]];
    this.stamps = [];
    for (const [i, [x, y]] of pre.entries()) {
      this.stamps.push({ cv: this.smallStamp(i, rnd), x: x + (rnd() - 0.5) * 30, y: y + (rnd() - 0.5) * 30, rot: (rnd() - 0.5) * 0.9, t: -Infinity, alpha: 0.38 + rnd() * 0.2 });
      if (slow && i % 3 === 2) await yieldFrame();
    }
    // 這個窗格要落下的：大簽證章（第一拍）＋右頁一拍一個（慢歌兩拍一個）＋最後小節線的愛心章
    const visa = inkStamp(VISA.w + 20, VISA.h + 20, this.seed + 99, (c) => drawVisa(c, this.kind), 1.25, 0.45);
    this.drops = [{ cv: visa, x: VISA.x + VISA.w / 2, y: VISA.y + VISA.h / 2, rot: -0.02, t: this.tVisa, alpha: 0.92 }];
    // 新章的位置：右頁靠中縫的一欄（在畫面右緣、失焦，只是節奏），避開右下角的 QR 區
    const slots: [number, number][] = [[1030, 360], [1090, 700], [1200, 160]];
    for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [slots[i], slots[j]] = [slots[j]!, slots[i]!]; }
    // 兩拍一個（慢歌四拍一個）：章多了畫面就亂
    const every = this.B < 0.42 ? 4 : 2;
    const bars = barsIn(au, this.tVisa + 4 * this.B, e - 0.5);
    const heartT = bars.length ? bars[bars.length - 1]! : Infinity;
    const beats = beatsIn(au, this.holderT[1] + 0.05, Math.min(heartT - 0.4, e - 0.3));
    let si = 0;
    for (const [i, bt] of beats.entries()) {
      if (i % every || si >= slots.length) continue;
      const [x, y] = slots[si]!;
      this.drops.push({ cv: this.smallStamp(100 + si, rnd), x: x + (rnd() - 0.5) * 50, y: y + (rnd() - 0.5) * 40, rot: (rnd() - 0.5) * 0.8, t: bt, alpha: 0.6 + rnd() * 0.15 });
      si++;
      if (slow && si % 3 === 0) await yieldFrame();
    }
    if (isFinite(heartT)) {
      const hc = inkStamp(400, 380, this.seed + 7, (c) => { c.scale(1.3, 1.3); drawHeartStamp(c); }, 1.25, 0.35);
      this.drops.push({ cv: hc, x: 1010, y: 470, rot: 0.1, t: heartT, alpha: 0.95 });
    }
    this.drops.sort((a, b) => a.t - b.t);
  }

  /** 底圖：跨頁的紙、頁緣、中縫的陰影、底紋、浮水印、頁首頁碼、打孔的護照號碼、原本就有的章。 */
  private drawBase() {
    this.artKey = themeKey();
    freeCanvas(this.map);
    this.map = this.drawMap();
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
      c.strokeStyle = pg ? sigInk(0.07) : ink(0.045);
      c.lineWidth = 1;
      for (let y = -20; y < SPREAD.h + 20; y += 13) {
        c.beginPath();
        for (let x = x0; x <= x1; x += 8) {
          const yy = y + 4.5 * Math.sin(x * 0.021 + y * 0.05) + 2.5 * Math.sin(x * 0.057 - y * 0.02);
          if (x === x0) c.moveTo(x, yy); else c.lineTo(x, yy);
        }
        c.stroke();
      }
      // 浮水印：兩個交疊的圓（兩個人），很淡
      const cx = (x0 + x1) / 2, cy = SPREAD.h / 2 + 40;
      c.strokeStyle = pg ? ink(0.05) : sigInk(0.08);
      c.lineWidth = 2.5;
      c.beginPath(); c.arc(cx - 70, cy, 130, 0, TAU); c.stroke();
      c.beginPath(); c.arc(cx + 70, cy, 130, 0, TAU); c.stroke();
    }
    // 中縫：兩邊往中間暗下去
    for (const dir of [-1, 1]) {
      const g = c.createLinearGradient(GUT, 0, GUT + dir * 90, 0);
      g.addColorStop(0, ink(0.2)); g.addColorStop(0.25, ink(0.07)); g.addColorStop(1, ink(0));
      c.fillStyle = g; c.fillRect(dir < 0 ? GUT - 90 : GUT, 0, 90, SPREAD.h);
    }
    c.fillStyle = ink(0.3); c.fillRect(GUT - 0.6, 0, 1.2, SPREAD.h);
    c.restore();
    // 頁首：只留左頁一個小標（配角）
    c.fillStyle = ink(0.5);
    c.font = font(F.hei(700), 18); c.letterSpacing = '10px';
    c.fillText('簽證', 40, 48);
    c.letterSpacing = '0px';
    // 右頁外緣打孔的護照號碼（點陣的小洞，看得到底下的桌面）：婚禮日期 yymmdd ＋ 留言編號；
    // 還沒定日期的新人用 5201314（我愛你一生一世）頂著，號碼長度差不多
    const serial = `${DATE ? DATE.yyyy.slice(2) + DATE.mm + DATE.dd : '5201314'}${String(this.msg?.n ?? 0).padStart(3, '0')}`;
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
    // 墊在底下的舊地圖（含票根）、地圖上的大頭針與紅線
    this.drawMapLayer(c, t);
    c.save();
    c.translate(SPREAD.x, SPREAD.y); c.rotate(ROT); c.scale(K, K);
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
        c.fillStyle = ink(0.95);
        if (g.ch === '♥') { c.save(); c.globalAlpha *= r; heartGlyph(c, g.x, g.y); c.restore(); continue; }
        pen = writeGlyph(c, g.ch, g.x, g.y, this.fit!.size, g.w, r) ?? pen;
      }
      const [h0, h1] = this.holderT;
      if (t >= h0) {
        const hl = this.holderLay, per = (h1 - h0) / Math.max(1, hl.glyphs.length);
        c.font = font(hl.family, hl.size);
        c.fillStyle = ink(0.95);
        const hx = VISA.x + 160, hy = VISA.y + VISA.h - 48;
        for (const g of hl.glyphs) pen = writeGlyph(c, g.ch, hx + g.x, hy, hl.size, g.w, clamp((t - h0 - g.i * per) / per)) ?? pen;
      }
    }

    // 官員註記：歌詞
    this.drawNote(c, t);
    // 印章本身（俯視的木頭章柄）：落下前從上面壓下來、蓋完抬起來離開，墨是在它抬起來之後才看得到的
    this.drawHandles(c, t);
    c.restore();

    // ---- 合成：鏡頭、景深、燈
    const cam = this.cam(t);
    const P = this.pass;
    P.u.layer!.value = L.upload();
    P.u.bake!.value = ensureBake(renderer);
    P.u.tone!.value = 0.84;
    // 暖黃的燈：光池在簽證章那一帶、外面很暗（夜裡）；右下角 HUD 那一塊再壓暗一點
    const fl = 1 + 0.02 * Math.sin(t * 9.1) * Math.sin(t * 5.3);
    setTableCam(P, cam, { aperture: 70, sharp: 0.02, focus: this.focusPts, lamp: [this.focusPts[0]![0] + 80, this.focusPts[0]![1] + 190, 330 * fl] });
    setLight(P, lightTint('bone', 'ember', 0.4), 0.13, 0.6);
    P.render(renderer, out);
    // 筆尖的火花（桌面座標 → 螢幕座標，跟著透視縮放）
    if (pen) {
      const p = pen as { x: number; y: number };
      const [du, dv] = toDesk(p.x, p.y);
      const q = project(cam, du, dv);
      const k = TABLE_F / q.z;
      sparkParticles(this.glow, t, () => ({ x: q.x, y: q.y }), { rate: 70, life: 0.3, speed: 160 * k, seed: this.seed });
      sparkHead(this.glow, q.x, q.y, t, 0.8 * k * K, 0.9);
    }
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
      paper: 0, bloom: 0.35, bloomThreshold: 1.4, halation: 0.05, vignette: 0.3, grain: 0.05, ca: 0.5,
      shake: [amp * (hash(ph, 5) - 0.5) * 2, amp * (hash(ph, 6) - 0.5) * 2], zoom: 1 + punch,
    };
  }

  /**
   * 舊旅行地圖（開場畫一次）：泛黃的紙、經緯線、海岸線（值雜訊的等高線當陸地）、幾個地名，
   * 地圖上壓著三張舊票根（火車、電影、渡輪）。陸地的形狀整晚共用（只算一次），顏色跟著主題。
   */
  private drawMap() {
    const res = 0.5;
    const mp = makeCanvas(MAP.w, MAP.h, res);
    const c = mp.c;
    c.fillStyle = mixRgba('paper', 'sepia', 0.32); c.fillRect(0, 0, MAP.w, MAP.h);
    // 陸地
    const land = landMask();
    c.save();
    c.globalAlpha = 0.9;
    const tmp = makeCanvas(land.width, land.height, 1);
    tmp.c.drawImage(land, 0, 0);
    tmp.c.globalCompositeOperation = 'source-in';
    tmp.c.fillStyle = mixRgba('paper', 'sepia', 0.46); tmp.c.fillRect(0, 0, land.width, land.height);
    c.imageSmoothingEnabled = true;
    c.drawImage(tmp.cv, 0, 0, MAP.w, MAP.h);
    c.restore();
    freeCanvas(tmp);
    // 經緯線
    c.strokeStyle = ink(0.12); c.lineWidth = 2;
    for (let x = 0; x < MAP.w; x += 220) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, MAP.h); c.stroke(); }
    for (let y = 0; y < MAP.h; y += 220) { c.beginPath(); c.moveTo(0, y); c.lineTo(MAP.w, y); c.stroke(); }
    // 摺痕
    c.fillStyle = ink(0.1);
    c.fillRect(MAP.w / 2 - 2, 0, 4, MAP.h); c.fillRect(0, MAP.h / 2 - 2, MAP.w, 4);
    // 地名（小、淡）
    c.fillStyle = ink(0.4); c.font = font(F.ming(700), 30); c.letterSpacing = '8px';
    PLACES.slice(0, 7).forEach(([zh], i) => { const [x, y] = mapPt(STOPS[i]!); c.fillText(zh, x + 26, y - 18); });
    c.letterSpacing = '0px';
    // 舊票根
    const stub = (x: number, y: number, r: number, a: string, b: string) => {
      c.save(); c.translate(x, y); c.rotate(r);
      c.fillStyle = ink(0.25); c.fillRect(8, 10, 360, 150);
      c.fillStyle = mixRgba('paper', 'bone', 0.3); c.fillRect(0, 0, 360, 150);
      c.fillStyle = sigInk(0.5); c.fillRect(0, 0, 360, 30);
      c.fillStyle = ink(0.75); c.font = font(F.hei(700), 30); c.fillText(a, 22, 82);
      c.fillStyle = ink(0.5); c.font = font(F.mono(500), 20); c.fillText(b, 22, 124);
      c.fillStyle = ink(0.3); for (let yy = 8; yy < 150; yy += 14) { c.beginPath(); c.arc(290, yy, 3, 0, TAU); c.fill(); }
      c.restore();
    };
    // 票根上的年份照婚禮那年往回推（幾年前一起去的）；還沒定日期就不印年份
    stub(...mapPt([1480, 700]), 0.22, '台北 → 花蓮', DATE ? `TRAIN · ${DATE.y - 5}.08.12` : 'TRAIN · SEAT 12A');
    stub(...mapPt([20, 40]), -0.12, '電影院 7 廳', DATE ? `ADMIT TWO · ${DATE.y - 7}` : 'ADMIT TWO');
    stub(...mapPt([-60, 760]), 0.16, '渡輪 · 蜜月島', 'ONE WAY → 永遠');
    return mp;
  }

  /** 地圖畫到桌上，再畫大頭針與紅線：每兩小節多一站（針在小節線上「插」下去，紅線從上一站很快地畫過去）。 */
  private drawMapLayer(c: Ctx2, t: number) {
    if (!this.map) return;
    c.save();
    c.translate(MAP.x, MAP.y); c.rotate(MAP.rot);
    c.fillStyle = rgba('ink', 0.35); c.fillRect(14, 20, MAP.w, MAP.h);
    c.drawImage(this.map.cv, 0, 0, MAP.w, MAP.h);
    c.restore();
    // 已經有的站：窗格開始前就插好的前兩站
    const shown = 2 + this.pins.filter((p) => p <= t).length;
    const lastT = [...this.pins].reverse().find((p) => p <= t) ?? -Infinity;
    const grow = ease.outCubic(clamp((t - lastT) / 0.35));
    c.save();
    c.strokeStyle = sigInk(0.85); c.lineWidth = 5; c.setLineDash([16, 10]); c.lineCap = 'round';
    for (let i = 1; i < Math.min(shown, STOPS.length); i++) {
      const [ax, ay] = STOPS[i - 1]!, [bx, by] = STOPS[i]!;
      const k = i === shown - 1 && shown > 2 ? grow : 1;
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(lerp(ax, bx, k), lerp(ay, by, k)); c.stroke();
    }
    c.setLineDash([]);
    for (let i = 0; i < Math.min(shown, STOPS.length); i++) {
      const [x, y] = STOPS[i]!;
      const pop = i === shown - 1 && shown > 2 ? 1 + 0.6 * pulse(t, lastT, 0.08) : 1;
      c.fillStyle = rgba('ink', 0.35); c.beginPath(); c.ellipse(x + 10, y + 12, 12, 6, 0.4, 0, TAU); c.fill();
      c.fillStyle = sigInk(0.95); c.beginPath(); c.arc(x, y, 12 * pop, 0, TAU); c.fill();
      c.fillStyle = rgba('bone', 0.6); c.beginPath(); c.arc(x - 4, y - 4, 4 * pop, 0, TAU); c.fill();
    }
    c.restore();
  }

  /** 鏡頭：切進來遠一點、偏右，整個窗格慢慢推近左頁；大章砸下去那一下往前衝一點點。 */
  private cam(t: number): TableCam {
    const s = this.ctx.start, e = this.ctx.end;
    const c = lerpCam(this.camA, this.camB, ease.inOutCubic(prog(t, s, e)));
    return { ...c, dist: c.dist * (1 - 0.015 * pulse(t, this.tVisa, 0.12)) };
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
    c.fillStyle = ink(0.5);
    c.font = font(F.hei(500), 16); c.letterSpacing = '4px'; c.fillText('♪ 官員註記', NOTE.x, NOTE.label - this.noteUp);
    c.letterSpacing = '0px';
    c.fillStyle = ink(0.22); c.fillRect(NOTE.x, NOTE.label - this.noteUp + 12, NOTE.maxW, 1.1);
    const ly = lyricAt(lyrics, t);
    if (ly) {
      let st = paperLyric(F.archivo(100, 800), this.lyrPx, NOTE.maxW, { minSize: V2.lyrMin / this.S });
      let lay = screenSub(c, ly.line, st, layoutLyric(c, ly.line, st), this.sNote);
      // 有原文：整塊（到原文最後一排的字腳）要在頁面下緣上面，放不下就把中文縮小一點（不小於 40 螢幕 px）；原文不縮
      const base = NOTE.base - this.noteUp, minSize = st.minSize ?? st.size;
      const bottom = (l: LyricLayout) => base + l.height - l.size + 0.25 * (l.sub?.lay.size ?? 0);
      for (let sz = st.size; lay.sub && bottom(lay) > NOTE_FLOOR && sz > minSize;) {
        sz = Math.max(minSize, sz * 0.94);
        st = { ...st, size: sz };
        lay = screenSub(c, ly.line, st, layoutLyric(c, ly.line, st), this.sNote);
      }
      const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.15));
      c.save();
      c.translate(NOTE.x, base + (1 - inK) * 16);
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
    c.font = font(F.hand(700), 40);
    c.fillText(lyrics.has ? '間奏中' : '本曲為純音樂，請自行哼唱', NOTE.x, NOTE.base - this.noteUp);
    c.restore();
  }
}

// ------------------------------------------------------------------ 章的樣子
/** 印章的章身（俯視）：木頭色的圓角方塊、側邊暗一點、中間一個圓握把（跟主題的墨色與紙色混出來）。 */
/**
 * 原文副行照「螢幕」字級重排（雙語普查時發現）：subSizeFor 的 32～56 是螢幕 px，紙在畫面上只有 S 倍大，
 * 照紙面座標排的原文上了螢幕只剩 26 px。中文不動，原文換成 subSizeFor(中文的螢幕字級) ÷ S，drawLyric 照這個排版畫。
 * 鏡頭斜斜地看著桌面，字在畫面上會被壓扁一成左右，所以原文至少排 35 螢幕 px（量起來約 31），太長就折行、不再縮。
 */
function screenSub(c: Ctx2, line: Line, st: LyricStyle, lay: LyricLayout, S: number): LyricLayout {
  const sub = lyricSubOf(line);
  if (!sub || !lay.sub) return lay;
  const size = Math.max(35, subSizeFor(lay.size * S)) / S;
  const sl = layoutLyric(c, sub, { ...subStyleFor(st, lay.size), size, minSize: size });
  const dy = lay.sub.dy - subGap(lay.size, lay.sub.lay.size) + subGap(lay.size, sl.size);
  return { ...lay, sub: { lay: sl, dy }, height: dy + (sl.height - sl.size) + lay.size };
}

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

/** 大簽證章：雙框、小小的表頭（祝福簽證）、右上角兩個交疊的圓（兩個人）、下緣的持有人。字留給承辦人寫。 */
function drawVisa(c: Ctx2, kind: 'msg' | 'invite' | 'couple') {
  const w = VISA.w, h = VISA.h, x0 = -w / 2, y0 = -h / 2;
  const col = sigInk(0.9);
  c.strokeStyle = col; c.fillStyle = col; c.lineJoin = 'round';
  c.lineWidth = 6; c.beginPath(); c.roundRect(x0 + 6, y0 + 6, w - 12, h - 12, 16); c.stroke();
  c.lineWidth = 1.8; c.beginPath(); c.roundRect(x0 + 18, y0 + 18, w - 36, h - 36, 10); c.stroke();
  // 表頭：配角，小一點
  const title = kind === 'invite' ? '候補簽證' : kind === 'couple' ? '新人簽發' : '祝福簽證';
  c.font = font(F.hei(900), 32); c.letterSpacing = '12px'; c.fillText(title, x0 + 42, y0 + 70); c.letterSpacing = '0px';
  c.fillRect(x0 + 42, y0 + 88, w - 84, 2);
  // 右上角：兩個交疊的圓（兩個人）
  const cx = x0 + w - 80, cy = y0 + 58;
  c.lineWidth = 2.2;
  c.beginPath(); c.arc(cx - 11, cy, 18, 0, TAU); c.stroke();
  c.beginPath(); c.arc(cx + 11, cy, 18, 0, TAU); c.stroke();
  // 下緣：持有人（留空，等等手寫）
  c.fillRect(x0 + 42, y0 + h - 100, w - 84, 1.6);
  c.font = font(F.hei(700), 20); c.letterSpacing = '4px';
  c.fillText('持有人', x0 + 42, y0 + h - 52);
  c.letterSpacing = '0px';
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
  if (DATE_DOT) c.fillText(DATE_DOT, 3, 60);
  c.textAlign = 'left'; c.letterSpacing = '0px';
}

/** 5×7 點陣（打孔的護照號碼用）：號碼只有數字。 */
const DOTS: Record<string, string[]> = {
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

/** 桌面座標 → 地圖畫布座標。 */
function mapPt([x, y]: [number, number]): [number, number] {
  const dx = x - MAP.x, dy = y - MAP.y, cs = Math.cos(-MAP.rot), sn = Math.sin(-MAP.rot);
  return [cs * dx - sn * dy, sn * dx + cs * dy];
}

let landCv: HTMLCanvasElement | null = null;
/** 陸地的形狀（alpha）：值雜訊的等高線，低解析度算一次、整晚共用（放大時會自動平滑，像手繪的海岸線）。 */
function landMask(): HTMLCanvasElement {
  if (landCv) return landCv;
  const w = 224, h = 124;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d')!;
  const img = c.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = fbm2(x / 38, y / 38, 4, 7) + 0.25 * Math.sin(x / 30) * Math.cos(y / 24);
    const a = clamp((v - 0.02) / 0.05);
    const i = (y * w + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = Math.round(255 * a);
  }
  c.putImageData(img, 0, 0);
  landCv = cv;
  return cv;
}

/** 皮革行李箱的內蓋：深咖啡的皮、細細的皮紋，靠邊一圈縫線。 */
const LEATHER_GLSL = /* glsl */ `
vec3 deskArt(vec2 p, vec3 desk) {
  float grain = snoise(p * 0.05) * 0.5 + snoise(p * 0.13) * 0.3;
  vec3 col = desk * (0.95 + 0.06 * grain);
  // 縫線：一圈虛線，離箱邊 60
  vec2 q = abs(p - vec2(960.0, 700.0)) - vec2(1180.0, 760.0);
  float dd = abs(max(q.x, q.y));
  float dash = step(0.5, fract((p.x + p.y) / 26.0));
  col = mix(col, C_PAPER * 0.55, (1.0 - smoothstep(1.5, 3.0, dd)) * dash * 0.6);
  return col;
}`;
