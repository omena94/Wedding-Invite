import { useState } from "react";
import Swal from "sweetalert2";
import { Link, useSearchParams } from "react-router-dom";
import { Check, Download, Gift, History, Package, Pencil, Plus, Truck, Users } from "lucide-react";
import Select from "../components/Select.jsx";
import { fetchExpenses, fetchGifts, fetchRsvps, fetchVendors, downloadGiftCsv, importGiftGuests, updateGiftDelivery } from "../api.js";
import { fmtDate, money } from "../constants.js";
import { DeliveryForm, GiftDialog, METHODS, OrderForm, ProductForm, RecipientForm, SIDES, STATES, options, today } from "./giftForms.jsx";
import { PaymentModal, UploadModal } from "./modals.jsx";
import { Empty, ErrorBox, Field, Loading, Modal, PageHead, toastErr, toastOk, useLoader } from "./ui.jsx";

function Stat({ label, value, sub }) {
  return <div className="stat-card"><div className="value">{value}</div><div className="label">{label}</div>{sub && <div className="helper-text">{sub}</div>}</div>;
}

function RecipientCard({ r, edit, deliver, history }) {
  const inTransit = r.deliveries.some((d) => !d.void_reason && !d.received_on);
  return <article className={`panel gift-recipient${r.state === "cancelled" ? " gift-cancelled" : ""}`}>
    <div className="panel-head"><div><h2 className="panel-title">{r.name}</h2><p className="helper-text">{SIDES[r.side]}{r.owner ? ` · ${r.owner} 負責` : ""}</p></div>
      <span className={`pill ${r.state === "draft" ? "pill-warn" : r.state === "cancelled" ? "pill-no" : r.remaining === 0 ? "pill-yes" : "pill-groom"}`}>
        {r.state !== "confirmed" ? STATES[r.state] : r.remaining === 0 ? inTransit ? "配送中" : "已交付" : `尚欠 ${r.remaining} 盒`}</span></div>
    <p className="gift-attendance">{r.rsvps.length ? r.rsvps.map((g) => `${g.name}：${g.attending ? "出席" : "不出席"}`).join(" · ") : "未關聯婚宴回覆"}</p>
    <div className="gift-recipient-items">{r.items.map((i) => <div key={i.product_id}><span>{i.name}</span><span><strong>{i.quantity}</strong> 盒 <small>已交出 {i.delivered}</small></span></div>)}{!r.items.length && <p className="helper-text">款式與盒數尚未決定</p>}</div>
    <p className="helper-text">{METHODS[r.method]}{r.due_date ? ` · 預計 ${fmtDate(r.due_date)}` : ""}{r.contact_name ? ` · 聯絡人 ${r.contact_name}` : ""}</p>
    {r.phone && <a className="gift-phone" href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}>{r.phone}</a>}
    {r.missing_address && <p className="gift-warning">寄送地址尚未填妥</p>}
    {r.change_method && <p className="gift-warning">親友已回覆不出席，請確認改為寄送，或當天由家人代領。</p>}
    {r.note && <p className="gift-note">{r.note}</p>}
    <div className="gift-card-actions"><button className="btn btn-ghost btn-sm" onClick={edit}><Pencil size={14}/>編輯安排</button>
      <button className="btn btn-ghost btn-sm" onClick={history}><History size={14}/>交付紀錄 {r.deliveries.length || ""}</button>
      {r.state === "confirmed" && r.remaining > 0 && <button className="btn btn-primary btn-sm" onClick={deliver}><Truck size={14}/>登記交付</button>}</div>
  </article>;
}

