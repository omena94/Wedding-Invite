// 照片版面「逆光」（暗）：黃昏的草原，太陽快落到地平線，一張相片被舉在太陽前面，太陽從相片的右邊探出來。
//  - 照片完整呈現（細白邊相片），很小的舊照片最多放大 1.5 倍。逆光：相片正面稍暗，靠太陽那一側的邊緣亮起一道細細的金邊，
//    紙透一點點暖光；照片取樣壓在 0.84 以下，暖光最多只蓋上一成，不會讓照片發光過曝。
//    相片上的畫面慢慢往焦點（新人點的臉）推。
//  - 切進來時相片擋住太陽，接著往左滑開，太陽從相片邊上探出來，光暈與鏡頭光斑一起亮起來。
//    每個小節線鏡頭光斑掃過去一次：橫的光條亮一下、一串光斑沿著光軸滑過畫面（經過照片時很淡）。
//  - 地平線上一層暖暖的霧，近處的草是剪影，草尖被太陽描了一道邊、隨風搖；空氣裡有細細的光塵在飄。
//  - 字寫在左下的草地上方（思源宋體），後面很淡地壓暗：主字（賓客留言＋署名，或新人的註解）在上，歌詞小一號在最下面跟唱；
//    沒有主字時歌詞自己當主字；都沒有就只有相片（移到中間）。相簿的第一張在說明上面多一行小小的相簿名。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, W, H } from '../engine/gl';
import { F } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, prog } from '../engine/util';
import { settleK } from './_photo';
import { PhotoScene, TextBlock, DARK_TEXT, containSize, pastBeats, P5_GLSL } from './_p5';

export const spec: PlateSpecDecl = { photo: true, prefers: ['landscape'], family: 'photo', series: 'light', energy: [0, 0.85], bars: [2, 8], weight: 1 };

