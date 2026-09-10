// 行事曆（2026-09-10 起，原「籌備進度」）：月曆格子看每一天有什麼事，點日期新增、點事件編輯；
// 手機自動改成當月列表。沒排日期的事放右邊「還沒排日期」，排進日期就進月曆。
// 一件事只有：標題、日期、時間、主題（顏色）、備註、完成。舊的「里程碑／指派」已拿掉。
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, CircleDollarSign, Pencil, Plus, Trash2 } from "lucide-react";
import Select from "../components/Select.jsx";
import DatePicker from "../components/DatePicker.jsx";
import { Checkbox } from "../components/Toggle.jsx";
import { createTask, deleteTask, fetchExpenses, fetchTasks, updateTask } from "../api.js";
import { daysUntil, fmtDate, money } from "../constants.js";
import { Empty, ErrorBox, Field, Loading, Modal, PageHead, confirmDelete, toastErr, useLoader } from "./ui.jsx";
import { TopicTag, topicColor, useTopics } from "./topics.jsx";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const CUSTOM = "__custom__";
// 時間選項：07:00～22:00 每 30 分鐘（不用原生 time 輸入）
const TIME_OPTIONS = [{ value: "", label: "整天（不指定時間）" }];
for (let m = 7 * 60; m <= 22 * 60; m += 30) {
  const v = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  TIME_OPTIONS.push({ value: v, label: v });
}

const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayIso = () => { const t = new Date(); return iso(t.getFullYear(), t.getMonth(), t.getDate()); };

