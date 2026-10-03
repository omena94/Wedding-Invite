// 施工藍圖（暗）：「我們的家」的平面圖，印在主題色的曬圖紙上（燭光金是棕色的、薰衣草是藍紫色的，換主題整張跟著變）。
// 一支繪圖筆（仙女棒的火花當筆尖）在拍點上把整張圖畫出來，畫過的線先是燒紅的（訊號色、會發光），半秒內冷卻成曬圖紙上的白線。
//  - 一個窗格的順序：第一拍起先畫外牆四邊，筆從廚房角落拉一條引線出來，接著把主打留言一個字一個字「標註」在圖的右邊
//    （白色鉛筆的手寫字，這一張的焦點：最大、最亮），署名；然後筆回到圖上，把內牆、門、窗、尺寸線、家具一組一組補完。
//  - 房間名稱是歌詞：每一句歌詞「住進」一個房間（客廳 → 主臥 → 廚房輪流），房間在那一句開始時斜線打底，字照跟唱規則逐字亮，
//    字比留言小一號；唱完就淡出（畫面上的大字只有留言與正在唱的這一句），房間只留小小的房名。圖畫完之後，每換一句，筆就沿著那個房間描一圈。
//  - 冷面的細節都很小、很淡：尺寸 3,600／婚禮那一年（沒定日期時 2,400）、5,200、1,314，總長「∞」；起居角的一張懶骨頭與一盆盆栽；
//    左下角一行圖說「我們的家　平面圖　A-01　婚禮日期　比例 1 : 1（實際大小）」（沒定日期就整段省掉）。
//  - 鏡頭：整個窗格很慢地推近，第一拍輕輕一震；曬圖紙上有一塊比較亮的光（留言那一帶）。
//  - 純音樂：房間只有小小的房名；沒有留言：歌詞是焦點（房間裡的字大一點），右邊淡淡寫一句邀請；新人的留言：標註旁寫「設計者附註」。
// 畫法：曬圖紙（不均勻的曝光、格線、摺痕、圖框、正在唱的房間的斜線）是全螢幕 shader；平面圖所有的線是一個 LineBatch
// （每一小段記得自己是什麼時候被畫到的，才有「冷卻」）；字是一張每格重畫的 Canvas 層。鏡頭是 2D 的推鏡，三者一起套。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, layout, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog, pulse } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import type { Line } from '../engine/lyrics';
import { drawLyric, signature, sparkHead, sparkParticles, drawHeart, DATE, DATE_DOTS, joinBits, lyricSubOf, layoutLyric, subGap, type LyricStyle, type LyricLayout } from './_motifs';
import { grid, stagger, windowLines, boxLyric, mono, tag, pad3, fiberBake, fiberTex, inOut, type Grid, type P2, type Rect } from './_t3';
import { msgMaxFor, lyricV2, sigV2, fitClauses, V2 } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'doc', paper: false, energy: [0.2, 0.85], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 平面圖（世界座標 = 鏡頭沒推時的螢幕 px，y 向下；都是牆的中心線）
const X0 = 168, X1 = 938, Y0 = 208, Y1 = 896;
const XA = 548; // 主臥｜廚房
const YB = 548; // 上排｜下排
const XC = 668; // 客廳｜起居角、玄關
const YD = 752; // 起居角｜玄關
const WX = 11, WI = 6; // 外牆、內牆粗細
/** 右邊的標註（留言）。 */
const NOTE = { x: 1030, y: 176, w: 690, h: 560 };
/** 廚房角落的 ① 記號（引線從這裡拉到標註）。 */
const MARK = { x: 906, y: 330 };
/** 鏡頭推的中心（世界座標）：整張圖（尺寸線到標註）的中間。 */
const CAM = { x: 925, y: 536 };
/** 鏡頭推近的平均倍數（v2 的字級是螢幕 px，排版時換成世界座標用）。 */
const ZK = 1.03;

interface Room { zh: string; en: string; r: [number, number, number, number]; box: Rect; tagAt: P2 }
/** 會住進歌詞的三個房間（依序輪流），框避開家具與門。 */
const ROOMS: Room[] = [
  { zh: '客廳', en: 'LIVING', r: [X0, YB, XC, Y1], box: [X0 + 34, YB + 80, XC - X0 - 60, 190], tagAt: { x: X0 + 34, y: YB + 44 } },
  { zh: '主臥', en: 'MASTER', r: [X0, Y0, XA, YB], box: [X0 + 88, Y0 + 62, XA - X0 - 112, 266], tagAt: { x: X0 + 88, y: Y0 + 40 } },
  { zh: '廚房', en: 'KITCHEN', r: [XA, Y0, X1, YB], box: [XA + 30, Y0 + 104, 290, 222], tagAt: { x: XA + 30, y: Y0 + 90 } },
];
const LYR_FAM = F.archivo(75, 700);
const MSG_FAM = F.hand(400);
const FIXED = '我們的家平面圖比例實際大小附註設計者本案尚缺一則祝福請掃描右下角把給新人的話標註在這裡懶骨頭盆栽客廳主臥廚房';
/** 上排右邊那段尺寸：有日期就寫婚禮那一年（寫成「2,0xx」這種尺寸的樣子，冷面的彩蛋），沒有就是一個普通的尺寸。 */
const DIM_YEAR = DATE ? `${DATE.yyyy.slice(0, 1)},${DATE.yyyy.slice(1)}` : '2,400';
/** 左下角的圖說：沒定日期時日期那一段連同分隔一起省掉。 */
const CAPTION = joinBits('　', '我們的家', '平面圖', 'A-01', DATE_DOTS.replace(/ /g, ''), '比例 1 : 1（實際大小）');

