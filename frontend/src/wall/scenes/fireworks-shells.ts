// 煙火的「一發」：火箭升空、在空中爆開、星點組成字（或花形）、停住、再燒完往下飄。
// 全部是時間的純函數（沒有模擬狀態）：每顆星、每條火藥線的速度與壽命都由種子雜湊決定，
// 跟 pdoom 的 sparkParticles 一樣，任何一格單獨畫出來都一樣（截圖、跳播、動態模糊都對得上）。
//
// 字形煙火照真的「多段式」煙火：主殼在拍點上爆開（外圈一圈放射狀的火藥細線），同時朝每個字丟出一顆彗星；
// 彗星飛到那個字的位置再「啪」地開一朵小的造型煙火：星點在小殼裡就排成那個字，從字的中心等比例放大、被阻力煞住，
// 停下來剛好組成字（一整行從同一點放大會變成一條橫向的光束，不像煙火）。離中心越遠的字越晚開，一行字「啪啪啪」地展開。
// 星點本身不是字：真正讓人讀得到的是底下那層實心的字（Canvas2D），它跟著星點一起放大、從燒紅冷卻成紙白；
// 星點大部分在一秒內燒完，只留少數在字上閃（像金屬粉的爆裂聲）。結束時引信跑過（fireworks.ts），字燒掉的地方
// 火星像柳樹一樣垂下來（drawEmbers）。
import { LineBatch } from '../engine/lines';
import { LIN } from '../engine/palette';
import { font } from '../engine/type';
import { clamp, frameIdx, hash, mulberry32, TAU } from '../engine/util';
import { sparkHead, sparkParticles, heartPoints, drawHeart } from './_motifs';
import { HZ } from './fireworks-sky';

export type Kind = 'text' | 'peony' | 'ring' | 'willow' | 'heart';

/** 天上的一個字（已排好的絕對位置，y 是基線）。 */
export interface SkyGlyph {
  ch: string; x: number; y: number; w: number; size: number; fam: string;
  /** 愛心不用字型畫：用我們自己的 drawHeart（點綴色）。 */
  heart: boolean;
  /** 這個字開始燒完、往下飄的時間。 */
  tg: number;
  /** 這個字自己的中心與開花時間（主殼丟出的彗星飛到這裡的時候），planGlyphs() 算。 */
  cx: number; cy: number; tb: number;
  /** 韓文歌的原文副行：比中文安靜（淡兩成、燒紅的光小一半）。沒設 = 1。 */
  dim?: number;
}

export interface Shell {
  id: number;
  kind: Kind;
  /** 遠方的小煙火：畫在字的後面、比較暗、比較小（主打留言停留時用來保持畫面在動）。 */
  back: boolean;
  /** 亮度倍數。 */
  I: number;
  /** 點火（離開地平線）、爆開、開始燒完的時間。 */
  tl: number; tb: number; tf0: number;
  /** 點火的位置（地平線上的 x）與爆開的中心。 */
  lx: number; cx: number; cy: number;
  /** 外圈火藥線飛多遠（px）。 */
  R: number;
  /** 星點從中心放大到定位要多久（秒）：整個圖形（愛心）用 T，每個字自己開花用 Tg。 */
  T: number;
  Tg: number;
  glyphs: SkyGlyph[];
  /** 星點（延遲取樣）：每顆 8 個數：x, y, 第幾個字, h1..h3, jx, jy。 */
  stars: Float32Array | null;
  starBudget: number;
  /** 字燒紅時的光有多強（粗黑的歌詞字墨多，光要收一點）。 */
  glow: number;
  /** 字的外框（避開用）。 */
  box: { x0: number; y0: number; x1: number; y1: number };
}

export const STRIDE = 8;

