// 綜藝花字（雙語・批次 B1，亮）：綜藝節目的棚內畫面。右邊一座大轉盤（每個小節線「用力一轉」、慢慢停下，
// 指針撥過一根根木釘會被撥一下，停住的那一刻「叮！」），後面是慢慢轉的放射條紋布景，上緣一排跑馬燈泡照拍子追著亮，
// 每個小節線上面灑下一把彩色紙片。
//  - 兩行歌詞是節目的「花字」：中文是一個字（英文一個詞）一個字、各自歪一點的粗黑體，唱到的那一刻「砰」地彈出來
//    （放大再彈回、字後面刷一道螢光筆、四周噴幾條效果線），唱完變墨色；原文是下面一條小字幕貼條（白底細框、歪一點），
//    照原文自己的逐字時間亮。沒有翻譯的歌就沒有貼條（收起來，不留空框）。
//  - 主打留言是節目角落的「觀眾來信」字卡：第一個拍點從左下飛進來（彈一下、歪著停住），每個小節線晃一下；
//    表頭一條訊號色的色帶寫「觀眾來信」、編號，手寫字的留言、署名在最後一行下面。沒有留言時字卡寫「觀眾來信募集中」＋邀請。
//  - 標準 v2：留言 40～60 px、字卡 ≤ 720×420（左下）；中文 40～52、原文 32～40（_b1.ts）。右下角 HUD 底下只有乾淨的地板。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp, springStep, TAU } from '../engine/util';
import { Lyrics, type Line } from '../engine/lyrics';
import { lyricAt, beatAfter, signature, fillWithHearts, type LyricStyle, type LyricLayout } from './_motifs';
import { V2, lyricV2 } from './_v2';
import { biLayout, fitMsgV2, type BiLay, type MsgFit } from './_b1';
import { paperSignal } from './_t19';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'screen', paper: true, energy: [0.45, 1], bars: [4, 8] };

/** 轉盤：圓心、半徑、格數。底座停在 y = 815（右下角 HUD 從 830 開始）。 */
const WH = { x: 1490, y: 452, r: 292, n: 10 };
const PRIZES = ['甜蜜加倍', '再轉一次', '喜糖加量', '百年好合', '免洗碗一週', '永浴愛河', '白頭偕老', '大吉', '謝謝光臨', '幸福滿分'];
/**
 * 歌詞區（左上）、觀眾來信字卡（左下）。歌詞最寬 900：唱到的詞放大時後面的字會往右讓位（最多多出一個詞的四分之一寬），
 * 右端還要離轉盤的外框（x ≈ 1184）至少 40 px。
 */
const LYR = { x: 170, cy: 318, maxW: 900 };
const CARD = { x: 150, y: 548, w: 720, h: 410 };
const BUG = '婚禮綜藝  ·  LIVE';
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const RECRUIT = '觀眾來信募集中！';
const SFX = ['叮！', '噹！', '中獎！', '好耶！'];
const FLOOR = 812;

