// 洗澡（亮、dog）：浴室裡一個加長的貓腳浴缸，芃芃、元元（白色柴犬）、QQ 三隻坐在滿滿的泡泡裡，孟庭跪在浴缸邊拿蓮蓬頭沖水，
// 宣文撐著大浴巾在旁邊等。角色是 Codex 畫的紙偶（_puppet.ts）。
//  - **狗狗甩水在小鼓**（每小節的第二拍、第四拍）：QQ 在第二拍、芃芃在第四拍換成甩水的那張，身體扭一下、水珠往外噴。
//  - **元元甩水最壯觀**：牠最大，坐在中間，每兩小節的第一拍（重拍）站起來甩一整拍：水珠噴得又多又遠、泡泡被甩飛、
//    鏡頭跟著震一下，兩隻博美被噴到縮一下。三隻狗用同一個場景尺度（大小照 dogs3-lineup.png），元元坐得比較深（缸裡露出頭和肩膀）。
//    其他時候坐在泡泡裡跟著拍子點頭。孟庭的蓮蓬頭一直在噴水（水柱在拍點上變強），宣文每拍輕輕點頭。
//  - **留言是泡泡**：一個字一個泡泡，從浴缸裡冒出來、飛上去，**落在拍點上**排好成一行一行的字（右上），停在那裡輕輕浮動；
//    字排完署名淡入。排字照「留言尺寸與版面比例標準 v2」：字 40～60（泡泡本身就是容器，整塊最大 700 × 400）。沒有留言時泡泡排邀請。
//  - 歌詞寫在起霧的鏡子上（左上，像用手指寫的），照跟唱規則逐字亮；比留言小一級（標準 v2：40～52）。
//  - 浴缸前面的泡泡、磁磚、地板；鏡頭慢慢推近泡泡字。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, beatAfter, sparkHead, sparkParticles, drawHeart, heartPoints, signature } from './_motifs';
import { inkFor, paperBG, inkLine, inkPoly, inkEllipse, type Pt, type Note, type Ink } from './_couple';
import { loadPuppets, drawPuppet, puppetPoint, puppetShadow, puppetIn, breathe, beatKick, noteV2, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'couple', family: 'dog', paper: true, energy: [0.3, 1], bars: [4, 8] };

const FLOOR = 920;
const SZ = 440;
/** 浴缸（側面）：左緣、寬、缸口的高度、缸底。 */
const TUB = { x: 200, w: 950, rim: 652, bottom: 858 };
/**
 * 狗坐在浴缸裡（腳底藏在缸裡）：芃芃、元元（中間，最大）、QQ。三隻同一個縮放（DOG_S），比例才對；
 * 元元比博美高很多，腳底放深一點（YY_Y），露出頭和肩膀就好，頭頂不要碰到鏡子。
 */
