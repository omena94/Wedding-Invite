// 大樓 LED 牆（暗，批次 B3・街景）：夜裡的十字路口，站在人行道上抬頭看。左邊一棟大樓的轉角包著一面彎曲的 LED 廣告牆，
// 右邊另一棟樓掛著一塊比較小的直式 LED 看板；下面是濕的路面、斑馬線、紅綠燈，幾個路人的剪影停下來抬頭看。
//  - 兩行歌詞是 LED 牆上的大字：中文在上（40～52 px）、原文在下（約 0.68 倍），各照自己的逐字時間亮
//   （還沒唱是暗暗的、唱到的字是訊號色、唱完是白光；原文唱到就轉白、暗兩成）。牆是彎的（中間凸出來，兩邊往後退、暗一點），
//    字跟著彎；一顆顆 LED 的點看得到。字後面是一直在動的廣告動畫（大片的色光慢慢流動），每一拍中間漾開一圈光，
//    每個小節線整面換一個顏色（由左往右刷過去）。沒有翻譯：只有中文，置中。純音樂：牆上是新人的名字與日期。
//  - 主打留言是右邊的直式 LED 看板（留言區約 390×430）：第一拍起一行一行「跑」上來（每一行從下往上捲進來），署名在最後一行下面；
//    看板外框一圈小燈照拍子跑。沒有留言：看板是邀請。
//  - 路口一直在動：每一拍一台車開過（車燈在濕路面上拉出光帶）、紅綠燈每兩小節換一次、行人號誌跟著；LED 牆的光映在濕地上；
//    路人有的走過去、有的停下來抬頭看，手機螢幕在小節線亮一下（像在拍照）。鏡頭很慢地往上搖、推近一點。
//  - 右下角（HUD）是暗的人行道，路人與車燈都不進去。
// 手法：天空、樓、LED 牆（彎曲的取樣、LED 點陣、光暈）、直式看板、路面與倒影、車燈都在一個全螢幕 shader；
// LED 牆的內容（廣告動畫＋歌詞）每格畫在一張 Canvas；直式看板的內容 init() 畫一次、每格只改「捲到哪一行」；路人剪影是另一張 Canvas。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp, pulse } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { beatAfter, drawHeart, fillWithHearts, COUPLE_ZH, COUPLE_EN, DATE_DOTS } from './_motifs';
import { V2, lyricV2 } from './_v2';
import { loadB3, layoutBi, paintBi, msgBlock, type BiLayout, type MsgBlock, type Rect } from './_b3';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'city', paper: false, energy: [0.4, 1], bars: [4, 8], weight: 1 };

/** LED 牆（畫面上的範圍，中間凸出 BULGE px）與它的內容畫布。 */
const WALL = { x0: 170, x1: 1170, y0: 110, y1: 500, bulge: 20 };
const LW = WALL.x1 - WALL.x0, LH = WALL.y1 - WALL.y0;
/** 直式看板（右邊的樓）與裡面留言的框。 */
const SIGN = { x: 1404, y: 96, w: 436, h: 680 };
const SMSG = { x: 26, y: 118, w: 384, h: 430 };
/** 地平線（樓的底）、路緣。 */
const BASE = 706;

