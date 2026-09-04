// 賓客查桌次的結果：自己的桌子與座號，加上可以縮放、點選的整張座位圖（點椅子看旁邊坐誰）。
// 賓客頁 /seat 與後台「預覽賓客畫面」共用。
import { useMemo } from "react";
import SeatViewer from "./SeatViewer.jsx";

export default function SeatResult({ result }) {
  const mineIds = useMemo(() => new Set((result?.seats || []).map((s) => s.object_id)), [result]);

  if (!result) return null;
  if (!result.found) {
    return (
      <section className="section-card seat-result">
        <div className="seat-result-title">找不到這筆資料</div>
        <p>請確認姓名或電話與第一階段填寫的相同，或直接找現場招待協助</p>
      </section>
    );
  }
  if (result.attending === false) {
    return (
      <section className="section-card seat-result">
        <div className="seat-result-title">{result.name}</div>
        <p>這組賓客回覆不出席，不會有座位</p>
      </section>
    );
  }
  const tables = result.tables || [];
  if (tables.length === 0) {
    return (
      <section className="section-card seat-result">
        <div className="seat-result-title">{result.name}，歡迎你！</div>
        {result.table_no !== null && result.table_no !== undefined
          ? <><div className="seat-result-table">第 <strong>{result.table_no}</strong> 桌</div><p>請依桌牌入座，有問題請找招待</p></>
          : <p>桌次還在安排中，請找現場招待帶位</p>}
      </section>
    );
  }
  const seatsByTable = Object.fromEntries(tables.map((t) => [t.object_id, result.seats.filter((s) => s.object_id === t.object_id)]));

  return (
    <section className="section-card seat-result">
      <div className="seat-result-title">{result.name}，歡迎你！</div>
      <div className="seat-result-mine">
        {tables.map((t) => (
          <div key={t.object_id} className="seat-result-table">
            <strong>{t.label || "桌"}</strong>
            <div className="seat-result-seats">
              {seatsByTable[t.object_id].map((s) => <span key={s.seat_no} className="pill pill-yes">{s.display_name} · {s.seat_no} 號</span>)}
            </div>
          </div>
        ))}
      </div>
      <p>金色的椅子就是你的位子。點任何一張椅子，就能看到是誰、旁邊坐誰</p>
      {result.map && <SeatViewer layout={result.map} names={result.map_names || {}} mineIds={mineIds} />}
    </section>
  );
}
