// 煙火版面的「場景」：夜空、地平線、遠方的城市輪廓（細線版畫）、水面倒影。
// 城市輪廓是固定的（同一個種子，每個窗格都一樣，像同一個港口），只在模組層算一次；
// 每一格只決定亮度：遠方的窗、橋上的燈、塔頂的航空燈（踩在小節線上閃），被煙火照到的地方會亮一點。
// 天空與水面是一個全螢幕 shader：天空的煙只在爆開過的地方出現、被閃光照亮；水面取樣「火花那一層」的倒影，
// 被波紋打碎成一段一段（只有火花與城市會倒映，字不會：倒過來的字只會干擾閱讀）。
import * as THREE from 'three';
import { FSPass, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { LIN } from '../engine/palette';
import { mulberry32, hash, TAU, clamp } from '../engine/util';

/** 地平線的 y（y 向下）。水面在它下面，歌詞寫在水面上方那條帶子裡。 */
export const HZ = 800;

/** 一盞會照亮天空與城市的光（煙火爆開的閃光、上升中的火箭）。 */
export interface Light { x: number; y: number; k: number; r: number }

// ---------------------------------------------------------------- 城市輪廓（模組層算一次）
interface Skyline {
  /** 靜態細線：x0, y0, x1, y1, 亮度 */
  edges: number[];
  /** 窗：x, y, 亮度, 相位（慢慢忽明忽暗用） */
  wins: number[];
  /** 橋上的燈 */
  deck: number[];
  beacon: { x: number; y: number };
  wheel: { x: number; y: number; r: number };
}

let SKY: Skyline | null = null;

function buildSkyline(): Skyline {
  const rnd = mulberry32(20270313);
  const edges: number[] = [], wins: number[] = [], deck: number[] = [];
  const seg = (x0: number, y0: number, x1: number, y1: number, a = 1) => edges.push(x0, y0, x1, y1, a);
  // 高度輪廓：市中心（x≈900）比較高，兩側低；摩天輪那一段（x 470～680）是低矮的碼頭，橋那一段（1180～1760）是水
  const zoneH = (x: number) => 14 + 46 * Math.exp(-(((x - 930) / 260) ** 2)) + 10 * Math.exp(-(((x - 250) / 160) ** 2));
  let x = -12, prevTop = HZ;
  let tallest = { x: 0, y: HZ };
  while (x < W + 12) {
    if (x > 1176 && x < 1764) { // 橋：先收回地平線，跳到橋的另一端
      seg(x, prevTop, x, HZ, 0.9); prevTop = HZ; x = 1764; continue;
    }
    const pier = x > 470 && x < 690;
    const w = pier ? 14 + rnd() * 18 : 18 + rnd() * 64;
    let h = pier ? 6 + rnd() * 10 : zoneH(x) * (0.55 + rnd() * 0.75);
    // 市中心偶爾一棟高樓
    const tower = !pier && x > 760 && x < 1120 && rnd() < 0.22;
    if (tower) h = 86 + rnd() * 44;
    const x1 = Math.min(x + w, x > 1100 && x < 1176 ? 1176 : x + w);
    const top = HZ - h;
    seg(x, prevTop, x, top, 1); // 輪廓：往上（或往下）接到這棟的屋頂
    // 屋頂：平頂、退縮的頂樓、或斜頂
    const r = rnd();
    let roof = top, rx0 = x, rx1 = x1; // 天線立在最高的那一層屋頂上
    if (!pier && r < 0.28 && x1 - x > 30) {
      const inset = (x1 - x) * (0.2 + rnd() * 0.15), hh = 6 + rnd() * 12;
      seg(x, top, x + inset, top, 1); seg(x + inset, top, x + inset, top - hh, 1);
      seg(x + inset, top - hh, x1 - inset, top - hh, 1); seg(x1 - inset, top - hh, x1 - inset, top, 1);
      seg(x1 - inset, top, x1, top, 1);
      roof = top - hh; rx0 = x + inset; rx1 = x1 - inset;
    } else if (!pier && r < 0.4) {
      const peak = 6 + rnd() * 10;
      seg(x, top, (x + x1) / 2, top - peak, 1); seg((x + x1) / 2, top - peak, x1, top, 1);
      roof = top - peak; rx0 = rx1 = (x + x1) / 2;
    } else seg(x, top, x1, top, 1);
    // 天線：高樓一定有，其他偶爾
    if (tower || (!pier && rnd() < 0.12)) {
      const ax = rx0 + (rx1 - rx0) * (0.3 + rnd() * 0.4), ah = tower ? 22 + rnd() * 20 : 8 + rnd() * 10;
      seg(ax, roof, ax, roof - ah, 0.8);
      if (roof - ah < tallest.y) tallest = { x: ax, y: roof - ah };
    }
    // 樓與樓之間的直線（淡一點，版畫的層次）
    if (!pier) seg(x1, top, x1, HZ, 0.35);
    // 窗：格子，只有一小部分亮著
    if (!pier) {
      for (let wy = top + 7; wy < HZ - 4; wy += 7 + (h > 80 ? 1 : 0)) {
        for (let wx = x + 4; wx < x1 - 3; wx += 6) {
          if (rnd() < (tower ? 0.16 : 0.09)) wins.push(wx, wy, 0.4 + rnd() * 0.6, rnd());
        }
      }
    }
    prevTop = top;
    x = x1;
  }
  // 懸索橋：兩座塔、主纜（兩段拋物線）、吊索、橋面與橋燈
  const dy = HZ - 22, t1 = 1312, t2 = 1628, th = HZ - 124, x0 = 1182, x3 = 1760;
  seg(x0, dy, x3, dy, 1.1); seg(x0, dy + 5, x3, dy + 5, 0.45);
  for (const tx of [t1, t2]) {
    seg(tx - 4, HZ, tx - 4, th, 1); seg(tx + 4, HZ, tx + 4, th, 1);
    seg(tx - 4, th + 16, tx + 4, th + 16, 0.8); seg(tx - 4, th + 52, tx + 4, th + 52, 0.6); seg(tx - 4, th, tx + 4, th, 0.8);
  }
  const cable = (xa: number, ya: number, xb: number, yb: number, sag: number) => {
    let px = xa, py = ya;
    for (let i = 1; i <= 24; i++) {
      const u = i / 24, cx = xa + (xb - xa) * u, cy = ya + (yb - ya) * u + sag * 4 * u * (1 - u);
      seg(px, py, cx, cy, 0.8);
      px = cx; py = cy;
    }
  };
  cable(x0, dy - 2, t1, th + 2, 18); cable(t1, th + 2, t2, th + 2, 96); cable(t2, th + 2, x3, dy - 2, 18);
  // 吊索：從主纜垂到橋面
  const cableY = (xx: number) => {
    if (xx < t1) { const u = (xx - x0) / (t1 - x0); return dy - 2 + (th + 2 - (dy - 2)) * u + 18 * 4 * u * (1 - u); }
    if (xx < t2) { const u = (xx - t1) / (t2 - t1); return th + 2 + 96 * 4 * u * (1 - u); }
    const u = (xx - t2) / (x3 - t2); return th + 2 + (dy - 2 - (th + 2)) * u + 18 * 4 * u * (1 - u);
  };
  for (let xx = x0 + 14; xx < x3 - 6; xx += 13) if (Math.abs(xx - t1) > 7 && Math.abs(xx - t2) > 7) seg(xx, cableY(xx), xx, dy, 0.28);
  for (let xx = x0 + 10; xx < x3; xx += 22) deck.push(xx, dy - 1);
  return { edges, wins, deck, beacon: tallest, wheel: { x: 580, y: HZ - 84, r: 66 } };
}

/**
 * 畫城市：細線輪廓（被煙火照到會亮）、窗、橋燈、慢慢轉的摩天輪、塔頂的航空燈（小節線上閃）。
 * `reveal`：開場時地平線的火花畫到哪（x），還沒畫到的地方不出現。`lit(x, y)` 是天上的光照到這一點的量。
 */
export function drawSkyline(lb: LineBatch, t: number, reveal: number, alpha: number, downbeat: number, lit: (x: number, y: number) => number) {
  const S = (SKY ??= buildSkyline());
  const b = LIN.bone, e = LIN.ember, s = LIN.signal;
  const shown = (x: number) => clamp((reveal - x) / 160) * alpha;
  const E = S.edges;
  for (let i = 0; i < E.length; i += 5) {
    const x0 = E[i]!, y0 = E[i + 1]!, x1 = E[i + 2]!, y1 = E[i + 3]!, a = E[i + 4]!;
    const k = shown(Math.max(x0, x1));
    if (k <= 0) continue;
    const L = 0.16 + 0.9 * lit((x0 + x1) / 2, (y0 + y1) / 2);
    lb.seg2(x0, y0, x1, y1, 1, [b[0] * L, b[1] * L, b[2] * L], a * k);
  }
  // 窗：很淡的暖光，每一扇自己慢慢呼吸（相位不同）
  const Wn = S.wins;
  for (let i = 0; i < Wn.length; i += 4) {
    const x = Wn[i]!, y = Wn[i + 1]!, lv = Wn[i + 2]!, ph = Wn[i + 3]!;
    const k = shown(x);
    if (k <= 0) continue;
    const on = 0.55 + 0.45 * Math.sin(t * (0.3 + ph * 0.5) + ph * TAU);
    const I = 0.22 * lv * on;
    lb.seg2(x, y, x + 1.6, y, 1.5, [e[0] * I, e[1] * I, e[2] * I], k);
  }
  // 橋燈：一串小亮點，像項鍊
  const D = S.deck;
  for (let i = 0; i < D.length; i += 2) {
    const x = D[i]!, k = shown(x);
    if (k <= 0) continue;
    const I = 0.5 + 0.2 * Math.sin(t * 1.3 + i);
    lb.seg2(x, D[i + 1]!, x + 0.01, D[i + 1]!, 2.2, [e[0] * I, e[1] * I, e[2] * I], k);
  }
  // 摩天輪：外圈、輻條、車廂，很慢地轉（一圈約 50 秒）
  const wh = S.wheel, wk = shown(wh.x + wh.r);
  if (wk > 0) {
    const rot = t * 0.125, L = 0.16 + 0.9 * lit(wh.x, wh.y);
    const rim: [number, number, number] = [b[0] * L, b[1] * L, b[2] * L];
    const n = 40;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU;
      lb.seg2(wh.x + Math.cos(a0) * wh.r, wh.y + Math.sin(a0) * wh.r, wh.x + Math.cos(a1) * wh.r, wh.y + Math.sin(a1) * wh.r, 1, rim, 0.9 * wk);
    }
    for (let i = 0; i < 14; i++) {
      const a = rot + (i / 14) * TAU, cx = wh.x + Math.cos(a) * wh.r, cy = wh.y + Math.sin(a) * wh.r;
      lb.seg2(wh.x, wh.y, cx, cy, 0.8, rim, 0.35 * wk);
      // 車廂的燈：只有一半亮著
      if (hash(i, 7) < 0.6) lb.seg2(cx, cy + 3, cx + 0.01, cy + 3, 2.4, [e[0] * 0.45, e[1] * 0.45, e[2] * 0.45], wk);
    }
    lb.seg2(wh.x, wh.y, wh.x - 34, HZ, 1, rim, 0.8 * wk); lb.seg2(wh.x, wh.y, wh.x + 34, HZ, 1, rim, 0.8 * wk);
  }
  // 航空燈：塔頂一顆訊號色的點，踩在每個小節線上亮一下
  const bc = S.beacon, bk = shown(bc.x);
  if (bk > 0) {
    const I = 0.35 + 2.4 * downbeat;
    lb.seg2(bc.x, bc.y - 2, bc.x + 0.01, bc.y - 2, 3 + 2 * downbeat, [s[0] * I, s[1] * I, s[2] * I], bk);
  }
}

