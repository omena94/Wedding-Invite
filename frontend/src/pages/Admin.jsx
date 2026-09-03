import { useEffect, useState, useCallback } from "react";
import {
  Lock, LogIn, Users, Utensils, Baby, Mail, Calendar, PieChart,
  ClipboardList, Download, Trash2, Armchair, Salad, CalendarClock, Pencil, MessageCircle,
} from "lucide-react";
import Select from "../components/Select.jsx";
import DatePicker from "../components/DatePicker.jsx";
import {
  adminLogin, setToken, clearToken, getToken,
  fetchStats, fetchRsvps, updateRsvp, deleteRsvp, exportCsvUrl,
  fetchConfig, saveDeadlines,
} from "../api.js";

const SIDE_LABEL = { groom: "男方", bride: "女方" };

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
  const [editing, setEditing] = useState(null); // 正在編輯的賓客資料
  const [viewMsg, setViewMsg] = useState(null); // 查看「想說的話」{name, text}

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
        <p className="english-sub">Alan &amp; Omena · 2027 March</p>
        <h1>婚禮出席統計後台</h1>
      </div>

      {loading ? (
        <div className="loading">讀取資料中…</div>
      ) : err ? (
        <div className="loading" style={{ color: "var(--rose-accent)" }}>{err}</div>
      ) : (
        <>
          <StatsCards stats={stats} />
          <DeadlinePanel />
          <Breakdown stats={stats} />

          <div className="panel">
            <div className="panel-head">
              <div className="panel-title"><ClipboardList size={18} /> 賓客名單</div>
              <div className="toolbar">
                <div className="search-box">
                  <input type="text" placeholder="搜尋姓名 / 電話 / Email…" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <Select compact value={side} onChange={setSide}
                  options={[
                    { value: "", label: "全部親友" },
                    { value: "groom", label: "男方親友" },
                    { value: "bride", label: "女方親友" },
                  ]} />
                <Select compact value={attending} onChange={setAttending}
                  options={[
                    { value: "", label: "全部出席狀態" },
                    { value: "yes", label: "確認出席" },
                    { value: "no", label: "無法出席" },
                  ]} />
                <Select compact value={details} onChange={setDetails}
                  options={[
                    { value: "", label: "全部階段" },
                    { value: "done", label: "已填詳細" },
                    { value: "pending", label: "待填詳細" },
                  ]} />
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
                      <th>#</th><th>姓名</th><th>親友</th><th>出席</th>
                      <th>大人</th><th>幼童</th><th>詳細</th><th>主餐</th><th>兒童餐</th>
                      <th>座椅</th><th>素食</th><th>飲食備註</th><th>備註</th><th>電話</th><th>想說的話</th>
                      <th>桌號</th><th>內部備註</th><th>時間</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.id}>
                        <td className="muted-cell">{i + 1}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <strong>{r.name}</strong>
                          {r.is_test && <span className="pill pill-no" style={{ marginLeft: 6 }}>測試</span>}
                        </td>
                        <td><span className={`pill ${r.side === "bride" ? "pill-bride" : "pill-groom"}`}>{SIDE_LABEL[r.side] || r.side}</span></td>
                        <td><span className={`pill ${r.attending ? "pill-yes" : "pill-no"}`}>{r.attending ? "出席" : "不克"}</span></td>
                        <td>{r.attending ? r.adult_count : "—"}</td>
                        <td>{r.attending ? r.child_count : "—"}</td>
                        <td>{r.attending ? <span className={`pill ${r.details_completed ? "pill-yes" : "pill-no"}`}>{r.details_completed ? "已填" : "待填"}</span> : "—"}</td>
                        <td className="muted-cell">{r.details_completed ? (fmtMains(r.main_course) || "—") : "—"}</td>
                        <td>{r.details_completed ? r.kids_meal_count : "—"}</td>
                        <td>{r.details_completed ? r.baby_chair_count : "—"}</td>
                        <td>{r.details_completed && r.veg_count > 0 ? `${r.veg_count}（${r.veg_type}）` : "—"}</td>
                        <td className="muted-cell">{r.dietary_note || "—"}</td>
                        <td>
                          {r.remark
                            ? <button className="btn btn-ghost btn-sm" title="查看備註" onClick={() => setViewMsg({ name: r.name, text: r.remark, kind: "備註" })}><MessageCircle size={14} /></button>
                            : <span className="muted-cell">—</span>}
                        </td>
                        <td>{r.phone || "—"}</td>
                        <td>
                          {r.message
                            ? <button className="btn btn-ghost btn-sm" title="查看想說的話" onClick={() => setViewMsg({ name: r.name, text: r.message, kind: "想說的話" })}><MessageCircle size={14} /></button>
                            : <span className="muted-cell">—</span>}
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
                        <td style={{ whiteSpace: "nowrap" }}>
                          <button className="btn btn-ghost btn-sm" title="編輯資料" onClick={() => setEditing(r)}><Pencil size={14} /></button>{" "}
                          <button className="btn btn-ghost btn-sm" title="刪除" onClick={() => remove(r.id, r.name)}><Trash2 size={14} /></button>
                        </td>
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

          {viewMsg && (
            <div className="modal-overlay" onClick={() => setViewMsg(null)}>
              <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                <div className="modal-icon"><MessageCircle size={26} /></div>
                <h3 className="modal-title">{viewMsg.name}・{viewMsg.kind}</h3>
                <p className="modal-desc" style={{ whiteSpace: "pre-wrap", textAlign: "left" }}>{viewMsg.text}</p>
                <button className="modal-btn" onClick={() => setViewMsg(null)}>關閉</button>
              </div>
            </div>
          )}

          {editing && (
            <EditModal
              row={editing}
              onClose={() => setEditing(null)}
              onSaved={(updated) => {
                setRows((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
                fetchStats().then(setStats).catch(() => {});
                setEditing(null);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

/* ---------- 編輯賓客資料視窗 ---------- */
const EDIT_DISHES = ["牛排", "雞腿排", "鮭魚排", "素食"];
const numOpts = (from, to, unit = "") =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ value: from + i, label: `${from + i}${unit}` }));

function EditModal({ row, onClose, onSaved }) {
  const [f, setF] = useState({
    ...row,
    table_no: row.table_no ?? "",
    main_course: { ...Object.fromEntries(EDIT_DISHES.map((d) => [d, 0])), ...(row.main_course || {}) },
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setMain = (d, v) => setF((x) => ({ ...x, main_course: { ...x.main_course, [d]: v } }));

  const save = async () => {
    if (!String(f.name).trim()) return alert("姓名不能空白");
    setBusy(true);
    try {
      const updated = await updateRsvp(row.id, {
        name: String(f.name).trim(),
        side: f.side,
        attending: f.attending,
        email: f.email || "",
        phone: f.phone || "",
        adult_count: f.adult_count,
        child_count: f.child_count,
        message: f.message || "",
        details_completed: f.details_completed,
        main_course: f.main_course,
        kids_meal_count: f.kids_meal_count,
        baby_chair_count: f.baby_chair_count,
        veg_type: f.veg_type || "無",
        dietary_note: f.dietary_note || "",
        remark: f.remark || "",
        table_no: f.table_no === "" ? null : parseInt(f.table_no, 10),
        admin_note: f.admin_note || "",
        is_test: f.is_test,
      });
      onSaved(updated);
    } catch (e) {
      alert(e.message || "儲存失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card wide" onClick={(e) => e.stopPropagation()}>
        <div className="edit-modal-title"><Pencil size={17} /> 編輯賓客資料 — {row.name}</div>

        <div className="form-group grid-2">
          <div>
            <label>姓名</label>
            <input type="text" value={f.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div>
            <label>親友方</label>
            <Select value={f.side} onChange={(v) => set("side", v)}
              options={[{ value: "groom", label: "男方親友" }, { value: "bride", label: "女方親友" }]} />
          </div>
        </div>

        <div className="form-group grid-2">
          <div>
            <label>Email</label>
            <input type="text" value={f.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div>
            <label>電話</label>
            <input type="text" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
          </div>
        </div>

        <div className="form-group grid-2">
          <div>
            <label>出席狀態</label>
            <Select value={f.attending} onChange={(v) => set("attending", v === true || v === "true")}
              options={[{ value: true, label: "出席" }, { value: false, label: "不克前往" }]} />
          </div>
          <div>
            <label>詳細資料</label>
            <Select value={f.details_completed} onChange={(v) => set("details_completed", v === true || v === "true")}
              options={[{ value: false, label: "未填" }, { value: true, label: "已填" }]} />
          </div>
        </div>

        <div className="form-group grid-2">
          <div>
            <label>大人人數</label>
            <Select value={f.adult_count} onChange={(v) => set("adult_count", v)} options={numOpts(0, 15, " 位")} />
          </div>
          <div>
            <label>小孩人數</label>
            <Select value={f.child_count} onChange={(v) => set("child_count", v)} options={numOpts(0, 15, " 位")} />
          </div>
        </div>

        <div className="form-group">
          <label>主餐份數</label>
          <div className="grid-2">
            {EDIT_DISHES.map((d) => (
              <div key={d} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, minWidth: 48 }}>{d}</span>
                <Select value={f.main_course[d]} onChange={(v) => setMain(d, v)} options={numOpts(0, 15, " 份")} />
              </div>
            ))}
          </div>
        </div>

        <div className="form-group grid-2">
          <div>
            <label>兒童餐點</label>
            <Select value={f.kids_meal_count} onChange={(v) => set("kids_meal_count", v)} options={numOpts(0, 15, " 份")} />
          </div>
          <div>
            <label>兒童座椅</label>
            <Select value={f.baby_chair_count} onChange={(v) => set("baby_chair_count", v)} options={numOpts(0, 15, " 張")} />
          </div>
        </div>

        <div className="form-group grid-2">
          <div>
            <label>素食類型</label>
            <Select value={f.veg_type} onChange={(v) => set("veg_type", v)}
              options={[
                { value: "無", label: "無" },
                { value: "蛋奶素", label: "蛋奶素" },
                { value: "全素/純素", label: "全素/純素" },
                { value: "鍋邊素", label: "鍋邊素" },
              ]} />
          </div>
          <div>
            <label>飲食備註 / 過敏</label>
            <input type="text" value={f.dietary_note} onChange={(e) => set("dietary_note", e.target.value)} />
          </div>
        </div>

        <div className="form-group">
          <label>賓客備註</label>
          <input type="text" value={f.remark} onChange={(e) => set("remark", e.target.value)} />
        </div>

        <div className="form-group">
          <label>想說的話</label>
          <textarea rows={2} value={f.message} onChange={(e) => set("message", e.target.value)} />
        </div>

        <div className="form-group grid-2">
          <div>
            <label>桌號</label>
            <input type="number" min="0" value={f.table_no} onChange={(e) => set("table_no", e.target.value)} />
          </div>
          <div>
            <label>內部備註</label>
            <input type="text" value={f.admin_note} onChange={(e) => set("admin_note", e.target.value)} />
          </div>
        </div>

        <div className="form-group">
          <label>測試資料（不計入統計與匯出）</label>
          <Select value={f.is_test} onChange={(v) => set("is_test", v === true || v === "true")}
            options={[{ value: false, label: "否（正式資料）" }, { value: true, label: "是（測試用）" }]} />
        </div>

        <div className="edit-modal-actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>取消</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "儲存中…" : "儲存變更"}</button>
        </div>
      </div>
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

/* 各階段截止日期設定 */
function DeadlinePanel() {
  const [cfg, setCfg] = useState(null);
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetchConfig().then((c) => {
      setCfg(c);
      setP1(c.phase1_deadline || "");
      setP2(c.phase2_deadline || "");
    }).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true); setMsg("");
    try {
      const c = await saveDeadlines({ phase1_deadline: p1, phase2_deadline: p2 });
      setCfg(c);
      setMsg("已儲存");
      setTimeout(() => setMsg(""), 2500);
    } catch (e) {
      setMsg(e.message || "儲存失敗");
    } finally {
      setSaving(false);
    }
  };

  const statusPill = (open) => (
    <span className={`pill ${open ? "pill-yes" : "pill-no"}`}>{open ? "開放中" : "已截止"}</span>
  );

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="panel-title"><CalendarClock size={18} /> 各階段截止日期</div>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>截止日「當天」仍可填寫，隔天起自動關閉（台灣時間）</div>
      </div>
      <div className="mini-grid" style={{ marginBottom: 14 }}>
        <div className="mini">
          <div className="m-label">意願調查（首頁）截止日 {cfg && statusPill(cfg.phase1_open)}</div>
          <div style={{ marginTop: 8 }}><DatePicker value={p1} onChange={setP1} /></div>
        </div>
        <div className="mini">
          <div className="m-label">飲食調查（/details）截止日 {cfg && statusPill(cfg.phase2_open)}</div>
          <div style={{ marginTop: 8 }}><DatePicker value={p2} onChange={setP2} /></div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "儲存中…" : "儲存設定"}</button>
        <button className="btn btn-ghost" onClick={() => { setP1(""); setP2(""); }}>清空（不設限）</button>
        {msg && <span style={{ fontSize: 13, color: msg === "已儲存" ? "var(--sage-accent)" : "var(--rose-accent)" }}>{msg}</span>}
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
