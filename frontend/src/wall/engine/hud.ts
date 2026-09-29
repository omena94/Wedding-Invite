// 全域 HUD：裁切角標（只在片頭卡用），和右下角「掃描留言」的 QR code 與留言數。
//
// 照 pdoom-video 的 hud.ts（MIT，見 ./LICENSE）改寫：pdoom 右下角是 P(doom) 讀數與圖版說明，
// 大螢幕換成 QR code——賓客隨時抬頭都找得到留言的入口。版面要避開右下角 HUD_SAFE 這塊。
// HUD 大部分時間不會變：內容沒變就不重畫、不重新上傳貼圖（每次上傳要 2～4 ms）。
import { Layer2D, W, H } from './gl';
import { rgba } from './palette';
import { F, font } from './type';
import { clamp, ease, hash, lerp } from './util';
import { drawQR } from './qr';
import { drawHeart } from './motifs';
import type { AudioData } from './audio';
import type { LiveInfo, SongInfo } from './scene';

/** 右下角 HUD 佔用的範圍（邏輯像素）：版面的字請不要進到這裡。 */
export const HUD_SAFE = { x: W - 560, y: H - 250, w: 560, h: 250 };

const QR_SIZE = 176;
const MARGIN = 52;
/** 新祝福進來時，留言數的特效演多久（秒）。 */
const BUMP_DUR = 2.8;

export interface HudState {
  opacity: number;
  /** 0..1 the crop-mark frame: 1 in place, 0 flown out past the edges (see PostParams.frame). */
  frame: number;
  /** 0..1 角落 QR code。 */
  qr: number;
  /** 0..1: the plate is light (paper) — draw in ink. */
  paper: number;
  audio: AudioData;
}

export class Hud {
  layer = new Layer2D(W, H, undefined, { fast: true });
  private sig = '';
  private song: SongInfo | null = null;
  /**
   * 新祝福進來時留言數的特效（2026-09-29 新人：「數字要有特效跟動畫，讓大家都知道有多人填寫了」）。
   * 用自己累積的秒數，不用歌曲時間：換歌時歌曲時間會歸零，特效演到一半不能斷掉。
   */
  private shownN = -1;
  private bump: { from: number; rollFrom: number; to: number; age: number } | null = null;
  private lastT = NaN;
  constructor(public live: LiveInfo) {}

  setSong(s: SongInfo) { this.song = s; this.sig = ''; }

  /** 留言數變多就開始演；第一次（剛開機）與變少（刪留言）直接換，不演。 */
  private trackCount(t: number) {
    const dt = Number.isFinite(this.lastT) && t > this.lastT && t - this.lastT < 0.5 ? t - this.lastT : 1 / 60;
    this.lastT = t;
    const n = this.live.count;
    if (this.shownN < 0 || n < this.shownN) { this.shownN = n; this.bump = null; return; }
    if (n > this.shownN) {
      // 演到一半又來一則：從目前畫面上的數字接著滾，「+N」算總共新增幾則
      this.bump = { from: this.bump ? this.bump.from : this.shownN, rollFrom: this.shownN, to: n, age: 0 };
      this.shownN = n;
      return;
    }
    if (this.bump) { this.bump.age += dt; if (this.bump.age >= BUMP_DUR) this.bump = null; }
  }

  draw(t: number, st: HudState) {
    const L = this.layer;
    const qr = clamp(st.qr), frame = clamp(st.frame), op = clamp(st.opacity);
    const ink = st.paper > 0.5;
    this.trackCount(t);
    // 簽章：這些都沒變就沿用上一張貼圖（特效演出中每一格都要重畫）
    const sig = [op.toFixed(2), qr.toFixed(2), frame.toFixed(3), ink, this.live.count, this.live.url, this.live.clock ?? '', this.bump ? this.bump.age.toFixed(3) : ''].join('|');
    if (sig === this.sig) return L.texture;
    this.sig = sig;
    L.clear();
    const c = L.ctx;
    if (op <= 0.001) return L.upload();
    c.globalAlpha = op;
    if (frame > 0.001) this.cropMarks(c, frame, ink);
    if (qr > 0.001) this.qrBlock(c, qr, ink);
    void t; void this.song;
    return L.upload();
  }

