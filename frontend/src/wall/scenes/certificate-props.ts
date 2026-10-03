// 祝福登記表（certificate）桌上的道具（v2：留言板縮小，免得整面牆只剩一塊大字；空出來的地方補上會動的東西）：
// 鏡頭拉遠之後桌面空出來，放上會動的東西——一支自己會寫字的鋼筆、一顆橡皮章與印泥盒、一杯冒著熱氣的茶。
// 全部是俯視（從正上方看）、紙面座標（跟表格同一套座標，主檔用鏡頭的仿射畫到畫面上），顏色一律用色票。
// 不會變的（印泥盒、茶杯）在 init 畫成小畫布，每格只貼圖；會動的（筆、章、熱氣、漣漪）每格畫，但都只是幾筆漸層。
// 影子：光從左上方來，東西離桌面越高，影子往右下偏得越多、越淡（看得出筆和章「抬起來」）。
import { HEX, rgba, mixRgba } from '../engine/palette';
import { clamp, TAU } from '../engine/util';

type Ctx2 = CanvasRenderingContext2D;

/** 兩個色票（或 #hex）混出一個 #hex，可以再拿去 mixRgba（mixRgba 只收色票名或 #hex）。 */
function mixHex(a: string, b: string, k: number): string {
  const px = (x: string) => parseInt(((HEX as Record<string, string>)[x] ?? x).replace('#', ''), 16);
  const na = px(a), nb = px(b);
  const ch = (sh: number) => Math.round(((na >> sh) & 255) + (((nb >> sh) & 255) - ((na >> sh) & 255)) * k);
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0');
}

/** 道具擺放的位置（紙面座標；紙在 x 66～1854）。桌面右邊一條：茶杯、印泥盒、章，鋼筆斜放在紙的右緣。 */
export const PROPS = {
  cup: { x: 2440, y: 130 },
  pad: { x: 2190, y: 620 },
  /** 章放著的地方：避開右下角 HUD（螢幕 x ≥ 1460、y ≥ 820 那一塊不放東西）。 */
  stampRest: { x: 2250, y: 900, r: 0.12 },
  /** 鋼筆放著時：筆尖的位置、筆身的方向（從筆尖往筆尾，弧度）。 */
  penRest: { x: 1915, y: 440, a: 1.42 },
  /** 紙的左下方露出一個信封（不會動，讓桌面不空）。 */
  envelope: { x: 400, y: 1335, r: -0.09 },
};

/** 鋼筆的長度、寫字時筆身的方向（從筆尖往右下方，像右手拿筆）。 */
export const PEN_LEN = 440;
export const PEN_WRITE_A = 0.66;
/** 章的邊長（跟方章一樣大，蓋下去剛好蓋住）。 */
export const STAMP_SIDE = 256;

/** 影子的偏移（紙面 px）：高度 h（0 = 貼在桌上）。 */
const shadowOff = (h: number) => ({ x: 6 + 46 * h, y: 9 + 64 * h });

// ---------------------------------------------------------------- 鋼筆
/**
 * 俯視的鋼筆：筆尖在 (x, y)，筆身往角度 a 延伸。lift：筆尖離紙多高（0 = 正在寫）；筆尾本來就比筆尖高（斜拿著），
 * 所以影子是一個從筆尖往筆尾越偏越多的四邊形。
 */
