// 賓客查桌次的結果。現場沒有人帶位、也有長輩在用，所以：
//   1. 卡片只放最重要的：桌名與座號大字、一句白話的「怎麼走」、一顆大按鈕「打開地圖」
//   2. 查到後自動開啟全螢幕：先標記我的位置，再平滑放大至入口與座位之間的路線，
//      紅色虛線指路、點椅子看旁邊坐誰；關掉就回到這張卡
// 賓客頁 /seat 與後台「預覽賓客畫面」共用；後台的手機框用 embedded（地圖直接嵌在卡片裡，不全螢幕）。
import { useEffect, useMemo, useRef, useState } from "react";
import { Map as MapIcon, ChevronDown, Download } from "lucide-react";
import SeatViewer from "./SeatViewer.jsx";

// 2026-09-23 新人設計的婚禮謝卡（Canva 匯出的 PDF 轉成 SVG，放在 public/cards）。
// 2026-09-27 正面、背面上下直接排開（不用翻）；有留言的人可以把正面、背面分別存成圖片（手機走分享面板存到相簿）
const CARD_W = 297.75, CARD_H = 419.25; // SVG 原始尺寸（pt）
const OUT_W = 1080; // 存圖寬度
const TEXT_AREA = { left: 0.24, right: 0.08, top: 0.25, bottom: 0.15 }; // 背面留白區（跟 .tc-text 一樣）
const textSize = (n) => (n > 260 ? 12 : n > 170 ? 13.5 : n > 100 ? 15 : 17); // 以卡片寬 400px 為準的字級，跟 .tc-lg～xs 對應

const loadImage = (src) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });

// 把一段話依寬度逐字換行（中文沒有空白可斷，逐字量寬最穩），保留手動換行
function wrapLines(ctx, text, maxWidth) {
  const out = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const ch of para) {
      const next = line + ch;
      if (line && ctx.measureText(next).width > maxWidth) { out.push(line); line = ch; } else line = next;
    }
    out.push(line);
  }
  return out;
}

async function renderCard(side, message) {
  const img = await loadImage(`/cards/thankcard-${side}.svg`);
  const scale = OUT_W / CARD_W;
  const canvas = document.createElement("canvas");
  canvas.width = OUT_W; canvas.height = Math.round(CARD_H * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fdf9f1"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  if (side === "back" && message) {
    const px = textSize(message.length) * (OUT_W / 400);
    try { await document.fonts.load(`${px}px "Noto Serif TC"`); } catch { /* 字型載不到就用系統字 */ }
    ctx.font = `${px}px "Noto Serif TC", serif`; ctx.fillStyle = "#6e4c3b"; ctx.textBaseline = "top";
    const x0 = canvas.width * TEXT_AREA.left, x1 = canvas.width * (1 - TEXT_AREA.right);
    const y0 = canvas.height * TEXT_AREA.top, y1 = canvas.height * (1 - TEXT_AREA.bottom);
    const lh = px * 1.85;
    let y = y0;
    for (const line of wrapLines(ctx, message, x1 - x0)) { if (y + lh > y1) break; ctx.fillText(line, x0, y); y += lh; }
  }
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

// 存圖：手機能用分享面板就用（iPhone「儲存影像」、Android「儲存到相簿」），不然直接下載
async function saveCard(side, message) {
  const blob = await renderCard(side, message);
  const file = new File([blob], side === "front" ? "婚禮謝卡-正面.png" : "婚禮謝卡-背面.png", { type: "image/png" });
  // 只有觸控裝置（手機、平板）走分享面板；電腦直接下載檔案
  const touch = (navigator.maxTouchPoints || 0) > 0 || /Android|iPhone|iPad/i.test(navigator.userAgent);
  if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "婚禮謝卡" }); return; } catch (e) { if (e && e.name === "AbortError") return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function ThankCard({ message }) {
  const n = message.length;
  const size = n > 260 ? "xs" : n > 170 ? "sm" : n > 100 ? "md" : "lg";
  const [busy, setBusy] = useState("");
  const save = async (side) => {
    if (busy) return;
    setBusy(side);
    try { await saveCard(side, message); } catch { /* 存不了就算了，畫面上還看得到 */ } finally { setBusy(""); }
  };
  return (
    <div className="tc-wrap tc-stack">
      <div className="tc-heading">我有話要說<ChevronDown size={22} className="tc-arrow" aria-hidden="true" /></div>
      <div className="tc-face tc-static">
        <img src="/cards/thankcard-front.svg" alt="Thank you for sharing our special day. Alan & Omena" draggable="false" />
      </div>
      <div className="tc-face tc-static">
        <img src="/cards/thankcard-back.svg" alt="" draggable="false" />
        <div className={`tc-text tc-${size}`}>{message}</div>
      </div>
      <div className="tc-save">
        <button type="button" className="tc-save-btn" onClick={() => save("front")} disabled={!!busy}><Download size={16} /> {busy === "front" ? "準備中…" : "儲存正面"}</button>
        <button type="button" className="tc-save-btn" onClick={() => save("back")} disabled={!!busy}><Download size={16} /> {busy === "back" ? "準備中…" : "儲存背面（含留言）"}</button>
      </div>
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
