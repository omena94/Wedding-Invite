// 登機證（亮版面）：「FLIGHT AO0313 → 永遠」。一張登機證被遞過櫃檯、滑到桌上，像感熱印表機一樣把祝福印上去。
// MV 化（2026-09-28）：畫面只有一個焦點——登機證上印出來的主打留言；歌詞是登機證下緣的「登機廣播」一行（小一級）；
// 其他（航程 TPE → ∞、乘客、座位、條碼）都是低對比的配角。鏡頭從斜上方看著桌上的登機證（透視、景深、一盞燈），整個窗格慢慢推近。
//  - 切進來：登機證從右邊滑進來、在第一個拍點停住（一點回彈）。
//  - 第一個拍點起：乘客姓名十六分音符一個字印上去；主打留言一拍一行印出來：列印頭由左往右掃過，
//    剛印好的字是熱的（紙上的訊號色），約一秒冷卻成墨色。小飛機每一拍沿著 TPE → ∞ 的虛線往前跳一格。
//  - 留言印好的下一拍：掃描的光掃過票根上的條碼，再下一拍「已登機」章砸下去（畫面震一下）。
//  - 之後的小節線：票根沿著齒孔撕下來、歪歪地落到桌上，這一下是整個窗格的重拍。
// 歌詞：登機證下緣「登機廣播」那一行，照跟唱規則（感熱紙本來就是加熱才顯色：唱到的字才「印」深）。
// 沒有留言：乘客是「全體賓客」、祝福欄印邀請，章改蓋「候補」。新人的留言：乘客是新人。
// v2（2026-09-29「留言尺寸與版面比例標準 v2」＋場景多元化）：機場候機室窗邊的長桌，午後的暖光從大片玻璃窗照進來。
// 登機證大大地擺在桌上（它就是場景），但寫留言的那一塊照 v2：留言 40～60 px、署名印在留言下面、歌詞比留言小。
// 窗外是停機坪：一架飛機慢慢滑行經過、每兩小節一架在小節線上從跑道起飛，跑道燈跟著拍子閃。
// 畫法：登機證不會變的部分開場畫在一張 1.5 倍的離屏畫布上，每格 drawImage 兩次（主票、票根，用鋸齒的剪裁路徑分開）；
// 會變的字畫在同一層（桌面座標）；鏡頭、景深、燈光、紙纖維在 _t1 的 tablePass。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H, SCALE } from '../engine/gl';
import { F, font, layout, loadText, measure, type TextLayout } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog, pulse, frameIdx } from '../engine/util';
import type { FitResult } from '../engine/text';
import { lyricAt, drawLyric, layoutLyric, beatAfter, signature, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { msgMaxFor, lyricV2, sigV2, V2 } from './_v2';
import {
  sigInk, ink, paper, heatInk, paperLyric, makeCanvas, freeCanvas, shadowSprite, drawShadow, drawBarcode, beatsIn, barsIn,
  ensureBake, themeKey, yieldFrame, heartGlyph, tablePass, setTableCam, fitCam, lerpCam, project, TABLE_F, deskScale, fitV2, setLight, setBackdrop, lightTint, type TableCam, type Rect,
} from './_t1';

// 淺色的木頭長桌、午後的光：右下角 HUD 用深色字 → 亮版面
export const spec: PlateSpecDecl = { group: 'type', family: 'doc', paper: true, energy: [0.2, 0.85], bars: [4, 8], weight: 1 };

type Ctx2 = CanvasRenderingContext2D;

/** 登機證（紙面座標）：主票 0..PERF、票根 PERF..PASS.w。 */
const PASS = { w: 1500, h: 700 };
const PERF = 1140;
const BAND = 46;
/** 登機證在桌上的縮放、放好之後在桌上的位置（中心）與角度。登機證本身是場景，可以大；寫留言的那一塊另外照 v2 限制。 */
const K = 0.8;
const REST = { x: 840, y: 720, rot: -0.02 };
/** 長桌的遠端（桌面 v）：再過去就是窗外。 */
const EDGE_V = 330;
/** 祝福欄（留言＋下面的署名）、航程列、登機廣播（歌詞）（紙面座標）。 */
const MSG = { x: 40, y: 176, w: 1060, h: 330 };
const ROUTE = { y: 132, from: 40, to: 700 };
const PA = { x: 76, base: 650, maxW: 1030 };

const PASS_TEXT = '登機證愛情航空旅客相遇永遠座位登機廣播已登機候補全體賓客一位賓客間奏中請旅客耐心等候本班機全程播放純音樂掃描右下角把祝福寫上大螢幕新人';

interface PChar { ch: string; x: number; y: number; w: number; row: number }

export default class Boarding extends Scene {
  layer = this.track(new Layer2D(W, H, SCALE * 1.25, { fast: true }));
  /** 窗外（螢幕座標、半解析度：遠景本來就是失焦的）。 */
  back = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  pass = shared('boarding.table', () => tablePass(LAMINATE_GLSL));
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
  /** 署名（留言下面，印完留言之後一個字一個字印上去）。 */
  sigLay!: TextLayout;
  sigX = 0; sigY = 0;
  fit: FitResult | null = null;
  /** 紙面 px → 螢幕 px 的縮放（登機證的縮放 × 鏡頭在留言那裡的縮放）：v2 的字級是螢幕 px。 */
  S = 1;
  /** 歌詞字級（紙面 px）。 */
  lyrPx = 60;
  /** 飛機起飛的時間（每兩小節一架，在小節線上）。 */
  planes: number[] = [];
  /** 寫留言那一塊的寬高（紙面 px；v2：螢幕上 ≤ 840 × 420）。 */
  msgW = 1060; msgH = 330;
  msgFam = F.hand(700);
  chars: PChar[] = [];
  isInvite = false;
  seat = '13A';

  // 時間（秒）
  B = 0.5;
  land = 0;
  sigT: number[] = [];
  /** 每一行留言開始印、印完的時間。 */
  rowT: [number, number][] = [];
  printEnd = 0;
  tScan = Infinity;
  tStamp = Infinity;
  tTear = Infinity;
  beats: number[] = [];
  /** 鏡頭：切進來的位置 → 窗格結束時（慢慢推近）。 */
  camA!: TableCam;
  camB!: TableCam;
  /** 一定要清楚的點（留言與歌詞，桌面座標）。 */
  focusPts: [number, number][] = [];

  override async init() {
    const { audio: au, lyrics, start: s, end: e } = this.ctx;
    const m = this.msg;
    this.isInvite = !m;
    this.name = m ? (m.couple ? COUPLE_ZH : m.name || '一位賓客') : '全體賓客';
    const body = m ? m.text : '掃描右下角 QR code，把祝福寫上大螢幕。';
    const n = m?.n ?? 0;
    this.seat = m?.couple ? '1A' : `${((n * 7) % 38) + 2}${'ABCDEF'[n % 6]}`;
    await loadText(PASS_TEXT + this.name + body + COUPLE_ZH + lyrics.linesIn(s - 2, e + 1).map((l) => l.text).join(''));

    await yieldFrame();
    const c = this.layer.ctx;
    // ---- 鏡頭先定好（字級要換成螢幕 px 才知道畫多大）：坐在窗邊斜斜地看著桌上的登機證，畫面上方是窗外的停機坪
    const toDesk = (u: number, v: number) => {
      const cs = Math.cos(REST.rot), sn = Math.sin(REST.rot);
      const x = (u - PASS.w / 2) * K, y = (v - PASS.h / 2) * K;
      return [REST.x + cs * x - sn * y, REST.y + sn * x + cs * y] as [number, number];
    };
    const deskRect = (r: Rect): Rect => {
      const pts = [toDesk(r[0], r[1]), toDesk(r[0] + r[2], r[1]), toDesk(r[0], r[1] + r[3]), toDesk(r[0] + r[2], r[1] + r[3])];
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    };
    const keep = [deskRect([MSG.x - 10, MSG.y, MSG.w + 20, MSG.h]), deskRect([PA.x - 50, PA.base - 64, PA.maxW + 60, 110])];
    this.focusPts = [toDesk(MSG.x + MSG.w / 2, MSG.y), toDesk(PA.x + 300, PA.base)];
    this.camB = fitCam({ tu: 930, tv: 640, dist: TABLE_F * 1.02, tilt: 0.62, yaw: -0.01 }, keep);
    this.camA = { ...this.camB, tu: 1040, tv: 600, dist: this.camB.dist * 1.06, tilt: 0.6, yaw: 0.04 };
    const [mu, mv] = toDesk(MSG.x + MSG.w / 2, MSG.y + MSG.h / 2);
    this.S = K * deskScale(this.camB, mu, mv);
    const S = this.S;

    // ---- 祝福欄：留言 40～60 螢幕 px（依字數），照子句斷行；下面留一行給署名
    const sigGuess = sigV2(msgMaxFor(body)) / S;
    this.msgW = Math.min(MSG.w, 840 / S); this.msgH = Math.min(MSG.h, 420 / S);
    const box = { w: this.msgW, h: this.msgH - sigGuess * 1.7 };
    const o = { min: V2.msgMin / S, max: msgMaxFor(body) / S, lineHeight: 1.26, maxLines: 4 };
    this.fit = fitV2(c, body, this.msgFam, box.w, box.h, o);
    const fit = this.fit;
    // 留言＋署名整塊在祝福欄裡垂直置中（短留言不要擠在上面、下面空一大片）
    const blockH = fit.height + sigV2(fit.size * S) / S * 1.5;
    const top = MSG.y + Math.max(0, (MSG.h - blockH) / 2) + fit.size * 0.9;
    this.chars = [];
    fit.lines.forEach((ln, row) => {
      const lay = layout(ln, this.msgFam, fit.size);
      for (const g of lay.glyphs) this.chars.push({ ch: g.ch, x: MSG.x + g.x, y: top + row * fit.lineHeight, w: g.w, row });
    });
    // 署名：留言最後一行下面、靠右（26～32 螢幕 px）
    const msgScreen = fit.size * S;
    const sigPx = sigV2(msgScreen) / S;
    this.sigLay = layout(signature(this.name), F.hand(700), sigPx);
    this.sigX = Math.min(MSG.x + this.msgW, MSG.x + Math.max(fit.width, this.sigLay.width + 40)) - this.sigLay.width;
    this.sigY = top + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.42 + sigPx * 1.15;
    this.lyrPx = lyricV2(m ? msgScreen : null) / S;

    // ---- 時間表
    const B = (this.B = au.beatPeriod(s + 0.1));
    this.land = beatAfter(au, s + Math.min(0.42, 0.3 + B * 0.2));
    // 留言：落定的下一拍開始，一拍一行（短窗格就半拍一行）
    const per = e - s < 6 ? B / 2 : B;
    const r0 = beatAfter(au, this.land + B * 0.5);
    this.rowT = fit.lines.map((_, i) => [r0 + i * per, r0 + i * per + Math.min(per * 0.8, 0.55)]);
    const rowsEnd = this.rowT[this.rowT.length - 1]![1];
    // 署名：留言印完的下一個八分音符，十六分音符一個字
    const sigStep = clamp((1.2 * B) / Math.max(1, this.sigLay.glyphs.length), 0.03, B / 4);
    const sig0 = au.timeOfBeat(Math.ceil(au.beatAt(rowsEnd + 0.03) * 2) / 2);
    this.sigT = this.sigLay.glyphs.map((_, i) => sig0 + i * sigStep);
    this.printEnd = this.sigT[this.sigT.length - 1] ?? rowsEnd;
    // 掃描、蓋章、撕票根：各在自己的拍點，窗格太短就省掉
    const scan = beatAfter(au, this.printEnd + 0.05);
    if (scan < e - 1.6 * B) { this.tScan = scan; this.tStamp = beatAfter(au, scan + 0.1); }
    const after = isFinite(this.tStamp) ? this.tStamp + 1.5 * B : this.printEnd + B;
    const bars = barsIn(au, after, e - 0.9 * B);
    if (bars.length) this.tTear = bars.length > 2 ? bars[1]! : bars[0]!;
    else if (e - after > B) this.tTear = beatAfter(au, after);
    this.beats = beatsIn(au, this.land, e);
    // 窗外起飛的飛機：從第一個小節線起每兩小節一架（撕票根那一小節讓開，重拍只留一個）
    this.planes = barsIn(au, s + 0.2, e - 0.6).filter((_, i) => i % 2 === 0).filter((bt) => Math.abs(bt - this.tTear) > 0.5);

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
  }

  override dispose() { freeCanvas(this.art); this.art = null; freeCanvas(this.shMain); freeCanvas(this.shStub); super.dispose(); }


  /** 登機證上不會變的東西。資訊砍到最少：表頭一條、航程、座位、條碼。主題換了就重畫。 */
  private drawArt() {
    this.artKey = themeKey();
    freeCanvas(this.art);
    const a = (this.art = makeCanvas(PASS.w, PASS.h, 1.5));
    const c = a.c;
    // 紙
    c.fillStyle = paper();
    c.beginPath(); c.roundRect(0, 0, PASS.w, PASS.h, 14); c.fill();
    // 表頭：一條細細的墨色帶（字反白、小）
    c.save();
    c.beginPath(); c.roundRect(0, 0, PASS.w, PASS.h, 14); c.clip();
    c.fillStyle = ink(0.86); c.fillRect(0, 0, PASS.w, BAND);
    c.restore();
    c.fillStyle = paper(0.92);
    c.font = font(F.archivo(125, 800), 20); c.letterSpacing = '3px'; c.fillText('BOARDING PASS', 40, 31);
    c.font = font(F.hei(700), 18); c.letterSpacing = '8px'; c.fillText('登機證', 40 + measure('BOARDING PASS', F.archivo(125, 800), 20, 3) + 22, 31);
    c.textAlign = 'right';
    c.font = font(F.mono(500), 14); c.letterSpacing = '4px'; c.fillStyle = paper(0.7);
    c.fillText(`AO0313 · ${DATE_DOTS.split(' · ').join('.')}`, PASS.w - 30, 30);
    c.textAlign = 'left'; c.letterSpacing = '0px';

    const label = (txt: string, x: number, y: number) => {
      c.fillStyle = ink(0.5);
      c.font = font(F.hei(500), 15); c.letterSpacing = '4px'; c.fillText(txt, x, y);
      c.letterSpacing = '0px';
    };
    // 航程：TPE（相遇）→ ∞（永遠），低對比（小飛機在中間跳）
    c.fillStyle = ink(0.5);
    c.font = font(F.archivo(125, 900), 56); c.fillText('TPE', ROUTE.from - 3, ROUTE.y);
    c.font = font(F.serif(600), 76); c.fillText('∞', ROUTE.to - 4, ROUTE.y + 6);
    label('相遇', ROUTE.from, ROUTE.y + 26);
    label('永遠', ROUTE.to, ROUTE.y + 26);
    // 分隔線
    c.fillStyle = ink(0.28); c.fillRect(40, MSG.y - 12, PERF - 80, 1.2);
    c.fillRect(40, PA.base - this.lyrPx * 0.95 - 34, PERF - 80, 1);
    // 登機廣播（歌詞那一行）的小標
    c.fillStyle = ink(0.45);
    c.font = font(F.hei(500), 15); c.letterSpacing = '4px'; c.fillText('♪ 登機廣播', 40, PA.base - this.lyrPx * 0.95 - 10);
    c.letterSpacing = '0px';

    // 票根：座位（低對比的大字）、條碼
    const sx = PERF + 34;
    label('座位', sx, 110);
    c.fillStyle = ink(0.32); c.font = font(F.archivo(125, 900), 60); c.fillText(this.seat, sx - 3, 176);
    drawBarcode(c, sx, 500, PASS.w - sx - 34, 64, this.seed, ink(0.8));

    // 齒孔：挖空（看得到底下的桌面）
    c.save();
    c.globalCompositeOperation = 'destination-out';
    for (let y = 10; y < PASS.h - 6; y += 18) { c.beginPath(); c.arc(PERF, y, 3.6, 0, Math.PI * 2); c.fill(); }
    c.restore();
  }

  // ------------------------------------------------------------------ 位置
  /** 主票的位置：從右邊滑進來、在落點停住（一點回彈）。 */
  private mainXf(t: number) {
    const s = this.ctx.start;
    const k = prog(t, s, this.land, (x) => ease.outBack(x, 0.9));
    const kk = prog(t, s, this.land, ease.outCubic);
    const x = lerp(REST.x + 1400, REST.x, k), y = lerp(REST.y + 60, REST.y, kk);
    const rot = lerp(-0.2, REST.rot, kk);
    // 大鼓讓紙在桌上輕輕跳一下（很小）；蓋章那一下壓下去
    const kick = this.ctx.audio.hit('kick', t, 0.1);
    const press = pulse(t, this.tStamp, 0.06);
    return { x, y: y - 2 * kick + 3 * press, rot, s: K * (1 - 0.006 * press) };
  }
  /** 票根：撕下來之後歪歪地落到右下（彈簧落定）。 */
  private stubXf(t: number) {
    const k = t >= this.tTear ? clamp(ease.outBack(clamp((t - this.tTear) / 0.42), 1.4)) : 0;
    const lift = t >= this.tTear ? Math.sin(Math.PI * clamp((t - this.tTear) / 0.42)) : 0;
    // 往右上落：右下角是 HUD（時間、QR），票根不能掉到那裡
    return { dx: 60 * k, dy: -50 * k - 16 * lift, rot: -0.08 * k };
  }
  /** 從主票的紙面座標換到票根的紙面座標（繞齒孔中點轉）。 */
  private stubSpace(c: Ctx2, st: ReturnType<Boarding['stubXf']>) {
    c.translate(PERF + st.dx, PASS.h / 2 + st.dy); c.rotate(st.rot); c.translate(-PERF, -PASS.h / 2);
  }
  /** 鏡頭：切進來時遠一點、偏右一點，整個窗格慢慢推近；登機證落定的那一下跟著往前一點點。 */
  private cam(t: number): TableCam {
    const s = this.ctx.start, e = this.ctx.end;
    const k = ease.inOutCubic(prog(t, s, e));
    const c = lerpCam(this.camA, this.camB, k);
    return { ...c, dist: c.dist * (1 - 0.012 * pulse(t, this.land, 0.12) - 0.01 * pulse(t, this.tTear, 0.12)) };
  }

  // ------------------------------------------------------------------ 畫
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start;
    if (this.artKey !== themeKey()) this.drawArt();
    const L = this.layer;
    L.clear();
    const c = L.ctx;
    const au = this.ctx.audio;

    const mx = this.mainXf(t);
    const st = this.stubXf(t);
    c.save();
    c.translate(mx.x, mx.y); c.rotate(mx.rot); c.scale(mx.s, mx.s); c.translate(-PASS.w / 2, -PASS.h / 2);
    // 陰影（滑動時陰影拉長一點，像離桌面比較高；票根撕下來之後陰影也拉開一點）
    const air = 1 - prog(t, s, this.land, ease.outCubic);
    const lift = clamp((t - this.tTear) / 0.3);
    drawShadow(c, this.shMain, 8 + 20 * air, 14 + 26 * air, 0.26 - 0.08 * air);
    c.save();
    this.stubSpace(c, st);
    c.translate(PERF, 0);
    drawShadow(c, this.shStub, 8 + 20 * air + 6 * lift, 14 + 26 * air + 8 * lift, 0.26 - 0.08 * air);
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

    // ---- 合成：鏡頭、景深、燈、窗光
    const cam = this.cam(t);
    const P = this.pass;
    P.u.layer!.value = L.upload();
    P.u.bake!.value = ensureBake(renderer);
    P.u.tone!.value = 0.2;
    setTableCam(P, cam, { aperture: 60, sharp: 0.015, focus: this.focusPts, lamp: [this.focusPts[0]![0], this.focusPts[0]![1] - 120, 1300] });
    // 午後的暖光從窗戶進來：光池大、邊緣不太暗
    setLight(P, lightTint('bone', 'signal', 0.14), 0.84, 0);
    const sill = project(cam, 960, EDGE_V).y;
    this.back.clear();
    this.drawWindow(this.back.ctx, t, sill);
    setBackdrop(P, this.back.upload(), EDGE_V);
    P.render(renderer, out);
    // 撕票根、蓋章：畫面震一下（方向用逐格的 hash，確定性）
    const amp = 8 * pulse(t, this.tTear, 0.07) + 5 * pulse(t, this.tStamp, 0.06);
    const ph = frameIdx(t);
    return {
      paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.04, vignette: 0.3, grain: 0.045, ca: 0.4,
      shake: [amp * (hash(ph, 3) - 0.5) * 2, amp * (hash(ph, 4) - 0.5) * 2],
    };
  }

  /**
   * 窗外（螢幕座標，只有長桌遠端以上看得到）：午後的天空、遠方的航廈與塔台、停機坪與跑道；
   * 一架飛機在停機坪上慢慢滑行（整個窗格一直在動）、每兩小節一架在小節線上從跑道起飛（前半段加速、後半段拉起爬升）；
   * 跑道邊燈每一拍亮一下；最前面是窗框（兩根直的窗櫺）與玻璃上的反光。
   */
  private drawWindow(c: Ctx2, t: number, sill: number) {
    const au = this.ctx.audio;
    const hz = sill - 150;
    const sky = c.createLinearGradient(0, 0, 0, hz);
    sky.addColorStop(0, mixRgba('ash', 'bone', 0.55)); sky.addColorStop(1, mixRgba('bone', 'signal', 0.28));
    c.fillStyle = sky; c.fillRect(0, 0, W, hz + 2);
    // 太陽的光暈（右上、很淡）
    const sun = c.createRadialGradient(1500, hz - 260, 10, 1500, hz - 260, 520);
    sun.addColorStop(0, rgba('ember', 0.35)); sun.addColorStop(1, rgba('ember', 0));
    c.fillStyle = sun; c.fillRect(0, 0, W, hz);
    // 遠方的航廈、塔台（霧霧的剪影）
    c.fillStyle = mixRgba('ash', 'graphite', 0.35, 0.8);
    for (let i = 0; i < 12; i++) {
      const x = i * 170 + hash(this.seed, i, 1) * 60, w = 110 + hash(this.seed, i, 2) * 120, h = 18 + hash(this.seed, i, 3) * 40;
      c.fillRect(x, hz - h, w, h + 2);
    }
    c.fillRect(1180, hz - 150, 26, 150); c.beginPath(); c.roundRect(1160, hz - 186, 66, 40, 6); c.fill();
    // 停機坪與跑道
    const apron = c.createLinearGradient(0, hz, 0, sill);
    apron.addColorStop(0, mixRgba('ash', 'graphite', 0.3)); apron.addColorStop(1, mixRgba('graphite', 'ash', 0.35));
    c.fillStyle = apron; c.fillRect(0, hz, W, sill - hz + 2);
    const ry = hz + 34;
    c.fillStyle = mixRgba('graphite', 'ink', 0.3, 0.9); c.fillRect(0, ry - 10, W, 20);
    c.fillStyle = rgba('bone', 0.55);
    for (let x = 0; x < W; x += 80) c.fillRect(x, ry - 1, 40, 2);
    // 跑道邊燈：每一拍往右亮一格
    const bi = Math.floor(au.beatAt(t)), bf = au.beatAt(t) - bi;
    for (let i = 0; i < 24; i++) {
      const on = (i - bi) % 4 === 0 ? 1 - bf : 0.15;
      c.fillStyle = rgba('signal', 0.25 + 0.75 * on);
      c.beginPath(); c.arc(i * 84 + 20, ry + 14, 3, 0, Math.PI * 2); c.fill();
    }
    // 起飛的飛機：小節線那一刻開始滑、2.4 秒內離開畫面
    for (const pt of this.planes) {
      const u = (t - pt) / 2.4;
      if (u < 0 || u > 1) continue;
      const x = lerp(-200, W + 300, u * u);
      const climb = Math.max(0, u - 0.45);
      const y = ry - 16 - 900 * climb * climb;
      drawJet(c, x, y, 0.9 + 0.3 * u, -0.5 * Math.min(1, climb * 4), mixRgba('bone', 'ash', 0.25));
    }
    // 滑行的飛機：近一點、大一點，很慢地從左到右（一直在動）
    const tx = ((t * 38 + this.seed * 211) % 2900) - 500;
    drawJet(c, tx, sill - 44, 1.9, 0, mixRgba('bone', 'ash', 0.15));
    // 窗框：兩根直的窗櫺、上面一條橫的
    c.fillStyle = mixRgba('ink2', 'graphite', 0.2);
    for (const x of [560, 1380]) c.fillRect(x - 14, 0, 28, sill + 4);
    c.fillRect(0, 0, W, 26);
    // 玻璃上的反光：兩道斜的淡白光
    c.fillStyle = rgba('bone', 0.08);
    for (const [x0, w0] of [[200, 90], [900, 50]] as const) {
      c.beginPath(); c.moveTo(x0, 0); c.lineTo(x0 + w0, 0); c.lineTo(x0 + w0 - 300, sill); c.lineTo(x0 - 300, sill); c.closePath(); c.fill();
    }
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

  /** 主票上會變的：姓名、航線上的小飛機、祝福欄、登機廣播（歌詞）。 */
  private drawMain(c: Ctx2, t: number) {
    // 航線：TPE → ∞ 之間的虛線弧，飛過的部分是訊號色，小飛機每一拍跳一格
    const p = this.flight(t);
    const ax = 190, bx = ROUTE.to - 30, ay = ROUTE.y - 18, peak = ROUTE.y - 58;
    const at = (u: number) => ({ x: lerp(ax, bx, u), y: ay + 4 * (peak - ay) * u * (1 - u) });
    const N = 36;
    for (let i = 0; i < N; i++) {
      const u0 = i / N, u1 = (i + 0.5) / N;
      const a = at(u0), b = at(u1);
      c.strokeStyle = u1 <= p ? sigInk(0.8) : ink(0.25);
      c.lineWidth = u1 <= p ? 2.6 : 1.8;
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    }
    const q = at(p), q2 = at(Math.min(1, p + 0.01));
    drawPlane(c, q.x, q.y, Math.atan2(q2.y - q.y, q2.x - q.x), 1, sigInk(0.9));
    // 祝福欄：一拍一行，列印頭由左往右掃過（掃過的地方字就出現），剛印好的字是熱的
    if (this.fit) {
      c.font = font(this.msgFam, this.fit.size);
      for (const ch of this.chars) {
        const [r0, r1] = this.rowT[ch.row]!;
        if (t < r0) continue;
        const u = clamp((t - r0) / (r1 - r0));
        const head = MSG.x + u * (this.msgW + 40);
        if (ch.x > head) continue;
        const tPrinted = r0 + ((ch.x - MSG.x) / (this.msgW + 40)) * (r1 - r0);
        const heat = 1 - clamp((t - tPrinted) / 0.9);
        c.fillStyle = this.isInvite ? heatInk(heat, 0.88) : heatInk(heat);
        if (ch.ch === '♥') heartGlyph(c, ch.x, ch.y); else c.fillText(ch.ch, ch.x, ch.y);
        if (u < 1 && ch.x > head - 60) {
          // 列印頭的熱線（很淡的訊號色直條，只在正在印的那一行）
          c.fillStyle = sigInk(0.3);
          c.fillRect(head, ch.y - this.fit.size * 0.95, 3, this.fit.size * 1.2);
        }
      }
    }
    // 署名：留言下面，一個字一個十六分音符印上去（剛印好的字是熱的）
    c.font = font(this.sigLay.family, this.sigLay.size);
    this.sigLay.glyphs.forEach((g, i) => {
      const ti = this.sigT[i]!;
      if (t < ti) return;
      c.fillStyle = heatInk(1 - clamp((t - ti) / 0.8), 0.8);
      c.fillText(g.ch, this.sigX + g.x, this.sigY);
    });
    this.drawPA(c, t);
  }

  /** 票根上會變的：掃描的光、已登機（或候補）的章。 */
  private drawStub(c: Ctx2, t: number) {
    const sx = PERF + 34;
    // 掃描：一道訊號色的光從上往下掃過條碼（0.25 秒）
    if (t >= this.tScan && t < this.tScan + 0.4) {
      const u = clamp((t - this.tScan) / 0.25);
      const y = lerp(490, 574, ease.inOutCubic(u));
      const a = 1 - clamp((t - this.tScan - 0.25) / 0.15);
      c.fillStyle = sigInk(0.35 * a); c.fillRect(sx - 12, y - 7, PASS.w - sx - 10, 14);
      c.fillStyle = sigInk(0.95 * a); c.fillRect(sx - 12, y - 1.5, PASS.w - sx - 10, 3);
    }
    // 章：砸下去（從 1.3 倍縮回來），稍微歪
    if (t >= this.tStamp) {
      const k = prog(t, this.tStamp, this.tStamp + 0.07, ease.outQuad);
      const sc = lerp(1.35, 1, k);
      const txt = this.isInvite ? '候補' : '已登機';
      c.save();
      c.translate(sx + 150, 330); c.rotate(-0.16 + (hash(this.seed, 8) - 0.5) * 0.08); c.scale(sc, sc);
      c.globalAlpha *= 0.35 + 0.4 * k;
      c.strokeStyle = sigInk(0.9); c.lineWidth = 5;
      c.beginPath(); c.roundRect(-136, -50, 272, 100, 12); c.stroke();
      c.fillStyle = sigInk(0.9); c.textAlign = 'center';
      c.font = font(F.hei(900), 46); c.letterSpacing = '8px'; c.fillText(txt, 4, 16);
      c.letterSpacing = '0px'; c.textAlign = 'left';
      c.restore();
    }
  }

  /** 登機廣播：登機證下緣一行跟唱的歌詞；間奏與純音樂寫一句冷面的廣播。 */
  private drawPA(c: Ctx2, t: number) {
    const { lyrics } = this.ctx;
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const stl = paperLyric(F.archivo(100, 800), this.lyrPx, PA.maxW, { lineHeight: 1.1, minSize: V2.lyrMin / this.S });
      const lay = layoutLyric(c, ly.line, stl);
      const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.15));
      c.save();
      // 兩行的時候往上挪一點，才不會超出登機證下緣
      c.translate(PA.x, PA.base + (1 - inK) * 12 - (lay.height - lay.size) * 0.55);
      drawLyric(c, ly.line, t, stl, lay, ly.k);
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
    c.font = font(F.hei(500), Math.round(this.lyrPx * 0.72)); c.letterSpacing = '4px';
    c.fillText(lyrics.has ? '間奏中，請旅客耐心等候' : '本班機全程播放純音樂', PA.x, PA.base);
    c.restore();
  }
}

