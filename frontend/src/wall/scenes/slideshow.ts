// 照片版面「幻燈機」（暗）：暗暗的客廳，幻燈片投在立架銀幕上——
//  - 鏡頭在銀幕斜前方（銀幕有透視），前景左下角是失焦的幻燈機，鏡頭口一圈暖光；光束穿過空氣，裡面有慢慢飄的灰塵。
//  - 換片：切進來時先是空片門的一片白光、「喀嚓」黑一下，片子落進片門（影像往下一頓）、從糊對到清楚；
//    窗格最後零點二五秒再「喀嚓」黑一下（換下一張）。中間每兩個小節，片子受熱微微鼓起、焦點呼吸一下又對回來。
//  - 投出來的影像中間亮、四角暗（燈泡的熱點），片框是圓角的；直的照片就是直的幻燈片（銀幕是方的，橫直都放得下）。
//    照片完整投出來不裁，很小的舊照片最多放大到原尺寸約 1.5 倍。對焦之後投出來的畫面往焦點推（投影：focusCrop），
//    鏡頭也往銀幕上的焦點推（有字時推到銀幕快碰到字就停）。
//  - 字寫在畫面左上的暗處（思源宋體，上面一行很小的「SLIDE 第幾張」與相簿名），在光束的上方，位置固定：
//    主字（賓客留言＋署名，或新人的註解）在上，歌詞小一號在下面跟唱；沒有主字時歌詞自己寫在那裡。
//    兩個都沒有就只有銀幕（移到正中間）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { focusCrop, focusIn, loadWords, settleK } from './_photo';
import { CAM_GLSL, P1_GLSL, P1Cap, gainOf, inSafe, p1Uniforms, PlaneCam, blitAt, camUniforms, containScale, fitLabel, loadPhotos, mipFor, photoRefs, safePush, seedOf, type P1Photo } from './_p1';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'film', prefers: ['landscape', 'small'], energy: [0, 0.85], bars: [2, 8], weight: 1 };

