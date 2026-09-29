// 大螢幕（/wall）：會場電腦開這一頁，全螢幕播放「動畫＋音樂＋歌詞＋留言」。
//
// 照 pdoom-video 的 main.ts（MIT，見 engine/LICENSE）改寫：pdoom 是「預覽播放器 + 匯出」，這裡是「整晚的直播」：
//  - 時間的來源是音樂（<audio> 的 currentTime，用 performance.now 補平），畫面永遠跟著歌走。
//  - 每 2 秒拉一次留言：新留言下一拍就在畫面角落跳出小卡；導演排下一個窗格時也會優先主打新留言。
//  - 被新人隱藏的留言：小卡馬上收、主打它的窗格在下一拍切走。
//  - 一首接一首（歌單順序，播完從頭），下一首在背景先下載、分析好。歌單是空的就先無聲地跑留言。
//  - 開發模式 ?dev=1：不連後端，用 dev/fixtures 的假留言與本機的測試音檔（見 vite.config.js 的 wall-dev），
//    加上 ?export=1 給截圖腳本（scripts/wall-render.mjs）用。
import { Engine, SCENES, type SongRuntime } from './engine/engine';
import { PLATE_CATALOG } from './plateCatalog';
import { AudioData } from './engine/audio';
import { Lyrics } from './engine/lyrics';
import { PW, PH } from './engine/gl';
import { hash } from './engine/util';
import type { LiveInfo, Msg } from './engine/scene';
import { MessagePool } from './pool';
import { Director } from './director';
import { applyTheme, pickTheme } from './themes';
import { loadSong, type LoadedSong } from './songs';
import { fetchFeed, fetchSongs, getToken, login, HttpError, type SongRow } from './net';
import { buildLyrics } from './lyrics/build';
import { DEV_LIVE, DEV_MESSAGES, dummyLrc } from './dev/fixtures';
import { analyzeArrayBuffer } from './analysis/client';

const Q = new URLSearchParams(location.search);
const DEV = Q.has('dev');
const EXPORT = Q.has('export');
// 後台「大螢幕版面」頁的預覽：/wall?plate=名字，只播這個版面，← → 換下一個
const PREVIEW = EXPORT ? null : Q.get('plate');

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('c');
canvas.width = PW;
canvas.height = PH;

// ------------------------------------------------------------------ 共用狀態
const pool = new MessagePool();
const wishUrl = `${location.origin}/wish`;
const live: LiveInfo = {
  get count() { return pool.count; },
  url: wishUrl,
  shortUrl: `${location.host}/wish`,
  // 新人要求右下角有個小時鐘（2026-09-28），12 小時制加 AM／PM 賓客一看就知道是時間。
  // 截圖／驗收模式固定時間，同一格畫兩次才會一樣
  get clock() {
    if (EXPORT) return '7:30 PM';
    const d = new Date(), h = d.getHours();
    return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  },
};
const engine = new Engine(canvas, live);
engine.debug = DEV;
const director = new Director(engine, pool);
// 截圖／驗收要可重現：同一首歌每次排一樣；現場每次播都重新洗牌
director.fixedSeed = EXPORT;

let playlist: SongRow[] = [];
let songsRev = '';
let cur: LoadedSong | null = null;
let next: Promise<LoadedSong | null> | null = null;
let nextFor = -1;
let silent = false;
let t = 0;
let playing = false;
const statusLine = { text: '', ok: true };

declare global { interface Window { __wall: any } }

// ------------------------------------------------------------------ 播放器（音樂就是時鐘）
class Player {
  el = new Audio();
  ctx: AudioContext | null = null;
  gain: GainNode | null = null;
  url = '';
  volume = readNum('wall_volume', 0.9);
  /** 音畫同步微調（毫秒，正數＝畫面晚一點）：會場音響若有延遲，在這裡補。 */
  offsetMs = readNum('wall_sync_ms', 0);
  private lastA = 0; private lastP = 0;

  constructor() { this.el.preload = 'auto'; }

  /** 第一次按「開始」才能建 AudioContext（瀏覽器規定要有使用者操作）。 */
  unlock() {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaElementSource(this.el);
    this.gain = this.ctx.createGain();
    src.connect(this.gain).connect(this.ctx.destination);
  }

