// 夾娃娃機（clawmachine.ts）的 3D 道具：機台內部（地板、三面牆、天花板的 LED 燈條）、一堆扭蛋、爪子（纜線、爪座、三根爪）、
// 取物口的壓克力擋板。幾何與材質在模組層共用（shared()）：一晚會建很多次這個版面，shader 不要重編；
// 每一格由正在畫的那個窗格把位置與 uniform 設好再畫。
// 座標（世界單位）：機台內部 x -3..3、y 0..3.8（地板 y = 0）、z -2..2（z = 2 是前面的玻璃）；取物口在左前角。
import * as THREE from 'three';
import { GLSL_COMMON, THEME_UNIFORMS } from '../engine/glsl/common';
import { mulberry32 } from '../engine/util';

export const BOX = { x0: -3, x1: 3, y1: 3.8, z0: -2, z1: 2 };
/** 取物口：左前角這一塊沒有地板，上面圍著壓克力擋板。 */
export const CHUTE = { x1: -1.75, z0: 0.55, h: 0.8 };
export const CAP_R = 0.42;
/** 爪子停放的位置（取物口正上方）。 */
export const HOME = { x: -2.3, y: 2.85, z: 1.25 };
/** 爪座中心到夾住的扭蛋中心的距離。 */
export const HOLD = 0.7;

