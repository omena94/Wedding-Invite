// 照片版面「雪花球」（暗）：夜裡房間的桌上一顆很大的雪花球（鏡頭靠得很近），照片像一張小相片立在球裡的雪堆上。
//  - 照片完整呈現（白邊）；隔著水和玻璃看：中間放大一點、靠近玻璃邊被壓扁（球面的變形），邊上一圈玻璃的反光。
//    照片取樣壓在 0.84 以下，不發光。很小的舊照片在畫面上最多放大 1.5 倍（球裡 1.2 倍 × 透鏡 1.25 倍）。
//    相片上的畫面慢慢往焦點（新人點的臉）推。
//  - 切進來時雪花球被搖了一下：整顆晃、雪在球裡捲起來轉，然後越轉越慢、慢慢飄落；每個小節線水裡再輕輕捲一下。
//    雪花分兩層（相片後面、相片前面），前面那層大一點、糊一點。
//  - 背後的房間是暗的，遠處幾個暖色的光斑（失焦的燈），左上一盞燈照在玻璃上留下一道彎彎的反光。
//  - 字寫在球的右邊（霞鶩文楷）：主字（賓客留言＋署名，或新人的註解）在上，歌詞小一號在下面跟唱；
//    沒有主字時歌詞自己當主字；都沒有就只有雪花球（移到正中間）。相簿的第一張在說明上面多一行小小的相簿名。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, W, H } from '../engine/gl';
import { F } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, prog } from '../engine/util';
import { settleK } from './_photo';
import { PhotoScene, TextBlock, DARK_TEXT, containSize, pastBeats, P5_GLSL, type Cam2 } from './_p5';

export const spec: PlateSpecDecl = { photo: true, prefers: ['square', 'landscape', 'small'], family: 'photo', series: 'light', energy: [0, 0.75], bars: [3, 8], weight: 1 };