const PP_X = 400, YY_X = 680, QQ_X = 950, DOG_Y = 706, YY_Y = 770, DOG_S = 1.8;
const OM_X = 118, AL_X = 1262;
/** 泡泡字的範圍（右上；標準 v2：最大 700 × 400）。 */
const AREA = { x: 1110, y: 120, w: 700, h: 400 };
/** 起霧的鏡子（左上）。 */
const MIRROR = { x: 120, y: 100, w: 760, h: 280 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const SPRITES = ['pp_bath', 'pp_shake', 'qq_bath', 'qq_shake', 'yy_c2_bath', 'yy_shake', 'mt_bath_shower', 'xw_bath_towel'];

/** 一個字泡泡：字、在畫面上的位置、從哪裡冒出來、幾點到。 */
interface Bub { ch: string; x: number; y: number; w: number; from: Pt; t0: number; t1: number; seed: number }

export default class DogBath extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  bubs: Bub[] = [];
  /** 署名：位置與幾點淡入。 */
  sig = { x: 0, y: 0, t: 0, size: 28 };
  shower: Pt = { x: 0, y: 0 };
  lyricSize = 48;

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('一位賓客' + INVITE);
    this.track(await loadPuppets(SPRITES));
    const s = this.ctx.start, e = this.ctx.end;
    this.shower = puppetPoint('mt_bath_shower', 'head', OM_X, FLOOR, { h: SZ }) ?? { x: OM_X + 150, y: FLOOR - 250 };
    // 泡泡字：照標準 v2 排好（字級、斷行、署名），每個字一個泡泡；一拍到幾個，在兩小節左右排完（落在拍點上）
    const c = this.fg.ctx;
    const text = this.msg ? this.msg.text : INVITE;
    const n = noteV2(c, text, this.msg ? this.msg.name : null, AREA.w - 40, AREA.h - 20, this.msg ? {} : { max: 44 });
    this.note = n;
    const f = n.fit;
    c.font = font(n.family, f.size);
    // 一個泡泡裝一個「字」：中文一個字一個泡泡；英文、數字一個單字一個（橢圓的長泡泡），不然一串小泡泡疊在一起很亂
    const chars: { ch: string; x: number; y: number; w: number }[] = [];
    const top = AREA.y + Math.max(0, (AREA.h - n.height) * 0.4);
    f.lines.forEach((ln, i) => {
      const lw = c.measureText(ln).width;
      const x0 = AREA.x + AREA.w - 20 - lw;
      let acc = '';
      for (const tok of ln.match(/[A-Za-z0-9'’&.!?,-]+|\s+|./gu) ?? []) {
        const w0 = c.measureText(acc).width, w1 = c.measureText(acc + tok).width;
        acc += tok;
        if (tok.trim()) chars.push({ ch: tok, x: x0 + (w0 + w1) / 2, y: top + f.size * 0.55 + i * f.lineHeight, w: w1 - w0 });
      }
    });
    const t0 = beatAfter(au, s + 0.5);
    const bp = au.beatPeriod(t0);
    const beats = Math.max(2, Math.min(8, Math.floor((e - t0) * 0.5 / bp)));
    const per = Math.max(1, Math.ceil(chars.length / beats));
    const b0 = Math.round(au.beatAt(t0));
    chars.forEach((q, i) => {
      const arrive = au.timeOfBeat(b0 + 1 + Math.floor(i / per));
      const fx = TUB.x + 120 + hash(i, 7) * (TUB.w - 240);
      this.bubs.push({ ...q, from: { x: fx, y: TUB.rim - 10 }, t0: arrive - au.beatPeriod(arrive) * 1.2, t1: arrive, seed: i });
    });
    const last = this.bubs[this.bubs.length - 1];
    this.sig = { x: AREA.x + AREA.w - 20, y: top + f.height + n.sig * 1.2, t: (last?.t1 ?? t0) + 0.15, size: n.sig };
    this.lyricSize = lyricV2(this.msg ? f.size : null);
    this.drawBackground();
  }

  /** 不會動的：磁磚牆、鏡子的框、地板、浴缸（畫一次）。狗坐在浴缸裡，所以浴缸的前面每格畫在狗的上面。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx, ink = inkFor(true);
    L.clear();
    // 右下角 HUD（x ≥ 1360、y ≥ 830）留乾淨：背景的線都不畫進去
    c.save();
    c.beginPath(); c.rect(0, 0, W, H); c.rect(1344, 816, W - 1344, H - 816); c.clip('evenodd');
    // 磁磚牆：到腰的高度一排排的長磁磚（很淡），上面是素牆
    c.save();
    c.strokeStyle = rgba('sepia', 0.1); c.lineWidth = 1.2;
    c.beginPath();
    for (let y = 560, r = 0; y < FLOOR; y += 44, r++) {
      c.moveTo(0, y); c.lineTo(W, y);
      for (let x = (r % 2) * 60; x < W; x += 120) { c.moveTo(x, y); c.lineTo(x, Math.min(FLOOR, y + 44)); }
    }
    c.stroke();
    c.restore();
    inkLine(c, [{ x: 0, y: 558 }, { x: W, y: 558 }], { ink, w: 0.8, seed: 2 });
    // 地板：透視的磁磚線
    inkLine(c, [{ x: 0, y: FLOOR }, { x: W, y: FLOOR }], { ink, w: 1, seed: 3 });
    c.save();
    c.strokeStyle = rgba('sepia', 0.12); c.lineWidth = 1.2;
    c.beginPath();
    for (let k = -8; k <= 12; k++) { const x0 = 700 + k * 110, x1 = 700 + k * 190; if (x1 > 1360 && x0 > 1300) continue; c.moveTo(x0, FLOOR); c.lineTo(Math.min(x1, x1), H); }
    for (const y of [FLOOR + 50, FLOOR + 115]) { c.moveTo(0, y); c.lineTo(1340, y); }
    c.stroke();
    c.restore();
    // 鏡子的框（鏡面與霧每格畫）
    const M = MIRROR;
    c.fillStyle = mixRgba('paper', 'denim', 0.16);
    c.beginPath(); c.roundRect(M.x, M.y, M.w, M.h, 26); c.fill();
    inkPoly(c, roundPts(M.x - 10, M.y - 10, M.w + 20, M.h + 20, 32), { ink, w: 1, seed: 5 });
    inkPoly(c, roundPts(M.x, M.y, M.w, M.h, 26), { ink, w: 0.6, seed: 6, color: rgba('sepia', 0.4) });
    // 霧（白白的一層，中間比邊緣濃）
    const fog = c.createRadialGradient(M.x + M.w / 2, M.y + M.h / 2, 40, M.x + M.w / 2, M.y + M.h / 2, M.w * 0.6);
    fog.addColorStop(0, rgba('bone', 0.75)); fog.addColorStop(1, rgba('bone', 0.45));
    c.fillStyle = fog;
    c.beginPath(); c.roundRect(M.x, M.y, M.w, M.h, 26); c.fill();
    c.restore();
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.paper.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const ink = inkFor(true);
    const rv = prog(t, s, s + 0.5, ease.inOutCubic);

    // 鏡子上的歌詞（用手指寫在霧上）
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const M = MIRROR;
      const st = { family: F.hand(700), size: this.lyricSize, minSize: 40, maxWidth: M.w - 90, align: 'center' as const, unsung: rgba('sepia', 0.3), sung: mixRgba('sepia', 'denim', 0.35, 0.9), active: rgba('signal') };
      const lay = layoutLyric(c, ly.line, st);
      c.save();
      c.translate(M.x + M.w / 2, M.y + M.h / 2 - lay.height / 2 + lay.size * 0.8);
      drawLyric(c, ly.line, t, st, lay, ly.k * rv);
      c.restore();
    } else {
      // 間奏、純音樂：霧上用手指畫的一顆愛心（慢慢描出來，拍點上輕輕一跳）
      const M = MIRROR, pts = heartPoints(64), k = prog(t, this.ctx.start + 0.3, this.ctx.start + 1.6, ease.inOutCubic);
      const sz = 70 * (1 + 0.06 * beatKick(this.ctx.audio, t, 0.25));
      c.save();
      c.strokeStyle = mixRgba('sepia', 'denim', 0.35, 0.45);
      c.lineWidth = 7; c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath();
      const n = Math.max(1, Math.floor(pts.length * k));
      for (let i = 0; i < n; i++) { const p = pts[i]!, x = M.x + M.w / 2 + p.x * sz, y = M.y + M.h / 2 + p.y * sz; i ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.stroke();
      c.restore();
    }

    // ---- 狗（先畫，浴缸的前面蓋住下半身）
    const big = this.yyShakeK(t);
    this.drawDog(c, t, 'pp', PP_X, 3, big);
    this.drawDog(c, t, 'qq', QQ_X, 1, big);
    this.drawYuanyuan(c, t, big);
    this.drawTub(c, ink, t);
    // 元元甩出去的泡泡：一團一團往兩邊飛、落下（蓋在缸口上面）
    if (big >= 0) this.flyingFoam(c, ink, big);
    // ---- 人：孟庭跪在浴缸左邊沖水、宣文撐著浴巾在右邊等
    const enO = puppetIn(t, s + 0.05, 0.42), enA = puppetIn(t, s + 0.16, 0.42);
    if (enO.alpha > 0) {
      puppetShadow(c, 'mt', OM_X, FLOOR, { h: SZ, alpha: 0.3 * enO.alpha, color: '70,45,25' });
      drawPuppet(c, 'mt_bath_shower', OM_X, FLOOR, { h: SZ, spin: enO.spin, alpha: enO.alpha, rot: -0.015 * beatKick(au, t, 0.3), pivot: 0.2, squash: breathe(t, 0.008, 3) });
      if (enO.k >= 1) this.drawSpray(c, t);
    }
    if (enA.alpha > 0) {
      puppetShadow(c, 'xw', AL_X, FLOOR, { h: SZ, alpha: 0.3 * enA.alpha, color: '70,45,25' });
      drawPuppet(c, 'xw_bath_towel', AL_X, FLOOR, { h: SZ, spin: enA.spin, alpha: enA.alpha, squash: 0.012 * beatKick(au, t, 0.3) + breathe(t, 0.008, 3.3, 0.5) });
    }
    for (const [x, en] of [[OM_X, enO], [AL_X, enA]] as const) {
      if (en.alpha > 0 && en.k < 1) { sparkHead(this.glow, x, FLOOR - 6, t, 0.7); sparkParticles(this.glow, t, () => ({ x, y: FLOOR - 6 }), { rate: 50, life: 0.25, speed: 140, seed: x }); }
    }
    this.drawBubbles(c, t);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：慢慢推近泡泡字（最多 1.03 倍）
    const push = ease.inOutCubic(f.p);
    // 元元甩水的那一拍：鏡頭跟著抖一下（越甩越小）
    const jolt = big >= 0 ? (1 - big) * 5 : 0;
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.24, grain: 0.045, ca: 0.5, zoom: 1 + 0.03 * push, shake: [-(AREA.x + AREA.w / 2 - W / 2) * 0.03 * push + jolt * Math.sin(big * 40), -(AREA.y + AREA.h / 2 - H / 2) * 0.03 * push + jolt * 0.5 * Math.cos(big * 33)] };
  }

  /** 這一拍是不是這隻狗甩水（每小節第二拍 QQ、第四拍芃芃），回傳甩水的進度 0..1（沒在甩回傳 -1）。 */
  private shakeK(t: number, beatInBar: number) {
    const au = this.ctx.audio;
    const b = Math.floor(au.beatAt(t) + 1e-6);
    const tb = au.timeOfBeat(b);
    const dur = Math.min(0.42, au.beatPeriod(t) * 0.8);
    if (((b % 4) + 4) % 4 !== beatInBar || t - tb > dur || t < this.ctx.start + 0.8) return -1;
    return (t - tb) / dur;
  }

  /** 元元甩水：每兩小節的第一拍（重拍）甩一整拍，回傳進度 0..1（沒在甩回傳 -1）。窗格開頭一秒內不甩（還在進場）。 */
  private yyShakeK(t: number) {
    const au = this.ctx.audio;
    const bar = Math.floor(au.barAt(t) + 1e-6), tb = au.timeOfBar(bar);
    const dur = Math.min(0.75, au.beatPeriod(t) * 1.3);
    if (bar % 2 !== 0 || t - tb > dur || tb < this.ctx.start + 1) return -1;
    return (t - tb) / dur;
  }

  /**
   * 元元：坐在中間的泡泡裡（最大、最穩，每拍慢慢點頭）；每兩小節的重拍站起來甩水：換成甩水的圖、
   * 身體左右大幅扭三下、往上一挺，水珠噴得又多又遠。
   */
  private drawYuanyuan(c: CanvasRenderingContext2D, t: number, k: number) {
    const au = this.ctx.audio;
    const en = puppetIn(t, this.ctx.start + 0.24, 0.42);
    if (en.alpha <= 0) return;
    const o: PuppetOpts = { h: SZ, scale: DOG_S, spin: en.spin, alpha: en.alpha, pivot: 0.45 };
    if (k >= 0) {
      // 站起來甩：身體整個挺出泡泡（往上 90 px），甩完坐回去
      const up = Math.sin(Math.PI * Math.min(1, k * 1.15)) * 90;
      drawPuppet(c, 'yy_shake', YY_X, YY_Y - up, { ...o, rot: 0.1 * Math.sin(k * Math.PI * 6) * (1 - k), squash: -0.05 * Math.sin(Math.PI * k) + 0.03 * Math.sin(k * Math.PI * 6) });
      this.drops(c, YY_X, YY_Y - SZ * 0.42 * DOG_S * 0.6 - up, k, 7, 2);
    } else {
      drawPuppet(c, 'yy_c2_bath', YY_X, YY_Y, { ...o, rot: 0.02 * Math.sin(au.beatAt(t) * Math.PI * 0.5), squash: 0.025 * beatKick(au, t, 0.35) + breathe(t, 0.01, 2.2, 0.3) });
    }
  }

  /** 元元甩飛的泡泡：幾團泡泡從牠身上往兩邊拋出去、畫弧線落到缸口與地上，邊飛邊變小。 */
  private flyingFoam(c: CanvasRenderingContext2D, ink: Ink, k: number) {
    const y0 = YY_Y - SZ * 0.42 * DOG_S * 0.55;
    for (let i = 0; i < 10; i++) {
      const dir = i % 2 ? 1 : -1;
      const vx = dir * (160 + 260 * hash(i, 91)), vy = -(120 + 200 * hash(i, 92));
      const x = YY_X + vx * k, y = y0 + vy * k + 520 * k * k;
      const r = (10 + 12 * hash(i, 93)) * (1 - 0.6 * k);
      inkEllipse(c, x, y, r, r * 0.9, 0, { ink, fill: rgba('bone'), w: 0.45, seed: 120 + i, color: rgba('sepia', 0.4 * (1 - k)), alpha: 1 - k * k });
    }
  }

  /** 一隻博美：坐在泡泡裡跟著拍子點頭；輪到牠的小鼓那一拍甩水（換圖、身體左右扭、水珠噴出去）；元元甩水時被噴到、縮一下。 */
  private drawDog(c: CanvasRenderingContext2D, t: number, who: 'pp' | 'qq', x: number, beatInBar: number, big: number) {
    const au = this.ctx.audio;
    const en = puppetIn(t, this.ctx.start + (who === 'pp' ? 0.2 : 0.28), 0.42);
    if (en.alpha <= 0) return;
    const k = this.shakeK(t, beatInBar);
    const o: PuppetOpts = { h: SZ, scale: DOG_S, spin: en.spin, alpha: en.alpha, pivot: 0.45 };
    if (k >= 0) {
      drawPuppet(c, `${who}_shake`, x, DOG_Y, { ...o, rot: 0.12 * Math.sin(k * Math.PI * 5) * (1 - k), squash: 0.04 * Math.sin(k * Math.PI * 3) });
      this.drops(c, x, DOG_Y - SZ * 0.29 * DOG_S * 0.55, k, who === 'pp' ? 1 : 2);
    } else {
      // 元元甩水噴到：往外側一縮（身體往遠離元元的方向歪、壓低）
      const duck = big >= 0 ? Math.sin(Math.PI * Math.min(1, big * 1.5)) : 0;
      const away = x < YY_X ? -1 : 1;
      drawPuppet(c, `${who}_bath`, x, DOG_Y, { ...o, rot: 0.03 * Math.sin(au.beatAt(t) * Math.PI + (who === 'pp' ? 0 : 1)) + 0.12 * duck * away, squash: 0.04 * beatKick(au, t, 0.25) + breathe(t, 0.012, 1.4, who === 'pp' ? 0 : 0.5) + 0.06 * duck });
    }
  }

  /** 甩出去的水珠：從身體往四周飛、慢慢落下、變淡（短短的線）。 */
  private drops(c: CanvasRenderingContext2D, x: number, y: number, k: number, seed: number, big = 1) {
    c.save();
    c.strokeStyle = mixRgba('denim', 'bone', 0.35, 0.8 * (1 - k));
    c.lineWidth = 3 * (big > 1 ? 1.3 : 1);
    c.lineCap = 'round';
    c.beginPath();
    const n = Math.round(18 * big * big);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + hash(seed, i) * 0.3;
      const r = 50 * big + 220 * big * ease.outCubic(k) * (0.6 + 0.4 * hash(i, seed));
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r * 0.7 + 80 * big * k * k;
      const tail = 12 * big * (1 - k);
      c.moveTo(px, py); c.lineTo(px - Math.cos(a) * tail, py - Math.sin(a) * tail * 0.7);
    }
    c.stroke();
    c.restore();
  }

  /** 浴缸的前面：白色搪瓷、缸口一條厚邊、底下四隻貓腳；缸口一整排泡泡（蓋住狗的下半身），泡泡慢慢地晃。 */
  private drawTub(c: CanvasRenderingContext2D, ink: Ink, t: number) {
    const T = TUB, r = 70;
    const pts: Pt[] = [{ x: T.x - 12, y: T.rim }, { x: T.x + T.w + 12, y: T.rim }];
    for (let i = 0; i <= 12; i++) { const a = (i / 12) * (Math.PI / 2); pts.push({ x: T.x + T.w - r + r * Math.cos(a), y: T.bottom - r + r * Math.sin(a) }); }
    for (let i = 0; i <= 12; i++) { const a = Math.PI / 2 + (i / 12) * (Math.PI / 2); pts.push({ x: T.x + r + r * Math.cos(a), y: T.bottom - r + r * Math.sin(a) }); }
    // 貓腳
    for (const fx of [T.x + 70, T.x + T.w - 70]) inkPoly(c, [{ x: fx - 16, y: T.bottom - 10 }, { x: fx + 16, y: T.bottom - 10 }, { x: fx + 24, y: FLOOR }, { x: fx - 24, y: FLOOR }], { ink, fill: mixRgba('paper', 'signal', 0.3), w: 0.8, seed: fx });
    puppetShadow(c, 'cp', T.x + T.w / 2, FLOOR, { h: 900, alpha: 0.18, color: '70,45,25' });
    inkPoly(c, pts, { ink, fill: rgba('bone'), w: 1.1, seed: 31 });
    // 缸身的一道反光與缸口的厚邊
    c.strokeStyle = rgba('sepia', 0.12); c.lineWidth = 10; c.lineCap = 'round';
    c.beginPath(); c.moveTo(T.x + 60, T.rim + 40); c.lineTo(T.x + T.w - 90, T.rim + 40); c.stroke();
    inkLine(c, [{ x: T.x - 14, y: T.rim + 12 }, { x: T.x + T.w + 14, y: T.rim + 12 }], { ink, w: 0.7, seed: 32 });
    // 缸口的泡泡：兩排大大小小的圈（後排大、前排小），慢慢晃
    for (let row = 0; row < 2; row++) {
      const n = row ? 40 : 30;
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5 * hash(i, row + 40)) / n;
        const bx = T.x + 6 + u * (T.w - 12) + Math.sin(t * 1.3 + i + row) * 3;
        // 狗的前面泡泡低一點（臉要露出來），兩隻狗之間與兩邊堆高
        const heap = 1 - Math.max(Math.exp(-(((bx - PP_X) / 90) ** 2)), Math.exp(-(((bx - QQ_X) / 90) ** 2)), Math.exp(-(((bx - YY_X) / 110) ** 2)));
        const by = T.rim - (row ? 4 : 18) - (row ? 8 : 20) * hash(i, 41 + row) - heap * (row ? 10 : 26) + Math.sin(t * 1.7 + i * 2) * 2;
        const br = (row ? 9 : 15) + (row ? 10 : 16) * hash(i, 42 + row);
        inkEllipse(c, bx, by, br, br * 0.9, 0, { ink, fill: rgba('bone'), w: 0.45, seed: 50 + i + row * 60, color: rgba('sepia', 0.4) });
      }
    }
  }

  /** 蓮蓬頭噴出來的水：從孟庭手上的蓮蓬頭往右下一束細線，一段一段往前流；拍點上水柱變強。 */
  private drawSpray(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const k = 0.6 + 0.4 * beatKick(au, t, 0.3);
    const p = this.shower, to = { x: PP_X - 40, y: TUB.rim - 60 };
    c.save();
    c.strokeStyle = mixRgba('denim', 'bone', 0.4, 0.55 * k);
    c.lineWidth = 2;
    c.setLineDash([14, 10]);
    c.lineDashOffset = -t * 260;
    c.beginPath();
    for (let i = 0; i < 7; i++) {
      const sp = (i - 3) * 16;
      const mid = { x: lerp(p.x, to.x, 0.5), y: lerp(p.y, to.y, 0.5) - 30 };
      c.moveTo(p.x, p.y); c.quadraticCurveTo(mid.x, mid.y + sp * 0.5, to.x + sp * 1.5, to.y + sp);
    }
    c.stroke();
    c.restore();
  }

  /**
   * 泡泡字：每個字（英文每個單字）一個泡泡，從浴缸冒出來（晃著往上飄），落在拍點上停在自己的位置（稍微彈一下），之後輕輕浮動；
   * 字排完署名淡入。泡泡是薄薄的圈＋一點反光，字是深墨手寫字。
   */
  private drawBubbles(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const size = n.fit.size, r = size * 0.64;
    c.save();
    c.font = font(n.family, size);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const b of this.bubs) {
      if (t < b.t0) continue;
      const u = clamp((t - b.t0) / (b.t1 - b.t0));
      const e = ease.outCubic(u);
      const wob = Math.sin(t * 2 + b.seed) * 3;
      const x = lerp(b.from.x, b.x, e) + Math.sin(u * Math.PI * 3 + b.seed) * 30 * (1 - u);
      const y = lerp(b.from.y, b.y, e) - Math.sin(u * Math.PI) * 60 + (u >= 1 ? wob : 0);
      const pop = u >= 1 ? 1 + 0.18 * Math.exp(-(t - b.t1) / 0.08) * Math.sin(Math.min(1, (t - b.t1) / 0.12) * Math.PI) : 0.5 + 0.5 * u;
      const rr = r * pop, rx = Math.max(rr, (b.w / 2 + size * 0.22) * pop);
      c.fillStyle = rgba('bone', 0.55);
      c.beginPath(); c.ellipse(x, y, rx, rr, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = rgba('sepia', 0.3); c.lineWidth = 1.4;
      c.stroke();
      c.strokeStyle = rgba('bone', 0.95); c.lineWidth = 2.5;
      c.beginPath(); c.ellipse(x, y, rx * 0.8, rr * 0.72, 0, Math.PI * 1.1, Math.PI * 1.45); c.stroke();
      if (b.ch === '♥') drawHeart(c, x, y, size * 0.8);
      else { c.fillStyle = rgba('sepia', this.msg ? 0.95 : 0.66); c.fillText(b.ch, x, y + size * 0.04); }
    }
    c.restore();
    if (this.msg && n.name !== null && t > this.sig.t) {
      c.save();
      c.globalAlpha = prog(t, this.sig.t, this.sig.t + 0.4);
      c.font = font(n.family, this.sig.size);
      c.textAlign = 'right';
      c.fillStyle = rgba('sepia', 0.75);
      c.fillText(signature(n.name), this.sig.x, this.sig.y);
      c.restore();
    }
  }
}

/** 圓角矩形的輪廓點（給 inkPoly 描手繪線）。 */
function roundPts(x: number, y: number, w: number, h: number, r: number): Pt[] {
  const pts: Pt[] = [];
  const corner = (cx: number, cy: number, a0: number) => { for (let k = 0; k <= 4; k++) { const a = a0 + (k / 4) * (Math.PI / 2); pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }); } };
  corner(x + w - r, y + r, -Math.PI / 2); corner(x + w - r, y + h - r, 0); corner(x + r, y + h - r, Math.PI / 2); corner(x + r, y + r, Math.PI);
  return pts;
}
