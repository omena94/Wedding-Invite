import { useState } from "react";
import Swal from "sweetalert2";
import { Link, useSearchParams } from "react-router-dom";
import { Check, ExternalLink, History, Pencil, Plus, Store, Trash2, Truck, Users } from "lucide-react";
import Select from "../components/Select.jsx";
import Toggle from "../components/Toggle.jsx";
import { usePlanner } from "./context.js";
import { createGiftDelivery, deleteGiftProduct, deleteGiftRecipient, deleteGiftVendor, fetchExpenses, fetchGifts, fetchRsvps, importGiftGuests, saveGiftRecipient, updateGiftDelivery } from "../api.js";
import { fmtDate, money } from "../constants.js";
import { DeliveryForm, GiftDialog, METHODS, OrderForm, ProductForm, RecipientForm, SIDES, VendorForm, options, today } from "./giftForms.jsx";
import { PaymentModal, UploadModal } from "./modals.jsx";
import { Empty, ErrorBox, Field, Loading, Modal, PageHead, confirmDelete, toInt, toastErr, toastOk, useLoader } from "./ui.jsx";

function Stat({ label, value, sub }) {
  return <div className="stat-card"><div className="value">{value}</div><div className="label">{label}</div>{sub && <div className="helper-text">{sub}</div>}</div>;
}

// 送餅名單改為清單條列（2026-09-08 依新人要求），一列一位對象；細節仍在「編輯安排」與「交付紀錄」
function RecipientRow({ r, edit, deliver, history, onMethod, onPickup, onRemove, canManage }) {
  const inTransit = r.deliveries.some((d) => !d.void_reason && !d.received_on);
  // 「已領取」開關：已全部交出就鎖住（確認後不能再改）；要送且尚欠才能勾
  const picked = r.state === "confirmed" && r.items.length > 0 && r.remaining === 0;
  const canPick = r.state === "confirmed" && r.remaining > 0;
  const total = r.items.reduce((a, i) => a + i.quantity, 0), delivered = r.items.reduce((a, i) => a + i.delivered, 0);
  // 誰拿了幾盒（作廢的不算），幫手在現場也看得到
  const takers = r.deliveries.filter((d) => !d.void_reason).map((d) => `${d.receiver} ${d.items.reduce((a, i) => a + i.quantity, 0)} 盒`).join("、");
  return <tr className={r.state === "cancelled" ? "gift-cancelled" : undefined}>
    <td className="gift-pickup-cell"><div><Toggle checked={picked} disabled={!canPick} onChange={(v) => v && onPickup(r)} label={`${r.name} 簽收確認`}/>{picked ? <span className="gift-signed">已簽收</span> : delivered > 0 && <span className="gift-signed">已領 {delivered}/{total}</span>}</div></td>
    <td><strong>{r.name}</strong><div className="muted-cell" style={{ fontSize: 11.5 }}>{SIDES[r.side]}{r.owner ? ` · ${r.owner} 負責` : ""}</div>
      {/* 2026-09-08 進度欄移除：只留還有用的提醒與「誰拿了幾盒」，放在姓名下方 */}
      {r.state === "draft" && <span className="pill pill-warn gift-mini-pill">待決定</span>}
      {r.state === "confirmed" && r.method === "mail" && inTransit && <span className="pill pill-warn gift-mini-pill">配送中</span>}
      {r.state === "confirmed" && r.method === "tbd" && r.remaining > 0 && <span className="gift-warning gift-warning-inline">領取方式未定</span>}
      {r.missing_address && <span className="gift-warning gift-warning-inline">缺寄送地址</span>}
      {r.change_method && <span className="gift-warning gift-warning-inline">已回覆不出席，請改寄送或家人代領</span>}
      {takers && <div className="muted-cell" style={{ fontSize: 11.5, marginTop: 3 }}>{takers}</div>}</td>
    <td>{r.items.length ? r.items.map((i) => <div key={i.product_id}><strong>{i.quantity}</strong> 盒{i.delivered > 0 && <span className="muted-cell gift-given" style={{ fontSize: 11.5 }}>（已給 {i.delivered}）</span>}</div>) : <span className="muted-cell">未定</span>}</td>
    <td className="gift-method-cell">{canManage ? <Select compact portal aria-label={`${r.name} 領取方式`} value={r.state === "cancelled" ? "none" : METHODS[r.method] ? r.method : ""} placeholder="尚未決定" options={[...options(METHODS), { value: "none", label: "不送喜餅" }]} onChange={(v) => onMethod(r, v)}/> : (r.state === "cancelled" ? "不送喜餅" : METHODS[r.method] || "尚未決定")}{r.due_date && <div className="muted-cell" style={{ fontSize: 11.5 }}>預計 {fmtDate(r.due_date)}</div>}{r.contact_name && r.contact_name !== r.name && <div className="muted-cell" style={{ fontSize: 11.5 }}>聯絡人 {r.contact_name}</div>}</td>
    <td>{r.phone ? <a className="gift-phone" href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}>{r.phone}</a> : <span className="muted-cell">—</span>}</td>
    <td className="row-actions">{canManage && <>
      <button className="btn btn-ghost btn-sm" onClick={edit}><Pencil size={13}/> 編輯</button>{" "}
      <button className="btn btn-ghost btn-sm" onClick={history}><History size={13}/> 紀錄{r.deliveries.length ? ` ${r.deliveries.length}` : ""}</button>{" "}
      {r.state === "confirmed" && r.remaining > 0 && r.method === "mail" && <button className="btn btn-primary btn-sm" onClick={deliver}><Truck size={13}/> 登記寄出</button>}{" "}
      <button className="btn btn-ghost btn-sm" onClick={onRemove}><Trash2 size={13}/> 刪除</button>
    </>}</td>
  </tr>;
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