  async load(s: LoadedSong) {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(s.blob);
    this.el.src = this.url;
    this.el.currentTime = s.startAt;
    this.applyGain(s);
    this.lastA = s.startAt; this.lastP = performance.now();
  }

  applyGain(s: LoadedSong | null = cur) {
    if (this.gain) this.gain.gain.value = (s?.gain ?? 1) * this.volume;
    else this.el.volume = Math.min(1, this.volume);
  }

  async play() { this.unlock(); await this.ctx?.resume(); await this.el.play(); }
  pause() { this.el.pause(); }
  get paused() { return this.el.paused; }

  /** 畫面該畫的歌曲時間：音樂時間（用 performance.now 補平）扣掉輸出延遲，加上手動微調。 */
  time(): number {
    const now = performance.now();
    if (this.el.currentTime !== this.lastA) { this.lastA = this.el.currentTime; this.lastP = now; }
    const a = this.lastA + (this.el.paused ? 0 : (now - this.lastP) / 1000);
    const lat = this.ctx ? (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0) : 0;
    return a - lat - this.offsetMs / 1000;
  }
}
const player = new Player();

function readNum(k: string, d: number) { try { const v = Number(localStorage.getItem(k)); return localStorage.getItem(k) !== null && Number.isFinite(v) ? v : d; } catch { return d; } }
function saveNum(k: string, v: number) { try { localStorage.setItem(k, String(v)); } catch { /* 存不了就算了 */ } }

// ------------------------------------------------------------------ 歌曲切換
function startRuntime(rt: SongRuntime, startAt: number) {
  applyTheme(rt.info.theme);
  engine.setSong(rt);
  director.startSong(rt, startAt);
  t = startAt;
}

/** 無聲模式：歌單還是空的時候，用假節拍跑留言與邀請卡。 */
function startSilent() {
  silent = true;
  cur = null;
  player.pause();
  const audio = AudioData.silent(240, 96);
  const theme = pickTheme(audio, 0);
  startRuntime({ info: { id: 0, title: '', artist: '', index: 0, count: 0, theme }, audio, lyrics: Lyrics.empty() }, 0);
  silentStart = performance.now() - 0;
}
let silentStart = 0;

function indexOfSong(id: number) { return playlist.findIndex((s) => s.id === id); }

function prepare(idx: number, prevTheme: string): Promise<LoadedSong | null> {
  const row = playlist[((idx % playlist.length) + playlist.length) % playlist.length];
  if (!row) return Promise.resolve(null);
  const i = indexOfSong(row.id);
  return loadSong(row, i + 1, playlist.length, prevTheme, (s) => setStatus(s), devLoadOpts(row)).catch((e) => {
    console.error('song load failed', e);
    setStatus(`「${row.title}」讀不到：${(e as Error).message}，跳過`, false);
    return null;
  });
}

/** 播第 idx 首（歌單的位置）。失敗就往下一首找，都失敗就進無聲模式。 */
async function playIndex(idx: number, preloaded?: LoadedSong | null) {
  if (!playlist.length) return startSilent();
  for (let tries = 0; tries < playlist.length; tries++) {
    const k = (((idx + tries) % playlist.length) + playlist.length) % playlist.length;
    const s = preloaded && tries === 0 ? preloaded : await prepare(k, cur?.runtime.info.theme ?? '');
    if (!s) continue;
    silent = false;
    cur = s;
    await player.load(s);
    startRuntime(s.runtime, s.startAt);
    if (playing) await player.play().catch(() => {});
    // 下一首先在背景準備
    nextFor = k + 1;
    next = prepare(k + 1, s.runtime.info.theme);
    updateUi();
    return;
  }
  startSilent();
}

async function nextSong() {
  if (!cur) return playIndex(0);
  const k = indexOfSong(cur.row.id);
  const want = k + 1;
  const pre = next && nextFor === want ? await next : null;
  await playIndex(want, pre && pre.row.id === playlist[want % playlist.length]?.id ? pre : null);
}
async function prevSong() {
  if (!cur) return playIndex(0);
  // 播超過五秒：從頭；不然回上一首
  if (t - cur.startAt > 5) { player.el.currentTime = cur.startAt; startRuntime(cur.runtime, cur.startAt); return; }
  await playIndex(indexOfSong(cur.row.id) - 1);
}

