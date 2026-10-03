// 骨牌（亮）：淺色木頭桌上排著一片象牙色的骨牌（真的 3D：three.js 的盒子），左邊一條「引線」骨牌由上往下倒，
// 每倒到一行就分岔、把那一行由左到右推倒。骨牌朝鏡頭的那面是點數，**倒下之後朝上的背面印著字**——
// 一行一行倒完，桌上就排出主打留言（宋體，像刻在象牙上）。
//  - 節拍：引線一拍倒一張（窗格短就半拍），每一行在拍點開始，行裡的骨牌排在 1/2、1/4 或 1/8 拍的格子上
//    （挑最慢、但來得及在一兩小節內倒完的那種）。倒下是真的物理感：加速倒下、靠在下一張上、下一張倒了再跟著躺平
//    （每格從最後一張往前解「靠在下一張上」的角度，確定性）。剛倒下的字是熱的（訊號色的墨），半秒後冷卻成墨色。
//  - 鏡頭（電影感）：切進來時是貼著桌面的低角度特寫（從右前方看著站好的骨牌、淺景深），第一拍推倒之後
//    一路升起來（crane），在留言倒完時停在斜上方的閱讀角度，之後很慢地推近。景深用每個像素真正的深度（寫在 alpha）。
//  - 歌詞：骨牌後面桌上的一張記分卡（紙）上，逐字跟唱，比留言小一級；署名是最後一行下面的一張小名牌。
//  - 沒有留言：骨牌排新人的名字「A ♥ B」，記分卡放大、歌詞當主角，卡片底下一行小小的邀請。純音樂：記分卡寫歌名。
// v2（留言尺寸標準）：排成留言的那一片骨牌縮到畫面左下（≤ 860×430、字 40～60 px），右上是主視覺：
// 起點那一張同時分岔出一條長長的骨牌路，繞過桌面、排成一顆大愛心，整個窗格一直在倒（排在 1/k 拍上），
// 愛心在窗格快結束時剛好倒完。
// 手法：InstancedMesh（一個 draw call 畫全部骨牌，點數、字、斜角都在 shader 裡）；桌面是全螢幕 shader（光線打到桌面），
// 影子是把骨牌沿光線方向壓扁到桌面畫進一張小圖、桌面取樣時模糊；最後一個景深 pass 輸出。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE, makeRT, clearRT, sharedMSAA } from '../engine/gl';
import { GLSL_COMMON, THEME_UNIFORMS } from '../engine/glsl/common';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, prog, pulse, hash, frameIdx } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, beatAfter, drawHeart, NAME_A, NAME_B } from './_motifs';
import { msgMaxFor, lyricV2, sigV2 } from './_v2';
import { paperInk } from './_t4';
import {
  bestCellRows, onGrid, sigOf, applyOrbit, lerpOrbit, fitOrbitBest, toScreen, rectPts, camBasis, T17_INVITE, T17_TEXT,
  type OrbitCam, type V3, type Rect,
} from './_t17';

