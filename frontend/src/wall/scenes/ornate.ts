// 照片版面「古典金框」（暗）：雕花金框掛在深色絲絨布簾前，燭光從左下照過來——
//  - 牆是直的柔和皺褶的絲絨（顏色跟著主題的暗部走：金→褐、玫瑰→酒紅、鼠尾草→深綠），皺褶的斜面有一點絲絨的光澤。
//  - 燭光（固定的暖色，不跟主題變）一直在輕輕閃，光的位置也跟著晃，所以金框上的反光會在雕花上游走；
//    左下角前景有一團很糊的燭火光斑（離鏡頭很近，鏡頭動時比背景動得多）。
//  - 金框用高度剖面打光：外緣珠線、凹槽、一圈沿著四邊重複的葉形浮雕、內緣一圈小珠子，四個角是扇形雕飾；內側一條亞麻襯邊。
//    照片完整放（裱框不裁），很小的舊照片最多放大 1.5 倍。
//    框裡的照片往新人點的焦點（臉）慢慢推近，鏡頭也往那邊靠一點（牌子上的字一直在畫面的安全區裡）。
//  - 主字（賓客留言＋署名，或新人的註解）刻在畫框下方（橫的照片、字很少）或右側（其他）的一塊黃銅小牌上
//    （思源宋體，深色刻字、下緣一道亮邊），歌詞小一號刻在下面跟唱；沒有主字就把歌詞刻在牌上跟唱；
//    兩樣都沒有就只有畫框（移到正中間，鏡頭往臉推得多一點）。
//  - 進場：燭光點起來（帶閃爍的亮度爬升），鏡頭慢慢推近、略往上搖。跟 gallery（黑框白卡紙、聚光燈、牆上說明）是不同的房間。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, prog } from '../engine/util';
import { loadPhotos, fitIn, mipLod, Caption, P2_GLSL, settle, keepIn, v2, v4, type P2Photo, type CapStyle } from './_p2';
import { focusCrop, focusIn, loadWords, settleK } from './_photo';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'frame', energy: [0, 0.7], bars: [2, 8], weight: 1, prefers: ['portrait', 'small'] };

