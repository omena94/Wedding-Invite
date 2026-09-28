// 登機證（亮版面）：「FLIGHT AO0313 → 永遠」。一張登機證被「遞過櫃檯」滑到桌面上，接著像感熱印表機一樣把資料印上去：
//  - 切進來：登機證從右邊滑進來、在第一個拍點停住（一點點回彈）。桌面上是淡淡的航線圖（shader 畫的虛線大圓航線）。
//  - 第一個拍點起：乘客姓名（= 留言署名）十六分音符一個字打上去，座位、登機門跟著「印」出來；
//    主打留言一拍一行印在「祝福 MESSAGE」欄：列印頭由左往右掃過去，剛印好的字是熱的（紙上的訊號色），約一秒冷卻成墨色。
//  - 航程：FROM「TPE 相遇」到 TO「∞ 永遠」之間是一條虛線弧，小飛機每一拍往前跳一格（整個窗格飛完全程），飛過的虛線變訊號色。
//  - 留言印好的下一拍：掃描器的紅光掃過票根上的條碼，再下一拍「已登機 BOARDED」章砸下去（畫面震一下）。
//  - 之後的小節線：票根沿著齒孔撕下來（撕開的邊是鋸齒的、票根歪歪地掉到旁邊），這一下是整個窗格的重拍。
// 歌詞是「登機廣播」：桌面下方一條廣播字幕，喇叭的聲波跟著人聲跳，歌詞照跟唱規則逐字亮。
// 沒有留言：乘客是「全體賓客」、祝福欄印邀請，章改蓋「候補 STANDBY」。新人的留言：乘客是新人、欄位叫「機長的話」。
// 畫法：登機證本身（不會變的字、框、條碼）開場時畫在一張 1.5 倍的離屏畫布上，每格只 drawImage 兩次（主票、票根，
// 用鋸齒的剪裁路徑分開）；會變的字直接畫在同一層；桌面、紙纖維、航線圖在 _t1 的紙 shader 裡。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { F, font, layout, loadText, measure, type TextLayout } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog, pulse, frameIdx } from '../engine/util';
import type { FitResult } from '../engine/text';
import { lyricAt, drawLyric, layoutLyric, beatAfter, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { WEDDING_TIME_FROM } from '../../constants.js';
import { sigInk, ink, paper, heatInk, paperLyric, makeCanvas, freeCanvas, shadowSprite, drawShadow, drawBarcode, beatsIn, barsIn, xfRect, paperPass, ensureBake, themeKey, fitMsg, yieldFrame, type Rect } from './_t1';

export const spec: PlateSpecDecl = { group: 'type', family: 'doc', paper: true, energy: [0.2, 0.85], bars: [4, 8], weight: 1 };

type Ctx2 = CanvasRenderingContext2D;

/** 登機證（紙面座標）：主票 0..PERF、票根 PERF..PASS.w。 */
const PASS = { w: 1460, h: 600 };
const PERF = 1090;
const BAND = 84;
/** 放好之後在螢幕上的位置（中心）與角度。 */
const REST = { x: 905, y: 418, rot: -0.036 };
/** 祝福欄（紙面座標）。 */
const MSG = { x: 36, y: 390, w: 1020, h: 172 };
/** 乘客姓名、航程列（紙面座標）。 */
const NAME = { x: 36, base: 176, w: 560 };
const ROUTE = { from: 36, to: 812, base: 318, arcY: 262 };
/** 廣播字幕（螢幕座標）：喇叭在左、歌詞在右；右端停在 x = 1330（右下角是 QR 區）。 */
const PA = { x: 238, base: 900, maxW: 1090, label: 812 };

const PASS_TEXT = '登機證愛情航空乘客姓名航班日期出發目的地相遇的地方永遠祝福機長的話座位登機門組別登機時間已登機候補全體賓客一位賓客票根請於起飛前登機本登機證僅限本人一輩子有效頭等艙廣播間奏中請旅客耐心等候本班機全程播放純音樂請旅客留意登機廣播掃描右下角把祝福寫上大螢幕新人';

interface PChar { ch: string; x: number; y: number; w: number; row: number }

export default class Boarding extends Scene {
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  pass = shared('boarding.paper', () => paperPass(DESK_GLSL, { prog: { value: 0 } }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = Number(this.ctx.params.seed ?? 1);
  art: ReturnType<typeof makeCanvas> | null = null;
  artKey = '';
  shMain = shadowSprite(PERF, PASS.h, 16, 10);
  shStub = shadowSprite(PASS.w - PERF, PASS.h, 16, 10);
  /** 齒孔的鋸齒線（紙面座標，從上到下）。 */
  tear: { x: number; y: number }[] = [];

  // 內容
  name = '';
  nameLay!: TextLayout;
  nameFam = F.hei(700);
  fit: FitResult | null = null;
  msgFam = F.hand(700);
  chars: PChar[] = [];
  isInvite = false;
  seat = '13A';

  // 時間（秒）
  B = 0.5;
  land = 0;
  b0 = 0;
  nameT: number[] = [];
  /** 每一行留言開始印、印完的時間。 */
  rowT: [number, number][] = [];
  printEnd = 0;
  tScan = Infinity;
  tStamp = Infinity;
  tTear = Infinity;
  beats: number[] = [];
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, start: s, end: e } = this.ctx;
    const m = this.msg;
    this.isInvite = !m;
    this.name = m ? (m.couple ? COUPLE_ZH : m.name || '一位賓客') : '全體賓客 ALL GUESTS';
    const body = m ? m.text : '掃描右下角 QR code，把祝福寫上大螢幕。';
    const n = m?.n ?? 0;
    this.seat = m?.couple ? '1A' : `${((n * 7) % 38) + 2}${'ABCDEF'[n % 6]}`;
    await loadText(PASS_TEXT + this.name + body + COUPLE_ZH + lyrics.linesIn(s - 2, e + 1).map((l) => l.text).join(''));

    await yieldFrame();
    const c = this.layer.ctx;
    // ---- 排版：姓名（拉丁字用等寬、大寫；中文用黑體）
    const latin = /^[\x20-\x7E]+$/.test(this.name);
    this.nameFam = latin ? F.mono(600) : F.hei(700);
    const nameText = latin ? this.name.toUpperCase() : this.name;
    let ns = 46;
    while (ns > 26 && measure(nameText, this.nameFam, ns) > NAME.w) ns -= 2;
    this.nameLay = layout(nameText, this.nameFam, ns);
    // ---- 祝福欄：最大字級、平衡斷行（最多三行，60 字在 44px 也放得下）
    this.fit = fitMsg(c, body, this.msgFam, MSG.w, MSG.h, { min: 44, max: m ? 104 : 64, lineHeight: 1.28, maxLines: 3 });
    const fit = this.fit;
    const top = MSG.y + (MSG.h - fit.height) / 2 + fit.size * 0.86;
    this.chars = [];
    fit.lines.forEach((ln, row) => {
      const lay = layout(ln, this.msgFam, fit.size);
      for (const g of lay.glyphs) this.chars.push({ ch: g.ch, x: MSG.x + g.x, y: top + row * fit.lineHeight, w: g.w, row });
    });

    // ---- 時間表
    const B = (this.B = au.beatPeriod(s + 0.1));
    this.land = beatAfter(au, s + Math.min(0.42, 0.3 + B * 0.2));
    this.b0 = this.land;
    const nameStep = clamp(1.2 * B / Math.max(1, this.nameLay.glyphs.length), 0.03, B / 4);
    this.nameT = this.nameLay.glyphs.map((_, i) => this.b0 + B / 2 + i * nameStep);
    const nameEnd = this.nameT[this.nameT.length - 1] ?? this.b0;
    // 留言：姓名印完的下一拍開始，一拍一行（短窗格就半拍一行）
    const room = e - s;
    const per = room < 6 ? B / 2 : B;
    const r0 = beatAfter(au, nameEnd + 0.05);
    this.rowT = fit.lines.map((_, i) => [r0 + i * per, r0 + i * per + Math.min(per * 0.8, 0.55)]);
    this.printEnd = this.rowT[this.rowT.length - 1]![1];
    // 掃描、蓋章、撕票根：各在自己的拍點，窗格太短就省掉
    const scan = beatAfter(au, this.printEnd + 0.05);
    if (scan < e - 1.6 * B) { this.tScan = scan; this.tStamp = beatAfter(au, scan + 0.1); }
    const after = isFinite(this.tStamp) ? this.tStamp + 1.5 * B : this.printEnd + B;
    const bars = barsIn(au, after, e - 0.9 * B);
    if (bars.length) this.tTear = bars.length > 2 ? bars[Math.min(bars.length - 1, 1)]! : bars[0]!;
    else if (e - after > B) this.tTear = beatAfter(au, after);
    this.beats = beatsIn(au, this.land, e);

    // ---- 齒孔撕開的鋸齒線：經過每個孔的中心，孔與孔之間歪一點
    const holes = Math.floor((PASS.h - 20) / 18);
    this.tear = [{ x: PERF, y: -2 }];
    for (let i = 0; i <= holes; i++) {
      const y = 10 + i * 18;
      this.tear.push({ x: PERF + (hash(this.seed, i, 5) - 0.5) * 3, y });
      this.tear.push({ x: PERF + (hash(this.seed, i, 6) - 0.5) * 7, y: y + 9 });
    }
    this.tear.push({ x: PERF, y: PASS.h + 2 });
    await yieldFrame();
    this.drawArt();

    // 即時小卡要避開：姓名與祝福欄（放好之後的位置）、廣播字幕
    const X = REST.x - (PASS.w / 2) * Math.cos(REST.rot) + (PASS.h / 2) * Math.sin(REST.rot);
    const Y = REST.y - (PASS.w / 2) * Math.sin(REST.rot) - (PASS.h / 2) * Math.cos(REST.rot);
    this.avoid = [
      xfRect([NAME.x - 10, 100, NAME.w + 20, 100], X, Y, REST.rot),
      xfRect([MSG.x - 10, MSG.y - 30, MSG.w + 20, MSG.h + 40], X, Y, REST.rot),
      [PA.x - 110, PA.label - 30, PA.maxW + 130, 210],
    ];
  }

  override dispose() { freeCanvas(this.art); this.art = null; freeCanvas(this.shMain); freeCanvas(this.shStub); super.dispose(); }

  /** 登機證上不會變的東西（框、標題、欄位名稱、條碼、齒孔）。主題換了就重畫。 */
  private drawArt() {
    this.artKey = themeKey();
    freeCanvas(this.art);
    const a = (this.art = makeCanvas(PASS.w, PASS.h, 1.5));
    const c = a.c;
    const m = this.msg;
    // 紙
    c.fillStyle = paper();
    c.beginPath(); c.roundRect(0, 0, PASS.w, PASS.h, 14); c.fill();
    // 表頭色帶（墨色實底、字反白）
    c.save();
    c.beginPath(); c.roundRect(0, 0, PASS.w, PASS.h, 14); c.clip();
    c.fillStyle = ink(0.94); c.fillRect(0, 0, PASS.w, BAND);
    c.restore();
    c.fillStyle = paper();
    c.font = font(F.archivo(125, 900), 38); c.fillText('BOARDING PASS', 36, 56);
    const bw = measure('BOARDING PASS', F.archivo(125, 900), 38);
    c.font = font(F.hei(700), 26); c.letterSpacing = '10px'; c.fillText('登機證', 36 + bw + 26, 55); c.letterSpacing = '0px';
    c.textAlign = 'right';
    c.font = font(F.mono(600), 14); c.letterSpacing = '4px'; c.fillText('A&O AIR · 愛情航空', PERF - 36, 36);
    c.font = font(F.mono(400), 13); c.fillStyle = paper(0.75); c.fillText('FIRST CLASS · 頭等艙 · 一輩子有效', PERF - 36, 62);
    c.textAlign = 'left'; c.letterSpacing = '0px';
    // 票根的表頭
    c.fillStyle = paper();
    c.font = font(F.hei(700), 22); c.letterSpacing = '8px'; c.fillText('登機證', PERF + 30, 46); c.letterSpacing = '0px';
    c.font = font(F.mono(500), 12); c.letterSpacing = '4px'; c.fillStyle = paper(0.75); c.fillText('STUB · 票根', PERF + 30, 68); c.letterSpacing = '0px';

    const label = (zh: string, en: string, x: number, y: number) => {
      c.fillStyle = ink(0.62);
      c.font = font(F.hei(500), 14); c.letterSpacing = '3px'; c.fillText(zh, x, y);
      const w = measure(zh, F.hei(500), 14, 3);
      c.font = font(F.mono(500), 11); c.letterSpacing = '2px'; c.fillText(en, x + w + 10, y);
      c.letterSpacing = '0px';
    };
    // 第一列：乘客、航班、日期
    label('乘客姓名', 'PASSENGER', NAME.x, 122);
    c.fillStyle = ink(0.25); c.fillRect(NAME.x, NAME.base + 14, NAME.w, 1.2);
    label('航班', 'FLIGHT', 640, 122);
    c.fillStyle = ink(0.95); c.font = font(F.archivo(100, 800), 44); c.fillText('AO 0313', 640, NAME.base);
    label('日期', 'DATE', 876, 122);
    const [yy, mm, dd] = DATE_DOTS.split(' · ');
    const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][Number(mm) - 1] ?? 'MAR';
    c.font = font(F.mono(600), 30); c.fillText(`${dd}${MON}${(yy ?? '27').slice(-2)}`, 876, NAME.base - 4);
    // 第二列：航程（大字機場代碼）
    label('出發', 'FROM · 相遇的地方', ROUTE.from, 214);
    c.fillStyle = ink(0.95);
    c.font = font(F.archivo(125, 900), 96); c.fillText('TPE', ROUTE.from - 4, ROUTE.base);
    label('目的地', 'TO · 永遠', ROUTE.to, 214);
    c.font = font(F.serif(600), 132); c.fillText('∞', ROUTE.to - 6, ROUTE.base + 6);
    // 航程右邊：登機、起飛時間
    label('登機', 'BOARDING', 960, 214);
    const [hh = '12', mi = '00'] = String(WEDDING_TIME_FROM).split(':');
    const board = `${String(Number(hh) - 1).padStart(2, '0')}:${String((Number(mi) + 30) % 60).padStart(2, '0')}`;
    c.font = font(F.mono(600), 34); c.fillStyle = ink(0.95); c.fillText(board, 960, 266);
    label('起飛', 'DEPARTS', 960, 296);
    c.font = font(F.mono(600), 26); c.fillText(`${hh}:${mi}`, 960, 330);
    // 分隔線與祝福欄的標題
    c.fillStyle = ink(0.8); c.fillRect(36, 350, PERF - 72, 1.6);
    if (m?.couple) label('機長的話', 'FROM THE CAPTAINS · 新人', MSG.x, 378);
    else label('祝福', m ? 'MESSAGE · 旅客留言' : 'MESSAGE · 候補中', MSG.x, 378);
    // 左下角的小字（冷面註腳）
    c.fillStyle = ink(0.5); c.font = font(F.hei(500), 13); c.letterSpacing = '1px';
    c.fillText('＊本登機證限本人使用，一經登機，恕不退票。', 36, PASS.h - 11);
    c.letterSpacing = '0px';

    // 票根
    const sx = PERF + 30;
    label('乘客', 'NAME', sx, 118);
    label('座位', 'SEAT', sx, 190);
    c.fillStyle = ink(0.95); c.font = font(F.archivo(125, 900), 104); c.fillText(this.seat, sx - 4, 290);
    label('登機門', 'GATE', sx, 322);
    c.font = font(F.archivo(100, 800), 40); c.fillText('13', sx, 364);
    label('組別', 'ZONE', sx + 150, 322);
    c.font = font(F.archivo(100, 800), 40); c.fillText('1', sx + 150, 364);
    // 登機章的虛線框（等一下章會蓋在這裡，稍微超出框線）
    c.strokeStyle = ink(0.35); c.lineWidth = 1.2; c.setLineDash([6, 5]);
    c.beginPath(); c.roundRect(sx - 4, 382, PASS.w - sx - 26, 86, 8); c.stroke(); c.setLineDash([]);
    c.fillStyle = ink(0.4); c.font = font(F.hei(500), 13); c.letterSpacing = '3px'; c.fillText('登機章', sx + 6, 402);
    c.font = font(F.mono(500), 10); c.fillText('STAMP HERE', sx + 6, 418); c.letterSpacing = '0px';
    drawBarcode(c, sx, 488, PASS.w - sx - 30, 62, this.seed);
    c.font = font(F.mono(500), 11); c.letterSpacing = '2px'; c.fillStyle = ink(0.6);
    c.fillText(`AO0313 · ${DATE_DOTS.split(' · ').join('')} · ${m ? 'No.' + String(m.n).padStart(3, '0') : 'STANDBY'}`, sx, PASS.h - 30);
    c.letterSpacing = '0px';

    // 齒孔：挖空（看得到底下的桌面）
    c.save();
    c.globalCompositeOperation = 'destination-out';
    for (let y = 10; y < PASS.h - 6; y += 18) { c.beginPath(); c.arc(PERF, y, 3.6, 0, Math.PI * 2); c.fill(); }
    c.restore();
    c.fillStyle = ink(0.18);
    for (let y = 19; y < PASS.h - 6; y += 18) c.fillRect(PERF - 0.5, y - 2, 1, 4);
  }

  // ------------------------------------------------------------------ 位置
  /** 主票的位置：從右邊滑進來、在落點停住（一點回彈）；最後一拍輕輕往前推。 */
  private mainXf(t: number) {
    const s = this.ctx.start;
    const k = prog(t, s, this.land, (x) => ease.outBack(x, 0.9));
    const kk = prog(t, s, this.land, ease.outCubic);
    const x = lerp(REST.x + 1350, REST.x, k), y = lerp(REST.y + 60, REST.y, kk);
    const rot = lerp(-0.2, REST.rot, kk);
    // 大鼓讓紙在桌上輕輕跳一下（很小）；蓋章那一下壓下去
    const kick = this.ctx.audio.hit('kick', t, 0.1);
    const press = pulse(t, this.tStamp, 0.06);
    return { x, y: y - 2.5 * kick + 3 * press, rot, s: 1 - 0.006 * press };
  }
  /** 票根：撕下來之後歪歪地掉到右下（彈簧落定）。 */
  private stubXf(t: number, mx: ReturnType<Boarding['mainXf']>) {
    const k = t >= this.tTear ? clamp(ease.outBack(clamp((t - this.tTear) / 0.42), 1.4)) : 0;
    const lift = t >= this.tTear ? Math.sin(Math.PI * clamp((t - this.tTear) / 0.42)) : 0;
    return { dx: 64 * k, dy: 58 * k - 16 * lift, rot: 0.12 * k };
  }

  /** 從主票的紙面座標換到票根的紙面座標（繞齒孔中點轉）。 */
  private stubSpace(c: Ctx2, st: ReturnType<Boarding['stubXf']>) {
    c.translate(PERF + st.dx, PASS.h / 2 + st.dy); c.rotate(st.rot); c.translate(-PERF, -PASS.h / 2);
  }

  // ------------------------------------------------------------------ 畫
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    if (this.artKey !== themeKey()) this.drawArt();
    const L = this.layer;
    L.clear();
    const c = L.ctx;
    const fadeIn = prog(t, s, s + 0.25);
    c.globalAlpha = 1;

    // ---- 廣播字幕（桌面上，螢幕座標）
    this.drawPA(c, t, fadeIn);

    // ---- 登機證
    const mx = this.mainXf(t);
    const st = this.stubXf(t, mx);
    const X = -PASS.w / 2, Y = -PASS.h / 2;
    c.save();
    c.translate(mx.x, mx.y); c.rotate(mx.rot); c.scale(mx.s, mx.s); c.translate(X, Y);
    // 陰影（滑動時陰影拉長一點，像離桌面比較高；票根撕下來之後陰影也拉開一點）
    const air = 1 - prog(t, s, this.land, ease.outCubic);
    const lift = clamp((t - this.tTear) / 0.3);
    drawShadow(c, this.shMain, 8 + 20 * air, 14 + 26 * air, 0.28 - 0.08 * air);
    c.save();
    this.stubSpace(c, st);
    c.translate(PERF, 0);
    drawShadow(c, this.shStub, 8 + 20 * air + 6 * lift, 14 + 26 * air + 8 * lift, 0.28 - 0.08 * air);
    c.restore();
    // 主票（剪到鋸齒線的左邊）
    const art = this.art!;
    c.save();
    c.beginPath(); c.moveTo(-4, -4);
    for (const p of this.tear) c.lineTo(p.x, p.y);
    c.lineTo(-4, PASS.h + 4); c.closePath(); c.clip();
    c.drawImage(art.cv, 0, 0, PASS.w, PASS.h);
    this.drawMain(c, t);
    c.restore();
    // 票根（剪到鋸齒線的右邊，撕下來之後自己一個變換）
    c.save();
    this.stubSpace(c, st);
    c.beginPath(); c.moveTo(PASS.w + 4, -4);
    for (const p of this.tear) c.lineTo(p.x, p.y);
    c.lineTo(PASS.w + 4, PASS.h + 4); c.closePath(); c.clip();
    c.drawImage(art.cv, 0, 0, PASS.w, PASS.h);
    this.drawStub(c, t);
    c.restore();
    c.restore();

    // ---- 合成
    const P = this.pass.u;
    P.layer!.value = L.upload();
    P.bake!.value = ensureBake(renderer);
    P.tone!.value = 0.12;
    P.t!.value = t;
    P.prog!.value = this.flight(t);
    this.pass.render(renderer, out);
    // 撕票根、蓋章：畫面震一下（方向用逐格的 hash，確定性）
    const amp = 9 * pulse(t, this.tTear, 0.07) + 6 * pulse(t, this.tStamp, 0.06);
    const ph = frameIdx(t);
    return {
      paper: 1, popupAvoid: this.avoid, bloom: 0.2, bloomThreshold: 1.6, halation: 0.04, vignette: 0.22, grain: 0.045, ca: 0.4,
      shake: [amp * (hash(ph, 3) - 0.5) * 2, amp * (hash(ph, 4) - 0.5) * 2],
      zoom: 1 + 0.02 * prog(t, e - 1.2, e, ease.inCubic) + 0.012 * pulse(t, this.tTear, 0.1),
    };
  }

  /** 航程進度（0..1）：每一拍往前跳一格（很短的緩動），整個窗格飛完。 */
  private flight(t: number) {
    const n = this.beats.length;
    if (!n || t < this.land) return 0;
    let i = 0;
    while (i < n && this.beats[i]! <= t) i++;
    const cur = this.beats[i - 1] ?? this.land;
    const step = ease.outExpo(clamp((t - cur) / 0.16));
    return clamp((i - 1 + step) / Math.max(1, n - 1));
  }

  /** 主票上會變的：姓名、航線上的小飛機、祝福欄。 */
  private drawMain(c: Ctx2, t: number) {
    // 姓名：一個字一個十六分音符印上去（剛印好的字是熱的）
    c.font = font(this.nameFam, this.nameLay.size);
    this.nameLay.glyphs.forEach((g, i) => {
      const ti = this.nameT[i]!;
      if (t < ti) return;
      c.fillStyle = heatInk(1 - clamp((t - ti) / 0.8));
      c.fillText(g.ch, NAME.x + g.x, NAME.base);
    });
    // 航線：TPE → ∞ 之間的虛線弧，飛過的部分是訊號色，小飛機每一拍跳一格
    const p = this.flight(t);
    const ax = 290, bx = ROUTE.to - 34, ay = ROUTE.arcY + 30, peak = ROUTE.arcY - 34;
    const at = (u: number) => ({ x: lerp(ax, bx, u), y: ay + 4 * (peak - ay) * u * (1 - u) });
    const N = 44;
    for (let i = 0; i < N; i++) {
      const u0 = i / N, u1 = (i + 0.5) / N;
      const a = at(u0), b = at(u1);
      c.strokeStyle = u1 <= p ? sigInk(0.95) : ink(0.3);
      c.lineWidth = u1 <= p ? 3 : 2;
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    }
    const q = at(p), q2 = at(Math.min(1, p + 0.01));
    const ang = Math.atan2(q2.y - q.y, q2.x - q.x);
    drawPlane(c, q.x, q.y, ang, 1.15, sigInk());
    // 祝福欄：一拍一行，列印頭由左往右掃過（掃過的地方字就出現），剛印好的字是熱的
    if (!this.fit) return;
    c.font = font(this.msgFam, this.fit.size);
    for (const ch of this.chars) {
      const [r0, r1] = this.rowT[ch.row]!;
      if (t < r0) continue;
      const u = clamp((t - r0) / (r1 - r0));
      const lineW = MSG.w;
      const head = MSG.x + u * (lineW + 40);
      if (ch.x > head) continue;
      const tPrinted = r0 + ((ch.x - MSG.x) / (lineW + 40)) * (r1 - r0);
      const heat = 1 - clamp((t - tPrinted) / 0.9);
      c.fillStyle = ch.ch === '♥' ? rgba('rose') : this.isInvite ? heatInk(heat, 0.9) : heatInk(heat);
      c.fillText(ch.ch, ch.x, ch.y);
      if (u < 1 && ch.x > head - 60) {
        // 列印頭的熱線（很淡的訊號色直條，只在正在印的那一行）
        c.fillStyle = sigInk(0.3);
        c.fillRect(head, ch.y - this.fit.size * 0.95, 3, this.fit.size * 1.2);
      }
    }
  }

  /** 票根上會變的：姓名（小字）、掃描的紅光、已登機（或候補）的章。 */
  private drawStub(c: Ctx2, t: number) {
    const sx = PERF + 30;
    const last = this.nameT[this.nameT.length - 1] ?? Infinity;
    if (t >= last) {
      c.font = font(this.nameFam, 22);
      c.fillStyle = heatInk(1 - clamp((t - last) / 0.8));
      let nm = this.nameLay.text;
      while (Array.from(nm).length > 2 && measure(nm, this.nameFam, 22) > PASS.w - sx - 30) nm = Array.from(nm).slice(0, -2).join('') + '…';
      c.fillText(nm, sx, 156);
    }
    // 掃描：一道訊號色的光從上往下掃過條碼（0.25 秒）
    if (t >= this.tScan && t < this.tScan + 0.4) {
      const u = clamp((t - this.tScan) / 0.25);
      const y = lerp(480, 556, ease.inOutCubic(u));
      const a = 1 - clamp((t - this.tScan - 0.25) / 0.15);
      c.fillStyle = sigInk(0.35 * a); c.fillRect(sx - 12, y - 7, PASS.w - sx - 6, 14);
      c.fillStyle = sigInk(0.95 * a); c.fillRect(sx - 12, y - 1.5, PASS.w - sx - 6, 3);
    }
    // 章：砸下去（從 1.3 倍縮回來），稍微歪
    if (t >= this.tStamp) {
      const k = prog(t, this.tStamp, this.tStamp + 0.07, ease.outQuad);
      const sc = lerp(1.35, 1, k);
      const txt = this.isInvite ? ['候補', 'STANDBY'] : ['已登機', 'BOARDED'];
      c.save();
      c.translate(sx + 156, 426); c.rotate(-0.16 + (hash(this.seed, 8) - 0.5) * 0.08); c.scale(sc, sc);
      c.globalAlpha *= 0.4 + 0.6 * k;
      c.strokeStyle = sigInk(0.92); c.lineWidth = 5;
      c.beginPath(); c.roundRect(-150, -50, 300, 100, 12); c.stroke();
      c.lineWidth = 1.6; c.beginPath(); c.roundRect(-140, -40, 280, 80, 8); c.stroke();
      c.fillStyle = sigInk(0.92); c.textAlign = 'center';
      c.font = font(F.hei(900), 42); c.letterSpacing = '8px'; c.fillText(txt[0]!, 4, 6);
      c.font = font(F.mono(600), 13); c.letterSpacing = '5px'; c.fillText(`${txt[1]} · ${DATE_DOTS.split(' · ').join('.')}`, 3, 30);
      c.letterSpacing = '0px'; c.textAlign = 'left';
      c.restore();
    }
  }

  /** 登機廣播：喇叭（聲波跟著人聲跳）＋ 一行跟唱的歌詞。 */
  private drawPA(c: Ctx2, t: number, a: number) {
    const { lyrics, audio: au } = this.ctx;
    c.save();
    c.globalAlpha = a;
    // 標籤
    c.fillStyle = ink(0.62);
    c.font = font(F.hei(500), 16); c.letterSpacing = '4px'; c.fillText('登機廣播', PA.x, PA.label);
    c.font = font(F.mono(500), 13); c.letterSpacing = '3px';
    c.fillText('GATE ANNOUNCEMENT · AO0313 → ∞', PA.x + measure('登機廣播', F.hei(500), 16, 4) + 16, PA.label);
    c.letterSpacing = '0px';
    c.fillStyle = ink(0.3); c.fillRect(PA.x, PA.label + 14, PA.maxW, 1.2);
    // 喇叭：一個小梯形＋三道聲波，聲波跟著人聲（vocal）與大鼓亮
    const vx = PA.x - 86, vy = PA.base - 20;
    c.fillStyle = ink(0.9);
    c.beginPath(); c.moveTo(vx, vy - 12); c.lineTo(vx + 14, vy - 12); c.lineTo(vx + 34, vy - 28); c.lineTo(vx + 34, vy + 28); c.lineTo(vx + 14, vy + 12); c.lineTo(vx, vy + 12); c.closePath(); c.fill();
    const v = au.env('vocal', t), kick = au.hit('kick', t, 0.12);
    for (let i = 0; i < 3; i++) {
      const on = clamp(v * 2.2 - i * 0.35 + kick * 0.4);
      c.strokeStyle = on > 0.05 ? sigInk(0.25 + 0.75 * on) : ink(0.18);
      c.lineWidth = 3.2; c.lineCap = 'round';
      c.beginPath(); c.arc(vx + 36, vy, 14 + i * 11, -0.7, 0.7); c.stroke();
    }
    // 歌詞
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const stl = paperLyric(F.archivo(100, 800), 66, PA.maxW);
      const lay = layoutLyric(c, ly.line, stl);
      // 新的一行從下面推上來（很短）
      const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.15));
      c.save();
      c.translate(PA.x, PA.base + (1 - inK) * 22 - (lay.height - lay.size) * 0.5);
      drawLyric(c, ly.line, t, stl, lay, ly.k * a);
      c.restore();
    } else {
      // 間奏／純音樂：冷面的廣播
      const next = lyrics.nextLine(t), last = lyrics.lastLine(t);
      let k = 0.5;
      if (last) k *= clamp((t - last.end - 1.2) / 0.4);
      if (next) k *= clamp((next.start - 0.35 - t) / 0.25);
      c.globalAlpha = a * k;
      c.fillStyle = ink(0.55);
      c.font = font(F.hei(500), 40); c.letterSpacing = '4px';
      c.fillText(lyrics.has ? '♪  間奏中，請旅客耐心等候' : '♪  本班機全程播放純音樂', PA.x, PA.base);
      c.letterSpacing = '0px';
    }
    c.restore();
  }
}

