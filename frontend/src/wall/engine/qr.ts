// QR code（掃描留言）。用 qrcode-generator 算模組，自己畫在 Canvas2D 上，大小、顏色跟版面一致。
// 一律是「淺底深點」：有些手機（LINE 的掃描器）讀不到反白的 QR，所以暗底版面也要墊一塊紙色。
import qrcode from 'qrcode-generator';

const cache = new Map<string, boolean[][]>();

/** QR 的模組（true = 深色），同一個網址只算一次。 */
export function qrModules(text: string): boolean[][] {
  let m = cache.get(text);
  if (!m) {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    const n = q.getModuleCount();
    m = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)));
    cache.set(text, m);
  }
  return m;
}

/**
 * 在 (x, y) 畫一個邊長 size 的 QR（含四周 quiet zone 的淺色底）。
 * `reveal` 0..1：由左上往右下一格一格出現（版面進場用），1 = 全部。
 */
export function drawQR(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, o: { ink?: string; paper?: string; quiet?: number; radius?: number; reveal?: number } = {}) {
  // quiet zone 規格建議 4 格；外圈的暗色版面不算留白，所以至少留 3 格淺色邊（再多 QR 就太小了）
  const m = qrModules(text), n = m.length, quiet = o.quiet ?? 3;
  const cell = size / (n + quiet * 2);
  const reveal = o.reveal ?? 1;
  c.save();
  c.fillStyle = o.paper ?? '#F2EBDF';
  const r = o.radius ?? cell * 1.2;
  c.beginPath();
  c.roundRect(x, y, size, size, r);
  c.fill();
  c.fillStyle = o.ink ?? '#0B0A09';
  // 對齊整數像素：模組之間才不會有細縫
  for (let rr = 0; rr < n; rr++) {
    for (let cc = 0; cc < n; cc++) {
      if (!m[rr]![cc]) continue;
      if (reveal < 1 && (rr + cc) / (2 * n - 2) > reveal) continue;
      const x0 = Math.round(x + (cc + quiet) * cell), y0 = Math.round(y + (rr + quiet) * cell);
      const x1 = Math.round(x + (cc + quiet + 1) * cell), y1 = Math.round(y + (rr + quiet + 1) * cell);
      c.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  }
  c.restore();
}
