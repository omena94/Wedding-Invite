// 營火（暗）：夜裡的空地，右半邊一堆營火，前景橫躺一根劈開的圓木當長凳。
//  - 火（campfire-glsl.ts）：程序生成的火舌，高度跟著段落能量、大鼓竄一下、每拍輪流有一條火舌舔高；
//    第一個拍點「呼」地從小火苗竄起來，最後一拍收一點。
//  - 主打留言由火星組成：一個字就是一顆火星。第一個拍點起，每拍火堆噴出一小批「帶字」的火星，
//    沿著彎曲的路徑（往上、再往左捲）飛到半空中的位置，越飛越大，落定時是燒紅的訊號色字，約 0.8 秒冷卻成紙白。
//    依閱讀順序到位，第一個拍點後 1.5 小節內（短窗格縮短）整則落定；署名最後出現。
//  - 歌詞刻在圓木的剖面上（年輪之間）：刻槽的陰影＋本色；唱到的字像烙鐵燒紅（訊號色、會發光），上面冒一小縷火星。
//  - 一格只有一個焦點（MV 融合原則）：留言最大最亮、歌詞小一級、標籤與註腳只剩兩小行低對比的 mono；鏡頭整個窗格慢慢往火推近。
//  - 冷面註記：「＊本營火為程式模擬，會場內請勿生火。」
//  - 沒有主打留言：火星組成「今晚的營火，缺你一句祝福。」＋邀請；純音樂：圓木上刻歌名。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, layout } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp, noise1, springStep, TAU } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { Lyrics, type Line } from '../engine/lyrics';
import { lyricAt, drawLyric, layoutLyric, beatAfter, signature, type LyricStyle, type LyricLayout } from './_motifs';
import { no3, INVITE_SMALL, preloadText, fitFew } from './_t19';
import { FRAG_CAMPFIRE, FIRE, BENCH, TONGUES } from './campfire-glsl';

export const spec: PlateSpecDecl = { group: 'type', family: 'light', paper: false, energy: [0.3, 0.95], bars: [4, 8] };

/** 留言：左邊的半空（火在右邊），整個畫面最大最亮的東西。 */
const BOX = { x: 150, y: 206, w: 860, h: 540 };
/** 歌詞刻在圓木剖面上：比留言小一級（留言才是焦點），左邊留一點木頭。 */
const LYR = { x: 168, base: 938, maxW: 1080 };
const LYR_STYLE: LyricStyle = { family: F.archivo(75, 700), size: 52, minSize: 48, maxWidth: LYR.maxW, align: 'left', lineHeight: 1.12 };
/** 手寫體用粗的那一款：遠處的桌子也要一眼讀得到。 */
const MSG_FAM = F.hand(700);
const NOTE = '＊本營火為程式模擬，會場內請勿生火。';
/** 沒有主打留言時的標語：自己斷行（自動斷行會斷在「缺／你」）。 */
const NO_MSG = ['今晚的營火，', '缺你一句祝福。'];

interface Spark {
  ch: string;
  /** 落定後的位置（基線左端）與字寬。 */
  x: number; y: number; w: number;
  /** 噴出、落定的時間。 */
  tl: number; ta: number;
  /** 飛行路徑（三次貝茲，字的中心）。 */
  p: [number, number][];
  h: number;
}

const BG = () => new FSPass(FRAG_CAMPFIRE, {
  uT: { value: 0 }, uLvl: { value: 1 }, uIn: { value: 1 }, uHat: { value: 0 }, uFlick: { value: 1 }, uCool: { value: 0 },
  uTg: { value: Array.from({ length: TONGUES }, () => new THREE.Vector4()) },
});

/** 每條火舌：x 偏移、半寬、相對高度（中間最高）。 */
const TG: [number, number, number][] = [[-70, 38, 0.5], [-35, 50, 0.8], [2, 58, 1.0], [37, 50, 0.72], [71, 36, 0.46]];

