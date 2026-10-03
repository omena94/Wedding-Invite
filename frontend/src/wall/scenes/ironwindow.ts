// 照片版面「鐵窗花」（P9 台灣味，亮）：老公寓的白牆，傍晚的太陽從左邊的窗戶斜斜照進來——
//  - 照片（有白邊的相片）用一顆圖釘釘在牆上，微微歪著；窗外的鐵窗花（框、直條、圓圈裡的四瓣花、上面的扇形、下面的菱格）
//    被夕陽投成一大片斜斜拉長的影子，落在牆上、也落在照片上（照片離牆一點點，影子跟著錯開一點）。
//  - 第一個拍點，窗簾被拉開：暖色的光從左到右鋪過牆面；之後太陽很慢地往下走，影子跟著慢慢滑動、越拉越長；
//    窗台上盆栽的葉子影子在光的下緣跟著風晃，每個小節線一陣風（窗簾的影子從左邊掃進來一點再退回去）；光裡飄著灰塵。
//  - 字是鉛筆寫在牆上的字（在照片右邊、光照不到的地方，像老房子牆上量身高的筆跡）：主字（賓客的祝福＋署名，或新人的註解）
//    一個字一個字寫出來，歌詞小一號寫在下面跟唱；沒有主字時歌詞自己寫在那個位置（_photo.ts 的 PhotoText）。
//    兩個都沒有：只有照片，在畫面中間。
//  - 焦點：牆上的照片往焦點推（1.18 倍），鏡頭也很慢地往焦點那一點移、推近一點點。
// 畫法：一個 shader：牆（灰泥）、窗格影子（鐵窗花的距離場，投影是拉長、斜切的仿射，離窗越遠半影越軟）、葉子影子、窗簾、
// 照片與圖釘（自己的影子）、灰塵、牆上的鉛筆字（Canvas，fast，shader 取樣、跟著牆的光）。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { F } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { focusIn, photoWords, settleK } from './_photo';
import { P9Plate, P9_GLSL, P9_CAM_GLSL, Words, camUniforms, fitPhoto, setCam } from './_p9';

export const spec: PlateSpecDecl = { photo: true, paper: true, family: 'photo', series: 'local', prefers: ['landscape', 'small'], energy: [0, 1], bars: [2, 8], weight: 1 };

const DIST = 2400;
const RAD = Math.PI / 180;