// ---------------------------------------------------------------- 曬圖紙
const PAPER = () => new FSPass(/* glsl */ `
  uniform sampler2D fiber; uniform vec3 cam; uniform vec4 room; uniform float roomK; uniform vec2 light; uniform vec2 sweep;
  void main() {
    vec2 s = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = (s - cam.xy) / cam.z; // 螢幕 → 世界
    vec4 fb = texture(fiber, fract(p / vec2(${W}.0, ${H}.0)));
    // 曬圖紙：訊號色的暗部壓暗；曝光不均勻（大片雲紋）、纖維、邊緣化學藥水的暗漬
    vec3 base = mix(C_INK, C_BLOOD, 0.36) * 0.84;
    float expo = 0.86 + 0.24 * (fb.r - 0.5) + 0.04 * (fb.g - 0.5);
    float edge = smoothstep(0.0, 300.0, min(min(p.x, ${W}.0 - p.x), min(p.y, ${H}.0 - p.y)));
    vec3 col = base * expo * (0.7 + 0.3 * edge);
    // 一塊比較亮的光（像檯燈照著留言那一帶），讓畫面有空氣
    vec2 lq = (p - light) / vec2(820.0, 560.0);
    col *= 0.9 + 0.28 * exp(-dot(lq, lq));
    // 曬圖機的燈條：每四小節從左掃到右一次（很淡），紙上有光在走
    col += C_BONE * 0.04 * sweep.y * exp(-pow((p.x - sweep.x) / 70.0, 2.0));
    // 細格（25 px）與粗格（125 px）：很淡
    vec2 g = abs(fract(p / 25.0 + 0.5) - 0.5) * 25.0, G = abs(fract(p / 125.0 + 0.5) - 0.5) * 125.0;
    float gr = max(pxLine(g.x * cam.z, 0.2, 1.0), pxLine(g.y * cam.z, 0.2, 1.0)) * 0.022 + max(pxLine(G.x * cam.z, 0.4, 1.3), pxLine(G.y * cam.z, 0.4, 1.3)) * 0.04;
    col = mix(col, C_BONE, gr);
    // 摺痕：兩條直的、一條橫的（一邊亮一邊暗，像摺過又攤平）
    float fx1 = p.x - 640.0, fx2 = p.x - 1280.0, fy = p.y - 540.0;
    col *= 1.0 + 0.04 * (exp(-abs(fx1) * 0.35) * sign(fx1) + exp(-abs(fx2) * 0.35) * sign(fx2) + exp(-abs(fy) * 0.35) * sign(fy));
    // 圖框：外細內粗兩道（淡）
    vec2 q = min(p, vec2(${W}.0, ${H}.0) - p);
    float fr = pxLine(abs(min(q.x, q.y) - 52.0) * cam.z, 0.4, 1.2) * 0.3 + pxLine(abs(min(q.x, q.y) - 60.0) * cam.z, 1.0, 1.8) * 0.4;
    col = mix(col, C_BONE, fr * 0.7);
    // 正在唱的房間：斜線打底（由左往右掃進來）
    vec2 rp = p - room.xy, rs = room.zw - room.xy;
    float inR = step(0.0, rp.x) * step(rp.x, rs.x) * step(0.0, rp.y) * step(rp.y, rs.y) * step(rp.x, rs.x * roomK);
    float hat = pxLine(abs(fract((p.x + p.y) / 14.0 + 0.5) - 0.5) * 14.0 * cam.z, 0.45, 1.2);
    col = mix(col, C_SIGNAL, hat * inR * 0.16);
    col += C_SIGNAL * inR * 0.025;
    fragColor = vec4(col, 1.0);
  }`, { fiber: { value: null }, cam: { value: new THREE.Vector3(0, 0, 1) }, room: { value: new THREE.Vector4() }, roomK: { value: 0 }, light: { value: new THREE.Vector2(1300, 460) }, sweep: { value: new THREE.Vector2(0, 0) } });

// ---------------------------------------------------------------- 線稿
/** 一筆（一條折線）：寬度、透明度。畫的時候拆成 ≤ 22 px 的小段，每段記得自己在這一組的第幾 px 被畫到。 */
interface Stroke { pts: P2[]; w: number; a: number }
interface Seg { ax: number; ay: number; bx: number; by: number; s0: number; s1: number; w: number; a: number }
interface Group { segs: Seg[]; len: number; t0: number; t1: number; label: string }

const poly = (pts: [number, number][], w: number, a = 1): Stroke => ({ pts: pts.map(([x, y]) => ({ x, y })), w, a });
const arc = (cx: number, cy: number, r: number, a0: number, a1: number, w: number, a = 1, n = 18): Stroke =>
  ({ pts: Array.from({ length: n + 1 }, (_, i) => { const u = a0 + ((a1 - a0) * i) / n; return { x: cx + Math.cos(u) * r, y: cy + Math.sin(u) * r }; }), w, a });
