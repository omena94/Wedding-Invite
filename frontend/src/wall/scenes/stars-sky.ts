// 星圖版面（stars.ts）的天空：投影與背景 shader。
//
// 電影畫面的夜空（滿版星圖太亂、背景看不清楚）：拿掉滿版的圖框、刻度帶與整片經緯網，
// 改成「真的夜空」＋一點點星圖的影子——
//  - 天空由上往下從深墨漸到地平線附近微微的暖光（遠方城市的光害），下緣兩層山稜剪影（有視差，鏡頭平移時近的跑得比遠的快）；
//  - 星野分兩層：很多很淡的小星（空氣感）、少數亮星（有柔光，hi-hat 一打一小撮會閃）；銀河只是一道很淡的雲氣；
//  - 星圖的經緯網只在星座附近淡淡浮出來（像望遠鏡視野裡的疊圖），離星座越遠越淡，留言後面完全沒有；
//  - 留言後面的天空暗一點、星星少一點（不加框），字才清楚。
//  - v2（畫面要一直有動畫）：銀河亮一點；地平線上方有一層薄雲很慢地飄（遮住後面的星、底下被城市的光照亮）；
//    近山的稜線上一排草，在風裡左右晃。
//
// 投影照古星圖的「圓錐投影」：北天極在畫面上方很遠的地方，鏡頭平移＝天空繞北天極轉（周日運動）。
// 座標都是「靜止座標」（窗格開始時的螢幕 px，y 向下）；Sky.fwd() 換成這一格的螢幕位置，shader 做反方向的換算。
import * as THREE from 'three';
import { FSPass, H } from '../engine/gl';

export type P2 = { x: number; y: number };

/** 赤緯每度幾 px。10° 一圈 = 160 px。 */
export const K_DEC = 16;
/** 赤經每小時轉幾弧度（在星座附近一小時約 230 px，跟赤緯的格子差不多方）。 */
export const K_RA = 0.13;
/** 北天極（靜止時）在畫面上方多遠：越遠赤緯圈越平。 */
const POLE_Y = -1350;

/** 黃道（靜止座標的曲線，歌詞沿著它寫）：左下往右上緩緩升起。off 讓沒有留言的窗格把它整條抬高（歌詞當主角）。 */
export const eclY = (x: number, off = 0) => 868 + off - 0.036 * (x - 150) - 13 * Math.sin((Math.PI * (x - 150)) / 1500);
const ECL_GLSL = /* glsl */ `
float eclY(float x) { return 868.0 + eclOff - 0.036 * (x - 150.0) - 13.0 * sin(PI * (x - 150.0) / 1500.0); }
float eclDY(float x) { return -0.036 - 13.0 * PI / 1500.0 * cos(PI * (x - 150.0) / 1500.0); }`;

export class Sky {
  /** 北天極（螢幕上固定不動，天空繞著它轉）。 */
  pole: P2;
  rPole: number;
  ra0: number;
  /** 這一格天空轉了多少（弧度，正的是往右＝往西轉，跟真的星空一樣）。 */
  phi = 0;
  /** 讓 center 這個點剛好落在赤經 raC 小時、赤緯 decC 度（星座的座標彩蛋要跟格線對得起來）。 */
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
}

/**
 * 背景：一個全螢幕 pass（便宜）。天空漸層與地平線的暖光、銀河的雲氣、兩層星野、星座附近的經緯網、很淡的黃道、
 * 兩層山稜剪影（近的邊緣稍微虛，像鏡頭對焦在天上）。
 */
