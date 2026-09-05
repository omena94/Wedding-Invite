import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, Armchair, CalendarCheck, CalendarPlus, Heart, Images, Info, MailOpen, Utensils } from 'lucide-react';
import { GuestNav, LoadError, useGuestLoad, addCalendar } from '../components/GuestUI.jsx';
import EventDetails, { VENUE } from '../components/EventDetails.jsx';
import PreviewBanner from '../components/PreviewBanner.jsx';
import { fetchStage } from '../api.js';
import { WEDDING_DATE_DISPLAY, fmtDateTime } from '../constants.js';
import Invitation from '../home/Invitation.jsx';
import Countdown, { useWeddingClock } from '../home/Countdown.jsx';
import PhotoStory from '../home/PhotoStory.jsx';
import { Reveal } from '../home/motion.jsx';
import { homeAction, readVisit, rememberVisit } from '../home/journey.js';
import '../home/home.css';

function previousVisit() {
  try { return readVisit(window.localStorage); } catch { return null; }
}
function saveVisit(chapter) {
  try { rememberVisit(window.localStorage, chapter); } catch { /* 停用儲存時也能開啟喜帖。 */ }
}

function Card({ href, icon, step, title, desc, disabled }) {
  const content = <><div className="nav-card-icon">{icon}</div><div className="nav-card-body">{step && <div className="nav-card-step">{step}</div>}<div className="nav-card-title">{title}</div><div className="nav-card-desc">{desc}</div></div>{!disabled && <ArrowRight size={18} className="nav-card-arrow"/>}</>;
  return disabled ? <div className="nav-card nav-card-disabled" aria-disabled="true">{content}</div> : <a className="nav-card" href={href}>{content}</a>;
}

