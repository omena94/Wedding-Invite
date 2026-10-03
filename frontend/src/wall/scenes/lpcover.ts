// 照片版面「唱片封套」（暗，P8 印刷品）：照片是一張 12 吋黑膠的封套，放在深色的絨布檯面上，唱片從封套裡滑出一半——
//  - 封套是正方形：橫的照片在上、下面一條深色的字帶；直的照片在右、左邊一欄字帶；接近方的照片滿版（字壓在照片下緣，下面很淡地壓暗）。
//    照片完整印出（不硬裁成方的），印出來的畫面慢慢往新人點的焦點推（1.15 倍）；很小的舊照片整張封套跟著變小（最多放大約 1.5 倍）。
//  - 字帶上：這一格的字（_photo.ts 的 PhotoText，思源黑體，封面上的標題）——主字（賓客留言＋署名，或新人的註解），
//    歌詞小一號接在下面跟唱，沒有主字時歌詞自己當標題；字帶照字的多少變寬、變高，照片讓位置。
//    另外是新人的縮寫（Cormorant 斜體，小）、唱片編號（縮寫＋婚禮月日，沒有日期用 520）。
//    兩個都沒有就只有縮寫與編號（字帶還是封面設計的一部分）。
//  - 唱片在第一拍前從封套右邊滑出來，滑出來之後開始轉（33⅓ 轉）：溝紋上的反光扇形跟著燈的方向、中間的圓標跟著轉（印著相簿名、SIDE A）。
//  - 一盞暖燈從右上斜照，檯面上一圈光；鏡頭很慢地推近、轉一點點。右下角（HUD）是暗的檯面。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE } from '../engine/gl';
import { rgba } from '../engine/palette';
import { ease, hash, prog } from '../engine/util';
import { INITIALS, DATE_MMDD, beatAfter } from './_motifs';
import { PressPlate, P8_GLSL, PHOTO_POST, F, font, planeQuad, planePoint, homographyPx, clip, textFits, DARK_INK, type Plane, type PressTextStyle } from './_p8';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'press', energy: [0.2, 0.9], bars: [2, 8], weight: 1, prefers: ['square', 'landscape'] };

