// 圖書館借書卡（亮）：一本書攤開到封底，鏡頭斜斜地看著內頁——很淡、失焦的大理石紋蝴蝶頁，上面黏著牛皮紙借書袋，
// 借書卡插在袋子裡只露出書名那一截；左邊前景是攤開的另一頁（很近、糊的），左上方一盞桌燈。
//  - 第一拍：卡片被「抽」上來（很快、一點回彈、抽的時候歪一下），鏡頭跟著往上搖、拉開一點。
//  - 接著每一拍一格：橡皮日期章「碰」地蓋一個日期，旁邊手寫借閱人（今晚其他留言的賓客，不夠就是芃芃、QQ、新郎、新娘），
//    最後一格是婚禮那天、借閱人是主打留言的人。表格是配角：小字、淡墨。窗格短就先有幾格是「以前的紀錄」。
//  - 同時「讀後心得」裡一個字一個字寫出主打留言（一兩小節內寫完）——整張卡最大、最清楚的字——寫完簽名。
//  - 之後每個小節線：鏡頭在小節線前緩緩推近一格、停住；大理石紋被梳子梳一下。
//  - 最後一個小節線：訊號色的圓章「永久續借」砸下去（畫面輕震），「借閱次數」翻成 ∞。
// 焦點：有留言時是留言（最大），歌詞在書名欄（中等、逐字跟唱）；沒有留言時歌詞寫在心得欄當主角（大），書名欄是歌名；
// 純音樂又沒留言：心得欄寫邀請。其他字（表頭、表格、借書袋）都是 ≤ 22 px 的淡字，分成三小群。
// 畫法：卡片、借書袋、日期章、圓章在 init() 畫成離屏畫布；每格在一張 fast 的 Canvas2D（頁面座標）上 drawImage 卡片、
// 畫會變的字、疊上借書袋；最後一個全螢幕 shader 用鏡頭的逆單應矩陣把「頁面」投到畫面上：大理石紋與卡片都用 mipmap 做景深、
// 加上桌燈的光與前景的書頁（見 librarycard-art.ts）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, SCALE } from '../engine/gl';
import { F, font, layout, loadText, measure } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, prog, pulse, mulberry32 } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import type { Line } from '../engine/lyrics';
import { lyricAt, drawLyric, layoutLyric, signature, COUPLE_EN, COUPLE_ZH, WEDDING_DATE, type LyricStyle } from './_motifs';
import { grid, stagger, settle, paperLyric, pad3, type Grid } from './_t2';
import {
  Book, CARD, CPAD, PULL, POCKET, PPAD, LAY, L, DATE_CELL, slotXY, canvas2d, camera, project, type Cam,
  drawCard, drawPocket, drawDateSheet, drawRoundStamp,
} from './librarycard-art';

export const spec: PlateSpecDecl = { group: 'type', family: 'doc', paper: true, energy: [0.05, 0.7], bars: [4, 8] };

const HAND = F.hand(700);
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
/** 格子數（左右兩半各四列）。 */
const SLOTS = 8;
const SEAL = 200;
/** 書名欄的歌詞（有留言時：中等）。顏色每格才取（換歌會換主題，色票是當下的值）。 */
const titleStyle = (): LyricStyle => ({ family: F.ming(700), size: 56, minSize: 52, maxWidth: L.x1 - L.x0, lineHeight: 1.12, ...paperLyric() });
/** 沒有留言時歌詞寫在心得欄當主角（大）。 */
const bigStyle = (): LyricStyle => ({ family: F.ming(700), size: 92, minSize: 60, maxWidth: L.x1 - L.x0, lineHeight: 1.16, ...paperLyric() });
/** 沒有留言時的邀請（自己斷好行：「QR code」不能拆開）。 */
const INVITE_LINES = ['你也想借閱嗎？', '掃描右下角 QR code，', '留下你的讀後心得。'];

type Mode = 'msg' | 'lyric' | 'invite';
interface Slot { date: string; name: string; t: number; nameT: number; nameDur: number; rot: number; dx: number; dy: number; size: number; main: boolean }
interface Glyph { ch: string; x: number; y: number; t: number }

