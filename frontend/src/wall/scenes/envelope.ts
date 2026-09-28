// 信封與郵票（亮版面）：桌上散著好幾封寄給新人的信（信封正面：郵票、郵戳、手寫的「宣文 & 孟庭 收」），
// 最上面這一封翻在背面、封口是一顆點綴色的愛心封蠟。一個窗格的動作全部落在拍點上（窗格短就半拍一步）：
//  - 切進來：信封「丟」到信堆上（從大一點、高一點的地方落下，影子收回來），落在第一個拍點；
//  - 下一拍：到達戳「碰」地蓋在信封背面（喜宴郵局、婚禮日期）；
//  - 下一拍：封蠟裂開（上半跟著封口、下半留在信封上，蠟屑噴出來）；
//  - 下一拍：封口掀開（繞著摺線翻過去，翻到背面是訊號色的內襯）；
//  - 接下來兩拍：信紙一段一段抽出來，鏡頭跟著往上移——信紙上是主打留言（手寫字）與署名。
//  - 最後一個小節線：信紙右上角蓋一個「已讀」的小章。
// 歌詞寫在信封下半部（封口下面）：信紙抽出來的時候信封跟著往下，歌詞一直都在，照跟唱規則逐字亮。
// 沒有留言：信紙寫邀請；新人的留言：信是新人寫給大家的（「親愛的各位：」）。
// 畫法：信堆（背景的信封）、信封本體、封口的外側與內襯、封蠟、信紙都在開場畫成離屏畫布；每格只是把它們放到對的位置
// （封口翻開是垂直方向的縮放，cos 從 1 到 -1；負的時候畫內襯）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { mixRgba, rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, mulberry32, prog, pulse, frameIdx, TAU } from '../engine/util';
import type { FitResult } from '../engine/text';
import { lyricAt, drawLyric, layoutLyric, beatAfter, heartPoints, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { sigInk, ink, paper, paperLyric, makeCanvas, freeCanvas, shadowSprite, drawShadow, barsIn, paperPass, ensureBake, themeKey, inkStamp, arcText, fitMsg, yieldFrame, type Rect } from './_t1';

export const spec: PlateSpecDecl = { group: 'type', family: 'doc', paper: true, energy: [0.15, 0.8], bars: [4, 8], weight: 1 };

type Ctx2 = CanvasRenderingContext2D;

/** 信封（信封座標：左上角 0,0）。放好時左上角在螢幕 (X, Y0)，信紙抽出來之後整個往下移 DROP。 */
const ENV = { w: 1040, h: 560, x: 300, y: 250, flap: 290 };
const DROP = 200;
/** 信紙：寬、露出來之後的上緣（螢幕）；信紙座標的內容位置。 */
const LET = { w: 960, top: 80, h: 520 };
const LMSG = { x: 56, y: 104, w: 850, h: 214 };
/** 歌詞（信封座標）。 */
const LYR = { x: 60, base: 440, maxW: 920 };

const TEXT = '親愛的各位宣文孟庭收喜宴會場第桌到達喜宴郵局寄件人一位賓客已讀掃描右下角把祝福寫上大螢幕間奏中本曲為純音樂請自行哼唱此刻正在播放的歌';

export default class Envelope extends Scene {
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  pass = shared('envelope.paper', () => paperPass());
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
  avoid: Rect[] = [];

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
    await yieldFrame();
    this.buildArt(others);
    this.avoid = [[ENV.x + (ENV.w - LET.w) / 2 - 10, LET.top - 10, LET.w + 20, 380], [ENV.x + LYR.x - 10, ENV.y + LYR.base - 70, LYR.maxW + 20, DROP + 170]];
  }

  override dispose() {
    for (const c of [this.desk, this.body, this.flapOut, this.flapIn, this.seal, this.letter, this.stamp, this.read, this.sh]) freeCanvas(c);
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
    const piles: [number, number, number][] = [[250, 170, 0.22], [1690, 420, -0.18], [330, 930, -0.12], [1620, 90, 0.1]];
    piles.forEach(([cx, cy, rot], i) => {
      const c = d.c;
      c.save();
      c.translate(cx, cy); c.rotate(rot);
      const w = 820, h = 460;
      c.fillStyle = ink(0.14); c.fillRect(-w / 2 + 8, -h / 2 + 12, w, h);
      c.fillStyle = mixRgba('paper', i % 2 ? 'bone' : 'signal', i % 2 ? 0.35 : 0.06); c.fillRect(-w / 2, -h / 2, w, h);
      c.strokeStyle = ink(0.12); c.lineWidth = 1; c.strokeRect(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1);
      // 郵票（齒孔邊）＋郵戳（圓的日戳＋波浪線）
      drawPostage(c, w / 2 - 150, -h / 2 + 30, 110, 132, i);
      drawPostmark(c, w / 2 - 170, -h / 2 + 110, rnd);
      // 手寫的收件人、寄件人
      c.fillStyle = ink(0.85);
      c.font = font(F.hand(700), 52); c.fillText(`${COUPLE_ZH} 收`, -170, 40);
      c.font = font(F.hand(400), 28); c.fillText(`喜宴會場　第 ${1 + Math.floor(rnd() * 20)} 桌`, -150, 96);
      c.font = font(F.hand(400), 24); c.fillStyle = ink(0.6);
      c.fillText(others[i] ? `寄件人：${others[i]}` : '寄件人：一位賓客', -w / 2 + 40, -h / 2 + 56);
      c.restore();
    });

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
    c.fillText('♪ 此刻正在播放的歌', LYR.x, LYR.base - 70);
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
    c.fillStyle = ink(0.5); c.font = font(F.mono(500), 12); c.letterSpacing = '4px';
    c.fillText(`LOVE LETTER · 喜帖回函 · ${m ? 'No.' + String(m.n).padStart(3, '0') : 'STANDBY'} · ${DATE_DOTS.split(' · ').join('.')}`, 56, 34);
    c.letterSpacing = '0px';
    c.fillStyle = ink(0.92);
    c.font = font(F.hand(700), 44);
    c.fillText(m?.couple ? '親愛的各位：' : `親愛的 ${COUPLE_ZH}：`, 56, 82);
    const body = m ? m.text : '掃描右下角 QR code，把祝福寫上大螢幕。';
    this.fit = fitMsg(c, body, F.hand(700), LMSG.w, LMSG.h, { min: 44, max: 92, lineHeight: 1.28, maxLines: 4 });
    const fit = this.fit;
    c.font = font(F.hand(700), fit.size);
    const top = LMSG.y + (LMSG.h - fit.height) / 2 + fit.size * 0.88;
    fit.lines.forEach((ln, i) => {
      let x = LMSG.x + 30;
      for (const part of ln.split(/(♥)/)) {
        if (!part) continue;
        c.fillStyle = part === '♥' ? rgba('rose') : ink(0.92);
        c.fillText(part, x, top + i * fit.lineHeight);
        x += c.measureText(part).width;
      }
    });
    c.fillStyle = ink(0.8); c.font = font(F.hand(700), 38); c.textAlign = 'right';
    c.fillText(`—— ${m ? (m.couple ? COUPLE_ZH : m.name || '一位賓客') : '大螢幕'}`, LET.w - 60, 356);
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
      sc.font = font(F.mono(600), 21); sc.fillText(DATE_DOTS.split(' · ').join('.'), 0, 8);
      sc.fillRect(-60, -20, 120, 2); sc.fillRect(-60, 22, 120, 2);
    }, 1.25, 0.5);
    this.read = inkStamp(160, 110, this.seed + 8, (sc) => {
      const col = sigInk(0.95);
      sc.strokeStyle = col; sc.fillStyle = col;
      sc.lineWidth = 4; sc.beginPath(); sc.roundRect(-72, -44, 144, 88, 12); sc.stroke();
      sc.textAlign = 'center';
      sc.font = font(F.hei(900), 40); sc.letterSpacing = '10px'; sc.fillText('已讀', 6, 8);
      sc.font = font(F.mono(600), 12); sc.letterSpacing = '3px'; sc.fillText('READ · ♥', 2, 32);
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

    const P = this.pass.u;
    P.layer!.value = L.upload();
    P.bake!.value = ensureBake(renderer);
    P.tone!.value = 0.14;
    P.t!.value = t;
    this.pass.render(renderer, out);
    const amp = 8 * pulse(t, this.land, 0.06) + 9 * pulse(t, this.tStamp, 0.06) + 5 * pulse(t, this.tCrack, 0.05) + 7 * pulse(t, this.tRead, 0.06);
    const ph = frameIdx(t);
    return {
      paper: 1, popupAvoid: this.avoid, bloom: 0.2, bloomThreshold: 1.6, halation: 0.04, vignette: 0.28, grain: 0.05, ca: 0.4,
      shake: [amp * (hash(ph, 1) - 0.5) * 2, amp * (hash(ph, 2) - 0.5) * 2],
      zoom: 1 + 0.02 * pulse(t, this.land, 0.1) + 0.025 * prog(t, this.tPull[1], e, ease.inOutCubic),
    };
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
      const st = paperLyric(F.archivo(100, 800), 58, LYR.maxW, { lineHeight: 1.12 });
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
  c.font = font(F.mono(600), 15); c.fillText(DATE_DOTS.split(' · ').join('.'), 0, 6);
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
