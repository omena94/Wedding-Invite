// 祝福牆的「牆」：所有留言排成一整面字牆，init() 時一次畫進一張大貼圖，之後每一格只是鏡頭在上面移動。
//
// 為什麼預先畫：留言可能有 300 則，每一格重畫幾百段字（還要上傳 Canvas）遠超過 12 ms；
// 牆本身不會變，變的只有鏡頭與「哪一則被點亮」，所以牆畫一次，點亮的那則另外每格清晰地畫在上面。
//
// 版面：照 pdoom dense 的「文字壓力」與瑞士網格——整面牆用「一刀切到底」（guillotine）的方式切成大大小小的格子，
// 切線就是細線；主打留言的格子先挖好（形狀配合鏡頭停下來時的排版），剩下的隨機再切到格子數夠。
// 留言多牆就大一點、但有上限：留言越多、格子越小、字越密（壓力跟著人數長）。留言少的時候，
// 空下來的格子放「迴聲」（某則留言裡的一句，引用它的編號）、微縮字、疊字。
// MV 融合原則：牆是主打背後的「紋理」，不是一堆搶戲的大字——其他格子的字級一律壓在主打字級的一半以下
// （`cap`），格子裡字小、留白多，鏡頭推近時牆虛掉就是一片柔和的字紋；主打格子是整面牆上最大的字，開場全景一眼就找得到。
//
// 貼圖不是顏色而是「資料」（畫面顏色由 shader 依主題色票上色，換主題不用重畫）：
//   R = 字的覆蓋率（反白的格子：R 是底、字是挖空的）
//   G = 格子代號 1～255（shader 拿來決定每格的明暗、hi-hat 閃爍）；0 = 格子之間的縫，或愛心（R 有值時）
//   B = 細線、編號標籤（機器的聲音，shader 上灰色）
// 畫法：先把格子填成 (R 底, G=代號, 0)，字用 source-over 畫 (R 字, G=代號, 0)，G 就不會被字破壞；
// 愛心用 (255, 0, 0) 畫，shader 看到「有字、代號 0」就上點綴色（愛心只能是玫瑰色）；B 用 'lighter' 疊加，只加到藍色通道。
import { F, font, measure } from '../engine/type';
import { tokens, type FitResult } from '../engine/text';
import type { Msg } from '../engine/scene';
import { mulberry32, clamp } from '../engine/util';
import { COUPLE_EN, COUPLE_ZH, heartPoints } from './_motifs';

export interface Rect { x: number; y: number; w: number; h: number }
export type CellKind = 'msg' | 'hero' | 'echo' | 'slab' | 'micro' | 'couple';
export interface Cell extends Rect { id: number; kind: CellKind; msg?: Msg; hero?: number }
interface Rule { x0: number; y0: number; x1: number; y1: number }

/** 主打留言在牆上的格子（大小由 mosaic.ts 依鏡頭停下來時的排版算好）。 */
export interface HeroSpec {
  msg: Msg;
  /** 螢幕上（停住時）排好的留言。 */
  fit: FitResult;
  family: string;
  /** 停住時的放大倍率（螢幕 px / 牆 px）。 */
  zoom: number;
  /** 格子在牆上的大小（牆 px，含標頭列與簽名列）。 */
  w: number;
  h: number;
  /** 牆上的位置（layoutWall 填）。 */
  x: number;
  y: number;
  /** 希望放在牆的哪裡（0..1）。 */
  ax: number;
  ay: number;
}

/**
 * 主打格子（停住時的螢幕尺寸）：四周留白、上面一條火花跑的引線（點火後就熄掉，不是卡片的標題列）、下面一列簽名。
 * 不放編號、不放框：留言是牆上被點亮的那一段字，不是一張介面卡片。
 */