const BG = () => new FSPass(/* glsl */ `
  ${P5_GLSL}
  uniform sampler2D photo;
  // 球心、半徑；球裡的相片（球內座標）中心與半寬高、白邊；雪堆的高度（球內座標）
  uniform vec2 gc; uniform float R; uniform vec2 phC; uniform vec2 phH; uniform float border; uniform float floorY;
  uniform float lod; uniform vec4 crop; uniform vec3 cam; uniform vec2 camD; uniform float t; uniform float k;
  uniform float tilt; uniform float swirl; uniform float fall; uniform float tableY;
  // 球裡的雪花（球內座標）：一層，cs 格子、sz 大小、blur 糊
  float flakes(vec2 q, float cs, float sz, float blur, float seed, float dens, float spin) {
    // 整團雪在水裡轉（剛性旋轉，雪花才不會被拉成線）、同時往下飄
    q = rot2(swirl * spin) * (q - vec2(0.0, fall * (0.8 + 0.2 * spin)));
    vec2 g = q / cs;
    vec2 id = floor(g), f = fract(g);
    vec2 h = hash22(id + seed);
    if (h.x > dens) return 0.0;
    vec2 c = 0.3 + 0.4 * hash22(id + seed + 2.7) + 0.08 * vec2(sin(t * 0.8 + h.y * 6.28), cos(t * 0.6 + h.x * 6.28));
    float d = length((f - c) * cs);
    float r = sz * (0.5 + h.y);
    return (1.0 - smoothstep(r - 0.6 - blur, r + 0.6 + blur, d)) * (0.55 + 0.45 * h.y);
  }
  vec3 room(vec2 p) {
    // 暗暗的房間、遠處失焦的暖光斑
    vec3 col = mix(C_INK, C_INK2, 0.6 + 0.4 * p.y / ${H}.0);
    for (int i = 0; i < 7; i++) {
      float fi = float(i);
      vec2 bp = vec2(hash11(fi * 3.1 + 1.0) * ${W}.0, 120.0 + hash11(fi * 7.7 + 2.0) * 560.0);
      bp.x += 14.0 * sin(t * 0.2 + fi);
      float br = 50.0 + 70.0 * hash11(fi + 9.0);
      float d = length(p - bp);
      float disc = 1.0 - smoothstep(br - 3.0, br + 3.0, d);
      float ring = exp(-pow((d - br + 3.0) / 3.5, 2.0));
      float tw = 0.75 + 0.25 * sin(t * (0.5 + 0.3 * fi) + fi * 2.0);
      col += mix(C_SIGNAL, C_EMBER, hash11(fi + 4.0)) * (0.03 * disc + 0.02 * ring) * tw * (0.5 + hash11(fi + 6.0));
    }
    return col;
  }
  void main() {
    vec2 ps = p5Px();
    vec2 p = cam.yz + (ps - cam.yz - camD) / cam.x;
    // 整顆晃：繞底座底部轉
    vec2 pivot = vec2(gc.x, gc.y + R * 1.25);
    vec2 pl = pivot + rot2(-tilt) * (p - pivot);
    vec3 col = room(p);
    vec3 lamp = mix(C_BONE, C_EMBER, 0.3);
    // 桌面
    if (p.y > tableY) {
      float yy = p.y - tableY;
      col = C_FUR * 0.02 * (0.85 + 0.15 * snoise(vec2(p.x / 260.0, yy / 5.0)));
      // 雪花球在桌上的影子與倒影
      vec2 sq = (p - vec2(gc.x + 40.0, tableY + 30.0)) / vec2(R * 0.95, 40.0);
      col *= 1.0 - 0.6 * exp(-dot(sq, sq));
      col += lamp * 0.012 * exp(-yy / 60.0);
    }
    // 底座：木頭圓柱（上下是橢圓）
    {
      vec2 bq = pl - vec2(gc.x, gc.y + R * 0.86);
      float bw = R * 0.74, bh = R * 0.4;
      float top = bq.y + 0.0, rx = bq.x / bw;
      float inBody = step(abs(rx), 1.0) * step(-sqrt(max(1.0 - rx * rx, 0.0)) * bw * 0.16, bq.y) * step(bq.y, bh + sqrt(max(1.0 - rx * rx, 0.0)) * bw * 0.16);
      float aa = (1.0 - smoothstep(bw - 1.0, bw + 1.0, abs(bq.x)));
      if (inBody * aa > 0.0) {
        float shade = sqrt(max(1.0 - rx * rx, 0.0));
        float wood = 0.8 + 0.2 * snoise(vec2(bq.x / 6.0, bq.y / 90.0));
        vec3 bc = C_FUR * 0.12 * wood * (0.25 + 0.75 * shade) * (0.6 + 0.4 * smoothstep(bh, 0.0, bq.y));
        // 左上那盞燈打在底座左邊的亮面
        bc += lamp * 0.03 * smoothstep(0.2, -0.8, rx) * shade;
        col = mix(col, bc, inBody * aa);
      }
    }
    // 球
    vec2 d = pl - gc;
    float r = length(d) / R;
    if (r < 1.02) {
      // 水球是一顆透鏡：中間放大、靠近玻璃壓扁（看得到更多）
      float m = 0.8 + 0.34 * pow(r, 2.4);
      vec2 iq = d * m;
      // 水的顏色：暗、帶一點燈的暖光
      // 隔著水看到後面的房間（倒過來、放大），再帶一點燈的暖光
      vec3 w = room(gc - d * 1.7) * 0.75 + mix(C_INK2, C_GRAPHITE, 0.12) * 0.45 + lamp * 0.02 * smoothstep(0.9, -0.6, (d.x + d.y) / R);
      // 後面那層雪
      float fb = flakes(iq, 46.0, 2.0, 0.0, 1.0, 0.5, 0.75);
      w = mix(w, C_BONE * 0.55, fb * 0.8);
      // 雪堆（球底）
      float fl = floorY - 18.0 * cos(iq.x / R * 2.6) - 8.0 * snoise(vec2(iq.x / 60.0, 1.0));
      // 相片（白邊＋照片）立在雪堆上
      vec2 q = iq - phC;
      vec2 outer = phH + vec2(border);
      float pd = sdBox(q, outer);
      float pa = 1.0 - smoothstep(-0.9, 0.9, pd / m);
      if (pa > 0.0) {
        vec3 pr = C_BONE * 0.68;
        float di = sdBox(q, phH);
        vec3 ph = p5Photo(photo, p5Crop((q + phH) / (2.0 * phH), crop), lod + max(0.0, log2(m / 0.8)));
        pr = mix(pr, ph, 1.0 - smoothstep(-0.8, 0.8, di / m));
        // 燈從左上照進來：相片左上亮一點點
        pr *= 0.86 + 0.14 * smoothstep(0.8, -0.8, (q.x / outer.x + q.y / outer.y) * 0.5);
        w = mix(w, pr, pa);
      }
      // 雪堆蓋住相片的下緣一點點
      float sn = smoothstep(fl - 1.5, fl + 1.5, iq.y);
      vec3 snowC = C_BONE * (0.4 + 0.05 * snoise(iq / 40.0) + 0.03 * snoise(iq / 9.0)) * (0.55 + 0.45 * smoothstep(fl + 120.0, fl, iq.y));
      w = mix(w, snowC, sn);
      // 前面那層雪：大一點、糊一點
      float ff = flakes(iq + vec2(31.0, 17.0), 92.0, 3.6, 1.6, 7.0, 0.42, 1.0);
      w = mix(w, C_BONE * 0.7, ff * 0.85);
      // 靠近玻璃邊：全反射，暗下來
      w *= 1.0 - 0.75 * smoothstep(0.82, 1.0, r);
      // 玻璃：邊上一圈反光（下緣厚一點）、左上燈的彎彎反光、右下一道細的
      float rim = smoothstep(0.93, 1.0, r) * (1.0 - smoothstep(1.0, 1.02, r));
      w += mix(C_ASH, lamp, 0.4) * 0.16 * rim * (0.6 + 0.4 * smoothstep(-0.3, 1.0, d.y / R));
      // 左上那盞燈：沿著玻璃邊一道彎彎的反光
      float ang = atan(d.y, d.x);
      float arc = exp(-pow((ang + 2.25) / 0.42, 2.0)) * exp(-pow((r - 0.86) / 0.05, 2.0));
      w += lamp * 0.2 * arc;
      float hl2 = exp(-pow((r - 0.9) / 0.025, 2.0)) * smoothstep(0.3, 0.8, (d.x + d.y) / R / 1.414);
      w += lamp * 0.05 * hl2;
      col = mix(col, w, 1.0 - smoothstep(1.0, 1.02, r));
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, pgain: { value: 1 }, gc: { value: new THREE.Vector2() }, R: { value: 430 }, phC: { value: new THREE.Vector2() }, phH: { value: new THREE.Vector2() },
  border: { value: 8 }, floorY: { value: 250 }, lod: { value: 0 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, cam: { value: new THREE.Vector3(1, W / 2, H / 2) }, camD: { value: new THREE.Vector2() },
  t: { value: 0 }, k: { value: 1 }, tilt: { value: 0 }, swirl: { value: 0 }, fall: { value: 0 }, tableY: { value: 960 },
});

/** 說明欄的寬（60 字的留言在 5 行內、字級 ≥ 40）、跟球的間距、球的半徑。 */
const COL_W = 560, GAP = 90, RAD = 430;

export default class Snowdome extends PhotoScene {
  bg = shared('snowdome.bg', BG);
  text: TextBlock | null = null;
  gx = W / 2; gy = 470;
  hwI = 0; hhI = 0; border = 8; floorY = 0;

  override async init() {
    await this.loadPhoto();
    const { w, h } = this.img;
    // 球裡的相片（球內座標）：中間放大約 1.25 倍，放進去不要碰到玻璃
    // 很小的照片：球裡最多 1.2 倍，透鏡再放大 1.25 倍，畫面上還是不超過 1.5 倍
    const sz = containSize(w, h, RAD * 1.22, RAD * 1.02, 1.2);
    this.hwI = sz.w / 2; this.hhI = sz.h / 2;
    this.border = clamp(0.03 * Math.min(sz.w, sz.h), 5, 10);
    this.floorY = RAD * 0.6;
    const groupW = this.hasText ? 2 * RAD + GAP + COL_W : 2 * RAD;
    const x0 = Math.max(120, (W - groupW) / 2 - (this.hasText ? 0 : 20));
    this.gx = x0 + RAD;
    if (this.hasText) {
      const box = { x: x0 + 2 * RAD + GAP, y: 150, w: COL_W, h: 640 };
      this.text = this.track(new TextBlock(this.ctx, box, DARK_TEXT(F.hand(400), {
        lineHeight: 1.42, maxLines: 5, label: { family: F.hand(700), size: 24, color: rgba('ash', 0.9), tracking: 5, rule: rgba('signal', 0.75) },
      }), 'center'));
      const bh = this.text.height;
      this.text.box.y = clamp(this.gy - bh / 2, 150, 790 - bh);
      this.text.box.h = bh + 4;
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const z0 = 1 - Math.exp(-lt / 7);
    const cam: Cam2 = { z: 1 + 0.04 * z0, cx: this.gx, cy: this.gy, dx: 0, dy: 0 };
    // 搖一下：整顆晃（彈簧）、雪捲起來越轉越慢
    const shake = lt < 0 ? 0 : Math.exp(-lt / 0.55) * Math.sin(lt * 11);
    const dir = hash(this.seed, 3) < 0.5 ? -1 : 1;
    let swirl = dir * 3.2 * 1.3 * (1 - Math.exp(-Math.max(0, lt) / 1.3));
    // 每個小節線水裡再輕輕捲一下
    for (const tb of pastBeats(audio, t, 4, true)) {
      const dt = t - tb;
      if (dt < 0 || tb < s + 1.0) continue;
      swirl += dir * 0.35 * (1 - Math.exp(-dt / 0.9));
    }
    const u = this.bg.u;
    u.photo!.value = this.tex;
    u.pgain!.value = this.gain;
    (u.gc!.value as THREE.Vector2).set(this.gx, this.gy);
    u.R!.value = RAD;
    (u.phC!.value as THREE.Vector2).set(0, this.floorY - this.hhI + 10);
    (u.phH!.value as THREE.Vector2).set(this.hwI, this.hhI);
    u.border!.value = this.border;
    u.floorY!.value = this.floorY;
    // 相片上的畫面往焦點推（1.2 倍）；照片在畫面上約放大 1.25 倍（透鏡），很小的照片少推
    const sw = 2 * this.hwI * 1.25 * cam.z;
    const crop = this.crop(settleK(lt), sw, 1.2);
    (u.crop!.value as THREE.Vector4).set(...crop);
    u.lod!.value = this.cropLod(crop, sw);
    (u.cam!.value as THREE.Vector3).set(cam.z, cam.cx, cam.cy);
    (u.camD!.value as THREE.Vector2).set(cam.dx, cam.dy);
    u.t!.value = t;
    u.tilt!.value = dir * 0.05 * shake;
    u.swirl!.value = swirl;
    // 雪慢慢飄落（剛搖的時候被捲起來，先往上一點）
    u.fall!.value = 26 * lt - 60 * (1 - Math.exp(-Math.max(0, lt) / 0.8));
    u.tableY!.value = this.gy + RAD * 1.25;
    u.k!.value = (0.7 + 0.3 * ease.outCubic(prog(t, s, s + 0.5))) * (1 - 0.12 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    if (this.text && this.text.draw(t, prog(t, s + 0.8, s + 0.8 + Math.min(1.6, (e - s) * 0.3)))) {
      const op = prog(t, s + 0.5, s + 1.0, ease.outCubic) * (1 - prog(t, e - 0.3, e));
      this.text.blit(comp, renderer, out, op, cam);
    }
    return { bloom: 0.25, bloomThreshold: 1.05, halation: 0.15, vignette: 0.55 };
  }
}