// 喜餅廠商卡片（2026-09-22）：名稱、聯絡方式、注意事項（可收合），旁邊列這家的款式與訂購數
// 一款喜餅（列在廠商卡片裡）：名稱、參考價、需求／備用／已訂／缺口、編輯與刪除
function ProductRow({ p, edit, remove }) {
  return <div className="gift-product" key={p.id}>
    <div><strong>{p.name}{!p.active && "（停用）"}</strong><p className="helper-text">{p.reference_price == null ? "尚無參考價格" : `參考每盒 ${money(p.reference_price)}`}</p></div>
    <div className="gift-product-counts"><span>需求 <b>{p.demand}</b></span><span>備用 <b>{p.reserve_qty}</b></span><span>已訂 <b>{p.supply}</b></span><span className={p.shortage ? "gift-warning" : ""}>缺口 <b>{p.shortage}</b></span></div>
    <span className="gift-vendor-actions"><button className="btn btn-ghost btn-sm" aria-label={`編輯款式 ${p.name}`} onClick={edit}><Pencil size={14}/>編輯</button><button className="btn btn-ghost btn-sm" aria-label={`刪除款式 ${p.name}`} title={p.supply > 0 ? "已有訂購記到這款，不能刪（要保留對帳）；可在編輯裡停用" : "刪除這個款式"} disabled={p.supply > 0} onClick={remove}><Trash2 size={14}/></button></span>
  </div>;
}

