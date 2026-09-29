// 拍立得（亮）：亞麻桌布上，一台拍立得相機在畫面上緣（離鏡頭近、糊的前景）。拍點上馬達「嗡、嗡、嗡」三下，
// 相片一段一段從出片口吐出來、滑進畫面；小節線上相機被拿走，相片落到桌上（彈一下）。
// 相片正在顯影：一開始是一片灰濛濛的藥膜，最深的線條先浮出來、顏色最後才飽和——顯影出來的是一張手繪線條小插畫
// （兩杯咖啡冒著愛心形的煙／海邊的夕陽與小帆船／星空下亮著窗的小房子，每次不一樣），不是照片。
// 相片落地後的下一拍，一支馬克筆在寬寬的白邊上一個字一個字寫下主打留言，最後簽名。
//  - 一個焦點：白邊上的手寫留言（最大、最深）。歌詞是右邊一條壓字標籤帶（深色帶子上凸起的字，逐字跟唱：正在唱的字是訊號色）。
//  - 沒有留言：白邊寫「掃描 QR code，把祝福寫在這裡」（邀請），標籤帶的歌詞字大一點；純音樂又沒有留言：標籤帶是新人的名字。
//  - 鏡頭：斜俯看，一直對著相片，慢慢推近白邊；景深對在白邊上（相機與桌子遠處是糊的）。
// 手法：three.js 的「桌上的紙」舞台（_t4 Stage）：相機是幾個方塊與圓柱（程序上色），相片與標籤帶是平面；
// 相片每格用一個 shader 畫進 render target（插畫畫布＋顯影進度＋白邊＋馬克筆的字），標籤帶是 Canvas 合成進 render target。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, makeRT } from '../engine/gl';
import { F, font, layout } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, mulberry32, pulse, lerp } from '../engine/util';
import { Lyrics } from '../engine/lyrics';
import { lyricAt, drawHeart, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { grid, layoutRows, Stage, camDist, type Grid, type V3 } from './_t4';
import { loadAll, t21Grain, GRAIN_GLSL, block, glyphPath, type Block, type Rect } from './_t21';

export const spec: PlateSpecDecl = { group: 'type', family: 'print', paper: true, energy: [0.1, 0.8], bars: [4, 8], weight: 1 };

/** 相片（紙面 px）：影像 520×520 在 (40, 40)，下面是寬寬的白邊（寫字的地方）。 */
const PW = 600, PH = 880, IMG = { x: 40, y: 40, s: 520 }, RES = 1.5;
const MSG_BOX = { x: 40, y: 590, w: 520, h: 262 };
/** 標籤帶（紙面 px）：一條一行，長的歌詞用兩條。 */
const TW = 520, TH = 70, TAPE_X = PW / 2 + 60, TAPE_Y = [190, 100];
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
  return { photo, st, photoM, photoMesh, tapes, body };
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

export default class Polaroid extends Scene {
  pass = shared('polaroid.develop', DEVELOP);
  rig = shared('polaroid.rig', makeRig);
  /** 馬克筆的字（相片座標）、標籤帶（每格重畫）。 */
  ink = this.track(new Layer2D(PW, PH, undefined, { fast: true }));
  tapeL = [0, 1].map(() => this.track(new Layer2D(TW, TH, undefined, { fast: true })));
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
  /** 馬克筆寫的每個字（相片座標）與它寫完的時間。 */
  glyphs: { ch: string; x: number; y: number; w: number; size: number; family: string; t0: number; t1: number; sig: boolean }[] = [];

  override async init() {
    const { audio: au, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    await loadAll(this.ctx, `${INVITE_BORDER}${INVITE_SIG}${COUPLE_ZH}${DATE_DOTS}`);
    const g = (this.g = grid(au, s, e));
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
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
    const S = 520, R = 1.5;
    const cv = (this.illCv = document.createElement('canvas'));
    cv.width = cv.height = Math.round(S * R);
    const c = cv.getContext('2d')!;
    c.scale(R, R);
    ILLUS[Math.floor(hash(this.seed, 11) * ILLUS.length)]!(c, S, mulberry32(this.seed));
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.flipY = true;
    this.ill = this.track(tex);
    // ---- 白邊上要寫的字（一個字一個字，照寫的順序排好時間）
    const ic = this.ink.ctx;
    let text: Msg;
    if (m) text = m;
    else text = { id: 0, name: '', text: INVITE_BORDER, n: 0, couple: true };
    const b = (this.block = block(ic, text, FAM, MSG_BOX, { align: 'left', sigFamily: F.hand(400), sigMin: 26, sigMax: 34, min: 36, max: 72, lineHeight: 1.22, maxLines: 6, valign: 0.3, prefer1: 56, sigText: m ? undefined : INVITE_SIG }));
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
    return { x: 6 * (1 - drop), y, z: lerp(34, 2, ease.inQuad(drop)) + 3 * bounce, rot: lerp(0, -0.035, ease.outCubic(clamp((t - this.tLand) / 0.5))) };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
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
    u.ill!.value = this.ill;
    u.ink!.value = I.upload();
    // 顯影：從開始吐片到落地後三秒
    const d0 = this.steps[0]! - 0.2, d1 = Math.min(e - 0.5, this.tLand + clamp((e - this.tLand) * 0.45, 1.6, 3.2));
    u.dev!.value = ease.inOutQuad(prog(t, d0, d1));
    u.t!.value = t;
    this.pass.render(renderer, R.photo);
    // ---- 標籤帶：深色的帶子、凸起來的字（逐字跟唱）；長的歌詞兩條
    const rows = this.tape(t);
    R.tapes.forEach((tp, i) => {
      tp.mesh.visible = i < rows;
      if (i >= rows) return;
      comp.draw(renderer, this.tapeL[i]!.upload(), tp.rt, { mode: 'replace' });
      tp.mesh.position.set(TAPE_X + TW / 2 + i * 26, TAPE_Y[i]!, 1.5 + i * 0.5);
      tp.mesh.rotation.set(0, 0, i ? -0.018 : 0.025);
    });

    // ---- 舞台
    const p = this.photoPose(t);
    R.photoMesh.position.set(p.x, p.y, p.z); R.photoMesh.rotation.set(0, 0, p.rot);
    R.photoM.uniforms.opacity!.value = 1;
    // 相機：出片口在相片上緣的起點；落地時被拿走（往上、往遠處，inQuad）
    const lift = ease.inQuad(clamp((t - (this.tLand - 0.05)) / 0.45));
    R.body.position.set(0, PH / 2 + 26 + lift * 900, lift * 260);
    R.body.visible = lift < 1;
    // 鏡頭：一直看著相片，慢慢推近白邊；景深對在白邊
    const D = camDist(30);
    const push = ease.inOutQuad(prog(t, s, e));
    const intro = ease.outExpo(prog(t, s, s + Math.min(1.2, this.g.beat * 2.5)));
    const side = hash(this.seed, 3) < 0.5 ? -1 : 1;
    // 開場看高一點（看得到相機的正面與出片口）、斜一點；相片落地後往下搖到白邊、變俯看，慢慢推近
    const down = ease.inOutCubic(clamp((t - this.tLand + 0.1) / Math.max(0.8, this.g.bar * 0.9)));
    const T3: V3 = [200 + side * 20 * (1 - push), lerp(170, lerp(-60, -130, push), down), 0];
    const dist = D * (0.8 - 0.05 * push + 0.06 * (1 - intro));
    const tilt = THREE.MathUtils.degToRad(lerp(40, 23 - 3 * push, down));
    const yaw = side * (0.05 - 0.03 * push);
    st.look([T3[0] + Math.sin(yaw) * dist, T3[1] - Math.sin(tilt) * dist, Math.cos(tilt) * dist], T3);
    // 對焦在白邊與標籤帶之間（兩個都要清楚）；相機（離桌面高）是糊的前景
    const fBorder = st.depthOf([0, -PH / 2 + (PH - MSG_BOX.y - MSG_BOX.h / 2), 2]), fTape = st.depthOf([TAPE_X + TW / 2, TAPE_Y[0]!, 1.5]);
    st.U.focus.value = (fBorder + fTape) / 2;
    st.U.aperture.value = 12;
    st.U.pool.value.set(-300, 250, 1600, 0.55);
    st.shadows([
      { x: p.x + 12 + p.z * 0.4, y: p.y - 18 - p.z * 0.5, w: PW, h: PH, rot: p.rot, blur: 12 + p.z * 0.5, k: 0.3, r: 5 },
      ...R.tapes.filter((tp) => tp.mesh.visible).map((tp) => ({ x: tp.mesh.position.x + 5, y: tp.mesh.position.y - 7, w: TW, h: TH, rot: tp.mesh.rotation.z, blur: 6, k: 0.25, r: 3 })),
      ...(R.body.visible ? [{ x: 40, y: R.body.position.y + 40, w: 900, h: 480, blur: 60 + lift * 80, k: 0.4 * (1 - lift), r: 30 }] : []),
    ]);
    st.render(renderer, out);
    const hit = Math.max(pulse(t, this.tLand + 0.2, 0.08), ...this.steps.map((x) => pulse(t, x, 0.06) * 0.5));
    return {
      paper: 1, bloom: 0.3, vignette: 0.36, grain: 0.045,
      shake: [0, -hit * 3],
      popupAvoid: [this.docRect([MSG_BOX.x, MSG_BOX.y, MSG_BOX.w, MSG_BOX.h], p), this.tapeRect()],
    };
  }

  /**
   * 標籤帶的字：凸起的字（下緣一道暗影），還沒唱三成、正在唱訊號色、唱完紙白；長的歌詞折成兩條。回傳用了幾條。
   */
  private tape(t: number): number {
    const { lyrics, song } = this.ctx;
    const ly = lyricAt(lyrics, t);
    const paint = (c: CanvasRenderingContext2D) => {
      c.fillStyle = mixRgba('blood', 'ink', 0.35); c.fillRect(0, 0, TW, TH);
      c.fillStyle = rgba('bone', 0.06); c.fillRect(0, 4, TW, 3); c.fillRect(0, TH - 7, TW, 3);
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
      c.font = font(FAM_TAPE, 40); c.textBaseline = 'alphabetic';
      // 字裡的 ♥ 用我們自己的愛心（玫瑰），其他照樣凸字
      let x = 20;
      for (const part of text.split(/(♥)/)) {
        if (!part) continue;
        emboss(c, part, x, TH / 2 + 14, rgba('bone', 0.95), 40);
        x += c.measureText(part).width;
      }
      return 1;
    }
    const size = this.msg ? 42 : 48;
    const lay = layoutRows(this.tapeL[0]!.ctx, ly.line, { family: FAM_TAPE, size, minSize: 40, maxW: TW - 40, maxRows: 2, align: 'left' });
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
        emboss(c, pw.word.w, 20 + pw.x, y, col, lay.size);
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
    const a = st.toScreen([TAPE_X, TAPE_Y[0]! + TH / 2, 1]), b = st.toScreen([TAPE_X + TW + 26, TAPE_Y[1]! - TH / 2, 1]);
    return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)];
  }

  override dispose() {
    if (this.illCv) this.illCv.width = this.illCv.height = 0;
    super.dispose();
  }
}
