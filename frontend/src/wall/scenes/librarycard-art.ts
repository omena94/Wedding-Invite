// 借書卡（librarycard）的美術：鏡頭（透視）、大理石紋蝴蝶頁、合成用的 shader、橡皮章的缺墨、卡片與借書袋的靜態圖。
// 座標有三層：
//  - 卡片座標：卡片左上角 (0,0)、寬 1000（L 裡的數字）。
//  - 頁面座標：書頁攤平時的 1920×1080（卡片停好時在 CARD），Canvas2D 圖層、大理石紋都畫在這一層。
//  - 畫面座標：鏡頭（針孔透視，camera()）把頁面投到畫面上；合成的 shader 反過來用逆矩陣從畫面找回頁面座標。
// 大理石紋的「紋路」整晚只烤一次（存的是各色條紋的份量，不是顏色，換主題不用重烤），而且有 mipmap：
// 景深就是依深度挑比較糊的 mipmap 層，一次取樣就夠，內顯也跑得動。
import * as THREE from 'three';
import { FSPass, makeRT, scaleContext2D, W, H, SCALE } from '../engine/gl';
import { F, font, measure } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { mulberry32, TAU } from '../engine/util';
import { COUPLE_ZH } from './_motifs';

/** 卡片停好時在頁面上的位置。卡片很長，下半截一直插在袋子裡。 */
export const CARD = { x: 330, y: 100, w: 1000, h: 1000 };
/** 卡片畫布四周留給影子的邊。 */
export const CPAD = 40;
/** 還沒抽出來時卡片往下沉多少（只露出表頭與書名欄）。 */
export const PULL = 560;
/** 借書袋（頁面座標）：下緣很長，鏡頭推近、往下看時也不會露出袋子的底。 */
export const POCKET = { x: 284, y: 905, w: 1092, h: 430 };
export const PPAD = 30;
/** Canvas2D 圖層在頁面上的範圍（卡片、袋子都在裡面）。 */
export const LAY = { x: 250, y: 30, w: 1180, h: 1320 };

/** 卡片上的版面（卡片座標）。表頭、表格都是配角：小、淡；讀後心得（留言）最大。 */
export const L = {
  x0: 40, x1: 960,
  head: 44,
  titleLabel: 76,
  /** 書名欄（歌詞）的下緣。 */
  fieldBot: 206,
  thead: 230, rule: 238,
  rowH: 30, rows: 4,
  /** 左右兩半：到期日一欄、借閱人一欄。 */
  half: 500, dateW: 170,
  rev: { top: 376, label: 398, text0: 414, text1: 746, sigMax: 792 },
  /** 圓章「永久續借」蓋的位置（中心）與角度：蓋在左半邊的舊紀錄上，不壓到最後一格與留言。 */
  seal: { x: 262, y: 294, rot: -0.22 },
} as const;

/** 第 i 格（0..7）：左半邊由上而下，接著右半邊。base 是字的基線。 */
export function slotXY(i: number) {
  const col = i < L.rows ? 0 : 1, row = i % L.rows;
  return { x: col ? L.half : L.x0, y: L.rule + row * L.rowH, base: L.rule + row * L.rowH + 22 };
}

/** 一張邏輯像素 w×h 的離屏畫布（跟 Layer2D 一樣放大 SCALE 倍，畫的程式照樣用邏輯像素）。只當 drawImage 的來源。 */
export function canvas2d(w: number, h: number) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * SCALE); cv.height = Math.round(h * SCALE);
  const c = scaleContext2D(cv.getContext('2d')!, SCALE);
  return { cv, c };
}

// ---------------------------------------------------------------- 鏡頭
export interface Cam { tx: number; ty: number; zoom: number; pitch: number; yaw: number; roll: number }
/** 焦距（畫面像素）。短一點透視比較明顯，但歌詞在遠端也要 ≥ 48 px，所以不能太短。 */
const FOCAL = 1500;

/**
 * 針孔鏡頭：看著頁面上的 (tx, ty)，從「頁面下方」往上斜看（pitch），再左右轉（yaw）、歪一點（roll）。
 * 回傳頁面 → 畫面的單應矩陣（列優先 3×3）。zoom = 看的那一點在畫面上的放大倍率。
 */
