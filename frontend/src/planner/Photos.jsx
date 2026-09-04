// 照片相簿：上傳（瀏覽器先縮圖）、分相簿、排序、說明、公開／隱藏、整頁開關
import { useEffect, useMemo, useRef, useState } from "react";
import Swal from "sweetalert2";
import { ArrowLeft, ArrowRight, ChevronsLeft, Eye, EyeOff, Images, Pencil, Trash2, Upload } from "lucide-react";
import Select from "../components/Select.jsx";
import Toggle, { Checkbox } from "../components/Toggle.jsx";
import { deleteFile, fetchPlannerPhotos, fetchThumbBlobUrl, publishPhotos, reorderPhotos, savePlannerSettings, updateFile, uploadFile } from "../api.js";
import { fmtSize } from "../constants.js";
import { resizeImage } from "../utils/resizeImage.js";
import { Empty, ErrorBox, Field, Loading, Modal, PageHead, confirmDelete, toastErr, toastOk, useLoader } from "./ui.jsx";

const NEW_ALBUM = "__new__";

export default function Photos() {
  const { data, setData, loading, error, reload } = useLoader(fetchPlannerPhotos, []);
  const [album, setAlbum] = useState("");          // 目前看的相簿（"" = 未分類）
  const [selected, setSelected] = useState(() => new Set());
  const [upload, setUpload] = useState(false);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);

  const albums = data?.albums || [];
  useEffect(() => {
    if (data && albums.length && !albums.some((a) => a.album === album)) setAlbum(albums[0].album);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const photos = useMemo(() => (data?.photos || []).filter((p) => (p.album || "") === album), [data, album]);
  const allSelected = photos.length > 0 && photos.every((p) => selected.has(p.id));

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const apply = (r) => { setData(r); setSelected(new Set()); };
  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r && r.photos) apply(r); else reload();
      if (okMsg) toastOk(okMsg);
    } catch (e) {
      toastErr(e);
    } finally {
      setBusy(false);
    }
  };
  const move = (idx, dir) => {
    const ids = photos.map((p) => p.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    run(() => reorderPhotos(ids));
  };
  const toFront = (idx) => {
    const ids = photos.map((p) => p.id);
    const [id] = ids.splice(idx, 1);
    run(() => reorderPhotos([id, ...ids]));
  };
  const removeMany = async (ids) => {
    if (!(await confirmDelete(ids.length === 1 ? "這張照片" : `${ids.length} 張照片`))) return;
    setBusy(true);
    try {
      for (const id of ids) await deleteFile(id);
      await reload();
      setSelected(new Set());
    } catch (e) {
      toastErr(e);
    } finally {
      setBusy(false);
    }
  };
  const togglePage = (on) => run(async () => { await savePlannerSettings({ photos_open: on ? "1" : "" }); return fetchPlannerPhotos(); }, on ? "分享頁已開放" : "分享頁已關閉");

  return (
    <div>
      <PageHead title="照片" sub="婚紗照、婚禮當天照片。標記公開的才會出現在賓客的 /photos"
        actions={<button className="btn btn-primary" onClick={() => setUpload(true)}><Upload size={15} /> 上傳照片</button>} />

      <div className="panel" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div className="pl-switch" onClick={() => !busy && togglePage(!data.photos_open)}>
          <Toggle checked={!!data.photos_open} disabled={busy} onChange={togglePage} label="婚紗照分享頁" />
          <div>
            <div className="pl-list-title">婚紗照分享頁（/photos） <span className={`pill ${data.photos_open ? "pill-yes" : "pill-no"}`}>{data.photos_open ? "開放中" : "關閉"}</span></div>
            <div className="pl-list-sub">關閉時賓客看到「照片還沒準備好」；開放後只顯示標記公開的照片</div>
          </div>
        </div>
        <a className="btn btn-ghost btn-sm" href="/photos" target="_blank" rel="noopener">看賓客頁</a>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div className="pl-album-tabs">
            {albums.length === 0 && <span className="muted-cell">還沒有照片</span>}
            {albums.map((a) => (
              <button key={a.album} className={`pl-album-tab${a.album === album ? " active" : ""}`} onClick={() => { setAlbum(a.album); setSelected(new Set()); }}>
                {a.album || "未分類"} <span className="muted-cell">{a.public}/{a.count}</span>
              </button>
            ))}
          </div>
          {photos.length > 0 && (
            <div className="toolbar">
              <Checkbox checked={allSelected} onChange={(v) => setSelected(v ? new Set(photos.map((p) => p.id)) : new Set())}>全選</Checkbox>
              {selected.size > 0 && (
                <>
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => publishPhotos([...selected], true), "已公開")}><Eye size={13} /> 公開 {selected.size}</button>
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => publishPhotos([...selected], false), "已隱藏")}><EyeOff size={13} /> 隱藏</button>
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => removeMany([...selected])} style={{ color: "var(--rose-accent)" }}><Trash2 size={13} /> 刪除</button>
                </>
              )}
            </div>
          )}
        </div>

        {photos.length === 0 ? (
          <Empty>{albums.length ? "這本相簿是空的" : "按右上角「上傳照片」開始。可以一次選很多張，手機也可以。"}</Empty>
        ) : (
          <div className="photo-admin-grid">
            {photos.map((p, i) => (
              <PhotoCard key={p.id} p={p} index={i} total={photos.length} selected={selected.has(p.id)} busy={busy}
                onSelect={(v) => setSelected((s) => { const n = new Set(s); v ? n.add(p.id) : n.delete(p.id); return n; })}
                onPublic={(v) => run(() => publishPhotos([p.id], v))}
                onEdit={() => setEdit(p)}
                onDelete={() => removeMany([p.id])}
                onMove={(dir) => move(i, dir)}
                onFront={() => toFront(i)} />
            ))}
          </div>
        )}
        <div className="footnote" style={{ textAlign: "left" }}>順序就是賓客看到的順序；第一張會當相簿封面。點縮圖可放大檢視。</div>
      </div>

      {upload && <UploadPhotosModal albums={albums} defaultAlbum={album} onClose={() => setUpload(false)} onDone={() => { setUpload(false); reload(); }} />}
      {edit && <EditPhotoModal p={edit} albums={albums} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

/* ---------- 單張卡片（縮圖要帶 token 讀，所以用 blob URL） ---------- */
function PhotoCard({ p, index, total, selected, busy, onSelect, onPublic, onEdit, onDelete, onMove, onFront }) {
  const [src, setSrc] = useState("");
  const [big, setBig] = useState(false);
  useEffect(() => {
    let url = "";
    fetchThumbBlobUrl(p.id).then((u) => { url = u; setSrc(u); }).catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [p.id]);
  return (
    <div className={`photo-admin-card${selected ? " selected" : ""}${p.is_public ? "" : " private"}`}>
      <div className="photo-admin-thumb" onClick={() => setBig(true)}>
        {src ? <img src={src} alt={p.caption || p.filename} /> : <div className="photo-admin-loading">…</div>}
        <div className="photo-admin-check" onClick={(e) => e.stopPropagation()}><Checkbox checked={selected} onChange={onSelect} /></div>
        {!p.is_public && <span className="pill pill-no photo-admin-flag">未公開</span>}
        {index === 0 && <span className="pill pill-yes photo-admin-flag" style={{ left: "auto", right: 8 }}>封面</span>}
      </div>
      <div className="photo-admin-meta">
        <div className="photo-admin-caption" title={p.filename}>{p.caption || <span className="muted-cell">（無說明）</span>}</div>
        <div className="muted-cell" style={{ fontSize: 11 }}>{fmtSize(p.size)}</div>
      </div>
      <div className="photo-admin-actions">
        <button className="btn btn-ghost btn-sm" title={p.is_public ? "改為隱藏" : "公開"} disabled={busy} onClick={() => onPublic(!p.is_public)}>{p.is_public ? <Eye size={13} /> : <EyeOff size={13} />}</button>
        <button className="btn btn-ghost btn-sm" title="說明 / 相簿" disabled={busy} onClick={onEdit}><Pencil size={13} /></button>
        <button className="btn btn-ghost btn-sm" title="移到最前（封面）" disabled={busy || index === 0} onClick={onFront}><ChevronsLeft size={13} /></button>
        <button className="btn btn-ghost btn-sm" title="往前" disabled={busy || index === 0} onClick={() => onMove(-1)}><ArrowLeft size={13} /></button>
        <button className="btn btn-ghost btn-sm" title="往後" disabled={busy || index === total - 1} onClick={() => onMove(1)}><ArrowRight size={13} /></button>
        <button className="btn btn-ghost btn-sm" title="刪除" disabled={busy} onClick={onDelete} style={{ color: "var(--rose-accent)" }}><Trash2 size={13} /></button>
      </div>
      {big && src && (
        <div className="photo-lightbox" onClick={() => setBig(false)}>
          <img src={src} alt="" onClick={(e) => e.stopPropagation()} />
          <div className="photo-lightbox-nav" onClick={(e) => e.stopPropagation()}>
            <span>{p.filename}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBig(false)}>關閉</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- 上傳：多選、瀏覽器先縮圖、逐張上傳顯示進度 ---------- */
function UploadPhotosModal({ albums, defaultAlbum, onClose, onDone }) {
  const [files, setFiles] = useState([]);
  const [albumSel, setAlbumSel] = useState(defaultAlbum || (albums[0]?.album ?? ""));
  const [newAlbum, setNewAlbum] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [progress, setProgress] = useState(null); // {done, total, name}
  const abort = useRef(false);

  const albumOptions = [...albums.map((a) => ({ value: a.album, label: a.album || "未分類" })), { value: NEW_ALBUM, label: "＋ 新增相簿…" }];
  if (!albums.length) albumOptions.unshift({ value: "", label: "未分類" });

  const start = async () => {
    if (!files.length) return toastErr(new Error("請先選擇照片"));
    const album = albumSel === NEW_ALBUM ? newAlbum.trim() : albumSel;
    if (albumSel === NEW_ALBUM && !album) return toastErr(new Error("請填相簿名稱"));
    abort.current = false;
    let done = 0;
    const failed = [];
    for (const f of files) {
      if (abort.current) break;
      setProgress({ done, total: files.length, name: f.name });
      try {
        const small = await resizeImage(f);
        await uploadFile(small, { kind: "photo", is_public: isPublic ? "true" : "false", album });
      } catch (e) {
        failed.push(`${f.name}：${e.message}`);
      }
      done += 1;
    }
    setProgress(null);
    if (failed.length) {
      await Swal.fire({ icon: "warning", title: `${failed.length} 張上傳失敗`, html: failed.slice(0, 5).join("<br>"), confirmButtonColor: "#B28F70" });
    } else {
      toastOk(`已上傳 ${done} 張`);
    }
    onDone();
  };

  return (
    <Modal title="上傳照片" onClose={() => { abort.current = true; onClose(); }} wide
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => { abort.current = true; onClose(); }}>{progress ? "停止" : "取消"}</button>
          <button type="button" className="btn btn-primary" disabled={!!progress || !files.length} onClick={start}>
            {progress ? `上傳中 ${progress.done + 1} / ${progress.total}…` : `上傳 ${files.length ? files.length + " 張" : ""}`}
          </button>
        </>
      }>
      <Field label="照片" hint="可一次選很多張；超過 2000px 的會在你的裝置上先縮小再上傳，省時間也省空間">
        <div className="ui-file">
          <label className="btn btn-ghost" style={{ cursor: "pointer", alignSelf: "flex-start" }}>
            <Images size={14} /> 選擇照片
            <input type="file" multiple hidden accept="image/*,.heic" onChange={(e) => { setFiles((cur) => [...cur, ...Array.from(e.target.files || [])]); e.target.value = ""; }} />
          </label>
          {files.length === 0 ? <span className="helper-text">尚未選擇</span> : (
            <div className="ui-file-list">
              {files.slice(0, 30).map((f, i) => (
                <span key={`${f.name}-${i}`} className="pill pill-groom ui-file-item">
                  {f.name}（{fmtSize(f.size)}）
                  <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="移除">✕</button>
                </span>
              ))}
              {files.length > 30 && <span className="muted-cell">…共 {files.length} 張</span>}
            </div>
          )}
        </div>
      </Field>
      <div className="form-group grid-2">
        <Field label="放到哪本相簿"><Select value={albumSel} onChange={setAlbumSel} options={albumOptions} /></Field>
        {albumSel === NEW_ALBUM
          ? <Field label="新相簿名稱"><input type="text" value={newAlbum} onChange={(e) => setNewAlbum(e.target.value)} placeholder="例如：婚紗照、婚禮當天" autoFocus /></Field>
          : <Field label="上傳後"><Select value={isPublic} onChange={(v) => setIsPublic(v === true || v === "true")} options={[{ value: true, label: "直接公開" }, { value: false, label: "先不公開（之後再挑）" }]} /></Field>}
      </div>
      {progress && <div className="helper-text">正在上傳：{progress.name}</div>}
    </Modal>
  );
}

/* ---------- 編輯說明 / 相簿 ---------- */
function EditPhotoModal({ p, albums, onClose, onSaved }) {
  const [caption, setCaption] = useState(p.caption || "");
  const [albumSel, setAlbumSel] = useState(p.album || "");
  const [newAlbum, setNewAlbum] = useState("");
  const [busy, setBusy] = useState(false);
  const albumOptions = [...albums.map((a) => ({ value: a.album, label: a.album || "未分類" })), { value: NEW_ALBUM, label: "＋ 新增相簿…" }];
  const save = async () => {
    const album = albumSel === NEW_ALBUM ? newAlbum.trim() : albumSel;
    if (albumSel === NEW_ALBUM && !album) return toastErr(new Error("請填相簿名稱"));
    setBusy(true);
    try {
      await updateFile(p.id, { caption: caption.trim(), album });
      onSaved();
    } catch (e) {
      toastErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="照片說明" onClose={onClose} footer={<><button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>取消</button><button type="button" className="btn btn-primary" onClick={save} disabled={busy}>儲存</button></>}>
      <Field label="說明（顯示在照片下方，可不填）"><input type="text" value={caption} onChange={(e) => setCaption(e.target.value)} autoFocus placeholder="例如：陽明山外景" /></Field>
      <Field label="相簿"><Select value={albumSel} onChange={setAlbumSel} options={albumOptions} /></Field>
      {albumSel === NEW_ALBUM && <Field label="新相簿名稱"><input type="text" value={newAlbum} onChange={(e) => setNewAlbum(e.target.value)} /></Field>}
    </Modal>
  );
}
