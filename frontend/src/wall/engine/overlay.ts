// 即時留言小卡：賓客一送出，下一拍就在畫面上隨機一個角落跳出來；之後舊留言也會隨機再冒出來。
// 跟版面裡「主打」的那則留言（導演排好、每個窗格一則）是兩件事：版面換得慢，小卡讓人馬上看到自己的留言。
//
// 樣子照 pdoom 的「標籤」語彙（shoggoth 版面左邊那些 mono 標籤）：仙女棒的火花沿著細框畫一圈，
// 框裡是手寫體（霞鶩文楷）的留言、mono 的編號、署名；離場時壓成一條線再收掉。
// 畫在場景之上、後製之前（火花會發光、也吃顆粒）。一樣是 t 的純函數：排程（schedule）決定好之後，每一格照著畫。
import * as THREE from 'three';
import { Layer2D, W, H, type Compositor } from './gl';
import { LineBatch } from './lines';
import { rgba, mixRgba } from './palette';
import { F, font } from './type';
import { wrap, readSeconds } from './text';
import { clamp, ease, hash, lerp, prog } from './util';
import { sparkHead, sparkParticles, drawHeart, fillWithHearts } from './motifs';
import { HUD_SAFE } from './hud';
import type { AudioData } from './audio';
import type { LiveInfo, Msg } from './scene';

const CARD_W = 470;
const PAD = 26;
const TEXT_SIZE = 38;
const LINE_H = 1.32;

/** 小卡可以出現的位置（左上角座標；避開右下角的 QR）。 */
const SLOTS: [number, number][] = [
  [84, 76], [W - 72 - CARD_W, 76], [84, 400], [W - 72 - CARD_W, 360], [84, H - 96], [W / 2 - CARD_W / 2, 64], [W / 2 - CARD_W / 2, H - 96],
];
/** 下方的兩格要從底部往上長（高度看內容），這裡記哪幾格是「貼底」的。 */
const BOTTOM = new Set([4, 6]);

type Rect = [number, number, number, number];
/** 一張高 h 的卡放在第 i 格時實際佔的範圍（貼底的往上長；碰到右下角 QR 就往上推）。 */
function slotRect(i: number, h: number): Rect {
  const [x, sy] = SLOTS[i]!;
  let y = BOTTOM.has(i) ? sy - h : sy;
  if (x + CARD_W > HUD_SAFE.x && y + h > HUD_SAFE.y) y = HUD_SAFE.y - h - 12;
  return [x, y, CARD_W, h];
}

interface Popup {
  msg: Msg;
  t0: number;
  t1: number;
  slot: number;
  fresh: boolean;
  lines: string[];
  h: number;
}

export class Overlay {
  private layer = new Layer2D(W, H, undefined, { fast: true });
  private glow = new LineBatch(4096, { screen2D: true, blend: 'add' });
  private popups: Popup[] = [];
  private measure = document.createElement('canvas').getContext('2d')!;

  constructor(public live: LiveInfo) {}

  /** 換歌：時間歸零，舊的排程都不要了。 */
  clearSong() { this.popups = []; }

  /** 現在（或 t 時）螢幕上有沒有這則留言的小卡。 */
  showing(id: number, t: number) { return this.popups.some((p) => p.msg.id === id && t < p.t1 && t >= p.t0 - 1); }

  /** 還沒結束的小卡數。 */
  busy(t: number) { return this.popups.filter((p) => t < p.t1).length; }

