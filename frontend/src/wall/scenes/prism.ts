// 光譜（暗）：牛頓的三稜鏡實驗做成一張光學圖版。左上角一道白光（歌）斜斜射進一塊三稜鏡，
// 在鏡子裡散開、出來變成一把扇形的光譜，經過一片準直透鏡後變成一條一條平行的色帶往右走。
//  - 光譜的顏色取自這首歌的主題：訊號色往兩邊轉色相（±36°），所以金色主題是紅橙黃、玫瑰主題是紫粉橙…
//  - 主打留言的每一行坐在一條色帶上（最上、最下各多一條沒有字的細色帶，像光譜的兩翼），
//    是「出射的光」：每一拍從左邊射進一個光脈衝，沿著白光 → 稜鏡 → 色帶一路掃到右邊；
//    第 k 行在第 k 拍的脈衝掃過時一個字一個字亮起來（燒亮、冷卻成紙白，帶一點色帶的顏色），之後每個脈衝經過都閃一下。
//  - 每個小節線稜鏡轉一下（outBack：一下子轉過去、晃一下停住），扇形跟著擺；色帶在透鏡後面是平行的，字不會動。
//  - 歌詞是入射的白光：左上角「入射光」，逐字跟唱。色帶左端標著一本正經的波長；左下是讀數與註腳。
//  - 沒有留言：色帶上是「宣文♥孟庭」與一行邀請。純音樂：入射光寫歌名。
// 畫法：光路、稜鏡、透鏡、色帶全部在一個全螢幕 shader 裡算（扇形用「這個像素在第幾條光線上」反推）；字是 Canvas2D。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { HEX, rgba } from '../engine/palette';
import { clamp, ease, prog, lerp, TAU } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { lyricAt, beatAfter, signature, fillWithHearts, COUPLE_ZH } from './_motifs';
import { stagger, pad3, mono, tag, type Rect } from './_t11';
import { lyricLine, lyricRows, fitFew, lyricSizeFor } from './_t12';

export const spec: PlateSpecDecl = { group: 'type', family: 'science', paper: false, energy: [0.3, 1], bars: [4, 10], weight: 1 };

// ---------------------------------------------------------------- 版面
/** 稜鏡（正三角形）的重心與邊長；白光從畫面左緣射進來。 */
const PR = { x: 372, y: 566, side: 300 };
const SRC = { x: 128, y: 452 };
/** 準直透鏡的 x、色帶的右端；留言排在色帶上的範圍。 */
const LX = 668, BX1 = 1800;
/** 即時小卡停用之後右邊空出來了：色帶一路延伸到右邊，留言可以排得更大。 */
const TB = { x: 712, w: 1000 };
const MID_Y = 560;
const LYR = { x: 124, base: 214, w: 1200, size: 64 };
const FAM_MSG = F.ming(700);
const INVITE = '掃描右下角 QR code，讓你的祝福也分出七種顏色。';
const FOOT = '＊一道光進去，出來是一整道彩虹。兩個人在一起，也是這樣。';
/** 色相往兩邊轉幾度（光譜的寬度）。 */
const SPREAD = 36;
/** 光譜最多幾條色帶（shader 的陣列大小）。 */
const MAXB = 8;

