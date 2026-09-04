// 婚紗照分享頁：分相簿、方格牆（縮圖）、燈箱可左右滑
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Images } from "lucide-react";
import { fetchAuthBlobUrl, fetchPhotos, fetchStage, photoThumbUrl, photoUrl } from "../api.js";
import PreviewBanner from "../components/PreviewBanner.jsx";

// 預覽模式（頁面還沒開放、但已登入後台）：<img src> 帶不了 token，改成先 fetch 再顯示
function PhotoImg({ src, auth, ...rest }) {
  const [url, setUrl] = useState(auth ? null : src);
  useEffect(() => {
    if (!auth) { setUrl(src); return undefined; }
    let alive = true;
    let obj = null;
    fetchAuthBlobUrl(src).then((u) => { if (alive) { obj = u; setUrl(u); } else URL.revokeObjectURL(u); }).catch(() => {});
    return () => { alive = false; if (obj) URL.revokeObjectURL(obj); };
  }, [src, auth]);
  return url ? <img src={url} {...rest} /> : <span className="photo-img-loading" aria-hidden="true" />;
}

export default function Photos() {
  const [photos, setPhotos] = useState(null);
  const [stage, setStage] = useState(null);
  const [album, setAlbum] = useState("");
  const [current, setCurrent] = useState(null);
  const touch = useRef(null);

  useEffect(() => {
    fetchPhotos().then(setPhotos).catch(() => setPhotos([]));
    fetchStage().then(setStage).catch(() => setStage({}));
  }, []);
  const previewClosed = !!(stage && stage.preview && !stage.photos_open); // 賓客還看不到，只有登入者在看

  const albums = useMemo(() => {
    const seen = [];
    (photos || []).forEach((p) => { const a = p.album || ""; if (!seen.includes(a)) seen.push(a); });
    return seen;
  }, [photos]);
  useEffect(() => {
    if (albums.length && !albums.includes(album)) setAlbum(albums[0]);
  }, [albums, album]);
  const list = useMemo(() => (photos || []).filter((p) => (p.album || "") === album), [photos, album]);

  useEffect(() => {
    if (current === null) return;
    const onKey = (e) => {
      if (e.key === "Escape") setCurrent(null);
      if (e.key === "ArrowRight") setCurrent((i) => Math.min(list.length - 1, i + 1));
      if (e.key === "ArrowLeft") setCurrent((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [current, list.length]);

  const onTouchStart = (e) => { touch.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touch.current === null) return;
    const dx = e.changedTouches[0].clientX - touch.current;
    touch.current = null;
    if (Math.abs(dx) < 40) return;
    setCurrent((i) => (dx < 0 ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1)));
  };

  return (
    <div className="container container-photos">
      <PreviewBanner stage={stage} closedLabels={stage && !stage.photos_open ? ["婚紗照"] : []} />
      <header className="hero-arch-card">
        <p className="script-title">Our Moments</p>
        <p className="english-sub">Alan &amp; Omena</p>
        <h1 className="main-title">婚紗照</h1>
        <p className="invitation-quote">謝謝你們一路的祝福<br />這是我們留下的美好片刻</p>
      </header>

      {photos === null ? (
        <div className="loading">讀取中…</div>
      ) : photos.length === 0 ? (
        <section className="section-card" style={{ textAlign: "center" }}>
          <div className="section-header" style={{ justifyContent: "center" }}>
            <div className="section-header-title"><Images size={18} /> 照片還沒準備好</div>
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.8 }}>{previewClosed ? "後台還沒有標記為公開的照片；到「照片」頁上傳並設為公開就會出現在這裡" : "婚紗照取件後會放上來，敬請期待"}</p>
        </section>
      ) : (
        <>
          {albums.length > 1 && (
            <div className="photo-albums">
              {albums.map((a) => (
                <button key={a} type="button" className={`pill ${a === album ? "pill-yes" : "pill-groom"} photo-album-pill`} onClick={() => { setAlbum(a); setCurrent(null); }}>
                  {a || "未分類"}
                </button>
              ))}
            </div>
          )}
          <div className="photo-grid">
            {list.map((p, i) => (
              <button type="button" key={p.id} className="photo-cell" onClick={() => setCurrent(i)} aria-label={p.caption || `照片 ${i + 1}`}>
                <PhotoImg src={p.has_thumb ? photoThumbUrl(p.id) : photoUrl(p.id)} auth={previewClosed} alt={p.caption || ""} loading="lazy" />
                {p.caption && <span className="photo-cell-caption">{p.caption}</span>}
              </button>
            ))}
          </div>
        </>
      )}

      {current !== null && list[current] && (
        <div className="photo-lightbox" onClick={() => setCurrent(null)} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <PhotoImg src={photoUrl(list[current].id)} auth={previewClosed} alt={list[current].caption || ""} onClick={(e) => e.stopPropagation()} />
          {list[current].caption && <div className="photo-lightbox-caption">{list[current].caption}</div>}
          <div className="photo-lightbox-nav" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="btn btn-ghost btn-sm" disabled={current === 0} onClick={() => setCurrent(current - 1)}>‹ 上一張</button>
            <span>{current + 1} / {list.length}</span>
            <button type="button" className="btn btn-ghost btn-sm" disabled={current === list.length - 1} onClick={() => setCurrent(current + 1)}>下一張 ›</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCurrent(null)}>關閉</button>
          </div>
        </div>
      )}

      <p className="footnote"><a href="/" className="top-link"><ArrowLeft size={14} /> 回首頁</a></p>
    </div>
  );
}