const rect = (x: number, y: number, w: number, h: number, lw: number, a = 1): Stroke => poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]], lw, a);
/** 一道牆：從 a 到 b（水平或垂直），中間挖掉幾個開口（門、窗）。 */
function wall(ax: number, ay: number, bx: number, by: number, gaps: [number, number][], w: number): Stroke[] {
  const hor = ay === by;
  const lo = hor ? Math.min(ax, bx) : Math.min(ay, by), hi = hor ? Math.max(ax, bx) : Math.max(ay, by);
  const rev = hor ? bx < ax : by < ay;
  const spans: [number, number][] = [];
  let cur = lo;
  for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) { if (g0 > cur) spans.push([cur, g0]); cur = Math.max(cur, g1); }
  if (cur < hi) spans.push([cur, hi]);
  if (rev) spans.reverse();
  return spans.map(([a, b]) => {
    const [s, e] = rev ? [b, a] : [a, b];
    return hor ? poly([[s, ay], [e, ay]], w, 0.85) : poly([[ax, s], [ax, e]], w, 0.85);
  });
}
function windowH(y: number, x0: number, x1: number, t: number): Stroke[] {
  return [poly([[x0, y - t / 2], [x0, y + t / 2]], 1.8, 0.7), poly([[x0, y - t / 2], [x1, y - t / 2]], 1.2, 0.55), poly([[x0, y], [x1, y]], 1.2, 0.55), poly([[x0, y + t / 2], [x1, y + t / 2]], 1.2, 0.55), poly([[x1, y - t / 2], [x1, y + t / 2]], 1.8, 0.7)];
}
function windowV(x: number, y0: number, y1: number, t: number): Stroke[] {
  return [poly([[x - t / 2, y0], [x + t / 2, y0]], 1.8, 0.7), poly([[x - t / 2, y0], [x - t / 2, y1]], 1.2, 0.55), poly([[x, y0], [x, y1]], 1.2, 0.55), poly([[x + t / 2, y0], [x + t / 2, y1]], 1.2, 0.55), poly([[x - t / 2, y1], [x + t / 2, y1]], 1.8, 0.7)];
}
function dimH(y: number, xs: number[], ext: number): Stroke[] {
  const out: Stroke[] = [poly([[xs[0]! - 14, y], [xs[xs.length - 1]! + 14, y]], 1.1, 0.5)];
  for (const x of xs) { out.push(poly([[x, y - 8], [x, y + ext]], 1, 0.35)); out.push(poly([[x - 6, y + 6], [x + 6, y - 6]], 1.8, 0.6)); }
  return out;
}
function dimV(x: number, ys: number[], ext: number): Stroke[] {
  const out: Stroke[] = [poly([[x, ys[0]! - 14], [x, ys[ys.length - 1]! + 14]], 1.1, 0.5)];
  for (const y of ys) { out.push(poly([[x - 8, y], [x + ext, y]], 1, 0.35)); out.push(poly([[x - 6, y + 6], [x + 6, y - 6]], 1.8, 0.6)); }
  return out;
}
function dashed(ax: number, ay: number, bx: number, by: number, dash: number, gap: number, w: number, a = 1): Stroke[] {
  const L = Math.hypot(bx - ax, by - ay), out: Stroke[] = [];
  for (let s = 0; s < L; s += dash + gap) {
    const e = Math.min(L, s + dash);
    out.push(poly([[ax + ((bx - ax) * s) / L, ay + ((by - ay) * s) / L], [ax + ((bx - ax) * e) / L, ay + ((by - ay) * e) / L]], w, a));
  }
  return out;
}

/** 第一段：外牆四邊與引線（留言之前畫完）。 */
function planA(noteY: number): { label: string; strokes: Stroke[] }[] {
  return [
    { label: 'N', strokes: wall(X0 - WX / 2, Y0, X1 + WX / 2, Y0, [[290, 470], [640, 790]], WX) },
    { label: 'E', strokes: wall(X1, Y0, X1, Y1 + WX / 2, [[596, 700]], WX) },
    { label: 'S', strokes: wall(X1 + WX / 2, Y1, X0 - WX / 2, Y1, [[770, 852], [292, 500]], WX) },
    { label: 'W', strokes: wall(X0, Y1, X0, Y0 - WX / 2, [[650, 800]], WX) },
    { label: 'NOTE', strokes: [arc(MARK.x, MARK.y, 14, -Math.PI / 2, Math.PI * 1.5, 1.6, 0.9, 20), ...dashed(MARK.x + 16, MARK.y, NOTE.x - 60, MARK.y, 10, 7, 1.3, 0.6), poly([[NOTE.x - 60, MARK.y], [NOTE.x - 24, noteY]], 1.3, 0.6)] },
  ];
}
/** 第二段：寫完留言後補的細節。 */
function planB(): { label: string; strokes: Stroke[] }[] {
  return [
    { label: 'B', strokes: wall(X0 + WX / 2, YB, X1 - WX / 2, YB, [[452, 528], [562, 652]], WI) },
    { label: 'ACD', strokes: [...wall(XA, Y0 + WX / 2, XA, YB, [], WI), ...wall(XC, YB, XC, Y1 - WX / 2, [[572, 648], [780, 866]], WI), ...wall(XC, YD, X1 - WX / 2, YD, [], WI)] },
    { label: 'DOOR', strokes: [
      poly([[452, YB], [452, YB + 76]], 1.8, 0.7), arc(452, YB, 76, Math.PI / 2, 0, 1.1, 0.45),
      poly([[XC, 572], [XC + 76, 572]], 1.8, 0.7), arc(XC, 572, 76, 0, Math.PI / 2, 1.1, 0.45),
      poly([[770, Y1], [770, Y1 - 82]], 1.8, 0.7), arc(770, Y1, 82, -Math.PI / 2, 0, 1.1, 0.45),
    ] },
    { label: 'WIN', strokes: [...windowH(Y0, 290, 470, WX), ...windowH(Y0, 640, 790, WX), ...windowV(X1, 596, 700, WX), ...windowH(Y1, 292, 500, WX), ...windowV(X0, 650, 800, WX)] },
    { label: 'DIM', strokes: [...dimH(160, [X0, XA, X1], 34), ...dimH(128, [X0, X1], 20), ...dimV(128, [Y0, YB, Y1], 30)] },
    { label: 'FURN1', strokes: [
      rect(X0 + 10, Y0 + 30, 50, 280, 1.4, 0.45), ...dashed(X0 + 35, Y0 + 38, X0 + 35, Y0 + 302, 8, 6, 1, 0.3),
      rect(XA + 8, Y0 + 8, X1 - XA - 16, 56, 1.4, 0.45), rect(XA + 70, Y0 + 16, 86, 40, 1.2, 0.45),
      arc(XA + 250, Y0 + 36, 14, 0, Math.PI * 2, 1.2, 0.45, 16), arc(XA + 292, Y0 + 36, 14, 0, Math.PI * 2, 1.2, 0.45, 16), arc(XA + 334, Y0 + 36, 10, 0, Math.PI * 2, 1.2, 0.45, 14),
    ] },
    { label: 'FURN2', strokes: [
      rect(252, Y1 - 76, 330, 66, 1.4, 0.45), poly([[252, Y1 - 26], [582, Y1 - 26]], 1, 0.35), poly([[362, Y1 - 76], [362, Y1 - 26]], 1, 0.3), poly([[472, Y1 - 76], [472, Y1 - 26]], 1, 0.3),
      arc(784, 672, 46, 0, Math.PI * 2, 1.4, 0.5, 28), arc(784, 672, 36, 0, Math.PI * 2, 1, 0.3, 26),
      arc(880, 690, 36, 0, Math.PI * 2, 1.4, 0.5, 24), arc(880, 690, 27, 0, Math.PI * 2, 1, 0.3, 22),
      arc(868, 598, 10, 0, Math.PI * 2, 1.2, 0.45, 12), arc(896, 598, 10, 0, Math.PI * 2, 1.2, 0.45, 12),
      arc(836, 732, 8, 0, Math.PI * 2, 1.2, 0.55, 12),
      rect(X1 - 52, YD + 12, 42, 112, 1.4, 0.45),
    ] },
  ];
}

