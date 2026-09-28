// 籌備後台：單一 React 應用，網址 /planner/...
import { useEffect, useState } from "react";
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import {
  Users, Wallet, CalendarDays, FolderOpen,
  Settings as SettingsIcon, LogOut, Lock, LogIn, Home as HomeIcon, Armchair, Images, Gift, NotebookPen, PartyPopper, Camera, MessageSquareHeart,
} from "lucide-react";
import { adminLogin, clearToken, getRole, getToken, setRole, setToken, fetchMe } from "../api.js";
import Guests from "./Guests.jsx";
import Budget from "./Budget.jsx";
import Timeline from "./Timeline.jsx";
import Files from "./Files.jsx";
import SettingsPage from "./Settings.jsx";
import Seating from "./Seating.jsx";
import Photos from "./Photos.jsx";
import GuestPhotos from "./GuestPhotos.jsx";
import Wall from "./Wall.jsx";
import Gifts from "./Gifts.jsx";
import Memos from "./Memos.jsx";
import Program from "./Program.jsx";
import GameEdit from "./GameEdit.jsx";

import { PlannerContext } from "./context.js";
import { Loading } from "./ui.jsx";

// 2026-09-08 依新人要求移除「廠商」與「比價」頁；2026-09-10 其他頁的廠商欄位也一併移除（後端資料與 API 保留）
// 2026-09-27 每一頁對應一把鑰匙（perm）；角色能用哪些鑰匙由設定頁的權限表決定
const NAV = [
  { to: "/guests", label: "賓客名單", icon: Users, perm: ["guests_view"] }, // 2026-09-08 依新人要求改名為「賓客名單」
  { to: "/seating", label: "座位圖", icon: Armchair, perm: ["seating_view", "seating_edit"] },
  { to: "/gifts", label: "喜餅", icon: Gift, perm: ["gifts_view"] },
  { to: "/budget", label: "花費", icon: Wallet, perm: ["budget"] }, // 2026-09-08 依新人要求移除「預算」概念，只記實際金額
  { to: "/timeline", label: "行事曆", icon: CalendarDays, perm: ["calendar"] }, // 2026-09-10 原「籌備進度」改為月曆
  { to: "/memos", label: "筆記", icon: NotebookPen, perm: ["notes"] }, // 2026-09-10 原「備忘」改為筆記：標題、內容、主題、已處理、釘選
  { to: "/program", label: "活動環節", icon: PartyPopper, perm: ["program"] }, // 2026-09-09 婚禮當天流程與點子，只在後台
  { to: "/files", label: "文件庫", icon: FolderOpen, perm: ["files"] },
  { to: "/photos", label: "婚紗照", icon: Images, perm: ["photos"] }, // 2026-09-28 新人要求改名
  { to: "/day-photos", label: "當天照片", icon: Camera, perm: ["guest_photos"] }, // 2026-09-27 賓客上傳的原檔
  { to: "/wall", label: "現場留言", icon: MessageSquareHeart, perm: ["wall"] }, // 2026-09-28 賓客在 /wish 留言、會場大螢幕、歌單
  { to: "/settings", label: "設定", icon: SettingsIcon, perm: ["settings"] },
];

export default function PlannerApp() {
  const [authed, setAuthed] = useState(!!getToken());
  const [role, setRoleState] = useState(getRole());
  const [perms, setPerms] = useState(null); // null = 還沒載入

  const logout = () => {
    clearToken();
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
  return (
    <div className="pl-shell">
      <aside className="pl-side">
        <div className="pl-brand">
          <div className="pl-brand-script">Alan &amp; Omena</div>
          <div className="pl-brand-title">婚禮籌備後台</div>
          <div className="pl-brand-role">{role === "helper" ? "幫手模式" : "新人模式"}</div>
        </div>
        <nav className="pl-nav" key={location.pathname}>
          {items.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? "active" : undefined)}>
              <Icon size={16} /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="pl-side-foot">
          <a className="top-link" href="/"><HomeIcon size={14} /> 回賓客首頁</a>
          <button className="btn btn-ghost btn-sm" onClick={onLogout}><LogOut size={14} /> 登出</button>
        </div>
      </aside>
      <main className="pl-main">{children}</main>
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
        <p style={{ marginTop: 16, marginBottom: 0 }}>幫手（招待）用幫手密碼登入，只會看到賓客名單、座位圖與喜餅領取名單</p>
      </div>
    </div>
  );
}
