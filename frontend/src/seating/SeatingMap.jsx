// 唯讀的座位圖（SVG）：賓客端 /seat 與列印用。後台編輯器另有互動版。
// props: layout {canvas, objects}, highlightIds: Set<object_id>, highlightSeats: Set<"objId:idx">, showNames
import { useMemo } from "react";
import { SEAT_R, bounds, center, seatPositions } from "./geometry.js";
import { LINE_H, NAME_FONT, SUB_FONT, nameLines, placement, planLabels } from "./labels.js";

// 給 planLabels 用：這個座位叫什麼名字（賓客端用 seatNames，其他用 assignments）
export function nameGetter(seatNames) {
  return (o, i) => {
    if (seatNames) return seatNames[String(o.id)]?.[String(i)]?.name || "";
    return (o.assignments || []).find((a) => a.seat_index === i)?.display_name || "";
  };
}

// fit=true：只畫桌椅所在的範圍（加一點邊），不然整張大畫布縮小後桌子會擠在角落
// seatNames：{object_id: {seat_index: {name, mine}}}，給賓客端用，只顯示自己那幾桌的名字
export default function SeatingMap({ layout, highlightIds, highlightSeats, showNames = false, maxHeight = 420, className = "", fit = true, seatNames = null }) {
  const objects = layout?.objects || [];
  const labelPlan = useMemo(() => planLabels(objects, nameGetter(seatNames)), [objects, seatNames]);
  if (!layout || !layout.objects) return null;
  const { canvas } = layout;
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
            showNames={showNames || (seatNames && !!seatNames[String(o.id)])} labelPlan={labelPlan}
            seatNames={seatNames ? seatNames[String(o.id)] || {} : undefined} />
        ))}
      </svg>
    </div>
  );
}