/** 拆成小段，記下每段在組裡的弧長位置（s0..s1）：「冷卻」與筆尖都靠它。 */
function toSegs(strokes: Stroke[]): { segs: Seg[]; len: number } {
  const segs: Seg[] = [];
  let s = 0;
  for (const st of strokes) {
    for (let i = 1; i < st.pts.length; i++) {
      const a = st.pts[i - 1]!, b = st.pts[i]!;
      const L = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(L / 22));
      for (let k = 0; k < n; k++) {
        const u0 = k / n, u1 = (k + 1) / n;
        segs.push({ ax: lerp(a.x, b.x, u0), ay: lerp(a.y, b.y, u0), bx: lerp(a.x, b.x, u1), by: lerp(a.y, b.y, u1), s0: s + L * u0, s1: s + L * u1, w: st.w, a: st.a });
      }
      s += L;
    }
  }
  return { segs, len: s };
}

/** 一句歌詞住在哪個房間、什麼時候搬進來、什麼時候被下一輪的句子換掉。 */
interface Placed { line: Line; room: number; tIn: number; tOut: number }
/** 標註的一個字：位置、什麼時候寫到。 */
interface Glyph { ch: string; x: number; y: number; t: number; w: number }

/** 原文副行最小的字級（房間座標 ≈ 螢幕 px；窄體字的韓文是備援字型，排 34 量起來約 31）。 */
const SUB_MIN = 34;
const roomCache = new WeakMap<Line, Map<string, LyricLayout>>();
/**
 * 房間裡的歌詞（雙語）：boxLyric 會讓原文跟著主行縮，廚房那一格窄，原文一路縮到 26 px。
 * 原文比 SUB_MIN 小的時候改成：原文固定 SUB_MIN（太長就折行），先扣掉它佔的高度，再用剩下的高度排中文。
 */
function roomLyric(c: CanvasRenderingContext2D, line: Line, w: number, h: number, o: { min: number; max: number; lineHeight: number }): LyricLayout {
  const lay0 = boxLyric(c, line, LYR_FAM, w, h, o);
  const sub = lyricSubOf(line);
  if (!sub || !lay0.sub || lay0.sub.lay.size >= SUB_MIN - 0.5) return lay0;
  const key = `${w}|${h}|${o.min}|${o.max}|${o.lineHeight}`;
  let m = roomCache.get(line);
  if (!m) { m = new Map(); roomCache.set(line, m); }
  const hit = m.get(key);
  if (hit) return hit;
  const sl = layoutLyric(c, sub, { family: LYR_FAM, size: SUB_MIN, minSize: SUB_MIN, maxWidth: w, align: 'left', lineHeight: 1.12 });
  // 中文照「沒有原文」排進扣掉原文之後的高度（subGap 用最小的中文字級估，寧可多留一點）
  const extra = subGap(o.min, SUB_MIN) + sl.height - sl.size;
  const main = boxLyric(c, { ...line, sub: undefined }, LYR_FAM, w, Math.max(o.min, h - extra), o);
  const dy = main.rows[main.rows.length - 1]!.y + subGap(main.size, SUB_MIN);
  const out: LyricLayout = { ...main, sub: { lay: sl, dy }, height: dy + sl.height - sl.size + main.size };
  m.set(key, out);
  return out;
}

