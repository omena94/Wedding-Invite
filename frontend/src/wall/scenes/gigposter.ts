// 照片版面「演唱會海報」（暗，P8 印刷品）：照片做成雙色網版印刷的海報，貼在夜裡的街角牆上——
//  - 牆：粗糙的水泥，上面有一層層撕剩的舊海報（暗暗的、褪色）；左上一盞路燈照下來，光圈外很暗。
//    鏡頭很慢地往右橫移、推近，前景一根焦外的柱子跑得比較快（視差）；每兩個小節一輛車開過，車燈的光從左掃到右。
//  - 海報：照片印成兩色（訊號色＋深墨，紙色當最亮的白），色調是連續的（不是色塊），所以照片還是認得出是誰；
//    每個大鼓兩版的套準「跳」一下（訊號色那版錯開幾 px 再彈回）。紙被漿糊貼得有點皺，右下角翹起來（看得到紙背、底下的牆）。
//  - 橫的照片：照片在上、下面一條深墨的字帶；直的照片：照片在左、右邊是字帶。字帶上反白印這一格的字（_photo.ts 的 PhotoText，思源黑體）：
//    主字（賓客留言＋署名，或新人的註解），歌詞小一號接在下面跟唱；沒有主字時歌詞自己當主字。字帶照字的高度長，照片讓位置。
//    上下兩行小字（「ONE NIGHT ONLY」、新人的英文名、日期；沒有的那段省掉）。
//    兩個都沒有就只剩一條小字，海報變成「照片＋一條小字」，在正中間。
//  - 進場：路燈閃兩下亮起來（像剛點亮的鈉燈）。照片完整印出，印出來的畫面慢慢往新人點的焦點推（1.18 倍）；
//    很小的舊照片最多放大到原尺寸約 1.5 倍。
//  - 右下角（HUD）是暗的牆。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE } from '../engine/gl';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { COUPLE_EN, DATE_DOTS, joinBits, fitPx, barAfter } from './_motifs';
import { PressPlate, P8_GLSL, PHOTO_POST, F, font, planeQuad, homographyPx, textFits, DARK_INK, type Plane, type PressTextStyle } from './_p8';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'press', energy: [0.3, 1], bars: [2, 8], weight: 1, prefers: ['landscape'] };

/** 牆（設計 px）：比畫面大很多，海報在牆的中間附近。 */
const WALL = { w: 3200, h: 2000 };

