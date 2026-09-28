// 星圖版面（stars.ts）的天空：投影、背景 shader（經緯網、星野、銀河的版畫線、黃道、圖框）。
//
// 投影照古星圖的「圓錐投影」：北天極放在畫面上方很遠的地方，所以赤緯圈是一圈圈緩緩的大弧、赤經線從極點放射下來，
// 一眼就是一張星圖而不是方格紙。鏡頭平移＝天空繞北天極轉（周日運動），星星沿著赤緯圈慢慢滑過去，經緯線的刻度也跟著走。
// 座標都是「靜止座標」（窗格開始時的螢幕 px，y 向下）；Sky.fwd() 換成這一格的螢幕位置，shader 做反方向的換算。
import * as THREE from 'three';
import { FSPass, W, H } from '../engine/gl';

export type P2 = { x: number; y: number };

/** 赤緯每度幾 px。10° 一圈 = 160 px，網格不會太密、字也放得下。 */
export const K_DEC = 16;
/** 赤經每小時轉幾弧度（在星座附近一小時約 230 px，跟赤緯的格子差不多方）。 */
export const K_RA = 0.13;
/** 北天極（靜止時）在畫面上方多遠：越遠赤緯圈越平。 */
const POLE_Y = -1350;

/** 右下角 HUD（QR）的缺角：圖框繞過它，QR 像放在星圖角落的圖例框裡（HUD_SAFE 是 x ≥ 1360、y ≥ 830，再留一點空）。 */
export const NOTCH = { x: 1344, y: 816 };
/** 圖框：外框線、內框線離畫面邊緣幾 px（兩條線之間是黑白相間的刻度帶，跟古地圖一樣）。 */
export const FRAME_OUT = 58;
export const FRAME_IN = 72;

/** 黃道（靜止座標的曲線，歌詞沿著它寫）：左下往右上緩緩升起，右端在 HUD 上方，不會碰到 QR。 */
export const eclY = (x: number) => 868 - 0.036 * (x - 150) - 13 * Math.sin((Math.PI * (x - 150)) / 1500);
const ECL_GLSL = /* glsl */ `
float eclY(float x) { return 868.0 - 0.036 * (x - 150.0) - 13.0 * sin(PI * (x - 150.0) / 1500.0); }
float eclDY(float x) { return -0.036 - 13.0 * PI / 1500.0 * cos(PI * (x - 150.0) / 1500.0); }`;

export class Sky {
  /** 北天極（螢幕上固定不動，天空繞著它轉）。 */
  pole: P2;
  rPole: number;
  ra0: number;
  /** 這一格天空轉了多少（弧度，正的是往右＝往西轉，跟真的星空一樣）。 */
  phi = 0;
  /** 讓 center 這個點剛好落在赤經 raC 小時、赤緯 decC 度（星座的座標彩蛋要跟格線上的刻度對得起來）。 */
  constructor(center: P2, poleX: number, raC: number, decC: number) {
    this.pole = { x: poleX, y: POLE_Y };
    const dx = center.x - poleX, dy = center.y - POLE_Y;
    this.rPole = Math.hypot(dx, dy) - (90 - decC) * K_DEC;
    // 赤經往左增加（抬頭看天空時東邊在左邊，古星圖都是這樣畫的）
    this.ra0 = raC + Math.atan2(dx, dy) / K_RA;
  }
  /** 靜止座標 → 這一格的螢幕座標。 */
  fwd(x: number, y: number): P2 {
    const vx = x - this.pole.x, vy = y - this.pole.y, c = Math.cos(this.phi), s = Math.sin(this.phi);
    return { x: this.pole.x + vx * c + vy * s, y: this.pole.y - vx * s + vy * c };
  }
  radec(x: number, y: number) {
    const vx = x - this.pole.x, vy = y - this.pole.y;
    return { ra: this.ra0 - Math.atan2(vx, vy) / K_RA, dec: 90 - (Math.hypot(vx, vy) - this.rPole) / K_DEC };
  }
  /** 赤經（小時）赤緯（度）→ 靜止座標。 */
  fromRaDec(ra: number, dec: number): P2 {
    const th = (this.ra0 - ra) * K_RA, d = this.rPole + (90 - dec) * K_DEC;
    return { x: this.pole.x + d * Math.sin(th), y: this.pole.y + d * Math.cos(th) };
  }
  /** 赤經 h 小時那條線（螢幕上）與水平線 y 的交點 x。 */
  raLineAtY(h: number, y: number): number | null {
    const a = (this.ra0 - h) * K_RA + this.phi, cs = Math.cos(a);
    if (cs < 0.2) return null;
    return this.pole.x + ((y - this.pole.y) / cs) * Math.sin(a);
  }
  /** 赤緯 dec 度那一圈（螢幕上）與垂直線 x 的交點 y（取下半圈）。 */
  decCircleAtX(dec: number, x: number): number | null {
    const d = this.rPole + (90 - dec) * K_DEC, dx = x - this.pole.x;
    if (Math.abs(dx) >= d) return null;
    return this.pole.y + Math.sqrt(d * d - dx * dx);
  }
}

