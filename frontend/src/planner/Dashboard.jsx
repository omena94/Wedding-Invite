// 總覽：倒數、合約與付款、待辦、賓客摘要、目前階段（近期付款與廠商面板已於 2026-09-08 移除；2026-09-10 待辦不再顯示廠商名）
import { Link } from "react-router-dom";
import { CalendarClock, CalendarDays, Hourglass, Users, Wallet, Settings as SettingsIcon } from "lucide-react";
import { fetchDashboard, fetchStats } from "../api.js";
import { WEDDING_DATE, daysUntil, fmtDate, fmtDateTime, money } from "../constants.js";

import { ErrorBox, Loading, PageHead, useLoader } from "./ui.jsx";

export default function Dashboard() {
  const { data, loading, error } = useLoader(async () => {
    const [d, s] = await Promise.all([fetchDashboard(), fetchStats().catch(() => null)]);
    return { ...d, guests: s };
  });
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const days = daysUntil(WEDDING_DATE);
  const b = data.budget;
  const paidPct = b.contract_total ? Math.round((b.paid_total / b.contract_total) * 100) : 0;
  const stage = data.stage || {};
  const g = data.guests;

  return (
    <div>
      <PageHead title="總覽" sub={`婚禮 ${fmtDate(WEDDING_DATE)} · ${days > 0 ? `還有 ${days} 天` : days === 0 ? "就是今天" : "已圓滿完成"}`} />

      <div className="stats-grid">
        <Stat icon={<Hourglass size={20} />} value={days > 0 ? days : 0} unit="天" label="距離婚禮" />
        <Stat icon={<Wallet size={20} />} value={money(b.contract_total)} label="合約總額" />
        <Stat icon={<Wallet size={20} />} value={money(b.paid_total)} label={`已付 ${paidPct}%`} bar={paidPct} />
        <Stat icon={<CalendarClock size={20} />} value={money(b.unpaid_total)} label="合約尚欠（含未排分期）" />
      </div>

      {/* 2026-09-27 新人要求拿掉婚宴預估、小孩免費／半價／全價那一列（花費頁的婚宴面板還有） */}

      <div className="pl-grid-2">
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title"><CalendarDays size={18} /> 接下來的事 {data.open_tasks_total > 0 && <span className="pill pill-groom">{data.open_tasks_total}</span>}</div>
            <Link className="btn btn-ghost btn-sm" to="/timeline">行事曆</Link>
          </div>
          {data.open_tasks.length === 0 ? (
            <div className="empty-state" style={{ padding: 24 }}>行事曆上沒有還沒完成的事</div>
          ) : (
            <ul className="pl-list">
              {data.open_tasks.map((t) => (
                <li key={t.id}>
                  <div>
                    <div className="pl-list-title">{t.title}</div>
                    {t.topic && <div className="pl-list-sub">{t.topic}</div>}
                  </div>
                  <div className="muted-cell" style={{ whiteSpace: "nowrap" }}>{t.due_date ? `${fmtDate(t.due_date)}${t.due_time ? ` ${t.due_time}` : ""}${dueTag(t.due_date)}` : "未定"}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="pl-grid-2">
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title"><Users size={18} /> 賓客</div>
            <Link className="btn btn-ghost btn-sm" to="/guests">賓客名單</Link>
          </div>
          {g ? (
            <div className="mini-grid">
              <div className="mini"><div className="m-label">確認出席人數</div><div className="m-value">{g.total_guests}</div></div>
              <div className="mini"><div className="m-label">出席組數 / 不克</div><div className="m-value">{g.attending_responses}<small style={{ fontSize: 13, color: "var(--text-muted)" }}> / {g.declined_responses}</small></div></div>
              <div className="mini"><div className="m-label">第二階段已填</div><div className="m-value">{g.details_done}<small style={{ fontSize: 13, color: "var(--text-muted)" }}> / {g.attending_responses}</small></div></div>
            </div>
          ) : (
            <div className="empty-state" style={{ padding: 24 }}>讀不到賓客統計</div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div className="panel-title"><SettingsIcon size={18} /> 目前階段</div>
          <Link className="btn btn-ghost btn-sm" to="/settings">設定</Link>
        </div>
        <div className="pl-stage-row">
          <StageItem ok={true} label="第一階段意願調查" value="開放中（/rsvp）" />
          <StageItem ok={stage.phase2_open} label="第二階段出席與主餐" value={stage.phase2_open ? `已開放（自 ${fmtDateTime(stage.phase2_open_at)}）` : stage.phase2_open_at ? `預計 ${fmtDateTime(stage.phase2_open_at)} 開放` : "尚未開放"} />
          <StageItem ok={stage.seat_open} label="婚禮當天桌次查詢" value={stage.seat_open ? "開放中（/seat）" : "關閉"} />
          <StageItem ok={stage.photos_open} label="婚紗照分享頁" value={stage.photos_open ? "開放中（/photos）" : "關閉"} />
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, value, unit, label, bar }) {
  return (
    <div className="stat-card">
      <div className="ic">{icon}</div>
      <div className="value" style={{ fontSize: typeof value === "string" && value.length > 10 ? 22 : undefined }}>
        {value}{unit && <small> {unit}</small>}
      </div>
      <div className="label">{label}</div>
      {bar !== undefined && <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(100, bar)}%` }} /></div>}
    </div>
  );
}

function StageItem({ ok, label, value }) {
  return (
    <div className="pl-stage-item">
      <span className={`status-dot${ok ? "" : " off"}`} />
      <div>
        <div className="pl-list-title">{label}</div>
        <div className="pl-list-sub">{value}</div>
      </div>
    </div>
  );
}

export function dueTag(iso) {
  const d = daysUntil(iso);
  if (d === null) return "";
  if (d < 0) return `（逾期 ${-d} 天）`;
  if (d === 0) return "（今天）";
  if (d <= 14) return `（${d} 天後）`;
  return "";
}
