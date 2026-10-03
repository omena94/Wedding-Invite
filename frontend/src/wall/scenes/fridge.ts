// 照片版面「冰箱門」（亮）：照片用磁鐵壓在不鏽鋼冰箱門上，旁邊貼著一張便利貼寫註解——
//  - 滿版不鏽鋼門板：很細的直向髮絲紋、幾條寬寬的柔和反光（窗、廚房的燈），反光跟門板有視差（鏡頭往右，反光往左滑）；
//    左邊一支直的把手（離鏡頭比較近：動得比門板多、邊緣有一點糊），上緣露一條上下門之間的縫。
//  - 照片是一張白邊相片，兩顆圓磁鐵壓在上緣兩角，微微斜；相片的亮面也映著一點點門上的反光。照片完整放不裁。
//  - 相片上的畫面往新人點的焦點（臉）慢慢推近，鏡頭也往臉那邊靠（便利貼上的字一直在畫面的安全區裡）。
//  - 主字（賓客留言＋署名，或新人的註解）手寫在便利貼上（主題色很淡的紙，上緣黏住、下緣微微翹起、影子比較遠），歌詞小一號寫在下面跟唱；
//    相簿的第一張在便利貼上面小小寫相簿名。字多時便利貼是長方形的大張（像備忘便條）。
//    沒有主字就把歌詞寫在便利貼上跟唱；兩樣都沒有就只有照片（移到正中間，沒有便利貼，鏡頭往臉推得多一點）。
//  - 進場：照片「啪」一聲貼上門（從 1.06 倍彈回、畫面極輕微震一下），磁鐵在下一拍吸上去，便利貼再下一拍貼上；
//    每個小節線有一道很淡的反光從門上掃過去。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { beatAfter } from './_motifs';
import { loadPhotos, fitIn, mipLod, Caption, P2_GLSL, settle, keepIn, v2, v4, type P2Photo } from './_p2';
import { focusCrop, focusIn, loadWords, photoWords, settleK } from './_photo';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'frame', paper: true, energy: [0.1, 1], bars: [2, 8], weight: 1, prefers: ['portrait', 'small'] };

