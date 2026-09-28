// 販賣機（暗）：深夜巷口，一台亮著的販賣機，後面是拉下來的鐵捲門，地上是濕的柏油路（映著販賣機的光）。
//  - 鏡頭很低，貼著地面。販賣機在左邊，一格格商品被裡面的燈照亮；商品下面的按鈕跟著拍子一顆一顆亮。
//  - 第一個小節線：訊號色那一罐的按鈕被按下（亮起來），「咚」一聲掉進取物口（機器震一下、取物口的蓋子閃一下），
//    罐子從取物口滾出來、下一拍在地上彈一下，一路滾到鏡頭前面停住、晃兩下——罐身上印著主打留言（最大的字），
//    罐子的標籤照鏡頭的角度預先拉過，停下來時一行一行都是正的。
//  - 歌詞在販賣機的價格條上（整排價格標籤變成一條長長的液晶條，逐字跟唱，比留言小一級）。
//  - 沒有留言：罐子上印的是正在唱的歌詞（逐字跟唱，焦點），價格條放邀請；純音樂又沒有留言：罐子上是邀請。
// 手法：three.js 真的 3D（販賣機的機身、罐子是網格，自己寫的 shader 打光：路燈的主光、販賣機的背光在罐子邊緣勾出一圈亮邊），
// 販賣機正面、價格條、罐子標籤是三張 Canvas 圖層（不會變的畫一次）；地面與鐵捲門是 shader（濕地的倒影、罐子的影子）。4x MSAA。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H, sharedMSAA } from '../engine/gl';
import { GLSL_COMMON, THEME_UNIFORMS } from '../engine/glsl/common';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, lerp, pulse, mulberry32 } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import type { Line } from '../engine/lyrics';
import { fillWithHearts, beatAfter } from './_motifs';
import { grid, layoutRows, drawRows, paperInk, darkInk, fitMsg } from './_t4';
import { INVITE } from './_t14';
import { shownLyric, sigOf, type Rect } from './_t24';

