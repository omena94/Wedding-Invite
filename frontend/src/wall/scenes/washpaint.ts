// 照片版面「水彩暈染」（亮）：冷壓水彩紙上，照片像一幅正在暈開的水彩——
//  - 一開始紙上只有鉛筆輕輕打的框線。第一滴水落在照片的焦點，接著每一拍再落一滴，顏料在濕紙上一圈一圈擴開
//    （邊緣是不規則的、有積色的深邊、紙的凹處沉著顏料、還沒乾的地方稍微暈糊），幾滴連成一片，蓋滿整張照片。
//  - 蓋滿之後顏料「乾」了：暈糊與顆粒退掉，變回清楚完整的照片，只留紙的紋理與外圈不規則的水彩邊（邊在照片外面，照片不被裁）。
//    窗格短（3 秒）時一秒多就蓋滿；長窗格最多三秒半，之後整段都是完整的照片。
//  - 焦點：第一滴落在焦點、從那裡暈開；畫裡的畫面慢慢往焦點推（推到 1.15 倍），鏡頭也往焦點推近一點（字一直在安全區裡）。
//  - 紙上還有幾圈很淡的水漬。很小的照片最多放大 1.5 倍。
//  - 字用水彩筆寫在左邊（顏料色、筆畫邊緣積色）：主字（賓客留言＋署名，或新人的註解）一個字一個字寫出來，
//    歌詞小一號在下面跟唱；沒有主字時歌詞自己寫在同一個位置跟唱；兩個都沒有就只有照片（在畫面正中間、大一點）。
//    相簿的第一張在字上面多一行小小的相簿名。
// 畫法：一個全螢幕 shader：每一滴是一個「中心＋半徑隨時間長大」的圓，距離加上低頻雜訊變成不規則的暈染；
// 照片在邊界外用夾住的邊緣顏色往外延伸、淡出成水彩邊。字層在 shader 裡取樣，用周圍幾點的平均算出筆畫邊緣的積色。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, W, H } from '../engine/gl';
import { F } from '../engine/type';
import { mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, mulberry32, prog } from '../engine/util';
import { beatAfter } from './_motifs';
import { Caption, P6_GLSL, P6_POST, P6_UNIFORMS, fitPhoto, focusAmp, focusAt, focusCam, loadPhoto, p6Crop, pace, photoLod, setP6Photo, type FocusCamOpts } from './_p6';
import { focusCrop, settleK } from './_photo';
import type { PhotoImage } from '../photos';

// 縮圖拍在水彩暈到七成（看得到不規則的暈染邊）
export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'craft', paper: true, prefers: ['small', 'square'], energy: [0, 0.75], bars: [2, 8], weight: 1, thumbAt: 0.061 };

/** 幾滴水（uniform 陣列大小）。 */
const ND = 5;