const BG = () => new FSPass(/* glsl */ `
  ${P9_GLSL}
  ${P9_CAM_GLSL}
  uniform sampler2D photo; uniform sampler2D txt; uniform float hasTxt; uniform vec2 txO; uniform vec2 txS;
  uniform vec2 phC; uniform float phR; uniform vec2 phHalf; uniform float phBd; uniform float lod; uniform vec4 crop;
  uniform vec4 win; uniform float reveal; uniform float sun; uniform float gust; uniform float t; uniform float k;

  // 鐵窗花（窗的座標：1200 × 900，左上原點）的距離場：鐵條是 0 以下
  float grille(vec2 g) {
    vec2 c = g - vec2(600.0, 450.0);
    float d = abs(sdBox(c, vec2(592.0, 442.0))) - 9.0;
    d = min(d, abs(g.y - 300.0) - 5.0);
    d = min(d, abs(g.y - 600.0) - 5.0);
    // 上段：細直條＋中間的扇形
    if (g.y < 300.0) {
      float bx = abs(mod(g.x + 37.5, 75.0) - 37.5) - 3.0;
      vec2 f = g - vec2(600.0, 300.0);
      float r = length(f);
      float fan = max(r - 200.0, -f.y);
      float spokes = abs(sin(atan(-f.y, f.x) * 6.0)) * r / 6.0 - 3.0;
      float inFan = step(fan, 0.0);
      d = min(d, mix(bx, min(spokes, abs(r - 200.0) - 5.0), inFan));
      d = min(d, abs(r - 70.0) - 4.0 + 1e3 * step(0.0, f.y));
    } else if (g.y < 600.0) {
      // 中段：每格一個圓，裡面一朵四瓣花
      float bx = abs(mod(g.x, 300.0) - 150.0);
      d = min(d, 150.0 - bx - 4.0);
      vec2 cc = vec2(mod(g.x, 300.0) - 150.0, g.y - 450.0);
      d = min(d, abs(length(cc) - 112.0) - 5.0);
      vec2 a = abs(cc);
      vec2 pa = a.x > a.y ? vec2(a.x, a.y) : vec2(a.y, a.x);
      float petal = (length((pa - vec2(52.0, 0.0)) / vec2(40.0, 20.0)) - 1.0) * 20.0;
      d = min(d, abs(petal) - 3.5);
      d = min(d, length(cc) - 9.0);
    } else {
      // 下段：菱格
      float l1 = abs(mod(g.x + g.y, 130.0) - 65.0) - 3.5;
      float l2 = abs(mod(g.x - g.y + 1000.0, 130.0) - 65.0) - 3.5;
      d = min(d, min(l1, l2));
    }
    return d;
  }

  // 牆上的點（z = 牆面往外多遠）照到多少夕陽：0 = 陰影，1 = 光
  float sunAt(vec2 w, float z) {
    // 光從左上斜下來：離牆 z 的東西，影子往右下錯開
    w -= vec2(0.62, 0.3) * z;
    // 牆 → 窗的座標：斜切、往右越拉越長（低角度的夕陽）
    float x = w.x - win.x - (w.y - 540.0) * 0.42;
    float u = x / (win.z * (1.0 + x / 2600.0));
    float v = (w.y - win.y - x * 0.16) / win.w;
    vec2 g = vec2(u * 1200.0, v * 900.0);
    float blur = 2.0 + max(x, 0.0) * 0.012;
    float inWin = (1.0 - smoothstep(-blur, blur, sdBox(g - vec2(600.0, 450.0), vec2(600.0, 450.0))));
    float s = smoothstep(-blur, blur, grille(g)) * inWin;
    // 窗台上盆栽的葉子（下緣），跟著風晃
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      vec2 lc = vec2(90.0 + fi * 70.0 + 24.0 * sin(fi * 2.1), 930.0 - 110.0 * abs(sin(fi * 1.3 + 0.4)));
      float ang = -0.9 + fi * 0.33 + (0.06 + 0.1 * gust) * sin(t * (1.1 + 0.2 * fi) + fi);
      vec2 q = rot2(ang) * (g - lc);
      float leaf = (length(q / vec2(58.0, 17.0)) - 1.0) * 17.0;
      s *= smoothstep(-blur * 2.0, blur * 2.0, leaf);
    }
    // 窗簾：拉開的時候光從左鋪到右；每個小節線一陣風，窗簾的影子從左邊掃進來一點
    s *= 1.0 - smoothstep(reveal - 0.06, reveal + 0.06, u);
    s *= smoothstep(0.0, 0.12, u - 0.18 * gust);
    return s;
  }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 w = onZ(p, 0.0);
    // 灰泥牆：大塊的斑駁、細的顆粒
    float n = 0.6 * fbm(w / 380.0, 3) + 0.4 * snoise(w / 7.0) * 0.3;
    vec3 wall = mix(C_PAPER, C_BONE, 0.4) * (0.94 + 0.035 * n);
    vec3 sunC = mix(vec3(1.0), mix(C_FUR, C_BONE, 0.35) * 1.5, 0.5);
    float shadeK = 0.6;
    float s = sunAt(w, 0.0) * sun;
    vec3 col = wall * mix(vec3(shadeK) * vec3(0.96, 0.98, 1.04), sunC * 1.04, s);
    // 鉛筆字（在牆上，跟著牆的光）
    if (hasTxt > 0.5) {
      vec4 tx = layerAt(txt, (w - txO) / txS);
      float grain = 0.82 + 0.18 * snoise(w * 0.9);
      col = mix(col, tx.a > 0.0 ? tx.rgb / tx.a * mix(shadeK, 1.0, s) : col, tx.a * grain);
    }
    // 照片：影子（只在有光的地方明顯）、相片、圖釘
    vec2 hs = phHalf + phBd;
    vec2 qs = rot2(-phR) * (w - phC - vec2(16.0, 10.0));
    float shp = boxShade(sdBox(qs, hs), 9.0);
    col *= 1.0 - shp * mix(0.12, 0.4, s);
    vec2 q = rot2(-phR) * (w - phC);
    vec4 pr = printAt(photo, q, phHalf, phBd, lod, 0.8, crop);
    if (pr.a > 0.0) {
      float sp = mix(0.5, sunAt(w, 8.0), 0.85) * sun;
      // 照片上的影子淡一點（照片要看得清楚）
      vec3 lp = mix(vec3(0.8) * vec3(0.97, 0.98, 1.03), mix(vec3(1.0), mix(C_FUR, C_BONE, 0.35) * 1.4, 0.4), sp);
      col = mix(col, pr.rgb * lp, pr.a);
    }
    vec2 pin = phC + rot2(phR) * vec2(0.0, -hs.y + 22.0);
    float dpin = length(w - pin) - 11.0;
    col *= 1.0 - 0.3 * boxShade(length(w - pin - vec2(9.0, 6.0)) - 10.0, 4.0);
    vec3 pinC = C_COLLAR * (0.7 + 0.5 * smoothstep(10.0, 0.0, length(w - pin + vec2(4.0, 4.0))));
    col = mix(col, pinC, fillAA(dpin, 0.8));
    // 光裡飄的灰塵
    vec2 dq = p + vec2(-t * 9.0, t * 5.0);
    vec2 did = floor(dq / 54.0);
    vec2 dh = hash22(did);
    vec2 dc = (did + 0.2 + 0.6 * dh) * 54.0 + 6.0 * vec2(sin(t * 0.7 + dh.x * 6.0), cos(t * 0.5 + dh.y * 6.0));
    float dr = mix(1.0, 3.2, dh.y);
    float mote = (1.0 - smoothstep(dr * 0.4, dr, length(dq - dc))) * step(0.72, dh.x);
    col += mix(C_FUR, C_BONE, 0.6) * 0.16 * mote * s;
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, txt: { value: null }, hasTxt: { value: 0 }, txO: { value: new THREE.Vector2() }, txS: { value: new THREE.Vector2(1, 1) },
  ...camUniforms(),
  phC: { value: new THREE.Vector2() }, phR: { value: 0 }, phHalf: { value: new THREE.Vector2() }, phBd: { value: 16 }, lod: { value: 0 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  win: { value: new THREE.Vector4() }, reveal: { value: 0 }, sun: { value: 1 }, gust: { value: 0 }, t: { value: 0 }, k: { value: 1 },
});

export default class IronWindow extends P9Plate {
  bg = shared('ironwindow.bg', BG);
  txt: Layer2D | null = null;
  words: Words | null = null;
  hw = 0; hh = 0; bd = 16;
  cx = 900; cy = 470; ang = 0;
  txX = 0; txY = 0;
  tOpen = 0;

  override async init() {
    await this.loadPhoto();
    const { end } = this.ctx;
    const probe = document.createElement('canvas').getContext('2d')!;
    const pw = photoWords(this.ctx);
    // 鉛筆字的框：照片右邊的牆（60 字的留言排五行；整塊的最後一行在 HUD 區上面）
    const words = pw.kind !== 'none' || pw.lyrics ? new Words(this.ctx, probe, {
      family: F.hand(400), w: 560, h: 600, min: 40, max: 50, lineHeight: 1.42, maxLines: 5, align: 'left',
      ink: mixRgba('graphite', 'sepia', 0.55, 0.92), unsung: mixRgba('graphite', 'sepia', 0.55, 0.3), active: mixRgba('signal', 'sepia', 0.4),
      sigFamily: F.hand(700), sigInk: mixRgba('graphite', 'sepia', 0.55, 0.8), sigSize: 28,
      album: { family: F.hand(700), size: 22, color: rgba('graphite', 0.7) },
    }) : null;
    this.words = words?.has ? words : null;
    const ph = this.words ? fitPhoto(this.img, 760, 640) : fitPhoto(this.img, 980, 690);
    this.hw = ph.w / 2; this.hh = ph.h / 2;
    this.bd = clamp(0.04 * Math.min(ph.w, ph.h), 10, 20);
    this.ang = (hash(this.seed, 6) - 0.5) * 3 * RAD;
    if (this.words) {
      // 照片＋字當成一組置中（偏左一點）；字在照片右邊的牆上（光照不到的地方），跟照片的中間對齊，最後一行在 HUD 區上面
      const words = this.words;
      const tw = words.width;
      const gw = 2 * (this.hw + this.bd) + 110 + tw;
      this.cx = Math.max(140 + this.hw, (1920 - gw) / 2 - 30 + this.hw + this.bd); this.cy = 480;
      this.txX = this.cx + this.hw + this.bd + 110 - 20;
      this.txY = clamp(this.cy - words.height / 2, 150, 790 - words.height) - 20;
      this.txt = this.track(new Layer2D(Math.ceil(words.st.w + 40), Math.ceil(words.height + 50), undefined, { fast: true }));
    } else { this.cx = 900; this.cy = 470; }
    this.tOpen = this.cue(0.2, 0.8);
    this.words?.writeFrom(this.tOpen + 0.5, Math.max(0.6, Math.min(2.4, (end - this.tOpen - 0.5) * 0.5)));
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const u = this.bg.u;
    (u.phC!.value as THREE.Vector2).set(this.cx, this.cy);
    u.phR!.value = this.ang;
    (u.phHalf!.value as THREE.Vector2).set(this.hw, this.hh);
    u.phBd!.value = this.bd;
    // 窗戶投在牆上的範圍（左上角、寬、高）：太陽很慢地往下走，影子往右下滑
    const drift = 1 - Math.exp(-lt / 9);
    // 光的右緣停在照片右邊一點（字在光照不到的地方）；投影往右越拉越長，寬度要先除回去
    const X = this.cx + this.hw + this.bd + (this.words ? 50 : 160) - 60;
    (u.win!.value as THREE.Vector4).set(60 + 36 * drift, 40 + 26 * drift, X / (1 + X / 2600), 900);
    u.reveal!.value = lerp(-0.1, 1.15, ease.inOutCubic(prog(t, this.tOpen, this.tOpen + 0.85)));
    u.sun!.value = 1;
    // 每個小節線一陣風
    const bp = f.barPhase;
    u.gust!.value = Math.sin(Math.PI * clamp(bp / 0.6)) * (bp < 0.6 ? 1 : 0) * 0.8;
    u.t!.value = t;
    // 焦點：牆上的照片往焦點推；鏡頭也往焦點那一點慢慢移（有字時移得少，字一直在畫面裡）
    const crop = this.focus(t, this.tOpen, this.hw / this.hh, { zoom: 1.18, screenW: 2 * this.hw });
    (u.crop!.value as THREE.Vector4).set(...crop);
    const [fu, fv] = focusIn(this.photo, crop);
    const qx = (fu - 0.5) * 2 * this.hw, qy = (fv - 0.5) * 2 * this.hh;
    const focX = this.cx + qx * Math.cos(this.ang) - qy * Math.sin(this.ang), focY = this.cy + qx * Math.sin(this.ang) + qy * Math.cos(this.ang);
    const toF = (this.words ? 0.16 : 0.4) * settleK(t - this.tOpen, 6);
    const push = 1 - Math.exp(-lt / 7);
    const settle = ease.outExpo(clamp(lt / 1.2));
    const zoom = lerp(1.06, 1.0, settle) + (this.words ? 0.03 : 0.08) * push;
    const cx0 = 935 + (this.words ? 50 : 20) * push;
    setCam(u, { x: cx0 + (focX - cx0) * toF, y: 535 + (focY - 535) * toF, z: 0, dist: DIST, zoom, yaw: lerp(-3, -1, settle) * RAD, roll: 0.3 * RAD });
    u.lod!.value = this.lod(2 * this.hw * zoom, crop[2] - crop[0]);
    u.k!.value = (0.9 + 0.1 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.1 * prog(t, e - 0.3, e));
    u.photo!.value = this.tex;
    u.hasTxt!.value = this.words ? 1 : 0;
    // shader 是共用的：沒有字的窗格也要換掉上一個窗格（已經釋放）的字圖層
    u.txt!.value = this.tex;
    if (this.words && this.txt) {
      const L = this.txt;
      if (this.words.draw(L.ctx, t, 20, 20, () => L.clear())) L.upload();
      u.txt!.value = L.texture;
      (u.txO!.value as THREE.Vector2).set(this.txX, this.txY);
      (u.txS!.value as THREE.Vector2).set(L.w, L.h);
    }
    this.bg.render(renderer, out);
    return { paper: 1, bloom: 0.12, bloomThreshold: 1.15, halation: 0.05, vignette: 0.34 };
  }
}