const BG = () => new FSPass(/* glsl */ `
  ${P2_GLSL}
  uniform sampler2D photo; uniform sampler2D cap; uniform vec2 capSize; uniform vec4 crop;
  uniform vec3 cam; uniform vec2 fc; uniform vec2 ih; uniform float slip; uniform float B;
  uniform vec2 pc; uniform vec2 phs; uniform float plaqueOn;
  // 燭光：位置（世界座標，已經含晃動）、亮度（含閃爍）
  uniform vec3 light;
  uniform float lod; uniform float t; uniform float k;
  // 前景燭火光斑：畫面座標、亮度
  uniform vec2 bok; uniform float bokK;

  // 金框的高度剖面（0..1）：q 是相對畫框中心的座標
  float hAt(vec2 q) {
    vec2 rI = ih + vec2(slip);
    vec2 oh = rI + vec2(B);
    vec2 aq = abs(q);
    vec2 e2 = oh - aq;
    float e = min(e2.x, e2.y);
    float u = clamp(e / B, 0.0, 1.0);
    float s = e2.x < e2.y ? q.y : q.x;
    float h;
    if (u < 0.1) h = 0.42 + 0.5 * sin(3.14159 * u / 0.1);
    else if (u < 0.2) h = 0.36 - 0.26 * sin(3.14159 * (u - 0.1) / 0.1);
    else if (u < 0.72) {
      // 月桂葉環：一片片人字形排列的葉子包著一根圓棍，葉子中間一道葉脈
      float v = (u - 0.46) / 0.26;
      float P = B * 0.5;
      float a = fract(s / P + 0.42 * abs(v)) - 0.5;
      float lobe = max(0.0, 1.0 - a * a * 5.0 - v * v * 0.55);
      float vein = (1.0 - smoothstep(0.0, 0.05, abs(a))) * step(abs(v), 0.85);
      float rod = sqrt(max(0.0, 1.0 - v * v));
      h = 0.3 + 0.25 * rod + 0.42 * sqrt(lobe) - 0.12 * vein * lobe;
    } else if (u < 0.8) h = 0.5;
    else if (u < 0.94) {
      // 內緣一圈小珠子
      float P2 = B * 0.16;
      vec2 bq = vec2((fract(s / P2) - 0.5) * P2, (u - 0.87) * B);
      float b = length(bq) / (0.065 * B);
      h = 0.32 + 0.48 * sqrt(max(0.0, 1.0 - b * b));
    } else h = 0.32 * (1.0 - u) / 0.06;
    // 四個角：扇形雕飾（蓋住 45 度接角）
    vec2 cq = aq - (rI + vec2(B * 0.48));
    float r = length(cq), R = B * 0.64;
    if (r < R) {
      float ang = atan(cq.y, cq.x);
      float fan = 0.5 + 0.5 * cos(ang * 11.0);
      float w = 1.0 - smoothstep(R * 0.72, R, r);
      float shell = 0.5 + 0.35 * fan * (r / R) + 0.35 * (1.0 - r / R) * (1.0 - r / R);
      h = mix(h, shell, w);
    }
    return h;
  }
  // 燭光照到某一點的強度（距離衰減）
  float lightAt(vec2 p) { vec2 d = (p - light.xy) / 1050.0; return light.z / (1.0 + dot(d, d) * 2.2); }

  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = cam.xy + (sp - vec2(${W / 2}.0, ${H / 2}.0)) / cam.z;
    float Lp = lightAt(p);
    // ---- 絲絨布簾：直的柔和皺褶；皺褶的斜面有光澤（絲絨在掠角最亮）
    float fx = p.x / 92.0 + 0.8 * sin(p.x / 270.0 + 1.3) + 0.18 * sin(p.y / 340.0 + p.x / 520.0);
    float fold = sin(fx), slope = cos(fx);
    vec3 vel = mix(C_INK, C_BLOOD, 0.3);
    float pile = 0.94 + 0.06 * snoise(p / vec2(1.6, 5.0));
    vec3 col = vel * (0.32 + 0.5 * (0.5 + 0.5 * fold)) * (0.12 + 1.15 * Lp) * pile;
    col += mix(C_BLOOD, C_FUR, 0.3) * 0.07 * pow(abs(slope), 4.0) * Lp * smoothstep(-0.2, 0.6, -slope * sign(p.x - light.x));
    // ---- 畫框與牌子在布簾上的影子（光從左下來，影子往右上）
    vec2 rI = ih + vec2(slip);
    vec2 oh = rI + vec2(B);
    vec2 q = p - fc;
    float ds = sdBox(q - vec2(34.0, -30.0), oh);
    col *= 1.0 - 0.62 * softShadow(ds, 46.0);
    if (plaqueOn > 0.5) {
      float dp = sdBox(p - pc - vec2(12.0, -10.0), phs);
      col *= 1.0 - 0.5 * softShadow(dp, 16.0);
    }
    // ---- 金框
    float dO = sdBox(q, oh);
    vec3 warm = mix(C_FUR, C_BONE, 0.5);
    if (dO < 1.0) {
      float a = 1.0 - smoothstep(-0.8, 0.8, dO);
      float dI = sdBox(q, rI);
      vec3 fr;
      if (dI > -0.5) {
        float h0 = hAt(q);
        float hx = hAt(q + vec2(1.0, 0.0)) - hAt(q - vec2(1.0, 0.0));
        float hy = hAt(q + vec2(0.0, 1.0)) - hAt(q - vec2(0.0, 1.0));
        float amp = B * 0.11;
        vec3 n = normalize(vec3(-hx * amp, -hy * amp, 1.0));
        vec3 Lv = normalize(vec3(light.xy - p, 360.0));
        float dif = max(dot(n, Lv), 0.0);
        vec3 Hh = normalize(Lv + vec3(0.0, 0.0, 1.0));
        float spec = pow(max(dot(n, Hh), 0.0), 48.0);
        // 金：固定的暖色（不跟主題變），凹處是深褐
        vec3 gold = mix(C_FUR, C_BONE, 0.22) * vec3(1.0, 1.24, 1.0);
        vec3 alb = mix(C_FUR * vec3(0.16, 0.2, 0.2), gold, smoothstep(0.1, 0.75, h0));
        fr = alb * (0.05 + 0.95 * dif * Lp) + mix(C_BONE, C_FUR, 0.45) * vec3(1.0, 1.1, 1.0) * spec * Lp * 1.0;
        // 凹的地方（高度低）多一點暗
        fr *= 0.6 + 0.4 * smoothstep(0.0, 0.6, h0);
      } else {
        // 亞麻襯邊：很細的織紋，靠金框那一圈有影子
        float wv = 0.92 + 0.08 * sin(q.x * 2.1) * sin(q.y * 2.1);
        fr = mix(C_BONE, C_FUR, 0.22) * 0.3 * wv * (0.2 + 0.85 * Lp);
        fr *= 1.0 - 0.5 * exp(-(-dI) / 5.0);
        float di = sdBox(q, ih);
        if (di < 1.0) {
          // 框裡的畫面是照片上的 crop 那一塊（往焦點推）
          vec2 uv = mix(crop.xy, crop.zw, (q + ih) / (2.0 * ih));
          vec3 ph = photoLin(photo, uv, lod);
          // 燭光是暖的：照片偏暖一點、遠離燭光的那角暗一點（照片照樣看得清楚）
          float pl = clamp(Lp / max(light.z, 0.001), 0.0, 1.0);
          ph *= mix(vec3(1.0), warm / max(max(warm.r, warm.g), warm.b), 0.22) * (0.74 + 0.26 * pl) * (0.35 + 0.65 * clamp(light.z, 0.0, 1.0));
          // 內緣在照片的左、下兩邊留一道影子（光從左下）
          float dl = q.x + ih.x, db = ih.y - q.y;
          ph *= 1.0 - 0.3 * clamp(exp(-dl / 8.0) + exp(-db / 8.0), 0.0, 1.0);
          fr = mix(fr, ph, 1.0 - smoothstep(-0.7, 0.7, di));
        }
      }
      col = mix(col, fr, a);
    }
    // ---- 黃銅小牌：刻字（深色字、下緣一道亮邊），四角邊是斜面，兩顆螺絲
    if (plaqueOn > 0.5) {
      vec2 pq = p - pc;
      float dp = sdBox(pq, phs);
      if (dp < 1.0) {
        float a = 1.0 - smoothstep(-0.8, 0.8, dp);
        float brush = 1.0 + 0.05 * snoise(vec2(pq.x / 90.0, pq.y * 1.4)) + 0.025 * snoise(vec2(pq.x / 9.0, pq.y * 3.0));
        vec3 brass = mix(C_FUR, C_BONE, 0.25) * vec3(1.0, 1.2, 1.0) * 0.6 * brush;
        // 斜面：左、下兩邊朝光（亮），右、上兩邊背光
        float bev = 1.0 - smoothstep(0.0, 5.0, -dp);
        float side = abs(pq.x) / phs.x > abs(pq.y) / phs.y ? -sign(pq.x) : sign(pq.y);
        vec3 pl = brass * (0.08 + 0.95 * Lp) * (1.0 + 0.35 * bev * side);
        // 內側一圈刻線
        float ln = 1.0 - smoothstep(0.4, 1.3, abs(-dp - 11.0));
        pl *= 1.0 - 0.35 * ln;
        // 刻字：字本身深（圖層的顏色），往下 1.3 px 的地方是刻痕的亮邊
        vec4 tx = layerAt(cap, pq + phs, capSize);
        float hiA = layerAt(cap, pq + phs - vec2(0.0, 1.4), capSize).a;
        pl = pl * (1.0 - tx.a) + tx.rgb * (0.5 + 0.5 * Lp);
        pl += mix(C_BONE, C_FUR, 0.3) * 0.28 * Lp * hiA * (1.0 - tx.a);
        col = mix(col, pl, a);
      }
    }
    // ---- 前景的燭火光斑（離鏡頭很近、很糊），旁邊被它照亮一點
    vec2 bp = sp + (cam.xy - vec2(${W / 2}.0, ${H / 2}.0)) * 0.9 * cam.z;
    float bd = length(bp - bok);
    float disc = 1.0 - smoothstep(118.0, 160.0, bd);
    vec2 cq2 = (bp - bok - vec2(0.0, 18.0)) / vec2(52.0, 74.0);
    float core = exp(-dot(cq2, cq2));
    vec3 flame = mix(C_FUR, C_BONE, 0.3);
    col = col * (1.0 - 0.35 * disc * bokK) + flame * (0.2 * disc + 0.95 * core) * bokK;
    col += flame * 0.05 * bokK * exp(-bd / 260.0);
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, cap: { value: null }, capSize: { value: new THREE.Vector2(1, 1) }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  cam: { value: new THREE.Vector3(W / 2, H / 2, 1) }, fc: { value: new THREE.Vector2() }, ih: { value: new THREE.Vector2() }, slip: { value: 12 }, B: { value: 80 },
  pc: { value: new THREE.Vector2() }, phs: { value: new THREE.Vector2() }, plaqueOn: { value: 0 },
  light: { value: new THREE.Vector3() }, lod: { value: 0 }, t: { value: 0 }, k: { value: 1 },
  bok: { value: new THREE.Vector2() }, bokK: { value: 0 },
});

/** 牌子上字的留白。 */
const PADX = 46, PADY = 34;
/** 牌子跟畫框之間的空隙（下方、右側）。 */
const GAP_B = 44, GAP_R = 64;
/** 牌子下緣（字的最後一行在 HUD 區上面）。 */
const PLAQUE_BOTTOM = 838;

const capStyle = (w: number, h: number, maxLines: number): CapStyle => ({
  family: F.ming(700), w, h, min: 40, max: 48, lineHeight: 1.38, maxLines,
  ink: rgba('ink', 0.9), unsung: rgba('ink', 0.42), active: rgba('blood', 1), sigInk: rgba('ink', 0.82), sigSize: 27,
  lyricSize: 44, lyricSubSize: 38,
  label: { family: F.ming(700), size: 20, color: rgba('ink', 0.62), tracking: 6, gap: 16 },
});
/** 畫框下面那條牌子最多多高（主字兩行，或一行註解＋一行歌詞）：再高照片就太小了，改放右側。 */
const BELOW_H = 120;

export default class Ornate extends Scene {
  bg = shared('ornate.bg', BG);
  seed = Number(this.ctx.params.seed ?? 1);
  ph: P2Photo | null = null;
  cap: Caption | null = null;
  plaque: Layer2D | null = null;
  /** 畫框中心、照片半寬高、襯邊、金框寬；牌子中心、半寬高；構圖中心（鏡頭對著它）。 */
  fx = W / 2; fy = H / 2; hw = 0; hh = 0; slip = 12; B = 80;
  px = 0; py = 0; phw = 0; phh = 0;
  gx = W / 2; gy = H / 2;

  override async init() {
    const ctx = this.ctx;
    await loadText(`${ctx.params.photo?.caption ?? ''}${ctx.params.photo?.album ?? ''}`);
    await loadWords(ctx);
    [this.ph] = await loadPhotos(ctx, (x) => this.track(x), 1);
    const ph = this.ph!;
    const meas = this.track(new Layer2D(8, 8, 1, { fast: true }));
    const landscape = ph.w / ph.h >= 1.25;
    // 橫的照片、字少：牌子在畫框下面（字排寬一點）；字多（留言有署名、主字＋歌詞超過兩行）或直的照片：牌子在右邊
    // 寬度 780：置中在 x = 930，鏡頭推近後右端仍在 HUD 區（x ≥ 1360）左邊
    let cap = new Caption(ctx, meas.ctx, capStyle(780, BELOW_H, 2));
    let below = landscape;
    if (cap.on && (!landscape || cap.text.height > BELOW_H)) {
      // 右側：寬 600，60 字的長留言在 40 px 排得進四行
      cap = new Caption(ctx, meas.ctx, capStyle(600, 430, 4));
      below = false;
    }
    this.cap = cap;
    const pw = cap.on ? Math.max(260, cap.width + 2 * PADX) : 0, phh = cap.on ? cap.height + 2 * PADY + 6 : 0;
    this.phw = pw / 2; this.phh = phh / 2;
    const frameFor = (maxOW: number, maxOH: number) => {
      const pre = fitIn(ph.w, ph.h, maxOW - 160, maxOH - 160);
      this.B = clamp(0.13 * Math.min(pre.w, pre.h), 52, 86);
      this.slip = clamp(0.025 * Math.min(pre.w, pre.h), 9, 14);
      const pad = 2 * (this.B + this.slip);
      const f = fitIn(ph.w, ph.h, maxOW - pad, maxOH - pad);
      this.hw = f.w / 2; this.hh = f.h / 2;
      return { ow: f.w + pad, oh: f.h + pad };
    };
    if (!cap.on) {
      const { oh } = frameFor(1250, 900);
      this.fx = W / 2 - 30; this.fy = 70 + oh / 2 + Math.max(0, (900 - oh) / 2) - 10;
      this.gx = this.fx; this.gy = this.fy;
    } else if (below) {
      const { oh } = frameFor(1250, PLAQUE_BOTTOM - phh - GAP_B - 56);
      const total = oh + GAP_B + phh;
      const top = 56 + (PLAQUE_BOTTOM - 56 - total) / 2;
      this.fx = 930; this.fy = top + oh / 2;
      this.px = this.fx; this.py = top + oh + GAP_B + phh / 2;
      this.gx = this.fx; this.gy = top + total / 2;
    } else {
      // 左右多留一點邊：鏡頭推近時牌子上的字不會被推到離邊 96 px 以內
      const { ow, oh } = frameFor(W - 2 * 150 - GAP_R - pw, 930);
      const groupW = ow + GAP_R + pw;
      const x0 = (W - groupW) / 2;
      this.fx = x0 + ow / 2; this.fy = 540;
      this.px = x0 + ow + GAP_R + pw / 2;
      // 牌子掛在畫框下半部的高度，最後一行在 HUD 區上面
      this.py = Math.min(this.fy + oh * 0.16, PLAQUE_BOTTOM - 22 - phh / 2);
      this.gx = x0 + groupW / 2; this.gy = 540;
    }
    if (cap.on) {
      this.plaque = this.track(new Layer2D(pw, phh, undefined, { fast: true }));
      const tx = cap.st.align === 'center' ? pw / 2 : PADX;
      if (cap.draw(this.plaque, tx, PADY, ctx.start)) this.plaque.upload();
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const lt = t - s;
    const ph = this.ph!;
    const u = this.bg.u;
    const z = settle(lt);
    // 框裡的畫面往焦點推（裱框的照片：1.2 倍；很小的舊照片少推）
    const kf = settleK(lt);
    const crop = focusCrop(ph.ref, ph.w, ph.h, ph.w / ph.h, kf, { zoom: 1.2, screenW: 2 * this.hw * 1.05 });
    v4(u.crop!, crop[0], crop[1], crop[2], crop[3]);
    // 鏡頭：慢慢推近、略往上搖（像搖臂升起來），同時往臉那邊靠；沒有牌子時直接往臉推近。牌子上的字一直在安全區裡
    const side = hash(this.seed, 4) < 0.5 ? 1 : -1;
    const [ix, iy] = focusIn(ph.ref, crop);
    const faceX = this.fx + (2 * ix - 1) * this.hw, faceY = this.fy + (2 * iy - 1) * this.hh;
    const pull = this.plaque ? 0.3 : 0.55;
    let cam = {
      x: this.gx + side * 18 * (1 - z) + (faceX - this.gx) * pull * kf,
      y: this.gy + 30 - 38 * z + (faceY - this.gy) * pull * kf,
      z: 1 + 0.05 * z + (this.plaque ? 0.02 : 0.1) * kf,
    };
    if (this.plaque) cam = keepIn(cam, [[this.px - this.phw + 20, this.py - this.phh + 16, this.px + this.phw - 20, this.py + this.phh - 12]]);
    (u.cam!.value as THREE.Vector3).set(cam.x, cam.y, cam.z);
    v2(u.fc!, this.fx, this.fy);
    v2(u.ih!, this.hw, this.hh);
    u.slip!.value = this.slip;
    u.B!.value = this.B;
    u.photo!.value = ph.tex;
    u.lod!.value = mipLod(ph.w * (crop[2] - crop[0]), 2 * this.hw * cam.z);
    u.t!.value = t;
    // 燭光：點起來（0.6 秒內帶閃爍爬升），之後一直輕輕閃；光的位置也晃，金框上的反光跟著游走
    const ign = ease.outCubic(prog(t, s + 0.05, s + 0.65));
    const flick = 0.9 + 0.05 * Math.sin(t * 9.1) + 0.035 * Math.sin(t * 15.7 + 1.3) + 0.025 * Math.sin(t * 23.3 + 0.4)
      + 0.12 * (1 - ign) * Math.sin(t * 41.0);
    const lx = this.fx - (this.hw + this.slip + this.B) - 230 + 16 * Math.sin(t * 5.3) + 9 * Math.sin(t * 11.7 + 2);
    const ly = this.fy + (this.hh + this.slip + this.B) + 120 + 10 * Math.sin(t * 6.1 + 1) + 6 * Math.sin(t * 13.9);
    (u.light!.value as THREE.Vector3).set(lx, ly, (0.12 + 0.95 * ign) * flick);
    // 前景燭火：畫面左下角，一部分在畫面外
    v2(u.bok!, 92, 1012);
    u.bokK!.value = ign * flick;
    u.k!.value = 1 - 0.12 * prog(t, e - 0.3, e);
    if (this.plaque && this.cap) {
      const L = this.plaque;
      const tx = this.cap.st.align === 'center' ? L.w / 2 : PADX;
      if (this.cap.draw(L, tx, PADY, t)) L.upload();
      u.cap!.value = L.texture;
      v2(u.capSize!, L.w, L.h);
      v2(u.pc!, this.px, this.py);
      v2(u.phs!, this.phw, this.phh);
      u.plaqueOn!.value = 1;
    } else {
      // 共用的 pass 可能還指著上一個窗格（已經釋放）的圖層：清掉
      u.cap!.value = null;
      u.plaqueOn!.value = 0;
    }
    this.bg.render(renderer, out);
    return { bloom: 0.22, bloomThreshold: 1.05, halation: 0.14, vignette: 0.5 };
  }
}
