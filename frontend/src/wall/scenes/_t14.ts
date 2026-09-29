// 批次 T14（手作 B：stitch、loom、stainedglass、letterpress、sand、chalkboard）共用的小工具。
// 六個版面的手法各不相同（十字繡的格子 shader、有透視的織布、鉛條玻璃、鉛字的高度圖、燈箱沙畫、黑板粉筆），
// 共用的只有三件事：
//  - 「看著一張平面的鏡頭」PlaneCam：布、織布機、窗、印好的紙、燈箱、黑板都是一張平面，照 MV 融合原則要有透視、
//    會推近、會搖，不是正面的截圖。版面在「頁面座標」（1920×1080、y 向下，鏡頭在正前方時就是螢幕座標）排版，
//    shader 用 pcHit() 把每個螢幕像素打回頁面座標再上色，Canvas2D 畫在頁面座標的圖層被 shader 取樣，字就跟著透視走。
//    CPU 這邊用 toScreen() 算同一個點在螢幕上的位置（LineBatch 的針、梭子、板擦）。
//  - 「依序出現的字模」orderMask：字畫成一張資料貼圖，A = 字的覆蓋率、G = 第幾個字、B = 字裡面的掃描順序（0..1）、
//    R = 愛心。shader 拿「現在唱到／繡到第幾個字的哪裡」就能決定哪些像素出現，一針一針、一梭一梭、一指一指都用它。
//  - 留言＋署名的排版（照 v2 標準的字級；署名永遠在最後一行下面，字級依扣掉署名之後的高度算，QA 的 K 情境）。
import * as THREE from 'three';
import { font, layout } from '../engine/type';
import { clamp } from '../engine/util';
import type { Msg } from '../engine/scene';
import { fitText, type FitResult } from '../engine/text';
import { heartPoints, signature } from './_motifs';
import { fitMsg } from './_t4';
import { V2, msgMaxFor, sigV2, fitClauses } from './_v2';

export type Rect = [number, number, number, number];
export type P2 = { x: number; y: number };

/** 右下角 HUD（QR）：字不要進到 x ≥ 1360 且 y ≥ 830。 */
export const HUD = { x: 1360, y: 830 };
/** 沒有留言時的邀請（固定字串，引擎開機會預載）。 */
export const INVITE = '掃描右下角 QR code，把你的祝福寫上大螢幕';

// ---------------------------------------------------------------- 鏡頭
export interface CamPose {
  /** 鏡頭看著頁面上的哪一點。 */
  tx: number; ty: number;
  /** 鏡頭離那一點多遠（= focal 時 1 頁面 px = 1 螢幕 px）。 */
  dist: number;
  /** 左右轉（正 = 鏡頭在左邊、看向右，左半邊比較近）、上下俯仰（正 = 鏡頭在下方往上看，下半邊比較近）、滾轉。弧度。 */
  yaw?: number; pitch?: number; roll?: number;
  focal?: number;
  /** 0..1：把鏡頭沿視線轉正，讓頁面上的橫線在畫面中央是水平的（同時有 yaw 與 pitch 時字會一路斜上去，很難讀）。 */
  level?: number;
}

/**
 * 看著一張平面（頁面 z = 0，x 向右、y 向下，z 朝鏡頭是負的）的針孔鏡頭。
 * 休息姿勢 { tx: 960, ty: 540, dist: focal } 時頁面座標 = 螢幕座標，所以版面照螢幕座標排版就好。
 */
