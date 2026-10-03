// 照片版面「燭光」（暗）：夜裡的房間，一個木框相框立在桌上，旁邊一根蠟燭，前景還有一根糊糊的蠟燭（淺景深）。
//  - 照片完整放在木框裡，很小的舊照片最多放大 1.5 倍；燭光照在照片上是暖暖的、靠蠟燭那一邊亮一點，
//    跟著燭火輕輕閃（亮度只在 0.68～1 之間變，不會把照片照暗或照到發光：照片取樣壓在 0.84 以下）。
//    框裡的畫面慢慢往焦點（新人點的臉）推。
//  - 燭火一直在搖：相框投在牆上的大影子跟著晃，桌面上映著燭火的倒影；大鼓時火焰長高一點。
//  - 切進來時旁邊那根蠟燭剛被點著：火一下竄起來再穩住，牆、照片跟著亮起來。
//  - 字寫在蠟燭另一邊的牆上（霞鶩文楷，手寫感）：主字（賓客留言＋署名，或新人的註解）在上，歌詞小一號在下面跟唱；
//    沒有主字時歌詞自己當主字；都沒有就只有相框與蠟燭。相簿的第一張在說明上面多一行小小的相簿名。
//  - 鏡頭很慢地推近、往蠟燭那邊靠一點點。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, W, H } from '../engine/gl';
import { F } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, fbm1, prog } from '../engine/util';
import { settleK } from './_photo';
import { PhotoScene, TextBlock, DARK_TEXT, containSize, P5_GLSL, type Cam2 } from './_p5';

export const spec: PlateSpecDecl = { photo: true, prefers: ['landscape', 'square', 'small'], family: 'photo', series: 'light', energy: [0, 0.7], bars: [2, 8], weight: 1 };

