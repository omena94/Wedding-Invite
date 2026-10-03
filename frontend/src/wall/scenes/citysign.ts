// 照片版面「街頭看板」（暗，P8 印刷品）：傍晚的街角，對面樓頂的大看板上是新人的照片——
//  - 天色是剛入夜的藍（主題的暗色往下慢慢轉暖），遠處一排樓的剪影、零星亮著的窗；左邊一棟近的樓。
//    看板架在中間偏右那棟樓的樓頂（鋼架、上緣三盞投光燈）；照片在看板上，看板上的照片慢慢往新人點的焦點推（1.22 倍）。
//    橫的照片：下面一條深色的字帶；直的照片：右邊一欄深色的字欄。照片完整印出，很小的舊照片最多放大約 1.5 倍。
//  - 字（_photo.ts 的 PhotoText，思源黑體）：字帶（字欄）上印主字（賓客留言＋署名，或新人的註解），右下小小的日期（沒有日期就不印）；
//    這時歌詞不擠上看板，像字幕放在畫面下方暗暗的街上（lyricsApart，位置固定）。沒有主字時歌詞自己印在字帶上跟唱；
//    兩個都沒有就沒有字帶（看板只有照片）。右下角（HUD）是暗的街角。
//  - 進場：投光燈閃一下亮起來，照亮看板；街燈從近到遠，一拍亮一盞（暖色、會發一點光），路面上一圈一圈的光。
//  - 鏡頭從街上慢慢往上搖、推近看板；近的街燈比遠的樓移得多（視差）。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE } from '../engine/gl';
import { rgba } from '../engine/palette';
import { ease, prog } from '../engine/util';
import { DATE_DOTS, beatAfter } from './_motifs';
import { PressPlate, P8_GLSL, PHOTO_POST, F, font, planeQuad, planePoint, homographyPx, clip, textFits, DARK_INK, DARK_LYRIC, type Plane, type PressTextStyle } from './_p8';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'press', energy: [0.25, 1], bars: [2, 8], weight: 1, prefers: ['landscape'] };

const NL = 7;