export function drawPen(c: Ctx2, x: number, y: number, a: number, lift: number, resting = 0) {
  const ca = Math.cos(a), sa = Math.sin(a);
  const tail = { x: x + ca * PEN_LEN, y: y + sa * PEN_LEN };
  // 平放在桌上時整支都貼著桌面（resting = 1），拿起來寫字時筆尾高
  const h0 = lift * 0.6, h1 = lift * 0.6 + 0.55 * (1 - resting);
  const o0 = shadowOff(h0), o1 = shadowOff(h1);
  const nx = -sa, ny = ca;
  c.save();
  // 影子：兩層（寬淡＋窄濃），不用 blur 濾鏡（每格重畫很貴）
  for (const [w, al] of [[15, 0.08], [8, 0.13]] as const) {
    const w0 = 3, w1 = w;
    c.fillStyle = rgba('ink', al * (1 - 0.35 * lift));
    c.beginPath();
    c.moveTo(x + o0.x + nx * w0, y + o0.y + ny * w0);
    c.lineTo(tail.x + o1.x + nx * w1, tail.y + o1.y + ny * w1);
    c.lineTo(tail.x + o1.x - nx * w1, tail.y + o1.y - ny * w1);
    c.lineTo(x + o0.x - nx * w0, y + o0.y - ny * w0);
    c.closePath(); c.fill();
  }
  // 筆身：沿著筆的座標畫（筆尖在原點、筆身往 +x），抬起來時大一點點（離鏡頭近）
  c.translate(x, y); c.rotate(a);
  const k = 1 + 0.05 * lift;
  c.scale(k, k);
  const cyl = (x0: number, x1: number, r: number, dark: string, mid: string, hi: string) => {
    const g = c.createLinearGradient(0, -r, 0, r);
    g.addColorStop(0, dark); g.addColorStop(0.28, hi); g.addColorStop(0.5, mid); g.addColorStop(1, dark);
    c.fillStyle = g;
    c.beginPath(); c.roundRect(x0, -r, x1 - x0, 2 * r, Math.min(r, 6)); c.fill();
  };
  // 筆尖（金屬、尖的）
  const nib = c.createLinearGradient(0, -9, 0, 9);
  nib.addColorStop(0, mixRgba('ash', 'ink', 0.3)); nib.addColorStop(0.35, rgba('bone')); nib.addColorStop(1, mixRgba('ash', 'ink', 0.5));
  c.fillStyle = nib;
  c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(22, -9, 50, -10); c.lineTo(50, 10); c.quadraticCurveTo(22, 9, 0, 0); c.fill();
  c.strokeStyle = rgba('ink', 0.5); c.lineWidth = 1.2;
  c.beginPath(); c.moveTo(4, 0); c.lineTo(34, 0); c.stroke();
  // 握位、筆桿、金屬環、筆蓋（套在筆尾）、筆夾
  cyl(48, 128, 13, rgba('ink'), mixRgba('ink2', 'graphite', 0.4), mixRgba('graphite', 'ash', 0.4));
  const body = (m: number) => mixRgba('blood', 'ink', m);
  cyl(126, 330, 16, body(0.72), body(0.4), mixRgba('blood', 'bone', 0.35));
  cyl(326, 338, 17, mixRgba('blood', 'ink', 0.4), rgba('signal'), mixRgba('signal', 'bone', 0.5));
  cyl(336, PEN_LEN, 17.5, body(0.75), body(0.45), mixRgba('blood', 'bone', 0.3));
  c.fillStyle = mixRgba('ash', 'bone', 0.4);
  c.beginPath(); c.roundRect(350, -4.5 - 10, PEN_LEN - 368, 5, 2.5); c.fill();
  c.restore();
}

