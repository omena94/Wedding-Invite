// 小館木牌菜單（亮，批次 B3・街景）：午後的小麵館，牆上掛著一塊塊木牌菜單，櫃台上一鍋湯滾著、一直冒煙，
// 門口的布簾被風吹著晃，天花板垂下來的一盞燈輕輕擺、光圈在牆上移。
//  - 兩行歌詞就是木牌：每一句是一塊新的木牌，中文大字（手寫的墨字）、下面原文小一號（像菜名底下的外文），
//    木牌是深色上漆的木頭、字是描金的（還沒唱是淡淡的底稿、唱到的字是訊號色、唱完是描金的暖白；原文唱到就轉白、淡一點）。
//    那一句要唱之前，新木牌從上面「喀」地掛到牆上的下一個掛鉤（落下、繩子一拉、左右擺幾下停住），旁邊的木牌也跟著晃一下；
//    牆上的掛鉤（兩欄，擺得下幾排就幾排）掛滿了，最舊的那一塊先被取下來再掛新的。正在唱的那一塊在燈下比較亮，其他的暗一點。
//    沒有翻譯：木牌只有一行中文（牌子矮一點，不留空行）。牌子右邊一個小價錢牌（「時價」「∞」……冷面的小字）。
//  - 主打留言寫在左下角夾板上的點菜單（手寫字，40～60 px，留言區約 540×340），署名在最後一行下面；
//    沒有留言：點菜單寫邀請。純音樂：木牌是一道道菜（每小節掛上一塊）。
//  - 湯鍋的蓋子在大鼓上跳一下、冒一口大一點的煙；每兩小節布簾被風吹起來一次。
//  - 右下角（HUD）是乾淨的木頭櫃台。
// 手法：牆（灰泥、木牆裙、燈的光圈）與櫃台是一個全螢幕 shader；木牌、湯鍋、煙、布簾、點菜單是一張每格重畫的 Canvas
//（點菜單 init() 畫好成小畫布，每格只貼上去）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp, pulse } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { drawHeart, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { V2, lyricV2 } from './_v2';
import { loadB3, layoutBi, paintBi, msgBlock, drawMsgBlock, B3_INVITE, type BiLayout, type MsgBlock, type Rect } from './_b3';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'city', paper: true, energy: [0.1, 0.75], bars: [4, 8], weight: 1 };

/** 掛鉤：兩欄三排（木牌的左上角），木牌寬。 */
const COLS = [120, 972];
const BW = 790, ROW0 = 96, ROWGAP = 16;
/** 點菜單的夾板（左下）、湯鍋（中下）、櫃台的上緣。 */
const PAD = { x: 116, y: 598, w: 600, h: 390 };
const SLIP = { x: PAD.x + 28, y: PAD.y + 56, w: PAD.w - 56, h: PAD.h - 76 };
const POT = { x: 1010, y: 968, r: 170 };
const COUNTER = 968;
/** 純音樂（沒有歌詞）時掛的菜（中文、英文、價錢）。 */
const DISHES: [string, string, string][] = [
  ['百年好合湯', 'Forever Soup', '時價'], ['甜蜜湯圓', 'Sweet Rice Balls', '∞'], ['幸福牛肉麵', 'Happy Beef Noodles', '免費'],
  ['喜宴滷味', 'Wedding Braise', '一輩子'], ['雙人份炒飯', 'Fried Rice for Two', '兩人同行'], ['白頭偕老茶', 'Lifelong Tea', '續杯'],
];
const PRICES = ['時價', '∞', '免費', '一輩子', '續杯', '招待'];

