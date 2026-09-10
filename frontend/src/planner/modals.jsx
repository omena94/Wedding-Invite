// 籌備後台共用的新增 / 編輯表單（彈窗）。2026-09-10 起各表單不再有「廠商」欄位（廠商功能已整個移除）
import { useEffect, useState } from "react";
import { Upload } from "lucide-react";
import Select from "../components/Select.jsx";
import DatePicker from "../components/DatePicker.jsx";
import {
  createExpense, createPayment, fetchExpenses,
  updateExpense, updateFile, updatePayment, uploadFile,
} from "../api.js";
import {
  FILE_KIND, PAID_BY, PAY_METHODS,
  fmtSize, listOptions, money, toOptions, todayISO,
} from "../constants.js";
import { useCategories } from "./categories.js";
import { Field, Modal, NumberInput, toInt, toastErr } from "./ui.jsx";

function Footer({ onClose, onSave, busy, saveLabel = "儲存" }) {
  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>取消</button>
      <button type="button" className="btn btn-primary" onClick={onSave} disabled={busy}>{busy ? "儲存中…" : saveLabel}</button>
    </>
  );
}

/* ---------- 花費項目 ---------- */
export function ExpenseModal({ initial, onClose, onSaved }) {
  const isNew = !initial?.id;
  const [f, setF] = useState({
    category: "其他", title: "", budget_amount: 0, contract_amount: 0, paid_by: "shared", note: "",
    ...(initial || {}),
  });
  const [busy, setBusy] = useState(false);
  const cats = useCategories();
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!f.title.trim()) return toastErr(new Error("請填花費項目名稱"));
    setBusy(true);
    try {
      const body = {
        category: f.category, title: f.title.trim(), budget_amount: toInt(f.budget_amount),
        contract_amount: toInt(f.contract_amount), paid_by: f.paid_by, note: f.note,
      };
      const saved = isNew ? await createExpense(body) : await updateExpense(initial.id, body);
      onSaved(saved);
    } catch (e) {
      toastErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={isNew ? "新增花費項目" : `編輯花費 — ${initial.title}`} onClose={onClose} wide
      footer={<Footer onClose={onClose} onSave={save} busy={busy} />}>
      <Field label="項目名稱" required><input type="text" disabled={!!initial?.gift_order_id} value={f.title} onChange={(e) => set("title", e.target.value)} autoFocus placeholder="例如：婚紗拍攝 9 小時三套方案" /></Field>
      <div className="form-group grid-2">
        <Field label="類別"><Select value={f.category} onChange={(v) => set("category", v)} options={cats.options} /></Field>
        <Field label="由誰出"><Select value={f.paid_by} onChange={(v) => set("paid_by", v)} options={toOptions(PAID_BY)} /></Field>
      </div>
      <div className="form-group grid-2">
        <Field label="合約 / 實際金額（元）" hint={initial?.gift_order_id ? "名稱與合約金額請到「喜餅 → 訂購與費用」修改；此處可調整付款方。" : "簽約後的總價，分期在付款期程裡填"}><NumberInput disabled={!!initial?.gift_order_id} value={f.contract_amount} onChange={(v) => set("contract_amount", v)} /></Field>
      </div>
      <Field label="備註"><textarea rows={3} value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
    </Modal>
  );
}

/* ---------- 付款 ---------- */
// expenseId 沒給的話（例如從付款期程頁新增），會多一個「花費項目」下拉讓使用者選
export function PaymentModal({ expenseId, expenseTitle, initial, onClose, onSaved, markPaid }) {
  const isNew = !initial?.id;
  const [f, setF] = useState({
    title: "", amount: 0, method: "", payer: "", note: "", sort_order: 0,
    ...(initial || {}),
    due_date: initial?.due_date || "",
    paid_date: markPaid ? (initial?.paid_date || todayISO()) : (initial?.paid_date || ""),
  });
  const [busy, setBusy] = useState(false);
  const [expId, setExpId] = useState(expenseId ? String(expenseId) : "");
  const [expenses, setExpenses] = useState(null);
  const needPicker = isNew && !expenseId;
  useEffect(() => {
    if (needPicker) fetchExpenses().then(setExpenses).catch(() => setExpenses([]));
  }, [needPicker]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!f.title.trim()) return toastErr(new Error("請填付款名稱，例如「定金」"));
    if (isNew && !expId) return toastErr(new Error("請選擇這筆付款屬於哪個花費項目"));
    setBusy(true);
    try {
      const body = {
        title: f.title.trim(), amount: toInt(f.amount), method: f.method, payer: f.payer, note: f.note, sort_order: toInt(f.sort_order),
      };
      if (f.due_date) body.due_date = f.due_date; else if (!isNew) body.clear_due_date = true;
      if (f.paid_date) body.paid_date = f.paid_date; else if (!isNew) body.clear_paid_date = true;
      const saved = isNew ? await createPayment(parseInt(expId, 10), body) : await updatePayment(initial.id, body);
      onSaved(saved);
    } catch (e) {
      toastErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={markPaid ? `標記已付 — ${initial?.title || ""}` : isNew ? `新增付款${expenseTitle ? ` — ${expenseTitle}` : ""}` : `編輯付款 — ${initial.title}`}
      onClose={onClose} footer={<Footer onClose={onClose} onSave={save} busy={busy} saveLabel={markPaid ? "確認已付" : "儲存"} />}>
      {needPicker && (
        <Field label="花費項目" required hint={expenses && expenses.length === 0 ? "還沒有花費項目，請先到「花費」新增" : ""}>
          <Select value={expId} onChange={setExpId} placeholder={expenses ? "選擇花費項目" : "讀取中…"}
            options={(expenses || []).map((e) => ({ value: String(e.id), label: `${e.title} · ${money(e.contract_amount)}` }))} />
        </Field>
      )}
      <div className="form-group grid-2">
        <Field label="名稱" required><input type="text" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="定金 / 拍攝當日 / 尾款" autoFocus={!markPaid} /></Field>
        <Field label="金額（元）"><NumberInput value={f.amount} onChange={(v) => set("amount", v)} /></Field>
      </div>
      <div className="form-group grid-2">
        <Field label="應付日期" hint="不確定可留空"><DatePicker value={f.due_date} onChange={(v) => set("due_date", v)} placeholder="未定" /></Field>
        <Field label="實付日期" hint="留空 = 未付"><DatePicker value={f.paid_date} onChange={(v) => set("paid_date", v)} placeholder="未付" /></Field>
      </div>
      <div className="form-group grid-2">
        <Field label="付款方式"><Select value={f.method} onChange={(v) => set("method", v)} options={[{ value: "", label: "（未填）" }, ...listOptions(PAY_METHODS)]} /></Field>
        <Field label="誰付的"><Select value={f.payer} onChange={(v) => set("payer", v)} options={[{ value: "", label: "（未填）" }, ...toOptions(PAID_BY)]} /></Field>
      </div>
      <Field label="備註"><input type="text" value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="匯款後五碼、發票…" /></Field>
    </Modal>
  );
}

