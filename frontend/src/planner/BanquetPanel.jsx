// 婚宴費用預估：大人每位 × 人數、小孩依設定（免費／半價／全價／自訂）、加服務費。
// 人數直接用賓客回覆「出席」的大人與小孩數（測試資料不算）。
import { useEffect, useState } from "react";
import { Calculator, Save } from "lucide-react";
import Select from "../components/Select.jsx";
import { fetchBanquet, saveBanquet } from "../api.js";
import { money } from "../constants.js";
import { ErrorBox, Field, Loading, NumberInput, toInt, toastErr, toastOk, useLoader } from "./ui.jsx";

const CHILD_MODES = [
  { value: "free", label: "免費" },
  { value: "half", label: "半價" },
  { value: "full", label: "全價（同大人）" },
  { value: "custom", label: "自訂金額" },
];
const MODE_LABEL = Object.fromEntries(CHILD_MODES.map((m) => [m.value, m.label]));

export default function BanquetPanel({ compact = false }) {
  const { data, setData, loading, error } = useLoader(fetchBanquet, []);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) setF(data.params);
  }, [data]);

  if (loading || !f) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const { counts, estimate, scenarios } = data;
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(f) !== JSON.stringify(data.params);

  const save = async () => {
    setBusy(true);
    try {
      const r = await saveBanquet({
        adult_price: toInt(f.adult_price),
        service_pct: toInt(f.service_pct),
        child_mode: f.child_mode,
        child_price: toInt(f.child_price),
      });
      setData(r);
      toastOk("已更新預估");
    } catch (e) {
      toastErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="panel-title"><Calculator size={18} /> 婚宴費用預估</div>
        <div className="muted-cell" style={{ fontSize: 12.5 }}>依目前回覆出席的 {counts.groups} 組：大人 {counts.adults} 位、小孩 {counts.children} 位{counts.kids_meals ? `（兒童餐 ${counts.kids_meals} 份）` : ""}</div>
      </div>

      <div className="banquet-grid">
        <div className="banquet-params">
          <div className="form-group grid-2">
            <Field label="大人每位（未含服務費）"><NumberInput value={f.adult_price} onChange={(v) => set("adult_price", v)} /></Field>
            <Field label="服務費 %"><NumberInput value={f.service_pct} onChange={(v) => set("service_pct", v)} placeholder="10" /></Field>
          </div>
          <div className="form-group grid-2">
            <Field label="小孩計價" hint="飯店還沒確定的話，右邊三種情境都幫你算好了">
              <Select value={f.child_mode} onChange={(v) => set("child_mode", v)} options={CHILD_MODES} />
            </Field>
            {f.child_mode === "custom" && (
              <Field label="小孩每位（未含服務費）"><NumberInput value={f.child_price} onChange={(v) => set("child_price", v)} /></Field>
            )}
          </div>
          <button className="btn btn-primary btn-sm" disabled={busy || !dirty} onClick={save}><Save size={13} /> {busy ? "儲存中…" : "儲存並重算"}</button>
        </div>

        <div className="banquet-result">
          <div className="banquet-total">
            <div className="m-label">預估合計（小孩{MODE_LABEL[data.params.child_mode]}）</div>
            <div className="banquet-total-value">{money(estimate.total)}</div>
          </div>
          <table className="banquet-table">
            <tbody>
              <tr><td>大人 {counts.adults} 位 × {money(data.params.adult_price)}</td><td className="amount">{money(estimate.adult_subtotal)}</td></tr>
              <tr><td>小孩 {counts.children} 位 × {money(estimate.child_unit_price)}</td><td className="amount">{money(estimate.child_subtotal)}</td></tr>
              <tr><td>服務費 {data.params.service_pct}%</td><td className="amount">{money(estimate.service)}</td></tr>
              <tr className="banquet-sum"><td>合計</td><td className="amount">{money(estimate.total)}</td></tr>
            </tbody>
          </table>
          {!compact && (
            <div className="banquet-scenarios">
              <span className="muted-cell">小孩不同計價的合計：</span>
              {["free", "half", "full"].map((m) => (
                <span key={m} className={`pill ${data.params.child_mode === m ? "pill-yes" : "pill-groom"}`}>{MODE_LABEL[m].replace("（同大人）", "")} {money(scenarios[m])}</span>
              ))}
            </div>
          )}
          <div className="footnote" style={{ textAlign: "left", marginTop: 8 }}>只算已回覆「出席」的人數，還沒回覆的不在內；人數變動時這裡會自動跟著變。</div>
        </div>
      </div>
    </div>
  );
}
