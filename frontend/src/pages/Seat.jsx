import { GuestHeader, GuestNav, LoadError, useGuestLoad, GuestReceipt, useDraft } from '../components/GuestUI.jsx';
// 婚禮當天查桌次：輸入姓名或電話，顯示自己的位子、鄰座、同桌名單與平面圖
import { useEffect, useState } from "react";
import { ArrowLeft, Armchair, Search } from "lucide-react";
import { fetchStage, seatLookup } from "../api.js";
import SeatResult from "../seating/SeatResult.jsx";
import PreviewBanner from "../components/PreviewBanner.jsx";

export default function Seat() {
  const {data:stage,error:stageError,retry}=useGuestLoad(fetchStage);
  const [phone,setPhone]=useState('');
  const [q,setQ]=useState('');
  const [busy,setBusy]=useState(false);
  const [result,setResult]=useState(null);
  const [error,setError]=useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setResult(null);
    const query = q.trim();
    if (!query) return setError("請輸入第一階段填寫的姓名或電話");
    setBusy(true);
    try {
      setResult(await seatLookup(query,phone));
    } catch (err) {
      setError(err.message || "查詢失敗，請找招待協助");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container">
      <PreviewBanner stage={stage} closedLabels={stage && !stage.seat_open ? ["桌次查詢"] : []} />
      <GuestHeader title="找到你的那一席" subtitle="輸入姓名或手機，讓我們帶你入座"/>

      {stageError ? <LoadError error={stageError} retry={retry}/> : stage === null ? (
        <div className="loading">讀取中…</div>
      ) : !stage.seat_open && !stage.preview ? (
        <section className="section-card" style={{ textAlign: "center" }}>
          <div className="section-header" style={{ justifyContent: "center" }}>
            <div className="section-header-title"><Armchair size={18} /> 桌次查詢尚未開放</div>
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.8 }}>婚禮當天會開放查詢，到時候再來看看喔</p>
        </section>
      ) : (
        <form onSubmit={submit}>
          <section className="section-card">
            <div className="section-header">
              <div className="section-header-title"><Search size={18} /> 姓名或電話</div>
              <div className="section-header-en">Name or Phone</div>
            </div>
            <div className="form-group">
              <input type="text" aria-label="姓名或手機號碼" value={q} onChange={(e) => { setQ(e.target.value); setError(""); setPhone("");setResult(null); }} placeholder="例如 王小明、0912345678 或 Email" />
            </div>
            {result?.needs_phone&&<div className="form-group"><p>有同名的賓客，請再輸入原先留的手機確認。</p><label htmlFor="seat-phone">手機號碼</label><input id="seat-phone" type="tel" autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)}/></div>}
            {error && <p role="alert" style={{ color: "var(--rose-accent)", fontSize: 13.5 }}>{error}</p>}
          </section>
          <button type="submit" className="btn-submit" disabled={busy}>{busy ? "查詢中…" : <><Search size={17} /> 查詢我的桌次</>}</button>
          <SeatResult result={result} />
        </form>
      )}

      <p className="footnote"><a href="/" className="top-link"><ArrowLeft size={14} /> 回首頁</a></p>
      <GuestNav/>
    </div>
  );
}
