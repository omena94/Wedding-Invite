// 照片版面「晾照片」（亮，三張）：一條麻繩橫過明亮的戶外，三張相片用木頭曬衣夾夾在繩上，隨風輕輕晃——
//  - 背景是焦外的戶外：上面是淡淡的天空，下面是很糊的樹叢光斑（景深），整體亮但不刺眼。
//  - 麻繩中間下垂、隨風很慢地起伏；三張白邊相片各自繞著夾子像鐘擺一樣晃（相位不同），每個小節線一陣風、晃大一點再停下來。
//  - 主角（第一張）在中間、比較大、清楚；兩邊的比較小、在焦外。每一張都完整放（橫的、直的、手機直拍、很小的舊照片都不裁）。
//  - 進場：鏡頭沿著繩子從左邊滑過來，三張照片剛掛上去晃得比較大；一開始焦點在左邊那張，鏡頭到了以後跟焦到主角。
//  - 主角相片上的畫面往新人點的焦點（臉）慢慢推近，鏡頭滑到之後也往臉那邊靠一點（字一直在畫面的安全區裡）。
//  - 主字（賓客留言＋署名，或主角的註解）手寫在主角下方（背後的光斑壓淡一點讓字清楚），歌詞小一號寫在最下面跟唱；
//    相簿的第一張在上面小小寫相簿名。沒有主字就把歌詞寫在那裡跟唱；兩樣都沒有就只有照片（整組往下、放大一點）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { beatAfter } from './_motifs';
import { loadPhotos, fitIn, mipLod, Caption, P2_GLSL, settle, keepIn, drawLayer, v4, type P2Photo } from './_p2';
import { focusCrop, focusIn, loadWords, settleK } from './_photo';

export const spec: PlateSpecDecl = { photo: true, photos: 3, family: 'photo', series: 'frame', paper: true, energy: [0, 0.85], bars: [2, 8], weight: 1, prefers: ['portrait', 'square'] };

/** 繩子：兩端在畫面外（x = 960 ± ROPE_HALF 的地方高度是 yTop），中間下垂 sag。 */
const ROPE_HALF = 1160;

