// 賓客查桌次的結果。現場沒有人帶位、也有長輩在用，所以：
//   1. 卡片只放最重要的：桌名與座號大字、一句白話的「怎麼走」、一顆大按鈕「打開地圖」
//   2. 查到後自動開啟全螢幕：先標記我的位置，再平滑放大至入口與座位之間的路線，
//      紅色虛線指路、點椅子看旁邊坐誰；關掉就回到這張卡
// 賓客頁 /seat 與後台「預覽賓客畫面」共用；後台的手機框用 embedded（地圖直接嵌在卡片裡，不全螢幕）。
import { useEffect, useMemo, useRef, useState } from "react";
import { Map as MapIcon } from "lucide-react";
import SeatViewer from "./SeatViewer.jsx";

// 2026-09-23 新人設計的婚禮謝卡（Canva 匯出的 PDF 轉成 SVG，放在 public/cards）：
// 正面是 Thank you 與名字日期，點一下翻到背面，背面留白區疊上新人留給這一戶的話。字數多時字級自動縮小
function ThankCard({ message }) {
  const [flipped, setFlipped] = useState(false);
  const n = message.length;
  const size = n > 260 ? "xs" : n > 170 ? "sm" : n > 100 ? "md" : "lg";
  return (
    <div className="tc-wrap">
      <button type="button" className={`tc-card${flipped ? " flipped" : ""}`} onClick={() => setFlipped((v) => !v)} aria-label={flipped ? "翻回正面" : "翻開卡片看留言"}>
        <div className="tc-face tc-front">
          <img src="/cards/thankcard-front.svg" alt="Thank you for sharing our special day. Alan & Omena" draggable="false" />
          <span className="tc-hint">點一下翻開</span>
        </div>
        <div className="tc-face tc-back">
          <img src="/cards/thankcard-back.svg" alt="" draggable="false" />
          <div className={`tc-text tc-${size}`}>{message}</div>
        </div>
      </button>
    </div>
  );
}

export default function SeatResult({ result, embedded = false }) {
  const [mapOpen, setMapOpen] = useState(false);
  const cardRef = useRef(null);
  const mineIds = useMemo(() => new Set((result?.seats || []).map((s) => s.object_id)), [result]);
  const hasMap = !!(result && result.found && result.attending !== false && (result.tables || []).length && result.map);

  // 查到之後：自動打開全螢幕地圖（後台預覽不用）。有新人留的話（或要提示改用電話查）時先不開，
  // 讓賓客先看到座位卡和留言，再自己按「打開地圖」（2026-09-23 新人反映查完只看到地圖沒看到留言）
  useEffect(() => {
    if (!result) return;
    setMapOpen(hasMap && !embedded && !result.message && !result.message_locked);
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
  // 新人當天留給這一戶的話（只有用電話或 Email 查到才有）；用姓名查到的提示再查一次。還沒排位的也要顯示
  const messageBlock = result.message ? (
    <ThankCard message={result.message} />
  ) : result.message_locked ? (
    <p className="seat-message-locked">我們留了一段話給你，用當初填的手機號碼或 Email 再查一次就看得到。</p>
  ) : null;
  if (tables.length === 0) {
    return (
      <section ref={cardRef} className="section-card seat-result">
        <div className="seat-result-title">{result.name}，歡迎您！</div>
        <p>桌次還在安排中，請找現場招待帶位</p>
        {messageBlock}
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
      {messageBlock}
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
