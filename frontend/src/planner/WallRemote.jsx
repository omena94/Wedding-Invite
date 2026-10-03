// 後台「大螢幕」的「遙控」分頁（2026-09-30；2026-10-01 併進 WallHub，舊網址 /planner/wall-remote 會轉過來）：幫手用手機看會場大螢幕現在播什麼，切歌、拖進度、插播、隨機播放、講話模式，
// 不用跑去會場電腦，操作列也不會出現在投影畫面上。
// 這裡按的指令存到後端（routers/wall.py 的 remote/*）再推播給大螢幕，大螢幕做完回報的狀態也推播回來，平常按下去馬上生效；
// 推播斷線時退回輪詢，大約一兩秒後生效。在大螢幕回報之前，畫面先照「按下去的樣子」顯示（pending），回報跟上了就改用真的狀態。
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Clapperboard, ListMusic, Lock, Mic, MicOff, Minus, MonitorSmartphone, Pause, Play, Plus, SkipBack, SkipForward, Wifi, WifiOff } from "lucide-react";
import {
  fetchWallContent, fetchWallRemote, fetchWallScenes, forceUnlockWallRemote, getToken, saveWallContent, saveWallDuck, saveWallSceneContent,
  sendWallRemote, switchWallScene,
} from "../api.js";
import Toggle from "../components/Toggle.jsx";
import { connectLive, wallLiveUrl } from "../live.js";
import { usePlanner } from "./context.js";
import { chooseAsk, confirmAsk, toastErr, toastOk } from "./ui.jsx";
import { PRESETS, presetOf } from "./WallContent.jsx";
import { contentLabel } from "./WallScenes.jsx";

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
  const [liveOn, setLiveOn] = useState(false); // 推播通著：按下去馬上生效
  const [scenes, setScenes] = useState(null); // 場合清單 {items, active, rev}

  // 大螢幕的狀態：推播通著時大螢幕一回報就推過來，這裡只每 10 秒保險問一次；推播斷了就退回每秒問（一個問完才問下一個）。
  // 手機切到背景（鎖螢幕、切 App）就整個停掉、回來再接上，不白白佔著伺服器。畫面每 0.25 秒更新播放時間
  useEffect(() => {
    let alive = true, timer = 0, conn = null, on = false, last = 0;
    const poll = async () => {
      last = Date.now();
      try {
        const r = await fetchWallRemote();
        if (alive) { setSnap({ ...r, at: Date.now() }); setErr(""); }
      } catch (e) { if (alive) setErr(e.message || "連不上伺服器"); }
    };
    const loop = async () => {
      if (!document.hidden && (!on || Date.now() - last >= 10000)) await poll();
      if (alive) timer = setTimeout(loop, 1000);
    };
    const connect = () => {
      if (conn || document.hidden) return;
      conn = connectLive(wallLiveUrl("remote"), {
        token: getToken,
        onEvent: (e) => {
          if (!alive) return;
          if (e.t === "ready") void poll(); // 剛連上：先補抓一次目前的
          else if (e.t === "state") { last = Date.now(); setSnap({ ...e.snap, at: Date.now() }); setErr(""); }
        },
        onStatus: (v) => { on = v; if (alive) setLiveOn(v); },
      });
    };
    const onVisible = () => {
      if (document.hidden) { conn?.close(); conn = null; }
      else { connect(); void poll(); }
    };
    connect();
    loop();
    document.addEventListener("visibilitychange", onVisible);
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => {
      alive = false; clearTimeout(timer); clearInterval(tick); conn?.close();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // 場合：打開時抓一次；有人切了場合、後台改了場合（推播來的狀態帶著 scene、scenes_rev）就重抓
  const sceneKey = snap ? JSON.stringify([snap.scene, snap.scenes_rev]) : "";
  useEffect(() => {
    let alive = true;
    fetchWallScenes().then((d) => { if (alive) setScenes(d); }).catch(() => {});
    return () => { alive = false; };
  }, [sceneKey]);

  const st = snap?.state || null;
  // 回報之後過了多久：播放時間往前推算、判斷大螢幕斷線都用它（推播來的狀態不會自己變舊，要自己看時間；online_s 是伺服器的標準）
  const since = snap ? (snap.age ?? 0) + (now - snap.at) / 1000 : 0;
  const online = !!(snap?.online && st) && since < (snap.online_s ?? 8);
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
      setSent({ text: `已送出「${ACTION_LABEL[action] || action}」，大螢幕${liveOn ? "馬上" : "一兩秒內"}會照做`, at: Date.now() });
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

  // 鎖定的那台電腦壞了、關掉打不開時才用：解除後回到「最後按開始播放的那台」接收遙控
  const forceUnlock = async () => {
    const ok = await confirmAsk({
      title: "強制解除遙控鎖定？",
      text: "解除後，任何一台大螢幕按「開始播放」或「鎖定遙控在這台」都能接走手機遙控。只有鎖定的那台電腦壞了、打不開時才需要；解除後記得在要用的那台再按一次「鎖定遙控在這台」。",
      confirmText: "強制解除",
    });
    if (!ok) return;
    try { await forceUnlockWallRemote(); toastOk("已解除鎖定"); setSnap((s) => (s ? { ...s, locked: false } : s)); }
    catch (e) { toastErr(e); }
  };
  const locked = !!snap?.locked;

  let conn;
  if (err) conn = { cls: "off", icon: WifiOff, text: `連不上伺服器：${err}` };
  else if (!snap) conn = { cls: "wait", icon: Wifi, text: "連線中…" };
  else if (!st) conn = { cls: "off", icon: WifiOff, text: "還沒有大螢幕連線。請在會場電腦開啟大螢幕（後台「大螢幕」→「開啟大螢幕」）並按「開始播放」。" };
  else if (!online && locked) conn = { cls: "off", icon: WifiOff, text: `鎖定的那台大螢幕沒有連線（最後一次回報是 ${ago(since)}前），其他大螢幕不會接手。請在那台電腦重新打開大螢幕（同一個瀏覽器會自動接回鎖定）；那台壞了的話，按下面「強制解除鎖定」改用別台。` };
  else if (!online) conn = { cls: "off", icon: WifiOff, text: `大螢幕沒有連線（最後一次回報是 ${ago(since)}前）。請確認會場電腦的大螢幕還開著、網路正常。` };
  else if (!st.started) conn = { cls: "wait", icon: Wifi, text: "大螢幕已經打開，等現場按「開始播放」後就能遙控。" };
  else conn = { cls: "ok", icon: Wifi, text: `大螢幕連線中 · 留言 ${st.messages ?? 0} 則${st.ok === false && st.status ? ` · ${st.status}` : ""}` };
  const ConnIcon = conn.icon;
  const song = st?.song;
  const queue = ready ? st.queue || [] : [];

  return (
    <div className="wr">
      <div className={`wr-conn ${conn.cls}`}><ConnIcon size={16} /> <span>{conn.text}</span></div>
      {/* 同時開了好幾台大螢幕：只有一台照手機做，要讓人知道控制的是哪一台、怎麼換 */}
      {online && snap.screens > 1 && (
        <div className="wr-conn wait"><MonitorSmartphone size={16} />
          {locked
            ? <span>偵測到 {snap.screens} 台大螢幕同時開著。手機只控制<b>鎖定的那台</b>（上面顯示的就是它），其他台畫面照播、不跟著遙控，用不到的請關掉。</span>
            : <span>偵測到 {snap.screens} 台大螢幕同時開著。手機只控制<b>最後按「開始播放」的那台</b>（上面顯示的就是它），其他台畫面照播、不跟著遙控。
              用不到的請關掉；要改控制另一台，在那台的操作列按「改由這台接收遙控」。</span>}
        </div>
      )}
      {/* 大螢幕那台瀏覽器沒開硬體加速：畫面用 CPU 模擬，會很卡，請現場的人去開 */}
      {online && st.softGL && (
        <div className="wr-conn off"><WifiOff size={16} />
          <span>大螢幕那台電腦的瀏覽器沒有開「硬體加速」，畫面會卡、很吃電腦。請在那台的瀏覽器設定（Edge：edge://settings/system）打開「使用圖形加速」，重新啟動瀏覽器後再開大螢幕。</span>
        </div>
      )}
      {/* 鎖定遙控：婚禮當天別台電腦開了大螢幕也搶不走遙控，播放不會突然換一台 */}
      {locked ? (
        <div className="wr-conn ok wr-lock"><Lock size={16} />
          <span>遙控已鎖定在一台大螢幕，別台搶不走。要換電腦：在鎖定的那台操作列按「解除鎖定」；那台壞了才用這裡的強制解除。</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={forceUnlock}>強制解除鎖定</button>
        </div>
      ) : snap?.state && (
        <div className="helper-text wr-lock-tip">婚禮當天建議在會場電腦的大螢幕操作列按「鎖定遙控在這台」，之後別台大螢幕就搶不走手機遙控。</div>
      )}

      <RemoteScenes scenes={scenes} setScenes={setScenes} playing={ready && !!st.song} />

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
      {/* 講話時音樂剩幾 %（每個場地音響不同，由新人自己設）：五個百分點一格，0 = 完全靜音；講話模式開著時改，大螢幕兩秒內跟上 */}
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

      <RemoteContent scenes={scenes} setScenes={setScenes} />

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

/**
 * 場合：婚禮當天流程走到哪，按一下就把大螢幕整組換成那個場合的歌與畫面（場合在「場合」分頁由新人自己排）。
 * 按了選「馬上換」（音樂淡出、從那個場合的第一首開始）或「這首播完換」（排著，大螢幕這首播完自己換）。
 * 切換存在伺服器（routers/wall_scenes.py），大螢幕從 feed 看到就換；大螢幕還沒開也可以先切，開了就照著播。
 */
function RemoteScenes({ scenes, setScenes, playing }) {
  const { can } = usePlanner();
  const [busy, setBusy] = useState(false);
  if (!scenes) return null;
  const items = scenes.items || [];
  const active = scenes.active || { id: null, next: null };
  const cur = items.find((s) => s.id === active.id) || null;
  const queued = active.next ? (active.next.id == null ? { name: "不指定場合" } : items.find((s) => s.id === active.next.id)) : null;

  const go = async (id, when, okText) => {
    setBusy(true);
    try {
      const r = await switchWallScene(id, when);
      setScenes((d) => (d ? { ...d, active: r.active } : d));
      toastOk(okText);
    } catch (e) { toastErr(e); } finally { setBusy(false); }
  };
  // 換場合會馬上打斷現在的歌：手機上容易誤觸，先問一次，順便讓人選「這首播完換」
  const pick = async (s) => {
    const name = s ? `「${s.name}」` : "不指定場合";
    const again = (s?.id ?? null) === active.id;
    const duck = s?.duck ? "，音樂調小聲（講話模式）" : "";
    const what = s
      ? `${s.song_ids.length ? `換成這個場合的 ${s.song_ids.length} 首歌` : "不換歌"}${duck}，畫面：${contentLabel(s.content)}。`
      : "照整份歌單播、畫面照「內容」分頁。";
    const r = await chooseAsk({
      title: again ? `重新開始${name}？` : `換到${name}？`,
      text: again ? "從這個場合的第一首重新播。" : `大螢幕會${what}`,
      confirmText: again ? "重新開始" : "馬上換",
      denyText: playing && !again ? "這首播完換" : "",
    });
    if (r === "confirm") go(s?.id ?? null, "now", again ? `${name}重新開始` : `大螢幕換到${name}`);
    else if (r === "deny") go(s?.id ?? null, "end", `這首播完換到${name}`);
  };

  return (
    <div className="panel wr-scenes">
      <div className="wr-row">
        <span className="wr-row-label"><Clapperboard size={15} /> 場合</span>
        <span className="wr-scene-now">{cur ? <>現在是<b>「{cur.name}」</b></> : items.length ? "現在沒有指定場合（照歌單播）" : ""}</span>
      </div>
      {queued && (
        <div className="wr-conn wait wr-queued">
          <span>這首播完換到<b>「{queued.name}」</b></span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => go(active.next.id, "now", `大螢幕換到「${queued.name}」`)}>馬上換</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => go(null, "cancel", "已取消")}>取消</button>
        </div>
      )}
      {items.length === 0 ? (
        <div className="helper-text" style={{ margin: 0 }}>
          還沒有設定場合。先把流程（進場、用餐、敬酒…）各放什麼歌、什麼畫面排好，當天在這裡按一下就整組換過去。
          {can("wall_setup") && <> <Link to="/wall?tab=scenes">到「場合」分頁設定</Link></>}
        </div>
      ) : (
        <>
          <div className="wr-scene-grid">
            {items.map((s) => (
              <button key={s.id} type="button" disabled={busy} className={`wr-scene${s.id === active.id ? " on" : ""}${active.next?.id === s.id ? " queued" : ""}`} onClick={() => pick(s)}>
                <b>{s.name}</b>
                <small>{[s.song_ids.length ? `${s.song_ids.length} 首` : "不換歌", s.duck && "講話模式"].filter(Boolean).join(" · ")}</small>
              </button>
            ))}
            <button type="button" disabled={busy || (!cur && !queued)} className={`wr-scene wr-scene-none${!cur ? " on" : ""}`} onClick={() => pick(null)}>
              <b>不指定場合</b><small>照整份歌單播</small>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 畫面放什麼（跟「內容」分頁的組合一樣）：當天想換就在手機上切，例如進場時只放照片、用餐時打開留言。
 * 不經過大螢幕的遙控指令，直接改設定；大螢幕下一次問 feed（推播通著時馬上）就照新的排。
 * 現在的場合有自己的「畫面放什麼」就改那個場合的（大螢幕照場合的設定放），沒有就改「內容」分頁的。
 */
function RemoteContent({ scenes, setScenes }) {
  const [c, setC] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetchWallContent().then(setC).catch(() => {}); }, []);
  if (!c) return null;
  const scene = scenes?.items?.find((s) => s.id === scenes.active?.id) || null;
  const own = scene?.content || null;
  const cur = presetOf(own || c);
  const pick = async (p) => {
    setBusy(true);
    try {
      if (own) setScenes(await saveWallSceneContent(scene.id, { ...p.set, ...(own.mix ? { mix: own.mix } : {}) }));
      else setC(await saveWallContent(p.set));
      toastOk(`大螢幕改成「${p.label}」`);
    } catch (e) { toastErr(e); } finally { setBusy(false); }
  };
  const hint = cur ? PRESETS.find((p) => p.key === cur).hint : "現在是自己調的組合（細項在「內容」分頁）";
  return (
    <div className="panel wr-opts">
      <div className="wr-row"><span className="wr-row-label">畫面放什麼</span></div>
      <div className="wr-content">
        {PRESETS.map((p) => (
          <button key={p.key} type="button" disabled={busy} className={`btn btn-sm ${cur === p.key ? "btn-primary" : "btn-ghost"}`} onClick={() => cur !== p.key && pick(p)}>{p.label}</button>
        ))}
      </div>
      <div className="helper-text" style={{ margin: 0 }}>
        {hint}。按了大螢幕幾秒內就換。
        {scene && (own ? `改的是「${scene.name}」這個場合的畫面。` : `「${scene.name}」跟「內容」分頁一樣，改的是「內容」分頁（其他沒設畫面的場合也會跟著變）。`)}
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
