// 大螢幕（/wall）：會場電腦開這一頁，全螢幕播放「動畫＋音樂＋歌詞＋留言」。
//
// 照 pdoom-video 的 main.ts（MIT，見 engine/LICENSE）改寫：pdoom 是「預覽播放器 + 匯出」，這裡是「整晚的直播」：
//  - 時間的來源是音樂（<audio> 的 currentTime，用 performance.now 補平），畫面永遠跟著歌走。
//  - 每 2 秒拉一次留言：新留言下一拍就在畫面角落跳出小卡；導演排下一個窗格時也會優先主打新留言。
//  - 被新人隱藏的留言：小卡馬上收、主打它的窗格在下一拍切走。
//  - 一首接一首（歌單順序，播完從頭；可以隨機播放），下一首在背景先下載、分析好。歌單是空的就先無聲地跑留言。
//  - 操作列（2026-09-30）：進度條可以拖拉跳到任何時間；旁邊的歌單面板看下一首與待播清單，可以「現在播」「插播」。
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
let nextFor = -1; // next 準備的是哪一首（歌的 id）
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

// ------------------------------------------------------------------ 播放順序、插播、隨機播放（2026-09-30）
// order 是這一晚的播放順序，pos 是現在播到第幾個。後面永遠至少排好一整輪（隨機播放時下一輪先洗好），
// 歌單面板看到的待播清單就是真的會播的順序，下一首也才能先在背景準備。
// 插播（面板上的「插播」「現在播」）：把那首搬到現在這首的正後面、標成插播，其他歌的先後不變，
// 所以插播完就回到原本的順序。好幾首插播照按的先後排。
interface Slot { id: number; ins?: boolean }
let order: Slot[] = [];
let pos = -1;
let shuffle = readNum('wall_shuffle', 0) === 1;

function indexOfSong(id: number) { return playlist.findIndex((s) => s.id === id); }
const rowById = (id: number) => playlist.find((s) => s.id === id);
const songIds = () => playlist.map((s) => s.id);

function shuffled(list: number[], avoidFirst?: number): number[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  // 新的一輪不要一開始就是剛播完的那首
  if (a.length > 1 && a[0] === avoidFirst) { const j = 1 + Math.floor(Math.random() * (a.length - 1)); [a[0], a[j]] = [a[j]!, a[0]!]; }
  return a;
}
/** 照歌單的順序從 id 的下一首繞一圈（最後一首是 id 自己）；id 不在歌單裡就從第一首開始。 */
function cycleAfter(id: number | undefined): number[] {
  const all = songIds(), i = id === undefined ? -1 : all.indexOf(id);
  return [...all.slice(i + 1), ...all.slice(0, i + 1)];
}
/** 現在這首之後至少排好一整輪；播一整晚 order 會越接越長，前面播過的只留最近 50 首（「上一首」用）。 */
function ensureAhead() {
  const n = playlist.length;
  if (!n) return;
  while (order.length - 1 - pos < n) {
    // 照歌單：從最後排的那首接著繞；隨機：整份洗牌，但不要一開頭就是剛排過的那首
    const last = order[order.length - 1]?.id;
    order.push(...(shuffle ? shuffled(songIds(), last) : cycleAfter(last)).map((id) => ({ id })));
  }
  if (pos > 200) { order = order.slice(pos - 50); pos = 50; }
}
/** 插播的都排在現在這首的正後面：還有幾首插播沒播。 */
function insertsAhead() { let k = 0; while (order[pos + 1 + k]?.ins) k++; return k; }
/**
 * 重排現在這首之後的順序（插播的留著）：照歌單就從現在這首（或最後一首照順序播的歌）的下一首接下去；
 * 隨機就把其他歌重新洗牌。開關「隨機播放」、按「重新洗牌」、歌單的排序改了都用這個。
 */
