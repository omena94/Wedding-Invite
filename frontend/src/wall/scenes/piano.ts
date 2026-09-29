// 鋼琴（暗）：夜裡一台直立式鋼琴，一盞琴燈從上面照著譜架。鏡頭在琴椅的位置往下看：下面是琴鍵，上面是譜架上的一張手寫譜。
//  - 沒有人彈，是一台「自動演奏」的鋼琴：琴鍵自己在拍點按下去、亮起來（訊號色的光從鍵面透出來，也映在亮漆的鍵蓋上）。
//    按哪個鍵用真的節拍與「近似的音高」：左手在每小節的第一拍按低音（I–vi–IV–V 的根音）、第二四拍按和弦，
//    右手的旋律跟著歌詞——每個字唱出來的那一刻按一個鍵（五聲音階上的隨機漫步，確定性），純音樂時跟著拍子走。
//  - 畫面的焦點＝主打留言：譜紙左上角的手寫題詞（霞鶩文楷，v2 標準 40～60 px，題詞區約 720×290），第一拍起一個字一個字寫上去，
//    每寫一個字鋼琴就彈一個音（「鋼琴把你的祝福彈出來」），剛寫的字是訊號色的暗部、半秒後乾成墨色；署名在最後一行下面。
//  - 譜紙中間是一份大譜表（高音、低音兩行），鋼琴彈的每一個音都是一顆音符，一直往左捲，經過播放線時亮起來；小節線跟著捲
//    （每小節一個小事件）；每兩小節譜紙右上角被琴聲震得掀一下。
//  - 歌詞（比留言小 4 px）在譜紙下緣，逐字跟唱（亮紙上用 blood 色）。沒有留言：歌詞寫在題詞的位置（主角）、下面一行小小的邀請。
//    純音樂：右手跟著拍子彈，留言照樣寫。
//  - 小字只有一群：譜紙左上角的速度記號「♩ = 歌的 BPM　con amore」（冷面的樂譜術語：帶著愛）與抬頭的「Op. 留言編號」。
//  - 鏡頭：切進來時離得遠一點、第一拍推到定位（落定），之後整個窗格很慢地往前推、往右搖一點點。
// 手法：three.js 真的 3D（琴鍵是 InstancedMesh，按下去是繞後面的支點轉；亮漆、鍵面、譜紙各自一個 shader，燈光從琴燈算），
// 譜紙是兩張 Canvas 圖層（留言與譜表的線一張、只有在寫字的時候重畫；捲動的音符與歌詞一張、每格重畫），在 3D 裡貼到有一點彎的紙上。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, sharedMSAA } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp, frameIdx } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { lyricAt, beatAfter, drawHeart, COUPLE_ZH } from './_motifs';
import { layoutRows, drawRows, paperInk, type RowsLayout } from './_t4';
import { T23_INVITE, T23_TEXT, sigOf, stagger, layMsgV2, rawMat, type MsgLay, type Rect } from './_t23';
import { V2, lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'instrument', paper: false, energy: [0.1, 0.8], bars: [4, 8] };

// ---------------------------------------------------------------- 世界（公分）
/** 白鍵的間距、長、高；黑鍵的寬、長、高出白鍵多少。 */
const WK = 2.36, LW = 15, HW = 2.0, BKW = 1.26, LB = 9.6, BKH = 1.2;
/** 琴鍵繞著後面的支點轉（藏在鍵蓋裡）：按到底時前緣掉 1 公分。 */
const PIVOT_Z = -34, PRESS = 1.0 / 34;
/** 中央 C（MIDI 60）的白鍵中心 x。 */
const C4X = -4;
/** 譜紙（寬、高、中心），譜架往後仰。 */
const SHEET = { w: 50, h: 31 };
/** 譜架：下緣（譜紙的底）在 (y, z)，往後仰 tilt 弧度。 */
const DESK = { y: 9.5, z: -19.5, tilt: 0.32 };
/** 琴燈（在譜架上方、往下照）。 */
const LAMP = new THREE.Vector3(0, 54, -27);
/** 燈罩朝向（往前下方照譜架與琴鍵）。 */
const LAMP_AIM = new THREE.Vector3(0, 12, -12);
/** 譜紙貼圖（頁面 px）：1 公分 = 23 px，鏡頭在定位時頁面 1 px 大約是螢幕 0.9～1 px。 */
const PG = { w: 1150, h: 713 };

// ---------------------------------------------------------------- 頁面排版（頁面 px）
/** 留言是譜紙左上角的手寫題詞：頁面 740×300 ≈ 螢幕 720×290（v2：寫留言的那塊 ≤ 860×430），譜紙其他地方是真的譜。 */
const MSG_BOX = { x: 84, y: 118, w: 740, h: 300 };
/** 頁面 px 對螢幕 px 的倍數：鏡頭從上往下看，譜紙上半約 1:1、下緣比較遠（約 0.88），字級要換算。 */
const K_TOP = 1 / 0.97, K_BOT = 1 / 0.88;
/** 大譜表（高音、低音兩行）：一直往左捲，播放線（PH）上的音符亮起來；PXS = 一秒捲多少頁面 px。 */
const TREB = 446, BASS = 520, STAFF_GAP = 11;
const PH = 300, PXS = 175;
const LYR_Y = 656;
const MARG = 70;
const FAM_MSG = F.hand(400);
const FAM_LYR = F.archivo(100, 500);
const PENTA = [0, 2, 4, 7, 9];

