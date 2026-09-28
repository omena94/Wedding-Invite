// 大螢幕歌單（2026-09-28）：新人自己加歌、刪歌、排順序；每首歌上傳後在這台電腦上分析節拍、自動找歌詞（LRCLIB），
// 找不到或時間不準的，在「編輯」裡貼 LRC、上傳 .lrc 檔，或邊聽邊按空白鍵逐句對時。
// 大螢幕照這裡的順序播（停用的跳過），播到哪一首的配色、剪掉的前奏尾奏也在這裡設。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CloudUpload, FileText, Monitor, Music, Pause, Pencil, Play, RefreshCw, Search, Trash2, Wand2 } from "lucide-react";
import {
  deleteWallSong, fetchWallSongAnalysis, fetchWallSongAudio, fetchWallSongs, reorderWallSongs, saveWallSongAnalysis, updateWallSong, uploadWallSong,
} from "../api.js";
import Toggle from "../components/Toggle.jsx";
import Select from "../components/Select.jsx";
import { Empty, ErrorBox, Loading, Modal, NumberInput, confirmDelete, toastErr, toastOk, useLoader } from "./ui.jsx";
import { analyzeFile, ANALYSIS_VERSION } from "../wall/analysis/client";
import { halveTempo, doubleTempo } from "../wall/analysis/tempo";
import { searchLyrics } from "../wall/lyrics/lrclib";
import { parseLrc, toLrc, shiftLrc, fmtTime, isSynced } from "../wall/lyrics/lrc";
import { buildLyrics } from "../wall/lyrics/build";
import { AudioData } from "../wall/engine/audio";
import { Lyrics } from "../wall/engine/lyrics";
import { THEMES } from "../wall/themes";

// .lrc 也可以一起選：跟音檔同名就自動當那首歌的歌詞
const AUDIO_ACCEPT = "audio/*,video/mp4,.mp3,.m4a,.aac,.wav,.ogg,.flac,.opus,.mp4,.m4v,.mov,.lrc";
const THEME_OPTIONS = [{ value: "", label: "自動（依歌的快慢挑）" }, ...THEMES.map((t) => ({ value: t.key, label: t.label }))];
const mmss = (s) => (s > 0 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "—");

