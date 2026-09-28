// 大螢幕歌單（2026-09-28）：新人自己加歌、刪歌、排順序；每首歌上傳後在這台電腦上分析節拍、自動找歌詞（LRCLIB），
// 找不到或時間不準的，在「編輯」裡貼 LRC、上傳 .lrc 檔，或邊聽邊按空白鍵逐句對時；某一句的字亮得跟歌聲對不上，
// 在歌詞清單按那句的「對字」邊聽邊按（存成加強版 LRC 的 <mm:ss.xx>，沒修的句子照舊自動推算）。
// 大螢幕照這裡的順序播（停用的跳過），播到哪一首的配色、剪掉的前奏尾奏也在這裡設。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CloudUpload, FileText, Monitor, Music, Pause, Pencil, Play, RefreshCw, Search, Square, Trash2, Type, Wand2 } from "lucide-react";
import {
  deleteWallSong, fetchWallSongAnalysis, fetchWallSongAudio, fetchWallSongs, reorderWallSongs, saveWallSongAnalysis, updateWallSong, uploadWallSong,
} from "../api.js";
import Toggle from "../components/Toggle.jsx";
import Select from "../components/Select.jsx";
import { Empty, ErrorBox, Loading, Modal, NumberInput, confirmAsk, confirmDelete, toastErr, toastOk, useLoader } from "./ui.jsx";
import { analyzeFile, ANALYSIS_VERSION } from "../wall/analysis/client";
import { halveTempo, doubleTempo } from "../wall/analysis/tempo";
import { searchLyrics } from "../wall/lyrics/lrclib";
import { parseLrc, toLrc, shiftLrc, fmtTime, isSynced } from "../wall/lyrics/lrc";
import { buildLyrics, lyricUnits } from "../wall/lyrics/build";
import { AudioData } from "../wall/engine/audio";
import { Lyrics } from "../wall/engine/lyrics";
import { THEMES } from "../wall/themes";

// .lrc 也可以一起選：跟音檔同名就自動當那首歌的歌詞
const AUDIO_ACCEPT = "audio/*,video/mp4,.mp3,.m4a,.aac,.wav,.ogg,.flac,.opus,.mp4,.m4v,.mov,.lrc";
const THEME_OPTIONS = [{ value: "", label: "自動（依歌的快慢挑）" }, ...THEMES.map((t) => ({ value: t.key, label: t.label }))];
const mmss = (s) => (s > 0 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "—");