function rebuildAhead() {
  const all = songIds();
  const ins = order.slice(pos + 1, pos + 1 + insertsAhead()).filter((e) => all.includes(e.id));
  // 已經排好插播的，這一輪不用再排一次
  const skip = new Set(ins.map((e) => e.id));
  let rest: number[];
  if (shuffle) rest = shuffled(all.filter((id) => id !== cur?.row.id && !skip.has(id)));
  else {
    // 從最後一首照順序播的歌（不是插播的）的下一首接下去；那之後插播過的歌，這一輪也不再播
    let a = pos;
    while (a >= 0 && (order[a]!.ins || !all.includes(order[a]!.id))) a--;
    for (const e of order.slice(a + 1, pos + 1)) if (e.ins) skip.add(e.id);
    rest = cycleAfter(a >= 0 ? order[a]!.id : undefined).filter((id) => !skip.has(id));
  }
  order = [...order.slice(0, pos + 1), ...ins, ...rest.map((id) => ({ id }))];
  ensureAhead();
}
/** 歌單改了（加歌、刪歌、停用、排序）：照歌單播的重排；隨機播放的保留已經洗好的順序，拿掉沒了的、新歌隨便插進去。 */
function syncOrder() {
  const all = songIds(), has = new Set(all);
  if (!shuffle) return rebuildAhead();
  const ahead = order.slice(pos + 1).filter((e) => has.has(e.id));
  for (const id of all) if (!order.some((e) => e.id === id)) ahead.splice(Math.floor(Math.random() * (ahead.length + 1)), 0, { id });
  order = [...order.slice(0, pos + 1), ...ahead];
  ensureAhead();
}
/** 開機或從無聲模式回來：從 startId（網址的 ?song=）或第一首開始排。 */
function initOrder(startId?: number) {
  const all = songIds();
  const i = startId !== undefined ? all.indexOf(startId) : -1;
  const first = shuffle
    ? (i >= 0 ? [startId!, ...shuffled(all.filter((id) => id !== startId))] : shuffled(all))
    : (i >= 0 ? cycleAfter(all[(i + all.length - 1) % all.length]) : all);
  order = first.map((id) => ({ id }));
  pos = -1;
  ensureAhead();
}

function prepare(id: number, prevTheme: string): Promise<LoadedSong | null> {
  const row = rowById(id);
  if (!row) return Promise.resolve(null);
  return loadSong(row, indexOfSong(id) + 1, playlist.length, prevTheme, (s) => setStatus(s), devLoadOpts(row)).catch((e) => {
    console.error('song load failed', e);
    setStatus(`「${row.title}」讀不到：${(e as Error).message}，跳過`, false);
    return null;
  });
}
/** 下一首先在背景準備（插播、洗牌、歌單改了之後，下一首可能換了）。 */
function refreshNext() {
  if (!cur || !playlist.length) { next = null; nextFor = -1; return; }
  ensureAhead();
  const id = order[pos + 1]?.id;
  if (id === undefined || id === nextFor) return;
  nextFor = id;
  next = prepare(id, cur.runtime.info.theme);
}

/**
 * 換歌都經過這裡，一次只換一首：歌播完的那幾格會連續呼叫、按鈕也可能連點，
 * 不擋的話 pos 會一次往前跳好幾首。
 */
let switching = false;
async function transition(fn: () => Promise<void> | void) {
  if (switching) return;
  switching = true;
  try { await fn(); } finally { switching = false; updateUi(); }
}
/** 播 order[pos]。讀不到就往下一首找，整份歌單都讀不到就進無聲模式。 */
async function playPos() {
  for (let tries = 0; tries < Math.max(1, playlist.length); tries++) {
    ensureAhead();
    const id = order[pos]?.id;
    if (id === undefined) break;
    const pre = next && nextFor === id ? await next : null;
    const s = pre && pre.row.id === id ? pre : await prepare(id, cur?.runtime.info.theme ?? '');
    if (s) {
      silent = false;
      cur = s;
      nextFor = -1; next = null;
      await player.load(s);
      startRuntime(s.runtime, s.startAt);
      if (playing) await player.play().catch(() => {});
      refreshNext();
      return;
    }
    pos++;
  }
  startSilent();
}
function nextSong() {
  return transition(async () => {
    if (!playlist.length) return startSilent();
    if (!cur) initOrder();
    pos++;
    await playPos();
  });
}
function prevSong() {
  return transition(async () => {
    if (!cur) return;
    // 播超過五秒：從頭；不然回上一首
    if (t - cur.startAt > 5 || pos <= 0) return seekTo(cur.startAt);
    pos--;
    await playPos();
  });
}
/** 待播清單的第 j 個（order 的位置）：搬到現在這首的正後面、標成插播（排在已經插播的後面）。 */
function insertAt(j: number) {
  const [e] = order.splice(j, 1);
  if (!e) return;
  order.splice(pos + 1 + insertsAhead(), 0, { id: e.id, ins: true });
  ensureAhead();
  refreshNext();
}
/** 「現在播」：馬上切過去；其他歌的先後不變，播完照原本的順序。 */
function playNow(j: number) {
  return transition(async () => {
    const [e] = order.splice(j, 1);
    if (!e) return;
    order.splice(pos + 1, 0, { id: e.id, ins: true });
    pos++;
    await playPos();
  });
}
/** 取消插播：照歌單播的，重排回它原本的位置；隨機播放的，放回這一輪還沒播的歌中間。 */
function cancelInsert(j: number) {
  const e = order[j];
  if (!e?.ins) return;
  order.splice(j, 1);
  if (!shuffle) rebuildAhead();
  else {
    const from = pos + 1 + insertsAhead(), to = Math.max(from, pos + playlist.length - 1);
    order.splice(from + Math.floor(Math.random() * (to - from + 1)), 0, { id: e.id });
    ensureAhead();
  }
  refreshNext();
}
function setShuffle(on: boolean) {
  shuffle = on;
  saveNum('wall_shuffle', on ? 1 : 0);
  rebuildAhead();
  refreshNext();
}