// ---------------------------------------------------------------- 顏色（全部來自色票）
/** 共用的暫存顏色陣列：LineBatch.seg2 當場就把數值抄走，不用每顆星配置一個新陣列。 */
const C: [number, number, number] = [0, 0, 0];
/**
 * 火藥的顏色：heat 1 = 白熱（ember 往紙白混）、0.5 = 訊號色、0 = 訊號色的暗部（blood）。
 * `rose`：愛心的星點用點綴色取代訊號色。乘上 I 之後大於 ~0.92 的部分才會發光。
 */
function fire(heat: number, I: number, rose = false): [number, number, number] {
  const s = rose ? LIN.rose : LIN.signal, e = LIN.ember, b = LIN.bone, d = LIN.blood;
  if (heat > 0.5) {
    const k = (heat - 0.5) * 2;
    for (let i = 0; i < 3; i++) C[i] = (s[i]! * 2.3 * (1 - k) + (e[i]! * 0.5 + b[i]! * 0.5) * 3.4 * k) * I;
  } else {
    const k = heat * 2;
    for (let i = 0; i < 3; i++) C[i] = (d[i]! * 0.9 * (1 - k) + s[i]! * 2.3 * k) * I;
  }
  return C;
}
function tone(key: 'bone' | 'ember', m: number): [number, number, number] {
  const v = LIN[key];
  C[0] = v[0] * m; C[1] = v[1] * m; C[2] = v[2] * m;
  return C;
}

/** 爆開後的放大量（0→1）：空氣阻力讓它一開始很快、最後停住，T 秒時到位。 */
export const expand = (tau: number, T: number) => (tau <= 0 ? 0 : tau >= T ? 1 : (1 - Math.exp((-4.2 * tau) / T)) / (1 - Math.exp(-4.2)));

/**
 * 每個字的中心與開花時間：彗星從主殼中心飛過去，距離越遠越晚到（最遠的約 0.6 秒），
 * 所以一行字從中間往兩邊一個個開。
 */
export function planGlyphs(s: Shell) {
  for (const [i, g] of s.glyphs.entries()) {
    g.cx = g.x + g.w / 2; g.cy = g.y - g.size * 0.38;
    const d = Math.hypot(g.cx - s.cx, g.cy - s.cy);
    g.tb = s.tb + 0.07 + 0.5 * Math.min(1, d / 720) ** 0.85 + hash(i, s.id, 13) * 0.04;
  }
}

/**
 * 主殼丟向第 g 個字的彗星（u：0 = 主殼中心、1 = 到了）：先快後慢，沿一條彎的路線（二次貝茲，往上或往下拱）。
 * 彎的方向每顆不同，爆開的一瞬間彗星往四面八方散開（像一朵菊花），不會變成一條橫的光棒。
 */
function cometAt(s: Shell, g: SkyGlyph, u: number) {
  const e = 1 - (1 - u) * (1 - u);
  const dx = g.cx - s.cx, dy = g.cy - s.cy, d = Math.hypot(dx, dy) || 1;
  const off = (hash(g.x, s.id, 14) < 0.5 ? -1 : 1) * Math.min(d * (0.25 + 0.35 * hash(g.x, s.id, 15)), 120);
  const px = s.cx + dx * 0.5 - (dy / d) * off, py = s.cy + dy * 0.5 + (dx / d) * off;
  const v = 1 - e;
  return { x: v * v * s.cx + 2 * v * e * px + e * e * g.cx, y: v * v * s.cy + 2 * v * e * py + e * e * g.cy };
}