export const HERO_PAD = 26;
export const HERO_LABEL = 40;
export const HERO_SIG = 80;
/** 引線在這個高度，火花沿著它由左往右跑。 */
export const HERO_RULE_Y = HERO_PAD + 12;
export const HERO_LABEL_SIZE = 15;
const LABEL_TRACK = 3;
/** 只有新人自己的留言標一個小小的「FROM THE COUPLE」（引線尾端）；賓客的留言不加編號。 */
export const heroLabel = (m: Msg) => (m.couple ? 'FROM THE COUPLE' : '');
/** 主打格子引線的幾何（格子座標，停住時的螢幕尺寸）。 */
export function heroHeader(hs: HeroSpec) {
  const right = HERO_PAD + Math.max(hs.fit.width, 360);
  const lab = heroLabel(hs.msg);
  const lw = lab ? measure(lab, F.mono(500), HERO_LABEL_SIZE, LABEL_TRACK) : 0;
  return { x0: HERO_PAD, x1: lab ? right - lw - 18 : right, labelX: right - lw, right, baseY: HERO_RULE_Y + 5, track: LABEL_TRACK };
}

export interface WallLayout {
  W: number; H: number; cells: Cell[]; rules: Rule[]; ticks: { x: number; y: number }[]; heroes: HeroSpec[];
  /** 其他格子的字級上限（牆 px）：主打字級的一半以下，推近時背景的字才不會跟主打一樣大。 */
  cap: number;
}
/** 背景格子的字最大是主打字級（牆 px）的幾倍。 */
const CAP_K = 0.42;

const UNIT = 8;
const snap = (v: number) => Math.round(v / UNIT) * UNIT;

// ---------------------------------------------------------------- 快速量字
// fitText 每則要量上萬次字寬，300 則會卡好幾秒；牆上的字只要「大概對」，所以每個字族每個字只量一次（100 px），
// 之後斷行、找字級都用加法算。
const mc = document.createElement('canvas').getContext('2d')!;
const widthCache = new Map<string, Map<string, number>>();
function em(family: string, s: string): number {
  let m = widthCache.get(family);
  if (!m) { m = new Map(); widthCache.set(family, m); }
  let w = 0;
  for (const ch of s) {
    let cw = m.get(ch);
    if (cw === undefined) { mc.font = font(family, 100); cw = mc.measureText(ch).width / 100; m.set(ch, cw); }
    w += cw;
  }
  return w;
}

interface FastFit { size: number; lines: string[]; widths: number[] }
/**
 * 字級往下取到約 6% 一階的梯子上：瀏覽器的字形快取以「字型＋字級」為單位，
 * 幾百格各用各的字級，每個字都要重新點陣化（300 則要好幾秒）；取階之後常用字大多只點陣化一次。
 */
const LADDER = Math.log(1.06);
const qsize = (s: number) => Math.exp(Math.floor(Math.log(Math.max(1, s)) / LADDER + 1e-6) * LADDER);
// 斷行單位（中文禁則、英文不拆字）每段文字只切一次：找字級時同一段要斷行十幾次
const tokCache = new Map<string, string[]>();
function toks(text: string) {
  let t = tokCache.get(text);
  if (!t) { t = tokens(text); if (tokCache.size > 4000) tokCache.clear(); tokCache.set(text, t); }
  return t;
}
function wrapFast(text: string, family: string, size: number, maxW: number): { lines: string[]; widths: number[] } {
  const lines: string[] = [], widths: number[] = [];
  let cur = '', curW = 0;
  for (const tk of toks(text)) {
    // 目前這行的寬度一路累加（不重量整行）
    if (cur && (curW + em(family, tk.trimEnd())) * size > maxW) { lines.push(cur.trimEnd()); cur = tk.trimStart(); curW = em(family, cur); }
    else { cur += tk; curW += em(family, tk); }
  }
  if (cur.trim()) lines.push(cur.trimEnd());
  for (const l of lines) widths.push(em(family, l) * size);
  return { lines, widths };
}
/** 在 w×h 裡找最大字級（純加法，不碰 canvas）。 */
function fitFast(text: string, family: string, w: number, h: number, min: number, max: number, lh: number, maxLines = 99): FastFit {
  let lo = min, hi = max, best: FastFit | null = null;
  for (let k = 0; k < 9; k++) {
    const s = (lo + hi) / 2;
    const r = wrapFast(text, family, s, w);
    const ok = r.lines.length <= maxLines && s * (1 + (r.lines.length - 1) * lh) <= h && Math.max(...r.widths) <= w;
    if (ok) { best = { size: s, ...r }; lo = s; } else hi = s;
  }
  return best ? { ...best, size: qsize(best.size) } : { size: min, ...wrapFast(text, family, min, w) };
}