const BG = () => new FSPass(/* glsl */ `
  ${P2_GLSL}
  uniform sampler2D photo; uniform sampler2D cap; uniform vec2 capSize; uniform vec4 crop;
  uniform vec3 cam; uniform float hx; uniform float hr;
  // 相片：中心、照片半寬高、白邊、角度、縮放（貼上來之前大一點）
  uniform vec2 pc; uniform vec2 ph; uniform float pb; uniform float pa; uniform float ps;
  // 便利貼：中心、半寬高、角度、縮放、出現的程度
  uniform vec2 nc; uniform vec2 nh; uniform float na; uniform float ns; uniform float noteOn;
  // 磁鐵：位置、半徑、出現的程度（三顆：照片兩角、一顆空的當點綴）
  uniform vec4 m0; uniform vec4 m1; uniform vec4 m2;
  uniform float sweep; uniform float lod; uniform float k;

  // 門上的反光：幾條寬寬的直帶（窗、燈），跟著鏡頭往反方向滑；上面亮一點（天花板的燈）
  float refl(vec2 p) {
    float rx = p.x - cam.x * 0.9;
    float r = 0.17 * exp(-pow((rx + 330.0) / 230.0, 2.0)) + 0.08 * exp(-pow((rx - 420.0) / 50.0, 2.0)) + 0.05 * exp(-pow((rx + 40.0) / 18.0, 2.0))
            - 0.06 * exp(-pow((rx - 120.0) / 160.0, 2.0)) + 0.05 * exp(-pow((rx + 900.0) / 300.0, 2.0));
    r += 0.06 * (1.0 - smoothstep(-200.0, 900.0, p.y));
    // 小節線上掃過去的一道斜光
    r += 0.06 * sweep * exp(-pow((p.x + 0.35 * p.y - mix(-500.0, 2600.0, 1.0 - sweep)) / 140.0, 2.0));
    return r;
  }
  vec3 magnetOver(vec3 col, vec2 p, vec4 m, vec3 mc) {
    if (m.w <= 0.0) return col;
    vec2 d = p - m.xy;
    // 影子（吸上去之前比較遠、比較淡）
    float lift = 1.0 + 2.0 * (1.0 - m.w);
    col *= 1.0 - 0.34 * m.w / lift * exp(-max(length(d - vec2(4.0, 7.0) * lift) - m.z * 0.92, 0.0) / (5.0 * lift));
    float r = length(d);
    float a = (1.0 - smoothstep(m.z - 1.0, m.z + 0.6, r)) * m.w;
    if (a > 0.0) {
      // 扁圓柱：頂面平、邊緣一圈斜角（左上亮、右下暗）
      vec2 n = d / max(r, 1e-3);
      float rim = smoothstep(m.z - 6.0, m.z - 1.0, r);
      float lit = 1.0 + rim * 0.35 * dot(n, normalize(vec2(-1.0, -1.2)));
      vec3 c = mc * (0.92 + 0.08 * (1.0 - r / m.z)) * lit;
      // 頂面的一點光澤（很淡，不發光）
      c += C_BONE * 0.07 * exp(-dot(d + m.z * vec2(0.35, 0.4), d + m.z * vec2(0.35, 0.4)) / (m.z * m.z * 0.18));
      col = mix(col, c, a);
    }
    return col;
  }

  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = cam.xy + (sp - vec2(${W / 2}.0, ${H / 2}.0)) / cam.z;
    // ---- 不鏽鋼門板：中性灰、很細的直向髮絲紋
    vec3 steel = mix(C_ASH, C_BONE, 0.42) * 0.6;
    float hair = snoise(vec2(p.x / 2.6, p.y / 260.0)) * 0.6 + snoise(vec2(p.x / 7.0, p.y / 500.0 + 3.0)) * 0.4;
    float rf = refl(p);
    vec3 col = steel * (0.96 + 0.025 * hair) + mix(C_BONE, C_ASH, 0.3) * rf;
    // 光從左上：右下慢慢暗一點
    col *= 0.94 + 0.08 * (1.0 - smoothstep(0.0, 2600.0, p.x * 0.6 + p.y));
    // 上下門之間的縫（畫面上緣）：一條暗縫、下面一道亮邊
    col *= 1.0 - 0.6 * (1.0 - smoothstep(2.0, 5.0, abs(p.y - 22.0)));
    col += C_BONE * 0.06 * exp(-max(p.y - 27.0, 0.0) / 3.0) * step(25.0, p.y);
    col *= 0.86 + 0.14 * step(26.0, p.y);
    // ---- 相片的影子（緊貼門板：很短、很軟）
    vec2 oh = ph + vec2(pb);
    vec2 q = rot2(pa) * (p - pc) / ps;
    float lift = 1.0 + 6.0 * (ps - 1.0);
    float ds = sdBox(q - vec2(3.0, 5.0) * lift, oh);
    col *= 1.0 - 0.3 / lift * softShadow(ds, 5.0 * lift);
    // ---- 便利貼的影子：上緣黏住，越下面翹得越高、影子越遠
    vec2 nq = rot2(na) * (p - nc) / ns;
    if (noteOn > 0.0) {
      float fy = clamp((nq.y + nh.y) / (2.0 * nh.y), 0.0, 1.0);
      float fk = fy * fy;
      float dn = sdBox(nq - vec2(3.0 + 7.0 * fk, 4.0 + 13.0 * fk), nh);
      col *= 1.0 - 0.32 * noteOn * softShadow(dn, 4.0 + 14.0 * fk);
    }
    // ---- 相片
    float dO = sdBox(q, oh);
    if (dO < 1.0) {
      float a = 1.0 - smoothstep(-0.8, 0.8, dO * ps);
      vec3 pr = C_BONE * (0.84 + 0.015 * snoise(q / 4.0));
      float di = sdBox(q, ph);
      if (di < 1.0) {
        // 相片上的畫面是照片的 crop 那一塊（往焦點推）
        vec2 uv = mix(crop.xy, crop.zw, (q + ph) / (2.0 * ph));
        pr = mix(pr, photoLin(photo, uv, lod), 1.0 - smoothstep(-0.7, 0.7, di * ps));
      }
      // 相紙的亮面也映著一點門上的反光
      pr += mix(C_BONE, C_ASH, 0.3) * 0.18 * max(rf, 0.0);
      col = mix(col, pr, a);
    }
    // ---- 便利貼：上緣一條黏膠（顏色深一點點），下面翹起來迎著光；字是同一張圖層，跟著紙一起轉
    if (noteOn > 0.0) {
      float dn = sdBox(nq, nh);
      if (dn < 1.0) {
        float a = (1.0 - smoothstep(-0.8, 0.8, dn * ns)) * noteOn;
        vec3 paper = mix(C_PAPER, C_SIGNAL, 0.26) * 0.86 * (1.0 + 0.012 * snoise(nq / 3.0));
        float fy = clamp((nq.y + nh.y) / (2.0 * nh.y), 0.0, 1.0);
        paper *= 0.97 + 0.03 * smoothstep(0.0, 0.16, fy);
        paper *= 1.0 + 0.05 * smoothstep(0.35, 1.0, fy) - 0.05 * (1.0 - smoothstep(0.0, 4.0, nh.y - nq.y));
        vec4 tx = layerAt(cap, nq + nh, capSize);
        paper = paper * (1.0 - tx.a) + tx.rgb;
        col = mix(col, paper, a);
      }
    }
    col = magnetOver(col, p, m0, C_SIGNAL * 0.62 + C_INK2 * 0.2);
    col = magnetOver(col, p, m1, C_SIGNAL * 0.62 + C_INK2 * 0.2);
    col = magnetOver(col, p, m2, mix(C_GINGHAM, C_BONE, 0.15) * 0.62);
    // ---- 把手：離鏡頭近（畫面座標，動得比門板多），直的圓柱，邊緣有一點糊；右邊落一道影子在門上
    float hd = sp.x - hx;
    col *= 1.0 - 0.3 * exp(-pow(max(hd - hr * 0.6, 0.0) / 46.0, 1.5)) * step(0.0, hd);
    float ha = 1.0 - smoothstep(hr - 3.0, hr + 3.0, abs(hd));
    if (ha > 0.0) {
      float nx = clamp(hd / hr, -1.0, 1.0);
      float nz = sqrt(1.0 - nx * nx);
      // 圓柱：光從左邊來，左半亮、右半暗；一條窗的亮反光、一條暗的，邊緣一圈暗
      vec3 hcol = mix(C_ASH, C_BONE, 0.55) * (0.3 + 0.5 * max(0.0, dot(vec2(nx, nz), normalize(vec2(-0.55, 0.85)))));
      hcol += C_BONE * 0.2 * exp(-pow((nx + 0.38) / 0.1, 2.0)) + C_BONE * 0.06 * exp(-pow((nx - 0.55) / 0.08, 2.0));
      hcol *= 0.75 + 0.25 * nz;
      // 直的拉絲紋（在把手上，跟著把手走）
      hcol *= 1.0 + 0.02 * snoise(vec2(nx * 40.0, sp.y / 300.0));
      col = mix(col, hcol, ha);
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, cap: { value: null }, capSize: { value: new THREE.Vector2(1, 1) }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  cam: { value: new THREE.Vector3(W / 2, H / 2, 1) }, hx: { value: 150 }, hr: { value: 30 },
  pc: { value: new THREE.Vector2() }, ph: { value: new THREE.Vector2() }, pb: { value: 20 }, pa: { value: 0 }, ps: { value: 1 },
  nc: { value: new THREE.Vector2() }, nh: { value: new THREE.Vector2() }, na: { value: 0 }, ns: { value: 1 }, noteOn: { value: 0 },
  m0: { value: new THREE.Vector4() }, m1: { value: new THREE.Vector4() }, m2: { value: new THREE.Vector4() },
  sweep: { value: 0 }, lod: { value: 0 }, k: { value: 1 },
});

/** 便利貼的留白。 */
const PAD = 40;
/** 相片跟便利貼之間的空隙。 */
const GAP = 70;
/** 照片＋便利貼這一組可以用的範圍（左邊讓給把手）。 */
const X_MIN = 290, X_MAX = 1790;

const rot = (x: number, y: number, a: number) => ({ x: Math.cos(a) * x - Math.sin(a) * y, y: Math.sin(a) * x + Math.cos(a) * y });

export default class Fridge extends Scene {
  bg = shared('fridge.bg', BG);
  seed = Number(this.ctx.params.seed ?? 1);
  ph: P2Photo | null = null;
  cap: Caption | null = null;
  note: Layer2D | null = null;
  px = W / 2; py = H / 2; hw = 0; hh = 0; pb = 20; pa = 0;
  nx = 0; ny = 0; nw = 0; nhh = 0; na = 0;
  gx = W / 2;
  /** 點綴的那顆磁鐵（沒地方放就不放）。 */
  deco: { x: number; y: number } | null = null;
  tMag = 0; tNote = 0; capY = PAD;

  override async init() {
    const ctx = this.ctx;
    await loadText(`${ctx.params.photo?.caption ?? ''}${ctx.params.photo?.album ?? ''}`);
    await loadWords(ctx);
    [this.ph] = await loadPhotos(ctx, (x) => this.track(x), 1);
    const ph = this.ph!;
    const meas = this.track(new Layer2D(8, 8, 1, { fast: true }));
    // 寬 600：60 字的長留言在 40 px 排得進四行。只有歌詞時窄一點，長句子折成兩行，便利貼才不會是一長條、下面空一大塊
    this.cap = new Caption(ctx, meas.ctx, {
      family: F.hand(400), w: photoWords(ctx).kind === 'none' ? 460 : 600, h: 400, min: 40, max: 50, lineHeight: 1.4, maxLines: 4,
      ink: rgba('sepia', 0.9), unsung: rgba('sepia', 0.42), active: mixRgba('signal', 'sepia', 0.5), sigInk: rgba('sepia', 0.7), sigSize: 28,
      lyricSize: 46, lyricSubSize: 38,
      label: { family: F.hand(700), size: 22, color: rgba('sepia', 0.55), tracking: 4, gap: 18 },
    });
    const cap = this.cap;
    const hasNote = cap.on;
    // 便利貼：短的字是方的一張，長的字照字變長方形
    const nw = hasNote ? Math.max(360, Math.ceil(cap.width) + 2 * PAD) : 0;
    // 只有一兩行歌詞時不用湊成正方形（下面空一大塊不好看）
    const nh = hasNote ? Math.max(cap.height + 2 * PAD + 6, Math.min(nw, 400) * (cap.text.hasMain ? 1 : 0.68)) : 0;
    this.nw = nw / 2; this.nhh = nh / 2;
    const span = X_MAX - X_MIN;
    const maxOuterW = hasNote ? span - 120 - GAP - nw : span - 160, maxOuterH = hasNote ? 740 : 780;
    const pre = fitIn(ph.w, ph.h, maxOuterW - 50, maxOuterH - 50);
    this.pb = clamp(0.045 * Math.min(pre.w, pre.h), 16, 30);
    const fit = fitIn(ph.w, ph.h, maxOuterW - 2 * this.pb, maxOuterH - 2 * this.pb);
    this.hw = fit.w / 2; this.hh = fit.h / 2;
    const ow = fit.w + 2 * this.pb, oh = fit.h + 2 * this.pb;
    const groupW = hasNote ? ow + GAP + nw : ow;
    const x0 = X_MIN + (span - groupW) / 2;
    this.px = x0 + ow / 2;
    this.py = 548;
    this.gx = x0 + groupW / 2;
    const r = hash(this.seed, 7) * 2 - 1;
    this.pa = (0.8 + 1.4 * Math.abs(r)) * Math.sign(r || 1) * (Math.PI / 180);
    const au = ctx.audio;
    this.tMag = Math.min(beatAfter(au, ctx.start + 0.05, 1), ctx.start + 0.8);
    if (hasNote) {
      this.nx = x0 + ow + GAP + nw / 2;
      // 便利貼比照片的上緣低一點，最後一行字在 HUD 區上面
      this.ny = clamp(this.py - oh / 2 + 40 + nh / 2, 140 + nh / 2, 822 - nh / 2);
      this.na = -Math.sign(r || 1) * (1.5 + 1.5 * hash(this.seed, 8)) * (Math.PI / 180);
      this.capY = PAD + Math.max(0, (nh - 2 * PAD - cap.height - 6) * 0.38);
      this.note = this.track(new Layer2D(nw, nh, undefined, { fast: true }));
      this.tNote = Math.min(beatAfter(au, this.tMag + 0.05, 1), this.tMag + 0.8);
      cap.writeFrom(this.tNote + 0.3, 2);
    }
    // 點綴的磁鐵：放在便利貼上方或照片下方空著的地方
    const top = this.py - oh / 2;
    if (hasNote && this.ny - nh / 2 > 250) this.deco = { x: this.nx + nw * 0.18, y: (this.ny - nh / 2) / 2 + 30 };
    else if (top > 230) this.deco = { x: this.px + ow * 0.3, y: top / 2 + 20 };
    else if (this.py + oh / 2 < 900) this.deco = { x: x0 + 60, y: this.py + oh / 2 + 70 };
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
    const crop = focusCrop(ph.ref, ph.w, ph.h, ph.w / ph.h, kf, { zoom: 1.15, screenW: 2 * this.hw * 1.05 });
    v4(u.crop!, crop[0], crop[1], crop[2], crop[3]);
    // 鏡頭：從左邊一點慢慢往右滑、推近（門上的反光往反方向滑），同時往相片上的臉靠；沒有便利貼時直接往臉推近。
    // 便利貼上的字一直在畫面的安全區裡
    const [ix, iy] = focusIn(ph.ref, crop);
    const fl = rot((2 * ix - 1) * this.hw, (2 * iy - 1) * this.hh, this.pa);
    const faceX = this.px + fl.x, faceY = this.py + fl.y;
    const pull = this.note ? 0.3 : 0.55;
    let cam = {
      x: this.gx - 70 * (1 - z) + (faceX - this.gx) * pull * kf,
      y: 540 - 10 * z + (faceY - 540) * pull * kf,
      z: 1 + 0.05 * z + (this.note ? 0.02 : 0.1) * kf,
    };
    if (this.note) cam = keepIn(cam, [[this.nx - this.nw + 16, this.ny - this.nhh + 16, this.nx + this.nw - 16, this.ny + this.nhh - 12]]);
    (u.cam!.value as THREE.Vector3).set(cam.x, cam.y, cam.z);
    // 把手離鏡頭近：動得比門板多
    u.hx!.value = 150 + (this.gx - cam.x) * 1.4;
    u.hr!.value = 34 * cam.z;
    // 照片「啪」貼上來：從 1.06 倍彈回來
    const slap = prog(t, s, s + 0.3);
    const ps = lerp(1.06, 1, ease.outBack(slap, 2.2));
    v2(u.pc!, this.px, this.py);
    v2(u.ph!, this.hw, this.hh);
    u.pb!.value = this.pb;
    u.pa!.value = this.pa;
    u.ps!.value = ps;
    u.photo!.value = ph.tex;
    u.lod!.value = mipLod(ph.w * (crop[2] - crop[0]), 2 * this.hw * cam.z);
    // 磁鐵在下一拍吸上去（從上面一點點、大一點落下來）
    const ow = this.hw + this.pb, oh = this.hh + this.pb, inset = 6;
    const mk = (tt: number) => ease.outCubic(prog(t, tt, tt + 0.16));
    const mA = mk(this.tMag), mB = mk(this.tMag + 0.08);
    const cL = rot(-ow + inset + 8, -oh + inset + 4, this.pa), cR = rot(ow - inset - 8, -oh + inset + 4, this.pa);
    (u.m0!.value as THREE.Vector4).set(this.px + cL.x, this.py + cL.y - 18 * (1 - mA), 27 * lerp(1.15, 1, mA), mA);
    (u.m1!.value as THREE.Vector4).set(this.px + cR.x, this.py + cR.y - 18 * (1 - mB), 27 * lerp(1.15, 1, mB), mB);
    const mC = mk(s + 0.4);
    if (this.deco) (u.m2!.value as THREE.Vector4).set(this.deco.x, this.deco.y - 14 * (1 - mC), 23 * lerp(1.15, 1, mC), mC);
    else (u.m2!.value as THREE.Vector4).set(0, 0, 1, 0);
    if (this.note && this.cap) {
      // 便利貼在再下一拍貼上：從斜一點、大一點的地方按上門
      const nk = ease.outCubic(prog(t, this.tNote, this.tNote + 0.3));
      v2(u.nc!, this.nx + 30 * (1 - nk), this.ny - 16 * (1 - nk));
      v2(u.nh!, this.nw, this.nhh);
      u.na!.value = this.na + 0.08 * (1 - nk);
      u.ns!.value = lerp(1.05, 1, nk);
      u.noteOn!.value = prog(t, this.tNote, this.tNote + 0.12);
      const L = this.note;
      // 字在便利貼上偏上一點（短的字不要擠在最上面一條）
      if (this.cap.draw(L, PAD, this.capY, t)) L.upload();
      u.cap!.value = L.texture;
      v2(u.capSize!, L.w, L.h);
    } else {
      // 共用的 pass 可能還指著上一個窗格（已經釋放）的圖層：清掉
      u.noteOn!.value = 0;
      u.cap!.value = null;
    }
    // 小節線上一道很淡的反光掃過去（小節的前四分之一）
    const bp = f.barPhase;
    u.sweep!.value = bp < 0.3 ? 1 - bp / 0.3 : 0;
    u.k!.value = (0.93 + 0.07 * ease.outCubic(prog(t, s, s + 0.35))) * (1 - 0.1 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    // 貼上去那一下：畫面極輕微震一下
    const kick = Math.exp(-Math.max(0, t - s - 0.05) / 0.06) * prog(t, s + 0.04, s + 0.06);
    const shake: [number, number] = [2.5 * kick * Math.sin(t * 90), 2 * kick * Math.cos(t * 77)];
    return { paper: 1, bloom: 0.15, bloomThreshold: 1.1, halation: 0.05, vignette: 0.28, shake };
  }
}
