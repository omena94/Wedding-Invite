// 婚禮當天查桌次：輸入姓名或電話，顯示每個人的桌子與座位，並在平面圖上標亮
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Armchair, Search } from "lucide-react";
import { fetchStage, seatLookup } from "../api.js";
import SeatingMap from "../seating/SeatingMap.jsx";

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

  const highlight = useMemo(() => {
    if (!result?.seats?.length) return { ids: new Set(), seats: new Set() };
    return {
      ids: new Set(result.seats.map((s) => s.object_id)),
      seats: new Set(result.seats.map((s) => `${s.object_id}:${s.seat_no - 1}`)),
    };
  }, [result]);

  // 同一桌的人合併顯示：「A1 桌 · 3、4、5 號」
  const grouped = useMemo(() => {
    const m = new Map();
    (result?.seats || []).forEach((s) => {
      const key = s.object_id;
      if (!m.has(key)) m.set(key, { label: s.table_label, people: [] });
      m.get(key).people.push(s);
    });
    return Array.from(m.values());
  }, [result]);

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
        <p className="invitation-quote">輸入第一階段填寫的姓名或電話<br />就能看到你的座位</p>
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

          {result && (
            <section className="section-card seat-result">
              {!result.found ? (
                <>
                  <div className="seat-result-title">找不到這筆資料</div>
                  <p>請確認姓名或電話與第一階段填寫的相同，或直接找現場招待協助</p>
                </>
              ) : grouped.length > 0 ? (
                <>
                  <div className="seat-result-title">{result.name}，歡迎你！</div>
                  {grouped.map((g, i) => (
                    <div key={i} className="seat-result-table">
                      <strong style={{ fontSize: 32 }}>{g.label || "桌"}</strong>
                      <div style={{ fontSize: 14, marginTop: 4 }}>
                        {g.people.map((p) => <span key={p.seat_no} className="pill pill-groom" style={{ margin: 2 }}>{p.display_name} · {p.seat_no} 號</span>)}
                      </div>
                    </div>
                  ))}
                  <p>平面圖上亮起來的就是你的位子，有問題請找招待</p>
                  {result.map && <SeatingMap layout={result.map} highlightIds={highlight.ids} highlightSeats={highlight.seats} maxHeight={360} className="seat-result-map" />}
                </>
              ) : result.table_no !== null && result.table_no !== undefined ? (
                <>
                  <div className="seat-result-title">{result.name}，歡迎你！</div>
                  <div className="seat-result-table">第 <strong>{result.table_no}</strong> 桌</div>
                  <p>請依桌牌入座，有問題請找招待</p>
                </>
              ) : (
                <>
                  <div className="seat-result-title">{result.name}，歡迎你！</div>
                  <p>桌次還在安排中，請找現場招待帶位</p>
                </>
              )}
            </section>
          )}
        </form>
      )}

      <p className="footnote"><a href="/" className="top-link"><ArrowLeft size={14} /> 回首頁</a></p>
    </div>
  );
}
