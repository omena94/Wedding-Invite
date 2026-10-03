// 批次 T25（旅途與時間：train、topo、bowling、lavalamp、stamp、clocktower）共用的小工具。
// 六個版面的手法各不相同（視差夜景＋起霧的窗、等高線 shader、three.js 保齡球道、metaball 熔岩燈、版畫郵票、石造鐘樓），
// 共用的只有「字」與「節拍」的部分：
//  - 留言＋署名的排版：字級依「扣掉署名之後的高度」算，署名永遠在最後一行下面（QA 的 K 情境）；
//    短的留言放得下一行就一行（不要拆成「新婚快／樂！！！」）。
//  - 窗格裡的拍點、小節線，n 個東西依序出現的時間表（兩小節的窗格也出得完）。
//  - 繞著圓排的字（鐘面、郵戳）做成「依序出現」的資料貼圖：G = 第幾個字、B = 字裡面的掃描順序、A = 覆蓋率，
//    shader 拿每個字的進度決定顏色——旋轉的字只在 init 光柵化一次，每格不用重畫。
//  - 亮版面的跟唱配色：訊號色在香檳、鼠尾草的紙上太淡，正在唱的字用 blood（訊號色的暗部）。
import * as THREE from 'three';
import type { AudioData } from '../engine/audio';
import type { Msg } from '../engine/scene';
import { font } from '../engine/type';
import { rgba } from '../engine/palette';
import { fitText, type FitResult } from '../engine/text';
import { clamp } from '../engine/util';
import { Lyrics, type Line } from '../engine/lyrics';
import { GLSL_COMMON, THEME_UNIFORMS } from '../engine/glsl/common';
import { signature, COUPLE_ZH, DATE_DOTS, fillWithHearts, heartPoints, type LyricStyle } from './_motifs';
import { V2, msgMaxFor, sigV2, fitClauses } from './_v2';

export type Rect = [number, number, number, number];
export type P2 = { x: number; y: number };

/** 右下角 HUD（QR）：字不要進到 x ≥ 1360 且 y ≥ 830。 */
export const HUD = { x: 1360, y: 830 };
/** 沒有留言時的邀請（整批一致，小字）。 */
export const T25_INVITE = '掃描右下角 QR code，把你的祝福傳上大螢幕';
/** 這批固定會出現的字（init 時一次載好：數字、符號也要，沒載好第一格會用系統字頂替）。 */
export const T25_TEXT = `${T25_INVITE}一位賓客${COUPLE_ZH}${DATE_DOTS}新人0123456789·—…：:%♪=()（）＊IVXLC.,/-+°′″ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz`;

/** 署名：新人自己的留言署新人的名字（COUPLE_ZH）。 */
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
  const per = n <= 1 ? 1 : [1, 2, 4, 8, 16].find((k) => (n - 1) / k <= budget) ?? (n - 1) / budget;
  return Array.from({ length: n }, (_, i) => au.timeOfBeat(b0 + i / per));
}

/** t 之前（含）最近的一個時間點（都還沒到是 -Infinity）。ts 要排序好。 */
export function lastBefore(ts: number[], t: number): number {
  let r = -Infinity;
  for (const x of ts) { if (x <= t) r = x; else break; }
  return r;
}

// ---------------------------------------------------------------- 跟唱配色
/** 亮版面（紙）上的跟唱配色：正在唱用 blood（訊號色在淡色主題的紙上太淡）。 */
export const paperLyric = (): Pick<LyricStyle, 'active' | 'sung' | 'unsung'> => ({ active: rgba('blood'), sung: rgba('sepia', 0.95), unsung: rgba('sepia', 0.28) });

/**
 * 一行歌詞每個「字」（中文一個字、英文一個字母）的跟唱狀態：[已經唱過的比例 0..1, 這個字所在的詞唱完了沒 0/1]。
 * 跟 drawLyric 同一套規則：唱到的詞從左掃到右（訊號色），整個詞唱完才變紙白。
 */
