// 筆記（2026-09-10 起，原「備忘」）：一則筆記有標題、內容、主題、已處理、釘選；可「排進行事曆」建一筆事件。
// 後端欄位仍叫 question / answer / confirmed，API 已換成 title / content / done。
import { useState } from "react";
import { CalendarPlus, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import Select from "../components/Select.jsx";
import { Checkbox } from "../components/Toggle.jsx";
import { createMemo, deleteMemo, updateMemo } from "../api.js";
import { fmtDate } from "../constants.js";
import { Field, Modal, confirmDelete, toastErr } from "./ui.jsx";
import { TopicTag } from "./topics.jsx";

const CUSTOM = "__custom__";

/**
 * 筆記清單。
 * - notes：要顯示的筆記；onChanged：改完後重新載入；onEdit(note)：開編輯視窗
 * - onSchedule(note)：「排進行事曆」；topics：主題清單（決定標籤顏色）
 */
export function NoteRows({ notes, topics, onChanged, onEdit, onSchedule }) {
  if (!notes || notes.length === 0) return null;
  const patch = async (n, body) => {
    try { await updateMemo(n.id, body); onChanged?.(); } catch (e) { toastErr(e); }
  };
  const remove = async (n) => {
    if (!(await confirmDelete(n.title))) return;
    try { await deleteMemo(n.id); onChanged?.(); } catch (e) { toastErr(e); }
  };
  return (
    <div className="memo-list">
      {notes.map((n) => (
        <div key={n.id} className={`memo-row${n.done ? " done" : ""}${n.pinned ? " pinned" : ""}`}>
          <Checkbox checked={n.done} onChange={() => patch(n, { done: !n.done })} />
          <div className="memo-body">
            <div className="memo-q">{n.pinned && <Pin size={12} className="memo-pin" />}{n.title}</div>
            {n.content && <div className="memo-a">{n.content}</div>}
            <div className="memo-link">
              <TopicTag topic={n.topic} topics={topics} small />
              {n.task_id
                ? <span className={`pill ${n.task_done ? "pill-yes" : "pill-groom"}`}>行事曆 · {n.task_due_date ? fmtDate(n.task_due_date) : "還沒排日期"}{n.task_done ? " · 已完成" : ""}</span>
                : !n.done && onSchedule && <button type="button" className="btn btn-ghost btn-sm memo-add" onClick={() => onSchedule(n)}><CalendarPlus size={12} /> 排進行事曆</button>}
            </div>
          </div>
          <div className="row-actions">
            <button className="btn btn-ghost btn-sm" title={n.pinned ? "取消釘選" : "釘選到最上面"} onClick={() => patch(n, { pinned: !n.pinned })}>{n.pinned ? <PinOff size={13} /> : <Pin size={13} />}</button>{" "}
            <button className="btn btn-ghost btn-sm" title="編輯" onClick={() => onEdit(n)}><Pencil size={13} /></button>{" "}
            <button className="btn btn-ghost btn-sm" title="刪除" onClick={() => remove(n)}><Trash2 size={13} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 新增／編輯筆記。
 * - initial：既有筆記（編輯）；defaults：新增時的預設值，例如 { topic }；topics：主題下拉
 */
export function NoteModal({ initial, defaults, topics, onClose, onSaved }) {
  const isNew = !initial?.id;
  const [f, setF] = useState({
    topic: "其他", title: "", content: "", done: false, pinned: false,
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
    if (!topic) return toastErr(new Error("請選主題"));
    if (!f.title.trim()) return toastErr(new Error("請填標題"));
    setBusy(true);
    try {
      const body = { topic, title: f.title.trim(), content: (f.content || "").trim(), done: !!f.done, pinned: !!f.pinned };
      const saved = isNew ? await createMemo(body) : await updateMemo(initial.id, body);
      onSaved(saved);
    } catch (e) {
      toastErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={isNew ? "新增筆記" : "編輯筆記"} onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>取消</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "儲存中…" : "儲存"}</button>
      </>}>
      <Field label="標題" required><input type="text" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="例如：素食主餐有哪些可以選？" autoFocus /></Field>
      <Field label="內容" hint="店家怎麼回、細節、想法…都寫這裡，可以多行"><textarea rows={4} value={f.content || ""} onChange={(e) => set("content", e.target.value)} /></Field>
      <div className="form-group grid-2">
        <Field label="主題" required><Select value={f.topic} onChange={(v) => set("topic", v)} options={options} aria-label="主題" /></Field>
        {f.topic === CUSTOM && <Field label="自訂主題"><input type="text" value={customTopic} onChange={(e) => setCustomTopic(e.target.value)} placeholder="例如：花藝" autoFocus /></Field>}
      </div>
      <div className="pl-switch-list">
        <Checkbox checked={!!f.pinned} onChange={(v) => set("pinned", v)}>釘選到最上面</Checkbox>
        <Checkbox checked={!!f.done} onChange={(v) => set("done", v)}>已處理</Checkbox>
      </div>
    </Modal>
  );
}
