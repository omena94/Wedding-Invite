import { GuestNav, LoadError, useGuestLoad, addCalendar } from '../components/GuestUI.jsx';
// 首頁：邀請、倒數、婚禮資訊、各表單入口。內容依「目前階段」變化（後台設定）。
import { useEffect, useState } from "react";
import { ArrowRight, Armchair, CalendarCheck, Hourglass, Images, Info, Utensils } from "lucide-react";
import EventDetails from "../components/EventDetails.jsx";
import PreviewBanner from "../components/PreviewBanner.jsx";
import { fetchStage } from "../api.js";
import { WEDDING_DATE, daysUntil, fmtDateTime } from "../constants.js";

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

function Card({ href, icon, step, title, desc, primary, disabled }) {
  const inner = (
    <>
      <div className="nav-card-icon">{icon}</div>
      <div className="nav-card-body">
        {step && <div className="nav-card-step">{step}</div>}
        <div className="nav-card-title">{title}</div>
        <div className="nav-card-desc">{desc}</div>
      </div>
      {!disabled && <ArrowRight size={18} className="nav-card-arrow" />}
    </>
  );
  const cls = `nav-card${primary ? " nav-card-primary" : ""}${disabled ? " nav-card-disabled" : ""}`;
  if (disabled) return <div className={cls} aria-disabled="true">{inner}</div>;
  return <a className={cls} href={href}>{inner}</a>;
}

export default function Home() {
  const {data:stage,error,retry}=useGuestLoad(fetchStage);
  const s = stage || {};
  const preview = !!s.preview; // 已登入後台：尚未開放的入口也讓他進去看
  const phase2Open = !!s.phase2_open || preview;

  const phase1 = (
    <Card key="p1" href="/rsvp" icon={<CalendarCheck size={22} />} step="第一階段" title="填寫出席意願"
      desc="告訴我們你會不會來、大人小孩幾位" primary={!phase2Open} />
  );
  const phase2 = phase2Open ? (
    <Card key="p2" href="/details" icon={<Utensils size={22} />} step="第二階段" title="確認出席與主餐"
      desc={s.phase2_open ? "輸入第一階段留的 Email 或電話，確認最終人數並挑選主餐" : "尚未開放給賓客（你已登入後台，可先進去看）"} primary />
  ) : (
    <Card key="p2" icon={<Utensils size={22} />} step="第二階段" title="確認出席與主餐" disabled
      desc={s.phase2_open_at ? `預計 ${fmtDateTime(s.phase2_open_at)} 開放，收到通知後再回來填` : "尚未開放，收到我們的通知後再回來填"} />
  );

  return (
    <div className="container guest-home">
      <PreviewBanner stage={s} closedLabels={[!s.phase2_open && "第二階段", !s.seat_open && "桌次查詢", !s.photos_open && "婚紗照"].filter(Boolean)} />
      <header className="hero-arch-card">
        <p className="script-title">We're Getting Married</p>
        <p className="english-sub">Alan &amp; Omena</p>

        <div className="illustration-art-wrapper hero-swap">
          <img src="/hero-line.webp" width="800" height="800" fetchPriority="high" alt="Alan & Omena" className="hero-image" />
          <img src="/hero.webp" width="800" height="800" loading="lazy" alt="Alan & Omena" className="hero-image hero-swap-back" />
        </div>

        <p className="announce-lead">最愛的家人與好友們~~</p>
        <h1 className="announce-title">宣文與孟庭<br/><span className="wedding-date">2027 · 03 · 13</span></h1><p className="invitation-quote">把最重要的一天，與最珍惜的人一起度過。</p>
        <Countdown />
        <a className="btn-submit hero-response" href={phase2Open?'/details':'/rsvp'}>{phase2Open?'確認我的出席與餐點':'回覆我的出席意願'}<ArrowRight size={18}/></a>
        <EventDetails /><button type="button" className="btn calendar-action" onClick={addCalendar}>加入我的行事曆</button>
      </header>

      {error&&<LoadError error={error} retry={retry}/>}
      <nav className="nav-cards" aria-label="頁面入口">
        {phase2Open ? [phase2, phase1] : [phase1, phase2]}
        <Card href="/info" icon={<Info size={22} />} title="婚禮當天資訊" desc="流程、交通、停車、服裝建議" />
        {(s.seat_open || preview) && <Card href="/seat" icon={<Armchair size={22} />} title="查詢桌次" desc={s.seat_open ? "婚禮當天輸入姓名或電話，看你坐第幾桌" : "尚未開放給賓客（你已登入後台，可先進去看）"} />}
        {(s.photos_open || preview) && <Card href="/photos" icon={<Images size={22} />} title="婚紗照" desc={s.photos_open ? "我們的婚紗照，歡迎欣賞" : "尚未開放給賓客（你已登入後台，可先進去看）"} />}
      </nav>

      <GuestNav/>
      <p className="footnote">有任何問題，歡迎直接聯繫宣文或孟庭</p>
    </div>
  );
}