export function glyphStates(line: Line, t: number): { ch: string; p: number; done: boolean }[] {
  const out: { ch: string; p: number; done: boolean }[] = [];
  for (const w of line.words) {
    const p = Lyrics.wordProgress(w, t);
    // 詞前後的空白（英文）不算字，序號才跟字模對得上
    const chars = Array.from(w.w).filter((ch) => ch.trim());
    const n = chars.length;
    chars.forEach((ch, j) => out.push({ ch, p: clamp(p * n - j), done: p >= 1 }));
  }
  return out;
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
  return placeMsg(c, fit, family, sigText, sig, sigFamily, box, o.align ?? 'center', o.valign);
}

/**
 * 留言尺寸標準 v2（docs/wall/TREATMENT.md、_v2.ts）的留言排版：字級上限照字數（msgMaxFor），下限 40；
 * 署名 26～32；先照子句斷行（fitClauses，不要斷出「這一天，要／一直」），放不下才交給 fitText。
 * k：畫布（或貼圖）上 1 個螢幕 px 是幾個 px——字寫在會縮放的物件上（3D 布幕、有鏡頭推近的平面）時用來換算，
 * 回傳的 screen 是留言在螢幕上的字級（給 lyricV2 算歌詞字級）。
 * max：螢幕 px 的字級上限（預設照字數 msgMaxFor）；拿來排「當焦點的歌詞」時傳 V2.lyrMax。
 */
export function layMsgV2(c: CanvasRenderingContext2D, text: string, sigText: string, family: string, box: { x: number; y: number; w: number; h: number },
  o: { k?: number; max?: number; lineHeight?: number; maxLines?: number; sigFamily?: string; align?: 'left' | 'center'; valign?: 'top' | 'middle' } = {}): MsgLay & { screen: number } {
  const k = o.k ?? 1, lh = o.lineHeight ?? 1.3, maxLines = o.maxLines ?? 5;
  const sigFamily = o.sigFamily ?? family;
  const opt = { min: V2.msgMin * k, max: (o.max ?? msgMaxFor(text)) * k, lineHeight: lh, maxLines };
  const fitAt = (sigPx: number) => {
    const room = box.h - (sigText ? sigPx * 1.9 : 0);
    return fitClauses(c, text, family, box.w, room, opt) ?? fitText(c, text, family, box.w, room, opt);
  };
  let sig = sigText ? sigV2(opt.max / k) * k : 0;
  let fit = fitAt(sig);
  sig = sigText ? sigV2(fit.size / k) * k : 0;
  fit = fitAt(sig);
  return { ...placeMsg(c, fit, family, sigText, sig, sigFamily, box, o.align ?? 'left', o.valign), screen: fit.size / k };
}

/** 把找好字級與斷行的留言放進框裡（署名在最後一行下面、靠右對齊最長那一行），算出每個字的位置。 */
function placeMsg(c: CanvasRenderingContext2D, fit: FitResult, family: string, sigText: string, sig: number, sigFamily: string, box: { x: number; y: number; w: number; h: number }, align: 'left' | 'center', valign?: 'top' | 'middle'): MsgLay {
  c.font = font(family, fit.size);
  const widths = fit.lines.map((l) => c.measureText(l).width);
  const maxW = Math.max(...widths);
  c.font = font(sigFamily, sig);
  const sigW = sigText ? c.measureText(sigText).width : 0;
  const gap = sigText ? Math.max(fit.lineHeight * 0.72, sig * 1.6) : 0;
  const blockH = fit.size + (fit.lines.length - 1) * fit.lineHeight + gap + (sigText ? sig * 0.25 : 0);
  const top = box.y + (valign === 'top' ? 0 : Math.max(0, (box.h - blockH) / 2));
  const base0 = top + fit.size * 0.88;
  const cx = box.x + box.w / 2;
  const lines = fit.lines.map((ln, i) => ({ text: ln, x: align === 'center' ? cx - widths[i]! / 2 : box.x, y: base0 + i * fit.lineHeight, w: widths[i]! }));
  const right = align === 'center' ? cx + maxW / 2 : box.x + maxW;
  const sigY = lines[lines.length - 1]!.y + gap;
  const sigX = Math.min(box.x + box.w - sigW, Math.max(box.x, right - sigW));
  // 每個字的位置（逐字出現、字模用）
  const glyphs: Glyph[] = [];
  const push = (s: string, x0: number, y: number, size: number, row: number) => {
    let pre = '';
    for (const ch of Array.from(s)) {
      const x = x0 + (pre ? c.measureText(pre).width : 0);
      const w = c.measureText(ch).width;
      pre += ch;
      if (!ch.trim()) continue;
      glyphs.push({ ch, x, y, w, size, row });
    }
  };
  c.font = font(family, fit.size);
  lines.forEach((ln, r) => push(ln.text, ln.x, ln.y, fit.size, r));
  if (sigText) { c.font = font(sigFamily, sig); push(sigText, sigX, sigY, sig, -1); }
  const x0 = Math.min(...lines.map((l) => l.x), sigText ? sigX : Infinity), x1 = Math.max(right, sigX + sigW);
  return {
    fit, family, lines, glyphs,
    sig: { text: sigText, x: sigX, y: sigY, size: sig, w: sigW, family: sigFamily },
    box: [x0, top, x1 - x0, (sigText ? sigY + sig * 0.3 : lines[lines.length - 1]!.y + fit.size * 0.25) - top],
  };
}

