// 信封與郵票（亮版面）：桌上散著好幾封寄給新人的信（信封正面：郵票、郵戳、手寫的「新人名字 收」），
// 最上面這一封翻在背面、封口是一顆點綴色的愛心封蠟。一個窗格的動作全部落在拍點上（窗格短就半拍一步）：
//  - 切進來：信封「丟」到信堆上（從大一點、高一點的地方落下，影子收回來），落在第一個拍點；
//  - 下一拍：到達戳「碰」地蓋在信封背面（喜宴郵局、婚禮日期）；
//  - 下一拍：封蠟裂開（上半跟著封口、下半留在信封上，蠟屑噴出來）；
//  - 下一拍：封口掀開（繞著摺線翻過去，翻到背面是訊號色的內襯）；
//  - 接下來兩拍：信紙一段一段抽出來，鏡頭跟著往上移——信紙上是主打留言（手寫字）與署名。
//  - 最後一個小節線：信紙右上角蓋一個「已讀」的小章。
// 歌詞寫在信封下半部（封口下面）：信紙抽出來的時候信封跟著往下，歌詞一直都在，照跟唱規則逐字亮。
// 沒有留言：信紙寫邀請；新人的留言：信是新人寫給大家的（「親愛的各位：」）。
// MV 化：焦點是抽出來的信紙上手寫的留言；背景的信堆失焦、變淡；信紙的信頭小字拿掉。
// 鏡頭從斜上方看著桌上的信（透視、景深、一盞燈），信紙抽出來時鏡頭跟著往上、慢慢推近。
// v2（留言尺寸與版面比例標準 v2＋場景多元化）：傍晚的郵局分信台：舊木頭的桌面，後面是一整面木頭的信件分類格，
// 一盞小茶蠟燭（火焰跟著大鼓跳、照亮旁邊一圈）。信封與信紙很大（它們就是場景），信紙上的留言 40～60 px、署名 26～32 px
// 在留言下面、歌詞比留言小；每兩小節在小節線上有一封信被塞進後面的某一格（格子裡的信越來越多）。
// 畫法：信堆（背景的信封）、信封本體、封口的外側與內襯、封蠟、信紙都在開場畫成離屏畫布；每格只是把它們放到對的位置
// （封口翻開是垂直方向的縮放，cos 從 1 到 -1；負的時候畫內襯）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H, SCALE } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { mixRgba, rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, mulberry32, prog, pulse, frameIdx, TAU } from '../engine/util';
import type { FitResult } from '../engine/text';
import { lyricAt, drawLyric, layoutLyric, beatAfter, heartPoints, fillWithHearts, COUPLE_ZH, DATE_DOT, fitPx } from './_motifs';
import { msgMaxFor, lyricV2, sigV2, V2 } from './_v2';
import {
  sigInk, ink, paper, paperLyric, makeCanvas, freeCanvas, shadowSprite, drawShadow, barsIn, ensureBake, themeKey, inkStamp, arcText, fitMsg, yieldFrame,
  tablePass, setTableCam, fitCam, lerpCam, project, TABLE_F, deskScale, fitV2, setLight, setBackdrop, lightTint, type TableCam, type Rect,
} from './_t1';

// v2：桌面是暗的木頭，右下角 HUD 用淺色字 → 當暗的版面排
export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'doc', paper: false, energy: [0.15, 0.8], bars: [4, 8], weight: 1 };

type Ctx2 = CanvasRenderingContext2D;

/** 整組（信封＋信紙）在桌上的位置與縮放：下面 ENV／LET／LYR 的座標都是「組座標」，畫的時候整組乘上 G。 */
const G = { x: 240, y: 190, k: 0.8 };
/** 分信台的遠端（桌面 v）：再過去是信件分類格。 */
const EDGE_V = 150;
/** 茶蠟燭、信堆（桌面座標）：都離右下角 HUD 遠遠的。 */
const CANDLE = { x: 1640, y: 560 };
const PILE = { x: 1640, y: 280 };
/** 信封（信封座標：左上角 0,0）。放好時左上角在組座標 (x, y)；信紙抽出來時信封往下移 DROP，鏡頭跟著往上看信紙。 */
const ENV = { w: 1040, h: 560, x: 300, y: 300, flap: 290 };
const DROP = 200;
/** 信紙：寬、露出來之後的上緣（螢幕）；信紙座標的內容位置。 */
const LET = { w: 1000, top: 40, h: 520 };
const LMSG = { x: 50, y: 80, w: 900, h: 346 };
/** 歌詞（信封座標）。 */
const LYR = { x: 60, base: 436, maxW: 920 };

/**
 * 信封正面手寫的收件人「承恩 & 以晴 收」：名字可能很長，寫不下就縮字。
 * 從 x = -170 寫到右緣（信封寬 820、置中，右邊留 30 的邊），郵票、郵戳在上面，不會碰到。
 */
const TO = `${COUPLE_ZH} 收`;
/** 量字要等字型載好（init 裡才呼叫）：模組載入時量到的是備援字型的寬度。 */
const toPx = () => fitPx(TO, F.hand(700), 44, 410 - 30 + 170);
/** 日戳上的日期；還沒定日期就蓋「TODAY」（日戳中間不會空一格）。 */
const STAMP_DATE = DATE_DOT || 'TODAY';