// ---------------------------------------------------------------- 天空與水面（全螢幕 shader）
export const SKY_PASS = () => new FSPass(/* glsl */ `
  uniform float t; uniform float k; uniform float hx; uniform float yh;
  uniform vec4 L[4];      // 閃光：x, y（y 向下）, 強度, 半徑
  uniform vec4 S[4];      // 煙：x, y, 濃度, 半徑
  uniform sampler2D refl; // 火花與城市那一層（半解析度），水面取樣它的倒影
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float lit = 0.0, smk = 0.0;
    for (int i = 0; i < 4; i++) {
      vec2 d = p - L[i].xy; lit += L[i].z * exp(-dot(d, d) / (L[i].w * L[i].w));
      vec2 e = p - S[i].xy; smk += S[i].z * exp(-dot(e, e) / (S[i].w * S[i].w));
    }
    vec3 col;
    if (p.y <= yh) {
      float h = p.y / yh;
      col = mix(C_INK * 0.78, C_INK2 * 1.05, pow(h, 2.6));
      // 地平線上一層很淡的城市暖光，和一片版畫的橫線（白線雕刻，越近地平線越密越亮：像印出來的夜空）
      float glow = exp(-(yh - p.y) / 38.0), band = exp(-(yh - p.y) / 170.0);
      col += C_BLOOD * 0.07 * glow * k;
      col += C_GRAPHITE * hatch(p.y / 5.0, 0.07 + 0.2 * band) * 0.07 * band * k;
      // 煙：只在爆開過的地方，隨風慢慢飄；被之後的閃光照亮
      // （雜訊只在有煙、有光的地方算：會場筆電多半是內顯，整片天空每格算六層雜訊太貴）
      if (smk > 0.004) {
        float n = fbm(p / 240.0 + vec2(t * 0.035, t * 0.01), 4);
        col += C_ASH * smoothstep(-0.15, 0.65, n) * min(smk, 1.0) * (0.012 + 0.1 * lit);
      }
      col += C_EMBER * lit * 0.03;
      // 天空的版畫細線：平常看不見，只有閃光照到的地方浮出來
      if (lit > 0.01) col += C_GRAPHITE * hatch(p.y / 6.5 + 0.8 * fbm(p / 520.0, 2), 0.14) * 0.14 * min(lit, 1.5);
    } else {
      float d = p.y - yh, persp = d / (${H}.0 - yh);
      // 水面：越近波紋越大；倒影往下拉長、被一條條波紋切斷
      float w = snoise(vec2(p.x / 80.0, p.y / 6.0 - t * 0.7));
      vec2 q = vec2(p.x + w * (1.5 + 26.0 * persp), yh - d * 1.2);
      vec3 r = texture(refl, vec2(q.x / ${W}.0, 1.0 - q.y / ${H}.0)).rgb;
      float band = smoothstep(-0.25, 0.55, snoise(vec2(p.x / 150.0 + t * 0.04, p.y / (2.2 + 5.0 * persp) - t * 0.5)));
      col = mix(C_INK2 * 0.9, C_INK * 0.7, sqrt(persp));
      col += r * band * 0.75 * exp(-d / 250.0) * k;
      // 版畫的水紋：透視排列的橫線，靠近地平線密
      float u = log(d + 5.0) * 24.0 + 0.5 * snoise(vec2(p.x / 260.0, t * 0.08));
      col += C_GRAPHITE * hatch(u, 0.09) * 0.16 * exp(-d / 160.0) * k;
      // 閃光在水面上的反光（一整片、很淡）
      col += C_EMBER * lit * 0.02;
    }
    // 地平線：一條細線，開場時由火花從左畫到右
    float hl = pxLine(abs(p.y - yh), 0.4, 1.3) * step(p.x, hx);
    col += C_BONE * hl * (0.34 + 0.5 * lit) * k;
    fragColor = vec4(col, 1.0);
  }`, {
  t: { value: 0 }, k: { value: 1 }, hx: { value: W }, yh: { value: HZ },
  L: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 1)) },
  S: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 1)) },
  refl: { value: null },
});