const BG = () => new FSPass(/* glsl */ `
  ${P6_GLSL}
  uniform sampler2D photo; uniform sampler2D tl;
  uniform vec3 cam;
  uniform vec4 rect;            // 照片 x0, y0, x1, y1
  uniform vec4 drops[${ND}];     // 每一滴：x, y, 現在的半徑, 濕的程度（剛擴開時 1，乾了 0）
  uniform float dry; uniform float lod; uniform float sketchK;
  uniform vec4 tlR; uniform float textK; uniform float t; uniform float k;
  float tooth(vec2 p) { return fbm(p / 7.0, 2) * 0.6 + snoise(p / 2.3) * 0.4; }
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = cam.xy + (sp - vec2(${W / 2}.0, ${H / 2}.0)) / cam.z;
    // ---- 冷壓水彩紙：大斑駁＋紙齒
    float th = tooth(p);
    vec3 paper = C_BONE * 0.95 * (0.965 + 0.03 * fbm(p / 420.0, 3)) * (1.0 - 0.03 * th);
    // 幾圈很淡的水漬
    for (int i = 0; i < 3; i++) {
      vec2 c = vec2(hash11(float(i) * 7.1 + 1.0), hash11(float(i) * 3.3 + 5.0)) * vec2(${W}.0, ${H}.0);
      float r = 50.0 + 70.0 * hash11(float(i) + 9.0);
      float d = length(p - c) - r * (1.0 + 0.08 * snoise((p - c) / 40.0));
      paper *= 1.0 - 0.035 * exp(-d * d / 6.0) - 0.012 * step(d, 0.0);
    }
    vec3 col = paper;
    vec2 rc = 0.5 * (rect.xy + rect.zw), hs = 0.5 * (rect.zw - rect.xy);
    float dR = sdBox(p - rc, hs);
    // ---- 鉛筆框線（畫之前打的稿，顏料蓋過去就看不到）
    float pencil = (1.0 - smoothstep(0.4, 1.3, abs(dR))) * (0.6 + 0.4 * snoise(p / 9.0));
    vec2 ext = abs(p - rc) - hs;
    pencil *= step(max(ext.x, ext.y), 26.0);
    // ---- 暈染：每一滴一個不規則的圓（距離加上低頻雜訊），連成一片
    float warp = 70.0 * fbm(p / 160.0, 3);
    float m = 0.0, wetF = 0.0, ring = 0.0;
    for (int i = 0; i < ${ND}; i++) {
      vec4 d = drops[i];
      if (d.z <= 0.0) continue;
      float dd = length(p - d.xy) + warp * (0.6 + 0.4 * hash11(float(i)));
      float mi = smoothstep(d.z, d.z - 26.0, dd);
      wetF = max(wetF, mi * d.w);
      m = max(m, mi);
    }
    // 還濕的時候，整片濕的區域最外緣積色（一圈深一點；滴與滴重疊的地方不會有線）
    ring = 4.0 * m * (1.0 - m) * wetF / max(m, 0.05);
    // 照片外圈：不規則的水彩邊（離照片 20～70 px），越外面越淡
    float lim = 44.0 + 30.0 * fbm(p / 70.0 + 3.0, 2);
    float outA = 1.0 - smoothstep(lim - 14.0, lim, dR);
    float fade = 1.0 - 0.55 * smoothstep(0.0, lim, dR);
    float a = m * outA * fade;
    // 顏料：照片（邊界外用最近的邊緣顏色往外延伸），濕的地方暈糊、顆粒沉在紙齒裡
    vec2 uv = (p - rect.xy) / (rect.zw - rect.xy);
    float blur = mix(0.0, 2.2, wetF) + 1.2 * smoothstep(0.0, 30.0, dR);
    vec3 ph = p6Photo(photo, uv, lod + blur);
    vec3 pig = ph * (1.0 - (0.1 * (1.0 - dry) + 0.025) * th);
    // 濕的時候顏色比較淡、比較平（水多）
    pig = mix(pig, mix(pig, vec3(luma(pig)), 0.15) * 1.08, (1.0 - dry) * 0.5);
    pig *= 1.0 - 0.22 * ring;
    // 外圈水彩邊的積色
    float rim = exp(-pow((dR - lim + 8.0) / 6.0, 2.0)) * step(0.0, dR) * m;
    pig *= 1.0 - 0.16 * rim;
    col = mix(col, pig, a);
    col = mix(col, col * (1.0 - 0.28 * sketchK), pencil * (1.0 - a) * sketchK);
    // ---- 字：水彩筆寫的（邊緣積色：比周圍平均深的地方是筆畫的邊）
    vec2 q = p - tlR.xy;
    vec4 tx = p6Layer(tl, q, tlR.zw) * textK;
    if (tx.a > 0.0) {
      float av = 0.0;
      for (int i = 0; i < 4; i++) { vec2 o = vec2(cos(float(i) * 1.5708 + 0.4), sin(float(i) * 1.5708 + 0.4)) * 2.5; av += p6Layer(tl, q + o, tlR.zw).a; }
      av = av * 0.25 * textK;
      float edge = clamp(tx.a - av, 0.0, 1.0);
      vec3 ink = tx.rgb / tx.a;
      ink *= (0.92 + 0.08 * th) * (1.0 - 0.5 * edge);
      col = mix(col, ink * (paper / C_BONE / 0.95), tx.a * 0.95);
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  ...P6_UNIFORMS(),
  photo: { value: null }, tl: { value: null }, cam: { value: new THREE.Vector3(W / 2, H / 2, 1) },
  rect: { value: new THREE.Vector4(0, 0, 1, 1) }, drops: { value: Array.from({ length: ND }, () => new THREE.Vector4()) },
  dry: { value: 0 }, lod: { value: 0 }, sketchK: { value: 1 },
  tlR: { value: new THREE.Vector4(0, 0, 1, 1) }, textK: { value: 0 }, t: { value: 0 }, k: { value: 1 },
});

interface Drop { x: number; y: number; t0: number; t1: number; r: number }

/** 畫裡的畫面往焦點推到幾倍；鏡頭再推近 4%、焦點往畫面中間移兩成。 */
const PUSH = 1.15;
const FOCUS: FocusCamOpts = { zoom: 1.04, pull: 0.2 };

export default class WashPaint extends Scene {
  bg = shared('washpaint.bg', BG);
  // 字：左邊寬 500、最多六行（60 字的留言＋署名＋歌詞也放得下），整塊最高 700
  cap = this.track(new Caption(500, 700, {
    family: F.hand(700), align: 'left', lineHeight: 1.36, maxLines: 6,
    ink: mixRgba('blood', 'sepia', 0.4, 0.92), active: mixRgba('signal', 'blood', 0.35), unsung: mixRgba('blood', 'sepia', 0.4, 0.25),
    labelFamily: F.hand(700), label: mixRgba('blood', 'sepia', 0.3, 0.6),
  }));
  seed = Number(this.ctx.params.seed ?? 1);
  tex: THREE.Texture | null = null;
  img: PhotoImage | null = null;
  rect: [number, number, number, number] = [0, 0, 1, 1];
  drops: Drop[] = [];
  tFull = 0; tlX = 0; tlY = 0; kp = 1;
  /** 焦點（畫裡的畫面推到底時在世界座標的位置）與鏡頭往那裡推的幅度（字不能被推出安全區）。 */
  foc: [number, number] = [W / 2, H / 2];
  amp = 1;

  override async init() {
    const { ph, img, tex } = await loadPhoto(this.ctx, (x) => this.track(x));
    this.img = img; this.tex = tex;
    const { start, end, audio } = this.ctx;
    const cap = this.cap;
    cap.setup(this.ctx, ph);
    const { w, h } = img;
    const D = end - start;
    // 照片：有字時在右邊（字在左邊），沒有字時在正中間
    const s = fitPhoto(w, h, cap.has ? 1060 : 1460, cap.has ? 840 : 860);
    const pw = w * s, phh = h * s;
    const cx = cap.has ? 1235 : W / 2, cy = cap.has ? 515 : 525;
    this.rect = [cx - pw / 2, cy - phh / 2, cx + pw / 2, cy + phh / 2];
    // 字在左邊（x < 640，不會碰到右下角 HUD）：跟照片的中間對齊，最後一行最低到 950
    if (cap.has) { this.tlX = 140; this.tlY = clamp(cy - cap.blockH / 2, 130, 950 - cap.blockH); }
    this.foc = focusAt(ph, focusCrop(ph, w, h, w / h, 1, { zoom: PUSH, screenW: pw }), this.rect);
    this.amp = cap.has ? focusAmp(this.foc, FOCUS, [[this.tlX - 8, this.tlY - 8, this.tlX + cap.blockW + 8, this.tlY + cap.blockH + 16]]) : 1;
    this.kp = pace(this.ctx);
    // 蓋滿的時間：短窗格一秒多、長窗格最多三秒半
    this.tFull = start + clamp(0.42 * D, 1.15, 3.5);
    const rnd = mulberry32(Math.floor(hash(this.seed, 23) * 1e9));
    const [x0, y0, x1, y1] = this.rect;
    const diag = Math.hypot(x1 - x0, y1 - y0);
    // 第一滴在焦點；後面每一拍一滴，落在照片裡離已經濕的地方遠一點的位置
    const pts: [number, number][] = [[lerp(x0, x1, ph.fx), lerp(y0, y1, ph.fy)]];
    for (let i = 1; i < ND; i++) {
      let best: [number, number] = [0, 0], bd = -1;
      for (let k = 0; k < 12; k++) {
        const c: [number, number] = [lerp(x0, x1, 0.12 + 0.76 * rnd()), lerp(y0, y1, 0.12 + 0.76 * rnd())];
        const d = Math.min(...pts.map(([a, b]) => Math.hypot(a - c[0], b - c[1])));
        if (d > bd) { bd = d; best = c; }
      }
      pts.push(best);
    }
    let tb = Math.min(beatAfter(audio, start + 0.12), start + 0.4 * this.kp);
    pts.forEach(([x, y], i) => {
      const t0 = i === 0 ? tb : Math.min(beatAfter(audio, tb, 1), tb + 0.5 * this.kp);
      if (i > 0) tb = t0;
      // 每一滴長到夠蓋到照片最遠的角落，在 tFull 前長完
      const far = Math.max(Math.hypot(x - x0, y - y0), Math.hypot(x - x1, y - y0), Math.hypot(x - x0, y - y1), Math.hypot(x - x1, y - y1));
      const r = i === 0 ? far + 160 : Math.max(diag * 0.35, far * 0.7) + 120;
      this.drops.push({ x, y, t0, t1: Math.max(t0 + 0.6, this.tFull), r });
    });
    cap.writeAt(start + 0.5 * this.kp, Math.min(2.4, 0.5 * D));
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const u = this.bg.u;
    const [x0, , x1] = this.rect;
    // 畫裡的畫面往焦點推；鏡頭一開始快、越來越慢地往焦點推近
    const crop = p6Crop(this.ctx, this.img!, t, { zoom: PUSH, screenW: x1 - x0 });
    setP6Photo(u, this.ctx.params.photo, crop);
    const [cx, cy, z] = focusCam(this.foc, settleK(t - s, 6) * this.amp, FOCUS);
    (u.cam!.value as THREE.Vector3).set(cx, cy, z);
    (u.rect!.value as THREE.Vector4).set(...this.rect);
    const dr = u.drops!.value as THREE.Vector4[];
    for (let i = 0; i < ND; i++) {
      const d = this.drops[i];
      if (!d || t < d.t0) { dr[i]!.set(0, 0, 0, 0); continue; }
      // 擴開：一開始快、越來越慢（水往外滲）
      const g = ease.outCubic(prog(t, d.t0, d.t1));
      const wet = 1 - prog(t, d.t1, d.t1 + 0.8);
      dr[i]!.set(d.x, d.y, 30 + d.r * g, wet);
    }
    // 乾：蓋滿以後零點八秒乾透
    u.dry!.value = ease.inOutQuad(prog(t, this.tFull, this.tFull + 0.8));
    u.sketchK!.value = 1 - prog(t, this.tFull, this.tFull + 0.6);
    u.photo!.value = this.tex;
    u.lod!.value = photoLod(this.img!.w * (crop[2] - crop[0]), (x1 - x0) * z);
    const cap = this.cap;
    if (cap.has) {
      cap.draw(t);
      u.tl!.value = cap.L.texture;
      (u.tlR!.value as THREE.Vector4).set(this.tlX - cap.pad, this.tlY - cap.pad, cap.L.w, cap.L.h);
      u.textK!.value = cap.hasMain ? 1 : prog(t, s + 0.3, s + 0.8);
    } else { u.tl!.value = this.tex; u.textK!.value = 0; }
    u.t!.value = t;
    u.k!.value = 1 - 0.06 * prog(t, e - 0.3, e);
    this.bg.render(renderer, out);
    return { ...P6_POST };
  }
}
