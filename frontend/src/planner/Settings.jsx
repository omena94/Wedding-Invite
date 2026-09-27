// 設定：第二階段開放時間、桌次查詢與婚紗照開關、婚禮資訊頁文案
import { useEffect, useState } from "react";
import { CalendarClock, Info, KeyRound, Save } from "lucide-react";
import DateTimePicker from "../components/DateTimePicker.jsx";
import Toggle from "../components/Toggle.jsx";
import { fetchPlannerSettings, savePlannerSettings } from "../api.js";
import { fmtDateTime, isoToLocal, localToISO } from "../constants.js";
import { ErrorBox, Field, Loading, PageHead, toastErr, toastOk, useLoader } from "./ui.jsx";

const INFO_FIELDS = [
  { key: "info_transport", label: "交通方式", rows: 4, hint: "捷運、開車、停車、接駁…" },
  { key: "info_notes", label: "其他提醒", rows: 4, hint: "禮金、小孩、攝影、婚禮遊戲…" },
];

// 誰能做什麼（跟後端的權限設定對應；改了後端記得一起改這張表）
const PERMISSIONS = [
  { section: "賓客頁面（不用登入）" },
  { name: "首頁、婚禮資訊、第一階段出席回覆", couple: true, helper: true, guest: true },
  { name: "第二階段餐點確認", couple: true, helper: true, guest: "開放後", note: "設定頁的「第二階段開放時間」" },
  { name: "桌次查詢與座位地圖", couple: true, helper: true, guest: "開放後", note: "設定頁的「桌次查詢」開關；用電話或 Email 查才看得到當天的話" },
  { name: "婚紗照分享頁", couple: true, helper: true, guest: "開放後", note: "設定頁的「婚紗照」開關；未開放時登入者可預覽" },
  { section: "後台" },
  { name: "賓客名單：看名單、統計、編輯與刪除賓客、匯出 Excel", couple: true, helper: true, guest: false },
  { name: "賓客名單：手動新增賓客、群發 Email", couple: true, helper: false, guest: false },
  { name: "座位圖：看正式廳的座位、預覽賓客畫面（帶位用）", couple: true, helper: true, guest: false, note: "幫手是唯讀，看不到底圖與當天的話" },
  { name: "座位圖：擺桌椅、安排座位、廳設定", couple: true, helper: false, guest: false },
  { name: "喜餅：看送餅名單、勾簽收確認（分批、代領）", couple: true, helper: true, guest: false },
  { name: "喜餅：帶入賓客、編輯送餅對象、廠商、款式、訂購與費用、匯出", couple: true, helper: false, guest: false },
  { name: "總覽、花費、行事曆、筆記、活動環節、文件庫、照片、設定", couple: true, helper: false, guest: false },
];

