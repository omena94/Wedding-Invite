// 活動環節（只在後台）：上半是婚禮當天的環節流程（可調順序、每個環節有細節紀錄），
// 下半是點子庫（先把想法記下來，決定了再標採用、指到某個環節）。
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronDown, Clock, Gamepad2, Lightbulb, Pencil, Plus, Trash2 } from "lucide-react";
import Select from "../components/Select.jsx";
import { Checkbox } from "../components/Toggle.jsx";
import {
  createIdea, createSegment, deleteGame, deleteIdea, deleteSegment, fetchGames, fetchIdeas, fetchSegments, reorderSegments, updateGame, updateIdea, updateSegment,
} from "../api.js";
import { WEDDING_MINUTES, WEDDING_TIME_FROM, WEDDING_TIME_TO } from "../constants.js";
import { Empty, ErrorBox, Field, Loading, Modal, NumberInput, PageHead, confirmDelete, toastErr, toInt, useLoader } from "./ui.jsx";

const SEG_STATUS = { draft: "規劃中", confirmed: "已確定" };
const IDEA_STATUS = { idea: "想法", adopted: "採用", dropped: "不採用" };
const IDEA_PILL = { idea: "pill-groom", adopted: "pill-yes", dropped: "pill-no" };
const toOptions = (map) => Object.entries(map).map(([value, label]) => ({ value, label }));

// 時間選項：婚禮時段 12:00～15:00 每 5 分鐘（不用原生 time 輸入）
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fmtMin = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
// 時間軸用：有開始時間與長度就算得出結束時間；相鄰兩個都有時間才算空檔／重疊
const endOf = (s) => (s.start_time && s.duration_min > 0 ? toMin(s.start_time) + s.duration_min : null);
const TIME_OPTIONS = [{ value: "", label: "未定" }];
for (let t = toMin(WEDDING_TIME_FROM); t <= toMin(WEDDING_TIME_TO); t += 5) {
  const v = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  TIME_OPTIONS.push({ value: v, label: v });
}