// ------------------------------------------------------------------ 留言
// 2026-09-28 新人：「親友的留言要直接結合在模板裡，不要放一堆卡，不要太突兀」。
// 所以不再跳即時小卡：新留言排進主打（pool.nextHero 新留言優先），還沒開始的窗格馬上重排，
// 下一個窗格的版面就會用它當主角（版面自己的方式：星座、報紙頭條、信紙…）。
pool.onArrive = () => {
  const au = engine.song?.audio;
  if (!au) return;
  // 快開始的窗格（2.5 秒內）已經在準備了，留著；之後的重排
  const next = engine.timeline.filter((e) => e.start > t).sort((a, b) => a.start - b.start)[0];
  engine.drop(next && next.start - t < 2.5 ? next.start + 0.01 : t + 0.01);
};
pool.onRemove = (id) => {
  // 主打這則的窗格：下一拍切走（之後的窗格重排）
  const au = engine.song?.audio;
  if (!au) return;
  const hit = engine.timeline.find((e) => e.params?.message?.id === id && e.end > t);
  if (hit) {
    const at = Math.max(t, au.nextBeat(t + 0.05));
    engine.drop(at);
    if (hit.start < at) engine.cut(hit.id, at); else engine.drop(hit.start);
  }
};

// ------------------------------------------------------------------ 輪詢後端
let feedFails = 0;
async function pollFeed(initial = false) {
  if (DEV) return;
  try {
    const f = await fetchFeed();
    feedFails = 0;
    await pool.sync(f.messages, initial);
    director.off = new Set(f.plates_off ?? []);
    director.pace = f.pace ?? 'normal';
    if (f.songs_rev !== songsRev) {
      songsRev = f.songs_rev;
      const rows = (await fetchSongs()).filter((s) => s.enabled).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
      const changed = rows.map((r) => `${r.id}@${r.updated_at}`).join() !== playlist.map((r) => `${r.id}@${r.updated_at}`).join();
      playlist = rows;
      if (changed && !initial) {
        next = null; nextFor = -1;
        if (silent && playlist.length) playIndex(0);
        else if (cur && indexOfSong(cur.row.id) >= 0) { const k = indexOfSong(cur.row.id); nextFor = k + 1; next = prepare(k + 1, cur.runtime.info.theme); }
      }
    }
    if (!statusLine.ok) setStatus('連線正常', true);
  } catch (e) {
    feedFails++;
    if ((e as HttpError).status === 401) { setStatus('登入過期：請重新整理並登入（畫面會繼續播）', false); }
    else if (feedFails > 2) setStatus('連不上伺服器，新留言暫時進不來（畫面會繼續播）', false);
  }
}

// ------------------------------------------------------------------ 每一格
let lastFrame = performance.now(), fpsAcc = 0, fpsN = 0, fps = 60;
// 長時間播放的健康檢查（測試腳本讀；開發者工具的主控台也可以打 __wallStats() 看）：貼圖、幾何有沒有越積越多
(window as any).__wallStats = () => ({
  t, playing, silent, song: cur?.row.title ?? '', textures: engine.renderer.info.memory.textures, geometries: engine.renderer.info.memory.geometries,
  programs: engine.renderer.info.programs?.length ?? 0, heap: (performance as any).memory?.usedJSHeapSize ?? 0, timeline: engine.timeline.length, scenes: engine.loaded.size,
  messages: pool.count, errors: engine.errors.length, fps,
});

function tick() {
  const now = performance.now();
  fpsAcc += now - lastFrame; fpsN++; lastFrame = now;
  if (fpsAcc > 1000) { fps = (fpsN * 1000) / fpsAcc; fpsAcc = 0; fpsN = 0; }
  if (playing) {
    if (silent) t = ((now - silentStart) / 1000) % 240;
    else if (cur) t = player.time();
  }
  const au = engine.song?.audio;
  if (au) {
    if (playing && !silent && cur && (t >= cur.endAt - 0.03 || player.el.ended)) { void nextSong(); }
    else if (playing && silent && t > 239) startSilent();
    director.update(t);
    engine.gc(t);
    engine.render(t, 1 / 60);
  }
  if (debugEl && !debugEl.hidden) debugEl.textContent = `${t.toFixed(2)}s  beat ${au?.beatAt(t).toFixed(2)}  bar ${au?.barAt(t).toFixed(2)}  [${engine.timeline.find((e) => t >= e.start && t < e.end)?.id ?? '—'}]  ${fps.toFixed(0)}fps  留言 ${pool.count}  errors ${engine.errors.length}`;
  requestAnimationFrame(tick);
}