const TEXT = '親愛的各位收喜宴會場第桌到達喜宴郵局寄件人一位賓客已讀掃描右下角把祝福寫上大螢幕間奏中本曲為純音樂請自行哼唱此刻正在播放的歌';

export default class Envelope extends Scene {
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  pass = shared('envelope.table', () => tablePass());
  /** 後面的信件分類格（螢幕座標、半解析度）。 */
  back = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = Number(this.ctx.params.seed ?? 1);
  artKey = '';
  desk: ReturnType<typeof makeCanvas> | null = null;
  body: ReturnType<typeof makeCanvas> | null = null;
  flapOut: ReturnType<typeof makeCanvas> | null = null;
  flapIn: ReturnType<typeof makeCanvas> | null = null;
  seal: ReturnType<typeof makeCanvas> | null = null;
  letter: ReturnType<typeof makeCanvas> | null = null;
  stamp: ReturnType<typeof makeCanvas> | null = null;
  read: ReturnType<typeof makeCanvas> | null = null;
  sh = shadowSprite(ENV.w, ENV.h, 18, 8);
  fit: FitResult | null = null;
  sender = '';

  // 時間
  B = 0.5;
  land = 0; tStamp = 0; tCrack = 0; tOpen = 0; tPull: [number, number] = [0, 0]; tRead = Infinity;
  camA!: TableCam;
  camB!: TableCam;
  focusPts: [number, number][] = [];
  /** 組 px → 螢幕 px；署名、歌詞字級（組 px）。 */
  S = 1; sigPx = 30; lyrPx = 50;
  /** 新的信滑到信堆上的時間（每兩小節一封）、信的正面（小張）。 */
  arrivals: number[] = [];
  front: ReturnType<typeof makeCanvas> | null = null;

  override async init() {
    const { audio: au, lyrics, start: s, end: e } = this.ctx;
    const m = this.msg;
    this.sender = m ? (m.couple ? COUPLE_ZH : m.name || '一位賓客') : '大螢幕';
    const others = (this.ctx.params.messages as Msg[] | undefined)?.filter((x) => x.name && x.id !== m?.id).map((x) => x.name) ?? [];
    await loadText(TEXT + (m ? m.text : '') + this.sender + others.slice(0, 6).join('') + COUPLE_ZH + lyrics.linesIn(s - 2, e + 1).map((l) => l.text).join(''));
    const B = (this.B = au.beatPeriod(s + 0.1));
    // ---- 時間：一拍一步（窗格短就半拍一步）
    const st = e - s < 12 * B ? B / 2 : B;
    this.land = beatAfter(au, s + Math.min(0.32, B * 0.6));
    this.tStamp = this.land + st;
    this.tCrack = this.land + 2 * st;
    this.tOpen = this.land + 3 * st;
    this.tPull = [this.land + 4 * st, this.land + 5 * st];
    const bars = barsIn(au, this.tPull[1] + 2 * B, e - 0.6 * B);
    if (bars.length) this.tRead = bars[bars.length - 1]!;
    // 鏡頭：信封落在桌上時對著信封；信紙抽出來之後對著信紙與歌詞之間；兩個鏡位都保證留言與歌詞在安全範圍內
    const g = (x: number, y: number): [number, number] => [G.x + G.k * x, G.y + G.k * y];
    const gR = (x: number, y: number, w: number, h: number): Rect => [G.x + G.k * x, G.y + G.k * y, G.k * w, G.k * h];
    const lx = ENV.x + (ENV.w - LET.w) / 2;
    const msgR = gR(lx + LMSG.x, LET.top + LMSG.y - 10, LMSG.w + 30, LMSG.h + 60);
    const lyrA = gR(ENV.x + LYR.x - 10, ENV.y + LYR.base - 64, LYR.maxW + 20, 130);
    const lyrB: Rect = [lyrA[0], lyrA[1] + G.k * DROP, lyrA[2], lyrA[3]];
    this.focusPts = [g(lx + LMSG.x + LMSG.w / 2, LET.top + LMSG.y + LMSG.h / 2), g(ENV.x + LYR.x + 300, ENV.y + DROP + LYR.base)];
    const [ca, cb] = g(ENV.x + ENV.w / 2, ENV.y + ENV.h / 2 + 20);
    this.camA = fitCam({ tu: ca + 60, tv: cb - 40, dist: TABLE_F * 1.0, tilt: 0.62, yaw: 0.04, roll: -0.02 }, [lyrA]);
    this.camB = fitCam({ tu: ca + 60, tv: (msgR[1] + lyrB[1] + lyrB[3]) / 2, dist: TABLE_F * 0.96, tilt: 0.6, yaw: 0.02, roll: -0.01 }, [msgR, lyrB]);
    this.S = G.k * deskScale(this.camB, this.focusPts[0]![0], this.focusPts[0]![1]);
    this.arrivals = barsIn(au, this.land + 0.5, e - 0.8).filter((_, i) => i % 2 === 1);
    await yieldFrame();
    this.buildArt(others);
  }