const BG = () => new FSPass(/* glsl */ `
  uniform float t; uniform vec2 lamp;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 灰泥牆：暖白、很淡的斑駁
    vec3 col = mix(C_PAPER, C_BONE, 0.35) * (0.95 + 0.04 * fbm(p / 260.0, 4) + 0.01 * snoise(p / 3.0));
    // 上面一根木樑（掛木牌的橫桿）
    if (p.y > 62.0 && p.y < 86.0) col = mix(C_PAPER, C_SEPIA, 0.52) * (0.9 + 0.08 * snoise(vec2(p.x / 90.0, p.y / 4.0)));
    // 木牆裙（直的木板）
    if (p.y > 560.0 && p.y < ${COUNTER}.0) {
      float pl = fract(p.x / 96.0);
      col = mix(C_PAPER, C_SEPIA, 0.4 + 0.05 * hash11(floor(p.x / 96.0))) * (0.94 + 0.05 * snoise(vec2(p.x / 60.0, p.y / 7.0)));
      col *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 0.02, pl));
      if (p.y < 572.0) col = mix(C_PAPER, C_SEPIA, 0.55);
    }
    // 燈：天花板垂下來的一盞燈，暖暖的光圈（跟著燈擺）；右下角暗一點點（HUD）
    float r = length((p - lamp) / vec2(760.0, 480.0));
    col *= 0.8 + 0.28 * exp(-r * r * 1.6);
    col += C_EMBER * 0.05 * exp(-r * r * 3.0);
    // 櫃台：上緣亮、正面深色的木頭
    if (p.y >= ${COUNTER}.0) {
      col = mix(C_PAPER, C_SEPIA, 0.5) * (0.92 + 0.06 * snoise(vec2(p.x / 200.0, p.y / 5.0)));
      if (p.y < ${COUNTER}.0 + 10.0) col = mix(C_PAPER, C_SEPIA, 0.35);
    }
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 }, lamp: { value: new THREE.Vector2(960, 300) } });

/** 一塊木牌：歌詞（或一道菜）、掛上去的時間、掛在哪個鉤、排好的字、牌子的高。 */
interface Board { line: Line | null; dish: [string, string, string] | null; tLand: number; slot: number; bl: BiLayout | null; h: number; price: string; seed: number; face?: HTMLCanvasElement }

export default class MenuWall extends Scene {
  bg = shared('menuwall.bg', BG);
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 29 + (this.msg?.id ?? 0) * 17) >>> 0;
  slip: HTMLCanvasElement | null = null;
  /** 一團煙（畫一次的放射漸層，每格用 drawImage 貼，不要每格建漸層）。 */
  puff: HTMLCanvasElement | null = null;
  mb: MsgBlock | null = null;
  boards: Board[] = [];
  slotH = 132;
  /** 第一排的上緣：木牌少的時候（只排得滿一兩排）整組往中間放，牆上不要上擠下空。 */
  row0 = ROW0;
  hasLyrics = false;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadB3(this.ctx, `${DISHES.flat().join('')}${PRICES.join('')}點菜單桌號品項數量備註今日推薦`);
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
    this.buildSlip();
    const size = lyricV2(this.mb ? this.mb.fit.size : null);
    const c = this.fg.ctx;
    const TW = BW - 60 - 110;
    const mk = (line: Line | null, dish: [string, string, string] | null, tLand: number, i: number): Board => {
      const bl = line ? layoutBi(c, line, { family: F.hand(700), size, minSize: V2.lyrMin, maxWidth: TW, lineHeight: 1.12, subFamily: F.hei(500) }) : null;
      const h = bl ? bl.height + 44 : 134;
      return { line, dish, tLand, slot: i % 6, bl, h, price: dish ? dish[2] : PRICES[Math.floor(hash(this.seed, i) * PRICES.length)]!, seed: hash(this.seed, i, 3) };
    };
    if (this.hasLyrics) {
      // 窗格開始前唱過的幾句已經掛在牆上（最多兩塊），之後每一句在那一句要唱之前掛上去
      const ls = lyrics.linesIn(s - 20, e).filter((l) => l.start - 0.4 < e);
      const pre = ls.filter((l) => l.start - 0.4 <= s).slice(-2);
      const post = ls.filter((l) => l.start - 0.4 > s);
      [...pre.map((l) => [l, -Infinity] as const), ...post.map((l) => [l, l.start - 0.15] as const)].forEach(([l, tl], i) => this.boards.push(mk(l, null, tl, i)));
    } else {
      const k0 = Math.floor(hash(this.seed, 5) * DISHES.length);
      this.boards.push(mk(null, DISHES[k0 % 6]!, -Infinity, 0));
      let i = 1;
      for (let b = Math.ceil(au.barAt(s + 0.3)); au.timeOfBar(b) < e - 0.3; b++, i++) this.boards.push(mk(null, DISHES[(k0 + i) % 6]!, au.timeOfBar(b), i));
    }
    // 三排的高度：取這個窗格最高的木牌（兩欄對齊）
    this.slotH = Math.max(118, ...this.boards.map((b) => b.h));
    // 牆上（木樑到木牆裙之間）擺得下幾排：雙語的木牌比較高，通常只擺得下兩排（四個鉤）
    const fit = clamp(Math.floor((556 - ROW0 + ROWGAP) / (this.slotH + ROWGAP)), 1, 3);
    this.boards.forEach((b, i) => { b.slot = i % (fit * 2); });
    const rows = Math.min(fit, Math.ceil(Math.min(fit * 2, this.boards.length) / 2));
    this.row0 = ROW0 + Math.max(0, (548 - ROW0 - rows * (this.slotH + ROWGAP) + ROWGAP) / 2);
    // 每一塊木牌的底（木頭、描金框、價錢牌、純音樂的菜名）先畫好，每格只貼上去再畫會變的歌詞
    for (const b of this.boards) b.face = this.boardFace(b);
    const pc = (this.puff = document.createElement('canvas'));
    pc.width = pc.height = 128;
    const px = pc.getContext('2d')!, pg = px.createRadialGradient(64, 64, 0, 64, 64, 64);
    pg.addColorStop(0, rgba('bone', 1)); pg.addColorStop(1, rgba('bone', 0));
    px.fillStyle = pg; px.fillRect(0, 0, 128, 128);
    this.avoid = [[PAD.x, PAD.y, PAD.w, PAD.h], [COLS[0]!, ROW0, COLS[1]! + BW - COLS[0]!, 3 * (this.slotH + ROWGAP)]];
  }

  /** 點菜單（畫一次）：夾板上一張有格子的點菜單，留言手寫在上面。 */
  private buildSlip() {
    const m = this.msg;
    const cv = document.createElement('canvas');
    cv.width = PAD.w; cv.height = PAD.h;
    const c = cv.getContext('2d')!;
    c.textBaseline = 'alphabetic';
    // 夾板（木頭）、紙、夾子
    c.fillStyle = mixRgba('sepia', 'paper', 0.45); c.beginPath(); c.roundRect(0, 0, PAD.w, PAD.h, 14); c.fill();
    const sx = SLIP.x - PAD.x, sy = SLIP.y - PAD.y;
    c.fillStyle = rgba('ink', 0.12); c.fillRect(sx + 4, sy - 12, SLIP.w, SLIP.h + 18);
    c.fillStyle = mixRgba('bone', 'paper', 0.2); c.fillRect(sx, sy - 16, SLIP.w, SLIP.h + 16);
    // 紙上的表頭與淡淡的格線
    c.font = font(F.hei(700), 18); c.letterSpacing = '6px'; c.fillStyle = rgba('blood', 0.7); c.fillText('點 菜 單', sx + 18, sy + 12); c.letterSpacing = '0px';
    c.font = font(F.hei(500), 14); c.fillStyle = rgba('sepia', 0.55); c.fillText(this.msg ? `桌號 ${String(this.msg.n % 30 + 1).padStart(2, '0')}` : '桌號 __', sx + SLIP.w - 90, sy + 10);
    c.fillStyle = rgba('blood', 0.25); c.fillRect(sx + 14, sy + 22, SLIP.w - 28, 1.5);
    c.fillStyle = rgba('blood', 0.1);
    for (let y = sy + 70; y < sy + SLIP.h - 6; y += 52) c.fillRect(sx + 14, y, SLIP.w - 28, 1.2);
    c.fillStyle = mixRgba('graphite', 'ash', 0.3);
    c.beginPath(); c.roundRect(PAD.w / 2 - 90, -6, 180, 44, 8); c.fill();
    c.fillStyle = mixRgba('ash', 'bone', 0.4); c.fillRect(PAD.w / 2 - 70, 8, 140, 10);
    if (m) {
      const mb = (this.mb = msgBlock(c, m, F.hand(700), SLIP.w - 40, SLIP.h - 44, { sigFamily: F.hand(400), lineHeight: 1.26 }));
      c.save(); c.translate(sx + 20, sy + 34 + Math.max(0, (SLIP.h - 44 - mb.h) * 0.4));
      drawMsgBlock(c, mb, { color: mixRgba('ink', 'sepia', 0.3), sigColor: rgba('blood', 0.85) });
      c.restore();
    } else {
      const [a, b] = COUPLE_ZH.split(/\s*&\s*/) as [string, string];
      c.font = font(F.hand(700), 48); c.fillStyle = mixRgba('ink', 'sepia', 0.3);
      const wa = c.measureText(a).width;
      c.fillText(a, sx + 24, sy + 100); drawHeart(c, sx + 24 + wa + 34, sy + 84, 30); c.fillText(b, sx + 24 + wa + 68, sy + 100);
      c.font = font(F.mono(500), 16); c.letterSpacing = '5px'; c.fillStyle = rgba('sepia', 0.65); c.fillText(DATE_DOTS, sx + 26, sy + 140); c.letterSpacing = '0px';
      c.font = font(F.hand(700), 30); c.fillStyle = mixRgba('ink', 'sepia', 0.35); c.fillText('今日推薦：你的一句祝福', sx + 24, sy + 214);
      c.font = font(F.hei(500), 18); c.fillStyle = rgba('sepia', 0.75); c.fillText(B3_INVITE, sx + 24, sy + 262);
    }
    this.slip = cv;
  }

  /** 一塊木牌現在的狀態：在不在牆上、往下掉／被拿走的位移、擺的角度。 */
  private boardAt(b: Board, t: number): { y: number; a: number; lit: number } | null {
    // 這個鉤之後掛上去的那一塊：它要掛之前，這一塊先被拿走（往上抽走）
    const next = this.boards.find((x) => x.slot === b.slot && x.tLand > b.tLand);
    if (next && t >= next.tLand - 0.45) return null;
    let y = 0;
    if (next && t > next.tLand - 0.75) y = -620 * ease.inCubic(clamp((t - (next.tLand - 0.75)) / 0.3));
    if (b.tLand !== -Infinity) {
      if (t < b.tLand - 0.3) return null;
      if (t < b.tLand) y = -420 * (1 - ease.inQuad(clamp((t - (b.tLand - 0.3)) / 0.3)));
    }
    // 掛上去的那一下：繩子一拉、左右擺幾下停住；同一排的鄰居也跟著晃一下
    let a = 0;
    const swing = (tl: number, amp: number) => { const d = t - tl; if (d > 0 && d < 3) a += amp * Math.exp(-d * 2.6) * Math.sin(d * 8.5); };
    if (b.tLand !== -Infinity) swing(b.tLand, 0.07 + 0.03 * b.seed);
    for (const o of this.boards) if (o !== b && o.tLand !== -Infinity && Math.floor(o.slot / 2) === Math.floor(b.slot / 2)) swing(o.tLand + 0.05, 0.018);
    // 一直有一點點風（門口吹進來）
    a += 0.004 * Math.sin(t * 1.3 + b.seed * 6);
    return { y, a, lit: 1 };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const lampX = 960 + 26 * Math.sin(t * 0.9), lampY = 300;
    this.bg.u.t!.value = t;
    (this.bg.u.lamp!.value as THREE.Vector2).set(lampX, lampY);
    this.bg.render(renderer, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    // 布簾（右上的門口）
    this.drawNoren(c, t);
    // 木牌：先畫全部的繩子（下排的繩子從上排木牌後面穿過去），再畫木牌
    const cur = lyrics.shownLine(t, 1e4, 0.35);
    const live = this.boards.map((b) => ({ b, st: this.boardAt(b, t) })).filter((x) => x.st) as { b: Board; st: { y: number; a: number; lit: number } }[];
    for (const { b, st } of live) this.drawStrings(c, b, st);
    const newest = this.boards.filter((x) => x.tLand <= t).slice(-1)[0];
    for (const { b, st } of live) this.drawBoard(c, b, st, t, this.hasLyrics ? b.line === cur : b === newest);
    // 燈（天花板垂下來、輕輕擺）
    c.strokeStyle = mixRgba('graphite', 'ink', 0.3); c.lineWidth = 2;
    c.beginPath(); c.moveTo(960, 0); c.lineTo(lampX, 26); c.stroke();
    c.fillStyle = mixRgba('sepia', 'ink2', 0.3);
    c.beginPath(); c.moveTo(lampX - 46, 56); c.lineTo(lampX + 46, 56); c.lineTo(lampX + 18, 24); c.lineTo(lampX - 18, 24); c.closePath(); c.fill();
    c.fillStyle = rgba('bone'); c.beginPath(); c.ellipse(lampX, 57, 30, 5, 0, 0, Math.PI * 2); c.fill();
    // 點菜單、湯鍋與煙
    if (this.slip) {
      c.save(); c.translate(PAD.x + PAD.w / 2, PAD.y + PAD.h / 2); c.rotate(-0.025);
      c.fillStyle = rgba('ink', 0.14); c.fillRect(-PAD.w / 2 + 8, -PAD.h / 2 + 10, PAD.w, PAD.h);
      c.drawImage(this.slip, -PAD.w / 2, -PAD.h / 2);
      c.restore();
    }
    this.drawShelf(c, t);
    this.drawPot(c, t);
    L.upload();
    comp.draw(renderer, L.texture, out);
    const land = this.boards.reduce((a, b) => Math.max(a, pulse(t, b.tLand, 0.08)), 0);
    const p = ease.inOutQuad(prog(t, s, e));
    void au;
    return {
      paper: 1, bloom: 0.2, vignette: 0.32, grain: 0.04,
      shake: [0, land * 2], zoom: 1 + 0.025 * p,
      popupAvoid: this.avoid,
    };
  }

  /** 木牌的上緣（y）與它掛的位置。 */
  private boardPos(b: Board, st: { y: number; a: number }) {
    const col = b.slot % 2, row = Math.floor(b.slot / 2);
    const x0 = COLS[col]!, y0 = this.row0 + row * (this.slotH + ROWGAP) + (this.slotH - b.h) * 0.5 + st.y;
    return { x0, y0, pivX: x0 + BW / 2, ax: Math.sin(st.a) * (y0 - 74) };
  }

  /** 兩條繩子：從木樑直直垂下來，綁在木牌上緣（木牌擺的時候下端跟著擺）。 */
  private drawStrings(c: CanvasRenderingContext2D, b: Board, st: { y: number; a: number }) {
    const { y0, pivX, ax } = this.boardPos(b, st);
    c.strokeStyle = mixRgba('sepia', 'ink', 0.3, 0.75); c.lineWidth = 2;
    for (const dx of [-BW * 0.36, BW * 0.36]) {
      const bx = pivX + ax + dx * Math.cos(st.a), by = y0 + dx * Math.sin(st.a) + 4;
      c.beginPath(); c.moveTo(pivX + dx, 80); c.lineTo(bx, by); c.stroke();
    }
  }

  /** 木牌的底（畫一次）：深色上漆的木頭（每塊顏色稍微不同，有木紋）、描金的細框、右邊的價錢牌；純音樂的菜名也畫在這裡。 */
  private boardFace(b: Board): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(BW * SCALE); cv.height = Math.ceil(b.h * SCALE);
    const c = cv.getContext('2d')!;
    c.scale(SCALE, SCALE);
    c.textBaseline = 'alphabetic';
    const wood = mixRgba('sepia', 'ink2', 0.2 + 0.2 * b.seed);
    c.fillStyle = wood; c.beginPath(); c.roundRect(0, 0, BW, b.h, 8); c.fill();
    c.save(); c.beginPath(); c.roundRect(0, 0, BW, b.h, 8); c.clip();
    c.strokeStyle = rgba('bone', 0.05); c.lineWidth = 1.5;
    for (let k = 0; k < 6; k++) {
      const yy = (b.h / 6) * (k + 0.5) + 6 * Math.sin(k * 1.7 + b.seed * 9);
      c.beginPath(); c.moveTo(0, yy); c.bezierCurveTo(BW * 0.3, yy - 8, BW * 0.6, yy + 8, BW, yy - 3); c.stroke();
    }
    // 上漆的木頭：上緣一條亮邊、描金的細框
    c.fillStyle = rgba('bone', 0.14); c.fillRect(0, 0, BW, 4);
    c.restore();
    c.strokeStyle = mixRgba('ember', 'blood', 0.5, 0.5); c.lineWidth = 2; c.beginPath(); c.roundRect(8, 8, BW - 16, b.h - 16, 5); c.stroke();
    // 價錢牌（右邊一小塊紅紙）
    c.fillStyle = mixRgba('blood', 'signal', 0.25, 0.9); c.fillRect(BW - 92, 14, 72, b.h - 28);
    c.font = font(F.hand(700), 22); c.fillStyle = rgba('bone', 0.95); c.textAlign = 'center';
    // 價錢直寫（最多四個字；字多就小一點）
    const pr = Array.from(b.price);
    const ps = pr.length <= 2 ? 26 : Math.min(24, (b.h - 36) / pr.length);
    c.font = font(F.hand(700), ps);
    pr.forEach((ch, i) => c.fillText(ch, BW - 56, b.h / 2 - ((pr.length - 1) * ps) / 2 + i * ps + ps * 0.36));
    c.textAlign = 'left';
    if (b.dish) {
      c.font = font(F.hand(700), 48); c.fillStyle = mixRgba('bone', 'ember', 0.3); c.fillText(b.dish[0], 30, 70);
      c.font = font(F.hei(500), 32); c.fillStyle = rgba('bone', 0.75); c.fillText(b.dish[1], 30, 114);
    }
    return cv;
  }

  /** 一塊木牌：貼上畫好的底，再畫會變的字（中文、下面原文，照跟唱規則）；不是正在唱的那一塊暗一點。 */
  private drawBoard(c: CanvasRenderingContext2D, b: Board, st: { y: number; a: number }, t: number, focus: boolean) {
    const { y0, pivX, ax } = this.boardPos(b, st);
    c.save();
    c.translate(pivX + ax, y0);
    c.rotate(st.a);
    c.translate(-BW / 2, 0);
    c.fillStyle = rgba('ink', 0.14); c.beginPath(); c.roundRect(8, 10, BW, b.h, 8); c.fill();
    if (b.face) c.drawImage(b.face, 0, 0, BW, b.h);
    if (b.bl) {
      c.save();
      c.translate(30, 22 + b.bl.main.size * 0.9);
      const ink = { unsung: rgba('bone', 0.2), active: mixRgba('signal', 'ember', 0.2), sung: mixRgba('bone', 'ember', 0.3) };
      paintBi(c, b.bl, t, ink);
      c.restore();
    }
    // 不是正在唱的那一塊：燈照不到，暗一點
    if (!focus) { c.fillStyle = mixRgba('paper', 'ink', 0.5, 0.42); c.beginPath(); c.roundRect(0, 0, BW, b.h, 8); c.fill(); }
    c.restore();
  }

  /** 湯鍋：大鼓時蓋子跳一下、冒一口大一點的煙；平常一直冒細細的煙。 */
  private drawPot(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const bt = au.beatAt(t), bi = Math.floor(bt);
    const kick = pulse(t, au.timeOfBeat(bi), 0.12);
    const P = POT;
    // 煙：一團團淡淡的白煙往上飄、散開（大鼓那一口大一點）
    for (let i = 0; i < 16; i++) {
      const per = 2.6 + 1.2 * hash(this.seed, i, 1);
      const ph = (t / per + hash(this.seed, i, 2)) % 1;
      const k = Math.floor(t / per + hash(this.seed, i, 2));
      const x = P.x + (hash(this.seed, i, k) - 0.5) * 120 + 70 * Math.sin(ph * 4 + i) * ph;
      const y = P.y - P.r * 1.15 - ph * 520;
      const r = 26 + ph * 90;
      const a = Math.min(1, ph * 5) * (1 - ph) * 0.34;
      if (this.puff) { c.globalAlpha = a; c.drawImage(this.puff, x - r, y - r, r * 2, r * 2); c.globalAlpha = 1; }
    }
    // 大鼓那一口
    const d = t - au.timeOfBeat(bi);
    if (d < 0.9) {
      const r = 40 + d * 160, a = 0.45 * (1 - d / 0.9), yy = P.y - P.r * 1.2 - d * 200;
      if (this.puff) { c.globalAlpha = a; c.drawImage(this.puff, P.x - r, yy - r, r * 2, r * 2); c.globalAlpha = 1; }
    }
    // 爐子（矮矮的黑鐵架）、鍋身（不鏽鋼的大湯鍋：左邊亮、右邊暗，兩道箍）、把手、蓋子（大鼓時跳一下）
    const bh = P.r * 1.0;
    c.fillStyle = rgba('ink', 0.18); c.beginPath(); c.ellipse(P.x + 20, P.y + 2, P.r * 1.2, 12, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = mixRgba('ink2', 'graphite', 0.3); c.fillRect(P.x - P.r * 0.95, P.y - 16, P.r * 1.9, 16);
    const top = P.y - 16 - bh;
    const g2 = c.createLinearGradient(P.x - P.r, 0, P.x + P.r, 0);
    g2.addColorStop(0, mixRgba('ash', 'graphite', 0.35)); g2.addColorStop(0.28, mixRgba('bone', 'ash', 0.25)); g2.addColorStop(0.42, mixRgba('ash', 'bone', 0.3)); g2.addColorStop(1, mixRgba('graphite', 'ink2', 0.45));
    c.fillStyle = g2;
    c.beginPath(); c.moveTo(P.x - P.r, top); c.lineTo(P.x + P.r, top); c.lineTo(P.x + P.r, P.y - 22); c.quadraticCurveTo(P.x, P.y - 6, P.x - P.r, P.y - 22); c.closePath(); c.fill();
    c.strokeStyle = rgba('ink', 0.18); c.lineWidth = 2;
    for (const yy of [top + 22, P.y - 46]) { c.beginPath(); c.moveTo(P.x - P.r, yy); c.quadraticCurveTo(P.x, yy + 10, P.x + P.r, yy); c.stroke(); }
    c.fillStyle = mixRgba('graphite', 'ink', 0.35);
    c.beginPath(); c.roundRect(P.x - P.r - 30, top + 30, 34, 14, 6); c.fill(); c.beginPath(); c.roundRect(P.x + P.r - 4, top + 30, 34, 14, 6); c.fill();
    const lift = 12 * kick;
    c.save(); c.translate(P.x, top - lift); c.rotate(0.035 * kick * (bi % 2 ? 1 : -1));
    const g3 = c.createLinearGradient(-P.r, 0, P.r, 0);
    g3.addColorStop(0, mixRgba('ash', 'graphite', 0.2)); g3.addColorStop(0.35, rgba('bone')); g3.addColorStop(1, mixRgba('graphite', 'ash', 0.3));
    c.fillStyle = g3; c.beginPath(); c.ellipse(0, 0, P.r + 8, 30, 0, Math.PI, Math.PI * 2); c.fill();
    c.fillStyle = mixRgba('graphite', 'ash', 0.25); c.beginPath(); c.ellipse(0, 0, P.r + 8, 5, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = mixRgba('ink2', 'graphite', 0.4); c.beginPath(); c.roundRect(-18, -44, 36, 16, 6); c.fill();
    c.restore();
    // 爐火（藍色換成訊號色的小火苗，一閃一閃）
    for (let k = 0; k < 7; k++) {
      const fx = P.x - P.r * 0.7 + k * (P.r * 1.4 / 6), fh = 10 + 6 * Math.sin(t * 13 + k * 2.1);
      c.fillStyle = mixRgba('signal', 'ember', 0.4, 0.85);
      c.beginPath(); c.moveTo(fx - 5, P.y - 16); c.quadraticCurveTo(fx, P.y - 16 - fh * 1.6, fx + 5, P.y - 16); c.fill();
    }
  }

  /**
   * 牆上的碗架（湯鍋右邊）：一排疊起來的碗、一只茶壺、一串掛著的湯勺；每個小節線最上面那只碗被震得喀一下（微微跳起）。
   * 停在 HUD 上面。
   */
  private drawShelf(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const sx = 1290, sy = 676, sw = 440;
    c.fillStyle = rgba('ink', 0.12); c.fillRect(sx + 6, sy + 8, sw, 12);
    c.fillStyle = mixRgba('sepia', 'paper', 0.3); c.fillRect(sx, sy, sw, 14);
    c.fillStyle = mixRgba('sepia', 'ink', 0.2); c.fillRect(sx + 30, sy + 14, 10, 30); c.fillRect(sx + sw - 40, sy + 14, 10, 30);
    const bar = au.barAt(t), hop = pulse(t, au.timeOfBar(Math.floor(bar + 1e-6)), 0.1);
    // 三疊碗（白瓷、口緣一條訊號色的細線）
    for (let k = 0; k < 3; k++) {
      const bx = sx + 40 + k * 110;
      for (let j = 0; j < 3 + (k % 2); j++) {
        const y = sy - 8 - j * 20 - (j === 2 + (k % 2) && k === 1 ? hop * 8 : 0);
        c.fillStyle = mixRgba('bone', 'ash', 0.1 + 0.08 * (j % 2));
        c.beginPath(); c.moveTo(bx, y - 18); c.lineTo(bx + 80, y - 18); c.quadraticCurveTo(bx + 72, y + 2, bx + 40, y + 2); c.quadraticCurveTo(bx + 8, y + 2, bx, y - 18); c.fill();
        c.fillStyle = mixRgba('signal', 'blood', 0.4, 0.7); c.fillRect(bx + 2, y - 18, 76, 2.5);
      }
    }
    // 茶壺
    const tx = sx + 372, ty = sy;
    c.fillStyle = mixRgba('blood', 'sepia', 0.4);
    c.beginPath(); c.ellipse(tx, ty - 34, 36, 32, 0, 0, Math.PI * 2); c.fill();
    c.fillRect(tx - 10, ty - 74, 20, 10);
    c.strokeStyle = mixRgba('blood', 'sepia', 0.4); c.lineWidth = 7;
    c.beginPath(); c.moveTo(tx + 32, ty - 40); c.quadraticCurveTo(tx + 58, ty - 50, tx + 62, ty - 70); c.stroke();
    c.lineWidth = 5; c.beginPath(); c.arc(tx - 40, ty - 36, 16, Math.PI * 0.6, Math.PI * 1.4); c.stroke();
    // 掛著的湯勺（在架子下面，跟著布簾那陣風一起晃一點點）
    const sw2 = 0.05 * Math.sin(t * 1.7);
    for (let k = 0; k < 3; k++) {
      c.save(); c.translate(sx + 120 + k * 60, sy + 16); c.rotate(sw2 * (1 + k * 0.3));
      c.strokeStyle = mixRgba('graphite', 'ash', 0.4); c.lineWidth = 4; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 70); c.stroke();
      c.fillStyle = mixRgba('graphite', 'ash', 0.4); c.beginPath(); c.ellipse(0, 82, 14, 12, 0, 0, Math.PI * 2); c.fill();
      c.restore();
    }
  }

  /** 右上門口的布簾：四片，被風吹著晃，每兩小節吹起來一次。 */
  private drawNoren(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const bar = au.barAt(t);
    const gust = Math.floor(bar) % 2 === 1 ? Math.sin(Math.PI * clamp((bar - Math.floor(bar)) / 0.8)) : 0;
    const x0 = 1776, w = 36, top = 86, hgt = 420;
    c.fillStyle = mixRgba('graphite', 'ink2', 0.3); c.fillRect(x0 - 12, top - 8, 4 * (w + 4) + 30, 10);
    for (let i = 0; i < 4; i++) {
      const x = x0 + i * (w + 4);
      const sw = (6 + 30 * gust) * (0.7 + 0.3 * Math.sin(t * 2 + i));
      c.fillStyle = mixRgba('blood', 'sepia', 0.3, 0.92);
      c.beginPath(); c.moveTo(x, top); c.lineTo(x + w, top);
      c.quadraticCurveTo(x + w + sw * 0.4, top + hgt * 0.6, x + w + sw, top + hgt);
      c.lineTo(x + sw, top + hgt); c.quadraticCurveTo(x + sw * 0.4, top + hgt * 0.6, x, top); c.fill();
    }
    // 布簾上的一個白色圓紋（跨在中間兩片上）
    c.strokeStyle = rgba('bone', 0.7); c.lineWidth = 4;
    c.beginPath(); c.arc(x0 + 2 * (w + 4) - 2 + 12 * gust, top + 150, 30, 0, Math.PI * 2); c.stroke();
  }

  override dispose() {
    for (const b of this.boards) if (b.face) b.face.width = b.face.height = 0;
    for (const cv of [this.slip, this.puff]) if (cv) cv.width = cv.height = 0;
    super.dispose();
  }
}
