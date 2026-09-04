// 賓客用的互動座位圖：整張圖可以兩指縮放、拖曳移動；點一張椅子就看到是誰、旁邊坐誰。
// 手機優先（婚禮當天幾乎都用手機看）。後台「預覽賓客畫面」也用同一個元件。
// props:
//   layout  {canvas, objects}（public_map）
//   names   {object_id: {seat_index: {name, side, is_child, mine}}} 每個座位是誰
//   mineIds Set<object_id> 自己所在的桌子（「我的位子」按鈕用）
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocateFixed, Maximize2, Minus, Plus } from "lucide-react";
import { ObjectShape } from "./SeatingMap.jsx";
import { bounds, seatPositions } from "./geometry.js";

const PAD = 40;
const MIN_ZOOM_OUT = 1.6; // 最多再縮到整張圖的 1/1.6
const MAX_ZOOM_IN = 10; // 最多放大到整張圖的 10 倍

function fitBox(objs, pad = PAD) {
  if (!objs || !objs.length) return { x: 0, y: 0, w: 1600, h: 1000 };
  const b = bounds(objs);
  return { x: b.minX - pad, y: b.minY - pad, w: Math.max(200, b.maxX - b.minX + pad * 2), h: Math.max(200, b.maxY - b.minY + pad * 2) };
}

