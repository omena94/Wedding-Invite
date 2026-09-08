import { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { fetchPhotos, photoThumbUrl, photoUrl } from '../api.js';
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

// 2026-09-07 依新人要求移除「我們的故事」標題與時間軸；這裡只剩相簿開放（或登入預覽）時的婚紗照預覽
export default function PhotoStory({ stage }) {
  if (!stage?.photos_open && !stage?.preview) return null;
  return <section className="our-story" id="our-story" aria-label="我們的婚紗照">
    <AlbumPreview key={!!stage.photos_open} auth={!stage.photos_open && stage.preview}/>
  </section>;
}
