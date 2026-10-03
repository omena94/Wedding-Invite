// 照片版面「花瓣飄落」（亮）：亮亮的午後，淡淡的樹影在紙一樣的背景上晃，一張白邊相片微微斜著，花瓣從上面一直飄下來。
//  - 照片完整呈現（白邊相片），很小的舊照片最多放大 1.5 倍；照片取樣壓在 0.84 以下。相片上的畫面慢慢往焦點（新人點的臉）推。
//  - 花瓣分三層（淺景深）：遠的小而清楚、在相片後面；中間的跟相片在同一個深度、清楚，會在相片上投一點點影子；
//    近的很大、很糊、半透明，從鏡頭前面滑過去（經過焦點附近時更淡，不會把臉蓋掉）。花瓣的顏色跟著這首歌的配色。
//  - 花瓣會翻、會轉、左右飄；切進來時一陣風把花瓣吹過畫面，相片同時輕輕放下；每個小節線起一陣小風。
//  - 字手寫在相片左邊（霞鶩文楷、深咖啡色）：主字（賓客留言＋署名，或新人的註解）在上，歌詞小一號在下面跟唱；
//    沒有主字時歌詞自己當主字；都沒有就只有相片（移到正中間）。相簿的第一張在說明上面多一行小小的相簿名。
//    飄過字後面的花瓣淡一點（深咖啡色的字落在粉色的大花瓣上會糊）。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, W, H } from '../engine/gl';
import { F } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { focusIn, settleK } from './_photo';
import { PhotoScene, TextBlock, containSize, pastBeats, P5_GLSL, type Cam2 } from './_p5';

export const spec: PlateSpecDecl = { photo: true, prefers: ['portrait', 'square', 'small'], paper: true, family: 'photo', series: 'light', energy: [0, 0.8], bars: [2, 8], weight: 1 };