const BG = () => new FSPass(/* glsl */ `${P8_GLSL}
  uniform sampler2D photo; uniform sampler2D type; uniform sampler2D cap;
  uniform mat3 mWall; uniform vec2 wall; uniform vec4 poster; uniform vec4 pr; uniform vec4 crop; uniform vec4 band; uniform float photoPx;
  uniform vec4 capRect; uniform vec2 mis; uniform float fold; uniform vec2 lamp; uniform float lampK; uniform float car;
  uniform float pole; uniform float k; uniform float t;
  // 舊海報的碎片：一塊一塊歪歪的紙，邊緣被撕得不整齊
  float scrap(vec2 q, vec2 c, vec2 hs, float ang, float seed) {
    vec2 l = rot2(ang) * (q - c);
    float rag = 18.0 * fbm(l / 60.0 + seed, 3);
    return 1.0 - smoothstep(-1.5, 1.5, sdBox(l, hs) + rag);
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 q = homo(mWall, p);
    float s = homoScale(mWall, p);
    // 路燈：左上一盞，光圈的邊很軟；路燈外是很暗的藍灰
    float dl = length((q - lamp) * vec2(1.0, 1.25));
    float light = lampK * (0.1 + 0.9 * exp(-pow(dl / 1100.0, 2.0)));
    // 車燈：從左掃到右的一大片光（很淡）
    float carL = car > 0.0 ? 0.22 * exp(-pow((q.x - car) / 260.0, 2.0)) * smoothstep(1500.0, 700.0, q.y) : 0.0;
    float lit = light + carL;
    // 牆：水泥
    float n = fbm(q / 140.0, 4);
    float grit = hash12(floor(q / 2.0)) - 0.5;
    vec3 wallC = mix(C_INK2, C_GRAPHITE, 0.35) * (0.75 + 0.3 * n + 0.08 * grit);
    // 舊海報的碎片（褪色、在暗處）
    float sc = 0.0; vec3 scC = vec3(0.0);
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      vec2 c = poster.xy + poster.zw * vec2(hash11(fi * 3.1 + 0.4) * 1.5 - 0.25, hash11(fi * 7.7 + 0.2) * 1.3 - 0.15);
      float a = scrap(q, c, vec2(130.0 + 130.0 * hash11(fi * 1.3), 90.0 + 120.0 * hash11(fi * 2.9)), (hash11(fi * 5.3) - 0.5) * 0.5, fi * 13.0);
      vec3 cc = mix(C_ASH, i == 1 ? C_BLOOD : i == 3 ? C_SIGNAL : C_BONE, 0.3) * (0.22 + 0.1 * hash11(fi));
      scC = mix(scC, cc, a); sc = max(sc, a);
    }
    vec3 col = mix(wallC, scC * (0.9 + 0.1 * n), sc * 0.8);
    // 海報（牆上的一塊）：右下角翹起來
    vec2 pq = q - poster.xy;
    vec2 ps = poster.zw;
    vec2 nd = normalize(vec2(1.0));
    float u = dot(ps - pq, nd);
    float inP = edgeA(pq, ps, s);
    float peeled = smoothstep(fold - s, fold + s, u);
    // 翹起來的那一角翻過來蓋在海報上（紙背），翻折線旁邊有影子
    vec2 pm = pq + 2.0 * (u - fold) * nd;
    float flap = (u > fold && u < 2.0 * fold) ? edgeA(pm, ps, s) * (1.0 - smoothstep(2.0 * fold - s, 2.0 * fold + s, u)) : 0.0;
    if (inP * peeled > 0.0) {
      // 紙：漿糊貼的皺紋（低頻的凹凸＋幾道皺褶），打光跟著皺紋
      float wr = fbm(pq / 90.0 + 3.0, 3);
      float crease = exp(-pow((dot(pq, normalize(vec2(0.3, 1.0))) - ps.y * 0.42 - 40.0 * wr) / 2.5, 2.0)) * 0.6;
      float shadeP = 1.0 + 0.09 * wr - 0.12 * crease;
      vec3 paper = mix(C_BONE, C_PAPER, 0.4) * 0.78;
      vec3 pc = paper;
      // 照片：雙色（訊號色＋深墨）；訊號色那版錯開 mis
      vec2 uv = (pq - pr.xy) / pr.zw;
      vec2 uv1 = (pq - mis - pr.xy) / pr.zw;
      float inPh = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
      float inPh1 = step(0.0, uv1.x) * step(uv1.x, 1.0) * step(0.0, uv1.y) * step(uv1.y, 1.0);
      float lod = log2(max(s * photoPx / pr.z, 1e-4) / PX_SCALE);
      vec3 ph = photoLin(photo, cropUv(crop, uv), lod) / 0.82;
      float L = pow(luma(ph), 0.85);
      float L1 = pow(luma(photoLin(photo, cropUv(crop, uv1), lod) / 0.82), 0.85);
      // 深墨（暗部）、訊號色（中間調）：連續的濃淡，跟一點原本的顏色
      float cDark = (1.0 - smoothstep(0.08, 0.62, L)) * inPh;
      float cSig = (1.0 - smoothstep(0.35, 0.95, L1)) * inPh1;
      vec3 sigInk = mix(vec3(1.0), C_SIGNAL / max(max(C_SIGNAL.r, C_SIGNAL.g), C_SIGNAL.b), 0.85);
      vec3 darkInk = mix(C_INK, C_BLOOD, 0.35) * 1.4 + 0.02;
      pc *= mix(vec3(1.0), sigInk, cSig);
      pc *= mix(vec3(1.0), darkInk / paper, cDark * 0.92);
      pc = mix(pc, paper * ph, 0.18 * inPh);
      // 字帶：深墨的實地
      vec2 bq = pq - band.xy;
      float inB = step(0.0, bq.x) * step(bq.x, band.z) * step(0.0, bq.y) * step(bq.y, band.w);
      pc = mix(pc, mix(C_INK, C_BLOOD, 0.3) * 1.3 + 0.015, inB * 0.96);
      // 網版的油墨不均（很淡的斑）
      pc *= 0.96 + 0.06 * fbm(pq / 35.0, 2);
      // 字（小字、註解）：反白印在深墨上
      vec4 tc = layerAt(type, pq / ps);
      pc = pc * (1.0 - tc.a) + tc.rgb;
      vec4 cc = layerAt(cap, (pq - capRect.xy) / capRect.zw);
      pc = pc * (1.0 - cc.a) + cc.rgb;
      pc *= shadeP;
      // 翻起來那一角在海報上的影子
      pc *= 1.0 - 0.45 * exp(-max(u - 2.0 * fold, 0.0) / 16.0) * step(fold, u) * smoothstep(0.0, 30.0, fold);
      col = mix(col, pc, inP * peeled);
    }
    if (flap > 0.0) {
      // 紙背：沒有印東西，透一點點正面的影子，越靠近翻折線越亮（翹起來對著光）
      float g = (u - fold) / max(fold, 1.0);
      vec3 back = mix(C_BONE, C_PAPER, 0.5) * (0.62 + 0.18 * g) * (0.95 + 0.05 * fbm(pm / 40.0, 2));
      col = mix(col, back, flap);
    }
    col *= lit;
    // 前景焦外的柱子（暗、很軟的邊）
    float pd = abs(p.x - pole) - 46.0;
    col *= 1.0 - 0.88 * (1.0 - smoothstep(-30.0, 40.0, pd));
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, phGain: { value: 1 }, type: { value: null }, cap: { value: null },
  mWall: { value: new THREE.Matrix3() }, wall: { value: new THREE.Vector2(WALL.w, WALL.h) },
  poster: { value: new THREE.Vector4() }, pr: { value: new THREE.Vector4() }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, band: { value: new THREE.Vector4() }, photoPx: { value: 1 },
  capRect: { value: new THREE.Vector4() }, mis: { value: new THREE.Vector2() }, fold: { value: 80 },
  lamp: { value: new THREE.Vector2() }, lampK: { value: 1 }, car: { value: -1 }, pole: { value: -200 }, k: { value: 1 }, t: { value: 0 },
});

type R = [number, number, number, number];

export default class Gigposter extends PressPlate {
  bg = shared('gigposter.bg', BG);
  type!: Layer2D;
  cap!: Layer2D;
  /** 海報大小、照片（海報座標）、字帶（海報座標）、字的範圍（海報座標）。 */
  pw = 0; phh = 0;
  pr: R = [0, 0, 0, 0];
  band: R = [0, 0, 0, 0];
  capR: R = [0, 0, 0, 0];
  side = false;
  /** 海報在牆上的位置（牆座標的左上角）。 */
  px = 0; py = 0;
  topLine = 'ONE NIGHT ONLY';
  botLine = '';

  override async init() {
    this.botLine = joinBits('  ·  ', COUPLE_EN, DATE_DOTS);
    await this.loadPhoto(`${this.topLine}${this.botLine}特別來賓：在場的每一位`);
    const a = this.aspect, tx = this.hasText;
    const M = 30; // 照片四周的紙邊
    const st = (w: number, h: number, maxLines = 4): PressTextStyle => ({ family: F.hei(900), w, h, min: 40, max: 50, lineHeight: 1.28, maxLines, ...DARK_INK() });
    /** 排字：先照四行排，60 字的留言放不下就多折幾行；回傳放不放得下。 */
    const layText = (w: number, h: number, more: number) => {
      if (!textFits(this.makeText(st(w, h)), h)) this.makeText(st(w, h, more));
      return textFits(this.text, h);
    };
    // 直的照片＋字：照片在左、字帶在右；其他：照片在上、字帶在下
    this.side = tx && a < 1;
    if (this.side) {
      let h = 770 - 2 * M;
      h = Math.min(h, this.img.h * 1.5);
      const w = h * a;
      this.pr = [M, M, w, h];
      // 字帶的寬：放不下（60 字的留言＋署名＋兩排歌詞）就加寬，最多 560
      let bw = 440;
      while (!layText(bw - 68, h - 230, 9) && bw < 560) bw += 40;
      this.pw = M + w + M + bw + M; this.phh = h + 2 * M;
      this.band = [M + w + M, M, bw, h];
      this.capR = [this.band[0] + 34, M + 120, bw - 68, h - 230];
    } else {
      if (tx) {
        // 照片在上、字帶在下：字帶的高度照字排出來的高度，照片用剩下的高度（太矮時左右留紙邊）
        const iw = Math.min(900, this.img.w * 1.5 + 200);
        layText(iw - 68, 380, 6);
        const bandH = Math.round(Math.max(170, this.text.height + this.text.size * 0.35 + 54 + 50));
        let h = Math.min(iw / a, 840 - bandH - 3 * M);
        h = Math.min(h, this.img.h * 1.5);
        const w = h * a;
        this.pr = [M + (iw - w) / 2, M, w, h];
        this.pw = iw + 2 * M; this.phh = M + h + M + bandH + M;
        this.band = [M, M + h + M, iw, bandH];
        this.capR = [M + 34, this.band[1] + 54, iw - 68, bandH - 54 - 46];
      } else {
        const bandH = 74;
        let w = a >= 1 ? 900 : (780 - bandH - 3 * M) * a;
        w = Math.min(w, (840 - bandH - 3 * M) * a, this.img.w * 1.5);
        const h = w / a;
        this.pr = [M, M, w, h];
        this.pw = w + 2 * M; this.phh = M + h + M + bandH + M;
        this.band = [M, M + h + M, w, bandH];
        this.capR = [M + 34, this.band[1] + 54, w - 68, 0];
        this.makeText(st(w - 68, 100));
      }
    }
    this.pw = Math.round(this.pw); this.phh = Math.round(this.phh);
    // 海報在牆上：畫面偏左一點（右下角留給 HUD）
    this.px = WALL.w / 2 - this.pw / 2 - (this.side ? 150 : 100);
    this.py = WALL.h / 2 - this.phh / 2 - 20;
    this.type = this.track(new Layer2D(this.pw, this.phh, SCALE, { fast: true }));
    this.cap = this.track(new Layer2D(Math.max(40, this.capR[2]) + 20, Math.max(40, this.capR[3]) + 20, SCALE, { fast: true }));
    this.drawType();
    this.cap.upload();
  }

  /** 字帶上的小字：上面「ONE NIGHT ONLY」，下面英文名與日期、特別來賓。 */
  private drawType() {
    const L = this.type, c = L.ctx;
    L.clear();
    const [bx, by, bw, bh] = this.band;
    // 字帶上的小字都是配角（≤ 22 px、低對比），焦點留給註解
    const paperC = rgba('bone', 0.58);
    c.textBaseline = 'alphabetic';
    if (this.hasText) {
      c.font = font(F.mono(500), 18);
      c.letterSpacing = '5px';
      c.fillStyle = rgba('signal', 0.7);
      c.fillText(this.topLine, bx + 34, by + 40);
      c.letterSpacing = '0px';
      c.font = font(F.hei(500), 18);
      c.fillStyle = rgba('bone', 0.48);
      c.fillText('特別來賓：在場的每一位', bx + 34, by + bh - 22);
      // 直的：字帶的右下角靠近 HUD、又是翹起來的那一角，英文名與日期放在上面「ONE NIGHT ONLY」下面
    }
    if (this.botLine) {
      const fam = F.archivo(75, 700);
      const size = fitPx(this.botLine, fam, 21, bw - 68, 3);
      c.font = font(fam, size);
      c.letterSpacing = '3px';
      c.fillStyle = paperC;
      c.textAlign = 'right';
      if (this.hasText && !this.side) c.fillText(this.botLine, bx + bw - 34, by + 40);
      else if (this.hasText) { c.textAlign = 'left'; c.fillText(this.botLine, bx + 34, by + 78); }
      else { c.textAlign = 'center'; c.fillText(this.botLine, bx + bw / 2, by + bh / 2 + 9); }
      c.textAlign = 'left';
      c.letterSpacing = '0px';
    }
    L.upload();
  }

  /** 字在字帶裡的頂（字層座標）：整塊貼著字帶的中間。 */
  private get textTop() { return Math.max(0, (this.capR[3] - this.text.height) / 2); }

  /**
   * 右下角翹起來的那一角最大能掀多大：翻過來的紙背（離角 fold～2·fold）不能蓋到字。
   * 字的右下角離海報右下角（沿對角線）多遠，一半就是上限。
   */
  private get foldMax() {
    if (!this.hasText) return 100;
    const bottom = this.capR[1] + this.textTop + this.text.height + this.text.size * 0.35;
    const d = (this.pw - (this.capR[0] + this.capR[2]) + (this.phh - bottom)) / Math.SQRT2;
    return Math.max(18, (d - 12) / 2);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const z0 = 1 - Math.exp(-lt / 7);
    // 牆往右後方轉一點（有透視）；鏡頭慢慢往右橫移、推近
    const wall: Plane = { x: W / 2, y: H / 2, w: WALL.w, h: WALL.h, ry: -7 * (Math.PI / 180), rz: -0.6 * (Math.PI / 180) };
    const cam = { f: 1700, zoom: 1.0 + 0.05 * z0, cx: W / 2 - 100, cy: H / 2, dx: 40 - 70 * ease.inOutQuad(clamp(lt / 12)), dy: 0 };
    const u = this.bg.u;
    homographyPx(planeQuad(wall, cam), WALL.w, WALL.h, u.mWall!.value as THREE.Matrix3);
    (u.poster!.value as THREE.Vector4).set(this.px, this.py, this.pw, this.phh);
    (u.pr!.value as THREE.Vector4).set(...this.pr);
    (u.band!.value as THREE.Vector4).set(...this.band);
    // 印出來的照片往焦點推（貼在牆上的海報，1.18 倍）
    const crop = this.pushCrop(lt, this.pr[2] / this.pr[3], 1.18, this.pr[2]);
    (u.crop!.value as THREE.Vector4).set(...crop);
    u.photoPx!.value = (crop[2] - crop[0]) * this.img.w;
    u.photo!.value = this.tex;
    u.phGain!.value = this.gain;
    u.type!.value = this.type.texture;
    if (this.hasText) this.paintText(this.cap, t, 0, this.textTop);
    u.cap!.value = this.cap.texture;
    (u.capRect!.value as THREE.Vector4).set(this.capR[0], this.capR[1], this.cap.w, this.cap.h);
    // 套準：每個大鼓訊號色那版跳開幾 px，再彈回來
    const kick = f.a.kick ?? 0;
    const ang = hash(Math.floor(f.beat), 7) * Math.PI * 2;
    (u.mis!.value as THREE.Vector2).set(3 + 9 * kick * Math.cos(ang), 2 + 9 * kick * Math.sin(ang));
    // 右下角翹起來：風吹得一點點掀動（拍點上多掀一點）
    // （字多、排到字帶右下角時掀小一點，翻過來的紙背不蓋到字）
    const fm = this.foldMax;
    u.fold!.value = Math.min(74, fm - 24) + Math.min(10, fm * 0.12) * Math.sin(lt * 1.3 + this.seed) + Math.min(14, fm * 0.14) * (f.a.snare ?? 0);
    // 路燈：進場閃兩下亮起來；之後偶爾在小節線閃一下（很輕）
    const on = lt < 0.12 ? 0.25 : lt < 0.2 ? 0.85 : lt < 0.3 ? 0.35 : 0.35 + 0.65 * ease.outCubic(prog(lt, 0.3, 0.7));
    const bar = barAfter(audio, t - 0.15, 0);
    const flick = t >= bar && t < bar + 0.15 && hash(Math.round(bar * 10), 3) < 0.3 ? 0.85 : 1;
    u.lampK!.value = on * flick;
    (u.lamp!.value as THREE.Vector2).set(this.px + this.pw * 0.4, this.py - 160);
    // 車燈：每兩個小節一輛，2.2 秒掃過整面牆
    const b2 = audio.timeOfBar(Math.floor(audio.barAt(t) / 2) * 2);
    const ct = t - b2;
    u.car!.value = ct >= 0 && ct < 2.2 && lt > 0.8 ? lerp(this.px - 900, this.px + this.pw + 900, ease.inOutQuad(ct / 2.2)) : -1e4;
    // 前景的柱子：從畫面左邊慢慢滑出去（比牆快，視差）
    u.pole!.value = 150 - 160 * ease.inOutQuad(clamp(lt / 12));
    u.t!.value = lt;
    u.k!.value = 1 - 0.1 * prog(t, e - 0.3, e);
    this.bg.render(renderer, out);
    return PHOTO_POST(false, { vignette: 0.55 });
  }
}
