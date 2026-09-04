// 單一廠商：聯絡資訊、報價、花費與付款、檔案、待辦
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Check, Download, ExternalLink, FileText, ListChecks, Pencil, Plus, Receipt, Trash2, Undo2, Upload, Wallet,
} from "lucide-react";
import {
  deleteExpense, deleteFile, deletePayment, deleteQuote, deleteTask, deleteVendor,
  downloadFile, fetchVendor, fetchVendors, openFile, updateTask,
} from "../api.js";
import { ASSIGNEE, FILE_KIND, PAID_BY, STATUS_PILL, VENDOR_STATUS, fmtDate, fmtSize, money } from "../constants.js";
import { ExpenseModal, PaymentModal, QuoteModal, TaskModal, UploadModal, VendorModal } from "./modals.jsx";
import { ErrorBox, Loading, PageHead, Stars, confirmDelete, toastErr, useLoader } from "./ui.jsx";
import { dueTag } from "./Dashboard.jsx";

export default function VendorDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: v, loading, error, reload } = useLoader(() => fetchVendor(id), [id]);
  const { data: vendors } = useLoader(() => fetchVendors(), []);
  const [modal, setModal] = useState(null); // {type, ...}

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const close = () => setModal(null);
  const saved = () => { close(); reload(); };
  const act = async (fn, what) => {
    if (what !== undefined && !(await confirmDelete(what))) return;
    try { await fn(); reload(); } catch (e) { toastErr(e); }
  };

  return (
    <div>
      <Link className="top-link" to="/vendors" style={{ marginBottom: 10 }}><ArrowLeft size={14} /> 廠商清單</Link>
      <PageHead
        title={<>{v.name} <span className={`pill ${STATUS_PILL[v.status]}`} style={{ verticalAlign: "middle", marginLeft: 8 }}>{VENDOR_STATUS[v.status]}</span></>}
        sub={<>{v.category}{v.rating > 0 && <> · <Stars value={v.rating} /></>}</>}
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => setModal({ type: "vendor" })}><Pencil size={14} /> 編輯</button>
            <button className="btn btn-ghost" onClick={() => act(async () => { await deleteVendor(v.id); nav("/vendors"); }, v.name)}><Trash2 size={14} /> 刪除</button>
          </>
        }
      />

      <div className="pl-grid-2">
        {/* 聯絡資訊 */}
        <div className="panel">
          <div className="panel-head"><div className="panel-title">聯絡資訊</div></div>
          <dl className="pl-dl">
            <Row label="聯絡人" value={v.contact_name} />
            <Row label="電話" value={v.phone} href={v.phone ? `tel:${v.phone}` : ""} />
            <Row label="LINE" value={v.line_id} />
            <Row label="Email" value={v.email} href={v.email ? `mailto:${v.email}` : ""} />
            <Row label="地址" value={v.address} />
            <Row label="網站 / IG" value={v.website} href={/^https?:/.test(v.website || "") ? v.website : ""} />
          </dl>
          {v.note && <div className="pl-note">{v.note}</div>}
        </div>

        {/* 報價 */}
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">報價項目</div>
            <div style={{ display: "flex", gap: 8 }}>
              <Link className="btn btn-ghost btn-sm" to={`/compare?category=${encodeURIComponent(v.category)}`}>比價</Link>
              <button className="btn btn-primary btn-sm" onClick={() => setModal({ type: "quote" })}><Plus size={13} /> 新增</button>
            </div>
          </div>
          {v.quotes.length === 0 ? <div className="empty-state" style={{ padding: 20 }}>還沒有報價，按「新增」把方案與金額記下來</div> : (
            <div className="table-wrap">
              <table style={{ minWidth: 0 }}>
                <thead><tr><th>項目</th><th style={{ textAlign: "right" }}>金額</th><th>備註</th><th></th></tr></thead>
                <tbody>
                  {v.quotes.map((q) => (
                    <tr key={q.id}>
                      <td>{q.item}</td>
                      <td className="amount">{money(q.price)}</td>
                      <td className="muted-cell">{q.note || "—"}</td>
                      <td className="row-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: "quote", quote: q })}><Pencil size={13} /></button>{" "}
                        <button className="btn btn-ghost btn-sm" onClick={() => act(() => deleteQuote(q.id), q.item)}><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 花費與付款 */}
      <div className="panel">
        <div className="panel-head">
          <div className="panel-title"><Wallet size={18} /> 花費與付款期程 {v.contract_total > 0 && <span className="muted-cell" style={{ fontWeight: 400, fontSize: 13 }}>· 合約 {money(v.contract_total)} · 已付 {money(v.paid_total)}</span>}</div>
          <button className="btn btn-primary btn-sm" onClick={() => setModal({ type: "expense" })}><Plus size={13} /> 新增花費</button>
        </div>
        {v.expenses.length === 0 ? <div className="empty-state" style={{ padding: 20 }}>簽約後在這裡記合約金額與分期，總覽會提醒你什麼時候該付</div> : v.expenses.map((e) => (
          <div className="pl-expense" key={e.id}>
            <div className="pl-expense-head">
              <div>
                <div className="pl-list-title">{e.title} <span className="pill pill-groom">{PAID_BY[e.paid_by]}</span></div>
                <div className="pl-list-sub">預算 {money(e.budget_amount)} · 合約 {money(e.contract_amount)} · 已付 {money(e.paid_total)} · 未付 {money(e.unpaid_total)}</div>
              </div>
              <div className="row-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: "payment", expense: e })}><Plus size={13} /> 付款</button>{" "}
                <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: "expense", expense: e })}><Pencil size={13} /></button>{" "}
                <button className="btn btn-ghost btn-sm" onClick={() => act(() => deleteExpense(e.id), e.title)}><Trash2 size={13} /></button>
              </div>
            </div>
            {e.payments.length > 0 && (
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table style={{ minWidth: 0 }}>
                  <thead><tr><th>付款</th><th style={{ textAlign: "right" }}>金額</th><th>應付</th><th>狀態</th><th></th></tr></thead>
                  <tbody>
                    {e.payments.map((p) => (
                      <tr key={p.id}>
                        <td>{p.title}{p.note && <div className="muted-cell" style={{ fontSize: 11.5 }}>{p.note}</div>}</td>
                        <td className="amount">{money(p.amount)}</td>
                        <td className="muted-cell" style={{ whiteSpace: "nowrap" }}>{p.due_date ? `${fmtDate(p.due_date)}${p.paid_date ? "" : dueTag(p.due_date)}` : "—"}</td>
                        <td>{p.paid_date ? <span className="pill pill-yes">已付 {fmtDate(p.paid_date)}{p.method ? ` · ${p.method}` : ""}</span> : <span className="pill pill-warn">未付</span>}</td>
                        <td className="row-actions">
                          {p.paid_date
                            ? <button className="btn btn-ghost btn-sm" title="改回未付" onClick={() => setModal({ type: "payment", expense: e, payment: p })}><Undo2 size={13} /></button>
                            : <button className="btn btn-ghost btn-sm" title="標記已付" onClick={() => setModal({ type: "payment", expense: e, payment: p, markPaid: true })}><Check size={13} /> 已付</button>}{" "}
                          <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: "payment", expense: e, payment: p })}><Pencil size={13} /></button>{" "}
                          <button className="btn btn-ghost btn-sm" onClick={() => act(() => deletePayment(p.id), p.title)}><Trash2 size={13} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="pl-grid-2">
        {/* 檔案 */}
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title"><FileText size={18} /> 合約與文件</div>
            <button className="btn btn-primary btn-sm" onClick={() => setModal({ type: "upload" })}><Upload size={13} /> 上傳</button>
          </div>
          {v.files.length === 0 ? <div className="empty-state" style={{ padding: 20 }}>把合約、報價單、收據的 PDF 或照片傳上來，之後找就不用翻 LINE</div> : (
            <ul className="pl-list">
              {v.files.map((f) => (
                <li key={f.id}>
                  <div style={{ minWidth: 0 }}>
                    <div className="pl-list-title" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                      {f.kind === "receipt" ? <Receipt size={13} style={{ verticalAlign: -2 }} /> : <FileText size={13} style={{ verticalAlign: -2 }} />} {f.filename}
                    </div>
                    <div className="pl-list-sub">{FILE_KIND[f.kind]} · {fmtSize(f.size)} · {fmtDate(f.created_at)}{f.note ? ` · ${f.note}` : ""}</div>
                  </div>
                  <div className="row-actions">
                    <button className="btn btn-ghost btn-sm" title="開啟" onClick={() => openFile(f.id).catch(toastErr)}><ExternalLink size={13} /></button>{" "}
                    <button className="btn btn-ghost btn-sm" title="下載" onClick={() => downloadFile(f.id, f.filename).catch(toastErr)}><Download size={13} /></button>{" "}
                    <button className="btn btn-ghost btn-sm" title="刪除" onClick={() => act(() => deleteFile(f.id), f.filename)}><Trash2 size={13} /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 待辦 */}
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title"><ListChecks size={18} /> 相關待辦</div>
            <button className="btn btn-primary btn-sm" onClick={() => setModal({ type: "task" })}><Plus size={13} /> 新增</button>
          </div>
          {v.tasks.length === 0 ? <div className="empty-state" style={{ padding: 20 }}>例如：預約試穿、確認集合時間、選片回傳</div> : (
            <ul className="pl-list">
              {v.tasks.map((t) => (
                <li key={t.id} style={{ opacity: t.done ? 0.55 : 1 }}>
                  <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                    <input type="checkbox" checked={t.done} onChange={() => act(() => updateTask(t.id, { done: !t.done }))} style={{ marginTop: 4 }} />
                    <div>
                      <div className="pl-list-title" style={{ textDecoration: t.done ? "line-through" : "none" }}>{t.kind === "milestone" && <span className="pill pill-bride" style={{ marginRight: 6 }}>里程碑</span>}{t.title}</div>
                      <div className="pl-list-sub">{ASSIGNEE[t.assignee]} · {t.due_date ? `${fmtDate(t.due_date)}${t.done ? "" : dueTag(t.due_date)}` : "未定日期"}</div>
                    </div>
                  </label>
                  <div className="row-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: "task", task: t })}><Pencil size={13} /></button>{" "}
                    <button className="btn btn-ghost btn-sm" onClick={() => act(() => deleteTask(t.id), t.title)}><Trash2 size={13} /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {modal?.type === "vendor" && <VendorModal initial={v} onClose={close} onSaved={saved} />}
      {modal?.type === "quote" && <QuoteModal vendorId={v.id} initial={modal.quote} onClose={close} onSaved={saved} />}
      {modal?.type === "expense" && (
        <ExpenseModal vendors={vendors || []} initial={modal.expense || { vendor_id: v.id, category: v.category }} onClose={close} onSaved={saved} />
      )}
      {modal?.type === "payment" && (
        <PaymentModal expenseId={modal.expense.id} expenseTitle={modal.expense.title} initial={modal.payment} markPaid={modal.markPaid} onClose={close} onSaved={saved} />
      )}
      {modal?.type === "task" && (
        <TaskModal vendors={vendors || []} initial={modal.task || { vendor_id: v.id }} onClose={close} onSaved={saved} />
      )}
      {modal?.type === "upload" && (
        <UploadModal vendors={vendors || []} defaults={{ vendor_id: v.id, kind: "doc" }} onClose={close} onSaved={saved} />
      )}
    </div>
  );
}

function Row({ label, value, href }) {
  return (
    <div className="pl-dl-row">
      <dt>{label}</dt>
      <dd>{value ? (href ? <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer">{value}</a> : value) : <span className="muted-cell">—</span>}</dd>
    </div>
  );
}