// ---------------------------------------------------------------- 橡皮章
/** 俯視的橡皮章（木頭方塊＋圓的握把）：中心 (x, y)、旋轉 r、高度 h（0 = 壓在紙上）。 */
export function drawStamp(c: Ctx2, x: number, y: number, r: number, h: number) {
  const S = STAMP_SIDE, o = shadowOff(h * 1.2);
  c.save();
  // 影子（方塊）：抬起來越高越淡、越偏
  c.save();
  c.translate(x + o.x, y + o.y); c.rotate(r);
  for (const [g, al] of [[14, 0.1], [4, 0.2]] as const) {
    c.fillStyle = rgba('ink', al * (1 - 0.4 * clamp(h)));
    c.beginPath(); c.roundRect(-S / 2 - g, -S / 2 - g, S + 2 * g, S + 2 * g, 16 + g); c.fill();
  }
  c.restore();
  c.translate(x, y); c.rotate(r);
  const k = 1 + 0.12 * h;
  c.scale(k, k);
  // 方塊：四邊的斜面（左上亮、右下暗）＋頂面
  // 木頭用固定的暖色（道具：換到薰衣草主題也還是木頭）
  const wood = (m: number, a = 1) => mixRgba(mixHex('fur', 'paper', 0.35), 'sepia', m, a);
  c.fillStyle = wood(0.62);
  c.beginPath(); c.roundRect(-S / 2, -S / 2, S, S, 16); c.fill();
  const bev = c.createLinearGradient(-S / 2, -S / 2, S / 2, S / 2);
  bev.addColorStop(0, wood(0.38)); bev.addColorStop(1, wood(0.78));
  c.fillStyle = bev;
  c.beginPath(); c.roundRect(-S / 2 + 3, -S / 2 + 3, S - 6, S - 6, 14); c.fill();
  const top = c.createLinearGradient(0, -S / 2, 0, S / 2);
  top.addColorStop(0, wood(0.44)); top.addColorStop(1, wood(0.56));
  c.fillStyle = top;
  c.beginPath(); c.roundRect(-S / 2 + 22, -S / 2 + 22, S - 44, S - 44, 8); c.fill();
  // 木紋：幾條很淡的弧線
  c.strokeStyle = wood(0.8, 0.18); c.lineWidth = 2;
  for (let i = 0; i < 5; i++) { c.beginPath(); c.ellipse(-30, 60, 60 + i * 26, 30 + i * 18, -0.4, Math.PI * 1.05, Math.PI * 1.85); c.stroke(); }
  // 握把：圓的木頭，比方塊高——影子落在方塊上
  c.fillStyle = wood(0.9, 0.35);
  c.beginPath(); c.arc(10, 14, 70, 0, TAU); c.fill();
  const kn = c.createRadialGradient(-22, -24, 8, 0, 0, 70);
  kn.addColorStop(0, wood(0.25)); kn.addColorStop(0.6, wood(0.52)); kn.addColorStop(1, wood(0.72));
  c.fillStyle = kn;
  c.beginPath(); c.arc(0, 0, 66, 0, TAU); c.fill();
  // 握把頂上的一圈訊號色（這顆是「百年好合」章）
  c.strokeStyle = mixRgba('signal', 'blood', 0.4, 0.85); c.lineWidth = 5;
  c.beginPath(); c.arc(0, 0, 30, 0, TAU); c.stroke();
  c.restore();
}

// ---------------------------------------------------------------- 不會動的：印泥盒、茶杯（init 畫一次）
export interface Art { cv: HTMLCanvasElement; ox: number; oy: number }

/** 在一張小畫布上畫（中心在畫布的 (ox, oy)），回傳畫布。 */
function art(w: number, h: number, ox: number, oy: number, draw: (c: Ctx2) => void): Art {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d')!;
  c.translate(ox, oy);
  draw(c);
  return { cv, ox, oy };
}

/**
 * 印泥盒：圓的白瓷盒（台灣人蓋印章用的那種），蓋子翻開放在旁邊，盒裡是訊號色的印泥（有被壓過的紋路）。
 * 中心是印泥的中心（章要壓在這裡）。
 */