// ---------------------------------------------------------------- 文字種類
const CJK = /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const LATIN = /\p{Script=Latin}/u;
function cjkRatio(s: string) {
  let c = 0, l = 0;
  for (const ch of s) { if (CJK.test(ch)) c++; else if (LATIN.test(ch)) l++; }
  return c + l ? c / (c + l) : 1;
}
const visibleLen = (s: string) => Array.from(s.replace(/\s/g, '')).length;
/** 一則留言裡的短句（「迴聲」格用）：在標點處切開，留兩個字以上的。 */
const fragments = (s: string) => s.split(/[，。！？!?,.、～~：:；;（）()「」]+/).map((x) => x.trim()).filter((x) => visibleLen(x) >= 2 && visibleLen(x) <= 12);

// 直排時要轉 90° 的標點（括號、引號、破折號、刪節號、波浪號），與要移到右上角的句讀
const V_ROTATE = new Set(Array.from('（）()「」『』【】〔〕〈〉《》…—～~-ー_[]{}<>'));
const V_CORNER = new Set(Array.from('，。、．,.'));

// ---------------------------------------------------------------- 切格子
interface Region extends Rect { f: number }

/** 把 r 切成兩塊（沿長邊的機率高），回傳 null 表示太小不切。 */
function split(r: Region, rnd: () => number, minW: number, minH: number): [Region, Region, Rule] | null {
  const canV = r.w >= 2 * minW, canH = r.h >= 2 * minH;
  if (!canV && !canH) return null;
  // 寬的格子直切、高的橫切；偶爾反過來，才會有細長的直欄（給直排的中文）與扁長的橫條
  const aspect = r.w / r.h;
  let vertical = canV && (!canH || (aspect > 1.15 ? rnd() < 0.86 : aspect < 0.85 ? rnd() < 0.14 : rnd() < 0.5));
  if (!vertical && !canH) vertical = true;
  const len = vertical ? r.w : r.h, mn = vertical ? minW : minH;
  const k = 0.28 + rnd() * 0.44;
  const cut = clamp(snap(len * k), mn, len - mn);
  // 權重：切出來的兩塊各自再決定「還要不要常被切」——有的一直被切成碎格，有的留成大格，大小才會懸殊
  const f1 = r.f * Math.exp((rnd() - 0.5) * 1.4), f2 = r.f * Math.exp((rnd() - 0.5) * 1.4);
  if (vertical) return [{ x: r.x, y: r.y, w: cut, h: r.h, f: f1 }, { x: r.x + cut, y: r.y, w: r.w - cut, h: r.h, f: f2 }, { x0: r.x + cut, y0: r.y, x1: r.x + cut, y1: r.y + r.h }];
  return [{ x: r.x, y: r.y, w: r.w, h: cut, f: f1 }, { x: r.x, y: r.y + cut, w: r.w, h: r.h - cut, f: f2 }, { x0: r.x, y0: r.y + cut, x1: r.x + r.w, y1: r.y + cut }];
}

const contains = (a: Rect, b: Rect) => b.x >= a.x - 0.01 && b.y >= a.y - 0.01 && b.x + b.w <= a.x + a.w + 0.01 && b.y + b.h <= a.y + a.h + 0.01;