export class PlaneCam {
  C = new THREE.Vector3();
  R = new THREE.Vector3(1, 0, 0);
  D = new THREE.Vector3(0, 1, 0);
  F = new THREE.Vector3(0, 0, 1);
  focal = 1600;
  private m = new THREE.Matrix4();
  private e = new THREE.Euler();
  set(p: CamPose) {
    this.orient(p, p.roll ?? 0);
    if (p.level) {
      // 頁面的 x 軸在畫面中央的斜度，用滾轉抵銷掉
      const a = this.toScreen(p.tx, p.ty), b = this.toScreen(p.tx + 50, p.ty);
      this.orient(p, (p.roll ?? 0) + Math.atan2(b.y - a.y, b.x - a.x) * p.level);
    }
    return this;
  }
  private orient(p: CamPose, roll: number) {
    this.focal = p.focal ?? 1600;
    this.e.set(p.pitch ?? 0, p.yaw ?? 0, roll, 'YXZ');
    this.m.makeRotationFromEuler(this.e);
    this.R.set(1, 0, 0).applyMatrix4(this.m);
    this.D.set(0, 1, 0).applyMatrix4(this.m);
    this.F.set(0, 0, 1).applyMatrix4(this.m);
    this.C.set(p.tx, p.ty, 0).addScaledVector(this.F, -p.dist);
  }
  /** 頁面上的點（z 朝鏡頭為負）→ 螢幕 px（y 向下）、深度（沿鏡頭前方的距離）、縮放（1 頁面 px 在螢幕上幾 px）。 */
  toScreen(x: number, y: number, z = 0) {
    const vx = x - this.C.x, vy = y - this.C.y, vz = z - this.C.z;
    const zc = Math.max(1, vx * this.F.x + vy * this.F.y + vz * this.F.z);
    const xc = vx * this.R.x + vy * this.R.y + vz * this.R.z, yc = vx * this.D.x + vy * this.D.y + vz * this.D.z;
    return { x: 960 + (this.focal * xc) / zc, y: 540 + (this.focal * yc) / zc, depth: zc, scale: this.focal / zc };
  }
  /** 螢幕 px → 頁面上的點（平面 z = z0）。 */
  toPage(sx: number, sy: number, z0 = 0): P2 {
    const dx = this.R.x * (sx - 960) + this.D.x * (sy - 540) + this.F.x * this.focal;
    const dy = this.R.y * (sx - 960) + this.D.y * (sy - 540) + this.F.y * this.focal;
    const dz = this.R.z * (sx - 960) + this.D.z * (sy - 540) + this.F.z * this.focal;
    const t = (z0 - this.C.z) / dz;
    return { x: this.C.x + dx * t, y: this.C.y + dy * t };
  }
  /** 頁面上一個矩形在螢幕上的外框（給 popupAvoid、檢查安全邊）。 */
  screenRect(r: Rect, pad = 0): Rect {
    const ps = [[r[0], r[1]], [r[0] + r[2], r[1]], [r[0], r[1] + r[3]], [r[0] + r[2], r[1] + r[3]]].map(([x, y]) => this.toScreen(x!, y!));
    const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
    const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
    return [Math.round(x0), Math.round(y0), Math.round(Math.max(...xs) + pad - x0), Math.round(Math.max(...ys) + pad - y0)];
  }
  /** 把鏡頭寫進 shader 的 uniform（camUniforms() 建的那一組）。 */
  apply(u: Record<string, THREE.IUniform>) {
    (u.pcC!.value as THREE.Vector3).copy(this.C);
    (u.pcR!.value as THREE.Vector3).copy(this.R);
    (u.pcD!.value as THREE.Vector3).copy(this.D);
    (u.pcF!.value as THREE.Vector3).copy(this.F);
    u.pcFocal!.value = this.focal;
  }
}

export const camUniforms = () => ({
  pcC: { value: new THREE.Vector3(960, 540, -1600) }, pcR: { value: new THREE.Vector3(1, 0, 0) },
  pcD: { value: new THREE.Vector3(0, 1, 0) }, pcF: { value: new THREE.Vector3(0, 0, 1) }, pcFocal: { value: 1600 },
});

/**
 * GLSL：鏡頭的 uniform 與「螢幕像素 → 頁面座標」。
 * SP() = 這個像素的螢幕座標（邏輯 px、y 向下）；pcHit(sp, z0) = 打到平面 z = z0 的點（xy）與深度（z）。
 */
export const CAM_GLSL = /* glsl */ `
uniform vec3 pcC; uniform vec3 pcR; uniform vec3 pcD; uniform vec3 pcF; uniform float pcFocal;
vec2 SP() { return vec2(FRAG_PX.x, 1080.0 - FRAG_PX.y); }
vec3 pcDir(vec2 sp) { return pcR * (sp.x - 960.0) + pcD * (sp.y - 540.0) + pcF * pcFocal; }
vec3 pcHit(vec2 sp, float z0) {
  vec3 d = pcDir(sp);
  float t = (z0 - pcC.z) / d.z;
  vec3 P = pcC + d * t;
  return vec3(P.xy, t * pcFocal);
}
// 頁面座標 → 頁面大小的 Canvas 圖層（fast Layer2D，flipY）的 uv
vec2 pageUV(vec2 P) { return vec2(P.x / 1920.0, 1.0 - P.y / 1080.0); }
`;

