// 照片版面「百葉窗光」（暗）：午後，暗暗的房間牆上掛著一張木框相片，窗外的太陽穿過百葉窗，
// 在牆上與相片上投出一條一條斜斜的光，很慢地移動（太陽在走）。
//  - 照片完整放在木框裡，很小的舊照片最多放大 1.5 倍；光條落在牆上很明顯，落在照片上只淡淡地亮一點、暗一點，
//    不會把臉蓋掉。照片取樣壓在 0.84 以下，光再亮也不發光。框裡的畫面慢慢往焦點（新人點的臉）推。
//  - 切進來時有人拉開百葉窗：光條從細細的縫張開成寬的光帶、整片光亮起來；每個小節線窗外起一陣風，
//    葉片輕輕晃一下（光條跟著抖、慢慢停）。光帶裡有灰塵在飄。
//  - 相片的影子落在右下（光從左上來）：光條碰到相片邊就被切斷。
//  - 字寫在相片左邊的暗牆上（思源宋體、靠左）：主字（賓客留言＋署名，或新人的註解）在上，歌詞小一號在下面跟唱；
//    沒有主字時歌詞自己當主字；都沒有就只有相片（移到正中間）。相簿的第一張在說明上面多一行小小的相簿名。
//  - 鏡頭很慢地推近、往右漂一點。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, W, H } from '../engine/gl';
import { F } from '../engine/type';
import { clamp, ease, hash, prog } from '../engine/util';
import { settleK } from './_photo';
import { PhotoScene, TextBlock, DARK_TEXT, containSize, pastBeats, P5_GLSL, type Cam2 } from './_p5';

export const spec: PlateSpecDecl = { photo: true, prefers: ['portrait', 'small'], family: 'photo', series: 'light', energy: [0, 0.8], bars: [2, 8], weight: 1 };

