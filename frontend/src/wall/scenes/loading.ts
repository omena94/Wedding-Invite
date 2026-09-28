// 安裝進度（批次 T6・螢幕 B，暗）：「正在安裝：婚姻 v1.0」。
//  - 左上是巨大的百分比（Archivo 窄體 900），一拍跳一次，數字像吃角子老虎一樣往上捲；
//  - 下面是「磁碟區塊圖」：幾百個小方格照亂數順序被寫入（剛寫入的是燒紅的訊號色，冷卻成紙白），
//    再下面是一條細細的進度條，尖端就是仙女棒的火花，每一拍往前衝一下；
//  - 衝到 99% 就卡住（冷面笑話：剩餘時間「一輩子」），數字在大鼓上發抖，最後一個小節線才跳到 100%：整片區塊閃一下、標題改成「安裝完成」；
//  - 右邊是「版本說明 v1.0」：主打留言就是這一版的更新內容，下面勾一個「我同意以上條款」；
//  - 歌詞是「正在寫入」那一行（逐字跟唱），最下面一行安裝日誌一拍印一行。
// 手法：區塊圖、進度條、背景全部在一個 GLSL pass 裡畫（逐格只改 uniform），字在一張 Canvas 層，火花用 LineBatch。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog, frameIdx } from '../engine/util';
import type { FitResult } from '../engine/text';
import type { Lyrics } from '../engine/lyrics';
import { lyricAt, drawLyric, layoutLyric, sparkHead, sparkParticles, beatAfter, signature, drawMessage, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { beatsIn, lastBeatBefore, fitMessage, inOut, type Rect } from './_t6';

export const spec: PlateSpecDecl = { group: 'type', family: 'screen', paper: false, energy: [0.35, 1], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 版面
const X0 = 110;
const NUM_BASE = 505, NUM_SIZE = 290; // 大數字的基線與字級
const MAP = { x: X0, y: 556, w: 660, h: 88 }; // 區塊圖（15 px 一格）
const CELL = 15;
const BAR = { x: X0, y: 744, w: 1340 - X0, h: 14 }; // 進度條
const PANEL = { x: 800, y: 130, w: 540, h: 560 }; // 版本說明
const LYR_Y = 846; // 歌詞基線
const LYR_X = X0 + 176;
const LOG_Y = 948;
const [GROOM, BRIDE] = COUPLE_ZH.split(/\s*&\s*/) as [string, string];
/** 安裝日誌（一拍印一行；純音樂時「正在寫入」也輪流寫這些）。 */
const LOG = [
  '解壓縮　默契.pkg', '安裝　早餐輪流做.dll', '設定　兩人份的鑰匙', '更新　芃芃與 QQ 驅動程式', '套用　吵架後先道歉.patch',
  '複製　共同回憶（2,431 個檔案）', '最佳化　一起散步的路線', '清除　單身暫存檔', '驗證　雙方家長的祝福', '註冊　永久授權',
];
const TEXT = `正在安裝婚姻完成剩餘時間一輩子版本說明更新內容我同意以上條款寫入重新開機後生效永遠還沒有留言掃描右下角把你的祝福加進下一版拍${LOG.join('')}${GROOM}${BRIDE}`;

const BG = () => new FSPass(/* glsl */ `
  uniform float t; uniform float p; uniform float done; uniform float fin; uniform float k; uniform float seed; uniform float stall;
  uniform vec4 mapR; uniform vec4 barR;
  void main() {
    vec2 px = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y); // y 向下
    vec3 col = C_INK + (C_INK2 - C_INK) * (0.35 + 0.35 * fbm(px / 460.0 + vec2(t * 0.01, 0.0), 3));
    col *= 1.0 - 0.03 * step(0.5, fract(px.y / 3.0)); // 很淡的掃描線
    // ---- 區塊圖：每一格有自己的寫入順序（亂數，但偏左先寫，像真的磁碟），p 超過就寫入
    vec2 q = px - mapR.xy;
    if (q.x >= 0.0 && q.y >= 0.0 && q.x < mapR.z && q.y < mapR.w) {
      vec2 cell = floor(q / ${CELL}.0);
      vec2 f = mod(q, ${CELL}.0);
      float cols = floor(mapR.z / ${CELL}.0);
      float r = 0.72 * hash12(cell + seed) + 0.28 * cell.x / cols;
      r = r * 0.985;
      float inSq = step(f.x, 11.5) * step(f.y, 11.5);
      float edge = inSq * (1.0 - step(1.2, f.x) * step(f.y, 10.3) * step(1.2, f.y) * step(f.x, 10.3));
      float lit = step(r, p) * inSq;
      float age = clamp((p - r) / 0.06, 0.0, 1.0);
      vec3 hot = mix(C_EMBER * 2.4, C_SIGNAL * 1.3, smoothstep(0.0, 0.5, age));
      vec3 cool = C_BONE * 0.42;
      vec3 c = mix(hot, cool, smoothstep(0.35, 1.0, age));
      // 完成的那一刻：整片從左到右閃一次
      float wave = done * exp(-abs(q.x / mapR.z - (done * 1.6 - 0.3)) * 9.0);
      c += C_SIGNAL * 1.6 * wave;
      col = mix(col, c, lit * k);
      col += C_GRAPHITE * 0.16 * edge * (1.0 - lit) * k;
    }
    // ---- 進度條：細框、斜紋填滿（斜紋往前跑，卡住時停下）、尖端一團白熱
    vec2 b = px - barR.xy;
    float inBar = step(0.0, b.x) * step(b.x, barR.z) * step(0.0, b.y) * step(b.y, barR.w);
    float frame = inBar * (1.0 - step(1.5, b.x) * step(b.x, barR.z - 1.5) * step(1.5, b.y) * step(b.y, barR.w - 1.5));
    col += C_BONE * 0.22 * frame * k;
    float fx = barR.z * p;
    float fill = step(2.5, b.y) * step(b.y, barR.w - 2.5) * step(2.5, b.x) * step(b.x, fx - 1.0);
    float stripe = step(0.5, fract((b.x + b.y) / 22.0 - t * 1.4 * (1.0 - stall)));
    vec3 fc = mix(C_SIGNAL * 0.95, C_BLOOD * 0.9, stripe * 0.45);
    col = mix(col, fc, fill * k);
    float tipD = length(vec2((b.x - fx) * 0.6, b.y - barR.w * 0.5));
    col += C_EMBER * 1.4 * exp(-tipD / 7.0) * k * step(0.001, p) * (1.0 - fin);
    fragColor = vec4(col, 1.0);
  }`, {
  t: { value: 0 }, p: { value: 0 }, done: { value: 0 }, fin: { value: 0 }, k: { value: 1 }, seed: { value: 0 }, stall: { value: 0 },
  mapR: { value: new THREE.Vector4(MAP.x, MAP.y, MAP.w, MAP.h) }, barR: { value: new THREE.Vector4(BAR.x, BAR.y, BAR.w, BAR.h) },
});

interface Prog { v: number; shown: number; prev: number; u: number; tj: number }

export default class Loading extends Scene {
  bg = shared('loading.bg', BG);
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  beats: number[] = []; // b0 … t99 的拍點
  vals: number[] = []; // 每一拍跳到的百分比
  b0 = 0; t99 = 0; t100 = 0; tPanel = 0;
  fit: FitResult | null = null;
  seed = 0;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText(TEXT);
    this.seed = (this.ctx.params.seed ?? 1) % 1000;
    const b0 = this.b0 = beatAfter(au, s + 0.05);
    const beat = au.beatPeriod(b0);
    // 100%：最後一個「後面還有一拍多」的小節線；窗格太短就用最後一拍。99% 先卡住一小節（短窗格兩拍）
    let t100 = au.timeOfBar(Math.floor(au.barAt(e - Math.max(0.9, beat * 1.1)) + 1e-6));
    if (t100 < b0 + 5 * beat) t100 = lastBeatBefore(au, e, Math.max(0.55, beat * 0.9));
    this.t100 = Math.max(t100, b0 + beat);
    this.t99 = Math.max(b0 + beat * 0.5, this.t100 - (this.t100 - b0 >= 10 * beat ? 4 : 2) * beat);
    this.beats = beatsIn(au, b0, this.t99 + 0.01);
    if (!this.beats.length) this.beats = [b0];
    // 每一拍的增量：亂數權重、前面快後面慢（真的安裝程式都這樣），最後一拍剛好 99
    const n = this.beats.length;
    const w = this.beats.map((_, i) => 0.55 + hash(this.seed, i) * 1.1);
    const tot = w.reduce((a, b) => a + b, 0);
    let acc = 0;
    this.vals = w.map((x, i) => {
      acc += x;
      if (i === n - 1) return 99;
      return Math.min(98, Math.round(2 + 96 * Math.pow(acc / tot, 0.8)));
    });
    this.tPanel = b0 + Math.min(beat * 0.5, 0.3);
    if (this.msg) {
      const c = this.layer.ctx;
      // 留言的框：標題列下面到署名上面（最下面一行是「我同意」）
      this.fit = fitMessage(c, this.msg.text, F.hand(400), PANEL.w - 56, PANEL.h - 224, { min: 44, max: 84, lineHeight: 1.26 });
    }
  }

  /** t 時的進度（0..100，連續的，給進度條）與顯示的整數、上一個整數、跳動的係數。 */
  private progress(t: number): Prog {
    if (t < this.b0) return { v: 0, shown: 0, prev: 0, u: 1, tj: this.ctx.start };
    if (t >= this.t100) {
      const u = prog(t, this.t100, this.t100 + 0.22, ease.outExpo);
      return { v: lerp(99, 100, u), shown: 100, prev: 99, u, tj: this.t100 };
    }
    let i = 0;
    while (i + 1 < this.beats.length && this.beats[i + 1]! <= t) i++;
    const tj = this.beats[i]!, prev = i > 0 ? this.vals[i - 1]! : 0, cur = this.vals[i]!;
    const u = prog(t, tj, tj + 0.2, ease.outExpo);
    return { v: lerp(prev, cur, u), shown: cur, prev, u, tj };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const k = inOut(t, s, e, 0.25, 0.3);
    const pr = this.progress(t);
    const stalled = t >= this.t99 && t < this.t100;
    const done = t >= this.t100 ? prog(t, this.t100, this.t100 + 0.9) : 0;
    this.bg.u.t!.value = t;
    this.bg.u.p!.value = pr.v / 100;
    this.bg.u.done!.value = done > 0 && done < 1 ? done : 0;
    this.bg.u.fin!.value = t >= this.t100 ? 1 : 0;
    this.bg.u.k!.value = k;
    this.bg.u.seed!.value = this.seed;
    this.bg.u.stall!.value = stalled ? 1 : 0;
    this.bg.render(renderer, out);

    const L = this.layer; L.clear();
    const c = L.ctx;
    c.globalAlpha = k;
    c.textBaseline = 'alphabetic';
    const fin = t >= this.t100;
    // 抬頭（機器的聲音）
    c.font = font(F.mono(500), 18); c.letterSpacing = '4px'; c.fillStyle = rgba('ash', 0.75);
    c.fillText(`安裝程式　·　${COUPLE_ZH}　·　${DATE_DOTS}`, X0, 112);
    c.letterSpacing = '0px';
    // 標題：正在安裝 → 安裝完成
    c.font = font(F.hei(900), 58);
    c.fillStyle = rgba(fin ? 'signal' : 'bone', 0.96);
    c.fillText(fin ? '安裝完成' : '正在安裝', X0, 196);
    const tw = c.measureText('正在安裝').width;
    c.font = font(F.archivo(100, 700), 58); c.fillStyle = rgba('bone', 0.55);
    c.fillText('婚姻 v1.0', X0 + tw + 28, 196);
    // 大數字：一拍捲一次；99% 卡住時跟著大鼓發抖
    this.drawNumber(c, t, pr, stalled ? f.a.kick : 0, fin);
    // 進度條上方的讀數
    c.font = font(F.mono(500), 20); c.letterSpacing = '2px';
    const beatsLeft = Math.max(0, Math.round(au.beatAt(this.t99) - au.beatAt(t)));
    const eta = fin ? '重新開機後生效：永遠' : stalled ? '剩餘時間：一輩子' : `剩餘時間：約 ${beatsLeft} 拍`;
    c.fillStyle = rgba(stalled ? 'signal' : 'ash', 0.9); c.textAlign = 'right';
    c.fillText(eta, BAR.x + BAR.w, BAR.y - 18);
    c.textAlign = 'left'; c.fillStyle = rgba('ash', 0.7);
    c.fillText(`區塊 ${Math.round(pr.v * 3.24)} / 324`, X0, BAR.y - 18);
    c.letterSpacing = '0px';
    this.drawPanel(c, t, fin);
    this.drawLyricRow(c, t, lyrics);
    this.drawLog(c, t);
    comp.draw(renderer, L.upload(), out);

    // 火花：進度條的尖端（每一拍往前衝的時候噴得最多；卡住時只剩零星幾點）
    this.glow.clear();
    if (t >= this.b0 && !fin && k > 0.5) {
      const tipAt = (tt: number) => ({ x: BAR.x + BAR.w * this.progress(tt).v / 100, y: BAR.y + BAR.h / 2 });
      const tip = tipAt(t);
      sparkParticles(this.glow, t, tipAt, { rate: (tb) => (tb >= this.t99 ? 25 : 60 + 140 * (1 - this.progress(tb).u)), rateMax: 200, life: 0.4, speed: 240, seed: 3 });
      sparkHead(this.glow, tip.x, tip.y, t, stalled ? 0.8 + 0.4 * f.a.kick : 1.05);
    }
    if (this.glow.count) this.glow.render(renderer, out);
    const jump = pulseAt(t, pr.tj, 0.12);
    const avoid: Rect[] = [[PANEL.x - 16, PANEL.y - 16, PANEL.w + 32, PANEL.h + 32], [X0 - 10, LYR_Y - 70, 1340 - X0 + 20, 150], [X0 - 10, 140, PANEL.x - X0, NUM_BASE - 120]];
    return {
      bloom: 0.7, vignette: 0.45,
      zoom: 1 + 0.004 * jump + 0.012 * (fin ? Math.exp(-(t - this.t100) * 5) : 0),
      flash: fin ? 0.16 * Math.exp(-(t - this.t100) * 7) : 0,
      shake: stalled ? [1.6 * f.a.kick * (hash(frameIdx(t), 1) - 0.5), 1.6 * f.a.kick * (hash(frameIdx(t), 2) - 0.5)] : [0, 0],
      popupAvoid: avoid,
    };
  }

  private drawNumber(c: CanvasRenderingContext2D, t: number, pr: Prog, tremble: number, fin: boolean) {
    const fam = F.archivo(62, 900);
    c.save();
    c.font = font(fam, NUM_SIZE);
    const hgt = NUM_SIZE * 0.78;
    // 捲動的視窗（數字只在這裡面出現）
    c.beginPath(); c.rect(X0 - 20, NUM_BASE - hgt - 16, PANEL.x - X0, hgt + 40); c.clip();
    const dx = tremble * 6 * (hash(frameIdx(t), 3) - 0.5), dy = tremble * 4 * (hash(frameIdx(t), 4) - 0.5);
    const draw = (v: number, y: number, a: number) => {
      const str = String(v);
      c.globalAlpha = a;
      c.fillStyle = rgba(fin && v === 100 ? 'signal' : 'bone', 0.97);
      c.fillText(str, X0 + dx, y + dy);
      const w = c.measureText(str).width;
      c.save();
      c.font = font(fam, NUM_SIZE * 0.42); c.fillStyle = rgba('ash', 0.9);
      c.fillText('%', X0 + w + 14 + dx, y + dy - NUM_SIZE * 0.36);
      c.restore();
    };
    const u = pr.u;
    const g = c.globalAlpha;
    if (u < 1 && pr.shown !== pr.prev) {
      draw(pr.prev, NUM_BASE - hgt * 1.1 * u, g * (1 - u));
      draw(pr.shown, NUM_BASE + hgt * 1.1 * (1 - u), g);
    } else draw(pr.shown, NUM_BASE, g);
    c.restore();
  }

  /** 右邊的「版本說明」：留言就是更新內容；最後勾一個「我同意以上條款」。 */
  private drawPanel(c: CanvasRenderingContext2D, t: number, fin: boolean) {
    const u = prog(t, this.tPanel, this.tPanel + 0.45, ease.outExpo);
    if (u <= 0) return;
    const P = PANEL;
    c.save();
    c.globalAlpha *= u;
    c.translate((1 - u) * 60, 0);
    c.fillStyle = rgba('ink2', 0.92); c.fillRect(P.x, P.y, P.w, P.h);
    c.strokeStyle = rgba('bone', 0.22); c.lineWidth = 1.2; c.strokeRect(P.x + 0.5, P.y + 0.5, P.w - 1, P.h - 1);
    c.fillStyle = rgba('bone', 0.06); c.fillRect(P.x + 1, P.y + 1, P.w - 2, 52);
    c.font = font(F.hei(700), 24); c.fillStyle = rgba('bone', 0.9);
    c.fillText('版本說明', P.x + 26, P.y + 35);
    c.font = font(F.mono(500), 17); c.fillStyle = rgba('ash', 0.8); c.letterSpacing = '2px';
    c.fillText(this.msg ? `v1.0 · NO.${String(this.msg.n).padStart(3, '0')}` : 'v1.0', P.x + 150, P.y + 34);
    c.fillStyle = rgba('signal', 0.9); c.textAlign = 'right';
    c.fillText(this.msg?.couple ? '新人的話' : '更新內容', P.x + P.w - 26, P.y + 34);
    c.textAlign = 'left'; c.letterSpacing = '0px';
    const x = P.x + 28;
    let y = P.y + 70;
    if (this.msg && this.fit) {
      const fit = this.fit;
      const total = fit.lines.reduce((a, l) => a + Array.from(l).length, 0);
      const t0 = this.tPanel + 0.2;
      const chars = total * prog(t, t0, t0 + clamp(0.035 * total + 0.3, 0.5, 2));
      drawMessage(c, fit, F.hand(400), x, y + 20 + fit.size, { chars, color: rgba('bone', 0.96) });
      y += 20 + fit.height + 62;
      c.save(); c.globalAlpha *= prog(t, t0 + 0.4, t0 + 0.9);
      c.font = font(F.hand(400), 44); c.fillStyle = rgba('ash'); c.textAlign = 'right';
      c.fillText(signature(this.msg.name), P.x + P.w - 30, y);
      c.restore();
    } else {
      c.font = font(F.hand(400), 60); c.fillStyle = rgba('bone', 0.92);
      c.fillText('這一版還沒有', x, y + 100);
      c.fillText('新的祝福', x, y + 180);
      c.font = font(F.hei(500), 28); c.fillStyle = rgba('ash', 0.9);
      c.fillText('掃描右下角 QR code，', x, y + 280);
      c.fillText('把你的祝福加進下一版', x, y + 322);
    }
    // 我同意以上條款：勾勾在 99% 卡住的那一拍刷上去
    const cy = P.y + P.h - 40;
    c.strokeStyle = rgba('bone', 0.6); c.lineWidth = 2; c.strokeRect(x + 1, cy - 26, 30, 30);
    const ck = prog(t, this.t99, this.t99 + 0.18, ease.outCubic);
    if (ck > 0) {
      c.strokeStyle = rgba('signal'); c.lineWidth = 5; c.lineCap = 'round';
      c.beginPath(); c.moveTo(x + 6, cy - 12);
      const m = { x: x + 14, y: cy - 2 }, e = { x: x + 34, y: cy - 34 };
      if (ck < 0.4) c.lineTo(lerp(x + 6, m.x, ck / 0.4), lerp(cy - 12, m.y, ck / 0.4));
      else { c.lineTo(m.x, m.y); c.lineTo(lerp(m.x, e.x, (ck - 0.4) / 0.6), lerp(m.y, e.y, (ck - 0.4) / 0.6)); }
      c.stroke(); c.lineCap = 'butt';
    }
    c.font = font(F.hei(500), 24); c.fillStyle = rgba('bone', fin || ck > 0 ? 0.9 : 0.6);
    c.fillText('我同意以上條款（一輩子）', x + 48, cy);
    c.restore();
  }

  /** 「正在寫入」：歌詞逐字跟唱；沒有歌詞時寫安裝的元件。 */
  private drawLyricRow(c: CanvasRenderingContext2D, t: number, lyrics: Lyrics) {
    c.font = font(F.mono(500), 20); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.8);
    c.fillText('正在寫入 ▸', X0, LYR_Y - 14);
    c.letterSpacing = '0px';
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const st = { family: F.archivo(100, 800), size: 60, minSize: 48, maxWidth: 1340 - LYR_X, lineHeight: 1.12 };
      c.save(); c.translate(LYR_X, LYR_Y);
      drawLyric(c, ly.line, t, st, layoutLyric(c, ly.line, st), ly.k);
      c.restore();
    } else {
      // 純音樂或兩句之間：寫現在安裝的元件（一小節換一個）
      const au = this.ctx.audio;
      const i = Math.floor(au.barAt(t));
      const item = LOG[((i % LOG.length) + LOG.length) % LOG.length]!;
      const u = prog(au.barAt(t) - i, 0, 0.12, ease.outExpo);
      c.save(); c.globalAlpha *= u;
      c.font = font(F.hei(700), 56); c.fillStyle = rgba('bone', lyrics.has ? 0.45 : 0.9);
      c.fillText(item, LYR_X, LYR_Y);
      c.restore();
    }
  }

  /** 最下面的安裝日誌：一拍印一行，只留最後兩行。 */
  private drawLog(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const n = t < this.b0 ? 0 : Math.floor(au.beatAt(t) - au.beatAt(this.b0) + 1e-4) + 1;
    c.font = font(F.mono(400), 20);
    for (let j = 0; j < 2; j++) {
      const i = n - 1 - j;
      if (i < 0) break;
      const done = t >= this.t100 && j === 0;
      const line = done ? '安裝完成，重新開機後生效：永遠' : LOG[i % LOG.length]!;
      c.fillStyle = rgba(j === 0 ? 'bone' : 'ash', j === 0 ? 0.75 : 0.4);
      c.fillText(`[ ${done ? 'OK' : j === 0 ? '..' : 'OK'} ]　${line}`, X0, LOG_Y - j * 30);
    }
  }
}

/** 事件 t0 之後的衰減脈衝（1 → 0）。 */
function pulseAt(t: number, t0: number, hl: number) { return t < t0 ? 0 : Math.pow(0.5, (t - t0) / hl); }
