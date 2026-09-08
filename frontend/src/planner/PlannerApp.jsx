// 籌備後台：單一 React 應用，網址 /planner/...
import { useState } from "react";
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Users, Wallet, CalendarClock, ListChecks, FolderOpen,
  Settings as SettingsIcon, LogOut, Lock, LogIn, Home as HomeIcon, Armchair, Images, Gift,
} from "lucide-react";
import { adminLogin, clearToken, getRole, getToken, setRole, setToken } from "../api.js";
import Dashboard from "./Dashboard.jsx";
import Guests from "./Guests.jsx";
import Budget from "./Budget.jsx";
import Payments from "./Payments.jsx";
import Timeline from "./Timeline.jsx";
import Files from "./Files.jsx";
import SettingsPage from "./Settings.jsx";
import Seating from "./Seating.jsx";
import Photos from "./Photos.jsx";
import Gifts from "./Gifts.jsx";

import { PlannerContext } from "./context.js";

// 2026-09-08 依新人要求移除「廠商」與「比價」頁（資料與 API 保留，花費、文件、付款仍可顯示廠商名稱）
const NAV = [
  { to: "/", label: "總覽", icon: LayoutDashboard, end: true },
  { to: "/guests", label: "婚宴", icon: Users, helper: true }, // 2026-09-08 依新人要求由「賓客」改名為「婚宴」
  { to: "/seating", label: "座位圖", icon: Armchair, helper: true },
  { to: "/gifts", label: "喜餅", icon: Gift, helper: true }, // 幫手：看名單、勾已領取
  { to: "/budget", label: "預算花費", icon: Wallet },
  { to: "/payments", label: "付款期程", icon: CalendarClock },
  { to: "/timeline", label: "時程待辦", icon: ListChecks },
  { to: "/files", label: "文件庫", icon: FolderOpen },
  { to: "/photos", label: "照片", icon: Images },
  { to: "/settings", label: "設定", icon: SettingsIcon },
];

export default function PlannerApp() {
  const [authed, setAuthed] = useState(!!getToken());
  const [role, setRoleState] = useState(getRole());

  const logout = () => {
    clearToken();
    setAuthed(false);
  };

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

  return (
    <PlannerContext.Provider value={{ role, logout }}>
      <BrowserRouter basename="/planner" future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Shell role={role} onLogout={logout}>
          <Routes>
            <Route path="/" element={<CoupleOnly role={role}><Dashboard /></CoupleOnly>} />
            <Route path="/guests" element={<Guests />} />
            <Route path="/seating" element={<Seating />} />
            <Route path="/gifts" element={<Gifts />} />
            <Route path="/budget" element={<CoupleOnly role={role}><Budget /></CoupleOnly>} />
            <Route path="/payments" element={<CoupleOnly role={role}><Payments /></CoupleOnly>} />
            <Route path="/timeline" element={<CoupleOnly role={role}><Timeline /></CoupleOnly>} />
            <Route path="/files" element={<CoupleOnly role={role}><Files /></CoupleOnly>} />
            <Route path="/photos" element={<CoupleOnly role={role}><Photos /></CoupleOnly>} />
            <Route path="/settings" element={<CoupleOnly role={role}><SettingsPage /></CoupleOnly>} />
            <Route path="*" element={<Navigate to={role === "helper" ? "/guests" : "/"} replace />} />
          </Routes>
        </Shell>
      </BrowserRouter>
    </PlannerContext.Provider>
  );
}

function CoupleOnly({ role, children }) {
  if (role === "helper") return <Navigate to="/guests" replace />;
  return children;
}

function Shell({ role, onLogout, children }) {
  const location = useLocation();
  const items = NAV.filter((n) => role !== "helper" || n.helper);
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
        <p>Alan &amp; Omena · 賓客、喜餅、預算、時程</p>
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
