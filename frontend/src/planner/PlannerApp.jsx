// 籌備後台：單一 React 應用，網址 /planner/...
import { useEffect, useState } from "react";
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import {
  Users, Wallet, CalendarDays, FolderOpen,
  Settings as SettingsIcon, LogOut, Lock, LogIn, Home as HomeIcon, Armchair, Images, Gift, NotebookPen, PartyPopper, Camera, Monitor, ExternalLink, MessageSquareHeart, LayoutGrid,
  ChevronDown, ClipboardList, Sparkles, UtensilsCrossed, Smartphone,
} from "lucide-react";
import { adminLogin, clearStash, clearToken, getRole, getStashedCouple, getToken, restoreCouple, setRole, setToken, stashCouple, switchRole, fetchMe } from "../api.js";
import { toastErr } from "./ui.jsx";
import Guests from "./Guests.jsx";
import Budget from "./Budget.jsx";
import Timeline from "./Timeline.jsx";
import Files from "./Files.jsx";
import SettingsPage from "./Settings.jsx";
import Seating from "./Seating.jsx";
import Photos from "./Photos.jsx";
import GuestPhotos from "./GuestPhotos.jsx";
import Wall from "./Wall.jsx";
import WallPlates from "./WallPlates.jsx";
import WallRemote from "./WallRemote.jsx";
import Gifts from "./Gifts.jsx";
import Memos from "./Memos.jsx";
import Program from "./Program.jsx";
import GameEdit from "./GameEdit.jsx";

import { PlannerContext } from "./context.js";
import { Loading } from "./ui.jsx";

// 2026-09-08 依新人要求移除「廠商」與「比價」頁；2026-09-10 其他頁的廠商欄位也一併移除（後端資料與 API 保留）
// 2026-09-27 每一頁對應一把鑰匙（perm）；角色能用哪些鑰匙由設定頁的權限表決定
// 2026-09-29 新人要求：同主題的頁面放同一個板塊、摺疊式子選單（行事曆跟筆記放一起）。
// group 對應 NAV_GROUPS 的 key；沒有 group 的（婚紗照、設定）單獨一列。網址與權限都沒變。
const NAV_GROUPS = [
  { key: "guests", label: "賓客", icon: Users },
  { key: "prep", label: "籌備", icon: ClipboardList },
  { key: "day", label: "婚禮當天", icon: Sparkles },
];
const NAV_OPEN_KEY = "wedding_planner_nav_open"; // 記住哪幾組是展開的（只存在這台瀏覽器）

const NAV = [
  // 2026-09-29 新人要求：第一項叫「名單」，菜單獨立成子選單一項（同一頁的兩個分頁，用 ?tab=menu 區分）
  { to: "/guests", label: "名單", icon: Users, perm: ["guests_view"], group: "guests", exclude: "tab=menu" },
  { to: "/guests", search: "?tab=menu", label: "菜單", icon: UtensilsCrossed, perm: ["menu"], group: "guests" }, // 2026-09-29 依新人要求改名，裡面分賓客名單／菜單 // 2026-09-08 依新人要求改名為「賓客名單」
  { to: "/seating", label: "座位圖", icon: Armchair, perm: ["seating_view", "seating_edit"], group: "guests" },
  { to: "/gifts", label: "喜餅", icon: Gift, perm: ["gifts_view"], group: "guests" },
  { to: "/budget", label: "花費", icon: Wallet, perm: ["budget"], group: "prep" }, // 2026-09-08 依新人要求移除「預算」概念，只記實際金額
  { to: "/timeline", label: "行事曆", icon: CalendarDays, perm: ["calendar"], group: "prep" }, // 2026-09-10 原「籌備進度」改為月曆
  { to: "/memos", label: "筆記", icon: NotebookPen, perm: ["notes"], group: "prep" }, // 2026-09-10 原「備忘」改為筆記：標題、內容、主題、已處理、釘選
  { to: "/files", label: "文件庫", icon: FolderOpen, perm: ["files"], group: "prep" },
  { to: "/program", label: "活動環節", icon: PartyPopper, perm: ["program"], group: "day" }, // 2026-09-09 婚禮當天流程與點子，只在後台
  { to: "/wall", label: "現場留言", icon: MessageSquareHeart, perm: ["wall"], group: "day" }, // 2026-09-28 賓客在 /wish 留言、會場大螢幕、歌單
  { to: "/wall-plates", label: "大螢幕版面", icon: LayoutGrid, perm: ["wall"], group: "day" }, // 2026-09-28 所有版面的縮圖、預覽、開關、換版面節奏
  { to: "/wall-remote", label: "大螢幕遙控", icon: Smartphone, perm: ["wall"], group: "day" }, // 2026-09-30 幫手用手機切歌、插播、講話模式
  { to: "/day-photos", label: "當天照片", icon: Camera, perm: ["guest_photos"], group: "day" }, // 2026-09-27 賓客上傳的原檔
  { to: "/photos", label: "婚紗照", icon: Images, perm: ["photos"] }, // 2026-09-28 新人要求改名
  { to: "/settings", label: "設定", icon: SettingsIcon, perm: ["settings"] },
];

