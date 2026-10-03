// 大螢幕版面一覽（2026-09-28 新人要求：在後台看所有版面的樣子、不喜歡的關掉、調整換版面的節奏）。2026-10-01 起是 WallHub 的「版面」分頁，要 wall_setup 鑰匙。
// 縮圖是 scripts/wall-render.mjs thumbs 拍好的靜態圖（public/wall-thumbs/）；按「預覽」開新分頁，
// 大螢幕用真的歌單與留言只播這個版面（/wall?plate=名字，← → 換下一個）。
// 關掉的版面存在設定 wall_plates_off（逗號分隔），節奏存在 wall_pace（走 /api/planner/wall/plates）；大螢幕每兩秒問一次就會照新的設定排。
import { useId, useMemo, useState } from "react";
import { LayoutGrid, Play, Search, X } from "lucide-react";
import { fetchWallPlates, saveWallPlates } from "../api.js";
import Toggle from "../components/Toggle.jsx";
import { ErrorBox, Loading, toastErr, toastOk, useLoader } from "./ui.jsx";
import { PLATE_CATALOG } from "../wall/plateCatalog";

export const FAMILY = {
  title: "片頭", type: "文字", light: "燈光", doc: "紙本", machine: "機器", screen: "螢幕", science: "科學", craft: "手作", nature: "自然",
  city: "城市", game: "遊戲", water: "水與天空", print: "印刷", keepsake: "信物", instrument: "樂器與遊樂", local: "台灣味", journey: "旅途",
  photo: "照片", sport: "運動", dance: "跳舞", dog: "狗狗", date: "約會", home: "居家", music: "音樂", wedding: "婚禮", cartoon: "漫畫", work: "工程師×護理師", hoops: "籃球賽", live: "演唱會", lingo: "語言", trip: "旅行", kculture: "韓流",
};
// 照片版面最適合哪種照片（版面檔的 spec.prefers）
const KIND = { landscape: "橫的", portrait: "直的", square: "方的", small: "舊照片" };
const PACE = [
  ["fast", "快", "約 4～7 秒換一個版面（每 1～2 句歌詞）"],
  ["normal", "中（建議）", "約 6～10 秒換一個（每 2 句歌詞左右）"],
  ["slow", "慢", "每個版面播久一點（3～5 句歌詞）"],
];
// 搜尋：中文名稱、系列、點子、英文代號都算；名稱開頭符合的排最前面，其次名稱裡有、系列、點子
const norm = (s) => (s || "").toLowerCase();
export function searchPlates(plates, q) {
  const k = norm(q.trim());
  if (!k) return plates;
  const rank = (p) => {
    const t = norm(p.title);
    if (t.startsWith(k)) return 0;
    if (t.includes(k)) return 1;
    if (norm(FAMILY[p.family]).includes(k) || p.name.includes(k)) return 2;
    if (norm(p.idea).includes(k)) return 3;
    return -1;
  };
  return plates.map((p) => [p, rank(p)]).filter(([, r]) => r >= 0).sort((a, b) => a[1] - b[1]).map(([p]) => p);
}
/** 名稱裡打到的字標出來 */
function Hit({ text, q }) {
  const i = q ? norm(text).indexOf(norm(q.trim())) : -1;
  if (i < 0) return text;
  const n = q.trim().length;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + n)}</mark>{text.slice(i + n)}</>;
}

const open = (name) => window.open(`/wall?plate=${encodeURIComponent(name)}`, "_blank", "noopener");

