// 設定：第二階段開放時間、桌次查詢與婚紗照開關、婚禮資訊頁文案
import { useEffect, useState } from "react";
import { Info, KeyRound, Save } from "lucide-react";
import Toggle, { Checkbox } from "../components/Toggle.jsx";
import { fetchPlannerSettings, savePlannerSettings } from "../api.js";
import { fmtDateTime, isoToLocal, localToISO } from "../constants.js";
import { ErrorBox, Field, Loading, PageHead, toastErr, toastOk, useLoader } from "./ui.jsx";

const INFO_FIELDS = [
  { key: "info_transport", label: "交通方式", rows: 4, hint: "捷運、開車、停車、接駁…" },
  { key: "info_notes", label: "其他提醒", rows: 4, hint: "禮金、小孩、攝影、婚禮遊戲…" },
];

// 功能鑰匙（跟後端 permissions.py 的 PERMISSIONS 一致；新人的「設定」拿不掉）
const PERM_ROWS = [
  ["guests_view", "賓客名單：看名單、統計、匯出 Excel"],
  ["guests_edit", "賓客名單：編輯與刪除賓客"],
  ["guests_create", "賓客名單：手動新增賓客"],
  ["broadcast", "賓客名單：群發 Email"],
  ["seating_view", "座位圖：看正式廳的座位、預覽賓客畫面（帶位用）"],
  ["seating_edit", "座位圖：擺桌椅、安排座位、廳設定"],
  ["gifts_view", "喜餅：看送餅名單"],
  ["gifts_pickup", "喜餅：勾簽收確認（分批、代領）"],
  ["gifts_manage", "喜餅：帶入賓客、編輯送餅對象、廠商、款式、訂購與費用、匯出"],
  ["budget", "花費（含婚宴預估）"],
  ["calendar", "行事曆"],
  ["notes", "筆記"],
  ["program", "活動環節"],
  ["files", "文件庫"],
  ["photos", "婚紗照"],
  ["guest_photos", "當天照片（賓客上傳的原檔：看、下載、刪除、開關）"],
  ["settings", "設定（含這張權限表）"],
];
const DEFAULT_PERMS = { couple: PERM_ROWS.map(([k]) => k), helper: ["guests_view", "guests_edit", "seating_view", "gifts_view", "gifts_pickup"] };
const parsePerms = (raw) => {
  try { const v = JSON.parse(raw || ""); return { couple: Array.isArray(v.couple) ? v.couple : DEFAULT_PERMS.couple, helper: Array.isArray(v.helper) ? v.helper : DEFAULT_PERMS.helper }; }
  catch { return { ...DEFAULT_PERMS }; }
};