const BG = () => new FSPass(/* glsl */ `${P8_GLSL}
  uniform sampler2D photo; uniform sampler2D type; uniform sampler2D cap; uniform sampler2D label;
  uniform mat3 mTable; uniform vec2 sleeve; uniform vec2 slvPos; uniform vec4 pr; uniform vec4 crop; uniform float photoPx;
  uniform vec4 band; uniform vec4 capRect; uniform float fullShade; uniform float shadeY; uniform vec2 rec; uniform float recR; uniform float spin;
  uniform vec2 lampP; uniform float k; uniform float t;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 q = homo(mTable, p);
    float s = homoScale(mTable, p);
    // 檯面：深色絨布（很細的毛、一點點不均），右上一盞暖燈的光圈
    float n = fbm(q / 260.0, 3);
    float fuzz = hash12(floor(q * 1.3)) - 0.5;
    vec3 col = mix(C_INK, C_INK2, 0.8) * (0.85 + 0.2 * n + 0.06 * fuzz);
    float dl = length(q - lampP);
    float lamp = 0.5 + 0.6 * exp(-pow(dl / 1300.0, 2.0));
    vec3 warm = mix(vec3(1.0), C_EMBER / max(max(C_EMBER.r, C_EMBER.g), C_EMBER.b), 0.25);
    // 唱片（封套底下滑出來的那一張）
    vec2 rq = q - rec;
    float r = length(rq);
    col *= 1.0 - 0.5 * exp(-max(length(rq - vec2(8.0, 14.0)) - recR, 0.0) / 16.0);
    float aR = clamp(0.5 - (r - recR) / max(s, 0.3), 0.0, 1.0);
    if (aR > 0.0) {
      float ang = atan(rq.y, rq.x);
      // 溝紋：很細的同心圓，幾圈比較寬的空白（曲目之間）
      float gro = 0.5 + 0.5 * sin(r * 2.4);
      float gap = smoothstep(0.0, 2.0, abs(mod(r, recR * 0.17) - recR * 0.085) - recR * 0.07);
      vec3 vc = C_INK * 0.55 * (0.9 + 0.12 * gro);
      // 反光：燈的方向上的扇形（溝紋把光拉成放射狀），跟著溝紋明暗
      vec2 ld = normalize(lampP - rec);
      float la = atan(ld.y, ld.x);
      float sect = pow(abs(cos(ang - la)), 26.0) + 0.5 * pow(abs(cos(ang - la - 0.5)), 60.0);
      float inGroove = smoothstep(recR * 0.36, recR * 0.38, r) * (1.0 - smoothstep(recR * 0.97, recR * 0.99, r));
      vc += mix(C_BONE, C_EMBER, 0.2) * 0.22 * sect * inGroove * (0.6 + 0.4 * gro) * (0.4 + 0.6 * gap);
      vc *= mix(1.0, 0.8, (1.0 - gap) * inGroove);
      // 外緣一圈亮邊
      vc += C_BONE * 0.08 * (1.0 - smoothstep(0.0, 2.5, abs(r - recR + 2.0)));
      // 圓標：跟著轉（字在 label 層，轉回去取樣）
      float lr = recR * 0.34;
      if (r < lr) {
        vec2 lq = rot2(spin) * rq / (lr * 2.0) + 0.5;
        vec3 lc = mix(C_BLOOD, C_SIGNAL, 0.4) * 0.6 * (0.95 + 0.05 * fbm(rq / 20.0, 2));
        vec4 tc = layerAt(label, lq);
        lc = lc * (1.0 - tc.a) + tc.rgb;
        // 中間的軸孔
        lc = mix(lc, C_INK * 0.3, 1.0 - smoothstep(5.0, 6.5, r));
        vc = mix(vc, lc, 1.0 - smoothstep(lr - 1.5, lr, r));
      }
      col = mix(col, vc, aR);
    }
    // 封套：影子、本體
    vec2 sq = q - slvPos;
    col *= 1.0 - 0.55 * exp(-outsideDist(sq - vec2(10.0, 16.0), sleeve) / 20.0);
    float aS = edgeA(sq, sleeve, s);
    if (aS > 0.0) {
      vec3 sc = mix(C_INK2, C_BLOOD, 0.3) * 0.9 * (0.95 + 0.05 * fbm(sq / 12.0, 2));
      // 照片
      vec2 uv = (sq - pr.xy) / pr.zw;
      float inPh = edgeA(sq - pr.xy, pr.zw, s);
      if (inPh > 0.0) {
        float lod = log2(max(s * photoPx / pr.z, 1e-4) / PX_SCALE);
        vec3 ph = photoLin(photo, cropUv(crop, uv), lod);
        // 滿版：字壓在照片下緣，從字的頂開始很淡地壓暗
        ph *= 1.0 - fullShade * 0.55 * smoothstep(shadeY - 0.1, min(shadeY + 0.25, 1.0), uv.y);
        sc = mix(sc, ph, inPh);
      }
      // 字帶的細邊
      vec4 tc = layerAt(type, sq / sleeve);
      sc = sc * (1.0 - tc.a) + tc.rgb;
      vec4 cc = layerAt(cap, (sq - capRect.xy) / capRect.zw);
      sc = sc * (1.0 - cc.a) + cc.rgb;
      // 封套紙板：邊緣磨白一點、上面一道很淡的光澤
      float ed = min(min(sq.x, sleeve.x - sq.x), min(sq.y, sleeve.y - sq.y));
      sc = mix(sc, C_BONE * 0.4, (1.0 - smoothstep(0.0, 3.0, ed)) * 0.5);
      sc += C_BONE * 0.025 * smoothstep(0.4, 0.0, abs((sq.x - sq.y) / sleeve.x + 0.2));
      col = mix(col, sc, aS);
    }
    col *= lamp * warm;
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, phGain: { value: 1 }, type: { value: null }, cap: { value: null }, label: { value: null },
  mTable: { value: new THREE.Matrix3() }, sleeve: { value: new THREE.Vector2() }, slvPos: { value: new THREE.Vector2() },
  pr: { value: new THREE.Vector4() }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, photoPx: { value: 1 }, band: { value: new THREE.Vector4() },
  capRect: { value: new THREE.Vector4() }, fullShade: { value: 0 }, shadeY: { value: 0.55 }, rec: { value: new THREE.Vector2() }, recR: { value: 300 }, spin: { value: 0 },
  lampP: { value: new THREE.Vector2() }, k: { value: 1 }, t: { value: 0 },
});

const TABLE = { w: 3000, h: 2000 };
type R = [number, number, number, number];
const PAD = 34;

export default class Lpcover extends PressPlate {
  bg = shared('lpcover.bg', BG);
  type!: Layer2D;
  cap!: Layer2D;
  label = this.track(new Layer2D(320, 320, SCALE, { fast: true }));
  S = 700;
  /** 照片在封套上的範圍（封套座標）、字帶、字的範圍。 */
  pr: R = [0, 0, 0, 0];
  band: R = [0, 0, 0, 0];
  capR: R = [0, 0, 0, 0];
  /** 字整塊在字的範圍裡的頂（字層座標）。 */
  textTop = 0;
  mode: 'top' | 'side' | 'full' = 'full';
  code = '';
  tOut = 0;
  dir = 1;

  override async init() {
    const { start, audio } = this.ctx;
    this.code = `HL-${DATE_MMDD || '520'}`;
    await this.loadPhoto(`${this.code}${INITIALS}SIDE A33⅓ RPM`);
    const a = this.aspect, tx = this.hasText;
    this.mode = a >= 1.18 ? 'top' : a <= 0.85 ? 'side' : 'full';
    let S = 720;
    // 很小的照片：封套跟著變小（照片最多放大 1.5 倍）
    if (this.mode === 'top') S = Math.min(S, this.img.w * 1.5);
    else if (this.mode === 'side') S = Math.min(S, this.img.h * 1.5);
    else S = Math.min(S, Math.min(this.img.w, this.img.h) * 1.5);
    this.S = S = Math.round(S);
    const full = this.mode === 'full';
    // 滿版時字直接壓在照片上：字邊一圈很淡的暗影
    const st = (w: number, h: number, maxLines: number): PressTextStyle => ({
      family: F.hei(700), w, h, min: 40, max: 50, lineHeight: 1.3, maxLines, ...DARK_INK(),
      shadow: full ? { color: rgba('ink', 0.6), blur: 10 } : null,
    });
    /** 排字：先照四行排，放不下（60 字的留言＋署名＋兩排歌詞）就多折幾行；回傳放不放得下。 */
    const layText = (w: number, h: number, more: number) => {
      if (!textFits(this.makeText(st(w, h, 4)), h)) this.makeText(st(w, h, more));
      return textFits(this.text, h);
    };
    const textH = () => (tx ? this.text.height + this.text.size * 0.35 : 0);
    if (this.mode === 'top') {
      // 字帶要放得下字，不夠高時照片縮小、左右留封套的底色
      const capW = S - 2 * PAD;
      layText(capW, 380, 6);
      const bandH = Math.max(S - S / a, textH() + 28 + 50);
      const h = S - bandH, w = Math.min(S, h * a);
      this.pr = [(S - w) / 2, 0, w, h];
      this.band = [0, h, S, bandH];
      this.capR = [PAD, h + 28, capW, bandH - 28 - 50];
      // 字在字帶裡垂直置中
      this.textTop = Math.max(0, (this.capR[3] - textH()) / 2);
    } else if (this.mode === 'side') {
      // 左邊的字帶要放得下字；放不下就把字帶加寬、照片縮小（上下留底色）
      let bw = Math.max(S - S * a, tx ? 380 : 0);
      while (!layText(bw - 2 * PAD + 12, S - 176, 11) && bw < S * 0.6) bw += 40;
      const w = S - bw, h = Math.min(S, w / a);
      this.pr = [bw, (S - h) / 2, w, h];
      this.band = [0, 0, bw, S];
      this.capR = [PAD - 6, 96, bw - 2 * PAD + 12, S - 176];
    } else {
      // 滿版：字從封套下緣（唱片編號上面）往上長
      this.pr = [0, 0, S, S];
      this.band = [0, S * 0.66, S, S * 0.34];
      const capW = Math.round(S * 0.84);
      layText(capW, S * 0.52, 6);
      this.capR = [PAD, Math.round(S - 54 - textH()), capW, Math.round(textH())];
    }
    this.type = this.track(new Layer2D(S, S, SCALE, { fast: true }));
    this.cap = this.track(new Layer2D(Math.max(40, this.capR[2]) + 10, Math.max(40, this.capR[3]) + 20, SCALE, { fast: true }));
    this.drawType();
    this.drawLabel();
    this.cap.upload();
    this.tOut = beatAfter(audio, start + 0.8);
    this.dir = hash(this.seed, 8) < 0.5 ? -1 : 1;
  }

  /** 封套上的小字：縮寫、唱片編號、SIDE A。 */
  private drawType() {
    const L = this.type, c = L.ctx, S = this.S;
    L.clear();
    const [bx, by, bw, bh] = this.band;
    c.textBaseline = 'alphabetic';
    c.fillStyle = rgba('bone', 0.9);
    c.font = font(F.serif(600, true), 30);
    if (this.mode === 'side') {
      c.fillText(INITIALS, bx + PAD - 6, by + 64);
      c.font = font(F.mono(500), 13);
      c.letterSpacing = '3px';
      c.fillStyle = rgba('bone', 0.6);
      c.fillText(this.code, bx + PAD - 6, by + bh - 40);
      c.fillText('SIDE A · 33⅓ RPM', bx + PAD - 6, by + bh - 20);
    } else {
      const y = by + bh - 24;
      c.font = font(F.mono(500), 13);
      c.letterSpacing = '3px';
      c.fillStyle = rgba('bone', 0.6);
      c.fillText(this.code, PAD, y);
      c.textAlign = 'right';
      c.fillText('SIDE A · 33⅓ RPM', S - PAD, y);
      c.textAlign = 'left';
      c.letterSpacing = '0px';
      c.font = font(F.serif(600, true), 30);
      c.fillStyle = rgba('bone', 0.9);
      c.shadowColor = rgba('ink', 0.5); c.shadowBlur = this.mode === 'full' ? 8 : 0;
      c.fillText(INITIALS, PAD, this.mode === 'top' ? 52 : 56);
      c.shadowBlur = 0;
    }
    c.letterSpacing = '0px';
    // 字帶跟照片之間一條訊號色的細線
    c.fillStyle = rgba('signal', 0.75);
    if (this.mode === 'top') c.fillRect(0, by, S, 3);
    else if (this.mode === 'side') c.fillRect(bx + bw - 3, 0, 3, S);
    L.upload();
  }

  /** 唱片中間的圓標（跟著唱片轉）：相簿名、SIDE A。 */
  private drawLabel() {
    const L = this.label, c = L.ctx, R = 160;
    L.clear();
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.fillStyle = rgba('bone', 0.85);
    c.font = font(F.hei(700), 22);
    c.letterSpacing = '3px';
    if (this.photo.album) c.fillText(clip(c, this.photo.album, 220), R, R - 44);
    c.font = font(F.mono(500), 15);
    c.fillStyle = rgba('bone', 0.7);
    c.fillText('SIDE A', R, R + 62);
    c.font = font(F.serif(600, true), 22);
    c.fillText(INITIALS, R, R + 92);
    c.letterSpacing = '0px';
    c.strokeStyle = rgba('bone', 0.35);
    c.lineWidth = 1.2;
    c.beginPath(); c.arc(R, R, R - 10, 0, Math.PI * 2); c.stroke();
    c.textAlign = 'left';
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const z0 = 1 - Math.exp(-lt / 7);
    const S = this.S;
    const table: Plane = { x: W / 2, y: H / 2, w: TABLE.w, h: TABLE.h, rx: 14 * (Math.PI / 180), rz: this.dir * (0.8 + 0.8 * z0) * (Math.PI / 180) };
    // 封套在檯面上：畫面偏左；唱片從封套右邊滑出一半（第一拍前滑完），滑出來之後開始轉
    const sx = TABLE.w / 2 - S / 2 - 210 + (720 - S) * 0.3, sy = TABLE.h / 2 - S / 2 - 20;
    const out1 = ease.outCubic(prog(t, s + 0.1, this.tOut));
    const recR = S * 0.47;
    const rec: [number, number] = [sx + S / 2 + S * 0.52 * out1, sy + S / 2];
    const [fx, fy] = planePoint(table, (sx + S * 0.75) / TABLE.w, (sy + S / 2) / TABLE.h);
    const cam = { f: 1600, zoom: 0.98 + 0.05 * z0, cx: fx, cy: fy };
    const u = this.bg.u;
    homographyPx(planeQuad(table, cam), TABLE.w, TABLE.h, u.mTable!.value as THREE.Matrix3);
    (u.sleeve!.value as THREE.Vector2).set(S, S);
    (u.slvPos!.value as THREE.Vector2).set(sx, sy);
    (u.pr!.value as THREE.Vector4).set(...this.pr);
    // 封套上的照片往焦點推（1.15 倍；滿版時框是正方形，照片先繞著焦點裁成方的）
    const crop = this.pushCrop(lt, this.pr[2] / this.pr[3], 1.15, this.pr[2]);
    (u.crop!.value as THREE.Vector4).set(...crop);
    u.photoPx!.value = (crop[2] - crop[0]) * this.img.w;
    u.photo!.value = this.tex;
    u.phGain!.value = this.gain;
    u.type!.value = this.type.texture;
    u.label!.value = this.label.texture;
    if (this.hasText) this.paintText(this.cap, t, 0, this.textTop);
    u.cap!.value = this.cap.texture;
    (u.capRect!.value as THREE.Vector4).set(this.capR[0], this.capR[1], this.cap.w, this.cap.h);
    u.fullShade!.value = this.mode === 'full' && this.hasText ? 1 : 0;
    u.shadeY!.value = this.capR[1] / this.S;
    (u.rec!.value as THREE.Vector2).set(...rec);
    u.recR!.value = recR;
    // 33⅓ 轉：一秒轉 0.555 圈；滑出來之後才開始轉（慢慢加速）
    const run = Math.max(0, t - this.tOut);
    u.spin!.value = -(2 * Math.PI * 0.5556) * (run - 0.4 * (1 - Math.exp(-run / 0.4)));
    (u.lampP!.value as THREE.Vector2).set(sx + S * 1.2, sy - S * 0.25);
    u.t!.value = lt;
    u.k!.value = (0.8 + 0.2 * ease.outCubic(prog(t, s, s + 0.6))) * (1 - 0.1 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    return PHOTO_POST(false, { vignette: 0.5 });
  }
}