/** 畫排好的留言（全部或前 chars 個字）；♥ 用點綴色。 */
export function drawMsg(c: CanvasRenderingContext2D, m: MsgLay, color: string, o: { chars?: number; sigColor?: string; heart?: string } = {}) {
  let left = o.chars ?? Infinity;
  c.save();
  c.textBaseline = 'alphabetic';
  c.fillStyle = color;
  c.font = font(m.family, m.fit.size);
  for (const ln of m.lines) {
    if (left <= 0) break;
    // 只算非空白的字（跟 glyphs 的序號一致）
    let shown = '';
    for (const ch of Array.from(ln.text)) {
      if (ch.trim()) { if (left < 1) break; left--; }
      shown += ch;
    }
    fillWithHearts(c, shown, ln.x, ln.y, o.heart);
  }
  if (m.sig.text && left > 0) {
    c.font = font(m.sig.family, m.sig.size);
    c.fillStyle = o.sigColor ?? color;
    c.fillText(m.sig.text, m.sig.x, m.sig.y);
  }
  c.restore();
}

// ---------------------------------------------------------------- 字模（資料貼圖）
/** 一個要進字模的字：左緣與基線、字寬、字級、字族、旋轉（繞 (x, y) 轉，弧度）、序號、標記。 */
export interface MaskGlyph { ch: string; x: number; y: number; w: number; size: number; family: string; rot?: number; idx: number; tag?: number }
export interface GlyphMask { tex: THREE.DataTexture; rect: Rect; scale: number; dispose(): void }

/**
 * 把一串字畫成資料貼圖：A = 覆蓋率、G = 第幾個字（0..254）、B = 字裡面由左到右的掃描順序（0..255）、R = 標記（愛心 255）。
 * 字可以旋轉（鐘面上一圈的字）：旋轉的字只在這裡光柵化一次，之後 shader 取樣就好。
 * 顏色用粗描邊多蓋幾 px（字的邊緣是半透明的，直接讀會讀到背景的 0），覆蓋率用填色。
 */
