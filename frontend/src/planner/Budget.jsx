// 花費：依類別看合約金額、已付、未付；展開看分期（2026-09-08 起不顯示預算）。
// 婚宴費用預估也放這裡（原本在賓客名單），跟錢有關的都集中在同一頁比較好找。
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Check, ChevronDown, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { deleteExpense, deletePayment, fetchExpenses } from "../api.js";
import { PAID_BY, fmtDate, money } from "../constants.js";
import { ExpenseModal, PaymentModal } from "./modals.jsx";
import { Empty, ErrorBox, Loading, Modal, PageHead, confirmDelete, toastErr, useLoader } from "./ui.jsx";
import { dueTag } from "./ui.jsx";
import BanquetPanel from "./BanquetPanel.jsx";

export default function Budget() {
  const { data, loading, error, reload } = useLoader(fetchExpenses, []);
  const [modal, setModal] = useState(null);
  const [open, setOpen] = useState({}); // expense id → 展開分期
  const [detail, setDetail] = useState(null); // 點統計卡看明細：budget / contract / paid / unpaid
  // 從行事曆點付款過來：?expense=ID&payment=ID → 展開那筆花費、捲到它、閃一下（2026-09-10）
  const [params] = useSearchParams();
  const focusExpense = Number(params.get("expense")) || null;
  const focusPayment = Number(params.get("payment")) || null;
  useEffect(() => {
    if (!data || !focusExpense) return;
    setOpen((o) => ({ ...o, [focusExpense]: true }));
    const id = setTimeout(() => {
      const el = document.getElementById(focusPayment ? `payment-${focusPayment}` : `expense-${focusExpense}`) || document.getElementById(`expense-${focusExpense}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    return () => clearTimeout(id);
  }, [data, focusExpense, focusPayment]);

  const groups = useMemo(() => {
    const m = new Map();
    (data || []).forEach((e) => {
      if (!m.has(e.category)) m.set(e.category, []);
      m.get(e.category).push(e);
    });
    // 「其他」固定排最後（2026-09-09 新人要求）
    return Array.from(m.entries()).sort((a, b) => (a[0] === "其他") - (b[0] === "其他"));
  }, [data]);

  const totals = useMemo(() => {
    // 2026-09-27 新人要求整頁都用細項加總：每筆花費的合約、未付都以底下的分期為準（見 itemsOf）
    const t = { items: 0, paid: 0, unpaid: 0, projected: 0 };
    (data || []).forEach((e) => { const v = itemsOf(e); t.items += v.total; t.paid += e.paid_total; t.unpaid += v.unpaid; t.projected += projectedOf(e); });
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
      <PageHead title="花費" sub="婚宴費用預估、每個項目的簽約金額與付款進度；展開項目可新增或標記分期付款"
        actions={<button className="btn btn-primary" onClick={() => setModal({ type: "expense" })}><Plus size={15} /> 新增花費</button>} />

      <div className="stats-grid">
        {/* 2026-09-27 新人要求只留兩張：總應支付（每筆取分期加總與合約金額較大者，婚宴用預估）與已支付 */}
        <Card label="總應支付金額" onClick={() => setDetail("projected")} value={money(totals.projected)} />
        <Card label="已支付金額" onClick={() => setDetail("paid")} value={money(totals.paid)} bar={totals.projected ? Math.round((totals.paid / totals.projected) * 100) : 0} sub={`尚欠 ${money(Math.max(0, totals.projected - totals.paid))}`} />
      </div>
      {detail && <DetailModal kind={detail} expenses={data || []} onClose={() => setDetail(null)} />}

      {/* 婚宴是系統綁定的一筆花費（類別「婚宴」）：合約金額跟著預估或簽約金額，定金尾款像其他花費一樣加分期（2026-09-10） */}
      <BanquetPanel onChanged={reload} />

      {(!data || data.length === 0) ? (
        <div className="panel"><Empty>還沒有花費項目。從「新增花費」開始。</Empty></div>
      ) : groups.map(([cat, list]) => (
        <div className="panel" key={cat}>
          <div className="panel-head">
            <div className="panel-title">{cat}</div>
            <div className="muted-cell" style={{ fontSize: 12.5 }}>合計 {money(list.reduce((a, e) => a + itemsOf(e).total, 0))} · 已付 {money(sub(list, "paid_total"))} · 未付 {money(list.reduce((a, e) => a + itemsOf(e).unpaid, 0))}</div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>項目</th><th>由誰出</th><th>支付方式</th><th>應付款日期</th><th style={{ textAlign: "right" }}>合計</th><th style={{ textAlign: "right" }}>已付</th><th style={{ textAlign: "right" }}>未付</th><th style={{ minWidth: 110 }}>進度</th><th></th></tr>
              </thead>
              <tbody>
                {list.map((e) => {
                  const it = itemsOf(e);
                  const base = it.total;
                  const pct = base ? Math.min(100, Math.round((e.paid_total / base) * 100)) : 0;
                  const isOpen = !!open[e.id];
                  return [
                    <tr key={e.id} id={`expense-${e.id}`} className={focusExpense === e.id && !focusPayment ? "row-flash" : undefined}>
                      <td>
                        <button className="pl-linkbtn" onClick={() => setOpen((o) => ({ ...o, [e.id]: !isOpen }))}>
                          <ChevronDown size={14} style={{ transition: "transform .2s", transform: isOpen ? "rotate(180deg)" : "none" }} /> <strong>{e.title}</strong>
                          <span className="muted-cell" style={{ marginLeft: 6, fontSize: 12 }}>{e.payments.length} 期</span>
                        </button>
                        {e.note && <div className="muted-cell" style={{ fontSize: 11.5, marginTop: 2, whiteSpace: "pre-wrap" }}>{e.note}</div>}
                        {e.gift_order_id && <Link className="top-link" to="/gifts?tab=orders">查看喜餅訂購</Link>}
                        {e.banquet && <span className="pill pill-bride" style={{ marginTop: 4 }}>金額跟著上方婚宴預估</span>}
                      </td>
                      <td><span className="pill pill-groom">{PAID_BY[e.paid_by]}</span></td>
                      <td className="muted-cell" style={{ whiteSpace: "nowrap" }}>{e.pay_method || "—"}</td>
                      <td className="muted-cell" style={{ whiteSpace: "nowrap" }}>{e.due_date ? <>{fmtDate(e.due_date)}{e.unpaid_total > 0 && dueTag(e.due_date) ? <span className="pill pill-warn" style={{ marginLeft: 4 }}>{dueTag(e.due_date).replace(/[（）]/g, "")}</span> : null}</> : "—"}</td>
                      <td className="amount">{it.byItems ? <>{money(base)}<div className="muted-cell" style={{ fontSize: 11 }}>{e.payments.length} 期加總</div></> : e.unsigned ? <span className="muted-cell" title="合約金額還沒填（未簽約）">{base ? money(base) : "—"}<div style={{ fontSize: 11 }}>未簽約</div></span> : money(base)}</td>
                      <td className="amount">{money(e.paid_total)}</td>
                      <td className="amount">{it.unpaid ? money(it.unpaid) : "—"}{!it.byItems && e.unscheduled_unpaid > 0 && <div className="muted-cell" style={{ fontSize: 11 }}>未排分期 {money(e.unscheduled_unpaid)}</div>}{!it.byItems && e.overpaid_total > 0 && <div className="pill pill-warn">溢付 {money(e.overpaid_total)}</div>}</td>
                      <td><div className="bar-track" style={{ marginTop: 0 }}><div className="bar-fill" style={{ width: `${pct}%` }} /></div><div className="muted-cell" style={{ fontSize: 11 }}>{pct}%</div></td>
                      <td className="row-actions">
                        <button className="btn btn-ghost btn-sm" title="新增付款" onClick={() => setModal({ type: "payment", expense: e })}><Plus size={13} /></button>{" "}
                        <button className="btn btn-ghost btn-sm" title="編輯" onClick={() => setModal({ type: "expense", expense: e })}><Pencil size={13} /></button>{" "}
                        {!e.gift_order_id && !e.banquet && <button className="btn btn-ghost btn-sm" title="刪除" onClick={() => act(() => deleteExpense(e.id), e.title)}><Trash2 size={13} /></button>}
                      </td>
                    </tr>,
                    isOpen && (
                      <tr key={`${e.id}-p`} className="pl-subrow">
                        <td colSpan={11}>
                          {e.payments.length === 0 ? <span className="muted-cell">還沒有分期，按「+」新增定金、尾款等付款</span> : (
                            <table style={{ minWidth: 0 }}>
                              <tbody>
                                {e.payments.map((p) => (
                                  <tr key={p.id} id={`payment-${p.id}`} className={focusPayment === p.id ? "row-flash" : undefined}>
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

      {modal?.type === "expense" && <ExpenseModal initial={modal.expense} onClose={close} onSaved={saved} />}
      {modal?.type === "payment" && (
        <PaymentModal expenseId={modal.expense.id} expenseTitle={modal.expense.title} initial={modal.payment} markPaid={modal.markPaid} onClose={close} onSaved={saved} />
      )}
    </div>
  );
}

// 2026-09-27 花費頁一律用分期細項算：有分期的花費，合約＝所有分期加總、未付＝未付分期加總；
// 還沒加分期的（例如婚宴預估）才退回用合約金額與後端算的未付
export function itemsOf(e) {
  const ps = e.payments || [];
  if (!ps.length) return { total: e.effective_contract ?? e.contract_amount, unpaid: e.unpaid_total, byItems: false };
  const total = ps.reduce((a, p) => a + (p.amount || 0), 0);
  return { total, unpaid: ps.filter((p) => !p.paid_date).reduce((a, p) => a + (p.amount || 0), 0), byItems: true };
}

// 這筆最後大概要花多少：分期加總與合約金額（未簽約用已付＋已排、婚宴用預估或簽約金額）取大者
export function projectedOf(e) {
  return Math.max(itemsOf(e).total || 0, e.effective_contract ?? e.contract_amount ?? 0);
}

// 統計卡明細（2026-09-08 新人要求）：點卡片列出是哪些項目加出來的
const DETAIL = {
  projected: { title: "總應支付金額明細", rows: (list) => list.filter((e) => projectedOf(e) > 0).map((e) => { const it = itemsOf(e); const c = e.effective_contract ?? e.contract_amount ?? 0; return [e.title, it.byItems && it.total >= c ? `${e.payments.length} 期分期加總` : e.banquet ? "婚宴預估／簽約金額（分期還沒加滿）" : e.unsigned ? "未簽約，以已付＋已排計" : "合約金額（分期還沒加滿）", projectedOf(e)]; }) },
  contract: { title: "實際合計明細（分期細項）", rows: (list) => list.flatMap((e) => (e.payments || []).length ? e.payments.map((p) => [e.title, `${p.title} · ${p.paid_date ? `已付 ${fmtDate(p.paid_date)}` : p.due_date ? `未付，應付 ${fmtDate(p.due_date)}` : "未付"}`, p.amount]) : ((e.effective_contract ?? e.contract_amount) > 0 ? [[e.title, "還沒加分期，依合約金額算", e.effective_contract ?? e.contract_amount]] : [])) },
  paid: { title: "已支付明細", rows: (list) => list.flatMap((e) => e.payments.filter((p) => p.paid_date).map((p) => [e.title, `${p.title} · ${fmtDate(p.paid_date)}${p.method ? ` · ${p.method}` : ""}`, p.amount])) },
  unpaid: { title: "尚欠明細（未付分期）", rows: (list) => list.flatMap((e) => (e.payments || []).length ? e.payments.filter((p) => !p.paid_date).map((p) => [e.title, `${p.title}${p.due_date ? ` · 應付 ${fmtDate(p.due_date)}` : ""}`, p.amount]) : (e.unpaid_total > 0 ? [[e.title, "還沒加分期，依合約金額算", e.unpaid_total]] : [])) },
};
function DetailModal({ kind, expenses, onClose }) {
  const def = DETAIL[kind];
  const rows = def.rows(expenses);
  const total = rows.reduce((a, r) => a + r[2], 0);
  return (
    <Modal title={def.title} onClose={onClose} wide>
      {rows.length === 0 ? <Empty>目前沒有資料</Empty> : (
        <div className="table-wrap"><table style={{ minWidth: 0 }}>
          <thead><tr><th>項目</th><th>說明</th><th style={{ textAlign: "right" }}>金額</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}><td>{r[0]}</td><td className="muted-cell">{r[1]}</td><td className="amount">{money(r[2])}</td></tr>)}
            <tr><td colSpan={2}><strong>合計</strong></td><td className="amount"><strong>{money(total)}</strong></td></tr></tbody>
        </table></div>
      )}
    </Modal>
  );
}

function Card({ label, value, sub, bar, onClick }) {
  return (
    <div className={`stat-card${onClick ? " stat-card-click" : ""}`} onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}>
      <div className="value" style={{ fontSize: 22 }}>{value}</div>
      <div className="label">{label}{sub ? ` · ${sub}` : ""}</div>
      {bar !== undefined && <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(100, bar)}%` }} /></div>}
    </div>
  );
}