export default class Campfire extends Scene {
  bg = shared('campfire.bg', BG);
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 燒紅的字（飛行中、剛落定、正在唱）另外畫一層加亮疊上去：低解析度就夠，本來就是一團光。 */
  hot = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  glow = this.track(new LineBatch(4096, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 97 + (this.msg?.id ?? 0) * 13) >>> 0;
  sparks: Spark[] = [];
  size = 60;
  fam = MSG_FAM;
  sig: { text: string; x: number; y: number; size: number; t: number; fam: string } | null = null;
  label = '';
  t0 = 0;
  /** 第一個拍點的序號（每拍輪流舔高的火舌用）。 */
  b0 = 0;
  avoid: [number, number, number, number][] = [];
  /** 刻在圓木上的歌詞：有留言時比留言小一級，沒有留言時歌詞就是焦點、大一點。 */
  lyrStyle: LyricStyle = { ...LYR_STYLE, size: this.msg ? 52 : 62 };

  override async init() {
    const { audio: au, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.t0 = beatAfter(au, s + 0.05);
    this.b0 = Math.round(au.beatAt(this.t0));
    const text = m ? m.text : NO_MSG.join('');
    const sigText = m ? signature(m.name) : INVITE_SMALL;
    this.label = `營火 CAMPFIRE${m ? '  ·  ' + no3(m.n) : ''}${m?.couple ? '  ·  FROM THE COUPLE' : ''}`;
    await preloadText(this.ctx, `${text}${sigText}${this.label}${NOTE}${song.title}${song.artist}♪—A+O${m?.couple ? 'FROM THE COUPLE' : ''}`);

    // ---- 留言排版（署名的空間先扣掉）
    const c = this.layer.ctx;
    const fit: FitResult = m
      ? fitFew(c, text, MSG_FAM, BOX.w, BOX.h - 90, { min: 48, max: 124, lineHeight: 1.3, maxLines: 6 })
      : fixedLines(c, NO_MSG, MSG_FAM, BOX.w, 64, 1.3); // 沒有留言：標語是配角，焦點是圓木上的歌詞
    this.size = fit.size;
    const top = BOX.y + fit.size;
    const glyphs: { ch: string; x: number; y: number; w: number }[] = [];
    fit.lines.forEach((ln, i) => {
      const lay = layout(ln, MSG_FAM, fit.size);
      for (const g of lay.glyphs) if (g.ch.trim()) glyphs.push({ ch: g.ch, x: BOX.x + g.x, y: top + i * fit.lineHeight, w: g.w });
    });

    // ---- 時間：整則在第一個拍點後 min(1.5 小節, 窗格的 45%) 內落定。飛行時間約是這段的一半（0.45～1.05 秒），
    // 其餘時間每拍噴一批；字多就一批好幾個（同一批裡依序錯開一點點，才像一把噴出來的，而且到位的順序＝閱讀順序）。
    const B = au.beatPeriod(this.t0);
    const bar = au.timeOfBar(Math.floor(au.barAt(this.t0)) + 1) - au.timeOfBar(Math.floor(au.barAt(this.t0)));
    const D = Math.max(0.9, Math.min(1.5 * bar, 0.45 * (e - this.t0)));
    const fl = clamp(0.5 * D, 0.45, 1.05);
    const span = Math.max(0, D - fl);
    const nb = Math.max(1, Math.floor(span / B + 1e-6) + 1);
    const n = glyphs.length;
    const per = Math.ceil(n / nb);
    const stag = Math.min(0.07, (B * 0.7) / Math.max(1, per));
    this.sparks = glyphs.map((g, i) => {
      const k = Math.floor(i / per), j = i % per;
      const tl = au.timeOfBeat(this.b0 + k) + j * stag;
      const h = hash(this.seed, i, 3);
      const cx = g.x + g.w / 2, cy = g.y - fit.size * 0.36;
      // 路徑：從火舌頂端噴出，往上竄到比自己那一行高一點，再沿著自己那一行從右邊滑進位置
      // （到位是閱讀順序，所以滑過的都是還空著的位置，不會穿過已經落定的字）
      const p0: [number, number] = [FIRE.x + (hash(this.seed, i, 1) - 0.5) * 80, FIRE.y - 200 - hash(this.seed, i, 2) * 70];
      const p1: [number, number] = [FIRE.x + (h - 0.4) * 200, Math.min(p0[1] - 200, cy - 70 - hash(this.seed, i, 4) * 90)];
      const p2: [number, number] = [cx + 150 + hash(this.seed, i, 5) * 220, cy - 26 - hash(this.seed, i, 6) * 50];
      return { ch: g.ch, x: g.x, y: g.y, w: g.w, tl, ta: tl + fl, p: [p0, p1, p2, [cx, cy]], h };
    });
    const last = this.sparks.length ? Math.max(...this.sparks.map((sp) => sp.ta)) : this.t0;
    const lastY = top + (fit.lines.length - 1) * fit.lineHeight;
    if (m) {
      const size = Math.max(44, Math.round(fit.size * 0.52));
      c.font = font(MSG_FAM, size);
      const w = c.measureText(sigText).width;
      this.sig = { text: sigText, x: Math.max(BOX.x, Math.min(BOX.x + BOX.w - w, BOX.x + fit.width - w + 30)), y: lastY + fit.size * 0.35 + size * 1.08, size, t: last + 0.5 * B, fam: MSG_FAM };
    } else {
      this.sig = { text: sigText, x: BOX.x, y: lastY + fit.size * 0.95 + 24, size: 30, t: last + 0.5 * B, fam: F.hei(500) };
    }
    const bottom = this.sig.y + 18;
    this.avoid = [[BOX.x - 16, BOX.y - 24, Math.max(fit.width, 520) + 60, bottom - BOX.y + 40], [BENCH.x0, BENCH.top - 8, BENCH.x1 - BENCH.x0, BENCH.bottom - BENCH.top + 12]];
  }

  /** 火勢：小火苗 → 第一個拍點竄起（彈簧，衝過頭再回來）→ 跟著段落能量與大鼓；最後一拍收一點。 */
  private level(t: number, kick: number, rms: number) {
    const { audio: au } = this.ctx;
    const e = this.ctx.end, B = au.beatPeriod(t);
    const ign = springStep(t - this.t0, 1.6, 0.42);
    const base = lerp(0.24, 1, ign);
    const en = 0.74 + 0.36 * clamp(au.energyAt(t)) + 0.16 * rms;
    const exit = 1 - 0.28 * prog(t, e - B, e, ease.inOutCubic);
    return base * en * (1 + 0.24 * kick) * exit;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au, song } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const inK = prog(t, s, s + 0.35);
    const lvl = this.level(t, f.a.kick, f.a.rms);
    const flick = 0.9 + 0.07 * noise1(t * 7.3, 3) + 0.05 * noise1(t * 17.1, 5) + 0.08 * f.a.kick;

    // ---- 火舌：每條自己的高度起伏（噪聲），每拍輪流有一條舔高（拍點上快速竄起、再慢慢落下：強烈的緩動）
    const bi = Math.floor(au.beatAt(t) + 1e-4);
    const tb = au.timeOfBeat(bi);
    const lick = t >= this.t0 ? Math.exp(-(t - tb) / 0.2) * (1 - Math.exp(-(t - tb) / 0.025)) : 0;
    const tg = this.bg.u.uTg!.value as THREE.Vector4[];
    TG.forEach(([ox, w, hf], i) => {
      const who = ((bi * 3 + 1) % TONGUES + TONGUES) % TONGUES;
      const hh = 400 * hf * lvl * (0.8 + 0.28 * noise1(t * 1.9 + i * 5.3, this.seed + i)) * (1 + (i === who ? 0.42 * lick : 0));
      tg[i]!.set(ox + 6 * noise1(t * 0.9 + i * 2.1, 11), w * (0.85 + 0.2 * Math.min(1.2, lvl)), hh, i * 1.7 + (this.seed % 7));
    });
    const u = this.bg.u;
    u.uT!.value = t;
    u.uLvl!.value = lvl;
    u.uIn!.value = inK;
    u.uHat!.value = f.a.hat;
    u.uFlick!.value = flick;
    u.uCool!.value = coolness();
    this.bg.render(renderer, out);

    const L = this.layer, HL = this.hot;
    L.clear(); HL.clear();
    const c = L.ctx, hc = HL.ctx;
    this.glow.clear();
    const fade = inK * (1 - prog(t, e - 0.22, e));
    c.globalAlpha = hc.globalAlpha = fade;

    // ---- 一般的火星（一直有一點，小鼓一大把）
    this.embers(t, lvl);

    // ---- mono 註記：只剩兩小行、低對比（配角）
    c.font = font(F.mono(500), 16); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.5);
    c.textBaseline = 'alphabetic';
    c.fillText(this.label, BOX.x, 124);
    c.fillStyle = rgba('ash', 0.36);
    c.fillText(NOTE, BOX.x, 810);
    c.letterSpacing = '0px';

    // ---- 火星組成的留言
    this.drawSparks(c, hc, t);
    if (this.sig && t >= this.sig.t) {
      const a = prog(t, this.sig.t, this.sig.t + 0.45, ease.outCubic);
      c.font = font(this.sig.fam, this.sig.size);
      if (this.msg) { c.fillStyle = rgba('ash', 0.95 * a); c.fillText(this.sig.text, this.sig.x + (1 - a) * 14, this.sig.y); }
      else { c.letterSpacing = '2px'; c.fillStyle = rgba('ash', 0.9 * a); c.fillText(this.sig.text, this.sig.x, this.sig.y); c.letterSpacing = '0px'; }
    }

    // ---- 圓木上刻的字：歌詞（逐字烙上去）／純音樂時刻歌名
    const ly = lyricAt(lyrics, t);
    if (ly) this.carveLyric(c, hc, ly.line, t, ly.k);
    else if (!lyrics.has && song.title) {
      const txt = `♪ ${song.title}${song.artist ? ' — ' + song.artist : ''}`;
      c.save();
      // 純音樂：圓木上淺淺刻著歌名（配角：小一點、淡一點，焦點留給留言）
      c.font = font(LYR_STYLE.family, 36);
      c.fillStyle = rgba('ink', 0.6); c.fillText(txt, LYR.x - 1.2, LYR.base - 8 - 1.2, LYR.maxW);
      c.fillStyle = rgba('bone', 0.42); c.fillText(txt, LYR.x, LYR.base - 8, LYR.maxW);
      c.restore();
    }

    comp.draw(renderer, L.upload(), out);
    comp.draw(renderer, HL.upload(), out, { mode: 'add', tint: [1.8, 1.8, 1.8] });
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：整個窗格慢慢往火推近（inOutSine，不會在切換時突然動）
    const push = 1 + 0.035 * (0.5 - 0.5 * Math.cos(Math.PI * f.p));
    return { bloom: 0.9, bloomRadius: 0.8, halation: 0.35, vignette: 0.55, zoom: push, popupAvoid: this.avoid };
  }

