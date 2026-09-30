// 演唱會票根（亮版面）：一張厚棉卡紙的凸版印刷（letterpress）票，平放在桌上，鏡頭斜斜地看著它。
// 招牌是「壓痕的光影」：票面上的字都是壓進紙裡的，一盞從側面打來的燈讓壓痕一邊亮一邊暗（見 ticket-glsl.ts）。
// 照 MV 融合原則：一格只有一個焦點——**主打留言是票面上最大、最清楚的字**；歌詞條中等；
// 其他都是小字、低對比：左上角一行 mono 小字、歌名是沒上墨的「盲壓」（只靠光影看得到）、票根的座位號也是盲壓。
//  - **跟唱就是印刷**：最下面的「NOW PLAYING ♪」條，還沒唱的字只有盲壓（約三成可讀），
//    唱到的字上訊號色的墨，唱完變成墨色。整張票只有這裡用訊號色。
// 一個窗格的節奏（全部落在拍點，任何長度都成立）：
//  - 切進來時票還在半空（離鏡頭近一點、影子散開），第一拍「啪」地落到桌上（畫面一震），一道光掃過票面。
//  - 下一拍起，留言一拍一行壓上去（壓痕與墨同時出現，由左往右像滾筒滾過），寫完的下一拍壓簽名。
//  - 鏡頭：每個小節慢慢往前推一點、在小節線上停住（inOutCubic），也稍微往留言那邊搖。
//  - 每個小節線：燈換一邊（壓痕的亮暗跟著翻，outExpo），剪票鉗在票根「咔」地剪一個愛心洞，
//    剪下來的愛心紙屑（點綴色）彈起來、翻著落到桌上，一片一片堆在票的下緣。小節太少就每兩拍剪一個。
//  - 最後幾拍：齒孔一拍撕開一段（撕到哪、縫就張到哪），最後一拍票根整個分開、沿著桌面往右上被抽走。
// 沒有留言：票面印「本票可兌換一句祝福」＋掃 QR 的說明。新人的留言：左上角的小字改成 HOSTED BY。
// 純音樂：歌詞條是「♪ INSTRUMENTAL · 本曲無歌詞」，先整句盲壓、再一個字一個字上墨。
// 畫法：一個全螢幕 shader（桌布、影子、票、壓痕打光、墨、洞、紙屑、前景）讀三張資料圖層：
// 不變的票面（init 畫一次）、主打留言（init 畫一次，每個字的出現時間編在 B/G 裡）、歌詞條（每格重畫的小條）。
// 透視：用針孔相機把票的四個角投影到螢幕，算出「螢幕 → 票面」的單應矩陣交給 shader。
// v2（留言尺寸標準）：票還是主角（螢幕上約 950 寬、留言那一塊約 640×300），只是往左邊靠，留言 40～60 px；右邊的桌面是舞台：
// 三團有色的舞台燈每個小節線掃到新位置，每個小節線從上面撒一把彩紙，彩紙翻著落到桌上（有影子）、一小節一小節越積越多。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, makeRT, SCALE } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN } from '../engine/palette';
import { F, font, layout, loadText, fitSize, measure } from '../engine/type';
import { fitText, type FitResult } from '../engine/text';
import { clamp, ease, prog, pulse, hash, lerp } from '../engine/util';
import { lyricAt, lyricSubOf, layoutLyric, drawLyric, signature, heartPoints, COUPLE_EN, COUPLE_ZH, type LyricStyle, type LyricLayout } from './_motifs';
import { grid, stagger, pad3, type Grid } from './_t2';
import { homography, applyH, type P2 } from './_t11';
import { TW, TH, PERF, MSG, STRIP, SLOT_W, slotAt, BAKE_FRAG, MAIN_FRAG } from './ticket-glsl';
import { V2, msgMaxFor, lyricV2, sigV2, fitClauses } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'doc', paper: true, energy: [0.3, 1], bars: [4, 8] };

/**
 * 鏡頭：票平放在桌上，先在桌面上轉一點（rz，右邊高一點），再往後倒（tilt：上緣離鏡頭遠）、往右轉一點（yaw：票根離鏡頭遠，
 * 留言比票根大）。D 是鏡頭到票的距離（票面 px），越小透視越強；zoom 從 Z0 慢慢推到 Z1。
 * 這組數字量過：推到最近時票根的字還在 HUD 區（x ≥ 1360 且 y ≥ 830）外面、留言在螢幕上還有 44 px 以上。
 */
const CAM = { rz: -0.06, tilt: 0.4, yaw: 0.1, D: 2300, Z0: 0.74, Z1: 0.78, cx: 700, cy: 560 };
/** 票根的中心（票面座標）：撕下來以後繞這裡轉。 */
const STUB_C = { x: (PERF + TW) / 2, y: TH / 2 };
/** 韓文歌時歌詞條往上長多少（票面 px）：邀請的最後一行約在 y 466，NOW PLAYING 那條線移到 491，中間還留一點空。 */
const KO_UP = 72;
const RECT: P2[] = [{ x: 0, y: 0 }, { x: TW, y: 0 }, { x: TW, y: TH }, { x: 0, y: TH }];

