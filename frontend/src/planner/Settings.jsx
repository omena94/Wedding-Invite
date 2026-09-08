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
          <Switch label="婚禮當天桌次查詢（/seat）" desc="開啟後賓客輸入姓名或電話就能看到桌號；桌號在「賓客」頁面編輯" value={values.seat_open === "1"} busy={!!busy}
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

      {/* 密碼說明 */}
      <div className="panel">
        <div className="panel-head"><div className="panel-title"><KeyRound size={18} /> 密碼與角色</div></div>
        <div style={{ fontSize: 13.5, lineHeight: 1.8 }}>
          <p>密碼不在網頁上改，而是在伺服器的 <code>backend/.env</code>：</p>
          <ul style={{ paddingLeft: 20 }}>
            <li><code>ADMIN_PASSWORD</code>：新人密碼，看得到全部。</li>
            <li><code>HELPER_PASSWORD</code>：幫手密碼，給招待或伴郎伴娘，登入後只有「賓客」頁面，看不到花費、合約與設定。留空 = 不啟用。</li>
          </ul>
          <p className="muted-cell">改完要重啟後端（<code>sudo systemctl restart wedding</code>），步驟在 部署說明.md。</p>
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