/** 羅馬數字（古星圖的赤經時數寫成 IIIʰ）。 */
export function roman(n: number): string {
  if (n <= 0) return '0';
  const t: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = '';
  for (const [v, r] of t) while (n >= v) { s += r; n -= v; }
  return s;
}

/**
 * 背景：暗底上的「白線版畫」星圖（pdoom 的 ascent 是紙上的黑線版畫，這裡反過來，墨底上刻紙白的細線）。
 * 很便宜的一個全螢幕 pass：經緯網＋刻度、格子裡用雜湊排的背景星（亮的有十字光芒、hi-hat 時一小撮會閃）、
 * 銀河用沿著星河走向的版畫細線（線寬隨雲氣濃淡變）、黃道與刻度、圖框與黑白相間的刻度帶（跟著赤經赤緯走）。
 */
export const makeSkyPass = () => new FSPass(/* glsl */ `
  uniform float t, k, iris, hat, hatIdx;
  uniform vec2 irisC, pole, seedOff;
  uniform float phi, rPole, kDec, kRA, ra0;
  uniform vec4 quiet;   // 圖例（留言）後面讓星圖安靜一點的範圍：x0, y0, x1, y1（y 向下）
  uniform vec3 mw;      // 銀河：法線角度、位置、半寬
  ${ECL_GLSL}

  vec2 unrot(vec2 w, float a) { float c = cos(a), s = sin(a); return vec2(w.x * c - w.y * s, w.x * s + w.y * c); }

  void main() {
    vec2 q = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);          // 螢幕 px，y 向下（跟 Canvas2D 一樣）
    vec2 r = pole + unrot(q - pole, phi);                     // 靜止座標（天空跟著轉）
    vec2 v = r - pole;
    float d = length(v);
    float dec = 90.0 - (d - rPole) / kDec;
    float ra = ra0 - atan(v.x, v.y) / kRA;

    // 底：墨色，極淡的紙紋
    vec3 col = C_INK + (C_INK2 - C_INK) * (0.45 + 0.35 * snoise(q / 640.0 + 3.1));

    // 圖框：內框（星圖範圍）＝整張減掉右下角 QR 的缺角
    vec2 ctr = vec2(${W / 2}.0, ${H / 2}.0);
    float big = 4000.0;
    float dIn = max(sdBox(q - ctr, ctr - ${FRAME_IN}.0), -sdBox(q - vec2(${NOTCH.x}.0 + big, ${NOTCH.y}.0 + big), vec2(big)));
    float dOut = max(sdBox(q - ctr, ctr - ${FRAME_OUT}.0), -sdBox(q - vec2(${NOTCH.x + FRAME_IN - FRAME_OUT}.0 + big, ${NOTCH.y + FRAME_IN - FRAME_OUT}.0 + big), vec2(big)));
    float inside = 1.0 - smoothstep(-1.0, 1.0, dIn);
    float quietK = 1.0 - 0.72 * (smoothstep(quiet.x - 60.0, quiet.x, q.x) * smoothstep(quiet.z + 60.0, quiet.z, q.x) * smoothstep(quiet.y - 60.0, quiet.y, q.y) * smoothstep(quiet.w + 60.0, quiet.w, q.y));
    float open = 1.0 - smoothstep(iris - 180.0, iris, length(q - irisC));
    float sky = inside * open * k;

    // ---- 經緯網：赤緯每 10°、赤經每 1 小時一條細線；線上每 1° / 10 分一個小刻度
    float dd = abs(fract(dec / 10.0 + 0.5) - 0.5) * 10.0 * kDec;
    float dr = abs(fract(ra + 0.5) - 0.5) * kRA * d;
    float grid = (pxLine(dd, 0.3, 1.1) + pxLine(dr, 0.3, 1.1)) * 0.10;
    float tk = pxLine(abs(fract(dec + 0.5) - 0.5) * kDec, 0.25, 0.9) * (1.0 - smoothstep(3.0, 4.0, dr));
    tk += pxLine(abs(fract(ra * 6.0 + 0.5) - 0.5) / 6.0 * kRA * d, 0.25, 0.9) * (1.0 - smoothstep(3.0, 4.0, dd));
    grid += tk * 0.10;
    // 半格（5°、30 分）用點線
    float dd5 = abs(fract(dec / 10.0) - 0.5) * 10.0 * kDec;
    float dr5 = abs(fract(ra) - 0.5) * kRA * d;
    grid += pxLine(dd5, 0.3, 1.0) * step(fract(ra * 36.0), 0.3) * 0.07 + pxLine(dr5, 0.3, 1.0) * step(fract(dec * 1.5), 0.3) * 0.07;

    // ---- 銀河：沿著星河走向的版畫細線，線寬跟著雲氣濃淡；中間一道暗帶
    vec2 mwN = vec2(cos(mw.x), sin(mw.x));
    vec2 mwT = vec2(-mwN.y, mwN.x);
    float n = dot(r, mwN) - mw.y + 80.0 * sin(dot(r, mwT) / 460.0 + seedOff.x * 6.0);
    float band = exp(-n * n / (mw.z * mw.z));
    float cloud = fbm(r / 260.0 + seedOff * 40.0, 3) * 0.5 + 0.5;
    float rift = smoothstep(0.0, 0.35, abs(n / mw.z + 0.18 + 0.25 * snoise(r / 380.0 + 7.0)));
    float dens = band * smoothstep(0.3, 0.8, cloud) * mix(0.25, 1.0, rift);
    float eng = hatch((n + 7.0 * snoise(r / 150.0)) / 5.0, dens * 0.6);
    float stip = step(hash12(floor(r / 2.5) + seedOff * 97.0), dens * 0.045);
    float milky = (eng * 0.075 + stip * 0.16) * quietK;

    // ---- 背景星：每 34 px 一格最多一顆，亮的少、暗的多；亮的刻十字光芒。hi-hat 一打，一小撮星星閃一下
    vec2 cell = floor(r / 34.0 + seedOff * 500.0);
    vec2 h2 = hash22(cell);
    float present = step(0.58, hash12(cell + 17.3));
    vec2 sp = (cell + 0.22 + 0.56 * h2) * 34.0 - seedOff * 500.0 * 34.0;
    float b = pow(hash12(cell + 3.1), 3.6);
    float rad = 0.5 + 2.0 * b;
    vec2 o = abs(r - sp);
    float disc = 1.0 - smoothstep(rad - 0.55, rad + 0.55, length(o));
    float sl = rad * 3.6;
    float spike = step(0.72, b) * (pxLine(o.x, 0.15, 0.7) * step(o.y, sl) * (1.0 - o.y / sl) + pxLine(o.y, 0.15, 0.7) * step(o.x, sl) * (1.0 - o.x / sl));
    float tw = 1.0 + hat * 2.8 * step(0.9, hash12(cell + hatIdx * 1.37)) + 0.14 * sin(t * (1.7 + 3.0 * h2.x) + h2.y * 6.28);
    float star = present * (disc + spike * 0.6) * (0.14 + 0.55 * b) * tw * mix(1.0, 0.45, 1.0 - quietK);

    // ---- 黃道：一條比經緯線亮的細線，下側每 12 px 一個刻度、每 60 px 一個長刻度
    float ey = eclY(r.x), es = eclDY(r.x);
    float ed = (r.y - ey) / sqrt(1.0 + es * es);
    float ecl = pxLine(abs(ed), 0.4, 1.3) * 0.28;
    float tlen = abs(fract(r.x / 60.0 + 0.5) - 0.5) * 60.0 < 1.2 ? 9.0 : 4.5;
    ecl += pxLine(abs(fract(r.x / 12.0 + 0.5) - 0.5) * 12.0, 0.25, 0.9) * step(0.0, ed) * step(ed, tlen) * 0.2;

    col += C_BONE * ((grid * quietK + milky + ecl) * sky + star * sky);

    // ---- 圖框：兩條線中間是黑白相間的刻度帶（上下邊跟著赤經每 10 分、左右邊跟著赤緯每 1° 換色，天空轉，刻度帶也走）
    float fr = pxLine(abs(dIn), 0.35, 1.1) * 0.34 + pxLine(abs(dOut), 0.5, 1.4) * 0.5;
    vec2 gdir = vec2(dFdx(dIn), dFdy(dIn));
    float horiz = step(abs(gdir.x), abs(gdir.y));
    float parity = mod(floor(mix(dec, ra * 6.0, horiz)), 2.0);
    float inBand = step(3.5, dIn) * step(dIn, ${FRAME_IN - FRAME_OUT - 3.5}) * step(dOut, -0.5);
    fr += inBand * parity * 0.26;
    col += C_BONE * fr * k;
    fragColor = vec4(col, 1.0);
  }`, {
  t: { value: 0 }, k: { value: 1 }, iris: { value: 4000 }, hat: { value: 0 }, hatIdx: { value: 0 },
  irisC: { value: new THREE.Vector2() }, pole: { value: new THREE.Vector2() }, seedOff: { value: new THREE.Vector2() },
  phi: { value: 0 }, rPole: { value: 700 }, kDec: { value: K_DEC }, kRA: { value: K_RA }, ra0: { value: 0 },
  quiet: { value: new THREE.Vector4() }, mw: { value: new THREE.Vector3(0, 0, 200) },
});
