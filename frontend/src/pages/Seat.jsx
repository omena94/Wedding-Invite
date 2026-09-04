// 婚禮當天查桌次：輸入姓名或電話，顯示自己的位子、鄰座、同桌名單與平面圖
import { useEffect, useState } from "react";
import { ArrowLeft, Armchair, Search } from "lucide-react";
import { fetchStage, seatLookup } from "../api.js";
import SeatResult from "../seating/SeatResult.jsx";

export default function Seat() {
  const [stage, setStage] = useState(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchStage().then(setStage).catch(() => setStage({ seat_open: false }));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setResult(null);
    const query = q.trim();
    if (!query) return setError("請輸入第一階段填寫的姓名或電話");
    setBusy(true);
    try {
      setResult(await seatLookup(query));
    } catch (err) {
      setError(err.message || "查詢失敗，請找招待協助");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container">
      <header className="hero-arch-card">
        <p className="script-title">Find Your Seat</p>
        <p className="english-sub">Alan &amp; Omena</p>
        <div className="illustration-art-wrapper hero-swap">
          <img src="/hero-line.png" alt="Alan & Omena" className="hero-image" />
          <img src="/hero.png" alt="Alan & Omena" className="hero-image hero-swap-back" />
        </div>
        <h1 className="main-title">查詢桌次</h1>
        <p className="invitation-quote">輸入第一階段填寫的姓名或電話<br />就能看到你的座位、旁邊坐誰</p>
      </header>

      {stage === null ? (
        <div className="loading">讀取中…</div>
      ) : !stage.seat_open ? (
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
              <input type="text" value={q} onChange={(e) => { setQ(e.target.value); setError(""); }} placeholder="例如 王小明 或 0912345678" autoFocus />
            </div>
            {error && <p style={{ color: "var(--rose-accent)", fontSize: 13.5 }}>{error}</p>}
          </section>
          <button type="submit" className="btn-submit" disabled={busy}>{busy ? "查詢中…" : <><Search size={17} /> 查詢我的桌次</>}</button>
          <SeatResult result={result} />
        </form>
      )}

      <p className="footnote"><a href="/" className="top-link"><ArrowLeft size={14} /> 回首頁</a></p>
    </div>
  );
}
