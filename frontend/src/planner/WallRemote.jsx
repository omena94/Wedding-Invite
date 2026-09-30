// 後台「大螢幕遙控」（2026-09-30）：幫手用手機看會場大螢幕現在播什麼，切歌、拖進度、插播、隨機播放、講話模式，
// 不用跑去會場電腦，操作列也不會出現在投影畫面上。
// 大螢幕每秒回報一次狀態、順便拿走這裡按的指令（後端 routers/wall.py 的 remote/*），所以按下去大約一兩秒後生效；
// 在那之前畫面先照「按下去的樣子」顯示（pending），大螢幕回報跟上了就改用真的狀態。
import { useEffect, useRef, useState } from "react";
import { ListMusic, Mic, MicOff, Minus, MonitorSmartphone, Pause, Play, Plus, SkipBack, SkipForward, Wifi, WifiOff } from "lucide-react";
import { fetchWallRemote, saveWallDuck, sendWallRemote } from "../api.js";
import Toggle from "../components/Toggle.jsx";
import { PageHead, confirmAsk, toastErr } from "./ui.jsx";

const mmss = (x) => { const v = Math.max(0, Math.floor(x || 0)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ago = (s) => (s < 60 ? `${Math.round(s)} 秒` : s < 3600 ? `${Math.round(s / 60)} 分鐘` : `${Math.round(s / 3600)} 小時`);
const PENDING_MS = 5000; // 按下去後最多等這麼久；大螢幕還沒跟上就改回顯示它回報的狀態
const ACTION_LABEL = { play: "播放", pause: "暫停", next: "下一首", prev: "上一首", seek: "跳到那個時間", now: "現在播", insert: "插播", cancel: "取消插播", shuffle: "隨機播放", reshuffle: "重新洗牌", volume: "音量", duck: "講話模式" };

export default function WallRemote() {
  const [snap, setSnap] = useState(null); // 後端回的 {state, age, online}，加上收到的時間 at
  const [err, setErr] = useState("");
  const [now, setNow] = useState(Date.now());
  const [pending, setPending] = useState({}); // 按下去還沒反映的：{ playing|duck|duckLevel|shuffle|volume|seek: { value, at } }
  const [sent, setSent] = useState(null); // 「已送出」提示：{ text, at }

  // 每秒問一次大螢幕的狀態（一個問完才問下一個，網路慢也不會疊起來）；畫面每 0.25 秒更新播放時間
  useEffect(() => {
    let alive = true, timer = 0;
    const poll = async () => {
      try {
        const r = await fetchWallRemote();
        if (alive) { setSnap({ ...r, at: Date.now() }); setErr(""); }
      } catch (e) { if (alive) setErr(e.message || "連不上伺服器"); }
      if (alive) timer = setTimeout(poll, 1000);
    };
    poll();
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => { alive = false; clearTimeout(timer); clearInterval(tick); };
  }, []);

  const st = snap?.state || null;
  const online = !!(snap?.online && st);
  const ready = online && !!st.started;
  const live = (key, actual) => {
    const p = pending[key];
    return p && now - p.at < PENDING_MS && p.value !== actual ? p.value : actual;
  };
  const playing = !!live("playing", st?.playing);
  const duck = !!live("duck", st?.duck);
  const shuffle = !!live("shuffle", st?.shuffle);
  const volume = live("volume", st?.volume ?? 0.9);
  // 講話模式的音量是存在伺服器的設定：大螢幕沒連線也能先調好
  const duckLevel = live("duckLevel", snap?.duck_level ?? 20);
  // 播放時間：大螢幕回報的時間，加上回報之後過了多久（播放中才往前走）
  const since = snap ? (snap.age ?? 0) + (now - snap.at) / 1000 : 0;
  let tShow = st ? Math.min(st.end || Infinity, st.t + (st.playing && !st.silent ? since : 0)) : 0;
  // 剛拖了進度條：大螢幕還沒跳過去之前，先顯示拖到的位置
  const sp = pending.seek;
  if (sp && now - sp.at < PENDING_MS) {
    const expect = sp.value + (playing ? (now - sp.at) / 1000 : 0);
    if (Math.abs(tShow - expect) > 1.5) tShow = expect;
  }

  const send = async (action, args = {}, optimistic) => {
    if (optimistic) setPending((p) => ({ ...p, [optimistic[0]]: { value: optimistic[1], at: Date.now() } }));
    try {
      await sendWallRemote(action, args);
      setSent({ text: `已送出「${ACTION_LABEL[action] || action}」，大螢幕一兩秒內會照做`, at: Date.now() });
    } catch (e) {
      toastErr(e);
      if (optimistic) setPending((p) => { const n = { ...p }; delete n[optimistic[0]]; return n; });
    }
  };
  // 「現在播」會馬上打斷現在的歌：手機上容易誤觸，先問一次
  const playNow = async (q) => {
    const ok = await confirmAsk({ title: `現在播「${q.title}」？`, text: "大螢幕會馬上切過去，播完照原本的順序。", confirmText: "現在播" });
    if (ok) send("now", { id: q.id, j: q.j });
  };
  const setVol = (v) => { const x = Math.round(clamp(v, 0, 1.5) * 10) / 10; send("volume", { v: x }, ["volume", x]); };
  const setDuckLevel = async (v) => {
    const x = Math.round(clamp(v, 0, 90));
    setPending((p) => ({ ...p, duckLevel: { value: x, at: Date.now() } }));
    try { await saveWallDuck(x); setSent({ text: `講話模式改成音樂剩 ${x}%`, at: Date.now() }); }
    catch (e) { toastErr(e); setPending((p) => { const n = { ...p }; delete n.duckLevel; return n; }); }
  };

  let conn;
  if (err) conn = { cls: "off", icon: WifiOff, text: `連不上伺服器：${err}` };
  else if (!snap) conn = { cls: "wait", icon: Wifi, text: "連線中…" };
  else if (!st) conn = { cls: "off", icon: WifiOff, text: "還沒有大螢幕連線。請在會場電腦開啟大螢幕（後台「現場留言」→「開啟大螢幕」）並按「開始播放」。" };
  else if (!online) conn = { cls: "off", icon: WifiOff, text: `大螢幕沒有連線（最後一次回報是 ${ago(snap.age ?? 0)}前）。請確認會場電腦的大螢幕還開著、網路正常。` };
  else if (!st.started) conn = { cls: "wait", icon: Wifi, text: "大螢幕已經打開，等現場按「開始播放」後就能遙控。" };
  else conn = { cls: "ok", icon: Wifi, text: `大螢幕連線中 · 留言 ${st.messages ?? 0} 則${st.ok === false && st.status ? ` · ${st.status}` : ""}` };
  const ConnIcon = conn.icon;
  const song = st?.song;
  const queue = ready ? st.queue || [] : [];

  return (
    <div className="wr">
      <PageHead title="大螢幕遙控" sub="用手機操作會場大螢幕：切歌、拖進度、插播、講話模式。按下去大約一兩秒後生效。" />
      <div className={`wr-conn ${conn.cls}`}><ConnIcon size={16} /> <span>{conn.text}</span></div>
      {/* 同時開了好幾台大螢幕（2026-09-30）：只有一台照手機做，要讓人知道控制的是哪一台、怎麼換 */}
      {online && snap.screens > 1 && (
        <div className="wr-conn wait"><MonitorSmartphone size={16} />
          <span>偵測到 {snap.screens} 台大螢幕同時開著。手機只控制<b>最後按「開始播放」的那台</b>（上面顯示的就是它），其他台畫面照播、不跟著遙控。
            用不到的請關掉；要改控制另一台，在那台的操作列按「改由這台接收遙控」。</span>
        </div>
      )}

      <div className="panel wr-now">
        <div className="wr-label">{song?.ins ? "現在播放（插播）" : "現在播放"}</div>
        <div className="wr-title">{song?.title || (st?.silent ? "歌單是空的：大螢幕先無聲播放留言" : "—")}</div>
        {song?.artist && <div className="wr-artist">{song.artist}</div>}
        {song && st.end > st.start && (
          <SeekBar start={st.start} end={st.end} t={tShow} disabled={!ready}
            onSeek={(x) => send("seek", { t: Math.round(x * 100) / 100 }, ["seek", x])} />
        )}
        <div className="wr-ctrls">
          <button type="button" className="btn btn-ghost wr-btn" disabled={!ready} onClick={() => send("prev")} title="播超過 5 秒是回到這首開頭"><SkipBack size={18} /> 上一首</button>
          <button type="button" className="btn btn-primary wr-btn wr-play" disabled={!ready} onClick={() => send(playing ? "pause" : "play", {}, ["playing", !playing])}>
            {playing ? <Pause size={20} /> : <Play size={20} />} {playing ? "暫停" : "播放"}
          </button>
          <button type="button" className="btn btn-ghost wr-btn" disabled={!ready} onClick={() => send("next")}><SkipForward size={18} /> 下一首</button>
        </div>
        {sent && now - sent.at < 3000 && <div className="wr-sent">{sent.text}</div>}
      </div>

      <button type="button" className={`wr-duck${duck ? " on" : ""}`} disabled={!ready} onClick={() => send("duck", { on: !duck }, ["duck", !duck])}>
        {duck ? <MicOff size={26} /> : <Mic size={26} />}
        <span>
          <b>{duck ? `講話模式中：音樂剩 ${duckLevel}%` : "講話模式"}</b>
          <small>{duck ? "講完了按一下，音樂慢慢恢復" : "主持人、致詞要講話時按一下：音樂慢慢調小聲，畫面照跑"}</small>
        </span>
      </button>
      {/* 講話時音樂剩幾 %（新人 2026-09-30 要可以自己設）：五個百分點一格，0 = 完全靜音；講話模式開著時改，大螢幕兩秒內跟上 */}
      <div className="panel wr-opts wr-duck-level">
        <div className="wr-row">
          <span className="wr-row-label">講話時音樂剩</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={duckLevel <= 0} onClick={() => setDuckLevel(duckLevel - 5)} aria-label="講話時音樂再小聲一點"><Minus size={14} /></button>
          <b className="wr-vol">{duckLevel}%</b>
          <button type="button" className="btn btn-ghost btn-sm" disabled={duckLevel >= 90} onClick={() => setDuckLevel(duckLevel + 5)} aria-label="講話時音樂大聲一點"><Plus size={14} /></button>
        </div>
        <div className="helper-text" style={{ margin: 0 }}>原本音量的幾 %；0% 就是講話時完全靜音。可以先開講話模式，邊聽邊調。</div>
      </div>

      <div className="panel wr-opts">
        <div className="wr-row">
          <span className="wr-row-label">音量</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!ready || volume <= 0} onClick={() => setVol(volume - 0.1)} aria-label="音量小一點"><Minus size={14} /></button>
          <b className="wr-vol">{Math.round(volume * 100)}%</b>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!ready || volume >= 1.5} onClick={() => setVol(volume + 0.1)} aria-label="音量大一點"><Plus size={14} /></button>
        </div>
        <div className="wr-row">
          <span className="wr-row-label">隨機播放</span>
          <Toggle checked={shuffle} disabled={!ready} onChange={(v) => send("shuffle", { on: v }, ["shuffle", v])} label="隨機播放" />
          {shuffle && <button type="button" className="btn btn-ghost btn-sm" disabled={!ready} onClick={() => send("reshuffle")}>重新洗牌</button>}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><div className="panel-title"><ListMusic size={18} /> 待播清單</div></div>
        {queue.length === 0 ? <div className="helper-text">{ready ? "歌單是空的。" : "大螢幕連線、開始播放後就會出現。"}</div> : (
          <ol className="wr-queue">
            {queue.map((q, k) => (
              <li key={`${q.j}-${q.id}`} className={`${k === 0 ? "next" : ""}${q.ins ? " ins" : ""}`}>
                <span className="wr-no">{k === 0 ? "下一首" : k + 1}</span>
                <span className="wr-q-main">
                  <b>{q.title}</b>
                  <small>{[q.artist, q.len > 0 && mmss(q.len), q.ins && "插播"].filter(Boolean).join(" · ") || " "}</small>
                </span>
                <span className="wr-q-acts">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => playNow(q)}>現在播</button>
                  {q.ins ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => send("cancel", { id: q.id, j: q.j })}>取消插播</button>
                    : k > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => send("insert", { id: q.id, j: q.j })}>插播</button>}
                </span>
              </li>
            ))}
          </ol>
        )}
        <div className="helper-text">「現在播」：馬上切過去；「插播」：排在下一首。播完都會回到原本的順序，插播過的歌這一輪不會再播。</div>
      </div>
    </div>
  );
}