const BG = () => new FSPass(/* glsl */ `
  ${P5_GLSL}
  uniform sampler2D photo;
  uniform vec2 center; uniform vec2 halfSize; uniform float frameW; uniform float lod; uniform vec4 crop;
  uniform vec3 cam; uniform vec2 camD; uniform float t; uniform float k;
  uniform float duty; uniform float phase; uniform vec2 patchC; uniform float patchHalf; uniform float sun;
  uniform float shade; uniform vec4 shadeR;
  // 光條的方向（往右下斜）與垂直它的方向
  const vec2 SD = vec2(0.9417, 0.3363);
  const vec2 SN = vec2(-0.3363, 0.9417);
  const float PER = 76.0;
  // 牆上（或相片上）某一點的直射光：窗戶投影的光斑 × 百葉窗的光條
  float sunAt(vec2 q, float pen) {
    vec2 d = q - patchC;
    float u = dot(d, SD), v = dot(d, SN);
    float patchK = (1.0 - smoothstep(patchHalf - 140.0, patchHalf, abs(u))) * (1.0 - smoothstep(380.0, 520.0, abs(v)));
    float vv = v + phase + 3.0 * snoise(vec2(u / 420.0, 0.5));
    float f = fract(vv / PER);
    float dd = abs(f - 0.5) * PER;
    // 每片葉片打開的角度差一點點（不是電腦畫的完美條紋）
    float open = duty * PER * 0.5 * (0.9 + 0.2 * hash11(floor(vv / PER) + 7.0));
    float st = 1.0 - smoothstep(open - pen, open + pen, dd);
    return patchK * st;
  }
  // 光帶裡飄的灰塵（每格最多一顆，不出格，只看自己那一格）
  float motes(vec2 p) {
    float acc = 0.0;
    for (int l = 0; l < 2; l++) {
      float fl = float(l);
      float cs = 64.0 + 46.0 * fl;
      vec2 q = (p + vec2(t * (7.0 + 5.0 * fl), -t * (3.0 + 2.0 * fl))) / cs;
      vec2 id = floor(q), f = fract(q);
      vec2 h = hash22(id + fl * 17.3);
      if (h.x > 0.42) continue;
      vec2 pos = 0.22 + 0.56 * hash22(id + 3.1 + fl) + 0.12 * vec2(sin(t * 0.7 + h.y * 6.28), cos(t * 0.53 + h.x * 6.28));
      float d = length((f - pos) * cs);
      float r = 0.9 + 1.5 * h.y;
      acc += (1.0 - smoothstep(r * 0.4, r * 1.7, d)) * (0.35 + 0.65 * h.y) * (0.55 + 0.45 * sin(t * 1.7 + h.x * 40.0));
    }
    return acc;
  }
  void main() {
    vec2 ps = p5Px();
    // 鏡頭：畫面 = c + (世界 − c) × z + d
    vec2 p = cam.yz + (ps - cam.yz - camD) / cam.x;
    vec3 sunCol = mix(C_BONE, C_EMBER, 0.45);
    // 牆：暖灰的灰泥，很淡的斑駁
    float n = fbm(p / 260.0, 4);
    float grain = snoise(p / 3.0) * 0.5 + 0.5;
    vec3 wallA = mix(C_BONE, C_ASH, 0.55) * (0.5 + 0.08 * n + 0.03 * grain);
    float Lw = sunAt(p, 7.0) * sun;
    // 相片的影子（往右下，光從左上來）：擋掉直射光，貼著相片的地方也暗一點
    vec2 outer = halfSize + vec2(frameW);
    float ds = sdBox(p - center - vec2(16.0, 26.0), outer);
    float shadow = 1.0 - smoothstep(-6.0, 22.0, ds);
    float ao = 1.0 - 0.35 * exp(-max(sdBox(p - center, outer), 0.0) / 30.0);
    vec3 col = wallA * (0.045 * ao + 0.72 * sunCol * Lw * (1.0 - shadow * 0.92));
    // 房間另一頭的反光：左下很淡的暖光，牆不會全黑
    col += wallA * sunCol * 0.03 * smoothstep(1400.0, 200.0, length(p - vec2(300.0, 900.0)));
    // 相片與木框
    float d = sdBox(p - center, outer);
    float a = 1.0 - smoothstep(-0.8, 0.8, d);
    if (a > 0.0) {
      vec2 q = p - center;
      float Lf = sunAt(p, 6.0) * sun;
      // 木框（固定色：原木），木紋沿著框的方向；外緣一道亮的斜面
      float along = abs(q.x) > halfSize.x ? q.y : q.x;
      float wood = 0.75 + 0.25 * snoise(vec2(along / 90.0, (abs(q.x) > halfSize.x ? q.x : q.y) / 2.5));
      vec3 fr = C_FUR * 0.16 * wood;
      fr *= 0.35 + 2.2 * sunCol * Lf;
      fr += sunCol * 0.05 * Lf * smoothstep(-3.0, -1.0, d);
      float di = sdBox(q, halfSize);
      if (di < 0.5) {
        vec2 uv = p5Crop((q + halfSize) / (2.0 * halfSize), crop);
        vec3 ph = p5Photo(photo, uv, lod);
        // 光條落在照片上只淡淡地亮一點（0.74～1.0），不會把臉蓋掉
        float Lp = sunAt(p, 9.0) * sun;
        ph *= 0.74 + 0.26 * Lp;
        // 木框內緣的一道細影
        ph *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 6.0, -di));
        fr = mix(fr, ph, 1.0 - smoothstep(-0.7, 0.7, di));
      }
      col = mix(col, fr, a);
    }
    // 空氣裡的光束（很淡）與灰塵
    float air = sunAt(p + vec2(-60.0, -40.0), 30.0) * sun;
    col += sunCol * (0.012 * air + 0.22 * motes(p) * air);
    // 字的後面：光條掃到說明欄的右邊時壓暗（60 字的留言整欄都是字，紙白的字落在亮條上會糊）
    col = p5Shade(col, p, shadeR, shade);
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, pgain: { value: 1 }, center: { value: new THREE.Vector2() }, halfSize: { value: new THREE.Vector2() }, frameW: { value: 14 }, lod: { value: 0 },
  crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  cam: { value: new THREE.Vector3(1, W / 2, H / 2) }, camD: { value: new THREE.Vector2() }, t: { value: 0 }, k: { value: 1 },
  duty: { value: 0.55 }, phase: { value: 0 }, patchC: { value: new THREE.Vector2() }, patchHalf: { value: 700 }, sun: { value: 1 },
  shade: { value: 0 }, shadeR: { value: new THREE.Vector4() },
});

/** 說明欄的寬（60 字的留言在 5 行內、字級 ≥ 40）、跟相片的間距。 */
const COL_W = 580, GAP = 90;

export default class Blinds extends PhotoScene {
  bg = shared('blinds.bg', BG);
  text: TextBlock | null = null;
  cx = W / 2; cy = H / 2; hw = 0; hh = 0;

  override async init() {
    await this.loadPhoto();
    const { w, h } = this.img;
    // 有說明：說明在左、相片在右；沒有：相片在正中間偏左一點（右下角的 QR 不要壓在相片上）
    const sz = containSize(w, h, this.hasText ? 900 : 1100, this.hasText ? 690 : 700);
    this.hw = sz.w / 2; this.hh = sz.h / 2;
    const tw = sz.w + 28;
    const groupW = this.hasText ? COL_W + GAP + tw : tw;
    // 有說明時左邊多留一點：鏡頭推近、往旁邊漂時字還是離邊 ≥ 96
    const x0 = Math.max(this.hasText ? 170 : 130, (W - groupW) / 2 + (this.hasText ? 0 : -30));
    this.cx = this.hasText ? x0 + COL_W + GAP + tw / 2 : x0 + tw / 2;
    this.cy = H / 2 - 44;
    if (this.hasText) {
      const box = { x: x0, y: 150, w: COL_W, h: 650 };
      this.text = this.track(new TextBlock(this.ctx, box, DARK_TEXT(F.ming(500), { lineHeight: 1.45, maxLines: 5 }), 'center'));
      // 說明那一塊跟相片的中心對齊
      const bh = this.text.height;
      this.text.box.y = clamp(this.cy - bh / 2 - 6, 150, 800 - bh);
      this.text.box.h = bh + 4;
    }
  }

  /** 每個小節線窗外起一陣風：葉片晃一下（光條抖、慢慢停）。 */
  private sway(t: number) {
    let s = 0;
    for (const tb of pastBeats(this.ctx.audio, t, 3, true)) {
      const dt = t - tb;
      if (dt < 0 || tb < this.ctx.start - 0.01) continue;
      s += Math.sin(dt * 9.5) * Math.exp(-dt / 0.55);
    }
    return s;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const dir = hash(this.seed, 3) < 0.5 ? -1 : 1;
    // 鏡頭：一開始快、之後越來越慢地推近（最多 4.5%），往一邊漂一點
    const z0 = 1 - Math.exp(-lt / 7);
    const cam: Cam2 = { z: 1 + 0.045 * z0, cx: this.cx - (this.hasText ? 200 : 0), cy: this.cy, dx: dir * 16 * ease.inOutQuad(clamp(lt / 12)), dy: 0 };
    // 拉開百葉窗：光條從細縫張開、整片亮起來
    const open = ease.outCubic(prog(t, s + 0.05, s + 1.0));
    const u = this.bg.u;
    u.photo!.value = this.tex;
    u.pgain!.value = this.gain;
    (u.center!.value as THREE.Vector2).set(this.cx, this.cy);
    (u.halfSize!.value as THREE.Vector2).set(this.hw, this.hh);
    // 框裡的畫面往焦點推（掛在牆上的相框：1.18 倍）；很小的照片少推
    const sw = 2 * this.hw * cam.z;
    const crop = this.crop(settleK(lt), sw, 1.18);
    (u.crop!.value as THREE.Vector4).set(...crop);
    u.lod!.value = this.cropLod(crop, sw);
    (u.cam!.value as THREE.Vector3).set(cam.z, cam.cx, cam.cy);
    (u.camD!.value as THREE.Vector2).set(cam.dx, cam.dy);
    u.t!.value = t;
    u.duty!.value = 0.07 + 0.47 * open;
    // 光條的相位：太陽在走（很慢）＋拉開時葉片轉動＋風
    u.phase!.value = -22 * lt - 46 * (1 - open) + 7 * this.sway(t);
    // 光斑：照在相片上，慢慢往右下移；有說明時光斑的左緣落在說明與相片之間（字在暗處才清楚）
    (u.patchC!.value as THREE.Vector2).set(this.cx + (this.hasText ? 40 : -120) + 5 * lt, this.cy - 40 + 2.5 * lt);
    u.patchHalf!.value = this.hasText ? this.hw + 200 : 700;
    u.sun!.value = 0.45 + 0.55 * open;
    u.shade!.value = this.text ? 0.7 : 0;
    if (this.text) (u.shadeR!.value as THREE.Vector4).set(...this.text.area());
    u.k!.value = (0.55 + 0.45 * ease.outCubic(prog(t, s, s + 0.6))) * (1 - 0.12 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    if (this.text && this.text.draw(t, prog(t, s + 0.5, s + 0.5 + Math.min(1.6, (e - s) * 0.3)))) {
      const op = prog(t, s + 0.3, s + 0.8, ease.outCubic) * (1 - prog(t, e - 0.3, e));
      this.text.blit(comp, renderer, out, op, cam);
    }
    return { bloom: 0.18, bloomThreshold: 1.1, halation: 0.12, vignette: 0.5 };
  }
}