const BG = () => new FSPass(/* glsl */ `
  uniform sampler2D led; uniform sampler2D sgn; uniform float t; uniform float tilt; uniform float zoom;
  uniform vec4 cars[4]; uniform float light; uniform float wipe; uniform vec3 wipeCol; uniform float glowK; uniform float signK;
  const vec4 WR = vec4(${WALL.x0}.0, ${WALL.x1}.0, ${WALL.y0}.0, ${WALL.y1}.0);
  // LED 牆的取樣：彎曲（圓柱）→ 內容的 uv；回傳 (u, v, 在不在牆上, 朝向鏡頭的程度)
  vec4 wallUV(vec2 p) {
    float cx = (WR.x + WR.y) * 0.5, hw = (WR.y - WR.x) * 0.5, R = hw * 1.25;
    float s = clamp((p.x - cx) / R, -1.0, 1.0);
    float th = asin(s), thMax = asin(hw / R);
    float u = 0.5 + 0.5 * th / thMax;
    float k = 1.0 - cos(th);
    float top = WR.z + ${WALL.bulge}.0 * k / (1.0 - cos(thMax)), bot = WR.w - ${WALL.bulge}.0 * k / (1.0 - cos(thMax));
    float v = (p.y - top) / (bot - top);
    float inW = step(WR.x, p.x) * step(p.x, WR.y) * step(0.0, v) * step(v, 1.0);
    return vec4(u, v, inW, cos(th));
  }
  vec3 ledAt(vec2 uv) { vec4 c = fastLayer(texture(led, vec2(uv.x, 1.0 - uv.y))); return c.rgb; }
  // LED 點陣：每 pitch px 一顆，點與點之間暗一點（字還是讀得清楚）
  float dots(vec2 p, float pitch) {
    vec2 f = fract(p / pitch) - 0.5;
    return mix(0.42, 1.0, 1.0 - smoothstep(0.28, 0.46, length(f)));
  }
  void main() {
    vec2 p0 = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = vec2(960.0, 600.0) + (p0 - vec2(960.0, 600.0)) / zoom + vec2(0.0, tilt);
    // LED 牆的光（取幾個點平均）：染在樓、天空、地上
    vec3 spill = (ledAt(vec2(0.2, 0.5)) + ledAt(vec2(0.5, 0.3)) + ledAt(vec2(0.8, 0.5)) + ledAt(vec2(0.5, 0.75))) * 0.25 * glowK;
    // 夜空：很暗，接近樓頂的地方被城市的光染一點
    vec3 col = mix(C_INK * 0.35, C_INK2 * 0.9 + C_BLOOD * 0.03, smoothstep(0.0, 700.0, p.y));
    // 遠處的樓（很暗，零星亮窗）：兩棟樓中間的縫看得到
    float fx = floor(p.x / 110.0);
    float fh = mix(300.0, 560.0, hash11(fx * 1.7 + 2.0));
    if (p.y > ${BASE}.0 - fh) {
      col = C_INK * 0.75 + C_INK2 * 0.15;
      vec2 wc = floor(vec2(p.x / 16.0, p.y / 22.0));
      vec2 wf = fract(vec2(p.x / 16.0, p.y / 22.0));
      col += (C_EMBER * 0.07 + C_BONE * 0.015) * step(0.3, wf.x) * step(wf.x, 0.7) * step(0.35, wf.y) * step(wf.y, 0.7) * step(0.86, hash12(wc));
    }
    // 左邊的大樓：玻璃帷幕（深色、一格一格的直條，映著 LED 的光），樓頂一條線
    vec4 w = wallUV(p);
    bool inB = p.x > ${WALL.x0 - 60}.0 && p.x < ${WALL.x1 + 60}.0 && p.y > 36.0 && p.y < ${BASE}.0;
    if (inB) {
      float mull = step(0.95, fract(p.x / 58.0)) + step(0.96, fract(p.y / 70.0));
      float refl = 0.5 + 0.5 * snoise(vec2(p.x / 300.0, p.y / 90.0) + t * 0.02);
      col = C_INK * 0.9 + C_INK2 * 0.3 + spill * 0.08 * refl;
      col = mix(col, C_GRAPHITE * 0.06, clamp(mull, 0.0, 1.0));
      if (p.y < 44.0) col = C_GRAPHITE * 0.2;
      // LED 牆下面的樓層：零星亮著的辦公室（一格裡面一小扇窗，很淡）
      vec2 wc = floor(vec2(p.x / 58.0, p.y / 70.0)), wf = fract(vec2(p.x / 58.0, p.y / 70.0));
      float ow = step(0.15, wf.x) * step(wf.x, 0.85) * step(0.3, wf.y) * step(wf.y, 0.75);
      col += (C_EMBER * 0.018 + C_BONE * 0.006) * ow * step(${WALL.y1 + 40}.0, p.y) * step(p.y, ${BASE - 60}.0) * step(0.7, hash12(wc + 11.0));
      // 一樓的店面：一排暖暖的玻璃（很低調）
      if (p.y > ${BASE - 56}.0) col = C_INK2 * 0.35 + (C_EMBER * 0.014 + C_BONE * 0.003) * step(0.08, fract(p.x / 150.0)) * step(${BASE - 50}.0, p.y) * step(0.35, hash11(floor(p.x / 150.0) + 3.0));
    }
    // LED 牆：內容、點陣、兩側轉離鏡頭暗一點；每個小節線換色的光刷過去
    if (w.z > 0.5) {
      vec3 c = ledAt(w.xy);
      float fac = mix(0.4, 1.0, pow(w.w, 3.0));
      c *= dots(p0, 4.0) * fac;
      float wb = (1.0 - smoothstep(0.0, 0.05, abs(w.x - wipe))) * step(0.0, wipe) * step(wipe, 1.0);
      c += wipeCol * 0.5 * wb;
      col = C_INK * 0.3 + c * glowK;
    } else if (inB) {
      // 牆的鋁框（上下緣）
      vec4 wt = wallUV(p + vec2(0.0, 9.0)), wb = wallUV(p - vec2(0.0, 9.0));
      if ((wt.z > 0.5 || wb.z > 0.5) && p.x > ${WALL.x0}.0 && p.x < ${WALL.x1}.0) col = C_GRAPHITE * 0.2 + spill * 0.1;
    }
    // 空氣裡 LED 的光暈（牆外面一圈）
    col += spill * 0.1 * exp(-length((p - vec2(${(WALL.x0 + WALL.x1) / 2}.0, ${(WALL.y0 + WALL.y1) / 2}.0)) / vec2(760.0, 360.0))) * (1.0 - w.z);
    // 右邊的樓與直式看板
    if (p.x > ${SIGN.x - 44}.0 && p.y > 20.0 && p.y < ${BASE}.0) {
      col = C_INK * 0.85 + C_INK2 * 0.3;
      col *= 1.0 - 0.3 * step(0.95, fract(p.y / 72.0));
      vec2 q = p - vec2(${SIGN.x}.0, ${SIGN.y}.0);
      if (q.x > -12.0 && q.y > -12.0 && q.x < ${SIGN.w}.0 + 12.0 && q.y < ${SIGN.h}.0 + 12.0) {
        col = C_GRAPHITE * 0.16;
        if (q.x > 0.0 && q.y > 0.0 && q.x < ${SIGN.w}.0 && q.y < ${SIGN.h}.0) {
          vec4 s = fastLayer(texture(sgn, vec2(q.x / ${SIGN.w}.0, 1.0 - q.y / ${SIGN.h}.0)));
          col = C_INK * 0.3 + s.rgb * dots(p0, 3.0) * signK;
        }
      }
      if (p.y > ${BASE - 56}.0) col = C_INK2 * 0.35 + (C_EMBER * 0.014 + C_BONE * 0.003) * step(0.1, fract(p.x / 120.0)) * step(${BASE - 50}.0, p.y) * step(0.35, hash11(floor(p.x / 120.0) + 7.0));
    }
    // 路面（濕的柏油）：LED 牆與看板模糊的倒影、車燈的光帶、斑馬線
    if (p.y >= ${BASE}.0) {
      float v = (p.y - ${BASE}.0) / (${H}.0 - ${BASE}.0);
      col = C_INK * (0.65 + 0.1 * snoise(vec2(p.x / 40.0, p.y / 8.0)));
      if (p.y < ${BASE}.0 + 14.0) col = C_INK2 * 0.9;
      // 斑馬線（路中間一段，往鏡頭這邊越寬），很低調
      float zx = (p.x - 700.0) / (0.4 + v * 1.6);
      float zb = step(0.5, fract(zx / 110.0)) * step(${BASE}.0 + 70.0, p.y) * step(p.y, ${BASE}.0 + 170.0) * smoothstep(120.0, 260.0, p.x) * (1.0 - smoothstep(1180.0, 1300.0, p.x));
      col = mix(col, C_ASH * 0.03, zb);
      // 倒影：以樓底為鏡，只映出兩塊螢幕的「光」（整塊的顏色），被水波打散成一條一條（不映出字）
      float ry = 2.0 * ${BASE}.0 - p.y - 30.0;
      float rx = p.x + (6.0 + 14.0 * v) * sin(p.y * 0.12 + t * 2.4);
      vec4 rw = wallUV(vec2(rx, ry));
      float ripple = 0.35 + 0.65 * smoothstep(0.2, 0.8, snoise(vec2(p.x / 140.0, p.y / 10.0 - t * 0.6)) * 0.5 + 0.5);
      vec3 refl = rw.z * spill * 0.5;
      vec2 rq = vec2(rx, ry) - vec2(${SIGN.x}.0, ${SIGN.y}.0);
      refl += step(0.0, rq.x) * step(rq.x, ${SIGN.w}.0) * step(0.0, rq.y) * step(rq.y, ${SIGN.h}.0) * (C_BONE * 0.01 + C_SIGNAL * 0.01) * signK;
      col += refl * ripple * glowK;
      // 車燈：頭燈（白）與尾燈（訊號色的暗部），路上一團光、在濕地上拉長
      for (int i = 0; i < 4; i++) {
        vec4 c = cars[i];
        if (c.z <= 0.0) continue;
        float cy = ${BASE}.0 + 36.0 + c.w * 20.0;
        vec3 lc = c.y > 0.0 ? C_BONE * 1.2 + C_EMBER * 0.2 : C_BLOOD * 1.3;
        vec2 d = (p - vec2(c.x + c.y * 70.0, cy)) / vec2(14.0, 6.0);
        col += lc * exp(-dot(d, d)) * c.z;
        vec2 d2 = (p - vec2(c.x + c.y * 70.0, cy + 70.0)) / vec2(12.0, 70.0);
        col += lc * 0.14 * exp(-dot(d2, d2)) * c.z;
        col += lc * 0.05 * exp(-length((p - vec2(c.x + c.y * 200.0, cy + 8.0)) / vec2(220.0, 18.0))) * c.z;
      }
      // 右下角（HUD）：倒影、光帶都收掉，保持暗的人行道
      col = mix(col, C_INK * 0.6, smoothstep(1250.0, 1350.0, p0.x) * smoothstep(740.0, 820.0, p0.y));
    }
    fragColor = vec4(col, 1.0);
  }`, {
  led: { value: null }, sgn: { value: null }, t: { value: 0 }, tilt: { value: 0 }, zoom: { value: 1 },
  cars: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) }, light: { value: 1 },
  wipe: { value: -1 }, wipeCol: { value: new THREE.Vector3(1, 1, 1) }, glowK: { value: 1 }, signK: { value: 1 },
});

