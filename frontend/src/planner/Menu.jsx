// 婚宴 → 菜單（2026-09-29）：跟飯店討論菜色用，只給新人看。
// 飯店給的版本先匯進來，每一道可以標「討論中／確定／要更換」並寫備註；相關檔案（飯店的 PDF）從文件庫掛進來。
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ExternalLink, FileText, Plus, Save, Trash2, Upload } from "lucide-react";
import Select from "../components/Select.jsx";
import {
  createMenuItem, deleteMenuItem, fetchFiles, fetchMenu, fetchPlannerSettings, openFile, reorderMenu, savePlannerSettings, updateFile, updateMenuItem,
} from "../api.js";
import { UploadModal } from "./modals.jsx";
import { Empty, ErrorBox, Field, Loading, Modal, confirmDelete, toastErr, toastOk, useLoader } from "./ui.jsx";

export const MENU_STATUS = { discussing: "討論中", confirmed: "確定", change: "要更換" };
const STATUS_PILL = { discussing: "pill-warn", confirmed: "pill-yes", change: "pill-no" };

export default function MenuTab() {
  const { data, loading, error, reload } = useLoader(fetchMenu, []);
  const { data: settings, reload: reloadSettings } = useLoader(fetchPlannerSettings, []);
  const { data: files, reload: reloadFiles } = useLoader(() => fetchFiles({ kind: "menu" }), []);
  const { data: allDocs } = useLoader(() => fetchFiles({ kind: "doc" }), []);
  const [modal, setModal] = useState(null); // {type: "item", initial, category} | {type: "upload"}
  const [version, setVersion] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState("");

  useEffect(() => {
    if (settings?.values) { setVersion(settings.values.menu_version || ""); setNote(settings.values.menu_note || ""); }
  }, [settings]);
  const dirty = !!settings && (version !== (settings.values.menu_version || "") || note !== (settings.values.menu_note || ""));
  const saveNotes = async () => {
    setBusy(true);
    try { await savePlannerSettings({ menu_version: version, menu_note: note }); toastOk("已儲存"); reloadSettings(); } catch (e) { toastErr(e); } finally { setBusy(false); }
  };

  const items = data || [];
  // 依類別分組，類別順序＝第一道菜出現的順序
  const groups = useMemo(() => {
    const map = new Map();
    items.forEach((it) => { if (!map.has(it.category)) map.set(it.category, []); map.get(it.category).push(it); });
    return [...map.entries()];
  }, [items]);
  const counts = useMemo(() => items.reduce((a, it) => { a[it.status] = (a[it.status] || 0) + 1; return a; }, {}), [items]);

  const setStatus = async (it, status) => { try { await updateMenuItem(it.id, { status }); reload(); } catch (e) { toastErr(e); } };
  const saveNote = async (it, value) => { if ((it.note || "") === value) return; try { await updateMenuItem(it.id, { note: value }); reload(); } catch (e) { toastErr(e); } };
  const remove = async (it) => { if (!(await confirmDelete(`「${it.name}」`))) return; try { await deleteMenuItem(it.id); reload(); } catch (e) { toastErr(e); } };
  // 同類別內上下移動：把整份順序重排後送出
  const move = async (it, dir) => {
    const ids = items.map((x) => x.id);
    const i = ids.indexOf(it.id), j = i + dir;
    if (j < 0 || j >= ids.length || items[j].category !== it.category) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await reorderMenu(ids); reload(); } catch (e) { toastErr(e); }
  };
  const tagFile = async () => {
    if (!pick) return;
    try { await updateFile(Number(pick), { kind: "menu" }); setPick(""); toastOk("已加到菜單檔案"); reloadFiles(); } catch (e) { toastErr(e); }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return (
    <div>
      {/* 版本與討論備忘 */}
      <div className="panel">
        <div className="panel-head"><div className="panel-title"><FileText size={18} /> 跟飯店討論中</div>
          <button className="btn btn-primary btn-sm" disabled={busy || !dirty} onClick={saveNotes}><Save size={13} /> {busy ? "儲存中…" : "儲存"}</button></div>
        <div className="form-group grid-2">
          <Field label="目前版本" hint="例如：0926 版、飯店第二次修改"><input type="text" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="例如 0926 版" maxLength={60} /></Field>
          <div className="menu-summary">
            <span className="pill pill-warn">討論中 {counts.discussing || 0}</span>
            <span className="pill pill-yes">確定 {counts.confirmed || 0}</span>
            <span className="pill pill-no">要更換 {counts.change || 0}</span>
            <span className="muted-cell" style={{ fontSize: 12.5 }}>共 {items.length} 道</span>
          </div>
        </div>
        <Field label="討論備忘" hint="跟業務談到的重點、還沒回覆的問題、價格條件…都記在這裡">
          <textarea rows={5} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：龍蝦每人限半隻、想把老罈酸菜牛肉換成…、素食餐點另外談" maxLength={8000} />
        </Field>
        {dirty && <span className="pill pill-warn">有尚未儲存的修改</span>}
      </div>

      {/* 相關檔案 */}
      <div className="panel">
        <div className="panel-head"><div className="panel-title"><Upload size={18} /> 菜單檔案</div>
          <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: "upload" })}><Plus size={13} /> 上傳新版本</button></div>
        {!files?.length ? <div className="helper-text">還沒有檔案。飯店寄來的菜單 PDF 上傳到這裡，或從文件庫挑一個既有的檔案。</div> : (
          <ul className="menu-files">
            {files.map((f) => <li key={f.id}><FileText size={14} /><span className="menu-file-name">{f.filename}</span><span className="muted-cell" style={{ fontSize: 12 }}>{(f.created_at || "").slice(0, 10)}</span><button className="btn btn-ghost btn-sm" onClick={() => openFile(f.id).catch(toastErr)}><ExternalLink size={13} /> 開啟</button></li>)}
          </ul>
        )}
        {!!allDocs?.length && (
          <div className="menu-pick">
            <Select compact aria-label="從文件庫挑檔案" value={pick} onChange={setPick} options={[{ value: "", label: "從文件庫挑一個檔案標成菜單…" }, ...allDocs.map((f) => ({ value: String(f.id), label: f.filename }))]} />
            <button className="btn btn-ghost btn-sm" disabled={!pick} onClick={tagFile}>加入</button>
          </div>
        )}
      </div>

      {/* 菜色清單 */}
      <div className="panel">
        <div className="panel-head"><div className="panel-title">菜色</div>
          <button className="btn btn-primary btn-sm" onClick={() => setModal({ type: "item" })}><Plus size={13} /> 新增菜色</button></div>
        {!items.length ? <Empty>還沒有菜色。按「新增菜色」，或把飯店的菜單匯入。</Empty> : groups.map(([cat, list]) => (
          <div key={cat} className="menu-group">
            <div className="menu-group-head"><strong>{cat}</strong><span className="muted-cell" style={{ fontSize: 12 }}>{list.length} 道</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: "item", category: cat })}><Plus size={12} /> 加一道</button></div>
            <div className="table-wrap"><table className="menu-table">
              <thead><tr><th style={{ width: 36 }}></th><th>菜名</th><th style={{ width: 130 }}>狀態</th><th>備註（想換什麼、業務怎麼說）</th><th style={{ width: 96 }}></th></tr></thead>
              <tbody>
                {list.map((it) => (
                  <tr key={it.id} className={`menu-row ${it.status}`}>
                    <td className="menu-move"><button type="button" onClick={() => move(it, -1)} title="往上"><ArrowUp size={12} /></button><button type="button" onClick={() => move(it, 1)} title="往下"><ArrowDown size={12} /></button></td>
                    <td><div className="menu-name">{it.name}</div>{it.name_en && <div className="muted-cell" style={{ fontSize: 11.5 }}>{it.name_en}</div>}</td>
                    <td><Select compact portal aria-label={`${it.name} 狀態`} value={it.status} onChange={(v) => setStatus(it, v)} options={Object.entries(MENU_STATUS).map(([value, label]) => ({ value, label }))} /></td>
                    <td><input type="text" className="menu-note" defaultValue={it.note || ""} placeholder="—" maxLength={500} onBlur={(e) => saveNote(it, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} /></td>
                    <td className="row-actions"><button className="btn btn-ghost btn-sm" title="編輯" onClick={() => setModal({ type: "item", initial: it })}>編輯</button>{" "}<button className="btn btn-ghost btn-sm" title="刪除" onClick={() => remove(it)}><Trash2 size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        ))}
      </div>

      {modal?.type === "item" && <ItemModal initial={modal.initial} category={modal.category} categories={groups.map(([c]) => c)} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      {modal?.type === "upload" && <UploadModal defaults={{ kind: "menu" }} onClose={() => setModal(null)} onSaved={() => { setModal(null); reloadFiles(); }} />}
    </div>
  );
}