  /**
   * 排一張小卡：t0 開始（呼叫的人會對齊到拍點），`fresh` = 剛送出的新留言（標「新留言」、停留久一點）。
   * 位置在空著的格子裡隨機挑（用留言 id 當種子，同一則每次重播位置一樣）。
   * `cover`：空格子都會蓋到版面的重要文字（avoid）時，要不要還是出來（挑蓋最少的）。預設不要：回傳 false，
   * 呼叫的人晚一點再試（新留言等太久才准蓋，見 main.ts）。
   */
  schedule(msg: Msg, t0: number, fresh: boolean, avoid: [number, number, number, number][] = [], cover = false): boolean {
    const dur = clamp(readSeconds(msg.text) + (fresh ? 4.5 : 2.5), fresh ? 7 : 6, fresh ? 15 : 11);
    const t1 = t0 + dur;
    this.measure.font = font(F.hand(400), TEXT_SIZE);
    const lines = wrap(this.measure, msg.text, CARD_W - PAD * 2);
    const h = PAD + 30 + lines.length * TEXT_SIZE * LINE_H + 12 + (msg.name ? 40 : 6) + PAD * 0.6;
    // 同時在畫面上的卡用「實際大小」比，不只比格子編號：四行的長卡會往下長到隔壁格子的位置
    const others = this.popups.filter((p) => p.t1 > t0 - 0.6 && p.t0 < t1 + 0.6).map((p) => ({ slot: p.slot, r: slotRect(p.slot, p.h) }));
    const hits = (a: Rect, b: Rect, gap = 12) => a[0] < b[0] + b[2] + gap && b[0] < a[0] + a[2] + gap && a[1] < b[1] + b[3] + gap && b[1] < a[1] + a[3] + gap;
    const free = SLOTS.map((_, i) => i).filter((i) => others.every((o) => o.slot !== i && !hits(slotRect(i, h), o.r)));
    if (!free.length) return false;
    // 版面說「這裡有重要的字」的地方盡量不要蓋：先挑完全不重疊的格子（多個就隨機），都會重疊就挑蓋得最少的
    const overlap = (i: number) => {
      const [sx, y0] = slotRect(i, h);
      return avoid.reduce((s, [ax, ay, aw, ah]) => s + Math.max(0, Math.min(sx + CARD_W, ax + aw) - Math.max(sx, ax)) * Math.max(0, Math.min(y0 + h, ay + ah) - Math.max(y0, ay)), 0);
    };
    const scored = free.map((i) => ({ i, o: overlap(i) }));
    const clear = scored.filter((s) => s.o === 0).map((s) => s.i);
    if (!clear.length && !cover) return false;
    const slot = clear.length ? clear[Math.floor(hash(msg.id, Math.floor(t0 * 10)) * clear.length)]! : scored.sort((a, b) => a.o - b.o)[0]!.i;
    this.popups.push({ msg, t0, t1, slot, fresh, lines, h });
    return true;
  }

  /** 留言被隱藏了：這則的小卡提早收掉。 */
  remove(id: number, t: number) {
    for (const p of this.popups) if (p.msg.id === id && p.t1 > t) p.t1 = Math.max(p.t0 + 0.05, t + 0.5);
  }

  render(renderer: THREE.WebGLRenderer, comp: Compositor, t: number, target: THREE.WebGLRenderTarget, st: { opacity: number; paper: number; audio: AudioData }) {
    this.popups = this.popups.filter((p) => p.t1 > t - 2);
    const on = this.popups.filter((p) => t >= p.t0 && t < p.t1);
    if (!on.length || st.opacity <= 0.01) return;
    const L = this.layer;
    L.clear();
    this.glow.clear();
    const c = L.ctx;
    const paper = st.paper > 0.5;
    for (const p of on) this.card(c, p, t, paper, st.opacity, st.audio);
    comp.draw(renderer, L.upload(), target);
    if (this.glow.count) this.glow.render(renderer, target);
  }

