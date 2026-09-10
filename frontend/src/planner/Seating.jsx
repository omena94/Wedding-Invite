// 座位圖編輯器：畫布上擺桌椅、指定誰坐哪。幫手登入時是唯讀。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Swal from "sweetalert2";
import {
  ArrowDownToLine, ArrowUpToLine, BoxSelect, Building2, Circle, Copy, DoorClosed, Eraser, Expand, Eye, Grid3x3, Image as ImageIcon, Maximize2, Minus, Plus, Printer, Shrink,
  RectangleHorizontal, Redo2, Square, SquareDashedMousePointer, Star, Tag, Trash2, Type, Undo2, UserRound, Users, Wand2, ZoomIn, ZoomOut,
} from "lucide-react";
import {
  assignGroup, assignSeat, autoAssignSeats, clearAllSeats, clearSeatObject, createSeatHall, createSeatHallFromPreset, createSeatObject,
  deleteSeatHall, deleteSeatObject, fetchSeatHallBackgroundUrl, fetchSeating, fetchSeatPreview, moveSeatObjects, removeSeatHallBackground,
  renameAssignment, unassignSeat, updateSeatHall, updateSeatObject, uploadSeatHallBackground,
} from "../api.js";
import { Checkbox } from "../components/Toggle.jsx";
import Select from "../components/Select.jsx";
import { DEFAULTS, KIND_LABEL, SEAT_GAP, SEAT_R, bounds, center, defaultSides, seatPositions, sidesOf } from "../seating/geometry.js";
import SeatingMap, { ObjectShape, nameGetter } from "../seating/SeatingMap.jsx";
import { planLabels } from "../seating/labels.js";
import SeatResult from "../seating/SeatResult.jsx";
import SeatViewer from '../seating/SeatViewer.jsx';
import { usePlanner } from "./context.js";
import { ErrorBox, Field, Loading, Modal, NumberInput, PageHead, confirmDelete, toInt, toastErr, toastOk, useLoader } from "./ui.jsx";

const GRID = 10;
const SIDE_LABEL = { groom: "男方", bride: "女方" };
const snap = (v, on) => (on ? Math.round(v / GRID) * GRID : Math.round(v));