// 喜餅廠商卡片：資料、注意事項，以及這家的款式（2026-09-27 新人要求款式跟廠商合併在一起）
function VendorCard({ v, products, orders, edit, remove, addProduct, editProduct, removeProduct }) {
  const mine = products.filter((p) => p.vendor_id === v.id);
  const count = orders.filter((o) => o.vendor_id === v.id).length;
  const site = v.website && !/^https?:\/\//i.test(v.website) ? `https://${v.website}` : v.website;
  return <article className="gift-vendor">
    <div className="gift-vendor-head">
      <div><strong>{v.name}</strong><div className="muted-cell gift-vendor-meta">
        {v.contact_name && <span>{v.contact_name}</span>}{v.phone && <a className="gift-phone" href={`tel:${v.phone.replace(/[^\d+]/g, "")}`}>{v.phone}</a>}{v.line_id && <span>LINE {v.line_id}</span>}
        {site && <a className="gift-phone" href={site} target="_blank" rel="noopener">官網 <ExternalLink size={11}/></a>}
        {count > 0 && <span>訂購 {count} 筆</span>}
      </div></div>
      <div className="gift-vendor-actions"><button className="btn btn-ghost btn-sm" onClick={edit}><Pencil size={13}/> 編輯</button><button className="btn btn-ghost btn-sm" onClick={remove} disabled={mine.length > 0 || count > 0} title={mine.length || count ? "有款式或訂購的廠商不能刪" : undefined}><Trash2 size={13}/></button></div>
    </div>
    {v.note ? <details className="gift-vendor-note"><summary>注意事項</summary><div className="gift-note">{v.note}</div></details> : <p className="helper-text">還沒有注意事項，按「編輯」可以把廠商的訂購規則貼進來。</p>}
    <div className="gift-vendor-products">
      <div className="gift-vendor-products-head"><span>款式與盒數</span><span className="helper-text">已訂含贈盒，不代表已到貨。</span><button className="btn btn-ghost btn-sm" onClick={addProduct}><Plus size={13}/> 新增款式</button></div>
      {mine.length ? mine.map((p) => <ProductRow key={p.id} p={p} edit={() => editProduct(p)} remove={() => removeProduct(p)}/>) : <p className="helper-text">這家還沒有款式。</p>}
    </div>
  </article>;
}

function OrderCard({ o, edit, payment, upload }) {
  return <article className="panel gift-order" id={`gift-order-${o.id}`}>
    <div className="panel-head"><div><h2 className="panel-title">{o.title}</h2>{o.vendor_name && <span className="pill pill-groom gift-mini-pill">{o.vendor_name}</span>}</div><button className="btn btn-ghost btn-sm" onClick={edit}><Pencil size={14}/>編輯訂購</button></div>
    <div className="gift-order-money"><div><span>訂購總額</span><strong>{money(o.total)}</strong></div><div><span>已付</span><strong>{money(o.paid)}</strong></div><div><span>{o.balance < 0 ? "溢付待對帳" : "尚欠"}</span><strong>{money(Math.abs(o.balance))}</strong></div></div>
    {o.unscheduled > 0 && <p className="gift-warning">尚有 {money(o.unscheduled)} 未安排分期，已包含在尚欠金額。</p>}
    {o.scheduled > Math.max(0, o.balance) && <p className="gift-warning">未付分期超過尚欠金額，請核對付款安排。</p>}
    <div className="gift-recipient-items">{o.items.map((i) => <div key={i.product_id}><span>{i.name}</span><span>購買 {i.paid_qty} 盒 · 贈 {i.gift_qty} 盒<br/><small>每盒 {money(i.unit_price)}</small></span></div>)}</div>
    <p className="helper-text">運費 {money(o.shipping)} · 其他 {money(o.other_cost)} · 折扣 {money(o.discount)}</p>
    <p className="helper-text">{o.due_date ? `預計取貨／出貨 ${fmtDate(o.due_date)}` : "取貨／出貨日期未定"}{o.received_on ? ` · 已於 ${fmtDate(o.received_on)} 到貨` : ""}</p>
    {o.note && <p className="gift-note">{o.note}</p>}
    <div className="gift-card-actions"><button className="btn btn-primary btn-sm" onClick={() => payment(null)}><Plus size={14}/>新增訂金／尾款</button><button className="btn btn-ghost btn-sm" onClick={upload}>附上報價／收據</button><Link className="btn btn-ghost btn-sm" to="/budget">查看預算</Link></div>
    {!!o.payments.length && <div className="gift-payment-list">{o.payments.map((p) => <button className="gift-payment-row" key={p.id} onClick={() => payment(p)}><span>{p.title}<small>{p.paid_date ? `已付 ${fmtDate(p.paid_date)}` : p.due_date ? `應付 ${fmtDate(p.due_date)}` : "未付，日期未定"}</small></span><strong>{money(p.amount)}</strong><Pencil size={13}/></button>)}</div>}
    {!!o.history.length && <details className="gift-history"><summary>訂購修改紀錄（{o.history.length}）</summary>{[...o.history].reverse().map((h) => <p key={h.version}>{new Date(h.at).toLocaleString("zh-TW")} · 修改前 {money(h.total)} · {h.items.map((i) => `${i.name} 購買 ${i.paid_qty}＋贈 ${i.gift_qty}`).join("、")}</p>)}</details>}
  </article>;
}


