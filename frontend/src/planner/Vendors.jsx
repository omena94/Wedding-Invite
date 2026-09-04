// 廠商清單
import { useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, Plus, Trash2 } from "lucide-react";
import Select from "../components/Select.jsx";
import { deleteVendor, fetchVendors } from "../api.js";
import { STATUS_PILL, VENDOR_CATEGORIES, VENDOR_STATUS, listOptions, money, toOptions } from "../constants.js";
import { VendorModal } from "./modals.jsx";
import { Empty, ErrorBox, Loading, PageHead, Stars, confirmDelete, toastErr, useLoader } from "./ui.jsx";

export default function Vendors() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [modal, setModal] = useState(null); // null | {} 新增 | vendor 編輯
  const { data, loading, error, reload } = useLoader(() => fetchVendors({ q, category, status }), [q, category, status]);

  const remove = async (v) => {
    if (!(await confirmDelete(v.name))) return;
    try {
      await deleteVendor(v.id);
      reload();
    } catch (e) {
      toastErr(e);
    }
  };

  return (
    <div>
      <PageHead title="廠商" sub="攝影、禮服、場地、喜餅…所有聯絡方式、狀態與報價都在這裡"
        actions={<button className="btn btn-primary" onClick={() => setModal({})}><Plus size={15} /> 新增廠商</button>} />

      <div className="panel">
        <div className="toolbar" style={{ marginBottom: 16 }}>
          <div className="search-box"><input type="text" placeholder="搜尋名稱 / 聯絡人 / 備註…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Select compact value={category} onChange={setCategory} options={[{ value: "", label: "全部類別" }, ...listOptions(VENDOR_CATEGORIES)]} />
          <Select compact value={status} onChange={setStatus} options={[{ value: "", label: "全部狀態" }, ...toOptions(VENDOR_STATUS)]} />
        </div>

        {loading ? <Loading /> : error ? <ErrorBox error={error} /> : data.length === 0 ? (
          <Empty>還沒有廠商。按右上角「新增廠商」，或先到「比價」頁看看。</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>名稱</th><th>類別</th><th>狀態</th><th>聯絡</th><th>報價</th>
                  <th style={{ textAlign: "right" }}>合約金額</th><th style={{ textAlign: "right" }}>已付</th><th></th>
                </tr>
              </thead>
              <tbody>
                {data.map((v) => (
                  <tr key={v.id}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <Link to={`/vendors/${v.id}`} style={{ color: "var(--milk-tea-900)", fontWeight: 600, textDecoration: "none" }}>{v.name}</Link>
                      {v.rating > 0 && <div><Stars value={v.rating} /></div>}
                    </td>
                    <td>{v.category}</td>
                    <td><span className={`pill ${STATUS_PILL[v.status]}`}>{VENDOR_STATUS[v.status]}</span></td>
                    <td className="muted-cell" style={{ fontSize: 12.5 }}>
                      {v.contact_name && <div>{v.contact_name}</div>}
                      {v.phone && <div>{v.phone}</div>}
                      {v.line_id && <div>LINE {v.line_id}</div>}
                      {!v.contact_name && !v.phone && !v.line_id && "—"}
                    </td>
                    <td className="muted-cell">{v.quotes.length ? `${v.quotes.length} 項` : "—"}</td>
                    <td className="amount">{v.contract_total ? money(v.contract_total) : "—"}</td>
                    <td className="amount">{v.paid_total ? money(v.paid_total) : "—"}</td>
                    <td className="row-actions">
                      <button className="btn btn-ghost btn-sm" title="編輯" onClick={() => setModal(v)}><Pencil size={14} /></button>{" "}
                      <button className="btn btn-ghost btn-sm" title="刪除" onClick={() => remove(v)}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <VendorModal initial={modal.id ? modal : null} onClose={() => setModal(null)}
          onSaved={() => { setModal(null); reload(); }} />
      )}
    </div>
  );
}
