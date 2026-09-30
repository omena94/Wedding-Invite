// 大螢幕歌單（2026-09-28）：新人自己加歌、刪歌、排順序；每首歌上傳後在這台電腦上分析節拍、自動找歌詞（LRCLIB），
// 找不到或時間不準的，在「編輯」裡貼 LRC、上傳 .lrc 檔，或邊聽邊按空白鍵逐句對時；某一句的字亮得跟歌聲對不上，
// 在歌詞清單按那句的「對字」邊聽邊按（存成加強版 LRC 的 <mm:ss.xx>，沒修的句子照舊自動推算）；
// 某句出來太晚／太早就點它按「開頭提早／延後」，好幾句一起移用 Shift 選起來。整首對好了勾「歌詞對好了」，歌單上才分得出還要修哪幾首。
// 大螢幕照這裡的順序播（停用的跳過），播到哪一首的配色、剪掉的前奏尾奏也在這裡設。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, CloudUpload, FileText, Monitor, Music, Pause, Pencil, Play, RefreshCw, Search, Square, Trash2, Type, Undo2, Wand2 } from "lucide-react";
import {
  deleteWallSong, fetchWallSongAnalysis, fetchWallSongAudio, fetchWallSongs, reorderWallSongs, saveWallSongAnalysis, updateWallSong, uploadWallSong,
} from "../api.js";
import Toggle, { Checkbox } from "../components/Toggle.jsx";
import Select from "../components/Select.jsx";
import { Empty, ErrorBox, Loading, Modal, NumberInput, confirmAsk, confirmDelete, toastErr, toastOk, useLoader } from "./ui.jsx";
import { analyzeFile, ANALYSIS_VERSION } from "../wall/analysis/client";
import { halveTempo, doubleTempo } from "../wall/analysis/tempo";
import { searchLyrics } from "../wall/lyrics/lrclib";
import { parseLrc, toLrc, fmtTime, isSynced, sourceRows } from "../wall/lyrics/lrc";
import { buildLyrics, lyricUnits } from "../wall/lyrics/build";
import { AudioData } from "../wall/engine/audio";
import { Lyrics } from "../wall/engine/lyrics";
import { THEMES } from "../wall/themes";

// .lrc 也可以一起選：跟音檔同名就自動當那首歌的歌詞
const AUDIO_ACCEPT = "audio/*,video/mp4,.mp3,.m4a,.aac,.wav,.ogg,.flac,.opus,.mp4,.m4v,.mov,.lrc";
const THEME_OPTIONS = [{ value: "", label: "自動（依歌的快慢挑）" }, ...THEMES.map((t) => ({ value: t.key, label: t.label }))];
const clip = (s, n = 12) => (s.length > n ? `${s.slice(0, n)}…` : s);
const mmss = (s) => (s > 0 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "—");

/**
 * 歌詞狀態：純音樂／新人標了「對好了」／已對時但還沒確認／有歌詞但沒時間／沒歌詞。
 * 「對好了」是新人自己標的（2026-09-30）：有時間軸不代表對得準，歌單上要分得出哪幾首不用再修。
 */
function lyricsState(s) {
  if (s.instrumental) return { kind: "inst", label: "純音樂", pill: "pill-groom" };
  if (!s.lyrics_lrc) return { kind: "missing", label: "還沒有歌詞", pill: "pill-warn" };
  const doc = parseLrc(s.lyrics_lrc);
  if (!isSynced(doc)) return { kind: "missing", label: "歌詞還沒對時", pill: "pill-warn" };
  const n = doc.lines.filter((l) => l.text).length;
  if (s.lyrics_done) return { kind: "done", label: `✓ 歌詞對好了（${n} 行）`, pill: "pill-yes" };
  return { kind: "ok", label: `歌詞 ${n} 行・還沒確認`, pill: "pill-groom" };
}

/** LRCLIB 候選裡「可以直接套用」的：純音樂，或有時間軸、長度跟音檔差 3 秒內（版本不同時間會對不上）。 */
const usable = (list) => list.find((c) => c.instrumental || (c.syncedLyrics && Number.isFinite(c.diff) && c.diff <= 3)) || null;
const lyricsFrom = (c) => (c.instrumental ? { instrumental: true, lyrics_source: "lrclib" } : { lyrics_lrc: c.syncedLyrics, lyrics_source: "lrclib", lyrics_offset: 0 });

const stemOf = (name) => name.replace(/\.[^.]+$/, "");
// 檔名不能有「/」，下載的歌常把它換成「_」（24_7 → 24/7）；只換數字中間的，Love_Story 這種不動
const tidy = (s) => s.replace(/(\d)_(\d)/g, "$1/$2").replace(/\s+/g, " ").trim();

/**
 * 檔名「A - B」：有人取「歌手 - 歌名」、有人取「歌名 - 歌手」。兩種順序都拿去 LRCLIB 找，
 * 哪一種找得到能用的時間軸歌詞就是哪一種；都找不到就當「歌名 - 歌手」。順便回傳找到的歌詞。
 */
async function guessSong(fileName, duration) {
  const parts = stemOf(fileName).split(" - ");
  const a = tidy(parts[0] || ""), b = tidy(parts.slice(1).join(" - "));
  const tryOrder = async (title, artist) => { try { return usable(await searchLyrics(title, artist, duration)); } catch { return null; } };
  if (!b) return { title: a, artist: "", cand: await tryOrder(a, "") };
  const asTitleFirst = await tryOrder(a, b);
  if (asTitleFirst) return { title: a, artist: b, cand: asTitleFirst };
  const asArtistFirst = await tryOrder(b, a);
  if (asArtistFirst) return { title: b, artist: a, cand: asArtistFirst };
  return { title: a, artist: b, cand: null };
}

