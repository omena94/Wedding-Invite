// 照片版面「書的內頁」（亮，P8 印刷品）：一本精裝書攤在桌上，左頁是滿版的照片，右頁是圖說與頁碼——
//  - 桌子是淺色的木頭，一盞檯燈從左上照下來（暖暖的光圈，離燈遠的地方暗一點）；鏡頭斜斜往下看，書的遠端有一點景深。
//    書：布面的書殼、看得到書口的厚度，兩頁靠近書溝的地方彎下去、比較暗。
//  - 進場：一頁在第一拍附近「翻過來」——右頁掀起、翻過書溝、落到左邊，翻過來的背面就是照片那一頁，同時露出右頁的圖說。
//  - 左頁的照片滿版，慢慢往新人點的焦點推（1.15 倍，焦點一定在頁面裡）；很小的舊照片書跟著變小，最多放大約 1.5 倍。
//    頁面的比例：沒有字時跟著照片（只裁一點點）；有字時右頁要寫得下 60 字的留言，頁面固定在 0.8～1.15 之間，照片繞著焦點裁。
//  - 右頁：上面一行小小的書眉（相簿名）、中間是這一格的字（_photo.ts 的 PhotoText，思源宋體）：主字（賓客留言＋署名，
//    或新人的註解），歌詞小一號接在下面跟唱；沒有主字時歌詞自己當主字。下面頁碼。
//    兩個都沒有就只有書眉與頁碼，鏡頭對著照片那一頁（照片在畫面中間）。
//  - 右下角（HUD）是桌面或右頁下面的留白。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE } from '../engine/gl';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, prog } from '../engine/util';
import { beatAfter } from './_motifs';
import { PressPlate, P8_GLSL, PHOTO_POST, F, font, planeQuad, planePoint, homographyPx, clip, textFits, PAPER_INK, type Plane, type Quad, type PressTextStyle } from './_p8';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'press', paper: true, energy: [0, 0.75], bars: [2, 8], weight: 1, prefers: ['portrait'] };