const BG = () => new FSPass(/* glsl */ `
  ${P5_GLSL}
  uniform sampler2D photo;
  uniform vec2 center; uniform vec2 halfSize; uniform float frameW; uniform float lod; uniform vec4 crop;
  uniform vec3 cam; uniform vec2 camD; uniform float t; uniform float k; uniform float tableY;
  // 旁邊的蠟燭：x、蠟頂 y、寬、高；燭火：亮度、高度、偏擺
  uniform vec4 c1; uniform vec3 f1;
  // 前景糊掉的蠟燭：x、燭火 y、亮度
  uniform vec3 c2;
  vec3 warmCol() { return mix(C_SIGNAL, C_EMBER, 0.35); }
  // 燭火：水滴形，外層訊號色、裡面的芯更熱（會發光）
  vec3 flame(vec2 p, vec2 wick, float h, float lean, float I) {
    vec2 q = p - wick;
    float u = -q.y / h;
    float x = q.x - lean * u * u * h;
    float rx = h * 0.2 * (1.0 - 0.75 * smoothstep(0.35, 1.0, u)) * smoothstep(-0.12, 0.2, u) + 0.6;
    float e = length(vec2(x / rx, (u - 0.42) / 0.6));
    float body = 1.0 - smoothstep(0.7, 1.0, e);
    float core = 1.0 - smoothstep(0.15, 0.7, length(vec2(x / rx * 1.5, (u - 0.24) / 0.28)));
    vec2 g = q - vec2(lean * 0.2 * h, -h * 0.45);
    float glow = exp(-dot(g, g) / (h * h * 1.4));
    return (C_SIGNAL * 1.5 * body + mix(C_EMBER, vec3(1.0, 0.95, 0.85), 0.45) * 2.6 * core + warmCol() * 0.22 * glow) * I;
  }
  // 某一點收到的燭光（兩根蠟燭）
  float lightAt(vec2 p, vec2 l1, float r1) {
    vec2 d1 = (p - l1) / r1;
    vec2 d2 = (p - vec2(c2.x, c2.y)) / 520.0;
    return f1.x / (1.0 + dot(d1, d1)) + 0.45 * c2.z / (1.0 + dot(d2, d2));
  }
  void main() {
    vec2 ps = p5Px();
    vec2 p = cam.yz + (ps - cam.yz - camD) / cam.x;
    vec3 warm = warmCol();
    vec2 wick1 = vec2(c1.x, c1.y - 6.0);
    vec2 l1 = wick1 + vec2(f1.z * 0.3 * f1.y, -f1.y * 0.5);
    vec3 col;
    if (p.y < tableY) {
      // 牆：暗暗的暖灰灰泥
      float n = fbm(p / 240.0, 4);
      vec3 wallA = mix(C_INK2, C_GRAPHITE, 0.4) * (0.85 + 0.2 * n);
      float L = lightAt(p, l1, 300.0);
      // 相框投在牆上的影子：燭火在相框右下，影子往左上放大，跟著火晃
      vec2 off = (center - l1) * 0.16;
      vec2 outer = halfSize + vec2(frameW);
      float ds = sdBox(p - center - off, outer * 1.06);
      float sh = 1.0 - smoothstep(-30.0, 40.0, ds);
      L -= 0.85 * sh * f1.x / (1.0 + dot((p - l1) / 300.0, (p - l1) / 300.0));
      col = wallA * (0.05 + 1.5 * warm * max(L, 0.0));
      // 相框：深色木框，靠蠟燭那一邊的外緣亮一點
      vec2 q = p - center;
      float d = sdBox(q, outer);
      // 相框立在桌上的接觸影
      col *= 1.0 - 0.4 * exp(-max(d, 0.0) / 14.0) * smoothstep(center.y, center.y + halfSize.y, p.y);
      float a = 1.0 - smoothstep(-0.8, 0.8, d);
      if (a > 0.0) {
        float Lf = lightAt(p, l1, 420.0);
        float along = abs(q.x) > halfSize.x ? q.y : q.x;
        float wood = 0.8 + 0.2 * snoise(vec2(along / 80.0, (abs(q.x) > halfSize.x ? q.x : q.y) / 3.0));
        vec3 fr = C_FUR * 0.06 * wood * (0.4 + 2.0 * Lf);
        vec2 toL = normalize(l1 - p);
        float rim = smoothstep(-4.0, -1.0, d) * max(dot(toL, normalize(q)), 0.0);
        fr += warm * 0.08 * rim * Lf;
        float di = sdBox(q, halfSize);
        if (di < 0.5) {
          vec3 ph = p5Photo(photo, p5Crop((q + halfSize) / (2.0 * halfSize), crop), lod);
          // 燭光照在照片上：靠蠟燭的那邊亮，跟著火閃，但只在 0.68～1 之間
          float Lp = lightAt(p, l1, 900.0);
          ph *= 0.68 + 0.32 * clamp(Lp / 0.75, 0.0, 1.0);
          ph *= mix(vec3(1.0), warm / max(max(warm.r, warm.g), warm.b), 0.12);
          ph *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 7.0, -di));
          fr = mix(fr, ph, 1.0 - smoothstep(-0.7, 0.7, di));
        }
        col = mix(col, fr, a);
      }
    } else {
      // 桌面：很暗的木頭，映著燭火
      float yy = p.y - tableY;
      float grain = 0.8 + 0.2 * snoise(vec2(p.x / 300.0, yy / 6.0));
      col = C_FUR * 0.018 * grain;
      float L = lightAt(vec2(p.x, tableY - 10.0), l1, 300.0);
      col += C_FUR * 0.05 * L * exp(-yy / 120.0);
      // 燭火的倒影：往下拉長、糊
      float rx = (p.x - wick1.x - f1.z * 4.0) / 26.0;
      col += warm * 0.35 * f1.x * exp(-rx * rx) * exp(-abs(yy - (c1.y + c1.w - tableY) - 20.0) / 50.0) * smoothstep(c1.y + c1.w - 10.0, c1.y + c1.w + 30.0, p.y);
      // 桌緣一道很細的亮線
      col += warm * 0.05 * f1.x * exp(-yy / 2.0);
    }
    // 旁邊那根蠟燭（在相框右前方、站在桌上）
    {
      vec2 q = p - vec2(c1.x, c1.y + c1.w * 0.5);
      float d = sdBox(q, vec2(c1.z * 0.5, c1.w * 0.5) - 6.0) - 6.0;
      float a = 1.0 - smoothstep(-0.8, 0.8, d);
      if (a > 0.0) {
        float nx = clamp(q.x / (c1.z * 0.5), -1.0, 1.0);
        float shade = sqrt(1.0 - nx * nx);
        vec3 wax = mix(C_BONE, C_PAPER, 0.5);
        // 蠟頂透光：越靠上越亮、越暖；側面背光，暗
        float top = exp(-(p.y - c1.y) / 34.0);
        float side = 0.35 + 0.65 * smoothstep(0.0, 0.8, shade);
        vec3 wc = wax * (0.012 + 0.035 * shade) + warm * (0.5 * top + 0.025) * f1.x * side;
        col = mix(col, wc, a);
      }
      // 燭芯
      col = mix(col, C_INK, (1.0 - smoothstep(0.8, 1.6, abs(p.x - c1.x))) * step(c1.y - 9.0, p.y) * step(p.y, c1.y));
      col += flame(p, wick1, f1.y, f1.z, f1.x);
    }
    // 前景糊掉的蠟燭（淺景深：邊緣很軟、火是一團大光暈）
    {
      vec2 q = p - vec2(c2.x, c2.y + 230.0);
      float d = sdBox(q, vec2(78.0, 210.0));
      float a = (1.0 - smoothstep(-26.0, 26.0, d)) * 0.92;
      float nx = clamp(q.x / 90.0, -1.0, 1.0);
      vec3 wax = mix(C_BONE, C_PAPER, 0.5);
      vec3 wc = wax * 0.04 * sqrt(1.0 - nx * nx) + warm * 0.4 * c2.z * exp(-max(p.y - c2.y - 20.0, 0.0) / 60.0) * sqrt(1.0 - nx * nx);
      col = mix(col, wc, a);
      vec2 g = (p - vec2(c2.x, c2.y - 40.0)) / vec2(46.0, 70.0);
      col += warm * (1.25 * exp(-dot(g, g)) + 0.18 * exp(-dot(g, g) * 0.15)) * c2.z;
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, pgain: { value: 1 }, center: { value: new THREE.Vector2() }, halfSize: { value: new THREE.Vector2() }, frameW: { value: 22 }, lod: { value: 0 },
  crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  cam: { value: new THREE.Vector3(1, W / 2, H / 2) }, camD: { value: new THREE.Vector2() }, t: { value: 0 }, k: { value: 1 }, tableY: { value: 860 },
  c1: { value: new THREE.Vector4() }, f1: { value: new THREE.Vector3() }, c2: { value: new THREE.Vector3() },
});

/** 說明欄的寬（60 字的留言在 5 行內、字級 ≥ 40）、跟蠟燭的間距、桌面的高度。 */
const COL_W = 560, GAP = 70, TABLE = 862;

export default class Candle extends PhotoScene {
  bg = shared('candle.bg', BG);
  text: TextBlock | null = null;
  cx = W / 2; cy = H / 2; hw = 0; hh = 0; frameW = 22;
  /** 旁邊那根蠟燭的 x、蠟頂的 y。 */
  candleX = 0; candleTop = 0;

  override async init() {
    await this.loadPhoto();
    const { w, h } = this.img;
    const sz = containSize(w, h, this.hasText ? 800 : 1000, 620);
    this.hw = sz.w / 2; this.hh = sz.h / 2;
    this.frameW = clamp(0.035 * Math.min(sz.w, sz.h), 14, 24);
    const tw = sz.w + 2 * this.frameW;
    // 相框、蠟燭、說明排成一組：相框在左、蠟燭在中間、說明在右
    const candleZone = 150;
    const groupW = tw + candleZone + (this.hasText ? GAP + COL_W : 0);
    const x0 = Math.max(150, (W - groupW) / 2);
    this.cx = x0 + tw / 2;
    this.cy = TABLE - 6 - this.frameW - this.hh;
    this.candleX = x0 + tw + candleZone * 0.55;
    this.candleTop = TABLE + 34 - 210;
    if (this.hasText) {
      const box = { x: x0 + tw + candleZone + GAP, y: 150, w: COL_W, h: 610 };
      this.text = this.track(new TextBlock(this.ctx, box, DARK_TEXT(F.hand(400), {
        lineHeight: 1.42, maxLines: 5, color: rgba('bone', 0.95), label: { family: F.hand(700), size: 24, color: rgba('ash', 0.9), tracking: 5, rule: rgba('signal', 0.75) },
      }), 'center'));
      const bh = this.text.height;
      this.text.box.y = clamp(this.candleTop - 60 - bh * 0.6, 150, 760 - bh);
      this.text.box.h = bh + 4;
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const z0 = 1 - Math.exp(-lt / 7);
    const cam: Cam2 = { z: 1 + 0.045 * z0, cx: this.candleX, cy: this.cy, dx: -12 * ease.inOutQuad(clamp(lt / 12)), dy: 0 };
    // 點火：火一下竄起來再穩住
    const ign = prog(t, s + 0.12, s + 0.5);
    const flare = Math.exp(-Math.max(0, t - s - 0.3) / 0.25) * (t > s + 0.12 ? 1 : 0);
    // 燭火的閃：兩種速度的雜訊（確定性：只看 t）＋大鼓
    const kick = audio.hit('kick', t, 0.16);
    const flick = 1 + 0.07 * fbm1(t * 6.5, 3, 11) + 0.04 * fbm1(t * 17, 2, 5);
    const I1 = ease.outCubic(ign) * flick * (1 + 0.07 * kick) * (1 + 0.5 * flare);
    const h1 = (38 + 6 * fbm1(t * 4.0, 2, 3) + 8 * kick) * (0.3 + 0.7 * ease.outCubic(ign)) * (1 + 0.4 * flare);
    const lean = 0.18 * fbm1(t * 1.3, 3, 7) + 0.08 * Math.sin(t * 2.3);
    const I2 = 1 + 0.06 * fbm1(t * 5.2 + 40, 3, 13);
    const u = this.bg.u;
    u.photo!.value = this.tex;
    u.pgain!.value = this.gain;
    (u.center!.value as THREE.Vector2).set(this.cx, this.cy);
    (u.halfSize!.value as THREE.Vector2).set(this.hw, this.hh);
    u.frameW!.value = this.frameW;
    // 框裡的畫面往焦點推（桌上的相框：1.18 倍）；很小的照片少推
    const sw = 2 * this.hw * cam.z;
    const crop = this.crop(settleK(lt), sw, 1.18);
    (u.crop!.value as THREE.Vector4).set(...crop);
    u.lod!.value = this.cropLod(crop, sw);
    (u.cam!.value as THREE.Vector3).set(cam.z, cam.cx, cam.cy);
    (u.camD!.value as THREE.Vector2).set(cam.dx, cam.dy);
    u.t!.value = t;
    u.tableY!.value = TABLE;
    (u.c1!.value as THREE.Vector4).set(this.candleX, this.candleTop, 74, 210);
    (u.f1!.value as THREE.Vector3).set(I1, h1, lean);
    (u.c2!.value as THREE.Vector3).set(70, 905, I2);
    u.k!.value = (0.75 + 0.25 * ease.outCubic(prog(t, s, s + 0.6))) * (1 - 0.12 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    if (this.text && this.text.draw(t, prog(t, s + 0.6, s + 0.6 + Math.min(1.6, (e - s) * 0.3)))) {
      const op = prog(t, s + 0.35, s + 0.85, ease.outCubic) * (1 - prog(t, e - 0.3, e));
      this.text.blit(comp, renderer, out, op * (0.93 + 0.07 * flick), cam);
    }
    return { bloom: 0.4, bloomThreshold: 1.05, halation: 0.3, vignette: 0.55 };
  }
}