/** 彗星：一顆小火花拖著一條細線飛向它的字；到的那一下「啪」地閃一下。 */
export function drawComets(lb: LineBatch, s: Shell, t: number) {
  if (t < s.tb) return;
  for (const g of s.glyphs) {
    if (t > g.tb + 0.12) continue;
    const D = Math.max(0.02, g.tb - s.tb);
    if (t < g.tb) {
      const u = (t - s.tb) / D, u0 = Math.max(0, u - 0.4);
      // 剛出發時十幾顆擠在中心：先淡淡的，散開了才全亮（不然中心會疊成一團過曝的白）
      const f = Math.min(1, u * 5);
      let prev = cometAt(s, g, u0);
      for (let j = 1; j <= 6; j++) {
        const q = cometAt(s, g, u0 + ((u - u0) * j) / 6), k = j / 6;
        lb.seg2(prev.x, prev.y, q.x, q.y, 0.8 + 0.7 * k, fire(0.4 + 0.4 * k, s.I * (0.5 + 0.5 * k)), (0.15 + 0.85 * k) * f);
        prev = q;
      }
      lb.seg2(prev.x, prev.y, prev.x + 0.01, prev.y, 3.2, fire(0.95, s.I), f);
    } else {
      const k = 1 - (t - g.tb) / 0.12;
      sparkHead(lb, g.cx, g.cy, t, 0.9 * k, s.I * k);
    }
  }
}

// ---------------------------------------------------------------- 取樣：字 → 星點
let scratch: CanvasRenderingContext2D | null = null;

/** 愛心的寬度（跟字型的 ♥ 一樣大小，但形狀用我們自己的）。 */
export const heartW = (g: SkyGlyph) => Math.min(g.size * 0.82, g.w * 1.04);
/** Canvas2D：在字的位置畫一顆愛心。 */
export function drawGlyphHeart(c: CanvasRenderingContext2D, g: SkyGlyph, fill: string) {
  drawHeart(c, g.x + g.w / 2, g.y - g.size * 0.5, heartW(g), fill);
}

/**
 * 把一發的字光柵化、在字裡面均勻（抖動格點）取 `budget` 顆左右的星。
 * 一發只開一張暫存畫布、讀一次像素；延遲到第一次要畫時才做，一晚幾百個窗格也不會在 init 卡住。
 */
export function sampleStars(s: Shell, seed: number): Float32Array {
  const rnd = mulberry32(seed);
  const out: number[] = [];
  const push = (x: number, y: number, gi: number) => out.push(x, y, gi, rnd(), rnd(), rnd(), rnd() - 0.5, rnd() - 0.5);
  if (s.kind === 'heart') {
    // 愛心煙火：星點排在我們那顆愛心的輪廓上（外加一圈內輪廓，讓形狀厚一點）
    for (const [n, k] of [[64, 1], [40, 0.62]] as const) {
      for (const p of heartPoints(n).slice(0, n)) push(s.cx + p.x * s.R * k, s.cy + (p.y - 0.32) * s.R * k, -1);
    }
    return new Float32Array(out);
  }
  if (!s.glyphs.length) return new Float32Array(0);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const g of s.glyphs) {
    x0 = Math.min(x0, g.x - 6); x1 = Math.max(x1, g.x + g.w + 6);
    y0 = Math.min(y0, g.y - g.size * 1.08); y1 = Math.max(y1, g.y + g.size * 0.32);
  }
  const w = Math.ceil(x1 - x0), h = Math.ceil(y1 - y0);
  if (!scratch) scratch = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  const c = scratch;
  if (c.canvas.width < w || c.canvas.height < h) { c.canvas.width = Math.max(c.canvas.width, w); c.canvas.height = Math.max(c.canvas.height, h); }
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, w, h);
  c.translate(-x0, -y0);
  c.fillStyle = '#fff';
  c.textBaseline = 'alphabetic';
  for (const g of s.glyphs) {
    if (g.heart) { drawGlyphHeart(c, g, '#fff'); continue; }
    c.font = font(g.fam, g.size);
    c.fillText(g.ch, g.x, g.y);
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  const data = c.getImageData(0, 0, w, h).data;
  let ink = 0;
  for (let y = 1; y < h; y += 3) for (let x = 1; x < w; x += 3) if (data[(y * w + x) * 4 + 3]! > 128) ink++;
  const step = Math.max(2.4, Math.sqrt((ink * 9) / Math.max(1, s.starBudget)));
  for (let y = step / 2; y < h; y += step) {
    for (let x = step / 2; x < w; x += step) {
      const jx = x + (rnd() - 0.5) * step * 0.9, jy = y + (rnd() - 0.5) * step * 0.9;
      const ix = Math.round(jx), iy = Math.round(jy);
      if (ix < 0 || iy < 0 || ix >= w || iy >= h || data[(iy * w + ix) * 4 + 3]! <= 128) continue;
      const px = jx + x0, py = jy + y0;
      // 這顆星屬於哪個字：同一行（基線附近）裡 x 落在它的寬度內
      let gi = 0, best = Infinity;
      for (let k = 0; k < s.glyphs.length; k++) {
        const g = s.glyphs[k]!;
        const dy = py > g.y + g.size * 0.3 ? py - g.y : py < g.y - g.size * 1.05 ? g.y - g.size - py : 0;
        const dx = px < g.x ? g.x - px : px > g.x + g.w ? px - g.x - g.w : 0;
        const d = dx + dy * 4;
        if (d < best) { best = d; gi = k; }
        if (d === 0) break;
      }
      push(px, py, gi);
    }
  }
  return new Float32Array(out);
}