/** 在 r 裡挖出 h：兩刀直切＋兩刀橫切（guillotine，順序隨機），回傳剩下的塊與切線。 */
function carve(r: Region, h: Rect, rnd: () => number): { rest: Region[]; rules: Rule[] } {
  const rest: Region[] = [], rules: Rule[] = [];
  const push = (x: Region) => { if (x.w >= UNIT * 3 && x.h >= UNIT * 3) rest.push(x); };
  const x0 = h.x, x1 = h.x + h.w, y0 = h.y, y1 = h.y + h.h;
  if (rnd() < 0.5) {
    // 先直切：左、中、右，中間再橫切
    push({ x: r.x, y: r.y, w: x0 - r.x, h: r.h, f: r.f * 1.3 });
    push({ x: x1, y: r.y, w: r.x + r.w - x1, h: r.h, f: r.f * 1.3 });
    push({ x: x0, y: r.y, w: h.w, h: y0 - r.y, f: r.f });
    push({ x: x0, y: y1, w: h.w, h: r.y + r.h - y1, f: r.f });
    if (x0 > r.x) rules.push({ x0, y0: r.y, x1: x0, y1: r.y + r.h });
    if (x1 < r.x + r.w) rules.push({ x0: x1, y0: r.y, x1, y1: r.y + r.h });
    if (y0 > r.y) rules.push({ x0, y0, x1, y1: y0 });
    if (y1 < r.y + r.h) rules.push({ x0, y0: y1, x1, y1 });
  } else {
    push({ x: r.x, y: r.y, w: r.w, h: y0 - r.y, f: r.f * 1.3 });
    push({ x: r.x, y: y1, w: r.w, h: r.y + r.h - y1, f: r.f * 1.3 });
    push({ x: r.x, y: y0, w: x0 - r.x, h: h.h, f: r.f });
    push({ x: x1, y: y0, w: r.x + r.w - x1, h: h.h, f: r.f });
    if (y0 > r.y) rules.push({ x0: r.x, y0, x1: r.x + r.w, y1: y0 });
    if (y1 < r.y + r.h) rules.push({ x0: r.x, y0: y1, x1: r.x + r.w, y1 });
    if (x0 > r.x) rules.push({ x0, y0, x1: x0, y1 });
    if (x1 < r.x + r.w) rules.push({ x0: x1, y0, x1, y1 });
  }
  return { rest, rules };
}

/**
 * 排整面牆。`msgs` 是全部留言（含主打），`heroes` 是主打格子（大小已定，位置由這裡決定）。
 * 牆的大小：留言越多越大（有上限），但主打格子一定放得下。
 */