// ------------------------------------------------------------------ 操作列（滑鼠一動就出現，三秒不動就藏起來）
const ui = $<HTMLDivElement>('ui');
const debugEl = $<HTMLPreElement>('debug');
let uiTimer = 0;
function showUi() {
  ui.classList.add('show');
  document.body.classList.remove('idle');
  clearTimeout(uiTimer);
  uiTimer = window.setTimeout(() => { ui.classList.remove('show'); document.body.classList.add('idle'); }, 3000);
}
function setStatus(s: string, ok = true) { statusLine.text = s; statusLine.ok = ok; updateUi(); const g = document.getElementById('gate-status'); if (g) g.textContent = s; }
function updateUi() {
  const info = cur?.runtime.info;
  $('ui-song').textContent = silent ? '（歌單是空的：先無聲播放留言）' : info ? `${info.index}/${info.count}　${info.title}${info.artist ? ' — ' + info.artist : ''}` : '—';
  const nx = playlist.length && cur ? playlist[(indexOfSong(cur.row.id) + 1) % playlist.length] : null;
  $('ui-next').textContent = nx ? `下一首：${nx.title}` : '';
  $('ui-vol').textContent = `${Math.round(player.volume * 100)}%`;
  $('ui-sync').textContent = `${player.offsetMs > 0 ? '+' : ''}${player.offsetMs} ms`;
  $('ui-play').textContent = playing ? '暫停' : '播放';
  $('ui-status').textContent = `留言 ${pool.count} 則　${statusLine.text}`;
  $('ui-status').classList.toggle('bad', !statusLine.ok);
}
function bindUi() {
  const on = (id: string, fn: () => void) => $(id).addEventListener('click', (e) => { e.stopPropagation(); fn(); updateUi(); });
  on('ui-play', () => togglePlay());
  on('ui-next-btn', () => void nextSong());
  on('ui-prev-btn', () => void prevSong());
  on('ui-vol-down', () => setVolume(player.volume - 0.1));
  on('ui-vol-up', () => setVolume(player.volume + 0.1));
  on('ui-sync-down', () => setSync(player.offsetMs - 20));
  on('ui-sync-up', () => setSync(player.offsetMs + 20));
  on('ui-full', () => toggleFull());
  on('ui-quality', () => { const s = Q.get('scale') === '0.75' ? '1' : '0.75'; Q.set('scale', s); location.search = Q.toString(); });
  $('ui-quality').textContent = Q.get('scale') === '0.75' ? '畫質：省電' : '畫質：高';
  window.addEventListener('mousemove', showUi);
  window.addEventListener('keydown', (ev) => {
    if ((ev.target as HTMLElement).tagName === 'INPUT') return;
    const k = ev.key;
    if (k === ' ') { ev.preventDefault(); togglePlay(); }
    else if (PREVIEW && (k === 'ArrowRight' || k === 'ArrowLeft')) setPreview(previewIdx + (k === 'ArrowRight' ? 1 : -1));
    else if (k === 'ArrowRight' && !DEV) void nextSong();
    else if (k === 'ArrowLeft' && !DEV) void prevSong();
    else if (k === 'ArrowUp') setVolume(player.volume + 0.1);
    else if (k === 'ArrowDown') setVolume(player.volume - 0.1);
    else if (k === 'f' || k === 'F') toggleFull();
    else if (k === '[') setSync(player.offsetMs - 20);
    else if (k === ']') setSync(player.offsetMs + 20);
    else if (k === 'd' || k === 'D') debugEl.hidden = !debugEl.hidden;
    else if (DEV && (k === 'ArrowRight' || k === 'ArrowLeft')) { const dt = (k === 'ArrowRight' ? 1 : -1) * (ev.shiftKey ? 15 : 5); player.el.currentTime = Math.max(0, player.el.currentTime + dt); engine.drop(0); engine.setSong(engine.song); director.startSong(engine.song, Math.max(0, t + dt)); }
    else if (DEV && (k === 'n' || k === 'N')) void nextSong();
    else return;
    showUi(); updateUi();
  });
}
function setVolume(v: number) { player.volume = Math.max(0, Math.min(1.5, Math.round(v * 10) / 10)); player.applyGain(); saveNum('wall_volume', player.volume); }
function setSync(ms: number) { player.offsetMs = Math.max(-500, Math.min(1500, ms)); saveNum('wall_sync_ms', player.offsetMs); }
function toggleFull() { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen().catch(() => {}); }
async function togglePlay() {
  playing = !playing;
  if (silent) { if (playing) silentStart = performance.now() - t * 1000; return; }
  if (playing) await player.play().catch(() => { playing = false; }); else player.pause();
  updateUi();
}