export default function WallPlates() {
  const { data: settings, setData: setSettings, loading, error } = useLoader(fetchWallPlates, []); // { off: [...], pace }
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [sugOpen, setSugOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const [saving, setSaving] = useState(false);
  const plates = useMemo(() => PLATE_CATALOG.filter((p) => p.name !== "title"), []);
  const off = useMemo(() => new Set(settings?.off || []), [settings]);
  const pace = settings?.pace || "normal";
  const families = useMemo(() => [...new Set(plates.map((p) => p.family))], [plates]);

  const save = async (values, okText) => {
    setSaving(true);
    try { setSettings(await saveWallPlates(values)); if (okText) toastOk(okText); } catch (e) { toastErr(e); } finally { setSaving(false); }
  };
  const toggle = (name, on) => {
    const next = new Set(off);
    if (on) next.delete(name); else next.add(name);
    save({ off: [...next] }, on ? "這個版面會出現在大螢幕" : "這個版面不會再出現");
  };

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const byChip = plates.filter((p) => !filter || (filter === "off" ? off.has(p.name) : filter === "couple" ? p.couple : filter === "bilingual" ? p.bilingual : p.family === filter));
  const shown = searchPlates(byChip, query);
  // 建議清單：打一個字就跳，最多 8 個（照上面的分類一起篩）
  const sugs = query.trim() ? shown.slice(0, 8) : [];
  const showSug = sugOpen && sugs.length > 0;
  const pick = (p) => { setQuery(p.title); setSugOpen(false); setActive(-1); };
  const onCount = plates.filter((p) => !off.has(p.name)).length;

  return (
    <div>
      <div className="wall-tab-intro">
        <div className="pl-sub">共 {plates.length} 個版面，現場會播 {onCount} 個。點縮圖或「預覽」會開新分頁，用你們的歌單實際播這個版面（← → 換上一個／下一個）；不喜歡的把「要播」關掉。</div>
        <button type="button" className="btn btn-primary" onClick={() => open(plates[0]?.name)}><Play size={15} /> 從第一個開始預覽</button>
      </div>

      <div className="panel">
        <div className="panel-head"><div className="panel-title"><LayoutGrid size={18} /> 換版面的節奏</div></div>
        <div className="wp-pace">
          {PACE.map(([k, label, hint]) => (
            <button key={k} type="button" disabled={saving} className={`btn ${pace === k ? "btn-primary" : "btn-ghost"}`} onClick={() => pace !== k && save({ pace: k }, `節奏改成「${label}」`)}>
              <span>{label}</span><small>{hint}</small>
            </button>
          ))}
        </div>
        <p className="helper-text" style={{ marginBottom: 0 }}>留言比較長的時候，版面會自動多停一下，讓大家讀完。</p>
      </div>

      <div className="ws-summary" style={{ marginTop: 16 }}>
        <button type="button" className={`btn btn-sm ${!filter ? "btn-primary" : "btn-ghost"}`} onClick={() => setFilter("")}>全部 {plates.length}</button>
        <button type="button" className={`btn btn-sm ${filter === "couple" ? "btn-primary" : "btn-ghost"}`} onClick={() => setFilter("couple")}>有人物 {plates.filter((p) => p.couple).length}</button>
        <button type="button" className={`btn btn-sm ${filter === "bilingual" ? "btn-primary" : "btn-ghost"}`} onClick={() => setFilter("bilingual")} title="有中文翻譯的歌（韓文歌）只會播這些版面">雙語 {plates.filter((p) => p.bilingual).length}</button>
        {families.map((f) => (
          <button key={f} type="button" className={`btn btn-sm ${filter === f ? "btn-primary" : "btn-ghost"}`} onClick={() => setFilter(f)}>{FAMILY[f] || f} {plates.filter((p) => p.family === f).length}</button>
        ))}
        {off.size > 0 && <button type="button" className={`btn btn-sm ${filter === "off" ? "btn-primary" : "btn-ghost"}`} onClick={() => setFilter("off")}>已關掉 {off.size}</button>}
      </div>

      <div className="wp-search" onKeyDown={(e) => e.key === "Escape" && setSugOpen(false)}>
        <div className="seatviewer-search">
          <Search size={16} />
          <input
            type="text" value={query} placeholder="搜尋版面：打一個字就好，例如「狗」「籃球」「雨」"
            role="combobox" aria-autocomplete="list" aria-expanded={showSug} aria-controls={showSug ? listId : undefined}
            aria-activedescendant={showSug && active >= 0 ? `${listId}-${active}` : undefined}
            onChange={(e) => { setQuery(e.target.value); setSugOpen(true); setActive(-1); }}
            onFocus={() => setSugOpen(true)}
            onBlur={() => setSugOpen(false)}
            onKeyDown={(e) => {
              if (!showSug) return;
              if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, Math.min(sugs.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))); }
              if (e.key === "Enter") { e.preventDefault(); if (sugs[active]) pick(sugs[active]); else setSugOpen(false); }
            }}
          />
          {query && <button type="button" className="seatviewer-search-clear" aria-label="清除搜尋" onMouseDown={(e) => e.preventDefault()} onClick={() => { setQuery(""); setActive(-1); }}><X size={14} /></button>}
        </div>
        {showSug && (
          <ul id={listId} className="ui-select-menu" role="listbox" aria-label="符合的版面">
            {sugs.map((p, i) => (
              <li key={p.name} id={`${listId}-${i}`} role="option" aria-selected={active === i}
                className={`ui-select-option wp-sug${active === i ? " active" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); pick(p); }}>
                <img src={`/wall-thumbs/${p.name}.jpg`} alt="" loading="lazy" />
                <span className="wp-sug-text"><span className="wp-sug-title"><Hit text={p.title} q={query} /></span><span className="wp-sug-idea">{p.idea}</span></span>
                <span className="pill pill-groom">{FAMILY[p.family] || p.family}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {query.trim() && <div className="wp-search-count">找到 {shown.length} 個版面{shown.length === 0 ? "，換個字試試看" : ""}</div>}

      <div className="wp-grid">
        {shown.map((p) => {
          const on = !off.has(p.name);
          return (
            <div key={p.name} className={`wp-card${on ? "" : " off"}`}>
              <button type="button" className="wp-thumb" onClick={() => open(p.name)} title="預覽這個版面">
                <img src={`/wall-thumbs/${p.name}.jpg`} alt={p.title} loading="lazy" />
                <span className="wp-play"><Play size={18} /></span>
              </button>
              <div className="wp-body">
                <div className="wp-title">{p.title}</div>
                <div className="wp-idea">{p.idea}</div>
                <div className="wp-meta">
                  <span className="pill pill-groom">{FAMILY[p.family] || p.family}</span>
                  <span className="pill">{p.light ? "亮" : "暗"}</span>
                  {p.bilingual && <span className="pill pill-yes" title="有翻譯的歌會播：中文與原文兩行都畫">雙語</span>}
                  {p.photo && <span className="pill pill-yes" title="在「內容」分頁打開照片時，用來放你們的照片">{p.photos > 1 ? `放 ${p.photos} 張照片` : "放照片"}</span>}
                  {p.photo && p.prefers?.length > 0 && <span className="pill" title="大螢幕會先看接下來是什麼照片，優先挑適合的版面">適合{p.prefers.map((k) => KIND[k]).join("、")}</span>}
                  <label className="wall-msg-toggle wp-toggle"><Toggle checked={on} disabled={saving} onChange={(v) => toggle(p.name, v)} label="要播" /> 要播</label>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