export function layoutWall(msgs: readonly Msg[], heroes: HeroSpec[], seed: number): WallLayout {
  const rnd = mulberry32(seed * 7919 + 17);
  const n = msgs.length;
  // 牆的大小（牆 px，16:9）：18 則 2400 寬，之後隨人數長，最多 3600（300 則時一格約 140 px 見方：文字壓力）
  const WW = snap(clamp(2400 + Math.max(0, n - 18) * 9, 2400, 3600)), WH = snap(WW * 9 / 16);
  const rules: Rule[] = [];
  let regions: Region[] = [{ x: 0, y: 0, w: WW, h: WH, f: 1 }];
  // ---- 主打格子：放在希望的位置（避開牆邊，鏡頭停下來時四周還有牆），依序挖出來
  const placed: HeroSpec[] = [];
  const margin = 160;
  for (const hs of heroes) {
    const w = snap(hs.w), h = snap(hs.h);
    let x = snap(clamp(hs.ax * WW - w / 2, margin, WW - margin - w));
    let y = snap(clamp(hs.ay * WH - h / 2, margin, WH - margin - h));
    // 找包含它的區塊；不完整包含就挪進重疊最多的那塊（塞不下就放棄這則）
    let host = regions.find((r) => contains(r, { x, y, w, h }));
    if (!host) {
      const fits = regions.filter((r) => r.w >= w + 2 * UNIT && r.h >= h + 2 * UNIT);
      if (!fits.length) continue;
      host = fits.reduce((a, b) => (ov(b, x, y, w, h) > ov(a, x, y, w, h) ? b : a));
      x = snap(clamp(x, host.x + UNIT, host.x + host.w - w - UNIT));
      y = snap(clamp(y, host.y + UNIT, host.y + host.h - h - UNIT));
    }
    const { rest, rules: rr } = carve(host, { x, y, w, h }, rnd);
    regions = regions.filter((r) => r !== host).concat(rest);
    rules.push(...rr);
    hs.x = x; hs.y = y; hs.w = w; hs.h = h;
    placed.push(hs);
  }
  // ---- 其他留言＋填充格：一直切「最該切」的那塊（面積 × 隨機權重），切到格子數夠。
  // 填充格（迴聲、微縮字、疊字）少一點：牆是背景紋理，留白比塞滿重要
  const others = msgs.filter((m) => !placed.some((h) => h.msg.id === m.id));
  const nFill = clamp(Math.round(others.length * 0.06) + 3, 3, 16);
  const target = Math.max(others.length + nFill, 26);
  const minW = UNIT * 7, minH = UNIT * 5;
  let guard = 0;
  while (regions.length < target && guard++ < 4000) {
    let bi = -1, bs = -1;
    for (let i = 0; i < regions.length; i++) {
      const r = regions[i]!;
      const sc = r.w * r.h * r.f;
      if (sc > bs && (r.w >= 2 * minW || r.h >= 2 * minH)) { bs = sc; bi = i; }
    }
    if (bi < 0) break;
    const s = split(regions[bi]!, rnd, minW, minH);
    if (!s) { regions[bi]!.f = 0; continue; }
    regions.splice(bi, 1, s[0], s[1]);
    rules.push(s[2]);
  }
  // ---- 分配：大格子給（長度 × 隨機）長的留言；填充格挑形狀極端的（很高、很扁）、再隨機挑一些
  let ids = 1;
  const nextId = () => 1 + ((ids++ * 97) % 254);
  const cells: Cell[] = placed.map((h, i) => ({ x: h.x, y: h.y, w: h.w, h: h.h, id: nextId(), kind: 'hero' as const, msg: h.msg, hero: i }));
  const byArea = [...regions].sort((a, b) => b.w * b.h - a.w * a.h);
  const nF = Math.max(0, byArea.length - others.length);
  const extreme = (r: Rect) => Math.max(r.w / r.h, r.h / r.w);
  const cand = byArea.map((r, i) => ({ i, s: extreme(r) * 0.8 + rnd() * 2.2 })).sort((a, b) => b.s - a.s);
  const fillIdx = new Set(cand.slice(0, nF).map((c) => c.i));
  const msgOrder = others.map((m) => ({ m, s: visibleLen(m.text) * Math.exp((rnd() - 0.5) * 1.6) })).sort((a, b) => b.s - a.s).map((x) => x.m);
  let mi = 0, big = 0;
  const meanA = (WW * WH) / Math.max(1, byArea.length);
  byArea.forEach((r, i) => {
    const cell: Cell = { x: r.x, y: r.y, w: r.w, h: r.h, id: nextId(), kind: 'echo' };
    if (!fillIdx.has(i) && mi < msgOrder.length) { cell.kind = 'msg'; cell.msg = msgOrder[mi++]; }
    else {
      const a = r.w / r.h, area = r.w * r.h;
      // 大的填充格輪流放：疊字、新人的名字；其他依形狀：很扁的放微縮字或疊字，剩下的放迴聲
      // （編號名冊、大數字這種「介面」感的格子不放了）
      if (area > meanA * 1.5 && big < 2) cell.kind = (['slab', 'couple'] as CellKind[])[big++]!;
      else if (a > 3.4) cell.kind = rnd() < 0.55 ? 'micro' : 'slab';
      else cell.kind = rnd() < 0.75 ? 'echo' : 'micro';
      if (msgs.length) cell.msg = msgs[Math.floor(rnd() * msgs.length)];
    }
    cells.push(cell);
  });
  // 交叉點的小十字（對位記號）：從切線端點挑少少幾個
  const ticks: { x: number; y: number }[] = [];
  for (const r of rules) if (rnd() < 0.12) ticks.push({ x: r.x0, y: r.y0 });
  const heroPx = placed.length ? Math.min(...placed.map((h) => h.fit.size / h.zoom)) : 64;
  return { W: WW, H: WH, cells, rules, ticks, heroes: placed, cap: Math.max(10, heroPx * CAP_K) };
}

function ov(r: Rect, x: number, y: number, w: number, h: number) {
  return Math.max(0, Math.min(r.x + r.w, x + w) - Math.max(r.x, x)) * Math.max(0, Math.min(r.y + r.h, y + h) - Math.max(r.y, y));
}

// ---------------------------------------------------------------- 畫
const RGB = (r: number, g: number, b: number) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
const HEART = heartPoints(48);
const HEART_FILL = RGB(255, 0, 0);

/** 牆上的愛心：我們自己畫的那顆，資料色 (255, 0, 0)（shader 會上點綴色）。(cx, cy) 是中心、size 是寬。 */
function heart(c: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const s = size / 2;
  c.save();
  c.fillStyle = HEART_FILL;
  c.beginPath();
  HEART.forEach((p, i) => (i ? c.lineTo(cx + p.x * s, cy + p.y * s) : c.moveTo(cx + p.x * s, cy + p.y * s)));
  c.closePath();
  c.fill();
  c.restore();
}

