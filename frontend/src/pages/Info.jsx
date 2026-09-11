// 2026-09-08 依新人要求移除「當天流程」「服裝建議」「需要幫忙嗎」區塊
import { Bus, Sparkles } from 'lucide-react';
import EventDetails, { VENUE } from '../components/EventDetails.jsx';
import { GuestHeader, GuestNav, LoadError, useGuestLoad, CalendarButtons } from '../components/GuestUI.jsx';
import { fetchInfo } from '../api.js';

export default function Info() {
  const {data:info,error,retry}=useGuestLoad(fetchInfo);
  return <div className="container">
    <GuestHeader title="相聚的日子" subtitle="2027 年 3 月 13 日・星期六" english="THE WEDDING DAY"/>
    <section className="section-card"><EventDetails/><CalendarButtons/></section>
    {error?<LoadError error={error} retry={retry}/>:!info?<div className="loading">讀取婚禮資訊…</div>:<>
      <section className="section-card"><h2 className="section-header-title"><Bus size={19}/>前往婚禮</h2><p>抵達美福後，請搭電梯到 2 樓「大宴會廳」，門口有迎賓背板與接待桌。</p>{info.info_transport&&<p className="info-text">{info.info_transport}</p>}<div className="receipt-actions"><a className="btn" href={VENUE.mapUrl} target="_blank" rel="noopener noreferrer">開啟 Google Maps</a><a className="btn" href={VENUE.parkingUrl} target="_blank" rel="noopener noreferrer">停車場位置</a></div></section>
      {info.info_notes?.trim()&&<section className="section-card"><h2 className="section-header-title"><Sparkles size={19}/>給你的提醒</h2><p className="info-text">{info.info_notes}</p></section>}
    </>}
    <GuestNav/>
  </div>;
}
