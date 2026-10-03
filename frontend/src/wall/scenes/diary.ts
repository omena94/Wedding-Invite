// 照片版面「日記本」（亮）：檯燈下攤開的橫線日記本，鏡頭斜斜地（荷蘭角）貼近右頁，淺景深——
//  - 照片夾在頁與頁之間，一開始只從頁的上緣露出一截；第一拍被往上抽出來，再翻落到頁面上（鏡頭跟著往下搖），落在拍點上。
//  - 字用鋼筆寫在日記的橫線上（橫線的間距跟著字的行高，字剛好坐在線上）：主字（賓客留言＋署名，或新人的註解）一個字一個字寫出來，
//    歌詞小一號寫在下面的線上跟唱；沒有主字時歌詞自己當主字寫在線上（_photo.ts 的 PhotoText）；兩個都沒有就只有照片（落在頁面中間）。
//  - 橫的照片在上、字在下面的線上；直的照片在左、字在右邊。照片完整洗成一張相片，很小的舊照片最多放大到原尺寸約 1.5 倍；
//    相片上的畫面慢慢往焦點（新人點的臉）推，鏡頭也往那邊靠一點。
//  - 相簿的第一張：字的上面一行小小的相簿名（像日記的標題）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, SCALE, type Layer2D } from '../engine/gl';
import { F, loadText } from '../engine/type';
import { mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { Cam, P3_GLSL, camUniforms, photoGain, p3Noise, loadPic, picSize, picCrop, focusAt, texPerWorld, inkLayer, TextCol, beatNear, settle, type Pic, type V3, type ColStyle, CAM_FOCAL } from './_p3';
import { loadWords, settleK } from './_photo';
import type { PhotoRef } from '../photos';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'album', paper: true, energy: [0, 0.75], bars: [2, 8], weight: 1, prefers: ['landscape', 'small'] };

/** 頁面頂面高度、書溝的 x、右頁外緣的 x、頁的半高。 */
const T = 12, GX = -560, PR = 520, PH2 = 700;