const BG = () => new FSPass(/* glsl */ `${P8_GLSL}
  uniform sampler2D photo; uniform sampler2D type; uniform sampler2D cap;
  uniform mat3 mBoard; uniform vec2 board; uniform vec4 pr; uniform vec4 crop; uniform float photoPx; uniform vec4 capRect;
  uniform vec4 lamps[${NL}]; uniform float lampOn[${NL}]; uniform vec2 flP[3]; uniform float flood; uniform float horizon; uniform vec2 boardBase;
  uniform vec2 camOff; uniform float camZoom; uniform float k; uniform float t;
  // 一排樓的剪影：x 方向一格一格，高度用 hash
  float skyline(float x, float base, float w, float hMin, float hMax, float seed) {
    float i = floor(x / w);
    return base - mix(hMin, hMax, hash11(i * 1.7 + seed));
  }
  float windows(vec2 p, float seed, float density) {
    vec2 c = floor(p / vec2(30.0, 42.0));
    vec2 f = fract(p / vec2(30.0, 42.0));
    float on = step(hash12(c + seed), density) * (0.6 + 0.4 * hash12(c + seed + 7.0));
    return on * smoothstep(0.18, 0.24, f.x) * (1.0 - smoothstep(0.76, 0.82, f.x)) * smoothstep(0.28, 0.34, f.y) * (1.0 - smoothstep(0.74, 0.8, f.y));
  }
  void main() {
    vec2 p0 = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 鏡頭：推近＋往上搖（畫面往下移）
    vec2 p = (p0 - vec2(${W / 2}.0, ${H / 2}.0)) / camZoom + vec2(${W / 2}.0, ${H / 2}.0) - camOff;
    // 天空：上面暗藍、往地平線轉暖（還有一點天光）
    float sy = clamp(p.y / horizon, 0.0, 1.0);
    vec3 skyTop = mix(C_INK, C_INK2, 0.7) * vec3(0.75, 0.9, 1.35);
    vec3 skyLow = mix(C_GRAPHITE, C_EMBER, 0.18) * 0.5;
    vec3 col = mix(skyTop, skyLow, pow(sy, 1.8));
    // 很淡的雲，被城市的光從下面照到一點
    col += mix(C_GRAPHITE, C_EMBER, 0.3) * 0.03 * smoothstep(0.0, 0.6, fbm(vec2(p.x / 700.0 + t * 0.008, p.y / 140.0), 3)) * sy;
    // 遠的樓（視差比較小）
    float px1 = p.x + camOff.x * -0.5;
    float h1 = skyline(px1, horizon + 10.0, 120.0, 170.0, 430.0, 3.0);
    float b1 = step(h1, p.y);
    vec3 farC = mix(skyLow, C_INK2, 0.55) * 0.9;
    farC += mix(C_EMBER, C_BONE, 0.5) * 0.1 * windows(vec2(px1, p.y) * 1.6, 5.0, 0.1);
    col = mix(col, farC, b1);
    // 看板底下那棟樓（樓頂在看板下面）與鋼架
    float roof = boardBase.y + 70.0;
    float inB = step(boardBase.x - 420.0, p.x) * step(p.x, boardBase.x + 470.0) * step(roof, p.y);
    vec3 midC = C_INK2 * 0.7 + mix(C_EMBER, C_BONE, 0.4) * 0.14 * windows(p + vec2(3.0, 0.0), 11.0, 0.14) * step(roof + 30.0, p.y);
    col = mix(col, midC, inB);
    float legs = 0.0;
    for (int i = 0; i < 3; i++) {
      float lx = boardBase.x + (float(i) - 1.0) * 300.0;
      legs = max(legs, (1.0 - smoothstep(5.0, 7.0, abs(p.x - lx))) * step(boardBase.y - 20.0, p.y) * step(p.y, roof));
    }
    legs = max(legs, (1.0 - smoothstep(2.0, 3.5, abs(p.y - boardBase.y - 40.0))) * step(boardBase.x - 360.0, p.x) * step(p.x, boardBase.x + 360.0));
    col = mix(col, C_INK * 0.8, legs);
    // 左邊近的樓（視差大）
    float px2 = p.x + camOff.x * 0.6;
    float nb = 1.0 - smoothstep(268.0, 272.0, px2);
    vec3 nearC = C_INK * 0.9 + mix(C_EMBER, C_BONE, 0.4) * 0.16 * windows(vec2(px2, p.y) * 0.7, 21.0, 0.12);
    col = mix(col, nearC, nb);
    // 路面：暗的柏油，路燈的倒影（直直往下拉長）
    float road = smoothstep(horizon + 18.0, horizon + 22.0, p.y);
    vec3 roadC = mix(C_INK, C_INK2, 0.5) * (0.8 + 0.2 * fbm(p / vec2(220.0, 40.0), 2));
    col = mix(col, roadC, road);
    // 看板
    vec2 q = homo(mBoard, p);
    float s = homoScale(mBoard, p);
    float aB = edgeA(q, board, s);
    // 看板的框（比較厚的深色邊）
    vec2 qf = q - board * 0.5;
    float fd = sdBox(qf, board * 0.5 + 14.0);
    col = mix(col, C_INK2 * 0.9 + C_BONE * 0.02, clamp(0.5 - fd / max(s, 0.3), 0.0, 1.0));
    if (aB > 0.0) {
      vec2 uv = q / board;
      // 投光燈：上緣三盞往下照，上面亮、下面暗一點，燈下面各一塊亮
      float spots = 0.0;
      for (int i = 0; i < 3; i++) {
        float sx = (float(i) + 0.5) / 3.0;
        spots += exp(-pow((uv.x - sx) * 3.2, 2.0) - uv.y * 1.6);
      }
      float light = mix(0.16, 1.0, flood) * (0.55 + 0.3 * spots + 0.15 * (1.0 - uv.y));
      vec3 bc = C_INK2 * 1.2;
      vec2 puv = (q - pr.xy) / pr.zw;
      float inPh = edgeA(q - pr.xy, pr.zw, s);
      if (inPh > 0.0) {
        float lod = log2(max(s * photoPx / pr.z, 1e-4) / PX_SCALE);
        bc = mix(bc, photoLin(photo, cropUv(crop, puv), lod), inPh);
      }
      vec4 tc = layerAt(type, uv);
      bc = bc * (1.0 - tc.a) + tc.rgb;
      vec4 cc = layerAt(cap, (q - capRect.xy) / capRect.zw);
      bc = bc * (1.0 - cc.a) + cc.rgb;
      col = mix(col, bc * light, aB);
    }
    // 投光燈的燈具與光束（空氣裡很淡）
    for (int i = 0; i < 3; i++) {
      vec2 fp = flP[i];
      float fx = abs(p.x - fp.x), fy = p.y - fp.y;
      col = mix(col, C_INK * 0.6, (1.0 - smoothstep(10.0, 12.0, fx)) * step(-8.0, fy) * step(fy, 6.0));
      float cone = flood * exp(-pow(fx / (20.0 + max(fy, 0.0) * 0.45), 2.0)) * step(0.0, fy) * exp(-max(fy, 0.0) / 260.0);
      col += mix(C_EMBER, C_BONE, 0.5) * 0.05 * cone;
    }
    // 街燈：近的大、遠的小；亮起來的燈頭發一點光，地上一圈光、路面拉長的倒影
    for (int i = 0; i < ${NL}; i++) {
      vec4 L = lamps[i];
      float on = lampOn[i];
      vec2 lp = L.xy + vec2(camOff.x * (0.6 - float(i) * 0.08), 0.0);
      float sc = L.z;
      vec2 head = lp + vec2(46.0 * sc, -L.w + 6.0 * sc);
      float post = sdSegment(p, lp, lp - vec2(0.0, L.w)) - 6.0 * sc;
      float arm = sdSegment(p, lp - vec2(0.0, L.w), head) - 4.0 * sc;
      // 燈罩：燈頭上面一小塊
      arm = min(arm, sdBox(p - head - vec2(0.0, -3.0 * sc), vec2(16.0, 5.0) * sc));
      col = mix(col, C_INK * 0.7, 1.0 - smoothstep(-0.8, 0.8, min(post, arm)));
      if (on > 0.0) {
        vec3 warm = mix(C_EMBER, C_SIGNAL, 0.3);
        float d = length(p - head - vec2(0.0, 6.0 * sc));
        col += warm * on * (2.4 * (1.0 - smoothstep(8.0 * sc, 11.0 * sc, d)) + 0.22 * exp(-d / (95.0 * sc)));
        vec2 gq = (p - vec2(head.x, lp.y + 6.0 * sc)) / vec2(170.0 * sc, 36.0 * sc);
        col += warm * on * 0.08 * exp(-dot(gq, gq)) * road;
        float refl = exp(-pow((p.x - head.x) / (10.0 * sc), 2.0)) * smoothstep(lp.y, lp.y + 20.0, p.y) * exp(-(p.y - lp.y) / (200.0 * sc));
        col += warm * on * 0.07 * refl * road;
      }
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, phGain: { value: 1 }, type: { value: null }, cap: { value: null },
  mBoard: { value: new THREE.Matrix3() }, board: { value: new THREE.Vector2() }, pr: { value: new THREE.Vector4() },
  crop: { value: new THREE.Vector4(0, 0, 1, 1) }, photoPx: { value: 1 },
  capRect: { value: new THREE.Vector4() },
  lamps: { value: Array.from({ length: NL }, () => new THREE.Vector4()) }, lampOn: { value: new Array(NL).fill(0) },
  flP: { value: [0, 1, 2].map(() => new THREE.Vector2()) },
  flood: { value: 0 }, horizon: { value: 760 }, boardBase: { value: new THREE.Vector2() },
  camOff: { value: new THREE.Vector2() }, camZoom: { value: 1 }, k: { value: 1 }, t: { value: 0 },
});

type R = [number, number, number, number];
const HORIZON = 940;

export default class Citysign extends PressPlate {
  bg = shared('citysign.bg', BG);
  type!: Layer2D;
  cap!: Layer2D;
  bw = 0; bh = 0;
  pr: R = [0, 0, 0, 0];
  /** 字帶（橫的：照片下面一條；直的：照片右邊一欄）、字的範圍（看板座標）。 */
  band: R = [0, 0, 0, 0];
  capR: R = [0, 0, 0, 0];
  /** 字整塊在字的範圍裡的頂（字層座標）。 */
  textTop = 0;
  side = false;
  /** 看板在畫面上的中心（鏡頭還沒動的時候）。 */
  cx = 1010; cy = 380;
  lampT: number[] = [];
  tFlood = 0;

  override async init() {
    const { start, audio } = this.ctx;
    await this.loadPhoto(DATE_DOTS);
    const a = this.aspect, tx = this.hasText;
    // 看板上的字：主字（留言或註解）；有主字又有歌詞時，歌詞是畫面下方街上的字幕（看板上寫不下兩組大字）
    const st = (w: number, h: number, maxLines = 4): PressTextStyle => ({
      family: F.hei(700), w, h, min: 40, max: 48, lineHeight: 1.26, maxLines, ...DARK_INK(),
      lyricsApart: true, lyricW: 1000, apartAlign: 'center', apartInk: DARK_LYRIC(),
    });
    /** 排字：先照四行排，60 字的留言放不下就多折幾行；回傳放不放得下。 */
    const layText = (w: number, h: number, more: number) => {
      if (!textFits(this.makeText(st(w, h)), h)) this.makeText(st(w, h, more));
      return textFits(this.text, h);
    };
    const textH = () => (tx ? this.text.height + this.text.size * 0.35 : 0);
    // 直的照片＋字：照片在左、右邊一欄字（直的看板配下面一條字帶，照片會被擠得很小）
    this.side = tx && a < 1;
    if (this.side) {
      const ph = Math.min(560, this.img.h * 1.5), pw = ph * a;
      let col = 400;
      while (!layText(col - 56, ph - 60, 9) && col < 520) col += 40;
      this.bw = Math.round(pw + col); this.bh = Math.round(ph);
      this.pr = [0, 0, pw, ph];
      this.band = [pw, 0, col, ph];
      this.capR = [pw + 30, 30, col - 56, ph - 60];
      this.textTop = Math.max(0, (this.capR[3] - textH()) / 2);
    } else {
      // 橫的：看板寬 760（直的照片沒有字時至少 460），字帶照字排出來的高度，照片用剩下的高度（整塊最高 660），在看板上置中
      const w = a >= 1 ? 760 : Math.max(460, 500 * a);
      if (tx) layText(w - 60, 300, 6);
      // 字帶：上面留 28、下面留 40（右下角是小小的日期）
      const bandH = tx ? Math.round(Math.max(110, textH() + 68)) : 0;
      let ph = Math.min(a >= 1 ? w / a : 500, 660 - bandH);
      let pw = ph * a;
      // 很小的照片最多放大 1.5 倍
      const k = Math.min(1, (this.img.w * 1.5) / pw);
      pw *= k; ph *= k;
      this.bw = Math.round(w); this.bh = Math.round(ph + bandH);
      this.pr = [(this.bw - pw) / 2, 0, pw, ph];
      this.band = [0, ph, this.bw, bandH];
      this.capR = [30, ph + 28, this.bw - 60, Math.max(0, bandH - 68)];
    }
    if (!tx) this.makeText(st(600, 200));
    // 歌詞字幕（最後一排基線在 y = 968，HUD 區上面）
    this.lyricBar(860, 968);
    // 看板的下緣在 y ≈ 700（底下是鋼架與樓頂），上緣不超過 y = 110；直的字欄從看板頂端就有字，
    // 開場鏡頭從街上往上搖時看板會先高 70 px，上緣再往下讓，字才不會太靠近畫面上緣
    this.cy = Math.max((this.side ? 150 : 110) + this.bh / 2, 700 - this.bh / 2);
    this.type = this.track(new Layer2D(this.bw, this.bh, SCALE, { fast: true }));
    this.cap = this.track(new Layer2D(Math.max(40, this.capR[2]) + 10, Math.max(40, this.capR[3]) + 20, SCALE, { fast: true }));
    this.drawType();
    this.cap.upload();
    // 投光燈在第一拍亮；街燈從近到遠一拍亮一盞
    this.tFlood = beatAfter(audio, start + 0.25);
    for (let i = 0; i < NL; i++) this.lampT.push(beatAfter(audio, this.tFlood, i + 1));
  }

  /** 字帶（深色）上右下角小小的日期；字帶跟照片之間一條訊號色的線。 */
  private drawType() {
    const L = this.type, c = L.ctx;
    L.clear();
    const [x, y, w, h] = this.band;
    if (w > 0 && h > 0) {
      c.fillStyle = rgba('ink2', 0.96);
      c.fillRect(x, y, w, h);
      c.fillStyle = rgba('signal', 0.85);
      if (this.side) c.fillRect(x, y, 4, h); else c.fillRect(x, y, w, 4);
      if (DATE_DOTS) {
        c.font = font(F.mono(500), 14);
        c.letterSpacing = '3px';
        c.fillStyle = rgba('bone', 0.55);
        c.textAlign = 'right';
        c.fillText(clip(c, DATE_DOTS, Math.min(220, w - 40)), x + w - 24, y + h - 14);
        c.textAlign = 'left';
        c.letterSpacing = '0px';
      }
    }
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const z0 = 1 - Math.exp(-lt / 7);
    // 鏡頭：從街上慢慢往上搖（畫面往下移）、推近看板；一開始動得快
    const tilt = ease.outCubic(prog(t, s, s + 1.4));
    const camOff: [number, number] = [-24 * z0, -70 * (1 - tilt) + 26 * z0];
    const camZoom = 0.97 + 0.05 * z0;
    const u = this.bg.u;
    // 看板：往右後方轉一點、上緣比較遠（從下往上看）
    const board: Plane = { x: this.cx, y: this.cy, w: this.bw, h: this.bh, ry: -11 * (Math.PI / 180), rx: 5 * (Math.PI / 180) };
    const cam = { f: 1500 };
    // shader 裡的 p 已經先扣掉鏡頭的推近與移動（整個街景一起動），看板的矩陣用沒動過的座標
    homographyPx(planeQuad(board, cam), this.bw, this.bh, u.mBoard!.value as THREE.Matrix3);
    (u.board!.value as THREE.Vector2).set(this.bw, this.bh);
    (u.pr!.value as THREE.Vector4).set(...this.pr);
    // 看板上的照片往焦點推（街頭看板，1.22 倍）
    const crop = this.pushCrop(lt, this.pr[2] / this.pr[3], 1.22, this.pr[2]);
    (u.crop!.value as THREE.Vector4).set(...crop);
    u.photoPx!.value = (crop[2] - crop[0]) * this.img.w;
    u.photo!.value = this.tex;
    u.phGain!.value = this.gain;
    u.type!.value = this.type.texture;
    if (this.hasText) this.paintText(this.cap, t, 0, this.textTop);
    u.cap!.value = this.cap.texture;
    (u.capRect!.value as THREE.Vector4).set(this.capR[0], this.capR[1], this.cap.w, this.cap.h);
    const fl = u.flP!.value as THREE.Vector2[];
    for (let i = 0; i < 3; i++) {
      const [x, y] = planePoint(board, (i + 0.5) / 3, 0, cam);
      fl[i]!.set(x, y - 30);
    }
    const [bx, by] = planePoint(board, 0.5, 1, cam);
    (u.boardBase!.value as THREE.Vector2).set(bx, by);
    // 投光燈：閃一下再亮
    const ft = t - this.tFlood;
    u.flood!.value = ft < 0 ? 0 : ft < 0.06 ? 0.8 : ft < 0.14 ? 0.15 : ease.outCubic(prog(ft, 0.14, 0.5));
    // 街燈：左邊一排往遠處（消失點在畫面中間偏右）
    const vp = [1250, HORIZON - 30];
    const lamps = u.lamps!.value as THREE.Vector4[];
    const on = u.lampOn!.value as number[];
    for (let i = 0; i < NL; i++) {
      const d = 1 + i * 0.55;
      const x = vp[0]! + (150 - vp[0]!) / d, y = vp[1]! + (1150 - vp[1]!) / d;
      lamps[i]!.set(x, y, 1 / d, 620 / d);
      const lt2 = t - this.lampT[i]!;
      on[i] = lt2 < 0 ? 0 : (lt2 < 0.05 ? 0.6 : 1) * ease.outCubic(prog(lt2, 0, 0.25));
    }
    u.horizon!.value = HORIZON;
    (u.camOff!.value as THREE.Vector2).set(...camOff);
    u.camZoom!.value = camZoom;
    u.t!.value = lt;
    u.k!.value = (0.85 + 0.15 * ease.outCubic(prog(t, s, s + 0.5))) * (1 - 0.1 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    // 歌詞字幕（有主字時）：鏡頭搖上來之後淡入
    this.renderBar(t, out, ease.outCubic(prog(t, s + 0.4, s + 0.9)) * (1 - prog(t, e - 0.3, e)));
    return PHOTO_POST(false, { vignette: 0.5, bloom: 0.3 });
  }
}
