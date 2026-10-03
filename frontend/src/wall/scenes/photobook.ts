// 照片版面「寫真書」（暗）：深色木桌上一本精裝的寫真書，一盞暖暖的檯燈照著，四周暗下去——
//  - 一開始鏡頭低低地貼著書背：布面書背上燙金印著相簿名（沒有相簿名就印新人的名字），金箔隨著鏡頭移動閃一下。
//  - 書封是布面，中間壓凹的小窗裡貼著照片；鏡頭往上升、繞到前面的同時，封面慢慢打開（立體地繞著書背轉），落在拍點上。
//  - 打開以後：右頁是整頁印的照片（留白邊），左邊的蝴蝶頁印著字（思源宋體，像書的題詞）：主字（賓客留言＋署名，或新人的註解），
//    歌詞小一號在下面跟唱；沒有主字時歌詞自己當主字（_photo.ts 的 PhotoText）；兩個都沒有就只有照片（鏡頭停在右頁）。
//  - 很小的舊照片最多放大到原尺寸約 1.5 倍；封面小窗與內頁的照片都慢慢往焦點（新人點的臉）推，鏡頭也往那邊靠一點。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, SCALE, type Layer2D } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { ease, lerp, prog } from '../engine/util';
import { COUPLE_ZH } from './_motifs';
import { Cam, P3_GLSL, camUniforms, photoGain, p3Noise, loadPic, picSize, picCrop, focusAt, texPerWorld, inkLayer, TextCol, beatNear, settle, type Pic, type V3, CAM_FOCAL } from './_p3';
import { loadWords, settleK } from './_photo';
import type { PhotoRef } from '../photos';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'album', energy: [0, 0.7], bars: [3, 8], weight: 1, prefers: ['landscape', 'portrait'], thumbAt: 0.055 };

/** 書的厚度、封面板厚。 */
const TH = 64, CTH = 5;

