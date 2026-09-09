// 活動環節（只在後台）：上半是婚禮當天的環節流程（可調順序、每個環節有細節紀錄），
// 下半是點子庫（先把想法記下來，決定了再標採用、指到某個環節）。
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Lightbulb, Pencil, Plus, Trash2 } from "lucide-react";
import Select from "../components/Select.jsx";
import {
  createIdea, createSegment, deleteIdea, deleteSegment, fetchIdeas, fetchSegments, reorderSegments, updateIdea, updateSegment,
} from "../api.js";
import { Empty, ErrorBox, Field, Loading, Modal, NumberInput, PageHead, confirmDelete, toastErr, toInt, useLoader } from "./ui.jsx";

const SEG_STATUS = { draft: "規劃中", confirmed: "已確定" };
const IDEA_STATUS = { idea: "想法", adopted: "採用", dropped: "不採用" };
const IDEA_PILL = { idea: "pill-groom", adopted: "pill-yes", dropped: "pill-no" };
const toOptions = (map) => Object.entries(map).map(([value, label]) => ({ value, label }));

// 時間選項：09:00～23:45 每 15 分鐘（不用原生 time 輸入）
const TIME_OPTIONS = [{ value: "", label: "未定" }];
for (let h = 9; h <= 23; h++) for (const m of [0, 15, 30, 45]) {
  const v = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  TIME_OPTIONS.push({ value: v, label: v });
}

