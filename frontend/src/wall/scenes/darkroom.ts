// 暗房顯影（暗）：安全燈（主題的訊號色一家子）下，一張相紙泡在顯影盤裡，影像在拍點上一陣一陣浮現。
// 浮現的是手繪線稿（兩只碰杯的香檳杯）與主打留言——不是照片。
//
// 手法：整個畫面是一個全螢幕 shader，用平面鏡頭（_t15 的 PlaneCam）反查每個像素落在桌面的哪裡：
// 檯面（濕的暗色）、顯影盤（塑膠盤緣、盤底）、盤裡的相紙。相紙的內容是一張 Canvas（只畫一次）：
// 透明度就是「墨的濃度」，shader 照顯影進度決定每個像素顯出多少——真的顯影是最黑的地方先出來，
// 所以留言（最濃）第一個讀得到、杯子的排線（中間調）接著出來、淡淡的影子最後才有。
// 液面：小節線上搖一下盤子（一道長浪推過去）、每兩拍一滴水從上面的夾子滴下來（一圈漣漪），
// 液面的法線讓相紙的字稍微折射晃動、浪峰反射安全燈的光。
// 鏡頭：開燈時從比較斜、比較遠的地方落定（第一拍），之後慢慢推近；右上角是失焦的安全燈（前景虛化）。
// 歌詞：放大機投在檯面上的一小塊光，字是亮的（逐字跟唱）。沒有留言時，歌詞改成顯影在相紙上（唱到哪顯到哪）。
// 2026-09-29 照「留言尺寸與版面比例標準 v2」：相紙（場景）照樣大，但線稿佔左邊大半、留言只是相紙右側的一段手寫說明
// （螢幕上 40～60 px、寫字的範圍 ≤ 860×430）；每個小節線竹夾伸進盤子撥一下相紙（相紙被推一下再彈回），
// 對焦從線稿慢慢移到留言；右下角 HUD 那一塊壓暗、不放道具。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE, scaleContext2D } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { fillWithHearts } from '../engine/motifs';
import { lyricAt, beatAfter, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { lyricV2 } from './_v2';
import { layoutRows, drawRows, darkInk, type RowsLayout, type KaraokeInk } from './_t4';
import { winBeats, winBars, blit, no3 } from './_t8';
import { msgBlockV2, drawSig, loadAll, planeInverse, planeProject, PLANE_GLSL, INVITE, FAM, type MsgBlock, type PlaneCam, type Rect } from './_t15';

export const spec: PlateSpecDecl = { group: 'type', family: 'craft', paper: false, energy: [0.1, 0.75], bars: [4, 8], weight: 1 };

/** 相紙（平面座標 = 相紙 px，左上是原點）。 */
const PW = 1500, PH = 1000;
/** 影像區（白邊裡面）、留言的框、線稿的位置。 */
const IMG = { x: 56, y: 56, w: PW - 112, h: PH - 112 };
const TXT = { x: 800, y: 230, w: 610, h: 560 };
const ILL = { x: 390, y: 905, s: 1.55 };
/** 盤子內緣（平面座標）與盤緣寬度。 */
const TRAY = [-150, -110, PW + 170, PH + 64] as const;
const RIM = 46;
/** 相紙在盤裡稍微歪一點、偏一點（不是一個方方正正的螢幕）。 */
const PROT = 0.028;
const PC = { x: PW / 2 + 14, y: PH / 2 + 6 };
/** 相紙座標 → 平面（盤子）座標。 */
const p2w = (x: number, y: number) => {
  const dx = x - PW / 2, dy = y - PH / 2, c = Math.cos(PROT), s = Math.sin(PROT);
  return { x: PC.x + c * dx + s * dy, y: PC.y - s * dx + c * dy };
};
/** 基本機位：相紙中心對到畫面中間偏上（下面留給投在檯面上的歌詞）。 */
const CAM: PlaneCam = { pitch: 0.4, yaw: -0.07, roll: 0.026, scale: 0.76, cx: PW / 2, cy: PH / 2, oy: -122, ox: -24 };
/** 歌詞（投影的光）：左緣、最後一行的基線、最寬（右端停在 HUD 左邊）。 */
const LYR = { x: 164, base: 978, maxW: 1150 };
const LYR_LAYER = { y: 800, h: 280 };

const BG = () => new FSPass(/* glsl */ `
  ${PLANE_GLSL}
  uniform sampler2D prt; uniform float zf; uniform float dof; uniform float dev; uniform float t;
  uniform vec4 rip[6]; uniform vec4 slo; uniform float light; uniform vec4 pool; uniform float poolK;
  uniform vec2 tong; uniform vec3 pj;   // 竹夾伸進來的位移；相紙被撥動的位移與轉角
  const vec2 PS = vec2(${PW}.0, ${PH}.0);
  const vec4 TRAY = vec4(${TRAY.join('.0, ')}.0);
  const float RIM = ${RIM}.0;
  // 相紙在盤裡的位置與歪斜（平面座標 → 相紙座標：先減中心再轉）
  const vec2 PC = vec2(${PC.x}, ${PC.y});
  const mat2 PROT = mat2(${Math.cos(PROT)}, ${Math.sin(PROT)}, ${-Math.sin(PROT)}, ${Math.cos(PROT)});
  const vec2 TONG_A = vec2(1330.0, -330.0), TONG_B = vec2(1720.0, 90.0);

  float sdR(vec2 p, vec4 r, float rad) {
    vec2 c = (r.xy + r.zw) * 0.5, hs = (r.zw - r.xy) * 0.5;
    vec2 d = abs(p - c) - hs + rad;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - rad;
  }
  // 液面高度（任意單位）：搖盤子的長浪＋滴水的漣漪＋一點點靜止時的微波
  float height(vec2 w) {
    float h = 0.03 * snoise(vec3(w / 240.0, t * 0.35));
    float age = t - slo.z;
    if (age > 0.0 && slo.w > 0.0) {
      float x = dot(w - PS * 0.5, slo.xy);
      h += slo.w * exp(-age / 0.9) * sin((x - age * 520.0) / 130.0);
    }
    for (int i = 0; i < 6; i++) {
      vec4 r = rip[i];
      float a = t - r.z;
      if (a <= 0.0 || r.w <= 0.0) continue;
      float d = length(w - r.xy), front = a * 360.0;
      h += r.w * exp(-a / 0.75) * exp(-pow((d - front) / 70.0, 2.0)) * sin((d - front) / 16.0);
    }
    return h;
  }
  // 相紙：景深（離對焦點越遠越糊，八點一圈）
  vec4 printAt(vec2 w, float blur) {
    vec2 uv = vec2(w.x / PS.x, 1.0 - w.y / PS.y);
    vec4 c = fastLayer(textureLod(prt, uv, 0.0));
    if (blur < 0.4) return c;
    vec2 k = blur / PS;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398 + 0.39;
      c += fastLayer(textureLod(prt, uv + vec2(cos(a), sin(a)) * k, 0.0));
    }
    return c / 9.0;
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y); // 畫面 px，y 向下
    float z;
    vec3 wq = planeAt(p, z);
    vec2 w = wq.xy;
    float blur = dof * abs(z - zf) / 100.0;
    // 安全燈只照亮盤子這一帶：相紙最亮（右上偏亮），往外很快暗下去——暗房裡只看得到這一盤
    vec2 dl = (w - vec2(${PW * 0.6}, ${PH * 0.35})) / 1250.0;
    float il = light * (0.1 + 1.0 * exp(-dot(dl, dl) * 2.2));
    vec3 lit = (mix(C_SIGNAL, C_BLOOD, 0.4) * 0.92 + C_BONE * 0.05) * 0.54; // 安全燈照在白紙上的顏色（很飽和）
    vec3 tint = lit / max(C_BONE, vec3(0.05));
    float dT = sdR(w, TRAY, 34.0);
    vec3 col;
    if (dT < 0.0) {
      // ---- 盤裡：液面的法線（前向差分）
      float e = 3.0;
      float h0 = height(w), hx = height(w + vec2(e, 0.0)), hy = height(w + vec2(0.0, e));
      vec2 g = vec2(hx - h0, hy - h0) / e;
      vec2 wr = w - g * 90.0;                               // 折射：盤底的東西跟著液面晃
      vec3 n = normalize(vec3(-g * 20.0, 1.0));
      // 盤底（暗色塑膠）：四周的內壁暗下去；遠的那一邊看得到一條內壁
      // 盤底的一條條凸肋（顯影盤的樣子）：斜斜的受光面亮一點
      float rib = abs(fract((wr.x + wr.y * 0.02) / 58.0) - 0.5) * 58.0;
      col = C_INK2 * 1.2 + lit * (0.04 + 0.07 * exp(-rib * rib / 30.0));
      col *= 0.5 + 0.5 * smoothstep(0.0, -140.0, dT);
      float wall = step(-26.0, sdR(w - vec2(0.0, 30.0), TRAY, 34.0)) * step(w.y, TRAY.y + 60.0);
      col = mix(col, C_INK2 * 0.8 + lit * 0.02, wall);
      // 相紙（在盤裡稍微歪一點）與它的影子
      mat2 J = mat2(cos(pj.z), sin(pj.z), -sin(pj.z), cos(pj.z));
      vec2 pp = J * (PROT * (wr - PC - pj.xy)) + PS * 0.5;
      float ds = sdR(pp - vec2(12.0, 18.0), vec4(0.0, 0.0, PS), 4.0);
      col *= 1.0 - 0.55 * (1.0 - smoothstep(-12.0, 30.0, ds));
      float dp = sdR(pp, vec4(0.0, 0.0, PS), 3.0);
      if (dp < 1.5) {
        vec4 s = printAt(clamp(pp, vec2(0.0), PS), blur);
        float dens = s.a;
        vec3 inkc = s.a > 0.002 ? s.rgb / s.a : vec3(0.0);
        // 顯影：濃的地方先出來（門檻 = 1 − 濃度），反應有一段斜坡（邊緣慢慢變粗）
        float thr = 1.0 - dens;
        float k = smoothstep(thr * 0.85, thr * 0.85 + 0.3, dev);
        vec3 paper = mix(lit, inkc * tint, dens * k);
        col = mix(col, paper, 1.0 - smoothstep(-0.8, 0.8, dp));
      }
      // 液體：吃掉一點光；右上角有一片安全燈的倒影（被液面的法線打散）、浪峰有細細的反光、靠盤緣一圈亮邊
      col *= 0.88;
      vec2 rw = w + n.xy * 420.0 - vec2(${PW - 60}.0, -30.0);
      col += lit * 0.3 * exp(-dot(rw, rw) / (240.0 * 240.0));
      vec3 V = normalize(vec3(0.0, 0.3, 0.95)), L = normalize(vec3(0.5, -0.62, 0.6));
      float spec = pow(max(dot(n, normalize(L + V)), 0.0), 220.0);
      col += (C_SIGNAL * 0.7 + C_EMBER * 0.3) * spec * 0.35;
      col += lit * 0.3 * exp(dT / 4.0);
      col *= il;
    } else if (dT < RIM) {
      // ---- 盤緣：暗色塑膠，圓圓的頂面接一道光，內外緣各一條細高光
      float u = dT / RIM;
      float top = exp(-pow((u - 0.45) / 0.22, 2.0));
      col = C_INK2 * (1.1 + 1.2 * top) + lit * (0.05 * top + 0.2 * exp(-dT / 2.5) + 0.06 * exp(-(RIM - dT) / 3.0));
      col *= il;
    } else {
      // ---- 檯面：濕的暗色，有一點水漬的反光；盤子的影子
      float wet = fbm(w / 520.0, 3);
      col = C_INK * 1.1 + C_INK2 * 0.35 * (0.5 + wet) + lit * 0.05 * smoothstep(0.15, 0.55, wet);
      col *= 1.0 - 0.55 * exp(-(dT - RIM) / 50.0);
      col *= il;
    }
    // 夾子：一雙竹夾斜靠在盤子右上角（半截泡在液體裡）
    for (int i = 0; i < 2; i++) {
      vec2 a = TONG_A + tong + vec2(float(i) * 34.0, float(i) * -8.0), b = TONG_B + tong + vec2(float(i) * 26.0, 0.0);
      float d = sdSegment(w, a, b) - 13.0;
      float sh = 1.0 - smoothstep(-6.0, 30.0, sdSegment(w - vec2(16.0, 22.0), a, b) - 13.0);
      col *= 1.0 - 0.4 * sh * step(0.0, d);
      if (d < 0.0) {
        float r = clamp(-d / 13.0, 0.0, 1.0);
        vec3 bam = mix(C_SEPIA, C_PAPER, 0.35) * lit * 1.6;
        col = bam * (0.35 + 0.65 * sqrt(r)) + lit * 0.4 * exp(-pow((r - 0.75) / 0.12, 2.0));
        col *= il * (1.0 - smoothstep(-1.0, 1.0, d + 0.5) * 0.5);
      }
    }
    // 放大機投在檯面上的光（歌詞在裡面）：軟邊的一小塊暖白
    if (poolK > 0.0) {
      float dp = sdR(p, pool, 60.0);
      col += (C_BONE * 0.6 + C_SIGNAL * 0.4) * 0.05 * poolK * (1.0 - smoothstep(-60.0, 70.0, dp));
    }
    // 右上角失焦的安全燈（前景虛化）：一顆淡淡的光斑加一圈霧
    vec2 lp = vec2(${W}.0 - 70.0, -10.0);
    float r = length(p - lp);
    col += mix(C_SIGNAL, C_BLOOD, 0.3) * light * (0.2 * (1.0 - smoothstep(150.0, 164.0, r)) + 0.1 * exp(-r / 300.0));
    // 右下角 HUD（時間、留言數、QR）那一塊：安全燈照不到，背景暗而乾淨
    col *= 1.0 - 0.6 * smoothstep(-70.0, 90.0, min(p.x - 1330.0, p.y - 800.0));
    fragColor = vec4(col, 1.0);
  }`, {
  prt: { value: null }, Hinv: { value: new THREE.Matrix3() }, prect: { value: new THREE.Vector4(0, 0, PW, PH) }, zc: { value: new THREE.Vector3() },
  zf: { value: 0 }, dof: { value: 0 }, dev: { value: 0 }, t: { value: 0 },
  rip: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) }, slo: { value: new THREE.Vector4() },
  light: { value: 1 }, pool: { value: new THREE.Vector4() }, poolK: { value: 0 },
  tong: { value: new THREE.Vector2() }, pj: { value: new THREE.Vector3() },
});

