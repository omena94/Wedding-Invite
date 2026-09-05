// 座位圖的幾何計算：每個物件的椅子（座位）畫在哪裡。後台編輯器與賓客端地圖共用。
// 物件的 x, y 是未旋轉時的左上角；rotation 以中心點旋轉（度）。圓桌的 w 是直徑。

export const SEAT_R = 11;      // 椅子半徑
export const SEAT_GAP = 17;    // 桌緣到椅子中心的距離

export const KIND_LABEL = { round: "圓桌", rect: "長桌", chair: "椅子", zone: "區域", stage: "舞台", entrance: "入口", label: "文字", wall:'牆面',column:'柱體' };

export const DEFAULTS = {
  wall: {w:240,h:24,seats:0},
  column: {w:70,h:70,seats:0},
  round: { w: 120, h: 120, seats: 10 },
  rect: { w: 240, h: 90, seats: 8 },
  chair: { w: 28, h: 28, seats: 1 },
  zone: { w: 320, h: 140, seats: 0 },
  stage: { w: 420, h: 72, seats: 0 },
  entrance: { w: 150, h: 56, seats: 0 },
  label: { w: 160, h: 36, seats: 0 },
};

export function center(o) {
  const w = o.kind === "round" ? o.w : o.w;
  const h = o.kind === "round" || o.kind === 'column' ? o.w : o.h;
  return { cx: o.x + w / 2, cy: o.y + h / 2, w, h };
}

function rotate(px, py, cx, cy, deg) {
  if (!deg) return { x: px, y: py };
  const a = (deg * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
}

/** 長桌預設每邊幾張：左右各 1（座位 ≥ 4 時），其餘平均分到上下 */
export function defaultSides(seats) {
  const n = Math.max(0, seats | 0);
  if (n <= 2) return { top: Math.ceil(n / 2), bottom: Math.floor(n / 2), left: 0, right: 0 };
  const ends = n >= 4 ? 1 : 0;
  const rest = n - ends * 2;
  return { top: Math.ceil(rest / 2), bottom: Math.floor(rest / 2), left: ends, right: ends };
}

export function sidesOf(o) {
  const s = o.meta && o.meta.sides;
  if (s && ["top", "bottom", "left", "right"].every((k) => Number.isFinite(Number(s[k])))) {
    const out = { top: +s.top | 0, bottom: +s.bottom | 0, left: +s.left | 0, right: +s.right | 0 };
    const total = out.top + out.bottom + out.left + out.right;
    if (total === (o.seats | 0)) return out;
  }
  return defaultSides(o.seats);
}

function spread(count, length) {
  // 在長度 length 的邊上平均放 count 個點，回傳相對於邊起點的位移
  const out = [];
  for (let i = 0; i < count; i++) out.push(((i + 0.5) / count) * length);
  return out;
}

/**
 * 回傳每個座位的 {x, y, ox, oy}：x,y 是椅子中心（畫布座標，已套旋轉）；
 * ox,oy 是「朝外」的單位向量，名字要寫在椅子外側時用。
 */
export function seatPositions(o) {
  const { cx, cy, w, h } = center(o);
  const out = [];
  if (o.kind === "chair") {
    out.push({ x: cx, y: cy, ox: 0, oy: -1 });
    return out;
  }
  if (o.kind === "round") {
    const n = o.seats | 0;
    const r = w / 2 + SEAT_GAP;
    for (let i = 0; i < n; i++) {
      const a = ((-90 + (360 * i) / n + (o.rotation || 0)) * Math.PI) / 180;
      out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), ox: Math.cos(a), oy: Math.sin(a) });
    }
    return out;
  }
  if (o.kind === "rect") {
    const s = sidesOf(o);
    const raw = [];
    spread(s.top, w).forEach((d) => raw.push({ x: o.x + d, y: o.y - SEAT_GAP, ox: 0, oy: -1 }));
    spread(s.right, h).forEach((d) => raw.push({ x: o.x + w + SEAT_GAP, y: o.y + d, ox: 1, oy: 0 }));
    spread(s.bottom, w).reverse().forEach((d) => raw.push({ x: o.x + d, y: o.y + h + SEAT_GAP, ox: 0, oy: 1 }));
    spread(s.left, h).reverse().forEach((d) => raw.push({ x: o.x - SEAT_GAP, y: o.y + d, ox: -1, oy: 0 }));
    raw.forEach((p) => {
      const r = rotate(p.x, p.y, cx, cy, o.rotation);
      const v = rotate(cx + p.ox, cy + p.oy, cx, cy, o.rotation);
      out.push({ x: r.x, y: r.y, ox: v.x - cx, oy: v.y - cy });
    });
    return out;
  }
  return out;
}

/** 物件（含椅子）的外框，給「縮放至全部」用 */
export function bounds(objects) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  objects.forEach((o) => {
    const { cx, cy, w, h } = center(o);
    const r = Math.sqrt(w * w + h * h) / 2 + SEAT_GAP + SEAT_R + 20;
    minX = Math.min(minX, cx - r); minY = Math.min(minY, cy - r);
    maxX = Math.max(maxX, cx + r); maxY = Math.max(maxY, cy + r);
  });
  if (!objects.length) return { minX: 0, minY: 0, maxX: 800, maxY: 500 };
  return { minX, minY, maxX, maxY };
}

export const shortName = (name, n = 4) => (name || "").length > n ? `${name.slice(0, n)}…` : name || "";