export function makeInkPad(): Art {
  const R = 118;
  return art(R * 2 + 90, R * 4 + 120, R + 40, R * 3 + 60, (c) => {
    const porcelain = (r: number) => {
      const g = c.createRadialGradient(-r * 0.4, -r * 0.45, r * 0.1, 0, 0, r);
      g.addColorStop(0, mixRgba('bone', 'paper', 0.2)); g.addColorStop(1, mixRgba('paper', 'ash', 0.5));
      return g;
    };
    // 蓋子：翻過來放在盒子上方，看得到頂上一圈青花似的細線（訊號色）
    c.save(); c.translate(-6, -R * 2 - 22);
    c.fillStyle = rgba('ink', 0.22); c.beginPath(); c.arc(10, 14, R + 4, 0, TAU); c.fill();
    c.fillStyle = porcelain(R + 4); c.beginPath(); c.arc(0, 0, R + 4, 0, TAU); c.fill();
    c.strokeStyle = mixRgba('signal', 'blood', 0.5, 0.55); c.lineWidth = 3;
    for (const r of [R - 8, R - 22]) { c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke(); }
    c.lineWidth = 2;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      c.beginPath(); c.arc(Math.cos(a) * (R - 52), Math.sin(a) * (R - 52), 16, a + 0.8, a + 0.8 + Math.PI * 1.3); c.stroke();
    }
    c.fillStyle = mixRgba('signal', 'blood', 0.5, 0.5); c.beginPath(); c.arc(0, 0, 12, 0, TAU); c.fill();
    c.restore();
    // 盒身
    c.fillStyle = rgba('ink', 0.24); c.beginPath(); c.arc(10, 14, R, 0, TAU); c.fill();
    c.fillStyle = porcelain(R); c.beginPath(); c.arc(0, 0, R, 0, TAU); c.fill();
    c.strokeStyle = rgba('sepia', 0.18); c.lineWidth = 2; c.beginPath(); c.arc(0, 0, R - 14, 0, TAU); c.stroke();
    // 印泥：中間被壓得比較平、比較濃，四周有一圈一圈刮過的紋
    const pg = c.createRadialGradient(-8, -10, 8, 0, 0, R - 18);
    pg.addColorStop(0, mixRgba('signal', 'blood', 0.35)); pg.addColorStop(1, mixRgba('blood', 'ink', 0.3));
    c.fillStyle = pg; c.beginPath(); c.arc(0, 0, R - 18, 0, TAU); c.fill();
    c.strokeStyle = mixRgba('blood', 'ink', 0.4, 0.35); c.lineWidth = 2;
    for (let k = 0; k < 5; k++) { c.beginPath(); c.arc(4 * k - 8, 3 * k - 6, 22 + k * 15, 0.4 * k, 0.4 * k + 2.4); c.stroke(); }
    c.fillStyle = rgba('bone', 0.14); c.beginPath(); c.ellipse(-34, -40, 24, 12, -0.6, 0, TAU); c.fill();
  });
}

