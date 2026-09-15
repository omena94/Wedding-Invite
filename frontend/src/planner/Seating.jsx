// 座位圖：分「安排座位」與「編輯場地」兩個模式（2026-09-15 新人反映排位操作不直觀，改成以桌為單位）。
// 安排座位：桌子只能點、不能拖；點桌子打開這桌的座位表，賓客整組按鈕或拖到桌上就入座；換座號在座位表裡拖。
// 編輯場地：原本的桌椅擺放工具（拖曳、旋轉、對齊、範本固定物件）。幫手登入時只有唯讀的安排座位畫面。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Swal from "sweetalert2";
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter, AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter,
  Armchair, ArrowDownToLine, ArrowUpToLine, BoxSelect, Building2, Circle, Copy, DoorClosed, Eraser, Expand, Eye, GripVertical, Grid3x3, Image as ImageIcon, Lock, LockOpen, Maximize2, Minus, PencilRuler, Plus, Printer, Shrink,
  RectangleHorizontal, Redo2, Square, SquareDashedMousePointer, Star, Tag, Trash2, Type, Undo2, UserRound, Users, Wand2, X, ZoomIn, ZoomOut,
} from "lucide-react";
import {
  assignGroup, assignSeat, autoAssignSeats, clearAllSeats, clearSeatObject, createSeatHall, createSeatHallFromPreset, createSeatObject,
  deleteSeatHall, deleteSeatObject, fetchSeatHallBackgroundUrl, fetchSeatPresets, fetchSeating, fetchSeatPreview, moveSeatObjects, removeSeatHallBackground,
  renameAssignment, resetSeatHallFixtures, swapSeats, unassignSeat, updateSeatHall, updateSeatObject, uploadSeatHallBackground,
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
const isTable = (o) => !!o && (o.kind === "round" || o.kind === "rect" || o.kind === "chair") && o.seats > 0;
const tableName = (o) => (o ? o.label || KIND_LABEL[o.kind] || "桌" : "桌");
// 這張桌子還空著的座號（照座號順序）
const freeSeats = (o) => {
  const taken = new Set((o?.assignments || []).map((a) => a.seat_index));
  return Array.from({ length: o?.seats || 0 }, (_, i) => i).filter((i) => !taken.has(i));
};

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
  // 模式：seat = 安排座位（預設）、edit = 編輯場地。幫手永遠是唯讀的安排座位畫面
  const [mode, setMode] = useState(() => { try { return localStorage.getItem("seating_mode") === "edit" ? "edit" : "seat"; } catch { return "seat"; } });
  const seatMode = readonly || mode === "seat";
  const switchMode = (m) => { setMode(m); try { localStorage.setItem("seating_mode", m); } catch { /* 無法儲存就算了 */ } setSelected(new Set()); setSeatSel(null); setPicked([]); };
  const [selected, setSelected] = useState(() => new Set());
  const [seatSel, setSeatSel] = useState(null);       // {object_id, seat_index}
  const [picked, setPicked] = useState([]);           // 2026-09-09 改為多選：選取的人依點選順序排隊，點椅子依序放入；可一次移除座位或整批放進一桌
  const pkey = (p) => `${p.rsvp_id}-${p.person_no}`;
  const togglePick = (person) => setPicked((list) => (list.some((x) => pkey(x) === pkey(person)) ? list.filter((x) => pkey(x) !== pkey(person)) : [...list, { rsvp_id: person.rsvp_id, person_no: person.person_no, name: person.name }]));
  const dropPick = (person) => setPicked((list) => list.filter((x) => pkey(x) !== pkey(person)));
  const [showNames, setShowNames] = useState(false); // 2026-09-10 新人要求：平時不顯示名字，點到哪桌才顯示那桌的；勾這個才全部顯示
  const [grid, setGrid] = useState(true);
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [search, setSearch] = useState("");
  const [sideFilter, setSideFilter] = useState(""); // 賓客清單只看男方或女方親友（2026-09-08 新人要求）
  const [view, setView] = useState({ zoom: 0.55, x: 24, y: 24 });
  const [dragChip, setDragChip] = useState(null);     // {x, y, name}
  const [dropTarget, setDropTarget] = useState(null); // 拖人／拖整組時滑鼠下面的那張桌子 id（整桌亮起）
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
  const [hint, setHint] = useState(null); // 工具列上的小提示 { text, undo }（不用彈窗，才不會擋住 Ctrl+V；有 undo 就多一顆「復原」）
  const hintTimer = useRef(null);
  const flash = (msg, undoFn = null) => { setHint({ text: msg, undo: undoFn }); clearTimeout(hintTimer.current); hintTimer.current = setTimeout(() => setHint(null), undoFn ? 6000 : 2500); };
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
  const tables = useMemo(() => objects.filter(isTable), [objects]);
  // 名字位置：整張圖先排一遍，桌子靠太近時名字改放椅子上下，不會疊在一起
  const labelPlan = useMemo(() => planLabels(objects, nameGetter(null)), [objects]);
  // 選到的人所在的椅子（給畫布用對比色標出來）；一定要放在 byId 之後，不然載入時會因為變數還沒定義而整頁白掉
  const pickedSeats = useMemo(() => {
    const set = new Set();
    picked.forEach((p) => { for (const o of Object.values(byId)) { const a = (o.assignments || []).find((x) => x.rsvp_id === p.rsvp_id && x.person_no === p.person_no); if (a) { set.add(`${o.id}:${a.seat_index}`); break; } } });
    return set;
  }, [picked, byId]);
  const byIdRef = useRef(byId);   // pointerup 時一定讀到最新位置（避免拿到舊的 closure）
  byIdRef.current = byId;
  const selectedObj = selected.size === 1 ? byId[[...selected][0]] : null;
  const selectedTable = isTable(selectedObj) ? selectedObj : null;

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
  // history 是 ref，按鈕的亮暗要靠這個計數器重新渲染（2026-09-11 新人反映按了沒反應：其實是沒東西可復原，但按鈕看不出來）
  const [histVer, setHistVer] = useState(0);
  const bumpHist = () => setHistVer((v) => v + 1);
  const pushHistory = (entry) => {
    history.current.undo.push(entry);
    if (history.current.undo.length > 50) history.current.undo.shift();
    history.current.redo = [];
    bumpHist();
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
    if (!e) { flash("沒有可以復原的動作（重新整理後紀錄會清空）"); return; }
    history.current.redo.push(e);
    bumpHist();
    try { if (e.undoFn) await e.undoFn(); else await applySnapshot(e.before); flash(`已復原（還可再復原 ${history.current.undo.length} 步）`); } catch (err) { toastErr(err); load(); }
  };
  const redo = async () => {
    const e = history.current.redo.pop();
    if (!e) { flash("沒有可以重做的動作"); return; }
    history.current.undo.push(e);
    bumpHist();
    try { if (e.redoFn) await e.redoFn(); else await applySnapshot(e.after); flash("已重做"); } catch (err) { toastErr(err); load(); }
  };
  // 座位操作也能復原（2026-09-10 新人反映常誤觸）：記一組 undo / redo，提示上放「復原」，Ctrl+Z 也通
  const recordSeat = (msg, undoFn, redoFn) => {
    pushHistory({ undoFn, redoFn });
    flash(msg, async () => { history.current.undo = history.current.undo.filter((x) => x.undoFn !== undoFn); bumpHist(); setHint(null); try { await undoFn(); } catch (err) { toastErr(err); load(); } });
  };
  const seatOf = (person) => {
    for (const o of Object.values(byIdRef.current)) {
      const a = (o.assignments || []).find((x) => x.rsvp_id === person.rsvp_id && x.person_no === person.person_no);
      if (a) return a;
    }
    return null;
  };
  const putBack = async (person, seat) => {
    // seat 為 null = 原本沒位子 → 移除；否則放回原位
    if (seat) return setLayout(await assignSeat({ object_id: seat.object_id, seat_index: seat.seat_index, rsvp_id: person.rsvp_id, person_no: person.person_no, force: true }));
    const a = seatOf(person);
    if (a) setLayout(await unassignSeat(a.id));
  };
  // 這組人現在各坐哪（復原整組動作時放回去用）
  const snapshotPersons = (persons) => persons.map((p) => { const a = seatOf(p); return { person: { rsvp_id: p.rsvp_id, person_no: p.person_no, name: p.name }, seat: a ? { object_id: a.object_id, seat_index: a.seat_index } : null }; });
  const restorePersons = async (items) => { for (const it of items) await putBack(it.person, it.seat); };

  // ---------- 新增 / 刪除 / 複製 ----------
  const addObject = async (kind) => {
    const d = DEFAULTS[kind];
    const c = viewportCenter();
    const tableCount = objects.filter((o) => o.kind === "round" || o.kind === "rect").length;
    const label = kind === "round" || kind === "rect" ? `桌 ${tableCount + 1}` : kind === "zone" ? "區域" : kind === "stage" ? "舞台" : kind === "entrance" ? "入口" : kind === "label" ? "文字" : "";
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
      flash(`已貼上 ${created.length} 個`);
    }
  };
  const copySelected = () => {
    clipboard.current = [...selected].map((id) => byId[id]).filter(Boolean).map((o) => ({ ...o }));
    if (clipboard.current.length) flash(`已複製 ${clipboard.current.length} 個，Ctrl+V 貼上`);
  };
  const duplicateSelected = () => pasteObjects([...selected].map((id) => byId[id]).filter(Boolean));
  // ---------- 對齊 / 等距（2026-09-10 新人反映拖曳對不齊）----------
  // 以每個物件的外框（不含椅子）計算；等距是把中心點平均分布在最左（上）與最右（下）之間
  const alignSelected = (mode) => {
    const items = [...selected].map((id) => byId[id]).filter((o) => o && !o.meta?.locked);
    if (items.length < 2) return;
    const boxes = items.map((o) => { const { cx, cy, w, h } = center(o); return { o, cx, cy, left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2 }; });
    const move = (b, dx, dy) => ({ id: b.o.id, x: Math.round(b.o.x + dx), y: Math.round(b.o.y + dy) });
    let after = [];
    if (mode === "left") { const v = Math.min(...boxes.map((b) => b.left)); after = boxes.map((b) => move(b, v - b.left, 0)); }
    if (mode === "right") { const v = Math.max(...boxes.map((b) => b.right)); after = boxes.map((b) => move(b, v - b.right, 0)); }
    if (mode === "top") { const v = Math.min(...boxes.map((b) => b.top)); after = boxes.map((b) => move(b, 0, v - b.top)); }
    if (mode === "bottom") { const v = Math.max(...boxes.map((b) => b.bottom)); after = boxes.map((b) => move(b, 0, v - b.bottom)); }
    if (mode === "hcenter") { const v = boxes.reduce((s, b) => s + b.cx, 0) / boxes.length; after = boxes.map((b) => move(b, v - b.cx, 0)); }
    if (mode === "vcenter") { const v = boxes.reduce((s, b) => s + b.cy, 0) / boxes.length; after = boxes.map((b) => move(b, 0, v - b.cy)); }
    if (mode === "hspread" || mode === "vspread") {
      const k = mode === "hspread" ? "cx" : "cy";
      const sorted = [...boxes].sort((a, b) => a[k] - b[k]);
      const step = (sorted[sorted.length - 1][k] - sorted[0][k]) / (sorted.length - 1);
      after = sorted.map((b, i) => move(b, mode === "hspread" ? sorted[0].cx + step * i - b.cx : 0, mode === "vspread" ? sorted[0].cy + step * i - b.cy : 0));
    }
    if (!after.length) return;
    pushHistory({ before: items.map((o) => ({ id: o.id, x: o.x, y: o.y })), after });
    after.forEach((u) => patchLocal(u.id, { x: u.x, y: u.y }));
    moveSeatObjects(after).catch((e) => { toastErr(e); load(); });
    flash(`已對齊 ${after.length} 個`);
  };
  // 把選取的物件貼到格線上（座標湊成 10 的倍數）；範本載入的桌子座標不在格線上時，先貼齊再拖就對得齊
  const snapSelected = () => {
    const items = [...selected].map((id) => byId[id]).filter((o) => o && !o.meta?.locked);
    if (!items.length) return;
    const after = items.map((o) => ({ id: o.id, x: snap(o.x, true), y: snap(o.y, true) }));
    pushHistory({ before: items.map((o) => ({ id: o.id, x: o.x, y: o.y })), after });
    after.forEach((u) => patchLocal(u.id, { x: u.x, y: u.y }));
    moveSeatObjects(after).catch((e) => { toastErr(e); load(); });
    flash(`已貼齊格線 ${after.length} 個`);
  };
  const duplicate = (o) => pasteObjects([o]);
  const remove = async (ids) => {
    const all = [...ids].map((id) => byId[id]).filter(Boolean);
    const list = all.filter((o) => !o.meta?.locked);
    if (all.length && !list.length) return toastErr(new Error("這是固定物件（牆、柱、洗手間…），不能刪除；要刪請先在物件面板解除鎖定"));
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

  // ---------- 拖曳（移動 / 平移 / 縮放 / 旋轉 / 拖人 / 拖整組） ----------
  const onBgPointerDown = (e) => {
    if (e.button !== 0) return;
    if (!seatMode && (marqueeMode || e.shiftKey)) {
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
    if (e.button !== 0) return;
    if (seatMode) {
      // 排位模式：桌子只能「點」，不能拖。按下先當平移，放開沒移動才算點到這桌；其他物件當背景
      if (!isTable(o)) return;
      e.stopPropagation();
      drag.current = { type: "pan", sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false, tap: o.id };
      containerRef.current.querySelector("svg").setPointerCapture(e.pointerId);
      return;
    }
    e.stopPropagation();
    let sel = selected;
    if (e.shiftKey) {
      sel = new Set(selected);
      sel.has(o.id) ? sel.delete(o.id) : sel.add(o.id);
    } else if (!selected.has(o.id)) {
      sel = new Set([o.id]);
    }
    setSelected(sel);
    setSeatSel(null);
    const start = {};
    sel.forEach((id) => { const t = byId[id]; if (t && !t.meta?.locked) start[id] = { x: t.x, y: t.y }; }); // 鎖定的固定物件不跟著拖（2026-09-11）
    if (!Object.keys(start).length) return;
    drag.current = { type: "move", sx: e.clientX, sy: e.clientY, start, moved: false };
    containerRef.current.querySelector("svg").setPointerCapture(e.pointerId);
  };
  const onHandlePointerDown = (e, o, type) => {
    e.stopPropagation();
    drag.current = { type, id: o.id, sx: e.clientX, sy: e.clientY, o0: { ...o }, moved: false };
    containerRef.current.querySelector("svg").setPointerCapture(e.pointerId);
  };
  // 拖人／拖整組時，滑鼠下面是哪張桌子（椅子、桌面都算）
  const tableUnder = (clientX, clientY) => {
    const el = document.elementFromPoint(clientX, clientY);
    const g = el && el.closest ? el.closest("[data-object-id]") : null;
    if (!g) return null;
    const o = byIdRef.current[+g.dataset.objectId];
    return isTable(o) ? o : null;
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / view.zoom;
    const dy = (e.clientY - d.sy) / view.zoom;
    if (Math.abs(e.clientX - d.sx) > 8 || Math.abs(e.clientY - d.sy) > 8) d.moved = true; // 8px 內算點擊，手抖不會變成拖曳（2026-09-10）
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
    } else if (d.type === "person" || d.type === "group") {
      if (!d.moved) return;
      setDragChip({ x: e.clientX + 12, y: e.clientY + 12, name: d.type === "group" ? `${d.group.name}（${d.group.count} 位）` : d.person.name });
      const t = tableUnder(e.clientX, e.clientY);
      setDropTarget(t ? t.id : null);
    }
  };
  const onPointerUp = async (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.type === "pan") {
      if (d.moved) return;
      if (d.tap) { tableClick(byIdRef.current[d.tap]); return; } // 點到桌子
      setSelected(new Set()); setSeatSel(null); setPicked([]); // 點空白處 = 取消桌子與人的選取（2026-09-11）
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
      setDropTarget(null);
      if (!d.moved) {
        // 點一下（不管已入座或未安排）：切換選取，不跳提示（2026-09-09 新人要求可多選、不要每按一次就提示）
        togglePick(d.person);
        return;
      }
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const seatEl = el && el.closest ? el.closest("[data-seat-index]") : null;
      const table = tableUnder(e.clientX, e.clientY);
      if (seatEl) {
        await place(d.person, +seatEl.dataset.objectId, +seatEl.dataset.seatIndex);
      } else if (table) {
        // 放到桌面上（不用對準椅子）：補進這桌第一個空位
        const free = freeSeats(table);
        if (!free.length) return flash(`「${tableName(table)}」已經坐滿了`);
        await place(d.person, table.id, free[0]);
      } else if (d.fromSeat) {
        flash("要取消座位：在右邊這桌的座位表按「移除」，或選到後按 Delete");
      }
      return;
    }
    if (d.type === "group") {
      setDragChip(null);
      setDropTarget(null);
      if (!d.moved) return;
      const table = tableUnder(e.clientX, e.clientY);
      if (table) await groupToTable(d.group.g, table);
    }
  };

  // ---------- 指定座位 ----------
  // 放人到椅子上。位子已經有人就直接換掉，原本的人改為未安排（2026-09-10 新人要求拿掉「這個位子已經有人」的確認視窗）
  const place = async (person, object_id, seat_index) => {
    const prev = (byIdRef.current[object_id]?.assignments || []).find((x) => x.seat_index === seat_index);
    const replaced = prev && !(prev.rsvp_id === person.rsvp_id && prev.person_no === person.person_no) ? prev : null;
    const before = seatOf(person); // 這個人原本坐哪（可能沒有）
    const beforeSeat = before ? { object_id: before.object_id, seat_index: before.seat_index } : null;
    try {
      const l = await assignSeat({ object_id, seat_index, rsvp_id: person.rsvp_id, person_no: person.person_no, force: true });
      setLayout(l);
      dropPick(person);
      setSelected(new Set([object_id]));
      setSeatSel({ object_id, seat_index });
      const table = byIdRef.current[object_id];
      const undoFn = async () => {
        await putBack(person, beforeSeat);
        if (replaced) setLayout(await assignSeat({ object_id, seat_index, rsvp_id: replaced.rsvp_id, person_no: replaced.person_no, force: true }));
      };
      const redoFn = async () => setLayout(await assignSeat({ object_id, seat_index, rsvp_id: person.rsvp_id, person_no: person.person_no, force: true }));
      recordSeat(replaced ? `${person.name} 放到 ${tableName(table)} ${seat_index + 1} 號，${replaced.display_name} 改為未安排` : `${person.name} 放到 ${tableName(table)} ${seat_index + 1} 號`, undoFn, redoFn);
    } catch (e) {
      toastErr(e);
    }
  };
  // 把選到的幾個人依序放進這桌的空位（先選人再點桌子）
  const placeMany = async (persons, table) => {
    const free = freeSeats(table);
    if (!free.length) return flash(`「${tableName(table)}」已經坐滿了`);
    const todo = persons.slice(0, free.length);
    const before = snapshotPersons(todo);
    try {
      let l = null;
      for (let i = 0; i < todo.length; i++) l = await assignSeat({ object_id: table.id, seat_index: free[i], rsvp_id: todo[i].rsvp_id, person_no: todo[i].person_no, force: true });
      if (l) setLayout(l);
      setPicked(persons.slice(todo.length));
      setSelected(new Set([table.id]));
      setSeatSel(null);
      const left = persons.length - todo.length;
      recordSeat(left ? `${todo.length} 位放到 ${tableName(table)}，還有 ${left} 位沒位子（這桌滿了）` : `${todo.length} 位放到 ${tableName(table)}`,
        async () => restorePersons(before),
        async () => { for (let i = 0; i < todo.length; i++) setLayout(await assignSeat({ object_id: table.id, seat_index: free[i], rsvp_id: todo[i].rsvp_id, person_no: todo[i].person_no, force: true })); });
    } catch (e) { toastErr(e); load(); }
  };
  // 排位模式點桌子：有選到的人就放進去，沒有就打開這桌的座位表
  const tableClick = (o) => {
    if (!o) return;
    if (!readonly && picked.length) { placeMany(picked, o); return; }
    setSelected(new Set([o.id]));
    setSeatSel(null);
  };
  const onSeatPointerDown = (e, o, i, a) => {
    e.stopPropagation();
    if (readonly) { setSelected(new Set([o.id])); setSeatSel({ object_id: o.id, seat_index: i }); return; }
    if (picked.length && !(a && picked.some((p) => p.rsvp_id === a.rsvp_id && p.person_no === a.person_no))) { place(picked[0], o.id, i); return; }
    setSelected(new Set([o.id]));
    setSeatSel({ object_id: o.id, seat_index: i });
    if (a) {
      // 拖著已入座的人換位子
      drag.current = { type: "person", person: { rsvp_id: a.rsvp_id, person_no: a.person_no, name: a.display_name }, sx: e.clientX, sy: e.clientY, moved: false, fromSeat: true, assignment: a, object_id: o.id, seat_index: i };
      containerRef.current.querySelector("svg").setPointerCapture(e.pointerId);
    }
  };
  const onSeatPointerUp = () => {};
  const onPersonPointerDown = (e, person) => {
    if (readonly) return;
    e.preventDefault();
    drag.current = { type: "person", person, sx: e.clientX, sy: e.clientY, moved: false, fromSeat: !!person.seat };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  // 拖整組（賓客卡片的標題列）到桌上
  const onGroupPointerDown = (e, g) => {
    if (readonly || e.button !== 0) return;
    e.preventDefault();
    drag.current = { type: "group", group: { g, name: g.name, count: g.persons.length }, sx: e.clientX, sy: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  // 整組放進這桌：預設只放還沒位子的人；moveAll = 坐別桌的也一起搬過來。放不下先問要不要只放得下的幾位
  const groupToTable = async (g, table, moveAll = false, partial = false) => {
    if (!table) return toastErr(new Error("先在平面圖上點一張桌子"));
    const persons = g.persons.map((p) => ({ rsvp_id: g.rsvp_id, person_no: p.person_no, name: p.name }));
    const before = snapshotPersons(persons);
    const opts = { move_all: moveAll, partial };
    try {
      const l = await assignGroup(table.id, g.rsvp_id, opts);
      setLayout(l);
      setSelected(new Set([table.id]));
      setSeatSel(null);
      setPicked((list) => list.filter((x) => x.rsvp_id !== g.rsvp_id));
      recordSeat(l.left_over ? `${g.name} ${l.placed} 位放到 ${tableName(table)}，還有 ${l.left_over} 位沒位子` : `${g.name} ${l.placed} 位${moveAll ? "搬到" : "放到"} ${tableName(table)}`,
        async () => restorePersons(before),
        async () => setLayout(await assignGroup(table.id, g.rsvp_id, opts)));
    } catch (e) {
      if (e.status === 409) {
        const free = freeSeats(table).length + (moveAll ? (table.assignments || []).filter((a) => a.rsvp_id === g.rsvp_id).length : 0);
        if (!free) return toastErr(new Error(`「${tableName(table)}」已經坐滿了`));
        const r = await Swal.fire({ icon: "question", title: `「${tableName(table)}」放不下整組`, text: `${e.message}。要先放 ${free} 位嗎？剩下的可以再放到別桌。`, showCancelButton: true, confirmButtonText: `先放 ${free} 位`, cancelButtonText: "取消", confirmButtonColor: "#B28F70" });
        if (r.isConfirmed) return groupToTable(g, table, moveAll, true);
        return;
      }
      toastErr(e);
    }
  };
  // 座位表裡把某人移到別桌（放進那桌第一個空位）或改成未安排
  const moveAssignment = async (a, target) => {
    if (target === "none") return unseat(a);
    const table = byIdRef.current[+target];
    if (!table) return;
    const free = freeSeats(table);
    if (!free.length) return toastErr(new Error(`「${tableName(table)}」已經坐滿了`));
    await place({ rsvp_id: a.rsvp_id, person_no: a.person_no, name: a.display_name }, table.id, free[0]);
  };
  // 同桌換座號（座位表裡上下拖）；換回來就是復原
  const swap = async (table, i, j) => {
    if (i === j) return;
    try {
      setLayout(await swapSeats(table.id, i, j));
      setSeatSel({ object_id: table.id, seat_index: j });
      recordSeat(`${tableName(table)} ${i + 1} 號與 ${j + 1} 號對調`, async () => setLayout(await swapSeats(table.id, i, j)), async () => setLayout(await swapSeats(table.id, i, j)));
    } catch (e) { toastErr(e); }
  };
  const unseat = async (a) => {
    const person = { rsvp_id: a.rsvp_id, person_no: a.person_no, name: a.display_name };
    const seat = { object_id: a.object_id, seat_index: a.seat_index };
    try {
      setLayout(await unassignSeat(a.id));
      dropPick(person);
      recordSeat(`已移除 ${a.display_name} 的座位`, async () => putBack(person, seat), async () => { const cur = seatOf(person); if (cur) setLayout(await unassignSeat(cur.id)); });
    } catch (e) { toastErr(e); }
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
    const items = seated.map((a) => ({ person: { rsvp_id: a.rsvp_id, person_no: a.person_no, name: a.display_name }, seat: { object_id: a.object_id, seat_index: a.seat_index } }));
    try {
      let l = null;
      for (const a of seated) l = await unassignSeat(a.id); // 依序呼叫，每次回傳整份版面
      if (l) setLayout(l);
      setPicked([]);
      recordSeat(`已移除 ${seated.length} 位的座位`,
        async () => { for (const it of items) await putBack(it.person, it.seat); },
        async () => { for (const it of items) { const cur = seatOf(it.person); if (cur) setLayout(await unassignSeat(cur.id)); } });
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
      if ((e.key === "Delete" || e.key === "Backspace") && picked.length && picked.some(findAssignment)) { e.preventDefault(); unseatPicked(); return; }
      if (e.key === "Escape") { setSelected(new Set()); setPicked([]); setSeatSel(null); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if (seatMode) return; // 排位模式沒有刪桌子、複製、方向鍵搬桌子這些
      if ((e.key === "Delete" || e.key === "Backspace") && selected.size) { e.preventDefault(); remove(selected); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") { e.preventDefault(); selectAll(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && selected.size) { e.preventDefault(); copySelected(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v" && clipboard.current.length) { e.preventDefault(); pasteObjects(clipboard.current); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d" && selected.size) { e.preventDefault(); duplicateSelected(); }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && selected.size) {
        e.preventDefault();
        const step = e.shiftKey ? GRID * 5 : GRID;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        const items = [...selected].map((id) => byId[id]).filter((o) => o && !o.meta?.locked);
        if (!items.length) return;
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
    // 還沒安排完的排前面，排好的沉下去，找下一組要排的不用捲
    return [...g].sort((a, b) => (b.unassigned > 0) - (a.unassigned > 0));
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
  // 搜尋有打字時，符合的人所在的那幾桌也把名字亮出來，不然只有選到的桌子看得到名字
  const searchTables = useMemo(() => new Set([...searchSeats].map((k) => +k.split(":")[0])), [searchSeats]);
  const highlightSeats = useMemo(() => {
    const set = new Set(searchSeats);
    if (seatSel) set.add(`${seatSel.object_id}:${seatSel.seat_index}`);
    return set;
  }, [searchSeats, seatSel]);

  if (err) return <ErrorBox error={err} />;
  if (!layout) return <Loading />;
  if (printMode) return <PrintView layout={layout} />;

  const s = layout.summary;
  const halls = layout.halls || [];
  const activeHall = halls.find((h) => h.is_active);
  // 預覽地圖要的「每個座位是誰」：從桌椅的座位指定組出來，順便帶電話讓找人可以打電話號碼
  const previewNames = {};
  if (mapPreviewOpen) {
    const phoneOf = Object.fromEntries((layout.guests || []).map((g) => [g.rsvp_id, g.phone || ""]));
    objects.forEach((o) => (o.assignments || []).forEach((a) => {
      (previewNames[String(o.id)] ||= {})[String(a.seat_index)] = { name: a.display_name, side: a.side, is_child: a.is_child, phone: phoneOf[a.rsvp_id] || "" };
    }));
  }
  const subTitle = fullscreen ? "" : readonly ? "唯讀：點桌子看這桌是誰，方便帶位" : seatMode ? "點一張桌子打開座位表；賓客卡片按「加入」或整組拖到桌上就入座。要擺桌子請切到「編輯場地」" : "拖曳擺桌椅、舞台、餐檯；排好再切回「安排座位」";

  return (
    <div className={`se-page${fullscreen ? " se-full" : ""}`}>
      {mapPreviewOpen&&<SeatViewer layout={layout} names={previewNames} preview fullscreen onClose={()=>setMapPreviewOpen(false)}/>}
      <PageHead title="座位圖" sub={subTitle}
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
      {!readonly && (
        <div className="se-toolbar">
          <span className="se-mode" role="group" aria-label="模式">
            <button type="button" className={seatMode ? "active" : ""} onClick={() => switchMode("seat")} title="排誰坐哪：桌子只能點，不會不小心拖走"><Armchair size={14} /> 安排座位</button>
            <button type="button" className={!seatMode ? "active" : ""} onClick={() => switchMode("edit")} title="擺桌子、舞台、餐檯，調整場地"><PencilRuler size={14} /> 編輯場地</button>
          </span>
          <span className="sep" />
          {!seatMode && (
            <>
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
            </>
          )}
          <button className="btn btn-ghost btn-sm" onClick={undo} disabled={!history.current.undo.length} data-hist={histVer} title={history.current.undo.length ? `復原 (Ctrl+Z)，還有 ${history.current.undo.length} 步` : "沒有可以復原的動作"}><Undo2 size={14} /></button>
          <button className="btn btn-ghost btn-sm" onClick={redo} disabled={!history.current.redo.length} title={history.current.redo.length ? `重做 (Ctrl+Shift+Z)，還有 ${history.current.redo.length} 步` : "沒有可以重做的動作"}><Redo2 size={14} /></button>
          <span className="sep" />
          {!seatMode && (
            <>
              <button className={`btn btn-sm ${marqueeMode ? "btn-primary" : "btn-ghost"}`} onClick={() => setMarqueeMode((m) => !m)} title="框選模式：在畫布上拖曳框住多個桌椅（平時按住 Shift 拖曳也可以）"><SquareDashedMousePointer size={14} /> 框選</button>
              <button className="btn btn-ghost btn-sm" onClick={selectAll} title="全選 (Ctrl+A)"><BoxSelect size={14} /> 全選</button>
              <button className="btn btn-ghost btn-sm" onClick={duplicateSelected} disabled={!selected.size} title="複製選取的桌椅 (Ctrl+D；也可 Ctrl+C / Ctrl+V)"><Copy size={14} /> 複製{selected.size > 1 ? ` ${selected.size} 個` : ""}</button>
              {selected.size >= 2 && (
                <>
                  <span className="sep" />
                  <span className="se-align" role="group" aria-label="對齊選取的物件">
                    <button className="btn btn-ghost btn-sm" title="靠左對齊" onClick={() => alignSelected("left")}><AlignStartVertical size={14} /></button>
                    <button className="btn btn-ghost btn-sm" title="水平置中" onClick={() => alignSelected("hcenter")}><AlignCenterVertical size={14} /></button>
                    <button className="btn btn-ghost btn-sm" title="靠右對齊" onClick={() => alignSelected("right")}><AlignEndVertical size={14} /></button>
                    <button className="btn btn-ghost btn-sm" title="靠上對齊" onClick={() => alignSelected("top")}><AlignStartHorizontal size={14} /></button>
                    <button className="btn btn-ghost btn-sm" title="垂直置中" onClick={() => alignSelected("vcenter")}><AlignCenterHorizontal size={14} /></button>
                    <button className="btn btn-ghost btn-sm" title="靠下對齊" onClick={() => alignSelected("bottom")}><AlignEndHorizontal size={14} /></button>
                    {selected.size >= 3 && <button className="btn btn-ghost btn-sm" title="左右等距" onClick={() => alignSelected("hspread")}><AlignHorizontalDistributeCenter size={14} /></button>}
                    {selected.size >= 3 && <button className="btn btn-ghost btn-sm" title="上下等距" onClick={() => alignSelected("vspread")}><AlignVerticalDistributeCenter size={14} /></button>}
                  </span>
                </>
              )}
              {selected.size >= 1 && <button className="btn btn-ghost btn-sm" title="把選取的物件貼到格線上（座標湊成 10 的倍數）" onClick={snapSelected}><Grid3x3 size={14} /> 貼齊格線</button>}
              <span className="sep" />
            </>
          )}
          {seatMode && <button className="btn btn-primary btn-sm" onClick={() => setAutoModal(true)} title="把還沒有位子的人自動填進空位"><Wand2 size={14} /> 一鍵安排</button>}
          {hint && <span className="se-hint">{hint.text}{hint.undo && <button type="button" className="se-hint-undo" onClick={hint.undo}>復原</button>}</span>}
          <span className="sep" />
          <button className="btn btn-ghost btn-sm" onClick={() => zoomAt(1 / 1.25)}><ZoomOut size={14} /></button>
          <span className="muted-cell" style={{ fontSize: 12, minWidth: 40, textAlign: "center" }}>{Math.round(view.zoom * 100)}%</span>
          <button className="btn btn-ghost btn-sm" onClick={() => zoomAt(1.25)}><ZoomIn size={14} /></button>
          <button className="btn btn-ghost btn-sm" onClick={fitAll}><Maximize2 size={14} /> 全部</button>
          <span className="sep" />
          {!seatMode && <Checkbox checked={grid} onChange={setGrid}><Grid3x3 size={13} style={{ verticalAlign: -2 }} /> 對齊格線</Checkbox>}
          {seatMode && <Checkbox checked={showNames} onChange={setShowNames}><Tag size={13} style={{ verticalAlign: -2 }} /> 顯示全部名字</Checkbox>}
          {hall?.has_bg && <Checkbox checked={showBg} onChange={setShowBg}><ImageIcon size={13} style={{ verticalAlign: -2 }} /> 顯示底圖</Checkbox>}
          {seatMode && (
            <>
              <span className="sep" />
              <button className="btn btn-ghost btn-sm" onClick={clearEverything}><Eraser size={14} /> 清空座位</button>
            </>
          )}
        </div>
      )}

      <div className="se-shell">
        <div className={`se-canvas${seatMode ? " se-canvas-seat" : ""}`} ref={containerRef}>
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
              {grid && !seatMode && <rect x="0" y="0" width={layout.canvas.w} height={layout.canvas.h} fill="url(#se-grid)" style={{ pointerEvents: "none" }} />}
              {objects.map((o) => (
                <g key={o.id} onPointerDown={(e) => onObjPointerDown(e, o)} style={{ cursor: seatMode ? (isTable(o) ? "pointer" : "default") : "move" }}>
                  <ObjectShape o={o} selected={selected.has(o.id)} showNames={showNames || selected.has(o.id) || searchTables.has(o.id) || [...pickedSeats].some((k) => k.startsWith(`${o.id}:`))} interactive labelPlan={labelPlan}
                    highlightSeats={highlightSeats} pickedSeats={pickedSeats} capacity={seatMode} dropTarget={dropTarget === o.id}
                    onSeatPointerDown={onSeatPointerDown} onSeatPointerUp={onSeatPointerUp} />
                </g>
              ))}
              {!seatMode && selectedObj && !selectedObj.meta?.locked && <Handles o={selectedObj} zoom={view.zoom} onPointerDown={onHandlePointerDown} />}
              {marquee && marquee.w > 0 && (
                <rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} className="se-marquee" strokeWidth={1.5 / view.zoom} strokeDasharray={`${6 / view.zoom} ${4 / view.zoom}`} />
              )}
            </g>
          </svg>
          {dragChip && <div className="se-dragchip" style={{ left: dragChip.x, top: dragChip.y }}>{dragChip.name}</div>}
        </div>

        {seatMode ? (
          <aside className="se-panel se-panel-seat">
            {selectedTable && (
              <TablePanel o={selectedTable} seatSel={seatSel && seatSel.object_id === selectedTable.id ? seatSel : null} readonly={readonly} picked={picked} tables={tables}
                onClose={() => { setSelected(new Set()); setSeatSel(null); }}
                onPickSeat={(i) => setSeatSel((cur) => (cur && cur.object_id === selectedTable.id && cur.seat_index === i ? null : { object_id: selectedTable.id, seat_index: i }))}
                onPlacePicked={(i) => picked.length && place(picked[0], selectedTable.id, i)}
                onUnseat={unseat} onRename={rename} onMove={moveAssignment} onSwap={(i, j) => swap(selectedTable, i, j)}
                onPreview={(a) => setPreview({ rsvp_id: a.rsvp_id, name: a.display_name })}
                onClear={() => clearTable(selectedTable)} />
            )}
            <div className="se-panel-body">
              <GuestPanel guests={guests} search={search} setSearch={setSearch} sideFilter={sideFilter} setSideFilter={setSideFilter} onlyUnassigned={onlyUnassigned} setOnlyUnassigned={setOnlyUnassigned}
                picked={picked} readonly={readonly} table={selectedTable} byId={byId} onSeatedClick={seatedClick}
                onPersonPointerDown={onPersonPointerDown} onPersonPointerMove={onPointerMove} onPersonPointerUp={onPointerUp}
                onGroupPointerDown={onGroupPointerDown}
                onAddGroup={(g) => groupToTable(g, selectedTable)} onMoveGroup={(g) => groupToTable(g, selectedTable, true)}
                onPreview={(g) => setPreview({ rsvp_id: g.rsvp_id, name: g.name })} />
            </div>
          </aside>
        ) : (
          <aside className="se-panel">
            <div className="se-tabs"><button className="active" type="button">{selectedObj ? (selectedObj.label || KIND_LABEL[selectedObj.kind]) : "物件"}</button></div>
            <div className="se-panel-body">
              <ObjectPanel o={selectedObj} selectedCount={selected.size}
                onChange={(patch) => selectedObj && saveObject(selectedObj.id, patch)}
                onImmediate={(patch) => selectedObj && saveObject(selectedObj.id, patch, true)}
                onDuplicate={() => (selectedObj ? duplicate(selectedObj) : duplicateSelected())}
                onDelete={() => remove(selected)}
                onClear={() => selectedObj && clearTable(selectedObj)} />
            </div>
          </aside>
        )}
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

/* ---------- 右側（排位模式）：賓客卡片，一組一張；按「加入」或整組拖到桌上 ---------- */
function GuestPanel({ guests, search, setSearch, sideFilter, setSideFilter, onlyUnassigned, setOnlyUnassigned, picked, readonly, table, byId, onSeatedClick, onPersonPointerDown, onPersonPointerMove, onPersonPointerUp, onGroupPointerDown, onAddGroup, onMoveGroup, onPreview }) {
  const where = (p) => (p.seat ? `${p.seat.label || KIND_LABEL[byId[p.seat.object_id]?.kind] || "桌"} · ${p.seat.seat_index + 1} 號` : "未安排");
  const tname = table ? tableName(table) : "";
  const free = table ? freeSeats(table).length : 0;
  return (
    <div>
      <input type="text" placeholder="搜尋姓名…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 8 }} />
      <div style={{ marginBottom: 8 }}><Select compact aria-label="篩選親友方" value={sideFilter} onChange={setSideFilter} options={[{ value: "", label: "全部親友" }, { value: "groom", label: "男方親友" }, { value: "bride", label: "女方親友" }]} /></div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <Checkbox checked={onlyUnassigned} onChange={setOnlyUnassigned}>只看未安排</Checkbox>
        <span className="muted-cell" style={{ fontSize: 12 }}>{guests.length} 組</span>
      </div>
      {!readonly && (
        <div className="helper-text" style={{ marginBottom: 8 }}>
          {table
            ? <>已選「{tname}」，還有 {free} 個空位。按卡片上的「加入 {tname}」整組入座；也可以點人（可多選）再點桌子。</>
            : <>先在平面圖上點一張桌子，卡片上就會出現「加入」按鈕；或直接把卡片的標題列拖到桌子上。</>}
        </div>
      )}
      {guests.length === 0 && <div className="empty-state" style={{ padding: 20 }}>沒有符合的賓客</div>}
      {guests.map((g) => {
        const allHere = table && g.unassigned === 0 && g.persons.every((p) => p.seat && p.seat.object_id === table.id);
        return (
          <div className={`se-group${g.unassigned ? "" : " done"}`} key={g.rsvp_id}>
            <div className={`se-group-head${readonly ? "" : " draggable"}`} title={readonly ? undefined : "按住這一列拖到平面圖的桌子上，整組入座"}
              onPointerDown={(e) => onGroupPointerDown(e, g)} onPointerMove={onPersonPointerMove} onPointerUp={onPersonPointerUp} onPointerCancel={onPersonPointerUp}>
              <span className="se-group-name">{!readonly && <GripVertical size={13} className="se-grip" />}{g.name} <span className={`pill ${g.side === "bride" ? "pill-bride" : "pill-groom"}`}>{SIDE_LABEL[g.side] || g.side}</span></span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span className={`muted-cell${g.unassigned ? "" : " se-group-ok"}`} style={{ fontWeight: 400, fontSize: 12 }}>{g.persons.length - g.unassigned}/{g.persons.length}</span>
                <button type="button" className="btn btn-ghost btn-sm" title="看他在 /seat 查到的畫面" onPointerDown={(e) => e.stopPropagation()} onClick={() => onPreview(g)}><Eye size={13} /></button>
              </span>
            </div>
            {g.persons.map((p) => {
              const isPicked = picked.some((x) => x.rsvp_id === g.rsvp_id && x.person_no === p.person_no);
              return (
                <div key={p.person_no} className={`se-person${p.seat ? " seated" : ""}${isPicked ? " picked" : ""}`}
                  onPointerDown={(e) => onPersonPointerDown(e, { rsvp_id: g.rsvp_id, person_no: p.person_no, name: p.name, seat: p.seat })}
                  onClick={() => p.seat && onSeatedClick && onSeatedClick(g, p)} title={!readonly ? "點一下選取（可多選），再點桌子或椅子放入；也可以直接拖到桌子上" : undefined}
                  onPointerMove={onPersonPointerMove} onPointerUp={onPersonPointerUp} onPointerCancel={onPersonPointerUp}>
                  <span>{p.is_child ? "👶 " : ""}{p.name}</span>
                  <span className="where">{where(p)}</span>
                </div>
              );
            })}
            {!readonly && table && g.unassigned > 0 && (
              <button className="btn btn-primary btn-sm se-group-add" onClick={() => onAddGroup(g)} disabled={!free} title={free ? undefined : "這桌沒有空位了"}>
                <Plus size={13} /> 加入 {tname}（{g.unassigned} 位）
              </button>
            )}
            {!readonly && table && g.unassigned === 0 && !allHere && (() => {
              // 整組搬過來時，這組原本在這桌佔的位子也會讓出來，所以空位要加回去
              const room = free + g.persons.filter((p) => p.seat && p.seat.object_id === table.id).length;
              const fits = room >= g.persons.length;
              return (
                <button className="btn btn-ghost btn-sm se-group-add" onClick={() => onMoveGroup(g)} disabled={!fits} title={fits ? "這組現在坐的位子會讓出來，整組搬到選到的桌子" : `${tname} 只剩 ${room} 位，放不下整組 ${g.persons.length} 位`}>
                  整組搬到 {tname}（{g.persons.length} 位）
                </button>
              );
            })()}
            {!readonly && allHere && <div className="se-group-note">全組都在 {tname}</div>}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- 右側（排位模式）：這桌的座位表。點一列展開動作；抓左邊的把手上下拖可以換座號 ---------- */
function TablePanel({ o, seatSel, readonly, picked, tables, onClose, onPickSeat, onPlacePicked, onUnseat, onRename, onMove, onSwap, onPreview, onClear }) {
  const names = Object.fromEntries((o.assignments || []).map((a) => [a.seat_index, a]));
  const taken = (o.assignments || []).length;
  const [dragRow, setDragRow] = useState(null); // {from, over}
  const listRef = useRef(null);
  // 換座號用的拖曳：pointer 事件自己做，手機也能用
  const rowUnder = (clientX, clientY) => {
    const el = document.elementFromPoint(clientX, clientY);
    const li = el && el.closest ? el.closest("[data-row]") : null;
    return li && listRef.current && listRef.current.contains(li) ? +li.dataset.row : null;
  };
  const onGripDown = (e, i) => {
    if (readonly || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragRow({ from: i, over: i, sy: e.clientY, moved: false });
  };
  const onGripMove = (e) => {
    setDragRow((d) => {
      if (!d) return d;
      const moved = d.moved || Math.abs(e.clientY - d.sy) > 6;
      const over = moved ? rowUnder(e.clientX, e.clientY) : d.over;
      return { ...d, moved, over: over ?? d.over };
    });
  };
  const onGripUp = () => {
    setDragRow((d) => {
      if (d && d.moved && d.over !== null && d.over !== d.from) onSwap(d.from, d.over);
      return null;
    });
  };
  // 「移到…」的選項：其他還有空位的桌子，加上「未安排」
  const moveOptions = [{ value: "", label: "移到…" }, ...tables.filter((t) => t.id !== o.id).map((t) => { const f = freeSeats(t).length; return { value: String(t.id), label: f ? `${tableName(t)}（剩 ${f}）` : `${tableName(t)}（滿）`, disabled: !f }; }), { value: "none", label: "改為未安排" }];
  return (
    <div className="se-tablepanel">
      <div className="se-tablepanel-head">
        <span><strong>{tableName(o)}</strong> <span className={`pill ${taken >= o.seats ? "pill-yes" : "pill-warn"}`}>{taken}/{o.seats} 位</span></span>
        <span style={{ display: "inline-flex", gap: 4 }}>
          {!readonly && taken > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={onClear} title="這桌的人全部改為未安排"><Eraser size={13} /> 清空</button>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} title="關閉座位表"><X size={14} /></button>
        </span>
      </div>
      {!readonly && <div className="helper-text se-tablepanel-hint">點一列可以移到別桌、改名或移除；抓住 <GripVertical size={11} style={{ verticalAlign: -1 }} /> 上下拖可以換座號。</div>}
      <ul className="se-trows" ref={listRef}>
        {Array.from({ length: o.seats }, (_, i) => {
          const a = names[i];
          const cur = seatSel && seatSel.seat_index === i;
          const cls = ["se-trow", cur ? "cur" : "", a ? `taken side-${a.side || "none"}` : "empty", dragRow && dragRow.from === i ? "dragging" : "", dragRow && dragRow.moved && dragRow.over === i && dragRow.from !== i ? "over" : ""].filter(Boolean).join(" ");
          return (
            <li key={i} data-row={i} className={cls} onClick={() => onPickSeat(i)}>
              <div className="se-trow-main">
                {!readonly && a
                  ? <span className="se-grip se-grip-row" title="按住上下拖，換座號" onPointerDown={(e) => onGripDown(e, i)} onPointerMove={onGripMove} onPointerUp={onGripUp} onPointerCancel={onGripUp}><GripVertical size={14} /></span>
                  : <span className="se-grip se-grip-row" style={{ visibility: "hidden" }}><GripVertical size={14} /></span>}
                <span className="se-trow-no">{i + 1}</span>
                {a
                  ? <span className="se-trow-name"><span className={`se-dot side-${a.side || "none"}`} />{a.is_child ? "👶 " : ""}{a.display_name}</span>
                  : <span className="se-trow-name empty">空位</span>}
                {!readonly && !a && picked.length > 0 && (
                  <button type="button" className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); onPlacePicked(i); }}><Plus size={12} /> 放 {picked[0].name}</button>
                )}
                {readonly && a && <button type="button" className="btn btn-ghost btn-sm" title="看他在 /seat 查到的畫面" onClick={(e) => { e.stopPropagation(); onPreview(a); }}><Eye size={12} /></button>}
              </div>
              {!readonly && cur && a && (
                <div className="se-trow-actions" onClick={(e) => e.stopPropagation()}>
                  <Select compact aria-label="移到別桌" value="" onChange={(v) => v && onMove(a, v)} options={moveOptions} />
                  <button type="button" className="btn btn-ghost btn-sm" title="看他在 /seat 查到的畫面" onClick={() => onPreview(a)}><Eye size={12} /> 預覽</button>
                  <button type="button" className="btn btn-ghost btn-sm" title="改顯示名稱" onClick={() => onRename(a)}>改名</button>
                  <button type="button" className="btn btn-ghost btn-sm se-danger" title="這個位子改為空位，他變成未安排" onClick={() => onUnseat(a)}><Minus size={12} /> 移除</button>
                </div>
              )}
              {!readonly && cur && !a && !picked.length && (
                <div className="se-trow-actions helper-text" onClick={(e) => e.stopPropagation()}>從下面的名單點人，再按這裡的「放」；或直接拖人到這桌。</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------- 右側（編輯場地）：物件屬性 ---------- */
function ObjectPanel({ o, selectedCount, onChange, onImmediate, onDuplicate, onDelete, onClear }) {
  if (!o) {
    if (selectedCount > 1) {
      return (
        <div className="empty-state" style={{ padding: 20 }}>
          <div>已選取 {selectedCount} 個物件，可以一起拖曳、方向鍵微調；工具列有靠左／靠上／置中／等距的對齊按鈕</div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12, flexWrap: "wrap" }}>
            <button className="btn btn-primary btn-sm" onClick={onDuplicate}><Copy size={13} /> 複製這 {selectedCount} 個</button>
            <button className="btn btn-ghost btn-sm" onClick={onDelete} style={{ color: "var(--rose-accent)" }}><Trash2 size={13} /> 刪除</button>
          </div>
          <div className="helper-text" style={{ marginTop: 10 }}>複製出來的桌名會自動接號，例如桌 1～4 會變成桌 5～8</div>
        </div>
      );
    }
    return <div className="empty-state" style={{ padding: 20 }}>在畫布上點一個物件；按住 Shift 點選或用「框選」可以一次選多個。排誰坐哪請切到「安排座位」</div>;
  }
  const table = o.kind === "round" || o.kind === "rect";
  const sides = o.kind === "rect" ? sidesOf(o) : null;
  const setSide = (k, v) => {
    const next = { ...sides, [k]: toInt(v) };
    onChange({ meta: { ...o.meta, sides: next }, seats: next.top + next.bottom + next.left + next.right });
  };
  const locked = !!o.meta?.locked;
  return (
    <div>
      <div className="pl-list-sub" style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
        {KIND_LABEL[o.kind]}
        {locked
          ? <span className="pill pill-groom" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Lock size={11} /> 固定物件，不能移動</span>
          : o.meta?.fixture ? <span className="pill pill-warn" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><LockOpen size={11} /> 已解除鎖定</span> : null}
      </div>
      {locked && (
        <div className="helper-text" style={{ marginBottom: 10 }}>
          這是飯店平面圖上的牆、柱、洗手間或門，照圖寫死，拖不動也不能刪。真的要調整可以
          <button type="button" className="pl-linkbtn" style={{ display: "inline", padding: 0, marginLeft: 4 }} onClick={() => onImmediate({ meta: { ...o.meta, locked: false } })}>解除鎖定</button>。
        </div>
      )}
      {!locked && o.meta?.fixture && (
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }} onClick={() => onImmediate({ meta: { ...o.meta, locked: true } })}><Lock size={13} /> 重新鎖定</button>
      )}
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
        {table && <button className="btn btn-ghost btn-sm" onClick={onClear}><Eraser size={13} /> 清空座位</button>}
        <button className="btn btn-ghost btn-sm" onClick={onDelete} style={{ color: "var(--rose-accent)" }}><Trash2 size={13} /> 刪除</button>
      </div>
      {(table || o.kind === "chair") && (o.assignments || []).length > 0 && (
        <div className="helper-text">這桌坐了 {(o.assignments || []).length} 位；要調整誰坐哪請切到「安排座位」再點這桌。</div>
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
  // 可載入的飯店平面圖範本（萬福廳、2 樓大宴會廳…）由後端提供
  const { data: presets } = useLoader(fetchSeatPresets, []);
  const presetName = (key) => (presets || []).find((p) => p.key === key)?.name || "範本";
  const loadPreset = async (p) => {
    const r = await Swal.fire({ icon: "info", title: `載入飯店提供的「${p.name}」平面圖？`, html: `會新增一個叫「${p.name}」的廳，照飯店的圖擺好${p.summary}，並把原圖放在底下當底圖。<br>現在這一廳不會被動到，之後可以隨時切換。`, showCancelButton: true, confirmButtonText: "載入", cancelButtonText: "取消", confirmButtonColor: "#B28F70" });
    if (!r.isConfirmed) return;
    const l = await run(() => createSeatHallFromPreset(p.key), `已載入${p.name}`);
    if (l) onClose();
  };
  const resetFixtures = async () => {
    const r = await Swal.fire({ icon: "question", title: `把「${presetName(hall.preset_key)}」平面圖的固定物件放回這一廳？`, html: "會依飯店平面圖放回牆、柱、洗手間、投影布幕等固定物件，並全部鎖定（不能拖、不能刪）。<br>這一廳裡舊的牆、柱與同名的固定區域會先清掉再放；桌子、舞台、餐檯、入口與座位安排都不會動。", showCancelButton: true, confirmButtonText: "放回並鎖定", cancelButtonText: "取消", confirmButtonColor: "#B28F70" });
    if (!r.isConfirmed) return;
    const l = await run(() => resetSeatHallFixtures(hall.id, hall.preset_key), "固定物件已放回並鎖定");
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
        {(presets || []).map((p) => <button type="button" key={p.key} className="btn btn-ghost btn-sm" disabled={busy} onClick={() => loadPreset(p)}><Building2 size={13} /> 載入飯店提供的「{p.name}」平面圖</button>)}
        {hall.preset_key && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={resetFixtures} title="依飯店平面圖放回牆、柱、洗手間等固定物件並鎖定；桌子與座位不動"><Lock size={13} /> 放回{presetName(hall.preset_key)}的固定物件並鎖定</button>}
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
