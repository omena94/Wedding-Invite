// 燈塔（暗）：夜海、右邊岬角上的燈塔，光束一小節轉一圈（小節線上正對鏡頭、一大片眩光），
// 轉到左邊時由上往下掃過整片天空的霧——主打留言就藏在霧裡，光束第一次照到哪個字，那個字才浮出來，之後每掃一次亮一下。
// 歌詞是遠方的船燈：地平線下一排細線畫的小船，字像船上的燈，唱到的字是訊號色、在水面拖出一條抖動的倒影。
//  - 背景、霧、體積光束、海、岩石、燈塔全在一個 shader（lighthouse-glsl.ts）；光束照到哪裡用同一個解析公式在 CPU 上算，
//    字的浮出時間在 init 就算好（確定性、跟畫面上的光束對得起來）。
//  - 冷面註記：「燈號：每小節閃一次　能見距離：一輩子」「＊本燈塔不收過路費，只收祝福。」
//  - 沒有主打留言：霧裡浮出「今晚，燈塔只為一艘船導航」＋邀請；純音樂：船上掛歌名。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, layout } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, smoothstep } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { Lyrics, type Line } from '../engine/lyrics';
import { lyricAt, drawLyric, layoutLyric, beatAfter, signature, COUPLE_ZH, type LyricStyle, type LyricLayout } from './_motifs';
import { no3, INVITE_SMALL, preloadText, fitWithSig } from './_t19';
import { FRAG_LIGHTHOUSE, beamDir, beamAt, facing, CAM, LAMP } from './lighthouse-glsl';

export const spec: PlateSpecDecl = { group: 'type', family: 'light', paper: false, energy: [0.2, 0.8], bars: [4, 8] };

/** 霧裡的留言：左上的天空（右邊是燈塔，右上角留給即時小卡）。 */
const BOX = { x: 150, y: 196, w: 1080, h: 292 };
/** 歌詞船隊：基線在地平線下（船比燈塔近一點），右端停在岬角之前。 */
const LYR = { x: 150, base: 704, maxW: 1060 };
/** 船與船之間多拉開的水面、整行多出來的船頭與駕駛艙寬度、船頭伸出去的長度。 */
const BOAT_GAP = 80, BOAT_EXTRA = 78, BOW = 32;
const LYR_STYLE: LyricStyle = { family: F.archivo(100, 700), size: 52, minSize: 48, maxWidth: LYR.maxW, align: 'left' };
const MSG_FAM = F.ming(700);
const SIG_FAM = F.hand(400);
const NOTE = '＊本燈塔不收過路費，只收祝福。';
/** 沒有主打留言時霧裡浮出的兩行（自己斷行：自動斷行會把「導航」拆開）。 */
const NO_MSG = ['今晚，燈塔只為一艘船導航：', `「${COUPLE_ZH.replace(/\s+/g, ' ')}號」`];

