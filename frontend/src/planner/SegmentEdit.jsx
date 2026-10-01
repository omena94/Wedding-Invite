// 環節的新增／編輯：獨立頁面（2026-10-01 新人要求，原本的彈窗太小、細節紀錄不好寫），做法跟遊戲編輯頁一樣；儲存後回活動環節頁。
// 網址：/planner/program/segments/new（從遊戲卡「排進時間軸」進來會帶 ?game=遊戲id）、/planner/program/segments/<id>
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
import Select from "../components/Select.jsx";
import { createSegment, deleteSegment, fetchGames, fetchSegments, updateGame, updateSegment } from "../api.js";
import { SEG_STATUS, TIME_OPTIONS, toOptions } from "./programShared.js";
import { ErrorBox, Field, Loading, NumberInput, PageHead, confirmDelete, toastErr, toastOk, toInt, useLoader } from "./ui.jsx";

const EMPTY = { title: "", start_time: "", duration_min: 0, host: "", note: "", status: "draft" };

export default function SegmentEdit() {
  const { id } = useParams();
  const isNew = !id;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  // 沒有單筆的 API；環節清單很短，整份讀回來再挑那一筆
  const { data: segments, loading, error } = useLoader(fetchSegments, []);
  const { data: games, loading: gamesLoading } = useLoader(fetchGames, []);
  const segment = useMemo(() => (isNew ? null : (segments || []).find((s) => String(s.id) === id)), [segments, id, isNew]);
  const [f, setF] = useState(EMPTY);
  const [gameId, setGameId] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  // 資料都到了才把表單填好（只填一次，之後不蓋掉正在打的字）。
  // 一個環節對應一個遊戲（新人：遊戲名稱基本上就是環節名稱）；從遊戲卡「排進時間軸」進來時帶入那個遊戲
  useEffect(() => {
    if (ready || loading || gamesLoading || !segments || !games) return;
    const fromGame = isNew ? games.find((g) => String(g.id) === params.get("game")) : null;
    const linked = segment ? games.find((g) => g.segment_id === segment.id) : fromGame;
    setGameId(linked ? String(linked.id) : "");
    if (segment) setF({ ...EMPTY, ...segment });
    else if (fromGame) setF({ ...EMPTY, title: fromGame.name, duration_min: fromGame.duration_min, host: fromGame.host });
    setReady(true);
  }, [ready, loading, gamesLoading, segments, games, segment, isNew, params]);

  // 換遊戲：名稱若還是空的或等於上一個遊戲名，就換成新遊戲名；時長、主持人沒填的也帶入
  const pickGame = (v) => {
    const prev = (games || []).find((g) => String(g.id) === gameId);
    const g = (games || []).find((x) => String(x.id) === v);
    setGameId(v);
    if (!g) return;
    setF((x) => ({
      ...x,
      title: !x.title.trim() || (prev && x.title === prev.name) ? g.name : x.title,
      duration_min: toInt(x.duration_min) > 0 ? x.duration_min : g.duration_min,
      host: x.host || g.host,
    }));
  };
  const gameOptions = [{ value: "", label: "不是遊戲環節" }, ...(games || []).map((g) => {
    const elsewhere = g.segment_id && g.segment_id !== segment?.id ? `（目前在「${g.segment_title}」）` : "";
    return { value: String(g.id), label: `${g.name}${g.duration_min > 0 ? ` · ${g.duration_min} 分` : ""}${elsewhere}` };
  })];

  const save = async () => {
    if (!f.title.trim()) return toastErr(new Error("請填環節名稱"));
    setBusy(true);
    try {
      const body = { title: f.title.trim(), start_time: f.start_time || "", duration_min: toInt(f.duration_min), host: f.host, note: f.note, status: f.status };
      const saved = isNew ? await createSegment(body) : await updateSegment(segment.id, body);
      // 選的遊戲掛到這個環節；原本掛在這個環節、現在沒選的解除
      const changes = (games || []).filter((g) => (String(g.id) === gameId && g.segment_id !== saved.id) || (String(g.id) !== gameId && g.segment_id === saved.id));
      await Promise.all(changes.map((g) => updateGame(g.id, String(g.id) === gameId ? { segment_id: saved.id } : { clear_segment: true })));
      toastOk(isNew ? "已新增環節" : "已儲存");
      navigate("/program");
    } catch (e) { toastErr(e); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await confirmDelete(f.title || "這個環節"))) return;
    try { await deleteSegment(segment.id); navigate("/program"); } catch (e) { toastErr(e); }
  };

  const actions = (
    <>
      <Link className="btn btn-ghost" to="/program"><ArrowLeft size={15} /> 回活動環節</Link>
      {!isNew && segment && <button className="btn btn-ghost" onClick={remove} disabled={busy}><Trash2 size={15} /> 刪除</button>}
      <button className="btn btn-primary" onClick={save} disabled={busy || !ready || (!isNew && !segment)}><Save size={15} /> {busy ? "儲存中…" : "儲存"}</button>
    </>
  );

  let body;
  if (error) body = <ErrorBox error={error} />;
  else if (!ready) body = <Loading />;
  else if (!isNew && !segment) body = <div className="panel"><ErrorBox error="找不到這個環節，可能已經被刪除了" /></div>;
  else body = (
    <div className="panel game-edit">
      <Field label="這個環節是哪個遊戲？" hint={(games || []).length === 0 ? "還沒有遊戲；一般環節（進場、致詞、敬酒…）直接填下面的名稱即可" : "選了會帶入遊戲名稱當環節名稱，時長與主持人沒填的也一併帶入；不是遊戲就選「不是遊戲環節」"}>
        <Select value={gameId} onChange={pickGame} options={gameOptions} aria-label="這個環節是哪個遊戲" />
      </Field>
      <Field label="環節名稱" required><input type="text" value={f.title} onChange={(e) => set("title", e.target.value)} autoFocus={!gameId} placeholder="例如：新人進場、證婚、第一次敬酒" /></Field>
      <div className="form-group grid-2">
        <Field label="開始時間"><Select value={f.start_time} onChange={(v) => set("start_time", v)} options={TIME_OPTIONS} aria-label="開始時間" /></Field>
        <Field label="預計長度（分鐘）" hint="填 0 表示未定"><NumberInput value={f.duration_min} onChange={(v) => set("duration_min", v)} /></Field>
      </div>
      <div className="form-group grid-2">
        <Field label="負責／主持" hint="主持人、伴郎伴娘、某位親友…"><input type="text" value={f.host} onChange={(e) => set("host", e.target.value)} /></Field>
        <Field label="狀態"><Select value={f.status} onChange={(v) => set("status", v)} options={toOptions(SEG_STATUS)} aria-label="狀態" /></Field>
      </div>
      <Field label="細節紀錄" hint="流程怎麼走、要準備的道具與音樂、要提醒誰…想到就記，可以寫很多行"><textarea rows={14} value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
      <div className="pl-actions" style={{ justifyContent: "flex-end", marginTop: 8 }}>{actions}</div>
    </div>
  );

  return (
    <div>
      <PageHead title={isNew ? "新增環節" : "編輯環節"} sub="名稱、開始時間、長度、負責的人、狀態，以及這個環節的細節紀錄" actions={actions} />
      {body}
    </div>
  );
}