export const spec: PlateSpecDecl = { group: 'type', family: 'local', paper: false, energy: [0.25, 0.9], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 尺寸（世界單位，地面 y = 0）
/** 販賣機：正面寬 MW、高 MH、深 MD；正面的左下角在 M0，往右轉 MYAW（正面稍微朝向右前方，看得到一點右側板）。 */
const MW = 640, MH = 1300, MD = 520;
const MYAW = 0.1;
const M0 = new THREE.Vector3(-915, 0, -318);
/** 價格條（歌詞）與取物口在販賣機正面上的位置（正面座標：左上原點、y 向下）。 */
const STRIP = { x: 40, y: 866, w: 560, h: 190 };
const TRAY = { x: 70, y: 1110, w: 360, h: 120 };
/** 罐子：半徑、長度；標籤只包中間那一段。 */
const CR = 190, CL = 760, LAB = 660;
const CIRC = 2 * Math.PI * CR;
/** 罐子最後停的地方（軸是世界的 x，標籤正中間朝鏡頭）。 */
const REST = new THREE.Vector3(236, CR, 300);
const FOV = 34;
/** 罐子在空中翻的軸（斜的，翻起來比較自然）。 */
const TUMBLE = new THREE.Vector3(0.35, 0.5, 0.8).normalize();
/** 鏡頭：開場看著整台販賣機（PA），罐子飛出來時搖到貼地的近景（PB，罐子在右邊、販賣機在左後方）。 */
const PA = { pos: [-250, 650, 1740], look: [-600, 610, -350] } as const;
const PB = { pos: [60, 225, 1650], look: [40, 232, 0] } as const;

const FAM_MSG = F.hand(700), FAM_SIG = F.hand(400);
const FAM_LYR = F.archivo(100, 800);
const HEADER = '祝福販賣機';
const PRE = 'precision highp float;\nprecision highp int;\n';

// ---------------------------------------------------------------- shader
const VERT = /* glsl */ `${PRE}
in vec3 position; in vec3 normal; in vec2 uv;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
out vec3 vW; out vec3 vN; out vec2 vUv; out vec3 vO;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vUv = uv; vO = position;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** 光：路燈（右上前方、偏暖的白）當主光，販賣機正面是一大片暖光（從左後方來）。 */
const LIGHT = /* glsl */ `
uniform vec3 camPos; uniform vec3 machC; uniform vec3 machN; uniform float glow;
const vec3 KEY = normalize(vec3(0.55, 0.75, 0.62));
vec3 machGlowCol() { return mix(C_BONE, C_SIGNAL, 0.35); }
// 販賣機正面的光打到 P（面朝它、離它近的地方亮）
float machLight(vec3 P, vec3 N) {
  vec3 d = machC - P; float r = length(d);
  float facing = max(dot(-normalize(d), machN), 0.0);
  return glow * max(dot(N, d / r), 0.0) * facing * 520000.0 / (r * r + 250000.0);
}`;

const CAN_FRAG = /* glsl */ `${PRE}
in vec3 vW; in vec3 vN; in vec2 vUv; in vec3 vO;
out vec4 fragColor;
${GLSL_COMMON}
${LIGHT}
uniform sampler2D lab;
void main() {
  vec3 N = normalize(vN), V = normalize(camPos - vW);
  // 本體座標：軸是 x；角度 0 朝 +z（標籤的正中間）
  float ax = vO.x;
  float ang = atan(vO.y, vO.z);
  vec3 base; float spec = 0.0; float rough = 30.0;
  float onLab = step(abs(ax), ${(LAB / 2).toFixed(1)});
  if (abs(vO.x) > ${(CL / 2 - 0.5).toFixed(1)}) {
    // 罐頭的兩端（拉環那一面、底）：鋁，有一圈一圈的壓紋
    float rr = length(vO.yz) / ${CR.toFixed(1)};
    base = mix(C_ASH, C_BONE, 0.35) * (0.55 + 0.25 * sin(rr * 40.0) * step(rr, 0.85) + 0.2 * smoothstep(0.85, 0.95, rr));
    spec = 0.9; rough = 20.0;
  } else if (onLab > 0.5) {
    vec2 uv = vec2((ax + ${(LAB / 2).toFixed(1)}) / ${LAB.toFixed(1)}, 0.5 - ang / ${(2 * Math.PI).toFixed(5)});
    base = fastLayer(texture(lab, vec2(uv.x, 1.0 - uv.y))).rgb;
    spec = 0.35; rough = 42.0;
  } else {
    // 標籤外面到罐肩：鋁，靠近兩端有收口的一圈暗線
    float k = (abs(ax) - ${(LAB / 2).toFixed(1)}) / ${(CL / 2 - LAB / 2).toFixed(1)};
    base = mix(C_ASH, C_BONE, 0.3) * (0.75 - 0.35 * smoothstep(0.55, 0.8, k) + 0.25 * smoothstep(0.8, 1.0, k));
    spec = 1.0; rough = 26.0;
  }
  vec3 R = reflect(-KEY, N);
  float dif = max(dot(N, KEY), 0.0);
  // 下半圈靠近地面，被地板遮掉一些光（圓柱才看得出圓）
  float ao = 0.5 + 0.5 * smoothstep(-0.85, 0.35, N.y);
  vec3 col = base * (0.14 + 0.72 * dif) * ao;
  col += machGlowCol() * base * machLight(vW, N) * 0.7;
  col += mix(C_BONE, C_EMBER, 0.3) * spec * pow(max(dot(R, V), 0.0), rough) * 0.7;
  // 販賣機在後面：罐子的邊緣勾出一圈暖暖的亮邊
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += machGlowCol() * rim * 0.35 * glow * max(dot(N, normalize(machC - vW)) + 0.3, 0.0);
  fragColor = vec4(col, 1.0);
}`;

/** 販賣機：kind 0 = 機身（深色烤漆）、1 = 正面（貼圖＋自發光）、2 = 價格條（貼圖＋自發光）。 */
const MACH_FRAG = /* glsl */ `${PRE}
in vec3 vW; in vec3 vN; in vec2 vUv; in vec3 vO;
out vec4 fragColor;
${GLSL_COMMON}
${LIGHT}
uniform float kind; uniform sampler2D tex;
uniform float btn[12]; uniform float thunk; uniform vec4 btnGeo; // 按鈕列：第一顆的 x、y、間距 x、間距 y（正面 px）
void main() {
  vec3 N = normalize(vN);
  if (kind < 0.5) {
    vec3 base = mix(C_INK2, C_GRAPHITE, 0.35);
    float dif = max(dot(N, KEY), 0.0);
    vec3 col = base * (0.22 + 0.5 * dif) + base * 0.4 * max(N.y, 0.0);
    fragColor = vec4(col, 1.0);
    return;
  }
  vec4 L = fastLayer(texture(tex, vUv));
  vec3 col = L.rgb * glow;
  if (kind < 1.5) {
    vec2 px = vec2(vUv.x * ${MW.toFixed(1)}, (1.0 - vUv.y) * ${MH.toFixed(1)});
    // 按鈕：拍點亮起來的那一顆（訊號色，會發光）
    for (int i = 0; i < 12; i++) {
      vec2 c = btnGeo.xy + vec2(float(i - (i / 4) * 4) * btnGeo.z, float(i / 4) * btnGeo.w);
      float d = length(px - c);
      col += C_SIGNAL * btn[i] * (1.8 * (1.0 - smoothstep(9.0, 11.0, d)) + 0.25 * exp(-d * d / 400.0));
    }
    // 取物口的蓋子：罐子掉下來那一下閃一下
    vec2 tq = abs(px - vec2(${(TRAY.x + TRAY.w / 2).toFixed(1)}, ${(TRAY.y + TRAY.h / 2).toFixed(1)})) - vec2(${(TRAY.w / 2).toFixed(1)}, ${(TRAY.h / 2).toFixed(1)});
    col += machGlowCol() * 0.25 * thunk * (1.0 - smoothstep(0.0, 4.0, max(tq.x, tq.y)));
    // 玻璃的斜反光
    float g = smoothstep(0.02, 0.0, abs(px.x * 0.35 + px.y - 420.0) / 300.0 - 0.1) * step(210.0, px.y) * step(px.y, 850.0);
    col += C_BONE * 0.03 * g;
  }
  fragColor = vec4(col, 1.0);
}`;

/** 地面（濕的柏油路，映著販賣機的光；罐子的影子）與後面的鐵捲門。kind 0 = 地、1 = 鐵捲門。 */
const ENV_FRAG = /* glsl */ `${PRE}
in vec3 vW; in vec3 vN; in vec2 vUv; in vec3 vO;
out vec4 fragColor;
${GLSL_COMMON}
${LIGHT}
uniform float kind; uniform vec4 canS; // 罐子的影子：中心 x、z、長軸方向角、在地上嗎（0..1）
void main() {
  vec3 P = vW;
  vec3 gc = machGlowCol();
  if (kind > 0.5) {
    // 鐵捲門：橫的一條一條，被販賣機的光照亮一片
    float rib = 0.5 + 0.5 * sin(P.y / 7.0);
    float seam = pxLine(abs(fract(P.y / 44.0) - 0.5) * 44.0, 0.6, 1.6);
    vec3 base = mix(C_INK2, C_GRAPHITE, 0.3) * (0.75 + 0.2 * rib) * (1.0 - 0.35 * seam) * (0.9 + 0.1 * snoise(P.xy / 200.0));
    float lit = glow * 520000.0 / (dot(P - machC, P - machC) + 260000.0);
    // 右邊路燈斜斜照到的一片
    float lamp = exp(-pow((P.x - 900.0) / 900.0, 2.0) - pow((P.y - 700.0) / 900.0, 2.0));
    fragColor = vec4(base * (0.04 + 0.5 * lit * lit + 0.25 * lamp) + gc * 0.05 * lit, 1.0);
    return;
  }
  if (kind < -0.5) {
    // 販賣機前面空氣裡的一團光（加亮）
    vec2 q = (vUv - 0.5) * vec2(1.0, 1.3);
    fragColor = vec4(gc * 0.07 * glow * exp(-dot(q, q) * 7.0), 0.0);
    return;
  }
  // 柏油：暗、有細顆粒；有水的地方比較黑、反光比較亮
  float wet = smoothstep(-0.1, 0.4, fbm(P.xz / 520.0, 3));
  vec3 base = C_INK * (1.0 + 0.5 * (0.5 + 0.5 * snoise(P.xz / 3.0))) + C_INK2 * 0.4;
  base *= mix(1.0, 0.7, wet);
  // 販賣機的倒影：從販賣機腳下往鏡頭拉長的一片光，有水的地方比較清楚
  vec3 toM = machC - P; toM.y = 0.0;
  float d = length(toM);
  vec3 V = normalize(camPos - P);
  vec3 Rv = reflect(-V, vec3(0.0, 1.0, 0.0));
  vec3 toMn = normalize(machC - P);
  float refl = pow(max(dot(Rv, toMn), 0.0), mix(18.0, 60.0, wet)) * mix(0.2, 1.0, wet);
  float pool = 900000.0 / (d * d + 600000.0);
  // 路燈打在罐子附近的一圈光
  vec2 kq = (P.xz - vec2(${REST.x.toFixed(1)}, ${REST.z.toFixed(1)})) / vec2(900.0, 700.0);
  float key = exp(-dot(kq, kq));
  vec3 col = base * (0.3 + 0.8 * pool * glow + 1.1 * key) + gc * (0.05 * pool + 0.55 * refl) * glow;
  // 罐子在地上的影子（橢圓，沿著罐子的軸拉長）
  vec2 q = P.xz - canS.xy;
  float ca = cos(canS.z), sa = sin(canS.z);
  vec2 lq = vec2(ca * q.x - sa * q.y, sa * q.x + ca * q.y);
  float sh = exp(-pow(lq.x / ${(CL * 0.55).toFixed(1)}, 2.0) - pow(lq.y / ${(CR * 0.9).toFixed(1)}, 2.0));
  col *= 1.0 - 0.75 * sh * canS.w;
  fragColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------- 共用的 3D 道具
class Rig {
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(FOV, W / H, 20, 30000);
  U = {
    camPos: { value: new THREE.Vector3() }, machC: { value: new THREE.Vector3() }, machN: { value: new THREE.Vector3() },
    glow: { value: 1 },
  };
  canMat: THREE.RawShaderMaterial;
  bodyMat: THREE.RawShaderMaterial;
  frontMat: THREE.RawShaderMaterial;
  stripMat: THREE.RawShaderMaterial;
  groundMat: THREE.RawShaderMaterial;
  doorMat: THREE.RawShaderMaterial;
  can: THREE.Mesh;
  machine = new THREE.Group();
  constructor() {
    const mk = (frag: string, extra: Record<string, THREE.IUniform>) => new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: frag, uniforms: { ...THEME_UNIFORMS, ...this.U, ...extra },
    });
    this.canMat = mk(CAN_FRAG, { lab: { value: null } });
    const mach = (kind: number) => mk(MACH_FRAG, {
      kind: { value: kind }, tex: { value: null }, btn: { value: new Array(12).fill(0) }, thunk: { value: 0 },
      btnGeo: { value: new THREE.Vector4(140, 421, 138, 216) },
    });
    this.bodyMat = mach(0); this.frontMat = mach(1); this.stripMat = mach(2);
    this.groundMat = mk(ENV_FRAG, { kind: { value: 0 }, canS: { value: new THREE.Vector4(0, 0, 0, 0) } });
    this.doorMat = mk(ENV_FRAG, { kind: { value: 1 }, canS: { value: new THREE.Vector4(0, 0, 0, 0) } });
    // 地面、後面的鐵捲門（跟販賣機的背平行）
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), this.groundMat);
    ground.frustumCulled = false;
    this.scene.add(ground);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(6000, 2400), this.doorMat);
    door.position.set(0, 1200, 0);
    door.frustumCulled = false;
    // 販賣機：機身＋正面（貼圖）＋價格條（貼圖，蓋在正面上一點點）
    const body = new THREE.Mesh(new THREE.BoxGeometry(MW + 30, MH + 30, MD), this.bodyMat);
    body.position.set(MW / 2, MH / 2 + 10, -MD / 2 - 1);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(MW, MH), this.frontMat);
    front.position.set(MW / 2, MH / 2 + 25, 1);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(STRIP.w, STRIP.h), this.stripMat);
    strip.position.set(STRIP.x + STRIP.w / 2, MH + 25 - (STRIP.y + STRIP.h / 2), 3);
    // 鐵捲門在販賣機後面 60
    door.position.set(MW / 2, 1200, -MD - 60);
    const haze = new THREE.Mesh(new THREE.PlaneGeometry(1500, 1900), mk(ENV_FRAG, { kind: { value: -1 }, canS: { value: new THREE.Vector4() } }));
    const hm = haze.material as THREE.RawShaderMaterial;
    hm.transparent = true; hm.depthWrite = false; hm.blending = THREE.CustomBlending;
    hm.blendSrc = THREE.OneFactor; hm.blendDst = THREE.OneFactor;
    haze.position.set(MW / 2, MH * 0.55, 180);
    haze.renderOrder = 5;
    for (const m of [body, front, strip, door, haze]) { m.frustumCulled = false; this.machine.add(m); }
    this.machine.position.copy(M0);
    this.machine.rotation.y = MYAW;
    this.scene.add(this.machine);
    // 罐子：軸是 x（CylinderGeometry 的軸是 y，轉過來）
    const g = new THREE.CylinderGeometry(CR, CR, CL, 96, 1, false).rotateZ(-Math.PI / 2);
    this.can = new THREE.Mesh(g, this.canMat);
    this.can.frustumCulled = false;
    this.scene.add(this.can);
  }
}