export default class Billboard extends Scene {
  bg = shared('billboard.bg', BG);
  led = this.track(new Layer2D(LW, LH, undefined, { fast: true }));
  sgn = this.track(new Layer2D(SIGN.w, SIGN.h, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 97 + (this.msg?.id ?? 0) * 11) >>> 0;
  mb: MsgBlock | null = null;
  /** 直式看板（不會變的部分）、留言每一行捲上來的時間。 */
  signBase: HTMLCanvasElement | null = null;
  rowT: number[] = [];
  sigT = Infinity;
  lays = new Map<Line, BiLayout>();
  hasLyrics = false;
  tOn = 0;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadB3(this.ctx, `${COUPLE_EN}LIVE 祝福現場直播今晚的主角`);
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
    this.tOn = beatAfter(au, s + 0.05);
    this.buildSign();
    const size = lyricV2(this.mb ? this.mb.fit.size : null);
    const c = this.led.ctx;
    for (const l of lyrics.linesIn(s - 14, e + 1)) this.lays.set(l, layoutBi(c, l, { family: F.hei(900), size, minSize: V2.lyrMin, maxWidth: LW - 180, align: 'center', lineHeight: 1.14, subFamily: F.hei(700) }));
    this.avoid = [[WALL.x0, WALL.y0, LW, LH], [SIGN.x, SIGN.y, SIGN.w, SIGN.h]];
  }

