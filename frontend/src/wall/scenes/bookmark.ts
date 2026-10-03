// 照片版面「書頁夾照片」（亮）：攤在灰綠色布面上的一本小說（字是看不清楚的灰線），一開始好幾頁書頁「嘩」地往左翻過去
// （一頁接一頁、很輕很快的立體翻頁），停在夾著照片的那一頁：照片斜斜地躺在右頁上，當書籤用。
//  - 最後翻過去的那一頁（左頁）是一章的結尾：幾行字、一個小小的章末記號，空白處用鉛筆寫著字：主字（賓客留言＋署名，或新人的註解），
//    歌詞小一號在下面跟唱；沒有主字時歌詞自己當主字（_photo.ts 的 PhotoText）；兩個都沒有就只有照片（左頁整頁是字，鏡頭停在右頁）。
//    字多的時候章節結尾往上提一點，鉛筆字才不會寫到畫面底下。
//  - 很小的舊照片最多放大到原尺寸約 1.5 倍；照片上的畫面慢慢往焦點（新人點的臉）推，鏡頭也往那邊靠一點；最後一頁落下在拍點上。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, SCALE, type Layer2D } from '../engine/gl';
import { F, loadText } from '../engine/type';
import { mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { Cam, P3_GLSL, camUniforms, photoGain, p3Noise, loadPic, picSize, picCrop, focusAt, texPerWorld, inkLayer, TextCol, beatNear, settle, type Pic, type V3, CAM_FOCAL } from './_p3';
import { loadWords, settleK } from './_photo';
import type { PhotoRef } from '../photos';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'album', paper: true, energy: [0.1, 1], bars: [2, 8], weight: 1, prefers: ['portrait', 'small'], thumbAt: 0.054 };

/** 翻過去的頁數、頁面頂面、頁寬、頁高。 */
const K = 5, T = 16, PW = 840, PH = 1100;
/** 左頁（最後翻過去那頁的背面）的字在哪裡停（章末記號、鉛筆字的欄在它下面）：至少這麼高，字多時再往上提。 */
const STOP_Y = 150;