/** 歌詞狀態：純音樂／已對時（第幾行）／有歌詞但沒時間／沒歌詞。 */
function lyricsState(s) {
  if (s.instrumental) return { kind: "inst", label: "純音樂", pill: "pill-groom" };
  if (!s.lyrics_lrc) return { kind: "missing", label: "還沒有歌詞", pill: "pill-warn" };
  const doc = parseLrc(s.lyrics_lrc);
  if (!isSynced(doc)) return { kind: "missing", label: "歌詞還沒對時", pill: "pill-warn" };
  return { kind: "ok", label: `歌詞 ${doc.lines.filter((l) => l.text).length} 行`, pill: "pill-yes" };
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
  const [lyf, setLyf] = useState(""); // 歌詞篩選："" 全部／ok／missing／inst
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
  const nOk = states.filter((k) => k === "ok").length, nMissing = states.filter((k) => k === "missing").length, nInst = states.filter((k) => k === "inst").length;
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
          {[["", `全部 ${items.length}`], ["ok", `有歌詞 ${nOk}`], ["missing", `缺歌詞 ${nMissing}`], ["inst", `純音樂 ${nInst}`]].map(([k, label]) => (
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
  });
  const [busy, setBusy] = useState("");
  const [cands, setCands] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [blobUrl, setBlobUrl] = useState("");
  const lrcFile = useRef(null);
  // LRC 原文：已經對好時間的歌預設收起來，播放器與歌詞清單才不會被擠到視窗最下面
  const [showLrc, setShowLrc] = useState(() => !song.lyrics_lrc || !isSynced(parseLrc(song.lyrics_lrc)));
  const [saveNote, setSaveNote] = useState("");
  // 對字、逐句對時、自動、復原改的歌詞直接存（新人不想每改一句就滑到最下面按儲存，按了視窗還會關掉）
  const commitLrc = async (lrc) => {
    setForm((f) => ({ ...f, lyrics_lrc: lrc, lyrics_source: "manual", instrumental: false }));
    setSaveNote("儲存中…");
    try {
      const out = await updateWallSong(song.id, { lyrics_lrc: lrc, lyrics_source: "manual", instrumental: false });
      onPatched?.(out);
      setSaveNote(`已自動儲存（${new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}）`);
    } catch (e) { setSaveNote(""); toastErr(e); }
  };
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

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
        <label className="ws-lyrics-head">
          <span>歌詞（LRC）</span>
          <span className="ws-lyrics-tools">
            <label className="wall-msg-toggle"><Toggle checked={form.instrumental} onChange={(v) => set("instrumental", v)} label="純音樂" /> 純音樂（不顯示歌詞）</label>
          </span>
        </label>
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
          {showLrc && <textarea rows={8} className="ws-lrc" value={form.lyrics_lrc} placeholder={"[00:12.50]第一句歌詞\n[00:16.20]第二句歌詞\n…\n（也可以先貼沒有時間的歌詞，再用下面的「逐句對時」）"}
            onChange={(e) => setForm((f) => ({ ...f, lyrics_lrc: e.target.value, lyrics_source: "manual" }))} />}
          <LyricSync lrc={form.lyrics_lrc} offset={Number(form.lyrics_offset) || 0} blobUrl={blobUrl} analysis={analysis?.data}
            onLrc={(lrc) => setForm((f) => ({ ...f, lyrics_lrc: lrc, lyrics_source: "manual" }))} onCommit={commitLrc} saveNote={saveNote}
            onOffset={(o) => set("lyrics_offset", Math.round(o * 100) / 100)}
            onShift={(dt) => setForm((f) => ({ ...f, lyrics_lrc: shiftLrc(f.lyrics_lrc, dt), lyrics_source: "manual" }))} />
        </>}
      </div>
    </Modal>
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
 * 人按鍵通常慢一點點，所以記的時間自動往前 0.12 秒（放慢播放時換算成音檔時間）。
 */
function LyricSync({ lrc, offset, blobUrl, analysis, onLrc, onCommit, saveNote, onOffset, onShift }) {
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
  const [undo, setUndo] = useState(null); // 上一次「對字」之前的歌詞（復原用）
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
  const startTap = () => {
    // 已經逐字對好的句子，重新逐句對時是整句平移、字跟字之間的間隔保留（old = 原本的開始時間）
    const lines = doc.lines.filter((l) => l.text).map((l) => ({ t: NaN, text: l.text, words: l.words, old: l.t }));
    if (!lines.length) return;
    setWt(null);
    setTap({ lines, cursor: 0 });
    setRate(1);
    stopAt.current = null; // 逐句對時是整首一路播
    seek(0);
    audio.current?.play();
  };
  // 歌詞時間 = 音檔時間 − 整首偏移（畫面是「歌詞時間 + 偏移」顯示的，按下去的時間要換回來）
  const hit = () => setTap((s) => {
    if (!s || s.cursor >= s.lines.length) return s;
    const lines = s.lines.slice();
    lines[s.cursor] = { ...lines[s.cursor], t: Math.max(0, (audio.current?.currentTime ?? 0) - REACT - offset) };
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
    if (done.length) commit(toLrc([...done, ...rest]));
    setTap(null);
    audio.current?.pause();
  };

  // ------------------------------------------------ 逐字對時（只修一句）
  const openWord = (idx) => {
    const l = doc.lines[idx];
    // 每個會被唱的單位（中文一個字、英文一個字）在整句裡的位置；段落文字從這裡切，空白與標點跟著前一段
    const units = [];
    let at = 0;
    for (const u of lyricUnits(l.text)) {
      if (!u.w.trim()) continue;
      const pos = l.text.indexOf(u.w, at);
      units.push({ w: u.w, pos: pos >= 0 ? pos : at });
      at = (pos >= 0 ? pos : at) + u.w.length;
    }
    if (!units.length) return;
    audio.current?.pause();
    setFocus(idx);
    requestAnimationFrame(() => syncRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    const t0 = l.t; // 第一個字／第一段就是這句在 LRC 上的時間
    // 只有「自己分段」（新人拿掉了每個字按一下）：一開始整句一段，點字切段
    setWt({ idx, t: t0, text: l.text, units, cuts: units.map(() => false), times: [], phase: "setup" });
  };
  const segsOf = (w) => {
    const starts = w.units.map((u, i) => i).filter((i) => i === 0 || w.cuts[i]);
    return starts.map((from, k) => {
      const end = k + 1 < starts.length ? w.units[starts[k + 1]].pos : w.text.length;
      return { from, text: w.text.slice(k === 0 ? 0 : w.units[from].pos, end) };
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
    setUndo(lrc);
    commit(toLrc(lines, doc.meta));
    setFocus(wt.idx);
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
    setUndo(lrc);
    setFocus(idx);
    commit(toLrc(lines, doc.meta));
  };

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
          <div className="toolbar" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-primary" onClick={hit} disabled={tap.cursor >= tap.lines.length}>這句開始（空白鍵）</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={back} disabled={tap.cursor === 0}>退一句（⌫）</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={finish}>完成</button>
            <span className="helper-text" style={{ margin: 0 }}>第 {Math.min(tap.cursor + 1, tap.lines.length)} / {tap.lines.length} 句</span>
          </div>
        </div>
      ) : wt ? (
        <WordTapPanel wt={wt} segs={segsOf(wt)} rate={rate} ended={paused && stopAt.current === null}
          onRate={setRate}
          onCut={(i) => setWt((w) => (w.phase === "setup" && i > 0 ? { ...w, cuts: w.cuts.map((c, j) => (j === i ? !c : c)) } : w))}
          onStart={wordStart} onHit={wordHit} onBack={wordBack} onCancel={wordCancel} onApply={wordApply} />
      ) : (
        <>
          <div className="ws-preview">
            {cur ? <KaraokeLine line={cur} t={t} /> : <span className="muted-cell">{lyrics.has ? "（間奏）" : "沒有對好時間的歌詞"}</span>}
            {next && <div className="ws-preview-next">{next.text}</div>}
          </div>
          {rows.length > 0 && (
            <>
              <div className="helper-text" style={{ margin: "2px 0 6px" }}>
                下面每一句都照大螢幕的時間亮。點一句只播那一句（按上面的播放鍵才會整首一直播）；哪一句的字亮得跟歌聲對不上，按那句的「對字」邊聽邊按空白鍵就好（其他句子不受影響，改完自動儲存）。
                {saveNote && <span className="ws-save-note">{saveNote}</span>}
              </div>
              <div className="ws-lines" ref={listRef}>
                {rows.map((r) => (
                  <div key={r.i} data-row={r.i} className={`ws-line${r.i === curRow ? " now" : ""}${r.i === focus ? " sel" : ""}`} onClick={() => { setFocus(r.i); const sp = lineSpan(r.i); playSpan(sp.start, sp.stop); }}>
                    <span className="ws-tap-t">{fmtTime(r.l.t)}</span>
                    <span className="ws-line-text">{r.line ? <KaraokeLine line={r.line} t={t} small /> : r.l.text}</span>
                    {r.l.words?.length > 0 && <span className="pill pill-yes ws-line-pill" title="這句的字照你按的時間亮">逐字</span>}
                    <span className="ws-line-btns">
                      <button type="button" className="btn btn-ghost btn-sm" disabled={!blobUrl} onClick={(e) => { e.stopPropagation(); openWord(r.i); }}><Type size={12} /> 對字</button>
                      {r.l.words?.length > 0 && <button type="button" className="btn btn-ghost btn-sm" title="拿掉這句的逐字時間，改回自動推算" onClick={(e) => { e.stopPropagation(); wordClear(r.i); }}>自動</button>}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="toolbar" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!blobUrl || !lrc.trim()} onClick={startTap}><Wand2 size={13} /> 逐句對時</button>
            <span className="helper-text" style={{ margin: 0 }}>整首歌詞時間：</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onShift(-0.1)}>提早 0.1 秒</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onShift(0.1)}>延後 0.1 秒</button>
            {offset !== 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOffset(0)}>清除偏移 {offset > 0 ? "+" : ""}{offset}s</button>}
            {undo !== null && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { commit(undo); setUndo(null); }}>復原剛剛的修改</button>}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 逐字對時的畫面：設定（每個字／自己分段、播放速度）→ 邊聽邊按空白鍵 → 套用。
 * 第一段從這句原本的時間開始（不用按），wt.times 是之後每一段開頭、最後是唱完（可以沒有）。
 */
function WordTapPanel({ wt, segs, rate, ended, onRate, onCut, onStart, onHit, onBack, onCancel, onApply }) {
  const cuts = segs.length - 1; // 要按幾個「開始」
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
            <span key={i} className={`ws-chip${state}${i > 0 && head ? " cut" : ""}${wt.phase === "setup" && i > 0 ? " clickable" : ""}`} onClick={() => onCut(i)}>
              {u.w}
              <small>{head && at !== undefined ? fmtTime(at).slice(3) : " "}</small>
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
        </div>
        <div className="toolbar" style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-primary" onClick={onStart}><Play size={13} /> 開始（{cuts ? `按 ${cuts} 次開頭＋` : ""}唱完按 1 次）</button>
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
          {!ended && <button type="button" className="btn btn-primary" onClick={onHit}>{k < cuts ? `「${segs[k + 1].text.trim()}」開始（空白鍵）` : "唱完了（空白鍵）"}</button>}
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
