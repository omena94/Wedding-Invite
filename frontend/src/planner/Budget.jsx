// 預算與花費：依類別看預算、合約金額、已付、未付；展開看分期
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { deleteExpense, deletePayment, fetchExpenses, fetchVendors } from "../api.js";
import { PAID_BY, fmtDate, money } from "../constants.js";
import { ExpenseModal, PaymentModal } from "./modals.jsx";
import { Empty, ErrorBox, Loading, PageHead, confirmDelete, toastErr, useLoader } from "./ui.jsx";
import { dueTag } from "./Dashboard.jsx";

export default function Budget() {
  const { data, loading, error, reload } = useLoader(fetchExpenses, []);
  const { data: vendors } = useLoader(() => fetchVendors(), []);
  const [modal, setModal] = useState(null);
  const [open, setOpen] = useState({}); // expense id → 展開分期

  const groups = useMemo(() => {
    const m = new Map();
    (data || []).forEach((e) => {
      if (!m.has(e.category)) m.set(e.category, []);
      m.get(e.category).push(e);
    });
    return Array.from(m.entries());
  }, [data]);

  const totals = useMemo(() => {
    const t = { budget: 0, contract: 0, paid: 0, unpaid: 0 };
    (data || []).forEach((e) => {
      t.budget += e.budget_amount; t.contract += e.contract_amount; t.paid += e.paid_total; t.unpaid += e.unpaid_total;
    });
    return t;
  }, [data]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const close = () => setModal(null);
  const saved = () => { close(); reload(); };
  const act = async (fn, what) => {
    if (what !== undefined && !(await confirmDelete(what))) return;
    try { await fn(); reload(); } catch (e) { toastErr(e); }
  };
  const sub = (list, k) => list.reduce((a, e) => a + (e[k] || 0), 0);

  return (
    <div>
      <PageHead title="預算與花費" sub="每個項目的預算、簽約金額與付款進度；分期在「付款期程」頁也看得到"
        actions={<button className="btn btn-primary" onClick={() => setModal({ type: "expense" })}><Plus size={15} /> 新增花費</button>} />

      <div className="stats-grid">
        <Card label="預算合計" value={money(totals.budget)} />
        <Card label="合約 / 實際合計" value={money(totals.contract)} sub={totals.budget ? `${totals.contract > totals.budget ? "超出" : "低於"}預算 ${money(Math.abs(totals.contract - totals.budget))}` : ""} />
        <Card label="已付" value={money(totals.paid)} bar={totals.contract ? Math.round((totals.paid / totals.contract) * 100) : 0} />
        <Card label="未付" value={money(totals.unpaid)} />
      </div>

      {(!data || data.length === 0) ? (
        <div className="panel"><Empty>還沒有花費項目。從「新增花費」開始，或到廠商頁面新增，會自動掛在該廠商底下。</Empty></div>
      ) : groups.map(([cat, list]) => (
        <div className="panel" key={cat}>
          <div className="panel-head">
            <div className="panel-title">{cat}</div>
            <div className="muted-cell" style={{ fontSize: 12.5 }}>預算 {money(sub(list, "budget_amount"))} · 合約 {money(sub(list, "contract_amount"))} · 已付 {money(sub(list, "paid_total"))}</div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>項目</th><th>廠商</th><th>由誰出</th><th style={{ textAlign: "right" }}>預算</th><th style={{ textAlign: "right" }}>合約</th><th style={{ textAlign: "right" }}>已付</th><th style={{ textAlign: "right" }}>未付</th><th style={{ minWidth: 110 }}>進度</th><th></th></tr>
              </thead>
              <tbody>
                {list.map((e) => {
                  const pct = e.contract_amount ? Math.min(100, Math.round((e.paid_total / e.contract_amount) * 100)) : 0;
                  const isOpen = !!open[e.id];
                  return [
                    <tr key={e.id}>
                      <td>
                        <button className="pl-linkbtn" onClick={() => setOpen((o) => ({ ...o, [e.id]: !isOpen }))}>
                          <ChevronDown size={14} style={{ transition: "transform .2s", transform: isOpen ? "rotate(180deg)" : "none" }} /> <strong>{e.title}</strong>
                          <span className="muted-cell" style={{ marginLeft: 6, fontSize: 12 }}>{e.payments.length} 期</span>
                        </button>
                        {e.note && <div className="muted-cell" style={{ fontSize: 11.5, marginTop: 2, whiteSpace: "pre-wrap" }}>{e.note}</div>}
                      </td>
                      <td>{e.vendor_id ? <Link to={`/vendors/${e.vendor_id}`}>{e.vendor_name}</Link> : <span className="muted-cell">—</span>}</td>
                      <td><span className="pill pill-groom">{PAID_BY[e.paid_by]}</span></td>
                      <td className="amount">{money(e.budget_amount)}</td>
                      <td className="amount">{money(e.contract_amount)}</td>
                      <td className="amount">{money(e.paid_total)}</td>
                      <td className="amount">{e.unpaid_total ? money(e.unpaid_total) : "—"}</td>
                      <td><div className="bar-track" style={{ marginTop: 0 }}><div className="bar-fill" style={{ width: `${pct}%` }} /></div><div className="muted-cell" style={{ fontSize: 11 }}>{pct}%</div></td>
                      <td className="row-actions">
                        <button className="btn btn-ghost btn-sm" title="新增付款" onClick={() => setModal({ type: "payment", expense: e })}><Plus size={13} /></button>{" "}
                        <button className="btn btn-ghost btn-sm" title="編輯" onClick={() => setModal({ type: "expense", expense: e })}><Pencil size={13} /></button>{" "}
                        <button className="btn btn-ghost btn-sm" title="刪除" onClick={() => act(() => deleteExpense(e.id), e.title)}><Trash2 size={13} /></button>
                      </td>
                    </tr>,
                    isOpen && (
                      <tr key={`${e.id}-p`} className="pl-subrow">
                        <td colSpan={9}>
                          {e.payments.length === 0 ? <span className="muted-cell">還沒有分期，按「+」新增定金、尾款等付款</span> : (
                            <table style={{ minWidth: 0 }}>
                              <tbody>
                                {e.payments.map((p) => (
                                  <tr key={p.id}>
                                    <td style={{ width: "30%" }}>{p.title}{p.note && <span className="muted-cell" style={{ fontSize: 11.5 }}> · {p.note}</span>}</td>
                                    <td className="amount" style={{ width: "15%" }}>{money(p.amount)}</td>
                                    <td className="muted-cell">{p.due_date ? `應付 ${fmtDate(p.due_date)}${p.paid_date ? "" : dueTag(p.due_date)}` : "未定應付日"}</td>
                                    <td>{p.paid_date ? <span className="pill pill-yes">已付 {fmtDate(p.paid_date)}{p.method ? ` · ${p.method}` : ""}</span> : <span className="pill pill-warn">未付</span>}</td>
                                    <td className="row-actions">
                                      {p.paid_date
                                        ? <button className="btn btn-ghost btn-sm" title="編輯 / 改回未付" onClick={() => setModal({ type: "payment", expense: e, payment: p })}><Undo2 size={13} /></button>
                                        : <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: "payment", expense: e, payment: p, markPaid: true })}><Check size={13} /> 已付</button>}{" "}
                                      <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: "payment", expense: e, payment: p })}><Pencil size={13} /></button>{" "}
                                      <button className="btn btn-ghost btn-sm" onClick={() => act(() => deletePayment(p.id), p.title)}><Trash2 size={13} /></button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {modal?.type === "expense" && <ExpenseModal vendors={vendors || []} initial={modal.expense} onClose={close} onSaved={saved} />}
      {modal?.type === "payment" && (
        <PaymentModal expenseId={modal.expense.id} expenseTitle={modal.expense.title} initial={modal.payment} markPaid={modal.markPaid} onClose={close} onSaved={saved} />
      )}
    </div>
  );
}

function Card({ label, value, sub, bar }) {
  return (
    <div className="stat-card">
      <div className="value" style={{ fontSize: 22 }}>{value}</div>
      <div className="label">{label}{sub ? ` · ${sub}` : ""}</div>
      {bar !== undefined && <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(100, bar)}%` }} /></div>}
    </div>
  );
}