const BG = () => new FSPass(/* glsl */ `
  ${P5_GLSL}
  uniform sampler2D photo;
  uniform vec2 center; uniform vec2 halfSize; uniform float border; uniform float ang; uniform float lod; uniform float lift;
  uniform vec3 cam; uniform vec2 camD; uniform float t; uniform float k; uniform vec2 focus; uniform vec4 crop;
  // 字的範圍（世界座標 x0, y0, x1, y1）：飄過字後面的花瓣淡一點
  uniform float shade; uniform vec4 shadeR;
  // 風：三層各自累積的水平位移（px）
  uniform vec3 wind;
  // 一片花瓣：q 是花瓣自己的座標（單位長），回傳距離（< 0 在裡面）
  float petalSd(vec2 q) {
    float d = length(vec2(q.x * (1.55 - 0.45 * q.y), q.y)) - 1.0;
    // 花瓣尖端的小缺口
    return max(d, 0.24 - length(vec2(q.x * 1.3, q.y - 1.08)));
  }
  // 一層花瓣：cs 格子大小、sz 花瓣大小、fall 下落速度、blur 糊的程度；回傳 (覆蓋率, 明暗)
  vec2 petals(vec2 p, float cs, float sz, float fall, float wx, float dens, float blur, float seed) {
    vec2 q = (p - vec2(wx, t * fall)) / cs;
    vec2 id = floor(q), f = fract(q);
    vec2 h = hash22(id + seed);
    if (h.x > dens) return vec2(0.0);
    vec2 h2 = hash22(id + seed + 5.3);
    // 左右飄、自己轉、翻面（寬度跟著 cos 變）
    vec2 c = 0.36 + 0.28 * h2 + vec2(0.08 * sin(t * (0.9 + h.y) + h2.x * 6.28), 0.04 * sin(t * 1.3 + h.y * 6.28));
    vec2 d = (f - c) * cs;
    float rot = h.y * 6.28 + t * (0.6 + 1.2 * h2.y) * (h2.x > 0.5 ? 1.0 : -1.0);
    float flip = cos(t * (1.1 + 1.6 * h.x) + h2.y * 6.28);
    vec2 r = rot2(rot) * d / (sz * (0.75 + 0.5 * h2.x));
    r.x /= max(abs(flip), 0.18);
    float sd = petalSd(r) * sz * 0.5 * max(abs(flip), 0.3);
    float a = 1.0 - smoothstep(-0.8 - blur, 0.8 + blur, sd);
    // 明暗：靠花瓣根部深一點、翻到側面時暗一點
    float shadeV = clamp(0.55 + 0.45 * r.y, 0.0, 1.0) * (0.75 + 0.25 * abs(flip));
    return vec2(a, shadeV);
  }
  void main() {
    vec2 ps = p5Px();
    vec2 p = cam.yz + (ps - cam.yz - camD) / cam.x;
    // 花瓣的顏色跟著這首歌的配色（淡淡的訊號色，根部深一點），亮紙上也要看得出來
    vec3 pc = mix(C_PAPER, C_SIGNAL, 0.58);
    vec3 pDark = mix(pc, C_BLOOD, 0.45);
    // 背景：紙一樣的亮底，淡淡的樹影在晃
    float n = fbm(p / 340.0, 3);
    vec3 col = C_PAPER * (0.9 + 0.03 * n);
    vec2 lq = p / vec2(420.0, 300.0) + vec2(t * 0.03, 0.0);
    float leaf = smoothstep(-0.1, 0.5, fbm(lq + 0.3 * vec2(sin(t * 0.4), cos(t * 0.33)), 4));
    col *= 0.9 + 0.08 * leaf;
    vec2 vq = (ps - vec2(${W / 2}.0, ${H / 2}.0)) / vec2(${(W * 0.62).toFixed(1)}, ${(H * 0.66).toFixed(1)});
    col *= 1.0 - 0.1 * smoothstep(0.6, 1.3, length(vq));
    // 遠的花瓣（在相片後面，小而清楚）
    vec2 pf = petals(p, 74.0, 9.0, 46.0, wind.x, 0.3, 0.0, 1.0);
    col = mix(col, mix(pDark, pc, pf.y) * 0.95, pf.x * 0.8);
    // 相片：影子（放下來的瞬間比較遠、比較淡）
    vec2 outer = halfSize + vec2(border);
    vec2 so = vec2(10.0, 16.0) * lift;
    float ds = sdBox(rot2(ang) * (p - center - so), outer);
    col *= 1.0 - (0.3 / lift) * (ds < 0.0 ? 1.0 : exp(-ds / (16.0 + 20.0 * lift)));
    vec2 q = rot2(ang) * (p - center);
    float d = sdBox(q, outer);
    float a = 1.0 - smoothstep(-0.8, 0.8, d);
    if (a > 0.0) {
      vec3 pr = C_BONE * 0.92;
      pr *= 1.0 - 0.05 * smoothstep(-2.5, 0.0, d);
      float di = sdBox(q, halfSize);
      vec3 ph = p5Photo(photo, p5Crop((q + halfSize) / (2.0 * halfSize), crop), lod);
      pr = mix(pr, ph, 1.0 - smoothstep(-0.7, 0.7, di));
      // 樹影也落在相片上（很淡）
      pr *= 0.95 + 0.05 * leaf;
      col = mix(col, pr, a);
    }
    // 字的後面（邊緣很軟，不是框）
    vec2 tc = (shadeR.xy + shadeR.zw) * 0.5, ths = (shadeR.zw - shadeR.xy) * 0.5;
    float behind = 1.0 - shade * exp(-max(sdBox(p - tc, ths) + 20.0, 0.0) / 80.0);
    // 中間的花瓣：跟相片同一個深度，在相片上投一點點影子
    vec2 msh = petals(p - vec2(12.0, 18.0), 150.0, 17.0, 70.0, wind.y, 0.42, 6.0, 7.0);
    col *= 1.0 - 0.14 * msh.x;
    vec2 pm = petals(p, 150.0, 17.0, 70.0, wind.y, 0.42, 0.0, 7.0);
    float nearF = smoothstep(90.0, 300.0, length(p - focus));
    col = mix(col, mix(pDark, pc, pm.y), pm.x * mix(0.55, 0.97, max(nearF, 1.0 - a)) * mix(1.0, 0.45, 1.0 - behind));
    // 近的花瓣：很大、很糊、半透明，從鏡頭前滑過
    vec2 pn = petals(ps, 380.0, 64.0, 150.0, wind.z, 0.34, 22.0, 13.0);
    float nearA = pn.x * mix(0.18, 0.5, max(smoothstep(160.0, 420.0, length(ps - focus)), 1.0 - a)) * behind;
    col = mix(col, mix(pDark, pc, pn.y) * 1.02, nearA);
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, pgain: { value: 1 }, center: { value: new THREE.Vector2() }, halfSize: { value: new THREE.Vector2() }, border: { value: 22 },
  ang: { value: 0 }, lod: { value: 0 }, lift: { value: 1 }, cam: { value: new THREE.Vector3(1, W / 2, H / 2) }, camD: { value: new THREE.Vector2() },
  t: { value: 0 }, k: { value: 1 }, focus: { value: new THREE.Vector2() }, wind: { value: new THREE.Vector3() },
  crop: { value: new THREE.Vector4(0, 0, 1, 1) }, shade: { value: 0 }, shadeR: { value: new THREE.Vector4() },
});

/** 說明欄的寬（60 字的留言在 5 行內、字級 ≥ 40）、跟相片的間距。 */
const COL_W = 580, GAP = 90;

export default class Petals extends PhotoScene {
  bg = shared('petals.bg', BG);
  text: TextBlock | null = null;
  cx = W / 2; cy = H / 2; hw = 0; hh = 0; border = 22; ang = 0;

  override async init() {
    await this.loadPhoto();
    const { w, h } = this.img;
    const sz = containSize(w, h, this.hasText ? 860 : 1060, this.hasText ? 660 : 680);
    this.hw = sz.w / 2; this.hh = sz.h / 2;
    this.border = clamp(0.045 * Math.min(sz.w, sz.h), 14, 30);
    const tw = sz.w + 2 * this.border;
    // 有說明：說明在左、相片在右；沒有：相片在正中間偏左一點
    const groupW = this.hasText ? COL_W + GAP + tw : tw;
    // 有說明時左邊多留一點：鏡頭推近時字還是離邊 ≥ 96
    const x0 = Math.max(this.hasText ? 170 : 130, (W - groupW) / 2 - (this.hasText ? 0 : 30));
    this.cx = this.hasText ? x0 + COL_W + GAP + tw / 2 : x0 + tw / 2;
    this.cy = H / 2 - 50;
    this.ang = (hash(this.seed, 7) * 2 - 1) * 2.2 * (Math.PI / 180);
    if (this.hasText) {
      const box = { x: x0, y: 150, w: COL_W, h: 640 };
      this.text = this.track(new TextBlock(this.ctx, box, {
        family: F.hand(400), lineHeight: 1.42, maxLines: 5, color: rgba('sepia', 0.92), unsung: rgba('sepia', 0.3), active: mixRgba('signal', 'sepia', 0.45),
        sigColor: rgba('sepia', 0.72),
        label: { family: F.hand(700), size: 24, color: rgba('sepia', 0.62), tracking: 5, rule: mixRgba('signal', 'sepia', 0.3) },
      }, 'center'));
      const bh = this.text.height;
      this.text.box.y = clamp(this.cy - bh / 2, 150, 790 - bh);
      this.text.box.h = bh + 4;
    }
  }

  /** 風：進場的一陣大風＋每個小節線一陣小風（累積的位移，只看 t）。 */
  private wind(t: number) {
    const lt = t - this.ctx.start;
    let g = 260 * (1 - Math.exp(-Math.max(0, lt) / 0.55));
    for (const tb of pastBeats(this.ctx.audio, t, 3, true)) {
      const dt = t - tb;
      if (dt < 0 || tb < this.ctx.start + 0.3) continue;
      g += 90 * (1 - Math.exp(-dt / 0.6));
    }
    return 22 * lt + g;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const z0 = 1 - Math.exp(-lt / 7);
    const pivotX = this.text ? (this.cx + this.text.box.x + COL_W / 2) / 2 : this.cx;
    const cam: Cam2 = { z: 1 + 0.035 * z0, cx: pivotX, cy: this.cy, dx: 0, dy: 0 };
    const drop = ease.outCubic(prog(t, s, s + 0.75));
    const dir = hash(this.seed, 9) < 0.5 ? -1 : 1;
    const drift = ease.inOutQuad(clamp(lt / 10));
    const u = this.bg.u;
    u.photo!.value = this.tex;
    u.pgain!.value = this.gain;
    const cy = this.cy - 30 * (1 - drop) - 5 * drift;
    (u.center!.value as THREE.Vector2).set(this.cx + dir * 10 * drift, cy);
    (u.halfSize!.value as THREE.Vector2).set(this.hw, this.hh);
    u.border!.value = this.border;
    u.ang!.value = this.ang + dir * (2.4 * (1 - drop)) * (Math.PI / 180);
    u.lift!.value = lerp(2.2, 1, drop);
    // 相片上的畫面往焦點推（1.18 倍）；很小的照片少推
    const sw = 2 * this.hw * cam.z;
    const crop = this.crop(settleK(lt), sw, 1.18);
    (u.crop!.value as THREE.Vector4).set(...crop);
    u.lod!.value = this.cropLod(crop, sw);
    (u.cam!.value as THREE.Vector3).set(cam.z, cam.cx, cam.cy);
    (u.camD!.value as THREE.Vector2).set(cam.dx, cam.dy);
    u.t!.value = t;
    const wd = this.wind(t);
    (u.wind!.value as THREE.Vector3).set(wd * 0.5, wd * 0.8, wd * 1.4);
    // 焦點（畫面座標，給近的花瓣避開）
    const [fu, fv] = focusIn(this.photo, crop);
    const fxw = this.cx - this.hw + 2 * this.hw * fu, fyw = cy - this.hh + 2 * this.hh * fv;
    (u.focus!.value as THREE.Vector2).set(cam.cx + (fxw - cam.cx) * cam.z, cam.cy + (fyw - cam.cy) * cam.z);
    u.k!.value = 1 - 0.05 * prog(t, e - 0.3, e);
    u.shade!.value = this.text ? 0.8 : 0;
    if (this.text) (u.shadeR!.value as THREE.Vector4).set(...this.text.area());
    this.bg.render(renderer, out);
    if (this.text && this.text.draw(t, prog(t, s + 0.6, s + 0.6 + Math.min(1.8, (e - s) * 0.3)))) {
      const op = prog(t, s + 0.3, s + 0.8, ease.outCubic) * (1 - prog(t, e - 0.3, e));
      this.text.blit(comp, renderer, out, op, cam);
    }
    return { paper: 1, bloom: 0.12, bloomThreshold: 1.2, halation: 0.04, vignette: 0.22 };
  }
}