/**
 * 商品窗裡的一樣商品（底部中心在 (cx, by)）：罐裝＝圓柱（左右暗、中間亮）、上下一圈鋁邊、白標籤上兩行小字；
 * 瓶裝＝瓶身、瓶肩、瓶頸、有顏色的瓶蓋。都是線條＋平塗，被櫃子裡的燈從上面照。
 */
function drawProduct(c: CanvasRenderingContext2D, cx: number, by: number, tall: boolean, col: string) {
  const shade = (x0: number, w: number, a = 1) => {
    const g = c.createLinearGradient(x0, 0, x0 + w, 0);
    g.addColorStop(0, rgba(col, 0.5 * a)); g.addColorStop(0.35, rgba(col, a)); g.addColorStop(1, rgba(col, 0.42 * a));
    return g;
  };
  const metal = (x0: number, w: number) => {
    const g = c.createLinearGradient(x0, 0, x0 + w, 0);
    g.addColorStop(0, rgba('graphite')); g.addColorStop(0.35, rgba('bone')); g.addColorStop(1, rgba('graphite'));
    return g;
  };
  if (!tall) {
    const w = 72, h = 124, x0 = cx - w / 2, top = by - h;
    c.fillStyle = shade(x0, w); c.beginPath(); c.roundRect(x0, top + 6, w, h - 10, 4); c.fill();
    c.fillStyle = metal(x0, w);
    c.beginPath(); c.roundRect(x0 + 3, top, w - 6, 10, 4); c.fill();
    c.beginPath(); c.roundRect(x0 + 4, by - 8, w - 8, 8, 3); c.fill();
    c.fillStyle = rgba('bone', 0.9); c.fillRect(x0 + 6, top + 44, w - 12, 42);
    c.fillStyle = rgba(col, 0.9); c.fillRect(x0 + 6, top + 44, w - 12, 5);
    c.fillStyle = rgba('sepia', 0.55); c.fillRect(x0 + 14, top + 60, w - 28, 4); c.fillRect(x0 + 18, top + 70, w - 36, 3);
  } else {
    const w = 60, h = 160, x0 = cx - w / 2, top = by - h;
    c.fillStyle = shade(x0, w, 0.85);
    c.beginPath();
    c.moveTo(x0, by - 6); c.lineTo(x0, top + 70);
    c.quadraticCurveTo(x0, top + 42, cx - 12, top + 30); c.lineTo(cx - 12, top + 12);
    c.lineTo(cx + 12, top + 12); c.lineTo(cx + 12, top + 30);
    c.quadraticCurveTo(x0 + w, top + 42, x0 + w, top + 70); c.lineTo(x0 + w, by - 6);
    c.quadraticCurveTo(x0 + w, by, x0 + w - 6, by); c.lineTo(x0 + 6, by); c.quadraticCurveTo(x0, by, x0, by - 6);
    c.fill();
    c.fillStyle = rgba('blood'); c.beginPath(); c.roundRect(cx - 14, top, 28, 16, 3); c.fill();
    c.fillStyle = rgba('bone', 0.88); c.fillRect(x0 + 4, top + 84, w - 8, 44);
    c.fillStyle = rgba('sepia', 0.5); c.fillRect(x0 + 12, top + 100, w - 24, 4); c.fillRect(x0 + 16, top + 110, w - 32, 3);
    c.fillStyle = rgba('bone', 0.3); c.fillRect(x0 + 10, top + 46, 5, h - 60);
  }
}

