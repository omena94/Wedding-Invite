// 電報（亮版面）：老式的電報是「收報機印出紙帶、剪下來、一條一條貼在電報紙上」。這個版面就照這個流程：
//  - 畫面上方是收報機的紙帶：印字頭在右邊，一個字一個字打上去（三十二分／十六分音符），紙帶一格一格往左推。
//    主打留言的標點換成電報的「STOP」，英文字母一律大寫（電報的樣子）。
//  - 一條打完，下一個八分音符「喀擦」剪斷，那一截紙帶飛下來、貼到電報紙的第幾行（稍微歪、底下有膠水的影子），
//    收報機接著打下一條。整則留言在第一個拍點後的兩小節內全部貼好。
//  - 最後一個小節線：訊號色的圓形收件戳「收」砸在電報紙右上角（畫面震一下）。
// 歌詞是電報紙表頭的「附言」欄（逐字跟唱）；收報人、發報人、字數、等級是表格欄位。
// 沒有留言：紙帶打邀請；新人的留言：發報人是新人、收報人是全體賓客（反過來）。純音樂：附言寫「本曲為純音樂」。
// 畫法：電報紙（印好的字）與每一截紙帶開場各畫成一張離屏畫布；每格只是把它們放到對的位置（紙帶用來源矩形裁出「已經打好的部分」）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { F, font, layout, loadText, measure } from '../engine/type';
import { mixRgba, rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog, pulse, frameIdx, TAU } from '../engine/util';
import { wrap } from '../engine/text';
import { lyricAt, drawLyric, layoutLyric, beatAfter, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { sigInk, ink, paper, paperLyric, makeCanvas, freeCanvas, shadowSprite, drawShadow, barsIn, xfRect, paperPass, ensureBake, themeKey, inkStamp, arcText, snapHalf, writeGlyph, yieldFrame, type Rect } from './_t1';

export const spec: PlateSpecDecl = { group: 'type', family: 'doc', paper: true, energy: [0.3, 1], bars: [4, 8], weight: 1 };

type Ctx2 = CanvasRenderingContext2D;

/** 電報紙（螢幕座標）。 */
const FORM = { x: 112, y: 222, w: 1196, h: 770, rot: -0.008 };
/** 紙帶：印字頭的 x、紙帶中線的 y、紙帶高、字級。 */
const TAPE = { head: 1296, y: 152, size: 64 };
/** 電報紙上貼紙帶的地方（電報紙座標）：第一行的上緣、最下緣、左緣、寬。 */
const BODY = { x: 40, top: 362, bottom: 690, maxW: 1080 };
/** 簽收欄（電報紙座標）。 */
const SIGN = { rule: 700, label: 726, base: 752 };
/** 附言（歌詞）欄（電報紙座標）。 */
const NOTE = { x: 40, label: 120, base: 178, maxW: 900 };

const TEXT = '電報愛情電報局收報人發報人字數等級急電附言發報時播放之歌曲本曲為純音樂請自行哼唱間奏中收報時間全體賓客一位賓客大螢幕新郎新娘掃描右下角把祝福寫上大螢幕收已收到本電報以愛心計費每字零元字';

interface Strip { text: string; cv: ReturnType<typeof makeCanvas>; w: number; t0: number; t1: number; cut: number; row: number; rot: number; dx: number; chars: { at: number; x: number }[] }

export default class Telegram extends Scene {
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  pass = shared('telegram.paper', () => paperPass());
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
  avoid: Rect[] = [];
  /** 紙帶還在打字的時候，即時小卡也要避開它（打完就空了，不用避）。 */
  tapeAvoid: Rect = [0, 0, 0, 0];

  override async init() {
    const { audio: au, lyrics, start: s, end: e } = this.ctx;
    const m = this.msg;
    this.from = m ? (m.couple ? COUPLE_ZH : m.name || '一位賓客') : '大螢幕';
    this.to = m?.couple ? '全體賓客' : COUPLE_ZH;
    this.signer = this.to;
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
    let lines: string[] = [];
    for (let sz = 76; sz >= 40; sz -= 2) {
      lines = pack(sz);
      this.size = sz;
      this.th = Math.round(sz * 1.62);
      // 一條的時候可以大一點（最多 76）；兩條以上最多 64
      if (lines.length > 1 && sz > TAPE.size) continue;
      if (lines.length <= 4 && lines.length * (this.th + 8) <= BODY.bottom - BODY.top) break;
    }
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
    if (s0 < e - 0.8) this.signT = [s0, s0 + clamp(0.12 * Array.from(this.signer).length + 0.25, 0.5, 1.2)];
    const after = isFinite(this.signT[1]) ? this.signT[1] : pasted;
    const bars = barsIn(au, after + 0.5 * B, e - 0.5 * B);
    if (bars.length) this.tStamp = bars[bars.length - 1]!;
    else if (e - after > 1.2 * B) this.tStamp = beatAfter(au, after + 0.2);
    await yieldFrame();
    this.drawForm();

    const bodyH = BODY.top + this.strips.length * (this.th + 8);
    this.avoid = [
      xfRect([BODY.x - 10, BODY.top - 10, BODY.maxW + 20, bodyH - BODY.top + 10], FORM.x, FORM.y, FORM.rot),
      xfRect([NOTE.x - 10, NOTE.label - 20, NOTE.maxW + 20, 170], FORM.x, FORM.y, FORM.rot),
    ];
    this.tapeAvoid = [100, TAPE.y - this.th / 2 - 10, TAPE.head - 90, this.th + 20];
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
      c.fillStyle = g.ch === '♥' ? rgba('rose') : ink(0.92 - 0.1 * hash(this.seed, row, g.i));
      c.fillText(g.ch, 18 + g.x, this.th / 2 + this.size * 0.36);
    }
    // STOP 印成訊號色（電報裡最醒目的字）
    let at = txt.indexOf('STOP');
    while (at >= 0) {
      const x = 18 + measure(txt.slice(0, at), this.fam, this.size);
      c.fillStyle = mixRgba('paper', 'bone', 0.45); c.fillRect(x - 2, 14, measure('STOP', this.fam, this.size) + 4, this.th - 22);
      c.fillStyle = sigInk(0.95);
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
    c.strokeStyle = ink(0.8); c.lineWidth = 2.5; c.strokeRect(16, 16, FORM.w - 32, FORM.h - 32);
    c.lineWidth = 0.8; c.strokeRect(22, 22, FORM.w - 44, FORM.h - 44);
    // 表頭
    c.fillStyle = ink(0.95);
    c.font = font(F.hei(900), 50); c.letterSpacing = '26px'; c.fillText('電報', 40, 84); c.letterSpacing = '0px';
    c.font = font(F.mono(600), 17); c.letterSpacing = '6px'; c.fillText('TELEGRAM', 206, 58);
    c.font = font(F.hei(500), 17); c.letterSpacing = '4px'; c.fillText('愛情電報局 · LOVE TELEGRAPH OFFICE', 206, 84);
    c.letterSpacing = '0px';
    c.textAlign = 'right';
    c.font = font(F.mono(600), 20); c.letterSpacing = '3px';
    c.fillText(`No.${String(m?.n ?? 0).padStart(3, '0')}`, FORM.w - 44, 58);
    c.font = font(F.hei(700), 18); c.fillText('等級　急電 URGENT', FORM.w - 44, 86);
    c.textAlign = 'left'; c.letterSpacing = '0px';
    c.fillRect(40, 100, FORM.w - 80, 2);
    // 附言（歌詞）欄
    const lab = (zh: string, en: string, x: number, y: number) => {
      c.fillStyle = ink(0.62);
      c.font = font(F.hei(500), 15); c.letterSpacing = '4px'; c.fillText(zh, x, y);
      const w = measure(zh, F.hei(500), 15, 4);
      c.font = font(F.mono(500), 11); c.letterSpacing = '3px'; c.fillText(en, x + w + 10, y);
      c.letterSpacing = '0px';
      return x + w + 10 + measure(en, F.mono(500), 11, 3);
    };
    lab('附言', 'PREAMBLE · 發報時播放之歌曲', NOTE.x, NOTE.label);
    c.fillStyle = ink(0.22); c.fillRect(NOTE.x, NOTE.base + 16, NOTE.maxW, 1); c.fillRect(NOTE.x, NOTE.base + 79, NOTE.maxW, 1);
    // 欄位列
    const fy = 318;
    const cols: [string, string, string, number][] = [
      ['收報人', 'TO', this.to, 40], ['發報人', 'FROM', this.from, 370], ['字數', 'WORDS', String(this.words), 720], ['收報時間', 'RECEIVED', DATE_DOTS.split(' · ').join('.'), 870],
    ];
    for (const [zh, en, v, x] of cols) {
      lab(zh, en, x, fy - 30);
      c.fillStyle = ink(0.95);
      c.font = font(F.hei(700), 26);
      let vv = v;
      while (Array.from(vv).length > 3 && measure(vv, F.hei(700), 26) > 300) vv = Array.from(vv).slice(0, -2).join('') + '…';
      c.fillText(vv, x, fy + 6);
    }
    c.fillStyle = ink(0.85); c.fillRect(40, 338, FORM.w - 80, 1.6);
    // 貼紙帶的行線（淡淡的）
    c.fillStyle = ink(0.12);
    for (let r = 0; r < 4; r++) { const y = BODY.top + r * (this.th + 8) + this.th + 4; if (y < BODY.bottom) c.fillRect(40, y, FORM.w - 80, 1); }
    // 簽收欄
    c.fillStyle = ink(0.85); c.fillRect(40, SIGN.rule, FORM.w - 80, 1.6);
    lab('收報人簽收', 'RECEIVED BY', 40, SIGN.label);
    c.fillStyle = ink(0.35); c.fillRect(260, SIGN.base + 8, 420, 1.2);
    // 左邊界直排的冷面小字
    c.save(); c.translate(26, FORM.h - 40); c.rotate(-Math.PI / 2);
    c.font = font(F.hei(500), 11); c.letterSpacing = '4px'; c.fillStyle = ink(0.45);
    c.fillText('＊本電報以愛心計費，每字零元。', 0, 0);
    c.restore();
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
    // ---- 電報紙
    c.save();
    c.translate(FORM.x, FORM.y); c.rotate(FORM.rot);
    drawShadow(c, this.sh, 6, 14, 0.25);
    c.drawImage(this.form!.cv, 0, 0, FORM.w, FORM.h);
    this.drawNote(c, t);
    // 已經貼好的紙帶（還在飛的另外畫在最上面）
    for (const s of this.strips) if (t >= s.cut + FLY) this.drawPasted(c, s, t);
    this.drawSign(c, t);
    // 收件戳
    if (t >= this.tStamp && this.stamp) {
      const k = prog(t, this.tStamp, this.tStamp + 0.07, ease.outQuad);
      const sc = lerp(1.3, 1, k);
      c.save();
      c.globalCompositeOperation = 'multiply';
      c.globalAlpha = 0.5 + 0.5 * k;
      c.translate(FORM.w - 150, SIGN.rule + 4); c.rotate(0.12 + (hash(this.seed, 9) - 0.5) * 0.1); c.scale(sc * 0.86, sc * 0.86);
      c.drawImage(this.stamp.cv, -this.stamp.w / 2, -this.stamp.h / 2, this.stamp.w, this.stamp.h);
      c.restore();
    }
    c.restore();

    // ---- 收報機的紙帶（螢幕座標）
    this.drawTape(c, t);
    // 飛下來的紙帶
    for (const s of this.strips) if (t >= s.cut && t < s.cut + FLY) this.drawFlying(c, s, t);

    const P = this.pass.u;
    P.layer!.value = L.upload();
    P.bake!.value = ensureBake(renderer);
    P.tone!.value = 0.15;
    P.t!.value = t;
    this.pass.render(renderer, out);
    let amp = 11 * pulse(t, this.tStamp, 0.06);
    for (const s of this.strips) amp += 3 * pulse(t, s.cut + FLY, 0.05);
    const ph = frameIdx(t);
    return {
      paper: 1, popupAvoid: t < this.strips[this.strips.length - 1]!.cut ? [...this.avoid, this.tapeAvoid] : this.avoid, bloom: 0.2, bloomThreshold: 1.6, halation: 0.04, vignette: 0.26, grain: 0.05, ca: 0.4,
      shake: [amp * (hash(ph, 1) - 0.5) * 2, amp * (hash(ph, 2) - 0.5) * 2],
      zoom: 1 + 0.02 * pulse(t, this.tStamp, 0.1) + 0.015 * prog(t, e - 1, e, ease.inCubic),
    };
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
    // 空白的紙帶：從印字頭到畫面右緣（捲筒在畫面外）
    c.fillStyle = mixRgba('paper', 'bone', 0.45);
    c.fillRect(TAPE.head, y0, W - TAPE.head, this.th);
    c.fillStyle = ink(0.12); c.fillRect(TAPE.head, y0 + 3, W - TAPE.head, 1); c.fillRect(TAPE.head, y0 + this.th - 4, W - TAPE.head, 1);
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
    // 收報機：深色的機身、上面一個字輪（每打一個字轉一格）、紙帶穿過中間的窗；每打一個字，訊號色的小燈閃一下
    const hx = TAPE.head, th = this.th;
    let n = 0, hit = 0;
    for (const s of this.strips) for (const ch of s.chars) if (t >= ch.at) { n++; hit = Math.max(hit, pulse(t, ch.at, 0.04)); }
    const top = y0 - 74, bot = y0 + th + 54;
    c.fillStyle = ink(0.14); c.beginPath(); c.roundRect(hx + 4, top + 12, 176, bot - top, 20); c.fill();
    c.fillStyle = ink(0.9); c.beginPath(); c.roundRect(hx - 8, top, 176, bot - top, 20); c.fill();
    c.fillStyle = ink(0.72); c.beginPath(); c.roundRect(hx + 2, top + 10, 156, 52, 12); c.fill();
    c.fillStyle = mixRgba('paper', 'bone', 0.45); c.fillRect(hx - 8, y0, 176, th);
    c.fillStyle = ink(0.35); c.fillRect(hx - 8, y0, 176, 4); c.fillRect(hx - 8, y0 + th - 4, 176, 4);
    // 字輪：一圈刻度，打一個字轉一格（很短的緩動）
    const wx = hx + 56, wy = top + 36;
    const lastAt = (() => { let a = -Infinity; for (const s of this.strips) for (const ch of s.chars) if (t >= ch.at) a = ch.at; return a; })();
    const ang = (n - 1 + ease.outCubic(clamp((t - lastAt) / 0.04))) * (TAU / 24);
    c.strokeStyle = paper(0.75); c.lineWidth = 2;
    c.beginPath(); c.arc(wx, wy, 20, 0, TAU); c.stroke();
    for (let i = 0; i < 12; i++) {
      const a = ang + (i / 12) * TAU;
      c.beginPath(); c.moveTo(wx + Math.cos(a) * 12, wy + Math.sin(a) * 12); c.lineTo(wx + Math.cos(a) * 19, wy + Math.sin(a) * 19); c.stroke();
    }
    c.fillStyle = sigInk(0.3 + 0.7 * hit);
    c.beginPath(); c.arc(hx + 130, wy, 7, 0, TAU); c.fill();
    c.fillStyle = paper(0.7); c.font = font(F.mono(600), 11); c.letterSpacing = '3px';
    c.fillText('收報機 TELEPRINTER', hx + 4, bot - 20);
    c.letterSpacing = '0px';
  }

  /** 收報人簽收：手寫字一個字一個字寫出來。 */
  private drawSign(c: Ctx2, t: number) {
    const [a, b] = this.signT;
    if (t < a) return;
    const fam = F.hand(700);
    const lay = layout(this.signer, fam, 46);
    const per = (b - a) / Math.max(1, lay.glyphs.length);
    c.save();
    c.translate(270, SIGN.base); c.rotate(-0.03);
    c.font = font(fam, 46); c.fillStyle = ink(0.92);
    for (const g of lay.glyphs) writeGlyph(c, g.ch, g.x, 0, 46, g.w, clamp((t - a - g.i * per) / per));
    c.restore();
  }

  /** 附言欄：歌詞逐字跟唱；間奏與純音樂寫一句冷面的附言。 */
  private drawNote(c: Ctx2, t: number) {
    const { lyrics } = this.ctx;
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const st = paperLyric(F.archivo(100, 800), 54, NOTE.maxW, { lineHeight: 1.16 });
      const lay = layoutLyric(c, ly.line, st);
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
    c.font = font(F.hei(500), 36); c.letterSpacing = '3px';
    c.fillText(lyrics.has ? '♪（間奏中）' : '♪ 本曲為純音樂，請自行哼唱', NOTE.x, NOTE.base);
    c.restore();
  }
}

/** 紙帶飛下來要多久（秒）。 */
const FLY = 0.42;
