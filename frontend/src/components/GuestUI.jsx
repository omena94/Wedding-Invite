import { useCallback, useEffect, useRef, useState } from 'react';
import { Heart, Home, MapPin, Armchair, CalendarPlus, Check, Download } from 'lucide-react';
import { VENUE } from './EventDetails.jsx';

export function GuestHeader({title, subtitle, english='OUR WEDDING · 2027.03.13'}) {
  return <header className="guest-header"><a href="/" className="guest-brand">Alan <span>&</span> Omena</a><p className="guest-eyebrow">{english}</p><h1>{title}</h1>{subtitle&&<p>{subtitle}</p>}</header>;
}
export function GuestNav() {
  return <nav className="guest-nav" aria-label="婚禮導覽">{[['/','首頁',Home],['/rsvp','出席回覆',Heart],['/info','婚禮資訊',MapPin],['/seat','我的座位',Armchair]].map(([href,label,Icon])=><a key={href} href={href} aria-current={location.pathname===href?'page':undefined}><Icon size={19}/><span>{label}</span></a>)}</nav>;
}
export function LoadError({error,retry}) { return <div className="guest-error" role="alert"><p>{error?.message||error||'資料暫時無法讀取'}</p><button type="button" className="btn" onClick={retry}>重新讀取</button></div>; }
export function useGuestLoad(loader) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const retry=useCallback(()=>setAttempt(v=>v+1),[]);
  useEffect(()=>{let active=true;setError('');setData(null);loader().then(v=>{if(active)setData(v);}).catch(e=>{if(active)setError(e.message||'連線失敗，請稍後再試');});return()=>{active=false;};},[loader,attempt]);
  return {data,error,retry};
}
const TTL=24*60*60*1000;
export function useDraft(key,initial) {
  const [restored,setRestored]=useState(false);
  const [value,setValue]=useState(initial);
  const [loadedKey,setLoadedKey]=useState(null);
  const shape=useRef(initial);shape.current=initial;
  useEffect(()=>{
    setRestored(false);
    if(!key){setLoadedKey(null);return;}
    try{
      const saved=JSON.parse(sessionStorage.getItem(key)||'null');
      const compatible=saved?.value&&Object.entries(shape.current).every(([field,v])=>saved.value[field]!==null&&typeof saved.value[field]===typeof v&&Array.isArray(saved.value[field])===Array.isArray(v));
      if(compatible&&saved.time<=Date.now()&&Date.now()-saved.time<TTL){setValue(saved.value);setRestored(true);}else sessionStorage.removeItem(key);
    }catch{}
    setLoadedKey(key);
  },[key]);
  useEffect(()=>{if(key&&loadedKey===key){try{sessionStorage.setItem(key,JSON.stringify({time:Date.now(),value}));}catch{}}},[key,value,loadedKey]);
  const clear=()=>{try{sessionStorage.removeItem(key);}catch{}setRestored(false);setLoadedKey(null);};
  return [value,setValue,{restored,clear}];
}
// 婚宴時間（台灣 12:00–16:00，用 UTC 寫給行事曆）；Google 日曆與 .ics 共用
const CAL_START='20270313T040000Z', CAL_END='20270313T080000Z', CAL_TITLE='宣文與孟庭的婚禮';
const calLocation=()=>`${VENUE.name} ${VENUE.address}`;
const calDetails=()=>`婚禮資訊、交通與座位查詢：${location.origin}/info`;
/** Google 日曆的「建立活動」連結：手機會直接開 Google 日曆 App，電腦開網頁，按儲存就加進去 */
export function googleCalendarUrl() {
  return 'https://calendar.google.com/calendar/render?'+new URLSearchParams({action:'TEMPLATE',text:CAL_TITLE,dates:`${CAL_START}/${CAL_END}`,details:calDetails(),location:calLocation(),ctz:'Asia/Taipei'}).toString();
}
/** 下載 .ics：Apple 行事曆、Outlook 或其他行事曆用 */
export function addCalendar() {
  // .ics 規定反斜線、分號、逗號要跳脫，換行用 CRLF；用字元碼寫是避免反斜線在各種工具裡被吃掉
  const BS=String.fromCharCode(92), CRLF=String.fromCharCode(13,10);
  const esc=(t)=>t.split(BS).join(BS+BS).split(';').join(BS+';').split(',').join(BS+',');
  const data=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Wedding//Alan Omena//ZH-TW','BEGIN:VEVENT','UID:alan-omena-20270313','DTSTAMP:20260905T000000Z',`DTSTART:${CAL_START}`,`DTEND:${CAL_END}`,`SUMMARY:${esc(CAL_TITLE)}`,`LOCATION:${esc(calLocation())}`,`DESCRIPTION:${esc(calDetails())}`,`URL:${location.origin}/info`,'END:VEVENT','END:VCALENDAR'].join(CRLF)+CRLF;
  const url=URL.createObjectURL(new Blob([data],{type:'text/calendar;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='Alan-Omena-Wedding.ics';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
/** 兩顆按鈕：Google 日曆（直接連動）與 .ics（Apple／其他）。inline=true 時不包外框，塞進既有按鈕列 */
export function CalendarButtons({inline=false, primary=false}) {
  const buttons=<>
    <a className={`btn${primary?' btn-primary':''}`} href={googleCalendarUrl()} target="_blank" rel="noopener noreferrer"><CalendarPlus size={17}/>加入 Google 日曆</a>
    <button type="button" className="btn" onClick={addCalendar}><Download size={17}/>Apple／其他行事曆</button>
  </>;
  return inline?buttons:<div className="calendar-actions">{buttons}</div>;
}
export function GuestReceipt({receipt}) {
  const card=useRef(null);
  useEffect(()=>{card.current?.focus({preventScroll:true});card.current?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});},[]);
  const [copied,setCopied]=useState(false),[copyError,setCopyError]=useState(false);
  const link=`${location.origin}/details#access=${encodeURIComponent(receipt.access_token)}`;
  return <section ref={card} tabIndex={-1} className="section-card guest-receipt" role="status"><div className="receipt-seal"><Check size={28}/></div><p className="guest-eyebrow">WITH LOVE & THANKS</p><h2>{receipt.name}，謝謝你的回覆</h2><p>{receipt.attending?`已記下 ${receipt.adult_count} 位大人、${receipt.child_count} 位小孩，期待與你相聚。`:'你的祝福，我們都好好收下了。'}</p>
    {receipt.details_completed&&<p>{Object.entries(receipt.main_course||{}).filter(([,n])=>n>0).map(([dish,n])=>`${dish} ${n} 份`).join('・')}</p>}
    {receipt.attending&&<><p>{receipt.details_completed?'餐點與需求已更新。':'餐點確認開放時，我們會再通知你。'}</p><div className="receipt-actions"><CalendarButtons inline/><a className="btn" href={VENUE.mapUrl} target="_blank" rel="noopener noreferrer"><MapPin size={17}/>前往場地</a></div><button type="button" className="btn-submit" onClick={async()=>{try{await navigator.clipboard.writeText(link);setCopied(true);setCopyError(false);}catch{setCopyError(true);}}}>{copied?'已複製，請自行保存':'複製我的回覆連結'}</button>{copyError&&<label>長按複製回覆連結<input readOnly value={link} onFocus={e=>e.target.select()}/></label>}<p className="helper-text">連結可用來修改餐點回覆，請妥善保存，勿轉傳；90 天內有效。</p></>}
    <a href="/info" className="top-link">查看婚禮當天資訊 →</a></section>;
}
