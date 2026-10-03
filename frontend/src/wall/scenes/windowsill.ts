// 照片版面「窗台」（亮）：照片靠在窗台上，背後是午後的窗——
//  - 白漆的窗框（中間一根直窗櫺、上面一根橫的），窗外是糊掉的天空與樹（景深），鏡頭動時窗外動得比窗框少（很遠）。
//  - 一張白邊相片放在窗台上、往後靠著玻璃（透視：上緣比較遠）；切進來時像剛放下去，從直立往後倒、輕輕彈一下才靠穩。
//  - 逆光：相片上緣有一道亮邊，窗台上有窗格照進來的光與相片往前落的影子；太陽很慢地移，窗櫺的影子在窗台上跟著斜過去。
//  - 窗的左邊掛著一片紗簾，皺褶隨風很慢地飄，小節線上被風吹一下；光裡有幾顆慢慢飄的灰塵。
//  - 相片上的畫面往新人點的焦點（臉）慢慢推近，鏡頭也往臉那邊靠一點（字一直在畫面的安全區裡）。
//  - 主字（賓客留言＋署名，或新人的註解）寫在窗戶右邊的牆上（思源宋體，像牆上的字），歌詞小一號寫在下面跟唱；
//    沒有主字就把歌詞寫在同一個位置跟唱；兩樣都沒有就沒有字，窗戶移到正中間、鏡頭往臉推得多一點。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { loadPhotos, fitIn, mipLod, Caption, P2_GLSL, settle, keepIn, drawLayer, v2, v4, type P2Photo } from './_p2';
import { focusCrop, focusIn, loadWords, settleK } from './_photo';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'frame', paper: true, energy: [0, 0.7], bars: [2, 8], weight: 1, prefers: ['portrait', 'square'] };

/** 窗台：玻璃底（後緣）、前緣（台面在畫面上的深度）、前面那條邊的厚度；相片底站的位置。 */
const SILL = 690, SILL_D = 72, NOSE = 26, PB = 744;
/** 橫窗櫺的高度。 */
const TRANSOM = 210;

