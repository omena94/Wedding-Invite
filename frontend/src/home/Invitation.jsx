import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight } from 'lucide-react';
import { useReducedMotion } from './motion.jsx';
import { WEDDING_DATE_DISPLAY } from '../constants.js';
import { VENUE } from '../components/EventDetails.jsx';

export default function Invitation({ onOpen, onReveal }) {
  const [opening, setOpening] = useState(false);
  const reduced = useReducedMotion();
  const dialog = useRef(null), timer = useRef(null), onFinish = useRef(onOpen), completed = useRef(false);
  onFinish.current = onOpen;
  const finish = () => {
    if (completed.current) return;
    completed.current = true;
    clearTimeout(timer.current);
    onFinish.current();
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    const root = document.getElementById('root'), previous = document.activeElement;
    const oldInert = root?.inert, oldOverflow = document.body.style.overflow;
    if (root) root.inert = true;
    document.body.style.overflow = 'hidden';
    // 手機初始焦點放在喜帖本身，不替觸控按鈕畫出粗大的鍵盤焦點圈。
    dialog.current.focus({ preventScroll: true });
    const keydown = e => {
      if (e.key === 'Escape') { e.preventDefault(); finishRef.current(); }
      if (e.key !== 'Tab') return;
      const buttons = [...dialog.current.querySelectorAll('button:not(:disabled)')];
      if (e.shiftKey && (document.activeElement === buttons[0] || document.activeElement === dialog.current)) { e.preventDefault(); buttons.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === buttons.at(-1)) { e.preventDefault(); buttons[0].focus(); }
    };
    const el = dialog.current;
    el.addEventListener('keydown', keydown);
    return () => {
      clearTimeout(timer.current); el.removeEventListener('keydown', keydown);
      if (root) root.inert = oldInert;
      document.body.style.overflow = oldOverflow;
      previous?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => { if (reduced && opening) finishRef.current(); }, [reduced, opening]);
  const open = () => {
    if (opening) return;
    if (reduced) { finish(); return; }
    // 紙頁開始移動前先準備首頁，避免喜帖消失後才重新播放首頁進場。
    onReveal?.();
    setOpening(true);
    timer.current = setTimeout(() => finishRef.current(), 1400);
  };
  return createPortal(
    <div ref={dialog} tabIndex={-1} className={`invitation-intro${opening ? ' is-opening' : ''}`} role="dialog" aria-modal="true" aria-label="宣文與孟庭的婚禮喜帖">
      <div className="invitation-paper invitation-paper-left" aria-hidden="true"/>
      <div className="invitation-paper invitation-paper-right" onAnimationEnd={event => { if (event.animationName === 'invitationPaperRight') finish(); }}><button type="button" className="invitation-skip" onClick={finish}>略過開場 <ArrowRight size={15}/></button></div>
      <div className="invitation-content">
        <header className="invitation-heading"><p className="invitation-kicker">JOYFULLY INVITE YOU TO OUR WEDDING</p><h2>Alan <i>&</i> Omena</h2><p className="invitation-couple">宣文 <span>與</span> 孟庭</p></header>
        <div className="invitation-portrait"><img src="/hero.webp" width="800" height="800" alt="" decoding="async"/><span className="invitation-portrait-note">together, always</span></div>
        <div className="invitation-details"><p className="invitation-promise">往後的每一天，都有你</p><p className="invitation-date">{WEDDING_DATE_DISPLAY}</p><p className="invitation-venue">{VENUE.name}</p></div>
        <button type="button" className="invitation-open" onClick={open} aria-label="打開婚禮喜帖" aria-disabled={opening}><span>開啟我們的喜帖</span><ArrowRight size={18}/></button>
        <p className="invitation-footnote">一份邀請，留給最珍惜的你</p>
      </div>
    </div>, document.body,
  );
}