// ---------------------------------------------------------------- 依序出現的字模
export interface MaskItem {
  ch: string;
  /** 字的左緣與基線（頁面座標）、字寬、字級、字族。 */
  x: number; y: number; w: number; size: number; family: string;
  /** 第幾個（0..254），shader 用它查這個字的時間。 */
  idx: number;
  /** R 通道的標記（愛心固定 255；版面可以自己標，例如署名 128）。 */
  tag?: number;
  /** 這個字自己的加粗（頁面 px，蓋過 orderMask 的 thicken；小字的署名不要加太粗）。 */
  thick?: number;
}

export interface OrderMask { tex: THREE.DataTexture; rect: Rect; scale: number; w: number; h: number; dispose(): void }

/**
 * 把一串字畫成「依序出現」的資料貼圖（見檔頭）。rect = 貼圖蓋住的頁面範圍，scale = 每頁面 px 幾個貼圖 px。
 * sweep：字裡面由左到右（'x'）、由上往下（'y'）或斜著（'diag'，左上到右下）掃過去。
 * 做法：顏色（G、B、R）用粗描邊畫一次、覆蓋率用填色畫一次再合起來——字的邊緣是半透明的，
 * 直接讀的話邊緣的「第幾個字」會被背景拉成 0（還沒輪到就先出現一圈外框）；描邊讓顏色往外多蓋幾 px。
 */
export function orderMask(items: MaskItem[], rect: Rect, scale = 0.5, sweep: 'x' | 'y' | 'diag' = 'x', pad = 3, thicken = 0): OrderMask {
  const w = Math.max(1, Math.ceil(rect[2] * scale)), h = Math.max(1, Math.ceil(rect[3] * scale));
  const mk = () => {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d', { willReadFrequently: true })!;
    c.setTransform(scale, 0, 0, scale, -rect[0] * scale, -rect[1] * scale);
    c.textBaseline = 'alphabetic';
    return c;
  };
  const col = mk(), cov = mk();
  const heart = heartPoints(48);
  for (const g of items) {
    const top = g.y - g.size * 0.88, bot = g.y + g.size * 0.12;
    const gr = sweep === 'y' ? col.createLinearGradient(0, top, 0, bot)
      : sweep === 'diag' ? col.createLinearGradient(g.x, top, g.x + g.w, bot) : col.createLinearGradient(g.x, 0, g.x + g.w, 0);
    const r = g.ch === '♥' ? 255 : clamp(Math.round(g.tag ?? 0), 0, 254), idx = clamp(Math.round(g.idx), 0, 254);
    gr.addColorStop(0, `rgb(${r},${idx},0)`);
    gr.addColorStop(1, `rgb(${r},${idx},255)`);
    col.fillStyle = gr; col.strokeStyle = gr; col.lineWidth = (pad * 2) / scale; col.lineJoin = 'round';
    cov.fillStyle = '#fff';
    if (g.ch === '♥') {
      // 愛心：跟 fillWithHearts 一樣，照字型裡 ♥ 的框放我們自己的愛心
      const s = Math.min(g.w, g.size * 0.8) * 0.46, cx = g.x + g.w / 2, cy = g.y - g.size * 0.36;
      for (const c of [col, cov]) {
        c.beginPath();
        heart.forEach((p, i) => (i ? c.lineTo(cx + p.x * s, cy + p.y * s) : c.moveTo(cx + p.x * s, cy + p.y * s)));
        c.closePath();
        c.fill();
        if (c === col) c.stroke();
      }
      continue;
    }
    col.font = cov.font = font(g.family, g.size);
    // thicken：覆蓋率也描一圈邊，筆畫變粗、轉角變圓（沙畫的手指、粉筆比字型的筆畫粗）
    const th = g.thick ?? thicken;
    col.lineWidth = (pad * 2) / scale + th * 2;
    if (th > 0) { cov.strokeStyle = '#fff'; cov.lineWidth = th * 2; cov.lineJoin = 'round'; cov.strokeText(g.ch, g.x, g.y); }
    col.strokeText(g.ch, g.x, g.y);
    col.fillText(g.ch, g.x, g.y);
    cov.fillText(g.ch, g.x, g.y);
  }
  const a = col.getImageData(0, 0, w, h).data, b = cov.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h * 4; i += 4) {
    out[i] = a[i]!; out[i + 1] = a[i + 1]!; out[i + 2] = a[i + 2]!; out[i + 3] = b[i + 3]!;
  }
  const tex = new THREE.DataTexture(out, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return { tex, rect, scale, w, h, dispose: () => tex.dispose() };
}