  private card(c: CanvasRenderingContext2D, p: Popup, t: number, paper: boolean, opacity: number, au: AudioData) {
    // 跟挑位置時用同一套幾何（貼底往上長、碰到右下角 QR 往上推）
    const [x, y2] = slotRect(p.slot, p.h);
    const w = CARD_W, h = p.h;
    const lt = t - p.t0, rem = p.t1 - t;
    // 進場：火花沿框跑一圈（0.7 秒），框裡的東西跟著淡入；離場：壓成一條線（0.45 秒）
    const draw = prog(lt, 0, 0.7, ease.inOutCubic);
    const fill = prog(lt, 0.25, 0.75, ease.outCubic);
    const out = 1 - prog(rem, 0, 0.45, ease.inCubic);
    const squash = lerp(1, 0.02, ease.inOutCubic(out));
    const cy = y2 + h / 2, hh = h * squash;
    const top = cy - hh / 2;
    const alpha = opacity * (1 - prog(out, 0.75, 1));
    if (alpha <= 0.001) return;
    c.save();
    c.globalAlpha = alpha;
    // 底：暗版面用半透明的墨色、亮版面用紙色，讓字在任何背景上都讀得到
    // 底色夠不透明，後面版面的大字才不會透出來跟卡片的字打架
    c.fillStyle = paper ? rgba('paper', 0.97 * fill) : rgba('ink2', 0.94 * fill);
    c.fillRect(x, top, w, hh);
    // 細框：隨進場進度畫出來
    const per = 2 * (w + hh), len = per * draw;
    const pts = [[x, top], [x + w, top], [x + w, top + hh], [x, top + hh], [x, top]] as const;
    c.strokeStyle = paper ? rgba('sepia', 0.55) : rgba('bone', 0.42);
    c.lineWidth = 1.25;
    c.beginPath();
    let acc = 0, head: { x: number; y: number } | null = null;
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1]!, [bx, by] = pts[i]!;
      const seg = Math.hypot(bx - ax, by - ay);
      if (acc + seg <= len) { c.lineTo(bx, by); acc += seg; continue; }
      const u = (len - acc) / seg;
      head = { x: lerp(ax, bx, u), y: lerp(ay, by, u) };
      c.lineTo(head.x, head.y);
      break;
    }
    c.stroke();
    // 內容（隨壓扁一起縮）
    if (squash > 0.3) {
      c.save();
      c.beginPath(); c.rect(x, top, w, hh); c.clip();
      c.translate(0, cy); c.scale(1, squash); c.translate(0, -cy);
      c.globalAlpha *= fill;
      let yy = y2 + PAD + 18;
      c.textBaseline = 'alphabetic';
      c.font = font(F.mono(500), 15);
      c.letterSpacing = '2px';
      c.fillStyle = p.fresh ? (paper ? rgba('blood') : rgba('signal')) : paper ? rgba('sepia', 0.6) : rgba('ash', 0.9);
      c.fillText(`${p.fresh ? '新留言  NEW' : '留言'}  ·  No.${String(p.msg.n).padStart(3, '0')}`, x + PAD, yy);
      c.letterSpacing = '0px';
      if (p.fresh) drawHeart(c, x + w - PAD - 10, yy - 6, 20 * (1 + 0.25 * au.hit('kick', t, 0.12)), rgba('rose'));
      yy += 20 + TEXT_SIZE;
      c.font = font(F.hand(400), TEXT_SIZE);
      c.fillStyle = paper ? rgba('sepia') : rgba('bone', 0.96);
      for (const line of p.lines) { fillWithHearts(c, line, x + PAD, yy); yy += TEXT_SIZE * LINE_H; }
      if (p.msg.name) {
        c.font = font(F.hand(400), 27);
        c.textAlign = 'right';
        c.fillStyle = paper ? mixRgba('sepia', 'paper', 0.3) : rgba('ash');
        c.fillText(`—— ${p.msg.name}`, x + w - PAD, yy - TEXT_SIZE * LINE_H + 44);
        c.textAlign = 'left';
      }
      c.restore();
    }
    c.restore();
    // 火花：進場沿框跑、離場在收起來的線中間熄掉
    if (head && lt < 0.72) {
      const hp = head;
      sparkParticles(this.glow, t, () => hp, { rate: 70, life: 0.3, speed: 170, seed: p.msg.id });
      sparkHead(this.glow, hp.x, hp.y, t, 0.8, alpha);
    }
    if (out > 0.02 && out < 0.98) {
      const hx = x + w * (0.5 + 0.5 * Math.sin(out * Math.PI)), hy = cy;
      sparkHead(this.glow, hx, hy, t, 0.6 * (1 - out), alpha);
    }
  }
}
