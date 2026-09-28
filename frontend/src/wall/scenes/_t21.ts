// 批次 T21（印刷與紙：ink、watercolor、poster、magazine、bookshelf、polaroid）共用的小工具。
// 六個版面的手法各不相同（墨滴暈染的 shader、水彩刷過的留白膠、網版套色的合成、雜誌疊在桌上的 3D、
// 書架的 3D、拍立得的顯影），共用的只有：
//  - 要先載好的字（留言、署名、窗格裡的歌詞、歌名、邀請）；
//  - 紙的纖維：一張只烤一次的程序紋理（整晚共用、只存明暗，換主題不用重烤），宣紙、水彩紙、海報紙、相紙都取它；
//  - 「字模」：一串字畫成一張資料貼圖（清楚／暈開兩層＋每個字屬於哪一組），shader 用它讓字一組一組地出現（墨滴、刷過）；
//  - 字的分組：一行字切成幾個短組（標點處斷開、愛心自己一組），一組在一個拍點出現。
import * as THREE from 'three';
import type { Msg, SceneCtx } from '../engine/scene';
import { FSPass, makeRT } from '../engine/gl';
import { font, layout, loadText } from '../engine/type';
import { fitText, type FitResult } from '../engine/text';
import { clamp } from '../engine/util';
import { heartPoints, signature, COUPLE_ZH, DATE_DOTS } from './_motifs';

export type Rect = [number, number, number, number];
export type P2 = { x: number; y: number };

/** 右下角 HUD（QR）：字不要進到 x ≥ 1360 且 y ≥ 830。 */
export const HUD = { x: 1360, y: 830 };
/** 沒有留言時的邀請（整批一致的說法）。 */
export const T21_INVITE = '掃描右下角 QR code，把你的祝福寫上大螢幕';
/** 這批版面固定會出現的字（標籤、數字、符號）。 */
export const T21_TEXT = `${T21_INVITE}${COUPLE_ZH}${DATE_DOTS}一位賓客新郎新娘新人No.0123456789·—…♥♪（）()&:/.-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz`;

/** 署名：新人自己的留言寫「新郎新娘」。 */
export const sigOf = (m: Msg) => (m.couple ? '—— 新郎新娘' : signature(m.name));

/** 把這個窗格會畫到的字都載好（留言、署名、歌詞、歌名、版面自己的字）。 */
export async function loadAll(ctx: SceneCtx, extra = ''): Promise<void> {
  const m = ctx.params.message as Msg | null | undefined;
  const lyr = ctx.lyrics.linesIn(ctx.start - 2, ctx.end + 1).map((l) => l.text).join('');
  await loadText(`${T21_TEXT}${m ? m.text + sigOf(m) : ''}${lyr}${ctx.song.title}${ctx.song.artist ?? ''}${extra}`);
}

// ---------------------------------------------------------------- 紙的纖維（烤一次）
// R = 細顆粒、G = 長纖維（宣紙、棉紙的絲）、B = 大塊的雲紋（紙漿厚薄）、A = 水彩紙的凹凸（冷壓紙的齒）。
// 1024² 的貼圖，用鏡像重複鋪滿（接縫看不出來）；版面用 `t21Grain(p)` 取樣（p = 頁面 px）。
const GRAIN_BAKE = () => new FSPass(/* glsl */ `
  float ridge(vec2 p) { return pow(1.0 - abs(snoise(p)), 9.0); }
  void main() {
    vec2 p = gl_FragCoord.xy;
    float fine = 0.5 + 0.5 * (0.6 * snoise(p / 1.7) + 0.4 * snoise(p / 4.3 + 17.0));
    // 纖維：三個方向的細長脊線，彎一點（座標先用低頻雜訊扭過）
    vec2 w = p + 18.0 * vec2(snoise(p / 140.0), snoise(p / 140.0 + 9.0));
    float fib = 0.0;
    for (int i = 0; i < 3; i++) {
      float a = float(i) * 1.9 + 0.4;
      vec2 q = rot2(a) * w;
      fib = max(fib, ridge(vec2(q.x / 70.0, q.y / 2.2) + float(i) * 13.0) * smoothstep(0.1, 0.6, snoise(q / 90.0 + float(i) * 5.0)));
    }
    float mott = 0.5 + 0.5 * fbm(p / 260.0, 4);
    // 冷壓紙的齒：一顆一顆 5～9 px 的小丘
    float tooth = 0.5 + 0.5 * (0.65 * snoise(p / 5.5) + 0.35 * snoise(p / 13.0 + 3.0));
    fragColor = vec4(fine, fib, mott, tooth);
  }`);