/** 一串排好的行 → 字模用的字（跳過空白；idx 從 idx0 起算）。 */
export function lineItems(lines: { text: string; x: number; y: number }[], family: string, size: number, idx0 = 0): MaskItem[] {
  const out: MaskItem[] = [];
  let k = idx0;
  for (const ln of lines) {
    for (const g of layout(ln.text, family, size).glyphs) {
      if (!g.ch.trim()) continue;
      out.push({ ch: g.ch, x: ln.x + g.x, y: ln.y, w: g.w, size, family, idx: k++ });
    }
  }
  return out;
}

// ---------------------------------------------------------------- 留言＋署名
export interface MsgBlock {
  fit: FitResult;
  family: string;
  /** 每一行（頁面座標：左緣、基線、寬）。 */
  lines: { text: string; x: number; y: number; w: number }[];
  sig: { text: string; x: number; y: number; size: number; w: number };
  /** 整塊（含署名）的外框。 */
  box: Rect;
}

/**
 * 在框裡排一則留言＋署名：字級依「框高扣掉署名那一行」算（署名永遠在最後一行下面、不重疊），整塊在框裡垂直置中。
 * align = 'left'（署名靠右對齊最長那行）或 'center'（署名靠右、留言置中）。
 * （舊版：別的批次的版面還在用，行為不能改。照 v2 標準排的版面用 msgBlockV2。）
 */
export function msgBlock(c: CanvasRenderingContext2D, m: Msg, family: string, box: { x: number; y: number; w: number; h: number }, o: { align?: 'left' | 'center'; sigFamily: string; sigMin?: number; sigMax?: number; min?: number; max?: number; lineHeight?: number; maxLines?: number; sigText?: string }): MsgBlock {
  const sigMin = o.sigMin ?? 40, sigMax = o.sigMax ?? 54;
  const text = m.text;
  // 先估一次署名要多高，再排留言（署名是留言字級的 0.45 倍，但夾在 sigMin～sigMax）
  let sigSize = sigMax, fit = fitMsg(c, text, family, box.w, box.h - sigSize * 1.7, { min: o.min ?? 44, max: o.max ?? 130, lineHeight: o.lineHeight ?? 1.3, maxLines: o.maxLines ?? 5 });
  sigSize = clamp(Math.round(fit.size * 0.45), sigMin, sigMax);
  fit = fitMsg(c, text, family, box.w, box.h - sigSize * 1.7, { min: o.min ?? 44, max: o.max ?? 130, lineHeight: o.lineHeight ?? 1.3, maxLines: o.maxLines ?? 5 });
  const sigText = o.sigText ?? (m.couple ? '—— 新郎新娘' : signature(m.name));
  c.font = font(family, fit.size);
  const widths = fit.lines.map((l) => c.measureText(l).width);
  const maxW = Math.max(...widths);
  c.font = font(o.sigFamily, sigSize);
  const sigW = c.measureText(sigText).width;
  const gap = Math.max(fit.lineHeight * 0.78, sigSize * 1.55);
  const blockH = fit.size + (fit.lines.length - 1) * fit.lineHeight + gap;
  const top = box.y + Math.max(0, (box.h - blockH) / 2);
  const base0 = top + fit.size * 0.9;
  const cx = box.x + box.w / 2;
  const lines = fit.lines.map((ln, i) => ({ text: ln, x: o.align === 'center' ? cx - widths[i]! / 2 : box.x, y: base0 + i * fit.lineHeight, w: widths[i]! }));
  const right = o.align === 'center' ? cx + maxW / 2 : box.x + maxW;
  const sigY = lines[lines.length - 1]!.y + gap;
  const sigX = Math.min(box.x + box.w - sigW, Math.max(box.x, right - sigW + sigSize * 0.6));
  const x0 = Math.min(...lines.map((l) => l.x), sigX), x1 = Math.max(right, sigX + sigW);
  return { fit, family, lines, sig: { text: sigText, x: sigX, y: sigY, size: sigSize, w: sigW }, box: [x0, top, x1 - x0, sigY + sigSize * 0.3 - top] };
}

