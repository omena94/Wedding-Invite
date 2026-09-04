import { Calendar, Clock, MapPin, SquareParking, CalendarCheck, Utensils, ArrowRight, Hourglass } from "lucide-react";

// 婚禮日期（倒數用）。改日期只要改這一行。
const WEDDING_DATE = "2027-03-13";

function daysUntil(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(y, m - 1, d);
  return Math.round((target - today) / 86400000);
}

function Countdown() {
  const days = daysUntil(WEDDING_DATE);
  let text;
  if (days > 0) text = <>距離婚禮還有 <strong>{days}</strong> 天</>;
  else if (days === 0) text = <>就是今天！期待與你相見</>;
  else text = <>婚禮已圓滿結束，謝謝大家的祝福</>;
  return (
    <div className="countdown">
      <Hourglass size={14} /> {text}
    </div>
  );
}

const linkStyle = { color: "var(--milk-tea-700)", fontWeight: 500, textDecoration: "underline", textUnderlineOffset: 3 };

export default function Home() {
  return (
    <div className="container">
      <header className="hero-arch-card">
        <p className="script-title">We're Married</p>
        <p className="english-sub">Alan &amp; Omena</p>

        <div className="illustration-art-wrapper hero-swap">
          <img src="/hero-line.png" alt="Alan & Omena" className="hero-image" />
          <img src="/hero.png" alt="Alan & Omena" className="hero-image hero-swap-back" />
        </div>

        <p className="announce-lead">最愛的家人與好友們~~</p>
        <p className="announce-title">宣文與孟庭 要結婚啦</p>
        <Countdown />

        <div className="event-details-card">
          <div className="detail-item">
            <div className="detail-icon"><Calendar size={16} /></div>
            <div className="detail-content"><strong>日期：</strong>2027.03.13（週六）</div>
          </div>
          <div className="detail-item">
            <div className="detail-icon"><Clock size={16} /></div>
            <div className="detail-content"><strong>時間：</strong>12:00</div>
          </div>
          <div className="detail-item" style={{ alignItems: "flex-start" }}>
            <div className="detail-icon" style={{ marginTop: -4 }}><MapPin size={16} /></div>
            <div className="detail-content">
              <strong>地點：</strong>
              <span style={{ display: "inline-block", verticalAlign: "top" }}>
                <a href="https://maps.app.goo.gl/oLUTYpC5Czfo5SZD6" target="_blank" rel="noopener noreferrer" style={linkStyle}>
                  台北美福大飯店
                </a>
                <span style={{ display: "block", marginLeft: "-0.5em" }}>（台北市中山區樂群二路55號）</span>
              </span>
            </div>
          </div>
          <div className="detail-item">
            <div className="detail-icon"><SquareParking size={16} /></div>
            <div className="detail-content">
              <strong>停車：</strong>
              <a href="https://maps.app.goo.gl/JdHCL5tFBmSuWxeJ9" target="_blank" rel="noopener noreferrer" style={linkStyle}>
                停車場資訊
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* 導覽：兩個階段的表單入口 */}
      <nav className="nav-cards" aria-label="表單入口">
        <a className="nav-card nav-card-primary" href="/rsvp">
          <div className="nav-card-icon"><CalendarCheck size={22} /></div>
          <div className="nav-card-body">
            <div className="nav-card-step">第一階段</div>
            <div className="nav-card-title">填寫出席意願</div>
            <div className="nav-card-desc">告訴我們你會不會來、大人小孩幾位</div>
          </div>
          <ArrowRight size={18} className="nav-card-arrow" />
        </a>

        <a className="nav-card" href="/details">
          <div className="nav-card-icon"><Utensils size={22} /></div>
          <div className="nav-card-body">
            <div className="nav-card-step">第二階段</div>
            <div className="nav-card-title">確認出席與主餐</div>
            <div className="nav-card-desc">收到我們的通知後再回來填，確認最終人數並挑選主餐</div>
          </div>
          <ArrowRight size={18} className="nav-card-arrow" />
        </a>
      </nav>

      <p className="footnote">有任何問題，歡迎直接聯繫宣文或孟庭</p>
    </div>
  );
}