/** 歌詞狀態：純音樂／已對時（第幾行）／有歌詞但沒時間／沒歌詞。 */
function lyricsState(s) {
  if (s.instrumental) return { label: "純音樂", pill: "pill-groom" };
  if (!s.lyrics_lrc) return { label: "還沒有歌詞", pill: "pill-warn" };
  const doc = parseLrc(s.lyrics_lrc);
  if (!isSynced(doc)) return { label: "歌詞還沒對時", pill: "pill-warn" };
  return { label: `歌詞 ${doc.lines.filter((l) => l.text).length} 行`, pill: "pill-yes" };
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
      {Object.entries(jobs).filter(([k]) => String(k).startsWith("up-")).map(([k, v]) => <div key={k} className="ws-job">{v}</div>)}
      {error ? <ErrorBox error={error} /> : loading ? <Loading /> : items.length === 0 ? (
        <Empty>還沒有歌。按「上傳音檔」一次選好幾首；沒有歌的時候大螢幕會先安靜地播留言。</Empty>
      ) : (
        <ul className="ws-list">
          {items.map((s, idx) => {
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
      {editing && <SongEditor song={editing} onClose={() => setEditing(null)} onSaved={(s) => { replace(s); setEditing(null); }} />}
    </div>
  );
}

// ---------------------------------------------------------------- 編輯一首歌
function SongEditor({ song, onClose, onSaved }) {
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
    <Modal title={`編輯歌曲：${song.title || song.original_name}`} onClose={onClose} wide
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
          <textarea rows={8} className="ws-lrc" value={form.lyrics_lrc} placeholder={"[00:12.50]第一句歌詞\n[00:16.20]第二句歌詞\n…\n（也可以先貼沒有時間的歌詞，再用下面的「逐句對時」）"}
            onChange={(e) => setForm((f) => ({ ...f, lyrics_lrc: e.target.value, lyrics_source: "manual" }))} />
          <LyricSync lrc={form.lyrics_lrc} offset={Number(form.lyrics_offset) || 0} blobUrl={blobUrl} analysis={analysis?.data}
            onLrc={(lrc) => setForm((f) => ({ ...f, lyrics_lrc: lrc, lyrics_source: "manual" }))}
            onOffset={(o) => set("lyrics_offset", Math.round(o * 100) / 100)}
            onShift={(dt) => setForm((f) => ({ ...f, lyrics_lrc: shiftLrc(f.lyrics_lrc, dt), lyrics_source: "manual" }))} />
        </>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- 預覽與逐句對時
/**
 * 邊聽邊看歌詞（跟大螢幕一樣逐字變色）。按「逐句對時」後，每句歌詞開始唱的那一刻按空白鍵（或「這句開始」），
 * 時間就記到下一句；按錯按「退一句」。人按鍵通常慢一點點，所以記的時間自動往前 0.12 秒。
 */
function LyricSync({ lrc, offset, blobUrl, analysis, onLrc, onOffset, onShift }) {
  const audio = useRef(null);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [paused, setPaused] = useState(true);
  const [tap, setTap] = useState(null); // 逐句對時中：{ lines, cursor }
  const REACT = 0.12;

  const au = useMemo(() => (analysis ? new AudioData(analysis) : AudioData.silent(600, 100)), [analysis]);
  const lyrics = useMemo(() => { try { return buildLyrics(lrc, au, offset); } catch { return Lyrics.empty(); } }, [lrc, au, offset]);

  useEffect(() => {
    let raf = 0;
    const loop = () => { if (audio.current) setT(audio.current.currentTime); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const play = () => { const a = audio.current; if (!a) return; if (a.paused) a.play(); else a.pause(); };
  const seek = (x) => { const a = audio.current; if (a) a.currentTime = Math.max(0, Math.min(dur || 0, x)); };

  const startTap = () => {
    const doc = parseLrc(lrc);
    const lines = doc.lines.filter((l) => l.text).map((l) => ({ t: NaN, text: l.text }));
    if (!lines.length) return;
    setTap({ lines, cursor: 0 });
    seek(0);
    audio.current?.play();
  };
  const hit = useCallback(() => {
    setTap((s) => {
      if (!s || s.cursor >= s.lines.length) return s;
      const lines = s.lines.slice();
      lines[s.cursor] = { ...lines[s.cursor], t: Math.max(0, (audio.current?.currentTime ?? 0) - REACT) };
      return { lines, cursor: s.cursor + 1 };
    });
  }, []);
  const back = () => setTap((s) => {
    if (!s || s.cursor === 0) return s;
    const lines = s.lines.slice();
    const c = s.cursor - 1;
    const prev = lines[c - 1]?.t;
    lines[c] = { ...lines[c], t: NaN };
    seek(Number.isFinite(prev) ? prev - 1 : 0);
    return { lines, cursor: c };
  });
  const finish = () => {
    if (!tap) return;
    const done = tap.lines.filter((l) => Number.isFinite(l.t));
    if (done.length) onLrc(toLrc([...done, ...tap.lines.filter((l) => !Number.isFinite(l.t))]));
    setTap(null);
    audio.current?.pause();
  };
  useEffect(() => {
    if (!tap) return;
    const onKey = (e) => { if (e.code === "Space") { e.preventDefault(); hit(); } else if (e.key === "Backspace") { e.preventDefault(); back(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // 每次重畫都重新綁，back() 才拿得到最新的狀態

  const cur = lyrics.shownLine(t, 1.2, 0.35);
  const next = cur ? lyrics.lines[cur.i + 1] : lyrics.nextLine(t);
  return (
    <div className="ws-sync">
      <audio ref={audio} src={blobUrl || undefined} onLoadedMetadata={(e) => setDur(e.currentTarget.duration)} onPlay={() => setPaused(false)} onPause={() => setPaused(true)} hidden />
      <div className="ws-player">
        <button type="button" className="btn btn-primary btn-sm" disabled={!blobUrl} onClick={play}>{paused ? <Play size={13} /> : <Pause size={13} />}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => seek(t - 5)}>−5 秒</button>
        <div className="ws-bar" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * dur); }}>
          <div style={{ width: `${dur ? (t / dur) * 100 : 0}%` }} />
        </div>
        <span className="ws-time">{fmtTime(t).slice(0, 5)} / {fmtTime(dur).slice(0, 5)}</span>
      </div>
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
      ) : (
        <>
          <div className="ws-preview">
            {cur ? <KaraokeLine line={cur} t={t} /> : <span className="muted-cell">{lyrics.has ? "（間奏）" : "沒有對好時間的歌詞"}</span>}
            {next && <div className="ws-preview-next">{next.text}</div>}
          </div>
          <div className="toolbar">
            <button type="button" className="btn btn-ghost btn-sm" disabled={!blobUrl || !lrc.trim()} onClick={startTap}><Wand2 size={13} /> 逐句對時</button>
            <span className="helper-text" style={{ margin: 0 }}>整首歌詞時間：</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onShift(-0.1)}>提早 0.1 秒</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onShift(0.1)}>延後 0.1 秒</button>
            {offset !== 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOffset(0)}>清除偏移 {offset > 0 ? "+" : ""}{offset}s</button>}
          </div>
        </>
      )}
    </div>
  );
}

/** 一行歌詞，唱過的字變深、正在唱的字漸層（跟大螢幕同樣的時間規則）。 */
function KaraokeLine({ line, t }) {
  return (
    <div className="ws-karaoke">
      {line.words.map((w, i) => {
        const p = Lyrics.wordProgress(w, t);
        const gap = i > 0 && line.text[w.o - 1] === " " ? " " : "";
        return <span key={i}>{gap}<span className="ws-word" style={{ "--p": `${Math.round(p * 100)}%` }}>{w.w}</span></span>;
      })}
    </div>
  );
}
