// 文件庫：所有上傳過的合約、報價單、收據、婚紗照
import { useState } from "react";
import { Link } from "react-router-dom";
import { Download, ExternalLink, Eye, EyeOff, Trash2, Upload } from "lucide-react";
import Select from "../components/Select.jsx";
import { deleteFile, downloadFile, fetchFiles, fetchVendors, openFile, updateFile } from "../api.js";
import { FILE_KIND, fmtDate, fmtSize, toOptions } from "../constants.js";
import { UploadModal } from "./modals.jsx";
import { Empty, ErrorBox, Loading, PageHead, confirmDelete, toastErr, useLoader } from "./ui.jsx";

export default function Files() {
  const [kind, setKind] = useState("");
  const { data, loading, error, reload } = useLoader(() => fetchFiles({ kind }), [kind]);
  const { data: vendors } = useLoader(() => fetchVendors(), []);
  const [upload, setUpload] = useState(false);

  const remove = async (f) => {
    if (!(await confirmDelete(f.filename))) return;
    try { await deleteFile(f.id); reload(); } catch (e) { toastErr(e); }
  };
  const togglePublic = async (f) => {
    try { await updateFile(f.id, { is_public: !f.is_public }); reload(); } catch (e) { toastErr(e); }
  };

  return (
    <div>
      <PageHead title="文件庫" sub="合約、報價單、收據、婚紗照。檔案需要登入才能開，只有標記公開的照片會出現在賓客的分享頁"
        actions={<button className="btn btn-primary" onClick={() => setUpload(true)}><Upload size={15} /> 上傳檔案</button>} />

      <div className="panel">
        <div className="toolbar" style={{ marginBottom: 16 }}>
          <Select compact value={kind} onChange={setKind} options={[{ value: "", label: "全部類型" }, ...toOptions(FILE_KIND)]} />
        </div>
        {loading ? <Loading /> : error ? <ErrorBox error={error} /> : data.length === 0 ? (
          <Empty>還沒有檔案。按「上傳檔案」，或到廠商頁面上傳會自動掛在該廠商底下。</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>檔名</th><th>類型</th><th>廠商</th><th>大小</th><th>上傳</th><th>備註</th><th></th></tr></thead>
              <tbody>
                {data.map((f) => (
                  <tr key={f.id}>
                    <td style={{ maxWidth: 260, wordBreak: "break-all" }}><strong>{f.filename}</strong></td>
                    <td>
                      <span className={`pill ${f.kind === "photo" ? "pill-bride" : f.kind === "receipt" ? "pill-yes" : "pill-groom"}`}>{FILE_KIND[f.kind]}</span>
                      {f.kind === "photo" && (
                        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }} title={f.is_public ? "目前公開，點擊改為不公開" : "目前不公開，點擊公開到 /photos"} onClick={() => togglePublic(f)}>
                          {f.is_public ? <><Eye size={12} /> 公開</> : <><EyeOff size={12} /> 私人</>}
                        </button>
                      )}
                    </td>
                    <td>{f.vendor_id ? <Link to={`/vendors/${f.vendor_id}`}>{f.vendor_name}</Link> : <span className="muted-cell">—</span>}</td>
                    <td className="muted-cell" style={{ whiteSpace: "nowrap" }}>{fmtSize(f.size)}</td>
                    <td className="muted-cell" style={{ whiteSpace: "nowrap" }}>{fmtDate(f.created_at)}</td>
                    <td className="muted-cell">{f.note || "—"}</td>
                    <td className="row-actions">
                      <button className="btn btn-ghost btn-sm" title="開啟" onClick={() => openFile(f.id).catch(toastErr)}><ExternalLink size={13} /></button>{" "}
                      <button className="btn btn-ghost btn-sm" title="下載" onClick={() => downloadFile(f.id, f.filename).catch(toastErr)}><Download size={13} /></button>{" "}
                      <button className="btn btn-ghost btn-sm" title="刪除" onClick={() => remove(f)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {upload && <UploadModal vendors={vendors || []} defaults={{ kind: kind || "doc" }} onClose={() => setUpload(false)} onSaved={() => { setUpload(false); reload(); }} />}
    </div>
  );
}
