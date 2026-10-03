// 後台「大螢幕」的「場合」分頁（WallHub 裡，要 wall_setup 鑰匙）：把婚禮當天的流程分成幾個場合
// （迎賓、新人進場、證婚致詞、用餐、敬酒、送客…），每個場合先挑好歌與畫面；當天在「遙控」分頁按一下場合，大螢幕就整組換過去。
// 流程由新人自己決定（2026-10-03），所以場合全部由新人自己新增、改名、排順序、挑歌；「常見流程」只是範本，加進來之後一樣可以改、可以刪。
// 場合沒設的東西照原本的設定：畫面放什麼照「內容」分頁、版面照「版面」分頁、配色照每首歌自己的；沒挑歌就是不換歌（致詞只要把音樂調小聲）。
// 後端是 routers/wall_scenes.py（app/wall_scenes.py），大螢幕怎麼照著播見 docs/wall/CONTENT.md「場合」。
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, LayoutGrid, ListMusic, Mic, Monitor, Music, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import {
  addWallSceneTemplate, createWallScene, deleteWallScene, fetchWallScenes, fetchWallSongs, reorderWallScenes, updateWallScene,
} from "../api.js";
import Select from "../components/Select.jsx";
import Toggle from "../components/Toggle.jsx";
import { confirmDelete, Empty, ErrorBox, Field, Loading, Modal, toastErr, toastOk, useLoader } from "./ui.jsx";
import { MIX, PRESETS, presetOf } from "./WallContent.jsx";
import { FAMILY, searchPlates } from "./WallPlates.jsx";
import { PLATE_CATALOG } from "../wall/plateCatalog";
import { THEMES } from "../wall/themes";

