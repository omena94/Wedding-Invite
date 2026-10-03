// 照片版面「紅包袋」（P9 台灣味，亮）：一個直式紅包袋（固定色 collar）立在畫面裡，背景是很亮、失焦的光點（像喜宴廳的燈）——
//  - 紅包的封口打開、往後翻；照片（有白邊的相片）裝在袋子裡，一開始只從袋口露出一截。
//  - 第一個拍點起，照片被「抽」兩下（一拍一下）從袋口滑出來，接著往鏡頭飛過來、轉正，停在畫面左邊（離鏡頭近，所以變大），
//    在半空中輕輕浮著；鏡頭同時從紅包的特寫拉開、轉一點角度，焦點跟著照片走。
//  - 紅包袋前面的燙金框裡，用金色的手寫字寫著主字（賓客的祝福＋署名，或新人的註解，像在紅包上寫的祝福），照片抽出來之後一個字一個字寫上去；
//    歌詞小一號寫在主字下面跟唱；沒有主字時歌詞自己寫在那個位置（_photo.ts 的 PhotoText）。紅包跟著字變寬一點，
//    60 字的長留言＋署名＋兩排歌詞也寫得下。兩個都沒有：紅包退到右下當背景，照片在畫面中間。
//  - 焦點：照片飛出來停好之後，相片上的畫面慢慢往焦點推（1.18 倍），鏡頭也往焦點那一點移過去、推近一點。
//  - 一直在動：照片浮著、鏡頭很慢地繞；每個小節線一道光掃過燙金；背景的光點慢慢往上飄，前景偶爾有很近、很模糊的金色光點經過（景深）。
// 畫法：一個 shader：背景（遠的平面上的光點）、紅包（後片、翻開的封口、前片的燙金與字、取信的半圓缺口）、相片（離鏡頭近的平面）、影子、前景光點。
// 鏡頭是 _p9 的透視鏡頭（世界座標：牆面 z = 0、z 朝鏡頭），照片飛向鏡頭時自然變大。字畫在一張 Canvas（fast），shader 在紅包的座標取樣。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { F } from '../engine/type';
import { mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { beatAfter } from './_motifs';
import { photoWords, focusIn } from './_photo';
import { P9Plate, P9_GLSL, P9_CAM_GLSL, Words, camUniforms, fitPhoto, setCam } from './_p9';

export const spec: PlateSpecDecl = { photo: true, paper: true, family: 'photo', series: 'local', prefers: ['portrait', 'square'], energy: [0, 1], bars: [2, 8], weight: 1 };

/** 鏡頭到紅包的距離；照片最後停在離紅包 ZF 的地方（離鏡頭近，看起來放大 G 倍）。 */
const DIST = 2400, ZF = 900, G = DIST / (DIST - ZF);
const RAD = Math.PI / 180;

const BG = () => new FSPass(/* glsl */ `
  ${P9_GLSL}
  ${P9_CAM_GLSL}
  uniform sampler2D photo; uniform sampler2D txt; uniform float hasTxt;
  uniform vec2 envC; uniform float envR; uniform vec2 envHalf;
  uniform vec3 phP; uniform float phR; uniform vec2 phHalf; uniform float phBd; uniform float lod; uniform vec4 crop;
  uniform vec2 txO; uniform vec2 txS;
  uniform float sweep; uniform float k; uniform float t; uniform float pxE; uniform float pxP; uniform float focusZ;
  uniform vec2 shC; uniform vec2 shHalf; uniform float shR; uniform float shK;

  const float BACK_Z = -700.0;   // 背景的光點在紅包後面多遠
  const vec2 SHD = vec2(0.22, 0.3); // 光從左上來：每離開 1 px，影子往右下偏多少

  vec3 goldC(float sh) { return mix(C_FUR, C_BONE, 0.45) * (0.62 + 0.55 * sh); }

  // 背景：很亮的奶油色，左上一團光；失焦的光點（兩層，慢慢往上飄）
  vec3 backdrop(vec2 p) {
    vec2 w = onZ(p, BACK_Z);
    vec2 lq = (w - vec2(500.0, 200.0)) / 1700.0;
    vec3 col = mix(mix(C_PAPER, C_BONE, 0.3), C_FUR, 0.05) * (0.8 + 0.2 * exp(-dot(lq, lq) * 1.5));
    for (int L = 0; L < 2; L++) {
      float cs = L == 0 ? 300.0 : 190.0;
      vec2 q = w + vec2(37.0 * float(L), t * (L == 0 ? 9.0 : 14.0));
      vec2 id = floor(q / cs);
      vec2 h = hash22(id + float(L) * 17.0);
      vec2 c = (id + 0.5) * cs + (h - 0.5) * cs * 0.35;
      float r = mix(0.12, 0.26, h.x) * cs;
      float d = length(q - c) - r;
      float on = step(0.35, h.y);
      float disc = (1.0 - smoothstep(-r * 0.25, r * 0.12, d)) * (0.6 + 0.4 * smoothstep(-r, -r * 0.3, d));
      vec3 tint = mix(mix(C_BONE, C_FUR, 0.35), mix(C_BONE, C_COLLAR, 0.25), step(0.7, h.x));
      col = mix(col, tint * 1.02, disc * on * (L == 0 ? 0.42 : 0.3));
    }
    return col;
  }

  vec2 envL(vec2 w) { return rot2(-envR) * (w - envC); }
  vec2 phL(vec2 w) { return rot2(-phR) * (w - phP.xy); }

  // 照片在高度 zr 的面上投下的影子
  float photoShadow(vec2 p, float zr, float strength) {
    float dz = phP.z - zr;
    if (dz <= 1.0) return 0.0;
    vec2 q = phL(onZ(p, zr) - SHD * min(dz, 260.0));
    return strength * boxShade(sdBox(q, phHalf + phBd), 3.0 + min(dz, 900.0) * 0.07) * smoothstep(1.0, 50.0, dz);
  }

  vec4 printLayer(vec2 p) {
    vec2 q = phL(onZ(p, phP.z));
    vec4 pr = printAt(photo, q, phHalf, phBd, lod, pxP * 0.8 + abs(phP.z - focusZ) * 0.004, crop);
    // 相紙的光澤：一道很淡的斜光，跟著照片的角度走
    pr.rgb += C_BONE * 0.03 * smoothstep(0.35, 0.0, abs(dot(q / (phHalf + phBd), vec2(0.55, 0.85)) + 0.25));
    return pr;
  }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 col = backdrop(p);
    vec2 we = onZ(p, 0.0);
    vec2 q = envL(we);
    float aa = pxE * 0.8 + abs(focusZ) * 0.0015;
    float top = -envHalf.y;
    // 紅包在背景上的影子（離很遠，很軟）
    vec2 qsb = envL(onZ(p, BACK_Z) - SHD * 260.0 - vec2(0.0, 0.0));
    col *= 1.0 - 0.26 * boxShade(sdBox(qsb, envHalf), 80.0);
    // 照片在背景上的影子（照片離背景很遠：在畫面上往右下錯開、很軟）
    col *= 1.0 - shK * boxShade(sdBox(rot2(-shR) * (p - shC - vec2(38.0, 56.0)), shHalf), 48.0);
    // 翻開的封口（往後翻，從袋口上緣伸出來的梯形，裡面那一面）
    float fh = envHalf.x * 0.5;
    float fy = (top - q.y) / fh;
    float fw = mix(envHalf.x, envHalf.x * 0.62, clamp(fy, 0.0, 1.0));
    float dfl = max(abs(q.y - (top - fh * 0.5)) - fh * 0.5, abs(q.x) - fw);
    vec3 flapC = C_COLLAR * 0.72 * (0.95 + 0.05 * paperTex(q));
    flapC = mix(flapC, goldC(0.4), fillAA(abs(max(abs(q.y - (top - fh * 0.5)) - fh * 0.5 + 12.0, abs(q.x) - fw + 12.0)) - 0.9, aa));
    col = mix(col, flapC, fillAA(dfl, aa));
    // 後片（從前片的缺口看得到）
    float dp = sdBox(q, envHalf);
    col = mix(col, C_COLLAR * 0.55, fillAA(dp, aa));
    // 照片還在袋子裡：畫在前片後面
    bool inside = phP.z < 3.0;
    if (inside) { vec4 pr = printLayer(p); col = mix(col, pr.rgb, pr.a); }
    // 前片：取信的半圓缺口、紙的紋理、左上亮一點、燙金雙線框、下面一個金色的圓形花紋
    float notch = length(q - vec2(0.0, top)) - envHalf.x * 0.16;
    float df = max(dp, -notch);
    float af = fillAA(df, aa);
    if (af > 0.0) {
      vec3 fc = C_COLLAR * (0.86 + 0.05 * paperTex(q * 1.2)) * (1.04 - 0.12 * smoothstep(-envHalf.y, envHalf.y, q.y + q.x * 0.5));
      // 紙微微彎：中間偏左一道很淡的亮、兩側邊緣暗一點
      fc *= 1.0 + 0.06 * exp(-pow((q.x + envHalf.x * 0.25) / (envHalf.x * 0.35), 2.0)) - 0.1 * smoothstep(envHalf.x - 30.0, envHalf.x, abs(q.x));
      float sh = 0.3 + 0.7 * exp(-pow(dot(we, normalize(vec2(1.0, 0.5))) - sweep, 2.0) / 9000.0);
      float f1 = abs(sdBox(q, envHalf - 18.0)) - 1.2;
      float f2 = abs(sdBox(q, envHalf - 26.0)) - 0.6;
      float foil = max(fillAA(f1, aa), fillAA(f2, aa)) * step(0.0, notch - 10.0);
      vec2 mc = q - vec2(0.0, top + envHalf.y * 1.66);
      float mr = envHalf.x * 0.2;
      float ma = atan(mc.y, mc.x);
      float med = min(abs(length(mc) - mr) - 1.2, abs(length(mc) - mr * (0.62 + 0.08 * cos(ma * 8.0))) - 1.0);
      med = min(med, abs(length(mc) - mr * 0.18) - 1.0);
      foil = max(foil, fillAA(med, aa));
      fc = mix(fc, goldC(sh), foil);
      // 金色的手寫字（註解或歌詞）
      if (hasTxt > 0.5) {
        vec4 tx = layerAt(txt, (q - txO) / txS);
        fc = fc * (1.0 - tx.a) + tx.rgb * (0.82 + 0.45 * sh);
      }
      fc *= 1.0 - photoShadow(p, 0.0, 0.32);
      col = mix(col, fc, af);
    }
    // 照片抽出來之後：在前片前面
    if (!inside) { vec4 pr = printLayer(p); col = mix(col, pr.rgb, pr.a); }
    // 前景：很近、很模糊的金色光點（偶爾經過）
    vec2 wf = onZ(p, 1500.0);
    vec2 fq = wf + vec2(t * 22.0, -t * 10.0);
    vec2 fid = floor(fq / 520.0);
    vec2 fh2 = hash22(fid + 91.0);
    vec2 fc2 = (fid + 0.5) * 520.0 + (fh2 - 0.5) * 220.0;
    float fd = length(fq - fc2) - 70.0;
    col = mix(col, mix(C_BONE, C_FUR, 0.4), (1.0 - smoothstep(-40.0, 40.0, fd)) * step(0.72, fh2.y) * 0.22);
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, txt: { value: null }, hasTxt: { value: 0 }, ...camUniforms(),
  envC: { value: new THREE.Vector2() }, envR: { value: 0 }, envHalf: { value: new THREE.Vector2() },
  phP: { value: new THREE.Vector3() }, phR: { value: 0 }, phHalf: { value: new THREE.Vector2() }, phBd: { value: 20 }, lod: { value: 0 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  txO: { value: new THREE.Vector2() }, txS: { value: new THREE.Vector2(1, 1) },
  sweep: { value: -2000 }, k: { value: 1 }, t: { value: 0 }, pxE: { value: 1 }, pxP: { value: 1 }, focusZ: { value: 0 },
  shC: { value: new THREE.Vector2() }, shHalf: { value: new THREE.Vector2() }, shR: { value: 0 }, shK: { value: 0 },
});

export default class HongBao extends P9Plate {
  bg = shared('hongbao.bg', BG);
  txt: Layer2D | null = null;
  words: Words | null = null;
  /** 照片（世界座標、不含白邊）的半寬高與白邊。 */
  hw = 0; hh = 0; bd = 0;
  /** 紅包：中心、半寬高、角度。 */
  ex = 0; ey = 0; ew = 0; eh = 0; ea = 0;
  /** 照片最後停的位置（世界座標，z = ZF）與角度。 */
  fx = 0; fy = 0; fa = 0;
  txX = 0; txY = 0;
  /** 動作的時間：兩下抽出、飛向鏡頭。 */
  t1 = 0; t2 = 0; t3 = 0;

  override async init() {
    await this.loadPhoto();
    const { end, audio } = this.ctx;
    const img = this.img;
    const probe = document.createElement('canvas').getContext('2d')!;
    const gold = mixRgba('fur', 'bone', 0.5);
    const pw = photoWords(this.ctx);
    const has = pw.kind !== 'none' || pw.lyrics;
    // 照片在畫面上（停下來時）的大小；世界座標的大小要除以 G（離鏡頭近，看起來大 G 倍）
    const ph = has ? fitPhoto(img, 760, 580) : fitPhoto(img, 980, 660);
    this.hw = ph.w / G / 2; this.hh = ph.h / G / 2;
    this.bd = clamp(0.045 * Math.min(this.hw, this.hh) * 2, 10, 22);
    // 紅包：比照片寬一點，直的；有字時寬一點（字寫在燙金框裡，60 字的留言要排得進五、六行）
    this.ew = Math.max(has ? 580 : 500, 2 * (this.hw + this.bd) + 70);
    this.eh = this.ew * 1.55;
    // 字的框：燙金框裡、取信缺口下面，到下面的圓形花紋上面（畫面上最後一行離下緣 ≥ 96 px）
    const words = has ? new Words(this.ctx, probe, {
      family: F.hand(700), w: this.ew - 140, h: 560, min: 40, max: 50, lineHeight: 1.36, maxLines: 6, align: 'left',
      ink: gold, unsung: mixRgba('fur', 'bone', 0.5, 0.3), sigInk: mixRgba('fur', 'bone', 0.5, 0.85), sigSize: 28,
      album: { family: F.hand(700), size: 22, color: mixRgba('fur', 'bone', 0.5, 0.75) },
    }) : null;
    this.words = words?.has ? words : null;
    const r = hash(this.seed, 5) * 2 - 1;
    this.ea = (this.words ? 3.5 : 6) * (Math.PI / 180) * (r >= 0 ? 1 : -1);
    // 停下來的位置（畫面座標 → 世界座標：鏡頭最後正對、看著 (960, 540, 0)）
    // 紅包在左、照片停在右邊（右下角 HUD 的字才不會壓在紅色的紙上）
    const sx = this.words ? 1330 : 1010, sy = this.words ? 450 : 460;
    this.fx = 960 + (sx - 960) / G; this.fy = 540 + (sy - 540) / G;
    this.fa = -2.2 * (Math.PI / 180) * (r >= 0 ? 1 : -1);
    this.ex = this.words ? 530 : 520;
    const mouth = this.words ? 270 : 400;
    this.ey = mouth + this.eh / 2;
    if (this.words) {
      // 字寫在燙金框裡、袋口下面（紅包在左邊，不會碰到右下角的 HUD 區）
      this.txt = this.track(new Layer2D(Math.ceil(this.words.st.w + 40), Math.ceil(this.words.height + 50), undefined, { fast: true }));
      this.txX = -this.ew / 2 + 70 - 20; this.txY = -this.eh / 2 + 84 - 20;
    }
    // 動作的時間：第一個拍點抽第一下、下一拍抽第二下、再下一拍飛向鏡頭（短窗格壓縮）
    this.t1 = this.cue(0.25, 0.8);
    this.t2 = Math.min(beatAfter(audio, this.t1, 1), this.t1 + 0.55);
    this.t3 = Math.min(beatAfter(audio, this.t1, 2), this.t1 + 1.0);
    this.words?.writeFrom(this.t3 + 0.9, Math.max(0.6, Math.min(2.2, (end - this.t3 - 0.9) * 0.5)));
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const u = this.bg.u;
    const mouthY = -this.eh / 2;
    const hh = this.hh + this.bd;
    // 照片在紅包的座標：一開始露出一截 → 抽兩下 → 整張出來（底邊在袋口上面）
    const yIn = mouthY + hh - 70, yOut = mouthY - hh - 26;
    const pull = 0.55 * ease.outCubic(prog(t, this.t1, this.t1 + 0.3)) + 0.45 * ease.outCubic(prog(t, this.t2, this.t2 + 0.3));
    const ly = lerp(yIn, yOut, pull);
    // 紅包剛放下時晃一下
    const sway = 1.6 * Math.exp(-lt * 2.2) * Math.sin(lt * 7.5) * RAD;
    const ea = this.ea + sway;
    const ce = Math.cos(ea), se = Math.sin(ea);
    const ox = this.ex - se * ly, oy = this.ey + ce * ly;
    // 飛向鏡頭：位置照弧線走（先往前、再往旁邊），角度轉正，最後浮著
    const fly = ease.inOutCubic(prog(t, this.t3, this.t3 + 0.95));
    const bob = Math.sin((t - this.t3) * 2.1) * fly;
    const px = lerp(ox, this.fx, ease.inOutQuad(fly)) + 2 * bob;
    const py = lerp(oy, this.fy, fly) - 70 * Math.sin(fly * Math.PI) + 3 * bob;
    const pz = lerp(0, ZF, ease.outCubic(fly));
    const pa = lerp(ea, this.fa, fly) + 0.4 * RAD * Math.sin((t - this.t3) * 0.9) * fly;
    (u.phP!.value as THREE.Vector3).set(px, py, pz < 0.5 ? 1 : pz);
    u.phR!.value = pa;
    (u.phHalf!.value as THREE.Vector2).set(this.hw, this.hh);
    u.phBd!.value = this.bd;
    (u.envC!.value as THREE.Vector2).set(this.ex, this.ey);
    u.envR!.value = ea;
    (u.envHalf!.value as THREE.Vector2).set(this.ew / 2, this.eh / 2);
    // 焦點：照片停好之後，相片上的畫面往焦點推（實體相片 1.18 倍；很小的舊照片少推）
    const crop = this.focus(t, this.t3 + 0.5, this.hw / this.hh, { zoom: 1.18, screenW: 2 * this.hw * G });
    (u.crop!.value as THREE.Vector4).set(...crop);
    const [fu, fv] = focusIn(this.photo, crop);
    const qx = (fu - 0.5) * 2 * this.hw, qy = (fv - 0.5) * 2 * this.hh;
    const focX = px + qx * Math.cos(pa) - qy * Math.sin(pa), focY = py + qx * Math.sin(pa) + qy * Math.cos(pa);
    // 鏡頭：一開始是紅包袋口的特寫（推近一點、斜一點），照片飛出來時拉開、轉到正面；之後往焦點那一點慢慢移、推近
    // （有字時移得少：紅包上的字一直要在畫面裡）
    const settle = ease.outExpo(clamp(lt / 1.1));
    const cp = ease.inOutCubic(prog(t, this.t3 - 0.1, this.t3 + 1.15));
    const push = 1 - Math.exp(-Math.max(0, t - this.t3) / 6);
    const toF = (this.words ? 0.26 : 0.4) * push;
    const tx0 = this.ex - 20, ty0 = this.ey - this.eh / 2 + 120;
    const zoom = lerp(lerp(1.36, 1.28, settle), 1.0, cp) + (this.words ? 0.05 : 0.09) * push;
    const yaw = (lerp(7, -1.5, cp) + 1.2 * Math.sin(lt * 0.23)) * RAD * (this.ea >= 0 ? 1 : -1);
    const proj = setCam(u, {
      x: lerp(tx0, 960, cp) + (focX - 960) * toF * cp, y: lerp(ty0, 540, cp) + (focY - 540) * toF * cp, z: 0, dist: DIST, zoom,
      yaw, pitch: lerp(4, 0.5, cp) * RAD, roll: lerp(-1.5, 0, cp) * RAD,
    });
    const [scx, scy] = proj(px, py, pz);
    const sk = (DIST * zoom) / (DIST - pz);
    (u.shC!.value as THREE.Vector2).set(scx, scy);
    (u.shHalf!.value as THREE.Vector2).set((this.hw + this.bd) * sk, (this.hh + this.bd) * sk);
    u.shR!.value = pa;
    u.shK!.value = 0.3 * fly;
    u.pxE!.value = 1 / zoom;
    u.pxP!.value = (DIST - pz) / (DIST * zoom);
    u.focusZ!.value = pz;
    u.lod!.value = this.lod((2 * this.hw * DIST * zoom) / (DIST - pz), crop[2] - crop[0]);
    u.sweep!.value = lerp(-800, 2800, ease.inOutCubic(clamp(f.barPhase / 0.8)));
    u.t!.value = t;
    u.k!.value = (0.86 + 0.14 * ease.outCubic(prog(t, s, s + 0.45))) * (1 - 0.1 * prog(t, e - 0.3, e));
    u.photo!.value = this.tex;
    u.hasTxt!.value = this.words ? 1 : 0;
    // shader 是共用的：沒有字的窗格也要換掉上一個窗格（已經釋放）的字圖層
    u.txt!.value = this.tex;
    if (this.words && this.txt) {
      const L = this.txt;
      if (this.words.draw(L.ctx, t, 20, 20, () => L.clear())) L.upload();
      u.txt!.value = L.texture;
      (u.txO!.value as THREE.Vector2).set(this.txX, this.txY);
      (u.txS!.value as THREE.Vector2).set(L.w, L.h);
    }
    this.bg.render(renderer, out);
    return { paper: 1, bloom: 0.12, bloomThreshold: 1.15, halation: 0.04, vignette: 0.26 };
  }
}