// ------------------------------------------------------------------ 版面預覽（/wall?plate=名字）
// 2026-09-28 新人要在後台看每個版面的樣子：用真的歌單、真的留言播，只是導演每個窗格都用指定的版面。
// 左上角標出現在是哪個版面，← → 或標籤上的按鈕換上一個／下一個（清單順序跟後台一樣）。
const previewList = PLATE_CATALOG.map((p) => p.name).filter((n) => n !== 'title' && SCENES.includes(n));
let previewIdx = -1;
function setupPreview() {
  const tag = $<HTMLDivElement>('preview-tag');
  tag.hidden = false;
  tag.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (b) { e.stopPropagation(); setPreview(previewIdx + Number(b.dataset.step)); }
  });
  setPreview(Math.max(0, previewList.indexOf(PREVIEW!)));
}
function setPreview(i: number) {
  if (!previewList.length) return;
  previewIdx = (i + previewList.length) % previewList.length;
  const name = previewList[previewIdx]!;
  director.force = { scene: name };
  Q.set('plate', name);
  history.replaceState(null, '', `${location.pathname}?${Q.toString()}`);
  // 馬上換：現在這個窗格在下一拍收掉，後面排好的丟掉，導演會從那一拍開始排新的版面
  const au = engine.song?.audio;
  if (au) {
    const at = Math.max(t + 0.05, au.nextBeat(t + 0.05));
    const now = engine.timeline.find((e) => t >= e.start && t < e.end);
    engine.drop(at);
    if (now) engine.cut(now.id, at);
  }
  const info = PLATE_CATALOG.find((p) => p.name === name);
  $('preview-tag').innerHTML = `<button type="button" data-step="-1" title="上一個（←）">‹</button>`
    + `<span><b>${previewIdx + 1}/${previewList.length}　${info?.title ?? name}</b>${director.off.has(name) ? '<em>（現場已關閉）</em>' : ''}<small>${info?.idea ?? ''}</small></span>`
    + `<button type="button" data-step="1" title="下一個（→）">›</button>`;
}

// ------------------------------------------------------------------ 開發模式的資料來源
interface DevSong { id: number; file: string; title: string; artist: string; lrc: string }
let devSongs: DevSong[] = [];
function devLoadOpts(row: SongRow) {
  if (!DEV) return {};
  const d = devSongs.find((s) => s.id === row.id);
  return {
    save: false,
    fetchBlob: async () => (await fetch(`/wall-dev/audio/${encodeURIComponent(d!.file)}`)).blob(),
  };
}
async function devInit() {
  try { devSongs = await (await fetch('/wall-dev/songs.json')).json(); } catch { devSongs = []; }
  playlist = devSongs.map((s, i) => ({
    id: s.id, title: s.title, artist: s.artist, original_name: s.file, size: 0, content_type: '', sort_order: i, enabled: true,
    duration: 0, bpm: 0, has_analysis: false, analysis_version: 0, lyrics_lrc: s.lrc, lyrics_source: s.lrc ? 'manual' : '', lyrics_offset: 0,
    instrumental: false, theme: Q.get('theme') ?? '', start_at: 0, end_at: 0, updated_at: 'dev',
  }));
  await pool.sync(DEV_MESSAGES, true);
  // 開發用：看導演排了什麼（測試新留言有沒有排進下一個窗格）
  (window as any).__wallDbg = { t: () => t, timeline: () => engine.timeline.map((e) => ({ scene: e.scene, start: e.start, end: e.end, msg: e.params?.message?.id ?? null })) };
  if (Q.has('sim')) {
    let k = 0;
    setInterval(() => { const m = DEV_LIVE[k % DEV_LIVE.length]!; k++; void pool.sync([...DEV_MESSAGES, ...DEV_LIVE.slice(0, k).map((x, i) => ({ ...x, id: 100 + i }))]); void m; }, 9000);
  }
}