  /**
   * 一般的火星：出生時間固定（每秒 rate 顆、小鼓事件另外一把），速度用 hash，位置是時間的純函數（確定性）。
   * 往上竄、被正弦擾動、慢慢冷卻變暗；畫成短短的拖尾。
   */
  private embers(t: number, lvl: number) {
    const au = this.ctx.audio, lb = this.glow, seed = this.seed;
    const s = LIN.signal, em = LIN.ember, bl = LIN.blood;
    const draw = (n: number, tb: number, k0: number, burst: number) => {
      const age = t - tb;
      const h = (j: number) => hash(n, seed + j, k0);
      const life = (1.3 + 1.5 * h(1)) * (burst ? 0.8 : 1);
      if (age < 0 || age > life) return;
      const x0 = FIRE.x + (h(2) - 0.5) * (burst ? 120 : 170), y0 = FIRE.y - 30 - h(3) * (burst ? 160 : 110);
      const vy = -(80 + 170 * h(4)) * (burst ? 1.6 + h(9) : 1) * (0.7 + 0.3 * Math.min(1.3, lvl));
      const vx = (h(5) - 0.5) * (burst ? 150 : 40);
      const ph = h(6) * TAU, amp = 14 + 24 * h(7);
      const pos = (a: number) => ({
        x: x0 + vx * a * (1 - 0.25 * a) - 10 * a * a + amp * Math.sin(a * (2 + h(8) * 2) + ph) * Math.min(1, a),
        y: y0 + vy * a * (1 - 0.16 * a),
      });
      const q = pos(age), q0 = pos(Math.max(0, age - 0.04));
      const k = 1 - age / life;
      const heat = k * k;
      const fl = 0.75 + 0.25 * Math.sin(tb * 91 + age * 23);
      const I = (0.8 + 2.6 * heat) * fl;
      const col: [number, number, number] = [
        (bl[0] + (s[0] - bl[0]) * k + (em[0] - s[0]) * heat) * I,
        (bl[1] + (s[1] - bl[1]) * k + (em[1] - s[1]) * heat) * I,
        (bl[2] + (s[2] - bl[2]) * k + (em[2] - s[2]) * heat) * I,
      ];
      lb.seg2(q0.x, q0.y, q.x, q.y, 1.4 + 1.1 * heat, col, Math.min(1, k * 1.6));
    };
    // 平常：每秒 26 顆（點火前很少）
    const rate = 26, lifeMax = 2.8;
    for (let n = Math.floor((t - lifeMax) * rate); n <= Math.floor(t * rate); n++) {
      const tb = n / rate;
      if (tb > t) continue;
      if (tb < this.t0 && hash(n, seed, 77) > 0.3) continue;
      draw(n, tb, 0, 0);
    }
    // 小鼓：一大把往上噴（跟著鼓的力道）；點火那一拍也噴一把
    const ev = au.events('snare', t - 2.4, t + 1e-4).filter((x) => x[0] >= this.t0 - 0.05);
    if (t >= this.t0) ev.push([this.t0, 1]);
    for (const [te, st] of ev) {
      const cnt = Math.round(10 + 22 * st);
      for (let j = 0; j < cnt; j++) draw(j + Math.round(te * 1000) * 64, te + j * 0.004, 1, 1);
    }
  }

