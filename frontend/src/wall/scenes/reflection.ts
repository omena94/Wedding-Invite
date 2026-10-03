// 照片版面「水面倒影」（暗）：入夜的湖邊，照片立在水面上，下面的湖水倒映著照片、對岸的山影與零星燈火。
//  - 照片完整放，很小的舊照片最多放大 1.5 倍；邊上一圈細細的白邊，像一張相片立在水邊。
//    照片取樣壓在 0.84 以下，倒影更暗、更糊（越往近處越糊），不會搶照片。
//    相片上的畫面慢慢往焦點（新人點的臉）推，水裡的倒影跟著同一塊。
//  - 水面有一直在動的細波（透視：遠的細、近的粗），每一拍水面起一圈漣漪（小節線的那一圈比較大），
//    倒影跟著漣漪扭動；切進來時照片輕輕落到水面上，從照片底下盪開第一圈。
//  - 字寫在照片右邊的夜空裡（思源宋體），最後一行的下緣貼近水面，字的倒影也淡淡地映在水裡、跟著波紋晃：
//    主字（賓客留言＋署名，或新人的註解）在上，歌詞小一號在下面跟唱；沒有主字時歌詞自己當主字；
//    都沒有就只有照片（移到正中間）。相簿的第一張在說明上面多一行相簿名。
//  - 水面上一層很薄的霧慢慢飄；鏡頭很慢地推近。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, W, H } from '../engine/gl';
import { F } from '../engine/type';
import { clamp, ease, hash, prog } from '../engine/util';
import { settleK } from './_photo';
import { PhotoScene, TextBlock, DARK_TEXT, containSize, pastBeats, P5_GLSL, type Cam2 } from './_p5';

export const spec: PlateSpecDecl = { photo: true, prefers: ['landscape', 'square'], family: 'photo', series: 'light', energy: [0, 0.75], bars: [2, 8], weight: 1 };

const NRIP = 6;