/** 俯視的小飛機（機身、主翼、尾翼），頭朝 +x。 */
function drawPlane(c: Ctx2, x: number, y: number, ang: number, s: number, fill: string) {
  c.save();
  c.translate(x, y); c.rotate(ang); c.scale(s, s);
  c.fillStyle = fill;
  c.beginPath();
  c.moveTo(18, 0); c.quadraticCurveTo(16, -3, 8, -3);
  c.lineTo(2, -3); c.lineTo(-6, -18); c.lineTo(-11, -18); c.lineTo(-6, -3);
  c.lineTo(-14, -3); c.lineTo(-18, -9); c.lineTo(-21, -9); c.lineTo(-19, 0);
  c.lineTo(-21, 9); c.lineTo(-18, 9); c.lineTo(-14, 3); c.lineTo(-6, 3);
  c.lineTo(-11, 18); c.lineTo(-6, 18); c.lineTo(2, 3); c.lineTo(8, 3);
  c.quadraticCurveTo(16, 3, 18, 0);
  c.closePath(); c.fill();
  c.restore();
}

/**
 * 桌面：淡淡的航線圖——幾條大圓航線（很大的圓弧、虛線）、機場的小圓圈，墨色 7% 左右；
 * 最上面那條航線的虛線跟著航程進度（prog）變訊號色。
 */