/** 拖拉進度條、Shift＋← → 跳到 x 秒：音樂跳過去，畫面的時間軸清空、由導演從那裡重排。 */
function seekTo(x: number) {
  if (!cur || silent) return;
  const to = Math.max(cur.startAt, Math.min(cur.endAt - 0.5, x));
  player.el.currentTime = to;
  engine.drop(-Infinity);
  director.seek(to);
  t = to;
  updateUi();
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
        // 歌改過（歌詞、配色…）：已經準備好的下一首要重新準備
        next = null; nextFor = -1;
        if (silent && playlist.length) { initOrder(); void transition(async () => { pos = 0; await playPos(); }); }
        else if (playlist.length) { syncOrder(); refreshNext(); }
        updateUi();
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
  // 接下來的播放順序（歌的 id，i = 插播）：測試插播、隨機播放用
  queue: order.slice(pos, pos + 10).map((e) => `${e.id}${e.ins ? 'i' : ''}`).join(' '),
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
  if (ui.classList.contains('show') && now - lastSeekDraw > 150) { lastSeekDraw = now; drawSeek(); }
  if (debugEl && !debugEl.hidden) debugEl.textContent = `${t.toFixed(2)}s  beat ${au?.beatAt(t).toFixed(2)}  bar ${au?.barAt(t).toFixed(2)}  [${engine.timeline.find((e) => t >= e.start && t < e.end)?.id ?? '—'}]  ${fps.toFixed(0)}fps  留言 ${pool.count}  errors ${engine.errors.length}`;
  requestAnimationFrame(tick);
}