const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
/** MIDI 的白鍵序號（A0 = 21 是第 0 個）。 */
function whiteIndex(m: number) { let k = 0; for (let x = 21; x < m; x++) if (!isBlack(x)) k++; return k; }
const C4W = whiteIndex(60);
/** 琴鍵中心的 x（黑鍵在兩個白鍵的交界）。 */
const keyX = (m: number) => (isBlack(m) ? (whiteIndex(m) - C4W) * WK - WK * 0.5 : (whiteIndex(m) - C4W) * WK) + C4X;

// ---------------------------------------------------------------- shader
const KEY_V = /* glsl */ `
in vec3 position; in vec3 normal; in mat4 instanceMatrix; in float iGlow;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
out vec3 vW; out vec3 vN; out vec3 vO; out float vGlow;
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vec4 w = m * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(m) * normal); vO = position; vGlow = iGlow;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
/** 共用的燈：琴燈（點光、柔和衰減）＋很暗的環境光。 */
const LIGHT = /* glsl */ `
uniform vec3 uLamp; uniform vec3 uLampDir; uniform float uLampI; uniform vec3 cameraPosition;
// 燈罩：光錐中間亮、外面暗（琴燈只照譜架與中間幾個八度，兩邊慢慢沒入黑暗）
float lampAtt(vec3 p) {
  vec3 d = p - uLamp;
  float cone = smoothstep(0.35, 0.95, dot(normalize(d), uLampDir));
  return uLampI * (0.12 + 0.88 * cone) / (1.0 + dot(d, d) / (80.0 * 80.0));
}
`;
const KEY_F = /* glsl */ `
in vec3 vW; in vec3 vN; in vec3 vO; in float vGlow;
${LIGHT}
uniform float uBlack;
void main() {
  vec3 N = normalize(vN), V = normalize(cameraPosition - vW), L = normalize(uLamp - vW);
  float att = lampAtt(vW);
  float top = step(0.6, N.y), front = step(0.6, N.z);
  vec3 base = uBlack > 0.5 ? C_INK * 0.35 : mix(C_BONE, C_PAPER, 0.45) * 0.8;
  float dif = max(dot(N, L), 0.0);
  vec3 col = base * (0.035 + 0.95 * dif * att);
  // 鍵面前緣一道圓角的亮邊、側面暗
  col *= mix(1.0, 0.55, (1.0 - top) * (1.0 - front));
  float sp = pow(max(dot(N, normalize(L + V)), 0.0), uBlack > 0.5 ? 70.0 : 24.0);
  col += C_BONE * sp * att * (uBlack > 0.5 ? 0.55 : 0.12);
  // 按下去的鍵亮起來：光從鍵面透出來（鍵面最亮、前緣次之），白鍵偏暖、黑鍵是一道訊號色
  float g = vGlow;
  vec3 lit = uBlack > 0.5 ? C_SIGNAL * 1.25 : mix(C_SIGNAL, C_EMBER, 0.35) * 1.35;
  col = mix(col, col * 0.4 + lit * (0.35 + 0.75 * top + 0.35 * front), clamp(g, 0.0, 1.0) * 0.9);
  fragColor = vec4(col, 1.0);
}`;
const BODY_V = /* glsl */ `
in vec3 position; in vec3 normal; in vec2 uv;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
out vec3 vW; out vec3 vN; out vec2 vUv;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
/** 亮漆（鋼琴的黑）：很暗的底、琴燈的高光、鍵蓋上映著亮起來的琴鍵。uKind：0 = 亮漆、1 = 琴鍵後面的毛氈、2 = 鍵床。 */
const BODY_F = /* glsl */ `
in vec3 vW; in vec3 vN; in vec2 vUv;
${LIGHT}
uniform float uKind;
uniform vec4 uRefl[16];
void main() {
  vec3 N = normalize(vN), V = normalize(cameraPosition - vW), L = normalize(uLamp - vW);
  float att = lampAtt(vW);
  if (uKind > 1.5) { fragColor = vec4(C_INK * 0.08, 1.0); return; }
  if (uKind > 0.5) {
    vec3 felt = mix(C_BLOOD * 0.16, C_INK2 * 0.5, 0.5) * (0.85 + 0.15 * snoise(vW.xy * 3.0));
    fragColor = vec4(felt * (0.2 + 0.8 * max(dot(N, L), 0.0) * att), 1.0);
    return;
  }
  vec3 col = C_INK * 0.18 * (0.1 + 0.9 * max(dot(N, L), 0.0) * att);
  // 琴燈的高光：亮漆上一團柔的亮、一顆小亮點
  vec3 R = reflect(-V, N);
  float s1 = pow(max(dot(R, L), 0.0), 18.0), s2 = pow(max(dot(R, L), 0.0), 400.0);
  col += C_BONE * (0.05 * s1 + 0.5 * s2) * att;
  col += mix(C_BLOOD, C_SIGNAL, 0.3) * 0.012 * s1 * att;
  // 菲涅耳：邊緣映到房間暗暗的暖光
  float fr = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  col += C_GRAPHITE * 0.03 * fr;
  // 鍵蓋（琴鍵正後方的立面）上映著琴鍵：一條淡淡的白、亮起來的鍵是一道訊號色
  if (N.z > 0.5 && vW.y < 11.0 && vW.y > -0.5) {
    float k = exp(-max(vW.y, 0.0) / 2.6);
    col += mix(C_BONE, C_PAPER, 0.5) * 0.025 * k * att;
    vec3 gl = vec3(0.0);
    for (int i = 0; i < 16; i++) {
      vec4 r = uRefl[i];
      if (r.y <= 0.0) continue;
      float dx = (vW.x - r.x) / r.z;
      gl += C_SIGNAL * r.y * exp(-dx * dx) * exp(-max(vW.y, 0.0) / 3.2);
    }
    col += gl * 0.55;
  }
  fragColor = vec4(col, 1.0);
}`;
/** 譜紙：兩張 Canvas 圖層（留言＋五線譜、歌詞）疊在紙上；琴燈照亮中間、四周暗一點，紙有一點纖維。 */
const SHEET_V = /* glsl */ `
in vec3 position; in vec3 normal; in vec2 uv;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
uniform float uFlutter;
out vec3 vW; out vec3 vN; out vec2 vUv;
void main() {
  // 紙沒有完全平：下緣往前捲一點、左右兩邊往後彎一點
  vec3 p = position;
  float u = uv.x * 2.0 - 1.0;
  p.z += 0.9 * pow(1.0 - uv.y, 3.0) - 0.35 * u * u;
  // 每兩小節，右上角被琴聲震得掀起來一下又落回去
  p.z += uFlutter * 2.4 * pow(max(0.0, uv.x - 0.62) / 0.38, 2.0) * pow(max(0.0, uv.y - 0.55) / 0.45, 2.0);
  vec4 w = modelMatrix * vec4(p, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const SHEET_F = /* glsl */ `