export default function Program() {
  const { data: segments, loading, error, reload } = useLoader(fetchSegments, []);
  const { data: ideas, reload: reloadIdeas } = useLoader(() => fetchIdeas(), []);
  const { data: games, reload: reloadGames } = useLoader(fetchGames, []);
  const [gameOpen, setGameOpen] = useState({});
  const [open, setOpen] = useState({});
  const [ideaFilter, setIdeaFilter] = useState("all");
  const [modal, setModal] = useState(null); // { type: "segment"|"idea", item?, defaults? }（遊戲改用獨立頁面）

  const ideasBySegment = useMemo(() => {
    const m = {};
    (ideas || []).forEach((i) => { if (i.segment_id) (m[i.segment_id] ||= []).push(i); });
    return m;
  }, [ideas]);
  const gamesBySegment = useMemo(() => {
    const m = {};
    (games || []).forEach((g) => { if (g.segment_id) (m[g.segment_id] ||= []).push(g); });
    return m;
  }, [games]);
  const ideaList = useMemo(() => (ideas || []).filter((i) => ideaFilter === "all" || i.status === ideaFilter), [ideas, ideaFilter]);

  const close = () => setModal(null);
  const savedSegment = () => { close(); reload(); reloadIdeas(); reloadGames(); };
  const removeGame = async (g) => {
    if (!(await confirmDelete(g.name))) return;
    try { await deleteGame(g.id); reloadGames(); reload(); } catch (e) { toastErr(e); }
  };
  const savedIdea = () => { close(); reloadIdeas(); reload(); };

  const move = async (idx, dir) => {
    const ids = segments.map((s) => s.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    try { await reorderSegments(ids); reload(); } catch (e) { toastErr(e); }
  };
  // 依時間排序：有時間的照時間，未定時間的維持原相對順序排在後面
  const sortByTime = async () => {
    const timed = segments.filter((x) => x.start_time).sort((a, b) => toMin(a.start_time) - toMin(b.start_time));
    const untimed = segments.filter((x) => !x.start_time);
    try { await reorderSegments([...timed, ...untimed].map((x) => x.id)); reload(); } catch (e) { toastErr(e); }
  };
  const removeSegment = async (s) => {
    if (!(await confirmDelete(s.title))) return;
    try { await deleteSegment(s.id); reload(); reloadIdeas(); reloadGames(); } catch (e) { toastErr(e); }
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
          <span>環節流程 <span className="muted-cell" style={{ fontSize: 12.5, fontWeight: 400, letterSpacing: 0 }}>婚禮 {WEDDING_TIME_FROM}～{WEDDING_TIME_TO}，共 {WEDDING_MINUTES / 60} 小時</span></span>
          {total > 0 && <span className="muted-cell" style={{ fontSize: 12.5, fontWeight: 400, display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>已排 {segments.length} 個環節 · 合計約 {total} 分鐘{total > WEDDING_MINUTES ? <span className="pill pill-no" style={{ marginLeft: 6 }}>超過 {total - WEDDING_MINUTES} 分鐘</span> : <span style={{ marginLeft: 4 }}>· 還剩 {WEDDING_MINUTES - total} 分鐘</span>}<button className="btn btn-ghost btn-sm" onClick={sortByTime} title="有時間的照時間排，未定時間的排後面"><Clock size={12} /> 依時間排序</button></span>}
        </div>
        {loading ? <Loading /> : error ? <ErrorBox error={error} /> : !segments || segments.length === 0 ? (
          <Empty>還沒有環節。先從進場、致詞、敬酒、遊戲、送客這些開始排，時間之後再填也可以</Empty>
        ) : (
          <ol className="tl">
            {segments.map((s, idx) => {
              const isOpen = !!open[s.id];
              const linked = ideasBySegment[s.id] || [];
              const segGames = gamesBySegment[s.id] || [];
              const endMin = endOf(s);
              // 跟上一個環節的關係：空檔或重疊（兩邊都有時間才算）
              const prev = idx > 0 ? segments[idx - 1] : null;
              const prevEnd = prev ? endOf(prev) : null;
              const gap = prevEnd !== null && s.start_time ? toMin(s.start_time) - prevEnd : null;
              return (
                <li key={s.id} className={`tl-item${s.status === "confirmed" ? " confirmed" : ""}`}>
                  {gap !== null && gap !== 0 && (
                    <div className={`tl-gap${gap < 0 ? " overlap" : ""}`}>{gap > 0 ? `空檔 ${gap} 分鐘` : `與上一個環節重疊 ${-gap} 分鐘`}</div>
                  )}
                  <div className="tl-row">
                    <div className="tl-time">
                      {s.start_time ? <span>{s.start_time}</span> : <span className="muted-cell">未定</span>}
                      {endMin !== null ? <small>～{fmtMin(endMin)}</small> : s.duration_min > 0 ? <small>{s.duration_min} 分</small> : null}
                    </div>
                    <div className="tl-rail"><span className="tl-dot" /></div>
                    <div className="tl-body">
                      <button className="pl-linkbtn" onClick={() => setOpen((o) => ({ ...o, [s.id]: !isOpen }))} aria-expanded={isOpen}>
                        <ChevronDown size={14} style={{ transition: "transform .2s", transform: isOpen ? "rotate(180deg)" : "none" }} />
                        <strong>{s.title}</strong>
                        <span className={`pill ${s.status === "confirmed" ? "pill-yes" : "pill-warn"}`} style={{ marginLeft: 6 }}>{SEG_STATUS[s.status]}</span>
                        {s.duration_min > 0 && <span className="muted-cell" style={{ marginLeft: 6, fontSize: 12 }}>{s.duration_min} 分鐘</span>}
                        {linked.length > 0 && <span className="muted-cell" style={{ marginLeft: 6, fontSize: 12 }}>{linked.length} 個點子</span>}
                      </button>
                      {(s.host || segGames.length > 0) && (
                        <div className="tl-sub">
                          {s.host && <span>負責：{s.host}</span>}
                          {segGames.map((g) => <span key={g.id} className="pill pill-bride">遊戲 · {g.name}{g.duration_min > 0 ? ` ${g.duration_min} 分` : ""}</span>)}
                        </div>
                      )}
                      {isOpen && (
                        <div className="prog-detail">
                          {s.note ? <div className="prog-note">{s.note}</div> : <div className="muted-cell" style={{ fontSize: 12.5 }}>還沒有細節紀錄，按編輯把流程、道具、要注意的事寫進來</div>}
                          {segGames.length > 0 && (
                            <div className="prog-ideas">
                              {segGames.map((g) => <div key={g.id} className="prog-idea"><span className="pill pill-bride">遊戲</span><span><Link className="top-link" to={`/program/games/${g.id}`}>{g.name}</Link>{g.duration_min > 0 && <span className="muted-cell"> · {g.duration_min} 分</span>}{g.host && <span className="muted-cell"> · 主持 {g.host}</span>}{g.judge && <span className="muted-cell"> · 裁判 {g.judge}</span>}</span></div>)}
                            </div>
                          )}
                          {linked.length > 0 && (
                            <div className="prog-ideas">
                              {linked.map((i) => <div key={i.id} className="prog-idea"><span className={`pill ${IDEA_PILL[i.status]}`}>{IDEA_STATUS[i.status]}</span><span>{i.content}</span></div>)}
                            </div>
                          )}
                          <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setModal({ type: "idea", defaults: { segment_id: String(s.id) } })}><Lightbulb size={12} /> 給這個環節記點子</button>
                        </div>
                      )}
                    </div>
                    <div className="row-actions tl-actions">
                      <button className="btn btn-ghost btn-sm" title="往上" disabled={idx === 0} onClick={() => move(idx, -1)}><ArrowUp size={13} /></button>{" "}
                      <button className="btn btn-ghost btn-sm" title="往下" disabled={idx === segments.length - 1} onClick={() => move(idx, 1)}><ArrowDown size={13} /></button>{" "}
                      <button className="btn btn-ghost btn-sm" title="編輯" onClick={() => setModal({ type: "segment", item: s })}><Pencil size={13} /></button>{" "}
                      <button className="btn btn-ghost btn-sm" title="刪除" onClick={() => removeSegment(s)}><Trash2 size={13} /></button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="panel">
        <div className="panel-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <span>遊戲</span>
          <Link className="btn btn-ghost btn-sm" to="/program/games/new"><Gamepad2 size={13} /> 新增遊戲</Link>
        </div>
        {!games ? <Loading /> : games.length === 0 ? (
          <Empty>還沒有遊戲。把名稱、規則、內容、獎品、主持人、裁判、時長、道具記下來，之後指定在哪個環節玩</Empty>
        ) : (
          <div className="game-list">
            {games.map((g) => {
              const isOpen = !!gameOpen[g.id];
              return (
                <div key={g.id} className="game-card">
                  <div className="game-head">
                    <button className="pl-linkbtn" onClick={() => setGameOpen((o) => ({ ...o, [g.id]: !isOpen }))} aria-expanded={isOpen}>
                      <ChevronDown size={14} style={{ transition: "transform .2s", transform: isOpen ? "rotate(180deg)" : "none" }} />
                      <strong>{g.name}</strong>
                    </button>
                    <div className="game-meta">
                      {g.duration_min > 0 && <span className="pill pill-groom">{g.duration_min} 分鐘</span>}
                      {g.segment_title ? <span className="pill pill-groom">環節 · {g.segment_title}</span> : <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: "segment", defaults: { gameId: String(g.id) } })}><Plus size={12} /> 排進時間軸</button>}
                    </div>
                    <div className="row-actions">
                      <Link className="btn btn-ghost btn-sm" title="編輯" to={`/program/games/${g.id}`}><Pencil size={13} /></Link>{" "}
                      <button className="btn btn-ghost btn-sm" title="刪除" onClick={() => removeGame(g)}><Trash2 size={13} /></button>
                    </div>
                  </div>
                  <div className="game-people muted-cell">
                    主持人：{g.host || "未定"} · 裁判：{g.judge || "未定"}
                  </div>
                  {isOpen && (
                    <dl className="game-detail">
                      <dt>規則</dt><dd>{g.rules || <span className="muted-cell">未填</span>}</dd>
                      <dt>遊戲內容</dt><dd>{g.content || <span className="muted-cell">未填</span>}</dd>
                      <dt>獎品</dt><dd>{g.prize || <span className="muted-cell">未填</span>}</dd>
                      <dt>道具</dt><dd>{g.props || <span className="muted-cell">未填</span>}</dd>
                    </dl>
                  )}
                </div>
              );
            })}
          </div>
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

      {modal?.type === "segment" && <SegmentModal initial={modal.item} defaults={modal.defaults} games={games || []} onClose={close} onSaved={savedSegment} />}
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

function SegmentModal({ initial, defaults, games, onClose, onSaved }) {
  const isNew = !initial?.id;
  // 一個環節對應一個遊戲（新人：遊戲名稱基本上就是環節名稱）。從遊戲卡「排進時間軸」進來時 defaults.gameId 已指定
  const initialGame = (games || []).find((g) => (initial?.id && g.segment_id === initial.id) || (!initial?.id && defaults?.gameId && String(g.id) === defaults.gameId));
  const [gameId, setGameId] = useState(initialGame ? String(initialGame.id) : "");
  const [f, setF] = useState({
    title: "", start_time: "", duration_min: 0, host: "", note: "", status: "draft",
    ...(initial || {}),
    ...(!initial?.id && initialGame ? { title: initialGame.name, duration_min: initialGame.duration_min, host: initialGame.host } : {}),
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
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
    const elsewhere = g.segment_id && g.segment_id !== initial?.id ? `（目前在「${g.segment_title}」）` : "";
    return { value: String(g.id), label: `${g.name}${g.duration_min > 0 ? ` · ${g.duration_min} 分` : ""}${elsewhere}` };
  })];
  const save = async () => {
    if (!f.title.trim()) return toastErr(new Error("請填環節名稱"));
    setBusy(true);
    try {
      const body = { title: f.title.trim(), start_time: f.start_time || "", duration_min: toInt(f.duration_min), host: f.host, note: f.note, status: f.status };
      const saved = isNew ? await createSegment(body) : await updateSegment(initial.id, body);
      // 選的遊戲掛到這個環節；原本掛在這個環節、現在沒選的解除
      const changes = (games || []).filter((g) => (String(g.id) === gameId && g.segment_id !== saved.id) || (String(g.id) !== gameId && g.segment_id === saved.id));
      await Promise.all(changes.map((g) => updateGame(g.id, String(g.id) === gameId ? { segment_id: saved.id } : { clear_segment: true })));
      onSaved(saved);
    } catch (e) { toastErr(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={isNew ? "新增環節" : "編輯環節"} onClose={onClose} wide footer={<Footer onClose={onClose} onSave={save} busy={busy} />}>
      <Field label="這個環節是哪個遊戲？" hint={games.length === 0 ? "還沒有遊戲；一般環節（進場、致詞、敬酒…）直接填下面的名稱即可" : "選了會帶入遊戲名稱當環節名稱，時長與主持人沒填的也一併帶入；不是遊戲就選「不是遊戲環節」"}>
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
