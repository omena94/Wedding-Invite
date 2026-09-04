// 賓客查桌次的結果。現場沒有人帶位、也有長輩在用，所以：
//   1. 桌名與座號字很大、一句白話的「怎麼走」（依新人在平面圖畫的「入口」「舞台」算出來）
//   2. 下面是整張座位圖：開場先放大自己的位子再縮小到全場、紅色虛線指路、點椅子看旁邊坐誰
// 賓客頁 /seat 與後台「預覽賓客畫面」共用。
import { useMemo } from "react";
import SeatViewer from "./SeatViewer.jsx";
import { describeRoute } from "./guide.js";

export default function SeatResult({ result }) {
  const mineIds = useMemo(() => new Set((result?.seats || []).map((s) => s.object_id)), [result]);
  const guides = useMemo(() => {
    const objs = result?.map?.objects || [];
    return (result?.tables || []).map((t) => {
      const table = objs.find((o) => o.id === t.object_id);
      return table ? describeRoute(objs, table) : { text: `請找桌上寫著「${t.label}」桌牌的那一桌。`, line: null };
    });
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
  const routes = guides.map((g) => g.line).filter(Boolean);

  return (
    <section className="section-card seat-result">
      <div className="seat-result-title">{result.name}，歡迎您！</div>
      {tables.map((t, i) => (
        <div key={t.object_id} className="seat-big">
          <div className="seat-big-label">您的桌子</div>
          <div className="seat-big-table">{t.label || "桌"}</div>
          <div className="seat-big-label">您的座位</div>
          <div className="seat-big-seats">
            {seatsByTable[t.object_id].map((s) => <span key={s.seat_no} className="seat-big-seat">{s.display_name}　<strong>{s.seat_no} 號</strong></span>)}
          </div>
          <div className="seat-guide"><span className="seat-guide-title">怎麼走</span>{guides[i]?.text}</div>
        </div>
      ))}
      <p className="seat-result-hint">
        下面是整個場地的地圖：<strong>金色亮亮的椅子就是您的位子</strong>{routes.length > 0 ? "，紅色虛線是從入口走過去的方向" : ""}。
        地圖會先放大您的位子，再慢慢縮小到整個場地；用手指可以放大、縮小、移動。
      </p>
      {result.map && <SeatViewer key={`${result.name}:${(result.seats || []).map((s) => `${s.object_id}-${s.seat_no}`).join(",")}`}
        layout={result.map} names={result.map_names || {}} mineIds={mineIds} routes={routes} />}
    </section>
  );
}