  /** 直式看板：上面一條標題、下面一條日期；中間是留言（一行一行捲上來，每格畫）。這裡先把不會變的畫好、排好留言。 */
  private buildSign() {
    const { audio: au } = this.ctx;
    const m = this.msg;
    const cv = document.createElement('canvas');
    cv.width = SIGN.w; cv.height = SIGN.h;
    const c = cv.getContext('2d')!;
    c.textBaseline = 'alphabetic';
    c.fillStyle = rgba('ink2'); c.fillRect(0, 0, SIGN.w, SIGN.h);
    // 標題列（訊號色的底）
    c.fillStyle = mixRgba('signal', 'blood', 0.35); c.fillRect(0, 0, SIGN.w, 70);
    c.font = font(F.hei(900), 28); c.fillStyle = rgba('ink', 0.92); c.letterSpacing = '6px';
    c.fillText(m?.couple ? '新人留言' : 'LIVE 祝福', 26, 46); c.letterSpacing = '0px';
    c.textAlign = 'right'; c.font = font(F.mono(700), 18); c.fillText(m ? `No.${String(m.n).padStart(3, '0')}` : 'LIVE', SIGN.w - 24, 44); c.textAlign = 'left';
    // 下面：日期
    c.fillStyle = rgba('bone', 0.1); c.fillRect(0, SIGN.h - 64, SIGN.w, 64);
    c.font = font(F.mono(500), 18); c.fillStyle = rgba('bone', 0.6); c.letterSpacing = '5px'; c.fillText(DATE_DOTS, 26, SIGN.h - 26); c.letterSpacing = '0px';
    drawHeart(c, SIGN.w - 40, SIGN.h - 32, 22, mixRgba('rose', 'bone', 0.1));
    this.signBase = cv;
    if (m) {
      const mb = (this.mb = msgBlock(c, m, F.hei(700), SMSG.w, SMSG.h, { sigFamily: F.hei(500), lineHeight: 1.3 }));
      // 一行一拍捲上來（第一拍開始；行多就半拍一行）
      const n = mb.fit.lines.length;
      const b0 = au.beatAt(this.tOn);
      const stepB = n > 5 ? 0.5 : 1;
      this.rowT = Array.from({ length: n }, (_, i) => au.timeOfBeat(b0 + i * stepB));
      this.sigT = au.timeOfBeat(b0 + n * stepB + 0.5);
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const p = ease.inOutQuad(prog(t, s, e));
    this.drawLED(t);
    this.drawSign(t);
    const u = this.bg.u;
    u.led!.value = this.led.texture; u.sgn!.value = this.sgn.texture;
    u.t!.value = t; u.zoom!.value = 1 + 0.03 * p; u.tilt!.value = -14 * p;
    // 每個小節線換色：由左往右刷過去
    const bar = au.barAt(t), bi = Math.floor(bar + 1e-6);
    u.wipe!.value = clamp((t - au.timeOfBar(bi)) / 0.35) < 1 ? clamp((t - au.timeOfBar(bi)) / 0.35) : -1;
    const wc = this.hue(bi);
    (u.wipeCol!.value as THREE.Vector3).set(wc[0], wc[1], wc[2]);
    // LED 牆第一拍通電（閃兩下）
    u.glowK!.value = this.onK(t, this.tOn);
    u.signK!.value = this.onK(t, this.tOn + 0.1);
    // 紅綠燈：兩小節換一次
    u.light!.value = Math.floor(bar / 2) % 2 === 0 ? 1 : 0;
    // 車：每一拍有一台（方向、車道照拍子編號雜湊），綠燈時多一點
    const CV = u.cars!.value as THREE.Vector4[];
    const bt = Math.floor(au.beatAt(t));
    for (let i = 0; i < 4; i++) {
      const b = bt - i;
      const dir = hash(this.seed, b, 1) < 0.5 ? 1 : -1;
      const d = t - au.timeOfBeat(b);
      const x = dir > 0 ? -150 + d * 1100 : 1500 - d * 1100;
      // 車不開進右下角（HUD 前面那一段路是空的）
      const on = hash(this.seed, b, 2) < 0.8 && d < 2.2 && x < 1240 && x > -200 ? 1 : 0;
      CV[i]!.set(x, dir, on, dir > 0 ? 1 : 0);
    }
    this.bg.render(renderer, out);
    // 前景：車身、紅綠燈、路人剪影（跟背景一起推、搖）
    this.drawFront(t, CV, 1 + 0.03 * p, -14 * p);
    comp.draw(renderer, this.fg.upload(), out);
    const hit = pulse(t, this.tOn, 0.1);
    return { bloom: 0.6, vignette: 0.55, grain: 0.06, halation: 0.25, shake: [0, hit * 2], popupAvoid: this.avoid };
  }

  /** 通電：t0 前一點點閃兩下，之後全亮。 */
  private onK(t: number, t0: number) {
    const d = t - t0;
    if (d >= 0) return 1;
    if (d > -0.08) return 0.8;
    if (d > -0.18) return 0.12;
    if (d > -0.24) return 0.7;
    return 0.06;
  }

  /** 每個小節一個廣告顏色（主題的訊號色一家子輪流）。 */
  private hue(bi: number): [number, number, number] {
    const keys = ['signal', 'blood', 'ember', 'rose'] as const;
    const k = keys[((bi % 4) + 4) % 4]!;
    const hex = rgba(k).match(/\d+/g)!.map(Number);
    return [hex[0]! / 255, hex[1]! / 255, hex[2]! / 255];
  }

  /**
   * LED 牆的內容：整面是一直在動的廣告動畫——大片的色光流動、斜的光條往右掃、每一拍從中間漾開一圈光、
   * 每個小節線換一組顏色；中間一條暗帶，上面兩行歌詞。
   */
  private drawLED(t: number) {
    const { lyrics, audio: au, song } = this.ctx;
    const L = this.led; L.clear(rgba('ink'));
    const c = L.ctx;
    const bar = Math.floor(au.barAt(t) + 1e-6);
    const pal = ['signal', 'blood', 'ember', 'rose'];
    const k1 = pal[((bar % 4) + 4) % 4]!, k2 = pal[((bar + 1) % 4 + 4) % 4]!;
    // 流動的色光：四團大大的光慢慢繞（亮一點，整面牆是會發光的廣告）
    for (let i = 0; i < 4; i++) {
      const x = LW * (0.5 + 0.48 * Math.sin(t * 0.45 + i * 1.9)), y = LH * (0.5 + 0.42 * Math.cos(t * 0.37 + i * 1.3));
      const r = LH * (0.55 + 0.18 * i);
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, mixRgba(i % 2 ? k2 : k1, 'ink', 0.1, 0.9)); g.addColorStop(1, rgba('ink', 0));
      c.fillStyle = g; c.fillRect(0, 0, LW, LH);
    }
    // 斜的光條往右掃（拍子的前半段比較亮）
    const bt = au.beatAt(t), bph = bt - Math.floor(bt);
    c.save(); c.globalAlpha = 0.05 + 0.08 * (1 - bph); c.fillStyle = rgba('bone');
    const off = (t * 140) % 140;
    for (let x = -LH; x < LW + LH; x += 140) { c.beginPath(); c.moveTo(x + off, LH); c.lineTo(x + off + 24, LH); c.lineTo(x + off + 24 + LH * 0.6, 0); c.lineTo(x + off + LH * 0.6, 0); c.closePath(); c.fill(); }
    c.restore();
    // 每一拍中間漾開一圈光
    const d = bph * au.beatPeriod(t);
    c.save(); c.strokeStyle = mixRgba(k1, 'bone', 0.5, Math.max(0, 0.7 - d * 1.2)); c.lineWidth = 14;
    c.beginPath(); c.ellipse(LW / 2, LH / 2, 80 + d * 1000, 36 + d * 440, 0, 0, Math.PI * 2); c.stroke(); c.restore();
    // 字後面一條暗帶（字清楚）；上下兩條細的訊號色線跟著拍子閃
    const bandH = 190;
    const band = c.createLinearGradient(0, LH / 2 - bandH / 2 - 40, 0, LH / 2 + bandH / 2 + 40);
    band.addColorStop(0, rgba('ink', 0)); band.addColorStop(0.22, rgba('ink', 0.82)); band.addColorStop(0.78, rgba('ink', 0.82)); band.addColorStop(1, rgba('ink', 0));
    c.fillStyle = band; c.fillRect(0, LH / 2 - bandH / 2 - 40, LW, bandH + 80);
    c.fillStyle = mixRgba(k1, 'bone', 0.3, 0.35 + 0.5 * (1 - bph));
    c.fillRect(LW * 0.1, LH / 2 - bandH / 2, LW * 0.8, 2); c.fillRect(LW * 0.1, LH / 2 + bandH / 2, LW * 0.8, 2);
    const ink = { unsung: rgba('bone', 0.28), active: mixRgba('signal', 'ember', 0.25), sung: rgba('bone', 0.97) };
    c.textAlign = 'left';
    if (!this.hasLyrics) {
      c.textAlign = 'center';
      c.font = font(F.hei(900), V2.lyrMax); c.fillStyle = rgba('bone', 0.97); c.fillText(COUPLE_ZH, LW / 2, LH / 2 + 4);
      c.font = font(F.hei(700), 34); c.fillStyle = rgba('bone', 0.75); c.fillText(`${COUPLE_EN}  ·  ${DATE_DOTS}`, LW / 2, LH / 2 + 56);
      if (song.title) { c.font = font(F.mono(500), 20); c.fillStyle = rgba('bone', 0.55); c.fillText(`♪ ${song.title}`, LW / 2, LH / 2 - 70); }
      c.textAlign = 'left';
      L.upload();
      return;
    }
    const line = lyrics.shownLine(t, 1e4, 0.35) ?? lyrics.nextLine(t);
    const bl = line ? this.lays.get(line) : null;
    if (line && bl) {
      // 換句時：新的一句從下面彈上來
      const kin = ease.outBack(clamp((t - (line.start - 0.35)) / 0.3), 1.4);
      c.save();
      c.beginPath(); c.rect(0, LH / 2 - bandH / 2 + 4, LW, bandH - 8); c.clip();
      c.translate(LW / 2, LH / 2 - bl.height / 2 + bl.main.size * 0.9 + (1 - kin) * 50);
      c.globalAlpha = clamp(kin * 1.5);
      paintBi(c, bl, t, ink);
      c.restore();
    }
    L.upload();
  }

