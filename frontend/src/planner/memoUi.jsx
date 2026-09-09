// 備忘（要問飯店、婚紗店、喜餅店…的問題與答案）：備忘頁、籌備進度、花費三處共用的清單與編輯視窗。
// 一條備忘可以獨立存在，也可以掛在某筆待辦或花費底下；不管從哪裡改，都是同一筆資料。
import { useState } from "react";
import Swal from "sweetalert2";
import { Pencil, Plus, Trash2 } from "lucide-react";
import Select from "../components/Select.jsx";
import { Checkbox } from "../components/Toggle.jsx";
import { createMemo, deleteMemo, updateMemo } from "../api.js";
import { Field, Modal, confirmDelete, toastErr } from "./ui.jsx";

// 預設主題；新人自訂過的主題會一併出現在下拉裡
export const PRESET_TOPICS = ["飯店", "婚紗", "喜餅", "攝影", "其他"];
const CUSTOM = "__custom__";

export function topicList(memos) {
  const set = new Set(PRESET_TOPICS);
  (memos || []).forEach((m) => m.topic && set.add(m.topic));
  return Array.from(set);
}

/** 依 task_id / expense_id 分組，給籌備進度與花費頁在列裡顯示 */
export function groupBy(memos, key) {
  const m = {};
  (memos || []).forEach((x) => {
    if (x[key] === null || x[key] === undefined) return;
    (m[x[key]] ||= []).push(x);
  });
  return m;
}

/** 勾「已確認」：還沒有答案時順便問一下結果，讓答案跟確認一起記下 */
async function confirmWithAnswer(memo) {
  if (memo.confirmed) return updateMemo(memo.id, { confirmed: false });
  if (memo.answer) return updateMemo(memo.id, { confirmed: true });
  const r = await Swal.fire({
    title: "確認結果",
    text: memo.question,
    input: "textarea",
    inputPlaceholder: "對方怎麼說？可以先留空",
    showCancelButton: true,
    confirmButtonText: "標為已確認",
    cancelButtonText: "取消",
  });
  if (!r.isConfirmed) return null;
  return updateMemo(memo.id, { confirmed: true, answer: (r.value || "").trim() });
}

/**
 * 備忘清單列。
 * - memos：要顯示的備忘
 * - onChanged：改完後重新載入
 * - onEdit(memo)：開編輯視窗
 * - showLink：是否顯示「掛在哪筆待辦／花費」（備忘頁用）
 */
