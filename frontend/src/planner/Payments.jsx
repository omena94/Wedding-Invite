// 付款期程：所有廠商的分期合併成一張表，依應付日排序。
// 預設顯示全部：已付的留在清單裡當紀錄（排在未付後面、顏色淡一點），不會一標記就不見。
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import Select from "../components/Select.jsx";
import { deletePayment, fetchPayments } from "../api.js";
import { PAID_BY, daysUntil, fmtDate, money } from "../constants.js";
import { PaymentModal } from "./modals.jsx";
import { Empty, ErrorBox, Loading, PageHead, confirmDelete, toastErr, useLoader } from "./ui.jsx";

export default function Payments() {
  const [status, setStatus] = useState("all");
  const { data, loading, error, reload } = useLoader(() => fetchPayments(status), [status]);
  const [modal, setModal] = useState(null);

  const summary = useMemo(() => {
    const s = { unpaid: 0, overdue: 0, soon: 0, paid: 0 };
    (data || []).forEach((p) => {
      if (p.paid_date) { s.paid += p.amount; return; }
      s.unpaid += p.amount;
      const d = daysUntil(p.due_date);
      if (d !== null && d < 0) s.overdue += 1;
      else if (d !== null && d <= 14) s.soon += 1;
    });
    return s;
  }, [data]);

  // 「全部」時未付在前、已付在後，各自照應付日；後端已照應付日排好，這裡只做穩定分組
  const rows = useMemo(() => {
    const list = data || [];
    if (status !== "all") return list;
    return [...list.filter((p) => !p.paid_date), ...list.filter((p) => p.paid_date)];
  }, [data, status]);

  const close = () => setModal(null);
  const saved = () => { close(); reload(); };
  const remove = async (p) => {
    if (!(await confirmDelete(p.title))) return;
    try { await deletePayment(p.id); reload(); } catch (e) { toastErr(e); }
  };

  return (
    <div>
      <PageHead title="付款期程" sub="定金、拍攝當日、尾款…哪天該付多少一目了然"
        actions={<button className="btn btn-primary" onClick={() => setModal({ create: true })}><Plus size={15} /> 新增付款</button>} />

      <div className="stats-grid">
        <div className="stat-card"><div className="value" style={{ fontSize: 22 }}>{money(summary.unpaid)}</div><div className="label">未付合計</div></div>
        <div className="stat-card"><div className="value">{summary.overdue}<small> 筆</small></div><div className="label">已逾期</div></div>
        <div className="stat-card"><div className="value">{summary.soon}<small> 筆</small></div><div className="label">兩週內到期</div></div>
        <div className="stat-card"><div className="value" style={{ fontSize: 22 }}>{money(summary.paid)}</div><div className="label">已付合計</div></div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div className="panel-title">付款清單</div>
          <Select compact value={status} onChange={setStatus} options={[{ value: "all", label: "全部（已付留作紀錄）" }, { value: "unpaid", label: "只看未付" }, { value: "paid", label: "只看已付" }]} />
        </div>
        {loading ? <Loading /> : error ? <ErrorBox error={error} /> : data.length === 0 ? (
          <Empty>{status === "unpaid" ? "沒有未付款項" : status === "paid" ? "還沒有已付的款項" : "還沒有付款紀錄"}。分期要在「預算花費」或廠商頁面的花費項目底下新增。</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>應付日</th><th>付款</th><th>花費項目</th><th>廠商</th><th style={{ textAlign: "right" }}>金額</th><th>狀態</th><th></th></tr></thead>
              <tbody>
                {rows.map((p) => {
                  const d = daysUntil(p.due_date);
                  const overdue = !p.paid_date && d !== null && d < 0;
                  const soon = !p.paid_date && d !== null && d >= 0 && d <= 14;
                  return (
                    <tr key={p.id} className={p.paid_date ? "pay-row-paid" : undefined} style={overdue ? { background: "#fbf3f1" } : undefined}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {p.due_date ? fmtDate(p.due_date) : <span className="muted-cell">未定</span>}
                        {overdue && <div className="pill pill-no" style={{ marginTop: 3 }}>逾期 {-d} 天</div>}
                        {soon && <div className="pill pill-warn" style={{ marginTop: 3 }}>{d === 0 ? "今天" : `${d} 天後`}</div>}
                      </td>
                      <td>{p.title}{p.note && <div className="muted-cell" style={{ fontSize: 11.5 }}>{p.note}</div>}</td>
                      <td>{p.expense_title}<div className="muted-cell" style={{ fontSize: 11.5 }}>{p.category}</div></td>
                      <td>{p.vendor_id ? <Link to={`/vendors/${p.vendor_id}`}>{p.vendor_name}</Link> : <span className="muted-cell">—</span>}</td>
                      <td className="amount">{money(p.amount)}</td>
                      <td>
                        {p.paid_date
                          ? <span className="pill pill-yes">已付 {fmtDate(p.paid_date)}</span>
                          : <span className="pill pill-warn">未付</span>}
                        {(p.method || p.payer) && <div className="muted-cell" style={{ fontSize: 11.5, marginTop: 2 }}>{[p.method, PAID_BY[p.payer]].filter(Boolean).join(" · ")}</div>}
                      </td>
                      <td className="row-actions">
                        {p.paid_date
                          ? <button className="btn btn-ghost btn-sm" title="編輯 / 改回未付" onClick={() => setModal({ payment: p })}><Undo2 size={13} /></button>
                          : <button className="btn btn-ghost btn-sm" onClick={() => setModal({ payment: p, markPaid: true })}><Check size={13} /> 已付</button>}{" "}
                        <button className="btn btn-ghost btn-sm" onClick={() => setModal({ payment: p })}><Pencil size={13} /></button>{" "}
                        <button className="btn btn-ghost btn-sm" onClick={() => remove(p)}><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal?.create && <PaymentModal onClose={close} onSaved={saved} />}
      {modal?.payment && (
        <PaymentModal expenseId={modal.payment.expense_id} expenseTitle={modal.payment.expense_title} initial={modal.payment} markPaid={modal.markPaid} onClose={close} onSaved={saved} />
      )}
    </div>
  );
}