  /** 直式看板：留言一行一拍從下面捲上來；外框一圈小燈照拍子跑。 */
  private drawSign(t: number) {
    const S = this.sgn; S.clear();
    const c = S.ctx;
    if (this.signBase) c.drawImage(this.signBase, 0, 0);
    const au = this.ctx.audio;
    // 外框的跑馬燈（每一拍往前一格）
    const bt = au.beatAt(t);
    const per = 2 * (SIGN.w + SIGN.h), n = 44;
    for (let i = 0; i < n; i++) {
      let d = (i / n) * per;
      let x: number, y: number;
      if (d < SIGN.w) { x = d; y = 6; } else if ((d -= SIGN.w) < SIGN.h) { x = SIGN.w - 6; y = d; } else if ((d -= SIGN.h) < SIGN.w) { x = SIGN.w - d; y = SIGN.h - 6; } else { d -= SIGN.w; x = 6; y = SIGN.h - d; }
      const on = (i + Math.floor(bt * 2)) % 4 === 0;
      c.fillStyle = on ? mixRgba('signal', 'ember', 0.3) : rgba('bone', 0.12);
      c.beginPath(); c.arc(x, y, on ? 4 : 3, 0, Math.PI * 2); c.fill();
    }
    const m = this.msg, mb = this.mb;
    c.save(); c.beginPath(); c.rect(12, 80, SIGN.w - 24, SIGN.h - 156); c.clip();
    if (m && mb) {
      const top = SMSG.y + Math.max(0, (SMSG.h - mb.h) * 0.35);
      const { fit } = mb;
      c.font = font(mb.family, fit.size); c.textBaseline = 'alphabetic';
      fit.lines.forEach((ln, i) => {
        const k = ease.outCubic(clamp((t - this.rowT[i]!) / 0.22));
        if (k <= 0) return;
        const y = top + mb.base0 + i * fit.lineHeight + (1 - k) * fit.lineHeight;
        c.save(); c.beginPath(); c.rect(0, top + mb.base0 + (i - 0.95) * fit.lineHeight, SIGN.w, fit.lineHeight * 1.1); c.clip();
        c.globalAlpha = k;
        c.fillStyle = rgba('bone', 0.97);
        c.translate(SMSG.x, 0);
        // 愛心用我們自己的（玫瑰色）
        fillWithHearts(c, ln, 0, y);
        c.restore();
      });
      const sk = clamp((t - this.sigT) / 0.3);
      if (sk > 0) {
        c.save(); c.translate(SMSG.x, top); c.globalAlpha = sk;
        c.font = font(mb.sig.family, mb.sig.size); c.fillStyle = mixRgba('signal', 'ember', 0.3);
        const sw = c.measureText(mb.sig.text).width;
        c.fillText(mb.sig.text, Math.max(0, mb.w - sw), mb.sigY);
        c.restore();
      }
    } else {
      c.textBaseline = 'alphabetic';
      c.font = font(F.hei(900), 52); c.fillStyle = rgba('bone', 0.97);
      fillWithHearts(c, COUPLE_ZH.replace(/\s*&\s*/, ' ♥ '), SMSG.x, 280);
      c.font = font(F.hei(700), 28); c.fillStyle = rgba('bone', 0.8);
      c.fillText('今晚的主角', SMSG.x, 346);
      c.font = font(F.hei(500), 22); c.fillStyle = mixRgba('signal', 'ember', 0.3);
      c.fillText('掃描右下角 QR code，', SMSG.x, 470); c.fillText('把你的祝福寫上大螢幕', SMSG.x, 504);
    }
    c.restore();
    S.upload();
  }

