// 批次 T15（手作 C ＋ 自然 A：darkroom、filmstrip、tree、flowers、dandelion、vines）共用的小工具。
// 六個版面的手法各不相同（透視平面上的液體 shader、three.js 立體膠卷、LineBatch 版畫樹、SDF 木刻花、
// 粒子種子、光影牆上的藤蔓），共用的只有：
//  - 平面鏡頭（PlaneCam）：把一塊「世界平面」（顯影盤、牆面）用針孔鏡頭拍到畫面上，算出畫面 → 平面的單應矩陣，
//    shader 用它一個像素一個像素反查平面座標（比建 three.js 網格省事，還能在平面上做液面、光影這些程序效果）；
//  - 留言排版：字級依「可用高度扣掉署名」算，署名永遠在最後一行下面（QA 的 K 情境）；
//  - 這批固定會出現的字（init 先載好，第一格才不會用備援字型）。
import * as THREE from 'three';
import { W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import type { Msg } from '../engine/scene';
import { clamp } from '../engine/util';
import type { FitResult } from '../engine/text';
import { fitMsg } from './_t4';
import { signature, COUPLE_ZH, DATE_DOTS } from './_motifs';

export type P2 = { x: number; y: number };
export type Rect = [number, number, number, number];

/** 右下角 HUD（QR）：字不要進到 x ≥ 1360 且 y ≥ 830；離四邊至少 96 px。 */
export const HUD = { x: 1360, y: 830 };
export const EDGE = 96;

/** 沒有留言時的邀請（這批一致的說法）。 */
export const INVITE = '掃描右下角 QR code，把你的祝福也放進來';

/** 這批固定會出現的字：數字、符號、署名的破折號、日期。 */
export const T15_TEXT = `${INVITE}${COUPLE_ZH}${DATE_DOTS}一位賓客新人No.0123456789·—…&♥（）()ABCDEFGHIJKLMNOPQRSTUVWXYZ:/.▸◂`;

/** init 共用：把這批固定的字、留言、署名、窗格裡的歌詞一次載好。 */
export async function loadAll(msg: Msg | null, lyricText: string, extra = '') {
  await loadText(`${T15_TEXT}${msg ? msg.text + signature(msg.name) : ''}${lyricText}${extra}`);
}

// ---------------------------------------------------------------- 留言＋署名
export interface MsgBlock {
  fit: FitResult;
  family: string;
  /** 第一行的基線（相對框的上緣）與署名的基線、字級。 */
  top: number;
  sigY: number;
  sigSize: number;
  sig: string;
  /** 整塊（留言＋署名）的高度。 */
  height: number;
}

/**
 * 在 w × h 的框裡排留言，先扣掉署名要的高度再找字級（署名永遠在最後一行下面，不會被字蓋住）。
 * 回傳的 top／sigY 是相對框上緣的基線；valign 決定整塊在框裡的垂直位置（0 = 靠上、0.5 = 置中）。
 */
export function msgBlock(c: CanvasRenderingContext2D, msg: Msg, family: string, w: number, h: number, o: { min?: number; max?: number; lineHeight?: number; maxLines?: number; sigK?: number; valign?: number } = {}): MsgBlock {
  const sigK = o.sigK ?? 0.46;
  // 署名大約是留言字級的一半（至少 30），先用最大可能的署名高度扣掉，排好再依實際字級算
  const max = o.max ?? 120;
  const sigGuess = clamp(max * sigK, 30, 56) * 1.9;
  const fit = fitMsg(c, msg.text, family, w, Math.max(60, h - sigGuess), { min: o.min ?? 44, max, lineHeight: o.lineHeight ?? 1.32, maxLines: o.maxLines ?? 6 });
  const sigSize = clamp(fit.size * sigK, 30, 56);
  const gap = Math.max(sigSize * 1.5, fit.size * 0.62);
  const height = fit.height + gap;
  const top = (h - height) * (o.valign ?? 0.5) + fit.size * 0.92;
  const last = top + (fit.lines.length - 1) * fit.lineHeight;
  return { fit, family, top, sigY: last + gap, sigSize, sig: signature(msg.name), height };
}

/** 署名（右對齊到 x）：留言的字族、較淡的顏色。 */
export function drawSig(c: CanvasRenderingContext2D, b: MsgBlock, x: number, y: number, color: string, align: CanvasTextAlign = 'right') {
  c.save();
  c.font = font(b.family, b.sigSize);
  c.fillStyle = color;
  c.textAlign = align;
  c.textBaseline = 'alphabetic';
  c.fillText(b.sig, x, y);
  c.restore();
}

// ---------------------------------------------------------------- 平面鏡頭
/**
 * 針孔鏡頭拍一塊平面：平面座標 (x, y) 向右、向下（跟 Canvas 一樣），(cx, cy) 對到畫面中心 + (ox, oy)。
 * pitch > 0：平面的上緣往後倒（遠）；yaw、roll 左右轉、歪。scale = 平面 1 單位在對焦距離是幾個畫面 px。
 */
export interface PlaneCam { pitch: number; yaw: number; roll?: number; scale: number; cx: number; cy: number; ox?: number; oy?: number; f?: number }

const _e = new THREE.Euler(), _m = new THREE.Matrix4(), _v = new THREE.Vector3();

/** 平面上一點 → 畫面 px（y 向下）與它離鏡頭的「前後」（z 越大越近）。 */
export function planeProject(cam: PlaneCam, x: number, y: number): { x: number; y: number; z: number } {
  const f = cam.f ?? 1600, D = f / cam.scale;
  // 繞 x 軸轉負的 pitch：平面的上緣（y 小的那邊）往後倒、變小
  _e.set(-cam.pitch, cam.yaw, cam.roll ?? 0, 'YXZ');
  _m.makeRotationFromEuler(_e);
  _v.set(x - cam.cx, -(y - cam.cy), 0).applyMatrix4(_m);
  const s = f / (D - _v.z);
  return { x: W / 2 + _v.x * s + (cam.ox ?? 0), y: H / 2 - _v.y * s + (cam.oy ?? 0), z: _v.z };
}

/** 單位正方形 (s,t) → 四邊形（畫面 px）的單應矩陣（Heckbert；照 _t8 的寫法），row-major 9 個數。 */
function squareToQuad(p: P2[]): number[] {
  const [a, b, c, d] = p as [P2, P2, P2, P2];
  const sx = a.x - b.x + c.x - d.x, sy = a.y - b.y + c.y - d.y;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) return [b.x - a.x, d.x - a.x, a.x, b.y - a.y, d.y - a.y, a.y, 0, 0, 1];
  const dx1 = b.x - c.x, dx2 = d.x - c.x, dy1 = b.y - c.y, dy2 = d.y - c.y;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
  return [b.x - a.x + g * b.x, d.x - a.x + h * d.x, a.x, b.y - a.y + g * b.y, d.y - a.y + h * d.y, a.y, g, h, 1];
}

