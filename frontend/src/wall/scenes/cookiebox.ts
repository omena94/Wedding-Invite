// 照片版面「喜餅禮盒」（P9 台灣味，亮）：從正上方往下拍桌上的一盒喜餅（平拍，像商品照）——
//  - 亞麻桌布上一個喜餅禮盒：紅色（固定色 collar）的盒蓋，燙金雙線框，照片嵌在盒蓋中間的奶油色卡紙窗裡（完整，不裁），
//    香檳色的緞帶斜斜綁過盒蓋右上角、在角上打一個蝴蝶結。
//  - 第一個拍點，盒蓋被拿起來（往上、往左上移開一點，像有人拿著），露出底下盒子裡一格一格的喜餅（紙托裡的圓餅，
//    餅面壓著花紋）。盒蓋在半空中輕輕浮著，影子落在喜餅與桌布上；焦點跟著盒蓋，底下的盒子與桌布微微失焦。
//  - 字是盒蓋上的燙金字（思源宋體）：主字（賓客的祝福＋署名，或新人的註解）一個字一個字燙上去，歌詞小一號燙在下面跟唱；
//    沒有主字時歌詞自己燙在那個位置（_photo.ts 的 PhotoText）。兩個都沒有：盒蓋只有照片（照片放大一點），不留空的字框。
//    相簿的第一張在字的上面多一行小小的相簿名。字在照片下面或右邊：兩種都排排看，照片能放得比較大的那種
//    （橫的照片通常在下面；字多的時候改到右邊，照片才不會被擠得很小）。
//  - 焦點：盒蓋窗裡的照片慢慢往焦點推（1.18 倍），鏡頭也往焦點那邊靠一點。
//  - 鏡頭：切進來時從近一點、斜一點落定，之後很慢地推近、微微轉；每個小節線一道光掃過燙金。
// 畫法：全部在一個 shader：桌布、盒身（上緣、內壁、內襯、喜餅）、盒蓋（側邊、蓋面、照片、燙金、緞帶、蝴蝶結）
// 都用「同一點在不同高度的投影」判斷看到哪一面（正上方的鏡頭有一點透視，盒子的側面看得到一點點），影子照高度差偏移、變軟。
// 燙金字畫在一張 Canvas（fast 上傳），shader 在盒蓋的座標取樣，跟著盒蓋移動、受光。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { F } from '../engine/type';
import { mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { focusIn, photoWords, settleK } from './_photo';
import { P9Plate, P9_GLSL, P9_CAM_GLSL, Words, camUniforms, fitPhoto, setCam } from './_p9';

export const spec: PlateSpecDecl = { photo: true, paper: true, family: 'photo', series: 'local', prefers: ['landscape', 'square'], energy: [0, 1], bars: [2, 8], weight: 1 };

/** 鏡頭到桌面的距離（px）：越小透視越強。 */
const DIST = 2600;
/** 盒蓋拿起來之後的高度、往哪裡移（世界座標，相對盒身）。 */
const LID_Z0 = 80, LID_Z1 = 205;
const LID_OFF: [number, number] = [-150, -110];

const BG = () => new FSPass(/* glsl */ `
  ${P9_GLSL}
  uniform sampler2D photo; uniform sampler2D txt; uniform float hasTxt;
  ${P9_CAM_GLSL}
  uniform vec2 winOff;
  uniform vec2 baseHalf; uniform float baseR;
  uniform vec2 lidC; uniform float lidR; uniform vec2 lidHalf; uniform float lidZ;
  uniform vec2 phC; uniform vec2 phHalf; uniform float lod; uniform vec4 crop;
  uniform vec2 txO; uniform vec2 txS;
  uniform float sweep; uniform float k; uniform float focusZ; uniform vec2 ck0; uniform vec2 ckN; uniform float ckCell;

  const float BASE_H = 70.0;   // 盒身高
  const float FLOOR_Z = 16.0;  // 盒子裡的內襯
  const float WALL = 12.0;     // 盒壁厚
  const float LID_T = 30.0;    // 盒蓋的邊高
  const float CK_Z = 40.0;     // 喜餅的上緣
  const float CK_R = 62.0;     // 喜餅半徑
  const vec2 SH = vec2(0.3, 0.42);
  const float RIB_U = 58.0;      // 緞帶斜過右上角：離角（沿兩邊加起來）多遠 // 光從左上來：每高 1 px，影子往右下偏多少

  // 畫面上的點 p 在高度 z 的水平面上對應到哪裡（世界座標；盒身在原點）
  vec2 world(vec2 p, float z) { return onZ(p, z); }
  // 窗光：左上方的窗戶照進來一大塊斜斜的光，中間窗框的十字影子很軟；高的東西上的光從同一個方向來
  float winLight(vec2 w, float z) {
    vec2 q = rot2(0.32) * (w + SH * z - winOff);
    float inWin = 1.0 - smoothstep(-80.0, 140.0, sdBox(q, vec2(1050.0, 760.0)));
    float bar = 1.0 - smoothstep(10.0, 46.0, min(abs(q.x), abs(q.y + 40.0)));
    return mix(0.8, 1.05, inWin * (1.0 - 0.55 * bar));
  }
  vec2 baseL(vec2 w) { return rot2(-baseR) * w; }
  vec2 lidL(vec2 w) { return rot2(-lidR) * (w - lidC); }
  // 景深：對焦在盒蓋，離得越遠邊緣越軟
  float blurAt(float z) { return 0.7 + abs(z - focusZ) * 0.03; }
  vec3 goldC(float sh) { return mix(C_FUR, C_BONE, 0.45) * (0.6 + 0.6 * sh); }
  // 燙金的反光：一道斜的光，每個小節線掃過去
  float sheenAt(vec2 w) { float u = dot(w, normalize(vec2(1.0, 0.55))) - sweep; return 0.3 + 0.7 * exp(-u * u / 9000.0); }

  // 盒蓋在高度 zr 的面上投下的影子
  float lidShadow(vec2 p, float zr) {
    float dz = lidZ - zr;
    if (dz <= 0.0) return 0.0;
    vec2 q = lidL(world(p, zr) - SH * dz);
    return 0.55 * boxShade(sdBox(q, lidHalf), 3.0 + dz * 0.1) * smoothstep(0.0, 30.0, dz);
  }

  vec3 table(vec2 p) {
    vec2 w = world(p, 0.0);
    // 亞麻桌布：經緯的粗細不勻、很淡的斑駁；窗光從左上來
    float slub = 0.5 * snoise(vec2(w.x / 5.0, w.y / 150.0)) + 0.5 * snoise(vec2(w.x / 150.0, w.y / 5.0));
    float n = snoise(w / 400.0);
    vec3 col = mix(mix(C_PAPER, C_BONE, 0.25), C_FUR, 0.06) * (0.93 + 0.016 * slub + 0.02 * n);
    float wl = winLight(w, 0.0);
    col *= wl * mix(vec3(0.96, 0.97, 1.0), vec3(1.02, 1.0, 0.95), smoothstep(0.85, 1.0, wl));
    // 盒身的影子與貼地的暗
    vec2 qs = baseL(w - SH * BASE_H);
    col *= 1.0 - 0.38 * boxShade(sdBox(qs, baseHalf), 14.0);
    col *= 1.0 - 0.22 * boxShade(sdBox(baseL(w), baseHalf), 5.0);
    col *= 1.0 - lidShadow(p, 0.0);
    return col;
  }

  // 盒子裡的一個喜餅格：回傳顏色與覆蓋（沒有喜餅的地方是內襯）
  vec3 cavity(vec2 p) {
    vec2 qf = baseL(world(p, FLOOR_Z));
    vec2 inH = baseHalf - WALL;
    // 內襯（米色紙），四周內壁的影子（光從左上，右下的牆擋不到光，左上的牆投影子在底上）
    vec3 col = mix(C_BONE, C_FUR, 0.12) * 0.86 * (0.95 + 0.03 * paperTex(qf));
    vec2 sl = rot2(-baseR) * SH;
    col *= 1.0 - 0.35 * smoothstep(-8.0, 6.0, sdBox(qf - sl * (BASE_H - FLOOR_Z), inH));
    // 喜餅：一格一個，在紙托裡
    vec2 qc = baseL(world(p, CK_Z));
    vec2 id = clamp(floor((qc - ck0) / ckCell), vec2(0.0), ckN - 1.0);
    vec2 cc = ck0 + (id + 0.5) * ckCell;
    vec2 idf = clamp(floor((qf - ck0) / ckCell), vec2(0.0), ckN - 1.0);
    vec2 cf = ck0 + (idf + 0.5) * ckCell;
    float bw = blurAt(CK_Z);
    // 紙托（波浪邊）
    vec2 df = qf - cf;
    float ang = atan(df.y, df.x);
    float cup = length(df) - (CK_R + 10.0 + 2.2 * sin(ang * 26.0));
    vec3 paperCup = mix(C_BONE, C_FUR, 0.2) * 0.9 * (0.86 + 0.14 * (0.5 + 0.5 * sin(ang * 26.0)));
    col = mix(col, paperCup, fillAA(cup, bw));
    // 側邊（烤得深一點）
    float side = length(qf - cf) - CK_R;
    vec3 sideC = C_FUR * 0.5;
    col = mix(col, sideC, fillAA(side, bw));
    // 餅面：中間淺、邊緣烤得深，壓著一圈花紋與八瓣花
    vec2 d = qc - cc;
    float r = length(d);
    float top = r - CK_R + 2.0;
    float rr = r / CK_R;
    vec3 crust = mix(mix(C_FUR, C_BONE, 0.3) * 0.95, C_FUR * 0.62, smoothstep(0.55, 1.0, rr));
    float a2 = atan(d.y, d.x);
    float ring = 1.0 - smoothstep(0.0, 2.2 + bw, abs(r - CK_R * 0.66));
    float petal = (1.0 - smoothstep(0.0, 2.0 + bw, abs(r - CK_R * 0.36 * (0.75 + 0.25 * cos(a2 * 8.0))))) * step(r, CK_R * 0.5);
    crust *= 1.0 - 0.22 * max(ring, petal);
    // 蛋液的光澤：左上一塊
    crust += C_BONE * 0.08 * exp(-dot(d + vec2(20.0, 22.0), d + vec2(20.0, 22.0)) / 900.0);
    col = mix(col, crust, fillAA(top, bw));
    col *= winLight(world(p, CK_Z), CK_Z) * (1.0 - lidShadow(p, CK_Z));
    return col;
  }

  // 盒身：上緣（紙板的切邊）、外側、裡面
  vec4 baseBox(vec2 p) {
    vec2 qt = baseL(world(p, BASE_H));
    vec2 q0 = baseL(world(p, 0.0));
    float bw = blurAt(BASE_H);
    float dt = sdBox(qt, baseHalf), d0 = sdBox(q0, baseHalf);
    float aT = fillAA(dt, bw), aS = fillAA(d0, bw);
    float a = max(aT, aS);
    if (a <= 0.0) return vec4(0.0);
    vec3 sideC = C_COLLAR * 0.42 * (0.9 + 0.1 * snoise(q0 / 60.0)) * winLight(world(p, BASE_H * 0.5), BASE_H * 0.5);
    vec3 col = sideC;
    if (aT > 0.0) {
      float din = sdBox(qt, baseHalf - WALL);
      vec3 rim = mix(C_COLLAR, C_BONE, 0.08) * 0.9;
      // 盒緣一圈細細的燙金
      rim = mix(rim, goldC(sheenAt(qt)), 1.0 - smoothstep(0.6, 1.8, abs(dt + 4.0)));
      // 內壁：開口裡、內襯外面那一圈（比較暗的紅）
      vec2 qf = baseL(world(p, FLOOR_Z));
      float dfl = sdBox(qf, baseHalf - WALL);
      vec3 wallC = C_COLLAR * 0.3;
      vec3 hole = din < 4.0 ? mix(wallC, cavity(p), fillAA(dfl, bw)) : wallC;
      vec3 top = mix(rim, hole, fillAA(din, bw));
      top *= winLight(world(p, BASE_H), BASE_H) * (1.0 - lidShadow(p, BASE_H));
      col = mix(col, top, aT);
    }
    return vec4(col, a);
  }

  vec3 lidTop(vec2 q, vec2 p) {
    vec2 w = rot2(lidR) * q + lidC;
    float sh = sheenAt(w);
    // 紅色的蓋面：紙的紋理，左上亮一點
    float wl = winLight(w, lidZ);
    vec3 col = C_COLLAR * (0.84 + 0.05 * paperTex(q * 1.3)) * (1.0 - 0.06 * dot(q / (lidHalf + 1.0), vec2(0.5, 0.5))) * wl;
    float bw = blurAt(lidZ) + 0.3;
    // 燙金雙線框＋四角的小圓
    float f1 = abs(sdBox(q, lidHalf - 22.0)) - 1.3;
    float f2 = abs(sdBox(q, lidHalf - 30.0)) - 0.6;
    vec2 cq = abs(q) - (lidHalf - 30.0);
    float corner = abs(length(cq) - 11.0) - 0.8;
    float foil = max(max(fillAA(f1, bw), fillAA(f2, bw)), fillAA(corner, bw) * step(0.0, -max(cq.x, cq.y) + 11.0));
    col = mix(col, goldC(sh), foil);
    // 照片的窗：奶油色卡紙（往下壓一點的陰影）、照片、細金線
    vec2 pq = q - phC;
    float dm = sdBox(pq, phHalf + 16.0);
    float am = fillAA(dm, bw);
    if (am > 0.0) {
      vec3 mat = mix(C_BONE, C_FUR, 0.08) * 0.86 * (0.97 + 0.03 * paperTex(q)) * wl;
      mat *= 1.0 - 0.22 * (1.0 - smoothstep(0.0, 7.0, -dm)) * smoothstep(-0.2, 0.6, dot(normalize(pq + 1e-3), vec2(-0.6, -0.8)));
      float dp = sdBox(pq, phHalf);
      vec2 uv = cropUV((pq + phHalf) / (2.0 * phHalf), crop);
      vec3 ph = photoLin(photo, uv, lod) * mix(1.0, wl, 0.6);
      mat = mix(mat, ph, fillAA(dp, bw));
      col = mix(col, mat, am);
      col = mix(col, goldC(sh), fillAA(abs(dm) - 1.1, bw));
    }
    // 燙金字（主字＋歌詞）：凹下去一點（字的左上緣暗一點），跟著光
    if (hasTxt > 0.5) {
      vec2 uv = (q - txO) / txS;
      vec4 tx = layerAt(txt, uv);
      vec4 tx2 = layerAt(txt, uv - vec2(1.4) / txS);
      col *= 1.0 - 0.35 * tx2.a * (1.0 - tx.a);
      col = col * (1.0 - tx.a) + tx.rgb * (0.78 + 0.5 * sh);
    }
    // 緞帶：斜斜綁過右上角（香檳色緞面，中間亮、兩邊暗，跟著光）
    float u = (lidHalf.x - q.x) + (q.y + lidHalf.y);
    float rb = abs(u - RIB_U) / 31.0;
    if (rb < 1.2) {
      float shade = 0.72 + 0.3 * cos(rb * 1.5) + 0.25 * exp(-pow((dot(w, vec2(0.7, -0.7)) - sweep * 0.6) / 70.0, 2.0));
      vec3 rib = mix(C_BONE, C_FUR, 0.3) * 0.82 * shade;
      // 緞帶在蓋面上的影子
      col *= 1.0 - 0.25 * (1.0 - smoothstep(0.9, 1.25, abs(u - RIB_U - 4.0) / 31.0));
      col = mix(col, rib, 1.0 - smoothstep(0.96, 1.0 + 0.04 * bw, rb));
    }
    return col;
  }

  // 蝴蝶結（比蓋面高一點）：結在緞帶上，兩個圈往緞帶的兩側張開，兩條尾巴順著緞帶垂下；回傳顏色與覆蓋
  vec4 bow(vec2 p) {
    vec2 q = lidL(world(p, lidZ + 12.0));
    vec2 bc = vec2(lidHalf.x - RIB_U * 0.5, -lidHalf.y + RIB_U * 0.5);
    vec2 ax = normalize(vec2(1.0, 1.0)), nx = normalize(vec2(1.0, -1.0));
    // b.x：橫過緞帶（往角的外面是正）、b.y：順著緞帶
    vec2 b = vec2(dot(q - bc, nx), dot(q - bc, ax));
    float bw = blurAt(lidZ + 12.0) + 0.4;
    vec3 base = mix(C_BONE, C_FUR, 0.3) * 0.82;
    float a = 0.0; vec3 col = base;
    // 尾巴：從結往兩頭順著緞帶垂下，尾端剪成 V
    for (int i = 0; i < 2; i++) {
      float sy = i == 0 ? -1.0 : 1.0;
      vec2 t0 = vec2(0.0, sy * 4.0), t1 = vec2(sy * 10.0 - 6.0, sy * 52.0);
      vec2 tdir = normalize(t1 - t0);
      float along = dot(b - t0, tdir), across = dot(b - t0, vec2(-tdir.y, tdir.x));
      float ds = max(sdSegment(b, t0, t1) - 9.0, along - (length(t1 - t0) - 7.0 * (1.0 - abs(across) / 9.0)));
      float at = fillAA(ds, bw);
      vec3 tc = base * (0.66 + 0.26 * smoothstep(-9.0, 9.0, across * sy));
      col = mix(col, tc, at * (1.0 - a)); a = max(a, at);
    }
    // 兩個圈（緞帶捲起來：中間的洞看得到底下）
    for (int i = 0; i < 2; i++) {
      float sx = i == 0 ? -1.0 : 1.0;
      vec2 lc = vec2(sx * 26.0, -3.0);
      vec2 e = (b - lc) / vec2(27.0, 16.0);
      float outer = (length(e) - 1.0) * 16.0;
      vec2 e2 = (b - lc - vec2(sx * 3.0, 1.5)) / vec2(15.0, 5.5);
      float hole = (length(e2) - 1.0) * 5.5;
      float al = fillAA(max(outer, -hole), bw);
      float lit = 0.66 + 0.4 * smoothstep(1.0, 0.1, length(e - vec2(-0.3 * sx, -0.4)));
      col = mix(col, base * lit, al); a = max(a, al);
    }
    // 結
    float dk = (length(b / vec2(10.0, 12.0)) - 1.0) * 10.0;
    float ak = fillAA(dk, bw);
    col = mix(col, base * (0.74 + 0.2 * smoothstep(10.0, -8.0, b.x + b.y)), ak); a = max(a, ak);
    return vec4(col, a);
  }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 col = table(p);
    vec4 bb = baseBox(p);
    col = mix(col, bb.rgb, bb.a);
    // 盒蓋：側邊（低的那圈）＋蓋面
    vec2 lt = lidL(world(p, lidZ));
    vec2 lb = lidL(world(p, lidZ - LID_T));
    float lw = blurAt(lidZ);
    float dlt = sdBox(lt, lidHalf), dlb = sdBox(lb, lidHalf);
    float aLB = fillAA(dlb, lw), aLT = fillAA(dlt, lw);
    if (aLB > 0.0) {
      vec3 side = C_COLLAR * 0.45 * (0.85 + 0.15 * smoothstep(-lidHalf.y, lidHalf.y, lb.y));
      // 緞帶繞過側邊
      float u = (lidHalf.x - lb.x) + (lb.y + lidHalf.y);
      side = mix(side, mix(C_BONE, C_FUR, 0.3) * 0.55, 1.0 - smoothstep(29.0, 32.0, abs(u - RIB_U)));
      col = mix(col, side, aLB * (1.0 - aLT));
    }
    // 蝴蝶結在蓋面上的影子
    vec4 bs = bow(p + vec2(-6.0, -9.0));
    if (aLT > 0.0) col = mix(col, lidTop(lt, p) * (1.0 - 0.22 * bs.a), aLT);
    vec4 bo = bow(p);
    col = mix(col, bo.rgb, bo.a);
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, txt: { value: null }, hasTxt: { value: 0 },
  ...camUniforms(), winOff: { value: new THREE.Vector2() },
  baseHalf: { value: new THREE.Vector2() }, baseR: { value: 0 },
  lidC: { value: new THREE.Vector2() }, lidR: { value: 0 }, lidHalf: { value: new THREE.Vector2() }, lidZ: { value: 80 },
  phC: { value: new THREE.Vector2() }, phHalf: { value: new THREE.Vector2() }, lod: { value: 0 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  txO: { value: new THREE.Vector2() }, txS: { value: new THREE.Vector2(1, 1) },
  sweep: { value: -2000 }, k: { value: 1 }, focusZ: { value: 80 },
  ck0: { value: new THREE.Vector2() }, ckN: { value: new THREE.Vector2(1, 1) }, ckCell: { value: 160 },
});

/** 盒蓋拿起來之後在畫面上大約放大幾倍（透視＋推近）：燙金字照這個倍數縮，畫面上才是 40～52 px。 */
const LIFT_SCALE = (DIST / (DIST - (LID_Z1 - 80) * 0.95)) * 1.03;
const M = 54, MAT = 16, GAP = 40;

export default class CookieBox extends P9Plate {
  bg = shared('cookiebox.bg', BG);
  txt: Layer2D | null = null;
  words: Words | null = null;
  /** 字在照片下面（橫的照片）或右邊（直的照片）。 */
  below = true;
  lidW = 0; lidH = 0;
  phW = 0; phH = 0;
  phCx = 0; phCy = 0;
  txX = 0; txY = 0; txW = 0; txH = 0;
  tilt = 0;

  override async init() {
    await this.loadPhoto();
    const { end } = this.ctx;
    const img = this.img;
    const probe = document.createElement('canvas').getContext('2d')!;
    const pw = photoWords(this.ctx);
    if (pw.kind === 'none' && !pw.lyrics) this.fitLid(null, true);
    else {
      // 字在照片下面或右邊：兩種都排排看，照片放得比較大的那種（橫的照片偏好下面、直的偏好右邊）
      const land = img.w / img.h >= 1.15;
      const wb = this.makeWords(probe, true), wr = this.makeWords(probe, false);
      const ab = this.fitLid(wb, true), ar = this.fitLid(wr, false);
      const below = land ? ab >= ar * 0.8 : ab > ar * 1.25;
      if (below) this.fitLid(wb, true);
      const words = this.words!;
      this.txt = this.track(new Layer2D(Math.ceil(this.txW + 40), Math.ceil(this.txH + 40), undefined, { fast: true }));
      const tLift = this.cue(0.25, 0.9);
      words.writeFrom(tLift + 0.7, Math.max(0.6, Math.min(2.2, (end - tLift - 0.7) * 0.5)));
    }
    this.tilt = (hash(this.seed, 3) - 0.5) * 2;
  }

  /** 燙金字（盒蓋的座標，畫面上會放大 LIFT_SCALE 倍：字級先除回去，畫面上才是主字 40～50、歌詞約 40 px）。 */
  private makeWords(probe: CanvasRenderingContext2D, below: boolean) {
    const S = LIFT_SCALE;
    return new Words(this.ctx, probe, {
      family: F.ming(700), w: below ? 720 : 430, h: below ? 360 : 620, min: Math.ceil(40 / S), max: Math.floor(50 / S),
      lineHeight: 1.42, maxLines: below ? 4 : 6, align: below ? 'center' : 'left', tracking: 2,
      ink: mixRgba('fur', 'bone', 0.5), unsung: mixRgba('fur', 'bone', 0.5, 0.32), sigInk: mixRgba('fur', 'bone', 0.5, 0.85),
      sigSize: Math.round(28 / S), lyricSize: Math.round(46 / S), lyricSubSize: Math.round(40 / S),
      album: { family: F.ming(700), size: Math.round(22 / S), color: mixRgba('fur', 'bone', 0.5, 0.8) },
    });
  }

  /** 照片的框：盒蓋整個（含字）放大之後要在畫面裡（高 ≤ 820、寬 ≤ 1240）。回傳照片的面積（選版面用）。 */
  private fitLid(words: Words | null, below: boolean) {
    this.words = words; this.below = below;
    let bw = words ? (below ? 680 : 480) : 820, bh = words ? (below ? 430 : 620) : 600;
    for (let i = 0; i < 10; i++) {
      const ph = fitPhoto(this.img, bw, bh);
      this.phW = ph.w; this.phH = ph.h;
      this.layout();
      if (this.lidH * LIFT_SCALE <= 820 && this.lidW * LIFT_SCALE <= 1240) break;
      bw *= 0.93; bh *= 0.93;
    }
    return this.phW * this.phH;
  }

  /** 盒蓋的大小、照片與字在蓋面上的位置（盒蓋中心是原點）。 */
  private layout() {
    const words = this.words;
    const pw = this.phW + 2 * MAT, phh = this.phH + 2 * MAT;
    if (!words) {
      this.lidW = pw + 2 * M; this.lidH = phh + 2 * M;
      this.phCx = 0; this.phCy = 0;
      return;
    }
    if (this.below) {
      this.txW = words.st.w; this.txH = words.height;
      this.lidW = Math.max(pw, this.txW) + 2 * M;
      this.lidH = M + phh + GAP + this.txH + M * 0.8;
      this.phCx = 0; this.phCy = -this.lidH / 2 + M + phh / 2;
      this.txX = -this.txW / 2; this.txY = this.phCy + phh / 2 + GAP;
    } else {
      // 短的註解不用留整欄的寬（盒蓋右邊不要空一大塊紅）
      // 右邊多留一點：右上角有緞帶與蝴蝶結，字不要擠到它底下
      this.txW = Math.max(240, words.width + 10); this.txH = words.height;
      this.lidW = M + pw + GAP + this.txW + M + 30;
      this.lidH = Math.max(phh, this.txH) + 2 * M;
      this.phCx = -this.lidW / 2 + M + pw / 2; this.phCy = 0;
      this.txX = this.phCx + pw / 2 + GAP; this.txY = -this.txH / 2 + 8;
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const tLift = this.cue(0.25, 0.9);
    const lift = prog(t, tLift, tLift + 0.95, ease.outCubic);
    const liftB = prog(t, tLift, tLift + 1.1, (x) => ease.outBack(x, 1.1));
    const u = this.bg.u;
    // 盒蓋：蓋著 → 拿起來（往上、往左上移開、轉一點點），之後在半空中輕輕浮著
    const bob = 2.5 * Math.sin(((t - tLift) / 2.6) * Math.PI * 2) * lift;
    const lidZ = lerp(LID_Z0, LID_Z1, liftB) + bob;
    const lx = LID_OFF[0] * liftB, ly = LID_OFF[1] * liftB;
    (u.lidC!.value as THREE.Vector2).set(lx, ly);
    u.lidR!.value = (this.tilt * 1.2 - 2.4 * lift) * (Math.PI / 180);
    u.lidZ!.value = lidZ;
    (u.lidHalf!.value as THREE.Vector2).set(this.lidW / 2, this.lidH / 2);
    (u.baseHalf!.value as THREE.Vector2).set(this.lidW / 2 - 7, this.lidH / 2 - 7);
    u.baseR!.value = this.tilt * 1.2 * (Math.PI / 180);
    // 喜餅格：盒子裡排滿（格子大小固定，置中）
    const inW = this.lidW - 14 - 24, inH = this.lidH - 14 - 24, cell = 158;
    const nx = Math.max(1, Math.floor(inW / cell)), ny = Math.max(1, Math.floor(inH / cell));
    (u.ck0!.value as THREE.Vector2).set(-nx * cell / 2, -ny * cell / 2);
    (u.ckN!.value as THREE.Vector2).set(nx, ny);
    u.ckCell!.value = cell;
    (u.phC!.value as THREE.Vector2).set(this.phCx, this.phCy);
    (u.phHalf!.value as THREE.Vector2).set(this.phW / 2, this.phH / 2);
    // 焦點：盒蓋拿起來之後，窗裡的照片往焦點推；鏡頭也往焦點那一點靠一點（字一直在畫面裡）
    const crop = this.focus(t, tLift + 0.3, this.phW / this.phH, { zoom: 1.18, screenW: this.phW * LIFT_SCALE });
    (u.crop!.value as THREE.Vector4).set(...crop);
    const [fu, fv] = focusIn(this.photo, crop);
    const lr = u.lidR!.value as number;
    const qx = this.phCx + (fu - 0.5) * this.phW, qy = this.phCy + (fv - 0.5) * this.phH;
    const focX = lx + qx * Math.cos(lr) - qy * Math.sin(lr), focY = ly + qx * Math.sin(lr) + qy * Math.cos(lr);
    // 鏡頭：從南邊斜斜往下看（看得到盒子朝觀眾那一面）。切進來時近一點、斜一點，很快落定；之後很慢地推近、微微轉。
    // 看的中心從盒身移到盒蓋那一組，再往焦點靠
    const settle = ease.outExpo(clamp(lt / 1.2));
    const push = 1 - Math.exp(-lt / 7);
    const toF = (this.words ? 0.16 : 0.3) * settleK(t - tLift, 6);
    const zoom = lerp(1.07, 1.0, settle) + (this.words ? 0.03 : 0.06) * push;
    const cx0 = lx * 0.72 - 6 * push, cy0 = ly * 0.72 + 30 + 4 * push;
    const proj = setCam(u, {
      x: cx0 + (focX - cx0) * toF, y: cy0 + (focY - cy0) * toF, z: 80, dist: DIST, zoom,
      pitch: lerp(24, 18, settle) * (Math.PI / 180),
      roll: (lerp(2.6, 0.4, settle) * (this.tilt >= 0 ? 1 : -1) + 0.5 * Math.sin(lt * 0.21)) * (Math.PI / 180),
    });
    const a0 = proj(lx - this.phW / 2, ly, lidZ), a1 = proj(lx + this.phW / 2, ly, lidZ);
    u.lod!.value = this.lod(Math.hypot(a1[0] - a0[0], a1[1] - a0[1]), crop[2] - crop[0]);
    (u.winOff!.value as THREE.Vector2).set(-260 + 14 * lt, -200 + 6 * lt);
    u.focusZ!.value = lerp(LID_Z0, lidZ, lift);
    // 每個小節線一道光掃過燙金
    u.sweep!.value = lerp(-1500, 1500, ease.inOutCubic(clamp(f.barPhase / 0.75)));
    u.k!.value = (0.86 + 0.14 * ease.outCubic(prog(t, s, s + 0.45))) * (1 - 0.1 * prog(t, e - 0.3, e));
    u.photo!.value = this.tex;
    u.hasTxt!.value = this.words ? 1 : 0;
    // shader 是共用的：沒有字的窗格也要換掉上一個窗格（已經釋放）的字圖層
    u.txt!.value = this.tex;
    if (this.words && this.txt) {
      const L = this.txt;
      if (this.words.draw(L.ctx, t, 20, 20, () => L.clear())) L.upload();
      u.txt!.value = L.texture;
      (u.txO!.value as THREE.Vector2).set(this.txX - 20, this.txY - 20);
      (u.txS!.value as THREE.Vector2).set(L.w, L.h);
    }
    this.bg.render(renderer, out);
    return { paper: 1, bloom: 0.12, bloomThreshold: 1.15, halation: 0.04, vignette: 0.3 };
  }
}