// 簽收確認視窗：盒數大於 1 時可填本次領幾盒（分批），並選本人或他人代領；每次都會記一筆誰拿的
function PickupDialog({ recipient: r, role, onClose, onSaved }) {
  const pending = r.items.filter((i) => i.remaining > 0);
  const remaining = pending.reduce((a, i) => a + i.remaining, 0);
  const single = pending.length === 1;
  const [qty, setQty] = useState(remaining);
  const [who, setWho] = useState("self");
  const [proxy, setProxy] = useState("");
  const submit = () => {
    const n = single ? toInt(qty) : remaining;
    if (single && (n < 1 || n > remaining)) throw new Error(`本次盒數需介於 1 到 ${remaining}`);
    if (who === "proxy" && !proxy.trim()) throw new Error("請填寫代領人姓名");
    const receiver = who === "proxy" ? proxy.trim() : (r.contact_name || r.name);
    const items = pending.map((i) => ({ product_id: i.product_id, quantity: single ? n : i.remaining }));
    return createGiftDelivery(r.id, { request_key: crypto.randomUUID(), version: r.version, method: "venue", receiver, handler: role === "helper" ? "幫手" : "", address: "", tracking: "",
      note: who === "proxy" ? `他人代領：${receiver}（名單簽收確認）` : "本人領取（名單簽收確認）", delivered_on: today(), items });
  };
  return <GiftDialog title={`簽收確認 — ${r.name}`} onClose={onClose} onSaved={onSaved} submit={submit} label="確認簽收" wide={false}>
    <p className="helper-text">{remaining > 1 ? `這位共 ${remaining} 盒尚未領取，可以分批：` : ""}確認後登記為已領取，不能再修改；誤按只能由新人到「紀錄」作廢。</p>
    {remaining > 1 && single && <Field label={`本次領取盒數（尚欠 ${remaining} 盒）`}><Select aria-label="本次領取盒數" value={qty} onChange={(v) => setQty(Number(v))} options={Array.from({ length: remaining }, (_, i) => ({ value: i + 1, label: `${i + 1} 盒` }))}/></Field>}
    <Field label="由誰領取"><Select aria-label="由誰領取" value={who} onChange={setWho} options={[{ value: "self", label: "本人領取" }, { value: "proxy", label: "他人代領" }]}/></Field>
    {who === "proxy" && <Field label="代領人姓名" required><input type="text" aria-label="代領人姓名" value={proxy} onChange={(e) => setProxy(e.target.value)} placeholder="例如：王媽媽" maxLength={100}/></Field>}
  </GiftDialog>;
}