  override dispose() {
    for (const c of [this.desk, this.body, this.flapOut, this.flapIn, this.seal, this.letter, this.stamp, this.read, this.sh, this.front]) freeCanvas(c);
    super.dispose();
  }

  // ------------------------------------------------------------------ 開場畫好的東西
  private buildArt(others: string[]) {
    this.artKey = themeKey();
    for (const c of [this.desk, this.body, this.flapOut, this.flapIn, this.seal, this.letter, this.stamp, this.read]) freeCanvas(c);
    const m = this.msg;
    const rnd = mulberry32(this.seed * 17 + 5);

    // ---- 信堆：背景幾封信的正面（郵票、郵戳、手寫地址），一半在畫面外
    const d = (this.desk = makeCanvas(W, H, 1));
    // 背景的信是配角：失焦（模糊）、淡一點、少一點
    const piles: [number, number, number][] = [[120, 930, -0.12]];
    d.c.filter = 'blur(3px)';
    piles.forEach(([cx, cy, rot], i) => {
      const c = d.c;
      c.save();
      c.translate(cx, cy); c.rotate(rot); c.scale(0.46, 0.46);
      const w = 820, h = 460;
      c.fillStyle = ink(0.14); c.fillRect(-w / 2 + 8, -h / 2 + 12, w, h);
      c.fillStyle = mixRgba('paper', i % 2 ? 'bone' : 'signal', i % 2 ? 0.35 : 0.06); c.fillRect(-w / 2, -h / 2, w, h);
      c.strokeStyle = ink(0.12); c.lineWidth = 1; c.strokeRect(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1);
      // 郵票（齒孔邊）＋郵戳（圓的日戳＋波浪線）
      drawPostage(c, w / 2 - 150, -h / 2 + 30, 110, 132, i);
      drawPostmark(c, w / 2 - 170, -h / 2 + 110, rnd);
      // 手寫的收件人、寄件人
      c.fillStyle = ink(0.55);
      c.font = font(F.hand(700), toPx()); c.fillText(TO, -170, 40);
      c.font = font(F.hand(400), 26); c.fillText(`喜宴會場　第 ${1 + Math.floor(rnd() * 20)} 桌`, -150, 92);
      c.font = font(F.hand(400), 24); c.fillStyle = ink(0.4);
      c.fillText(others[i] ? `寄件人：${others[i]}` : '寄件人：一位賓客', -w / 2 + 40, -h / 2 + 56);
      c.restore();
    });

    // 新來的信（正面、小張、不模糊）：跟信堆同一種樣子，每兩小節滑進來一封
    {
      freeCanvas(this.front);
      const fr = (this.front = makeCanvas(820, 460, 0.7));
      const c = fr.c;
      c.fillStyle = mixRgba('paper', 'bone', 0.35); c.fillRect(0, 0, 820, 460);
      c.strokeStyle = ink(0.12); c.lineWidth = 1; c.strokeRect(0.5, 0.5, 819, 459);
      c.translate(410, 230);
      drawPostage(c, 410 - 150, -230 + 30, 110, 132, 1);
      drawPostmark(c, 410 - 170, -230 + 110, rnd);
      c.fillStyle = ink(0.6);
      c.font = font(F.hand(700), toPx()); c.fillText(TO, -170, 40);
    }
    // ---- 信封背面（本體）：紙、兩邊與下面摺進來的縫線、到達戳的位置空著
    const b = (this.body = makeCanvas(ENV.w, ENV.h, 1.25));
    let c = b.c;
    c.fillStyle = paper(); c.fillRect(0, 0, ENV.w, ENV.h);
    c.strokeStyle = ink(0.22); c.lineWidth = 1.4;
    c.beginPath(); c.moveTo(0, ENV.h); c.lineTo(ENV.w * 0.5, ENV.h * 0.5); c.lineTo(ENV.w, ENV.h); c.stroke();
    c.strokeStyle = ink(0.12);
    c.beginPath(); c.moveTo(0, 0); c.lineTo(ENV.w * 0.38, ENV.h * 0.52); c.moveTo(ENV.w, 0); c.lineTo(ENV.w * 0.62, ENV.h * 0.52); c.stroke();
    // 下緣的陰影（摺進來的那一片比較暗一點）
    c.fillStyle = ink(0.04);
    c.beginPath(); c.moveTo(0, ENV.h); c.lineTo(ENV.w * 0.5, ENV.h * 0.5); c.lineTo(ENV.w, ENV.h); c.closePath(); c.fill();
    c.fillStyle = ink(0.55); c.font = font(F.mono(500), 12); c.letterSpacing = '4px';
    c.fillText('♪ 此刻正在播放的歌', LYR.x, LYR.base - 84);
    c.letterSpacing = '0px';

    // ---- 封口：外側（紙＋寄件人）、內襯（訊號色的格紋）。都畫成一個 w × flap 的三角形
    const tri = (cc: Ctx2) => { cc.beginPath(); cc.moveTo(0, 0); cc.lineTo(ENV.w, 0); cc.lineTo(ENV.w / 2, ENV.flap); cc.closePath(); };
    const fo = (this.flapOut = makeCanvas(ENV.w, ENV.flap + 4, 1.25));
    c = fo.c;
    tri(c); c.fillStyle = mixRgba('paper', 'sepia', 0.03); c.fill();
    c.strokeStyle = ink(0.25); c.lineWidth = 1.4; c.stroke();
    c.save(); tri(c); c.clip();
    c.fillStyle = ink(0.6); c.font = font(F.hand(400), 26);
    c.fillText(`寄件人：${this.sender}`, ENV.w * 0.2, 52);
    c.restore();
    const fi = (this.flapIn = makeCanvas(ENV.w, ENV.flap + 4, 1.25));
    c = fi.c;
    tri(c); c.fillStyle = mixRgba('paper', 'signal', 0.28); c.fill();
    c.save(); tri(c); c.clip();
    c.strokeStyle = sigInk(0.35); c.lineWidth = 1.5;
    for (let k = -ENV.flap; k < ENV.w; k += 22) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k + ENV.flap, ENV.flap); c.stroke(); c.beginPath(); c.moveTo(k + ENV.flap, 0); c.lineTo(k, ENV.flap); c.stroke(); }
    c.restore();

    // ---- 封蠟：點綴色的蠟（不規則的圓）、中間壓一顆愛心（愛心只用點綴色）
    const se = (this.seal = makeCanvas(150, 150, 1.5));
    c = se.c;
    c.translate(75, 75);
    c.beginPath();
    for (let i = 0; i <= 40; i++) { const a = (i / 40) * TAU; const r = 62 + 5 * Math.sin(a * 5 + this.seed) + 3 * Math.sin(a * 11); if (i) c.lineTo(Math.cos(a) * r, Math.sin(a) * r); else c.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    c.closePath();
    const g = c.createRadialGradient(-18, -20, 6, 0, 0, 68);
    g.addColorStop(0, mixRgba('rose', 'bone', 0.35)); g.addColorStop(0.5, rgba('rose')); g.addColorStop(1, mixRgba('rose', 'sepia', 0.45));
    c.fillStyle = g; c.fill();
    c.lineWidth = 3; c.strokeStyle = mixRgba('rose', 'sepia', 0.35); c.beginPath(); c.arc(0, 0, 44, 0, TAU); c.stroke();
    const hp = heartPoints(64);
    const heart = (dx: number, dy: number, col: string) => { c.fillStyle = col; c.beginPath(); hp.forEach((p, i) => (i ? c.lineTo(dx + p.x * 30, dy + p.y * 30) : c.moveTo(dx + p.x * 30, dy + p.y * 30))); c.fill(); };
    heart(1.5, 2, mixRgba('rose', 'sepia', 0.5));
    heart(-1, -1, mixRgba('rose', 'bone', 0.4));
    heart(0, 0, rgba('rose'));

    // ---- 信紙：淡淡的橫線、信頭、稱呼、留言、署名
    const L = (this.letter = makeCanvas(LET.w, LET.h, 1.25));
    c = L.c;
    c.fillStyle = mixRgba('paper', 'bone', 0.55); c.fillRect(0, 0, LET.w, LET.h);
    c.fillStyle = sigInk(0.25);
    for (let y = 70; y < LET.h; y += 58) c.fillRect(40, y + 12, LET.w - 80, 1);
    c.fillStyle = sigInk(0.6); c.fillRect(0, 0, LET.w, 6);
    c.fillStyle = ink(0.7);
    c.font = font(F.hand(700), Math.round(26 / this.S));
    c.fillText(m?.couple ? '親愛的各位：' : `親愛的 ${COUPLE_ZH}：`, 56, 64);
    const body = m ? m.text : '掃描右下角 QR code，把祝福寫上大螢幕。';
    // v2：留言 40～60 螢幕 px（組 px = 螢幕 px ÷ S），照子句斷行；框的高度先扣掉署名那一行
    const S = this.S;
    const o = { min: V2.msgMin / S, max: msgMaxFor(body) / S, lineHeight: 1.26, maxLines: 4 };
    const bh = LMSG.h - (sigV2(msgMaxFor(body)) / S) * 1.6;
    this.fit = fitV2(c, body, F.hand(700), LMSG.w, bh, o);
    this.sigPx = sigV2(this.fit.size * S) / S;
    this.lyrPx = lyricV2(m ? this.fit.size * S : null) / S;
    const fit = this.fit;
    c.font = font(F.hand(700), fit.size);
    const top = LMSG.y + 12 + fit.size * 0.88;
    c.fillStyle = ink(0.92);
    fit.lines.forEach((ln, i) => fillWithHearts(c, ln, LMSG.x + 30, top + i * fit.lineHeight));
    // 署名：緊接在留言最後一行下面、靠右
    c.fillStyle = ink(0.8); c.font = font(F.hand(700), this.sigPx); c.textAlign = 'right';
    c.fillText(`—— ${m ? (m.couple ? COUPLE_ZH : m.name || '一位賓客') : '大螢幕'}`, LET.w - 60, top + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.4 + this.sigPx * 1.2);
    c.textAlign = 'left';

    // ---- 到達戳、已讀章
    this.stamp = inkStamp(210, 210, this.seed + 3, (sc) => {
      const col = sigInk(0.95);
      sc.strokeStyle = col; sc.fillStyle = col;
      sc.lineWidth = 4.5; sc.beginPath(); sc.arc(0, 0, 94, 0, TAU); sc.stroke();
      sc.lineWidth = 1.8; sc.beginPath(); sc.arc(0, 0, 64, 0, TAU); sc.stroke();
      arcText(sc, '喜宴郵局 · WEDDING POST', 68, -Math.PI / 2, F.hei(700), 16, 3, true);
      arcText(sc, '到達 ARRIVED', 68, Math.PI / 2, F.mono(600), 15, 3, false);
      sc.textAlign = 'center';
      sc.font = font(F.mono(600), 21); sc.fillText(STAMP_DATE, 0, 8);
      sc.fillRect(-60, -20, 120, 2); sc.fillRect(-60, 22, 120, 2);
    }, 1.25, 0.5);
    this.read = inkStamp(160, 110, this.seed + 8, (sc) => {
      const col = sigInk(0.95);
      sc.strokeStyle = col; sc.fillStyle = col;
      sc.lineWidth = 4; sc.beginPath(); sc.roundRect(-72, -44, 144, 88, 12); sc.stroke();
      sc.textAlign = 'center';
      sc.font = font(F.hei(900), 40); sc.letterSpacing = '10px'; sc.fillText('已讀', 6, 8);
      sc.font = font(F.mono(600), 12); sc.letterSpacing = '3px'; sc.fillText('READ', 2, 32);
      sc.letterSpacing = '0px';
    }, 1.25, 0.5);
  }

  // ------------------------------------------------------------------ 位置
  /** 信紙抽出來多少（0..1），兩段、每段落在拍點（很快的緩動）。 */
  private pull(t: number) {
    const [a, b] = this.tPull;
    return 0.55 * ease.outExpo(clamp((t - a) / 0.3)) + 0.45 * ease.outExpo(clamp((t - b) / 0.3));
  }
  /** 封口翻開的角度（0 = 蓋著、π = 完全翻開）。 */
  private flapAngle(t: number) { return Math.PI * ease.outBack(clamp((t - this.tOpen) / 0.34), 0.8); }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    if (this.artKey !== themeKey()) {
      const others = (this.ctx.params.messages as Msg[] | undefined)?.filter((x) => x.name && x.id !== this.msg?.id).map((x) => x.name) ?? [];
      this.buildArt(others);
    }
    const L = this.layer;
    L.clear();
    const c = L.ctx;
    c.drawImage(this.desk!.cv, 0, 0, W, H);
    this.drawProps(c, t);
    // 整組（信封＋信紙）縮放擺到桌上
    c.save();
    c.translate(G.x, G.y); c.scale(G.k, G.k);

    // 信封落下：從大一點、歪一點的地方落到信堆上
    const k = prog(t, s, this.land, ease.outCubic);
    const air = 1 - k;
    const p = this.pull(t);
    const ex = ENV.x, ey = ENV.y + DROP * p;
    const kick = this.ctx.audio.hit('kick', t, 0.1);
    const press = pulse(t, this.tStamp, 0.06) + pulse(t, this.tRead, 0.06);
    const sc = 1 + 0.1 * air - 0.004 * press;
    const rot = -0.012 - 0.07 * air;
    c.save();
    c.translate(ex + ENV.w / 2, ey + ENV.h / 2 - 1.5 * kick + 2 * press); c.rotate(rot); c.scale(sc, sc); c.translate(-ENV.w / 2, -ENV.h / 2);
    drawShadow(c, this.sh, 8 + 30 * air, 14 + 40 * air, 0.28 - 0.1 * air);

    // 封口翻開（cos < 0）：內襯在信紙後面
    const th = this.flapAngle(t), cs = Math.cos(th);
    if (cs < 0) this.drawFlap(c, cs);
    // 信紙：從信封裡往上抽（被信封本體擋住下半部）
    if (p > 0.001) {
      const ly = 20 - (ENV.y - LET.top + DROP + 20) * p;
      c.save();
      c.translate((ENV.w - LET.w) / 2, ly);
      c.fillStyle = ink(0.1); c.fillRect(6, 8, LET.w, LET.h);
      c.drawImage(this.letter!.cv, 0, 0, LET.w, LET.h);
      // 已讀章
      if (t >= this.tRead && this.read) {
        const kk = prog(t, this.tRead, this.tRead + 0.07, ease.outQuad);
        c.save();
        c.globalCompositeOperation = 'multiply';
        c.globalAlpha = 0.5 + 0.5 * kk;
        c.translate(LET.w - 130, 44); c.rotate(0.14); c.scale(lerp(1.35, 1, kk), lerp(1.35, 1, kk));
        c.drawImage(this.read.cv, -this.read.w / 2, -this.read.h / 2, this.read.w, this.read.h);
        c.restore();
      }
      c.restore();
    }
    // 信封本體（擋住信紙的下半部）
    c.drawImage(this.body!.cv, 0, 0, ENV.w, ENV.h);
    // 到達戳
    if (t >= this.tStamp && this.stamp) {
      const kk = prog(t, this.tStamp, this.tStamp + 0.07, ease.outQuad);
      c.save();
      c.globalCompositeOperation = 'multiply';
      c.globalAlpha = 0.5 + 0.5 * kk;
      c.translate(150, 190); c.rotate(-0.2 + (hash(this.seed, 4) - 0.5) * 0.1); c.scale(lerp(1.35, 1, kk), lerp(1.35, 1, kk));
      c.drawImage(this.stamp.cv, -this.stamp.w / 2, -this.stamp.h / 2, this.stamp.w, this.stamp.h);
      c.restore();
    }
    // 歌詞（信封下半部）
    this.drawLyricLine(c, t);
    // 封蠟的下半（留在信封上）
    this.drawSeal(c, t, false, 1);
    // 封口蓋著或正在翻（cos > 0）：外側在最上面，封蠟的上半跟著它
    if (cs >= 0) { this.drawFlap(c, cs); this.drawSeal(c, t, true, cs); }
    c.restore();
    c.restore();

    // ---- 合成：鏡頭、景深、燈。鏡頭跟著信紙抽出來往上移
    const cam0 = lerpCam(this.camA, this.camB, ease.inOutCubic(clamp((t - this.tPull[0]) / Math.max(0.5, this.tPull[1] + 0.6 - this.tPull[0]))));
    const cam = { ...cam0, dist: cam0.dist * (1.03 - 0.012 * pulse(t, this.land, 0.12) - 0.03 * ease.inOutCubic(prog(t, this.tPull[1], e))) };
    const P = this.pass;
    P.u.layer!.value = L.upload();
    P.u.bake!.value = ensureBake(renderer);
    P.u.tone!.value = 0.62;
    // 傍晚的暖光（燭光＋一盞低低的燈）：光池在信紙那一帶，四周暗下去；右下角 HUD 那一塊再壓暗
    setTableCam(P, cam, { aperture: 56, sharp: 0.02, focus: this.focusPts, lamp: [this.focusPts[0]![0] + 100, this.focusPts[0]![1] + 160, 560] });
    setLight(P, lightTint('bone', 'ember', 0.32), 0.2, 0.55);
    const edgeY = project(cam, 960, EDGE_V).y;
    this.back.clear();
    this.drawCubbies(this.back.ctx, t, edgeY);
    setBackdrop(P, this.back.upload(), EDGE_V);
    P.render(renderer, out);
    const amp = 8 * pulse(t, this.land, 0.06) + 9 * pulse(t, this.tStamp, 0.06) + 5 * pulse(t, this.tCrack, 0.05) + 7 * pulse(t, this.tRead, 0.06);
    const ph = frameIdx(t);
    return {
      paper: 0, bloom: 0.25, bloomThreshold: 1.6, halation: 0.05, vignette: 0.3, grain: 0.05, ca: 0.4,
      shake: [amp * (hash(ph, 1) - 0.5) * 2, amp * (hash(ph, 2) - 0.5) * 2],
    };
  }

  /**
   * 後面的信件分類格（螢幕座標，只有桌子遠端以上看得到）：一整面木頭格子，每格裡插著幾封信（露出上緣）、格子下面一個小銅牌；
   * 每兩小節在小節線上有一封信從下面被塞進某一格（往上滑進去、最後頓一下），塞進去之後那一格就多一封。
   */
  private drawCubbies(c: Ctx2, t: number, edgeY: number) {
    const wood = (k: number) => mixRgba('sepia', 'ink', k);
    c.fillStyle = wood(0.45); c.fillRect(0, 0, W, edgeY + 4);
    const cols = 11, rows = 3, cw = W / cols, ch = (edgeY - 20) / rows;
    const filled = (col: number, row: number) => {
      let n = Math.floor(hash(this.seed, col, row, 1) * 3);
      this.arrivals.forEach((ta, i) => { if (t >= ta && this.slotOf(i) === row * cols + col) n++; });
      return n;
    };
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const x = col * cw, y = 10 + row * ch;
      // 格子的深處（暗）、隔板（亮一點的木頭）
      c.fillStyle = wood(0.75); c.fillRect(x + 8, y + 8, cw - 16, ch - 16);
      c.fillStyle = wood(0.3); c.fillRect(x, y, cw, 8); c.fillRect(x, y, 8, ch);
      // 格子裡的信：露出上緣的淺色長條，稍微歪
      const n = filled(col, row);
      for (let k = 0; k < Math.min(n, 4); k++) {
        const lw = cw * (0.55 + 0.2 * hash(this.seed, col, row, k, 2)), lh = ch * 0.42;
        const lx = x + 18 + k * 10 + hash(this.seed, col, row, k, 3) * 10, ly = y + ch - 12 - lh;
        c.save(); c.translate(lx + lw / 2, ly + lh / 2); c.rotate((hash(this.seed, col, row, k, 4) - 0.5) * 0.12);
        // 後面的格子沒被燈照到：信是暗一點的紙色
        c.fillStyle = mixRgba(k % 2 ? 'paper' : 'ash', 'sepia', k % 2 ? 0.4 : 0.3); c.fillRect(-lw / 2, -lh / 2, lw, lh);
        c.restore();
      }
      // 小銅牌
      c.fillStyle = mixRgba('fur', 'sepia', 0.35); c.fillRect(x + cw / 2 - 20, y + ch - 12, 40, 10);
    }
    // 正在被塞進去的信：從格子下面往上滑進去（0.45 秒，最後頓一下）
    this.arrivals.forEach((ta, i) => {
      const u = (t - (ta - 0.45)) / 0.45;
      if (u < 0 || u > 1) return;
      const slot = this.slotOf(i), col = slot % cols, row = Math.floor(slot / cols);
      const x = col * cw + cw * 0.2, y1 = 10 + row * ch + ch * 0.3, y0 = y1 + ch * 1.6;
      const y = lerp(y0, y1, ease.outBack(u, 1.2));
      c.fillStyle = rgba('ink', 0.3); c.fillRect(x + 6, y + 8, cw * 0.6, ch * 0.9);
      c.fillStyle = mixRgba('paper', 'sepia', 0.25); c.fillRect(x, y, cw * 0.6, ch * 0.9);
      c.fillStyle = sigInk(0.6); c.fillRect(x + cw * 0.6 - 26, y + 8, 18, 22);
    });
  }

  /** 第 i 封新信塞進哪一格（種子決定，不會連兩封塞同一格）。 */
  private slotOf(i: number) { return Math.floor(hash(this.seed, i, 11) * 11) + 11 * (i % 3); }

  /**
   * 桌上的東西（桌面座標）：一盞茶蠟燭（俯視：鋁杯、白蠟、燭火是一團暖光，大鼓時跳一下、平常微微閃，照亮旁邊一圈桌面）。
   */
  private drawProps(c: Ctx2, t: number) {
    const au = this.ctx.audio;
    // 茶蠟燭
    const { x, y } = CANDLE;
    const kick = au.hit('kick', t, 0.14);
    const fl = 0.85 + 0.1 * Math.sin(t * 13.1) * Math.sin(t * 7.7) + 0.25 * kick;
    const glow = c.createRadialGradient(x, y, 10, x, y, 240 * fl);
    glow.addColorStop(0, rgba('ember', 0.28 * fl)); glow.addColorStop(1, rgba('ember', 0));
    c.fillStyle = glow; c.beginPath(); c.arc(x, y, 240 * fl, 0, TAU); c.fill();
    c.fillStyle = ink(0.3); c.beginPath(); c.arc(x + 8, y + 10, 58, 0, TAU); c.fill();
    const tin = c.createRadialGradient(x - 18, y - 20, 6, x, y, 58);
    tin.addColorStop(0, mixRgba('bone', 'ash', 0.2)); tin.addColorStop(1, mixRgba('ash', 'graphite', 0.5));
    c.fillStyle = tin; c.beginPath(); c.arc(x, y, 58, 0, TAU); c.fill();
    c.fillStyle = mixRgba('bone', 'paper', 0.4); c.beginPath(); c.arc(x, y, 48, 0, TAU); c.fill();
    c.fillStyle = rgba('ember', 0.25); c.beginPath(); c.arc(x, y, 30, 0, TAU); c.fill();
    const fg = c.createRadialGradient(x, y - 2, 1, x, y, 20 * fl);
    fg.addColorStop(0, rgba('bone', 1)); fg.addColorStop(0.35, rgba('ember', 0.95)); fg.addColorStop(1, rgba('signal', 0));
    c.fillStyle = fg; c.beginPath(); c.arc(x, y, 20 * fl, 0, TAU); c.fill();
  }

  /** 封口：cs = cos(角度)。正的是外側（往下蓋），負的是內襯（往上翻）。 */
  private drawFlap(c: Ctx2, cs: number) {
    const img = cs >= 0 ? this.flapOut! : this.flapIn!;
    const sy = Math.max(Math.abs(cs), 0.004) * (cs >= 0 ? 1 : -1);
    c.save();
    c.scale(1, sy);
    c.drawImage(img.cv, 0, 0, ENV.w, ENV.flap + 4);
    // 翻到接近側面時比較暗（光線斜斜地打在上面）
    if (Math.abs(cs) < 0.999) {
      c.globalAlpha = 0.25 * (1 - Math.abs(cs));
      c.fillStyle = ink(1);
      c.beginPath(); c.moveTo(0, 0); c.lineTo(ENV.w, 0); c.lineTo(ENV.w / 2, ENV.flap); c.closePath(); c.fill();
    }
    c.restore();
  }

  /** 封蠟：裂開之前是一整顆；裂開之後上半跟著封口（top = true）、下半留在信封上，中間噴出幾片蠟屑。 */
  private drawSeal(c: Ctx2, t: number, top: boolean, cs: number) {
    const S = this.seal!;
    const cx = ENV.w / 2, cy = ENV.flap - 16;
    const cracked = t >= this.tCrack;
    if (!cracked && !top) return; // 裂開之前整顆畫在封口上
    const gap = cracked ? 3 + 3 * ease.outCubic(clamp((t - this.tCrack) / 0.15)) : 0;
    c.save();
    if (top) { c.scale(1, cs); }
    c.beginPath();
    // 裂縫：鋸齒的橫線
    const crack: [number, number][] = [];
    for (let i = 0; i <= 10; i++) crack.push([cx - 80 + i * 16, cy + (hash(this.seed, i, 7) - 0.5) * 16 + (i % 2 ? 5 : -5)]);
    if (!cracked) c.rect(cx - 80, cy - 80, 160, 160);
    else if (top) { c.moveTo(cx - 80, cy - 80); c.lineTo(cx + 80, cy - 80); for (let i = crack.length - 1; i >= 0; i--) c.lineTo(crack[i]![0], crack[i]![1] - gap); c.closePath(); }
    else { c.moveTo(cx - 80, cy + 80); c.lineTo(cx + 80, cy + 80); for (let i = crack.length - 1; i >= 0; i--) c.lineTo(crack[i]![0], crack[i]![1] + gap); c.closePath(); }
    c.clip();
    c.fillStyle = ink(0.18);
    c.beginPath(); c.arc(cx + 4, cy + 6, 64, 0, TAU); c.fill();
    c.drawImage(S.cv, cx - 75, cy - 75 + (cracked ? (top ? -gap : gap) : 0), 150, 150);
    c.restore();
    // 蠟屑（只在下半那一次畫）
    if (cracked && !top && t < this.tCrack + 0.6) {
      const u = t - this.tCrack;
      for (let i = 0; i < 9; i++) {
        const a = -Math.PI / 2 + (hash(this.seed, i, 1) - 0.5) * 2.4, v = 160 + 180 * hash(this.seed, i, 2);
        const x = cx + Math.cos(a) * v * u, y = cy + Math.sin(a) * v * u + 700 * u * u;
        c.fillStyle = mixRgba('rose', 'sepia', 0.3, 1 - u / 0.6);
        c.beginPath(); c.arc(x, y, 2.5 + 2 * hash(this.seed, i, 3), 0, TAU); c.fill();
      }
    }
  }

  /** 信封下半部的歌詞（照跟唱規則）；間奏、純音樂寫一句淡淡的註記。 */
  private drawLyricLine(c: Ctx2, t: number) {
    const { lyrics } = this.ctx;
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const st = paperLyric(F.archivo(100, 800), this.lyrPx, LYR.maxW, { lineHeight: 1.12, minSize: V2.lyrMin / this.S });
      const lay = layoutLyric(c, ly.line, st);
      const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.15));
      c.save();
      c.translate(LYR.x, LYR.base + (1 - inK) * 14);
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
    c.font = font(F.hand(700), 46);
    c.fillText(lyrics.has ? '♪（間奏中）' : '♪ 本曲為純音樂，請自行哼唱', LYR.x, LYR.base);
    c.restore();
  }
}

