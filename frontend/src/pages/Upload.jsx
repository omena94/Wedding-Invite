// 婚禮當天照片上傳（2026-09-27）：賓客從手機相簿多選照片直接上傳原檔，不用登入。
// 一張一張傳（才有進度與重試）；賓客看不到任何人的照片，只會看到「已收到幾張」。
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, Check, CloudUpload, RotateCcw, X } from "lucide-react";
import { fetchStage, getToken } from "../api.js";
import PreviewBanner from "../components/PreviewBanner.jsx";
import { GuestHeader, GuestNav, LoadError, useGuestLoad } from "../components/GuestUI.jsx";

const MAX_MB = 80;
const OK_EXT = /\.(jpe?g|png|heic|heif|webp|gif|dng)$/i;

// 用 XMLHttpRequest 才拿得到上傳進度；有登入的後台帳號就帶 token（開關關著也能試傳）
function uploadOne(file, uploader, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    fd.append("uploader", uploader);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/guest-photos");
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = "上傳失敗";
      try { const d = JSON.parse(xhr.responseText); if (typeof d.detail === "string") msg = d.detail; } catch { /* 不是 JSON 就用預設訊息 */ }
      reject(new Error(xhr.status === 413 ? `這張太大（超過 ${MAX_MB}MB）` : msg));
    };
    xhr.onerror = () => reject(new Error("連線中斷，請再試一次"));
    xhr.send(fd);
  });
}

const fmtSize = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