export default function Seating() {
  const { role } = usePlanner();
  const readonly = role !== "couple";
  const [params, setParams] = useSearchParams();
  const printMode = params.get("print") === "1";
  // 2026-09-10 座位圖分廳：網址 ?hall= 是正在看的廳；沒帶就是「正式使用」的那一廳（賓客查桌看的）
  const hallParam = params.get("hall");
  const switchHall = (id) => {
    const next = new URLSearchParams(params);
    next.set("hall", String(id));
    setParams(next, { replace: true });
  };

  const [layout, setLayout] = useState(null);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [seatSel, setSeatSel] = useState(null);       // {object_id, seat_index}
  const [picked, setPicked] = useState([]);           // 2026-09-09 改為多選：選取的人依點選順序排隊，點椅子依序放入；可一次移除座位或整批放進一桌
  const pkey = (p) => `${p.rsvp_id}-${p.person_no}`;
  const togglePick = (person) => setPicked((list) => (list.some((x) => pkey(x) === pkey(person)) ? list.filter((x) => pkey(x) !== pkey(person)) : [...list, { rsvp_id: person.rsvp_id, person_no: person.person_no, name: person.name }]));
  const dropPick = (person) => setPicked((list) => list.filter((x) => pkey(x) !== pkey(person)));
  const lastSeatClick = useRef(null); // 上一次點的是哪張有人的椅子：連續點同一張兩次 = 取消那個座位安排（2026-09-10 新人要求）
  const [showNames, setShowNames] = useState(true);
  const [grid, setGrid] = useState(true);
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [search, setSearch] = useState("");
  const [sideFilter, setSideFilter] = useState(""); // 賓客清單只看男方或女方親友（2026-09-08 新人要求）
  const [tab, setTab] = useState("guests");
  const [view, setView] = useState({ zoom: 0.55, x: 24, y: 24 });
  const [dragChip, setDragChip] = useState(null);     // {x, y, name}
  const [hallModal, setHallModal] = useState(false);
  // 2026-09-10 新人要求平面圖直接滿版：預設把側邊欄蓋掉、畫布撐滿視窗；按「回後台版面」可切回一般畫面，會記住選擇
  const [fullscreen, setFullscreen] = useState(() => { try { return localStorage.getItem("seating_fullscreen") !== "0"; } catch { return true; } });
  const toggleFullscreen = () => setFullscreen((v) => { try { localStorage.setItem("seating_fullscreen", v ? "0" : "1"); } catch { /* 無法儲存就算了 */ } return !v; });
  useEffect(() => {
    // 全螢幕時畫布尺寸變了，重新縮放到全部
    const id = setTimeout(() => { if (layout && containerRef.current && !printMode) fitAll(); }, 50);
    return () => clearTimeout(id);
  }, [fullscreen]);
  const [showBg, setShowBg] = useState(true);   // 飯店平面圖底圖要不要顯示
  const [bgUrl, setBgUrl] = useState("");
  const [mapPreviewOpen,setMapPreviewOpen]=useState(false);
  const [preview, setPreview] = useState(null);       // 預覽某組賓客在 /seat 看到的畫面 {rsvp_id, name}
  const [marqueeMode, setMarqueeMode] = useState(false); // 框選模式：拖背景是框選而不是平移（按住 Shift 也可）
  const [hint, setHint] = useState(""); // 工具列上的小提示（複製／貼上用，不用彈窗，才不會擋住 Ctrl+V）
  const hintTimer = useRef(null);
  const flash = (msg) => { setHint(msg); clearTimeout(hintTimer.current); hintTimer.current = setTimeout(() => setHint(""), 2500); };
  const [marquee, setMarquee] = useState(null);       // 拖曳中的框 {x, y, w, h}（畫布座標）
  const [autoModal, setAutoModal] = useState(false);

  const containerRef = useRef(null);
  const drag = useRef(null);
  const history = useRef({ undo: [], redo: [] });
  const saveTimers = useRef({});

  const load = useCallback(async () => {
    setErr("");
    try {
      setLayout(await fetchSeating(readonly, hallParam));
    } catch (e) {
      setErr(e.message || "讀取失敗");
    }
  }, [readonly, hallParam]);
  useEffect(() => {
    load();
  }, [load]);
  // 換廳時清掉選取狀態（選到的桌子、排隊要入座的人都是上一廳的）
  useEffect(() => {
    setSelected(new Set());
    setPicked([]);
    setSeatSel(null);
  }, [hallParam]);
  const hallId = layout?.hall?.id ?? null;
  const hall = layout?.hall || null;
  // 沒帶 ?hall= 時把實際載到的廳寫回網址，之後重新整理、列印版才會停在同一廳
  useEffect(() => {
    if (hallId && String(hallId) !== hallParam) switchHall(hallId);
  }, [hallId]);
  // 底圖：要登入才看得到，所以先抓成 blob；幫手（唯讀）看不到底圖
  useEffect(() => {
    let url = "";
    let alive = true;
    setBgUrl("");
    if (!readonly && hall?.has_bg) {
      fetchSeatHallBackgroundUrl(hall.id).then((u) => { if (alive) { url = u; setBgUrl(u); } else URL.revokeObjectURL(u); }).catch(() => {});
    }
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [readonly, hall?.id, hall?.bg_image]);

  const objects = layout?.objects || [];
  const byId = useMemo(() => Object.fromEntries(objects.map((o) => [o.id, o])), [objects]);
  // 名字位置：整張圖先排一遍，桌子靠太近時名字改放椅子上下，不會疊在一起
  const labelPlan = useMemo(() => planLabels(objects, nameGetter(null)), [objects]);
  const byIdRef = useRef(byId);   // pointerup 時一定讀到最新位置（避免拿到舊的 closure）
  byIdRef.current = byId;
  const selectedObj = selected.size === 1 ? byId[[...selected][0]] : null;

  // ---------- 座標換算 ----------
  const toCanvas = (clientX, clientY) => {
    const r = containerRef.current.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.zoom, y: (clientY - r.top - view.y) / view.zoom };
  };
  const viewportCenter = () => {
    const r = containerRef.current?.getBoundingClientRect();
    if (!r) return { x: 200, y: 200 };
    return toCanvas(r.left + r.width / 2, r.top + r.height / 2);
  };

  // ---------- 物件更新（樂觀更新 + 延遲存檔） ----------
  const patchLocal = (id, patch) =>
    setLayout((l) => ({ ...l, objects: l.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) }));
  const saveObject = (id, patch, immediate = false) => {
    patchLocal(id, patch);
    clearTimeout(saveTimers.current[id]);
    const run = async () => {
      try {
        const saved = await updateSeatObject(id, patch);
        setLayout((l) => ({ ...l, objects: l.objects.map((o) => (o.id === id ? { ...o, ...saved } : o)) }));
      } catch (e) {
        toastErr(e);
        load();
      }
    };
    if (immediate) run();
    else saveTimers.current[id] = setTimeout(run, 400);
  };
  const pushHistory = (entry) => {
    history.current.undo.push(entry);
    if (history.current.undo.length > 50) history.current.undo.shift();
    history.current.redo = [];
  };
  const applySnapshot = async (snap) => {
    // snap: [{id, ...fields}]
    for (const s of snap) {
      const { id, ...fields } = s;
      patchLocal(id, fields);
      await updateSeatObject(id, fields).catch(toastErr);
    }
  };
  const undo = async () => {
    const e = history.current.undo.pop();
    if (!e) return;
    history.current.redo.push(e);
    await applySnapshot(e.before);
  };
  const redo = async () => {
    const e = history.current.redo.pop();
    if (!e) return;
    history.current.undo.push(e);
    await applySnapshot(e.after);
  };

  // ---------- 新增 / 刪除 / 複製 ----------
  const addObject = async (kind) => {
    const d = DEFAULTS[kind];
    const c = viewportCenter();
    const tables = objects.filter((o) => o.kind === "round" || o.kind === "rect").length;
    const label = kind === "round" || kind === "rect" ? `桌 ${tables + 1}` : kind === "zone" ? "區域" : kind === "stage" ? "舞台" : kind === "entrance" ? "入口" : kind === "label" ? "文字" : "";
    const body = {
      hall_id: hallId, kind, label, w: d.w, h: d.h, seats: d.seats,
      x: snap(c.x - d.w / 2, grid), y: snap(c.y - d.h / 2, grid),
      z_order: kind === "zone" || kind === "stage" || kind === "entrance" ? -1 : 0, // 這些墊在桌椅下面
      meta: kind === "rect" ? { sides: defaultSides(d.seats) } : {},
    };
    try {
      const o = await createSeatObject(body);
      setLayout((l) => ({ ...l, objects: [...l.objects, o].sort((a, b) => a.z_order - b.z_order || a.id - b.id), summary: { ...l.summary, seats_total: l.summary.seats_total + o.seats, tables: l.summary.tables + (o.kind === "round" || o.kind === "rect" ? 1 : 0) } }));
      setSelected(new Set([o.id]));
      setTab("object");
    } catch (e) {
      toastErr(e);
    }
  };
  // ---------- 複製 / 貼上（多選也可以；桌名自動接號：桌 1～4 → 桌 5～8） ----------
  const clipboard = useRef([]);
  const nextLabels = (items, all) => {
    const counters = {};
    const parse = (label) => /^(.*?)(\d+)$/.exec(label || "");
    return items.map((o) => {
      const m = parse(o.label);
      if (!m) return o.label ? `${o.label} 副本` : "";
      const prefix = m[1];
      if (counters[prefix] === undefined) {
        counters[prefix] = Math.max(0, ...all.map((x) => { const mm = parse(x.label); return mm && mm[1] === prefix ? parseInt(mm[2], 10) : 0; }));
      }
      counters[prefix] += 1;
      return `${prefix}${counters[prefix]}`;
    });
  };
  const pasteObjects = async (items) => {
    if (!items.length) return;
    const labels = nextLabels(items, objects);
    const created = [];
    try {
      for (let i = 0; i < items.length; i++) {
        const o = items[i];
        created.push(await createSeatObject({
          hall_id: hallId, kind: o.kind, label: labels[i], x: o.x + 40, y: o.y + 40, w: o.w, h: o.h,
          rotation: o.rotation, seats: o.seats, meta: o.meta, z_order: o.z_order, note: o.note,
        }));
      }
    } catch (e) {
      toastErr(e);
    }
    if (created.length) {
      setLayout((l) => ({ ...l, objects: [...l.objects, ...created].sort((a, b) => a.z_order - b.z_order || a.id - b.id), summary: { ...l.summary, seats_total: l.summary.seats_total + created.reduce((n, c) => n + c.seats, 0), tables: l.summary.tables + created.filter((c) => c.kind === "round" || c.kind === "rect").length } }));
      setSelected(new Set(created.map((c) => c.id)));
      setTab("object");
      flash(`已貼上 ${created.length} 個`);
    }
  };
  const copySelected = () => {
    clipboard.current = [...selected].map((id) => byId[id]).filter(Boolean).map((o) => ({ ...o }));
    if (clipboard.current.length) flash(`已複製 ${clipboard.current.length} 個，Ctrl+V 貼上`);
  };
  const duplicateSelected = () => pasteObjects([...selected].map((id) => byId[id]).filter(Boolean));
  const duplicate = (o) => pasteObjects([o]);
  const remove = async (ids) => {
    const list = [...ids].map((id) => byId[id]).filter(Boolean);
    if (!list.length) return;
    const seated = list.reduce((n, o) => n + (o.assignments?.length || 0), 0);
    const r = await Swal.fire({
      icon: "warning",
      title: list.length === 1 ? `刪除「${list[0].label || KIND_LABEL[list[0].kind]}」？` : `刪除 ${list.length} 個物件？`,
      text: seated ? `上面坐著的 ${seated} 位會變成未安排。` : "",
      showCancelButton: true, confirmButtonText: "刪除", cancelButtonText: "取消", confirmButtonColor: "#9E5A54",
    });
    if (!r.isConfirmed) return;
    try {
      for (const o of list) await deleteSeatObject(o.id);
      setSelected(new Set());
      load();
    } catch (e) {
      toastErr(e);
    }
  };

  // ---------- 拖曳（移動 / 平移 / 縮放 / 旋轉 / 拖人） ----------
  const onBgPointerDown = (e) => {
    if (e.button !== 0) return;
    if (!readonly && (marqueeMode || e.shiftKey)) {
      const p = toCanvas(e.clientX, e.clientY);
      drag.current = { type: "marquee", sx: e.clientX, sy: e.clientY, start: p, add: e.shiftKey && marqueeMode, moved: false };
      setMarquee({ x: p.x, y: p.y, w: 0, h: 0 });
    } else {
      drag.current = { type: "pan", sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const selectAll = () => setSelected(new Set(objects.map((o) => o.id)));
  const onObjPointerDown = (e, o) => {
    if (readonly) return;
    e.stopPropagation();
    if (e.button !== 0) return;
    let sel = selected;
    if (e.shiftKey) {
      sel = new Set(selected);
      sel.has(o.id) ? sel.delete(o.id) : sel.add(o.id);
    } else if (!selected.has(o.id)) {
      sel = new Set([o.id]);
    }
    setSelected(sel);
    setTab("object");
    setSeatSel(null);
    const start = {};
    sel.forEach((id) => { const t = byId[id]; if (t) start[id] = { x: t.x, y: t.y }; });
    drag.current = { type: "move", sx: e.clientX, sy: e.clientY, start, moved: false };
    containerRef.current.querySelector("svg").setPointerCapture(e.pointerId);
  };
  const onHandlePointerDown = (e, o, type) => {
    e.stopPropagation();
    drag.current = { type, id: o.id, sx: e.clientX, sy: e.clientY, o0: { ...o }, moved: false };
    containerRef.current.querySelector("svg").setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / view.zoom;
    const dy = (e.clientY - d.sy) / view.zoom;
    if (Math.abs(e.clientX - d.sx) > 2 || Math.abs(e.clientY - d.sy) > 2) d.moved = true;
    if (d.type === "pan") {
      setView((v) => ({ ...v, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
    } else if (d.type === "marquee") {
      const p = toCanvas(e.clientX, e.clientY);
      setMarquee({ x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y) });
    } else if (d.type === "move") {
      setLayout((l) => ({
        ...l,
        objects: l.objects.map((o) => (d.start[o.id] ? { ...o, x: snap(d.start[o.id].x + dx, grid), y: snap(d.start[o.id].y + dy, grid) } : o)),
      }));
    } else if (d.type === "resize") {
      const o0 = d.o0;
      const a = (-(o0.rotation || 0) * Math.PI) / 180;
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      let w = Math.max(20, snap(o0.w + lx, grid));
      let h = Math.max(20, snap(o0.h + ly, grid));
      if (o0.kind === "round") { w = Math.max(40, Math.max(w, h)); h = w; }
      if (o0.kind === "chair") { w = Math.max(16, w); h = w; }
      patchLocal(o0.id, { w, h });
    } else if (d.type === "rotate") {
      const o0 = d.o0;
      const { cx, cy } = center(o0);
      const p = toCanvas(e.clientX, e.clientY);
      let deg = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
      deg = Math.round(deg / 5) * 5;
      if (deg > 180) deg -= 360;
      patchLocal(o0.id, { rotation: deg });
    } else if (d.type === "person") {
      setDragChip({ x: e.clientX + 12, y: e.clientY + 12, name: d.person.name });
    }
  };
  const onPointerUp = async (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.type === "pan") {
      if (!d.moved) { setSelected(new Set()); setSeatSel(null); lastSeatClick.current = null; }
      return;
    }
    if (d.type === "marquee") {
      const m = marquee;
      setMarquee(null);
      if (!m || !d.moved) { setSelected(new Set()); setSeatSel(null); return; }
      // 外框有碰到框選範圍就算選到
      const hit = objects.filter((o) => {
        const { cx, cy, w, h } = center(o);
        const r = Math.sqrt(w * w + h * h) / 2 + SEAT_GAP + SEAT_R;
        return cx + r >= m.x && cx - r <= m.x + m.w && cy + r >= m.y && cy - r <= m.y + m.h;
      }).map((o) => o.id);
      setSelected((prev) => (d.add ? new Set([...prev, ...hit]) : new Set(hit)));
      setSeatSel(null);
      if (hit.length) setTab("object");
      return;
    }
    if (d.type === "move") {
      if (!d.moved) return;
      const items = Object.keys(d.start).map((id) => byIdRef.current[+id]).filter(Boolean);
      const after = items.map((o) => ({ id: o.id, x: o.x, y: o.y }));
      pushHistory({ before: items.map((o) => ({ id: o.id, ...d.start[o.id] })), after });
      try { await moveSeatObjects(after); } catch (err) { toastErr(err); load(); }
      return;
    }
    if (d.type === "resize" || d.type === "rotate") {
      if (!d.moved) return;
      const o = byIdRef.current[d.id];
      if (!o) return;
      const fields = d.type === "resize" ? { w: o.w, h: o.h } : { rotation: o.rotation };
      const before = d.type === "resize" ? { w: d.o0.w, h: d.o0.h } : { rotation: d.o0.rotation };
      pushHistory({ before: [{ id: o.id, ...before }], after: [{ id: o.id, ...fields }] });
      saveObject(o.id, fields, true);
      return;
    }
    if (d.type === "person") {
      setDragChip(null);
      if (!d.moved) {
        // 點一下（不管已入座或未安排）：切換選取，不跳提示（2026-09-09 新人要求可多選、不要每按一次就提示）
        togglePick(d.person);
        return;
      }
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const seatEl = el && el.closest ? el.closest("[data-seat-index]") : null;
      if (seatEl) {
        await place(d.person, +seatEl.dataset.objectId, +seatEl.dataset.seatIndex);
      }
    }
  };

  // ---------- 指定座位 ----------
  const place = async (person, object_id, seat_index, force = false) => {
    try {
      const l = await assignSeat({ object_id, seat_index, rsvp_id: person.rsvp_id, person_no: person.person_no, force });
      setLayout(l);
      dropPick(person);
      setSeatSel({ object_id, seat_index });
    } catch (e) {
      if (e.status === 409 && !force) {
        const r = await Swal.fire({ icon: "question", title: "這個位子已經有人", text: e.message, showCancelButton: true, confirmButtonText: "覆蓋（原本的人改為未安排）", cancelButtonText: "取消", confirmButtonColor: "#B28F70" });
        if (r.isConfirmed) return place(person, object_id, seat_index, true);
      } else {
        toastErr(e);
      }
    }
  };
  const onSeatPointerDown = (e, o, i, a) => {
    e.stopPropagation();
    if (readonly) { setSelected(new Set([o.id])); setSeatSel({ object_id: o.id, seat_index: i }); setTab("object"); return; }
    const key = `${o.id}:${i}`;
    if (a && lastSeatClick.current === key) {
      // 同一張有人的椅子連續點兩次：把這個人改成未安排（第一次點是選取，第二次就是取消安排）
      lastSeatClick.current = null;
      dropPick({ rsvp_id: a.rsvp_id, person_no: a.person_no });
      unseat(a).then(() => toastOk(`已移除 ${a.display_name} 的座位`));
      return;
    }
    lastSeatClick.current = a ? key : null;
    if (picked.length) { place(picked[0], o.id, i); return; }
    setSelected(new Set([o.id]));
    setSeatSel({ object_id: o.id, seat_index: i });
    setTab("object");
    if (a) {
      // 拖著已入座的人換位子
      drag.current = { type: "person", person: { rsvp_id: a.rsvp_id, person_no: a.person_no, name: a.display_name }, sx: e.clientX, sy: e.clientY, moved: false, fromSeat: true, assignment: a, object_id: o.id, seat_index: i };
      containerRef.current.querySelector("svg").setPointerCapture(e.pointerId);
    }
  };
  const onSeatPointerUp = () => {};
  const onPersonPointerDown = (e, person) => {
    if (readonly || person.seat) return;
    e.preventDefault();
    lastSeatClick.current = null;
    drag.current = { type: "person", person, sx: e.clientX, sy: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const seatGroup = async (g) => {
    if (!selectedObj) return toastErr(new Error("先在畫布上點選一張桌子"));
    try {
      const l = await assignGroup(selectedObj.id, g.rsvp_id);
      setLayout(l);
      toastOk(l.left_over ? `已入座 ${l.placed} 位，還有 ${l.left_over} 位沒位子` : `已入座 ${l.placed} 位`);
    } catch (e) {
      toastErr(e);
    }
  };
  const unseat = async (a) => {
    try { setLayout(await unassignSeat(a.id)); } catch (e) { toastErr(e); }
  };
  // 選取的人目前的座位指定（動作當下才查，避免拿到舊資料）
  const findAssignment = (person) => {
    for (const o of Object.values(byIdRef.current)) {
      const a = (o.assignments || []).find((x) => x.rsvp_id === person.rsvp_id && x.person_no === person.person_no);
      if (a) return a;
    }
    return null;
  };
  // 一次移除所有選取者的座位（不逐一確認；放回去很容易，所以不用再問）
  const unseatPicked = async () => {
    const seated = picked.map(findAssignment).filter(Boolean);
    if (!seated.length) return toastErr(new Error("選取的人都還沒有座位"));
    try {
      let l = null;
      for (const a of seated) l = await unassignSeat(a.id); // 依序呼叫，每次回傳整份版面
      if (l) setLayout(l);
      setPicked([]);
      toastOk(`已移除 ${seated.length} 位的座位`);
    } catch (e) { toastErr(e); }
  };
  // 把選取的人依序放進畫布上選到的那桌的空位
  const fillTable = async () => {
    const o = selectedObj;
    if (!o || !(o.kind === "round" || o.kind === "rect" || o.kind === "chair")) return toastErr(new Error("先在畫布上點選一張桌子"));
    const taken = new Set((o.assignments || []).map((a) => a.seat_index));
    const empties = Array.from({ length: o.seats || 0 }, (_, i) => i).filter((i) => !taken.has(i));
    if (!empties.length) return toastErr(new Error("這桌已經沒有空位"));
    const queue = picked.slice(0, empties.length);
    try {
      let l = null;
      for (let k = 0; k < queue.length; k++) {
        const person = queue[k];
        l = await assignSeat({ object_id: o.id, seat_index: empties[k], rsvp_id: person.rsvp_id, person_no: person.person_no, force: false });
      }
      if (l) setLayout(l);
      setPicked((list) => list.filter((x) => !queue.some((q) => pkey(q) === pkey(x))));
      const left = picked.length - queue.length;
      toastOk(left > 0 ? `已放入 ${queue.length} 位，還有 ${left} 位沒位子` : `已放入 ${queue.length} 位`);
    } catch (e) { toastErr(e); }
  };
  // 賓客清單點已入座的人：切換選取（未安排的人由 pointer 事件處理）
  const seatedClick = (g, p) => {
    if (readonly || !p.seat) return;
    togglePick({ rsvp_id: g.rsvp_id, person_no: p.person_no, name: p.name });
  };
  const rename = async (a) => {
    const r = await Swal.fire({ title: "顯示名稱", input: "text", inputValue: a.display_name, inputPlaceholder: a.auto_name, showCancelButton: true, confirmButtonText: "儲存", cancelButtonText: "取消", confirmButtonColor: "#B28F70", inputAttributes: { maxlength: 60 } });
    if (!r.isConfirmed) return;
    try { setLayout(await renameAssignment(a.id, r.value === a.auto_name ? "" : r.value)); } catch (e) { toastErr(e); }
  };
  const clearTable = async (o) => {
    const r = await Swal.fire({ icon: "warning", title: `清空「${o.label || KIND_LABEL[o.kind]}」的座位？`, showCancelButton: true, confirmButtonText: "清空", cancelButtonText: "取消", confirmButtonColor: "#9E5A54" });
    if (!r.isConfirmed) return;
    try { await clearSeatObject(o.id); load(); } catch (e) { toastErr(e); }
  };
  const clearEverything = async () => {
    const r = await Swal.fire({ icon: "warning", title: "清空所有座位指定？", text: "桌椅會保留，只是大家都變成未安排。", showCancelButton: true, confirmButtonText: "清空", cancelButtonText: "取消", confirmButtonColor: "#9E5A54" });
    if (!r.isConfirmed) return;
    try { setLayout(await clearAllSeats(hallId)); } catch (e) { toastErr(e); }
  };

  // ---------- 縮放 ----------
  const zoomAt = (factor, clientX, clientY) => {
    setView((v) => {
      const r = containerRef.current.getBoundingClientRect();
      const px = clientX === undefined ? r.width / 2 : clientX - r.left;
      const py = clientY === undefined ? r.height / 2 : clientY - r.top;
      const zoom = Math.min(3, Math.max(0.15, v.zoom * factor));
      const k = zoom / v.zoom;
      return { zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  };
  // 滾輪縮放：React 的 onWheel 是 passive，preventDefault 會被瀏覽器忽略並在 console 報錯，
  // 所以自己用 passive:false 綁在畫布上，頁面才不會跟著捲動
  const zoomAtRef = useRef(zoomAt);
  zoomAtRef.current = zoomAt;
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      zoomAtRef.current(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [layout === null, printMode]);
  const fitAll = () => {
    const r = containerRef.current?.getBoundingClientRect();
    if (!r || !layout) return;
    const b = objects.length ? bounds(objects) : { minX: 0, minY: 0, maxX: layout.canvas.w, maxY: layout.canvas.h };
    const bw = b.maxX - b.minX, bh = b.maxY - b.minY;
    const zoom = Math.min(3, Math.max(0.15, Math.min((r.width - 40) / bw, (r.height - 40) / bh)));
    setView({ zoom, x: (r.width - bw * zoom) / 2 - b.minX * zoom, y: (r.height - bh * zoom) / 2 - b.minY * zoom });
  };
  useEffect(() => {
    if (layout && containerRef.current && !printMode) fitAll();
  }, [layout?.canvas?.w, layout?.canvas?.h, layout === null, hallId]);

  // ---------- 鍵盤 ----------
  useEffect(() => {
    if (readonly) return;
    const onKey = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected.size) { e.preventDefault(); remove(selected); }
      if (e.key === "Escape") { setSelected(new Set()); setPicked([]); setSeatSel(null); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") { e.preventDefault(); selectAll(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && selected.size) { e.preventDefault(); copySelected(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v" && clipboard.current.length) { e.preventDefault(); pasteObjects(clipboard.current); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d" && selected.size) { e.preventDefault(); duplicateSelected(); }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && selected.size) {
        e.preventDefault();
        const step = e.shiftKey ? GRID * 5 : GRID;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        const items = [...selected].map((id) => byId[id]).filter(Boolean);
        pushHistory({ before: items.map((o) => ({ id: o.id, x: o.x, y: o.y })), after: items.map((o) => ({ id: o.id, x: o.x + dx, y: o.y + dy })) });
        items.forEach((o) => patchLocal(o.id, { x: o.x + dx, y: o.y + dy }));
        moveSeatObjects(items.map((o) => ({ id: o.id, x: o.x + dx, y: o.y + dy }))).catch(toastErr);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------- 賓客清單 ----------
  const guests = useMemo(() => {
    let g = layout?.guests || [];
    const q = search.trim().toLowerCase();
    if (q) g = g.filter((x) => x.name.toLowerCase().includes(q) || x.persons.some((p) => (p.name || "").toLowerCase().includes(q)));
    if (sideFilter) g = g.filter((x) => x.side === sideFilter);
    if (onlyUnassigned) g = g.filter((x) => x.unassigned > 0);
    return g;
  }, [layout, search, sideFilter, onlyUnassigned]);

  // 搜尋框有字時，畫布上符合的人也一起標亮（不用再 Ctrl+F 找）
  const searchSeats = useMemo(() => {
    const q = search.trim().toLowerCase();
    const set = new Set();
    if (!q) return set;
    objects.forEach((o) => (o.assignments || []).forEach((a) => {
      if ((a.display_name || "").toLowerCase().includes(q) || (a.auto_name || "").toLowerCase().includes(q)) set.add(`${o.id}:${a.seat_index}`);
    }));
    return set;
  }, [objects, search]);
  const highlightSeats = useMemo(() => {
    const set = new Set(searchSeats);
    if (seatSel) set.add(`${seatSel.object_id}:${seatSel.seat_index}`);
    return set;
  }, [searchSeats, seatSel]);

  if (err) return <ErrorBox error={err} />;
  if (!layout) return <Loading />;
  if (printMode) return <PrintView layout={layout} />;

  const s = layout.summary;
  const seatSelObj = seatSel ? byId[seatSel.object_id] : null;
  const halls = layout.halls || [];
  const activeHall = halls.find((h) => h.is_active);

  return (
    <div className={`se-page${fullscreen ? " se-full" : ""}`}>
      {mapPreviewOpen&&<SeatViewer layout={layout} fullscreen onClose={()=>setMapPreviewOpen(false)}/>}
      <PageHead title="座位圖" sub={fullscreen ? "" : readonly ? "唯讀：點椅子看是誰，方便帶位" : "拖曳擺桌椅，把右邊的賓客拖到椅子上；也可以先點人再點椅子。廳別還沒定案可以先各排一套，再決定哪一廳正式使用"}
        actions={
          <>
            <button className="btn btn-ghost" onClick={toggleFullscreen} title={fullscreen ? "顯示側邊欄，回到一般的後台版面" : "把平面圖放大到整個視窗"}>{fullscreen ? <><Shrink size={14} /> 回後台版面</> : <><Expand size={14} /> 滿版</>}</button>
            <span className="se-hallpick">
              <Building2 size={14} />
              <Select compact aria-label="切換廳" value={String(hallId)} onChange={(v) => switchHall(v)}
                options={halls.map((h) => ({ value: String(h.id), label: h.is_active ? `${h.name}（正式使用）` : h.name }))} />
            </span>
            {!readonly && <button className="btn btn-ghost" onClick={() => setHallModal(true)}>廳設定・畫布 {layout.canvas.w}×{layout.canvas.h}</button>}
            <button className="btn btn-ghost" onClick={()=>setMapPreviewOpen(true)}>預覽座位與路線</button>
            <a className="btn btn-ghost" href={`/planner/seating?print=1&hall=${hallId}`} target="_blank" rel="noopener"><Printer size={14} /> 列印版</a>
          </>
        } />

      <div className="se-summary">
        {hall && !hall.is_active && <span className="pill pill-warn" title="賓客在 /seat 查桌、幫手帶位看的是正式使用的那一廳">草稿：賓客看的是「{activeHall?.name || "另一廳"}」</span>}
        {hall && hall.is_active && halls.length > 1 && <span className="pill pill-yes">正式使用：賓客查桌看這一廳</span>}
        <span>桌子 <strong>{s.tables}</strong></span>
        <span>座位 <strong>{s.seats_total}</strong></span>
        <span>出席 <strong>{s.people_total}</strong> 人</span>
        <span>已安排 <strong>{s.assigned}</strong></span>
        <span className={s.unassigned ? "pill pill-warn" : "pill pill-yes"}>未安排 {s.unassigned}</span>
        {s.seats_total < s.people_total && <span className="pill pill-no">座位不夠：還差 {s.people_total - s.seats_total} 個</span>}
      </div>
      {picked.length > 0 && (
        <div className="se-selbar" role="group" aria-label="已選取的賓客">
          <span><strong>已選 {picked.length} 位</strong>：{picked.map((x) => x.name).join("、")}</span>
          <span className="muted-cell">點一張椅子會依序放入（下一位：{picked[0].name}）</span>
          <span className="se-selbar-actions">
            {selectedObj && (selectedObj.kind === "round" || selectedObj.kind === "rect") && <button className="btn btn-primary btn-sm" onClick={fillTable}>放進「{selectedObj.label || "這桌"}」的空位</button>}
            {picked.some((x) => findAssignment(x)) && <button className="btn btn-ghost btn-sm" onClick={unseatPicked}><Trash2 size={12} /> 移除座位</button>}
            <button className="btn btn-ghost btn-sm" onClick={() => setPicked([])}>取消選取</button>
          </span>
        </div>
      )}

      {!readonly && (
        <div className="se-toolbar">
          <button className="btn btn-ghost btn-sm" onClick={() => addObject("round")}><Circle size={14} /> 圓桌</button>
          <button className="btn btn-ghost btn-sm" onClick={() => addObject("rect")}><RectangleHorizontal size={14} /> 長桌</button>
          <button className="btn btn-ghost btn-sm" onClick={() => addObject("chair")}><UserRound size={14} /> 椅子</button>
          <button className="btn btn-ghost btn-sm" onClick={() => addObject("stage")} title="賓客頁用它判斷「面向舞台」的方向"><Star size={14} /> 舞台</button>
          <button className="btn btn-ghost btn-sm" onClick={() => addObject("entrance")} title="賓客頁用它算「怎麼走」與入口到桌子的路線"><DoorClosed size={14} /> 入口</button>
          <button className="btn btn-ghost btn-sm" onClick={() => addObject("zone")}><Square size={14} /> 區域</button>
          <button className="btn btn-ghost btn-sm" onClick={() => addObject('wall')}>牆面</button>
          <button className="btn btn-ghost btn-sm" onClick={() => addObject('column')}>柱體</button>
          <button className="btn btn-ghost btn-sm" onClick={() => addObject("label")}><Type size={14} /> 文字</button>
          <span className="sep" />
          <button className="btn btn-ghost btn-sm" onClick={undo} title="復原 (Ctrl+Z)"><Undo2 size={14} /></button>
          <button className="btn btn-ghost btn-sm" onClick={redo} title="重做 (Ctrl+Shift+Z)"><Redo2 size={14} /></button>
          <span className="sep" />
          <button className={`btn btn-sm ${marqueeMode ? "btn-primary" : "btn-ghost"}`} onClick={() => setMarqueeMode((m) => !m)} title="框選模式：在畫布上拖曳框住多個桌椅（平時按住 Shift 拖曳也可以）"><SquareDashedMousePointer size={14} /> 框選</button>
          <button className="btn btn-ghost btn-sm" onClick={selectAll} title="全選 (Ctrl+A)"><BoxSelect size={14} /> 全選</button>
          <button className="btn btn-ghost btn-sm" onClick={duplicateSelected} disabled={!selected.size} title="複製選取的桌椅 (Ctrl+D；也可 Ctrl+C / Ctrl+V)"><Copy size={14} /> 複製{selected.size > 1 ? ` ${selected.size} 個` : ""}</button>
          <span className="sep" />
          <button className="btn btn-primary btn-sm" onClick={() => setAutoModal(true)} title="把還沒有位子的人自動填進空位"><Wand2 size={14} /> 一鍵安排</button>
          {hint && <span className="se-hint">{hint}</span>}
          <span className="sep" />
          <button className="btn btn-ghost btn-sm" onClick={() => zoomAt(1 / 1.25)}><ZoomOut size={14} /></button>
          <span className="muted-cell" style={{ fontSize: 12, minWidth: 40, textAlign: "center" }}>{Math.round(view.zoom * 100)}%</span>
          <button className="btn btn-ghost btn-sm" onClick={() => zoomAt(1.25)}><ZoomIn size={14} /></button>
          <button className="btn btn-ghost btn-sm" onClick={fitAll}><Maximize2 size={14} /> 全部</button>
          <span className="sep" />
          <Checkbox checked={grid} onChange={setGrid}><Grid3x3 size={13} style={{ verticalAlign: -2 }} /> 對齊格線</Checkbox>
          <Checkbox checked={showNames} onChange={setShowNames}><Tag size={13} style={{ verticalAlign: -2 }} /> 顯示名字</Checkbox>
          {hall?.has_bg && <Checkbox checked={showBg} onChange={setShowBg}><ImageIcon size={13} style={{ verticalAlign: -2 }} /> 顯示底圖</Checkbox>}
          <span className="sep" />
          <button className="btn btn-ghost btn-sm" onClick={clearEverything}><Eraser size={14} /> 清空座位</button>
        </div>
      )}

      <div className="se-shell">
        <div className="se-canvas" ref={containerRef}>
          <svg onPointerDown={onBgPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
            <defs>
              {/* 格線用畫布單位畫，縮放時會跟著桌椅一起縮放 */}
              <pattern id="se-grid" width={GRID * 5} height={GRID * 5} patternUnits="userSpaceOnUse">
                <path d={`M ${GRID * 5} 0 L 0 0 0 ${GRID * 5}`} fill="none" stroke="rgba(126,96,71,0.12)" strokeWidth={1 / view.zoom} />
              </pattern>
            </defs>
            <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
              <rect x="0" y="0" width={layout.canvas.w} height={layout.canvas.h} className="floor" strokeWidth={1 / view.zoom} />
              {/* 飯店平面圖底圖：鋪滿整張畫布（範本的畫布大小就是照原圖比例算的），只是參考，不能點 */}
              {showBg && bgUrl && (
                <image href={bgUrl} x="0" y="0" width={layout.canvas.w} height={layout.canvas.h} preserveAspectRatio="none"
                  opacity={(hall?.bg_opacity ?? 55) / 100} style={{ pointerEvents: "none" }} />
              )}
              {grid && <rect x="0" y="0" width={layout.canvas.w} height={layout.canvas.h} fill="url(#se-grid)" style={{ pointerEvents: "none" }} />}
              {objects.map((o) => (
                <g key={o.id} onPointerDown={(e) => onObjPointerDown(e, o)} style={{ cursor: readonly ? "default" : "move" }}>
                  <ObjectShape o={o} selected={selected.has(o.id)} showNames={showNames} interactive labelPlan={labelPlan}
                    highlightSeats={highlightSeats}
                    onSeatPointerDown={onSeatPointerDown} onSeatPointerUp={onSeatPointerUp} />
                </g>
              ))}
              {!readonly && selectedObj && <Handles o={selectedObj} zoom={view.zoom} onPointerDown={onHandlePointerDown} />}
              {marquee && marquee.w > 0 && (
                <rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} className="se-marquee" strokeWidth={1.5 / view.zoom} strokeDasharray={`${6 / view.zoom} ${4 / view.zoom}`} />
              )}
            </g>
          </svg>
          {dragChip && <div className="se-dragchip" style={{ left: dragChip.x, top: dragChip.y }}>{dragChip.name}</div>}
        </div>

        <aside className="se-panel">
          <div className="se-tabs">
            <button className={tab === "guests" ? "active" : ""} onClick={() => setTab("guests")}><Users size={13} style={{ verticalAlign: -2 }} /> 賓客 {s.unassigned ? <span className="pill pill-warn" style={{ marginLeft: 4 }}>{s.unassigned}</span> : null}</button>
            <button className={tab === "object" ? "active" : ""} onClick={() => setTab("object")}>{selectedObj ? (selectedObj.label || KIND_LABEL[selectedObj.kind]) : "物件"}</button>
          </div>
          <div className="se-panel-body">
            {tab === "guests" ? (
              <GuestPanel guests={guests} search={search} setSearch={setSearch} sideFilter={sideFilter} setSideFilter={setSideFilter} onlyUnassigned={onlyUnassigned} setOnlyUnassigned={setOnlyUnassigned}
                picked={picked} readonly={readonly} selectedObj={selectedObj} byId={byId} onSeatedClick={seatedClick}
                onPersonPointerDown={onPersonPointerDown} onPersonPointerMove={onPointerMove} onPersonPointerUp={onPointerUp}
                onSeatGroup={seatGroup} onPreview={(g) => setPreview({ rsvp_id: g.rsvp_id, name: g.name })} />
            ) : (
              <ObjectPanel o={selectedObj} seatSel={seatSelObj ? seatSel : null} readonly={readonly} selectedCount={selected.size}
                onChange={(patch) => selectedObj && saveObject(selectedObj.id, patch)}
                onImmediate={(patch) => selectedObj && saveObject(selectedObj.id, patch, true)}
                onDuplicate={() => (selectedObj ? duplicate(selectedObj) : duplicateSelected())}
                onDelete={() => remove(selected)}
                onClear={() => selectedObj && clearTable(selectedObj)}
                onUnseat={unseat} onRename={rename}
                onPreview={(a) => setPreview({ rsvp_id: a.rsvp_id, name: a.display_name })}
                onPick={(i) => selectedObj && setSeatSel({ object_id: selectedObj.id, seat_index: i })}
                picked={picked[0] || null} onPlacePicked={(i) => picked.length && selectedObj && place(picked[0], selectedObj.id, i)} />
            )}
          </div>
        </aside>
      </div>

      {hallModal && (
        <HallModal hall={hall} halls={halls} onClose={() => setHallModal(false)}
          onLayout={(l) => { setLayout(l); if (l.hall && l.hall.id !== hallId) switchHall(l.hall.id); }} />
      )}
      {preview && <PreviewModal rsvpId={preview.rsvp_id} name={preview.name} hall={hallId} onClose={() => setPreview(null)} />}
      {autoModal && (
        <AutoAssignModal summary={s} hall={hallId} onClose={() => setAutoModal(false)}
          onDone={(l) => { setAutoModal(false); setLayout(l); toastOk(l.left_over ? `已安排 ${l.placed} 位，還有 ${l.left_over} 位沒位子（座位不夠）` : `已安排 ${l.placed} 位`); }} />
      )}
    </div>
  );
}

/* ---------- 一鍵安排 ---------- */
function AutoAssignModal({ summary, hall, onClose, onDone }) {
  const [keepGroups, setKeepGroups] = useState(true);
  const [bySide, setBySide] = useState(true);
  const [clearFirst, setClearFirst] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      onDone(await autoAssignSeats({ keep_groups: keepGroups, by_side: bySide, clear_first: clearFirst }, hall));
    } catch (e) {
      toastErr(e);
    } finally {
      setBusy(false);
    }
  };
  const toPlace = clearFirst ? summary.people_total : summary.unassigned;
  return (
    <Modal title="一鍵安排座位" onClose={onClose}
      footer={<><button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>取消</button><button type="button" className="btn btn-primary" onClick={run} disabled={busy || toPlace === 0}>{busy ? "安排中…" : `安排 ${toPlace} 位`}</button></>}>
      <div className="helper-text" style={{ marginBottom: 12 }}>
        會把還沒有位子的人依序填進空位；桌子依名稱排序（A1、A2…），排完可以再手動微調。目前座位 {summary.seats_total}、出席 {summary.people_total} 人。
      </div>
      <div className="pl-switch-list">
        <Checkbox checked={keepGroups} onChange={setKeepGroups}>同一組盡量坐同一桌（先找放得下整組的桌子，放不下才拆）</Checkbox>
        <Checkbox checked={bySide} onChange={setBySide}>男方從第一桌往後填、女方從最後一桌往前填（兩邊自然分開）</Checkbox>
        <Checkbox checked={clearFirst} onChange={setClearFirst}>先清空目前所有安排再重排</Checkbox>
      </div>
      {summary.seats_total < summary.people_total && <div className="pill pill-no" style={{ marginTop: 12 }}>座位不夠：還差 {summary.people_total - summary.seats_total} 個，會有人排不進去</div>}
    </Modal>
  );
}

/* ---------- 預覽：這組賓客在 /seat 查到的畫面 ---------- */
function PreviewModal({ rsvpId, name, hall, onClose }) {
  const { data, loading, error } = useLoader(() => fetchSeatPreview(rsvpId, hall), [rsvpId, hall]);
  return (
    <Modal title={`賓客看到的畫面 — ${name}`} onClose={onClose} wide
      footer={<button type="button" className="btn btn-primary" onClick={onClose}>關閉</button>}>
      <div className="helper-text" style={{ marginBottom: 10 }}>這就是他在 /seat 輸入姓名或電話後看到的內容（不受「桌次查詢」開關影響）。</div>
      <div className="phone-frame">
        {loading ? <Loading /> : error ? <ErrorBox error={error} /> : <SeatResult result={data} embedded />}
      </div>
    </Modal>
  );
}

/* ---------- 縮放 / 旋轉的把手 ---------- */
function Handles({ o, zoom, onPointerDown }) {
  const { cx, cy, w, h } = center(o);
  const rot = o.rotation || 0;
  const rotate = (px, py) => {
    const a = (rot * Math.PI) / 180;
    const dx = px - cx, dy = py - cy;
    return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
  };
  const size = 12 / zoom;
  const br = o.kind === "round" ? { x: cx + w / 2 * Math.SQRT1_2, y: cy + w / 2 * Math.SQRT1_2 } : rotate(o.x + w, o.y + h);
  const top = rotate(cx, o.y - SEAT_GAP - SEAT_R - 14);
  return (
    <g>
      {o.kind !== "chair" && o.kind !== "round" && (
        <line x1={cx} y1={cy} x2={top.x} y2={top.y} stroke="var(--milk-tea-500)" strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom} ${3 / zoom}`} style={{ pointerEvents: "none" }} />
      )}
      <rect x={br.x - size / 2} y={br.y - size / 2} width={size} height={size} className="se-handle" onPointerDown={(e) => onPointerDown(e, o, "resize")} />
      {o.kind !== "chair" && o.kind !== "round" && (
        <circle cx={top.x} cy={top.y} r={size / 2} className="se-rotate" onPointerDown={(e) => onPointerDown(e, o, "rotate")} />
      )}
      {o.kind === "round" && (
        <circle cx={cx} cy={o.y - SEAT_GAP - SEAT_R - 14} r={size / 2} className="se-rotate" onPointerDown={(e) => onPointerDown(e, o, "rotate")} />
      )}
    </g>
  );
}

/* ---------- 右側：賓客 ---------- */
function GuestPanel({ guests, search, setSearch, sideFilter, setSideFilter, onlyUnassigned, setOnlyUnassigned, picked, readonly, selectedObj, byId, onSeatedClick, onPersonPointerDown, onPersonPointerMove, onPersonPointerUp, onSeatGroup, onPreview }) {
  const where = (p) => (p.seat ? `${p.seat.label || KIND_LABEL[byId[p.seat.object_id]?.kind] || "桌"} · ${p.seat.seat_index + 1} 號` : "未安排");
  return (
    <div>
      <input type="text" placeholder="搜尋姓名…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 8 }} />
      <div style={{ marginBottom: 8 }}><Select compact aria-label="篩選親友方" value={sideFilter} onChange={setSideFilter} options={[{ value: "", label: "全部親友" }, { value: "groom", label: "男方親友" }, { value: "bride", label: "女方親友" }]} /></div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <Checkbox checked={onlyUnassigned} onChange={setOnlyUnassigned}>只看未安排</Checkbox>
        <span className="muted-cell" style={{ fontSize: 12 }}>{guests.length} 組</span>
      </div>
      {!readonly && <div className="helper-text" style={{ marginBottom: 8 }}>點人可多選（再點一次取消），選好後點椅子依序放入、或按上方「放進這桌」「移除座位」；也可以直接拖人到椅子上。畫布上同一張有人的椅子連續點兩次，就會取消那個座位安排。選了桌子後可按「整組入座」。</div>}
      {guests.length === 0 && <div className="empty-state" style={{ padding: 20 }}>沒有符合的賓客</div>}
      {guests.map((g) => (
        <div className="se-group" key={g.rsvp_id}>
          <div className="se-group-head">
            <span>{g.name} <span className={`pill ${g.side === "bride" ? "pill-bride" : "pill-groom"}`}>{SIDE_LABEL[g.side] || g.side}</span></span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="muted-cell" style={{ fontWeight: 400, fontSize: 12 }}>{g.persons.length - g.unassigned}/{g.persons.length}</span>
              <button type="button" className="btn btn-ghost btn-sm" title="看他在 /seat 查到的畫面" onClick={() => onPreview(g)}><Eye size={13} /></button>
            </span>
          </div>
          {g.persons.map((p) => {
            const isPicked = picked.some((x) => x.rsvp_id === g.rsvp_id && x.person_no === p.person_no);
            return (
              <div key={p.person_no} className={`se-person${p.seat ? " seated" : ""}${isPicked ? " picked" : ""}`}
                onPointerDown={(e) => onPersonPointerDown(e, { rsvp_id: g.rsvp_id, person_no: p.person_no, name: p.name, seat: p.seat })}
                onClick={() => p.seat && onSeatedClick && onSeatedClick(g, p)} title={!readonly ? "點一下選取，可多選；選好後點椅子依序放入，或用上方按鈕移除座位" : undefined}
                onPointerMove={onPersonPointerMove} onPointerUp={onPersonPointerUp} onPointerCancel={onPersonPointerUp}>
                <span>{p.is_child ? "👶 " : ""}{p.name}</span>
                <span className="where">{where(p)}</span>
              </div>
            );
          })}
          {!readonly && g.unassigned > 0 && selectedObj && (selectedObj.kind === "round" || selectedObj.kind === "rect") && (
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 6, width: "100%", justifyContent: "center" }} onClick={() => onSeatGroup(g)}>
              整組入座「{selectedObj.label || "這桌"}」（{g.unassigned} 位）
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------- 右側：物件屬性 + 座位清單 ---------- */
function ObjectPanel({ o, seatSel, readonly, selectedCount, onChange, onImmediate, onDuplicate, onDelete, onClear, onUnseat, onRename, onPreview, onPick, picked, onPlacePicked }) {
  if (!o) {
    if (selectedCount > 1) {
      return (
        <div className="empty-state" style={{ padding: 20 }}>
          <div>已選取 {selectedCount} 個物件，可以一起拖曳、方向鍵微調</div>
          {!readonly && (
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12, flexWrap: "wrap" }}>
              <button className="btn btn-primary btn-sm" onClick={onDuplicate}><Copy size={13} /> 複製這 {selectedCount} 個</button>
              <button className="btn btn-ghost btn-sm" onClick={onDelete} style={{ color: "var(--rose-accent)" }}><Trash2 size={13} /> 刪除</button>
            </div>
          )}
          <div className="helper-text" style={{ marginTop: 10 }}>複製出來的桌名會自動接號，例如桌 1～4 會變成桌 5～8</div>
        </div>
      );
    }
    return <div className="empty-state" style={{ padding: 20 }}>在畫布上點一個物件；按住 Shift 點選或用「框選」可以一次選多個</div>;
  }
  const isTable = o.kind === "round" || o.kind === "rect";
  const sides = o.kind === "rect" ? sidesOf(o) : null;
  const setSide = (k, v) => {
    const next = { ...sides, [k]: toInt(v) };
    onChange({ meta: { ...o.meta, sides: next }, seats: next.top + next.bottom + next.left + next.right });
  };
  const names = Object.fromEntries((o.assignments || []).map((a) => [a.seat_index, a]));
  return (
    <div>
      <div className="pl-list-sub" style={{ marginBottom: 8 }}>{KIND_LABEL[o.kind]}</div>
      {!readonly && (
        <>
          <Field label={o.kind === "label" ? "文字" : "名稱"}><input type="text" value={o.label} onChange={(e) => onChange({ label: e.target.value })} placeholder={o.kind === "chair" ? "（可不填）" : "例如 A1、主桌、舞台"} /></Field>
          {o.kind === "round" && (
            <div className="form-group grid-2">
              <Field label="座位數"><NumberInput value={o.seats} onChange={(v) => onChange({ seats: toInt(v) })} /></Field>
              <Field label="直徑"><NumberInput value={Math.round(o.w)} onChange={(v) => onChange({ w: Math.max(40, toInt(v)), h: Math.max(40, toInt(v)) })} /></Field>
            </div>
          )}
          {o.kind === "rect" && (
            <>
              <Field label="每邊座位（上 / 下 / 左 / 右）">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                  <NumberInput value={sides.top} onChange={(v) => setSide("top", v)} />
                  <NumberInput value={sides.bottom} onChange={(v) => setSide("bottom", v)} />
                  <NumberInput value={sides.left} onChange={(v) => setSide("left", v)} />
                  <NumberInput value={sides.right} onChange={(v) => setSide("right", v)} />
                </div>
                <div className="helper-text">共 {o.seats} 個座位</div>
              </Field>
              <div className="form-group grid-2">
                <Field label="長"><NumberInput value={Math.round(o.w)} onChange={(v) => onChange({ w: Math.max(20, toInt(v)) })} /></Field>
                <Field label="寬"><NumberInput value={Math.round(o.h)} onChange={(v) => onChange({ h: Math.max(20, toInt(v)) })} /></Field>
              </div>
            </>
          )}
          {(o.kind === "stage" || o.kind === "entrance") && (
            <div className="helper-text" style={{ marginBottom: 10 }}>
              {o.kind === "stage" ? '舞台不可通行，路線會繞開台面。' : '可放多個入口，請將入口放在廳內可通行的門口位置；賓客可自行切換出發入口。'}
            </div>
          )}
          {o.kind==='zone'&&<Checkbox checked={!!o.meta?.blocked} onChange={v=>onChange({meta:{...o.meta,blocked:v}})} label="此區域不可通行（尋路時避開）"/>}
          {(['zone','label','stage','entrance','wall','column'].includes(o.kind)) && (
            <div className="form-group grid-2">
              <Field label="寬"><NumberInput value={Math.round(o.w)} onChange={(v) => onChange({ w: Math.max(20, toInt(v)) })} /></Field>
              <Field label="高"><NumberInput value={Math.round(o.h)} onChange={(v) => onChange({ h: Math.max(20, toInt(v)) })} /></Field>
            </div>
          )}
          {o.kind !== "chair" && (
            <Field label="旋轉（度）"><NumberInput value={Math.round(o.rotation || 0)} onChange={(v) => onChange({ rotation: toInt(v) % 360 })} /></Field>
          )}
          <Field label="備註"><input type="text" value={o.note || ""} onChange={(e) => onChange({ note: e.target.value })} placeholder="例如：靠近舞台、長輩桌" /></Field>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            <button className="btn btn-ghost btn-sm" onClick={onDuplicate}><Copy size={13} /> 複製</button>
            <button className="btn btn-ghost btn-sm" onClick={() => onImmediate({ z_order: (o.z_order || 0) + 1 })}><ArrowUpToLine size={13} /> 上層</button>
            <button className="btn btn-ghost btn-sm" onClick={() => onImmediate({ z_order: (o.z_order || 0) - 1 })}><ArrowDownToLine size={13} /> 下層</button>
            {isTable && <button className="btn btn-ghost btn-sm" onClick={onClear}><Eraser size={13} /> 清空座位</button>}
            <button className="btn btn-ghost btn-sm" onClick={onDelete} style={{ color: "var(--rose-accent)" }}><Trash2 size={13} /> 刪除</button>
          </div>
        </>
      )}
      {(isTable || o.kind === "chair") && (
        <>
          <div className="pl-list-title" style={{ fontSize: 13 }}>座位（{(o.assignments || []).length}/{o.seats}）</div>
          <ul className="se-seatlist">
            {Array.from({ length: o.seats }, (_, i) => {
              const a = names[i];
              const cur = seatSel && seatSel.seat_index === i;
              return (
                <li key={i} className={cur ? "cur" : ""} onClick={() => onPick(i)}>
                  <span><span className="muted-cell">{i + 1}.</span> {a ? <>{a.is_child ? "👶 " : ""}{a.display_name}</> : <span className="muted-cell">（空）</span>}</span>
                  {readonly && a && (
                    <button className="btn btn-ghost btn-sm" title="看他在 /seat 查到的畫面" onClick={(e) => { e.stopPropagation(); onPreview(a); }}><Eye size={12} /></button>
                  )}
                  {!readonly && (
                    <span style={{ whiteSpace: "nowrap" }}>
                      {a ? (
                        <>
                          <button className="btn btn-ghost btn-sm" title="看他在 /seat 查到的畫面" onClick={(e) => { e.stopPropagation(); onPreview(a); }}><Eye size={12} /></button>{" "}
                          <button className="btn btn-ghost btn-sm" title="改顯示名稱" onClick={(e) => { e.stopPropagation(); onRename(a); }}>改名</button>{" "}
                          <button className="btn btn-ghost btn-sm" title="移除" onClick={(e) => { e.stopPropagation(); onUnseat(a); }}><Minus size={12} /></button>
                        </>
                      ) : picked ? (
                        <button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); onPlacePicked(i); }}><Plus size={12} /> 放 {picked.name}</button>
                      ) : null}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

/* ---------- 廳設定：名稱、畫布、底圖、正式使用；新增／複製／刪除廳、載入飯店平面圖範本 ---------- */
function HallModal({ hall, halls, onClose, onLayout }) {
  const [name, setName] = useState(hall.name);
  const [w, setW] = useState(hall.w);
  const [h, setH] = useState(hall.h);
  const [clearance, setClearance] = useState(hall.clearance ?? 20);
  const [opacity, setOpacity] = useState(hall.bg_opacity ?? 55);
  const [hasBg, setHasBg] = useState(!!hall.has_bg);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const run = async (fn, doneMsg) => {
    setBusy(true);
    try {
      const l = await fn();
      if (l && l.objects) onLayout(l);
      if (doneMsg) toastOk(doneMsg);
      return l;
    } catch (e) {
      toastErr(e);
    } finally {
      setBusy(false);
    }
    return null;
  };
  const save = async () => {
    const body = { name: name.trim() || hall.name, w: Math.max(400, toInt(w)), h: Math.max(400, toInt(h)), clearance: Math.max(4, Math.min(100, toInt(clearance))), bg_opacity: Math.max(10, Math.min(100, toInt(opacity))) };
    const l = await run(() => updateSeatHall(hall.id, body), "已儲存");
    if (l) onClose();
  };
  const makeActive = async () => {
    const r = await Swal.fire({ icon: "question", title: `把「${hall.name}」設為正式使用？`, text: "賓客在「我的座位」查到的桌次、幫手帶位看的座位圖，都會換成這一廳的安排。", showCancelButton: true, confirmButtonText: "設為正式使用", cancelButtonText: "取消", confirmButtonColor: "#B28F70" });
    if (!r.isConfirmed) return;
    await run(() => updateSeatHall(hall.id, { is_active: true }), `賓客查桌改看「${hall.name}」`);
  };
  const uploadBg = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      await uploadSeatHallBackground(hall.id, file);
      setHasBg(true);
      // 重新載入整份版面，底圖檔名變了畫布才會重抓
      onLayout(await fetchSeating(false, hall.id));
      toastOk("底圖已更新");
    } catch (e) {
      toastErr(e);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const removeBg = async () => {
    if (!(await confirmDelete("這張底圖"))) return;
    setBusy(true);
    try {
      await removeSeatHallBackground(hall.id);
      setHasBg(false);
      onLayout(await fetchSeating(false, hall.id));
    } catch (e) {
      toastErr(e);
    } finally {
      setBusy(false);
    }
  };
  const askName = async (title, initial) => {
    const r = await Swal.fire({ title, input: "text", inputValue: initial, showCancelButton: true, confirmButtonText: "建立", cancelButtonText: "取消", confirmButtonColor: "#B28F70", inputAttributes: { maxlength: 50 }, inputValidator: (v) => (!v || !v.trim() ? "請輸入名稱" : undefined) });
    return r.isConfirmed ? r.value.trim() : null;
  };
  const addBlank = async () => {
    const n = await askName("新的廳叫什麼？", "新的廳");
    if (n === null) return;
    const l = await run(() => createSeatHall({ name: n }), `已新增「${n}」`);
    if (l) onClose();
  };
  const copyHall = async () => {
    const n = await askName("複製後的廳叫什麼？（桌椅會複製，誰坐哪不會）", `${hall.name} 副本`);
    if (n === null) return;
    const l = await run(() => createSeatHall({ name: n, copy_from: hall.id }), `已複製成「${n}」`);
    if (l) onClose();
  };
  const loadPreset = async () => {
    const r = await Swal.fire({ icon: "info", title: "載入飯店提供的「萬福廳」平面圖？", html: "會新增一個叫「萬福廳」的廳，照飯店的圖擺好 20 段長桌（每段兩側各 3 位，共 120 個座位）、舞台、入口、洗手間等，並把原圖放在底下當底圖。<br>現在這一廳不會被動到，之後可以隨時切換。", showCancelButton: true, confirmButtonText: "載入", cancelButtonText: "取消", confirmButtonColor: "#B28F70" });
    if (!r.isConfirmed) return;
    const l = await run(() => createSeatHallFromPreset("wanfu"), "已載入萬福廳");
    if (l) onClose();
  };
  const removeHall = async () => {
    if (!(await confirmDelete(`「${hall.name}」整個廳（桌椅與座位安排會一起刪除）`))) return;
    const l = await run(() => deleteSeatHall(hall.id), `已刪除「${hall.name}」`);
    if (l) onClose();
  };
  return (
    <Modal title={`廳設定 — ${hall.name}`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose} disabled={busy}>關閉</button><button className="btn btn-primary" disabled={busy} onClick={save}>儲存</button></>}>
      <Field label="廳的名稱"><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 萬福廳" maxLength={50} /></Field>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        {hall.is_active
          ? <span className="pill pill-yes">正式使用：賓客查桌、幫手帶位看這一廳</span>
          : <><span className="pill pill-warn">草稿</span><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={makeActive}>設為正式使用</button></>}
      </div>

      <div className="pl-list-title" style={{ fontSize: 13 }}>畫布</div>
      <div className="helper-text" style={{ marginBottom: 10 }}>單位是畫布像素（50 單位約 1 公尺），圓桌預設直徑 120。場地大就把畫布加大，縮放時桌子不會變小。</div>
      <div className="form-group grid-2">
        <Field label="寬"><NumberInput value={w} onChange={setW} /></Field>
        <Field label="高"><NumberInput value={h} onChange={setH} /></Field>
      </div>
      <Field label="路線與障礙物的保留距離（畫布單位）" hint="每側預留這個距離，包含桌邊椅子；通道不足就不會畫出路線。"><NumberInput value={clearance} onChange={setClearance} /></Field>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setW(1900); setH(1000); setClearance(23); }}>套用美福 38 × 20 公尺比例</button>

      <div className="pl-list-title" style={{ fontSize: 13, marginTop: 16 }}>底圖（飯店給的平面圖）</div>
      <div className="helper-text" style={{ marginBottom: 8 }}>鋪在畫布最底下當參考，方便對照著擺桌椅；賓客不會看到。畫布的長寬比最好跟圖一樣，圖才不會被拉歪。</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp" hidden onChange={(e) => uploadBg(e.target.files?.[0])} />
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}><ImageIcon size={13} /> {hasBg ? "換一張底圖" : "上傳底圖"}</button>
        {hasBg && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={removeBg} style={{ color: "var(--rose-accent)" }}><Trash2 size={13} /> 移除底圖</button>}
        {!hasBg && <span className="muted-cell" style={{ fontSize: 12 }}>目前沒有底圖</span>}
      </div>
      {hasBg && <Field label="底圖透明度（10～100）" hint="數字越小越淡。"><NumberInput value={opacity} onChange={setOpacity} /></Field>}

      <div className="pl-list-title" style={{ fontSize: 13, marginTop: 16 }}>其他廳</div>
      <div className="helper-text" style={{ marginBottom: 8 }}>廳別還沒確定前可以同時留好幾套座位圖，各自排位；用頁首的下拉切換。</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={loadPreset}><Building2 size={13} /> 載入飯店提供的「萬福廳」平面圖</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={addBlank}><Plus size={13} /> 新增空白廳</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={copyHall}><Copy size={13} /> 複製這一廳</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy || halls.length <= 1} onClick={removeHall} style={{ color: "var(--rose-accent)" }} title={halls.length <= 1 ? "至少要留一個廳" : undefined}><Trash2 size={13} /> 刪除這一廳</button>
      </div>
    </Modal>
  );
}

/* ---------- 列印版：整張圖 + 每桌名單 ---------- */
function PrintView({ layout }) {
  const tables = layout.objects.filter((o) => (o.kind === "round" || o.kind === "rect" || o.kind === "chair") && o.seats > 0);
  return (
    <div className="se-print">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }} className="no-print">
        <h1 className="pl-title">座位圖 · 列印版{layout.hall?.name ? ` · ${layout.hall.name}` : ""}</h1>
        <button className="btn btn-primary" onClick={() => window.print()}><Printer size={14} /> 列印</button>
      </div>
      <div className="print-page">
        <SeatingMap layout={layout} showNames maxHeight={1000} fit />
      </div>
      <div className="print-page">
        <h2 className="pl-title" style={{ fontSize: 18, margin: "12px 0" }}>每桌名單</h2>
        <div className="print-tables">
          {tables.map((o) => (
            <div key={o.id} className="print-table">
              <div className="print-table-title">{o.label || KIND_LABEL[o.kind]} <span className="muted-cell">{(o.assignments || []).length}/{o.seats}</span></div>
              <ol>
                {Array.from({ length: o.seats }, (_, i) => {
                  const a = (o.assignments || []).find((x) => x.seat_index === i);
                  return <li key={i}>{a ? a.display_name : <span className="muted-cell">—</span>}</li>;
                })}
              </ol>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