const BG = () => new FSPass(/* glsl */ `${P8_GLSL}
  uniform sampler2D photo; uniform sampler2D rpage; uniform sampler2D cap;
  uniform mat3 mBook; uniform mat3 mTurn; uniform vec2 pgs; uniform vec4 crop; uniform float photoPx;
  uniform vec4 capRect; uniform float leftNew; uniform float turnOn; uniform float turnBack; uniform float turnK; uniform float turnSh;
  uniform vec2 lampP; uniform float focusY; uniform float k; uniform float t;
  // 舊的那幾頁：看不清的灰色字行
  float greek(vec2 lq, vec2 sz) {
    vec2 l = lq - vec2(64.0, 90.0);
    vec2 box = sz - vec2(128.0, 180.0);
    float inB = step(0.0, l.x) * step(l.x, box.x) * step(0.0, l.y) * step(l.y, box.y);
    float row = floor(l.y / 26.0), ry = l.y - row * 26.0;
    float bar = smoothstep(10.0, 11.5, ry) * (1.0 - smoothstep(16.5, 18.0, ry));
    float end = mod(row, 6.0) == 5.0 ? box.x * (0.3 + 0.5 * hash11(row)) : box.x;
    float wi = floor(l.x / 54.0), wx = l.x - wi * 54.0;
    float word = 1.0 - smoothstep(54.0 * (0.6 + 0.35 * hash12(vec2(wi, row))), 54.0 * (0.6 + 0.35 * hash12(vec2(wi, row))) + 2.0, wx);
    return inB * bar * word * (1.0 - smoothstep(end - 2.0, end, l.x)) * 0.32;
  }
  // 照片那一頁（頁面座標，左上原點）
  vec3 photoPage(vec2 lq, float s) {
    vec2 uv = cropUv(crop, lq / pgs);
    float lod = log2(max(s * photoPx / pgs.x, 1e-4) / PX_SCALE);
    return photoLin(photo, uv, lod);
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 q = homo(mBook, p);
    float s = homoScale(mBook, p);
    vec2 sp = vec2(pgs.x * 2.0, pgs.y);
    float blur = 1.3 * smoothstep(260.0, 700.0, abs(p.y - focusY));
    // 桌面：淺色木頭（固定色 fur 混紙色），紋理順著一個方向；檯燈的光圈
    float grain = fbm(vec2(q.x / 900.0, q.y / 60.0), 3) + 0.3 * snoise(vec2(q.x / 120.0, q.y / 9.0));
    vec3 desk = mix(C_PAPER, C_FUR, 0.32) * (0.82 + 0.08 * grain);
    float lamp = exp(-pow(length((q - lampP) * vec2(0.8, 1.0)) / 1350.0, 2.0));
    vec3 col = desk;
    // 書殼（布面，比頁面大一圈）與它的影子
    vec2 bq = q - sp * 0.5;
    float dCover = sdBox(bq, sp * 0.5 + vec2(16.0, 14.0));
    col *= 1.0 - 0.4 * exp(-max(sdBox(bq - vec2(10.0, 22.0), sp * 0.5 + vec2(16.0, 14.0)), 0.0) / 26.0);
    float aCover = clamp(0.5 - dCover / max(s, 0.3), 0.0, 1.0);
    vec3 cloth = mix(C_INK2, C_BLOOD, 0.45) * (0.9 + 0.1 * snoise(q / 3.0));
    col = mix(col, cloth, aCover);
    // 書口：頁面下緣露出一條紙的厚度（細線）
    float edge = step(sp.y, q.y) * step(q.y, sp.y + 9.0) * step(4.0, q.x) * step(q.x, sp.x - 4.0);
    col = mix(col, C_BONE * (0.72 + 0.1 * step(0.5, fract(q.y * 0.7))), edge);
    // 頁面
    float aP = edgeA(q, sp, s);
    if (aP > 0.0) {
      float gx = abs(q.x - pgs.x) / pgs.x;
      bool left = q.x < pgs.x;
      vec2 lq = left ? q : q - vec2(pgs.x, 0.0);
      vec3 paper = mix(C_BONE, C_PAPER, 0.4) * (0.95 + 0.02 * paperFiber(q));
      vec3 pc = paper;
      if (left) {
        if (leftNew > 0.5) pc = photoPage(lq, s);
        else pc = mix(paper, C_SEPIA * 0.6, greek(lq, pgs));
      } else {
        vec2 br = vec2(blur * 2.0 * s);
        vec4 rc = layerBlur(rpage, lq / pgs, br / pgs);
        pc = pc * (1.0 - rc.a) + rc.rgb;
        vec4 cc = layerBlur(cap, (lq - capRect.xy) / capRect.zw, br / capRect.zw);
        pc = pc * (1.0 - cc.a) + cc.rgb;
      }
      // 書溝：靠近中間彎下去（暗），稍外面一點拱起來（亮一點點）
      pc *= 1.0 - 0.38 * exp(-gx * 16.0) + 0.04 * exp(-pow((gx - 0.1) / 0.06, 2.0));
      // 翻頁時被蓋住的那一邊暗一點
      pc *= 1.0 - turnSh * (left ? step(0.5, turnBack) : step(turnBack, 0.5));
      col = mix(col, pc, aP);
    }
    // 翻過來的那一頁
    if (turnOn > 0.5) {
      vec2 tq = homo(mTurn, p);
      float ts = homoScale(mTurn, p);
      float aT = edgeA(tq, pgs, ts);
      if (aT > 0.0) {
        vec3 paper = mix(C_BONE, C_PAPER, 0.4) * 0.97;
        vec3 tc = turnBack > 0.5 ? photoPage(tq, ts) : mix(paper, C_SEPIA * 0.6, greek(tq, pgs));
        // 靠書溝那一邊（背面在右、正面在左）暗一點
        float gx = turnBack > 0.5 ? (pgs.x - tq.x) / pgs.x : tq.x / pgs.x;
        tc *= turnK * (1.0 - 0.3 * exp(-gx * 12.0));
        col = mix(col, tc, aT);
      }
    }
    col *= 0.5 + 0.55 * lamp;
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, phGain: { value: 1 }, rpage: { value: null }, cap: { value: null },
  mBook: { value: new THREE.Matrix3() }, mTurn: { value: new THREE.Matrix3() }, pgs: { value: new THREE.Vector2() },
  crop: { value: new THREE.Vector4(0, 0, 1, 1) }, photoPx: { value: 1 }, capRect: { value: new THREE.Vector4() },
  leftNew: { value: 1 }, turnOn: { value: 0 }, turnBack: { value: 0 }, turnK: { value: 1 }, turnSh: { value: 0 },
  lampP: { value: new THREE.Vector2() }, focusY: { value: H / 2 }, k: { value: 1 }, t: { value: 0 },
});

/** 右頁的左右留白、字區的頂（書眉下面）、字區下面留給頁碼的高。 */
const MX = 56, CAP_Y = 110, FOOT = 76;
/** 照片那一頁往焦點推到幾倍（印在紙上）。 */
const ZOOM = 1.15;

export default class Bookpage extends PressPlate {
  bg = shared('bookpage.bg', BG);
  rpage!: Layer2D;
  cap!: Layer2D;
  /** 一頁的大小（設計 px）與比例。 */
  pw = 0; ph = 0; pa = 1;
  capH = 0;
  /** 字整塊在字區裡的頂（字區座標）。 */
  textTop = 0;
  tLand = 0;
  dir = 1;

  override async init() {
    const { start, audio } = this.ctx;
    await this.loadPhoto('—0123456789');
    const a = this.aspect, tx = this.hasText;
    // 頁面的比例：沒有字時跟著照片（只裁一點點），整個跨頁寬最多 1340（斜看時近的那一邊會變寬）、頁高最多 640；
    // 有字時右頁要寫得下 60 字的留言＋署名＋歌詞：比例固定在 0.8～1.15（照片繞著焦點裁），跨頁寬最多 1400、頁高最多 700
    const pa = (this.pa = tx ? clamp(a, 0.8, 1.15) : clamp(a, 0.62, 1.3));
    let ph = tx ? Math.min(700, 1400 / (2 * pa)) : Math.min(640, 1340 / (2 * pa));
    const cropW = (a > pa ? pa / a : 1) * this.img.w;
    ph = Math.min(ph, (cropW * 1.5) / pa);
    this.ph = Math.round(ph); this.pw = Math.round(ph * pa);
    this.rpage = this.track(new Layer2D(this.pw, this.ph, SCALE, { fast: true }));
    // 字區：右頁書眉下面到頁碼上面；先照四行排，60 字的留言放不下就多折幾行
    const cw = this.pw - 2 * MX;
    this.capH = Math.round(this.ph - CAP_Y - FOOT);
    const st = (maxLines: number): PressTextStyle => ({ family: F.ming(400), w: cw, h: this.capH, min: 40, max: 48, lineHeight: 1.45, maxLines, ...PAPER_INK() });
    if (!textFits(this.makeText(st(4)), this.capH)) this.makeText(st(8));
    // 整塊在字區裡垂直置中、偏上一點
    this.textTop = Math.max(0, (this.capH - this.text.height) * 0.42);
    this.cap = this.track(new Layer2D(cw + 10, this.capH + 24, SCALE, { fast: true }));
    this.drawPage();
    this.cap.upload();
    this.tLand = beatAfter(audio, start + 0.95);
    this.dir = hash(this.seed, 9) < 0.5 ? -1 : 1;
  }

  /** 右頁：書眉（相簿名）、細線、頁碼。 */
  private drawPage() {
    const L = this.rpage, c = L.ctx;
    L.clear();
    const ph = this.photo;
    c.textBaseline = 'alphabetic';
    if (ph.album) {
      c.font = font(F.hei(500), 17);
      c.letterSpacing = '5px';
      c.fillStyle = rgba('sepia', 0.55);
      c.textAlign = 'right';
      c.fillText(clip(c, ph.album, this.pw - 2 * MX), this.pw - MX, 58);
      c.textAlign = 'left';
      c.letterSpacing = '0px';
    }
    c.fillStyle = rgba('sepia', 0.3);
    c.fillRect(MX, 72, this.pw - 2 * MX, 1.2);
    c.font = font(F.serif(600), 20);
    c.fillStyle = rgba('sepia', 0.62);
    c.textAlign = 'center';
    c.fillText(`— ${ph.n * 2 + 1} —`, this.pw / 2, this.ph - 44);
    c.textAlign = 'left';
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const z0 = 1 - Math.exp(-lt / 7);
    const sw = 2 * this.pw;
    // 沒有說明：鏡頭對著照片那一頁（左頁在畫面中間）
    const cx = this.hasText ? W / 2 - 10 : W / 2 + this.pw / 2 - 20;
    const book: Plane = { x: cx - 80, y: H / 2 - 10, w: sw, h: this.ph, rx: 20 * (Math.PI / 180), rz: this.dir * (1.2 + 0.6 * z0) * (Math.PI / 180) };
    // 翻頁：0.75 秒，落在第一個拍點；鏡頭跟著頁面慢慢降下來、推近
    const t0 = this.tLand - 0.75;
    const ph = Math.PI * ease.inOutCubic(prog(t, t0, this.tLand));
    const settle = ease.outCubic(prog(t, s, this.tLand + 0.3));
    const [fx, fy] = planePoint(book, this.hasText ? 0.5 : 0.25, 0.5);
    const cam = { f: 1500, zoom: 0.95 + 0.05 * settle + 0.04 * z0, cx: fx, cy: fy, dx: 0, dy: -24 * (1 - settle) };
    const u = this.bg.u;
    homographyPx(planeQuad(book, cam), sw, this.ph, u.mBook!.value as THREE.Matrix3);
    (u.pgs!.value as THREE.Vector2).set(this.pw, this.ph);
    // 照片那一頁往焦點推（翻過來之前就開始算，翻過來時已經推了一點點）
    const crop = this.pushCrop(lt, this.pa, ZOOM, this.pw);
    (u.crop!.value as THREE.Vector4).set(...crop);
    u.photoPx!.value = (crop[2] - crop[0]) * this.img.w;
    u.photo!.value = this.tex;
    u.phGain!.value = this.gain;
    u.rpage!.value = this.rpage.texture;
    if (this.hasText) this.paintText(this.cap, t, 0, this.textTop);
    u.cap!.value = this.cap.texture;
    (u.capRect!.value as THREE.Vector4).set(MX, CAP_Y, this.cap.w, this.cap.h);
    // 翻頁那一頁：繞著書溝轉，外緣離開書面（lift）
    u.leftNew!.value = t >= this.tLand ? 1 : 0;
    const turning = t < this.tLand && Math.abs(Math.cos(ph)) > 0.03;
    u.turnOn!.value = turning || t < t0 ? 1 : 0;
    if (turning || t < t0) {
      const uo = 0.5 + 0.5 * Math.cos(ph), lift = this.pw * Math.sin(ph);
      const G0 = planePoint(book, 0.5, 0, cam), G1 = planePoint(book, 0.5, 1, cam);
      const O0 = planePoint(book, uo, 0, cam, lift), O1 = planePoint(book, uo, 1, cam, lift);
      const back = ph > Math.PI / 2;
      const quad: Quad = back ? [O0, G0, G1, O1] : [G0, O0, O1, G1];
      homographyPx(quad, this.pw, this.ph, u.mTurn!.value as THREE.Matrix3);
      u.turnBack!.value = back ? 1 : 0;
      u.turnK!.value = 0.86 + 0.14 * Math.abs(Math.cos(ph));
      u.turnSh!.value = 0.18 * Math.sin(ph);
    } else u.turnSh!.value = 0;
    const [lx, ly] = [-sw * 0.15, -this.ph * 0.6];
    (u.lampP!.value as THREE.Vector2).set(lx, ly);
    u.focusY!.value = fy;
    u.t!.value = lt;
    u.k!.value = (0.92 + 0.08 * ease.outCubic(prog(t, s, s + 0.5))) * (1 - 0.08 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    return PHOTO_POST(true, { vignette: 0.36 });
  }
}