export function camera(k: Cam): number[] {
  const D = FOCAL / k.zoom;
  const cp = Math.cos(k.pitch), sp = Math.sin(k.pitch);
  // 先斜看：前方 n 朝頁面上方、往頁面裡面；下方 d 跟著轉
  let r = [1, 0, 0], d = [0, cp, -sp], n = [0, -sp, -cp];
  // 左右轉（繞頁面的法線）
  const cy = Math.cos(k.yaw), sy = Math.sin(k.yaw);
  const rz = (v: number[]) => [v[0]! * cy - v[1]! * sy, v[0]! * sy + v[1]! * cy, v[2]!];
  r = rz(r); d = rz(d); n = rz(n);
  // 歪（繞視線）
  const cr = Math.cos(k.roll), sr = Math.sin(k.roll);
  const r2 = r.map((x, i) => x * cr + d[i]! * sr), d2 = d.map((x, i) => -r[i]! * sr + x * cr);
  const C = [k.tx - n[0]! * D, k.ty - n[1]! * D, -n[2]! * D];
  const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const row = (v: number[]) => [v[0]!, v[1]!, -dot(v, C)];
  const a = row(r2), b = row(d2), c = row(n);
  return [
    FOCAL * a[0]! + (W / 2) * c[0]!, FOCAL * a[1]! + (W / 2) * c[1]!, FOCAL * a[2]! + (W / 2) * c[2]!,
    FOCAL * b[0]! + (H / 2) * c[0]!, FOCAL * b[1]! + (H / 2) * c[1]!, FOCAL * b[2]! + (H / 2) * c[2]!,
    c[0]!, c[1]!, c[2]!,
  ];
}
export function project(m: number[], x: number, y: number) {
  const w = m[6]! * x + m[7]! * y + m[8]!;
  return { x: (m[0]! * x + m[1]! * y + m[2]!) / w, y: (m[3]! * x + m[4]! * y + m[5]!) / w, w };
}

// ---------------------------------------------------------------- 大理石紋
/** 烤的範圍（頁面座標）：鏡頭斜看、推遠時看得到的都在裡面。 */
const BK = { x: -420, y: -420, w: 2760, h: 1920 };
/**
 * 烤紋路：r = 淡訊號色的條、g = 淡墨的條、b = 訊號色暗部的條、a = 條紋邊的墨線（都是 0..1 的份量，糊了也還是對的顏色）。
 * 樣子是「梳過的墨流」：一條條色帶跟著大的 S 形流動，梳齒在每條上拉出細細的羽毛紋。
 */
const MARBLE_BAKE = /* glsl */ `
void main() {
  vec2 px = vec2(${BK.x}.0 + vUv.x * ${BK.w}.0, ${BK.y}.0 + (1.0 - vUv.y) * ${BK.h}.0);
  vec2 p = px / 900.0;
  vec2 w = vec2(fbm(p + vec2(0.3, 0.7), 3), fbm(p * 1.3 + vec2(5.2, 1.3), 3));
  float y = px.y + 170.0 * w.x + 80.0 * sin(px.x / 280.0 + 3.0 * w.y) + 0.22 * px.x;
  float s = y / 44.0;
  // 梳齒：每一條往相反方向拉一點（像真的梳子來回梳過）
  s += 0.14 * sin(px.x / 12.0 + PI * floor(s));
  float id = floor(s), band = fract(s);
  float e = min(band, 1.0 - band) * 44.0;
  float vein = 1.0 - smoothstep(0.3, 1.5, e);
  float s2 = fract(s * 3.0 + 0.4 * w.y);
  float thin = 1.0 - smoothstep(0.2, 1.0, min(s2, 1.0 - s2) * 14.7);
  float k = mod(id, 6.0), shade = 0.7 + 0.3 * sin(band * PI);
  vec4 o = vec4(0.0);
  if (k == 1.0) o.r = shade; else if (k == 4.0) o.r = 0.4 * shade;
  else if (k == 3.0) o.g = shade; else if (k == 5.0) o.b = shade;
  o.a = max(vein, thin * 0.35);
  fragColor = o;
}`;