/** 側面的噴射客機剪影（機身、垂直尾翼、主翼、發動機），頭朝 +x；pitch 是抬頭的角度（負的是機頭往上）。 */
function drawJet(c: Ctx2, x: number, y: number, s: number, pitch: number, fill: string) {
  c.save();
  c.translate(x, y); c.rotate(pitch); c.scale(s, s);
  c.fillStyle = fill;
  c.beginPath();
  c.moveTo(70, 0); c.quadraticCurveTo(66, -9, 50, -10); c.lineTo(-52, -10); c.lineTo(-74, -38); c.lineTo(-86, -38); c.lineTo(-78, -8);
  c.lineTo(-80, 2); c.quadraticCurveTo(-70, 8, -52, 8); c.lineTo(50, 8); c.quadraticCurveTo(66, 8, 70, 0); c.closePath(); c.fill();
  // 主翼、發動機
  c.beginPath(); c.moveTo(12, 2); c.lineTo(-22, 16); c.lineTo(-34, 16); c.lineTo(-14, 2); c.closePath(); c.fill();
  c.beginPath(); c.roundRect(-6, 8, 20, 8, 4); c.fill();
  // 窗戶一排（亮一點）
  c.fillStyle = rgba('ink', 0.25);
  for (let i = 0; i < 14; i++) c.fillRect(40 - i * 6.5, -5, 3, 3);
  c.restore();
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

/** 候機室的長桌：淺色的美耐板，細細的斑點、很淡的反光帶（沒有木紋，跟別的紙本版面分開）。 */
const LAMINATE_GLSL = /* glsl */ `
vec3 deskArt(vec2 p, vec3 desk) {
  float speck = hash12(floor(p * 0.5)) * 0.04 + snoise(p * 0.004) * 0.02;
  float sheen = exp(-pow((p.y - 520.0) / 160.0, 2.0)) * 0.05;
  return desk * (0.97 + speck + sheen);
}`;