const BG = () => new FSPass(/* glsl */ `
  ${P5_GLSL}
  uniform sampler2D photo;
  uniform vec2 center; uniform vec2 halfSize; uniform float border; uniform float ang; uniform float lod; uniform vec4 crop;
  uniform float t; uniform float k; uniform float hy; uniform vec2 sun; uniform float sunR; uniform float vis;
  uniform float pulse; uniform float slide; uniform float shade; uniform vec4 shadeR;
  vec3 warm() { return mix(C_SIGNAL, C_EMBER, 0.45); }
  // 天空：上面暗、地平線附近暖
  vec3 sky(vec2 p) {
    float h = clamp((hy - p.y) / hy, 0.0, 1.0);
    vec3 top = mix(C_INK2, C_BLOOD, 0.3) * 0.7;
    vec3 mid = mix(C_BLOOD, C_SIGNAL, 0.45) * 0.32;
    vec3 low = mix(C_SIGNAL, C_EMBER, 0.4) * 0.55;
    vec3 col = mix(low, mid, smoothstep(0.0, 0.35, h));
    col = mix(col, top, smoothstep(0.3, 1.0, h));
    // 很淡的雲帶
    col *= 0.92 + 0.08 * fbm(vec2(p.x / 600.0 + t * 0.01, p.y / 70.0), 3);
    return col;
  }
  // 草：近處的剪影，一欄一欄，草尖被太陽描邊、隨風搖
  vec2 grass(vec2 p) {
    float cw = 16.0;
    float ci = floor(p.x / cw);
    float cover = 0.0, rim = 0.0;
    for (int j = -2; j <= 2; j++) {
      float id = ci + float(j);
      float hsh = hash11(id * 1.31 + 0.7);
      float edgeK = smoothstep(0.25, 0.0, id * cw / ${W}.0) + smoothstep(0.75, 1.0, id * cw / ${W}.0);
      float hgt = 50.0 + 120.0 * hsh * hsh + 160.0 * edgeK * hash11(id + 3.3);
      float base = id * cw + cw * hash11(id + 9.1);
      float u = clamp((${H}.0 - p.y) / hgt, 0.0, 1.0);
      float sway = (8.0 + 18.0 * hsh) * sin(t * (0.9 + 0.5 * hsh) + id * 0.7) * u * u;
      float lean = (hash11(id + 5.5) - 0.5) * 60.0 * u * u;
      float x = base + sway + lean;
      float wdt = (3.2 + 2.5 * hsh) * (1.0 - u) + 0.3;
      float dx = p.x - x;
      float inside = (1.0 - smoothstep(wdt - 0.7, wdt + 0.7, abs(dx))) * step(${H}.0 - hgt, p.y);
      cover = max(cover, inside);
      // 描邊：朝太陽那一側、越靠草尖越亮
      float side = step(0.0, dx * sign(sun.x - x));
      rim = max(rim, inside * side * smoothstep(wdt * 0.2, wdt, abs(dx)) * smoothstep(0.4, 1.0, u));
    }
    return vec2(cover, rim);
  }
  void main() {
    vec2 p = p5Px();
    vec3 W3 = warm();
    float ds = length(p - sun);
    vec3 col = sky(p);
    // 太陽：圓盤（會發光）＋大光暈
    col += mix(C_EMBER, vec3(1.0, 0.95, 0.86), 0.5) * 2.6 * (1.0 - smoothstep(sunR - 1.5, sunR + 1.5, ds));
    col += W3 * (0.5 * exp(-ds / 60.0) + 0.18 * exp(-ds / 260.0)) * (0.5 + 0.5 * vis);
    // 地平線以下：草原（暗），地平線上一層暖霧
    float gy = hy + 6.0 * snoise(vec2(p.x / 300.0, 2.0));
    if (p.y > gy) {
      float dd = p.y - gy;
      vec3 ground = mix(C_INK2, C_BLOOD, 0.08) * 0.5 * exp(-dd / 260.0) + C_INK * 0.3;
      col = mix(col, ground, smoothstep(gy - 1.0, gy + 2.0, p.y));
    }
    col += W3 * 0.12 * exp(-abs(p.y - hy) / 30.0) * (0.4 + 0.6 * exp(-abs(p.x - sun.x) / 700.0)) * (0.5 + 0.5 * vis);
    // 左下字的後面很淡地壓暗
    col = p5Shade(col, p, shadeR, shade * 0.7);
    // 相片（逆光：正面稍暗、靠太陽的邊亮起金邊、紙透一點點暖光）
    vec2 q = rot2(ang) * (p - center);
    vec2 outer = halfSize + vec2(border);
    float d = sdBox(q, outer);
    float a = 1.0 - smoothstep(-0.8, 0.8, d);
    float sunK = exp(-ds / 520.0);
    if (a > 0.0) {
      vec3 pr = C_BONE * 0.42;
      float di = sdBox(q, halfSize);
      vec3 ph = p5Photo(photo, p5Crop((q + halfSize) / (2.0 * halfSize), crop), lod) * 0.92;
      // 紙透光：靠太陽那一角暖暖地亮一點（最多一成）
      float veil = 0.1 * exp(-ds / 380.0) * vis;
      ph = ph * (1.0 - veil) + W3 * 0.7 * veil;
      pr = mix(pr, ph, 1.0 - smoothstep(-0.7, 0.7, di));
      col = mix(col, pr, a);
    }
    // 金邊：相片外緣靠太陽的那一側
    float rimL = exp(-abs(d) / 1.8) * (0.25 + 0.75 * exp(-ds / 300.0)) * vis;
    col += W3 * 1.1 * rimL;
    // 草（最前面）
    vec2 gr = grass(p);
    col = mix(col, C_INK * 0.35, gr.x);
    col += W3 * 0.7 * gr.y * (0.3 + 0.7 * exp(-abs(p.x - sun.x) / 600.0)) * vis;
    // 鏡頭光斑：橫的光條＋沿著光軸的一串光斑（經過照片時淡）
    float onPhoto = mix(1.0, 0.3, a);
    float fI = vis * (0.6 + 0.9 * pulse);
    float dy = p.y - sun.y;
    col += W3 * 0.16 * fI * exp(-dy * dy / 8.0) * exp(-abs(p.x - sun.x) / (520.0 + 500.0 * pulse)) * onPhoto;
    vec2 C = vec2(${W / 2}.0, ${H / 2}.0);
    vec2 ax = C - sun;
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float kk = 0.45 + 0.42 * fi + 0.3 * slide;
      vec2 g = sun + ax * kk;
      float r = 22.0 + 50.0 * hash11(fi + 2.0);
      float gd = length(p - g);
      float disc = 1.0 - smoothstep(r * 0.82, r, gd);
      float ring = exp(-pow((gd - r * 0.92) / 3.0, 2.0));
      vec3 gc = mix(C_SIGNAL, mix(C_BLOOD, C_EMBER, hash11(fi + 7.0)), 0.5);
      col += gc * (0.035 * disc + 0.03 * ring) * fI * onPhoto;
    }
    // 空氣裡的光塵（太陽附近亮）
    vec2 mq = (p + vec2(t * 9.0, -t * 5.0)) / 52.0;
    vec2 mid = floor(mq), mf = fract(mq);
    vec2 mh = hash22(mid + 3.0);
    if (mh.x < 0.3) {
      vec2 mc = 0.25 + 0.5 * hash22(mid + 8.0) + 0.1 * vec2(sin(t + mh.y * 6.28), cos(t * 0.7 + mh.x * 6.28));
      float md = length((mf - mc) * 52.0);
      col += W3 * 0.9 * exp(-md * md / 2.0) * exp(-ds / 380.0) * (0.5 + 0.5 * sin(t * 2.0 + mh.y * 30.0)) * vis * onPhoto;
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, pgain: { value: 1 }, center: { value: new THREE.Vector2() }, halfSize: { value: new THREE.Vector2() }, border: { value: 8 }, ang: { value: 0 }, lod: { value: 0 },
  crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  t: { value: 0 }, k: { value: 1 }, hy: { value: 640 }, sun: { value: new THREE.Vector2() }, sunR: { value: 46 }, vis: { value: 1 },
  pulse: { value: 0 }, slide: { value: 0 }, shade: { value: 0 }, shadeR: { value: new THREE.Vector4() },
});

/** 說明：左下，最後一行的基線在 HUD 區上面；往上留得夠高（60 字的留言＋署名＋歌詞），短的字貼底。 */
const SUB = { x: 150, y: 280, w: 540, h: 532 };
const HY = 640, SUN_R = 46;

export default class Sunset extends PhotoScene {
  bg = shared('sunset.bg', BG);
  text: TextBlock | null = null;
  cx = W / 2; cy = H / 2; hw = 0; hh = 0; border = 8; ang = 0;
  sunX = 0; sunY = 0;

  override async init() {
    await this.loadPhoto();
    const { w, h } = this.img;
    // 有說明時相片往右一點、小一點：60 字的留言整欄都是字，跟相片之間至少留 ~100 px
    const sz = containSize(w, h, this.hasText ? 820 : 1000, this.hasText ? 600 : 640);
    this.hw = sz.w / 2; this.hh = sz.h / 2;
    this.border = clamp(0.015 * Math.min(sz.w, sz.h), 6, 10);
    this.cx = this.hasText ? 1210 : W / 2 - 40;
    this.cy = this.hasText ? 410 : 430;
    this.ang = (hash(this.seed, 7) * 2 - 1) * 1.5 * (Math.PI / 180);
    // 太陽：快落到地平線，躲在相片右邊緣後面一點點（大約露出六成）
    this.sunX = this.cx + this.hw + this.border + SUN_R * 0.2;
    this.sunY = Math.min(HY - 64, this.cy + this.hh - 40);
    if (this.hasText) {
      this.text = this.track(new TextBlock(this.ctx, { ...SUB }, DARK_TEXT(F.ming(500), { lineHeight: 1.42, max: 50, maxLines: 5 }), 'bottom'));
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    // 進場：相片先擋住太陽，再往左滑開
    const open = ease.inOutCubic(prog(t, s + 0.1, s + 1.2));
    const cx = this.cx + (1 - open) * (SUN_R * 2.6) - 10 * ease.inOutQuad(clamp(lt / 12));
    const cy = this.cy - 4 * Math.sin(lt * 0.7);
    const right = cx + this.hw + this.border;
    // 太陽露出來多少（照相片右緣算）
    const vis = clamp((this.sunX + SUN_R - right) / (2 * SUN_R) * 1.4, 0, 1);
    // 每個小節線鏡頭光斑掃過去一次
    let pulse = 0, slide = 0;
    for (const tb of pastBeats(audio, t, 2, true)) {
      const dt = t - tb;
      if (dt < 0 || tb < s + 1.0) continue;
      pulse += Math.sin(Math.min(dt / 0.9, 1) * Math.PI) * Math.exp(-dt / 0.8);
      slide += ease.inOutQuad(clamp(dt / 1.2)) * Math.exp(-Math.max(0, dt - 1.2) / 0.6);
    }
    const u = this.bg.u;
    u.photo!.value = this.tex;
    u.pgain!.value = this.gain;
    (u.center!.value as THREE.Vector2).set(cx, cy);
    (u.halfSize!.value as THREE.Vector2).set(this.hw, this.hh);
    u.border!.value = this.border;
    u.ang!.value = this.ang + 0.004 * Math.sin(lt * 0.5);
    // 相片上的畫面往焦點推（1.18 倍）；很小的照片少推
    const crop = this.crop(settleK(lt), 2 * this.hw, 1.18);
    (u.crop!.value as THREE.Vector4).set(...crop);
    u.lod!.value = this.cropLod(crop, 2 * this.hw);
    u.t!.value = t;
    u.hy!.value = HY;
    (u.sun!.value as THREE.Vector2).set(this.sunX, this.sunY);
    u.sunR!.value = SUN_R;
    u.vis!.value = vis;
    u.pulse!.value = Math.min(pulse, 1.2);
    u.slide!.value = slide;
    // 字出來才壓暗（字還沒出來時地平線的暖光上不要先有一塊暗的）
    u.shade!.value = this.hasText ? prog(t, s + 0.4, s + 1.1) : 0;
    if (this.text) (u.shadeR!.value as THREE.Vector4).set(...this.text.area());
    u.k!.value = (0.75 + 0.25 * ease.outCubic(prog(t, s, s + 0.6))) * (1 - 0.12 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    if (this.text && this.text.draw(t, prog(t, s + 0.9, s + 0.9 + Math.min(1.6, (e - s) * 0.3)))) {
      const op = prog(t, s + 0.6, s + 1.1, ease.outCubic) * (1 - prog(t, e - 0.3, e));
      this.text.blit(comp, renderer, out, op);
    }
    return { bloom: 0.35, bloomThreshold: 1.0, halation: 0.25, vignette: 0.5 };
  }
}