let grainRT: THREE.WebGLRenderTarget | null = null;
/** 紙的纖維貼圖（第一次用到時烤；之後整晚共用）。 */
export function t21Grain(renderer: THREE.WebGLRenderer): THREE.Texture {
  if (!grainRT) {
    grainRT = makeRT(1024, 1024, { pxScale: 1, depthBuffer: false, wrapS: THREE.MirroredRepeatWrapping, wrapT: THREE.MirroredRepeatWrapping });
    const p = GRAIN_BAKE();
    p.render(renderer, grainRT);
    p.dispose();
  }
  return grainRT.texture;
}
/** GLSL：取紙的纖維（p = 頁面 px；1400 頁面 px 一張貼圖）。 */
export const GRAIN_GLSL = /* glsl */ `
uniform sampler2D grainTex;
vec4 paperGrain(vec2 p) { return textureLod(grainTex, p / 1400.0, 0.0); }`;

// ---------------------------------------------------------------- 字與分組
export interface TGlyph {
  ch: string;
  /** 左緣、基線（頁面 px）、字寬、字級、字族。 */
  x: number; y: number; w: number; size: number; family: string;
  /** 屬於第幾組（0..254）。 */
  g: number;
}
export interface TGroup {
  /** 組的外框（頁面 px）：左、上、寬、高（一行字的高度）。 */
  x: number; y: number; w: number; h: number;
  /** 組裡的字（索引）。 */
  from: number; to: number;
  /** 愛心自己一組（顏色不同）。 */
  heart: boolean;
}

const PUNCT = /[、。，．,.!?！？：；:;）)」』】〕〉》…～~]/;

/**
 * 一行字切成短組：每組最多 maxLen 個字；標點後面一定斷開；♥ 自己一組；英文單字不拆（空白處斷開）。
 * 回傳每個字的位置與分組（g 從 g0 起算）。
 */
