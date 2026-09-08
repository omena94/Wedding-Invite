import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import Select from "../components/Select.jsx";
import DatePicker from "../components/DatePicker.jsx";
import { Checkbox } from "../components/Toggle.jsx";
import { createGiftDelivery, saveGiftOrder, saveGiftProduct, saveGiftRecipient } from "../api.js";
import { money } from "../constants.js";
import { Field, Modal, NumberInput, toInt } from "./ui.jsx";

export const METHODS = { venue: "婚禮領取", mail: "寄送" }; // 2026-09-08 新人決定只用這兩種
export const PLAN_METHODS = { tbd: "尚未決定", ...METHODS }; // 送餅安排可先不決定（帶入賓客時不預設）
export const SIDES = { groom: "男方親友", bride: "女方親友", other: "其他／共同親友" };
export const STATES = { confirmed: "已確認送餅", draft: "待決定", cancelled: "已取消" };
export const options = (map) => Object.entries(map).map(([value, label]) => ({ value, label }));
export const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(new Date());

function useForm(initial) {
  const [f, setF] = useState(initial);
  return [f, (key, value) => setF((old) => ({ ...old, [key]: value })), setF];
}

export function GiftDialog({ title, onClose, onSaved, submit, children, label = "儲存", wide = true }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try { const result = await submit(); onSaved(result); }
    catch (e) { setError(e.message || "儲存失敗，請重試"); }
    finally { setBusy(false); }
  };
  return <Modal title={title} wide={wide} onClose={busy ? undefined : onClose}
    footer={<><button className="btn btn-ghost" disabled={busy} onClick={onClose}>取消</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "儲存中…" : label}</button></>}>
    <fieldset className="gift-form-fields" disabled={busy}>{children}</fieldset>
    {error && <p className="gift-error" role="alert">{error}</p>}
  </Modal>;
}

function TextField({ label, value, onChange, placeholder, required, area = false }) {
  return <Field label={label} required={required}>{area
    ? <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} rows={2} maxLength={1000} placeholder={placeholder}/>
    : <input type="text" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} maxLength={300}/>}</Field>;
}

export function ProductForm({ initial, vendors, onClose, onSaved }) {
  const [f, set] = useForm(initial || { name: "", vendor_id: "", reference_price: "", reserve_qty: 0, active: true, version: 1 });
  return <GiftDialog title={initial ? "編輯喜餅款式" : "新增喜餅款式"} onClose={onClose} onSaved={onSaved}
    submit={() => saveGiftProduct(initial?.id, { name: f.name, vendor_id: f.vendor_id ? Number(f.vendor_id) : null,
      reference_price: f.reference_price === "" || f.reference_price == null ? null : toInt(f.reference_price), reserve_qty: toInt(f.reserve_qty), active: f.active, version: f.version })}>
    <TextField label="款式名稱" value={f.name} onChange={(v) => set("name", v)} required placeholder="例如：經典綜合禮盒"/>
    <Field label="廠商"><Select aria-label="款式廠商" value={f.vendor_id || ""} onChange={(v) => set("vendor_id", v)} options={[{ value: "", label: "尚未決定" }, ...vendors.map((v) => ({ value: v.id, label: v.name }))]}/></Field>
    <div className="grid-2"><Field label="參考單價（元）" hint="尚未報價可留空；不會改動已下訂價格"><NumberInput aria-label="參考單價" value={f.reference_price} onChange={(v) => set("reference_price", v)} placeholder="尚未報價"/></Field>
      <Field label="備用盒數"><NumberInput aria-label="備用盒數" value={f.reserve_qty} onChange={(v) => set("reserve_qty", v)}/></Field></div>
    {initial && <Checkbox checked={f.active} onChange={(v) => set("active", v)}>新增安排時顯示這個款式</Checkbox>}
  </GiftDialog>;
}

