// 照片版面「三合院」（P9 台灣味，亮）：三合院的紅磚牆前，一面圓竹篩斜靠在牆上曬太陽，照片就放在竹篩上——
//  - 紅磚牆（磚與灰縫）、地上的紅地磚往鏡頭延伸；午後的太陽從左上照下來，樹葉的影子一片一片落在牆上、竹篩上、照片上，
//    慢慢地晃；光裡飄著細細的灰塵。照片的一角壓著一顆小石頭，對角被風吹得微微掀起（每個小節線一陣風）。
//  - 切進來時鏡頭低低地看著地磚，往上搖到竹篩；之後很慢地橫移、推近。
//  - 字是用粉筆寫在竹篩旁邊的紅磚牆上（白色的粉筆字，有粉筆的顆粒）：主字（賓客的祝福＋署名，或新人的註解）一個字一個字寫出來，
//    歌詞小一號寫在下面跟唱；沒有主字時歌詞自己寫在那個位置（_photo.ts 的 PhotoText）。兩個都沒有：只有竹篩與照片，在畫面中間。
//  - 焦點：竹篩上的照片往焦點推（1.18 倍），鏡頭也慢慢往焦點那一點移、推近。
//  - 磚、竹子、地磚是實物本來的顏色（固定色 collar、fur），不跟主題換。
// 畫法：一個 shader：牆（z = 0 的平面）、地面（水平面，射線求交）、竹篩（斜靠的平面：編織紋、竹圈）、照片、石頭、
// 樹葉的影子（每一點照光的方向投到同一張「樹蔭圖」上取樣）、灰塵；粉筆字是一張 Canvas（fast），shader 在牆上取樣。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { F } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { focusIn, photoWords, settleK } from './_photo';
import { P9Plate, P9_GLSL, P9_CAM_GLSL, Words, camUniforms, fitPhoto, setCam } from './_p9';

export const spec: PlateSpecDecl = { photo: true, paper: true, family: 'photo', series: 'local', prefers: ['square', 'small'], energy: [0, 1], bars: [2, 8], weight: 1 };

const DIST = 2400;
const RAD = Math.PI / 180;
/** 牆腳（地面）在哪裡、竹篩往後靠多少。 */
const FLOOR_Y = 930, LEAN = 16 * RAD;

