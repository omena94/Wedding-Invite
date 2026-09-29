// 批次 C9（演唱會：concert、lightsticks、phonelights、encore、merch）共用的場景零件。
// 新人和狗一律是 Codex 畫的紙偶（_puppet.ts、素材組 live：黑色星星音符 T、發光手環）；這裡只有**程式畫的配角與道具**：
//  - 其他觀眾的剪影（新人要求：其他觀眾畫成剪影；不畫任何真實歌手、團體的名稱或標誌）；
//  - 應援手燈（圓頭、裡面一顆星，跟 T 恤圖案同一套、自己設計的）、手機、布條／毛巾這種「掛著字的布」；
//  - 發光的點（手燈、手環、手機的燈）：預先畫好的光暈小圖，畫在低解析度的加亮層上，一格幾百顆也很快。
// 紙偶手上是空拳（Codex 照指示畫的），手燈的握把、手機、布條由這裡畫在拳頭的道具點上：
// 道具會發光、會跟著主題換色、會跟著拍子揮，而且全場的手燈可以跟兩個人的一起變色（演唱會的中控手燈）。
// 全部只看傳進來的 t／拍點／種子，確定性沒問題。
import { clamp, hash, lerp } from '../engine/util';
import { rgba, mixRgba } from '../engine/palette';

type Ctx = CanvasRenderingContext2D;
export type Pt = { x: number; y: number };

// ---------------------------------------------------------------- 光暈小圖
const SPRITE = new Map<string, HTMLCanvasElement>();
/**
 * 一顆光暈（中心白熱、往外是 col、再淡掉）的小圖，同一個顏色只畫一次。畫在加亮層（comp.draw mode 'add'）上用。
 * 主題換色時 rgba() 的字串會變，快取的 key 就是顏色字串本身。
 */
