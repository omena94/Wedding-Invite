// 後台「當天照片」（2026-09-27）：賓客在 /upload 傳上來的原檔。只有有 guest_photos 鑰匙的人看得到。
import { useState } from "react";
import { Camera, Download, Trash2, User } from "lucide-react";
import { deleteGuestPhoto, fetchGuestPhotos, guestPhotoFileUrl, guestPhotoThumbUrl, downloadGuestPhotosZip, savePlannerSettings, fetchPlannerSettings } from "../api.js";
import PhotoImage from "../components/PhotoImage.jsx";
import Toggle from "../components/Toggle.jsx";
import { Empty, ErrorBox, Loading, PageHead, confirmDelete, toastErr, toastOk, useLoader } from "./ui.jsx";

const fmtSize = (n) => (n >= 1024 * 1024 * 1024 ? `${(n / 1024 / 1024 / 1024).toFixed(2)} GB` : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString("zh-TW", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

export default function GuestPhotos() {
  const { data, loading, error, reload } = useLoader(fetchGuestPhotos, []);
  const { data: settings, reload: reloadSettings } = useLoader(fetchPlannerSettings, []);
  const [big, setBig] = useState(null);
  const [busy, setBusy] = useState(false);
  const [who, setWho] = useState("");
  const open = settings?.values?.guest_upload_open === "1";
  const toggle = async (v) => {
    setBusy(true);
    try { await savePlannerSettings({ guest_upload_open: v ? "1" : "0" }); toastOk(v ? "已開放賓客上傳" : "已關閉賓客上傳"); reloadSettings(); } catch (e) { toastErr(e); } finally { setBusy(false); }
  };
  const remove = async (p) => {
    if (!(await confirmDelete(`這張照片（${p.original_name}）`))) return;
    try { await deleteGuestPhoto(p.id); if (big?.id === p.id) setBig(null); reload(); } catch (e) { toastErr(e); }
  };
  const zip = async () => {
    setBusy(true);
    try { await downloadGuestPhotosZip(); } catch (e) { toastErr(e); } finally { setBusy(false); }
  };
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const items = data.items || [];
  const uploaders = [...new Set(items.map((p) => p.uploader || "未具名"))];
  const shown = who ? items.filter((p) => (p.uploader || "未具名") === who) : items;
  return (
    <div>
      <PageHead title="當天照片" sub="賓客從 /upload 傳上來的原檔。只有你們看得到；婚禮後可以整包下載到自己的電腦。"
        actions={<button className="btn btn-primary" onClick={zip} disabled={busy || !items.length}><Download size={15} /> 全部打包下載</button>} />
      <div className="panel">
        <div className="pl-switch" onClick={() => !busy && toggle(!open)}>
          <Toggle checked={open} disabled={busy} onChange={toggle} label="開放賓客上傳照片" />
          <div>
            <div className="pl-list-title">開放賓客上傳照片（/upload） <span className={`pill ${open ? "pill-yes" : "pill-no"}`}>{open ? "開放中" : "關閉"}</span></div>
            <div className="pl-list-sub">會場放這個網址的 QR code，賓客不用登入就能傳；關著的時候只有登入的人能試傳。</div>
          </div>
        </div>
      </div>
      <div className="stats-grid">
        <div className="stat-card"><div className="value">{data.count}</div><div className="label">張照片</div></div>
        <div className="stat-card"><div className="value">{fmtSize(data.total_bytes)}</div><div className="label">總大小（原檔）</div></div>
        <div className="stat-card"><div className="value">{uploaders.length}</div><div className="label">位上傳者</div></div>
      </div>
      {items.length === 0 ? <div className="panel"><Empty>還沒有照片。開放後把 /upload 的 QR code 放在會場，賓客傳上來就會出現在這裡。</Empty></div> : (
        <div className="panel">
          <div className="toolbar" style={{ marginBottom: 12, flexWrap: "wrap", gap: 6 }}>
            <button className={`btn btn-sm ${who ? "btn-ghost" : "btn-primary"}`} onClick={() => setWho("")}>全部 {items.length}</button>
            {uploaders.map((u) => <button key={u} className={`btn btn-sm ${who === u ? "btn-primary" : "btn-ghost"}`} onClick={() => setWho(u)}><User size={12} /> {u} {items.filter((p) => (p.uploader || "未具名") === u).length}</button>)}
          </div>
          <div className="gp-grid">
            {shown.map((p) => (
              <figure key={p.id} className="gp-item">
                <button type="button" className="gp-thumb" onClick={() => setBig(p)} title="放大看">
                  {p.has_thumb ? <PhotoImage src={guestPhotoThumbUrl(p.id)} auth alt={p.original_name} loading="lazy" /> : <span className="gp-nothumb"><Camera size={22} /><small>{p.original_name}</small></span>}
                </button>
                <figcaption>
                  <span>{p.uploader || "未具名"} · {fmtTime(p.created_at)}</span>
                  <span className="gp-actions">
                    <a className="btn btn-ghost btn-sm" href={guestPhotoFileUrl(p.id)} onClick={(e) => { e.preventDefault(); downloadOne(p); }} title={`下載原檔 ${fmtSize(p.size)}`}><Download size={13} /></a>
                    <button className="btn btn-ghost btn-sm" onClick={() => remove(p)} title="刪除"><Trash2 size={13} /></button>
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
      {big && (
        <div className="gp-lightbox" onClick={() => setBig(null)} role="dialog" aria-label={big.original_name}>
          <PhotoImage src={guestPhotoFileUrl(big.id)} auth alt={big.original_name} />
          <div className="gp-lightbox-cap">{big.uploader || "未具名"} · {fmtTime(big.created_at)} · {fmtSize(big.size)} · {big.original_name}</div>
        </div>
      )}
    </div>
  );
}

// 下載原檔：要帶登入，所以先抓成 blob 再存
async function downloadOne(p) {
  const { fetchAuthBlobUrl } = await import("../api.js");
  const url = await fetchAuthBlobUrl(guestPhotoFileUrl(p.id));
  const a = document.createElement("a"); a.href = url; a.download = p.original_name || `photo-${p.id}`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