  /** Corner marks; as `k` drops they fly out along the diagonals and past the edges. */
  private cropMarks(c: CanvasRenderingContext2D, k: number, ink: boolean) {
    const e = ease.inOutCubic(clamp(k));
    c.save();
    c.globalAlpha *= clamp(k * 3);
    c.strokeStyle = ink ? rgba('sepia', 0.5) : rgba('bone', 0.34);
    c.lineWidth = 1.25;
    const m = lerp(-40, 36, e), l = 22;
    c.beginPath();
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]] as const) {
      c.moveTo(x + sx * l, y + 0.5 * sy); c.lineTo(x, y + 0.5 * sy); c.lineTo(x, y + sy * l);
    }
    c.stroke();
    c.restore();
  }

  /** 右下角：QR code，左邊是小時鐘、兩行說明與留言數（留言數的數字放大，2026-09-28 新人要求）。 */
  private qrBlock(c: CanvasRenderingContext2D, k: number, ink: boolean) {
    c.save();
    c.globalAlpha *= k;
    const x = W - MARGIN - QR_SIZE, y = H - MARGIN - QR_SIZE;
    drawQR(c, this.live.url, x, y, QR_SIZE, { ink: rgba('ink'), paper: ink ? rgba('bone') : rgba('bone', 0.94) });
    c.textAlign = 'right';
    c.textBaseline = 'alphabetic';
    const tx = x - 22;
    // 小時鐘：最上面一行，「7:30」大一點、「PM」小一點（12 小時制，新人說這樣賓客才會直覺是時間）
    if (this.live.clock) {
      const [hm, ap] = this.live.clock.split(' ');
      c.fillStyle = ink ? rgba('sepia', 0.7) : rgba('bone', 0.68);
      let xx = tx;
      if (ap) {
        c.font = font(F.mono(600), 14);
        c.fillText(ap, xx, y + 18);
        xx -= c.measureText(ap).width + 6;
      }
      c.font = font(F.mono(500), 21);
      c.fillText(hm ?? '', xx, y + 18);
    }
    c.fillStyle = ink ? rgba('sepia', 0.95) : rgba('bone', 0.92);
    c.font = font(F.hei(700), 26);
    c.fillText('掃描留言給新人', tx, y + 60);
    c.font = font(F.mono(500), 17);
    c.fillStyle = ink ? rgba('sepia', 0.7) : rgba('bone', 0.62);
    c.fillText(this.live.shortUrl, tx, y + 94);
    // 留言數：「已收到」「則祝福」小字，中間的數字放大（訊號色，像儀器讀數）
    const n = this.live.count;
    const base = y + QR_SIZE - 2;
    c.fillStyle = ink ? rgba('blood', 1) : rgba('signal', 0.95);
    if (n > 0) {
      c.font = font(F.hei(500), 17);
      c.fillText('則祝福', tx, base);
      let xx = tx - c.measureText('則祝福').width - 10;
      c.font = font(F.archivo(100, 800), 46);
      const nw = c.measureText(String(n)).width;
      if (this.bump) this.bumpNumber(c, this.bump, xx, base, nw, ink);
      else c.fillText(String(n), xx, base + 2);
      xx -= nw + 10;
      c.font = font(F.hei(500), 17);
      c.fillText('已收到', xx, base);
    } else {
      c.font = font(F.hei(500), 17);
      c.fillText('第一則祝福等你來寫', tx, base);
    }
    c.restore();
  }

  /**
   * 新祝福的特效：舊數字往上滾走、新數字彈上來並放大發光，
   * 身後泛一圈光、兩圈波紋往外擴，一把小愛心往左上噴，左邊浮起「+1」（一次來好幾則就是「+3」）。
   * 全部留在右下角 HUD 那一塊（版面本來就不在這裡放東西），遠遠的賓客也看得到有人剛寫了祝福。
   * 進來時 c 的字型、顏色、靠右對齊都已經設好；(xr, base) 是數字的右下角，nw 是新數字的寬。
   */
  private bumpNumber(c: CanvasRenderingContext2D, b: { from: number; rollFrom: number; to: number; age: number }, xr: number, base: number, nw: number, ink: boolean) {
    const a = b.age;
    const glowCol = ink ? 'blood' : 'signal';
    const cx = xr - nw / 2, cy = base - 17;
    const env = Math.exp(-a * 1.3);
    c.save();
    // 身後的光：讓數字從任何版面上浮出來
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, 130);
    g.addColorStop(0, rgba(glowCol, (ink ? 0.22 : 0.34) * env));
    g.addColorStop(1, rgba(glowCol, 0));
    c.fillStyle = g;
    c.fillRect(cx - 130, cy - 130, 260, 260);
    // 兩圈波紋
    for (let i = 0; i < 2; i++) {
      const p = clamp((a - 0.12 - i * 0.2) / 0.95);
      if (p <= 0 || p >= 1) continue;
      c.strokeStyle = rgba(glowCol, 0.75 * (1 - p));
      c.lineWidth = lerp(4, 1, p);
      c.beginPath();
      c.arc(cx, cy, lerp(22, 92, ease.outCubic(p)), 0, Math.PI * 2);
      c.stroke();
    }
    // 小愛心：往左、左上噴一把，慢慢落下、淡掉（往上會蓋到說明文字，往右會撞到 QR code）
    for (let i = 0; i < 9; i++) {
      const h1 = hash(b.to, i, 1), h2 = hash(b.to, i, 2);
      const p = clamp((a - 0.15 - h1 * 0.18) / (1.35 + h2 * 0.4));
      if (p <= 0 || p >= 1) continue;
      const ang = lerp(-192, -118, (i + h1 * 0.8) / 9) * (Math.PI / 180);
      const d = lerp(14, 90 + h2 * 100, ease.outCubic(p));
      const x = cx + Math.cos(ang) * d, y = cy + Math.sin(ang) * d + 34 * p * p;
      c.globalAlpha = (1 - clamp((p - 0.55) / 0.45)) * clamp(p * 8);
      drawHeart(c, x, y, (11 + h2 * 9) * Math.min(1, p * 5));
    }
    c.globalAlpha = 1;
    c.restore();

    // 數字：舊的往上滾走，新的從下面帶一點回彈滾上來；落定時放大到 1.5 倍再彈回
    c.save();
    const r = clamp((a - 0.05) / 0.5);
    const ROLL = 46;
    const pop = a < 0.32 ? ease.outCubic(a / 0.32) : Math.exp(-(a - 0.32) * 2.4) * Math.cos((a - 0.32) * 7.5);
    const s = Math.max(0.92, 1 + 0.5 * pop);
    c.shadowColor = rgba(glowCol, ink ? 0.6 : 0.95);
    c.shadowBlur = 34 * env;
    if (r < 1) {
      c.save();
      c.globalAlpha *= 1 - clamp(r * 2.5);
      c.fillText(String(b.rollFrom), xr, base + 2 - ease.outCubic(r) * ROLL);
      c.restore();
    }
    c.translate(cx, cy);
    c.scale(s, s);
    c.translate(-cx, -cy);
    c.globalAlpha *= clamp(r * 2.2);
    c.fillText(String(b.to), xr, base + 2 + (1 - ease.outBack(r, 2.2)) * ROLL);
    c.restore();

    // 「+1」：浮在「已收到」左邊，往上飄、淡掉
    c.save();
    const p = clamp((a - 0.2) / 2.1);
    if (p > 0 && p < 1) {
      c.globalAlpha *= clamp(p * 10) * (1 - clamp((p - 0.6) / 0.4));
      c.textAlign = 'right';
      c.font = font(F.archivo(100, 800), 34);
      c.shadowColor = rgba(glowCol, 0.9);
      c.shadowBlur = 18;
      c.fillText(`+${b.to - b.from}`, xr - nw - 118, base - 2 - 64 * ease.outCubic(p));
    }
    c.restore();
  }
}