export default function SettingsPage() {
  const { data, loading, error, setData } = useLoader(fetchPlannerSettings, []);
  const [values, setValues] = useState(null);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (data) setValues(v => v || data.values);
  }, [data]);

  if (error) return <ErrorBox error={error} />;
  if (loading || !values) return <Loading />;

  const stage = data.stage;
  const set = (k, v) => setValues((x) => ({ ...x, [k]: v }));

  const save = async (patch, label) => {
    setBusy(label);
    try {
      const r = await savePlannerSettings(patch);
      setData(r);
      setValues(v => ({...v, ...Object.fromEntries(Object.keys(patch).map(k => [k, r.values[k]]))}));
      toastOk("已儲存");
    } catch (e) {
      toastErr(e);
    } finally {
      setBusy("");
    }
  };

  const nowLocal = () => {
    const d = new Date();
    d.setSeconds(0, 0);
    return isoToLocal(d.toISOString());
  };

  return (
    <div>
      <PageHead title="設定" sub="賓客端的開關與文案都在這裡，改完立即生效" />

      {/* 第二階段 */}
      <div className="panel">
        <div className="panel-head"><div className="panel-title"><CalendarClock size={18} /> 第二階段（出席與主餐確認）</div></div>
        <div className="pl-stage-banner">
          <span className={`status-dot${stage.phase2_open ? "" : " off"}`} />
          {stage.phase2_open
            ? <>目前<strong>已開放</strong>（自 {fmtDateTime(stage.phase2_open_at)} 起）</>
            : stage.phase2_open_at
              ? <>目前<strong>尚未開放</strong>，預計 {fmtDateTime(stage.phase2_open_at)} 自動開放</>
              : <>目前<strong>尚未開放</strong>，也還沒設定開放時間</>}
        </div>
        <div className="form-group grid-2">
          <Field label="開放時間（台灣時間）" hint="時間到了首頁與 /details 會自動切換，不用再改任何東西；群發信可以在這之後寄">
            <DateTimePicker value={isoToLocal(values.phase2_open_at)} onChange={(v) => set("phase2_open_at", v ? localToISO(v) : "")} placeholder="選擇開放日期" />
          </Field>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", paddingBottom: 18 }}>
            <button className="btn btn-primary" disabled={!!busy} onClick={() => save({ phase2_open_at: values.phase2_open_at || "" }, "p2")}><Save size={14} /> 儲存時間</button>
            <button className="btn btn-ghost" disabled={!!busy} onClick={() => save({ phase2_open_at: localToISO(nowLocal()) }, "p2now")}>立即開放</button>
            <button className="btn btn-ghost" disabled={!!busy} onClick={() => save({ phase2_open_at: "" }, "p2off")}>關閉（清除時間）</button>
          </div>
        </div>
      </div>

      {/* 開關 */}
      <div className="panel">
        <div className="panel-head"><div className="panel-title"><Info size={18} /> 賓客頁面開關</div></div>
        <div className="pl-switch-list">
          <Switch label="婚禮當天桌次查詢（/seat）" desc="開啟後賓客輸入姓名、電話或 Email 就能看到自己的桌子與座位；座位在「座位圖」安排" value={values.seat_open === "1"} busy={!!busy}
            onChange={(v) => save({ seat_open: v ? "1" : "" }, "seat")} />
          <Switch label="婚紗照分享頁（/photos）" desc="只會顯示「文件庫」裡標記為公開的照片" value={values.photos_open === "1"} busy={!!busy}
            onChange={(v) => save({ photos_open: v ? "1" : "" }, "photos")} />
        </div>
      </div>

      {/* 婚禮資訊文案 */}
      <div className="panel">
        <div className="panel-head">
          <div className="panel-title"><Info size={18} /> 婚禮資訊頁（/info）文案</div>
          <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => save(Object.fromEntries(INFO_FIELDS.map((f) => [f.key, values[f.key] || ""])), "info")}><Save size={13} /> 儲存文案</button>
        </div>
        <div className="muted-cell" style={{ fontSize: 12.5, marginBottom: 12 }}>日期、時間、地點、停車資訊已固定寫在頁面上；這裡是補充說明，留空的欄位不會顯示。</div>
        {INFO_FIELDS.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint}>
            {f.rows === 1
              ? <input type="text" value={values[f.key] || ""} onChange={(e) => set(f.key, e.target.value)} />
              : <textarea rows={f.rows} value={values[f.key] || ""} onChange={(e) => set(f.key, e.target.value)} />}
          </Field>
        ))}
      </div>

      {/* 權限一覽（2026-09-27 新人要求有地方看誰能做什麼）：對照後端的 CoupleRequired／AdminRequired 與賓客頁開關 */}
      <div className="panel">
        <div className="panel-head"><div className="panel-title"><KeyRound size={18} /> 權限一覽</div><span className="helper-text">新人＝用新人密碼登入；幫手＝用幫手密碼登入（招待、伴郎伴娘）；賓客＝不用登入</span></div>
        <div className="table-wrap"><table className="perm-table">
          <thead><tr><th>功能</th><th>新人</th><th>幫手</th><th>賓客</th></tr></thead>
          <tbody>
            {PERMISSIONS.map((row) => (
              row.section ? <tr key={row.section} className="perm-section"><td colSpan={4}>{row.section}</td></tr>
              : <tr key={row.name}><td>{row.name}{row.note && <div className="muted-cell" style={{ fontSize: 11.5 }}>{row.note}</div>}</td>{[row.couple, row.helper, row.guest].map((v, i) => <td key={i} className="perm-cell">{v === true ? <span className="perm-yes">可以</span> : v === false ? <span className="perm-no">—</span> : <span className="perm-part">{v}</span>}</td>)}</tr>
            ))}
          </tbody>
        </table></div>
        <div style={{ fontSize: 13.5, lineHeight: 1.8, marginTop: 12 }}>
          <p>密碼不在網頁上改，而是在伺服器的 <code>backend/.env</code>：<code>ADMIN_PASSWORD</code> 是新人密碼、<code>HELPER_PASSWORD</code> 是幫手密碼（留空 = 不啟用幫手）。改完要重啟後端（<code>sudo systemctl restart wedding</code>），步驟在 部署說明.md。</p>
        </div>
      </div>
    </div>
  );
}

function Switch({ label, desc, value, onChange, busy }) {
  return (
    <div className="pl-switch" onClick={() => !busy && onChange(!value)}>
      <Toggle checked={value} disabled={busy} onChange={onChange} label={label} />
      <div>
        <div className="pl-list-title">{label} <span className={`pill ${value ? "pill-yes" : "pill-no"}`}>{value ? "開放中" : "關閉"}</span></div>
        <div className="pl-list-sub">{desc}</div>
      </div>
    </div>
  );
}
