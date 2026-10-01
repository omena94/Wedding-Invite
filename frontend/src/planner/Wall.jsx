// 後台「大螢幕」的「留言」分頁（2026-09-28 原「現場留言」頁；2026-10-01 併進 WallHub）：賓客在 /wish 寫的祝福、開關、/wish 的 QR code。
// 要 wall 鑰匙；開關存在設定表（wall_open、wall_moderation），走 /api/planner/wall/options，不需要「設定」權限。
// 歌單搬到「歌單」分頁，「手機遙控」與「開啟大螢幕」按鈕搬到 WallHub 的頁首。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import { Check, Download, MessageSquareHeart, Plus, QrCode, Trash2 } from "lucide-react";
import {
  createWallMessage, deleteWallMessage, fetchWallMessages, fetchWallOptions, saveWallOptions, updateWallMessage,
} from "../api.js";
import Toggle from "../components/Toggle.jsx";
import { Empty, ErrorBox, Loading, Modal, confirmDelete, toastErr, toastOk, useLoader } from "./ui.jsx";

const TEXT_MAX = 60; // 跟後端、/wish 一致
const NAME_MAX = 20;
const COUPLE_NAME = "宣文 & 孟庭";
const REFRESH_MS = 10000;
const STATUS = {
  show: { label: "顯示中", pill: "pill-yes" },
  pending: { label: "待審核", pill: "pill-warn" },
  hide: { label: "已隱藏", pill: "pill-no" },
};
const FILTERS = [["", "全部"], ["show", "顯示中"], ["pending", "待審核"], ["hide", "已隱藏"]];

// 今天的只顯示時間；婚禮前試寫的、隔天回頭看的，前面加日期才分得出來
function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const hm = d.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
  return d.toDateString() === new Date().toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

