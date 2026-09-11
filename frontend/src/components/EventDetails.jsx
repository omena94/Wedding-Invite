// 婚禮日期 / 時間 / 地點 / 停車 的資訊卡（首頁、婚禮資訊頁共用）
import { Calendar, Clock, MapPin, SquareParking } from "lucide-react";

export const VENUE = {
  date: "2027.03.13（週六）",
  time: "12:00",
  name: "台北美福大飯店 2 樓大宴會廳", // 2026-09-11 看完場地後確定用 2 樓大宴會廳（首頁、RSVP、婚禮資訊頁共用）
  address: "台北市中山區樂群二路55號",
  mapUrl: "https://maps.app.goo.gl/oLUTYpC5Czfo5SZD6",
  parkingUrl: "https://maps.app.goo.gl/JdHCL5tFBmSuWxeJ9",
};

const linkStyle = { color: "var(--milk-tea-700)", fontWeight: 500, textDecoration: "underline", textUnderlineOffset: 3 };

export default function EventDetails() {
  return (
    <div className="event-details-card">
      <div className="detail-item">
        <div className="detail-icon"><Calendar size={16} /></div>
        <div className="detail-content"><strong>日期：</strong>{VENUE.date}</div>
      </div>
      <div className="detail-item">
        <div className="detail-icon"><Clock size={16} /></div>
        <div className="detail-content"><strong>時間：</strong>{VENUE.time}</div>
      </div>
      <div className="detail-item" style={{ alignItems: "flex-start" }}>
        <div className="detail-icon" style={{ marginTop: -4 }}><MapPin size={16} /></div>
        <div className="detail-content">
          <strong>地點：</strong>
          <span style={{ display: "inline-block", verticalAlign: "top" }}>
            <a href={VENUE.mapUrl} target="_blank" rel="noopener noreferrer" style={linkStyle}>{VENUE.name}</a>
            <span style={{ display: "block", marginLeft: "-0.5em" }}>（{VENUE.address}）</span>
          </span>
        </div>
      </div>
      <div className="detail-item">
        <div className="detail-icon"><SquareParking size={16} /></div>
        <div className="detail-content">
          <strong>停車：</strong>
          <a href={VENUE.parkingUrl} target="_blank" rel="noopener noreferrer" style={linkStyle}>停車場資訊</a>
        </div>
      </div>
    </div>
  );
}
