// 照片版面「押花」（亮）：像一張植物標本台紙——米白的厚卡紙上貼著照片，照片的角落押著一兩叢乾燥花（蕨葉、五瓣的小花、
// 薰衣草、小葉子），幾片散落的花瓣，整張壓在一片透明玻璃下面——
//  - 押花是半透明的：花瓣中間淡、邊緣深一點，有細細的葉脈；顏色是褪過的實物色（乾玫瑰、赭黃、灰綠的葉子），不跟主題換；
//    小花用主題色。花只壓在照片的角上（最多蓋到照片角落一點點），挑不在焦點旁、不在右下 HUD 底下、不會蓋到標籤的角落；
//    照片的主體與焦點從頭到尾都完整。
//  - 玻璃：四邊看得到玻璃的斜邊（一道帶綠的亮線），整片很淡地壓暗一點；窗光的反光是兩道斜斜的寬光帶，很慢地移動，
//    每個小節線有一道細的反光快速掃過。
//  - 切進來：玻璃從上面放下來——一開始花是翹的（影子比較遠），玻璃落下時一道亮光掃過整片，花被壓平、影子收緊。
//    很小的照片最多放大 1.5 倍。
//  - 焦點：之後鏡頭一開始快、越來越慢地往照片的焦點推近（焦點往畫面中間移一點，標籤一直在安全區裡），
//    照片上的畫面本身也往焦點小推一點。
//  - 字手寫在左下角的標本標籤上（米白小卡、雙線框；標籤只比字大一點，字多就長高）：主字（賓客留言＋署名，或新人的註解）
//    一個字一個字寫出來，歌詞小一號在下面跟唱；沒有主字時歌詞自己寫在標籤上跟唱；
//    兩個都沒有就沒有標籤（照片在畫面正中間、大一點）。相簿的第一張在字上面多一行小小的相簿名。
// 畫法：押花在 init() 用 Canvas2D 畫好一張（之後不重畫），一個全螢幕 shader 疊：台紙、照片、標籤與字、花（加上翹起來的影子）、玻璃。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F } from '../engine/type';
import { mixRgba, rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, mulberry32, prog } from '../engine/util';
import { Caption, P6_GLSL, P6_POST, P6_UNIFORMS, fitPhoto, focusAmp, focusAt, focusCam, loadPhoto, p6Crop, pace, photoLod, setP6Photo, type Cam, type FocusCamOpts } from './_p6';
import { focusCrop, settleK } from './_photo';
import type { PhotoImage } from '../photos';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'craft', paper: true, prefers: ['portrait', 'small'], energy: [0, 0.7], bars: [2, 8], weight: 1 };