/** 收尾的標點、開頭的括號（浮出時跟著旁邊的字）。 */
const CLOSE = /[，。、！？：；」』）》…,.!?:;)\]]/;
const OPEN = /[「『（《(\[]/;

interface Glyph { ch: string; x: number; y: number; w: number; tr: number }

const BG = () => new FSPass(FRAG_LIGHTHOUSE, {
  uT: { value: 0 }, uB: { value: new THREE.Vector3(-1, 0, 0) }, uPow: { value: 0 }, uGlare: { value: 0 },
  uLamp: { value: 0 }, uKick: { value: 0 }, uHat: { value: 0 }, uIn: { value: 1 },
});

export default class Lighthouse extends Scene {
  bg = shared('lighthouse.bg', BG);
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 剛浮出／被光束照到的字另外畫一層加亮疊上去（低解析度就夠，本來就是一團光）。 */
  hot = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  glow = this.track(new LineBatch(3000, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 131 + (this.msg?.id ?? 0) * 7) >>> 0;
  glyphs: Glyph[] = [];
  size = 60;
  sig: { text: string; x: number; y: number; size: number; t: number; fam: string } | null = null;
  label = '';
  t0 = 0;
  avoid: [number, number, number, number][] = [];
  /** 歌詞（船燈）的字：有留言時比留言小一級，沒有留言時歌詞就是焦點、大一點。 */
  lyrStyle: LyricStyle = { ...LYR_STYLE, size: this.msg ? 52 : 60 };

  /** 小節相位（0 = 小節線）：光束的轉角。 */
  private u(t: number) { const b = this.ctx.audio.barAt(t); return b - Math.floor(b); }

  override async init() {
    const { audio: au, song } = this.ctx;
    const s = this.ctx.start, m = this.msg;
    this.t0 = beatAfter(au, s);
    const text = m ? m.text : NO_MSG.join('');
    const sigText = m ? signature(m.name) : INVITE_SMALL;
    this.label = `燈塔 LIGHTHOUSE${m ? '  ·  ' + no3(m.n) : ''}  ·  能見距離：一輩子${m?.couple ? '  ·  FROM THE COUPLE' : ''}`;
    await preloadText(this.ctx, `${text}${sigText}${this.label}${NOTE}${song.title}${song.artist}♪`);

    // ---- 留言排版：靠左、瑞士網格；署名在最後一行下面靠右
    const c = this.layer.ctx;
    // 沒有留言時霧裡的標語是配角（焦點是歌詞的船隊），字小一級
    // 有留言：字級依「框高扣掉署名那一列」找（fitWithSig），署名一定在最後一行下面、不會壓到地平線的船
    const blk = m ? fitWithSig(c, text, MSG_FAM, BOX.w, BOX.h + 96, { min: 48, max: 108, lineHeight: 1.34, maxLines: 5 }, { ratio: 0.5, min: 44, max: 56 }) : null;
    const fit = blk ? blk.fit : fixedLines(c, NO_MSG, MSG_FAM, BOX.w, 60);
    this.size = fit.size;
    const top = BOX.y + fit.size;
    this.glyphs = [];
    fit.lines.forEach((ln, i) => {
      const lay = layout(ln, MSG_FAM, fit.size);
      for (const g of lay.glyphs) this.glyphs.push({ ch: g.ch, x: BOX.x + g.x, y: top + i * fit.lineHeight, w: g.w, tr: Infinity });
    });

    // ---- 每個字浮出的時間：光束第一次照到它（同一個光束公式、逐格取樣）。
    // 窗格從小節中間開始時，光束要轉快一圈才會再掃到左邊：保底在第一個拍點後 0.4 小節，
    // 還沒浮出的字照閱讀順序很快地一個個浮出（像霧自己散開），確保一小節內整則讀得到。
    const bar = au.timeOfBar(Math.floor(au.barAt(this.t0)) + 1) - au.timeOfBar(Math.floor(au.barAt(this.t0)));
    const fb = this.t0 + 0.4 * bar;
    const tMax = fb;
    for (let t = this.t0; t <= tMax; t += 1 / 120) {
      const b = beamDir(this.u(t));
      for (const g of this.glyphs) {
        if (g.tr < Infinity) continue;
        if (beamAt(g.x + g.w / 2, g.y - this.size * 0.38, b) > 0.16) g.tr = t;
      }
    }
    const n = this.glyphs.length;
    this.glyphs.forEach((g, i) => { g.tr = Math.min(g.tr, fb + (i / Math.max(1, n)) * Math.min(0.5, 0.25 * bar)); });
    // 標點不要自己先浮出來（霧裡孤零零一個「」」看起來像壞掉）：收尾的標點跟前一個字一起、開頭的括號跟後一個字一起
    for (let i = 1; i < n; i++) if (CLOSE.test(this.glyphs[i]!.ch)) this.glyphs[i]!.tr = Math.max(this.glyphs[i]!.tr, this.glyphs[i - 1]!.tr);
    for (let i = n - 2; i >= 0; i--) if (OPEN.test(this.glyphs[i]!.ch)) this.glyphs[i]!.tr = Math.max(this.glyphs[i]!.tr, this.glyphs[i + 1]!.tr);
    const last = Math.max(...this.glyphs.map((g) => g.tr));

    const lastY = top + (fit.lines.length - 1) * fit.lineHeight;
    const maxW = fit.width;
    if (m && blk) {
      const size = blk.sigSize;
      c.font = font(SIG_FAM, size);
      const w = c.measureText(sigText).width;
      this.sig = { text: sigText, x: Math.min(BOX.x + BOX.w - w, BOX.x + Math.max(maxW, w + 120) - w), y: lastY + blk.sigDy, size, t: last + 0.3, fam: SIG_FAM };
    } else {
      this.sig = { text: sigText, x: BOX.x, y: lastY + fit.size * 1.15, size: 30, t: last + 0.3, fam: F.hei(500) };
    }
    const bottom = this.sig.y + 16;
    this.avoid = [[BOX.x - 14, BOX.y - 20, Math.max(maxW, 600) + 40, bottom - BOX.y + 30], [LYR.x - 10, LYR.base - 78, LYR.maxW + 40, 118],
      // 燈室（光束的源頭）：不是字，但被小卡蓋住整張圖就沒了重心，讓小卡先去別的格子
      [LAMP.x - 60, LAMP.y - 70, 120, 120]];
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au, song } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const B = au.beatPeriod(t);
    const inK = prog(t, s, s + 0.45);
    // 點燈（第一個拍點）與退場（最後一拍光束收掉）
    const ign = prog(t, this.t0, this.t0 + 0.14, ease.outCubic);
    const exitK = prog(t, e - B, e - 0.04, ease.inCubic);
    const pow = ign * (1 - exitK);
    const b = beamDir(this.u(t));
    const glare = smoothstep(0.93, 0.995, facing(b)) * pow;
    const lamp = (0.12 + 0.88 * ign) * (0.9 + 0.1 * f.a.kick) * (1 - 0.5 * exitK);

    const u = this.bg.u;
    u.uT!.value = t;
    (u.uB!.value as THREE.Vector3).set(b[0], b[1], b[2]);
    u.uPow!.value = pow;
    u.uGlare!.value = glare;
    u.uLamp!.value = lamp;
    u.uKick!.value = f.a.kick;
    u.uHat!.value = f.a.hat;
    u.uIn!.value = inK;
    this.bg.render(renderer, out);

    const L = this.layer, HL = this.hot;
    L.clear(); HL.clear();
    const c = L.ctx, hc = HL.ctx;
    this.glow.clear();
    const fade = inK * (1 - prog(t, e - 0.25, e));
    c.globalAlpha = hc.globalAlpha = fade;

    // ---- mono 註記
    c.font = font(F.mono(500), 16); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.5);
    c.fillText(this.label, BOX.x, 128);
    c.fillStyle = rgba('ash', 0.36);
    c.fillText(NOTE, BOX.x, 968);
    c.letterSpacing = '0px';

    // ---- 霧裡的留言
    c.font = hc.font = font(MSG_FAM, this.size);
    c.textBaseline = hc.textBaseline = 'alphabetic';
    for (const g of this.glyphs) {
      if (t < g.tr) continue;
      const a = prog(t, g.tr, g.tr + 0.4, ease.outCubic);
      const heat = 1 - prog(t, g.tr, g.tr + 0.7, ease.outQuad);
      const lit = clamp(beamAt(g.x + g.w / 2, g.y - this.size * 0.38, b) * pow * 1.4);
      const k = Math.max(heat * 0.8, lit * 0.5);
      const heart = g.ch === '♥';
      c.fillStyle = heart ? rgba('rose', 0.95 * a) : mixRgba('bone', 'ember', k, (0.9 + 0.1 * k) * a);
      const dy = (1 - a) * 8;
      c.fillText(g.ch, g.x, g.y + dy);
      const hk = Math.max(heat * heat * heat, lit * lit * 0.5);
      if (hk > 0.03 && !heart) { hc.fillStyle = rgba('signal', hk * 0.7 * a); hc.fillText(g.ch, g.x, g.y + dy); }
    }
    if (this.sig && t >= this.sig.t) {
      const a = prog(t, this.sig.t, this.sig.t + 0.5, ease.outCubic);
      c.font = font(this.sig.fam, this.sig.size);
      if (this.msg) { c.fillStyle = rgba('ash', 0.95 * a); c.fillText(this.sig.text, this.sig.x, this.sig.y); }
      else { c.letterSpacing = '2px'; c.fillStyle = rgba('ash', 0.9 * a); c.fillText(this.sig.text, this.sig.x, this.sig.y); c.letterSpacing = '0px'; }
    }

    // ---- 遠方的幾盞船燈（地平線上，一直都在；hi-hat 閃）
    for (let i = 0; i < 3; i++) {
      const x = 240 + hash(this.seed, i) * 820 - (t - s) * (4 + 3 * hash(this.seed, i, 2));
      const y = CAM.cy - 2 - hash(this.seed, i, 5) * 2;
      const fl = (0.55 + 0.45 * Math.sin(t * (1.7 + i) + i * 2)) * (1 + f.a.hat * (i === 1 ? 1.5 : 0.3)) * inK;
      const col = i === 1 ? LIN.signal : LIN.bone;
      this.glow.seg2(x, y, x + 0.01, y, 3.2, [col[0] * 1.6 * fl, col[1] * 1.6 * fl, col[2] * 1.6 * fl], 1);
      for (let k = 0; k < 4; k++) {
        const yy = CAM.cy + 5 + k * 4, hw = 3 - k * 0.5 + Math.sin(t * 3 + k + i) * 0.8;
        this.glow.seg2(x - hw, yy, x + hw, yy, 1.1, [col[0] * 0.5 * fl, col[1] * 0.5 * fl, col[2] * 0.5 * fl], 0.8 - k * 0.15);
      }
    }

    // ---- 歌詞船隊
    const ly = lyricAt(lyrics, t);
    if (ly) this.fleet(c, hc, ly.line, t, ly.k, f.a.kick, f.a.hat);
    else if (!lyrics.has && song.title) this.titleBoat(c, t, inK);

    comp.draw(renderer, L.upload(), out);
    comp.draw(renderer, HL.upload(), out, { mode: 'add', tint: [1.6, 1.6, 1.6] });
    if (this.glow.count) this.glow.render(renderer, out);

    // 鏡頭：整個窗格很慢地推近（inOutSine，切換時不會突然動）
    const push = 1 + 0.03 * (0.5 - 0.5 * Math.cos(Math.PI * f.p));
    return {
      bloom: 1.0 - 0.3 * glare, bloomRadius: 0.8, halation: 0.35 * (1 - 0.7 * glare), vignette: 0.55,
      flash: 0.02 * glare * glare, zoom: push,
      popupAvoid: this.avoid,
    };
  }

  /**
   * 一行歌詞 = 一隊小船：詞與詞之間的空白分船（最多 3 艘），船與船之間拉開一段水面，每艘各自在浪上起伏，
   * 整隊慢慢往左漂；新的一行從右邊駛入一點點。字的顏色照跟唱規則（drawLyric），唱到的字在水面拖一條倒影。
   */
  private fleet(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, line: Line, t: number, k: number, kick: number, hat: number) {
    // 船數從多往少試：字（最小 50 px）加上船距排得進一列、字又夠大就用；只剩一艘還放不下才折兩列（每列一艘）
    const S = this.lyrStyle;
    const groups = groupBoats(layoutLyric(c, line, S), 99).length;
    let st = S, lay = layoutLyric(c, line, st), boats = groupBoats(lay, 1);
    for (let nb = Math.min(3, groups); nb >= 1; nb--) {
      const s2 = { ...S, maxWidth: LYR.maxW - BOAT_EXTRA - (nb - 1) * BOAT_GAP };
      const l2 = layoutLyric(c, line, s2);
      if (nb === 1 || (l2.rows.length === 1 && l2.size >= S.size * 0.88)) { st = s2; lay = l2; boats = groupBoats(l2, nb); break; }
    }
    const size = lay.size;
    const enter = ease.outCubic(prog(t, line.start - 0.35, line.start + 0.5));
    const drift = -34 * clamp((t - line.start) / Math.max(1, line.end - line.start + 1.2));
    const ox = LYR.x + BOW + (1 - enter) * 60 + drift;
    const base = LYR.base - (lay.rows.length - 1) * size * 1.18 * 0.5;
    boats.forEach((bt, bi) => {
      const bob = Math.sin(t * 1.4 + bi * 1.9 + line.i) * 2.2 + kick * 2.5 * Math.sin(bi * 2.3 + 1);
      const sx = ox + bt.n * BOAT_GAP;
      const y0 = base + bt.y + bob, x0 = sx + bt.x0, x1 = sx + bt.x1;
      const wl = y0 + 30;
      this.hull(c, x0, x1, y0, k);
      // 航行燈：船頭訊號色、桅頂紙白（hi-hat 閃一下）
      const fl = k * (0.85 + 0.15 * Math.sin(t * 5 + bi));
      this.glow.seg2(x0 - 27, y0 + 2, x0 - 26.99, y0 + 2, 4.5, [LIN.signal[0] * 2.2 * fl, LIN.signal[1] * 2.2 * fl, LIN.signal[2] * 2.2 * fl], 1);
      const mh = fl * (1 + hat * 0.8);
      this.glow.seg2(x1 + 23, y0 - 50, x1 + 23.01, y0 - 50, 4, [LIN.bone[0] * 1.3 * mh, LIN.bone[1] * 1.3 * mh, LIN.bone[2] * 1.3 * mh], 1);
      // 這艘船上的字：用裁切把整行的跟唱只畫這一段（字距、中英混排都照整行量）
      const prev = boats[bi - 1], next = boats[bi + 1];
      const cl = prev && prev.y === bt.y ? (prev.x1 + bt.x0) / 2 : bt.x0 - size;
      const cr = next && next.y === bt.y ? (bt.x1 + next.x0) / 2 : bt.x1 + size;
      c.save();
      c.beginPath(); c.rect(sx + cl, y0 - size * 1.3, cr - cl, size * 1.7); c.clip();
      c.translate(sx, base + bob);
      drawLyric(c, line, t, st, lay, k);
      c.restore();
      // 唱到的字：發光層＋水面上一條條抖動的倒影
      for (let i = bt.i0; i <= bt.i1; i++) {
        const pw = lay.words[i]!;
        const p = Lyrics.wordProgress(pw.word, t);
        if (p <= 0) continue;
        const active = p < 1;
        if (active) {
          hc.save();
          hc.font = font(st.family, size);
          hc.fillStyle = rgba('signal', 0.7 * k);
          hc.fillText(pw.word.w, sx + pw.x, y0 + (pw.y - bt.y));
          hc.restore();
        }
        this.reflect(sx + pw.x + pw.w / 2, pw.w / 2, wl, t, i + line.i * 31, active ? LIN.signal : LIN.bone, active ? 1.7 : 0.2, k);
      }
    });
  }

  /** 水面上的倒影：幾條長短不一、左右抖動、有些斷成兩截的短橫線（碎光）。 */
  private reflect(cx: number, hw0: number, wl: number, t: number, id: number, col: [number, number, number], I: number, k: number) {
    const fr = Math.floor(t * 7);
    for (let j = 0; j < 7; j++) {
      const yy = wl + 4 + j * 6.8 + Math.sin(t * 3.1 + j) * 0.8;
      const w = hw0 * (0.95 - j * 0.11) * (0.55 + 0.45 * hash(id, j, fr));
      if (w <= 1.5) continue;
      const xx = cx + Math.sin(t * 2.6 + j * 1.7 + id * 0.9) * (2 + j * 1.6);
      const a = (1 - j / 8) * k;
      const rgb: [number, number, number] = [col[0] * I, col[1] * I, col[2] * I];
      if (hash(id, j, 7) > 0.55) {
        const g = w * (0.18 + 0.2 * hash(id, j, fr, 3));
        this.glow.seg2(xx - w, yy, xx - g, yy, 2, rgb, a);
        this.glow.seg2(xx + g, yy, xx + w, yy, 2, rgb, a);
      } else this.glow.seg2(xx - w, yy, xx + w, yy, 2, rgb, a);
    }
  }

  /** 一艘小船（細線畫、裡面填夜色擋住後面的海線）：翹起的船頭、船尾的駕駛艙（亮著一扇窗）與短桅杆。 */
  private hull(c: CanvasRenderingContext2D, x0: number, x1: number, y0: number, k: number) {
    const deck = y0 + 10, wl = y0 + 30;
    c.save();
    c.globalAlpha *= k;
    c.lineJoin = 'round';
    // 駕駛艙（在船身後面，先畫）
    c.beginPath();
    c.rect(x1 + 10, y0 - 26, 26, deck - (y0 - 26));
    c.fillStyle = rgba('ink', 0.97); c.fill();
    c.lineWidth = 1.3; c.strokeStyle = rgba('bone', 0.34); c.stroke();
    c.fillStyle = rgba('ember', 0.55);
    c.fillRect(x1 + 15, y0 - 20, 16, 10);
    c.beginPath(); c.moveTo(x1 + 7, y0 - 27); c.lineTo(x1 + 39, y0 - 27); c.moveTo(x1 + 23, y0 - 27); c.lineTo(x1 + 23, y0 - 50);
    c.lineWidth = 1.2; c.strokeStyle = rgba('bone', 0.3); c.stroke();
    // 船身
    c.beginPath();
    c.moveTo(x0 - 30, y0 + 1);
    c.quadraticCurveTo(x0 - 8, deck + 1, x0 + 26, deck);
    c.lineTo(x1 + 44, deck - 1);
    c.lineTo(x1 + 39, wl);
    c.lineTo(x0 - 4, wl);
    c.quadraticCurveTo(x0 - 20, wl - 4, x0 - 30, y0 + 1);
    c.closePath();
    c.fillStyle = rgba('ink', 0.97); c.fill();
    c.lineWidth = 1.5; c.strokeStyle = rgba('bone', 0.38); c.stroke();
    // 船身上的一條腰線
    c.beginPath(); c.moveTo(x0 - 14, wl - 8); c.lineTo(x1 + 41, wl - 8);
    c.lineWidth = 1; c.strokeStyle = rgba('bone', 0.14); c.stroke();
    c.restore();
  }

  /** 純音樂：一艘船掛著歌名（靜止的紙白）。 */
  private titleBoat(c: CanvasRenderingContext2D, t: number, inK: number) {
    const text = `♪ ${this.ctx.song.title}`;
    // 歌名是配角：小一點、淡一點（純音樂時焦點是霧裡的留言）
    const size = 38;
    c.font = font(LYR_STYLE.family, size);
    const w = Math.min(c.measureText(text).width, LYR.maxW - BOAT_EXTRA);
    const x0 = LYR.x + BOW - 12 * clamp((t - this.ctx.start) / 12), x1 = x0 + w;
    const y0 = LYR.base + Math.sin(t * 1.4) * 2;
    this.hull(c, x0, x1, y0, inK);
    c.save();
    c.globalAlpha *= inK;
    c.font = font(LYR_STYLE.family, size);
    c.fillStyle = rgba('bone', 0.45);
    c.fillText(text, x0, y0, LYR.maxW - BOAT_EXTRA);
    c.restore();
    this.glow.seg2(x1 + 23, y0 - 50, x1 + 23.01, y0 - 50, 4, [LIN.bone[0] * 1.2 * inK, LIN.bone[1] * 1.2 * inK, LIN.bone[2] * 1.2 * inK], 1);
  }
}

type Boat = { y: number; x0: number; x1: number; i0: number; i1: number; n: number };

/** 依空白把一行歌詞分成幾艘船（同一列裡），再把最窄的相鄰兩艘合併，直到最多 max 艘。n = 這艘是該列的第幾艘（船距用）。 */
function groupBoats(lay: LyricLayout, max: number): Boat[] {
  const size = lay.size;
  const boats: Boat[] = [];
  lay.words.forEach((pw, i) => {
    const prev = boats[boats.length - 1];
    if (prev && prev.y === pw.y && pw.x - prev.x1 < size * 0.12) { prev.x1 = pw.x + pw.w; prev.i1 = i; }
    else boats.push({ y: pw.y, x0: pw.x, x1: pw.x + pw.w, i0: i, i1: i, n: 0 });
  });
  while (boats.length > max) {
    let best = -1, bw = Infinity;
    for (let i = 0; i < boats.length - 1; i++) {
      if (boats[i]!.y !== boats[i + 1]!.y) continue;
      const w = boats[i + 1]!.x1 - boats[i]!.x0;
      if (w < bw) { bw = w; best = i; }
    }
    if (best < 0) break;
    const a = boats[best]!, nx = boats[best + 1]!;
    a.x1 = nx.x1; a.i1 = nx.i1;
    boats.splice(best + 1, 1);
  }
  let row = -1e9, n = 0;
  for (const b of boats) { if (b.y !== row) { row = b.y; n = 0; } b.n = n++; }
  return boats;
}

/** 固定斷行的幾行字（沒有留言時的標語）：找最大的字級讓最長的一行放得進 maxW。 */
function fixedLines(c: CanvasRenderingContext2D, lines: string[], family: string, maxW: number, max: number): FitResult {
  c.font = font(family, 100);
  const w = Math.max(...lines.map((l) => c.measureText(l).width));
  const size = Math.floor(Math.min(max, (100 * maxW) / w));
  c.font = font(family, size);
  const width = Math.max(...lines.map((l) => c.measureText(l).width));
  return { size, lines, lineHeight: size * 1.36, width, height: size * (1 + (lines.length - 1) * 1.36) };
}