/**
 * 在框裡排一則留言＋署名，照「留言尺寸與版面比例標準 v2」（_v2.ts）：
 *  - 字級是「螢幕上的 px」：留言 40～msgMaxFor(字數)、署名 sigV2。scale = 這一塊在畫面上的縮放（1 頁面 px = scale 螢幕 px），
 *    畫在頁面座標的字級要除以它（鏡頭推近時頁面上的字要小一點，畫面上才是標準的大小）。
 *  - 照子句斷行（fitClauses），放不下才交給 fitText；字級依「框高扣掉署名那一行」算，署名永遠在最後一行下面、不重疊。
 *  - 整塊在框裡垂直置中（valign = 'top' 就貼著上緣）。
 * align = 'left'（署名靠右對齊最長那行）或 'center'（留言置中、署名靠右）。
 */
export function msgBlockV2(c: CanvasRenderingContext2D, m: Msg, family: string, box: { x: number; y: number; w: number; h: number }, o: { align?: 'left' | 'center'; valign?: 'middle' | 'top'; sigFamily: string; lineHeight?: number; maxLines?: number; sigText?: string; scale?: number; sigSize?: number }): MsgBlock {
  const k = o.scale ?? 1;
  const text = m.text;
  const lh = o.lineHeight ?? 1.32, maxLines = o.maxLines ?? 5;
  const lo = V2.msgMin / k, hi = msgMaxFor(text) / k;
  // 先用最大的署名估一次高度排留言，再照排出來的字級算署名、重排一次（署名小了，留言可能可以大一點）
  const fitOnce = (sig: number) => {
    const h = box.h - sig * 1.9;
    return fitClauses(c, text, family, box.w, h, { min: lo, max: hi, lineHeight: lh, maxLines })
      ?? fitText(c, text, family, box.w, h, { min: lo, max: hi, lineHeight: lh, maxLines });
  };
  let fit = fitOnce(V2.sigMax / k);
  // sigSize：版面可以指定署名的螢幕字級（例如織出來的字太小會讀不到，用標準的上限 32）
  const sigOf = (msgPx: number) => (o.sigSize ?? sigV2(msgPx)) / k;
  let sigSize = sigOf(fit.size * k);
  fit = fitOnce(sigSize);
  sigSize = sigOf(fit.size * k);
  const sigText = o.sigText ?? (m.couple ? '—— 新郎新娘' : signature(m.name));
  c.font = font(family, fit.size);
  const widths = fit.lines.map((l) => c.measureText(l).width);
  const maxW = Math.max(...widths);
  c.font = font(o.sigFamily, sigSize);
  const sigW = c.measureText(sigText).width;
  const gap = Math.max(fit.lineHeight * 0.95, sigSize * 1.8);
  const blockH = fit.size + (fit.lines.length - 1) * fit.lineHeight + gap;
  const top = box.y + (o.valign === 'top' ? 0 : Math.max(0, (box.h - blockH) / 2));
  const base0 = top + fit.size * 0.9;
  const cx = box.x + box.w / 2;
  const lines = fit.lines.map((ln, i) => ({ text: ln, x: o.align === 'center' ? cx - widths[i]! / 2 : box.x, y: base0 + i * fit.lineHeight, w: widths[i]! }));
  const right = o.align === 'center' ? cx + maxW / 2 : box.x + maxW;
  const sigY = lines[lines.length - 1]!.y + gap;
  const sigX = Math.min(box.x + box.w - sigW, Math.max(box.x, right - sigW));
  const x0 = Math.min(...lines.map((l) => l.x), sigX), x1 = Math.max(right, sigX + sigW);
  return { fit, family, lines, sig: { text: sigText, x: sigX, y: sigY, size: sigSize, w: sigW }, box: [x0, top, x1 - x0, sigY + sigSize * 0.3 - top] };
}
