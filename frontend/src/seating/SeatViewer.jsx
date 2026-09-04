// 賓客用的互動座位圖（手機優先，現場沒有人帶位，長輩也要看得懂）。
// 兩種用法：
//   fullscreen  全螢幕：上面「關閉」列、中間整張地圖、下面一個抽屜（我的位子／整個場地／放大縮小 + 點到的椅子是誰）
//   inline      嵌在頁面裡（後台「預覽賓客畫面」的手機框用）
// 開場：先貼近放大在自己的位子上，停一下，再慢慢縮小到整個場地，讓賓客知道自己在會場的哪裡。
// 名字只畫自己那桌與點到的那桌（放大到夠近時才全部畫），手機上才不會擠成一團。
// props:
//   layout    {canvas, objects}（public_map）
//   names     {object_id: {seat_index: {name, side, is_child, mine}}} 每個座位是誰
//   mineIds   Set<object_id> 自己所在的桌子
//   routes    [{x1,y1,x2,y2}] 從入口走到桌子的虛線（guide.js 算的）
//   guideText 一句白話的怎麼走（抽屜預設顯示）
//   fullscreen / onClose / title 全螢幕模式用
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LocateFixed, Maximize2, Minus, Plus, X } from "lucide-react";
import { ObjectShape } from "./SeatingMap.jsx";
import { bounds, center, seatPositions } from "./geometry.js";
import { findLandmarks } from "./guide.js";

const PAD = 40;
const MIN_ZOOM_OUT = 1.6; // 最多再縮到整張圖的 1/1.6
const MAX_ZOOM_IN = 10; // 最多放大到整張圖的 10 倍
const INTRO_HOLD_MS = 1300; // 開場停在自己位子上多久
const INTRO_ZOOM_MS = 3000; // 縮小到整個場地花多久

function fitBox(objs, pad = PAD) {
  if (!objs || !objs.length) return { x: 0, y: 0, w: 1600, h: 1000 };
  const b = bounds(objs);
  return { x: b.minX - pad, y: b.minY - pad, w: Math.max(200, b.maxX - b.minX + pad * 2), h: Math.max(200, b.maxY - b.minY + pad * 2) };
}