const BG = () => new FSPass(/* glsl */ `
  ${P6_GLSL}
  uniform sampler2D photo; uniform sampler2D fl; uniform sampler2D tl;
  uniform vec3 cam;
  uniform vec4 rect; uniform float pbw; uniform float lod;
  uniform vec4 lab; uniform vec4 tlR; uniform float textK;
  uniform float lift; uniform float glassA; uniform float land; uniform float glint; uniform float t; uniform float k;
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = cam.xy + (sp - vec2(${W / 2}.0, ${H / 2}.0)) / cam.z;
    // ---- 台紙：米白的厚卡紙
    vec3 col = p6Paper(p * 0.8, mix(C_PAPER, C_BONE, 0.5) * 0.93);
    // ---- 照片（白邊）：貼在台紙上，很薄的影子
    vec2 rc = 0.5 * (rect.xy + rect.zw), hs = 0.5 * (rect.zw - rect.xy);
    vec2 po = hs + vec2(pbw);
    col *= 1.0 - 0.2 * exp(-max(sdBox(p - rc - vec2(3.0, 5.0), po), 0.0) / 5.0);
    vec3 pc = C_BONE * 0.9;
    vec2 uv = (p - rect.xy) / (rect.zw - rect.xy);
    pc = mix(pc, p6Photo(photo, uv, lod), aaFill(sdBox(p - rc, hs)));
    col = mix(col, pc, aaFill(sdBox(p - rc, po)));
    // ---- 標本標籤＋字
    if (lab.z > 0.0) {
      vec2 lq = p - lab.xy;
      float ld = sdBox(lq, lab.zw);
      col *= 1.0 - 0.18 * exp(-max(sdBox(lq - vec2(3.0, 5.0), lab.zw), 0.0) / 5.0);
      vec3 lc = p6Paper(p * 1.3, C_BONE * 0.92);
      // 雙線框
      float r1 = abs(sdBox(lq, lab.zw - 14.0)), r2 = abs(sdBox(lq, lab.zw - 20.0));
      lc = mix(lc, C_SEPIA * 1.4, 0.55 * (1.0 - smoothstep(0.5, 1.4, r1)) + 0.35 * (1.0 - smoothstep(0.3, 1.0, r2)));
      vec4 tx = p6Layer(tl, lq + lab.zw - tlR.xy, tlR.zw) * textK;
      lc = lc * (1.0 - tx.a) + tx.rgb;
      col = mix(col, lc, aaFill(ld));
    }
    // ---- 押花：翹起來的時候影子遠一點、淡一點
    vec2 so = vec2(4.0, 7.0) * (1.0 + 3.0 * lift);
    float fs = p6Layer(fl, p - so, vec2(${W}.0, ${H}.0)).a;
    col *= 1.0 - (0.22 / (1.0 + 1.5 * lift)) * fs;
    vec4 f = p6Layer(fl, p, vec2(${W}.0, ${H}.0));
    col = col * (1.0 - f.a) + f.rgb;
    // ---- 玻璃：比台紙小一圈，四邊的斜邊帶一點綠；整片很淡地壓暗；窗光的寬光帶慢慢移動、小節線一道細光掃過
    vec2 gLo = vec2(64.0, 52.0), gHi = vec2(${W - 64}.0, ${H - 46}.0);
    float gd = sdBox(p - 0.5 * (gLo + gHi), 0.5 * (gHi - gLo));
    float ga = aaFill(gd) * glassA;
    vec3 gcol = col * mix(vec3(1.0), mix(C_GINGHAM, C_BONE, 0.7) * 1.05, 0.12);
    float bev = 1.0 - smoothstep(0.0, 9.0, -gd);
    gcol = mix(gcol, mix(C_GINGHAM, C_BONE, 0.45) * 0.85, 0.35 * bev);
    gcol += C_BONE * 0.06 * (1.0 - smoothstep(0.0, 1.6, abs(gd + 1.5)));
    gcol *= 1.0 - 0.15 * (1.0 - smoothstep(0.0, 2.0, abs(gd + 9.5)));
    float u = dot(p, vec2(0.62, 0.78));
    float b1 = exp(-pow((u - 380.0 - t * 9.0) / 120.0, 2.0)), b2 = exp(-pow((u - 900.0 - t * 9.0) / 46.0, 2.0));
    float big = smoothstep(1400.0, 0.0, length(p - vec2(200.0, 100.0)));
    gcol += C_BONE * (0.045 * b1 + 0.03 * b2 + 0.03 * big);
    // 落下的那一道亮光、小節線的細光
    gcol += C_BONE * 0.09 * exp(-pow((u - mix(-200.0, 2400.0, land)) / 90.0, 2.0)) * step(0.001, land) * step(land, 0.999);
    gcol += C_BONE * 0.06 * exp(-pow((u - mix(-100.0, 2300.0, glint)) / 26.0, 2.0)) * step(0.001, glint) * step(glint, 0.999);
    col = mix(col, gcol, ga);
    fragColor = vec4(col * k, 1.0);
  }`, {
  ...P6_UNIFORMS(),
  photo: { value: null }, fl: { value: null }, tl: { value: null }, cam: { value: new THREE.Vector3(W / 2, H / 2, 1) },
  rect: { value: new THREE.Vector4(0, 0, 1, 1) }, pbw: { value: 12 }, lod: { value: 0 },
  lab: { value: new THREE.Vector4() }, tlR: { value: new THREE.Vector4(0, 0, 1, 1) }, textK: { value: 0 },
  lift: { value: 1 }, glassA: { value: 0 }, land: { value: 0 }, glint: { value: 0 }, t: { value: 0 }, k: { value: 1 },
});