export default class LibraryCard extends Scene {
  book = shared('librarycard.book', () => new Book());
  layer = this.track(new Layer2D(LAY.w, LAY.h, undefined, { fast: true }));
  card = canvas2d(CARD.w + 2 * CPAD, CARD.h + 2 * CPAD);
  pocket = canvas2d(POCKET.w + 2 * PPAD, POCKET.h + 2 * PPAD);
  dates = canvas2d(DATE_CELL.w, DATE_CELL.h * SLOTS);
  seal = canvas2d(SEAL, SEAL);
  msg: Msg | null = this.ctx.params.message ?? null;
  mode: Mode = 'msg';
  g!: Grid;
  fit: FitResult | null = null;
  glyphs: Glyph[] = [];
  sig = '';
  sigSize = 34;
  sigY = 0;
  tSig = Infinity;
  slots: Slot[] = [];
  tPull = 0;
  tFinal = -1;
  circBase = 0;
  /** 借閱次數跳一下的時間（現場蓋的章、中間的小節線）。 */
  circT: number[] = [];
  /** 鏡頭推近的小節線（每個小節線前緩緩推一格、在小節線停住）。 */
  pushBars: number[] = [];

  constructor(ctx: ConstructorParameters<typeof Scene>[0]) {
    super(ctx);
    // 卡片圖層要 mipmap：景深靠挑比較糊的層（每格上傳後 GPU 自己算，很便宜）
    this.layer.texture.generateMipmaps = true;
    this.layer.texture.minFilter = THREE.LinearMipmapLinearFilter;
  }

