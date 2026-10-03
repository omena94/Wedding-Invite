// 照片版面「夜市」（P9 台灣味，暗）：夜市攤位的紅白條紋帆布棚下，一串燈泡垂下來晃，照片用木頭衣夾夾在攤位前的鐵線上——
//  - 照片（有白邊的相片）被燈泡的暖光照著；燈泡一直輕輕晃，照片上的光跟著晃。後面是別的攤位失焦的燈（散景），
//    熱氣（蒸氣）一陣一陣往上飄，被燈照得暖暖的。
//  - 字寫在照片旁邊一塊手寫的瓦楞紙板上（像攤位的價目牌，麥克筆字），也用衣夾夾著：主字（賓客的祝福＋署名，或新人的註解）
//    第一個拍點之後一個字一個字寫出來，歌詞小一號寫在下面跟唱；沒有主字時歌詞自己寫在紙板上（_photo.ts 的 PhotoText）。
//    紙板跟著字變大；字多、紙板長到右下角 HUD 的高度時，紙板往左挪、照片小一點。兩個都沒有：沒有紙板，照片在中間。
//  - 焦點：照片上的畫面往焦點推（1.18 倍），鏡頭也慢慢往焦點那一點移。
//  - 鏡頭：切進來時快速橫搖到攤位上（甩鏡頭）、很快停住；之後像手持一樣微微晃。每個小節線一陣風：燈泡晃大一點、熱氣冒一團。
// 畫法：一個 shader：遠的散景、熱氣（fbm）、帆布棚（條紋、波浪的邊）、燈泡（燈絲、燈座、電線）與光暈、鐵線、衣夾、相片、
// 紙板（字是一張 Canvas），照片與紙板的亮度照每顆燈泡的距離算。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { F } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, fbm1, hash, prog } from '../engine/util';
import { focusIn, photoWords, settleK } from './_photo';
import { P9Plate, P9_GLSL, P9_CAM_GLSL, Words, camUniforms, fitPhoto, setCam } from './_p9';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'local', prefers: ['landscape'], energy: [0, 1], bars: [2, 8], weight: 1 };

const DIST = 2400;
const RAD = Math.PI / 180;
/** 燈泡：幾顆、間隔。 */
const NB = 7, BSP = 300;
/** 掛照片與紙板的鐵線（z = 0）。 */
const WIRE_Y = 300;