function DeliveryHistory({ recipient, onClose, onSaved }) {
  const [voiding, setVoiding] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (voiding) return <GiftDialog title="作廢誤登的交付紀錄" onClose={() => setVoiding(null)} onSaved={onSaved}
    submit={() => { if (!reason.trim()) throw new Error("請填寫作廢原因"); return updateGiftDelivery(voiding.id, { version: voiding.version, void_reason: reason }); }}>
    <p>作廢後會恢復尚欠盒數，原紀錄與原因會保留。實際退件或補寄請另外登記送餅安排。</p>
    <Field label="作廢原因" required><input type="text" aria-label="作廢原因" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300}/></Field>
  </GiftDialog>;
  const receive = async (d) => {
    setBusy(true);
    try { await updateGiftDelivery(d.id, { version: d.version, received_on: today() }); onSaved(); }
    catch (e) { toastErr(e); }
    finally { setBusy(false); }
  };
  return <Modal title={`交付紀錄 — ${recipient.name}`} onClose={busy ? undefined : onClose} wide>
    {!recipient.deliveries.length ? <Empty>尚未登記交付</Empty> : recipient.deliveries.map((d) => <div key={d.id} className={`gift-history-item${d.void_reason ? " gift-cancelled" : ""}`}>
      <div className="gift-card-actions"><strong>{fmtDate(d.delivered_on)} · {METHODS[d.method]}</strong><span className={`pill ${d.void_reason ? "pill-no" : d.received_on ? "pill-yes" : "pill-warn"}`}>{d.void_reason ? "已作廢" : d.received_on ? "已收到" : "已寄出／配送中"}</span></div>
      <p>{d.items.map((i) => `${i.name} × ${i.quantity} 盒`).join("、")}</p>
      <p>收件／代領：{d.receiver}{d.handler ? ` · 經手：${d.handler}` : ""}</p>
      {d.address && <p className="gift-note">{d.address}</p>}{d.tracking && <p>單號：{d.tracking}</p>}{d.note && <p className="gift-note">{d.note}</p>}
      {d.void_reason ? <p>作廢原因：{d.void_reason}</p> : <div className="gift-card-actions">
        {!d.received_on && <button disabled={busy} className="btn btn-primary btn-sm" onClick={() => receive(d)}><Check size={14}/>確認今天已收到</button>}
        <button disabled={busy} className="btn btn-ghost btn-sm" onClick={() => { setVoiding(d); setReason(""); }}>作廢誤登紀錄</button>
      </div>}
    </div>)}
  </Modal>;
}

function OrderCard({ o, vendors, edit, payment, upload }) {
  const vendor = vendors.find((v) => v.id === o.vendor_id);
  return <article className="panel gift-order" id={`gift-order-${o.id}`}>
    <div className="panel-head"><div><h2 className="panel-title">{o.title}</h2><Link className="top-link" to={`/vendors/${o.vendor_id}`}>{vendor?.name || "廠商資料"}</Link></div><button className="btn btn-ghost btn-sm" onClick={edit}><Pencil size={14}/>編輯訂購</button></div>
    <div className="gift-order-money"><div><span>訂購總額</span><strong>{money(o.total)}</strong></div><div><span>已付</span><strong>{money(o.paid)}</strong></div><div><span>{o.balance < 0 ? "溢付待對帳" : "尚欠"}</span><strong>{money(Math.abs(o.balance))}</strong></div></div>
    {o.unscheduled > 0 && <p className="gift-warning">尚有 {money(o.unscheduled)} 未安排付款期程，已包含在尚欠金額。</p>}
    {o.scheduled > Math.max(0, o.balance) && <p className="gift-warning">未付分期超過尚欠金額，請核對付款安排。</p>}
    <div className="gift-recipient-items">{o.items.map((i) => <div key={i.product_id}><span>{i.name}</span><span>購買 {i.paid_qty} 盒 · 廠商贈 {i.gift_qty} 盒<br/><small>每盒 {money(i.unit_price)}</small></span></div>)}</div>
    <p className="helper-text">運費 {money(o.shipping)} · 其他 {money(o.other_cost)} · 折扣 {money(o.discount)}</p>
    <p className="helper-text">{o.due_date ? `預計取貨／出貨 ${fmtDate(o.due_date)}` : "取貨／出貨日期未定"}{o.received_on ? ` · 已於 ${fmtDate(o.received_on)} 到貨` : ""}</p>
    {o.note && <p className="gift-note">{o.note}</p>}
    <div className="gift-card-actions"><button className="btn btn-primary btn-sm" onClick={() => payment(null)}><Plus size={14}/>新增訂金／尾款</button><button className="btn btn-ghost btn-sm" onClick={upload}>附上報價／收據</button><Link className="btn btn-ghost btn-sm" to="/budget">查看預算</Link></div>
    {!!o.payments.length && <div className="gift-payment-list">{o.payments.map((p) => <button className="gift-payment-row" key={p.id} onClick={() => payment(p)}><span>{p.title}<small>{p.paid_date ? `已付 ${fmtDate(p.paid_date)}` : p.due_date ? `應付 ${fmtDate(p.due_date)}` : "未付，日期未定"}</small></span><strong>{money(p.amount)}</strong><Pencil size={13}/></button>)}</div>}
    {!!o.history.length && <details className="gift-history"><summary>訂購修改紀錄（{o.history.length}）</summary>{[...o.history].reverse().map((h) => <p key={h.version}>{new Date(h.at).toLocaleString("zh-TW")} · 修改前 {money(h.total)} · {h.items.map((i) => `${i.name} 購買 ${i.paid_qty}＋贈 ${i.gift_qty}`).join("、")}</p>)}</details>}
  </article>;
}

