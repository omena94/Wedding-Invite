// 愛情統一發票（亮版面）：桌上兩張感熱紙。
//  - 左邊是「祝福證明聯」：切進來時從畫面上方一格一格「吐」下來（十六分音符一格，像收銀機的印表機），
//    表頭、期別（116年03-04月）、發票號碼 AO-20270313（婚禮日期）、隨機碼、賣方（新人）買方（留言署名）、條碼，
//    下面「品名」是主打留言，金額「∞」。剛印好的字是熱的（紙上的訊號色），一秒內冷卻成墨色。
//  - 對獎：落定之後，號碼下面的八格「本期特別獎」一拍開一個號碼（數字先亂跳、落在拍點上），開出來的號碼跟發票號碼一樣，
//    上面那一位就劃一條訊號色的線；八個都對中的下一拍，「中獎」章砸下去：特別獎，獎金一輩子的幸福。
//  - 右邊是「交易明細」：一台小印表機，歌詞一行一行從出紙口印出來（一行一個品項，×1 ∞），整條紙跟著往上推；
//    剛印的那行先淡淡出現（三成的墨），唱到的字變熱（訊號色）、唱完冷卻成墨色——感熱紙本來就是「加熱才顯色」，剛好就是跟唱。
// 純音樂：明細改成每個小節印一行「♪ 第 N 小節 ×1 ∞」。沒有留言：品名印邀請。新人的留言：賣方買方都是新人。
// 畫法：左邊的發票（不會變的字）開場畫在一張離屏畫布上；明細的紙條、對獎的數字、章每格畫；桌面是紙 shader 的木紋。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { F, font, layout, loadText, measure } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog, pulse, frameIdx } from '../engine/util';
import type { FitResult } from '../engine/text';
import type { Line } from '../engine/lyrics';
import { lyricAt, drawLyric, layoutLyric, beatAfter, COUPLE_ZH, DATE_DOTS, type LyricLayout } from './_motifs';
import { WEDDING_TIME_FROM } from '../../constants.js';
import { sigInk, ink, paper, heatInk, paperLyric, makeCanvas, freeCanvas, shadowSprite, drawShadow, drawBarcode, barsIn, xfRect, paperPass, ensureBake, themeKey, inkStamp, fitMsg, yieldFrame, type Rect } from './_t1';

export const spec: PlateSpecDecl = { group: 'type', family: 'doc', paper: true, energy: [0.25, 0.9], bars: [4, 8], weight: 1 };

type Ctx2 = CanvasRenderingContext2D;

/** 左邊的發票（螢幕座標的左上角、寬、高、角度）。 */
const SLIP = { x: 150, y: 70, w: 570, h: 912, rot: -0.022 };
/** 發票上的位置（發票座標）。 */
const NUM = { base: 228, size: 64 };
const BOX = { y: 250, w: 48, h: 58, gap: 6 };
const ITEM = { x: 22, y: 570, w: 526, h: 272 };
/** 右邊的明細：紙條的左右、出紙口的高度。 */
const DET = { x0: 800, x1: 1336, slot: 846, pad: 22 };
const ROW_GAP = 26;

const TEXT = '愛情統一發票祝福證明聯年月格式隨機碼總計賣方買方品名數量單價金額本期特別獎號碼開獎中對中獎獎金一輩子的幸福交易明細本曲純音樂第小節一位賓客全體賓客掃描右下角把祝福寫上大螢幕新人明細機出紙口間奏';

/** 明細紙條上的一段（表頭或一行歌詞）。 */
interface Block { kind: 'head' | 'line' | 'bar'; line?: Line; label?: string; lay?: LyricLayout; h: number; top: number; at: number }

export default class Invoice extends Scene {
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  pass = shared('invoice.paper', () => paperPass(DESK_GLSL));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = Number(this.ctx.params.seed ?? 1);
  art: ReturnType<typeof makeCanvas> | null = null;
  stamp: ReturnType<typeof makeCanvas> | null = null;
  artKey = '';
  sh = shadowSprite(SLIP.w, SLIP.h, 16, 4);
  buyer = '';
  seller = COUPLE_ZH;
  body = '';
  fit: FitResult | null = null;
  /** 期別：婚禮日期的民國年、雙月。 */
  period = '';
  digits = '20270313';
  blocks: Block[] = [];