const PRE = /* glsl */ `precision highp float;\nprecision highp int;\n`;
const vert = (inst: boolean) => /* glsl */ `${PRE}
in vec3 position; in vec3 normal;
${inst ? 'in mat4 instanceMatrix; in vec3 iTop;' : ''}
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
out vec3 vW; out vec3 vN; out vec3 vO; out vec3 vTop;
void main() {
  mat4 m = modelMatrix${inst ? ' * instanceMatrix' : ''};
  vec4 w = m * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(m) * normal); vO = position;
  vTop = ${inst ? 'iTop' : 'vec3(0.0)'};
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// uKind：0 = 單色物件（被夾的那顆扭蛋、爪子），1 = 扭蛋堆（上半顆的顏色從 iTop 的權重混主題色），2 = 牆、3 = LED 燈條
const FRAG = /* glsl */ `${PRE}
in vec3 vW; in vec3 vN; in vec3 vO; in vec3 vTop;
out vec4 fragColor;
${GLSL_COMMON}
uniform vec3 cameraPosition;
uniform vec3 uTop; uniform vec3 uBot; uniform float uMetal; uniform float uGlow; uniform float uKind; uniform float uLed;
void main() {
  vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
  // 主光從上方的 LED 燈條打下來（稍微偏左前）
  vec3 L = normalize(vec3(-0.3, 1.0, 0.5));
  if (uKind > 2.5) { fragColor = vec4(C_SIGNAL * (1.6 + 1.4 * uLed), 1.0); return; }
  if (uKind > 1.5) {
    // 機台內壁：深色，越上面越亮（燈條在上面），前緣一點點訊號色的反光
    float h = clamp(vW.y / ${BOX.y1.toFixed(1)}, 0.0, 1.0);
    vec3 col = mix(C_INK * 0.9, C_INK2 * 2.2, h * h) + C_SIGNAL * 0.05 * smoothstep(0.7, 1.0, h) * (0.7 + 0.5 * uLed);
    // 牆上的菱格紋（機台常見的貼皮），很淡
    vec2 q = vec2(vW.x + vW.z, vW.y) * 3.0;
    float grid = max(pxLine(abs(fract(q.x + q.y) - 0.5) * 20.0, 0.3, 1.2), pxLine(abs(fract(q.x - q.y) - 0.5) * 20.0, 0.3, 1.2));
    col += C_GRAPHITE * 0.05 * grid * h;
    // 地板：扭蛋堆下面暗一點
    if (N.y > 0.5) col = mix(C_INK * 0.7, C_INK2 * 1.3, 0.5 + 0.5 * snoise(vW.xz * 0.8)) * (0.8 + 0.2 * uLed);
    fragColor = vec4(col, 1.0);
    return;
  }
  vec3 top = uKind > 0.5 ? (C_SIGNAL * vTop.r + C_BLOOD * vTop.g + mix(C_ASH, C_BONE, 0.6) * vTop.b + C_EMBER * max(0.0, 1.0 - vTop.r - vTop.g - vTop.b)) : uTop;
  // 扭蛋：上半顆是有顏色的透明殼、下半顆是白的；中間一圈接縫
  float seam = smoothstep(0.012, 0.035, abs(vO.y));
  vec3 base = vO.y > 0.0 ? top : uBot;
  float diff = 0.2 + 0.8 * max(dot(N, L), 0.0);
  vec3 col = base * diff * (0.3 + 0.7 * seam);
  col += C_SIGNAL * 0.07 * max(N.y, 0.0) * (0.6 + 0.6 * uLed);
  float sp = pow(max(dot(reflect(-L, N), V), 0.0), mix(28.0, 70.0, uMetal));
  col += mix(C_BONE, base, uMetal * 0.4) * sp * (0.45 + 0.9 * uMetal);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += base * rim * (0.3 + 0.3 * uMetal);
  col += top * uGlow;
  fragColor = vec4(col, 1.0);
}`;

function mat(inst: boolean, u: Record<string, number | THREE.Vector3>) {
  const uniforms: Record<string, THREE.IUniform> = { ...THEME_UNIFORMS };
  for (const [k, v] of Object.entries(u)) uniforms[k] = { value: v };
  return new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: vert(inst), fragmentShader: FRAG, uniforms });
}

export interface Prong { hinge: THREE.Group; hook: THREE.Group }

/** 扭蛋堆的位置（整晚固定，種子亂數）：兩層半，取物口那一塊空著。 */
function pile() {
  const rnd = mulberry32(20270313);
  const out: { p: THREE.Vector3; q: THREE.Quaternion; top: [number, number, number] }[] = [];
  const add = (x: number, y: number, z: number) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 2.4, rnd() * 6.28, (rnd() - 0.5) * 2.4));
    const r = rnd();
    // 上半顆的顏色：訊號色、暗部、白、更熱的訊號色（權重），偶爾混一點
    const top: [number, number, number] = r < 0.28 ? [1, 0, 0] : r < 0.5 ? [0, 1, 0] : r < 0.8 ? [0, 0, 1] : [0, 0, 0];
    out.push({ p: new THREE.Vector3(x, y, z), q, top });
  };
  const inChute = (x: number, z: number) => x < CHUTE.x1 + 0.35 && z > CHUTE.z0 - 0.35;
  const S = 0.86;
  for (let x = -2.55; x <= 2.56; x += S) for (let z = -1.55; z <= 1.56; z += S) {
    if (inChute(x, z)) continue;
    add(x + (rnd() - 0.5) * 0.1, CAP_R, z + (rnd() - 0.5) * 0.1);
  }
  for (let x = -2.12; x <= 2.2; x += S) for (let z = -1.12; z <= 1.2; z += S) {
    if (inChute(x, z) || rnd() < 0.15) continue;
    add(x + (rnd() - 0.5) * 0.1, CAP_R + 0.66, z + (rnd() - 0.5) * 0.1);
  }
  for (let x = -1.25; x <= 1.8; x += S) for (let z = -0.7; z <= 0.8; z += S) {
    if (rnd() < 0.45) continue;
    add(x + 0.43 + (rnd() - 0.5) * 0.1, CAP_R + 1.3, z + 0.43 + (rnd() - 0.5) * 0.1);
  }
  return out;
}

export class ClawRig {
  scene = new THREE.Scene();
  caps: ReturnType<typeof pile>;
  pileMesh: THREE.InstancedMesh;
  chosen: THREE.Mesh;
  chosenMat: THREE.RawShaderMaterial;
  cable: THREE.Mesh;
  claw = new THREE.Group();
  prongs: Prong[] = [];
  metal: THREE.RawShaderMaterial;
  pileMat: THREE.RawShaderMaterial;
  wallMat: THREE.RawShaderMaterial;
  ledMat: THREE.RawShaderMaterial;
  /** 目前藏起來的那一顆（被選中的扭蛋在堆裡的位置）。 */
  hidden = -1;
  private m4 = new THREE.Matrix4();

  constructor() {
    const S = this.scene;
    this.wallMat = mat(false, { uKind: 2, uLed: 1 });
    this.wallMat.side = THREE.DoubleSide;
    this.ledMat = mat(false, { uKind: 3, uLed: 0 });
    this.metal = mat(false, { uKind: 0, uTop: new THREE.Vector3(), uBot: new THREE.Vector3(), uMetal: 1, uGlow: 0, uLed: 1 });
    this.pileMat = mat(true, { uKind: 1, uBot: new THREE.Vector3(), uMetal: 0, uGlow: 0, uLed: 1 });
    this.chosenMat = mat(false, { uKind: 0, uTop: new THREE.Vector3(), uBot: new THREE.Vector3(), uMetal: 0, uGlow: 0.2, uLed: 1 });
    // ---- 機台內部：地板（取物口挖空）、後牆、左右牆、天花板
    const plane = (w: number, h: number, pos: [number, number, number], rot: [number, number, number]) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.wallMat);
      m.position.set(...pos); m.rotation.set(...rot); S.add(m);
    };
    const X0 = BOX.x0, X1 = BOX.x1, Z0 = BOX.z0, Z1 = BOX.z1, Y1 = BOX.y1;
    plane(X1 - CHUTE.x1, Z1 - Z0, [(X1 + CHUTE.x1) / 2, 0, 0], [-Math.PI / 2, 0, 0]);
    plane(CHUTE.x1 - X0, CHUTE.z0 - Z0, [(X0 + CHUTE.x1) / 2, 0, (Z0 + CHUTE.z0) / 2], [-Math.PI / 2, 0, 0]);
    plane(X1 - X0, Y1, [0, Y1 / 2, Z0], [0, 0, 0]);
    plane(Z1 - Z0, Y1, [X0, Y1 / 2, 0], [0, Math.PI / 2, 0]);
    plane(Z1 - Z0, Y1, [X1, Y1 / 2, 0], [0, -Math.PI / 2, 0]);
    plane(X1 - X0, Z1 - Z0, [0, Y1, 0], [Math.PI / 2, 0, 0]);
    // 取物口沒有地板：看下去是黑的（3D 畫面先清成很暗的顏色）
    // LED 燈條：天花板前緣、後緣，後面兩個直角
    const led = (sx: number, sy: number, sz: number, pos: [number, number, number]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), this.ledMat); m.position.set(...pos); S.add(m);
    };
    led(X1 - X0, 0.05, 0.05, [0, Y1 - 0.05, Z1 - 0.1]);
    led(X1 - X0, 0.05, 0.05, [0, Y1 - 0.05, Z0 + 0.05]);
    led(0.05, Y1, 0.05, [X0 + 0.05, Y1 / 2, Z0 + 0.05]);
    led(0.05, Y1, 0.05, [X1 - 0.05, Y1 / 2, Z0 + 0.05]);
    // ---- 天車的軌道（天花板下兩根橫桿）
    for (const z of [-1.9, 1.85]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(X1 - X0, 0.06, 0.08), this.metal); r.position.set(0, Y1 - 0.18, z); S.add(r);
    }
    // ---- 扭蛋堆
    this.caps = pile();
    const sph = new THREE.SphereGeometry(CAP_R, 28, 18);
    const geo = sph.clone();
    const tops = new Float32Array(this.caps.length * 3);
    this.caps.forEach((c, i) => tops.set(c.top, i * 3));
    geo.setAttribute('iTop', new THREE.InstancedBufferAttribute(tops, 3));
    this.pileMesh = new THREE.InstancedMesh(geo, this.pileMat, this.caps.length);
    this.caps.forEach((c, i) => this.pileMesh.setMatrixAt(i, this.m4.compose(c.p, c.q, new THREE.Vector3(1, 1, 1))));
    this.pileMesh.frustumCulled = false;
    S.add(this.pileMesh);
    this.chosen = new THREE.Mesh(sph, this.chosenMat);
    S.add(this.chosen);
    // ---- 爪子：纜線、爪座、三根爪（上臂＋往內勾的爪尖）
    this.cable = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1, 8), this.metal);
    S.add(this.cable);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.27, 0.34, 24), this.metal);
    this.claw.add(hub);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.2, 0.12, 16), this.metal);
    cap.position.y = 0.23; this.claw.add(cap);
    for (let k = 0; k < 3; k++) {
      const pivot = new THREE.Group();
      pivot.rotation.y = (k * Math.PI * 2) / 3 + 0.5;
      const hinge = new THREE.Group();
      hinge.position.set(0.14, -0.17, 0);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.78, 0.09), this.metal);
      arm.position.y = -0.39; hinge.add(arm);
      const hook = new THREE.Group();
      hook.position.y = -0.78;
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.36, 0.09), this.metal);
      tip.position.y = -0.18; hook.add(tip);
      hook.rotation.z = -1.15;
      hinge.add(hook);
      pivot.add(hinge);
      this.claw.add(pivot);
      this.prongs.push({ hinge, hook });
    }
    S.add(this.claw);
  }

  /** 藏起堆裡第 i 顆（它被選中了，改由單獨的那顆畫）。 */
  hide(i: number) {
    if (i === this.hidden) return;
    const v = new THREE.Vector3();
    if (this.hidden >= 0) { const c = this.caps[this.hidden]!; this.pileMesh.setMatrixAt(this.hidden, this.m4.compose(c.p, c.q, v.set(1, 1, 1))); }
    const c = this.caps[i]!;
    this.pileMesh.setMatrixAt(i, this.m4.compose(c.p, c.q, v.set(0.0001, 0.0001, 0.0001)));
    this.pileMesh.instanceMatrix.needsUpdate = true;
    this.hidden = i;
  }

  /** 爪座位置、爪子張開的角度（弧度，從垂直往外）。 */
  pose(x: number, y: number, z: number, open: number) {
    this.claw.position.set(x, y, z);
    for (const p of this.prongs) { p.hinge.rotation.z = open; p.hook.rotation.z = -1.15 - (open - 0.6) * 0.4; }
    const len = BOX.y1 - (y + 0.29);
    this.cable.position.set(x, y + 0.29 + len / 2, z);
    this.cable.scale.set(1, Math.max(0.01, len), 1);
  }
}