const BG = () => new FSPass(/* glsl */ `
  uniform float uRot; uniform float uBeat; uniform float uIn; uniform float uKick;
  const vec2 C = vec2(${WH.x}.0, ${WH.y}.0);
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 col = C_PAPER;
    // 放射條紋布景：以轉盤為中心，淺淺的訊號色與紙色相間，整片慢慢轉
    vec2 d = p - C;
    float a = atan(d.y, d.x) / TAU + uRot;
    float stripe = step(0.5, fract(a * 16.0));
    float far = smoothstep(120.0, 900.0, length(d));
    col = mix(col, mix(C_PAPER, C_SIGNAL, 0.16), stripe * (0.55 + 0.45 * far) * uIn);
    // 轉盤後面一圈亮（棚燈打在轉盤上）
    col = mix(col, mix(C_PAPER, C_BONE, 0.7), exp(-length(d) / 420.0) * 0.5);
    // 左邊（字與字卡那一塊）條紋淡一點：字才清楚
    col = mix(col, C_PAPER, 0.6 * (1.0 - smoothstep(900.0, 1180.0, p.x)));
    // 細細的半色調網點（綜藝布景的印刷感）
    vec2 g = mod(p, 14.0) - 7.0;
    col = mix(col, mix(C_PAPER, C_SEPIA, 0.08), smoothstep(2.2, 1.6, length(g)) * 0.35 * (1.0 - smoothstep(0.0, 500.0, p.y)));
    // 地板：比布景深一點，幾條往畫面中間收的線
    if (p.y > ${FLOOR}.0) {
      float dz = (p.y - ${FLOOR}.0) / ${H - FLOOR}.0;
      vec3 fl = mix(C_PAPER, C_SEPIA, 0.07 + 0.05 * dz);
      float xs = (p.x - 960.0) / (0.4 + dz);
      fl = mix(fl, mix(C_PAPER, C_SEPIA, 0.14), (1.0 - smoothstep(0.0, 1.6, abs(mod(xs, 220.0) - 110.0) - 108.0)) * 0.5);
      col = mix(col, fl, smoothstep(${FLOOR}.0, ${FLOOR + 2}.0, p.y));
      // 布景與地板的交界：一條影子
      col *= 1.0 - 0.12 * exp(-(p.y - ${FLOOR}.0) / 10.0);
    }
    // 上緣的跑馬燈：一排燈泡，每拍往右追一格（三顆一組亮一顆）
    float bx = floor(p.x / 64.0);
    vec2 bq = vec2(mod(p.x, 64.0) - 32.0, p.y - 40.0);
    float on = step(mod(bx - floor(uBeat), 3.0), 0.5);
    float bulb = smoothstep(10.0, 8.5, length(bq));
    col = mix(col, mix(C_PAPER, C_SEPIA, 0.3), smoothstep(12.5, 11.0, length(bq)) * (1.0 - bulb));
    col = mix(col, on > 0.5 ? mix(C_SIGNAL, C_EMBER, 0.4) * (1.0 + 0.4 * uKick) : mix(C_PAPER, C_SEPIA, 0.12), bulb);
    col += C_SIGNAL * 0.05 * on * exp(-length(bq) / 22.0);
    fragColor = vec4(col, 1.0);
  }`, { uRot: { value: 0 }, uBeat: { value: 0 }, uIn: { value: 1 }, uKick: { value: 0 } });

interface Burst { t: number; id: number }

