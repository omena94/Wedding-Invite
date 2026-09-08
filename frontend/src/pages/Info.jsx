import { Bus, Clock, Phone, Shirt, Sparkles, CalendarPlus } from 'lucide-react';
import EventDetails, { VENUE } from '../components/EventDetails.jsx';
import { GuestHeader, GuestNav, LoadError, useGuestLoad, addCalendar } from '../components/GuestUI.jsx';
import { fetchInfo } from '../api.js';

function ContactText({text}) {
  return text.split(/(09\d{2}[ -]?\d{3}[ -]?\d{3}|0[2-8][ -]?\d{4}[ -]?\d{4})/g).map((s,i)=>/^0\d/.test(s)?<a key={i} href={`tel:${s.replace(/[ -]/g,'')}`}>{s}</a>:s);
}
export default function Info() {
  const {data:info,error,retry}=useGuestLoad(fetchInfo);
  return <div className="container">
    <GuestHeader title="相聚的日子" subtitle="2027 年 3 月 13 日・星期六" english="THE WEDDING DAY"/>
    <section className="section-card"><EventDetails/><button type="button" className="btn calendar-action" onClick={addCalendar}><CalendarPlus size={18}/>加入行事曆</button></section>
    {error?<LoadError error={error} retry={retry}/>:!info?<div className="loading">讀取婚禮資訊…</div>:<>
      <section className="section-card"><h2 className="section-header-title"><Clock size={19}/>當天流程</h2><ol className="wedding-timeline">{(info.info_schedule?.trim()?info.info_schedule.split('\n'):['12:00 婚宴開始']).filter(s=>s.trim()).map((s,i)=><li key={i}>{s}</li>)}</ol>{!info.info_schedule?.trim()&&<p className="helper-text">入席與其他活動時間，會在婚禮前更新。</p>}</section>
      <section className="section-card"><h2 className="section-header-title"><Bus size={19}/>前往婚禮</h2><p>抵達美福後，請依現場指示前往宴會廳；廳別確定後會在這裡更新。</p>{info.info_transport&&<p className="info-text">{info.info_transport}</p>}<div className="receipt-actions"><a className="btn" href={VENUE.mapUrl} target="_blank" rel="noopener noreferrer">開啟 Google Maps</a><a className="btn" href={VENUE.parkingUrl} target="_blank" rel="noopener noreferrer">停車場位置</a></div></section>
      {info.info_dress_code?.trim()&&<section className="section-card"><h2 className="section-header-title"><Shirt size={19}/>服裝建議</h2><p className="info-text">{info.info_dress_code}</p></section>}
      {info.info_notes?.trim()&&<section className="section-card"><h2 className="section-header-title"><Sparkles size={19}/>給你的提醒</h2><p className="info-text">{info.info_notes}</p></section>}
      <section className="section-card"><h2 className="section-header-title"><Phone size={19}/>需要幫忙嗎</h2><p className="info-text">{info.info_contact?.trim()?<ContactText text={info.info_contact}/>: '婚禮前可直接聯繫宣文或孟庭；當天抵達宴會廳後，招待會協助您入座。'}</p></section>
    </>}
    <GuestNav/>
  </div>;
}