/** 兩只碰杯的香檳杯（手繪線稿）：線是最濃的墨、酒是排線（中間調）、桌上的影子最淡。平面座標，腳在 (x, y)。 */
function drawGlasses(c: CanvasRenderingContext2D, x: number, y: number, s: number, seed: number) {
  const ink = (a: number) => rgba('ink', a);
  // 影子：淡淡一抹（最後才顯出來）
  const g = c.createRadialGradient(x, y + 6 * s, 10, x, y + 6 * s, 240 * s);
  g.addColorStop(0, ink(0.2)); g.addColorStop(1, ink(0));
  c.save(); c.translate(x, y + 6 * s); c.scale(1, 0.12); c.translate(-x, -(y + 6 * s));
  c.fillStyle = g; c.beginPath(); c.arc(x, y + 6 * s, 240 * s, 0, Math.PI * 2); c.fill();
  c.restore();
  c.lineCap = 'round'; c.lineJoin = 'round';
  const bowl = (side: number) => {
    c.beginPath();
    c.moveTo(-6 * s * side, -196 * s);
    c.bezierCurveTo(-40 * s * side, -236 * s, -48 * s * side, -330 * s, -44 * s * side, -432 * s);
  };
  for (const side of [-1, 1]) {
    c.save();
    c.translate(x + side * 112 * s, y);
    c.rotate(-side * 0.16);
    // 酒：液面以下的斜排線（中間調）
    c.save();
    c.beginPath();
    c.moveTo(-6 * s, -196 * s); c.bezierCurveTo(-40 * s, -236 * s, -47 * s, -330 * s, -45.5 * s, -386 * s);
    c.lineTo(45.5 * s, -386 * s); c.bezierCurveTo(47 * s, -330 * s, 40 * s, -236 * s, 6 * s, -196 * s);
    c.closePath(); c.clip();
    c.strokeStyle = ink(0.55); c.lineWidth = 2.4 * s;
    for (let k = -30; k < 30; k++) { c.beginPath(); c.moveTo(-60 * s, -196 * s + k * 9 * s); c.lineTo(60 * s, -256 * s + k * 9 * s); c.stroke(); }
    // 氣泡（空心的小圈）
    const r = (i: number) => hash(seed, side, i);
    c.strokeStyle = ink(0.85); c.lineWidth = 2 * s; c.fillStyle = ink(1);
    for (let i = 0; i < 6; i++) {
      const bx = (r(i) - 0.5) * 50 * s, by = -210 * s - r(i + 9) * 160 * s, br = (2.5 + 3 * r(i + 17)) * s;
      // 先把氣泡那一圈的排線擦掉，再描一圈
      c.globalCompositeOperation = 'destination-out';
      c.beginPath(); c.arc(bx, by, br + 2 * s, 0, Math.PI * 2); c.fill();
      c.globalCompositeOperation = 'source-over';
      c.beginPath(); c.arc(bx, by, br, 0, Math.PI * 2); c.stroke();
    }
    c.restore();
    // 杯子的線（最濃）
    c.strokeStyle = ink(0.95); c.lineWidth = 4.2 * s;
    bowl(1); c.stroke(); bowl(-1); c.stroke();
    c.beginPath(); c.ellipse(0, -432 * s, 44 * s, 8 * s, 0, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 2.6 * s;
    c.beginPath(); c.ellipse(0, -386 * s, 45 * s, 7 * s, 0, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 5 * s;
    c.beginPath(); c.moveTo(0, -196 * s); c.lineTo(0, -8 * s); c.stroke();
    c.lineWidth = 4 * s;
    c.beginPath(); c.ellipse(0, 0, 58 * s, 11 * s, 0, 0, Math.PI * 2); c.stroke();
    // 杯身的反光：擦掉一道細長的亮線
    c.save(); c.globalCompositeOperation = 'destination-out';
    c.strokeStyle = ink(1); c.lineWidth = 5 * s;
    c.beginPath(); c.moveTo(-24 * s, -250 * s); c.bezierCurveTo(-33 * s, -300 * s, -35 * s, -350 * s, -32 * s, -405 * s); c.stroke();
    c.restore();
    c.restore();
  }
  // 碰杯的那一下：幾道放射的短線
  const cx = x, cy = y - 452 * s;
  c.strokeStyle = ink(0.9); c.lineWidth = 3.4 * s;
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI * (0.12 + 0.76 * (i / 6)), r0 = 26 * s, r1 = r0 + (26 + 16 * hash(seed, i, 3)) * s;
    c.beginPath(); c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); c.stroke();
  }
}