// 資料圖層的「色版」：不是顏色，是 R = 壓痕深度、G = 墨、B = 訊號色的墨（畫在不透明的黑底上）
const BLIND = (a = 1) => `rgba(255,0,0,${a})`;
const INK = (a = 1) => `rgba(255,255,0,${a})`;
const SIGI = (a = 1) => `rgba(255,0,255,${a})`;
/** 印刷的細線：淺淺的壓痕、滿墨。 */
const RULE = (a = 1) => `rgba(110,255,0,${a})`;
/** 低對比的小字：淺壓痕、淡墨。 */
const SMALL = (a = 0.6) => `rgba(120,${Math.round(255 * a)},0,1)`;

const bakeStore = () => ({ rt: makeRT(TW, TH, { depthBuffer: false }), pass: new FSPass(BAKE_FRAG), done: false });
const mainPass = () => new FSPass(MAIN_FRAG, {
  baseTex: { value: null }, msgTex: { value: null }, stripTex: { value: null }, bakeTex: { value: null },
  uRS: { value: new THREE.Vector4(STRIP.x, STRIP.y, STRIP.w, STRIP.h) },
  Hi: { value: new THREE.Matrix3() }, sA: { value: new THREE.Vector3() }, sB: { value: new THREE.Vector3() },
  sep: { value: 0 }, tearY: { value: 0 }, lightDir: { value: new THREE.Vector2(-0.7, -0.7) }, depth: { value: 2.4 }, sheen: { value: -1e4 },
  msgT: { value: 0 }, msgRamp: { value: 0.02 }, punchN: { value: 0 },
  chadP: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) }, chadR: { value: new Array(8).fill(0) },
  shM: { value: new THREE.Vector4() }, shS: { value: new THREE.Vector4() }, jagSeed: { value: 0 },
  spot: { value: Array.from({ length: 3 }, () => new THREE.Vector4()) }, spotC: { value: Array.from({ length: 3 }, () => new THREE.Vector3()) },
});

type Aff = [number, number, number, number, number, number]; // x' = a x + b y + c；y' = d x + e y + f
const apply = (m: Aff, x: number, y: number) => ({ x: m[0] * x + m[1] * y + m[2], y: m[3] * x + m[4] * y + m[5] });
function invert(m: Aff): Aff {
  const det = m[0] * m[4] - m[1] * m[3];
  const a = m[4] / det, b = -m[1] / det, d = -m[3] / det, e = m[0] / det;
  return [a, b, -(a * m[2] + b * m[5]), d, e, -(d * m[2] + e * m[5])];
}
/** 繞 (px, py) 轉 r、再平移 (dx, dy)。 */
const rotAbout = (px: number, py: number, r: number, dx = 0, dy = 0): Aff => {
  const c = Math.cos(r), s = Math.sin(r);
  return [c, -s, px - c * px + s * py + dx, s, c, py - s * px - c * py + dy];
};

/** 針孔相機：票面上的一點（離桌面 lift 高）投影到螢幕。 */
function project(qx: number, qy: number, zoom: number, cx: number, cy: number, lift = 0): P2 {
  let x = qx - TW / 2, y = qy - TH / 2;
  const c = Math.cos(CAM.rz), s = Math.sin(CAM.rz);
  [x, y] = [c * x - s * y, s * x + c * y];
  let z = y * Math.sin(CAM.tilt) + lift;
  y *= Math.cos(CAM.tilt);
  z -= x * Math.sin(CAM.yaw);
  x *= Math.cos(CAM.yaw);
  const k = (zoom * CAM.D) / (CAM.D - z);
  return { x: cx + x * k, y: cy + y * k };
}