// ---------------------------------------------------------------- 火箭
/** 火箭在升空路上的位置（u：0 = 地平線、1 = 爆開的點）。往上越來越慢，路線微微彎。 */
export function rocketAt(s: Shell, u: number) {
  const up = 1 - (1 - u) ** 2.2;
  return {
    x: s.lx + (s.cx - s.lx) * (up * 0.8 + u * 0.2) + Math.sin(u * 7 + s.id * 1.7) * 3.5 * (1 - u),
    y: HZ + (s.cy - HZ) * up,
  };
}

/**
 * 火箭：拖著一條細線上升（前端燒紅、尾巴淡掉），邊走邊掉火星；點火那一下地平線上閃一顆。
 * 爆開後留下一條煙（很淡的細線，被風吹歪、慢慢斷成一段段）。回傳火箭頭的位置（還在升空時）。
 */
export function drawRocket(lb: LineBatch, s: Shell, t: number): { x: number; y: number } | null {
  if (t < s.tl) return null;
  const D = Math.max(0.05, s.tb - s.tl), I = s.I, sc = s.back ? 0.6 : 1;
  if (t < s.tb) {
    const u = (t - s.tl) / D, u0 = Math.max(0, u - 0.5);
    let prev = rocketAt(s, u0);
    const n = 12;
    for (let j = 1; j <= n; j++) {
      const q = rocketAt(s, u0 + ((u - u0) * j) / n), k = j / n;
      const hot = k * k * k;
      const cc = hot > 0.3 ? fire(0.35 + hot * 0.4, I * (0.4 + 0.6 * hot)) : tone('bone', 0.5 * I);
      lb.seg2(prev.x, prev.y, q.x, q.y, (0.9 + 0.6 * hot) * sc, cc, (0.15 + 0.85 * k) * Math.min(1, u * 8));
      prev = q;
    }
    const head = rocketAt(s, u);
    sparkHead(lb, head.x, head.y, t, 0.6 * sc, I);
    // 點火：地平線上一下亮光
    const ig = 1 - (t - s.tl) / 0.22;
    if (ig > 0) sparkHead(lb, s.lx, HZ - 1, t, 1.5 * sc * ig, I * ig);
  } else {
    // 煙：整條路線，風把上半部吹偏，越舊越斷
    const age = t - s.tb, life = 2.4;
    if (age < life) {
      const k = 1 - age / life;
      const n = 18;
      let prev = rocketAt(s, 0);
      for (let j = 1; j <= n; j++) {
        const u = j / n, q = rocketAt(s, u);
        const qx = q.x + age * 16 * u + Math.sin(age * 1.3 + u * 5 + s.id) * 5 * age * u;
        if (hash(j, s.id, 5) > age / life * 1.3) lb.seg2(prev.x, prev.y, qx, q.y, 1.1 + age * 0.8, tone('bone', 0.13 * I), k * k * (0.3 + 0.7 * u));
        prev = { x: qx, y: q.y };
      }
    }
  }
  // 火星：沿著升空路線出生（出生時間 → 位置，所以爆開之後已經噴出去的還會落完）
  if (t < s.tb + 0.5) {
    sparkParticles(lb, t, (tb) => (tb >= s.tl && tb <= s.tb ? rocketAt(s, (tb - s.tl) / D) : null), {
      rate: s.back ? 60 : 140, life: 0.42, speed: s.back ? 60 : 95, gravity: 380, seed: s.id * 17 + 3, width: 1.2 * sc, intensity: I * (s.back ? 0.6 : 1),
    });
  }
  return t < s.tb ? rocketAt(s, (t - s.tl) / D) : null;
}