type Ctx = CanvasRenderingContext2D;

/** 照片上的畫面往焦點推到幾倍（貼在台紙上的相片：小推）；鏡頭再推近 4%、焦點往畫面中間移兩成半。 */
const PUSH = 1.12;
const FOCUS: FocusCamOpts = { zoom: 1.04, pull: 0.25 };

/** 一片花瓣：從 (0,0) 長到 (len,0) 的水滴形，中間淡、邊深，幾條細脈。 */
function petal(c: Ctx, len: number, wid: number, col: string, edge: string) {
  const g = c.createLinearGradient(0, 0, len, 0);
  g.addColorStop(0, mixRgba(col, 'bone', 0.45, 0.8));
  g.addColorStop(0.65, col);
  g.addColorStop(1, edge);
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(0, 0);
  c.bezierCurveTo(len * 0.25, -wid, len * 0.95, -wid * 0.9, len, 0);
  c.bezierCurveTo(len * 0.95, wid * 0.9, len * 0.25, wid, 0, 0);
  c.fill();
  c.strokeStyle = mixRgba(edge, 'sepia', 0.3, 0.35); c.lineWidth = 0.8;
  for (const a of [-0.35, 0, 0.35]) { c.beginPath(); c.moveTo(len * 0.08, 0); c.quadraticCurveTo(len * 0.5, a * wid * 0.6, len * 0.85, a * wid * 0.9); c.stroke(); }
}

function flower(c: Ctx, x: number, y: number, r: number, rot: number, col: string, n = 5) {
  const edge = mixRgba(col, 'sepia', 0.3);
  c.save(); c.translate(x, y); c.rotate(rot);
  c.globalAlpha = 0.9;
  for (let k = 0; k < n; k++) {
    c.save(); c.rotate((k * Math.PI * 2) / n + (k % 2) * 0.08);
    petal(c, r, r * 0.42, col, edge);
    c.restore();
  }
  c.globalAlpha = 1;
  c.fillStyle = mixRgba('fur', 'sepia', 0.35);
  c.beginPath(); c.arc(0, 0, r * 0.2, 0, Math.PI * 2); c.fill();
  c.fillStyle = mixRgba('fur', 'bone', 0.3);
  for (let k = 0; k < 7; k++) { const a = k * 2.4; c.beginPath(); c.arc(Math.cos(a) * r * 0.1, Math.sin(a) * r * 0.1, r * 0.035, 0, Math.PI * 2); c.fill(); }
  c.restore();
}

function leaf(c: Ctx, x: number, y: number, ang: number, len: number, wid: number, col: string) {
  c.save(); c.translate(x, y); c.rotate(ang);
  c.globalAlpha = 0.92;
  petal(c, len, wid, col, mixRgba(col, 'sepia', 0.35));
  c.globalAlpha = 1;
  c.strokeStyle = mixRgba(col, 'sepia', 0.4, 0.7); c.lineWidth = 1.2;
  c.beginPath(); c.moveTo(0, 0); c.lineTo(len * 0.95, 0); c.stroke();
  c.lineWidth = 0.7;
  for (let k = 1; k < 5; k++) {
    const u = (k / 5) * len * 0.85;
    for (const s of [-1, 1]) { c.beginPath(); c.moveTo(u, 0); c.lineTo(u + len * 0.12, s * wid * 0.55); c.stroke(); }
  }
  c.restore();
}

/** 蕨葉：一根彎的莖，兩邊交錯的小葉，越往尖端越小。 */
function fern(c: Ctx, x: number, y: number, ang: number, len: number, col: string, bend: number) {
  c.save(); c.translate(x, y); c.rotate(ang);
  const N = 14;
  const pt = (u: number) => [u * len, Math.sin(u * Math.PI * 0.8) * bend] as const;
  c.strokeStyle = mixRgba(col, 'sepia', 0.4); c.lineWidth = 2.2; c.lineCap = 'round';
  c.beginPath(); c.moveTo(0, 0);
  for (let i = 1; i <= 20; i++) { const [a, b] = pt(i / 20); c.lineTo(a, b); }
  c.stroke();
  for (let i = 1; i < N; i++) {
    const u = i / N;
    const [a, b] = pt(u);
    const sz = len * 0.16 * (1 - u * 0.75);
    for (const s of [-1, 1]) leaf(c, a, b, s * (1.1 - u * 0.3), sz, sz * 0.32, col);
  }
  c.restore();
}