export default class Ticket extends Scene {
  pass = shared('ticket.main', mainPass);
  bake = shared('ticket.bake', bakeStore);
  /** 不變的票面（資料圖層）。票面座標，只在 init 畫一次、上傳一次。 */
  base = this.track(new Layer2D(TW, TH, SCALE, { fast: true }));
  /** 主打留言（資料圖層，B/G = 每個字壓下去的時間碼）。 */
  msgL = this.track(new Layer2D(MSG.w, MSG.h, SCALE, { fast: true }));
  /** 歌詞條（資料圖層，每格重畫）。高度要等 init 知道是不是韓文歌才定（sY／sH）。 */
  strip!: Layer2D;
  /** 歌詞條在票面上的上緣與高度：平常就是 STRIP；韓文歌（沒有留言、有原文）往上長 KO_UP，放中文＋原文兩段。 */
  sY: number = STRIP.y; sH: number = STRIP.h;
  /** 彩紙（落在桌上的紙片與它們的影子）。 */
  conf = this.track(new LineBatch(1024, { screen2D: true, blend: 'normal' }));
  /** 票面 px → 螢幕 px 的縮放（留言、歌詞條那一帶）：v2 的字級是螢幕 px，畫在票面上要除以它。 */
  kMsg = 0.63; kLy = 0.63;
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = (this.ctx.params.seed ?? 1) as number;
  g!: Grid;
  P = 0.5;
  tLand = 0;
  /** 留言的時間碼：t0 起、span 秒（時間碼 0..1）。 */
  msgT0 = 0; msgSpan = 1;
  punches: number[] = [];
  rips: number[] = [];
  slide = Infinity;
  instr = false;
  /** 純音樂：歌詞條每個字上墨的時間。 */
  instrText = '♪ INSTRUMENTAL · 本曲無歌詞';
  instrT: number[] = [];
  /** 歌詞條的字級跟著留言走：有留言時比留言小一號（中等，≥ 52），沒留言時歌詞是主角。 */
  ly: LyricStyle = { family: F.archivo(100, 500), size: 66, minSize: 52, maxWidth: STRIP.w - 16, align: 'left', lineHeight: 1.1 };
  lyData: LyricStyle = { ...this.ly };

  override async init() {
    const { audio: au, lyrics, song, start: s, end: e, renderer } = this.ctx;
    const m = this.msg;
    this.instr = !lyrics.has;
    await loadText(`${song.title}${m ? m.text + m.name : ''}${this.instrText}本票可兌換一句祝福掃描右下角寫下你的祝福它會印在下一張票上喜宴場入場二位一位賓客${COUPLE_ZH}`);
    const g = this.g = grid(au, s, e);
    const P = this.P = g.beat;
    // 韓文歌：邀請只用到留言區的上半，歌詞條可以往上長（NOW PLAYING 那條線跟著上移），中文下面才放得下原文
    if (!m && lyrics.linesIn(s - 1, e + 1).some((l) => !!lyricSubOf(l))) { this.sY = STRIP.y - KO_UP; this.sH = STRIP.h + KO_UP; }
    this.strip = this.track(new Layer2D(STRIP.w, this.sH, SCALE, { fast: true }));
    // ---- 時間表
    this.tLand = g.b0;
    const bLand = Math.round(au.beatAt(this.tLand));
    const beat = (k: number) => au.timeOfBeat(bLand + k);
    const nb = Math.max(1, Math.round(au.beatAt(e) - au.beatAt(s)));
    // 撕票根：最後幾拍一拍撕一段，最後一拍滑走（窗格太短就少撕幾段，再短就不撕）
    const be = Math.round(au.beatAt(e));
    const steps = nb >= 10 ? 3 : nb >= 6 ? 2 : nb >= 4 ? 1 : 0;
    if (steps > 0) {
      this.rips = Array.from({ length: steps }, (_, k) => au.timeOfBeat(be - steps - 1 + k));
      this.slide = au.timeOfBeat(be - 1);
    }
    const tearStart = this.rips[0] ?? e;
    // 剪票：落定之後的小節線；小節線太少就每兩拍一個（最多八個）
    let cands = g.bars.filter((b) => b > this.tLand + 0.4 * P && b < tearStart - 0.3 * P);
    if (cands.length < 3) {
      cands = [];
      for (let k = 2; k < 64; k += 2) { const tb = beat(k); if (tb >= tearStart - 0.3 * P) break; cands.push(tb); }
    }
    this.punches = cands.slice(0, 8);

    // 票面上留言、歌詞條那一帶在螢幕上的縮放（鏡頭推到一半的時候量）
    const zm = (CAM.Z0 + CAM.Z1) / 2;
    const kAt = (x: number, y: number) => { const a = project(x - 50, y, zm, CAM.cx, CAM.cy), b = project(x + 50, y, zm, CAM.cx, CAM.cy); return Math.hypot(b.x - a.x, b.y - a.y) / 100; };
    this.kMsg = kAt(MSG.x + MSG.w / 2, MSG.y + MSG.h / 2);
    this.kLy = kAt(STRIP.x + STRIP.w / 2, STRIP.y + STRIP.h / 2);
    this.drawBase();
    const msgSize = this.drawMessage(beat);
    // 歌詞條（v2）：有留言時比留言小一級（lyricV2），沒留言時 52；都是螢幕 px，換成票面 px
    this.ly = { ...this.ly, size: (m ? lyricV2(msgSize * this.kMsg) : V2.lyrMax) / this.kLy, minSize: V2.lyrMin / this.kLy };
    this.lyData = { ...this.ly, unsung: BLIND(), active: SIGI(), sung: INK() };
    // 純音樂：歌詞條一個字一個字上墨（兩小節內上完）
    if (this.instr) this.instrT = stagger(au, beat(1), Array.from(this.instrText).length, Math.min(g.bar * 2, Math.max(0.6, e - beat(1) - 1)));

    this.base.upload(); this.msgL.upload();
    renderer.initTexture(this.base.texture);
    renderer.initTexture(this.msgL.texture);
    if (!this.bake.done) { this.bake.pass.render(renderer, this.bake.rt); this.bake.done = true; }
  }