/** 煙火都在城市後面的遠方：快落到地平線時燒完，不會掉進水裡。 */
const above = (y: number) => clamp((HZ - 14 - y) / 60);

// ---------------------------------------------------------------- 爆開：外圈的火藥線
/** 外圈的火藥線：真的彈道（阻力＋重力），拖一小段尾巴，燒完的時候一部分會「啪」地閃一下。 */
export function drawCrown(lb: LineBatch, s: Shell, t: number) {
  const tau = t - s.tb;
  if (tau < 0 || tau > 3) return;
  const willow = s.kind === 'willow', ring = s.kind === 'ring';
  const N = s.kind === 'text' ? (s.back ? 0 : 44) : s.kind === 'heart' ? 26 : willow ? 44 : ring ? 60 : s.back ? 46 : 80;
  // 下落：被空氣托住，很快就到終端速度（柳樹型的慢慢垂下來，不會一路掉進水裡）
  const td = willow ? 0.5 : 0.3, vt = willow ? 130 : 70, tg = willow ? 0.55 : 0.4;
  const lifeBase = willow ? 1.9 : s.kind === 'text' ? 0.75 : 1.0, lifeVar = willow ? 0.8 : 0.6;
  const trail = willow ? 0.42 : 0.13;
  const tilt = ring ? 0.35 + 0.5 * hash(s.id, 11) : 1, rot = hash(s.id, 12) * TAU;
  const I = s.I * (s.back ? 0.7 : 1), W0 = s.back ? 1 : 1.35;
  // 環形煙火：星點排在一個圓上、速度一樣，看起來是一個斜斜的橢圓環（從側面看的圓）
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const pos = (a: number, sp: number, tt: number) => {
    const tx = Math.max(0, tt);
    const r = s.R * sp * (1 - Math.exp(-tx / td));
    let ex = Math.cos(a) * r, ey = Math.sin(a) * r;
    if (ring) { ey *= tilt; const rx = ex * cr - ey * sr; ey = ex * sr + ey * cr; ex = rx; }
    return { x: s.cx + ex, y: s.cy + ey + vt * (tx - tg * (1 - Math.exp(-tx / tg))) };
  };
  for (let j = 0; j < N; j++) {
    const h1 = hash(j, s.id, 1), h2 = hash(j, s.id, 2);
    const life = lifeBase + lifeVar * h2;
    if (tau > life + 0.06) continue;
    const a = ((j + 0.5 + (h1 - 0.5) * (ring ? 0.1 : 0.7)) / N) * TAU;
    const sp = ring ? 1 : 0.62 + 0.5 * hash(j, s.id, 3);
    const k = clamp(1 - tau / life);
    if (tau <= life) {
      const heat = willow ? 0.25 + 0.4 * k : 0.15 + 0.85 * k * k;
      // 剛爆開的前幾格：幾十條線都從中心出發、疊在一起，先壓暗（跟 drawStars 一樣，光攤在整條線上）
      const fade = Math.min(1, (life - tau) / 0.3) * Math.min(1, tau / 0.06 + 0.15);
      let prev = pos(a, sp, tau - trail);
      for (let q = 1; q <= 3; q++) {
        const cur = pos(a, sp, tau - trail + (trail * q) / 3);
        const spread = Math.min(1, 14 / Math.max(14, Math.hypot(cur.x - prev.x, cur.y - prev.y)));
        lb.seg2(prev.x, prev.y, cur.x, cur.y, W0 * (0.55 + 0.25 * q), fire(heat * (0.6 + 0.13 * q), I), fade * (0.25 + 0.25 * q) * above(cur.y) * (0.35 + 0.65 * spread));
        prev = cur;
      }
    }
    // 燒完的那一下：一部分的星「啪」地亮一下（爆裂聲的樣子）
    if (!willow && h2 > 0.62 && tau > life - 0.02 && tau < life + 0.06) {
      const p = pos(a, sp, life);
      lb.seg2(p.x, p.y, p.x + 0.01, p.y, 3.2 * W0, tone('ember', 3 * I), 1 - (tau - life + 0.02) / 0.08);
    }
  }
  // 爆開的那一瞬：中心一團白熱
  if (tau < 0.14) sparkHead(lb, s.cx, s.cy, t, (s.back ? 1.1 : 1.7) * (1 - tau / 0.14), I);
}

