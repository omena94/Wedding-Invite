// 筆記頁（2026-09-10 起，原「備忘」）：像便條一樣依主題分區，每則可勾已處理、釘選，也可以一鍵排進行事曆。
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import Select from "../components/Select.jsx";
import { fetchMemos, updateMemo } from "../api.js";
import { NoteModal, NoteRows } from "./memoUi.jsx";
import { EventModal } from "./Timeline.jsx";
import { useTopics } from "./topics.jsx";
import { Empty, ErrorBox, Loading, PageHead, toastErr, toastOk, useLoader } from "./ui.jsx";

export default function Memos() {
  const [status, setStatus] = useState("open");
  const [topic, setTopic] = useState("");
  const { data, loading, error, reload } = useLoader(() => fetchMemos(), []);
  const { topics, reload: reloadTopics } = useTopics();
  const [modal, setModal] = useState(null);       // { note } 編輯 / { defaults } 新增
  const [schedule, setSchedule] = useState(null); // 要排進行事曆的筆記

  const groups = useMemo(() => {
    const list = (data || []).filter((n) => (status === "all" || (status === "done") === !!n.done) && (!topic || n.topic === topic));
    // 主題照共用清單的順序排，自訂的排後面；釘選的後端已排在最前
    const order = (t) => { const i = topics.indexOf(t); return i < 0 ? 999 : i; };
    const m = new Map();
    list.forEach((x) => { if (!m.has(x.topic)) m.set(x.topic, []); m.get(x.topic).push(x); });
    return Array.from(m.entries()).sort((a, b) => order(a[0]) - order(b[0]));
  }, [data, status, topic, topics]);
  const openCount = (data || []).filter((n) => !n.done).length;
  const usedTopics = useMemo(() => topics.filter((t) => (data || []).some((n) => n.topic === t)), [topics, data]);

  const close = () => setModal(null);
  const saved = () => { close(); reload(); reloadTopics(); };
  // 排進行事曆：用筆記的標題與主題建一筆事件，存好後把筆記連到那一筆
  const scheduled = async (task) => {
    const note = schedule;
    setSchedule(null);
    try {
      await updateMemo(note.id, { task_id: task.id });
      toastOk(task.due_date ? `已排在 ${task.due_date.replace(/-/g, "/")}` : "已加到行事曆的「還沒排日期」");
    } catch (e) {
      toastErr(e);
    }
    reload();
  };

  return (
    <div>
      <PageHead title="筆記" sub="要問店家的事、對方的回覆、突然想到的點子…隨手記在這裡，處理完就勾掉；需要動手做的可以一鍵排進行事曆"
        actions={<button className="btn btn-primary" onClick={() => setModal({ defaults: { topic: topic || "其他" } })}><Plus size={15} /> 新增筆記</button>} />

      <div className="panel">
        <div className="toolbar" style={{ marginBottom: 16 }}>
          <Select compact value={status} onChange={setStatus} aria-label="狀態" options={[{ value: "open", label: `未處理${openCount ? `（${openCount}）` : ""}` }, { value: "done", label: "已處理" }, { value: "all", label: "全部" }]} />
          <Select compact value={topic} onChange={setTopic} aria-label="主題" options={[{ value: "", label: "全部主題" }, ...usedTopics.map((t) => ({ value: t, label: t }))]} />
        </div>

        {loading ? <Loading /> : error ? <ErrorBox error={error} /> : groups.length === 0 ? (
          <Empty>{status === "open" ? "沒有待處理的筆記，太棒了" : "沒有資料"}</Empty>
        ) : groups.map(([name, list]) => (
          <div key={name} className="pl-month">
            <div className="pl-month-title">{name}<span className="muted-cell" style={{ marginLeft: 8, fontWeight: 400, fontSize: 12 }}>{list.filter((n) => !n.done).length} 未處理 · 共 {list.length} 則</span></div>
            <NoteRows notes={list} topics={topics} onChanged={reload} onEdit={(n) => setModal({ note: n })} onSchedule={(n) => setSchedule(n)} />
          </div>
        ))}
      </div>

      {modal && <NoteModal initial={modal.note} defaults={modal.defaults} topics={topics} onClose={close} onSaved={saved} />}
      {schedule && <EventModal defaults={{ title: schedule.title, topic: topics.includes(schedule.topic) ? schedule.topic : "", note: schedule.content }} topics={topics} onClose={() => setSchedule(null)} onSaved={scheduled} />}
    </div>
  );
}