export default function Program() {
  const { data: segments, loading, error, reload } = useLoader(fetchSegments, []);
  const { data: ideas, reload: reloadIdeas } = useLoader(() => fetchIdeas(), []);
  const [open, setOpen] = useState({});
  const [ideaFilter, setIdeaFilter] = useState("all");
  const [modal, setModal] = useState(null); // { type: "segment"|"idea", item?, defaults? }

  const ideasBySegment = useMemo(() => {
    const m = {};
    (ideas || []).forEach((i) => { if (i.segment_id) (m[i.segment_id] ||= []).push(i); });
    return m;
  }, [ideas]);
  const ideaList = useMemo(() => (ideas || []).filter((i) => ideaFilter === "all" || i.status === ideaFilter), [ideas, ideaFilter]);

  const close = () => setModal(null);
  const savedSegment = () => { close(); reload(); reloadIdeas(); };
  const savedIdea = () => { close(); reloadIdeas(); reload(); };

  const move = async (idx, dir) => {
    const ids = segments.map((s) => s.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    try { await reorderSegments(ids); reload(); } catch (e) { toastErr(e); }
  };
  const removeSegment = async (s) => {
    if (!(await confirmDelete(s.title))) return;
    try { await deleteSegment(s.id); reload(); reloadIdeas(); } catch (e) { toastErr(e); }
  };
  const removeIdea = async (i) => {
    if (!(await confirmDelete(i.content.slice(0, 30)))) return;
    try { await deleteIdea(i.id); reloadIdeas(); reload(); } catch (e) { toastErr(e); }
  };
  const setIdeaStatus = async (i, status) => {
    try { await updateIdea(i.id, { status }); reloadIdeas(); } catch (e) { toastErr(e); }
  };

  const total = (segments || []).reduce((a, s) => a + (s.duration_min || 0), 0);

  return (
    <div>
      <PageHead title="活動環節" sub="婚禮當天的流程與每個環節的細節；先把點子記下來，決定了再放進環節"
        actions={<>
          <button className="btn btn-ghost" onClick={() => setModal({ type: "idea" })}><Lightbulb size={15} /> 記個點子</button>{" "}
          <button className="btn btn-primary" onClick={() => setModal({ type: "segment" })}><Plus size={15} /> 新增環節</button>
        </>} />

      <div className="panel">
        <div className="panel-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <span>環節流程</span>
          {total > 0 && <span className="muted-cell" style={{ fontSize: 12.5, fontWeight: 400 }}>已排 {segments.length} 個環節 · 合計約 {total} 分鐘</span>}
        </div>
        {loading ? <Loading /> : error ? <ErrorBox error={error} /> : !segments || segments.length === 0 ? (
          <Empty>還沒有環節。先從進場、致詞、敬酒、遊戲、送客這些開始排，時間之後再填也可以</Empty>
        ) : (
          <ol className="prog-list">
            {segments.map((s, idx) => {
              const isOpen = !!open[s.id];
              const linked = ideasBySegment[s.id] || [];
              return (
                <li key={s.id} className={`prog-item${s.status === "confirmed" ? " confirmed" : ""}`}>
                  <div className="prog-time">{s.start_time || <span className="muted-cell">未定</span>}{s.duration_min > 0 && <small>{s.duration_min} 分</small>}</div>
                  <div className="prog-body">
                    <button className="pl-linkbtn" onClick={() => setOpen((o) => ({ ...o, [s.id]: !isOpen }))} aria-expanded={isOpen}>
                      <ChevronDown size={14} style={{ transition: "transform .2s", transform: isOpen ? "rotate(180deg)" : "none" }} />
                      <strong>{s.title}</strong>
                      <span className={`pill ${s.status === "confirmed" ? "pill-yes" : "pill-warn"}`} style={{ marginLeft: 6 }}>{SEG_STATUS[s.status]}</span>
                      {linked.length > 0 && <span className="muted-cell" style={{ marginLeft: 6, fontSize: 12 }}>{linked.length} 個點子</span>}
                    </button>
                    {s.host && <div className="muted-cell" style={{ fontSize: 12.5, marginTop: 2 }}>負責：{s.host}</div>}
                    {isOpen && (
                      <div className="prog-detail">
                        {s.note ? <div className="prog-note">{s.note}</div> : <div className="muted-cell" style={{ fontSize: 12.5 }}>還沒有細節紀錄，按編輯把流程、道具、要注意的事寫進來</div>}
                        {linked.length > 0 && (
                          <div className="prog-ideas">
                            {linked.map((i) => <div key={i.id} className="prog-idea"><span className={`pill ${IDEA_PILL[i.status]}`}>{IDEA_STATUS[i.status]}</span><span>{i.content}</span></div>)}
                          </div>
                        )}
                        <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setModal({ type: "idea", defaults: { segment_id: String(s.id) } })}><Lightbulb size={12} /> 給這個環節記點子</button>
                      </div>
                    )}
                  </div>
                  <div className="row-actions prog-actions">
                    <button className="btn btn-ghost btn-sm" title="往上" disabled={idx === 0} onClick={() => move(idx, -1)}><ArrowUp size={13} /></button>{" "}
                    <button className="btn btn-ghost btn-sm" title="往下" disabled={idx === segments.length - 1} onClick={() => move(idx, 1)}><ArrowDown size={13} /></button>{" "}
                    <button className="btn btn-ghost btn-sm" title="編輯" onClick={() => setModal({ type: "segment", item: s })}><Pencil size={13} /></button>{" "}
                    <button className="btn btn-ghost btn-sm" title="刪除" onClick={() => removeSegment(s)}><Trash2 size={13} /></button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="panel">
        <div className="panel-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <span>點子與想法</span>
          <Select compact value={ideaFilter} onChange={setIdeaFilter} aria-label="點子狀態" options={[{ value: "all", label: "全部" }, ...toOptions(IDEA_STATUS)]} />
        </div>
        {!ideas ? <Loading /> : ideaList.length === 0 ? (
          <Empty>{ideaFilter === "all" ? "還沒有點子。想到什麼就先記下來，之後再決定要不要用、放在哪個環節" : "沒有這個狀態的點子"}</Empty>
        ) : (
          <div className="idea-list">
            {ideaList.map((i) => (
              <div key={i.id} className={`idea-card${i.status === "dropped" ? " dropped" : ""}`}>
                <div className="idea-content">{i.content}</div>
                <div className="idea-meta">
                  <Select compact value={i.status} onChange={(v) => setIdeaStatus(i, v)} aria-label="點子狀態" options={toOptions(IDEA_STATUS)} />
                  {i.segment_title && <span className="pill pill-groom">環節 · {i.segment_title}</span>}
                  <span className="row-actions" style={{ marginLeft: "auto" }}>
                    <button className="btn btn-ghost btn-sm" title="編輯" onClick={() => setModal({ type: "idea", item: i })}><Pencil size={13} /></button>{" "}
                    <button className="btn btn-ghost btn-sm" title="刪除" onClick={() => removeIdea(i)}><Trash2 size={13} /></button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modal?.type === "segment" && <SegmentModal initial={modal.item} onClose={close} onSaved={savedSegment} />}
      {modal?.type === "idea" && <IdeaModal initial={modal.item} defaults={modal.defaults} segments={segments || []} onClose={close} onSaved={savedIdea} />}
    </div>
  );
}

function Footer({ onClose, onSave, busy }) {
  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>取消</button>
      <button type="button" className="btn btn-primary" onClick={onSave} disabled={busy}>{busy ? "儲存中…" : "儲存"}</button>
    </>
  );
}

function SegmentModal({ initial, onClose, onSaved }) {
  const isNew = !initial?.id;
  const [f, setF] = useState({ title: "", start_time: "", duration_min: 0, host: "", note: "", status: "draft", ...(initial || {}) });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!f.title.trim()) return toastErr(new Error("請填環節名稱"));
    setBusy(true);
    try {
      const body = { title: f.title.trim(), start_time: f.start_time || "", duration_min: toInt(f.duration_min), host: f.host, note: f.note, status: f.status };
      onSaved(isNew ? await createSegment(body) : await updateSegment(initial.id, body));
    } catch (e) { toastErr(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={isNew ? "新增環節" : "編輯環節"} onClose={onClose} wide footer={<Footer onClose={onClose} onSave={save} busy={busy} />}>
      <Field label="環節名稱" required><input type="text" value={f.title} onChange={(e) => set("title", e.target.value)} autoFocus placeholder="例如：新人進場、證婚、第一次敬酒、遊戲" /></Field>
      <div className="form-group grid-2">
        <Field label="開始時間"><Select value={f.start_time} onChange={(v) => set("start_time", v)} options={TIME_OPTIONS} aria-label="開始時間" /></Field>
        <Field label="預計長度（分鐘）" hint="填 0 表示未定"><NumberInput value={f.duration_min} onChange={(v) => set("duration_min", v)} /></Field>
      </div>
      <div className="form-group grid-2">
        <Field label="負責／主持" hint="主持人、伴郎伴娘、某位親友…"><input type="text" value={f.host} onChange={(e) => set("host", e.target.value)} /></Field>
        <Field label="狀態"><Select value={f.status} onChange={(v) => set("status", v)} options={toOptions(SEG_STATUS)} aria-label="狀態" /></Field>
      </div>
      <Field label="細節紀錄" hint="流程怎麼走、要準備的道具與音樂、要提醒誰…想到就記"><textarea rows={5} value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
    </Modal>
  );
}

function IdeaModal({ initial, defaults, segments, onClose, onSaved }) {
  const isNew = !initial?.id;
  const [f, setF] = useState({ content: "", status: "idea", segment_id: "", ...(defaults || {}), ...(initial || {}), ...(initial?.segment_id ? { segment_id: String(initial.segment_id) } : {}) });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!f.content.trim()) return toastErr(new Error("請填點子內容"));
    setBusy(true);
    try {
      const body = { content: f.content.trim(), status: f.status };
      if (f.segment_id) body.segment_id = parseInt(f.segment_id, 10); else if (!isNew) body.clear_segment = true;
      onSaved(isNew ? await createIdea(body) : await updateIdea(initial.id, body));
    } catch (e) { toastErr(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={isNew ? "記個點子" : "編輯點子"} onClose={onClose} footer={<Footer onClose={onClose} onSave={save} busy={busy} />}>
      <Field label="點子" required><textarea rows={4} value={f.content} onChange={(e) => set("content", e.target.value)} autoFocus placeholder="例如：進場改走側門、用成長影片開場、抽捧花改成搶捧花…" /></Field>
      <div className="form-group grid-2">
        <Field label="狀態"><Select value={f.status} onChange={(v) => set("status", v)} options={toOptions(IDEA_STATUS)} aria-label="狀態" /></Field>
        <Field label="用在哪個環節" hint="還沒決定可以先不選">
          <Select value={f.segment_id || ""} onChange={(v) => set("segment_id", v)} options={[{ value: "", label: "先不指定" }, ...segments.map((s) => ({ value: String(s.id), label: s.title }))]} aria-label="用在哪個環節" />
        </Field>
      </div>
    </Modal>
  );
}
