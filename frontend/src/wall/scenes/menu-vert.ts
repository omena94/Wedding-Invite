// 喜宴菜單（menu）的直排排版。辦桌的菜單是直的：中文一字一格由上往下、欄由右往左。
//  - 英文字、三位以上的數字躺下來排（轉 90°，直排的慣例）；一兩位數字、單一個符號直立（像直排的「縱中橫」）。
//  - 括號、破折號、刪節號、波浪號、冒號也轉 90°（直排時它們本來就是轉過來的樣子）。
//  - 斷欄守禁則：逗號、句號、驚嘆號、愛心不放在欄首（跟前一個字擠在同一欄，可以稍微超出一點）；左括號不放在欄尾。
//  - 平衡斷欄：欄數跟貪婪斷欄一樣，但把每欄的長度拉平（最後一欄不會只剩一個字）。
// 這裡只算位置；畫在哪裡、什麼時候出現由 menu.ts 決定。
import { font, measure } from '../engine/type';

/** 一格的高（字級的倍數）與欄距（字級的倍數）。 */
export const ADV = 1.04;
export const PITCH = 1.28;

export interface VUnit { s: string; kind: 'up' | 'rot' | 'gap'; len: number }
export interface VCol { units: VUnit[]; len: number }
export interface VLayout { family: string; size: number; adv: number; pitch: number; cols: VCol[]; width: number; height: number; count: number }
/** 排好的一格：欄中心 x、這格的上緣 y、第幾個「會逐一出現的單位」。 */
export interface VPlaced { u: VUnit; x: number; y: number; i: number }

const ROT = new Set(Array.from('（）()「」『』【】〈〉《》〔〕—–-～~…‥ー：；:;_'));
const NO_START = new Set(Array.from('、。，．,.!?！？：；:;）)」』】〕〉》…～~ー・%％”’"\'♥'));
const NO_END = new Set(Array.from('（(「『【〔〈《“‘'));
/** 強制換欄的符號（文字裡的換行）。 */
export const BR = String.fromCharCode(10);

