// 批次 T23（樂器與遊樂：piano、drumkit、mirrorball、carousel、balloon、confetti）共用的小工具。
// 六個版面的手法各不相同（three.js 的鋼琴與花瓣、SDF 畫的鼓組、細線鏡球與光點、Canvas 插畫的旋轉木馬、版畫熱氣球），
// 共用的只有「字」與「節拍」的部分：
//  - 留言＋署名的排版：字級依「扣掉署名之後的高度」算，署名永遠在最後一行下面（QA 的 K 情境）；
//    短的留言放得下一行就一行（不要拆成「新婚快／樂！！！」）。
//  - 窗格裡的拍點、小節線，n 個東西依序出現的時間表（兩小節的窗格也出得完）。
//  - three.js 用的材質小工具（色票 uniform、共用的 MSAA 目標）。
import * as THREE from 'three';
import type { AudioData } from '../engine/audio';
import type { Msg } from '../engine/scene';
import { font } from '../engine/type';
import { fitText, type FitResult } from '../engine/text';
import { clamp } from '../engine/util';
import { GLSL_COMMON, THEME_UNIFORMS } from '../engine/glsl/common';
import { signature, COUPLE_ZH } from './_motifs';

export type Rect = [number, number, number, number];
export type P2 = { x: number; y: number };

/** 右下角 HUD（QR）：字不要進到 x ≥ 1360 且 y ≥ 830。 */
export const HUD = { x: 1360, y: 830 };
/** 沒有留言時的邀請（整批一致，小字）。 */
export const T23_INVITE = '掃描右下角 QR code，把你的祝福傳上大螢幕';
/** 這批固定會出現的字（init 時一次載好：數字、符號也要，沒載好第一格會用系統字頂替）。 */
export const T23_TEXT = `${T23_INVITE}一位賓客${COUPLE_ZH}新人0123456789·—…：:%♪♩=()（）＊`;

/** 署名：新人自己的留言署「宣文 & 孟庭」。 */
export const sigOf = (m: Msg) => (m.couple ? `—— ${COUPLE_ZH}` : signature(m.name));

// ---------------------------------------------------------------- 節拍
/** 窗格裡的拍點。 */
export function winBeats(au: AudioData, s: number, e: number): number[] {
  const out: number[] = [];
  for (let b = Math.ceil(au.beatAt(s) - 1e-3); ; b++) {
    const tb = au.timeOfBeat(b);
    if (tb >= e - 1e-3 || out.length > 400) break;
    if (tb >= s - 1e-3) out.push(tb);
  }
  return out;
}

/** 窗格裡的小節線（含開頭那一條，如果窗格剛好切在小節線上）。 */
export function winBars(au: AudioData, s: number, e: number): number[] {
  const out: number[] = [];
  for (let b = Math.ceil(au.barAt(s) - 1e-3); ; b++) {
    const tb = au.timeOfBar(b);
    if (tb >= e - 1e-3 || out.length > 80) break;
    if (tb >= s - 1e-3) out.push(tb);
  }
  return out;
}

/**
 * n 個東西依序出現的時間：從 t0 開始，一拍 1、2、4 或 8 個，挑最慢、但能在 maxDur 秒內出完的那一種
 * （再不夠就平均塞進去）。短的一拍一個很有節奏，長的在短窗格裡也一定出得完。
 */
export function stagger(au: AudioData, t0: number, n: number, maxDur: number): number[] {
  if (n <= 0) return [];
  const b0 = au.beatAt(t0);
  const budget = Math.max(0.25, au.beatAt(t0 + Math.max(0.2, maxDur)) - b0);
  const per = n <= 1 ? 1 : [1, 2, 4, 8].find((k) => (n - 1) / k <= budget) ?? (n - 1) / budget;
  return Array.from({ length: n }, (_, i) => au.timeOfBeat(b0 + i / per));
}

/** t 之前（含）最近的一個時間點（都還沒到是 -Infinity）。ts 要排序好。 */
export function lastBefore(ts: number[], t: number): number {
  let r = -Infinity;
  for (const x of ts) { if (x <= t) r = x; else break; }
  return r;
}

// ---------------------------------------------------------------- 留言＋署名
export interface Glyph { ch: string; x: number; y: number; w: number; size: number; row: number }
export interface MsgLay {
  fit: FitResult;
  family: string;
  /** 每一行：左緣、基線、寬。 */
  lines: { text: string; x: number; y: number; w: number }[];
  sig: { text: string; x: number; y: number; size: number; w: number; family: string };
  /** 每個字（含署名的字，row = -1）。 */
  glyphs: Glyph[];
  /** 整塊（含署名）的外框。 */
  box: Rect;
}

/**
 * 在框裡排一則留言＋署名。字級依「框高扣掉署名那一行」找（署名永遠在最後一行下面、不重疊），整塊在框裡垂直置中。
 * 行數少的優先：少一行時字級還有最大字級的 fewer 倍（預設六成）以上就用少的那個。align：留言置中或靠左；署名靠右對齊留言最長那一行。
 */