export const makeSkyPass = () => new FSPass(/* glsl */ `
  uniform float t, k, hat, hatIdx;
  uniform vec2 pole, seedOff;
  uniform float phi, rPole, kDec, kRA, ra0;
  uniform vec4 quiet;   // 留言的範圍（螢幕 px，y 向下）：x0, y0, x1, y1。後面的天空暗一點、星星少一點
  uniform vec3 chart;   // 星座附近浮出經緯網：中心 x, y、半徑
  uniform vec3 mw;      // 銀河：法線角度、位置、半寬
  uniform float eclOff, eclK; // 黃道的上下位移、亮度
  uniform vec2 ridge;   // 山稜的水平位移（遠、近）：鏡頭平移的視差
  ${ECL_GLSL}

  vec2 unrot(vec2 w, float a) { float c = cos(a), s = sin(a); return vec2(w.x * c - w.y * s, w.x * s + w.y * c); }

  // 一格一顆星：cell 格子大小、p 出現的機率、回傳亮度（含柔光）。只看自己這一格，所以星的位置留在格子中間，光暈不會被切掉。
  float starField(vec2 r, float cell, float p, float bMin, float bMax, float glowK, out float spikeOut) {
    vec2 c = floor(r / cell + seedOff * 500.0);
    vec2 h2 = hash22(c);
    float present = step(1.0 - p, hash12(c + 17.3));
    vec2 sp = (c + 0.25 + 0.5 * h2) * cell - seedOff * 500.0 * cell;
    float b = pow(hash12(c + 3.1), 3.2);
    float rad = 0.45 + 1.5 * b * glowK;
    vec2 o = r - sp;
    float L = length(o);
    float disc = 1.0 - smoothstep(rad - 0.5, rad + 0.5, L);
    float halo = exp(-L / (0.9 + 2.6 * b)) * 0.35 * glowK;
    // 最亮的幾顆有很細的十字（鏡頭的繞射，不是雕版的光芒）
    vec2 ao = abs(o);
    float sl = 4.0 + 9.0 * b;
    spikeOut = present * step(0.93, b) * glowK * (pxLine(ao.x, 0.1, 0.6) * max(0.0, 1.0 - ao.y / sl) + pxLine(ao.y, 0.1, 0.6) * max(0.0, 1.0 - ao.x / sl));
    // hi-hat 一打，一成的亮星閃一下；平常很慢地呼吸
    float tw = 1.0 + hat * 2.4 * step(0.9, hash12(c + hatIdx * 1.37)) * glowK + 0.16 * sin(t * (1.3 + 2.6 * h2.x) + h2.y * 6.28);
    return present * (disc + halo) * mix(bMin, bMax, b) * tw;
  }

  void main() {
    vec2 q = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);          // 螢幕 px，y 向下（跟 Canvas2D 一樣）
    vec2 r = pole + unrot(q - pole, phi);                     // 靜止座標（天空跟著轉）
    vec2 v = r - pole;
    float d = length(v);
    float dec = 90.0 - (d - rPole) / kDec;
    float ra = ra0 - atan(v.x, v.y) / kRA;

    // ---- 山稜（螢幕座標＋視差位移）：遠的一層淡一點（空氣透視）、近的一層最暗，邊緣稍微虛
    float xf = q.x + ridge.x, xn = q.x + ridge.y;
    float yFar = 962.0 + 24.0 * sin(xf / 340.0 + 1.3) + 15.0 * sin(xf / 131.0 + 0.4) + 6.0 * snoise(vec2(xf / 85.0, 3.3));
    float yNear = 1024.0 + 30.0 * sin(xn / 430.0 + 4.1) + 12.0 * sin(xn / 167.0 + 2.2) + 5.0 * snoise(vec2(xn / 58.0, 8.1));
    // 稜線上的草：一根根細尖，風一吹整排往同一邊偏（相位跟著時間與位置慢慢走）
    float sway = 0.8 * sin(t * 1.25 + xn * 0.0035) + 0.35 * sin(t * 2.3 + xn * 0.011);
    yNear -= (5.0 + 11.0 * (0.5 + 0.5 * snoise(vec2(xn / 90.0, 2.7)))) * pow(abs(sin(xn * 0.3 + sway)), 12.0);
    float aFar = smoothstep(-1.0, 1.0, q.y - yFar);
    float aNear = smoothstep(-3.0, 3.0, q.y - yNear);

    // ---- 天空：上面最深，往地平線慢慢亮一點、帶一點暖（遠方城市的光）
    float hy = q.y / ${H}.0;
    vec3 col = mix(C_INK * 0.7, C_INK2 * 1.15, smoothstep(0.05, 0.95, hy));
    float airglow = exp(-max(0.0, yFar - q.y) / 190.0);
    col += mix(C_BLOOD, C_SIGNAL, 0.25) * airglow * 0.03;
    col *= 0.94 + 0.06 * snoise(q / 760.0 + 3.1);

    // 留言後面：天空暗一點、星星與雲氣退開（很寬的柔邊，不是框）
    vec2 qc = (quiet.xy + quiet.zw) * 0.5, qh = max((quiet.zw - quiet.xy) * 0.5, vec2(0.0));
    float qd = sdBox(q - qc, qh);
    float quietM = 1.0 - smoothstep(-30.0, 140.0, qd);
    // 大氣消光：越靠近地平線星越暗
    float ext = 0.3 + 0.7 * smoothstep(yFar + 10.0, yFar - 260.0, q.y);
    float skyM = (1.0 - aFar) * k;

    // ---- 銀河：一道很淡的雲氣，中間一條暗的塵帶
    vec2 mwN = vec2(cos(mw.x), sin(mw.x));
    vec2 mwT = vec2(-mwN.y, mwN.x);
    float n = dot(r, mwN) - mw.y + 70.0 * sin(dot(r, mwT) / 520.0 + seedOff.x * 6.0);
    float band = exp(-n * n / (mw.z * mw.z));
    float cloud = fbm(r / 420.0 + seedOff * 40.0, 2) * 0.5 + 0.5;
    float rift = smoothstep(0.05, 0.45, abs(n / mw.z + 0.15 + 0.3 * snoise(r / 420.0 + 7.0)));
    float dens = band * smoothstep(0.25, 0.85, cloud) * mix(0.3, 1.0, rift);
    col += mix(C_BONE, C_ASH, 0.5) * dens * 0.042 * (1.0 - 0.7 * quietM) * ext * skyM;

    // ---- 星野：很多很淡的小星（銀河裡更密）＋少數亮星
    float sp1, sp2;
    float fine = starField(r, 15.0, 0.3 + 0.4 * dens, 0.04, 0.26, 0.0, sp1);
    float bright = starField(r + 7.0, 70.0, 0.3, 0.14, 0.7, 1.0, sp2);
    float stars = (fine + bright + sp2 * 0.25) * (1.0 - 0.8 * quietM) * ext * skyM;
    col += C_BONE * stars;

    // ---- 地平線上方的薄雲：很慢地往一邊飄，遮住後面的星，底下被遠方城市的光照亮一點
    if (q.y > 620.0) {
      float band2 = smoothstep(620.0, 800.0, q.y) * (1.0 - smoothstep(900.0, 990.0, q.y));
      float cl = fbm(vec2(q.x / 760.0 + t * 0.014 + seedOff.y * 9.0, q.y / 105.0 + seedOff.x * 3.0), 3);
      float cm = smoothstep(0.0, 0.42, cl) * band2 * (1.0 - 0.6 * quietM);
      vec3 cloudCol = C_INK2 * 1.5 + mix(C_BLOOD, C_SIGNAL, 0.25) * 0.025 * smoothstep(760.0, 960.0, q.y);
      col = mix(col, cloudCol, cm * 0.6 * skyM);
    }

    // ---- 經緯網：只在星座附近浮出來（赤緯每 10°、赤經每 1 小時），越遠越淡
    float dd = abs(fract(dec / 10.0 + 0.5) - 0.5) * 10.0 * kDec;
    float dr = abs(fract(ra + 0.5) - 0.5) * kRA * d;
    float grid = pxLine(dd, 0.25, 1.0) + pxLine(dr, 0.25, 1.0);
    float cm = 1.0 - smoothstep(chart.z * 0.25, chart.z, length(q - chart.xy));
    col += C_BONE * grid * 0.032 * cm * (1.0 - quietM) * skyM;

    // ---- 黃道：一條很淡的細線，兩端淡出（歌詞沿著它寫）
    float ey = eclY(r.x), es = eclDY(r.x);
    float ed = (r.y - ey) / sqrt(1.0 + es * es);
    float ecl = pxLine(abs(ed), 0.35, 1.2) * smoothstep(40.0, 260.0, q.x) * smoothstep(1900.0, 1600.0, q.x);
    col += C_BONE * ecl * 0.1 * eclK * skyM;

    // ---- 山稜剪影：遠山的稜線有一點點月光，近山全黑；兩層之間一條很薄的霧
    vec3 farCol = mix(C_INK2 * 0.6, C_INK * 0.9, smoothstep(yFar, yFar + 120.0, q.y)) + mix(C_BLOOD, C_SIGNAL, 0.25) * airglow * 0.012;
    col = mix(col, farCol * k, aFar);
    col += C_BONE * pxLine(abs(q.y - yFar), 0.3, 1.3) * 0.03 * k * (1.0 - aNear);
    col += C_ASH * exp(-abs(q.y - yNear + 16.0) / 26.0) * 0.01 * k * (1.0 - aNear) * aFar;
    col = mix(col, C_INK * 0.28 * k, aNear);
    fragColor = vec4(col, 1.0);
  }`, {
  t: { value: 0 }, k: { value: 1 }, hat: { value: 0 }, hatIdx: { value: 0 },
  pole: { value: new THREE.Vector2() }, seedOff: { value: new THREE.Vector2() },
  phi: { value: 0 }, rPole: { value: 700 }, kDec: { value: K_DEC }, kRA: { value: K_RA }, ra0: { value: 0 },
  quiet: { value: new THREE.Vector4(-9999, -9999, -9998, -9998) }, chart: { value: new THREE.Vector3(0, 0, 1) },
  mw: { value: new THREE.Vector3(0, 0, 200) }, eclOff: { value: 0 }, eclK: { value: 1 }, ridge: { value: new THREE.Vector2() },
});
