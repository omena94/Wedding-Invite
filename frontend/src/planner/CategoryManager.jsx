// 類別管理：新增、改名、刪除、排序。廠商與花費都用這份清單。
import { useState } from "react";
import Swal from "sweetalert2";
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { createCategory, deleteCategory, reorderCategories, updateCategory } from "../api.js";
import { Modal, toastErr } from "./ui.jsx";

export default function CategoryManager({ list, onChange, onClose }) {
  const [items, setItems] = useState(list);
  const [editing, setEditing] = useState(null); // {id, name}
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = (next) => {
    setItems(next);
    onChange?.(next);
  };
  const run = async (fn) => {
    setBusy(true);
    try {
      apply(await fn());
    } catch (e) {
      toastErr(e);
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    const name = adding.trim();
    if (!name) return;
    run(() => createCategory(name)).then(() => setAdding(""));
  };
  const saveRename = () => {
    const name = (editing?.name || "").trim();
    if (!name) return;
    run(() => updateCategory(editing.id, { name })).then(() => setEditing(null));
  };
  const remove = async (c) => {
    const uses = c.vendor_count + c.expense_count;
    const r = await Swal.fire({
      icon: "warning",
      title: `刪除「${c.name}」？`,
      text: uses ? `有 ${c.vendor_count} 家廠商、${c.expense_count} 筆花費用這個類別，刪除後會改成「其他」。` : "這個類別目前沒有人用。",
      showCancelButton: true,
      confirmButtonText: "刪除",
      cancelButtonText: "取消",
      confirmButtonColor: "#9E5A54",
    });
    if (r.isConfirmed) run(() => deleteCategory(c.id));
  };
  const move = (idx, dir) => {
    const next = [...items];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    run(() => reorderCategories(next.map((c) => c.id)));
  };

  return (
    <Modal title="管理類別" onClose={onClose} footer={<button type="button" className="btn btn-primary" onClick={onClose}>完成</button>}>
      <div className="helper-text" style={{ marginBottom: 10 }}>改名會同步更新用到的廠商與花費；刪除會把它們改成「其他」。順序就是下拉選單的順序。</div>
      <ul className="pl-list pl-cat-list">
        {items.map((c, i) => (
          <li key={c.id}>
            {editing?.id === c.id ? (
              <div style={{ display: "flex", gap: 6, alignItems: "center", flex: 1 }}>
                <input type="text" value={editing.name} autoFocus onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") setEditing(null); }} />
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={saveRename}><Check size={13} /></button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEditing(null)}><X size={13} /></button>
              </div>
            ) : (
              <div style={{ minWidth: 0 }}>
                <div className="pl-list-title">{c.name}</div>
                <div className="pl-list-sub">{c.vendor_count} 家廠商 · {c.expense_count} 筆花費</div>
              </div>
            )}
            {editing?.id !== c.id && (
              <div className="row-actions">
                <button type="button" className="btn btn-ghost btn-sm" title="上移" disabled={busy || i === 0} onClick={() => move(i, -1)}><ArrowUp size={13} /></button>{" "}
                <button type="button" className="btn btn-ghost btn-sm" title="下移" disabled={busy || i === items.length - 1} onClick={() => move(i, 1)}><ArrowDown size={13} /></button>{" "}
                <button type="button" className="btn btn-ghost btn-sm" title="改名" disabled={busy} onClick={() => setEditing({ id: c.id, name: c.name })}><Pencil size={13} /></button>{" "}
                <button type="button" className="btn btn-ghost btn-sm" title="刪除" disabled={busy || c.name === "其他"} onClick={() => remove(c)}><Trash2 size={13} /></button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input type="text" value={adding} placeholder="新增類別，例如：喜糖、婚禮小物" onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()} />
        <button type="button" className="btn btn-primary" disabled={busy || !adding.trim()} onClick={add} style={{ whiteSpace: "nowrap" }}><Plus size={14} /> 新增</button>
      </div>
    </Modal>
  );
}