export default function Wall() {
  const { data, setData, loading, error } = useLoader(fetchWallMessages, []);
  const { data: settings, setData: setSettings, error: settingsError } = useLoader(fetchWallOptions, []); // { open, moderation }
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");
  const [addName, setAddName] = useState(COUPLE_NAME);
  const [addText, setAddText] = useState("");
  const [adding, setAdding] = useState(false);
  const [working, setWorking] = useState(null); // 正在改哪一則（按鈕先鎖住，避免連點）
  // 每次改動就 +1：改動途中送出去的輪詢，回來時已經過時，丟掉才不會畫面跳回舊狀態
  const gen = useRef(0);

  const refresh = useCallback(async () => {
    const g = gen.current;
    try {
      const d = await fetchWallMessages();
      if (g === gen.current) setData(d);
    } catch { /* 輪詢失敗就等下一輪，不打斷畫面 */ }
  }, [setData]);

  // 開著這頁時每 10 秒抓一次新留言；分頁在背景時不抓。只換資料不重畫整頁，捲動位置不會跑掉
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const mutate = async (id, fn) => {
    gen.current += 1;
    setWorking(id);
    try { await fn(); } catch (e) { toastErr(e); } finally { gen.current += 1; setWorking(null); }
  };
  const replaceItem = (m) => setData((d) => ({ ...d, items: d.items.map((x) => (x.id === m.id ? m : x)) }));
  const setStatus = (m, status) => mutate(m.id, async () => replaceItem(await updateWallMessage(m.id, { status })));
  const remove = async (m) => {
    if (!(await confirmDelete(`這則留言（${m.text.length > 12 ? `${m.text.slice(0, 12)}…` : m.text}）`))) return;
    mutate(m.id, async () => {
      await deleteWallMessage(m.id);
      setData((d) => ({ ...d, items: d.items.filter((x) => x.id !== m.id) }));
    });
  };
  const add = async (e) => {
    e.preventDefault();
    if (!addText.trim()) return;
    setAdding(true);
    await mutate("add", async () => {
      const m = await createWallMessage({ name: addName.trim(), text: addText.trim() });
      setData((d) => ({ ...d, items: [m, ...d.items] }));
      setAddText("");
      toastOk("已加到大螢幕");
    });
    setAdding(false);
  };

  const toggleSetting = async (key, on, okText) => {
    setSaving(true);
    try { setSettings(await saveWallOptions({ [key]: on })); toastOk(okText); } catch (e) { toastErr(e); } finally { setSaving(false); }
  };

  const items = useMemo(() => data?.items || [], [data]);
  const counts = useMemo(() => {
    const c = { show: 0, pending: 0, hide: 0 };
    items.forEach((m) => { c[m.status] = (c[m.status] || 0) + 1; });
    return c;
  }, [items]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const open = !!settings?.open;
  const moderation = !!settings?.moderation;
  const shown = filter ? items.filter((m) => m.status === filter) : items;
  const wishUrl = `${location.origin}/wish`;

  return (
    <div>
      <div className="wall-top">
        <div className="panel">
          <div className="panel-head"><div className="panel-title"><MessageSquareHeart size={18} /> 開關</div></div>
          {settingsError ? <ErrorBox error={settingsError} /> : (
            <div className="pl-switch-list">
              <div className="pl-switch" onClick={() => !saving && settings && toggleSetting("open", !open, open ? "已關閉賓客留言" : "已開放賓客留言")}>
                <Toggle checked={open} disabled={saving || !settings} onChange={(v) => toggleSetting("open", v, v ? "已開放賓客留言" : "已關閉賓客留言")} label="開放賓客留言" />
                <div>
                  <div className="pl-list-title">開放賓客留言（/wish） <span className={`pill ${open ? "pill-yes" : "pill-no"}`}>{open ? "開放中" : "關閉"}</span></div>
                  <div className="pl-list-sub">賓客不用登入就能寫；關著的時候只有登入的人能試寫。</div>
                </div>
              </div>
              <div className="pl-switch" onClick={() => !saving && settings && toggleSetting("moderation", !moderation, moderation ? "新留言會直接上螢幕" : "新留言要先審核")}>
                <Toggle checked={moderation} disabled={saving || !settings} onChange={(v) => toggleSetting("moderation", v, v ? "新留言要先審核" : "新留言會直接上螢幕")} label="留言先審核再上螢幕" />
                <div>
                  <div className="pl-list-title">留言先審核再上螢幕 <span className={`pill ${moderation ? "pill-warn" : "pill-yes"}`}>{moderation ? "先審核" : "直接上螢幕"}</span></div>
                  <div className="pl-list-sub">開著時新留言要按「通過」才會出現；關著時送出就直接上螢幕，不妥的可以隨時隱藏。</div>
                </div>
              </div>
            </div>
          )}
        </div>
        <WishQr url={wishUrl} />
      </div>

      <div className="stats-grid">
        <div className="stat-card"><div className="value">{counts.show}</div><div className="label">顯示中</div></div>
        <div className="stat-card"><div className="value">{counts.pending}</div><div className="label">待審核</div></div>
        <div className="stat-card"><div className="value">{counts.hide}</div><div className="label">已隱藏</div></div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div className="panel-title"><MessageSquareHeart size={18} /> 留言</div>
          <span className="helper-text">每 10 秒自動更新</span>
        </div>
        <form className="wall-add" onSubmit={add}>
          <input type="text" value={addName} onChange={(e) => setAddName(e.target.value)} maxLength={NAME_MAX} placeholder="署名" aria-label="署名" />
          <input type="text" value={addText} onChange={(e) => setAddText(e.target.value)} maxLength={TEXT_MAX} placeholder="新人也可以自己寫一則，例如：謝謝大家今天來！" aria-label="留言內容" />
          <button type="submit" className="btn btn-primary" disabled={adding || !addText.trim()}><Plus size={15} /> 加到大螢幕</button>
        </form>
        <div className="helper-text" style={{ marginBottom: 16 }}>{addText.length} / {TEXT_MAX} 字 · 新人加的不用審核，直接上螢幕</div>

        <div className="toolbar" style={{ marginBottom: 8, gap: 6 }}>
          {FILTERS.map(([key, label]) => (
            <button key={key || "all"} type="button" className={`btn btn-sm ${filter === key ? "btn-primary" : "btn-ghost"}`} onClick={() => setFilter(key)}>
              {label} {key ? counts[key] : items.length}
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <Empty>{items.length === 0 ? "還沒有留言。開放後把 /wish 的 QR code 放在會場，賓客寫的祝福就會出現在這裡。" : "這個分類沒有留言。"}</Empty>
        ) : (
          <ul className="wall-msg-list">
            {shown.map((m) => {
              const st = STATUS[m.status] || STATUS.hide;
              const busy = working === m.id;
              return (
                <li key={m.id} className={`wall-msg ${m.status}`}>
                  <div className="wall-msg-main">
                    <div className="wall-msg-meta">
                      <span className="wall-msg-name">{m.name || "匿名"}</span>
                      {m.source === "couple" && <span className="pill pill-groom">新人</span>}
                      <span>{fmtTime(m.created_at)}</span>
                      <span className={`pill ${st.pill}`}>{st.label}</span>
                    </div>
                    <div className="wall-msg-text">{m.text}</div>
                  </div>
                  <div className="wall-msg-actions">
                    {m.status === "pending" && (
                      <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => setStatus(m, "show")}><Check size={13} /> 通過</button>
                    )}
                    <span className="wall-msg-toggle">
                      <Toggle checked={m.status === "show"} disabled={busy} onChange={(v) => setStatus(m, v ? "show" : "hide")} label={`上螢幕：${m.text}`} />
                      上螢幕
                    </span>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => remove(m)} title="刪除"><Trash2 size={13} /></button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

    </div>
  );
}

const QUIET = 4; // QR code 四周要留 4 格白邊，手機才掃得到

function makeQr(text) {
  const qr = qrcode(0, "M"); // 0 = 依內容自動選大小；M 級容錯，印出來有點髒也掃得到
  qr.addData(text);
  qr.make();
  return qr;
}

// QR code 的 SVG 路徑：一格一個小方塊，四周留白
function qrPath(qr) {
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + QUIET},${r + QUIET}h1v1h-1z`;
  return d;
}

// 手機遙控頁的 QR code（2026-09-30）：幫手用手機相機掃，登入後就能遙控大螢幕。WallHub 頁首的「手機遙控」用
export function RemoteQr({ url, onClose }) {
  const qr = useMemo(() => makeQr(url), [url]);
  const size = qr.getModuleCount() + QUIET * 2;
  return (
    <Modal title="用手機遙控大螢幕" onClose={onClose}>
      <div className="wall-qr">
        <svg className="wall-qr-code" viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label={`QR code：${url}`}>
          <rect width={size} height={size} fill="#fff" />
          <path d={qrPath(qr)} fill="#000" />
        </svg>
        <div className="wall-qr-side">
          <div className="wall-qr-url">{url}</div>
          <div className="helper-text">
            用手機相機掃，登入後台（新人密碼，或有「大螢幕：當天操作」權限的幫手密碼）就是遙控器：切歌、拖進度、插播、講話模式。
            也可以在手機後台的選單點「大螢幕」，再切到「遙控」。會場電腦的大螢幕要先按「開始播放」。
          </div>
        </div>
      </div>
    </Modal>
  );
}

// 賓客留言頁的 QR code：畫面上用 SVG，下載用 canvas 另外畫一張夠大的 PNG（印海報、放桌卡）
function WishQr({ url }) {
  const qr = useMemo(() => makeQr(url), [url]);
  const n = qr.getModuleCount();
  const path = useMemo(() => qrPath(qr), [qr]);
  const size = n + QUIET * 2;

  const download = () => {
    const scale = Math.ceil(1200 / size);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size * scale;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + QUIET) * scale, (r + QUIET) * scale, scale, scale);
    canvas.toBlob((blob) => {
      if (!blob) { toastErr(new Error("圖檔產生失敗，請再試一次")); return; }
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = href; a.download = "現場留言-QRcode.png"; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 5000);
    }, "image/png");
  };

  return (
    <div className="panel">
      <div className="panel-head"><div className="panel-title"><QrCode size={18} /> 賓客留言的 QR code</div></div>
      <div className="wall-qr">
        <svg className="wall-qr-code" viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label={`QR code：${url}`}>
          <rect width={size} height={size} fill="#fff" />
          <path d={path} fill="#000" />
        </svg>
        <div className="wall-qr-side">
          <div className="wall-qr-url">{url}</div>
          <div className="helper-text">印出來放在會場（桌卡、大螢幕旁），賓客用手機相機掃就能留言。</div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={download}><Download size={13} /> 下載 QR code 圖檔</button>
        </div>
      </div>
    </div>
  );
}