/** 茶杯與杯碟（俯視）：白瓷、杯裡是茶、茶面上有桌燈的倒影、杯碟上一支小湯匙。 */
export function makeCup(): Art {
  return art(420, 420, 210, 210, (c) => {
    c.fillStyle = rgba('ink', 0.25);
    c.beginPath(); c.arc(12, 16, 156, 0, TAU); c.fill();
    const porcelain = (r: number, m: number) => {
      const g = c.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
      g.addColorStop(0, mixRgba('bone', 'paper', 0.2)); g.addColorStop(1, mixRgba('paper', 'ash', m));
      return g;
    };
    // 杯碟
    c.fillStyle = porcelain(152, 0.55);
    c.beginPath(); c.arc(0, 0, 152, 0, TAU); c.fill();
    c.strokeStyle = mixRgba('signal', 'blood', 0.5, 0.45); c.lineWidth = 3;
    c.beginPath(); c.arc(0, 0, 140, 0, TAU); c.stroke();
    c.strokeStyle = rgba('sepia', 0.14); c.lineWidth = 2;
    c.beginPath(); c.arc(0, 0, 112, 0, TAU); c.stroke();
    // 湯匙
    c.save(); c.rotate(0.9);
    c.fillStyle = mixRgba('ash', 'bone', 0.5);
    c.beginPath(); c.roundRect(96, -5, 50, 10, 5); c.fill();
    c.beginPath(); c.ellipse(90, 0, 16, 11, 0, 0, TAU); c.fill();
    c.restore();
    // 杯子：影子、把手、杯壁、茶
    c.fillStyle = rgba('ink', 0.22);
    c.beginPath(); c.arc(9, 12, 104, 0, TAU); c.fill();
    c.save(); c.rotate(-0.7);
    c.fillStyle = porcelain(40, 0.5);
    c.beginPath(); c.roundRect(92, -17, 58, 34, 17); c.fill();
    c.fillStyle = mixRgba('paper', 'sepia', 0.3);
    c.beginPath(); c.roundRect(104, -7, 30, 14, 7); c.fill();
    c.restore();
    c.fillStyle = porcelain(104, 0.45);
    c.beginPath(); c.arc(0, 0, 104, 0, TAU); c.fill();
    // 茶色用固定的暖色（道具：換主題茶也不會變紫色）
    const tea = c.createRadialGradient(-20, -24, 6, 0, 0, 90);
    tea.addColorStop(0, mixRgba('fur', 'sepia', 0.35)); tea.addColorStop(0.7, mixRgba('fur', 'sepia', 0.62)); tea.addColorStop(1, mixRgba('sepia', 'ink', 0.35));
    c.fillStyle = tea;
    c.beginPath(); c.arc(0, 0, 90, 0, TAU); c.fill();
    c.strokeStyle = mixRgba('bone', 'paper', 0.4, 0.9); c.lineWidth = 3;
    c.beginPath(); c.arc(0, 0, 103, 0, TAU); c.stroke();
    // 桌燈在茶面上的倒影
    c.fillStyle = rgba('bone', 0.3);
    c.beginPath(); c.ellipse(-38, -30, 16, 9, -0.6, 0, TAU); c.fill();
  });
}

/** 牛皮紙信封（背面朝上：封口的三角與一顆訊號色的封蠟），擺在紙的左下方。 */
export function makeEnvelope(): Art {
  const W0 = 680, H0 = 420;
  return art(W0 + 80, H0 + 80, W0 / 2 + 30, H0 / 2 + 30, (c) => {
    c.rotate(PROPS.envelope.r);
    c.fillStyle = rgba('ink', 0.25);
    c.beginPath(); c.roundRect(-W0 / 2 + 10, -H0 / 2 + 14, W0, H0, 8); c.fill();
    const kraft = (m: number) => mixRgba(mixHex('fur', 'paper', 0.45), 'sepia', m);
    const g = c.createLinearGradient(-W0 / 2, -H0 / 2, W0 / 2, H0 / 2);
    g.addColorStop(0, kraft(0.12)); g.addColorStop(1, kraft(0.3));
    c.fillStyle = g;
    c.beginPath(); c.roundRect(-W0 / 2, -H0 / 2, W0, H0, 8); c.fill();
    // 封口的三角（稍微深一點）與兩側摺線
    c.fillStyle = kraft(0.24);
    c.beginPath(); c.moveTo(-W0 / 2, -H0 / 2); c.lineTo(0, 30); c.lineTo(W0 / 2, -H0 / 2); c.closePath(); c.fill();
    c.strokeStyle = kraft(0.5); c.lineWidth = 2;
    c.beginPath(); c.moveTo(-W0 / 2, H0 / 2); c.lineTo(-40, -10); c.moveTo(W0 / 2, H0 / 2); c.lineTo(40, -10); c.stroke();
    // 封蠟
    c.fillStyle = mixRgba('blood', 'ink', 0.2);
    c.beginPath(); c.arc(0, 30, 38, 0, TAU); c.fill();
    c.fillStyle = mixRgba('signal', 'blood', 0.45);
    c.beginPath(); c.arc(-3, 27, 30, 0, TAU); c.fill();
    c.strokeStyle = mixRgba('blood', 'ink', 0.35, 0.8); c.lineWidth = 2.5;
    c.beginPath(); c.arc(-3, 27, 20, 0, TAU); c.stroke();
  });
}