function lavender(c: Ctx, x: number, y: number, ang: number, len: number, col: string) {
  c.save(); c.translate(x, y); c.rotate(ang);
  c.strokeStyle = mixRgba('gingham', 'sepia', 0.35); c.lineWidth = 1.8;
  c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(len * 0.5, len * 0.04, len, 0); c.stroke();
  c.globalAlpha = 0.9;
  for (let k = 0; k < 11; k++) {
    const u = 0.55 + (k / 11) * 0.45;
    for (const s of [-1, 1]) {
      c.save(); c.translate(len * u, s * 3); c.rotate(s * 0.5 - 0.1);
      c.fillStyle = k % 2 ? col : mixRgba(col, 'sepia', 0.2);
      c.beginPath(); c.ellipse(0, 0, 6.5 * (1 - u * 0.4), 3.4, 0, 0, Math.PI * 2); c.fill();
      c.restore();
    }
  }
  c.restore();
}

export default class PressedFlower extends Scene {
  bg = shared('pressedflower.bg', BG);
  // 字：標籤上寬 430、最多六行（60 字的留言＋署名＋歌詞也放得下），整塊最高 520
  cap = this.track(new Caption(430, 520, { family: F.hand(400), align: 'left', lineHeight: 1.38, maxLines: 6, ink: rgba('sepia', 0.9), label: rgba('sepia', 0.6) }));
  fl = this.track(new Layer2D(W, H, undefined, { fast: true }));
  seed = Number(this.ctx.params.seed ?? 1);
  tex: THREE.Texture | null = null;
  img: PhotoImage | null = null;
  rect: [number, number, number, number] = [0, 0, 1, 1];
  pbw = 12;
  labX = 0; labY = 0; labW = 0; labH = 0;
  kp = 1;
  span: [number, number] = [Infinity, Infinity];
  /** 焦點（照片上的畫面推到底時在世界座標的位置）與鏡頭往那裡推的幅度（標籤不能被推出安全區）。 */
  foc: [number, number] = [W / 2, H / 2];
  amp = 1;

  override async init() {
    const { ph, img, tex } = await loadPhoto(this.ctx, (x) => this.track(x));
    this.img = img; this.tex = tex;
    const { start, end } = this.ctx;
    const cap = this.cap;
    cap.setup(this.ctx, ph);
    const { w, h } = img;
    const D = end - start;
    // 照片：有標籤時在右上（標籤在左下），沒有時在正中間
    const s = fitPhoto(w, h, cap.has ? 1020 : 1300, cap.has ? 740 : 780);
    const pw = w * s, phh = h * s;
    // 直的照片比較窄：往中間靠一點，左下的標籤與照片之間不要空一大片
    const cx = cap.has ? Math.max(700 + pw / 2, 1175 - (1020 - pw) * 0.45) : W / 2, cy = cap.has ? 470 : 515;
    this.rect = [cx - pw / 2, cy - phh / 2, cx + pw / 2, cy + phh / 2];
    this.pbw = clamp(0.03 * Math.min(pw, phh), 10, 18);
    if (cap.has) {
      this.labW = Math.max(cap.blockW, 260) / 2 + 52; this.labH = cap.blockH / 2 + 50;
      // 標籤靠左下，但不要碰到照片
      this.labX = Math.min(130 + this.labW, this.rect[0] - 50 - this.labW);
      this.labX = Math.max(this.labX, 120 + this.labW);
      this.labY = clamp(860 - this.labH, 150 + this.labH, 900 - this.labH);
    }
    this.drawFlowers(ph.fx, ph.fy);
    this.foc = focusAt(ph, focusCrop(ph, w, h, w / h, 1, { zoom: PUSH, screenW: pw }), this.rect);
    this.amp = cap.has ? focusAmp(this.foc, FOCUS, [[this.labX - this.labW - 6, this.labY - this.labH - 6, this.labX + this.labW + 6, this.labY + this.labH + 6]]) : 1;
    this.kp = pace(this.ctx);
    cap.writeAt(start + 0.35 * this.kp, Math.min(2.2, 0.45 * D));
    this.span = cap.span(this.ctx);
  }