const BG = () => new FSPass(/* glsl */ `
  ${P9_GLSL}
  ${P9_CAM_GLSL}
  uniform sampler2D photo; uniform sampler2D txt; uniform float hasTxt; uniform vec2 txO; uniform vec2 txS;
  uniform vec3 svC; uniform float svR; uniform float phR; uniform vec2 phOff; uniform vec2 phHalf; uniform float phBd; uniform float lod; uniform vec4 crop;
  uniform float flap; uniform vec2 leafOff; uniform float sunK; uniform float t; uniform float k;

  const float FLOOR_Y = ${FLOOR_Y}.0, LEAN = ${LEAN.toFixed(5)};
  const vec3 SUN = normalize(vec3(-0.45, -0.55, 0.7));   // 往太陽的方向（左上、前面）
  // 樹蔭：把一點沿著光的方向投到「樹的平面」上取樣，斑斑點點、慢慢晃；回傳照到太陽的比例
  float sunAt(vec3 P) {
    vec3 q = P + SUN * ((700.0 - P.z) / SUN.z);
    vec2 g = q.xy / 260.0 + leafOff;
    // 大塊的樹蔭（左上多、右下少）＋葉子之間漏下來的小光斑
    float big = fbm(g * 0.6 + vec2(0.0, t * 0.02), 3);
    float leaves = snoise(g * 3.1 + vec2(t * 0.12, 0.0)) * 0.55 + snoise(g * 6.7 - t * 0.08) * 0.25;
    float bias = -0.25 + 0.6 * smoothstep(-300.0, 1500.0, q.x + q.y * 0.6);
    float shade = smoothstep(0.05, -0.2, big + bias);
    float spots = smoothstep(0.15, 0.4, leaves);
    return mix(1.0, mix(0.0, 1.0, spots * 0.85), shade) * sunK + (1.0 - sunK) * 0.3;
  }
  vec3 litC(vec3 base, float s) { return base * mix(vec3(0.6, 0.63, 0.7), mix(vec3(1.0), C_FUR, 0.12) * 1.12, s); }

  // 紅磚牆（磚 120 × 40、灰縫、有幾塊燒得比較深）
  vec3 brick(vec2 w) {
    float row = floor(w.y / 44.0);
    vec2 bw = vec2(w.x + mod(row, 2.0) * 62.0, w.y);
    vec2 id = floor(bw / vec2(124.0, 44.0));
    vec2 f = bw - id * vec2(124.0, 44.0);
    float h = hash12(id);
    vec3 c = mix(mix(C_COLLAR, C_FUR, 0.25 + 0.15 * h), mix(C_BONE, C_GRAPHITE, 0.3), 0.18 + 0.1 * hash12(id + 3.0)) * (0.62 + 0.18 * h) * (0.94 + 0.06 * snoise(w / 18.0));
    c = mix(c, C_COLLAR * 0.42, step(0.9, h) * 0.5);
    float mortar = 1.0 - smoothstep(3.0, 5.0, min(min(f.x, 124.0 - f.x), min(f.y, 44.0 - f.y)));
    return mix(c, mix(C_BONE, C_GRAPHITE, 0.45) * 0.62, mortar);
  }
  // 稻埕（曬穀的水泥地）：曬得發白、一格一格的伸縮縫、幾條細裂紋
  vec3 floorTile(vec2 xz) {
    vec2 id = floor(xz / 420.0);
    vec2 f = xz - id * 420.0;
    vec3 c = mix(C_BONE, C_GRAPHITE, 0.22) * (0.86 + 0.06 * fbm(xz / 90.0, 3) + 0.03 * hash12(id));
    float g = 1.0 - smoothstep(1.5, 3.5, min(min(f.x, 420.0 - f.x), min(f.y, 420.0 - f.y)));
    float crack = 1.0 - smoothstep(0.0, 1.6, abs(snoise(xz / 160.0) * 60.0) - 0.4);
    c *= 1.0 - 0.18 * crack * smoothstep(0.3, 0.6, snoise(xz / 300.0 + 5.0));
    return mix(c, mix(C_BONE, C_GRAPHITE, 0.5) * 0.6, g);
  }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 D = camRay(p);
    // 牆（z = 0）或地面（y = FLOOR_Y）
    vec2 w = onZ(p, 0.0);
    vec3 col;
    vec3 P;
    if (w.y < FLOOR_Y) {
      P = vec3(w, 0.0);
      col = brick(w);
      // 牆腳一點青苔、牆面上面比較乾淨
      col = mix(col, mix(C_GINGHAM, C_INK2, 0.3), smoothstep(FLOOR_Y - 60.0, FLOOR_Y, w.y) * 0.35 * smoothstep(0.1, 0.6, snoise(w / 40.0)));
      // 粉筆字
      if (hasTxt > 0.5) {
        vec4 tx = layerAt(txt, (w - txO) / txS);
        float grain = smoothstep(-0.6, 0.4, snoise(w * 0.55)) * (0.75 + 0.25 * snoise(w * 0.12));
        // 字後面：屋簷的影子把那一塊牆壓暗一點（白的粉筆字才清楚），再一層很淡的擦過的粉筆灰
        float behind = boxShade(sdBox(w - txO - txS * 0.5, txS * 0.5 - 40.0), 70.0);
        col *= 1.0 - 0.3 * behind;
        col = mix(col, C_BONE * 0.7, 0.05 * behind);
        col = mix(col, tx.a > 0.0 ? tx.rgb / tx.a : col, tx.a * (0.6 + 0.4 * grain));
      }
    } else {
      float tt = (FLOOR_Y - camO.y) / D.y;
      P = camO + D * tt;
      col = floorTile(vec2(P.x, P.z));
      // 牆腳的陰影
      col *= 1.0 - 0.3 * exp(-P.z / 40.0);
    }
    // 竹篩在牆上、地上的影子（往右下、離得越遠越軟）
    vec3 sc = svC;
    vec2 shOff = vec2(0.55, 0.62) * (sc.z + 30.0);
    float dsh = length((P.xy - sc.xy - shOff) / vec2(1.0, 0.92)) - svR;
    col *= 1.0 - 0.3 * boxShade(dsh, 26.0) * step(P.z, 1.0);
    float s = sunAt(P);
    col = litC(col, s);
    // 竹篩：斜靠在牆上的平面（上緣碰到牆、下緣碰到地）
    vec3 ex = vec3(1.0, 0.0, 0.0), ey = vec3(0.0, cos(LEAN), sin(LEAN));
    vec3 n = cross(ex, ey);
    float dn = dot(D, n);
    float ts = dot(sc - camO, n) / dn;
    vec3 Q = camO + D * ts;
    vec2 q = vec2(dot(Q - sc, ex), dot(Q - sc, ey));
    float r = length(q);
    float aS = fillAA(r - svR, 1.0);
    if (aS > 0.0) {
      // 編織：兩個方向的竹篾交錯（一上一下）
      vec2 g = q / 17.0;
      vec2 id = floor(g);
      vec2 f = fract(g) - 0.5;
      float over = mod(id.x + id.y, 2.0);
      float strip = over > 0.5 ? abs(f.y) : abs(f.x);
      vec3 bam = mix(C_FUR, C_BONE, 0.45) * (0.62 + 0.1 * hash12(id)) * (0.8 + 0.2 * smoothstep(0.5, 0.15, strip));
      bam *= 0.88 + 0.12 * (over > 0.5 ? cos(f.x * 3.0) : cos(f.y * 3.0));
      // 中間微微凹下去（陰影），竹圈（粗、圓的竹子，上亮下暗）
      bam *= 1.0 - 0.12 * (1.0 - r / svR);
      // 竹篾比竹圈低：竹圈內側一圈影子
      bam *= 1.0 - 0.28 * smoothstep(svR - 70.0, svR - 24.0, r);
      float rim = abs(r - svR + 12.0) - 12.0;
      float hi = smoothstep(0.0, 1.0, 1.0 - abs(r - svR + 15.0) / 12.0) * (0.5 + 0.5 * dot(normalize(q + 1e-3), vec2(-0.6, -0.8)));
      vec3 rimC = mix(C_FUR, C_SEPIA, 0.35) * (0.5 + 0.45 * hi);
      bam = mix(bam, rimC, fillAA(rim, 1.0));
      // 照片：在竹篩上（一角被石頭壓著，對角被風掀起來一點）
      vec2 pq = rot2(-phR) * (q - phOff);
      vec2 hs = phHalf + phBd;
      float lift = flap * smoothstep(-0.2, 1.0, (pq.x / hs.x + pq.y / hs.y) * 0.5);
      vec2 pqs = pq - vec2(10.0, 12.0) - vec2(18.0, 22.0) * lift;
      bam *= 1.0 - 0.35 * boxShade(sdBox(pqs, hs), 5.0 + 14.0 * lift);
      vec3 PB = sc + ex * q.x + ey * q.y;
      float sB = sunAt(PB);
      bam = litC(bam, sB);
      vec4 pr = printAt(photo, pq, phHalf, phBd, lod, 1.0, crop);
      float sP = sunAt(PB + n * (4.0 + 20.0 * lift));
      // 照片上的樹蔭淡一點（照片要看得清楚）
      pr.rgb *= mix(vec3(0.78, 0.8, 0.86), mix(vec3(1.0), C_FUR, 0.1) * 1.06, 0.3 + 0.7 * sP) * (1.0 + 0.05 * lift);
      bam = mix(bam, pr.rgb, pr.a);
      // 石頭（壓在照片左上角）
      vec2 stc = rot2(phR) * (-hs + vec2(26.0, 22.0)) + phOff;
      vec2 sq = q - stc;
      float dst = (length(sq / vec2(30.0, 22.0)) - 1.0) * 22.0;
      bam *= 1.0 - 0.35 * boxShade(length((sq - vec2(9.0, 11.0)) / vec2(30.0, 22.0)) * 22.0 - 22.0, 5.0);
      vec3 stone = mix(C_GRAPHITE, C_BONE, 0.25) * (0.5 + 0.4 * smoothstep(20.0, -18.0, sq.x + sq.y)) * (0.92 + 0.08 * snoise(sq * 0.2));
      bam = mix(bam, litC(stone, sB), fillAA(dst, 1.0));
      col = mix(col, bam, aS);
    }
    // 光裡飄的灰塵
    vec2 dq = p + vec2(t * 7.0, -t * 11.0);
    vec2 did = floor(dq / 60.0);
    vec2 dh = hash22(did + 3.0);
    vec2 dc = (did + 0.2 + 0.6 * dh) * 60.0 + 5.0 * vec2(sin(t * 0.8 + dh.x * 6.0), cos(t * 0.6 + dh.y * 6.0));
    float dr = mix(1.0, 3.0, dh.y);
    col += mix(C_FUR, C_BONE, 0.6) * 0.14 * (1.0 - smoothstep(dr * 0.4, dr, length(dq - dc))) * step(0.75, dh.x) * s;
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, txt: { value: null }, hasTxt: { value: 0 }, txO: { value: new THREE.Vector2() }, txS: { value: new THREE.Vector2(1, 1) },
  ...camUniforms(),
  svC: { value: new THREE.Vector3() }, svR: { value: 400 }, phR: { value: 0 }, phOff: { value: new THREE.Vector2() }, phHalf: { value: new THREE.Vector2() }, phBd: { value: 14 }, lod: { value: 0 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  flap: { value: 0 }, leafOff: { value: new THREE.Vector2() }, sunK: { value: 1 }, t: { value: 0 }, k: { value: 1 },
});

export default class Courtyard extends P9Plate {
  bg = shared('courtyard.bg', BG);
  txt: Layer2D | null = null;
  words: Words | null = null;
  hw = 0; hh = 0; bd = 14; R = 400; cx = 900; ang = 0;
  txX = 0; txY = 0;
  /** 第一個拍點（寫字、往焦點推從這裡開始）。 */
  t0 = 0;

  override async init() {
    await this.loadPhoto();
    const { end } = this.ctx;
    const probe = document.createElement('canvas').getContext('2d')!;
    const pw = photoWords(this.ctx);
    // 粉筆字的框：竹篩右邊的牆（60 字的留言排五行；整塊的最後一行在 HUD 區上面）
    const words = pw.kind !== 'none' || pw.lyrics ? new Words(this.ctx, probe, {
      family: F.hand(700), w: 580, h: 560, min: 40, max: 50, lineHeight: 1.4, maxLines: 5, align: 'left',
      ink: rgba('bone', 0.95), unsung: rgba('bone', 0.35), active: mixRgba('signal', 'bone', 0.35), sigInk: rgba('bone', 0.8), sigSize: 28,
      album: { family: F.hand(700), size: 24, color: rgba('bone', 0.75) },
    }) : null;
    this.words = words?.has ? words : null;
    // 照片放得進竹篩（對角線 ≤ 竹篩直徑的 85%），竹篩不能比畫面高
    const maxD = this.words ? 700 : 800;
    let ph = fitPhoto(this.img, 700, 560);
    const diag = Math.hypot(ph.w, ph.h);
    if (diag > maxD) ph = fitPhoto(this.img, (ph.w * maxD) / diag, (ph.h * maxD) / diag);
    this.hw = ph.w / 2; this.hh = ph.h / 2;
    this.bd = clamp(0.04 * Math.min(ph.w, ph.h), 9, 18);
    this.R = Math.hypot(this.hw + this.bd, this.hh + this.bd) / 0.86 + 6;
    this.ang = (hash(this.seed, 6) - 0.5) * 8 * RAD;
    if (this.words) {
      const words = this.words;
      this.cx = 140 + this.R + 20;
      const tw = words.width;
      this.txX = Math.min(this.cx + this.R + 100, 1760 - tw) - 20;
      // 粉筆字的最後一行在 HUD 區上面
      this.txY = clamp(FLOOR_Y - this.R * 1.1 - words.height / 2, 150, 790 - words.height) - 20;
      this.txt = this.track(new Layer2D(Math.ceil(words.st.w + 40), Math.ceil(words.height + 50), undefined, { fast: true }));
    } else this.cx = 900;
    const t0 = (this.t0 = this.cue(0.5, 1.1));
    this.words?.writeFrom(t0 + 0.3, Math.max(0.6, Math.min(2.4, (end - t0 - 0.3) * 0.5)));
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const u = this.bg.u;
    // 竹篩：上緣碰牆、下緣碰地
    const R = this.R;
    (u.svC!.value as THREE.Vector3).set(this.cx, FLOOR_Y - R * Math.cos(LEAN), R * Math.sin(LEAN));
    u.svR!.value = R;
    u.phR!.value = this.ang;
    (u.phOff!.value as THREE.Vector2).set(0, -6);
    (u.phHalf!.value as THREE.Vector2).set(this.hw, this.hh);
    u.phBd!.value = this.bd;
    // 每個小節線一陣風：照片的一角掀起來、樹蔭晃一下
    const bp = f.barPhase;
    const gust = Math.exp(-bp * 4) * Math.sin(Math.min(1, bp * 6) * Math.PI * 0.5);
    u.flap!.value = 0.15 + 0.6 * gust + 0.05 * Math.sin(t * 2.1);
    (u.leafOff!.value as THREE.Vector2).set(0.04 * Math.sin(t * 0.5) + 0.05 * gust, 0.03 * Math.cos(t * 0.37));
    u.sunK!.value = 0.85 + 0.15 * ease.outCubic(prog(t, s + 0.2, s + 1.2));
    // 焦點：竹篩上的照片往焦點推，鏡頭也往焦點那一點（竹篩斜面上的位置）慢慢移
    const crop = this.focus(t, this.t0, this.hw / this.hh, { zoom: 1.18, screenW: 2 * this.hw });
    (u.crop!.value as THREE.Vector4).set(...crop);
    const [fu, fv] = focusIn(this.photo, crop);
    const px = (fu - 0.5) * 2 * this.hw, py = (fv - 0.5) * 2 * this.hh;
    const qx = px * Math.cos(this.ang) - py * Math.sin(this.ang), qy = -6 + px * Math.sin(this.ang) + py * Math.cos(this.ang);
    const focX = this.cx + qx, focY = FLOOR_Y - R * Math.cos(LEAN) + qy * Math.cos(LEAN);
    const toF = (this.words ? 0.18 : 0.4) * settleK(t - this.t0, 6);
    // 鏡頭：低低地看著地磚 → 往上搖到竹篩；之後很慢地橫移、推近（往焦點靠）
    const tilt = ease.inOutCubic(prog(t, s, s + Math.min(1.6, (e - s) * 0.4)));
    const push = 1 - Math.exp(-lt / 7);
    const side = hash(this.seed, 2) < 0.5 ? -1 : 1;
    const zoom = lerp(1.1, 1.0, tilt) + (this.words ? 0.03 : 0.08) * push;
    const cx0 = 960 + side * 40 * push, cy0 = lerp(840, 590, tilt);
    setCam(u, {
      x: cx0 + (focX - cx0) * toF, y: cy0 + (focY - 590) * toF, z: 0, dist: DIST, zoom,
      pitch: lerp(-13, -5.5, tilt) * RAD, yaw: side * lerp(-5, -2, tilt) * RAD,
    });
    u.lod!.value = this.lod(2 * this.hw * zoom, crop[2] - crop[0]);
    u.t!.value = t;
    u.k!.value = (0.88 + 0.12 * ease.outCubic(prog(t, s, s + 0.5))) * (1 - 0.1 * prog(t, e - 0.3, e));
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
    return { paper: 1, bloom: 0.12, bloomThreshold: 1.15, halation: 0.05, vignette: 0.32 };
  }
}
