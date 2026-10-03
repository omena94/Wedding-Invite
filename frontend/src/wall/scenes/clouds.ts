// 照片版面「雲端」（亮）：飛在雲海上面，淡淡的天空、遠方一整片雲海往鏡頭流過來，照片像一張相片浮在雲上。
//  - 照片完整呈現（白邊相片），很小的舊照片最多放大 1.5 倍；相片很慢地上下浮、左右擺一點點，
//    下面的雲海上有它很淡、很糊的影子。照片取樣壓在 0.84 以下，天空再亮也不會讓照片發光。
//    相片上的畫面慢慢往焦點（新人點的臉）推。
//  - 雲有三層：遠方的雲海（透視、一直往鏡頭流）、相片後面慢慢飄的雲朵、前景很薄的雲絲（從畫面下緣與角落飄過，
//    經過相片時只是一層很淡的紗，焦點附近不會有）。
//  - 切進來時相片從下面的雲裡浮上來（穿過前景的雲）；每個小節線相片輕輕浮一下。
//  - 字寫在相片右邊的天空（思源宋體、深咖啡色）：主字（賓客留言＋署名，或新人的註解）在上，歌詞小一號在下面跟唱；
//    沒有主字時歌詞自己當主字；都沒有就只有相片（移到正中間）。相簿的第一張在說明上面多一行小小的相簿名。
//    字的後面（雲海、飄過的雲絲）很淡地提亮，深咖啡色的字一直清楚。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, W, H } from '../engine/gl';
import { F } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, prog } from '../engine/util';
import { focusIn, settleK } from './_photo';
import { PhotoScene, TextBlock, containSize, pastBeats, P5_GLSL, type Cam2 } from './_p5';

export const spec: PlateSpecDecl = { photo: true, paper: true, family: 'photo', series: 'light', energy: [0, 0.8], bars: [2, 8], weight: 1 };

