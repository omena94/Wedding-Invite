import { useCallback, useEffect, useRef, useState } from 'react';
import { Home, MapPin, Armchair, CalendarPlus, Utensils, Images, Camera } from 'lucide-react';
import { VENUE } from './EventDetails.jsx';

// 賓客頁共用的小花飾：兩條細線夾一顆菱形，取自喜帖封面的細框（2026-10-01 賓客頁精修）
export function Ornament({className=''}) {
  return <svg className={`guest-ornament${className?` ${className}`:''}`} viewBox="0 0 160 12" aria-hidden="true" focusable="false"><path className="go-line" d="M0 6h62M98 6h62"/><path className="go-diamond" d="M80 1 85 6 80 11 75 6Z"/><circle cx="69" cy="6" r="1.3"/><circle cx="91" cy="6" r="1.3"/></svg>;
}
// brush：中文標題與副標改用辰宇落雁體（2026-09-11 新人指定餐點確認頁用；英文與按鈕不變）
// 2026-10-01：英文日期改當成「Alan & Omena」底下的落款，再用花飾隔開標題，像喜帖的抬頭
export function GuestHeader({title, subtitle, english='OUR WEDDING · 2027.03.13', brush=false}) {
  return <header className={`guest-header${brush?' guest-header-brush':''}`}><a href="/" className="guest-brand">Alan <span>&</span> Omena</a><p className="guest-eyebrow">{english}</p><Ornament/><h1>{title}</h1>{subtitle&&<p>{subtitle}</p>}</header>;
}
// 第一階段 /rsvp 沒有自己的按鈕，算在「出席確認」底下，換頁時亮著的那顆才接得上
export function GuestNav() {
  return <nav className="guest-nav" aria-label="婚禮導覽">{[['/','首頁',Home],['/details','出席確認',Utensils,['/rsvp']],['/seat','我的座位',Armchair],['/upload','當天照片',Camera],['/photos','婚紗照',Images]].map(([href,label,Icon,also=[]])=><a key={href} href={href} aria-current={[href,...also].includes(location.pathname)?'page':undefined}><Icon size={19}/><span>{label}</span></a>)}</nav>;
}
// 送出成功的封蠟章（2026-10-01）：外緣不規則的玫瑰色蠟、壓出來的一圈凹槽、中間浮起的 A&O；& 一律正體（新人要求）
// 字樣畫三層（下暗、上亮、中間本色）做出壓印的立體感；整顆只是裝飾，成功訊息由標題文字傳達
export function WaxSeal() {
  return <div className="receipt-seal" aria-hidden="true"><svg viewBox="0 0 120 120" focusable="false">
    <defs>
      <radialGradient id="wax-fill" cx="36%" cy="30%" r="78%"><stop offset="0" stopColor="#c99183"/><stop offset=".45" stopColor="#a6675b"/><stop offset="1" stopColor="#7a453c"/></radialGradient>
      <radialGradient id="wax-well" cx="50%" cy="40%" r="62%"><stop offset="0" stopColor="#a36458"/><stop offset="1" stopColor="#8b5046"/></radialGradient>
    </defs>
    <path d="M110.7 54.1Q113.4 60.0 110.8 66.0Q108.3 71.9 107.6 78.3Q106.9 84.6 101.9 88.6Q96.9 92.7 93.3 97.8Q89.7 103.0 83.9 105.4Q78.1 107.8 72.0 108.3Q65.9 108.8 59.7 111.5Q53.4 114.1 48.0 110.0Q42.6 105.9 36.7 104.1Q30.7 102.4 26.9 97.6Q23.1 92.7 19.7 87.8Q16.3 82.9 13.1 77.6Q10.0 72.3 7.9 66.2Q5.9 60.0 7.7 53.8Q9.4 47.5 12.5 42.1Q15.5 36.7 18.0 30.8Q20.5 25.0 24.6 19.9Q28.8 14.8 35.1 12.9Q41.4 10.9 47.6 10.0Q53.8 9.0 60.2 7.2Q66.6 5.4 72.5 8.6Q78.3 11.8 84.6 13.5Q90.8 15.3 94.4 20.9Q97.9 26.4 101.0 31.7Q104.0 36.9 106.1 42.5Q108.1 48.1 110.7 54.1Z" fill="url(#wax-fill)"/>
    <circle cx="60" cy="60" r="38" fill="url(#wax-well)"/>
    <circle cx="60" cy="58.8" r="38.4" fill="none" stroke="#5a2f28" strokeOpacity=".5" strokeWidth="1.6"/>
    <circle cx="60" cy="61.2" r="38.4" fill="none" stroke="#f4cfc4" strokeOpacity=".5" strokeWidth="1.1"/>
    <circle cx="60" cy="60" r="32.5" fill="none" stroke="#f4cfc4" strokeOpacity=".32" strokeWidth=".9" strokeDasharray="1.4 2.8"/>
    <g fontFamily="'Cormorant Garamond', Georgia, serif" fontSize="26" fontWeight="600" textAnchor="middle" letterSpacing="-.5">
      <text x="60" y="69.4" fill="#5a2f28" fillOpacity=".6">A&amp;O</text>
      <text x="60" y="67.4" fill="#f6d8ce" fillOpacity=".6">A&amp;O</text>
      <text x="60" y="68.4" fill="#a0625a">A&amp;O</text>
    </g>
  </svg></div>;
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
// 婚宴時間（台灣 12:00–15:00，用 UTC 寫給 Google 日曆；2026-09-09 由 16:00 改為 15:00）
const CAL_START='20270313T040000Z', CAL_END='20270313T070000Z', CAL_TITLE='宣文與孟庭的婚禮'; // 12:00～15:00 台北時間（2026-09-09 新人確認）
const calLocation=()=>`${VENUE.name} ${VENUE.address}`;
const calDetails=()=>`婚禮資訊、交通與座位查詢：${location.origin}/`;
/** Google 日曆的「建立活動」連結：手機會直接開 Google 日曆 App，電腦開網頁，按儲存就加進去 */
export function googleCalendarUrl() {
  return 'https://calendar.google.com/calendar/render?'+new URLSearchParams({action:'TEMPLATE',text:CAL_TITLE,dates:`${CAL_START}/${CAL_END}`,details:calDetails(),location:calLocation(),ctz:'Asia/Taipei'}).toString();
}
/** 只提供 Google 日曆（2026-09-08 依新人要求移除 .ics 下載）。inline=true 時不包外框，塞進既有按鈕列 */
export function CalendarButtons({inline=false, primary=false}) {
  const link=<a className={`btn${primary?' btn-primary':''}`} href={googleCalendarUrl()} target="_blank" rel="noopener noreferrer"><CalendarPlus size={17}/>加入 Google 日曆</a>;
  return inline?link:<div className="calendar-actions">{link}</div>;
}
export function GuestReceipt({receipt}) {
  const card=useRef(null);
  useEffect(()=>{card.current?.focus({preventScroll:true});card.current?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});},[]);
  const [copied,setCopied]=useState(false),[copyError,setCopyError]=useState(false);
  const link=`${location.origin}/details#access=${encodeURIComponent(receipt.access_token)}`;
  return <section ref={card} tabIndex={-1} className="section-card guest-receipt" role="status"><WaxSeal/><p className="guest-eyebrow">WITH LOVE & THANKS</p><h2>{receipt.name}，謝謝你的回覆</h2><p>{receipt.attending?`已記下 ${receipt.adult_count} 位大人、${receipt.child_count} 位小孩，期待與你相聚。`:'你的祝福，我們都好好收下了。'}</p>
    {receipt.details_completed&&receipt.veg_count>0&&<p>素食套餐 {receipt.veg_count} 位</p>}
    {receipt.attending&&<><p>{receipt.details_completed?'人數與需求已更新。':'出席確認開放時，我們會再通知你。'}</p><div className="receipt-actions"><CalendarButtons inline/><a className="btn" href={VENUE.mapUrl} target="_blank" rel="noopener noreferrer"><MapPin size={17}/>前往場地</a></div>{/* 回覆連結放在「回函存根」：虛線＋兩側半圓缺口，像實體回函卡撕下來自己留著的那一聯 */}<div className="receipt-stub"><button type="button" className="btn-submit" onClick={async()=>{try{await navigator.clipboard.writeText(link);setCopied(true);setCopyError(false);}catch{setCopyError(true);}}}>{copied?'已複製，請自行保存':'複製我的回覆連結'}</button>{copyError&&<label>長按複製回覆連結<input readOnly value={link} onFocus={e=>e.target.select()}/></label>}<p className="helper-text">連結可用來修改回覆，請妥善保存，勿轉傳；<span className="nowrap">90 天內有效。</span></p></div></>}
    <a href="/" className="top-link">回首頁看婚禮資訊 →</a></section>;
}
