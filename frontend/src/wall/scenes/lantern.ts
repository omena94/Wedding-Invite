// 照片版面「燈籠」（P9 台灣味，暗）：夜裡一串紅燈籠（固定色 collar）掛在畫面上方的電線上，照片（有白邊的相片）用兩條細繩吊在燈籠下——
//  - 切進來時鏡頭往上看著還沒點亮的燈籠，然後慢慢往下搖到照片；第一個拍點起，燈籠從左到右一拍亮一盞，
//    亮的燈籠在夜裡暈開一圈暖光，照片被一盞一盞的燈照亮（燈還沒全亮時照片暗暗的）。
//  - 字寫在照片旁邊另一張吊著的紙籤上（像元宵掛在燈下的燈謎），手寫：主字（賓客的祝福＋署名，或新人的註解）一個字一個字寫出來，
//    歌詞小一號寫在下面跟唱；沒有主字時歌詞自己寫在紙籤上（_photo.ts 的 PhotoText）。紙籤跟著字變大；
//    字多、紙籤長到右下角 HUD 的高度時，紙籤往左挪、照片小一點（字不進 HUD 區）。兩個都沒有：只有照片，吊在畫面中間。
//  - 焦點：照片上的畫面往焦點推（1.18 倍），鏡頭也慢慢往焦點那一點移。
//  - 一直在動：照片與紙籤像鐘擺一樣輕輕晃（每個小節線一陣風，晃大一點再慢慢停），燈籠跟著晃、穗子飄；
//    遠處還有一串比較小、失焦的燈籠，更遠是一點一點的散景，鏡頭很慢地橫移，遠近的東西移得不一樣快（視差）。
// 畫法：一個 shader：夜空與散景（遠的平面）、遠的一串燈籠（失焦）、電線、近的燈籠（紙的骨架、上下的蓋、穗子、裡面的光）、
// 燈在空氣裡的光暈、細繩、相片、紙籤（字是一張 Canvas，shader 在紙籤的座標取樣）。照片與紙籤的亮度照每盞燈的距離算。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { F } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { beatAfter } from './_motifs';
import { focusIn, photoWords, settleK } from './_photo';
import { P9Plate, P9_GLSL, P9_CAM_GLSL, Words, camUniforms, fitPhoto, setCam } from './_p9';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'local', prefers: ['landscape', 'square'], energy: [0, 1], bars: [2, 8], weight: 1 };

const DIST = 2400;
const RAD = Math.PI / 180;
/** 近的那串燈籠：幾盞、從哪裡開始、間隔。 */
const N = 6, SP = 330;
/** 電線：兩端高、中間垂下來。 */
/** 吊照片與紙籤的電線（z = 0）：兩端高一點、中間微微垂下。燈籠那串在它後面（shader 的 LZ）。 */
const wireY = (x: number) => 262 + 22 * (1 - ((x - 960) / 1300) ** 2);

