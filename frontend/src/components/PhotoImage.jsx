import { useEffect, useState } from 'react';
import { fetchAuthBlobUrl } from '../api.js';

// 關閉公開相簿時，登入預覽的圖片仍須帶驗證，不能改用公開靜態路徑。
export default function PhotoImage({ src, auth, retryable = false, ...rest }) {
  const [url, setUrl] = useState(auth ? null : src);
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setFailed(false);
    if (!auth) { setUrl(src + (attempt ? `${src.includes('?') ? '&' : '?'}retry=${attempt}` : '')); return undefined; }
    setUrl(null);
    let alive = true, objectUrl = null;
    fetchAuthBlobUrl(src).then(value => {
      if (alive) { objectUrl = value; setUrl(value); }
      else URL.revokeObjectURL(value);
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [src, auth, attempt]);
  if (failed) return <span className="photo-load-error" role="status">照片暫時無法載入{retryable && <button type="button" className="btn" onClick={event => { event.stopPropagation(); setAttempt(value => value + 1); }}>重新載入照片</button>}</span>;
  return url ? <img src={url} {...rest} decoding="async" onError={() => setFailed(true)}/> : <span className="photo-img-loading" role="status" aria-label="照片載入中"/>;
}
