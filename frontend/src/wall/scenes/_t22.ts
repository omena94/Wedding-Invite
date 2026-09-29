// 批次 T22（信物：對戒、誓詞、禮物盒、緞帶、火柴、酒標）共用的小工具。
// 六個版面的手法各不相同（光線追蹤的金屬戒指、頭紗後面的誓詞、真 3D 的禮物盒、會翻面的緞帶、火光照亮的牆、
// 包在酒瓶上的酒標），共用的只有「留言怎麼排」這件事：
//  - 留言＋署名一起排（署名永遠在最後一行下面，字級依扣掉署名之後的高度算，QA 的 K 情境）——用 _t19 的 fitWithSig，
//    這裡只負責「畫」：每一行的位置、署名靠右或置中、新人留言的小標。
//  - 沒有留言時的邀請、標籤常用字（init 先載好，第一格才不會用備援字型）。
import * as THREE from 'three';
import { font } from '../engine/type';
import { rgba } from '../engine/palette';
import { fillWithHearts } from '../engine/motifs';
import { signature, COUPLE_ZH } from './_motifs';
import type { Msg } from '../engine/scene';
import type { MsgBlock } from './_t19';
import { fitText } from '../engine/text';
import { msgMaxFor, sigV2, V2, fitClauses } from './_v2';

export type Rect = [number, number, number, number];
export type P2 = { x: number; y: number };

/** 右下角 HUD（QR）：字不要進到 x ≥ 1360 且 y ≥ 830。 */
export const HUD = { x: 1360, y: 830 };

/** 署名：新人的留言署「宣文 & 孟庭」，其他照 signature()（沒填名字是「一位賓客」）。 */
export const sigOf = (m: Msg) => (m.couple ? `—— ${COUPLE_ZH}` : signature(m.name));

export interface DrawnBlock {
  /** 每一行的基線 y 與左緣 x、寬。 */
  lines: { x: number; y: number; w: number }[];
  /** 署名的基線、左緣、寬。 */
  sig: { x: number; y: number; w: number };
  /** 整塊（第一行頂到署名底）的外框。 */
  rect: Rect;
}

/**
 * 量好（不畫）一塊留言的位置：top = 第一行的字頂，x = 對齊點（左對齊是左緣、置中是中線）。
 * 署名在最後一行下面，靠右（對齊整塊的右緣）或置中。
 */
export function placeBlock(c: CanvasRenderingContext2D, blk: MsgBlock, family: string, sigText: string, x: number, top: number, o: { align?: 'left' | 'center'; sigFamily?: string; sigAlign?: 'right' | 'center' } = {}): DrawnBlock {
  const fit = blk.fit, align = o.align ?? 'left';
  c.font = font(family, fit.size);
  const base = top + fit.size * 0.9;
  const lines = fit.lines.map((ln, i) => {
    const w = c.measureText(ln).width;
    return { x: align === 'center' ? x - w / 2 : x, y: base + i * fit.lineHeight, w };
  });
  c.font = font(o.sigFamily ?? family, blk.sigSize);
  const sw = c.measureText(sigText).width;
  const last = lines[lines.length - 1]!;
  const left = Math.min(...lines.map((l) => l.x)), right = Math.max(...lines.map((l) => l.x + l.w));
  const sigAlign = o.sigAlign ?? (align === 'center' ? 'center' : 'right');
  const sx = sigAlign === 'center' ? x - sw / 2 : Math.max(left, right - sw);
  const sy = last.y + blk.sigDy;
  const x0 = Math.min(left, sx), x1 = Math.max(right, sx + sw);
  return { lines, sig: { x: sx, y: sy, w: sw }, rect: [x0, top, x1 - x0, sy + blk.sigSize * 0.3 - top] };
}

/**
 * 留言標準 v2 的排版（留言＋署名）：字級照「畫面上的 px」（V2：40～60，依字數用 msgMaxFor 定上限），
 * S = 容器（卡片、吊牌、貼圖）上 1 px 在畫面上是幾 px，所以畫在容器上的字級 = 畫面字級 ÷ S。
 * 先照子句斷行（fitClauses：不會斷出「…這一天，要／一直…」），放不下才交給 fitText；
 * 署名 sigV2（26～32），字級依「可用高度扣掉署名那一列」往下找，署名一定在最後一行下面（K 情境）。
 */
