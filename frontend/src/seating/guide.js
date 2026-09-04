// 幫賓客算「怎麼走」：用平面圖上新人畫的「入口」與「舞台」區域，
// 算出這桌在第幾排、從左手邊數來第幾桌，寫成一句白話文，並給地圖一條從入口走到桌子的虛線。
// 沒有畫入口就只能請賓客找桌牌（地圖上還是會亮自己的位子）。
import { center } from "./geometry.js";

const isEntrance = (o) => o.kind === "zone" && /入口|大門|門口|entrance|entry|door/i.test(o.label || "");
const isStage = (o) => o.kind === "zone" && /舞台|stage|主桌|主舞台/i.test(o.label || "");

export function findLandmarks(objects) {
  return { entrance: objects.find(isEntrance) || null, stage: objects.find(isStage) || null };
}

function median(nums) {
  const a = [...nums].sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : 0;
}

/**
 * @param objects 平面圖所有物件（public_map）
 * @param table   自己的那張桌子
 * @returns {text, line, entrance, stage}
 *   text  一句白話的走法
 *   line  {x1,y1,x2,y2} 從入口到桌邊的線（沒入口就 null）
 */
export function describeRoute(objects, table) {
  const label = table.label || "";
  const tables = objects.filter((o) => o.kind === "round" || o.kind === "rect");
  const { entrance, stage } = findLandmarks(objects);
  const t = center(table);
  if (!entrance) {
    return { text: `請找桌上寫著「${label}」桌牌的那一桌。`, line: null, entrance: null, stage };
  }
  const e = center(entrance);
  // 前進方向：入口 → 舞台；沒畫舞台就朝所有桌子的中心
  let ax;
  let ay;
  if (stage) {
    const s = center(stage);
    ax = s.cx - e.cx;
    ay = s.cy - e.cy;
  } else if (tables.length) {
    ax = tables.reduce((sum, o) => sum + center(o).cx, 0) / tables.length - e.cx;
    ay = tables.reduce((sum, o) => sum + center(o).cy, 0) / tables.length - e.cy;
  } else {
    ax = 0;
    ay = -1;
  }
  const len = Math.hypot(ax, ay) || 1;
  const ux = ax / len;
  const uy = ay / len;
  // 面向前進方向時的「左手邊」：螢幕 y 往下，所以左 = (uy, -ux)
  const lx = uy;
  const ly = -ux;
  const proj = (o) => {
    const c = center(o);
    return { along: (c.cx - e.cx) * ux + (c.cy - e.cy) * uy, side: (c.cx - e.cx) * lx + (c.cy - e.cy) * ly };
  };
  // 依前進方向的距離分「排」：跟上一排差超過半張桌子就算新的一排
  const size = median(tables.map((o) => Math.max(center(o).w, center(o).h))) || 120;
  const sorted = tables.map((o) => ({ o, ...proj(o) })).sort((a, b) => a.along - b.along);
  const rows = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && it.along - last.mean < size * 0.6) {
      last.items.push(it);
      last.mean = last.items.reduce((s, x) => s + x.along, 0) / last.items.length;
    } else {
      rows.push({ mean: it.along, items: [it] });
    }
  }
  const rowIdx = rows.findIndex((r) => r.items.some((it) => it.o.id === table.id));
  const row = rows[rowIdx] || { items: [] };
  const inRow = [...row.items].sort((a, b) => b.side - a.side); // 左手邊的排前面
  const k = inRow.findIndex((it) => it.o.id === table.id) + 1;

  const parts = [`從「${entrance.label || "入口"}」進來${stage ? `，面向「${stage.label || "舞台"}」` : ""}`];
  if (rows.length > 1) parts.push(`往前走到第 ${rowIdx + 1} 排`);
  else parts.push("往前走");
  if (inRow.length > 1) {
    if (k === 1) parts.push("最左手邊那一桌");
    else if (k === inRow.length) parts.push("最右手邊那一桌");
    else parts.push(`從左手邊數來第 ${k} 桌`);
  }
  const text = `${parts.join("，")}，就是您的「${label}」桌。桌上有「${label}」的桌牌，地圖上的紅色虛線就是走的方向。`;

  // 線從入口中心到桌邊（不要畫進桌子裡）
  const dx = t.cx - e.cx;
  const dy = t.cy - e.cy;
  const d = Math.hypot(dx, dy) || 1;
  const stop = Math.max(t.w, t.h) / 2 + 22;
  const line = { x1: e.cx, y1: e.cy, x2: t.cx - (dx / d) * stop, y2: t.cy - (dy / d) * stop };
  return { text, line, entrance, stage };
}
