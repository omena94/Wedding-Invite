// 照片版面「網點印刷」（亮，P8 印刷品）：照片用很大的網點印成普普風的版畫，網點一拍一拍地脈動、越來越細，最後變回照片——
//  - 一張大的印刷紙：照片在一個粗墨框裡（後面錯開一塊訊號色的實地，像普普海報的投影），四角有裁切線，右上一排色票（主題的顏色）。
//  - 網點：兩個版，彩色那一版（15°）的點用照片本身的顏色、大小跟著濃淡；黑版（45°）只印暗部。一開始網點很大（照片只看得出輪廓與顏色），
//    每個大鼓點點脹一下；網點慢慢變細（窗格前半），後段淡成連續的照片——所以每一張照片最後都看得清楚是誰。
//  - 鏡頭：一開始很近、對著新人點的焦點（只看到臉附近的網點），一邊網點變細一邊往後拉，看到整張；紙微微斜放。
//    照片本身也慢慢往焦點推（1.15 倍），網點的格子不動、底下的照片在推。
//  - 字印在照片下面（直的照片在右邊），思源黑體粗體（_photo.ts 的 PhotoText）：主字（賓客留言＋署名，或新人的註解），
//    歌詞小一號接在下面跟唱；沒有主字時歌詞自己當主字。上面一行小小的相簿名與編號。
//    兩個都沒有就只有照片（在正中間）。照片完整印出，很小的舊照片最多放大約 1.5 倍。右下角（HUD）是紙的留白。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE } from '../engine/gl';
import { rgba } from '../engine/palette';
import { ease, hash, lerp, prog } from '../engine/util';
import { PressPlate, P8_GLSL, PHOTO_POST, F, font, planeQuad, planePoint, homographyPx, clip, textFits, type Plane, type PressTextStyle } from './_p8';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'press', paper: true, energy: [0.4, 1], bars: [2, 8], weight: 1, prefers: ['small', 'landscape'], thumbAt: 0.2 };

const SHEET = { w: 2300, h: 1500 };

