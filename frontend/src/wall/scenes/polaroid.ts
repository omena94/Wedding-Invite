// 拍立得（亮）：亞麻桌布上，一台拍立得相機在畫面上緣（離鏡頭近、糊的前景）。拍點上馬達「嗡、嗡、嗡」三下，
// 相片一段一段從出片口吐出來、滑進畫面；小節線上相機被拿走，相片落到桌上（彈一下）。
// 相片正在顯影：一開始是一片灰濛濛的藥膜，最深的線條先浮出來、顏色最後才飽和——顯影出來的是一張手繪線條小插畫
// （兩杯咖啡冒著愛心形的煙／海邊的夕陽與小帆船／星空下亮著窗的小房子，每次不一樣），不是照片。
// 相片落地後的下一拍，一支馬克筆在寬寬的白邊上一個字一個字寫下主打留言，最後簽名。
//  - 一個焦點：白邊上的手寫留言。歌詞是相片右邊的一條壓字標籤帶（深色帶子上凸起的字，逐字跟唱：正在唱的字是訊號色）。
//  - 沒有留言：白邊寫「把你的祝福，寫在這裡」（邀請）；純音樂又沒有留言：標籤帶是新人的名字。
// v2（留言尺寸標準 v2）：留言那張相片放在畫面左邊（相片是道具，可以大；白邊上的留言 40～60 px，留言區約 510 × 270），
// 右上是一堆今晚拍的拍立得：開場就有一張，之後每兩個小節線又有一張剛吐出來的被丟到那一堆上（落地彈一下），
// 在畫面上從灰濛濛的藥膜慢慢顯影——畫面一直有東西在「長出來」。標籤帶的歌詞 40～52 px，不比留言大。右下角（HUD）是空的桌布。
//  - 鏡頭：開場斜斜地看著相機吐片，相片落地後轉成俯看全景、慢慢推近；景深對在白邊與標籤帶，右上那一堆稍微糊。
// 手法：three.js 的「桌上的紙」舞台（_t4 Stage）：相機是幾個方塊與圓柱（程序上色），相片與標籤帶是平面；
// 相片每格用一個 shader 畫進 render target（插畫畫布＋顯影進度＋白邊＋馬克筆的字），標籤帶是 Canvas 合成進 render target。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, makeRT } from '../engine/gl';
import { F, font, layout } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, mulberry32, pulse, lerp } from '../engine/util';
import { Lyrics, type Line } from '../engine/lyrics';
import { lyricAt, drawHeart, COUPLE_ZH, DATE_DOTS, lyricSubOf, subSizeFor } from './_motifs';
import { grid, layoutRows, Stage, camDist, type Grid, type V3 } from './_t4';
import { loadAll, t21Grain, GRAIN_GLSL, block, glyphPath, type Block, type Rect } from './_t21';
import { V2, lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'print', paper: true, energy: [0.1, 0.8], bars: [4, 8], weight: 1 };

/** 相片（紙面 px）：影像 520×520 在 (40, 40)，下面是寬寬的白邊（寫字的地方）。右上那一堆的解析度低一點（在焦外）。 */
const PW = 600, PH = 880, IMG = { x: 40, y: 40, s: 520 }, RES = 1.5, RES_X = 0.6;
const MSG_BOX = { x: 32, y: 580, w: 536, h: 284 };
/** 留言那張相片落定的位置（世界座標，相片中心）與角度。 */
const MAIN = { x: -540, y: 30, rot: -0.03 };
/** 標籤帶（紙面 px）：一條一行，長的歌詞用兩條；貼在相片右邊、靠上（開場的鏡頭與全景都看得到，也離 HUD 遠）。 */
const TW = 560, TH = 84;
const TAPE = [{ x: -200 + TW / 2, y: 330 }, { x: -172 + TW / 2, y: 236 }];
/** 韓文原文副行的帶子（窄一點；長的原文一樣折成兩條）：貼在最後一條中文的正下方，跟上下兩條一樣錯開一點點。 */
const TH_SUB = 62;
/**
 * 散在桌上的其他拍立得：第一張開場就在（右上）；之後的一張一張丟上來——留言那張的右下（一角塞在它底下、下緣出血到畫面外）、
 * 右邊、最右邊。都不蓋到標籤帶；右下角 HUD 底下要是乾淨的桌布（init() 再用鏡頭檢查一次，壓到就往左上收）。
 */
const PILE = [
  { x: 880, y: 430, rot: 0.28 }, { x: -40, y: -380, rot: -0.22 }, { x: 740, y: 190, rot: 0.12 }, { x: 1180, y: 240, rot: -0.3 },
];
/** HUD 的範圍（x ≥ 1360、y ≥ 830）再往外留一點（相片的影子、推近時的晃動）。 */
const HUD_CLEAR = { x: 1320, y: 790 };
const FAM = F.hand(700);
const FAM_TAPE = F.hei(900);
/** 沒有留言：白邊上寫一句邀請（空白的相片等著你來寫），署名的位置寫怎麼做。 */
const INVITE_BORDER = '把你的祝福，寫在這裡', INVITE_SIG = '掃描右下角 QR code';