function useMediaQuery(query) {
  const [match, setMatch] = useState(() => (typeof window !== "undefined" ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

export default function Timeline() {
  const { data, loading, error, reload } = useLoader(() => fetchTasks("all"), []);
  // 付款也標在月曆上（2026-09-10 新人要求）：每期分期的實付日或應付日、花費整筆的應付款日期；點了會到花費頁
  const { data: expenses } = useLoader(fetchExpenses, []);
  const [showPay, setShowPay] = useState(true);
  const payEvents = useMemo(() => {
    const out = [];
    (expenses || []).forEach((e) => {
      (e.payments || []).forEach((p) => {
        const date = p.paid_date || p.due_date;
        if (!date) return;
        out.push({ id: `p${p.id}`, pay: true, date, title: `${e.title}｜${p.title}`, amount: p.amount, done: !!p.paid_date, paid_date: p.paid_date, to: `/budget?expense=${e.id}&payment=${p.id}` });
      });
      if (e.due_date && e.unpaid_total > 0) out.push({ id: `e${e.id}`, pay: true, date: e.due_date, title: `${e.title}｜整筆應付`, amount: e.unpaid_total, done: false, to: `/budget?expense=${e.id}` });
    });
    return out;
  }, [expenses]);
  const { topics, reload: reloadTopics } = useTopics();
  const now = new Date();
  const [view, setView] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [topicFilter, setTopicFilter] = useState("");
  const [showDone, setShowDone] = useState(true);
  const [modal, setModal] = useState(null); // { event } 編輯 / { defaults } 新增
  const [dayModal, setDayModal] = useState(null); // 某一天的完整清單（格子塞不下時點「還有 N 件」或日期數字）
  const mobile = useMediaQuery("(max-width: 760px)");

  const events = useMemo(() => (data || []).filter((t) => (!topicFilter || t.topic === topicFilter) && (showDone || !t.done)), [data, topicFilter, showDone]);
  const byDate = useMemo(() => {
    const m = {};
    events.forEach((t) => { if (t.due_date) (m[t.due_date] ||= []).push(t); });
    // 付款沒有主題，篩了主題就不顯示；已付的算「已完成」
    if (showPay && !topicFilter) payEvents.forEach((p) => { if (showDone || !p.done) (m[p.date] ||= []).push(p); });
    Object.values(m).forEach((list) => list.sort((a, b) => (a.pay ? 1 : 0) - (b.pay ? 1 : 0) || (a.due_time || "99").localeCompare(b.due_time || "99") || String(a.id).localeCompare(String(b.id))));
    return m;
  }, [events, payEvents, showPay, showDone, topicFilter]);
  const undated = useMemo(() => events.filter((t) => !t.due_date), [events]);
  const usedTopics = useMemo(() => topics.filter((t) => (data || []).some((x) => x.topic === t)), [topics, data]);

  // 這個月的格子：從當月 1 號所在那週的週日，排到當月最後一天所在那週的週六
  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const start = new Date(view.y, view.m, 1 - first.getDay());
    const last = new Date(view.y, view.m + 1, 0);
    const end = new Date(view.y, view.m, last.getDate() + (6 - last.getDay()));
    const out = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      out.push({ date: iso(d.getFullYear(), d.getMonth(), d.getDate()), day: d.getDate(), inMonth: d.getMonth() === view.m });
    }
    return out;
  }, [view]);
  const monthEvents = useMemo(() => cells.filter((c) => c.inMonth && byDate[c.date]).map((c) => [c, byDate[c.date]]), [cells, byDate]);
  const today = todayIso();

  const go = (delta) => setView((v) => { const d = new Date(v.y, v.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const goToday = () => setView({ y: now.getFullYear(), m: now.getMonth() });
  const saved = () => { setModal(null); reload(); reloadTopics(); };
  const toggleDone = async (t) => {
    try { await updateTask(t.id, { done: !t.done }); reload(); } catch (e) { toastErr(e); }
  };
  const schedule = async (t, v) => {
    try { await updateTask(t.id, v ? { due_date: v } : { clear_due_date: true }); reload(); } catch (e) { toastErr(e); }
  };
  const remove = async (t) => {
    if (!(await confirmDelete(t.title))) return;
    try { await deleteTask(t.id); reload(); } catch (e) { toastErr(e); }
  };

  const listItem = (t) => t.pay ? (
    <div key={t.id} className={`cal-list-item pay${t.done ? " done" : ""}`}>
      <CircleDollarSign size={16} className="cal-pay-icon" />
      <Link className="cal-list-body" to={t.to}>
        <span className="cal-list-title">{t.title}</span>
        <span className={`pill ${t.done ? "pill-yes" : "pill-warn"}`}>{t.done ? `已付 ${money(t.amount)}` : `應付 ${money(t.amount)}`}</span>
      </Link>
    </div>
  ) : (
    <div key={t.id} className={`cal-list-item${t.done ? " done" : ""}`}>
      <Checkbox checked={t.done} onChange={() => toggleDone(t)} />
      <button type="button" className="cal-list-body" onClick={() => { setDayModal(null); setModal({ event: t }); }}>
        <span className="cal-list-title">{t.due_time && <span className="cal-ev-time">{t.due_time}</span>}{t.title}</span>
        <TopicTag topic={t.topic} topics={topics} small />
      </button>
    </div>
  );
  const dayTitle = (date) => { const d = new Date(date + "T00:00:00"); return `${d.getMonth() + 1} 月 ${d.getDate()} 日（週${WEEKDAYS[d.getDay()]}）`; };

  const eventChip = (t) => {
    if (t.pay) {
      return (
        <Link key={t.id} to={t.to} className={`cal-ev cal-ev-pay${t.done ? " done" : ""}`} title={`${t.title}：${t.done ? `已付 ${fmtDate(t.paid_date)}` : "應付"} ${money(t.amount)}（點一下到花費頁）`} onClick={(e) => e.stopPropagation()}>
          <CircleDollarSign size={11} className="cal-ev-icon" />
          <span className="cal-ev-title">{money(t.amount)} {t.title}</span>
        </Link>
      );
    }
    const c = topicColor(t.topic, topics);
    return (
      <button type="button" key={t.id} className={`cal-ev${t.done ? " done" : ""}`} style={{ background: c.bg, color: c.fg }} title={`${t.title}${t.topic ? `（${t.topic}）` : ""}`} onClick={(e) => { e.stopPropagation(); setModal({ event: t }); }}>
        {t.due_time && <span className="cal-ev-time">{t.due_time}</span>}
        <span className="cal-ev-title">{t.title}</span>
      </button>
    );
  };

  return (
    <div>
      <PageHead title="行事曆" sub="試穿、拍攝、選片、取件、婚禮…都排在月曆上；點日期新增，點事件可以改或勾完成"
        actions={<button className="btn btn-primary" onClick={() => setModal({ defaults: { due_date: view.y === now.getFullYear() && view.m === now.getMonth() ? today : iso(view.y, view.m, 1) } })}><Plus size={15} /> 新增</button>} />

      <div className="cal-layout">
        <div className="panel cal-main">
          <div className="cal-head">
            <div className="cal-nav">
              <button className="btn btn-ghost btn-sm" onClick={() => go(-1)} aria-label="上個月"><ChevronLeft size={16} /></button>
              <span className="cal-month">{view.y} 年 {view.m + 1} 月</span>
              <button className="btn btn-ghost btn-sm" onClick={() => go(1)} aria-label="下個月"><ChevronRight size={16} /></button>
              <button className="btn btn-ghost btn-sm" onClick={goToday}>今天</button>
            </div>
            <div className="toolbar">
              {usedTopics.length > 0 && (
                <Select compact value={topicFilter} onChange={setTopicFilter} aria-label="主題" options={[{ value: "", label: "全部主題" }, ...usedTopics.map((t) => ({ value: t, label: t }))]} />
              )}
              <Checkbox checked={showDone} onChange={setShowDone}>顯示已完成</Checkbox>
              <Checkbox checked={showPay} onChange={setShowPay}><CircleDollarSign size={13} style={{ verticalAlign: -2 }} /> 顯示付款</Checkbox>
            </div>
          </div>

          {loading ? <Loading /> : error ? <ErrorBox error={error} /> : mobile ? (
            // 手機：當月列表，一天一組
            monthEvents.length === 0 ? <Empty>這個月還沒有安排</Empty> : (
              <div className="cal-list">
                {monthEvents.map(([c, list]) => (
                  <div key={c.date} className={`cal-list-day${c.date === today ? " today" : ""}`}>
                    <div className="cal-list-date">{c.day} 日 <span className="muted-cell">週{WEEKDAYS[new Date(c.date + "T00:00:00").getDay()]}</span>{c.date === today && <span className="pill pill-warn" style={{ marginLeft: 6 }}>今天</span>}</div>
                    {list.map(listItem)}
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className="cal-grid" role="grid" aria-label={`${view.y} 年 ${view.m + 1} 月`}>
              {WEEKDAYS.map((w) => <div key={w} className="cal-weekday">{w}</div>)}
              {cells.map((c) => {
                const list = byDate[c.date] || [];
                const shown = list.slice(0, 3);
                return (
                  <div key={c.date} className={`cal-cell${c.inMonth ? "" : " out"}${c.date === today ? " today" : ""}`} role="gridcell" onClick={() => setModal({ defaults: { due_date: c.date } })} title="點一下在這天新增">
                    <button type="button" className="cal-day" title={list.length ? "看這天的全部" : undefined} onClick={(e) => { if (list.length) { e.stopPropagation(); setDayModal(c.date); } }}>{c.day}</button>
                    <div className="cal-evs">
                      {shown.map(eventChip)}
                      {list.length > shown.length && <button type="button" className="cal-more" onClick={(e) => { e.stopPropagation(); setDayModal(c.date); }}>還有 {list.length - shown.length} 件，看全部</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <aside className="panel cal-side">
          <div className="panel-head"><div className="panel-title"><CalendarDays size={16} /> 還沒排日期</div><span className="muted-cell" style={{ fontSize: 12 }}>{undated.length} 件</span></div>
          <div className="helper-text" style={{ marginBottom: 8 }}>想到要做但還沒決定哪天的事先放這裡，選了日期就會進月曆。</div>
          {undated.length === 0 ? <Empty>沒有還沒排日期的事</Empty> : (
            <ul className="cal-undated-list">
              {undated.map((t) => (
                <li key={t.id} className={`cal-undated${t.done ? " done" : ""}`}>
                  <div className="cal-undated-head">
                    <Checkbox checked={t.done} onChange={() => toggleDone(t)} />
                    <span className="cal-undated-title">{t.title} <TopicTag topic={t.topic} topics={topics} small /></span>
                    <span className="row-actions">
                      <button className="btn btn-ghost btn-sm" title="編輯" onClick={() => setModal({ event: t })}><Pencil size={13} /></button>{" "}
                      <button className="btn btn-ghost btn-sm" title="刪除" onClick={() => remove(t)}><Trash2 size={13} /></button>
                    </span>
                  </div>
                  <div className="pl-date-inline"><DatePicker value="" onChange={(v) => schedule(t, v)} placeholder="排日期" /></div>
                </li>
              ))}
            </ul>
          )}
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setModal({ defaults: {} })}><Plus size={13} /> 新增（先不排日期）</button>
        </aside>
      </div>

      {modal && <EventModal initial={modal.event} defaults={modal.defaults} topics={topics} onClose={() => setModal(null)} onSaved={saved} onDeleted={saved} />}
      {dayModal && (
        <Modal title={dayTitle(dayModal)} onClose={() => setDayModal(null)}
          footer={<><button type="button" className="btn btn-ghost" onClick={() => setDayModal(null)}>關閉</button><button type="button" className="btn btn-primary" onClick={() => { setDayModal(null); setModal({ defaults: { due_date: dayModal } }); }}><Plus size={14} /> 在這天新增</button></>}>
          {(byDate[dayModal] || []).length === 0 ? <Empty>這天沒有安排</Empty> : <div className="cal-list-day">{(byDate[dayModal] || []).map(listItem)}</div>}
        </Modal>
      )}
    </div>
  );
}

/**
 * 行事曆事件的新增／編輯視窗。筆記頁「排進行事曆」也用它。
 * - initial：既有事件（編輯）；defaults：新增時的預設值 { title, due_date, topic, note }
 */
export function EventModal({ initial, defaults, topics, onClose, onSaved, onDeleted }) {
  const isNew = !initial?.id;
  const [f, setF] = useState(() => {
    const base = { title: "", topic: "", due_date: "", due_time: "", note: "", done: false, ...(defaults || {}), ...(initial || {}) };
    return { ...base, due_date: base.due_date || "" }; // 後端沒日期是 null，表單一律用空字串
  });
  const [customTopic, setCustomTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const topicOpts = !f.topic || topics.includes(f.topic) || f.topic === CUSTOM ? topics : [...topics, f.topic];
  const options = [{ value: "", label: "（不分主題）" }, ...topicOpts.map((t) => ({ value: t, label: t })), { value: CUSTOM, label: "＋ 自訂主題…" }];

  const save = async () => {
    if (!f.title.trim()) return toastErr(new Error("請填這件事的名稱"));
    const topic = (f.topic === CUSTOM ? customTopic : f.topic || "").trim();
    setBusy(true);
    try {
      const body = { title: f.title.trim(), topic, due_time: f.due_time || "", note: f.note || "", done: !!f.done };
      if (f.due_date) body.due_date = f.due_date; else if (!isNew) body.clear_due_date = true;
      const saved = isNew ? await createTask(body) : await updateTask(initial.id, body);
      onSaved(saved);
    } catch (e) {
      toastErr(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await confirmDelete(initial.title))) return;
    setBusy(true);
    try { await deleteTask(initial.id); onDeleted?.(); } catch (e) { toastErr(e); } finally { setBusy(false); }
  };
  const d = daysUntil(f.due_date);
  return (
    <Modal title={isNew ? "新增到行事曆" : "編輯"} onClose={onClose} wide
      footer={<>
        {!isNew && <button type="button" className="btn btn-ghost" style={{ color: "var(--rose-accent)", marginRight: "auto" }} onClick={remove} disabled={busy}><Trash2 size={14} /> 刪除</button>}
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>取消</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "儲存中…" : "儲存"}</button>
      </>}>
      <Field label="這件事" required><input type="text" value={f.title} onChange={(e) => set("title", e.target.value)} autoFocus placeholder="例如：林莉婚紗試穿" /></Field>
      <div className="form-group grid-2">
        <Field label="日期" hint={f.due_date && d !== null ? (d < 0 ? `${-d} 天前` : d === 0 ? "就是今天" : `${d} 天後`) : "留空 = 先放在「還沒排日期」"}><DatePicker value={f.due_date} onChange={(v) => set("due_date", v)} placeholder="還沒排日期" /></Field>
        <Field label="時間"><Select value={f.due_time || ""} onChange={(v) => set("due_time", v)} options={TIME_OPTIONS} aria-label="時間" /></Field>
      </div>
      <div className="form-group grid-2">
        <Field label="主題" hint="月曆上用顏色分，跟筆記共用"><Select value={f.topic || ""} onChange={(v) => set("topic", v)} options={options} aria-label="主題" /></Field>
        {f.topic === CUSTOM && <Field label="自訂主題"><input type="text" value={customTopic} onChange={(e) => setCustomTopic(e.target.value)} placeholder="例如：花藝" autoFocus /></Field>}
      </div>
      <Field label="備註"><textarea rows={3} value={f.note || ""} onChange={(e) => set("note", e.target.value)} placeholder="地點、要帶的東西、聯絡人…" /></Field>
      {!isNew && <Checkbox checked={!!f.done} onChange={(v) => set("done", v)}>已完成</Checkbox>}
      {!isNew && initial.due_date && <div className="helper-text" style={{ marginTop: 6 }}>原本排在 {fmtDate(initial.due_date)}{initial.due_time ? ` ${initial.due_time}` : ""}</div>}
    </Modal>
  );
}
