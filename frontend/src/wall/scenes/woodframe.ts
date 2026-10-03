// 照片版面「木框擺桌」（亮）：午後的木桌上立著一個原木相框——
//  - 牆與桌面在焦外（淺景深），窗戶照進來一大塊斜斜的光，光裡有窗外植物的葉影（落在牆、桌面、相框上），每個小節線被風吹得晃一下。
//  - 相框微微側轉（透視），鏡頭整個窗格很慢地繞一點、推近；切進來時先失焦再對到照片上（跟焦）。
//  - 原木框的木紋沿著四邊、45 度接角，內緣一圈斜面；照片完整放（直的、很小的舊照片都不裁），框玻璃有一道很淡的反光。
//  - 框裡的照片往新人點的焦點（臉）慢慢推近，鏡頭也往那邊靠一點（桌卡上的字一直在畫面的安全區裡）。
//  - 主字（賓客留言＋署名，或新人的註解）手寫在相框旁邊立著的一張小卡（桌卡）上，一個字一個字寫出來，歌詞小一號寫在下面跟唱；
//    沒有主字就把歌詞手寫在卡上跟唱；兩樣都沒有就只有相框（移到正中間，鏡頭往臉推得多一點）。卡片照字的多少變大。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { loadPhotos, fitIn, mipLod, Caption, P2_GLSL, settle, keepIn, v2, v4, type P2Photo } from './_p2';
import { focusCrop, focusIn, loadWords, settleK } from './_photo';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'frame', paper: true, energy: [0, 0.8], bars: [2, 8], weight: 1, prefers: ['landscape', 'small'] };

/** 牆與桌面的交界、相框底（站在桌上，比牆前面一點）。 */
const EDGE = 700, BASE = 792;

