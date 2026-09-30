// 西洋棋（暗）：低角度看著一張上了亮漆的深色棋盤，一盞燈從正上方打下來，四周是暗的房間。
//  - 白色的國王與皇后在同一橫排的兩端，一拍一步往中間走；中間擋路的兩顆黑兵被吃掉、翻著滾出棋盤、躺在桌上；
//    第三拍兩顆棋子走到隔壁格相遇，中間冒出一顆愛心。
//  - 主打留言掛在棋盤後方的暗處（宋體、紙白），像房間裡的一行字；亮漆的棋盤倒映著它（還有棋子），留言因此是「在場景裡」的東西。
//    留言在第一拍後一行一行亮起來。
//  - 棋譜是歌詞：左下角一行大字逐字跟唱，上面一行小小的 mono 棋譜（1. Kb4 Qg4 · 2. K×c4 Q×f4 · 3. Kd4 Qe4 !!），走一步記一步。
//  - v2（留言尺寸標準）：留言縮到 40～60 px、放在左上角的暗處（留言區 ≤ 860×430），棋盤與棋子是主視覺。
//    相遇之後兩顆棋子每個小節線一起走一步（上、右、下、左的方塊舞步），吊燈也跟著小節很慢地擺，窗格長時中段一直有事。
//  - 鏡頭：切進來時更低、更近、偏一邊，第一拍落定；之後很慢地橫移、推近。景深：近處的棋盤是糊的（棋格的邊用
//    離焦的寬度去柔化），焦點在棋子那一排。
//  - 沒有留言：歌詞掛在棋盤後方（主角），左下角只剩棋譜與一行邀請。純音樂：左下角寫歌名。
// 手法：整個畫面是一個全螢幕 shader：每個像素打一條光線 → 桌面／棋盤（z = 0）、留言的平面（y = 常數）、每顆棋子的
// 看板（永遠面向鏡頭的直立四邊形，貼著開場畫好的棋子圖），棋盤上的點再沿反射方向打一次，得到倒影。
// 棋子的圖是 Canvas 畫的車床輪廓（Staunton 風格），受光面、背光面、輪廓光都畫在圖裡。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, pulse, hash, frameIdx } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { lyricAt, layoutLyric, drawLyric, beatAfter, drawHeart, fillWithHearts, lyricSubOf } from './_motifs';
import { msgMaxFor, lyricV2, sigV2, fitClauses } from './_v2';
import { darkInk } from './_t4';
import { sigOf, applyOrbit, lerpOrbit, camBasis, T17_INVITE, T17_TEXT, type OrbitCam } from './_t17';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'game', paper: false, energy: [0.15, 0.75], bars: [4, 8], weight: 1 };

/** 棋格大小、棋盤框寬（世界單位）。第 r 排（1..8）在 y = (r − 4.5)·S，第 f 行（a..h = 0..7）在 x = (f − 3.5)·S。 */
const S = 150, FR = 64;
/** 留言的平面：直立、面向鏡頭（落定時）的水平方向，在鏡頭對準點後方 TD 的地方；螢幕上落在 TXT 的範圍。 */
const TD = 1300;
const TXT = { x: 150, y: 110, w: 840, h: 340 };
/** 有留言又有原文的窗格：左下角的棋譜與歌詞往上挪多少（原文在中文下面多一排）。 */
const SUB_LIFT = 52;
const FAM_MSG = F.ming(700);
const FAM_SIG = F.hand(700);
const FAM_LYR = F.archivo(100, 800);
/** 棋子圖集：每格 256×320，一個世界單位 = ATL 個畫布像素。 */
const CELLW = 256, CELLH = 320, ATL = 1.1;
const NP = 6;

const fileX = (f: number) => (f - 3.5) * S;
const rankY = (r: number) => (r - 4.5) * S;

