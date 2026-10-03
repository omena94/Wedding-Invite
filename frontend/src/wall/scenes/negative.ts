// 照片版面「負片翻正」（暗）：暗暗的桌上一台看片燈箱，燈箱上放著一格剪下來的負片——
//  - 負片：反色、橘色片基，上下（直的照片是左右）兩條片緣有齒孔與片號（照片是第幾張就印第幾號，▸ 箭頭）。
//    燈箱開的時候像日光燈管一樣閃兩下才亮。
//  - 一個放大鏡（看片用的筒狀放大鏡）滑進來、停在照片的焦點附近，跟著拍子挪一挪：鏡片裡是放大的「正片」（顏色是對的），
//    鏡片比桌面高一截，所以有一點視差、邊緣有一點桶狀變形。
//  - 小節線上「翻正」：從放大鏡的位置一圈一圈擴開，整格負片變成正片（片緣也變成正片的黑），放大鏡被拿開、鏡頭再推近一點。
//  - 字寫在燈箱右邊的暗處（思源宋體，上面一行很小的片號與相簿名）：主字（賓客留言＋署名，或新人的註解）在上，
//    歌詞小一號在下面跟唱；沒有主字時歌詞自己寫在那裡。位置固定。兩個都沒有就只有燈箱（移到正中間）。
//  - 照片完整放在負片的格子裡（格子照照片的比例），很小的照片最多放大到原尺寸約 1.5 倍。
//    片子上的畫面往焦點小推；翻正之後鏡頭往片子上的焦點推（燈箱不會滑到字底下）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { beatAfter, barAfter } from './_motifs';
import { focusCrop, focusIn, loadWords, settleK } from './_photo';
import { CAM_GLSL, P1_GLSL, P1Cap, gainOf, inSafe, p1Uniforms, PlaneCam, blitAt, camUniforms, containScale, fitLabel, loadPhotos, mipFor, photoRefs, safePush, seedOf, type P1Photo } from './_p1';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'film', prefers: ['landscape'], energy: [0, 0.9], bars: [2, 8], weight: 1 };