/** 把文字切成直排的單位（中文一字一格；英文一個字一格、躺著）。 */
export function vUnits(text: string, family: string, size: number): VUnit[] {
  const ch = Array.from(text), out: VUnit[] = [];
  const adv = size * ADV;
  for (let i = 0; i < ch.length;) {
    const c = ch[i]!;
    // 換行符號＝強制換欄（邀請之類自己決定斷在哪裡的文字用）
    if (c === BR) { out.push({ s: BR, kind: 'gap', len: 0 }); i++; continue; }
    if (/\s/.test(c)) { out.push({ s: ' ', kind: 'gap', len: size * 0.32 }); i++; continue; }
    if (/[A-Za-z0-9]/.test(c)) {
      let run = c; i++;
      while (i < ch.length && /[A-Za-z0-9'’&@#+.\-!?,:;%]/.test(ch[i]!)) run += ch[i++];
      // 一兩位數字、單一個字母：直立佔一格；其他（英文字、長數字）躺下來
      if (/^\d{1,2}$/.test(run) || run.length === 1) out.push({ s: run, kind: 'up', len: adv });
      else out.push({ s: run, kind: 'rot', len: measure(run, family, size) + size * 0.14 });
      continue;
    }
    if (ROT.has(c)) out.push({ s: c, kind: 'rot', len: Math.max(measure(c, family, size), size * 0.5) + size * 0.08 });
    else out.push({ s: c, kind: 'up', len: adv });
    i++;
  }
  return out;
}

/** 貪婪斷欄（cap：一欄最長幾 px）。 */
function vWrap(units: VUnit[], cap: number, adv: number): VCol[] {
  const cols: VCol[] = [];
  let cur: VUnit[] = [], len = 0;
  const push = () => {
    while (cur.length && cur[cur.length - 1]!.kind === 'gap') len -= cur.pop()!.len;
    if (cur.length) cols.push({ units: cur, len });
    cur = []; len = 0;
  };
  for (const u of units) {
    if (u.s === BR) { push(); continue; }
    if (u.kind === 'gap' && !cur.length) continue;
    const noStart = u.kind !== 'gap' && NO_START.has(Array.from(u.s)[0]!);
    // 放不下就換欄；但不能放欄首的標點擠在這一欄（最多超出一格）
    if (cur.length && len + u.len > cap + 0.5 && !(noStart && len + u.len <= cap + adv * 1.1)) {
      push();
      if (u.kind === 'gap') continue;
    }
    cur.push(u); len += u.len;
  }
  push();
  // 欄尾是左括號：移到下一欄的開頭
  for (let i = 0; i < cols.length - 1; i++) {
    const c = cols[i]!, last = c.units[c.units.length - 1];
    if (last && c.units.length > 1 && NO_END.has(last.s)) {
      c.units.pop(); c.len -= last.len;
      cols[i + 1]!.units.unshift(last); cols[i + 1]!.len += last.len;
    }
  }
  return cols;
}

/** 平衡斷欄：欄數不變、每欄一樣長。 */
function vBalanced(units: VUnit[], cap: number, adv: number): VCol[] {
  const g = vWrap(units, cap, adv);
  if (g.length <= 1) return g;
  const total = units.reduce((s, u) => s + u.len, 0);
  let lo = total / g.length, hi = cap, best = g;
  for (let k = 0; k < 12; k++) {
    const mid = (lo + hi) / 2;
    const w = vWrap(units, mid, adv);
    if (w.length <= g.length) { best = w; hi = mid; } else lo = mid;
  }
  return best;
}

/**
 * 在 maxW × colH 的範圍裡找最大字級（max → min，每次 2 px），排成直排。
 * 放不下（最小字級還是太寬）就用最小字級、寬度超出一點（呼叫的人要留餘裕）。
 */
export function vFit(text: string, family: string, maxW: number, colH: number, o: { min: number; max: number; maxCols?: number }): VLayout {
  // 短短一句（七格以內、中間沒有空白）：排成一欄就好，字小一點也比「新婚快／樂！！！」拆兩欄好讀
  const probe = vUnits(text, family, o.max);
  if (probe.length <= 7 && !probe.some((u) => u.kind === 'gap')) {
    const cells = probe.reduce((s, u) => s + u.len / o.max, 0);
    const size = Math.floor(Math.min(o.max, colH / Math.max(1, cells)));
    if (size >= o.min) return vColumn(text, family, size);
  }
  let last: VLayout | null = null;
  for (let size = o.max; size >= o.min; size -= 2) {
    const adv = size * ADV, pitch = size * PITCH;
    const units = vUnits(text, family, size);
    const cols = vBalanced(units, colH, adv);
    const width = cols.length * pitch, height = Math.max(...cols.map((c) => c.len), 0);
    last = { family, size, adv, pitch, cols, width, height, count: cols.reduce((s, c) => s + c.units.filter((u) => u.kind !== 'gap').length, 0) };
    // 最後一欄只剩一兩個字（「寫下你的祝／福」）不好看：換小一號再排，除非已經是最小字級
    // 自己斷好欄的文字（有換行）：不能再被自動拆欄
    const orphan = text.includes(BR) ? cols.length > text.split(BR).length : cols.length > 1 && cols[cols.length - 1]!.len < height * 0.34;
    // 高度不能超出（標點、愛心擠在欄尾也算）：超出就換小一號，免得壓到下面的歌詞
    if (width <= maxW && height <= colH + 0.5 && cols.length <= (o.maxCols ?? 99) && !orphan) return last;
  }
  return last!;
}

/** 單欄（不斷欄）：署名、菜名這種一定是一欄的。 */
export function vColumn(text: string, family: string, size: number): VLayout {
  const units = vUnits(text, family, size);
  const len = units.reduce((s, u) => s + u.len, 0);
  return { family, size, adv: size * ADV, pitch: size * PITCH, cols: [{ units, len }], width: size * PITCH, height: len, count: units.filter((u) => u.kind !== 'gap').length };
}

/** 排好每一格的位置：第一欄的中心在 xRight − pitch/2，往左排；每欄從 yTop 往下。gap 不編號。 */
export function vPlace(l: VLayout, xRight: number, yTop: number, align: 'top' | 'bottom' = 'top', bottom = 0): VPlaced[] {
  const out: VPlaced[] = [];
  let i = 0;
  l.cols.forEach((col, j) => {
    const x = xRight - l.pitch * (j + 0.5);
    let y = align === 'bottom' ? bottom - col.len : yTop;
    for (const u of col.units) {
      if (u.kind !== 'gap') out.push({ u, x, y, i: i++ });
      y += u.len;
    }
  });
  return out;
}

/** 畫一格（用目前的 fillStyle）。直立的字置中；躺著的字轉 90°，字頭朝右。 */
export function vDrawUnit(c: CanvasRenderingContext2D, u: VUnit, x: number, y: number, family: string, size: number) {
  c.font = font(family, size);
  if (u.kind === 'up') {
    c.textAlign = 'center'; c.textBaseline = 'middle';
    // 愛心的字形比中文小一圈：放大一點，跟旁邊的字一樣重
    if (u.s === '♥') { c.font = font(family, size * 1.12); c.fillText(u.s, x, y + u.len / 2 + size * 0.04); c.textAlign = 'left'; c.textBaseline = 'alphabetic'; return; }
    // 兩位數字擠在一格裡（縮寬，不縮高）
    if (u.s.length > 1) c.fillText(u.s, x, y + u.len / 2 + size * 0.02, size * 0.96);
    else c.fillText(u.s, x, y + u.len / 2 + size * 0.02);
  } else if (u.kind === 'rot') {
    c.save();
    c.translate(x, y + size * 0.07);
    c.rotate(Math.PI / 2);
    c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText(u.s, 0, 0);
    c.restore();
  }
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
}