export default function WallSongs() {
  const { data, setData, loading, error, reload } = useLoader(fetchWallSongs, []);
  const [jobs, setJobs] = useState({}); // id 或暫時的 key → 進度文字
  const [editing, setEditing] = useState(null);
  const [playing, setPlaying] = useState(null); // 試聽中的歌 id
  const [lyf, setLyf] = useState(""); // 歌詞篩選："" 全部／done 對好了／ok 還沒確認／missing／inst
  const fileRef = useRef(null);
  const audioRef = useRef(null);
  const urlRef = useRef("");
  const items = data?.items || [];

  const setJob = (k, v) => setJobs((j) => { const n = { ...j }; if (v) n[k] = v; else delete n[k]; return n; });
  const replace = (s) => setData((d) => ({ ...d, items: d.items.map((x) => (x.id === s.id ? s : x)) }));

  // 一次選好幾個檔：一首一首處理（同時做會把電腦的 CPU 吃滿）。同名的 .lrc 一起選的話，直接當那首歌的歌詞。
  // 順序：先在這台電腦分析（讀不出聲音的檔就不用上傳了）→ 猜歌名歌手、找歌詞 → 上傳 → 存分析與歌詞
  const upload = async (files) => {
    const all = Array.from(files || []);
    if (fileRef.current) fileRef.current.value = "";
    const lrcs = new Map(all.filter((f) => /\.lrc$/i.test(f.name)).map((f) => [stemOf(f.name).toLowerCase(), f]));
    const audios = all.filter((f) => !/\.lrc$/i.test(f.name));
    if (!audios.length && lrcs.size) toastErr(new Error("只選到 .lrc：請跟音檔一起選，或到那首歌的「編輯」上傳歌詞"));
    for (const file of audios) {
      const key = `up-${file.name}-${file.size}`;
      try {
        setJob(key, `分析「${file.name}」…`);
        const json = await analyzeFile(file, (p, label) => setJob(key, `分析「${file.name}」：${label} ${Math.round(p * 100)}%`));
        const lrcFile = lrcs.get(stemOf(file.name).toLowerCase());
        setJob(key, lrcFile ? `讀取歌詞檔…` : `找歌詞…`);
        const guess = await guessSong(file.name, json.duration);
        setJob(key, `上傳「${file.name}」…`);
        const song = await uploadWallSong(file, { title: guess.title, artist: guess.artist });
        setJob(key, null);
        setData((d) => ({ ...d, items: [...(d?.items || []), song] }));
        setJob(song.id, "儲存分析…");
        let saved = await saveWallSongAnalysis(song.id, { version: ANALYSIS_VERSION, duration: json.duration, bpm: json.bpm, data: json });
        const ly = lrcFile ? { lyrics_lrc: await lrcFile.text(), lyrics_source: "manual", lyrics_offset: 0 } : guess.cand ? lyricsFrom(guess.cand) : null;
        if (ly) saved = await updateWallSong(song.id, ly);
        replace(saved);
        setJob(song.id, null);
      } catch (e) {
        setJob(key, null);
        toastErr(e);
      }
    }
    reload();
  };

  const move = async (idx, d) => {
    const ids = items.map((s) => s.id);
    const j = idx + d;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    setData((x) => ({ ...x, items: ids.map((id) => x.items.find((s) => s.id === id)) }));
    try { setData(await reorderWallSongs(ids)); } catch (e) { toastErr(e); reload(); }
  };
  const toggle = async (s, enabled) => { try { replace(await updateWallSong(s.id, { enabled })); } catch (e) { toastErr(e); } };
  const remove = async (s) => {
    if (!(await confirmDelete(`「${s.title}」`))) return;
    try { await deleteWallSong(s.id); setData((d) => ({ ...d, items: d.items.filter((x) => x.id !== s.id) })); } catch (e) { toastErr(e); }
  };

  // 試聽：音檔要登入才拿得到，先抓成 blob
  const stopPreview = useCallback(() => {
    audioRef.current?.pause();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = "";
    setPlaying(null);
  }, []);
  const preview = async (s) => {
    if (playing === s.id) return stopPreview();
    stopPreview();
    try {
      setJob(s.id, "讀取音檔…");
      const blob = await fetchWallSongAudio(s.id);
      setJob(s.id, null);
      urlRef.current = URL.createObjectURL(blob);
      const a = audioRef.current;
      a.src = urlRef.current;
      a.currentTime = s.start_at || 0;
      await a.play();
      setPlaying(s.id);
    } catch (e) { setJob(s.id, null); toastErr(e); }
  };
  useEffect(() => stopPreview, [stopPreview]);

  const total = items.filter((s) => s.enabled).reduce((sum, s) => sum + Math.max(0, (s.end_at || s.duration) - (s.start_at || 0)), 0);
  // 歌詞狀態統計：一眼看出還有幾首要處理（2026-09-28 新人要求）
  const states = items.map((s) => lyricsState(s).kind);
  const count = (kind) => states.filter((k) => k === kind).length;
  const nDone = count("done"), nOk = count("ok"), nMissing = count("missing"), nInst = count("inst");
  const shown = items.map((s, idx) => ({ s, idx })).filter(({ s }) => !lyf || lyricsState(s).kind === lyf);
  // 缺歌詞的歌全部再上 LRCLIB 找一次（歌名、歌手兩種順序都試；找到能用的才套用）
  const retryAll = async () => {
    const todo = items.filter((s) => lyricsState(s).kind === "missing");
    let found = 0;
    for (const s of todo) {
      setJob(s.id, "找歌詞…");
      try {
        const tryOrder = async (t, a) => { try { return usable(await searchLyrics(t, a, s.duration)); } catch { return null; } };
        const c = (await tryOrder(s.title, s.artist)) || (s.artist ? await tryOrder(s.artist, s.title) : null);
        if (c) { replace(await updateWallSong(s.id, lyricsFrom(c))); found++; }
      } catch (e) { toastErr(e); }
      setJob(s.id, null);
    }
    toastOk(found ? `找到 ${found} 首，還有 ${todo.length - found} 首要自己處理` : "這次都沒找到，請到各首的「編輯」貼歌詞或上傳 .lrc");
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="panel-title"><Music size={18} /> 大螢幕歌單</div>
        <div className="toolbar">
          <span className="helper-text" style={{ margin: 0 }}>{items.filter((s) => s.enabled).length} 首、共 {Math.round(total / 60)} 分鐘</span>
          <input ref={fileRef} type="file" accept={AUDIO_ACCEPT} multiple hidden onChange={(e) => upload(e.target.files)} />
          <button type="button" className="btn btn-primary btn-sm" onClick={() => fileRef.current?.click()}><CloudUpload size={14} /> 上傳音檔</button>
        </div>
      </div>
      <p className="helper-text" style={{ marginTop: -6, marginBottom: 14 }}>
        每首歌上傳 mp3／m4a（影片 mp4 也可以，只取聲音），檔名取「歌名 - 歌手」（或「歌手 - 歌名」，系統會自己判斷）；有 .lrc 歌詞檔的話，跟音檔同名、一起選就好。上傳後會在這台電腦分析節拍、上網找有時間軸的歌詞；
        找不到或時間不準的，按「編輯」處理。大螢幕依這裡的順序播放，關掉的歌會跳過。
      </p>
      <audio ref={audioRef} onEnded={stopPreview} hidden />
      {items.length > 0 && (
        <div className="ws-summary">
          {[["", `全部 ${items.length}`], ["done", `對好了 ${nDone}`], ["ok", `還沒確認 ${nOk}`], ["missing", `缺歌詞 ${nMissing}`], ["inst", `純音樂 ${nInst}`]].map(([k, label]) => (
            <button key={k} type="button" className={`btn btn-sm ${lyf === k ? "btn-primary" : "btn-ghost"}`} onClick={() => setLyf(k)}>{label}</button>
          ))}
          {nMissing > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={retryAll}><Search size={13} /> 缺歌詞的全部再找一次</button>}
        </div>
      )}
      {Object.entries(jobs).filter(([k]) => String(k).startsWith("up-")).map(([k, v]) => <div key={k} className="ws-job">{v}</div>)}
      {error ? <ErrorBox error={error} /> : loading ? <Loading /> : items.length === 0 ? (
        <Empty>還沒有歌。按「上傳音檔」一次選好幾首；沒有歌的時候大螢幕會先安靜地播留言。</Empty>
      ) : (
        <ul className="ws-list">
          {shown.map(({ s, idx }) => {
            const ls = lyricsState(s);
            const job = jobs[s.id];
            return (
              <li key={s.id} className={`ws-row${s.enabled ? "" : " off"}`}>
                <div className="ws-order">
                  <button className="btn btn-ghost btn-sm" title="往上" disabled={idx === 0} onClick={() => move(idx, -1)}><ArrowUp size={13} /></button>
                  <button className="btn btn-ghost btn-sm" title="往下" disabled={idx === items.length - 1} onClick={() => move(idx, 1)}><ArrowDown size={13} /></button>
                </div>
                <div className="ws-no">{String(idx + 1).padStart(2, "0")}</div>
                <div className="ws-main">
                  <div className="ws-title">{s.title || s.original_name}</div>
                  <div className="ws-meta">
                    {s.artist && <span>{s.artist}</span>}
                    <span>{mmss(s.duration)}</span>
                    {s.bpm > 0 && <span>{Math.round(s.bpm)} BPM</span>}
                    {(s.start_at > 0 || s.end_at > 0) && <span>播 {mmss(s.start_at || 0.01)}～{mmss(s.end_at || s.duration)}</span>}
                    <span className={`pill ${ls.pill}`}>{ls.label}</span>
                    {!s.has_analysis && !job && <span className="pill pill-warn">還沒分析</span>}
                    {s.theme && <span className="pill pill-groom">{THEMES.find((t) => t.key === s.theme)?.label}</span>}
                    {job && <span className="ws-jobtag">{job}</span>}
                  </div>
                </div>
                <div className="ws-actions">
                  <label className="wall-msg-toggle"><Toggle checked={s.enabled} onChange={(v) => toggle(s, v)} label="要播" /> 要播</label>
                  <button className="btn btn-ghost btn-sm" title={playing === s.id ? "停止" : "試聽"} onClick={() => preview(s)}>{playing === s.id ? <Pause size={13} /> : <Play size={13} />}</button>
                  <button className="btn btn-ghost btn-sm" title="從這首開始在大螢幕播（新分頁）" onClick={() => window.open(`/wall?song=${s.id}`, "_blank")}><Monitor size={13} /></button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditing(s)}><Pencil size={13} /> 編輯</button>
                  <button className="btn btn-ghost btn-sm" title="刪除" onClick={() => remove(s)}><Trash2 size={13} /></button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {editing && <SongEditor song={editing} onClose={() => setEditing(null)} onSaved={(s) => { replace(s); setEditing(null); }} onPatched={replace} />}
    </div>
  );
}

// ---------------------------------------------------------------- 編輯一首歌
function SongEditor({ song, onClose, onSaved, onPatched }) {
  const [form, setForm] = useState({
    title: song.title, artist: song.artist, theme: song.theme || "", instrumental: !!song.instrumental,
    start_at: Math.round(song.start_at || 0), end_at: song.end_at ? Math.round(song.end_at) : "",
    lyrics_lrc: song.lyrics_lrc || "", lyrics_source: song.lyrics_source || "", lyrics_offset: song.lyrics_offset || 0,
    lyrics_done: !!song.lyrics_done,
  });
  const [busy, setBusy] = useState("");
  const [cands, setCands] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [blobUrl, setBlobUrl] = useState("");
  const lrcFile = useRef(null);
  // LRC 原文：只有還沒有歌詞（要貼）時預設打開。已經有歌詞的都收起來：對好時間的，播放器與歌詞清單才不會被擠到視窗最下面；
  // 還沒時間的，「開始逐句對時」的提示才會在打開視窗時就看得到（新人 2026-09-29 找不到下一步）
  const [showLrc, setShowLrc] = useState(() => !song.lyrics_lrc?.trim());
  const [saveNote, setSaveNote] = useState("");
  // 對字、逐句對時、提早延後、自動、復原改的歌詞直接存（新人不想每改一句就滑到最下面按儲存，按了視窗還會關掉）。
  // 一次只送一個：連按好幾下「延後」時，同時送出的請求可能後發先到，把舊的歌詞蓋回去；排隊、只送最新的那份。
  const saveQ = useRef({ busy: false, next: null });
  const commitLrc = async (lrc) => {
    setForm((f) => ({ ...f, lyrics_lrc: lrc, lyrics_source: "manual", instrumental: false }));
    const q = saveQ.current;
    q.next = lrc;
    if (q.busy) return;
    q.busy = true;
    setSaveNote("儲存中…");
    let ok = false;
    while (q.next !== null) {
      const body = q.next;
      q.next = null;
      try {
        onPatched?.(await updateWallSong(song.id, { lyrics_lrc: body, lyrics_source: "manual", instrumental: false }));
        ok = true;
      } catch (e) { ok = false; toastErr(e); }
    }
    q.busy = false;
    setSaveNote(ok ? `已自動儲存（${new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}）` : "");
  };
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  // 「歌詞對好了」也是按了就存，歌單上馬上分得出哪幾首不用再修（新人 2026-09-30）
  const markDone = async (v) => {
    set("lyrics_done", v);
    try {
      onPatched?.(await updateWallSong(song.id, { lyrics_done: v }));
      toastOk(v ? "已標記：這首歌詞對好了" : "改回：這首還要再修");
    } catch (e) { set("lyrics_done", !v); toastErr(e); }
  };
  const timedNow = useMemo(() => { try { return isSynced(parseLrc(form.lyrics_lrc)); } catch { return false; } }, [form.lyrics_lrc]);

  // 歌詞清單選到的句子在 LRC 原文標亮；點一句時原文捲到那一行（新人 2026-09-30：選到歌詞時上面的原文也要跳到那行）
  const [selLines, setSelLines] = useState([]);
  const [jump, setJump] = useState(null); // { line }：每點一次換一個物件，同一句再點一次也會捲
  const srcRows = useMemo(() => { try { return sourceRows(form.lyrics_lrc); } catch { return []; } }, [form.lyrics_lrc]);
  const rowOf = (l) => {
    const hits = srcRows.filter((x) => Math.abs(x.t - l.t) < 0.005);
    return (hits.find((x) => x.text === l.text) || hits[0])?.row ?? -1;
  };
  const marks = [...new Set(selLines.map(rowOf).filter((r) => r >= 0))];

  // 分析（BPM、拍點）與音檔：對時、預覽都要用
  useEffect(() => {
    let alive = true, url = "";
    fetchWallSongAnalysis(song.id).then((a) => { if (alive) setAnalysis(a); }).catch(() => {});
    fetchWallSongAudio(song.id).then((b) => { if (!alive) return; url = URL.createObjectURL(b); setBlobUrl(url); }).catch(() => {});
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [song.id]);

  const save = async () => {
    setBusy("save");
    try {
      const out = await updateWallSong(song.id, { ...form, start_at: Number(form.start_at) || 0, end_at: Number(form.end_at) || 0, lyrics_offset: Number(form.lyrics_offset) || 0 });
      toastOk("已儲存");
      onSaved(out);
    } catch (e) { toastErr(e); } finally { setBusy(""); }
  };

  const find = async () => {
    setBusy("find");
    try {
      const list = await searchLyrics(form.title, form.artist, analysis?.duration ?? song.duration);
      setCands(list);
    } catch (e) { toastErr(e); } finally { setBusy(""); }
  };
  const pickCand = (c) => {
    if (c.instrumental) { setForm((f) => ({ ...f, instrumental: true, lyrics_source: "lrclib" })); setCands(null); return; }
    setForm((f) => ({ ...f, lyrics_lrc: c.syncedLyrics || c.plainLyrics, lyrics_source: "lrclib", lyrics_offset: 0, instrumental: false }));
    setCands(null);
    if (!c.syncedLyrics) toastOk("這份沒有時間，請用下面的「逐句對時」");
  };
  const loadLrcFile = async (file) => {
    if (!file) return;
    const text = await file.text();
    setForm((f) => ({ ...f, lyrics_lrc: text, lyrics_source: "manual", instrumental: false }));
    if (lrcFile.current) lrcFile.current.value = "";
  };

  const reanalyze = async () => {
    setBusy("analyze");
    try {
      const blob = await fetchWallSongAudio(song.id);
      const json = await analyzeFile(blob, (p, label) => setBusy(`analyze:${label} ${Math.round(p * 100)}%`));
      await saveWallSongAnalysis(song.id, { version: ANALYSIS_VERSION, duration: json.duration, bpm: json.bpm, data: json });
      setAnalysis({ version: ANALYSIS_VERSION, duration: json.duration, bpm: json.bpm, data: json });
      toastOk(`重新分析好了：${Math.round(json.bpm)} BPM`);
    } catch (e) { toastErr(e); } finally { setBusy(""); }
  };
  const fixTempo = async (fn) => {
    if (!analysis?.data) return;
    const data = fn(analysis.data);
    try {
      await saveWallSongAnalysis(song.id, { version: analysis.version, duration: data.duration, bpm: data.bpm, data });
      setAnalysis({ ...analysis, bpm: data.bpm, data });
      toastOk(`改成 ${Math.round(data.bpm)} BPM`);
    } catch (e) { toastErr(e); }
  };

  const bpm = analysis?.data?.bpm ?? song.bpm;
  return (
    <Modal title={`編輯歌曲：${song.title || song.original_name}`} onClose={onClose} wide className="ws-editor"
      footer={<><button className="btn btn-ghost" onClick={onClose}>取消</button><button className="btn btn-primary" disabled={!!busy} onClick={save}>{busy === "save" ? "儲存中…" : "儲存"}</button></>}>
      <div className="grid-2">
        <div className="form-group"><label>歌名</label><input type="text" value={form.title} onChange={(e) => set("title", e.target.value)} /></div>
        <div className="form-group"><label>歌手</label><input type="text" value={form.artist} onChange={(e) => set("artist", e.target.value)} /></div>
      </div>
      <div className="grid-2">
        <div className="form-group"><label>配色</label><Select value={form.theme} onChange={(v) => set("theme", v)} options={THEME_OPTIONS} /><div className="helper-text">自動會避開上一首的顏色。</div></div>
        <div className="form-group"><label>播放範圍（秒）</label>
          <div className="ws-range"><span>從</span><NumberInput value={form.start_at} onChange={(v) => set("start_at", v)} /><span>到</span><NumberInput value={form.end_at} onChange={(v) => set("end_at", v)} placeholder="整首" /></div>
          <div className="helper-text">前奏、尾奏太長可以剪掉；結束填 0 就是播到最後。整首 {mmss(song.duration)}。</div>
        </div>
      </div>
      <div className="form-group">
        <label>節拍</label>
        <div className="ws-tempo">
          <span className="ws-bpm">{bpm ? `${Math.round(bpm)} BPM` : "還沒分析"}</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!analysis?.data} onClick={() => fixTempo(halveTempo)}>速度減半</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!analysis?.data} onClick={() => fixTempo(doubleTempo)}>速度加倍</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={reanalyze}><RefreshCw size={13} /> {busy.startsWith("analyze") ? busy.slice(8) || "分析中…" : "重新分析"}</button>
        </div>
        <div className="helper-text">慢歌偶爾會被聽成兩倍速（畫面切得太急），按「速度減半」；快歌被聽成一半就按「加倍」。</div>
      </div>

      <div className="form-group">
        {/* 不用 <label>：label 裡面有按鈕時，點「歌詞（LRC）」這幾個字會按到第一個開關 */}
        <div className="ws-lyrics-head">
          <span>歌詞（LRC）</span>
          <span className="ws-lyrics-tools">
            {!form.instrumental && (
              <span title={timedNow ? "標了之後歌單上會顯示「歌詞對好了」，下次就知道這首不用再修" : "歌詞要先有時間（對好時）才能標"}>
                <Checkbox checked={form.lyrics_done} disabled={!timedNow} onChange={markDone}>歌詞對好了</Checkbox>
              </span>
            )}
            <label className="wall-msg-toggle"><Toggle checked={form.instrumental} onChange={(v) => set("instrumental", v)} label="純音樂" /> 純音樂（不顯示歌詞）</label>
          </span>
        </div>
        {!form.instrumental && <>
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={find}><Search size={13} /> {busy === "find" ? "找歌詞中…" : "自動找歌詞"}</button>
            <input ref={lrcFile} type="file" accept=".lrc,.txt,text/plain" hidden onChange={(e) => loadLrcFile(e.target.files?.[0])} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => lrcFile.current?.click()}><FileText size={13} /> 上傳 .lrc 檔</button>
            <button type="button" className={`btn btn-sm ${showLrc ? "btn-primary" : "btn-ghost"}`} onClick={() => setShowLrc((v) => !v)}><Pencil size={13} /> {showLrc ? "收起 LRC 原文" : "編輯 LRC 原文"}</button>
            <span className="helper-text" style={{ margin: 0 }}>來源：{form.lyrics_source === "lrclib" ? "LRCLIB 自動找到" : form.lyrics_source === "manual" ? "自己貼的／對的" : "—"}</span>
          </div>
          {cands && (
            <div className="ws-cands">
              {cands.length === 0 ? <div className="helper-text">找不到，請貼上歌詞或上傳 .lrc 檔。</div> : cands.map((c) => (
                <div key={c.id} className="ws-cand">
                  <div>
                    <div className="ws-cand-title">{c.trackName} <span className="muted-cell">— {c.artistName}</span></div>
                    <div className="helper-text" style={{ margin: 0 }}>{c.albumName} · {mmss(c.duration)}{Number.isFinite(c.diff) ? `（跟音檔差 ${Math.round(c.diff)} 秒${c.diff > 3 ? "，可能是不同版本" : ""}）` : ""} · {c.instrumental ? "純音樂" : c.syncedLyrics ? "有時間軸" : "沒有時間"}</div>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => pickCand(c)}>用這個</button>
                </div>
              ))}
            </div>
          )}
          {showLrc && <LrcText value={form.lyrics_lrc} marks={marks} jumpKey={jump} jumpRow={jump ? rowOf(jump.line) : -1}
            onChange={(v) => setForm((f) => ({ ...f, lyrics_lrc: v, lyrics_source: "manual" }))} />}
          <LyricSync lrc={form.lyrics_lrc} offset={Number(form.lyrics_offset) || 0} blobUrl={blobUrl} analysis={analysis?.data}
            onLrc={(lrc) => setForm((f) => ({ ...f, lyrics_lrc: lrc, lyrics_source: "manual" }))} onCommit={commitLrc} saveNote={saveNote}
            onTapStart={() => setShowLrc(false)}
            onOffset={(o) => set("lyrics_offset", Math.round(o * 100) / 100)}
            onSelLines={setSelLines} onPick={(line) => setJump({ line })} />
        </>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- LRC 原文
/**
 * LRC 原文的輸入框。歌詞清單選到的句子在這裡標亮，點清單的一句時捲到那一行（marks、jumpRow 是原文的第幾行）。
 * 不把游標移進來：移進來的話，之後按空白鍵或 ⌫ 會直接改到歌詞。
 * 不自動換行（太長就左右捲），每一行一樣高，標亮的位置才算得準。
 */
function LrcText({ value, onChange, marks, jumpKey, jumpRow }) {
  const box = useRef(null);
  const [scroll, setScroll] = useState(0);
  const [m, setM] = useState({ lh: 21, pad: 13, bw: 1.5, sbv: 0, sbh: 0 });
  // 行高、內距、捲軸寬度從實際樣式量（字型、捲軸寬度每台電腦不一樣）
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const bw = parseFloat(cs.borderTopWidth) || 0;
    const next = {
      lh: parseFloat(cs.lineHeight) || 21, pad: parseFloat(cs.paddingTop) || 0, bw,
      sbv: Math.max(0, el.offsetWidth - el.clientWidth - 2 * bw), sbh: Math.max(0, el.offsetHeight - el.clientHeight - 2 * bw),
    };
    if (Object.keys(next).some((k) => Math.abs(next[k] - m[k]) > 0.1)) setM(next);
  });
  const centerOn = (row) => {
    const el = box.current;
    if (el && row >= 0) el.scrollTo({ top: Math.max(0, m.pad + row * m.lh - el.clientHeight / 2 + m.lh / 2), behavior: "smooth" });
  };
  useEffect(() => { if (jumpKey) centerOn(jumpRow); }, [jumpKey]);
  // 打開原文時，已經有選起來的句子就捲到第一句
  useEffect(() => { if (marks.length) centerOn(Math.min(...marks)); }, []);
  return (
    <div className="ws-lrc-wrap">
      <textarea ref={box} rows={8} className="ws-lrc" value={value} spellCheck={false}
        placeholder={"[00:12.50]第一句歌詞\n[00:16.20]第二句歌詞\n…\n（也可以先貼沒有時間的歌詞，再用下面的「逐句對時」）"}
        onScroll={(e) => setScroll(e.currentTarget.scrollTop)} onChange={(e) => onChange(e.target.value)} />
      <div className="ws-lrc-marks" style={{ top: m.bw, left: m.bw, right: m.bw + m.sbv, bottom: m.bw + m.sbh }}>
        {marks.map((row) => <div key={row} className="ws-lrc-mark" style={{ top: m.pad + row * m.lh - scroll, height: m.lh }} />)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 預覽、逐句對時、逐字對時
/**
 * 邊聽邊看歌詞，跟大螢幕同一套時間規則：上面是現在唱到的那一句（大字），下面是整首歌詞清單，每一句都照大螢幕的時間逐字亮。
 * 新人要能「看著亮的樣子」快速修，不用手打時間（2026-09-28）：
 * - 清單點一句 → 從那句前一點開始播。
 * - 某一句的字亮得跟歌聲對不上 → 按那句的「對字」：每個字（或自己切的每一段）開始唱時按一下空白鍵，最後一個字唱完再按一下。
 *   存成加強版 LRC（[時間]<時間>字<時間>字…<結束時間>），整句照樣一起顯示，只是每個字亮的時間照按的；其他句子照舊自動推算。
 *   套用後馬上從那句前面重播，不滿意可以「復原」。
 * - 逐句對時：整首還沒有時間時用，每句開始唱的那一刻按空白鍵。
 * - 提早／延後（2026-09-30）：秒數自己填；可以整首移，也可以只移選起來的幾句（Shift 選一段、Ctrl 加選），字的逐字時間跟著移。
 * 人按鍵通常慢一點點，所以記的時間自動往前 0.12 秒（放慢播放時換算成音檔時間）。
 */
function LyricSync({ lrc, offset, blobUrl, analysis, onLrc, onCommit, saveNote, onOffset, onTapStart, onSelLines, onPick }) {
  const audio = useRef(null);
  const listRef = useRef(null);
  const syncRef = useRef(null);
  const commit = onCommit || onLrc; // 用工具改的歌詞（對字、逐句對時、自動、復原）直接存
  const [focus, setFocus] = useState(null); // 剛剛點的／改的那一句（清單會捲回來、框起來）
  const stopAt = useRef(null); // 播到這個音檔時間自動停（null = 一直播）
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [paused, setPaused] = useState(true);
  const [tap, setTap] = useState(null); // 逐句對時中：{ lines, cursor }
  const [wt, setWt] = useState(null); // 逐字對時中：{ idx, t, text, units:[{w,pos}], cuts:[bool], times:[], phase:'setup'|'tap'|'done' }
  const [rate, setRateState] = useState(1);
  const [undo, setUndo] = useState([]); // 每次用工具改之前的歌詞，「復原上一步」一次退一步（連按好幾下延後也能一下一下退回去）
  const pushUndo = () => setUndo((u) => [...u.slice(-29), lrc]);
  const [sel, setSel] = useState(() => new Set()); // 選起來的句子（doc.lines 的位置）：一起提早／延後，LRC 原文也會標亮
  const anchor = useRef(null); // Shift 選一段時的起點（上一次點的那句）
  // 每次提早／延後幾秒：新人自己填（2026-09-30），記在這台電腦，下次打開還是一樣
  const [stepText, setStepText] = useState(() => { try { return localStorage.getItem("ws-shift-step") || "0.1"; } catch { return "0.1"; } });
  const step = Math.round(Math.min(30, Math.max(0.01, Number(stepText) || 0.1)) * 100) / 100;
  useEffect(() => { try { localStorage.setItem("ws-shift-step", String(step)); } catch { /* 無痕視窗等存不了，下次就回到 0.1 */ } }, [step]);
  const REACT = 0.12;

  const au = useMemo(() => (analysis ? new AudioData(analysis) : AudioData.silent(600, 100)), [analysis]);
  const lyrics = useMemo(() => { try { return buildLyrics(lrc, au, offset); } catch { return Lyrics.empty(); } }, [lrc, au, offset]);
  const doc = useMemo(() => { try { return parseLrc(lrc); } catch { return { lines: [], meta: {} }; } }, [lrc]);
  // 清單的每一句（LRC 的一行）對到算好時間的歌詞行：用開始時間對（空白行、沒有字的行不會出現在大螢幕上）
  const rows = useMemo(() => doc.lines.map((l, i) => {
    if (!l.text || !Number.isFinite(l.t)) return null;
    const s0 = (l.words?.find((w) => w.w.trim())?.t ?? l.t) + offset;
    return { i, l, line: lyrics.lines.find((x) => Math.abs(x.start - s0) < 0.02) || null };
  }).filter(Boolean), [doc, lyrics, offset]);
  // 選起來的句子（歌詞在 LRC 原文被改過、那句不見了的就不算）；告訴外面，LRC 原文才標得出來
  const selRows = useMemo(() => rows.filter((r) => sel.has(r.i)), [rows, sel]);
  useEffect(() => { onSelLines?.(selRows.map((r) => r.l)); }, [selRows]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const a = audio.current;
      if (a) {
        setT(a.currentTime);
        // 只播一句的時候（對字、點清單的一句、套用後重播）：唱完這句就停，不要一路播下去
        if (stopAt.current !== null && a.currentTime >= stopAt.current) { a.pause(); stopAt.current = null; }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const setRate = (r) => { setRateState(r); if (audio.current) audio.current.playbackRate = r; };
  // 播放器的播放鍵與進度條：整首一直播
  const play = () => { const a = audio.current; if (!a) return; stopAt.current = null; if (a.paused) a.play(); else a.pause(); };
  const seek = (x) => { const a = audio.current; if (a) a.currentTime = Math.max(0, Math.min(dur || a.duration || 0, x)); };
  /**
   * 某一句的播放範圍（音檔時間）＝ LRC 上這句的時間到下一句的時間（新人要求：例如 00:13.939～00:16.592，前後都不多播）。
   * 最後一句沒有下一句：播到算出來的結尾（end）後 1 秒；下一句隔很久（間奏）最多播 15 秒。
   */
  const lineSpan = (idx, end) => {
    const l = doc.lines[idx];
    const start = l.t + offset;
    const nextL = doc.lines.slice(idx + 1).find((x) => Number.isFinite(x.t) && x.t > l.t + 0.05);
    const stop = nextL ? nextL.t + offset : (end ?? rows.find((r) => r.i === idx)?.line?.end ?? start + 5) + 1;
    return { start, stop: Math.min(stop, start + 15) };
  };
  const playSpan = (from, stop) => { seek(from); stopAt.current = stop - 0.03; audio.current?.play(); };

  const cur = lyrics.shownLine(t, 1.2, 0.35);
  const next = cur ? lyrics.lines[cur.i + 1] : lyrics.nextLine(t);
  // 清單上「現在播到」的那一列：這句的時間 ≤ t < 下一句的時間（跟 LRC 同樣的切法；大字預覽會提早 0.35 秒換句，清單不要）
  const curRow = useMemo(() => {
    let c;
    for (const r of rows) if (r.l.t + offset <= t + 0.001) c = r.i;
    return c;
  }, [rows, t, offset]);
  // 清單捲動只捲清單本身，不捲整個視窗
  const scrollToRow = (i) => {
    const box = listRef.current;
    const el = box?.querySelector(`[data-row="${i}"]`);
    if (box && el) box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2, behavior: "smooth" });
  };
  useEffect(() => { if (!paused) scrollToRow(curRow); }, [curRow]);
  // 對字完回到清單：清單捲到剛剛改的那一句，整個編輯視窗也捲到那一句看得到的地方（新人不想每次自己滑）
  useEffect(() => {
    if (wt || focus === null) return;
    scrollToRow(focus);
    const box = listRef.current;
    const el = box?.querySelector(`[data-row="${focus}"]`);
    if (!box || !el) return;
    // 清單自己的捲動是平滑的，要等它捲完再算那句在視窗裡的位置
    const id = setTimeout(() => {
      const modal = box.closest(".modal-card");
      if (!modal) return;
      const m = modal.getBoundingClientRect(), r = el.getBoundingClientRect();
      const foot = modal.querySelector(".edit-modal-actions")?.getBoundingClientRect().height ?? 0;
      if (r.top < m.top + 12 || r.bottom > m.bottom - foot - 12) modal.scrollBy({ top: r.top - (m.top + m.height / 2 - r.height / 2), behavior: "smooth" });
    }, 350);
    return () => clearTimeout(id);
  }, [wt, focus]);

  // ------------------------------------------------ 逐句對時
  // LRC 原文裡還沒有時間的句子。parseLrc 在有任何一句有時間時會略過沒時間的句子，
  // 逐句對時按到一半按「完成」就會變成這樣，所以另外從原文撈出來，才能「接著對剩下的」。
  const timed = isSynced(doc);
  const untimed = useMemo(() => lrc.split(/\r?\n/).map((s) => s.trim())
    .filter((s) => s && !/^\[\d+:\d/.test(s) && !/^\[[a-z]+:[^\]]*\]$/i.test(s)), [lrc]);
  const startTap = (resume = false) => {
    // 已經逐字對好的句子，重新逐句對時是整句平移、字跟字之間的間隔保留（old = 原本的開始時間）
    const had = timed ? doc.lines.filter((l) => l.text) : [];
    const rest = (timed ? untimed : doc.lines.filter((l) => l.text).map((l) => l.text)).map((text) => ({ t: NaN, text }));
    const lines = [
      ...had.map((l) => ({ t: resume ? l.t : NaN, text: l.text, words: l.words, old: l.t })),
      ...rest,
    ];
    if (!lines.length) return;
    const cursor = resume ? had.length : 0;
    setWt(null);
    setTap({ lines, cursor });
    setRate(1);
    onTapStart?.(); // 收起 LRC 原文，對時的清單才不會被擠到視窗外面
    requestAnimationFrame(() => syncRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
    stopAt.current = null; // 逐句對時是整首一路播
    // 接著對：從最後一句對好的前 2 秒開始播，不用從頭再聽一次
    seek(resume && had.length ? Math.max(0, had[had.length - 1].t + offset - 2) : 0);
    audio.current?.play();
  };
  // 歌詞時間 = 音檔時間 − 整首偏移（畫面是「歌詞時間 + 偏移」顯示的，按下去的時間要換回來）；
  // 放慢播放時，按鍵的反應時間換算成音檔時間要乘上速度
  const hit = () => setTap((s) => {
    if (!s || s.cursor >= s.lines.length) return s;
    const lines = s.lines.slice();
    const prev = lines[s.cursor - 1]?.t;
    const tt = Math.max(0, (audio.current?.currentTime ?? 0) - REACT * rate - offset);
    lines[s.cursor] = { ...lines[s.cursor], t: Number.isFinite(prev) ? Math.max(prev + 0.05, tt) : tt };
    return { lines, cursor: s.cursor + 1 };
  });
  const back = () => setTap((s) => {
    if (!s || s.cursor === 0) return s;
    const lines = s.lines.slice();
    const c = s.cursor - 1;
    const prev = lines[c - 1]?.t;
    lines[c] = { ...lines[c], t: NaN };
    seek(Number.isFinite(prev) ? prev + offset - 1 : 0);
    return { lines, cursor: c };
  });
  const finish = () => {
    if (!tap) return;
    const done = tap.lines.filter((l) => Number.isFinite(l.t)).map((l) => ({
      t: l.t, text: l.text,
      ...(l.words?.length && Number.isFinite(l.old) ? { words: l.words.map((w) => ({ ...w, t: w.t + l.t - l.old })) } : {}),
    }));
    const rest = tap.lines.filter((l) => !Number.isFinite(l.t)).map((l) => ({ t: NaN, text: l.text }));
    if (done.length) commit(toLrc([...done, ...rest], doc.meta));
    setTap(null);
    setRate(1);
    audio.current?.pause();
  };
  // 按完最後一句就自動完成、儲存（不用再找「完成」鍵）
  useEffect(() => { if (tap && tap.cursor >= tap.lines.length) finish(); }, [tap]);

  // ------------------------------------------------ 選句子、提早／延後
  // 用工具改完的整份歌詞存回去。還沒有時間的句子 parseLrc 會略過，要接在最後面，才不會一改就被弄丟
  const commitLines = (lines) => commit(toLrc([...lines, ...(timed ? untimed.map((text) => ({ t: NaN, text })) : [])], doc.meta));
  /**
   * 整首（only 不給）或選起來的幾句提早／延後 dt 秒，逐字時間跟著移、不會移到 0 秒以前。
   * 一句後面緊接的空白時間行（「這裡停止唱」）算那句的結尾，跟著一起移。
   * 移完照時間重新排：移太多、超過隔壁句的話順序會跟著變，選取跟著原本那幾句走。
   */
  const shift = (dt, only) => {
    if (!timed) return;
    const moving = doc.lines.map(() => false);
    doc.lines.forEach((l, i) => { moving[i] = !only || only.has(i) || (!l.text && i > 0 && moving[i - 1]); });
    const moved = doc.lines.map((l, i) => {
      if (!moving[i]) return { l, m: false, k: i };
      const d = Math.max(dt, -l.t);
      return { l: { ...l, t: l.t + d, ...(l.words ? { words: l.words.map((w) => ({ ...w, t: Math.max(0, w.t + d) })) } : {}) }, m: true, k: i };
    }).sort((a, b) => a.l.t - b.l.t || a.k - b.k);
    pushUndo();
    commitLines(moved.map((x) => x.l));
    if (!only) return;
    setSel(new Set(moved.map((x, k) => (x.m && only.has(x.k) ? k : -1)).filter((k) => k >= 0)));
    // 移完從選起來的第一句重播（播到它的下一句），馬上聽得出有沒有對上
    const k = moved.findIndex((x) => x.m && only.has(x.k));
    const st = moved[k].l.t + offset;
    const nx = moved.slice(k + 1).find((x) => x.l.t > moved[k].l.t + 0.05);
    playSpan(st, Math.min(nx ? nx.l.t + offset : st + 5, st + 15));
  };
  // 點清單的一句：選這句、播這句。Shift＋點：從上一次點的那句選到這句；Ctrl（Mac 是 ⌘）＋點：加選或取消這句。這兩種只選不播
  const pickRow = (e, i) => {
    onPick?.(doc.lines[i]);
    if (e.shiftKey && anchor.current !== null) {
      const a = Math.min(anchor.current, i), b = Math.max(anchor.current, i);
      setSel(new Set(rows.filter((r) => r.i >= a && r.i <= b).map((r) => r.i)));
      return;
    }
    anchor.current = i;
    if (e.ctrlKey || e.metaKey) {
      setSel((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
      return;
    }
    setSel(new Set([i]));
    setFocus(i);
    const sp = lineSpan(i);
    playSpan(sp.start, sp.stop);
  };
  /**
   * 只改這一句的開頭，改完馬上從新的開頭重播這句（新人 2026-09-30：點一句發現字亮得太慢，
   * 按一下往前 0.1、聽一次，一直按到對）。結尾（下一句的開頭、後面的空白時間行）不動；
   * 有逐字時間的句子，字跟著一起移。不會越過上一句或下一句（順序不會亂）。
   */
  const nudgeStart = (i, dt) => {
    const l = doc.lines[i];
    if (!l || !Number.isFinite(l.t)) return;
    const prev = doc.lines[i - 1], next = doc.lines[i + 1];
    // 本來就跟隔壁句貼太近（例如同一個時間）的，按「提早」不會反而往後跳
    const lo = Math.min(l.t, prev ? prev.t + 0.05 : 0), hi = Math.max(l.t, next ? next.t - 0.05 : Infinity);
    const nt = Math.min(hi, Math.max(lo, l.t + dt));
    const d = Math.round((nt - l.t) * 100) / 100;
    if (Math.abs(d) < 0.005) { toastErr(new Error(dt < 0 ? "再往前就碰到上一句了" : "再往後就碰到下一句了")); return; }
    const lines = doc.lines.slice();
    lines[i] = { ...l, t: l.t + d, ...(l.words ? { words: l.words.map((w) => ({ ...w, t: Math.max(0, w.t + d) })) } : {}) };
    pushUndo();
    commitLines(lines);
    playSpan(l.t + d + offset, lineSpan(i).stop);
  };
  const selectOne = (i) => { anchor.current = i; setSel(new Set([i])); setFocus(i); onPick?.(doc.lines[i]); };

  // ------------------------------------------------ 逐字對時（只修一句）
  const openWord = (idx) => {
    const l = doc.lines[idx];
    // 每個會被唱的單位（中文一個字、英文一個字）在整句裡的位置；段落文字從這裡切，標點跟著前一段
    const units = [];
    let at = 0;
    for (const u of lyricUnits(l.text)) {
      if (!u.w.trim()) continue;
      const pos = l.text.indexOf(u.w, at);
      units.push({ w: u.w, pos: pos >= 0 ? pos : at });
      at = (pos >= 0 ? pos : at) + u.w.length;
    }
    if (!units.length) return;
    // 字中間的空格也是一格（新人 2026-09-30）：點了就是「這裡停頓」，存成 <唱完的時間> <再開始的時間>，
    // 間奏時前面的字不會一路慢慢亮到下一段。沒點的空格照舊跟著前一段。
    for (let j = 1; j < l.text.length; j++) if (l.text[j] === " ") units.push({ w: " ", pos: j, gap: true });
    units.sort((a, b) => a.pos - b.pos);
    // 這句已經對過字：照上次的分段先切好（含停頓），要改哪裡再點，不用每次從整句一段重來
    const cuts = units.map(() => false);
    if (l.words?.length && l.words.map((w) => w.w).join("") === l.text) {
      let p = 0;
      l.words.forEach((w, k) => {
        const u = k > 0 && w.w ? units.findIndex((x) => x.pos === p) : -1;
        if (u > 0) cuts[u] = true;
        p += w.w.length;
      });
    }
    audio.current?.pause();
    selectOne(idx);
    requestAnimationFrame(() => syncRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    const t0 = l.t; // 第一個字／第一段就是這句在 LRC 上的時間
    // 只有「自己分段」（新人拿掉了每個字按一下）：點字切段
    setWt({ idx, t: t0, text: l.text, units, cuts, times: [], phase: "setup" });
  };
  // 分段：點了的字是新一段的開頭；點了的空格（停頓）自己一段，它後面的字一定從新的一段開始
  const segsOf = (w) => {
    const starts = w.units.map((u, i) => i).filter((i) => i === 0 || w.cuts[i] || (w.units[i - 1].gap && w.cuts[i - 1]));
    return starts.map((from, k) => {
      const end = k + 1 < starts.length ? w.units[starts[k + 1]].pos : w.text.length;
      return { from, gap: k > 0 && !!w.units[from].gap, text: w.text.slice(k === 0 ? 0 : w.units[from].pos, end) };
    });
  };
  // 按法（新人要求）：第一個字／第一段就從這句原本的時間開始，不用按；之後每一段（或每個字）開始唱時按一下，
  // 最後一個字唱完再按一下（這下可以不按：這句播完就停，結尾自動推算）。wt.times 只存按下去的時間。
  // 按的時間先記在 ref 裡：按很快的時候兩下之間畫面可能還沒更新，從 state 讀會漏掉一下。
  const taps = useRef([]);
  const cutsOf = (w) => segsOf(w).length - 1; // 要按的「開始」有幾下（不含第一段）
  // 對字只播這一句：從這句的時間播到下一句的時間
  const wordStart = () => {
    if (!wt) return;
    taps.current = [];
    setWt((w) => ({ ...w, times: [], phase: "tap" }));
    if (audio.current) audio.current.playbackRate = rate;
    const sp = lineSpan(wt.idx);
    playSpan(sp.start, sp.stop);
  };
  const wordHit = () => {
    const a = audio.current;
    // 這句已經播完停下來了：按空白鍵不記時間（記到的會是停住的位置）
    if (!wt || wt.phase !== "tap" || !a || a.paused) return;
    const need = cutsOf(wt) + 1;
    if (taps.current.length >= need) return;
    // 按鍵的反應時間是真實時間，放慢播放時換算成音檔時間要乘上速度；一定要比前一下（或這句開頭）晚
    const prev = taps.current[taps.current.length - 1] ?? wt.t;
    const tt = Math.max(prev + 0.03, a.currentTime - REACT * rate - offset);
    taps.current = [...taps.current, tt];
    const done = taps.current.length >= need;
    if (done) { a.pause(); stopAt.current = null; }
    setWt((w) => ({ ...w, times: taps.current, phase: done ? "done" : "tap" }));
  };
  const wordBack = () => {
    if (!wt || !taps.current.length) return;
    taps.current = taps.current.slice(0, -1);
    setWt((w) => ({ ...w, times: taps.current, phase: "tap" }));
    // 退回上一下之前一點點再播（不早於這句開頭），一樣播到這句結束就停
    const sp = lineSpan(wt.idx);
    playSpan(Math.max(sp.start, (taps.current[taps.current.length - 1] ?? wt.t) + offset - 1.5), sp.stop);
  };
  const wordCancel = () => { audio.current?.pause(); stopAt.current = null; setRate(1); setWt(null); };
  const wordApply = () => {
    const l = doc.lines[wt.idx];
    if (!l || l.text !== wt.text) { toastErr(new Error("歌詞在對時中被改過了，請重新選這一句")); wordCancel(); return; }
    const segs = segsOf(wt);
    const n = segs.length - 1;
    const starts = [wt.t, ...wt.times.slice(0, n)];
    const end = wt.times[n]; // 沒按「唱完了」就沒有結尾標記，大螢幕自己推算
    const words = [...segs.map((sg, k) => ({ t: starts[k], w: sg.text })), ...(end !== undefined ? [{ t: end, w: "" }] : [])];
    const lines = doc.lines.slice();
    lines[wt.idx] = { t: wt.t, text: l.text, words };
    pushUndo();
    commitLines(lines);
    selectOne(wt.idx);
    const sp = lineSpan(wt.idx, end !== undefined ? end + offset : undefined);
    setWt(null);
    // 馬上用正常速度重播這一句（只播這句），看字有沒有跟上
    setRate(1);
    playSpan(sp.start, sp.stop);
  };
  // 改回自動會丟掉按好的逐字時間：先跳確認框（新人要求）
  const wordClear = async (idx) => {
    const ok = await confirmAsk({
      title: "這句改回自動推算？",
      text: `「${doc.lines[idx].text}」按好的逐字時間會拿掉，改回自動推算。改完如果後悔，可以按「復原剛剛的修改」。`,
      confirmText: "改回自動",
    });
    if (!ok) return;
    const lines = doc.lines.slice();
    lines[idx] = { t: lines[idx].t, text: lines[idx].text };
    pushUndo();
    selectOne(idx);
    commitLines(lines);
  };

  // 選了一句（沒有在對時）時，鍵盤 ← → 就是這句的「開頭提早／延後」；在輸入框、下拉選單、確認框裡按的不算
  useEffect(() => {
    if (tap || wt || selRows.length !== 1) return;
    const onKey = (e) => {
      if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.target?.closest?.("input, textarea, [contenteditable], [role=combobox], [role=listbox], .swal2-container")) return;
      e.preventDefault();
      nudgeStart(selRows[0].i, e.key === "ArrowLeft" ? -step : step);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // 每次重畫都重新綁，拿得到最新的歌詞

  useEffect(() => {
    const active = tap || wt?.phase === "tap" || wt?.phase === "done";
    if (!active) return;
    const onKey = (e) => {
      if (e.code === "Space") { e.preventDefault(); if (tap) hit(); else wordHit(); }
      else if (e.key === "Backspace") { e.preventDefault(); if (tap) back(); else wordBack(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // 每次重畫都重新綁，拿得到最新的狀態

  // 對字中：這句的播放範圍；播放鍵只播這句
  const span = wt ? lineSpan(wt.idx) : null;
  const playLine = () => {
    const a = audio.current;
    if (!a || !span) return;
    if (!a.paused) { a.pause(); stopAt.current = null; return; }
    if (wt.phase === "tap") return wordStart();
    playSpan(t >= span.start && t < span.stop - 0.05 ? t : span.start, span.stop);
  };
  // ■：停下來、回到這句開頭（新人不想一直拖進度條）。按到一半按 ■ 就是放棄這次，按的時間清掉。
  const stopLine = () => {
    const a = audio.current;
    if (!a || !span) return;
    a.pause();
    stopAt.current = null;
    seek(span.start);
    if (wt.phase === "tap") { taps.current = []; setWt((w) => ({ ...w, times: [], phase: "setup" })); }
  };

  return (
    <div className="ws-sync" ref={syncRef}>
      <audio ref={audio} src={blobUrl || undefined} onLoadedMetadata={(e) => setDur(e.currentTarget.duration)} onPlay={() => setPaused(false)} onPause={() => setPaused(true)} hidden />
      {span ? (
        // 對字時播放器只管這一句：進度條是這句的範圍，播放鍵只播這句（按的途中按播放鍵＝重按一次）
        <div className="ws-player">
          <button type="button" className="btn btn-primary btn-sm" disabled={!blobUrl} onClick={playLine}>{paused ? <Play size={13} /> : <Pause size={13} />}</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!blobUrl} title="停止，回到這句開頭" onClick={stopLine}><Square size={12} /></button>
          <div className="ws-bar" onClick={(e) => { if (wt.phase === "tap") return; const r = e.currentTarget.getBoundingClientRect(); playSpan(span.start + ((e.clientX - r.left) / r.width) * (span.stop - span.start), span.stop); }}>
            <div style={{ width: `${Math.max(0, Math.min(100, ((t - span.start) / (span.stop - span.start)) * 100))}%` }} />
          </div>
          <span className="ws-time">這句 {fmtTime(span.start)}～{fmtTime(span.stop)}</span>
        </div>
      ) : (
        <div className="ws-player">
          <button type="button" className="btn btn-primary btn-sm" disabled={!blobUrl} onClick={play}>{paused ? <Play size={13} /> : <Pause size={13} />}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => seek(t - 5)}>−5 秒</button>
          <div className="ws-bar" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); stopAt.current = null; seek(((e.clientX - r.left) / r.width) * dur); }}>
            <div style={{ width: `${dur ? (t / dur) * 100 : 0}%` }} />
          </div>
          <span className="ws-time">{fmtTime(t).slice(0, 5)} / {fmtTime(dur).slice(0, 5)}</span>
        </div>
      )}
      {tap ? (
        <div className="ws-tap">
          <div className="ws-tap-list">
            {tap.lines.map((l, i) => (
              <div key={i} className={`ws-tap-line${i === tap.cursor ? " now" : ""}${i < tap.cursor ? " done" : ""}`} ref={(el) => { if (i === tap.cursor && el) el.scrollIntoView({ block: "center", behavior: "smooth" }); }}>
                <span className="ws-tap-t">{Number.isFinite(l.t) ? fmtTime(l.t) : "--:--.--"}</span>{l.text}
              </div>
            ))}
          </div>
          {/* 按鈕不拿焦點：滑鼠點過之後再按空白鍵，才不會同時觸發按鈕、一次記兩句 */}
          <div className="toolbar" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-primary" onMouseDown={(e) => e.preventDefault()} onClick={hit} disabled={tap.cursor >= tap.lines.length}>這句開始（空白鍵）</button>
            <button type="button" className="btn btn-ghost btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={back} disabled={tap.cursor === 0}>退一句（⌫）</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={finish}>先存到這裡</button>
            <span className="helper-text" style={{ margin: 0 }}>第 {Math.min(tap.cursor + 1, tap.lines.length)} / {tap.lines.length} 句</span>
            <span className="ws-rate">
              {[[1, "正常"], [0.75, "慢一點"]].map(([r, label]) => (
                <button key={r} type="button" className={`btn btn-sm ${rate === r ? "btn-primary" : "btn-ghost"}`} onMouseDown={(e) => e.preventDefault()} onClick={() => setRate(r)}>{label}</button>
              ))}
            </span>
          </div>
          <div className="helper-text" style={{ marginBottom: 0 }}>
            聽到框起來那句<b>開始唱</b>的那一刻按空白鍵，按錯按 ⌫ 退一句。前奏太長可以點上面的進度條跳過。
            按完最後一句會自動儲存；中途要停可以按「先存到這裡」，之後再「接著對」。按得不夠準沒關係，之後可以用那句的「對字」或整首提早／延後微調。
          </div>
        </div>
      ) : wt ? (
        <WordTapPanel wt={wt} segs={segsOf(wt)} rate={rate} ended={paused && stopAt.current === null}
          onRate={setRate}
          onCut={(i) => setWt((w) => (w.phase === "setup" && i > 0 ? { ...w, cuts: w.cuts.map((c, j) => (j === i ? !c : c)) } : w))}
          onStart={wordStart} onHit={wordHit} onBack={wordBack} onCancel={wordCancel} onApply={wordApply} />
      ) : (
        <>
          {!timed ? (
            // 還沒有時間軸（新人 2026-09-29：「這種我還沒有時間軸的怎麼辦」）：直接告訴他下一步，按鈕放最顯眼的地方
            <div className="ws-empty">
              {untimed.length ? (
                <>
                  <div className="ws-empty-title">這首的歌詞還沒有時間（共 {untimed.length} 句）</div>
                  <div className="helper-text">按下面的按鈕，歌會從頭播；每一句<b>開始唱</b>的那一刻按一下空白鍵，大約跟著唱一遍就對好了，按完自動儲存。</div>
                  <button type="button" className="btn btn-primary" disabled={!blobUrl} onClick={() => startTap(false)}><Wand2 size={14} /> 開始逐句對時</button>
                </>
              ) : (
                <div className="helper-text">還沒有歌詞：按上面的「自動找歌詞」、「上傳 .lrc 檔」，或按「編輯 LRC 原文」把歌詞貼進去（一行一句，不用時間）。</div>
              )}
            </div>
          ) : (
            <div className="ws-preview">
              {cur ? <KaraokeLine line={cur} t={t} /> : <span className="muted-cell">{lyrics.has ? "（間奏）" : "沒有對好時間的歌詞"}</span>}
              {next && <div className="ws-preview-next">{next.text}</div>}
            </div>
          )}
          {timed && untimed.length > 0 && (
            <div className="ws-empty ws-empty-inline">
              <span>還有 {untimed.length} 句沒有時間（從「{untimed[0].length > 16 ? `${untimed[0].slice(0, 16)}…` : untimed[0]}」開始），大螢幕不會顯示。</span>
              <button type="button" className="btn btn-primary btn-sm" disabled={!blobUrl} onClick={() => startTap(true)}><Wand2 size={13} /> 接著對剩下的</button>
            </div>
          )}
          {rows.length > 0 && (
            <>
              <div className="helper-text" style={{ margin: "2px 0 6px" }}>
                下面每一句都照大螢幕的時間亮，點一句只播那一句（按上面的播放鍵才會整首一直播）。
                這句出來得太晚或太早：點它之後按「開頭提早／延後」（或鍵盤 ← →），會從新的開頭重播，一直按到對；字跟歌聲對不上就按「對字」邊聽邊按空白鍵。
                按住 Shift 點另一句可以選起一整段（Ctrl 點是加選），用下面的「選起來的句子」一起移。改完都會自動儲存。
                {saveNote && <span className="ws-save-note">{saveNote}</span>}
              </div>
              <div className="ws-lines" ref={listRef}>
                {rows.map((r) => (
                  // Shift＋點時擋掉瀏覽器預設的反白選字
                  <div key={r.i} data-row={r.i} className={`ws-line${r.i === curRow ? " now" : ""}${sel.has(r.i) ? " sel" : ""}`}
                    onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }} onClick={(e) => pickRow(e, r.i)}>
                    <span className="ws-tap-t">{fmtTime(r.l.t)}</span>
                    <span className="ws-line-text">{r.line ? <KaraokeLine line={r.line} t={t} small /> : r.l.text}</span>
                    {r.l.words?.length > 0 && <span className="pill pill-yes ws-line-pill" title="這句的字照你按的時間亮">逐字</span>}
                    <span className="ws-line-btns">
                      {selRows.length === 1 && selRows[0].i === r.i && <>
                        <button type="button" className="btn btn-ghost btn-sm" title={`這句開頭提早 ${step} 秒，然後重播這句（鍵盤 ←）`} onClick={(e) => { e.stopPropagation(); nudgeStart(r.i, -step); }}><ChevronLeft size={12} /> 開頭提早 {step}</button>
                        <button type="button" className="btn btn-ghost btn-sm" title={`這句開頭延後 ${step} 秒，然後重播這句（鍵盤 →）`} onClick={(e) => { e.stopPropagation(); nudgeStart(r.i, step); }}>開頭延後 {step} <ChevronRight size={12} /></button>
                      </>}
                      <button type="button" className="btn btn-ghost btn-sm" disabled={!blobUrl} onClick={(e) => { e.stopPropagation(); openWord(r.i); }}><Type size={12} /> 對字</button>
                      {r.l.words?.length > 0 && <button type="button" className="btn btn-ghost btn-sm" title="拿掉這句的逐字時間，改回自動推算" onClick={(e) => { e.stopPropagation(); wordClear(r.i); }}>自動</button>}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
          {/* 還沒有時間時，提早／延後沒有意義，先不顯示 */}
          {timed && rows.length > 0 && (
            <div className="ws-shift">
              <div className="ws-shift-row">
                <span className="ws-shift-label">時間微調</span>
                <span>每次移</span>
                <input type="text" inputMode="decimal" className="ws-step" value={stepText} aria-label="每次提早／延後幾秒"
                  onChange={(e) => setStepText(e.target.value.replace(/[^\d.]/g, ""))} onBlur={() => setStepText(String(step))} />
                <span>秒</span>
                <span className="helper-text" style={{ margin: 0 }}>（可以填 0.01～30，例如 0.05、0.5、2；改完自動儲存）</span>
              </div>
              <div className="ws-shift-row">
                <span className="ws-shift-label">整首</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => shift(-step)}>提早 {step} 秒</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => shift(step)}>延後 {step} 秒</button>
              </div>
              <div className="ws-shift-row">
                <span className="ws-shift-label">{selRows.length ? `選起來的 ${selRows.length} 句` : "選起來的句子"}</span>
                <button type="button" className="btn btn-ghost btn-sm" disabled={!selRows.length} onClick={() => shift(-step, new Set(selRows.map((r) => r.i)))}>提早 {step} 秒</button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={!selRows.length} onClick={() => shift(step, new Set(selRows.map((r) => r.i)))}>延後 {step} 秒</button>
                <span className="ws-shift-sel">
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!selRows.length} title="從選起來的第一句一直選到最後一句"
                    onClick={() => setSel(new Set(rows.filter((r) => r.i >= selRows[0].i).map((r) => r.i)))}>一直選到最後</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSel(new Set(rows.map((r) => r.i)))}>全選</button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!selRows.length} onClick={() => setSel(new Set())}>取消選取</button>
                </span>
              </div>
              <div className="helper-text" style={{ margin: 0 }}>
                {!selRows.length ? "在上面的清單點一句就會選起來；按住 Shift 再點另一句，會選起中間整段。"
                  : selRows.length === 1 ? `選了 ${fmtTime(selRows[0].l.t)}「${clip(selRows[0].l.text)}」`
                  : `選了 ${fmtTime(selRows[0].l.t)}「${clip(selRows[0].l.text)}」到 ${fmtTime(selRows[selRows.length - 1].l.t)}「${clip(selRows[selRows.length - 1].l.text)}」，共 ${selRows.length} 句`}
              </div>
            </div>
          )}
          {(timed || undo.length > 0) && (
            <div className="toolbar" style={{ marginTop: 8 }}>
              {timed && <button type="button" className="btn btn-ghost btn-sm" disabled={!blobUrl || !lrc.trim()} onClick={() => startTap(false)}><Wand2 size={13} /> 整首重新逐句對時</button>}
              {timed && offset !== 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOffset(0)}>清除偏移 {offset > 0 ? "+" : ""}{offset}s</button>}
              {undo.length > 0 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { commit(undo[undo.length - 1]); setUndo((u) => u.slice(0, -1)); }}>
                  <Undo2 size={13} /> 復原上一步{undo.length > 1 ? `（還可以退 ${undo.length} 步）` : ""}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * 逐字對時的畫面：設定（每個字／自己分段、播放速度）→ 邊聽邊按空白鍵 → 套用。
 * 第一段從這句原本的時間開始（不用按），wt.times 是之後每一段開頭、最後是唱完（可以沒有）。
 * 點了的空格是「停頓」：它那一下是前面唱完、停下來的時間，下一下才是後面開始唱。
 */
function WordTapPanel({ wt, segs, rate, ended, onRate, onCut, onStart, onHit, onBack, onCancel, onApply }) {
  const cuts = segs.length - 1; // 要按幾個「開始」（含停頓）
  const gaps = segs.filter((sg) => sg.gap).length;
  const k = wt.times.length; // 已經按了幾下
  const tapping = wt.phase === "tap";
  const segOf = (i) => { let s = 0; segs.forEach((sg, j) => { if (i >= sg.from) s = j; }); return s; };
  return (
    <div className="ws-tap ws-word-tap">
      <div className="ws-chips">
        {wt.units.map((u, i) => {
          const sg = segOf(i);
          const state = wt.phase === "setup" ? "" : sg <= k ? " done" : tapping && sg === k + 1 && !ended ? " now" : "";
          const head = segs[sg].from === i;
          const at = sg === 0 ? wt.t : wt.times[sg - 1];
          return (
            <span key={i} className={`ws-chip${u.gap ? " gap" : ""}${state}${i > 0 && head ? " cut" : ""}${wt.phase === "setup" && i > 0 ? " clickable" : ""}`}
              title={u.gap && wt.phase === "setup" ? (head ? "再點一次取消停頓" : "點這個空格：這裡停頓（間奏），停的時候字不會亮") : undefined} onClick={() => onCut(i)}>
              {u.gap ? "␣" : u.w}
              <small>{head && at !== undefined ? fmtTime(at).slice(3) : u.gap && head ? "停頓" : " "}</small>
            </span>
          );
        })}
      </div>
      {wt.phase === "setup" && <>
        <div className="toolbar" style={{ marginTop: 10 }}>
          <span className="helper-text" style={{ margin: 0 }}>播放速度</span>
          {[1, 0.75, 0.5].map((r) => <button key={r} type="button" className={`btn btn-sm ${rate === r ? "btn-primary" : "btn-ghost"}`} onClick={() => onRate(r)}>{r === 1 ? "正常" : `${r}×`}</button>)}
        </div>
        <div className="helper-text">
          先點上面的字把這句切成幾段：點一個字，就從那個字開始新的一段（例如「窗外飛過著｜宣告戀愛｜的蜻蜓」），再點一次取消。
          第一段從這句原本的時間開始，不用按；之後每段開始唱的那一刻按一下空白鍵，段裡的字平均分時間。
          最後一個字唱完再按一下（沒按到也沒關係，結尾會自動推算）。只播這一句（這句的時間到下一句的時間）；跟不上可以放慢。
          <br />中間有<b>停頓或間奏</b>的地方，點那裡的空格（␣）：前面唱完、停下來時按一下，後面開始唱再按一下，停的時候字不會亮。
          句子裡沒有空格的話，先在 LRC 原文那句要停的地方打一個空格。
        </div>
        <div className="toolbar" style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-primary" onClick={onStart}><Play size={13} /> 開始（{cuts ? `按 ${cuts} 次${gaps ? `，含 ${gaps} 次停頓` : "開頭"}＋` : ""}唱完按 1 次）</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>取消</button>
        </div>
      </>}
      {tapping && ended && (
        <div className="helper-text" style={{ marginTop: 10 }}>
          {k >= cuts ? "這句播完了。最後一下沒按到也沒關係，結尾會自動推算，可以直接套用。" : `這句播完了，還有 ${cuts - k} 段的開頭沒按到。按「重按一次」從頭再來，或「退一下」從上一下接著按。`}
        </div>
      )}
      {tapping && (
        <div className="toolbar" style={{ marginTop: 10 }}>
          {ended && k >= cuts && <button type="button" className="btn btn-primary" onClick={onApply}>套用並重播這一句</button>}
          {ended && <button type="button" className={`btn ${k >= cuts ? "btn-ghost btn-sm" : "btn-primary"}`} onClick={onStart}><Play size={13} /> 重按一次</button>}
          {!ended && (
            <button type="button" className="btn btn-primary" onClick={onHit}>
              {k >= cuts ? "唱完了（空白鍵）" : segs[k + 1].gap ? `「${segs[k].text.trim()}」唱完、停下來（空白鍵）` : `「${segs[k + 1].text.trim()}」開始（空白鍵）`}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onBack} disabled={!k}>退一下（⌫）</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>取消</button>
          <span className="helper-text" style={{ margin: 0 }}>{k} / {cuts + 1}</span>
        </div>
      )}
      {wt.phase === "done" && (
        <div className="toolbar" style={{ marginTop: 10 }}>
          <button type="button" className="btn btn-primary" onClick={onApply}>套用並重播這一句</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onStart}>重按一次</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>退一下（⌫）</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>取消</button>
        </div>
      )}
    </div>
  );
}

/** 一行歌詞，唱過的字變深、正在唱的字漸層（跟大螢幕同樣的時間規則）。 */
function KaraokeLine({ line, t, small }) {
  return (
    <div className={`ws-karaoke${small ? " sm" : ""}`}>
      {line.words.map((w, i) => {
        const p = Lyrics.wordProgress(w, t);
        const gap = i > 0 && line.text[w.o - 1] === " " ? " " : "";
        return <span key={i}>{gap}<span className="ws-word" style={{ "--p": `${Math.round(p * 100)}%` }}>{w.w}</span></span>;
      })}
    </div>
  );
}
