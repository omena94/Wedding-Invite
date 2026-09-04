// 比價：同類別廠商的報價並排，每欄最低價會標色
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Select from "../components/Select.jsx";
import { Checkbox } from "../components/Toggle.jsx";
import { fetchCompare, fetchVendorCategories } from "../api.js";
import { STATUS_PILL, VENDOR_STATUS, money } from "../constants.js";
import { Empty, ErrorBox, Loading, PageHead, Stars, useLoader } from "./ui.jsx";

export default function Compare() {
  const [params, setParams] = useSearchParams();
  const { data: cats, loading: catsLoading } = useLoader(fetchVendorCategories, []);
  const [category, setCategory] = useState(params.get("category") || "");
  const [hideRejected, setHideRejected] = useState(true);

  // 只列有廠商的類別；沒指定時預設選廠商最多的那個
  const usable = useMemo(() => (cats || []).filter((c) => c.count > 0), [cats]);
  useEffect(() => {
    if (!category && usable.length) {
      const best = [...usable].sort((a, b) => b.count - a.count)[0].category;
      setCategory(best);
    }
  }, [usable, category]);
  useEffect(() => {
    if (category) setParams({ category }, { replace: true });
  }, [category, setParams]);

  const { data, loading, error } = useLoader(() => (category ? fetchCompare(category) : Promise.resolve(null)), [category]);

  const rows = useMemo(() => {
    if (!data) return [];
    return hideRejected ? data.rows.filter((r) => r.status !== "rejected") : data.rows;
  }, [data, hideRejected]);

  const minByItem = useMemo(() => {
    const m = {};
    (data?.items || []).forEach((it) => {
      const vals = rows.map((r) => r.prices[it]).filter((v) => typeof v === "number" && v > 0);
      if (vals.length) m[it] = Math.min(...vals);
    });
    return m;
  }, [data, rows]);

  return (
    <div>
      <PageHead title="比價" sub="同一類別的廠商放在一起看；報價項目名稱一樣的才會對齊成同一欄" />

      <div className="panel">
        <div className="toolbar" style={{ marginBottom: 16 }}>
          {catsLoading ? <span className="muted-cell">讀取類別…</span> : (
            <Select compact value={category} onChange={setCategory}
              options={usable.map((c) => ({ value: c.category, label: `${c.category}（${c.count}）` }))} />
          )}
          <Checkbox checked={hideRejected} onChange={setHideRejected}>隱藏已放棄</Checkbox>
        </div>

        {!category ? <Empty>還沒有任何廠商。先到「廠商」新增幾家並填報價，這裡就能並排比較。</Empty>
          : loading ? <Loading /> : error ? <ErrorBox error={error} /> : !data || rows.length === 0 ? <Empty>這個類別沒有廠商</Empty>
          : data.items.length === 0 ? <Empty>這個類別的廠商都還沒填報價。到廠商頁面的「報價項目」新增，例如「5小時方案」「9小時方案」「宴客款」。</Empty>
          : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>廠商</th><th>狀態</th>
                    {data.items.map((it) => <th key={it} style={{ textAlign: "right" }}>{it}</th>)}
                    <th>備註</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <Link to={`/vendors/${r.id}`} style={{ color: "var(--milk-tea-900)", fontWeight: 600, textDecoration: "none" }}>{r.name}</Link>
                        {r.rating > 0 && <div><Stars value={r.rating} /></div>}
                        <div className="muted-cell" style={{ fontSize: 11.5 }}>{[r.phone, r.line_id && `LINE ${r.line_id}`].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td><span className={`pill ${STATUS_PILL[r.status]}`}>{VENDOR_STATUS[r.status]}</span></td>
                      {data.items.map((it) => {
                        const v = r.prices[it];
                        const isMin = typeof v === "number" && v > 0 && v === minByItem[it];
                        return (
                          <td key={it} className={`amount${isMin ? " min-price" : ""}`}>
                            {typeof v === "number" ? money(v) : <span className="muted-cell">—</span>}
                            {r.quote_notes[it] && <div className="muted-cell" style={{ fontSize: 11, fontWeight: 400, whiteSpace: "normal", maxWidth: 160 }}>{r.quote_notes[it]}</div>}
                          </td>
                        );
                      })}
                      <td className="blessing-cell muted-cell" style={{ fontSize: 12 }}>{r.note || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {data && data.items.length > 0 && <div className="footnote" style={{ textAlign: "left" }}>綠底 = 該欄最低價。價格為登錄時的報價，實際以廠商為準。</div>}
      </div>
    </div>
  );
}