const DEVELOP = () => new FSPass(/* glsl */ `
  ${GRAIN_GLSL}
  uniform sampler2D ill; uniform sampler2D ink; uniform vec2 size; uniform float dev; uniform float t; uniform vec4 img;
  void main() {
    vec2 p = vec2(vUv.x, 1.0 - vUv.y) * size;
    vec4 gr = paperGrain(p * 2.0);
    // 白邊：相紙的白（比紙白暗一點點，不刺眼）、一點點紋理
    vec3 border = mix(C_BONE, C_PAPER, 0.3) * (0.975 + 0.02 * gr.b + 0.01 * gr.r);
    vec3 col = border;
    vec2 q = (p - img.xy) / img.zw;
    if (q.x > 0.0 && q.y > 0.0 && q.x < 1.0 && q.y < 1.0) {
      vec3 im = texture(ill, vec2(q.x, 1.0 - q.y)).rgb;
      float L = luma(im);
      // 顯影：最深的地方先出來、顏色最後才飽和；藥膜不均勻（上面先、斑駁）
      float n = 0.5 + 0.5 * snoise(q * 3.0 + 7.0);
      float k = smoothstep(0.0, 1.0, dev * 1.5 - L * 0.55 - (1.0 - q.y) * 0.08 + (n - 0.5) * 0.25);
      vec3 grey = vec3(L);
      vec3 imd = mix(grey, im, smoothstep(0.45, 1.0, dev));
      vec3 murk = mix(C_GRAPHITE, C_ASH, 0.35) * (0.8 + 0.1 * n);
      col = mix(murk, imd, k);
      // 影像的四邊暗一點（化學藥劑的邊）
      vec2 e = min(q, 1.0 - q);
      col *= 0.9 + 0.1 * smoothstep(0.0, 0.05, min(e.x, e.y));
      // 相紙表面的光澤：一道斜的反光
      col += C_BONE * 0.05 * exp(-pow((q.x + q.y - 0.8) / 0.12, 2.0));
    }
    // 馬克筆的字（Canvas）
    vec4 m = fastLayer(texture(ink, vUv));
    col = col * (1.0 - m.a) + m.rgb;
    fragColor = vec4(col, 1.0);
  }`, {
  grainTex: { value: null }, ill: { value: null }, ink: { value: null }, size: { value: new THREE.Vector2(PW, PH) }, dev: { value: 0 }, t: { value: 0 },
  img: { value: new THREE.Vector4(IMG.x, IMG.y, IMG.s, IMG.s) },
});

function makeRig() {
  const photo = makeRT(PW * RES, PH * RES, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const st = new Stage(2, 30);
  st.U.ambient.value = 0.8;
  // 右上那一堆（畫在留言那張下面）
  const pile = PILE.map((_, k) => {
    const rt = makeRT(PW * RES_X, PH * RES_X, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    const mat = st.docMaterial(rt.texture, [rt.width, rt.height], [PW, PH], { radius: 4, edge: 1 });
    const mesh = st.docMesh(mat, PW, PH, 0, 0, 1 + k * 0.5);
    mesh.renderOrder = -6 + k;
    return { rt, mat, mesh };
  });
  const tapes = [0, 1].map(() => {
    const rt = makeRT(TW * 1.5, TH * 1.5, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    const mat = st.docMaterial(rt.texture, [rt.width, rt.height], [TW, TH], { radius: 3, edge: 0.6 });
    const mesh = st.docMesh(mat, TW, TH, 0, 0, 1.5);
    return { rt, mat, mesh };
  });
  const photoM = st.docMaterial(photo.texture, [photo.width, photo.height], [PW, PH], { radius: 4, edge: 1 });
  const photoMesh = st.docMesh(photoM, PW, PH, 0, 0, 2);
  // 拍立得相機：奶油色的機身、深色的前面板、鏡頭（圓柱）、出片口（一條深色的縫）。畫在相片後面（蓋住還沒吐出來的那一段）
  const body = new THREE.Group();
  const cream = 'mix(C_BONE, C_PAPER, 0.4) * 0.9 * (0.95 + 0.05 * detail * snoise(p / 30.0))';
  const shell = new THREE.Mesh(new THREE.BoxGeometry(820, 420, 360), st.solidMaterial(cream));
  shell.position.set(0, 210, 180);
  // 前面板下半部是深色的（出片口在它的最下面）
  const plate = new THREE.Mesh(new THREE.BoxGeometry(822, 8, 150), st.solidMaterial('mix(C_GRAPHITE * 0.7, C_INK2 * 1.6, 0.5)'));
  plate.position.set(0, -2, 75);
  // 鏡頭：黑色的鏡筒、玻璃（深色、一圈反光）
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(118, 128, 80, 48), st.solidMaterial('C_INK2 * 1.3'));
  lens.position.set(-90, -38, 215);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(84, 48), st.solidMaterial('C_INK * 0.5 + C_BONE * 0.35 * exp(-pow((length(p - vec2(-120.0, 0.0)) - 40.0) / 9.0, 2.0))'));
  glass.rotation.x = Math.PI / 2; glass.position.set(-90, -79, 215);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(640, 12, 10), st.solidMaterial('C_INK * 0.3'));
  slot.position.set(0, -8, 34);
  const flash = new THREE.Mesh(new THREE.BoxGeometry(200, 10, 80), st.solidMaterial('mix(C_BONE, C_ASH, 0.25) * 1.05'));
  flash.position.set(240, -5, 300);
  const finder = new THREE.Mesh(new THREE.BoxGeometry(80, 10, 60), st.solidMaterial('C_INK2 * 1.2'));
  finder.position.set(250, -5, 190);
  body.add(shell, plate, lens, glass, slot, flash, finder);
  // 相片（半透明的材質）會排在不透明的東西後面畫：相機也標成半透明、排在相片之後，才蓋得住還沒吐出來的那一段
  for (const m of [shell, plate, lens, glass, slot, flash, finder]) { m.frustumCulled = false; m.renderOrder = 10; (m.material as THREE.Material).transparent = true; }
  st.scene.add(body);
  // 韓文原文副行的標籤帶（窄一點的帶子、小一號的凸字）：只有這一格有原文時才看得到（整個舞台共用，平常藏著）
  const subTapes = [0, 1].map(() => {
    const rt = makeRT(TW * 1.5, TH_SUB * 1.5, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    const mat = st.docMaterial(rt.texture, [rt.width, rt.height], [TW, TH_SUB], { radius: 3, edge: 0.6 });
    const mesh = st.docMesh(mat, TW, TH_SUB, 0, 0, 2.5);
    mesh.visible = false;
    return { rt, mat, mesh };
  });
  return { photo, st, photoM, photoMesh, pile, tapes, body, subTapes };
}

// ---------------------------------------------------------------- 手繪插畫（線條＋淡彩，不是照片）
type Ctx = CanvasRenderingContext2D;
function wob(c: Ctx, pts: [number, number][], rnd: () => number, amp = 1.5, close = false) {
  c.beginPath();
  pts.forEach(([x, y], i) => { const jx = (rnd() - 0.5) * amp, jy = (rnd() - 0.5) * amp; if (i) c.lineTo(x + jx, y + jy); else c.moveTo(x + jx, y + jy); });
  if (close) c.closePath();
}
const ell = (cx: number, cy: number, rx: number, ry: number, a0 = 0, a1 = Math.PI * 2, n = 36): [number, number][] =>
  Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * (i / n); return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; });