  // ---------------------------------------------------------------- 畫資料圖層
  /** 不變的票面：只有細線、三小群低對比的小字、兩個盲壓（歌名、座位號）與剪票處的虛線愛心。 */
  private drawBase() {
    const { song } = this.ctx;
    const m = this.msg;
    const L = this.base, c = L.ctx;
    L.clear('#000');
    c.globalCompositeOperation = 'lighter';
    c.textBaseline = 'alphabetic';
    const text = (s: string, x: number, y: number, fam: string, size: number, col: string, o: { track?: number; align?: CanvasTextAlign } = {}) => {
      c.font = font(fam, size); c.letterSpacing = `${o.track ?? 0}px`; c.textAlign = o.align ?? 'left';
      c.fillStyle = col; c.fillText(s, x, y);
      c.letterSpacing = '0px'; c.textAlign = 'left';
    };
    // 外框：外圈盲壓、內圈淡墨的細線（主票與票根各一個框，中間是齒孔）
    c.lineWidth = 3; c.strokeStyle = BLIND(0.7);
    c.beginPath(); c.roundRect(18, 18, TW - 36, TH - 36, 8); c.stroke();
    c.lineWidth = 1.3; c.strokeStyle = RULE(0.55);
    c.strokeRect(30, 30, PERF - 46, TH - 60);
    c.strokeRect(PERF + 16, 30, TW - PERF - 46, TH - 60);

    // ---- 主票左上：一行 mono 小字＋歌名的盲壓（沒上墨，只靠光影）
    const x0 = 52, x1 = PERF - 32;
    const hdr = m?.couple ? `HOSTED BY ${COUPLE_EN.toUpperCase()}` : 'LIVE · ONE NIGHT ONLY · 喜宴場';
    text(hdr, x0, 66, F.mono(500), 15, SMALL(0.55), { track: 4 });
    const tf = F.archivo(100, 900);
    let title = song.title || '今晚的歌';
    let ts = Math.min(46, fitSize(title, tf, x1 - x0, 46));
    if (ts < 30) {
      let ch = Array.from(title);
      while (ch.length > 2 && measure(ch.join('') + '…', tf, 30) > x1 - x0) ch = ch.slice(0, -1);
      title = ch.join('') + '…'; ts = 30;
    }
    text(title, x0 - 2, 122, tf, ts, BLIND(0.55));
    c.fillStyle = RULE(0.4); c.fillRect(x0, 144, x1 - x0, 1.1);
    // 歌詞條的標題：NOW PLAYING ♪ ＋一條線
    const np = 'NOW PLAYING ♪';
    const up = STRIP.y - this.sY;
    text(np, x0, 568 - up, F.mono(500), 13, SMALL(0.5), { track: 4 });
    const nw = measure(np, F.mono(500), 13, 4);
    c.fillStyle = RULE(0.4); c.fillRect(x0 + nw + 16, 563 - up, x1 - x0 - nw - 16, 1.1);

    // ---- 票根：一小群小字、座位號（= 留言編號）是盲壓，剪票處八個虛線愛心
    const cx = (PERF + TW) / 2;
    text('ADMIT TWO', cx, 78, F.mono(500), 15, SMALL(0.55), { track: 5, align: 'center' });
    text('入場二位　SEAT', cx + 3, 104, F.hei(500), 14, SMALL(0.45), { track: 4, align: 'center' });
    const seat = m ? pad3(m.n) : '♥';
    const sf = F.archivo(62, 900);
    text(seat, cx, 290, sf, Math.min(124, fitSize(seat, sf, 210, 124)), BLIND(0.55), { align: 'center' });
    const hp = heartPoints(48);
    c.setLineDash([3.5, 3.5]); c.lineWidth = 1.2; c.strokeStyle = RULE(0.4);
    for (let i = 0; i < 8; i++) {
      const p = slotAt(i), s = (SLOT_W + 12) / 2;
      c.beginPath();
      hp.forEach((q, k) => (k ? c.lineTo(p.x + q.x * s, p.y + q.y * s) : c.moveTo(p.x + q.x * s, p.y + q.y * s)));
      c.closePath(); c.stroke();
    }
    c.setLineDash([]);
    c.globalCompositeOperation = 'source-over';
  }

