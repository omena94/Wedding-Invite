// 大螢幕版面一覽（2026-09-28 新人要求：在後台看所有版面的樣子、不喜歡的關掉、調整換版面的節奏）。
// 縮圖是 scripts/wall-render.mjs thumbs 拍好的靜態圖（public/wall-thumbs/）；按「預覽」開新分頁，
// 大螢幕用真的歌單與留言只播這個版面（/wall?plate=名字，← → 換下一個）。
// 關掉的版面存在設定 wall_plates_off（逗號分隔），節奏存在 wall_pace；大螢幕每兩秒問一次就會照新的設定排。
import { useMemo, useState } from "react";
import { LayoutGrid, Play } from "lucide-react";
import { fetchPlannerSettings, savePlannerSettings } from "../api.js";
import Toggle from "../components/Toggle.jsx";
import { ErrorBox, Loading, PageHead, toastErr, toastOk, useLoader } from "./ui.jsx";
import { PLATE_CATALOG } from "../wall/plateCatalog";

const FAMILY = {
  title: "片頭", type: "文字", light: "燈光", doc: "紙本", machine: "機器", screen: "螢幕", science: "科學", craft: "手作", nature: "自然",
  city: "城市", game: "遊戲", water: "水與天空", print: "印刷", keepsake: "信物", instrument: "樂器與遊樂", local: "台灣味", journey: "旅途",
  sport: "運動", dance: "跳舞", dog: "狗狗", date: "約會", home: "居家", music: "音樂", wedding: "婚禮", cartoon: "漫畫", work: "工程師×護理師", hoops: "籃球賽", live: "演唱會", lingo: "語言", trip: "旅行", kculture: "韓流",
};
const PACE = [
  ["fast", "快", "約 4～7 秒換一個版面（每 1～2 句歌詞）"],
  ["normal", "中（建議）", "約 6～10 秒換一個（每 2 句歌詞左右）"],
  ["slow", "慢", "每個版面播久一點（3～5 句歌詞）"],
];
const open = (name) => window.open(`/wall?plate=${encodeURIComponent(name)}`, "_blank", "noopener");

export default function WallPlates() {
  const { data: settings, setData: setSettings, loading, error } = useLoader(fetchPlannerSettings, []);
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const plates = useMemo(() => PLATE_CATALOG.filter((p) => p.name !== "title"), []);
  const off = useMemo(() => new Set((settings?.values?.wall_plates_off || "").split(",").filter(Boolean)), [settings]);
  const pace = settings?.values?.wall_pace || "normal";
  const families = useMemo(() => [...new Set(plates.map((p) => p.family))], [plates]);

  const save = async (values, okText) => {
    setSaving(true);
    try { setSettings(await savePlannerSettings(values)); if (okText) toastOk(okText); } catch (e) { toastErr(e); } finally { setSaving(false); }
  };
  const toggle = (name, on) => {
    const next = new Set(off);
    if (on) next.delete(name); else next.add(name);
    save({ wall_plates_off: [...next].join(",") }, on ? "這個版面會出現在大螢幕" : "這個版面不會再出現");
  };

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const shown = plates.filter((p) => !filter || (filter === "off" ? off.has(p.name) : filter === "couple" ? p.couple : filter === "bilingual" ? p.bilingual : p.family === filter));
  const onCount = plates.filter((p) => !off.has(p.name)).length;

  return (
    <div>
      <PageHead title="大螢幕版面" sub={`共 ${plates.length} 個版面，現場會播 ${onCount} 個。點縮圖或「預覽」會開新分頁，用你們的歌單實際播這個版面（← → 換上一個／下一個）；不喜歡的把「要播」關掉。`}
        actions={<button type="button" className="btn btn-primary" onClick={() => open(plates[0]?.name)}><Play size={15} /> 從第一個開始預覽</button>} />

      <div className="panel">
        <div className="panel-head"><div className="panel-title"><LayoutGrid size={18} /> 換版面的節奏</div></div>
        <div className="wp-pace">
          {PACE.map(([k, label, hint]) => (
            <button key={k} type="button" disabled={saving} className={`btn ${pace === k ? "btn-primary" : "btn-ghost"}`} onClick={() => pace !== k && save({ wall_pace: k }, `節奏改成「${label}」`)}>
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