  override async init() {
    const { audio: au, lyrics, song, start: s, end: e } = this.ctx;
    const g = this.g = grid(au, s, e);
    const seed = this.ctx.params.seed ?? 1;
    const rnd = mulberry32(seed);
    const m = this.msg;
    const all: Msg[] = this.ctx.params.messages ?? [];
    this.mode = m ? 'msg' : lyrics.has ? 'lyric' : 'invite';

    // ---- 借閱人：其他賓客的名字（排除主打那則），不夠就用冷面的角色
    const seen = new Set<string>();
    const pool: string[] = [];
    for (const x of all) {
      if (m && x.id === m.id) continue;
      const nm = (x.name ?? '').trim();
      if (!nm || seen.has(nm) || (m && nm === m.name)) continue;
      seen.add(nm); pool.push(nm);
    }
    shuffle(pool, rnd);
    const names = pool.slice(0, SLOTS - 1);
    if (names.length < SLOTS - 1 && all.some((x) => !(x.name ?? '').trim() && (!m || x.id !== m.id))) names.push('一位賓客');
    for (const x of ['芃芃', 'QQ', '新郎', '新娘', '花童', '一位賓客']) if (names.length < SLOTS - 1) names.push(x);
    shuffle(names, rnd);
    const mainName = m ? (m.couple ? '新人' : (m.name || '一位賓客')) : '下一位：你？';

    // ---- 到期日：從種子排一串遞增的日期，最後一格是婚禮那天
    const [wy, wm, wd] = String(WEDDING_DATE).split('-').map(Number) as [number, number, number];
    const d0 = Date.UTC(2016, 8, 1), d1 = Date.UTC(wy, wm - 1, wd) - 40 * 864e5;
    const ts = Array.from({ length: SLOTS - 1 }, () => d0 + rnd() * (d1 - d0)).sort((a, b) => a - b);
    const fmt = (ms: number) => { const d = new Date(ms); return `${MON[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, '0')} ${d.getUTCFullYear()}`; };
    const dates = [...ts.map(fmt), `${MON[wm - 1]} ${String(wd).padStart(2, '0')} ${wy}`];

    const reviewLabel = m?.couple ? '作者的話' : m ? '讀後心得' : '讀後心得（徵求中）';
    const text = m ? m.text : INVITE_LINES.join('');
    this.sig = m ? signature(m.name) : '';
    await loadText(`借書卡登錄號索書號愛書名作者借閱次數到期日借閱人讀後心得作者的話徵求中本卡請勿自行塗改。續借請洽新人，恕不接受退還。圖書館請愛護圖書逾期不還，罰你幸福一輩子借期藏書永久續借無字天書間奏★∞${COUPLE_ZH}${names.join('')}${mainName}${text}${this.sig}${song.title}${song.artist}`);

    // ---- 心得欄：留言（或邀請）找字級、斷行，排好每個字的位置。留言是整張卡最大的字
    const c = this.layer.ctx;
    // 署名先量好、先把它的那一條（字高＋間距）從可用高度扣掉，留言再用剩下的高度找字級：
    // 留言再長，最後一行下面也一定放得下署名，不會疊在一起
    this.sigSize = Math.max(24, Math.min(34, (34 * 520) / Math.max(1, measure(this.sig || ' ', HAND, 34))));
    const sigBand = this.sig ? this.sigSize * 1.5 : 0;
    const areaW = L.x1 - L.x0, areaH = (this.sig ? L.rev.sigMax - sigBand : L.rev.text1) - L.rev.text0;
    let fit: FitResult;
    if (m) fit = fitText(c, text, HAND, areaW, areaH, { min: 44, max: Array.from(text).length <= 4 ? 150 : 120, lineHeight: 1.22, maxLines: 5 });
    else fit = fixedFit(INVITE_LINES, HAND, areaW, this.mode === 'invite' ? 76 : 46);
    this.fit = fit;
    const top = L.rev.text0 + (this.mode === 'lyric' ? 0 : Math.max(0, (areaH - fit.height) / 2)) + fit.size * 0.86;
    const pos: { ch: string; x: number; y: number }[] = [];
    fit.lines.forEach((ln, i) => {
      const lay = layout(ln, HAND, fit.size);
      for (const gl of lay.glyphs) if (gl.ch.trim()) pos.push({ ch: gl.ch, x: L.x0 + gl.x, y: top + i * fit.lineHeight });
    });
    // 署名：緊接在最後一行字的下緣（含下伸部、愛心）再往下一點；留言小的時候也不會離太遠
    const lastBottom = top + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.16;
    this.sigY = Math.min(L.rev.sigMax, lastBottom + 12 + this.sigSize * 0.9);

    // ---- 時間表：第一拍抽卡；下一拍起蓋章（一拍一格）、同時寫留言
    const beat = g.beat, bar = g.bar;
    this.tPull = g.b0;
    const tS0 = g.b0 + beat;
    const stampEnd = Math.max(tS0 + beat, Math.min(e - 0.6, tS0 + 2 * bar - beat));
    const avail = Math.floor((stampEnd - tS0) / beat + 1e-3) + 1;
    const live = clamp(avail, 2, SLOTS);
    const lt = stagger(au, tS0, live, stampEnd - tS0);
    // 沒有留言、歌詞當主角時，邀請只在間奏淡淡出現，不用逐字寫
    const msgT = this.mode === 'lyric' ? pos.map(() => -Infinity) : stagger(au, tS0, pos.length, clamp(Math.min(1.5 * bar, (e - tS0) * 0.45), 0.5, 1e9));
    this.glyphs = pos.map((p, i) => ({ ...p, t: msgT[i]! }));
    const msgDone = this.mode === 'lyric' ? tS0 : (msgT[msgT.length - 1] ?? tS0) + 0.15;
    this.tSig = m ? msgDone + beat * 0.5 : Infinity;
    this.slots = dates.map((date, i) => {
      const main = i === SLOTS - 1;
      const t = i < SLOTS - live ? -Infinity : lt[i - (SLOTS - live)]!;
      const per = live > 1 ? (lt[1]! - lt[0]!) : beat;
      const name = main ? mainName : names[i]!;
      // 名字太長就縮字（格子只有 300 px 寬）
      const size = Math.max(15, Math.min(21, (21 * 290) / Math.max(1, measure(name, HAND, 21))));
      return {
        date, name, t, main, size,
        nameT: t + Math.min(0.2, per * 0.45), nameDur: clamp(per * 0.8, 0.12, 0.4),
        rot: (rnd() - 0.5) * 0.07, dx: (rnd() - 0.5) * 6, dy: (rnd() - 0.5) * 3,
      };
    });
    const slotsDone = this.slots[SLOTS - 1]!.nameT + this.slots[SLOTS - 1]!.nameDur;
    // 圓章：寫完、蓋完之後的最後一個小節線（沒有就最後一個拍點）
    const after = Math.max(msgDone, slotsDone, m ? this.tSig : 0) + beat * 0.3;
    const lastBar = g.bars.filter((x) => x >= after && x <= e - 0.25).pop();
    this.tFinal = lastBar ?? g.beats.filter((x) => x >= after && x <= e - 0.25).pop() ?? -1;
    this.circBase = 100 + Math.floor(rnd() * 820);
    this.circT = [...lt, ...g.bars.filter((x) => x > slotsDone && (this.tFinal < 0 || x < this.tFinal))].sort((a, b) => a - b);
    this.pushBars = g.bars.filter((x) => x > g.b0 + beat * 1.5);

    // ---- 不會變的圖：卡片、借書袋、日期章、圓章
    drawCard(this.card.c, {
      acc: m ? pad3(m.n) : `S${pad3(song.index)}`,
      artist: song.artist || '佚名',
      reviewLabel,
      guide: this.mode === 'lyric' ? [] : fit.lines.map((_, i) => top + i * fit.lineHeight),
    }, seed);
    drawPocket(this.pocket.c, seed);
    drawDateSheet(this.dates.c, dates, mixRgba('blood', 'sepia', 0.4, 0.58), seed);
    drawRoundStamp(this.seal.c, SEAL, mixRgba('signal', 'blood', 0.4), 'RENEWED FOREVER', COUPLE_EN.toUpperCase(), ['永久', '續借'], seed);
    this.checkFrame();
  }