// ---------------------------------------------------------------- 版面
interface Row { text: string; y: number; sy: number }

export default class Vending extends Scene {
  rig = shared('vending.rig', () => new Rig());
  /** 全引擎共用的 4x MSAA（畫完同一個 render() 裡就解析到 out，不 track／dispose）。 */
  msaa = sharedMSAA();
  front = this.track(new Layer2D(MW, MH, 1, { fast: true }));
  strip = this.track(new Layer2D(STRIP.w, STRIP.h, undefined, { fast: true }));
  label = this.track(new Layer2D(LAB, CIRC, 1.4, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 97 + (this.msg?.id ?? 0) * 13) >>> 0;
  fit: FitResult | null = null;
  rows: Row[] = [];
  sig: { text: string; size: number; x: number; y: number; sy: number } | null = null;
  tDrop = 0; tOut = 0; tRest = 0; short = false;
  lyrSize = 64;
  stripSig = ''; labelSig = '';
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const gr = grid(au, s, e);
    await loadText(`${m?.text ?? ''}${m ? sigOf(m) : ''}${HEADER}${INVITE}${song.title}${song.artist}FROM THE COUPLE · 新人BLESSINGS 24H♪$0123456789`);
    // 掉罐子：第一個小節線（太近就下一拍），短窗格第一拍
    let td = gr.nBars < 3 ? gr.b0 : gr.bar0;
    if (td - s < 0.5) td += gr.beat;
    this.tDrop = td;
    this.tOut = td + Math.min(0.28, gr.beat * 0.55);
    // 落地在拍點：彈出來之後至少半秒的那一拍
    this.tRest = beatAfter(au, this.tOut + 0.55);
    this.short = gr.nBars < 3;
    this.drawFront();
    if (m) {
      this.layoutMsg(m);
      // 價格條的字（世界單位）：留言很長、字比較小時，歌詞也跟著小一點，留言才是最大的字
      this.lyrSize = this.fit!.size < 64 ? 60 : 64;
      this.drawLabel(0);
    }
    this.avoid = [[900, 280, 900, 520], [150, 520, 620, 200]];
  }