export function glowSprite(col: string): HTMLCanvasElement {
  let cv = SPRITE.get(col);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d')!;
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  const m = col.match(/[\d.]+/g)!.map(Number);
  const rgb = `${m[0]},${m[1]},${m[2]}`;
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, `rgba(${rgb},0.95)`);
  g.addColorStop(0.35, `rgba(${rgb},0.35)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  if (SPRITE.size > 48) SPRITE.clear();
  SPRITE.set(col, cv);
  return cv;
}

/** 在加亮層上點一顆光：r = 光暈半徑（畫面 px）。 */
export function glow(c: Ctx, col: string, x: number, y: number, r: number, a = 1) {
  if (a <= 0.004 || r <= 0.5) return;
  const prev = c.globalAlpha;
  c.globalAlpha = prev * clamp(a, 0, 1);
  c.drawImage(glowSprite(col), x - r, y - r, r * 2, r * 2);
  c.globalAlpha = prev;
}

// ---------------------------------------------------------------- 應援手燈
/**
 * 圓頭應援手燈：黑色握把從拳頭的上緣伸出來（握把的下半截在拳頭裡，不畫）、上面一顆半透明的圓球，球裡一顆星（T 恤同款）。
 * fist = 拳頭的中心、ang = 手燈指的方向（0 = 正上、正 = 往右倒）、s = 場景尺度（宣文的身高 px）、lit = 燈的顏色。
 * 回傳球心（光暈、加亮層用）。
 */
export function lightStick(c: Ctx, fist: Pt, ang: number, s: number, o: { lit: string; alpha?: number; on?: number }): Pt {
  const dx = Math.sin(ang), dy = -Math.cos(ang);
  const grip = s * 0.028, handle = s * 0.1, R = s * 0.052;
  const x0 = fist.x + dx * grip, y0 = fist.y + dy * grip;
  const x1 = x0 + dx * handle, y1 = y0 + dy * handle;
  const cx = x1 + dx * R * 0.92, cy = y1 + dy * R * 0.92;
  const on = o.on ?? 1;
  c.save();
  c.globalAlpha *= o.alpha ?? 1;
  // 握把：黑色、上端一圈銀色的接頭
  c.lineCap = 'round';
  c.strokeStyle = mixRgba('ink2', 'graphite', 0.35);
  c.lineWidth = s * 0.024;
  c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  // 握把上一道細細的反光（暗版面也看得出是一支棒子）
  c.strokeStyle = rgba('bone', 0.3);
  c.lineWidth = Math.max(1, s * 0.004);
  c.beginPath(); c.moveTo(x0 - dy * s * 0.006, y0 + dx * s * 0.006); c.lineTo(x1 - dy * s * 0.006, y1 + dx * s * 0.006); c.stroke();
  c.strokeStyle = mixRgba('ash', 'bone', 0.4, 0.9);
  c.lineWidth = s * 0.03;
  c.beginPath(); c.moveTo(x1 - dx * s * 0.012, y1 - dy * s * 0.012); c.lineTo(x1, y1); c.stroke();
  // 球：半透明，燈亮時整顆染上燈色、中間最亮
  const g = c.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.1, cx, cy, R);
  g.addColorStop(0, mixRgba('bone', o.lit, 0.25 + 0.2 * (1 - on)));
  g.addColorStop(0.65, mixRgba(o.lit, 'bone', 0.25 * on, 0.55 + 0.35 * on));
  g.addColorStop(1, mixRgba(o.lit, 'ink', 0.3, 0.75));
  c.fillStyle = g;
  c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
  c.strokeStyle = rgba('bone', 0.35);
  c.lineWidth = 1.2;
  c.stroke();
  // 球裡的星星（跟著手燈轉）
  c.fillStyle = rgba('bone', 0.55 + 0.4 * on);
  star(c, cx, cy, R * 0.5, ang);
  c.fill();
  c.restore();
  return { x: cx, y: cy };
}

/** 五角星的路徑（中心、外半徑、轉角）。 */
export function star(c: Ctx, x: number, y: number, r: number, rot = 0) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot - Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.44 : r;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (i) c.lineTo(px, py); else c.moveTo(px, py);
  }
  c.closePath();
}

// ---------------------------------------------------------------- 手機
/**
 * 舉著的手機（背面朝鏡頭：錄舞台、開手電筒）：深色圓角機身、左上角的鏡頭與閃光燈。
 * at = 拳頭中心（手機蓋在拳頭前面，手指被機身擋住）；回傳閃光燈的位置（亮手電筒用）。
 */
export function phoneBack(c: Ctx, at: Pt, ang: number, s: number, o: { alpha?: number; land?: boolean } = {}): Pt {
  const w = s * (o.land ? 0.15 : 0.074), h = s * (o.land ? 0.074 : 0.15);
  c.save();
  c.globalAlpha *= o.alpha ?? 1;
  c.translate(at.x, at.y - (o.land ? 0 : h * 0.18));
  c.rotate(ang);
  c.fillStyle = mixRgba('ink2', 'graphite', 0.6);
  roundRect(c, -w / 2, -h / 2, w, h, w * 0.16);
  c.fill();
  // 機身的邊：一圈亮邊（螢幕的光從側面漏出來），暗版面裡才看得到
  c.strokeStyle = mixRgba('bone', 'signal', 0.2, 0.55);
  c.lineWidth = Math.max(1.2, s * 0.004);
  c.stroke();
  // 鏡頭模組
  const lx = -w / 2 + w * 0.26, ly = -h / 2 + w * 0.26;
  c.fillStyle = rgba('ink');
  c.beginPath(); c.arc(lx, ly, w * 0.11, 0, Math.PI * 2); c.fill();
  const fl = { x: lx + w * 0.26, y: ly };
  c.fillStyle = rgba('bone', 0.8);
  c.beginPath(); c.arc(fl.x, fl.y, w * 0.05, 0, Math.PI * 2); c.fill();
  c.restore();
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const oy = at.y - (o.land ? 0 : h * 0.18);
  return { x: at.x + fl.x * ca - fl.y * sa, y: oy + fl.x * sa + fl.y * ca };
}

export function roundRect(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// ---------------------------------------------------------------- 觀眾剪影
export interface Fan {
  x: number;
  /** 頭的中心 y（鏡頭大約在眼睛的高度：遠近的人頭都在差不多的高度，遠的小）。 */
  y: number;
  /** 遠近（1 = 跟兩個主角一樣近、越小越遠）。 */
  k: number;
  /** 0..1 的種子：舉手、拿手燈或手機、晃的相位。 */
  s: number;
  /** 舉起來的是哪一隻手：-1 左、+1 右、0 沒舉。 */
  arm: -1 | 0 | 1;
  prop: 'stick' | 'phone' | null;
}

/**
 * 一片站著的觀眾（演唱會的搖滾區、場外的人潮）：鏡頭大約在人的眼睛高度，所以遠近的人頭都在 eye 附近，遠的小、近的大。
 * n 個人，遠近 k 在 kFar～kNear 之間（遠的多、近的少）；lift：舉手的比例；phone：舉手機（不是手燈）的比例；
 * skip(x, k) 回傳 true 的位置空下來（例如右下角 HUD 前面不站近的人）。回傳由遠到近排好（近的蓋在遠的上面）。
 */
export function makeCrowd(o: { x0: number; x1: number; eye: number; n: number; kNear: number; kFar: number; seed?: number; lift?: number; phone?: number; skip?: (x: number, k: number) => boolean }): Fan[] {
  const out: Fan[] = [];
  const sd = o.seed ?? 1;
  for (let i = 0; i < o.n * 3 && out.length < o.n; i++) {
    const d = Math.pow(hash(i, sd, 1), 0.55); // 遠的多
    const k = lerp(o.kNear, o.kFar, d);
    const x = lerp(o.x0, o.x1, hash(i, sd, 2));
    if (o.skip?.(x, k)) continue;
    const up = hash(i, sd, 4) < (o.lift ?? 0.5);
    out.push({
      x, y: o.eye + (hash(i, sd, 5) - 0.5) * 36 * k - (1 - k) * 8, k, s: hash(i, sd, 3),
      arm: up ? (hash(i, sd, 6) < 0.5 ? -1 : 1) : 0,
      prop: up ? (hash(i, sd, 7) < (o.phone ?? 0.2) ? 'phone' : 'stick') : null,
    });
  }
  return out.sort((a, b) => a.k - b.k);
}

export interface FanLight { x: number; y: number; r: number; prop: 'stick' | 'phone'; s: number; k: number }

/**
 * 畫觀眾剪影：頭、肩膀、一路到腳的身體（下半身會被更近的人與地上的暗蓋住）、舉起來的手與手上的手燈／手機。
 * unit = k = 1 時頭的半徑（px）；fill(k) = 剪影的顏色（遠的被霧照得亮一點）；rim = 朝舞台那一側（右上）的輪廓光；
 * bounce：這一格跟著拍子點頭的量（0..1）；jump：一起跳的高度（px，近的跳得多）；wave：手臂左右揮的角度（弧度）；lit：手燈球的顏色。
 * 遠近分五段，一段一個 path，幾百個人也很快。回傳每個人手上的燈（手燈的球、手機），給加亮層畫光。
 */
export function drawCrowd(c: Ctx, fans: readonly Fan[], o: { unit: number; fill: (k: number) => string; rim?: string; bounce: number; t: number; jump?: number; wave?: number; lit?: string }): FanLight[] {
  const lights: FanLight[] = [];
  if (!fans.length) return lights;
  const BANDS = 5;
  const k0 = fans[0]!.k, k1 = fans[fans.length - 1]!.k;
  const head = (f: Fan) => {
    const r = o.unit * f.k;
    const dy = r * 0.35 * o.bounce * (0.4 + f.s) + (o.jump ?? 0) * f.k * (0.7 + 0.6 * f.s);
    return { x: f.x, y: f.y - dy, r };
  };
  const arm = (f: Fan, h: { x: number; y: number; r: number }) => {
    const a = f.arm * 0.32 + Math.sin(o.t * 2.3 + f.s * 40) * 0.1 + (o.wave ?? 0) * (f.s < 0.5 ? 1 : -1);
    const sx = h.x + f.arm * h.r * 1.5, sy = h.y + h.r * 2.1;
    const len = h.r * 4.6;
    return { sx, sy, ex: sx + Math.sin(a) * len, ey: sy - Math.cos(a) * len, a };
  };
  let i = 0;
  for (let b = 0; b < BANDS; b++) {
    const kEnd = b === BANDS - 1 ? Infinity : k0 + ((k1 - k0) * (b + 1)) / BANDS;
    let j = i;
    while (j < fans.length && fans[j]!.k < kEnd) j++;
    if (j === i) continue;
    const list = fans.slice(i, j);
    i = j;
    const kk = list[list.length >> 1]!.k;
    const fill = o.fill(kk);
    // full = false：只畫頭與肩膀的上緣（輪廓光用；身體的直邊不要亮，不然整排人像一塊塊墓碑）
    const shape = (ox: number, oy: number, col: string, full = true) => {
      c.fillStyle = col;
      c.beginPath();
      for (const f of list) {
        const h = head(f), r = h.r, x = h.x + ox, y = h.y + oy;
        c.moveTo(x + r, y);
        c.arc(x, y, r, 0, Math.PI * 2);
        // 肩膀（上緣圓）一路到腳
        const sw = r * 2.3, top = y + r * 1.55;
        c.moveTo(x - sw, top + r * 1.3);
        c.quadraticCurveTo(x - sw, top, x, top);
        c.quadraticCurveTo(x + sw, top, x + sw, top + r * 1.3);
        if (full) {
          c.lineTo(x + sw * 0.8, y + r * 7);
          c.lineTo(x + sw * 0.62, y + r * 15);
          c.lineTo(x - sw * 0.62, y + r * 15);
          c.lineTo(x - sw * 0.8, y + r * 7);
        }
        c.closePath();
      }
      c.fill();
      c.strokeStyle = col;
      c.lineCap = 'round';
      for (const f of list) {
        if (!f.arm) continue;
        const h = head(f), a = arm(f, h);
        c.lineWidth = Math.max(1.5, h.r * 0.95);
        c.beginPath(); c.moveTo(a.sx + ox, a.sy + oy); c.lineTo(a.ex + ox, a.ey + oy); c.stroke();
      }
    };
    if (o.rim) shape(Math.max(0.8, kk * 1.6), -Math.max(0.8, kk * 2), o.rim, false);
    shape(0, 0, fill);
    // 手上的東西：手燈的握把與球、手機；光由加亮層畫
    for (const f of list) {
      if (!f.arm || !f.prop) continue;
      const h = head(f), a = arm(f, h);
      if (f.prop === 'stick') {
        const hx = a.ex + Math.sin(a.a) * h.r * 1.4, hy = a.ey - Math.cos(a.a) * h.r * 1.4;
        c.strokeStyle = fill;
        c.lineWidth = Math.max(1, h.r * 0.35);
        c.beginPath(); c.moveTo(a.ex, a.ey); c.lineTo(hx, hy); c.stroke();
        const bx = hx + Math.sin(a.a) * h.r * 0.55, by = hy - Math.cos(a.a) * h.r * 0.55;
        if (o.lit) { c.fillStyle = o.lit; c.beginPath(); c.arc(bx, by, Math.max(1.2, h.r * 0.55), 0, Math.PI * 2); c.fill(); }
        lights.push({ x: bx, y: by, r: h.r, prop: 'stick', s: f.s, k: f.k });
      } else {
        c.fillStyle = fill;
        c.fillRect(a.ex - h.r * 0.5, a.ey - h.r * 1.5, h.r, h.r * 1.8);
        lights.push({ x: a.ex, y: a.ey - h.r * 1.2, r: h.r, prop: 'phone', s: f.s, k: f.k });
      }
    }
  }
  return lights;
}

// ---------------------------------------------------------------- 路人剪影
/**
 * 走路的路人剪影（散場的人潮、排隊的隊伍）：頭、軀幹、兩隻手兩隻腳（圓頭粗線），ph = 走路的相位（一步 = π），(x, y) 是腳底。
 * dir = 1 朝右、-1 朝左；bag：背一個包（側面的小方塊）。跟 _c8 的球員剪影一樣故意畫得簡單，不跟紙偶搶焦點。
 * under：畫在已經畫好的東西後面（destination-over）時傳 true，輪廓光要在身體之後畫，才只露出上緣一條。
 */
export function drawWalker(c: Ctx, x: number, y: number, h: number, ph: number, o: { fill: string; rim?: string; dir?: 1 | -1; bag?: boolean; stick?: boolean; under?: boolean }): Pt | null {
  const dir = o.dir ?? 1, s = Math.sin(ph);
  const leg = h * 0.47, hip = { x, y: y - leg - Math.abs(Math.cos(ph)) * h * 0.012 };
  const neck = { x: hip.x + dir * h * 0.02, y: hip.y - h * 0.3 };
  const at = (p: Pt, a: number, len: number): Pt => ({ x: p.x + Math.sin(a) * len * dir, y: p.y + Math.cos(a) * len });
  const body = (ox: number, oy: number, col: string) => {
    c.save();
    c.translate(ox, oy);
    c.strokeStyle = col; c.fillStyle = col;
    c.lineCap = 'round'; c.lineJoin = 'round';
    const line = (pts: Pt[], w: number) => { c.lineWidth = w; c.beginPath(); c.moveTo(pts[0]!.x, pts[0]!.y); for (const p of pts.slice(1)) c.lineTo(p.x, p.y); c.stroke(); };
    // 兩隻腳（膝蓋微彎）、兩隻手（跟腳反方向擺）
    // （站著不動時 s = 0：兩腳還是稍微分開、手稍微離開身體，不然會疊成一根柱子）
    for (const k of [1, -1]) {
      const a = 0.38 * k * s + 0.07 * k;
      const knee = at(hip, a, leg * 0.5);
      line([hip, knee, at(knee, a - 0.18 * Math.max(0, -k * s), leg * 0.5)], h * 0.075);
      const sh = { x: neck.x, y: neck.y + h * 0.03 };
      const aa = -0.4 * k * s - 0.12 * k;
      const el = at(sh, aa, h * 0.17);
      line([sh, el, at(el, aa + 0.25, h * 0.15)], h * 0.05);
    }
    line([hip, neck], h * 0.15);
    c.beginPath(); c.arc(neck.x + dir * h * 0.01, neck.y - h * 0.075, h * 0.062, 0, Math.PI * 2); c.fill();
    if (o.bag) c.fillRect(hip.x - dir * h * 0.13, hip.y - h * 0.2, h * 0.08, h * 0.13);
    c.restore();
  };
  if (o.under) { body(0, 0, o.fill); if (o.rim) body(0, -Math.max(1, h * 0.008), o.rim); }
  else { if (o.rim) body(0, -Math.max(1, h * 0.008), o.rim); body(0, 0, o.fill); }
  // 還沒關的手燈：舉在前面那隻手上（回傳球的位置，給加亮層）
  if (!o.stick) return null;
  const sh = { x: neck.x, y: neck.y + h * 0.03 };
  const hand = at(at(sh, 0.6, h * 0.17), 1.1, h * 0.15);
  c.strokeStyle = o.fill; c.lineWidth = Math.max(1, h * 0.02);
  const tip = { x: hand.x + dir * h * 0.02, y: hand.y - h * 0.09 };
  c.beginPath(); c.moveTo(hand.x, hand.y); c.lineTo(tip.x, tip.y); c.stroke();
  return tip;
}

// ---------------------------------------------------------------- 布（布條、毛巾）
/**
 * 一塊掛著字的布（應援布條、毛巾）：上緣被拉直（手抓著、或掛在護欄上），下緣隨風微微起伏；
 * 布面有很淡的直向皺褶（幾條明暗帶），四角各一顆小星星（T 恤同款的圖案，不是任何真實團體的標誌）。
 * (x, y) 左上角；unfurl 0..1：從上緣往下展開（開場）；wave：下緣起伏的量（px）；t 讓皺褶慢慢飄。
 * 回傳布面實際的下緣 y（展開中比較短）。
 */
export function cloth(c: Ctx, x: number, y: number, w: number, h: number, o: { fill: string; shade: string; edge: string; motif?: string; unfurl?: number; wave?: number; t: number; seed?: number; fringe?: boolean }): number {
  const u = clamp(o.unfurl ?? 1, 0, 1);
  const hh = h * u;
  if (hh < 2) return y;
  const wv = (o.wave ?? 4) * u, t = o.t, sd = o.seed ?? 1;
  const bottom = (px: number) => y + hh + Math.sin(px * 0.012 + t * 2.3 + sd) * wv + Math.sin(px * 0.031 - t * 1.7) * wv * 0.4;
  c.save();
  // 布面
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(x + w, y);
  const N = 24;
  for (let i = N; i >= 0; i--) { const px = x + (w * i) / N; c.lineTo(px, bottom(px)); }
  c.closePath();
  c.fillStyle = o.fill;
  c.fill();
  c.save();
  c.clip();
  // 皺褶：幾條很淡的直向暗帶（被兩隻手拉開的布，中間鬆、兩端緊）
  for (let k = 0; k < 7; k++) {
    const fx = x + w * (0.08 + 0.84 * hash(k, sd, 3)) + Math.sin(t * 0.8 + k) * 6;
    const fw = w * (0.03 + 0.05 * hash(k, sd, 5));
    const g = c.createLinearGradient(fx - fw, 0, fx + fw, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, o.shade);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(fx - fw, y, fw * 2, hh + wv * 2);
  }
  // 上緣摺邊的陰影
  const tg = c.createLinearGradient(0, y, 0, y + 16);
  tg.addColorStop(0, o.shade);
  tg.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = tg;
  c.fillRect(x, y, w, 16);
  // 四角的小星星
  if (o.motif && u > 0.9) {
    c.fillStyle = o.motif;
    const m = 22;
    for (const [sx, sy] of [[x + m, y + m + 4], [x + w - m, y + m + 4], [x + m, y + hh - m], [x + w - m, y + hh - m]] as const) { star(c, sx, sy, 9, 0.2); c.fill(); }
  }
  c.restore();
  // 邊線與流蘇
  c.strokeStyle = o.edge;
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(x, bottom(x)); c.lineTo(x, y); c.lineTo(x + w, y); c.lineTo(x + w, bottom(x + w));
  c.stroke();
  if (o.fringe) {
    c.beginPath();
    for (let px = x + 4; px < x + w; px += 9) { const by = bottom(px); c.moveTo(px, by); c.lineTo(px + Math.sin(t * 3 + px) * 2, by + 10 * u); }
    c.lineWidth = 1.2;
    c.stroke();
  }
  c.restore();
  return y + hh;
}

// ---------------------------------------------------------------- 雜項
/** 0..1 之間慢起慢停。 */
export const sine01 = (u: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(u));

/** 從 a 平滑地轉到 b：k 0..1（outCubic）。角度、位置都可以用。 */
export const toward = (a: number, b: number, k: number) => lerp(a, b, 1 - Math.pow(1 - clamp(k), 3));