export function fitV2(c: CanvasRenderingContext2D, text: string, family: string, w: number, h: number, S = 1, o: { lineHeight?: number; maxLines?: number; min?: number; max?: number } = {}): MsgBlock {
  const lh = o.lineHeight ?? 1.3, maxLines = o.maxLines ?? 5;
  const min = (o.min ?? V2.msgMin) / S, max = Math.max(min, (o.max ?? msgMaxFor(text)) / S);
  let hh = h, best: MsgBlock | null = null;
  for (let k = 0; k < 8; k++) {
    const opt = { min, max, lineHeight: lh, maxLines };
    const fit = fitClauses(c, text, family, w, hh, opt) ?? fitText(c, text, family, w, Math.max(hh, min * 1.2), opt);
    const ss = sigV2(fit.size * S) / S;
    const sigDy = fit.size * 0.34 + ss * 1.02;
    const height = fit.height + sigDy + ss * 0.26;
    best = { fit, sigSize: ss, sigDy, height };
    if (height <= h + 0.5 || hh <= min * 1.2) break;
    hh = Math.max(min * 1.2, hh - (height - h + 2));
  }
  return best!;
}

/** 畫 placeBlock 排好的留言（愛心用我們自己畫的那顆）與署名。 */
export function drawBlock(c: CanvasRenderingContext2D, blk: MsgBlock, pl: DrawnBlock, family: string, sigText: string, o: { color?: string; sigColor?: string; sigFamily?: string; heart?: string } = {}) {
  c.save();
  c.textBaseline = 'alphabetic';
  c.textAlign = 'left';
  c.font = font(family, blk.fit.size);
  c.fillStyle = o.color ?? rgba('bone');
  blk.fit.lines.forEach((ln, i) => fillWithHearts(c, ln, pl.lines[i]!.x, pl.lines[i]!.y, o.heart));
  c.font = font(o.sigFamily ?? family, blk.sigSize);
  c.fillStyle = o.sigColor ?? o.color ?? rgba('bone');
  c.fillText(sigText, pl.sig.x, pl.sig.y);
  c.restore();
}

/**
 * 緞帶的網格：沿著一條折線（中心線）長出一條扁帶子，寬度方向每個點自己給（緞帶會翻、會扭）。
 * 回傳帶 uv 的 BufferGeometry：u 沿著長度（0..1，照弧長）、v 橫跨寬度（0..1）；法向量自己算（computeVertexNormals）。
 * 禮物盒的蝴蝶結、緞帶版面的長緞帶都用它。
 */
export function stripGeometry(n: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2 * 2), 2).setUsage(THREE.DynamicDrawUsage));
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  g.setIndex(idx);
  return g;
}
/**
 * 把中心線 pts 與每點的「半寬向量」side 寫進 stripGeometry 的網格（點數要跟建的時候一樣）。
 * uPerLen：給了就用「弧長 × uPerLen」當 u（印在緞帶上的字不會因為緞帶變長變短而被拉伸），沒給就是 0..1。
 */
export function setStrip(g: THREE.BufferGeometry, pts: THREE.Vector3[], side: THREE.Vector3[], uPerLen?: number) {
  const pos = g.getAttribute('position') as THREE.BufferAttribute, uv = g.getAttribute('uv') as THREE.BufferAttribute;
  let L = 0;
  const acc = [0];
  for (let i = 1; i < pts.length; i++) { L += pts[i]!.distanceTo(pts[i - 1]!); acc.push(L); }
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!, s = side[i]!;
    pos.setXYZ(i * 2, p.x - s.x, p.y - s.y, p.z - s.z);
    pos.setXYZ(i * 2 + 1, p.x + s.x, p.y + s.y, p.z + s.z);
    const u = uPerLen !== undefined ? acc[i]! * uPerLen : L > 0 ? acc[i]! / L : 0;
    uv.setXY(i * 2, u, 0); uv.setXY(i * 2 + 1, u, 1);
  }
  pos.needsUpdate = true; uv.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
}

/** 這批版面畫面上會出現的固定字（標籤、註腳、邀請），init 時一起載。 */
export const T22_TEXT = '見證人誓詞我願意新人一位賓客掃描右下角把祝福寫上大螢幕純音樂間奏安全火柴祝福專用一根火柴的時間剛好讀完一句恕不退還品飲筆記年份產區酒莊珍藏禮物拆封內附卡片小心輕放對戒內圍刻字緞帶吊牌第根共';
