import { useEffect, useState, useCallback } from "react";
import Swal from "sweetalert2";
import {
  Users, Utensils, Baby, Mail, PieChart,
  ClipboardList, Download, Trash2, Armchair, Salad, Pencil, MessageCircle,
  Megaphone, Send, ChevronDown, Plus, Save,
} from "lucide-react";
import RichTextEditor from '../components/RichTextEditor.jsx';
import Select from "../components/Select.jsx";
import {
  getToken,
  fetchStats, fetchRsvps, createRsvp, updateRsvp, deleteRsvp, exportCsvUrl,
  sendBroadcast, fetchPlannerSettings, savePlannerSettings,
} from "../api.js";
import { usePlanner } from "./context.js";
import { Field, Modal, NumberInput, PageHead, confirmDelete, toastErr, toastOk } from "./ui.jsx";

const SIDE_LABEL = { groom: "男方", bride: "女方" };

/* ---------- 賓客名單（原 /admin）---------- */
export default function Guests() {
  const { logout: onLogout, role } = usePlanner();
  const [adding, setAdding] = useState(false); // 手動新增賓客視窗
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

  const remove = async (id, name) => {
    if (!(await confirmDelete(`${name} 這筆回覆`))) return;
    try {
      await deleteRsvp(id);
      setRows((rs) => rs.filter((r) => r.id !== id));
      fetchStats().then(setStats).catch(() => {});
    } catch (e) { toastErr(e); }
  };

  const downloadCsv = async () => {
    const res = await fetch(exportCsvUrl, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) return toastErr(new Error("匯出失敗"));
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `婚禮出席名單_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHead title="賓客名單" sub="出席統計、第二階段進度、群發通知、匯出 Excel"
        actions={role === "couple" ? <button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={15} /> 手動新增賓客</button> : null} />
      {adding && <AddGuestModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); toastOk("已新增賓客"); load(); }} />}

      {loading ? (
        <div className="loading">讀取資料中…</div>
      ) : err ? (
        <div className="loading" style={{ color: "var(--rose-accent)" }}>{err}</div>
      ) : (
        <>
          <StatsCards stats={stats} />
          <BroadcastPanel stats={stats} />
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
                      <th>人數</th><th>詳細</th><th>餐點</th><th>留言</th>
                      <th>電話</th><th>時間</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      // 餐點欄第二行的補充資訊
                      const extras = [];
                      if (r.kids_meal_count > 0) extras.push(`兒童餐×${r.kids_meal_count}`);
                      if (r.baby_chair_count > 0) extras.push(`座椅×${r.baby_chair_count}`);
                      if (r.veg_count > 0) extras.push(r.veg_type !== "無" ? r.veg_type : "素食");
                      const hs = (r.children || []).map((c) => (c.height != null ? c.height : "?"));
                      if (r.child_count > 0 && hs.some((h) => h !== "?")) extras.push(`身高 ${hs.join("/")}`);
                      // 留言彈窗內容（想說的話 / 備註 / 飲食過敏 合併）
                      const notes = [
                        r.message && { label: "想說的話", text: r.message },
                        r.remark && { label: "備註", text: r.remark },
                        r.dietary_note && { label: "飲食／過敏", text: r.dietary_note },
                      ].filter(Boolean);
                      return (
                        <tr key={r.id}>
                          <td className="muted-cell">{i + 1}</td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <strong>{r.name}</strong>
                            {r.is_test && <span className="pill pill-no" style={{ marginLeft: 6 }}>測試</span>}
                          </td>
                          <td><span className={`pill ${r.side === "bride" ? "pill-bride" : "pill-groom"}`}>{SIDE_LABEL[r.side] || r.side}</span></td>
                          <td><span className={`pill ${r.attending ? "pill-yes" : "pill-no"}`}>{r.attending ? "出席" : "不克"}</span></td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            {r.attending ? `${r.adult_count}大${r.child_count > 0 ? ` ${r.child_count}小` : ""}` : "—"}
                          </td>
                          <td>{r.attending ? <span className={`pill ${r.details_completed ? "pill-yes" : "pill-no"}`}>{r.details_completed ? "已填" : "待填"}</span> : "—"}</td>
                          <td className="muted-cell" style={{ minWidth: 130 }}>
                            {r.details_completed ? (
                              <>
                                {fmtMains(r.main_course) || "—"}
                                {extras.length > 0 && (
                                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{extras.join("・")}</div>
                                )}
                              </>
                            ) : "—"}
                          </td>
                          <td>
                            {notes.length > 0
                              ? <button className="btn btn-ghost btn-sm" title="查看留言/備註" onClick={() => setViewMsg({ name: r.name, items: notes })}><MessageCircle size={14} /></button>
                              : <span className="muted-cell">—</span>}
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>{r.phone || "—"}</td>
                          <td className="muted-cell" style={{ whiteSpace: "nowrap" }}>{fmtTime(r.created_at)}</td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <button className="btn btn-ghost btn-sm" title="編輯資料" onClick={() => setEditing(r)}><Pencil size={14} /></button>{" "}
                            <button className="btn btn-ghost btn-sm" title="刪除" onClick={() => remove(r.id, r.name)}><Trash2 size={14} /></button>
                          </td>
                        </tr>
                      );
                    })}
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
                <h3 className="modal-title">{viewMsg.name}</h3>
                <div className="modal-desc" style={{ textAlign: "left" }}>
                  {viewMsg.items.map((it) => (
                    <p key={it.label} style={{ marginBottom: 10 }}>
                      <strong style={{ color: "var(--milk-tea-900)" }}>{it.label}：</strong>
                      <span style={{ whiteSpace: "pre-wrap" }}>{it.text}</span>
                    </p>
                  ))}
                </div>
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


/* ---------- 手動新增賓客（沒有 Email／電話的長輩也能算進喜宴）---------- */
function AddGuestModal({ onClose, onSaved }) {
  const [f, setF] = useState({ name: "", side: "groom", attending: true, adult_count: 1, child_count: 0, email: "", phone: "", admin_note: "" });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!f.name.trim()) return toastErr(new Error("請填寫姓名"));
    setBusy(true);
    try {
      await createRsvp({ ...f, name: f.name.trim(), adult_count: Number(f.adult_count) || 0, child_count: Number(f.child_count) || 0 });
      onSaved();
    } catch (e) { toastErr(e); } finally { setBusy(false); }
  };
  return (
    <Modal title="手動新增賓客" onClose={busy ? undefined : onClose} wide
      footer={<><button className="btn btn-ghost" disabled={busy} onClick={onClose}>取消</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "儲存中…" : "新增"}</button></>}>
      <p className="helper-text" style={{ marginBottom: 12 }}>Email 與電話都可以留空；這位賓客會算進出席人數、可以排座位與帶入喜餅名單，但收不到 Email 通知，第二階段餐點請在名單按「編輯」代填。</p>
      <div className="form-group grid-2">
        <Field label="姓名" required><input type="text" value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus /></Field>
        <Field label="親友方"><Select value={f.side} onChange={(v) => set("side", v)} options={[{ value: "groom", label: "男方親友" }, { value: "bride", label: "女方親友" }]} /></Field>
      </div>
      <div className="form-group grid-2">
        <Field label="出席狀態"><Select value={f.attending} onChange={(v) => set("attending", v === true || v === "true")} options={[{ value: true, label: "出席" }, { value: false, label: "不克前往" }]} /></Field>
        <div />
      </div>
      {f.attending && <div className="form-group grid-2">
        <Field label="大人人數"><NumberInput value={f.adult_count} onChange={(v) => set("adult_count", v)} /></Field>
        <Field label="小孩人數"><NumberInput value={f.child_count} onChange={(v) => set("child_count", v)} /></Field>
      </div>}
      <div className="form-group grid-2">
        <Field label="Email（選填）"><input type="text" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
        <Field label="電話（選填）"><input type="text" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
      </div>
      <Field label="後台備註（賓客看不到）"><input type="text" value={f.admin_note} onChange={(e) => set("admin_note", e.target.value)} placeholder="例如：阿公，由爸爸代為聯絡" /></Field>
    </Modal>
  );
}

function EditModal({ row, onClose, onSaved }) {
  const [f, setF] = useState({
    ...row,
    table_no: row.table_no ?? "",
    main_course: { ...Object.fromEntries(EDIT_DISHES.map((d) => [d, 0])), ...(row.main_course || {}) },
    children: Array.from({ length: row.child_count || 0 }, (_, i) => ({
      height: row.children && row.children[i] && row.children[i].height != null ? row.children[i].height : "",
      pricing: (row.children && row.children[i] && row.children[i].pricing) || "auto",
    })),
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setMain = (d, v) => setF((x) => ({ ...x, main_course: { ...x.main_course, [d]: v } }));
  const setChild = (i, patch) =>
    setF((x) => {
      const arr = [...(x.children || [])];
      while (arr.length <= i) arr.push({ height: "", pricing: "auto" });
      arr[i] = { ...arr[i], ...patch };
      return { ...x, children: arr };
    });

  const save = async () => {
    if (!String(f.name).trim()) return toastErr(new Error("姓名不能空白"));
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
        children: Array.from({ length: f.child_count }, (_, i) => {
          const c = (f.children && f.children[i]) || {};
          return { height: c.height === "" || c.height == null ? null : parseInt(c.height, 10), pricing: c.pricing || "auto" };
        }),
        admin_note: f.admin_note || "",
        is_test: f.is_test,
      });
      onSaved(updated);
    } catch (e) {
      toastErr(e);
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

        {f.child_count > 0 && (
          <div className="form-group">
            <label>小孩身高與計價（每個小孩各自設定；「依身高自動」用後台設定的門檻）</label>
            {Array.from({ length: f.child_count }, (_, i) => {
              const c = (f.children && f.children[i]) || { height: "", pricing: "auto" };
              return (
                <div className="grid-2" key={i} style={{ alignItems: "center", marginBottom: 8 }}>
                  <NumberInput value={c.height === null ? "" : c.height} onChange={(v) => setChild(i, { height: v })} placeholder={`小孩 ${i + 1} 身高 cm（未填）`} />
                  <Select value={c.pricing} onChange={(v) => setChild(i, { pricing: v })}
                    options={[{ value: "auto", label: "依身高自動" }, { value: "free", label: "指定免費" }, { value: "half", label: "指定半價" }, { value: "full", label: "指定全價" }]} />
                </div>
              );
            })}
          </div>
        )}

        <div className="form-group">
          <label>飲食備註 / 過敏</label>
          <input type="text" value={f.dietary_note} onChange={(e) => set("dietary_note", e.target.value)} />
          {f.veg_type && f.veg_type !== "無" && <div className="helper-text">這組早先填過素食類型「{f.veg_type}」；素食餐點現在一律全素，這個欄位已不再詢問。</div>}
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
            <NumberInput value={f.table_no} onChange={(v) => set("table_no", v)} placeholder="未安排" />
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

/* 群發 Email 通知 */
const DEFAULT_SUBJECT = "宣文 & 孟庭 婚宴｜請幫我們確認出席與主餐 🍽";
const DEFAULT_BODY = `<p>{name} 你好：</p><p>謝謝你先前回覆出席我們的婚宴！<br>日期已確定為 <strong>2027.03.13（週六）中午 12:00</strong>，<br>地點在<strong>台北美福大飯店</strong>（台北市中山區樂群二路55號）。</p><p>接下來想請你幫我們確認最終出席人數、挑選你的專屬主餐：<br><a href="https://wedding.example.com/details">https://wedding.example.com/details</a><br>（進入後輸入你當初留的 Email 或電話，再用 Email 驗證碼開啟回覆）</p><p>期待與你相見！<br>宣文 &amp; 孟庭</p>`;

const QUILL_MODULES = {
  toolbar: [
    ["bold", "italic", "underline"],
    [{ color: [] }, { background: [] }],
    [{ size: ["small", false, "large"] }],
    [{ list: "ordered" }, { list: "bullet" }, { align: [] }],
    ["link"],
    ["clean"],
  ],
};

function BroadcastPanel({ stats }) {
  const [open, setOpen] = useState(false); // 預設摺疊
  const [target, setTarget] = useState("pending");
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [body, setBody] = useState(DEFAULT_BODY);
  const [testTo, setTestTo] = useState("");
  const [files, setFiles] = useState([]); // 附件 File[]
  const [busy, setBusy] = useState(false);
  // 草稿存在後台設定裡（2026-09-11 新人要求改過的內容要留着，換裝置也一樣）：載入時帶回，按「儲存草稿」才存
  const [draftState, setDraftState] = useState("loading"); // loading / saved / dirty / saving
  const [savedSnapshot, setSavedSnapshot] = useState(null);
  const snapshot = () => JSON.stringify({ subject, body, target, testTo });
  useEffect(() => {
    fetchPlannerSettings().then(({ values }) => {
      const s = values.broadcast_subject || DEFAULT_SUBJECT, b = values.broadcast_body || DEFAULT_BODY, t = values.broadcast_target || "pending", e = values.broadcast_test_to || "";
      setSubject(s); setBody(b); setTarget(t); setTestTo(e);
      setSavedSnapshot(JSON.stringify({ subject: s, body: b, target: t, testTo: e }));
      setDraftState("saved");
    }).catch(() => { setSavedSnapshot(snapshot()); setDraftState("saved"); });
  }, []);
  const dirty = savedSnapshot !== null && snapshot() !== savedSnapshot;
  const saveDraft = async () => {
    setDraftState("saving");
    try {
      await savePlannerSettings({ broadcast_subject: subject, broadcast_body: body, broadcast_target: target, broadcast_test_to: testTo });
      setSavedSnapshot(snapshot());
      setDraftState("saved");
      toastOk("信件草稿已儲存");
    } catch (e) { setDraftState("saved"); toastErr(e); }
  };
  const resetDraft = async () => {
    const r = await Swal.fire({ icon: "question", title: "還原成預設的信件內容？", text: "主旨與內文會換回系統預設，記得按「儲存草稿」才會保存。", showCancelButton: true, confirmButtonText: "還原", cancelButtonText: "取消", confirmButtonColor: "#B28F70" });
    if (!r.isConfirmed) return;
    setSubject(DEFAULT_SUBJECT); setBody(DEFAULT_BODY);
  };

  const addFiles = (list) => {
    const merged = [...files, ...Array.from(list)];
    if (merged.length > 3) {
      return Swal.fire({ icon: "warning", title: "附件最多 3 個", confirmButtonColor: "#B28F70" });
    }
    const total = merged.reduce((a, f) => a + f.size, 0);
    if (total > 10 * 1024 * 1024) {
      return Swal.fire({ icon: "warning", title: "附件總大小超過 10MB", text: "請縮小檔案後再試", confirmButtonColor: "#B28F70" });
    }
    setFiles(merged);
  };

  const sendTest = async () => {
    if (!testTo.trim()) return Swal.fire({ icon: "warning", title: "請先填測試信箱", confirmButtonColor: "#B28F70" });
    setBusy(true);
    try {
      await sendBroadcast({ subject, body, target, test_to: testTo.trim() }, files);
      Swal.fire({ icon: "success", title: "測試信已寄出", text: `請到 ${testTo.trim()} 收信確認內容${files.length ? "與附件" : ""}`, confirmButtonColor: "#B28F70" });
    } catch (e) {
      Swal.fire({ icon: "error", title: "寄送失敗", text: e.message, confirmButtonColor: "#B28F70" });
    } finally {
      setBusy(false);
    }
  };

  const sendAll = async () => {
    const targetLabel = target === "pending" ? "出席且尚未填詳細的賓客" : "所有出席賓客";
    const ask = await Swal.fire({
      icon: "question",
      title: "確定要群發嗎？",
      text: `將寄給「${targetLabel}」（有留 Email 者）${files.length ? `，並夾帶 ${files.length} 個附件` : ""}。建議先寄測試信確認內容。`,
      showCancelButton: true,
      confirmButtonText: "確定寄送",
      cancelButtonText: "取消",
      confirmButtonColor: "#B28F70",
    });
    if (!ask.isConfirmed) return;
    setBusy(true);
    try {
      const r = await sendBroadcast({ subject, body, target, test_to: "" }, files);
      Swal.fire({
        icon: "success",
        title: `已開始寄送 ${r.sent} 封`,
        text: "背景寄送中，完成後 Telegram 群組會收到成果回報",
        confirmButtonColor: "#B28F70",
      });
    } catch (e) {
      Swal.fire({ icon: "error", title: "寄送失敗", text: e.message, confirmButtonColor: "#B28F70" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div
        className="panel-head"
        style={{ cursor: "pointer", marginBottom: open ? undefined : 0, paddingBottom: open ? undefined : 0, borderBottom: open ? undefined : "none" }}
        onClick={() => setOpen((o) => !o)}
      >
        <div className="panel-title">
          <Megaphone size={18} /> 群發 Email 通知
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "inherit", fontWeight: 400 }}>
            {open ? "" : "（點擊展開）"}
          </span>
        </div>
        <ChevronDown size={17} style={{ color: "var(--milk-tea-700)", transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "none" }} />
      </div>

      {open && (
      <>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 14, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span>內文的 {"{name}"} 會自動帶入每位賓客的姓名</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          {dirty && <span>有尚未儲存的修改</span>}
          <button type="button" className="pl-linkbtn" onClick={resetDraft}>還原預設內容</button>
        </span>
      </div>

      <div className="form-group grid-2">
        <div>
          <label>寄送對象</label>
          <Select value={target} onChange={setTarget}
            options={[
              { value: "pending", label: `出席且尚未填詳細（${stats ? stats.details_pending : "…"} 組）` },
              { value: "attending_all", label: `所有出席者（${stats ? stats.attending_responses : "…"} 組）` },
            ]} />
        </div>
        <div>
          <label>主旨</label>
          <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
      </div>

      <div className="form-group">
        <label>信件內文（所見即所得，寄出即為此排版）</label>
        <RichTextEditor value={body} onChange={setBody} modules={QUILL_MODULES} />
      </div>

      <div className="form-group">
        <label>附件（PDF / JPG / PNG，最多 3 個、共 10MB）</label>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label className="btn btn-ghost" style={{ cursor: "pointer" }}>
            📎 選擇檔案
            <input
              type="file" multiple accept=".pdf,.jpg,.jpeg,.png" hidden
              onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
            />
          </label>
          {files.map((f, i) => (
            <span key={i} className="pill pill-groom" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              {f.name}（{(f.size / 1024 / 1024).toFixed(1)}MB）
              <button
                type="button"
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
                style={{ border: "none", background: "none", cursor: "pointer", color: "var(--rose-accent)", fontWeight: 700 }}
              >✕</button>
            </span>
          ))}
          {files.length === 0 && <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>尚未選擇附件（可不夾帶）</span>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="text" placeholder="測試信箱（先寄給自己看）" value={testTo}
          onChange={(e) => setTestTo(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
        <button className={`btn ${dirty ? "btn-primary" : "btn-ghost"}`} onClick={saveDraft} disabled={busy || draftState === "loading" || draftState === "saving"}><Save size={15} /> {draftState === "saving" ? "儲存中…" : "儲存草稿"}</button>
        <button className="btn btn-ghost" onClick={sendTest} disabled={busy}><Mail size={15} /> 寄測試信</button>
        <button className="btn btn-primary" onClick={sendAll} disabled={busy}><Send size={15} /> {busy ? "處理中…" : "開始群發"}</button>
      </div>
      </>
      )}
    </div>
  );
}

function Breakdown({ stats }) {
  if (!stats) return null;
  const g = stats.people_by_side.groom;
  const b = stats.people_by_side.bride;
  const max = Math.max(g, b, 1);
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
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