/** 郵票：齒孔的邊、訊號色淡淡的底、版畫線條的「∞」與面額。 */
function drawPostage(c: Ctx2, x: number, y: number, w: number, h: number, i: number) {
  c.save();
  c.translate(x, y);
  c.fillStyle = mixRgba('paper', 'bone', 0.6);
  c.fillRect(0, 0, w, h);
  // 齒孔：邊上一排半圓缺口（用紙的顏色挖）
  c.fillStyle = mixRgba('paper', 'signal', i % 2 ? 0 : 0.06);
  for (let k = 5; k < w; k += 11) { c.beginPath(); c.arc(k, 0, 3.4, 0, TAU); c.arc(k, h, 3.4, 0, TAU); c.fill(); }
  for (let k = 5; k < h; k += 11) { c.beginPath(); c.arc(0, k, 3.4, 0, TAU); c.arc(w, k, 3.4, 0, TAU); c.fill(); }
  c.fillStyle = sigInk(0.3); c.fillRect(10, 10, w - 20, h - 20);
  c.strokeStyle = sigInk(0.9); c.lineWidth = 1;
  for (let k = 12; k < h - 12; k += 4) { c.beginPath(); c.moveTo(12, k); c.lineTo(w - 12, k); c.stroke(); }
  c.fillStyle = mixRgba('paper', 'bone', 0.6); c.fillRect(22, 30, w - 44, h - 70);
  c.fillStyle = sigInk(1); c.textAlign = 'center';
  c.font = font(F.serif(600), 58); c.fillText('∞', w / 2, 86);
  c.font = font(F.mono(600), 12); c.fillText('NT$ ∞', w / 2, h - 20);
  c.textAlign = 'left';
  c.restore();
}

/** 郵戳：圓的日戳（婚禮日期）＋往左拉出去的五條波浪線。 */
function drawPostmark(c: Ctx2, x: number, y: number, rnd: () => number) {
  c.save();
  c.translate(x, y); c.rotate((rnd() - 0.5) * 0.4);
  c.strokeStyle = ink(0.55); c.fillStyle = ink(0.55); c.lineWidth = 2;
  c.beginPath(); c.arc(0, 0, 56, 0, TAU); c.stroke();
  c.textAlign = 'center';
  c.font = font(F.mono(600), 15); c.fillText(STAMP_DATE, 0, 6);
  c.font = font(F.hei(700), 13); c.fillText('喜宴郵局', 0, -22); c.fillText('12', 0, 32);
  c.textAlign = 'left';
  c.lineWidth = 2.2;
  for (let k = 0; k < 5; k++) {
    c.beginPath();
    for (let xx = -70; xx > -330; xx -= 6) { const yy = -40 + k * 20 + 6 * Math.sin(xx * 0.05); if (xx === -70) c.moveTo(xx, yy); else c.lineTo(xx, yy); }
    c.stroke();
  }
  c.restore();
}