/** 進度條：手指（或滑鼠）按住拖到想要的時間，放開才送出；拖的時候上面顯示幾分幾秒。 */
function SeekBar({ start, end, t, disabled, onSeek }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(null);
  const at = (e) => {
    const r = ref.current.getBoundingClientRect();
    return start + clamp((e.clientX - r.left) / r.width, 0, 1) * (end - start);
  };
  const x = drag ?? t;
  const p = clamp((x - start) / Math.max(0.1, end - start), 0, 1) * 100;
  return (
    <div className="wr-seek">
      <span>{mmss(x)}</span>
      <div ref={ref} className={`wr-bar${drag !== null ? " drag" : ""}${disabled ? " off" : ""}`}
        onPointerDown={(e) => { if (disabled) return; e.currentTarget.setPointerCapture(e.pointerId); setDrag(at(e)); }}
        onPointerMove={(e) => { if (drag !== null) setDrag(at(e)); }}
        onPointerUp={(e) => { if (drag === null) return; const to = at(e); setDrag(null); onSeek(to); }}
        onPointerCancel={() => setDrag(null)}>
        <div className="wr-fill" style={{ width: `${p}%` }} />
        <div className="wr-knob" style={{ left: `${p}%` }} />
        {drag !== null && <div className="wr-tip" style={{ left: `${p}%` }}>{mmss(drag)}</div>}
      </div>
      <span>{mmss(end)}</span>
    </div>
  );
}
