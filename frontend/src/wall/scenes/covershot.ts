// 照片版面「雜誌封面」（亮，P8 印刷品）：新人的照片是一本雜誌的封面，雜誌躺在窗邊的淺色桌上——
//  - 封面是照片全幅（封面的比例跟著照片：直的是直的雜誌、橫的是橫開本的寫真誌），封面裡的照片慢慢往新人點的焦點推
//    （推到 1.2 倍，焦點一定在封面裡）；很小的舊照片整本雜誌跟著變小（照片最多放大到原尺寸約 1.5 倍）。
//  - 刊頭很小（新人的縮寫，Cormorant 斜體，旁邊一行期數），不搶封面標題；右下角一個小條碼。
//  - 封面標題就是這一格的字（_photo.ts 的 PhotoText）：主字（賓客留言＋署名，或新人的註解）思源宋體，歌詞小一號在下面跟唱；
//    沒有主字時歌詞自己當標題。上面一行小小的「本期專題」相簿名。標題放在左下，會蓋到焦點（臉）時改放上面；
//    標題後面的照片很淡地壓暗（從標題的頂開始）。兩個都沒有就只有刊頭（雜誌在正中間）。
//  - 鏡頭：雜誌在第一拍前「放」到桌上（從右上滑進來、轉正、影子收緊），之後慢慢推近、角度微微變（光澤跟著移）；
//    每個小節線窗外的光掃過封面一次（亮面雜誌的反光）。旁邊壓著一本上一期（在焦外）。
//  - 右下角（HUD）留給桌面：雜誌不壓到那裡。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE } from '../engine/gl';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { INITIALS, DATE_DOTS, barAfter } from './_motifs';
import { PressPlate, P8_GLSL, PHOTO_POST, F, font, planeQuad, planePoint, homographyPx, clip, textFits, type Plane } from './_p8';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'press', paper: true, energy: [0, 1], bars: [2, 8], weight: 1, prefers: ['portrait'] };

