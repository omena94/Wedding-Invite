// 幻燈機（雙語・批次 B1，暗）：暗暗的房間，桌上一台老式的轉盤幻燈機，往牆上打出一張張幻燈片（projector-glsl.ts）。
// 每個小節線「喀」一聲換一張：舊的往下掉出片門、牆上閃一下燈泡的白光、新的一張落進來彈一下停住，
// 幻燈機上面的圓盤同時轉一格（彈一下），機身前面的張數跳一號。光束從鏡頭打出去，光裡有煙和灰塵慢慢飄；燈照拍子輕輕閃。
// 幻燈片是六張平塗的風景插畫（山、海、沙丘、森林、湖、花田），顏色從每首歌的主題混。
//  - 兩行歌詞印在幻燈片下緣的黑色字幕帶上：中文大、原文小一號在正下方，各自照逐字時間亮；
//    沒有翻譯的歌字幕帶只有一行高（帶子跟著變窄）。純音樂：字幕帶寫歌名。
//  - 主打留言寫在桌上幻燈片盒的標籤上（手寫字、署名在最後一行下面）。沒有留言：標籤寫「這一張，留給你的祝福」＋邀請。
//  - 標準 v2：留言 40～60 px、標籤 ≤ 520×400（左下）；中文 40～52、原文 32～40（_b1.ts）。右下角 HUD 底下只有暗的桌面。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba, LIN } from '../engine/palette';
import { clamp, ease, prog, hash, TAU } from '../engine/util';
import { lyricAt, signature, fillWithHearts, type LyricStyle } from './_motifs';
import { V2, lyricV2 } from './_v2';
import { biLayout, drawBi, fitMsgV2, type MsgFit } from './_b1';
import { FRAG_PROJECTOR, IMG, LENS, TABLE_Y } from './projector-glsl';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'screen', paper: false, energy: [0.1, 0.75], bars: [4, 8] };

/** 幻燈片盒（正面）與標籤。 */
const BOX = { x: 86, y: 560, w: 560, h: 434 };
const LABEL = { x: 112, y: 586, w: 508, h: 380 };
/** 幻燈機：機身、上面的圓盤。 */
const PJ = { x0: 660, x1: 890, top: 878, bot: 968, tray: { x: 770, y: 862, rx: 118, ry: 30 } };
const MSG_FAM = F.hand(700);
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const N_SLOTS = 40;

const BG = () => new FSPass(FRAG_PROJECTOR, {
  uT: { value: 0 }, uSlide: { value: 0 }, uSeed: { value: 0 }, uDrop: { value: 0 }, uIn: { value: 1 }, uWhite: { value: 0 }, uLamp: { value: 1 }, uBand: { value: 0 },
});

export default class Projector extends Scene {
  bg = shared('projector.bg', BG);
  /** 不會變的：幻燈片盒與標籤（留言）、幻燈機的機身。init 畫一次。 */
  rig = this.track(new Layer2D(W, H, undefined, { fast: true }));
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(128, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 251 + (this.msg?.id ?? 0) * 41) >>> 0;
  fit: MsgFit | null = null;
  msgSize: number | null = null;
  band = 0;
  b0 = 0;
  title = '';
  lyr: LyricStyle = { family: F.hei(700), size: V2.lyrMax, minSize: V2.lyrMin, maxWidth: IMG.x1 - IMG.x0 - 70, align: 'center', lineHeight: 1.16, active: rgba('signal'), sung: rgba('bone', 0.96), unsung: rgba('bone', 0.3) };

  override async init() {
    const { audio: au, lyrics, start: s, end: e, song } = this.ctx;
    const m = this.msg;
    const sig = m ? signature(m.name) : '';
    this.b0 = Math.floor(au.barAt(s) + 1e-4);
    this.title = song.title ? `♪  ${song.title}${song.artist ? '　' + song.artist : ''}` : '';
    await loadText(`${m?.text ?? ''}${sig}幻燈片之夜SLIDE/第盒待補這一張，留給你的祝福。${INVITE}${this.title}FROM THE COUPLE·新人No.0123456789`);
    if (m) {
      this.fit = fitMsgV2(this.rig.ctx, m.text, MSG_FAM, LABEL.w - 60, LABEL.h - 84, { lineHeight: 1.3 });
      this.msgSize = this.fit.fit.size;
    }
    this.lyr = { ...this.lyr, size: lyricV2(this.msgSize) };
    // 字幕帶的高度：這個窗格會唱到的句子裡最高的那一句（有原文就多一排）
    const c = this.layer.ctx;
    const lines = lyrics.linesIn(s - 2, e + 2);
    let span = 0, size = this.lyr.size;
    for (const l of lines) { const bl = biLayout(c, l, this.lyr, { sub: { family: F.hei(500) } }); span = Math.max(span, bl.span); size = bl.main.size; }
    this.band = lines.length ? Math.min(230, span + size * 1.05 + 40) : lyrics.has ? 0 : 90;
    this.drawRig(m, sig);
  }