  /** 鏡頭：抽卡時跟著往上搖、拉開；之後每個小節線前緩緩推近一格、在小節線停住。 */
  private camAt(t: number): Cam {
    const g = this.g;
    const follow = prog(t, this.tPull - 0.04, this.tPull + Math.max(0.5, g.beat * 1.6), ease.inOutCubic);
    let push: number;
    if (this.pushBars.length) {
      const dur = Math.min(0.8, g.bar * 0.45);
      push = this.pushBars.reduce((a, x) => a + prog(t, x - dur, x, ease.inOutCubic), 0) / this.pushBars.length;
    } else push = prog(t, this.tPull + g.beat, this.ctx.end, ease.inOutCubic);
    return {
      tx: lerp(900, 930, follow) + 16 * push,
      ty: lerp(730, 500, follow) + 46 * push,
      zoom: lerp(1.0, 0.98, follow) + 0.065 * push,
      pitch: lerp(0.3, 0.23, follow) - 0.03 * push,
      yaw: lerp(-0.05, -0.03, follow) + 0.034 * push,
      roll: 0.016 - 0.012 * push,
    };
  }

  /**
   * 開發用的檢查：整個窗格裡，鏡頭會不會把歌詞、留言推到離邊 < 96 px、或進右下角 QR 區（x ≥ 1360 且 y ≥ 830）。
   * 只在瀏覽器的主控台留警告（截圖工具會印出來），不影響畫面。
   */
  private checkFrame() {
    const { start: s, end: e } = this.ctx;
    const boxes = [
      { x0: L.x0, y0: L.titleLabel, x1: L.x1, y1: L.fieldBot },
      { x0: L.x0, y0: L.rev.text0, x1: L.x1, y1: this.sig ? this.sigY : L.rev.text1 },
    ];
    for (let k = 0; k <= 12; k++) {
      const t = lerp(Math.max(s, this.tPull + this.g.beat * 2), e, k / 12);
      const Hm = camera(this.camAt(t));
      for (const b of boxes) for (const [x, y] of [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]] as const) {
        const p = project(Hm, CARD.x + x, CARD.y + y);
        if (p.x < 96 || p.x > 1824 || p.y < 96 || p.y > 984 || (p.x >= 1360 && p.y >= 830)) {
          console.warn(`librarycard: 字跑出安全範圍 (${p.x.toFixed(0)}, ${p.y.toFixed(0)}) t=${t.toFixed(2)}`);
          return;
        }
      }
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, g = this.g;
    // 抽卡：很快地抽上來、一點回彈；抽的時候卡片歪一下
    const sp = settle(t, this.tPull, 2.6, 0.68);
    const off = PULL * (1 - sp);
    const rot = -0.011 + 0.03 * (1 - sp);

    const Ly = this.layer; Ly.clear();
    const c = Ly.ctx;
    c.save();
    c.translate(-LAY.x, -LAY.y);
    c.save();
    c.translate(CARD.x + CARD.w / 2, CARD.y + CARD.h / 2 + off);
    c.rotate(rot);
    c.translate(-CARD.w / 2, -CARD.h / 2);
    c.drawImage(this.card.cv, -CPAD, -CPAD, CARD.w + 2 * CPAD, CARD.h + 2 * CPAD);
    c.textBaseline = 'alphabetic';
    this.drawTitle(c, t);
    this.drawCounter(c, t);
    this.drawSlots(c, t);
    this.drawReview(c, t);
    this.drawSeal(c, t);
    c.restore();
    c.drawImage(this.pocket.cv, POCKET.x - PPAD, POCKET.y - PPAD, POCKET.w + 2 * PPAD, POCKET.h + 2 * PPAD);
    c.restore();
    Ly.upload();

    // 鏡頭 → 合成（大理石紋、卡片、景深、桌燈、前景）
    let comb = 0;
    for (const b of g.bars) comb += prog(t, b, b + 0.6, ease.outExpo);
    const Hm = camera(this.camAt(t));
    const focus = project(Hm, CARD.x + CARD.w / 2, CARD.y + off + (L.rev.text0 + L.rev.text1) / 2);
    this.book.render(renderer, out, {
      H: Hm, zf: focus.w, card: Ly.texture, comb, t,
      cardR: [CARD.x - 10, CARD.y + off - 10, CARD.x + CARD.w + 10, POCKET.y + POCKET.h],
    });

    // 後製：蓋章的一下頂一點、圓章砸下去輕震
    let hit = 0;
    for (const sl of this.slots) if (sl.t > -1e8) hit += pulse(t, sl.t, 0.05);
    const fin = this.tFinal > 0 ? pulse(t, this.tFinal, 0.09) : 0;
    return {
      paper: 1, bloom: 0.12, bloomThreshold: 0.97, halation: 0.06, vignette: 0.34, grain: 0.05,
      zoom: 1 + 0.0025 * Math.min(1, hit) + 0.01 * fin,
      shake: [fin * 4 * Math.sin(t * 97), fin * 5 * Math.sin(t * 131 + 1)],
    };
  }

