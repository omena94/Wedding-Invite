// 時程與待辦：依月份分組，里程碑與待辦混排
import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import Select from "../components/Select.jsx";
import { Checkbox } from "../components/Toggle.jsx";
import { deleteTask, fetchTasks, fetchVendors, updateTask } from "../api.js";
import { ASSIGNEE, daysUntil, fmtDate } from "../constants.js";
import { TaskModal } from "./modals.jsx";
import { Empty, ErrorBox, Loading, PageHead, confirmDelete, toastErr, useLoader } from "./ui.jsx";

export default function Timeline() {
  const [status, setStatus] = useState("open");
  const [assignee, setAssignee] = useState("");
  const { data, loading, error, reload } = useLoader(() => fetchTasks(status), [status]);
  const { data: vendors } = useLoader(() => fetchVendors(), []);
  const [modal, setModal] = useState(null);

  const groups = useMemo(() => {
    const list = (data || []).filter((t) => !assignee || t.assignee === assignee || t.assignee === "both");
    const m = new Map();
    list.forEach((t) => {
      const key = t.due_date ? t.due_date.slice(0, 7).replace("-", " 年 ") + " 月" : "未定日期";
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(t);
    });
    return Array.from(m.entries());
  }, [data, assignee]);

  const close = () => setModal(null);
  const saved = () => { close(); reload(); };
  const toggle = async (t) => {
    try { await updateTask(t.id, { done: !t.done }); reload(); } catch (e) { toastErr(e); }
  };
  const remove = async (t) => {
    if (!(await confirmDelete(t.title))) return;
    try { await deleteTask(t.id); reload(); } catch (e) { toastErr(e); }
  };

  return (
    <div>
      <PageHead title="時程與待辦" sub="試穿、拍攝、選片、取件、婚禮…把該做的事和日期記下來，總覽會提醒"
        actions={<button className="btn btn-primary" onClick={() => setModal({})}><Plus size={15} /> 新增</button>} />

      <div className="panel">
        <div className="toolbar" style={{ marginBottom: 16 }}>
          <Select compact value={status} onChange={setStatus} options={[{ value: "open", label: "未完成" }, { value: "done", label: "已完成" }, { value: "all", label: "全部" }]} />
          <Select compact value={assignee} onChange={setAssignee} options={[{ value: "", label: "所有人" }, { value: "groom", label: "新郎（含兩人）" }, { value: "bride", label: "新娘（含兩人）" }]} />
        </div>

        {loading ? <Loading /> : error ? <ErrorBox error={error} /> : groups.length === 0 ? (
          <Empty>{status === "open" ? "沒有未完成的事，太棒了" : "沒有資料"}</Empty>
        ) : groups.map(([month, list]) => (
          <div key={month} className="pl-month">
            <div className="pl-month-title">{month}</div>
            <ul className="pl-list">
              {list.map((t) => {
                const d = daysUntil(t.due_date);
                const overdue = !t.done && d !== null && d < 0;
                return (
                  <li key={t.id} style={{ opacity: t.done ? 0.55 : 1 }}>
                    <div className="pl-task-row">
                      <Checkbox checked={t.done} onChange={() => toggle(t)} />
                      <div style={{ minWidth: 0 }}>
                        <div className="pl-list-title" style={{ textDecoration: t.done ? "line-through" : "none" }}>
                          {t.kind === "milestone" && <span className="pill pill-bride" style={{ marginRight: 6 }}>里程碑</span>}
                          {t.title}
                        </div>
                        <div className="pl-list-sub">
                          {t.due_date ? fmtDate(t.due_date) : "未定日期"}
                          {!t.done && d !== null && (overdue ? <span className="pill pill-no" style={{ marginLeft: 6 }}>逾期 {-d} 天</span> : d === 0 ? <span className="pill pill-warn" style={{ marginLeft: 6 }}>今天</span> : d <= 14 ? <span className="pill pill-warn" style={{ marginLeft: 6 }}>{d} 天後</span> : null)}
                          {" · "}{ASSIGNEE[t.assignee]}
                          {t.vendor_id && <> · {t.vendor_name}</>}
                          {t.note && <div style={{ whiteSpace: "pre-wrap" }}>{t.note}</div>}
                        </div>
                      </div>
                    </div>
                    <div className="row-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => setModal({ task: t })}><Pencil size={13} /></button>{" "}
                      <button className="btn btn-ghost btn-sm" onClick={() => remove(t)}><Trash2 size={13} /></button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {modal && <TaskModal vendors={vendors || []} initial={modal.task} onClose={close} onSaved={saved} />}
    </div>
  );
}