export default function Gifts() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "orders" ? "orders" : "recipients";
  const { data, loading, error, reload } = useLoader(async () => {
    const [gifts, guests, vendors, expenses] = await Promise.all([fetchGifts(), fetchRsvps(), fetchVendors(), fetchExpenses()]);
    return { ...gifts, guests, vendors, expenses };
  });
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState("");
  const [method, setMethod] = useState("");
  const [side, setSide] = useState("");
  const [filter, setFilter] = useState("active");
  const [exportType, setExportType] = useState("all");
  const close = () => setModal(null);
  const saved = () => { close(); reload(); };
  // 一鍵把還沒加入名單的賓客回覆帶進來（每戶 1 盒）；重按只補新回覆
  const importGuests = async () => {
    const pending = (data?.guests || []).filter((g) => !g.is_test && !data.recipients.some((r) => r.rsvps.some((x) => x.id === g.id)));
    if (!pending.length) { toastOk("所有賓客都已在送餅名單裡"); return; }
    const ok = await Swal.fire({ icon: "question", title: `帶入 ${pending.length} 位賓客？`,
      html: "會依賓客填的資料各建一筆送餅安排，每戶 1 盒。<br/>出席者預設婚宴當天領取，不出席者預設寄送並加註提醒補地址。<br/>已在名單裡的不會重複，之後有新回覆再按一次即可。",
      showCancelButton: true, confirmButtonText: "帶入", cancelButtonText: "取消", confirmButtonColor: "#B28F70" });
    if (!ok.isConfirmed) return;
    try {
      const r = await importGiftGuests();
      await toastOk(r.created ? `已帶入 ${r.created} 位賓客${r.product ? `（${r.product} 各 1 盒）` : "（尚無單一款式，先存為待決定）"}` : "沒有新的賓客需要帶入");
      reload();
    } catch (e) { toastErr(e); }
  };
  if (loading) return <Loading/>;
  if (error) return <><ErrorBox error={error}/><button className="btn" onClick={reload}>重新讀取</button></>;
  const { summary: s, products, recipients, orders, guests, vendors, expenses } = data;
  const filtered = recipients.filter((r) => (!method || r.method === method) && (!side || r.side === side)
    && `${r.name} ${r.phone} ${r.contact_name} ${r.owner}`.toLowerCase().includes(search.toLowerCase())
    && (filter === "all" || filter === "active" && r.state !== "cancelled" || filter === "remaining" && r.remaining > 0
      || filter === "missing" && r.missing_address || filter === "draft" && r.state === "draft" || filter === "cancelled" && r.state === "cancelled"));
  return <div className="gift-page">
    <PageHead title="喜餅" sub="把每一份心意送到，也把盒數、訂購與付款記清楚。"
      actions={tab === "recipients" ? <><button className="btn btn-primary" onClick={importGuests}><Users size={15}/>帶入所有賓客</button><button className="btn" onClick={() => setModal({ type: "recipient", fromGuest: true })}><Users size={15}/>從賓客加入</button><button className="btn" onClick={() => setModal({ type: "recipient" })}><Plus size={15}/>新增送禮對象</button></>
        : <><button className="btn" onClick={() => setModal({ type: "product" })}><Gift size={15}/>新增款式</button><button className="btn btn-primary" onClick={() => setModal({ type: "order" })}><Plus size={15}/>新增訂購</button></>}/>
    <div className="gift-tabs" role="group" aria-label="喜餅功能分頁"><button className={`btn ${tab === "recipients" ? "btn-primary" : "btn-ghost"}`} aria-pressed={tab === "recipients"} onClick={() => setParams({})}>送餅名單</button><button className={`btn ${tab === "orders" ? "btn-primary" : "btn-ghost"}`} aria-pressed={tab === "orders"} onClick={() => setParams({ tab: "orders" })}>訂購與費用</button></div>
    {tab === "recipients" ? <>
      <div className="stats-grid"><Stat label="已確認送餅" value={`${s.demand} 盒`} sub={`另有 ${s.tentative} 盒待決定`}/><Stat label="尚未交付" value={`${s.remaining} 盒`}/><Stat label="寄送缺地址" value={`${s.missing_address} 筆`}/><Stat label="喜餅需求估算" value={money(s.estimate)} sub={`${s.estimate_incomplete ? "部分款式尚無報價 · " : ""}含備用，不含運費與未確認優惠`}/></div>
      {!products.length && <div className="panel gift-intro"><Package size={25}/><div><strong>先建送禮名單，款式可以稍後決定</strong><p>不出席或未填婚宴表單的親友，都能獨立加入。已有喜餅款式時，可先設定參考價格及備用盒數。</p></div><button className="btn" onClick={() => setModal({ type: "product" })}>新增喜餅款式</button></div>}
      <div className="panel"><div className="toolbar gift-toolbar"><input type="text" aria-label="搜尋送禮對象" placeholder="姓名、電話或負責人" value={search} onChange={(e) => setSearch(e.target.value)}/>
        <Select compact aria-label="篩選交付方式" value={method} onChange={setMethod} options={[{ value: "", label: "所有交付方式" }, ...options(METHODS)]}/>
        <Select compact aria-label="篩選親友方" value={side} onChange={setSide} options={[{ value: "", label: "所有親友" }, ...options(SIDES)]}/>
        <Select compact aria-label="篩選安排進度" value={filter} onChange={setFilter} options={options({ active: "進行中的安排", remaining: "尚未交付", missing: "缺寄送地址", draft: "待決定", cancelled: "已取消", all: "全部" })}/></div>
        <div className="gift-export"><Select compact aria-label="匯出清單類型" value={exportType} onChange={setExportType} options={options({ all: "完整送餅清單", mail: "寄送清單", venue: "當天領取清單", products: "廠商款式數量" })}/><button className="btn btn-ghost btn-sm" onClick={() => downloadGiftCsv(exportType).catch(toastErr)}><Download size={14}/>匯出 CSV</button><span className="helper-text">匯出所選類型的全部已確認安排，含已交出與尚欠盒數。</span></div></div>
      {filtered.length === 0 ? <div className="panel"><Empty>{recipients.length ? "沒有符合篩選的送餅安排" : "還沒有送餅對象，從賓客加入或直接新增親友。"}</Empty></div> : <div className="gift-card-grid">{filtered.map((r) => <RecipientCard key={r.id} r={r} edit={() => setModal({ type: "recipient", initial: r })} deliver={() => setModal({ type: "delivery", recipient: r })} history={() => setModal({ type: "history", recipient: r })}/>)}</div>}
    </> : <>
      <div className="stats-grid"><Stat label="確認訂購金額" value={money(s.total)}/><Stat label="已付" value={money(s.paid)}/><Stat label="尚欠" value={money(s.balance)}/><Stat label="需求參考估算" value={money(s.estimate)} sub="含備用；未含運費與折扣"/></div>
      <div className="panel"><div className="panel-head"><h2 className="panel-title">款式與盒數</h2><span className="helper-text">已訂含廠商贈盒，不代表已到貨。</span></div>
        {!products.length ? <Empty>新增喜餅款式後，就能安排盒數與登記訂購。</Empty> : <div className="gift-products">{products.map((p) => <div className="gift-product" key={p.id}>
          <div><strong>{p.name}{!p.active && "（停用）"}</strong><p className="helper-text">{p.reference_price == null ? "尚無參考價格" : `參考每盒 ${money(p.reference_price)}`}</p></div>
          <div className="gift-product-counts"><span>需求 <b>{p.demand}</b></span><span>備用 <b>{p.reserve_qty}</b></span><span>已訂 <b>{p.supply}</b></span><span className={p.shortage ? "gift-warning" : ""}>缺口 <b>{p.shortage}</b></span></div>
          <button className="btn btn-ghost btn-sm" aria-label={`編輯款式 ${p.name}`} onClick={() => setModal({ type: "product", initial: p })}><Pencil size={14}/>編輯</button>
        </div>)}</div>}
      </div>
      {!orders.length ? <div className="panel"><Empty>確認廠商報價後新增訂購，會建立或連結一筆預算花費。付款沿用既有訂金與尾款紀錄。</Empty></div> : orders.map((o) => <OrderCard key={o.id} o={o} vendors={vendors} edit={() => setModal({ type: "order", initial: o })} payment={(p) => setModal({ type: "payment", order: o, initial: p })} upload={() => setModal({ type: "upload", order: o })}/>)}
    </>}
    {modal?.type === "product" && <ProductForm initial={modal.initial} vendors={vendors} onClose={close} onSaved={saved}/>}
    {modal?.type === "recipient" && <RecipientForm initial={modal.initial} fromGuest={modal.fromGuest} products={products} guests={guests} recipients={recipients} onClose={close} onSaved={saved}/>}
    {modal?.type === "order" && <OrderForm initial={modal.initial} products={products} vendors={vendors} expenses={expenses} orders={orders} onClose={close} onSaved={saved}/>}
    {modal?.type === "delivery" && <DeliveryForm recipient={modal.recipient} onClose={close} onSaved={saved}/>}
    {modal?.type === "history" && <DeliveryHistory recipient={modal.recipient} onClose={close} onSaved={saved}/>}
    {modal?.type === "payment" && <PaymentModal expenseId={modal.order.expense_id} expenseTitle={modal.order.title} initial={modal.initial} onClose={close} onSaved={saved}/>}
    {modal?.type === "upload" && <UploadModal vendors={vendors} defaults={{ vendor_id: modal.order.vendor_id, expense_id: modal.order.expense_id, kind: "doc" }} onClose={close} onSaved={saved}/>}
  </div>;
}