// seatClass(o, i)：賓客互動地圖用，替某些椅子加額外 class（點到的、鄰座）
// labelPlan：planLabels 算好的名字位置（Map "oid:idx" → placement）；沒給就用預設的外側位置
// pickedSeats：後台「選到的人」所在的椅子（Set<"oid:idx">），用對比色標出來，跟搜尋標亮（金色）、桌子選取（外框）分開
export function ObjectShape({ o, highlighted, highlightSeats, showNames, interactive, selected, onSeatPointerDown, onSeatPointerUp, seatNames, dimNames, seatClass, labelPlan, pickedSeats }) {
  const { cx, cy, w, h } = center(o);
  const seats = seatPositions(o);
  // seatNames 給的是 {index: {name, mine, side}}；編輯器則直接用 assignments
  const names = seatNames
    ? Object.fromEntries(Object.entries(seatNames).map(([i, v]) => [i, { display_name: v.name, side: v.side || "", mine: v.mine }]))
    : Object.fromEntries((o.assignments || []).map((a) => [a.seat_index, a]));
  const cls = ["seat-obj", `seat-${o.kind}`, highlighted ? "hi" : "", selected ? "selected" : ""].filter(Boolean).join(" ");
  const rot = o.rotation ? `rotate(${o.rotation} ${cx} ${cy})` : undefined;
  const fontSize = o.kind === "label" ? Math.max(11, Math.min(28, h * 0.5)) : o.kind === "stage" ? 16 : 13;
  // 入口的字要讓開左邊的門
  const textX = o.kind === "entrance" ? cx + Math.max(12, h - 18) * 0.45 : cx;
  return (
    <g className={cls} data-object-id={o.id}>
      {/* 本體 */}
      {o.kind === 'wall' && <rect x={o.x} y={o.y} width={w} height={h} className="seat-body seat-obstacle" transform={rot}/>}
      {o.kind === 'column' && <circle cx={cx} cy={cy} r={w/2} className="seat-body seat-obstacle"/>}
      {o.kind === "round" && <circle cx={cx} cy={cy} r={w / 2} className="seat-body" />}
      {o.kind === "rect" && <rect x={o.x} y={o.y} width={w} height={h} rx="10" className="seat-body" transform={rot} />}
      {o.kind === "zone" && <rect x={o.x} y={o.y} width={w} height={h} rx="14" className={`seat-body seat-zone-body${o.meta?.blocked?' seat-obstacle':''}`} transform={rot} />}
      {/* 舞台：深色台面加一條金色台口 */}
      {o.kind === "stage" && (
        <g transform={rot}>
          <rect x={o.x} y={o.y} width={w} height={h} rx="12" className="seat-body seat-stage-body" />
          <rect x={o.x + 8} y={o.y + h - 9} width={Math.max(0, w - 16)} height="4" rx="2" className="seat-stage-edge" />
        </g>
      )}
      {/* 入口：紅框加一扇雙開門 */}
      {o.kind === "entrance" && (() => {
        const dh = Math.max(12, h - 18);
        const dw = dh * 0.42;
        return (
          <g transform={rot}>
            <rect x={o.x} y={o.y} width={w} height={h} rx="10" className="seat-body seat-entrance-body" />
            <rect x={o.x + 10} y={o.y + 9} width={dw} height={dh} rx="2" className="seat-entrance-door" />
            <rect x={o.x + 10 + dw + 3} y={o.y + 9} width={dw} height={dh} rx="2" className="seat-entrance-door" />
            <circle cx={o.x + 10 + dw - 4} cy={o.y + 9 + dh / 2} r="1.6" className="seat-entrance-knob" />
            <circle cx={o.x + 10 + dw + 3 + 4} cy={o.y + 9 + dh / 2} r="1.6" className="seat-entrance-knob" />
          </g>
        );
      })()}
      {o.kind === "label" && <rect x={o.x} y={o.y} width={w} height={h} rx="8" className="seat-body seat-label-body" transform={rot} />}
      {o.kind === "chair" && null}
      {/* 標籤文字 */}
      {o.kind !== "chair" && (
        <text x={textX} y={cy} className={`seat-text seat-text-${o.kind}`} textAnchor="middle" dominantBaseline="middle" fontSize={fontSize} transform={rot}>
          {o.label || (o.kind === "zone" ? "區域" : o.kind === "stage" ? "舞台" : o.kind === "entrance" ? "入口" : "")}
        </text>
      )}
      {/* 椅子 */}
      {seats.map((p, i) => {
        const a = names[i];
        const key = `${o.id}:${i}`;
        const seatCls = ["seat-chair", a ? `taken side-${a.side || "none"}` : "empty", (highlightSeats && highlightSeats.has(key)) || (a && a.mine) ? "hi" : "", a && a.mine ? "mine" : "", pickedSeats && pickedSeats.has(key) ? "picked" : "", seatClass ? seatClass(o, i) : ""].filter(Boolean).join(" ");
        const gap = SEAT_R + (a && a.mine ? 9 : 4); // 自己的位子外面有光暈，名字再推遠一點
        const lines = a ? nameLines(a.display_name) : [];
        const label = lines.length ? lines[0] : "";
        return (
          <g key={i} className={seatCls} data-object-id={o.id} data-seat-index={i}
            onPointerDown={interactive ? (e) => onSeatPointerDown?.(e, o, i, a) : undefined}
            onPointerUp={interactive ? (e) => onSeatPointerUp?.(e, o, i, a) : undefined}
            style={interactive ? { cursor: "pointer" } : undefined}>
            {/* 後台編輯時多一圈透明的大範圍，手抖一點也點得到（2026-09-10 新人反映點擊不靈敏） */}
            {interactive && <circle cx={p.x} cy={p.y} r={SEAT_R + 9} fill="transparent" stroke="none" className="seat-hit" />}
            {/* 自己的位子：外面多一圈會呼吸的光暈，縮小看整張圖時也找得到 */}
            {a && a.mine && <circle cx={p.x} cy={p.y} r={SEAT_R + 6} className="seat-halo" />}
            <circle cx={p.x} cy={p.y} r={a && a.mine ? SEAT_R + 1 : SEAT_R} />
            <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize="8" className="seat-no">{i + 1}</text>
            {a && <title>{a.display_name}</title>}
            {showNames && label && !dimNames && (() => {
              // 名字的位置：整張圖先排過（避開別桌、別的名字），沒有的話放椅子外側
              const pl = (labelPlan && labelPlan.get(key)) || placement(p, lines, "out", gap);
              // 第一行是名字（粗體），第二行是「小孩」這種副標（小一點、淡一點）
              return (
                <text x={pl.x} y={pl.y} fontSize={NAME_FONT} className="seat-name" textAnchor={pl.anchor} dominantBaseline={pl.baseline}>
                  {lines.map((ln, k) => (
                    <tspan key={k} x={pl.x} dy={k === 0 ? 0 : LINE_H} className={k === 0 ? "seat-name-main" : "seat-name-sub"} fontSize={k === 0 ? NAME_FONT : SUB_FONT}>{ln}</tspan>
                  ))}
                </text>
              );
            })()}
          </g>
        );
      })}
    </g>
  );
}