  /** 幻燈片盒（紙盒、標籤上的留言）、幻燈機的機身與鏡頭。 */
  private drawRig(m: Msg | null, sig: string) {
    const L = this.rig, c = L.ctx;
    L.clear();
    // ---- 幻燈片盒：深色的紙盒，上緣露出一排插著的幻燈片（白色的紙框）
    for (let i = 0; i < 16; i++) {
      const x = BOX.x + 30 + i * ((BOX.w - 60) / 16);
      c.fillStyle = mixRgba('bone', 'ash', 0.3 + 0.4 * hash(this.seed, i));
      c.fillRect(x, BOX.y - 30 - 10 * hash(this.seed, i, 2), 22, 40);
      c.fillStyle = rgba('ink', 0.5); c.fillRect(x + 6, BOX.y - 22 - 10 * hash(this.seed, i, 2), 10, 14);
    }
    const g = c.createLinearGradient(BOX.x, 0, BOX.x + BOX.w, 0);
    g.addColorStop(0, mixRgba('ink2', 'blood', 0.35)); g.addColorStop(1, mixRgba('ink2', 'blood', 0.18));
    c.fillStyle = g; c.fillRect(BOX.x, BOX.y, BOX.w, BOX.h);
    c.strokeStyle = rgba('bone', 0.1); c.lineWidth = 2; c.strokeRect(BOX.x, BOX.y, BOX.w, BOX.h);
    // ---- 標籤
    const mf = this.fit;
    const lh = Math.min(LABEL.h, 84 + (mf ? mf.height : 130) + 30);
    c.fillStyle = rgba('ink', 0.4); c.fillRect(LABEL.x + 6, LABEL.y + 8, LABEL.w, lh);
    const pg = c.createLinearGradient(LABEL.x, LABEL.y, LABEL.x + LABEL.w, LABEL.y + lh);
    pg.addColorStop(0, mixRgba('bone', 'ember', 0.1)); pg.addColorStop(1, mixRgba('bone', 'ash', 0.35));
    c.fillStyle = pg; c.fillRect(LABEL.x, LABEL.y, LABEL.w, lh);
    // 標籤的框線（印好的格子）
    c.strokeStyle = rgba('sepia', 0.35); c.lineWidth = 1.5; c.strokeRect(LABEL.x + 12, LABEL.y + 12, LABEL.w - 24, lh - 24);
    c.beginPath(); c.moveTo(LABEL.x + 12, LABEL.y + 60); c.lineTo(LABEL.x + LABEL.w - 12, LABEL.y + 60); c.stroke();
    c.font = font(F.mono(500), 15); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.6);
    c.fillText(m ? (m.couple ? '幻燈片  ·  FROM THE COUPLE · 新人' : `幻燈片  ·  第 ${m.n} 盒`) : '幻燈片  ·  待補', LABEL.x + 30, LABEL.y + 44);
    c.letterSpacing = '0px';
    const x = LABEL.x + 30, top = LABEL.y + 84;
    if (m && mf) {
      const fit = mf.fit;
      c.font = font(MSG_FAM, fit.size); c.fillStyle = rgba('sepia', 0.95); c.textBaseline = 'alphabetic';
      const y0 = top + fit.size * 0.88;
      fit.lines.forEach((ln, i) => fillWithHearts(c, ln, x, y0 + i * fit.lineHeight));
      c.font = font(F.hand(400), mf.sig); c.fillStyle = rgba('sepia', 0.7);
      const sw = c.measureText(sig).width;
      c.fillText(sig, Math.max(x, x + Math.max(fit.width, sw) - sw), y0 + (fit.lines.length - 1) * fit.lineHeight + mf.sigDy);
    } else {
      c.font = font(MSG_FAM, 42); c.fillStyle = rgba('sepia', 0.9);
      c.fillText('這一張，留給你的祝福。', x, top + 44);
      c.font = font(F.hei(500), 21); c.fillStyle = rgba('sepia', 0.62);
      c.fillText(INVITE, x, top + 96);
    }
    // ---- 幻燈機：機身（上面亮一點）、側面的散熱孔、鏡頭筒（斜斜地朝向牆）
    c.fillStyle = mixRgba('graphite', 'ink', 0.45);
    c.beginPath(); c.roundRect(PJ.x0, PJ.top, PJ.x1 - PJ.x0, PJ.bot - PJ.top, 10); c.fill();
    c.fillStyle = mixRgba('graphite', 'ash', 0.2);
    c.beginPath(); c.moveTo(PJ.x0 + 6, PJ.top + 2); c.lineTo(PJ.x1 - 6, PJ.top + 2); c.lineTo(PJ.x1 - 24, PJ.top - 18); c.lineTo(PJ.x0 + 24, PJ.top - 18); c.closePath(); c.fill();
    c.strokeStyle = rgba('ink', 0.7); c.lineWidth = 3;
    for (let i = 0; i < 6; i++) { const y = PJ.top + 22 + i * 10; c.beginPath(); c.moveTo(PJ.x0 + 22, y); c.lineTo(PJ.x0 + 100, y); c.stroke(); }
    // 張數的小窗（數字每格畫）
    c.fillStyle = rgba('ink', 0.85); c.fillRect(PJ.x0 + 128, PJ.top + 26, 70, 30);
    // 鏡頭筒
    c.save(); c.translate(PJ.x1 - 4, PJ.top + 18); c.rotate(-0.55);
    c.fillStyle = mixRgba('graphite', 'ink', 0.2); c.fillRect(0, -20, 52, 40);
    c.fillStyle = mixRgba('graphite', 'ash', 0.25); c.fillRect(8, -20, 6, 40); c.fillRect(24, -20, 6, 40);
    c.restore();
    // 腳
    c.fillStyle = rgba('ink', 0.9); c.fillRect(PJ.x0 + 16, PJ.bot, 26, 8); c.fillRect(PJ.x1 - 42, PJ.bot, 26, 8);
    // 電線
    c.strokeStyle = rgba('ink', 0.95); c.lineWidth = 6;
    c.beginPath(); c.moveTo(PJ.x0 + 4, PJ.bot - 20); c.bezierCurveTo(PJ.x0 - 30, PJ.bot + 10, PJ.x0 - 10, TABLE_Y + 40, PJ.x0 - 60, 1090); c.stroke();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const inK = prog(t, s, s + 0.45, ease.outCubic);
    const frame = Math.floor(t * 30);
    // ---- 換片：小節線「喀」一下
    const bi = Math.floor(au.barAt(t) + 1e-4);
    const tb = au.timeOfBar(bi);
    const q = tb > s + 0.05 ? t - tb : 99;
    const kindOf = (b: number) => Math.floor(hash(this.seed, b, 1) * 6) === Math.floor(hash(this.seed, b - 1, 1) * 6) ? (Math.floor(hash(this.seed, b, 1) * 6) + 1) % 6 : Math.floor(hash(this.seed, b, 1) * 6);
    const u = this.bg.u;
    u.uT!.value = t;
    if (q < 0.07) {
      u.uSlide!.value = kindOf(bi - 1); u.uSeed!.value = hash(this.seed, bi - 1, 2);
      u.uDrop!.value = ease.inQuad(q / 0.07); u.uIn!.value = 1;
    } else {
      u.uSlide!.value = kindOf(bi); u.uSeed!.value = hash(this.seed, bi, 2);
      u.uDrop!.value = 0; u.uIn!.value = q < 0.1 ? 0 : q < 0.34 ? ease.outBack(clamp((q - 0.1) / 0.24)) : 1;
    }
    u.uWhite!.value = q < 1 ? prog(q, 0.03, 0.07) * (1 - prog(q, 0.12, 0.26)) : 0;
    u.uLamp!.value = inK * (0.96 + 0.04 * hash(frame, 3) + 0.04 * f.a.kick);
    u.uBand!.value = this.band;
    this.bg.render(renderer, out);
    comp.draw(renderer, this.rig.texture, out, { opacity: inK });