/**
 * 合成：畫面像素 → 頁面座標（逆單應矩陣）→ 大理石紋（淡、依景深糊）＋卡片圖層（fast Canvas2D，自己解碼）→ 桌燈的光 → 前景的書頁。
 * 卡片圖層也有 mipmap：離焦點遠的地方稍微糊一點（歌詞在的上緣只糊一點點，讀得到）。
 */
const COMPOSE = /* glsl */ `
uniform sampler2D bake; uniform sampler2D card;
uniform mat3 Hinv; uniform vec3 Hz; uniform float zf;
uniform vec4 lay; uniform vec4 cardR; uniform float comb; uniform float t; uniform vec3 lamp;
void main() {
  vec2 s = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  vec3 q = Hinv * vec3(s, 1.0);
  vec2 p = q.xy / q.z;
  // 景深：跟焦點的深度差（頁面是斜的，越上面越遠）
  float dof = abs(dot(Hz, vec3(p, 1.0)) / zf - 1.0) * 15.0;
  // ---- 大理石紋：每個小節線被梳子往前梳一下；離卡片越近越淡（卡片周圍乾淨）
  float ph = comb * 1.25 + t * 0.035;
  vec2 dsp = vec2(26.0 * sin(p.y / 150.0 + ph) + 7.0 * sin(p.y / 41.0 - ph * 1.7),
                  18.0 * sin(p.x / 240.0 + ph * 0.8) + 6.0 * sin(p.x / 67.0 + ph * 1.3));
  vec2 bu = (p + dsp - vec2(${BK.x}.0, ${BK.y}.0)) / vec2(${BK.w}.0, ${BK.h}.0);
  vec4 m = textureLod(bake, vec2(bu.x, 1.0 - bu.y), 1.0 + dof);
  vec2 dd = max(max(cardR.xy - p, p - cardR.zw), 0.0);
  float A = 0.2 + 0.3 * smoothstep(20.0, 340.0, length(dd));
  vec3 col = C_PAPER * 0.97;
  col = mix(col, mix(C_PAPER, C_SIGNAL, 0.55), m.r * A);
  col = mix(col, mix(C_PAPER, C_SEPIA, 0.35), m.g * A);
  col = mix(col, mix(C_PAPER, C_BLOOD, 0.5), m.b * A);
  col = mix(col, C_SEPIA, m.a * A * 0.6);
  // ---- 卡片與借書袋（fast 圖層：預乘、sRGB 編碼）
  vec2 cu = (p - lay.xy) / lay.zw;
  if (cu.x > 0.0 && cu.x < 1.0 && cu.y > 0.0 && cu.y < 1.0) {
    vec4 c = textureLod(card, vec2(cu.x, 1.0 - cu.y), max(0.0, dof * 0.55 - 0.15));
    vec3 lin = c.a > 0.0 ? toLinear(c.rgb / c.a) : vec3(0.0);
    col = col * (1.0 - c.a) + lin * c.a;
  }
  // ---- 桌燈：左上方一圈暖光，其他地方暗一點（紙不會比紙白刺眼）
  float lit = 1.0 - smoothstep(0.0, lamp.z, distance(p, lamp.xy));
  col *= 0.74 + 0.27 * lit;
  // ---- 前景：左邊是攤開的另一頁（離鏡頭很近、失焦），頁緣在蝴蝶頁上投一點影子
  float fx = 168.0 + 24.0 * sin(s.y / 520.0 + 0.6) - 0.05 * (s.y - 540.0);
  col *= 1.0 - 0.3 * (1.0 - smoothstep(fx, fx + 190.0, s.x));
  float fm = 1.0 - smoothstep(fx - 30.0, fx + 30.0, s.x);
  vec3 fp = mix(C_PAPER, C_BONE, 0.3) * (0.6 + 0.3 * smoothstep(fx + 10.0, fx - 150.0, s.x));
  fp = mix(fp, C_SEPIA, 0.035 * (0.5 + 0.5 * sin(s.y * 0.137)) * smoothstep(fx - 30.0, fx - 90.0, s.x));
  col = mix(col, fp, fm);
  fragColor = vec4(col, 1.0);
}`;