const SHADER = () => new FSPass(/* glsl */ `
  uniform vec3 camC; uniform vec3 camR; uniform vec3 camD; uniform vec3 camF; uniform float focal;
  uniform sampler2D atlas; uniform vec2 atlasPx;
  uniform vec4 pA[${NP}]; uniform vec4 pB[${NP}]; uniform vec4 pUV[${NP}];
  uniform sampler2D txt; uniform vec3 txtO; uniform vec3 txtU; uniform vec3 txtN; uniform vec2 txtS;
  uniform float focusY; uniform float lampK; uniform vec2 lampXY;
  vec4 txtAt(vec3 h) {
    vec2 uv = vec2(dot(h - txtO, txtU) / txtS.x, (h.z - txtO.z) / txtS.y);
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
    vec4 c = textureLod(txt, uv, 0.0);
    c.rgb = c.a > 0.0 ? toLinear(c.rgb / c.a) * c.a : vec3(0.0);
    return c;
  }
  // 看板：直立、面向鏡頭水平方向的四邊形；回傳預乘的顏色
  vec4 piece(vec3 o, vec3 dir, int i, float blurLod) {
    vec4 A = pA[i], B = pB[i];
    if (B.z <= 0.0) return vec4(0.0);
    vec3 n = normalize(vec3(camF.x, camF.y, 0.0));
    float dn = dot(dir, n);
    if (abs(dn) < 1e-4) return vec4(0.0);
    vec3 P0 = vec3(A.x, A.y, A.z);
    float t = dot(P0 - o, n) / dn;
    if (t <= 0.0) return vec4(0.0);
    vec3 hh = o + dir * t;
    vec3 rt = vec3(n.y, -n.x, 0.0);
    vec2 q = vec2(dot(hh - P0, rt), hh.z - A.z);
    vec2 c = vec2(0.0, B.y * 0.5);
    q = rot2(-A.w) * (q - c) + c;
    vec2 uv = vec2(q.x / B.x + 0.5, q.y / B.y);
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
    float lod = max(0.0, log2(max(1.0, ${ATL.toFixed(2)} * t / focal))) + blurLod;
    vec4 s = textureLod(atlas, pUV[i].xy + uv * pUV[i].zw, lod);
    return vec4(s.rgb * s.a, s.a) * B.z;
  }
  // 棋盤與桌面
  vec3 board(vec2 p, float soft) {
    float half_ = ${(4 * S).toFixed(1)};
    vec2 ap = abs(p);
    float inB = step(max(ap.x, ap.y), half_);
    float inF = step(max(ap.x, ap.y), half_ + ${FR.toFixed(1)});
    // 木紋
    float g = fbm(vec2(p.x / 900.0, p.y / 70.0), 3);
    float ring = sin((p.y + 90.0 * g) / 6.0);
    vec3 dark = C_INK * (0.7 + 0.25 * g) + C_BLOOD * 0.015;
    vec3 light = mix(C_INK2, C_ASH, 0.12) * (0.85 + 0.18 * g + 0.03 * ring);
    // 棋格：邊用 soft（離焦）柔化
    vec2 cc = p / ${S.toFixed(1)} + 4.0;
    vec2 fc = abs(fract(cc) - 0.5);
    float w = max(fwidth(cc.x), 0.002) + soft;
    float ck = mod(floor(cc.x) + floor(cc.y), 2.0);
    // 用距離格線的遠近做柔化的棋盤格（兩個方向）
    float ex = smoothstep(-w, w, 0.5 - fc.x), ey = smoothstep(-w, w, 0.5 - fc.y);
    float k = mix(1.0 - ck, ck, ex * ey + (1.0 - ex) * (1.0 - ey));
    vec3 col = mix(dark, light, k);
    // 框：深色木頭、內側一條訊號色的細線
    vec3 frame = C_INK * (0.55 + 0.2 * g);
    float inlay = 1.0 - smoothstep(0.6 + soft * 40.0, 1.6 + soft * 40.0, abs(max(ap.x, ap.y) - half_ - 10.0));
    frame += mix(C_BLOOD, C_SIGNAL, 0.4) * 0.5 * inlay;
    col = mix(frame, col, inB);
    // 桌面：更暗的木頭
    vec3 table = C_INK2 * (0.5 + 0.2 * fbm(vec2(p.x / 1500.0, p.y / 120.0), 3));
    col = mix(table, col, inF);
    return col;
  }
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 d = normalize(camF * focal + camR * (sp.x - ${W / 2}.0) + camD * (sp.y - ${H / 2}.0));
    // 房間：暗，地平線附近一點點暖的霧
    float hz = d.z;
    vec3 room = C_INK * (0.4 + 0.2 * smoothstep(0.3, -0.05, hz)) + C_BLOOD * 0.03 * exp(-abs(hz) * 14.0);
    vec3 col = room;
    float tB = d.z < -1e-4 ? -camC.z / d.z : 1e9;
    float tT = dot(txtO - camC, txtN) / dot(d, txtN);
    if (tB < 1e8) {
      vec3 Bp = camC + d * tB;
      // 景深：焦點那一排清楚，越往近處越糊（遠處只糊一點）
      float dy = Bp.y - focusY;
      float soft = dy < 0.0 ? clamp(-dy / 2600.0, 0.0, 0.08) : clamp(dy / 9000.0, 0.0, 0.03);
      vec3 bc = board(Bp.xy, soft);
      // 燈：正上方的光池
      float r = length(Bp.xy - lampXY) / 1000.0;
      bc *= 0.35 + 0.95 * exp(-r * r) * lampK;
      // 接觸影子
      for (int i = 0; i < ${NP}; i++) {
        vec4 A = pA[i], Bq = pB[i];
        if (Bq.z <= 0.0 || Bq.w < 0.5) continue;
        vec2 q = (Bp.xy - A.xy) / vec2(Bq.x * 0.55, Bq.x * 0.4);
        float hgt = max(A.z, 0.0);
        bc *= 1.0 - 0.55 * Bq.z * exp(-dot(q, q) * 1.6) / (1.0 + hgt / 60.0);
      }
      // 亮漆：倒影（留言、棋子）與燈的反光，掠射角越斜反射越多
      vec3 rd = vec3(d.x, d.y, -d.z);
      float fres = 0.05 + 0.5 * pow(1.0 - clamp(-d.z, 0.0, 1.0), 4.0);
      float inBoard = step(max(abs(Bp.x), abs(Bp.y)), ${(4 * S + FR).toFixed(1)});
      vec3 refl = vec3(0.0);
      float tT2 = dot(txtO - Bp, txtN) / dot(rd, txtN);
      if (tT2 > 0.0) {
        vec3 hh = Bp + rd * tT2;
        // 倒影要糊、要淡（配角）：在字的平面上取幾個點平均
        vec4 a = txtAt(hh + vec3(9.0, 0.0, 5.0)), b = txtAt(hh - vec3(9.0, 0.0, 5.0)), c2 = txtAt(hh + vec3(-6.0, 0.0, 12.0)), d2 = txtAt(hh + vec3(6.0, 0.0, -12.0));
        refl += (a.rgb + b.rgb + c2.rgb + d2.rgb) * 0.25 * 0.06;
      }
      for (int i = 0; i < ${NP}; i++) {
        // 離棋盤越高的東西倒影越淡：飄在上面的愛心倒影會落在畫面左下、正好在歌詞後面，淡掉才不會跟歌詞搶
        vec4 pc = piece(Bp, rd, i, 1.2) * clamp(1.0 - pA[i].z / 200.0, 0.0, 1.0);
        refl = refl * (1.0 - pc.a) + pc.rgb;
      }
      bc += refl * fres * 1.6 * inBoard;
      // 燈在漆面上的反光：遠處棋盤上一片很淡的亮
      float spec = exp(-pow((Bp.y - 420.0) / 380.0, 2.0) - pow(Bp.x / 520.0, 2.0));
      bc += C_BONE * 0.05 * spec * inBoard * lampK;
      // 很遠的桌面沒入房間的暗處（跟上面的房間接起來，不要有一條地平線）
      bc = mix(bc, room, smoothstep(1800.0, 4200.0, length(Bp.xy)));
      col = bc;
    }
    // 留言的平面（在桌面前面才畫）
    if (tT > 0.0 && tT < tB) { vec4 tc = txtAt(camC + d * tT); col = col * (1.0 - tc.a) + tc.rgb; }
    // 棋子（從遠到近，已經在 JS 排好）
    for (int i = 0; i < ${NP}; i++) {
      vec4 pc = piece(camC, d, i, 0.0);
      col = col * (1.0 - pc.a) + pc.rgb;
    }
    fragColor = vec4(col, 1.0);
  }`, {
  camC: { value: new THREE.Vector3() }, camR: { value: new THREE.Vector3() }, camD: { value: new THREE.Vector3() }, camF: { value: new THREE.Vector3() }, focal: { value: 1000 },
  atlas: { value: null }, atlasPx: { value: new THREE.Vector2(1, 1) },
  pA: { value: Array.from({ length: NP }, () => new THREE.Vector4()) },
  pB: { value: Array.from({ length: NP }, () => new THREE.Vector4()) },
  pUV: { value: Array.from({ length: NP }, () => new THREE.Vector4()) },
  txt: { value: null }, txtO: { value: new THREE.Vector3() }, txtU: { value: new THREE.Vector3(1, 0, 0) }, txtN: { value: new THREE.Vector3(0, 1, 0) }, txtS: { value: new THREE.Vector2(1, 1) },
  focusY: { value: 0 }, lampK: { value: 1 }, lampXY: { value: new THREE.Vector2(0, 80) },
});