/** 兩杯咖啡，煙在上面繞成一顆愛心。 */
function coffee(c: Ctx, S: number, rnd: () => number) {
  const g = c.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, mixRgba('paper', 'signal', 0.25)); g.addColorStop(0.62, mixRgba('paper', 'bone', 0.4)); g.addColorStop(0.62, mixRgba('paper', 'blood', 0.28)); g.addColorStop(1, mixRgba('paper', 'blood', 0.4));
  c.fillStyle = g; c.fillRect(0, 0, S, S);
  const line = rgba('sepia', 0.92);
  c.strokeStyle = line; c.lineWidth = 3; c.lineCap = 'round'; c.lineJoin = 'round';
  for (const [cx, sc] of [[S * 0.33, 1], [S * 0.66, 0.92]] as const) {
    const cy = S * 0.66, r = S * 0.13 * sc;
    // 碟子、杯身、杯口、咖啡、把手
    c.fillStyle = mixRgba('bone', 'paper', 0.3); wob(c, ell(cx, cy + r * 0.95, r * 1.55, r * 0.34), rnd, 1.2, true); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(cx - r, cy); c.bezierCurveTo(cx - r, cy + r * 1.1, cx + r, cy + r * 1.1, cx + r, cy); c.closePath();
    c.fillStyle = rgba('bone'); c.fill(); c.stroke();
    c.fillStyle = mixRgba('sepia', 'blood', 0.4); wob(c, ell(cx, cy, r, r * 0.26), rnd, 1, true); c.fill(); c.stroke();
    wob(c, ell(cx + r * 1.12, cy + r * 0.32, r * 0.28, r * 0.3, -Math.PI / 2, Math.PI / 2, 12), rnd, 1); c.stroke();
  }
  // 兩縷煙往上繞，在中間會合成一顆愛心
  c.lineWidth = 2.2; c.strokeStyle = rgba('sepia', 0.5);
  for (const sd of [-1, 1]) {
    const x0 = S * (sd < 0 ? 0.33 : 0.66), y0 = S * 0.6;
    c.beginPath(); c.moveTo(x0, y0);
    c.bezierCurveTo(x0 + sd * 30, y0 - 50, x0 - sd * 30, y0 - 90, S * 0.5 + sd * 18, S * 0.36);
    c.stroke();
  }
  drawHeart(c, S * 0.5, S * 0.3, S * 0.13);
}

/** 海邊的夕陽與一艘小帆船。 */
function seaside(c: Ctx, S: number, rnd: () => number) {
  const g = c.createLinearGradient(0, 0, 0, S * 0.6);
  g.addColorStop(0, mixRgba('paper', 'blood', 0.3)); g.addColorStop(1, mixRgba('signal', 'bone', 0.35));
  c.fillStyle = g; c.fillRect(0, 0, S, S * 0.6);
  c.fillStyle = mixRgba('signal', 'ember', 0.3); c.beginPath(); c.arc(S * 0.62, S * 0.6, S * 0.14, Math.PI, 0); c.fill();
  const sea = c.createLinearGradient(0, S * 0.6, 0, S);
  sea.addColorStop(0, mixRgba('blood', 'sepia', 0.4)); sea.addColorStop(1, mixRgba('sepia', 'ink', 0.3));
  c.fillStyle = sea; c.fillRect(0, S * 0.6, S, S * 0.4);
  c.strokeStyle = rgba('bone', 0.55); c.lineWidth = 2; c.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    const y = S * (0.65 + i * 0.038), x = S * (0.1 + rnd() * 0.6), w = S * (0.1 + rnd() * 0.18);
    wob(c, [[x, y], [x + w * 0.5, y - 3], [x + w, y]], rnd, 1); c.stroke();
  }
  // 太陽倒影
  c.strokeStyle = mixRgba('signal', 'ember', 0.4, 0.8); c.lineWidth = 3;
  for (let i = 0; i < 5; i++) { const y = S * (0.63 + i * 0.03), w = S * (0.12 - i * 0.018); wob(c, [[S * 0.62 - w, y], [S * 0.62 + w, y]], rnd, 1); c.stroke(); }
  // 小帆船（線條）
  c.strokeStyle = rgba('sepia', 0.95); c.lineWidth = 3; c.lineJoin = 'round';
  const bx = S * 0.28, by = S * 0.62;
  wob(c, [[bx - 50, by], [bx + 50, by], [bx + 36, by + 18], [bx - 36, by + 18]], rnd, 1, true); c.fillStyle = rgba('bone'); c.fill(); c.stroke();
  wob(c, [[bx, by], [bx, by - 110]], rnd, 1); c.stroke();
  wob(c, [[bx + 4, by - 104], [bx + 4, by - 10], [bx + 60, by - 10]], rnd, 1.2, true); c.fillStyle = rgba('bone'); c.fill(); c.stroke();
  // 兩隻鳥
  c.lineWidth = 2;
  for (const [x, y] of [[S * 0.2, S * 0.2], [S * 0.27, S * 0.15]] as const) { wob(c, [[x - 12, y], [x, y + 6], [x + 12, y]], rnd, 0.8); c.stroke(); }
}

