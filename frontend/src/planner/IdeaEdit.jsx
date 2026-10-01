// 點子的新增／編輯：獨立頁面（2026-10-01 新人要求，彈窗太小不好寫），跟環節、遊戲編輯頁同一套做法；儲存後回活動環節頁。
// 網址：/planner/program/ideas/new（從環節的「給這個環節記點子」進來會帶 ?segment=環節id）、/planner/program/ideas/<id>
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
import Select from "../components/Select.jsx";
import { createIdea, deleteIdea, fetchIdeas, fetchSegments, updateIdea } from "../api.js";
import { IDEA_STATUS, toOptions } from "./programShared.js";
import { ErrorBox, Field, Loading, PageHead, confirmDelete, toastErr, toastOk, useLoader } from "./ui.jsx";

const EMPTY = { content: "", status: "idea", segment_id: "" };

export default function IdeaEdit() {
  const { id } = useParams();
  const isNew = !id;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { data: segments, loading: segLoading } = useLoader(fetchSegments, []);
  // 沒有單筆的 API；點子清單不長，整份讀回來再挑那一筆（新增時不用讀）
  const { data: ideas, loading, error } = useLoader(() => (isNew ? Promise.resolve([]) : fetchIdeas()), [isNew]);
  const idea = useMemo(() => (isNew ? null : (ideas || []).find((i) => String(i.id) === id)), [ideas, id, isNew]);
  const [f, setF] = useState(EMPTY);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  // 資料到了才填表單，只填一次（之後不蓋掉正在打的字）
  useEffect(() => {
    if (ready || loading || segLoading || !ideas) return;
    if (idea) setF({ ...EMPTY, ...idea, segment_id: idea.segment_id ? String(idea.segment_id) : "" });
    else if (isNew && params.get("segment")) setF({ ...EMPTY, segment_id: params.get("segment") });
    setReady(true);
  }, [ready, loading, segLoading, ideas, idea, isNew, params]);

  const save = async () => {
    if (!f.content.trim()) return toastErr(new Error("請填點子內容"));
    setBusy(true);
    try {
      const body = { content: f.content.trim(), status: f.status };
      if (f.segment_id) body.segment_id = parseInt(f.segment_id, 10); else if (!isNew) body.clear_segment = true;
      if (isNew) await createIdea(body); else await updateIdea(idea.id, body);
      toastOk(isNew ? "已記下點子" : "已儲存");
      navigate("/program");
    } catch (e) { toastErr(e); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await confirmDelete("這個點子"))) return;
    try { await deleteIdea(idea.id); navigate("/program"); } catch (e) { toastErr(e); }
  };

  const actions = (
    <>
      <Link className="btn btn-ghost" to="/program"><ArrowLeft size={15} /> 回活動環節</Link>
      {!isNew && idea && <button className="btn btn-ghost" onClick={remove} disabled={busy}><Trash2 size={15} /> 刪除</button>}
      <button className="btn btn-primary" onClick={save} disabled={busy || !ready || (!isNew && !idea)}><Save size={15} /> {busy ? "儲存中…" : "儲存"}</button>
    </>
  );

  let body;
  if (error) body = <ErrorBox error={error} />;
  else if (!ready) body = <Loading />;
  else if (!isNew && !idea) body = <div className="panel"><ErrorBox error="找不到這個點子，可能已經被刪除了" /></div>;
  else body = (
    <div className="panel game-edit">
      <Field label="點子" required hint="想到什麼都寫下來，可以寫很多行：怎麼做、為什麼想這樣、要準備什麼…">
        <textarea rows={12} value={f.content} onChange={(e) => set("content", e.target.value)} autoFocus placeholder="例如：進場改走側門、用成長影片開場、抽捧花改成搶捧花…" />
      </Field>
      <div className="form-group grid-2">
        <Field label="狀態"><Select value={f.status} onChange={(v) => set("status", v)} options={toOptions(IDEA_STATUS)} aria-label="狀態" /></Field>
        <Field label="用在哪個環節" hint="還沒決定可以先不選">
          <Select value={f.segment_id || ""} onChange={(v) => set("segment_id", v)} options={[{ value: "", label: "先不指定" }, ...(segments || []).map((s) => ({ value: String(s.id), label: s.title }))]} aria-label="用在哪個環節" />
        </Field>
      </div>
      <div className="pl-actions" style={{ justifyContent: "flex-end", marginTop: 8 }}>{actions}</div>
    </div>
  );

  return (
    <div>
      <PageHead title={isNew ? "記個點子" : "編輯點子"} sub="先把想法記下來，決定了再標「採用」、指定用在哪個環節" actions={actions} />
      {body}
    </div>
  );
}