/* ---------- 編輯檔案（備註、類型、公開）---------- */
export function FileModal({ file, onClose, onSaved }) {
  const [kind, setKind] = useState(file.kind);
  const [isPublic, setIsPublic] = useState(!!file.is_public);
  const [note, setNote] = useState(file.note || "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      onSaved(await updateFile(file.id, { kind, is_public: kind === "photo" && isPublic, note }));
    } catch (e) {
      toastErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`編輯檔案 — ${file.filename}`} onClose={onClose} footer={<Footer onClose={onClose} onSave={save} busy={busy} />}>
      <Field label="類型"><Select value={kind} onChange={setKind} options={toOptions(FILE_KIND)} /></Field>
      {kind === "photo" && (
        <Field label="公開到婚紗照分享頁">
          <Select value={isPublic} onChange={(v) => setIsPublic(v === true || v === "true")}
            options={[{ value: false, label: "不公開（只有自己看）" }, { value: true, label: "公開（賓客在 /photos 看得到）" }]} />
        </Field>
      )}
      <Field label="備註"><input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：SOSi 合約第 1 頁" autoFocus /></Field>
    </Modal>
  );
}

/* ---------- 上傳檔案 ---------- */
export function UploadModal({ defaults, onClose, onSaved }) {
  const [files, setFiles] = useState([]);
  const [kind, setKind] = useState(defaults?.kind || "doc");
  const [isPublic, setIsPublic] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");

  const save = async () => {
    if (!files.length) return toastErr(new Error("請先選擇檔案"));
    setBusy(true);
    const saved = [];
    try {
      for (let i = 0; i < files.length; i++) {
        setProgress(`上傳中 ${i + 1} / ${files.length}…`);
        saved.push(
          await uploadFile(files[i], {
            kind,
            is_public: kind === "photo" && isPublic ? "true" : "false",
            expense_id: defaults?.expense_id ?? "",
            payment_id: defaults?.payment_id ?? "",
            note,
          })
        );
      }
      onSaved(saved);
    } catch (e) {
      toastErr(e);
      if (saved.length) onSaved(saved);
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <Modal title="上傳檔案" onClose={onClose}
      footer={<Footer onClose={onClose} onSave={save} busy={busy} saveLabel={progress || "上傳"} />}>
      <Field label="檔案" hint="PDF、JPG、PNG、Excel、Word；單檔上限 20MB，可一次選多個">
        <div className="ui-file">
          <label className="btn btn-ghost" style={{ cursor: "pointer", alignSelf: "flex-start" }}>
            <Upload size={14} /> 選擇檔案
            <input type="file" multiple hidden accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.gif,.xlsx,.xls,.csv,.docx,.doc,.txt"
              onChange={(e) => { const picked = Array.from(e.target.files || []); setFiles((cur) => [...cur, ...picked]); e.target.value = ""; }} />
          </label>
          {files.length === 0 ? <span className="helper-text">尚未選擇檔案</span> : (
            <div className="ui-file-list">
              {files.map((f, i) => (
                <span key={`${f.name}-${i}`} className="pill pill-groom ui-file-item">
                  {f.name}（{fmtSize(f.size)}）
                  <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="移除">✕</button>
                </span>
              ))}
            </div>
          )}
        </div>
      </Field>
      <Field label="類型"><Select value={kind} onChange={setKind} options={toOptions(FILE_KIND)} /></Field>
      {kind === "photo" && (
        <Field label="公開到婚紗照分享頁">
          <Select value={isPublic} onChange={(v) => setIsPublic(v === true || v === "true")}
            options={[{ value: false, label: "不公開（只有自己看）" }, { value: true, label: "公開（賓客在 /photos 看得到）" }]} />
        </Field>
      )}
      <Field label="備註"><input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：SOSi 合約第 1 頁" /></Field>
    </Modal>
  );
}