/** 星空下的小房子，窗戶亮著。 */
function house(c: Ctx, S: number, rnd: () => number) {
  const g = c.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, mixRgba('ink2', 'blood', 0.25)); g.addColorStop(0.7, mixRgba('blood', 'sepia', 0.35)); g.addColorStop(0.7, mixRgba('sepia', 'ink2', 0.5)); g.addColorStop(1, rgba('ink2'));
  c.fillStyle = g; c.fillRect(0, 0, S, S);
  c.fillStyle = rgba('bone', 0.9);
  for (let i = 0; i < 40; i++) { const x = rnd() * S, y = rnd() * S * 0.6, r = 0.8 + rnd() * 1.8; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
  c.fillStyle = mixRgba('bone', 'signal', 0.3); c.beginPath(); c.arc(S * 0.76, S * 0.2, S * 0.07, 0, Math.PI * 2); c.fill();
  c.fillStyle = mixRgba('ink2', 'blood', 0.5); c.beginPath(); c.arc(S * 0.79, S * 0.18, S * 0.06, 0, Math.PI * 2); c.fill();
  // 小房子
  c.strokeStyle = rgba('bone', 0.85); c.lineWidth = 3; c.lineJoin = 'round';
  const hx = S * 0.42, hy = S * 0.72, hw = S * 0.3, hh = S * 0.2;
  c.fillStyle = mixRgba('ink2', 'sepia', 0.6);
  wob(c, [[hx - hw / 2, hy], [hx - hw / 2, hy - hh], [hx, hy - hh - S * 0.13], [hx + hw / 2, hy - hh], [hx + hw / 2, hy]], rnd, 1.2, true); c.fill(); c.stroke();
  c.fillStyle = rgba('signal'); c.fillRect(hx - hw * 0.28, hy - hh * 0.72, hw * 0.22, hh * 0.3); c.strokeRect(hx - hw * 0.28, hy - hh * 0.72, hw * 0.22, hh * 0.3);
  c.fillStyle = mixRgba('signal', 'ember', 0.3); c.fillRect(hx + hw * 0.08, hy - hh * 0.5, hw * 0.16, hh * 0.5);
  // 樹
  c.strokeStyle = rgba('bone', 0.7);
  wob(c, [[S * 0.8, hy], [S * 0.8, hy - S * 0.12]], rnd, 1); c.stroke();
  wob(c, ell(S * 0.8, hy - S * 0.19, S * 0.07, S * 0.09), rnd, 2, true); c.stroke();
}
const ILLUS = [coffee, seaside, house];

/** 右上那一堆的一張：插畫、丟上去的時間（-Infinity = 開場就在）、落定的位置與角度。 */
interface PilePhoto { cv: HTMLCanvasElement; tex: THREE.CanvasTexture; tLand: number; x: number; y: number; rot: number }

