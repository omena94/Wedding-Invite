import { useEffect, useState, useCallback } from "react";
import {
  Lock, LogIn, Users, Utensils, Baby, Mail, Calendar, PieChart,
  ClipboardList, Download, Trash2, Armchair, Salad,
} from "lucide-react";
import {
  adminLogin, setToken, clearToken, getToken,
  fetchStats, fetchRsvps, updateRsvp, deleteRsvp, exportCsvUrl,
} from "../api.js";

const SIDE_LABEL = { groom: "男方", bride: "女方" };
const STATUS_LABEL = { new: "待處理", contacted: "已聯絡", seated: "已排桌" };
const DATE_LABEL = { both: "都可以", "0306": "2027.03.06（週六）", "0313": "2027.03.13（週六）" };

export default function Admin() {
  const [authed, setAuthed] = useState(!!getToken());
  if (!authed) return <LoginGate onOk={() => setAuthed(true)} />;
  return <Dashboard onLogout={() => { clearToken(); setAuthed(false); }} />;
}

/* ---------- 登入 ---------- */
function LoginGate({ onOk }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      const { token } = await adminLogin(pw);
      setToken(token);
      onOk();
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
        <h2>後台管理</h2>
        <p>Alan &amp; Omena 婚禮出席統計</p>
        <input
          type="password" value={pw} placeholder="請輸入後台密碼" autoFocus
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <div className="lock-error">{err}</div>
        <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={busy} onClick={submit}>
          {busy ? "登入中…" : <><LogIn size={16} /> 進入後台</>}
        </button>
      </div>
    </div>
  );
}