const BG = () => new FSPass(/* glsl */ `
  ${P2_GLSL}
  uniform sampler2D ph0; uniform sampler2D ph1; uniform sampler2D ph2;
  uniform vec3 cam; uniform float t;
  // 繩子：兩端高度、下垂、上下晃
  uniform vec3 rope;
  // 每張：夾子的位置（xy）、角度（z）、白邊（w）；照片半寬高（xy）、mip 層（z）、景深模糊（w）
  uniform vec4 pv0; uniform vec4 pv1; uniform vec4 pv2;
  uniform vec4 pd0; uniform vec4 pd1; uniform vec4 pd2;
  // 主角相片上的畫面是照片的哪一塊（往焦點推）；兩邊的是整張
  uniform vec4 crop0;
  // 字後面的光（中心、半寬高）：光斑壓淡，字清楚
  uniform vec4 haze;
  uniform float k;

  float ropeY(float x) { float u = (x - ${W / 2}.0) / ${ROPE_HALF}.0; return rope.x + rope.y * (1.0 - u * u) + rope.z; }

  // 焦外的樹叢光斑：一格一顆圓，越下面越密；顏色是淡綠到亮的陽光
  vec3 foliage(vec2 p, vec3 sky) {
    float dens = smoothstep(380.0, 1000.0, p.y) + 0.6 * smoothstep(420.0, 60.0, min(p.x, ${W}.0 - p.x)) * smoothstep(200.0, 700.0, p.y);
    vec3 col = sky;
    // 底下一層很糊的綠
    col = mix(col, mix(mix(C_GINGHAM, C_FUR, 0.12), C_BONE, 0.3) * 0.56, smoothstep(0.15, 1.0, dens) * 0.85);
    vec2 g = floor(p / 210.0);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 c = g + vec2(float(i), float(j));
      vec2 h = hash22(c);
      vec2 ctr = (c + 0.2 + 0.6 * hash22(c + 31.0)) * 210.0 + vec2(10.0 * sin(t * 0.4 + h.x * 6.0), 6.0 * cos(t * 0.33 + h.y * 5.0));
      float dl = smoothstep(380.0, 1000.0, ctr.y) + 0.6 * smoothstep(420.0, 60.0, min(ctr.x, ${W}.0 - ctr.x)) * smoothstep(200.0, 700.0, ctr.y);
      if (h.x > dl * 0.95) continue;
      float r = 50.0 + 70.0 * h.y;
      float d = length(p - ctr) - r;
      float a = 1.0 - smoothstep(-14.0, 10.0, d);
      // 葉子（暗一點的綠）或穿過葉縫的陽光（亮的圓）
      float bright = step(0.62, hash12(c + 7.0));
      vec3 bc = bright > 0.5 ? mix(C_BONE, C_FUR, 0.16) * 0.84 : mix(mix(C_GINGHAM, C_FUR, 0.12), C_SEPIA, 0.2 + 0.25 * h.y) * (0.44 + 0.12 * h.x);
      col = mix(col, bc, a * (bright > 0.5 ? 0.5 : 0.7));
    }
    return col;
  }

  // 一張晾著的相片：pv = 夾子位置、角度、白邊；pd = 照片半寬高、mip、模糊
  vec4 hung(vec2 p, vec4 pv, vec4 pd, sampler2D tex, vec4 cr, out vec4 clip) {
    vec2 c = rot2(pv.z) * (p - pv.xy);
    vec2 oh = pd.xy + vec2(pv.w);
    vec2 q = c - vec2(0.0, oh.y + 4.0);
    float soft = 0.8 + 3.0 * pd.w * 100.0;
    float d = sdBox(q, oh);
    vec4 res = vec4(0.0);
    if (d < soft) {
      float a = 1.0 - smoothstep(-soft, soft, d);
      vec3 pr = C_BONE * (0.84 + 0.015 * snoise(q / 4.0));
      // 相紙的切邊：外緣一圈很細的灰，跟亮的天空分得開
      pr *= 1.0 - 0.1 * (1.0 - smoothstep(-2.5 - soft, -0.5, d));
      float di = sdBox(q, pd.xy);
      if (di < soft) {
        vec2 uv = mix(cr.xy, cr.zw, (q + pd.xy) / (2.0 * pd.xy));
        vec3 im = photoSoft(tex, uv, pd.z, pd.w);
        pr = mix(pr, im, 1.0 - smoothstep(-soft, soft, di));
      }
      // 迎風的那一面：晃的時候亮暗一點點
      pr *= 1.0 + 0.6 * pv.z * (q.x / oh.x);
      res = vec4(pr, a);
    }
    // 曬衣夾：木頭的兩片、中間一條縫、一圈金屬彈簧（跟著照片一起轉）
    vec2 cq = c - vec2(0.0, 6.0);
    float dc = sdBox(cq, vec2(11.0, 37.0)) - 2.0;
    clip = vec4(0.0);
    if (dc < soft + 1.0) {
      float a = 1.0 - smoothstep(-soft, soft, dc);
      vec3 wood = mix(C_FUR, C_BONE, 0.3) * 0.62 * (0.92 + 0.06 * snoise(vec2(cq.x / 3.0, cq.y / 40.0)));
      wood *= 1.0 - 0.18 * smoothstep(4.0, 12.0, abs(cq.x)) * step(0.0, cq.x);
      wood *= 1.0 - 0.45 * (1.0 - smoothstep(0.4, 1.3, abs(cq.x)));
      float spr = 1.0 - smoothstep(2.0, 3.6, abs(cq.y + 4.0));
      wood = mix(wood, mix(C_ASH, C_BONE, 0.5) * (0.5 + 0.35 * (1.0 - abs(cq.x) / 13.0)), spr * step(abs(cq.x), 13.0));
      clip = vec4(wood, a);
    }
    return res;
  }

  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = cam.xy + (sp - vec2(${W / 2}.0, ${H / 2}.0)) / cam.z;
    // 背景比照片遠：鏡頭動時移得少一點（視差）
    vec2 bp = vec2(${W / 2}.0, ${H / 2}.0) + (p - vec2(${W / 2}.0, ${H / 2}.0)) * 0.7 + (cam.xy - vec2(${W / 2}.0, ${H / 2}.0)) * 0.3;
    // ---- 天空：上面淡、往下越亮（有霧氣），右上角有太陽那邊的暖光
    vec3 sky = mix(mix(C_BONE, C_ASH, 0.42) * 0.64, mix(C_BONE, C_ASH, 0.12) * 0.76, smoothstep(-100.0, 700.0, bp.y));
    vec2 sq = (bp - vec2(1700.0, -120.0)) / vec2(900.0, 700.0);
    sky += mix(C_BONE, C_FUR, 0.25) * 0.08 * exp(-dot(sq, sq));
    vec3 col = foliage(bp, sky);
    // 字後面的光：把光斑壓淡（不是框）
    if (haze.z > 0.0) {
      vec2 hq = (p - haze.xy) / haze.zw;
      col = mix(col, C_BONE * 0.8, 0.55 * exp(-pow(dot(hq, hq), 1.4)));
    }
    // ---- 麻繩：中間下垂，斜紋扭繩
    float ry = ropeY(p.x);
    float slope = -2.0 * rope.y * (p.x - ${W / 2}.0) / (${ROPE_HALF}.0 * ${ROPE_HALF}.0);
    float rd = (p.y - ry) / sqrt(1.0 + slope * slope);
    float ra = 1.0 - smoothstep(3.6, 5.0, abs(rd));
    if (ra > 0.0) {
      float tw = 0.75 + 0.25 * sin(p.x * 0.5 - rd * 1.3);
      vec3 rc = mix(C_FUR, C_SEPIA, 0.38) * 0.6 * tw * (1.05 - 0.35 * smoothstep(-4.0, 4.0, rd));
      col = mix(col, rc, ra);
    }
    // ---- 三張相片（先畫兩邊的，主角在最上面）、夾子
    vec4 c1, c2, c0;
    vec4 a1 = hung(p, pv1, pd1, ph1, vec4(0.0, 0.0, 1.0, 1.0), c1);
    col = mix(col, a1.rgb, a1.a); col = mix(col, c1.rgb, c1.a);
    vec4 a2 = hung(p, pv2, pd2, ph2, vec4(0.0, 0.0, 1.0, 1.0), c2);
    col = mix(col, a2.rgb, a2.a); col = mix(col, c2.rgb, c2.a);
    vec4 a0 = hung(p, pv0, pd0, ph0, crop0, c0);
    col = mix(col, a0.rgb, a0.a); col = mix(col, c0.rgb, c0.a);
    fragColor = vec4(col * k, 1.0);
  }`, {
  ph0: { value: null }, ph1: { value: null }, ph2: { value: null },
  cam: { value: new THREE.Vector3(W / 2, H / 2, 1) }, t: { value: 0 }, rope: { value: new THREE.Vector3(120, 110, 0) },
  pv0: { value: new THREE.Vector4() }, pv1: { value: new THREE.Vector4() }, pv2: { value: new THREE.Vector4() },
  pd0: { value: new THREE.Vector4() }, pd1: { value: new THREE.Vector4() }, pd2: { value: new THREE.Vector4() }, crop0: { value: new THREE.Vector4(0, 0, 1, 1) },
  haze: { value: new THREE.Vector4() }, k: { value: 1 },
});