// ---------------------------------------------------------------- 棋子的圖（車床輪廓）
type Prof = [number, number][];
/** 輪廓：[高度, 半徑]（世界單位，從底部往上）。 */
const PAWN: Prof = [[0, 46], [9, 46], [13, 40], [17, 42], [24, 31], [40, 22], [62, 15], [70, 22], [75, 22], [80, 14]];
const QUEEN: Prof = [[0, 54], [10, 54], [15, 46], [20, 49], [28, 37], [60, 24], [120, 15], [132, 26], [138, 26], [146, 17], [172, 21], [184, 30]];
const KING: Prof = [[0, 56], [10, 56], [15, 48], [20, 51], [28, 39], [62, 25], [132, 16], [144, 28], [150, 28], [158, 18], [186, 22], [196, 27], [200, 18]];

interface Sprite { u0: number; v0: number; du: number; dv: number; w: number; h: number }

/** 在圖集的一格裡畫一顆棋子：左邊受光、右邊背光、右緣一條暖色的輪廓光；每個環的地方畫一圈橢圓（稍微俯看）。 */
function drawPiece(c: CanvasRenderingContext2D, ox: number, oy: number, prof: Prof, top: 'pawn' | 'queen' | 'king', ivory: boolean): Sprite {
  const hMax = top === 'pawn' ? 108 : top === 'queen' ? 226 : 250;
  const wMax = 2 * Math.max(...prof.map((p) => p[1])) + 16;
  const k = ATL;
  const bx = ox + CELLW / 2, by = oy + CELLH - 14;
  const X = (r: number) => r * k, Y = (z: number) => by - z * k;
  const pal = ivory
    ? [mixRgba('bone', 'paper', 0.3), rgba('bone'), mixRgba('bone', 'ash', 0.55), mixRgba('ash', 'graphite', 0.6), mixRgba('graphite', 'ink2', 0.5)]
    : [rgba('graphite'), mixRgba('graphite', 'ink2', 0.5), rgba('ink2'), mixRgba('ink2', 'ink', 0.5), rgba('ink')];
  const grad = (x0: number, x1: number) => {
    const g = c.createLinearGradient(bx + x0, 0, bx + x1, 0);
    g.addColorStop(0, pal[2]!); g.addColorStop(0.18, pal[0]!); g.addColorStop(0.38, pal[1]!); g.addColorStop(0.7, pal[3]!); g.addColorStop(1, pal[4]!);
    return g;
  };
  // 身體：左右對稱的輪廓
  c.beginPath();
  c.moveTo(bx - X(prof[0]![1]), Y(0));
  for (const [z, r] of prof) c.lineTo(bx - X(r), Y(z));
  for (let i = prof.length - 1; i >= 0; i--) c.lineTo(bx + X(prof[i]![1]), Y(prof[i]![0]));
  c.closePath();
  const R = Math.max(...prof.map((p) => p[1]));
  c.fillStyle = grad(-X(R), X(R));
  c.fill();
  // 環：輪廓轉折的地方畫橢圓的上緣（亮）與下緣（暗）
  c.lineWidth = 1.4;
  for (let i = 1; i < prof.length - 1; i++) {
    const [z, r] = prof[i]!;
    const [, r0] = prof[i - 1]!, [, r1] = prof[i + 1]!;
    if (!((r >= r0 && r >= r1) || (r <= r0 && r <= r1))) continue;
    c.strokeStyle = ivory ? rgba('ink', 0.18) : rgba('ink', 0.5);
    c.beginPath(); c.ellipse(bx, Y(z), X(r), X(r) * 0.16, 0, 0, Math.PI); c.stroke();
    c.strokeStyle = ivory ? rgba('bone', 0.5) : rgba('ash', 0.3);
    c.beginPath(); c.ellipse(bx, Y(z) - 1.5, X(r) * 0.9, X(r) * 0.14, 0, Math.PI * 1.1, Math.PI * 1.6); c.stroke();
  }
  // 頭：兵是一顆球；皇后是一圈小珠的冠＋頂上的球；國王是冠＋十字
  const topZ = prof[prof.length - 1]![0];
  const ball = (cz: number, r: number) => {
    const g = c.createRadialGradient(bx - X(r) * 0.35, Y(cz) - X(r) * 0.4, X(r) * 0.1, bx, Y(cz), X(r) * 1.05);
    g.addColorStop(0, pal[0]!); g.addColorStop(0.45, pal[1]!); g.addColorStop(0.85, pal[3]!); g.addColorStop(1, pal[4]!);
    c.fillStyle = g; c.beginPath(); c.arc(bx, Y(cz), X(r), 0, Math.PI * 2); c.fill();
  };
  if (top === 'pawn') ball(topZ + 14, 23);
  if (top === 'queen') {
    // 冠：往外開的杯子，邊上一排小珠
    c.beginPath();
    c.moveTo(bx - X(21), Y(topZ - 10)); c.lineTo(bx - X(32), Y(topZ + 18)); c.lineTo(bx + X(32), Y(topZ + 18)); c.lineTo(bx + X(21), Y(topZ - 10)); c.closePath();
    c.fillStyle = grad(-X(32), X(32)); c.fill();
    for (let i = -3; i <= 3; i++) { c.save(); c.translate(X(i * 9.2), 0); ball(topZ + 22, 5); c.restore(); }
    ball(topZ + 34, 10);
  }
  if (top === 'king') {
    c.beginPath();
    c.moveTo(bx - X(18), Y(topZ - 6)); c.lineTo(bx - X(30), Y(topZ + 16)); c.lineTo(bx + X(30), Y(topZ + 16)); c.lineTo(bx + X(18), Y(topZ - 6)); c.closePath();
    c.fillStyle = grad(-X(30), X(30)); c.fill();
    c.fillStyle = grad(-X(8), X(8));
    c.fillRect(bx - X(4.5), Y(topZ + 48), X(9), X(32));
    c.fillRect(bx - X(14), Y(topZ + 38), X(28), X(9));
  }
  // 輪廓光：右緣一條暖色的細光（背後有光，棋子才從黑暗裡分出來）
  c.save();
  c.globalCompositeOperation = 'source-atop';
  const rim = c.createLinearGradient(bx + X(R) * 0.55, 0, bx + X(R) + 4, 0);
  rim.addColorStop(0, 'rgba(0,0,0,0)'); rim.addColorStop(1, rgba('signal', ivory ? 0.35 : 0.5));
  c.fillStyle = rim; c.fillRect(bx, oy, CELLW / 2, CELLH);
  c.restore();
  return { u0: 0, v0: 0, du: 0, dv: 0, w: Math.max(wMax, 80), h: hMax };
}