  // 時間
  B = 0.5;
  land = 0;
  feed: number[] = [];
  digitT: number[] = [];
  tWin = Infinity;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, start: s, end: e, song } = this.ctx;
    const m = this.msg;
    this.buyer = m ? (m.couple ? COUPLE_ZH : m.name || '一位賓客') : '全體賓客';
    this.body = m ? m.text : '（待填）掃描右下角 QR code，把祝福寫上大螢幕。';
    const [yy = '2027', mm = '03'] = DATE_DOTS.split(' · ');
    const mo = Number(mm), m0 = mo % 2 ? mo : mo - 1;
    this.period = `${Number(yy) - 1911}年${String(m0).padStart(2, '0')}-${String(m0 + 1).padStart(2, '0')}月`;
    this.digits = DATE_DOTS.split(' · ').join('').slice(0, 8);
    const lines = lyrics.linesIn(s - 40, e + 1);
    await loadText(TEXT + this.buyer + this.body + this.period + COUPLE_ZH + (song.title ?? '') + lines.map((l) => l.text).join(''));
    const B = (this.B = au.beatPeriod(s + 0.1));
    const c = this.layer.ctx;
    this.fit = fitMsg(c, this.body, F.hand(700), ITEM.w, ITEM.h, { min: 44, max: m ? 96 : 60, lineHeight: 1.26, maxLines: 5 });

    // ---- 切進來：從上面一格一格吐下來（十六分音符一格），落在第一個夠晚的拍點
    this.land = beatAfter(au, s + Math.max(0.45, B * 0.9));
    const step = B / 4;
    const n = Math.max(3, Math.floor((this.land - s) / step));
    this.feed = Array.from({ length: n }, (_, i) => this.land - (n - 1 - i) * step);

    // ---- 對獎：落定後隔一拍開始，一拍一個號碼（窗格短就半拍、四分之一拍）
    const lot0 = beatAfter(au, this.land + B * 0.9);
    const room = e - lot0 - 1.5 * B;
    const per = room > 9 * B ? B : room > 4.5 * B ? B / 2 : B / 4;
    this.digitT = Array.from({ length: 8 }, (_, i) => lot0 + i * per);
    const win = beatAfter(au, this.digitT[7]! + 0.1);
    if (win < e - 0.6 * B) this.tWin = win;

    // ---- 明細紙條：表頭＋每一行歌詞（純音樂：每個小節一行）
    this.buildBlocks(c, s, e);
    await yieldFrame();
    this.drawArt();
    this.avoid = [
      xfRect([ITEM.x - 6, ITEM.y - 40, ITEM.w + 12, ITEM.h + 90], SLIP.x, SLIP.y, SLIP.rot),
      [DET.x0 - 10, 90, DET.x1 - DET.x0 + 20, DET.slot - 60],
    ];
  }

  override dispose() { freeCanvas(this.art); freeCanvas(this.stamp); freeCanvas(this.sh); this.art = this.stamp = null; super.dispose(); }

  private buildBlocks(c: Ctx2, s: number, e: number) {
    const { lyrics, audio: au } = this.ctx;
    const maxW = DET.x1 - DET.x0 - DET.pad * 2;
    this.blocks = [{ kind: 'head', h: 150, top: 0, at: -Infinity }];
    if (lyrics.has) {
      for (const l of lyrics.linesIn(s - 40, e + 1)) {
        const lay = layoutLyric(c, l, paperLyric(F.archivo(100, 800), 54, maxW));
        this.blocks.push({ kind: 'line', line: l, lay, h: lay.height + 58, top: 0, at: l.start - 0.35 });
      }
    } else {
      // 純音樂：從窗格前兩小節開始，每個小節一行
      for (const bt of barsIn(au, s - 2 * au.beatPeriod(s) * 4, e)) {
        const k = Math.round(au.barAt(bt)) + 1;
        this.blocks.push({ kind: 'bar', label: `♪ 第 ${k} 小節`, h: 48 + 58, top: 0, at: bt });
      }
    }
    let y = 0;
    for (const b of this.blocks) { b.top = y; y += b.h + ROW_GAP; }
  }

  /** 發票上不會變的：表頭、期別、號碼、對獎格、細項、條碼、品名欄的標題。主題換了就重畫。 */
  private drawArt() {
    this.artKey = themeKey();
    freeCanvas(this.art); freeCanvas(this.stamp);
    const a = (this.art = makeCanvas(SLIP.w, SLIP.h, 1.5));
    const c = a.c;
    const W2 = SLIP.w / 2;
    // 紙：上緣是撕下來的鋸齒
    c.fillStyle = paper();
    c.beginPath(); c.moveTo(0, 8);
    for (let x = 0; x <= SLIP.w; x += 12) c.lineTo(x + 6, (x / 12) % 2 ? 0 : 8);
    c.lineTo(SLIP.w, SLIP.h); c.lineTo(0, SLIP.h); c.closePath(); c.fill();
    c.textAlign = 'center';
    c.fillStyle = ink(0.95);
    c.font = font(F.hei(900), 38); c.letterSpacing = '6px'; c.fillText('愛情統一發票', W2 + 3, 58);
    c.font = font(F.hei(700), 26); c.letterSpacing = '16px'; c.fillText('祝福證明聯', W2 + 8, 98);
    c.letterSpacing = '0px';
    c.font = font(F.archivo(100, 900), 54); c.fillText(this.period, W2, 160);
    c.font = font(F.archivo(100, 900), NUM.size); c.fillText(`AO-${this.digits}`, W2, NUM.base);
    // 對獎的八個空格
    const bw = 8 * BOX.w + 7 * BOX.gap, bx = W2 - bw / 2;
    c.strokeStyle = ink(0.55); c.lineWidth = 1.4; c.setLineDash([5, 4]);
    for (let i = 0; i < 8; i++) { c.beginPath(); c.roundRect(bx + i * (BOX.w + BOX.gap), BOX.y, BOX.w, BOX.h, 6); c.stroke(); }
    c.setLineDash([]);
    c.font = font(F.hei(500), 15); c.letterSpacing = '3px'; c.fillStyle = ink(0.62);
    c.fillText('▲ 本期特別獎號碼', W2, BOX.y + BOX.h + 26);
    c.letterSpacing = '0px';
    // 細項
    c.font = font(F.mono(500), 19); c.fillStyle = ink(0.9);
    const [hh = '12', mi = '00'] = String(WEDDING_TIME_FROM).split(':');
    c.fillText(`${DATE_DOTS.split(' · ').join('-')} ${hh}:${mi}:00  格式 25`, W2, 366);
    c.fillText(`隨機碼 ${this.digits.slice(4)}      總計 ∞`, W2, 394);
    c.font = font(F.hei(500), 19);
    let who = `賣方 ${this.seller}　買方 ${this.buyer}`;
    while (Array.from(who).length > 8 && measure(who, F.hei(500), 19) > SLIP.w - 40) who = Array.from(who).slice(0, -2).join('') + '…';
    c.fillText(who, W2, 422);
    drawBarcode(c, 60, 440, SLIP.w - 120, 46, this.seed + 3);
    // 撕線與品名欄
    c.strokeStyle = ink(0.45); c.lineWidth = 1.4; c.setLineDash([8, 6]);
    c.beginPath(); c.moveTo(14, 512); c.lineTo(SLIP.w - 14, 512); c.stroke(); c.setLineDash([]);
    c.textAlign = 'left';
    c.font = font(F.hei(700), 16); c.letterSpacing = '4px'; c.fillStyle = ink(0.7);
    c.fillText(this.msg?.couple ? '品名　新人的話' : this.msg ? '品名　祝福一則' : '品名　（候補）', ITEM.x, 548);
    c.textAlign = 'right'; c.fillText('金額', SLIP.w - ITEM.x, 548);
    c.letterSpacing = '0px';
    c.fillStyle = ink(0.35); c.fillRect(ITEM.x, 558, ITEM.w, 1.2);
    c.font = font(F.mono(600), 22); c.fillStyle = ink(0.95);
    c.fillText('數量 1　單價 ∞　金額 ∞', SLIP.w - ITEM.x, 892);
    c.textAlign = 'left';
    // 署名（買方）：在金額那一行的左邊
    c.font = font(F.hand(700), 32); c.fillStyle = ink(0.8);
    let sig = `—— ${this.buyer}`;
    while (Array.from(sig).length > 4 && measure(sig, F.hand(700), 32) > 220) sig = Array.from(sig).slice(0, -2).join('') + '…';
    c.fillText(sig, ITEM.x, 894);
    // 中獎章（先畫好，蓋的時候整張疊上去）：底下先墊一張紙色的小貼紙，章才不會跟細項的小字攪在一起
    this.stamp = inkStamp(330, 160, this.seed + 21, (sc) => {
      const col = sigInk(0.95);
      sc.strokeStyle = col; sc.fillStyle = col;
      sc.lineWidth = 6; sc.beginPath(); sc.roundRect(-155, -70, 310, 140, 14); sc.stroke();
      sc.lineWidth = 2; sc.beginPath(); sc.roundRect(-143, -58, 286, 116, 9); sc.stroke();
      sc.textAlign = 'center';
      sc.font = font(F.hei(900), 64); sc.letterSpacing = '22px'; sc.fillText('中獎', 12, 14);
      sc.font = font(F.hei(700), 17); sc.letterSpacing = '4px'; sc.fillText('特別獎．獎金：一輩子的幸福', 2, 46);
      sc.letterSpacing = '0px';
    }, 1.25, 0.5);
  }

  // ------------------------------------------------------------------ 畫
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    if (this.artKey !== themeKey()) this.drawArt();
    const L = this.layer;
    L.clear();
    const c = L.ctx;

    this.drawDetails(c, t);

    // ---- 左邊的發票：一格一格吐下來（每格很短的緩動），落定後大鼓讓它輕輕跳一下
    let k = 0;
    for (const ft of this.feed) if (t >= ft) k++;
    const last = this.feed[k - 1] ?? s;
    const frac = k === 0 ? 0 : k - 1 + ease.outExpo(clamp((t - last) / 0.09));
    const drop = (1 - frac / this.feed.length) * (SLIP.h + SLIP.y + 40);
    const kick = this.ctx.audio.hit('kick', t, 0.1);
    const press = pulse(t, this.tWin, 0.06);
    c.save();
    c.translate(SLIP.x, SLIP.y - drop - 2 * kick + 4 * press);
    c.rotate(SLIP.rot * (1 - 0.6 * (drop / SLIP.h)));
    drawShadow(c, this.sh, 6, 12, 0.24);
    c.drawImage(this.art!.cv, 0, 0, SLIP.w, SLIP.h);
    this.drawSlip(c, t);
    c.restore();

    const P = this.pass.u;
    P.layer!.value = L.upload();
    P.bake!.value = ensureBake(renderer);
    P.tone!.value = 0.16;
    P.t!.value = t;
    this.pass.render(renderer, out);
    const amp = 12 * pulse(t, this.tWin, 0.06) + 2.5 * this.digitT.reduce((a, d) => a + pulse(t, d, 0.04), 0);
    const ph = frameIdx(t);
    return {
      paper: 1, popupAvoid: this.avoid, bloom: 0.2, bloomThreshold: 1.6, halation: 0.04, vignette: 0.26, grain: 0.05, ca: 0.4,
      shake: [amp * (hash(ph, 7) - 0.5) * 2, amp * (hash(ph, 8) - 0.5) * 2],
      zoom: 1 + 0.02 * pulse(t, this.tWin, 0.1) + 0.015 * prog(t, e - 1, e, ease.inCubic),
    };
  }

  /** 發票上會變的：剛印好的熱、對獎的數字、對中的劃線、品名（留言）、中獎章。 */
  private drawSlip(c: Ctx2, t: number) {
    const W2 = SLIP.w / 2;
    const heat = 1 - clamp((t - this.land) / 1.1);
    // 留言（品名）：跟發票一起印出來，落定後一秒內冷卻
    const fit = this.fit!;
    const top = ITEM.y + (ITEM.h - fit.height) / 2 + fit.size * 0.86;
    c.font = font(F.hand(700), fit.size);
    fit.lines.forEach((ln, i) => {
      const y = top + i * fit.lineHeight;
      // ♥ 用點綴色
      if (!ln.includes('♥')) { c.fillStyle = heatInk(heat); c.fillText(ln, ITEM.x, y); return; }
      let x = ITEM.x;
      for (const part of ln.split(/(♥)/)) {
        if (!part) continue;
        c.fillStyle = part === '♥' ? rgba('rose') : heatInk(heat);
        c.fillText(part, x, y);
        x += c.measureText(part).width;
      }
    });
    // 對獎：號碼先亂跳，落在拍點上；對中的那一位在發票號碼下面劃一條訊號色的線
    const bw = 8 * BOX.w + 7 * BOX.gap, bx = W2 - bw / 2;
    c.textAlign = 'center';
    c.font = font(F.archivo(100, 900), NUM.size);
    const numW = measure(`AO-${this.digits}`, F.archivo(100, 900), NUM.size);
    const nx0 = W2 - numW / 2 + measure('AO-', F.archivo(100, 900), NUM.size);
    for (let i = 0; i < 8; i++) {
      const dt = this.digitT[i]!;
      const cx = bx + i * (BOX.w + BOX.gap) + BOX.w / 2;
      if (t < dt - 0.32) {
        c.font = font(F.archivo(100, 700), 34); c.fillStyle = ink(0.18); c.fillText('?', cx, BOX.y + 42);
        continue;
      }
      const ch = this.digits[i]!;
      if (t < dt) {
        // 亂跳：每格一個不同的數字，往下捲
        const r = Math.floor(hash(frameIdx(t), i, 3) * 10);
        const u = ((t - (dt - 0.32)) / 0.05) % 1;
        c.save();
        c.beginPath(); c.rect(cx - BOX.w / 2, BOX.y, BOX.w, BOX.h); c.clip();
        c.font = font(F.archivo(100, 900), 40); c.fillStyle = ink(0.5);
        c.fillText(String(r), cx, BOX.y + 44 + (u - 0.5) * 24);
        c.restore();
        continue;
      }
      const pop = 1 + 0.25 * pulse(t, dt, 0.05);
      c.save();
      c.translate(cx, BOX.y + 44); c.scale(pop, pop);
      c.font = font(F.archivo(100, 900), 40); c.fillStyle = heatInk(1 - clamp((t - dt) / 0.8));
      c.fillText(ch, 0, 0);
      c.restore();
      // 發票號碼上對應的那一位：底下劃線（很快地由左往右劃）
      const dw = measure(ch, F.archivo(100, 900), NUM.size);
      const ux = nx0 + measure(this.digits.slice(0, i), F.archivo(100, 900), NUM.size);
      const u = prog(t, dt, dt + 0.08, ease.outCubic);
      c.fillStyle = sigInk(0.95);
      c.fillRect(ux + 2, NUM.base + 8, (dw - 4) * u, 5);
    }
    c.textAlign = 'left';
    // 中獎章
    if (t >= this.tWin && this.stamp) {
      const kk = prog(t, this.tWin, this.tWin + 0.07, ease.outQuad);
      const sc = lerp(1.35, 1, kk);
      c.save();
      // 蓋在細項那幾行上：先墊紙色的貼紙（章落下的那一刻貼上去），「中獎」兩個字才讀得清楚
      c.translate(W2 + 60, 392); c.rotate(-0.15 + (hash(this.seed, 5) - 0.5) * 0.08); c.scale(sc * 0.86, sc * 0.86);
      c.globalAlpha = kk;
      c.fillStyle = ink(0.12); c.beginPath(); c.roundRect(-160, -72, 330, 152, 16); c.fill();
      c.fillStyle = paper(0.97); c.beginPath(); c.roundRect(-166, -78, 332, 152, 16); c.fill();
      c.globalCompositeOperation = 'multiply';
      c.globalAlpha = 0.5 + 0.5 * kk;
      c.drawImage(this.stamp.cv, -this.stamp.w / 2, -this.stamp.h / 2, this.stamp.w, this.stamp.h);
      c.restore();
    }
  }

  /** 右邊的明細機：出紙口在下面，紙條往上長；最新的一行貼著出紙口。 */
  private drawDetails(c: Ctx2, t: number) {
    const { song } = this.ctx;
    // 目前印到第幾段：出現時間已經到的最後一段；換段時紙條往上推（很短的緩動）
    let cur = 0;
    for (let i = 0; i < this.blocks.length; i++) if (this.blocks[i]!.at <= t) cur = i;
    const b = this.blocks[cur]!;
    const prev = this.blocks[Math.max(0, cur - 1)]!;
    const push = cur > 0 ? ease.outExpo(clamp((t - b.at) / 0.22)) : 1;
    const bottom = lerp(prev.top + prev.h, b.top + b.h, push);
    const Y = (py: number) => DET.slot - 18 - (bottom - py);
    const x0 = DET.x0, x1 = DET.x1, w = x1 - x0;
    // 紙條（從畫面上緣之外一直到出紙口）
    const paperTop = Math.max(-40, Y(-20));
    c.save();
    c.fillStyle = ink(0.12); c.fillRect(x0 + 8, paperTop + 10, w, DET.slot - paperTop);
    c.fillStyle = paper(); c.fillRect(x0, paperTop, w, DET.slot - paperTop + 4);
    if (paperTop > -30) {
      // 紙條的開頭：撕過的鋸齒
      c.fillStyle = paper();
      c.beginPath(); c.moveTo(x0, paperTop);
      for (let x = 0; x <= w; x += 12) c.lineTo(x0 + x + 6, paperTop - ((x / 12) % 2 ? 7 : 0));
      c.lineTo(x1, paperTop); c.closePath(); c.fill();
    }
    c.beginPath(); c.rect(x0, -50, w, DET.slot + 50); c.clip();
    for (let i = 0; i <= cur; i++) {
      const bl = this.blocks[i]!;
      const y0 = Y(bl.top);
      if (y0 + bl.h < -20) continue;
      if (bl.kind === 'head') {
        c.textAlign = 'center'; c.fillStyle = ink(0.95);
        c.font = font(F.hei(900), 34); c.letterSpacing = '12px'; c.fillText('交易明細', x0 + w / 2 + 6, y0 + 52);
        c.font = font(F.mono(500), 14); c.letterSpacing = '4px'; c.fillStyle = ink(0.6); c.fillText('DETAILS · 本曲點唱明細', x0 + w / 2, y0 + 80);
        c.font = font(F.hei(500), 20); c.letterSpacing = '1px'; c.fillStyle = ink(0.85);
        let nm = song.title ? `《${song.title}》` : '今晚的歌';
        while (Array.from(nm).length > 4 && measure(nm, F.hei(500), 20, 1) > w - 60) nm = Array.from(nm).slice(0, -2).join('') + '…》';
        c.fillText(nm, x0 + w / 2, y0 + 116);
        c.letterSpacing = '0px'; c.textAlign = 'left';
        dashed(c, x0 + 14, x1 - 14, y0 + bl.h + ROW_GAP / 2);
        continue;
      }
      if (bl.kind === 'bar') {
        const hot = 1 - clamp((t - bl.at) / 0.9);
        c.fillStyle = heatInk(hot); c.font = font(F.hei(700), 48);
        c.fillText(bl.label!, x0 + DET.pad, y0 + 50);
      } else {
        const st = paperLyric(F.archivo(100, 800), 54, w - DET.pad * 2);
        c.save(); c.translate(x0 + DET.pad, y0 + st.size * 0.9);
        drawLyric(c, bl.line!, t, st, bl.lay!, 1);
        c.restore();
      }
      c.font = font(F.mono(500), 16); c.fillStyle = ink(0.55); c.letterSpacing = '2px';
      c.textAlign = 'right'; c.fillText(`×1 ········ ∞`, x1 - DET.pad, y0 + bl.h - 14);
      c.textAlign = 'left'; c.letterSpacing = '0px';
      dashed(c, x0 + 14, x1 - 14, y0 + bl.h + ROW_GAP / 2);
    }
    c.restore();
    // 印表機：出紙口（深色的機身、一條縫、剛印的時候縫亮一下）
    const printing = this.blocks[cur]!.at > -Infinity ? pulse(t, this.blocks[cur]!.at, 0.18) : 0;
    c.fillStyle = ink(0.14); c.beginPath(); c.roundRect(x0 - 18, DET.slot + 12, w + 52, 120, 18); c.fill();
    c.fillStyle = ink(0.86);
    c.beginPath(); c.roundRect(x0 - 26, DET.slot, w + 52, 112, 18); c.fill();
    c.fillStyle = ink(0.7); c.beginPath(); c.roundRect(x0 - 16, DET.slot + 22, w + 32, 80, 12); c.fill();
    c.fillStyle = ink(0.55); c.fillRect(x0 - 6, DET.slot + 8, w + 12, 6);
    c.fillStyle = sigInk(0.35 + 0.65 * printing); c.fillRect(x0 + 4, DET.slot + 9, w - 8, 3);
    c.fillStyle = paper(0.7); c.font = font(F.mono(600), 13); c.letterSpacing = '5px';
    c.fillText('明細機 · RECEIPT PRINTER', x0 + 4, DET.slot + 68);
    c.letterSpacing = '0px';
    // 指示燈：跟著大鼓閃
    const kick = this.ctx.audio.hit('kick', t, 0.1);
    c.fillStyle = sigInk(0.4 + 0.6 * kick);
    c.beginPath(); c.arc(x1 - 10, DET.slot + 63, 6, 0, Math.PI * 2); c.fill();
  }
}

function dashed(c: Ctx2, x0: number, x1: number, y: number) {
  c.fillStyle = ink(0.3);
  for (let x = x0; x < x1; x += 10) c.fillRect(x, y, 5, 1.2);
}

/** 桌面：淡淡的木紋（收銀台）。 */
const DESK_GLSL = /* glsl */ `
vec3 deskArt(vec2 p, vec3 desk) {
  float n = snoise(vec2(p.x * 0.0016, p.y * 0.02));
  float grain = sin(p.y * 0.09 + n * 5.0 + sin(p.x * 0.004) * 2.0);
  return desk * (0.975 + 0.03 * grain);
}`;