  /** 主打留言（或邀請）：一拍一行，由左往右像滾筒滾過；時間碼寫在 B/G。回傳留言的字級。 */
  private drawMessage(beat: (k: number) => number): number {
    const { end: e } = this.ctx;
    const m = this.msg, P = this.P;
    const L = this.msgL, c = L.ctx;
    L.clear('#000');
    c.globalCompositeOperation = 'lighter';
    c.textBaseline = 'alphabetic';
    // 要壓的每一行：[文字, 字族, 字級, x, 基線 y]（圖層座標；圖層左上角在票面的 MSG.x, MSG.y）
    const rows: { s: string; fam: string; size: number; x: number; y: number; right?: boolean }[] = [];
    // 留言的框：票面最大的一塊（圖層 y 6..390 = 票面 162..546），留言＋署名一起放進去。最小 52：斜放以後螢幕上還有 44 以上
    const BOX = { x: 4, y: 6, w: MSG.w - 8, h: 384 };
    // 署名那一行（間距＋字高）先從可用高度扣掉，留言的字級只用剩下的高度找——署名才不會被最後一行蓋住
    // v2：留言 40～60（依字數的上限 msgMaxFor）、署名 26～32，都是螢幕 px，除以縮放換成票面 px
    const k = this.kMsg;
    const SIG_SIZE = sigV2((m ? msgMaxFor(m.text) : 44)) / k, SIG_GAP = SIG_SIZE * 0.6, SIG_H = SIG_GAP + SIG_SIZE;
    let size = 0;
    if (m) {
      const fam = F.ming(700);
      const opt = { min: V2.msgMin / k, max: msgMaxFor(m.text) / k, lineHeight: 1.22, maxLines: 6 };
      const fit: FitResult = fitClauses(c, m.text, fam, BOX.w, BOX.h - SIG_H, opt) ?? fitText(c, m.text, fam, BOX.w, BOX.h - SIG_H, opt);
      size = fit.size;
      // 留言＋署名整塊垂直置中；署名永遠接在最後一行的下面
      const top = BOX.y + Math.max(0, (BOX.h - fit.height - SIG_H) / 2);
      fit.lines.forEach((ln, i) => rows.push({ s: ln, fam, size: fit.size, x: BOX.x, y: top + fit.size * 0.86 + i * fit.lineHeight }));
      const sig = m.couple ? `—— ${m.name || COUPLE_ZH}` : signature(m.name);
      rows.push({ s: sig, fam: F.hand(700), size: SIG_SIZE, x: MSG.w - 6, y: top + fit.height + SIG_GAP + SIG_SIZE * 0.86, right: true });
    } else {
      // 邀請：標題照留言的字級（螢幕 52），說明小一點（螢幕 30）
      size = 52 / k;
      const sub = 28 / k;
      rows.push({ s: '本票可兌換一句祝福', fam: F.ming(700), size, x: BOX.x, y: 40 + size * 0.86 });
      // 說明分三行（票面窄，一行放不下「掃描…祝福，」會壓到齒孔）
      ['掃描右下角 QR code，', '寫下你的祝福，', '它會印在下一張票上。'].forEach((ln, i) =>
        rows.push({ s: ln, fam: F.hei(500), size: sub, x: BOX.x, y: 40 + size * 1.25 + sub * (1.3 + 1.45 * i) }));
    }
    // 一拍一行（簽名跟最後一行隔半拍）；窗格短就半拍一行，保證壓完之後還有兩秒讀
    let per = P;
    const t0 = beat(1);
    while (per > P / 4 + 1e-3 && t0 + rows.length * per > e - 2) per /= 2;
    const roll = Math.min(0.16, per * 0.45);
    const times = rows.map((_, i) => t0 + i * per - (m && i === rows.length - 1 ? per * 0.5 : 0));
    this.msgT0 = t0;
    this.msgSpan = Math.max(0.3, times[times.length - 1]! + roll - t0);
    rows.forEach((r, i) => {
      const lay = layout(r.s, r.fam, r.size);
      c.font = font(r.fam, r.size);
      const x = r.right ? r.x - lay.width : r.x;
      for (const gl of lay.glyphs) {
        const tc = times[i]! + (gl.x / Math.max(1, lay.width)) * roll;
        const code = Math.round(255 * clamp((tc - t0) / this.msgSpan));
        // 愛心：深度只有一半（R/G = 0.5），shader 看這個比例改用點綴色的墨
        c.fillStyle = `rgb(${gl.ch === '♥' ? 128 : 255},255,${code})`;
        c.fillText(gl.ch, x + gl.x, r.y);
      }
    });
    c.globalCompositeOperation = 'source-over';
    return m ? size : 44 / k;
  }