const BG = () => new FSPass(/* glsl */ `
  ${P3_GLSL}
  uniform sampler2D photo; uniform sampler2D ink; uniform sampler2D foil;
  uniform vec2 bk;          // 書的半寬、半高（書頁）
  uniform float open;       // 封面打開的角度
  uniform vec4 cov;         // 封面小窗裡的照片：中心 xy（封面座標）、半寬高
  uniform vec4 pg;          // 內頁的照片：中心 xy、半寬高
  uniform float photoTpw; uniform float covTpw; uniform vec4 crop;
  uniform vec4 inkRect; uniform float inkOn;
  uniform vec2 foilRect;    // 書背燙金字的範圍：y 的半長、z 的半高
  uniform float glint;
  const vec3 LD = normalize(vec3(-0.5, 0.45, 0.9));

  uniform vec2 lampC;
  float lamp(vec2 p) {
    vec2 q = (p - lampC) / vec2(1050.0, 800.0);
    return exp(-dot(q, q) * 2.0);
  }
  vec3 lit(vec3 alb, vec3 P, vec3 n) {
    float dif = clamp(dot(n, LD), 0.0, 1.0);
    vec3 warm = mix(vec3(1.0), C_EMBER, 0.15);
    return alb * (0.02 + 0.86 * lamp(P.xy) * (0.3 + 0.7 * dif)) * warm;
  }
  vec3 cloth(vec2 p, float wpp, float coc) {
    vec4 a = nz(p, 260.0, wpp, coc);
    float wv = weave(p, 2.9);
    return mix(C_INK2, C_BLOOD, 0.28) * (0.9 + 0.14 * (a.b - 0.5) + 0.1 * (a.g - 0.5) + 0.06 * wv * smoothstep(1.2, 0.5, wpp));
  }
  vec3 paperC(vec2 p, float wpp, float coc) {
    vec4 a = nz(p, 800.0, wpp, coc);
    return mix(C_PAPER, C_BONE, 0.3) * 0.86 * (0.98 + 0.03 * (a.r - 0.5));
  }

  void main() {
    vec2 px = pxPos();
    vec3 ro = camPos, rd = viewDir(px);
    float W = bk.x, Hh = bk.y;
    // 書頁（含封底）：x -W..W、y -Hh..Hh、z 0..TH-CTH
    vec3 bA = vec3(-W, -Hh, 0.0), bB = vec3(W, Hh, ${TH - CTH}.0);
    vec2 hb = boxHit(ro, rd, bA, bB);
    float tb = (hb.x < hb.y && hb.x > 0.0) ? hb.x : 1e9;
    // 封面：繞書背（x = -W、z = TH）轉
    vec3 ex = vec3(cos(open), 0.0, sin(open));
    vec3 hinge = vec3(-W, 0.0, ${(TH - CTH / 2).toFixed(1)});
    vec3 hc = rectHit(ro, rd, hinge + ex * (W + 8.0), ex, vec3(0.0, 1.0, 0.0), vec2(W + 8.0, Hh + 8.0));
    float tc = hc.x > 0.0 ? hc.x : 1e9;
    float tt = hitZ(ro, rd, 0.0);
    vec3 col;
    if (tc < tb && tc < 1e8) {
      vec3 P = ro + rd * tc;
      vec3 n = vec3(-sin(open), 0.0, cos(open));
      bool outer = dot(n, rd) < 0.0;
      if (!outer) n = -n;
      float coc = cocAt(tc * dot(rd, camF)), wpp = wppAt(tc, rd, n);
      // 封面座標：u 從書背量起（0..2W+16），v 往上
      vec2 q = vec2(hc.y + W + 8.0, hc.z);
      vec3 alb;
      if (outer) {
        alb = cloth(q, wpp, coc);
        // 壓凹的小窗：一圈暗、照片
        vec2 cq = q - cov.xy;
        float d = sdBox(cq, cov.zw);
        alb *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, 6.0 + coc, d)) * step(-0.5, d);
        alb *= 1.0 + 0.12 * (1.0 - smoothstep(0.0, 3.0, abs(d - 12.0))) * step(0.0, d);
        float a = 1.0 - smoothstep(-0.6 - coc * 0.5, 0.6 + coc * 0.5, d);
        if (a > 0.0) {
          vec2 uv = vec2(cq.x + cov.z, cov.w - cq.y) / (2.0 * cov.zw);
          alb = mix(alb, photoAt(photo, cropUv(uv, crop), lodFor(covTpw, wpp, coc)), a);
        }
      } else {
        // 蝴蝶頁（封面內側）：奶油色的紙，印著註解；靠書背那邊暗一點
        alb = paperC(q, wpp, coc);
        vec2 b = vec2(-q.x, q.y);
        if (inkOn > 0.5) {
          vec2 iuv = vec2((b.x - inkRect.x) / inkRect.z, (b.y - inkRect.y) / inkRect.w);
          vec4 ic = inkAt(ink, iuv, lodFor(${SCALE.toFixed(3)}, wpp, coc));
          alb = alb * (1.0 - ic.a) + ic.rgb;
        }
        alb *= 1.0 - 0.4 * exp(-q.x / 40.0);
      }
      col = lit(alb, P, n);
    } else if (tb < 1e8) {
      vec3 P = ro + rd * tb;
      vec3 n = boxNormal(P, bA, bB);
      float coc = cocAt(tb * dot(rd, camF)), wpp = wppAt(tb, rd, n);
      if (n.x < -0.5) {
        // 書背：布面＋燙金字（金箔：反光跟著鏡頭閃）
        vec3 alb = cloth(P.yz * vec2(1.0, 1.0) + 13.0, wpp, coc);
        alb *= 0.85 + 0.15 * smoothstep(0.0, ${TH}.0, P.z);
        vec2 fuv = vec2(0.5 - P.y / (2.0 * foilRect.x), (P.z - ${(TH / 2).toFixed(1)}) / (2.0 * foilRect.y) + 0.5);
        vec4 fc = inkAt(foil, fuv, lodFor(${SCALE.toFixed(3)}, wpp, coc));
        vec3 gold = mix(C_BLOOD, C_SIGNAL, 0.55 + 0.45 * glint) * (0.5 + 0.9 * glint);
        col = lit(alb, P, n) * (1.0 - fc.a) + gold * fc.a * (0.35 + 0.65 * lamp(P.xy));
      } else if (n.z > 0.5) {
        // 第一頁：整頁的照片（白邊），靠書溝暗一點
        vec3 alb = paperC(P.xy, wpp, coc);
        vec2 q = P.xy - pg.xy;
        float d = sdBox(q, pg.zw);
        float a = 1.0 - smoothstep(-0.6 - coc * 0.5, 0.6 + coc * 0.5, d);
        if (a > 0.0) {
          vec2 uv = vec2(q.x + pg.z, pg.w - q.y) / (2.0 * pg.zw);
          alb = mix(alb, photoAt(photo, cropUv(uv, crop), lodFor(photoTpw, wpp, coc)), a);
        }
        alb *= 1.0 - 0.45 * exp(-(P.x + W) / 36.0) - 0.12 * exp(-(P.x + W) / 200.0);
        // 封面還沒全開時投在頁上的影子
        float occ = curlShadow(P, LD, vec2(-W, ${(TH - CTH / 2).toFixed(1)}), open, 0.0, 2.0 * W + 16.0, vec2(-Hh - 8.0, Hh + 8.0));
        col = lit(alb, P, n) * (1.0 - 0.75 * occ);
      } else {
        // 書口：一層一層的紙；最底下是封底（布）
        vec3 alb = P.z < ${CTH}.0 ? cloth(P.xy + P.z, wpp, coc) : paperC(P.xy, wpp, coc) * (0.82 + 0.06 * sin(P.z * 5.0));
        col = lit(alb, P, n);
      }
    } else {
      // 桌面：深色的胡桃木
      vec3 P = ro + rd * tt;
      float coc = cocAt(tt * dot(rd, camF)), wpp = wppAt(tt, rd, vec3(0.0, 0.0, 1.0));
      vec4 a = nz(vec2(P.x * 0.08, P.y * 0.9), 800.0, wpp, coc);
      vec4 b = nz(vec2(P.x * 0.03, P.y * 0.25) + 7.0, 1200.0, wpp, coc);
      vec3 alb = mix(C_FUR, C_INK, 0.8) * (0.75 + 0.3 * a.g + 0.2 * (b.a - 0.5));
      float sd = sdBox(P.xy + LD.xy / LD.z * 30.0, vec2(W, Hh));
      alb *= 1.0 - 0.6 * (1.0 - smoothstep(-20.0, 70.0, sd));
      // 打開的封面投在桌上的影子
      alb *= 1.0 - 0.5 * curlShadow(P, LD, vec2(-W, ${(TH - CTH / 2).toFixed(1)}), open, 0.0, 2.0 * W + 16.0, vec2(-Hh - 8.0, Hh + 8.0));
      col = lit(alb, P, vec3(0.0, 0.0, 1.0));
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  ...camUniforms(),
  photo: { value: null }, ink: { value: null }, foil: { value: null },
  bk: { value: new THREE.Vector2(550, 410) }, open: { value: 0 },
  cov: { value: new THREE.Vector4() }, pg: { value: new THREE.Vector4() }, photoTpw: { value: 1 }, covTpw: { value: 1 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  inkRect: { value: new THREE.Vector4() }, inkOn: { value: 0 }, foilRect: { value: new THREE.Vector2(300, 18) }, glint: { value: 0 },
  lampC: { value: new THREE.Vector2() },
});

export default class Photobook extends Scene {
  bg = shared('photobook.bg', BG);
  photo: PhotoRef = this.ctx.params.photo;
  seed = Number(this.ctx.params.seed ?? 1);
  cam = new Cam();
  pic: Pic | null = null;
  noise: THREE.Texture | null = null;
  ink: Layer2D | null = null;
  foil: Layer2D | null = null;
  col: TextCol | null = null;
  bw = 550; bh = 410;
  cov: [number, number, number, number] = [0, 0, 0, 0];
  pg: [number, number, number, number] = [0, 0, 0, 0];
  ir: [number, number, number, number] = [0, 0, 0, 0];
  foilHalf: [number, number] = [300, 18];
  tOpen0 = 0; tOpen1 = 0;
  readScale = 0.8;

  override async init() {
    const { renderer, start, audio } = this.ctx;
    const ph = this.photo;
    if (!ph) throw new Error('照片版面要有 params.photo');
    const title = ph.album || COUPLE_ZH;
    await loadText(`${ph.caption}${ph.album}${title}`);
    await loadWords(this.ctx);
    this.pic = await loadPic(renderer, ph);
    this.track(this.pic.tex);
    this.noise = p3Noise(renderer);
    const { img } = this.pic;
    const tall = img.h > img.w * 1.05;
    // 書的大小：直的照片用直的書
    this.bw = tall ? 400 : 560; this.bh = tall ? 540 : 420;
    const W = this.bw, Hh = this.bh;
    // 打開以後兩頁（封面內側＋第一頁）都要在畫面裡
    this.readScale = Math.min(0.85, 1580 / (4 * W + 40), 820 / (2 * Hh * 0.92));
    const rs = this.readScale;
    // 內頁的照片：留白邊
    const [pw, phh] = picSize(img, 2 * W - 110, 2 * Hh - 110, rs);
    this.pg = [0, 0, pw / 2, phh / 2];
    // 封面小窗：照片縮小
    const [cw, ch] = picSize(img, W * 0.95, Hh * 0.95, 1);
    this.cov = [W + 8, Hh * 0.08, cw / 2, ch / 2];
    // 蝴蝶頁的字（封面內側、翻過來之後的座標：x 從書背往左是負的）
    const colW = 2 * W - 160, colH = 2 * Hh - 200, pad = 24;
    this.ink = this.track(inkLayer(colW + 2 * pad, colH + 2 * pad));
    this.col = new TextCol(this.ink, colW, colH, {
      family: F.ming(400), ink: rgba('sepia', 0.9), active: mixRgba('blood', 'sepia', 0.3), unsung: rgba('sepia', 0.3),
      sigInk: rgba('sepia', 0.7), rs, lineHeight: 1.55, maxLines: 5, align: 'center',
      label: { family: F.hei(500), size: Math.round(22 / rs), color: rgba('sepia', 0.55), tracking: 10, gap: Math.round(30 / rs) },
    }, ph, this.ctx, pad);
    const blockH = this.col.contentH;
    // 封面內側的座標（b.x = 世界 x + W：書背是 0、往左是負的），蝴蝶頁的中心在 -(W + 8)
    const cx = -(W + 8), cy = Math.min(Hh - 90, blockH / 2 + 20);
    this.ir = [cx - colW / 2 - pad, cy - colH - pad, colW + 2 * pad, colH + 2 * pad];
    // 書背的燙金字
    this.foil = this.track(inkLayer(2 * Hh - 80, 2 * (TH - 2 * CTH)));
    this.foilHalf = [Hh - 40, TH / 2 - CTH];
    {
      const L = this.foil, c = L.ctx;
      L.clear();
      const fs = Math.min(32, TH - 2 * CTH - 18);
      c.font = font(F.ming(700), fs);
      c.letterSpacing = '8px';
      let s = title;
      while (s.length > 1 && c.measureText(s).width > L.w - 120) s = s.slice(0, -1);
      if (s !== title) s = `${s}…`;
      c.fillStyle = '#fff';
      c.textAlign = 'center';
      c.fillText(s, L.w / 2, L.h / 2 + fs * 0.36);
      c.fillRect(30, L.h / 2 - 1, 30, 2); c.fillRect(L.w - 60, L.h / 2 - 1, 30, 2);
      c.letterSpacing = '0px';
      L.upload();
    }
    // 封面：開頭一點點後開始掀，慢慢打開，落在拍點上
    this.tOpen0 = start + 0.35;
    this.tOpen1 = beatNear(audio, start + 1.9, start + 1.4, start + 2.3);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const u = this.bg.u;
    const W = this.bw;
    // 封面小窗、內頁的照片往焦點推（同一個推法：打開以後接著推，不會跳）
    const crop = picCrop(this.pic!, settleK(lt, 6), { zoom: 1.18, screenW: this.pg[2] * 2 * this.readScale });
    (u.crop!.value as THREE.Vector4).set(...crop);
    const op = prog(t, this.tOpen0, this.tOpen1, ease.inOutCubic);
    // 開到底稍微垂向桌面（封面比書厚的那一側低一點）
    const settleBack = 0.03 * Math.sin(Math.max(0, t - this.tOpen1) * 9) * Math.exp(-Math.max(0, t - this.tOpen1) * 5);
    const open = (Math.PI + 0.035) * op + settleBack;
    u.open!.value = open;
    (u.bk!.value as THREE.Vector2).set(W, this.bh);
    (u.cov!.value as THREE.Vector4).set(...this.cov);
    (u.pg!.value as THREE.Vector4).set(...this.pg);
    u.photo!.value = this.pic!.tex;
    u.photoTpw!.value = texPerWorld(this.pic!.img, this.pg[2] * 2, crop);
    u.covTpw!.value = texPerWorld(this.pic!.img, this.cov[2] * 2, crop);
    const has = this.col!.has;
    u.inkOn!.value = this.col!.draw(t) ? 1 : 0;
    u.ink!.value = this.ink!.texture;
    (u.inkRect!.value as THREE.Vector4).set(...this.ir);
    u.foil!.value = this.foil!.texture;
    (u.foilRect!.value as THREE.Vector2).set(...this.foilHalf);
    // 鏡頭：從書背旁邊低低地看，往上升、繞到前面（封面打開的同時），停在兩頁中間，之後很慢地推近
    const m = ease.inOutCubic(prog(t, s, this.tOpen1 + 0.4));
    // 打開以後往內頁照片上的焦點靠一點（有字時少靠，兩頁才一直在畫面裡）
    const [fx, fy] = focusAt(this.pic!, crop, [this.pg[0], this.pg[1]], [this.pg[2], this.pg[3]]);
    const lean = (has ? 0.14 : 0.4) * settle(t - this.tOpen1, 5);
    const aimX = has ? -W - 4 : 0;
    const target: V3 = [lerp(-W * 0.7, aimX, m) + lean * fx, lerp(-this.bh * 0.1, 0, m) + lean * fy, lerp(TH * 0.6, TH, m)];
    const readDist = CAM_FOCAL / this.readScale;
    const dist = lerp(readDist * 0.78, readDist, m) * (1 - 0.04 * settle(lt - (this.tOpen1 - s), 7));
    this.cam.orbit(target, dist, lerp(30, 62, m), lerp(-62, -4, m), 30, lerp(-2, -0.5, m));
    // 檯燈的光圈跟著書（打開以後照著兩頁）
    (u.lampC!.value as THREE.Vector2).set(lerp(-W * 0.3, has ? -W * 0.7 : -W * 0.1, op), 60);
    this.cam.apply(u);
    u.photoGain!.value = photoGain(this.photo.lum);
    // 金箔閃一下：鏡頭繞過書背的時候
    u.glint!.value = Math.exp(-Math.pow((t - (s + 0.5)) / 0.4, 2)) * 0.9 + 0.15;
    u.noiseTex!.value = this.noise;
    u.focusD!.value = this.cam.depth(target);
    u.aper!.value = lerp(48, 26, m);
    u.k!.value = ease.outCubic(prog(t, s, s + 0.45)) * (1 - 0.12 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    return { bloom: 0.22, bloomThreshold: 1.05, halation: 0.1, vignette: 0.5 };
  }
}