const BG = () => new FSPass(/* glsl */ `
  ${P5_GLSL}
  uniform sampler2D photo;
  uniform vec2 center; uniform vec2 halfSize; uniform float border; uniform float ang; uniform float lod; uniform vec4 crop;
  uniform float hy; uniform vec3 cam; uniform vec2 camD; uniform float t; uniform float fly; uniform float k;
  uniform vec2 focus; uniform float rise; uniform float shade; uniform vec4 shadeR;
  const float FOC = 700.0;
  // 雲海（地平線以下的透視平面）：高度場，亮的雲頂、陰影的雲谷
  vec3 cloudSea(vec2 p, vec3 lit, vec3 shade, vec3 haze) {
    float s = p.y - hy + 2.0;
    vec2 P = vec2((p.x - ${W / 2}.0) / s, FOC / s);
    vec2 q = vec2(P.x * 0.8, P.y * 1.4 - fly);
    float v = fbm(q * 0.3, 4);
    float v2 = fbm(q * 0.3 + vec2(0.0, 0.1), 4);
    // 雲谷暗一點（遮蔽）、面向遠方上空的那一面亮（光從遠方上面來）
    float ao = smoothstep(-0.5, 0.45, v);
    float dl = clamp(0.5 + (v - v2) * 5.0, 0.0, 1.0);
    vec3 col = mix(shade, lit, clamp(ao * 0.65 + dl * 0.45, 0.0, 1.0));
    // 遠處糊成一片亮霧
    return mix(haze, col, 1.0 - exp(-s / 110.0));
  }
  // 雲朵：2D 的 fbm，取門檻、下緣暗一點
  float puff(vec2 q, int oct) { return fbm(q, oct) + 0.35 * snoise(q * 0.5 + 3.0); }
  void main() {
    vec2 ps = p5Px();
    vec2 p = cam.yz + (ps - cam.yz - camD) / cam.x;
    vec3 lit = mix(C_PAPER, C_BONE, 0.5) * 0.97;
    vec3 shade = mix(C_PAPER, C_ASH, 0.42) * 0.8;
    vec3 haze = mix(C_PAPER, C_SIGNAL, 0.12) * 0.92;
    // 天空：上面深一點的灰（白雲才浮得出來），地平線附近暖一點；太陽在左上的高處
    float h = (hy - p.y) / hy;
    vec3 col = mix(haze, mix(C_PAPER, C_ASH, 0.5) * 0.72, smoothstep(0.0, 1.0, h));
    vec2 sq = (p - vec2(420.0, -80.0)) / 900.0;
    col += mix(C_BONE, C_EMBER, 0.3) * 0.08 * exp(-dot(sq, sq) * 2.0);
    // 相片後面慢慢飄的雲朵
    if (p.y < hy + 10.0) {
      vec2 q = vec2(p.x / 520.0 + t * 0.012, p.y / 300.0);
      float c = puff(q, 4);
      float a = smoothstep(0.0, 0.5, c) * smoothstep(-0.05, 0.4, h) * 0.85;
      // 雲朵的下緣（比較厚的地方）暗一點點，上緣亮
      float under = smoothstep(0.0, 0.5, puff(q + vec2(0.0, -0.08), 3) - c + 0.2);
      col = mix(col, mix(lit, lit * 0.86, under), a);
    }
    // 雲海：地平線本身有雲頂起伏
    float edge = hy - 18.0 * (snoise(vec2(p.x / 160.0 + fly * 0.2, 1.0)) * 0.6 + snoise(vec2(p.x / 55.0, 3.0)) * 0.4);
    if (p.y > edge - 4.0) {
      vec3 sea = cloudSea(vec2(p.x, max(p.y, hy + 1.0)), lit, shade, haze);
      col = mix(col, sea, smoothstep(edge - 4.0, edge + 4.0, p.y));
    }
    // 相片在雲海上的影子（很淡、很糊）
    vec2 sh = (p - vec2(center.x + 30.0, hy + 120.0 + 0.25 * (center.y + halfSize.y - hy))) / vec2(halfSize.x * 1.1 + 60.0, 50.0);
    col *= 1.0 - 0.12 * exp(-dot(sh, sh)) * step(hy, p.y);
    // 相片（白邊、浮著、擺一點點）
    vec2 q = rot2(ang) * (p - center);
    vec2 outer = halfSize + vec2(border);
    float d = sdBox(q, outer);
    // 相片背面的軟影（浮起來的厚度）
    col *= 1.0 - 0.1 * exp(-max(sdBox(rot2(ang) * (p - center - vec2(8.0, 14.0)), outer), 0.0) / 18.0);
    float a = 1.0 - smoothstep(-0.8, 0.8, d);
    if (a > 0.0) {
      vec3 pr = C_BONE * 0.9;
      pr *= 1.0 - 0.05 * smoothstep(-3.0, 0.0, d);
      float di = sdBox(q, halfSize);
      vec3 ph = p5Photo(photo, p5Crop((q + halfSize) / (2.0 * halfSize), crop), lod);
      pr = mix(pr, ph, 1.0 - smoothstep(-0.7, 0.7, di));
      col = mix(col, pr, a);
    }
    // 前景的雲絲：從下緣、角落飄過；經過相片時很淡，焦點附近沒有
    float edgeMask = smoothstep(640.0, 1040.0, p.y) + 0.6 * smoothstep(0.62, 1.0, abs(p.x - ${W / 2}.0) / ${W / 2}.0) + rise;
    if (edgeMask > 0.01) {
      vec2 wq = vec2(p.x / 700.0 - t * 0.05, p.y / 260.0 + 0.2 * snoise(vec2(p.x / 900.0, t * 0.05)));
      float wsp = smoothstep(0.0, 0.6, fbm(wq, 3) + 0.15);
      float onPhoto = a * (0.35 + 0.65 * smoothstep(80.0, 320.0, length(p - focus)));
      float wa = clamp(edgeMask, 0.0, 1.0) * wsp * mix(0.85, 0.3, onPhoto);
      col = mix(col, lit, wa);
    }
    // 字的後面：雲海的陰影很淡地提亮（邊緣很軟，不是框），深咖啡色的字一直清楚
    vec2 tc = (shadeR.xy + shadeR.zw) * 0.5, ths = (shadeR.zw - shadeR.xy) * 0.5;
    float tm = exp(-max(sdBox(p - tc, ths) + 20.0, 0.0) / 95.0);
    col = mix(col, max(col, lit * 0.94), shade * tm);
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, pgain: { value: 1 }, center: { value: new THREE.Vector2() }, halfSize: { value: new THREE.Vector2() }, border: { value: 20 },
  ang: { value: 0 }, lod: { value: 0 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, hy: { value: 640 }, cam: { value: new THREE.Vector3(1, W / 2, H / 2) }, camD: { value: new THREE.Vector2() },
  t: { value: 0 }, fly: { value: 0 }, k: { value: 1 }, focus: { value: new THREE.Vector2() }, rise: { value: 0 },
  shade: { value: 0 }, shadeR: { value: new THREE.Vector4() },
});

/** 說明欄的寬（60 字的留言在 5 行內、字級 ≥ 40）、跟相片的間距。 */
const COL_W = 580, GAP = 90;

export default class Clouds extends PhotoScene {
  bg = shared('clouds.bg', BG);
  text: TextBlock | null = null;
  cx = W / 2; cy = H / 2; hw = 0; hh = 0; border = 20;

  override async init() {
    await this.loadPhoto();
    const { w, h } = this.img;
    const sz = containSize(w, h, this.hasText ? 860 : 1060, 680);
    this.hw = sz.w / 2; this.hh = sz.h / 2;
    this.border = clamp(0.04 * Math.min(sz.w, sz.h), 14, 28);
    const tw = sz.w + 2 * this.border;
    const groupW = this.hasText ? tw + GAP + COL_W : tw;
    const x0 = Math.max(130, (W - groupW) / 2 - (this.hasText ? 0 : 30));
    this.cx = x0 + tw / 2;
    this.cy = H / 2 - 40;
    if (this.hasText) {
      const box = { x: x0 + tw + GAP, y: 150, w: COL_W, h: 640 };
      this.text = this.track(new TextBlock(this.ctx, box, {
        family: F.ming(600), lineHeight: 1.45, maxLines: 5, color: rgba('sepia', 0.92), unsung: rgba('sepia', 0.3),
        active: mixRgba('signal', 'sepia', 0.45), sigColor: rgba('sepia', 0.72),
        label: { family: F.ming(600), size: 24, color: rgba('sepia', 0.6), tracking: 6, rule: mixRgba('signal', 'sepia', 0.3) },
      }, 'center'));
      const bh = this.text.height;
      this.text.box.y = clamp(this.cy - bh / 2, 150, 790 - bh);
      this.text.box.h = bh + 4;
    }
  }

  /** 每個小節線相片輕輕浮一下（往上、回來）。 */
  private bob(t: number) {
    let b = 0;
    for (const tb of pastBeats(this.ctx.audio, t, 2, true)) {
      const dt = t - tb;
      if (dt < 0 || tb < this.ctx.start + 0.5) continue;
      b += Math.sin(Math.min(dt / 1.1, 1) * Math.PI) * Math.exp(-dt / 1.2);
    }
    return b;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const z0 = 1 - Math.exp(-lt / 7);
    const pivotX = this.text ? (this.cx + this.text.box.x + COL_W / 2) / 2 : this.cx;
    const cam: Cam2 = { z: 1 + 0.035 * z0, cx: pivotX, cy: this.cy, dx: 0, dy: 0 };
    // 從雲裡浮上來
    const up = ease.outCubic(prog(t, s, s + 1.1));
    const dir = hash(this.seed, 5) < 0.5 ? -1 : 1;
    const floatY = 7 * Math.sin(lt * 0.9 + this.seed) - 10 * this.bob(t);
    const u = this.bg.u;
    u.photo!.value = this.tex;
    u.pgain!.value = this.gain;
    const cy = this.cy + 300 * (1 - up) + floatY;
    (u.center!.value as THREE.Vector2).set(this.cx + 4 * Math.sin(lt * 0.5), cy);
    (u.halfSize!.value as THREE.Vector2).set(this.hw, this.hh);
    u.border!.value = this.border;
    u.ang!.value = (dir * (2.2 * (1 - up) + 0.6 * Math.sin(lt * 0.6 + 1)) * Math.PI) / 180;
    // 相片上的畫面往焦點推（1.18 倍）；很小的照片少推
    const sw = 2 * this.hw * cam.z;
    const crop = this.crop(settleK(lt), sw, 1.18);
    (u.crop!.value as THREE.Vector4).set(...crop);
    u.lod!.value = this.cropLod(crop, sw);
    u.hy!.value = 650;
    (u.cam!.value as THREE.Vector3).set(cam.z, cam.cx, cam.cy);
    (u.camD!.value as THREE.Vector2).set(cam.dx, cam.dy);
    u.t!.value = t;
    // 往前飛：雲海一直往鏡頭流
    u.fly!.value = 0.12 * lt + hash(this.seed, 9) * 10;
    // 焦點在相片上的位置（推過之後）：前景的雲絲避開它
    const [fu, fv] = focusIn(this.photo, crop);
    (u.focus!.value as THREE.Vector2).set(this.cx - this.hw + 2 * this.hw * fu, cy - this.hh + 2 * this.hh * fv);
    u.rise!.value = 0.9 * (1 - up);
    u.shade!.value = this.text ? 0.75 : 0;
    if (this.text) (u.shadeR!.value as THREE.Vector4).set(...this.text.area());
    u.k!.value = (0.9 + 0.1 * ease.outCubic(prog(t, s, s + 0.5))) * (1 - 0.06 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    if (this.text && this.text.draw(t, prog(t, s + 0.8, s + 0.8 + Math.min(1.6, (e - s) * 0.3)))) {
      const op = prog(t, s + 0.5, s + 1.0, ease.outCubic) * (1 - prog(t, e - 0.3, e));
      this.text.blit(comp, renderer, out, op, cam);
    }
    return { paper: 1, bloom: 0.12, bloomThreshold: 1.2, halation: 0.04, vignette: 0.22 };
  }
}
