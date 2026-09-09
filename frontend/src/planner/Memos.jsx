// 備忘頁：像便條一樣依主題分區（飯店、婚紗、喜餅…），每條可勾已確認並記答案。
// 掛在籌備進度或花費底下的備忘也會出現在這裡，並標示掛在哪。
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import Select from "../components/Select.jsx";
import { fetchExpenses, fetchMemos, fetchTasks } from "../api.js";
import { MemoModal, MemoRows, topicList } from "./memoUi.jsx";
import { Empty, ErrorBox, Loading, PageHead, useLoader } from "./ui.jsx";

export default function Memos() {
  const [status, setStatus] = useState("open");
  const [topic, setTopic] = useState("");
  const { data, loading, error, reload } = useLoader(() => fetchMemos(), []);
  const { data: tasks } = useLoader(() => fetchTasks("all"), []);
  const { data: expenses } = useLoader(fetchExpenses, []);
  const [modal, setModal] = useState(null);

  const topics = useMemo(() => topicList(data), [data]);
  const groups = useMemo(() => {
    const list = (data || []).filter((m) => (status === "all" || (status === "done") === !!m.confirmed) && (!topic || m.topic === topic));
    const m = new Map();
    list.forEach((x) => { if (!m.has(x.topic)) m.set(x.topic, []); m.get(x.topic).push(x); });
    return Array.from(m.entries());
  }, [data, status, topic]);
  const openCount = (data || []).filter((m) => !m.confirmed).length;

  const close = () => setModal(null);
  const saved = () => { close(); reload(); };

  return (
    <div>
      <PageHead title="備忘" sub="要問飯店、婚紗店、喜餅店…的事先記下來，問到答案就勾已確認；掛在籌備進度或花費底下的備忘也會在這裡出現"
        actions={<button className="btn btn-primary" onClick={() => setModal({ defaults: { topic: topic || "其他" } })}><Plus size={15} /> 新增備忘</button>} />

      <div className="panel">
        <div className="toolbar" style={{ marginBottom: 16 }}>
          <Select compact value={status} onChange={setStatus} aria-label="狀態" options={[{ value: "open", label: `未確認${openCount ? `（${openCount}）` : ""}` }, { value: "done", label: "已確認" }, { value: "all", label: "全部" }]} />
          <Select compact value={topic} onChange={setTopic} aria-label="主題" options={[{ value: "", label: "全部主題" }, ...topics.map((t) => ({ value: t, label: t }))]} />
        </div>

        {loading ? <Loading /> : error ? <ErrorBox error={error} /> : groups.length === 0 ? (
          <Empty>{status === "open" ? "沒有待確認的事，太棒了" : "沒有資料"}</Empty>
        ) : groups.map(([name, list]) => (
          <div key={name} className="pl-month">
            <div className="pl-month-title">{name}<span className="muted-cell" style={{ marginLeft: 8, fontWeight: 400, fontSize: 12 }}>{list.filter((m) => !m.confirmed).length} 待確認 · 共 {list.length} 條</span></div>
            <MemoRows memos={list} onChanged={reload} onEdit={(m) => setModal({ memo: m })} showLink />
          </div>
        ))}
      </div>

      {modal && <MemoModal initial={modal.memo} defaults={modal.defaults} topics={topics} tasks={tasks || []} expenses={expenses || []} onClose={close} onSaved={saved} />}
    </div>
  );
}