  /** 歌詞條（每格）：盲壓 → 上訊號色的墨 → 墨色。 */
  private drawStrip(t: number) {
    const L = this.strip, c = L.ctx;
    L.clear('#000');
    c.textBaseline = 'alphabetic';
    if (this.instr) {
      // 純音樂：整句先盲壓（落定時一起壓下去），再一個字一個字上墨
      const k = prog(t, this.tLand, this.tLand + 0.12, ease.outCubic);
      if (k <= 0) { L.upload(); return; }
      // 這一行只是「沒有歌詞」的說明，不是焦點：小一號、墨淡一點
      const fam = this.ly.family, size = Math.min(38, fitSize(this.instrText, fam, STRIP.w - 24, 38));
      const lay = layout(this.instrText, fam, size);
      c.font = font(fam, size);
      c.globalAlpha = k;
      for (const gl of lay.glyphs) {
        const tc = this.instrT[gl.i] ?? Infinity;
        c.fillStyle = t < tc ? BLIND(0.8) : t < tc + 0.3 ? SIGI(0.8) : 'rgba(200,170,0,1)';
        c.fillText(gl.ch, 8 + gl.x, 80);
      }
      c.globalAlpha = 1;
      L.upload();
      return;
    }
    const ly = lyricAt(this.ctx.lyrics, t);
    if (ly) {
      let lay = layoutLyric(c, ly.line, this.ly), st = this.lyData;
      let y0 = lay.rows.length > 1 ? lay.size * 0.92 + 2 : STRIP.h * 0.5 + lay.size * 0.36;
      if (lay.sub) {
        // 韓文歌：中文＋原文（drawLyric 自動畫原文：盲壓 → 上墨，比中文淡兩成、不上訊號色的墨）一起放進長高的歌詞條；
        // 放不下就一起縮（中文不小於 lyrMin），兩段垂直置中
        const tall = (l: LyricLayout) => l.height + (l.sub ? l.sub.lay.size * 0.25 : 0);
        for (let k = 1; k < 10 && tall(lay) > this.sH - 8 && lay.size > (this.ly.minSize ?? 0) + 0.5; k++) {
          const size = Math.max(this.ly.minSize ?? 0, (this.ly.size) * Math.pow(0.93, k));
          st = { ...this.lyData, size };
          lay = layoutLyric(c, ly.line, { ...this.ly, size });
        }
        y0 = Math.max(4, (this.sH - tall(lay)) / 2) + lay.size * 0.92;
      } else if (this.sH > STRIP.h) {
        // 韓文歌裡沒有原文的行（兩行一樣的句子）：在長高的歌詞條裡一樣垂直置中
        y0 = (this.sH - lay.height) / 2 + lay.size * 0.92;
      }
      c.save();
      // 基線照字級算：兩行時第一行貼上緣，一行時垂直置中
      c.translate(8, y0);
      drawLyric(c, ly.line, t, st, lay, ly.k);
      c.restore();
    }
    L.upload();
  }

  // ---------------------------------------------------------------- 每格
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, P = this.P;
    const u = this.pass.u;

    // ---- 落下：切進來時在半空，第一拍落到桌上、微微彈一下
    let z = 1 - prog(t, s, this.tLand, ease.inQuad);
    if (t > this.tLand) z = 0.03 * Math.sin(Math.PI * clamp((t - this.tLand) / 0.2));
    // ---- 鏡頭：每個小節推一點、在小節線停住；順便往留言那邊（左）搖一點
    const bars = this.g.bars.filter((b) => b > this.tLand - 0.05);
    let push = 0;
    for (let i = 0; i < bars.length; i++) push += prog(t, bars[i]!, bars[i + 1] ?? bars[i]! + this.g.bar, ease.inOutCubic);
    const pk = bars.length ? push / bars.length : 0;
    const zoom = lerp(CAM.Z0, CAM.Z1, pk), cx = CAM.cx - 14 * pk, cy = CAM.cy - 6 * pk;
    const lift = 170 * z;
    const quad = RECT.map((p) => project(p.x, p.y, zoom, cx, cy, lift));
    const Hs = homography(RECT, quad); // 票面 → 螢幕
    const Hi = homography(quad, RECT); // 螢幕 → 票面
    (u.Hi!.value as THREE.Matrix3).set(Hi[0]!, Hi[1]!, Hi[2]!, Hi[3]!, Hi[4]!, Hi[5]!, Hi[6]!, Hi[7]!, Hi[8]!);
    (u.shM!.value as THREE.Vector4).set(12 + 50 * z, 20 + 66 * z, 12 + 40 * z, 0.3 - 0.12 * z);

    // ---- 撕票根：一拍撕一段，最後一拍分開、沿著桌面往右上（遠處）被抽走（往下會掃進右下角的 QR 區）
    const nr = this.rips.length;
    let torn = 0;
    this.rips.forEach((r) => (torn += prog(t, r, r + 0.09, ease.outExpo)));
    u.tearY!.value = nr ? (TH * torn) / nr : 0;
    const sep = t >= this.slide;
    u.sep!.value = sep ? 1 : 0;
    if (sep) {
      // 票面座標裡的平移旋轉（透視交給單應矩陣）
      const slideV = prog(t, this.slide, this.slide + P * 0.95, ease.inQuad);
      const S = rotAbout(STUB_C.x, STUB_C.y, -0.16 * slideV - 0.03 * prog(t, this.slide, this.slide + 0.08), 320 * slideV, -600 * slideV);
      const Si = invert(S);
      u.sA!.value.set(Si[0], Si[1], Si[2]); u.sB!.value.set(Si[3], Si[4], Si[5]);
      (u.shS!.value as THREE.Vector4).set(16 + 26 * slideV, 24 + 40 * slideV, 14 + 26 * slideV, 0.28 - 0.1 * slideV);
    }