// 讓一個框符合容器的長寬比（meet 置中時才會剛好填滿，不會多留一邊）
function matchRatio(b, ratio) {
  let { w, h } = b;
  if (w / h > ratio) h = w / ratio; else w = h * ratio;
  return { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h };
}

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export default function SeatViewer({ layout, names, mineIds, routes = [], guideText = "", fullscreen = false, onClose, title = "" }) {
  const objects = useMemo(() => (layout?.objects || []), [layout]);
  const byId = useMemo(() => Object.fromEntries(objects.map((o) => [o.id, o])), [objects]);
  const full = useMemo(() => fitBox(objects), [objects]);
  const landmarks = useMemo(() => findLandmarks(objects), [objects]);
  const [view, setView] = useState(full);
  const [ready, setReady] = useState(false); // 開場視角算好之前先不要畫，免得閃一下整張圖
  const [focus, setFocus] = useState(null); // {oid, idx} 點到椅子；{oid} 點到桌子
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef(null);
  const pointers = useRef(new Map()); // pointerId -> {x, y}
  const gesture = useRef({ moved: 0, pinchDist: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const animRef = useRef(null);

  // ---------- 全螢幕：鎖住頁面捲動；手機按「返回」也能關掉 ----------
  useEffect(() => {
    if (!fullscreen) return undefined;
    const onPop = () => onClose?.();
    // 關掉時會 history.back()，瀏覽器預設會把捲動位置還原到最上面（而且是在 popstate 之後才做），
    // 所以這一頁乾脆整個改成不還原，由結果卡自己捲到定位
    try { window.history.scrollRestoration = "manual"; } catch { /* 舊瀏覽器沒有這個屬性 */ }
    window.history.pushState({ seatMap: true }, "");
    window.addEventListener("popstate", onPop);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("popstate", onPop);
      document.body.style.overflow = prevOverflow;
      if (window.history.state && window.history.state.seatMap) window.history.back();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen]);
  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen, onClose]);

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
  const containerRatio = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    return rect && rect.height > 0 ? rect.width / rect.height : full.w / full.h;
  }, [full]);

  const clampView = useCallback((v) => {
    const maxW = full.w * MIN_ZOOM_OUT;
    const minW = full.w / MAX_ZOOM_IN;
    let { x, y, w, h } = v;
    if (w > maxW) { const r = maxW / w; w = maxW; h *= r; }
    if (w < minW) { const r = minW / w; w = minW; h *= r; }
    // 不要拖到整張圖都看不到：畫面中心點一定要落在整張圖的範圍內（不管畫面比整張圖大還小都適用）
    const vcx = Math.min(Math.max(x + w / 2, full.x), full.x + full.w);
    const vcy = Math.min(Math.max(y + h / 2, full.y), full.y + full.h);
    return { x: vcx - w / 2, y: vcy - h / 2, w, h };
  }, [full]);

  // ---------- 平滑動畫：大小用等比、中心用線性，縮放看起來才均勻 ----------
  const cancelAnim = useCallback(() => {
    if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; }
  }, []);
  const animateTo = useCallback((target, duration = 650) => {
    cancelAnim();
    const from = { ...viewRef.current };
    const to = clampView(target);
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / duration);
      const e = easeInOut(k);
      const w = from.w * Math.pow(to.w / from.w, e);
      const h = from.h * Math.pow(to.h / from.h, e);
      const cx = from.x + from.w / 2 + (to.x + to.w / 2 - from.x - from.w / 2) * e;
      const cy = from.y + from.h / 2 + (to.y + to.h / 2 - from.y - from.h / 2) * e;
      setView({ x: cx - w / 2, y: cy - h / 2, w, h });
      animRef.current = k < 1 ? requestAnimationFrame(step) : null;
    };
    animRef.current = requestAnimationFrame(step);
  }, [cancelAnim, clampView]);
  useEffect(() => cancelAnim, [cancelAnim]);

  // 自己那幾桌的框（沒有就 null）
  const mineBox = useCallback((pad = 60) => {
    const objs = objects.filter((o) => mineIds && mineIds.has(o.id));
    if (!objs.length) return null;
    return clampView(matchRatio(fitBox(objs, pad), containerRatio()));
  }, [objects, mineIds, clampView, containerRatio]);
  const fullView = useCallback(() => matchRatio(full, containerRatio()), [full, containerRatio]);

  // 自己的第一個位子（開場先點著它，抽屜就會顯示旁邊坐誰）
  const firstMine = useMemo(() => {
    for (const [oid, seats] of Object.entries(names || {})) {
      for (const [idx, p] of Object.entries(seats)) {
        if (p && p.mine) return { oid: Number(oid), idx: Number(idx) };
      }
    }
    return null;
  }, [names]);

  // ---------- 開場：貼近自己的位子 → 停一下 → 慢慢縮小到整個場地 ----------
  useLayoutEffect(() => {
    cancelAnim();
    if (!objects.length) return undefined;
    const mb = mineBox(50);
    if (!mb) { setView(fullView()); setReady(true); return undefined; }
    setView(mb);
    setFocus(firstMine);
    setReady(true);
    const t = setTimeout(() => animateTo(fullView(), INTRO_ZOOM_MS), INTRO_HOLD_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objects, mineIds, names]);

  // 以某個圖上點為中心縮放
  const zoomAt = useCallback((factor, px, py) => {
    const v = viewRef.current;
    const nw = v.w / factor;
    const nh = v.h / factor;
    setView(clampView({ x: px - (px - v.x) / factor, y: py - (py - v.y) / factor, w: nw, h: nh }));
  }, [clampView]);
  const zoomCenter = (factor) => {
    const v = viewRef.current;
    animateTo({ x: v.x + v.w / 2 - v.w / factor / 2, y: v.y + v.h / 2 - v.h / factor / 2, w: v.w / factor, h: v.h / factor }, 300);
  };
  const fitAll = () => animateTo(fullView(), 700);
  const fitMine = () => {
    const mb = mineBox(60);
    if (!mb) return fitAll();
    setFocus(firstMine);
    return animateTo(mb, 800);
  };

  // 滾輪縮放：React 的 onWheel 是 passive，擋不住頁面捲動，所以自己掛
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      cancelAnim();
      const p = toSvg(e.clientX, e.clientY);
      zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, p.x, p.y);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [toSvg, zoomAt, cancelAnim]);

  const onPointerDown = (e) => {
    cancelAnim(); // 手一碰就停掉開場動畫，交給使用者
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
  // 名字：自己那桌、點到的那桌一定畫；放大到夠近（看得到大約 1/3 場地以內）才全部畫
  const zoomedIn = view.w < full.w / 2.8;
  const showNamesFor = (o) => !!(names && names[String(o.id)]) && (zoomedIn || (mineIds && mineIds.has(o.id)) || (focus && focus.oid === o.id));

  if (!layout || !objects.length) return null;
  const vb = `${view.x} ${view.y} ${view.w} ${view.h}`;
  const pill = (idx, p, keyPrefix = "s") => (
    <button type="button" key={`${keyPrefix}${idx}`} className={`seatviewer-pill${p?.mine ? " mine" : ""}${p ? "" : " empty"}`}
      onClick={() => setFocus({ oid: focusInfo.o.id, idx })}>
      {idx + 1} 號 {p ? p.name : "空位"}{p?.mine ? "（您）" : ""}
    </button>
  );
  const ent = landmarks.entrance ? center(landmarks.entrance) : null;

  const controls = (
    <div className="seatviewer-ctl">
      {mineIds && mineIds.size > 0 && (
        <button type="button" className="wide primary" onClick={fitMine}><LocateFixed size={15} /> 我的位子</button>
      )}
      <button type="button" onClick={fitAll} className="wide"><Maximize2 size={14} /> 整個場地</button>
      <button type="button" onClick={() => zoomCenter(1.4)} aria-label="放大"><Plus size={18} /></button>
      <button type="button" onClick={() => zoomCenter(1 / 1.4)} aria-label="縮小"><Minus size={18} /></button>
    </div>
  );

  const info = (
    <div className="seatviewer-info">
      {fullscreen && controls}
      {!focusInfo && (
        <div className="seatviewer-guide">
          {guideText && <div className="seatviewer-guide-text">{guideText}</div>}
          <div className="seatviewer-hint">金色發光的椅子是您的位子。點任何一張椅子，會顯示那是誰、旁邊坐誰；兩指可以放大縮小。</div>
        </div>
      )}
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
            <span className={`seatviewer-info-name${focusInfo.p ? "" : " empty"}`}>{focusInfo.p ? focusInfo.p.name : "空位"}{focusInfo.p?.mine ? "　👈 就是您" : ""}</span>
          </div>
          {focusInfo.p?.mine && guideText && <div className="seatviewer-guide-text">{guideText}</div>}
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
  );

  // 全螢幕時掛到 body 底下：卡片有 transform／動畫的話，position: fixed 會跟著卡片跑
  const el = (
    <div className={`seatviewer${fullscreen ? " seatviewer-full" : ""}`} role={fullscreen ? "dialog" : undefined} aria-modal={fullscreen || undefined}>
      {fullscreen && (
        <div className="seatviewer-top">
          <button type="button" className="seatviewer-top-close" onClick={onClose}><X size={18} /> 關閉地圖</button>
          <div className="seatviewer-top-title">{title}</div>
        </div>
      )}
      {!fullscreen && controls}
      <div className={`seatviewer-wrap${dragging ? " dragging" : ""}`}>
        <svg ref={svgRef} viewBox={vb} preserveAspectRatio="xMidYMid meet" className="seatmap" role="img" aria-label="座位平面圖"
          style={ready ? undefined : { visibility: "hidden" }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <defs>
            <marker id="seat-route-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="seat-route-arrow" />
            </marker>
          </defs>
          <rect x={full.x - full.w * 2} y={full.y - full.h * 2} width={full.w * 5} height={full.h * 5} className="seatmap-floor" />
          {objects.map((o) => (
            <ObjectShape key={o.id} o={o} highlighted={hiIds.has(o.id)} showNames={showNamesFor(o)}
              seatNames={names ? names[String(o.id)] || {} : undefined} seatClass={seatClass} />
          ))}
          {/* 從入口走到桌子的方向（紅色虛線，會慢慢流動） */}
          {routes.map((r, i) => (
            <line key={i} x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2} className="seat-route" markerEnd="url(#seat-route-arrow)" />
          ))}
          {ent && routes.length > 0 && (
            <g className="seat-entrance-mark" pointerEvents="none">
              <circle cx={ent.cx} cy={ent.cy} r="9" />
              <text x={ent.cx} y={ent.cy - 14} textAnchor="middle" fontSize="11" className="seat-name">從這裡進來</text>
            </g>
          )}
        </svg>
      </div>
      {info}
    </div>
  );
  return fullscreen ? createPortal(el, document.body) : el;
}