/**
 * 給 shader 用的反查：畫面 px（y 向下）→ 平面上 rect（x0, y0, w, h）裡的 (s, t)，再 × 大小 + 起點就是平面座標。
 * 同時回傳 z = zc · (s, t, 1)（景深用）。
 */
export function planeInverse(cam: PlaneCam, rect: Rect, Hinv: THREE.Matrix3, zc: THREE.Vector3) {
  const [x0, y0, w, h] = rect;
  const P = [planeProject(cam, x0, y0), planeProject(cam, x0 + w, y0), planeProject(cam, x0 + w, y0 + h), planeProject(cam, x0, y0 + h)];
  const m = squareToQuad(P);
  Hinv.set(m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!, m[6]!, m[7]!, m[8]!).invert();
  zc.set(P[1]!.z - P[0]!.z, P[3]!.z - P[0]!.z, P[0]!.z);
}

/** 平面上的矩形投影到畫面後的外框（popupAvoid、避讓用）。 */
export function planeRect(cam: PlaneCam, [x, y, w, h]: Rect, pad = 0): Rect {
  const ps = [planeProject(cam, x, y), planeProject(cam, x + w, y), planeProject(cam, x, y + h), planeProject(cam, x + w, y + h)];
  const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return [Math.round(x0 - pad), Math.round(y0 - pad), Math.round(Math.max(...xs) - x0 + 2 * pad), Math.round(Math.max(...ys) - y0 + 2 * pad)];
}

/** GLSL：平面反查（配 planeInverse）。回傳平面座標；w 分量 < 0 表示在鏡頭後面。 */
export const PLANE_GLSL = /* glsl */ `
uniform mat3 Hinv; uniform vec4 prect; uniform vec3 zc;
vec3 planeAt(vec2 p, out float z) {
  vec3 q = Hinv * vec3(p, 1.0);
  vec2 st = q.xy / q.z;
  z = dot(zc, vec3(st, 1.0));
  return vec3(prect.xy + st * prect.zw, q.z);
}`;

/** 這批常用的字族：留言（手寫、典雅）、歌詞。 */
export const FAM = {
  hand: F.hand(700),
  ming: F.ming(700),
  lyric: F.archivo(100, 800),
};