const BG = () => new FSPass(/* glsl */ `
  ${P3_GLSL}
  uniform sampler2D photo; uniform sampler2D ink;
  uniform vec4 ph; uniform vec2 phHS; uniform float photoTpw; uniform vec4 crop;
  uniform vec4 inkRect; uniform float inkOn; uniform float lastStop;
  uniform vec3 pg[${K}];      // 每一頁：起點切線角、彎曲、鉸鏈高度
  uniform float moving;       // 正在翻的那一頁（投影子用；-1 = 沒有）
  const vec3 LD = normalize(vec3(-0.45, 0.4, 1.0));
  const float HW = ${PW}.0, HH = ${PH / 2}.0;

  float lightAt(vec2 p) {
    vec2 q = (p - vec2(-250.0, 260.0)) / vec2(1700.0, 1300.0);
    return 0.62 + 0.36 * exp(-dot(q, q) * 1.4);
  }
  vec3 paper(vec2 p, float wpp, float coc) {
    vec4 a = nz(p, 800.0, wpp, coc);
    return mix(C_PAPER, C_BONE, 0.25) * 0.94 * (0.98 + 0.03 * (a.r - 0.5) + 0.02 * (a.g - 0.5));
  }
  // 書的內文：一行一行的灰線（字看不清楚），字與字之間有空、段落最後一行比較短。s 從書溝量起；yStop 以下沒有字
  float textLines(float s, float y, float seed, float wpp, float coc, float yStop) {
    float top = HH - 110.0;
    if (s < 76.0 || s > HW - 84.0 || y > top || y < max(yStop, -HH + 120.0)) return 0.0;
    float v = top - y;
    float row = floor(v / 34.0), fy = mod(v, 34.0);
    float bar = 1.0 - smoothstep(3.2, 4.0 + wpp * 1.2 + coc * 0.3, abs(fy - 17.0));
    float cell = floor((s - 76.0) / 15.0);
    float gap = step(0.8, hash12(vec2(cell, row + seed * 97.0)));
    float hr = hash12(vec2(row, seed * 13.0));
    float lineEnd = hr < 0.16 ? 76.0 + (HW - 160.0) * (0.25 + 0.6 * hash12(vec2(row, seed + 3.0))) : HW - 84.0;
    float indent = hash12(vec2(row - 1.0, seed * 13.0)) < 0.16 ? 108.0 : 76.0;
    float ink = bar * (1.0 - gap) * step(s, lineEnd) * step(indent, s);
    // 遠一點、焦外就收成淡淡的灰（不要閃）
    return mix(ink, 0.2, smoothstep(1.7, 3.4, wpp + coc * 0.25));
  }
  vec3 page(float s, float y, vec2 p, float seed, float wpp, float coc, float yStop) {
    vec3 c = paper(p + seed * 31.0, wpp, coc);
    float tl = textLines(s, y, seed, wpp, coc, yStop);
    return mix(c, mix(C_GRAPHITE, C_INK, 0.3), tl * 0.42);
  }

  void main() {
    vec2 px = pxPos();
    vec3 ro = camPos, rd = viewDir(px);
    vec2 yr = vec2(-HH, HH);
    // 翻動的書頁：K 張，各自一個曲面（鉸鏈在書溝），找最近的
    float tb = 1e9; int pid = -1; vec4 hit = vec4(-1.0);
    for (int i = 0; i < ${K}; i++) {
      vec4 h = curlHit(ro, rd, vec2(0.0, pg[i].z), pg[i].x, pg[i].y, HW, yr, 1.0);
      if (h.x > 0.0 && h.x < tb) { tb = h.x; pid = i; hit = h; }
    }
    // 照片：躺在右頁上（還沒翻開的書頁蓋在它上面）
    float tph; vec2 q = flatAt(ro, rd, ph.xy, ph.z, ph.w, tph);
    float cph = cocAt(tph * dot(rd, camF));
    float dph = sdBox(q, phHS);
    bool onPhoto = tph > 0.0 && tph < tb && dph < 1.0 + cph;
    // 書（頁塊）與封面、桌布
    vec3 bA = vec3(-HW, -HH, 0.0), bB = vec3(HW, HH, ${T}.0);
    vec2 hb = boxHit(ro, rd, bA, bB);
    vec3 cA = vec3(-HW - 14.0, -HH - 14.0, 0.0), cB = vec3(HW + 14.0, HH + 14.0, 6.0);
    vec2 hc = boxHit(ro, rd, cA, cB);
    vec3 col;
    float tBlock = (hb.x < hb.y && hb.x > 0.0) ? hb.x : 1e9;
    float tCover = (hc.x < hc.y && hc.x > 0.0) ? hc.x : 1e9;
    float tNear = min(tb, min(tBlock, tCover));
    if (pid >= 0 && tb <= tNear) {
      vec3 P = ro + rd * tb;
      float s = hit.y, phi = hit.w;
      vec3 n = vec3(-sin(phi), 0.0, cos(phi));
      bool front = dot(n, rd) < 0.0;
      if (!front) n = -n;
      float coc = cocAt(tb * dot(rd, camF)), wpp = wppAt(tb, rd, n);
      float seed = float(pid) * 2.0 + (front ? 0.0 : 1.0);
      bool last = pid == ${K - 1} && !front;
      vec3 alb = page(s, P.y, vec2(s, P.y), seed, wpp, coc, last ? lastStop : -1e4);
      if (last) {
        // 章末記號：三個小點
        float dd = min(min(length(vec2(s - HW * 0.5 + 34.0, P.y - (lastStop - 46.0))), length(vec2(s - HW * 0.5, P.y - (lastStop - 46.0)))), length(vec2(s - HW * 0.5 - 34.0, P.y - (lastStop - 46.0))));
        alb = mix(alb, mix(C_GRAPHITE, C_INK, 0.3), (1.0 - smoothstep(3.0, 4.2 + wpp, dd)) * 0.7 * step(-1e3, lastStop));
        if (inkOn > 0.5) {
          vec2 iuv = vec2((-s - inkRect.x) / inkRect.z, (P.y - inkRect.y) / inkRect.w);
          vec4 ic = inkAt(ink, iuv, lodFor(${SCALE.toFixed(3)}, wpp, coc));
          alb = alb * (1.0 - ic.a) + ic.rgb;
        }
      }
      float ao = 1.0 - 0.3 * exp(-s / 30.0) - 0.1 * exp(-s / 160.0);
      float dif = clamp(dot(n, LD) / LD.z, 0.0, 1.3);
      col = alb * lightAt(P.xy) * ao * (0.8 + 0.2 * dif);
      // 立起來的紙背光那面透一點光
      col += mix(C_PAPER, C_EMBER, 0.2) * 0.04 * max(-dot(n, LD), 0.0);
    } else if (onPhoto) {
      vec3 P = ro + rd * tph;
      float wph = wppAt(tph, rd, vec3(0.0, 0.0, 1.0));
      vec2 uv = vec2(q.x + phHS.x, phHS.y - q.y) / (2.0 * phHS);
      vec3 im = photoAt(photo, cropUv(uv, crop), lodFor(photoTpw, wph, cph));
      im += C_BONE * 0.02 * smoothstep(0.25, 0.0, abs(uv.x - uv.y * 0.6 - 0.25));
      float occ = moving >= 0.0 ? curlShadow(P, LD, vec2(0.0, pg[int(moving)].z), pg[int(moving)].x, pg[int(moving)].y, HW, yr) : 0.0;
      col = im * lightAt(P.xy) * (1.0 - 0.5 * occ);
      // 照片的邊緣抗鋸齒（跟底下的頁面混）
      float a = 1.0 - smoothstep(-0.7 - cph * 0.5, 0.7 + cph * 0.5, dph);
      if (a < 1.0) {
        vec3 base = paper(P.xy, wph, cph) * lightAt(P.xy) * 0.8;
        col = mix(base, col, a);
      }
    } else if (tBlock <= tCover && tBlock < 1e8) {
      vec3 P = ro + rd * tBlock;
      vec3 n = boxNormal(P, bA, bB);
      float coc = cocAt(tBlock * dot(rd, camF)), wpp = wppAt(tBlock, rd, n);
      if (n.z > 0.5) {
        float s = abs(P.x);
        vec3 alb = page(s, P.y, P.xy, P.x > 0.0 ? 99.0 : 77.0, wpp, coc, -1e4);
        // 照片的接觸陰影（很薄、很軟）
        float dq = sdBox(rot2(ph.w) * (P.xy - ph.xy) + LD.xy / LD.z * 1.5, phHS);
        alb *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 7.0 + coc, dq)) * step(0.0, dq) * step(0.0, P.x);
        float ao = 1.0 - 0.38 * exp(-s / 26.0) - 0.12 * exp(-s / 170.0);
        float occ = moving >= 0.0 ? curlShadow(P, LD, vec2(0.0, pg[int(moving)].z), pg[int(moving)].x, pg[int(moving)].y, HW, yr) : 0.0;
        col = alb * lightAt(P.xy) * ao * (1.0 - 0.5 * occ);
      } else {
        col = paper(P.xy, wpp, coc) * 0.78 * (0.92 + 0.08 * sin(P.z * 5.0)) * lightAt(P.xy);
      }
    } else if (tCover < 1e8) {
      // 精裝書的封面邊：深色布
      vec3 P = ro + rd * tCover;
      vec3 n = boxNormal(P, cA, cB);
      col = mix(C_INK2, C_GINGHAM, 0.25) * (n.z > 0.5 ? 1.0 : 0.7) * lightAt(P.xy);
    } else {
      // 布面：灰綠色（固定色 gingham）的亞麻，很細的織紋
      float tt = hitZ(ro, rd, 0.0);
      vec3 P = ro + rd * tt;
      float coc = cocAt(tt * dot(rd, camF)), wpp = wppAt(tt, rd, vec3(0.0, 0.0, 1.0));
      vec4 a = nz(P.xy, 500.0, wpp, coc);
      float wv = weave(P.xy, 4.2);
      vec3 alb = mix(C_GINGHAM, C_PAPER, 0.35) * 0.72 * (0.9 + 0.1 * (a.g - 0.5) + 0.08 * (a.r - 0.5) + 0.04 * wv * smoothstep(1.4, 0.6, wpp));
      float sd = sdBox(P.xy + LD.xy / LD.z * 10.0, vec2(HW + 14.0, HH + 14.0));
      alb *= 1.0 - 0.45 * (1.0 - smoothstep(-20.0, 50.0, sd));
      col = alb * lightAt(P.xy);
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  ...camUniforms(),
  photo: { value: null }, ink: { value: null },
  ph: { value: new THREE.Vector4() }, phHS: { value: new THREE.Vector2(300, 200) }, photoTpw: { value: 1 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  inkRect: { value: new THREE.Vector4() }, inkOn: { value: 0 }, lastStop: { value: -1e4 },
  pg: { value: Array.from({ length: K }, () => new THREE.Vector3()) }, moving: { value: -1 },
});

export default class Bookmark extends Scene {
  bg = shared('bookmark.bg', BG);
  photo: PhotoRef = this.ctx.params.photo;
  seed = Number(this.ctx.params.seed ?? 1);
  cam = new Cam();
  pic: Pic | null = null;
  noise: THREE.Texture | null = null;
  ink: Layer2D | null = null;
  col: TextCol | null = null;
  pc: [number, number] = [0, 0];
  hs: [number, number] = [300, 200];
  ang = 0;
  ir: [number, number, number, number] = [0, 0, 0, 0];
  /** 每一頁開始翻、翻完的時間。 */
  flips: [number, number][] = [];
  aimX = 0;
  /** 左頁的書本內文停在哪裡（章末記號）。 */
  stop = STOP_Y;

  override async init() {
    const { renderer, start, audio } = this.ctx;
    const ph = this.photo;
    if (!ph) throw new Error('照片版面要有 params.photo');
    await loadText(`${ph.caption}${ph.album}`);
    await loadWords(this.ctx);
    this.pic = await loadPic(renderer, ph);
    this.track(this.pic.tex);
    this.noise = p3Noise(renderer);
    const { img } = this.pic;
    const rs = 0.98;
    // 照片躺在右頁（斜一點）
    const [w, h] = picSize(img, PW - 150, PH - 230, rs);
    this.hs = [w / 2, h / 2];
    this.pc = [PW / 2 + 8, 10];
    this.ang = (hash(this.seed, 1) < 0.5 ? -1 : 1) * (2.5 + 2 * hash(this.seed, 2)) * (Math.PI / 180);
    // 左頁的鉛筆字：章末記號下面的空白
    const colW = PW - 200, colH = STOP_Y - 80 + PH / 2 - 150, pad = 24;
    this.ink = this.track(inkLayer(colW + 2 * pad, colH + 2 * pad));
    const pencil = mixRgba('graphite', 'ink', 0.35, 0.9);
    this.col = new TextCol(this.ink, colW, colH, {
      family: F.hand(400), ink: pencil, active: mixRgba('blood', 'ink', 0.25), unsung: mixRgba('graphite', 'ink', 0.35, 0.3),
      sigInk: mixRgba('graphite', 'ink', 0.35, 0.72), rs, lineHeight: 1.42, maxLines: 4,
      label: { family: F.hand(700), size: 24, color: mixRgba('graphite', 'ink', 0.35, 0.65), tracking: 3, gap: 18 },
    }, ph, this.ctx, pad);
    // 整塊的下緣不低於 y = -300（近鏡頭那邊透視放大，再低就離畫面底不到 96 px）：字多時章節結尾往上提
    this.stop = clamp(this.col.contentH - 204, STOP_Y, 320);
    const colLeft = -PW + 100, colTop = this.stop - 96;
    this.ir = [colLeft - pad, colTop - colH - pad, colW + 2 * pad, colH + 2 * pad];
    this.aimX = this.col.has ? 0 : PW / 2;
    // 翻頁：一頁接一頁，最後一頁落在拍點上
    const tEnd = beatNear(audio, start + 1.15, start + 0.95, start + 1.5);
    const dur = 0.5, t0 = start + 0.05;
    const step = Math.max(0.06, (tEnd - dur - t0) / (K - 1));
    this.flips = Array.from({ length: K }, (_, i) => [t0 + i * step, t0 + i * step + dur]);
    this.flips[K - 1] = [tEnd - dur - 0.1, tEnd];
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const u = this.bg.u;
    // 照片上的畫面往焦點推；書頁翻完以後鏡頭也往焦點靠一點（有字時少靠，左頁的字才一直在畫面裡）
    const crop = picCrop(this.pic!, settleK(lt, 6), { zoom: 1.14, screenW: this.hs[0] * 2 * 0.98 });
    const [fx, fy] = focusAt(this.pic!, crop, this.pc, this.hs, this.ang);
    const lean = (this.col!.has ? 0.14 : 0.42) * settle(t - this.flips[K - 1]![1], 5);
    // 書頁：每一頁照自己的時間翻（前半段紙的外緣領先、後半段落後），落下後輕輕彈一下
    const pg = u.pg!.value as THREE.Vector3[];
    let moving = -1;
    for (let i = 0; i < K; i++) {
      const [a0, a1] = this.flips[i]!;
      const p = prog(t, a0, a1);
      if (p > 0 && p < 1) moving = i;
      const mid = Math.PI * ease.inOutCubic(p);
      const after = Math.max(0, t - a1);
      const bend = (p < 1 ? 1.15 * Math.sin(2 * Math.PI * p) : 0) - 0.06 * Math.sin(after * 13) * Math.exp(-after * 6) * (p >= 1 ? 1 : 0);
      const a = clamp(mid - bend * 0.5, 0, Math.PI);
      const tip = clamp(mid + bend * 0.5, 0, Math.PI);
      // 鉸鏈高度：右邊疊著的順序（先翻的在上面）→ 左邊疊著的順序（後翻的在上面）
      const z = T + 0.8 + lerp((K - 1 - i) * 0.5, i * 0.5, ease.inOutCubic(p));
      pg[i]!.set(a, tip - a, z);
    }
    u.moving!.value = moving;
    (u.ph!.value as THREE.Vector4).set(this.pc[0], this.pc[1], T + 0.3, this.ang);
    (u.phHS!.value as THREE.Vector2).set(...this.hs);
    u.photo!.value = this.pic!.tex;
    (u.crop!.value as THREE.Vector4).set(...crop);
    u.photoTpw!.value = texPerWorld(this.pic!.img, this.hs[0] * 2, crop);
    const has = this.col!.has;
    u.lastStop!.value = has ? this.stop : -1e4;
    u.inkOn!.value = this.col!.draw(t) ? 1 : 0;
    u.ink!.value = this.ink!.texture;
    (u.inkRect!.value as THREE.Vector4).set(...this.ir);
    // 鏡頭：一開始靠近右頁（書頁翻起來的地方），跟著書頁往左搖到讀的位置，之後很慢地推近
    const m = ease.inOutCubic(prog(t, s, this.flips[K - 1]![1] + 0.4));
    const dir = hash(this.seed, 6) < 0.5 ? 1 : -1;
    const target: V3 = [lerp(PW * 0.4, this.aimX, m) + lean * (fx - this.pc[0]), lerp(-30, 0, m) + lean * (fy - this.pc[1]), T];
    const dist = (CAM_FOCAL / 0.98) * lerp(0.9, 1, m) * (1 - 0.045 * settle(lt - (this.flips[K - 1]![1] - s), 7));
    this.cam.orbit(target, dist, lerp(50, 58, m), lerp(6, 2, m) * dir, 30, lerp(-1.5, -0.6, m) * dir);
    this.cam.apply(u);
    u.photoGain!.value = photoGain(this.photo.lum);
    u.noiseTex!.value = this.noise;
    u.focusD!.value = this.cam.depth(target);
    u.aper!.value = 26;
    u.k!.value = (0.9 + 0.1 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.1 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    return { paper: 1, bloom: 0.12, bloomThreshold: 1.15, halation: 0.04, vignette: 0.34 };
  }
}