const BG = () => new FSPass(/* glsl */ `${P8_GLSL}
  uniform sampler2D photo; uniform sampler2D type; uniform sampler2D cap;
  uniform mat3 mSheet; uniform vec4 pr; uniform vec4 crop; uniform float photoPx; uniform vec4 capRect; uniform float capA;
  uniform float cell; uniform float pump; uniform float cont; uniform vec2 shadowOff; uniform float k; uniform float t;
  // 網點的一格：格子中心在照片上的位置（取那一格的平均色）與這一點離中心多遠
  vec4 cellAt(vec2 q, float c, float ang) {
    vec2 r = rot2(ang) * q / c;
    vec2 ci = floor(r) + 0.5;
    vec2 center = rot2(-ang) * ci * c;
    return vec4(center, (fract(r) - 0.5) * c);
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 q = homo(mSheet, p);
    float s = homoScale(mSheet, p);
    // 紙外面：淺灰的桌面（只在拉遠時邊緣露出一點）
    vec3 col = mix(C_PAPER, C_ASH, 0.35) * 0.8;
    float aS = edgeA(q, vec2(${SHEET.w}.0, ${SHEET.h}.0), s);
    vec3 paper = mix(C_BONE, C_PAPER, 0.35) * (0.94 + 0.025 * paperFiber(q));
    vec3 pc = paper;
    // 照片框後面錯開的一塊訊號色實地（普普海報的投影）
    vec2 so = q - pr.xy - shadowOff;
    float sh = edgeA(so + 8.0, pr.zw + 16.0, s);
    pc = mix(pc, mix(C_SIGNAL, C_BLOOD, 0.25) * 0.82, sh);
    // 粗墨框
    float fr = edgeA(q - pr.xy + 8.0, pr.zw + 16.0, s);
    pc = mix(pc, C_INK * 1.2, fr);
    float inPh = edgeA(q - pr.xy, pr.zw, s);
    if (inPh > 0.0) {
      vec2 lq = q - pr.xy;
      float ppx = photoPx / pr.z;
      float aa = s / PX_SCALE;
      // 彩色版（15°）：點的顏色是那一格照片的顏色（飽和一點），大小跟著濃淡與彩度
      vec4 c1 = cellAt(lq, cell, 0.2618);
      vec3 col1 = photoLin(photo, cropUv(crop, c1.xy / pr.zw), log2(max(cell * ppx, 1.0))) / 0.82;
      float L1 = luma(col1);
      vec3 hue1 = clamp(col1 / max(max(col1.r, max(col1.g, col1.b)), 0.02), 0.0, 1.0);
      float v1 = clamp(0.25 + 0.75 * (1.0 - L1) + 0.3 * (max(col1.r, max(col1.g, col1.b)) - min(col1.r, min(col1.g, col1.b))), 0.0, 1.0);
      float r1 = sqrt(v1) * 0.62 * cell * pump;
      float d1 = length(c1.zw) - r1;
      float cov1 = 1.0 - smoothstep(-max(aa, 0.5), max(aa, 0.5), d1);
      vec3 ink1 = mix(hue1, hue1 * hue1, 0.5) * 0.9;
      // 黑版（45°）：只有暗部
      vec4 c2 = cellAt(lq, cell, 0.7854);
      float L2 = luma(photoLin(photo, cropUv(crop, c2.xy / pr.zw), log2(max(cell * ppx, 1.0))) / 0.82);
      float v2 = clamp((0.62 - L2) / 0.62, 0.0, 1.0);
      float r2 = sqrt(v2) * 0.58 * cell * pump;
      float cov2 = 1.0 - smoothstep(-max(aa, 0.5), max(aa, 0.5), length(c2.zw) - r2);
      vec3 ht = paper * mix(vec3(1.0), ink1, cov1) * mix(1.0, 0.16, cov2);
      // 網點細到看不清時，直接用平均（不會有疊紋）；後段淡成連續的照片
      vec3 avg = paper * mix(vec3(1.0), ink1, sqrt(v1) * sqrt(v1) * 1.2 * 0.785) * mix(1.0, 0.16, v2 * 0.66);
      ht = mix(ht, avg, smoothstep(2.5, 1.2, cell / max(aa, 1e-3)));
      float lod = log2(max(s * photoPx / pr.z, 1e-4) / PX_SCALE);
      vec3 ph = photoLin(photo, cropUv(crop, lq / pr.zw), lod);
      pc = mix(pc, mix(ht, ph, cont), inPh);
    }
    vec4 tc = layerAt(type, q / vec2(${SHEET.w}.0, ${SHEET.h}.0));
    pc = pc * (1.0 - tc.a) + tc.rgb;
    vec4 cc = layerAt(cap, (q - capRect.xy) / capRect.zw) * capA;
    pc = pc * (1.0 - cc.a) + cc.rgb;
    // 紙：很淡的光（左上亮一點），邊緣一點點陰影
    pc *= 0.94 + 0.08 * smoothstep(2400.0, 200.0, dot(q, normalize(vec2(0.7, 0.7))));
    col = mix(col, pc, aS);
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, phGain: { value: 1 }, type: { value: null }, cap: { value: null },
  mSheet: { value: new THREE.Matrix3() }, pr: { value: new THREE.Vector4() }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, photoPx: { value: 1 }, capRect: { value: new THREE.Vector4() }, capA: { value: 1 },
  cell: { value: 30 }, pump: { value: 1 }, cont: { value: 0 }, shadowOff: { value: new THREE.Vector2(18, 18) }, k: { value: 1 }, t: { value: 0 },
});

type R = [number, number, number, number];
/** 紙的設計座標跟畫面差一個位移：排版直接用畫面上的位置想。 */
const OFF = { x: (SHEET.w - W) / 2, y: (SHEET.h - H) / 2 };

export default class Halftone extends PressPlate {
  bg = shared('halftone.bg', BG);
  type = this.track(new Layer2D(SHEET.w, SHEET.h, 0.5, { fast: true }));
  cap!: Layer2D;
  /** 照片（畫面 px）、字（畫面 px；最上面一行是編號與相簿名）。 */
  pr: R = [0, 0, 0, 0];
  capR: R = [0, 0, 0, 0];
  side = false;
  dir = 1;
  label = '';

  override async init() {
    this.label = `No.${String(this.photo.n).padStart(3, '0')}`;
    await this.loadPhoto(`${this.label}`);
    const a = this.aspect, tx = this.hasText;
    // 紙上的黑墨字（普普海報的粗黑體）
    const st = (w: number, h: number, maxLines = 4): PressTextStyle => ({
      family: F.hei(900), w, h, min: 40, max: 50, lineHeight: 1.28, maxLines,
      ink: rgba('ink', 0.88), unsung: rgba('ink', 0.25), active: rgba('blood'), sigInk: rgba('ink', 0.6),
    });
    /** 排字：先照四行排，60 字的留言放不下就多折幾行。回傳整塊的高（頂到最後一行的下緣）。 */
    const layText = (w: number, h: number, more: number) => {
      if (!textFits(this.makeText(st(w, h)), h)) this.makeText(st(w, h, more));
      return tx ? this.text.height + this.text.size * 0.35 : 0;
    };
    const sc = (w: number) => Math.min(1, (this.img.w * 1.5) / w);
    this.side = tx && a < 1;
    if (this.side) {
      // 直的：照片在左、字在右欄，那一塊（編號＋字）跟照片的中間對齊；右欄右緣不超過 x = 1340（HUD 的左邊）
      let ph = 720, pw = ph * a;
      const k = sc(pw); pw *= k; ph *= k;
      const colW = 500;
      const textH = 40 + layText(colW, ph - 100, 9);
      const x0 = Math.min((W - (pw + 70 + colW)) / 2 - 40, 1340 - colW - 70 - pw);
      this.pr = [x0, (H - ph) / 2 - 20, pw, ph];
      this.capR = [x0 + pw + 70, this.pr[1] + Math.max(0, (ph - textH) / 2) - 10, colW, textH];
    } else {
      // 橫的：字在照片下面。先排字（欄寬最多 900，右緣不超過 x = 1340），照片用剩下的高度；照片的右下角不要進 HUD
      let tw = 900, ph = 720, pw = 720 * a, textH = 0, x0 = 0;
      for (let i = 0; i < 2; i++) {
        textH = tx ? layText(tw, 300, 6) + 70 : 0;
        ph = Math.min(tx ? 820 - textH : 720, (tx ? 1000 : 1100) / a);
        pw = ph * a;
        const k = sc(pw); pw *= k; ph *= k;
        x0 = Math.min((W - pw) / 2 - 60, 1330 - pw);
        if (i === 0 && tx && 1340 - x0 < tw) tw = 1340 - x0; else break;
      }
      x0 = Math.min(x0, 1340 - (tx ? tw : 0));
      const y0 = (H - (ph + textH)) / 2 - (tx ? 10 : 30);
      this.pr = [x0, y0, pw, ph];
      this.capR = [x0, y0 + ph + 44, Math.max(pw, tw), textH];
    }
    if (!tx) this.makeText(st(900, 300));
    this.cap = this.track(new Layer2D(Math.max(40, this.capR[2]) + 10, Math.max(40, this.capR[3]) + 20, SCALE, { fast: true }));
    this.drawType();
    this.cap.upload();
    this.dir = hash(this.seed, 12) < 0.5 ? -1 : 1;
  }

  /** 紙上的印刷記號：照片四角的裁切線、右上一排色票（設計座標，半解析度的層就夠了）。 */
  private drawType() {
    const L = this.type, c = L.ctx;
    L.clear();
    const [x, y, w, h] = this.pr;
    const X = x + OFF.x, Y = y + OFF.y;
    c.strokeStyle = rgba('ink', 0.55);
    c.lineWidth = 1.5;
    const m = 40, ln = 34;
    for (const [cx, cy, sx, sy] of [[X, Y, -1, -1], [X + w, Y, 1, -1], [X + w, Y + h, 1, 1], [X, Y + h, -1, 1]] as const) {
      c.beginPath();
      c.moveTo(cx + sx * m, cy); c.lineTo(cx + sx * (m + ln), cy);
      c.moveTo(cx, cy + sy * m); c.lineTo(cx, cy + sy * (m + ln));
      c.stroke();
    }
    // 色票：主題的幾個顏色，小方塊
    const keys = ['signal', 'ember', 'blood', 'rose', 'graphite', 'ink'];
    keys.forEach((k, i) => { c.fillStyle = rgba(k, 0.92); c.fillRect(OFF.x + 1360 + i * 34, OFF.y + 70, 28, 18); });
    L.upload();
  }

  /** 字上面一行小字：編號與相簿名。 */
  private drawLabel(c: CanvasRenderingContext2D) {
    c.save();
    c.font = font(F.mono(500), 16);
    c.letterSpacing = '3px';
    c.fillStyle = rgba('sepia', 0.6);
    const lab = this.photo.album ? `${this.label}  ${this.photo.album}` : this.label;
    c.fillText(clip(c, lab, this.capR[2] - 10), 0, 18);
    c.restore();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s, dur = e - s;
    // 網點：一開始很大，前半慢慢變細；後段淡成連續的照片（窗格長短都一樣走完，長的窗格最多 6 秒就看得清楚）
    const tEnd = Math.min(dur * 0.62, 6.5);
    const shrink = ease.inOutQuad(prog(lt, 0.25, tEnd));
    const cell = lerp(34, 3.2, shrink);
    const cont = ease.inOutQuad(prog(lt, tEnd * 0.8, Math.min(tEnd * 1.15, dur - 0.3)));
    // 鏡頭：一開始很近、對著焦點（只看到臉附近的網點），跟著網點變細往後拉；
    // 照片本身也往焦點推（1.15 倍），鏡頭推近的中心跟著焦點在紙上的位置走
    const pull = ease.outCubic(prog(lt, 0, Math.max(1.2, Math.min(3.2, tEnd * 0.7))));
    const z0 = 1 - Math.exp(-lt / 7);
    const sheet: Plane = { x: W / 2, y: H / 2, w: SHEET.w, h: SHEET.h, rx: 7 * (Math.PI / 180), rz: this.dir * (1.4 - 0.8 * pull) * (Math.PI / 180) };
    const [px, py, pw, ph] = this.pr;
    const crop = this.pushCrop(lt, pw / ph, 1.15, pw);
    const [fu, fv] = this.focusAt(crop);
    const [fx, fy] = planePoint(sheet, (px + fu * pw + OFF.x) / SHEET.w, (py + fv * ph + OFF.y) / SHEET.h);
    const cam = { f: 1700, zoom: lerp(1.4, 1.0, pull) + 0.02 * z0, cx: fx, cy: fy };
    const u = this.bg.u;
    homographyPx(planeQuad(sheet, cam), SHEET.w, SHEET.h, u.mSheet!.value as THREE.Matrix3);
    (u.pr!.value as THREE.Vector4).set(px + OFF.x, py + OFF.y, pw, ph);
    (u.crop!.value as THREE.Vector4).set(...crop);
    u.photoPx!.value = (crop[2] - crop[0]) * this.img.w;
    u.photo!.value = this.tex;
    u.phGain!.value = this.gain;
    u.type!.value = this.type.texture;
    if (this.hasText) this.paintText(this.cap, t, 0, 40, (c) => this.drawLabel(c));
    // 註解等鏡頭拉開才浮出來（拉近時它在畫面外）
    u.capA!.value = ease.outCubic(prog(pull, 0.7, 1));
    u.cap!.value = this.cap.texture;
    (u.capRect!.value as THREE.Vector4).set(this.capR[0] + OFF.x, this.capR[1] + OFF.y, this.cap.w, this.cap.h);
    u.cell!.value = cell;
    // 每個大鼓點點脹一下（網點細了之後就不太看得出來，自然收掉）
    u.pump!.value = 1 + 0.22 * (f.a.kick ?? 0) * (1 - cont);
    u.cont!.value = cont;
    (u.shadowOff!.value as THREE.Vector2).set(this.dir * 18, 18);
    u.t!.value = lt;
    u.k!.value = (0.93 + 0.07 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.08 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    return PHOTO_POST(true);
  }
}
