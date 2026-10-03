// shadowbox（立體框）盒子裡的小東西：一束乾燥花、綁花的緞帶結、把吊牌綁在緞帶上的細線。
// 在 init() 畫一次到 Canvas2D（背板座標），shader 再取樣、打光、加影子；之後每格不用重畫。
// 顏色：花是低飽和的乾燥色（固定色 collar／fur／gingham 混紙色，不用給愛心的 rose），緞帶跟主題的訊號色走、淡一點、不發光。
import { rgba, mixRgba } from '../engine/palette';
import { mulberry32 } from '../engine/util';

export interface Bouquet {
  /** 綁花的地方（緞帶結）。 */
  x: number; y: number;
  /** 花朝的方向（弧度，0 = 右、π/2 = 下）。 */
  dir: number;
  /** 花莖長度。 */
  len: number;
  /** 細線綁到哪裡（吊牌的孔）；null = 沒有吊牌。 */
  tie: { x: number; y: number } | null;
}

export function drawBouquet(c: CanvasRenderingContext2D, b: Bouquet, seed: number) {
  const rnd = mulberry32(seed * 7919 + 13);
  const stem = mixRgba('gingham', 'sepia', 0.5);
  const leaf = mixRgba('gingham', 'sepia', 0.32);
  const dusty = mixRgba(mixRgba('collar', 'paper', 0.42), 'sepia', 0.18);
  const straw = mixRgba('fur', 'paper', 0.38);
  const bone = rgba('bone', 0.92);
  c.save();
  c.lineCap = 'round';
  // 花莖：從綁的地方往花的方向散開，綁的地方後面露一小截剪平的莖
  const heads: { x: number; y: number; kind: number; r: number }[] = [];
  const n = 15;
  for (let i = 0; i < n; i++) {
    const a = b.dir + (i / (n - 1) - 0.5) * 0.7 + (rnd() - 0.5) * 0.12;
    const L = b.len * (0.72 + 0.32 * rnd());
    const ex = b.x + Math.cos(a) * L, ey = b.y + Math.sin(a) * L;
    const bend = (rnd() - 0.5) * 40;
    const mx = b.x + Math.cos(a) * L * 0.5 - Math.sin(a) * bend, my = b.y + Math.sin(a) * L * 0.5 + Math.cos(a) * bend;
    c.strokeStyle = stem; c.lineWidth = 2 + rnd() * 1.2;
    c.beginPath(); c.moveTo(b.x, b.y); c.quadraticCurveTo(mx, my, ex, ey); c.stroke();
    // 莖上幾片小葉子
    for (let k = 0; k < 2; k++) {
      const tt = 0.35 + 0.35 * rnd();
      const lx = (1 - tt) * (1 - tt) * b.x + 2 * (1 - tt) * tt * mx + tt * tt * ex;
      const ly = (1 - tt) * (1 - tt) * b.y + 2 * (1 - tt) * tt * my + tt * tt * ey;
      c.save(); c.translate(lx, ly); c.rotate(a + (rnd() < 0.5 ? -0.7 : 0.7));
      c.fillStyle = leaf; c.beginPath(); c.ellipse(9, 0, 10, 3.2, 0, 0, Math.PI * 2); c.fill(); c.restore();
    }
    heads.push({ x: ex, y: ey, kind: i % 4, r: 0.8 + 0.4 * rnd() });
    // 剪平的莖尾
    const ta = b.dir + Math.PI + (i / (n - 1) - 0.5) * 0.35;
    const tl = 50 + 30 * rnd();
    c.strokeStyle = stem; c.lineWidth = 2.2;
    c.beginPath(); c.moveTo(b.x, b.y); c.lineTo(b.x + Math.cos(ta) * tl, b.y + Math.sin(ta) * tl); c.stroke();
  }
  // 花：乾燥的小玫瑰（一團小花瓣）、金槌花（小圓球）、滿天星（很多小白點）
  for (const h of heads) {
    if (h.kind === 0 || h.kind === 2) {
      for (let k = 0; k < 7; k++) {
        const a = rnd() * Math.PI * 2, d = rnd() * 7 * h.r;
        c.fillStyle = k < 2 ? mixRgba(dusty, 'sepia', 0.25) : dusty;
        c.beginPath(); c.arc(h.x + Math.cos(a) * d, h.y + Math.sin(a) * d, (5 + rnd() * 3) * h.r, 0, Math.PI * 2); c.fill();
      }
      c.fillStyle = mixRgba(dusty, 'sepia', 0.4);
      c.beginPath(); c.arc(h.x, h.y, 2.5 * h.r, 0, Math.PI * 2); c.fill();
    } else if (h.kind === 1) {
      c.fillStyle = straw;
      c.beginPath(); c.arc(h.x, h.y, 10 * h.r, 0, Math.PI * 2); c.fill();
      c.fillStyle = mixRgba(straw, 'sepia', 0.25);
      for (let k = 0; k < 9; k++) { const a = rnd() * Math.PI * 2, d = rnd() * 8 * h.r; c.beginPath(); c.arc(h.x + Math.cos(a) * d, h.y + Math.sin(a) * d, 1.3, 0, Math.PI * 2); c.fill(); }
    } else {
      c.strokeStyle = stem; c.lineWidth = 1;
      for (let k = 0; k < 9; k++) {
        const a = rnd() * Math.PI * 2, d = 8 + rnd() * 22 * h.r;
        const px = h.x + Math.cos(a) * d, py = h.y + Math.sin(a) * d;
        c.beginPath(); c.moveTo(h.x, h.y); c.lineTo(px, py); c.stroke();
        c.fillStyle = bone; c.beginPath(); c.arc(px, py, 2.4 + rnd() * 1.2, 0, Math.PI * 2); c.fill();
      }
    }
  }
  // 細線：從緞帶結繞到吊牌的孔（稍微下垂）
  if (b.tie) {
    c.strokeStyle = rgba('ash', 0.9); c.lineWidth = 1.6;
    const mx = (b.x + b.tie.x) / 2, my = Math.max(b.y, b.tie.y) + 30;
    c.beginPath(); c.moveTo(b.x + 4, b.y - 4); c.quadraticCurveTo(mx, my, b.tie.x, b.tie.y); c.stroke();
  }
  // 緞帶結：兩個圈、兩條尾巴（跟主題的訊號色走，淡一點），中間一個結
  const rib = mixRgba('signal', 'paper', 0.35);
  const ribD = mixRgba(rib, 'sepia', 0.3);
  c.translate(b.x, b.y);
  c.rotate(b.dir + Math.PI / 2);
  for (const s of [-1, 1]) {
    c.fillStyle = ribD;
    c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(s * 10, 30, s * 24, 66); c.lineTo(s * 12, 70); c.quadraticCurveTo(s * 4, 34, 0, 0); c.fill();
    const g = c.createLinearGradient(0, -20, s * 40, 20);
    g.addColorStop(0, ribD); g.addColorStop(0.5, rib); g.addColorStop(1, ribD);
    c.fillStyle = g;
    c.beginPath(); c.moveTo(0, 0);
    c.bezierCurveTo(s * 18, -30, s * 52, -22, s * 44, 2);
    c.bezierCurveTo(s * 38, 18, s * 14, 10, 0, 0); c.fill();
  }
  c.fillStyle = ribD;
  c.beginPath(); c.ellipse(0, 0, 8, 7, 0, 0, Math.PI * 2); c.fill();
  c.restore();
}