const BG = () => new FSPass(/* glsl */ `
  ${P9_GLSL}
  ${P9_CAM_GLSL}
  uniform sampler2D photo; uniform sampler2D txt; uniform float hasTxt;
  uniform float swing[${NB}]; uniform float B0;
  uniform vec2 phPiv; uniform float phR; uniform vec2 phHalf; uniform float phBd; uniform float lod; uniform vec4 crop;
  uniform vec2 cdPiv; uniform float cdR; uniform vec2 cdHalf; uniform vec2 txS;
  uniform float puff; uniform float t; uniform float k; uniform float blurBG;

  const float BZ = -140.0, BSP = ${BSP}.0, WIRE_Y = ${WIRE_Y}.0;
  float bulbWire(float x) { float u = (x - 960.0) / 1300.0; return 96.0 + 34.0 * (1.0 - u * u); }
  vec3 warmL() { return mix(C_FUR, C_BONE, 0.55); }
  vec2 bulbPos(int i) {
    float x = B0 + float(i) * BSP;
    float len = 34.0 + 30.0 * hash11(float(i) * 4.1);
    return vec2(x, bulbWire(x)) + vec2(sin(swing[i]), cos(swing[i])) * len;
  }
  // 這一點被燈泡照到多少
  float lightAt(vec2 w) {
    float L = 0.0;
    for (int i = 0; i < ${NB}; i++) {
      vec2 dv = (w - bulbPos(i)) / vec2(560.0, 500.0);
      L += 0.36 / (1.0 + 5.0 * dot(dv, dv));
    }
    return L;
  }
  // 衣夾（木頭，中間一條彈簧的暗線）：q = 夾子中心為原點
  vec4 peg(vec2 q) {
    float d = sdBox(q, vec2(9.0, 34.0)) - 2.0;
    float a = fillAA(d, 0.8);
    vec3 c = mix(C_FUR, C_BONE, 0.2) * (0.5 + 0.15 * smoothstep(-9.0, 9.0, -q.x));
    c = mix(c, C_INK2, fillAA(abs(q.y + 6.0) - 2.0, 0.8) * step(abs(q.x), 10.0));
    return vec4(c, a);
  }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 遠處：別的攤位的燈（失焦的光點，暖色、偶爾紅綠）
    vec2 wf = onZ(p, -3200.0);
    vec3 col = mix(C_INK, C_INK2, smoothstep(-600.0, 1600.0, wf.y)) * 0.9;
    for (int L = 0; L < 2; L++) {
      float cs = L == 0 ? 360.0 : 240.0;
      vec2 q = wf + vec2(70.0 * float(L), 0.0);
      vec2 id = floor(q / cs);
      vec2 h = hash22(id + float(L) * 31.0);
      vec2 c = (id + 0.5) * cs + (h - 0.5) * cs * 0.4;
      float r = mix(30.0, 80.0, h.x) * (L == 0 ? 1.0 : 0.7);
      float d = length(q - c) - r;
      float on = step(0.62, h.y) * smoothstep(-900.0, 300.0, wf.y) * (1.0 - smoothstep(1300.0, 2100.0, wf.y));
      vec3 tint = h.x < 0.75 ? warmL() : h.x < 0.88 ? mix(C_COLLAR, C_BONE, 0.3) : mix(C_GINGHAM, C_BONE, 0.3);
      col += tint * (L == 0 ? 0.1 : 0.06) * on * (1.0 - smoothstep(-r * 0.3 - blurBG, r * 0.1 + blurBG, d));
    }
    vec2 w = onZ(p, 0.0);
    float light = 0.16 + 0.84 * pow(clamp(lightAt(w) / 0.55, 0.0, 1.0), 0.85);
    vec3 tint = mix(vec3(1.0), vec3(1.0, 0.86, 0.68), 0.6);
    // 熱氣：往上飄的煙，被燈照到才看得到
    vec2 sq = w / vec2(420.0, 300.0) + vec2(0.0, t * 0.22);
    float steam = smoothstep(0.1, 0.75, fbm(sq + vec2(fbm(sq * 1.3 + t * 0.05, 2) * 0.6, 0.0), 3) + 0.15 + 0.35 * puff * exp(-pow((w.x - 1450.0) / 500.0, 2.0)));
    col += warmL() * 0.035 * steam * light * smoothstep(1100.0, 450.0, w.y) * smoothstep(120.0, 420.0, w.y);
    // 帆布棚（上緣）：紅白條紋，下緣一排波浪的布邊；被燈從下面照亮
    vec2 wa = onZ(p, 160.0);
    float edge = 92.0 + 16.0 * (0.5 + 0.5 * cos(wa.x / 58.0 * PI));
    float aw = 1.0 - smoothstep(edge - 1.0, edge + 1.0, wa.y);
    if (aw > 0.0) {
      float stripe = step(0.5, fract(wa.x / 116.0));
      vec3 cloth = mix(C_COLLAR * 0.42, C_BONE * 0.5, stripe);
      cloth *= 0.35 + 0.65 * smoothstep(-200.0, edge, wa.y) * (0.75 + 0.25 * sin(wa.x / 14.0 + 0.3 * sin(wa.y / 9.0)));
      col = mix(col, cloth, aw);
    }
    // 燈泡：電線、燈座、燈泡、燈絲；光暈
    vec2 wb = onZ(p, BZ);
    col = mix(col, C_INK2 * 0.7, (1.0 - smoothstep(0.8, 2.2, abs(wb.y - bulbWire(wb.x)))) * 0.9);
    float fi = clamp(floor((wb.x - B0) / BSP + 0.5), 0.0, ${NB - 1}.0);
    for (int j = -1; j <= 1; j++) {
      int i = int(fi) + j;
      if (i < 0 || i > ${NB - 1}) continue;
      float x = B0 + float(i) * BSP;
      vec2 top = vec2(x, bulbWire(x));
      vec2 b = bulbPos(i);
      float dcord = sdSegment(wb, top, b) - 1.2;
      col = mix(col, C_INK2 * 0.8, fillAA(dcord, 0.9));
      vec2 ax = normalize(b - top);
      vec2 q = vec2(dot(wb - b, vec2(ax.y, -ax.x)), dot(wb - b, ax));
      float sock = sdBox(q - vec2(0.0, 8.0), vec2(12.0, 13.0)) - 2.0;
      vec2 bq = q - vec2(0.0, 44.0);
      // 梨形的燈泡：上窄下圓
      float bulb = (length(bq / vec2(25.0 - 6.0 * smoothstep(0.0, -26.0, bq.y), 30.0)) - 1.0) * 25.0;
      float flick = 0.95 + 0.05 * sin(t * 13.0 + float(i) * 2.7);
      col += warmL() * 0.14 * flick * exp(-dot(bq, bq) / 16000.0) + warmL() * 0.05 * flick * exp(-dot(bq, bq) / 90000.0);
      col = mix(col, C_INK2 * 0.9, fillAA(sock, 0.9));
      vec3 glass = mix(warmL(), C_BONE, 0.3) * (0.5 + 0.38 * exp(-dot(bq, bq) / 300.0)) * flick;
      // 燈絲：中間一小段彎彎的線
      float fil = (1.0 - smoothstep(0.8, 2.2, abs(bq.y + 2.0 - 3.0 * cos(bq.x * 0.5)))) * step(abs(bq.x), 8.0);
      glass = mix(glass, C_EMBER * 1.4, fil);
      col = mix(col, glass, fillAA(bulb, 0.9));
    }
    // 鐵線（掛照片與紙板）
    col = mix(col, C_GRAPHITE * 0.35, (1.0 - smoothstep(0.7, 1.8, abs(w.y - WIRE_Y - 0.00002 * pow(w.x - 960.0, 2.0)))) * 0.95);
    // 相片：以夾子為原點晃；影子落在後面看不到（夜裡），只在照片背後暗一點
    {
      vec2 q = rot2(-phR) * (w - phPiv);
      vec2 hs = phHalf + phBd;
      vec2 c = vec2(0.0, hs.y - 14.0);
      vec4 pr = printAt(photo, q - c, phHalf, phBd, lod, 0.8, crop);
      pr.rgb *= light * tint;
      col = mix(col, pr.rgb, pr.a);
      vec4 pg = peg(q);
      col = mix(col, pg.rgb * (0.4 + 0.6 * light), pg.a);
    }
    // 瓦楞紙板（價目牌的樣子）：牛皮色、邊緣看得到瓦楞的波紋、麥克筆字
    if (hasTxt > 0.5) {
      vec2 q = rot2(-cdR) * (w - cdPiv);
      vec2 c = q - vec2(0.0, cdHalf.y - 12.0);
      float torn = 4.0 * (hash11(floor(c.x / 9.0) + 3.0) - 0.5) + 3.0 * (hash11(floor(c.y / 11.0) + 9.0) - 0.5);
      float dc = sdBox(c, cdHalf) + torn * smoothstep(cdHalf.y - 10.0, cdHalf.y, abs(c.y)) ;
      float ac = fillAA(dc, 0.8);
      if (ac > 0.0) {
        float lc = 0.2 + 0.8 * pow(clamp(lightAt(w) / 0.5, 0.0, 1.0), 0.85);
        vec3 board = mix(C_FUR, C_BONE, 0.35) * 0.62 * (0.94 + 0.06 * paperTex(c * 1.2));
        board *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 6.0, -dc)) * (0.5 + 0.5 * sin(c.x * 0.9));
        vec4 tx = layerAt(txt, (c + cdHalf) / txS);
        board = board * (1.0 - tx.a) + tx.rgb;
        board *= lc * tint;
        col = mix(col, board, ac);
      }
      vec4 pg = peg(q);
      col = mix(col, pg.rgb * (0.4 + 0.6 * light), pg.a);
    }
    // 前景：一顆很近、很糊的燈泡光（左上角）
    vec2 wn = onZ(p, 1500.0);
    col += warmL() * 0.12 * exp(-dot((wn - vec2(500.0, 130.0)) / 150.0, (wn - vec2(500.0, 130.0)) / 150.0));
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, txt: { value: null }, hasTxt: { value: 0 }, ...camUniforms(),
  swing: { value: new Array(NB).fill(0) }, B0: { value: 60 },
  phPiv: { value: new THREE.Vector2() }, phR: { value: 0 }, phHalf: { value: new THREE.Vector2() }, phBd: { value: 16 }, lod: { value: 0 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  cdPiv: { value: new THREE.Vector2() }, cdR: { value: 0 }, cdHalf: { value: new THREE.Vector2() }, txS: { value: new THREE.Vector2(1, 1) },
  puff: { value: 0 }, t: { value: 0 }, k: { value: 1 }, blurBG: { value: 10 },
});

export default class NightMarket extends P9Plate {
  bg = shared('nightmarket.bg', BG);
  txt: Layer2D | null = null;
  words: Words | null = null;
  hw = 0; hh = 0; bd = 16;
  phX = 960; cdX = 0; cdW = 0; cdH = 0;
  b0 = 60;
  /** 紙板被夾上去的時間（先從上面掉下來、被夾子夾住，才開始寫字，不要先掛一塊空白的紙板）。 */
  tSign = 0;

  override async init() {
    await this.loadPhoto();
    const { end } = this.ctx;
    const probe = document.createElement('canvas').getContext('2d')!;
    const pw = photoWords(this.ctx);
    const words = pw.kind !== 'none' || pw.lyrics ? new Words(this.ctx, probe, {
      family: F.hand(700), w: 520, h: 560, min: 40, max: 50, lineHeight: 1.38, maxLines: 5, align: 'left',
      ink: rgba('ink', 0.86), unsung: rgba('ink', 0.3), active: mixRgba('signal', 'ink', 0.25), sigInk: rgba('ink', 0.72), sigSize: 28,
      album: { family: F.hand(700), size: 22, color: rgba('ink', 0.55) },
    }) : null;
    this.words = words?.has ? words : null;
    let ph = fitPhoto(this.img, 880, 560);
    if (this.words) {
      const words = this.words;
      // 紙板跟著字的大小（短的註解不用整塊寬的紙板）；字的上緣約 y = 340
      this.cdW = Math.max(240, words.width + 10) + 76; this.cdH = words.height + 84;
      this.cdX = Math.min(1290, 1760 - this.cdW / 2);
      // 字的最後一行比 HUD 區低（y > 800，留鏡頭推近的餘裕）：紙板往左挪，字整塊在 x < 1350
      if (WIRE_Y + 38 + words.height > 800) this.cdX = Math.min(this.cdX, 1388 - this.cdW / 2);
      // 照片在紙板左邊（紙板挪過來時照片小一點）
      const room = this.cdX - this.cdW / 2 - 70 - 110;
      ph = fitPhoto(this.img, Math.min(660, room - 40), 520);
      this.phX = this.cdX - this.cdW / 2 - 70 - ph.w / 2 - 20;
      this.txt = this.track(new Layer2D(Math.ceil(this.cdW), Math.ceil(this.cdH), undefined, { fast: true }));
    } else this.phX = 940;
    this.hw = ph.w / 2; this.hh = ph.h / 2;
    this.bd = clamp(0.04 * Math.min(ph.w, ph.h), 10, 20);
    // 燈泡不要剛好在夾子正上方
    this.b0 = ((((this.phX - BSP / 2) % BSP) + BSP) % BSP) - BSP;
    const t0 = this.cue(0.3, 0.9);
    this.tSign = t0;
    this.words?.writeFrom(t0 + 0.3, Math.max(0.6, Math.min(2.2, (end - t0 - 0.3) * 0.5)));
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const u = this.bg.u;
    // 每個小節線一陣風：燈泡晃大一點（一顆晚一點）、熱氣冒一團
    const barLen = audio.beatPeriod(t) * 4;
    const gust = (delay: number) => {
      const ph = f.barPhase * barLen - delay;
      return ph > 0 ? Math.exp(-ph * 1.5) * Math.sin(ph * 3.6) : 0;
    };
    const sw = u.swing!.value as number[];
    for (let i = 0; i < NB; i++) sw[i] = (2.5 * Math.sin(lt * 1.6 + i * 1.1) + 7 * gust(i * 0.07)) * RAD;
    u.B0!.value = this.b0;
    u.puff!.value = Math.exp(-f.barPhase * 3);
    const phR = (0.8 * Math.sin(lt * 1.2) + 1.6 * gust(0.2)) * RAD;
    (u.phPiv!.value as THREE.Vector2).set(this.phX, WIRE_Y + 0.00002 * (this.phX - 960) ** 2);
    u.phR!.value = phR;
    (u.phHalf!.value as THREE.Vector2).set(this.hw, this.hh);
    u.phBd!.value = this.bd;
    // 鏡頭：甩鏡頭進來（很快地橫搖、停住），之後像手持一樣微微晃、慢慢推近
    const whip = ease.outExpo(clamp(lt / 0.7));
    const side = hash(this.seed, 5) < 0.5 ? -1 : 1;
    const hx = 6 * fbm1(lt * 0.7, 2, this.seed), hy = 4 * fbm1(lt * 0.6 + 9, 2, this.seed);
    // 焦點：照片上的畫面往焦點推；鏡頭也往焦點那一點慢慢移（有字時移得少，紙板上的字一直在畫面裡）
    const crop = this.focus(t, this.tSign, this.hw / this.hh, { zoom: 1.18, screenW: 2 * this.hw });
    (u.crop!.value as THREE.Vector4).set(...crop);
    const [fu, fv] = focusIn(this.photo, crop);
    const focX = this.phX + (fu - 0.5) * 2 * this.hw, focY = WIRE_Y - 14 + this.bd + fv * 2 * this.hh;
    const toF = (this.words ? 0.16 : 0.38) * settleK(t - this.tSign, 6);
    const push = 1 - Math.exp(-lt / 7);
    const zoom = 1.0 + (this.words ? 0.03 : 0.08) * push;
    const cx0 = 960 + side * (1 - whip) * 900 + hx, cy0 = 545 + hy;
    setCam(u, { x: cx0 + (focX - 960) * toF, y: cy0 + (focY - 545) * toF, z: 0, dist: DIST, zoom, yaw: side * (1 - whip) * 10 * RAD, roll: (0.6 * fbm1(lt * 0.4 + 3, 2, this.seed)) * RAD });
    u.blurBG!.value = 10 + 60 * (1 - whip);
    u.lod!.value = this.lod(2 * this.hw * zoom, crop[2] - crop[0]) + 2 * (1 - whip);
    u.t!.value = t;
    u.k!.value = (0.8 + 0.2 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.15 * prog(t, e - 0.3, e));
    u.photo!.value = this.tex;
    u.hasTxt!.value = this.words ? 1 : 0;
    // shader 是共用的：沒有字的窗格也要換掉上一個窗格（已經釋放）的字圖層
    u.txt!.value = this.tex;
    if (this.words && this.txt) {
      const L = this.txt;
      if (this.words.draw(L.ctx, t, 38, 50, () => L.clear())) L.upload();
      u.txt!.value = L.texture;
      const drop = ease.outBack(prog(t, this.tSign, this.tSign + 0.5), 1.4);
      (u.cdPiv!.value as THREE.Vector2).set(this.cdX, WIRE_Y + 0.00002 * (this.cdX - 960) ** 2 - (1 - drop) * (this.cdH + WIRE_Y + 120));
      u.cdR!.value = (1.2 * Math.sin(lt * 1.4 + 1.5) + 2.2 * gust(0.35)) * RAD;
      (u.cdHalf!.value as THREE.Vector2).set(this.cdW / 2, this.cdH / 2);
      (u.txS!.value as THREE.Vector2).set(L.w, L.h);
    }
    this.bg.render(renderer, out);
    return { bloom: 0.35, bloomThreshold: 1.0, halation: 0.18, vignette: 0.5 };
  }
}