export const spec: PlateSpecDecl = { group: 'type', family: 'game', paper: true, energy: [0.3, 1], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 尺寸（世界單位，約等於閱讀鏡頭下的 1 px）
/** 骨牌：高、寬（橫跨一行的方向）、厚。 */
const DH = 150, DW = 84, DD = 26;
/** 行裡相鄰骨牌的間距、行距（引線骨牌的間距也用行距）。 */
const PITCH = 90, ROWP = 134;
/** 字在骨牌背面的框（沿著骨牌長邊的中心、框的邊長）。倒下後只露出上面約 86 單位，字放在這一段。 */
const ZC = 107, BOXW = 80;
/** 字模的一格（像素）與字在格子裡的大小。 */
const CELL = 128, GLYPH = 100;
const FAM_CH = F.ming(900);
const FAM_SIG = F.hand(700);
const FAM_LYR = F.hei(700);
/** 光從左後上方來（指向光源），影子往右前方。 */
const LIGHT: V3 = [-0.5, 0.42, 1.0];
const MAX_DOM = 260;
/** 愛心那條骨牌路最多幾張、相鄰兩張的間距範圍。 */
const CHAIN_MAX = 150, CH_MIN = 62, CH_MAX = 100;
/** 記分卡右緣到愛心最左邊至少要留的距離（世界單位）：骨牌路在這一段裡往上彎。 */
const CARD_GAP = 240;
/** 沒有留言時骨牌排的字：新人的名字（英文名裡的空白是一格空位，也是可以換行的地方）。 */
const NO_MSG_TEXT = `${NAME_A}♥${NAME_B}`;

// ---------------------------------------------------------------- 共用的 GPU 資源（一晚只建一次）
const PRE = /* glsl */ `precision highp float;\nprecision highp int;\n`;

const DOM_VERT = /* glsl */ `${PRE}
in vec3 position; in vec3 normal; in mat4 instanceMatrix; in vec4 iA; in vec4 iB;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
out vec3 vW; out vec3 vN; out vec3 vL; out vec3 vLN; out vec4 vA; out vec4 vB; out float vDepth;
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vec4 w = m * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(m) * normal); vL = position; vLN = normal; vA = iA; vB = iB;
  vec4 mv = viewMatrix * w;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

// iA = (字模格子的 uv 原點 xy、熱度、被前一張蓋住到哪裡)；iB = (種類 0 字／1 愛心／2 空白, 上半點數, 下半點數, -)
const DOM_FRAG = /* glsl */ `${PRE}
in vec3 vW; in vec3 vN; in vec3 vL; in vec3 vLN; in vec4 vA; in vec4 vB; in float vDepth;
out vec4 fragColor;
${GLSL_COMMON}
uniform vec3 cameraPosition; uniform vec3 uLight; uniform sampler2D atlas; uniform vec2 uCell; uniform vec4 lamp;
// 點數的標準排法：n 顆點在 3×3 的哪幾格（q = -1..1）
float pipOn(float n, vec2 q) {
  bool c = q.x == 0.0 && q.y == 0.0;
  bool d1 = (q.x == -1.0 && q.y == 1.0) || (q.x == 1.0 && q.y == -1.0);
  bool d2 = (q.x == 1.0 && q.y == 1.0) || (q.x == -1.0 && q.y == -1.0);
  bool mid = q.y == 0.0 && q.x != 0.0;
  if (n < 0.5) return 0.0;
  if (n < 1.5) return c ? 1.0 : 0.0;
  if (n < 2.5) return d1 ? 1.0 : 0.0;
  if (n < 3.5) return (d1 || c) ? 1.0 : 0.0;
  if (n < 4.5) return (d1 || d2) ? 1.0 : 0.0;
  if (n < 5.5) return (d1 || d2 || c) ? 1.0 : 0.0;
  return (d1 || d2 || mid) ? 1.0 : 0.0;
}
float pips(vec2 p, float n) {
  // p：半邊的中心為原點（y 橫、z 縱），格距 22
  float best = 1e3;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 q = vec2(float(i), float(j));
    if (pipOn(n, q) < 0.5) continue;
    best = min(best, length(p - q * 21.0));
  }
  return best;
}
void main() {
  vec3 n0 = vLN;
  // 字模：在一致的控制流程裡先取樣（有 mipmap 的貼圖不能在分支裡用 texture()）
  vec2 cu = vec2((vL.z - ${ZC.toFixed(1)}) / ${BOXW.toFixed(1)} + 0.5, vL.y / ${BOXW.toFixed(1)} + 0.5);
  vec2 auv = vA.xy + clamp(cu, 0.0, 1.0) * uCell;
  vec4 g = texture(atlas, auv);
  float inBox = step(0.0, cu.x) * step(cu.x, 1.0) * step(0.0, cu.y) * step(cu.y, 1.0);
  // 每一面的 2D 座標與半寬高（算圓角的暗邊）
  vec2 fa; vec2 hb;
  if (abs(n0.x) > 0.5) { fa = vec2(vL.y, vL.z - ${(DH / 2).toFixed(1)}); hb = vec2(${(DW / 2).toFixed(1)}, ${(DH / 2).toFixed(1)}); }
  else if (abs(n0.y) > 0.5) { fa = vec2(vL.x + ${(DD / 2).toFixed(1)}, vL.z - ${(DH / 2).toFixed(1)}); hb = vec2(${(DD / 2).toFixed(1)}, ${(DH / 2).toFixed(1)}); }
  else { fa = vec2(vL.x + ${(DD / 2).toFixed(1)}, vL.y); hb = vec2(${(DD / 2).toFixed(1)}, ${(DW / 2).toFixed(1)}); }
  float edge = min(hb.x - abs(fa.x), hb.y - abs(fa.y));
  // 象牙：正面、背面比側面亮一點點，暖白
  vec3 ivory = mix(C_BONE, C_PAPER, 0.45);
  vec3 col = ivory * (abs(n0.x) > 0.5 ? 1.0 : 0.93);
  vec3 inkc = C_SEPIA * 0.85;
  if (n0.x > 0.5) {
    // 點數那一面：中間一條刻線、黃銅的小鉚釘、上下兩半的點
    float hf = vL.z > ${(DH / 2).toFixed(1)} ? 1.0 : 0.0;
    float nn = hf > 0.5 ? vB.y : vB.z;
    float dp = pips(vec2(vL.y, vL.z - (hf > 0.5 ? ${(DH * 0.75).toFixed(1)} : ${(DH * 0.25).toFixed(1)})), nn);
    float pip = 1.0 - smoothstep(5.2, 6.6, dp);
    col = mix(col, inkc * (0.7 + 0.3 * smoothstep(0.0, 6.0, dp)), pip);
    float line = (1.0 - smoothstep(0.6, 1.4, abs(vL.z - ${(DH / 2).toFixed(1)}))) * step(abs(vL.y), 30.0);
    col = mix(col, inkc, line * 0.8);
    float rivet = 1.0 - smoothstep(4.0, 5.2, length(vec2(vL.y, vL.z - ${(DH / 2).toFixed(1)})));
    col = mix(col, mix(C_BLOOD, C_SIGNAL, 0.45) * (0.8 + 0.4 * smoothstep(2.0, -2.0, vL.y + vL.z - ${(DH / 2).toFixed(1)})), rivet);
  } else if (n0.x < -0.5 && vB.x < 1.5) {
    // 背面：字（剛倒下是熱的訊號色墨，冷卻成墨色）；愛心用點綴色
    vec3 hot = mix(C_BLOOD, C_SIGNAL, 0.35);
    vec3 ink = vB.x > 0.5 ? C_ROSE * 0.8 : mix(inkc, hot, vA.z);
    col = mix(col, ink, g.a * inBox);
  }
  // 被前一張骨牌壓住的地方：接觸線上方一條很窄的影子
  if (n0.x < -0.5 && vA.w > 0.0) col *= 1.0 - 0.5 * exp(-max(vL.z - vA.w, 0.0) / 9.0);
  // 圓角：邊緣暗下去，靠邊一點點高光
  col *= mix(0.62, 1.0, smoothstep(0.0, 4.5, edge));
  vec3 N = normalize(vN), L = normalize(uLight), V = normalize(cameraPosition - vW);
  float dif = max(dot(N, L), 0.0);
  float amb = 0.5 + 0.12 * N.z;
  vec3 lit = col * (amb + 0.62 * dif);
  float sp = pow(max(dot(reflect(-L, N), V), 0.0), 40.0);
  lit += C_BONE * 0.16 * sp;
  lit += C_BONE * 0.06 * (1.0 - smoothstep(0.8, 2.6, abs(edge - 1.6))) * dif;
  // 貼近桌面的地方被桌子擋掉一點環境光
  lit *= mix(0.78, 1.0, smoothstep(0.0, 30.0, vW.z));
  float r = length(vW.xy - lamp.xy) / lamp.z;
  lit *= 0.8 + 0.28 * exp(-r * r);
  fragColor = vec4(lit, vDepth);
}`;

const SH_VERT = /* glsl */ `${PRE}
in vec3 position; in mat4 instanceMatrix;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix; uniform vec3 uLight;
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  // 沿著光線方向壓到桌面（z = 0）：影子的形狀就是骨牌真正的投影
  vec2 p = w.xy - uLight.xy * (w.z / uLight.z);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 0.0, 1.0);
}`;
const SH_FRAG = /* glsl */ `${PRE}
out vec4 fragColor;
void main() { fragColor = vec4(1.0); }`;

/** 桌面（全螢幕 shader：每個像素打一條光線到桌面 z = 0）：淺色木頭、影子、記分卡、名牌、燈。alpha 寫深度給景深用。 */
const TABLE = () => new FSPass(/* glsl */ `
  uniform vec3 camC; uniform vec3 camR; uniform vec3 camD; uniform vec3 camF; uniform float focal;
  uniform sampler2D shTex; uniform vec4 shRect;
  uniform sampler2D lyr; uniform vec4 lyrRect; uniform float lyrOn;
  uniform sampler2D atlas; uniform vec4 sigRect; uniform vec4 sigUV; uniform float sigOn;
  uniform vec4 lamp;
  float rbox(vec2 p, vec4 r, float rad) { vec2 c = r.xy + r.zw * 0.5; vec2 q = abs(p - c) - r.zw * 0.5 + rad; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rad; }
  float shadowAt(vec2 p) {
    vec2 uv = (p - shRect.xy) / shRect.zw;
    vec2 k = 7.0 / shRect.zw;
    float s = 0.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) s += textureLod(shTex, uv + vec2(float(i), float(j)) * k, 0.0).r;
    s /= 9.0;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) s = 0.0;
    return s;
  }
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 d = camF * focal + camR * (sp.x - ${W / 2}.0) + camD * (sp.y - ${H / 2}.0);
    float tt = camC.z / max(-d.z, 1e-4);
    vec2 p = camC.xy + tt * d.xy;
    float depth = d.z < -1e-4 ? tt * focal : 1e5;
    // 名牌的字模取樣要在分支外面（有 mipmap）
    vec2 suv = sigUV.xy + clamp((p - sigRect.xy) / sigRect.zw, 0.0, 1.0) * sigUV.zw;
    vec4 sg = texture(atlas, suv);
    // 淺色木頭：沿 x 的木紋、每 460 一片木板的接縫
    float g = fbm(vec2(p.x / 1500.0, p.y / 120.0), 3);
    float ring = sin((p.y + 140.0 * g) / 8.0);
    float fiber = snoise(vec2(p.x / 90.0, p.y / 2.8));
    vec3 col = mix(C_PAPER, C_SEPIA, 0.2 + 0.05 * g + 0.01 * ring + 0.012 * fiber);
    float seam = abs(fract(p.y / 460.0 + 0.37) - 0.5) * 460.0;
    col *= 1.0 - 0.18 * (1.0 - smoothstep(0.6, 2.0, seam));
    // 骨牌的影子
    col *= 1.0 - 0.36 * shadowAt(p);
    // 記分卡：紙、軟軟的影子、上面的歌詞（fast 的 Canvas 層：解預乘、轉線性）
    if (lyrOn > 0.0) {
      float dc = rbox(p, lyrRect, 6.0);
      col *= 1.0 - 0.22 * lyrOn * exp(-max(dc, 0.0) / 10.0) * step(0.0, dc);
      if (dc < 0.0) {
        vec3 card = mix(C_PAPER, C_BONE, 0.62);
        vec2 luv = (p - lyrRect.xy) / lyrRect.zw;
        vec4 L = textureLod(lyr, vec2(luv.x, luv.y), 0.0);
        L.rgb = L.a > 0.0 ? toLinear(L.rgb / L.a) * L.a : vec3(0.0);
        vec3 cc = card * (1.0 - L.a) + L.rgb;
        col = mix(col, cc, lyrOn * (1.0 - smoothstep(-1.0, 0.0, dc)));
      }
    }
    // 名牌（署名）
    if (sigOn > 0.0) {
      float ds = rbox(p, sigRect, 5.0);
      col *= 1.0 - 0.2 * sigOn * exp(-max(ds, 0.0) / 8.0) * step(0.0, ds);
      if (ds < 0.0) {
        vec3 card = mix(C_PAPER, C_BONE, 0.62);
        card = mix(card, C_SEPIA * 0.9, sg.a);
        col = mix(col, card, sigOn * (1.0 - smoothstep(-1.0, 0.0, ds)));
      }
    }
    // 燈：焦點附近亮，四周暗下去；很遠的桌面沒入房間的暗處
    float r = length(p - lamp.xy) / lamp.z;
    col *= 0.7 + 0.36 * exp(-r * r);
    col = mix(col, C_SEPIA * 0.32, smoothstep(3500.0, 12000.0, depth));
    fragColor = vec4(col, depth);
  }`, {
  camC: { value: new THREE.Vector3() }, camR: { value: new THREE.Vector3() }, camD: { value: new THREE.Vector3() }, camF: { value: new THREE.Vector3() }, focal: { value: 1000 },
  shTex: { value: null }, shRect: { value: new THREE.Vector4(0, 0, 1, 1) },
  lyr: { value: null }, lyrRect: { value: new THREE.Vector4() }, lyrOn: { value: 0 },
  atlas: { value: null }, sigRect: { value: new THREE.Vector4() }, sigUV: { value: new THREE.Vector4() }, sigOn: { value: 0 },
  lamp: { value: new THREE.Vector4(0, 0, 1400, 0) },
});

/** 景深：每個像素的深度在 alpha（桌面與骨牌都寫了），離焦平面越遠圓盤越大。 */
const DOF = () => new FSPass(/* glsl */ `
  uniform sampler2D src; uniform float focusZ; uniform float aperture; uniform float sharp; uniform vec2 px;
  void main() {
    vec4 c0 = textureLod(src, vUv, 0.0);
    float z = max(c0.a, 1.0);
    float coc = aperture * max(0.0, abs(z - focusZ) / z - sharp);
    float r = min(coc, 11.0);
    vec3 acc = c0.rgb;
    if (r > 0.5) {
      float a0 = hash12(FRAG_PX) * 6.2832;
      for (int i = 0; i < 12; i++) {
        float fi = float(i) + 0.5;
        float ang = fi * 2.39996 + a0;
        acc += textureLod(src, vUv + vec2(cos(ang), sin(ang)) * r * sqrt(fi / 12.0) * px, 0.0).rgb;
      }
      acc /= 13.0;
    }
    fragColor = vec4(acc, 1.0);
  }`, { src: { value: null }, focusZ: { value: 1000 }, aperture: { value: 0 }, sharp: { value: 0.03 }, px: { value: new THREE.Vector2(1 / W, 1 / H) } });

/** 骨牌的幾何：前面底下那條邊在原點（倒下時繞它轉），x = 倒的方向、y = 橫、z = 上。 */
function domGeo() {
  const g = new THREE.BoxGeometry(DD, DW, DH);
  g.translate(-DD / 2, 0, DH / 2);
  return g;
}

class Rig {
  geo = domGeo();
  iA = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DOM * 4), 4);
  iB = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DOM * 4), 4);
  domMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: DOM_VERT, fragmentShader: DOM_FRAG,
    uniforms: { ...THEME_UNIFORMS, uLight: { value: new THREE.Vector3(...LIGHT).normalize() }, atlas: { value: null }, uCell: { value: new THREE.Vector2(0.1, 0.1) }, lamp: { value: new THREE.Vector4(0, 0, 1400, 0) } },
  });
  shMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: SH_VERT, fragmentShader: SH_FRAG,
    uniforms: { uLight: { value: new THREE.Vector3(...LIGHT) } }, depthTest: false, depthWrite: false,
  });
  dom: THREE.InstancedMesh;
  sh: THREE.InstancedMesh;
  scene = new THREE.Scene();
  shScene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(28, W / H, 10, 40000);
  shCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5000);
  msaa = sharedMSAA();
  shRT = makeRT(1024, 640, { pxScale: 1, type: THREE.UnsignedByteType, depthBuffer: false });
  table = TABLE();
  dof = DOF();
  constructor() {
    this.geo.setAttribute('iA', this.iA);
    this.geo.setAttribute('iB', this.iB);
    this.dom = new THREE.InstancedMesh(this.geo, this.domMat, MAX_DOM);
    this.dom.frustumCulled = false;
    this.scene.add(this.dom);
    this.sh = new THREE.InstancedMesh(this.geo, this.shMat, MAX_DOM);
    this.sh.instanceMatrix = this.dom.instanceMatrix;
    this.sh.frustumCulled = false;
    this.shScene.add(this.sh);
    this.iA.setUsage(THREE.DynamicDrawUsage);
    this.dom.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
}

// ---------------------------------------------------------------- 骨牌與連鎖
interface Dom {
  x: number; y: number; yaw: number;
  /** 字（' ' = 空白骨牌、'' = 引線）。 */
  ch: string;
  u0: number; v0: number; kind: number; pa: number; pb: number;
  /** 開始倒的時間、自由倒下要多久。 */
  t0: number; tf: number;
  /** 最後一張：倒平。 */
  last: boolean;
}
interface Chain { ids: number[]; s: number }

/** 骨牌 k 靠在下一張（傾角 β）上時的傾角：前上角剛好碰到下一張的背面（推導見檔頭的說明）。 */
function restOn(beta: number, s: number) {
  return beta - Math.asin(clamp((DD - s * Math.cos(beta)) / DH, -1, 1));
}

export default class Domino extends Scene {
  rig = shared('domino.rig', () => new Rig());
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = Number(this.ctx.params.seed ?? 1);
  lyrL!: Layer2D;
  atlasCv: HTMLCanvasElement | null = null;
  atlasTex: THREE.CanvasTexture | null = null;
  doms: Dom[] = [];
  chains: Chain[] = [];
  theta: Float32Array = new Float32Array(0);
  rows: string[][] = [];
  sig = '';
  // 世界座標的範圍
  msgRect: Rect = [0, 0, 0, 0];
  lyrRect: Rect = [0, 0, 0, 0];
  sigRect: Rect = [0, 0, 0, 0];
  sigUV: [number, number, number, number] = [0, 0, 0, 0];
  lyrSize = 56;
  lyrScale = 1;
  hasLyr = false;
  // 時間
  B = 0.5; tStart = 0; tDone = 0; tCrane = 0;
  camA!: OrbitCam;
  camB!: OrbitCam;
  focusPts: V3[] = [];
  /** 愛心骨牌路的中心與大小（世界座標）：影子圖、燈要把它包進來。 */
  heartC: [number, number, number] = [0, 0, 1];
  m4 = new THREE.Matrix4();
  m4b = new THREE.Matrix4();

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const text = m ? m.text : NO_MSG_TEXT;
    this.sig = sigOf(m);
    this.hasLyr = lyrics.linesIn(s - 1, e + 1).length > 0 || !lyrics.has;
    await loadText(`${text}${this.sig}${T17_TEXT}${T17_INVITE}${song.title}${song.artist}♪純音樂間奏${lyrics.linesIn(s - 2, e + 1).map((l) => l.text).join('')}`);
    const B = (this.B = au.beatPeriod(s + 0.1));

    // ---- 排字：每行最多幾格，挑畫面上字最大的（大約的估計：閱讀鏡頭下 1 世界單位 ≈ 1 px 乘上縮放）
    const colsList = m ? [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] : [16];
    // v2：畫面上一個世界單位幾 px（p）由三件事決定：字不超過上限、整片（含左邊的引線）寬 ≤ 860、高 ≤ 430；挑 p 最大的排法
    const GL = BOXW * 0.78;
    const capPx = m ? msgMaxFor(text) : 44;
    const scaleFor = (cols: number, nr: number) => Math.min(capPx / GL, 860 / ((cols - 1) * PITCH + DH + DD + 130), 430 / (nr * ROWP * 0.9 + 60));
    const pick = bestCellRows(text, colsList, (cols, rows) => scaleFor(cols, rows.length));
    this.rows = pick.rows.slice(0, 7);
    const R = this.rows.length;
    const maxN = Math.max(...this.rows.map((r) => r.length));

    // ---- 字模：每個不同的字一格（白字，shader 上色），最下面一條放署名
    const uniq = [...new Set(this.rows.flat().filter((ch) => ch.trim()))];
    const cols = 8, arows = Math.max(1, Math.ceil(uniq.length / cols));
    const aw = cols * CELL, ah = arows * CELL + CELL;
    const cv = (this.atlasCv = document.createElement('canvas'));
    cv.width = aw; cv.height = ah;
    const c = cv.getContext('2d')!;
    c.fillStyle = '#fff';
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.font = font(FAM_CH, GLYPH);
    const cellOf = new Map<string, [number, number]>();
    uniq.forEach((ch, i) => {
      const cx = (i % cols) * CELL, cy = Math.floor(i / cols) * CELL;
      if (ch === '♥') drawHeart(c, cx + CELL / 2, cy + CELL / 2, GLYPH * 0.72, '#fff');
      else c.fillText(ch, cx + CELL / 2, cy + CELL / 2 + GLYPH * 0.36);
      // 貼圖翻過來（flipY）：v 的原點在畫布下面
      cellOf.set(ch, [cx / aw, 1 - (cy + CELL) / ah]);
    });
    // 署名：畫在最下面一條，量好寬度（名牌的大小照它算）
    const sigPx = 72;
    c.font = font(FAM_SIG, sigPx);
    c.textAlign = 'left';
    const sigW = Math.min(aw - 40, c.measureText(this.sig || ' ').width);
    if (this.sig) c.fillText(this.sig, 20, arows * CELL + CELL / 2 + sigPx * 0.36, aw - 40);
    this.sigUV = [0, 0, (sigW + 40) / aw, CELL / ah];
    const tx = (this.atlasTex = new THREE.CanvasTexture(cv));
    tx.colorSpace = THREE.SRGBColorSpace;
    tx.generateMipmaps = true;
    tx.minFilter = THREE.LinearMipmapLinearFilter;
    tx.anisotropy = 4;
    tx.needsUpdate = true;

    // ---- 骨牌的位置：行由上（遠）往下（近）、左對齊；引線在左邊
    const blockW = (maxN - 1) * PITCH + DH + DD;
    const X0 = -blockW / 2 + DD + 50;
    const Y0 = ((R - 1) / 2) * ROWP;
    const xc = X0 - DD - 22 - DW / 2;
    const rnd = (i: number, k: number) => hash(this.seed, i, k);
    const doms: Dom[] = [];
    const add = (d: Omit<Dom, 'u0' | 'v0' | 'kind' | 'pa' | 'pb' | 't0' | 'tf' | 'last'>) => {
      const i = doms.length;
      const cell = cellOf.get(d.ch);
      doms.push({ ...d, u0: cell?.[0] ?? 0, v0: cell?.[1] ?? 0, kind: d.ch === '♥' ? 1 : cell ? 0 : 2, pa: Math.floor(rnd(i, 1) * 7), pb: Math.floor(rnd(i, 2) * 7), t0: Infinity, tf: 0.2, last: false });
      return i;
    };
    // 引線：c = 0 在第一行上面，c = r + 1 跟第 r 行對齊
    const col: number[] = [];
    for (let k = 0; k <= R; k++) col.push(add({ x: xc, y: Y0 + ROWP - k * ROWP, yaw: -Math.PI / 2, ch: '' }));
    const rowIds: number[][] = this.rows.map((row, r) => row.map((ch, k) => add({ x: X0 + k * PITCH, y: Y0 - r * ROWP, yaw: 0, ch })));
    this.doms = doms;
    this.chains = [{ ids: col, s: ROWP }, ...rowIds.map((ids) => ({ ids, s: PITCH }))];
    this.theta = new Float32Array(doms.length);

    // ---- 時間：第一拍推倒引線，一拍倒一張；每一行在引線倒到它的那一拍開始，行裡排在 1/k 拍上
    this.tStart = beatAfter(au, s + Math.min(0.35, B * 0.6));
    const budget = clamp(0.5 * (e - this.tStart), 2 * B, 8 * B);
    const colStep = (R + 1) * B <= budget * 0.6 ? B : B / 2;
    col.forEach((id, k) => { const d = doms[id]!; d.t0 = au.timeOfBeat(au.beatAt(this.tStart) + (k * colStep) / B); d.tf = clamp(colStep * 1.9, 0.12, 0.3); });
    doms[col[col.length - 1]!]!.last = true;
    const rowStart = (r: number) => doms[col[r + 1]!]!.t0 + 0.02;
    const rowBudget = Math.max(B, this.tStart + budget - rowStart(R - 1));
    const grid = onGrid(au, rowStart(0), maxN, rowBudget);
    const k = grid.k;
    rowIds.forEach((ids, r) => {
      const b0 = au.beatAt(rowStart(r));
      ids.forEach((id, i) => { const d = doms[id]!; d.t0 = au.timeOfBeat(b0 + i / k); d.tf = clamp((B / k) * 1.9, 0.1, 0.24); });
      doms[ids[ids.length - 1]!]!.last = true;
    });
    this.tDone = Math.max(...rowIds.map((ids) => doms[ids[ids.length - 1]!]!.t0 + doms[ids[ids.length - 1]!]!.tf));

    // ---- 世界座標的範圍：留言（倒下之後）、名牌、記分卡
    const x0 = xc - DW / 2, x1 = X0 + (maxN - 1) * PITCH + DH;
    const yTop = Y0 + DW / 2, yBot = -Y0 - DW / 2;
    this.msgRect = [X0 - DD, yBot, (maxN - 1) * PITCH + DH + DD, yTop - yBot];
    let pS = scaleFor(maxN, R);
    const cam = this.rig.cam;
    const lines = lyrics.linesIn(s - 2, e + 1);
    const mc = document.createElement('canvas').getContext('2d')!;
    const colTop = Y0 + ROWP + DD;
    // 記分卡離骨牌遠一點：往愛心去的那條骨牌路從卡片下面經過，站著的骨牌不能擋到卡片上的字
    const cardY = Math.max(yTop + 60, colTop + 140);
    let cardW = 600, cardH = 150;
    let camB: OrbitCam = { tx: (x0 + x1) / 2, ty: 0, tz: 0, dist: 2000, az: 0, el: 1.08, fov: 28 };
    const pxAt = (o: OrbitCam, pt: V3) => {
      applyOrbit(cam, o);
      const q0 = toScreen(cam, pt), q1 = toScreen(cam, [pt[0] + 100, pt[1], pt[2]]);
      return Math.hypot(q1.x - q0.x, q1.y - q0.y) / 100;
    };
    // 愛心的位置：畫面右上固定一塊（中心 1470, 430、半徑 285 px），換回桌面的世界座標；N0 是愛心最左邊、骨牌路接上去的那一點
    const heartGeom = (o: OrbitCam) => {
      applyOrbit(cam, o);
      const bs = camBasis(cam);
      const dv = bs.F.clone().multiplyScalar(bs.f).addScaledVector(bs.R, 1470 - W / 2).addScaledVector(bs.D, 430 - H / 2);
      const tt = -bs.C.z / dv.z;
      const hc: [number, number] = [bs.C.x + dv.x * tt, bs.C.y + dv.y * tt];
      const hr = 285 / (pxAt(o, [hc[0], hc[1], 0]) || pS);
      return { hc, hr, N0: [hc[0] - (hr * 16) / 17, hc[1] + (hr * 4) / 17 + hr * 0.2] as [number, number] };
    };
    for (let outer = 0; outer < 6; outer++) {
      const msgPx = GL * pS;
      // 名牌：署名的字（圖集那一條高 CELL、字 72 px）換成世界單位
      const sigH = sigV2(msgPx) / (0.56 * pS), sigWw = ((sigW + 40) / CELL) * sigH;
      const lastN = this.rows[R - 1]!.length;
      const sx1 = Math.max(X0 + (lastN - 1) * PITCH + DH, X0 + sigWw);
      this.sigRect = [sx1 - sigWw, yBot - 20 - sigH, sigWw, sigH];
      // 記分卡：歌詞 40～52 px（比留言小）；寬度跟著這個窗格最長的一句，但不跟右上的愛心搶位置
      this.lyrSize = Math.round(lyricV2(m ? msgPx : null) / (pS * 0.95));
      mc.font = font(FAM_LYR, this.lyrSize);
      const natural = Math.max(mc.measureText(lyrics.has ? '' : song.title).width * 0.8, ...lines.map((l) => mc.measureText(l.text).width), m ? 0 : (mc.measureText(T17_INVITE).width * 18) / this.lyrSize);
      cardW = clamp(natural + 76, Math.min(520 / pS, x1 - x0), Math.max(x1 - x0, 900 / pS));
      const st = this.lyrStyle(cardW);
      const nRows = Math.max(1, ...lines.map((l) => layoutLyric(mc, l, st).rows.length));
      cardH = this.lyrSize * (1 + (nRows - 1) * 1.14) + (m ? 84 : 120);
      this.lyrRect = [x0, cardY, cardW, cardH];
      // 鏡頭：距離照 p 找（二分），再把留言那一片移到畫面左下（左緣 150、署名底 950）
      let lo = 300, hi = 12000;
      for (let i = 0; i < 26; i++) { const mid = (lo + hi) / 2; if (pxAt({ ...camB, dist: mid }, [(x0 + x1) / 2, 0, 0]) > pS) lo = mid; else hi = mid; }
      camB = { ...camB, dist: (lo + hi) / 2 };
      for (let i = 0; i < 8; i++) {
        applyOrbit(cam, camB);
        const L = toScreen(cam, [x0, 0, 0]), Bt = toScreen(cam, [x0, this.sigRect[1], 0]);
        camB = { ...camB, tx: camB.tx + (L.x - 150) / pS, ty: camB.ty + (950 - Bt.y) / (pS * 0.9) };
      }
      // 記分卡的右緣要離愛心夠遠：往愛心去的骨牌路先平平地走過卡片右邊，才往上接到愛心；
      // 卡片太寬（沒有留言時歌詞長）骨牌就會倒在歌詞上。放不下的歌詞交給 layoutLyric 縮小或折兩行
      const maxW = heartGeom(camB).N0[0] - CARD_GAP - x0;
      if (cardW > maxW) {
        cardW = Math.max(Math.min(520 / pS, x1 - x0), maxW);
        const st2 = this.lyrStyle(cardW);
        const nRows2 = Math.max(1, ...lines.map((l) => layoutLyric(mc, l, st2).rows.length));
        cardH = this.lyrSize * (1 + (nRows2 - 1) * 1.14) + (m ? 84 : 120);
        this.lyrRect = [x0, cardY, cardW, cardH];
      }
      applyOrbit(cam, camB);
      const top = toScreen(cam, [x0, cardY + (this.hasLyr ? cardH : 0), 0]).y;
      if (top >= 110) break;
      pS *= 0.94;
    }
    const msgPx = GL * pS;
    void msgPx;
    this.lyrScale = pxAt(camB, [x0 + cardW / 2, cardY + cardH / 2, 0]);
    this.camB = camB;

    // ---- 愛心那條骨牌路：從起點那一張往右分岔，沿著卡片下面走，從左邊接到愛心最左邊那一點，往上繞一整圈回來
    const { hc, hr } = heartGeom(camB);
    const heartAt = (u: number): [number, number] => {
      const sn = Math.sin(u);
      return [hc[0] + (hr * 16 * sn * sn * sn) / 17, hc[1] + (hr * (13 * Math.cos(u) - 5 * Math.cos(2 * u) - 2 * Math.cos(3 * u) - Math.cos(4 * u))) / 17 + hr * 0.2];
    };
    const Sx = xc + DW / 2 + 70, Sy = Y0 + ROWP;
    const U0 = Math.PI * 1.5;
    const N0 = heartAt(U0);
    const poly: [number, number][] = [];
    // 連接段：先平平地走過卡片下面（到卡片右緣再過去一點），再用三次貝茲往上接到愛心的左邊。
    // 往上彎的那一段整段都在卡片右邊，站著、倒下的骨牌都不會壓到卡片上的歌詞
    const Ax = clamp(Math.max(Sx + (N0[0] - Sx) * 0.55, this.lyrRect[0] + this.lyrRect[2] + CARD_GAP * 0.45), Sx, N0[0] - 60);
    for (let i = 0; i < 20; i++) poly.push([Sx + ((Ax - Sx) * i) / 20, Sy]);
    const P1: [number, number] = [Ax + (N0[0] - Ax) * 0.75, Sy], P2: [number, number] = [N0[0], Sy + (N0[1] - Sy) * 0.35];
    for (let i = 0; i <= 60; i++) {
      const u = i / 60, v = 1 - u;
      poly.push([v * v * v * Ax + 3 * v * v * u * P1[0] + 3 * v * u * u * P2[0] + u * u * u * N0[0], v * v * v * Sy + 3 * v * v * u * P1[1] + 3 * v * u * u * P2[1] + u * u * u * N0[1]]);
    }
    for (let i = 1; i <= 240; i++) poly.push(heartAt(U0 + (i / 240) * Math.PI * 2 * 0.985));
    const cum = [0];
    for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1]! + Math.hypot(poly[i]![0] - poly[i - 1]![0], poly[i]![1] - poly[i - 1]![1]));
    const Ltot = cum[cum.length - 1]!;
    let nCh = Math.min(CHAIN_MAX, MAX_DOM - doms.length, Math.round(Ltot / 80));
    let sp = Ltot / nCh;
    if (sp < CH_MIN) { nCh = Math.floor(Ltot / CH_MIN); sp = Ltot / nCh; }
    if (sp > CH_MAX) sp = CH_MAX;
    const at = (d: number) => {
      let i = 1;
      while (i < cum.length - 1 && cum[i]! < d) i++;
      const k = (d - cum[i - 1]!) / Math.max(1e-6, cum[i]! - cum[i - 1]!);
      const a0 = poly[i - 1]!, a1 = poly[i]!;
      return { x: a0[0] + (a1[0] - a0[0]) * k, y: a0[1] + (a1[1] - a0[1]) * k, yaw: Math.atan2(a1[1] - a0[1], a1[0] - a0[0]) };
    };
    const chain: number[] = [];
    for (let k = 0; k * sp <= Ltot - sp * 0.5 && chain.length < nCh; k++) { const q = at(k * sp); chain.push(add({ x: q.x, y: q.y, yaw: q.yaw, ch: '' })); }
    this.chains.push({ ids: chain, s: sp });
    this.theta = new Float32Array(doms.length);
    // 時間：起點那一張倒下的時候分岔；照 1/k 拍一張一張倒，窗格結束前一小節左右剛好倒完
    const tc0 = doms[col[0]!]!.t0 + colStep * 0.5;
    const avail = Math.max(B, e - 1.5 * B - tc0);
    const kk = [1, 2, 4, 8].find((x) => chain.length / x * B <= avail) ?? (chain.length * B) / avail;
    const b0 = au.beatAt(tc0);
    chain.forEach((id, i) => { const d = doms[id]!; d.t0 = au.timeOfBeat(b0 + (i + 1) / kk); d.tf = clamp((B / kk) * 1.9, 0.1, 0.24); });
    if (chain.length) doms[chain[chain.length - 1]!]!.last = true;
    this.heartC = [hc[0], hc[1], hr];

    // 進場：貼著桌面、從右前方看第一行的開頭（淺景深），第一拍之後升起來
    this.camA = { tx: X0 + PITCH * 1.5, ty: Y0 - ROWP * 0.3, tz: 45, dist: camB.dist * 0.42, az: 0.7, el: 0.28, fov: 30, roll: -0.03 };
    this.tCrane = Math.max(this.tDone + 0.2, this.tStart + Math.min(4 * B, 0.45 * (e - s)));
    this.focusPts = [[this.msgRect[0], this.msgRect[1], 0], [this.msgRect[0] + this.msgRect[2], this.msgRect[1] + this.msgRect[3], 0], [x0, cardY + cardH / 2, 0], [hc[0], hc[1], 0]];

    // ---- 記分卡的畫布（每格重畫歌詞）
    this.lyrL = this.track(new Layer2D(cardW, cardH, Math.min(2, SCALE * Math.max(1, this.lyrScale * 1.1)), { fast: true }));
  }

  override dispose() {
    this.atlasTex?.dispose();
    if (this.atlasCv) this.atlasCv.width = this.atlasCv.height = 0;
    super.dispose();
  }

  /** 自由倒下的角度（加速、倒平時輕輕彈一下）。 */
  private free(d: Dom, t: number) {
    const u = (t - d.t0) / d.tf;
    if (u <= 0) return 0;
    if (u < 1) return (Math.PI / 2) * u * u;
    const v = u - 1;
    return Math.PI / 2 - 0.05 * Math.abs(Math.sin(v * 9)) * Math.exp(-v * 3.5);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const rig = this.rig;
    const doms = this.doms, th = this.theta;

    // ---- 每一條連鎖從最後一張往前解傾角：自己倒的角度，和「靠在下一張上」的角度取小的
    for (const ch of this.chains) {
      const ids = ch.ids;
      for (let k = ids.length - 1; k >= 0; k--) {
        const d = doms[ids[k]!]!;
        let a = this.free(d, t);
        if (k < ids.length - 1) a = Math.min(a, restOn(th[ids[k + 1]!]!, ch.s));
        th[ids[k]!] = Math.max(0, a);
      }
    }
    // ---- 實例資料
    const A = rig.iA.array as Float32Array, Bv = rig.iB.array as Float32Array;
    for (let i = 0; i < doms.length; i++) {
      const d = doms[i]!;
      this.m4.makeRotationZ(d.yaw).setPosition(d.x, d.y, 0);
      this.m4b.makeRotationY(th[i]!);
      this.m4.multiply(this.m4b);
      rig.dom.setMatrixAt(i, this.m4);
      const heat = d.kind < 2 ? pulse(t, d.t0 + d.tf * 0.8, 0.3) : 0;
      A[i * 4] = d.u0; A[i * 4 + 1] = d.v0; A[i * 4 + 2] = heat; A[i * 4 + 3] = -1;
      Bv[i * 4] = d.kind; Bv[i * 4 + 1] = d.pa; Bv[i * 4 + 2] = d.pb;
    }
    // 被前一張壓住的位置（背面的接觸線，給 shader 畫一條窄窄的影子）
    for (const ch of this.chains) {
      for (let k = 1; k < ch.ids.length; k++) {
        const pi = ch.ids[k - 1]!, ci = ch.ids[k]!;
        const al = th[pi]!, be = th[ci]!;
        if (al < 0.05) continue;
        if (Math.abs(al - restOn(be, ch.s)) > 0.01) continue;
        const px = -ch.s + DH * Math.sin(al), pz = DH * Math.cos(al);
        const bx = -DD * Math.cos(be), bz = DD * Math.sin(be);
        A[ci * 4 + 3] = (px - bx) * Math.sin(be) + (pz - bz) * Math.cos(be);
      }
    }
    rig.dom.count = rig.sh.count = doms.length;
    rig.dom.instanceMatrix.needsUpdate = true;
    rig.iA.needsUpdate = true;
    rig.iB.needsUpdate = true;

    // ---- 鏡頭：低角度特寫 → 第一拍後升起來 → 閱讀角度慢慢推近
    const B = this.B;
    const kc = ease.inOutCubic(prog(t, this.tStart - 0.1, this.tCrane));
    const k0 = ease.outCubic(prog(t, s, this.tStart));
    let cam = lerpOrbit(this.camA, this.camB, kc);
    cam = { ...cam, dist: cam.dist * (1.06 - 0.06 * k0) * (1 - 0.035 * ease.inOutQuad(prog(t, this.tCrane, e))), az: cam.az + 0.06 * (1 - k0) };
    applyOrbit(rig.cam, cam);
    const bs = camBasis(rig.cam);

    // ---- 歌詞（記分卡）
    this.drawCard(t);

    // ---- 影子：骨牌沿光線壓到桌面，畫進一張小圖
    const [mx, my, mw, mh] = this.msgRect;
    const hx0 = this.heartC[0] - this.heartC[2] * 1.3, hx1 = this.heartC[0] + this.heartC[2] * 1.3, hy0 = this.heartC[1] - this.heartC[2] * 1.3, hy1 = this.heartC[1] + this.heartC[2] * 1.3;
    const sx0 = Math.min(mx - 300, hx0), sy0 = Math.min(my - 300, hy0), sx1 = Math.max(mx + mw + 300, hx1), sy1 = Math.max(my + mh + 600, hy1);
    const shR: Rect = [sx0, sy0, sx1 - sx0, sy1 - sy0];
    const sc = rig.shCam;
    sc.left = shR[0]; sc.right = shR[0] + shR[2]; sc.bottom = shR[1]; sc.top = shR[1] + shR[3];
    sc.position.set(0, 0, 1000); sc.up.set(0, 1, 0); sc.lookAt(0, 0, 0);
    sc.updateProjectionMatrix(); sc.updateMatrixWorld();
    clearRT(renderer, rig.shRT, [0, 0, 0], 0);
    renderer.setRenderTarget(rig.shRT);
    renderer.render(rig.shScene, sc);

    // ---- 桌面 → 骨牌（MSAA）→ 景深
    const lampV = new THREE.Vector4((mx + mw / 2 + this.heartC[0]) / 2, (my + mh / 2 + this.heartC[1]) / 2, Math.max(1500, (sx1 - sx0) * 0.7), 0);
    const T = rig.table;
    (T.u.camC!.value as THREE.Vector3).copy(bs.C);
    (T.u.camR!.value as THREE.Vector3).copy(bs.R);
    (T.u.camD!.value as THREE.Vector3).copy(bs.D);
    (T.u.camF!.value as THREE.Vector3).copy(bs.F);
    T.u.focal!.value = bs.f;
    T.u.shTex!.value = rig.shRT.texture;
    (T.u.shRect!.value as THREE.Vector4).set(...shR);
    T.u.lyr!.value = this.lyrL.upload();
    (T.u.lyrRect!.value as THREE.Vector4).set(...this.lyrRect);
    T.u.lyrOn!.value = this.hasLyr ? 1 : 0;
    T.u.atlas!.value = this.atlasTex;
    (T.u.sigRect!.value as THREE.Vector4).set(...this.sigRect);
    (T.u.sigUV!.value as THREE.Vector4).set(...this.sigUV);
    // 名牌在最後一行倒完的那一拍放上去
    T.u.sigOn!.value = this.sig ? ease.outCubic(prog(t, this.tDone, this.tDone + 0.25)) : 0;
    (T.u.lamp!.value as THREE.Vector4).copy(lampV);
    T.render(renderer, rig.msaa);
    renderer.setRenderTarget(rig.msaa);
    renderer.clearDepth();
    rig.domMat.uniforms.atlas!.value = this.atlasTex;
    (rig.domMat.uniforms.uCell!.value as THREE.Vector2).set(CELL / this.atlasCv!.width, CELL / this.atlasCv!.height);
    (rig.domMat.uniforms.lamp!.value as THREE.Vector4).copy(lampV);
    renderer.render(rig.scene, rig.cam);

    // 對焦：特寫時對著第一行的開頭（淺景深），升起來之後涵蓋整片留言與記分卡
    const zs = this.focusPts.map((p) => -new THREE.Vector3(...p).applyMatrix4(rig.cam.matrixWorldInverse).z);
    const zA = -new THREE.Vector3(this.doms[this.chains[1]!.ids[0]!]!.x, this.doms[this.chains[1]!.ids[0]!]!.y, 60).applyMatrix4(rig.cam.matrixWorldInverse).z;
    const z0 = Math.min(...zs), z1 = Math.max(...zs);
    const D = rig.dof;
    D.u.src!.value = rig.msaa.texture;
    D.u.focusZ!.value = zA + ((z0 + z1) / 2 - zA) * kc;
    D.u.sharp!.value = 0.02 + ((z1 - z0) / (z0 + z1)) * kc;
    D.u.aperture!.value = 60 - 30 * kc;
    D.render(renderer, out);

    // 骨牌倒下的震動：第一拍、每一行開始的那一下（很小）
    let amp = 5 * pulse(t, this.tStart, 0.07) + 3 * pulse(t, this.tDone, 0.08);
    for (let r = 1; r < this.chains.length; r++) amp += 1.6 * pulse(t, this.doms[this.chains[r]!.ids[0]!]!.t0, 0.06);
    const ph = frameIdx(t);
    return {
      paper: 1, bloom: 0.25, bloomThreshold: 1.5, halation: 0.05, vignette: 0.32, grain: 0.05, ca: 0.35,
      shake: [amp * (hash(ph, 1) - 0.5) * 2, amp * (hash(ph, 2) - 0.5) * 2],
    };
  }

  /** 記分卡上的歌詞樣式（排版快取的 key 要跟量卡片高度時一樣）。 */
  private lyrStyle(cardW: number) {
    return { family: FAM_LYR, size: this.lyrSize, minSize: Math.round(this.lyrSize * 0.8), maxWidth: cardW - 68, lineHeight: 1.14 };
  }

  /** 記分卡：歌詞逐字跟唱（紙上的配色）；間奏空著，純音樂寫歌名；沒有留言時底下一行邀請。 */
  private drawCard(t: number) {
    const L = this.lyrL;
    L.clear();
    const c = L.ctx;
    const w = L.w, h = L.h;
    const { lyrics, song } = this.ctx;
    // 淡淡的橫線（記分卡的格線）與左上角的小標
    c.fillStyle = rgba('sepia', 0.12);
    c.fillRect(24, h - 22, w - 48, 1.5);
    c.fillStyle = rgba('sepia', 0.45);
    c.font = font(F.mono(500), 16);
    c.letterSpacing = '3px';
    c.fillText('♪ NOW PLAYING', 26, 32);
    c.letterSpacing = '0px';
    const ink = paperInk();
    const size = this.lyrSize;
    const pad = 34;
    if (!lyrics.has) {
      c.fillStyle = rgba('sepia', 0.85);
      c.font = font(FAM_LYR, size * 0.8);
      c.fillText(`${song.title}`, pad, h / 2 + size * 0.36, w - pad * 2);
    } else {
      const ly = lyricAt(lyrics, t);
      if (ly) {
        const st = { ...this.lyrStyle(w), active: ink.active, sung: ink.sung, unsung: ink.unsung };
        const lay = layoutLyric(c, ly.line, st);
        c.save();
        const top = 48, bot = h - (this.msg ? 34 : 70);
        c.translate(pad, top + (bot - top - lay.height) / 2 + lay.size * 0.86);
        drawLyric(c, ly.line, t, st, lay, ly.k);
        c.restore();
      }
    }
    if (!this.msg) {
      c.fillStyle = rgba('sepia', 0.5);
      c.font = font(F.hei(500), 18);
      c.letterSpacing = '2px';
      c.fillText(T17_INVITE, pad, h - 36);
      c.letterSpacing = '0px';
    }
  }
}