  /** 帶字的火星：飛行中是一顆發光的火星＋拖尾，字跟著長大；落定後冷卻成紙白。 */
  private drawSparks(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number) {
    const size = this.size;
    c.font = hc.font = font(this.fam, size);
    c.textBaseline = hc.textBaseline = 'alphabetic';
    const s = LIN.signal, em = LIN.ember;
    for (const sp of this.sparks) {
      if (t < sp.tl) continue;
      const heart = sp.ch === '♥';
      if (t < sp.ta) {
        const tau = (t - sp.tl) / (sp.ta - sp.tl);
        const uu = ease.outCubic(tau);
        const [x, y] = bez(sp.p, uu);
        const sc = lerp(0.3, 1, ease.inOutCubic(tau));
        const rot = (1 - tau) * Math.sin(tau * 9 + sp.h * 6) * 0.7;
        // 拖尾：沿著路徑往回幾段，越遠越暗
        let px = x, py = y;
        for (let k = 1; k <= 7; k++) {
          const u2 = ease.outCubic(Math.max(0, tau - k * 0.025));
          const [qx, qy] = bez(sp.p, u2);
          const a = (1 - k / 8) * 0.9;
          this.glow.seg2(px, py, qx, qy, 2.2 - k * 0.2, [s[0] * 2.4 * a, s[1] * 2.4 * a, s[2] * 2.4 * a], a);
          px = qx; py = qy;
        }
        this.glow.seg2(x, y, x + 0.01, y, 7, [em[0] * 3.2, em[1] * 3.2, em[2] * 3.2], 0.9);
        for (const ctx of [c, hc]) {
          ctx.save();
          ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sc, sc);
          ctx.fillStyle = ctx === hc ? rgba('signal', 0.9) : heart ? rgba('rose', 0.95) : mixRgba('signal', 'ember', 0.5, lerp(0.55, 1, tau));
          ctx.fillText(sp.ch, -sp.w / 2, size * 0.36);
          ctx.restore();
        }
        continue;
      }
      // 落定：燒紅 → 約 0.8 秒冷卻成紙白（愛心冷卻成點綴色）
      const heat = 1 - clamp((t - sp.ta) / 0.8);
      const land = Math.exp(-(t - sp.ta) / 0.08);
      const col = heart ? rgba('rose', 0.96) : heat > 0.02 ? mixRgba('bone', 'signal', heat * 0.9, 0.96) : rgba('bone', 0.96);
      c.fillStyle = col;
      c.fillText(sp.ch, sp.x, sp.y);
      if (heat > 0.03 && !heart) { hc.fillStyle = rgba('signal', heat * heat); hc.fillText(sp.ch, sp.x, sp.y); }
      if (land > 0.05) {
        const cx = sp.x + sp.w / 2, cy = sp.y - size * 0.36;
        this.glow.seg2(cx, cy, cx + 0.01, cy, size * 0.5 * land + 4, [em[0] * 1.2 * land, em[1] * 1.2 * land, em[2] * 1.2 * land], land * 0.6);
      }
    }
  }

  /** 刻在圓木剖面上的一行歌詞：刻槽的陰影（往左上錯開）＋本色；唱到的字燒紅、冒一小縷火星。 */
  private carveLyric(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, line: Line, t: number, k: number) {
    const S = this.lyrStyle;
    const lay = layoutLyric(c, line, S);
    const y = LYR.base - (lay.rows.length - 1) * lay.size * (S.lineHeight ?? 1.18) * 0.62;
    const groove = rgba('ink', 0.85);
    c.save();
    c.translate(LYR.x - 1.6, y - 1.6);
    drawLyric(c, line, t, { ...S, active: groove, sung: groove, unsung: rgba('ink', 0.5) }, lay, k);
    c.restore();
    c.save();
    c.translate(LYR.x, y);
    drawLyric(c, line, t, { ...S, active: rgba('signal'), sung: rgba('bone', 0.94), unsung: rgba('bone', 0.3) }, lay, k);
    c.restore();
    hc.save();
    hc.translate(LYR.x, y);
    drawLyric(hc, line, t, { ...S, active: rgba('signal', 0.85), sung: 'rgba(0,0,0,0)', unsung: 'rgba(0,0,0,0)' }, lay, k);
    hc.restore();
    // 燒紅的字上方冒一小縷火星（出生時間固定，位置是那一刻正在唱的字的上緣）
    const rate = 30, life = 0.55;
    for (let n = Math.floor((t - life) * rate); n <= Math.floor(t * rate); n++) {
      const tb = n / rate;
      if (tb > t) continue;
      const hp = headAt(lay, tb);
      if (!hp) continue;
      const age = t - tb;
      const hx = LYR.x + hp.x + (hash(n, 5) - 0.5) * 14, hy = y + hp.y - lay.size * 0.8;
      const vy = -(70 + 90 * hash(n, 6)), vx = (hash(n, 7) - 0.5) * 50;
      const q = { x: hx + vx * age + 8 * Math.sin(age * 9 + n), y: hy + vy * age };
      const q0 = { x: hx + vx * Math.max(0, age - 0.035), y: hy + vy * Math.max(0, age - 0.035) };
      const kk = 1 - age / life;
      const s = LIN.signal;
      this.glow.seg2(q0.x, q0.y, q.x, q.y, 1.3, [s[0] * 2.6 * kk, s[1] * 2.6 * kk, s[2] * 2.6 * kk], kk * k);
    }
  }
}