export default function SeatViewer({ layout, names, mineIds }) {
  const objects = useMemo(() => (layout?.objects || []), [layout]);
  const byId = useMemo(() => Object.fromEntries(objects.map((o) => [o.id, o])), [objects]);
  const full = useMemo(() => fitBox(objects), [objects]);
  const [view, setView] = useState(full);
  const [focus, setFocus] = useState(null); // {oid, idx} 點到椅子；{oid} 點到桌子
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef(null);
  const pointers = useRef(new Map()); // pointerId -> {x, y}
  const gesture = useRef({ moved: 0, pinchDist: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => { setView(full); }, [full]);

  // 螢幕座標 → 圖上座標（用 SVG 自己的矩陣，不用管 meet 置中的偏移）
  const toSvg = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }, []);
  // 一個螢幕像素等於幾個圖上單位（拖曳換算用）
  const unitPerPx = useCallback(() => {
    const ctm = svgRef.current?.getScreenCTM();
    return ctm ? 1 / ctm.a : 1;
  }, []);

  const clampView = useCallback((v) => {
    const maxW = full.w * MIN_ZOOM_OUT;
    const minW = full.w / MAX_ZOOM_IN;
    let { x, y, w, h } = v;
    if (w > maxW) { const r = maxW / w; w = maxW; h *= r; }
    if (w < minW) { const r = minW / w; w = minW; h *= r; }
    // 不要拖到整張圖都看不到
    const cx = full.x + full.w / 2;
    const cy = full.y + full.h / 2;
    x = Math.min(Math.max(x, cx - w - full.w / 2), cx + full.w / 2);
    y = Math.min(Math.max(y, cy - h - full.h / 2), cy + full.h / 2);
    return { x, y, w, h };
  }, [full]);

  // 以某個圖上點為中心縮放
  const zoomAt = useCallback((factor, px, py) => {
    const v = viewRef.current;
    const nw = v.w / factor;
    const nh = v.h / factor;
    setView(clampView({ x: px - (px - v.x) / factor, y: py - (py - v.y) / factor, w: nw, h: nh }));
  }, [clampView]);
  const zoomCenter = (factor) => {
    const v = viewRef.current;
    zoomAt(factor, v.x + v.w / 2, v.y + v.h / 2);
  };
  const fitAll = () => setView(full);
  const fitMine = () => {
    const objs = objects.filter((o) => mineIds && mineIds.has(o.id));
    if (!objs.length) return fitAll();
    const b = fitBox(objs, 70);
    // 依照容器的長寬比放大，這樣桌子會剛好填滿畫面（meet 置中不會多留一邊）
    const rect = svgRef.current?.getBoundingClientRect();
    const ratio = rect && rect.height > 0 ? rect.width / rect.height : full.w / full.h;
    let { w, h } = b;
    if (w / h > ratio) h = w / ratio; else w = h * ratio;
    setView(clampView({ x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h }));
  };

  // 滾輪縮放：React 的 onWheel 是 passive，擋不住頁面捲動，所以自己掛
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const p = toSvg(e.clientX, e.clientY);
      zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, p.x, p.y);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [toSvg, zoomAt]);

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) gesture.current = { moved: 0, pinchDist: 0 };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
    setDragging(true);
  };
  const onPointerMove = (e) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    gesture.current.moved += Math.hypot(cur.x - prev.x, cur.y - prev.y);
    if (pointers.current.size === 1) {
      const k = unitPerPx();
      const v = viewRef.current;
      setView(clampView({ ...v, x: v.x - (cur.x - prev.x) * k, y: v.y - (cur.y - prev.y) * k }));
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const last = gesture.current.pinchDist || dist;
      gesture.current.pinchDist = dist;
      if (last > 0 && dist > 0) {
        const mid = toSvg((a.x + b.x) / 2, (a.y + b.y) / 2);
        zoomAt(dist / last, mid.x, mid.y);
      }
    }
  };
  const onPointerUp = (e) => {
    const wasSingle = pointers.current.size === 1;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) setDragging(false);
    // 幾乎沒移動就是「點一下」：看點到什麼
    if (wasSingle && gesture.current.moved < 8) {
      const seatEl = e.target.closest?.("[data-seat-index]");
      const objEl = e.target.closest?.("[data-object-id]");
      if (seatEl) {
        setFocus({ oid: Number(seatEl.getAttribute("data-object-id")), idx: Number(seatEl.getAttribute("data-seat-index")) });
      } else if (objEl) {
        const o = byId[Number(objEl.getAttribute("data-object-id"))];
        if (o && o.kind !== "zone" && o.kind !== "label") setFocus({ oid: o.id });
        else setFocus(null);
      } else {
        setFocus(null);
      }
    }
    gesture.current.moved = 0;
  };

  // 點到的椅子與它的左右鄰座（座位繞桌一圈，頭尾相鄰）
  const focusInfo = useMemo(() => {
    if (!focus) return null;
    const o = byId[focus.oid];
    if (!o) return null;
    const n = seatPositions(o).length;
    const tableNames = (names && names[String(o.id)]) || {};
    const person = (i) => tableNames[String(i)] || null;
    const label = o.label || (o.kind === "chair" ? "單椅" : "桌");
    if (focus.idx === undefined) {
      const list = Array.from({ length: n }, (_, i) => ({ idx: i, p: person(i) }));
      return { o, label, n, list, filled: list.filter((s) => s.p).length };
    }
    const nb = [];
    if (n >= 2) {
      for (const j of [(focus.idx - 1 + n) % n, (focus.idx + 1) % n]) {
        if (j !== focus.idx && !nb.some((x) => x.idx === j)) nb.push({ idx: j, p: person(j) });
      }
    }
    return { o, label, n, idx: focus.idx, p: person(focus.idx), nb };
  }, [focus, byId, names]);

  const seatClass = useCallback((o, i) => {
    if (!focus || focus.oid !== o.id) return "";
    if (focus.idx === i) return "focus";
    if (focusInfo?.nb?.some((x) => x.idx === i)) return "nb";
    return "";
  }, [focus, focusInfo]);
  const hiIds = useMemo(() => new Set(focus && focus.idx === undefined ? [focus.oid] : []), [focus]);

  if (!layout || !objects.length) return null;
  const vb = `${view.x} ${view.y} ${view.w} ${view.h}`;
  const pill = (idx, p, keyPrefix = "s") => (
    <button type="button" key={`${keyPrefix}${idx}`} className={`seatviewer-pill${p?.mine ? " mine" : ""}${p ? "" : " empty"}`}
      onClick={() => setFocus({ oid: focusInfo.o.id, idx })}>
      {idx + 1} 號 {p ? p.name : "空位"}{p?.mine ? "（你）" : ""}
    </button>
  );

  return (
    <div className="seatviewer">
      {/* 控制列放在地圖外面，手機上才不會蓋住桌子 */}
      <div className="seatviewer-ctl">
        <button type="button" onClick={() => zoomCenter(1.4)} aria-label="放大"><Plus size={16} /></button>
        <button type="button" onClick={() => zoomCenter(1 / 1.4)} aria-label="縮小"><Minus size={16} /></button>
        <button type="button" onClick={fitAll} className="wide"><Maximize2 size={14} /> 整張圖</button>
        {mineIds && mineIds.size > 0 && (
          <button type="button" className="wide" onClick={fitMine}><LocateFixed size={14} /> 我的位子</button>
        )}
      </div>
      <div className={`seatviewer-wrap${dragging ? " dragging" : ""}`}>
        <svg ref={svgRef} viewBox={vb} preserveAspectRatio="xMidYMid meet" className="seatmap" role="img" aria-label="座位平面圖"
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <rect x={full.x - full.w * 2} y={full.y - full.h * 2} width={full.w * 5} height={full.h * 5} className="seatmap-floor" />
          {objects.map((o) => (
            <ObjectShape key={o.id} o={o} highlighted={hiIds.has(o.id)} showNames={!!(names && names[String(o.id)])}
              seatNames={names ? names[String(o.id)] || {} : undefined} seatClass={seatClass} />
          ))}
        </svg>
      </div>
      <div className="seatviewer-info">
        {!focusInfo && <div className="seatviewer-hint">點一張椅子看是誰、旁邊坐誰；兩指縮放、拖曳移動，右上角可以放大縮小、回到整張圖</div>}
        {focusInfo && focusInfo.idx === undefined && (
          <>
            <div className="seatviewer-info-head"><strong>{focusInfo.label}</strong><span className="seatviewer-hint">{focusInfo.filled} / {focusInfo.n} 位</span></div>
            <div className="seatviewer-pills">{focusInfo.list.map((s) => pill(s.idx, s.p, "t"))}</div>
          </>
        )}
        {focusInfo && focusInfo.idx !== undefined && (
          <>
            <div className="seatviewer-info-head">
              <strong>{focusInfo.label}</strong>
              <span className="seatviewer-hint">{focusInfo.idx + 1} 號</span>
              <span className={`seatviewer-info-name${focusInfo.p ? "" : " empty"}`}>{focusInfo.p ? focusInfo.p.name : "空位"}{focusInfo.p?.mine ? "　👈 你" : ""}</span>
            </div>
            {focusInfo.nb.length > 0 && (
              <>
                <div className="seatviewer-hint" style={{ marginTop: 8 }}>旁邊坐的是</div>
                <div className="seatviewer-pills">{focusInfo.nb.map((x) => pill(x.idx, x.p, "n"))}</div>
              </>
            )}
            <button type="button" className="seatviewer-link" onClick={() => setFocus({ oid: focusInfo.o.id })}>看這桌全部的人 ›</button>
          </>
        )}
      </div>
    </div>
  );
}