const BG = () => new FSPass(/* glsl */ `${P8_GLSL}
  uniform sampler2D photo; uniform sampler2D deco; uniform sampler2D head;
  uniform mat3 mCover; uniform mat3 mUnder; uniform vec2 cover; uniform vec2 under;
  uniform vec4 crop; uniform float photoPx; uniform vec4 headRect; uniform float headTop; uniform float shade; uniform float shadeY;
  uniform float lift; uniform float sheen; uniform float k; uniform float t; uniform float blurUnder;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 桌面：淺色、很淡的紋理；窗光從左上斜斜進來，窗框的影子很軟很淡、慢慢移
    float n = paperFiber(p * 1.6);
    vec3 col = mix(C_PAPER, C_BONE, 0.3) * (0.92 + 0.018 * n);
    float diag = dot(p, normalize(vec2(0.82, 0.57)));
    col *= 0.9 + 0.1 * smoothstep(1900.0, 300.0, diag);
    float bars = smoothstep(0.25, 0.75, 0.5 + 0.5 * sin((diag + t * 6.0) / 150.0));
    col *= 1.0 - 0.055 * bars * smoothstep(1700.0, 500.0, diag);

    // 上一期（壓在下面、焦外）：一塊素色封面＋淡淡的圓與字塊
    vec2 qu = homo(mUnder, p);
    float su = homoScale(mUnder, p);
    vec2 qs = homo(mUnder, p - vec2(8.0, 12.0));
    float shu = exp(-outsideDist(qs, under) / (su * 26.0));
    col *= 1.0 - 0.22 * shu;
    float au = edgeA(qu, under, su * (1.0 + blurUnder));
    if (au > 0.0) {
      // 上一期的封面：同一張照片的另一塊、在焦外（高 mip 層）、褪色一點，上緣一條刊頭色帶
      vec2 uv = qu / under;
      vec3 uc = photoLin(photo, vec2(0.15, 0.1) + uv * vec2(0.55, 0.7), 5.5);
      uc = mix(uc, vec3(luma(uc)), 0.45) * 0.92;
      uc = mix(uc, C_BONE * 0.85, smoothstep(0.03, 0.07, uv.y) * (1.0 - smoothstep(0.09, 0.12, uv.y)) * smoothstep(0.06, 0.1, uv.x) * (1.0 - smoothstep(0.5, 0.55, uv.x)) * 0.8);
      col = mix(col, uc * (0.97 + 0.02 * n), au);
    }

    // 這一期：影子（放下來的瞬間比較遠、比較淡）、書口（看得到厚度）、封面
    vec2 q = homo(mCover, p);
    float s = homoScale(mCover, p);
    vec2 so = vec2(10.0, 16.0) * lift;
    vec2 qsh = homo(mCover, p - so);
    float d = outsideDist(qsh, cover) / s;
    float sh = d <= 0.0 ? 1.0 : exp(-d / (14.0 + 26.0 * lift));
    col *= 1.0 - (0.3 / lift) * sh;
    vec2 qe = homo(mCover, p - vec2(3.0, 5.0));
    float ae = edgeA(qe, cover, s);
    col = mix(col, C_BONE * (0.8 + 0.06 * step(0.5, fract(qe.y * 0.45))), ae);
    float a = edgeA(q, cover, s);
    if (a > 0.0) {
      vec2 uv = q / cover;
      vec2 puv = cropUv(crop, uv);
      // mip：照片上的像素 ÷ 畫面的實體像素
      float lod = log2(max(s * photoPx / cover.x, 1e-4) / PX_SCALE);
      vec3 ph = photoLin(photo, puv, lod);
      // 標題的地方很淡地壓暗（不是框）：從標題的頂開始往封面邊緣越來越暗（標題在上面時反過來）；刊頭那一條
      float hy = headTop > 0.5 ? 1.0 - uv.y : uv.y;
      ph *= 1.0 - shade * 0.5 * smoothstep(shadeY - 0.1, min(shadeY + 0.22, 1.0), hy);
      ph *= 1.0 - 0.18 * smoothstep(0.16, 0.0, uv.y);
      // 亮面封面的光澤：窗光掃過的一條（很淡，照片不會發光）
      float band = uv.x * 0.75 + uv.y * 0.45 - sheen;
      ph += C_BONE * 0.055 * exp(-band * band / 0.012);
      ph += C_BONE * 0.012 * smoothstep(0.6, 0.0, uv.x + uv.y);
      vec4 dc = layerAt(deco, uv);
      ph = ph * (1.0 - dc.a) + dc.rgb;
      vec4 hc = layerAt(head, (uv - headRect.xy) / headRect.zw);
      ph = ph * (1.0 - hc.a) + hc.rgb;
      col = mix(col, ph, a);
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, phGain: { value: 1 }, deco: { value: null }, head: { value: null },
  mCover: { value: new THREE.Matrix3() }, mUnder: { value: new THREE.Matrix3() },
  cover: { value: new THREE.Vector2() }, under: { value: new THREE.Vector2() },
  crop: { value: new THREE.Vector4(0, 0, 1, 1) }, photoPx: { value: 1 }, headRect: { value: new THREE.Vector4(0, 0, 1, 1) },
  headTop: { value: 0 }, shade: { value: 0 }, shadeY: { value: 0.5 }, lift: { value: 1 }, sheen: { value: -1 }, k: { value: 1 }, t: { value: 0 }, blurUnder: { value: 2 },
});

/** 標題區（封面座標）：左右留邊、離封面下緣的距離。 */
const PAD = 40;
/** 封面裡的照片往焦點推到幾倍（滿版封面）。 */
const ZOOM = 1.2;

export default class Covershot extends PressPlate {
  bg = shared('covershot.bg', BG);
  deco!: Layer2D;
  head!: Layer2D;
  /** 封面的設計大小（≈ 落定時在畫面上的大小）與位置。 */
  cw = 0; ch = 0; cx = W / 2; cy = H / 2;
  /** 封面的寬高比。 */
  ca = 1;
  /** 標題放在封面上面（放下面會蓋到焦點時）。 */
  headTop = false;
  /** 標題層在封面上的範圍（封面 px）；標題上面那一行相簿名佔的高。 */
  hx = 0; hy = 0; hw = 0; hh = 0;
  kick = 0;
  dir = 1;
  rz0 = 0;

  override async init() {
    await this.loadPhoto(`本期專題ISSUENo.${INITIALS}${DATE_DOTS}`);
    const a = this.aspect;
    // 封面的比例跟著照片（只裁一點點）：直的 0.62～0.8、橫的 1.25～1.55，方的取中間
    const ca = (this.ca = a < 1 ? clamp(a, 0.62, 0.8) : clamp(a, 1.22, 1.55));
    // 大小：橫的寬 1120、直的高 860；很小的照片最多放大 1.5 倍（照片在封面上用到的寬度）
    let cw = ca >= 1 ? 1120 : 860 * ca;
    const cropW = (a > ca ? ca / a : 1) * this.img.w;
    cw = Math.min(cw, cropW * 1.5);
    this.cw = Math.round(cw); this.ch = Math.round(cw / ca);
    // 位置：偏左一點（右下角留給 HUD）；直的雜誌旁邊放上一期
    this.cx = ca >= 1 ? 790 : 760;
    this.cy = ca >= 1 ? 492 : 520;
    this.dir = hash(this.seed, 3) < 0.5 ? -1 : 1;
    this.rz0 = this.dir * 1.4 * (Math.PI / 180);
    // 標題：橫的封面只佔左邊六成（右下是條碼），直的整個寬；最高到封面的一半多一點（60 字的留言＋署名＋歌詞也放得下）
    this.hw = Math.round(Math.min(this.cw - 2 * PAD, ca >= 1 ? this.cw * 0.62 : 9999));
    this.kick = this.photo.album ? 36 : 0;
    const maxH = Math.round(Math.min(this.ch * 0.56, this.ch - 92 - PAD - 24)) - this.kick - 30;
    const st = {
      family: F.ming(700), w: this.hw - 8, h: maxH, lineHeight: 1.32,
      ink: rgba('bone', 0.97), unsung: rgba('bone', 0.42), sigInk: rgba('bone', 0.84), shadow: { color: rgba('ink', 0.55), blur: 12 },
    };
    if (!textFits(this.makeText({ ...st, maxLines: 4 }), maxH)) this.makeText({ ...st, maxLines: 6 });
    const tx = this.text;
    this.hh = Math.round(10 + this.kick + tx.height + tx.size * 0.35 + 12);
    // 標題放下面；放下面會蓋到焦點（臉）——推之前、推到底都算——而上面不會時，改放上面（刊頭下面）
    const c0 = this.pushCrop(0, ca, ZOOM, this.cw), c1 = this.pushCrop(1e6, ca, ZOOM, this.cw);
    const fys = [this.focusAt(c0)[1], this.focusAt(c1)[1]];
    const hit = (r0: number, r1: number) => Math.max(...fys.map((f) => Math.min(f - r0, r1 - f) + 0.06));
    const hb = hit((this.ch - PAD - this.hh) / this.ch, (this.ch - PAD) / this.ch), ht = hit(92 / this.ch, (92 + this.hh) / this.ch);
    this.headTop = this.hasText && hb > 0 && ht < hb;
    this.hx = PAD;
    this.hy = this.headTop ? 92 : this.ch - PAD - this.hh;
    this.deco = this.track(new Layer2D(this.cw, this.ch, SCALE, { fast: true }));
    this.head = this.track(new Layer2D(this.hw, Math.max(40, this.hh), SCALE, { fast: true }));
    this.drawDeco();
    // 沒有字時標題層是空的，也先傳一次（shader 一定會取樣它）
    this.head.upload();
  }

  /** 刊頭、期數、條碼（不會變，畫一次）。 */
  private drawDeco() {
    const L = this.deco, c = L.ctx;
    L.clear();
    c.shadowColor = rgba('ink', 0.45); c.shadowBlur = 8;
    c.fillStyle = rgba('bone', 0.95);
    c.font = font(F.serif(600, true), 38);
    c.textBaseline = 'alphabetic';
    c.fillText(INITIALS, PAD, 62);
    const mw = c.measureText(INITIALS).width;
    c.fillStyle = rgba('bone', 0.8);
    c.fillRect(PAD + mw + 16, 46, 1.5, 18);
    c.font = font(F.mono(500), 14);
    c.letterSpacing = '3px';
    c.fillText(`ISSUE No.${String(this.photo.n).padStart(3, '0')}`, PAD + mw + 30, 60);
    if (DATE_DOTS) {
      c.textAlign = 'right';
      c.fillText(DATE_DOTS, this.cw - PAD, 60);
      c.textAlign = 'left';
    }
    c.letterSpacing = '0px';
    c.shadowBlur = 0;
    // 條碼：一小塊白底黑條，不放在標題那一邊（橫的封面標題只佔左邊六成，條碼放右下；直的放右上）
    const bw = 84, bh = 46, bx = this.cw - PAD - bw;
    const by = this.headTop || this.cw > this.ch ? this.ch - PAD - bh : 84;
    c.fillStyle = rgba('bone', 0.92);
    c.fillRect(bx, by, bw, bh);
    c.fillStyle = rgba('ink', 0.85);
    let x = bx + 6;
    for (let i = 0; x < bx + bw - 8; i++) {
      const w = 1 + Math.floor(hash(i, 17) * 3);
      if (hash(i, 23) > 0.35) c.fillRect(x, by + 5, w, bh - 16);
      x += w + 1 + Math.floor(hash(i, 29) * 2);
    }
    c.font = font(F.mono(400), 8);
    c.fillText(`${String(this.photo.n).padStart(4, '0')} ${String(this.photo.total).padStart(4, '0')}`, bx + 8, by + bh - 3);
    L.upload();
  }

  /** 標題上面一行「本期專題」：短線＋相簿名（小標籤，配角）。 */
  private drawKicker(c: CanvasRenderingContext2D) {
    const album = this.photo.album;
    if (!album) return;
    c.save();
    c.shadowColor = rgba('ink', 0.55); c.shadowBlur = 12;
    c.font = font(F.hei(500), 20);
    c.letterSpacing = '6px';
    c.fillStyle = rgba('signal', 0.95);
    c.fillRect(0, 15, 28, 3);
    c.fillStyle = rgba('bone', 0.9);
    c.fillText(clip(c, album, this.hw - 60), 40, 30);
    c.restore();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    // 放下來：從右上滑進來、轉正、影子收緊（第一拍前後落定）
    const drop = ease.outCubic(prog(t, s, s + 0.8));
    const lift = lerp(2.4, 1, drop);
    const rz = this.rz0 + 7 * (1 - drop) * (Math.PI / 180);
    // 角度慢慢變一點（光澤跟著移）；封面裡的照片往焦點推（推到 1.2 倍），鏡頭也朝焦點那一點小小地推近：一開始快、之後越來越慢
    const z0 = 1 - Math.exp(-lt / 7);
    const crop = this.pushCrop(lt, this.ca, ZOOM, this.cw);
    const cover: Plane = {
      x: this.cx + 240 * (1 - drop), y: this.cy - 90 * (1 - drop), z: -80 * (1 - drop), w: this.cw, h: this.ch,
      rx: (7 - 3 * z0) * (Math.PI / 180), ry: this.dir * (-2.5 + 3 * z0) * (Math.PI / 180), rz,
    };
    const [fxC, fyC] = this.focusAt(crop);
    const [fx, fy] = planePoint(cover, fxC, fyC);
    const cam = { zoom: 1 + 0.04 * z0, cx: lerp(W / 2, fx, 0.5), cy: lerp(H / 2, fy, 0.5) };
    const q = planeQuad(cover, cam);
    const u = this.bg.u;
    homographyPx(q, this.cw, this.ch, u.mCover!.value as THREE.Matrix3);
    // 上一期：右上，斜一點，在焦外
    const portrait = this.cw < this.ch;
    const uw = portrait ? 600 : 640, uh = portrait ? 790 : 840;
    const under: Plane = { x: portrait ? 1400 : 1360, y: portrait ? 340 : 230, z: 40, w: uw, h: uh, rx: 7 * (Math.PI / 180), rz: -this.dir * 9 * (Math.PI / 180) };
    homographyPx(planeQuad(under, cam), uw, uh, u.mUnder!.value as THREE.Matrix3);
    (u.under!.value as THREE.Vector2).set(uw, uh);
    (u.cover!.value as THREE.Vector2).set(this.cw, this.ch);
    (u.crop!.value as THREE.Vector4).set(...crop);
    u.photoPx!.value = (crop[2] - crop[0]) * this.img.w;
    u.photo!.value = this.tex;
    u.phGain!.value = this.gain;
    u.deco!.value = this.deco.texture;
    // 標題：主字（留言或註解）＋歌詞，內容變了才重畫
    if (this.hasText) this.paintText(this.head, t, 0, 10 + this.kick, (c) => this.drawKicker(c));
    u.head!.value = this.head.texture;
    (u.headRect!.value as THREE.Vector4).set(this.hx / this.cw, this.hy / this.ch, this.hw / this.cw, this.head.h / this.ch);
    u.headTop!.value = this.headTop ? 1 : 0;
    u.shade!.value = this.hasText ? 1 : 0.25;
    // 壓暗從標題的頂開始（封面座標，標題在上面時從封面上緣量）
    u.shadeY!.value = this.hasText ? (this.headTop ? 1 - (this.hy + this.hh) / this.ch : this.hy / this.ch) : 0.6;
    u.lift!.value = lift;
    // 窗光掃過封面：每個小節線一次（從左上掃到右下，1.4 秒）
    const bar = barAfter(audio, t - 1.4, 0);
    u.sheen!.value = t >= bar ? lerp(-0.3, 1.6, ease.inOutQuad(prog(t, bar, bar + 1.4))) : -1;
    u.blurUnder!.value = 2.5;
    u.t!.value = t;
    u.k!.value = (0.93 + 0.07 * ease.outCubic(prog(t, s, s + 0.5))) * (1 - 0.08 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    return PHOTO_POST(true);
  }
}
