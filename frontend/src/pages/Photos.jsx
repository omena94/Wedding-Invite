// 婚紗照分享頁：只顯示後台標記為公開的照片
import { useEffect, useState } from "react";
import { ArrowLeft, Images } from "lucide-react";
import { fetchPhotos, photoUrl } from "../api.js";

export default function Photos() {
  const [photos, setPhotos] = useState(null);
  const [current, setCurrent] = useState(null);

  useEffect(() => {
    fetchPhotos().then(setPhotos).catch(() => setPhotos([]));
  }, []);

  useEffect(() => {
    if (current === null) return;
    const onKey = (e) => {
      if (e.key === "Escape") setCurrent(null);
      if (e.key === "ArrowRight") setCurrent((i) => Math.min(photos.length - 1, i + 1));
      if (e.key === "ArrowLeft") setCurrent((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, photos]);

  return (
    <div className="container container-photos">
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
          <p style={{ fontSize: 14, lineHeight: 1.8 }}>婚紗照取件後會放上來，敬請期待</p>
        </section>
      ) : (
        <div className="photo-grid">
          {photos.map((p, i) => (
            <button type="button" key={p.id} className="photo-cell" onClick={() => setCurrent(i)} aria-label={`照片 ${i + 1}`}>
              <img src={photoUrl(p.id)} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      {current !== null && photos && photos[current] && (
        <div className="photo-lightbox" onClick={() => setCurrent(null)}>
          <img src={photoUrl(photos[current].id)} alt="" onClick={(e) => e.stopPropagation()} />
          <div className="photo-lightbox-nav" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="btn btn-ghost btn-sm" disabled={current === 0} onClick={() => setCurrent(current - 1)}>‹ 上一張</button>
            <span>{current + 1} / {photos.length}</span>
            <button type="button" className="btn btn-ghost btn-sm" disabled={current === photos.length - 1} onClick={() => setCurrent(current + 1)}>下一張 ›</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCurrent(null)}>關閉</button>
          </div>
        </div>
      )}

      <p className="footnote"><a href="/" className="top-link"><ArrowLeft size={14} /> 回首頁</a></p>
    </div>
  );
}