export function groupLine(text: string, x: number, y: number, family: string, size: number, maxLen: number, g0: number, glyphs: TGlyph[], groups: TGroup[]) {
  const lay = layout(text, family, size);
  let cur: TGlyph[] = [];
  const flush = () => {
    const vis = cur.filter((q) => q.ch.trim());
    if (vis.length) {
      const gi = g0 + groups.length;
      const from = glyphs.length;
      for (const q of vis) glyphs.push({ ...q, g: gi });
      const x0 = vis[0]!.x, x1 = vis[vis.length - 1]!.x + vis[vis.length - 1]!.w;
      groups.push({ x: x0, y: y - size * 0.95, w: x1 - x0, h: size * 1.2, from, to: glyphs.length, heart: vis.every((q) => q.ch === '♥') });
    }
    cur = [];
  };
  const isLatin = (ch: string) => /[\p{Script=Latin}\p{N}'’&@#+-]/u.test(ch);
  for (let i = 0; i < lay.glyphs.length; i++) {
    const gl = lay.glyphs[i]!, ch = gl.ch;
    const q: TGlyph = { ch, x: x + gl.x, y, w: gl.w, size, family, g: 0 };
    const prev = cur[cur.length - 1];
    // 英文：一個單字算一個單位（字母數不算進 maxLen，太長的單字自己一組）
    const latinRun = prev && isLatin(ch) && isLatin(prev.ch);
    if (prev && !latinRun) {
      if (ch === '♥' || prev.ch === '♥' || PUNCT.test(prev.ch) || ch === ' ' || units(cur) >= maxLen) flush();
    }
    if (ch === ' ') continue;
    cur.push(q);
  }
  flush();
}
/** 一組裡有幾個「單位」（中文一字一個、英文一個單字一個）。 */
function units(cur: TGlyph[]) {
  let n = 0, inWord = false;
  for (const c of cur) {
    const lat = /[\p{Script=Latin}\p{N}]/u.test(c.ch);
    if (lat) { if (!inWord) n++; inWord = true; } else { n++; inWord = false; }
  }
  return n;
}

/** 畫一個字（♥ 換成我們自己的愛心，照字型裡 ♥ 的框放）。 */
export function glyphPath(c: CanvasRenderingContext2D, g: { ch: string; x: number; y: number; w: number; size: number; family: string }, mode: 'fill' | 'stroke' = 'fill') {
  if (g.ch === '♥') {
    const hp = heartPoints(48);
    const s = Math.min(g.w, g.size * 0.8) * 0.46, cx = g.x + g.w / 2, cy = g.y - g.size * 0.36;
    c.beginPath();
    hp.forEach((p, i) => (i ? c.lineTo(cx + p.x * s, cy + p.y * s) : c.moveTo(cx + p.x * s, cy + p.y * s)));
    c.closePath();
    if (mode === 'fill') c.fill(); else c.stroke();
    return;
  }
  c.font = font(g.family, g.size);
  if (mode === 'fill') c.fillText(g.ch, g.x, g.y); else c.strokeText(g.ch, g.x, g.y);
}

export interface GlyphMask { tex: THREE.DataTexture; idx: THREE.DataTexture; rect: Rect; w: number; h: number; dispose(): void }

/**
 * 字模（只做一次）：tex 的 R = 清楚的字、G = 暈開 b1 px、B = 暈開 b2 px、A = 加粗的字（thick px）。
 * idx（不內插，shader 用 texelFetch 讀）：R、G、B = 這個像素最近、第二近、第三近的組（255 = 沒有）。
 * 墨的暈、刷過的水痕會跨過組的邊界，所以 shader 同時看最近的三組（外加最近那組的前後各一組），邊界才不會有一條直直的切線。
 * 暈開用 canvas 的 filter 做一次（之後只取樣）。rect = 貼圖蓋住的頁面範圍；貼圖 1 px = 頁面 1 px。
 */
export function glyphMask(glyphs: TGlyph[], groups: TGroup[], b1: number, b2: number, pad = 120, reach = 150, thick = 0, heartR = false): GlyphMask {
  const xs = glyphs.map((g) => g.x), xe = glyphs.map((g) => g.x + g.w);
  const ys = glyphs.map((g) => g.y - g.size), ye = glyphs.map((g) => g.y + g.size * 0.3);
  const x0 = Math.floor(Math.min(...xs, ...groups.map((g) => g.x)) - pad), y0 = Math.floor(Math.min(...ys) - pad);
  const x1 = Math.ceil(Math.max(...xe, ...groups.map((g) => g.x + g.w)) + pad), y1 = Math.ceil(Math.max(...ye) + pad);
  const rect: Rect = [x0, y0, x1 - x0, y1 - y0];
  const w = rect[2], h = rect[3];
  const mk = () => {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d', { willReadFrequently: true })!;
    c.translate(-x0, -y0);
    c.textBaseline = 'alphabetic';
    return { cv, c };
  };
  // heartR：R 只放愛心、G／B 不含愛心（A 照樣有）——水彩的愛心先留白、刷過之後再用點綴色點上去
  const draw = (th: number, only?: (g: TGlyph) => boolean) => {
    const s = mk();
    s.c.fillStyle = '#fff'; s.c.strokeStyle = '#fff'; s.c.lineJoin = 'round'; s.c.lineWidth = th * 2;
    for (const g of glyphs) { if (only && !only(g)) continue; glyphPath(s.c, g); if (th > 0) glyphPath(s.c, g, 'stroke'); }
    return s;
  };
  const sharp = draw(0, heartR ? (g) => g.ch !== '♥' : undefined);
  const blur = (px: number) => {
    const b = mk();
    b.c.setTransform(1, 0, 0, 1, 0, 0);
    b.c.filter = `blur(${px}px)`;
    b.c.drawImage(sharp.cv, 0, 0);
    return b.c.getImageData(0, 0, w, h).data;
  };
  const G = blur(b1), B = blur(b2);
  const R = (heartR ? draw(0, (g) => g.ch === '♥') : sharp).c.getImageData(0, 0, w, h).data;
  const A = thick > 0 ? draw(thick).c.getImageData(0, 0, w, h).data : draw(0).c.getImageData(0, 0, w, h).data;
  // 每個像素最近的兩組（到組外框的距離；在框裡是負的）。只掃每組外框往外 reach 的範圍
  const d1 = new Float32Array(w * h).fill(1e9), d2 = new Float32Array(w * h).fill(1e9), d3 = new Float32Array(w * h).fill(1e9);
  const i1 = new Uint8Array(w * h).fill(255), i2 = new Uint8Array(w * h).fill(255), i3 = new Uint8Array(w * h).fill(255);
  groups.forEach((gr, gi) => {
    const cx = gr.x + gr.w / 2 - x0, cy = gr.y + gr.h / 2 - y0, hw = gr.w / 2, hh = gr.h / 2;
    const ax = Math.max(0, Math.floor(cx - hw - reach)), bx = Math.min(w, Math.ceil(cx + hw + reach));
    const ay = Math.max(0, Math.floor(cy - hh - reach)), by = Math.min(h, Math.ceil(cy + hh + reach));
    for (let yy = ay; yy < by; yy++) {
      const qy = Math.abs(yy + 0.5 - cy) - hh;
      for (let xx = ax; xx < bx; xx++) {
        const qx = Math.abs(xx + 0.5 - cx) - hw;
        const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
        if (d > reach) continue;
        const k = yy * w + xx;
        const g = clamp(gi, 0, 254);
        if (d < d1[k]!) { d3[k] = d2[k]!; i3[k] = i2[k]!; d2[k] = d1[k]!; i2[k] = i1[k]!; d1[k] = d; i1[k] = g; }
        else if (d < d2[k]!) { d3[k] = d2[k]!; i3[k] = i2[k]!; d2[k] = d; i2[k] = g; }
        else if (d < d3[k]!) { d3[k] = d; i3[k] = g; }
      }
    }
  });
  const out = new Uint8Array(w * h * 4), ix = new Uint8Array(w * h * 4);
  for (let i = 0, k = 0; k < w * h; i += 4, k++) {
    out[i] = R[i + 3]!; out[i + 1] = G[i + 3]!; out[i + 2] = B[i + 3]!; out[i + 3] = A[i + 3]!;
    ix[i] = i1[k]!; ix[i + 1] = i2[k]!; ix[i + 2] = i3[k]!; ix[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(out, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  const idx = new THREE.DataTexture(ix, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  idx.minFilter = idx.magFilter = THREE.NearestFilter;
  idx.generateMipmaps = false;
  idx.needsUpdate = true;
  return { tex, idx, rect, w, h, dispose: () => { tex.dispose(); idx.dispose(); } };
}

/** 幾個矩形的外框。 */
export function bbox(rs: Rect[], pad = 0): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y, w, h] of rs) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h); }
  return [Math.round(x0 - pad), Math.round(y0 - pad), Math.round(x1 - x0 + 2 * pad), Math.round(y1 - y0 + 2 * pad)];
}

