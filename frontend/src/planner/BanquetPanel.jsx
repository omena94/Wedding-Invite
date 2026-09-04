// 婚宴費用預估：大人每位 × 人數；小孩每一個依身高分級（免費／半價／全價），沒填身高的用預設；加服務費。
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

  const { counts, estimate, scenarios, params } = data;
  const cc = estimate.child_counts;
  const cp = estimate.child_prices;
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(f) !== JSON.stringify(params);

  const save = async () => {
    setBusy(true);
    try {
      const r = await saveBanquet({
        adult_price: toInt(f.adult_price),
        service_pct: toInt(f.service_pct),
        child_mode: f.child_mode,
        child_price: toInt(f.child_price),
        child_free_below: toInt(f.child_free_below),
        child_half_below: toInt(f.child_half_below),
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
        <div className="muted-cell" style={{ fontSize: 12.5 }}>
          依目前回覆出席的 {counts.groups} 組：大人 {counts.adults} 位、小孩 {counts.children} 位（已填身高 {counts.children_with_height} 位{counts.kids_meals ? `，兒童餐 ${counts.kids_meals} 份` : ""}）
        </div>
      </div>

      <div className="banquet-grid">
        <div className="banquet-params">
          <div className="form-group grid-2">
            <Field label="大人每位（未含服務費）"><NumberInput value={f.adult_price} onChange={(v) => set("adult_price", v)} /></Field>
            <Field label="服務費 %"><NumberInput value={f.service_pct} onChange={(v) => set("service_pct", v)} placeholder="10" /></Field>
          </div>
          <div className="form-group grid-2">
            <Field label="小孩免費：身高未滿（公分）"><NumberInput value={f.child_free_below} onChange={(v) => set("child_free_below", v)} placeholder="90" /></Field>
            <Field label="小孩半價：身高未滿（公分）" hint="達到這個身高就算全價"><NumberInput value={f.child_half_below} onChange={(v) => set("child_half_below", v)} placeholder="120" /></Field>
          </div>
          <div className="form-group grid-2">
            <Field label="沒填身高的小孩先當作" hint="第二階段會請賓客填身高；沒填的用這個，右邊也列了其他情境">
              <Select value={f.child_mode} onChange={(v) => set("child_mode", v)} options={CHILD_MODES} />
            </Field>
            {f.child_mode === "custom" && (
              <Field label="自訂每位（未含服務費）"><NumberInput value={f.child_price} onChange={(v) => set("child_price", v)} /></Field>
            )}
          </div>
          <button className="btn btn-primary btn-sm" disabled={busy || !dirty} onClick={save}><Save size={13} /> {busy ? "儲存中…" : "儲存並重算"}</button>
          <div className="helper-text" style={{ marginTop: 8 }}>個別小孩想指定免費／半價／全價，在賓客名單按「編輯」，每個小孩都能單獨設定。</div>
        </div>

        <div className="banquet-result">
          <div className="banquet-total">
            <div className="m-label">預估合計</div>
            <div className="banquet-total-value">{money(estimate.total)}</div>
          </div>
          <table className="banquet-table">
            <tbody>
              <tr><td>大人 {counts.adults} 位 × {money(params.adult_price)}</td><td className="amount">{money(estimate.adult_subtotal)}</td></tr>
              {cc.free > 0 && <tr><td>小孩免費（未滿 {params.child_free_below} cm）{cc.free} 位</td><td className="amount">{money(0)}</td></tr>}
              {cc.half > 0 && <tr><td>小孩半價（{params.child_free_below}～{params.child_half_below} cm）{cc.half} 位 × {money(cp.half)}</td><td className="amount">{money(cc.half * cp.half)}</td></tr>}
              {cc.full > 0 && <tr><td>小孩全價（{params.child_half_below} cm 以上）{cc.full} 位 × {money(cp.full)}</td><td className="amount">{money(cc.full * cp.full)}</td></tr>}
              {cc.unknown > 0 && <tr><td>小孩未填身高 {cc.unknown} 位 × {money(estimate.unknown_unit_price)}（先當{MODE_LABEL[params.child_mode]}）</td><td className="amount">{money(cc.unknown * estimate.unknown_unit_price)}</td></tr>}
              {counts.children === 0 && <tr><td>小孩 0 位</td><td className="amount">{money(0)}</td></tr>}
              <tr><td>服務費 {params.service_pct}%</td><td className="amount">{money(estimate.service)}</td></tr>
              <tr className="banquet-sum"><td>合計</td><td className="amount">{money(estimate.total)}</td></tr>
            </tbody>
          </table>
          {!compact && cc.unknown > 0 && (
            <div className="banquet-scenarios">
              <span className="muted-cell">未填身高的 {cc.unknown} 位若改算：</span>
              {["free", "half", "full"].map((m) => (
                <span key={m} className={`pill ${params.child_mode === m ? "pill-yes" : "pill-groom"}`}>{MODE_LABEL[m].replace("（同大人）", "")} {money(scenarios[m])}</span>
              ))}
            </div>
          )}
          <div className="footnote" style={{ textAlign: "left", marginTop: 8 }}>只算已回覆「出席」的人數；有填身高的小孩照身高算，人數或身高變動時自動重算。</div>
        </div>
      </div>
    </div>
  );
}