interface PieceState { sp: number; x: number; y: number; z: number; rot: number; vis: number; shadow: number }

export default class Chess extends Scene {
  pass = shared('chess.scene', SHADER);
  txt!: Layer2D;
  ovl = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = Number(this.ctx.params.seed ?? 1);
  atlasCv: HTMLCanvasElement | null = null;
  atlasTex: THREE.CanvasTexture | null = null;
  sprites: Sprite[] = [];
  fit: FitResult | null = null;
  sig = '';
  lyrSize = 56;
  t1 = 0; B = 0.5;
  moveT: number[] = [];
  /** 相遇之後的舞步（每個小節線一步）。 */
  danceT: number[] = [];
  sigSize = 30;
  lineT: number[] = [];
  txtKey = '';
  camA!: OrbitCam; camB!: OrbitCam;
  txtO = new THREE.Vector3(); txtU = new THREE.Vector3(1, 0, 0); txtN = new THREE.Vector3(0, 1, 0); txtS = new THREE.Vector2(1, 1);
  cam = new THREE.PerspectiveCamera(30, W / H, 10, 40000);
  notation: string[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.sig = sigOf(m);
    this.notation = ['1. Kb4 Qg4', '2. K×c4 Q×f4', '3. Kd4 Qe4 !!'];
    await loadText(`${m?.text ?? ''}${this.sig}${T17_TEXT}${T17_INVITE}${song.title}${song.artist}♪${this.notation.join('')}${lyrics.linesIn(s - 2, e + 1).map((l) => l.text).join('')}`);
    const B = (this.B = au.beatPeriod(s + 0.1));

    // ---- 棋子的圖集：國王、皇后、兵、愛心（白棋是象牙色，黑兵是烏木）
    const cv = (this.atlasCv = document.createElement('canvas'));
    cv.width = CELLW * 4; cv.height = CELLH;
    const c = cv.getContext('2d')!;
    const put = (i: number, sp: Sprite) => {
      sp.u0 = (i * CELLW) / cv.width; sp.v0 = 0; sp.du = CELLW / cv.width; sp.dv = 1;
      // 圖集的一格代表 CELLW/ATL × CELLH/ATL 的世界單位（棋子站在格子底部往上 14 px）
      sp.w = CELLW / ATL; sp.h = CELLH / ATL;
      this.sprites[i] = sp;
    };
    put(0, drawPiece(c, 0, 0, KING, 'king', true));
    put(1, drawPiece(c, CELLW, 0, QUEEN, 'queen', true));
    put(2, drawPiece(c, CELLW * 2, 0, PAWN, 'pawn', false));
    drawHeart(c, CELLW * 3.5, CELLH * 0.55, 150, rgba('rose'));
    put(3, { u0: 0, v0: 0, du: 0, dv: 0, w: 0, h: 0 });
    const tx = (this.atlasTex = new THREE.CanvasTexture(cv));
    tx.colorSpace = THREE.SRGBColorSpace;
    tx.generateMipmaps = true;
    tx.minFilter = THREE.LinearMipmapLinearFilter;
    tx.needsUpdate = true;

    // ---- 鏡頭：低角度、看著棋盤中間偏後；進場更低、更近、偏右一點
    // 斜斜地看棋盤（棋盤轉了一個角度）：近角在畫面下方，右下角（QR 那一塊）是空的桌面，不是棋盤
    this.camB = { tx: 60, ty: 270, tz: 150, dist: 2500, az: 0.62, el: 0.21, fov: 30 };
    this.camA = { ...this.camB, dist: 2000, el: 0.14, az: 0.35, tz: 110, roll: 0.03 };
    // 留言的平面：直立、面向鏡頭，把螢幕上的範圍（鏡頭落定時）投到這個平面上
    applyOrbit(this.cam, this.camB);
    const bs = camBasis(this.cam);
    const n = new THREE.Vector3(bs.F.x, bs.F.y, 0).normalize();
    const u = new THREE.Vector3(n.y, -n.x, 0);
    const P0 = new THREE.Vector3(this.camB.tx, this.camB.ty, 0).addScaledVector(n, TD);
    const unproj = (sx: number, sy: number) => {
      const dv = bs.F.clone().multiplyScalar(bs.f).addScaledVector(bs.R, sx - W / 2).addScaledVector(bs.D, sy - H / 2);
      const tt = P0.clone().sub(bs.C).dot(n) / dv.dot(n);
      return bs.C.clone().addScaledVector(dv, tt);
    };
    const p0 = unproj(TXT.x, TXT.y + TXT.h), p1 = unproj(TXT.x + TXT.w, TXT.y);
    this.txtO.copy(p0); this.txtU.copy(u); this.txtN.copy(n);
    this.txtS.set(p1.clone().sub(p0).dot(u), p1.z - p0.z);
    this.txt = this.track(new Layer2D(TXT.w, TXT.h, 1.25, { fast: true }));

    // ---- 留言（在平面的畫布上，畫布像素 ≈ 螢幕像素）
    const tc = this.txt.ctx;
    if (m) {
      // v2：字級上限依字數（40～60），照子句斷行；署名 26～32、永遠在最後一行下面
      const max = msgMaxFor(m.text);
      const o = { min: 40, max, lineHeight: 1.3, maxLines: 6 };
      const boxH = TXT.h - 34 * 1.7;
      this.fit = fitClauses(tc, m.text, FAM_MSG, TXT.w - 20, boxH, o) ?? fitText(tc, m.text, FAM_MSG, TXT.w - 20, boxH, o);
      this.sigSize = sigV2(this.fit.size);
      this.lyrSize = lyricV2(this.fit.size);
    } else this.lyrSize = lyricV2(null);
    this.t1 = beatAfter(au, s + Math.min(0.3, B * 0.6));
    const nl = this.fit ? this.fit.lines.length : 0;
    this.lineT = Array.from({ length: nl + 1 }, (_, i) => this.t1 + (i * B) / 2);
    // 走棋：一拍一步，三步
    this.moveT = [0, 1, 2].map((i) => au.timeOfBeat(au.beatAt(this.t1) + i));
    // 相遇之後：每個小節線兩顆棋子一起走一步（窗格結束前半小節不再走）
    const bar = au.timeOfBar(au.barAt(this.t1) + 1) - au.timeOfBar(au.barAt(this.t1));
    for (let k = Math.ceil(au.barAt(this.moveT[2]! + B * 1.5) - 1e-6); ; k++) {
      const tb = au.timeOfBar(k);
      if (tb > e - bar * 0.5 || this.danceT.length > 16) break;
      this.danceT.push(tb);
    }
    // 舞步也記進棋譜（國王從 d4、皇后從 e4 出發）
    const BOXN: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    let kf = 3, rk = 4;
    this.danceT.forEach((_, i) => {
      kf += BOXN[i % 4]![0]; rk += BOXN[i % 4]![1];
      this.notation.push(`${4 + i}. K${'abcdefgh'[kf]}${rk} Q${'abcdefgh'[kf + 1]}${rk}`);
    });
  }