/** 字：主角下方置中，最後一行的基線不低於這裡（HUD 區從 y = 830 開始）。 */
const CAP_BASE = 806, CAP_W = 1100;
/** 字的圖層寬（比字多留一點邊；高度照字）。 */
const TL_W = 1200;

interface Hang { ph: P2Photo; x: number; hw: number; hh: number; b: number; amp: number; w: number; phase: number }

export default class Clothesline extends Scene {
  bg = shared('clothesline.bg', BG);
  seed = Number(this.ctx.params.seed ?? 1);
  hangs: Hang[] = [];
  cap: Caption | null = null;
  text: Layer2D | null = null;
  yTop = 120; sag = 110;
  capTop = 0;
  tFocus = 0;

  override async init() {
    const ctx = this.ctx;
    const refs = (ctx.params.photos ?? [ctx.params.photo]) as { caption: string; album: string }[];
    await loadText(refs.map((r) => `${r?.caption ?? ''}${r?.album ?? ''}`).join(''));
    await loadWords(ctx);
    const photos = await loadPhotos(ctx, (x) => this.track(x), 3);
    const meas = this.track(new Layer2D(8, 8, 1, { fast: true }));
    // 字排寬一點（1100：60 字三行），整塊不要太高，主角照片才不會被擠得太小
    this.cap = new Caption(ctx, meas.ctx, {
      family: F.hand(400), w: CAP_W, h: 250, min: 40, max: 50, lineHeight: 1.36, maxLines: 3, align: 'center',
      ink: rgba('sepia', 0.9), unsung: rgba('sepia', 0.42), active: mixRgba('signal', 'sepia', 0.45), sigInk: rgba('sepia', 0.7), sigSize: 28,
      lyricSize: 46, lyricSubSize: 38,
      label: { family: F.hand(700), size: 22, color: rgba('sepia', 0.6), tracking: 6, gap: 16 },
    });
    const cap = this.cap;
    const hasCap = cap.on;
    // 繩子：有字時高一點（字在主角下面；字多時再高一點）；沒有字時整組往下、照片大一點
    this.capTop = CAP_BASE - cap.height;
    this.yTop = hasCap ? (this.capTop < 600 ? 60 : 86) : 160;
    this.sag = hasCap ? (this.capTop < 600 ? 78 : 92) : 110;
    const ropeMid = this.yTop + this.sag;
    // 主角的下緣（含白邊）離字至少 26 px
    const mainMaxH = hasCap ? clamp(this.capTop - 26 - (ropeMid + 4), 220, 560) : 640;
    const mainMaxW = hasCap ? 680 : 800;
    const sideMaxW = hasCap ? 360 : 420, sideMaxH = Math.min(mainMaxH * 0.78, hasCap ? 340 : 420);
    const size = (ph: P2Photo, mw: number, mh: number) => {
      const pre = fitIn(ph.w, ph.h, mw - 40, mh - 40);
      const b = clamp(0.045 * Math.min(pre.w, pre.h), 12, 26);
      const fit = fitIn(ph.w, ph.h, mw - 2 * b, mh - 2 * b);
      return { ph, hw: fit.w / 2, hh: fit.h / 2, b };
    };
    const main = size(photos[0]!, mainMaxW, mainMaxH);
    // 兩邊的不能比主角大（字多、主角是直的時主角會變小）：照主角的面積再縮
    const mainA = (main.hw + main.b) * (main.hh + main.b);
    const sized = [main, ...photos.slice(1).map((ph) => {
      const sd = size(ph, sideMaxW, sideMaxH);
      const k = Math.min(1, Math.sqrt((0.62 * mainA) / ((sd.hw + sd.b) * (sd.hh + sd.b))));
      return k < 1 ? size(ph, 2 * (sd.hw + sd.b) * k, 2 * (sd.hh + sd.b) * k) : sd;
    })];
    const m = sized[0]!, l = sized[1]!, r = sized[2]!;
    const gap = 72;
    const xl = W / 2 - (m.hw + m.b + gap + l.hw + l.b), xr = W / 2 + (m.hw + m.b + gap + r.hw + r.b);
    const ph0 = hash(this.seed, 3) * 6.28;
    this.hangs = [
      { ...m, x: W / 2, amp: 0.011, w: 2.1, phase: ph0 },
      { ...l, x: xl, amp: 0.018, w: 2.6, phase: ph0 + 2.1 },
      { ...r, x: xr, amp: 0.017, w: 2.4, phase: ph0 + 4.0 },
    ];
    if (hasCap) {
      this.text = this.track(new Layer2D(TL_W, Math.ceil(cap.height + 70), undefined, { fast: true }));
    }
    // 鏡頭滑到中間之後（或下一拍）跟焦到主角
    this.tFocus = Math.min(beatAfter(ctx.audio, ctx.start + 0.7, 0), ctx.start + 1.3);
    cap.writeFrom(this.tFocus + 0.15, 2);
  }

