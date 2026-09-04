// 座位名字的擺放：預設寫在椅子外側；桌子靠太近時名字會撞在一起，
// 所以先把整張圖的名字排一遍，撞到別桌、別的椅子或別的名字就改放到椅子下面／上面／再外面一點。
// 後台編輯器、賓客地圖、列印都用同一套，看起來才一致。
import { SEAT_R, center, seatPositions } from "./geometry.js";

export const NAME_FONT = 10.5; // 主名字
export const SUB_FONT = 8.5; // 「小孩」這種副標
export const LINE_H = NAME_FONT + 2;

// 名字有空格（「丁宣文③ 小孩」）就拆成兩行，不截短
export function nameLines(name) {
  const s = (name || "").trim();
  if (!s) return [];
  const i = s.indexOf(" ");
  if (i <= 0) return [s];
  return [s.slice(0, i), s.slice(i + 1).trim()].filter(Boolean);
}

// 估文字寬度：中文、圓圈數字約 1 em，英數約 0.58 em
function textWidth(s, size) {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    w += c > 0x2e7f || (c >= 0x2460 && c <= 0x24ff) ? size * 1.05 : size * 0.58;
  }
  return w;
}

/**
 * 算一個名字的位置與外框。
 * mode: "out" 椅子外側（預設）/ "below" 椅子正下方 / "above" 椅子正上方 / "far" 外側再推遠一點
 *       "below-out" / "above-out" 椅子下方／上方、文字往外側延伸（長桌兩端的椅子夾在兩桌中間時用）
 * 回傳 {x, y, anchor, baseline, box:{x0,y0,x1,y1}}
 */
export function placement(p, lines, mode = "out", gap = SEAT_R + 4) {
  const n = lines.length || 1;
  let x;
  let y;
  let anchor;
  let baseline;
  if (mode === "below" || mode === "above" || mode === "below-out" || mode === "above-out") {
    if (mode.endsWith("-out")) {
      // 從椅子靠桌子那一側的邊緣開始，往外延伸，才不會蓋到自己的桌子
      const outRight = p.ox >= 0;
      x = outRight ? p.x - SEAT_R : p.x + SEAT_R;
      anchor = outRight ? "start" : "end";
    } else {
      x = p.x;
      anchor = "middle";
    }
    if (mode.startsWith("below")) { y = p.y + SEAT_R + 3; baseline = "hanging"; }
    else { y = p.y - SEAT_R - 3 - LINE_H * (n - 1); baseline = "auto"; }
  } else {
    const g = mode === "far" ? gap + 14 : gap;
    const tx = p.x + p.ox * g;
    const ty = p.y + p.oy * g;
    anchor = p.ox > 0.3 ? "start" : p.ox < -0.3 ? "end" : "middle";
    const above = p.oy < -0.3;
    baseline = p.oy > 0.3 ? "hanging" : above ? "auto" : "middle";
    x = tx;
    y = above ? ty - LINE_H * (n - 1) : n > 1 && !(p.oy > 0.3) ? ty - LINE_H / 2 : ty;
  }
  const w = Math.max(...lines.map((ln, k) => textWidth(ln, k === 0 ? NAME_FONT : SUB_FONT)), 1);
  const h = LINE_H * n;
  const x0 = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
  const y0 = baseline === "hanging" ? y : baseline === "middle" ? y - LINE_H / 2 : y - NAME_FONT;
  return { x, y, anchor, baseline, box: { x0, y0, x1: x0 + w, y1: y0 + h } };
}

const hit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/**
 * 幫整張圖的名字找不會互撞的位置。
 * @param objects  平面圖物件
 * @param nameOf   (o, i) => 這個座位的名字（沒人就回傳空字串）
 * @param mineKeys Set<"oid:idx"> 自己的位子（外面有光暈，名字要推遠一點）
 * @returns Map<"oid:idx", placement>
 */
export function planLabels(objects, nameOf, mineKeys = null) {
  const obstacles = [];
  const seatBoxes = new Map();
  const seatsOf = new Map();
  for (const o of objects) {
    const { cx, cy, w, h } = center(o);
    if (o.kind === "round" || o.kind === "rect" || o.kind === "stage" || o.kind === "entrance") {
      obstacles.push({ x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 });
    }
    const seats = seatPositions(o);
    seatsOf.set(o.id, seats);
    seats.forEach((p, i) => {
      const box = { x0: p.x - SEAT_R, y0: p.y - SEAT_R, x1: p.x + SEAT_R, y1: p.y + SEAT_R };
      seatBoxes.set(`${o.id}:${i}`, box);
      obstacles.push(box);
    });
  }
  const placed = [];
  const plan = new Map();
  // 先排上下排（名字在上下，比較不會撞），再排左右端的
  const items = [];
  for (const o of objects) {
    (seatsOf.get(o.id) || []).forEach((p, i) => {
      const name = nameOf(o, i);
      if (!name) return;
      items.push({ o, i, p, lines: nameLines(name), key: `${o.id}:${i}`, side: Math.abs(p.ox) > 0.7 ? 1 : 0 });
    });
  }
  items.sort((a, b) => a.side - b.side || a.p.y - b.p.y || a.p.x - b.p.x);
  for (const it of items) {
    const gap = SEAT_R + (mineKeys && mineKeys.has(it.key) ? 9 : 4);
    const own = seatBoxes.get(it.key);
    const modes = it.side ? ["out", "below-out", "above-out", "far", "below", "above"] : ["out", "far", "below", "above"];
    let chosen = null;
    for (const mode of modes) {
      const pl = placement(it.p, it.lines, mode, gap);
      const clash = obstacles.some((b) => b !== own && hit(pl.box, b)) || placed.some((b) => hit(pl.box, b));
      if (!clash) { chosen = pl; break; }
    }
    if (!chosen) chosen = placement(it.p, it.lines, "out", gap);
    placed.push(chosen.box);
    plan.set(it.key, chosen);
  }
  return plan;
}