/** 模組層共用：大理石紋（第一次用的時候烤一次）與合成的 shader。 */
export class Book {
  rt = makeRT(BK.w, BK.h, { depthBuffer: false, pxScale: 0.6, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  bakePass = new FSPass(MARBLE_BAKE);
  pass = new FSPass(COMPOSE, {
    bake: { value: null }, card: { value: null }, Hinv: { value: new THREE.Matrix3() }, Hz: { value: new THREE.Vector3() }, zf: { value: 1 },
    lay: { value: new THREE.Vector4(LAY.x, LAY.y, LAY.w, LAY.h) }, cardR: { value: new THREE.Vector4() },
    comb: { value: 0 }, t: { value: 0 }, lamp: { value: new THREE.Vector3(560, 200, 1450) },
  });
  private baked = false;
  private inv = new THREE.Matrix3();
  render(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, o: { H: number[]; zf: number; card: THREE.Texture; cardR: [number, number, number, number]; comb: number; t: number }) {
    if (!this.baked) { this.bakePass.render(renderer, this.rt); this.baked = true; }
    const u = this.pass.u, h = o.H;
    this.inv.set(h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, h[8]!).invert();
    (u.Hinv!.value as THREE.Matrix3).copy(this.inv);
    (u.Hz!.value as THREE.Vector3).set(h[6]!, h[7]!, h[8]!);
    u.zf!.value = o.zf;
    u.bake!.value = this.rt.texture;
    u.card!.value = o.card;
    (u.cardR!.value as THREE.Vector4).set(...o.cardR);
    u.comb!.value = o.comb;
    u.t!.value = o.t;
    this.pass.render(renderer, out);
  }
}

// ---------------------------------------------------------------- 印章的缺墨
/**
 * 把畫好的印章「用舊」：細的缺墨點＋幾道乾掉的刷痕＋幾塊比較淡的地方（像印台的墨不均），用 destination-out 挖掉。
 * 只在 init() 做一次；種子決定斑駁的樣子（同一個窗格重畫一樣）。
 */
export function mottle(c: CanvasRenderingContext2D, w: number, h: number, seed: number, amount = 1) {
  const rnd = mulberry32(seed);
  c.save();
  c.globalCompositeOperation = 'destination-out';
  c.fillStyle = '#000';
  const n = Math.round((w * h) / 70 * amount);
  for (let i = 0; i < n; i++) {
    c.globalAlpha = 0.25 + 0.7 * rnd();
    const s = 0.8 + rnd() * rnd() * 3.2;
    c.fillRect(rnd() * w, rnd() * h, s, s * (0.6 + rnd() * 0.8));
  }
  for (let i = 0; i < 3 * amount; i++) {
    c.globalAlpha = 0.2 + 0.25 * rnd();
    c.save();
    c.translate(rnd() * w, rnd() * h); c.rotate(-0.4 + rnd() * 0.8);
    c.fillRect(-w * 0.3, -1, w * 0.6, 1.5 + rnd() * 2);
    c.restore();
  }
  for (let i = 0; i < 4; i++) {
    const x = rnd() * w, y = rnd() * h, r = (0.2 + rnd() * 0.35) * Math.max(w, h);
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,0.42)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.globalAlpha = Math.min(1, 0.5 + 0.5 * rnd() * amount);
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }
  c.restore();
}

// ---------------------------------------------------------------- 卡片
export interface CardCopy {
  acc: string;
  artist: string;
  reviewLabel: string;
  /** 留言（或歌詞）每一行的基線（畫很淡的書寫線）。 */
  guide: number[];
}

/** 卡片本身（不會變的字、線、紙、影子）。畫在 (CPAD, CPAD) 起的畫布上。印好的字都是小字、低對比（配角）。 */
export function drawCard(c: CanvasRenderingContext2D, cp: CardCopy, seed: number) {
  const { x0, x1 } = L;
  c.save();
  c.translate(CPAD, CPAD);
  // 影子（只畫一次，可以用 shadowBlur）
  c.save();
  c.shadowColor = rgba('sepia', 0.3); c.shadowBlur = 28; c.shadowOffsetX = 10; c.shadowOffsetY = 14;
  c.fillStyle = mixRgba('paper', 'bone', 0.5);
  c.beginPath(); c.roundRect(0, 0, CARD.w, CARD.h, 9); c.fill();
  c.restore();
  // 卡紙的斑點
  const rnd = mulberry32(seed + 17);
  for (let i = 0; i < 1800; i++) {
    c.fillStyle = rgba('sepia', 0.02 + 0.04 * rnd());
    const s = 0.7 + rnd() * 1.5;
    c.fillRect(rnd() * CARD.w, rnd() * CARD.h, s, s);
  }
  // 上緣的色條（圖書館卡片的分類色）
  c.fillStyle = mixRgba('blood', 'paper', 0.35);
  c.beginPath(); c.roundRect(0, 0, CARD.w, 10, [9, 9, 0, 0]); c.fill();
  c.textBaseline = 'alphabetic';
  const ink = (a: number) => rgba('sepia', a);

  // ---- 表頭（第一小群：借書卡、登錄號、索書號、書名、作者）
  c.fillStyle = ink(0.62);
  c.font = font(F.hei(700), 18); c.letterSpacing = '6px';
  c.fillText('借書卡', x0, L.head);
  const hw = measure('借書卡', F.hei(700), 18, 6) + 6;
  c.font = font(F.mono(500), 11); c.letterSpacing = '3px'; c.fillStyle = ink(0.4);
  c.fillText('BOOK CARD', x0 + hw + 8, L.head);
  c.font = font(F.mono(500), 13); c.letterSpacing = '2px'; c.fillStyle = ink(0.45);
  c.fillText(`登錄號 ${cp.acc}`, 540, L.head);
  c.textAlign = 'right';
  c.fillText('索書號 520.1314 / 愛', x1, L.head);
  c.fillStyle = ink(0.28); c.fillRect(x0, L.head + 10, x1 - x0, 1.2);
  c.font = font(F.hand(700), 20); c.letterSpacing = '0px'; c.fillStyle = ink(0.5);
  let aw = measure(cp.artist, F.hand(700), 20);
  let as = 20;
  if (aw > 360) { as = Math.max(13, (20 * 360) / aw); aw = 360; }
  c.font = font(F.hand(700), as);
  c.fillText(cp.artist, x1, L.titleLabel);
  c.font = font(F.hei(500), 13); c.letterSpacing = '3px'; c.fillStyle = ink(0.42);
  c.fillText('作者', x1 - aw - 12, L.titleLabel);
  c.textAlign = 'left';
  c.fillText('書名', x0, L.titleLabel);
  c.letterSpacing = '0px';
  c.fillStyle = ink(0.22); c.fillRect(x0, L.fieldBot, x1 - x0, 1.1);

  // ---- 表格（第二小群：到期日｜借閱人，左右兩半；很淡）
  c.font = font(F.hei(500), 12); c.letterSpacing = '3px'; c.fillStyle = ink(0.4);
  for (const hx of [0, L.half - x0]) {
    c.fillText('到期日', x0 + hx + 8, L.thead);
    c.fillText('借閱人', x0 + hx + L.dateW + 12, L.thead);
  }
  c.letterSpacing = '0px';
  c.fillStyle = ink(0.3); c.fillRect(x0, L.rule, x1 - x0, 1.1);
  c.fillStyle = ink(0.13);
  for (let r = 1; r <= L.rows; r++) c.fillRect(x0, L.rule + r * L.rowH, x1 - x0, 1);
  const yb = L.rule + L.rows * L.rowH;
  c.fillRect(x0 + L.dateW, L.thead - 16, 1, yb - L.thead + 16);
  c.fillRect(L.half + L.dateW, L.thead - 16, 1, yb - L.thead + 16);
  c.fillStyle = ink(0.24);
  c.fillRect(L.half, L.thead - 16, 1.1, yb - L.thead + 16);

  // ---- 讀後心得（主角的位置：只有一條細線、一個小標籤）
  c.fillStyle = ink(0.3); c.fillRect(x0, L.rev.top, x1 - x0, 1.2);
  c.font = font(F.hei(500), 13); c.letterSpacing = '3px'; c.fillStyle = ink(0.45);
  c.fillText(cp.reviewLabel, x0, L.rev.label);
  c.letterSpacing = '0px';
  c.strokeStyle = ink(0.12); c.lineWidth = 1; c.setLineDash([2, 6]);
  for (const y of cp.guide) { c.beginPath(); c.moveTo(x0, y + 12); c.lineTo(x1, y + 12); c.stroke(); }
  c.setLineDash([]);
  // 插在袋子裡的下半截
  c.font = font(F.hei(500), 14); c.letterSpacing = '2px'; c.fillStyle = ink(0.35);
  c.fillText('本卡請勿自行塗改。續借請洽新人，恕不接受退還。', x0, 846);
  c.letterSpacing = '0px';
  c.restore();
}

// ---------------------------------------------------------------- 借書袋
/** 牛皮紙的借書袋（前面那一片）：上緣中間有拇指缺口，印著冷面的小字（第三小群）。畫在 (PPAD, PPAD) 起的畫布上。 */
export function drawPocket(c: CanvasRenderingContext2D, seed: number) {
  const w = POCKET.w, h = POCKET.h;
  c.save();
  c.translate(PPAD, PPAD);
  c.save();
  c.shadowColor = rgba('sepia', 0.28); c.shadowBlur = 18; c.shadowOffsetX = 6; c.shadowOffsetY = 6;
  c.fillStyle = mixRgba('paper', 'sepia', 0.16);
  c.fillRect(0, 0, w, h);
  c.restore();
  // 牛皮紙帶一點主題的暖色、纖維
  c.fillStyle = rgba('signal', 0.08); c.fillRect(0, 0, w, h);
  const rnd = mulberry32(seed + 91);
  for (let i = 0; i < 2200; i++) {
    c.fillStyle = rgba(rnd() < 0.5 ? 'sepia' : 'bone', 0.03 + 0.06 * rnd());
    c.save(); c.translate(rnd() * w, rnd() * h); c.rotate(rnd() * TAU);
    c.fillRect(0, 0, 3 + rnd() * 9, 0.9);
    c.restore();
  }
  // 上緣摺過來的一條與摺線
  c.fillStyle = rgba('bone', 0.14); c.fillRect(0, 0, w, 14);
  c.fillStyle = rgba('sepia', 0.18); c.fillRect(0, 14, w, 1.1);
  // 拇指缺口：挖掉，看得到後面的卡片
  const nx = w / 2 - 16;
  c.save(); c.globalCompositeOperation = 'destination-out';
  c.beginPath(); c.arc(nx, 0, 48, 0, Math.PI); c.fill();
  c.restore();
  c.strokeStyle = rgba('sepia', 0.25); c.lineWidth = 1.2;
  c.beginPath(); c.arc(nx, 0, 48, 0, Math.PI); c.stroke();
  c.textBaseline = 'alphabetic';
  c.fillStyle = rgba('sepia', 0.5);
  c.font = font(F.hei(500), 17); c.letterSpacing = '3px';
  c.fillText('請愛護圖書　·　逾期不還，罰你幸福一輩子', 330, 74);
  c.font = font(F.mono(500), 14); c.letterSpacing = '5px'; c.fillStyle = rgba('sepia', 0.42);
  c.fillText('DATE DUE · 借期一輩子', w - 330, 74);
  c.letterSpacing = '0px';
  c.restore();
  // 左邊：藏書章（印泥、有點歪、缺墨、淡）
  const st = canvas2d(240, 58);
  const sc = st.c;
  const inkC = mixRgba('blood', 'sepia', 0.3, 0.6);
  sc.strokeStyle = inkC; sc.fillStyle = inkC; sc.lineWidth = 2.4;
  sc.strokeRect(3, 3, 234, 52); sc.lineWidth = 1; sc.strokeRect(8, 8, 224, 42);
  sc.font = font(F.hei(700), 17); sc.letterSpacing = '4px'; sc.textBaseline = 'alphabetic';
  sc.fillText(`${COUPLE_ZH} 圖書館`, 18, 34);
  sc.font = font(F.mono(500), 9); sc.letterSpacing = '3px';
  sc.fillText('LOVE LIBRARY · 藏書', 18, 46);
  mottle(sc, 240, 58, seed + 5, 0.8);
  c.save();
  c.translate(PPAD + 60 + 120, PPAD + 28 + 29); c.rotate(-0.035);
  c.globalCompositeOperation = 'multiply';
  c.drawImage(st.cv, -120, -29, 240, 58);
  c.restore();
  st.cv.width = st.cv.height = 0;
}

// ---------------------------------------------------------------- 印章
/** 日期章：mono 大寫「MAR 13 2027」，每一格一張（排成一張直的圖），缺墨各不一樣。小、淡（配角）。 */
export const DATE_CELL = { w: 150, h: 30 };
export function drawDateSheet(c: CanvasRenderingContext2D, dates: string[], ink: string, seed: number) {
  c.save();
  c.textBaseline = 'alphabetic';
  c.fillStyle = ink;
  c.font = font(F.mono(600), 17); c.letterSpacing = '1.5px';
  dates.forEach((d, i) => c.fillText(d, 6, i * DATE_CELL.h + 21));
  c.letterSpacing = '0px';
  c.restore();
  mottle(c, DATE_CELL.w, DATE_CELL.h * dates.length, seed + 3, 1.2);
}

/** 「永久續借」圓章：外圈兩道線、上下兩段弧形字、中間兩行大字。尺寸都跟著 size 走。 */
export function drawRoundStamp(c: CanvasRenderingContext2D, size: number, ink: string, top: string, bottom: string, mid: [string, string], seed: number) {
  const cx = size / 2, cy = size / 2, R = size / 2 - 6, k = size / 300;
  c.save();
  c.strokeStyle = ink; c.fillStyle = ink;
  c.lineWidth = 9 * k; c.beginPath(); c.arc(cx, cy, R - 5 * k, 0, TAU); c.stroke();
  c.lineWidth = 2.6 * k; c.beginPath(); c.arc(cx, cy, R - 17 * k, 0, TAU); c.stroke();
  c.lineWidth = 2.6 * k; c.beginPath(); c.arc(cx, cy, R - 54 * k, 0, TAU); c.stroke();
  c.textBaseline = 'alphabetic';
  c.font = font(F.mono(600), 22 * k);
  // 沿著圓弧排字：上半圈順時針讀、下半圈逆時針讀（字都是正的）
  const arc = (s: string, r: number, bottomSide: boolean) => {
    const chars = Array.from(s), tr = 3.5 * k;
    const ws = chars.map((ch) => c.measureText(ch).width + tr);
    const total = ws.reduce((a, b) => a + b, 0) - tr;
    let a = (bottomSide ? Math.PI / 2 : -Math.PI / 2) + (bottomSide ? 1 : -1) * (total / r) / 2;
    chars.forEach((ch, i) => {
      const w = ws[i]!;
      const ac = a + (bottomSide ? -1 : 1) * ((w - tr) / 2) / r;
      c.save();
      c.translate(cx + Math.cos(ac) * r, cy + Math.sin(ac) * r);
      c.rotate(bottomSide ? ac - Math.PI / 2 : ac + Math.PI / 2);
      c.fillText(ch, -(w - tr) / 2, 0);
      c.restore();
      a += (bottomSide ? -1 : 1) * w / r;
    });
  };
  arc(top, R - 46 * k, false);
  arc(bottom, R - 24 * k, true);
  c.font = font(F.hei(900), 19 * k);
  c.textAlign = 'center';
  c.fillText('★', cx - (R - 35 * k), cy + 7 * k); c.fillText('★', cx + (R - 35 * k), cy + 7 * k);
  c.font = font(F.hei(900), 58 * k);
  c.fillText(mid[0], cx, cy - 6 * k);
  c.fillText(mid[1], cx, cy + 56 * k);
  c.textAlign = 'left';
  c.restore();
  mottle(c, size, size, seed + 11, 0.8);
}
