// 照片版面「星空浮現」（暗）：夜空裡的星星飄過來，先排成照片的外框，再一顆一顆填滿成照片的樣子（像點描），
// 最後真的照片從星點裡淡進來，星點散去，只剩外框一圈細細的星在閃。
//  - 照片完整呈現，很小的舊照片最多放大 1.5 倍；星點的顏色取自照片本身（照片縮成一格一格取色），
//    所以星星排好時就看得出是哪張照片。照片取樣壓在 0.84 以下，星星會發光、照片不會。
//    照片浮現之後，框裡的畫面慢慢往焦點（新人點的臉）推（星星聚的時候是整張，星點的顏色才對得上）。
//  - 天空：由上往下從底色到一點點暖的夜色、很淡的銀河、會閃的小星星；每一拍有幾顆星亮一下，
//    每兩個小節一顆流星劃過天空上方。
//  - 字寫在照片右邊的夜空（思源宋體）：主字（賓客留言＋署名，或新人的註解）照片浮現之後一個字一個字亮起來，
//    歌詞小一號在下面跟唱；沒有主字時歌詞自己當主字；都沒有就只有照片（移到正中間）。相簿的第一張在說明上面多一行小小的相簿名。
//    字後面的星星淡掉（小星星落在筆畫之間會讓字看起來髒）。
//  - 窗格很短時整段縮短（星星聚得快一點），照片至少完整停留最後一秒。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F } from '../engine/type';
import { LIN } from '../engine/palette';
import { clamp, ease, hash, mulberry32, prog } from '../engine/util';
import { settleK } from './_photo';
import { PhotoScene, TextBlock, DARK_TEXT, containSize, pastBeats, P5_GLSL, type Cam2 } from './_p5';

export const spec: PlateSpecDecl = { photo: true, prefers: ['landscape', 'square'], family: 'photo', series: 'light', energy: [0, 0.8], bars: [3, 8], weight: 1 };