const BG = () => new FSPass(/* glsl */ `
  ${P2_GLSL}
  uniform sampler2D photo; uniform sampler2D cap; uniform vec2 capSize; uniform vec4 crop;
  uniform vec3 cam; uniform vec2 fc; uniform vec2 fh; uniform float mw; uniform float yaw;
  uniform vec2 cc; uniform vec2 ch; uniform float cardOn;
  uniform float lod; uniform float blur; uniform float t; uniform float gust; uniform float sun; uniform float k;

  // 窗戶照進來的一大塊光（斜的平行四邊形，邊很軟），很慢地往旁邊移
  float sunPatch(vec2 p) {
    float sx = p.x + 0.5 * p.y - 60.0 * sun;
    return smoothstep(380.0, 760.0, sx) * (1.0 - smoothstep(1700.0, 2150.0, sx)) * smoothstep(-120.0, 260.0, p.y);
  }
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = cam.xy + (sp - vec2(${W / 2}.0, ${H / 2}.0)) / cam.z;
    float sunK = min(sun, 1.0) * sunPatch(p);
    vec3 warm = mix(C_BONE, C_FUR, 0.16);
    vec3 col;
    float onTable = step(${EDGE}.0, p.y);
    // 葉影：整片被風吹著晃（小節線上一陣風）；牆上的離葉子遠、比較糊
    vec2 sway = vec2(14.0 * sin(t * 0.7) + 26.0 * gust, 6.0 * cos(t * 0.55) + 8.0 * gust);
    float lf = sunK > 0.01 ? leafShadow(p * 0.9, sway, t, onTable > 0.5 ? 12.0 : 22.0) : 0.0;
    if (onTable < 0.5) {
      // 牆：焦外的灰泥（只有很低頻的明暗）
      float n = fbm(p / 520.0, 2);
      vec3 wall = mix(C_PAPER, C_BONE, 0.5) * (0.6 + 0.03 * n);
      col = wall + warm * 0.27 * sunK * (1.0 - 0.55 * lf);
      // 桌面跟牆接觸的地方暗一點
      col *= 1.0 - 0.16 * smoothstep(${EDGE - 70}.0, ${EDGE}.0, p.y);
    } else {
      // 桌面：透視（越近越寬），木紋沿著 x；越近越糊（景深）
      float dz = (p.y - 220.0);
      float tv = 300000.0 / dz;
      vec2 tp = vec2((p.x - ${W / 2}.0) * (${EDGE - 220}.0 / dz) * 1.2, tv * 1.4);
      float near = smoothstep(${EDGE + 40}.0, 1080.0, p.y);
      vec3 base = mix(C_FUR, C_SEPIA, 0.4) * 0.6;
      float g = fbm(vec2(tp.x / 700.0, tp.y / 30.0), 3);
      float ring = sin((tp.y + 50.0 * g) / 7.0 + 1.5 * snoise(vec2(tp.x / 300.0, tp.y / 20.0)));
      vec3 wood = base * (0.86 + (0.18 * g + 0.07 * ring) * (1.0 - 0.75 * near));
      float seam = 1.0 - smoothstep(0.6, 2.2 + 8.0 * near, abs(mod(tv, 160.0) - 80.0) - 78.0 + 2.2);
      wood *= 1.0 - 0.3 * seam * (1.0 - 0.7 * near);
      col = wood + warm * 0.2 * sunK * (1.0 - 0.6 * lf) * (1.0 - 0.3 * near);
      // 桌子前緣在畫面外，越近越暗一點點
      col *= 1.0 - 0.1 * near;
    }
    // ---- 相框的影子：光從左上來，影子往右邊落在牆上（很軟）、桌上有接觸陰影
    vec2 oh = fh + vec2(mw);
    float dsw = sdBox(p - fc - vec2(46.0, 10.0), oh);
    col *= 1.0 - 0.3 * (1.0 - onTable) * softShadow(dsw, 42.0) * (0.6 + 0.4 * sunK);
    vec2 cq = (p - vec2(fc.x + 40.0, fc.y + oh.y + 6.0)) / vec2(oh.x * 1.1, 16.0);
    col *= 1.0 - 0.42 * onTable * exp(-dot(cq, cq) * 1.4);
    // ---- 桌卡的影子
    if (cardOn > 0.0) {
      float dc = sdBox(p - cc - vec2(30.0, 6.0), ch);
      col *= 1.0 - 0.22 * cardOn * (1.0 - onTable) * softShadow(dc, 30.0);
      vec2 kq = (p - vec2(cc.x + 24.0, cc.y + ch.y + 4.0)) / vec2(ch.x * 1.05, 12.0);
      col *= 1.0 - 0.36 * cardOn * onTable * exp(-dot(kq, kq) * 1.4);
    }
    // ---- 相框（微微側轉）
    vec2 q = yawInv(p - fc, yaw, 1500.0);
    float dO = sdBox(q, oh);
    if (dO < 1.0) {
      float a = 1.0 - smoothstep(-0.8, 0.8, dO);
      vec2 e = oh - abs(q);
      bool vert = e.x < e.y;
      // 木紋沿著每一邊（左右兩邊直的、上下兩邊橫的），45 度接角
      vec2 gp = vert ? vec2(q.y, q.x + 500.0) : vec2(q.x, q.y);
      vec3 wood = woodGrain(gp * vec2(1.0, 1.6), mix(C_FUR, C_BONE, 0.38) * 0.62);
      float dd = min(e.x, e.y);
      vec2 nOut = vert ? vec2(sign(q.x), 0.0) : vec2(0.0, sign(q.y));
      vec2 L = normalize(vec2(-1.0, -1.1));
      // 外緣圓角（朝外）、內緣斜面（朝照片）：朝光的那面亮
      float lit = 1.0 + 0.32 * dot(nOut, L) * (1.0 - smoothstep(0.0, 7.0, dd));
      float lip = smoothstep(mw - 11.0, mw - 9.0, dd);
      lit += 0.3 * dot(-nOut, L) * lip;
      lit *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 1.4, abs(e.x - e.y))) * step(0.0, mw - dd);
      vec3 fr = wood * lit * (0.8 + 0.28 * sunK * (1.0 - 0.6 * lf));
      vec2 hi = fh;
      float di = sdBox(q, hi);
      if (di < 1.0) {
        // 框裡的畫面是照片上的 crop 那一塊（往焦點推）
        vec2 uv = mix(crop.xy, crop.zw, (q + hi) / (2.0 * hi));
        vec3 ph = photoSoft(photo, uv, lod + blur * 40.0, blur);
        // 框的內緣在照片上留一道影子（光從左上：上緣、左緣）
        float dl = q.x + hi.x, dt = q.y + hi.y;
        ph *= 1.0 - 0.32 * clamp(exp(-dl / 9.0) + exp(-dt / 7.0), 0.0, 1.0);
        // 葉影也落在照片上（淡一點，照片照樣看得清楚）、玻璃上一道很淡的斜反光
        ph *= 1.0 - 0.06 * lf * sunK;
        float gl = exp(-pow((q.x * 0.55 + q.y + 60.0 - 900.0 * yaw) / 110.0, 2.0));
        ph += C_BONE * 0.04 * gl;
        fr = mix(fr, ph, 1.0 - smoothstep(-0.7, 0.7, di));
      }
      col = mix(col, fr, a);
    }
    // ---- 桌卡（往後仰一點：上緣比較遠），卡上的字是同一張圖層，跟著卡一起透視
    if (cardOn > 0.0) {
      vec2 kq = pitchInv(p - cc, -0.2, 1100.0);
      float dk = sdBox(kq, ch);
      if (dk < 1.0) {
        float a = 1.0 - smoothstep(-0.8, 0.8, dk);
        vec3 paper = mix(C_BONE, C_PAPER, 0.5) * 0.86 * (0.9 + 0.13 * sunK * (1.0 - 0.5 * lf));
        paper *= 1.0 + 0.05 * snoise(kq / 3.0) * 0.3;
        // 上緣是摺線：一道細細的亮線，下面一點點陰影
        paper *= 1.0 + 0.1 * (1.0 - smoothstep(0.0, 3.0, kq.y + ch.y)) - 0.06 * exp(-(kq.y + ch.y) / 10.0);
        vec4 tx = layerAt(cap, kq + ch, capSize);
        paper = paper * (1.0 - tx.a) + tx.rgb * (0.92 + 0.1 * sunK);
        col = mix(col, paper, a * cardOn);
      }
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, cap: { value: null }, capSize: { value: new THREE.Vector2(1, 1) }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  cam: { value: new THREE.Vector3(W / 2, H / 2, 1) }, fc: { value: new THREE.Vector2() }, fh: { value: new THREE.Vector2() }, mw: { value: 44 }, yaw: { value: 0 },
  cc: { value: new THREE.Vector2() }, ch: { value: new THREE.Vector2() }, cardOn: { value: 0 },
  lod: { value: 0 }, blur: { value: 0 }, t: { value: 0 }, gust: { value: 0 }, sun: { value: 1 }, k: { value: 1 },
});

/** 卡上字的留白。 */
const PADX = 40, PADY = 38;
/** 相框跟桌卡之間的空隙。 */
const GAP = 70;

export default class WoodFrame extends Scene {
  bg = shared('woodframe.bg', BG);
  seed = Number(this.ctx.params.seed ?? 1);
  ph: P2Photo | null = null;
  cap: Caption | null = null;
  card: Layer2D | null = null;
  /** 相框中心、照片半寬高、框寬；桌卡中心、半寬高；整組的中心（鏡頭最後對著它）。 */
  fx = W / 2; fy = H / 2; hw = 0; hh = 0; mw = 44;
  cx = 0; cy = 0; chw = 0; chh = 0;
  gx = W / 2;

  override async init() {
    const ctx = this.ctx;
    await loadText(`${ctx.params.photo?.caption ?? ''}${ctx.params.photo?.album ?? ''}`);
    await loadWords(ctx);
    [this.ph] = await loadPhotos(ctx, (x) => this.track(x), 1);
    const ph = this.ph!;
    const meas = this.track(new Layer2D(8, 8, 1, { fast: true }));
    // 寬 600：60 字的長留言在 40 px 排得進四行
    this.cap = new Caption(ctx, meas.ctx, {
      family: F.hand(400), w: 600, h: 400, min: 40, max: 50, lineHeight: 1.42, maxLines: 4,
      ink: rgba('sepia', 0.92), unsung: rgba('sepia', 0.42), active: mixRgba('signal', 'sepia', 0.45), sigInk: rgba('sepia', 0.7), sigSize: 28,
      lyricSize: 46, lyricSubSize: 38,
      label: { family: F.hand(700), size: 22, color: rgba('sepia', 0.6), tracking: 4, gap: 20 },
    });
    const cap = this.cap;
    const hasCard = cap.on;
    // 桌卡的大小照字（留白只比一行字高少一點；下面多留一點給字的下伸部）
    const cw = hasCard ? Math.max(300, cap.width + 2 * PADX) : 0, chh = hasCard ? cap.height + 2 * PADY + 8 : 0;
    this.chw = cw / 2; this.chh = chh / 2;
    // 相框：站在桌上，頂端離畫面上緣至少 110；有桌卡時寬度讓給卡
    const maxOuterH = BASE - 110;
    const maxOuterW = hasCard ? W - 2 * 130 - GAP - cw : 1150;
    const pre = fitIn(ph.w, ph.h, maxOuterW - 100, maxOuterH - 100);
    this.mw = clamp(0.085 * Math.min(pre.w, pre.h), 32, 56);
    const fit = fitIn(ph.w, ph.h, maxOuterW - 2 * this.mw, maxOuterH - 2 * this.mw);
    this.hw = fit.w / 2; this.hh = fit.h / 2;
    const ow = fit.w + 2 * this.mw;
    const groupW = hasCard ? ow + GAP + cw : ow;
    const x0 = (W - groupW) / 2 - (hasCard ? 10 : 30);
    this.fx = x0 + ow / 2;
    this.fy = BASE - this.hh - this.mw;
    this.gx = x0 + groupW / 2;
    if (hasCard) {
      this.cx = x0 + ow + GAP + cw / 2;
      // 卡的底站在桌上（比相框前面一點），字的最後一行在 HUD 區上面
      this.cy = 812 - chh / 2;
      this.card = this.track(new Layer2D(cw, chh, undefined, { fast: true }));
      cap.writeFrom(ctx.start + 0.75, 2);
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const lt = t - s;
    const ph = this.ph!;
    const u = this.bg.u;
    const z = settle(lt);
    // 框裡的畫面往焦點推（相框裡的照片：1.2 倍；很小的照片少推）
    const kf = settleK(lt);
    const crop = focusCrop(ph.ref, ph.w, ph.h, ph.w / ph.h, kf, { zoom: 1.2, screenW: 2 * this.hw * 1.06 });
    v4(u.crop!, crop[0], crop[1], crop[2], crop[3]);
    // 鏡頭：從左下一點、比較遠的地方，很慢地繞過來、推近整組，同時往臉那邊靠；沒有桌卡時直接往臉推近
    const dir = hash(this.seed, 3) < 0.5 ? 1 : -1;
    const [ix, iy] = focusIn(ph.ref, crop);
    const faceX = this.fx + (2 * ix - 1) * this.hw, faceY = this.fy + (2 * iy - 1) * this.hh;
    const pull = this.card ? 0.3 : 0.55;
    let cam = {
      x: this.gx - 46 * (1 - z) * dir + (faceX - this.gx) * pull * kf,
      y: 560 - 24 * z + (faceY - 560) * pull * kf,
      z: 1 + 0.055 * z + (this.card ? 0.02 : 0.1) * kf,
    };
    // 桌卡上的字一直在畫面的安全區裡（離邊 ≥ 96 px、不進 HUD 區）：拿整張卡算，卡的下緣也不要壓到 HUD 的字
    if (this.card) cam = keepIn(cam, [[this.cx - this.chw + 20, this.cy - this.chh + 20, this.cx + this.chw - 20, this.cy + this.chh + 4]]);
    (u.cam!.value as THREE.Vector3).set(cam.x, cam.y, cam.z);
    v2(u.fc!, this.fx, this.fy);
    v2(u.fh!, this.hw, this.hh);
    u.mw!.value = this.mw;
    // 側轉的角度跟著鏡頭繞過來慢慢變小
    u.yaw!.value = dir * lerp(0.17, 0.07, z);
    u.photo!.value = ph.tex;
    // 跟焦：切進來時照片是糊的，0.9 秒內對清楚
    const focus = ease.outCubic(prog(t, s + 0.1, s + 1.0));
    u.blur!.value = 0.01 * (1 - focus);
    u.lod!.value = mipLod(ph.w * (crop[2] - crop[0]), 2 * this.hw * cam.z);
    u.t!.value = t;
    // 風：每個小節線吹一下（很快起來、慢慢停）
    const bp = f.barPhase;
    u.gust!.value = (1 - Math.exp(-bp * 18)) * Math.exp(-bp * 2.6);
    // 光：切進來時像雲剛飄走，亮起來；之後光塊很慢地往旁邊移
    u.sun!.value = lerp(0.55, 1, ease.inOutQuad(prog(t, s, s + 1.4))) + 0.6 * settle(lt, 10);
    u.k!.value = (0.9 + 0.1 * ease.outCubic(prog(t, s, s + 0.5))) * (1 - 0.1 * prog(t, e - 0.3, e));
    if (this.card && this.cap) {
      // 桌卡放上來：從下面一點點升上來、淡入
      const rise = ease.outCubic(prog(t, s + 0.3, s + 0.85));
      v2(u.cc!, this.cx, this.cy + 26 * (1 - rise));
      v2(u.ch!, this.chw, this.chh);
      u.cardOn!.value = rise;
      const L = this.card;
      if (this.cap.draw(L, PADX, PADY, t)) L.upload();
      u.cap!.value = L.texture;
      v2(u.capSize!, L.w, L.h);
    } else {
      // 共用的 pass 可能還指著上一個窗格（已經釋放）的圖層：清掉，不然 three 會拿空的畫布重傳
      u.cardOn!.value = 0;
      u.cap!.value = null;
    }
    this.bg.render(renderer, out);
    return { paper: 1, bloom: 0.15, bloomThreshold: 1.1, halation: 0.05, vignette: 0.3 };
  }
}