// ---------------------------------------------------------------- 星點（組成字或愛心）
/**
 * 星點：從字的中心等比例放大到定位（拖著放射狀的細線），大部分在一秒內燒完；
 * 少數（約一成）留在字上，偶爾閃一下（跟著 hi-hat）。開始燒完的字就不畫星點（交給 drawEmbers）。
 */
export function drawStars(lb: LineBatch, s: Shell, t: number, hat: number) {
  const st = s.stars;
  if (!st || t < s.tb) return;
  const I = s.I, rose = s.kind === 'heart';
  const flick = Math.floor(frameIdx(t) / 3);
  const gl = s.glyphs;
  for (let i = 0; i < st.length; i += STRIDE) {
    const gi = st[i + 2]!;
    const g = gi >= 0 ? gl[gi] : undefined;
    if (g ? t >= g.tg : t >= s.tf0) continue;
    // 字：從這個字自己的中心開花；愛心：整個圖形從主殼中心放大
    const ox = g ? g.cx : s.cx, oy = g ? g.cy : s.cy, T = g ? s.Tg : s.T;
    const h1 = st[i + 3]!, h2 = st[i + 4]!, h3 = st[i + 5]!;
    const ts = t - (g ? g.tb : s.tb) - h1 * 0.04;
    if (ts <= 0) continue;
    const x = st[i]!, y = st[i + 1]!;
    const heart = rose || !!g?.heart;
    const end = T * 0.85 + 0.12 + h2 * 0.95;
    if (ts < end) {
      const e = expand(ts, T), e0 = expand(ts - 0.03, T);
      const J = g ? g.size * 0.45 : 70;
      const jit = J * (1 - e) * (1 - e), jit0 = J * (1 - e0) * (1 - e0);
      const jx = st[i + 6]!, jy = st[i + 7]!;
      const px = ox + (x - ox) * e + jx * jit, py = oy + (y - oy) * e + jy * jit;
      const qx = ox + (x - ox) * e0 + jx * jit0, qy = oy + (y - oy) * e0 + jy * jit0;
      // 剛爆開時幾百顆星擠在同一點：用加亮疊起來會變成一團白光（整個畫面被 bloom 洗白），
      // 所以星的亮度跟著圖形放大慢慢出來，散開了才是全亮
      // 動態模糊的細線：同一顆星的光攤在整條線上（線越長每一點越暗），不然幾百條線疊起來會過曝
      const len = Math.hypot(px - qx, py - qy);
      const k = (1 - clamp((ts - (end - 0.35)) / 0.35)) * clamp((e - 0.08) / 0.55) * Math.min(1, 9 / Math.max(9, len));
      if (k <= 0.01) continue;
      const heat = 1 - clamp(ts / (T * 1.4));
      lb.seg2(qx, qy, px, py, 1.4 + 0.9 * e, fire(0.32 + 0.4 * heat, I * (0.7 + 0.3 * k), heart), k);
    } else if (h3 < 0.14 && ts > end + 0.2) {
      // 金屬粉的閃光：留在字上、隨機閃，hi-hat 一打就多閃幾顆
      if (hash(flick, i, s.id) < 0.07 + 0.35 * hat) lb.seg2(x, y, x + 0.01, y, 3, heart ? fire(0.75, I, true) : tone('ember', 3.2 * I), 0.95);
    }
  }
}