export default class Polaroid extends Scene {
  pass = shared('polaroid.develop', DEVELOP);
  rig = shared('polaroid.rig', makeRig);
  /** 馬克筆的字（相片座標）、標籤帶（每格重畫）。 */
  ink = this.track(new Layer2D(PW, PH, undefined, { fast: true }));
  /** 右上那一堆的白邊沒有字：一張空的圖層。 */
  blank = this.track(new Layer2D(8, 8, 1, { fast: true }));
  tapeL = [0, 1].map(() => this.track(new Layer2D(TW, TH, undefined, { fast: true })));
  /** 這一格有韓文原文時，原文那一條標籤帶的圖層（建構時就看：引擎只在建立這一格之前設好開關）。 */
  subL = this.ctx.lyrics.linesIn(this.ctx.start - 1, this.ctx.end + 1).some((l) => !!lyricSubOf(l)) ? [0, 1].map(() => this.track(new Layer2D(TW, TH_SUB, undefined, { fast: true }))) : null;
  /** 標籤帶這一格印的是哪一句（原文那一條跟著它）。 */
  private tapeLine: Line | null = null;
  private tapeLaySize = 52;
  ill: THREE.CanvasTexture | null = null;
  illCv: HTMLCanvasElement | null = null;
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 83 + (this.msg?.id ?? 0) * 29) >>> 0;
  g!: Grid;
  block: Block | null = null;
  /** 吐片的三個拍點、落地（相機拿走）、開始寫字。 */
  steps: number[] = [];
  tLand = 0; tWrite = 0; writeDur = 1;
  hasLyrics = false;
  /** 右上那一堆（最多 PILE.length 張）。 */
  pile: PilePhoto[] = [];
  /** 相片在螢幕上的倍數（全景時；v2 的字級換算：相片 px × K = 螢幕 px）。 */
  K = 0.95;
  /** 標籤帶上歌詞的字級（相片 px）。 */
  tapeSize = 52;
  private fall = 0.4;
  /** 馬克筆寫的每個字（相片座標）與它寫完的時間。 */
  glyphs: { ch: string; x: number; y: number; w: number; size: number; family: string; t0: number; t1: number; sig: boolean }[] = [];

  override async init() {
    const { audio: au, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    await loadAll(this.ctx, `${INVITE_BORDER}${INVITE_SIG}${COUPLE_ZH}${DATE_DOTS}`);
    const g = (this.g = grid(au, s, e));
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
    this.fall = clamp(g.beat * 0.8, 0.3, 0.42);
    // ---- 時間：吐片三拍（短窗格兩拍）、下一個小節線落地（太遠就下一拍）、再下一拍開始寫
    const short = g.nBars < 3.5;
    const b0 = g.b0;
    this.steps = [0, 1, 2].slice(0, short ? 2 : 3).map((k) => au.timeOfBeat(au.beatAt(b0) + k));
    const afterSteps = this.steps[this.steps.length - 1]! + g.beat * 0.6;
    let tl = g.bars.find((b) => b >= afterSteps) ?? Infinity;
    if (tl > afterSteps + g.beat * 1.5 || tl > s + 0.4 * (e - s)) tl = au.timeOfBeat(Math.ceil(au.beatAt(afterSteps) - 1e-6));
    this.tLand = tl;
    this.tWrite = au.timeOfBeat(au.beatAt(tl) + 1);
    // ---- 插畫（畫一次）
    const mainIll = Math.floor(hash(this.seed, 11) * ILLUS.length);
    const drawIll = (k: number, R: number, seed: number) => {
      const S = 520;
      const cv = document.createElement('canvas');
      cv.width = cv.height = Math.round(S * R);
      const c = cv.getContext('2d')!;
      c.scale(R, R);
      ILLUS[k % ILLUS.length]!(c, S, mulberry32(seed));
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.flipY = true;
      this.track(tex);
      return { cv, tex };
    };
    const mi = drawIll(mainIll, 1.5, this.seed);
    this.illCv = mi.cv; this.ill = mi.tex;
    // ---- 相片在螢幕上的倍數：全景的鏡頭（窗格中段）下，白邊的寫字框在畫面上多寬
    this.shoot(lerp(Math.min(this.tLand + g.bar, e), e, 0.5));
    const st = this.rig.st;
    const yM = MAIN.y + PH / 2 - (MSG_BOX.y + MSG_BOX.h / 2);
    const pa = st.toScreen([MAIN.x - PW / 2 + MSG_BOX.x, yM, 2]), pb = st.toScreen([MAIN.x - PW / 2 + MSG_BOX.x + MSG_BOX.w, yM, 2]);
    this.K = clamp((pb.x - pa.x) / MSG_BOX.w, 0.5, 1.4);
    // ---- 白邊上要寫的字（一個字一個字，照寫的順序排好時間）：字級照 v2
    const ic = this.ink.ctx;
    const text: Msg = m ?? { id: 0, name: '', text: INVITE_BORDER, n: 0, couple: true };
    const b = (this.block = block(ic, text, FAM, MSG_BOX, { align: 'left', sigFamily: F.hand(400), lineHeight: 1.2, maxLines: 6, valign: 0.25, v2: this.K, sigText: m ? undefined : INVITE_SIG }));
    this.tapeSize = lyricV2(m ? b.fit.size * this.K : null) / this.K;
    const items: { ch: string; x: number; y: number; w: number; size: number; family: string; sig: boolean }[] = [];
    for (const ln of b.lines) for (const gl of layout(ln.text, FAM, b.fit.size).glyphs) if (gl.ch.trim()) items.push({ ch: gl.ch, x: ln.x + gl.x, y: ln.y, w: gl.w, size: b.fit.size, family: FAM, sig: false });
    const sf = F.hand(400);
    for (const gl of layout(b.sig.text, sf, b.sig.size).glyphs) if (gl.ch.trim()) items.push({ ch: gl.ch, x: b.sig.x + gl.x, y: b.sig.y, w: gl.w, size: b.sig.size, family: sf, sig: true });
    const nMain = items.filter((x) => !x.sig).length;
    // 寫字：一個字 0.07 秒（整則 0.8～3 秒寫完），署名停半拍再寫
    this.writeDur = clamp(0.07 * nMain, 0.8, 3);
    const per = this.writeDur / Math.max(1, nMain);
    let k = 0;
    const sig0 = this.tWrite + this.writeDur + g.beat * 0.5;
    this.glyphs = items.map((it) => {
      const t0 = it.sig ? sig0 + (k - nMain) * 0.06 : this.tWrite + k * per;
      k++;
      return { ...it, t0, t1: t0 + (it.sig ? 0.06 : per) };
    });
    // ---- 右上那一堆：第一張開場就在；相片落地之後，每兩個小節線丟上來一張（短窗格至少一張：落地後兩拍）
    const tosses: number[] = [];
    for (const x of g.bars) if (x > this.tLand + g.bar * 1.5 && x < e - g.beat && tosses.length < PILE.length - 1 && Math.round((x - this.tLand) / g.bar) % 2 === 0) tosses.push(x);
    if (!tosses.length) { const x = au.timeOfBeat(au.beatAt(this.tLand) + 2); if (x < e - g.beat * 0.5) tosses.push(x); }
    [-Infinity, ...tosses].forEach((tt, i) => {
      const p = PILE[i]!;
      // 不跟留言那張同一張圖：另外兩張輪流
      const { cv, tex } = drawIll(mainIll + 1 + (i % 2), RES_X, this.seed + 101 * (i + 1));
      this.pile.push({ cv, tex, tLand: tt, ...this.clearHud(p) });
    });
  }

  /**
   * 右邊那一堆不能壓到右下角 HUD：用整個窗格的鏡頭（開場、推近到最後，種子決定鏡頭偏哪一邊）把相片投影到畫面上檢查，
   * 有任何一點落在 HUD 範圍就往左上收一點，直到乾淨為止。
   */
  private clearHud(p: { x: number; y: number; rot: number }) {
    const st = this.rig.st, s = this.ctx.start, e = this.ctx.end;
    const times = [0, 0.2, 0.4, 0.6, 0.8, 1].map((k) => lerp(s, e, k));
    const q = { ...p };
    const hits = () => times.some((t) => {
      this.shoot(t);
      const cs = Math.cos(q.rot), sn = Math.sin(q.rot);
      for (let i = 0; i <= 10; i++) for (let j = 0; j <= 14; j++) {
        const lx = (i / 10 - 0.5) * PW, ly = (j / 14 - 0.5) * PH;
        const sp = st.toScreen([q.x + lx * cs - ly * sn, q.y + lx * sn + ly * cs, 1]);
        if (sp.x >= HUD_CLEAR.x && sp.y >= HUD_CLEAR.y) return true;
      }
      return false;
    });
    for (let k = 0; k < 30 && hits(); k++) { q.x -= 30; q.y += 25; }
    return q;
  }

  /** 相片的位置：吐片時一段一段往下（每一段 outExpo，落在拍點）、落地時往下掉（z）彈一下。 */
  private photoPose(t: number) {
    const n = this.steps.length;
    let out = 0;
    for (const st of this.steps) out += ease.outExpo(clamp((t - (st - 0.04)) / 0.22)) / n;
    const drop = clamp((t - this.tLand) / 0.2);
    const bounce = t > this.tLand + 0.2 ? Math.exp(-(t - this.tLand - 0.2) * 10) * Math.sin((t - this.tLand - 0.2) * 30) : 0;
    // 吐片口在 y = 相片最後的上緣 + 一點點；out = 1 時整張出來
    const y = lerp(PH + 30, 0, out);
    return { x: MAIN.x + 6 * (1 - drop), y: MAIN.y + y, z: lerp(34, 2, ease.inQuad(drop)) + 3 * bounce, rot: lerp(0, MAIN.rot, ease.outCubic(clamp((t - this.tLand) / 0.5))) };
  }

  /** 右上那一堆的一張：從畫面右上外面被丟進來（轉著、落地滑一小段）。 */
  private pilePose(p: PilePhoto, t: number) {
    const u = p.tLand === -Infinity ? 1 : clamp((t - (p.tLand - this.fall)) / this.fall);
    const k = ease.inQuad(u), o = ease.outCubic(u);
    const dt = Math.max(0, t - p.tLand);
    const slide = p.tLand === -Infinity ? 1 : ease.outCubic(clamp(dt / 0.35));
    const settle = p.tLand === -Infinity ? 0 : Math.exp(-dt * 9) * Math.sin(dt * 34) * (t > p.tLand ? 1 : 0);
    return {
      x: lerp(p.x + 480, p.x + 36, o) - 36 * slide, y: lerp(p.y + 420, p.y + 14, o) - 14 * slide, z: lerp(640, 0, k) + 3 * settle,
      rot: lerp(p.rot + 0.6, p.rot + 0.05, o) - 0.05 * slide, a: clamp(u * 5), u,
    };
  }

  /**
   * 鏡頭：開場斜斜地看著相機吐片（看得到相機的正面與出片口）；相片落地後轉成俯看的全景（相片在左、那一堆在右上），慢慢推近。
   */
  private shoot(t: number) {
    const st = this.rig.st, s = this.ctx.start, e = this.ctx.end;
    const D = camDist(30);
    const push = ease.inOutQuad(prog(t, s, e));
    const intro = ease.outExpo(prog(t, s, s + Math.min(1.2, this.g.beat * 2.5)));
    const side = hash(this.seed, 3) < 0.5 ? -1 : 1;
    const down = ease.inOutCubic(clamp((t - this.tLand + 0.1) / Math.max(0.8, this.g.bar * 0.9)));
    const T3: V3 = [lerp(MAIN.x + 260, 40 + side * 24 * (1 - push), down), lerp(MAIN.y + 190, -20 - 30 * push, down), 0];
    const dist = D * lerp(0.86 + 0.06 * (1 - intro), 1.1 - 0.04 * push, down);
    const tilt = THREE.MathUtils.degToRad(lerp(40, 23 - 3 * push, down));
    const yaw = side * lerp(0.05, 0.03 - 0.02 * push, down);
    st.look([T3[0] + Math.sin(yaw) * dist, T3[1] - Math.sin(tilt) * dist, Math.cos(tilt) * dist], T3);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, e = this.ctx.end;
    const R = this.rig, st = R.st;
    // ---- 馬克筆的字
    const I = this.ink; I.clear();
    const c = I.ctx;
    c.textBaseline = 'alphabetic';
    for (const gl of this.glyphs) {
      if (t < gl.t0) break;
      const r = clamp((t - gl.t0) / (gl.t1 - gl.t0));
      c.fillStyle = gl.ch === '♥' ? rgba('rose') : gl.sig ? rgba('sepia', 0.72) : mixRgba('sepia', 'ink', 0.4);
      c.save();
      if (r < 1) { c.beginPath(); c.rect(gl.x - 4, gl.y - gl.size * 1.1, (gl.w + 8) * r, gl.size * 1.5); c.clip(); }
      glyphPath(c, gl);
      c.restore();
    }
    const u = this.pass.u;
    u.grainTex!.value = t21Grain(renderer);
    u.t!.value = t;
    // ---- 右上那一堆：每一張各自顯影（開場就在的那張已經顯影好；丟上來的從藥膜開始，三秒多慢慢出來）
    const blank = this.blank.upload();
    const shownPile = this.pile.filter((p) => p.tLand === -Infinity || t >= p.tLand - this.fall);
    R.pile.forEach((sl, k) => {
      const p = this.pile[k];
      const vis = !!p && shownPile.includes(p);
      sl.mesh.visible = vis;
      if (!vis) return;
      u.ill!.value = p.tex; u.ink!.value = blank;
      u.dev!.value = p.tLand === -Infinity ? 1 : ease.inOutQuad(prog(t, p.tLand - 0.2, p.tLand + 3.4));
      this.pass.render(renderer, sl.rt);
      const q = this.pilePose(p, t);
      sl.mesh.position.set(q.x, q.y, 1 + k * 0.5 + q.z); sl.mesh.rotation.set(0, 0, q.rot);
      sl.mat.uniforms.opacity!.value = q.a;
      // 在焦外（不搶留言），多糊一點
      (sl.mat.uniforms.region!.value as THREE.Vector4).set(0.5, 0.5, 1, 7);
    });
    // ---- 留言那張：顯影從開始吐片到落地後三秒
    u.ill!.value = this.ill;
    u.ink!.value = I.upload();
    const d0 = this.steps[0]! - 0.2, d1 = Math.min(e - 0.5, this.tLand + clamp((e - this.tLand) * 0.45, 1.6, 3.2));
    u.dev!.value = ease.inOutQuad(prog(t, d0, d1));
    this.pass.render(renderer, R.photo);
    // ---- 標籤帶：深色的帶子、凸起來的字（逐字跟唱）；長的歌詞兩條
    const rows = this.tape(t);
    R.tapes.forEach((tp, i) => {
      tp.mesh.visible = i < rows;
      if (i >= rows) return;
      comp.draw(renderer, this.tapeL[i]!.upload(), tp.rt, { mode: 'replace' });
      tp.mesh.position.set(TAPE[i]!.x, TAPE[i]!.y, 1.5 + i * 0.5);
      tp.mesh.rotation.set(0, 0, i ? -0.018 : 0.022);
    });
    // 原文那一條：貼在最後一條中文的正下方（左緣再錯開一點點、角度跟上一條相反）
    const subRows = this.subL && rows > 0 ? this.subTape(t) : 0;
    R.subTapes.forEach((tp, i) => {
      tp.mesh.visible = i < subRows;
      if (i >= subRows) return;
      comp.draw(renderer, this.subL![i]!.upload(), tp.rt, { mode: 'replace' });
      const last = TAPE[rows - 1]!;
      tp.mesh.position.set(last.x + 22 + i * 18, last.y - (TH + TH_SUB) / 2 - 10 - i * (TH_SUB + 8), 2.5 + i * 0.3);
      tp.mesh.rotation.set(0, 0, (rows + i) % 2 ? 0.014 : -0.016);
    });

    // ---- 舞台
    const p = this.photoPose(t);
    R.photoMesh.position.set(p.x, p.y, p.z); R.photoMesh.rotation.set(0, 0, p.rot);
    R.photoM.uniforms.opacity!.value = 1;
    // 相機：出片口在相片上緣的起點；落地時被拿走（往上、往遠處，inQuad）
    const lift = ease.inQuad(clamp((t - (this.tLand - 0.05)) / 0.45));
    R.body.position.set(MAIN.x, MAIN.y + PH / 2 + 26 + lift * 900, lift * 260);
    R.body.visible = lift < 1;
    this.shoot(t);
    // 對焦在白邊與標籤帶之間（兩個都要清楚）；相機（離桌面高）是糊的前景
    const fBorder = st.depthOf([MAIN.x, MAIN.y - PH / 2 + (PH - MSG_BOX.y - MSG_BOX.h / 2), 2]), fTape = st.depthOf([TAPE[0]!.x, TAPE[0]!.y, 1.5]);
    st.U.focus.value = (fBorder + fTape) / 2;
    st.U.aperture.value = 12;
    st.U.pool.value.set(-420, 150, 1600, 0.55);
    const sh = [
      ...(R.body.visible ? [{ x: MAIN.x + 40, y: R.body.position.y + 40, w: 900, h: 480, blur: 60 + lift * 80, k: 0.4 * (1 - lift), r: 30 }] : []),
      { x: p.x + 12 + p.z * 0.4, y: p.y - 18 - p.z * 0.5, w: PW, h: PH, rot: p.rot, blur: 12 + p.z * 0.5, k: 0.3, r: 5 },
      ...R.tapes.filter((tp) => tp.mesh.visible).slice(0, 1).map((tp) => ({ x: tp.mesh.position.x + 5, y: tp.mesh.position.y - 7, w: TW, h: TH, rot: tp.mesh.rotation.z, blur: 6, k: 0.25, r: 3 })),
      ...shownPile.map((pp) => { const q = this.pilePose(pp, t); return { x: q.x + 12 + q.z * 0.35, y: q.y - 16 - q.z * 0.45, w: PW, h: PH, rot: q.rot, blur: 12 + q.z * 0.12, k: 0.28 * (1 - clamp(q.z / 640)), r: 5 }; }),
    ];
    st.shadows(sh.slice(0, 6));
    st.render(renderer, out);
    const hit = Math.max(pulse(t, this.tLand + 0.2, 0.08), ...this.steps.map((x) => pulse(t, x, 0.06) * 0.5), ...this.pile.map((pp) => pulse(t, pp.tLand, 0.08) * 0.4));
    return {
      paper: 1, bloom: 0.3, vignette: 0.36, grain: 0.045,
      shake: [0, -hit * 3],
      popupAvoid: [this.docRect([MSG_BOX.x, MSG_BOX.y, MSG_BOX.w, MSG_BOX.h], p), this.tapeRect()],
    };
  }

  /**
   * 標籤帶的字：凸起的字（下緣一道暗影），還沒唱三成、正在唱訊號色、唱完紙白；長的歌詞折成兩條。回傳用了幾條。
   * 字級照 v2（40～52 px，有留言時比留言小一點）。
   */
  private tape(t: number): number {
    const { lyrics, song } = this.ctx;
    this.tapeLine = null;
    // 標籤帶是實體的東西，兩句之間不會變空白：留著上一句（唱完的字），下一句提早 0.35 秒換上
    const shown = lyricAt(lyrics, t)?.line ?? lyrics.shownLine(t, 1e4, 0.35) ?? lyrics.nextLine(t);
    const ly = shown ? { line: shown, k: 1 } : null;
    const paint = (c: CanvasRenderingContext2D) => {
      c.fillStyle = mixRgba('blood', 'ink', 0.35); c.fillRect(0, 0, TW, TH);
      c.fillStyle = rgba('bone', 0.06); c.fillRect(0, 5, TW, 3); c.fillRect(0, TH - 8, TW, 3);
    };
    const emboss = (c: CanvasRenderingContext2D, text: string, x: number, y: number, col: string, size: number) => {
      if (text === '♥') { drawHeart(c, x + size * 0.45, y - size * 0.36, size * 0.8); return; }
      c.fillStyle = rgba('ink', 0.5); c.fillText(text, x + 1, y + 2);
      c.fillStyle = col; c.fillText(text, x, y);
    };
    if (!ly) {
      if (this.hasLyrics) return 0;
      const L = this.tapeL[0]!; L.clear(); const c = L.ctx; paint(c);
      const text = this.msg ? `♪ ${song.title}` : COUPLE_ZH.replace(/\s*&\s*/, ' ♥ ');
      const size = this.msg ? 30 / this.K : V2.lyrMax / this.K;
      c.font = font(FAM_TAPE, size); c.textBaseline = 'alphabetic';
      // 字裡的 ♥ 用我們自己的愛心（玫瑰），其他照樣凸字
      let x = 22;
      for (const part of text.split(/(♥)/)) {
        if (!part) continue;
        emboss(c, part, x, TH / 2 + size * 0.36, rgba('bone', 0.95), size);
        x += c.measureText(part).width;
      }
      return 1;
    }
    const lay = layoutRows(this.tapeL[0]!.ctx, ly.line, { family: FAM_TAPE, size: this.tapeSize, minSize: V2.lyrMin / this.K, maxW: TW - 44, maxRows: 2, align: 'left' });
    this.tapeLine = ly.line; this.tapeLaySize = lay.size;
    const rows = Math.max(1, lay.rows.length);
    for (let r = 0; r < rows; r++) {
      const L = this.tapeL[r]!; L.clear(); const c = L.ctx; paint(c);
      c.font = font(FAM_TAPE, lay.size); c.textBaseline = 'alphabetic';
      c.globalAlpha = ly.k;
      const y = TH / 2 + lay.size * 0.36;
      for (const pw of lay.words) {
        if (Math.abs(pw.y - lay.rows[r]!.y) > 1) continue;
        const k = Lyrics.wordProgress(pw.word, t);
        const col = k >= 1 ? rgba('bone', 0.95) : k > 0 ? rgba('signal') : rgba('bone', 0.3);
        emboss(c, pw.word.w, 22 + pw.x, y, col, lay.size);
      }
      c.globalAlpha = 1;
    }
    return rows;
  }

  /**
   * 原文的標籤帶：同樣的深色帶子、同樣的凸字，字小一號（v2 的字級是螢幕 px，換成相片 px），長的原文一樣折成兩條；
   * 唱到、唱完都是白字淡兩成（不用訊號色，不跟中文搶），還沒唱三成；逐字時間是原文自己的。
   * 回傳用了幾條（這一句沒有原文是 0，帶子收起來）。
   */
  private subTape(t: number): number {
    const sub = lyricSubOf(this.tapeLine);
    if (!sub || !this.subL) return 0;
    const size = subSizeFor(this.tapeLaySize * this.K) / this.K;
    const lay = layoutRows(this.subL[0]!.ctx, sub, { family: FAM_TAPE, size, minSize: Math.min(size, 30 / this.K), maxW: TW - 44, maxRows: 2, align: 'left' });
    const rows = Math.min(2, Math.max(1, lay.rows.length));
    for (let r = 0; r < rows; r++) {
      const L = this.subL[r]!; L.clear(); const c = L.ctx;
      c.fillStyle = mixRgba('blood', 'ink', 0.35); c.fillRect(0, 0, TW, TH_SUB);
      c.fillStyle = rgba('bone', 0.06); c.fillRect(0, 4, TW, 2); c.fillRect(0, TH_SUB - 6, TW, 2);
      c.font = font(FAM_TAPE, lay.size); c.textBaseline = 'alphabetic';
      const y = TH_SUB / 2 + lay.size * 0.36;
      for (const pw of lay.words) {
        if (Math.abs(pw.y - lay.rows[r]!.y) > 1) continue;
        const k = Lyrics.wordProgress(pw.word, t);
        c.globalAlpha = k > 0 ? 0.8 : 1;
        c.fillStyle = rgba('ink', 0.5); c.fillText(pw.word.w, 22 + pw.x + 1, y + 2);
        c.fillStyle = k > 0 ? rgba('bone', 0.95) : rgba('bone', 0.3); c.fillText(pw.word.w, 22 + pw.x, y);
      }
      c.globalAlpha = 1;
    }
    return rows;
  }

  private docRect([x, y, w, h]: Rect, p: { x: number; y: number; z: number; rot: number }): Rect {
    const st = this.rig.st, cs = Math.cos(p.rot), sn = Math.sin(p.rot);
    const ps = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([u, v]) => {
      const lx = u! - PW / 2, ly = PH / 2 - v!;
      return st.toScreen([p.x + lx * cs - ly * sn, p.y + lx * sn + ly * cs, p.z]);
    });
    const xs = ps.map((q) => q.x), ys = ps.map((q) => q.y);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  }
  private tapeRect(): Rect {
    const st = this.rig.st;
    // 有韓文原文時下面多兩條窄帶子
    const extra = this.subL ? 2 * (TH_SUB + 8) + 10 : 0;
    const a = st.toScreen([TAPE[0]!.x - TW / 2, TAPE[0]!.y + TH / 2, 1]), b = st.toScreen([TAPE[1]!.x + TW / 2 + (this.subL ? 40 : 0), TAPE[1]!.y - TH / 2 - extra, 1]);
    return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)];
  }

  override dispose() {
    if (this.illCv) this.illCv.width = this.illCv.height = 0;
    for (const p of this.pile) p.cv.width = p.cv.height = 0;
    super.dispose();
  }
}