function ItemModal({ initial, category, categories, onClose, onSaved }) {
  const [f, setF] = useState(initial ? { ...initial } : { category: category || categories[0] || "熱食類", name: "", name_en: "", status: "discussing", note: "" });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!f.name.trim()) return toastErr(new Error("菜名不能空白"));
    if (!f.category.trim()) return toastErr(new Error("類別不能空白"));
    setBusy(true);
    try {
      const body = { category: f.category.trim(), name: f.name.trim(), name_en: (f.name_en || "").trim(), status: f.status, note: f.note || "" };
      if (initial) await updateMenuItem(initial.id, body); else await createMenuItem(body);
      onSaved();
    } catch (e) { toastErr(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={initial ? "編輯菜色" : "新增菜色"} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose} disabled={busy}>取消</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "儲存中…" : "儲存"}</button></>}>
      <Field label="類別" hint="例如 精選冷盤、熱食類、甜點類；打新的名字就會多一個類別"><input type="text" list="menu-cats" value={f.category} onChange={(e) => set("category", e.target.value)} maxLength={50} /><datalist id="menu-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></Field>
      <div className="form-group grid-2">
        <Field label="菜名" required><input type="text" value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={120} /></Field>
        <Field label="英文（可不填）"><input type="text" value={f.name_en || ""} onChange={(e) => set("name_en", e.target.value)} maxLength={160} /></Field>
      </div>
      <Field label="狀態"><Select aria-label="狀態" value={f.status} onChange={(v) => set("status", v)} options={Object.entries(MENU_STATUS).map(([value, label]) => ({ value, label }))} /></Field>
      <Field label="備註"><input type="text" value={f.note || ""} onChange={(e) => set("note", e.target.value)} maxLength={500} placeholder="想換成什麼、業務怎麼說…" /></Field>
    </Modal>
  );
}