export default class Darkroom extends Scene {
  bg = shared('darkroom.bg', BG);
  /** 相紙（透明度 = 墨的濃度）。有留言時只畫一次；沒有留言時每格重畫歌詞那一塊。 */
  print = this.track(new Layer2D(PW, PH, SCALE, { fast: true }));
  /** 投在檯面上的歌詞（只有畫面下面那一條）。 */
  lyr = this.track(new Layer2D(W, LYR_LAYER.h, SCALE, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 131 + (this.msg?.id ?? 0) * 7919) >>> 0;
  block: MsgBlock | null = null;
  /** 線稿另外存一張（沒有留言時每格重畫相紙要用）。 */
  ill: HTMLCanvasElement | null = null;
  t0 = 0; nb = 4; beat = 0.5;
  drips: { t: number; x: number; y: number; a: number }[] = [];
  bars: number[] = [];
  lyrSize = 54;
  /** 相紙上的字的範圍（平面座標）：popupAvoid 用。 */
  hot: Rect = [TXT.x, TXT.y, TXT.w, TXT.h];
  lastKey = '';
  instrumental = false;
  /** 相紙上 1 px 在螢幕上是幾 px（留言區附近，基本機位）：v2 的字級都是螢幕 px，要換算成相紙上的字級。 */
  k = 0.8;

  override async init() {
    const { audio: au, lyrics, start: s, end: e } = this.ctx;
    const lines = lyrics.linesIn(s - 1, e + 1);
    this.instrumental = !lyrics.has;
    await loadAll(this.msg, lines.map((l) => l.text).join(''), `${COUPLE_ZH}${DATE_DOTS}${no3(this.msg?.n ?? 0)}`);
    // ---- 節拍：開燈後第一拍開始顯影，約 NB 拍顯完；每兩拍一滴水、每個小節線搖一次盤子
    this.beat = au.beatPeriod(s);
    this.t0 = beatAfter(au, s + 0.05);
    const beats = winBeats(au, s, e);
    this.nb = clamp(Math.round(beats.length * 0.45), 3, 8);
    beats.forEach((bt, i) => {
      if (i % 2 !== 1) return;
      // 滴水的位置：盤子四周的空處或線稿那一側，不滴在留言正中間（字不會一直被晃）
      const k = hash(this.seed, i, 1);
      const spots = [[-60, 300 + 400 * k], [PW + 60, 200 + 600 * k], [200 + 200 * k, -50], [250 + 150 * k, 600 + 200 * k], [900 + 400 * k, PH + 35], [120, 150 + 150 * k]] as const;
      const sp = spots[Math.floor(hash(this.seed, i, 2) * spots.length)]!;
      this.drips.push({ t: bt, x: sp[0], y: sp[1], a: 0.6 + 0.4 * hash(this.seed, i, 3) });
    });
    this.bars = winBars(au, s, e).filter((b) => b > s + 0.1);

    // ---- 相紙
    const c = this.print.ctx;
    this.print.clear();
    const ic = document.createElement('canvas');
    ic.width = Math.round(PW * SCALE); ic.height = Math.round(PH * SCALE);
    const icx = scaleContext2D(ic.getContext('2d')!, SCALE);
    this.drawStatic(icx);
    this.ill = ic;
    c.drawImage(ic, 0, 0, PW, PH);
    {
      const a = p2w(TXT.x + TXT.w / 2 - 60, TXT.y + TXT.h / 2), b = p2w(TXT.x + TXT.w / 2 + 60, TXT.y + TXT.h / 2);
      const pa = planeProject(CAM, a.x, a.y), pb = planeProject(CAM, b.x, b.y);
      this.k = Math.hypot(pb.x - pa.x, pb.y - pa.y) / 120;
    }
    if (this.msg) {
      const b = msgBlockV2(c, this.msg, FAM.hand, TXT.w, TXT.h, { k: this.k, lineHeight: 1.3 });
      this.block = b;
      c.save();
      c.font = font(b.family, b.fit.size);
      c.fillStyle = rgba('ink', 1);
      b.fit.lines.forEach((ln, i) => fillWithHearts(c, ln, TXT.x, TXT.y + b.top + i * b.fit.lineHeight, rgba('rose')));
      c.restore();
      const right = TXT.x + Math.max(b.fit.width, 260);
      drawSig(c, b, Math.min(TXT.x + TXT.w, right), TXT.y + b.sigY, rgba('ink', 0.78));
      this.hot = [TXT.x - 10, TXT.y + b.top - b.fit.size, Math.max(b.fit.width, 300) + 20, b.sigY - b.top + b.fit.size + 20];
      // 投在檯面上的歌詞比留言（在畫面上的大小）小一點（v2：40～52）
      this.lyrSize = lyricV2(b.fit.size * this.k);
    } else if (this.instrumental) {
      // 純音樂、沒有留言：相紙上是新人的名字與日期
      c.save();
      c.font = font(F.ming(900), 60 / this.k); c.fillStyle = rgba('ink', 1);
      const nm = COUPLE_ZH;
      c.fillText(nm, TXT.x, TXT.y + TXT.h * 0.5);
      c.font = font(F.mono(500), 26 / this.k); c.letterSpacing = '8px'; c.fillStyle = rgba('ink', 0.8);
      c.fillText(DATE_DOTS, TXT.x + 6, TXT.y + TXT.h * 0.5 + 60 / this.k);
      c.restore();
    }
    this.print.upload();
  }

  /** 相紙上不變的東西：影像區的淡底、線稿、白邊上的小字。 */
  private drawStatic(c: CanvasRenderingContext2D) {
    // 影像區很淡的一層（最後才顯出來，讓它看起來是一張「照片」而不是白紙上的字）
    c.fillStyle = rgba('ink', 0.075);
    c.fillRect(IMG.x, IMG.y, IMG.w, IMG.h);
    const vg = c.createRadialGradient(PW * 0.45, PH * 0.45, 200, PW * 0.5, PH * 0.5, 900);
    vg.addColorStop(0, rgba('ink', 0)); vg.addColorStop(1, rgba('ink', 0.1));
    c.fillStyle = vg; c.fillRect(IMG.x, IMG.y, IMG.w, IMG.h);
    drawGlasses(c, ILL.x, ILL.y, ILL.s, this.seed);
    // 白邊上的小字（很淡）：編號與日期；沒有留言時換成邀請
    c.font = font(F.mono(500), 21); c.letterSpacing = '4px'; c.fillStyle = rgba('ink', 0.5);
    c.fillText(`${this.msg ? no3(this.msg.n) : 'No.000'}  ·  ${DATE_DOTS}`, IMG.x, PH - 17);
    c.letterSpacing = '0px';
    if (!this.msg) {
      c.font = font(F.hei(500), 21); c.textAlign = 'right';
      c.fillText(INVITE, IMG.x + IMG.w, PH - 17);
      c.textAlign = 'left';
    }
  }

  /** 沒有留言：這一行歌詞顯影在相紙上（逐字：還沒唱的淡淡一層、正在唱的是訊號色的暗部、唱完是黑的）。 */
  private drawLyricPrint(t: number): boolean {
    const ly = lyricAt(this.ctx.lyrics, t, 1.4, 0.35);
    // 沒有歌詞的空檔只要重畫一次（只剩線稿）；有歌詞時每格照 t 重畫（快取會讓畫面停在上一次的 t，確定性不過）
    if (!ly && this.lastKey === 'none') return false;
    this.lastKey = ly ? 'line' : 'none';
    const L = this.print, c = L.ctx;
    L.clear();
    c.drawImage(this.ill!, 0, 0, PW, PH);
    if (!ly) return true;
    const lay = this.lyricLayout(ly.line);
    const ink: KaraokeInk = { active: rgba('blood'), sung: rgba('ink', 0.97), unsung: rgba('ink', 0.14) };
    c.save();
    c.translate(TXT.x, TXT.y + (TXT.h - lay.height) / 2 + lay.size * 0.9);
    drawRows(c, lay, FAM.lyric, t, ink, ly.k);
    c.restore();
    return true;
  }

  private layouts = new Map<Line, RowsLayout>();
  private lyricLayout(line: Line): RowsLayout {
    let l = this.layouts.get(line);
    if (!l) { l = layoutRows(this.print.ctx, line, { family: FAM.lyric, size: lyricV2(null) / this.k, minSize: 40 / this.k, maxW: TXT.w, maxRows: 3, lineHeight: 1.16 }); this.layouts.set(line, l); }
    return l;
  }

  /** 這一格的鏡頭：開燈時從比較斜、比較遠落定（第一拍），整段慢慢推近；小節線上盤子一搖，畫面跟著晃一點。 */
  private camAt(t: number): PlaneCam {
    const s = this.ctx.start, e = this.ctx.end;
    const land = ease.outExpo(prog(t, s, Math.max(s + 0.5, this.t0 + this.beat * 0.6)));
    const push = ease.inOutCubic(prog(t, s, e));
    const out = ease.inCubic(prog(t, e - Math.min(0.6, this.beat * 1.2), e));
    let rock = 0;
    const lb = this.bars.filter((b) => b <= t).pop();
    if (lb !== undefined) { const a = t - lb; rock = Math.sin(a * 11) * Math.exp(-a * 3.2) * (this.bars.indexOf(lb) % 2 ? 1 : -1); }
    return {
      ...CAM,
      pitch: lerp(0.46, CAM.pitch, land) - 0.02 * push,
      yaw: lerp(-0.11, CAM.yaw, land) + 0.004 * rock,
      roll: (CAM.roll ?? 0) + 0.0035 * rock,
      scale: lerp(0.64, CAM.scale, land) * (1 + 0.045 * push + 0.05 * out),
    };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const cam = this.camAt(t);
    const u = this.bg.u;
    planeInverse(cam, [0, 0, PW, PH], u.Hinv!.value as THREE.Matrix3, u.zc!.value as THREE.Vector3);
    u.t!.value = t;
    // 開燈：前 0.2 秒閃兩下（安全燈的燈管），之後穩定
    const lt = t - s;
    u.light!.value = lt < 0 ? 0 : lt < 0.05 ? 0.6 : lt < 0.09 ? 0.15 : lt < 0.16 ? 1 : lt < 0.2 ? 0.55 : 1;
    // 顯影：拍點上一陣一陣（每拍一開始湧一下，outExpo），再加一點點連續的
    const b = this.ctx.audio.beatAt(t) - this.ctx.audio.beatAt(this.t0);
    const surge = b < 0 ? 0 : Math.floor(b) + ease.outExpo(b - Math.floor(b));
    u.dev!.value = this.msg || this.instrumental ? clamp((0.8 * surge + 0.2 * Math.max(0, b)) / this.nb) : clamp(0.25 + (0.8 * surge + 0.2 * Math.max(0, b)) / (this.nb * 0.7));
    // 滴水（最近的六滴）與搖盤子（最近的小節線）
    const R = u.rip!.value as THREE.Vector4[];
    const live = this.drips.filter((d) => d.t <= t && t - d.t < 2.5).slice(-6);
    for (let i = 0; i < 6; i++) { const d = live[i]; if (d) R[i]!.set(d.x, d.y, d.t, d.a); else R[i]!.set(0, 0, 0, 0); }
    const lb = this.bars.filter((x) => x <= t).pop();
    const bi = lb === undefined ? 0 : this.bars.indexOf(lb);
    (u.slo!.value as THREE.Vector4).set(bi % 2 ? -1 : 1, 0.12, lb ?? 0, lb === undefined ? 0 : 1.1);
    // 小節線：竹夾伸進盤子（outExpo）撥一下相紙右上角，停一下再收回去；相紙被推一下再慢慢停住
    let tk = 0, push = 0;
    if (lb !== undefined) {
      const a = t - lb;
      tk = a < 0.16 ? ease.outExpo(a / 0.16) : a < 0.3 ? 1 : 1 - ease.inOutCubic(clamp((a - 0.3) / 0.5));
      const d = Math.max(0, a - 0.14);
      push = d * 6 * Math.exp(-d * 6);
    }
    (u.tong!.value as THREE.Vector2).set(-150 * tk, 115 * tk);
    (u.pj!.value as THREE.Vector3).set(-26 * push, 20 * push, 0.012 * push * (bi % 2 ? 1 : -1));
    // 對焦：開場先看線稿，顯影出來之後慢慢移到留言（或歌詞）上
    const fk = ease.inOutCubic(clamp((u.dev!.value as number) * 1.6 - 0.2));
    const f0 = p2w(ILL.x, ILL.y - 300), f1 = p2w(TXT.x + TXT.w * 0.45, TXT.y + TXT.h * 0.5);
    u.zf!.value = lerp(planeProject(cam, f0.x, f0.y).z, planeProject(cam, f1.x, f1.y).z, fk);
    u.dof!.value = 1.7;

    if (!this.msg && !this.instrumental && this.drawLyricPrint(t)) this.print.upload();
    u.prt!.value = this.print.texture;

    // 有留言：歌詞投在檯面上
    u.poolK!.value = 0;
    let lyrShown = false;
    if (this.msg) {
      const L = this.lyr, c = L.ctx;
      L.clear();
      const ly = lyricAt(lyrics, t);
      if (ly) {
        const lay = layoutRows(c, ly.line, { family: FAM.lyric, size: this.lyrSize, minSize: Math.min(40, this.lyrSize), maxW: LYR.maxW, maxRows: 2, lineHeight: 1.12 });
        const y0 = LYR.base - (lay.rows.length - 1) * lay.lineHeight;
        c.save();
        c.translate(LYR.x, y0 - LYR_LAYER.y);
        drawRows(c, lay, FAM.lyric, t, darkInk(), ly.k);
        c.restore();
        (u.pool!.value as THREE.Vector4).set(LYR.x - 30, y0 - lay.size - 18, LYR.x + lay.width + 30, LYR.base + lay.size * 0.3 + 12);
        u.poolK!.value = ly.k;
        lyrShown = true;
      }
    }
    this.bg.render(renderer, out);
    if (lyrShown) blit(this.ctx, this.lyr.upload(), 0, LYR_LAYER.y, W, LYR_LAYER.h, out);
    const [hx, hy, hw, hh] = this.hot;
    const cs = [p2w(hx, hy), p2w(hx + hw, hy), p2w(hx, hy + hh), p2w(hx + hw, hy + hh)].map((q) => planeProject(cam, q.x, q.y));
    const x0 = Math.min(...cs.map((q) => q.x)), y0 = Math.min(...cs.map((q) => q.y));
    const avoid: Rect = [Math.round(x0 - 12), Math.round(y0 - 12), Math.round(Math.max(...cs.map((q) => q.x)) - x0 + 24), Math.round(Math.max(...cs.map((q) => q.y)) - y0 + 24)];
    return { bloom: 0.55, vignette: 0.7, popupAvoid: [avoid] };
  }
}
