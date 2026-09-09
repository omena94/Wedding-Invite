// 遊戲的新增／編輯：獨立頁面（不是彈出視窗），欄位有更大的空間；儲存後回活動環節頁。
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
import Select from "../components/Select.jsx";
import { createGame, deleteGame, fetchGame, fetchSegments, updateGame } from "../api.js";
import { ErrorBox, Field, Loading, NumberInput, PageHead, confirmDelete, toastErr, toastOk, toInt, useLoader } from "./ui.jsx";

const EMPTY = { name: "", rules: "", content: "", prize: "", host: "", judge: "", duration_min: 0, props: "", segment_id: "" };

export default function GameEdit() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const { data: segments } = useLoader(fetchSegments, []);
  const { data: game, loading, error } = useLoader(() => (isNew ? Promise.resolve(null) : fetchGame(id)), [id]);
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  // 編輯時把既有資料帶進表單（環節 id 轉成字串給下拉用）
  useEffect(() => {
    if (game) setF({ ...EMPTY, ...game, segment_id: game.segment_id ? String(game.segment_id) : "" });
  }, [game]);

  const save = async () => {
    if (!f.name.trim()) return toastErr(new Error("請填遊戲名稱"));
    setBusy(true);
    try {
      const body = { name: f.name.trim(), rules: f.rules, content: f.content, prize: f.prize, host: f.host, judge: f.judge, duration_min: toInt(f.duration_min), props: f.props };
      if (f.segment_id) body.segment_id = parseInt(f.segment_id, 10); else if (!isNew) body.clear_segment = true;
      if (isNew) await createGame(body); else await updateGame(id, body);
      toastOk(isNew ? "已新增遊戲" : "已儲存");
      navigate("/program");
    } catch (e) { toastErr(e); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await confirmDelete(f.name || "這個遊戲"))) return;
    try { await deleteGame(id); navigate("/program"); } catch (e) { toastErr(e); }
  };

  const actions = (
    <>
      <Link className="btn btn-ghost" to="/program"><ArrowLeft size={15} /> 回活動環節</Link>
      {!isNew && <button className="btn btn-ghost" onClick={remove} disabled={busy}><Trash2 size={15} /> 刪除</button>}
      <button className="btn btn-primary" onClick={save} disabled={busy}><Save size={15} /> {busy ? "儲存中…" : "儲存"}</button>
    </>
  );

  return (
    <div>
      <PageHead title={isNew ? "新增遊戲" : "編輯遊戲"} sub="名稱、規則、內容、獎品、主持人、裁判、時長、道具；決定了再指定在哪個環節玩" actions={actions} />
      {!isNew && loading ? <Loading /> : error ? <ErrorBox error={error} /> : (
        <div className="panel game-edit">
          <div className="form-group grid-2">
            <Field label="名稱" required><input type="text" value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus placeholder="例如：搶捧花、新人問答" /></Field>
            <Field label="時長（分鐘）" hint="填 0 表示未定"><NumberInput value={f.duration_min} onChange={(v) => set("duration_min", v)} /></Field>
          </div>
          <div className="form-group grid-2">
            <Field label="主持人"><input type="text" value={f.host} onChange={(e) => set("host", e.target.value)} placeholder="例如：主持人、伴郎" /></Field>
            <Field label="裁判"><input type="text" value={f.judge} onChange={(e) => set("judge", e.target.value)} placeholder="例如：伴娘、某位親友" /></Field>
          </div>
          <Field label="規則" hint="怎麼玩、怎麼算贏、要注意什麼"><textarea rows={6} value={f.rules} onChange={(e) => set("rules", e.target.value)} /></Field>
          <Field label="遊戲內容" hint="流程、題目、要請誰上台、音樂…"><textarea rows={8} value={f.content} onChange={(e) => set("content", e.target.value)} /></Field>
          <div className="form-group grid-2">
            <Field label="獎品"><textarea rows={4} value={f.prize} onChange={(e) => set("prize", e.target.value)} /></Field>
            <Field label="道具" hint="要準備的東西，一行一項"><textarea rows={4} value={f.props} onChange={(e) => set("props", e.target.value)} /></Field>
          </div>
          <Field label="在哪個環節玩" hint="還沒決定可以先不選">
            <Select value={f.segment_id || ""} onChange={(v) => set("segment_id", v)} options={[{ value: "", label: "先不指定" }, ...(segments || []).map((s) => ({ value: String(s.id), label: s.title }))]} aria-label="在哪個環節玩" />
          </Field>
          <div className="pl-actions" style={{ justifyContent: "flex-end", marginTop: 8 }}>{actions}</div>
        </div>
      )}
    </div>
  );
}