const BG = () => new FSPass(/* glsl */ `
  ${P2_GLSL}
  uniform sampler2D photo; uniform vec4 crop;
  uniform vec3 cam; uniform vec2 camRef;
  // 窗：左、右（窗框外緣）；相片：中心 x、底 y、外框半寬、外框半高；白邊寬、往後靠的角度
  uniform vec2 win; uniform vec4 ph; uniform float border; uniform float lean;
  uniform float lod; uniform float t; uniform float light; uniform float gust; uniform float sunX; uniform float k;

  // 窗外（很遠、很糊）：天空、樹叢、幾顆光斑
  vec3 outside(vec2 o) {
    float h = clamp((o.y + 60.0) / ${SILL + 60}.0, 0.0, 1.0);
    vec3 sky = mix(mix(C_BONE, C_ASH, 0.08) * 0.88, mix(C_BONE, C_FUR, 0.12) * 0.86, h);
    float tr = smoothstep(-0.3, 0.45, fbm(o / vec2(520.0, 380.0) + vec2(3.1, 0.0), 2) + (h - 0.6) * 1.5);
    vec3 trees = mix(mix(C_GINGHAM, C_SEPIA, 0.35) * 0.42, mix(C_GINGHAM, C_BONE, 0.4) * 0.7, 0.5 + 0.6 * fbm(o / 240.0, 2));
    vec3 c = mix(sky, trees, tr * 0.8);
    // 樹葉縫裡的光斑（焦外的圓）
    vec2 g = floor(o / 130.0), f = o - g * 130.0;
    vec2 hh = hash22(g);
    float b = 1.0 - smoothstep(18.0 + 14.0 * hh.x, 24.0 + 14.0 * hh.x, length(f - 30.0 - 70.0 * hh));
    c = mix(c, mix(C_BONE, C_FUR, 0.12) * 0.84, b * step(0.55, hh.y) * tr * 0.7);
    return c;
  }

  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = cam.xy + (sp - vec2(${W / 2}.0, ${H / 2}.0)) / cam.z;
    vec3 warm = mix(C_BONE, C_FUR, 0.14);
    float x0 = win.x, x1 = win.y, xm = (x0 + x1) * 0.5;
    // ---- 牆：靠窗的地方被反光照亮一點
    vec3 col = mix(C_PAPER, C_FUR, 0.06) * 0.44 * (1.0 + 0.012 * snoise(p / vec2(3.0, 8.0)));
    float dw = length(max(vec2(max(x0 - p.x, p.x - x1), p.y - ${SILL}.0), 0.0));
    col += warm * 0.1 * exp(-dw / 300.0) * light;
    col *= 1.0 - 0.14 * smoothstep(300.0, 1300.0, dw);
    // ---- 窗（窗框外緣 x0..x1，上面超出畫面，下緣是窗台）
    float CAS = 44.0, MUL = 13.0;
    if (p.x > x0 && p.x < x1 && p.y < ${SILL}.0) {
      vec2 o = p + (cam.xy - camRef) * 0.55;
      vec3 c = outside(o) * (0.75 + 0.25 * light);
      // 窗櫺（中間直的、上面橫的）與窗框：白漆，朝房間那面在背光裡，暗一點；邊緣一道亮光（逆光）
      float dx = min(p.x - x0, x1 - p.x);
      float mul = min(abs(p.x - xm) - MUL * 0.5, abs(p.y - ${TRANSOM}.0) - MUL * 0.5);
      float wood = max(1.0 - smoothstep(CAS - 1.0, CAS + 0.5, dx), 1.0 - smoothstep(-0.5, 1.0, mul));
      vec3 paint = mix(C_PAPER, C_BONE, 0.4) * (0.5 + 0.06 * smoothstep(0.0, CAS, dx));
      // 朝玻璃的那一緣被窗外的光打亮（逆光的亮邊）
      paint += C_BONE * 0.2 * light * max((1.0 - smoothstep(0.0, 4.0, CAS - dx)) * step(dx, CAS), 1.0 - smoothstep(MUL * 0.5 - 3.0, MUL * 0.5, min(abs(p.x - xm), abs(p.y - ${TRANSOM}.0))));
      // 窗框內緣一圈影子（窗洞的深度）
      c *= 1.0 - 0.3 * exp(-max(dx - CAS, 0.0) / 10.0);
      c = mix(c, paint, wood);
      // ---- 紗簾：窗的左邊三分之一，半透明的直皺褶，隨風飄
      float cx1 = x0 + (x1 - x0) * 0.34 + 18.0 * sin(t * 0.5 + p.y / 260.0) + 22.0 * gust * (p.y / ${SILL}.0);
      if (p.x < cx1) {
        float ph1 = (p.x - x0) / 34.0 + 1.3 * sin(p.y / 310.0 + t * 0.45) + 0.8 * gust * (p.y / ${SILL}.0);
        float dens = 0.62 + 0.24 * sin(ph1) + 0.08 * sin(ph1 * 2.3 + 1.0);
        float edge = smoothstep(cx1, cx1 - 24.0, p.x);
        // 紗簾的下襬：一條比較密的縫邊
        float hem = 1.0 - smoothstep(10.0, 14.0, abs(p.y - ${SILL - 34}.0));
        vec3 voile = mix(C_BONE, C_PAPER, 0.3) * (0.7 + 0.14 * light) * (0.88 + 0.12 * sin(ph1));
        c = mix(c, voile, clamp(dens * edge * 0.9 + hem * edge * 0.3, 0.0, 0.95));
        c *= 1.0 - 0.1 * (1.0 - smoothstep(0.0, 6.0, cx1 - p.x)) * step(p.x, cx1);
      }
      col = c;
    }
    // ---- 窗台：台面（往前看得到一點，越近越寬）、前緣、下面的牆
    float sy = p.y - ${SILL}.0;
    float wid = 40.0 + min(sy, ${SILL_D}.0) * 0.32;
    if (sy > 0.0 && p.x > x0 - wid && p.x < x1 + wid) {
      if (sy < ${SILL_D}.0) {
        float d = sy / ${SILL_D}.0;
        vec3 top = mix(C_PAPER, C_BONE, 0.4) * 0.52;
        // 窗格照進來的光：窗洞裡的光往前打在台面上，中間那根窗櫺的影子隨太陽斜過去
        float inWin = smoothstep(x0 + 30.0, x0 + 70.0, p.x) * smoothstep(x1 - 30.0, x1 - 70.0, p.x);
        float mx = xm + (sunX - 0.5) * 260.0 * d;
        float mshade = 1.0 - smoothstep(6.0 + 10.0 * d, 14.0 + 22.0 * d, abs(p.x - mx));
        // 紗簾的影子：左邊的光比較軟、比較暗，跟著紗簾飄
        float curt = smoothstep(x0 + (x1 - x0) * 0.36, x0 + (x1 - x0) * 0.2, p.x - 30.0 * sin(t * 0.5) * d) * (0.55 + 0.1 * sin(p.x / 34.0 + t * 0.45));
        float lit = inWin * (1.0 - 0.7 * mshade) * (1.0 - 0.6 * curt);
        top += warm * 0.3 * lit * light;
        // 相片往前落的影子（逆光）：相片底以前、相片寬度往前張開
        float fw = ph.z * (1.0 + 0.5 * max(p.y - ${PB}.0, 0.0) / 40.0);
        float sh = smoothstep(${PB - 6}.0, ${PB}.0, p.y) * (1.0 - smoothstep(fw - 10.0, fw + 24.0, abs(p.x - ph.x - (sunX - 0.5) * 80.0 * d)));
        top *= 1.0 - 0.38 * sh * light;
        // 玻璃底的接縫一道暗線
        top *= 1.0 - 0.3 * exp(-sy / 3.0);
        col = top;
      } else if (sy < ${SILL_D + NOSE}.0) {
        float e = (sy - ${SILL_D}.0) / ${NOSE}.0;
        col = mix(C_PAPER, C_BONE, 0.4) * (0.5 - 0.1 * e) + C_BONE * 0.08 * exp(-(sy - ${SILL_D}.0) / 2.0);
      } else {
        col *= 1.0 - 0.4 * exp(-(sy - ${SILL_D + NOSE}.0) / 26.0);
        col *= 0.8;
      }
    } else if (sy > 0.0) {
      // 窗台以外的牆：窗台的影子
      col *= 1.0 - 0.2 * exp(-max(min(abs(p.x - x0 + wid), abs(p.x - x1 - wid)), 0.0) / 30.0) * step(${SILL_D + NOSE}.0, sy) * exp(-(sy - ${SILL_D + NOSE}.0) / 60.0);
      col *= 1.0 - 0.06 * smoothstep(${SILL + 100}.0, 1080.0, p.y);
    }
    // ---- 相片：站在台面上，往後靠著玻璃（繞著底邊轉：上緣比較遠）
    vec2 s0 = p - vec2(ph.x, ${PB}.0);
    vec2 lq = pitchInv(s0, lean, 1300.0);
    vec2 q = lq + vec2(0.0, ph.w);
    vec2 oh = ph.zw;
    float dO = sdBox(q, oh);
    if (dO < 1.0) {
      float a = 1.0 - smoothstep(-0.8, 0.8, dO);
      // 相片的白邊：在背光裡，朝房間那面靠房間的光；上緣與兩側一道逆光的亮邊
      vec3 pr = C_BONE * 0.74;
      vec2 hi = oh - vec2(border);
      float di = sdBox(q, hi);
      if (di < 0.8) {
        // 相片上的畫面是照片的 crop 那一塊（往焦點推）
        vec2 uv = mix(crop.xy, crop.zw, (q + hi) / (2.0 * hi));
        vec3 pc = photoLin(photo, uv, lod) * 0.95;
        pr = mix(pr, pc, 1.0 - smoothstep(-0.7, 0.7, di));
      }
      // 越往上越亮一點（窗光從後面繞過來）
      pr *= 0.94 + 0.08 * smoothstep(oh.y, -oh.y, q.y) * light;
      float rim = exp(-(q.y + oh.y) / 2.5) + 0.5 * exp(-(oh.x - abs(q.x)) / 2.0) * smoothstep(0.0, -oh.y, q.y);
      pr += C_BONE * 0.22 * rim * light;
      col = mix(col, pr, a);
    }
    // ---- 光裡的灰塵：在窗前慢慢飄（只在窗洞裡、很淡）
    if (p.x > x0 && p.x < x1 && p.y < ${SILL}.0) {
      float dust = 0.0;
      for (int i = 0; i < 14; i++) {
        float fi = float(i);
        vec2 hh = hash22(vec2(fi, 7.0));
        vec2 dp = vec2(mix(x0 + 80.0, x1 - 80.0, hh.x) + 40.0 * sin(t * 0.21 + fi * 1.7), mod(hh.y * ${SILL}.0 - t * (6.0 + 5.0 * hh.x), ${SILL}.0));
        dust += (1.0 - smoothstep(1.0, 3.2 + 2.0 * hh.y, length(p - dp))) * (0.5 + 0.5 * sin(t * 1.3 + fi));
      }
      col += C_BONE * 0.08 * dust * light;
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, cam: { value: new THREE.Vector3(W / 2, H / 2, 1) }, camRef: { value: new THREE.Vector2(W / 2, H / 2) },
  win: { value: new THREE.Vector2() }, ph: { value: new THREE.Vector4() }, border: { value: 20 }, lean: { value: 0 },
  lod: { value: 0 }, t: { value: 0 }, light: { value: 1 }, gust: { value: 0 }, sunX: { value: 0.5 }, k: { value: 1 },
});

/** 右邊牆上的字。寬 600：60 字的長留言在 40 px 排得進四行。 */
const COL_W = 600, COL_H = 420;

export default class Windowsill extends Scene {
  bg = shared('windowsill.bg', BG);
  seed = Number(this.ctx.params.seed ?? 1);
  ph: P2Photo | null = null;
  cap: Caption | null = null;
  text: Layer2D | null = null;
  x0 = 0; x1 = 0; px = W / 2; ohw = 0; ohh = 0; border = 20;
  colX = 0; colY = 0;
  gx = W / 2;

  override async init() {
    const ctx = this.ctx;
    await loadText(`${ctx.params.photo?.caption ?? ''}${ctx.params.photo?.album ?? ''}`);
    await loadWords(ctx);
    [this.ph] = await loadPhotos(ctx, (x) => this.track(x), 1);
    const ph = this.ph!;
    const meas = this.track(new Layer2D(8, 8, 1, { fast: true }));
    this.cap = new Caption(ctx, meas.ctx, {
      family: F.ming(400), w: COL_W, h: COL_H, min: 40, max: 50, lineHeight: 1.46, maxLines: 4,
      ink: rgba('sepia', 0.9), unsung: rgba('sepia', 0.42), active: mixRgba('signal', 'sepia', 0.45), sigInk: rgba('sepia', 0.7), sigSize: 28,
      lyricSize: 46, lyricSubSize: 38,
      label: { family: F.hei(500), size: 20, color: rgba('sepia', 0.55), tracking: 6, gap: 22 },
    });
    const cap = this.cap;
    // 窗戶：有字時靠左（右邊的牆寫字，字最寬 600），沒有字時在正中間
    if (cap.on) { this.x0 = 130; this.x1 = 1060; } else { this.x0 = 400; this.x1 = 1520; }
    const winW = this.x1 - this.x0;
    // 相片（含白邊）：站在台面上，頂端離畫面上緣至少 120
    const maxH = PB - 130, maxW = Math.min(cap.on ? 680 : 780, winW - 200);
    const pre = fitIn(ph.w, ph.h, maxW - 40, maxH - 40);
    this.border = clamp(0.05 * Math.min(pre.w, pre.h), 14, 30);
    const fit = fitIn(ph.w, ph.h, maxW - 2 * this.border, maxH - 2 * this.border);
    this.ohw = fit.w / 2 + this.border; this.ohh = fit.h / 2 + this.border;
    // 放在中間那根窗櫺偏右一點（不要剛好把窗櫺擋成對稱）
    const dir = hash(this.seed, 5) < 0.5 ? 1 : -1;
    this.px = (this.x0 + this.x1) / 2 + dir * Math.min(60, (winW - 2 * this.ohw) / 2 - 60);
    if (cap.on) {
      this.colX = this.x1 + 90;
      const blockH = cap.height;
      this.colY = clamp(430 - blockH / 2, 150, 770 - blockH);
      this.text = this.track(new Layer2D(COL_W + 40, Math.ceil(blockH + 50), undefined, { fast: true }));
      this.gx = (this.x0 + this.colX + COL_W) / 2;
    } else this.gx = W / 2;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const lt = t - s;
    const ph = this.ph!;
    const u = this.bg.u;
    const z = settle(lt);
    const dir = hash(this.seed, 3) < 0.5 ? 1 : -1;
    // 相片上的畫面往焦點推一點（實體相片：1.15 倍；很小的照片少推）
    const kf = settleK(lt);
    const hw = this.ohw - this.border, hh = this.ohh - this.border;
    const crop = focusCrop(ph.ref, ph.w, ph.h, ph.w / ph.h, kf, { zoom: 1.15, screenW: 2 * hw * 1.05 });
    v4(u.crop!, crop[0], crop[1], crop[2], crop[3]);
    // 鏡頭：很慢地推近、往旁邊滑一點（窗外動得比窗框少，看得出遠近），同時往相片上的臉靠；沒有字時直接往臉推近。
    // 牆上的字一直在畫面的安全區裡
    const [ix, iy] = focusIn(ph.ref, crop);
    const faceX = this.px + (2 * ix - 1) * hw, faceY = PB - this.ohh + (2 * iy - 1) * hh * Math.cos(0.2);
    const pull = this.text ? 0.28 : 0.5;
    let cam = {
      x: this.gx + dir * 40 * (z - 0.5) + (faceX - this.gx) * pull * kf,
      y: 494 - 10 * z + (faceY - 494) * pull * kf,
      z: 1 + 0.05 * z + (this.text ? 0.02 : 0.1) * kf,
    };
    if (this.text && this.cap) cam = keepIn(cam, [[this.colX, this.colY, this.colX + this.cap.width, this.colY + this.cap.height + 0.25 * this.cap.size]]);
    (u.cam!.value as THREE.Vector3).set(cam.x, cam.y, cam.z);
    v2(u.camRef!, this.gx, 490);
    v2(u.win!, this.x0, this.x1);
    v4(u.ph!, this.px, PB, this.ohw, this.ohh);
    u.border!.value = this.border;
    // 剛放下去：從直立往後倒、輕輕彈一下才靠穩
    const lean = ease.outBack(prog(t, s + 0.05, s + 0.7), 2.2);
    u.lean!.value = -0.2 * lean;
    u.photo!.value = ph.tex;
    u.lod!.value = mipLod(ph.w * (crop[2] - crop[0]), 2 * hw * cam.z);
    u.t!.value = lt;
    const bp = f.barPhase;
    u.gust!.value = (1 - Math.exp(-bp * 14)) * Math.exp(-bp * 2.4);
    // 光：切進來時像太陽從雲後面出來；太陽很慢地移（窗櫺的影子在台面上斜過去）
    u.light!.value = lerp(0.6, 1, ease.inOutQuad(prog(t, s, s + 1.3)));
    u.sunX!.value = clamp(0.3 + 0.5 * settle(lt, 12) + 0.06 * hash(this.seed, 8));
    u.k!.value = (0.92 + 0.08 * ease.outCubic(prog(t, s, s + 0.5))) * (1 - 0.1 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    if (this.cap && this.text) {
      const L = this.text;
      if (this.cap.draw(L, 20, 20, t)) L.upload();
      const op = prog(t, s + 0.45, s + 1.0, ease.outCubic) * (1 - prog(t, e - 0.3, e));
      if (op > 0) drawLayer(comp, renderer, L, out, this.colX - 20, this.colY - 20, cam, op);
    }
    return { paper: 1, bloom: 0.15, bloomThreshold: 1.1, halation: 0.06, vignette: 0.3 };
  }
}
