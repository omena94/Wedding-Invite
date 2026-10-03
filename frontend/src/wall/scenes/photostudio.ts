// 照片版面「老照相館」（P9 台灣味，暗）：夜裡街角的老照相館，從騎樓看進它的櫥窗——
//  - 櫥窗裡是暗紅的絨布背幕，照片裱在金色的相框裡、立在畫架上，頂上的投射燈把它照亮；後面還有兩個比較小的相框（失焦）。
//    櫥窗上面是一塊深色的招牌，金色的「照相館」三個字（24 px，是店面的一部分，不搶照片與註解）；四周是老房子的馬賽克小磁磚。
//  - 第一個拍點，櫥窗的燈「閃兩下」亮起來；鏡頭一開始對焦在玻璃上的倒影（對街的路燈），慢慢把焦點拉進櫥窗裡的照片。
//  - 玻璃上一直有街上的倒影：路燈的光點、淡淡的對街招牌；每兩個小節有一台機車的車燈從玻璃上掃過去。鏡頭很慢地橫移，
//    玻璃框、櫥窗裡、倒影三層移得不一樣快（視差）。
//  - 字寫在照片旁邊一張立著的說明卡上（思源宋體，像照相館的展示說明）：主字（賓客的祝福＋署名，或新人的註解）一個字一個字印出來，
//    歌詞小一號印在下面跟唱；沒有主字時歌詞自己放在卡上（_photo.ts 的 PhotoText）。說明卡跟著字變高（最高到櫥窗上緣下面）。
//    兩個都沒有：沒有說明卡，照片在櫥窗正中間。
//  - 焦點：相框裡的照片往焦點推（1.18 倍），鏡頭也慢慢往焦點那一點移。
// 畫法：一個 shader：外牆（磁磚）、窗框、招牌（字是一張 Canvas）、櫥窗裡（背幕、投射燈、相框與照片、畫架、後面的相框、
// 說明卡（字是另一張 Canvas）、台面）、玻璃的倒影（遠的平面，景深自己算）。每一層用 _p9 鏡頭在自己的深度取座標。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { focusIn, photoWords, settleK } from './_photo';
import { P9Plate, P9_GLSL, P9_CAM_GLSL, Words, camUniforms, fitPhoto, setCam } from './_p9';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'local', prefers: ['portrait', 'small'], energy: [0, 1], bars: [2, 8], weight: 1 };

const DIST = 2400;
const RAD = Math.PI / 180;
/** 各層的深度（z = 0 是玻璃，負的在櫥窗裡）。 */
const Z_PHOTO = -260, Z_CARD = -200;
/** 招牌上的字（通用的詞，不是店名）。 */
const SIGN = '照相館';
/** 畫面座標（鏡頭最後的位置）→ 深度 z 的平面上的世界座標。 */
const toWorld = (sx: number, sy: number, z: number) => {
  const k = (DIST - z) / DIST;
  return [960 + (sx - 960) * k, 540 + (sy - 540) * k] as const;
};