export default function Home() {
  const { data: stage, error, retry } = useGuestLoad(fetchStage);
  const [visit] = useState(previousVisit);
  const [intro, setIntro] = useState(!visit);
  const [revealed, setRevealed] = useState(!!visit);
  const titleRef = useRef(null), replayRef = useRef(null), replaying = useRef(false), focusPending = useRef(false);
  const clock = useWeddingClock();
  const s = stage || {}, preview = !!s.preview;
  const action = stage ? homeAction(stage, clock.period) : { id: '', href: '/info', action: '查看婚禮當天資訊' };
  const updated = !!(visit?.chapter && action.id && visit.chapter !== action.id);
  useEffect(() => { if (!intro && stage) saveVisit(action.id); }, [intro, stage, action.id]);
  useEffect(() => {
    if (intro || !focusPending.current) return undefined;
    // 等喜帖卸載、解除 inert 後再交還焦點；動畫事件當下直接 focus 仍會被擋。
    const frame = requestAnimationFrame(() => {
      (replaying.current ? replayRef.current : titleRef.current)?.focus({ preventScroll: true });
      focusPending.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [intro]);
  const openInvitation = () => {
    saveVisit(action.id);
    setRevealed(true);
    focusPending.current = true;
    setIntro(false);
  };
  const countdown = <Reveal className="home-countdown"><Countdown clock={clock}/></Reveal>;
  const nextPanel = stage && <Reveal><section className="home-next" aria-labelledby="home-next-title"><div><p className="home-next-label"><span className="home-status-dot"/>{updated ? '有新消息，這次回來可以…' : action.label}</p><h2 id="home-next-title">{action.title}</h2><p>{action.description}</p></div><a className="btn" href={action.href}>{action.action}<ArrowRight size={18}/></a></section></Reveal>;

  return <div className={`container guest-home wedding-home${revealed ? ' invitation-opened' : ''}`}>
    <PreviewBanner stage={s} closedLabels={[!s.phase2_open && '第二階段', !s.seat_open && '桌次查詢', !s.photos_open && '婚紗照'].filter(Boolean)}/>
    <div className="home-masthead"><span className="home-monogram">A <i>&</i> O</span><span className="home-edition">THE WEDDING OF ALAN & OMENA</span><button type="button" ref={replayRef} className="invitation-replay" onClick={() => { replaying.current = true; setIntro(true); }}><MailOpen size={16}/>重看喜帖</button></div>
    {error && <LoadError error={error} retry={retry}/>}
    {visit && <section className="home-return" aria-label="歡迎回來">{countdown}{nextPanel}</section>}

    <header className="wedding-hero">
      <div className="wedding-hero-copy">
        <p className="guest-eyebrow">{visit ? 'SO LOVELY TO SEE YOU AGAIN' : 'TO OUR DEAREST FAMILY & FRIENDS'}</p>
        <p className="home-greeting">{visit ? clock.period === 'after' ? '歡迎回來，謝謝你留下的祝福。' : clock.period === 'today' ? '歡迎回來，今天就要相見了。' : '歡迎回來，離相聚又近了一點。' : '最愛的家人與好友們，'}</p>
        <h1 ref={titleRef} tabIndex={-1}>把最重要的一天<br/><span>留給最珍惜的你</span></h1>
        <p className="home-couple">宣文 <i>&</i> 孟庭</p>
        <p className="home-couple-english">Alan & Omena</p>
        <p className="home-wedding-date">{WEDDING_DATE_DISPLAY}<span>{VENUE.name}</span></p>
        <a className="btn-submit home-primary" href={action.href}>{action.action}<ArrowRight size={18}/></a>
        <a className="home-story-link" href="#our-story">往下看我們的故事 <ArrowDown size={16}/></a>
      </div>
      <div className="wedding-hero-art">
        <div className="hero-arch-frame"><img src="/hero-line.webp" width="800" height="800" fetchPriority="high" alt="Alan 與 Omena 的婚禮插畫"/><img src="/hero.webp" width="800" height="800" decoding="async" alt="" className="hero-color-reveal" aria-hidden="true"/></div>
        <div className="hero-art-caption"><span>together, always</span><Heart size={17} aria-hidden="true"/></div>
        <span className="hero-art-note" aria-hidden="true">A NEW CHAPTER BEGINS</span>
      </div>
    </header>

    {!visit && <>{countdown}{nextPanel}</>}

    <PhotoStory stage={stage}/>
    <Reveal as="section" className="home-meet"><div className="home-meet-heading"><p className="guest-eyebrow">SAVE A LITTLE TIME FOR US</p><h2>這一天，我們在這裡等你</h2><p>把日期留起來，剩下的期待，交給那天。</p><button type="button" className="btn calendar-action" onClick={addCalendar}><CalendarPlus size={17}/>加入我的行事曆</button></div><EventDetails/></Reveal>

    <section className="home-essentials" aria-labelledby="home-essentials-title"><Reveal><p className="guest-eyebrow">EVERYTHING FOR YOUR VISIT</p><h2 id="home-essentials-title">赴約前，你需要的都在這裡</h2></Reveal><nav className="nav-cards" aria-label="頁面入口">
      <Reveal><Card href="/rsvp" icon={<CalendarCheck size={22}/>} step="第一階段" title="填寫出席意願" desc="告訴我們你會不會來，大人小孩幾位"/></Reveal>
      {stage && <Reveal delay={60}><Card href="/details" icon={<Utensils size={22}/>} step="第二階段" title="確認出席與主餐" disabled={!s.phase2_open && !preview} desc={s.phase2_open ? '確認同行人數、主餐與飲食需求' : preview ? '登入預覽：賓客尚未開放' : s.phase2_open_at ? `預計 ${fmtDateTime(s.phase2_open_at)} 開放` : '準備好後，我們會通知你回來確認'}/></Reveal>}
      <Reveal delay={90}><Card href="/info" icon={<Info size={22}/>} title="婚禮當天資訊" desc="流程、交通、停車與服裝建議"/></Reveal>
      {(s.seat_open || preview) && <Reveal delay={120}><Card href="/seat" icon={<Armchair size={22}/>} title="找到我的座位" desc={s.seat_open ? '從入口出發，一路找到為你留的那一席' : '登入預覽：賓客尚未開放'}/></Reveal>}
      {(s.photos_open || preview) && <Reveal delay={150}><Card href="/photos" icon={<Images size={22}/>} title="我們的婚紗照" desc={s.photos_open ? '把喜歡的時光，分享給你' : '登入預覽：賓客尚未開放'}/></Reveal>}
    </nav></section>
    <Reveal className="home-signoff"><Heart size={20} aria-hidden="true"/><p>有你在，就是最好的祝福。</p><span>With love, Alan & Omena</span></Reveal>
    <GuestNav/><p className="footnote">有任何問題，歡迎直接聯繫宣文或孟庭</p>
    {intro && <Invitation onOpen={openInvitation} onReveal={() => setRevealed(true)}/>}
  </div>;
}
