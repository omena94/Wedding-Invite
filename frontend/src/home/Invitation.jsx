import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight } from 'lucide-react';
import { useReducedMotion } from './motion.jsx';

// 2026-09-08 改用新人自製的喜帖（docs/ 內的 PDF 轉成 /invitation-1.webp、/invitation-2.webp）：
// 第一頁是 SAVE THE DATE 封面，第二頁是中文喜帖內頁；翻到內頁後才展開紙頁進入首頁。
const PAGES = [
  { src: '/invitation-1.webp', alt: 'SAVE THE DATE：Alan 與 Omena 的婚禮，2027 年 3 月 13 日' },
  { src: '/invitation-2.webp', alt: '誠摯邀請您參加我們的婚宴。新郎丁宣文、新娘余孟庭，男方家長○○○、○○○，女方家長○○○敬邀。2027 年 3 月 13 日星期六 12:00 婚宴入席，台北美福大飯店，台北市中山區樂群二路 55 號' },
];

export default function Invitation({ onOpen, onReveal }) {
  const [opening, setOpening] = useState(false);
  const [page, setPage] = useState(0);
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
  // 內頁圖先預載，翻頁時不會閃白
  useEffect(() => { const img = new Image(); img.src = PAGES[1].src; }, []);
  useEffect(() => { if (reduced && opening) finishRef.current(); }, [reduced, opening]);
  const open = () => {
    if (opening) return;
    if (reduced) { finish(); return; }
    // 紙頁開始移動前先準備首頁，避免喜帖消失後才重新播放首頁進場。
    onReveal?.();
    setOpening(true);
    timer.current = setTimeout(() => finishRef.current(), 1400);
  };
  const current = PAGES[page];
  const last = page === PAGES.length - 1;
  return createPortal(
    <div ref={dialog} tabIndex={-1} className={`invitation-intro${opening ? ' is-opening' : ''}`} role="dialog" aria-modal="true" aria-label="宣文與孟庭的婚禮喜帖">
      <div className="invitation-paper invitation-paper-left" aria-hidden="true"/>
      <div className="invitation-paper invitation-paper-right" onAnimationEnd={event => { if (event.animationName === 'invitationPaperRight') finish(); }}><button type="button" className="invitation-skip" onClick={finish}>略過開場 <ArrowRight size={15}/></button></div>
      <div className="invitation-content">
        <div className={`invitation-card${page ? ' is-inner' : ''}`} key={page}>
          <img src={current.src} width="1400" height="1972" alt={current.alt} decoding="async" fetchPriority={page ? undefined : 'high'} draggable="false"/>
        </div>
        {last
          ? <button type="button" className="invitation-open" onClick={open} aria-label="打開婚禮喜帖" aria-disabled={opening}><span>進入婚禮網站</span><ArrowRight size={18}/></button>
          : <button type="button" className="invitation-open" onClick={() => setPage(page + 1)} aria-label="翻到喜帖內頁"><span>翻開喜帖</span><ArrowRight size={18}/></button>}
        <p className="invitation-footnote">{last ? '回覆出席、查看婚禮資訊，都在裡面' : `${page + 1} / ${PAGES.length}`}</p>
      </div>
    </div>, document.body,
  );
}
