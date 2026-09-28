// 祝福牆的鏡頭：在牆上平移、推近、拉遠。
//
// 推近／換一則用 van Wijk & Nuij 的「最佳縮放路徑」（d3.interpolateZoom 用的同一套公式）：
// 兩個遠的點之間會先拉遠再推近，看起來像攝影師的手，不會像線性內插那樣「滑過去」時整面牆糊成一片。
// 路徑的參數再套上緩動（緩進小節線），停住，再一下子動起來。
import { W, H } from '../engine/gl';
import { clamp, lerp } from '../engine/util';

/** 鏡頭：牆上的中心點（牆 px）、畫面寬度對應幾個牆 px、旋轉（弧度）。 */
export interface View { x: number; y: number; w: number; r: number }

export const zoomOf = (v: View) => W / v.w;

/** 最佳縮放路徑：回傳 u（0..1）→ 鏡頭。rho 越大越會先拉遠。 */
export function zoomPath(a: View, b: View, rho = 1.25): (u: number) => View {
  const rho2 = rho * rho, rho4 = rho2 * rho2;
  const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
  const w0 = a.w, w1 = b.w;
  if (d2 < 1e-6) {
    const S = Math.log(w1 / w0) / rho;
    return (u) => ({ x: a.x + u * dx, y: a.y + u * dy, w: w0 * Math.exp(rho * u * S), r: lerp(a.r, b.r, u) });
  }
  const d1 = Math.sqrt(d2);
  const b0 = (w1 * w1 - w0 * w0 + rho4 * d2) / (2 * w0 * rho2 * d1);
  const b1 = (w1 * w1 - w0 * w0 - rho4 * d2) / (2 * w1 * rho2 * d1);
  const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0), r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
  const S = (r1 - r0) / rho;
  return (u) => {
    const s = u * S, c0 = Math.cosh(r0);
    const k = (w0 / (rho2 * d1)) * (c0 * Math.tanh(rho * s + r0) - Math.sinh(r0));
    return { x: a.x + k * dx, y: a.y + k * dy, w: (w0 * c0) / Math.cosh(rho * s + r0), r: lerp(a.r, b.r, u) };
  };
}

/** 鏡頭不能看到牆外：縮到剛好塞滿為止，中心夾在範圍內（旋轉時四個角也要在牆裡）。 */
export function constrain(v: View, WW: number, WH: number): View {
  const cs = Math.abs(Math.cos(v.r)), sn = Math.abs(Math.sin(v.r));
  const k = v.w / W; // 牆 px / 螢幕 px
  // 旋轉後的畫面外接框（牆 px）
  const ex = (W * cs + H * sn) * k, ey = (W * sn + H * cs) * k;
  const s = Math.max(1, ex / WW, ey / WH);
  const w = v.w / s;
  const hx = (ex / s) / 2, hy = (ey / s) / 2;
  return { x: clamp(v.x, hx, WW - hx), y: clamp(v.y, hy, WH - hy), w, r: v.r };
}

/** 牆 px → 螢幕 px（Canvas2D 的 setTransform 參數與點的換算，跟 shader 同一個公式）。 */
export function worldToScreen(v: View) {
  const z = W / v.w, cs = Math.cos(v.r) * z, sn = Math.sin(v.r) * z;
  // s = S/2 + z·R(r)·(p − c)
  const e = W / 2 - (cs * v.x - sn * v.y), f = H / 2 - (sn * v.x + cs * v.y);
  return { a: cs, b: sn, c: -sn, d: cs, e, f, pt: (x: number, y: number) => ({ x: cs * x - sn * y + e, y: sn * x + cs * y + f }) };
}

/** 一段鏡頭運動：[t0, t1] 之間從 a 到 b，緩動 ease；hold 段 a === b（可以有很慢的推近）。 */
export interface Move { t0: number; t1: number; at: (u: number) => View; ease: (u: number) => number }

export class CamPath {
  moves: Move[] = [];
  constructor(public WW: number, public WH: number) {}
  add(t0: number, t1: number, a: View, b: View, ease: (u: number) => number, rho?: number) {
    const f = rho === 0 ? (u: number) => ({ x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), w: a.w * Math.pow(b.w / a.w, u), r: lerp(a.r, b.r, u) }) : zoomPath(a, b, rho);
    this.moves.push({ t0, t1: Math.max(t0 + 1e-3, t1), at: f, ease });
    return b;
  }
  at(t: number): View {
    const ms = this.moves;
    let m = ms[0]!;
    for (const x of ms) { if (t >= x.t0) m = x; else break; }
    const u = clamp((t - m.t0) / (m.t1 - m.t0));
    return constrain(m.at(m.ease(u)), this.WW, this.WH);
  }
}
