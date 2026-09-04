// 婚禮當天資訊：固定的日期地點 + 後台可編輯的流程、交通、服裝、提醒、聯絡窗口
import { useEffect, useState } from "react";
import { ArrowLeft, Bus, ListOrdered, Phone, Shirt, Sparkles } from "lucide-react";
import EventDetails from "../components/EventDetails.jsx";
import { fetchInfo } from "../api.js";

const SECTIONS = [
  { key: "info_schedule", title: "當天流程", icon: ListOrdered },
  { key: "info_transport", title: "交通方式", icon: Bus },
  { key: "info_dress_code", title: "服裝建議", icon: Shirt },
  { key: "info_notes", title: "其他提醒", icon: Sparkles },
  { key: "info_contact", title: "當天聯絡窗口", icon: Phone },
];

export default function Info() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    fetchInfo().then(setInfo).catch(() => setInfo({}));
  }, []);
  const filled = SECTIONS.filter((s) => info && (info[s.key] || "").trim());

  return (
    <div className="container">
      <header className="hero-arch-card">
        <p className="script-title">Save the Date</p>
        <p className="english-sub">Alan &amp; Omena</p>
        <div className="illustration-art-wrapper hero-swap">
          <img src="/hero-line.png" alt="Alan & Omena" className="hero-image" />
          <img src="/hero.png" alt="Alan & Omena" className="hero-image hero-swap-back" />
        </div>
        <h1 className="main-title">婚禮當天資訊</h1>
        <p className="invitation-quote">期待在這一天與你相見</p>
        <EventDetails />
      </header>

      {info === null ? (
        <div className="loading">讀取中…</div>
      ) : filled.length === 0 ? (
        <section className="section-card" style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
          更多細節（流程、交通、服裝建議）會在婚禮前更新，敬請期待
        </section>
      ) : (
        filled.map(({ key, title, icon: Icon }) => (
          <section className="section-card" key={key}>
            <div className="section-header">
              <div className="section-header-title"><Icon size={18} /> {title}</div>
            </div>
            <div className="info-text">{info[key]}</div>
          </section>
        ))
      )}

      <p className="footnote"><a href="/" className="top-link"><ArrowLeft size={14} /> 回首頁</a></p>
    </div>
  );
}