export function layMsg(c: CanvasRenderingContext2D, text: string, sigText: string, family: string, box: { x: number; y: number; w: number; h: number },
  o: { min?: number; max?: number; lineHeight?: number; maxLines?: number; sigFamily?: string; sigSize?: [number, number]; align?: 'left' | 'center'; valign?: 'top' | 'middle'; fewer?: number } = {}): MsgLay {
  const min = o.min ?? 48, lh = o.lineHeight ?? 1.28, maxLines = o.maxLines ?? 5;
  const [sMin, sMax] = o.sigSize ?? [36, 48];
  const sigFamily = o.sigFamily ?? family;
  const n = Array.from(text.replace(/\s/g, '')).length;
  // 很短的留言可以更大（它是畫面唯一的焦點）；長的留言字級上限低一點，不要擠成一團
  const maxBase = o.max ?? 140;
  const max = n <= 4 ? maxBase : n <= 10 ? maxBase * 0.86 : maxBase * 0.72;
  const fitAt = (sig: number) => {
    const room = box.h - (sigText ? sig * 1.75 : 0);
    const opt = { min, max: Math.max(min, max), lineHeight: lh, maxLines };
    const full = fitText(c, text, family, box.w, room, opt);
    for (let k = 1; k < full.lines.length; k++) {
      const f = fitText(c, text, family, box.w, room, { ...opt, maxLines: k });
      if (f.lines.length <= k && f.size >= Math.max(min, max) * (o.fewer ?? 0.6)) return f;
    }
    return full;
  };
  let sig = sMax, fit = fitAt(sig);
  sig = clamp(Math.round(fit.size * 0.42), sMin, sMax);
  fit = fitAt(sig);
  c.font = font(family, fit.size);
  const widths = fit.lines.map((l) => c.measureText(l).width);
  const maxW = Math.max(...widths);
  c.font = font(sigFamily, sig);
  const sigW = sigText ? c.measureText(sigText).width : 0;
  const gap = sigText ? Math.max(fit.lineHeight * 0.72, sig * 1.6) : 0;
  const blockH = fit.size + (fit.lines.length - 1) * fit.lineHeight + gap + (sigText ? sig * 0.25 : 0);
  const top = box.y + (o.valign === 'top' ? 0 : Math.max(0, (box.h - blockH) / 2));
  const base0 = top + fit.size * 0.88;
  const cx = box.x + box.w / 2;
  const align = o.align ?? 'center';
  const lines = fit.lines.map((ln, i) => ({ text: ln, x: align === 'center' ? cx - widths[i]! / 2 : box.x, y: base0 + i * fit.lineHeight, w: widths[i]! }));
  const right = align === 'center' ? cx + maxW / 2 : box.x + maxW;
  const sigY = lines[lines.length - 1]!.y + gap;
  const sigX = Math.min(box.x + box.w - sigW, Math.max(box.x, right - sigW));
  // 每個字的位置（逐字出現、字模用）
  const glyphs: Glyph[] = [];
  c.font = font(family, fit.size);
  lines.forEach((ln, r) => {
    let pre = '';
    for (const ch of Array.from(ln.text)) {
      const x = ln.x + (pre ? c.measureText(pre).width : 0);
      const w = c.measureText(ch).width;
      pre += ch;
      if (!ch.trim()) continue;
      glyphs.push({ ch, x, y: ln.y, w, size: fit.size, row: r });
    }
  });
  if (sigText) {
    c.font = font(sigFamily, sig);
    let pre = '';
    for (const ch of Array.from(sigText)) {
      const x = sigX + (pre ? c.measureText(pre).width : 0);
      const w = c.measureText(ch).width;
      pre += ch;
      if (!ch.trim()) continue;
      glyphs.push({ ch, x, y: sigY, w, size: sig, row: -1 });
    }
  }
  const x0 = Math.min(...lines.map((l) => l.x), sigText ? sigX : Infinity), x1 = Math.max(right, sigX + sigW);
  return {
    fit, family, lines, glyphs,
    sig: { text: sigText, x: sigX, y: sigY, size: sig, w: sigW, family: sigFamily },
    box: [x0, top, x1 - x0, (sigText ? sigY + sig * 0.3 : lines[lines.length - 1]!.y + fit.size * 0.25) - top],
  };
}

// ---------------------------------------------------------------- three.js
/** 自己寫的 three.js 材質（RawShaderMaterial、GLSL3），色票 uniform 共用；uniforms 用同一組物件，改一次全部跟著變。 */
export function rawMat(vert: string, frag: string, uniforms: Record<string, THREE.IUniform>, o: Partial<THREE.ShaderMaterialParameters> = {}) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: `precision highp float;\nprecision highp int;\n${vert}`,
    fragmentShader: `precision highp float;\nprecision highp int;\nout vec4 fragColor;\n${GLSL_COMMON}\n${frag}`,
    uniforms: { ...THEME_UNIFORMS, ...uniforms },
    ...o,
  });
}

/** 線性色票 × 倍數 → Vector3（three.js uniform 用）。 */
export const v3 = (rgb: [number, number, number], k = 1) => new THREE.Vector3(rgb[0] * k, rgb[1] * k, rgb[2] * k);