const BG = () => new FSPass(/* glsl */ `
  ${P5_GLSL}
  uniform sampler2D photo; uniform sampler2D txt; uniform vec4 txtRect; uniform float txtOn;
  uniform vec2 center; uniform vec2 halfSize; uniform float border; uniform float lod; uniform vec4 crop;
  // hy：地平線；yc：照片立在水面上的那條線（倒影以它為鏡）
  uniform float hy; uniform float yc; uniform vec3 cam; uniform vec2 camD; uniform float t; uniform float k;
  // 漣漪：水面座標 (X, Z)、經過幾秒、強度
  uniform vec4 rip[${NRIP}];
  const float FOC = 820.0;
  float shoreH(float x) { return 22.0 + 28.0 * fbm(vec2(x / 420.0, 1.3), 3) + 6.0 * snoise(vec2(x / 38.0, 4.0)); }
  // 夜空、對岸、燈火（倒影也用這個，blur 越大越糊）
  vec3 sky(vec2 p, float blur) {
    float h = hy - p.y;
    vec3 col = mix(mix(C_INK2, C_BLOOD, 0.06) * 1.1, C_INK * 0.7, smoothstep(0.0, 560.0, h));
    col += C_BLOOD * 0.07 * exp(-max(h, 0.0) / 130.0) + C_SIGNAL * 0.012 * exp(-max(h, 0.0) / 45.0);
    float sh = shoreH(p.x);
    float sil = smoothstep(-1.5 - blur * 4.0, 1.5 + blur * 4.0, sh - h);
    col = mix(col, C_INK * 0.55 + C_BLOOD * 0.006, sil * 0.95);
    // 對岸零星的燈火（暖色的小點，會發光一點點）
    float cell = 58.0;
    float ci = floor(p.x / cell);
    for (int j = -1; j <= 1; j++) {
      float id = ci + float(j);
      float r = hash11(id * 1.37 + 0.3);
      if (r > 0.36) continue;
      vec2 lp = vec2((id + 0.2 + 0.6 * hash11(id + 9.1)) * cell, hy - 3.0 - 11.0 * hash11(id + 3.3) * hash11(id + 5.1));
      vec2 dd = (p - lp) * vec2(1.0, 1.0 / (1.0 + blur * 3.0));
      float tw = 0.75 + 0.25 * sin(t * (1.0 + 2.0 * r) + id);
      col += mix(C_SIGNAL, C_EMBER, 0.4) * (1.5 * tw) * exp(-dot(dd, dd) / (2.0 + blur * 5.0)) * (0.5 + r);
    }
    return col;
  }
  // 照片（白邊＋照片）：rgb、覆蓋率
  vec4 photoAt(vec2 p, float blur) {
    vec2 q = p - center;
    float d = sdBox(q, halfSize + vec2(border));
    float a = 1.0 - smoothstep(-0.8 - blur * 3.0, 0.8 + blur * 3.0, d);
    if (a <= 0.0) return vec4(0.0);
    vec3 pr = C_BONE * 0.6;
    float di = sdBox(q, halfSize);
    vec3 ph = p5Photo(photo, p5Crop((q + halfSize) / (2.0 * halfSize), crop), lod + blur);
    pr = mix(pr, ph, 1.0 - smoothstep(-0.7 - blur * 2.0, 0.7 + blur * 2.0, di));
    return vec4(pr, a);
  }
  void main() {
    vec2 ps = p5Px();
    vec2 p = cam.yz + (ps - cam.yz - camD) / cam.x;
    vec3 col;
    float s = p.y - hy;
    if (s <= 0.0) {
      col = sky(p, 0.0);
      // 貼著地平線的薄霧
      col += mix(C_ASH, C_BLOOD, 0.3) * 0.016 * exp(s / 36.0) * (0.6 + 0.4 * snoise(vec2(p.x / 300.0 - t * 0.04, 2.0)));
    } else {
      // 水面座標：X 往右、Z 往遠（透視）
      float ss = s + 4.0;
      vec2 P = vec2((p.x - ${W / 2}.0) / ss, FOC / ss);
      float tt = t * 0.55;
      float n1 = snoise(vec2(P.x * 2.2, P.y * 5.5 - tt));
      float n2 = snoise(vec2(P.x * 4.1 + 3.0, P.y * 11.0 + tt * 1.3));
      vec2 disp = vec2(n1 * 0.75 + n2 * 0.2, (n2 * 0.7 - n1 * 0.3) * 0.5) * (0.8 + 0.02 * s) * smoothstep(0.0, 20.0, s);
      // 漣漪
      float ringHi = 0.0;
      for (int i = 0; i < ${NRIP}; i++) {
        vec4 r = rip[i];
        if (r.w <= 0.0) continue;
        vec2 dq = P - r.xy;
        float rr = length(dq);
        float R = 0.06 + 0.5 * r.z;
        float x = (rr - R) / 0.07;
        float env = exp(-x * x * 0.5) * r.w * exp(-r.z / 1.3) / (1.0 + 3.0 * R);
        float wv = sin(x * 2.4) * env;
        vec2 dir = rr > 1e-4 ? vec2(dq.x, -dq.y) / rr : vec2(0.0);
        disp += dir * wv * (2.0 + 0.05 * s);
        ringHi += cos(x * 2.4) * env;
      }
      float blur = 0.9 + s / 160.0;
      // 倒影：照片以 yc 為鏡（照片前面的水才映得到照片），夜空與對岸以地平線為鏡
      vec3 refl = sky(vec2(p.x, hy - s) + disp, blur);
      vec2 m = vec2(p.x, 2.0 * yc - p.y) + disp;
      if (p.y > yc - 6.0) {
        vec4 ph = photoAt(m, blur * 0.8);
        refl = mix(refl, ph.rgb, ph.a * smoothstep(yc - 6.0, yc + 2.0, p.y));
      }
      float fres = mix(0.62, 0.36, smoothstep(0.0, 520.0, s));
      vec3 water = mix(C_INK, C_GRAPHITE, 0.06) * 0.6;
      col = water + refl * fres;
      // 字的倒影（很淡，跟著波紋晃）
      if (txtOn > 0.0 && p.y > yc - 40.0) {
        // 離水面越遠越淡（不要映到右下角的 QR 那一區）
        float tk = 0.3 * txtOn * fres * exp(-max(p.y - yc - 30.0, 0.0) / 45.0) * (1.0 - smoothstep(790.0, 835.0, p.y));
        vec4 tx = p5Text(txt, m, txtRect);
        col = col * (1.0 - tx.a * tk) + tx.rgb * tk;
      }
      // 漣漪的波峰反射天光、細波上的碎光
      col += mix(C_ASH, C_SIGNAL, 0.35) * 0.04 * max(ringHi, 0.0);
      float gl = smoothstep(0.62, 0.92, n2 * 0.6 + n1 * 0.5) * smoothstep(8.0, 50.0, s) * exp(-s / 300.0);
      col += mix(C_SIGNAL, C_BONE, 0.5) * 0.05 * gl;
      // 照片立在水上：貼著水面的地方暗一點
      vec2 cq = (p - vec2(center.x, yc)) / vec2(halfSize.x + 40.0, 14.0);
      col *= 1.0 - 0.35 * exp(-dot(cq, cq)) * step(yc, p.y);
      col += mix(C_ASH, C_BLOOD, 0.3) * 0.018 * exp(-s / 28.0);
    }
    // 照片本身（立在水面上，蓋在水與天空上）
    vec4 ph = photoAt(p, 0.0);
    col = mix(col, ph.rgb, ph.a);
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, pgain: { value: 1 }, txt: { value: null }, txtRect: { value: new THREE.Vector4() }, txtOn: { value: 0 },
  center: { value: new THREE.Vector2() }, halfSize: { value: new THREE.Vector2() }, border: { value: 10 }, lod: { value: 0 },
  crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  hy: { value: 540 }, yc: { value: 780 }, cam: { value: new THREE.Vector3(1, W / 2, H / 2) }, camD: { value: new THREE.Vector2() }, t: { value: 0 }, k: { value: 1 },
  rip: { value: Array.from({ length: NRIP }, () => new THREE.Vector4()) },
});

/** 說明欄的寬（60 字的留言在 5 行內、字級 ≥ 40）、跟照片的間距。 */
const COL_W = 580, GAP = 90;
const FOC = 820;

export default class Reflection extends PhotoScene {
  bg = shared('reflection.bg', BG);
  text: TextBlock | null = null;
  cx = W / 2; cy = H / 2; hw = 0; hh = 0; hy = 540; yc = 780; border = 10;

  override async init() {
    await this.loadPhoto();
    const { w, h } = this.img;
    // 照片立在近處的水面上（yc），地平線在照片後面；直的照片站低一點（才放得大）
    this.yc = w / h < 1 ? 800 : 770;
    this.hy = w / h < 1 ? 520 : 530;
    const sz = containSize(w, h, this.hasText ? 840 : 1060, this.yc - 130);
    this.border = clamp(0.018 * Math.min(sz.w, sz.h), 7, 12);
    this.hw = sz.w / 2; this.hh = sz.h / 2;
    const tw = sz.w + 2 * this.border;
    const groupW = this.hasText ? tw + GAP + COL_W : tw;
    const x0 = Math.max(130, (W - groupW) / 2 - (this.hasText ? 20 : 0));
    this.cx = x0 + tw / 2;
    // 照片立在水面上（下緣貼著 yc）
    this.cy = this.yc - this.border - this.hh;
    if (this.hasText) {
      // 說明在照片右邊，下緣貼近水面（跟照片站在同一個深度，倒影也以 yc 為鏡）
      const box = { x: x0 + tw + GAP, y: this.yc - 40 - 540, w: COL_W, h: 540 };
      this.text = this.track(new TextBlock(this.ctx, box, DARK_TEXT(F.ming(500), { lineHeight: 1.42, maxLines: 5 }), 'bottom'));
    }
  }

  /** 每一拍一圈漣漪（小節線的大一點），切進來時照片底下先盪開一圈。 */
  private ripples(t: number) {
    const au = this.ctx.audio, s = this.ctx.start;
    const out: [number, number, number, number][] = [];
    // 進場：照片落到水面
    const land = s + 0.35;
    const sc = this.yc - this.hy + 4;
    if (t >= land) out.push([(this.cx - W / 2) / sc, FOC / (sc + 8), t - land, 1.4]);
    const bars = new Set(pastBeats(au, t, 2, true).map((x) => Math.round(x * 100)));
    for (const tb of pastBeats(au, t, NRIP - 1)) {
      if (tb < land + 0.2) continue;
      const age = t - tb;
      const i = Math.round(tb * 100);
      const big = bars.has(i);
      // 漣漪的位置：照片前面的水面（遠一點的比較小）
      const sp = this.yc - this.hy + 30 + 220 * hash(i, 11);
      const x = this.cx + (hash(i, 7) - 0.5) * 2 * Math.max(260, this.hw + 120);
      out.push([(x - W / 2) / (sp + 6), FOC / (sp + 6), age, big ? 1.0 : 0.5]);
    }
    return out;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const z0 = 1 - Math.exp(-lt / 7);
    const pivotX = this.text ? (this.cx + this.text.box.x + COL_W / 2) / 2 : this.cx;
    const cam: Cam2 = { z: 1 + 0.04 * z0, cx: pivotX, cy: this.yc - 200, dx: 0, dy: -10 * ease.inOutQuad(clamp(lt / 10)) };
    // 進場：照片從上面一點點落到水面
    const drop = ease.outCubic(prog(t, s, s + 0.4));
    const u = this.bg.u;
    u.photo!.value = this.tex;
    u.pgain!.value = this.gain;
    (u.center!.value as THREE.Vector2).set(this.cx, this.cy - 16 * (1 - drop));
    (u.halfSize!.value as THREE.Vector2).set(this.hw, this.hh);
    u.border!.value = this.border;
    // 相片上的畫面往焦點推（1.18 倍），倒影用同一塊；很小的照片少推
    const sw = 2 * this.hw * cam.z;
    const crop = this.crop(settleK(lt), sw, 1.18);
    (u.crop!.value as THREE.Vector4).set(...crop);
    u.lod!.value = this.cropLod(crop, sw);
    u.hy!.value = this.hy;
    u.yc!.value = this.yc;
    (u.cam!.value as THREE.Vector3).set(cam.z, cam.cx, cam.cy);
    (u.camD!.value as THREE.Vector2).set(cam.dx, cam.dy);
    u.t!.value = t;
    u.k!.value = (0.6 + 0.4 * ease.outCubic(prog(t, s, s + 0.6))) * (1 - 0.12 * prog(t, e - 0.3, e));
    const rs = this.ripples(t);
    const arr = u.rip!.value as THREE.Vector4[];
    for (let i = 0; i < NRIP; i++) { const r = rs[i]; if (r) arr[i]!.set(...r); else arr[i]!.set(0, 0, 0, 0); }
    // 先畫字（倒影要用這一格的字）
    let txtK = 0;
    if (this.text && this.text.draw(t, prog(t, s + 0.5, s + 0.5 + Math.min(1.6, (e - s) * 0.3)))) {
      txtK = prog(t, s + 0.35, s + 0.85, ease.outCubic) * (1 - prog(t, e - 0.3, e));
    }
    u.txt!.value = this.text ? this.text.L.texture : null;
    if (this.text) (u.txtRect!.value as THREE.Vector4).set(...this.text.rect);
    u.txtOn!.value = txtK;
    this.bg.render(renderer, out);
    if (this.text && txtK > 0) this.text.blit(comp, renderer, out, txtK, cam);
    return { bloom: 0.25, bloomThreshold: 1.05, halation: 0.15, vignette: 0.5 };
  }
}
