// 大螢幕跟後端溝通：留言、歌單、分析、音檔。登入沿用後台的 token（同一個 localStorage key）。
// 音檔放進瀏覽器的 Cache Storage：重新整理不用重抓，會場網路斷掉也能繼續播已經下載的歌。
const TOKEN_KEY = 'wedding_admin_token';
const ROLE_KEY = 'wedding_admin_role';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

/** 後端回的錯誤。status 0 = 連不上；401 = 登入過期；403 = 這個帳號沒有大螢幕的權限。 */
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
    try {
      const d = await res.json();
      if (typeof d.detail === 'string') msg = d.detail;
      else if (typeof d.detail?.message === 'string') msg = d.detail.message;
    } catch { /* 不是 JSON */ }
    throw new HttpError(msg, res.status);
  }
  return res.status === 204 ? (null as T) : res.json();
}

/** 用後台的新人或幫手密碼登入（POST /api/admin/login）；token 跟後台存在同一個 localStorage key。 */
export async function login(password: string) {
  const r = await api<{ token: string; role: string }>('/api/admin/login', { method: 'POST', body: { password } });
  localStorage.setItem(TOKEN_KEY, r.token);
  localStorage.setItem(ROLE_KEY, r.role || 'couple');
  return r;
}

export interface FeedMessage { id: number; name: string; text: string; created_at: string; source?: string }
/**
 * 新人在後台選的內容（後端 stage.wall_content）：歌詞、賓客留言（關掉時沒有 QR、沒有邀請卡，feed 只給新人自己寫的話）、
 * 照片＋註解（albums 空的 = 全部相簿；mix = 照片與留言的比例）。
 */
export interface WallContent { lyrics: boolean; messages: boolean; photos: boolean; captions: boolean; albums: string[]; mix: 'all' | 'photos' | 'even' | 'messages' }
export const DEFAULT_CONTENT: WallContent = { lyrics: true, messages: true, photos: false, captions: true, albums: [], mix: 'even' };
/**
 * 現在的場合（後端 wall_scenes.feed_out）：這個場合的歌（照順序；空的 = 不換歌，接著播原本的）、只用的版面（空的 = 照「版面」分頁）、
 * 配色（空的 = 每首歌自己的）、講話模式、歌都播過一輪之後換到哪個場合（null = 重複播）。畫面放什麼與節奏已經合併在 feed 的 content、pace。
 */
export interface SceneFeed { id: number; name: string; songs: number[]; shuffle: boolean; plates: string[]; theme: string; duck: boolean; after: number | null }
export interface Feed {
  messages: FeedMessage[]; count: number; open: boolean; moderation: boolean; songs_rev: string; plates_off?: string[]; pace?: 'fast' | 'normal' | 'slow'; duck?: number;
  content?: WallContent; photos_rev?: string;
  /** 現在的場合（null = 沒指定，照整份歌單）；scene_seq 每切一次加一（切到同一個也算），scene_next 是「這首播完再換」排好的。 */
  scene?: SceneFeed | null; scene_seq?: number; scene_next?: { id: number | null } | null; scenes?: { id: number; name: string }[];
}
export const fetchFeed = () => api<Feed>('/api/planner/wall/feed');
/**
 * 切場合（when = now 馬上換）。歌播完時由大螢幕來換的要帶 expect（它看到的場合與切換編號）：
 * 中間有人用手機切過、取消了，伺服器就不換（applied = false），好幾台同時來也只換一次。
 */
export const switchScene = (body: { id: number | null; when?: 'now' | 'end'; expect_from?: number | null; expect_seq?: number }) =>
  api<{ applied: boolean; active: { id: number | null; seq: number; next: { id: number | null } | null } }>('/api/planner/wall/scenes/switch', { method: 'POST', body });

export interface SongRow {
  id: number; title: string; artist: string; original_name: string; size: number; content_type: string;
  sort_order: number; enabled: boolean; duration: number; bpm: number; has_analysis: boolean; analysis_version: number;
  lyrics_lrc: string; lyrics_source: string; lyrics_offset: number; instrumental: boolean;
  /** 中文翻譯的 LRC（韓文歌；空字串 = 沒有翻譯）。 */
  lyrics_trans?: string;
  theme: string; start_at: number; end_at: number; updated_at: string;
}
export const fetchSongs = () => api<{ items: SongRow[] }>('/api/planner/wall/songs').then((r) => r.items);

export async function fetchAnalysis(id: number): Promise<{ version: number; data: any } | null> {
  try { return await api(`/api/planner/wall/songs/${id}/analysis`); }
  catch (e) { if ((e as HttpError).status === 404) return null; throw e; }
}
export const saveAnalysis = (id: number, payload: { version: number; duration: number; bpm: number; data: unknown }) =>
  api(`/api/planner/wall/songs/${id}/analysis`, { method: 'PUT', body: payload });

// 手機遙控：每秒回報播放狀態，順便拿走手機按的指令（after：做過的最後一個指令編號，-1 = 剛打開）
export interface RemoteCommand { id: number; action: string; args: Record<string, any> }
/** 講話模式把音樂降到幾 %（0～90）：存在伺服器，手機遙控頁看到的、其他電腦開的大螢幕都一樣。 */
export const saveDuckLevel = (level: number) => api<{ level: number }>('/api/planner/wall/duck', { method: 'PUT', body: { level } });
// 同時開好幾台時只有一台接收遙控（leader），screens 是現在開著幾台；claim = 按了「改由這台接收遙控」
export const syncRemote = (body: { client: string; after: number; state: unknown; claim?: boolean }) =>
  api<{ seq: number; commands: RemoteCommand[]; leader?: boolean; screens?: number; locked?: '' | 'mine' | 'other' }>('/api/planner/wall/remote/sync', { method: 'POST', body });
// 鎖定遙控：鎖了之後別台搶不走，只有這台自己解除或後台強制解除
export const lockRemote = (client: string) => api<{ locked: string }>('/api/planner/wall/remote/lock', { method: 'POST', body: { client } });
export const unlockRemote = (client: string) => api<{ locked: string }>('/api/planner/wall/remote/unlock', { method: 'POST', body: { client } });

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

/** 大螢幕要播的照片：長寬、亮度、色調是後端在上傳時算好的（挑版面用），fx、fy 是新人設的焦點（null = 用預設）。 */
export interface WallPhotoRow { id: number; caption: string; album: string; w: number; h: number; fx: number | null; fy: number | null; lum: number | null; tone: string }
export const fetchWallPhotos = () => api<{ items: WallPhotoRow[]; rev: string }>('/api/planner/wall/photos');

/** 照片（大螢幕用的尺寸）。跟音檔一樣放 Cache Storage：重新整理不用重抓，會場網路斷掉也照樣有照片。 */
export async function fetchPhoto(id: number): Promise<Blob> {
  const key = `/wall-cache/photo/${id}`;
  let cache: Cache | null = null;
  try { cache = await caches.open(AUDIO_CACHE); } catch { /* 無痕模式等情況沒有 Cache Storage */ }
  const hit = cache && (await cache.match(key));
  if (hit) return hit.blob();
  const res = await fetch(`/api/planner/wall/photos/${id}/image`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new HttpError('照片下載失敗', res.status);
  const blob = await res.blob();
  try { await cache?.put(key, new Response(blob, { headers: { 'Content-Type': blob.type } })); } catch { /* 空間不夠就算了 */ }
  return blob;
}