export default function PlannerApp() {
  const [authed, setAuthed] = useState(!!getToken());
  const [role, setRoleState] = useState(getRole());
  const [perms, setPerms] = useState(null); // null = 還沒載入

  const logout = () => {
    clearToken();
    clearStash(); // 真的登出：連收在旁邊的新人 token 一起清掉
    setAuthed(false);
    setPerms(null);
  };
  // 登入後向後端問「我能用什麼」；token 失效會被 request 清掉，這時回登入頁
  useEffect(() => {
    if (!authed) return;
    let alive = true;
    fetchMe().then((m) => { if (alive) { setRoleState(m.role); setPerms(new Set(m.permissions)); } }).catch(() => { if (alive) { if (!getToken()) setAuthed(false); else setPerms(new Set()); } });
    return () => { alive = false; };
  }, [authed]);
  const can = (...keys) => !!perms && keys.some((k) => perms.has(k));

  if (!authed) {
    return (
      <LoginGate
        onOk={(r) => {
          setRoleState(r);
          setAuthed(true);
        }}
      />
    );
  }

  if (!perms) return <div className="pl-shell"><main className="pl-main"><Loading /></main></div>;
  // 2026-09-28 總覽頁拿掉：登入後預設進設定（沒有設定權限的幫手就進第一個能用的頁）
  const home = can("settings") ? "/settings" : (NAV.find((n) => can(...n.perm))?.to || "/guests");

  return (
    <PlannerContext.Provider value={{ role, perms, can, logout }}>
      <BrowserRouter basename="/planner" future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Shell role={role} can={can} onLogout={logout}>
          <Routes>
            <Route path="/guests" element={<Allowed ok={can("guests_view")} home={home}><Guests /></Allowed>} />
            <Route path="/seating" element={<Allowed ok={can("seating_view", "seating_edit")} home={home}><Seating /></Allowed>} />
            <Route path="/gifts" element={<Allowed ok={can("gifts_view")} home={home}><Gifts /></Allowed>} />
            <Route path="/budget" element={<Allowed ok={can("budget")} home={home}><Budget /></Allowed>} />
            <Route path="/timeline" element={<Allowed ok={can("calendar")} home={home}><Timeline /></Allowed>} />
            <Route path="/memos" element={<Allowed ok={can("notes")} home={home}><Memos /></Allowed>} />
            <Route path="/program" element={<Allowed ok={can("program")} home={home}><Program /></Allowed>} />
            <Route path="/program/games/new" element={<Allowed ok={can("program")} home={home}><GameEdit /></Allowed>} />
            <Route path="/program/games/:id" element={<Allowed ok={can("program")} home={home}><GameEdit /></Allowed>} />
            <Route path="/files" element={<Allowed ok={can("files")} home={home}><Files /></Allowed>} />
            <Route path="/photos" element={<Allowed ok={can("photos")} home={home}><Photos /></Allowed>} />
            <Route path="/day-photos" element={<Allowed ok={can("guest_photos")} home={home}><GuestPhotos /></Allowed>} />
            <Route path="/wall" element={<Allowed ok={can("wall")} home={home}><Wall /></Allowed>} />
            <Route path="/wall-plates" element={<Allowed ok={can("wall")} home={home}><WallPlates /></Allowed>} />
            <Route path="/wall-remote" element={<Allowed ok={can("wall")} home={home}><WallRemote /></Allowed>} />
            <Route path="/settings" element={<Allowed ok={can("settings")} home={home}><SettingsPage /></Allowed>} />
            <Route path="*" element={<Navigate to={home} replace />} />
          </Routes>
        </Shell>
      </BrowserRouter>
    </PlannerContext.Provider>
  );
}