export default class KVariety extends Scene {
  bg = shared('kvariety.bg', BG);
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 轉盤的盤面（不會變，只轉）：init 畫一次。 */
  wheel = this.track(new Layer2D(640, 640, undefined, { fast: true }));
  /** 觀眾來信字卡（不會變，只飛進來、晃）：init 畫一次。 */
  card = this.track(new Layer2D(CARD.w + 40, CARD.h + 40, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 197 + (this.msg?.id ?? 0) * 23) >>> 0;
  fit: MsgFit | null = null;
  msgSize: number | null = null;
  cardH = 300;
  tCard = 0;
  /** 每個小節的轉盤角度（轉完停在哪裡）與開始轉的時間。 */
  spins: { t: number; dur: number; a0: number; a1: number }[] = [];
  lyr: LyricStyle = { family: F.hei(900), size: V2.lyrMax, minSize: V2.lyrMin, maxWidth: LYR.maxW, align: 'left', lineHeight: 1.25 };
  title = '';

  override async init() {
    const { audio: au, start: s, end: e, song } = this.ctx;
    const m = this.msg;
    const sig = m ? signature(m.name) : '';
    this.title = song.title ? `本集歌曲：${song.title}` : '';
    await loadText(`${m?.text ?? ''}${sig}${BUG}${INVITE}${RECRUIT}${PRIZES.join('')}${SFX.join('')}觀眾來信No.0123456789FROM THE COUPLE·新人${this.title}`);
    // ---- 轉盤：每個小節線用力轉一次，0.8 小節內慢慢停（停在某一格的正中間）
    const b0 = Math.floor(au.barAt(s) + 1e-4), b1 = Math.ceil(au.barAt(e));
    let a = hash(this.seed, 1) * TAU;
    const seg = TAU / WH.n;
    for (let b = b0 + 1; b <= b1; b++) {
      const tb = au.timeOfBar(b), bar = au.timeOfBar(b + 1) - tb;
      const k = Math.floor(hash(this.seed, b, 2) * WH.n);
      // 轉 1～1.6 圈，最後停在第 k 格正對指針（指針在正上方：盤面角度 = -格子中心）
      let a1 = -((k + 0.5) * seg) - Math.PI / 2;
      while (a1 < a + TAU * (1 + 0.6 * hash(this.seed, b, 3))) a1 += TAU;
      this.spins.push({ t: tb, dur: bar * 0.8, a0: a, a1 });
      a = a1;
    }
    this.spins.unshift({ t: -1e9, dur: 1, a0: this.spins[0]?.a0 ?? a, a1: this.spins[0]?.a0 ?? a });
    this.drawWheel();
    // ---- 觀眾來信字卡
    this.tCard = beatAfter(au, s + 0.05);
    const c = this.card.ctx;
    if (m) {
      this.fit = fitMsgV2(c, m.text, F.hand(700), CARD.w - 90, CARD.h - 100, { lineHeight: 1.3 });
      this.msgSize = this.fit.fit.size;
    }
    this.drawCard(m, sig);
    this.lyr = { ...this.lyr, size: lyricV2(this.msgSize) };
  }

  /** 轉盤的盤面：十格，淺的訊號色、暖黃、紙白交錯，每格一個獎項（沿半徑往外讀），格線上一根木釘。 */
  private drawWheel() {
    const L = this.wheel, c = L.ctx, cx = 320, cy = 320, R = WH.r;
    L.clear();
    const seg = TAU / WH.n;
    const fills = [mixRgba('paper', 'signal', 0.42), mixRgba('paper', 'bone', 0.7), mixRgba('paper', 'ember', 0.5), mixRgba('paper', 'blood', 0.22)];
    for (let i = 0; i < WH.n; i++) {
      c.fillStyle = fills[i % fills.length]!;
      c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, R, i * seg, (i + 1) * seg); c.closePath(); c.fill();
      c.save();
      c.translate(cx, cy); c.rotate((i + 0.5) * seg);
      c.font = font(F.hei(900), 25); c.fillStyle = rgba('sepia', 0.86); c.textBaseline = 'middle'; c.textAlign = 'right';
      c.fillText(PRIZES[i]!, R - 30, 0);
      c.restore();
    }
    c.strokeStyle = rgba('sepia', 0.5); c.lineWidth = 2;
    for (let i = 0; i < WH.n; i++) {
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(i * seg) * R, cy + Math.sin(i * seg) * R); c.stroke();
    }
    // 外圈：一圈墨色的框，框上一圈小燈點；格線的外端是木釘
    c.lineWidth = 16; c.strokeStyle = rgba('sepia', 0.9);
    c.beginPath(); c.arc(cx, cy, R + 6, 0, TAU); c.stroke();
    for (let i = 0; i < WH.n * 3; i++) {
      const a = (i + 0.5) * seg / 3;
      c.fillStyle = rgba('bone', 0.85);
      c.beginPath(); c.arc(cx + Math.cos(a) * (R + 6), cy + Math.sin(a) * (R + 6), 3, 0, TAU); c.fill();
    }
    for (let i = 0; i < WH.n; i++) {
      const a = i * seg;
      c.fillStyle = rgba('ember'); c.strokeStyle = rgba('sepia', 0.8); c.lineWidth = 2;
      c.beginPath(); c.arc(cx + Math.cos(a) * (R - 8), cy + Math.sin(a) * (R - 8), 7, 0, TAU); c.fill(); c.stroke();
    }
    // 中心的軸蓋
    c.fillStyle = rgba('sepia', 0.9);
    c.beginPath(); c.arc(cx, cy, 34, 0, TAU); c.fill();
    c.fillStyle = paperSignal();
    c.beginPath(); c.arc(cx, cy, 22, 0, TAU); c.fill();
  }

  /** 觀眾來信字卡：紙白的卡、表頭一條訊號色的色帶、膠帶；沒有留言時寫「觀眾來信募集中」＋邀請。 */
  private drawCard(m: Msg | null, sig: string) {
    const L = this.card, c = L.ctx, P = 20;
    L.clear();
    const mf = this.fit;
    const head = 54;
    const bodyH = mf ? mf.height : 150;
    const h = Math.min(CARD.h, head + 34 + bodyH + 34);
    this.cardH = h;
    // 影子、卡片
    c.fillStyle = rgba('sepia', 0.14);
    c.beginPath(); c.roundRect(P + 8, P + 10, CARD.w, h, 12); c.fill();
    c.fillStyle = mixRgba('bone', 'paper', 0.25);
    c.beginPath(); c.roundRect(P, P, CARD.w, h, 12); c.fill();
    c.strokeStyle = rgba('sepia', 0.35); c.lineWidth = 1.5; c.stroke();
    // 表頭色帶
    c.save();
    c.beginPath(); c.roundRect(P, P, CARD.w, h, 12); c.clip();
    c.fillStyle = paperSignal(0.9);
    c.fillRect(P, P, CARD.w, head);
    c.restore();
    c.font = font(F.hei(900), 26); c.fillStyle = rgba('bone'); c.textBaseline = 'alphabetic';
    c.fillText(m ? '觀眾來信' : RECRUIT, P + 26, P + 37);
    c.font = font(F.mono(500), 16); c.letterSpacing = '3px'; c.textAlign = 'right';
    c.fillText(m ? (m.couple ? 'FROM THE COUPLE · 新人' : `No.${String(m.n).padStart(3, '0')}`) : 'LIVE', P + CARD.w - 24, P + 34);
    c.textAlign = 'left'; c.letterSpacing = '0px';
    // 內文
    const x = P + 45, top = P + head + 34;
    if (m && mf) {
      const fit = mf.fit;
      c.font = font(F.hand(700), fit.size); c.fillStyle = rgba('sepia', 0.95);
      const y0 = top + fit.size * 0.9;
      fit.lines.forEach((ln, i) => fillWithHearts(c, ln, x, y0 + i * fit.lineHeight));
      c.font = font(F.hand(400), mf.sig); c.fillStyle = rgba('sepia', 0.7);
      const sw = c.measureText(sig).width;
      c.fillText(sig, Math.max(x, x + Math.max(fit.width, sw) - sw), y0 + (fit.lines.length - 1) * fit.lineHeight + mf.sigDy);
    } else {
      c.font = font(F.hand(700), 40); c.fillStyle = rgba('sepia', 0.9);
      c.fillText('你的祝福，下一個就上節目！', x, top + 40);
      c.font = font(F.hei(500), 24); c.letterSpacing = '1px'; c.fillStyle = rgba('sepia', 0.66);
      c.fillText(INVITE, x, top + 96);
      c.letterSpacing = '0px';
    }
    // 膠帶
    c.save();
    c.translate(P + CARD.w / 2, P - 2); c.rotate(-0.05);
    c.fillStyle = rgba('bone', 0.62); c.fillRect(-60, -14, 120, 28);
    c.strokeStyle = rgba('sepia', 0.12); c.lineWidth = 1; c.strokeRect(-60, -14, 120, 28);
    c.restore();
  }

  /** t 時轉盤的角度。 */
  private angle(t: number) {
    let sp = this.spins[0]!;
    for (const x of this.spins) if (x.t <= t) sp = x;
    return lerp(sp.a0, sp.a1, ease.outCubic(clamp((t - sp.t) / sp.dur)));
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const inK = prog(t, s, s + 0.3);
    const u = this.bg.u;
    const barF = au.barAt(t) - au.barAt(s);
    // 布景慢慢轉，每個小節線多轉一小步
    u.uRot!.value = 0.01 * t + 0.02 * (Math.floor(barF) + ease.outExpo(clamp((barF % 1) / 0.25)));
    u.uBeat!.value = au.beatAt(t);
    u.uIn!.value = inK;
    u.uKick!.value = f.a.kick;
    this.bg.render(renderer, out);

    const L = this.layer; L.clear();
    const c = L.ctx;
    c.globalAlpha = inK;
    // ---- 小標：左上角的節目標（小、淡）
    c.font = font(F.mono(600), 17); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.55);
    c.fillText(BUG, 170, 110);
    c.fillStyle = paperSignal(0.5 + 0.5 * (Math.floor(t * 1.5) % 2));
    c.beginPath(); c.arc(170 + c.measureText(BUG).width + 16, 104, 6, 0, TAU); c.fill();
    c.letterSpacing = '0px';

    this.drawWheelProp(c, t);
    this.confetti(c, t);
    // ---- 花字（歌詞）
    const ly = lyricAt(lyrics, t);
    if (ly) this.drawFlower(c, ly.line, t, ly.k);
    else if (!lyrics.has && this.title) {
      c.font = font(F.hei(900), 44); c.fillStyle = rgba('sepia', 0.85);
      c.fillText(this.title, LYR.x, LYR.cy + 16);
    }
    this.drawCardProp(c, t);
    comp.draw(renderer, L.upload(), out);
    // 小節線上鏡頭「推」一下（綜藝的 zoom 特寫），很快回來
    const bt = au.timeOfBar(Math.floor(au.barAt(t) + 1e-4));
    const punch = t > s + 0.1 ? 0.012 * Math.exp(-(t - bt) / 0.18) : 0;
    return { paper: 1, bloom: 0.12, bloomThreshold: 1.6, vignette: 0.2, grain: 0.04, zoom: 1 + punch + 0.015 * f.p };
  }

  /** 轉盤：影子、底座、轉動的盤面、正上方的指針（被木釘撥到會歪一下）、停住時的「叮！」。 */
  private drawWheelProp(c: CanvasRenderingContext2D, t: number) {
    const a = this.angle(t);
    // 底座：一根柱子到地板
    c.fillStyle = mixRgba('paper', 'sepia', 0.55);
    c.beginPath(); c.moveTo(WH.x - 24, WH.y); c.lineTo(WH.x + 24, WH.y); c.lineTo(WH.x + 46, FLOOR + 4); c.lineTo(WH.x - 46, FLOOR + 4); c.closePath(); c.fill();
    c.fillStyle = rgba('sepia', 0.2);
    c.beginPath(); c.ellipse(WH.x, FLOOR + 6, 110, 10, 0, 0, TAU); c.fill();
    // 盤面的影子、盤面
    c.fillStyle = rgba('sepia', 0.14);
    c.beginPath(); c.arc(WH.x + 12, WH.y + 16, WH.r + 16, 0, TAU); c.fill();
    c.save();
    c.translate(WH.x, WH.y); c.rotate(a);
    c.drawImage(this.wheel.canvas, -320, -320, 640, 640);
    c.restore();
    // 指針：正上方，最近的木釘經過時被撥歪
    const seg = TAU / WH.n;
    const rel = ((-Math.PI / 2 - a) % seg + seg) % seg; // 指針離下一根木釘多遠（角度）
    const d = Math.min(rel, seg - rel);
    const flick = Math.max(0, 1 - d / 0.12) * (rel < seg / 2 ? 1 : -1);
    c.save();
    c.translate(WH.x, WH.y - WH.r - 26); c.rotate(-0.45 * flick);
    c.fillStyle = paperSignal(); c.strokeStyle = rgba('sepia', 0.85); c.lineWidth = 3;
    c.beginPath(); c.moveTo(-20, -18); c.lineTo(20, -18); c.lineTo(0, 36); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = rgba('sepia', 0.9); c.beginPath(); c.arc(0, -10, 6, 0, TAU); c.fill();
    c.restore();
    // 停住的那一刻：「叮！」從指針旁邊彈出來
    for (const sp of this.spins) {
      const te = sp.t + sp.dur;
      if (sp.t < this.ctx.start || t < te || t > te + 0.9) continue;
      const k = prog(t, te, te + 0.9);
      const sc = ease.outBack(clamp((t - te) / 0.2));
      c.save();
      c.globalAlpha *= 1 - prog(t, te + 0.6, te + 0.9);
      c.translate(WH.x + 120, WH.y - WH.r - 30 - 30 * k); c.rotate(0.12); c.scale(sc, sc);
      c.font = font(F.hei(900), 30); c.fillStyle = paperSignal(); c.textAlign = 'center';
      c.fillText(SFX[Math.floor(hash(this.seed, Math.round(sp.t * 100), 5) * SFX.length)]!, 0, 0);
      c.restore();
    }
  }

  /** 每個小節線從上面灑下一把彩色紙片（旋轉、飄、慢慢落下；不落到右下角 HUD 那一塊）。 */
  private confetti(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, s = this.ctx.start;
    const cols = [paperSignal(0.85), rgba('ember', 0.9), mixRgba('paper', 'blood', 0.55, 0.85), rgba('sepia', 0.55)];
    const bi = Math.floor(au.barAt(t) + 1e-4);
    const bursts: Burst[] = [];
    for (const b of [bi, bi - 1]) { const tb = au.timeOfBar(b); if (tb >= s + 0.05) bursts.push({ t: tb, id: b }); }
    for (const bu of bursts) {
      const age = t - bu.t;
      if (age < 0 || age > 3) continue;
      for (let i = 0; i < 36; i++) {
        const r = (k: number) => hash(this.seed, bu.id, i, k);
        const x0 = 1000 + 880 * r(1), vy = 260 + 200 * r(2);
        const x = x0 + 40 * Math.sin(age * (2 + 3 * r(3)) + r(4) * 9) + 30 * age * (r(5) - 0.5);
        const y = -20 + vy * age + 60 * age * age;
        if (y > FLOOR + 10 || (x > 1340 && y > 810)) continue;
        const spin = age * (4 + 6 * r(6)) + r(7) * 6;
        c.save();
        c.globalAlpha *= 1 - prog(age, 2.3, 3);
        c.translate(x, y); c.rotate(spin);
        c.scale(1, Math.cos(spin * 1.7));
        c.fillStyle = cols[i % cols.length]!;
        c.fillRect(-7, -4, 14, 8);
        c.restore();
      }
    }
  }

  /**
   * 花字：每個字（英文一個詞）各自歪一點，唱到的那一刻彈出來（放大再彈回）、後面刷一道螢光筆、四周噴幾條效果線；
   * 唱完是墨色，還沒唱三成。下面是原文的小字幕貼條（有翻譯才有）。整塊在左上的歌詞區垂直置中。
   */
  private drawFlower(c: CanvasRenderingContext2D, line: Line, t: number, k: number) {
    const bl: BiLay = biLayout(c, line, this.lyr, { gap: this.lyr.size * 0.55 + 40, sub: { family: F.hei(700), align: 'left', sung: rgba('sepia', 0.9), unsung: rgba('sepia', 0.3), maxWidth: LYR.maxW - 40 } });
    const main = bl.main, size = main.size;
    const y0 = LYR.cy - bl.span / 2 + size * 0.3;
    c.save();
    c.globalAlpha *= k;
    c.translate(LYR.x, y0);
    c.font = font(this.lyr.family, size); c.textBaseline = 'alphabetic';
    const hot = paperSignal();
    // 放大從詞的左下角長出來（左緣與基線不動），同一排後面的詞跟著往右讓出多出來的寬度：放大的詞不會壓到前後的字
    let row = NaN, shift = 0;
    for (const pw of main.words) {
      if (pw.y !== row) { row = pw.y; shift = 0; }
      const w = pw.word, p = Lyrics.wordProgress(w, t);
      const r = (q: number) => hash(line.i, w.index, q);
      const pop = clamp((t - w.start) / 0.28);
      const sc = p <= 0 ? 1 : lerp(1.25, 1, ease.outBack(pop));
      const rot = (r(1) - 0.5) * 0.14;
      const x0 = pw.x + shift, ws = pw.w * sc;
      shift += ws - pw.w;
      const base = pw.y + (r(2) - 0.5) * 14;
      const cx = x0 + ws / 2, cy = base - size * 0.36 * sc;
      c.save();
      c.translate(cx, cy); c.rotate(rot); c.scale(sc, sc);
      // 螢光筆：正在唱的字後面一道訊號色的斜刷
      if (p > 0 && p < 1) {
        c.fillStyle = rgba('signal', 0.3);
        c.beginPath(); c.roundRect(-pw.w / 2 - 4, -size * 0.2, (pw.w + 8) * clamp(pop * 1.4), size * 0.62, 6); c.fill();
      }
      // 字：唱過的有一道墨色的小厚度（往右下錯開的影子），像貼在畫面上的貼紙字
      if (p > 0) { c.fillStyle = rgba('sepia', 0.2); c.fillText(w.w, -pw.w / 2 + 3, size * 0.36 + 4); }
      // 唱完的字：墨色與偏暗紅的墨一個一個交錯（花字的配色），都是深色、在紙上讀得清楚
      const done = w.index % 2 ? mixRgba('sepia', 'blood', 0.55, 0.95) : rgba('sepia', 0.95);
      c.fillStyle = p <= 0 ? rgba('sepia', 0.3) : p < 1 ? hot : done;
      c.fillText(w.w, -pw.w / 2, size * 0.36);
      c.restore();
      // 效果線：彈出來的那 0.3 秒，詞的上方噴幾條短線
      if (p > 0 && pop < 1) {
        c.strokeStyle = paperSignal(0.8 * (1 - pop)); c.lineWidth = 3; c.lineCap = 'round';
        for (let j = 0; j < 4; j++) {
          const a = -Math.PI / 2 + (j - 1.5) * 0.55 + (r(3 + j) - 0.5) * 0.3;
          const r0 = size * 0.62 * sc + 10 * pop, r1 = r0 + 16 + 10 * pop;
          c.beginPath(); c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); c.stroke();
        }
      }
    }
    // 原文的小字幕貼條
    if (bl.sub && bl.subLine && bl.subSt) {
      const sl = bl.sub, sst = bl.subSt;
      const sw = Math.max(...sl.rows.map((q) => q.width)), sh = sl.size * (1.18 * (sl.rows.length - 1) + 1.45);
      c.save();
      c.translate(0, bl.dy); c.rotate(-0.015);
      c.fillStyle = rgba('sepia', 0.12);
      c.beginPath(); c.roundRect(-14 + 4, -sl.size * 1.08 + 5, sw + 28, sh, 10); c.fill();
      c.fillStyle = mixRgba('bone', 'paper', 0.1);
      c.beginPath(); c.roundRect(-14, -sl.size * 1.08, sw + 28, sh, 10); c.fill();
      c.strokeStyle = rgba('sepia', 0.3); c.lineWidth = 1.5; c.stroke();
      // 貼條左邊一小塊訊號色：「原文」的標記
      c.fillStyle = paperSignal(0.85);
      c.beginPath(); c.roundRect(-14, -sl.size * 1.08, 8, sh, [10, 0, 0, 10]); c.fill();
      drawSub(c, bl.subLine, t, sst, sl);
      c.restore();
    }
    c.restore();
  }

  /** 字卡：第一個拍點從左下飛進來（彈一下、歪著停住），每個小節線晃一下。 */
  private drawCardProp(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const kin = clamp((t - this.tCard) / 0.55);
    if (t < this.tCard - 0.01) return;
    const bt = au.timeOfBar(Math.floor(au.barAt(t) + 1e-4));
    const wig = bt > this.tCard + 0.3 ? 0.03 * (1 - springStep(clamp((t - bt) / 0.9), 5, 0.3)) : 0;
    const fly = 1 - ease.outBack(kin);
    const rot = -0.035 - 0.25 * fly + wig;
    const L = this.card, w = L.w, h = L.h;
    c.save();
    c.translate(CARD.x + w / 2 - 700 * fly, CARD.y + this.cardH / 2 + 20 + 260 * fly);
    c.rotate(rot);
    c.drawImage(L.canvas, -w / 2, -this.cardH / 2 - 20, w, h);
    c.restore();
  }

}

/** 原文副行：照原文自己的逐字時間，唱到的用墨色（安靜，不用訊號色）。 */
function drawSub(c: CanvasRenderingContext2D, line: Line, t: number, st: LyricStyle, lay: LyricLayout) {
  c.save();
  c.font = font(st.family, lay.size); c.textBaseline = 'alphabetic';
  for (const pw of lay.words) {
    const p = Lyrics.wordProgress(pw.word, t);
    c.fillStyle = p <= 0 ? (st.unsung ?? rgba('sepia', 0.3)) : (st.sung ?? rgba('sepia', 0.9));
    c.fillText(pw.word.w, pw.x, pw.y);
  }
  c.restore();
}