export default function SettingsPage() {
  const { data, loading, error, setData } = useLoader(fetchPlannerSettings, []);
  const [values, setValues] = useState(null);
  const [busy, setBusy] = useState("");
  const [perms, setPerms] = useState(null); // 權限矩陣（新人／幫手各自的鑰匙）

  useEffect(() => {
    if (data) { setValues(v => v || data.values); setPerms((p) => p || parsePerms(data.values.role_permissions)); }
  }, [data]);

  if (error) return <ErrorBox error={error} />;
  if (loading || !values || !perms) return <Loading />;
  const permsDirty = JSON.stringify(perms) !== JSON.stringify(parsePerms(values.role_permissions));

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

      {/* 目前階段（2026-09-28）：卡片式，每張卡一個開關直接開關（新人要求維持卡片樣式）。第二階段打開＝現在開放、關掉＝關閉 */}
      <div className="panel">
        <div className="panel-head"><div className="panel-title"><Info size={18} /> 目前階段</div><span className="helper-text">直接切換就生效</span></div>
        <div className="pl-stage-row">
          <StageCard on locked label="第一階段意願調查" value="一直開放（/rsvp）" />
          <StageCard on={!!stage.phase2_open} busy={!!busy} label="第二階段出席與主餐" value={stage.phase2_open ? `已開放（自 ${fmtDateTime(stage.phase2_open_at)}）` : "尚未開放"}
            onChange={(v) => save({ phase2_open_at: v ? localToISO(nowLocal()) : "" }, "p2")} />
          <StageCard on={values.seat_open === "1"} busy={!!busy} label="婚禮當天桌次查詢" value={values.seat_open === "1" ? "開放中（/seat）" : "關閉"}
            onChange={(v) => save({ seat_open: v ? "1" : "0" }, "seat")} />
          <StageCard on={values.guest_upload_open === "1"} busy={!!busy} label="婚禮當天照片上傳" value={values.guest_upload_open === "1" ? "開放中（/upload）" : "關閉"}
            onChange={(v) => save({ guest_upload_open: v ? "1" : "0" }, "upload")} />
          <StageCard on={values.photos_open === "1"} busy={!!busy} label="婚紗照分享頁" value={values.photos_open === "1" ? "開放中（/photos）" : "關閉"}
            onChange={(v) => save({ photos_open: v ? "1" : "0" }, "photos")} />
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

      {/* 權限（2026-09-27）：登入方式不變，但每個角色能用什麼改在這裡勾；賓客欄是各頁的開放開關 */}
      <div className="panel">
        <div className="panel-head"><div className="panel-title"><KeyRound size={18} /> 權限</div><span className="helper-text">新人＝新人密碼登入；幫手＝幫手密碼登入（招待、伴郎伴娘）；賓客＝不用登入</span></div>
        <div className="table-wrap"><table className="perm-table">
          <thead><tr><th>功能</th><th>新人</th><th>幫手</th><th>賓客</th></tr></thead>
          <tbody>
            <tr className="perm-section"><td colSpan={4}>賓客頁面（不用登入）</td></tr>
            <tr><td>首頁、婚禮資訊、第一階段出席回覆</td><td className="perm-cell"><span className="perm-yes">可以</span></td><td className="perm-cell"><span className="perm-yes">可以</span></td><td className="perm-cell"><span className="perm-yes">可以</span></td></tr>
            <tr><td>第二階段餐點確認<div className="muted-cell" style={{ fontSize: 11.5 }}>由上方「第二階段開放時間」決定</div></td><td className="perm-cell"><span className="perm-yes">可以</span></td><td className="perm-cell"><span className="perm-yes">可以</span></td><td className="perm-cell"><span className={`pill ${stage.phase2_open ? "pill-yes" : "pill-no"}`}>{stage.phase2_open ? "開放中" : "未開放"}</span></td></tr>
            <tr><td>桌次查詢與座位地圖<div className="muted-cell" style={{ fontSize: 11.5 }}>用電話或 Email 查才看得到當天的話</div></td><td className="perm-cell"><span className="perm-yes">可以</span></td><td className="perm-cell"><span className="perm-yes">可以</span></td><td className="perm-cell"><Checkbox checked={values.seat_open === "1"} disabled={!!busy} onChange={(v) => save({ seat_open: v ? "1" : "0" }, "seat")}>{values.seat_open === "1" ? "開放中" : "關閉"}</Checkbox></td></tr>
            <tr><td>當天照片上傳（/upload）<div className="muted-cell" style={{ fontSize: 11.5 }}>賓客傳原檔給你們，看不到彼此的照片</div></td><td className="perm-cell"><span className="perm-yes">可以</span></td><td className="perm-cell"><span className="perm-yes">可以</span></td><td className="perm-cell"><Checkbox checked={values.guest_upload_open === "1"} disabled={!!busy} onChange={(v) => save({ guest_upload_open: v ? "1" : "0" }, "upload")}>{values.guest_upload_open === "1" ? "開放中" : "關閉"}</Checkbox></td></tr>
            <tr><td>婚紗照分享頁</td><td className="perm-cell"><span className="perm-yes">可以</span></td><td className="perm-cell"><span className="perm-yes">可以</span></td><td className="perm-cell"><Checkbox checked={values.photos_open === "1"} disabled={!!busy} onChange={(v) => save({ photos_open: v ? "1" : "0" }, "photos")}>{values.photos_open === "1" ? "開放中" : "關閉"}</Checkbox></td></tr>
            <tr className="perm-section"><td colSpan={4}>後台</td></tr>
            {PERM_ROWS.map(([key, label]) => (
              <tr key={key}><td>{label}</td>
                {["couple", "helper"].map((role) => {
                  const locked = role === "couple" && key === "settings";
                  const on = locked || perms[role].includes(key);
                  return <td key={role} className="perm-cell"><Checkbox checked={on} disabled={locked} onChange={(v) => setPerms((p) => ({ ...p, [role]: v ? [...p[role], key] : p[role].filter((k) => k !== key) }))} /></td>;
                })}
                <td className="perm-cell"><span className="perm-no">—</span></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
          <button className="btn btn-primary" disabled={!!busy || !permsDirty} onClick={() => save({ role_permissions: JSON.stringify({ ...perms, known: PERM_ROWS.map(([k]) => k) }) }, "perms")}><Save size={15} /> {busy === "perms" ? "儲存中…" : "儲存權限"}</button>
          <button className="btn btn-ghost" disabled={!!busy} onClick={() => setPerms({ couple: [...DEFAULT_PERMS.couple], helper: [...DEFAULT_PERMS.helper] })}>還原預設</button>
          {permsDirty && <span className="pill pill-warn">有尚未儲存的修改</span>}
          <span className="helper-text">勾好按儲存，幫手下次載入頁面就會生效；新人的「設定」拿不掉，避免把自己鎖在外面。</span>
        </div>
        <div style={{ fontSize: 13.5, lineHeight: 1.8, marginTop: 12 }}>
          <p>密碼不在網頁上改，而是在伺服器的 <code>backend/.env</code>：<code>ADMIN_PASSWORD</code> 是新人密碼、<code>HELPER_PASSWORD</code> 是幫手密碼（留空 = 不啟用幫手）。改完要重啟後端（<code>sudo systemctl restart wedding</code>），步驟在 部署說明.md。</p>
        </div>
      </div>
    </div>
  );
}


// 目前階段的卡片：狀態點、名稱、狀態說明，右上角一個開關（locked = 一直開放，不能關）
function StageCard({ on, locked = false, busy = false, label, value, onChange }) {
  return (
    <div className={`pl-stage-item pl-stage-card${on ? " on" : ""}`} onClick={() => !locked && !busy && onChange && onChange(!on)} role={locked ? undefined : "button"}>
      <span className={`status-dot${on ? "" : " off"}`} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="pl-list-title">{label}</div>
        <div className="pl-list-sub">{value}</div>
      </div>
      <span onClick={(e) => e.stopPropagation()}><Toggle checked={!!on} disabled={locked || busy} onChange={(v) => onChange && onChange(v)} label={label} /></span>
    </div>
  );
}