const BG = () => new FSPass(/* glsl */ `
  ${P5_GLSL}
  uniform sampler2D photo;
  uniform vec2 center; uniform vec2 halfSize; uniform float lod; uniform float reveal; uniform vec4 crop;
  // 字的範圍（世界座標 x0, y0, x1, y1）：字後面的星星淡掉
  uniform float shade; uniform vec4 shadeR;
  uniform float t; uniform float k; uniform float beatI; uniform float beatK; uniform vec3 cam;
  float stars(vec2 p, float cs, float dens, float seed) {
    vec2 q = p / cs;
    vec2 id = floor(q), f = fract(q);
    vec2 h = hash22(id + seed);
    if (h.x > dens) return 0.0;
    vec2 pos = 0.15 + 0.7 * hash22(id + seed + 7.7);
    float d = length((f - pos) * cs);
    float b = pow(hash12(id + seed + 3.3), 3.0);
    float tw = 0.65 + 0.35 * sin(t * (1.3 + 2.0 * h.y) + h.x * 60.0);
    // 每一拍有幾顆亮一下
    float pick = step(0.86, hash12(id + vec2(beatI, seed)));
    tw += pick * beatK * 1.4;
    float r = 0.7 + 1.1 * b;
    return exp(-d * d / (r * r)) * (0.25 + 1.4 * b) * tw;
  }
  void main() {
    vec2 ps = p5Px();
    // 鏡頭慢慢推近（遠的天空推得少一點）
    vec2 p = cam.yz + (ps - cam.yz) / cam.x;
    // 夜空：上面是底色，往下一點點暖的夜色
    float y = p.y / ${H}.0;
    vec3 col = mix(C_INK * 0.6, mix(C_INK2, C_BLOOD, 0.1) * 1.2, smoothstep(0.1, 1.0, y));
    // 很淡的銀河（斜斜一條）
    vec2 mq = rot2(-0.42) * (p - vec2(${W / 2}.0, ${H / 2}.0));
    float band = exp(-pow(mq.y / 230.0, 2.0)) * (0.5 + 0.5 * fbm(mq / 260.0 + vec2(t * 0.004, 0.0), 4));
    col += mix(C_ASH, C_SIGNAL, 0.15) * 0.022 * band;
    // 小星星（兩層：密而暗、疏而亮）
    vec2 pf = cam.yz + (ps - cam.yz) / (1.0 + (cam.x - 1.0) * 0.4);
    float st = stars(pf, 22.0, 0.32, 0.0) * 0.55 + stars(pf, 61.0, 0.42, 19.0);
    st *= 0.6 + 0.6 * band;
    vec2 tc = (shadeR.xy + shadeR.zw) * 0.5, ths = (shadeR.zw - shadeR.xy) * 0.5;
    st *= 1.0 - shade * exp(-max(sdBox(p - tc, ths) + 10.0, 0.0) / 60.0);
    vec3 starCol = mix(C_BONE, C_SIGNAL, 0.25);
    // 照片：從星點裡淡進來（像星星化成照片：用雜訊門檻一塊一塊浮現）
    vec2 q = p - center;
    float d = sdBox(q, halfSize);
    float inside = 1.0 - smoothstep(-0.75, 0.75, d);
    // 照片周圍的天空壓暗一點（星星不要跟照片搶）
    col *= 1.0 - 0.35 * reveal * exp(-max(d, 0.0) / 120.0);
    col += starCol * st * (1.0 - inside * reveal);
    if (inside > 0.0 && reveal > 0.0) {
      vec3 ph = p5Photo(photo, p5Crop((q + halfSize) / (2.0 * halfSize), crop), lod);
      // 細細的雜訊門檻：像星點一顆一顆化成照片（不要一大塊一大塊的洞）
      float nz = hash12(floor(p / 3.0)) * 0.5 + (fbm(p / 140.0, 2) * 0.5 + 0.5) * 0.5;
      float m = smoothstep(nz - 0.3, nz + 0.3, reveal * 1.6 - 0.3);
      col = mix(col, ph, inside * m);
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, pgain: { value: 1 }, center: { value: new THREE.Vector2() }, halfSize: { value: new THREE.Vector2() }, lod: { value: 0 }, reveal: { value: 0 },
  t: { value: 0 }, k: { value: 1 }, beatI: { value: 0 }, beatK: { value: 0 }, cam: { value: new THREE.Vector3(1, W / 2, H / 2) },
  crop: { value: new THREE.Vector4(0, 0, 1, 1) }, shade: { value: 0 }, shadeR: { value: new THREE.Vector4() },
});

/** 說明欄的寬（60 字的留言在 5 行內、字級 ≥ 40）、跟照片的間距。 */
const COL_W = 580, GAP = 100;

interface Star { x0: number; y0: number; x1: number; y1: number; cx: number; cy: number; r: number; g: number; b: number; lum: number; delay: number; w: number; tw: number; edge: boolean }

export default class Starfield extends PhotoScene {
  bg = shared('starfield.bg', BG);
  dots = this.track(new LineBatch(4200, { blend: 'add' }));
  text: TextBlock | null = null;
  cx = W / 2; cy = H / 2; hw = 0; hh = 0;
  stars: Star[] = [];
  /** 星星聚成照片要多久、照片浮現的時間。 */
  t0 = 0; G = 2; r0 = 0; r1 = 0;

  override async init() {
    await this.loadPhoto();
    const { w, h } = this.img;
    const { start, end } = this.ctx;
    const sz = containSize(w, h, this.hasText ? 860 : 1080, 720);
    this.hw = sz.w / 2; this.hh = sz.h / 2;
    const groupW = this.hasText ? sz.w + GAP + COL_W : sz.w;
    const x0 = Math.max(140, (W - groupW) / 2 - (this.hasText ? 0 : 30));
    this.cx = x0 + sz.w / 2;
    this.cy = H / 2 - 36;
    // 時間：窗格越短聚得越快；照片至少完整停留最後一秒
    const len = end - start;
    this.t0 = start + 0.12;
    this.G = clamp(len * 0.4, 1.0, 2.6);
    this.r0 = this.t0 + this.G * 0.9;
    this.r1 = Math.min(this.r0 + 1.0, end - 1.0);
    if (this.r1 < this.r0 + 0.3) this.r1 = this.r0 + 0.3;
    this.buildStars(sz.w, sz.h);
    if (this.hasText) {
      const box = { x: x0 + sz.w + GAP, y: 150, w: COL_W, h: 640 };
      this.text = this.track(new TextBlock(this.ctx, box, DARK_TEXT(F.ming(500), { lineHeight: 1.45, maxLines: 5 }), 'center'));
      const bh = this.text.height;
      this.text.box.y = clamp(this.cy - bh / 2, 150, 790 - bh);
      this.text.box.h = bh + 4;
    }
  }

  /** 照片縮成一格一格取色：每一格一顆星（目的地是那一格的中心）；外框再排一圈。 */
  private buildStars(pw: number, ph: number) {
    const rnd = mulberry32(this.seed * 977 + 13);
    const cell = Math.max(11, Math.sqrt((pw * ph) / 2300));
    const cols = Math.max(8, Math.round(pw / cell)), rows = Math.max(8, Math.round(ph / cell));
    const cv = document.createElement('canvas');
    cv.width = cols; cv.height = rows;
    const g = cv.getContext('2d', { willReadFrequently: true })!;
    g.imageSmoothingQuality = 'medium';
    g.drawImage(this.img.image as CanvasImageSource, 0, 0, cols, rows);
    const data = g.getImageData(0, 0, cols, rows).data;
    cv.width = cv.height = 0;
    const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const cw = pw / cols, ch = ph / rows;
    const fx = this.cx - this.hw + this.photo.fx * pw, fy = this.cy - this.hh + this.photo.fy * ph;
    const maxD = Math.hypot(pw, ph);
    const start = (x1: number, y1: number) => {
      // 從天空裡隨便一個地方飄過來（不要太靠近目的地，才看得出聚過來）
      let x = 0, y = 0;
      for (let k = 0; k < 4; k++) { x = 60 + rnd() * (W - 120); y = 40 + rnd() * (H - 80); if (Math.hypot(x - x1, y - y1) > 300) break; }
      return [x, y];
    };
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const o = (j * cols + i) * 4;
      const r = lin(data[o]!) * 0.84, gg = lin(data[o + 1]!) * 0.84, b = lin(data[o + 2]!) * 0.84;
      // 目的地不是整齊的格子（不要像 LED 看板）：每顆在自己那一格裡亂一點
      const x1 = this.cx - this.hw + (i + 0.5) * cw + (rnd() - 0.5) * cw * 0.8;
      const y1 = this.cy - this.hh + (j + 0.5) * ch + (rnd() - 0.5) * ch * 0.8;
      const [x0, y0] = start(x1, y1);
      // 由焦點往外填（焦點那一塊最先成形）
      const dd = Math.hypot(x1 - fx, y1 - fy) / maxD;
      const [mx, my] = this.swirl(x0!, y0!, x1, y1, rnd());
      this.stars.push({ x0: x0!, y0: y0!, x1, y1, cx: mx, cy: my, r, g: gg, b, lum: 0.2126 * r + 0.7152 * gg + 0.0722 * b,
        delay: 0.2 + 0.6 * dd + 0.2 * rnd(), w: Math.min(cw, ch) * (0.26 + 0.22 * rnd()), tw: rnd() * 6.28, edge: false });
    }
    // 外框：一圈細細的星（間距、大小不一），最先到
    const per = 2 * (pw + ph), n = Math.round(per / 24);
    for (let k = 0; k < n; k++) {
      let d = (k + 0.5 + (rnd() - 0.5) * 0.7) * (per / n);
      let x1: number, y1: number;
      const L = this.cx - this.hw - 6, T = this.cy - this.hh - 6, R = this.cx + this.hw + 6, B = this.cy + this.hh + 6;
      if (d < pw) { x1 = L + d * (R - L) / pw; y1 = T; } else if ((d -= pw) < ph) { x1 = R; y1 = T + d * (B - T) / ph; }
      else if ((d -= ph) < pw) { x1 = R - d * (R - L) / pw; y1 = B; } else { d -= pw; x1 = L; y1 = B - d * (B - T) / ph; }
      const [x0, y0] = start(x1, y1);
      const [mx, my] = this.swirl(x0!, y0!, x1, y1, rnd());
      const big = rnd();
      this.stars.push({ x0: x0!, y0: y0!, x1, y1, cx: mx, cy: my, r: 1, g: 1, b: 1, lum: big, delay: 0.25 * rnd(), w: 1.6 + 2.2 * big * big, tw: rnd() * 6.28, edge: true });
    }
  }

  /** 曲線的控制點：每顆星都往同一個方向彎（整群像漩渦一樣捲進來，不是亂飛）。 */
  private swirl(x0: number, y0: number, x1: number, y1: number, r: number): [number, number] {
    const a = (hash(this.seed, 21) < 0.5 ? 1 : -1) * (0.75 + 0.35 * r);
    const dx = (x0 - x1) * 0.6, dy = (y0 - y1) * 0.6;
    return [x1 + dx * Math.cos(a) - dy * Math.sin(a), y1 + dx * Math.sin(a) + dy * Math.cos(a)];
  }

  /** 每兩個小節一顆流星劃過天空上方。 */
  private meteor(t: number) {
    const au = this.ctx.audio;
    for (const tb of pastBeats(au, t, 2, true)) {
      const bi = Math.round(au.barAt(tb));
      if (bi % 2 !== 0 || tb < this.ctx.start + 0.2) continue;
      const age = t - tb;
      if (age < 0 || age > 0.9) continue;
      // 只在照片上面的那一條天空裡劃過（不經過照片、說明）
      const top = this.cy - this.hh;
      if (top < 190) continue;
      const hx = hash(bi, 3), hy = hash(bi, 5);
      const ax = 220 + hx * 900, ay = 60 + hy * Math.max(10, top - 170);
      const len = 380, ang = 0.1 + 0.1 * hash(bi, 7);
      const k = ease.outCubic(age / 0.9);
      const head = { x: ax + Math.cos(ang) * len * k * 1.6, y: ay + Math.sin(ang) * len * k * 1.6 };
      const fade = 1 - prog(age, 0.5, 0.9);
      const sig = LIN.ember;
      for (let i = 0; i < 14; i++) {
        const a = i / 14, b = (i + 1) / 14;
        const tl = Math.min(len * k, 260);
        const p0 = { x: head.x - Math.cos(ang) * tl * a, y: head.y - Math.sin(ang) * tl * a };
        const p1 = { x: head.x - Math.cos(ang) * tl * b, y: head.y - Math.sin(ang) * tl * b };
        const it = (1 - a) * (1 - a) * 2.4 * fade;
        this.dots.seg(p0.x, p0.y, 0, p1.x, p1.y, 0, 2.2 * (1 - a) + 0.6, sig[0] * it, sig[1] * it, sig[2] * it, 1);
      }
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const reveal = ease.inOutQuad(prog(t, this.r0, this.r1));
    // 鏡頭：星星聚好之後很慢地往照片推近（最多 4%）
    const zk = 1 - Math.exp(-Math.max(0, t - this.r0) / 8);
    const cam: Cam2 = { z: 1 + 0.04 * zk, cx: this.text ? (this.cx + this.text.box.x + COL_W / 2) / 2 : this.cx, cy: this.cy, dx: 0, dy: 0 };
    const X = (x: number) => cam.cx + (x - cam.cx) * cam.z, Y = (y: number) => cam.cy + (y - cam.cy) * cam.z;
    const u = this.bg.u;
    (u.cam!.value as THREE.Vector3).set(cam.z, cam.cx, cam.cy);
    u.photo!.value = this.tex;
    u.pgain!.value = this.gain;
    (u.center!.value as THREE.Vector2).set(this.cx, this.cy);
    (u.halfSize!.value as THREE.Vector2).set(this.hw, this.hh);
    // 照片浮現之後框裡的畫面往焦點推（1.2 倍）；很小的照片少推
    const sw = 2 * this.hw * cam.z;
    const crop = this.crop(settleK(t - this.r0), sw, 1.2);
    (u.crop!.value as THREE.Vector4).set(...crop);
    u.lod!.value = this.cropLod(crop, sw);
    u.shade!.value = this.text ? 0.9 : 0;
    if (this.text) (u.shadeR!.value as THREE.Vector4).set(...this.text.area());
    u.reveal!.value = reveal;
    u.t!.value = t;
    const bi = Math.floor(audio.beatAt(t) + 1e-6);
    u.beatI!.value = bi;
    u.beatK!.value = Math.exp(-(t - audio.timeOfBeat(bi)) / 0.18);
    u.k!.value = (0.6 + 0.4 * ease.outCubic(prog(t, s, s + 0.5))) * (1 - 0.12 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    // 星點：飄過來、排好、照片浮現後散去（外框留著閃）
    const lb = this.dots;
    lb.clear();
    const sg = LIN.signal, bo = LIN.bone;
    const fly = this.G * 0.5;
    for (const st of this.stars) {
      const dep = this.t0 + st.delay * this.G * 0.42;
      const k = ease.inOutCubic(prog(t, dep, dep + fly));
      const at = (kk: number) => {
        const a = 1 - kk;
        return [a * a * st.x0 + 2 * a * kk * st.cx + kk * kk * st.x1, a * a * st.y0 + 2 * a * kk * st.cy + kk * kk * st.y1];
      };
      const [x0, y0] = at(k);
      const x = X(x0!), y = Y(y0!);
      const twk = 0.75 + 0.25 * Math.sin(t * 2.2 + st.tw);
      let it: number, wdt: number, cr: number, cg: number, cb: number;
      if (st.edge) {
        // 外框的星：紙白帶一點訊號色，排好之後一直閃
        // 照片浮現之後外框只留比較亮的那些在閃
        it = (0.5 + 0.7 * k) * twk * (1 - reveal * (0.85 - 0.6 * st.lum));
        wdt = st.w;
        cr = (bo[0] * 0.7 + sg[0] * 0.3) * 1.6; cg = (bo[1] * 0.7 + sg[1] * 0.3) * 1.6; cb = (bo[2] * 0.7 + sg[2] * 0.3) * 1.6;
      } else {
        // 填色的星：飄的時候是小小的白星，越靠近目的地越像照片那一格的顏色、越大
        const fade = 1 - reveal;
        if (fade <= 0.001) continue;
        const col = 0.35 + 0.65 * k;
        it = (0.55 + 0.6 * k) * twk * fade;
        wdt = 1.6 + (st.w - 1.6) * k * k;
        const mixc = (c: number, base: number) => base * (1 - col) + c * col * 1.5;
        cr = mixc(st.r, bo[0] * 0.8); cg = mixc(st.g, bo[1] * 0.8); cb = mixc(st.b, bo[2] * 0.8);
      }
      // 剛到的那一下亮一點
      const land = st.edge ? 0 : Math.exp(-Math.max(0, t - (dep + fly)) / 0.15) * (k >= 1 ? 1 : 0);
      it *= 1 + 1.2 * land;
      if (k > 0 && k < 1) {
        // 飛行中拖一小段尾巴（照速度，最長十幾 px）
        const [px0, py0] = at(Math.max(0, k - 0.012));
        const px = X(px0!), py = Y(py0!);
        const dx = x - px, dy = y - py, dl = Math.hypot(dx, dy);
        const tl = Math.min(14, dl * 1.2);
        const ux = dl > 1e-3 ? dx / dl : 0, uy = dl > 1e-3 ? dy / dl : 0;
        lb.seg(x - ux * tl, y - uy * tl, 0, x, y, 0, 1.1, cr * it * 0.35, cg * it * 0.35, cb * it * 0.35, 1);
      }
      lb.seg(x, y, 0, x + 0.01, y, 0, wdt * cam.z, cr * it, cg * it, cb * it, 1);
    }
    this.meteor(t);
    lb.render(renderer, out);
    if (this.text && this.text.draw(t, prog(t, this.r0, this.r0 + Math.min(1.8, Math.max(0.6, e - this.r0 - 1.2))))) {
      // 主字等照片浮現才一個字一個字亮起來（chars 從 0 開始），歌詞一開始就要跟唱：整層早一點亮起來
      const op = prog(t, s + 0.3, s + 0.8, ease.outCubic) * (1 - prog(t, e - 0.3, e));
      this.text.blit(comp, renderer, out, op, cam);
    }
    return { bloom: 0.35, bloomThreshold: 1.0, halation: 0.18, vignette: 0.45 };
  }
}