const DESK_GLSL = /* glsl */ `
uniform float prog;
float dashArc(vec2 p, vec2 c, float r, float w, float per, out float ang) {
  vec2 d = p - c;
  float dist = abs(length(d) - r);
  ang = atan(d.y, d.x);
  float s = ang * r;
  float dash = step(0.45, fract(s / per));
  return (1.0 - smoothstep(w * 0.5, w * 0.5 + 1.0, dist)) * dash;
}
vec3 deskArt(vec2 p, vec3 desk) {
  float a0, a1, a2;
  float l = 0.0;
  l += dashArc(p, vec2(980.0, 2900.0), 2700.0, 2.0, 22.0, a0);
  l += dashArc(p, vec2(-400.0, 2300.0), 2150.0, 1.6, 18.0, a1) * 0.8;
  l += dashArc(p, vec2(2500.0, -1600.0), 2350.0, 1.6, 18.0, a2) * 0.7;
  // 機場：小圓圈
  float ap = 0.0;
  ap += 1.0 - smoothstep(1.0, 2.2, abs(length(p - vec2(150.0, 1000.0)) - 9.0));
  ap += 1.0 - smoothstep(1.0, 2.2, abs(length(p - vec2(1780.0, 140.0)) - 9.0));
  ap += 1.0 - smoothstep(1.0, 2.2, abs(length(p - vec2(1840.0, 690.0)) - 7.0));
  vec3 col = mix(desk, C_SEPIA, 0.09 * sat(l + ap));
  // 經緯線：非常淡的細線，讓桌面有「地圖」的感覺
  vec2 g = abs(fract(p / vec2(160.0, 120.0) + 0.5) - 0.5) * vec2(160.0, 120.0);
  float grid = 1.0 - smoothstep(0.4, 1.2, min(g.x, g.y));
  col = mix(col, C_SEPIA, 0.035 * grid);
  return col;
}`;
