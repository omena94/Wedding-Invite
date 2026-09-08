import { useEffect, useRef, useState } from 'react';
// 2026-09-08 依新人要求拿掉「婚禮當天資訊」入口卡：內容與上方「這一天，我們在這裡等你」重複；婚禮資訊頁已從導覽移除
// 2026-09-08 依新人要求拿掉入口區「第一階段 填寫出席意願」卡：頁首主按鈕與底部導覽已有出席回覆
// 2026-09-08 依新人要求移除「赴約前，你需要的都在這裡」入口區；第二階段與座位改放底部導覽
import { ArrowRight, CalendarPlus, Heart, MailOpen } from 'lucide-react';
import { GuestNav, LoadError, useGuestLoad, CalendarButtons } from '../components/GuestUI.jsx';
import EventDetails, { VENUE } from '../components/EventDetails.jsx';
import PreviewBanner from '../components/PreviewBanner.jsx';
import { fetchStage } from '../api.js';
import { WEDDING_DATE_DISPLAY } from '../constants.js';
import Invitation from '../home/Invitation.jsx';
import Countdown, { useWeddingClock } from '../home/Countdown.jsx';
import { Reveal } from '../home/motion.jsx';
import { homeAction, readVisit, rememberVisit } from '../home/journey.js';
import '../home/home.css';

function previousVisit() {
  try { return readVisit(window.localStorage); } catch { return null; }
}
function saveVisit(chapter) {
  try { rememberVisit(window.localStorage, chapter); } catch { /* 停用儲存時也能開啟喜帖。 */ }
}

export default function Home() {
  const { data: stage, error, retry } = useGuestLoad(fetchStage);
  const [visit] = useState(previousVisit);
  const [intro, setIntro] = useState(!visit);
  const [revealed, setRevealed] = useState(!!visit);
  const titleRef = useRef(null), replayRef = useRef(null), replaying = useRef(false), focusPending = useRef(false);
  const clock = useWeddingClock();
  const s = stage || {}, preview = !!s.preview;
  const action = stage ? homeAction(stage, clock.period) : { id: '', href: '/rsvp', action: '回覆我的出席意願' };
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
  // 2026-09-08 依新人要求拿掉「下一步」深色卡片：頁首已有同樣的主按鈕，只留倒數

  return <div className={`container guest-home wedding-home${revealed ? ' invitation-opened' : ''}`}>
    <PreviewBanner stage={s} closedLabels={[!s.phase2_open && '第二階段', !s.seat_open && '桌次查詢'].filter(Boolean)}/>
    <div className="home-masthead"><span className="home-edition">THE WEDDING OF ALAN & OMENA</span><button type="button" ref={replayRef} className="invitation-replay" onClick={() => { replaying.current = true; setIntro(true); }}><MailOpen size={16}/>重看喜帖</button></div>
    {error && <LoadError error={error} retry={retry}/>}
    {visit && <section className="home-return" aria-label="歡迎回來">{countdown}</section>}

    <header className="wedding-hero">
      <div className="wedding-hero-copy">
        <p className="guest-eyebrow">{visit ? 'SO LOVELY TO SEE YOU AGAIN' : 'TO OUR DEAREST FAMILY & FRIENDS'}</p>
        <p className="home-greeting">{visit ? clock.period === 'after' ? '歡迎回來，謝謝你留下的祝福。' : clock.period === 'today' ? '歡迎回來，今天就要相見了。' : '歡迎回來，離相聚又近了一點。' : '最愛的家人與好友們，'}</p>
        <h1 ref={titleRef} tabIndex={-1}>把最重要的一天<br/><span>留給最珍惜的你</span></h1>
        <p className="home-couple">宣文 <span className="amp">&</span> 孟庭</p>
        <p className="home-couple-english">Alan <span className="amp">&</span> Omena</p>
        <p className="home-wedding-date">{WEDDING_DATE_DISPLAY}<span>{VENUE.name}</span></p>
        <a className="btn-submit home-primary" href={action.href}>{action.action}<ArrowRight size={18}/></a>
      </div>
      <div className="wedding-hero-art">
        <div className="hero-arch-frame"><img src="/hero.webp" width="800" height="800" fetchPriority="high" alt="Alan 與 Omena 的婚禮插畫" className="hero-color-reveal"/></div>
        <div className="hero-art-caption"><span>together, always</span><Heart size={17} aria-hidden="true"/></div>
        <span className="hero-art-note" aria-hidden="true">A NEW CHAPTER BEGINS</span>
      </div>
    </header>

    {!visit && countdown}

    <Reveal as="section" className="home-meet"><div className="home-meet-heading"><p className="guest-eyebrow">SAVE A LITTLE TIME FOR US</p><h2>這一天，我們在這裡等你</h2><p>把日期留起來，剩下的期待，交給那天。</p><CalendarButtons/></div><EventDetails/></Reveal>

    <Reveal className="home-signoff"><Heart size={20} aria-hidden="true"/><p>有你在，就是最好的祝福。</p><span>With love, Alan <span className="amp">&</span> Omena</span></Reveal>
    <GuestNav/><p className="footnote">有任何問題，歡迎直接聯繫宣文或孟庭</p>
    {intro && <Invitation onOpen={openInvitation} onReveal={() => setRevealed(true)}/>}
  </div>;
}
