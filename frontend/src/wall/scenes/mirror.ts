// 照片版面「梳妝鏡」（亮）：照片插在梳妝鏡的框邊——
//  - 淡色條紋壁紙上掛著一面化妝鏡（圓角、米白漆的寬框、框上一圈圓燈泡，切進來時燈一顆一顆亮起來），鏡面邊緣一圈斜邊，下面露出一點梳妝台的檯面（離鏡頭近、在焦外）。
//  - 鏡子裡是糊掉的房間：窗的亮光、一扇暗暗的門、一串暖色小燈的光斑（拍點上很輕地亮一下）。
//    鏡頭很慢地橫移、推近，鏡子裡的東西往反方向動得比較多（視差），看得出那是鏡子。
//  - 白邊相片斜斜地插在鏡框的左邊（左緣塞在框底下），貼著鏡面：底下有一點影子、鏡子裡多一道相片背面的白邊（鏡面玻璃的厚度）。
//    切進來時相片像剛插進去，從右下滑進框邊、轉正一點。
//  - 相片上的畫面往新人點的焦點（臉）慢慢推近，鏡頭也往臉那邊靠一點（鏡子上的字一直在畫面的安全區裡）。
//  - 主字（賓客留言＋署名，或新人的註解）像用口紅寫在鏡子上（紅色的手寫字，固定色 collar 混一點墨，一個字一個字寫出來），
//    歌詞小一號寫在下面跟唱，字在鏡子裡有一道很淡的倒影；沒有主字就把歌詞寫在同一個位置跟唱；
//    兩樣都沒有就沒有字，鏡子縮窄、相片在中間一點，鏡頭往臉推得多一點。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, loadText } from '../engine/type';
import { mixRgba } from '../engine/palette';
import { clamp, ease, hash, prog } from '../engine/util';
import { loadPhotos, fitIn, mipLod, Caption, P2_GLSL, settle, keepIn, v2, v4, type P2Photo } from './_p2';
import { focusCrop, focusIn, loadWords, settleK } from './_photo';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'frame', paper: true, energy: [0, 0.75], bars: [2, 8], weight: 1, prefers: ['portrait', 'square', 'small'] };

/** 梳妝台檯面（畫面下緣）。 */
const TABLE = 990;