  // ---------------------------------------------------------------- 標籤
  /**
   * 標籤上的一行字印在圓柱上：從鏡頭看，離正中間 h（投影的高度）的地方在標籤上是弧長 R·asin(h/R)，
   * 而且那裡的字會被壓扁 cos 倍——所以每一行在標籤上先照這個拉長，停下來時從鏡頭看每一行都是正的。
   * 回傳標籤座標的基線 y 與垂直拉長倍數。
   */
  private arcY(h: number) {
    const a = Math.asin(clamp(h / CR, -0.97, 0.97));
    return { y: CIRC / 2 + CR * a, sy: 1 / Math.cos(a) };
  }

  private layoutMsg(m: Msg) {
    const c = this.label.ctx;
    // 看得到的高度：正中間上下約 ±0.76R（再外面壓太扁）；署名那一行另外留
    const boxW = LAB - 110, boxH = CR * 1.5;
    const sigSize0 = 40;
    const fit = fitMsg(c, m.text, FAM_MSG, boxW, boxH - sigSize0 * 1.5, { min: 44, max: 118, lineHeight: 1.22, maxLines: 5 });
    this.fit = fit;
    const sigSize = clamp(Math.round(fit.size * 0.42), 32, 46);
    const gap = Math.max(fit.lineHeight * 0.75, sigSize * 1.45);
    const total = fit.size + (fit.lines.length - 1) * fit.lineHeight + gap;
    // 投影高度 h：往上是負的（標籤的 y 向下，跟畫面一樣）
    const top = -total / 2;
    this.rows = fit.lines.map((ln, i) => {
      const hb = top + fit.size * 0.9 + i * fit.lineHeight; // 這行基線的投影高度
      const mid = hb - fit.size * 0.38;
      const a = this.arcY(mid);
      return { text: ln, y: a.y + (hb - mid) * a.sy, sy: a.sy };
    });
    const hs = top + fit.size * 0.9 + (fit.lines.length - 1) * fit.lineHeight + gap;
    const as = this.arcY(hs - sigSize * 0.38);
    c.font = font(FAM_SIG, sigSize);
    const text = sigOf(m);
    const sw = c.measureText(text).width;
    c.font = font(FAM_MSG, fit.size);
    const maxW = Math.max(...fit.lines.map((l) => c.measureText(l).width));
    const x0 = (LAB - maxW) / 2;
    this.sig = { text, size: sigSize, x: Math.min(LAB - 30 - sw, x0 + maxW - sw + 20), y: as.y + sigSize * 0.38 * as.sy, sy: as.sy };
  }