/** 畫一行橫排的字（c 的 font 與 fillStyle 已設好）；♥ 換成我們的愛心。 */
function fillRun(c: CanvasRenderingContext2D, s: string, x: number, y: number, size: number) {
  if (!s.includes('♥')) { c.fillText(s, x, y); return; }
  let cx = x;
  for (const part of s.split(/(♥)/)) {
    if (!part) continue;
    if (part === '♥') { const w = c.measureText('♥').width; heart(c, cx + w / 2, y - size * 0.36, size * 0.8); cx += w; }
    else { c.fillText(part, cx, y); cx += c.measureText(part).width; }
  }
}

/**
 * 把牆畫進 canvas（牆 px × sTex）。分批畫、每批之間讓出主執行緒：這個窗格是在前一個版面播放時在背景準備的，
 * 一口氣畫完 300 格（中文字第一次用到某個字級都要點陣化，約 1 秒）會讓前一個版面掉格。
 * 每畫大約 90 個字讓一次（用字數而不是時間決定，畫出來的結果跟怎麼分批無關）。`all` 是全部留言（名冊、微縮字用）。
 */
export async function drawWall(cv: HTMLCanvasElement, L: WallLayout, all: readonly Msg[], sTex: number, seed: number): Promise<void> {
  cv.width = Math.round(L.W * sTex);
  cv.height = Math.round(L.H * sTex);
  const c = cv.getContext('2d')!;
  c.setTransform(sTex, 0, 0, sTex, 0, 0);
  c.fillStyle = '#000';
  c.fillRect(0, 0, L.W, L.H);
  c.textBaseline = 'alphabetic';
  const rnd = mulberry32(seed * 31 + 5);
  let glyphs = 0;
  for (const cell of L.cells) {
    glyphs += drawCell(c, cell, L, all, rnd);
    if (glyphs >= 90) { glyphs = 0; await new Promise((r) => setTimeout(r, 0)); }
  }
  // 切線與對位十字（B 通道）
  c.globalCompositeOperation = 'lighter';
  c.fillStyle = RGB(0, 0, 150);
  for (const r of L.rules) {
    if (r.x0 === r.x1) c.fillRect(r.x0 - 0.6, r.y0, 1.2, r.y1 - r.y0);
    else c.fillRect(r.x0, r.y0 - 0.6, r.x1 - r.x0, 1.2);
  }
  c.fillStyle = RGB(0, 0, 255);
  for (const tk of L.ticks) { c.fillRect(tk.x - 7, tk.y - 0.7, 14, 1.4); c.fillRect(tk.x - 0.7, tk.y - 7, 1.4, 14); }
  // 牆的外框
  c.fillStyle = RGB(0, 0, 150);
  c.fillRect(0, 0, L.W, 1.5); c.fillRect(0, L.H - 1.5, L.W, 1.5); c.fillRect(0, 0, 1.5, L.H); c.fillRect(L.W - 1.5, 0, 1.5, L.H);
  c.globalCompositeOperation = 'source-over';
}

const no3 = (n: number) => `No.${String(n).padStart(3, '0')}`;

function label(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, v = 230, track = size * 0.12) {
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.font = font(F.mono(500), size);
  c.letterSpacing = `${track.toFixed(2)}px`;
  c.fillStyle = RGB(0, 0, v);
  c.fillText(text, x, y);
  c.restore();
}

