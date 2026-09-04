// 唯讀的座位圖（SVG）：賓客端 /seat 與列印用。後台編輯器另有互動版。
// props: layout {canvas, objects}, highlightIds: Set<object_id>, highlightSeats: Set<"objId:idx">, showNames
import { SEAT_R, bounds, center, seatPositions } from "./geometry.js";

const NAME_FONT = 9;

// 名字有空格（「王小明 +1」「王小明 小孩1」）就拆成兩行，不截短
function nameLines(name) {
  const s = (name || "").trim();
  if (!s) return [];
  const i = s.indexOf(" ");
  if (i <= 0) return [s];
  return [s.slice(0, i), s.slice(i + 1).trim()].filter(Boolean);
}

// fit=true：只畫桌椅所在的範圍（加一點邊），不然整張大畫布縮小後桌子會擠在角落
// seatNames：{object_id: {seat_index: {name, mine}}}，給賓客端用，只顯示自己那幾桌的名字
export default function SeatingMap({ layout, highlightIds, highlightSeats, showNames = false, maxHeight = 420, className = "", fit = true, seatNames = null }) {
  if (!layout || !layout.objects) return null;
  const { canvas, objects } = layout;
  const hi = highlightIds || new Set();
  const hs = highlightSeats || new Set();
  const cw = canvas?.w || 1600;
  const ch = canvas?.h || 1000;
  let vb = { x: 0, y: 0, w: cw, h: ch };
  if (fit && objects.length) {
    const b = bounds(objects);
    const pad = 30;
    vb = { x: b.minX - pad, y: b.minY - pad, w: b.maxX - b.minX + pad * 2, h: b.maxY - b.minY + pad * 2 };
  }
  return (
    <div className={`seatmap-wrap ${className}`} style={{ maxHeight, aspectRatio: `${vb.w} / ${vb.h}` }}>
      <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="seatmap" role="img" aria-label="座位平面圖" preserveAspectRatio="xMidYMid meet">
        <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} className="seatmap-floor" />
        {objects.map((o) => (
          <ObjectShape key={o.id} o={o} highlighted={hi.has(o.id)} highlightSeats={hs}
            showNames={showNames || (seatNames && !!seatNames[String(o.id)])}
            seatNames={seatNames ? seatNames[String(o.id)] || {} : undefined} />
        ))}
      </svg>
    </div>
  );
}

// seatClass(o, i)：賓客互動地圖用，替某些椅子加額外 class（點到的、鄰座）
export function ObjectShape({ o, highlighted, highlightSeats, showNames, interactive, selected, onSeatPointerDown, onSeatPointerUp, seatNames, dimNames, seatClass }) {
  const { cx, cy, w, h } = center(o);
  const seats = seatPositions(o);
  // seatNames 給的是 {index: {name, mine, side}}；編輯器則直接用 assignments
  const names = seatNames
    ? Object.fromEntries(Object.entries(seatNames).map(([i, v]) => [i, { display_name: v.name, side: v.side || "", mine: v.mine }]))
    : Object.fromEntries((o.assignments || []).map((a) => [a.seat_index, a]));
  const cls = ["seat-obj", `seat-${o.kind}`, highlighted ? "hi" : "", selected ? "selected" : ""].filter(Boolean).join(" ");
  const rot = o.rotation ? `rotate(${o.rotation} ${cx} ${cy})` : undefined;
  const fontSize = o.kind === "label" ? Math.max(11, Math.min(28, h * 0.5)) : 13;
  return (
    <g className={cls} data-object-id={o.id}>
      {/* 本體 */}
      {o.kind === "round" && <circle cx={cx} cy={cy} r={w / 2} className="seat-body" />}
      {o.kind === "rect" && <rect x={o.x} y={o.y} width={w} height={h} rx="10" className="seat-body" transform={rot} />}
      {o.kind === "zone" && <rect x={o.x} y={o.y} width={w} height={h} rx="14" className="seat-body seat-zone-body" transform={rot} />}
      {o.kind === "label" && <rect x={o.x} y={o.y} width={w} height={h} rx="8" className="seat-body seat-label-body" transform={rot} />}
      {o.kind === "chair" && null}
      {/* 標籤文字 */}
      {o.kind !== "chair" && (
        <text x={cx} y={cy} className={`seat-text seat-text-${o.kind}`} textAnchor="middle" dominantBaseline="middle" fontSize={fontSize} transform={rot}>
          {o.label || (o.kind === "zone" ? "區域" : "")}
        </text>
      )}
      {/* 椅子 */}
      {seats.map((p, i) => {
        const a = names[i];
        const key = `${o.id}:${i}`;
        const seatCls = ["seat-chair", a ? `taken side-${a.side || "none"}` : "empty", (highlightSeats && highlightSeats.has(key)) || (a && a.mine) ? "hi" : "", a && a.mine ? "mine" : "", seatClass ? seatClass(o, i) : ""].filter(Boolean).join(" ");
        const lines = a ? nameLines(a.display_name) : [];
        const label = lines.length ? lines[0] : "";
        return (
          <g key={i} className={seatCls} data-object-id={o.id} data-seat-index={i}
            onPointerDown={interactive ? (e) => onSeatPointerDown?.(e, o, i, a) : undefined}
            onPointerUp={interactive ? (e) => onSeatPointerUp?.(e, o, i, a) : undefined}
            style={interactive ? { cursor: "pointer" } : undefined}>
            {/* 自己的位子：外面多一圈會呼吸的光暈，縮小看整張圖時也找得到 */}
            {a && a.mine && <circle cx={p.x} cy={p.y} r={SEAT_R + 6} className="seat-halo" />}
            <circle cx={p.x} cy={p.y} r={a && a.mine ? SEAT_R + 1 : SEAT_R} />
            <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize="8" className="seat-no">{i + 1}</text>
            {a && <title>{a.display_name}</title>}
            {showNames && label && !dimNames && (() => {
              // 名字放在椅子外側；兩行時往外多推一行的高度，垂直排列的（上/下）第二行接在第一行下面
              const tx = p.x + p.ox * (SEAT_R + 4);
              const ty = p.y + p.oy * (SEAT_R + 4);
              const anchor = p.ox > 0.3 ? "start" : p.ox < -0.3 ? "end" : "middle";
              const above = p.oy < -0.3;
              const baseline = p.oy > 0.3 ? "hanging" : above ? "auto" : "middle";
              const lineH = NAME_FONT + 2;
              const y0 = above ? ty - lineH * (lines.length - 1) : lines.length > 1 && !(p.oy > 0.3) ? ty - lineH / 2 : ty;
              return (
                <text x={tx} y={y0} fontSize={NAME_FONT} className="seat-name" textAnchor={anchor} dominantBaseline={baseline}>
                  {lines.map((ln, k) => <tspan key={k} x={tx} dy={k === 0 ? 0 : lineH}>{ln}</tspan>)}
                </text>
              );
            })()}
          </g>
        );
      })}
    </g>
  );
}