    // ---- 燈：從側面來，每個小節線換一邊（左上 ↔ 右上），outExpo
    const A = [-2.3, -0.85];
    let a = A[0]!, k = 0;
    for (const b of this.g.bars) {
      if (b <= this.tLand + 0.05) continue;
      k++;
      a = lerp(a, A[k % 2]!, prog(t, b, b + 0.5, ease.outExpo));
    }
    (u.lightDir!.value as THREE.Vector2).set(Math.cos(a), Math.sin(a));
    // 壓痕跟著大鼓稍微深一點點（字在呼吸）
    u.depth!.value = 2.5 * (1 + 0.14 * f.a.kick);
    // 掃過去的光：落定那一拍
    const sw = prog(t, this.tLand, this.tLand + 0.75, ease.inOutCubic);
    u.sheen!.value = sw > 0 && sw < 1 ? lerp(-500, TW + 700, sw) : -1e4;

    // ---- 留言、剪票
    u.msgT!.value = (t - this.msgT0) / this.msgSpan;
    u.msgRamp!.value = 0.05 / this.msgSpan;
    u.punchN!.value = this.punches.filter((p) => p <= t).length;
    this.chads(t, Hs, zoom);
    u.jagSeed!.value = (this.seed % 97) * 0.37;

    this.spots(t, f.a.kick);
    this.drawStrip(t);
    u.baseTex!.value = this.base.texture;
    u.msgTex!.value = this.msgL.texture;
    u.stripTex!.value = this.strip.texture;
    (u.uRS!.value as THREE.Vector4).set(STRIP.x, this.sY, STRIP.w, this.sH);
    u.bakeTex!.value = this.bake.rt.texture;
    this.pass.render(renderer, out);
    this.confetti(t);
    if (this.conf.count) this.conf.render(renderer, out);

