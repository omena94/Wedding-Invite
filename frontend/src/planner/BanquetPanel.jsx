// 婚宴費用預估：大人每位 × 人數（選素食主餐的大人可另設價位）；小孩每一個依身高分級（免費／半價／全價），沒填身高的用預設；加服務費。
// 人數直接用賓客回覆「出席」的大人與小孩數（測試資料不算）。
import { useEffect, useState } from "react";
import { Calculator, ChevronDown, Save } from "lucide-react";
import { fetchBanquet, saveBanquet } from "../api.js";
import { money } from "../constants.js";
import { ErrorBox, Field, Loading, NumberInput, toInt, toastErr, toastOk, useLoader } from "./ui.jsx";


const OPEN_KEY = "planner.banquet.open";
const readOpen = () => {
  try { return localStorage.getItem(OPEN_KEY) === "1"; } catch { return false; } // 預設收起（2026-09-08 新人要求）
};

export default function BanquetPanel({ compact = false }) {
  const { data, setData, loading, error } = useLoader(fetchBanquet, []);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  // 面板可收折（跟花費項目展開分期一樣）；記住上次開合，預算頁才不會每次都被它佔一大塊
  const [open, setOpen] = useState(readOpen);
  const toggleOpen = () => setOpen((o) => {
    try { localStorage.setItem(OPEN_KEY, o ? "0" : "1"); } catch { /* 封鎖儲存時就只記在這次 */ }
    return !o;
  });

  useEffect(() => {
    if (data) setF(data.params);
  }, [data]);

  if (error) return <ErrorBox error={error} />;
  if (loading || !f) return <Loading />;

  const { counts, estimate, params } = data;
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(f) !== JSON.stringify(params);

  const save = async () => {
    setBusy(true);
    try {
      const r = await saveBanquet({
        adult_price: toInt(f.adult_price),
        service_pct: 10, // 固定 10%，畫面不再提供修改
        child_mode: "manual", // 2026-09-08 新人決定固定用手動填人數
        child_price: toInt(f.child_price),
        child_free_below: toInt(f.child_free_below),
        child_half_below: toInt(f.child_half_below),
        child_free_count: toInt(f.child_free_count),
        child_half_count: toInt(f.child_half_count),
        veg_price: toInt(f.veg_price), // 0 = 跟大人一樣
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
      <div
        className="panel-head"
        style={{ cursor: "pointer", marginBottom: open ? undefined : 0, paddingBottom: open ? undefined : 0, borderBottom: open ? undefined : "none" }}
        onClick={toggleOpen}
        role="button" tabIndex={0} aria-expanded={open}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleOpen(); } }}
      >
        <div className="panel-title">
          <Calculator size={18} /> 婚宴費用預估
          {!open && <span className="banquet-head-total">{money(estimate.total)}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="muted-cell" style={{ fontSize: 12.5 }}>
            {open
              ? <>依目前回覆出席的 {counts.groups} 組：大人 {counts.adults} 位{counts.veg_adults ? `（素食 ${counts.veg_adults} 位）` : ""}、小孩 {counts.children} 位（已填身高 {counts.children_with_height} 位{counts.kids_meals ? `，兒童餐 ${counts.kids_meals} 份` : ""}）</>
              : <>大人 {counts.adults} 位、小孩 {counts.children} 位 · 點擊展開</>}
          </div>
          <ChevronDown size={17} style={{ color: "var(--milk-tea-700)", transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "none" }} />
        </div>
      </div>

      {open && <div className="banquet-grid">
        <div className="banquet-params">
          <div className="form-group grid-2">
            <Field label="大人每位（未含服務費）"><NumberInput value={f.adult_price} onChange={(v) => set("adult_price", v)} /></Field>
            <Field label="素食每位（未含服務費）"><NumberInput value={f.veg_price} onChange={(v) => set("veg_price", v)} /></Field>
          </div>
          <div className="form-group grid-2">
            <Field label="身高 110 以下人數（免費）"><NumberInput value={f.child_free_count} onChange={(v) => set("child_free_count", v)} /></Field>
            <Field label="身高 130 以下人數（半價）" hint={`其餘小孩以全價計，全部含 10% 服務費；目前回覆共 ${counts.children} 位小孩`}><NumberInput value={f.child_half_count} onChange={(v) => set("child_half_count", v)} /></Field>
          </div>
          <button className="btn btn-primary btn-sm" disabled={busy || !dirty} onClick={save}><Save size={13} /> {busy ? "儲存中…" : "儲存並重算"}</button>
        </div>

        <div className="banquet-result">
          <div className="banquet-total">
            <div className="m-label">預估合計</div>
            <div className="banquet-total-value">{money(estimate.total)}</div>
          </div>
          {/* 2026-09-08 新人要求只留預估合計，明細表移除 */}
          <div className="footnote" style={{ textAlign: "left", marginTop: 8 }}>含大人、素食、小孩餐費與 10% 服務費；只算已回覆「出席」的人數，人數變動時自動重算。</div>
        </div>
      </div>}
    </div>
  );
}
