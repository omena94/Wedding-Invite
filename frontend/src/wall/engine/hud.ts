// 全域 HUD：裁切角標（只在片頭卡用），和右下角「掃描留言」的 QR code 與留言數。
//
// 照 pdoom-video 的 hud.ts（MIT，見 ./LICENSE）改寫：pdoom 右下角是 P(doom) 讀數與圖版說明，
// 大螢幕換成 QR code——賓客隨時抬頭都找得到留言的入口。版面要避開右下角 HUD_SAFE 這塊。
// HUD 大部分時間不會變：內容沒變就不重畫、不重新上傳貼圖（每次上傳要 2～4 ms）。
import { Layer2D, W, H } from './gl';
import { rgba } from './palette';
import { F, font } from './type';
import { clamp, ease, lerp } from './util';
import { drawQR } from './qr';
import type { AudioData } from './audio';
import type { LiveInfo, SongInfo } from './scene';

/** 右下角 HUD 佔用的範圍（邏輯像素）：版面的字請不要進到這裡。 */
export const HUD_SAFE = { x: W - 560, y: H - 250, w: 560, h: 250 };

const QR_SIZE = 176;
const MARGIN = 52;

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
  constructor(public live: LiveInfo) {}

  setSong(s: SongInfo) { this.song = s; this.sig = ''; }

  draw(t: number, st: HudState) {
    const L = this.layer;
    const qr = clamp(st.qr), frame = clamp(st.frame), op = clamp(st.opacity);
    const ink = st.paper > 0.5;
    // 簽章：這些都沒變就沿用上一張貼圖
    const sig = [op.toFixed(2), qr.toFixed(2), frame.toFixed(3), ink, this.live.count, this.live.url, this.live.clock ?? ''].join('|');
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
      c.fillText(String(n), xx, base + 2);
      xx -= c.measureText(String(n)).width + 10;
      c.font = font(F.hei(500), 17);
      c.fillText('已收到', xx, base);
    } else {
      c.font = font(F.hei(500), 17);
      c.fillText('第一則祝福等你來寫', tx, base);
    }
    c.restore();
  }
}