  /**
   * 前景（一張 Canvas）：開過去的車（黑色的車身剪影，車燈在 shader 裡）、紅綠燈、路人剪影。
   * 路人站在這一邊的人行道上（有的停下來抬頭看、有的走過去），LED 的光在頭頂與肩膀勾一條淡淡的邊；小節線上有人舉手機拍一下。
   */
  private drawFront(t: number, cars: THREE.Vector4[], zoom: number, tilt: number) {
    const au = this.ctx.audio;
    const F2 = this.fg; F2.clear();
    const c = F2.ctx;
    const bar = au.barAt(t), bi = Math.floor(bar + 1e-6), bt = au.beatAt(t);
    // 車與紅綠燈在街上：跟背景一樣推近、往上搖（背景 shader 的 p = 中心 + (螢幕 - 中心) / zoom + tilt）
    c.save();
    c.translate(960, 600); c.scale(zoom, zoom); c.translate(-960, -600 - tilt);
    // 車身：矮矮的剪影，車頂被 LED 照到一條邊
    for (const cv of cars) {
      if (cv.z <= 0) continue;
      const y = BASE + 36 + cv.w * 20, x = cv.x;
      c.save(); c.translate(x, y); c.scale(cv.y, 1);
      c.fillStyle = rgba('ink', 0.94);
      c.beginPath(); c.moveTo(-70, 10); c.lineTo(-66, -14); c.lineTo(-30, -18); c.lineTo(-12, -40); c.lineTo(36, -40); c.lineTo(52, -18); c.lineTo(76, -14); c.lineTo(80, 10); c.closePath(); c.fill();
      c.strokeStyle = mixRgba('signal', 'bone', 0.4, 0.35); c.lineWidth = 2;
      c.beginPath(); c.moveTo(-12, -40); c.lineTo(36, -40); c.stroke();
      c.restore();
    }
    // 紅綠燈：一根柱子、燈箱，紅綠兩小節換一次
    const green = Math.floor(bar / 2) % 2 === 0;
    c.fillStyle = mixRgba('graphite', 'ink', 0.5); c.fillRect(1314, 560, 8, BASE + 110 - 560);
    c.fillStyle = rgba('ink', 0.95); c.beginPath(); c.roundRect(1298, 506, 40, 96, 8); c.fill();
    c.fillStyle = green ? rgba('ink2') : rgba('blood'); c.beginPath(); c.arc(1318, 530, 11, 0, Math.PI * 2); c.fill();
    c.fillStyle = green ? mixRgba('signal', 'bone', 0.5) : rgba('ink2'); c.beginPath(); c.arc(1318, 578, 11, 0, Math.PI * 2); c.fill();
    c.restore();
    // 路人
    const people = [
      { x: 180, h: 200, look: 1, phone: false, walk: 0 }, { x: 290, h: 186, look: 1, phone: true, walk: 0 },
      { x: 470, h: 206, look: 0.3, phone: false, walk: 1 }, { x: 700, h: 192, look: 1, phone: true, walk: 0 },
      { x: 800, h: 178, look: 0.7, phone: false, walk: 0 }, { x: 1010, h: 198, look: 0.2, phone: false, walk: -1 },
    ];
    const rim = mixRgba('signal', 'bone', 0.45, 0.4);
    people.forEach((pp, i) => {
      // 走路的人：一拍一步，慢慢走過（在畫面左半邊，不進 HUD）
      const x = pp.walk ? pp.x + pp.walk * (((t * 60 + i * 90) % 360) - 180) : pp.x + 3 * Math.sin(t * 0.7 + i);
      const foot = 1072 - (i % 3) * 10, h = pp.h;
      const step = pp.walk ? Math.sin(bt * Math.PI) : 0;
      c.save();
      c.translate(x, foot);
      c.fillStyle = rgba('ink', 0.97);
      // 腿
      c.beginPath(); c.moveTo(-h * 0.07, -h * 0.47); c.lineTo(-h * 0.06 - step * 12, 0); c.lineTo(-h * 0.01 - step * 12, 0); c.lineTo(0, -h * 0.36);
      c.lineTo(h * 0.01 + step * 12, 0); c.lineTo(h * 0.06 + step * 12, 0); c.lineTo(h * 0.07, -h * 0.47); c.closePath(); c.fill();
      // 外套：肩膀寬、往下收
      c.beginPath(); c.moveTo(-h * 0.12, -h * 0.8); c.quadraticCurveTo(0, -h * 0.85, h * 0.12, -h * 0.8); c.lineTo(h * 0.095, -h * 0.42); c.lineTo(-h * 0.095, -h * 0.42); c.closePath(); c.fill();
      // 頭（抬頭看的人往後仰一點）
      const hx = -h * 0.015 * pp.look, hy = -h * 0.905 - h * 0.012 * pp.look;
      c.beginPath(); c.ellipse(hx, hy, h * 0.062, h * 0.072, -0.3 * pp.look, 0, Math.PI * 2); c.fill();
      c.fillRect(-h * 0.025, -h * 0.86, h * 0.05, h * 0.06);
      // 手機：舉起來的手與螢幕（小節線上亮一下，像在拍照）
      if (pp.phone) {
        c.strokeStyle = rgba('ink', 0.97); c.lineWidth = h * 0.045; c.lineCap = 'round';
        c.beginPath(); c.moveTo(h * 0.09, -h * 0.76); c.lineTo(h * 0.15, -h * 0.98); c.stroke();
        const flash = pulse(t, au.timeOfBar(bi), 0.15);
        c.fillStyle = mixRgba('bone', 'signal', 0.25, 0.35 + 0.6 * flash);
        c.beginPath(); c.roundRect(h * 0.115, -h * 1.1, h * 0.07, h * 0.11, 2); c.fill();
      }
      // 邊光：頭頂與肩膀一條淡淡的亮邊（LED 牆在前上方）
      c.strokeStyle = rim; c.lineWidth = 1.5;
      c.beginPath(); c.ellipse(hx, hy, h * 0.062, h * 0.072, -0.3 * pp.look, Math.PI * 1.2, Math.PI * 1.8); c.stroke();
      c.beginPath(); c.moveTo(-h * 0.1, -h * 0.815); c.quadraticCurveTo(0, -h * 0.845, h * 0.1, -h * 0.815); c.stroke();
      c.restore();
    });
  }
}