export default function Upload() {
  const { data: stage, error: stageError, retry } = useGuestLoad(fetchStage);
  const [name, setName] = useState(() => { try { return localStorage.getItem("wedding_upload_name") || ""; } catch { return ""; } });
  const [items, setItems] = useState([]); // {id, file, status: queued|uploading|done|error, progress, error}
  const [running, setRunning] = useState(false);
  const fileRef = useRef(null);
  const queueRef = useRef([]);

  useEffect(() => { try { localStorage.setItem("wedding_upload_name", name); } catch { /* 存不了就算了 */ } }, [name]);

  // 2026-09-27 新人要求：選好先預覽，確認後才上傳，避免傳錯（HEIC 瀏覽器畫不出來就只顯示檔名）
  const addFiles = (list) => {
    const picked = Array.from(list || []).filter((f) => f && f.size > 0);
    const next = picked.map((f) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file: f, progress: 0,
      preview: URL.createObjectURL(f), // 一律先試著顯示（iPhone Safari 連 HEIC 都能畫），畫不出來再退回檔名
      status: !OK_EXT.test(f.name) ? "error" : f.size > MAX_MB * 1024 * 1024 ? "error" : "picked",
      error: !OK_EXT.test(f.name) ? "不是照片檔" : f.size > MAX_MB * 1024 * 1024 ? `超過 ${MAX_MB}MB` : "",
    }));
    setItems((cur) => [...cur, ...next]);
    if (fileRef.current) fileRef.current.value = "";
  };
  // 按「確認上傳」才把預覽中的照片排進佇列
  const confirmUpload = () => {
    const ids = items.filter((x) => x.status === "picked").map((x) => x.id);
    if (!ids.length) return;
    setItems((cur) => cur.map((x) => (x.status === "picked" ? { ...x, status: "queued" } : x)));
    queueRef.current.push(...ids);
  };

  // 佇列：一次一張，傳完接下一張
  useEffect(() => {
    if (running) return;
    const nextId = queueRef.current.shift();
    if (!nextId) return;
    const item = items.find((x) => x.id === nextId);
    if (!item) return;
    setRunning(true);
    const patch = (p) => setItems((cur) => cur.map((x) => (x.id === nextId ? { ...x, ...p } : x)));
    patch({ status: "uploading", progress: 0 });
    uploadOne(item.file, name, (pct) => patch({ progress: pct }))
      .then(() => patch({ status: "done", progress: 100 }))
      .catch((e) => patch({ status: "error", error: e.message }))
      .finally(() => setRunning(false));
  }, [items, running, name]);

  const retryItem = (id) => {
    setItems((cur) => cur.map((x) => (x.id === id ? { ...x, status: "queued", error: "", progress: 0 } : x)));
    queueRef.current.push(id);
  };
  const removeItem = (id) => {
    queueRef.current = queueRef.current.filter((x) => x !== id);
    setItems((cur) => { const gone = cur.find((x) => x.id === id); if (gone && gone.preview) URL.revokeObjectURL(gone.preview); return cur.filter((x) => x.id !== id); });
  };

  const done = items.filter((x) => x.status === "done").length;
  const pending = items.filter((x) => x.status === "queued" || x.status === "uploading").length;
  const failed = items.filter((x) => x.status === "error").length;
  const picked = items.filter((x) => x.status === "picked");
  const open = !!(stage && (stage.guest_upload_open || stage.preview));

  return (
    <div className="container guest-page">
      <PreviewBanner stage={stage} closedLabels={stage && !stage.guest_upload_open ? ["照片上傳"] : []} />
      {/* 2026-09-28 新人給的文案 */}
      <GuestHeader title="交出你的相簿！留下今天的美好瞬間 📸" subtitle={<>今天只顧著笑跟吃，你手上一定有好多精彩畫面<br />謝謝大家今天熱情相伴！<br />快把你們手機裡的照片全部丟過來給我們收藏吧！</>} />

      {stageError ? <LoadError error={stageError} retry={retry} /> : stage === null ? (
        <div className="loading">讀取中…</div>
      ) : !open ? (
        <section className="section-card" style={{ textAlign: "center" }}>
          <div className="section-header" style={{ justifyContent: "center" }}>
            <div className="section-header-title"><Camera size={18} /> 照片上傳尚未開放</div>
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.8 }}>婚禮當天會開放，到時候再來把照片傳給我們喔</p>
        </section>
      ) : (
        <>
          <section className="section-card">
            <div className="section-header">
              <div className="section-header-title"><Camera size={18} /> 上傳照片</div>
              <div className="section-header-en">Share Photos</div>
            </div>
            <div className="form-group">
              <label htmlFor="upload-name">你的名字（可不填）</label>
              <input id="upload-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="讓我們知道是誰拍的" maxLength={60} autoComplete="name" />
            </div>
            <input ref={fileRef} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(e) => addFiles(e.target.files)} />
            <button type="button" className="btn-submit up-pick" onClick={() => fileRef.current?.click()}>
              <CloudUpload size={22} /> 選照片上傳
            </button>
            <p className="helper-text" style={{ textAlign: "center", marginTop: 10 }}>選好照片直接上傳，每一張我們都想看！可以一次選很多張，按「確認上傳」才會送出；每張最多 {MAX_MB}MB。</p>
          </section>

          {picked.length > 0 && (
            <section className="section-card">
              <div className="up-summary"><span>選了 {picked.length} 張，確認一下再上傳</span></div>
              <div className="up-preview-grid">
                {picked.map((x) => (
                  <div key={x.id} className="up-preview">
                    {x.preview ? <img src={x.preview} alt={x.file.name} onError={() => setItems((cur) => cur.map((y) => (y.id === x.id ? { ...y, preview: "" } : y)))} /> : <div className="up-preview-none"><Camera size={20} /><small>{x.file.name}</small></div>}
                    <button type="button" className="up-preview-x" onClick={() => removeItem(x.id)} aria-label={`不要傳 ${x.file.name}`}><X size={14} /></button>
                  </div>
                ))}
              </div>
              <button type="button" className="btn-submit up-confirm" onClick={confirmUpload}><CloudUpload size={20} /> 確認上傳這 {picked.length} 張</button>
              <p className="helper-text" style={{ textAlign: "center", marginTop: 8 }}>傳錯了？按照片右上角的 × 拿掉，或再按上面「選照片上傳」補選。</p>
            </section>
          )}

          {items.some((x) => x.status !== "picked") && (
            <section className="section-card">
              <div className="up-summary">
                {pending > 0 ? <span>上傳中… 還有 {pending} 張</span> : <span><Check size={16} /> 已收到 {done} 張，謝謝你！</span>}
                {failed > 0 && <span className="up-failed">{failed} 張失敗</span>}
              </div>
              <ul className="up-list">
                {items.filter((x) => x.status !== "picked").map((x) => (
                  <li key={x.id} className={`up-item ${x.status}`}>
                    <div className="up-item-main">
                      <span className="up-item-name">{x.file.name}</span>
                      <span className="up-item-size">{fmtSize(x.file.size)}</span>
                    </div>
                    {x.status === "uploading" && <div className="up-bar"><div style={{ width: `${x.progress}%` }} /></div>}
                    {x.status === "queued" && <div className="up-item-note">等待中</div>}
                    {x.status === "done" && <div className="up-item-note ok"><Check size={14} /> 已收到</div>}
                    {x.status === "error" && (
                      <div className="up-item-note err">
                        <X size={14} /> {x.error}
                        {x.error !== "不是照片檔" && !/超過/.test(x.error) && <button type="button" className="up-retry" onClick={() => retryItem(x.id)}><RotateCcw size={13} /> 重試</button>}
                        <button type="button" className="up-retry" onClick={() => removeItem(x.id)}>移除</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <p className="footnote"><a href="/" className="top-link"><ArrowLeft size={14} /> 回首頁</a></p>
      <GuestNav />
    </div>
  );
}
