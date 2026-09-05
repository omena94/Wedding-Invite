import { useEffect, useRef, useState } from 'react';

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}

export function Reveal({ children, className = '', delay = 0, as: Tag = 'div' }) {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (reduced || !('IntersectionObserver' in window)) { setVisible(true); return undefined; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { threshold: .12 });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [reduced]);
  return <Tag ref={ref} className={`wedding-reveal ${className}`} data-visible={visible || reduced} style={{ '--reveal-delay': `${delay}ms` }}>{children}</Tag>;
}

export function MovingPhoto({ children, className = '' }) {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (reduced || navigator.connection?.saveData || !('IntersectionObserver' in window)) {
      el.style.setProperty('--photo-shift', '0px');
      return undefined;
    }
    let frame = 0, active = false;
    const paint = () => {
      frame = 0;
      if (!active || document.hidden) return;
      const rect = el.getBoundingClientRect();
      const progress = Math.max(0, Math.min(1, (innerHeight - rect.top) / (innerHeight + rect.height)));
      el.style.setProperty('--photo-shift', `${(progress - .5) * 40}px`);
    };
    const schedule = () => { if (!frame && active) frame = requestAnimationFrame(paint); };
    const observer = new IntersectionObserver(entries => {
      active = entries[0].isIntersecting;
      if (active) schedule();
    });
    observer.observe(el);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    document.addEventListener('visibilitychange', schedule);
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [reduced]);
  return <div ref={ref} className={`moving-photo ${className}`}>{children}</div>;
}