  /** 歌名（書名欄的小字，不是焦點）：襯線、淡；純音樂加一句（無字天書）。 */
  private drawSongTitle(c: CanvasRenderingContext2D, alpha: number) {
    const { lyrics, song } = this.ctx;
    const fam = F.ming(700);
    const title = song.title || '今晚的歌';
    const size = Math.min(32, Math.max(20, (32 * 700) / Math.max(1, measure(title, fam, 32))));
    c.save();
    c.globalAlpha = alpha;
    c.font = font(fam, size); c.fillStyle = rgba('sepia', 0.62);
    const y = (L.titleLabel + L.fieldBot) / 2 + size * 0.36;
    c.fillText(title, L.x0, y);
    const w = measure(title, fam, size);
    c.font = font(F.hei(500), 16); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.42);
    c.fillText(!lyrics.has ? '（無字天書）INSTRUMENTAL' : this.mode === 'msg' ? '♪ 間奏中' : '♪ 今晚的歌', L.x0 + w + 20, y);
    c.letterSpacing = '0px';
    c.restore();
  }

  /** 書名欄：有留言時是正在唱的那句（中等，跟唱）；沒有留言時歌詞寫在心得欄，這裡只放歌名。 */
  private drawTitle(c: CanvasRenderingContext2D, t: number) {
    const { lyrics } = this.ctx;
    if (this.mode !== 'msg') { this.drawSongTitle(c, 1); return; }
    const ly = lyrics.has ? lyricAt(lyrics, t) : null;
    if (ly && ly.k > 0) this.drawLyricIn(c, ly.line, t, ly.k, titleStyle(), L.titleLabel + 4, L.fieldBot - 8);
    const k = this.gapAlpha(t);
    if (k > 0) this.drawSongTitle(c, k);
  }

  /** 在 [y0, y1] 之間垂直置中畫一句跟唱的歌詞（一行或兩行）。 */
  private drawLyricIn(c: CanvasRenderingContext2D, line: Line, t: number, k: number, st: LyricStyle, y0: number, y1: number) {
    const lay = layoutLyric(c, line, st);
    const lh = lay.rows.length > 1 ? lay.rows[1]!.y : 0;
    const blockH = lay.size * 0.95 + lh;
    c.save();
    c.translate(L.x0, y0 + (y1 - y0 - blockH) / 2 + lay.size * 0.8);
    drawLyric(c, line, t, st, lay, k);
    c.restore();
  }

  /** 間奏時的東西（歌名、邀請）的透明度：歌詞行淡出之後才淡入，下一行要出現之前先淡出，兩個不會疊在一起。 */
  private gapAlpha(t: number): number {
    const { lyrics } = this.ctx;
    if (!lyrics.has) return 1;
    if (lyrics.shownLine(t, 1.2, 0.35)) return 0;
    const last = lyrics.lastLine(t), next = lyrics.nextLine(t);
    let a = last ? prog(t, last.end + 1.2, last.end + 1.5) : 1;
    if (next) a *= 1 - prog(t, next.start - 0.65, next.start - 0.36);
    return a;
  }

  /** 借閱次數（表格右上角的小字）：現場蓋章、中間的小節線各跳一格；圓章蓋下去變成 ∞。 */
  private drawCounter(c: CanvasRenderingContext2D, t: number) {
    const x = L.x1, y = L.thead;
    c.save();
    c.textAlign = 'right';
    c.font = font(F.mono(500), 14); c.letterSpacing = '2px';
    c.fillStyle = rgba('sepia', 0.5);
    if (this.tFinal > 0 && t >= this.tFinal) {
      const u = prog(t, this.tFinal, this.tFinal + 0.14, ease.outExpo);
      c.fillText('CIRC.', x - 34, y);
      c.font = font(F.serif(600), 26); c.globalAlpha = u; c.fillStyle = rgba('blood', 0.85);
      c.fillText('∞', x, y + 3 - 6 * (1 - u));
    } else {
      let n = 0, last = -Infinity;
      for (const x2 of this.circT) if (x2 <= t) { n++; last = x2; }
      const u = prog(t, last, last + 0.12, ease.outExpo);
      c.fillText('CIRC.', x - 52, y);
      c.beginPath(); c.rect(x - 50, y - 16, 54, 22); c.clip();
      c.fillText(String(this.circBase + n).padStart(4, '0'), x, y + 12 * (1 - u));
      if (u < 1) { c.globalAlpha = 1 - u; c.fillText(String(this.circBase + n - 1).padStart(4, '0'), x, y - 14 * u); }
    }
    c.restore();
  }

  /** 日期章與借閱人：章「碰」地蓋上（從大一點壓下來），名字接著手寫（由左往右寫出來）。都是配角：小、淡。 */
  private drawSlots(c: CanvasRenderingContext2D, t: number) {
    const cw = DATE_CELL.w, ch = DATE_CELL.h;
    this.slots.forEach((sl, i) => {
      if (t < sl.t) return;
      const p = slotXY(i);
      const u = sl.t < -1e8 ? 1 : prog(t, sl.t, sl.t + 0.09, ease.outExpo);
      const sc = lerp(1.25, 1, u);
      c.save();
      c.translate(p.x + 8 + cw / 2 + sl.dx, p.base - 6 + sl.dy);
      c.rotate(sl.rot); c.scale(sc, sc);
      c.globalAlpha = clamp(u * 1.8);
      c.globalCompositeOperation = 'multiply';
      c.drawImage(this.dates.cv, 0, i * ch * SCALE, cw * SCALE, ch * SCALE, -cw / 2, -21, cw, ch);
      c.restore();
      const nu = sl.t < -1e8 ? 1 : prog(t, sl.nameT, sl.nameT + sl.nameDur, ease.outCubic);
      if (nu <= 0) return;
      const nx = p.x + L.dateW + 12;
      c.save();
      c.font = font(HAND, sl.size);
      const w = c.measureText(sl.name).width;
      c.beginPath(); c.rect(nx - 6, p.y + 1, (w + 12) * nu, L.rowH - 2); c.clip();
      c.translate(nx, p.base); c.rotate(sl.rot * 0.4);
      c.fillStyle = sl.main ? rgba('blood', 0.85) : rgba('sepia', 0.62);
      c.fillText(sl.name, 0, 0);
      c.restore();
    });
  }

  /**
   * 心得欄（主角）：有留言時一個字一個字寫出來（剛寫的字是濕的，訊號色的暗部，半秒內乾成墨色），寫完簽名；
   * 沒有留言時是正在唱的歌詞（大，跟唱），間奏時淡淡寫著邀請；純音樂又沒留言：寫邀請。
   */
  private drawReview(c: CanvasRenderingContext2D, t: number) {
    const fit = this.fit;
    if (!fit) return;
    if (this.mode === 'lyric') {
      const ly = lyricAt(this.ctx.lyrics, t);
      if (ly && ly.k > 0) this.drawLyricIn(c, ly.line, t, ly.k, bigStyle(), L.rev.text0, L.rev.text1);
      const k = this.gapAlpha(t);
      if (k > 0) {
        c.save();
        c.globalAlpha = k * 0.75;
        c.font = font(HAND, fit.size); c.fillStyle = rgba('sepia', 0.9);
        const top = L.rev.text0 + (L.rev.text1 - L.rev.text0 - fit.height) / 2 + fit.size * 0.86;
        fit.lines.forEach((ln, i) => c.fillText(ln, L.x0, top + i * fit.lineHeight));
        c.restore();
      }
      return;
    }
    c.save();
    c.font = font(HAND, fit.size);
    for (const gl of this.glyphs) {
      if (t < gl.t) break;
      const a = prog(t, gl.t, gl.t + 0.1);
      const wet = 1 - prog(t, gl.t + 0.1, gl.t + 0.6);
      c.globalAlpha = a;
      c.fillStyle = gl.ch === '♥' ? rgba('rose') : wet > 0.01 ? mixRgba('sepia', 'blood', wet, 0.96) : rgba('sepia', 0.96);
      c.fillText(gl.ch, gl.x, gl.y + 4 * (1 - a));
    }
    if (t >= this.tSig && this.sig) {
      const u = prog(t, this.tSig, this.tSig + 0.5, ease.outCubic);
      c.font = font(HAND, this.sigSize);
      const w = c.measureText(this.sig).width;
      c.globalAlpha = 1;
      c.beginPath(); c.rect(L.x1 - w - 6, this.sigY - this.sigSize, (w + 12) * u, this.sigSize * 1.5); c.clip();
      c.fillStyle = rgba('sepia', 0.8);
      c.fillText(this.sig, L.x1 - w, this.sigY);
    }
    c.restore();
  }

  /** 圓章「永久續借」：從很大、很高的地方砸下來（outExpo），印泥 multiply 疊在卡上。 */
  private drawSeal(c: CanvasRenderingContext2D, t: number) {
    if (this.tFinal < 0 || t < this.tFinal - 0.06) return;
    const u = prog(t, this.tFinal - 0.06, this.tFinal, ease.inCubic);
    const land = prog(t, this.tFinal, this.tFinal + 0.12, ease.outExpo);
    const sc = t < this.tFinal ? lerp(1.9, 1.04, u) : lerp(1.04, 1, land);
    c.save();
    c.translate(L.seal.x, L.seal.y);
    c.rotate(L.seal.rot + (1 - land) * 0.05);
    c.scale(sc, sc);
    if (t < this.tFinal) {
      // 還沒碰到紙：只有章落下來的影子
      c.globalAlpha = 0.16 * u;
      c.fillStyle = rgba('sepia');
      c.beginPath(); c.arc(8, 12, SEAL / 2 - 6, 0, Math.PI * 2); c.fill();
    } else {
      c.globalCompositeOperation = 'multiply';
      c.globalAlpha = 0.8;
      c.drawImage(this.seal.cv, -SEAL / 2, -SEAL / 2, SEAL, SEAL);
    }
    c.restore();
  }

  override dispose() {
    for (const x of [this.card, this.pocket, this.dates, this.seal]) x.cv.width = x.cv.height = 0;
    super.dispose();
  }
}

/** 已經斷好的幾行：找放得下最寬那一行的字級（不超過 max）。 */
function fixedFit(lines: string[], family: string, w: number, max: number): FitResult {
  const size = Math.floor(Math.min(max, ...lines.map((l) => (max * w) / Math.max(1, measure(l, family, max)))));
  return { size, lines, lineHeight: size * 1.22, width: Math.max(...lines.map((l) => measure(l, family, size))), height: size * (1 + (lines.length - 1) * 1.22) };
}

function shuffle<T>(a: T[], rnd: () => number) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
}