/* ---------- 後台主體 ---------- */
function Dashboard({ onLogout }) {
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [side, setSide] = useState("");
  const [attending, setAttending] = useState("");
  const [details, setDetails] = useState("");

  const load = useCallback(async () => {
    setErr("");
    try {
      const params = {};
      if (search) params.search = search;
      if (side) params.side = side;
      if (attending) params.attending = attending;
      if (details) params.details = details;
      const [s, r] = await Promise.all([fetchStats(), fetchRsvps(params)]);
      setStats(s);
      setRows(r);
    } catch (e) {
      setErr(e.message);
      if (e.message.includes("登入")) onLogout();
    } finally {
      setLoading(false);
    }
  }, [search, side, attending, details, onLogout]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const patch = async (id, data) => {
    try {
      const updated = await updateRsvp(id, data);
      setRows((rs) => rs.map((r) => (r.id === id ? updated : r)));
    } catch (e) { alert(e.message); }
  };

  const remove = async (id, name) => {
    if (!confirm(`確定要刪除「${name}」這筆回覆嗎？此動作無法復原。`)) return;
    try {
      await deleteRsvp(id);
      setRows((rs) => rs.filter((r) => r.id !== id));
      fetchStats().then(setStats).catch(() => {});
    } catch (e) { alert(e.message); }
  };

  const downloadCsv = async () => {
    const res = await fetch(exportCsvUrl, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) return alert("匯出失敗");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `婚禮出席名單_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container-wide">
      <div className="top-bar">
        <a className="top-link" href="/">← 回到意願表單</a>
        <button className="btn btn-ghost btn-sm" onClick={onLogout}>登出</button>
      </div>

      <div className="page-head">
        <p className="script-title">Guest Dashboard</p>
        <p className="english-sub">Alan &amp; Omena · 2027 春</p>
        <h1>婚禮出席統計後台</h1>
      </div>

      {loading ? (
        <div className="loading">讀取資料中…</div>
      ) : err ? (
        <div className="loading" style={{ color: "var(--rose-accent)" }}>{err}</div>
      ) : (
        <>
          <StatsCards stats={stats} />
          <DatePrefPanel stats={stats} />
          <Breakdown stats={stats} />

          <div className="panel">
            <div className="panel-head">
              <div className="panel-title"><ClipboardList size={18} /> 賓客名單</div>
              <div className="toolbar">
                <div className="search-box">
                  <input type="text" placeholder="搜尋姓名 / 電話 / Email…" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <select className="filter" value={side} onChange={(e) => setSide(e.target.value)}>
                  <option value="">全部親友</option>
                  <option value="groom">男方親友</option>
                  <option value="bride">女方親友</option>
                </select>
                <select className="filter" value={attending} onChange={(e) => setAttending(e.target.value)}>
                  <option value="">全部出席狀態</option>
                  <option value="yes">確認出席</option>
                  <option value="no">無法出席</option>
                </select>
                <select className="filter" value={details} onChange={(e) => setDetails(e.target.value)}>
                  <option value="">全部階段</option>
                  <option value="done">已填詳細</option>
                  <option value="pending">待填詳細</option>
                </select>
                <button className="btn btn-primary" onClick={downloadCsv}><Download size={15} /> 匯出 Excel/CSV</button>
              </div>
            </div>

            {rows.length === 0 ? (
              <div className="empty-state">目前還沒有符合條件的回覆</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th><th>姓名</th><th>親友</th><th>出席</th><th>日期偏好</th>
                      <th>大人</th><th>幼童</th><th>詳細</th><th>主餐</th><th>兒童餐</th>
                      <th>座椅</th><th>素食</th><th>飲食備註</th><th>備註</th><th>電話</th><th>想說的話</th>
                      <th>狀態</th><th>桌號</th><th>內部備註</th><th>時間</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.id}>
                        <td className="muted-cell">{i + 1}</td>
                        <td><strong>{r.name}</strong></td>
                        <td><span className={`pill ${r.side === "bride" ? "pill-bride" : "pill-groom"}`}>{SIDE_LABEL[r.side] || r.side}</span></td>
                        <td><span className={`pill ${r.attending ? "pill-yes" : "pill-no"}`}>{r.attending ? "出席" : "不克"}</span></td>
                        <td className="muted-cell">{r.attending ? (DATE_LABEL[r.date_preference] || "—") : "—"}</td>
                        <td>{r.attending ? r.adult_count : "—"}</td>
                        <td>{r.attending ? r.child_count : "—"}</td>
                        <td>{r.attending ? <span className={`pill ${r.details_completed ? "pill-yes" : "pill-no"}`}>{r.details_completed ? "已填" : "待填"}</span> : "—"}</td>
                        <td className="muted-cell">{r.details_completed ? (fmtMains(r.main_course) || "—") : "—"}</td>
                        <td>{r.details_completed ? r.kids_meal_count : "—"}</td>
                        <td>{r.details_completed ? r.baby_chair_count : "—"}</td>
                        <td>{r.details_completed && r.veg_count > 0 ? `${r.veg_count}（${r.veg_type}）` : "—"}</td>
                        <td className="muted-cell">{r.dietary_note || "—"}</td>
                        <td className="blessing-cell muted-cell">{r.remark || "—"}</td>
                        <td>{r.phone || "—"}</td>
                        <td className="blessing-cell muted-cell">{r.message || "—"}</td>
                        <td>
                          <select className="inline-input" value={r.manage_status} onChange={(e) => patch(r.id, { manage_status: e.target.value })}>
                            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        </td>
                        <td>
                          <input
                            className="inline-input table-no" type="number" min="0"
                            defaultValue={r.table_no ?? ""}
                            onBlur={(e) => {
                              const v = e.target.value === "" ? null : parseInt(e.target.value, 10);
                              if (v !== (r.table_no ?? null)) patch(r.id, { table_no: v });
                            }}
                          />
                        </td>
                        <td>
                          <input
                            className="inline-input" type="text" defaultValue={r.admin_note} placeholder="—"
                            style={{ minWidth: 120 }}
                            onBlur={(e) => { if (e.target.value !== r.admin_note) patch(r.id, { admin_note: e.target.value }); }}
                          />
                        </td>
                        <td className="muted-cell" style={{ whiteSpace: "nowrap" }}>{fmtTime(r.created_at)}</td>
                        <td><button className="btn btn-ghost btn-sm" onClick={() => remove(r.id, r.name)}><Trash2 size={14} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="footnote">
            <span className="status-dot" />資料即時來自後端資料庫 · 共 {rows.length} 筆
            <br />統計數字有 Redis 快取（若未安裝 Redis 仍可正常運作）。
          </div>
        </>
      )}
    </div>
  );
}

function StatsCards({ stats }) {
  if (!stats) return null;
  const cards = [
    { v: stats.total_guests, u: "位", label: "確認出席總人數（大人+幼童）", icon: <Users size={20} /> },
    { v: stats.total_adults, u: "位", label: "大人 · 佔位人數（排桌用）", icon: <Utensils size={20} /> },
    { v: stats.total_children, u: "位", label: "幼童人數", icon: <Baby size={20} /> },
    { v: stats.total_responses, u: "筆", label: `總回覆 · 出席 ${stats.attending_responses} / 不克 ${stats.declined_responses}`, icon: <Mail size={20} /> },
  ];
  return (
    <div className="stats-grid">
      {cards.map((c, i) => (
        <div className="stat-card" key={i}>
          <div className="ic">{c.icon}</div>
          <div className="value">{c.v}<small> {c.u}</small></div>
          <div className="label">{c.label}</div>
        </div>
      ))}
    </div>
  );
}

/* Phase 1 重點：日期偏好分佈 */
function DatePrefPanel({ stats }) {
  if (!stats) return null;
  const resp = stats.date_pref_responses || {};
  const ppl = stats.date_pref_people || {};
  const items = [
    { key: "d0306", label: "2027.03.06（週六）", r: resp.d0306, p: ppl.d0306 },
    { key: "d0313", label: "2027.03.13（週六）", r: resp.d0313, p: ppl.d0313 },
    { key: "both", label: "兩天都可以", r: resp.both, p: ppl.both },
  ];
  const maxP = Math.max(...items.map((i) => i.p || 0), 1);
  return (
    <div className="panel">
      <div className="panel-head"><div className="panel-title"><Calendar size={18} /> 日期偏好分佈</div></div>
      <div className="mini-grid">
        {items.map((it) => (
          <div className="mini" key={it.key}>
            <div className="m-label">{it.label}</div>
            <div className="m-value">{it.p || 0} <small style={{ fontSize: 13, color: "var(--text-muted)" }}>人</small></div>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${((it.p || 0) / maxP) * 100}%` }} /></div>
            <div className="footnote" style={{ textAlign: "left", marginTop: 6 }}>{it.r || 0} 組回覆</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Breakdown({ stats }) {
  if (!stats) return null;
  const g = stats.people_by_side.groom;
  const b = stats.people_by_side.bride;
  const max = Math.max(g, b, 1);
  const vegTypes = Object.entries(stats.veg_types || {});
  const mainTotals = Object.entries(stats.main_course_totals || {});
  const totalAttend = stats.attending_responses || 0;
  const donePct = totalAttend ? Math.round((stats.details_done / totalAttend) * 100) : 0;
  return (
    <div className="panel">
      <div className="panel-head"><div className="panel-title"><PieChart size={18} /> 細項分佈</div></div>
      <div className="mini-grid" style={{ marginBottom: 14 }}>
        <div className="mini">
          <div className="m-label">男方親友（人數）</div>
          <div className="m-value">{g}</div>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${(g / max) * 100}%` }} /></div>
        </div>
        <div className="mini">
          <div className="m-label">女方親友（人數）</div>
          <div className="m-value">{b}</div>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${(b / max) * 100}%`, background: "linear-gradient(135deg,var(--rose-accent),#9E5A54)" }} /></div>
        </div>
        <div className="mini">
          <div className="m-label">第二階段詳細填寫進度</div>
          <div className="m-value">{stats.details_done}<small style={{ fontSize: 13, color: "var(--text-muted)" }}> / {totalAttend} 組（{donePct}%）</small></div>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${donePct}%`, background: "linear-gradient(135deg,var(--sage-accent),#5f7361)" }} /></div>
          <div className="footnote" style={{ textAlign: "left", marginTop: 6 }}>尚待填 {stats.details_pending} 組</div>
        </div>
        <div className="mini">
          <div className="m-label">兒童座椅 · 素食 · 兒童餐</div>
          <div className="m-value" style={{ fontSize: 18, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Armchair size={16} /> {stats.total_baby_chairs}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Salad size={16} /> {stats.total_veg}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Baby size={16} /> {stats.total_kids_meals}</span>
          </div>
        </div>
      </div>
      <div className="footnote" style={{ textAlign: "left", marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
        <Utensils size={13} /> 主餐份數：{mainTotals.length ? mainTotals.map(([k, v]) => `${k} ×${v}`).join("　·　") : "尚未有人填詳細資料"}
      </div>
      <div className="footnote" style={{ textAlign: "left", marginTop: 4 }}>
        {vegTypes.length
          ? "素食類型：" + vegTypes.map(([k, v]) => `${k} ×${v} 組`).join("　·　")
          : "目前沒有素食需求（或尚未填第二階段）"}
      </div>
    </div>
  );
}

function fmtMains(mc) {
  return Object.entries(mc || {})
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}×${v}`)
    .join("、");
}

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