export function glyphMask(items: MaskGlyph[], rect: Rect, scale = 1, pad = 3, o: { blur?: number; thick?: number } = {}): GlyphMask {
  const w = Math.max(1, Math.ceil(rect[2] * scale)), h = Math.max(1, Math.ceil(rect[3] * scale));
  const mk = () => {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d', { willReadFrequently: true })!;
    c.textBaseline = 'alphabetic';
    return { cv, c };
  };
  const A = mk(), B = mk();
  // 覆蓋率可以加粗、模糊（手指在霧上寫的字比字型的筆畫粗、邊緣糊）；只在這裡做一次
  if (o.blur) B.c.filter = `blur(${o.blur * scale}px)`;
  const heart = heartPoints(48);
  for (const g of items) {
    for (const k of [A, B]) {
      const c = k.c;
      c.setTransform(scale, 0, 0, scale, -rect[0] * scale, -rect[1] * scale);
      c.translate(g.x, g.y);
      if (g.rot) c.rotate(g.rot);
    }
    const r = g.ch === '♥' ? 255 : clamp(Math.round(g.tag ?? 0), 0, 254), idx = clamp(Math.round(g.idx), 0, 254);
    const gr = A.c.createLinearGradient(0, 0, g.w, 0);
    gr.addColorStop(0, `rgb(${r},${idx},0)`);
    gr.addColorStop(1, `rgb(${r},${idx},255)`);
    A.c.fillStyle = gr; A.c.strokeStyle = gr; A.c.lineWidth = (pad * 2) / scale; A.c.lineJoin = 'round';
    B.c.fillStyle = '#fff';
    if (g.ch === '♥') {
      // 愛心：照字型裡 ♥ 的框放我們自己的愛心（風格聖經：愛心只用自己畫的那顆）
      const s = Math.min(g.w, g.size * 0.8) * 0.46, cx = g.w / 2, cy = -g.size * 0.36;
      for (const k of [A, B]) {
        const c = k.c;
        c.beginPath();
        heart.forEach((p, i) => (i ? c.lineTo(cx + p.x * s, cy + p.y * s) : c.moveTo(cx + p.x * s, cy + p.y * s)));
        c.closePath();
        c.fill();
        if (k === A) c.stroke();
      }
      continue;
    }
    A.c.font = B.c.font = font(g.family, g.size);
    A.c.strokeText(g.ch, 0, 0);
    A.c.fillText(g.ch, 0, 0);
    if (o.thick) { B.c.strokeStyle = '#fff'; B.c.lineWidth = o.thick * 2; B.c.lineJoin = 'round'; B.c.strokeText(g.ch, 0, 0); }
    B.c.fillText(g.ch, 0, 0);
  }
  const a = A.c.getImageData(0, 0, w, h).data, b = B.c.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h * 4);
  // 貼圖的第 0 列要是畫面的最下面（跟 flipY 的 CanvasTexture 一樣，shader 用 1 - y 取樣）
  for (let y = 0; y < h; y++) {
    const src = y * w * 4, dst = (h - 1 - y) * w * 4;
    for (let i = 0; i < w * 4; i += 4) {
      out[dst + i] = a[src + i]!; out[dst + i + 1] = a[src + i + 1]!; out[dst + i + 2] = a[src + i + 2]!; out[dst + i + 3] = b[src + i + 3]!;
    }
  }
  A.cv.width = A.cv.height = B.cv.width = B.cv.height = 0;
  const tex = new THREE.DataTexture(out, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return { tex, rect, scale, dispose: () => tex.dispose() };
}

/** 排好的留言 → 字模用的字（序號照出現的順序，署名標 128）。 */
export function msgGlyphs(m: MsgLay, idx0 = 0): MaskGlyph[] {
  return m.glyphs.map((g, i) => ({ ch: g.ch, x: g.x, y: g.y, w: g.w, size: g.size, family: g.row < 0 ? m.sig.family : m.family, idx: idx0 + i, tag: g.row < 0 ? 128 : 0 }));
}

/** GLSL：取樣字模（rect = 頁面範圍 x, y, w, h；p = 頁面座標，y 向下）。 */
export const MASK_GLSL = /* glsl */ `
vec4 maskAt(sampler2D m, vec4 rect, vec2 p) {
  vec2 uv = (p - rect.xy) / rect.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  return textureLod(m, vec2(uv.x, 1.0 - uv.y), 0.0);
}`;

// ---------------------------------------------------------------- three.js
/** 自己寫的 three.js 材質（RawShaderMaterial、GLSL3），色票 uniform 共用。 */
export function rawMat(vert: string, frag: string, uniforms: Record<string, THREE.IUniform>, o: Partial<THREE.ShaderMaterialParameters> = {}) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: `precision highp float;\nprecision highp int;\n${vert}`,
    fragmentShader: `precision highp float;\nprecision highp int;\nout vec4 fragColor;\n${GLSL_COMMON}\n${frag}`,
    uniforms: { ...THEME_UNIFORMS, ...uniforms },
    ...o,
  });
}
