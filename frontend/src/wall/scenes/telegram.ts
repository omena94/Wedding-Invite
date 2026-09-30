// 電報（亮版面）：老式的電報是「收報機印出紙帶、剪下來、一條一條貼在電報紙上」。這個版面就照這個流程：
//  - 畫面上方是收報機的紙帶：印字頭在右邊，一個字一個字打上去（三十二分／十六分音符），紙帶一格一格往左推。
//    主打留言的標點換成電報的「STOP」，英文字母一律大寫（電報的樣子）。
//  - 一條打完，下一個八分音符「喀擦」剪斷，那一截紙帶飛下來、貼到電報紙的第幾行（稍微歪、底下有膠水的影子），
//    收報機接著打下一條。整則留言在第一個拍點後的兩小節內全部貼好。
//  - 最後一個小節線：訊號色的圓形收件戳「收」砸在電報紙右上角（畫面震一下）。
// 歌詞是電報紙表頭的「附言」欄（逐字跟唱）。
// 沒有留言：紙帶打邀請；新人的留言：發報人是新人、收報人是全體賓客（反過來）。純音樂：附言寫「本曲為純音樂」。
// MV 化（2026-09-28）：焦點是貼在電報紙上的一條條紙帶（留言，整張最大的字）；附言（歌詞）小一級；表頭、欄位砍到只剩收報人、發報人。
// 鏡頭從斜上方看著桌上的電報紙與收報機（透視、景深、一盞燈），整個窗格慢慢推近。
// v2（2026-09-29 留言尺寸與版面比例標準 v2＋場景多元化）：夜裡的電報局，綠色毛氈的桌面、一盞暖燈；
// 主角是一台大大的黃銅收報機（玻璃罩裡的字輪每打一個字轉一格、按鍵跟著拍子起落、頂上的紙帶捲筒跟著轉、小鈴每個小節線敲一下），
// 紙帶從機器側面吐出來、剪下、貼到電報紙上。紙帶的字 40～60 px、發報人署名（手寫 26～32 px）在最後一條紙帶下面；
// 一支鋼筆在紙旁邊：簽名的時候拿起來寫、寫完放回去。
// 畫法：電報紙（印好的字）與每一截紙帶開場各畫成一張離屏畫布；每格只是把它們放到對的位置（紙帶用來源矩形裁出「已經打好的部分」）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H, SCALE } from '../engine/gl';
import { F, font, layout, loadText, measure } from '../engine/type';
import { mixRgba, rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog, pulse, frameIdx, TAU } from '../engine/util';
import { wrap } from '../engine/text';
import { lyricAt, drawLyric, layoutLyric, beatAfter, signature, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { msgMaxFor, lyricV2, sigV2, V2 } from './_v2';
import { drawPen, PEN_WRITE_A } from './certificate-props';
import {
  sigInk, ink, paper, paperLyric, makeCanvas, freeCanvas, shadowSprite, drawShadow, barsIn, ensureBake, themeKey, inkStamp, arcText, snapHalf, writeGlyph, yieldFrame, heartGlyph,
  tablePass, setTableCam, fitCam, lerpCam, TABLE_F, deskScale, setLight, lightTint, type TableCam, type Rect,
} from './_t1';

// v2：桌面是暗的木頭，右下角 HUD 用淺色字 → 當暗的版面排
export const spec: PlateSpecDecl = { group: 'type', family: 'doc', paper: false, energy: [0.3, 1], bars: [4, 8], weight: 1 };

type Ctx2 = CanvasRenderingContext2D;

/** 整組（收報機＋電報紙）在桌上的位置與縮放：下面的座標都是「組座標」，畫的時候整組乘上 G。 */
const G = { x: 170, y: 190, k: 0.68 };
/** 電報紙（組座標）。 */
const FORM = { x: 30, y: 222, w: 1196, h: 770, rot: -0.008 };
/** 紙帶捲筒（組座標）：收報機右邊。 */
const REEL = { x: 1930, y: -190, r: 130 };
/** 收報機（組座標）：印字頭（紙帶出口）右邊的一大台黃銅機器。 */
const MACH = { x0: 1250, x1: 2010, y0: -250, y1: 470 };
/** 紙帶：印字頭的 x、紙帶中線的 y、紙帶高、字級。 */
const TAPE = { head: 1250, y: 152, size: 64 };
/** 電報紙上貼紙帶的地方（電報紙座標）：第一行的上緣、最下緣、左緣、寬。 */
const BODY = { x: 40, top: 362, bottom: 690, maxW: 1080 };
/** 最下面那條線（電報紙座標）。 */
const SIGN = { rule: 716 };
/** 附言（歌詞）欄（電報紙座標）。 */
const NOTE = { x: 40, label: 120, base: 178, maxW: 900 };
/** 附言欄最低的基線（原文副行的最後一排）：再下面是「收報人」欄。 */
const NOTE_SUB_MAX = 274;

const TEXT = '電報愛情電報局收報人發報人字數等級急電附言發報時播放之歌曲本曲為純音樂請自行哼唱間奏中收報時間全體賓客一位賓客大螢幕新郎新娘掃描右下角把祝福寫上大螢幕收已收到本電報以愛心計費每字零元字';

interface Strip { text: string; cv: ReturnType<typeof makeCanvas>; w: number; t0: number; t1: number; cut: number; row: number; rot: number; dx: number; chars: { at: number; x: number }[] }

export default class Telegram extends Scene {
  layer = this.track(new Layer2D(W, H, SCALE * 1.25, { fast: true }));
  pass = shared('telegram.table', () => tablePass(FELT_GLSL));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = Number(this.ctx.params.seed ?? 1);
  form: ReturnType<typeof makeCanvas> | null = null;
  stamp: ReturnType<typeof makeCanvas> | null = null;
  sh = shadowSprite(FORM.w, FORM.h, 18, 6);
  /** 紙帶飛起來時的影子（預先模糊好，畫的時候拉到紙帶的長度）。 */
  stripSh = shadowSprite(600, 100, 12, 3);
  artKey = '';
  strips: Strip[] = [];
  fam = F.mono(600);
  size = TAPE.size;
  /** 紙帶高（看字級）。 */
  th = 100;
  signer = COUPLE_ZH;
  signT: [number, number] = [Infinity, Infinity];
  to = COUPLE_ZH;
  from = '';
  words = 0;
  B = 0.5;
  tStamp = Infinity;
  camA!: TableCam;
  camB!: TableCam;
  /** 從打字的鏡位推到留言的鏡位：開始、到位（小節線）。 */
  camT: [number, number] = [0, 0];
  /** 組 px → 螢幕 px（推近之後）、署名與歌詞字級（組 px）、署名的位置。 */
  S = 1; sigPx = 30; lyrPx = 50; sigY = 0;
  /** 小鈴敲的時間（每個小節線）。 */
  bells: number[] = [];
  /** 一定要清楚的點（紙帶、貼好的留言、附言，桌面座標）。 */
  focusPts: [number, number][] = [];

  override async init() {
    const { audio: au, lyrics, start: s, end: e } = this.ctx;
    const m = this.msg;
    this.from = m ? (m.couple ? COUPLE_ZH : m.name || '一位賓客') : '大螢幕';
    this.to = m?.couple ? '全體賓客' : COUPLE_ZH;
    this.signer = signature(m ? (m.couple ? COUPLE_ZH : m.name || '一位賓客') : '大螢幕');
    const body = m ? m.text : '請掃描右下角 QR code，把祝福寫上大螢幕！';
    // 電報體：句讀換成 STOP、英文大寫、愛心留著（點綴色）
    const tele = body
      .replace(/[，。！？!?,.;；、：:~～…]+/g, ' STOP ')
      .replace(/[a-z]/g, (x) => x.toUpperCase())
      .replace(/\s+/g, ' ').trim()
      .replace(/ STOP$/, '') + ' STOP';
    this.words = Array.from(body.replace(/\s/g, '')).length;
    await loadText(TEXT + tele + this.from + this.to + COUPLE_ZH + lyrics.linesIn(s - 2, e + 1).map((l) => l.text).join(''));
    const B = (this.B = au.beatPeriod(s + 0.1));

    // ---- 斷成一條一條（每條不超過電報紙的寬度，最多五條；放不下就縮字）
    const c = this.layer.ctx;
    // 以句為單位裝進一條條紙帶（STOP 永遠跟在句子後面，不會落到下一條的開頭）；一句太長才在句子裡斷
    const sentences = tele.split(/(?<=STOP)\s*/).filter((x) => x.trim());
    const pack = (sz: number) => {
      c.font = font(this.fam, sz);
      const maxW = BODY.maxW - 40, out: string[] = [];
      let cur = '';
      for (const sen of sentences) {
        const next = cur ? `${cur} ${sen}` : sen;
        if (c.measureText(next).width <= maxW) { cur = next; continue; }
        if (cur) out.push(cur);
        if (c.measureText(sen).width <= maxW) { cur = sen; continue; }
        const parts = wrap(c, sen, maxW);
        out.push(...parts.slice(0, -1));
        cur = parts[parts.length - 1]!;
      }
      if (cur) out.push(cur);
      return out;
    };
    // 字級：螢幕上 40～60 px（依字數，msgMaxFor）；組 px = 螢幕 px ÷ S（S 是整組縮放 × 推近後鏡頭的縮放，先估 0.82，
    // 鏡頭定好之後再用真的值算一次）。紙帶一條一行，最多四條、要放得進貼紙帶的那一塊（還要留一行給署名）
    const fitStrips = (S: number) => {
      let out: string[] = [];
      const hi = Math.floor(msgMaxFor(body) / S), lo = Math.ceil(V2.msgMin / S);
      for (let sz = hi; sz >= lo; sz -= 1) {
        out = pack(sz);
        this.size = sz;
        this.th = Math.round(sz * 1.5);
        const sigH = (sigV2(sz * S) / S) * 1.6;
        if (out.length <= 4 && out.length * (this.th + 8) + sigH <= BODY.bottom - BODY.top + 20) break;
      }
      return out;
    };
    let lines = fitStrips(0.82);
    {
      // 用推近後的鏡頭估真正的縮放，再排一次（字級一定落在 40～60 螢幕 px）
      const est = { tu: 960, tv: 560, dist: TABLE_F * 0.92, tilt: 0.3, yaw: -0.02, roll: 0.01 };
      const [u, v] = this.gPt(BODY.x + 500, BODY.top + 120);
      this.S = G.k * deskScale(est, u, v);
      lines = fitStrips(this.S);
    }
    const msgScreen = this.size * this.S;
    this.sigPx = sigV2(msgScreen) / this.S;
    this.lyrPx = lyricV2(m ? msgScreen : null) / this.S;
    // ---- 時間：第一個拍點開始打，整則在兩小節內（最多窗格的四成五）打完貼好
    const b0 = beatAfter(au, s + 0.08);
    const nChars = lines.reduce((a, l) => a + Array.from(l).length, 0);
    const budget = Math.max(0.8, Math.min(8 * B, 0.45 * (e - s)) - lines.length * B * 0.5);
    const step = clamp(budget / Math.max(1, nChars), 0.018, B / 4);
    let t = b0;
    this.strips = lines.map((txt, row) => {
      const lay = layout(txt, this.fam, this.size);
      const chars = lay.glyphs.map((g, i) => ({ at: t + i * step, x: g.x + g.w + 18 }));
      const t1 = t + (lay.glyphs.length - 1) * step;
      // 剪：打完的下一個八分音符（太近就再下一個）
      const cut = snapHalf(au, t1 + 0.06);
      const w = lay.width + 36;
      const st: Strip = { text: txt, cv: this.stripArt(txt, w, row), w, t0: t, t1, cut, row, rot: (hash(this.seed, row, 2) - 0.5) * 0.03, dx: (hash(this.seed, row, 3) - 0.5) * 16, chars };
      t = cut + Math.min(B / 4, 0.12);
      return st;
    });
    // 簽收：貼完的下一拍，收報人簽名；收件戳：簽完之後的最後一個小節線（至少隔一拍）
    const pasted = this.strips[this.strips.length - 1]!.cut + FLY;
    const s0 = beatAfter(au, pasted + 0.05);
    if (s0 < e - 0.8) this.signT = [s0, s0 + clamp(0.1 * Array.from(this.signer).length + 0.25, 0.5, 1.3)];
    const after = isFinite(this.signT[1]) ? this.signT[1] : pasted;
    const bars = barsIn(au, after + 0.5 * B, e - 0.5 * B);
    if (bars.length) this.tStamp = bars[bars.length - 1]!;
    else if (e - after > 1.2 * B) this.tStamp = beatAfter(au, after + 0.2);
    await yieldFrame();
    this.drawForm();

    // 鏡頭：從斜上方看桌面，打字時框住收報機與電報紙，貼好之後推近到電報紙；字都要在安全範圍內而且清楚
    const bodyH = BODY.top + this.strips.length * (this.th + 8);
    this.sigY = bodyH + this.sigPx * 1.25;
    const keep: Rect[] = [this.gRect(BODY.x, BODY.top - 6, BODY.maxW, this.sigY + 12 - BODY.top + 6), this.gRect(NOTE.x, NOTE.base - 56, NOTE.maxW, 120)];
    const maxW = Math.max(...this.strips.map((st) => st.w));
    const tapeR: Rect = [G.x + G.k * (TAPE.head - maxW), G.y + G.k * (TAPE.y - this.th / 2), G.k * maxW, G.k * this.th];
    this.focusPts = [[G.x + G.k * (TAPE.head - 300), G.y + G.k * TAPE.y], this.gPt(BODY.x + 500, (BODY.top + bodyH) / 2), this.gPt(NOTE.x + 300, NOTE.base)];
    const machR: Rect = [G.x + G.k * MACH.x0, G.y + G.k * (MACH.y0 - 60), G.k * (MACH.x1 - MACH.x0), G.k * (MACH.y1 - MACH.y0 + 60)];
    this.camA = fitCam({ tu: 1000, tv: 470, dist: TABLE_F * 1.02, tilt: 0.3, yaw: -0.05, roll: 0.02 }, [...keep, tapeR]);
    const [cu, cv] = this.gPt(BODY.x + BODY.maxW / 2 + 60, (NOTE.base + this.sigY) / 2);
    // 推近之後收報機也要在畫面裡（它是主角），只是往右上邊退一點
    this.camB = fitCam({ tu: cu + 180, tv: cv - 60, dist: TABLE_F * 0.92, tilt: 0.3, yaw: -0.02, roll: 0.01 }, [...keep, [machR[0], machR[1] + machR[3] * 0.35, machR[2] * 0.7, machR[3] * 0.65]]);
    // 推近在最後一截紙帶貼好之後，緩進下一個小節線
    const pasteEnd = this.strips[this.strips.length - 1]!.cut + FLY;
    const bar = barsIn(au, pasteEnd + 0.4 * B, e)[0] ?? Math.min(e, pasteEnd + 4 * B);
    this.camT = [Math.max(pasteEnd, bar - Math.max(1.2, 3 * B)), bar];
    this.bells = barsIn(au, s + 0.3, e - 0.2);
  }

  /** 組座標（電報紙座標）→ 桌面座標。 */
  private gPt(u: number, v: number): [number, number] {
    const x = FORM.x + Math.cos(FORM.rot) * u - Math.sin(FORM.rot) * v, y = FORM.y + Math.sin(FORM.rot) * u + Math.cos(FORM.rot) * v;
    return [G.x + G.k * x, G.y + G.k * y];
  }
  private gRect(x: number, y: number, w: number, h: number): Rect {
    const pts = [this.gPt(x, y), this.gPt(x + w, y), this.gPt(x, y + h), this.gPt(x + w, y + h)];
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  }

  override dispose() { freeCanvas(this.form); freeCanvas(this.stamp); freeCanvas(this.sh); freeCanvas(this.stripSh); for (const s of this.strips) freeCanvas(s.cv); super.dispose(); }

  /** 一截紙帶：窄長的紙、上下兩條淡淡的邊、印好的字（電報的等寬字），愛心用點綴色。 */
  private stripArt(txt: string, w: number, row: number) {
    const a = makeCanvas(w, this.th, 1.5);
    const c = a.c;
    c.fillStyle = mixRgba('paper', 'bone', 0.45);
    c.fillRect(0, 0, w, this.th);
    c.fillStyle = ink(0.12); c.fillRect(0, 3, w, 1); c.fillRect(0, this.th - 4, w, 1);
    // 紙帶上的齒孔（紙帶中線偏上一排小孔：真的電報紙帶靠它往前送）
    c.fillStyle = ink(0.1);
    for (let x = 9; x < w; x += 14) { c.beginPath(); c.arc(x, 9, 1.8, 0, TAU); c.fill(); }
    c.font = font(this.fam, this.size);
    c.textBaseline = 'alphabetic';
    const lay = layout(txt, this.fam, this.size);
    for (const g of lay.glyphs) {
      c.fillStyle = ink(0.92 - 0.1 * hash(this.seed, row, g.i));
      if (g.ch === '♥') heartGlyph(c, 18 + g.x, this.th / 2 + this.size * 0.36);
      else c.fillText(g.ch, 18 + g.x, this.th / 2 + this.size * 0.36);
    }
    // STOP 印成訊號色（電報裡最醒目的字）
    let at = txt.indexOf('STOP');
    while (at >= 0) {
      const x = 18 + measure(txt.slice(0, at), this.fam, this.size);
      c.fillStyle = mixRgba('paper', 'bone', 0.45); c.fillRect(x - 2, 14, measure('STOP', this.fam, this.size) + 4, this.th - 22);
      c.fillStyle = sigInk(0.8);
      c.fillText('STOP', x, this.th / 2 + this.size * 0.36);
      at = txt.indexOf('STOP', at + 4);
    }
    return a;
  }

  /** 電報紙：印好的表頭、欄位、行線。 */
  private drawForm() {
    this.artKey = themeKey();
    freeCanvas(this.form); freeCanvas(this.stamp);
    const f = (this.form = makeCanvas(FORM.w, FORM.h, 1.5));
    const c = f.c;
    const m = this.msg;
    // 電報紙：帶一點點訊號色的紙（每首歌的電報紙顏色都不太一樣）
    c.fillStyle = mixRgba('paper', 'signal', 0.1);
    c.fillRect(0, 0, FORM.w, FORM.h);
    c.strokeStyle = ink(0.45); c.lineWidth = 2; c.strokeRect(16, 16, FORM.w - 32, FORM.h - 32);
    // 表頭
    // 表頭：配角（小、低對比）
    c.fillStyle = ink(0.7);
    c.font = font(F.hei(900), 34); c.letterSpacing = '20px'; c.fillText('電報', 40, 76); c.letterSpacing = '0px';
    c.fillStyle = ink(0.5);
    c.font = font(F.hei(500), 17); c.letterSpacing = '4px'; c.fillText('愛情電報局 · TELEGRAM', 170, 74);
    c.letterSpacing = '0px';
    c.fillStyle = ink(0.6); c.fillRect(40, 96, FORM.w - 80, 1.6);
    // 附言（歌詞）欄
    const lab = (zh: string, en: string, x: number, y: number) => {
      c.fillStyle = ink(0.62);
      c.font = font(F.hei(500), 15); c.letterSpacing = '4px'; c.fillText(zh, x, y);
      const w = measure(zh, F.hei(500), 15, 4);
      c.font = font(F.mono(500), 11); c.letterSpacing = '3px'; c.fillText(en, x + w + 10, y);
      c.letterSpacing = '0px';
      return x + w + 10 + measure(en, F.mono(500), 11, 3);
    };
    c.fillStyle = ink(0.5);
    c.font = font(F.hei(500), 16); c.letterSpacing = '4px'; c.fillText('♪ 附言', NOTE.x, NOTE.label); c.letterSpacing = '0px';
    c.fillStyle = ink(0.16); c.fillRect(NOTE.x, NOTE.base + 16, NOTE.maxW, 1); c.fillRect(NOTE.x, NOTE.base + 76, NOTE.maxW, 1);
    // 欄位列
    const fy = 318;
    const cols: [string, string, number][] = [['收報人', this.to, 40]];
    for (const [zh, v, x] of cols) {
      c.fillStyle = ink(0.5);
      c.font = font(F.hei(500), 16); c.letterSpacing = '4px'; c.fillText(zh, x, fy + 2); c.letterSpacing = '0px';
      c.fillStyle = ink(0.8);
      c.font = font(F.hei(700), 22);
      let vv = v;
      while (Array.from(vv).length > 3 && measure(vv, F.hei(700), 22) > 260) vv = Array.from(vv).slice(0, -2).join('') + '…';
      c.fillText(vv, x + 84, fy + 3);
    }
    c.fillStyle = ink(0.6); c.fillRect(40, 338, FORM.w - 80, 1.4);
    // 貼紙帶的行線（淡淡的）
    c.fillStyle = ink(0.08);
    for (let r = 0; r < 4; r++) { const y = BODY.top + r * (this.th + 8) + this.th + 4; if (y < BODY.bottom) c.fillRect(40, y, FORM.w - 80, 1); }
    // 簽收欄
    c.fillStyle = ink(0.5); c.fillRect(40, SIGN.rule, FORM.w - 80, 1.4);
    // 收件戳（圓形日戳）
    this.stamp = inkStamp(250, 250, this.seed + 5, (sc) => {
      const col = sigInk(0.95);
      sc.strokeStyle = col; sc.fillStyle = col;
      sc.lineWidth = 5; sc.beginPath(); sc.arc(0, 0, 112, 0, TAU); sc.stroke();
      sc.lineWidth = 2; sc.beginPath(); sc.arc(0, 0, 78, 0, TAU); sc.stroke();
      arcText(sc, '愛情電報局 · LOVE', 82, -Math.PI / 2, F.hei(700), 20, 4, true);
      arcText(sc, 'TELEGRAPH · 收', 82, Math.PI / 2, F.mono(600), 17, 4, false);
      sc.fillRect(-78, -24, 156, 2); sc.fillRect(-78, 24, 156, 2);
      sc.textAlign = 'center';
      sc.font = font(F.mono(600), 24); sc.fillText(DATE_DOTS.split(' · ').join('.'), 0, 10);
      sc.font = font(F.hei(900), 22); sc.fillText('已收到', 0, 56);
      sc.font = font(F.hei(900), 22); sc.fillText('收', 0, -38);
    }, 1.25, 0.5);
  }

  // ------------------------------------------------------------------ 畫
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, e = this.ctx.end;
    if (this.artKey !== themeKey()) { for (const s of this.strips) { freeCanvas(s.cv); s.cv = this.stripArt(s.text, s.w, s.row); } this.drawForm(); }
    const L = this.layer;
    L.clear();
    const c = L.ctx;
    // 整組（收報機＋電報紙）縮放擺到桌上
    c.save();
    c.translate(G.x, G.y); c.scale(G.k, G.k);
    // ---- 電報紙
    c.save();
    c.translate(FORM.x, FORM.y); c.rotate(FORM.rot);
    drawShadow(c, this.sh, 6, 14, 0.25);
    c.drawImage(this.form!.cv, 0, 0, FORM.w, FORM.h);
    this.drawNote(c, t);
    // 已經貼好的紙帶（還在飛的另外畫在最上面）
    for (const s of this.strips) if (t >= s.cut + FLY) this.drawPasted(c, s, t);
    const pen = this.drawSign(c, t);
    // 收件戳
    if (t >= this.tStamp && this.stamp) {
      const k = prog(t, this.tStamp, this.tStamp + 0.07, ease.outQuad);
      const sc = lerp(1.3, 1, k);
      c.save();
      c.globalCompositeOperation = 'multiply';
      c.globalAlpha = 0.5 + 0.5 * k;
      c.translate(FORM.w - 170, SIGN.rule - 20); c.rotate(0.12 + (hash(this.seed, 9) - 0.5) * 0.1); c.scale(sc * 0.8, sc * 0.8);
      c.drawImage(this.stamp.cv, -this.stamp.w / 2, -this.stamp.h / 2, this.stamp.w, this.stamp.h);
      c.restore();
    }
    c.restore();

    // 鋼筆：平常放在電報紙右下方；簽名的時候拿起來、筆尖跟著寫的字走，寫完放回去
    {
      const rest = { x: FORM.x + FORM.w + 50, y: FORM.y + 470, a: 1.35 };
      const [a, b] = this.signT;
      const up = prog(t, a - 0.35, a, ease.inOutCubic) * (1 - prog(t, b + 0.1, b + 0.5, ease.inOutCubic));
      let tip = { x: rest.x, y: rest.y };
      if (pen) tip = { x: FORM.x + pen.x, y: FORM.y + pen.y };
      else if (up > 0) tip = { x: FORM.x + FORM.w - 300, y: FORM.y + this.sigY - 20 };
      drawPen(c, lerp(rest.x, tip.x, up), lerp(rest.y, tip.y, up), lerp(rest.a, PEN_WRITE_A, up), 0.25 * up * (pen ? 0.3 : 1), 1 - up);
    }
    // ---- 收報機的紙帶
    this.drawTape(c, t);
    // 飛下來的紙帶
    for (const s of this.strips) if (t >= s.cut && t < s.cut + FLY) this.drawFlying(c, s, t);
    c.restore();
    // 燈光裡的灰塵

    // ---- 合成：鏡頭、景深、燈
    const cam = this.cam(t);
    const P = this.pass;
    P.u.layer!.value = L.upload();
    P.u.bake!.value = ensureBake(renderer);
    P.u.tone!.value = 0.5;
    // 暖燈：光池罩著電報紙與收報機，綠毛氈的桌面往四周暗下去；右下角 HUD 那一塊再壓暗
    setTableCam(P, cam, { aperture: 56, sharp: 0.02, focus: this.focusPts, lamp: [this.focusPts[1]![0] + 160, this.focusPts[1]![1] - 120, 520] });
    setLight(P, lightTint('bone', 'ember', 0.3), 0.14, 0.6);
    P.render(renderer, out);
    let amp = 11 * pulse(t, this.tStamp, 0.06);
    for (const s of this.strips) amp += 3 * pulse(t, s.cut + FLY, 0.05);
    const ph = frameIdx(t);
    return {
      paper: 0, bloom: 0.2, bloomThreshold: 1.6, halation: 0.04, vignette: 0.3, grain: 0.05, ca: 0.4,
      shake: [amp * (hash(ph, 1) - 0.5) * 2, amp * (hash(ph, 2) - 0.5) * 2],
      zoom: 1 + 0.015 * pulse(t, this.tStamp, 0.1),
    };
  }

  /** 鏡頭：切進來遠一點，整個窗格慢慢推近；蓋收件戳那一下往前一點點。 */
  private cam(t: number): TableCam {
    const s = this.ctx.start, e = this.ctx.end;
    const [a, b] = this.camT;
    // 打字時很慢地推近一點；推到留言的鏡位之後也繼續很慢地推
    const A = { ...this.camA, dist: this.camA.dist * (1.06 - 0.06 * prog(t, s, a)) };
    const B = { ...this.camB, dist: this.camB.dist * (1.03 - 0.03 * prog(t, b, e)) };
    const c = lerpCam(A, B, ease.inOutCubic(prog(t, a, b)));
    return { ...c, dist: c.dist * (1 - 0.012 * pulse(t, this.tStamp, 0.12)) };
  }


  /** 貼好的紙帶在電報紙座標的位置。 */
  private pastePos(s: Strip) { return { x: BODY.x + s.dx, y: BODY.top + s.row * (this.th + 8), rot: s.rot }; }

  private drawPasted(c: Ctx2, s: Strip, t: number) {
    const p = this.pastePos(s);
    c.save();
    c.translate(p.x, p.y); c.rotate(p.rot);
    // 膠水：邊緣一圈很淡的深色（貼上去的那一下更深一點）
    const fresh = pulse(t, s.cut + FLY, 0.2);
    c.fillStyle = ink(0.1 + 0.1 * fresh);
    c.fillRect(-2, 2, s.w + 4, this.th + 2);
    c.drawImage(s.cv.cv, 0, 0, s.w, this.th);
    c.restore();
  }

  /** 剪下來的那一截飛到它的行：先離開紙帶（陰影變大），再落到電報紙上（陰影縮回來、輕輕回彈）。 */
  private drawFlying(c: Ctx2, s: Strip, t: number) {
    const u = clamp((t - s.cut) / FLY);
    const k = ease.outBack(u, 1.1);
    const lift = Math.sin(Math.PI * u);
    // 起點：剪下來的那一刻在螢幕上的位置
    const x0 = TAPE.head - s.w, y0 = TAPE.y - this.th / 2;
    // 終點：電報紙座標 → 螢幕
    const p = this.pastePos(s);
    const cs = Math.cos(FORM.rot), sn = Math.sin(FORM.rot);
    const x1 = FORM.x + cs * p.x - sn * p.y, y1 = FORM.y + sn * p.x + cs * p.y;
    const x = lerp(x0, x1, k), y = lerp(y0, y1, k);
    const rot = lerp(0, p.rot + FORM.rot, k) + 0.06 * lift * (s.row % 2 ? -1 : 1);
    const sc = 1 + 0.05 * lift;
    c.save();
    c.translate(x, y); c.rotate(rot); c.scale(sc, sc);
    c.save();
    c.globalAlpha = 0.1 + 0.22 * lift;
    c.drawImage(this.stripSh.cv, -this.stripSh.pad + 6 + 16 * lift, -this.stripSh.pad * (this.th / 100) + 8 + 24 * lift, s.w + this.stripSh.pad * 2 * (s.w / 600), (100 + this.stripSh.pad * 2) * (this.th / 100));
    c.restore();
    c.drawImage(s.cv.cv, 0, 0, s.w, this.th);
    c.restore();
  }

  /** 收報機：右邊是印字頭，紙帶從它左邊出來往左推；還沒剪的那一截只看得到已經打好的部分。 */
  private drawTape(c: Ctx2, t: number) {
    const y0 = TAPE.y - this.th / 2;
    // 紙帶捲筒：收報機右邊，打一個字轉一點（打的字越多轉越多）；空白的紙帶從捲筒拉到印字頭
    let typed = 0;
    for (const s of this.strips) for (const ch of s.chars) if (t >= ch.at) typed++;
    const lastAt0 = (() => { let a = -Infinity; for (const s of this.strips) for (const ch of s.chars) if (t >= ch.at) a = ch.at; return a; })();
    const spin = (typed - 1 + ease.outCubic(clamp((t - lastAt0) / 0.05))) * 0.09;
    this.drawReel(c, spin, y0);
    c.fillStyle = mixRgba('paper', 'bone', 0.45);
    c.fillRect(TAPE.head, y0, MACH.x0 - TAPE.head, this.th);
    // 正在打（還沒剪）的那一截
    const cur = this.strips.find((s) => t >= s.t0 - 0.05 && t < s.cut);
    let printed = 0;
    if (cur) {
      // 紙帶的推進：每打一個字往前推一格（很短的緩動）
      let x = 0;
      for (const ch of cur.chars) { if (t < ch.at) break; x = lerp(x, ch.x, ease.outCubic(clamp((t - ch.at) / 0.035))); }
      printed = x;
      const w = Math.min(cur.w, printed);
      if (w > 0) {
        c.save();
        c.fillStyle = ink(0.08); c.fillRect(TAPE.head - w + 4, y0 + 6, w, this.th);
        c.drawImage(cur.cv.cv, 0, 0, w * 1.5, this.th * 1.5, TAPE.head - w, y0, w, this.th);
        c.restore();
      }
    }
    // 剪刀：剪的那一刻一道細細的亮線
    for (const s of this.strips) {
      const k = pulse(t, s.cut, 0.05);
      if (k > 0.02) { c.fillStyle = sigInk(k); c.fillRect(TAPE.head - 3, y0 - 14, 3, this.th + 28); }
    }
    // 收報機（主角）：黃銅的機身、玻璃罩裡的字輪、兩排圓按鍵、紙帶出口的小燈
    const hx = TAPE.head, th = this.th;
    let n = 0, hit = 0;
    for (const s of this.strips) for (const ch of s.chars) if (t >= ch.at) { n++; hit = Math.max(hit, pulse(t, ch.at, 0.04)); }
    const lastAt = (() => { let a = -Infinity; for (const s of this.strips) for (const ch of s.chars) if (t >= ch.at) a = ch.at; return a; })();
    this.drawMachine(c, t, n, lastAt, hit, y0, th);
    const bot = MACH.y1;
    // 小鈴：機身上一個小銅鈴，每個小節線小錘子敲一下，一圈聲波往外擴散
    const bx = MACH.x0 + 70, by = bot + 40;
    let ring = 0, tb = -Infinity;
    for (const b of this.bells) if (b <= t) tb = b;
    ring = pulse(t, tb, 0.12);
    c.fillStyle = mixRgba('fur', 'sepia', 0.35);
    c.beginPath(); c.arc(bx, by, 22, Math.PI, 0); c.lineTo(bx + 26, by + 6); c.lineTo(bx - 26, by + 6); c.closePath(); c.fill();
    c.fillStyle = mixRgba('fur', 'bone', 0.4); c.beginPath(); c.ellipse(bx - 8, by - 10, 7, 4, -0.5, 0, TAU); c.fill();
    // 錘子：平常抬著，敲的那一下打到鈴邊
    const ham = -0.9 + 0.9 * (1 - clamp((t - tb) / 0.12));
    c.save(); c.translate(bx + 46, by - 30); c.rotate(t >= tb && t - tb < 0.25 ? ham : -0.9);
    c.strokeStyle = ink(0.8); c.lineWidth = 4; c.beginPath(); c.moveTo(0, 0); c.lineTo(-22, 22); c.stroke();
    c.fillStyle = ink(0.85); c.beginPath(); c.arc(-24, 24, 6, 0, TAU); c.fill();
    c.restore();
    if (ring > 0.02) {
      const u = 1 - ring;
      c.strokeStyle = sigInk(0.6 * ring); c.lineWidth = 2.5;
      for (const k of [0, 1]) { c.beginPath(); c.arc(bx, by - 6, 30 + 60 * u + 22 * k, Math.PI * 1.05, Math.PI * 1.95); c.stroke(); }
    }
  }

  /**
   * 黃銅收報機（組座標）：木頭底座、黃銅機身（斜面的漸層、四角鉚釘）、中間一個玻璃罩，罩裡的字輪每打一個字轉一格，
   * 下面兩排圓按鍵：每一拍有一顆按下去（種子決定哪一顆），紙帶從左側的出口吐出來，出口上方的小燈每打一個字亮一下。
   * 黃銅用固定的暖色（fur 混 bone／sepia：道具不跟主題換色，換到薰衣草主題也還是黃銅）。
   */
  private drawMachine(c: Ctx2, t: number, n: number, lastAt: number, hit: number, y0: number, th: number) {
    const { x0, x1, y0: my0, y1: my1 } = MACH;
    const brass = (k: number) => mixRgba('fur', k < 0 ? 'bone' : 'sepia', Math.abs(k));
    // 底座（深色木頭）與影子
    c.fillStyle = rgba('ink', 0.4); c.beginPath(); c.roundRect(x0 - 10, my0 + 30, x1 - x0 + 60, my1 - my0 + 20, 30); c.fill();
    c.fillStyle = mixRgba('sepia', 'ink', 0.4); c.beginPath(); c.roundRect(x0 - 30, my0 + 10, x1 - x0 + 60, my1 - my0 + 10, 28); c.fill();
    // 機身
    const g = c.createLinearGradient(x0, my0, x1, my1);
    g.addColorStop(0, brass(-0.35)); g.addColorStop(0.45, brass(0.15)); g.addColorStop(1, brass(0.55));
    c.fillStyle = g; c.beginPath(); c.roundRect(x0, my0, x1 - x0, my1 - my0 - 20, 24); c.fill();
    c.strokeStyle = brass(0.6); c.lineWidth = 3; c.stroke();
    // 黃銅的反光：一道斜的亮帶（燈在左上方）
    c.save(); c.beginPath(); c.roundRect(x0, my0, x1 - x0, my1 - my0 - 20, 24); c.clip();
    const sh = c.createLinearGradient(x0, my0, x0 + 420, my0 + 300);
    sh.addColorStop(0, rgba('bone', 0)); sh.addColorStop(0.45, rgba('bone', 0.22)); sh.addColorStop(0.55, rgba('bone', 0.22)); sh.addColorStop(1, rgba('bone', 0));
    c.fillStyle = sh; c.fillRect(x0, my0, 420, 300); c.restore();
    c.fillStyle = brass(-0.5);
    for (const [rx, ry] of [[x0 + 22, my0 + 22], [x1 - 22, my0 + 22], [x0 + 22, my1 - 42], [x1 - 22, my1 - 42]] as const) { c.beginPath(); c.arc(rx, ry, 7, 0, TAU); c.fill(); }
    // 玻璃罩＋字輪
    const R = Math.min(x1 - x0, my1 - my0) * 0.24, cx = (x0 + x1) / 2 + 30, cy = my0 + R + 60;
    c.fillStyle = brass(0.7); c.beginPath(); c.arc(cx, cy, R + 14, 0, TAU); c.fill();
    c.fillStyle = mixRgba('ink2', 'graphite', 0.25); c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fill();
    const ang = (n - 1 + ease.outCubic(clamp((t - lastAt) / 0.05))) * (TAU / 28);
    c.save(); c.translate(cx, cy); c.rotate(ang);
    c.fillStyle = brass(-0.2); c.beginPath(); c.arc(0, 0, R - 18, 0, TAU); c.fill();
    c.fillStyle = brass(0.4); c.beginPath(); c.arc(0, 0, R - 50, 0, TAU); c.fill();
    c.fillStyle = mixRgba('ink', 'sepia', 0.3); c.font = font(F.mono(600), Math.round(R * 0.2)); c.textAlign = 'center';
    const LET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ♥∞';
    for (let i = 0; i < 28; i++) {
      c.save(); c.rotate((i / 28) * TAU); c.fillText(LET[i]!, 0, -(R - R * 0.24)); c.restore();
    }
    c.textAlign = 'left';
    c.restore();
    // 玻璃的反光
    c.fillStyle = rgba('bone', 0.18); c.beginPath(); c.ellipse(cx - 40, cy - 46, 46, 20, -0.6, 0, TAU); c.fill();
    // 名牌（小、低對比）
    c.fillStyle = brass(0.7); c.beginPath(); c.roundRect(cx - 90, cy + R + 22, 180, 34, 6); c.fill();
    c.fillStyle = brass(-0.4); c.font = font(F.hei(700), 18); c.letterSpacing = '6px'; c.textAlign = 'center';
    c.fillText('愛情電報局', cx + 3, cy + R + 45); c.textAlign = 'left'; c.letterSpacing = '0px';
    // 按鍵：兩排，每一拍有一顆按下去
    const bi = Math.floor(this.ctx.audio.beatAt(t)), bf = this.ctx.audio.beatAt(t) - bi;
    const down = Math.floor(hash(bi, this.seed, 5) * 20);
    for (let row = 0; row < 2; row++) for (let i = 0; i < 10; i++) {
      const kx = x0 + 70 + i * ((x1 - x0 - 130) / 9) + row * 22, ky = my1 - 130 + row * 56;
      const pressed = row * 10 + i === down ? 1 - ease.outCubic(clamp(bf / 0.4)) : 0;
      c.fillStyle = rgba('ink', 0.5); c.beginPath(); c.arc(kx + 3, ky + 5, 21, 0, TAU); c.fill();
      c.fillStyle = mixRgba('bone', 'ash', 0.3 + 0.3 * pressed); c.beginPath(); c.arc(kx, ky + 3 * pressed, 20 - 2 * pressed, 0, TAU); c.fill();
      c.strokeStyle = brass(0.3); c.lineWidth = 3; c.stroke();
    }
    // 紙帶出口（機身左側）與小燈
    c.fillStyle = mixRgba('ink', 'sepia', 0.3); c.beginPath(); c.roundRect(x0 - 16, y0 - 12, 40, th + 24, 8); c.fill();
    c.fillStyle = mixRgba('paper', 'bone', 0.45); c.fillRect(x0 - 16, y0, 34, th);
    c.fillStyle = sigInk(0.3 + 0.7 * hit); c.beginPath(); c.arc(x0 + 40, y0 - 30, 9, 0, TAU); c.fill();
  }

  /** 紙帶捲筒（俯視）：一卷紙、中間的軸、幾道放射的刻痕（看得出在轉）。 */
  private drawReel(c: Ctx2, spin: number, y0: number) {
    const { x, r } = REEL, y = REEL.y;
    void y0;
    c.save();
    c.fillStyle = ink(0.28); c.beginPath(); c.arc(x + 10, y + 14, r, 0, TAU); c.fill();
    c.fillStyle = mixRgba('paper', 'bone', 0.35); c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    c.strokeStyle = ink(0.1); c.lineWidth = 1;
    for (let rr = 40; rr < r; rr += 7) { c.beginPath(); c.arc(x, y, rr, 0, TAU); c.stroke(); }
    c.fillStyle = ink(0.75); c.beginPath(); c.arc(x, y, 34, 0, TAU); c.fill();
    c.strokeStyle = mixRgba('ash', 'bone', 0.4); c.lineWidth = 4;
    for (let i = 0; i < 3; i++) {
      const a = spin + (i / 3) * TAU;
      c.beginPath(); c.moveTo(x + Math.cos(a) * 10, y + Math.sin(a) * 10); c.lineTo(x + Math.cos(a) * 28, y + Math.sin(a) * 28); c.stroke();
    }
    c.fillStyle = mixRgba('ash', 'bone', 0.5); c.beginPath(); c.arc(x, y, 7, 0, TAU); c.fill();
    c.restore();
  }

  /** 發報人署名：最後一條紙帶下面、靠右，手寫字一個字一個字寫出來。回傳筆尖（電報紙座標）。 */
  private drawSign(c: Ctx2, t: number): { x: number; y: number } | null {
    const [a, b] = this.signT;
    if (t < a) return null;
    const fam = F.hand(700), sz = this.sigPx;
    const lay = layout(this.signer, fam, sz);
    const per = (b - a) / Math.max(1, lay.glyphs.length);
    const x0 = BODY.x + BODY.maxW - 40 - lay.width;
    c.save();
    c.font = font(fam, sz); c.fillStyle = ink(0.9);
    let pen: { x: number; y: number } | null = null;
    for (const g of lay.glyphs) pen = writeGlyph(c, g.ch, x0 + g.x, this.sigY, sz, g.w, clamp((t - a - g.i * per) / per)) ?? pen;
    c.restore();
    return pen;
  }

  /** 附言欄：歌詞逐字跟唱；間奏與純音樂寫一句冷面的附言。 */
  private drawNote(c: Ctx2, t: number) {
    const { lyrics } = this.ctx;
    const ly = lyricAt(lyrics, t);
    if (ly) {
      let st = paperLyric(F.archivo(100, 800), this.lyrPx, NOTE.maxW, { lineHeight: 1.16, minSize: V2.lyrMin / this.S });
      let lay = layoutLyric(c, ly.line, st);
      // 韓文歌：原文副行接在中文下面，最後一排要跟下面的「收報人」欄（字頂約在 y 300）隔開一點：放不下就把中文縮一點
      for (let k = 0; k < 10 && lay.sub && NOTE.base + lay.height - lay.size > NOTE_SUB_MAX; k++) {
        const sz = lay.size * 0.93;
        st = { ...st, size: sz, minSize: Math.min(st.minSize ?? sz, sz) };
        lay = layoutLyric(c, ly.line, st);
      }
      const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.15));
      c.save();
      c.translate(NOTE.x, NOTE.base + (1 - inK) * 12);
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
    c.font = font(F.hei(500), Math.round(this.lyrPx * 0.72)); c.letterSpacing = '3px';
    c.fillText(lyrics.has ? '（間奏中）' : '本曲為純音樂，請自行哼唱', NOTE.x, NOTE.base);
    c.restore();
  }
}

/** 紙帶飛下來要多久（秒）。 */
const FLY = 0.42;

/** 電報局的桌面：深綠色的毛氈（固定的綠：道具，不跟主題換），細細的絨毛雜訊。 */
const FELT_GLSL = /* glsl */ `
vec3 deskArt(vec2 p, vec3 desk) {
  float fuzz = snoise(p * 0.25) * 0.5 + snoise(p * 0.06) * 0.5;
  return mix(C_GINGHAM, C_INK, 0.62) * (0.92 + 0.08 * fuzz) * (0.9 + 0.2 * (desk.r / max(C_PAPER.r, 0.05)));
}`;