const BG = () => new FSPass(/* glsl */ `
  ${P9_GLSL}
  ${P9_CAM_GLSL}
  uniform sampler2D photo; uniform sampler2D txt; uniform float hasTxt;
  uniform float lit[${N}]; uniform float sway[${N}];
  uniform vec2 phPiv; uniform float phR; uniform float phDrop; uniform vec2 phHalf; uniform float phBd; uniform float lod; uniform vec4 crop;
  uniform vec2 cdPiv; uniform float cdR; uniform float cdDrop; uniform vec2 cdHalf; uniform vec2 txS;
  uniform float t; uniform float k;

  uniform float X0;
  const float SP = ${SP}.0;
  const float FAR_Z = -1900.0, SKY_Z = -6000.0;
  // 燈籠的電線（在照片後面 LZ 的地方）與吊照片的電線（z = 0）
  const float LZ = -380.0;
  float wireY(float x) { float u = (x - 960.0) / 1300.0; return 4.0 + 96.0 * (1.0 - u * u); }
  float frontY(float x) { float u = (x - 960.0) / 1300.0; return 262.0 + 22.0 * (1.0 - u * u); }
  vec3 warm() { return mix(C_COLLAR, C_FUR, 0.55); }

  // 一盞燈籠（局部座標：原點是燈身中心）：回傳顏色與覆蓋。on = 亮的程度，bl = 景深的邊緣寬
  vec4 lantern(vec2 q, vec2 r, float on, float bl, float seed) {
    vec2 e = q / r;
    float d = (length(e) - 1.0) * min(r.x, r.y);
    // 上下的蓋（深色的木頭，邊緣有一點金）
    float capH = r.y * 0.16, capW = r.x * 0.42;
    float dc = min(sdBox(q - vec2(0.0, -r.y * 0.98), vec2(capW, capH)), sdBox(q - vec2(0.0, r.y * 0.98), vec2(capW, capH)));
    // 穗子：從底下的蓋垂下來，一絲一絲
    vec2 tq = q - vec2(0.0, r.y * 1.1);
    float tl = r.y * 1.05;
    float tw = mix(r.x * 0.08, r.x * 0.2, clamp(tq.y / tl, 0.0, 1.0));
    float dt = max(abs(tq.x) - tw, abs(tq.y - tl * 0.5) - tl * 0.5);
    float a = max(max(fillAA(d, bl), fillAA(dc, bl)), fillAA(dt, bl));
    if (a <= 0.0) return vec4(0.0);
    // 紙：中間被裡面的燈照得亮、邊緣深紅；直的骨架一條一條（球面上的經線）
    float rr = clamp(length(e), 0.0, 1.0);
    float hw = sqrt(max(1.0 - e.y * e.y, 0.02));
    float lon = asin(clamp(e.x / hw, -1.0, 1.0));
    float rib = 1.0 - smoothstep(0.0, 0.05 + bl * 0.01, abs(fract(lon / 0.3 + 0.5) - 0.5));
    float glow = on * (1.0 - 0.75 * rr * rr);
    vec3 paper = C_COLLAR * (0.12 + 0.95 * glow) + C_FUR * 0.22 * on * (1.0 - rr) * (1.0 - rr);
    paper *= 1.0 - 0.35 * rib * (0.4 + 0.6 * on);
    // 燈籠中間一圈淡淡的金色腰帶
    paper = mix(paper, mix(C_FUR, C_BONE, 0.12) * (0.1 + 0.36 * on), (1.0 - smoothstep(0.0, 0.03 + bl * 0.01, abs(e.y + 0.02) - 0.035)) * step(rr, 0.999));
    vec3 col = paper;
    col = mix(col, mix(C_INK2, C_FUR, 0.18 + 0.25 * on) * (0.5 + 0.5 * on), fillAA(dc, bl));
    float strand = 0.6 + 0.4 * sin(tq.x * 1.3 + seed * 7.0);
    vec3 tas = C_COLLAR * (0.2 + 0.5 * on) * strand;
    col = mix(col, tas, fillAA(dt, bl) * (1.0 - fillAA(d, bl)) * (1.0 - fillAA(dc, bl)));
    return vec4(col, a);
  }

  // 近的那串（z = 0）的第 i 盞：掛點、晃的角度
  vec2 hangAt(float i) { float x = X0 + i * SP; return vec2(x, wireY(x)); }
  vec2 sizeAt(float i) { float h = hash11(i * 3.7 + 1.0); return vec2(66.0 + 10.0 * h, 56.0 + 8.0 * h); }

  // 這一點被近的燈籠照到多少（照片、紙籤、繩子用）
  float lightAt(vec2 w) {
    float L = 0.0;
    for (int i = 0; i < ${N}; i++) {
      vec2 c = hangAt(float(i)) + vec2(0.0, 26.0 + sizeAt(float(i)).y);
      vec2 dv = (w - c) / vec2(620.0, 520.0);
      L += lit[i] * 0.42 / (1.0 + 4.0 * dot(dv, dv));
    }
    return L;
  }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 夜空：上面最暗，下面一點點霧；遠處暖色的散景
    vec2 ws = onZ(p, SKY_Z);
    vec3 col = mix(C_INK, mix(C_INK2, C_GRAPHITE, 0.25), smoothstep(-800.0, 2600.0, ws.y)) * 0.9;
    {
      vec2 q = ws + vec2(t * 6.0, 0.0);
      vec2 id = floor(q / 420.0);
      vec2 h = hash22(id + 5.0);
      vec2 c = (id + 0.5) * 420.0 + (h - 0.5) * 220.0;
      float r = mix(40.0, 95.0, h.x);
      float dd = length(q - c) - r;
      float on = step(0.45, h.y) * smoothstep(-500.0, 900.0, ws.y);
      col += warm() * 0.11 * on * (1.0 - smoothstep(-r * 0.3, r * 0.1, dd)) * (0.7 + 0.3 * smoothstep(-r, -r * 0.4, dd));
    }
    // 遠的一串燈籠（小、失焦、都亮著）
    vec2 wf = onZ(p, FAR_Z);
    {
      float sp = 420.0;
      float xf = wf.x + 260.0;
      float i0 = floor(xf / sp);
      for (int j = 0; j < 2; j++) {
        float ii = i0 + float(j);
        float cx = ii * sp - 260.0 + sp * 0.5;
        float wy = 380.0 + 70.0 * (1.0 - pow((cx - 900.0) / 1800.0, 2.0)) + 40.0 * sin(ii * 1.7);
        vec2 q = wf - vec2(cx, wy + 120.0);
        vec4 ln = lantern(q, vec2(70.0, 58.0), 0.75 + 0.15 * sin(ii * 2.3 + t * 1.1), 9.0, ii);
        col = mix(col, ln.rgb * 0.75, ln.a * 0.9);
        col += warm() * 0.035 * exp(-dot(q, q) / 30000.0);
      }
    }
    // 燈籠那串的電線（在照片後面一點，稍微失焦）
    vec2 wl = onZ(p, LZ);
    col = mix(col, C_INK2 * 0.6, (1.0 - smoothstep(0.8, 2.6, abs(wl.y - wireY(wl.x)))) * 0.85);
    // 燈籠（只看最近的三盞）與它們的光暈
    float fi = clamp(floor((wl.x - X0) / SP + 0.5), 0.0, ${N - 1}.0);
    for (int j = -1; j <= 1; j++) {
      float i = fi + float(j);
      if (i < 0.0 || i > ${N - 1}.0) continue;
      int ii = int(i);
      vec2 piv = hangAt(i);
      vec2 r = sizeAt(i);
      vec2 q = rot2(sway[ii]) * (wl - piv) - vec2(0.0, 26.0 + r.y);
      // 掛繩
      float dcord = max(abs(q.x), abs(q.y + (26.0 + r.y) * 0.5) - (26.0 + r.y) * 0.5) - 1.0;
      col = mix(col, C_INK2 * 0.8, fillAA(dcord, 1.4));
      col += warm() * 0.07 * lit[ii] * exp(-dot(q, q) / (r.x * r.x * 4.5));
      vec4 ln = lantern(q, r, lit[ii], 1.8, i);
      col = mix(col, ln.rgb, ln.a);
    }
    // 吊照片的電線（近）
    vec2 w = onZ(p, 0.0);
    col = mix(col, C_INK2 * 0.7, (1.0 - smoothstep(0.7, 1.8, abs(w.y - frontY(w.x)))) * 0.9);
    float light = 0.22 + 0.78 * pow(clamp(lightAt(w) / 0.5, 0.0, 1.0), 0.8);
    vec3 tint = mix(vec3(1.0), vec3(1.0, 0.82, 0.66), 0.55 * clamp(light, 0.0, 1.0));
    // 細繩＋相片（以掛點為原點，晃的角度）
    {
      vec2 q = rot2(phR) * (w - phPiv);
      vec2 c = vec2(0.0, phDrop + phHalf.y + phBd);
      vec2 hs = phHalf + phBd;
      float ds = min(sdSegment(q, vec2(-hs.x * 0.72, 0.0), vec2(-hs.x * 0.72, phDrop)), sdSegment(q, vec2(hs.x * 0.72, 0.0), vec2(hs.x * 0.72, phDrop))) - 0.8;
      col = mix(col, C_ASH * 0.35 * light, fillAA(ds, 0.7));
      vec4 pr = printAt(photo, q - c, phHalf, phBd, lod, 0.8, crop);
      pr.rgb *= min(light, 1.0) * tint;
      // 白邊不能比照片亮太多（夜裡）
      col = mix(col, pr.rgb, pr.a);
    }
    // 紙籤（主字＋歌詞）
    if (hasTxt > 0.5) {
      vec2 q = rot2(cdR) * (w - cdPiv);
      float ds = sdSegment(q, vec2(0.0), vec2(0.0, cdDrop)) - 0.8;
      col = mix(col, C_ASH * 0.35 * light, fillAA(ds, 0.7));
      vec2 cq = q - vec2(0.0, cdDrop + cdHalf.y);
      float dcard = sdBox(cq, cdHalf);
      float ac = fillAA(dcard, 0.8);
      if (ac > 0.0) {
        float lc = 0.3 + 0.7 * pow(clamp(lightAt(w) / 0.45, 0.0, 1.0), 0.8);
        vec3 pc = mix(C_BONE, C_FUR, 0.12) * 0.8 * (0.96 + 0.04 * paperTex(cq * 1.5)) * (1.0 - 0.14 * smoothstep(-cdHalf.y, cdHalf.y, cq.y));
        // 紙籤上緣穿繩的小洞
        pc = mix(pc, C_INK2, fillAA(length(cq - vec2(0.0, -cdHalf.y + 16.0)) - 4.0, 0.8));
        vec4 tx = layerAt(txt, (cq + cdHalf) / txS);
        pc = pc * (1.0 - tx.a) + tx.rgb;
        pc *= lc * mix(vec3(1.0), vec3(1.0, 0.88, 0.76), 0.5 * lc);
        col = mix(col, pc, ac);
      }
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, txt: { value: null }, hasTxt: { value: 0 }, ...camUniforms(),
  lit: { value: new Array(N).fill(0) }, sway: { value: new Array(N).fill(0) },
  phPiv: { value: new THREE.Vector2() }, phR: { value: 0 }, phDrop: { value: 60 }, phHalf: { value: new THREE.Vector2() }, phBd: { value: 16 }, lod: { value: 0 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  cdPiv: { value: new THREE.Vector2() }, cdR: { value: 0 }, cdDrop: { value: 60 }, cdHalf: { value: new THREE.Vector2() }, txS: { value: new THREE.Vector2(1, 1) },
  t: { value: 0 }, k: { value: 1 }, X0: { value: 130 },
});

export default class Lantern extends P9Plate {
  bg = shared('lantern.bg', BG);
  txt: Layer2D | null = null;
  words: Words | null = null;
  hw = 0; hh = 0; bd = 16;
  /** 第一盞燈籠的位置。 */
  x0 = 130;
  /** 照片、紙籤的掛點（電線上）與吊繩長。 */
  phX = 960; phDrop = 200;
  cdX = 0; cdDrop = 230; cdW = 0; cdH = 0;
  /** 每盞燈亮起來的時間。 */
  tLit: number[] = [];
  /** 紙籤放下來的時間。 */
  tCard = 0;

  override async init() {
    await this.loadPhoto();
    const { end, audio } = this.ctx;
    const probe = document.createElement('canvas').getContext('2d')!;
    const pw = photoWords(this.ctx);
    const words = pw.kind !== 'none' || pw.lyrics ? new Words(this.ctx, probe, {
      family: F.hand(400), w: 520, h: 560, min: 40, max: 50, lineHeight: 1.4, maxLines: 5, align: 'left',
      ink: rgba('sepia', 0.95), unsung: rgba('sepia', 0.3), active: mixRgba('signal', 'sepia', 0.45),
      sigFamily: F.hand(700), sigInk: rgba('sepia', 0.8), sigSize: 28,
      album: { family: F.hand(700), size: 22, color: rgba('sepia', 0.6) },
    }) : null;
    this.words = words?.has ? words : null;
    // 照片的上緣在燈籠的穗子下面（y ≈ 340）
    const top = 335;
    let ph = fitPhoto(this.img, 900, 510);
    if (this.words) {
      const words = this.words;
      // 紙籤：跟著字的大小（短的註解不用整張寬的紙籤），掛在照片右邊、上緣跟照片差不多高
      this.cdW = Math.max(240, words.width + 10) + 70; this.cdH = words.height + 80;
      this.cdX = Math.min(1310, 1780 - this.cdW / 2);
      this.cdDrop = Math.max(36, 345 - wireY(this.cdX));
      // 字的最後一行比 HUD 區低（y > 800，留鏡頭推近的餘裕）：紙籤往左挪，字整塊在 x < 1350
      if (wireY(this.cdX) + this.cdDrop + 46 + words.height > 800) {
        this.cdX = Math.min(this.cdX, 1385 - this.cdW / 2);
        this.cdDrop = Math.max(36, 345 - wireY(this.cdX));
      }
      // 照片在紙籤左邊（字多、紙籤挪過來時照片小一點）
      const room = this.cdX - this.cdW / 2 - 70 - 110;
      ph = fitPhoto(this.img, Math.min(640, room - 40), 490);
      this.phX = this.cdX - this.cdW / 2 - 70 - ph.w / 2 - 20;
      this.txt = this.track(new Layer2D(Math.ceil(this.cdW), Math.ceil(this.cdH), undefined, { fast: true }));
    } else this.phX = 960;
    this.hw = ph.w / 2; this.hh = ph.h / 2;
    this.bd = clamp(0.04 * Math.min(ph.w, ph.h), 10, 20);
    this.phDrop = top - wireY(this.phX);
    // 燈籠掛在照片、紙籤的掛點中間（繩子不要穿過燈籠）
    this.x0 = (((this.phX - SP / 2) % SP) + SP) % SP;
    // 燈：第一個拍點起一拍亮一盞（短窗格壓縮）
    const t0 = this.cue(0.2, 0.7);
    const gap = Math.min(beatAfter(audio, t0, 1) - t0 || 0.45, (end - t0 - 0.6) / N, 0.6);
    this.tLit = Array.from({ length: N }, (_, i) => t0 + i * Math.max(0.12, gap));
    this.tCard = this.tLit[1]!;
    this.words?.writeFrom(this.tCard + 0.2, Math.max(0.6, Math.min(2.2, (end - this.tCard - 0.2) * 0.5)));
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const u = this.bg.u;
    const lit = u.lit!.value as number[], sw = u.sway!.value as number[];
    // 每個小節線一陣風：晃大一點再慢慢停（從左吹到右，一盞晚一點）
    const gust = (delay: number) => {
      const ph = f.barPhase * this.ctx.audio.beatPeriod(t) * 4 - delay;
      return ph > 0 ? Math.exp(-ph * 1.6) * Math.sin(ph * 4.2) : 0;
    };
    for (let i = 0; i < N; i++) {
      const ti = this.tLit[i]!;
      // 亮起來：很快地閃一下再穩住
      lit[i] = clamp(prog(t, ti, ti + 0.12) * (1 + 0.25 * Math.exp(-(t - ti) * 6) * (t > ti ? 1 : 0)) * (0.96 + 0.04 * Math.sin(t * 5.3 + i * 2.1)), 0, 1.15);
      sw[i] = (1.6 * Math.sin(lt * 1.3 + i * 0.9) + 3.2 * gust(i * 0.06)) * RAD;
    }
    // 照片與紙籤：鐘擺
    const phR = (0.9 * Math.sin(lt * 1.05 + 0.4) + 1.8 * gust(0.15)) * RAD;
    const cdR = (1.3 * Math.sin(lt * 1.25 + 2.0) + 2.6 * gust(0.3)) * RAD;
    (u.phPiv!.value as THREE.Vector2).set(this.phX, wireY(this.phX));
    u.phR!.value = phR;
    u.phDrop!.value = this.phDrop;
    (u.phHalf!.value as THREE.Vector2).set(this.hw, this.hh);
    u.phBd!.value = this.bd;
    // 焦點：燈亮起來之後，照片上的畫面往焦點推；鏡頭也往焦點那一點慢慢移（有字時移得少，紙籤上的字一直在畫面裡）
    const crop = this.focus(t, this.tLit[0]!, this.hw / this.hh, { zoom: 1.18, screenW: 2 * this.hw });
    (u.crop!.value as THREE.Vector4).set(...crop);
    const [fu, fv] = focusIn(this.photo, crop);
    const focX = this.phX + (fu - 0.5) * 2 * this.hw, focY = wireY(this.phX) + this.phDrop + this.bd + fv * 2 * this.hh;
    // 鏡頭：一開始往上看著燈籠，慢慢往下搖到照片；之後很慢地橫移、推近（往焦點靠）
    const tilt = ease.inOutCubic(prog(t, s, s + Math.min(2.4, (e - s) * 0.45)));
    const push = 1 - Math.exp(-lt / 7);
    const toF = (this.words ? 0.16 : 0.38) * settleK(t - this.tLit[0]!, 6) * tilt;
    const dir = hash(this.seed, 4) < 0.5 ? -1 : 1;
    const zoom = lerp(1.08, 1.0, tilt) + (this.words ? 0.03 : 0.08) * push;
    const cx0 = 960 + dir * (lerp(-30, 10, tilt) + (this.words ? 25 : 10) * push), cy0 = lerp(330, 548, tilt);
    setCam(u, {
      x: cx0 + (focX - cx0) * toF, y: cy0 + (focY - 548) * toF, z: 0, dist: DIST, zoom,
      pitch: lerp(9, 0, tilt) * RAD, roll: dir * lerp(1.2, 0.2, tilt) * RAD,
    });
    u.lod!.value = this.lod(2 * this.hw * zoom, crop[2] - crop[0]);
    u.t!.value = t;
    u.X0!.value = this.x0;
    u.k!.value = (0.75 + 0.25 * ease.outCubic(prog(t, s, s + 0.5))) * (1 - 0.15 * prog(t, e - 0.3, e));
    u.photo!.value = this.tex;
    u.hasTxt!.value = this.words ? 1 : 0;
    // shader 是共用的：沒有字的窗格也要換掉上一個窗格（已經釋放）的字圖層
    u.txt!.value = this.tex;
    if (this.words && this.txt) {
      const L = this.txt;
      if (this.words.draw(L.ctx, t, 35, 46, () => L.clear())) L.upload();
      u.txt!.value = L.texture;
      (u.cdPiv!.value as THREE.Vector2).set(this.cdX, wireY(this.cdX));
      u.cdR!.value = cdR;
      // 紙籤在寫字前從上面放下來（不要先掛一張空白的紙）
      const down = ease.outBack(prog(t, this.tCard, this.tCard + 0.7), 1.2);
      u.cdDrop!.value = lerp(-this.cdH - 500, this.cdDrop, down);
      (u.cdHalf!.value as THREE.Vector2).set(this.cdW / 2, this.cdH / 2);
      (u.txS!.value as THREE.Vector2).set(L.w, L.h);
    }
    this.bg.render(renderer, out);
    return { bloom: 0.25, bloomThreshold: 1.05, halation: 0.12, vignette: 0.5 };
  }
}