// 沒有這把鑰匙就導回第一個能用的頁
function Allowed({ ok, home, children }) {
  if (!ok) return <Navigate to={home} replace />;
  return children;
}

function Shell({ role, can, onLogout, children }) {
  const location = useLocation();
  const items = NAV.filter((n) => can(...n.perm));
  // 哪幾組展開：先讀上次記的，目前所在頁的那一組一定打開
  const activeGroup = items.find((n) => location.pathname === n.to || location.pathname.startsWith(n.to + "/"))?.group;
  const [open, setOpen] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem(NAV_OPEN_KEY) || "{}"); return saved && typeof saved === "object" ? saved : {}; } catch { return {}; }
  });
  useEffect(() => { if (activeGroup && !open[activeGroup]) setOpen((o) => ({ ...o, [activeGroup]: true })); }, [activeGroup]);
  const toggle = (key) => setOpen((o) => {
    const next = { ...o, [key]: !o[key] };
    try { localStorage.setItem(NAV_OPEN_KEY, JSON.stringify(next)); } catch { /* 存不了就只記在這次 */ }
    return next;
  });
  // 依 NAV 順序輸出：遇到某組的第一個項目就把整組（可見的）一起畫出來；沒有權限的組整組不出現
  // 同一頁的分頁（名單／菜單）靠網址的 ?tab 分辨誰亮：有 search 的要 search 相符，有 exclude 的則 search 不能含它
  const isOn = ({ to, search, exclude }) => {
    const onPath = location.pathname === to || location.pathname.startsWith(to + "/");
    if (!onPath) return false;
    if (search) return location.search.includes(search.slice(1));
    if (exclude) return !location.search.includes(exclude);
    return true;
  };
  const renderLink = (n) => {
    const { to, search, label, icon: Icon } = n;
    return [
    <NavLink key={to + (search || "")} to={to + (search || "")} className={() => (isOn(n) ? "active" : undefined)}>
      <Icon size={16} /> {label}
    </NavLink>,
    // 2026-09-28 新人要求：任何一頁都能直接開大螢幕（/wall 是獨立頁面，用新分頁開，後台照樣留著）；放在「現場留言」正下方
    to === "/wall" && (
      <a key="wall-screen" href="/wall" target="_blank" rel="noopener" className="pl-nav-ext">
        <Monitor size={16} /> 大螢幕 <ExternalLink size={12} />
      </a>
    ),
  ]; };
  const rendered = new Set();
  const nav = items.flatMap((n) => {
    if (!n.group) return renderLink(n);
    if (rendered.has(n.group)) return [];
    rendered.add(n.group);
    const g = NAV_GROUPS.find((x) => x.key === n.group);
    const GIcon = g.icon;
    const isOpen = !!open[n.group];
    const list = items.filter((x) => x.group === n.group);
    return (
      <div key={`g-${n.group}`} className={`pl-nav-group${isOpen ? " open" : ""}${activeGroup === n.group ? " current" : ""}`}>
        <button type="button" className="pl-nav-group-head" aria-expanded={isOpen} onClick={() => toggle(n.group)}>
          <GIcon size={16} /> {g.label} <ChevronDown size={14} className="pl-nav-chev" />
        </button>
        <div className="pl-nav-group-items">{list.flatMap(renderLink)}</div>
      </div>
    );
  });
  return (
    <div className="pl-shell">
      <aside className="pl-side">
        <div className="pl-brand">
          <div className="pl-brand-script">Alan &amp; Omena</div>
          <div className="pl-brand-title">婚禮籌備後台</div>
          <div className="pl-brand-role">{role === "helper" ? "幫手模式" : "新人模式"}</div>
          <ModeSwitch role={role} />
        </div>
        <nav className="pl-nav">{nav}</nav>
        <div className="pl-side-foot">
          <a className="top-link" href="/"><HomeIcon size={14} /> 回賓客首頁</a>
          <button className="btn btn-ghost btn-sm" onClick={onLogout}><LogOut size={14} /> 登出</button>
        </div>
      </aside>
      <main className="pl-main">{children}</main>
    </div>
  );
}