export default class Blueprint extends Scene {
  paper = shared('blueprint.paper', PAPER);
  fiber = fiberBake(); // 讓引擎上場前就編好紙纖維的著色器（見 _t3 的 fiberBake）
  // max：小段與小段接頭重疊的地方不會變亮（normal 疊兩次會出現一顆一顆的珠子）
  lines = this.track(new LineBatch(4096, { screen2D: true, blend: 'max' }));
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  live = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  g!: Grid;
  groups: Group[] = [];
  placed: Placed[] = [];
  fit: FitResult | null = null;
  glyphs: Glyph[] = [];
  sig = { x: 0, y: 0, t: 0 };
  noteTop = NOTE.y + 60;
  planDone = 0;
  writeEnd = 0;
  lyrMax = 64;
  sigSize = 30;
  instr = false;
  /** 平面圖畫完之後，每個小節線筆回來「複查」一個地方（描一條線、一個門、一張懶骨頭），窗格長時中段也有事發生。 */
  inspect: { pts: P2[]; t0: number; dur: number }[] = [];
  sweeps: number[] = [];
  /** 鏡頭（世界 → 螢幕：s = w · z + o）。 */
  cz = 1; ox = 0; oy = 0;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const g = this.g = grid(au, s, e);
    const m = this.msg;
    const wl = windowLines(lyrics, s, e);
    this.instr = wl.length === 0;
    await loadText(`${FIXED}${CAPTION}${DIM_YEAR}${song.title}${m ? m.text + signature(m.name) : ''}${wl.map((l) => l.text).join('')}`);
    const c = this.live.ctx;
    // 標註（留言）：白色鉛筆的手寫字，寫在平面圖右邊。v2 標準：字級是螢幕 px（40～60，依字數），
    // 這裡的世界座標 ≈ 螢幕 px，鏡頭最多推到 1.045 倍，所以排版時除以 ZK；留言區 ≤ 690 × 430、署名永遠在最後一行下面
    if (m) {
      const max = msgMaxFor(m.text) / ZK, sigEst = sigV2(msgMaxFor(m.text)) / ZK;
      const areaH = V2.boxH / ZK;
      const boxH = areaH - (sigEst * 1.5 + max * 0.3);
      const opt = { min: V2.msgMin / ZK, max, lineHeight: 1.3, maxLines: 6 };
      const byW = fitText(c, m.text, MSG_FAM, NOTE.w, boxH, opt);
      const byC = fitClauses(c, m.text, MSG_FAM, NOTE.w, boxH, opt);
      this.fit = byC && byC.size >= byW.size * 0.9 ? byC : byW;
      this.sigSize = sigV2(this.fit.size * ZK) / ZK;
      // 留言＋署名整塊在標註區裡偏上（像寫在引線旁邊）
      const blockH = this.fit.height + this.fit.size * 0.3 + this.sigSize * 1.45;
      this.noteTop = NOTE.y + 30 + Math.max(0, areaH - blockH) * 0.4 + this.fit.size * 0.86;
      // 歌詞比留言小一點（lyricV2：小 4 px、40～52）
      this.lyrMax = lyricV2(this.fit.size * ZK) / ZK;
    } else this.lyrMax = lyricV2(null) / ZK;
    const tot = e - g.b0;
    // 筆的行程：外牆＋引線（一小節內）→ 寫留言（一小節半內）→ 補細節
    const A = planA(this.noteTop - (this.fit?.size ?? 60) * 0.35);
    const tsA = stagger(au, g.b0, A.length, clamp(tot * 0.25, g.beat * 1.5, g.bar));
    const mk = (p: { label: string; strokes: Stroke[] }, t0: number, next: number): Group => {
      const { segs, len } = toSegs(p.strokes);
      return { segs, len, t0, t1: t0 + clamp(0.88 * (next - t0), 0.14, g.beat * 0.95), label: p.label };
    };
    A.forEach((p, i) => this.groups.push(mk(p, tsA[i]!, tsA[i + 1] ?? tsA[i]! + g.beat)));
    const tNote = this.groups[this.groups.length - 1]!.t1;
    this.writeEnd = tNote;
    if (m && this.fit) {
      const fit = this.fit;
      c.font = font(MSG_FAM, fit.size);
      const n = Array.from(fit.lines.join('')).length;
      const ts = stagger(au, tNote + 0.02, n, clamp(tot * 0.3, g.beat * 2, g.bar * 1.5));
      let k = 0;
      fit.lines.forEach((ln, i) => {
        const lay = layout(ln, MSG_FAM, fit.size);
        for (const gl of lay.glyphs) this.glyphs.push({ ch: gl.ch, x: NOTE.x + gl.x, y: this.noteTop + i * fit.lineHeight, t: ts[k++]!, w: gl.w });
      });
      const last = this.glyphs[this.glyphs.length - 1]!;
      // 署名：最後一行的基線往下讓出下伸部（0.3 字級）再放署名，永遠不會跟最後一行疊在一起
      this.sig = { x: NOTE.x + NOTE.w, y: this.noteTop + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.3 + this.sigSize * 1.15, t: last.t + g.beat * 0.5 };
      this.writeEnd = this.sig.t + 0.4;
    }
    const B = planB();
    const tsB = stagger(au, this.writeEnd + 0.05, B.length, Math.max(g.beat * 2, Math.min(g.bar * 1.5, e - this.writeEnd - g.beat)));
    B.forEach((p, i) => this.groups.push(mk(p, tsB[i]!, tsB[i + 1] ?? tsB[i]! + g.beat)));
    this.planDone = this.groups[this.groups.length - 1]!.t1;
    // 歌詞搬進房間：客廳、主臥、廚房輪流；同一個房間的下一句搬進來時，舊的那句才搬走
    this.placed = wl.map((l, i) => ({ line: l, room: i % ROOMS.length, tIn: l.start - 0.35, tOut: Infinity }));
    this.placed.forEach((p, i) => { const nx = this.placed[i + ROOMS.length]; if (nx) p.tOut = nx.tIn; });
    // 複查：平面圖畫完之後的每個小節線（跟換句描房間撞在一起的讓給房間）
    const circle = (cx: number, cy: number, r: number): P2[] => Array.from({ length: 29 }, (_, i) => ({ x: cx + Math.cos(-Math.PI / 2 + (i / 28) * Math.PI * 2) * r, y: cy + Math.sin(-Math.PI / 2 + (i / 28) * Math.PI * 2) * r }));
    const arcP = (cx: number, cy: number, r: number, a0: number, a1: number): P2[] => Array.from({ length: 13 }, (_, i) => ({ x: cx + Math.cos(a0 + ((a1 - a0) * i) / 12) * r, y: cy + Math.sin(a0 + ((a1 - a0) * i) / 12) * r }));
    const rectP = (x: number, y: number, w: number, h: number): P2[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }];
    const cands: P2[][] = [
      rectP(X0, Y0, X1 - X0, Y1 - Y0), arcP(452, YB, 76, Math.PI / 2, 0), arcP(XC, 572, 76, 0, Math.PI / 2), arcP(770, Y1, 82, -Math.PI / 2, 0),
      circle(784, 672, 46), circle(880, 690, 36), rectP(XA + 8, Y0 + 8, X1 - XA - 16, 56), rectP(252, Y1 - 76, 330, 66),
      [{ x: X0, y: 128 }, { x: X1, y: 128 }], [{ x: 128, y: Y0 }, { x: 128, y: Y1 }],
    ];
    let last = -1;
    g.bars.forEach((b, i) => {
      if (b < this.planDone + 0.1 || b > e - g.beat * 0.8) return;
      if (this.placed.some((p) => Math.abs(Math.max(p.tIn, this.planDone + 0.05) - b) < g.beat * 0.6)) return;
      let ci = Math.floor(hash(i, 31) * cands.length);
      if (ci === last) ci = (ci + 1) % cands.length;
      last = ci;
      this.inspect.push({ pts: cands[ci]!, t0: b, dur: g.beat * 0.8 });
    });
    // 燈條：從第二個小節線起每四小節掃一次
    for (let i = 1; i < g.bars.length; i += 4) this.sweeps.push(g.bars[i]!);
  }

  /** 世界 → 螢幕。 */
  private sx(x: number) { return x * this.cz + this.ox; }
  private sy(y: number) { return y * this.cz + this.oy; }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const k = inOut(t, s, e, 0.2, 0.18);
    // 鏡頭：整個窗格很慢地推近（推到 1.045），第一拍輕輕一震
    const z = 1 + 0.045 * ease.inOutCubic(prog(t, s, e)) + 0.008 * pulse(t, this.g.b0, 0.12);
    this.cz = z; this.ox = W / 2 - CAM.x * z; this.oy = H / 2 - CAM.y * z;
    const cur = this.shown(t);
    const u = this.paper.u;
    u.fiber!.value = fiberTex(renderer);
    (u.cam!.value as THREE.Vector3).set(this.ox, this.oy, z);
    if (cur) {
      const r = ROOMS[cur.room]!.r;
      (u.room!.value as THREE.Vector4).set(r[0] + WI, r[1] + WI, r[2] - WI, r[3] - WI);
      u.roomK!.value = ease.outExpo(prog(t, cur.tIn, cur.tIn + 0.4)) * (1 - prog(t, cur.line.end + 1.0, cur.line.end + 1.5)) * k;
    } else u.roomK!.value = 0;
    // 光：有留言時照著留言，沒有時照著平面圖
    // 燈慢慢晃（像吊燈），紙上的亮處跟著移
    (u.light!.value as THREE.Vector2).set((this.msg ? 1260 : 700) + 70 * Math.sin(t * 0.41), (this.msg ? 440 : 560) + 45 * Math.sin(t * 0.33 + 1));
    const sw = this.sweeps.filter((x) => x <= t).pop();
    const swu = sw === undefined ? 1 : prog(t, sw, sw + this.g.bar, ease.inOutCubic);
    (u.sweep!.value as THREE.Vector2).set(lerp(-100, 2020, swu), swu > 0 && swu < 1 ? Math.sin(Math.PI * swu) : 0);
    this.paper.render(renderer, out);

    // ---- 線稿
    this.lines.clear(); this.glow.clear();
    let head: P2 | null = null;
    const bone = LIN.bone, sig = LIN.signal;
    for (const gr of this.groups) {
      if (t < gr.t0) continue;
      const done = clamp((t - gr.t0) / (gr.t1 - gr.t0)) * gr.len;
      for (const sg of gr.segs) {
        if (sg.s0 >= done) break;
        const f1 = Math.min(1, (done - sg.s0) / (sg.s1 - sg.s0));
        // 這一小段是什麼時候被畫到的：剛畫到的是燒紅的，半秒冷卻
        const tDrawn = gr.t0 + ((sg.s0 + sg.s1) / 2 / gr.len) * (gr.t1 - gr.t0);
        const heat = Math.max(0, 1 - Math.max(0, t - tDrawn) / 0.5) ** 2;
        const c0 = 0.8;
        const rgb: [number, number, number] = [lerp(bone[0] * c0, sig[0] * 2.6, heat), lerp(bone[1] * c0, sig[1] * 2.6, heat), lerp(bone[2] * c0, sig[2] * 2.6, heat)];
        this.lines.seg2(this.sx(sg.ax), this.sy(sg.ay), this.sx(lerp(sg.ax, sg.bx, f1)), this.sy(lerp(sg.ay, sg.by, f1)), sg.w * z, rgb, lerp(sg.a, 1, heat) * k);
      }
      if (t < gr.t1) head = this.pointAt(gr, done);
    }
    const tr = this.traceHead(t, k);
    head = head ?? tr;
    this.lines.render(renderer, out);

    // ---- 字
    const L = this.live; L.clear();
    const c = L.ctx;
    c.globalAlpha = k;
    c.setTransform(z, 0, 0, z, this.ox, this.oy);
    this.drawLabels(c, t);
    this.drawRooms(c, t);
    const pen = this.drawNote(c, t);
    c.setTransform(1, 0, 0, 1, 0, 0);
    comp.draw(renderer, L.upload(), out);
    head = head ?? pen;

    // ---- 筆尖（仙女棒）
    if (head && k > 0.3) {
      const h = { x: this.sx(head.x), y: this.sy(head.y) };
      sparkParticles(this.glow, t, () => h, { rate: 80, life: 0.3, speed: 190, seed: 23 });
      sparkHead(this.glow, h.x, h.y, t, 0.8);
    }
    if (this.glow.count) this.glow.render(renderer, out);
    return { bloom: 0.6, vignette: 0.46, grain: 0.05, halation: 0.18 };
  }

  /** 組裡第 s px 的位置（筆尖，世界座標）。 */
  private pointAt(gr: Group, s: number): P2 {
    for (const sg of gr.segs) if (s <= sg.s1) { const u = clamp((s - sg.s0) / Math.max(1e-3, sg.s1 - sg.s0)); return { x: lerp(sg.ax, sg.bx, u), y: lerp(sg.ay, sg.by, u) }; }
    const l = gr.segs[gr.segs.length - 1]!;
    return { x: l.bx, y: l.by };
  }

  /** 平面圖畫完以後：每一句歌詞搬進房間的那一刻，筆沿著房間的內緣描一圈（0.45 拍）；沒換句的小節線，筆去複查一個地方。回傳筆尖（世界座標）。 */
  private traceHead(t: number, k: number): P2 | null {
    let head: P2 | null = null;
    const beat = this.g.beat;
    for (const p of this.placed) {
      const t0 = Math.max(p.tIn, this.planDone + 0.05);
      if (t0 >= p.tOut) continue;
      const [x0, y0, x1, y1] = ROOMS[p.room]!.r;
      const ins = 16;
      const pts = [{ x: x0 + ins, y: y0 + ins }, { x: x1 - ins, y: y0 + ins }, { x: x1 - ins, y: y1 - ins }, { x: x0 + ins, y: y1 - ins }, { x: x0 + ins, y: y0 + ins }];
      head = this.trace(pts, t0, beat * 0.45, t, k) ?? head;
    }
    for (const q of this.inspect) head = this.trace(q.pts, q.t0, q.dur, t, k) ?? head;
    return head;
  }

  /** 沿著折線描一次（訊號色、剛描到的地方最燙、0.45 秒冷卻），回傳筆尖（描完回傳 null）。 */
  private trace(pts: P2[], t0: number, dur: number, t: number, k: number): P2 | null {
    if (t < t0 || t > t0 + dur + 0.5) return null;
    const z = this.cz;
    let per = 0;
    for (let i = 1; i < pts.length; i++) per += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    const done = clamp((t - t0) / dur) * per;
    let acc = 0, head: P2 | null = null;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!, sl = Math.hypot(b.x - a.x, b.y - a.y);
      if (acc >= done) break;
      const n = Math.max(1, Math.ceil(sl / 24));
      for (let j = 0; j < n; j++) {
        const s0 = acc + (sl * j) / n, s1 = acc + (sl * (j + 1)) / n;
        if (s0 >= done) break;
        const e1 = Math.min(s1, done);
        const heat = Math.max(0, 1 - (t - (t0 + (s0 / per) * dur)) / 0.45);
        if (heat <= 0) continue;
        const ua = (s0 - acc) / sl, ub = (e1 - acc) / sl;
        this.glow.seg2(this.sx(lerp(a.x, b.x, ua)), this.sy(lerp(a.y, b.y, ua)), this.sx(lerp(a.x, b.x, ub)), this.sy(lerp(a.y, b.y, ub)), 2.2 * z, [LIN.signal[0] * 2.2, LIN.signal[1] * 2.2, LIN.signal[2] * 2.2], heat * heat * k);
      }
      if (done < acc + sl) head = { x: lerp(a.x, b.x, (done - acc) / sl), y: lerp(a.y, b.y, (done - acc) / sl) };
      acc += sl;
    }
    return done >= per ? null : head;
  }

  /** 現在該打斜線的那一句（正在唱、或剛唱完還在停留的）。 */
  private shown(t: number): Placed | null {
    let best: Placed | null = null;
    for (const p of this.placed) if (t >= p.tIn && t < p.tOut && t < p.line.end + 1.5) best = p;
    return best;
  }

  private groupOn(t: number, label: string) {
    const gr = this.groups.find((x) => x.label === label)!;
    return prog(t, gr.t0 + (gr.t1 - gr.t0) * 0.6, gr.t1 + 0.1);
  }

  // ------------------------------------------------------------ 小字：尺寸、家具、正在唱的房間、圖說（都很小、很淡）
  private drawLabels(c: CanvasRenderingContext2D, t: number) {
    const dim = this.groupOn(t, 'DIM');
    if (dim > 0) {
      const col = rgba('bone', 0.5 * dim);
      mono(c, '3,600', (X0 + XA) / 2, 152, { size: 16, color: col, align: 'center', tracking: 1 });
      mono(c, DIM_YEAR, (XA + X1) / 2, 152, { size: 16, color: col, align: 'center', tracking: 1 });
      c.save(); c.globalAlpha *= dim;
      c.font = font(F.serif(600), 26); c.fillStyle = rgba('bone', 0.6); c.textAlign = 'center';
      c.fillText('∞', (X0 + X1) / 2, 122);
      c.textAlign = 'left';
      c.restore();
      for (const [yy, s] of [[(Y0 + YB) / 2, '5,200'], [(YB + Y1) / 2, '1,314']] as const) {
        c.save(); c.translate(120, yy); c.rotate(-Math.PI / 2);
        mono(c, s, 0, 0, { size: 16, color: col, align: 'center', tracking: 1 });
        c.restore();
      }
    }
    const furn = this.groupOn(t, 'FURN2');
    if (furn > 0) {
      // 起居角：大的圓是懶骨頭、小一點的是盆栽，旁邊兩個小圓是茶几上的兩個馬克杯；標籤很淡，冷面的生活感
      tag(c, '懶骨頭', 784, 678, { size: 15, color: rgba('bone', 0.55 * furn), align: 'center', tracking: 1 });
      tag(c, '盆栽', 880, 696, { size: 15, color: rgba('bone', 0.55 * furn), align: 'center', tracking: 1 });
    }
    // 房名：平面圖上的小字（淡）；正在唱的那個房間變訊號色。唱過的句子不留在房間裡——畫面上只有一句歌詞是大字
    const walls = this.groupOn(t, 'ACD');
    const cur = this.shown(t);
    if (walls > 0) ROOMS.forEach((r, i) => {
      const on = cur && !this.instr && cur.room === i ? prog(t, cur.tIn, cur.tIn + 0.3) : 0;
      const col = on > 0 ? mixRgba('bone', 'signal', on, 0.35 + 0.5 * on) : rgba('bone', 0.35);
      c.save(); c.globalAlpha *= walls;
      const w = mono(c, `0${i + 1} ${r.en}`, r.tagAt.x, r.tagAt.y, { size: 13, color: col, tracking: 3 });
      tag(c, r.zh, r.tagAt.x + w + 10, r.tagAt.y + 1, { size: 16, color: col, tracking: 3 });
      c.restore();
    });
    // 圖說（左下角一行）
    const a = prog(t, this.groups[0]!.t0, this.groups[3]!.t1);
    tag(c, CAPTION, X0, 950, { size: 16, color: rgba('bone', 0.42 * a), tracking: 3 });
    const note = this.groupOn(t, 'NOTE');
    if (note > 0) {
      c.save(); c.globalAlpha *= note;
      c.font = font(F.hei(700), 16); c.fillStyle = rgba('bone', 0.85); c.textAlign = 'center';
      c.fillText('1', MARK.x, MARK.y + 6);
      c.textAlign = 'left';
      c.restore();
    }
  }

  // ------------------------------------------------------------ 房間裡的歌詞
  /**
   * 只畫正在唱的那一句（MV 融合原則：畫面上的大字只有留言與這一句）。句子在它的房間裡淡入，
   * 唱完停一下（或下一句進來時）0.25 秒淡出；還沒唱到的句子不顯示。純音樂：房間只有小小的房名（drawLabels）。
   */
  private drawRooms(c: CanvasRenderingContext2D, t: number) {
    if (this.instr) return;
    this.placed.forEach((p, i) => {
      const next = this.placed[i + 1];
      const end = Math.min(p.line.end + 1.5, next ? next.tIn + 0.2 : Infinity);
      if (t < p.tIn || t >= end) return;
      const [bx, by, bw, bh] = ROOMS[p.room]!.box;
      const lay = roomLyric(c, p.line, bw, bh, { min: V2.lyrMin / ZK, max: this.lyrMax, lineHeight: 1.14 });
      const y0 = by + Math.max(0, (bh - lay.height) / 2) + lay.size * 0.8;
      const a = prog(t, p.tIn, p.tIn + 0.25) * (1 - prog(t, end - 0.25, end));
      const st: LyricStyle = { family: LYR_FAM, size: lay.size, maxWidth: bw, active: rgba('signal'), sung: rgba('bone', 0.92), unsung: rgba('bone', 0.3) };
      c.save(); c.translate(bx, y0);
      drawLyric(c, p.line, t, st, lay, a);
      c.restore();
    });
  }

  // ------------------------------------------------------------ 標註（留言）：白色鉛筆的大字，一個字一個字寫上去
  /** 回傳筆尖（正在寫的那個字，世界座標）。 */
  private drawNote(c: CanvasRenderingContext2D, t: number): P2 | null {
    const m = this.msg;
    const note = this.groupOn(t, 'NOTE');
    if (note <= 0) return null;
    let pen: P2 | null = null;
    if (m && this.fit) {
      const size = this.fit.size;
      // 小小的「附註 ①」：跟標註同一個角落、很淡
      tag(c, m.couple ? '① 設計者附註' : `① 附註　NO.${pad3(m.n)}`, NOTE.x, this.noteTop - size * 0.86 - 46, { size: 16, color: rgba('bone', 0.45 * note), tracking: 4 });
      c.font = font(MSG_FAM, size); c.textBaseline = 'alphabetic';
      for (const gl of this.glyphs) {
        if (t < gl.t) break;
        // 剛寫的字是燒紅的，0.6 秒冷卻成白色鉛筆
        const heat = Math.max(0, 1 - (t - gl.t) / 0.6);
        if (t < gl.t + 0.12) pen = { x: gl.x + gl.w, y: gl.y - size * 0.3 };
        if (gl.ch === '♥') { drawHeart(c, gl.x + gl.w / 2, gl.y - size * 0.34, size * 0.8); continue; }
        c.fillStyle = heat > 0.02 ? mixRgba('bone', 'signal', heat * 0.9, 0.96) : rgba('bone', 0.96);
        c.fillText(gl.ch, gl.x, gl.y);
      }
      const ks = prog(t, this.sig.t, this.sig.t + 0.35);
      if (ks > 0) {
        c.save(); c.globalAlpha *= ks;
        c.font = font(MSG_FAM, this.sigSize); c.fillStyle = rgba('bone', 0.72); c.textAlign = 'right';
        c.fillText(signature(m.name), this.sig.x, this.sig.y);
        c.textAlign = 'left';
        c.restore();
      }
    } else if (!m) {
      // 沒有留言：歌詞是焦點，這裡淡淡寫一句邀請
      const a = prog(t, this.writeEnd, this.writeEnd + 0.5) * note;
      c.save(); c.globalAlpha *= a;
      tag(c, '① 附註', NOTE.x, NOTE.y - 6, { size: 16, color: rgba('bone', 0.45), tracking: 4 });
      c.font = font(MSG_FAM, 40); c.fillStyle = rgba('bone', 0.62);
      ['本案尚缺一則祝福。', '請掃描右下角 QR code，', '把給新人的話標註在這裡。'].forEach((s, i) => c.fillText(s, NOTE.x, NOTE.y + 70 + i * 58));
      c.restore();
    }
    return pen;
  }
}