// ---------------------------------------------------------------- 燒完、往下飄
/** 一顆火星往下飄的位置：一開始微微往上彈，然後被空氣托著慢慢落（終端速度），左右輕輕晃。 */
function emberAt(x: number, y: number, jx: number, jy: number, tau: number) {
  const vt = 125 + 110 * jy, td = 0.8;
  return {
    x: x + jx * 90 * tau * Math.exp(-tau / 1.2) + Math.sin(tau * 2.3 + jx * 20) * 9 * tau,
    y: y + vt * (tau - td * (1 - Math.exp(-tau / td))) - (25 + 30 * jy) * tau * Math.exp(-tau / 0.35),
  };
}

/**
 * 燒完的字掉下來的火星（柳樹垂下來那樣的細線），外加停留期間偶爾滴下的一兩顆。
 * `frac`：多少比例的星會變成火星（長留言要少一點，不然整片都是）。
 */
export function drawEmbers(lb: LineBatch, s: Shell, t: number, frac: number) {
  const st = s.stars;
  if (!st) return;
  const I = s.I, gl = s.glyphs, rose = s.kind === 'heart';
  for (let i = 0; i < st.length; i += STRIDE) {
    const h1 = st[i + 3]!;
    if (h1 >= frac) continue;
    const gi = st[i + 2]!;
    const g = gi >= 0 ? gl[gi] : undefined;
    const t0 = (g ? g.tg : s.tf0) + st[i + 4]! * 0.25;
    const tau = t - t0, life = 1.1 + st[i + 5]! * 1.3;
    if (tau < 0 || tau > life) continue;
    emberTrail(lb, st[i]!, st[i + 1]!, st[i + 6]!, st[i + 7]!, tau, life, I, rose || !!g?.heart);
  }
  // 停留期間：每 0.3 秒左右有一顆從字上滴下來（字是「燒著的」，不是貼上去的）
  const n = st.length / STRIDE;
  if (n === 0 || s.kind === 'heart') return;
  const t0 = s.tb + s.Tg + 1.4, per = 0.22;
  const k1 = Math.floor((t - t0) / per), k0 = Math.max(0, k1 - 6);
  for (let k = k0; k <= k1; k++) {
    const tk = t0 + k * per + hash(k, s.id, 21) * per;
    const tau = t - tk;
    const i = Math.floor(hash(k, s.id, 22) * n) * STRIDE;
    const gi = st[i + 2]!, g = gl[gi];
    if (tau < 0 || tau > 1.3 || (g && tk >= g.tg)) continue;
    emberTrail(lb, st[i]!, st[i + 1]!, st[i + 6]! * 0.4, st[i + 7]!, tau, 1.3, I * 0.85, !!g?.heart);
  }
}

function emberTrail(lb: LineBatch, x: number, y: number, jx: number, jy: number, tau: number, life: number, I: number, rose: boolean) {
  const k = 1 - tau / life;
  const a = emberAt(x, y, jx, jy, tau), b = emberAt(x, y, jx, jy, Math.max(0, tau - 0.12)), c = emberAt(x, y, jx, jy, Math.max(0, tau - 0.4));
  const f = above(a.y);
  if (f <= 0) return;
  lb.seg2(b.x, b.y, a.x, a.y, 1.3, fire(0.2 + 0.6 * k, I, rose), Math.min(1, k * 1.6) * f);
  lb.seg2(c.x, c.y, b.x, b.y, 0.9, fire(0.1 + 0.35 * k, I, rose), k * 0.45 * f);
}