const BG = () => new FSPass(/* glsl */ `
  ${CAM_GLSL}
  ${P1_GLSL}
  uniform sampler2D photo; uniform float lod; uniform vec4 crop;
  uniform vec2 imgHalf; uniform vec2 stripHalf; uniform vec2 boxHalf; uniform float vert;
  uniform vec3 loupe; uniform float loupeR; uniform float loupeOn; uniform float mag;
  uniform vec3 flip; uniform float glow; uniform float k; uniform float focusZ;
  uniform sampler2D edge; uniform vec2 edgeSize;

  // 片子上一點（世界座標，片子中心是原點）→ 顏色。pos：這一點是不是已經翻成正片（0..1）
  vec3 film(vec2 q, float pos, float l) {
    // 片子座標：u 沿著片子走、v 是橫過片子（直的照片片子是直的）
    vec2 s = vert > 0.5 ? vec2(q.y, -q.x) : q;
    vec2 ih = vert > 0.5 ? imgHalf.yx : imgHalf;
    vec2 sh = vert > 0.5 ? stripHalf.yx : stripHalf;
    vec3 back = C_BONE * 0.3;
    if (abs(s.x) > sh.x || abs(s.y) > sh.y) return back;   // 片子外面：燈箱
    vec3 mask = toLinear(vec3(0.96, 0.62, 0.36));            // 負片的橘色片基
    vec3 neg = mask * 0.92;
    vec3 posC = vec3(0.025);                                 // 正片沒曝光的地方是黑的
    // 齒孔（片緣中間一排，光從孔裡透出來）
    float rb = sh.y - ih.y;                                  // 片緣寬
    if (abs(s.y) > ih.y + rb * 0.12) {
      float pitch = ih.y * 2.0 * 0.198;
      float u = mod(s.x + pitch * 0.5, pitch) - pitch * 0.5;
      float vy = abs(s.y) - (ih.y + rb * 0.6);
      float hole = sdRound(vec2(u, vy), vec2(pitch * 0.27, rb * 0.17), rb * 0.05);
      if (hole < 0.0) return back;
      // 片號（只在下面那條片緣）
      if (s.y > 0.0 && vy < 0.0) {
        vec4 tx = layerAt(edge, vec2(s.x + edgeSize.x * 0.5, s.y - ih.y - rb * 0.24 + edgeSize.y * 0.5) / edgeSize);
        neg = mix(neg, mask * 0.45, tx.a);
        posC = mix(posC, vec3(0.3, 0.22, 0.12), tx.a * 0.8);
      }
      return C_BONE * mix(neg, posC, pos);
    }
    // 格子之間的空隙
    if (abs(s.x) > ih.x) return C_BONE * mix(neg, posC, pos);
    // 片子上的畫面往焦點小推：格子對應到照片的 crop 那一塊
    vec2 uv = crop.xy + (q + imgHalf) / (2.0 * imgHalf) * (crop.zw - crop.xy);
    vec3 ph = photoLin(photo, uv, l + log2(max(crop.z - crop.x, 1e-3)));
    vec3 srgbInv = 1.0 - toSRGB(ph);
    vec3 n = mask * toLinear(0.1 + 0.88 * srgbInv);
    return C_BONE * mix(n, ph * 0.86, pos);
  }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 hit = camHit(p, 0.0);
    vec2 q = hit.xy;
    float pxw = hit.z / camFocal;
    float blur = abs(hit.z - focusZ) / focusZ;
    float aa = pxw * (1.0 + 20.0 * blur);
    float l0 = lod + log2(max(pxw, 1e-3));
    // 桌面：很暗的木紋（細長的雜訊）
    float grain = snoise(vec2(q.x / 900.0, q.y / 18.0)) * 0.5 + 0.5;
    vec3 col = mix(C_INK, C_INK2, 0.5 + 0.4 * grain) * 0.9;
    // 燈箱外框（鋁框，靠燈的那邊被照亮）與燈箱本身
    float dBox = sdRound(q, boxHalf + 34.0, 18.0);
    float dGlass = sdRound(q, boxHalf, 6.0);
    // 燈箱的光溢到桌面上
    col += C_BONE * 0.05 * k * exp(-max(dBox, 0.0) / 160.0);
    if (dBox < aa) {
      vec3 fr = mix(C_GRAPHITE * 0.5, C_ASH * 0.35, smoothstep(34.0, 4.0, -dGlass)) * (0.6 + 0.4 * k);
      col = mix(col, fr, 1.0 - smoothstep(-aa, aa, dBox));
    }
    float pos = clamp((flip.z - length(q - flip.xy)) / 60.0, 0.0, 1.0);
    if (dGlass < aa) {
      // 片子在燈箱上（負片或正片）；燈箱的毛玻璃中間亮一點
      vec3 c = film(q, pos, l0);
      c *= (0.86 + 0.14 * exp(-dot(q / boxHalf, q / boxHalf) * 0.8)) * k;
      // 片子的影子（很淡，片子貼在玻璃上）
      // 翻正的那一圈：很細的一道訊號色（拍點的感覺）
      float ring = exp(-pow((length(q - flip.xy) - flip.z) / 10.0, 2.0)) * glow;
      c += C_SIGNAL * 0.5 * ring * step(0.5, float(abs(q.x) < stripHalf.x + 1.0 && abs(q.y) < stripHalf.y + 1.0));
      col = mix(col, c, 1.0 - smoothstep(-aa, aa, dGlass));
    }
    // 放大鏡：鏡筒的頂在 z = loupe.z（比片子高，所以有視差），鏡片裡是放大的正片
    if (loupeOn > 0.0) {
      // 放大鏡在燈箱上的影子（往右下，很軟）
      float dsh = length(q - loupe.xy - vec2(18.0, 26.0)) - loupeR - 26.0;
      col *= 1.0 - 0.35 * loupeOn * exp(-max(dsh, 0.0) / 30.0);
      vec3 top = camHit(p, loupe.z);
      vec2 lq = top.xy - loupe.xy;
      float r = length(lq);
      float body = r - loupeR;
      if (body < 28.0) {
        vec3 lc;
        if (body < 0.0) {
          // 桶狀變形＋放大：鏡片中心放大 mag 倍，邊緣再多一點
          float rr = r / loupeR;
          vec2 src = loupe.xy + lq / mag * (1.0 - 0.12 * rr * rr);
          vec3 fc = film(src, 1.0, l0 - log2(mag));
          // 鏡片邊緣一點點色散與暗角
          fc *= 1.0 - 0.35 * smoothstep(0.75, 1.0, rr);
          fc.r *= 1.0 + 0.04 * rr * rr; fc.b *= 1.0 - 0.04 * rr * rr;
          // 鏡片表面的反光（左上一道弧）
          float hl = smoothstep(0.6, 0.0, abs(rr - 0.82)) * smoothstep(0.2, -0.8, dot(normalize(lq + 1e-3), vec2(0.7, 0.7)));
          fc += C_BONE * 0.06 * hl;
          lc = fc * k;
        } else {
          // 鏡筒：黑色、上緣一圈很細的亮
          lc = C_INK2 * 1.2 + C_ASH * 0.18 * exp(-pow((body - 4.0) / 3.0, 2.0)) * (0.5 + 0.5 * dot(normalize(lq + 1e-3), vec2(-0.6, -0.8)));
        }
        float a = (1.0 - smoothstep(28.0 - aa, 28.0 + aa, body)) * loupeOn;
        col = mix(col, lc, a);
      }
    }
    fragColor = vec4(col, 1.0);
  }`, {
  ...p1Uniforms(),
  photo: { value: null }, lod: { value: 0 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  imgHalf: { value: new THREE.Vector2() }, stripHalf: { value: new THREE.Vector2() }, boxHalf: { value: new THREE.Vector2() }, vert: { value: 0 },
  loupe: { value: new THREE.Vector3() }, loupeR: { value: 150 }, loupeOn: { value: 0 }, mag: { value: 1.8 },
  flip: { value: new THREE.Vector3() }, glow: { value: 0 }, k: { value: 1 }, focusZ: { value: 1600 },
  edge: { value: null }, edgeSize: { value: new THREE.Vector2(1, 1) },
  ...camUniforms(),
});

/** 字（畫面 px）：寬、整塊（主字＋署名＋歌詞）的高度上限；上面一行片號與相簿名佔 HEAD。 */
const CAP_W = 540, CAP_H = 440, HEAD = 64;
/** 說明那一欄的層：片號、相簿名、字；左右多留 20（字的軟影）。 */
const TL = { w: CAP_W + 40, h: CAP_H + HEAD + 30 };
/** 那一欄的左緣（畫面 px）：右邊留 96 的邊。 */
const COL_X = W - 96 - CAP_W - 20;

export default class Negative extends Scene {
  bg = shared('negative.bg', BG);
  txt = this.track(new Layer2D(TL.w, TL.h, undefined, { fast: true }));
  edge = this.track(new Layer2D(1200, 40, undefined, { fast: true }));
  cam = new PlaneCam();
  seed = seedOf(this.ctx);
  ph!: P1Photo;
  cap!: P1Cap;
  label = '';
  vert = false;
  hw = 0; hh = 0;
  strip = new THREE.Vector2(); box = new THREE.Vector2();
  aimX = 0;
  /** 那一欄的頂（畫面 px，位置固定）。 */
  colY = 0;
  tFlip = 0; tIn = 0;

  override async init() {
    const { start, end, audio } = this.ctx;
    const [ref] = photoRefs(this.ctx, 1);
    const num = `${ref!.n}`;
    const marks = `▸ ${num}   ${num}A ▸`;
    await loadText(`${ref!.caption}${ref!.album}${marks}No.${num}A · …`);
    await loadWords(this.ctx);
    [this.ph] = await loadPhotos(this.ctx, [ref!], (x) => this.track(x));
    const c = this.txt.ctx;
    this.cap = new P1Cap(this.ctx, c, {
      family: F.ming(500), min: 40, max: 50, w: CAP_W, h: CAP_H, lineHeight: 1.36, maxLines: 5,
      ink: rgba('bone', 0.94), unsung: rgba('bone', 0.3), sigInk: rgba('bone', 0.72), sigSize: 28,
      shadow: { color: rgba('ink', 0.8), blur: 10 },
    });
    const has = this.cap.has;
    this.label = fitLabel(c, [`No.${num}A`, ref!.chapter ? ref!.album : ''].filter(Boolean).join(' · '), F.mono(500), 20, CAP_W, 3);
    const { w, h } = this.ph;
    this.vert = h > w * 1.02;
    const s = containScale(w, h, has ? 700 : 980, has ? 580 : 640);
    this.hw = (w * s) / 2; this.hh = (h * s) / 2;
    // 片子：沿著片子方向多出一點格與格之間的空隙；橫過片子的方向加兩條片緣（35mm 大約是格高的 23%）
    const along = this.vert ? this.hh : this.hw, across = this.vert ? this.hw : this.hh;
    const gap = Math.max(26, along * 0.07), rb = Math.max(62, across * 0.36);
    if (this.vert) this.strip.set(across + rb, along + gap); else this.strip.set(along + gap, across + rb);
    this.box.set(this.strip.x + 120, this.strip.y + 96);
    // 有字：燈箱靠左，右緣離字那一欄留一點空（鏡頭往焦點推的時候燈箱才不會滑到字底下）
    if (has) {
      this.aimX = this.box.x + 34 - 260;
      for (let i = 0; i < 3; i++) {
        this.placeCam(0, 0, 1);
        const r = this.boxRect();
        const over = r[0] + r[2] - (COL_X - 130);
        if (Math.abs(over) < 4) break;
        this.aimX += over;
      }
    }
    const colH = HEAD + this.cap.height;
    this.colY = clamp(H / 2 - colH / 2 - 30, 140, 800 - colH);
    // 片號（印在下面那條片緣上，畫一次）
    const ec = this.edge.ctx;
    ec.font = font(F.mono(500), 22);
    ec.fillStyle = '#fff';
    ec.textAlign = 'center';
    ec.textBaseline = 'middle';
    ec.fillText(marks, 600 + (hash(this.seed, 5) - 0.5) * 120, 20);
    this.edge.upload();
    const len = end - start;
    this.tIn = Math.min(beatAfter(audio, start + 0.05), start + 0.5);
    this.tFlip = len < 5 ? start + len * 0.42 : Math.min(barAfter(audio, start + Math.min(len * 0.35, 4.5)), end - 1.6);
  }

  /** 燈箱（含鋁框）在畫面上的外框。 */
  private boxRect() { return this.cam.rect(-this.box.x - 34, -this.box.y - 34, 2 * this.box.x + 68, 2 * this.box.y + 68); }

  /** 片子上的畫面這時候往焦點推到哪裡（從頭慢慢推）。 */
  private cropAt(t: number) {
    return focusCrop(this.ph.ref, this.ph.w, this.ph.h, this.ph.aspect, settleK(t - this.ctx.start, 7), { zoom: 1.15, screenW: 2 * this.hw });
  }

  /** 焦點在片子上的位置（世界座標）：片子上的畫面推過之後，焦點在格子裡的位置跟著變。 */
  private focusAt(t: number): [number, number] {
    const [u, v] = focusIn(this.ph.ref, this.cropAt(t));
    return [(u - 0.5) * 2 * this.hw, (v - 0.5) * 2 * this.hh];
  }

  /**
   * 鏡頭：斜一點看著燈箱，land 是開燈時落定（0..1），flipK 是翻正之後再推近一點（0..1），
   * k 是往片子上的焦點推到哪裡（目標移向焦點、放大；有字時移得少一點）。
   */
  private placeCam(t: number, k: number, land: number, flipK = 0) {
    const dir = hash(this.seed, 2) < 0.5 ? -1 : 1, has = this.cap.has;
    const [fx, fy] = this.focusAt(t);
    const a = (has ? 0.4 : 0.8) * k;
    const dist = lerp(1900, 1720, land) - 70 * k - 90 * flipK;
    const tilt = (lerp(24, 15, land) - 3 * flipK) * (Math.PI / 180);
    this.cam.look(lerp(this.aimX + dir * 12 * flipK, fx, a), lerp(8, fy, a), dist, tilt, dir * 1.6 * (Math.PI / 180), dir * -0.6 * (Math.PI / 180))
      .zoomBy(1 + (has ? 0.25 : 0.32) * k);
  }

  /** 放大鏡停的位置：焦點附近，跟著拍子挪一挪（世界座標）。 */
  private loupeAt(t: number): [number, number] {
    const { audio, start } = this.ctx;
    const [fx, fy] = this.focusAt(t);
    const spot = (n: number): [number, number] => n < 0 ? [fx, fy] : [fx + (hash(this.seed, n, 1) - 0.5) * this.hw * 0.7, fy + (hash(this.seed, n, 2) - 0.5) * this.hh * 0.6];
    // 進場：從右上方滑進來
    const enter = ease.outCubic(prog(t, start + 0.1, this.tIn + 0.5));
    const b = Math.floor(audio.beatAt(t)), b0 = Math.floor(audio.beatAt(this.tIn));
    const n = Math.floor((b - b0) / 2);
    const tb = audio.timeOfBeat(b0 + n * 2);
    const m = ease.inOutCubic(prog(t, tb, tb + 0.45));
    const a = spot(n - 1), c = spot(n);
    const x = lerp(a[0], c[0], n >= 0 ? m : 0), y = lerp(a[1], c[1], n >= 0 ? m : 0);
    return [lerp(this.box.x + 260, x, enter), lerp(-this.box.y - 200, y, enter)];
  }

  private drawCol(t: number) {
    const L = this.txt, c = L.ctx;
    const k = prog(t, this.ctx.start + 0.5, this.ctx.start + 1.1, ease.outCubic);
    const redraw = this.cap.draw(c, t, 20, HEAD, {
      alpha: k,
      clear: () => {
        L.clear();
        c.globalAlpha = k;
        c.fillStyle = rgba('signal', 0.8);
        c.fillRect(20, 10, 40, 2);
        c.font = font(F.mono(500), 20);
        c.letterSpacing = '3px';
        c.fillStyle = rgba('ash', 0.85);
        c.fillText(this.label, 20, 42);
        c.letterSpacing = '0px';
        c.globalAlpha = 1;
      },
    });
    if (redraw) L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const u = this.bg.u;
    u.photoGain!.value = gainOf(this.ph.ref);
    // 鏡頭：斜一點看著燈箱；翻正之後再推近一點，並往片子上的焦點推（有字時燈箱的右緣不能滑到字底下）
    const flipK = ease.inOutCubic(prog(t, this.tFlip, this.tFlip + 1.4));
    const land = ease.outCubic(prog(t, s, s + 0.8));
    const fk = settleK(t - this.tFlip - 0.3, 6);
    const has = this.cap.has;
    const colRect = [COL_X, this.colY, CAP_W, HEAD + this.cap.height];
    safePush(fk, (k) => {
      this.placeCam(t, k, land, flipK);
      if (!has) return true;
      const r = this.boxRect();
      return r[0] + r[2] <= COL_X - 60 && inSafe(colRect);
    });
    this.cam.apply(u);
    u.focusZ!.value = this.cam.project(0, 0, 0).z;
    u.photo!.value = this.ph.tex;
    (u.crop!.value as THREE.Vector4).set(...this.cropAt(t));
    u.lod!.value = mipFor(this.ph.w, 2 * this.hw * (1 + 0.32 * fk));
    (u.imgHalf!.value as THREE.Vector2).set(this.hw, this.hh);
    (u.stripHalf!.value as THREE.Vector2).copy(this.strip);
    (u.boxHalf!.value as THREE.Vector2).copy(this.box);
    u.vert!.value = this.vert ? 1 : 0;
    u.edge!.value = this.edge.texture;
    (u.edgeSize!.value as THREE.Vector2).set(this.edge.w, this.edge.h);
    // 放大鏡：翻正後被拿開（往右上方滑走）
    const [lx, ly] = this.loupeAt(Math.min(t, this.tFlip));
    const away = ease.inCubic(prog(t, this.tFlip + 0.25, this.tFlip + 0.95));
    (u.loupe!.value as THREE.Vector3).set(lx + away * 700, ly - away * 500, 70 + 60 * away);
    u.loupeR!.value = clamp(Math.min(this.hw, this.hh) * 0.42, 110, 170);
    u.loupeOn!.value = prog(t, s + 0.05, s + 0.3) * (1 - prog(t, this.tFlip + 0.7, this.tFlip + 1.0));
    u.mag!.value = 1.8;
    // 翻正：從放大鏡那裡擴開
    const [fx0, fy0] = this.loupeAt(this.tFlip);
    const reach = Math.hypot(this.strip.x + Math.abs(fx0), this.strip.y + Math.abs(fy0)) + 80;
    (u.flip!.value as THREE.Vector3).set(fx0, fy0, reach * ease.inOutCubic(prog(t, this.tFlip, this.tFlip + 0.95)));
    u.glow!.value = prog(t, this.tFlip, this.tFlip + 0.1) * (1 - prog(t, this.tFlip + 0.6, this.tFlip + 1.0));
    // 燈箱開燈：像日光燈管一樣閃兩下才亮；最後零點三秒稍微收暗
    const lt = t - s;
    const fl = lt < 0.06 ? 0.15 : lt < 0.12 ? 0.75 : lt < 0.2 ? 0.25 : 0.4 + 0.6 * ease.outCubic(prog(t, s + 0.2, s + 0.45));
    u.k!.value = fl * (1 - 0.15 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    if (has) {
      // 字在燈箱右邊的暗處（位置固定，不跟著透視變形）
      this.drawCol(t);
      blitAt(comp, renderer, this.txt, out, COL_X - 20, this.colY, 1 - prog(t, e - 0.3, e));
    }
    return { bloom: 0.15, bloomThreshold: 1.1, halation: 0.12, vignette: 0.55 };
  }
}
