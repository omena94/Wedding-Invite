// 唯讀的座位圖（SVG）：賓客端 /seat 與列印用。後台編輯器另有互動版。
// props: layout {canvas, objects}, highlightIds: Set<object_id>, highlightSeats: Set<"objId:idx">, showNames
import { SEAT_R, bounds, center, seatPositions, shortName } from "./geometry.js";

const NAME_FONT = 9;

// fit=true：只畫桌椅所在的範圍（加一點邊），不然整張大畫布縮小後桌子會擠在角落
export default function SeatingMap({ layout, highlightIds, highlightSeats, showNames = false, maxHeight = 420, className = "", fit = true }) {
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
          <ObjectShape key={o.id} o={o} highlighted={hi.has(o.id)} highlightSeats={hs} showNames={showNames} />
        ))}
      </svg>
    </div>
  );
}

export function ObjectShape({ o, highlighted, highlightSeats, showNames, interactive, selected, onSeatPointerDown, onSeatPointerUp, seatNames, dimNames }) {
  const { cx, cy, w, h } = center(o);
  const seats = seatPositions(o);
  const names = seatNames || Object.fromEntries((o.assignments || []).map((a) => [a.seat_index, a]));
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
        const seatCls = ["seat-chair", a ? `taken side-${a.side || "none"}` : "empty", highlightSeats && highlightSeats.has(key) ? "hi" : ""].filter(Boolean).join(" ");
        const label = a ? shortName(a.display_name, 6) : "";
        return (
          <g key={i} className={seatCls} data-object-id={o.id} data-seat-index={i}
            onPointerDown={interactive ? (e) => onSeatPointerDown?.(e, o, i, a) : undefined}
            onPointerUp={interactive ? (e) => onSeatPointerUp?.(e, o, i, a) : undefined}
            style={interactive ? { cursor: "pointer" } : undefined}>
            <circle cx={p.x} cy={p.y} r={SEAT_R} />
            <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize="8" className="seat-no">{i + 1}</text>
            {a && <title>{a.display_name}</title>}
            {showNames && label && !dimNames && (
              <text x={p.x + p.ox * (SEAT_R + 4)} y={p.y + p.oy * (SEAT_R + 4)} fontSize={NAME_FONT} className="seat-name"
                textAnchor={p.ox > 0.3 ? "start" : p.ox < -0.3 ? "end" : "middle"}
                dominantBaseline={p.oy > 0.3 ? "hanging" : p.oy < -0.3 ? "auto" : "middle"}>
                {label}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
