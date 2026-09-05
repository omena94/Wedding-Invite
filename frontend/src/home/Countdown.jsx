import { useEffect, useState } from 'react';
import { weddingClock } from './journey.js';

export function useWeddingClock() {
  const [clock, setClock] = useState(weddingClock);
  useEffect(() => {
    let timer;
    const update = () => setClock(weddingClock());
    const resume = () => {
      clearInterval(timer);
      if (!document.hidden) { update(); timer = setInterval(update, 1000); }
    };
    resume(); document.addEventListener('visibilitychange', resume);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', resume); };
  }, []);
  return clock;
}

export default function Countdown({ clock }) {
  if (clock.period !== 'before') return <div className="wedding-clock-message"><span className="guest-eyebrow">{clock.period === 'today' ? 'TODAY IS THE DAY' : 'FOREVER IN OUR HEARTS'}</span><p>{clock.period === 'today' ? '就是今天，期待與你相見。' : '婚禮已圓滿結束，謝謝你的祝福。'}</p></div>;
  return <div className="wedding-clock" role="group" aria-label={`距離婚宴還有 ${clock.days} 天 ${clock.hours} 小時 ${clock.minutes} 分鐘`}>
    <p className="guest-eyebrow">每一秒，都更靠近與你相聚</p>
    <div className="wedding-clock-digits" aria-hidden="true">{[['days', '天'], ['hours', '時'], ['minutes', '分'], ['seconds', '秒']].map(([key, label]) => <div className="clock-unit" key={key}><div className="clock-window"><span key={clock[key]}>{String(clock[key]).padStart(2, '0')}</span></div><small>{label}</small></div>)}</div>
  </div>;
}