function ProductLines({ items, onChange, products, order = false }) {
  const update = (index, key, value) => onChange(items.map((item, i) => i === index ? { ...item, [key]: value } : item));
  return <div className="gift-lines">
    {items.map((item, i) => <div className="gift-line" key={i}>
      <Field label={`款式 ${i + 1}`}><Select aria-label={`款式 ${i + 1}`} value={item.product_id} onChange={(v) => {
        const p = products.find((x) => x.id === Number(v));
        onChange(items.map((x, j) => j === i ? { ...x, product_id: Number(v), ...(order ? { unit_price: p?.reference_price ?? "" } : {}) } : x));
      }} options={[{ value: "", label: "請選款式" }, ...products.filter((p) => p.active || p.id === Number(item.product_id)).map((p) => ({ value: p.id, label: p.name }))]}/></Field>
      {order ? <div className="gift-line-numbers">
        <Field label="購買盒數"><NumberInput aria-label={`購買盒數 ${i + 1}`} value={item.paid_qty} onChange={(v) => update(i, "paid_qty", v)}/></Field>
        <Field label="廠商贈盒"><NumberInput aria-label={`廠商贈盒 ${i + 1}`} value={item.gift_qty} onChange={(v) => update(i, "gift_qty", v)}/></Field>
        <Field label="成交單價"><NumberInput aria-label={`成交單價 ${i + 1}`} value={item.unit_price} onChange={(v) => update(i, "unit_price", v)} placeholder="請填成交價"/></Field>
      </div> : <Field label="送餅盒數"><NumberInput aria-label={`送餅盒數 ${i + 1}`} value={item.quantity} onChange={(v) => update(i, "quantity", v)}/></Field>}
      <button type="button" className="btn btn-ghost btn-sm" aria-label={`移除款式 ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 size={15}/></button>
    </div>)}
    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...items, { product_id: "", ...(order ? { paid_qty: 1, gift_qty: 0, unit_price: "" } : { quantity: 1 }) }])}><Plus size={14}/>加入一款</button>
  </div>;
}

export function RecipientForm({ initial, fromGuest = false, products, guests, recipients, onClose, onSaved }) {
  const [f, set, setF] = useForm(() => ({ request_key: crypto.randomUUID(), name: "", kind: "household", side: "other", contact_name: "", phone: "", address: "", owner: "", method: "tbd", state: products.some((p) => p.active) ? "confirmed" : "draft", due_date: "", note: "", version: 1,
    ...(initial || {}), rsvp_ids: initial?.rsvps.map((r) => r.id) || [],
    items: initial?.items.map(({ product_id, quantity }) => ({ product_id, quantity })) || (products.filter((p) => p.active).length === 1 ? [{ product_id: products.find((p) => p.active).id, quantity: 1 }] : []) }));
  const [search, setSearch] = useState("");
  const [showGuests, setShowGuests] = useState(fromGuest || !!initial?.rsvps.length);
  const linked = new Set(recipients.filter((r) => r.id !== initial?.id).flatMap((r) => r.rsvps.map((g) => g.id)));
  const toggleGuest = (g, checked) => setF((old) => ({ ...old,
    rsvp_ids: checked ? [...old.rsvp_ids, g.id] : old.rsvp_ids.filter((id) => id !== g.id),
    ...(checked && !old.name ? { name: g.name, contact_name: g.name, phone: g.phone, side: g.side } : {}) }));
  const duplicates = recipients.filter((r) => r.id !== initial?.id && (r.name.trim() === f.name.trim() || (f.phone.trim() && r.phone.replace(/\D/g, "") === f.phone.replace(/\D/g, ""))));
  return <GiftDialog title={initial ? "編輯送餅安排" : fromGuest ? "從賓客加入送餅名單" : "新增送禮對象"} onClose={onClose} onSaved={onSaved}
    submit={() => saveGiftRecipient(initial?.id, { request_key: f.request_key, version: f.version, name: f.name, kind: f.kind, side: f.side, contact_name: f.contact_name, phone: f.phone, address: f.address, owner: f.owner,
      method: f.method, state: f.state, due_date: f.due_date || null, note: f.note, rsvp_ids: f.rsvp_ids, items: f.items.map((i) => ({ product_id: Number(i.product_id), quantity: toInt(i.quantity) })) })}>
    <p className="helper-text">以一人、一戶或一個部門登記，不影響婚宴人數。盒數由你指定。</p>
    <button className="btn btn-ghost btn-sm" type="button" onClick={() => setShowGuests(!showGuests)}>{showGuests ? "收合婚宴回覆" : "連結既有婚宴回覆（選填）"}</button>
    {showGuests && <div className="gift-guest-picker"><input type="text" aria-label="搜尋婚宴回覆" placeholder="搜尋姓名或電話" value={search} onChange={(e) => setSearch(e.target.value)}/>
      <p className="helper-text">同一戶有多筆回覆可一起勾選；這些回覆共用下方一份送餅安排。</p>
      <div className="gift-guest-list">{guests.filter((g) => !g.is_test && !linked.has(g.id) && `${g.name} ${g.phone}`.includes(search)).map((g) => <Checkbox key={g.id} checked={f.rsvp_ids.includes(g.id)} onChange={(v) => toggleGuest(g, v)}>{g.name} · {g.attending ? "出席" : "不出席"}{g.phone ? ` · ${g.phone}` : ""}</Checkbox>)}</div>
    </div>}
    <div className="grid-2"><TextField label="送禮對象" value={f.name} onChange={(v) => set("name", v)} required placeholder="例如：台中的阿姨、公司行政部"/>
      <Field label="對象類型"><Select aria-label="對象類型" value={f.kind} onChange={(v) => set("kind", v)} options={options({ household: "家庭", person: "個人", group: "公司／團體" })}/></Field></div>
    {duplicates.length > 0 && <p className="gift-warning">名單已有相同姓名或電話：{duplicates.map((r) => r.name).join("、")}。請確認是否為同一戶，系統不會自動合併。</p>}
    <div className="grid-2"><Field label="親友方"><Select aria-label="親友方" value={f.side} onChange={(v) => set("side", v)} options={options(SIDES)}/></Field>
      <TextField label="負責人" value={f.owner} onChange={(v) => set("owner", v)} placeholder="例如：孟庭、媽媽"/></div>
    <ProductLines products={products} items={f.items} onChange={(v) => set("items", v)}/>
    {!products.length && <p className="gift-warning">尚無喜餅款式，可先儲存為「待決定」，再到訂購分頁新增款式。</p>}
    <div className="grid-2"><Field label="領取方式"><Select aria-label="領取方式" value={f.method} onChange={(v) => set("method", v)} options={options(PLAN_METHODS)}/></Field>
      <Field label="預計交付日期"><DatePicker value={f.due_date || ""} onChange={(v) => set("due_date", v)} placeholder="尚未決定"/></Field></div>
    <div className="grid-2"><TextField label="聯絡／收件人" value={f.contact_name} onChange={(v) => set("contact_name", v)}/><TextField label="電話" value={f.phone} onChange={(v) => set("phone", v)}/></div>
    <TextField label="收件地址" value={f.address} onChange={(v) => set("address", v)} placeholder="寄送可稍後補，寄出前需填妥"/>
    <Field label="安排狀態"><Select aria-label="安排狀態" value={f.state} onChange={(v) => set("state", v)} options={options(STATES)}/></Field>
    <TextField label="備註" value={f.note} onChange={(v) => set("note", v)} area/>
  </GiftDialog>;
}

export function DeliveryForm({ recipient, onClose, onSaved }) {
  const [f, set] = useForm(() => ({ request_key: crypto.randomUUID(), version: recipient.version, method: METHODS[recipient.method] ? recipient.method : "",
    receiver: recipient.contact_name || recipient.name, handler: recipient.owner, address: recipient.address, tracking: "", note: "", delivered_on: today(),
    items: recipient.items.filter((i) => i.remaining > 0).map((i) => ({ product_id: i.product_id, quantity: i.remaining, name: i.name, remaining: i.remaining })) }));
  return <GiftDialog title={`登記交付 — ${recipient.name}`} onClose={onClose} onSaved={onSaved} label={f.method === "mail" ? "確認已寄出" : "確認已交付"}
    submit={() => createGiftDelivery(recipient.id, { ...f, items: f.items.filter((i) => toInt(i.quantity) > 0).map((i) => ({ product_id: i.product_id, quantity: toInt(i.quantity) })) })}>
    {f.items.map((item, index) => <Field key={item.product_id} label={`${item.name}（尚欠 ${item.remaining} 盒）`}><NumberInput aria-label={`${item.name} 本次盒數`} value={item.quantity} onChange={(v) => set("items", f.items.map((x, i) => i === index ? { ...x, quantity: v } : x))}/></Field>)}
    <p className="helper-text">填本次實際交出的盒數；這次沒有交付的款式填 0。</p>
    <div className="grid-2"><Field label="本次領取方式" required><Select aria-label="本次領取方式" value={f.method} onChange={(v) => set("method", v)} options={options(METHODS)} placeholder="請選擇"/></Field>
      <Field label="交付／寄出日期"><DatePicker value={f.delivered_on} onChange={(v) => set("delivered_on", v)}/></Field></div>
    <div className="grid-2"><TextField label="實際收件／代領人" value={f.receiver} onChange={(v) => set("receiver", v)} required/><TextField label="經手人" value={f.handler} onChange={(v) => set("handler", v)}/></div>
    {f.method === "mail" && <><TextField label="本次收件地址" value={f.address} onChange={(v) => set("address", v)} required/><TextField label="寄送單號" value={f.tracking} onChange={(v) => set("tracking", v)}/></>}
    <TextField label="交付備註" value={f.note} onChange={(v) => set("note", v)} placeholder="例如：由媽媽代領、廠商直接寄送"/>
  </GiftDialog>;
}

export function OrderForm({ initial, products, vendors, expenses, orders, onClose, onSaved }) {
  const [f, set, setF] = useForm(() => ({ request_key: crypto.randomUUID(), version: 1, vendor_id: "", expense_id: "", title: "喜餅訂購", shipping: 0, other_cost: 0, discount: 0, budget_amount: 0, due_date: "", received_on: "", note: "", ...(initial || {}),
    items: initial?.items.map(({ product_id, paid_qty, gift_qty, unit_price }) => ({ product_id, paid_qty, gift_qty, unit_price })) || [] }));
  const used = new Set(orders.filter((o) => o.id !== initial?.id).map((o) => o.expense_id));
  const available = expenses.filter((e) => !used.has(e.id) && (!e.vendor_id || e.vendor_id === Number(f.vendor_id)));
  const total = f.items.reduce((sum, i) => sum + toInt(i.paid_qty) * toInt(i.unit_price), 0) + toInt(f.shipping) + toInt(f.other_cost) - toInt(f.discount);
  return <GiftDialog title={initial ? "編輯喜餅訂購" : "新增喜餅訂購"} onClose={onClose} onSaved={onSaved} label={initial ? "更新訂購與花費" : "確認訂購並記帳"}
    submit={() => {
      if (f.items.some((i) => i.unit_price === "")) throw new Error("請填各款成交單價；免費項目請明確填 0");
      return saveGiftOrder(initial?.id, { request_key: f.request_key, version: f.version, vendor_id: Number(f.vendor_id), expense_id: f.expense_id ? Number(f.expense_id) : null,
        title: f.title, items: f.items.map((i) => ({ product_id: Number(i.product_id), paid_qty: toInt(i.paid_qty), gift_qty: toInt(i.gift_qty), unit_price: toInt(i.unit_price) })),
        shipping: toInt(f.shipping), other_cost: toInt(f.other_cost), discount: toInt(f.discount), budget_amount: toInt(f.budget_amount), due_date: f.due_date || null, received_on: f.received_on || null, note: f.note });
    }}>
    <TextField label="訂購名稱" value={f.title} onChange={(v) => set("title", v)} required/>
    <Field label="訂購廠商" required><Select aria-label="訂購廠商" disabled={!!initial} value={f.vendor_id} onChange={(v) => setF((old) => ({ ...old, vendor_id: v, expense_id: "" }))} options={[{ value: "", label: "請選廠商" }, ...vendors.map((v) => ({ value: v.id, label: v.name }))]}/></Field>
    {!vendors.length && <p className="gift-warning">請先到「廠商」新增喜餅廠商，再回來記錄訂購。</p>}
    <ProductLines order products={products.filter((p) => !p.vendor_id || p.vendor_id === Number(f.vendor_id) || f.items.some((i) => i.product_id === p.id))} items={f.items} onChange={(v) => set("items", v)}/>
    <div className="gift-line-numbers"><Field label="本訂購運費"><NumberInput aria-label="本訂購運費" value={f.shipping} onChange={(v) => set("shipping", v)}/></Field>
      <Field label="其他費用"><NumberInput aria-label="其他費用" value={f.other_cost} onChange={(v) => set("other_cost", v)}/></Field>
      <Field label="額外折扣"><NumberInput aria-label="額外折扣" value={f.discount} onChange={(v) => set("discount", v)}/></Field></div>
    <p className="gift-order-total">訂購總額 <strong>{money(total)}</strong></p>
    <p className="helper-text">廠商贈盒不收貨款。已包含在報價中的運費不要再加一次。</p>
    {!initial && <Field label="預算花費" hint="已記過喜餅訂金時，請連結原花費；廠商與合約金額須一致。"><Select aria-label="連結預算花費" value={f.expense_id} onChange={(v) => set("expense_id", v)} options={[{ value: "", label: "建立一筆新的喜餅花費" }, ...available.map((e) => ({ value: e.id, label: `${e.title} · ${money(e.contract_amount)}` }))]}/></Field>}
    {!initial && !f.expense_id && <Field label="這筆花費的預算"><NumberInput aria-label="這筆花費的預算" value={f.budget_amount} onChange={(v) => set("budget_amount", v)}/></Field>}
    <div className="grid-2"><Field label="預計取貨／出貨日"><DatePicker value={f.due_date || ""} onChange={(v) => set("due_date", v)}/></Field>
      <Field label="實際到貨日" hint="廠商直送親友可留空"><DatePicker value={f.received_on || ""} onChange={(v) => set("received_on", v)}/></Field></div>
    <TextField label="訂購備註" value={f.note} onChange={(v) => set("note", v)} area placeholder="訂單編號、分批到貨或修改原因"/>
  </GiftDialog>;
}