export function MemoRows({ memos, onChanged, onEdit, showLink = false }) {
  if (!memos || memos.length === 0) return null;
  const toggle = async (m) => {
    try { if ((await confirmWithAnswer(m)) !== null) onChanged?.(); } catch (e) { toastErr(e); }
  };
  const remove = async (m) => {
    if (!(await confirmDelete(m.question))) return;
    try { await deleteMemo(m.id); onChanged?.(); } catch (e) { toastErr(e); }
  };
  return (
    <div className="memo-list">
      {memos.map((m) => (
        <div key={m.id} className={`memo-row${m.confirmed ? " done" : ""}`}>
          <Checkbox checked={m.confirmed} onChange={() => toggle(m)} />
          <div className="memo-body">
            <div className="memo-q">{m.question}</div>
            {m.answer && <div className="memo-a">答：{m.answer}</div>}
            {showLink && (m.task_title || m.expense_title) && (
              <div className="memo-link">
                {m.task_title && <span className="pill pill-groom">籌備進度 · {m.task_title}</span>}
                {m.expense_title && <span className="pill pill-groom">花費 · {m.expense_title}</span>}
              </div>
            )}
          </div>
          <div className="row-actions">
            <button className="btn btn-ghost btn-sm" title="編輯" onClick={() => onEdit(m)}><Pencil size={13} /></button>{" "}
            <button className="btn btn-ghost btn-sm" title="刪除" onClick={() => remove(m)}><Trash2 size={13} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** 「＋ 備忘」小按鈕：籌備進度與花費的列裡用 */
export function MemoAddButton({ onClick, count = 0 }) {
  return (
    <button type="button" className="btn btn-ghost btn-sm memo-add" onClick={onClick}>
      <Plus size={12} /> 備忘{count > 0 ? `（${count}）` : ""}
    </button>
  );
}

/**
 * 新增／編輯備忘。
 * - initial：既有備忘（編輯）
 * - defaults：新增時的預設值，例如 { task_id, topic }
 * - topics：主題下拉的選項
 * - tasks / expenses：有給才顯示「掛在哪筆待辦／花費」的下拉（備忘頁用；在籌備進度或花費裡新增時已固定，不用選）
 */
export function MemoModal({ initial, defaults, topics = PRESET_TOPICS, tasks, expenses, onClose, onSaved }) {
  const isNew = !initial?.id;
  const [f, setF] = useState({
    topic: "其他", question: "", answer: "", confirmed: false, task_id: "", expense_id: "",
    ...(defaults || {}),
    ...(initial || {}),
  });
  const [customTopic, setCustomTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const topicOpts = topics.includes(f.topic) || f.topic === CUSTOM ? topics : [...topics, f.topic];
  const options = [...topicOpts.map((t) => ({ value: t, label: t })), { value: CUSTOM, label: "＋ 自訂主題…" }];

  const save = async () => {
    const topic = (f.topic === CUSTOM ? customTopic : f.topic).trim();
    if (!topic) return toastErr(new Error("請填主題"));
    if (!f.question.trim()) return toastErr(new Error("請填要確認的事"));
    setBusy(true);
    try {
      const body = { topic, question: f.question.trim(), answer: (f.answer || "").trim(), confirmed: !!f.confirmed };
      if (f.task_id) body.task_id = parseInt(f.task_id, 10); else if (!isNew) body.clear_task = true;
      if (f.expense_id) body.expense_id = parseInt(f.expense_id, 10); else if (!isNew) body.clear_expense = true;
      const saved = isNew ? await createMemo(body) : await updateMemo(initial.id, body);
      onSaved(saved);
    } catch (e) {
      toastErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={isNew ? "新增備忘" : "編輯備忘"} onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>取消</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "儲存中…" : "儲存"}</button>
      </>}>
      <div className="form-group grid-2">
        <Field label="主題" required><Select value={f.topic} onChange={(v) => set("topic", v)} options={options} aria-label="主題" /></Field>
        {f.topic === CUSTOM && <Field label="自訂主題"><input type="text" value={customTopic} onChange={(e) => setCustomTopic(e.target.value)} placeholder="例如：花藝" autoFocus /></Field>}
      </div>
      <Field label="要確認的事" required><textarea rows={2} value={f.question} onChange={(e) => set("question", e.target.value)} placeholder="例如：素食主餐的內容是什麼？" autoFocus={f.topic !== CUSTOM} /></Field>
      <Field label="答案／結果" hint="問到了再回來填也可以"><textarea rows={2} value={f.answer} onChange={(e) => set("answer", e.target.value)} /></Field>
      {tasks && (
        <Field label="掛在哪筆籌備進度" hint="選了會在籌備進度那一筆底下一起顯示">
          <Select value={f.task_id || ""} onChange={(v) => set("task_id", v)} options={[{ value: "", label: "不掛" }, ...tasks.map((t) => ({ value: String(t.id), label: t.title }))]} aria-label="掛在哪筆籌備進度" />
        </Field>
      )}
      {expenses && (
        <Field label="掛在哪筆花費" hint="選了會在花費展開後一起顯示">
          <Select value={f.expense_id || ""} onChange={(v) => set("expense_id", v)} options={[{ value: "", label: "不掛" }, ...expenses.map((e) => ({ value: String(e.id), label: e.title }))]} aria-label="掛在哪筆花費" />
        </Field>
      )}
      <Field label="狀態">
        <Checkbox checked={!!f.confirmed} onChange={(v) => set("confirmed", v)}>已確認</Checkbox>
      </Field>
    </Modal>
  );
}
