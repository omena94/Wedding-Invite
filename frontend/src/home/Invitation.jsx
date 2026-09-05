import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Heart } from 'lucide-react';
import { useReducedMotion } from './motion.jsx';
import { WEDDING_DATE_DISPLAY } from '../constants.js';

export default function Invitation({ onOpen }) {
  const [opening, setOpening] = useState(false);
  const reduced = useReducedMotion();
  const dialog = useRef(null), timer = useRef(null), finish = useRef(onOpen);
  finish.current = onOpen;
  useEffect(() => {
    const root = document.getElementById('root'), previous = document.activeElement;
    const oldInert = root?.inert, oldOverflow = document.body.style.overflow;
    if (root) root.inert = true;
    document.body.style.overflow = 'hidden';
    dialog.current.querySelector('.invitation-seal').focus({ preventScroll: true });
    const keydown = e => {
      if (e.key === 'Escape') { e.preventDefault(); finish.current(); }
      if (e.key !== 'Tab') return;
      const buttons = [...dialog.current.querySelectorAll('button:not(:disabled)')];
      if (e.shiftKey && document.activeElement === buttons[0]) { e.preventDefault(); buttons.at(-1).focus(); }
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
  useEffect(() => { if (reduced && opening) finish.current(); }, [reduced, opening]);
  const open = () => {
    if (opening) return;
    if (reduced) { finish.current(); return; }
    setOpening(true);
    timer.current = setTimeout(() => finish.current(), 1300);
  };
  return createPortal(
    <div ref={dialog} className={`invitation-intro${opening ? ' is-opening' : ''}`} role="dialog" aria-modal="true" aria-labelledby="invitation-title">
      <button type="button" className="invitation-skip" onClick={onOpen}>略過開場 <ArrowRight size={16}/></button>
      <div className="invitation-heading"><p className="guest-eyebrow">A LITTLE LETTER, WITH ALL OUR LOVE</p><h2 id="invitation-title">一封，留給你的邀請</h2><p>邀請你，一起走進我們的重要時刻。</p></div>
      <div className="invitation-envelope">
        <div className="envelope-back"/>
        <div className="envelope-letter" aria-hidden="true"><Heart size={22}/><span>Alan <i>&</i> Omena</span><small>{WEDDING_DATE_DISPLAY}</small></div>
        <div className="envelope-fold"/>
        <div className="envelope-flap"/>
        <button type="button" className="invitation-seal" onClick={open} aria-label="打開婚禮喜帖" aria-disabled={opening}><span>A <i>&</i> O</span></button>
      </div>
      <p className="invitation-hint" role="status">{opening ? '我們的故事，從這裡展開' : '輕點封蠟，打開這份邀請'}</p>
      <p className="invitation-signature">WITH LOVE, ALAN & OMENA</p>
    </div>, document.body,
  );
}