  override dispose() {
    this.atlasTex?.dispose();
    if (this.atlasCv) this.atlasCv.width = this.atlasCv.height = 0;
    super.dispose();
  }

  /** 棋子在時間 t 的狀態：國王、皇后一拍一格滑過去（中間跳一下），兵被吃的時候翻著飛出棋盤、躺在桌上。 */
  private states(t: number): PieceState[] {
    const mv = (k: number) => ease.outExpo(prog(t, this.moveT[k]!, this.moveT[k]! + 0.3));
    const hop = (k: number) => Math.sin(Math.PI * prog(t, this.moveT[k]!, this.moveT[k]! + 0.3));
    const steps = mv(0) + mv(1) + mv(2);
    let hops = hop(0) + hop(1) + hop(2);
    // 方塊舞步：上、右、下、左（兩顆一起，永遠在棋盤中間那一塊）
    const BOX: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    let dx = 0, dy = 0;
    this.danceT.forEach((tt, i) => {
      const k = ease.outExpo(prog(t, tt, tt + 0.36));
      dx += BOX[i % 4]![0] * k; dy += BOX[i % 4]![1] * k;
      hops += Math.sin(Math.PI * prog(t, tt, tt + 0.36));
    });
    const r4 = rankY(4) + dy * S;
    const out: PieceState[] = [];
    out.push({ sp: 0, x: fileX(0) + steps * S + dx * S, y: r4, z: hops * 14, rot: 0, vis: 1, shadow: 1 });
    out.push({ sp: 1, x: fileX(7) - steps * S + dx * S, y: r4, z: hops * 14, rot: 0, vis: 1, shadow: 1 });
    // 兵：c4、f4，第二步被吃
    const tc = this.moveT[1]! + 0.12;
    for (const [f, dir] of [[2, -1], [5, 1]] as const) {
      const u = clamp((t - tc) / 0.65);
      const k = ease.outCubic(u);
      const sp = this.sprites[2]!;
      const lieZ = 46 - sp.h / 2 + 14 / ATL;
      const x = fileX(f) + dir * (S * 3.2 + 60) * k;
      const y = rankY(4) + dir * 60 * k;
      // 看板繞圖的中心轉：躺平時中心離桌面約一個兵的半徑，所以四邊形的底要往下移（lieZ 是負的）
      const z = u <= 0 ? 0 : 320 * u * (1 - u) * 1.6 + lieZ * ease.inQuad(u);
      out.push({ sp: 2, x, y, z, rot: dir * (Math.PI / 2) * ease.outCubic(u), vis: 1, shadow: 1 });
    }
    // 愛心：兩顆棋子相遇之後在中間冒出來、往上飄一點停住
    const tm = this.moveT[2]! + 0.3;
    const hk = ease.outBack(clamp((t - tm) / 0.4), 2.2);
    // 跳舞時愛心跟著兩顆棋子，每一步輕輕跳一下
    const bob = this.danceT.reduce((a, tt) => a + 18 * Math.sin(Math.PI * prog(t, tt, tt + 0.36)), 0);
    out.push({ sp: 3, x: dx * S, y: r4 - 10, z: 210 + 50 * ease.outCubic(clamp((t - tm) / 0.8)) + bob, rot: 0, vis: t >= tm ? hk : 0, shadow: 0 });
    return out;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const m = this.msg;

    // ---- 留言的畫布（一行一行亮起來的那幾格才重畫）
    const alphas = this.lineT.map((tt) => ease.outCubic(prog(t, tt, tt + 0.3)));
    const key = alphas.map((a) => a.toFixed(3)).join(',');
    if (key !== this.txtKey) {
      this.txtKey = key;
      const L = this.txt;
      L.clear();
      const c = L.ctx;
      if (m && this.fit) {
        const fit = this.fit;
        const sigSize = this.sigSize;
        // 留言靠左上（畫面一側），署名在最後一行下面、靠右對齊留言的右緣
        const y0 = 10 + fit.size * 0.88;
        c.font = font(FAM_MSG, fit.size);
        fit.lines.forEach((ln, i) => {
          const a = alphas[i]!;
          if (a <= 0) return;
          c.globalAlpha = a;
          c.fillStyle = rgba('bone', 0.95);
          fillWithHearts(c, ln, 10, y0 + i * fit.lineHeight);
        });
        const a = alphas[alphas.length - 1]!;
        if (a > 0) {
          c.globalAlpha = a;
          c.fillStyle = rgba('signal', 0.9);
          c.font = font(FAM_SIG, sigSize);
          c.textAlign = 'right';
          c.fillText(this.sig, 10 + Math.max(fit.width, 360), y0 + (fit.lines.length - 1) * fit.lineHeight + sigSize * 1.7);
          c.textAlign = 'left';
        }
        c.globalAlpha = 1;
      }
    }
    // 沒有留言：歌詞掛在棋盤後方（每格重畫）
    if (!m) {
      const L = this.txt;
      L.clear();
      this.drawLyricBig(L.ctx, t);
    }

    // ---- 鏡頭
    const land = ease.outExpo(prog(t, s, this.t1 + this.B * 0.5));
    let cam = lerpOrbit(this.camA, this.camB, land);
    const drift = ease.inOutQuad(prog(t, this.t1, e));
    cam = { ...cam, az: cam.az + 0.05 * drift, dist: cam.dist * (1 - 0.04 * drift) };
    applyOrbit(this.cam, cam);
    const bs = camBasis(this.cam);

    // ---- 棋子：從遠到近排好
    const st = this.states(t);
    const dist = (p: PieceState) => (p.x - bs.C.x) ** 2 + (p.y - bs.C.y) ** 2;
    st.sort((a, b) => dist(b) - dist(a));
    const P = this.pass;
    const pA = P.u.pA!.value as THREE.Vector4[], pB = P.u.pB!.value as THREE.Vector4[], pUV = P.u.pUV!.value as THREE.Vector4[];
    for (let i = 0; i < NP; i++) {
      const p = st[i];
      if (!p) { pB[i]!.set(1, 1, 0, 0); continue; }
      const sp = this.sprites[p.sp]!;
      const sc = p.sp === 3 ? 0.55 * Math.max(p.vis, 0.001) : 1;
      pA[i]!.set(p.x, p.y, p.z - (14 / ATL) * sc, p.rot);
      pB[i]!.set(sp.w * sc, sp.h * sc, p.sp === 3 ? (p.vis > 0 ? 1 : 0) : p.vis, p.shadow);
      pUV[i]!.set(sp.u0, sp.v0, sp.du, sp.dv);
    }
    (P.u.camC!.value as THREE.Vector3).copy(bs.C);
    (P.u.camR!.value as THREE.Vector3).copy(bs.R);
    (P.u.camD!.value as THREE.Vector3).copy(bs.D);
    (P.u.camF!.value as THREE.Vector3).copy(bs.F);
    P.u.focal!.value = bs.f;
    P.u.atlas!.value = this.atlasTex;
    P.u.txt!.value = this.txt.upload();
    (P.u.txtO!.value as THREE.Vector3).copy(this.txtO);
    (P.u.txtU!.value as THREE.Vector3).copy(this.txtU);
    (P.u.txtN!.value as THREE.Vector3).copy(this.txtN);
    (P.u.txtS!.value as THREE.Vector2).copy(this.txtS);
    P.u.focusY!.value = rankY(4);
    // 燈：第一拍亮起來（切進來時暗一點）；吊燈很慢地擺（四小節一個來回），光池跟著在棋盤上移動
    P.u.lampK!.value = 0.75 + 0.25 * land + 0.08 * pulse(t, this.moveT[2]! + 0.3, 0.25);
    const ph4 = (f.bar / 4) * Math.PI * 2;
    (P.u.lampXY!.value as THREE.Vector2).set(150 * Math.sin(ph4), 80 + 40 * Math.cos(ph4));
    P.render(renderer, out);

    // ---- 左下角：棋譜（小）＋歌詞
    const O = this.ovl;
    O.clear();
    this.drawBottom(O.ctx, t);
    comp.draw(renderer, O.upload(), out);

    let amp = 0;
    for (const tt of this.moveT) amp += 2.2 * pulse(t, tt + 0.28, 0.05);
    for (const tt of this.danceT) amp += 1.4 * pulse(t, tt + 0.3, 0.05);
    const ph = frameIdx(t);
    return { bloom: 0.5, bloomThreshold: 1.1, halation: 0.1, vignette: 0.5, grain: 0.06, shake: [amp * (hash(ph, 1) - 0.5) * 2, amp * (hash(ph, 2) - 0.5) * 2] };
  }