/** 訊號色轉色相（YIQ 空間繞 Y 軸轉），回傳 0..255 的 sRGB。Canvas 的字與 shader 的色帶用同一條式子。 */
function hueRot(hex: string, deg: number): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const y = 0.299 * r + 0.587 * g + 0.114 * b, i = 0.596 * r - 0.274 * g - 0.322 * b, q = 0.211 * r - 0.523 * g + 0.312 * b;
  const a = (deg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const i2 = i * ca - q * sa, q2 = i * sa + q * ca;
  const out = [y + 0.956 * i2 + 0.621 * q2, y - 0.272 * i2 - 0.647 * q2, y - 1.106 * i2 + 1.703 * q2];
  return out.map((v) => Math.round(clamp(v) * 255)) as [number, number, number];
}
const css = (c: [number, number, number], a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix3 = (a: [number, number, number], b: [number, number, number], k: number): [number, number, number] => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

const BG = () => new FSPass(/* glsl */ `
  uniform vec2 V0; uniform vec2 V1; uniform vec2 V2;   // 稜鏡三個頂點（y 向下）
  uniform vec2 E; uniform vec2 Xa; uniform vec2 Xb;     // 入射點、出射面上光譜的上下端
  uniform vec2 S; uniform vec2 R;                       // 光源、反射光的終點
  uniform float y0; uniform float y1;                   // 色帶的上下緣（透鏡後）
  uniform float nb; uniform float bands[${MAXB + 1}];    // 色帶數、每條色帶的分界（0..1）
  uniform float front; uniform float front2; uniform float pk; uniform float pk2; uniform float k; uniform float kick;
  const float LX = ${LX}.0, BX1 = ${BX1}.0;
  vec3 hueRot(vec3 c, float a) {
    mat3 toY = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
    mat3 fromY = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
    vec3 yiq = toY * c; float ca = cos(a), sa = sin(a);
    yiq.yz = vec2(yiq.y * ca - yiq.z * sa, yiq.y * sa + yiq.z * ca);
    return max(fromY * yiq, 0.0);
  }
  // 光譜顏色：u = 0（上）～ 1（下）。在 sRGB 轉色相再轉回線性，才跟 Canvas 的字同一個顏色。
  vec3 spec(float u) {
    vec3 sg = toSRGB(C_SIGNAL);
    return toLinear(sat(hueRot(sg, radians(${SPREAD}.0) * (u * 2.0 - 1.0))));
  }
  // 第幾條色帶、帶內的位置（色帶邊緣稍微暗一點，看得出一條一條）
  float bandShade(float u) {
    float sh = 0.0;
    for (int i = 0; i < ${MAXB}; i++) {
      if (float(i) >= nb) break;
      float a = bands[i], b = bands[i + 1];
      float d = min(u - a, b - u) / max(b - a, 1e-4);
      if (u >= a && u <= b) sh = 0.55 + 0.45 * smoothstep(0.0, 0.18, d);
    }
    return sh;
  }
  float cross2(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }
  float inTri(vec2 p, vec2 a, vec2 b, vec2 c) {
    float s1 = cross2(b - a, p - a), s2 = cross2(c - b, p - b), s3 = cross2(a - c, p - c);
    return step(0.0, min(min(s1, s2), s3)) + step(0.0, min(min(-s1, -s2), -s3));
  }
  // 脈衝：沿著 x 往右走的一道亮光（front = 目前的位置）
  float pulseAt(float x) { return pk * exp(-pow((x - front) / 46.0, 2.0)) + pk2 * exp(-pow((x - front2) / 46.0, 2.0)); }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 col = C_INK + (C_INK2 - C_INK) * (0.3 + 0.4 * fbm(p / 560.0, 3));
    // 光學台：下方一條細軌道與刻度
    float rail = pxLine(abs(p.y - 912.0), 0.35, 1.2) * step(96.0, p.x) * step(p.x, 1300.0);
    float tick = pxLine(abs(mod(p.x - 96.0 + 20.0, 40.0) - 20.0), 0.3, 1.1) * step(abs(p.y - 920.0), 7.0) * step(96.0, p.x) * step(p.x, 1300.0);
    col += C_BONE * (rail * 0.12 + tick * 0.08) * k;

    float inP = inTri(p, V0, V1, V2);
    // ---- 白光：光源 → 入射點（核心紙白、外面一圈很淡的光暈）
    float db = sdSegment(p, S, E);
    float beam = pxLine(db, 1.2, 2.4) * 0.9 + exp(-db * db / 60.0) * 0.12;
    beam *= 1.0 - inP;
    col += C_BONE * beam * k * (1.0 + 1.8 * pulseAt(p.x));
    // 表面反射（很淡的一道）
    float dr = sdSegment(p, E, R);
    col += C_BONE * pxLine(dr, 0.5, 1.4) * 0.16 * k * (1.0 - inP) * step(S.x + 4.0, p.x);

    // ---- 稜鏡裡：從入射點散開到出射面
    vec2 ea = Xa - E, eb = Xb - E, ep = p - E;
    float aA = atan(ea.y, ea.x), aB = atan(eb.y, eb.x), aP = atan(ep.y, ep.x);
    float u = (aP - aA) / (aB - aA);
    if (inP > 0.5 && u >= 0.0 && u <= 1.0) {
      col += spec(u) * (0.22 + 0.5 * pulseAt(p.x)) * k * bandShade(u);
    }
    // ---- 出射面 → 透鏡：一把扇形（反推這個像素在哪一條光線上：u 疊代三次）
    if (inP < 0.5 && p.x < LX && p.x > min(Xa.x, Xb.x) - 2.0) {
      float uu = 0.5;
      for (int it = 0; it < 4; it++) {
        vec2 X = mix(Xa, Xb, uu), L = vec2(LX, mix(y0, y1, uu));
        float s = (p.x - X.x) / max(L.x - X.x, 1.0);
        float yy = X.y + s * (L.y - X.y);
        float dy = mix(Xb.y - Xa.y, y1 - y0, s);
        uu += (p.y - yy) / dy;
      }
      vec2 X = mix(Xa, Xb, uu), L = vec2(LX, mix(y0, y1, uu));
      float yy = X.y + (p.x - X.x) / max(L.x - X.x, 1.0) * (L.y - X.y);
      // 疊代沒收斂（扇形外面）就不算
      if (uu >= 0.0 && uu <= 1.0 && p.x >= X.x && abs(p.y - yy) < 1.5) col += spec(uu) * (0.2 + 0.55 * pulseAt(p.x)) * k * bandShade(uu);
    }
    // ---- 透鏡後：平行的色帶，往右慢慢淡掉
    if (p.x >= LX && p.y >= y0 && p.y <= y1) {
      float uu = (p.y - y0) / (y1 - y0);
      float fade = 1.0 - smoothstep(BX1 - 260.0, BX1, p.x);
      col += spec(uu) * (0.085 + 0.3 * pulseAt(p.x) + 0.03 * kick) * fade * k * bandShade(uu);
      // 色帶的分界：細線
      float edge = 0.0;
      for (int i = 0; i <= ${MAXB}; i++) { if (float(i) > nb) break; edge = max(edge, pxLine(abs(p.y - mix(y0, y1, bands[i])), 0.3, 1.1)); }
      col += spec(uu) * edge * 0.25 * fade * k;
    }
    // ---- 稜鏡是一塊實心的玻璃（斜投影）：後面的三角形、三條稜、左邊那一面用版畫的刻線打陰影
    vec2 D = vec2(-58.0, -40.0);
    vec2 B0 = V0 + D, B1 = V1 + D, B2 = V2 + D;
    float inSide = inTri(p, V1, V0, B0) + inTri(p, V1, B0, B1);
    float sideShade = min(inSide, 1.0) * (1.0 - inP);
    // 左面：跟稜平行的細刻線（越靠後越密一點）
    vec2 dirL = normalize(V0 - V1);
    float along = dot(p - V1, vec2(-dirL.y, dirL.x));
    col += C_BONE * sideShade * hatch(along / 6.0, 0.14) * 0.16 * k;
    float back = min(min(sdSegment(p, B0, B1), sdSegment(p, B0, B2)), sdSegment(p, B1, B2));
    float ridges = min(min(sdSegment(p, V0, B0), sdSegment(p, V1, B1)), sdSegment(p, V2, B2));
    col += C_BONE * (pxLine(back, 0.4, 1.2) * 0.22 * (1.0 - inP) + pxLine(ridges, 0.5, 1.4) * 0.5) * k;
    float e0 = sdSegment(p, V0, V1), e1 = sdSegment(p, V1, V2), e2 = sdSegment(p, V2, V0);
    float edgeL = pxLine(min(min(e0, e1), e2), 0.6, 1.6);
    col += C_BONE * edgeL * 0.8 * k;
    float hatchIn = inP * hatch(e1 / 7.0, 0.07) * smoothstep(8.0, 60.0, e1) * 0.1;
    col += C_BONE * hatchIn * k;
    // ---- 窗板：牛頓在暗室的窗板上開一個小孔讓陽光進來（直的刻線木板、中間一個孔）
    float board = step(abs(p.x - (S.x - 16.0)), 14.0) * step(340.0, p.y) * step(p.y, 780.0) * (1.0 - step(length(p - vec2(S.x - 16.0, S.y)), 7.0));
    float grain = hatch((p.x - S.x) / 4.0 + 0.3 * sin(p.y * 0.02), 0.25);
    col += C_BONE * board * (0.05 + 0.2 * grain) * k;
    col += C_BONE * pxLine(abs(abs(p.x - (S.x - 16.0)) - 14.0), 0.4, 1.2) * step(340.0, p.y) * step(p.y, 780.0) * 0.45 * k;
    // 孔外面進來的陽光（左邊窗外很淡的一片）
    col += C_BONE * 0.05 * smoothstep(S.x - 30.0, 0.0, p.x) * exp(-pow((p.y - S.y) / 90.0, 2.0)) * k;
    // ---- 準直透鏡：細長的橢圓（兩條弧）
    float ly = (y1 - y0) * 0.5 + 34.0, lc = (y0 + y1) * 0.5;
    vec2 q = vec2((p.x - LX) / 13.0, (p.y - lc) / ly);
    float lens = abs(length(q) - 1.0) * 13.0;
    col += C_BONE * pxLine(lens, 0.4, 1.3) * 0.55 * k * step(abs(p.y - lc), ly);
    fragColor = vec4(col, 1.0);
  }`, {
  V0: { value: new THREE.Vector2() }, V1: { value: new THREE.Vector2() }, V2: { value: new THREE.Vector2() },
  E: { value: new THREE.Vector2() }, Xa: { value: new THREE.Vector2() }, Xb: { value: new THREE.Vector2() },
  S: { value: new THREE.Vector2(SRC.x, SRC.y) }, R: { value: new THREE.Vector2() },
  y0: { value: 400 }, y1: { value: 700 }, nb: { value: 3 }, bands: { value: new Array(MAXB + 1).fill(0) },
  front: { value: -1e4 }, front2: { value: -1e4 }, pk: { value: 0 }, pk2: { value: 0 }, k: { value: 1 }, kick: { value: 0 },
});

interface Ch { ch: string; x: number; y: number; t: number; band: number }

export default class Prism extends Scene {
  bg = shared('prism.bg', BG);
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  hot = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  fit: FitResult | null = null;
  chars: Ch[] = [];
  /** 色帶的分界（0..1）、上下緣（px）、每條的顏色（sRGB）。 */
  bands: number[] = [];
  y0 = 400; y1 = 700; nb = 3;
  cols: [number, number, number][] = [];
  tFirst = 0; speed = 3000;
  sig = ''; sigT = Infinity; sigX = 0; sigY = 0;
  lyricsInWindow = false;
  avoid: Rect[] = [];
  /** 歌詞字級：有留言時比留言小一截（一格只有一個焦點）。 */
  lyrSize = LYR.size;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const text = m ? m.text : COUPLE_ZH.replace(/\s*&\s*/, ' ♥ ');
    this.sig = m ? (m.couple ? '—— 新郎新娘' : signature(m.name)) : '';
    await loadText(`${text}${this.sig}${INVITE}${FOOT}${song.title}${song.artist}入射光出射光稜鏡折射率色散宣文孟庭FIG. 1 · No. 入射角 ° n = 出射光 色 nm ABCF`);
    const c = this.layer.ctx;
    const fit = this.fit = fitFew(c, text, FAM_MSG, TB.w, 400, { min: 48, max: m ? 124 : 104, lineHeight: 1.5, maxLines: 5 });
    this.lyrSize = lyricSizeFor(m ? fit.size : null);
    const n = fit.lines.length;
    // ---- 色帶：每行一條（行高），上下各一條細的（半行高）；整把光譜以 MID_Y 為中線
    const lh = fit.lineHeight, wing = lh * 0.42;
    const total = n * lh + 2 * wing;
    this.y0 = MID_Y - total / 2; this.y1 = MID_Y + total / 2;
    const cuts = [0, wing];
    for (let i = 1; i <= n; i++) cuts.push(wing + i * lh);
    cuts.push(total);
    this.bands = cuts.map((v) => v / total);
    this.nb = n + 2;
    // ---- 時間：第一拍開始每拍一個脈衝；第 k 行在它那一拍的脈衝掃過時亮
    const beat = au.beatPeriod(s);
    this.tFirst = beatAfter(au, s + Math.min(0.2, beat * 0.4));
    this.speed = 1500 / clamp(beat * 0.7, 0.22, 0.55);
    const bar = au.timeOfBar(au.barAt(this.tFirst) + 1) - this.tFirst;
    const lineT = stagger(au, this.tFirst, n, Math.min(1.5 * bar, 0.35 * (e - s)));
    c.font = font(FAM_MSG, fit.size);
    this.chars = [];
    fit.lines.forEach((ln, li) => {
      const yc = this.y0 + wing + (li + 0.5) * lh;
      let x = TB.x;
      for (const ch of Array.from(ln)) {
        const w = c.measureText(ch).width;
        // 脈衝從 x = 0 出發，掃到這個字的時候亮
        this.chars.push({ ch, x, y: yc + fit.size * 0.36, t: lineT[li]! + (x + w * 0.5) / this.speed, band: li + 1 });
        x += w;
      }
    });
    const tLast = Math.max(...this.chars.map((ch) => ch.t));
    this.sigT = tLast + beat * 0.5;
    const wMax = Math.max(...fit.lines.map((l) => c.measureText(l).width));
    // 署名在色帶下面靠右；太低的話不能進右下角 QR 的範圍（x ≥ 1360、y ≥ 830）
    this.sigY = this.y1 + 58;
    this.sigX = this.sigY > 800 ? Math.min(TB.x + wMax, 1340) : TB.x + wMax;
    this.lyricsInWindow = lyrics.linesIn(s, e).length > 0;

    // ---- 即時小卡避開：色帶上的留言（含署名）與左上的歌詞
    const msgR: Rect = [TB.x - 20, Math.round(this.y0 - 10), TB.w + 40, Math.round(this.sigY + (m ? 20 : 70) - this.y0 + 10)];
    const rows = Math.max(1, lyricRows(c, lyrics.linesIn(s, e), { family: F.archivo(100, 800), size: this.lyrSize, minSize: 48, maxWidth: LYR.w }));
    const lyr: Rect = [LYR.x - 12, LYR.base - this.lyrSize - 40, LYR.w + 24, this.lyrSize * (rows > 1 ? 2.35 : 1.25) + 50];
    this.avoid = [msgR, msgR, lyr, lyr];
  }

  /** 稜鏡的幾何（每個小節線轉一下）。 */
  private geo(t: number) {
    const au = this.ctx.audio;
    const b = au.barAt(t), bi = Math.floor(b + 1e-6);
    const tb = au.timeOfBar(bi);
    // 每小節輪流往兩邊轉一點點；outBack：轉過頭一點再停住
    const tgt = (i: number) => (i % 2 ? -1 : 1) * 0.045;
    const rot = lerp(tgt(bi - 1), tgt(bi), ease.outBack(clamp((t - tb) / 0.45)));
    const R = PR.side / Math.sqrt(3);
    const v = [-Math.PI / 2, (5 * Math.PI) / 6, Math.PI / 6].map((a) => ({ x: PR.x + R * Math.cos(a + rot), y: PR.y + R * Math.sin(a + rot) }));
    const [V0, V1, V2] = v as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
    const at = (a: { x: number; y: number }, bb: { x: number; y: number }, k: number) => ({ x: lerp(a.x, bb.x, k), y: lerp(a.y, bb.y, k) });
    const E = at(V1, V0, 0.46);
    const Xa = at(V0, V2, 0.36), Xb = at(V0, V2, 0.62);
    // 表面反射：入射光對左面的法線鏡射
    const fx = V0.x - V1.x, fy = V0.y - V1.y, fl = Math.hypot(fx, fy);
    const nx = fy / fl, ny = -fx / fl;
    const dx = E.x - SRC.x, dy = E.y - SRC.y, dl = Math.hypot(dx, dy);
    const ux = dx / dl, uy = dy / dl, dd = ux * nx + uy * ny;
    const rx = ux - 2 * dd * nx, ry = uy - 2 * dd * ny;
    return { V0, V1, V2, E, Xa, Xb, R: { x: E.x + rx * 150, y: E.y + ry * 150 }, rot };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const vis = prog(t, s, s + 0.3) * (1 - prog(t, e - 0.3, e, ease.inCubic));
    const g = this.geo(t);
    const u = this.bg.u;
    const set = (k: string, p: { x: number; y: number }) => (u[k]!.value as THREE.Vector2).set(p.x, p.y);
    set('V0', g.V0); set('V1', g.V1); set('V2', g.V2); set('E', g.E); set('Xa', g.Xa); set('Xb', g.Xb); set('R', g.R);
    u.y0!.value = this.y0; u.y1!.value = this.y1; u.nb!.value = this.nb;
    const bs = u.bands!.value as number[];
    for (let i = 0; i <= MAXB; i++) bs[i] = this.bands[Math.min(i, this.bands.length - 1)]!;
    // ---- 脈衝：每一拍一道（最近兩道），小節的第一拍比較亮
    const bt = au.beatAt(t), bi = Math.floor(bt + 1e-6);
    const pulse = (i: number) => {
      const tb = au.timeOfBeat(i);
      if (tb < this.tFirst - 1e-3) return { x: -1e4, k: 0 };
      const x = (t - tb) * this.speed;
      const down = Math.abs(au.barAt(tb) - Math.round(au.barAt(tb))) < 0.02;
      return { x, k: (down ? 1 : 0.6) * (1 - clamp((x - 1500) / 300)) };
    };
    const p1 = pulse(bi), p0 = pulse(bi - 1);
    u.front!.value = p1.x; u.pk!.value = p1.k; u.front2!.value = p0.x; u.pk2!.value = p0.k;
    u.k!.value = vis; u.kick!.value = f.a.kick;
    this.bg.render(renderer, out);

    // ---- 顏色：每條色帶的顏色（跟 shader 同一條式子）
    this.cols = this.bands.slice(0, -1).map((a, i) => hueRot(HEX.signal, SPREAD * (((a + this.bands[i + 1]!) / 2) * 2 - 1)));
    const bone = hueRot(HEX.bone, 0);
    const L = this.layer, c = L.ctx, HL = this.hot, hc = HL.ctx;
    L.clear(); HL.clear();
    c.globalAlpha = hc.globalAlpha = vis;
    // ---- 留言：脈衝掃到就亮（燒亮 0.5 秒冷卻），之後每個脈衝經過都閃一下
    const fit = this.fit!;
    c.font = hc.font = font(FAM_MSG, fit.size);
    for (const ch of this.chars) {
      if (t < ch.t) continue;
      const heat = 1 - clamp((t - ch.t) / 0.5);
      const glint = Math.max(p1.k * Math.exp(-(((ch.x - p1.x) / 60) ** 2)), p0.k * Math.exp(-(((ch.x - p0.x) / 60) ** 2)));
      const bc = this.cols[ch.band] ?? bone;
      if (ch.ch === '♥') c.fillStyle = rgba('rose');
      else c.fillStyle = css(mix3(mix3(bone, bc, 0.22), bc, Math.max(heat, glint * 0.5)));
      c.fillText(ch.ch, ch.x, ch.y);
      const h = Math.max(heat, glint * 0.45);
      if (h > 0.04) { hc.fillStyle = css(bc, h * 0.85); hc.fillText(ch.ch, ch.x, ch.y); }
    }
    const m = this.msg;
    if (m && t >= this.sigT) {
      c.save(); c.globalAlpha *= prog(t, this.sigT, this.sigT + 0.35);
      c.font = font(F.ming(400), 38); c.fillStyle = rgba('ash'); c.textAlign = 'right';
      fillWithHearts(c, this.sig, this.sigX, this.sigY);
      c.restore();
    }
    if (!m) {
      c.save(); c.globalAlpha *= prog(t, this.sigT, this.sigT + 0.4);
      c.font = font(F.hand(700), 44); c.fillStyle = rgba('bone', 0.9);
      c.fillText(INVITE, TB.x + 4, this.sigY + 10);
      c.restore();
    }
    // 版畫圖版的字母標註（像牛頓《光學》的插圖）
    c.font = font(F.serif(400, true), 22); c.fillStyle = rgba('ash', 0.6);
    c.fillText('A', g.V0.x + 12, g.V0.y + 4); c.fillText('B', g.V1.x - 28, g.V1.y + 16); c.fillText('C', g.V2.x + 10, g.V2.y + 20);
    c.fillText('F', SRC.x - 22, SRC.y - 118);
    this.lyric(c, t);
    // ---- 註腳（配角的字只留一行）
    tag(c, FOOT, LYR.x, 984, { size: 16, color: rgba('ash', 0.55), tracking: 1 });
    comp.draw(renderer, L.upload(), out);
    comp.draw(renderer, HL.upload(), out, { mode: 'add', tint: [1.7, 1.7, 1.7] });
    void TAU;
    // 鏡頭：整個窗格慢慢推近（像電影），大鼓時輕輕頂一下
    return { bloom: 0.8, vignette: 0.45, halation: 0.3, zoom: 1 + 0.025 * ease.inOutCubic(f.p) + 0.004 * f.a.kick, popupAvoid: this.avoid };
  }

  /** 左上的歌詞（入射的白光）：逐字跟唱；純音樂寫歌名。 */
  private lyric(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    const ly = lyricAt(lyrics, t);
    if (!ly) {
      if (!this.lyricsInWindow) { c.font = font(F.archivo(100, 700), 58); c.fillStyle = rgba('bone', 0.88); c.fillText(song.title, LYR.x, LYR.base); }
      return;
    }
    const st = { family: F.archivo(100, 800), size: this.lyrSize, minSize: 48, maxWidth: LYR.w };
    const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.1));
    c.save(); c.translate(LYR.x, LYR.base + (1 - inK) * 14);
    lyricLine(c, ly.line, t, st, ly.k * c.globalAlpha);
    c.restore();
  }
}