    // ---- 震動：落定最大、剪票與撕票小一點
    let shk = 1.0 * pulse(t, this.tLand, 0.07);
    for (const p of this.punches) shk += 0.45 * pulse(t, p, 0.05);
    for (const r of this.rips) shk += 0.6 * pulse(t, r, 0.05);
    const ph = Math.floor(t * 60);
    const shake: [number, number] = [shk * 5 * (hash(ph, 1) - 0.5), shk * 7 * (hash(ph, 2) - 0.5)];
    return {
      paper: 1, bloom: 0.2, bloomThreshold: 1.1, halation: 0.05, vignette: 0.3, grain: 0.045, ca: 0.8,
      shake, zoom: 1 + 0.008 * pulse(t, this.tLand, 0.1),
    };
  }

  /** 舞台燈：三團有色的光，每個小節線掃到新的位置（outExpo，三團錯開一點點），平常很慢地晃；大鼓時亮一下。 */
  private spots(t: number, kick: number) {
    const U = this.pass.u;
    const PV = U.spot!.value as THREE.Vector4[], CV = U.spotC!.value as THREE.Vector3[];
    const cols = [LIN.signal, LIN.ember, LIN.bone], amp = [0.34, 0.26, 0.16];
    const on = prog(t, this.ctx.start, this.tLand, ease.outCubic);
    for (let i = 0; i < 3; i++) {
      // 光落的位置都在票的右邊、上面（桌面上），偶爾擦過票根
      const at = (k: number) => ({ x: 1000 + 800 * hash(this.seed, i, k, 1), y: 140 + 640 * hash(this.seed, i, k, 2) });
      let p = at(0);
      this.g.bars.forEach((b, k) => {
        const q = at(k + 1), u = prog(t, b + i * 0.06, b + i * 0.06 + 0.55, ease.outExpo);
        p = { x: lerp(p.x, q.x, u), y: lerp(p.y, q.y, u) };
      });
      PV[i]!.set(p.x + 40 * Math.sin(t * 0.37 + i * 2.1), p.y + 26 * Math.cos(t * 0.29 + i * 1.3), 380 + 70 * i, amp[i]! * on * (1 + 0.25 * kick));
      CV[i]!.set(cols[i]![0], cols[i]![1], cols[i]![2]);
    }
  }

  /**
   * 彩紙：落定那一拍和之後每個小節線，從畫面上方撒下一把（九片），翻著、晃著落到票右邊的桌面上，
   * 落地以後就留在那裡（有影子）——窗格越長桌上越熱鬧。落點避開票和右下角的 QR 區。全部是種子決定的，確定性。
   */
  private confetti(t: number) {
    const lb = this.conf;
    lb.clear();
    const bursts = [this.tLand, ...this.g.bars.filter((b) => b > this.tLand + 0.3)];
    const cols = [LIN.signal, LIN.ember, LIN.blood, LIN.sepia];
    const pieces: { sx: number; sy: number; x: number; y: number; dx: number; dy: number; w: number; u: number; c: [number, number, number] }[] = [];
    bursts.forEach((tb, bi) => {
      for (let j = 0; j < 9; j++) {
        const h = (k: number) => hash(this.seed, bi, j, k);
        const ts = tb + 0.04 * j;
        if (t < ts) continue;
        const fall = 0.8 + 0.6 * h(1);
        const u = clamp((t - ts) / fall), air = 1 - u;
        // 落點：票的右邊與上緣的桌面（不落在票上、不落在右下角的 QR 底下）
        let lx = 1210 + 620 * h(2), ly = 130 + 680 * h(3);
        if (lx > 1330 && ly > 760) ly -= 330;
        const fl = Math.sin(7 * (t - ts) + h(4) * 6) * 46 * air;
        const spin = (h(5) - 0.5) * 14;
        const ang = h(6) * Math.PI + spin * Math.min(t - ts, fall);
        const flip = u < 1 ? 0.2 + 0.8 * Math.abs(Math.cos(9 * (t - ts) + h(7) * 3)) : 0.35 + 0.65 * h(8);
        const len = (12 + 10 * h(9)) * (1 + 0.6 * air) * flip, w = (7 + 3 * h(10)) * (1 + 0.6 * air);
        pieces.push({ sx: lx, sy: ly, x: lx + fl, y: ly - 760 * air, dx: (Math.cos(ang) * len) / 2, dy: (Math.sin(ang) * len) / 2, w, u, c: cols[Math.floor(h(11) * cols.length)]! });
      }
    });
    // 先畫全部的影子（落點；越接近桌面越濃），再畫紙片
    const sh = LIN.sepia;
    for (const q of pieces) lb.seg2(q.sx - q.dx + 3, q.sy - q.dy + 4, q.sx + q.dx + 3, q.sy + q.dy + 4, q.w, [sh[0], sh[1], sh[2]], 0.06 + 0.14 * q.u);
    for (const q of pieces) lb.seg2(q.x - q.dx, q.y - q.dy, q.x + q.dx, q.y + q.dy, q.w, [q.c[0] * 0.95, q.c[1] * 0.95, q.c[2] * 0.95], 0.95);
  }

  /**
   * 剪下來的愛心紙屑：先往上彈（離開桌面、往鏡頭靠近、變大），再翻著落回桌面，停在票的下緣外面。
   * 位置在票面座標裡算（桌面跟票是同一個平面，透視交給單應矩陣），往上彈的高度直接加在螢幕的 y 上。
   */
  private chads(t: number, Hs: number[], zoom: number) {
    const PV = this.pass.u.chadP!.value as THREE.Vector4[];
    const R = this.pass.u.chadR!.value as number[];
    for (let i = 0; i < 8; i++) {
      const tp = this.punches[i];
      const a = tp === undefined ? -1 : t - tp;
      if (a < 0) { PV[i]!.set(0, 0, 0, 0); R[i] = 0; continue; }
      const h1 = hash(this.seed, i, 1), h2 = hash(this.seed, i, 2), h3 = hash(this.seed, i, 3);
      const p0 = slotAt(i);
      // 落點：票的下緣外面（票面座標），往左散開
      const rest = { x: p0.x - 60 - 300 * h1, y: TH + 34 + 50 * h2 };
      const spin = (h3 > 0.5 ? 1 : -1) * (5 + 4 * h2);
      const pop = 0.07, dur = 0.55 + 0.1 * h3;
      if (a < pop) {
        // 剛剪下來：在洞的位置往上浮一點（變大）
        const p = applyH(Hs, p0.x, p0.y);
        PV[i]!.set(p.x, p.y, 1, zoom * (1 + 0.35 * (a / pop))); R[i] = 0;
        continue;
      }
      const v = clamp((a - pop) / dur);
      // 在桌面上的位置：前段快、後段慢；離開桌面的高度：拋物線
      const w = ease.outQuad(v);
      const p = applyH(Hs, lerp(p0.x, rest.x, w), lerp(p0.y, rest.y, w));
      const hgt = 4 * v * (1 - v) * 150;
      if (v < 1) {
        PV[i]!.set(p.x, p.y - hgt, Math.cos(1.3 + 12 * (a - pop)), zoom * (1.2 + hgt / 500));
        R[i] = spin * (a - pop);
      } else {
        // 落地：翻成平的（正面或背面朝上），彈一下
        const fin = Math.cos(1.3 + 12 * dur);
        const after = a - pop - dur;
        const bounce = 8 * Math.max(0, Math.sin(Math.PI * clamp(after / 0.16))) * (1 - clamp(after / 0.16));
        const sx = lerp(fin, fin >= 0 ? 1 : -1, prog(after, 0, 0.12, ease.outCubic));
        PV[i]!.set(p.x, p.y - bounce, sx, zoom * 1.1);
        R[i] = spin * dur;
      }
    }
  }
}