const BG = () => new FSPass(/* glsl */ `
  ${P9_GLSL}
  ${P9_CAM_GLSL}
  uniform sampler2D photo; uniform sampler2D txt; uniform sampler2D sign; uniform float hasTxt;
  uniform vec2 phC; uniform vec2 phHalf; uniform float mat; uniform float lod; uniform float lodBlur; uniform vec4 crop;
  uniform vec2 cdC; uniform vec2 cdHalf; uniform vec2 txS; uniform vec2 sgS;
  uniform float focusZ; uniform float lightOn; uniform float sweep; uniform float t; uniform float k;

  const float ZP = ${Z_PHOTO}.0, ZC = ${Z_CARD}.0, ZB = -460.0, ZR = -2600.0;
  const vec4 GLASS = vec4(140.0, 200.0, 1780.0, 880.0);   // 玻璃（世界座標 x0, y0, x1, y1，z = 0）
  float blurOf(float z) { return 0.8 + abs(z - focusZ) * 0.022; }
  vec3 warm() { return mix(C_FUR, C_BONE, 0.45); }

  // 一個裱框（金框＋卡紙＋照片）：q = 框中心為原點；cr = 框裡是照片的哪一塊（往焦點推）；回傳顏色與覆蓋
  vec4 framed(vec2 q, vec2 hs, float m, float l, float bl, vec4 cr) {
    vec2 outer = hs + m + 22.0;
    float d = sdBox(q, outer);
    float a = fillAA(d, bl);
    if (a <= 0.0) return vec4(0.0);
    // 金框：斜面的亮暗（上、左亮）
    vec2 e = abs(q) - (hs + m);
    float bevel = clamp(max(e.x, e.y) / 22.0, 0.0, 1.0);
    float topLeft = step(0.0, -q.y) * step(e.x, e.y) + step(0.0, -q.x) * step(e.y, e.x);
    vec3 col = mix(C_FUR, C_BONE, 0.15) * (0.22 + 0.26 * topLeft + 0.16 * (1.0 - bevel));
    float dm = sdBox(q, hs + m);
    col = mix(col, C_BONE * 0.6 * (1.0 - 0.25 * (1.0 - smoothstep(0.0, 8.0, -dm))), fillAA(dm, bl));
    float dp = sdBox(q, hs);
    vec2 uv = cropUV((q + hs) / (2.0 * hs), cr);
    col = mix(col, photoLin(photo, uv, l), fillAA(dp, bl));
    return vec4(col, a);
  }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 w0 = onZ(p, 0.0);
    float b0 = blurOf(0.0);
    float inGlass = fillAA(-min(min(w0.x - GLASS.x, GLASS.z - w0.x), min(w0.y - GLASS.y, GLASS.w - w0.y)), b0);
    vec3 col = vec3(0.0);
    if (inGlass > 0.0) {
      float L = lightOn;
      // 背幕：暗紅絨布，直的皺褶；投射燈在照片後面打出一圈暖光
      vec2 wb = onZ(p, ZB);
      float fold = 0.5 + 0.5 * sin(wb.x / 46.0 + 0.6 * sin(wb.x / 130.0));
      vec3 cin = C_COLLAR * (0.035 + 0.03 * fold) * (0.3 + 0.7 * L);
      vec2 pc = (wb - vec2(phC.x, phC.y - 60.0)) / vec2(620.0, 560.0);
      cin += C_COLLAR * 0.15 * L * exp(-dot(pc, pc) * 2.4) * (0.75 + 0.25 * fold);
      vec2 cc2 = (wb - vec2(cdC.x, cdC.y)) / vec2(420.0, 380.0);
      cin += C_COLLAR * 0.08 * L * hasTxt * exp(-dot(cc2, cc2) * 2.0);
      // 後面兩個小相框（失焦）
      vec2 wr = onZ(p, ZB + 40.0);
      for (int i = 0; i < 2; i++) {
        vec2 c = i == 0 ? vec2(330.0, 420.0) : vec2(1590.0, 360.0);
        vec2 hs = i == 0 ? vec2(110.0, 140.0) : vec2(120.0, 90.0);
        vec4 f = framed(wr - c, hs, 22.0, lodBlur, blurOf(ZB + 40.0) + 3.0, vec4(0.0, 0.0, 1.0, 1.0));
        cin = mix(cin, f.rgb * (0.1 + 0.18 * L), f.a * 0.9);
      }
      // 台面（鋪著布），在櫥窗下緣
      vec2 ws = onZ(p, -150.0);
      float shelf = smoothstep(790.0, 800.0, ws.y);
      cin = mix(cin, mix(C_BONE, C_FUR, 0.2) * 0.09 * (0.4 + 0.6 * L) * (1.0 + 0.6 * exp(-pow((ws.x - phC.x) / 500.0, 2.0))) * (1.0 - 0.4 * smoothstep(800.0, 900.0, ws.y)), shelf);
      // 畫架（兩隻腳）＋相框裡的照片
      vec2 wp = onZ(p, ZP);
      float bp = blurOf(ZP);
      vec2 outer = phHalf + mat + 22.0;
      float legY0 = phC.y + outer.y - 10.0;
      for (int i = 0; i < 2; i++) {
        float sx = i == 0 ? -1.0 : 1.0;
        float dl = sdSegment(wp, phC + vec2(sx * outer.x * 0.45, 0.0), vec2(phC.x + sx * outer.x * 0.6, 840.0)) - 7.0;
        cin = mix(cin, mix(C_FUR, C_INK2, 0.6) * (0.2 + 0.4 * L), fillAA(dl, bp) * step(legY0 - 40.0, wp.y));
      }
      // 相框在背幕上的影子
      cin *= 1.0 - 0.5 * L * boxShade(sdBox(wb - phC - vec2(26.0, 40.0), outer * 1.12), 40.0);
      vec4 f = framed(wp - phC, phHalf, mat, lod, bp, crop);
      // 投射燈：上面亮、下面暗一點
      float spot = (0.5 + 0.5 * L) * (1.0 - 0.18 * smoothstep(-outer.y, outer.y, wp.y - phC.y));
      cin = mix(cin, f.rgb * spot, f.a);
      // 說明卡（立著，在照片旁邊）
      if (hasTxt > 0.5) {
        vec2 wc = onZ(p, ZC);
        float bc = blurOf(ZC);
        vec2 q = wc - cdC;
        // 說明卡從台面後面升上來：台面以下看不到
        float above = 1.0 - smoothstep(-1.0, 1.0, wc.y - 796.0);
        cin *= 1.0 - 0.45 * L * boxShade(sdBox(onZ(p, ZC - 60.0) - cdC - vec2(22.0, 30.0), cdHalf), 26.0) * step(onZ(p, ZC - 60.0).y, 800.0);
        float dc = sdBox(q, cdHalf);
        float ac = fillAA(dc, bc) * above;
        if (ac > 0.0) {
          vec3 card = mix(C_BONE, C_FUR, 0.16) * 0.4 * (0.97 + 0.03 * paperTex(q * 1.4)) * (0.35 + 0.65 * L);
          card *= 1.0 - 0.15 * smoothstep(-cdHalf.y, cdHalf.y, q.y);
          vec4 tx = layerAt(txt, (q + cdHalf) / txS);
          card = card * (1.0 - tx.a) + tx.rgb * (0.4 + 0.6 * L);
          cin = mix(cin, card, ac);
        }
      }
      // 玻璃：裡面暗一點；倒影（對街的路燈、招牌、機車的車燈），離得遠，跟著焦點糊掉
      vec3 refl = vec3(0.0);
      vec2 wr2 = onZ(p, ZR);
      float br = blurOf(ZR);
      for (int i = 0; i < 4; i++) {
        float fi = float(i);
        vec2 c = vec2(-300.0 + fi * 900.0 + 120.0 * sin(fi * 2.3), 160.0 + 140.0 * sin(fi * 1.7));
        float r = 18.0 + 6.0 * fi;
        float d = length(wr2 - c) - r;
        refl += mix(warm(), C_BONE, 0.3 * mod(fi, 2.0)) * 0.9 * (1.0 - smoothstep(-br * 0.6, br * 0.6 + 2.0, d)) * (r * r) / pow(r + br * 0.5, 2.0);
      }
      // 對街的招牌（淡淡的訊號色長方塊）
      float dsg = sdBox(wr2 - vec2(1500.0, 420.0), vec2(260.0, 60.0));
      refl += C_SIGNAL * 0.18 * (1.0 - smoothstep(-br, br + 4.0, dsg));
      // 機車的車燈掃過去
      float sw = exp(-pow((w0.x - sweep) / 260.0, 2.0)) * exp(-pow((w0.y - 700.0) / 120.0, 2.0));
      refl += warm() * 0.5 * sw;
      // 菲涅耳：上面的玻璃反光多一點；手印與髒污讓反光不均勻
      float fres = 0.14 + 0.1 * smoothstep(600.0, 200.0, w0.y);
      // 玻璃上一道斜斜的反光
      refl += C_BONE * 0.12 * exp(-pow((w0.x + w0.y * 0.7 - 1500.0) / 90.0, 2.0)) + C_BONE * 0.05 * exp(-pow((w0.x + w0.y * 0.7 - 1700.0) / 40.0, 2.0));
      float smudge = 0.75 + 0.25 * fbm(w0 / 160.0, 2);
      col = cin * 0.92 + refl * fres * smudge * 1.6 + C_GRAPHITE * 0.03 * smoothstep(900.0, 200.0, w0.y);
    }
    // 外牆：馬賽克小磁磚（兩色），窗戶附近被櫥窗的光照到一點
    vec2 tq = w0 / vec2(34.0, 17.0);
    vec2 tid = floor(tq);
    vec2 tf = fract(tq);
    float grout = smoothstep(0.0, 0.12, min(min(tf.x, 1.0 - tf.x) * 2.0, min(tf.y, 1.0 - tf.y)));
    float h = hash12(tid);
    vec3 tile = mix(C_INK2, C_GRAPHITE, 0.08 + 0.07 * step(0.7, h)) * (0.9 + 0.1 * h);
    tile = mix(C_INK2 * 0.75, tile, grout);
    float spill = exp(-max(sdBox(w0 - vec2(960.0, 540.0), vec2(820.0, 340.0)), 0.0) / 90.0) * lightOn;
    vec3 facade = tile * (0.45 + 0.5 * spill);
    // 窗框（深色鋁框）、窗台
    float dfr = abs(sdBox(w0 - vec2(960.0, 540.0), vec2(820.0, 340.0))) - 14.0;
    float sill = sdBox(w0 - vec2(960.0, 910.0), vec2(860.0, 22.0));
    col = mix(facade, col, inGlass);
    col = mix(col, C_GRAPHITE * (0.1 + 0.15 * spill) * (0.85 + 0.15 * smoothstep(-14.0, 14.0, w0.y - 540.0)), fillAA(dfr, b0));
    col = mix(col, mix(C_GRAPHITE, C_BONE, 0.15) * (0.1 + 0.2 * spill), fillAA(sill, b0));
    // 招牌（往外凸一點）：深色的板子、一圈細金邊、金字
    vec2 wsg = onZ(p, 30.0);
    float dsb = sdBox(wsg - vec2(960.0, 108.0), vec2(sgS.x * 0.5 + 80.0, 46.0));
    if (dsb < 4.0) {
      vec3 board = C_COLLAR * 0.12 * (0.9 + 0.1 * fbm(wsg / 60.0, 2));
      board = mix(board, mix(C_FUR, C_BONE, 0.3) * 0.3, fillAA(abs(dsb + 8.0) - 1.2, 0.8));
      vec4 sg = layerAt(sign, (wsg - vec2(960.0, 108.0) + sgS * 0.5) / sgS);
      board = board * (1.0 - sg.a) + sg.rgb * (0.5 + 0.3 * lightOn);
      col = mix(col, board, fillAA(dsb, 0.8));
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, txt: { value: null }, sign: { value: null }, hasTxt: { value: 0 }, ...camUniforms(),
  phC: { value: new THREE.Vector2() }, phHalf: { value: new THREE.Vector2() }, mat: { value: 40 }, lod: { value: 0 }, lodBlur: { value: 5 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  cdC: { value: new THREE.Vector2() }, cdHalf: { value: new THREE.Vector2() }, txS: { value: new THREE.Vector2(1, 1) }, sgS: { value: new THREE.Vector2(1, 1) },
  focusZ: { value: -2600 }, lightOn: { value: 0 }, sweep: { value: -2000 }, t: { value: 0 }, k: { value: 1 },
});

export default class PhotoStudio extends P9Plate {
  bg = shared('photostudio.bg', BG);
  txt: Layer2D | null = null;
  sign = this.track(new Layer2D(220, 50, undefined, { fast: true }));
  words: Words | null = null;
  phX = 960; phY = 520; hw = 0; hh = 0; mat = 40;
  cdX = 0; cdY = 0; cdW = 0; cdH = 0;
  tOn = 0;

  override async init() {
    await this.loadPhoto(SIGN);
    await loadText(SIGN);
    const { end } = this.ctx;
    const probe = document.createElement('canvas').getContext('2d')!;
    const pw = photoWords(this.ctx);
    const head = this.photo.chapter && this.photo.album ? 46 : 0;
    // 說明卡在玻璃後面 200 px，看起來小一成：字要放大一點，畫面上才是主字 40～50、署名約 28、歌詞約 38 px。
    // 卡最高到櫥窗上緣下面（卡＝字＋90，底貼著 790 的台面）
    const words = pw.kind !== 'none' || pw.lyrics ? new Words(this.ctx, probe, {
      family: F.ming(400), w: 560, h: 480 - head, min: 44, max: 54, lineHeight: 1.45, maxLines: 5, align: 'left',
      ink: rgba('sepia', 0.95), unsung: rgba('sepia', 0.3), active: mixRgba('signal', 'sepia', 0.4),
      sigSize: 30, sigInk: rgba('sepia', 0.8), lyricSize: 52, lyricSubSize: 41,
      album: { family: F.hei(500), size: 22, color: rgba('sepia', 0.6) },
    }) : null;
    this.words = words?.has ? words : null;
    // 照片的位置、大小（畫面座標 → 照片那一層的世界座標）
    const k = (DIST - Z_PHOTO) / DIST;
    const ph = this.words ? fitPhoto(this.img, 600, 470) : fitPhoto(this.img, 820, 520);
    this.hw = (ph.w / 2) * k; this.hh = (ph.h / 2) * k;
    this.mat = clamp(0.09 * Math.min(ph.w, ph.h), 26, 48) * k;
    const sx = this.words ? 700 : 960;
    [this.phX, this.phY] = toWorld(sx, 530, Z_PHOTO);
    if (this.words) {
      const words = this.words;
      const kc = (DIST - Z_CARD) / DIST;
      const tw = Math.max(220, words.width);
      this.cdW = (tw + 80) * kc; this.cdH = (words.height + 90) * kc;
      // 說明卡立在台面上（下緣貼著台面），文字的最後一行在 HUD 區上面
      const cardBottom = 790;
      const cy = cardBottom - (words.height + 90) / 2;
      [this.cdX, this.cdY] = toWorld(Math.min(1240, 1720 - tw - 80) + (tw + 80) / 2, cy, Z_CARD);
      this.txt = this.track(new Layer2D(Math.ceil(this.cdW), Math.ceil(this.cdH), undefined, { fast: true }));
    }
    // 招牌的字
    const S = this.sign, c = S.ctx;
    S.clear();
    // 招牌是店面的一部分，不是第二組大字：字 24 px（推近、透視之後畫面上也 ≤ 26 px）
    c.font = font(F.ming(900), 24);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.letterSpacing = '14px';
    c.fillStyle = mixRgba('fur', 'bone', 0.35);
    c.fillText(SIGN, S.w / 2 + 7, S.h / 2 + 1);
    c.letterSpacing = '0px';
    S.upload();
    this.tOn = this.cue(0.2, 0.8);
    this.words?.writeFrom(this.tOn + 0.5, Math.max(0.6, Math.min(2.2, (end - this.tOn - 0.5) * 0.5)));
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const u = this.bg.u;
    // 燈：閃兩下亮起來
    const d = t - this.tOn;
    const on = d < 0 ? 0.18 : d < 0.06 ? 1 : d < 0.14 ? 0.25 : d < 0.2 ? 0.9 : d < 0.27 ? 0.35 : Math.min(1, 0.7 + (d - 0.27) * 3);
    u.lightOn!.value = on;
    // 焦點：從玻璃上的倒影拉進照片
    const rack = ease.inOutCubic(prog(t, s + 0.15, s + Math.min(1.8, (e - s) * 0.4)));
    u.focusZ!.value = lerp(-2600, Z_PHOTO, rack);
    // 每兩個小節一台機車（車燈從玻璃上掃過去）
    const bar = Math.floor(f.bar);
    const pass = (f.bar % 2) / 2;
    const dir = hash(this.seed, bar >> 1) < 0.5 ? 1 : -1;
    u.sweep!.value = dir * lerp(-1400, 3300, pass) + (dir < 0 ? 1920 : 0);
    // 鏡頭：很慢地橫移（視差），一開始近一點
    const push = 1 - Math.exp(-lt / 7);
    const settle = ease.outExpo(clamp(lt / 1.4));
    const side = hash(this.seed, 3) < 0.5 ? -1 : 1;
    const zoom = lerp(1.07, 1.0, settle) + 0.03 * push;
    // 焦點：燈亮之後，相框裡的照片往焦點推；鏡頭也往焦點那一點慢慢移（有字時移得少，說明卡一直在畫面裡）
    const kp = DIST / (DIST - Z_PHOTO);
    const crop = this.focus(t, this.tOn, this.hw / this.hh, { zoom: 1.18, screenW: 2 * this.hw * kp });
    (u.crop!.value as THREE.Vector4).set(...crop);
    const [fu, fv] = focusIn(this.photo, crop);
    const focX = this.phX + (fu - 0.5) * 2 * this.hw, focY = this.phY + (fv - 0.5) * 2 * this.hh;
    const toF = (this.words ? 0.16 : 0.38) * settleK(t - this.tOn, 6);
    const cx0 = 960 + side * lerp(-70, 50, ease.inOutQuad(clamp(lt / 12))) * (this.words ? 1 : 0.5);
    setCam(u, { x: cx0 + (focX - cx0) * toF, y: 540 + (focY - 540) * toF, z: 0, dist: DIST, zoom: zoom + (this.words ? 0 : 0.05) * push, yaw: side * lerp(4, 1.5, settle) * RAD });
    u.lod!.value = this.lod(2 * this.hw * kp * zoom, crop[2] - crop[0]) + (1 - rack) * 2.5;
    u.lodBlur!.value = this.lod(16);
    (u.phC!.value as THREE.Vector2).set(this.phX, this.phY);
    (u.phHalf!.value as THREE.Vector2).set(this.hw, this.hh);
    u.mat!.value = this.mat;
    u.t!.value = t;
    u.k!.value = (0.85 + 0.15 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.15 * prog(t, e - 0.3, e));
    u.photo!.value = this.tex;
    u.sign!.value = this.sign.texture;
    (u.sgS!.value as THREE.Vector2).set(this.sign.w, this.sign.h);
    u.hasTxt!.value = this.words ? 1 : 0;
    // shader 是共用的：沒有字的窗格也要換掉上一個窗格（已經釋放）的字圖層
    u.txt!.value = this.tex;
    if (this.words && this.txt) {
      const L = this.txt;
      if (this.words.draw(L.ctx, t, 40, 46, () => L.clear())) L.upload();
      u.txt!.value = L.texture;
      const rise = ease.outCubic(prog(t, this.tOn + 0.25, this.tOn + 0.85));
      (u.cdC!.value as THREE.Vector2).set(this.cdX, this.cdY + (1 - rise) * (this.cdH + 30));
      (u.cdHalf!.value as THREE.Vector2).set(this.cdW / 2, this.cdH / 2);
      (u.txS!.value as THREE.Vector2).set(L.w, L.h);
    }
    this.bg.render(renderer, out);
    return { bloom: 0.3, bloomThreshold: 1.0, halation: 0.15, vignette: 0.5 };
  }
}