in vec3 vW; in vec3 vN; in vec2 vUv;
${LIGHT}
uniform sampler2D uBase; uniform sampler2D uLyr; uniform float uGlow;
void main() {
  vec3 N = normalize(vN), L = normalize(uLamp - vW);
  float att = lampAtt(vW);
  vec3 paper = mix(C_PAPER, C_BONE, 0.2) * (0.93 + 0.05 * snoise(vUv * vec2(160.0, 104.0)) + 0.03 * snoise(vUv * vec2(9.0, 6.0)));
  float lit = 0.03 + 1.0 * max(dot(N, L), 0.0) * att;
  // 琴燈是暖的（帶一點這首歌的訊號色）
  vec3 warm = mix(vec3(1.0), C_EMBER / max(max(C_EMBER.r, C_EMBER.g), 1e-3), 0.28);
  vec3 col = paper * lit * warm;
  vec4 a = fastLayer(texture(uBase, vUv)), b = fastLayer(texture(uLyr, vUv));
  col = col * (1.0 - a.a) + a.rgb * lit * warm;
  col = col * (1.0 - b.a) + b.rgb * lit * warm;
  // 紙的邊一條很細的暗線（厚度）
  vec2 e = min(vUv, 1.0 - vUv) * vec2(${SHEET.w.toFixed(1)}, ${SHEET.h.toFixed(1)});
  col *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.12, min(e.x, e.y)));
  // 亮起來的琴鍵把一點暖光打到紙的下緣
  col += C_SIGNAL * 0.03 * uGlow * (1.0 - vUv.y) * (1.0 - vUv.y);
  fragColor = vec4(col, 1.0);
}`;
/** 譜紙在譜架上的影子（軟的暗框）。 */
const SHADOW_F = /* glsl */ `
in vec3 vW; in vec3 vN; in vec2 vUv;
void main() {
  vec2 q = abs(vUv - 0.5) * 2.0;
  float d = max((q.x - 0.9) / 0.1, (q.y - 0.88) / 0.12);
  float a = 0.8 * (1.0 - smoothstep(-0.2, 1.0, d));
  fragColor = vec4(0.0, 0.0, 0.0, a);
}`;
/** 房間：鋼琴後面的暗處，燈打到的地方一點點暖。 */
/**
 * 右下角的暗角：那一角後面是燈照到的白鍵，引擎畫的 QR 旁邊的淺色小字（掃描留言、已收到幾則）會讀不清楚，
 * 讓鍵盤在右下角慢慢沒入黑暗（像燈照不到那裡），HUD 的字才清楚。預乘的「蓋上去」：黑色、透明度隨位置。
 */
const CORNER = () => new FSPass(/* glsl */ `
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float a = 0.93 * smoothstep(1060.0, 1430.0, p.x) * smoothstep(620.0, 850.0, p.y);
    fragColor = vec4(0.0, 0.0, 0.0, a);
  }`, {}, { over: true });

const ROOM = () => new FSPass(/* glsl */ `
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 col = C_INK * 0.4 + C_BLOOD * 0.02 * exp(-pow(length((p - vec2(960.0, 120.0)) / vec2(900.0, 500.0)), 2.0));
    fragColor = vec4(col, 1.0);
  }`);

/** 整台鋼琴（模組層共用：幾何與材質整晚只建一次，每一格由正在畫的窗格設好 uniform 與琴鍵的位置）。 */
class PianoRig {
  scene = new THREE.Scene();
  U = {
    uLamp: { value: LAMP.clone() }, uLampDir: { value: LAMP_AIM.clone().sub(LAMP).normalize() }, uLampI: { value: 1 },
    uRefl: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) },
    uBase: { value: null as THREE.Texture | null }, uLyr: { value: null as THREE.Texture | null }, uGlow: { value: 0 }, uFlutter: { value: 0 },
  };
  whites: THREE.InstancedMesh;
  blacks: THREE.InstancedMesh;
  wMidi: number[] = [];
  bMidi: number[] = [];
  wGlow: THREE.InstancedBufferAttribute;
  bGlow: THREE.InstancedBufferAttribute;
  private m4 = new THREE.Matrix4();
  private t4 = new THREE.Matrix4();
  private r4 = new THREE.Matrix4();

  constructor() {
    const U = this.U;
    const keyMat = (black: number) => rawMat(KEY_V, KEY_F, { ...U, uBlack: { value: black } });
    const bodyMat = (kind: number) => rawMat(BODY_V, BODY_F, { ...U, uKind: { value: kind } });
    for (let m = 21; m <= 108; m++) (isBlack(m) ? this.bMidi : this.wMidi).push(m);
    // 白鍵：鍵面 y = 0、前緣 z = 0；黑鍵：高出白鍵、比較短
    const wg = new THREE.BoxGeometry(WK - 0.16, HW, LW);
    wg.translate(0, -HW / 2, -LW / 2);
    const bg = new THREE.BoxGeometry(BKW, BKH + 1.2, LB);
    bg.translate(0, BKH - (BKH + 1.2) / 2, -LW + LB / 2);
    this.wGlow = new THREE.InstancedBufferAttribute(new Float32Array(this.wMidi.length), 1);
    this.bGlow = new THREE.InstancedBufferAttribute(new Float32Array(this.bMidi.length), 1);
    wg.setAttribute('iGlow', this.wGlow);
    bg.setAttribute('iGlow', this.bGlow);
    this.whites = new THREE.InstancedMesh(wg, keyMat(0), this.wMidi.length);
    this.blacks = new THREE.InstancedMesh(bg, keyMat(1), this.bMidi.length);
    for (const im of [this.whites, this.blacks]) { im.frustumCulled = false; this.scene.add(im); }
    const lacquer = bodyMat(0), felt = bodyMat(1), bed = bodyMat(2);
    const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, mat: THREE.Material, rx = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      m.position.set(x, y, z); m.rotation.x = rx; this.scene.add(m); return m;
    };
    // 鍵床（琴鍵下面、縫裡看到的暗處）、前面的鍵框、後面的毛氈、鍵蓋（收起來的立面）、上面板、譜架與托條
    box(260, 1, LW + 2, 0, -HW - 0.6, -LW / 2, bed);
    box(260, 3.2, 1.6, 0, -HW + 0.1, 0.9, lacquer);
    box(260, 0.9, 1.4, 0, 0.1, -LW - 0.7, felt);
    box(260, 9.2, 1.6, 0, 4.4, -LW - 2.2, lacquer);
    box(260, 1.4, 5.5, 0, 9.0, -LW - 3.4, lacquer);
    box(260, 100, 2, 0, 45, -34, lacquer);
    // 譜架：往後仰的一塊板，下緣一條托條
    const desk = new THREE.Group();
    desk.position.set(0, DESK.y, DESK.z);
    desk.rotation.x = -DESK.tilt;
    this.scene.add(desk);
    const dk = new THREE.Mesh(new THREE.BoxGeometry(150, 38, 1.2), lacquer); dk.position.set(0, 17, -1.1); desk.add(dk);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(150, 1.6, 2.4), lacquer); lip.position.set(0, -0.5, 0.6); desk.add(lip);
    // 譜紙與它的影子（貼在譜架上，跟著一起仰）
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(SHEET.w + 3, SHEET.h + 2.5), rawMat(BODY_V, SHADOW_F, {}, { transparent: true, depthWrite: false }));
    sh.position.set(0.5, SHEET.h / 2 - 0.7, -0.35); desk.add(sh);
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(SHEET.w, SHEET.h, 40, 26), rawMat(SHEET_V, SHEET_F, U));
    sheet.position.set(0, SHEET.h / 2 + 0.3, 0); desk.add(sheet);
  }

  /** 這一格每個鍵按下去多少（0..1）與亮度。 */
  pose(press: (m: number) => number, glow: (m: number) => number) {
    const set = (im: THREE.InstancedMesh, list: number[], attr: THREE.InstancedBufferAttribute) => {
      list.forEach((m, i) => {
        const a = press(m) * PRESS;
        // 繞支點轉：移到支點 → 轉 → 移回來 → 放到這個鍵的 x
        this.m4.makeTranslation(keyX(m), 0, PIVOT_Z);
        this.r4.makeRotationX(a);
        this.t4.makeTranslation(0, 0, -PIVOT_Z);
        this.m4.multiply(this.r4).multiply(this.t4);
        im.setMatrixAt(i, this.m4);
        attr.setX(i, glow(m));
      });
      im.instanceMatrix.needsUpdate = true;
      attr.needsUpdate = true;
    };
    set(this.whites, this.wMidi, this.wGlow);
    set(this.blacks, this.bMidi, this.bGlow);
  }
}

/** 一個音：哪個鍵、什麼時候按下、什麼時候放開、多大力（亮度）。 */
interface Note { m: number; a: number; r: number; v: number }

export default class Piano extends Scene {
  rig = shared('piano.rig', () => new PianoRig());
  room = shared('piano.room', ROOM);
  corner = shared('piano.corner', CORNER);
  cam = new THREE.PerspectiveCamera(36, W / H, 1, 800);
  base = this.track(new Layer2D(PG.w, PG.h, undefined, { fast: true }));
  lyr = this.track(new Layer2D(PG.w, PG.h, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 197 + (this.msg?.id ?? 0) * 31) >>> 0;
  lay: MsgLay | null = null;
  gt: number[] = [];
  sigT = Infinity;
  notes: Note[] = [];
  tFirst = 0;
  baseKey = '';
  solo = false;
  hasLyr = false;
  lyrSize = 64;
  bars: number[] = [];
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const lines = lyrics.linesIn(s - 1, e + 1);
    this.hasLyr = lines.length > 0;
    this.solo = !m;
    const sig = m ? sigOf(m) : '';
    const bpm = Math.round(60 / au.beatPeriod(s));
    await loadText(`${T23_TEXT}${m?.text ?? ''}${sig}${song.title}${lines.map((l) => l.text).join('')}♩ = ${bpm}　con amore`);
    const beat = au.beatPeriod(s);
    this.tFirst = beatAfter(au, s + Math.min(0.2, beat * 0.4));
    const bar = au.timeOfBar(au.barAt(this.tFirst) + 1) - this.tFirst;

    // ---- 留言：譜紙的上半，一個字一個字寫上去（每個字一個音）
    const c = this.base.ctx;
    if (m) {
      this.lay = layMsgV2(c, m.text, sig, FAM_MSG, MSG_BOX, { k: K_TOP, lineHeight: 1.26, maxLines: 5, sigFamily: FAM_MSG, align: 'left' });
      const n = this.lay.glyphs.filter((g) => g.row >= 0).length;
      this.gt = stagger(au, this.tFirst, n, Math.min(2 * bar, Math.max(0.8, 0.4 * (e - this.tFirst))));
      this.sigT = (this.gt[this.gt.length - 1] ?? this.tFirst) + beat * 0.75;
      // 歌詞在譜紙下緣（比較遠）：螢幕字級照 v2，換算成頁面字級
      this.lyrSize = lyricV2(this.lay.fit.size / K_TOP) * K_BOT;
    } else {
      // 沒有留言：歌詞寫在題詞的位置（譜紙上半）
      this.lyrSize = lyricV2(null) * K_TOP;
    }
    // 大譜表上的小節線（跟著譜一起捲過播放線：每小節一個小事件）
    for (let b = Math.floor(au.barAt(s - 3)); ; b++) { const tb = au.timeOfBar(b); if (tb > e + 5 || this.bars.length > 80) break; this.bars.push(tb); }

    // ---- 音：左手（低音、和弦）＋右手（留言的字、歌詞的字；純音樂時跟著拍子）
    const rnd = (i: number, k: number) => hash(this.seed, i, k);
    const notes: Note[] = [];
    const ROOT = [36, 45, 41, 43];
    const CHORD = [[55, 60, 64], [57, 60, 64], [53, 57, 60], [55, 59, 62]];
    const en = au.energyAt(s);
    for (let b = Math.floor(au.barAt(s)) - 1; ; b++) {
      const tb = au.timeOfBar(b);
      if (tb >= e + 4.5) break;
      const k = ((b % 4) + 4) % 4, bp = (au.timeOfBar(b + 1) - tb) / 4;
      notes.push({ m: ROOT[k]!, a: tb, r: tb + bp * 1.6, v: 1 });
      notes.push({ m: ROOT[k]! + 12, a: tb + bp * 2, r: tb + bp * 3, v: 0.7 });
      if (en > 0.3) for (const q of [1, 3]) for (const cm of CHORD[k]!) notes.push({ m: cm, a: tb + bp * q, r: tb + bp * (q + 0.55), v: 0.6 });
    }
    // 右手：五聲音階上的隨機漫步（確定性）
    let deg = 7;
    const step = (i: number) => {
      const r = rnd(i, 3);
      deg += r < 0.3 ? -1 : r < 0.6 ? 1 : r < 0.8 ? -2 : 2;
      if (deg < 3) deg = 3 + (3 - deg);
      if (deg > 10) deg = 10 - (deg - 10);
      return 60 + Math.floor(deg / 5) * 12 + PENTA[deg % 5]!;
    };
    this.gt.forEach((tg, i) => notes.push({ m: step(i), a: tg, r: tg + Math.max(0.12, beat * 0.4), v: 1 }));
    if (this.hasLyr) {
      for (const ln of lines) ln.words.forEach((w, i) => {
        const pm = step(1000 + w.gi);
        const next = ln.words[i + 1];
        notes.push({ m: pm, a: w.start, r: Math.max(w.start + 0.15, Math.min(w.end, next ? next.start - 0.03 : w.end)), v: 1 });
      });
    } else {
      // 純音樂：右手一拍一個音（快歌半拍）
      const per = en > 0.6 ? 0.5 : 1;
      for (let b = Math.ceil(au.beatAt(s - 2)), i = 0; ; b += per, i++) {
        const tb = au.timeOfBeat(b);
        if (tb >= e + 5 || i > 300) break;
        notes.push({ m: step(2000 + i), a: tb, r: tb + beat * per * 0.8, v: 0.9 });
      }
    }
    this.notes = notes.sort((x, y) => x.a - y.a);

    // ---- 即時小卡避開：題詞與歌詞
    this.avoid = [[380, 100, 760, 320], [440, 560, 1000, 90]];
  }

  /** 每個鍵在 t 按下多少、亮多少。 */
  private keyState(t: number) {
    const press = new Map<number, number>(), glow = new Map<number, number>();
    for (const n of this.notes) {
      if (n.a > t) break;
      if (t > n.r + 0.6) continue;
      const down = t < n.r ? ease.outExpo(clamp((t - n.a) / 0.05)) : 1 - ease.outCubic(clamp((t - n.r) / 0.12));
      const g = t < n.r ? n.v * (0.55 + 0.45 * Math.pow(0.5, (t - n.a) / 0.18)) : n.v * 0.55 * Math.pow(0.5, (t - n.r) / 0.12);
      press.set(n.m, Math.max(press.get(n.m) ?? 0, down));
      glow.set(n.m, Math.max(glow.get(n.m) ?? 0, g));
    }
    return { press, glow };
  }

  /** 譜紙的底圖：速度記號、大譜表的線、題詞（寫到第幾個字）。只有在寫字的時候每格重畫。 */
  private drawBase(t: number) {
    const L = this.base, c = L.ctx, m = this.msg;
    const writing = m && this.lay && t < this.sigT + 0.6;
    const key = !m ? 'static' : writing ? `w${frameIdx(t)}` : 'done';
    if (key === this.baseKey) return;
    this.baseKey = key;
    L.clear();
    // 速度記號（小字，整個畫面唯一的一群小字）
    c.font = font(F.serif(400, true), 24); c.fillStyle = rgba('sepia', 0.5); c.letterSpacing = '1px';
    c.fillText(`♩ = ${Math.round(60 / this.ctx.audio.beatPeriod(this.ctx.start))}    con amore`, MARG + 14, 96);
    c.letterSpacing = '0px';
    // 譜的標題（小、置中，像樂譜抬頭；編號用留言的序號，冷面的「作品第 42 號」）
    c.font = font(F.serif(400, true), 26); c.fillStyle = rgba('sepia', 0.55); c.textAlign = 'center';
    c.fillText(m ? `Op. ${m.n}` : 'Op. 1', PG.w / 2, 72);
    c.textAlign = 'left';
    // 大譜表：高音、低音兩行五線（淡淡的），左邊一個大括號把兩行括起來
    c.strokeStyle = rgba('sepia', 0.3); c.lineWidth = 1.5;
    for (const top of [TREB, BASS]) for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(MARG, top + i * STAFF_GAP); c.lineTo(PG.w - MARG, top + i * STAFF_GAP); c.stroke(); }
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(MARG, TREB); c.lineTo(MARG, BASS + 4 * STAFF_GAP); c.stroke();
    c.lineWidth = 3.2; c.strokeStyle = rgba('sepia', 0.45);
    const bm = (TREB + BASS + 4 * STAFF_GAP) / 2;
    c.beginPath(); c.moveTo(MARG - 8, TREB - 2); c.quadraticCurveTo(MARG - 20, TREB + 20, MARG - 14, bm - 12); c.quadraticCurveTo(MARG - 12, bm - 2, MARG - 22, bm);
    c.quadraticCurveTo(MARG - 12, bm + 2, MARG - 14, bm + 12); c.quadraticCurveTo(MARG - 20, BASS + 24, MARG - 8, BASS + 4 * STAFF_GAP + 2); c.stroke();
    if (!m || !this.lay) {
      // 沒有留言：譜的題詞是「給 新人」（手寫，小一點），下面是正在唱的歌詞（drawLyrics 畫），再下面一行邀請
      c.font = font(FAM_MSG, 40); c.fillStyle = rgba('sepia', 0.75);
      c.fillText(`給 ${COUPLE_ZH}`, MSG_BOX.x, MSG_BOX.y + 40);
      c.font = font(F.hei(500), 22); c.fillStyle = rgba('sepia', 0.45); c.letterSpacing = '3px';
      c.fillText(T23_INVITE, MARG + 14, LYR_Y - 10);
      c.letterSpacing = '0px';
      L.upload();
      return;
    }
    // 題詞：寫到的字；剛寫的字是訊號色的暗部，半秒後乾成墨色
    const lay = this.lay;
    c.textBaseline = 'alphabetic';
    let i = 0;
    for (const g of lay.glyphs) {
      if (g.row < 0) continue;
      const tg = this.gt[i++]!;
      if (t < tg) break;
      const wet = 1 - clamp((t - tg) / 0.5);
      c.globalAlpha = ease.outCubic(clamp((t - tg) / 0.08));
      c.font = font(FAM_MSG, g.size);
      if (g.ch === '♥') {
        drawHeart(c, g.x + g.w / 2, g.y - g.size * 0.36, Math.min(g.w, g.size * 0.8) * 0.92);
      } else {
        c.fillStyle = wet > 0 ? mixRgba('sepia', 'blood', wet) : rgba('sepia', 0.95);
        c.fillText(g.ch, g.x, g.y);
      }
    }
    c.globalAlpha = 1;
    if (t >= this.sigT) {
      c.globalAlpha = prog(t, this.sigT, this.sigT + 0.3);
      c.font = font(lay.sig.family, lay.sig.size); c.fillStyle = rgba('sepia', 0.8);
      c.fillText(lay.sig.text, lay.sig.x, lay.sig.y);
      c.globalAlpha = 1;
    }
    L.upload();
  }

  /** 每格重畫：大譜表上往左捲的音符（鋼琴彈的每一個音，播放線上的亮起來）、小節線、歌詞。 */
  private drawLyrics(t: number) {
    const L = this.lyr, c = L.ctx, { lyrics } = this.ctx;
    L.clear();
    const ink = paperInk();
    // 音高 → 譜上的位置：高音譜表最下面一條線是 E4、低音譜表是 G2，一個全音階音級半格
    const DIA = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
    const dia = (mm: number) => Math.floor(mm / 12) * 7 + DIA[mm % 12]!;
    const x0 = MARG + 24, x1 = PG.w - MARG - 6;
    const fade = (x: number) => clamp((x - x0) / 60) * clamp((x1 - x) / 60);
    // 小節線（跟著捲）
    c.strokeStyle = rgba('sepia', 0.35); c.lineWidth = 1.6;
    for (const tb of this.bars) {
      const x = PH + (tb - t) * PXS;
      if (x < x0 || x > x1) continue;
      c.globalAlpha = fade(x);
      c.beginPath(); c.moveTo(x, TREB); c.lineTo(x, BASS + 4 * STAFF_GAP); c.stroke();
    }
    c.globalAlpha = 1;
    // 音符：還沒彈的淡、正在彈的是訊號色的暗部（大一點）、彈過的墨色
    for (const n of this.notes) {
      const x = PH + (n.a - t) * PXS;
      if (x > x1 + 20) break;
      if (x < x0 - 20) continue;
      const treb = n.m >= 60;
      const bottom = (treb ? TREB : BASS) + 4 * STAFF_GAP;
      const st = dia(n.m) - (treb ? 37 : 25);
      const y = bottom - st * (STAFF_GAP / 2);
      const on = t >= n.a && t < n.r + 0.05;
      const done = t >= n.a;
      c.globalAlpha = fade(x);
      // 加線
      c.strokeStyle = rgba('sepia', 0.4); c.lineWidth = 1.4;
      for (let k = 10; k <= st; k += 2) { const ly = bottom - k * (STAFF_GAP / 2); c.beginPath(); c.moveTo(x - 11, ly); c.lineTo(x + 11, ly); c.stroke(); }
      for (let k = -2; k >= st; k -= 2) { const ly = bottom - k * (STAFF_GAP / 2); c.beginPath(); c.moveTo(x - 11, ly); c.lineTo(x + 11, ly); c.stroke(); }
      const sz = on ? 1.2 : 1;
      c.fillStyle = on ? rgba('blood') : done ? rgba('sepia', 0.8) : rgba('sepia', 0.3);
      c.save(); c.translate(x, y); c.rotate(-0.35);
      c.beginPath(); c.ellipse(0, 0, 6.6 * sz, 4.6 * sz, 0, 0, Math.PI * 2); c.fill();
      c.restore();
      c.strokeStyle = c.fillStyle; c.lineWidth = 1.6;
      c.beginPath();
      if (st < 4) { c.moveTo(x + 6, y - 1); c.lineTo(x + 6, y - 30); } else { c.moveTo(x - 6, y + 1); c.lineTo(x - 6, y + 30); }
      c.stroke();
    }
    c.globalAlpha = 1;
    // 播放線：一條細細的訊號色暗部
    c.strokeStyle = rgba('blood', 0.55); c.lineWidth = 2;
    c.beginPath(); c.moveTo(PH, TREB - 14); c.lineTo(PH, BASS + 4 * STAFF_GAP + 14); c.stroke();
    // 歌詞：有留言時在譜紙下緣（大譜表下面）；沒有留言時在題詞的位置（主角）
    if (this.hasLyr) {
      const ly = lyricAt(lyrics, t);
      if (ly) {
        const lay = this.layLine(c, ly.line);
        c.save();
        if (this.solo) c.translate(MSG_BOX.x, MSG_BOX.y + 110 + lay.size * 0.8);
        else c.translate(PG.w / 2, lay.rows.length > 1 ? LYR_Y - lay.lineHeight * 0.6 : LYR_Y);
        drawRows(c, lay, FAM_LYR, t, ink, ly.k);
        c.restore();
      }
    } else {
      c.font = font(F.serif(400, true), 24); c.fillStyle = rgba('sepia', 0.5);
      c.textAlign = 'right'; c.fillText(`♪ ${this.ctx.song.title}`, PG.w - MARG - 14, 96); c.textAlign = 'left';
    }
    L.upload();
  }

  private layLine(c: CanvasRenderingContext2D, line: Line): RowsLayout {
    return this.solo
      ? layoutRows(c, line, { family: FAM_LYR, size: this.lyrSize, minSize: V2.lyrMin * K_TOP, maxW: MSG_BOX.w + 120, maxRows: 2, align: 'left', lineHeight: 1.2 })
      : layoutRows(c, line, { family: FAM_LYR, size: this.lyrSize, minSize: Math.min(this.lyrSize, V2.lyrMin * K_BOT), maxW: PG.w - 2 * MARG - 40, maxRows: 2, align: 'center', lineHeight: 1.12 });
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const rig = this.rig, U = rig.U;
    // ---- 琴鍵
    const ks = this.keyState(t);
    rig.pose((mm) => ks.press.get(mm) ?? 0, (mm) => ks.glow.get(mm) ?? 0);
    // 鍵蓋上的倒影：最亮的 16 個鍵
    const refl = [...ks.glow.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16);
    const R = U.uRefl.value;
    for (let i = 0; i < 16; i++) { const r = refl[i]; if (r) R[i]!.set(keyX(r[0]), r[1], isBlack(r[0]) ? 0.8 : 1.3, 0); else R[i]!.set(0, 0, 1, 0); }
    U.uGlow.value = Math.min(1, refl.reduce((a, r) => a + r[1], 0) / 4);
    U.uLampI.value = 1.15 + 0.04 * f.a.kick;
    // 譜紙右上角：每兩小節（偶數小節線）掀一下
    let tb2 = -Infinity;
    for (const tb of this.bars) { if (tb > t) break; if (Math.round(this.ctx.audio.barAt(tb)) % 2 === 0) tb2 = tb; }
    const tau = t - tb2;
    U.uFlutter.value = tau < 1.5 ? Math.sin((Math.min(tau, 0.6) / 0.6) * Math.PI) * Math.exp(-tau / 0.8) : 0;
    // ---- 譜紙
    this.drawBase(t);
    this.drawLyrics(t);
    U.uBase.value = this.base.texture;
    U.uLyr.value = this.lyr.texture;
    // ---- 鏡頭：從遠一點推進來、第一拍落定；之後很慢地往前推、往右搖
    const land = ease.outExpo(prog(t, s, Math.max(s + 0.35, this.tFirst + 0.1)));
    const drift = ease.inOutQuad(clamp((t - s) / Math.max(1, e - s)));
    const cam = this.cam;
    const back = 9 * (1 - land);
    cam.position.set(lerp(-6.5, -3.5, drift), 71 + back * 0.5, 38 + back - 2.5 * drift);
    cam.lookAt(lerp(0.5, 1.5, drift), 20.5, -18);
    cam.updateMatrixWorld();
    // ---- 3D：房間 → 鋼琴（MSAA）→ 疊到 out
    // 全引擎共用的一張 MSAA：畫進去之後在這個 render() 裡就解析到 out
    const rt = sharedMSAA();
    this.room.render(renderer, rt);
    renderer.setRenderTarget(rt);
    renderer.clearDepth();
    renderer.render(rig.scene, cam);
    comp.draw(renderer, rt.texture, out, { mode: 'replace', premult: false });
    this.corner.render(renderer, out);
    return { bloom: 0.75, bloomThreshold: 0.95, vignette: 0.55, halation: 0.3, popupAvoid: this.avoid };
  }
}