const BG = () => new FSPass(/* glsl */ `
  ${CAM_GLSL}
  ${P1_GLSL}
  uniform sampler2D photo; uniform float lod; uniform float topLod; uniform vec4 crop;
  uniform vec2 scrHalf; uniform vec2 imgHalf; uniform vec2 imgC;
  uniform float gate; uniform float blank; uniform float blurAmt; uniform float k; uniform float t; uniform float seed;
  uniform vec2 lensS; uniform vec4 beamS; uniform float focusZ;

  vec3 slideAt(vec2 q, float l) {
    // 片框裡的影像（圓角）；片子上有一兩根灰塵與毛髮的影子
    vec2 d = q - imgC;
    float dm = sdRound(d, imgHalf, min(imgHalf.x, imgHalf.y) * 0.035);
    if (dm > 2.0) return vec3(0.0);
    vec2 uv = (d + imgHalf) / (2.0 * imgHalf);
    // 投出來的畫面往焦點推：片框對應到照片的 crop 那一塊（片子上的灰塵、毛髮照片框的位置畫，不跟著推）
    vec3 ph = photoLin(photo, crop.xy + uv * (crop.zw - crop.xy), l + log2(max(crop.z - crop.x, 1e-3))) * 0.82;
    vec2 hp = vec2(0.18 + 0.6 * hash11(seed), 0.2 + 0.5 * hash11(seed + 3.0));
    float hair = abs(sin((uv.x - hp.x) * 9.0 + 1.3) * 0.04 - (uv.y - hp.y));
    ph *= 1.0 - 0.55 * smoothstep(0.0035, 0.0, hair) * step(abs(uv.x - hp.x), 0.06);
    ph *= 1.0 - 0.6 * smoothstep(0.006, 0.0, length((uv - hp.yx) * vec2(imgHalf.x / imgHalf.y, 1.0)) - 0.004);
    // 空片門：一片白光
    ph = mix(ph, vec3(0.78, 0.74, 0.66), blank);
    return ph * (1.0 - smoothstep(-1.5, 1.5, dm));
  }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 hit = camHit(p, 0.0);
    vec2 q = hit.xy;
    float pxw = hit.z / camFocal;
    float aa = pxw * 1.2;
    // 牆：很暗的壁紙（細細的直紋），銀幕反射回來的光把附近照亮一點
    float paper = 0.9 + 0.1 * smoothstep(0.3, 0.9, abs(sin(q.x / 9.0))) * (0.6 + 0.4 * snoise(q / 300.0));
    vec3 col = mix(C_INK, C_INK2, 0.7) * paper * 0.85;
    vec3 avg = toLinear(textureLod(photo, vec2(0.5), topLod).rgb);
    float bounce = exp(-max(sdBox(q - imgC, imgHalf), 0.0) / 260.0) * gate;
    col += mix(vec3(0.7), avg, 0.6) * 0.012 * bounce;
    // 銀幕：黑邊、白色的布面（很細的珠面顆粒），立架的柱子在後面
    float pole = abs(q.x) - 7.0;
    if (pole < 0.0 && q.y > scrHalf.y) col = mix(col, C_GRAPHITE * 0.25, 1.0 - smoothstep(-aa, aa, pole));
    float dS = sdBox(q, scrHalf + vec2(14.0, 14.0));
    // 銀幕在牆上的影子（往右下，很軟）
    col *= 1.0 - 0.45 * exp(-max(sdBox(q - vec2(16.0, 22.0), scrHalf + 14.0), 0.0) / 30.0);
    if (dS < aa) {
      float inner = sdBox(q, scrHalf);
      vec3 sc = C_INK2 * 0.8;
      if (inner < aa) {
        float bead = 0.97 + 0.03 * hash12(floor(q / max(pxw, 1.0)));
        vec3 cloth = C_BONE * 0.012 * bead + mix(vec3(0.7), avg, 0.6) * 0.012 * gate;
        // 投影：中間亮、四角暗（燈泡的熱點）；離焦時取高一點的 mip 層再加四點散開
        vec2 dd = (q - imgC) / imgHalf;
        float hot = 1.0 - 0.32 * dot(dd, dd) * 0.5;
        float l = lod + log2(max(pxw, 1e-3)) + blurAmt * 3.5;
        vec3 img = slideAt(q, l);
        if (blurAmt > 0.02) {
          float r = blurAmt * 26.0;
          img = img * 0.4 + 0.15 * (slideAt(q + vec2(r, 0.0), l) + slideAt(q - vec2(r, 0.0), l) + slideAt(q + vec2(0.0, r), l) + slideAt(q - vec2(0.0, r), l));
        }
        cloth += img * bead * hot * gate;
        sc = mix(sc, cloth, 1.0 - smoothstep(-aa, aa, inner));
      }
      col = mix(col, sc, 1.0 - smoothstep(-aa, aa, dS));
    }
    // 光束：從鏡頭口往銀幕散開的一個錐（畫面座標），越靠近鏡頭越濃；裡面有慢慢飄的灰塵
    vec2 axis = beamS.xy - lensS;
    float s = dot(p - lensS, axis) / dot(axis, axis);
    if (s > 0.0 && s < 1.0) {
      vec2 perp = normalize(vec2(-axis.y, axis.x));
      float off = abs(dot(p - lensS, perp));
      float halfW = 12.0 + s * beamS.z;
      float inB = 1.0 - smoothstep(halfW * 0.7, halfW, off);
      float haze = (0.5 + 0.5 * fbm(p / 140.0 + vec2(t * 0.05, -t * 0.03), 3));
      vec3 beamC = mix(vec3(0.8, 0.76, 0.68), avg * 1.4, 0.4);
      col += beamC * inB * gate * (0.02 + 0.09 * (1.0 - s) * (1.0 - s)) * haze;
      // 灰塵：畫面上的格子，每格一顆，慢慢飄；在光裡才看得到
      vec2 cell = floor(p / 46.0);
      vec2 rnd = hash22(cell + seed);
      vec2 dp = (cell + 0.5 + (rnd - 0.5) * 0.7) * 46.0 + vec2(sin(t * 0.4 + rnd.x * 6.0), cos(t * 0.3 + rnd.y * 6.0)) * 14.0;
      float tw = 0.5 + 0.5 * sin(t * (1.0 + rnd.y * 2.0) + rnd.x * 9.0);
      float mote = smoothstep(2.2, 0.0, length(p - dp)) * step(0.62, rnd.x) * tw;
      col += beamC * 0.32 * mote * inB * gate * (1.0 - s * 0.7);
    }
    // 前景：失焦的幻燈機（左下角一團暗）與鏡頭口的光（柔軟的圓，不發光）
    // 鏡頭口有一部分在畫面外（很近、很糊）：一圈柔軟的光斑，外緣稍微亮、帶一點色散
    vec2 lo = p - lensS;
    float body = sdRound(lo - vec2(-160.0, 150.0), vec2(300.0, 170.0), 140.0);
    col = mix(col, C_INK * 0.5, (1.0 - smoothstep(-80.0, 80.0, body)) * 0.9);
    float lensD = length(lo);
    float disc = 1.0 - smoothstep(70.0, 96.0, lensD);
    float rimL = exp(-pow((lensD - 84.0) / 9.0, 2.0));
    vec3 lc = vec3(0.8, 0.74, 0.62) * (0.3 + 0.06 * smoothstep(90.0, 20.0, lensD)) * disc + vec3(0.9, 0.7, 0.5) * 0.14 * rimL;
    col += lc * gate;
    col += vec3(0.85, 0.78, 0.66) * 0.08 * gate * exp(-lensD / 140.0);
    fragColor = vec4(col * k, 1.0);
  }`, {
  ...p1Uniforms(),
  photo: { value: null }, lod: { value: 0 }, topLod: { value: 10 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  scrHalf: { value: new THREE.Vector2() }, imgHalf: { value: new THREE.Vector2() }, imgC: { value: new THREE.Vector2() },
  gate: { value: 1 }, blank: { value: 0 }, blurAmt: { value: 0 }, k: { value: 1 }, t: { value: 0 }, seed: { value: 0 },
  lensS: { value: new THREE.Vector2() }, beamS: { value: new THREE.Vector4() }, focusZ: { value: 1700 },
  ...camUniforms(),
});

/** 字（畫面 px）：寬、整塊（主字＋署名＋歌詞）的高度上限；上面一行「SLIDE 第幾張」佔 HEAD。 */
const CAP_W = 540, CAP_H = 440, HEAD = 64;
const TL = { w: CAP_W + 40, h: CAP_H + HEAD + 30 };
/** 那一欄的左緣（畫面 px）。 */
const COL_X = 130;

export default class Slideshow extends Scene {
  bg = shared('slideshow.bg', BG);
  txt = this.track(new Layer2D(TL.w, TL.h, undefined, { fast: true }));
  cam = new PlaneCam();
  seed = seedOf(this.ctx);
  ph!: P1Photo;
  cap!: P1Cap;
  label = '';
  scr = new THREE.Vector2(); img = new THREE.Vector2();
  aimX = 0;
  /** 那一欄的頂（畫面 px，位置固定）。 */
  colY = 140;
  tSlide = 0;

  override async init() {
    const { start, end } = this.ctx;
    const [ref] = photoRefs(this.ctx, 1);
    const lab = [`SLIDE ${String(ref!.n).padStart(2, '0')}`, ref!.chapter ? ref!.album : ''].filter(Boolean).join(' · ');
    await loadText(`${ref!.caption}${ref!.album}${lab}…`);
    await loadWords(this.ctx);
    [this.ph] = await loadPhotos(this.ctx, [ref!], (x) => this.track(x));
    const c = this.txt.ctx;
    this.cap = new P1Cap(this.ctx, c, {
      family: F.ming(500), min: 40, max: 50, w: CAP_W, h: CAP_H, lineHeight: 1.36, maxLines: 5,
      ink: rgba('bone', 0.94), unsung: rgba('bone', 0.3), sigInk: rgba('bone', 0.72), sigSize: 28,
      shadow: { color: rgba('ink', 0.8), blur: 10 },
    });
    this.label = fitLabel(c, lab, F.mono(500), 20, CAP_W, 3);
    const has = this.cap.has;
    // 銀幕（接近方形，橫的直的幻燈片都放得下）；影像在銀幕裡、留一點邊
    this.scr.set(has ? 500 : 560, has ? 410 : 440);
    const { w, h } = this.ph;
    const s = containScale(w, h, 2 * this.scr.x - 70, 2 * this.scr.y - 70);
    this.img.set((w * s) / 2, (h * s) / 2);
    // 有字：銀幕在右邊，左上留給字（銀幕的左緣離字那一欄留一點空，鏡頭推的時候才不會碰到字）
    this.aimX = has ? -280 : 0;
    if (has) {
      for (let i = 0; i < 3; i++) {
        this.placeCam(0, 1, 0);
        const over = COL_X + CAP_W + 110 - this.scrRect()[0];
        if (Math.abs(over) < 4) break;
        this.aimX -= over;
      }
    }
    this.colY = 140;
    this.tSlide = start + Math.min(0.28, (end - start) * 0.08);
  }

  /** 銀幕（含黑邊）在畫面上的外框。 */
  private scrRect() { return this.cam.rect(-this.scr.x - 14, -this.scr.y - 14, 2 * this.scr.x + 28, 2 * this.scr.y + 28); }

  /** 投出來的畫面這時候往焦點推到哪裡（對焦之後開始推）。 */
  private cropAt(t: number) {
    return focusCrop(this.ph.ref, this.ph.w, this.ph.h, this.ph.aspect, settleK(t - this.tSlide - 0.6, 6), { zoom: 1.25, screenW: 2 * this.img.x });
  }

  /**
   * 鏡頭：在銀幕左前方（銀幕往右邊退），lt 是窗格開始後幾秒、land 是落定（0..1），
   * k 是往銀幕上的焦點推到哪裡（目標移向焦點、放大；有字時移得少一點）。
   */
  private placeCam(lt: number, land: number, k: number, t = this.ctx.start) {
    const dir = hash(this.seed, 2) < 0.5 ? -1 : 1, has = this.cap.has;
    const push = settleK(lt, 7);
    const [u, v] = focusIn(this.ph.ref, this.cropAt(t));
    const fx = (u - 0.5) * 2 * this.img.x, fy = -8 + (v - 0.5) * 2 * this.img.y;
    const a = (has ? 0.35 : 0.7) * k;
    const ez = lerp(1900, 1760, land) - 150 * push;
    this.cam.lookAt(-420 + 30 * dir * push, 70, ez, lerp(this.aimX + 10 * dir * push, fx, a), lerp(-10, fy, a), 0).zoomBy(1 + (has ? 0.22 : 0.3) * k);
    return ez;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const u = this.bg.u;
    u.photoGain!.value = gainOf(this.ph.ref);
    // 鏡頭：在銀幕左前方，一開始快、越來越慢地推近，往旁邊滑一點；對焦之後往銀幕上的焦點推
    const land = ease.outCubic(prog(t, s, s + 0.7));
    const has = this.cap.has;
    const colRect = [COL_X, this.colY, CAP_W, HEAD + this.cap.height];
    let ez = 1900;
    const k = safePush(settleK(t - this.tSlide - 0.6, 6), (kk) => {
      ez = this.placeCam(lt, land, kk, t);
      return !has || (this.scrRect()[0] >= COL_X + CAP_W + 50 && inSafe(colRect));
    });
    this.cam.apply(u);
    u.focusZ!.value = ez;
    u.photo!.value = this.ph.tex;
    (u.crop!.value as THREE.Vector4).set(...this.cropAt(t));
    // 片子落進片門：影像往下一頓（彈一下）；焦點從糊對到清楚
    const drop = prog(t, this.tSlide, this.tSlide + 0.3);
    const bounce = drop < 1 ? (1 - ease.outCubic(drop)) * -38 + Math.sin(drop * Math.PI) * 6 : 0;
    (u.imgC!.value as THREE.Vector2).set(0, -8 + bounce);
    (u.imgHalf!.value as THREE.Vector2).copy(this.img);
    (u.scrHalf!.value as THREE.Vector2).copy(this.scr);
    u.lod!.value = mipFor(this.ph.w, 2 * this.img.x * (1 + 0.3 * k));
    u.topLod!.value = Math.log2(Math.max(this.ph.w, this.ph.h));
    // 焦點：剛換片時糊；每兩個小節片子受熱鼓起、焦點呼吸一下
    let blur = 1 - ease.outCubic(prog(t, this.tSlide + 0.1, this.tSlide + 0.75));
    const b2 = Math.floor(audio.barAt(t) / 2) * 2;
    const tb = audio.timeOfBar(b2);
    if (tb > this.tSlide + 1.2 && tb < e - 0.6) blur = Math.max(blur, 0.35 * Math.sin(Math.PI * prog(t, tb, tb + 0.7)));
    u.blurAmt!.value = blur;
    // 喀嚓：開頭空片門的白光 → 黑一下 → 片子；最後零點二五秒黑一下（換下一張）
    const blank = t < s + 0.12 ? 1 : 0;
    const dark = (t >= s + 0.12 && t < this.tSlide) || t > e - 0.25;
    u.blank!.value = blank;
    u.gate!.value = dark ? 0.02 : 1;
    u.k!.value = 0.92 + 0.08 * ease.outCubic(prog(t, s, s + 0.4));
    u.t!.value = t;
    u.seed!.value = (this.seed % 97) + 0.5;
    // 光束：鏡頭口（畫面左下）→ 銀幕上影像的中心（投影到畫面）
    const lens = { x: 96, y: 1036 };
    const ic = this.cam.project(0, -8, 0);
    const ir = this.cam.rect(-this.img.x, -8 - this.img.y, 2 * this.img.x, 2 * this.img.y);
    (u.lensS!.value as THREE.Vector2).set(lens.x, lens.y);
    (u.beamS!.value as THREE.Vector4).set(ic.x, ic.y, Math.min(ir[2], ir[3]) * 0.5, 0);
    this.bg.render(renderer, out);
    if (has) {
      // 字在左上的暗處（光束上面，位置固定）
      const L = this.txt, c = L.ctx;
      const kk = prog(t, s + 0.4, s + 1.0, ease.outCubic);
      const redraw = this.cap.draw(c, t, 20, HEAD, {
        alpha: kk,
        clear: () => {
          L.clear();
          c.globalAlpha = kk;
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
      blitAt(comp, renderer, L, out, COL_X - 20, this.colY, 1 - prog(t, e - 0.3, e));
    }
    return { bloom: 0.15, bloomThreshold: 1.1, halation: 0.12, vignette: 0.55 };
  }
}
