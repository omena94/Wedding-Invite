// 賓客查桌次的結果。現場沒有人帶位、也有長輩在用，所以：
//   1. 卡片只放最重要的：桌名與座號大字、一句白話的「怎麼走」、一顆大按鈕「打開地圖」
//   2. 查到後自動開啟全螢幕：先標記我的位置，再平滑放大至入口與座位之間的路線，
//      紅色虛線指路、點椅子看旁邊坐誰；關掉就回到這張卡
// 賓客頁 /seat 與後台「預覽賓客畫面」共用；後台的手機框用 embedded（地圖直接嵌在卡片裡，不全螢幕）。
import { useEffect, useMemo, useRef, useState } from "react";
import { Map as MapIcon } from "lucide-react";
import SeatViewer from "./SeatViewer.jsx";

export default function SeatResult({ result, embedded = false }) {
  const [mapOpen, setMapOpen] = useState(false);
  const cardRef = useRef(null);
  const mineIds = useMemo(() => new Set((result?.seats || []).map((s) => s.object_id)), [result]);
  const hasMap = !!(result && result.found && result.attending !== false && (result.tables || []).length && result.map);

  // 查到之後：自動打開全螢幕地圖（後台預覽不用）
  useEffect(() => {
    if (!result) return;
    setMapOpen(hasMap && !embedded);
  }, [result, hasMap, embedded]);
  // 地圖關掉（或沒有地圖）時把結果卡捲到畫面最上面；瀏覽器「返回」會把捲動位置還原到最上面，所以要再捲一次
  useEffect(() => {
    if (!result || mapOpen) return undefined;
    const t = setTimeout(() => cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 200);
    return () => clearTimeout(t);
  }, [result, mapOpen]);

  if (!result) return null;
  if (result.needs_phone) return null;
  if (!result.found) {
    return (
      <section ref={cardRef} className="section-card seat-result">
        <div className="seat-result-title">找不到這筆資料</div>
        <p>請確認姓名或電話與第一階段填寫的相同，或直接找現場招待協助</p>
      </section>
    );
  }
  if (result.attending === false) {
    return (
      <section ref={cardRef} className="section-card seat-result">
        <div className="seat-result-title">{result.name}</div>
        <p>這組賓客回覆不出席，不會有座位</p>
      </section>
    );
  }
  const tables = result.tables || [];
  if (tables.length === 0) {
    return (
      <section ref={cardRef} className="section-card seat-result">
        <div className="seat-result-title">{result.name}，歡迎您！</div>
        {result.table_no !== null && result.table_no !== undefined
          ? <><div className="seat-result-table">第 <strong>{result.table_no}</strong> 桌</div><p>請依桌牌入座，有問題請找招待</p></>
          : <p>桌次還在安排中，請找現場招待帶位</p>}
      </section>
    );
  }
  const seatsByTable = Object.fromEntries(tables.map((t) => [t.object_id, result.seats.filter((s) => s.object_id === t.object_id)]));
  const title = tables.map((t) => `${t.label || "桌"} · ${seatsByTable[t.object_id].map((s) => `${s.seat_no} 號`).join("、")}`).join("　");
  const viewerKey = `${result.name}:${(result.seats || []).map((s) => `${s.object_id}-${s.seat_no}`).join(",")}`;
  const viewer = (fullscreen) => (
    <SeatViewer key={viewerKey} layout={result.map} names={result.map_names || {}} mineIds={mineIds}
      fullscreen={fullscreen} onClose={() => setMapOpen(false)} title={title} />
  );

  return (
    <section ref={cardRef} className="section-card seat-result">
      <div className="seat-result-title">{result.name}，歡迎您！</div>
      {tables.map((t, i) => (
        <div key={t.object_id} className="seat-big">
          <div className="seat-big-grid">
            <div>
              <div className="seat-big-label">您的桌子</div>
              <div className="seat-big-table">{t.label || "桌"}</div>
            </div>
            <div>
              <div className="seat-big-label">您的座位</div>
              <div className="seat-big-seats">
                {seatsByTable[t.object_id].map((s) => <span key={s.seat_no} className="seat-big-seat"><strong>{s.seat_no} 號</strong><small>{s.display_name}</small></span>)}
              </div>
            </div>
          </div>
          <div className="seat-guide">打開地圖，選擇您所在的入口，即可查看前往座位的路線。</div>
        </div>
      ))}
      {!embedded && hasMap && (
        <button type="button" className="btn-submit seat-open-map" onClick={() => setMapOpen(true)}>
          <MapIcon size={20} /> 打開地圖，看怎麼走
        </button>
      )}
      {!embedded && hasMap && mapOpen && viewer(true)}
      {embedded && hasMap && viewer(false)}
    </section>
  );
}