// ------------------------------------------------------------------ 操作列（滑鼠一動就出現，三秒不動就藏起來）
// 2026-09-30：上面加一條可以拖拉的進度條；右邊的歌單面板（L 開關）跟著操作列一起出現與收起。
const ui = $<HTMLDivElement>('ui');
const queueEl = $<HTMLElement>('queue');
const debugEl = $<HTMLPreElement>('debug');
let uiTimer = 0;
let hovering = false; // 滑鼠停在操作列或歌單上：不要收起來
let showQueue = readNum('wall_queue', 1) === 1;
let drag: number | null = null; // 正在拖進度條：放開後要跳到的時間
let lastSeekDraw = 0;
function showUi() {
  ui.classList.add('show');
  queueEl.classList.toggle('show', showQueue);
  document.body.classList.remove('idle');
  clearTimeout(uiTimer);
  uiTimer = window.setTimeout(hideUi, 3000);
}
function hideUi() {
  // 滑鼠還停在操作列／歌單上、或正在拖進度條：晚一點再收
  if (hovering || drag !== null) { uiTimer = window.setTimeout(hideUi, 1000); return; }
  ui.classList.remove('show');
  queueEl.classList.remove('show');
  document.body.classList.add('idle');
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const mmss = (x: number) => { const v = Math.max(0, Math.floor(x)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; };
const lenOf = (r: SongRow) => Math.max(0, (r.end_at || r.duration) - (r.start_at || 0));

/** 進度條：這首歌的播放範圍（後台剪掉的前奏尾奏不算），拖的時候畫拖到的位置。 */
function drawSeek() {
  const row = $('ui-seek');
  const on = !!cur && !silent;
  row.classList.toggle('off', !on);
  if (!on) return;
  const a = cur!.startAt, b = cur!.endAt, x = drag ?? t;
  const p = Math.max(0, Math.min(1, (x - a) / Math.max(0.1, b - a)));
  $('ui-fill').style.width = `${p * 100}%`;
  $('ui-knob').style.left = `${p * 100}%`;
  $('ui-t').textContent = mmss(x);
  $('ui-dur').textContent = mmss(b);
}

/** 歌單面板：現在播放、下一首、之後一整輪的待播清單（就是真的會播的順序）。 */
function renderQueue() {
  $('q-shuffle').textContent = shuffle ? '隨機播放：開' : '隨機播放：關';
  $('q-shuffle').classList.toggle('on', shuffle);
  $('q-reshuffle').hidden = !shuffle;
  const nowRow = cur && !silent ? cur.row : null;
  $('q-now').innerHTML = nowRow
    ? `<small>現在播放${order[pos]?.ins ? '（插播）' : ''}</small><b>${esc(nowRow.title)}</b><span>${esc(nowRow.artist)}</span>`
    : `<small>現在播放</small><b>${silent ? '歌單是空的：先無聲播放留言' : '—'}</b>`;
  if (!playlist.length || silent) { $('q-list').innerHTML = ''; return; }
  ensureAhead();
  // 一整輪（不含又輪回現在這首）加上插播的
  const count = insertsAhead() + Math.max(1, playlist.length - 1);
  $('q-list').innerHTML = order.slice(pos + 1, pos + 1 + count).map((e, k) => {
    const r = rowById(e.id);
    if (!r) return '';
    const j = pos + 1 + k, data = `data-j="${j}" data-id="${e.id}"`;
    return `<li class="${k === 0 ? 'next' : ''}${e.ins ? ' ins' : ''}">`
      + `<span class="q-no">${k === 0 ? '下一首' : k + 1}</span>`
      + `<span class="q-main"><b>${esc(r.title)}</b><small>${[r.artist && esc(r.artist), lenOf(r) > 0 && mmss(lenOf(r)), e.ins && '插播'].filter(Boolean).join(' · ') || '&nbsp;'}</small></span>`
      + `<span class="q-acts"><button type="button" data-act="now" ${data} title="馬上切過去，播完照原本的順序">現在播</button>`
      + (e.ins ? `<button type="button" data-act="cancel" ${data}>取消插播</button>`
        : k > 0 ? `<button type="button" data-act="ins" ${data} title="排在下一首（已經有插播的話排在它們後面），播完回到原本的順序">插播</button>` : '')
      + `</span></li>`;
  }).join('');
}
function toggleQueue(on = !showQueue) {
  showQueue = on;
  saveNum('wall_queue', on ? 1 : 0);
  queueEl.classList.toggle('show', on && ui.classList.contains('show'));
}
function setStatus(s: string, ok = true) { statusLine.text = s; statusLine.ok = ok; updateUi(); const g = document.getElementById('gate-status'); if (g) g.textContent = s; }
function updateUi() {
  const info = cur?.runtime.info;
  $('ui-song').textContent = silent ? '（歌單是空的：先無聲播放留言）' : info ? `${info.index}/${info.count}　${info.title}${info.artist ? ' — ' + info.artist : ''}` : '—';
  const nx = playlist.length && cur && !silent ? order[pos + 1] : undefined;
  const nxRow = nx ? rowById(nx.id) : undefined;
  $('ui-next').textContent = nxRow ? `下一首：${nxRow.title}${nx!.ins ? '（插播）' : ''}` : '';
  $('ui-vol').textContent = `${Math.round(player.volume * 100)}%`;
  $('ui-sync').textContent = `${player.offsetMs > 0 ? '+' : ''}${player.offsetMs} ms`;
  $('ui-play').textContent = playing ? '暫停' : '播放';
  $('ui-status').textContent = `留言 ${pool.count} 則　${statusLine.text}`;
  $('ui-status').classList.toggle('bad', !statusLine.ok);
  $('ui-queue-btn').classList.toggle('on', showQueue);
  renderQueue();
  drawSeek();
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
  on('ui-queue-btn', () => toggleQueue());
  for (const el of [ui, queueEl]) {
    el.addEventListener('pointerenter', () => { hovering = true; });
    el.addEventListener('pointerleave', () => { hovering = false; });
  }
  // 進度條：按下去就開始拖，拖的時候只畫位置，放開才真的跳過去（一路跳的話畫面會一直重排）
  const bar = $('ui-bar'), tip = $('ui-tip');
  const timeAt = (ev: PointerEvent) => {
    const r = bar.getBoundingClientRect(), p = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    return cur ? cur.startAt + p * (cur.endAt - cur.startAt) : 0;
  };
  const showTip = (ev: PointerEvent) => {
    if (!cur || silent) return;
    const r = bar.getBoundingClientRect();
    tip.hidden = false;
    tip.style.left = `${Math.max(0, Math.min(r.width, ev.clientX - r.left))}px`;
    tip.textContent = mmss(drag ?? timeAt(ev));
  };
  bar.addEventListener('pointerdown', (ev) => {
    if (!cur || silent) return;
    ev.preventDefault();
    bar.setPointerCapture(ev.pointerId);
    drag = timeAt(ev);
    bar.classList.add('drag');
    showTip(ev); drawSeek();
  });
  bar.addEventListener('pointermove', (ev) => {
    if (drag !== null) { drag = timeAt(ev); drawSeek(); showUi(); }
    showTip(ev);
  });
  const endDrag = (ev: PointerEvent, go: boolean) => {
    if (drag === null) return;
    const to = timeAt(ev);
    drag = null;
    bar.classList.remove('drag');
    if (go) seekTo(to);
    drawSeek();
  };
  bar.addEventListener('pointerup', (ev) => endDrag(ev, true));
  bar.addEventListener('pointercancel', (ev) => endDrag(ev, false));
  bar.addEventListener('pointerleave', () => { if (drag === null) tip.hidden = true; });
  // 歌單面板的按鈕；清單是照當下的順序畫的，按的時候確認那個位置還是同一首（中間剛好換歌就找它的新位置）
  queueEl.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest('button');
    if (!b) return;
    ev.stopPropagation();
    if (b.id === 'q-shuffle') setShuffle(!shuffle);
    else if (b.id === 'q-reshuffle') { rebuildAhead(); refreshNext(); }
    else if (b.id === 'q-close') toggleQueue(false);
    else if (!switching) {
      let j = Number(b.dataset.j);
      const id = Number(b.dataset.id);
      if (order[j]?.id !== id) j = order.findIndex((e, i) => i > pos && e.id === id);
      if (j > pos) {
        if (b.dataset.act === 'now') void playNow(j);
        else if (b.dataset.act === 'ins') insertAt(j);
        else if (b.dataset.act === 'cancel') cancelInsert(j);
      }
    }
    updateUi(); showUi();
  });
  on('ui-quality', () => { const s = Q.get('scale') === '0.75' ? '1' : '0.75'; Q.set('scale', s); location.search = Q.toString(); });
  $('ui-quality').textContent = Q.get('scale') === '0.75' ? '畫質：省電' : '畫質：高';
  window.addEventListener('mousemove', showUi);
  window.addEventListener('keydown', (ev) => {
    if ((ev.target as HTMLElement).tagName === 'INPUT') return;
    const k = ev.key;
    if (k === ' ') { ev.preventDefault(); togglePlay(); }
    else if (PREVIEW && (k === 'ArrowRight' || k === 'ArrowLeft')) setPreview(previewIdx + (k === 'ArrowRight' ? 1 : -1));
    else if (ev.shiftKey && !DEV && (k === 'ArrowRight' || k === 'ArrowLeft')) seekTo(t + (k === 'ArrowRight' ? 10 : -10));
    else if (k === 'ArrowRight' && !DEV) void nextSong();
    else if (k === 'ArrowLeft' && !DEV) void prevSong();
    else if (k === 'ArrowUp') setVolume(player.volume + 0.1);
    else if (k === 'ArrowDown') setVolume(player.volume - 0.1);
    else if (k === 'f' || k === 'F') toggleFull();
    else if (k === '[') setSync(player.offsetMs - 20);
    else if (k === ']') setSync(player.offsetMs + 20);
    else if (k === 'd' || k === 'D') debugEl.hidden = !debugEl.hidden;
    else if (k === 'l' || k === 'L') toggleQueue();
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
    <p class="gate-sub">按「開始播放」後會進入全螢幕。滑鼠移動會出現操作列：進度條（可以拖拉）、上一首／下一首、歌單（插播、隨機播放）、音量、音畫同步。<br/>空白鍵暫停、F 全螢幕、Shift＋← → 倒退／快轉 10 秒、L 歌單、↑↓ 音量、[ ] 音畫同步。</p>
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
  if (playlist.length) {
    setStatus(`歌單 ${playlist.length} 首，準備第一首…`);
    initOrder(want || undefined);
    await transition(async () => { pos = 0; await playPos(); });
    setStatus('準備好了');
  }
  else startSilent();
  showStart();
  requestAnimationFrame(tick);
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre class="fatal">${String((e as Error)?.stack ?? e)}</pre>`);
  window.__wall = { error: String((e as Error)?.stack ?? e) };
});