/** 畫一格，回傳大約畫了幾個字（分批用）。 */
function drawCell(c: CanvasRenderingContext2D, cell: Cell, L: WallLayout, all: readonly Msg[], rnd: () => number): number {
  const { x, y, w, h, id } = cell;
  let n = 8;
  const g = id;
  const pad = clamp(Math.min(w, h) * 0.075, 7, 22);
  const inW = w - 2 * pad, inH = h - 2 * pad;
  // 背景格子的字級上限：主打的一半以下（見 CAP_K）。格子大、字小，剩下的就是留白
  const cap = L.cap;
  c.save();
  c.beginPath(); c.rect(x + 1, y + 1, w - 2, h - 2); c.clip();
  // 格子底色：G = 代號（不再反白成實心的格子：一塊塊亮的方塊會變成畫面上第二個焦點）
  c.fillStyle = RGB(0, g, 0);
  c.fillRect(x, y, w, h);
  const ink = RGB(255, g, 0);
  const ls = clamp(Math.min(w, h) * 0.06, 7.5, 12);
  const m = cell.msg;
  if (m) n += visibleLen(m.text);
  if (cell.kind === 'hero') drawHeroCell(c, cell, L.heroes[cell.hero!]!, ink);
  else if (cell.kind === 'msg' && m) {
    const lab = `${no3(m.n)}${m.name ? '  ' + m.name : ''}`;
    const labH = ls * 1.9;
    const cr = cjkRatio(m.text);
    const tall = h > w * 1.3;
    if (tall && cr > 0.8) drawVertical(c, m.text, x + pad, y + pad, inW, inH - labH, rnd() < 0.55 ? F.ming(700) : F.hand(400), ink, cap);
    else if (tall) drawRotated(c, m.text, x + pad, y + pad, inW, inH - labH, cr < 0.5 ? F.archivo(75, 700) : F.hei(700), ink, cap);
    else {
      const len = visibleLen(m.text);
      const fam = cr < 0.5 ? (rnd() < 0.5 ? F.archivo(75, 800) : F.serif(400, true))
        : len <= 9 ? (rnd() < 0.7 ? F.hei(900) : F.ming(900))
        : ([F.hand(400), F.ming(700), F.hei(500), F.hand(700)] as const)[Math.floor(rnd() * 4)]!;
      const lh = len <= 9 ? 1.08 : 1.3;
      const ff = fitFast(m.text, fam, inW, inH - labH, 6, cap, lh);
      c.font = font(fam, ff.size);
      c.fillStyle = ink;
      ff.lines.forEach((ln, i) => fillRun(c, ln, x + pad, y + pad + ff.size * 0.9 + i * ff.size * lh, ff.size));
    }
    label(c, lab, x + pad, y + h - pad, ls, 150);
  } else if (cell.kind === 'echo' && m) {
    // 迴聲：某則留言裡的一句（像報紙的拉句），比一般留言稍大一點、但一樣在上限內
    const frs = fragments(m.text);
    const fr = frs.length ? frs[Math.floor(rnd() * frs.length)]! : m.text.slice(0, 8);
    const cr = cjkRatio(fr);
    if (h > w * 1.5 && cr > 0.8) drawVertical(c, fr, x + pad, y + pad, inW, inH - ls * 1.9, rnd() < 0.5 ? F.ming(900) : F.hei(900), RGB(170, g, 0), cap * 1.15);
    else {
      const fam = cr < 0.5 ? F.archivo(62, 900) : ([F.hei(900), F.ming(900), F.hand(700), F.hei(300)] as const)[Math.floor(rnd() * 4)]!;
      const ff = fitFast(fr, fam, inW, inH - ls * 1.9, 6, cap * 1.15, 1.05, 2);
      c.font = font(fam, ff.size);
      c.fillStyle = RGB(130 + rnd() * 70, g, 0);
      ff.lines.forEach((ln, i) => fillRun(c, ln, x + pad, y + pad + ff.size * 0.88 + i * ff.size * 1.05, ff.size));
    }
    label(c, `↳ ${no3(m.n)}`, x + pad, y + h - pad, ls, 110);
  } else if (cell.kind === 'micro') {
    // 微縮字（像鈔票的防偽線）：所有留言接成一長串，小小地排滿
    const size = Math.round(clamp(Math.min(w, h) * 0.07, 7, Math.min(11, cap)));
    const fam = F.hei(500);
    c.font = font(fam, size);
    c.fillStyle = RGB(150, g, 0);
    const start = Math.floor(rnd() * Math.max(1, all.length));
    const rows = Math.floor(inH / (size * 1.45));
    // 只接夠排滿這格的字（每行約 inW / size 個字）
    const need = rows * Math.ceil(inW / size) + 20;
    n += need;
    let s = '';
    for (let i = 0; s.length < need && i < all.length * 3; i++) s += all[(start + i) % all.length]!.text + '　·　';
    const lines = wrapFast(s || COUPLE_ZH, fam, size, inW).lines;
    for (let i = 0; i < rows && i < lines.length; i++) fillRun(c, lines[i]!, x + pad, y + pad + size + i * size * 1.45, size);
  } else if (cell.kind === 'slab') {
    // 壓力：同一句祝福一行一行疊上去、行距壓到快碰在一起，兩種亮度交替（pdoom dense 的平塗疊字）；字級一樣壓在上限內
    const frs = m ? fragments(m.text) : [];
    const phrase = frs.length ? frs[Math.floor(rnd() * frs.length)]! : COUPLE_ZH;
    const fam = cjkRatio(phrase) < 0.5 ? F.archivo(62, 900) : F.hei(900);
    const size = qsize(Math.max(8, Math.min(inH / 3.2, cap * 0.8, (inW / Math.max(0.5, em(fam, phrase))) * 0.98)));
    c.font = font(fam, size);
    const rows = Math.max(1, Math.floor(inH / (size * 0.86)));
    n += rows * 4;
    for (let i = 0; i < rows; i++) {
      c.fillStyle = RGB(i % 2 ? 70 : 150, g, 0);
      fillRun(c, phrase, x + pad, y + pad + size * 0.84 + i * size * 0.86, size);
    }
  } else if (cell.kind === 'couple') {
    const zh = rnd() < 0.5;
    const txt = zh ? COUPLE_ZH : COUPLE_EN;
    const fam = zh ? F.ming(900) : F.serif(400, true);
    const ff = fitFast(txt, fam, inW, inH, 8, cap * 1.1, 1.05, 2);
    c.font = font(fam, ff.size);
    c.fillStyle = ink;
    ff.lines.forEach((ln, i) => c.fillText(ln, x + pad, y + pad + ff.size * 0.86 + i * ff.size * 1.05));
  }
  c.restore();
  return n;
}