// ------------------------------------------------------------------ 截圖／匯出（?dev=1&export=1，給 scripts/wall-render.mjs）
const analysisCache = new Map<string, any>();
function setupExport() {
  document.body.classList.add('export');
  window.__wall = {
    ready: true,
    width: PW, height: PH,
    errors: engine.errors,
    scenes: SCENES,
    songs: () => devSongs.map((s) => s.file),
    /**
     * 準備一首測試歌：song = 測試音檔檔名（沒給就第一首）；scene = 整首都用這個版面（沒給就讓導演排）；
     * message = 主打第幾則假留言（1 起算）；theme = 配色；analysis = 之前算好的分析（腳本會快取，省時間）。
     * 回傳這首歌的分析（腳本存起來下次用）與時間軸。
     */
    async setup(o: { song?: string; scene?: string; params?: Record<string, any>; message?: number; theme?: string; analysis?: any; lrc?: string; from?: number; to?: number } = {}) {
      const d = (o.song ? devSongs.find((s) => s.file === o.song) : devSongs[0]);
      let audio: AudioData, lyrics: Lyrics, json: any = null;
      if (d) {
        json = o.analysis ?? analysisCache.get(d.file);
        if (!json) json = await analyzeArrayBuffer(await (await fetch(`/wall-dev/audio/${encodeURIComponent(d.file)}`)).arrayBuffer());
        analysisCache.set(d.file, json);
        audio = new AudioData(json);
        lyrics = buildLyrics(o.lrc ?? (d.lrc || dummyLrc(audio)), audio);
      } else { audio = AudioData.silent(120); lyrics = buildLyrics(dummyLrc(audio), audio); }
      const theme = o.theme ?? pickTheme(audio, d?.id ?? 0);
      startRuntime({ info: { id: d?.id ?? 0, title: d?.title ?? '測試', artist: d?.artist ?? '', index: 1, count: Math.max(1, devSongs.length), theme }, audio, lyrics }, 0);
      if (o.scene) {
        const msg = o.message ? pool.all.find((m) => m.id === o.message) ?? pool.all[0] : pool.all[(hash(o.from ?? 0) * pool.count) | 0];
        engine.add({ id: `x-${o.scene}`, scene: o.scene, start: o.from ?? 0, end: o.to ?? audio.duration, params: { seed: 1, energy: audio.energyAt((o.from ?? 0) + 2), message: msg, messages: pool.all.slice(), ...(o.params ?? {}) } });
      } else {
        // 導演把整首歌排完（截圖任何時間點都有窗格）
        for (let tt = 0; tt < audio.duration; tt += 4) director.update(tt);
      }
      return { analysis: json, timeline: engine.timeline.map(({ id, scene, start, end }) => ({ id, scene, start, end })), duration: audio.duration, bpm: audio.bpm, lines: lyrics.lines.length };
    },
    /** 在 t 秒排一張即時小卡（測試小卡的樣子）。 */
    async popup(id: number, at: number, fresh = true) { const m = pool.all.find((x) => x.id === id); if (!m) return false; await engine.prepare(at); engine.render(at, 1 / 60, false); return engine.overlay.schedule(m, at, fresh, engine.lastPost.popupAvoid); },
    async still(tt: number) { await engine.prepare(tt); t = tt; engine.render(tt, 1 / 60, true); return engine.timeline.find((e) => tt >= e.start && tt < e.end)?.id ?? null; },
    /** 效能：連續畫 n 格，回傳每格平均毫秒（含 GPU 同步）。 */
    async perf(from: number, n = 120) {
      await engine.prepare(from);
      const gl = engine.renderer.getContext();
      const px = new Uint8Array(4);
      const t0 = performance.now();
      for (let i = 0; i < n; i++) { engine.render(from + i / 60, 1 / 60, true); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
      return (performance.now() - t0) / n;
    },
  };
}

// ------------------------------------------------------------------ 螢幕不要睡著
// 會場筆電放著播三個小時：用 Wake Lock 擋住螢幕變暗與睡眠；切到別的分頁再回來時鎖會掉，要重新拿。
let wakeLock: { release(): Promise<void> } | null = null;
async function keepAwake() {
  try { wakeLock = await (navigator as any).wakeLock?.request('screen') ?? null; } catch { /* 不支援或被拒絕：請在電腦設定關掉睡眠 */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && playing) void keepAwake(); });