  /** 畫標籤：底、兩端的色帶、留言（或歌詞、邀請）。kt = 歌詞的時間（沒有留言時逐字跟唱）。 */
  private drawLabel(t: number, line?: Line | null) {
    const L = this.label, c = L.ctx;
    L.clear(rgba('bone'));
    c.textBaseline = 'alphabetic';
    // 兩端的色帶（圓周方向一圈，躺著的罐子看起來是直的）
    for (const [x, w, col] of [[0, 34, 'signal'], [36, 6, 'blood'], [LAB - 34, 34, 'signal'], [LAB - 42, 6, 'blood']] as const) {
      c.fillStyle = rgba(col, 0.92); c.fillRect(x, 0, w, CIRC);
    }
    // 背面（看不到的那半圈）：小小的成分表，冷面
    c.save(); c.translate(70, 120);
    c.font = font(F.mono(500), 18); c.fillStyle = rgba('sepia', 0.55);
    ['成分：祝福 100%', '保存期限：一輩子', '開罐後請與另一半分享'].forEach((s, i) => c.fillText(s, 0, i * 30));
    c.restore();
    if (this.fit && this.msg) {
      const fit = this.fit;
      c.font = font(FAM_MSG, fit.size);
      c.fillStyle = rgba('sepia');
      for (const r of this.rows) {
        const w = c.measureText(r.text).width;
        c.save(); c.translate((LAB - w) / 2, r.y); c.scale(1, r.sy);
        fillWithHearts(c, r.text, 0, 0);
        c.restore();
      }
      const sg = this.sig!;
      c.font = font(FAM_SIG, sg.size); c.fillStyle = rgba('sepia', 0.75);
      c.save(); c.translate(sg.x, sg.y); c.scale(1, sg.sy); c.fillText(sg.text, 0, 0); c.restore();
      if (this.msg.couple) {
        const a = this.arcY(-CR * 0.9);
        c.save(); c.translate(LAB / 2, a.y); c.scale(1, a.sy);
        c.font = font(F.mono(500), 18); c.letterSpacing = '4px'; c.fillStyle = rgba('blood');
        c.textAlign = 'center'; c.fillText('FROM THE COUPLE · 新人', 0, 0); c.textAlign = 'left';
        c.letterSpacing = '0px'; c.restore();
      }
    } else if (line) {
      // 沒有留言：歌詞印在罐子上（焦點）
      const st = { family: FAM_LYR, size: 104, minSize: 80, maxW: LAB - 110, maxRows: 2, align: 'center' as const, lineHeight: 1.14 };
      const lay = layoutRows(c, line, st);
      const top = -lay.height / 2 + lay.size * 0.84;
      // 每一行各自照圓柱拉長（跟留言一樣）
      const ink = paperInk();
      lay.rows.forEach((row, ri) => {
        const hb = top + ri * lay.lineHeight, a = this.arcY(hb - lay.size * 0.36);
        const one = { ...lay, rows: [row], words: lay.words.filter((w) => w.y === row.y).map((w) => ({ ...w, y: 0 })) };
        c.save(); c.translate(LAB / 2, a.y + lay.size * 0.36 * a.sy); c.scale(1, a.sy);
        drawRows(c, one, FAM_LYR, t, ink);
        c.restore();
      });
    } else {
      const ft = fitText(c, INVITE, FAM_MSG, LAB - 90, CR * 1.3, { min: 44, max: 80, lineHeight: 1.3, maxLines: 3 });
      c.font = font(FAM_MSG, ft.size); c.fillStyle = rgba('sepia');
      const top = -ft.height / 2 + ft.size * 0.86;
      ft.lines.forEach((ln, i) => {
        const hb = top + i * ft.lineHeight, a = this.arcY(hb - ft.size * 0.38);
        const w = c.measureText(ln).width;
        c.save(); c.translate((LAB - w) / 2, a.y + ft.size * 0.38 * a.sy); c.scale(1, a.sy); c.fillText(ln, 0, 0); c.restore();
      });
    }
    L.upload();
  }