// 常見的場合名稱：新增時點一下就填好（致詞、儀式順便打開講話模式）
const NAME_IDEAS = [
  ["迎賓入席"], ["新人進場"], ["證婚致詞", { duck: true }], ["文定儀式", { duck: true }], ["用餐"], ["二次進場"],
  ["敬酒"], ["切蛋糕"], ["抽捧花"], ["送客"],
];
const PACE = [["", "照「版面」分頁"], ["fast", "快"], ["normal", "中"], ["slow", "慢"]];
const EMPTY = { name: "", song_ids: [], shuffle: false, content: null, plates: [], pace: "", theme: "", duck: false, after_id: null };
const mmss = (x) => { const v = Math.max(0, Math.round(x || 0)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`; };
const songLen = (s) => Math.max(0, (s.end_at || s.duration || 0) - (s.start_at || 0));
const themeLabel = (k) => THEMES.find((t) => t.key === k)?.label || "";
const PLATES = PLATE_CATALOG.filter((p) => p.name !== "title");

/** 畫面放什麼的一句話：組合的名字，或自己調的那幾樣 */
export function contentLabel(c) {
  if (!c) return "跟「內容」分頁一樣";
  const p = PRESETS.find((x) => x.key === presetOf(c));
  if (p) return p.label;
  const on = [c.lyrics && "歌詞", c.messages && "留言", c.photos && "照片"].filter(Boolean);
  return on.length ? on.join("＋") : "只放音樂";
}

export default function WallScenes() {
  const { data, setData, loading, error } = useLoader(fetchWallScenes, []);
  const { data: songData } = useLoader(fetchWallSongs, []);
  const [edit, setEdit] = useState(null); // { scene } 或 { scene: null, preset } 新增
  const [busy, setBusy] = useState(false);
  const songs = useMemo(() => songData?.items || [], [songData]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const items = data.items;
  const byId = Object.fromEntries(items.map((s) => [s.id, s]));

  const run = async (fn, ok) => {
    setBusy(true);
    try { setData(await fn()); if (ok) toastOk(ok); } catch (e) { toastErr(e); } finally { setBusy(false); }
  };
  // 上下移：跟上一個／下一個交換，整份清單的順序一起存
  const move = (s, dir) => {
    const ids = items.map((x) => x.id);
    const i = ids.indexOf(s.id), j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    run(() => reorderWallScenes(ids));
  };
  const remove = async (s) => {
    if (await confirmDelete(s.name)) run(() => deleteWallScene(s.id), "已刪除");
  };
  const template = () => run(() => addWallSceneTemplate(), "已加入常見流程，接著幫每個場合挑歌");

  return (
    <div>
      <div className="wall-tab-intro">
        <div className="pl-sub">把當天的流程分成幾個場合，每個場合先挑好歌和畫面。婚禮當天在「遙控」按一下場合，大螢幕就換成那個場合的歌與畫面。沒有切到任何場合時，大螢幕照「歌單」的順序播。</div>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => setEdit({ scene: null })}><Plus size={15} /> 新增場合</button>
      </div>

      {items.length === 0 && (
        <div className="panel wsc-start">
          <div className="ws-empty-title">還沒有場合</div>
          <p className="helper-text">
            可以先一次加入常見的流程：迎賓入席、新人進場（播完自動回到用餐）、證婚致詞（自動把音樂調小聲）、用餐、二次進場、敬酒、送客，
            再幫每個場合挑歌；用不到的刪掉、名字不對就改。也可以按「新增場合」從頭自己排。
          </p>
          <div className="wsc-start-acts">
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={template}><ListMusic size={15} /> 加入常見流程</button>
          </div>
        </div>
      )}

      <ol className="wsc-list">
        {items.map((s, k) => (
          <SceneCard key={s.id} scene={s} no={k + 1} songs={songs} byId={byId} active={data.active?.id === s.id} busy={busy}
            first={k === 0} last={k === items.length - 1}
            onUp={() => move(s, -1)} onDown={() => move(s, 1)} onEdit={() => setEdit({ scene: s })} onDelete={() => remove(s)} />
        ))}
      </ol>

      {items.length > 0 && (
        <p className="helper-text">
          婚禮當天在「遙控」分頁按場合，可以「馬上換」（音樂淡出、從這個場合的第一首開始）或「這首播完換」。
          沒挑歌的場合不換歌，接著播原本的歌；歌單關掉「要播」的歌，挑進場合照樣會播（例如進場曲只在進場時播）。
        </p>
      )}

      {edit && (
        <SceneModal scene={edit.scene} items={items} songs={songs} onClose={() => setEdit(null)}
          onSaved={(d) => { setData(d); setEdit(null); }} />
      )}
    </div>
  );
}

function SceneCard({ scene: s, no, songs, byId, active, busy, first, last, onUp, onDown, onEdit, onDelete }) {
  const rows = s.song_ids.map((id) => songs.find((x) => x.id === id)).filter(Boolean);
  const after = s.after_id ? byId[s.after_id] : null;
  const look = [
    s.plates.length ? `只用 ${s.plates.length} 個版面` : "",
    s.theme ? `配色：${themeLabel(s.theme)}` : "",
    s.pace ? `節奏：${PACE.find(([k]) => k === s.pace)?.[1]}` : "",
  ].filter(Boolean);
  return (
    <li className={`wsc-card${active ? " on" : ""}`}>
      <div className="ws-order">
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy || first} onClick={onUp} aria-label={`「${s.name}」往前移`}><ArrowUp size={14} /></button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy || last} onClick={onDown} aria-label={`「${s.name}」往後移`}><ArrowDown size={14} /></button>
      </div>
      <span className="ws-no">{no}</span>
      <div className="wsc-main">
        <div className="wsc-title">
          {s.name}
          {active && <span className="pill pill-yes">大螢幕現在是這個場合</span>}
          {s.duck && <span className="pill pill-groom"><Mic size={11} /> 講話模式</span>}
        </div>
        <div className="wsc-line"><Music size={13} />
          {rows.length
            ? <span>{rows.length} 首{s.shuffle && rows.length > 1 ? "（隨機）" : ""}：{rows.slice(0, 3).map((r) => r.title).join("、")}{rows.length > 3 ? "…" : ""}</span>
            : <span className="muted-cell">不換歌，接著播原本的歌</span>}
        </div>
        {rows.length > 0 && <div className="wsc-line muted-cell">播完之後：{after ? `換到「${after.name}」` : "重複播這些歌"}</div>}
        <div className="wsc-line"><Monitor size={13} /><span>畫面：{contentLabel(s.content)}{look.length ? `　·　${look.join("　·　")}` : ""}</span></div>
      </div>
      <div className="ws-actions">
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onEdit}><Pencil size={14} /> 編輯</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onDelete} aria-label={`刪除「${s.name}」`}><Trash2 size={14} /></button>
      </div>
    </li>
  );
}

function SceneModal({ scene, items, songs, onClose, onSaved }) {
  const isNew = !scene;
  const [form, setForm] = useState(() => ({ ...EMPTY, ...(scene || {}) }));
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState(() => !scene?.song_ids?.length);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const chosen = form.song_ids.map((id) => songs.find((s) => s.id === id)).filter(Boolean);
  const rest = songs.filter((s) => !form.song_ids.includes(s.id));
  const total = chosen.reduce((n, s) => n + songLen(s), 0);
  const others = items.filter((s) => s.id !== scene?.id);
  const c = form.content;

  const moveSong = (k, dir) => {
    const ids = [...form.song_ids];
    const j = k + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[k], ids[j]] = [ids[j], ids[k]];
    set("song_ids", ids);
  };
  const save = async () => {
    if (!form.name.trim()) { toastErr(new Error("請幫這個場合取個名字，例如「新人進場」")); return; }
    setBusy(true);
    const body = { ...form, name: form.name.trim(), after_id: form.song_ids.length ? form.after_id : null };
    delete body.id; delete body.sort_order;
    try { onSaved(await (isNew ? createWallScene(body) : updateWallScene(scene.id, body))); toastOk(isNew ? "已新增場合" : "已儲存"); }
    catch (e) { toastErr(e); } finally { setBusy(false); }
  };

  return (
    <Modal wide className="wsc-editor" title={isNew ? "新增場合" : `編輯「${scene.name}」`} onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>取消</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "儲存中…" : "儲存"}</button>
      </>}>
      <Field label="場合名稱" required hint="遙控上按的就是這個名字，取當天大家講的說法就好。">
        <input type="text" value={form.name} maxLength={20} placeholder="例如：新人進場" onChange={(e) => set("name", e.target.value)} />
        {isNew && (
          <div className="wsc-ideas">
            {NAME_IDEAS.filter(([n]) => !items.some((s) => s.name === n)).map(([n, extra]) => (
              <button key={n} type="button" className={`btn btn-sm ${form.name === n ? "btn-primary" : "btn-ghost"}`} onClick={() => setForm((f) => ({ ...f, name: n, ...(extra || {}) }))}>{n}</button>
            ))}
          </div>
        )}
      </Field>

      <div className="wsc-sec">
        <div className="wsc-sec-title"><Music size={16} /> 這個場合播的歌 <span className="muted-cell">{chosen.length ? `${chosen.length} 首、約 ${Math.max(1, Math.round(total / 60))} 分鐘` : ""}</span></div>
        {chosen.length === 0 ? (
          <div className="wc-note">還沒挑歌：切到這個場合時<b>不換歌</b>，接著播原本的歌。適合證婚、致詞這種只要把音樂調小聲的時候；要換歌就從下面加。</div>
        ) : (
          <ol className="wsc-songs">
            {chosen.map((s, k) => (
              <li key={s.id}>
                <span className="ws-no">{k + 1}</span>
                <span className="wsc-song"><b>{s.title}</b><small>{[s.artist, mmss(songLen(s)), !s.enabled && "歌單沒開「要播」，只在場合裡播"].filter(Boolean).join(" · ")}</small></span>
                <button type="button" className="btn btn-ghost btn-sm" disabled={k === 0} onClick={() => moveSong(k, -1)} aria-label={`「${s.title}」往前`}><ArrowUp size={13} /></button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={k === chosen.length - 1} onClick={() => moveSong(k, 1)} aria-label={`「${s.title}」往後`}><ArrowDown size={13} /></button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => set("song_ids", form.song_ids.filter((x) => x !== s.id))} aria-label={`拿掉「${s.title}」`}><X size={13} /></button>
              </li>
            ))}
          </ol>
        )}
        {songs.length === 0 ? (
          <div className="helper-text">歌單還是空的，先到「歌單」分頁上傳歌。</div>
        ) : rest.length > 0 && !adding ? (
          <button type="button" className="btn btn-ghost btn-sm wsc-add-btn" onClick={() => setAdding(true)}><Plus size={14} /> 加歌（還有 {rest.length} 首）</button>
        ) : rest.length > 0 && (
          <div className="wsc-add">
            <div className="wsc-add-head">
              <span>從歌單加歌</span>
              {rest.length > 1 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => set("song_ids", [...form.song_ids, ...rest.map((s) => s.id)])}>全部加入</button>}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)} aria-label="收起加歌"><X size={13} /></button>
            </div>
            <ul className="wsc-pool">
              {rest.map((s) => (
                <li key={s.id}>
                  <span className="wsc-song"><b>{s.title}</b><small>{[s.artist, mmss(songLen(s))].filter(Boolean).join(" · ")}</small></span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => set("song_ids", [...form.song_ids, s.id])}><Plus size={13} /> 加入</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {chosen.length > 1 && (
          <label className="wall-msg-toggle"><Toggle checked={form.shuffle} onChange={(v) => set("shuffle", v)} label="隨機播放" /> 隨機播放（不照上面的順序）</label>
        )}
        {chosen.length > 0 && (
          <Field label="歌都播過一輪之後" hint="進場曲只有一首，播完通常要自動回到用餐的歌；用餐、敬酒這種比較長的，選重複播。">
            <Select value={form.after_id ?? ""} onChange={(v) => set("after_id", v === "" ? null : Number(v))}
              options={[{ value: "", label: "重複播這些歌" }, ...others.map((s) => ({ value: s.id, label: `自動換到「${s.name}」` }))]} />
          </Field>
        )}
      </div>

      <div className="wsc-sec">
        <div className="wsc-sec-title"><Monitor size={16} /> 畫面放什麼</div>
        <div className="wsc-chips">
          <button type="button" className={`btn btn-sm ${!c ? "btn-primary" : "btn-ghost"}`} onClick={() => set("content", null)}>跟「內容」分頁一樣</button>
          {PRESETS.map((p) => (
            <button key={p.key} type="button" title={p.hint} className={`btn btn-sm ${c && presetOf(c) === p.key ? "btn-primary" : "btn-ghost"}`}
              onClick={() => set("content", { ...p.set, ...(c?.mix ? { mix: c.mix } : {}) })}>{p.label}</button>
          ))}
        </div>
        {c && (
          <div className="wsc-content">
            {[["lyrics", "逐字歌詞"], ["messages", "賓客祝福留言"], ["photos", "照片與註解"]].map(([k, label]) => (
              <label key={k} className="wall-msg-toggle"><Toggle checked={!!c[k]} onChange={(v) => set("content", { ...c, [k]: v })} label={label} /> {label}</label>
            ))}
            {c.photos && (c.lyrics || c.messages) && (
              <Field label="照片和其他畫面的比例">
                <Select value={c.mix || "even"} onChange={(v) => set("content", { ...c, mix: v })} options={MIX.map(([k, label]) => ({ value: k, label }))} />
              </Field>
            )}
            <div className="helper-text">
              {c.photos ? "照片照「內容」分頁選的相簿與註解設定。" : ""}
              {!c.messages ? "這個場合不放賓客留言：畫面上沒有 QR code，賓客這時寫的祝福會在換到放留言的場合時上螢幕。" : ""}
            </div>
          </div>
        )}
      </div>

      <div className="wsc-sec">
        <div className="wsc-sec-title"><LayoutGrid size={16} /> 版面、節奏與配色</div>
        <div className="wsc-chips">
          <button type="button" className={`btn btn-sm ${form.plates.length === 0 ? "btn-primary" : "btn-ghost"}`} onClick={() => set("plates", [])}>照「版面」分頁</button>
          <button type="button" className={`btn btn-sm ${form.plates.length ? "btn-primary" : "btn-ghost"}`} onClick={() => setPicking(true)}>
            {form.plates.length ? `只用挑的 ${form.plates.length} 個版面（改）` : "只用挑的版面…"}
          </button>
        </div>
        {form.plates.length > 0 && (
          <div className="wsc-thumbs">
            {form.plates.map((n) => {
              const p = PLATES.find((x) => x.name === n);
              return (
                <span key={n} className="wsc-thumb" title={p?.title || n}>
                  <img src={`/wall-thumbs/${n}.jpg`} alt={p?.title || n} loading="lazy" />
                  <button type="button" onClick={() => set("plates", form.plates.filter((x) => x !== n))} aria-label={`拿掉「${p?.title || n}」`}><X size={12} /></button>
                </span>
              );
            })}
          </div>
        )}
        <div className="wsc-row">
          <span className="wsc-row-label">換版面的節奏</span>
          <div className="wsc-chips">
            {PACE.map(([k, label]) => <button key={k} type="button" className={`btn btn-sm ${form.pace === k ? "btn-primary" : "btn-ghost"}`} onClick={() => set("pace", k)}>{label}</button>)}
          </div>
        </div>
        <div className="wsc-row">
          <span className="wsc-row-label">配色</span>
          <div className="wsc-chips">
            <button type="button" className={`btn btn-sm ${!form.theme ? "btn-primary" : "btn-ghost"}`} onClick={() => set("theme", "")}>每首歌自己的</button>
            {THEMES.map((t) => (
              <button key={t.key} type="button" className={`btn btn-sm ${form.theme === t.key ? "btn-primary" : "btn-ghost"}`} onClick={() => set("theme", t.key)}>
                <span className="wsc-swatch" style={{ background: t.colors.signal }} aria-hidden="true" />{t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="wsc-sec">
        <label className="wall-msg-toggle wsc-duck">
          <Toggle checked={form.duck} onChange={(v) => set("duck", v)} label="講話模式" />
          <span><b>切到這個場合時自動開講話模式</b><small>音樂慢慢調小聲（小聲到幾 % 在「遙控」設定），適合證婚、致詞、文定儀式。換到別的場合會自動恢復。</small></span>
        </label>
      </div>

      {picking && <PlatePicker value={form.plates} onClose={() => setPicking(false)} onDone={(v) => { set("plates", v); setPicking(false); }} />}
    </Modal>
  );
}

/** 挑這個場合要用的版面：縮圖一格一格點，可以照系列篩、打字找。 */
function PlatePicker({ value, onClose, onDone }) {
  const [sel, setSel] = useState(() => new Set(value));
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const families = useMemo(() => [...new Set(PLATES.map((p) => p.family))], []);
  const shown = searchPlates(PLATES.filter((p) => !filter || (filter === "picked" ? sel.has(p.name) : p.family === filter)), query);
  const toggle = (n) => setSel((s) => { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x; });
  const photoPicked = PLATES.some((p) => p.photo && sel.has(p.name));
  return (
    <Modal wide title="挑這個場合的版面" onClose={onClose} className="wsc-picker"
      footer={<>
        <span className="muted-cell wsc-picker-count">已挑 {sel.size} 個</span>
        {sel.size > 0 && <button type="button" className="btn btn-ghost" onClick={() => setSel(new Set())}>全部清掉</button>}
        <button type="button" className="btn btn-primary" onClick={() => onDone(PLATES.filter((p) => sel.has(p.name)).map((p) => p.name))}><Check size={15} /> 完成</button>
      </>}>
      <p className="helper-text" style={{ marginTop: 0 }}>
        建議至少挑 4、5 個，畫面才不會一直重複。{!photoPicked && "放照片的段落沒挑照片版面的話，會從全部的照片版面挑。"}
        想看版面播起來的樣子，到「版面」分頁按縮圖預覽。
      </p>
      <div className="ws-summary">
        <button type="button" className={`btn btn-sm ${!filter ? "btn-primary" : "btn-ghost"}`} onClick={() => setFilter("")}>全部</button>
        {sel.size > 0 && <button type="button" className={`btn btn-sm ${filter === "picked" ? "btn-primary" : "btn-ghost"}`} onClick={() => setFilter("picked")}>已挑 {sel.size}</button>}
        {families.map((f) => <button key={f} type="button" className={`btn btn-sm ${filter === f ? "btn-primary" : "btn-ghost"}`} onClick={() => setFilter(f)}>{FAMILY[f] || f}</button>)}
      </div>
      <div className="seatviewer-search wsc-search">
        <Search size={16} />
        <input type="text" value={query} placeholder="搜尋版面，例如「燈」「信」「海」" onChange={(e) => setQuery(e.target.value)} />
      </div>
      {shown.length === 0 ? <Empty>沒有符合的版面</Empty> : (
        <div className="wsc-grid">
          {shown.map((p) => {
            const on = sel.has(p.name);
            return (
              <button key={p.name} type="button" className={`wsc-plate${on ? " on" : ""}`} aria-pressed={on} onClick={() => toggle(p.name)}>
                <img src={`/wall-thumbs/${p.name}.jpg`} alt="" loading="lazy" />
                <span className="wsc-plate-title">{p.title}</span>
                {on && <span className="wsc-plate-check"><Check size={14} /></span>}
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