/** 直排（由右而左、由上而下），標點照直排的習慣放。 */
function drawVertical(c: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number, fam: string, ink: string, max = 240) {
  const chars = Array.from(text.replace(/\s+/g, ''));
  const n = chars.length;
  const colGap = 1.32, adv = 1.04;
  let lo = 6, hi = max, size = 6;
  for (let k = 0; k < 12; k++) {
    const s = (lo + hi) / 2;
    const per = Math.max(1, Math.floor(h / (s * adv)));
    const cols = Math.ceil(n / per);
    if (cols * s * colGap - s * (colGap - 1) <= w && s * adv <= h) { size = s; lo = s; } else hi = s;
  }
  size = qsize(size);
  const per = Math.max(1, Math.floor(h / (size * adv)));
  c.font = font(fam, size);
  c.fillStyle = ink;
  c.textAlign = 'center';
  chars.forEach((ch, i) => {
    const col = Math.floor(i / per), row = i % per;
    const cx = x + w - size / 2 - col * size * colGap, cy = y + row * size * adv;
    if (ch === '♥') heart(c, cx, cy + size * 0.5, size * 0.8);
    else if (V_ROTATE.has(ch) || LATIN.test(ch)) {
      c.save(); c.translate(cx, cy + size * 0.5); c.rotate(Math.PI / 2);
      c.fillText(ch, 0, size * 0.34); c.restore();
    } else if (V_CORNER.has(ch)) c.fillText(ch, cx + size * 0.55, cy + size * 0.42);
    else c.fillText(ch, cx, cy + size * 0.86);
  });
  c.textAlign = 'left';
}

/** 轉 90° 的橫排（書背），給高格子裡的英文。 */
function drawRotated(c: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number, fam: string, ink: string, max = 200) {
  const ff = fitFast(text, fam, h, w, 6, max, 1.12);
  c.save();
  c.translate(x, y + h);
  c.rotate(-Math.PI / 2);
  c.font = font(fam, ff.size);
  c.fillStyle = ink;
  ff.lines.forEach((ln, i) => fillRun(c, ln, 0, ff.size * 0.9 + i * ff.size * 1.12, ff.size));
  c.restore();
}

/** 主打格子在牆上的樣子：跟點亮時同一個排版（縮小），點亮時亮的那份剛好蓋在它上面。不畫編號、標頭線（不是卡片）。 */
function drawHeroCell(c: CanvasRenderingContext2D, cell: Cell, hs: HeroSpec, ink: string) {
  const z = hs.zoom, s = hs.fit.size / z;
  const x = cell.x + HERO_PAD / z, top = cell.y + (HERO_PAD + HERO_LABEL) / z;
  c.font = font(hs.family, s);
  c.fillStyle = ink;
  hs.fit.lines.forEach((ln, i) => fillRun(c, ln, x, top + s * 0.92 + (i * hs.fit.lineHeight) / z, s));
}