const BG = () => new FSPass(/* glsl */ `
  ${P2_GLSL}
  uniform sampler2D photo; uniform sampler2D cap; uniform vec2 capSize; uniform vec4 crop;
  uniform vec3 cam; uniform vec2 camRef;
  // 鏡子：中心、半寬、半高；框寬
  uniform vec4 mir; uniform float fw; uniform float rad;
  // 相片：中心、外框半寬高；角度、白邊
  uniform vec4 ph; uniform float pang; uniform float border;
  // 鏡子上的字：中心、角度、透明度
  uniform vec3 tx; uniform float txA;
  uniform float lod; uniform float t; uniform float beat; uniform float chase; uniform float k;

  // 鏡子：圓角長方形（d < 0 在裡面）
  float sdMirror(vec2 q, vec2 hs, float r) { return sdBox(q, hs - vec2(r)) - r; }

  // 鏡子裡糊掉的房間（r 是鏡子裡的座標，已經算好視差）
  vec3 room(vec2 r) {
    vec3 c = mix(mix(C_PAPER, C_BONE, 0.5) * 0.7, mix(C_PAPER, C_SEPIA, 0.14) * 0.52, smoothstep(100.0, 1000.0, r.y));
    // 窗的亮光（右上）、靠牆一個暗暗的衣櫃（左邊，大半被相片擋住）
    float win = 1.0 - smoothstep(-50.0, 80.0, sdBox(r - vec2(1250.0, 360.0), vec2(220.0, 270.0)));
    c = mix(c, mix(C_BONE, C_FUR, 0.08) * 0.85, win * 0.85);
    float ward = 1.0 - smoothstep(-50.0, 60.0, sdBox(r - vec2(200.0, 640.0), vec2(170.0, 420.0)));
    c = mix(c, mix(C_SEPIA, C_PAPER, 0.4) * 0.42, ward * 0.6);
    // 一串暖色小燈的光斑（焦外的圓，拍點上很輕地亮一下）
    for (int i = 0; i < 9; i++) {
      float fi = float(i);
      vec2 b = vec2(330.0 + 125.0 * fi, 150.0 + 46.0 * sin(fi * 0.8) + 3.2 * pow(fi - 4.0, 2.0));
      float rr = 24.0 + 9.0 * hash11(fi * 3.1);
      float a = 1.0 - smoothstep(rr - 7.0, rr + 4.0, length(r - b));
      c = mix(c, mix(C_BONE, C_FUR, 0.3) * (0.8 + 0.05 * beat), a * (0.5 + 0.18 * beat));
    }
    return c;
  }

  // 鏡框上的燈泡（左右各 6 顆、上面 8 顆）：回傳 (離最近一顆燈泡中心多遠, 亮起來的順序 0..1)
  vec2 bulbAt(vec2 q, vec2 mh) {
    float bx = mh.x + fw * 0.5, by = mh.y + fw * 0.5;
    float stY = (2.0 * mh.y - 140.0) / 5.0;
    float ky = clamp(floor((q.y + mh.y - 70.0) / stY + 0.5), 0.0, 5.0);
    vec2 cL = vec2(-bx, -mh.y + 70.0 + ky * stY), cR = vec2(bx, cL.y);
    float stX = (2.0 * mh.x - 200.0) / 7.0;
    float kx = clamp(floor((q.x + mh.x - 100.0) / stX + 0.5), 0.0, 7.0);
    vec2 cT = vec2(-mh.x + 100.0 + kx * stX, -by);
    float dL = length(q - cL), dR = length(q - cR), dT = length(q - cT);
    // 亮的順序：左邊由下往上、上面由左往右、右邊由上往下（一圈跑過去）
    float d = dL, id = 5.0 - ky;
    if (dT < d) { d = dT; id = 6.0 + kx; }
    if (dR < d) { d = dR; id = 14.0 + ky; }
    return vec2(d, id / 19.0);
  }

  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = cam.xy + (sp - vec2(${W / 2}.0, ${H / 2}.0)) / cam.z;
    // ---- 牆：很淡的直條紋壁紙，左上的窗光
    float stripe = smoothstep(0.35, 0.65, abs(fract(p.x / 46.0) - 0.5) * 2.0);
    vec3 col = mix(C_PAPER, C_BONE, 0.3) * (0.56 + 0.022 * stripe) * (1.0 + 0.01 * snoise(p / vec2(2.0, 14.0)));
    vec2 lq = (p - vec2(-200.0, -200.0)) / vec2(1600.0, 1300.0);
    col += mix(C_BONE, C_FUR, 0.14) * 0.14 * exp(-dot(lq, lq) * 1.3);
    vec2 mc = mir.xy, mh = mir.zw;
    vec2 q = p - mc;
    // 鏡子的影子（光從左上：往右下）
    col *= 1.0 - 0.28 * softShadow(sdMirror(q - vec2(16.0, 20.0), mh + vec2(fw), rad + fw), 22.0);
    float dOut = sdMirror(q, mh + vec2(fw), rad + fw);
    if (dOut < 1.0) {
      float dIn = sdMirror(q, mh, rad);
      // ---- 鏡面：房間的倒影（鏡頭動時往反方向動得比較多），邊緣一圈斜邊
      vec2 r = p + (cam.xy - camRef) * 1.6 - mc + vec2(${W / 2}.0, ${H / 2}.0);
      vec3 g = room(r) * 0.95;
      float bev = smoothstep(-16.0, -14.0, dIn);
      g = mix(g, room(r + q * 0.06) * 1.04, bev);
      g += C_BONE * 0.05 * (1.0 - smoothstep(0.0, 2.0, abs(dIn + 15.0)));
      // 玻璃上一道很淡的斜反光（跟著鏡頭移）
      g += C_BONE * 0.035 * exp(-pow((q.x + q.y * 0.7 + (cam.x - camRef.x) * 2.0 + 200.0) / 120.0, 2.0));
      // ---- 鏡子上的字：寫在玻璃表面，鏡子裡有一道很淡、錯開一點的倒影
      if (txA > 0.0) {
        vec2 tq = rot2(-tx.z) * (p - tx.xy) + capSize * 0.5;
        vec4 gh = layerAt(cap, tq - vec2(5.0, 4.0), capSize);
        g = g * (1.0 - 0.1 * gh.a * txA);
        vec4 w = layerAt(cap, tq, capSize);
        g = g * (1.0 - w.a * txA) + w.rgb * txA;
      }
      // ---- 相片：貼著鏡面，左緣塞在框底下；鏡子裡多一道相片背面的白邊
      vec2 pq = rot2(-pang) * (p - ph.xy);
      float dP = sdBox(pq, ph.zw);
      float back = sdBox(rot2(-pang) * (p - ph.xy - vec2(7.0, 6.0)), ph.zw);
      g = mix(g, C_BONE * 0.7, (1.0 - smoothstep(-0.8, 0.8, back)) * step(0.5, dP) * 0.8);
      g *= 1.0 - 0.3 * softShadow(sdBox(rot2(-pang) * (p - ph.xy - vec2(4.0, 6.0)), ph.zw), 6.0) * step(0.0, dP);
      if (dP < 1.0) {
        vec3 pr = C_BONE * 0.78;
        vec2 hi = ph.zw - vec2(border);
        float di = sdBox(pq, hi);
        if (di < 0.8) {
          // 相片上的畫面是照片的 crop 那一塊（往焦點推）
          vec2 uv = mix(crop.xy, crop.zw, (pq + hi) / (2.0 * hi));
          pr = mix(pr, photoLin(photo, uv, lod), 1.0 - smoothstep(-0.7, 0.7, di));
        }
        pr *= 0.97 + 0.05 * smoothstep(ph.w, -ph.w, pq.y);
        g = mix(g, pr, 1.0 - smoothstep(-0.8, 0.8, dP));
      }
      // ---- 鏡框：米白漆的平板框（外緣圓角、往外一點點暗），靠鏡面那邊一條細細的金線
      float u = clamp(dIn / fw, 0.0, 1.0);
      vec3 fr = mix(C_BONE, C_PAPER, 0.4) * 0.64 * (1.0 + 0.04 * snoise(q / vec2(3.0, 40.0)));
      fr *= 1.0 - 0.18 * smoothstep(0.8, 1.0, u) + 0.06 * (1.0 - smoothstep(0.0, 0.1, abs(u - 0.82)));
      fr = mix(fr, mix(C_FUR, C_BONE, 0.45) * 0.7, (1.0 - smoothstep(0.02, 0.04, abs(u - 0.06))));
      fr *= 1.0 - 0.2 * exp(-u * fw / 4.0);
      // 相片塞進框底下的地方，框上一點點影子
      float under = (1.0 - smoothstep(-0.8, 0.8, dP));
      fr *= 1.0 - 0.12 * under;
      vec3 m = mix(g, fr, smoothstep(-0.8, 0.8, dIn));
      col = mix(col, m, 1.0 - smoothstep(-0.8, 0.8, dOut));
    }
    // ---- 燈泡：霧面的圓燈泡，切進來時一顆一顆亮起來（跑一圈），拍點上很輕地亮一下；四周一圈暖光
    vec2 bb = bulbAt(q, mh);
    float on = smoothstep(bb.y - 0.02, bb.y + 0.02, chase);
    vec3 lamp = mix(C_EMBER, C_BONE, 0.4);
    col += lamp * 0.13 * on * (0.85 + 0.15 * beat) * exp(-max(bb.x - 19.0, 0.0) / 42.0);
    if (bb.x < 21.0) {
      float r = bb.x / 19.0;
      // 霧面燈泡：中間最亮，邊緣暗一點、偏暖
      vec3 bulb = mix(mix(C_BONE, C_ASH, 0.3) * 0.62, mix(lamp * (1.2 + 0.1 * beat), lamp * 0.8, r * r), on);
      col = mix(col * (1.0 - 0.3 * (1.0 - on)), bulb, 1.0 - smoothstep(18.0, 19.5, bb.x));
    }
    // ---- 梳妝台的檯面（離鏡頭近、在焦外）
    float ty = p.y - ${TABLE}.0;
    if (ty > -6.0) {
      vec3 top = mix(C_PAPER, C_BONE, 0.45) * 0.64 * (1.0 + 0.04 * fbm(vec2(p.x / 400.0, ty / 30.0), 2));
      top += C_BONE * 0.06 * exp(-max(ty, 0.0) / 6.0);
      col = mix(col * (1.0 - 0.25 * exp(-max(-ty, 0.0) / 4.0)), top, smoothstep(-6.0, 6.0, ty));
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, cap: { value: null }, capSize: { value: new THREE.Vector2(1, 1) }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  cam: { value: new THREE.Vector3(W / 2, H / 2, 1) }, camRef: { value: new THREE.Vector2(W / 2, H / 2) },
  mir: { value: new THREE.Vector4() }, fw: { value: 70 }, rad: { value: 60 },
  ph: { value: new THREE.Vector4() }, pang: { value: 0 }, border: { value: 18 },
  tx: { value: new THREE.Vector3() }, txA: { value: 0 },
  lod: { value: 0 }, t: { value: 0 }, beat: { value: 0 }, chase: { value: 1 }, k: { value: 1 },
});

/** 鏡子上寫字的那一塊。寬 600：60 字的長留言在 40 px 排得進四行。 */
const COL_W = 600, COL_H = 420;
const PAD = 26;

/** 局部座標 (x, y) 轉 a 弧度（shader 的 rot2(-a) * (p - c) 反過來：相片上的一點在牆上的哪裡）。 */
const rot = (x: number, y: number, a: number) => ({ x: Math.cos(a) * x - Math.sin(a) * y, y: Math.sin(a) * x + Math.cos(a) * y });

export default class Mirror extends Scene {
  bg = shared('mirror.bg', BG);
  seed = Number(this.ctx.params.seed ?? 1);
  ph: P2Photo | null = null;
  cap: Caption | null = null;
  text: Layer2D | null = null;
  mx = W / 2; my = 540; mhw = 600; mhh = 450; fw = 70;
  px = 0; py = 0; phw = 0; phh = 0; border = 18; ang = -0.12;
  tcx = 0; tcy = 0; tang = -0.03;

  override async init() {
    const ctx = this.ctx;
    await loadText(`${ctx.params.photo?.caption ?? ''}${ctx.params.photo?.album ?? ''}`);
    await loadWords(ctx);
    [this.ph] = await loadPhotos(ctx, (x) => this.track(x), 1);
    const ph = this.ph!;
    const meas = this.track(new Layer2D(8, 8, 1, { fast: true }));
    this.cap = new Caption(ctx, meas.ctx, {
      family: F.hand(400), w: COL_W, h: COL_H, min: 40, max: 50, lineHeight: 1.4, maxLines: 4,
      ink: mixRgba('collar', 'sepia', 0.4, 0.95), unsung: mixRgba('collar', 'sepia', 0.4, 0.42), active: mixRgba('collar', 'signal', 0.35),
      sigInk: mixRgba('collar', 'sepia', 0.55, 0.75), sigSize: 28, lyricSize: 46, lyricSubSize: 38,
      label: { family: F.hand(700), size: 22, color: mixRgba('collar', 'sepia', 0.4, 0.6), tracking: 4, gap: 20 },
    });
    const cap = this.cap;
    // 相片（含白邊）：有字時小一點，右半邊留給字
    const maxW = cap.on ? 520 : 640, maxH = cap.on ? 500 : 560;
    const pre = fitIn(ph.w, ph.h, maxW - 36, maxH - 36);
    this.border = clamp(0.05 * Math.min(pre.w, pre.h), 12, 26);
    const fit = fitIn(ph.w, ph.h, maxW - 2 * this.border, maxH - 2 * this.border);
    this.phw = fit.w / 2 + this.border; this.phh = fit.h / 2 + this.border;
    const dir = hash(this.seed, 6) < 0.5 ? 1 : -1;
    this.ang = dir * (0.07 + 0.04 * hash(this.seed, 7));
    // 鏡子：有字時寬（左邊插相片、右邊寫字），沒有字時窄一點、相片在中間一點
    this.mhh = 400;
    this.my = 530;
    if (cap.on) {
      this.mhw = 660; this.mx = 920;
    } else {
      // 沒有字：鏡子窄一點，插在左邊框的相片差不多在鏡子中間
      this.mhw = Math.max(380, this.phw * Math.cos(this.ang) + Math.abs(this.phh * Math.sin(this.ang)) + 120); this.mx = W / 2 - 20;
    }
    // 相片的左緣塞進框底下（往框裡伸 12 px），高度在鏡子的中段偏上
    const left = this.mx - this.mhw;
    this.px = left - 14 + this.phw * Math.cos(this.ang) + Math.abs(this.phh * Math.sin(this.ang));
    this.py = this.my + 40;
    if (cap.on) {
      const tw = Math.max(240, cap.width) + 2 * PAD, th = cap.height + 2 * PAD;
      this.text = this.track(new Layer2D(tw, th, undefined, { fast: true }));
      // 寫在鏡子右半邊、相片右邊的空處（字在 HUD 區上面）；字寬時往左靠，右邊離鏡子邊緣至少 60
      const x0 = Math.min(Math.max(this.px + this.phw + 70, this.mx + 60), this.mx + this.mhw - 60 - cap.width);
      this.tcx = x0 + tw / 2 - PAD;
      this.tcy = clamp(this.my - 20, 200 + th / 2, 790 - th / 2);
      this.tang = -0.025 * dir;
      cap.writeFrom(ctx.start + 0.8, 2.2);
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const lt = t - s;
    const ph = this.ph!;
    const u = this.bg.u;
    const z = settle(lt);
    // 相片上的畫面往焦點推一點（實體相片：1.15 倍；很小的照片少推）
    const kf = settleK(lt);
    const hw = this.phw - this.border, hh = this.phh - this.border;
    const crop = focusCrop(ph.ref, ph.w, ph.h, ph.w / ph.h, kf, { zoom: 1.15, screenW: 2 * hw * 1.05 });
    v4(u.crop!, crop[0], crop[1], crop[2], crop[3]);
    // 鏡頭：很慢地橫移、推近（鏡子裡的東西往反方向動得比較多），同時往相片上的臉靠；沒有字時直接往臉推近。
    // 鏡子上的字一直在畫面的安全區裡
    const dir = hash(this.seed, 3) < 0.5 ? 1 : -1;
    const gx = this.text ? (this.mx - this.mhw + this.tcx + 260) / 2 : this.mx;
    const [ix, iy] = focusIn(ph.ref, crop);
    const fl = rot((2 * ix - 1) * hw, (2 * iy - 1) * hh, this.ang);
    const faceX = this.px + fl.x, faceY = this.py + fl.y;
    const pull = this.text ? 0.25 : 0.5;
    let cam = {
      x: gx + dir * 70 * (z - 0.5) + (faceX - gx) * pull * kf,
      y: 530 - 8 * z + (faceY - 530) * pull * kf,
      z: 1 + 0.045 * z + (this.text ? 0.02 : 0.1) * kf,
    };
    if (this.text && this.cap) {
      const x0 = this.tcx - this.text.w / 2 + PAD, y0 = this.tcy - this.text.h / 2 + PAD;
      cam = keepIn(cam, [[x0, y0, x0 + this.cap.width, y0 + this.cap.height + 0.25 * this.cap.size]]);
    }
    (u.cam!.value as THREE.Vector3).set(cam.x, cam.y, cam.z);
    v2(u.camRef!, gx, 530);
    v4(u.mir!, this.mx, this.my, this.mhw, this.mhh);
    u.fw!.value = this.fw;
    u.rad!.value = 60;
    // 相片剛插進去：從右下滑進框邊、轉正一點
    const tuck = ease.outCubic(prog(t, s + 0.05, s + 0.6));
    v4(u.ph!, this.px + 70 * (1 - tuck), this.py + 26 * (1 - tuck), this.phw, this.phh);
    u.pang!.value = this.ang * (1 + 0.6 * (1 - tuck));
    u.border!.value = this.border;
    u.photo!.value = ph.tex;
    u.lod!.value = mipLod(ph.w * (crop[2] - crop[0]), 2 * hw * cam.z);
    u.t!.value = lt;
    u.beat!.value = Math.exp(-f.beatPhase * 4);
    // 化妝鏡的燈一顆一顆亮起來
    u.chase!.value = -0.05 + 1.1 * prog(t, s + 0.05, s + 0.85);
    u.k!.value = (0.92 + 0.08 * ease.outCubic(prog(t, s, s + 0.5))) * (1 - 0.1 * prog(t, e - 0.3, e));
    if (this.text && this.cap) {
      const L = this.text;
      if (this.cap.draw(L, PAD, PAD, t)) L.upload();
      u.cap!.value = L.texture;
      v2(u.capSize!, L.w, L.h);
      (u.tx!.value as THREE.Vector3).set(this.tcx, this.tcy, this.tang);
      u.txA!.value = prog(t, s + 0.3, s + 0.6) * (1 - prog(t, e - 0.3, e));
    } else {
      // 共用的 pass 可能還指著上一個窗格（已經釋放）的圖層：清掉
      u.cap!.value = null;
      u.txA!.value = 0;
    }
    this.bg.render(renderer, out);
    return { paper: 1, bloom: 0.15, bloomThreshold: 1.1, halation: 0.05, vignette: 0.3 };
  }
}