/** 三次貝茲（字的飛行路徑）。 */
function bez(p: [number, number][], u: number): [number, number] {
  const a = 1 - u;
  const w0 = a * a * a, w1 = 3 * a * a * u, w2 = 3 * a * u * u, w3 = u * u * u;
  return [w0 * p[0]![0] + w1 * p[1]![0] + w2 * p[2]![0] + w3 * p[3]![0], w0 * p[0]![1] + w1 * p[1]![1] + w2 * p[2]![1] + w3 * p[3]![1]];
}

/** tb 時正在唱的字的筆尖位置（相對歌詞對齊點）；沒在唱是 null。 */
function headAt(lay: LyricLayout, tb: number): { x: number; y: number } | null {
  for (const pw of lay.words) {
    const p = Lyrics.wordProgress(pw.word, tb);
    if (p > 0 && p < 1) return { x: pw.x + pw.w * p, y: pw.y };
  }
  return null;
}

/**
 * 主題的訊號色有多「不像火」：燭光金、珊瑚、玫瑰這種暖色 ≈ 0，鼠尾草（綠）、薰衣草（紫）≈ 1。
 * 火的顏色照色票走，但冷色主題要多混一點紙白，才不會燒出綠火、紫火（像鬼火）。
 */
function coolness() {
  const [r, g, b] = LIN.signal;
  const m = Math.max(r, g, b, 1e-3);
  return clamp(1 - (r - Math.max(g * 0.5, b)) / m * 1.4);
}

/** 固定斷行的幾行字：找最大的字級（≤ max）讓最長的一行放得進 maxW。 */
function fixedLines(c: CanvasRenderingContext2D, lines: string[], family: string, maxW: number, max: number, lh: number): FitResult {
  c.font = font(family, 100);
  const w = Math.max(...lines.map((l) => c.measureText(l).width));
  const size = Math.floor(Math.min(max, (100 * maxW) / w));
  c.font = font(family, size);
  const width = Math.max(...lines.map((l) => c.measureText(l).width));
  return { size, lines, lineHeight: size * lh, width, height: size * (1 + (lines.length - 1) * lh) };
}