  /** 左下角：一行小小的棋譜（走一步記一步），下面是跟唱的歌詞（沒有留言時歌詞在後方，這裡只剩邀請）。 */
  private drawBottom(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    // 雙語（2026-09-30）：有原文的窗格整組（棋譜、歌詞）往上挪 SUB_LIFT，原文最後一排的字腳離畫面下緣 ≥ 96 px
    const lift = this.msg && this.ctx.lyrics.linesIn(this.ctx.start - 1, this.ctx.end + 1).some((l) => lyricSubOf(l)) ? SUB_LIFT : 0;
    const x = 150, base = 968 - lift;
    const moves = this.moveT.filter((tt) => t >= tt + 0.2).length + this.danceT.filter((tt) => t >= tt + 0.2).length;
    c.fillStyle = rgba('ash', 0.75);
    c.font = font(F.mono(500), 20);
    c.letterSpacing = '2px';
    // 棋譜只留最後三步（配角，小小一行）
    const notes = this.notation.slice(0, moves).slice(-3).join('   ');
    const yN = this.msg ? base - this.lyrSize * 1.25 : base;
    if (notes) c.fillText(notes, x, yN);
    c.letterSpacing = '0px';
    if (!this.msg) {
      c.fillStyle = rgba('ash', 0.6);
      c.font = font(F.hei(500), 20);
      c.letterSpacing = '3px';
      c.fillText(T17_INVITE, x, yN - 40);
      c.letterSpacing = '0px';
      return;
    }
    if (!lyrics.has) {
      c.fillStyle = rgba('ash', 0.85);
      c.font = font(F.mono(500), 24);
      c.letterSpacing = '5px';
      c.fillText(`♪ ${song.title}`, x, base);
      c.letterSpacing = '0px';
      return;
    }
    const ly = lyricAt(lyrics, t);
    if (!ly) return;
    const ink = darkInk();
    const st = { family: FAM_LYR, size: this.lyrSize, minSize: 40, maxWidth: 1150, active: ink.active, sung: ink.sung, unsung: ink.unsung, lineHeight: 1.1 };
    const lay = layoutLyric(c, ly.line, st);
    c.save();
    c.translate(x, base - (lay.rows.length - 1) * lay.size * 1.1);
    drawLyric(c, ly.line, t, st, lay, ly.k);
    c.restore();
  }

  /** 沒有留言：歌詞大大地掛在棋盤後方（主角）；純音樂寫歌名。 */
  private drawLyricBig(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    if (!lyrics.has) {
      c.fillStyle = rgba('bone', 0.85);
      c.font = font(FAM_LYR, this.lyrSize);
      c.fillText(song.title, 10, 40 + this.lyrSize * 0.86, TXT.w - 20);
      return;
    }
    const ly = lyricAt(lyrics, t);
    if (!ly) return;
    const ink = darkInk();
    const st = { family: FAM_LYR, size: this.lyrSize, minSize: 40, maxWidth: TXT.w - 20, active: ink.active, sung: ink.sung, unsung: ink.unsung, lineHeight: 1.12 };
    const lay = layoutLyric(c, ly.line, st);
    c.save();
    c.translate(10, 40 + lay.size * 0.86);
    drawLyric(c, ly.line, t, st, lay, ly.k);
    c.restore();
  }
}