  private ropeY(x: number, t: number) {
    const u = (x - W / 2) / ROPE_HALF;
    return this.yTop + this.sag * (1 + 0.04 * Math.sin(t * 0.8)) * (1 - u * u) + 3 * Math.sin(t * 0.55 + 1.3);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const lt = t - s;
    const u = this.bg.u;
    // 鏡頭：沿著繩子從左邊滑過來（一秒多），之後很慢地推近
    const slide = ease.inOutCubic(prog(t, s, s + 1.5));
    const z = settle(lt);
    const left = this.hangs[1]!, main = this.hangs[0]!;
    // 主角相片上的畫面往焦點推一點（實體相片：1.15 倍；很小的照片少推）
    const kf = settleK(lt);
    const crop = focusCrop(main.ph.ref, main.ph.w, main.ph.h, main.ph.w / main.ph.h, kf, { zoom: 1.15, screenW: 2 * main.hw * 1.04 });
    v4(u.crop0!, crop[0], crop[1], crop[2], crop[3]);
    // 鏡頭滑到中間之後往主角的臉靠一點（沒有字時推得多一點）；字一直在畫面的安全區裡
    const [ix, iy] = focusIn(main.ph.ref, crop);
    const faceX = W / 2 + (2 * ix - 1) * main.hw, faceY = this.ropeY(W / 2, t) + 4 + main.b + main.hh * (2 * iy);
    const pull = (this.text ? 0.22 : 0.5) * kf * slide;
    let cam = {
      x: lerp(left.x + 60, W / 2, slide) + (faceX - W / 2) * pull,
      y: lerp(470, 540, slide) - 8 * z + (faceY - 540) * pull,
      z: lerp(1.12, 1, slide) + 0.04 * z + (this.text ? 0.02 : 0.1) * kf * slide,
    };
    if (this.text) {
      // 滑過來的途中字還沒出來，不用管；滑到了才把字夾進安全區（跟著 slide 漸進，鏡頭不會跳）
      const w2 = this.cap!.width / 2;
      const kept = keepIn(cam, [[W / 2 - w2, this.capTop, W / 2 + w2, CAP_BASE + 0.25 * this.cap!.size]]);
      cam = { x: lerp(cam.x, kept.x, slide), y: lerp(cam.y, kept.y, slide), z: cam.z };
    }
    (u.cam!.value as THREE.Vector3).set(cam.x, cam.y, cam.z);
    u.t!.value = t;
    (u.rope!.value as THREE.Vector3).set(this.yTop, this.sag * (1 + 0.04 * Math.sin(t * 0.8)), 3 * Math.sin(t * 0.55 + 1.3));
    // 風：每個小節線一陣（很快起來、慢慢停），剛掛上去時晃得比較大
    const bp = f.barPhase;
    const gust = (1 - Math.exp(-bp * 10)) * Math.exp(-bp * 2.2);
    const settleSwing = Math.exp(-lt / 1.4);
    // 跟焦：一開始焦點在左邊那張，之後換到主角
    const focus = ease.inOutCubic(prog(t, this.tFocus, this.tFocus + 0.5));
    const blurOf = [1 - focus, focus * 0.9, 1];
    const pvs = [u.pv0!, u.pv1!, u.pv2!], pds = [u.pd0!, u.pd1!, u.pd2!], texs = [u.ph0!, u.ph1!, u.ph2!];
    this.hangs.forEach((hg, i) => {
      const ang = (hg.amp * (1 + 1.6 * gust) + 0.07 * settleSwing * (i === 0 ? 0.6 : 1)) * Math.sin(t * hg.w + hg.phase);
      (pvs[i]!.value as THREE.Vector4).set(hg.x, this.ropeY(hg.x, t), ang, hg.b);
      const bl = blurOf[i]!;
      (pds[i]!.value as THREE.Vector4).set(hg.hw, hg.hh, mipLod(hg.ph.w * (i === 0 ? crop[2] - crop[0] : 1), 2 * hg.hw * cam.z) + 1.4 * bl, 0.008 * bl);
      texs[i]!.value = hg.ph.tex;
    });
    const cap = this.cap!;
    const capK = cap.on ? prog(t, this.tFocus, this.tFocus + 0.5, ease.outCubic) * (1 - prog(t, e - 0.3, e)) : 0;
    if (cap.on) {
      const hh = cap.height;
      (u.haze!.value as THREE.Vector4).set(W / 2, this.capTop + hh / 2, Math.min(CAP_W, cap.width) / 2 + 160, hh / 2 + 90);
    } else (u.haze!.value as THREE.Vector4).set(0, 0, 0, 0);
    u.k!.value = (0.92 + 0.08 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.1 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    if (this.text && capK > 0) {
      const L = this.text;
      const lx = W / 2 - TL_W / 2, ly = this.capTop - 30;
      if (cap.draw(L, TL_W / 2, 30, t)) L.upload();
      drawLayer(comp, renderer, L, out, lx, ly, cam, capK);
    }
    return { paper: 1, bloom: 0.15, bloomThreshold: 1.1, halation: 0.06, vignette: 0.26 };
  }
}