    const L = this.layer; L.clear();
    const c = L.ctx;
    this.glow.clear();
    c.globalAlpha = inK;
    // 小標：左上一行（配角：小、淡）
    c.font = font(F.mono(500), 15); c.letterSpacing = '4px'; c.fillStyle = rgba('ash', 0.45);
    c.fillText(`幻燈片之夜  ·  SLIDE ${String(((bi - this.b0 + (this.seed % 30)) % 80) + 1).padStart(2, '0')} / 80`, 110, 110);
    c.letterSpacing = '0px';
    // ---- 圓盤：每個小節線轉一格（彈一下），插著的幻燈片一格一格
    const turn = (bi - this.b0) + (q < 1 ? ease.outBack(clamp(q / 0.28)) - 1 : 0);
    const T = PJ.tray;
    c.fillStyle = mixRgba('graphite', 'ink', 0.25);
    c.beginPath(); c.ellipse(T.x, T.y + 8, T.rx, T.ry, 0, 0, TAU); c.fill();
    c.fillStyle = mixRgba('graphite', 'ash', 0.15);
    c.beginPath(); c.ellipse(T.x, T.y, T.rx, T.ry, 0, 0, TAU); c.fill();
    for (let i = 0; i < N_SLOTS; i++) {
      const a = (i + turn) * (TAU / N_SLOTS);
      const sx = Math.cos(a), sy = Math.sin(a);
      // 後半圈（被圓盤的中心擋住）畫淡一點
      c.strokeStyle = rgba('bone', sy < 0 ? 0.18 : 0.42); c.lineWidth = 2;
      c.beginPath(); c.moveTo(T.x + sx * T.rx * 0.55, T.y + sy * T.ry * 0.55); c.lineTo(T.x + sx * T.rx * 0.95, T.y + sy * T.ry * 0.95); c.stroke();
    }
    c.fillStyle = mixRgba('graphite', 'ink', 0.4);
    c.beginPath(); c.ellipse(T.x, T.y, T.rx * 0.42, T.ry * 0.42, 0, 0, TAU); c.fill();
    // ---- 張數：機身前面的小窗
    c.font = font(F.mono(600), 18); c.fillStyle = rgba('signal', 0.9);
    c.fillText(`No.${String(((bi - this.b0 + (this.seed % 30)) % 80) + 1).padStart(2, '0')}`, PJ.x0 + 134, PJ.top + 48);
    // ---- 字幕帶上的字
    const ly = lyricAt(lyrics, t);
    const white = u.uWhite!.value as number;
    const cx = (IMG.x0 + IMG.x1) / 2, bottom = IMG.y1 - 24;
    if (ly) {
      const bl = biLayout(c, ly.line, this.lyr, { sub: { family: F.hei(500), sung: rgba('bone', 0.84), unsung: rgba('bone', 0.28) } });
      c.save();
      c.translate(cx, bottom - bl.span);
      drawBi(c, ly.line, t, this.lyr, bl, ly.k * (1 - 0.5 * white));
      c.restore();
    } else if (!lyrics.has && this.title) {
      c.font = font(F.hei(500), 34); c.letterSpacing = '4px'; c.fillStyle = rgba('bone', 0.7 * (1 - 0.5 * white)); c.textAlign = 'center';
      c.fillText(this.title, cx, bottom - 6);
      c.textAlign = 'left'; c.letterSpacing = '0px';
    }
    comp.draw(renderer, L.upload(), out);
    // 鏡頭的亮點（發光）：換片的白光時更亮
    const E = LIN.ember, k = inK * (1 + 1.5 * white);
    this.glow.seg2(LENS.x, LENS.y, LENS.x + 0.01, LENS.y, 16, [E[0] * 2.4 * k, E[1] * 2.4 * k, E[2] * 2.4 * k], 1);
    this.glow.seg2(LENS.x, LENS.y, LENS.x + 0.01, LENS.y, 60, [E[0] * 0.3 * k, E[1] * 0.3 * k, E[2] * 0.3 * k], 0.6);
    this.glow.render(renderer, out);
    return { bloom: 0.55, vignette: 0.55, halation: 0.18, zoom: 1 + 0.03 * ease.inOutQuad(f.p) };
  }
}