const BG = () => new FSPass(/* glsl */ `
  ${P3_GLSL}
  uniform sampler2D photo; uniform sampler2D ink;
  uniform vec4 ph; uniform vec2 phHS; uniform float border; uniform float photoTpw; uniform vec4 crop;
  uniform vec4 inkRect; uniform float inkOn;
  uniform vec2 rule;   // 橫線的間距、某一條線的 y
  const vec3 LD = normalize(vec3(0.45, 0.4, 1.0));

  float lamp(vec2 p) {
    vec2 q = (p - vec2(260.0, 260.0)) / vec2(1250.0, 1000.0);
    return exp(-dot(q, q) * 1.2);
  }
  vec3 lit(vec3 alb, vec2 p, float ao) { return alb * ao * (0.4 + 0.58 * lamp(p)) * vec3(1.0, 0.95, 0.87); }

  void main() {
    vec2 px = pxPos();
    vec3 ro = camPos, rd = viewDir(px);
    vec3 bA = vec3(${GX - 1080}.0, ${-PH2}.0, 0.0), bB = vec3(${PR}.0, ${PH2}.0, ${T}.0);
    vec2 hb = boxHit(ro, rd, bA, bB);
    float tb = (hb.x < hb.y && hb.x > 0.0) ? hb.x : 1e9;
    // 照片（可能還夾在頁底下：z < 頁面）
    float tph; vec2 q = flatAt(ro, rd, ph.xy, ph.z, ph.w, tph);
    vec2 outer = phHS + vec2(border);
    float dph = sdBox(q, outer - 6.0) - 6.0;
    float cph = cocAt(tph * dot(rd, camF));
    float aph = (tph > 0.0 && tph < tb) ? 1.0 - smoothstep(-0.7 - cph * 0.5, 0.7 + cph * 0.5, dph) : 0.0;
    vec3 col;
    if (tb < 1e8) {
      vec3 P = ro + rd * tb;
      vec3 n = boxNormal(P, bA, bB);
      float depth = tb * dot(rd, camF), coc = cocAt(depth);
      float wpp = wppAt(tb, rd, n);
      vec4 nn = nz(P.xy, 800.0, wpp, coc);
      vec3 alb = mix(C_PAPER, C_BONE, 0.3) * 0.95 * (0.975 + 0.03 * (nn.r - 0.5) + 0.02 * (nn.g - 0.5));
      if (n.z < 0.5) {
        col = lit(alb * 0.8 * (0.93 + 0.07 * sin(P.z * 6.0)), P.xy, 1.0);
      } else {
        float aa = wpp * 0.8 + coc * 0.6;
        if (P.x > ${GX}.0) {
          // 橫線（淡灰藍）與左邊的紅色邊線
          float dl = abs(fract((P.y - rule.y) / rule.x + 0.5) - 0.5) * rule.x;
          float ln = (1.0 - smoothstep(0.7, 1.3 + aa, dl)) * step(P.y, ${PH2 - 150}.0) * step(${-PH2 + 90}.0, P.y);
          alb = mix(alb, mix(C_ASH, C_INK, 0.15), ln * 0.45);
          float mg = 1.0 - smoothstep(0.8, 1.5 + aa, abs(P.x - ${GX + 128}.0));
          alb = mix(alb, C_COLLAR, mg * 0.35);
          if (inkOn > 0.5) {
            vec2 iuv = vec2((P.x - inkRect.x) / inkRect.z, (P.y - inkRect.y) / inkRect.w);
            vec4 ic = inkAt(ink, iuv, lodFor(${SCALE.toFixed(3)}, wpp, coc));
            alb = alb * (1.0 - ic.a) + ic.rgb;
          }
        }
        float gx = abs(P.x - ${GX}.0);
        float ao = 1.0 - 0.45 * exp(-gx / 30.0) - 0.12 * exp(-gx / 200.0);
        // 照片在頁面上方時的影子
        float h = ph.z - ${T}.0;
        if (h > 0.0) ao *= 1.0 - (0.3 - 0.12 * smoothstep(20.0, 160.0, h)) * liftShadow(P.xy, ph.xy, outer, ph.w, h, LD);
        col = lit(alb, P.xy, ao);
      }
    } else {
      // 桌面：深色的胡桃木
      float tt = hitZ(ro, rd, 0.0);
      vec3 P = ro + rd * tt;
      float depth = tt * dot(rd, camF), coc = cocAt(depth);
      float wpp = wppAt(tt, rd, vec3(0.0, 0.0, 1.0));
      vec4 a = nz(vec2(P.x * 0.9, P.y * 0.07), 700.0, wpp, coc);
      vec3 alb = mix(C_FUR, C_INK, 0.62) * (0.8 + 0.25 * a.g + 0.15 * (a.a - 0.5));
      float sd = sdBox(P.xy - vec2(${(GX - 1080 + PR) / 2}.0, 0.0) + LD.xy / LD.z * 12.0, vec2(${(PR - GX + 1080) / 2}.0, ${PH2}.0));
      alb *= 1.0 - 0.55 * (1.0 - smoothstep(-10.0, 50.0, sd));
      // 照片還在桌子上方時的影子
      alb *= 1.0 - 0.3 * liftShadow(P.xy, ph.xy, outer, ph.w, ph.z, LD);
      col = lit(alb, P.xy, 1.0);
    }
    if (aph > 0.0) {
      vec3 Pp = ro + rd * tph;
      float wph = wppAt(tph, rd, vec3(0.0, 0.0, 1.0));
      vec3 pr = mix(C_BONE, C_PAPER, 0.25) * 0.92;
      float di = sdBox(q, phHS);
      if (di < 1.0) {
        vec2 uv = vec2(q.x + phHS.x, phHS.y - q.y) / (2.0 * phHS);
        pr = mix(pr, photoAt(photo, cropUv(uv, crop), lodFor(photoTpw, wph, cph)), 1.0 - smoothstep(-0.6, 0.6, di));
      }
      col = mix(col, lit(pr, Pp.xy, 1.0) * 1.03, aph);
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  ...camUniforms(),
  photo: { value: null }, ink: { value: null },
  ph: { value: new THREE.Vector4() }, phHS: { value: new THREE.Vector2(300, 200) }, border: { value: 14 }, photoTpw: { value: 1 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  inkRect: { value: new THREE.Vector4() }, inkOn: { value: 0 }, rule: { value: new THREE.Vector2(64, 0) },
});

export default class Diary extends Scene {
  bg = shared('diary.bg', BG);
  photo: PhotoRef = this.ctx.params.photo;
  seed = Number(this.ctx.params.seed ?? 1);
  cam = new Cam();
  pic: Pic | null = null;
  noise: THREE.Texture | null = null;
  ink: Layer2D | null = null;
  col: TextCol | null = null;
  /** 照片最後的中心、轉角；夾在頁裡時的中心與轉角。 */
  pc: [number, number] = [0, 0];
  ang = 0;
  tuck: [number, number, number] = [0, 0, 0];
  hs: [number, number] = [300, 200];
  border = 14;
  ir: [number, number, number, number] = [0, 0, 0, 0];
  ruleY = 0; ruleS = 64;
  aim: [number, number] = [0, 0];
  tLand = 0;

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
    const wide = img.w >= img.h * 1.15;
    const left = GX + 160, right = PR - 50;
    // 直的照片：字在右邊一條窄欄（高度有上限：長的字縮小一點，整塊才不會長到畫面底下的 HUD 區）
    const colW = wide ? 640 : 400, colH = wide ? 470 : 540, pad = 24;
    this.ink = this.track(inkLayer(colW + 2 * pad, colH + 2 * pad));
    const pen = mixRgba('ink', 'sepia', 0.3, 0.93);
    const st: ColStyle = {
      family: F.hand(400), ink: pen, active: mixRgba('blood', 'ink', 0.2), unsung: mixRgba('ink', 'sepia', 0.3, 0.28),
      sigInk: mixRgba('ink', 'sepia', 0.3, 0.75), rs, lineHeight: 1.45, maxLines: wide ? 4 : 7,
      label: { family: F.hand(700), size: 26, color: mixRgba('ink', 'sepia', 0.3, 0.75), tracking: 3, gap: 0 },
    };
    this.col = new TextCol(this.ink, colW, colH, st, ph, this.ctx, pad);
    const fit0 = this.col.fit;
    if (fit0 && this.col.text.sung) {
      // 歌詞也坐在橫線上：主字最後一行的基線往下數整數條線（有署名時空一條給署名），反推主字跟歌詞之間要空多少
      const tx = this.col.text, lh = fit0.lineHeight;
      const below = (fit0.size - fit0.size * 0.9) + tx.sigH + tx.lyricSize * 0.9;
      const gap = (tx.sigH ? 2 : 1) * lh - below;
      if (gap > 0) this.col = new TextCol(this.ink, colW, colH, { ...st, gap: gap * rs }, ph, this.ctx, pad);
    }
    const hasText = this.col.has;
    // 字的行高＝橫線的間距；相簿名也坐在一條線上（佔一行）
    const sz = this.col.fit ? this.col.fit.size : this.col.text.size;
    this.ruleS = this.col.fit ? this.col.fit.lineHeight : sz * st.lineHeight;
    if (this.col.label) this.col.labelH = this.ruleS;
    const textH = this.col.contentH;
    let w: number, h: number;
    if (!hasText) {
      [w, h] = picSize(img, right - left - 40, 980, rs);
      this.pc = [(left + right) / 2, 60];
    } else if (wide) {
      // 照片＋字整組不超過 800 高：長的字照片小一點，字才不會掉到畫面最下面（近的那邊透視放大，離畫面底要 ≥ 96 px）
      [w, h] = picSize(img, right - left - 60, Math.min(620, 800 - 40 - textH), rs);
      this.pc = [(left + right) / 2 - 10, 120 + textH / 2];
    } else {
      [w, h] = picSize(img, right - left - colW - 120, 900, rs);
      this.pc = [left + w / 2 + 10, 70];
    }
    this.hs = [w / 2, h / 2];
    this.border = clamp(0.03 * Math.min(w, h), 10, 18);
    this.ang = (hash(this.seed, 1) - 0.5) * 5 * (Math.PI / 180);
    const ow = w / 2 + this.border, oh = h / 2 + this.border;
    if (hasText) {
      // 字的欄：橫的照片在下面、直的照片在右邊；第一條基線落在橫線上
      const colLeft = wide ? left + 10 : this.pc[0] + ow + 70;
      const colTop = wide ? this.pc[1] - oh - 40 : this.pc[1] + Math.min(oh, textH / 2 + 60);
      this.ir = [colLeft - pad, colTop - colH - pad, colW + 2 * pad, colH + 2 * pad];
      // 標籤佔一行：第一行的基線 = 欄頂往下（標籤一行）＋ 0.9 字高（PhotoText 的基線）
      this.ruleY = colTop - this.col.labelH - sz * 0.9 - 7;
    } else this.ruleY = 0;
    this.aim = hasText ? [(left + right) / 2, 60] : [this.pc[0], this.pc[1]];
    if (wide && hasText) this.aim[1] = (this.pc[1] + oh + (this.pc[1] - oh - 40 - textH)) / 2;
    // 直的：照片與字整組的正中間
    else if (hasText) {
      const cTop = this.ir[1] + this.ir[3] - pad;
      this.aim = [(this.pc[0] - ow + this.ir[0] + pad + colW) / 2, (Math.max(this.pc[1] + oh, cTop) + Math.min(this.pc[1] - oh, cTop - textH)) / 2];
    }
    // 夾在頁裡：從頁的上緣露出一截（照片高的三成）
    this.tuck = [this.pc[0] + 40, PH2 + 0.3 * h - h / 2, this.ang - 0.12];
    this.tLand = beatNear(audio, start + 1.15, start + 0.95, start + 1.6);
    if (this.col.fit) {
      this.col.writeFrom = this.tLand + 0.15;
      this.col.writeTo = this.col.writeFrom + Math.min(2.0, 0.07 * this.col.chars + 0.3);
    }
  }

  /** 相片上的畫面往焦點推到哪裡（照片 uv 的範圍）。 */
  private crop(t: number) {
    return picCrop(this.pic!, settleK(t - this.ctx.start, 6), { zoom: 1.12, screenW: this.hs[0] * 2 * 0.98 });
  }

  /** 照片的位置：夾著 → 往上抽出來 → 翻落到頁面上。 */
  private photoAt(t: number): [number, number, number, number] {
    const s = this.ctx.start;
    const p = prog(t, s + 0.05, this.tLand);
    const h = this.hs[1] * 2 + 2 * this.border;
    const outY = PH2 + 24 + h / 2;
    if (p < 0.4) {
      const k = ease.inOutCubic(p / 0.4);
      return [this.tuck[0], lerp(this.tuck[1], outY, k), T - 2.5, this.tuck[2]];
    }
    const k = (p - 0.4) / 0.6;
    const e = ease.inOutCubic(k);
    const z = T - 2.5 + (T + 1 - (T - 2.5)) * e + 170 * Math.sin(Math.PI * Math.min(1, k * 1.05));
    return [lerp(this.tuck[0], this.pc[0], e), lerp(outY, this.pc[1], e), p >= 1 ? T + 1 : z, lerp(this.tuck[2], this.ang, e)];
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const u = this.bg.u;
    const pp = this.photoAt(t);
    const crop = this.crop(t);
    // 鏡頭往焦點靠一點（照片落下以後；有字時少靠，字才一直在畫面裡）
    const [fx, fy] = focusAt(this.pic!, crop, this.pc, this.hs, this.ang);
    const lean = (this.col!.has ? 0.14 : 0.4) * settle(t - this.tLand, 5);
    // 鏡頭：一開始看著頁的上緣（照片露出來的地方）、近一點；照片翻落時往下搖到讀的位置，之後很慢地推近
    const m = ease.inOutCubic(prog(t, s + 0.2, this.tLand + 0.3));
    const dir = hash(this.seed, 4) < 0.5 ? 1 : -1;
    const target: V3 = [lerp(this.tuck[0], this.aim[0], m) + lean * (fx - this.pc[0]), lerp(PH2 - 40, this.aim[1], m) + lean * (fy - this.pc[1]), T];
    const dist = (CAM_FOCAL / 0.98) * lerp(0.82, 1, m) * (1 - 0.04 * settle(lt - (this.tLand - s), 7));
    this.cam.orbit(target, dist, lerp(48, 56, m), 4 * dir, 30, dir * lerp(-9, -5.5, m) - dir * 0.8 * settle(lt, 9));
    this.cam.apply(u);
    u.photoGain!.value = photoGain(this.photo.lum);
    (u.ph!.value as THREE.Vector4).set(...pp);
    (u.phHS!.value as THREE.Vector2).set(...this.hs);
    u.border!.value = this.border;
    u.photo!.value = this.pic!.tex;
    (u.crop!.value as THREE.Vector4).set(...crop);
    u.photoTpw!.value = texPerWorld(this.pic!.img, this.hs[0] * 2, crop);
    u.inkOn!.value = this.col!.draw(t) ? 1 : 0;
    u.ink!.value = this.ink!.texture;
    (u.inkRect!.value as THREE.Vector4).set(...this.ir);
    (u.rule!.value as THREE.Vector2).set(this.ruleS, this.ruleY);
    u.noiseTex!.value = this.noise;
    // 對焦在照片與字之間偏字的那邊（字比照片近鏡頭，不能糊）
    u.focusD!.value = this.cam.depth([target[0], target[1] - 70 * m, T]);
    u.aper!.value = 30;
    u.k!.value = (0.86 + 0.14 * ease.outCubic(prog(t, s, s + 0.5))) * (1 - 0.1 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    return { paper: 1, bloom: 0.12, bloomThreshold: 1.15, halation: 0.05, vignette: 0.42 };
  }
}