  /** 押花畫在一張全畫面的圖層上（只畫一次）：照片的兩個對角各一叢，加幾片散落的花瓣。 */
  private drawFlowers(fx: number, fy: number) {
    const c = this.fl.ctx;
    const rnd = mulberry32(Math.floor(hash(this.seed, 61) * 1e9));
    const [L, T, R, B] = this.rect;
    const rose = mixRgba('collar', 'paper', 0.5), ochre = mixRgba('fur', 'paper', 0.3), green = mixRgba('gingham', 'sepia', 0.28);
    const sage = mixRgba('gingham', 'paper', 0.25), theme = mixRgba('signal', 'sepia', 0.18), lav = mixRgba('signal', 'blood', 0.4);
    // 挑兩個角落放押花：不要在右下角的 HUD 底下、不要在焦點旁邊、不要壓到標籤；對角最好看
    const all: [number, number, number, number][] = [[L, T, -1, -1], [R, T, 1, -1], [L, B, -1, 1], [R, B, 1, 1]];
    const score = ([x, y]: [number, number, number, number]) => {
      let v = 0;
      if (x > 1300 && y > 760) v -= 10;
      const u = (x - L) / (R - L), w = (y - T) / (B - T);
      v -= 4 * Math.max(0, 0.45 - Math.hypot(u - fx, w - fy));
      // 一叢花從角落往外伸約 300 px：離標籤太近會蓋到字
      if (this.labW > 0 && Math.hypot(Math.max(0, Math.abs(x - this.labX) - this.labW), Math.max(0, Math.abs(y - this.labY) - this.labH)) < 320) v -= 3;
      if (y < 150) v -= 1;
      return v;
    };
    // 最好的一個角一定放；第二叢優先放它的對角，對角不好就挑剩下最好的；都會碰到標籤或 HUD 就只放一叢
    const sc = all.map(score);
    const order = [0, 1, 2, 3].sort((a, b) => sc[b]! - sc[a]!);
    const first = order[0]!, diag = 3 - first;
    const second = sc[diag]! > -2.5 ? diag : order.slice(1).find((i) => sc[i]! > -2.5);
    const corners = second === undefined ? [all[first]!] : [all[first]!, all[second]!];
    for (const [k, [x, y, sx, sy]] of corners.entries()) {
      // 角落的一叢：蕨葉往外伸、一朵大花壓在照片角上、幾朵小花、一枝薰衣草、兩片葉子
      const out = Math.atan2(sy, sx);
      fern(c, x - sx * 10, y - sy * 10, out + (rnd() - 0.5) * 0.5 + sx * sy * 0.55, 300 + rnd() * 70, k ? sage : green, (rnd() - 0.5) * 60);
      fern(c, x - sx * 4, y - sy * 4, out - sx * sy * 0.75 + (rnd() - 0.5) * 0.3, 190 + rnd() * 50, k ? green : sage, (rnd() - 0.5) * 40);
      lavender(c, x + sx * 10, y + sy * 30, out - sx * sy * 1.1 + (rnd() - 0.5) * 0.3, 250 + rnd() * 40, lav);
      leaf(c, x + sx * 34, y - sy * 22, out + sx * sy * 1.25, 92, 30, green);
      leaf(c, x - sx * 24, y + sy * 44, out - sx * sy * 1.45, 80, 26, sage);
      for (let i = 0; i < 4; i++) {
        const a = out + (i - 1.5) * 0.5 + (rnd() - 0.5) * 0.3, d = 110 + rnd() * 80;
        flower(c, x + Math.cos(a) * d, y + Math.sin(a) * d, 18 + rnd() * 8, rnd() * 6, theme, 5);
      }
      flower(c, x + Math.cos(out + 0.9) * 120, y + Math.sin(out + 0.9) * 120, 40 + rnd() * 8, rnd() * 6, k ? rose : ochre, 5);
      flower(c, x + sx * 24, y + sy * 24, 58 + rnd() * 10, rnd() * 6, k ? ochre : rose, 5);
    }
    // 散落的花瓣（不在照片上）
    for (let i = 0; i < 4; i++) {
      let x = 0, y = 0;
      for (let tries = 0; tries < 20; tries++) {
        x = lerp(140, W - 140, rnd()); y = lerp(120, H - 140, rnd());
        const inPhoto = x > L - 40 && x < R + 40 && y > T - 40 && y < B + 40;
        const inLabel = this.labW > 0 && Math.abs(x - this.labX) < this.labW + 40 && Math.abs(y - this.labY) < this.labH + 40;
        const inHud = x > 1320 && y > 800;
        if (!inPhoto && !inLabel && !inHud) break;
      }
      c.save(); c.translate(x, y); c.rotate(rnd() * 6.28); c.globalAlpha = 0.85;
      petal(c, 26 + rnd() * 10, 11, i % 2 ? rose : ochre, mixRgba(i % 2 ? rose : ochre, 'sepia', 0.3));
      c.restore();
    }
    this.fl.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, kp = this.kp;
    const u = this.bg.u;
    const [x0, y0, x1, y1] = this.rect;
    // 照片上的畫面往焦點小推
    const crop = p6Crop(this.ctx, this.img!, t, { zoom: PUSH, screenW: x1 - x0 });
    setP6Photo(u, this.ctx.params.photo, crop);
    // 玻璃放下來：0.55 秒（窗格短就快一點）；鏡頭一開始稍微近一點，跟著玻璃落下拉回來，再往焦點推近
    const gl = ease.inOutCubic(prog(t, s + 0.05, s + 0.05 + 0.55 * kp));
    const zb = 1.025 - 0.025 * gl;
    const zx = (x0 + x1) / 2, zy = (y0 + y1) / 2;
    const base: Cam = [zx - (zx - W / 2) / zb, zy - (zy - H / 2) / zb, zb];
    const [cx, cy, z] = focusCam(this.foc, settleK(t - s, 6) * this.amp, { ...FOCUS, base });
    (u.cam!.value as THREE.Vector3).set(cx, cy, z);
    (u.rect!.value as THREE.Vector4).set(...this.rect);
    u.pbw!.value = this.pbw;
    u.photo!.value = this.tex;
    u.lod!.value = photoLod(this.img!.w * (crop[2] - crop[0]), (x1 - x0) * z);
    u.fl!.value = this.fl.texture;
    u.lift!.value = 1 - gl;
    u.glassA!.value = gl;
    u.land!.value = prog(t, s + 0.15, s + 0.15 + 0.9 * kp);
    const bar = audio.timeOfBar(Math.floor(audio.barAt(t)));
    u.glint!.value = bar > s + 0.8 ? prog(t, bar, bar + 0.7) : 0;
    u.t!.value = t - s;
    const cap = this.cap;
    if (cap.has) {
      cap.draw(t);
      const [a, b] = this.span;
      // 標籤跟著字出現（不要先擺一張空白的標籤）
      const la = ease.outCubic(prog(t, a - 0.3, a)) * (1 - prog(t, b, b + 0.4));
      (u.lab!.value as THREE.Vector4).set(this.labX, this.labY, la > 0.5 ? this.labW : 0, this.labH);
      u.tl!.value = cap.L.texture;
      (u.tlR!.value as THREE.Vector4).set(52 - cap.pad, 50 - cap.pad, cap.L.w, cap.L.h);
      u.textK!.value = cap.hasMain ? 1 : prog(t, a, a + 0.3);
    } else { u.tl!.value = this.tex; (u.lab!.value as THREE.Vector4).set(0, 0, 0, 0); u.textK!.value = 0; }
    u.k!.value = (0.94 + 0.06 * gl) * (1 - 0.06 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    return { ...P6_POST };
  }
}