// 2026-09-29 新人要求：一鍵切換 新人／幫手／賓客 視角。
// 新人切到幫手：跟後端換一把幫手 token（新人 token 收在旁邊）；切到賓客：暫時登出，賓客頁上方會有「回到後台」；
// 切回新人：把收在旁邊的 token 放回來，不用重打密碼。幫手密碼登入的人看不到這個切換（沒有新人 token 可以回）。
function ModeSwitch({ role }) {
  const [busy, setBusy] = useState(false);
  if (role !== "couple" && !getStashedCouple()) return null;
  const go = async (target) => {
    if (busy) return;
    setBusy(true);
    try {
      if (target === "couple") {
        if (!restoreCouple()) return;
      } else if (target === "helper") {
        if (role === "helper") return;
        const { token } = await switchRole("helper");
        stashCouple();
        setToken(token); setRole("helper");
      } else {
        stashCouple();
        localStorage.removeItem("wedding_admin_token"); localStorage.removeItem("wedding_admin_role");
        window.location.href = "/";
        return;
      }
      window.location.reload();
    } catch (e) { toastErr(e); setBusy(false); }
  };
  return (
    <div className="pl-mode-switch" role="group" aria-label="切換視角">
      <button type="button" className={role === "couple" ? "on" : undefined} disabled={busy} onClick={() => go("couple")}>新人</button>
      <button type="button" className={role === "helper" ? "on" : undefined} disabled={busy} onClick={() => go("helper")}>幫手</button>
      <button type="button" disabled={busy} onClick={() => go("guest")}>賓客</button>
    </div>
  );
}

/* ---------- 登入 ---------- */
function LoginGate({ onOk }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!pw) return;
    setErr("");
    setBusy(true);
    try {
      const { token, role } = await adminLogin(pw);
      setToken(token);
      setRole(role || "couple");
      onOk(role || "couple");
    } catch (e) {
      setErr(e.message || "登入失敗");
      setPw("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lock-overlay">
      <div className="lock-card">
        <div className="ic"><Lock size={26} /></div>
        <h2>婚禮籌備後台</h2>
        <p>Alan &amp; Omena · 賓客、喜餅、花費、時程</p>
        <input
          type="password" value={pw} placeholder="請輸入密碼" autoFocus
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <div className="lock-error">{err}</div>
        <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={busy} onClick={submit}>
          {busy ? "登入中…" : <><LogIn size={16} /> 進入後台</>}
        </button>
        {getStashedCouple() && (
          <button className="btn btn-ghost" style={{ width: "100%", justifyContent: "center", marginTop: 10 }} onClick={() => { if (restoreCouple()) { setRole("couple"); onOk("couple"); } }}>
            切回新人（剛才用賓客視角看，不用重打密碼）
          </button>
        )}
        <p style={{ marginTop: 16, marginBottom: 0 }}>幫手（招待）用幫手密碼登入，只會看到賓客名單、座位圖與喜餅領取名單</p>
      </div>
    </div>
  );
}
