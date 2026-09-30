// 大螢幕跟後端溝通：留言、歌單、分析、音檔。登入沿用後台的 token（同一個 localStorage key）。
// 音檔放進瀏覽器的 Cache Storage：重新整理不用重抓，會場網路斷掉也能繼續播已經下載的歌。
const TOKEN_KEY = 'wedding_admin_token';
const ROLE_KEY = 'wedding_admin_role';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

export class HttpError extends Error { constructor(msg: string, public status: number) { super(msg); } }

async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const tok = getToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  let res: Response;
  try {
    res = await fetch(path, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  } catch { throw new HttpError('連線中斷', 0); }
  if (!res.ok) {
    let msg = '發生錯誤';
    try { const d = await res.json(); if (typeof d.detail === 'string') msg = d.detail; } catch { /* 不是 JSON */ }
    throw new HttpError(msg, res.status);
  }
  return res.status === 204 ? (null as T) : res.json();
}

export async function login(password: string) {
  const r = await api<{ token: string; role: string }>('/api/admin/login', { method: 'POST', body: { password } });
  localStorage.setItem(TOKEN_KEY, r.token);
  localStorage.setItem(ROLE_KEY, r.role || 'couple');
  return r;
}

export interface FeedMessage { id: number; name: string; text: string; created_at: string; source?: string }
export interface Feed { messages: FeedMessage[]; count: number; open: boolean; moderation: boolean; songs_rev: string; plates_off?: string[]; pace?: 'fast' | 'normal' | 'slow' }
export const fetchFeed = () => api<Feed>('/api/planner/wall/feed');

export interface SongRow {
  id: number; title: string; artist: string; original_name: string; size: number; content_type: string;
  sort_order: number; enabled: boolean; duration: number; bpm: number; has_analysis: boolean; analysis_version: number;
  lyrics_lrc: string; lyrics_source: string; lyrics_offset: number; instrumental: boolean;
  theme: string; start_at: number; end_at: number; updated_at: string;
}
export const fetchSongs = () => api<{ items: SongRow[] }>('/api/planner/wall/songs').then((r) => r.items);

export async function fetchAnalysis(id: number): Promise<{ version: number; data: any } | null> {
  try { return await api(`/api/planner/wall/songs/${id}/analysis`); }
  catch (e) { if ((e as HttpError).status === 404) return null; throw e; }
}
export const saveAnalysis = (id: number, payload: { version: number; duration: number; bpm: number; data: unknown }) =>
  api(`/api/planner/wall/songs/${id}/analysis`, { method: 'PUT', body: payload });

// 手機遙控（2026-09-30）：每秒回報播放狀態，順便拿走手機按的指令（after：做過的最後一個指令編號，-1 = 剛打開）
export interface RemoteCommand { id: number; action: string; args: Record<string, any> }
export const syncRemote = (body: { client: string; after: number; state: unknown }) =>
  api<{ seq: number; commands: RemoteCommand[] }>('/api/planner/wall/remote/sync', { method: 'POST', body });

const AUDIO_CACHE = 'wedding-wall-audio-v1';

/**
 * 音檔（Blob）。先看 Cache Storage；沒有就下載並存起來。`rev` 是歌的更新時間：換了檔案就是新的 key。
 */
export async function fetchAudio(id: number, rev: string): Promise<Blob> {
  const key = `/wall-cache/audio/${id}?rev=${encodeURIComponent(rev)}`;
  let cache: Cache | null = null;
  try { cache = await caches.open(AUDIO_CACHE); } catch { /* 無痕模式等情況沒有 Cache Storage */ }
  const hit = cache && (await cache.match(key));
  if (hit) return hit.blob();
  const res = await fetch(`/api/planner/wall/songs/${id}/audio`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new HttpError('音檔下載失敗', res.status);
  const blob = await res.blob();
  if (cache) {
    try {
      await cache.put(key, new Response(blob, { headers: { 'Content-Type': blob.type || 'audio/mpeg' } }));
      // 同一首歌的舊版本刪掉
      for (const req of await cache.keys()) if (req.url.includes(`/wall-cache/audio/${id}?`) && !req.url.endsWith(key.split('?')[1]!)) await cache.delete(req);
    } catch { /* 空間不夠就不存，照樣播 */ }
  }
  return blob;
}
