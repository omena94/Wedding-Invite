// 自動找歌詞：LRCLIB（https://lrclib.net，免費、開放的時間軸歌詞資料庫，瀏覽器可以直接呼叫）。
// 用歌名、歌手搜尋，依「有沒有時間軸、長度跟音檔差多少、名字像不像」排序，讓新人挑一個。
// 版本不同（Taylor's Version、Radio Mix）時間軸會對不上，所以長度差太多的排後面，選了之後還可以整首平移。

export interface LyricCandidate {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  syncedLyrics: string;
  plainLyrics: string;
  /** 跟音檔長度差幾秒（音檔長度不知道時是 NaN）。 */
  diff: number;
}

const norm = (s: string) => (s || '').toLowerCase().normalize('NFKC').replace(/\(.*?\)|\[.*?\]|（.*?）/g, '').replace(/[^\p{L}\p{N}]/gu, '');

async function get(url: string): Promise<any[]> {
  const r = await fetch(url);
  if (r.status === 404) return [];
  if (!r.ok) throw new Error('歌詞服務暫時連不上，請稍後再試');
  const j = await r.json();
  return Array.isArray(j) ? j : j ? [j] : [];
}

/** 搜尋候選歌詞（最多 8 筆，最可能的排前面）。`duration` 是音檔長度（秒），用來挑同一個版本。 */
export async function searchLyrics(title: string, artist: string, duration = NaN): Promise<LyricCandidate[]> {
  const t = title.trim(), a = artist.trim();
  if (!t) return [];
  const qs = (p: Record<string, string>) => new URLSearchParams(p).toString();
  // 先用歌名＋歌手找；找不到再只用歌名找（中文歌手名常有不同寫法：蔡依林 / Jolin Tsai）
  let rows = await get(`https://lrclib.net/api/search?${qs(a ? { track_name: t, artist_name: a } : { track_name: t })}`);
  if (!rows.length && a) rows = await get(`https://lrclib.net/api/search?${qs({ track_name: t })}`);
  if (!rows.length) rows = await get(`https://lrclib.net/api/search?${qs({ q: `${t} ${a}`.trim() })}`);
  const nt = norm(t), na = norm(a);
  const scored = rows.map((r) => {
    const c: LyricCandidate = {
      id: r.id, trackName: r.trackName ?? '', artistName: r.artistName ?? '', albumName: r.albumName ?? '',
      duration: Number(r.duration) || 0, instrumental: !!r.instrumental,
      syncedLyrics: r.syncedLyrics ?? '', plainLyrics: r.plainLyrics ?? '',
      diff: Number.isFinite(duration) ? Math.abs((Number(r.duration) || 0) - duration) : NaN,
    };
    let score = 0;
    if (c.syncedLyrics) score += 10;
    if (c.instrumental) score += 2;
    if (norm(c.trackName) === nt) score += 4; else if (norm(c.trackName).includes(nt) || nt.includes(norm(c.trackName))) score += 2;
    if (na && (norm(c.artistName).includes(na) || na.includes(norm(c.artistName)))) score += 3;
    if (Number.isFinite(c.diff)) score -= Math.min(8, c.diff / 2);
    return { c, score };
  });
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, 8).map((s) => s.c);
}
