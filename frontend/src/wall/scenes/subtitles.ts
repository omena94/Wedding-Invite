// 老電影雙語字幕（雙語・批次 B1，暗）：坐在老戲院的中間幾排，銀幕在放一部黑白的愛情片——只有空鏡頭
// （海上的月亮、雨夜的窗、下雪的路燈、黃昏的屋頂、火車窗外的電線桿；大螢幕只有新人的紙偶版面才畫人），
// 每個小節線硬切一個鏡頭（接片跳一下），片子一秒 24 格、會晃、會閃、有刮痕和灰塵，放映光裡飄著灰塵。
//  - 兩行歌詞是銀幕下緣的雙語字幕：中文大（黑體、照歌聲逐字亮）、原文小一號在正下方（原文自己的逐字時間、比較安靜）。
//    字幕那一帶的片子壓暗（很寬的柔邊，不是字幕條）。沒有翻譯的歌只有一行中文，貼在同一條基線上，不留空位。
//  - 主打留言是「片頭的標題卡」：疊在片子左上的一段宋體字，上下兩道細的雙線、中間一顆菱形花飾，署名在最後一行下面；
//    第一個拍點切進來（老片的字卡一閃就在），整個窗格都在。標題卡後面的片子壓暗一點。
//  - 沒有留言：左上角一行小小的片頭字「ALAN & OMENA 出品」＋邀請，焦點是字幕。
//  - 拍子：小節線換鏡頭；火車的電線桿一拍經過一根、屋頂的窗在拍點一扇扇亮、雨滴在拍點開始流；大鼓時燈亮一下、小鼓時片門晃一下。
//  - 標準 v2：留言 40～60 px、標題卡的字區 ≤ 700×370（在銀幕的左上）；中文字幕 40～52、原文 32～40（_b1.ts）。
//    右下角 HUD 底下只有暗的椅背。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, hash, mulberry32 } from '../engine/util';
import { lyricAt, beatAfter, signature, COUPLE_EN, lyricSubOf, fillWithHearts, type LyricStyle } from './_motifs';
import { V2, lyricV2 } from './_v2';
import { biLayout, drawBi, fitMsgV2, type BiLay, type MsgFit } from './_b1';
import { FRAG_SUBTITLES, SCR } from './subtitles-glsl';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'screen', paper: false, energy: [0.1, 0.8], bars: [4, 8] };

/** 字幕：置中在銀幕中線，最後一排（有原文就是原文）的基線固定在這裡。 */
const SUB = { cx: (SCR.x0 + SCR.x1) / 2, bottom: 766, maxW: 1180 };
/** 標題卡（留言）：銀幕左上的一塊。 */
const TC = { cx: 700, y: 148, w: 700, h: 380 };
const MSG_FAM = F.ming(700);
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const PRESENTS = `${COUPLE_EN.toUpperCase()}  出品`;

const BG = () => new FSPass(FRAG_SUBTITLES, {
  uT: { value: 0 }, uShot: { value: 0 }, uShotT: { value: 0 }, uSeed: { value: 0 }, uBeat: { value: 0 }, uFrame: { value: 0 },
  uWeave: { value: new THREE.Vector2() }, uFlick: { value: 1 }, uSplice: { value: 0 }, uLamp: { value: 1 },
  uTxt: { value: new THREE.Vector4(0, 0, 1, 1) }, uTxtK: { value: 0 }, uSubK: { value: 0 },
});