  // ---------------------------------------------------------------- 販賣機正面（畫一次）
  private drawFront() {
    const L = this.front, c = L.ctx;
    L.clear(rgba('ink2'));
    c.textBaseline = 'alphabetic';
    // 上面的燈箱招牌
    const hg = c.createLinearGradient(0, 40, 0, 180);
    hg.addColorStop(0, rgba('bone', 0.95)); hg.addColorStop(1, rgba('paper', 0.85));
    c.fillStyle = hg; c.fillRect(30, 40, MW - 60, 140);
    c.fillStyle = rgba('signal', 0.95); c.fillRect(30, 152, MW - 60, 28);
    c.font = font(F.hei(900), 44); c.fillStyle = rgba('sepia'); c.letterSpacing = '10px';
    c.fillText(HEADER, 60, 124);
    c.letterSpacing = '4px'; c.font = font(F.mono(600), 15); c.fillStyle = rgba('ink2', 0.8);
    c.fillText('BLESSINGS · 24H', 64, 172);
    c.letterSpacing = '0px';
    // 商品窗：裡面有燈（上亮下暗），三層、每層四樣
    const wg = c.createLinearGradient(0, 200, 0, 860);
    wg.addColorStop(0, rgba('bone', 0.9)); wg.addColorStop(1, rgba('ash', 0.55));
    c.fillStyle = wg; c.fillRect(30, 200, MW - 60, 660);
    const rnd = mulberry32(7);
    const cols = ['signal', 'blood', 'rose', 'graphite', 'sepia', 'ash'] as const;
    for (let r = 0; r < 3; r++) {
      const y0 = 214 + r * 216;
      // 層板
      c.fillStyle = rgba('graphite', 0.7); c.fillRect(30, y0 + 186, MW - 60, 6);
      for (let k = 0; k < 4; k++) {
        const cx = 112 + k * 138;
        const special = r === 1 && k === 1; // 訊號色那一罐（會被按下去的）
        const tall = rnd() < 0.35 && !special;
        const col = special ? 'signal' : cols[Math.floor(rnd() * cols.length)]!;
        drawProduct(c, cx, y0 + 180, tall, col);
        // 價格標籤＋按鈕
        c.fillStyle = rgba('ink', 0.9); c.fillRect(cx - 50, y0 + 196, 100, 22);
        c.font = font(F.mono(500), 15); c.fillStyle = rgba('signal', 0.85); c.textAlign = 'center';
        c.fillText(`$${[20, 25, 25, 30, 35][Math.floor(rnd() * 5)]}`, cx - 16, y0 + 213);
        c.textAlign = 'left';
        c.fillStyle = rgba('graphite'); c.beginPath(); c.arc(cx + 28, y0 + 207, 10, 0, Math.PI * 2); c.fill();
      }
    }
    // 下半：價格條（歌詞，另一張圖層蓋上去）的底座、投幣口、取物口
    c.fillStyle = rgba('ink', 0.95); c.fillRect(STRIP.x - 8, STRIP.y - 8, STRIP.w + 16, STRIP.h + 16);
    c.fillStyle = rgba('graphite', 0.6); c.fillRect(470, 1090, 120, 170);
    c.fillStyle = rgba('ink'); c.fillRect(515, 1120, 30, 60); c.fillRect(495, 1210, 70, 18);
    c.fillStyle = rgba('ink'); c.fillRect(TRAY.x - 10, TRAY.y - 10, TRAY.w + 20, TRAY.h + 20);
    const tg = c.createLinearGradient(0, TRAY.y, 0, TRAY.y + TRAY.h);
    tg.addColorStop(0, rgba('graphite', 0.9)); tg.addColorStop(1, rgba('ink2', 0.9));
    c.fillStyle = tg; c.fillRect(TRAY.x, TRAY.y, TRAY.w, TRAY.h);
    c.font = font(F.mono(500), 14); c.fillStyle = rgba('ash', 0.6); c.letterSpacing = '4px';
    c.fillText('PUSH', TRAY.x + TRAY.w / 2 - 22, TRAY.y + 70);
    c.letterSpacing = '0px';
    L.upload();
  }

