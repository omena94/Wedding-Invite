// 賓客查桌次的結果：自己的位子、左右鄰座、同桌名單、平面圖。賓客頁 /seat 與後台「預覽賓客畫面」共用。
import { useMemo } from "react";
import SeatingMap from "./SeatingMap.jsx";

export default function SeatResult({ result, mapHeight = 360 }) {
  const highlight = useMemo(() => {
    if (!result?.seats?.length) return { ids: new Set(), seats: new Set() };
    return {
      ids: new Set(result.seats.map((s) => s.object_id)),
      seats: new Set(result.seats.map((s) => `${s.object_id}:${s.seat_no - 1}`)),
    };
  }, [result]);

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
      {tables.map((t) => (
        <div key={t.object_id} className="seat-table-card">
          <div className="seat-result-table">
            <strong style={{ fontSize: 32 }}>{t.label || "桌"}</strong>
            <div style={{ fontSize: 14, marginTop: 4 }}>
              {seatsByTable[t.object_id].map((s) => <span key={s.seat_no} className="pill pill-yes" style={{ margin: 2 }}>{s.display_name} · {s.seat_no} 號</span>)}
            </div>
          </div>
          {seatsByTable[t.object_id].some((s) => (s.neighbors || []).length) && (
            <div className="seat-neighbors">
              {seatsByTable[t.object_id].map((s) => (
                <div key={s.seat_no} className="seat-neighbor-row">
                  <span className="seat-neighbor-who">{s.display_name}（{s.seat_no} 號）旁邊：</span>
                  {(s.neighbors || []).map((nb) => (
                    <span key={nb.seat_no} className="pill pill-groom" style={{ margin: 2 }}>{nb.seat_no} 號 {nb.name || "空位"}</span>
                  ))}
                </div>
              ))}
            </div>
          )}
          <div className="seat-mates">
            <div className="seat-mates-title">同桌（{t.mates.filter((m) => m.name).length}/{t.seats_total} 位）</div>
            <ol className="seat-mates-list">
              {t.mates.map((m) => (
                <li key={m.seat_no} className={m.mine ? "mine" : m.name ? "" : "empty"}>
                  <span className="seat-mates-no">{m.seat_no}</span>
                  <span>{m.name || "（空位）"}{m.mine ? "　👈 你" : ""}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      ))}
      <p>平面圖上亮起來的就是你的位子，有問題請找招待</p>
      {result.map && (
        <SeatingMap layout={result.map} highlightIds={highlight.ids} highlightSeats={highlight.seats}
          seatNames={result.map_names || null} maxHeight={mapHeight} className="seat-result-map" />
      )}
    </section>
  );
}
