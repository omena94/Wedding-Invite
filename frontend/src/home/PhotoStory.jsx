import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Heart } from 'lucide-react';
import { fetchPhotos, photoThumbUrl, photoUrl } from '../api.js';
import { OUR_STORY, fmtDate } from '../constants.js';
import PhotoImage from '../components/PhotoImage.jsx';
import { MovingPhoto, Reveal } from './motion.jsx';

function AlbumPreview({ auth }) {
  const ref = useRef(null);
  const [near, setNear] = useState(false), [photos, setPhotos] = useState([]);
  useEffect(() => {
    if (!('IntersectionObserver' in window)) { setNear(true); return undefined; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setNear(true); observer.disconnect(); }
    }, { rootMargin: '240px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!near) return undefined;
    let alive = true;
    fetchPhotos().then(items => { if (alive) setPhotos(items.slice(0, 3)); }).catch(() => { /* 相簿頁提供重試，首頁仍保留完整故事。 */ });
    return () => { alive = false; };
  }, [near]);
  return <div ref={ref} className="story-album">
    {photos.length > 0 && <div className="story-photo-grid">{photos.map((photo, index) => <Reveal key={photo.id} delay={index * 90}><a href="/photos" aria-label={photo.caption || `欣賞我們的照片 ${index + 1}`}><MovingPhoto><PhotoImage src={photo.has_thumb ? photoThumbUrl(photo.id) : photoUrl(photo.id)} auth={auth} alt={photo.caption || '我們的婚紗照'} loading="lazy"/></MovingPhoto></a></Reveal>)}</div>}
    <a className="story-album-link" href="/photos">把喜歡的時光，留在這裡 <ArrowRight size={17}/></a>
  </div>;
}

export default function PhotoStory({ stage }) {
  return <section className="our-story" id="our-story" aria-labelledby="story-title">
    <Reveal className="story-heading"><p className="guest-eyebrow">THE DAYS THAT BECAME OUR STORY</p><h2 id="story-title">慢慢走，把日子走成我們</h2><p>從故事的開始，到即將到來的那一天。</p></Reveal>
    <div className="story-timeline">{OUR_STORY.map((chapter, index) => <Reveal className={`story-chapter story-chapter-${index + 1}`} as="article" key={chapter.date}>
      <div className="story-date"><span>{chapter.mark}</span><time dateTime={chapter.date}>{fmtDate(chapter.date)}</time><small>{chapter.label}</small></div>
      <div className="story-copy"><h3>{chapter.title}</h3><p>{chapter.text}</p>{index === 1 && <MovingPhoto className="story-portrait"><img src="/hero.webp" alt="Alan 與 Omena 的婚禮插畫" width="800" height="800" loading="lazy" decoding="async"/></MovingPhoto>}{index === 2 && <Heart className="story-heart" size={32} aria-hidden="true"/>}</div>
    </Reveal>)}</div>
    {(stage?.photos_open || stage?.preview) && <AlbumPreview key={!!stage.photos_open} auth={!stage.photos_open && stage.preview}/>}
  </section>;
}