void wakeLock;

// ------------------------------------------------------------------ 開機
const gate = $<HTMLDivElement>('gate');
function showLogin(msg = '') {
  gate.innerHTML = `<form id="login" class="gate-card" autocomplete="off">
    <p class="gate-eyebrow">OUR WEDDING · 大螢幕</p><h1>請先登入</h1>
    <p class="gate-sub">用後台的新人或幫手密碼登入（需要「現場留言」權限）。</p>
    <input id="pw" type="password" placeholder="密碼" autofocus />
    <button type="submit">登入</button><p class="gate-err">${msg}</p></form>`;
  $('login').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await login(($('pw') as HTMLInputElement).value); location.reload(); }
    catch (err) { showLogin((err as Error).message || '登入失敗'); }
  });
}

function showStart() {
  gate.innerHTML = `<div class="gate-card">
    <p class="gate-eyebrow">ALAN &amp; OMENA · 2027.03.13</p><h1>大螢幕準備好了</h1>
    <p class="gate-sub">按「開始播放」後會進入全螢幕。滑鼠移動會出現操作列：上一首／下一首、音量、音畫同步。<br/>空白鍵暫停、F 全螢幕、↑↓ 音量、[ ] 音畫同步。</p>
    <button id="go" type="button">開始播放</button><p id="gate-status" class="gate-status">${statusLine.text}</p></div>`;
  $('go').addEventListener('click', async () => {
    gate.hidden = true;
    player.unlock();
    void keepAwake();
    void document.documentElement.requestFullscreen().catch(() => {});
    playing = true;
    if (silent) silentStart = performance.now() - t * 1000;
    else await player.play().catch(() => {});
    showUi(); updateUi();
  });
}

async function boot() {
  if (!DEV && !getToken()) return showLogin();
  gate.innerHTML = `<div class="gate-card"><h1>準備中…</h1><p id="gate-status" class="gate-status">載入字型與畫面</p></div>`;
  // 開發／截圖用：&only=a,b 只載這幾個版面（版面有兩百個，全部載入 QA 會很慢）
  await engine.init(DEV && Q.get('only') ? Q.get('only')!.split(',') : undefined);
  if (engine.errors.length) console.error(engine.errors.join('\n'));
  if (DEV) await devInit();
  else {
    try {
      const f = await fetchFeed();
      await pool.sync(f.messages, true);
      director.off = new Set(f.plates_off ?? []);
      director.pace = f.pace ?? 'normal';
      songsRev = f.songs_rev;
      playlist = (await fetchSongs()).filter((s) => s.enabled).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    } catch (e) {
      if ((e as HttpError).status === 401) return showLogin('登入已過期，請重新登入');
      if ((e as HttpError).status === 403) return showLogin('這個帳號沒有「現場留言」的權限，請新人到設定頁開放');
      setStatus('連不上伺服器，稍後會自動重試', false);
    }
    setInterval(() => void pollFeed(), 2000);
  }
  if (EXPORT) { setupExport(); return; }
  bindUi();
  if (PREVIEW) setupPreview();
  // ?song=歌的 id：從那一首開始播（後台「在大螢幕試播」用）
  const want = Number(Q.get('song'));
  if (playlist.length) { setStatus(`歌單 ${playlist.length} 首，準備第一首…`); await playIndex(want ? Math.max(0, indexOfSong(want)) : 0); setStatus('準備好了'); }
  else startSilent();
  showStart();
  requestAnimationFrame(tick);
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre class="fatal">${String((e as Error)?.stack ?? e)}</pre>`);
  window.__wall = { error: String((e as Error)?.stack ?? e) };
});

