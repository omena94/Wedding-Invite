// 婚紗照分享頁：分相簿、方格牆（縮圖）、燈箱可左右滑
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Heart, Images, ShieldCheck, Sparkles } from "lucide-react";
import { fetchPhotos, fetchStage, photoThumbUrl, photoUrl } from "../api.js";
import PreviewBanner from "../components/PreviewBanner.jsx";
import { GuestHeader, GuestNav, LoadError, useGuestLoad } from '../components/GuestUI.jsx';

import PhotoImg from "../components/PhotoImage.jsx";

export default function Photos() {
  const {data:photos,error:photoError,retry:retryPhotos}=useGuestLoad(fetchPhotos);
  const {data:stage,error:stageError,retry:retryStage}=useGuestLoad(fetchStage);
  const [album, setAlbum] = useState("");
  const [current, setCurrent] = useState(null);
  const touch = useRef(null);

  const lightbox=useRef(null);
  const isOpen=current!==null;
  useEffect(()=>{
    if(!isOpen)return;
    const previous=document.activeElement;
    lightbox.current?.querySelector('button:not(:disabled)')?.focus();
    const trap=e=>{if(e.key!=='Tab')return;const items=[...lightbox.current.querySelectorAll('button:not(:disabled)')];if(!items.length)return;const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}};
    const el=lightbox.current;el?.addEventListener('keydown',trap);
    return()=>{el?.removeEventListener('keydown',trap);previous?.focus();};
  },[isOpen]);
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
    <div className="container container-photos guest-page">
      <PreviewBanner stage={stage} closedLabels={stage && !stage.photos_open ? ["婚紗照"] : []} />
      <GuestHeader title="把喜歡的時光，留在這裡" english="OUR MOMENTS" subtitle="與你分享我們的美好片刻"/>
      <section className="photo-notice" aria-label="肖像與影像權益提醒">
        <strong><ShieldCheck size={16} aria-hidden="true"/> 肖像與影像權益提醒</strong>
        <p>本頁面展示之婚紗攝影與影像內容，肖像權及著作權為新人與合作攝影團隊所有。</p>
        <p>僅供受邀親友線上瀏覽祝福，請勿擅自下載、截圖、轉載、重製或作其他商業與公開傳播用途，感謝大家的體貼與尊重 <Heart size={14} className="inline-heart" aria-hidden="true"/></p>
      </section>

      {photoError||stageError ? <LoadError error={photoError||stageError} retry={()=>{retryPhotos();retryStage();}}/> : photos === null || stage === null ? (
        <div className="loading">讀取中…</div>
      ) : !stage.photos_open&&!stage.preview ? (
        <section className="section-card" style={{ textAlign: "center" }}>
          <div className="section-header" style={{ justifyContent: "center" }}>
            <div className="section-header-title"><Images size={18} /> 美好回憶整理中</div>
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.8 }}>目前尚無公開的照片，甜蜜畫面正在悄悄準備中 <Sparkles size={15} className="wish-sparkle" aria-hidden="true"/></p>
          <div className="receipt-actions"><a className="btn" href="/">回首頁</a></div>
        </section>
      ) : photos.length === 0 ? (
        <section className="section-card" style={{ textAlign: "center" }}>
          <div className="section-header" style={{ justifyContent: "center" }}>
            <div className="section-header-title"><Images size={18} /> 美好回憶整理中</div>
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.8 }}>目前尚無公開的照片，甜蜜畫面正在悄悄準備中 <Sparkles size={15} className="wish-sparkle" aria-hidden="true"/></p>
          {stage.preview && <p className="helper-text">（管理員請至後台「婚紗照」上傳，相簿設成「賓客看得到」、照片設為公開，就會在這裡顯示）</p>}
          <div className="receipt-actions"><a className="btn" href="/">回首頁</a></div>
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
        <div ref={lightbox} role="dialog" aria-modal="true" aria-label="婚紗照瀏覽" className="photo-lightbox" onClick={() => setCurrent(null)} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <PhotoImg key={list[current].id} retryable src={photoUrl(list[current].id)} auth={previewClosed} alt={list[current].caption || ""} onClick={(e) => e.stopPropagation()} />
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
      <GuestNav/>
    </div>
  );
}