  /** 價格條：有留言放歌詞（逐字跟唱）；沒有留言放邀請（罐子上是歌詞）；純音樂放歌名。 */
  private drawStrip(t: number) {
    const { lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const ly = this.msg ? shownLyric(lyrics, t, s, e) : null;
    const sig = ly ? `${ly.line.start}:${ly.live ? t.toFixed(3) : 'idle'}:${ly.k.toFixed(2)}` : 'static';
    if (sig === this.stripSig) return;
    this.stripSig = sig;
    const L = this.strip, c = L.ctx;
    L.clear(rgba('ink'));
    // 液晶條：一格一格的價格標籤接在一起（很淡的分隔）
    c.fillStyle = rgba('graphite', 0.14);
    for (let x = 0; x < STRIP.w; x += 140) c.fillRect(x, 0, 2, STRIP.h);
    c.textBaseline = 'alphabetic';
    if (ly) {
      const st = { family: FAM_LYR, size: this.lyrSize, minSize: this.lyrSize - 6, maxW: STRIP.w - 40, maxRows: 2, align: 'left' as const, lineHeight: 1.1 };
      const lay = layoutRows(c, ly.line, st);
      c.save(); c.translate(20, STRIP.h / 2 - lay.height / 2 + lay.size * 0.8);
      drawRows(c, lay, FAM_LYR, t, darkInk(), ly.k);
      c.restore();
    } else if (this.msg) {
      c.font = font(F.mono(500), 22); c.letterSpacing = '4px'; c.fillStyle = rgba('signal', 0.7);
      c.fillText(`♪ ${song.title}`.toUpperCase().slice(0, 30), 20, STRIP.h / 2 + 8);
      c.letterSpacing = '0px';
    } else {
      const ft = fitText(c, INVITE, F.hei(500), STRIP.w - 40, STRIP.h - 30, { min: 26, max: 40, lineHeight: 1.3, maxLines: 2 });
      c.font = font(F.hei(500), ft.size); c.fillStyle = rgba('signal', 0.85);
      ft.lines.forEach((ln, i) => c.fillText(ln, 20, STRIP.h / 2 - ft.height / 2 + ft.size * 0.85 + i * ft.lineHeight));
    }
    L.upload();
  }

  // ---------------------------------------------------------------- 罐子的路徑
  /**
   * 罐子在 t 時的位置與姿勢：從取物口「啵」地彈出來，在空中翻著飛向鏡頭（拋物線），落地在拍點，
   * 彈兩下、在地上晃兩下停住——停下來時軸是水平的、標籤正中間朝鏡頭（再往鏡頭仰一點）。
   */
  private canPose(t: number) {
    const mq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), MYAW);
    const exit = new THREE.Vector3(TRAY.x + TRAY.w / 2, MH + 25 - (TRAY.y + TRAY.h / 2), 40).applyQuaternion(mq).add(M0);
    const u = clamp((t - this.tOut) / Math.max(0.2, this.tRest - this.tOut));
    // 水平方向幾乎等速（空氣阻力一點點），垂直是拋物線
    const ex = u * (1.2 - 0.2 * u);
    const p = new THREE.Vector3(lerp(exit.x, REST.x, ex), lerp(exit.y, REST.y, u) + 560 * u * (1 - u), lerp(exit.z, REST.z, ex));
    const d = t - this.tRest;
    if (d > 0) p.y += 64 * Math.abs(Math.sin(d * 8)) * Math.exp(-d * 6);
    // 姿勢：最後的樣子（標籤朝鏡頭仰 0.1）× 還沒翻完的那一段（繞一根斜的軸）× 落地後的晃
    const q = new THREE.Quaternion().setFromAxisAngle(TUMBLE, -(1 - ease.outCubic(u)) * 5.4);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.1 + (d > 0 ? 0.2 * Math.sin(d * 9) * Math.exp(-d * 3.4) : 0)));
    return { p, q, inside: t < this.tOut, flying: t < this.tRest };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const rig = this.rig;
    this.drawStrip(t);
    if (!this.msg) {
      // 沒有留言：罐子上印正在唱的歌詞（逐字跟唱）
      const line = shownLyric(lyrics, t, s, e)?.line ?? null;
      const live = !!line && t >= line.start - 0.05 && t <= line.end + 0.05;
      const sig = line ? `${line.start}:${live ? t.toFixed(3) : t < line.start ? 'pre' : 'post'}` : 'none';
      if (sig !== this.labelSig) {
        this.labelSig = sig;
        this.drawLabel(t, line);
      }
    }
    // ---- 光、按鈕
    const mq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), MYAW);
    const U = rig.U;
    U.machC.value.set(MW / 2, MH * 0.55, 30).applyQuaternion(mq).add(M0);
    U.machN.value.set(0, 0, 1).applyQuaternion(mq);
    const thunk = pulse(t, this.tOut - 0.05, 0.12);
    U.glow.value = 1 + 0.06 * f.a.kick - 0.08 * thunk;
    const btn = rig.frontMat.uniforms.btn!.value as number[];
    const bi = Math.floor(au.beatAt(t));
    for (let i = 0; i < 12; i++) btn[i] = 0;
    // 平常：每拍一顆，照順序跑；按下去的那一顆（第二層第二顆）從掉罐子前一拍一直亮著
    if (t < this.tDrop - 0.4) btn[((bi % 12) + 12) % 12] = 0.55 * (1 - au.beatAt(t) % 1 * 0.6);
    btn[5] = t >= this.tDrop - 0.4 ? 1 : btn[5]!;
    rig.frontMat.uniforms.thunk!.value = thunk;
    rig.frontMat.uniforms.tex!.value = this.front.texture;
    rig.stripMat.uniforms.tex!.value = this.strip.texture;
    rig.canMat.uniforms.lab!.value = this.label.texture;
    // ---- 罐子
    const cp = this.canPose(t);
    rig.can.visible = !cp.inside;
    rig.can.position.copy(cp.p);
    rig.can.quaternion.copy(cp.q);
    // 影子：罐子越高越淡、越散
    (rig.groundMat.uniforms.canS!.value as THREE.Vector4).set(cp.p.x, cp.p.z, 0, cp.inside ? 0 : clamp(1 - (cp.p.y - CR) / 260));
    // ---- 鏡頭：開場看著整台販賣機慢慢推近；罐子飛出來時一路搖到貼地的近景，落地後慢慢推近；掉罐子那一下機器震一下
    const cam = rig.cam;
    const k = this.short ? 1 : ease.inOutCubic(prog(t, this.tOut - 0.05, this.tRest + 0.3));
    const pa = ease.outCubic(prog(t, s, this.tOut)), pb = ease.inOutQuad(prog(t, this.tRest, e));
    const sh = thunk * 5 * Math.sin(t * 90);
    cam.position.set(lerp(PA.pos[0], PB.pos[0], k) + 20 * pb, lerp(PA.pos[1], PB.pos[1], k) + sh, lerp(PA.pos[2] - 120 * pa, PB.pos[2] - 110 * pb, k));
    cam.lookAt(lerp(PA.look[0], PB.look[0], k) + 25 * pb, lerp(PA.look[1], PB.look[1], k), lerp(PA.look[2], PB.look[2], k));
    cam.updateMatrixWorld();
    U.camPos.value.copy(cam.position);

    const rt = this.msaa;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
    renderer.render(rig.scene, cam);
    comp.draw(renderer, rt.texture, out, { mode: 'replace', premult: false });
    const exit = prog(t, e - 0.35, e, ease.inCubic);
    return { bloom: 0.7, vignette: 0.62, halation: 0.3, zoom: 1 + 0.003 * f.a.kick + 0.015 * exit, popupAvoid: this.avoid };
  }
}