// ---------------------------------------------------------------- 留言＋署名
export interface Block {
  fit: FitResult;
  family: string;
  /** 每一行（頁面座標：左緣、基線、寬）。 */
  lines: { text: string; x: number; y: number; w: number }[];
  sig: { text: string; x: number; y: number; size: number; w: number };
  /** 整塊（含署名）的外框。 */
  box: Rect;
}

/**
 * 在框裡排一則留言＋署名（跟 _t14 的 msgBlock 一樣：字級依「框高扣掉署名那一行」算，署名永遠在最後一行下面），
 * 但字級直接找最大的（不偏好少一行）：這批的留言是寫在大片的紙上、刷在帶子上，字大、行多比較好看。
 */
export function block(c: CanvasRenderingContext2D, m: Msg, family: string, box: { x: number; y: number; w: number; h: number }, o: { align?: 'left' | 'center'; sigFamily: string; sigMin?: number; sigMax?: number; min?: number; max?: number; lineHeight?: number; maxLines?: number; sigText?: string; valign?: number; prefer1?: number }): Block {
  const sigMin = o.sigMin ?? 40, sigMax = o.sigMax ?? 54;
  const fo = { min: o.min ?? 44, max: o.max ?? 130, lineHeight: o.lineHeight ?? 1.3, maxLines: o.maxLines ?? 5 };
  // prefer1：一行放得下、字級又不小於 prefer1 的短留言就排一行（「新婚快樂！！！」不要拆成「新婚／快樂！！！」）
  const fitAt = (h: number) => {
    const f = fitText(c, m.text, family, box.w, h, fo);
    if (o.prefer1 && f.lines.length > 1) {
      const one = fitText(c, m.text, family, box.w, h, { ...fo, maxLines: 1 });
      c.font = font(family, one.size);
      if (one.lines.length === 1 && c.measureText(m.text).width <= box.w * 1.001 && one.size >= o.prefer1) return one;
    }
    return f;
  };
  let sigSize = sigMax, fit = fitAt(box.h - sigSize * 1.7);
  sigSize = clamp(Math.round(fit.size * 0.45), sigMin, sigMax);
  fit = fitAt(box.h - sigSize * 1.7);
  const sigText = o.sigText ?? sigOf(m);
  c.font = font(family, fit.size);
  const widths = fit.lines.map((l) => c.measureText(l).width);
  const maxW = Math.max(...widths);
  c.font = font(o.sigFamily, sigSize);
  const sigW = c.measureText(sigText).width;
  const gap = Math.max(fit.lineHeight * 0.78, sigSize * 1.55);
  const blockH = fit.size + (fit.lines.length - 1) * fit.lineHeight + gap;
  const top = box.y + Math.max(0, (box.h - blockH) * (o.valign ?? 0.5));
  const base0 = top + fit.size * 0.9;
  const cx = box.x + box.w / 2;
  const lines = fit.lines.map((ln, i) => ({ text: ln, x: o.align === 'center' ? cx - widths[i]! / 2 : box.x, y: base0 + i * fit.lineHeight, w: widths[i]! }));
  const right = o.align === 'center' ? cx + maxW / 2 : box.x + maxW;
  const sigY = lines[lines.length - 1]!.y + gap;
  const sigX = Math.min(box.x + box.w - sigW, Math.max(box.x, right - sigW + sigSize * 0.6));
  const x0 = Math.min(...lines.map((l) => l.x), sigX), x1 = Math.max(right, sigX + sigW);
  return { fit, family, lines, sig: { text: sigText, x: sigX, y: sigY, size: sigSize, w: sigW }, box: [x0, top, x1 - x0, sigY + sigSize * 0.3 - top] };
}