export function drawArt(c: Ctx2, a: Art, x: number, y: number) {
  c.drawImage(a.cv, x - a.ox, y - a.oy);
}

// ---------------------------------------------------------------- 會動的：熱氣、茶面的漣漪
/**
 * 茶的熱氣：三縷白煙從杯口往上飄（俯視：往畫面上方、被風往左右吹），邊飄邊散開變淡。
 * 每一縷是一條越往上越寬的帶子，用沿著它的漸層填色（中間濃、兩端淡），不用 blur 濾鏡；整個是時間的純函數。
 */
export function drawSteam(c: Ctx2, x: number, y: number, t: number, seed: number) {
  c.save();
  const N = 14;
  for (let i = 0; i < 3; i++) {
    const wind = 0.35 * Math.sin(t * 0.31 + i * 1.7 + seed) + 0.15 * Math.sin(t * 0.83 + i);
    const base = -Math.PI / 2 + (i - 1) * 0.4 + wind;
    const mid: { x: number; y: number }[] = [];
    for (let j = 0; j <= N; j++) {
      const r = 26 + j * 20;
      const wig = Math.sin(j * 0.55 - t * 1.7 + i * 2.1 + seed) * (4 + j * 2.4);
      const ang = base + 0.025 * j * Math.sin(t * 0.5 + i);
      mid.push({ x: x + Math.cos(ang) * r - Math.sin(ang) * wig, y: y + Math.sin(ang) * r + Math.cos(ang) * wig });
    }
    const end = mid[N]!;
    const breathe = 0.75 + 0.25 * Math.sin(t * 1.1 + i * 2);
    for (const [w0, w1, a] of [[16, 70, 0.06], [6, 30, 0.09]] as const) {
      const L: { x: number; y: number }[] = [], R: { x: number; y: number }[] = [];
      for (let j = 0; j <= N; j++) {
        const p = mid[j]!, q = mid[Math.min(N, j + 1)]!, o = mid[Math.max(0, j - 1)]!;
        const dx = q.x - o.x, dy = q.y - o.y, l = Math.hypot(dx, dy) || 1;
        const w = (w0 + (w1 - w0) * (j / N)) / 2;
        L.push({ x: p.x - (dy / l) * w, y: p.y + (dx / l) * w });
        R.push({ x: p.x + (dy / l) * w, y: p.y - (dx / l) * w });
      }
      const g = c.createLinearGradient(mid[0]!.x, mid[0]!.y, end.x, end.y);
      g.addColorStop(0, rgba('bone', 0)); g.addColorStop(0.25, rgba('bone', a * breathe)); g.addColorStop(1, rgba('bone', 0));
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(L[0]!.x, L[0]!.y);
      for (let j = 1; j <= N; j++) c.lineTo(L[j]!.x, L[j]!.y);
      for (let j = N; j >= 0; j--) c.lineTo(R[j]!.x, R[j]!.y);
      c.closePath(); c.fill();
    }
  }
  c.restore();
}

/** 茶面的漣漪：大鼓一打，杯心起一圈往外擴散的細環（k = 大鼓的衰減包絡 1 → 0）。 */
export function drawRipple(c: Ctx2, x: number, y: number, k: number) {
  if (k < 0.03) return;
  c.save();
  c.beginPath(); c.arc(x, y, 88, 0, TAU); c.clip();
  for (const [dr, a] of [[0, 0.5], [18, 0.3]] as const) {
    const r = 10 + dr + 70 * (1 - k);
    c.strokeStyle = rgba('bone', a * k);
    c.lineWidth = 2.2;
    c.beginPath(); c.arc(x - 6, y - 4, r, 0, TAU); c.stroke();
  }
  c.restore();
}