export default class Subtitles extends Scene {
  bg = shared('subtitles.bg', BG);
  /** 每格重畫的字（字幕、小標）。 */
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 不會變的標題卡（留言）：init 畫一次，每格只貼上去（淡入用 opacity）。 */
  card = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 131 + (this.msg?.id ?? 0) * 17) >>> 0;
  /** 五個鏡頭的播放順序（每個窗格洗一次牌）。 */
  order: number[] = [0, 1, 2, 3, 4];
  fit: MsgFit | null = null;
  tCard = 0;
  /** 標題卡後面壓暗的範圍（中心、半寬高）。 */
  dim: [number, number, number, number] = [TC.cx, TC.y + TC.h / 2, 1, 1];
  msgSize: number | null = null;
  lyr: LyricStyle = { family: F.hei(700), size: V2.lyrMax, minSize: V2.lyrMin, maxWidth: SUB.maxW, align: 'center', active: rgba('signal'), sung: rgba('bone', 0.96), unsung: rgba('bone', 0.3) };
  label = '';
  score = '';
  bi = false;
  b0 = 0;

  override async init() {
    const { audio: au, lyrics, start: s, end: e, song } = this.ctx;
    const m = this.msg;
    const rnd = mulberry32(this.seed);
    for (let i = this.order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [this.order[i], this.order[j]] = [this.order[j]!, this.order[i]!]; }
    this.b0 = Math.floor(au.barAt(s) + 1e-4);
    this.bi = lyrics.linesIn(s, e).some((l) => !!lyricSubOf(l));
    const reel = 1 + (this.seed % 7);
    const sung = lyrics.linesIn(s, e).length > 0;
    this.label = `REEL ${reel}  ·  1.85 : 1  ·  ${!sung ? '無對白' : this.bi ? '中文／原文字幕' : '中文字幕'}${m ? '  ·  No.' + String(m.n).padStart(3, '0') : ''}`;
    // 純音樂：字幕的位置放一行配樂字卡（小、淡），銀幕下緣不要空著
    this.score = !lyrics.has && song.title ? `♪  配樂：${song.title}${song.artist ? '　' + song.artist : ''}` : '';
    const sigText = m ? signature(m.name) : '';
    await loadText(`${m?.text ?? ''}${sigText}${this.label}${this.score}${INVITE}${PRESENTS}片頭字卡FROM THE COUPLE·新人◆`);
    this.tCard = beatAfter(au, s + 0.05);
    if (m) {
      const c = this.card.ctx;
      this.fit = fitMsgV2(c, m.text, MSG_FAM, TC.w, TC.h - 120, { lineHeight: 1.36 });
      this.msgSize = this.fit.fit.size;
      this.drawCard(m, sigText);
    }
    this.lyr = { ...this.lyr, size: lyricV2(this.msgSize) };
  }

  /** 標題卡：上下兩道雙線（中間一顆菱形）、置中的宋體留言、最後一行下面的署名。 */
  private drawCard(m: Msg, sigText: string) {
    const L = this.card, c = L.ctx, mf = this.fit!, fit = mf.fit;
    L.clear();
    const blockH = mf.height;
    const top = TC.y + 60 + Math.max(0, (TC.h - 120 - blockH) / 2);
    const cx = TC.cx;
    const ruleW = Math.min(TC.w, Math.max(fit.width, 360) + 90);
    const rule = (y: number) => {
      c.strokeStyle = rgba('bone', 0.55); c.lineWidth = 1.2;
      for (const dy of [0, 5]) {
        c.beginPath(); c.moveTo(cx - ruleW / 2, y + dy); c.lineTo(cx - 14, y + dy); c.moveTo(cx + 14, y + dy); c.lineTo(cx + ruleW / 2, y + dy); c.stroke();
      }
      c.fillStyle = rgba('bone', 0.7);
      c.beginPath(); c.moveTo(cx, y - 5); c.lineTo(cx + 8, y + 2.5); c.lineTo(cx, y + 10); c.lineTo(cx - 8, y + 2.5); c.closePath(); c.fill();
    };
    rule(top - 38);
    // 小標：這是第幾則（新人的留言另外標）
    c.font = font(F.mono(500), 15); c.letterSpacing = '4px'; c.fillStyle = rgba('ash', 0.75); c.textAlign = 'center';
    c.fillText(m.couple ? 'FROM THE COUPLE  ·  新人' : `片頭字卡  ·  No.${String(m.n).padStart(3, '0')}`, cx, top - 52);
    c.letterSpacing = '0px';
    c.textAlign = 'left';
    // 留言：一行一行置中（愛心用我們自己畫的那顆：fillWithHearts 從左邊畫，所以先量寬度算左緣）
    c.font = font(MSG_FAM, fit.size); c.fillStyle = rgba('bone', 0.96); c.textBaseline = 'alphabetic';
    const y0 = top + fit.size * 0.92;
    fit.lines.forEach((ln, i) => fillWithHearts(c, ln, cx - c.measureText(ln).width / 2, y0 + i * fit.lineHeight));
    // 署名：最後一行下面、置中
    const ySig = y0 + (fit.lines.length - 1) * fit.lineHeight + mf.sigDy;
    c.font = font(F.ming(400), mf.sig); c.fillStyle = rgba('bone', 0.72);
    c.fillText(sigText, cx - c.measureText(sigText).width / 2, ySig);
    rule(ySig + mf.sig * 0.26 + 30);
    L.upload();
    this.dim = [cx, (top - 40 + ySig + 40) / 2, ruleW / 2 + 70, (ySig - top + 80) / 2 + 50];
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const frame = Math.floor(t * 24);
    // ---- 鏡頭：小節線換一個（窗格的第一個小節從窗格開始算）
    const bi = Math.floor(au.barAt(t) + 1e-4);
    const tb = Math.max(s, au.timeOfBar(bi));
    const shot = this.order[(((bi - this.b0) % 5) + 5) % 5]!;
    const u = this.bg.u;
    u.uT!.value = frame / 24;
    u.uShot!.value = shot;
    u.uShotT!.value = Math.floor((t - tb) * 24) / 24;
    u.uSeed!.value = hash(this.seed, bi, 3);
    u.uBeat!.value = au.beatAt(t) - au.beatAt(s);
    u.uFrame!.value = frame;
    const jolt = f.a.snare * 2.2;
    (u.uWeave!.value as THREE.Vector2).set((hash(frame, 1) - 0.5) * 1.4 + jolt * (hash(frame, 5) - 0.5), (hash(frame, 2) - 0.5) * 2 + jolt);
    // 燈：進場一閃一閃地亮起來，之後每格一點點閃爍，大鼓時亮一下；最後一拍燈慢慢暗一點（片子放完）
    const lampIn = prog(t, s, s + 0.45) * (t < s + 0.45 ? 0.6 + 0.4 * hash(frame, 9) : 1);
    const lastBeat = au.timeOfBeat(Math.floor(au.beatAt(e - 0.05)));
    u.uLamp!.value = lampIn * (1 - 0.3 * prog(t, lastBeat, e, ease.inCubic));
    u.uFlick!.value = 0.965 + 0.05 * hash(frame, 7) + 0.05 * f.a.kick;
    u.uSplice!.value = tb > s + 0.05 ? 1 - prog(t, tb, tb + 3 / 24) : 0;
    const cardK = this.msg ? prog(t, this.tCard, this.tCard + 0.25) : prog(t, s + 0.4, s + 1.2);
    (u.uTxt!.value as THREE.Vector4).set(...this.dim);
    u.uTxtK!.value = this.msg ? cardK : 0;
    const ly = lyricAt(lyrics, t);
    u.uSubK!.value = clamp((ly?.k ?? 0) * 1.5);
    this.bg.render(renderer, out);

    // ---- 標題卡（留言）：第一個拍點切進來，頭幾格跟著放映機閃
    const wv = u.uWeave!.value as THREE.Vector2;
    if (this.msg && cardK > 0) comp.draw(renderer, this.card.texture, out, { opacity: cardK * (t < this.tCard + 0.3 ? 0.8 + 0.2 * hash(frame, 11) : 1) * u.uLamp!.value, offset: [-wv.x / W, wv.y / H] });

    const L = this.layer; L.clear();
    const c = L.ctx;
    c.globalAlpha = prog(t, s, s + 0.4);
    // 小標：銀幕左下、前排椅背上面（配角：小、淡）
    c.font = font(F.mono(500), 15); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.45);
    c.fillText(this.label, SCR.x0 + 4, 842);
    c.letterSpacing = '0px';
    // 沒有留言：左上角一行片頭字＋邀請
    if (!this.msg) {
      c.save();
      c.globalAlpha *= cardK * 0.9;
      c.font = font(F.serif(600), 28); c.letterSpacing = '8px'; c.fillStyle = rgba('bone', 0.8);
      c.fillText(PRESENTS, SCR.x0 + 80, 170);
      c.font = font(F.hei(500), 24); c.letterSpacing = '2px'; c.fillStyle = rgba('bone', 0.6);
      c.fillText(INVITE, SCR.x0 + 80, 214);
      c.letterSpacing = '0px';
      c.restore();
    }
    // ---- 雙語字幕
    if (ly) {
      const bl: BiLay = biLayout(c, ly.line, this.lyr, { sub: { family: F.hei(500), sung: rgba('bone', 0.84), unsung: rgba('bone', 0.28) } });
      c.save();
      // 字幕是印在片子上的：跟著片門一起晃
      c.translate(SUB.cx + wv.x, SUB.bottom - bl.span + wv.y);
      drawBi(c, ly.line, t, this.lyr, bl, ly.k);
      c.restore();
    } else if (this.score) {
      c.save();
      c.font = font(F.hei(500), 32); c.letterSpacing = '4px'; c.fillStyle = rgba('bone', 0.55); c.textAlign = 'center';
      c.fillText(this.score, SUB.cx + wv.x, SUB.bottom + wv.y);
      c.restore();
    }
    comp.draw(renderer, L.upload(), out);
    // 鏡頭：整個窗格很慢地推近
    const push = 1 + 0.035 * (0.5 - 0.5 * Math.cos(Math.PI * f.p));
    return { bloom: 0.45, vignette: 0.6, halation: 0.15, grain: 0.07, zoom: push };
  }
}