export default function Gifts() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "orders" ? "orders" : "recipients";
  const { role } = usePlanner();
  const { data, loading, error, reload } = useLoader(async () => {
    // 幫手拿不到花費（403），只載名單與賓客
    if (role === "helper") { const [gifts, guests] = await Promise.all([fetchGifts(), fetchRsvps()]); return { ...gifts, guests, expenses: [] }; }
    const [gifts, guests, expenses] = await Promise.all([fetchGifts(), fetchRsvps(), fetchExpenses()]);
    return { ...gifts, guests, expenses };
  });
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState("");
  const [method, setMethod] = useState("");
  const [side, setSide] = useState("");
  const close = () => setModal(null);
  const saved = () => { close(); reload(); };
  // 一鍵把還沒加入名單的賓客回覆帶進來（每戶 1 盒）；重按只補新回覆
  const importGuests = async () => {
    const pending = (data?.guests || []).filter((g) => !g.is_test && !data.recipients.some((r) => r.rsvps.some((x) => x.id === g.id)));
    if (!pending.length) { toastOk("所有賓客都已在送餅名單裡"); return; }
    const ok = await Swal.fire({ icon: "question", title: `帶入 ${pending.length} 位賓客？`,
      html: "會依賓客填的資料各建一筆送餅安排，每戶 1 盒。<br/>領取方式先留「尚未決定」，帶入後再逐筆選擇。<br/>已在名單裡的不會重複，之後有新回覆再按一次即可。",
      showCancelButton: true, confirmButtonText: "帶入", cancelButtonText: "取消", confirmButtonColor: "#B28F70" });
    if (!ok.isConfirmed) return;
    try {
      const r = await importGiftGuests();
      await toastOk(r.created ? `已帶入 ${r.created} 位賓客${r.product ? `（${r.product} 各 1 盒）` : "（尚無單一款式，先存為待決定）"}` : "沒有新的賓客需要帶入");
      reload();
    } catch (e) { toastErr(e); }
  };
  // 名單上的「已領取」開關：確認後登記一筆婚禮領取（剩餘盒數全交），之後不能在名單上取消
  // 簽收確認：開小視窗（盒數大於 1 可分批），每次都記一筆交付紀錄
  const confirmPickup = (r) => setModal({ type: "pickup", recipient: r });
  // 刪除送禮對象（清重複或誤建用；會連同簽收紀錄一起刪，先確認）
  const removeRecipient = async (r) => {
    if (!(await confirmDelete(`${r.name} 的送餅安排${r.deliveries.length ? "（含簽收紀錄）" : ""}`))) return;
    try { await deleteGiftRecipient(r.id); reload(); } catch (e) { toastErr(e); }
  };
  // 款式與盒數可直接增減（2026-09-22）：用到的款式後端會擋，提示改用停用
  const removeProduct = async (p) => {
    const used = recipients.filter((r) => r.items.some((i) => i.product_id === p.id));
    if (!used.length) {
      if (!(await confirmDelete(`喜餅款式「${p.name}」`))) return;
      try { await deleteGiftProduct(p.id); reload(); } catch (e) { toastErr(e); }
      return;
    }
    // 有人被安排這款：問要改成別款還是清掉盒數
    const others = products.filter((x) => x.id !== p.id);
    const r = await Swal.fire({
      icon: "warning", title: `刪除「${p.name}」？`,
      html: `送餅名單有 <b>${used.length}</b> 戶安排了這款。<br/>${others.length ? "可以把他們全部改成另一款，盒數不變；或清掉這些盒數再刪。" : "目前沒有別的款式可以換，刪除會清掉這些盒數。"}`,
      input: others.length ? "radio" : undefined, // 用 sweetalert2 的 radio，不用原生 select（開發規範）
      inputOptions: others.length ? Object.fromEntries([...others.map((x) => [String(x.id), `改成「${x.name}」`]), ["", "清掉這些盒數"]]) : undefined,
      inputValue: others.length ? String(others[0].id) : undefined,
      showCancelButton: true, confirmButtonText: "刪除", cancelButtonText: "取消", confirmButtonColor: "#9E5A54",
    });
    if (!r.isConfirmed) return;
    // 沒有別款可選時 sweetalert2 的 value 會是 true（不是選項值），一律當成「清掉盒數」
    const opts = others.length && r.value && r.value !== true ? { replace_with: Number(r.value) } : { clear_plans: true };
    try { await deleteGiftProduct(p.id, opts); reload(); } catch (e) { toastErr(e); }
  };
  const removeVendor = async (v) => {
    if (!(await confirmDelete(`喜餅廠商「${v.name}」`))) return;
    try { await deleteGiftVendor(v.id); reload(); } catch (e) { toastErr(e); }
  };
  const changeMethod = async (r, choice) => {
    const none = choice === "none";
    const method = none ? (METHODS[r.method] ? r.method : "tbd") : choice;
    // 沒有盒數的戶（例如款式刪掉後）不能直接變「要送」，先存「待決定」；有盒數才算確認要送（2026-09-27）
    const state = none ? "cancelled" : !r.items.length ? "draft" : "confirmed";
    try {
      await saveGiftRecipient(r.id, { request_key: r.request_key, version: r.version, name: r.name, kind: r.kind, side: r.side, contact_name: r.contact_name, phone: r.phone, address: r.address, owner: r.owner,
        method, state, due_date: r.due_date || null, note: r.note, rsvp_ids: r.rsvps.map((g) => g.id), items: r.items.map((i) => ({ product_id: i.product_id, quantity: i.quantity })) });
      reload();
    } catch (e) { toastErr(e); }
  };
  if (loading) return <Loading/>;
  if (error) return <><ErrorBox error={error}/><button className="btn" onClick={reload}>重新讀取</button></>;
  const { summary: s, products, recipients, orders, guests, expenses, vendors = [] } = data;
  // 篩選只留姓名搜尋與領取方式（2026-09-08 新人要求精簡，幫手現場好用）
  const filtered = recipients.filter((r) => (!method || r.method === method) && (!side || r.side === side) && `${r.name} ${r.contact_name}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="gift-page">
    <PageHead title="喜餅" sub="把每一份心意送到，也把盒數、訂購與付款記清楚。"
      actions={role === "helper" ? null : tab === "recipients" ? <><button className="btn btn-primary" onClick={importGuests}><Users size={15}/>帶入所有賓客</button><button className="btn" onClick={() => setModal({ type: "recipient" })}><Plus size={15}/>新增送餅對象</button></>
        : <><button className="btn" onClick={() => setModal({ type: "vendor" })}><Store size={15}/>新增廠商</button><button className="btn btn-primary" onClick={() => setModal({ type: "order" })}><Plus size={15}/>新增訂購</button></>}/>
    {role !== "helper" && <div className="gift-tabs" role="group" aria-label="喜餅功能分頁"><button className={`btn ${tab === "recipients" ? "btn-primary" : "btn-ghost"}`} aria-pressed={tab === "recipients"} onClick={() => setParams({})}>送餅名單</button><button className={`btn ${tab === "orders" ? "btn-primary" : "btn-ghost"}`} aria-pressed={tab === "orders"} onClick={() => setParams({ tab: "orders" })}>訂購與費用</button></div>}
    {tab === "recipients" ? <>
      <div className="stats-grid"><Stat label="已確認送餅" value={`${s.demand} 盒`} sub={`另有 ${s.tentative} 盒待決定`}/><Stat label="未給" value={`${s.remaining} 盒`}/><Stat label="寄送缺地址" value={`${s.missing_address} 筆`}/>{role !== "helper" && <Stat label="喜餅需求估算" value={money(s.estimate)} sub={`${s.estimate_incomplete ? "部分款式尚無報價 · " : ""}含備用，不含運費與未確認優惠`}/>}</div>
      <div className="panel"><div className="toolbar gift-toolbar"><input type="text" aria-label="搜尋送禮對象" placeholder="搜尋姓名" value={search} onChange={(e) => setSearch(e.target.value)}/>
        <Select compact aria-label="篩選領取方式" value={method} onChange={setMethod} options={[{ value: "", label: "全部" }, ...options(METHODS)]}/>
        <Select compact aria-label="篩選親友方" value={side} onChange={setSide} options={[{ value: "", label: "全部親友" }, ...options(SIDES)]}/>
        </div>
      </div>
      {filtered.length === 0 ? <div className="panel"><Empty>{recipients.length ? "沒有符合篩選的送餅安排" : "還沒有送餅對象，從賓客加入或直接新增親友。"}</Empty></div> : <div className="panel"><div className="table-wrap"><table className="gift-table"><thead><tr><th>簽收確認</th><th>送禮對象</th><th>盒數</th><th>領取方式</th><th>電話</th><th></th></tr></thead><tbody>{filtered.map((r) => <RecipientRow key={r.id} r={r} onMethod={changeMethod} onPickup={confirmPickup} onRemove={() => removeRecipient(r)} canManage={role !== "helper"} edit={() => setModal({ type: "recipient", initial: r })} deliver={() => setModal({ type: "delivery", recipient: r })} history={() => setModal({ type: "history", recipient: r })}/>)}</tbody></table></div></div>}
    </> : <>
      <div className="stats-grid"><Stat label="確認訂購金額" value={money(s.total)}/><Stat label="已付" value={money(s.paid)}/><Stat label="尚欠" value={money(s.balance)}/><Stat label="需求參考估算" value={money(s.estimate)} sub="含備用；未含運費與折扣"/></div>
      <div className="panel"><div className="panel-head"><h2 className="panel-title">喜餅廠商</h2><span className="helper-text">可以不只一家；每家的訂購規則放在「注意事項」。</span></div>
        {!vendors.length ? <Empty>還沒有廠商。新增廠商後，在廠商卡片上新增這家的款式。</Empty> : <div className="gift-vendors">{vendors.map((v) => <VendorCard key={v.id} v={v} products={products} orders={orders} edit={() => setModal({ type: "vendor", initial: v })} remove={() => removeVendor(v)}
          addProduct={() => setModal({ type: "product", vendorId: v.id })} editProduct={(p) => setModal({ type: "product", initial: p })} removeProduct={removeProduct}/>)}</div>}
        {/* 沒掛廠商的舊款式（或廠商被改掉的）：留一區讓新人改到某一家 */}
        {products.some((p) => !vendors.some((v) => v.id === p.vendor_id)) && <div className="gift-vendor-products" style={{ marginTop: 14 }}>
          <div className="gift-vendor-products-head"><span>未指定廠商的款式</span><span className="helper-text">按「編輯」選一家廠商，就會併到那家的卡片。</span></div>
          {products.filter((p) => !vendors.some((v) => v.id === p.vendor_id)).map((p) => <ProductRow key={p.id} p={p} edit={() => setModal({ type: "product", initial: p })} remove={() => removeProduct(p)}/>)}
        </div>}
      </div>
      {!orders.length ? <div className="panel"><Empty>報價確認後新增訂購，會建立或連結一筆花費。付款沿用既有訂金與尾款紀錄。</Empty></div> : orders.map((o) => <OrderCard key={o.id} o={o} edit={() => setModal({ type: "order", initial: o })} payment={(p) => setModal({ type: "payment", order: o, initial: p })} upload={() => setModal({ type: "upload", order: o })}/>)}
    </>}
    {modal?.type === "vendor" && <VendorForm initial={modal.initial} onClose={close} onSaved={saved}/>}
    {modal?.type === "product" && <ProductForm initial={modal.initial} vendors={vendors} defaultVendorId={modal.vendorId ?? null} onClose={close} onSaved={saved}/>}
    {modal?.type === "recipient" && <RecipientForm initial={modal.initial} products={products} recipients={recipients} onClose={close} onSaved={saved}/>}
    {modal?.type === "order" && <OrderForm initial={modal.initial} products={products} vendors={vendors} expenses={expenses} orders={orders} onClose={close} onSaved={saved}/>}
    {modal?.type === "delivery" && <DeliveryForm recipient={modal.recipient} onClose={close} onSaved={saved}/>}
    {modal?.type === "pickup" && <PickupDialog recipient={modal.recipient} role={role} onClose={close} onSaved={saved}/>}
    {modal?.type === "history" && <DeliveryHistory recipient={modal.recipient} onClose={close} onSaved={saved}/>}
    {modal?.type === "payment" && <PaymentModal expenseId={modal.order.expense_id} expenseTitle={modal.order.title} initial={modal.initial} onClose={close} onSaved={saved}/>}
    {modal?.type === "upload" && <UploadModal defaults={{ expense_id: modal.order.expense_id, kind: "doc" }} onClose={close} onSaved={saved}/>}
  </div>;
}
